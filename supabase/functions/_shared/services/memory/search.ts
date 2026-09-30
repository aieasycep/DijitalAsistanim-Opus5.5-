/**
 * Hybrid search (IMPLEMENTATION_PLAN T-5.07; API-SRCH-01; M§26, M§95).
 *
 * The T0 parser lifts dates, type words and person hints out of the query; Pro users within the
 * `semantic_search_daily` quota get a query embedding (`embedding_query` route) and the vector leg
 * of RPC-02 `search_user_content`, which runs with the caller's JWT (RLS, retention-filtered,
 * RRF k=60). A missing embedding never fails the request: the mode becomes `fts_only`. Free users
 * never see `memory` results (`meta.locked_types`). `mode=answer` (Pro) composes a grounded,
 * extractive answer from the retrieved rows only; with no grounded source it answers
 * "Bunu kayıtlarında bulamadım." with `confidence_label='unsure'`.
 */
import { isUuid, type Provider, routeForSource, routes, type SourceType } from '@da/domain';
import { AppError } from '../../errors.ts';
import { clip, copy, type CopyLocale } from '../copy.ts';
import type { EmbedOutcome } from './embed.ts';
import { parseSearchQuery, type SearchType } from './query-parse.ts';

export interface SearchRow {
  readonly result_type: SearchType;
  readonly entity_id: string;
  readonly title: string | null;
  readonly snippet: string | null;
  readonly source_type: SourceType;
  readonly source_id: string;
  readonly source_provider: Provider | null;
  readonly source_timestamp: string;
  readonly score: number;
}

export interface SearchRpcArgs {
  readonly p_query: string;
  readonly p_query_embedding: string | null;
  readonly p_types: SearchType[] | null;
  readonly p_from: string | null;
  readonly p_to: string | null;
  readonly p_contact_id: string | null;
  readonly p_cursor: string | null;
  readonly p_limit: number;
}

export interface SearchPorts {
  /** RPC-02 with the user-scoped client. */
  search(args: SearchRpcArgs): Promise<SearchRow[]>;
  /** The caller's contacts whose display name matches (person hints). */
  contactsNamed(names: readonly string[]): Promise<{ id: string; display_name: string }[]>;
  /** Whether a contact id belongs to the caller. */
  ownsContact(contactId: string): Promise<boolean>;
  /** `check_plan_limit('semantic_search_daily')` for the caller. */
  semanticQuota(): Promise<boolean>;
  /** Query embedding (Pro); `null` port on Free. */
  embedQuery: ((text: string) => Promise<EmbedOutcome>) | null;
}

export interface SearchRequest {
  readonly q: string;
  readonly mode: 'results' | 'answer';
  readonly types?: readonly SearchType[] | undefined;
  readonly contact_id?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface SearchResultView {
  readonly type: SearchType;
  readonly id: string;
  readonly title: string;
  readonly snippet: string;
  readonly source: {
    readonly source_type: SourceType;
    readonly source_id: string | null;
    readonly source_provider: Provider | null;
    readonly source_timestamp: string;
    readonly open_route?: string;
  };
  readonly score: number;
  readonly route: string;
}

export interface SearchAnswerView {
  readonly text: string;
  readonly emphasis_spans: { start: number; end: number }[];
  readonly confidence_label: 'high' | 'partial' | 'unsure';
  readonly source_count: number;
}

export interface SearchOutcome {
  readonly data: {
    mode: 'hybrid' | 'fts_only';
    results: SearchResultView[];
    answer?: SearchAnswerView;
    sources?: SearchResultView[];
  };
  readonly lockedTypes: readonly SearchType[];
  readonly degraded: boolean;
  readonly semanticUsed: boolean;
}

const ALL_TYPES: readonly SearchType[] = [
  'email',
  'person',
  'event',
  'task',
  'commitment',
  'life_event',
  'memory',
  'capture',
];

/** pgvector text literal (`[0.1,0.2,…]`). */
export function vectorLiteral(values: readonly number[]): string {
  return `[${values.map((v) => (Number.isFinite(v) ? Number(v.toFixed(7)) : 0)).join(',')}]`;
}

function resultRoute(row: SearchRow): string {
  const id = row.entity_id;
  switch (row.result_type) {
    case 'email':
      return routes.mailDetail(id);
    case 'person':
      return routes.person(id);
    case 'event':
      return routes.event(id);
    case 'task':
      return routes.plan();
    case 'commitment':
      return routes.commitment(id);
    case 'life_event':
      return routes.life(id);
    case 'capture':
      return routes.captureDetail(id);
    case 'memory':
      return routeForSource(row.source_type, row.source_id) ?? routes.memory();
  }
}

export function toResultView(row: SearchRow): SearchResultView {
  const openRoute = routeForSource(row.source_type, row.source_id);
  return {
    type: row.result_type,
    id: row.entity_id,
    title: clip(row.title ?? '', 200),
    snippet: clip(row.snippet ?? '', 300),
    source: {
      source_type: row.source_type,
      source_id: isUuid(row.source_id) ? row.source_id : null,
      source_provider: row.source_provider,
      source_timestamp: new Date(row.source_timestamp).toISOString(),
      ...(openRoute === null ? {} : { open_route: openRoute }),
    },
    score: row.score,
    route: resultRoute(row),
  };
}

const tokens = (s: string): string[] =>
  s
    .toLocaleLowerCase('tr-TR')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3);

/**
 * Extractive grounded answer: the best-covering retrieved rows, verbatim (titles emphasised).
 * Coverage = share of query terms found in the used rows.
 */
export function groundedAnswer(
  query: string,
  results: readonly SearchResultView[],
  locale: CopyLocale,
): { answer: SearchAnswerView; sources: SearchResultView[] } {
  const terms = [...new Set(tokens(query))];
  const scored = results
    .map((r) => {
      const hay = new Set(tokens(`${r.title} ${r.snippet}`));
      const hits = terms.filter((t) =>
        [...hay].some((h) => h.startsWith(t.slice(0, Math.max(3, t.length - 2)))),
      );
      return { r, hits };
    })
    .filter((x) => x.hits.length > 0 && (x.r.title !== '' || x.r.snippet !== ''))
    .slice(0, 3);
  if (scored.length === 0) {
    return {
      answer: {
        text: copy(locale, 'search.generated.notFound'),
        emphasis_spans: [],
        confidence_label: 'unsure',
        source_count: 0,
      },
      sources: [],
    };
  }
  let text = '';
  const spans: { start: number; end: number }[] = [];
  for (const { r } of scored) {
    const title = clip(r.title, 120);
    const snippet = clip(r.snippet, 280);
    const prefix = text === '' ? '' : '\n';
    const start = text.length + prefix.length;
    text += `${prefix}${title}`;
    if (title !== '') spans.push({ start, end: start + title.length });
    if (snippet !== '' && snippet !== title) text += ` — ${snippet}`;
  }
  text = text.slice(0, 1200);
  const covered = new Set(scored.flatMap((x) => x.hits));
  const coverage = terms.length === 0 ? 0 : covered.size / terms.length;
  return {
    answer: {
      text,
      emphasis_spans: spans.filter((s) => s.end <= text.length).slice(0, 20),
      confidence_label: coverage >= 0.75 ? 'high' : 'partial',
      source_count: scored.length,
    },
    sources: scored.map((x) => x.r),
  };
}

export async function runSearch(
  ports: SearchPorts,
  request: SearchRequest,
  context: {
    readonly isPro: boolean;
    readonly now: Date;
    readonly timeZone: string;
    readonly locale: CopyLocale;
  },
): Promise<SearchOutcome> {
  const parsed = parseSearchQuery(request.q, context.now, context.timeZone);
  const requested = request.types ?? (parsed.types.length > 0 ? parsed.types : ALL_TYPES);
  const lockedTypes: SearchType[] =
    !context.isPro && requested.includes('memory') && request.types !== undefined ? ['memory'] : [];
  const types = context.isPro ? [...requested] : requested.filter((t) => t !== 'memory');
  let contactId = request.contact_id ?? null;
  if (contactId !== null && !(await ports.ownsContact(contactId))) {
    throw new AppError('NOT_FOUND', { details: { resource: 'contact' } });
  }
  if (contactId === null && parsed.personHints.length > 0) {
    const named = await ports.contactsNamed(parsed.personHints);
    if (named.length === 1) contactId = named[0]!.id;
  }
  let embedding: string | null = null;
  let semanticUsed = false;
  let degraded = false;
  if (context.isPro && ports.embedQuery !== null && types.includes('memory')) {
    if (await ports.semanticQuota()) {
      const outcome = await ports.embedQuery(parsed.text);
      if (outcome.kind === 'ok' && outcome.vectors[0] !== undefined) {
        embedding = vectorLiteral(outcome.vectors[0]);
        semanticUsed = true;
      } else degraded = true;
    } else degraded = true;
  }
  const rows =
    types.length === 0
      ? []
      : await ports.search({
          p_query: parsed.text,
          p_query_embedding: embedding,
          p_types: [...types],
          p_from: request.from ?? parsed.from?.toISOString() ?? null,
          p_to: request.to ?? parsed.to?.toISOString() ?? null,
          p_contact_id: contactId,
          p_cursor: request.cursor ?? null,
          p_limit: request.limit,
        });
  const results = rows.map(toResultView);
  const data: SearchOutcome['data'] = { mode: embedding === null ? 'fts_only' : 'hybrid', results };
  if (request.mode === 'answer') {
    const { answer, sources } = groundedAnswer(parsed.text, results, context.locale);
    data.answer = answer;
    data.sources = sources.slice(0, 12);
  }
  return { data, lockedTypes, degraded, semanticUsed };
}

/**
 * Universal Capture extraction (IMPLEMENTATION_PLAN T-5.13; AI_PIPELINE_PLAN §13.4; JOB-27; M§27,
 * M§83). Text and link pages go to T1 (`capture`, classifier role), photos to T2 vision
 * (`capture_vision`: a verbatim transcript first, then items quoting it), text PDFs to T2 per-page
 * blocks (`capture_pdf`). All output is `CaptureExtractV1`; code verifies every quote against its
 * document (or the model's own transcript for images), re-parses dates and amounts in the user's
 * time zone, drops fields whose quote is not in the source (a fabricated price disappears) and
 * maps each item to `extracted_entity_type` with its proposed approval type.
 */
import {
  type ExtractedEntityType,
  foldTR,
  normalizeTR,
  parseAmountsTR,
  parseDatesTR,
} from '@da/domain';
import { type CaptureExtractItem, CaptureExtractV1, refineCaptureExtractV1 } from '@da/validation';
import { generateStructured } from '../../ai/call.ts';
import { assemblePrompt } from '../../ai/prompts/assemble.ts';
import type { PromptParts, T0Reason } from '../../ai/types.ts';
import type { UntrustedDoc } from '../../ai/untrusted.ts';
import { aliasMap, bandConfidence, groundQuote } from '../ai/grounding.ts';
import { injectionScan, modelText } from '../ai/hygiene.ts';
import { type PipelineContext, trustedHeader } from '../ai/pipeline.ts';
import { sourceRef } from '../assist/common.ts';
import { clip } from '../copy.ts';
import { PDF_MODEL_PAGES } from './pdf.ts';

export interface CaptureItemView {
  item_id: string;
  type: ExtractedEntityType;
  title: string;
  fields: Record<string, unknown>;
  evidence: { quote: string; source: ReturnType<typeof sourceRef>; page?: number }[];
  confidence: number;
  proposed_action:
    'calendar_create' | 'task_create' | 'reminder_create' | 'commitment_create' | null;
  selected: boolean;
  unresolved: string[];
  approval_ids?: Record<string, string>;
}

export type CaptureInput =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'page'; readonly text: string; readonly title: string | null }
  | {
      readonly kind: 'image';
      readonly mime: 'image/jpeg' | 'image/png' | 'image/webp';
      readonly b64: string;
    }
  | { readonly kind: 'pdf_text'; readonly pages: readonly string[] }
  | { readonly kind: 'pdf_scanned'; readonly b64: string; readonly pageCount: number };

export type ExtractOutcome =
  | {
      readonly kind: 'ok';
      readonly items: CaptureItemView[];
      readonly title: string;
      readonly summary: string | null;
      readonly aiRequestId: string | null;
      readonly injectionSuspected: boolean;
    }
  | { readonly kind: 't0'; readonly reason: T0Reason | 'refine_failed' };

const fold = (s: string) => foldTR(normalizeTR(s)).toLowerCase();

const ACTION: Readonly<Record<ExtractedEntityType, CaptureItemView['proposed_action']>> = {
  event: 'calendar_create',
  task: 'task_create',
  deadline: 'reminder_create',
  payment: 'reminder_create',
  reservation: 'calendar_create',
  flight: 'calendar_create',
  person: null,
  shipment: null,
  product: null,
  note: null,
};

function docsFor(input: CaptureInput): {
  docs: UntrustedDoc[];
  promptKey: 'capture' | 'capture_vision' | 'capture_pdf';
} {
  switch (input.kind) {
    case 'text':
      return {
        docs: [
          {
            ref: 'n1',
            kind: 'capture_text',
            text: modelText({ text: input.text, html: null }, 5_000).text,
          },
        ],
        promptKey: 'capture',
      };
    case 'page':
      return {
        docs: [
          {
            ref: 'w1',
            kind: 'page',
            text: modelText({ text: input.text, html: null }, 8_000).text,
            ...(input.title === null ? {} : { meta: { title: input.title } }),
          },
        ],
        promptKey: 'capture',
      };
    case 'pdf_text':
      return {
        docs: input.pages
          .slice(0, PDF_MODEL_PAGES)
          .map((p, i) => ({
            ref: `p${i + 1}`,
            kind: 'capture_text' as const,
            text: modelText({ text: p, html: null }, 1_500).text,
          }))
          .filter((d) => d.text.trim() !== ''),
        promptKey: 'capture_pdf',
      };
    case 'image':
      return { docs: [], promptKey: 'capture_vision' };
    case 'pdf_scanned':
      return { docs: [], promptKey: 'capture_pdf' };
  }
}

function resolveDate(quote: string | null, now: Date, tz: string) {
  if (quote === null || quote.trim() === '') return null;
  return parseDatesTR(quote, { anchor: now, timeZone: tz })[0] ?? null;
}

/** Keeps a quote field only when it occurs in the verified source text. */
function inSource(value: string | null, source: string): string | null {
  if (value === null || value.trim() === '') return null;
  return fold(source).includes(fold(value.trim())) ? value.trim() : null;
}

function mapItem(
  item: CaptureExtractItem,
  index: number,
  ctx: {
    source: string;
    ref: string | null;
    now: Date;
    tz: string;
    captureId: string;
    captureAt: string;
    confidence: number;
  },
): CaptureItemView | null {
  const unresolved: string[] = [];
  const fields: Record<string, unknown> = {};
  const q = (v: string | null) => inSource(v, ctx.source);
  let title = '';
  const type: ExtractedEntityType = item.kind;
  const due = (quote: string | null, key: string) => {
    const kept = q(quote);
    if (kept === null) return;
    fields[`${key}_quote`] = kept;
    const d = resolveDate(kept, ctx.now, ctx.tz);
    if (d === null) {
      unresolved.push(`${key}_unparsed`);
      return;
    }
    if (d.ambiguous) unresolved.push(`${key}_ambiguous`);
    fields[`${key}_at`] = d.start.toISOString();
    fields[`${key}_precision`] = d.precision;
    if (d.endLocalTime !== null) fields[`${key}_end_at`] = d.end.toISOString();
  };
  switch (item.kind) {
    case 'event': {
      title = item.title_tr;
      due(
        `${item.date_quote}${item.time_quote === null ? '' : ` ${item.time_quote}`}`.trim(),
        'start',
      );
      if (fields.start_at === undefined) due(item.date_quote, 'start');
      const end = q(item.end_quote);
      if (end !== null) fields.end_quote = end;
      const place = q(item.place_quote);
      if (place !== null) fields.place = place;
      break;
    }
    case 'task':
      title = item.title_tr;
      due(item.due_quote, 'due');
      fields.is_suggestion = item.is_suggestion;
      break;
    case 'deadline':
      title = item.what_tr;
      due(item.when_quote, 'due');
      break;
    case 'person': {
      const name = q(item.name_quote);
      if (name === null) return null;
      title = name;
      fields.name = name;
      if (item.role_tr !== null) fields.role = clip(item.role_tr, 120);
      unresolved.push('person_ambiguous');
      break;
    }
    case 'payment': {
      const payee = q(item.payee_quote);
      title = payee ?? item.amount_quote ?? '';
      if (payee !== null) fields.payee = payee;
      const amountQuote = q(item.amount_quote);
      if (amountQuote !== null) {
        const amount = parseAmountsTR(amountQuote)[0];
        if (amount !== undefined) {
          fields.amount_minor = amount.minor;
          fields.currency = amount.currency;
          fields.amount_quote = amountQuote;
        }
      } else if (item.amount_quote !== null) {
        unresolved.push('amount_unverified');
      }
      due(item.due_quote, 'due');
      const reference = q(item.reference_quote);
      if (reference !== null) fields.reference = reference;
      break;
    }
    case 'reservation': {
      const venue = q(item.venue_quote);
      if (venue === null) return null;
      title = venue;
      due(item.at_quote, 'start');
      const party = q(item.party_size_quote);
      if (party !== null) fields.party_size = party;
      break;
    }
    case 'flight': {
      const flight = q(item.flight_no_quote);
      if (flight === null) return null;
      title = flight;
      fields.flight_no = flight;
      due(item.depart_quote, 'start');
      for (const [key, value] of [
        ['from', item.from_quote],
        ['to', item.to_quote],
        ['pnr', item.pnr_quote],
      ] as const) {
        const kept = q(value);
        if (kept !== null) fields[key] = kept;
      }
      break;
    }
    case 'shipment': {
      const carrier = q(item.carrier_quote);
      const tracking = q(item.tracking_quote);
      if (carrier === null && tracking === null) return null;
      title = [carrier, tracking].filter((v) => v !== null).join(' · ');
      if (carrier !== null) fields.carrier = carrier;
      if (tracking !== null) fields.tracking = tracking;
      due(item.eta_quote, 'eta');
      break;
    }
    case 'product': {
      const name = q(item.name_quote);
      if (name === null) return null;
      title = name;
      const price = q(item.price_quote);
      if (price !== null) {
        const amount = parseAmountsTR(price)[0];
        fields.price_quote = price;
        if (amount !== undefined) {
          fields.amount_minor = amount.minor;
          fields.currency = amount.currency;
        }
      } else if (item.price_quote !== null) unresolved.push('price_unverified');
      break;
    }
    case 'note':
      title = item.text_tr;
      break;
  }
  const evidence = 'evidence' in item && item.evidence !== null ? item.evidence : null;
  const source = sourceRef({
    source_type: 'capture',
    source_id: ctx.captureId,
    source_provider: null,
    source_timestamp: ctx.captureAt,
  });
  const page =
    evidence !== null && /^p\d+$/.test(evidence.ref) ? Number(evidence.ref.slice(1)) : undefined;
  return {
    item_id: `i${index + 1}`,
    type,
    title: clip(title.trim() === '' ? item.kind : title.trim(), 300),
    fields,
    evidence:
      evidence === null
        ? []
        : [
            {
              quote: evidence.quote.slice(0, 300),
              source,
              ...(page === undefined ? {} : { page }),
            },
          ],
    confidence: evidence === null ? Math.min(ctx.confidence, 0.55) : ctx.confidence,
    proposed_action: ACTION[type],
    selected: evidence !== null && unresolved.length === 0 && ACTION[type] !== null,
    unresolved,
  };
}

export async function extractCapture(
  pipeline: PipelineContext,
  input: CaptureInput,
  meta: {
    readonly captureId: string;
    readonly capturedAt: string;
    readonly shareOrigin: string;
    readonly hint: string | null;
    readonly now: Date;
  },
): Promise<ExtractOutcome> {
  const { docs, promptKey } = docsFor(input);
  const isLink = input.kind === 'page';
  const vision = input.kind === 'image' || input.kind === 'pdf_scanned';
  const context = [
    ...trustedHeader(pipeline.user, meta.now),
    `Paylaşım: ${meta.shareOrigin}`,
    ...(meta.hint === null ? [] : [`İpucu türü: ${meta.hint}`]),
    ...(input.kind === 'pdf_text' ? [`Sayfa sayısı: ${input.pages.length}`] : []),
  ];
  const imageRef = input.kind === 'image' ? 'img1' : 'p1';
  const scan = injectionScan(docs.map((d) => d.text).join('\n'));
  const result = await generateStructured(pipeline.runtime, {
    feature: 'capture_extract',
    userId: pipeline.user.userId,
    plan: pipeline.user.plan,
    profile: pipeline.user.profile,
    flags: pipeline.user.flags,
    schema: CaptureExtractV1,
    schemaName: 'CaptureExtractV1',
    promptKey,
    role: input.kind === 'text' || isLink ? 'classifier' : 'reasoning',
    buildPrompt: (version): PromptParts => {
      const parts = assemblePrompt({
        version,
        context,
        docs,
        vars: { count: Math.max(1, docs.length) },
        ...(pipeline.canary === undefined ? {} : { canary: pipeline.canary }),
      });
      if (input.kind === 'image')
        return { ...parts, images: [{ ref: 'img1', mime: input.mime, b64: input.b64 }] };
      if (input.kind === 'pdf_scanned') return { ...parts, pdf: { ref: 'p1', b64: input.b64 } };
      return parts;
    },
    sources: docs.map((d) => d.text),
    aliases: new Set(
      vision
        ? [imageRef, ...Array.from({ length: 50 }, (_, i) => `p${i + 1}`)]
        : docs.map((d) => d.ref),
    ),
    injection: scan,
    units: 1,
    correlationId: pipeline.correlationId,
    jobId: pipeline.jobId ?? null,
    userRef: pipeline.user.userRef,
    ...(pipeline.signal === undefined ? {} : { signal: pipeline.signal }),
    ...(pipeline.canary === undefined ? {} : { canary: pipeline.canary }),
  });
  if (result.kind !== 'ai') return { kind: 't0', reason: result.reason };
  const aliases = vision
    ? [...new Set(result.data.transcript.map((t) => t.ref))]
    : docs.map((d) => d.ref);
  const refined = refineCaptureExtractV1(result.data, {
    aliases,
    requiresTranscript: vision,
    isLink,
  });
  if (!refined.ok) return { kind: 't0', reason: 'refine_failed' };
  const data = refined.data;
  // Images and scanned PDFs are verified against the model's own verbatim transcript.
  const sourceTexts: [string, string][] = vision
    ? aliases.map((ref) => [
        ref,
        data.transcript
          .filter((t) => t.ref === ref)
          .map((t) => t.line)
          .join('\n'),
      ])
    : docs.map((d) => [d.ref, d.text]);
  const scope = {
    aliases: aliasMap(sourceTexts),
    anchor: meta.now,
    timeZone: pipeline.user.timeZone,
  };
  const byRef = new Map(sourceTexts);
  const confidence = vision
    ? Math.min(bandConfidence(data.confidence), 0.75)
    : bandConfidence(data.confidence);
  const items: CaptureItemView[] = [];
  for (const item of data.items) {
    const evidence = 'evidence' in item ? item.evidence : null;
    if (evidence !== null && groundQuote(evidence, scope, undefined, 'items') === null) continue;
    const mapped = mapItem(item, items.length, {
      source:
        evidence === null
          ? sourceTexts.map(([, t]) => t).join('\n')
          : (byRef.get(evidence.ref) ?? ''),
      ref: evidence?.ref ?? null,
      now: meta.now,
      tz: pipeline.user.timeZone,
      captureId: meta.captureId,
      captureAt: meta.capturedAt,
      confidence,
    });
    if (mapped !== null) items.push(mapped);
  }
  // A flagged source never pre-selects an action: the user picks each item explicitly (§9, R-03).
  const suspected = data.injection_suspected || scan.suspected;
  return {
    kind: 'ok',
    items: items.slice(0, 20).map((item) => (suspected ? { ...item, selected: false } : item)),
    title: data.title_tr,
    summary: data.summary_tr,
    aiRequestId: result.aiRequestId,
    injectionSuspected: suspected,
  };
}

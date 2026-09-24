/**
 * Output validators run after zod on every structured AI output (AI_PIPELINE_PLAN §9 item 13,
 * SECURITY_AND_PRIVACY_PLAN CTL-3.15, IMPLEMENTATION_PLAN T-3.09). They walk the parsed object and
 * apply the `@da/domain` grounding guards:
 * - every string field → `guardOutputText` (rejects the canary, instruction echoes and UUID-like
 *   identifiers; drops URLs / e-mail addresses / phone numbers not present in the sources; strips
 *   markup);
 * - `ref` / `refs` fields → `guardRefs` (request aliases only: the cross-user guard);
 * - `proposed_actions` / `actions` arrays → `guardProposals` (none from an injection-suspected source).
 * The cleaned object is parsed again with the schema; a failure there is `OUTPUT_REJECTED`.
 */
import { guardOutputText, guardProposals, guardRefs, type InjectionScan } from '@da/domain';
import type { z } from 'zod';

export interface OutputValidationContext {
  /** Texts the output may cite (the untrusted documents and trusted context). */
  readonly sources: readonly string[];
  /** Request aliases (`m1`, `e2`, …) the model may reference. */
  readonly aliases: ReadonlySet<string>;
  readonly canary?: string;
  readonly injection?: InjectionScan;
  /** Per-field caps (e.g. `summary_tr: 200`). */
  readonly maxLengths?: Readonly<Record<string, number>>;
}

export type OutputValidation<T> =
  | {
      readonly ok: true;
      readonly data: T;
      readonly dropped: {
        urls: number;
        emails: number;
        phones: number;
        refs: number;
        proposals: number;
      };
    }
  | {
      readonly ok: false;
      readonly reason: 'canary' | 'instruction_echo' | 'identifier_leak' | 'schema_after_cleaning';
      readonly path: string;
    };

const REF_KEYS = new Set(['ref', 'source_ref']);
const REFS_KEYS = new Set(['refs', 'source_refs', 'evidence_refs']);
const PROPOSAL_KEYS = new Set(['proposed_actions', 'actions', 'suggested_actions']);

interface Counters {
  urls: number;
  emails: number;
  phones: number;
  refs: number;
  proposals: number;
}

class Rejected extends Error {
  constructor(
    readonly reason: 'canary' | 'instruction_echo' | 'identifier_leak',
    readonly path: string,
  ) {
    super(reason);
  }
}

function walk(
  value: unknown,
  path: string,
  key: string,
  ctx: OutputValidationContext,
  counters: Counters,
): unknown {
  if (typeof value === 'string') {
    if (REF_KEYS.has(key)) {
      if (!ctx.aliases.has(value)) counters.refs++;
      return value;
    }
    const guarded = guardOutputText(value, {
      sources: ctx.sources,
      ...(ctx.canary === undefined ? {} : { canary: ctx.canary }),
      ...(ctx.maxLengths?.[key] === undefined ? {} : { maxLength: ctx.maxLengths[key] }),
      injectionSuspected: ctx.injection?.suspected === true,
    });
    if (!guarded.ok) throw new Rejected(guarded.rejection ?? 'instruction_echo', path);
    counters.urls += guarded.droppedUrls.length;
    counters.emails += guarded.droppedEmails.length;
    counters.phones += guarded.droppedPhones.length;
    return guarded.value;
  }
  if (Array.isArray(value)) {
    if (REFS_KEYS.has(key) && value.every((v) => typeof v === 'string')) {
      const kept = guardRefs(value as string[], ctx.aliases);
      counters.refs += value.length - kept.length;
      return kept;
    }
    let items = value;
    if (PROPOSAL_KEYS.has(key) && ctx.injection !== undefined) {
      items = guardProposals(value, ctx.injection);
      counters.proposals += value.length - items.length;
    }
    return items
      .map((item, i) => walk(item, `${path}[${i}]`, key, ctx, counters))
      .filter((item) => {
        if (
          item !== null &&
          typeof item === 'object' &&
          'ref' in (item as Record<string, unknown>)
        ) {
          const ref = (item as Record<string, unknown>).ref;
          return typeof ref !== 'string' || ctx.aliases.has(ref);
        }
        return true;
      });
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = walk(v, path === '' ? k : `${path}.${k}`, k, ctx, counters);
    }
    return out;
  }
  return value;
}

export function validateOutput<T>(
  schema: z.ZodType<T>,
  data: T,
  ctx: OutputValidationContext,
): OutputValidation<T> {
  const counters: Counters = { urls: 0, emails: 0, phones: 0, refs: 0, proposals: 0 };
  let cleaned: unknown;
  try {
    cleaned = walk(data, '', '', ctx, counters);
  } catch (error) {
    if (error instanceof Rejected) return { ok: false, reason: error.reason, path: error.path };
    throw error;
  }
  const reparsed = schema.safeParse(cleaned);
  if (!reparsed.success) {
    return {
      ok: false,
      reason: 'schema_after_cleaning',
      path: reparsed.error.issues[0]?.path.join('.') ?? '',
    };
  }
  return { ok: true, data: reparsed.data, dropped: counters };
}

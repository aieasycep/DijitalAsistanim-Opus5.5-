import { z } from 'zod';
import {
  Confidence,
  Evidence,
  Ref,
  Refiner,
  TEXT_CAPS,
  type BaseRefineContext,
  type RefineResult,
} from './common.ts';

/*
 * §4.3.13 · prompts `capture`, `capture_vision`, `capture_pdf`. Evidence refs: `n1` (text), `w1` (web
 * page), `img1` (image), `p1`..`p30` (PDF pages). Item `kind` maps 1:1 to `extracted_entity_type`.
 */
const Ev = Evidence;
export const CaptureExtractItem = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('event'),
    title_tr: z.string(),
    date_quote: z.string(),
    time_quote: z.string().nullable(),
    end_quote: z.string().nullable(),
    place_quote: z.string().nullable(),
    section_quote: z.string().nullable(),
    evidence: Ev,
  }),
  z.strictObject({
    kind: z.literal('task'),
    title_tr: z.string(),
    due_quote: z.string().nullable(),
    is_suggestion: z.boolean(),
    section_quote: z.string().nullable(),
    evidence: Ev.nullable(),
  }),
  z.strictObject({
    kind: z.literal('deadline'),
    what_tr: z.string(),
    when_quote: z.string(),
    section_quote: z.string().nullable(),
    evidence: Ev,
  }),
  z.strictObject({
    kind: z.literal('person'),
    name_quote: z.string(),
    role_tr: z.string().nullable(),
    evidence: Ev,
  }),
  z.strictObject({
    kind: z.literal('payment'),
    payee_quote: z.string().nullable(),
    amount_quote: z.string().nullable(),
    due_quote: z.string().nullable(),
    reference_quote: z.string().nullable(),
    evidence: Ev,
  }),
  z.strictObject({
    kind: z.literal('reservation'),
    venue_quote: z.string(),
    at_quote: z.string().nullable(),
    party_size_quote: z.string().nullable(),
    evidence: Ev,
  }),
  z.strictObject({
    kind: z.literal('flight'),
    flight_no_quote: z.string(),
    depart_quote: z.string().nullable(),
    from_quote: z.string().nullable(),
    to_quote: z.string().nullable(),
    pnr_quote: z.string().nullable(),
    evidence: Ev,
  }),
  z.strictObject({
    kind: z.literal('shipment'),
    carrier_quote: z.string().nullable(),
    tracking_quote: z.string().nullable(),
    eta_quote: z.string().nullable(),
    evidence: Ev,
  }),
  z.strictObject({
    kind: z.literal('product'),
    name_quote: z.string(),
    price_quote: z.string().nullable(),
    evidence: Ev,
  }),
  z.strictObject({ kind: z.literal('note'), text_tr: z.string(), evidence: Ev.nullable() }),
]);
export type CaptureExtractItem = z.infer<typeof CaptureExtractItem>;

export const CaptureExtractV1 = z.strictObject({
  doc_type: z.enum([
    'event',
    'invoice',
    'contract',
    'ticket',
    'receipt',
    'reservation',
    'shipment',
    'product',
    'article',
    'note',
    'other',
  ]),
  link_type: z.enum(['event', 'product', 'content', 'reservation', 'other']).nullable(),
  title_tr: z.string(),
  summary_tr: z.string().nullable(),
  transcript: z.array(z.strictObject({ ref: Ref, line: z.string() })),
  items: z.array(CaptureExtractItem),
  injection_suspected: z.boolean(),
  confidence: Confidence,
});
export type CaptureExtractV1 = z.infer<typeof CaptureExtractV1>;

export const CAPTURE_EXTRACT_LIMITS = { items: 12, title_chars: 120, note_chars: 300 } as const;

export interface CaptureRefineContext extends BaseRefineContext {
  /** `capture_vision` and scanned PDFs: evidence is verified against the model's own transcript. */
  readonly requiresTranscript: boolean;
  /** `true` for link captures: `link_type` must be set; `false` requires it to be null. */
  readonly isLink: boolean;
}

/**
 * At most 12 items with valid evidence; a non-empty transcript where required; suggestion tasks never
 * carry a due quote without evidence; `link_type` only for links.
 */
export function refineCaptureExtractV1(
  parsed: CaptureExtractV1,
  ctx: CaptureRefineContext,
): RefineResult<CaptureExtractV1> {
  const r = new Refiner(ctx.aliases);
  const transcript = parsed.transcript.filter(
    (line, i) => r.ref(line.ref, `transcript.${i}.ref`) && line.line.trim() !== '',
  );
  if (ctx.requiresTranscript && transcript.length === 0) r.fail('transcript_required');
  let linkType = parsed.link_type;
  if (ctx.isLink && linkType === null) linkType = 'other';
  if (!ctx.isLink && linkType !== null) {
    r.drop('link_type', 'cleared');
    linkType = null;
  }
  const items = r
    .cap(parsed.items, CAPTURE_EXTRACT_LIMITS.items, 'items')
    .flatMap((item, i): CaptureExtractItem[] => {
      const path = `items.${i}`;
      if (item.kind === 'task' || item.kind === 'note') {
        const evidence = r.optionalEvidence(item.evidence, `${path}.evidence`);
        if (item.kind === 'note') {
          return [
            {
              ...item,
              text_tr: r.text(item.text_tr, CAPTURE_EXTRACT_LIMITS.note_chars, `${path}.text_tr`),
              evidence,
            },
          ];
        }
        const due = item.is_suggestion && evidence === null ? null : item.due_quote;
        if (due !== item.due_quote) r.drop(`${path}.due_quote`, 'cleared');
        return [
          {
            ...item,
            title_tr: r.text(item.title_tr, CAPTURE_EXTRACT_LIMITS.title_chars, `${path}.title_tr`),
            due_quote: due,
            evidence,
          },
        ];
      }
      if (!r.evidence(item.evidence, `${path}.evidence`)) return [];
      if (item.kind === 'event') {
        return [
          {
            ...item,
            title_tr: r.text(item.title_tr, CAPTURE_EXTRACT_LIMITS.title_chars, `${path}.title_tr`),
          },
        ];
      }
      if (item.kind === 'deadline') {
        return [{ ...item, what_tr: r.text(item.what_tr, TEXT_CAPS.what_tr, `${path}.what_tr`) }];
      }
      return [item];
    });
  return r.result({
    ...parsed,
    link_type: linkType,
    title_tr: r.text(parsed.title_tr, CAPTURE_EXTRACT_LIMITS.title_chars, 'title_tr'),
    summary_tr: r.nullableText(parsed.summary_tr, TEXT_CAPS.summary_tr, 'summary_tr'),
    transcript,
    items,
  });
}

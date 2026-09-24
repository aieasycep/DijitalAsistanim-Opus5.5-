import { z } from 'zod';
import { RETENTION_POLICY_VALUES } from '@da/domain';
import { Cursor, IsoDateTime, SearchResult, SearchResultType, Uuid } from './common.ts';
import { Success } from './envelope.ts';

// API-SRCH-01 · GET /search
export const SearchQuery = z
  .strictObject({
    q: z.string().trim().min(2).max(200),
    mode: z.enum(['results', 'answer']).default('results'),
    types: z
      .string()
      .optional()
      .transform((s) => (s === undefined || s === '' ? undefined : s.split(',')))
      .pipe(z.array(SearchResultType).min(1).max(8).optional()),
    contact_id: Uuid.optional(),
    from: IsoDateTime.optional(),
    to: IsoDateTime.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: Cursor.optional(),
  })
  .refine(
    (q) => q.from === undefined || q.to === undefined || Date.parse(q.to) > Date.parse(q.from),
    {
      message: 'to_before_from',
      path: ['to'],
    },
  );

export const SearchAnswer = z.object({
  text: z.string().max(1200),
  emphasis_spans: z.array(z.object({ start: z.int().min(0), end: z.int().min(0) })).max(20),
  confidence_label: z.enum(['high', 'partial', 'unsure']),
  source_count: z.int().min(0),
});
export const SearchData = z
  .object({
    mode: z.enum(['hybrid', 'fts_only']),
    results: z.array(SearchResult),
    answer: SearchAnswer.optional(),
    sources: z.array(SearchResult).max(12).optional(),
    related_questions: z.array(z.string().max(120)).max(3).optional(),
    retention: z
      .object({
        policy: z.enum(RETENTION_POLICY_VALUES),
        oldest_available_at: IsoDateTime.nullable(),
      })
      .optional(),
    excluded_by_retention: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.answer === undefined ||
      data.answer.emphasis_spans.every(
        (span) => span.end > span.start && span.end <= (data.answer?.text.length ?? 0),
      ),
    { message: 'emphasis_span_out_of_range', path: ['answer', 'emphasis_spans'] },
  );
export const SearchResponse = Success(SearchData);

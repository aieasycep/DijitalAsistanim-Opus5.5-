import { z } from 'zod';
import { Uuid } from './common.ts';
import { Success } from './envelope.ts';

/**
 * API-ANL-01 · POST /analytics/events. The batch envelope is validated here; every event is then
 * checked with `createAnalyticsValidator(catalogue).validateBatch()` against the R-21 catalogue, so an
 * unknown name, a non-catalogue prop or a contact-like string drops (and counts) only that event.
 */
export const AnalyticsBatchItem = z.object({
  name: z.string().max(64),
  ts: z.string().max(40),
  screen: z.string().max(64).optional(),
  props: z.unknown().optional(),
});
export const AnalyticsBody = z.strictObject({
  session_id: Uuid,
  events: z.array(AnalyticsBatchItem).min(1).max(100),
});
export const AnalyticsResponse = Success(
  z.object({ accepted: z.int().min(0), dropped: z.int().min(0) }),
);

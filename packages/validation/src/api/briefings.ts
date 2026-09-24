import { z } from 'zod';
import { BRIEFING_STATUS_VALUES } from '@da/domain';
import { IsoDateTime, JobRef, Locale, Uuid } from './common.ts';
import { Success } from './envelope.ts';

export const BriefingIdParams = z.strictObject({ id: Uuid });

// API-BRF-01 · POST /briefings/:id/audio
export const BriefingAudioBody = z.strictObject({
  prefer: z.enum(['premium', 'native']).default('premium'),
});
export const BriefingAudioResponse = Success(
  z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('premium'),
      url: z.url(),
      url_expires_at: IsoDateTime,
      duration_s: z.int().min(0),
      chapters: z.array(
        z.object({
          index: z.int().min(0),
          title: z.string(),
          start_s: z.int().min(0),
          duration_s: z.int().min(0),
        }),
      ),
    }),
    z.object({
      mode: z.literal('native'),
      language: Locale,
      chapters: z.array(
        z.object({
          index: z.int().min(0),
          title: z.string(),
          text: z.string().max(4000),
          est_duration_s: z.int().min(0),
        }),
      ),
      notice_key: z.string().nullable(),
      premium_status: z.enum(['generating', 'unavailable']).nullable(),
    }),
  ]),
);

// API-BRF-02 · POST /briefings/:id/evening-ready
export const EveningReadyBody = z.strictObject({
  carry_over_item_ids: z.array(Uuid).max(50).optional(),
  confirm: z.literal(true),
});
export const EveningReadyResponse = Success(
  z.object({ carried: z.int().min(0), next_morning_at: IsoDateTime, closed_at: IsoDateTime }),
);

// API-BRF-03 · GET /weekly/:id/share-card
/**
 * Privacy-safe share card: integer aggregates only; the only strings are the week label, the formula
 * version, the time-saved label and the share text (SREQ-07). Strict, so no other field can appear.
 */
export const ShareCardData = z.strictObject({
  week_label: z.string().max(40),
  metrics: z.strictObject({
    analyzed_emails: z.int().min(0),
    important_subjects: z.int().min(0),
    meetings: z.int().min(0),
    followups_closed: z.int().min(0),
    deadlines: z.int().min(0),
    estimated_time_saved_minutes: z.int().min(0),
  }),
  formula_version: z.string().max(40),
  labels: z.strictObject({ time_saved_prefix: z.string().max(80) }),
  share_text: z.string().max(280),
});
export const ShareCardResponse = Success(ShareCardData);

// API-BRF-04 · POST /briefings/:id/retry
export const BriefingRetryBody = z.strictObject({});
export const BriefingRetryResponse = Success(
  z.object({ briefing_id: Uuid, status: z.enum(BRIEFING_STATUS_VALUES), job: JobRef }),
);

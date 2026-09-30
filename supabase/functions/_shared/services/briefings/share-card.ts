/**
 * "Dijital Haftam" share card (API-BRF-03; SREQ-07): integer aggregates of the weekly stats only.
 * The only strings are the week label, the formula version, the "tahmini" time-saved label and the
 * share text — no names, subjects or content can appear (the response schema is strict).
 */
import { WeeklyStatsV1 } from '@da/validation';
import { clip, copy, type CopyLocale } from '../copy.ts';
import { weekLabel } from './weekly.ts';

export interface ShareCard {
  readonly week_label: string;
  readonly metrics: {
    readonly analyzed_emails: number;
    readonly important_subjects: number;
    readonly meetings: number;
    readonly followups_closed: number;
    readonly deadlines: number;
    readonly estimated_time_saved_minutes: number;
  };
  readonly formula_version: string;
  readonly labels: { readonly time_saved_prefix: string };
  readonly share_text: string;
}

/** null when the stored stats are missing or malformed. */
export function shareCard(rawStats: unknown, locale: CopyLocale): ShareCard | null {
  const parsed = WeeklyStatsV1.safeParse(rawStats);
  if (!parsed.success) return null;
  const s = parsed.data;
  const int = (n: number) => Math.max(0, Math.trunc(n));
  const minutes = int(s.time_saved_min);
  return {
    week_label: clip(weekLabel(locale, { start: s.period_start, end: s.period_end }), 40),
    metrics: {
      analyzed_emails: int(s.mails_analyzed),
      important_subjects: int(s.important_count),
      meetings: int(s.meetings),
      followups_closed: int(s.followups_answered),
      deadlines: int(s.deadlines),
      estimated_time_saved_minutes: minutes,
    },
    formula_version: clip(s.time_saved_basis.formula_version, 40),
    labels: {
      time_saved_prefix: clip(copy(locale, 'briefing.generated.weekly.timeSavedPrefix'), 80),
    },
    share_text: clip(
      copy(locale, 'briefing.generated.weekly.shareText', {
        mails: int(s.mails_analyzed),
        important: int(s.important_count),
        hours: Math.floor(minutes / 60),
        minutes: minutes % 60,
      }),
      280,
    ),
  };
}

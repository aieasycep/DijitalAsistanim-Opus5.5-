/**
 * Weekly review "tahmini kazanılan zaman" (estimated time saved), formula `v1`
 * (AI_PIPELINE_PLAN §12.6; SCREEN_AND_FLOW_MAP M-BRF weekly; API_CONTRACTS weekly share card).
 *
 *   time_saved_seconds = 10  × filtered_mails       (mails_analyzed − important_count, min 0)
 *                      + 180 × prep_notes_opened    (meeting preps opened)
 *                      + 180 × drafts_sent          (reply + follow-up drafts sent after approval)
 *   time_saved_min     = floor(time_saved_seconds / 60)
 *
 * The result is an estimate and is always labelled "tahmini"; the version is stored with the
 * briefing (`weekly_stats.time_saved_basis.formula_version`) so a later formula never rewrites
 * past weeks. Design check: 684 analysed, 32 important, 14 preps, 6 drafts → 652 × 10 + 14 × 180 +
 * 6 × 180 = 10,120 s → 168 min ("2 saat 48 dakika").
 */

export const TIME_SAVED_V1 = {
  formula_version: 'v1',
  seconds_per_filtered_mail: 10,
  seconds_per_prep_note: 180,
  seconds_per_draft_sent: 180,
} as const;

/** The label the UI must show next to the figure. */
export const TIME_SAVED_QUALIFIER_TR = 'tahmini';

export interface TimeSavedInputV1 {
  mails_analyzed: number;
  important_count: number;
  prep_notes_opened: number;
  drafts_sent: number;
}

/** Stored as `weekly_stats.time_saved_basis` (WeeklyStatsV1). */
export interface TimeSavedBasisV1 {
  formula_version: 'v1';
  filtered_mails: number;
  prep_notes_opened: number;
  drafts_sent: number;
}

export interface TimeSavedResultV1 {
  is_estimate: true;
  qualifier: typeof TIME_SAVED_QUALIFIER_TR;
  time_saved_seconds: number;
  time_saved_min: number;
  /** Whole hours and remaining minutes of `time_saved_min`, for "2 saat 48 dakika". */
  hours: number;
  minutes: number;
  basis: TimeSavedBasisV1;
}

function count(name: keyof TimeSavedInputV1, value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
  return value;
}

export function computeTimeSavedV1(input: TimeSavedInputV1): TimeSavedResultV1 {
  const mails = count('mails_analyzed', input.mails_analyzed);
  const important = count('important_count', input.important_count);
  const preps = count('prep_notes_opened', input.prep_notes_opened);
  const drafts = count('drafts_sent', input.drafts_sent);
  const filtered = Math.max(0, mails - important);
  const seconds =
    TIME_SAVED_V1.seconds_per_filtered_mail * filtered +
    TIME_SAVED_V1.seconds_per_prep_note * preps +
    TIME_SAVED_V1.seconds_per_draft_sent * drafts;
  const minutesTotal = Math.floor(seconds / 60);
  return {
    is_estimate: true,
    qualifier: TIME_SAVED_QUALIFIER_TR,
    time_saved_seconds: seconds,
    time_saved_min: minutesTotal,
    hours: Math.floor(minutesTotal / 60),
    minutes: minutesTotal % 60,
    basis: {
      formula_version: TIME_SAVED_V1.formula_version,
      filtered_mails: filtered,
      prep_notes_opened: preps,
      drafts_sent: drafts,
    },
  };
}

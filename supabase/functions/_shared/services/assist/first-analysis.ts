/**
 * First Analysis progress contract (IMPLEMENTATION_PLAN T-5.15; JOB-13 writes it to
 * `jobs.progress`, API-ONB-02 reads it; R-19). Step keys: `scan_mail` "Son 72 saat taranıyor",
 * `classify` "E-postalar sınıflandırılıyor", `calendar` "Takvim kontrol ediliyor", `open_loops`
 * "Açık konular aranıyor".
 */

/** Checks per job (API_CONTRACTS JOB-13: ≤ 200) and the tick interval in seconds. */
export const FIRST_ANALYSIS_MAX_CHECKS = 200;
export const FIRST_ANALYSIS_TICK_S = 3;
/** API-ONB-02 `poll_after_ms`. */
export const FIRST_ANALYSIS_POLL_MS = 1_500;

export type StepKey = 'scan_mail' | 'classify' | 'calendar' | 'open_loops';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface FirstAnalysisCountsView {
  mails_found: number;
  potential_important: number;
  upcoming_events: number;
  possible_followups: number;
}

export interface Progress {
  started_at: string;
  checks: number;
  failures: number;
  partial: boolean;
  phase: 'sync' | 'ranking' | 'done';
  steps: { key: StepKey; status: StepStatus; count: number | null }[];
  counts: FirstAnalysisCountsView;
  briefing_job_key?: string;
}

export const INITIAL_STEPS: Progress['steps'] = [
  { key: 'scan_mail', status: 'pending', count: null },
  { key: 'classify', status: 'pending', count: null },
  { key: 'calendar', status: 'pending', count: null },
  { key: 'open_loops', status: 'pending', count: null },
];

export const ZERO_COUNTS: FirstAnalysisCountsView = {
  mails_found: 0,
  potential_important: 0,
  upcoming_events: 0,
  possible_followups: 0,
};

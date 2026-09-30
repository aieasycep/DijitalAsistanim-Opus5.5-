import { describe, expect, it } from 'vitest';
import {
  TIME_SAVED_QUALIFIER_TR,
  TIME_SAVED_V1,
  computeTimeSavedV1,
  type TimeSavedInputV1,
} from '../../src/weekly/time-saved.ts';

describe('weekly time saved, formula v1 ("tahmini")', () => {
  it('reproduces the design figure: 684 analysed, 32 important, 14 preps, 6 drafts → 2 saat 48 dakika', () => {
    const result = computeTimeSavedV1({
      mails_analyzed: 684,
      important_count: 32,
      prep_notes_opened: 14,
      drafts_sent: 6,
    });
    expect(result.time_saved_seconds).toBe(10_120);
    expect(result.time_saved_min).toBe(168);
    expect([result.hours, result.minutes]).toEqual([2, 48]);
    expect(result.basis).toEqual({
      formula_version: 'v1',
      filtered_mails: 652,
      prep_notes_opened: 14,
      drafts_sent: 6,
    });
  });

  it('is always labelled as an estimate', () => {
    const result = computeTimeSavedV1({
      mails_analyzed: 1,
      important_count: 0,
      prep_notes_opened: 0,
      drafts_sent: 0,
    });
    expect(result.is_estimate).toBe(true);
    expect(result.qualifier).toBe('tahmini');
    expect(TIME_SAVED_QUALIFIER_TR).toBe('tahmini');
  });

  it.each([
    [{ mails_analyzed: 0, important_count: 0, prep_notes_opened: 0, drafts_sent: 0 }, 0, 0],
    [{ mails_analyzed: 5, important_count: 9, prep_notes_opened: 0, drafts_sent: 0 }, 0, 0],
    [{ mails_analyzed: 6, important_count: 0, prep_notes_opened: 0, drafts_sent: 0 }, 60, 1],
    [{ mails_analyzed: 5, important_count: 0, prep_notes_opened: 0, drafts_sent: 0 }, 50, 0],
    [{ mails_analyzed: 0, important_count: 0, prep_notes_opened: 1, drafts_sent: 1 }, 360, 6],
    [{ mails_analyzed: 100, important_count: 10, prep_notes_opened: 2, drafts_sent: 3 }, 1_800, 30],
  ])('%j → %i s (%i min)', (input: TimeSavedInputV1, seconds, minutes) => {
    const result = computeTimeSavedV1(input);
    expect(result.time_saved_seconds).toBe(seconds);
    expect(result.time_saved_min).toBe(minutes);
  });

  it('is deterministic and uses the versioned constants', () => {
    const input = {
      mails_analyzed: 300,
      important_count: 25,
      prep_notes_opened: 4,
      drafts_sent: 2,
    };
    expect(computeTimeSavedV1(input)).toEqual(computeTimeSavedV1(input));
    expect(TIME_SAVED_V1).toEqual({
      formula_version: 'v1',
      seconds_per_filtered_mail: 10,
      seconds_per_prep_note: 180,
      seconds_per_draft_sent: 180,
    });
  });

  it.each([
    { mails_analyzed: -1, important_count: 0, prep_notes_opened: 0, drafts_sent: 0 },
    { mails_analyzed: 1.5, important_count: 0, prep_notes_opened: 0, drafts_sent: 0 },
    { mails_analyzed: 1, important_count: 0, prep_notes_opened: Number.NaN, drafts_sent: 0 },
  ])('rejects invalid counts %j', (input) => {
    expect(() => computeTimeSavedV1(input)).toThrow(RangeError);
  });
});

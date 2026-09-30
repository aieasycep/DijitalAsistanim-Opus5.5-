import { describe, expect, it } from 'vitest';
import { SYNC_FORCE_ANALYSIS_MAX_MESSAGES, SyncBody } from '../src/api/integrations.ts';
import { ReplyDraftPatch } from '../src/api/mail.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('SyncBody (API-INT-04, M-MAIL-03 "Analiz et" body extension)', () => {
  it('keeps the plain manual sync bodies', () => {
    expect(SyncBody.safeParse({}).success).toBe(true);
    expect(SyncBody.safeParse({ resources: ['mail', 'calendar'] }).success).toBe(true);
    expect(SyncBody.safeParse({ force_analysis: false }).success).toBe(true);
  });

  it('accepts message_ids with force_analysis, with resources absent or mail only', () => {
    expect(SyncBody.safeParse({ message_ids: [id(1)], force_analysis: true }).success).toBe(true);
    expect(
      SyncBody.safeParse({ message_ids: [id(1)], force_analysis: true, resources: ['mail'] })
        .success,
    ).toBe(true);
  });

  it('refuses the fields apart, other resources, non-uuids, too many ids and unknown keys', () => {
    expect(SyncBody.safeParse({ message_ids: [id(1)] }).success).toBe(false);
    expect(SyncBody.safeParse({ force_analysis: true }).success).toBe(false);
    expect(
      SyncBody.safeParse({ message_ids: [id(1)], force_analysis: true, resources: ['calendar'] })
        .success,
    ).toBe(false);
    expect(
      SyncBody.safeParse({
        message_ids: [id(1)],
        force_analysis: true,
        resources: ['mail', 'tasks'],
      }).success,
    ).toBe(false);
    expect(SyncBody.safeParse({ message_ids: ['nope'], force_analysis: true }).success).toBe(false);
    const many = Array.from({ length: SYNC_FORCE_ANALYSIS_MAX_MESSAGES + 1 }, (_, i) => id(i));
    expect(SyncBody.safeParse({ message_ids: many, force_analysis: true }).success).toBe(false);
    expect(SyncBody.safeParse({ message_ids: [], force_analysis: true }).success).toBe(false);
    expect(SyncBody.safeParse({ force: true }).success).toBe(false);
  });
});

describe('ReplyDraftPatch (API-MAIL-04, "Taslağı sil")', () => {
  it('accepts status discarded on its own', () => {
    expect(ReplyDraftPatch.safeParse({ status: 'discarded', expected_version: 2 }).success).toBe(
      true,
    );
  });

  it('refuses other statuses, discard mixed with edits and an empty patch', () => {
    expect(ReplyDraftPatch.safeParse({ status: 'sent', expected_version: 2 }).success).toBe(false);
    expect(
      ReplyDraftPatch.safeParse({ status: 'discarded', body_text: 'x', expected_version: 2 })
        .success,
    ).toBe(false);
    expect(ReplyDraftPatch.safeParse({ expected_version: 2 }).success).toBe(false);
    expect(ReplyDraftPatch.safeParse({ body_text: 'Merhaba', expected_version: 2 }).success).toBe(
      true,
    );
  });
});

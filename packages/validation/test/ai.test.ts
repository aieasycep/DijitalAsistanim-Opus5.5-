import { describe, expect, it } from 'vitest';
import {
  AI_OUTPUT_SCHEMA_NAMES,
  AI_SCHEMAS,
  AI_SCHEMA_NAMES,
  type AssistantAnswerV1,
  type AssistantGroundedJsonV1,
  type AssistantIntentV1,
  type BriefingMorningV1,
  type BriefingPolishV1,
  type CaptureExtractV1,
  type CommitmentExtractV1,
  type EmailDeepExtractV1,
  type EmailTriageV1,
  type EveningCloseV1,
  type LifeIntelV1,
  type MeetingPrepV1,
  type MiddayPulseV1,
  type PostMeetingCommitmentV1,
  type ReplyDraftsV1,
  type ThreadSummaryV1,
  type WeeklyReviewV1,
  type WeeklyStatsV1,
  cleanText,
  draftViolations,
  numericTokens,
  refineAssistantAnswerV1,
  refineAssistantGroundedJsonV1,
  refineAssistantIntentV1,
  refineBriefingMorningV1,
  refineBriefingPolishV1,
  refineCaptureExtractV1,
  refineCommitmentExtractV1,
  refineEmailDeepExtractV1,
  refineEmailTriageV1,
  refineEveningCloseV1,
  refineFollowUpDraftV1,
  refineLifeIntelV1,
  refineMeetingPrepV1,
  refineMiddayPulseV1,
  refinePostMeetingCommitmentV1,
  refineReplyDraftsV1,
  refineThreadSummaryV1,
  refineWeeklyReviewV1,
  refineWeeklyStatsV1,
  truncateText,
  truncateWords,
} from '../src/ai/index.ts';
import * as F from './fixtures/ai-fixtures.ts';
import { withPath } from './fixtures/samples.ts';

describe.each(AI_SCHEMA_NAMES)('%s fixtures', (name) => {
  const { schema } = AI_SCHEMAS[name];
  const fixture = F.aiFixtures[name];

  it('parses the valid fixture', () => {
    const result = schema.safeParse(fixture.valid);
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });

  it.each(fixture.invalid)('rejects: $why', ({ value }) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});

describe('AI schema registry', () => {
  it('holds the 18 catalogue schemas plus WeeklyStatsV1', () => {
    expect(AI_SCHEMA_NAMES).toHaveLength(19);
    for (const name of [
      'EmailTriageV1',
      'ThreadSummaryV1',
      'EmailDeepExtractV1',
      'CommitmentExtractV1',
      'LifeIntelV1',
      'BriefingMorningV1',
      'MiddayPulseV1',
      'EveningCloseV1',
      'WeeklyReviewV1',
      'MeetingPrepV1',
      'PostMeetingCommitmentV1',
      'CaptureExtractV1',
      'AssistantIntentV1',
      'AssistantGroundedJsonV1',
      'AssistantAnswerV1',
      'ReplyDraftsV1',
      'FollowUpDraftV1',
      'BriefingPolishV1',
    ]) {
      expect(AI_SCHEMA_NAMES).toContain(name);
    }
  });

  it('lists only model-facing schemas as prompt output schemas', () => {
    expect(AI_OUTPUT_SCHEMA_NAMES).not.toContain('MiddayPulseV1');
    expect(AI_OUTPUT_SCHEMA_NAMES).not.toContain('AssistantAnswerV1');
    expect(AI_OUTPUT_SCHEMA_NAMES).toContain('ReplyDraftsV1');
    for (const name of AI_OUTPUT_SCHEMA_NAMES)
      expect(AI_SCHEMAS[name].prompt_keys.length).toBeGreaterThan(0);
  });
});

describe('text helpers', () => {
  it('cleans markdown and HTML', () => {
    expect(cleanText('**Önemli** <b>teklif</b>\n- madde')).toBe('Önemli teklif madde');
  });
  it('truncates at word boundaries', () => {
    expect(truncateText('bir iki üç dört beş altı', 12)).toBe('bir iki üç…');
    expect(truncateWords('bir iki üç', 2)).toBe('bir iki…');
  });
  it('extracts numeric and time tokens', () => {
    expect(numericTokens('17:00’de 3 mail ve ₺1.842,50')).toEqual(['17:00', '3', '1.842.50']);
  });
});

describe('refineEmailTriageV1', () => {
  const ctx = { aliases: ['m1', 'm2'], inputCount: 1 };
  const data = F.emailTriage as EmailTriageV1;

  it('keeps a well-formed item', () => {
    const result = refineEmailTriageV1(data, ctx);
    expect(result.ok).toBe(true);
    expect(result.dropped).toEqual([]);
  });

  it('fails when the item count differs from the input', () => {
    expect(refineEmailTriageV1(data, { ...ctx, inputCount: 2 }).errors).toContain(
      'item_count_mismatch',
    );
  });

  it('fails on unknown and duplicate refs', () => {
    expect(refineEmailTriageV1(withPath(data, 'items.0.ref', 'm9'), ctx).ok).toBe(false);
    const dup = { items: [data.items[0], data.items[0]] } as EmailTriageV1;
    expect(refineEmailTriageV1(dup, { ...ctx, inputCount: 2 }).errors).toContain('duplicate_ref');
  });

  it('clears summary and key points of low-attention mail (token hygiene)', () => {
    let low = withPath(data, 'items.0.category', 'informational');
    low = withPath(low, 'items.0.important', false);
    low = withPath(low, 'items.0.needs_reply', false);
    const result = refineEmailTriageV1(low, ctx);
    expect(result.data.items[0]?.summary_tr).toBeNull();
    expect(result.data.items[0]?.key_points_tr).toEqual([]);
  });

  it('caps key points and drops deadlines with malformed quotes', () => {
    let item = withPath(data, 'items.0.key_points_tr', ['a1', 'b2', 'c3', 'd4']);
    item = withPath(item, 'items.0.deadlines.0.evidence.quote', 'x');
    const result = refineEmailTriageV1(item, ctx);
    expect(result.data.items[0]?.key_points_tr).toHaveLength(3);
    expect(result.data.items[0]?.deadlines).toEqual([]);
    expect(result.dropped.map((d) => d.reason)).toEqual(
      expect.arrayContaining(['over_cap', 'quote_length']),
    );
  });

  it('nulls life evidence when no life signal is set', () => {
    const item = withPath(data, 'items.0.life_evidence', { ref: 'm1', quote: 'kargonuz yolda' });
    expect(refineEmailTriageV1(item, ctx).data.items[0]?.life_evidence).toBeNull();
  });

  it('truncates an over-long reason', () => {
    const item = withPath(data, 'items.0.reason_tr', 'uzun '.repeat(60));
    const reason = refineEmailTriageV1(item, ctx).data.items[0]?.reason_tr ?? '';
    expect(reason.length).toBeLessThanOrEqual(140);
  });
});

describe('refineThreadSummaryV1', () => {
  const ctx = { aliases: ['m1', 'm2'] };
  it('caps the summary at 60 words and drops unverifiable points', () => {
    let data = withPath(
      F.threadSummary as ThreadSummaryV1,
      'summary_tr',
      Array.from({ length: 70 }, (_, i) => `k${String(i)}`).join(' '),
    );
    data = withPath(data, 'key_points.0.evidence.ref', 'm7');
    data = withPath(data, 'latest_ask.evidence.quote', 'ab');
    const result = refineThreadSummaryV1(data, ctx);
    expect(result.data.summary_tr.split(' ')).toHaveLength(60);
    expect(result.data.key_points).toEqual([]);
    expect(result.data.latest_ask).toBeNull();
  });
  it('fails on an empty summary', () => {
    expect(
      refineThreadSummaryV1(withPath(F.threadSummary as ThreadSummaryV1, 'summary_tr', '  '), ctx)
        .ok,
    ).toBe(false);
  });
});

describe('refineCommitmentExtractV1', () => {
  const data = F.commitmentExtract as CommitmentExtractV1;
  it('keeps user-owned claims on the user’s own sent mail', () => {
    const result = refineCommitmentExtractV1(data, { aliases: ['m1'], ownRefs: ['m1'] });
    expect(result.data.items[0]?.commitments[0]?.owner).toBe('user');
    expect(result.data.items[0]?.expects_reply).toBe(true);
  });
  it('rewrites owner=user on inbound mail and forces expects_reply off', () => {
    const result = refineCommitmentExtractV1(data, { aliases: ['m1'], ownRefs: [] });
    expect(result.data.items[0]?.commitments[0]?.owner).toBe('counterparty');
    expect(result.data.items[0]?.expects_reply).toBe(false);
    expect(result.data.items[0]?.expects_reply_evidence).toBeNull();
  });
  it('drops negated claims', () => {
    const negated = withPath(data, 'items.0.commitments.0.certainty', 'negated');
    expect(
      refineCommitmentExtractV1(negated, { aliases: ['m1'], ownRefs: ['m1'] }).data.items[0]
        ?.commitments,
    ).toEqual([]);
  });
});

describe('refineEmailDeepExtractV1', () => {
  const data = F.emailDeepExtract as EmailDeepExtractV1;
  it('caps people at 6 and keeps verified fields', () => {
    const many = withPath(
      data,
      'people',
      Array.from({ length: 8 }, () => data.people[0]),
    );
    const result = refineEmailDeepExtractV1(many, { aliases: ['m1'], ownText: false });
    expect(result.ok).toBe(true);
    expect(result.data.people).toHaveLength(6);
    expect(result.data.amounts).toHaveLength(1);
  });
  it('fails on an unknown ref', () => {
    expect(refineEmailDeepExtractV1(data, { aliases: ['m2'], ownText: false }).ok).toBe(false);
  });
});

describe('refineLifeIntelV1', () => {
  it('drops events whose evidence points at another email', () => {
    const data = withPath(F.lifeIntel as LifeIntelV1, 'items.0.events.1.evidence.ref', 'm2');
    const result = refineLifeIntelV1(data, { aliases: ['m1', 'm2'] });
    expect(result.data.items[0]?.events.map((e) => e.kind)).toEqual(['shipment']);
  });
  it('drops items with unknown refs', () => {
    expect(refineLifeIntelV1(F.lifeIntel as LifeIntelV1, { aliases: ['m5'] }).data.items).toEqual(
      [],
    );
  });
});

describe('refineBriefingMorningV1', () => {
  const ctx = {
    aliases: ['i1', 's1', 's2'],
    refTexts: { i1: 'Teklif · 17:00', s1: '3 öncelik', s2: 'Takvim sakin' },
    nonEmptySections: ['priorities', 'schedule'] as const,
    topPriorityRefs: ['i1'],
  };
  const data = F.briefingMorning as BriefingMorningV1;

  it('keeps grounded prose', () => {
    const result = refineBriefingMorningV1(data, ctx);
    expect(result.ok).toBe(true);
    expect(result.data.narrative).toHaveLength(2);
  });

  it('drops a sentence with a number that is not in its refs (numeric guard)', () => {
    const bad = withPath(data, 'narrative.1.text_tr', 'Saat 15:30’da bir toplantın var.');
    const result = refineBriefingMorningV1(bad, ctx);
    expect(result.data.narrative).toHaveLength(1);
    expect(result.dropped).toContainEqual({ path: 'narrative.1', reason: 'number_mismatch' });
  });

  it('falls back (ok=false) when no narrative sentence survives', () => {
    const bad = withPath(data, 'narrative', [{ text_tr: '42 mail var.', refs: ['s2'] }]);
    expect(refineBriefingMorningV1(bad, ctx).ok).toBe(false);
  });

  it('keeps sections in canonical order, one per non-empty section', () => {
    const sections = [
      { section: 'schedule', text_tr: 'Takvim sakin.', refs: ['s2'] },
      { section: 'life', text_tr: 'Kargo yolda.', refs: [] },
      { section: 'priorities', text_tr: 'Önce teklif.', refs: ['i1'] },
      { section: 'priorities', text_tr: 'Tekrar.', refs: ['i1'] },
    ];
    const result = refineBriefingMorningV1(withPath(data, 'section_spoken', sections), ctx);
    expect(result.data.section_spoken.map((s) => s.section)).toEqual(['priorities', 'schedule']);
  });

  it('keeps priority reasons only for the top priorities', () => {
    const reasons = [
      { ref: 's1', why_tr: 'x' },
      { ref: 'i1', why_tr: 'Bugün istendi.' },
    ];
    expect(
      refineBriefingMorningV1(withPath(data, 'priority_reasons', reasons), ctx).data
        .priority_reasons,
    ).toEqual([{ ref: 'i1', why_tr: 'Bugün istendi.' }]);
  });
});

describe('refineBriefingPolishV1', () => {
  const originals = { i1: { title_tr: 'Mehmet 16:00’ya kaydırmak istiyor', sub_tr: null } };
  it('accepts polish that preserves every number', () => {
    const result = refineBriefingPolishV1(F.briefingPolish, { aliases: ['i1'], originals });
    expect(result.data.items[0]?.title_tr).toBe('Mehmet 16:00’ya kaydırmak istiyor');
    expect(result.dropped).toEqual([]);
  });
  it('keeps the T0 text when polish changes a number', () => {
    const changed = withPath(
      F.briefingPolish as BriefingPolishV1,
      'items.0.title_tr',
      'Mehmet 17:00’ye kaydırmak istiyor',
    );
    const result = refineBriefingPolishV1(changed, { aliases: ['i1'], originals });
    expect(result.data.items[0]?.title_tr).toBe(originals.i1.title_tr);
    expect(result.dropped[0]?.reason).toBe('number_mismatch');
  });
});

describe('code-built briefing payloads', () => {
  it('checks midday consistency', () => {
    expect(refineMiddayPulseV1(F.middayPulse as MiddayPulseV1).ok).toBe(true);
    expect(
      refineMiddayPulseV1(withPath(F.middayPulse as MiddayPulseV1, 'delta_count', 2)).errors,
    ).toContain('delta_count_mismatch');
    expect(
      refineMiddayPulseV1(withPath(F.middayPulse as MiddayPulseV1, 'headline_key', 'midday.none'))
        .errors,
    ).toContain('headline_mismatch');
    expect(
      refineMiddayPulseV1(withPath(F.middayPulse as MiddayPulseV1, 'local_date', '24.09.2026')).ok,
    ).toBe(false);
  });
  it('checks evening counts', () => {
    expect(refineEveningCloseV1(F.eveningClose as EveningCloseV1).ok).toBe(true);
    expect(
      refineEveningCloseV1(withPath(F.eveningClose as EveningCloseV1, 'counts.carry_over', 3)).ok,
    ).toBe(false);
  });
  it('checks weekly stats invariants', () => {
    expect(refineWeeklyStatsV1(F.weeklyStats as WeeklyStatsV1).ok).toBe(true);
    expect(
      refineWeeklyStatsV1(withPath(F.weeklyStats as WeeklyStatsV1, 'followups_answered', 9)).errors,
    ).toContain('followups_answered_gt_total');
    expect(refineWeeklyStatsV1(withPath(F.weeklyStats as WeeklyStatsV1, 'meetings', 1.5)).ok).toBe(
      false,
    );
    expect(
      refineWeeklyStatsV1(withPath(F.weeklyStats as WeeklyStatsV1, 'busiest_day.weekday', 8)).ok,
    ).toBe(false);
    expect(
      refineWeeklyStatsV1(withPath(F.weeklyStats as WeeklyStatsV1, 'period_end', '2026-09-01'))
        .errors,
    ).toContain('period_order');
  });
});

describe('refineWeeklyReviewV1', () => {
  const ctx = { aliases: ['s1', 's2', 's3', 'f1', 'i2'] };
  it('keeps a focus block on a free-slot ref', () => {
    expect(refineWeeklyReviewV1(F.weeklyReview as WeeklyReviewV1, ctx).data.suggestion.kind).toBe(
      'focus_block',
    );
  });
  it('turns a focus block on a non-slot ref into none', () => {
    const bad = withPath(F.weeklyReview as WeeklyReviewV1, 'suggestion.slot_ref', 'i2');
    expect(refineWeeklyReviewV1(bad, ctx).data.suggestion).toEqual({
      kind: 'none',
      slot_ref: null,
      text_tr: null,
    });
  });
  it('drops narrative sentences past 80 words', () => {
    const long = withPath(F.weeklyReview as WeeklyReviewV1, 'narrative', [
      { text_tr: 'a '.repeat(70), refs: ['s1'] },
      { text_tr: 'b '.repeat(20), refs: ['s1'] },
    ]);
    expect(refineWeeklyReviewV1(long, ctx).data.narrative).toHaveLength(1);
  });
});

describe('refineMeetingPrepV1', () => {
  const data = F.meetingPrep as MeetingPrepV1;
  it('caps talking points at 3 and titles at 24 chars', () => {
    const many = withPath(
      data,
      'talking_points',
      [...data.talking_points, ...data.talking_points].map((p) => ({
        ...p,
        title_tr: 'Çok uzun bir konuşma başlığı burada',
      })),
    );
    const result = refineMeetingPrepV1(many, { aliases: ['m1'] });
    expect(result.data.talking_points).toHaveLength(3);
    expect(result.data.talking_points[0]?.title_tr.length).toBeLessThanOrEqual(24);
  });
  it('fails when no talking point keeps its evidence', () => {
    expect(refineMeetingPrepV1(data, { aliases: ['m9'] }).ok).toBe(false);
  });
  it('caps confidence at medium for an inferred purpose', () => {
    const inferred = withPath(data, 'purpose.basis', 'inferred');
    const result = refineMeetingPrepV1(inferred, { aliases: ['m1'] });
    expect(result.data.confidence).toBe('medium');
    expect(result.data.purpose.evidence).toBeNull();
  });
});

describe('refinePostMeetingCommitmentV1', () => {
  it('accepts evidence on the note only', () => {
    expect(
      refinePostMeetingCommitmentV1(F.postMeeting as PostMeetingCommitmentV1).data.items,
    ).toHaveLength(1);
    const elsewhere = withPath(
      F.postMeeting as PostMeetingCommitmentV1,
      'items.0.evidence.ref',
      'm1',
    );
    expect(refinePostMeetingCommitmentV1(elsewhere).data.items).toEqual([]);
  });
  it('caps at 6 items and drops negated claims', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      ...(F.postMeeting.items[0] as object),
      certainty: i === 0 ? 'negated' : 'explicit',
    }));
    const result = refinePostMeetingCommitmentV1(
      withPath(F.postMeeting as PostMeetingCommitmentV1, 'items', items),
    );
    expect(result.data.items).toHaveLength(5);
  });
});

describe('refineCaptureExtractV1', () => {
  const data = F.captureExtract as CaptureExtractV1;
  it('requires a transcript for vision captures', () => {
    expect(
      refineCaptureExtractV1(data, { aliases: ['img1'], requiresTranscript: true, isLink: false })
        .ok,
    ).toBe(true);
    const noTranscript = withPath(data, 'transcript', []);
    expect(
      refineCaptureExtractV1(noTranscript, {
        aliases: ['img1'],
        requiresTranscript: true,
        isLink: false,
      }).errors,
    ).toContain('transcript_required');
  });
  it('sets link_type only for links', () => {
    expect(
      refineCaptureExtractV1(data, { aliases: ['img1'], requiresTranscript: false, isLink: true })
        .data.link_type,
    ).toBe('other');
    const withLink = withPath(data, 'link_type', 'event');
    expect(
      refineCaptureExtractV1(withLink, {
        aliases: ['img1'],
        requiresTranscript: false,
        isLink: false,
      }).data.link_type,
    ).toBeNull();
  });
  it('clears the due date of an unevidenced suggestion task and caps items at 12', () => {
    const task = {
      kind: 'task',
      title_tr: 'Ödeme yap',
      due_quote: 'Cuma',
      is_suggestion: true,
      section_quote: null,
      evidence: null,
    };
    const items = [task, ...Array.from({ length: 13 }, () => data.items[0])];
    const result = refineCaptureExtractV1(withPath(data, 'items', items), {
      aliases: ['img1'],
      requiresTranscript: false,
      isLink: false,
    });
    expect(result.data.items).toHaveLength(12);
    expect(result.data.items[0]).toMatchObject({ kind: 'task', due_quote: null });
  });
});

describe('assistant refinements', () => {
  it('keeps intent quotes that come from the user message', () => {
    const result = refineAssistantIntentV1(F.assistantIntent as AssistantIntentV1, {
      aliases: ['c1'],
      userMessage: 'Mehmet ile en son ne konuştuk?',
    });
    expect(result.data.person_quote).toBe('Mehmet');
  });
  it('drops invented quotes and unknown target refs', () => {
    const data = withPath(F.assistantIntent as AssistantIntentV1, 'target_ref', 'c9');
    const result = refineAssistantIntentV1(data, {
      aliases: ['c1'],
      userMessage: 'Yarın yoğun muyum?',
    });
    expect(result.data.person_quote).toBeNull();
    expect(result.data.target_ref).toBeNull();
  });
  it('drops uncited grounded sentences and flags unknown', () => {
    const data = withPath<AssistantGroundedJsonV1>(
      F.assistantGrounded,
      'sentences.0.quotes.0.ref',
      'm1',
    );
    const result = refineAssistantGroundedJsonV1(data, { aliases: ['r1', 'm1'] });
    expect(result.data.sentences).toEqual([]);
    expect(result.data.unknown).toBe(true);
  });
  it('removes dangling citations and unverified grounded blocks', () => {
    let data = withPath(
      F.assistantAnswer as AssistantAnswerV1,
      'blocks.0.citations.0.result_index',
      5,
    );
    expect(refineAssistantAnswerV1(data).data.blocks[0]?.citations).toEqual([]);
    data = withPath(F.assistantAnswer as AssistantAnswerV1, 'blocks.0.verified', false);
    const result = refineAssistantAnswerV1(data);
    expect(result.data.blocks).toEqual([]);
    expect(result.data.unknown).toBe(true);
    expect(
      refineAssistantAnswerV1(withPath(F.assistantAnswer as AssistantAnswerV1, 'coverage', 1.2)).ok,
    ).toBe(false);
  });
});

describe('refineReplyDraftsV1 and refineFollowUpDraftV1', () => {
  const thread = 'Merhaba, teklifi Teklif_v2.pdf olarak bekliyoruz. mehmet@yilmaz-endustri.com.tr';
  const ctx = {
    threadText: thread,
    expect: 'all_tones' as const,
    attachmentNames: ['Teklif_v2.pdf'],
  };
  const data = F.replyDrafts as ReplyDraftsV1;

  it('accepts four tones on balanced', () => {
    const result = refineReplyDraftsV1(data, ctx);
    expect(result.errors).toEqual([]);
    expect(result.data.referenced_attachment_names).toEqual(['Teklif_v2.pdf']);
  });
  it('requires exactly the requested tone on lean / regenerate', () => {
    expect(refineReplyDraftsV1(data, { ...ctx, expect: 'short' }).errors).toContain(
      'tone_coverage',
    );
    const single = withPath(data, 'drafts', [data.drafts[1]]);
    expect(refineReplyDraftsV1(single, { ...ctx, expect: 'professional' }).ok).toBe(true);
  });
  it('enforces word caps per tone', () => {
    const long = withPath(data, 'drafts.0.body_tr', 'kelime '.repeat(61));
    expect(refineReplyDraftsV1(long, ctx).errors).toContain('drafts.0.word_cap');
  });
  it('rejects URLs, addresses and phones not in the thread, fill-ins and subject lines', () => {
    expect(draftViolations('Detaylar https://evil.example.com adresinde', thread)).toContain(
      'url_not_in_source',
    );
    expect(draftViolations('Lütfen x@evil.example.com adresine yazın', thread)).toContain(
      'email_not_in_source',
    );
    expect(draftViolations('Beni +90 532 000 00 00 numarasından arayın', thread)).toContain(
      'phone_not_in_source',
    );
    expect(draftViolations('Merhaba [İSİM], teklif ektedir.', thread)).toContain(
      'bracketed_fill_in',
    );
    expect(draftViolations('Konu: Teklif\nMerhaba', thread)).toContain('subject_line');
    expect(
      draftViolations('Merhaba, mehmet@yilmaz-endustri.com.tr adresine ilettim.', thread),
    ).toEqual([]);
  });
  it('removes unknown attachment names', () => {
    const result = refineReplyDraftsV1(
      withPath(data, 'referenced_attachment_names', ['gizli.xlsx']),
      ctx,
    );
    expect(result.data.referenced_attachment_names).toEqual([]);
    expect(result.dropped[0]?.reason).toBe('not_allowed');
  });
  it('caps follow-ups at 80 words', () => {
    expect(refineFollowUpDraftV1(F.followUpDraft, { threadText: thread }).ok).toBe(true);
    const long = { body_tr: 'kelime '.repeat(81), injection_suspected: false };
    expect(refineFollowUpDraftV1(long, { threadText: thread }).errors).toContain('word_cap');
  });
});

import { describe, expect, it } from 'vitest';
import type { LearnedPreference, PriorityRule } from '../../src/entities/intelligence.ts';
import { DECISION_TIER_VALUES, MAIL_CATEGORY_VALUES } from '../../src/enums.ts';
import {
  type AiClassification,
  CATEGORY_PRECEDENCE,
  clampAiConfidence,
  evaluatePriority,
  normalizeAiCategory,
  type PriorityContext,
  type PriorityItem,
  RULE_TEMPLATES,
  selectCategory,
} from '../../src/priority/engine.ts';
import { confidenceLabel, explain } from '../../src/priority/explain.ts';
import { detectSignals, hasUrgencyKeyword } from '../../src/priority/signals.ts';

const USER = 'yunus@example.com';
const TS = '2026-09-01T00:00:00Z';

function rule(
  id: string,
  condition_type: PriorityRule['condition_type'],
  condition_value: Record<string, unknown>,
  outcome: PriorityRule['outcome'],
  extra: Partial<PriorityRule> = {},
): PriorityRule {
  return {
    id,
    user_id: 'u1',
    created_at: TS,
    updated_at: TS,
    condition_type,
    condition_value: condition_value as never,
    outcome,
    search_body: false,
    exceptions: [],
    applies_to: 'mail',
    enabled: true,
    sort_order: 0,
    deleted_at: null,
    ...extra,
  };
}

function learned(
  id: string,
  target_type: LearnedPreference['target_type'],
  target_ref: string,
  priority: 'high' | 'normal' | 'low',
  extra: Partial<LearnedPreference> = {},
): LearnedPreference {
  return {
    id,
    user_id: 'u1',
    created_at: TS,
    updated_at: TS,
    group_key: target_type === 'category' ? 'categories' : 'people',
    statement: 'x',
    target_type,
    target_ref,
    effect: { priority },
    priority_override: null,
    evidence_count: 3,
    evidence_summary: null,
    enabled: true,
    deleted_at: null,
    ...extra,
  };
}

const ctx = (over: Partial<PriorityContext> = {}): PriorityContext => ({
  rules: [],
  learned: [],
  vip: { contactIds: [] },
  isPro: true,
  learnFromInteractions: true,
  ...over,
});

const mail = (over: Partial<PriorityItem> = {}): PriorityItem => ({
  source: 'mail',
  fromEmail: 'ahmet@kuzeylojistik.com.tr',
  toEmails: [USER],
  userAddresses: [USER],
  subject: 'Re: Eylül teklifi – revize',
  ...over,
});

const ai = (category: string, confidence: number, extra: Partial<AiClassification> = {}) => ({
  category,
  confidence,
  ...extra,
});

describe('precedence matrix (UT-PRI-01..17)', () => {
  it('UT-PRI-01: explicit sender rule beats AI low_priority', () => {
    const r = evaluatePriority(
      mail(),
      ctx({
        rules: [
          rule('r1', 'sender', { address: 'ahmet@kuzeylojistik.com.tr' }, 'always_important'),
        ],
      }),
      ai('low_priority', 0.91),
    );
    expect(r).toMatchObject({
      category: 'important',
      decision_tier: 'explicit_rule',
      rule_id: 'r1',
      reason_code: 'rule_sender_always_important',
    });
  });

  it('UT-PRI-02: mute beats AI "important"', () => {
    const r = evaluatePriority(
      mail({ fromEmail: 'kampanya@trendyol.com' }),
      ctx({ rules: [rule('r2', 'sender', { address: 'kampanya@trendyol.com' }, 'mute')] }),
      ai('important', 0.8),
    );
    expect(r).toMatchObject({
      category: 'low_priority',
      importance: 'muted',
      notify: false,
      notify_level: 'never',
      decision_tier: 'explicit_rule',
      urgency: 'low',
    });
  });

  it('UT-PRI-03: domain rule', () => {
    const r = evaluatePriority(
      mail({ fromEmail: 'mehmet@yilmazendustri.com.tr' }),
      ctx({
        rules: [rule('r3', 'domain', { domain: 'yilmazendustri.com.tr' }, 'always_important')],
      }),
    );
    expect(r).toMatchObject({ category: 'important', decision_tier: 'explicit_rule' });
  });

  it('UT-PRI-04: VIP (Pro) raises urgency and always notifies; no effect on Free', () => {
    const item = mail({ fromEmail: 'mehmet@yilmazendustri.com.tr', fromContactId: 'c-mehmet' });
    const pro = evaluatePriority(
      item,
      ctx({ vip: { contactIds: ['c-mehmet'] } }),
      ai('informational', 0.9),
    );
    expect(pro).toMatchObject({
      urgency: 'today',
      notify: true,
      notify_level: 'always',
      decision_tier: 'explicit_rule',
      reason_code: 'vip',
      importance: 'high',
    });
    const free = evaluatePriority(
      item,
      ctx({ vip: { contactIds: ['c-mehmet'] }, isPro: false }),
      ai('informational', 0.9),
    );
    expect(free.decision_tier).toBe('ai_classification');
    expect(free.urgency).toBe('normal');
  });

  it('VIP matched by e-mail address', () => {
    const r = evaluatePriority(
      mail({ fromEmail: 'Selin@Example.com' }),
      ctx({ vip: { contactIds: [], emails: ['selin@example.com'] } }),
    );
    expect(r.reason_code).toBe('vip');
  });

  it('UT-PRI-05: keyword rule after Turkish lower-casing with letter boundaries', () => {
    const rules = [rule('r5', 'keyword', { keywords: ['teklif'] }, 'always_important')];
    expect(evaluatePriority(mail({ subject: 'REVİZE TEKLİF' }), ctx({ rules })).category).toBe(
      'important',
    );
    expect(
      evaluatePriority(mail({ subject: 'teklifsiz görüşme' }), ctx({ rules })).decision_tier,
    ).not.toBe('explicit_rule');
  });

  it('keyword rules search the body only with search_body', () => {
    const rules = [
      rule('r5b', 'keyword', { keywords: ['sözleşme'] }, 'high', { search_body: true }),
    ];
    const r = evaluatePriority(
      mail({ subject: 'Merhaba', bodyText: 'Ekteki sözleşme' }),
      ctx({ rules }),
    );
    expect(r.decision_tier).toBe('explicit_rule');
    const off = [rule('r5c', 'keyword', { keywords: ['sözleşme'] }, 'high')];
    expect(
      evaluatePriority(
        mail({ subject: 'Merhaba', bodyText: 'Ekteki sözleşme' }),
        ctx({ rules: off }),
      ).decision_tier,
    ).not.toBe('explicit_rule');
  });

  it('UT-PRI-06: sender specificity beats domain', () => {
    const r = evaluatePriority(
      mail({ fromEmail: 'a@x.com' }),
      ctx({
        rules: [
          rule('d', 'domain', { domain: 'x.com' }, 'always_important'),
          rule('s', 'sender', { address: 'a@x.com' }, 'mute'),
        ],
      }),
    );
    expect(r.rule_id).toBe('s');
    expect(r.importance).toBe('muted');
  });

  it('specificity order person > sender > domain > vip > keyword > category', () => {
    const item = mail({
      fromEmail: 'a@x.com',
      fromContactId: 'c1',
      subject: 'teklif',
      labels: ['CATEGORY_PROMOTIONS'],
    });
    const rules = [
      rule('cat', 'category', { category: 'promotions' }, 'low'),
      rule('kw', 'keyword', { keywords: ['teklif'] }, 'low'),
      rule('dom', 'domain', { domain: 'x.com' }, 'low'),
      rule('per', 'person', { contact_id: 'c1' }, 'always_important'),
    ];
    expect(evaluatePriority(item, ctx({ rules })).rule_id).toBe('per');
    expect(evaluatePriority(item, ctx({ rules: rules.slice(0, 2) })).rule_id).toBe('kw');
    // VIP sits between domain and keyword
    const vipCtx = ctx({ rules: rules.slice(0, 2), vip: { contactIds: ['c1'] } });
    expect(evaluatePriority(item, vipCtx).reason_code).toBe('vip');
    const domCtx = ctx({ rules: rules.slice(0, 3), vip: { contactIds: ['c1'] } });
    expect(evaluatePriority(item, domCtx).rule_id).toBe('dom');
  });

  it('ties inside one specificity resolve by outcome order', () => {
    const r = evaluatePriority(
      mail({ fromEmail: 'a@x.com' }),
      ctx({
        rules: [
          rule('low', 'domain', { domain: 'x.com' }, 'low'),
          rule('imp', 'domain', { domain: 'x.com' }, 'always_important'),
        ],
      }),
    );
    expect(r.rule_id).toBe('imp');
  });

  it('exceptions are evaluated first', () => {
    const r = evaluatePriority(
      mail({ fromEmail: 'kampanya@x.com', labels: ['CATEGORY_PROMOTIONS'] }),
      ctx({
        rules: [
          rule('d', 'domain', { domain: 'x.com' }, 'always_important', {
            exceptions: [
              { condition_type: 'category', condition_value: { category: 'promotions' } },
            ],
          }),
        ],
      }),
    );
    expect(r.decision_tier).toBe('deterministic_signal');
    expect(r.category).toBe('low_priority');
  });

  it('disabled, deleted and out-of-scope rules are ignored', () => {
    const base = { address: 'ahmet@kuzeylojistik.com.tr' };
    for (const extra of [
      { enabled: false },
      { deleted_at: TS },
      { applies_to: 'android_notification' as const },
    ]) {
      const r = evaluatePriority(
        mail(),
        ctx({ rules: [rule('x', 'sender', base, 'mute', extra)] }),
      );
      expect(r.decision_tier).not.toBe('explicit_rule');
    }
  });

  it('always_notify decides notify only; importance falls through', () => {
    const r = evaluatePriority(
      mail(),
      ctx({
        rules: [rule('n', 'sender', { address: 'ahmet@kuzeylojistik.com.tr' }, 'always_notify')],
      }),
      ai('awaiting_my_reply', 0.9),
    );
    expect(r.decision_tier).toBe('ai_classification');
    expect(r.notify_level).toBe('always');
    expect(r.notify_rule_id).toBe('n');
    expect(r.rule_id).toBeNull();
  });

  it('android_app rules match Android NI packages (app_package template)', () => {
    const t = RULE_TEMPLATES.app_package;
    const r = evaluatePriority(
      { source: 'android_notification', fromEmail: '', appPackage: 'com.akbank.android' },
      ctx({
        rules: [
          rule('a', t.condition_type, { package: 'com.akbank.android' }, 'always_important', {
            applies_to: 'android_notification',
          }),
        ],
      }),
    );
    expect(r.decision_tier).toBe('explicit_rule');
  });

  it('UT-PRI-07/08: learned lower priority applies, explicit rule wins over it', () => {
    const pref = learned('l1', 'category', 'life_event:subscription:netflix', 'low');
    const item = mail({
      fromEmail: 'info@account.netflix.com',
      insightKey: 'life_event:subscription:netflix',
      toEmails: [],
    });
    const r = evaluatePriority(item, ctx({ learned: [pref] }));
    expect(r).toMatchObject({
      decision_tier: 'learned_preference',
      urgency: 'low',
      learned_preference_id: 'l1',
    });
    const withRule = evaluatePriority(
      item,
      ctx({
        learned: [pref],
        rules: [rule('n', 'domain', { domain: 'netflix.com' }, 'always_important')],
      }),
    );
    expect(withRule.decision_tier).toBe('explicit_rule');
  });

  it('learned sender/domain/contact preferences with priority_override', () => {
    const item = mail({ fromEmail: 'bulten@haber.com', fromContactId: 'c9' });
    expect(
      evaluatePriority(item, ctx({ learned: [learned('a', 'domain', 'haber.com', 'low')] }))
        .importance,
    ).toBe('low');
    expect(
      evaluatePriority(item, ctx({ learned: [learned('b', 'sender', 'bulten@haber.com', 'high')] }))
        .importance,
    ).toBe('high');
    const overridden = learned('c', 'contact', 'c9', 'low', { priority_override: 'high' });
    expect(evaluatePriority(item, ctx({ learned: [overridden] })).importance).toBe('high');
    const tomb = learned('d', 'sender', 'bulten@haber.com', 'low', { deleted_at: TS });
    expect(evaluatePriority(item, ctx({ learned: [tomb] })).decision_tier).not.toBe(
      'learned_preference',
    );
  });

  it('UT-PRI-09: learned preferences never apply to a verified security alert', () => {
    const r = evaluatePriority(
      mail({
        fromEmail: 'no-reply@accounts.google.com',
        securityTemplate: true,
        dkimPass: true,
        dkimDomain: 'accounts.google.com',
      }),
      ctx({ learned: [learned('l', 'domain', 'accounts.google.com', 'low')] }),
    );
    expect(r).toMatchObject({
      decision_tier: 'deterministic_signal',
      urgency: 'urgent',
      category: 'important',
    });
  });

  it('safety exclusions: replied-before sender and a deadline today skip learning', () => {
    const pref = [learned('l', 'domain', 'kuzeylojistik.com.tr', 'low')];
    expect(
      evaluatePriority(mail({ repliedBefore: true }), ctx({ learned: pref })).decision_tier,
    ).not.toBe('learned_preference');
    expect(
      evaluatePriority(mail({ verifiedDeadlineInDays: 0 }), ctx({ learned: pref })).decision_tier,
    ).not.toBe('learned_preference');
  });

  it('UT-PRI-10: List-Unsubscribe + Precedence bulk is T0-final low priority', () => {
    const r = evaluatePriority(
      mail({ headers: { listUnsubscribe: true, precedence: 'bulk' } }),
      ctx(),
      ai('important', 0.95),
    );
    expect(r).toMatchObject({
      category: 'low_priority',
      decision_tier: 'deterministic_signal',
      ai_needed: false,
    });
  });

  it('UT-PRI-11: Auto-Submitted is low priority, never awaiting_my_reply', () => {
    const r = evaluatePriority(
      mail({ headers: { autoSubmitted: 'auto-replied' }, awaitingUserReply: true }),
      ctx(),
    );
    expect(r.category).toBe('low_priority');
  });

  it('UT-PRI-12: a security template failing DKIM is informational (anti-phishing)', () => {
    const r = evaluatePriority(
      mail({
        fromEmail: 'alert@g00gle-security.com',
        securityTemplate: true,
        dkimPass: false,
        securityProviderDomain: 'google.com',
      }),
      ctx(),
    );
    expect(r).toMatchObject({ category: 'informational', reason_code: 'security_unverified' });
  });

  it('UT-PRI-13: AI classification with its confidence', () => {
    const r = evaluatePriority(mail(), ctx(), ai('awaiting_my_reply', 0.82));
    expect(r).toMatchObject({
      decision_tier: 'ai_classification',
      confidence: 0.82,
      category: 'awaiting_my_reply',
    });
  });

  it('UT-PRI-14: AI never promotes to important below 0.50', () => {
    const r = evaluatePriority(mail(), ctx(), ai('important', 0.41));
    expect(r).toMatchObject({ category: 'informational', reason_code: 'ai_low_confidence' });
  });

  it('UT-PRI-15: learning off ignores learned preferences', () => {
    const r = evaluatePriority(
      mail(),
      ctx({
        learnFromInteractions: false,
        learned: [learned('l', 'domain', 'kuzeylojistik.com.tr', 'low')],
      }),
      ai('important', 0.9),
    );
    expect(r.decision_tier).toBe('ai_classification');
  });

  it('UT-PRI-16: interest categories raise urgency only in the deterministic step', () => {
    const r = evaluatePriority(mail({ interestMatch: true, transactional: true }), ctx());
    expect(r.urgency).toBe('today');
    const ruled = evaluatePriority(
      mail({ interestMatch: true }),
      ctx({ rules: [rule('l', 'sender', { address: 'ahmet@kuzeylojistik.com.tr' }, 'low')] }),
    );
    expect(ruled.urgency).toBe('normal');
  });

  it('deterministic informational baselines: noreply, CATEGORY_UPDATES, Cc-only unknown', () => {
    expect(evaluatePriority(mail({ fromEmail: 'noreply@banka.com.tr' }), ctx()).reason_code).toBe(
      'noreply_sender',
    );
    expect(evaluatePriority(mail({ labels: ['CATEGORY_UPDATES'] }), ctx()).category).toBe(
      'informational',
    );
    const cc = evaluatePriority(
      mail({ toEmails: ['x@y.com'], ccEmails: [USER] }),
      ctx(),
      ai('important', 0.9),
    );
    expect(cc).toMatchObject({ category: 'informational', reason_code: 'cc_only_unknown' });
    const knownCc = evaluatePriority(
      mail({ toEmails: ['x@y.com'], ccEmails: [USER], knownContact: true }),
      ctx(),
      ai('important', 0.9),
    );
    expect(knownCc.decision_tier).toBe('ai_classification');
  });

  it('a verified deadline today sets has_deadline and urgency today', () => {
    const r = evaluatePriority(mail({ verifiedDeadlineInDays: 0 }), ctx());
    expect(r).toMatchObject({ category: 'has_deadline', urgency: 'today', ai_needed: true });
  });

  it('with no signal and no AI result the item waits for AI', () => {
    const r = evaluatePriority(mail(), ctx());
    expect(r).toMatchObject({
      ai_needed: true,
      reason_code: 'pending_ai',
      category: 'informational',
    });
    const awaiting = evaluatePriority(mail({ awaitingUserReply: true }), ctx());
    expect(awaiting).toMatchObject({ category: 'awaiting_my_reply', realtime: true });
  });

  it('urgency keywords trigger real-time triage (not for bulk)', () => {
    expect(evaluatePriority(mail({ subject: 'ACİL: imza' }), ctx()).realtime).toBe(true);
    expect(
      evaluatePriority(mail({ subject: 'ACİL indirim', headers: { listUnsubscribe: true } }), ctx())
        .realtime,
    ).toBe(false);
    expect(hasUrgencyKeyword('Yarın sabah dönüş yapar mısın?')).toBe(true);
    expect(hasUrgencyKeyword('Merhaba')).toBe(false);
  });

  it('UT-PRI-17: property — random mixes are deterministic with a valid tier and reason', () => {
    let seed = 20260923;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
    for (let i = 0; i < 500; i++) {
      const item = mail({
        fromEmail: pick(['a@x.com', 'noreply@x.com', 'b@y.com']),
        fromContactId: pick(['c1', null]),
        labels: rnd() < 0.3 ? [pick(['CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'INBOX'])] : [],
        headers: { listUnsubscribe: rnd() < 0.2, precedence: rnd() < 0.1 ? 'bulk' : null },
        verifiedDeadlineInDays: rnd() < 0.2 ? pick([0, 1, 5]) : null,
        securityTemplate: rnd() < 0.1,
        dkimPass: rnd() < 0.5,
        dkimDomain: 'x.com',
        repliedBefore: rnd() < 0.2,
      });
      const c = ctx({
        rules:
          rnd() < 0.4
            ? [
                rule(
                  'r',
                  pick(['sender', 'domain'] as const),
                  { address: 'a@x.com', domain: 'x.com' },
                  pick(['mute', 'high', 'low', 'always_notify'] as const),
                ),
              ]
            : [],
        learned:
          rnd() < 0.4
            ? [learned('l', 'domain', pick(['x.com', 'y.com']), pick(['low', 'high'] as const))]
            : [],
        vip: { contactIds: rnd() < 0.3 ? ['c1'] : [] },
        isPro: rnd() < 0.5,
        learnFromInteractions: rnd() < 0.7,
      });
      const a =
        rnd() < 0.6
          ? ai(pick(['important', 'IMPORTANT', 'reply_needed', 'garbage', 'low_priority']), rnd())
          : null;
      const r1 = evaluatePriority(item, c, a);
      const r2 = evaluatePriority(item, c, a);
      expect(r1).toEqual(r2);
      expect(DECISION_TIER_VALUES).toContain(r1.decision_tier);
      expect(MAIL_CATEGORY_VALUES).toContain(r1.category);
      expect(r1.reason_code).toMatch(/^[a-z_]{3,48}$/);
    }
  });
});

describe('classification normalisation (UT-CLS-01..04, 08)', () => {
  it.each([
    ['IMPORTANT', 'important', 'exact'],
    ['important ', 'important', 'exact'],
    ['Önemli', 'important', 'alias'],
    ['reply_needed', 'awaiting_my_reply', 'alias'],
    ['low-priority', 'low_priority', 'exact'],
    ['urgent_spam', 'informational', 'fallback'],
  ])('%s → %s (%s)', (label, cat, how) => {
    expect(normalizeAiCategory(label)).toEqual({ category: cat, normalization: how });
  });

  it('confidence clamping', () => {
    expect(clampAiConfidence(1.2)).toBe(1);
    expect(clampAiConfidence(-0.1)).toBe(0);
    expect(clampAiConfidence(Number.NaN)).toBe(0);
  });

  it('exclusive category precedence', () => {
    expect(CATEGORY_PRECEDENCE[0]).toBe('awaiting_my_reply');
    expect(selectCategory(['important', 'has_deadline', 'awaiting_my_reply'])).toBe(
      'awaiting_my_reply',
    );
    expect(selectCategory(['important', 'has_deadline'])).toBe('has_deadline');
    expect(selectCategory(['low_priority', 'informational'])).toBe('informational');
    expect(selectCategory([])).toBe('informational');
  });
});

describe('signals', () => {
  it('detects bulk, ESP and Gmail categories', () => {
    expect(
      detectSignals({
        fromEmail: 'news@shop.com',
        dkimDomain: 'mcsv.net',
        labels: ['CATEGORY_SOCIAL', 'CATEGORY_FORUMS'],
        headers: { autoSubmitted: 'auto-generated', precedence: 'list' },
      }),
    ).toEqual([
      'precedence_bulk',
      'auto_submitted',
      'category_social',
      'category_forums',
      'esp_bulk',
    ]);
  });

  it('Auto-Submitted: no is not automated', () => {
    expect(detectSignals({ fromEmail: 'a@b.com', headers: { autoSubmitted: 'no' } })).toEqual([]);
  });
});

describe('explain() → i18n keys (§7.7)', () => {
  it('explicit rule', () => {
    const r = evaluatePriority(
      mail(),
      ctx({
        rules: [rule('r1', 'domain', { domain: 'kuzeylojistik.com.tr' }, 'always_important')],
      }),
    );
    const e = explain(r, { ruleTitle: '@kuzeylojistik.com.tr adresinden gelenler' });
    expect(e.heading.key).toBe('explain.tier.explicit_rule');
    expect(e.reason).toEqual({
      key: 'explain.reason.rule',
      params: { rule: '@kuzeylojistik.com.tr adresinden gelenler', outcome: 'always_important' },
    });
    expect(e.corrections).toEqual([
      'not_important',
      'show_more',
      'make_vip',
      'stop_tracking',
      'create_rule',
    ]);
  });

  it('VIP, learned, signal and AI reasons', () => {
    const vip = evaluatePriority(mail({ fromContactId: 'c' }), ctx({ vip: { contactIds: ['c'] } }));
    expect(explain(vip, { personName: 'Mehmet Yılmaz' }).reason).toEqual({
      key: 'explain.reason.vip',
      params: { name: 'Mehmet Yılmaz' },
    });
    const lp = evaluatePriority(
      mail({ fromEmail: 'b@haber.com' }),
      ctx({ learned: [learned('l', 'domain', 'haber.com', 'low')] }),
    );
    expect(
      explain(lp, { learnedStatement: 'Toplu bültenler düşük öncelikli', learnedEvidence: '3 kez' })
        .reason.key,
    ).toBe('explain.reason.learned');
    const sig = evaluatePriority(mail({ headers: { listUnsubscribe: true } }), ctx());
    expect(explain(sig).reason.key).toBe('explain.signal.list_unsubscribe');
    const aiRes = evaluatePriority(mail(), ctx(), ai('important', 0.78));
    const e = explain(aiRes);
    expect(e.reason).toEqual({
      key: 'explain.reason.ai',
      params: { reason: 'ai_classification', confidence: 'medium' },
    });
    expect(e.details.map((d) => d.key)).toEqual(['explain.confidence.medium']);
  });

  it('notify rules add a detail line', () => {
    const r = evaluatePriority(
      mail(),
      ctx({
        rules: [rule('n', 'sender', { address: 'ahmet@kuzeylojistik.com.tr' }, 'always_notify')],
      }),
      ai('important', 0.95),
    );
    expect(explain(r).details.map((d) => d.key)).toEqual(['explain.notify.always']);
  });

  it('confidence bands (UT-GRD-14 thresholds)', () => {
    expect(confidenceLabel(0.85)).toBe('high');
    expect(confidenceLabel(0.84)).toBe('medium');
    expect(confidenceLabel(0.7)).toBe('medium');
    expect(confidenceLabel(0.69)).toBe('low');
  });
});

/**
 * Notification triggers (API_CONTRACTS JOB-10 `notification`; M§86): the user test push renders a
 * realistic demo for every category (SCREEN_AND_FLOW_MAP §12.3 #8, EF-NTF-01) with the "Test"
 * prefix except in `generic`; the admin test push is generic (IT-NTF-07); follow-up nudges carry
 * the waiting days and a 12 h validity; briefing pushes follow the briefing kind and counts.
 */
import { assert, assertEquals } from '@std/assert';
import { NOTIFICATION_CATEGORY_VALUES } from '@da/domain';
import { renderNotification } from '../render.ts';
import { briefingJob, briefingTrigger, headlineCount } from './briefing.ts';
import { FOLLOW_UP_VALID_MS, followUpTrigger } from './follow-up.ts';
import { adminTestSpec, userTestTrigger } from './test-push.ts';
import type { BriefingInfo, InsightInfo, TriggerContext, TriggerRepo } from './types.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-09-24T06:30:00.000Z');
const BRIEFING = '77777777-0000-4000-8000-000000000001';
const THREAD = '88888888-0000-4000-8000-000000000001';

function ctx(
  payload: TriggerContext['payload'],
  repo: Partial<TriggerRepo> = {},
  isPro = true,
): TriggerContext {
  return {
    repo: repo as TriggerRepo,
    userId: USER,
    payload,
    now: NOW,
    timeZone: 'Europe/Istanbul',
    locale: 'tr',
    isPro,
    jobKey: 'notification:test:1',
  };
}

Deno.test(
  'test push (EF-NTF-01): every category renders a demo push with the test prefix',
  async () => {
    for (const category of NOTIFICATION_CATEGORY_VALUES) {
      const out = await userTestTrigger(
        ctx({
          trigger: 'user_test',
          category,
          notification_id: 'n1',
          installation_id: 'inst-row',
        } as never),
      );
      assert(out.kind === 'spec', category);
      const spec = out.spec;
      assertEquals(
        [
          spec.category,
          spec.isTest,
          spec.userTest,
          spec.urgency,
          spec.installationRowId,
          spec.dedupeKey,
        ],
        [category, true, true, 'urgent', 'inst-row', 'notification:test:1'],
      );
      for (const mode of ['full', 'title_only', 'generic'] as const) {
        const r = renderNotification(spec, mode, 'tr');
        assert(
          r.title.length > 0 && !/\{|\}/.test(r.title + r.body),
          `${category}/${mode}: ${r.title} — ${r.body}`,
        );
      }
      const generic = renderNotification(spec, 'generic', 'tr').title;
      const full = renderNotification(spec, 'full', 'tr').title;
      assert(full !== generic, `${category}: the test prefix applies outside generic`);
    }
    const missing = await userTestTrigger(ctx({ trigger: 'user_test' } as never));
    assertEquals(missing, { kind: 'skip', reason: 'missing_test_target' });
  },
);

Deno.test('test push (IT-NTF-07): the admin test push is the generic account template', () => {
  const spec = adminTestSpec(
    ctx({ trigger: 'admin_test', installation_id: 'inst-row' } as never),
    'job-9',
  );
  assertEquals(
    [spec.category, spec.kind, spec.dedupeKey, spec.isTest, spec.userTest, spec.installationRowId],
    ['account', 'admin_test', 'admin_test_push:job-9', true, false, 'inst-row'],
  );
  assertEquals(spec.paramsSensitive, {}, 'no user data in an admin test push');
});

function insight(overrides: Partial<InsightInfo> = {}): InsightInfo {
  return {
    id: '99999999-0000-4000-8000-000000000001',
    kind: 'follow_up',
    status: 'open',
    title: 'Teklif dönüşü',
    urgency: 'today',
    entity_type: 'email_thread',
    entity_id: THREAD,
    due_at: null,
    event_at: '2026-09-21T06:00:00.000Z',
    created_at: '2026-09-22T06:00:00.000Z',
    person: 'Mehmet Yılmaz',
    ...overrides,
  };
}

Deno.test(
  'follow-up trigger: waiting days since the awaited message, person when known, 12 h validity',
  async () => {
    const repo = {
      insight: (_u: string, id: string) =>
        Promise.resolve(
          id === 'missing'
            ? null
            : id === 'done'
              ? insight({ status: 'done' })
              : id === 'urgent'
                ? insight({ urgency: 'urgent', person: null, event_at: null })
                : insight(),
        ),
    };
    const out = await followUpTrigger(
      ctx({ trigger: 'follow_up', insight_id: 'i1' } as never, repo),
    );
    assert(out.kind === 'spec');
    assertEquals(
      [out.spec.paramsPublic, out.spec.paramsSensitive],
      [{ days: 3 }, { subject: 'Teklif dönüşü', person: 'Mehmet Yılmaz' }],
    );
    assertEquals(out.spec.validUntil?.getTime(), NOW.getTime() + FOLLOW_UP_VALID_MS);
    assertEquals(
      [out.spec.urgency, out.spec.entityType, out.spec.entitled],
      ['today', 'email_thread', true],
    );
    assert(out.spec.dedupeKey.includes('2026-09-24'), 'one nudge per insight per local day');
    const urgent = await followUpTrigger(
      ctx({ trigger: 'follow_up', insight_id: 'urgent' } as never, repo, false),
    );
    assert(urgent.kind === 'spec');
    assertEquals(
      [
        urgent.spec.urgency,
        urgent.spec.paramsPublic,
        urgent.spec.paramsSensitive,
        urgent.spec.entitled,
      ],
      ['urgent', { days: 2 }, { subject: 'Teklif dönüşü' }, false],
    );
    assertEquals(await followUpTrigger(ctx({ trigger: 'follow_up' } as never, repo)), {
      kind: 'skip',
      reason: 'missing_insight',
    });
    assertEquals(
      await followUpTrigger(ctx({ trigger: 'follow_up', insight_id: 'missing' } as never, repo)),
      { kind: 'skip', reason: 'not_open' },
    );
    assertEquals(
      await followUpTrigger(ctx({ trigger: 'follow_up', insight_id: 'done' } as never, repo)),
      { kind: 'skip', reason: 'not_open' },
    );
  },
);

function briefing(overrides: Partial<BriefingInfo>): BriefingInfo {
  return {
    id: BRIEFING,
    kind: 'morning',
    status: 'ready',
    scheduled_for: '2026-09-24T05:00:00.000Z',
    headline: 'Mehmet Bey teklif bekliyor',
    counts: { headline: 3 },
    weekly_stats: null,
    ...overrides,
  };
}

Deno.test(
  'briefing trigger: variants per kind, weekly stats, midday without delta is skipped',
  async () => {
    assertEquals(headlineCount({ total: 4.4 }), 4);
    assertEquals(headlineCount({ important: 2, meetings: 3, bad: 'x' }), 5);
    assertEquals(headlineCount({}), 0);
    const job = briefingJob(USER, BRIEFING);
    assertEquals([job.type, job.idempotencyKey], ['notification', `briefing_notify:${BRIEFING}`]);

    let current = briefing({});
    const delivered: string[] = [];
    const repo = {
      briefing: () => Promise.resolve(current),
      markBriefingDelivered: (_u: string, id: string, at: Date) => {
        delivered.push(`${id}@${at.toISOString()}`);
        return Promise.resolve();
      },
    };
    const run = async () =>
      await briefingTrigger(
        ctx({ trigger: 'briefing', briefing_id: BRIEFING } as never, repo, false),
      );

    const morning = await run();
    assert(morning.kind === 'spec');
    assertEquals(
      [
        morning.spec.category,
        morning.spec.variant,
        morning.spec.paramsPublic,
        morning.spec.entitled,
      ],
      ['morning', 'ready', { count: 3 }, true],
    );
    assertEquals(morning.spec.scheduledFor?.toISOString(), '2026-09-24T05:00:00.000Z');
    assertEquals(morning.spec.paramsSensitive, { highlights: 'Mehmet Bey teklif bekliyor' });
    await morning.onSent?.(NOW);
    assertEquals(delivered, [`${BRIEFING}@${NOW.toISOString()}`]);

    current = briefing({ counts: {}, headline: null });
    const calm = await run();
    assert(calm.kind === 'spec');
    assertEquals([calm.spec.variant, calm.spec.paramsSensitive], ['calm', {}]);

    current = briefing({ kind: 'evening', counts: { carry_over: 0 } });
    const clear = await run();
    assert(clear.kind === 'spec');
    assertEquals(
      [clear.spec.variant, clear.spec.entitled],
      ['clear', false],
      'evening pushes need Pro',
    );
    current = briefing({ kind: 'evening', counts: { carry_over: 2 } });
    const eveningReady = await run();
    assert(eveningReady.kind === 'spec' && eveningReady.spec.variant === 'ready');

    current = briefing({ kind: 'midday', counts: { delta_count: 0 } });
    assertEquals(await run(), { kind: 'skip', reason: 'no_meaningful_delta' });
    current = briefing({ kind: 'midday', counts: { delta_count: 2 } });
    const midday = await run();
    assert(midday.kind === 'spec' && midday.spec.paramsPublic.count === 2);

    current = briefing({
      kind: 'weekly',
      counts: {},
      weekly_stats: { important_subjects: 7, meetings: 12, follow_ups: 3 },
    });
    const weekly = await run();
    assert(weekly.kind === 'spec');
    assertEquals(
      [weekly.spec.category, weekly.spec.template, weekly.spec.paramsPublic],
      ['evening', 'weekly', { important: 7, meetings: 12, followups: 3 }],
    );
    assert(String(weekly.spec.deeplink).includes('weekly'));
    current = briefing({ kind: 'weekly', weekly_stats: null });
    const bare = await run();
    assert(bare.kind === 'spec');
    assertEquals(bare.spec.paramsPublic, { important: 0, meetings: 0, followups: 0 });

    current = briefing({ status: 'generating' });
    assertEquals(await run(), { kind: 'skip', reason: 'not_ready' });
    assertEquals(await briefingTrigger(ctx({ trigger: 'briefing' } as never, repo)), {
      kind: 'skip',
      reason: 'missing_briefing',
    });
  },
);

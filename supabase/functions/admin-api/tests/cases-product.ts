/** ADM-13 feedback, ADM-14 feature flags, ADM-15 announcements: SQL-shaped outputs and responses. */
import { assert, assertEquals } from '@std/assert';
import { SqlError } from './harness.ts';
import { argsOf, type Cases, data, LATER, REASON, rows, TS, uuid } from './case-helpers.ts';

const sqlFeedback = (extra: Record<string, unknown> = {}) => ({
  id: uuid(83),
  user_id: uuid(2),
  type: 'ai_quality',
  rating: 2,
  message: 'Özet eksik.',
  screen: 'M-TD-01',
  contact_email_masked: 'yu***@gmail.com',
  diagnostics_consent: true,
  platform: 'ios',
  app_version: '1.0.0',
  status: 'new',
  assigned_admin_id: null,
  created_at: TS,
  updated_at: TS,
  ...extra,
});

/** `private.flag_json` (+ list extras). */
const sqlFlag = (extra: Record<string, unknown> = {}) => ({
  key: 'feature.midday',
  description: 'Öğle özeti',
  enabled: true,
  is_kill_switch: false,
  rollout_percent: 100,
  platforms: ['ios', 'android'],
  plans: ['pro'],
  min_version: '1.0.0',
  max_version: null,
  payload: null,
  archived_at: null,
  updated_by: uuid(100),
  updated_at: TS,
  ...extra,
});

/** `private.announcement_json`. */
const sqlAnnouncement = (extra: Record<string, unknown> = {}) => ({
  id: uuid(3),
  title_tr: 'Yeni: Öğle özeti',
  title_en: 'New: Midday pulse',
  body_tr: 'Öğle saatinde yalnızca değişenleri özetliyoruz.',
  body_en: 'At midday we summarise only what changed.',
  audience: 'all',
  platforms: ['ios', 'android'],
  min_version: null,
  max_version: null,
  starts_at: TS,
  ends_at: null,
  severity: 'info',
  cta_deeplink: 'dijitalasistan://briefing/latest',
  status: 'live',
  published_at: TS,
  cancelled_at: null,
  created_by: uuid(100),
  updated_by: uuid(100),
  created_at: TS,
  updated_at: TS,
  ...extra,
});

export const PRODUCT_CASES: Cases = {
  'GET /feedback': {
    sql: {
      feedback_list: () => ({ rows: [sqlFeedback()], total: 1, page: 1, page_size: 25 }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'feedback_list')?.p_filter, { type: 'ai_quality' });
      const row = rows(body)[0] ?? {};
      assertEquals(row.user_email_masked, 'yu***@gmail.com');
      assert(!('user_id' in row) && !('diagnostics_consent' in row));
    },
  },
  'GET /feedback/summary': {
    sql: {
      feedback_summary: () => ({
        range: '30d',
        by_type: { bug: 3, feature: 2, general: 1, ai_quality: 4 },
        rating_distribution: { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, unrated: 0 },
        by_app_version: [
          { app_version: '1.0.0', count: 10 },
          { app_version: null, count: 1 },
        ],
        by_status: { new: 5, triaged: 3, planned: 1, closed: 1 },
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'feedback_summary')?.p_filter, { platform: 'android' });
      assertEquals(data(body).by_app_version, [
        { app_version: '1.0.0', count: 10 },
        { app_version: 'unknown', count: 1 },
      ]);
    },
  },
  'PATCH /feedback/:id': {
    sql: { feedback_update: () => sqlFeedback({ status: 'triaged', type: 'bug', rating: null }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'feedback_update'), {
        p_id: uuid(83),
        p_status: 'triaged',
        p_assignee: null,
        p_reason: null,
      });
      assertEquals(data(body).status, 'triaged');
    },
  },
  'POST /feedback/:id/reveal': {
    sql: {
      feedback_reveal: () => ({
        value: { message: 'Özet eksik', contact_email: 'yunus@gmail.com' },
        expires_in_s: 60,
      }),
    },
    expect(_h, body) {
      assertEquals(data(body), { value: 'Özet eksik\n\nyunus@gmail.com', expires_in_s: 60 });
    },
  },
  'GET /flags': {
    sql: { flags_list: () => ({ rows: [{ ...sqlFlag(), override_count: 2 }] }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'flags_list'), { p_filter: { archived: true } });
      assert(
        !('override_count' in (rows(body)[0] ?? {})) && !('description' in (rows(body)[0] ?? {})),
      );
    },
  },
  'GET /flags/:key': {
    sql: {
      flag_get: () => ({
        ...sqlFlag({ is_kill_switch: true }),
        overrides: [
          {
            id: uuid(140),
            user_id: uuid(2),
            email_masked: 'yu***@gmail.com',
            enabled: true,
            expires_at: null,
            created_at: TS,
          },
        ],
        history: [
          {
            ts: TS,
            actor: null,
            action: 'flag.updated',
            reason: REASON,
            before: { enabled: false },
            after: { enabled: true },
          },
        ],
      }),
    },
    expect(_h, body) {
      const d = data(body);
      assertEquals((d.history as Record<string, unknown>[])[0]?.actor, 'system');
      assertEquals((d.overrides as Record<string, unknown>[])[0]?.enabled, true);
    },
  },
  'GET /flags/:key/evaluate': {
    sql: {
      flag_evaluate_preview: () => ({
        key: 'feature.midday',
        value: true,
        matched_rule: 'plan',
        bucket: 42,
        user_id: uuid(2),
        platform: 'ios',
        app_version: '1.0.0',
      }),
    },
    expect(h) {
      assertEquals(argsOf(h, 'flag_evaluate_preview'), {
        p_key: 'feature.midday',
        p_user: uuid(2),
        p_platform: 'ios',
        p_app_version: null,
      });
    },
  },
  'POST /flags': {
    sql: {
      flag_get: () => {
        throw new SqlError('P0002', 'NOT_FOUND');
      },
      flag_upsert: () =>
        sqlFlag({
          key: 'ai.budget.org_daily_usd',
          enabled: false,
          rollout_percent: 0,
          platforms: [],
          plans: [],
          payload: { usd: 50 },
        }),
    },
    expect(h, body) {
      const args = argsOf(h, 'flag_upsert') ?? {};
      assertEquals(
        [args.p_key, args.p_enabled, args.p_payload, args.p_reason],
        ['ai.budget.org_daily_usd', false, { usd: 50 }, REASON],
      );
      assertEquals(data(body).key, 'ai.budget.org_daily_usd');
    },
  },
  'PATCH /flags/:key': {
    sql: {
      flag_get: () => sqlFlag(),
      flag_upsert: () => sqlFlag({ rollout_percent: 50 }),
    },
    expect(h, body) {
      const args = argsOf(h, 'flag_upsert') ?? {};
      assertEquals(
        args.p_platforms,
        ['ios', 'android'],
        'targeting is merged with the stored flag',
      );
      assertEquals([args.p_plans, args.p_min_ver, args.p_rollout], [['pro'], '1.0.0', 50]);
      assertEquals(data(body).rollout_percent, 50);
    },
  },
  'POST /flags/:key/kill': {
    sql: {
      flag_kill: () => sqlFlag({ key: 'ai.global.enabled', enabled: false, is_kill_switch: true }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'flag_kill'), {
        p_key: 'ai.global.enabled',
        p_reason: REASON,
        p_on: true,
      });
      assertEquals(data(body).enabled, false);
    },
  },
  'POST /flags/:key/archive': {
    sql: {
      flag_archive: () => sqlFlag({ key: 'feature.old_banner', enabled: false, archived_at: TS }),
    },
    expect(h) {
      assertEquals(argsOf(h, 'flag_archive'), { p_key: 'feature.old_banner', p_reason: REASON });
    },
  },
  'POST /flags/:key/overrides': {
    sql: {
      flag_override_set: () => ({
        id: uuid(140),
        flag_key: 'feature.midday',
        user_id: uuid(2),
        value: true,
        expires_at: null,
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'flag_override_set'), {
        p_key: 'feature.midday',
        p_user: uuid(2),
        p_value: true,
        p_reason: REASON,
        p_expires: null,
      });
      assertEquals(data(body), { key: 'feature.midday', user_id: uuid(2), enabled: true });
    },
  },
  'DELETE /flags/:key/overrides/:userId': {
    sql: { flag_override_delete: () => ({ deleted: true, override_id: uuid(140) }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'flag_override_delete'), {
        p_key: 'feature.midday',
        p_user: uuid(2),
        p_reason: 'flag override removed by an admin',
      });
      assertEquals(data(body), { key: 'feature.midday', user_id: uuid(2), enabled: null });
    },
  },
  'GET /announcements': {
    sql: {
      announcements_list: () => ({
        rows: [
          sqlAnnouncement(),
          sqlAnnouncement({ id: uuid(4), starts_at: '2026-09-20T08:00:00Z' }),
        ],
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'announcements_list'), { p_filter: { status: 'live' } });
      assertEquals(
        rows(body).map((r) => r.id),
        [uuid(3), uuid(4)],
      );
      assertEquals(body.meta.total, 2);
      assert(!('body_tr' in (rows(body)[0] ?? {})));
    },
  },
  'POST /announcements/audience-estimate': {
    sql: { announcement_audience_estimate: () => ({ estimated_users: 1200 }) },
    expect(h) {
      assertEquals(argsOf(h, 'announcement_audience_estimate'), {
        p_audience: 'free',
        p_platforms: ['android'],
        p_min_version: null,
        p_max_version: null,
      });
    },
  },
  'GET /announcements/:id': {
    sql: { announcement_get: () => ({ ...sqlAnnouncement(), dismissal_count: 12 }) },
    expect(_h, body) {
      assertEquals(data(body).cta_route, '/briefing/latest');
      assertEquals(data(body).dismissal_count, 12);
    },
  },
  'POST /announcements': {
    sql: { announcement_upsert: () => sqlAnnouncement({ status: 'draft', published_at: null }) },
    expect(h, body) {
      const args = argsOf(h, 'announcement_upsert') ?? {};
      assertEquals(args.p_id, null);
      const fields = args.p_fields as Record<string, unknown>;
      assertEquals(fields.cta_deeplink, 'dijitalasistan://briefing/latest');
      assert(!('cta_route' in fields));
      assertEquals(args.p_reason, 'announcement draft created');
      assertEquals(data(body).status, 'draft');
    },
  },
  'PATCH /announcements/:id': {
    sql: { announcement_upsert: () => sqlAnnouncement({ body_tr: 'Güncellendi.' }) },
    expect(h) {
      assertEquals(argsOf(h, 'announcement_upsert'), {
        p_id: uuid(3),
        p_fields: { body_tr: 'Güncellendi.' },
        p_reason: 'announcement draft edited',
      });
    },
  },
  'POST /announcements/:id/preview': {
    sql: {
      announcement_get: () => ({ ...sqlAnnouncement({ ends_at: LATER }), dismissal_count: 0 }),
    },
    expect(_h, body) {
      assertEquals(data(body), {
        id: uuid(3),
        title: 'Yeni: Öğle özeti',
        body: 'Öğle saatinde yalnızca değişenleri özetliyoruz.',
        cta_route: '/briefing/latest',
        ends_at: LATER,
      });
    },
  },
  'POST /announcements/:id/schedule': {
    sql: { announcement_publish: () => sqlAnnouncement({ status: 'scheduled', starts_at: LATER }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'announcement_publish'), {
        p_id: uuid(3),
        p_reason: REASON,
        p_now_live: false,
      });
      assertEquals(data(body).status, 'scheduled');
    },
  },
  'POST /announcements/:id/cancel': {
    sql: { announcement_cancel: () => sqlAnnouncement({ status: 'cancelled', cancelled_at: TS }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'announcement_cancel'), { p_id: uuid(3), p_reason: REASON });
      assertEquals(data(body).status, 'cancelled');
    },
  },
};

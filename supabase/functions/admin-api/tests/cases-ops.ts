/**
 * ADM-04 integrations, ADM-05 jobs, ADM-06/07 briefings and notifications, ADM-11/12 subscriptions
 * and referrals, ADM-16/17 data requests and audit: SQL-shaped outputs and mapped responses.
 */
import { assert, assertEquals } from '@std/assert';
import {
  argsOf,
  type Cases,
  data,
  LATER,
  pokes,
  REASON,
  rows,
  sqlAuditRow,
  sqlPage,
  TS,
  uuid,
} from './case-helpers.ts';

const sqlAccount = {
  account_id: uuid(10),
  user_id: uuid(2),
  provider: 'microsoft',
  email_masked: 'yu***@outlook.com',
  status: 'needs_reauth',
  status_reason: 'invalid_grant',
  last_sync_at: TS,
  last_error_code: 'PROVIDER_REAUTH_REQUIRED',
  watch_expires_at: null,
  key_version: 1,
};

const sqlJob = (extra: Record<string, unknown> = {}) => ({
  id: uuid(70),
  type: 'approval_execute',
  status: 'dead_letter',
  attempts: 5,
  max_attempts: 5,
  last_error_code: 'PROVIDER_UNAVAILABLE',
  run_after: TS,
  created_at: TS,
  updated_at: TS,
  correlation_id: '77777777-7777-4777-8777-777777777777',
  user_id: uuid(2),
  connected_account_id: null,
  ...extra,
});

const CORRELATION = '77777777-7777-4777-8777-777777777777';

const INTEGRATION_CASES: Cases = {
  'GET /integrations': {
    sql: { integrations_overview: () => sqlPage([sqlAccount]) },
    expect(h, body) {
      assertEquals(argsOf(h, 'integrations_overview')?.p_filter, { issue: 'needs_reconnect' });
      const row = rows(body)[0] ?? {};
      assert(!('status_reason' in row));
      assertEquals(row.key_version, 1);
    },
  },
  'GET /integrations/summary': {
    sql: {
      integrations_summary: () => ({
        range: '24h',
        by_provider_status: [{ provider: 'google', status: 'healthy', count: 10 }],
        watches_expiring_24h: 1,
        watch_renewals_failed_24h: 0,
        oldest_healthy_last_sync_at: TS,
        reconnect_rate: null,
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'integrations_summary'), { p_range: '24h' });
      assertEquals(data(body).reconnect_rate, 0);
    },
  },
  'GET /integrations/:accountId': {
    sql: {
      integration_detail: () => ({
        ...sqlAccount,
        user: { id: uuid(2), email_masked: 'yu***@outlook.com' },
        granted_scopes: ['Mail.Read', 'offline_access'],
        capabilities_granted: ['mail_read'],
        sync_states: [
          {
            id: uuid(20),
            resource: 'graph_mail_inbox',
            status: 'error',
            last_success_at: TS,
            last_full_sync_at: TS,
            last_error_code: 'PROVIDER_REAUTH_REQUIRED',
            consecutive_failures: 2,
            watch_kind: 'graph_subscription',
            watch_expires_at: null,
            watch_renew_after: null,
            lifecycle_last_event: null,
          },
        ],
        jobs: [
          {
            id: uuid(70),
            type: 'outlook_sync',
            status: 'failed',
            last_error_code: 'PROVIDER_REAUTH_REQUIRED',
            created_at: TS,
          },
        ],
        webhooks: { received_7d: 30, rejected_7d: 0, last_received_at: TS },
        webhook_stats: { received_24h: 10, unmatched_24h: 1, last_received_at: TS },
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'integration_detail'), { p_account: uuid(10) });
      const d = data(body);
      assertEquals(d.webhook_stats, { received_24h: 10, unmatched_24h: 1, last_received_at: TS });
      assertEquals((d.sync_states as Record<string, unknown>[])[0]?.resource, 'graph_mail_inbox');
      assertEquals((d.account as Record<string, unknown>).user_id, uuid(2));
    },
  },
  'POST /integrations/:accountId/force-sync': {
    sql: {
      integration_detail: () => ({ ...sqlAccount, user_id: uuid(2) }),
      user_force_sync: () => ({
        job_ids: [uuid(70)],
        jobs: [{ job_id: uuid(70), type: 'outlook_sync' }],
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'user_force_sync'), {
        p_user: uuid(2),
        p_account: uuid(10),
        p_reason: REASON,
        p_resources: null,
      });
      assertEquals(data(body).jobs, [{ job_id: uuid(70), type: 'outlook_sync' }]);
      assertEquals(pokes(h), ['admin_integration_force_sync']);
    },
  },
  'POST /integrations/:accountId/renew-watch': {
    sql: { integration_renew_watch: () => ({ job_ids: [uuid(70), uuid(71)] }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'integration_renew_watch'), { p_account: uuid(10), p_reason: REASON });
      assertEquals(data(body).jobs, [
        { job_id: uuid(70), type: 'watch_renewal' },
        { job_id: uuid(71), type: 'watch_renewal' },
      ]);
      assertEquals(pokes(h), ['admin_watch_renewal']);
    },
  },
};

const JOB_CASES: Cases = {
  'GET /jobs': {
    sql: { jobs_list: () => sqlPage([sqlJob()]) },
    expect(h, body) {
      assertEquals(argsOf(h, 'jobs_list')?.p_filter, { status: 'dead_letter', q: 'corr-12345678' });
      assert(!('connected_account_id' in (rows(body)[0] ?? {})));
    },
  },
  'GET /jobs/stats': {
    sql: {
      jobs_summary: () => ({
        range: '24h',
        by_type_status: [{ type: 'gmail_sync', status: 'completed', count: 100 }],
        dead_letter: 2,
        queued_due: 3,
        running: 1,
        oldest_due_at: TS,
      }),
    },
    expect(_h, body) {
      assertEquals(data(body), {
        by_type_status: [{ type: 'gmail_sync', status: 'completed', count: 100 }],
        dead_letter: 2,
      });
    },
  },
  'POST /jobs/retry-bulk': {
    sql: { job_retry_bulk: () => ({ retried: 12, job_ids: [uuid(70)] }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'job_retry_bulk'), {
        p_type: 'gmail_sync',
        p_status: 'dead_letter',
        p_reason: REASON,
        p_max: 100,
        p_from: TS,
        p_to: LATER,
      });
      assertEquals(data(body), { retried: 12 });
      assertEquals(pokes(h), ['admin_job_retry_bulk']);
    },
  },
  'GET /jobs/:id': {
    sql: {
      job_detail: () => ({
        ...sqlJob(),
        priority: 50,
        payload: {
          approval_id: uuid(30),
          payload_version: 1,
          nested: { body: 'x' },
          note: 'y'.repeat(120),
        },
        idempotency_key: 'approval_execute:x',
        lease_owner: null,
        lease_expires_at: null,
        last_error_message: 'provider returned 503',
        parent_job_id: null,
        progress: null,
        started_at: TS,
        completed_at: null,
        dead_lettered_at: TS,
        policy: { retryable: true, cancellable: false },
        attempts_history: [
          {
            attempt: 1,
            worker_id: 'w1',
            started_at: TS,
            finished_at: TS,
            outcome: 'retrying',
            error_code: 'PROVIDER_UNAVAILABLE',
            duration_ms: 300,
          },
          {
            attempt: 2,
            worker_id: 'w1',
            started_at: LATER,
            finished_at: null,
            outcome: null,
            error_code: null,
            duration_ms: null,
          },
          {
            attempt: 3,
            worker_id: 'w1',
            started_at: LATER,
            finished_at: LATER,
            outcome: 'timeout',
            error_code: 'TIMEOUT',
            duration_ms: 900,
          },
        ],
        children: [],
      }),
    },
    expect(_h, body) {
      const d = data(body);
      const payload = d.payload as Record<string, unknown>;
      assertEquals(payload.approval_id, uuid(30));
      assert(!('nested' in payload), 'non-scalar payload members are dropped');
      assertEquals(String(payload.note).length, 80);
      assertEquals(
        (d.attempts_history as Record<string, unknown>[]).map((a) => a.outcome),
        ['retrying', 'running', 'failed'],
      );
      assert(!('last_error_message' in d));
    },
  },
  'GET /correlation/:id': {
    request: { params: { id: CORRELATION } },
    sql: {
      correlation_trace: () => [
        { kind: 'job', id: uuid(70), ts: TS, status: 'completed', label_key: 'gmail_sync' },
        {
          kind: 'approval_event',
          id: uuid(31),
          ts: TS,
          status: 'approved',
          label_key: 'pending->approved',
        },
        { kind: 'briefing', id: uuid(64), ts: LATER, status: 'delivered', label_key: 'morning' },
      ],
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'correlation_trace'), { p_correlation_id: CORRELATION });
      assertEquals(
        rows(body).map((r) => [r.kind, r.link]),
        [
          ['job', `/jobs/${uuid(70)}`],
          ['approval', null],
          ['briefing', `/briefings?id=${uuid(64)}`],
        ],
      );
    },
  },
  'POST /jobs/:id/retry': {
    sql: { job_retry: () => ({ id: uuid(70), status: 'queued' }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'job_retry'), {
        p_job: uuid(1),
        p_reason: REASON,
        p_reset_attempts: true,
      });
      assertEquals(data(body), { id: uuid(70), status: 'queued' });
      assertEquals(pokes(h), ['admin_job_retry']);
    },
  },
  'POST /jobs/:id/cancel': {
    sql: { job_cancel: () => ({ id: uuid(70), status: 'failed' }) },
    expect(h) {
      assertEquals(argsOf(h, 'job_cancel'), { p_job: uuid(1), p_reason: REASON });
    },
  },
};

const BRIEFING_CASES: Cases = {
  'GET /briefings/metrics': {
    sql: {
      briefings_metrics: () => ({
        range: '7d',
        kind: 'morning',
        scheduled: 10,
        generated: 10,
        delivered: 9,
        failed: 1,
        skipped: 0,
        skipped_reasons: {},
        p50_latency_ms: 3000,
        p95_latency_ms: null,
        ai_cost_usd: 0.4123,
        template_fallback_rate: 0.05,
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'briefings_metrics'), { p_range: '7d', p_kind: 'morning' });
      assertEquals(data(body).p95_latency_ms, null);
      assert(!('skipped_reasons' in data(body)));
    },
  },
  'GET /briefings': {
    sql: {
      briefings_list: () =>
        sqlPage([
          {
            id: uuid(64),
            user_id: uuid(2),
            kind: 'morning',
            local_date: '2026-09-24',
            status: 'failed',
            scheduled_for: TS,
            generated_at: null,
            delivered_at: null,
            latency_ms: null,
            skipped_reason: null,
            error_code: 'AI_UNAVAILABLE',
            origin: 'scheduled',
            version: 1,
            audio_status: 'none',
            narrative_mode: 'template',
          },
        ]),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'briefings_list')?.p_filter, { status: 'failed' });
      assertEquals(rows(body)[0]?.narrative_mode, 'template');
      assert(!('error_code' in (rows(body)[0] ?? {})));
    },
  },
  'POST /briefings/:id/regenerate': {
    sql: { briefing_regenerate: () => ({ id: uuid(64), version: 2, job_id: uuid(70) }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'briefing_regenerate'), { p_briefing: uuid(1), p_reason: REASON });
      assertEquals(data(body), {
        briefing_id: uuid(64),
        job: { job_id: uuid(70), status: 'queued', poll_after_ms: 1500 },
      });
      assertEquals(pokes(h), ['admin_briefing_regenerate']);
    },
  },
  'GET /notifications/metrics': {
    sql: {
      notifications_metrics: () => ({
        range: '7d',
        category: 'meeting',
        scheduled: 5,
        sent: 4,
        failed: 0,
        suppressed: 1,
        deduplicated: 0,
        suppression_reasons: { quiet_hours: 1 },
        receipt_errors: {},
        pending_scheduled: 2,
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'notifications_metrics'), { p_range: '7d', p_category: 'meeting' });
      assert(!('pending_scheduled' in data(body)));
    },
  },
  'GET /notifications': {
    sql: {
      notifications_user_debug: () =>
        sqlPage([
          {
            id: uuid(105),
            category: 'meeting',
            decision: 'sent',
            decision_reason: null,
            detail_mode: 'title_only',
            android_channel: 'meetings',
            scheduled_for: null,
            sent_at: TS,
            opened_at: null,
            is_test: false,
            correlation_id: null,
            receipt_status: 'ok',
          },
        ]),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'notifications_user_debug'), {
        p_user: uuid(2),
        p_page: 1,
        p_page_size: 25,
        p_filter: {},
      });
      assert(!('android_channel' in (rows(body)[0] ?? {})));
    },
  },
  'POST /notifications/test-push': {
    sql: {
      notification_send_test: () => ({
        job_id: uuid(70),
        notification_id: uuid(105),
        deferred_until: '2026-09-25T05:00:00+00:00',
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'notification_send_test'), {
        p_user: uuid(2),
        p_reason: REASON,
        p_installation: null,
      });
      assertEquals(
        data(body).deferred_until,
        '2026-09-25T05:00:00+00:00',
        'quiet hours are never bypassed',
      );
      assertEquals(pokes(h), ['admin_test_push']);
    },
  },
};

const SUBSCRIPTION_CASES: Cases = {
  'GET /subscriptions/metrics': {
    sql: {
      subscriptions_metrics: () => ({
        store_pro: 95,
        grant_pro: 10,
        both: 5,
        active_pro: 100,
        trials: 5,
        cancelled: 3,
        billing_issue: 1,
        by_store: { app_store: 60, play_store: 40 },
        by_product: [
          {
            product_id: 'da_pro_monthly',
            store: 'app_store',
            active: 40,
            trial: 2,
            will_renew: 38,
          },
          {
            product_id: 'da_pro_monthly',
            store: 'play_store',
            active: 30,
            trial: 1,
            will_renew: 29,
          },
        ],
        range: '30d',
        expired: 2,
        refunded: 0,
        renewal_rate: 0.9,
        webhook_backlog: 0,
        mrr_usd: 499.5,
        arr_estimate_usd: 5994,
        renewing_mrr_usd: 480,
        revenue_basis: 'gross_estimate_from_pricing_estimates',
      }),
    },
    expect(_h, body) {
      const d = data(body);
      assertEquals(d.by_product, { da_pro_monthly: 70 });
      assertEquals(d.mrr_usd, 499.5);
      assert(!('webhook_backlog' in d));
    },
  },
  'GET /subscriptions': {
    sql: {
      subscriptions_list: () =>
        sqlPage([
          {
            user_id: uuid(2),
            email_masked: 'yu***@gmail.com',
            status: 'active',
            is_active: true,
            store: 'app_store',
            product_id: 'da_pro_monthly',
            period_type: 'normal',
            expires_at: LATER,
            will_renew: true,
            environment: 'production',
            synced_at: TS,
            source: 'store',
          },
        ]),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'subscriptions_list')?.p_filter, { environment: 'PRODUCTION' });
      assertEquals(rows(body)[0]?.source, 'store');
    },
  },
  'GET /subscriptions/events': {
    sql: {
      billing_events_list: () =>
        sqlPage([
          {
            id: 5,
            event_id: 'evt_1',
            type: 'RENEWAL',
            environment: 'SANDBOX',
            store: 'APP_STORE',
            product_id: 'da_pro_monthly',
            user_id: uuid(2),
            event_at: TS,
            received_at: TS,
            processed: true,
            process_status: 'processed',
          },
        ]),
    },
    expect(_h, body) {
      assertEquals(rows(body)[0], {
        event_id: 'evt_1',
        type: 'RENEWAL',
        environment: 'SANDBOX',
        received_at: TS,
        processed: true,
      });
    },
  },
  'GET /subscriptions/trial-stream': {
    sql: {
      trial_stream: () => ({
        range: '30d',
        rows: [
          {
            event_id: 'evt_2',
            kind: 'trial_converted',
            email_masked: 'yu***@gmail.com',
            product_id: 'da_pro_annual',
            store: 'play_store',
            event_at: TS,
          },
        ],
        summary: { conversions: 3, trial_expirations: 1, conversion_rate: 0.75 },
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'trial_stream'), {
        p_range: '30d',
        p_filter: { environment: 'PRODUCTION' },
      });
      assertEquals((data(body).events as unknown[]).length, 1);
    },
  },
  'GET /subscriptions/events/:id': {
    tables: { billing_events: () => [{ id: 5 }] },
    sql: {
      billing_event_get: () => ({
        id: 5,
        event_id: 'evt_1',
        type: 'INITIAL_PURCHASE',
        store: 'APP_STORE',
        environment: 'PRODUCTION',
        product_id: 'da_pro_monthly',
        user_id: uuid(2),
        period_type: 'TRIAL',
        purchased_at: TS,
        expiration_at: LATER,
        event_at: TS,
        price_usd: 0,
        price_local: 0,
        currency: 'TRY',
        cancel_reason: null,
        expiration_reason: null,
        is_trial_conversion: false,
        received_at: TS,
        processed_at: TS,
        process_status: 'processed',
        processing_error_code: null,
        job_id: uuid(70),
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'billing_event_get'), { p_id: 5 });
      const lookup = h.calls.find((c) => c.url.includes('/rest/v1/billing_events'));
      assert(lookup?.url.includes('event_id=eq.evt_1'));
      assertEquals(data(body).currency, 'TRY');
      assert(!('process_status' in data(body)));
    },
  },
  'GET /entitlement-grants': {
    sql: {
      entitlement_grants_list: () =>
        sqlPage([
          {
            id: uuid(11),
            user_id: uuid(2),
            email_masked: 'yu***@gmail.com',
            source: 'support',
            duration_days: 7,
            starts_at: TS,
            ends_at: LATER,
            state: 'active',
            granted_by: uuid(100),
            reason: REASON,
            revoked_at: null,
            revoked_by: null,
          },
        ]),
    },
    expect(h) {
      assertEquals(argsOf(h, 'entitlement_grants_list')?.p_filter, { state: 'active' });
    },
  },
  'POST /subscriptions/:userId/sync': {
    sql: { subscription_resync: () => ({ job_id: uuid(70) }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'subscription_resync'), { p_user: uuid(2), p_reason: REASON });
      assertEquals(data(body), {
        job: { job_id: uuid(70), status: 'queued', poll_after_ms: 1500 },
      });
      assertEquals(pokes(h), ['admin_billing_sync']);
    },
  },
  'GET /referrals/metrics': {
    sql: {
      referrals_metrics: () => ({
        range: '7d',
        invites: 20,
        link_opens: 50,
        applied: 10,
        qualified: 6,
        rewarded: 5,
        conversion: 0.5,
        bonus_days_granted: 140,
        flagged_new: 1,
        flagged_open: 2,
        top_referrers: [],
      }),
    },
    expect(_h, body) {
      assertEquals(data(body), {
        invites: 20,
        signups: 10,
        qualified: 6,
        rewarded: 5,
        conversion: 0.5,
        bonus_days_granted: 140,
        flagged: 2,
      });
    },
  },
  'GET /referrals': {
    sql: {
      referrals_list: () =>
        sqlPage([
          {
            id: uuid(77),
            code: 'AB3K7M9Q',
            referrer_id: uuid(2),
            referee_id: uuid(4),
            status: 'flagged',
            risk_score: 80,
            signals_summary: ['same_device'],
            reject_reason: null,
            created_at: TS,
            qualified_at: null,
            rewarded_at: null,
            reviewed_at: null,
          },
        ]),
    },
    expect(_h, body) {
      assertEquals(rows(body)[0]?.risk_score, 0.8);
    },
  },
  'POST /referrals/:id/approve': {
    sql: { referral_review: () => ({ id: uuid(77), status: 'rewarded', grants: [uuid(11)] }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'referral_review'), {
        p_referral: uuid(77),
        p_decision: 'approve',
        p_reason: REASON,
      });
      assertEquals(data(body), { id: uuid(77), status: 'rewarded' });
      assertEquals(pokes(h), ['admin_referral_approved']);
    },
  },
  'POST /referrals/:id/reject': {
    sql: { referral_review: () => ({ id: uuid(77), status: 'rejected' }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'referral_review')?.p_decision, 'reject');
      assertEquals(data(body), { id: uuid(77), status: 'rejected' });
      assertEquals(pokes(h), []);
    },
  },
};

const PRIVACY_CASES: Cases = {
  'GET /data-requests': {
    sql: {
      data_requests_list: () => ({
        rows: [
          {
            id: uuid(78),
            kind: 'export',
            status: 'ready',
            origin: 'app',
            requested_at: TS,
            completed_at: TS,
            expires_at: LATER,
            error_code: null,
            steps_summary: {},
            user_ref: { id: uuid(2) },
          },
        ],
        total: 1,
        kind: 'export',
        page: 1,
        page_size: 25,
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'data_requests_list'), {
        p_kind: 'export',
        p_page: 1,
        p_page_size: 25,
        p_sort: '-created_at',
        p_filter: { status: 'ready' },
      });
      assertEquals(rows(body)[0]?.user_ref, uuid(2));
      assertEquals(rows(body)[0]?.steps_summary, null);
    },
  },
  'POST /data-requests/export/:id/regenerate': {
    sql: { export_regenerate: () => ({ export_request_id: uuid(109), job_id: uuid(70) }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'export_regenerate'), { p_id: uuid(78), p_reason: REASON });
      assertEquals(data(body), { export_request_id: uuid(109), job_id: uuid(70) });
      assertEquals(pokes(h), ['admin_export_regenerate']);
    },
  },
  'GET /data-requests/:kind/:id': {
    sql: {
      data_request_get: () => ({
        id: uuid(81),
        kind: 'account',
        status: 'processing',
        origin: 'app',
        confirmation_method: 'in_app',
        scope: null,
        connected_account_id: null,
        steps: {
          provider_revoke: { status: 'warning', detail_code: 'graph_local_only', at: TS },
          storage_purge: 'pending',
          auth_delete: { status: 'completed', completed_at: TS },
        },
        user_ref: { subject_hash_prefix: 'ab12cd34ef56' },
        requested_at: TS,
        completed_at: null,
        failed_at: null,
        error_code: null,
        job: {
          id: uuid(70),
          status: 'running',
          attempts: 1,
          max_attempts: 8,
          progress: { step: 3 },
          last_error_code: null,
          run_after: TS,
          updated_at: TS,
        },
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'data_request_get'), { p_kind: 'account', p_id: uuid(81) });
      const d = data(body);
      assertEquals(d.kind, 'account_deletion');
      assertEquals(d.user_ref, 'deleted:ab12cd34ef56');
      assertEquals(d.steps, [
        { step: 'provider_revoke', status: 'warning', detail_code: 'graph_local_only', at: TS },
        { step: 'storage_purge', status: 'pending', detail_code: null, at: null },
        { step: 'auth_delete', status: 'done', detail_code: null, at: TS },
      ]);
      assertEquals(
        d.steps_summary,
        'provider_revoke: warning, storage_purge: pending, auth_delete: completed',
      );
    },
  },
  'POST /data-requests/:kind/:id/retry': {
    sql: {
      data_request_retry: () => ({
        id: uuid(79),
        kind: 'history',
        status: 'queued',
        job_id: uuid(70),
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'data_request_retry'), {
        p_kind: 'history',
        p_id: uuid(79),
        p_reason: REASON,
      });
      assertEquals(data(body), { id: uuid(79), job_id: uuid(70) });
    },
  },
  'GET /audit': {
    sql: {
      audit_list: () => {
        const {
          prev_hash: _p,
          hash: _h,
          metadata: _m,
          ...row
        } = sqlAuditRow(1042, { action: 'admin.pii.revealed' });
        return sqlPage([
          row,
          {
            ...row,
            id: 1043,
            actor_type: 'system',
            actor: null,
            target_type: null,
            target_id: null,
          },
        ]);
      },
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'audit_list'), {
        p_page: 1,
        p_page_size: 25,
        p_sort: null,
        p_filter: { action: 'admin.pii.revealed', from: TS },
      });
      assertEquals(
        rows(body).map((r) => [r.id, r.actor, r.target]),
        [
          ['00000000-0000-4000-8000-000000000412', 'op***@dijitalasistan.app', `job:${uuid(70)}`],
          ['00000000-0000-4000-8000-000000000413', 'system', null],
        ],
      );
    },
  },
  'GET /audit/verify-chain': {
    tables: {
      audit_logs: (call) =>
        call.url.includes('occurred_at=gte.') ? [{ chain_seq: 1000 }] : [{ chain_seq: 1100 }],
    },
    sql: {
      audit_verify: () => ({
        verified: false,
        checked: 43,
        first_broken_id: 1042,
        first_broken_seq: 1042,
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'audit_verify'), { p_from: 1000, p_to: 1100 });
      assertEquals(data(body), {
        verified: false,
        first_broken_id: '00000000-0000-4000-8000-000000000412',
      });
    },
  },
  'GET /audit/:id': {
    sql: {
      audit_get: () =>
        sqlAuditRow(0x103, {
          target_user: { id: uuid(2), deleted: true, subject_hash_prefix: 'ab12' },
          metadata: { job_type: 'gmail_sync' },
        }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'audit_get'), { p_id: 0x103 });
      const d = data(body);
      assertEquals(d.id, uuid(103));
      assertEquals(d.target_user, 'deleted:ab12');
      assertEquals(d.hash, 'b'.repeat(64));
    },
  },
};

export const OPS_CASES: Cases = {
  ...INTEGRATION_CASES,
  ...JOB_CASES,
  ...BRIEFING_CASES,
  ...SUBSCRIPTION_CASES,
  ...PRIVACY_CASES,
};

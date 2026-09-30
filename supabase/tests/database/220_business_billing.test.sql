-- pgTAP · RevenueCat ledger, billing_sync context and mirror overwrite (T-7.01; API_CONTRACTS WH-05,
-- JOB-24; TEST_PLAN IT-RC-02/04/05/06/07, UT-ENT-06/07/08).
begin;
select plan(34);

select tests.create_user('ayse@billing.test');
select tests.create_user('burak@billing.test');

-- ─── Webhook ledger (WH-05) ──────────────────────────────────────────────────────────────────
select is(
  (public.record_billing_event('evt-1', 'INITIAL_PURCHASE', tests.user_id('ayse@billing.test')::text, 'PRODUCTION',
                               'APP_STORE', 'da_pro_monthly', now(), null, null, '{"event": {"id": "evt-1"}}',
                               sha256('evt-1'::bytea), array[tests.user_id('ayse@billing.test')::text]) ->> 'inserted')::boolean,
  true, 'a new event is stored');
select is(
  (public.record_billing_event('evt-1', 'INITIAL_PURCHASE', tests.user_id('ayse@billing.test')::text, 'PRODUCTION',
                               'APP_STORE', 'da_pro_monthly', now(), null, null, '{"event": {"id": "evt-1"}}',
                               sha256('evt-1'::bytea), array[tests.user_id('ayse@billing.test')::text]) ->> 'inserted')::boolean,
  false, 'a replayed event id inserts nothing (IT-RC-02)');
select is((select count(*)::integer from public.billing_events where event_id = 'evt-1'), 1, 'one ledger row per event id');
select is((select count(*)::integer from public.jobs where type = 'billing_sync'
           and idempotency_key = 'billing_sync:' || tests.user_id('ayse@billing.test') || ':evt-1'), 1,
          'one billing_sync job per event and app user id');
select is((select payload ->> 'reason' from public.jobs where idempotency_key = 'billing_sync:' || tests.user_id('ayse@billing.test') || ':evt-1'),
          'webhook', 'the job payload carries reason webhook');
select is((select user_id from public.billing_events where event_id = 'evt-1'), tests.user_id('ayse@billing.test'),
          'the app user id resolves to the Supabase user');
select is((select status from public.webhook_events where source = 'revenuecat' and external_id = 'evt-1'), 'enqueued',
          'webhook_events records the enqueue');

select public.record_billing_event('evt-transfer', 'TRANSFER', null, 'PRODUCTION', 'PLAY_STORE', null, now(),
                                   array[tests.user_id('ayse@billing.test')::text], array[tests.user_id('burak@billing.test')::text],
                                   '{}', null, array[tests.user_id('ayse@billing.test')::text, tests.user_id('burak@billing.test')::text]);
select is((select count(*)::integer from public.jobs where type = 'billing_sync' and idempotency_key like 'billing_sync:%:evt-transfer'), 2,
          'TRANSFER enqueues a sync for both sides (IT-RC-04)');

select public.record_billing_event('evt-test', 'TEST', 'rc-dashboard', 'PRODUCTION', null, null, now(), null, null, '{}', null, '{}');
select is((select process_status from public.billing_events where event_id = 'evt-test'), 'processed',
          'a TEST event is stored as processed (IT-RC-06)');
select is((select count(*)::integer from public.jobs where idempotency_key like '%evt-test%'), 0, 'a TEST event enqueues nothing');
select lives_ok($$ select public.record_billing_event('evt-future', 'SOME_FUTURE_EVENT', null, 'PRODUCTION', null, null, now(),
                                                      null, null, '{}', null, '{}') $$,
                'an unknown event type is stored, not rejected');
select throws_ok($$ insert into public.billing_events (event_id, event_type, event_timestamp, payload)
                    values ('evt-bad', 'lower case', now(), '{}') $$, '23514', null, 'event_type keeps its format check');

-- ─── Sync context and sandbox allow-list (JOB-24 steps 1–2) ───────────────────────────────────
select is(public.billing_sync_context('$RCAnonymousID:abc', null) ->> 'user_id', null::text, 'anonymous ids map to no user');
select is((public.billing_sync_context(tests.user_id('ayse@billing.test')::text, 'evt-1') ->> 'sandbox_allowed')::boolean, false,
          'nobody is on the sandbox allow-list by default');
update public.app_settings set value = jsonb_build_array(tests.user_id('ayse@billing.test')::text)
where key = 'billing.sandbox_allowed_app_user_ids';
select is((public.billing_sync_context(tests.user_id('ayse@billing.test')::text, 'evt-1') ->> 'sandbox_allowed')::boolean, true,
          'an allow-listed tester may use sandbox purchases');
select is(public.billing_sync_context(tests.user_id('ayse@billing.test')::text, 'evt-1') #>> '{event,environment}', 'PRODUCTION',
          'the context carries the triggering event environment');
select throws_ok($$ update public.app_settings set value = '[1, 2]' where key = 'billing.sandbox_allowed_app_user_ids' $$,
                 '23514', null, 'the allow-list only accepts app user id strings');

-- ─── Mirror overwrite ─────────────────────────────────────────────────────────────────────────
select is(
  public.billing_apply_mirror(tests.user_id('ayse@billing.test'), tests.user_id('ayse@billing.test')::text,
    jsonb_build_object('fetched_at', now(), 'is_active', true, 'status', 'trial', 'store', 'app_store',
                       'environment', 'production', 'product_id', 'da_pro_monthly', 'period_type', 'trial',
                       'purchased_at', now() - interval '1 day', 'original_purchased_at', now() - interval '1 day',
                       'expires_at', now() + interval '30 hours', 'will_renew', true), 'evt-1') #>> '{effective_after,is_active}',
  'true', 'an active trial snapshot makes the user Pro');
select is((select trial_reminder_at from public.subscriptions where user_id = tests.user_id('ayse@billing.test')),
          (select expires_at - interval '24 hours' from public.subscriptions where user_id = tests.user_id('ayse@billing.test')),
          'a renewing trial schedules the reminder 24 h before it ends (IT-RC-07)');
select is((select process_status from public.billing_events where event_id = 'evt-1'), 'processed', 'the event is marked processed');
select is((select last_event_type from public.subscriptions where user_id = tests.user_id('ayse@billing.test')), 'INITIAL_PURCHASE',
          'the mirror records the triggering event');
select is(
  public.billing_apply_mirror(tests.user_id('ayse@billing.test'), tests.user_id('ayse@billing.test')::text,
    jsonb_build_object('fetched_at', now() - interval '1 hour', 'is_active', false, 'status', 'expired',
                       'will_renew', false), null) ->> 'skipped',
  'stale_snapshot', 'an older snapshot never regresses the mirror (out-of-order safety)');
select is((select is_active from public.subscriptions where user_id = tests.user_id('ayse@billing.test')), true,
          'the mirror keeps the newer state');

-- Billing issue while RevenueCat still lists the entitlement (grace): still Pro, first detection kept.
select public.billing_apply_mirror(tests.user_id('burak@billing.test'), tests.user_id('burak@billing.test')::text,
  jsonb_build_object('fetched_at', now() - interval '2 minutes', 'is_active', true, 'status', 'grace_period',
                     'store', 'play_store', 'environment', 'production', 'product_id', 'da_pro_annual:annual',
                     'period_type', 'normal', 'expires_at', now() + interval '3 days',
                     'grace_expires_at', now() + interval '3 days', 'will_renew', true), null);
select ok((select is_active from public.effective_entitlement(tests.user_id('burak@billing.test'))),
          'grace period keeps Pro (UT-ENT-06: the REST snapshot is truth)');
select is((select billing_issue_at from public.subscriptions where user_id = tests.user_id('burak@billing.test')),
          now() - interval '2 minutes', 'billing_issue_at is the first detection time');
select public.billing_apply_mirror(tests.user_id('burak@billing.test'), tests.user_id('burak@billing.test')::text,
  jsonb_build_object('fetched_at', now() - interval '1 minute', 'is_active', true, 'status', 'billing_issue',
                     'store', 'play_store', 'environment', 'production', 'product_id', 'da_pro_annual:annual',
                     'period_type', 'normal', 'expires_at', now() + interval '3 days', 'will_renew', true), null);
select is((select billing_issue_at from public.subscriptions where user_id = tests.user_id('burak@billing.test')),
          now() - interval '2 minutes', 'a later sync keeps the first billing issue time');

-- Refund: CANCELLATION with CUSTOMER_SUPPORT, then REST reports no entitlement → refunded, Free (UT-ENT-07).
select public.record_billing_event('evt-refund', 'CANCELLATION', tests.user_id('burak@billing.test')::text, 'PRODUCTION',
                                   'PLAY_STORE', 'da_pro_annual:annual', now(), null, null,
                                   '{"event": {"id": "evt-refund", "cancel_reason": "CUSTOMER_SUPPORT"}}', null,
                                   array[tests.user_id('burak@billing.test')::text]);
select is(
  public.billing_apply_mirror(tests.user_id('burak@billing.test'), tests.user_id('burak@billing.test')::text,
    jsonb_build_object('fetched_at', now(), 'is_active', false, 'status', 'expired', 'store', 'play_store',
                       'environment', 'production', 'product_id', 'da_pro_annual:annual', 'period_type', 'normal',
                       'purchased_at', now() - interval '10 days', 'expires_at', now() - interval '1 minute',
                       'will_renew', false), 'evt-refund') #>> '{current,status}',
  'refunded', 'a customer-support cancellation without entitlement is a refund');
select is((select cancel_reason from public.subscriptions where user_id = tests.user_id('burak@billing.test')), 'CUSTOMER_SUPPORT',
          'cancel_reason comes from the latest CANCELLATION event');
select ok(not (select is_active from public.effective_entitlement(tests.user_id('burak@billing.test'))), 'refund → Free');
select is((select trial_reminder_at from public.subscriptions where user_id = tests.user_id('burak@billing.test')), null::timestamptz,
          'no trial reminder without a renewing trial');

-- ─── Privileges ───────────────────────────────────────────────────────────────────────────────
select ok(not has_function_privilege('authenticated',
            'public.record_billing_event(text, text, text, text, text, text, timestamptz, text[], text[], jsonb, bytea, text[], uuid)',
            'execute'), 'clients cannot write the billing ledger');
select ok(not has_function_privilege('authenticated', 'public.billing_apply_mirror(uuid, text, jsonb, text)', 'execute'),
          'clients cannot overwrite the mirror');
select ok(has_function_privilege('service_role', 'public.billing_apply_mirror(uuid, text, jsonb, text)', 'execute'),
          'the worker can overwrite the mirror');
select ok(not has_function_privilege('anon', 'public.billing_sync_context(text, text)', 'execute'), 'anon has no access');

select * from finish();
rollback;

-- pgTAP · Android Notification Intelligence storage (TEST_PLAN DB-30; API_CONTRACTS API-ANI-01,
-- JOB-12, JOB-20, JOB-22; DATABASE_AND_RLS_PLAN `android_notification_signals`): structured columns
-- only, OWN-R / OWN-D with no client insert or update, `expires_at = least(retention, posted_at +
-- 30 d)` (also after a recompute), the service upsert deduplicated on `(user_id, signal_hash)`,
-- Android-sourced life events and their amount rules, and the privacy engine removing signals and
-- the derived life events (retention sweep, history deletion, account deletion).
begin;
select plan(28);

select tests.create_user('ani@ni.test');
select tests.create_user('ani-other@ni.test');
select tests.create_user('ani-hist@ni.test');
update public.user_preferences set retention_policy = 'until_deleted' where user_id = tests.user_id('ani-hist@ni.test');

create temporary table fx (k text primary key, id uuid) on commit drop;
insert into fx values
  ('inst', tests.make_installation(tests.user_id('ani@ni.test'), 'android')),
  ('inst_o', tests.make_installation(tests.user_id('ani-other@ni.test'), 'android')),
  ('inst_h', tests.make_installation(tests.user_id('ani-hist@ni.test'), 'android'));

-- The service-role write of API-ANI-01 (PostgREST upsert, ignore duplicates).
create temporary table sig (k text, u text, pkg text, category text, hash text, posted interval) on commit drop;
insert into sig values
  ('pay', 'ani@ni.test', 'com.garanti.cepsubesi', 'bank_payment', repeat('a', 64), interval '1 hour'),
  ('cargo', 'ani@ni.test', 'com.trendyol.go', 'cargo', repeat('b', 64), interval '2 days'),
  ('o_cargo', 'ani-other@ni.test', 'com.trendyol.go', 'cargo', repeat('a', 64), interval '3 hours'),
  ('h_cargo', 'ani-hist@ni.test', 'com.trendyol.go', 'cargo', repeat('c', 64), interval '1 hour');
insert into public.android_notification_signals
  (user_id, installation_id, package_name, app_label, category, amount, currency, due_date, tracking_status, posted_at, signal_hash)
select tests.user_id(s.u),
       (select id from fx where k = case s.u when 'ani@ni.test' then 'inst' when 'ani-other@ni.test' then 'inst_o' else 'inst_h' end),
       s.pkg, 'Uygulama', s.category,
       case when s.category = 'bank_payment' then 1250.50 end, case when s.category = 'bank_payment' then 'TRY' end,
       case when s.category = 'bank_payment' then current_date + 3 end,
       case when s.category = 'cargo' then 'in_transit' end,
       now() - s.posted, decode(s.hash, 'hex')
from sig s
on conflict (user_id, signal_hash) do nothing;

-- ═══ Structured columns only ═══════════════════════════════════════════════════════════════════
select columns_are('public', 'android_notification_signals', array[
  'id', 'user_id', 'installation_id', 'package_name', 'app_label', 'category', 'amount', 'currency', 'due_date',
  'tracking_status', 'flight_no', 'gate', 'posted_at', 'signal_hash', 'extractor_version', 'life_event_id',
  'expires_at', 'created_at'], 'android_notification_signals has only structured columns (no raw notification text)');
select throws_ok($$ insert into public.android_notification_signals (user_id, installation_id, package_name, app_label, category, posted_at, signal_hash)
                    values (tests.user_id('ani@ni.test'), (select id from fx where k = 'inst'), 'com.x', repeat('x', 81), 'cargo', now(), '\x01') $$,
                 '23514', null, 'app_label is length-bounded');
select throws_ok($$ insert into public.android_notification_signals (user_id, installation_id, package_name, category, posted_at, signal_hash)
                    values (tests.user_id('ani@ni.test'), (select id from fx where k = 'inst'), 'Kargonuz yola çıktı', 'cargo', now(), '\x02') $$,
                 '23514', null, 'package_name cannot carry text');
select throws_ok($$ insert into public.android_notification_signals (user_id, installation_id, package_name, category, posted_at, signal_hash)
                    values (tests.user_id('ani@ni.test'), (select id from fx where k = 'inst'), 'com.x', 'chat', now(), '\x03') $$,
                 '23514', null, 'category is a closed set');

-- ═══ Idempotent upsert on (user_id, signal_hash) ═══════════════════════════════════════════════
insert into public.android_notification_signals (user_id, installation_id, package_name, category, posted_at, signal_hash)
values (tests.user_id('ani@ni.test'), (select id from fx where k = 'inst'), 'com.trendyol.go', 'cargo', now(), decode(repeat('a', 64), 'hex'))
on conflict (user_id, signal_hash) do nothing;
select is((select count(*)::integer from public.android_notification_signals where user_id = tests.user_id('ani@ni.test')), 2,
          'a repeated signal_hash is a duplicate for the same user');
select is((select count(*)::integer from public.android_notification_signals where signal_hash = decode(repeat('a', 64), 'hex')), 2,
          'the same hash is independent per user');
select throws_ok($$ insert into public.android_notification_signals (user_id, installation_id, package_name, category, posted_at, signal_hash)
                    values (tests.user_id('ani@ni.test'), (select id from fx where k = 'inst'), 'com.trendyol.go', 'cargo', now(), decode(repeat('b', 64), 'hex')) $$,
                 '23505', null, 'the unique (user_id, signal_hash) holds');

-- ═══ expires_at = least(retention, posted_at + 30 d) ═══════════════════════════════════════════
select is((select expires_at from public.android_notification_signals
           where user_id = tests.user_id('ani@ni.test') and package_name = 'com.garanti.cepsubesi'),
          (select posted_at + interval '30 days' from public.android_notification_signals
           where user_id = tests.user_id('ani@ni.test') and package_name = 'com.garanti.cepsubesi'),
          'd90 retention: a signal expires 30 days after posted_at');
select is((select expires_at - posted_at from public.android_notification_signals where user_id = tests.user_id('ani-hist@ni.test')),
          interval '30 days', 'until_deleted: still capped at 30 days');
update public.user_preferences set retention_policy = 'd365' where user_id = tests.user_id('ani@ni.test');
select ok(private.recompute_expires_at(tests.user_id('ani@ni.test'), 5000) >= 0, 'recompute_expires_at runs');
select is((select max(expires_at - posted_at) from public.android_notification_signals where user_id = tests.user_id('ani@ni.test')),
          interval '30 days', 'a retention recompute keeps the 30-day cap');

-- ═══ Android-sourced life events ═══════════════════════════════════════════════════════════════
insert into fx values ('le', gen_random_uuid()), ('le_h', gen_random_uuid());
select lives_ok($$
  insert into public.life_events (id, user_id, type, title, payload, amount, currency, amount_evidence, due_at, dedupe_key,
                                  source_type, source_id, source_provider, source_timestamp, confidence, evidence)
  values ((select id from fx where k = 'le'), tests.user_id('ani@ni.test'), 'payment', 'Garanti BBVA · Ödeme bekliyor',
          '{"payee": "Garanti BBVA", "status": "due", "origin": "android", "app_package": "com.garanti.cepsubesi"}',
          1250.50, 'TRY', '[{"quote": "Garanti BBVA · amount: 1250.50 TRY", "field": "amount", "locator": "android_notification:s1"}]',
          now() + interval '3 days', 'payment:ani-test', 'android_notification',
          (select id::text from public.android_notification_signals where user_id = tests.user_id('ani@ni.test') and category = 'bank_payment'),
          'android_device', now() - interval '1 hour', 0.85,
          '[{"quote": "Garanti BBVA · due_date: 2026-09-27", "field": "due_date", "locator": "android_notification:s1"}]')
$$, 'a life event with Android provenance (android_notification / android_device) is valid');
update public.android_notification_signals set life_event_id = (select id from fx where k = 'le')
where user_id = tests.user_id('ani@ni.test') and category = 'bank_payment';
select is((select count(*)::integer from public.android_notification_signals where life_event_id = (select id from fx where k = 'le')), 1,
          'the signal links to its life event');
select throws_ok($$ insert into public.life_events (user_id, type, title, amount, dedupe_key, source_type, source_id, source_provider, source_timestamp, confidence)
                    values (tests.user_id('ani@ni.test'), 'payment', 'X', 10, 'payment:nocur', 'android_notification', 's', 'android_device', now(), 0.8) $$,
                 '23514', null, 'life_events.amount requires a currency');
select throws_ok($$ insert into public.life_events (user_id, type, title, amount, currency, dedupe_key, source_type, source_id, source_provider, source_timestamp, confidence)
                    values (tests.user_id('ani@ni.test'), 'payment', 'X', 10, 'TRY', 'payment:noev', 'android_notification', 's', 'android_device', now(), 0.8) $$,
                 '23514', null, 'life_events.amount requires amount_evidence');

-- ═══ DB-30 · OWN-R, OWN-D, no client insert or update ══════════════════════════════════════════
select tests.authenticate_as(tests.user_id('ani@ni.test'));
select is((select count(*)::integer from public.android_notification_signals), 2, 'the owner reads only own signals');
select throws_ok($$ insert into public.android_notification_signals (user_id, installation_id, package_name, category, posted_at, signal_hash)
                    values (tests.user_id('ani@ni.test'), (select id from public.app_installations limit 1), 'com.x', 'cargo', now(), '\x09') $$,
                 '42501', null, 'users cannot insert signals (API-ANI-01 only)');
select throws_ok($$ update public.android_notification_signals set gate = 'B1' $$, '42501', null, 'users cannot update signals');
select is_empty($$ delete from public.android_notification_signals where user_id = tests.user_id('ani-other@ni.test') returning id $$,
                'another user''s delete affects 0 rows');
delete from public.android_notification_signals where category = 'cargo';
select is((select count(*)::integer from public.android_notification_signals), 1, 'the owner deletes a single signal (OWN-D)');
select tests.clear_authentication();
select is((select count(*)::integer from public.android_notification_signals where user_id = tests.user_id('ani-other@ni.test')), 1,
          'the other user''s signal is untouched');

-- ═══ JOB-20 · retention sweep ══════════════════════════════════════════════════════════════════
create temporary table sweep on commit drop as select private.retention_cleanup(5000, now() + interval '31 days') as r;
select ok(((select r from sweep) -> 'deleted' ->> 'android_notification_signals')::integer >= 2,
          'expired signals are deleted by the sweep');
select is((select count(*)::integer from public.android_notification_signals
           where user_id in (tests.user_id('ani@ni.test'), tests.user_id('ani-other@ni.test'))), 0,
          'no signal outlives posted_at + 30 days');
select is((select count(*)::integer from public.life_events where id = (select id from fx where k = 'le')), 1,
          'the derived life event follows its own retention (d365), not the signal cap');
create temporary table sweep2 on commit drop as select private.retention_cleanup(5000, now() + interval '400 days') as r;
select is((select count(*)::integer from public.life_events where id = (select id from fx where k = 'le')), 0,
          'the derived life event is deleted once its retention passes');

-- ═══ JOB-22 · history deletion (all) and account deletion ══════════════════════════════════════
insert into public.android_notification_signals (user_id, installation_id, package_name, category, tracking_status, posted_at, signal_hash)
values (tests.user_id('ani-hist@ni.test'), tests.make_installation(tests.user_id('ani-hist@ni.test'), 'android'),
        'com.trendyol.go', 'cargo', 'in_transit', now(), '\x0b');
insert into public.life_events (id, user_id, type, title, dedupe_key, source_type, source_id, source_provider, source_timestamp, confidence)
values ((select id from fx where k = 'le_h'), tests.user_id('ani-hist@ni.test'), 'shipment', 'Trendyol · Yolda', 'shipment:ani-hist',
        'android_notification', (select id::text from public.android_notification_signals where user_id = tests.user_id('ani-hist@ni.test')),
        'android_device', now(), 0.75);
select lives_ok($$ select public.purge_history(tests.user_id('ani-hist@ni.test'), null) $$, 'history deletion runs');
select is((select count(*)::integer from public.android_notification_signals where user_id = tests.user_id('ani-hist@ni.test'))
          + (select count(*)::integer from public.life_events where user_id = tests.user_id('ani-hist@ni.test')), 0,
          'history deletion removes the signals and the Android-derived life events');
insert into public.android_notification_signals (user_id, installation_id, package_name, category, posted_at, signal_hash)
values (tests.user_id('ani-other@ni.test'), tests.make_installation(tests.user_id('ani-other@ni.test'), 'android'),
        'com.trendyol.go', 'cargo', now(), '\x0a');
insert into public.life_events (user_id, type, title, dedupe_key, source_type, source_id, source_provider, source_timestamp, confidence)
values (tests.user_id('ani-other@ni.test'), 'shipment', 'Trendyol · Yolda', 'shipment:ani-gone', 'android_notification', 's', 'android_device', now(), 0.75);
delete from auth.users where id = tests.user_id('ani-other@ni.test');
select is((select count(*)::integer from public.android_notification_signals where user_id = tests.user_id('ani-other@ni.test'))
          + (select count(*)::integer from public.life_events where user_id = tests.user_id('ani-other@ni.test')), 0,
          'account deletion removes the signals and the derived life events');

select * from finish();
rollback;

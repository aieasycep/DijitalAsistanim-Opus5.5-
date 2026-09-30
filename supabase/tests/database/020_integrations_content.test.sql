-- pgTAP · integrations and content: owner CRUD, cross-user isolation, plan limits, capability
-- truth table, hidden columns, provider quota (DATABASE_AND_RLS_PLAN §13.2 020–035, T-2.22).
begin;
select plan(52);

select tests.create_user('ayse@content.test');
select tests.create_user('burak@content.test');
select tests.create_user('cem@content.test');
select tests.make_pro(tests.user_id('cem@content.test'));

create temporary table fx (k text primary key, id uuid) on commit drop;
grant select on fx to authenticated, anon;
insert into fx values
  ('a_acct', tests.make_account(tests.user_id('ayse@content.test'), 'ayse@gmail.com')),
  ('b_acct', tests.make_account(tests.user_id('burak@content.test'), 'burak@gmail.com'));
insert into fx values
  ('a_cal', tests.make_calendar(tests.user_id('ayse@content.test'), (select id from fx where k = 'a_acct'), 'Kişisel')),
  ('a_cal2', tests.make_calendar(tests.user_id('ayse@content.test'), (select id from fx where k = 'a_acct'), 'İş')),
  ('a_thread', tests.make_thread(tests.user_id('ayse@content.test'), (select id from fx where k = 'a_acct'), 'Ödeme hatırlatması')),
  ('b_thread', tests.make_thread(tests.user_id('burak@content.test'), (select id from fx where k = 'b_acct'), 'Ödeme hatırlatması'));
insert into fx values
  ('a_msg', tests.make_message(tests.user_id('ayse@content.test'), (select id from fx where k = 'a_acct'),
                               (select id from fx where k = 'a_thread'), 'Ödeme hatırlatması')),
  ('a_event', tests.make_event(tests.user_id('ayse@content.test'), (select id from fx where k = 'a_acct'),
                               (select id from fx where k = 'a_cal'), 'İstanbul toplantısı', now() + interval '1 day',
                               now() + interval '1 day 1 hour')),
  ('a_commit', tests.make_commitment(tests.user_id('ayse@content.test'))),
  ('a_life', tests.make_life_event(tests.user_id('ayse@content.test'))),
  ('b_life', tests.make_life_event(tests.user_id('burak@content.test'))),
  ('a_contact', tests.make_contact(tests.user_id('ayse@content.test'), 'Ahmet Yılmaz', 'ahmet@kuzeylojistik.com'));
insert into public.tasks (user_id, connected_account_id, provider, provider_task_id, provider_list_id, title, origin)
values (tests.user_id('ayse@content.test'), (select id from fx where k = 'a_acct'), 'google', 'task-1', 'list-1', 'Sağlayıcı görevi',
        'provider_sync');
insert into public.captures (user_id, kind, idempotency_key, status, storage_path)
values (tests.user_id('ayse@content.test'), 'photo', 'cap-1', 'extracted',
        tests.user_id('ayse@content.test') || '/' || gen_random_uuid() || '/fis.jpg');

-- ─── Plan limits (Free: 1 mail account, 1 selected calendar; Pro: 10) ────────────────────────
select is((select selected from public.calendars where id = (select id from fx where k = 'a_cal2')), false,
          'a Free user''s second synced calendar is stored unselected');
select throws_ok($$ select tests.make_account(tests.user_id('ayse@content.test'), 'ayse.work@gmail.com') $$,
                 'P0001', 'PLAN_LIMIT:max_mail_accounts', 'Free: a second mail account is rejected');
select tests.make_account(tests.user_id('cem@content.test'), 'cem@gmail.com');
select lives_ok($$ select tests.make_account(tests.user_id('cem@content.test'), 'cem.work@gmail.com') $$,
                'Pro: a second mail account is allowed');

-- ─── account_can truth table ─────────────────────────────────────────────────────────────────
select ok(private.account_can((select id from fx where k = 'a_acct'), 'mail_read'), 'healthy + granted + toggle on → can read mail');
select ok(not private.account_can((select id from fx where k = 'a_acct'), 'mail_send'), 'capability not granted → cannot');
update public.connected_accounts set data_source_toggles = data_source_toggles || '{"mail_read": false}'
where id = (select id from fx where k = 'a_acct');
select ok(not private.account_can((select id from fx where k = 'a_acct'), 'mail_read'), 'toggle off → cannot');
update public.connected_accounts set data_source_toggles = data_source_toggles || '{"mail_read": true}', status = 'needs_reauth'
where id = (select id from fx where k = 'a_acct');
select ok(not private.account_can((select id from fx where k = 'a_acct'), 'mail_read'), 'needs_reauth → cannot');
update public.connected_accounts set status = 'healthy', pending_binding_until = now() + interval '5 minutes'
where id = (select id from fx where k = 'a_acct');
select ok(not private.account_can((select id from fx where k = 'a_acct'), 'mail_read'), 'binding pending → cannot');
update public.connected_accounts set pending_binding_until = null where id = (select id from fx where k = 'a_acct');

-- ─── Provider quota and credential refresh lock ──────────────────────────────────────────────
select is(private.consume_provider_quota('gmail_user', (select id from fx where k = 'a_acct'), 200, 250, 60), 0, 'quota admits within the window');
select ok(private.consume_provider_quota('gmail_user', (select id from fx where k = 'a_acct'), 100, 250, 60) > 0,
          'quota returns wait_ms > 0 over the limit');
select is(private.consume_provider_quota('gmail_project', null, 1, 10, 60, 'google'), 0, 'project buckets work without an account');

-- ─── Client view ─────────────────────────────────────────────────────────────────────────────
select tests.authenticate_as(tests.user_id('ayse@content.test'));
select results_eq($$ select count(*)::integer from public.connected_accounts $$, array[1], 'owner sees her account');
select throws_ok($$ update public.connected_accounts set data_source_toggles = '{}' $$, '42501', null,
                 'connected_accounts has no client update grant');
select throws_ok($$ select count(*) from public.oauth_credentials $$, '42501', null, 'oauth_credentials invisible');
select throws_ok($$ select count(*) from public.oauth_states $$, '42501', null, 'oauth_states invisible');
select throws_ok($$ select count(*) from public.provider_quota_usage $$, '42501', null, 'provider_quota_usage invisible');
select throws_ok($$ select count(*) from public.webhook_events $$, '42501', null, 'webhook_events invisible');
select throws_ok($$ select cursor from public.sync_states $$, '42501', null, 'sync cursor is hidden');
select lives_ok($$ select * from public.connected_account_sync_health $$, 'sync health view is readable');
select throws_ok($$ update public.calendars set selected = true where id = (select id from fx where k = 'a_cal2') $$,
                 'P0001', 'PLAN_LIMIT:max_calendars', 'Free: selecting a second calendar is rejected');
select lives_ok($$ update public.calendars set selected = false where id = (select id from fx where k = 'a_cal') $$,
                'deselecting a calendar is allowed');
select throws_ok($$ update public.calendars set name = 'x' $$, '42501', null, 'calendar name is not client-writable');

select results_eq($$ select count(*)::integer from public.email_threads $$, array[1], 'owner sees only her thread');
select results_eq($$ select count(*)::integer from public.email_messages $$, array[1], 'owner sees only her message');
select throws_ok($$ select content_hash from public.email_messages $$, '42501', null, 'message content_hash is hidden');
select throws_ok($$ select analysis_hash from public.email_threads $$, '42501', null, 'thread analysis_hash is hidden');
select throws_ok($$ update public.email_threads set subject = 'x' $$, '42501', null, 'threads are read-only');
select results_eq($$ select count(*)::integer from public.calendar_events $$, array[1], 'owner sees her event');
select throws_ok($$ delete from public.calendar_events $$, '42501', null, 'events are read-only');

-- FTS (private.tr_search: Turkish + unaccent) through RPC-02.
select results_eq($$ select count(*)::integer from public.search_user_content('odeme', null, array['email']) $$, array[1],
                  '"odeme" finds "Ödeme hatırlatması" (own row only)');
select results_eq($$ select count(*)::integer from public.search_user_content('ÖDEME', null, array['email']) $$, array[1],
                  '"ÖDEME" finds it too');
select results_eq($$ select count(*)::integer from public.search_user_content('istanbul', null, array['event']) $$, array[1],
                  '"istanbul" finds "İstanbul toplantısı"');

-- Tasks: in-app only.
select lives_ok($$ insert into public.tasks (user_id, title, origin) values (auth.uid(), 'Market alışverişi', 'user') $$,
                'owner inserts an in-app task');
select throws_ok($$ insert into public.tasks (user_id, title, origin) values (tests.user_id('burak@content.test'), 'x', 'user') $$,
                 '42501', null, 'insert with a foreign user_id is rejected');
select results_eq($$ with u as (update public.tasks set title = 'x' where origin = 'provider_sync' returning 1)
                     select count(*)::integer from u $$, array[0], 'provider tasks cannot be updated (0 rows)');
select lives_ok($$ update public.tasks set status = 'done', completed_at = now() where origin = 'user' $$, 'in-app task completed');

-- Commitments, life events, captures.
select lives_ok($$ update public.commitments set status = 'done' where id = (select id from fx where k = 'a_commit') $$,
                'owner completes a commitment');
select throws_ok($$ update public.commitments set text = 'x' $$, '42501', null, 'commitment text is not client-writable');
select throws_ok($$ update public.commitments set user_overrides = '{}' $$, '42501', null, 'user_overrides only through RPC-17');
select throws_ok($$ update public.commitments set status = 'snoozed' where id = (select id from fx where k = 'a_commit') $$,
                 '55000', null, 'illegal commitment edge done→snoozed rejected');
select lives_ok($$ update public.life_events set status = 'done', suppressed = true where id = (select id from fx where k = 'a_life') $$,
                'owner resolves a life event');
select throws_ok($$ update public.life_events set amount = 1 $$, '42501', null, 'life event amount is not client-writable');
select results_eq($$ with u as (update public.life_events set status = 'done' where id = (select id from fx where k = 'b_life')
                               returning 1) select count(*)::integer from u $$, array[0], 'another user''s life event: 0 rows');
select throws_ok($$ update public.captures set status = 'actioned' $$, '42501', null, 'captures: only discard is allowed');
select lives_ok($$ update public.captures set status = 'discarded' $$, 'owner discards a capture');

-- Contacts, VIP, rules.
select throws_ok($$ insert into public.contacts (user_id, display_name, primary_email, avatar_seed, origin)
                    values (auth.uid(), 'X', 'x@example.com', 1, 'mail') $$, '42501', null, 'contact insert requires origin=manual');
select lives_ok($$ insert into public.contacts (user_id, display_name, primary_email, avatar_seed, origin)
                   values (auth.uid(), 'Selin Kaya', 'selin@example.com', 3, 'manual') $$, 'manual contact insert');
select lives_ok($$ insert into public.vip_people (user_id, contact_id, relationship, origin)
                   values (auth.uid(), (select id from fx where k = 'a_contact'), 'key_client', 'user') $$, 'VIP insert');
select throws_ok($$ insert into public.priority_rules (user_id, condition_type, condition_value, outcome)
                    values (auth.uid(), 'domain', '{"domain": "not a domain"}', 'high') $$, '23514', null, 'invalid domain rule rejected');
select lives_ok($$ insert into public.priority_rules (user_id, condition_type, condition_value, outcome)
                   values (auth.uid(), 'domain', '{"domain": "yilmazendustri.com"}', 'always_important') $$, 'valid domain rule');
select throws_ok($$ delete from public.priority_rules $$, '42501', null, 'rules are soft-deleted, never deleted');
select tests.clear_authentication();

select tests.authenticate_as(tests.user_id('burak@content.test'));
select results_eq($$ select count(*)::integer from public.contacts $$, array[0], 'another user sees none of her contacts');
select tests.clear_authentication();

select * from finish();
rollback;

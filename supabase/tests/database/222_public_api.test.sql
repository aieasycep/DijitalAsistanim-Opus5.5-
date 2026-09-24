-- pgTAP · public-api data layer: web tickets, inbound support replies, deletion requests with OTP
-- lockout, deletion status, plans, referral resolve and web analytics (API_CONTRACTS PUB-01…PUB-08).
begin;
select plan(40);

select tests.create_user('Deniz@Public.test');
select tests.create_user('ece@public.test');
select tests.create_admin('boss@admin.test', 'super_admin');
select tests.clear_authentication();

create temporary table px (k text primary key, id uuid, v text) on commit drop;
grant select on px to authenticated;

-- ─── PUB-01 · web support tickets ─────────────────────────────────────────────────────────────
insert into px (k, v)
select 't1', public.public_support_ticket('web@example.com', 'Web Kullanıcı', 'billing', 'Faturalandırma',
                                          'Aboneliğim görünmüyor, yardım eder misiniz?') ->> 'reference';
select matches((select v from px where k = 't1'), '^DA-\d{4}-\d{6}$', 'the reference is the ticket public_ref');
select results_eq($$ select origin, platform, user_id is null, status::text, contact_name from public.support_tickets
                     where public_ref = (select v from px where k = 't1') $$,
                  $$ values ('web'::text, 'web'::text, true, 'open'::text, 'Web Kullanıcı'::text) $$,
                  'a web ticket is open, unlinked (never matched by e-mail) and keeps the optional name');
select is(public.public_support_ticket('WEB@example.com', null, 'billing', 'Faturalandırma',
                                       'Aboneliğim görünmüyor, yardım eder misiniz?') ->> 'reference',
          (select v from px where k = 't1'), 'the same e-mail and message within 10 minutes returns the same reference');
select isnt(public.public_support_ticket('web@example.com', null, 'other', 'Diğer', 'Başka bir konu hakkında yazıyorum.')
              ->> 'reference', (select v from px where k = 't1'), 'a different message is a new ticket');

-- ─── PUB-08 · inbound replies ─────────────────────────────────────────────────────────────────
update public.support_tickets set status = 'waiting_user' where public_ref = (select v from px where k = 't1');
select is((public.support_inbound_note('<m1@mail>', (select v from px where k = 't1'), 'web@example.com',
                                       'Hâlâ görünmüyor.', null) ->> 'stored')::boolean, true,
          'a reply from the ticket''s contact e-mail is stored');
select is((select status::text from public.support_tickets where public_ref = (select v from px where k = 't1')), 'open',
          'the ticket moves waiting_user → open');
select results_eq($$ select kind, author_admin_id is null, body from public.support_notes
                     where ticket_id = (select id from public.support_tickets where public_ref = (select v from px where k = 't1')) $$,
                  $$ values ('inbound_reply'::text, true, 'Hâlâ görünmüyor.'::text) $$, 'stored as an inbound_reply note');
select is(public.support_inbound_note('<m1@mail>', (select v from px where k = 't1'), 'web@example.com', 'Hâlâ görünmüyor.', null)
            ->> 'reason', 'duplicate', 'a replayed message id stores nothing');
select is(public.support_inbound_note('<m2@mail>', (select v from px where k = 't1'), 'intruder@example.com', 'Merhaba', null)
            ->> 'reason', 'sender_mismatch', 'a different sender is ignored');
select is(public.support_inbound_note('<m3@mail>', 'DA-1999-000001', 'web@example.com', 'Merhaba', null) ->> 'reason',
          'ticket_not_found', 'an unknown reference is ignored');
select is((select count(*)::integer from public.support_notes
           where ticket_id = (select id from public.support_tickets where public_ref = (select v from px where k = 't1'))), 1,
          'only the matching reply was stored');
select throws_ok($$ insert into public.support_notes (ticket_id, kind, body)
                    values ((select id from public.support_tickets limit 1), 'internal', 'x') $$,
                 '23514', null, 'an internal note needs an admin author');
insert into px (k, id) select 't1id', id from public.support_tickets where public_ref = (select v from px where k = 't1');
select tests.authenticate_as_admin('super_admin', 'aal2', 'boss@admin.test');
select is(admin_api.ticket_detail((select id from px where k = 't1id'))
            #>> '{notes,0,kind}', 'inbound_reply', 'the backoffice ticket detail lists inbound replies');
select tests.clear_authentication();

-- ─── PUB-02 / PUB-03 · deletion ───────────────────────────────────────────────────────────────
select is(public.public_deletion_subject('deniz@public.test') ->> 'user_id', tests.user_id('Deniz@Public.test')::text,
          'the account is found case-insensitively');
select is(public.public_deletion_subject('nobody@public.test'), null::jsonb, 'an unknown e-mail has no subject');
select is((public.public_deletion_subject('boss@admin.test') ->> 'is_admin')::boolean, true,
          'admin identities are recognised (they never receive a code)');

select is(public.public_otp_lock_seconds('subject-a'), 0, 'no lock before failures');
select is((public.public_otp_record_failure('subject-a') ->> 'locked')::boolean, false, 'one failure does not lock');
select public.public_otp_record_failure('subject-a');
select public.public_otp_record_failure('subject-a');
select is((public.public_otp_record_failure('subject-a') ->> 'failures')::integer, 4, 'failures are counted per subject');
select is((public.public_otp_record_failure('subject-a') ->> 'locked')::boolean, true, 'the fifth failure in 15 minutes locks');
select ok(public.public_otp_lock_seconds('subject-a') between 3500 and 3600, 'the lock holds for one hour');
select is(public.public_otp_lock_seconds('subject-b'), 0, 'other subjects are unaffected');

select tests.make_installation(tests.user_id('Deniz@Public.test'));
insert into public.push_tokens (user_id, installation_id, expo_push_token)
select tests.user_id('Deniz@Public.test'), i.id, 'ExponentPushToken[deniz]' from public.app_installations i
where i.user_id = tests.user_id('Deniz@Public.test');
insert into px (k, id)
select 'del', (public.create_deletion_request(tests.user_id('Deniz@Public.test'), 'account', 'web_otp', 'email_otp',
                                              sha256('token-1'::bytea), sha256('deniz'::bytea), null, null, 'web') ->> 'request_id')::uuid;
select results_eq($$ select kind::text, status::text, origin, confirmation_method, subject_hash = private.hash_subject(user_id)
                     from public.data_deletion_requests where id = (select id from px where k = 'del') $$,
                  $$ values ('account'::text, 'queued'::text, 'web_otp'::text, 'email_otp'::text, true) $$,
                  'a web OTP account deletion request is queued with its subject hash');
select is((select state::text from public.profiles where user_id = tests.user_id('Deniz@Public.test')), 'deletion_pending',
          'the profile is deletion_pending (the api gate now answers ACCOUNT_DELETION_PENDING)');
select is((select status from public.push_tokens where user_id = tests.user_id('Deniz@Public.test')), 'disabled',
          'push tokens are disabled');
select results_eq($$ select type::text, user_id is null, payload ->> 'source' from public.jobs
                     where idempotency_key = 'account_deletion:' || (select id from px where k = 'del') $$,
                  $$ values ('account_deletion'::text, true, 'web'::text) $$, 'JOB-23 is enqueued for the request');
select is((select count(*)::integer from public.audit_logs where action = 'user.privacy.account_deletion_requested'
           and target_id = (select id from px where k = 'del')::text), 1, 'the request is audited');
select is(public.create_deletion_request(tests.user_id('Deniz@Public.test'), 'account', 'web_otp', 'email_otp',
                                         sha256('token-2'::bytea)) ->> 'request_id', (select id from px where k = 'del')::text,
          'a second request returns the active one');
select is((select status_token_hash from public.data_deletion_requests where id = (select id from px where k = 'del')),
          sha256('token-2'::bytea), 'and rotates its status token to the new holder');
select is(public.create_deletion_request(tests.user_id('ece@public.test'), 'history', 'app', 'reauth', null) #>> '{status}',
          'queued', 'an in-app history deletion is queued');
select is((select payload ->> 'scope' from public.jobs where type = 'history_deletion' and user_id = tests.user_id('ece@public.test')),
          'all_analysis', 'JOB-22 is enqueued with the all_analysis scope');

-- ─── PUB-07 · status ──────────────────────────────────────────────────────────────────────────
select is(public.public_deletion_status((select id from px where k = 'del')) ->> 'status_token_hash',
          encode(sha256('token-2'::bytea), 'hex'), 'the status read carries the token hash for the constant-time compare');
select ok(not (public.public_deletion_status((select id from px where k = 'del')) ?| array['user_id', 'email', 'subject_hash']),
          'the status never carries identifiers');
select is(public.public_deletion_status(gen_random_uuid()), null::jsonb, 'an unknown id has no status');

-- ─── PUB-05 · plans, PUB-04 · referral resolve, PUB-06 · web analytics ───────────────────────
select is(public.public_plans() -> 'free', '{"max_calendars": 1, "max_mail_accounts": 1, "ai_daily_budget_units": 50}'::jsonb,
          'plans mirror the Free plan_limits');
select is((public.public_referral_resolve((select code from public.referral_codes where user_id = tests.user_id('ece@public.test')))
            ->> 'valid')::boolean, true, 'an active code resolves');
select is((public.public_referral_resolve('2222222') ->> 'valid')::boolean, false, 'an unknown code is not valid');
select is((select count(*)::integer from public.analytics_events where event_name = 'referral_link_opened' and user_id is null), 1,
          'a valid open is counted without any identifier');
select public.web_analytics_increment(current_date, 'web_page_view', '{"page": "/", "locale": "tr"}');
select public.web_analytics_increment(current_date, 'web_page_view', '{"locale": "tr", "page": "/"}');
select is((select count from public.web_analytics_daily where event = 'web_page_view' and day = current_date), 2::bigint,
          'equal dimensions share one counter');
select ok(not has_function_privilege('anon', 'public.public_support_ticket(extensions.citext, text, public.ticket_category, text, text)',
                                     'execute')
          and not has_function_privilege('authenticated', 'public.create_deletion_request(uuid, public.deletion_kind, text, text, bytea, bytea, text, uuid, text, uuid)',
                                         'execute'),
          'the public-api data functions are service-role only');

select * from finish();
rollback;

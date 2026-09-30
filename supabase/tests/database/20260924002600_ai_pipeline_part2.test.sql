-- pgTAP · AI pipeline part 2 (IMPLEMENTATION_PLAN T-5.09…T-5.15; migrations 20260924002600,
-- 20260924002610, 20260924002690): client-id uniqueness of assistant threads and meeting notes,
-- the widened reply-draft caps, the First Analysis counters from stored rows (JOB-13, API-ONB-02),
-- the capture discard (API-CAP-05), the reply attachment MIME types of the captures bucket, the
-- prompt-version seed of the part-2 keys and the service-role-only wrappers.
begin;
select plan(23);

select tests.create_user('ai2@pipeline.test');
select tests.create_user('ai2b@pipeline.test');
select tests.make_account(tests.user_id('ai2@pipeline.test'), 'ai2@pipeline.test');

create temporary table ctx (k text primary key, v text) on commit drop;
insert into ctx values ('user', tests.user_id('ai2@pipeline.test')::text);
insert into ctx values ('account', (select id::text from public.connected_accounts
                                    where user_id = tests.user_id('ai2@pipeline.test')));

-- ── client ids ─────────────────────────────────────────────────────────────────────────────
insert into public.assistant_threads (user_id, client_thread_id)
values ((select v::uuid from ctx where k = 'user'), '11111111-1111-4111-8111-111111111111');
select throws_ok($$ insert into public.assistant_threads (user_id, client_thread_id)
                    values ((select v::uuid from ctx where k = 'user'), '11111111-1111-4111-8111-111111111111') $$,
                 '23505', null, 'assistant_threads: client_thread_id is unique per user');
select lives_ok($$ insert into public.assistant_threads (user_id, client_thread_id)
                   values (tests.user_id('ai2b@pipeline.test'), '11111111-1111-4111-8111-111111111111') $$,
                'assistant_threads: the same client id is fine for another user');

insert into ctx values ('calendar', tests.make_calendar((select v::uuid from ctx where k = 'user'),
                                                       (select v::uuid from ctx where k = 'account'))::text);
insert into ctx values ('event', tests.make_event((select v::uuid from ctx where k = 'user'),
  (select v::uuid from ctx where k = 'account'), (select v::uuid from ctx where k = 'calendar'), 'Teklif görüşmesi',
  now() + interval '2 hours', now() + interval '3 hours',
  '[{"email": "mehmet@yilmazendustri.example", "name": "Mehmet Yılmaz"}]'::jsonb)::text);
insert into public.meeting_notes (user_id, calendar_event_id, kind, body, input, client_note_id)
values ((select v::uuid from ctx where k = 'user'), (select v::uuid from ctx where k = 'event'), 'prep_note',
        'Fiyatı sor.', 'text', '22222222-2222-4222-8222-222222222222');
select throws_ok($$ insert into public.meeting_notes (user_id, calendar_event_id, kind, body, input, client_note_id)
                    values ((select v::uuid from ctx where k = 'user'), (select v::uuid from ctx where k = 'event'),
                            'prep_note', 'Tekrar', 'text', '22222222-2222-4222-8222-222222222222') $$,
                 '23505', null, 'meeting_notes: client_note_id is unique per user');
select isnt((select expires_at from public.meeting_notes where client_note_id = '22222222-2222-4222-8222-222222222222'),
            null, 'meeting_notes: retention expires_at is set');

-- ── reply drafts ───────────────────────────────────────────────────────────────────────────
insert into ctx values ('thread', tests.make_thread((select v::uuid from ctx where k = 'user'),
                                                   (select v::uuid from ctx where k = 'account'), 'Revize teklif')::text);
select lives_ok($$
  insert into public.reply_drafts (user_id, thread_id, connected_account_id, tone, to_emails, subject, body, generated_by,
                                   source_id, source_provider, source_timestamp, confidence, language, warnings,
                                   facts_used, content_key)
  values ((select v::uuid from ctx where k = 'user'), (select v::uuid from ctx where k = 'thread'),
          (select v::uuid from ctx where k = 'account'), 'detailed', '{mehmet@yilmazendustri.example}',
          'Re: ' || repeat('x', 600), repeat('Uzun taslak. ', 1200), 'ai', 'thread', 'google', now(), 0.8, 'tr',
          '{contains_commitment}', '[]', 'k1') $$,
  'reply_drafts: body up to 20,000 and subject up to 998 characters');
select throws_ok($$
  insert into public.reply_drafts (user_id, thread_id, connected_account_id, tone, to_emails, body, generated_by,
                                   source_id, source_provider, source_timestamp, confidence, language)
  values ((select v::uuid from ctx where k = 'user'), (select v::uuid from ctx where k = 'thread'),
          (select v::uuid from ctx where k = 'account'), 'short', '{a@b.example}', 'x', 'ai', 'thread', 'google', now(),
          0.8, 'de') $$,
  '23514', null, 'reply_drafts: language is tr or en');
select has_index('public', 'reply_drafts', 'reply_drafts_user_id_content_key_idx', 'reply_drafts: content-reuse index');

-- ── First Analysis counts ─────────────────────────────────────────────────────────────────
select tests.make_message((select v::uuid from ctx where k = 'user'), (select v::uuid from ctx where k = 'account'),
                          (select v::uuid from ctx where k = 'thread'), 'Revize teklif', 'mehmet@yilmazendustri.example',
                          now() - interval '2 hours');
select tests.make_message((select v::uuid from ctx where k = 'user'), (select v::uuid from ctx where k = 'account'),
                          (select v::uuid from ctx where k = 'thread'), 'Kampanya', 'kampanya@shop.example',
                          now() - interval '10 hours');
select tests.make_message((select v::uuid from ctx where k = 'user'), (select v::uuid from ctx where k = 'account'),
                          (select v::uuid from ctx where k = 'thread'), 'Eski', 'eski@shop.example',
                          now() - interval '5 days');
update public.email_messages set classification = 'awaiting_my_reply', ai_status = 'classified'
where user_id = (select v::uuid from ctx where k = 'user') and subject = 'Revize teklif';
update public.email_messages set classification = 'low_priority', ai_status = 't0_final'
where user_id = (select v::uuid from ctx where k = 'user') and subject = 'Kampanya';
update public.email_threads set reply_state = 'awaiting_their_reply', last_message_at = now() - interval '1 hour'
where id = (select v::uuid from ctx where k = 'thread');

insert into ctx values ('counts', public.first_analysis_counts((select v::uuid from ctx where k = 'user'),
                                                               now() - interval '72 hours', now())::text);
select is(((select v from ctx where k = 'counts')::jsonb ->> 'mails_found')::integer, 2,
          'first_analysis_counts: only inbound mail of the last 72 h');
select is(((select v from ctx where k = 'counts')::jsonb ->> 'classified')::integer, 2,
          'first_analysis_counts: classified counts T0 and T1 results');
select is(((select v from ctx where k = 'counts')::jsonb ->> 'potential_important')::integer, 1,
          'first_analysis_counts: important / awaiting reply / deadline');
select is(((select v from ctx where k = 'counts')::jsonb ->> 'upcoming_events')::integer, 1,
          'first_analysis_counts: events in the next 48 h');
select is(((select v from ctx where k = 'counts')::jsonb ->> 'possible_followups')::integer, 1,
          'first_analysis_counts: threads awaiting the other side');
select is((public.first_analysis_counts(tests.user_id('ai2b@pipeline.test'), now() - interval '72 hours', now())
           ->> 'mails_found')::integer, 0, 'first_analysis_counts: scoped to the user');

-- ── capture discard ───────────────────────────────────────────────────────────────────────
insert into public.captures (id, user_id, kind, status, storage_path, mime_type, size_bytes, idempotency_key, share_origin)
values ('33333333-3333-4333-8333-333333333333', (select v::uuid from ctx where k = 'user'), 'photo', 'analyzing',
        (select v from ctx where k = 'user') || '/33333333-3333-4333-8333-333333333333/a.jpg', 'image/jpeg', 1000,
        'client-1', 'in_app');
select public.enqueue_job('capture_analysis', 'capture_analysis:33333333-3333-4333-8333-333333333333:1',
                          '{"capture_id": "33333333-3333-4333-8333-333333333333"}'::jsonb,
                          (select v::uuid from ctx where k = 'user'), null, now(), 50::smallint, 3, null);
insert into ctx values ('approval', tests.make_approval((select v::uuid from ctx where k = 'user'))::text);
update public.approval_actions set batch_id = '33333333-3333-4333-8333-333333333333', origin = 'capture'
where id = (select v::uuid from ctx where k = 'approval');

insert into ctx values ('discard', public.discard_capture((select v::uuid from ctx where k = 'user'),
                                                         '33333333-3333-4333-8333-333333333333')::text);
select is((select status::text from public.captures where id = '33333333-3333-4333-8333-333333333333'), 'discarded',
          'discard_capture: status discarded');
select isnt((select file_deleted_at from public.captures where id = '33333333-3333-4333-8333-333333333333'), null,
            'discard_capture: file_deleted_at set');
select is((select v from ctx where k = 'discard')::jsonb ->> 'storage_path',
          (select v from ctx where k = 'user') || '/33333333-3333-4333-8333-333333333333/a.jpg',
          'discard_capture: returns the object path to delete');
select results_eq($$ select status::text, last_error_code from public.jobs
                     where idempotency_key = 'capture_analysis:33333333-3333-4333-8333-333333333333:1' $$,
                  $$ values ('failed'::text, 'CANCELLED'::text) $$, 'discard_capture: the queued analysis is cancelled');
select results_eq($$ select status::text, rejection_reason from public.approval_actions
                     where id = (select v::uuid from ctx where k = 'approval') $$,
                  $$ values ('rejected'::text, 'user_cancel'::text) $$, 'discard_capture: pending batch approvals rejected');
select is((public.discard_capture((select v::uuid from ctx where k = 'user'), '33333333-3333-4333-8333-333333333333')
           ->> 'changed')::boolean, false, 'discard_capture: a second discard is a no-op');
select throws_ok($$ select public.discard_capture(tests.user_id('ai2b@pipeline.test'),
                                                  '33333333-3333-4333-8333-333333333333') $$,
                 'P0002', null, 'discard_capture: another user gets NOT_FOUND');

-- ── storage, prompt seed, grants ──────────────────────────────────────────────────────────
select ok((select 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' = any (allowed_mime_types)
           from storage.buckets where id = 'captures'), 'captures bucket accepts docx reply attachments');
select is((select count(*)::integer from public.prompt_versions
           where status = 'active' and prompt_key in ('post_meeting', 'follow_up', 'meeting_prep', 'capture',
                                                      'capture_vision', 'capture_pdf', 'assistant_intent', 'assistant',
                                                      'reply_draft')), 9,
          'prompt_versions: every part-2 key has an active version');
select ok(not has_function_privilege('authenticated', 'public.discard_capture(uuid, uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.first_analysis_counts(uuid, timestamptz, timestamptz)',
                                         'execute'),
          'wrappers: not executable by authenticated');

select * from finish();
rollback;

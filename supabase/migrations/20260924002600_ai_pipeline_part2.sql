-- Migration 20260924002600 · AI pipeline part 2 (IMPLEMENTATION_PLAN T-5.09…T-5.15; API_CONTRACTS
-- API-BRF-01, API-MEET-01…04, API-AST-01…03, API-MAIL-02…06/08, API-CAP-01…05, API-PLAN-01…04,
-- API-ONB-01/02; JOB-13, JOB-15, JOB-27, JOB-30).
--
-- 1. Client ids of the idempotent creates: `assistant_threads.client_thread_id` (API-AST-01) and
--    `meeting_notes.client_note_id` (API-MEET-02/03), unique per user.
-- 2. `reply_drafts`: language, warnings, the grounding facts and the content-reuse key of API-MAIL-02
--    (`(message, tone, language, instructions_hash, last message)` within 10 min); the body and
--    subject caps follow the API contract (body ≤ 20,000, subject ≤ 998; widened NOT VALID and
--    validated in 20260924002690).
-- 3. `captures.link_preview` (title and domain only) and `insights.payload` (the 5-minute cache of
--    the conflict options of API-PLAN-03).
-- 4. The private `captures` bucket also accepts the Office attachments of API-MAIL-08.
-- 5. `first_analysis_counts` (JOB-13 / API-ONB-02: every count comes from stored rows) and
--    `discard_capture` (API-CAP-05: status, queued job, pending batch approvals in one transaction),
--    each with a service-role-only `public` wrapper.

set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- ─── 1 · client ids ───────────────────────────────────────────────────────────────────────────
alter table public.assistant_threads add column client_thread_id uuid;
-- Each migration runs in one transaction, where CONCURRENTLY is impossible; the tables are small
-- per user and the partial indexes only cover rows written by the new routes.
-- squawk-ignore require-concurrent-index-creation
create unique index assistant_threads_user_id_client_thread_id_key
  on public.assistant_threads (user_id, client_thread_id) where client_thread_id is not null;

alter table public.meeting_notes add column client_note_id uuid;
-- squawk-ignore require-concurrent-index-creation
create unique index meeting_notes_user_id_client_note_id_key
  on public.meeting_notes (user_id, client_note_id) where client_note_id is not null;

-- ─── 2 · reply drafts ─────────────────────────────────────────────────────────────────────────
alter table public.reply_drafts
  add column language text,
  add column warnings text[],
  add column facts_used jsonb,
  add column content_key text;
alter table public.reply_drafts
  add constraint reply_drafts_language_check check (language is null or language in ('tr', 'en')) not valid;
alter table public.reply_drafts
  add constraint reply_drafts_facts_used_check check (facts_used is null or jsonb_typeof(facts_used) = 'array') not valid;
alter table public.reply_drafts drop constraint reply_drafts_body_check;
alter table public.reply_drafts
  add constraint reply_drafts_body_check check (char_length(body) between 1 and 20000) not valid;
alter table public.reply_drafts drop constraint reply_drafts_subject_check;
alter table public.reply_drafts
  add constraint reply_drafts_subject_check check (char_length(subject) <= 998) not valid;
-- squawk-ignore require-concurrent-index-creation
create index reply_drafts_user_id_content_key_idx
  on public.reply_drafts (user_id, content_key, created_at desc) where content_key is not null;
comment on column public.reply_drafts.content_key is
  'sha256 of (message, tone, language, instructions, last thread message): API-MAIL-02 content reuse within 10 min.';

-- ─── 3 · capture link preview, insight payload ───────────────────────────────────────────────
alter table public.captures add column link_preview jsonb;
alter table public.captures
  add constraint captures_link_preview_check check (link_preview is null or jsonb_typeof(link_preview) = 'object') not valid;
alter table public.insights add column payload jsonb;
alter table public.insights
  add constraint insights_payload_check check (payload is null or jsonb_typeof(payload) = 'object') not valid;

-- Column privileges of `authenticated` are per column (20260924001400): the new columns are
-- readable by their owner like the rest of each row (RLS still limits rows to the owner).
grant select (client_thread_id) on table public.assistant_threads to authenticated;
grant select (client_note_id) on table public.meeting_notes to authenticated;
grant select (language, warnings, facts_used, content_key) on table public.reply_drafts to authenticated;
grant select (link_preview) on table public.captures to authenticated;
grant select (payload) on table public.insights to authenticated;

-- ─── 4 · storage: reply attachments ───────────────────────────────────────────────────────────
update storage.buckets
  set allowed_mime_types = array[
    'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf', 'text/plain',
    'audio/mp4', 'audio/aac', 'audio/mpeg', 'application/json',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
where id = 'captures';

-- ─── 5 · First Analysis counts (JOB-13, API-ONB-02) ───────────────────────────────────────────
-- mails_found: inbound mail received in [p_since, p_now]; classified: those past the T0/T1 stage;
-- potential_important: classified important / awaiting reply / with a deadline; upcoming_events:
-- non-cancelled events starting in the next 48 h; possible_followups: threads awaiting the other
-- side's reply with activity in the window.
create function private.first_analysis_counts(p_user uuid, p_since timestamptz, p_now timestamptz)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
  as $$
    select jsonb_build_object(
      'mails_found', (
        select count(*) from public.email_messages m
        where m.user_id = p_user and m.direction = 'inbound' and m.provider_deleted_at is null
          and m.received_at >= p_since and m.received_at <= p_now),
      'classified', (
        select count(*) from public.email_messages m
        where m.user_id = p_user and m.direction = 'inbound' and m.provider_deleted_at is null
          and m.received_at >= p_since and m.received_at <= p_now
          and m.ai_status in ('t0_final', 'classified', 'skipped_source_control', 'skipped_budget', 'skipped_flag', 'failed')),
      'potential_important', (
        select count(*) from public.email_messages m
        where m.user_id = p_user and m.direction = 'inbound' and m.provider_deleted_at is null
          and m.received_at >= p_since and m.received_at <= p_now
          and m.classification in ('important', 'awaiting_my_reply', 'has_deadline')),
      'upcoming_events', (
        select count(*) from public.calendar_events e
        where e.user_id = p_user and e.status <> 'cancelled' and e.provider_deleted_at is null
          and e.start_at >= p_now and e.start_at < p_now + interval '48 hours'),
      'possible_followups', (
        select count(*) from public.email_threads t
        where t.user_id = p_user and t.reply_state = 'awaiting_their_reply'
          and t.last_message_at >= p_since and t.last_message_at <= p_now)
    )
  $$;
comment on function private.first_analysis_counts(uuid, timestamptz, timestamptz) is
  'First Analysis counters from stored rows only (JOB-13, API-ONB-02; "every count comes from real data").';

-- ─── 6 · capture discard (API-CAP-05) ─────────────────────────────────────────────────────────
-- Any non-terminal capture becomes `discarded` with `file_deleted_at`; its queued or retrying
-- `capture_analysis` job fails with CANCELLED (a running job re-checks the status before it
-- persists); pending approvals of the capture batch are rejected `user_cancel`. Returns the capture
-- row and the storage path the caller deletes. Terminal captures are returned unchanged.
create function private.discard_capture(p_user uuid, p_capture_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  c public.captures;
  v_path text;
  v_approval uuid;
  v_rejected integer := 0;
begin
  select * into c from public.captures x where x.id = p_capture_id and x.user_id = p_user for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if c.status in ('discarded', 'actioned') then
    return jsonb_build_object('capture', to_jsonb(c), 'storage_path', null, 'rejected', 0, 'changed', false);
  end if;
  v_path := case when c.file_deleted_at is null then c.storage_path end;
  update public.captures x
    set status = 'discarded', file_deleted_at = coalesce(x.file_deleted_at, now()),
        progress = x.progress || jsonb_build_object('discarded_at', now())
  where x.id = c.id
  returning * into c;
  update public.jobs j
    set status = 'failed', last_error_code = 'CANCELLED', last_error_message = 'user_cancel',
        lease_owner = null, lease_expires_at = null, completed_at = now()
  where j.type = 'capture_analysis' and j.user_id = p_user
    and j.idempotency_key like 'capture_analysis:' || c.id || ':%'
    and j.status in ('queued', 'retrying');
  for v_approval in
    select a.id from public.approval_actions a
    where a.user_id = p_user and a.batch_id = c.id and a.status = 'pending'
    order by a.created_at, a.id
  loop
    perform private.transition_approval(v_approval, 'rejected', 'user', p_user, null, 'user_cancel');
    v_rejected := v_rejected + 1;
  end loop;
  return jsonb_build_object('capture', to_jsonb(c), 'storage_path', v_path, 'rejected', v_rejected, 'changed', true);
end
$$;
comment on function private.discard_capture(uuid, uuid) is
  'API-CAP-05: discards a capture, cancels its queued analysis and rejects pending batch approvals.';

-- ─── 7 · service-role wrappers ────────────────────────────────────────────────────────────────
create function public.first_analysis_counts(p_user uuid, p_since timestamptz, p_now timestamptz)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = ''
  as $$ select private.first_analysis_counts(p_user, p_since, p_now) $$;
comment on function public.first_analysis_counts(uuid, timestamptz, timestamptz) is
  'Service-role wrapper: First Analysis counters (JOB-13, API-ONB-02).';

create function public.discard_capture(p_user uuid, p_capture_id uuid)
  returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.discard_capture(p_user, p_capture_id) $$;
comment on function public.discard_capture(uuid, uuid) is
  'Service-role wrapper: API-CAP-05 capture discard.';

revoke execute on function
  private.first_analysis_counts(uuid, timestamptz, timestamptz),
  private.discard_capture(uuid, uuid)
  from public;

revoke execute on function
  public.first_analysis_counts(uuid, timestamptz, timestamptz),
  public.discard_capture(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.first_analysis_counts(uuid, timestamptz, timestamptz),
  public.discard_capture(uuid, uuid)
  to service_role;

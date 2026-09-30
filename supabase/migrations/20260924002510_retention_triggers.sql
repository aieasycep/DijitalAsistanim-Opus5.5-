-- Migration · retention triggers and sweeps (IMPLEMENTATION_PLAN T-11.04; the WBS file name
-- `…_retention_triggers.sql` placed in this task's range).
-- Spec: docs/API_CONTRACTS.md JOB-20; docs/SECURITY_AND_PRIVACY_PLAN.md §4.5; docs/DATABASE_AND_RLS_PLAN.md
-- §4.8, §6.4, §8.
--
-- Already in place and reused as they are: the BEFORE INSERT `set_expires_at` triggers, the
-- retention-change trigger `trg_user_preferences_retention_changed` (0013: it enqueues the
-- `retention` recompute job, key retention_recompute:{user}:{ms}, and audits privacy.retention_changed),
-- `private.recompute_expires_at` and `private.retention_cleanup`. This migration adds:
--   1. `trg_*_purge_memory` AFTER DELETE statement triggers: whenever a source row goes (retention,
--      history deletion, integration purge, provider deletion), the memory chunks and their
--      embeddings derived from it go in the same statement, so embeddings never outlive their source;
--   2. `private.retention_orphan_objects`: Storage objects the sweep removes through the Storage
--      API (objects without a row after 24 h, transient worker files after 24 h, briefing audio
--      after 7 days); hosted Supabase forbids SQL deletes on storage.objects, so this only reads;
--   3. `private.retention_system_sweep`: the system schedules that `retention_cleanup` does not
--      cover (job_attempts 30 days).

set local lock_timeout = '10s';
set local statement_timeout = '10min';

-- ═══ 1. Embeddings go with their source ═══════════════════════════════════════════════════════
-- TG_ARGV lists the memory_chunks.source_type values that point at the deleted table's ids.
create function private.purge_memory_of_deleted_sources() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  delete from public.memory_chunks m
  using old_rows o
  where m.user_id = o.user_id
    and m.source_type = any(tg_argv::public.source_type[])
    and m.source_id = o.id::text;
  return null;
end
$$;
revoke execute on function private.purge_memory_of_deleted_sources() from public;

create trigger trg_email_messages_purge_memory after delete on public.email_messages
  referencing old table as old_rows for each statement
  execute function private.purge_memory_of_deleted_sources('email_message');
create trigger trg_email_threads_purge_memory after delete on public.email_threads
  referencing old table as old_rows for each statement
  execute function private.purge_memory_of_deleted_sources('email_thread');
create trigger trg_calendar_events_purge_memory after delete on public.calendar_events
  referencing old table as old_rows for each statement
  execute function private.purge_memory_of_deleted_sources('calendar_event', 'device_calendar_event');
create trigger trg_captures_purge_memory after delete on public.captures
  referencing old table as old_rows for each statement
  execute function private.purge_memory_of_deleted_sources('capture');
create trigger trg_meeting_notes_purge_memory after delete on public.meeting_notes
  referencing old table as old_rows for each statement
  execute function private.purge_memory_of_deleted_sources('meeting_note', 'post_meeting_note');
create trigger trg_commitments_purge_memory after delete on public.commitments
  referencing old table as old_rows for each statement
  execute function private.purge_memory_of_deleted_sources('commitment');
create trigger trg_life_events_purge_memory after delete on public.life_events
  referencing old table as old_rows for each statement
  execute function private.purge_memory_of_deleted_sources('life_event');
create trigger trg_contacts_purge_memory after delete on public.contacts
  referencing old table as old_rows for each statement
  execute function private.purge_memory_of_deleted_sources('contact');
create trigger trg_briefings_purge_memory after delete on public.briefings
  referencing old table as old_rows for each statement
  execute function private.purge_memory_of_deleted_sources('briefing');
create trigger trg_assistant_messages_purge_memory after delete on public.assistant_messages
  referencing old table as old_rows for each statement
  execute function private.purge_memory_of_deleted_sources('assistant_message');
create trigger trg_android_notification_signals_purge_memory after delete on public.android_notification_signals
  referencing old table as old_rows for each statement
  execute function private.purge_memory_of_deleted_sources('android_notification');

-- ═══ 2. Storage objects the retention run removes through the Storage API ═════════════════════
-- Returns {captures:[…], "briefing-audio":[…], exports:[…]} (≤ p_limit per bucket), oldest first:
-- - captures: an original or reply attachment whose row is gone (or whose file was already marked
--   deleted, R-09) and worker transient files (voice-tmp/, tmp/) older than 24 h;
-- - briefing-audio: audio of a deleted briefing or meeting prep older than 24 h, and every audio
--   object older than 7 days (SECURITY_AND_PRIVACY_PLAN §4.5); the briefing is set back to
--   audio_status 'none' so the app asks for a fresh render instead of a missing object;
-- - exports: any archive older than 24 h that is not a `ready` export (expired, failed, cancelled
--   or never finalised).
create function private.retention_orphan_objects(p_now timestamptz default now(), p_limit integer default 1000)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 5000);
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_captures text[];
  v_audio text[];
  v_exports text[];
  v_briefings uuid[];
begin
  select coalesce(array_agg(x.name order by x.created_at), '{}') into v_captures from (
    select o.name, o.created_at from storage.objects o
    where o.bucket_id = 'captures' and o.created_at < p_now - interval '24 hours'
      and (split_part(o.name, '/', 2) in ('voice-tmp', 'tmp')
           or (split_part(o.name, '/', 2) = 'replies'
               and not exists (select 1 from public.reply_drafts r
                               where split_part(o.name, '/', 3) ~* v_uuid and r.id = split_part(o.name, '/', 3)::uuid))
           or (split_part(o.name, '/', 2) not in ('voice-tmp', 'tmp', 'replies')
               and not exists (select 1 from public.captures c
                               where split_part(o.name, '/', 2) ~* v_uuid and c.id = split_part(o.name, '/', 2)::uuid
                                 and c.storage_path = o.name and c.file_deleted_at is null)))
    order by o.created_at limit v_limit) x;

  select coalesce(array_agg(x.name order by x.created_at), '{}') into v_audio from (
    select o.name, o.created_at from storage.objects o
    where o.bucket_id = 'briefing-audio'
      and (o.created_at < p_now - interval '7 days'
           or (o.created_at < p_now - interval '24 hours'
               and ((split_part(o.name, '/', 2) = 'meeting_prep'
                     and not exists (select 1 from public.meeting_preps m
                                     where split_part(o.name, '/', 3) ~* v_uuid and m.id = split_part(o.name, '/', 3)::uuid))
                    or (split_part(o.name, '/', 2) <> 'meeting_prep'
                        and not exists (select 1 from public.briefings b
                                        where split_part(o.name, '/', 2) ~* v_uuid and b.id = split_part(o.name, '/', 2)::uuid)))))
    order by o.created_at limit v_limit) x;

  select coalesce(array_agg(distinct split_part(p, '/', 2)::uuid), '{}') into v_briefings
  from unnest(v_audio) as u (p)
  where split_part(p, '/', 2) ~* v_uuid;
  update public.briefings b
    set audio_status = 'none', audio_storage_path = null, audio_duration_s = null, audio_chapters = '[]'::jsonb
  where b.id = any(v_briefings) and b.audio_status <> 'none';

  select coalesce(array_agg(x.name order by x.created_at), '{}') into v_exports from (
    select o.name, o.created_at from storage.objects o
    where o.bucket_id = 'exports' and o.created_at < p_now - interval '24 hours'
      and not exists (select 1 from public.data_export_requests e
                      where e.storage_path = o.name and e.status = 'ready' and e.expires_at > p_now)
    order by o.created_at limit v_limit) x;

  return jsonb_build_object('captures', to_jsonb(v_captures), 'briefing-audio', to_jsonb(v_audio),
                            'exports', to_jsonb(v_exports));
end
$$;

-- ═══ 3. System schedules outside retention_cleanup ════════════════════════════════════════════
create function private.retention_system_sweep(p_batch integer default 5000, p_now timestamptz default now())
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_batch integer := greatest(coalesce(p_batch, 5000), 1);
  v_n bigint;
begin
  with d as (delete from public.job_attempts t where t.id in (
               select x.id from public.job_attempts x
               where coalesce(x.finished_at, x.started_at) < p_now - interval '30 days' limit v_batch) returning 1)
  select count(*) into v_n from d;
  return jsonb_build_object('job_attempts', v_n);
end
$$;

revoke execute on function
  private.retention_orphan_objects(timestamptz, integer),
  private.retention_system_sweep(integer, timestamptz)
  from public;
grant execute on function
  private.retention_orphan_objects(timestamptz, integer),
  private.retention_system_sweep(integer, timestamptz)
  to service_role;

create function public.retention_orphan_objects(p_now timestamptz default now(), p_limit integer default 1000)
  returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.retention_orphan_objects(p_now, p_limit) $$;

create function public.retention_system_sweep(p_batch integer default 5000, p_now timestamptz default now())
  returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$ select private.retention_system_sweep(p_batch, p_now) $$;

revoke execute on function
  public.retention_orphan_objects(timestamptz, integer),
  public.retention_system_sweep(integer, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.retention_orphan_objects(timestamptz, integer),
  public.retention_system_sweep(integer, timestamptz)
  to service_role;

-- Migration 0016 · storage buckets and storage.objects policies
-- Spec: docs/DATABASE_AND_RLS_PLAN.md §8. All buckets are private. Clients only read their own
-- folder ({user_id}/…) through short-lived signed URLs; uploads use signed upload URLs minted by
-- `api` after validating size, MIME and extension; the worker writes and deletes with the secret
-- key through the Storage API. There are no insert, update or delete policies for clients and
-- nothing at all for anon.

-- Each migration runs in one transaction; never wait long on a lock held by live traffic.
set local lock_timeout = '10s';
set local statement_timeout = '10min';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('captures', 'captures', false, 20971520,
   array['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf', 'text/plain',
         'audio/mp4', 'audio/aac', 'audio/mpeg', 'application/json']),
  ('exports', 'exports', false, 536870912, array['application/zip']),
  ('briefing-audio', 'briefing-audio', false, 20971520, array['audio/mpeg', 'audio/mp4', 'audio/aac'])
on conflict (id) do update
  set name = excluded.name, public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists captures_select_own on storage.objects;
drop policy if exists exports_select_own on storage.objects;
drop policy if exists briefing_audio_select_own on storage.objects;

create policy captures_select_own on storage.objects for select to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy exports_select_own on storage.objects for select to authenticated
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy briefing_audio_select_own on storage.objects for select to authenticated
  using (bucket_id = 'briefing-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);

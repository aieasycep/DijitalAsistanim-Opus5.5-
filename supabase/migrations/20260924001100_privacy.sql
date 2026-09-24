-- Migration 0011 · privacy
-- Spec: docs/DATABASE_AND_RLS_PLAN.md §4.8 (data_export_requests, data_deletion_requests,
-- privacy_tombstones), §10 row 0011; ADR-05, R-16. History deletion of a single account uses
-- data_deletion_requests.scope / connected_account_id (API-PRV-02, IMPLEMENTATION_PLAN T-2.13).

-- ─── data_export_requests ─────────────────────────────────────────────────────────────────────
create table public.data_export_requests (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  status public.export_status not null default 'requested',
  job_id uuid,
  requested_via text not null default 'app' check (requested_via in ('app', 'admin')),
  storage_path text,                                  -- exports/{user_id}/{id}.zip
  file_size_bytes bigint,
  sha256 bytea,
  ready_at timestamptz,
  expires_at timestamptz,                             -- artifact availability: ready_at + 24 h
  downloaded_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint data_export_requests_pkey primary key (id),
  constraint data_export_requests_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
);
create unique index data_export_requests_user_id_in_flight_key on public.data_export_requests (user_id)
  where status in ('requested', 'processing');
create index data_export_requests_status_created_at_idx on public.data_export_requests (status, created_at);
create index data_export_requests_expires_at_p on public.data_export_requests (expires_at) where status = 'ready';
create index data_export_requests_user_id_idx on public.data_export_requests (user_id);
create trigger trg_data_export_requests_updated_at before update on public.data_export_requests
  for each row execute function private.set_updated_at();
alter table public.data_export_requests enable row level security;
alter table public.data_export_requests force row level security;
comment on table public.data_export_requests is
  'Async user export (M§128): JSON per entity in a private bucket, 24 h availability; never tokens, hashes or embeddings.';

-- ─── data_deletion_requests ───────────────────────────────────────────────────────────────────
create table public.data_deletion_requests (
  id uuid not null default gen_random_uuid(),
  user_id uuid,                                       -- survives account deletion (set null)
  subject_hash bytea not null,                        -- private.hash_subject(user_id)
  subject_email_hash bytea,
  kind public.deletion_kind not null,
  status public.deletion_status not null default 'requested',
  origin text not null check (origin in ('app', 'web_otp', 'admin')),
  confirmation_method text not null check (confirmation_method in ('reauth', 'email_otp', 'admin')),
  scope text check (scope in ('all_analysis', 'connected_account')),
  connected_account_id uuid,
  status_token_hash bytea check (octet_length(status_token_hash) = 32),
  reason text check (char_length(reason) <= 500),
  steps jsonb not null default '{}'::jsonb check (jsonb_typeof(steps) = 'object'),
  job_id uuid,
  completed_at timestamptz,
  failed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint data_deletion_requests_pkey primary key (id),
  constraint data_deletion_requests_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null,
  constraint data_deletion_requests_connected_account_id_fkey foreign key (connected_account_id)
    references public.connected_accounts (id) on delete set null,
  -- R-16: history deletion requires the same re-auth as account deletion.
  constraint data_deletion_requests_history_confirmation_check
    check (kind <> 'history' or confirmation_method in ('reauth', 'admin')),
  constraint data_deletion_requests_scope_kind_check check (kind = 'history' or scope is null)
);
create unique index data_deletion_requests_user_id_kind_active_key on public.data_deletion_requests (user_id, kind)
  where status in ('requested', 'verified', 'queued', 'processing');
create index data_deletion_requests_status_created_at_idx on public.data_deletion_requests (status, created_at);
create index data_deletion_requests_subject_hash_idx on public.data_deletion_requests (subject_hash);
create index data_deletion_requests_user_id_idx on public.data_deletion_requests (user_id);
create index data_deletion_requests_connected_account_id_idx on public.data_deletion_requests (connected_account_id);
create trigger trg_data_deletion_requests_updated_at before update on public.data_deletion_requests
  for each row execute function private.set_updated_at();
alter table public.data_deletion_requests enable row level security;
alter table public.data_deletion_requests force row level security;
comment on table public.data_deletion_requests is
  'History and account deletion lifecycle with honest status (M§129); the row survives account deletion via subject_hash (kept 3 years).';

-- ─── privacy_tombstones (SYS) ─────────────────────────────────────────────────────────────────
create table public.privacy_tombstones (
  id bigint generated always as identity,
  kind text not null check (kind in ('email', 'installation', 'apple_sub')),
  signal_hash bytea not null check (octet_length(signal_hash) = 32),
  reason text not null default 'account_deleted' check (reason in ('account_deleted', 'admin_rejected_abuse')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 months',
  constraint privacy_tombstones_pkey primary key (id),
  constraint privacy_tombstones_kind_signal_hash_key unique (kind, signal_hash)
);
create index privacy_tombstones_expires_at_idx on public.privacy_tombstones (expires_at);
alter table public.privacy_tombstones enable row level security;
alter table public.privacy_tombstones force row level security;
comment on table public.privacy_tombstones is
  'Hashed anti-abuse signals kept 12 months after account deletion, never linked to a user id (plan §16). System table.';

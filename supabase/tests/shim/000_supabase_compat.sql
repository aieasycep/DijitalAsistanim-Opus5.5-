-- Tier-C Supabase compatibility shim (docs/DATABASE_AND_RLS_PLAN.md §12, ADR-48).
--
-- Loaded by scripts/db/tier-c.sh BEFORE the migrations on a plain PostgreSQL 16 cluster
-- (pgvector 0.6, pgTAP 1.3, pg_cron 1.6; pg_net is not available). It recreates the minimal
-- subset of the Supabase platform the migrations and pgTAP suites rely on: the API roles, the
-- auth / storage / extensions / net / vault schemas, the GoTrue claim helpers, a minimal
-- auth.users, the storage tables and helpers, a recording net.http_post() and a plaintext vault.
--
-- It is NEVER loaded on tier A (`supabase start` / hosted), where the real objects exist.
-- It is idempotent: roles are cluster-wide and survive database re-creation.

-- ─── Roles ────────────────────────────────────────────────────────────────────────────────────
do $$
begin
  begin create role anon nologin noinherit; exception when duplicate_object then null; end;
  begin create role authenticated nologin noinherit; exception when duplicate_object then null; end;
  begin create role service_role nologin noinherit bypassrls; exception when duplicate_object then null; end;
  begin create role authenticator login noinherit password 'postgres'; exception when duplicate_object then null; end;
  begin create role supabase_auth_admin nologin noinherit; exception when duplicate_object then null; end;
  begin create role supabase_storage_admin nologin noinherit; exception when duplicate_object then null; end;
end
$$;
alter role service_role bypassrls;
grant anon, authenticated, service_role to authenticator;

-- ─── Schemas ──────────────────────────────────────────────────────────────────────────────────
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create schema if not exists net;
create schema if not exists vault;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
grant usage on schema auth to supabase_auth_admin;

-- Supabase's default privileges on schema public (set for the migration role on every hosted
-- and local project): new tables, sequences and functions are granted to the API roles unless a
-- migration revokes them. Mirrored here so tier C catches a missing revoke exactly like tier A.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ─── auth (minimal GoTrue subset) ─────────────────────────────────────────────────────────────
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  aud text default 'authenticated',
  role text default 'authenticated',
  email text unique,
  phone text,
  email_confirmed_at timestamptz,
  last_sign_in_at timestamptz,
  banned_until timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  is_anonymous boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  provider_id text not null,
  identity_data jsonb not null default '{}'::jsonb,
  email text,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (provider_id, provider)
);

create table if not exists auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  aal text not null default 'aal1' check (aal in ('aal1', 'aal2', 'aal3')),
  factor_id uuid,
  not_after timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  friendly_name text,
  factor_type text not null default 'totp' check (factor_type in ('totp', 'phone', 'webauthn')),
  status text not null default 'unverified' check (status in ('unverified', 'verified')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Claim helpers: the same contract as PostgREST/GoTrue (request.jwt.claims GUC).
create or replace function auth.jwt() returns jsonb
  language sql stable
  as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(coalesce(current_setting('request.jwt.claim.sub', true), auth.jwt() ->> 'sub'), '')::uuid $$;

create or replace function auth.role() returns text
  language sql stable
  as $$ select nullif(coalesce(current_setting('request.jwt.claim.role', true), auth.jwt() ->> 'role'), '')::text $$;

grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

-- ─── storage (minimal) ────────────────────────────────────────────────────────────────────────
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  owner_id text,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

create or replace function storage.foldername(name text) returns text[]
  language sql immutable
  as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;

create or replace function storage.filename(name text) returns text
  language sql immutable
  as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;

create or replace function storage.extension(name text) returns text
  language sql immutable
  as $$ select reverse(split_part(reverse(storage.filename(name)), '.', 1)) $$;

grant execute on function storage.foldername(text), storage.filename(text), storage.extension(text)
  to anon, authenticated, service_role;

-- ─── pg_net stand-in (records calls so tests can assert them) ─────────────────────────────────
create table if not exists net._shim_requests (
  id bigserial primary key,
  url text,
  headers jsonb,
  body jsonb,
  timeout_milliseconds integer,
  created_at timestamptz default now()
);

create or replace function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint
  language sql
  as $$
    insert into net._shim_requests (url, headers, body, timeout_milliseconds)
    values (url, headers, body, timeout_milliseconds)
    returning id
  $$;

-- ─── vault stand-in (plaintext; test databases only) ──────────────────────────────────────────
create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  secret text,
  description text,
  created_at timestamptz default now()
);

create or replace view vault.decrypted_secrets as
  select id, name, secret as decrypted_secret, description, created_at from vault.secrets;

create or replace function vault.create_secret(secret text, name text, description text default '')
  returns uuid
  language sql
  as $$
    insert into vault.secrets (name, secret, description)
    values (name, secret, description)
    on conflict (name) do update set secret = excluded.secret
    returning id
  $$;

do $$
begin
  perform vault.create_secret('http://localhost:54321', 'da_project_url');
  perform vault.create_secret('test-secret', 'da_cron_secret');
end
$$;

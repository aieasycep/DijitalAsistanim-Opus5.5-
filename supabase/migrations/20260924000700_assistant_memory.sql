-- Migration 0007 · assistant and memory
-- Spec: docs/DATABASE_AND_RLS_PLAN.md §4.4 (assistant_threads, assistant_messages, memory_chunks),
-- §10 row 0007; R-01 (Voyage voyage-4 / voyage-4-lite, one shared 1024-d space).
-- pgvector 0.6 compatible: vector(1024) + HNSW vector_cosine_ops only (§1.7).

-- ─── assistant_threads ────────────────────────────────────────────────────────────────────────
create table public.assistant_threads (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  title text check (char_length(title) <= 120),
  scope text not null default 'global' check (scope in ('global', 'person', 'meeting')),
  scope_ref_id uuid,
  last_message_at timestamptz,
  message_count integer not null default 0,
  archived_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assistant_threads_pkey primary key (id),
  constraint assistant_threads_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
);
create index assistant_threads_user_id_last_message_at_idx on public.assistant_threads (user_id, last_message_at desc);
create trigger trg_assistant_threads_updated_at before update on public.assistant_threads
  for each row execute function private.set_updated_at();
-- expires_at follows the latest message (recomputed on each message).
create trigger trg_assistant_threads_set_expires_at before insert or update of last_message_at on public.assistant_threads
  for each row execute function private.set_expires_at('last_message_at', 'created_at');
alter table public.assistant_threads enable row level security;
alter table public.assistant_threads force row level security;
comment on table public.assistant_threads is
  'Assistant conversations, global or person/meeting scoped ("Mehmet hakkında sor…").';

-- ─── assistant_messages ───────────────────────────────────────────────────────────────────────
create table public.assistant_messages (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  thread_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 8000),
  cards jsonb not null default '[]'::jsonb check (jsonb_typeof(cards) = 'array'),
  citations jsonb not null default '[]'::jsonb check (jsonb_typeof(citations) = 'array'),
  proposed_approval_ids uuid[] not null default '{}',
  followup_suggestions jsonb not null default '[]'::jsonb check (jsonb_typeof(followup_suggestions) = 'array'),
  status text not null default 'complete' check (status in ('streaming', 'complete', 'failed', 'refused')),
  grounded boolean not null default false,
  input_channel text not null default 'text' check (input_channel in ('text', 'voice')),
  client_message_id uuid,                             -- idempotency of API-AST-02 retries
  finish_reason text check (finish_reason in ('stop', 'length', 'client_disconnected', 'refused_ungrounded')),
  model text,
  prompt_version_id uuid,
  ai_request_id uuid,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint assistant_messages_pkey primary key (id),
  constraint assistant_messages_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint assistant_messages_thread_id_fkey foreign key (thread_id)
    references public.assistant_threads (id) on delete cascade
);
create unique index assistant_messages_thread_id_client_message_id_key
  on public.assistant_messages (thread_id, client_message_id) where client_message_id is not null;
create index assistant_messages_thread_id_created_at_idx on public.assistant_messages (thread_id, created_at);
create index assistant_messages_user_id_idx on public.assistant_messages (user_id);
create trigger trg_assistant_messages_set_expires_at before insert on public.assistant_messages
  for each row execute function private.set_expires_at('created_at');
alter table public.assistant_messages enable row level security;
alter table public.assistant_messages force row level security;
comment on table public.assistant_messages is
  'Assistant messages with citations and proposed approvals (M§24–25); conversation content, never sent to analytics.';

-- ─── memory_chunks ────────────────────────────────────────────────────────────────────────────
create table public.memory_chunks (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  source_type public.source_type not null,
  source_id text not null check (char_length(source_id) between 1 and 200),
  source_provider public.provider,
  source_timestamp timestamptz not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  chunk_kind text not null check (chunk_kind in (
    'email_summary', 'thread_summary', 'key_point', 'event', 'commitment', 'life_event', 'capture_extract',
    'meeting_note', 'person_fact', 'briefing_fact')),
  content text not null check (char_length(content) between 1 and 2000),
  content_hash bytea not null,
  embedding extensions.vector(1024),                  -- R-01: voyage-4 documents / voyage-4-lite queries
  embedding_model text,                               -- e.g. voyage-4@1024
  embedded_at timestamptz,
  embedding_dr extensions.vector(1024),               -- disaster-recovery re-embed only (runbook adds its index)
  tsv tsvector generated always as (to_tsvector('private.tr_search'::regconfig, content)) stored,
  page_no integer,
  contact_ids uuid[] not null default '{}',
  occurred_at timestamptz not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memory_chunks_pkey primary key (id),
  constraint memory_chunks_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint memory_chunks_user_id_source_chunk_kind_content_hash_key
    unique (user_id, source_type, source_id, chunk_kind, content_hash),
  constraint memory_chunks_source_provider_check check (source_provider is not null
    or source_type not in ('email_message', 'email_thread', 'calendar_event', 'device_calendar_event'))
);
create index memory_chunks_embedding_hnsw on public.memory_chunks
  using hnsw (embedding extensions.vector_cosine_ops) with (m = 16, ef_construction = 64);
create index memory_chunks_tsv_gin on public.memory_chunks using gin (tsv);
create index memory_chunks_user_id_occurred_at_idx on public.memory_chunks (user_id, occurred_at desc);
create index memory_chunks_contact_ids_gin on public.memory_chunks using gin (contact_ids);
create index memory_chunks_embedded_at_p on public.memory_chunks (embedded_at) where embedding is null;
create index memory_chunks_expires_at_idx on public.memory_chunks (expires_at);
create trigger trg_memory_chunks_updated_at before update on public.memory_chunks
  for each row execute function private.set_updated_at();
create trigger trg_memory_chunks_set_expires_at before insert on public.memory_chunks
  for each row execute function private.set_expires_at('occurred_at');
alter table public.memory_chunks enable row level security;
alter table public.memory_chunks force row level security;
comment on table public.memory_chunks is
  'Derived retrieval index for AI memory and hybrid search (M§26, §95): facts and summaries only, never full bodies; embeddings are deleted with the row.';
comment on column public.memory_chunks.embedding is 'vector(1024) in the shared Voyage 4 embedding space (R-01).';

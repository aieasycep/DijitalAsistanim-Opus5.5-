-- Migration 0004 · content (derived from provider data; no raw mail body anywhere — ADR-05, M§87)
-- Spec: docs/DATABASE_AND_RLS_PLAN.md §4.3, §1.6 (retention triggers), §7, §10 row 0004.
-- Forward references are added later with `alter table … add constraint`:
--   priority_rules / learned_preferences / prompt_versions (0005), approval_actions (0006),
--   notifications (0008).
-- ⟨PROV⟩ provider rule: source_provider is required when the source is provider data
-- (mail or calendar); capture-, assistant-, briefing- and user-derived rows have no provider.

-- ─── contacts ─────────────────────────────────────────────────────────────────────────────────
create table public.contacts (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 120),
  primary_email extensions.citext,
  emails extensions.citext[] not null default '{}',
  organization text check (char_length(organization) <= 120),
  title text check (char_length(title) <= 120),
  title_evidence jsonb check (title_evidence is null or private.valid_evidence(title_evidence)),
  avatar_seed integer not null,
  first_seen_at timestamptz,
  last_contact_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  message_count_30d integer not null default 0,
  meeting_count_30d integer not null default 0,
  origin text not null check (origin in ('mail', 'calendar', 'device', 'manual', 'capture')),
  merged_into_id uuid,
  search_tsv tsvector generated always as (
    to_tsvector('private.tr_search'::regconfig,
                display_name || ' ' || coalesce(organization, '') || ' ' || private.immutable_array_to_text(emails::text[]))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contacts_pkey primary key (id),
  constraint contacts_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint contacts_merged_into_id_fkey foreign key (merged_into_id) references public.contacts (id) on delete set null
);
create unique index contacts_user_id_primary_email_key on public.contacts (user_id, primary_email)
  where primary_email is not null;
create index contacts_user_id_last_contact_at_idx on public.contacts (user_id, last_contact_at desc);
create index contacts_emails_gin on public.contacts using gin (emails);
create index contacts_display_name_trgm on public.contacts
  using gin (private.immutable_unaccent(lower(display_name)) extensions.gin_trgm_ops);
create index contacts_search_tsv_gin on public.contacts using gin (search_tsv);
create index contacts_merged_into_id_idx on public.contacts (merged_into_id);
create trigger trg_contacts_updated_at before update on public.contacts
  for each row execute function private.set_updated_at();
alter table public.contacts enable row level security;
alter table public.contacts force row level security;
comment on table public.contacts is
  'People resolved from mail, calendar and manual entry (M§30); pruned by retention unless VIP, manual or tied to an open commitment.';

-- ─── vip_people ───────────────────────────────────────────────────────────────────────────────
create table public.vip_people (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  contact_id uuid not null,
  relationship public.vip_relationship not null default 'other',
  always_notify boolean not null default true,
  bypass_quiet_hours boolean not null default true,          -- R-13 per-VIP override
  note text check (char_length(note) <= 200),
  origin text not null default 'user' check (origin in ('user', 'suggestion', 'onboarding')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vip_people_pkey primary key (id),
  constraint vip_people_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint vip_people_contact_id_fkey foreign key (contact_id) references public.contacts (id) on delete cascade,
  constraint vip_people_user_id_contact_id_key unique (user_id, contact_id)
);
create index vip_people_contact_id_idx on public.vip_people (contact_id);
create trigger trg_vip_people_updated_at before update on public.vip_people
  for each row execute function private.set_updated_at();
alter table public.vip_people enable row level security;
alter table public.vip_people force row level security;
comment on table public.vip_people is
  'User-marked important people with a relationship group (M§30); rows may exist on Free, effects apply only for Pro (M§44).';

-- ─── email_threads ────────────────────────────────────────────────────────────────────────────
create table public.email_threads (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  connected_account_id uuid not null,
  provider public.provider not null,
  provider_thread_id text not null,
  subject text check (char_length(subject) <= 300),
  participants jsonb not null default '[]'::jsonb
    check (jsonb_typeof(participants) = 'array' and private.jsonb_array_len(participants) <= 50),
  message_count integer not null default 0,
  last_message_at timestamptz not null,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  has_unread boolean not null default false,
  category public.mail_category,
  category_tier public.decision_tier,
  category_reason text check (char_length(category_reason) <= 300),
  category_rule_id uuid,                              -- FK → priority_rules (0005)
  category_learned_preference_id uuid,                -- FK → learned_preferences (0005)
  category_confidence numeric(4, 3) check (category_confidence between 0 and 1),
  urgency public.urgency,
  reply_state text not null default 'none' check (reply_state in ('none', 'awaiting_my_reply', 'awaiting_their_reply')),
  ai_summary text check (char_length(ai_summary) <= 1200),
  key_points jsonb not null default '[]'::jsonb
    check (jsonb_typeof(key_points) = 'array' and private.jsonb_array_len(key_points) <= 5),
  deadline_at timestamptz,
  deadline_evidence jsonb check (deadline_evidence is null or private.valid_evidence(deadline_evidence)),
  labels text[] not null default '{}',
  web_link text check (web_link ~ '^https://'),
  is_muted boolean not null default false,
  analysis_hash bytea,
  analyzed_at timestamptz,
  prompt_version_id uuid,                             -- FK → prompt_versions (0005)
  rolling_summary text check (char_length(rolling_summary) <= 1200),
  last_processed_message_id uuid,
  follow_up_state text not null default 'none'
    check (follow_up_state in ('none', 'waiting', 'nudge_due', 'nudged', 'muted', 'resolved')),
  awaiting_since timestamptz,
  expects_reply_message_id uuid,
  topic_label text check (char_length(topic_label) <= 60),
  search_tsv tsvector generated always as (
    to_tsvector('private.tr_search'::regconfig, coalesce(subject, '') || ' ' || coalesce(ai_summary, ''))
  ) stored,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_threads_pkey primary key (id),
  constraint email_threads_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint email_threads_connected_account_id_fkey foreign key (connected_account_id)
    references public.connected_accounts (id) on delete cascade,
  constraint email_threads_connected_account_id_provider_thread_id_key unique (connected_account_id, provider_thread_id),
  -- No deadline without a source (M§83).
  constraint email_threads_deadline_source_check
    check (deadline_at is null or private.jsonb_array_len(deadline_evidence) >= 1)
);
create index email_threads_user_id_category_last_message_at_idx
  on public.email_threads (user_id, category, last_message_at desc);
create index email_threads_user_id_reply_state_last_message_at_p
  on public.email_threads (user_id, reply_state, last_message_at desc) where reply_state <> 'none';
create index email_threads_user_id_deadline_at_p on public.email_threads (user_id, deadline_at)
  where deadline_at is not null;
create index email_threads_search_tsv_gin on public.email_threads using gin (search_tsv);
create index email_threads_expires_at_p on public.email_threads (expires_at) where expires_at is not null;
create index email_threads_category_rule_id_idx on public.email_threads (category_rule_id);
create index email_threads_category_learned_preference_id_idx on public.email_threads (category_learned_preference_id);
create index email_threads_prompt_version_id_idx on public.email_threads (prompt_version_id);
create trigger trg_email_threads_updated_at before update on public.email_threads
  for each row execute function private.set_updated_at();
create trigger trg_email_threads_set_expires_at before insert on public.email_threads
  for each row execute function private.set_expires_at('last_message_at');
alter table public.email_threads enable row level security;
alter table public.email_threads force row level security;
comment on table public.email_threads is
  'Thread-level mail intelligence: category, reply state, summary, deadline (M§14–17). No body columns.';

-- ─── email_messages ───────────────────────────────────────────────────────────────────────────
create table public.email_messages (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  connected_account_id uuid not null,
  thread_id uuid not null,
  provider public.provider not null,
  provider_message_id text not null,
  internet_message_id text,
  in_reply_to text,
  references_ids text[] not null default '{}',
  direction text not null check (direction in ('inbound', 'outbound')),
  from_email extensions.citext not null,
  from_name text,
  to_emails extensions.citext[] not null default '{}',
  cc_emails extensions.citext[] not null default '{}',
  subject text check (char_length(subject) <= 300),
  snippet text check (char_length(snippet) <= 200),
  sent_at timestamptz,
  received_at timestamptz not null,
  is_read boolean not null default false,
  importance text check (importance in ('low', 'normal', 'high')),
  labels text[] not null default '{}',
  has_attachments boolean not null default false,
  attachment_meta jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attachment_meta) = 'array' and private.jsonb_array_len(attachment_meta) <= 20),
  list_unsubscribe boolean not null default false,
  auto_submitted boolean not null default false,
  precedence_bulk boolean not null default false,
  dkim_pass boolean,
  spf_pass boolean,
  content_hash bytea not null,
  ai_status text not null default 'pending_t0' check (ai_status in (
    'pending_t0', 't0_final', 'skipped_source_control', 'skipped_budget', 'skipped_flag', 'queued_realtime',
    'queued_batch', 'classified', 'failed')),
  injection_suspected boolean not null default false,
  dropped_fields text[] not null default '{}',
  life_signal text not null default 'none'
    check (life_signal in ('none', 'shipment', 'flight', 'reservation', 'payment', 'subscription')),
  classification public.mail_category,
  classification_tier public.decision_tier,
  classification_reason text check (char_length(classification_reason) <= 300),
  classification_rule_id uuid,                        -- FK → priority_rules (0005)
  classification_confidence numeric(4, 3) check (classification_confidence between 0 and 1),
  ai_summary text check (char_length(ai_summary) <= 800),
  key_points jsonb not null default '[]'::jsonb check (jsonb_typeof(key_points) = 'array'),
  analyzed_at timestamptz,
  prompt_version_id uuid,                             -- FK → prompt_versions (0005)
  provider_deleted_at timestamptz,
  web_link text,
  search_tsv tsvector generated always as (
    to_tsvector('private.tr_search'::regconfig,
                coalesce(subject, '') || ' ' || coalesce(snippet, '') || ' ' || coalesce(ai_summary, ''))
  ) stored,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_messages_pkey primary key (id),
  constraint email_messages_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint email_messages_connected_account_id_fkey foreign key (connected_account_id)
    references public.connected_accounts (id) on delete cascade,
  constraint email_messages_thread_id_fkey foreign key (thread_id) references public.email_threads (id) on delete cascade,
  constraint email_messages_connected_account_id_provider_message_id_key unique (connected_account_id, provider_message_id)
);
create index email_messages_user_id_received_at_idx on public.email_messages (user_id, received_at desc);
create index email_messages_thread_id_received_at_idx on public.email_messages (thread_id, received_at);
create index email_messages_user_id_content_hash_idx on public.email_messages (user_id, content_hash);
create index email_messages_user_id_from_email_idx on public.email_messages (user_id, from_email);
create index email_messages_internet_message_id_p on public.email_messages (internet_message_id)
  where internet_message_id is not null;
create index email_messages_search_tsv_gin on public.email_messages using gin (search_tsv);
create index email_messages_expires_at_idx on public.email_messages (expires_at);
create index email_messages_classification_rule_id_idx on public.email_messages (classification_rule_id);
create index email_messages_prompt_version_id_idx on public.email_messages (prompt_version_id);
create trigger trg_email_messages_updated_at before update on public.email_messages
  for each row execute function private.set_updated_at();
create trigger trg_email_messages_set_expires_at before insert on public.email_messages
  for each row execute function private.set_expires_at('received_at');
alter table public.email_messages enable row level security;
alter table public.email_messages force row level security;
comment on table public.email_messages is
  'Message metadata, triage and classification. There is no body column: "Orijinal Mail" is fetched on demand and never stored (ADR-05).';

-- ─── calendar_events ──────────────────────────────────────────────────────────────────────────
create table public.calendar_events (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  connected_account_id uuid not null,
  calendar_id uuid not null,
  provider public.provider not null,
  provider_event_id text not null,
  ical_uid text,
  recurring_event_id text,
  etag text,
  title text check (char_length(title) <= 300),
  description_excerpt text check (char_length(description_excerpt) <= 500),
  location text check (char_length(location) <= 300),
  is_online boolean not null default false,
  conference_url text
    check (conference_url ~ '^https://(meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|([a-z0-9-]+\.)?zoom\.us)/'),
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  start_date date,
  end_date date,
  time_zone text,
  status text not null default 'confirmed' check (status in ('confirmed', 'tentative', 'cancelled')),
  organizer_email extensions.citext,
  organizer_self boolean not null default false,
  can_modify boolean not null default false,
  attendees jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attendees) = 'array' and private.jsonb_array_len(attendees) <= 200),
  attendee_count integer not null default 0,
  origin text not null check (origin in ('provider_sync', 'device_snapshot', 'demo', 'approval_write')),
  device_last_synced_at timestamptz,
  da_approval_id uuid,                                -- FK → approval_actions (0006)
  provider_updated_at timestamptz,
  provider_deleted_at timestamptz,
  search_tsv tsvector generated always as (
    to_tsvector('private.tr_search'::regconfig,
                coalesce(title, '') || ' ' || coalesce(location, '') || ' ' || coalesce(description_excerpt, ''))
  ) stored,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_events_pkey primary key (id),
  constraint calendar_events_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint calendar_events_connected_account_id_fkey foreign key (connected_account_id)
    references public.connected_accounts (id) on delete cascade,
  constraint calendar_events_calendar_id_fkey foreign key (calendar_id) references public.calendars (id) on delete cascade,
  constraint calendar_events_calendar_id_provider_event_id_key unique (calendar_id, provider_event_id),
  constraint calendar_events_end_at_check check (end_at >= start_at)
);
create index calendar_events_user_id_start_at_idx on public.calendar_events (user_id, start_at);
create index calendar_events_user_id_end_at_idx on public.calendar_events (user_id, end_at);
create index calendar_events_start_at_p on public.calendar_events (start_at) where status <> 'cancelled';
create index calendar_events_attendees_gin on public.calendar_events using gin (attendees jsonb_path_ops);
create index calendar_events_search_tsv_gin on public.calendar_events using gin (search_tsv);
create index calendar_events_ical_uid_idx on public.calendar_events (ical_uid);
create index calendar_events_expires_at_idx on public.calendar_events (expires_at);
create index calendar_events_connected_account_id_idx on public.calendar_events (connected_account_id);
create trigger trg_calendar_events_updated_at before update on public.calendar_events
  for each row execute function private.set_updated_at();
create trigger trg_calendar_events_set_expires_at before insert on public.calendar_events
  for each row execute function private.set_expires_at('end_at');
alter table public.calendar_events enable row level security;
alter table public.calendar_events force row level security;
comment on table public.calendar_events is
  'Normalized events from Google, Graph, EventKit and CalendarContract snapshots (M§19–22); writes happen only through approvals.';

-- ─── tasks ────────────────────────────────────────────────────────────────────────────────────
create table public.tasks (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  connected_account_id uuid,                          -- NULL = in-app task
  provider public.provider,
  provider_task_id text,
  provider_list_id text,
  title text not null check (char_length(title) between 1 and 500),
  notes_excerpt text check (char_length(notes_excerpt) <= 1000),
  due_date date,
  due_at timestamptz,
  status public.item_status not null default 'open',
  completed_at timestamptz,
  origin text not null check (origin in ('provider_sync', 'user', 'ai_proposal', 'capture', 'approval_write')),
  approval_action_id uuid,                            -- FK → approval_actions (0006)
  idempotency_key text,
  source_type public.source_type,                     -- ⟨PROV⟩ nullable on tasks
  source_id text check (char_length(source_id) between 1 and 200),
  source_provider public.provider,
  source_timestamp timestamptz,
  confidence numeric(4, 3) check (confidence between 0 and 1),
  evidence jsonb not null default '[]'::jsonb check (private.valid_evidence(evidence)),
  search_tsv tsvector generated always as (
    to_tsvector('private.tr_search'::regconfig, title || ' ' || coalesce(notes_excerpt, ''))
  ) stored,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_pkey primary key (id),
  constraint tasks_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint tasks_connected_account_id_fkey foreign key (connected_account_id)
    references public.connected_accounts (id) on delete cascade,
  constraint tasks_origin_provenance_check
    check (origin not in ('ai_proposal', 'capture') or (source_type is not null and confidence is not null))
);
create unique index tasks_connected_account_id_provider_list_id_provider_task_id_key
  on public.tasks (connected_account_id, provider_list_id, provider_task_id) where provider_task_id is not null;
create unique index tasks_user_id_idempotency_key_key on public.tasks (user_id, idempotency_key)
  where idempotency_key is not null;
create index tasks_user_id_status_due_date_idx on public.tasks (user_id, status, due_date);
create index tasks_user_id_due_at_p on public.tasks (user_id, due_at) where due_at is not null;
create index tasks_search_tsv_gin on public.tasks using gin (search_tsv);
create index tasks_connected_account_id_idx on public.tasks (connected_account_id);
create trigger trg_tasks_updated_at before update on public.tasks
  for each row execute function private.set_updated_at();
create trigger trg_tasks_set_expires_at before insert or update of status on public.tasks
  for each row execute function private.set_expires_at('completed_at', 'due_at', 'created_at');
alter table public.tasks enable row level security;
alter table public.tasks force row level security;
comment on table public.tasks is
  'Google Tasks, Microsoft To Do, Apple Reminders snapshots and in-app tasks (M§19, §75); provider tasks change only through approvals.';

-- ─── commitments ──────────────────────────────────────────────────────────────────────────────
create table public.commitments (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  contact_id uuid,
  counterparty_name text check (char_length(counterparty_name) <= 120),
  direction public.commitment_direction not null,
  text text not null check (char_length(text) between 3 and 500),
  due_at timestamptz,
  due_is_date_only boolean not null default false,
  status public.commitment_status not null default 'open',
  snoozed_until timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  dedupe_key text not null,
  origin text not null check (origin in ('email_analysis', 'post_meeting', 'capture', 'assistant', 'user')),
  approval_action_id uuid,                            -- FK → approval_actions (0006)
  calendar_event_id uuid,
  source_type public.source_type not null,
  source_id text not null check (char_length(source_id) between 1 and 200),
  source_provider public.provider,
  source_timestamp timestamptz not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  evidence jsonb not null default '[]'::jsonb check (private.valid_evidence(evidence)),
  user_overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(user_overrides) = 'object'),
  search_tsv tsvector generated always as (
    to_tsvector('private.tr_search'::regconfig, text || ' ' || coalesce(counterparty_name, ''))
  ) stored,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commitments_pkey primary key (id),
  constraint commitments_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint commitments_contact_id_fkey foreign key (contact_id) references public.contacts (id) on delete set null,
  constraint commitments_calendar_event_id_fkey foreign key (calendar_event_id)
    references public.calendar_events (id) on delete set null,
  constraint commitments_user_id_dedupe_key_key unique (user_id, dedupe_key),
  -- No commitment without a source (M§83).
  constraint commitments_evidence_origin_check check (origin = 'user' or private.jsonb_array_len(evidence) >= 1),
  constraint commitments_source_provider_check check (source_provider is not null
    or source_type not in ('email_message', 'email_thread', 'calendar_event', 'device_calendar_event'))
);
create index commitments_user_id_status_due_at_idx on public.commitments (user_id, status, due_at);
create index commitments_user_id_contact_id_idx on public.commitments (user_id, contact_id);
create index commitments_user_id_direction_p on public.commitments (user_id, direction) where status = 'open';
create index commitments_search_tsv_gin on public.commitments using gin (search_tsv);
create index commitments_contact_id_idx on public.commitments (contact_id);
create index commitments_calendar_event_id_idx on public.commitments (calendar_event_id);
create trigger trg_commitments_updated_at before update on public.commitments
  for each row execute function private.set_updated_at();
create trigger trg_commitments_set_expires_at before insert or update of status on public.commitments
  for each row execute function private.set_expires_at('completed_at', 'cancelled_at', 'due_at', 'created_at');
alter table public.commitments enable row level security;
alter table public.commitments force row level security;
comment on table public.commitments is
  'Detected or user-confirmed promises ("Cuma gönderirim.") with verified evidence (M§18, §22, §83).';

-- A commitment names its counterparty (contact or free text). Enforced when the row is written,
-- not when contacts.id is later nulled by ON DELETE SET NULL (retention / account deletion).
create function private.check_commitment_counterparty() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  if new.contact_id is null and new.counterparty_name is null then
    raise exception 'new row for relation "commitments" violates check constraint "commitments_counterparty_check"'
      using errcode = '23514', constraint = 'commitments_counterparty_check';
  end if;
  return new;
end
$$;
revoke execute on function private.check_commitment_counterparty() from public;

create trigger trg_commitments_counterparty_check before insert or update of counterparty_name on public.commitments
  for each row execute function private.check_commitment_counterparty();

-- ─── reminders ────────────────────────────────────────────────────────────────────────────────
create table public.reminders (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  note text check (char_length(note) <= 500),
  remind_at timestamptz not null,
  preset text not null check (preset in ('before_30m', 'before_1h', 'this_evening', 'tomorrow_morning', 'smart', 'custom')),
  anchor_at timestamptz,
  destination jsonb not null default '{"kind":"in_app"}'::jsonb
    check (jsonb_typeof(destination) = 'object'
           and destination ->> 'kind' in ('in_app', 'google_tasks', 'microsoft_todo', 'apple_reminders')),
  origin text not null default 'today' check (origin in (
    'email_detail', 'today', 'deadline', 'meeting', 'commitment', 'life_event', 'followup', 'assistant', 'plan')),
  resolution_reason text check (char_length(resolution_reason) <= 200),
  channel text not null default 'push' check (channel in ('push', 'local', 'provider_task', 'apple_reminders')),
  status public.reminder_status not null default 'scheduled',
  target_type text check (target_type in (
    'email_thread', 'insight', 'commitment', 'life_event', 'calendar_event', 'capture', 'task', 'follow_up')),
  target_id uuid,
  idempotency_key text not null,
  approval_action_id uuid,                            -- FK → approval_actions (0006)
  notification_id uuid,                               -- FK → notifications (0008)
  delivered_at timestamptz,
  cancelled_at timestamptz,
  source_type public.source_type default 'user_input', -- ⟨PROV⟩ nullable on reminders
  source_id text check (char_length(source_id) between 1 and 200),
  source_provider public.provider,
  source_timestamp timestamptz,
  confidence numeric(4, 3) check (confidence between 0 and 1),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminders_pkey primary key (id),
  constraint reminders_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint reminders_user_id_idempotency_key_key unique (user_id, idempotency_key),
  constraint reminders_anchor_at_check check (preset not in ('before_30m', 'before_1h') or anchor_at is not null)
);
create index reminders_remind_at_p on public.reminders (remind_at) where status = 'scheduled';
create index reminders_user_id_status_remind_at_idx on public.reminders (user_id, status, remind_at);
create trigger trg_reminders_updated_at before update on public.reminders
  for each row execute function private.set_updated_at();
create trigger trg_reminders_set_expires_at before insert or update of status on public.reminders
  for each row execute function private.set_expires_at('remind_at');
alter table public.reminders enable row level security;
alter table public.reminders force row level security;
comment on table public.reminders is
  'Smart reminders created through the reminder sheet (M§29); external destinations go through approvals.';

-- ─── meeting_notes ────────────────────────────────────────────────────────────────────────────
create table public.meeting_notes (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  calendar_event_id uuid not null,
  kind text not null check (kind in ('prep_note', 'post_meeting')),
  body text not null check (char_length(body) between 1 and 10000),
  input text not null check (input in ('text', 'voice_transcript')),
  processed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_notes_pkey primary key (id),
  constraint meeting_notes_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint meeting_notes_calendar_event_id_fkey foreign key (calendar_event_id)
    references public.calendar_events (id) on delete cascade
);
create index meeting_notes_user_id_calendar_event_id_created_at_idx
  on public.meeting_notes (user_id, calendar_event_id, created_at);
create index meeting_notes_calendar_event_id_idx on public.meeting_notes (calendar_event_id);
create trigger trg_meeting_notes_updated_at before update on public.meeting_notes
  for each row execute function private.set_updated_at();
create trigger trg_meeting_notes_set_expires_at before insert on public.meeting_notes
  for each row execute function private.set_expires_at('created_at');
alter table public.meeting_notes enable row level security;
alter table public.meeting_notes force row level security;
comment on table public.meeting_notes is
  '"Not Al" prep notes and post-meeting text or voice transcripts (SREQ-22, M§22); audio is never stored.';

-- ─── meeting_preps ────────────────────────────────────────────────────────────────────────────
create table public.meeting_preps (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  calendar_event_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'generating', 'ready', 'failed', 'stale')),
  purpose text check (char_length(purpose) <= 400),
  purpose_evidence jsonb not null default '[]'::jsonb check (private.valid_evidence(purpose_evidence)),
  primary_contact_id uuid,
  last_interaction jsonb check (last_interaction is null or jsonb_typeof(last_interaction) = 'object'),
  recent_email_ids uuid[] not null default '{}',
  open_loops jsonb not null default '[]'::jsonb check (jsonb_typeof(open_loops) = 'array'),
  user_commitment_ids uuid[] not null default '{}',
  their_commitment_ids uuid[] not null default '{}',
  relevant_files jsonb not null default '[]'::jsonb check (jsonb_typeof(relevant_files) = 'array'),
  talking_points jsonb not null default '[]'::jsonb
    check (jsonb_typeof(talking_points) = 'array' and private.jsonb_array_len(talking_points) <= 3),
  summary_2min text check (char_length(summary_2min) <= 2500),
  reading_time_sec integer,
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  input_hash bytea,
  generated_at timestamptz,
  model text,
  prompt_version_id uuid,                             -- FK → prompt_versions (0005)
  ai_request_id uuid,
  source_type public.source_type not null default 'calendar_event',
  source_id text not null check (char_length(source_id) between 1 and 200),
  source_provider public.provider,
  source_timestamp timestamptz not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  evidence jsonb not null default '[]'::jsonb check (private.valid_evidence(evidence)),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_preps_pkey primary key (id),
  constraint meeting_preps_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint meeting_preps_calendar_event_id_fkey foreign key (calendar_event_id)
    references public.calendar_events (id) on delete cascade,
  constraint meeting_preps_primary_contact_id_fkey foreign key (primary_contact_id)
    references public.contacts (id) on delete set null,
  constraint meeting_preps_user_id_calendar_event_id_key unique (user_id, calendar_event_id),
  constraint meeting_preps_source_provider_check check (source_provider is not null
    or source_type not in ('email_message', 'email_thread', 'calendar_event', 'device_calendar_event'))
);
create index meeting_preps_user_id_status_idx on public.meeting_preps (user_id, status);
create index meeting_preps_calendar_event_id_idx on public.meeting_preps (calendar_event_id);
create index meeting_preps_primary_contact_id_idx on public.meeting_preps (primary_contact_id);
create index meeting_preps_prompt_version_id_idx on public.meeting_preps (prompt_version_id);
create trigger trg_meeting_preps_updated_at before update on public.meeting_preps
  for each row execute function private.set_updated_at();
create trigger trg_meeting_preps_set_expires_at before insert on public.meeting_preps
  for each row execute function private.set_expires_at();   -- anchored on the event end_at
alter table public.meeting_preps enable row level security;
alter table public.meeting_preps force row level security;
comment on table public.meeting_preps is
  'Meeting Prep artifact and "2 Dakikalık Özet" (M§21); precomputed at T-60 only for external/VIP meetings (R-23).';

-- ─── life_events ──────────────────────────────────────────────────────────────────────────────
create table public.life_events (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  type public.life_event_type not null,
  title text not null check (char_length(title) between 1 and 200),
  status public.item_status not null default 'open',
  snoozed_until timestamptz,
  resolved_at timestamptz,
  event_at timestamptz,
  due_at timestamptz,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  amount numeric(14, 2),
  currency char(3),
  amount_evidence jsonb check (amount_evidence is null or private.valid_evidence(amount_evidence)),
  tracking_url text check (tracking_url ~ '^https://'),
  dedupe_key text not null,
  suppressed boolean not null default false,
  user_overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(user_overrides) = 'object'),
  source_type public.source_type not null,
  source_id text not null check (char_length(source_id) between 1 and 200),
  source_provider public.provider,
  source_timestamp timestamptz not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  evidence jsonb not null default '[]'::jsonb check (private.valid_evidence(evidence)),
  search_tsv tsvector generated always as (
    to_tsvector('private.tr_search'::regconfig, title)
    || jsonb_to_tsvector('private.tr_search'::regconfig, payload, '["string"]'::jsonb)
  ) stored,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint life_events_pkey primary key (id),
  constraint life_events_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint life_events_user_id_dedupe_key_key unique (user_id, dedupe_key),
  constraint life_events_amount_currency_check check ((amount is null) = (currency is null)),
  constraint life_events_amount_source_check check (amount is null or private.jsonb_array_len(amount_evidence) >= 1),
  constraint life_events_due_at_source_check check (due_at is null or private.jsonb_array_len(evidence) >= 1),
  constraint life_events_source_provider_check check (source_provider is not null
    or source_type not in ('email_message', 'email_thread', 'calendar_event', 'device_calendar_event'))
);
create index life_events_user_id_status_when_idx on public.life_events (user_id, status, (coalesce(event_at, due_at)));
create index life_events_user_id_type_created_at_idx on public.life_events (user_id, type, created_at desc);
create index life_events_search_tsv_gin on public.life_events using gin (search_tsv);
create index life_events_expires_at_idx on public.life_events (expires_at);
create trigger trg_life_events_updated_at before update on public.life_events
  for each row execute function private.set_updated_at();
create trigger trg_life_events_set_expires_at before insert on public.life_events
  for each row execute function private.set_expires_at('event_at', 'due_at', 'created_at');
alter table public.life_events enable row level security;
alter table public.life_events force row level security;
comment on table public.life_events is
  'Shipment, flight, reservation, payment, subscription and security cards (M§23); amounts and dates only with evidence.';

-- ─── captures ─────────────────────────────────────────────────────────────────────────────────
create table public.captures (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  kind public.capture_kind not null,
  status public.capture_status not null default 'pending_upload',
  storage_path text,                                  -- checked by trg_captures_path_check
  mime_type text check (mime_type in (
    'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf', 'text/plain')),
  size_bytes integer check (size_bytes between 1 and 20971520),
  sha256 bytea,
  original_filename text check (char_length(original_filename) <= 200),
  source_url text check (source_url ~ '^https://' and char_length(source_url) <= 2048),
  final_url text,
  text_content text check (char_length(text_content) <= 20000),
  page_count smallint,
  extracted jsonb not null default '[]'::jsonb
    check (jsonb_typeof(extracted) = 'array' and private.jsonb_array_len(extracted) <= 20),
  extracted_types public.extracted_entity_type[] not null default '{}',
  primary_type public.extracted_entity_type,
  share_origin text not null default 'in_app'
    check (share_origin in ('in_app', 'ios_share', 'android_send', 'assistant', 'today')),
  progress jsonb not null default '{}'::jsonb check (jsonb_typeof(progress) = 'object'),
  file_deleted_at timestamptz,
  idempotency_key text not null,
  error_code text,
  analyzed_at timestamptz,
  ai_request_id uuid,
  search_tsv tsvector generated always as (
    to_tsvector('private.tr_search'::regconfig, coalesce(original_filename, '') || ' ' || coalesce(text_content, ''))
  ) stored,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint captures_pkey primary key (id),
  constraint captures_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint captures_user_id_idempotency_key_key unique (user_id, idempotency_key)
);
create index captures_user_id_created_at_idx on public.captures (user_id, created_at desc);
create index captures_status_created_at_p on public.captures (status, created_at)
  where status in ('pending_upload', 'uploaded', 'analyzing');
create index captures_search_tsv_gin on public.captures using gin (search_tsv);
create index captures_expires_at_idx on public.captures (expires_at);
create trigger trg_captures_updated_at before update on public.captures
  for each row execute function private.set_updated_at();
create trigger trg_captures_set_expires_at before insert on public.captures
  for each row execute function private.set_expires_at('created_at');
alter table public.captures enable row level security;
alter table public.captures force row level security;
comment on table public.captures is
  'Universal Capture (photo, screenshot, pdf, file, link, text, share; M§27–28, §85); files live in the private captures bucket.';

-- storage_path must be `{user_id}/{uuid}/{file name}` inside the owner's folder (§4.3).
create function private.check_capture_path() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  if new.storage_path is not null
     and new.storage_path !~ ('^' || new.user_id::text || '/[0-9a-f-]{36}/[^/]{1,120}$') then
    raise exception 'new row for relation "captures" violates check constraint "captures_storage_path_check"'
      using errcode = '23514', constraint = 'captures_storage_path_check';
  end if;
  return new;
end
$$;
revoke execute on function private.check_capture_path() from public;

create trigger trg_captures_path_check before insert or update of storage_path on public.captures
  for each row execute function private.check_capture_path();

-- ─── android_notification_signals ─────────────────────────────────────────────────────────────
create table public.android_notification_signals (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  installation_id uuid not null,
  package_name text not null check (package_name ~ '^[a-zA-Z0-9_.]{3,200}$'),
  app_label text check (char_length(app_label) <= 80),
  category text not null check (category in ('cargo', 'bank_payment', 'flight', 'reservation', 'other')),
  amount numeric(14, 2),
  currency char(3),
  due_date date,
  tracking_status text check (tracking_status in ('created', 'in_transit', 'out_for_delivery', 'delivered', 'exception')),
  flight_no text check (flight_no ~ '^[A-Z0-9]{2}\d{1,4}$'),
  gate text check (char_length(gate) <= 8),
  posted_at timestamptz not null,
  signal_hash bytea not null,
  extractor_version text,
  life_event_id uuid,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint android_notification_signals_pkey primary key (id),
  constraint android_notification_signals_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint android_notification_signals_installation_id_fkey foreign key (installation_id)
    references public.app_installations (id) on delete cascade,
  constraint android_notification_signals_life_event_id_fkey foreign key (life_event_id)
    references public.life_events (id) on delete set null,
  constraint android_notification_signals_user_id_signal_hash_key unique (user_id, signal_hash)
);
create index android_notification_signals_user_id_posted_at_idx
  on public.android_notification_signals (user_id, posted_at desc);
create index android_notification_signals_installation_id_idx on public.android_notification_signals (installation_id);
create index android_notification_signals_life_event_id_idx on public.android_notification_signals (life_event_id);
create trigger trg_android_notification_signals_set_expires_at before insert on public.android_notification_signals
  for each row execute function private.set_expires_at('posted_at');
alter table public.android_notification_signals enable row level security;
alter table public.android_notification_signals force row level security;
comment on table public.android_notification_signals is
  'Structured, on-device-extracted Android notification signals only; raw notification text is never uploaded (ADR-12, M§36).';

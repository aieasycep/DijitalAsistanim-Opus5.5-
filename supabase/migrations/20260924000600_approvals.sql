-- Migration 0006 · approvals
-- Spec: docs/DATABASE_AND_RLS_PLAN.md §4.4 (approval_actions, approval_events), §3.6 (append-only),
-- §6.6 (state machine), §7 (guard / immutability triggers), §10 row 0006; R-03, R-06, R-18.
-- State machine (exactly plan §5, enforced by private.transition_approval in 0013):
--   pending → approved → executing → executed | failed; pending → rejected | expired;
--   failed → executing (retry, same key). No undo status and no execute_after column (R-06).
-- Also adds the forward references from tasks, commitments, reminders, calendar_events,
-- reply_drafts and oauth_states to approval_actions.

-- ─── approval_actions ─────────────────────────────────────────────────────────────────────────
create table public.approval_actions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  action_type public.approval_action_type not null,
  status public.approval_status not null default 'pending',
  payload jsonb not null,
  payload_version integer not null default 1,
  payload_hash bytea not null,
  what text not null check (char_length(what) <= 200),
  why text check (char_length(why) <= 300),
  change_summary text not null check (char_length(change_summary) <= 500),
  side_effects jsonb not null default '[]'::jsonb check (jsonb_typeof(side_effects) = 'array'),
  destination_account_id uuid,
  destination_label text,
  idempotency_key text not null,
  provider_idempotency_ref text,
  origin text not null check (origin in (
    'reply_draft', 'assistant', 'voice', 'capture', 'plan_proposal', 'conflict_resolution', 'post_meeting',
    'email_detail', 'life_event', 'follow_up', 'reminder_sheet', 'commitment_detection')),
  origin_ref_id uuid,
  requires_scope text,
  approved_via public.approval_via,                   -- R-03: every value is a tap
  exact_change jsonb not null default '{}'::jsonb check (jsonb_typeof(exact_change) = 'object'),
  batch_id uuid,
  executor text not null default 'server' check (executor in ('server', 'device')),
  device_installation_id uuid,
  device_token_hash bytea check (device_token_hash is null or octet_length(device_token_hash) = 32),
  approval_expires_at timestamptz not null default now() + interval '72 hours',
  approved_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text check (rejection_reason in ('user_reject', 'user_cancel')),
  executing_at timestamptz,
  executed_at timestamptz,
  failed_at timestamptz,
  attempt_count smallint not null default 0,
  last_error_code text,
  last_error_message text check (char_length(last_error_message) <= 300),
  result jsonb,
  source_type public.source_type not null,
  source_id text not null check (char_length(source_id) between 1 and 200),
  source_provider public.provider,
  source_timestamp timestamptz not null,
  confidence numeric(4, 3) not null check (confidence between 0 and 1),
  evidence jsonb not null default '[]'::jsonb check (private.valid_evidence(evidence)),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_actions_pkey primary key (id),
  constraint approval_actions_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint approval_actions_destination_account_id_fkey foreign key (destination_account_id)
    references public.connected_accounts (id) on delete set null,
  constraint approval_actions_device_installation_id_fkey foreign key (device_installation_id)
    references public.app_installations (id) on delete set null,
  constraint approval_actions_idempotency_key_key unique (idempotency_key),
  constraint approval_actions_source_provider_check check (source_provider is not null
    or source_type not in ('email_message', 'email_thread', 'calendar_event', 'device_calendar_event'))
);
create index approval_actions_user_id_status_created_at_idx on public.approval_actions (user_id, status, created_at desc);
create index approval_actions_approval_expires_at_p on public.approval_actions (approval_expires_at)
  where status = 'pending';
create index approval_actions_status_p on public.approval_actions (status) where status in ('approved', 'executing', 'failed');
create index approval_actions_executing_at_device_p on public.approval_actions (executing_at)
  where status = 'executing' and executor = 'device';
create index approval_actions_user_id_batch_id_p on public.approval_actions (user_id, batch_id)
  where batch_id is not null;
create index approval_actions_destination_account_id_idx on public.approval_actions (destination_account_id);
create index approval_actions_device_installation_id_idx on public.approval_actions (device_installation_id);
create trigger trg_approval_actions_updated_at before update on public.approval_actions
  for each row execute function private.set_updated_at();
create trigger trg_approval_actions_set_expires_at before insert or update of status on public.approval_actions
  for each row execute function private.set_expires_at('executed_at', 'rejected_at', 'created_at');
alter table public.approval_actions enable row level security;
alter table public.approval_actions force row level security;
comment on table public.approval_actions is
  'Every side-effecting action proposed by AI or the user; clients never insert (they propose through api) and only private.transition_approval / edit_approval_payload change guarded columns (M§33, §115; ADR-09).';

-- A device executor must name the executing installation. Checked when the row is written or
-- the executor changes, not when app_installations.id is later nulled by ON DELETE SET NULL.
create function private.check_approval_executor() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  if new.executor = 'device' and new.device_installation_id is null then
    raise exception 'new row for relation "approval_actions" violates check constraint "approval_actions_executor_check"'
      using errcode = '23514', constraint = 'approval_actions_executor_check';
  end if;
  return new;
end
$$;
revoke execute on function private.check_approval_executor() from public;

create trigger trg_approval_actions_executor_check before insert or update of executor on public.approval_actions
  for each row execute function private.check_approval_executor();

-- Guarded columns change only inside private.transition_approval / private.edit_approval_payload,
-- which set `da.approval_tx = on` for their transaction (§4.4). The only exception is the
-- ON DELETE SET NULL of device_installation_id when an installation row is removed.
create function private.guard_approval_actions() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  if coalesce(current_setting('da.approval_tx', true), '') = 'on' then
    return new;
  end if;
  if new.status is distinct from old.status
     or new.payload is distinct from old.payload
     or new.payload_version is distinct from old.payload_version
     or new.idempotency_key is distinct from old.idempotency_key
     or new.exact_change is distinct from old.exact_change
     or new.executor is distinct from old.executor
     or (new.device_installation_id is distinct from old.device_installation_id
         and new.device_installation_id is not null) then
    raise exception 'APPROVAL_TX_REQUIRED' using errcode = '42501',
      hint = 'Use private.transition_approval or private.edit_approval_payload.';
  end if;
  return new;
end
$$;
revoke execute on function private.guard_approval_actions() from public;

create trigger trg_approval_actions_guard before update on public.approval_actions
  for each row execute function private.guard_approval_actions();

-- ─── approval_events (append-only) ────────────────────────────────────────────────────────────
create table public.approval_events (
  id bigint generated always as identity,
  user_id uuid not null,
  approval_action_id uuid not null,
  from_status public.approval_status,
  to_status public.approval_status not null,
  actor text not null check (actor in ('user', 'system', 'worker', 'admin')),
  actor_id uuid,
  payload_version integer not null,
  idempotency_key text not null,
  reason text check (char_length(reason) <= 300),
  correlation_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  constraint approval_events_pkey primary key (id),
  constraint approval_events_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint approval_events_approval_action_id_fkey foreign key (approval_action_id)
    references public.approval_actions (id) on delete cascade
);
create index approval_events_approval_action_id_id_idx on public.approval_events (approval_action_id, id);
create index approval_events_user_id_idx on public.approval_events (user_id);
alter table public.approval_events enable row level security;
alter table public.approval_events force row level security;
revoke update, delete, truncate on public.approval_events from public, anon, authenticated, service_role;
comment on table public.approval_events is
  'Immutable transition history of approvals (M§33); removed only together with its approval or its user.';

-- Append-only (§3.6): UPDATE and TRUNCATE always raise; DELETE is allowed only as the cascade of
-- deleting the parent approval or the owning user (retention, history and account deletion).
create function private.approval_events_immutable() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if tg_op = 'DELETE'
     and (not exists (select 1 from public.approval_actions a where a.id = old.approval_action_id)
          or not exists (select 1 from auth.users u where u.id = old.user_id)) then
    return old;
  end if;
  raise exception 'AUDIT_IMMUTABLE' using errcode = '55000', detail = 'approval_events is append-only';
end
$$;
revoke execute on function private.approval_events_immutable() from public;

create trigger trg_approval_events_immutable before update or delete on public.approval_events
  for each row execute function private.approval_events_immutable();

create function private.raise_append_only() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  raise exception 'AUDIT_IMMUTABLE' using errcode = '55000', detail = format('%s is append-only', tg_table_name);
end
$$;
revoke execute on function private.raise_append_only() from public;

create trigger trg_approval_events_no_truncate before truncate on public.approval_events
  for each statement execute function private.raise_append_only();

-- ─── Forward references to approval_actions ───────────────────────────────────────────────────
alter table public.tasks
  add constraint tasks_approval_action_id_fkey foreign key (approval_action_id)
    references public.approval_actions (id) on delete set null;
create index tasks_approval_action_id_idx on public.tasks (approval_action_id);

alter table public.commitments
  add constraint commitments_approval_action_id_fkey foreign key (approval_action_id)
    references public.approval_actions (id) on delete set null;
create index commitments_approval_action_id_idx on public.commitments (approval_action_id);

alter table public.reminders
  add constraint reminders_approval_action_id_fkey foreign key (approval_action_id)
    references public.approval_actions (id) on delete set null;
create index reminders_approval_action_id_idx on public.reminders (approval_action_id);

alter table public.calendar_events
  add constraint calendar_events_da_approval_id_fkey foreign key (da_approval_id)
    references public.approval_actions (id) on delete set null;
create index calendar_events_da_approval_id_idx on public.calendar_events (da_approval_id);

alter table public.reply_drafts
  add constraint reply_drafts_approval_action_id_fkey foreign key (approval_action_id)
    references public.approval_actions (id) on delete set null;

alter table public.oauth_states
  add constraint oauth_states_approval_id_fkey foreign key (approval_id)
    references public.approval_actions (id) on delete set null;
create index oauth_states_approval_id_idx on public.oauth_states (approval_id);

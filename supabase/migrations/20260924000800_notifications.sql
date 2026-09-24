-- Migration 0008 · notifications
-- Spec: docs/DATABASE_AND_RLS_PLAN.md §4.5 (notifications, push_tickets), §10 row 0008;
-- ADR-10, R-12 (Android channel IDs), R-13 (quiet hours), R-14 (daily cap).
-- Also adds the forward reference reminders.notification_id → notifications.

-- ─── notifications ────────────────────────────────────────────────────────────────────────────
create table public.notifications (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  category public.notification_category not null,
  decision public.notification_decision not null,
  suppression_reason text check (suppression_reason in (
    'quiet_hours', 'category_disabled', 'frequency_cap', 'low_relevance', 'deduplicated', 'no_device',
    'not_entitled', 'os_permission_denied', 'smart_filter', 'snoozed')),
  dedupe_key text not null,
  priority smallint not null default 50 check (priority between 0 and 100),
  detail_mode public.notification_detail not null,
  title_rendered text check (char_length(title_rendered) <= 120),
  body_rendered text check (char_length(body_rendered) <= 240),
  -- Push payload is only {type, entity_id, deeplink}; never content.
  data jsonb not null check (jsonb_typeof(data) = 'object' and data ?& array['type', 'deeplink'] and not (data ? 'body')),
  entity_type text,
  entity_id uuid,
  interruption_level text not null default 'active' check (interruption_level in ('passive', 'active', 'time_sensitive')),
  android_channel text not null check (android_channel in (
    'briefings', 'critical_email', 'meetings', 'deadlines', 'follow_up', 'life_intel', 'approvals', 'reminders',
    'account', 'phone_digest')),
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  opened_at timestamptz,
  failed_at timestamptz,
  error_code text,
  job_id uuid,
  correlation_id uuid,
  is_test boolean not null default false,             -- admin test pushes (generic, never bypass quiet hours)
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_pkey primary key (id),
  constraint notifications_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint notifications_user_id_dedupe_key_key unique (user_id, dedupe_key),
  constraint notifications_suppression_reason_decision_check
    check (decision not in ('suppressed', 'deduplicated') or suppression_reason is not null)
);
create index notifications_user_id_created_at_idx on public.notifications (user_id, created_at desc);
create index notifications_decision_created_at_idx on public.notifications (decision, created_at);
create index notifications_category_decision_created_at_idx on public.notifications (category, decision, created_at);
create index notifications_scheduled_for_p on public.notifications (scheduled_for) where decision = 'scheduled';
create trigger trg_notifications_set_expires_at before insert on public.notifications
  for each row execute function private.set_expires_at();   -- fixed 30 days
alter table public.notifications enable row level security;
alter table public.notifications force row level security;
comment on table public.notifications is
  'Notification decision ledger: every candidate push with its decision and suppression reason (M§86, §132; ADR-10).';

-- ─── push_tickets (SYS) ───────────────────────────────────────────────────────────────────────
create table public.push_tickets (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  notification_id uuid not null,
  push_token_id uuid,
  expo_ticket_id text,
  status text not null check (status in ('ok', 'error', 'pending_receipt', 'receipt_ok', 'receipt_error')),
  error_code text check (error_code in (
    'DeviceNotRegistered', 'MessageTooBig', 'MessageRateExceeded', 'MismatchSenderId', 'InvalidCredentials', 'Unknown')),
  sent_at timestamptz not null,
  receipt_checked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint push_tickets_pkey primary key (id),
  constraint push_tickets_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint push_tickets_notification_id_fkey foreign key (notification_id)
    references public.notifications (id) on delete cascade,
  constraint push_tickets_push_token_id_fkey foreign key (push_token_id)
    references public.push_tokens (id) on delete set null
);
create unique index push_tickets_expo_ticket_id_key on public.push_tickets (expo_ticket_id)
  where expo_ticket_id is not null;
create index push_tickets_sent_at_p on public.push_tickets (sent_at) where status = 'pending_receipt';
create index push_tickets_user_id_idx on public.push_tickets (user_id);
create index push_tickets_notification_id_idx on public.push_tickets (notification_id);
create index push_tickets_push_token_id_idx on public.push_tickets (push_token_id);
alter table public.push_tickets enable row level security;
alter table public.push_tickets force row level security;
comment on table public.push_tickets is 'Expo push ticket and receipt tracking (ADR-10). System table.';

-- ─── Forward reference from reminders ─────────────────────────────────────────────────────────
alter table public.reminders
  add constraint reminders_notification_id_fkey foreign key (notification_id)
    references public.notifications (id) on delete set null;
create index reminders_notification_id_idx on public.reminders (notification_id);

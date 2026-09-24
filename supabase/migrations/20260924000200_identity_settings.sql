-- Migration 0002 · identity and settings
-- Spec: docs/DATABASE_AND_RLS_PLAN.md §4.1 (profiles, user_preferences, notification_preferences,
-- app_installations, push_tokens), §1.6 + §6.1 (retention triggers, handle_new_user), §7, §10.
-- RLS is enabled and forced on every table here; policies and grants arrive in 0014, so until then
-- only superusers and BYPASSRLS roles (postgres, service_role) can read or write these tables.

-- ─── profiles ─────────────────────────────────────────────────────────────────────────────────
create table public.profiles (
  user_id uuid not null,
  display_name text check (char_length(display_name) between 1 and 80),
  avatar_path text check (avatar_path ~ '^[0-9a-f-]{36}/avatar\.(png|jpg|webp)$'),
  locale text not null default 'tr-TR' check (locale in ('tr-TR', 'en-US')),
  state public.user_state not null default 'active',
  disabled_at timestamptz,
  disabled_reason text check (char_length(disabled_reason) <= 500),
  disabled_by uuid,                                   -- FK → admin_users added in 0012
  onboarding_step text check (onboarding_step in (
    'welcome', 'noise', 'proactive', 'control', 'account', 'connect_mail', 'connect_calendar',
    'permissions', 'personalization', 'briefing_schedule', 'vip', 'analysis', 'ready', 'notifications',
    'android_notifications', 'done')),
  onboarding_completed_at timestamptz,
  terms_accepted_at timestamptz,
  terms_version text,
  last_active_at timestamptz,
  apple_sub_hash bytea,
  is_demo boolean not null default false,
  is_internal boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_pkey primary key (user_id),
  constraint profiles_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
);
create index profiles_state_idx on public.profiles (state) where state <> 'active';
create index profiles_last_active_idx on public.profiles (last_active_at desc);
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
comment on table public.profiles is
  'App profile and account state; created by private.handle_new_user() on auth.users insert (M§88, M§130).';

-- ─── user_preferences ─────────────────────────────────────────────────────────────────────────
create table public.user_preferences (
  user_id uuid not null,
  timezone text not null default 'Europe/Istanbul',
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  reduce_motion boolean not null default false,
  haptics_enabled boolean not null default true,
  retention_policy public.retention_policy not null default 'd90',
  learn_from_interactions boolean not null default true,
  ai_data_access jsonb not null
    default '{"mail_body":true,"attachments":true,"calendar":true,"contacts":true,"location_coarse":false}'::jsonb
    check (private.valid_ai_data_access(ai_data_access)),
  interest_categories text[] not null default '{}'
    check (interest_categories <@ array['work', 'family', 'finance', 'travel', 'shopping', 'appointments', 'deadlines']),
  morning_enabled boolean not null default true,
  morning_time time not null default '08:00',
  midday_enabled boolean not null default true,
  midday_time time not null default '13:00',
  evening_enabled boolean not null default true,
  evening_time time not null default '19:00',
  weekly_enabled boolean not null default true,
  weekly_dow smallint not null default 7 check (weekly_dow between 1 and 7),   -- ISO day, 7 = Sunday
  weekly_time time not null default '18:00',
  briefing_weekdays smallint[] not null default '{1,2,3,4,5,6,7}'
    check (briefing_weekdays <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(briefing_weekdays) >= 1),
  weekend_morning_time time not null default '10:00',
  weekend_morning_only boolean not null default true,
  working_hours_start time not null default '09:00',
  working_hours_end time not null default '18:00',
  dismissed_gates jsonb not null default '{}'::jsonb check (jsonb_typeof(dismissed_gates) = 'object'),
  timezone_mode text not null default 'auto' check (timezone_mode in ('auto', 'manual')),
  weekend_personal_first boolean not null default true,
  work_days smallint[] not null default '{1,2,3,4,5}'
    check (work_days <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(work_days) >= 1),
  default_write_calendar_id uuid,                     -- FK → calendars added in 0003
  default_reply_tone text not null default 'professional'
    check (default_reply_tone in ('short', 'professional', 'friendly', 'detailed')),
  default_task_destination jsonb not null default '{"kind":"in_app"}'::jsonb
    check (jsonb_typeof(default_task_destination) = 'object'
           and default_task_destination ->> 'kind' in ('in_app', 'google_tasks', 'microsoft_todo', 'apple_reminders')),
  default_reminder_destination jsonb not null default '{"kind":"in_app"}'::jsonb
    check (jsonb_typeof(default_reminder_destination) = 'object'
           and default_reminder_destination ->> 'kind' in ('in_app', 'google_tasks', 'microsoft_todo', 'apple_reminders')),
  follow_up_after_days smallint not null default 2 check (follow_up_after_days between 1 and 14),
  analytics_opt_out boolean not null default false,
  screen_protection boolean not null default false,
  first_analysis_job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_preferences_pkey primary key (user_id),
  constraint user_preferences_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint user_preferences_working_hours_check check (working_hours_start < working_hours_end)
);
create index user_preferences_timezone_idx on public.user_preferences (timezone);
create trigger trg_user_preferences_updated_at before update on public.user_preferences
  for each row execute function private.set_updated_at();
alter table public.user_preferences enable row level security;
alter table public.user_preferences force row level security;
comment on table public.user_preferences is
  'Timezone (the only source of the user timezone), briefing schedule, appearance, retention, AI access and personalization (M§9–12, §32, §38–41).';

-- Timezone must be a real IANA zone (§7 trg_user_preferences_validate_tz).
create function private.validate_timezone() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'INVALID_TIMEZONE: %', new.timezone using errcode = '22023';
  end if;
  return new;
end
$$;
revoke execute on function private.validate_timezone() from public;

create trigger trg_user_preferences_validate_tz before insert or update of timezone on public.user_preferences
  for each row execute function private.validate_timezone();

-- ─── notification_preferences ─────────────────────────────────────────────────────────────────
create table public.notification_preferences (
  user_id uuid not null,
  smart_filter boolean not null default true,
  morning boolean not null default true,
  midday boolean not null default true,
  evening boolean not null default true,
  critical_email boolean not null default true,
  meeting boolean not null default true,
  deadline boolean not null default true,
  follow_up boolean not null default true,
  life_intel boolean not null default false,
  approval boolean not null default true,
  account boolean not null default true,
  quiet_hours_enabled boolean not null default true,                   -- R-13
  quiet_start time not null default '22:30',                           -- R-13
  quiet_end time not null default '07:30',                             -- R-13
  quiet_days smallint[] not null default '{1,2,3,4,5,6,7}' check (quiet_days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  vip_bypass_quiet boolean not null default true,                      -- R-13 (default on)
  detail_level public.notification_detail not null default 'title_only',
  lock_screen_private boolean not null default true,
  daily_cap smallint not null default 5 check (daily_cap between 1 and 20),   -- R-14
  snooze_until timestamptz,
  meeting_prep_lead_min smallint not null default 30 check (meeting_prep_lead_min between 15 and 30),  -- R-23
  os_permission text not null default 'undetermined'
    check (os_permission in ('undetermined', 'granted', 'denied', 'provisional')),
  os_permission_updated_at timestamptz,
  prompt_deferred_count smallint not null default 0 check (prompt_deferred_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_preferences_pkey primary key (user_id),
  constraint notification_preferences_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
);
create trigger trg_notification_preferences_updated_at before update on public.notification_preferences
  for each row execute function private.set_updated_at();
alter table public.notification_preferences enable row level security;
alter table public.notification_preferences force row level security;
comment on table public.notification_preferences is
  'Categories, quiet hours (22:30–07:30, VIP bypass on; R-13), lock-screen privacy, detail level and the non-critical daily cap (5; R-14) for the decision engine.';

-- ─── app_installations ────────────────────────────────────────────────────────────────────────
create table public.app_installations (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  installation_id uuid not null,
  platform public.platform not null,
  os_version text,
  app_version text not null check (app_version ~ '^\d+\.\d+\.\d+$'),
  build_number text not null,
  device_model text,
  locale text,
  timezone text,
  push_enabled boolean not null default false,
  ni_listener_granted boolean,
  ni_mode text check (ni_mode in ('all', 'selected')),
  ni_allowed_packages text[] not null default '{}',
  ni_last_signal_at timestamptz,
  platform_capabilities jsonb not null default '{}'::jsonb
    check (jsonb_typeof(platform_capabilities) = 'object'
           and not jsonb_path_exists(platform_capabilities, '$.* ? (@.type() != "boolean")')),
  device_hash bytea not null,
  last_seen_at timestamptz not null default now(),
  signed_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_installations_pkey primary key (id),
  constraint app_installations_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint app_installations_installation_id_key unique (installation_id),
  constraint app_installations_ni_listener_granted_check check (platform = 'android' or ni_listener_granted is null)
);
create index app_installations_user_id_last_seen_at_idx on public.app_installations (user_id, last_seen_at desc);
create index app_installations_app_version_platform_idx on public.app_installations (app_version, platform);
create index app_installations_device_hash_idx on public.app_installations (device_hash);
create trigger trg_app_installations_updated_at before update on public.app_installations
  for each row execute function private.set_updated_at();
alter table public.app_installations enable row level security;
alter table public.app_installations force row level security;
comment on table public.app_installations is
  'One row per app install: platform/version for observability (M§110), device hash for referral anti-abuse (M§45), Android NI grant state.';

-- ─── push_tokens ──────────────────────────────────────────────────────────────────────────────
create table public.push_tokens (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  installation_id uuid not null,
  expo_push_token text not null check (expo_push_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$'),
  status text not null default 'active' check (status in ('active', 'disabled')),
  disabled_reason text
    check (disabled_reason in ('logout', 'device_not_registered', 'user_disabled', 'replaced', 'account_deleted')),
  last_registered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_tokens_pkey primary key (id),
  constraint push_tokens_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint push_tokens_installation_id_fkey foreign key (installation_id)
    references public.app_installations (id) on delete cascade,
  constraint push_tokens_expo_push_token_key unique (expo_push_token)
);
create index push_tokens_user_id_p on public.push_tokens (user_id) where status = 'active';
create index push_tokens_installation_id_idx on public.push_tokens (installation_id);
create trigger trg_push_tokens_updated_at before update on public.push_tokens
  for each row execute function private.set_updated_at();
alter table public.push_tokens enable row level security;
alter table public.push_tokens force row level security;
comment on table public.push_tokens is
  'Expo push tokens per installation (ADR-10); the token itself is never returned to clients or admins.';

-- ─── Retention helpers (§1.6, §6.1, §6.4) ─────────────────────────────────────────────────────
-- expires_at for ⟨EXP⟩ tables from the owner's retention policy: d30 / d90 / d365 → anchor + n
-- days, until_deleted → NULL (kept until the user deletes). Missing preferences fall back to d90.
create function private.compute_expires_at(p_user uuid, p_anchor timestamptz) returns timestamptz
  language sql stable
  security definer
  set search_path = ''
  as $$
    select case coalesce((select up.retention_policy from public.user_preferences up where up.user_id = p_user), 'd90')
      when 'd30' then p_anchor + interval '30 days'
      when 'd90' then p_anchor + interval '90 days'
      when 'd365' then p_anchor + interval '365 days'
      else null
    end
  $$;
revoke execute on function private.compute_expires_at(uuid, timestamptz) from public;
grant execute on function private.compute_expires_at(uuid, timestamptz) to service_role;

-- BEFORE INSERT (and BEFORE UPDATE OF status / the anchor where listed) trigger for ⟨EXP⟩ tables.
-- TG_ARGV lists the anchor columns in priority order (the first non-NULL wins, else now()).
-- Table rules (§4.3–§4.5): open tasks, open/snoozed commitments, scheduled reminders and
-- in-flight approvals never expire; notifications keep 30 days; Android NI signals are capped at
-- 30 days; draft/discarded reply drafts are capped at 30 days; briefing items follow their briefing;
-- meeting preps are anchored on the event end.
create function private.set_expires_at() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_row jsonb := to_jsonb(new);
  v_status text := v_row ->> 'status';
  v_anchor timestamptz;
  v_expires timestamptz;
  i integer;
begin
  if (tg_table_name = 'tasks' and v_status = 'open')
     or (tg_table_name = 'commitments' and v_status in ('open', 'snoozed'))
     or (tg_table_name = 'reminders' and v_status = 'scheduled')
     or (tg_table_name = 'approval_actions' and v_status in ('pending', 'approved', 'executing')) then
    new.expires_at := null;
    return new;
  end if;

  if tg_table_name = 'notifications' then
    new.expires_at := coalesce((v_row ->> 'created_at')::timestamptz, now()) + interval '30 days';
    return new;
  end if;

  if tg_table_name = 'briefing_items' then
    select b.expires_at into v_expires from public.briefings b where b.id = (v_row ->> 'briefing_id')::uuid;
    new.expires_at := v_expires;
    return new;
  end if;

  if tg_table_name = 'meeting_preps' then
    select e.end_at into v_anchor from public.calendar_events e where e.id = (v_row ->> 'calendar_event_id')::uuid;
  end if;

  if v_anchor is null then
    for i in 0 .. tg_nargs - 1 loop
      v_anchor := (v_row ->> tg_argv[i])::timestamptz;
      exit when v_anchor is not null;
    end loop;
  end if;
  v_anchor := coalesce(v_anchor, now());
  v_expires := private.compute_expires_at((v_row ->> 'user_id')::uuid, v_anchor);

  if tg_table_name = 'android_notification_signals'
     or (tg_table_name = 'reply_drafts' and v_status in ('draft', 'discarded')) then
    v_expires := least(v_expires, v_anchor + interval '30 days');   -- least() ignores NULL (until_deleted)
  end if;

  new.expires_at := v_expires;
  return new;
end
$$;
revoke execute on function private.set_expires_at() from public;

-- ─── New auth user → profile and settings rows (§6.1; R-08) ───────────────────────────────────
-- Dedicated admin identities (raw_app_meta_data.da_kind = 'admin') get no app rows. The referral
-- code is added to this function by 0009 once referral_codes exists.
create function private.handle_new_user() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_tz text := nullif(new.raw_user_meta_data ->> 'timezone', '');
begin
  if coalesce(new.raw_app_meta_data ->> 'da_kind', '') = 'admin' then
    return new;
  end if;
  if v_tz is not null and not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    v_tz := null;
  end if;

  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into public.user_preferences (user_id, timezone)
    values (new.id, coalesce(v_tz, 'Europe/Istanbul')) on conflict (user_id) do nothing;
  insert into public.notification_preferences (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end
$$;
revoke execute on function private.handle_new_user() from public;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

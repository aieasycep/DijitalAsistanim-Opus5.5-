-- Migration 0009 · business
-- Spec: docs/DATABASE_AND_RLS_PLAN.md §4.6 (subscriptions, billing_events, entitlement_grants,
-- plan_limits + seed, referral_codes, referrals, referral_credits), §6.1 (handle_new_user creates
-- the referral code), §10 row 0009; ADR-11, R-02, R-22.

-- ─── subscriptions (RevenueCat mirror, overwritten on every sync) ─────────────────────────────
create table public.subscriptions (
  user_id uuid not null,
  entitlement text not null default 'pro' check (entitlement = 'pro'),
  rc_app_user_id text not null,
  is_active boolean not null default false,
  status public.subscription_status not null default 'none',
  store text check (store in ('app_store', 'play_store', 'promotional', 'stripe', 'amazon', 'mac_app_store', 'test_store')),
  environment text check (environment in ('sandbox', 'production')),
  product_id text,
  period_type text check (period_type in ('normal', 'trial', 'intro', 'prepaid')),
  purchased_at timestamptz,
  original_purchased_at timestamptz,
  expires_at timestamptz,
  will_renew boolean not null default false,
  unsubscribe_detected_at timestamptz,
  billing_issue_at timestamptz,
  grace_expires_at timestamptz,
  refunded_at timestamptz,
  cancel_reason text,
  expiration_reason text,
  is_family_share boolean not null default false,
  last_event_id text,
  last_event_type text,
  trial_reminder_at timestamptz,
  synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_pkey primary key (user_id, entitlement),
  constraint subscriptions_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint subscriptions_rc_app_user_id_entitlement_key unique (rc_app_user_id, entitlement)
);
create index subscriptions_status_idx on public.subscriptions (status);
create index subscriptions_expires_at_p on public.subscriptions (expires_at) where is_active;
create index subscriptions_store_product_id_idx on public.subscriptions (store, product_id);
create trigger trg_subscriptions_updated_at before update on public.subscriptions
  for each row execute function private.set_updated_at();
alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;
comment on table public.subscriptions is
  'RevenueCat mirror: every webhook triggers a REST v2 refetch and the row is overwritten (ADR-11).';

-- ─── billing_events (SYS + restrictive aal2 in 0014) ──────────────────────────────────────────
create table public.billing_events (
  id bigint generated always as identity,
  event_id text not null,
  user_id uuid,
  rc_app_user_id text,
  event_type text not null check (event_type in (
    'TEST', 'INITIAL_PURCHASE', 'RENEWAL', 'CANCELLATION', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE',
    'SUBSCRIPTION_PAUSED', 'EXPIRATION', 'BILLING_ISSUE', 'PRODUCT_CHANGE', 'TRANSFER', 'SUBSCRIPTION_EXTENDED',
    'TEMPORARY_ENTITLEMENT_GRANT', 'REFUND_REVERSED', 'INVOICE_ISSUANCE', 'VIRTUAL_CURRENCY_TRANSACTION')),
  environment text,
  store text,
  product_id text,
  event_timestamp timestamptz not null,
  transferred_from text[],
  transferred_to text[],
  payload jsonb not null,                             -- subscriber_attributes stripped
  process_status text not null default 'received'
    check (process_status in ('received', 'processed', 'ignored_sandbox', 'failed')),
  processed_at timestamptz,
  job_id uuid,
  received_at timestamptz not null default now(),
  constraint billing_events_pkey primary key (id),
  constraint billing_events_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null,
  constraint billing_events_event_id_key unique (event_id)
);
create index billing_events_user_id_event_timestamp_idx on public.billing_events (user_id, event_timestamp desc);
create index billing_events_event_type_event_timestamp_idx on public.billing_events (event_type, event_timestamp);
create index billing_events_process_status_p on public.billing_events (process_status)
  where process_status <> 'processed';
alter table public.billing_events enable row level security;
alter table public.billing_events force row level security;
comment on table public.billing_events is
  'Raw RevenueCat webhook ledger deduplicated on event_id (M§60); kept 3 years. System table.';

-- ─── referral_codes ───────────────────────────────────────────────────────────────────────────
-- A code is 6 random characters from the 31-symbol alphabet 23456789ABCDEFGHJKMNPQRSTUVWXYZ
-- (no 0, O, 1, I, L) plus a check character ALPHABET[(Σ i·v(payload[i]), i = 1..6) mod 31]
-- (packages/domain/src/referrals/code.ts); every single-character typo or adjacent swap is caught.
create function private.referral_code_valid(p_code text) returns boolean
  language sql immutable parallel safe
  set search_path = ''
  as $$
    select coalesce(
      p_code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$'
      and substr(p_code, 7, 1) = substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ',
        ((select sum(g.i * (strpos('23456789ABCDEFGHJKMNPQRSTUVWXYZ', substr(p_code, g.i, 1)) - 1))
          from generate_series(1, 6) as g (i)) % 31)::integer + 1, 1),
      false)
  $$;
revoke execute on function private.referral_code_valid(text) from public;
grant execute on function private.referral_code_valid(text) to authenticated, service_role;

create table public.referral_codes (
  user_id uuid not null,
  code text not null check (code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{7}$'),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint referral_codes_pkey primary key (user_id),
  constraint referral_codes_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint referral_codes_code_key unique (code),
  constraint referral_codes_code_checksum_check check (private.referral_code_valid(code))
);
alter table public.referral_codes enable row level security;
alter table public.referral_codes force row level security;
comment on table public.referral_codes is 'One shareable referral code per user (M§45): 6 payload characters + 1 check character, 31-symbol alphabet.';

-- ─── referrals (SYS) ──────────────────────────────────────────────────────────────────────────
create table public.referrals (
  id uuid not null default gen_random_uuid(),
  referrer_id uuid,
  referee_id uuid,
  code text not null,
  status public.referral_status not null default 'pending',
  applied_at timestamptz not null default now(),
  qualified_at timestamptz,
  rewarded_at timestamptz,
  rejected_at timestamptz,
  reject_reason text check (reject_reason in (
    'self_referral', 'duplicate_account', 'loop', 'cap_reached', 'velocity', 'admin_rejected',
    'qualification_timeout', 'tombstoned')),
  risk_score smallint not null default 0 check (risk_score between 0 and 100),
  risk_signals jsonb not null default '{}'::jsonb check (jsonb_typeof(risk_signals) = 'object'),
  referee_device_hash bytea,
  referee_email_hash bytea,
  qualification jsonb not null default '{}'::jsonb check (jsonb_typeof(qualification) = 'object'),
  reviewed_by_admin_id uuid,                          -- FK → admin_users (0012)
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referrals_pkey primary key (id),
  constraint referrals_referrer_id_fkey foreign key (referrer_id) references auth.users (id) on delete set null,
  constraint referrals_referee_id_fkey foreign key (referee_id) references auth.users (id) on delete set null
);
create unique index referrals_referee_id_key on public.referrals (referee_id) where referee_id is not null;
create index referrals_referrer_id_status_idx on public.referrals (referrer_id, status);
create index referrals_status_p on public.referrals (status) where status in ('pending', 'flagged');
create index referrals_referee_device_hash_idx on public.referrals (referee_device_hash);
create index referrals_referee_email_hash_idx on public.referrals (referee_email_hash);
create trigger trg_referrals_updated_at before update on public.referrals
  for each row execute function private.set_updated_at();
alter table public.referrals enable row level security;
alter table public.referrals force row level security;
comment on table public.referrals is
  'Referral lifecycle and anti-abuse record with hashed signals only (M§45; plan §16). System table.';

-- ─── entitlement_grants ───────────────────────────────────────────────────────────────────────
create table public.entitlement_grants (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  entitlement text not null default 'pro' check (entitlement = 'pro'),
  source public.grant_source not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_days smallint not null,
  reason text check (char_length(reason) >= 10),
  granted_by_admin_id uuid,                           -- FK → admin_users (0012)
  referral_credit_id uuid,
  idempotency_key text not null,
  revoked_at timestamptz,
  revoked_by_admin_id uuid,                           -- FK → admin_users (0012)
  revoke_reason text,
  created_at timestamptz not null default now(),
  constraint entitlement_grants_pkey primary key (id),
  constraint entitlement_grants_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint entitlement_grants_idempotency_key_key unique (idempotency_key),
  constraint entitlement_grants_ends_at_check check (ends_at > starts_at),
  constraint entitlement_grants_duration_days_check check (
    (source in ('admin', 'support', 'compensation') and duration_days in (1, 7, 14, 30))
    or (source in ('referral_referrer', 'referral_referee') and duration_days between 1 and 60)),
  constraint entitlement_grants_reason_source_check
    check (source in ('referral_referrer', 'referral_referee') or reason is not null)
);
create index entitlement_grants_user_id_ends_at_p on public.entitlement_grants (user_id, ends_at desc)
  where revoked_at is null;
alter table public.entitlement_grants enable row level security;
alter table public.entitlement_grants force row level security;
comment on table public.entitlement_grants is
  'Referral, admin, support and compensation Pro grants, stacked and kept separate from store state (M§43, §61; ADR-11).';

-- ─── referral_credits ─────────────────────────────────────────────────────────────────────────
create table public.referral_credits (
  id uuid not null default gen_random_uuid(),
  referral_id uuid not null,
  user_id uuid not null,
  side public.referral_side not null,
  days smallint not null default 14,
  entitlement_grant_id uuid,
  idempotency_key text not null,                      -- 'referral:{referral_id}:{side}'
  created_at timestamptz not null default now(),
  constraint referral_credits_pkey primary key (id),
  constraint referral_credits_referral_id_fkey foreign key (referral_id)
    references public.referrals (id) on delete restrict,
  constraint referral_credits_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade,
  constraint referral_credits_entitlement_grant_id_fkey foreign key (entitlement_grant_id)
    references public.entitlement_grants (id) on delete set null,
  constraint referral_credits_referral_id_side_key unique (referral_id, side),
  constraint referral_credits_idempotency_key_key unique (idempotency_key)
);
create index referral_credits_user_id_created_at_idx on public.referral_credits (user_id, created_at);
create index referral_credits_entitlement_grant_id_idx on public.referral_credits (entitlement_grant_id);
alter table public.referral_credits enable row level security;
alter table public.referral_credits force row level security;
comment on table public.referral_credits is 'Idempotent referral reward records, one per (referral, side) (M§45, §116).';

alter table public.entitlement_grants
  add constraint entitlement_grants_referral_credit_id_fkey foreign key (referral_credit_id)
    references public.referral_credits (id) on delete set null;
create index entitlement_grants_referral_credit_id_idx on public.entitlement_grants (referral_credit_id);

-- ─── plan_limits (key/value, R-22) ────────────────────────────────────────────────────────────
create table public.plan_limits (
  plan text not null check (plan in ('free', 'pro')),
  key text not null check (key in (
    'max_mail_accounts', 'max_calendar_accounts', 'max_calendars', 'vip_max', 'priority_rules_max',
    'ai_daily_budget_units', 'ai_soft_cap_usd_day', 'ai_hard_cap_usd_day', 'ai_hard_cap_usd_month',
    'ai_briefing_reserve_ratio', 'ai_routing_profile', 'email_analysis_daily', 'reply_drafts_daily',
    'assistant_messages_daily', 'assistant_retrieval_days', 'transcribe_seconds_daily', 'captures_daily',
    'meeting_preps_daily', 'semantic_search_daily', 'backfill_days', 'referral_rewards_per_year', 'meeting_prep',
    'memory_search', 'voice_briefing', 'android_ni', 'midday_evening', 'advanced_planning',
    'follow_up_commitments', 'capture', 'vip')),
  value jsonb not null,
  updated_by uuid,                                    -- FK → admin_users (0012)
  updated_at timestamptz not null default now(),
  constraint plan_limits_pkey primary key (plan, key),
  constraint plan_limits_value_check check (private.valid_plan_limit(key, value))
);
create trigger trg_plan_limits_updated_at before update on public.plan_limits
  for each row execute function private.set_updated_at();
alter table public.plan_limits enable row level security;
alter table public.plan_limits force row level security;
comment on table public.plan_limits is
  'Free/Pro limits, AI budgets, routing profile and feature switches used by server gates (M§44, §82; R-22). Editable in backoffice Settings, never hard-coded.';

-- Seed (§4.6 table; values per plan §8 budgets). Free shows "AI analiz limiti 50/gün"; the Pro
-- ceiling is an internal fair-use backstop shown as "Adil kullanım".
insert into public.plan_limits (plan, key, value) values
  ('free', 'max_mail_accounts', '1'),           ('pro', 'max_mail_accounts', '10'),
  ('free', 'max_calendar_accounts', '1'),       ('pro', 'max_calendar_accounts', '10'),
  ('free', 'max_calendars', '1'),               ('pro', 'max_calendars', '30'),
  ('free', 'vip_max', '5'),                     ('pro', 'vip_max', '100'),
  ('free', 'priority_rules_max', '10'),         ('pro', 'priority_rules_max', '200'),
  ('free', 'ai_daily_budget_units', '50'),      ('pro', 'ai_daily_budget_units', '600'),
  ('free', 'ai_soft_cap_usd_day', '0.02'),      ('pro', 'ai_soft_cap_usd_day', '0.20'),
  ('free', 'ai_hard_cap_usd_day', '0.03'),      ('pro', 'ai_hard_cap_usd_day', '0.60'),
  ('free', 'ai_hard_cap_usd_month', '0.90'),    ('pro', 'ai_hard_cap_usd_month', '6.00'),
  ('free', 'ai_briefing_reserve_ratio', '0.25'), ('pro', 'ai_briefing_reserve_ratio', '0.15'),
  ('free', 'ai_routing_profile', '"lean"'),     ('pro', 'ai_routing_profile', '"balanced"'),
  ('free', 'email_analysis_daily', '150'),      ('pro', 'email_analysis_daily', '1500'),
  ('free', 'reply_drafts_daily', '5'),          ('pro', 'reply_drafts_daily', '60'),
  ('free', 'assistant_messages_daily', '10'),   ('pro', 'assistant_messages_daily', '200'),
  ('free', 'assistant_retrieval_days', '7'),    ('pro', 'assistant_retrieval_days', 'null'),
  ('free', 'transcribe_seconds_daily', '60'),   ('pro', 'transcribe_seconds_daily', '1800'),
  ('free', 'captures_daily', '0'),              ('pro', 'captures_daily', '50'),
  ('free', 'meeting_preps_daily', '0'),         ('pro', 'meeting_preps_daily', '30'),
  ('free', 'semantic_search_daily', '0'),       ('pro', 'semantic_search_daily', '300'),
  ('free', 'backfill_days', '30'),              ('pro', 'backfill_days', '90'),
  ('free', 'referral_rewards_per_year', '6'),   ('pro', 'referral_rewards_per_year', '6'),
  ('free', 'meeting_prep', 'false'),            ('pro', 'meeting_prep', 'true'),
  ('free', 'memory_search', 'false'),           ('pro', 'memory_search', 'true'),
  ('free', 'voice_briefing', 'false'),          ('pro', 'voice_briefing', 'true'),
  ('free', 'android_ni', 'false'),              ('pro', 'android_ni', 'true'),
  ('free', 'midday_evening', 'false'),          ('pro', 'midday_evening', 'true'),
  ('free', 'advanced_planning', 'false'),       ('pro', 'advanced_planning', 'true'),
  ('free', 'follow_up_commitments', 'false'),   ('pro', 'follow_up_commitments', 'true'),
  ('free', 'capture', 'false'),                 ('pro', 'capture', 'true'),
  ('free', 'vip', 'false'),                     ('pro', 'vip', 'true')
on conflict (plan, key) do nothing;

-- ─── Referral code for every new user (§4.6 "created by handle_new_user, retry on collision") ─
-- Same algorithm as packages/domain/src/referrals/code.ts generateReferralCode: uniform payload
-- characters by rejection sampling (bytes ≥ 248 = 256 − 256 mod 31 are discarded), then the check
-- character; up to 8 attempts on a code collision.
create function private.create_referral_code(p_user uuid) returns text
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  c_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code text;
  v_payload text;
  v_sum integer;
  v_byte integer;
  v_attempt integer;
  i integer;
begin
  select rc.code into v_code from public.referral_codes rc where rc.user_id = p_user;
  if found then
    return v_code;
  end if;
  for v_attempt in 1 .. 8 loop
    v_payload := '';
    v_sum := 0;
    for i in 1 .. 6 loop
      loop
        v_byte := get_byte(extensions.gen_random_bytes(1), 0);
        exit when v_byte < 248;
      end loop;
      v_payload := v_payload || substr(c_alphabet, (v_byte % 31) + 1, 1);
      v_sum := v_sum + i * (v_byte % 31);
    end loop;
    v_code := v_payload || substr(c_alphabet, (v_sum % 31) + 1, 1);
    begin
      insert into public.referral_codes (user_id, code) values (p_user, v_code);
      return v_code;
    exception when unique_violation then
      select rc.code into v_code from public.referral_codes rc where rc.user_id = p_user;
      if found then
        return v_code;                                -- concurrent insert for the same user
      end if;                                         -- otherwise a code collision: retry
    end;
  end loop;
  raise exception 'REFERRAL_CODE_COLLISION' using errcode = '23505';
end
$$;
revoke execute on function private.create_referral_code(uuid) from public;
grant execute on function private.create_referral_code(uuid) to service_role;

-- handle_new_user (0002) now also creates the referral code; admin identities still get nothing.
create or replace function private.handle_new_user() returns trigger
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
  perform private.create_referral_code(new.id);
  return new;
end
$$;
revoke execute on function private.handle_new_user() from public;

-- Users created before this migration get their code now.
do $$
begin
  perform private.create_referral_code(p.user_id)
  from public.profiles p
  where not exists (select 1 from public.referral_codes rc where rc.user_id = p.user_id);
end
$$;

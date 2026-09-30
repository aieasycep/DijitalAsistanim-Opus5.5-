-- GAP-4 · PUB-04 referral resolve carries the reward kill switch (STORE_CHECKLIST 3.1.1).
-- Spec: API_CONTRACTS §13 PUB-04; `app_settings.referral.rewards_enabled` (migration 20260924003300,
-- private.referral_rewards_enabled(): missing or malformed → on). The web `/r/[code]` landing must not
-- promise the Pro reward while rewards are off; the code itself still applies, so `valid` is
-- unchanged. `create or replace` keeps the owner and the grants of 20260924002220.

set local lock_timeout = '10s';
set local statement_timeout = '10min';

create or replace function private.public_referral_resolve(p_code text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_valid boolean := exists (select 1 from public.referral_codes rc where rc.code = upper(p_code) and rc.disabled_at is null);
begin
  if v_valid then
    insert into public.analytics_events (event_name, props, platform, occurred_at)
    values ('referral_link_opened', '{}'::jsonb, 'web', now());
  end if;
  return jsonb_build_object(
    'valid', v_valid,
    'reward_days', private.app_setting_int('referral.reward_days', 14),
    'apply_window_days', private.app_setting_int('referral.apply_window_days', 7),
    'rewards_enabled', private.referral_rewards_enabled());
end
$$;

-- T-11.05 (threat-model verification, THR-15 referral abuse): a referral loop must be rejected on
-- every leg, whatever order JOB-25 evaluates them in.
--
-- The loop walk of private.referral_evaluation_context skipped rejected referrals. In an A→B / B→A
-- pair the first evaluated leg was rejected as `loop`, its edge then vanished from the walk and the
-- mirror leg was rewarded on both sides. Edges rejected *as a loop* now stay in the walk; referrals
-- rejected for any other reason (qualification timeout, self, tombstone) still do not taint the graph.
-- Same signature, grants and wrapper (public.referral_evaluation_context) as 20260924002210.

set local lock_timeout = '10s';
set local statement_timeout = '10min';

create or replace function private.referral_evaluation_context(p_referral_id uuid, p_now timestamptz default now()) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
  as $$
declare
  r public.referrals;
  v_siblings uuid[];
  v_referee_hashes bytea[];
  v_referee_mailboxes text[];
begin
  select * into r from public.referrals x where x.id = p_referral_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(x.referee_id), '{}') into v_siblings from public.referrals x
  where x.referrer_id = r.referrer_id and x.id <> r.id and x.status <> 'rejected' and x.referee_id is not null;
  select coalesce(array_agg(i.device_hash), '{}') into v_referee_hashes from public.app_installations i
  where i.user_id = r.referee_id;
  if r.referee_device_hash is not null then
    v_referee_hashes := v_referee_hashes || r.referee_device_hash;
  end if;
  select coalesce(array_agg(lower(a.account_email::text)), '{}') into v_referee_mailboxes from public.connected_accounts a
  where a.user_id = r.referee_id and a.account_email is not null and a.status <> 'disconnected';

  return jsonb_build_object(
    'referral', jsonb_build_object(
      'id', r.id, 'status', r.status, 'applied_at', r.applied_at, 'referrer_id', r.referrer_id,
      'referee_id', r.referee_id, 'referee_email_hash', encode(r.referee_email_hash, 'hex'),
      'referee_device_hash', encode(r.referee_device_hash, 'hex'), 'risk_signals', r.risk_signals),
    'referee', (select jsonb_build_object(
        'user_id', u.id, 'created_at', u.created_at, 'email', u.email, 'apple_sub', private.user_apple_sub(u.id),
        'installation_ids', coalesce((select jsonb_agg(i.installation_id order by i.created_at) from public.app_installations i
                                      where i.user_id = u.id), '[]'::jsonb),
        'device_hashes', coalesce((select jsonb_agg(distinct encode(h, 'hex')) from unnest(v_referee_hashes) as h), '[]'::jsonb),
        'provider_emails', to_jsonb(v_referee_mailboxes),
        'onboarding_completed_at', (select p.onboarding_completed_at from public.profiles p where p.user_id = u.id),
        'account_connected_at', (select min(coalesce(a.connected_at, a.created_at)) from public.connected_accounts a
                                 where a.user_id = u.id and a.status = 'healthy'),
        'first_briefing_at', (select min(coalesce(b.delivered_at, b.updated_at)) from public.briefings b
                              where b.user_id = u.id and b.status = 'delivered'))
      from auth.users u where u.id = r.referee_id),
    'referrer', (select jsonb_build_object(
        'user_id', u.id, 'email', u.email, 'apple_sub', private.user_apple_sub(u.id),
        'device_hashes', coalesce((select jsonb_agg(distinct encode(i.device_hash, 'hex')) from public.app_installations i
                                   where i.user_id = u.id), '[]'::jsonb),
        'provider_emails', coalesce((select jsonb_agg(distinct lower(a.account_email::text)) from public.connected_accounts a
                                     where a.user_id = u.id and a.account_email is not null and a.status <> 'disconnected'),
                                    '[]'::jsonb))
      from auth.users u where u.id = r.referrer_id),
    'siblings', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', x.referee_id, 'email_hash', encode(x.referee_email_hash, 'hex'),
        'device_hash', encode(x.referee_device_hash, 'hex')))
      from public.referrals x where x.referee_id = any(v_siblings) and x.referrer_id = r.referrer_id), '[]'::jsonb),
    'edges', coalesce((
      with recursive walk (referrer_id, referee_id, depth) as (
        select x.referrer_id, x.referee_id, 1 from public.referrals x
        where x.referrer_id = r.referee_id and x.referee_id is not null
          and (x.status <> 'rejected' or x.reject_reason = 'loop')
        union
        select x.referrer_id, x.referee_id, w.depth + 1 from public.referrals x
        join walk w on x.referrer_id = w.referee_id
        where (x.status <> 'rejected' or x.reject_reason = 'loop') and x.referee_id is not null and w.depth < 20
      )
      select jsonb_agg(distinct jsonb_build_object('referrer_id', w.referrer_id, 'referee_id', w.referee_id))
      from (select * from walk limit 1000) as w), '[]'::jsonb),
    'referrer_applied_at', coalesce((select jsonb_agg(x.applied_at order by x.applied_at) from public.referrals x
                                     where x.referrer_id = r.referrer_id
                                       and x.applied_at between r.applied_at - interval '1 day' and r.applied_at + interval '1 day'),
                                    '[]'::jsonb),
    'referrer_rewarded_at', coalesce((select jsonb_agg(c.created_at order by c.created_at) from public.referral_credits c
                                      where c.user_id = r.referrer_id and c.side = 'referrer'
                                        and c.created_at > p_now - interval '365 days'), '[]'::jsonb),
    'other_accounts_sharing', (
      select count(distinct z.user_id) from (
        select i.user_id from public.app_installations i where i.device_hash = any(v_referee_hashes)
        union
        select a.user_id from public.connected_accounts a
        where lower(a.account_email::text) = any(v_referee_mailboxes) and a.status <> 'disconnected'
      ) as z
      where z.user_id is distinct from r.referee_id and z.user_id is distinct from r.referrer_id
        and not (z.user_id = any(v_siblings))),
    'settings', coalesce((select jsonb_object_agg(s.key, s.value) from public.app_settings s where s.key like 'referral.%'),
                         '{}'::jsonb),
    'rewards_per_year', coalesce(private.plan_limit_int(r.referrer_id, 'referral_rewards_per_year'), 6));
end
$$;


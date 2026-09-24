-- Demo dataset (IMPLEMENTATION_PLAN T-2.24; DATABASE_AND_RLS_PLAN §11; M§89, M§100; SREQ-104).
--
-- Loaded ONLY by `pnpm db:seed:demo` (scripts/db/seed-demo.sh), which refuses unless DEMO_MODE=true
-- (and refuses APP_ENV=production unless ALLOW_DEMO_IN_PRODUCTION=true). The runner sets
-- `da.demo_mode = 'true'` for this session; without it the file raises and writes nothing.
--
-- Deterministic ids: md5('da-demo:' || entity || ':' || slug)::uuid. Every timestamp is relative
-- to today in Europe/Istanbul, so the data never goes stale. Re-running is idempotent: the demo
-- users are upserted, their seeded content is removed and written again for the current day.
-- Demo users carry profiles.is_demo = true and are excluded from metrics, referrals and revenue.

create or replace function pg_temp.da_demo_id(p_entity text, p_slug text) returns uuid
  language sql immutable
  as $$ select md5('da-demo:' || p_entity || ':' || p_slug)::uuid $$;

do $$
declare
  c_tz constant text := 'Europe/Istanbul';
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_user uuid := pg_temp.da_demo_id('user', 'demo');
  v_free uuid := pg_temp.da_demo_id('user', 'demo-free');
  v_mail uuid := pg_temp.da_demo_id('account', 'gmail');
  v_cal_acct uuid := pg_temp.da_demo_id('account', 'google-calendar');
  v_free_mail uuid := pg_temp.da_demo_id('account', 'free-gmail');
  v_cal_personal uuid := pg_temp.da_demo_id('calendar', 'kisisel');
  v_cal_work uuid := pg_temp.da_demo_id('calendar', 'is');
  v_ahmet uuid := pg_temp.da_demo_id('contact', 'ahmet');
  v_mehmet uuid := pg_temp.da_demo_id('contact', 'mehmet');
  v_selin uuid := pg_temp.da_demo_id('contact', 'selin');
  v_ayse uuid := pg_temp.da_demo_id('contact', 'ayse');
  v_muhasebe uuid := pg_temp.da_demo_id('contact', 'muhasebe');
  v_t_teklif uuid := pg_temp.da_demo_id('thread', 'revize-teklif');
  v_t_mehmet uuid := pg_temp.da_demo_id('thread', 're-teklif');
  v_m_teklif uuid := pg_temp.da_demo_id('message', 'revize-teklif');
  v_m_mehmet uuid := pg_temp.da_demo_id('message', 're-teklif');
  v_m_security uuid := pg_temp.da_demo_id('message', 'google-security');
  v_m_fatura uuid := pg_temp.da_demo_id('message', 'elektrik-faturasi');
  v_e_customer uuid := pg_temp.da_demo_id('event', 'musteri-toplantisi');
  v_briefing uuid := pg_temp.da_demo_id('briefing', 'morning-today');
  v_weekly uuid := pg_temp.da_demo_id('briefing', 'weekly-last');
  v_draft uuid := pg_temp.da_demo_id('reply_draft', 'ahmet');
  v_ap_mail uuid := pg_temp.da_demo_id('approval', 'reply-ahmet');
  v_ap_cal uuid := pg_temp.da_demo_id('approval', 'teklif-hazirlama');
  v_last_sunday date := (now() at time zone 'Europe/Istanbul')::date
                        - extract(isodow from (now() at time zone 'Europe/Istanbul'))::integer;   -- the Sunday before today
  v_has_instance boolean := exists (select 1 from information_schema.columns
                                    where table_schema = 'auth' and table_name = 'users' and column_name = 'instance_id');
  v_seq integer;
  v_thread uuid;
begin
  if coalesce(current_setting('da.demo_mode', true), '') <> 'true' then
    raise exception 'DEMO_MODE_REQUIRED' using errcode = '42501',
      hint = 'Run pnpm db:seed:demo with DEMO_MODE=true; the demo dataset is never loaded implicitly.';
  end if;

  -- ─── Users (email OTP via the local Inbucket; confirmed, no password) ─────────────────────
  if v_has_instance then
    execute $q$
      insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                              created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', 'demo@dijitalasistan.app', now(),
              '{"provider": "email", "providers": ["email"]}', '{"timezone": "Europe/Istanbul"}', now(), now()),
             ('00000000-0000-0000-0000-000000000000', $2, 'authenticated', 'authenticated', 'demo-free@dijitalasistan.app', now(),
              '{"provider": "email", "providers": ["email"]}', '{"timezone": "Europe/Istanbul"}', now(), now())
      on conflict (id) do nothing$q$ using v_user, v_free;
  else
    insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (v_user, 'authenticated', 'authenticated', 'demo@dijitalasistan.app', now(), '{"provider": "email", "providers": ["email"]}',
            '{"timezone": "Europe/Istanbul"}'),
           (v_free, 'authenticated', 'authenticated', 'demo-free@dijitalasistan.app', now(), '{"provider": "email", "providers": ["email"]}',
            '{"timezone": "Europe/Istanbul"}')
    on conflict (id) do nothing;
  end if;
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_user::text, v_user, jsonb_build_object('sub', v_user::text, 'email', 'demo@dijitalasistan.app', 'email_verified', true),
          'email', now(), now(), now()),
         (v_free::text, v_free, jsonb_build_object('sub', v_free::text, 'email', 'demo-free@dijitalasistan.app', 'email_verified', true),
          'email', now(), now(), now())
  on conflict (provider_id, provider) do nothing;

  update public.profiles
    set display_name = case when user_id = v_user then 'Yunus' else 'Deniz' end, is_demo = true, locale = 'tr-TR',
        onboarding_step = 'done', onboarding_completed_at = coalesce(onboarding_completed_at, now()),
        terms_accepted_at = coalesce(terms_accepted_at, now()), terms_version = coalesce(terms_version, '2026-09'),
        last_active_at = now()
  where user_id in (v_user, v_free);
  update public.user_preferences set timezone = c_tz where user_id in (v_user, v_free);

  -- ─── Remove the previous run's content (the users and their settings stay) ─────────────────
  delete from public.approval_actions where user_id in (v_user, v_free);
  delete from public.reply_drafts where user_id in (v_user, v_free);
  delete from public.briefings where user_id in (v_user, v_free);
  delete from public.insights where user_id in (v_user, v_free);
  delete from public.commitments where user_id in (v_user, v_free);
  delete from public.life_events where user_id in (v_user, v_free);
  delete from public.memory_chunks where user_id in (v_user, v_free);
  delete from public.learned_preferences where user_id in (v_user, v_free);
  delete from public.priority_rules where user_id in (v_user, v_free);
  delete from public.vip_people where user_id in (v_user, v_free);
  delete from public.email_messages where user_id in (v_user, v_free);
  delete from public.email_threads where user_id in (v_user, v_free);
  delete from public.calendar_events where user_id in (v_user, v_free);
  delete from public.contacts where user_id in (v_user, v_free);
  delete from public.connected_accounts where user_id in (v_user, v_free);
  delete from public.entitlement_grants where user_id in (v_user, v_free) and source = 'admin';

  -- ─── Pro for the main demo user (30 days from today; never counted as revenue) ────────────
  perform private.grant_entitlement(v_user, 'admin', 30::smallint, 'demo seed data', null, 'demo:pro:' || v_today);

  -- ─── Connected accounts and calendars (demo provider, Google flavour) ─────────────────────
  insert into public.connected_accounts (id, user_id, provider, provider_account_id, account_email, display_label, status,
                                         capabilities_granted, connected_at, last_sync_at, last_successful_sync_at, demo_flavor)
  values (v_mail, v_user, 'demo', 'demo-gmail', 'yunus@gmail.com', 'Gmail · yunus@gmail.com', 'healthy', '{mail_read,mail_send}',
          now() - interval '20 days', now() - interval '4 minutes', now() - interval '4 minutes', 'google'),
         (v_cal_acct, v_user, 'demo', 'demo-google-calendar', 'yunus@gmail.com', 'Google Takvim', 'healthy',
          '{calendar_read,calendar_write}', now() - interval '20 days', now() - interval '4 minutes', now() - interval '4 minutes',
          'google'),
         (v_free_mail, v_free, 'demo', 'demo-free-gmail', 'deniz@gmail.com', 'Gmail · deniz@gmail.com', 'healthy', '{mail_read}',
          now() - interval '5 days', now() - interval '9 minutes', now() - interval '9 minutes', 'google');
  insert into public.calendars (id, user_id, connected_account_id, provider, provider_calendar_id, name, color, time_zone, access_role,
                                is_primary, selected, can_write)
  values (v_cal_personal, v_user, v_cal_acct, 'demo', 'kisisel', 'Kişisel', '#3F7D5B', c_tz, 'owner', true, true, true),
         (v_cal_work, v_user, v_cal_acct, 'demo', 'is', 'İş', '#2E5AAC', c_tz, 'owner', false, true, true);

  -- ─── Contacts and VIP ──────────────────────────────────────────────────────────────────────
  insert into public.contacts (id, user_id, display_name, primary_email, emails, organization, avatar_seed, origin, first_seen_at,
                               last_contact_at, last_inbound_at, message_count_30d, meeting_count_30d)
  values (v_ahmet, v_user, 'Ahmet Yılmaz', 'ahmet@kuzeylojistik.com', '{ahmet@kuzeylojistik.com}', 'Kuzey Lojistik', 11, 'mail',
          now() - interval '60 days', now() - interval '1 hour', now() - interval '1 hour', 9, 2),
         (v_mehmet, v_user, 'Mehmet Yılmaz', 'mehmet@yilmazendustri.com', '{mehmet@yilmazendustri.com}', 'Yılmaz Endüstri', 23, 'mail',
          now() - interval '90 days', now() - interval '3 days', now() - interval '6 days', 12, 3),
         (v_selin, v_user, 'Selin Kaya', 'selin.kaya@gmail.com', '{selin.kaya@gmail.com}', null, 37, 'mail',
          now() - interval '40 days', now() - interval '1 day', now() - interval '1 day', 14, 0),
         (v_ayse, v_user, 'Ayşe Kara', 'ayse@yilmazendustri.com', '{ayse@yilmazendustri.com}', 'Yılmaz Endüstri', 41, 'mail',
          now() - interval '30 days', now() - interval '5 days', now() - interval '5 days', 3, 1),
         (v_muhasebe, v_user, 'Yılmaz Endüstri Muhasebe', 'muhasebe@yilmazendustri.com', '{muhasebe@yilmazendustri.com}',
          'Yılmaz Endüstri', 52, 'mail', now() - interval '30 days', now() - interval '2 days', now() - interval '2 days', 2, 0);
  insert into public.vip_people (id, user_id, contact_id, relationship, always_notify, bypass_quiet_hours, origin)
  values (pg_temp.da_demo_id('vip', 'ahmet'), v_user, v_ahmet, 'key_client', true, false, 'onboarding'),
         (pg_temp.da_demo_id('vip', 'mehmet'), v_user, v_mehmet, 'key_client', true, false, 'onboarding');

  -- ─── Mail ──────────────────────────────────────────────────────────────────────────────────
  insert into public.email_threads (id, user_id, connected_account_id, provider, provider_thread_id, subject, participants,
                                    message_count, last_message_at, last_inbound_at, last_outbound_at, has_unread, category,
                                    category_tier, category_reason, category_confidence, urgency, reply_state, ai_summary,
                                    key_points, deadline_at, deadline_evidence, follow_up_state, awaiting_since, topic_label)
  values (v_t_teklif, v_user, v_mail, 'demo', 'demo-thread-revize-teklif', 'Revize teklif',
          jsonb_build_array(jsonb_build_object('email', 'ahmet@kuzeylojistik.com', 'name', 'Ahmet Yılmaz', 'contact_id', v_ahmet)),
          2, (v_today + time '08:42') at time zone c_tz, (v_today + time '08:42') at time zone c_tz,
          (v_today - 2 + time '16:10') at time zone c_tz, true, 'awaiting_my_reply', 'explicit_rule',
          'VIP müşteri ve bugün 17:00 son tarih', 0.96, 'urgent', 'awaiting_my_reply',
          'Ahmet revize teklifi bugün 17:00''a kadar bekliyor; fiyat ve teslim tarihini netleştirmen gerekiyor.',
          '["Revize teklif bugün 17:00''a kadar isteniyor", "Teslim tarihi ve birim fiyat soruluyor"]',
          (v_today + time '17:00') at time zone c_tz,
          '[{"quote": "Revize teklifi bugün saat 17:00''a kadar iletebilir misiniz?", "field": "deadline_at"}]',
          'none', null, 'Revize teklif'),
         (v_t_mehmet, v_user, v_mail, 'demo', 'demo-thread-re-teklif', 'Re: Teklif',
          jsonb_build_array(jsonb_build_object('email', 'mehmet@yilmazendustri.com', 'name', 'Mehmet Yılmaz', 'contact_id', v_mehmet)),
          3, (v_today - 3 + time '11:05') at time zone c_tz, (v_today - 6 + time '09:30') at time zone c_tz,
          (v_today - 3 + time '11:05') at time zone c_tz, false, 'awaiting_their_reply', 'deterministic_signal',
          'Son mesajı sen gönderdin; 3 gündür yanıt yok', 0.9, 'normal', 'awaiting_their_reply',
          'Mehmet''e teklifi 3 gün önce gönderdin, henüz yanıt gelmedi.', '["Teklif 3 gün önce gönderildi"]', null, null,
          'waiting', (v_today - 3 + time '11:05') at time zone c_tz, 'Teklif');
  insert into public.email_messages (id, user_id, connected_account_id, thread_id, provider, provider_message_id, direction, from_email,
                                     from_name, to_emails, subject, snippet, sent_at, received_at, content_hash, dkim_pass,
                                     ai_status, classification, classification_tier, classification_reason, classification_confidence,
                                     life_signal)
  values (v_m_teklif, v_user, v_mail, v_t_teklif, 'demo', 'demo-msg-revize-teklif', 'inbound', 'ahmet@kuzeylojistik.com',
          'Ahmet Yılmaz', '{yunus@gmail.com}', 'Revize teklif',
          'Merhaba Yunus Bey, revize teklifi bugün saat 17:00''a kadar iletebilir misiniz?', (v_today + time '08:42') at time zone c_tz,
          (v_today + time '08:42') at time zone c_tz, sha256('demo:revize-teklif'::bytea), true, 'classified', 'awaiting_my_reply',
          'explicit_rule', 'VIP müşteri', 0.96, 'none'),
         (v_m_mehmet, v_user, v_mail, v_t_mehmet, 'demo', 'demo-msg-re-teklif', 'outbound', 'yunus@gmail.com', 'Yunus',
          '{mehmet@yilmazendustri.com}', 'Re: Teklif', 'Mehmet Bey, teklifimiz ektedir. Sorularınız için buradayım.',
          (v_today - 3 + time '11:05') at time zone c_tz, (v_today - 3 + time '11:05') at time zone c_tz,
          sha256('demo:re-teklif'::bytea), null, 't0_final', 'awaiting_their_reply', 'deterministic_signal', 'Giden mesaj', 0.9, 'none');

  -- 45 bulk messages + "Revize teklif" = 46 messages in the last 72 hours (First Analysis counts).
  for v_seq in 1 .. 45 loop
    v_thread := pg_temp.da_demo_id('thread', 'bulk-' || v_seq);
    insert into public.email_threads (id, user_id, connected_account_id, provider, provider_thread_id, subject, participants, message_count,
                                      last_message_at, last_inbound_at, has_unread, category, category_tier, category_reason,
                                      category_confidence, urgency, reply_state)
    values (v_thread, v_user, v_mail, 'demo', 'demo-thread-bulk-' || v_seq,
            case when v_seq = 1 then 'Google hesabında yeni giriş'
                 when v_seq = 2 then 'Elektrik faturanız hazır'
                 when v_seq % 3 = 0 then 'Haftalık bülten #' || v_seq
                 else 'Kampanya: bu hafta %' || (10 + v_seq % 40) || ' indirim' end,
            jsonb_build_array(jsonb_build_object('email', case when v_seq = 1 then 'no-reply@accounts.google.com'
                                                               when v_seq = 2 then 'fatura@ckenerji.com.tr'
                                                               when v_seq % 3 = 0 then 'bulten@haberler.example.com'
                                                               else 'kampanya@magaza.example.com' end)),
            1, now() - make_interval(hours => v_seq + 1), now() - make_interval(hours => v_seq + 1), v_seq <= 6,
            (case when v_seq <= 2 then 'important' when v_seq % 3 = 0 then 'informational' else 'low_priority' end)::public.mail_category,
            'deterministic_signal', case when v_seq <= 2 then 'Güvenlik veya ödeme bildirimi' else 'Toplu gönderim' end, 0.85,
            (case when v_seq <= 2 then 'today' else 'low' end)::public.urgency, 'none');
    insert into public.email_messages (id, user_id, connected_account_id, thread_id, provider, provider_message_id, direction, from_email,
                                       from_name, subject, snippet, received_at, content_hash, dkim_pass, ai_status, classification,
                                       classification_tier, classification_confidence, life_signal, list_unsubscribe)
    select case v_seq when 1 then v_m_security when 2 then v_m_fatura else pg_temp.da_demo_id('message', 'bulk-' || v_seq) end,
           v_user, v_mail, v_thread, 'demo', 'demo-msg-bulk-' || v_seq, 'inbound', t.participants -> 0 ->> 'email',
           case when v_seq = 1 then 'Google' when v_seq = 2 then 'CK Enerji' when v_seq % 3 = 0 then 'Haber Bülteni' else 'Mağaza' end,
           t.subject,
           case when v_seq = 1 then 'Google hesabında yeni giriş. Bu sen değilsen hesabını hemen güvenceye al.'
                when v_seq = 2 then 'Elektrik faturanız 1.842,00 TL. Son ödeme tarihi ' || to_char(v_today + 2, 'DD.MM.YYYY') || '.'
                else 'Bu haftanın öne çıkanları ve fırsatları.' end,
           case when v_seq = 1 then (v_today + time '07:12') at time zone c_tz else t.last_message_at end,
           sha256(convert_to('demo:bulk:' || v_seq, 'UTF8')), true, 'classified', t.category, 'deterministic_signal', 0.85,
           case when v_seq = 2 then 'payment' else 'none' end, v_seq > 2
    from public.email_threads t where t.id = v_thread;
  end loop;

  -- ─── Calendar ──────────────────────────────────────────────────────────────────────────────
  insert into public.calendar_events (id, user_id, connected_account_id, calendar_id, provider, provider_event_id, title, location,
                                      is_online, conference_url, start_at, end_at, time_zone, status, organizer_email, organizer_self,
                                      can_modify, attendees, attendee_count, origin)
  values (v_e_customer, v_user, v_cal_acct, v_cal_work, 'demo', 'demo-event-musteri', 'Müşteri toplantısı · Mehmet Yılmaz', null, true,
          'https://meet.google.com/abc-defg-hij', (v_today + time '14:30') at time zone c_tz, (v_today + time '15:30') at time zone c_tz,
          c_tz, 'confirmed', 'yunus@gmail.com', true, true,
          jsonb_build_array(jsonb_build_object('email', 'mehmet@yilmazendustri.com', 'name', 'Mehmet Yılmaz', 'contact_id', v_mehmet,
                                               'response', 'accepted')), 1, 'demo'),
         (pg_temp.da_demo_id('event', 'haftalik-ekip-bugun'), v_user, v_cal_acct, v_cal_work, 'demo', 'demo-event-ekip-bugun',
          'Haftalık ekip', 'Toplantı odası 2', false, null, (v_today + time '10:00') at time zone c_tz,
          (v_today + time '10:45') at time zone c_tz, c_tz, 'confirmed', 'yunus@gmail.com', true, true,
          '[{"email": "ekip@gmail.com", "name": "Ekip"}]', 1, 'demo'),
         (pg_temp.da_demo_id('event', 'haftalik-ekip-yarin'), v_user, v_cal_acct, v_cal_work, 'demo', 'demo-event-ekip-yarin',
          'Haftalık ekip', 'Toplantı odası 2', false, null, (v_today + 1 + time '09:00') at time zone c_tz,
          (v_today + 1 + time '09:45') at time zone c_tz, c_tz, 'confirmed', 'yunus@gmail.com', true, true,
          '[{"email": "ekip@gmail.com", "name": "Ekip"}]', 1, 'demo'),
         (pg_temp.da_demo_id('event', 'cakisma-1'), v_user, v_cal_acct, v_cal_work, 'demo', 'demo-event-cakisma-1',
          'Tedarikçi görüşmesi', null, true, 'https://meet.google.com/xyz-abcd-efg', (v_today + 1 + time '14:00') at time zone c_tz,
          (v_today + 1 + time '15:00') at time zone c_tz, c_tz, 'confirmed', 'yunus@gmail.com', true, true,
          '[{"email": "ayse@yilmazendustri.com", "name": "Ayşe Kara"}]', 1, 'demo'),
         (pg_temp.da_demo_id('event', 'cakisma-2'), v_user, v_cal_acct, v_cal_personal, 'demo', 'demo-event-cakisma-2',
          'Diş randevusu', 'Kadıköy', false, null, (v_today + 1 + time '14:30') at time zone c_tz,
          (v_today + 1 + time '15:15') at time zone c_tz, c_tz, 'confirmed', 'yunus@gmail.com', true, true, '[]', 0, 'demo');

  -- ─── Commitments ───────────────────────────────────────────────────────────────────────────
  insert into public.commitments (id, user_id, contact_id, counterparty_name, direction, text, due_at, status, dedupe_key, origin,
                                  source_type, source_id, source_provider, source_timestamp, confidence, evidence)
  values (pg_temp.da_demo_id('commitment', 'mehmet-teklif'), v_user, v_mehmet, 'Mehmet Yılmaz', 'user_owes',
          'Mehmet''e yarın teklif göndereceğim.', (v_today + 1 + time '12:00') at time zone c_tz, 'open', 'demo:mehmet-teklif',
          'post_meeting', 'post_meeting_note', 'demo-note-mehmet', null, now() - interval '1 day', 0.92,
          '[{"quote": "Yarın teklifi göndereceğim.", "field": "text"}]'),
         (pg_temp.da_demo_id('commitment', 'ahmet-sevkiyat'), v_user, v_ahmet, 'Ahmet Yılmaz', 'they_owe',
          'Ahmet sevkiyat planını Cuma gönderecek', (v_today + (5 - extract(isodow from v_today)::integer + 7) % 7 + time '17:00') at time zone c_tz,
          'open', 'demo:ahmet-sevkiyat', 'email_analysis', 'email_message', v_m_teklif::text, 'demo', now() - interval '2 hours', 0.88,
          '[{"quote": "Sevkiyat planını Cuma günü paylaşacağım.", "field": "text"}]');

  -- ─── Life intelligence ─────────────────────────────────────────────────────────────────────
  insert into public.life_events (id, user_id, type, title, status, event_at, due_at, payload, amount, currency, amount_evidence,
                                  dedupe_key, source_type, source_id, source_provider, source_timestamp, confidence, evidence)
  values (pg_temp.da_demo_id('life', 'kargo'), v_user, 'shipment', 'Trendyol siparişin bugün geliyor', 'open',
          (v_today + time '14:00') at time zone c_tz, null,
          jsonb_build_object('carrier', 'Yurtiçi Kargo', 'merchant', 'Trendyol', 'window_start', (v_today + time '14:00') at time zone c_tz,
                             'window_end', (v_today + time '18:00') at time zone c_tz),
          null, null, null, 'demo:kargo', 'email_message', pg_temp.da_demo_id('message', 'bulk-4')::text, 'demo', now() - interval '5 hours',
          0.9, '[{"quote": "Siparişiniz bugün 14:00-18:00 arasında teslim edilecek.", "field": "event_at"}]'),
         (pg_temp.da_demo_id('life', 'ucus'), v_user, 'flight', 'TK2412 İstanbul → Antalya', 'open',
          (v_today + 1 + time '09:15') at time zone c_tz, null,
          '{"flight_no": "TK2412", "from": "İstanbul (IST)", "to": "Antalya (AYT)"}', null, null, null, 'demo:ucus', 'email_message',
          pg_temp.da_demo_id('message', 'bulk-5')::text, 'demo', now() - interval '6 hours', 0.95,
          '[{"quote": "TK2412 İstanbul - Antalya, kalkış 09:15", "field": "event_at"}]'),
         (pg_temp.da_demo_id('life', 'elektrik'), v_user, 'payment', 'Elektrik faturası', 'open', null,
          (v_today + 2 + time '23:59') at time zone c_tz, '{"merchant": "CK Enerji"}', 1842.00, 'TRY',
          '[{"quote": "Elektrik faturanız 1.842,00 TL", "field": "amount"}]', 'demo:elektrik', 'email_message', v_m_fatura::text, 'demo',
          now() - interval '3 hours', 0.97, '[{"quote": "Son ödeme tarihi", "field": "due_at"}]'),
         (pg_temp.da_demo_id('life', 'netflix'), v_user, 'subscription', 'Netflix aboneliği yenileniyor', 'open', null,
          (v_today + 3 + time '09:00') at time zone c_tz, '{"merchant": "Netflix"}', 229.99, 'TRY',
          '[{"quote": "Aylık ücret 229,99 TL", "field": "amount"}]', 'demo:netflix', 'email_message',
          pg_temp.da_demo_id('message', 'bulk-7')::text, 'demo', now() - interval '20 hours', 0.9,
          '[{"quote": "Üyeliğiniz yenilenecek", "field": "due_at"}]'),
         (pg_temp.da_demo_id('life', 'rezervasyon'), v_user, 'reservation', 'Karaköy · 4 kişi', 'open',
          (v_today + 4 + time '20:30') at time zone c_tz, null, '{"venue": "Karaköy", "party_size": 4}', null, null, null,
          'demo:rezervasyon', 'email_message', pg_temp.da_demo_id('message', 'bulk-8')::text, 'demo', now() - interval '26 hours', 0.9,
          '[{"quote": "4 kişilik rezervasyonunuz onaylandı", "field": "event_at"}]'),
         (pg_temp.da_demo_id('life', 'guvenlik'), v_user, 'security', 'Google hesabında yeni giriş.', 'open',
          (v_today + time '07:12') at time zone c_tz, null, '{"dkim": "pass", "provider": "Google"}', null, null, null,
          'demo:guvenlik', 'email_message', v_m_security::text, 'demo', (v_today + time '07:12') at time zone c_tz, 0.99,
          '[{"quote": "Google hesabında yeni giriş", "field": "title"}]');

  -- ─── Insights (Today / Flow) ───────────────────────────────────────────────────────────────
  insert into public.insights (id, user_id, kind, urgency, status, title, body, why_important, decision_tier, reason_code, entity_type,
                               entity_id, flow_card_type, due_at, event_at, rank_score, dedupe_key, source_type, source_id,
                               source_provider, source_timestamp, confidence, evidence, actions)
  values (pg_temp.da_demo_id('insight', 'ahmet-teklif'), v_user, 'reply_needed', 'urgent', 'open', 'Ahmet''e revize teklif gönder',
          'Kuzey Lojistik revize teklifi bugün 17:00''a kadar bekliyor.', 'VIP müşteri ve bugün son tarih', 'explicit_rule',
          'vip_deadline_today', 'email_thread', v_t_teklif, 'email', (v_today + time '17:00') at time zone c_tz, null, 0.98,
          'demo:insight:ahmet-teklif', 'email_message', v_m_teklif::text, 'demo', (v_today + time '08:42') at time zone c_tz, 0.96,
          '[{"quote": "Revize teklifi bugün saat 17:00''a kadar iletebilir misiniz?", "field": "due_at"}]',
          '[{"kind": "reply", "label": "Yanıtla"}]'),
         (pg_temp.da_demo_id('insight', 'musteri-toplantisi'), v_user, 'meeting', 'today', 'open', 'Müşteri toplantısı · Mehmet Yılmaz',
          'Bugün 14:30''da Google Meet üzerinden.', 'Takvimindeki bir sonraki dış toplantı', 'deterministic_signal', 'upcoming_meeting',
          'calendar_event', v_e_customer, 'meeting', null, (v_today + time '14:30') at time zone c_tz, 0.9, 'demo:insight:toplanti',
          'calendar_event', v_e_customer::text, 'demo', now() - interval '1 day', 1, '[]', '[{"kind": "prep", "label": "Hazırlan"}]'),
         (pg_temp.da_demo_id('insight', 'mehmet-takip'), v_user, 'follow_up', 'normal', 'open', 'Mehmet''ten 3 gündür yanıt yok',
          'Teklifi 3 gün önce gönderdin.', 'Yanıt bekleniyor', 'deterministic_signal', 'awaiting_their_reply', 'email_thread', v_t_mehmet,
          'follow_up', null, null, 0.7, 'demo:insight:mehmet-takip', 'email_message', v_m_mehmet::text, 'demo',
          (v_today - 3 + time '11:05') at time zone c_tz, 0.9, '[]', '[{"kind": "follow_up", "label": "Hatırlat"}]'),
         (pg_temp.da_demo_id('insight', 'elektrik'), v_user, 'deadline', 'today', 'open', 'Elektrik faturası 1.842 TL',
          'Son ödeme ' || to_char(v_today + 2, 'DD.MM') || '.', 'Yaklaşan ödeme', 'deterministic_signal', 'payment_due', 'life_event',
          pg_temp.da_demo_id('life', 'elektrik'), 'payment', (v_today + 2 + time '23:59') at time zone c_tz, null, 0.8,
          'demo:insight:elektrik', 'email_message', v_m_fatura::text, 'demo', now() - interval '3 hours', 0.97,
          '[{"quote": "Elektrik faturanız 1.842,00 TL", "field": "title"}]', '[]'),
         (pg_temp.da_demo_id('insight', 'kargo'), v_user, 'life_event', 'today', 'open', 'Trendyol siparişin bugün 14:00–18:00 arası geliyor',
          'Yurtiçi Kargo ile.', 'Bugün teslimat', 'deterministic_signal', 'shipment_today', 'life_event', pg_temp.da_demo_id('life', 'kargo'),
          'shipment', null, (v_today + time '14:00') at time zone c_tz, 0.75, 'demo:insight:kargo', 'email_message',
          pg_temp.da_demo_id('message', 'bulk-4')::text, 'demo', now() - interval '5 hours', 0.9, '[]', '[]'),
         (pg_temp.da_demo_id('insight', 'guvenlik'), v_user, 'security', 'urgent', 'open', 'Google hesabında yeni giriş.',
          'Bugün 07:12. Sen değilsen hesabını güvenceye al.', 'Güvenlik bildirimi (DKIM doğrulandı)', 'deterministic_signal',
          'security_signin', 'life_event', pg_temp.da_demo_id('life', 'guvenlik'), 'security', null,
          (v_today + time '07:12') at time zone c_tz, 0.95, 'demo:insight:guvenlik', 'email_message', v_m_security::text, 'demo',
          (v_today + time '07:12') at time zone c_tz, 0.99, '[]', '[]');

  -- ─── Briefings ─────────────────────────────────────────────────────────────────────────────
  insert into public.briefings (id, user_id, kind, local_date, time_zone, scheduled_for, status, generated_at, headline, hero_line,
                                counts, idempotency_key, origin)
  values (v_briefing, v_user, 'morning', v_today, c_tz, (v_today + time '08:00') at time zone c_tz, 'ready',
          (v_today + time '08:00') at time zone c_tz, 'Günaydın Yunus', 'Bugün bilmen gereken 5 şey var.',
          '{"priorities": 5, "meetings": 2, "deadlines": 1}', 'briefing:' || v_user || ':morning:' || v_today, 'scheduled'),
         (v_weekly, v_user, 'weekly', v_last_sunday, c_tz, (v_last_sunday + time '18:00') at time zone c_tz, 'delivered',
          (v_last_sunday + time '18:00') at time zone c_tz, 'Haftalık özet', 'Bu hafta 684 maili analiz ettim.',
          '{"priorities": 5}', 'briefing:' || v_user || ':weekly:' || v_last_sunday, 'scheduled')
  on conflict (user_id, kind, local_date) do nothing;
  update public.briefings
    set weekly_stats = '{"mails_analyzed": 684, "important_count": 32, "meetings": 21, "followups": 8, "deadlines": 4, "time_saved_min": 168}',
        delivered_at = (v_last_sunday + time '18:01') at time zone c_tz
  where id = v_weekly;
  insert into public.briefing_items (user_id, briefing_id, section, position, insight_id, entity_type, entity_id, title, badge,
                                     source_type, source_id, source_provider, source_timestamp, confidence)
  select v_user, v_briefing, 'priorities', x.pos, i.id, i.entity_type, i.entity_id, i.title, x.badge, i.source_type, i.source_id,
         i.source_provider, i.source_timestamp, i.confidence
  from (values (1, 'ahmet-teklif', 'deadline'), (2, 'musteri-toplantisi', 'meeting'), (3, 'guvenlik', 'security'),
               (4, 'elektrik', 'payment'), (5, 'kargo', 'shipment')) as x (pos, slug, badge)
  join public.insights i on i.id = pg_temp.da_demo_id('insight', x.slug)
  where exists (select 1 from public.briefings b where b.id = v_briefing);

  -- ─── Reply draft and approvals ─────────────────────────────────────────────────────────────
  insert into public.reply_drafts (id, user_id, thread_id, message_id, connected_account_id, kind, tone, to_emails, subject, body,
                                   status, generated_by, source_type, source_id, source_provider, source_timestamp, confidence)
  values (v_draft, v_user, v_t_teklif, v_m_teklif, v_mail, 'reply', 'professional', '{ahmet@kuzeylojistik.com}', 'Re: Revize teklif',
          'Merhaba Ahmet Bey,' || chr(10) || chr(10) || 'Revize teklifimizi bugün 17:00''dan önce ileteceğim.' || chr(10) || chr(10)
          || 'Saygılarımla,' || chr(10) || 'Yunus',
          'submitted', 'ai', 'email_message', v_m_teklif::text, 'demo', (v_today + time '08:42') at time zone c_tz, 0.9);
  insert into public.approval_actions (id, user_id, action_type, payload, payload_hash, what, why, change_summary, destination_account_id,
                                       destination_label, idempotency_key, origin, requires_scope, exact_change, side_effects, executor,
                                       approval_expires_at, source_type, source_id, source_provider, source_timestamp, confidence)
  values (v_ap_mail, v_user, 'email_send', jsonb_build_object('reply_draft_id', v_draft, 'thread_id', v_t_teklif),
          sha256(convert_to('demo:approval:reply-ahmet', 'UTF8')), 'Ahmet Yılmaz''a yanıt gönder', 'Revize teklif bugün 17:00''a kadar bekleniyor',
          'Re: Revize teklif · 1 alıcı', v_mail, 'Gmail · yunus@gmail.com', 'approval:' || v_ap_mail || ':v1', 'reply_draft', 'mail_send',
          '{"to": ["ahmet@kuzeylojistik.com"], "subject": "Re: Revize teklif"}', '["Mail gönderilir"]', 'server',
          (v_today + time '17:00') at time zone c_tz, 'email_message', v_m_teklif::text, 'demo', (v_today + time '08:42') at time zone c_tz, 0.9),
         (v_ap_cal, v_user, 'calendar_create',
          jsonb_build_object('title', 'Teklif hazırlama', 'calendar_id', v_cal_work,
                             'start_at', (v_today + 1 + time '14:00') at time zone c_tz, 'end_at', (v_today + 1 + time '16:30') at time zone c_tz),
          sha256(convert_to('demo:approval:teklif-hazirlama', 'UTF8')), 'Takvime "Teklif hazırlama" ekle',
          'Mehmet''e yarın teklif göndereceğini söyledin', 'Yarın 14:00–16:30 · İş', v_cal_acct, 'Google Takvim · İş',
          'approval:' || v_ap_cal || ':v1', 'commitment_detection', 'calendar_write',
          jsonb_build_object('calendar', 'İş', 'start', to_char(v_today + 1, 'DD.MM') || ' 14:00', 'end', '16:30'), '["Takvim etkinliği oluşturulur"]',
          'server', now() + interval '72 hours', 'post_meeting_note', 'demo-note-mehmet', null, now() - interval '1 day', 0.92);
  update public.reply_drafts set approval_action_id = v_ap_mail where id = v_draft;

  -- ─── Rules, learned preference, memory ─────────────────────────────────────────────────────
  insert into public.priority_rules (id, user_id, condition_type, condition_value, outcome, applies_to, sort_order)
  values (pg_temp.da_demo_id('rule', 'yilmazendustri'), v_user, 'domain', '{"domain": "yilmazendustri.com"}', 'always_important', 'mail', 1),
         (pg_temp.da_demo_id('rule', 'fatura'), v_user, 'keyword', '{"keywords": ["fatura"]}', 'high', 'mail', 2),
         (pg_temp.da_demo_id('rule', 'promosyon'), v_user, 'category', '{"category": "promotions"}', 'low', 'mail', 3);
  insert into public.learned_preferences (id, user_id, group_key, statement, target_type, target_ref, effect, priority_override,
                                          evidence_count, evidence_summary, origin, source_type, source_id, source_provider,
                                          source_timestamp, confidence)
  values (pg_temp.da_demo_id('learned', 'mehmet'), v_user, 'people', 'Mehmet yüksek öncelikli.', 'contact', v_mehmet::text,
          '{"priority": "high"}', 'high', 6, 'Son 30 günde 6 kez hızlı yanıt verdin', 'learned', 'email_thread', v_t_mehmet::text,
          'demo', now() - interval '3 days', 0.85);
  insert into public.memory_chunks (id, user_id, source_type, source_id, source_provider, source_timestamp, confidence, chunk_kind, content,
                                    content_hash, occurred_at, contact_ids)
  values (pg_temp.da_demo_id('memory', 'revize-teklif'), v_user, 'email_thread', v_t_teklif::text, 'demo', now() - interval '1 hour', 0.9,
          'thread_summary', 'Kuzey Lojistik (Ahmet Yılmaz) revize teklifi bugün 17:00''a kadar bekliyor; fiyat ve teslim tarihi soruluyor.',
          sha256(convert_to('demo:memory:revize-teklif', 'UTF8')), now() - interval '1 hour', array[v_ahmet]),
         (pg_temp.da_demo_id('memory', 're-teklif'), v_user, 'email_thread', v_t_mehmet::text, 'demo', now() - interval '3 days', 0.9,
          'thread_summary', 'Yılmaz Endüstri (Mehmet Yılmaz) teklifi 3 gün önce aldı, yanıt bekleniyor.',
          sha256(convert_to('demo:memory:re-teklif', 'UTF8')), now() - interval '3 days', array[v_mehmet]),
         (pg_temp.da_demo_id('memory', 'elektrik'), v_user, 'life_event', pg_temp.da_demo_id('life', 'elektrik')::text, null,
          now() - interval '3 hours', 0.97, 'life_event', 'Elektrik faturası 1.842 TL, CK Enerji, son ödeme ' || to_char(v_today + 2, 'DD.MM.YYYY') || '.',
          sha256(convert_to('demo:memory:elektrik', 'UTF8')), now() - interval '3 hours', '{}');

  perform private.audit_log_append('system', null, null, 'demo.seeded', 'user', v_user::text, v_user, null, 'success',
                                   jsonb_build_object('local_date', v_today, 'users', 2), null);
end
$$;

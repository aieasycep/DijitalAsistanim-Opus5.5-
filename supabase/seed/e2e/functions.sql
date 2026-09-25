-- E2E scenario seeds (TEST_PLAN §12.2–§12.3, §9; IMPLEMENTATION_PLAN T-12.02).
--
-- Schema `e2e` (never created by migrations or `supabase db reset`):
--   e2e.seed_user(p_user uuid, p_scenario text, p_anchor timestamptz) → {"scenario", "ids": {...}}
--   e2e.reset_user(p_user uuid)                                       → {"<table>": deleted rows}
-- Loaded only by the Maestro harness (scripts/e2e/harness-server.ts), scripts/e2e/start-stack.sh and
-- the integration suite, after they checked that the database is a local / CI stack. Like the demo
-- dataset's `da.demo_mode` flag, the session must carry `app.env` ∈ {local, ci, staging_e2e}; without
-- it this file and every function raise before writing anything.
--
-- Users are created by the harness (GoTrue Admin API); the functions only fill them. The demo canon
-- users (`profiles.is_demo`, reset by `pnpm db:seed:demo`) get a scenario layer on top of the canon;
-- every other user is reset first, so seeding twice gives the same rows. Deterministic ids:
-- md5('da-e2e:' || scenario || ':' || user || ':' || slug)::uuid, returned in `ids` for deep links and
-- probes. Timestamps are relative to the anchor (DA_FIXED_NOW; B1 for `dst_berlin`). Names are the
-- fictional demo canon (TEST_PLAN §12.1).

do $$
begin
  if coalesce(current_setting('app.env', true), '') not in ('local', 'ci', 'staging_e2e') then
    raise exception 'E2E_ENV_REQUIRED' using errcode = '42501',
      hint = 'The E2E seed runs only on a local / CI stack: the loader sets app.env to local or ci.';
  end if;
end
$$;

create schema if not exists e2e;
revoke all on schema e2e from public;

create or replace function e2e.guard() returns void
  language plpgsql
  as $$
begin
  if coalesce(current_setting('app.env', true), '') not in ('local', 'ci', 'staging_e2e') then
    raise exception 'E2E_ENV_REQUIRED' using errcode = '42501',
      hint = 'set app.env = local | ci | staging_e2e (local / CI stacks only)';
  end if;
end
$$;

create or replace function e2e.id(p_scenario text, p_user uuid, p_slug text) returns uuid
  language sql immutable
  as $$ select md5('da-e2e:' || p_scenario || ':' || p_user::text || ':' || p_slug)::uuid $$;

create or replace function e2e.local_at(p_day date, p_time time, p_tz text) returns timestamptz
  language sql stable
  as $$ select (p_day + p_time) at time zone p_tz $$;

-- The scenarios the Maestro flows ask for (apps/mobile/.maestro/flows/**).
create or replace function e2e.scenarios() returns text[]
  language sql immutable
  as $$ select array['none', 'empty_accounts', 'approvals_mixed', 'canon_plan', 'mail_only', 'errors',
                     'android_ni', 'dst_berlin', 'referral_pending', 'deletion', 'announcement_active'] $$;

-- Tables whose user rows survive a reset: the account itself, settings, append-only history and
-- operator / billing records (ON DELETE CASCADE removes approval_events with their approvals).
create or replace function e2e.kept_tables() returns text[]
  language sql immutable
  as $$ select array['profiles', 'user_preferences', 'notification_preferences', 'referral_codes',
                     'admin_users', 'approval_events', 'audit_logs', 'ai_requests', 'ai_usage_daily',
                     'billing_events', 'job_attempts', 'support_access_grants', 'support_notes',
                     'support_tickets', 'webhook_events'] $$;

-- ─── Reset ─────────────────────────────────────────────────────────────────────────────────────
create or replace function e2e.reset_user(p_user uuid) returns jsonb
  language plpgsql
  as $$
declare
  v_pending text[];
  v_tables text[];
  v_table text;
  v_sql text;
  v_rows bigint;
  v_pass integer := 0;
  v_deleted jsonb := '{}'::jsonb;
begin
  perform e2e.guard();
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0002', detail = 'e2e.reset_user: unknown user';
  end if;
  select coalesce(array_agg(c.table_name::text order by c.table_name), '{}') into v_pending
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public' and c.column_name = 'user_id' and t.table_type = 'BASE TABLE'
    and c.table_name::text <> all (e2e.kept_tables());
  -- Children before parents: a table blocked by a foreign key is retried in the next pass.
  while cardinality(v_pending) > 0 and v_pass < 8 loop
    v_pass := v_pass + 1;
    v_tables := v_pending;
    v_pending := '{}';
    foreach v_table in array v_tables loop
      begin
        v_sql := format('delete from public.%I where user_id = $1', v_table);
        execute v_sql using p_user;
        get diagnostics v_rows = row_count;
        if v_rows > 0 then
          v_deleted := v_deleted || jsonb_build_object(v_table, v_rows);
        end if;
      exception when foreign_key_violation then
        v_pending := v_pending || v_table;
      end;
    end loop;
  end loop;
  if cardinality(v_pending) > 0 then
    raise exception 'STATE_CONFLICT' using errcode = '55000',
      detail = 'e2e.reset_user could not clear: ' || array_to_string(v_pending, ', ');
  end if;
  delete from public.referrals r where r.referrer_id = p_user or r.referee_id = p_user;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    v_deleted := v_deleted || jsonb_build_object('referrals', v_rows);
  end if;
  return v_deleted;
end
$$;

-- ─── Building blocks ───────────────────────────────────────────────────────────────────────────
create or replace function e2e.onboarded(p_user uuid, p_name text, p_locale text, p_tz text) returns void
  language plpgsql
  as $$
begin
  update public.profiles
    set display_name = p_name, locale = p_locale, onboarding_step = 'done',
        onboarding_completed_at = coalesce(onboarding_completed_at, now()),
        terms_accepted_at = coalesce(terms_accepted_at, now()), terms_version = coalesce(terms_version, '2026-09'),
        last_active_at = now()
  where user_id = p_user;
  update public.user_preferences set timezone = p_tz where user_id = p_user;
end
$$;

create or replace function e2e.make_pro(p_user uuid, p_scenario text) returns void
  language plpgsql
  as $$
begin
  perform private.grant_entitlement(p_user, 'admin', 30::smallint, 'e2e scenario seed', null,
                                    'e2e:pro:' || p_scenario || ':' || p_user::text);
end
$$;

create or replace function e2e.add_account(
  p_user uuid, p_scenario text, p_slug text, p_flavor text, p_caps public.capability[],
  p_status public.account_status, p_email text, p_label text, p_last_success timestamptz
) returns uuid
  language plpgsql
  as $$
declare
  v_id uuid := e2e.id(p_scenario, p_user, 'account:' || p_slug);
begin
  insert into public.connected_accounts (id, user_id, provider, provider_account_id, account_email, display_label, status,
                                         capabilities_granted, connected_at, last_sync_at, last_successful_sync_at, demo_flavor)
  values (v_id, p_user, 'demo', 'e2e-' || p_slug || '-' || left(p_user::text, 8), p_email, p_label, p_status, p_caps,
          p_last_success - interval '20 days', p_last_success, p_last_success, p_flavor);
  return v_id;
end
$$;

create or replace function e2e.add_calendar(p_user uuid, p_scenario text, p_account uuid, p_tz text) returns uuid
  language plpgsql
  as $$
declare
  v_id uuid := e2e.id(p_scenario, p_user, 'calendar:is');
begin
  insert into public.calendars (id, user_id, connected_account_id, provider, provider_calendar_id, name, color, time_zone,
                                access_role, is_primary, selected, can_write)
  values (v_id, p_user, p_account, 'demo', 'e2e-is', 'İş', '#2E5AAC', p_tz, 'owner', true, true, true);
  return v_id;
end
$$;

-- Ahmet's urgent "Revize teklif" (needed by 17:00 on the anchor day) and Mehmet's unanswered offer.
create or replace function e2e.add_mail(
  p_user uuid, p_scenario text, p_account uuid, p_day date, p_tz text, p_self text
) returns jsonb
  language plpgsql
  as $$
declare
  v_ahmet uuid := e2e.id(p_scenario, p_user, 'contact:ahmet');
  v_mehmet uuid := e2e.id(p_scenario, p_user, 'contact:mehmet');
  v_selin uuid := e2e.id(p_scenario, p_user, 'contact:selin');
  v_t_ahmet uuid := e2e.id(p_scenario, p_user, 'thread:revize-teklif');
  v_t_mehmet uuid := e2e.id(p_scenario, p_user, 'thread:re-teklif');
  v_m_ahmet uuid := e2e.id(p_scenario, p_user, 'message:revize-teklif');
  v_m_mehmet uuid := e2e.id(p_scenario, p_user, 'message:re-teklif');
  v_received timestamptz := e2e.local_at(p_day, time '08:42', p_tz);
  v_deadline timestamptz := e2e.local_at(p_day, time '17:00', p_tz);
  v_sent timestamptz := e2e.local_at(p_day - 3, time '11:05', p_tz);
begin
  insert into public.contacts (id, user_id, display_name, primary_email, emails, organization, avatar_seed, origin, first_seen_at,
                               last_contact_at, last_inbound_at, message_count_30d, meeting_count_30d)
  values (v_ahmet, p_user, 'Ahmet Yılmaz', 'ahmet@kuzeylojistik.com', '{ahmet@kuzeylojistik.com}', 'Kuzey Lojistik', 11, 'mail',
          v_received - interval '60 days', v_received, v_received, 9, 2),
         (v_mehmet, p_user, 'Mehmet Yılmaz', 'mehmet@yilmazendustri.com', '{mehmet@yilmazendustri.com}', 'Yılmaz Endüstri', 23,
          'mail', v_received - interval '90 days', v_sent, v_sent - interval '3 days', 12, 3),
         (v_selin, p_user, 'Selin Kaya', 'selin.kaya@gmail.com', '{selin.kaya@gmail.com}', null, 37, 'mail',
          v_received - interval '40 days', v_received - interval '1 day', v_received - interval '1 day', 14, 0);
  insert into public.email_threads (id, user_id, connected_account_id, provider, provider_thread_id, subject, participants,
                                    message_count, last_message_at, last_inbound_at, last_outbound_at, has_unread, category,
                                    category_tier, category_reason, category_confidence, urgency, reply_state, ai_summary,
                                    key_points, deadline_at, deadline_evidence, follow_up_state, awaiting_since, topic_label)
  values (v_t_ahmet, p_user, p_account, 'demo', 'e2e-thread-revize-teklif', 'Revize teklif',
          jsonb_build_array(jsonb_build_object('email', 'ahmet@kuzeylojistik.com', 'name', 'Ahmet Yılmaz', 'contact_id', v_ahmet)),
          1, v_received, v_received, null, true, 'awaiting_my_reply', 'explicit_rule', 'VIP müşteri ve bugün 17:00 son tarih', 0.96,
          'urgent', 'awaiting_my_reply',
          'Ahmet revize teklifi bugün 17:00''a kadar bekliyor; fiyat ve teslim tarihini netleştirmen gerekiyor.',
          '["Revize teklif bugün 17:00''a kadar isteniyor"]', v_deadline,
          '[{"quote": "Revize teklifi bugün saat 17:00''a kadar iletebilir misiniz?", "field": "deadline_at"}]',
          'none', null, 'Revize teklif'),
         (v_t_mehmet, p_user, p_account, 'demo', 'e2e-thread-re-teklif', 'Re: Teklif',
          jsonb_build_array(jsonb_build_object('email', 'mehmet@yilmazendustri.com', 'name', 'Mehmet Yılmaz', 'contact_id', v_mehmet)),
          1, v_sent, null, v_sent, false, 'awaiting_their_reply', 'deterministic_signal', 'Son mesajı sen gönderdin; 3 gündür yanıt yok',
          0.9, 'normal', 'awaiting_their_reply', 'Mehmet''e teklifi 3 gün önce gönderdin, henüz yanıt gelmedi.',
          '["Teklif 3 gün önce gönderildi"]', null, null, 'waiting', v_sent, 'Teklif');
  insert into public.email_messages (id, user_id, connected_account_id, thread_id, provider, provider_message_id, direction, from_email,
                                     from_name, to_emails, subject, snippet, sent_at, received_at, content_hash, dkim_pass,
                                     ai_status, classification, classification_tier, classification_reason, classification_confidence,
                                     life_signal)
  values (v_m_ahmet, p_user, p_account, v_t_ahmet, 'demo', 'e2e-msg-revize-teklif', 'inbound', 'ahmet@kuzeylojistik.com',
          'Ahmet Yılmaz', array[p_self], 'Revize teklif',
          'Merhaba Yunus Bey, revize teklifi bugün saat 17:00''a kadar iletebilir misiniz?', v_received, v_received,
          sha256(convert_to('e2e:' || p_scenario || ':revize-teklif', 'UTF8')), true, 'classified', 'awaiting_my_reply',
          'explicit_rule', 'VIP müşteri', 0.96, 'none'),
         (v_m_mehmet, p_user, p_account, v_t_mehmet, 'demo', 'e2e-msg-re-teklif', 'outbound', p_self, 'Yunus',
          '{mehmet@yilmazendustri.com}', 'Re: Teklif', 'Mehmet Bey, teklifimiz ektedir. Sorularınız için buradayım.', v_sent, v_sent,
          sha256(convert_to('e2e:' || p_scenario || ':re-teklif', 'UTF8')), null, 't0_final', 'awaiting_their_reply',
          'deterministic_signal', 'Giden mesaj', 0.9, 'none');
  insert into public.insights (id, user_id, kind, urgency, status, title, body, why_important, decision_tier, reason_code, entity_type,
                               entity_id, flow_card_type, due_at, event_at, rank_score, dedupe_key, source_type, source_id,
                               source_provider, source_timestamp, confidence, evidence, actions)
  values (e2e.id(p_scenario, p_user, 'insight:ahmet-teklif'), p_user, 'reply_needed', 'urgent', 'open', 'Ahmet''e revize teklif gönder',
          'Kuzey Lojistik revize teklifi bugün 17:00''a kadar bekliyor.', 'VIP müşteri ve bugün son tarih', 'explicit_rule',
          'vip_deadline_today', 'email_thread', v_t_ahmet, 'email', v_deadline, null, 0.98,
          'e2e:' || p_scenario || ':insight:ahmet-teklif', 'email_message', v_m_ahmet::text, 'demo', v_received, 0.96,
          '[{"quote": "Revize teklifi bugün saat 17:00''a kadar iletebilir misiniz?", "field": "due_at"}]',
          '[{"kind": "reply", "label": "Yanıtla"}]');
  return jsonb_build_object('messageAhmet', v_m_ahmet, 'messageMehmet', v_m_mehmet, 'threadAhmet', v_t_ahmet,
                            'contactAhmet', v_ahmet, 'contactMehmet', v_mehmet, 'contactSelin', v_selin);
end
$$;

create or replace function e2e.add_meeting(
  p_user uuid, p_scenario text, p_account uuid, p_calendar uuid, p_day date, p_tz text, p_self text
) returns uuid
  language plpgsql
  as $$
declare
  v_id uuid := e2e.id(p_scenario, p_user, 'event:musteri-toplantisi');
begin
  insert into public.calendar_events (id, user_id, connected_account_id, calendar_id, provider, provider_event_id, title, location,
                                      is_online, conference_url, start_at, end_at, time_zone, status, organizer_email, organizer_self,
                                      can_modify, attendees, attendee_count, origin)
  values (v_id, p_user, p_account, p_calendar, 'demo', 'e2e-event-musteri', 'Müşteri toplantısı · Mehmet Yılmaz', null, true,
          'https://meet.google.com/abc-defg-hij', e2e.local_at(p_day, time '14:30', p_tz), e2e.local_at(p_day, time '15:30', p_tz),
          p_tz, 'confirmed', p_self, true, true,
          jsonb_build_array(jsonb_build_object('email', 'mehmet@yilmazendustri.com', 'name', 'Mehmet Yılmaz', 'response', 'accepted')),
          1, 'demo');
  return v_id;
end
$$;

-- Gmail + Google Calendar (demo adapter, Google flavour) with the canon mail and today's meeting.
create or replace function e2e.standard_user(
  p_user uuid, p_scenario text, p_day date, p_now timestamptz, p_tz text, p_self text
) returns jsonb
  language plpgsql
  as $$
declare
  v_mail uuid;
  v_cal_acct uuid;
  v_calendar uuid;
  v_ids jsonb;
begin
  v_mail := e2e.add_account(p_user, p_scenario, 'gmail', 'google', '{mail_read}', 'healthy', p_self, 'Gmail · ' || p_self,
                            p_now - interval '4 minutes');
  v_cal_acct := e2e.add_account(p_user, p_scenario, 'google-calendar', 'google', '{calendar_read}', 'healthy', p_self,
                                'Google Takvim', p_now - interval '4 minutes');
  v_calendar := e2e.add_calendar(p_user, p_scenario, v_cal_acct, p_tz);
  v_ids := e2e.add_mail(p_user, p_scenario, v_mail, p_day, p_tz, p_self);
  return v_ids || jsonb_build_object('accountGmail', v_mail, 'accountCalendar', v_cal_acct,
                                     'meetingEvent', e2e.add_meeting(p_user, p_scenario, v_cal_acct, v_calendar, p_day, p_tz, p_self));
end
$$;

-- ─── Canon layers (the demo users, freshly re-seeded by `pnpm db:seed:demo`) ───────────────────
create or replace function e2e.layer_canon(p_user uuid, p_scenario text, p_now timestamptz) returns jsonb
  language plpgsql
  as $$
declare
  c_tz constant text := 'Europe/Istanbul';
  v_day date := (p_now at time zone 'Europe/Istanbul')::date;
  v_ap_mail uuid := md5('da-demo:approval:reply-ahmet')::uuid;
  v_m_teklif uuid := md5('da-demo:message:revize-teklif')::uuid;
  v_mehmet uuid := md5('da-demo:contact:mehmet')::uuid;
  v_cal_acct uuid := md5('da-demo:account:google-calendar')::uuid;
  v_cal_work uuid := md5('da-demo:calendar:is')::uuid;
  v_ids jsonb := '{}'::jsonb;
  v_id uuid;
begin
  if p_scenario = 'approvals_mixed' then
    -- Pending calendar_create (canon), reminder_create and commitment_create; the canon reply fails
    -- retryably; one expired (E2E-M-08: the badge reads 3).
    -- Seeded state, not a user transition: the guard's transaction flag (as transition_approval sets
    -- it) is on for this one statement only.
    perform set_config('da.approval_tx', 'on', true);
    update public.approval_actions
      set status = 'failed', failed_at = p_now - interval '10 minutes', attempt_count = 1,
          last_error_code = 'PROVIDER_UNAVAILABLE', last_error_message = 'Sağlayıcı geçici olarak yanıt vermedi.'
    where id = v_ap_mail and user_id = p_user;
    perform set_config('da.approval_tx', '', true);
    v_id := e2e.id(p_scenario, p_user, 'approval:reminder');
    insert into public.approval_actions (id, user_id, action_type, payload, payload_hash, what, why, change_summary, idempotency_key,
                                         origin, exact_change, side_effects, executor, approval_expires_at, source_type, source_id,
                                         source_provider, source_timestamp, confidence)
    values (v_id, p_user, 'reminder_create',
            jsonb_build_object('action_type', 'reminder_create', 'destination', jsonb_build_object('kind', 'in_app', 'channel', 'push'),
                               'title', 'Ahmet''e revize teklifi gönder', 'preset', 'before_1h',
                               'fire_at', e2e.local_at(v_day, time '16:00', c_tz), 'anchor_at', e2e.local_at(v_day, time '17:00', c_tz),
                               'time_zone', c_tz, 'subject', jsonb_build_object('type', 'email_message', 'id', v_m_teklif)),
            sha256(convert_to('e2e:approval:reminder:' || p_user::text, 'UTF8')), 'Hatırlatıcı kur: Ahmet''e revize teklif',
            'Revize teklif bugün 17:00''a kadar bekleniyor', 'Bugün 16:00 · Uygulama bildirimi', 'approval:' || v_id || ':v1',
            'reminder_sheet', jsonb_build_object('fire_at', '16:00'), '["Hatırlatıcı kurulur"]', 'server', p_now + interval '24 hours',
            'email_message', v_m_teklif::text, 'demo', p_now - interval '1 hour', 0.9);
    v_ids := v_ids || jsonb_build_object('approvalReminder', v_id);
    v_id := e2e.id(p_scenario, p_user, 'approval:commitment');
    insert into public.approval_actions (id, user_id, action_type, payload, payload_hash, what, why, change_summary, idempotency_key,
                                         origin, exact_change, side_effects, executor, approval_expires_at, source_type, source_id,
                                         source_provider, source_timestamp, confidence)
    values (v_id, p_user, 'commitment_create',
            jsonb_build_object('action_type', 'commitment_create', 'text', 'Mehmet''e ekim teslimat planını paylaşacağım.',
                               'direction', 'user_owes', 'counterparty', jsonb_build_object('contact_id', v_mehmet, 'name', 'Mehmet Yılmaz'),
                               'due_at', e2e.local_at(v_day + 2, time '12:00', c_tz), 'due_precision', 'datetime',
                               'source', jsonb_build_object('source_type', 'email_message', 'source_id', v_m_teklif,
                                                            'source_provider', 'demo', 'source_timestamp', p_now - interval '2 hours'),
                               'evidence', jsonb_build_object('quote', 'ekim teslimat planını paylaşacağım',
                                                              'source', jsonb_build_object('source_type', 'email_message',
                                                                                           'source_id', v_m_teklif,
                                                                                           'source_provider', 'demo',
                                                                                           'source_timestamp', p_now - interval '2 hours')),
                               'confidence', 0.88),
            sha256(convert_to('e2e:approval:commitment:' || p_user::text, 'UTF8')), 'Söz ekle: Mehmet''e teslimat planı',
            'Mailde teslimat planını paylaşacağını söyledin', 'Perşembe 12:00 · Mehmet Yılmaz', 'approval:' || v_id || ':v1',
            'commitment_detection', jsonb_build_object('due', '12:00'), '["Söz takibine eklenir"]', 'server', p_now + interval '72 hours',
            'email_message', v_m_teklif::text, 'demo', p_now - interval '2 hours', 0.88);
    v_ids := v_ids || jsonb_build_object('approvalCommitment', v_id);
    v_id := e2e.id(p_scenario, p_user, 'approval:expired');
    insert into public.approval_actions (id, user_id, action_type, status, payload, payload_hash, what, why, change_summary,
                                         idempotency_key, origin, exact_change, side_effects, executor, approval_expires_at,
                                         expires_at, source_type, source_id, source_provider, source_timestamp, confidence)
    values (v_id, p_user, 'task_create', 'expired',
            jsonb_build_object('action_type', 'task_create', 'target', jsonb_build_object('kind', 'in_app'),
                               'title', 'Sözleşme 4. madde yorumunu Selin''e ilet'),
            sha256(convert_to('e2e:approval:expired:' || p_user::text, 'UTF8')), 'Görev ekle: 4. madde yorumu',
            'Selin yorumunu bekliyordu', 'Uygulama içi görev', 'approval:' || v_id || ':v1', 'insight',
            jsonb_build_object('title', '4. madde yorumu'), '["Görev oluşturulur"]', 'server', p_now - interval '1 day',
            p_now - interval '1 day', 'user_input', 'e2e-expired', null, p_now - interval '4 days', 0.8);
    v_ids := v_ids || jsonb_build_object('approvalExpired', v_id);
  elsif p_scenario = 'canon_plan' then
    -- TEST_PLAN §12.1 calendar: today 09:00 Haftalık ekip (60), 11:00 Ürün gözden geçirme (30), 14:30 Mehmet
    -- (canon); tomorrow 14:00 Müşteri toplantısı (60) + 14:30 Doktor randevusu (30, from a mail) → conflict;
    -- the day after tomorrow stays free for the proposal.
    delete from public.calendar_events
    where user_id = p_user
      and id in (md5('da-demo:event:haftalik-ekip-bugun')::uuid, md5('da-demo:event:cakisma-1')::uuid,
                 md5('da-demo:event:cakisma-2')::uuid);
    insert into public.calendar_events (id, user_id, connected_account_id, calendar_id, provider, provider_event_id, title, location,
                                        is_online, conference_url, start_at, end_at, time_zone, status, organizer_email,
                                        organizer_self, can_modify, attendees, attendee_count, origin)
    values (e2e.id(p_scenario, p_user, 'event:haftalik-ekip'), p_user, v_cal_acct, v_cal_work, 'demo', 'e2e-plan-haftalik-ekip',
            'Haftalık ekip', 'Toplantı odası 2', false, null, e2e.local_at(v_day, time '09:00', c_tz),
            e2e.local_at(v_day, time '10:00', c_tz), c_tz, 'confirmed', 'yunus@gmail.com', true, true,
            '[{"email": "ekip@gmail.com", "name": "Ekip"}]', 1, 'demo'),
           (e2e.id(p_scenario, p_user, 'event:urun-gozden-gecirme'), p_user, v_cal_acct, v_cal_work, 'demo',
            'e2e-plan-urun-gozden-gecirme', 'Ürün gözden geçirme', null, true, 'https://meet.google.com/pqr-stuv-wxy',
            e2e.local_at(v_day, time '11:00', c_tz), e2e.local_at(v_day, time '11:30', c_tz), c_tz, 'confirmed', 'yunus@gmail.com',
            true, true, '[{"email": "ekip@gmail.com", "name": "Ekip"}]', 1, 'demo'),
           (e2e.id(p_scenario, p_user, 'event:musteri-yarin'), p_user, v_cal_acct, v_cal_work, 'demo', 'e2e-plan-musteri-yarin',
            'Müşteri toplantısı', null, true, 'https://meet.google.com/xyz-abcd-efg', e2e.local_at(v_day + 1, time '14:00', c_tz),
            e2e.local_at(v_day + 1, time '15:00', c_tz), c_tz, 'confirmed', 'yunus@gmail.com', true, true,
            '[{"email": "ayse@yilmazendustri.com", "name": "Ayşe Kara"}]', 1, 'demo'),
           (e2e.id(p_scenario, p_user, 'event:doktor'), p_user, v_cal_acct, md5('da-demo:calendar:kisisel')::uuid, 'demo',
            'e2e-plan-doktor', 'Doktor randevusu', 'Kadıköy', false, null, e2e.local_at(v_day + 1, time '14:30', c_tz),
            e2e.local_at(v_day + 1, time '15:00', c_tz), c_tz, 'confirmed', 'yunus@gmail.com', true, true, '[]', 0, 'demo');
    v_ids := jsonb_build_object('eventConflictA', e2e.id(p_scenario, p_user, 'event:musteri-yarin'),
                                'eventConflictB', e2e.id(p_scenario, p_user, 'event:doktor'));
  elsif p_scenario = 'announcement_active' then
    -- One active announcement for everyone; an expired and a not-yet-started one never render.
    insert into public.announcements (id, title_tr, title_en, body_tr, body_en, audience, starts_at, ends_at, severity, published_at)
    values (md5('da-e2e:announcement:active')::uuid, 'Yeni: Akşam özeti', 'New: evening summary',
            'Artık her akşam günün kısa bir özetini alabilirsin.', 'You can now get a short summary of your day every evening.',
            'all', p_now - interval '1 day', p_now + interval '7 days', 'info', p_now - interval '1 day'),
           (md5('da-e2e:announcement:expired')::uuid, 'Bakım tamamlandı', 'Maintenance complete',
            'Planlı bakım tamamlandı.', 'Planned maintenance is complete.', 'all', p_now - interval '10 days',
            p_now - interval '3 days', 'info', p_now - interval '10 days'),
           (md5('da-e2e:announcement:future')::uuid, 'Planlı bakım', 'Planned maintenance',
            'Cumartesi gece kısa bir bakım yapılacak.', 'A short maintenance window is planned for Saturday night.', 'all',
            p_now + interval '3 days', p_now + interval '5 days', 'warning', p_now)
    on conflict (id) do update
      set starts_at = excluded.starts_at, ends_at = excluded.ends_at, published_at = excluded.published_at, cancelled_at = null;
    delete from public.announcement_dismissals
    where user_id = p_user
      and announcement_id in (md5('da-e2e:announcement:active')::uuid, md5('da-e2e:announcement:expired')::uuid,
                              md5('da-e2e:announcement:future')::uuid);
    v_ids := jsonb_build_object('announcementActive', md5('da-e2e:announcement:active')::uuid);
  elsif p_scenario not in ('none', 'empty_accounts') then
    raise exception 'VALIDATION_FAILED:scenario' using errcode = '22023',
      detail = p_scenario || ' is not a canon-user scenario';
  end if;
  return v_ids;
end
$$;

-- ─── Entry point ───────────────────────────────────────────────────────────────────────────────
create or replace function e2e.seed_user(p_user uuid, p_scenario text, p_anchor timestamptz default now())
  returns jsonb
  language plpgsql
  as $$
declare
  v_now timestamptz := coalesce(p_anchor, now());
  v_tz text := 'Europe/Istanbul';
  v_day date;
  v_email text;
  v_self text;
  v_ids jsonb := '{}'::jsonb;
  v_std jsonb;
  v_mail uuid;
  v_outlook uuid;
  v_installation uuid;
  v_referee uuid;
  v_code text;
  v_admin uuid;
  v_has_instance boolean := exists (select 1 from information_schema.columns
                                    where table_schema = 'auth' and table_name = 'users' and column_name = 'instance_id');
begin
  perform e2e.guard();
  if p_scenario is null or not (p_scenario = any (e2e.scenarios())) then
    raise exception 'VALIDATION_FAILED:scenario' using errcode = '22023', detail = coalesce(p_scenario, 'null');
  end if;
  select u.email into v_email from auth.users u where u.id = p_user;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002', detail = 'e2e.seed_user: unknown user';
  end if;

  -- The demo canon users keep their (freshly re-seeded) canon and get a scenario layer.
  if exists (select 1 from public.profiles p where p.user_id = p_user and p.is_demo) then
    return jsonb_build_object('scenario', p_scenario, 'ids', e2e.layer_canon(p_user, p_scenario, v_now));
  end if;

  perform e2e.reset_user(p_user);
  if p_scenario = 'none' then
    -- A fresh account: nothing seeded, onboarding untouched (u_new).
    return jsonb_build_object('scenario', p_scenario, 'ids', v_ids);
  end if;

  if p_scenario = 'dst_berlin' then
    v_tz := 'Europe/Berlin';
    v_now := timestamptz '2026-10-24T06:00:00Z';   -- B1: Saturday 08:00 CEST, the day before DST ends
  end if;
  v_day := (v_now at time zone v_tz)::date;
  v_self := 'yunus.' || left(md5(p_user::text), 6) || '@gmail.com';
  perform e2e.onboarded(p_user, 'Yunus', case when p_scenario = 'dst_berlin' then 'en-US' else 'tr-TR' end, v_tz);

  if p_scenario = 'empty_accounts' then
    null;   -- onboarded, no connected account (u_empty: "Mailini bağla.")
  elsif p_scenario = 'mail_only' then
    -- Free, Gmail only: the flow connects Google Calendar itself (E2E-M-04).
    v_mail := e2e.add_account(p_user, p_scenario, 'gmail', 'google', '{mail_read}', 'healthy', v_self, 'Gmail · ' || v_self,
                              v_now - interval '4 minutes');
    v_ids := e2e.add_mail(p_user, p_scenario, v_mail, v_day, v_tz, v_self) || jsonb_build_object('accountGmail', v_mail);
  elsif p_scenario = 'errors' then
    -- Pro; Gmail needs re-auth, Outlook is syncing and 40 minutes behind, the AI kill switch is off for
    -- this user only (E2E-S-18).
    perform e2e.make_pro(p_user, p_scenario);
    v_mail := e2e.add_account(p_user, p_scenario, 'gmail', 'google', '{mail_read}', 'needs_reauth', v_self, 'Gmail · ' || v_self,
                              v_now - interval '6 hours');
    update public.connected_accounts set status_reason = 'invalid_grant' where id = v_mail;
    v_outlook := e2e.add_account(p_user, p_scenario, 'outlook', 'microsoft', '{mail_read}', 'syncing',
                                 'yunus@kuzeylojistik.example', 'Outlook · yunus@kuzeylojistik.example', v_now - interval '40 minutes');
    insert into public.sync_states (id, user_id, connected_account_id, resource, resource_key, status, last_success_at,
                                    last_incremental_sync_at, consecutive_failures)
    values (e2e.id(p_scenario, p_user, 'sync:outlook'), p_user, v_outlook, 'gmail_mailbox', '', 'idle', v_now - interval '40 minutes',
            v_now - interval '40 minutes', 0);
    v_ids := e2e.add_mail(p_user, p_scenario, v_outlook, v_day, v_tz, 'yunus@kuzeylojistik.example')
             || jsonb_build_object('accountGmail', v_mail, 'accountOutlook', v_outlook);
    -- feature_flag_overrides names the operator who set it: a disabled seed identity (no admin session).
    v_admin := md5('da-e2e:admin:seed')::uuid;
    if v_has_instance then
      v_email := 'e2e-seed@e2e-admin.dijitalasistan.test';
      execute $q$
        insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
                '{"provider": "email", "providers": ["email"], "da_kind": "admin"}', '{}', now(), now())
        on conflict (id) do nothing$q$ using v_admin, v_email;
    else
      insert into auth.users (id, aud, role, email, raw_app_meta_data)
      values (v_admin, 'authenticated', 'authenticated', 'e2e-seed@e2e-admin.dijitalasistan.test',
              '{"provider": "email", "providers": ["email"], "da_kind": "admin"}')
      on conflict (id) do nothing;
    end if;
    insert into public.admin_users (user_id, role, status, display_name, email, disabled_at, disabled_reason)
    values (v_admin, 'readonly', 'disabled', 'E2E seed', 'e2e-seed@e2e-admin.dijitalasistan.test', now(), 'e2e seed identity')
    on conflict (user_id) do nothing;
    insert into public.feature_flag_overrides (flag_key, user_id, value, reason, created_by_admin_id)
    values ('ai.global.enabled', p_user, false, 'E2E-S-18 AI unavailable state', v_admin);
  elsif p_scenario = 'android_ni' then
    -- Pro; recent Android notification signals (E2E-S-17 / E2E-S-22), no listener grant yet.
    perform e2e.make_pro(p_user, p_scenario);
    v_ids := e2e.standard_user(p_user, p_scenario, v_day, v_now, v_tz, v_self);
    v_installation := e2e.id(p_scenario, p_user, 'installation');
    insert into public.app_installations (id, user_id, installation_id, platform, os_version, app_version, build_number,
                                          device_model, locale, timezone, push_enabled, ni_listener_granted, device_hash)
    values (v_installation, p_user, e2e.id(p_scenario, p_user, 'installation-id'), 'android', '15', '1.4.0', '812', 'Pixel 8',
            'tr-TR', v_tz, true, false, sha256(convert_to('e2e:device:' || p_user::text, 'UTF8')));
    insert into public.android_notification_signals (id, user_id, installation_id, package_name, app_label, category, amount,
                                                     currency, due_date, tracking_status, flight_no, posted_at, signal_hash,
                                                     extractor_version, expires_at)
    values (e2e.id(p_scenario, p_user, 'signal:kargo'), p_user, v_installation, 'com.yurticikargo.mobile', 'Yurtiçi Kargo', 'cargo',
            null, null, null, 'out_for_delivery', null, v_now - interval '35 minutes',
            sha256(convert_to('e2e:signal:kargo:' || p_user::text, 'UTF8')), 'e2e-1', v_now + interval '30 days'),
           (e2e.id(p_scenario, p_user, 'signal:banka'), p_user, v_installation, 'com.garanti.cepsubesi', 'Garanti BBVA', 'bank_payment',
            1842.00, 'TRY', v_day + 5, null, null, v_now - interval '3 hours',
            sha256(convert_to('e2e:signal:banka:' || p_user::text, 'UTF8')), 'e2e-1', v_now + interval '30 days'),
           (e2e.id(p_scenario, p_user, 'signal:ucus'), p_user, v_installation, 'com.turkishairlines.mobile', 'Türk Hava Yolları',
            'flight', null, null, v_day + 3, null, 'TK2412', v_now - interval '5 hours',
            sha256(convert_to('e2e:signal:ucus:' || p_user::text, 'UTF8')), 'e2e-1', v_now + interval '30 days');
    v_ids := v_ids || jsonb_build_object('installation', v_installation);
  elsif p_scenario = 'dst_berlin' then
    -- Pro, en-US, Europe/Berlin at B1: Ahmet's 17:00 deadline sits the day before the DST switch (E2E-S-07).
    perform e2e.make_pro(p_user, p_scenario);
    v_ids := e2e.standard_user(p_user, p_scenario, v_day, v_now, v_tz, v_self);
  elsif p_scenario = 'referral_pending' then
    -- Free; the user's own code and a pending referral of a synthetic referee (E2E-M-17).
    v_ids := e2e.standard_user(p_user, p_scenario, v_day, v_now, v_tz, v_self);
    select rc.code into v_code from public.referral_codes rc where rc.user_id = p_user and rc.disabled_at is null;
    if v_code is null then
      raise exception 'STATE_CONFLICT' using errcode = '55000', detail = 'the user has no active referral code';
    end if;
    v_referee := e2e.id(p_scenario, p_user, 'user:referee');
    if v_has_instance then
      v_email := 'referee.' || left(p_user::text, 8) || '@e2e.dijitalasistan.test';
      execute $q$
        insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                                created_at, updated_at)
        values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(),
                '{"provider": "email", "providers": ["email"]}', '{"timezone": "Europe/Istanbul"}', now(), now())
        on conflict (id) do nothing$q$ using v_referee, v_email;
    else
      insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values (v_referee, 'authenticated', 'authenticated', 'referee.' || left(p_user::text, 8) || '@e2e.dijitalasistan.test', now(),
              '{"provider": "email", "providers": ["email"]}', '{"timezone": "Europe/Istanbul"}')
      on conflict (id) do nothing;
    end if;
    insert into public.referrals (id, referrer_id, referee_id, code, status, applied_at, risk_score, risk_signals, qualification)
    values (e2e.id(p_scenario, p_user, 'referral'), p_user, v_referee, v_code, 'pending', v_now - interval '2 hours', 0, '{}', '{}');
    v_ids := v_ids || jsonb_build_object('referralCode', v_code, 'referee', v_referee);
  elsif p_scenario = 'deletion' then
    -- Pro with synced content, so the deletion job has rows to purge (TST-E2E-M-02).
    perform e2e.make_pro(p_user, p_scenario);
    v_ids := e2e.standard_user(p_user, p_scenario, v_day, v_now, v_tz, v_self);
    insert into public.commitments (id, user_id, contact_id, counterparty_name, direction, text, due_at, status, dedupe_key, origin,
                                    source_type, source_id, source_provider, source_timestamp, confidence, evidence)
    values (e2e.id(p_scenario, p_user, 'commitment:mehmet'), p_user, (v_ids ->> 'contactMehmet')::uuid, 'Mehmet Yılmaz',
            'user_owes', 'Mehmet''e yarın teklif göndereceğim.', e2e.local_at(v_day + 1, time '12:00', v_tz), 'open',
            'e2e:' || p_user::text || ':mehmet-teklif', 'email_analysis', 'email_message', v_ids ->> 'messageMehmet', 'demo',
            v_now - interval '1 day', 0.92, '[{"quote": "Yarın teklifi göndereceğim.", "field": "text"}]');
  elsif p_scenario in ('approvals_mixed', 'canon_plan', 'announcement_active') then
    -- Canon layers need the canon (`pnpm db:seed:demo`) underneath; on another user they build it first.
    perform e2e.make_pro(p_user, p_scenario);
    v_ids := e2e.standard_user(p_user, p_scenario, v_day, v_now, v_tz, v_self);
    if p_scenario = 'announcement_active' then
      v_ids := v_ids || e2e.layer_canon(p_user, p_scenario, v_now);
    end if;
  end if;
  return jsonb_build_object('scenario', p_scenario, 'ids', v_ids);
end
$$;

revoke all on all functions in schema e2e from public;

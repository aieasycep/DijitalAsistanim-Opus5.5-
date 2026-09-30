# Dijital Asistan: Database and RLS Plan

> **Status:** binding implementation spec for `supabase/migrations/*`, `supabase/tests/*` and `supabase/seed/*`.
> **Canonical spine:** the Master Implementation Plan (ADR-01…15, §5 domain model, §5b routes, §6 DB summary). Names in this document are exactly the canonical ones. Anything this document adds is listed in [§14 Proposed additions](#14-proposed-additions-to-the-canonical-registry).
> **Master prompt coverage:** M§77 (schema), M§78 (rules), M§79 (RLS), M§97 (provenance), M§116 (consistency), M§147 (per-table standard), M§41 (retention), M§66 (audit), M§128 (export), M§129 (deletion). It also covers M§31–33, §35–36, §43–45, §49, §53–68, §82, §86, §95–96, §117–119, §127 and §132 where they need data.
> **Audit resolutions honoured:** secondary-docs C-01…C-37, SREQ-03 (`android_notification` source type), SREQ-11 (no "yakında" bucket), SREQ-20 (conflict suppression), SREQ-22 (`meeting_notes`), SREQ-37 (VIP relationship), SREQ-54 (interest categories), SREQ-61 (briefing weekdays), P-02 (daily cap), P-04 (approval history follows the retention setting), P-06 (6 rewards per year). Integrations audit: AES-GCM credential layout, watch and subscription fields, and the RevenueCat mirror overwrite model. Where that audit's names conflict with the spine, the spine's names win: `connected_accounts`, not `provider_connections`; the `jobs` table, not pgmq; `app_installations` + `push_tokens`, not `devices`. Stack-versions audit: PG16/pgvector 0.6 portability and the tier-C shim.
> **Reconciliation (plan §23b, binding):** rulings R-01…R-25 are applied throughout: 1024-d Voyage embeddings (R-01); `ai_result_cache`, routing profiles and the Free "AI analiz limiti 50/gün" (R-02, R-18); tap-only approvals (R-03); no undo status (R-06); OAuth completion binding (R-07); dedicated admin identities (R-08); Support Access scopes and durations (R-09); flag keys (R-10); Android channel IDs (R-12); quiet hours (R-13); the daily-cap copy (R-14); Realtime unused (R-19); key/value `plan_limits` (R-22); meeting-prep timing (R-23); dead-action closure through RPCs and grants (R-24). Per R-20 this document is authoritative for tables, columns, enums, functions, cron, Vault and buckets, except the `ai_feature` vocabulary and prompt keys (AI_PIPELINE_PLAN), RPC names and shapes (API_CONTRACTS) and admin permission strings (BACKOFFICE_PLAN §4.1).

---

## 0. Reading guide and notation

| Notation | Meaning |
|---|---|
| `NN` | `not null` |
| `=x` | `default x` |
| `⟨OWN⟩` | `id uuid NN =gen_random_uuid()` (PK) + `user_id uuid NN` FK → `auth.users(id)` **on delete cascade** |
| `⟨TS⟩` | `created_at timestamptz NN =now()`, `updated_at timestamptz NN =now()` (+ `trg_<table>_updated_at`) |
| `⟨PROV⟩` | `source_type source_type NN`, `source_id text NN check(char_length(source_id) between 1 and 200)`, `source_provider provider` (nullable only when `source_type='user_input'`), `source_timestamp timestamptz NN`, `confidence numeric(4,3) NN check(confidence between 0 and 1)` (M§97, ADR-05) |
| `⟨EVID⟩` | `evidence jsonb NN ='[]' check(private.valid_evidence(evidence))`. The value is an array of at most 5 objects `{quote text ≤300, field text, locator text?}`. `valid_evidence` is `immutable`: it checks the array type, the count, each quote length and the key whitelist (M§83). |
| `⟨EXP⟩` | `expires_at timestamptz` (null = keep until the user deletes), set by `trg_<table>_set_expires_at` from `user_preferences.retention_policy` (M§41) |
| **OWN-R / OWN-I / OWN-U / OWN-D** | Owner policies defined in §3.3 |
| **SYS** | System table: RLS enabled + forced, **zero** policies, no grants to `anon`/`authenticated` |
| **R-USER** | Retention follows the user's policy via `expires_at`, enforced by `retention_cleanup`. The rows are also purged by history deletion (where listed) and by account deletion (cascade). |

Every table block uses the M§147 fields in this order: **Purpose · Columns · PK · FKs · Unique · Indexes · RLS · Retention · Sensitive · Audit.**

---

## 1. Conventions

### 1.1 Schemas

| Schema | Exposed via PostgREST | Contents | Grants |
|---|---|---|---|
| `public` | yes | User-data tables (RLS forced), reference tables, user-callable RPCs, service-role RPCs | `usage` to `anon, authenticated, service_role`. `anon` gets **no** table or function privileges (§3.2). |
| `private` | **no** | Security-definer helpers, triggers, scheduler, audit chain, admin permission matrix, text-search config | `usage` only to `service_role`, `postgres`, `supabase_auth_admin` (for the token hook). Every function is `revoke execute … from public`. |
| `admin_api` | yes (`config.toml [api] schemas = ["public","admin_api"]`) | Security-definer RPCs used **only** by the `admin-api` Edge Function with the admin's JWT. Each one first calls `private.require_admin(<perm>)`. | `usage` + `execute` to `authenticated`. Authorization happens inside the function (aal2 + active admin + permission). |
| `extensions` | no (on `extra_search_path`) | pgcrypto, pg_trgm, unaccent, citext, vector, pg_net objects | Supabase default |
| `storage`, `auth`, `vault`, `cron`, `net` | Supabase-managed | Buckets and objects, users, secrets, cron, http | These are recreated minimally by the tier-C shim (§12). |

### 1.2 Naming

- Tables: `snake_case` plural (canonical list). Columns: `snake_case`. FK columns: `<entity>_id`. Timestamps end in `_at`, dates in `_date`, and local times in `_time` (`time` type, interpreted in `user_preferences.timezone`).
- Constraints: `<table>_<cols>_key` (unique), `<table>_<col>_check`, `<table>_<col>_fkey`. Indexes: `<table>_<cols>_idx`, with `_p` for partial and `_gin`/`_hnsw`/`_trgm` for index type.
- Policies: `<table>_<command>_<role-scope>`, e.g. `insights_select_own`.
- Triggers: `trg_<table>_<purpose>`.
- Enum values are lowercase `snake_case`. UI labels live in `packages/i18n`, never in the DB.

### 1.3 Time

- Every instant is `timestamptz` stored in UTC (M§78). The server runs `timezone = 'UTC'`, and `alter database … set timezone to 'UTC'` is part of 0001.
- The user's timezone is **only** `user_preferences.timezone` (IANA, `=Europe/Istanbul`) (M§39, REQ-I18N-07). `app_installations.timezone` is diagnostic only.
- Local wall-clock settings (briefing slots, quiet hours, working hours) are `time` columns. They are evaluated with `(p_now at time zone tz)` inside `private.scheduler_tick` (§6.3), which is safe across DST.
- All-day or date-only facts use `date` (Google Tasks `due` is date-only).

### 1.4 Soft-delete policy (M§78 "Soft deletion gerektiğinde")

| Table | Mechanism | Why | Purge |
|---|---|---|---|
| `priority_rules` | `deleted_at` | "Kuralı Sil" has a 10 s "Geri al" toast (PRIMARY 7.12) | `retention_cleanup` hard-deletes 30 days after `deleted_at` |
| `learned_preferences` | `deleted_at` (tombstone) | "bir daha varsaymam": the tombstone stops the learner from re-inferring the same preference | Kept until history or account deletion |
| `connected_accounts` | `status='disconnected'` + `disconnected_at` | Audit and "son senkron" history; content purge runs first | The row is hard-deleted by the `history_deletion`/disconnect purge job 30 days after disconnect |
| `admin_users` | `status='disabled'` | Audit integrity; last-super-admin guard | Never |
| `announcements` | `cancelled_at` | "Cancel" keeps history | Never |
| `referrals` | `status` + `referee_id` set null on account deletion | Anti-abuse hashes are kept 365 days | `retention_cleanup` after 365 days |

**Every other table uses hard delete.** `audit_logs` and `approval_events` can never be deleted (§3.6).

### 1.5 Idempotency and dedupe patterns (M§78, M§116)

| Pattern | Where | Key formula |
|---|---|---|
| Provider identity upsert (`on conflict … do update`) | `email_threads`, `email_messages`, `calendar_events`, `calendars`, `tasks`, `connected_accounts`, `sync_states` | Provider ids (see each table) |
| Deterministic `dedupe_key`, unique per user | `insights`, `life_events`, `commitments`, `notifications` | `insights`: `'{kind}:{entity_type}:{entity_id}[:{discriminator}]'`. `life_events`: `'{type}:'‖hex(sha256(normalized identity fields: carrier+tracking_no \| flight_no+depart_date \| venue+at \| payee+due_date \| service+renews_at \| provider+event+at))'`. `commitments`: `'{source_type}:{source_id}:'‖hex(sha256(lower(unaccent(text))‖direction‖coalesce(contact_id,counterparty_name)))'`. `notifications`: `'{category}:{entity_type}:{entity_id}:{local_date}'` (briefings use `'briefing:{briefing_id}'`) |
| Client- or server-generated `idempotency_key`, unique | `reminders` (per user), `approval_actions`, `jobs`, `entitlement_grants`, `captures` (per user), `briefings` | `approval:{uuid}:v{payload_version}`; `briefing:{user_id}:{kind}:{local_date}`; `referral:{referral_id}:{side}`; `admin_grant:{uuid}`; job keys in §6.2 |
| External event id, unique | `webhook_events (source, external_id)`, `billing_events (event_id)` | Pub/Sub `messageId`; `gcal:{channel_id}:{message_number}`; Graph `sha256(subscriptionId‖changeType‖resource‖lifecycleEvent?)`; RevenueCat `id` |
| Content hash | `email_messages.content_hash`, `email_threads.analysis_hash`, `meeting_preps.input_hash`, `memory_chunks.content_hash` | `sha256` of normalized text. The same hash means reasoning is never re-run (M§82). |
| HTTP `Idempotency-Key` | `api_idempotency_keys (user_id, key)` | Client uuid v4 reused for every retry of one user intent, including offline-queue replays (API_CONTRACTS §2.11); a replay returns the stored status and resource reference |
| Per-user AI result dedupe | `ai_result_cache (user_id, feature, content_hash, prompt_version_id)` | `content_hash = HMAC-SHA256(k_user, normalised input)` with `k_user = HMAC-SHA256(AI_HASH_PEPPER, user_id)` derived at runtime in Edge Functions and never stored (R-02) |
| Row-level lock + state check | `private.transition_approval`, `claim_jobs`, `reward_referral` | `FOR UPDATE` / `SKIP LOCKED` |

### 1.6 Common triggers

- `private.set_updated_at()` runs `BEFORE UPDATE` on every table with `updated_at` and sets `new.updated_at := now()`.
- `private.set_expires_at()` runs `BEFORE INSERT` on every `⟨EXP⟩` table. It computes `new.expires_at := private.compute_expires_at(new.user_id, coalesce(<anchor>, now()))`. The anchor per table is listed in §6.4, e.g. `received_at` for mail, `end_at` for events and `occurred_at` for memory.

### 1.7 Portability: PG16 + pgvector 0.6 (tier C) vs hosted PG17 (tier A)

- **Forbidden** in migrations: `JSON_TABLE`, `MERGE … RETURNING`, `transaction_timeout`, `halfvec`/`sparsevec`/bit vector ops (pgvector ≥0.7), `hnsw.iterative_scan` (≥0.8), `uuidv7()` (PG18), `NULLS NOT DISTINCT` is allowed (PG15+).
- Allowed: `vector(1024)` (R-01: Voyage `voyage-4` documents / `voyage-4-lite` queries, one shared 1024-d space), HNSW `vector_cosine_ops` (pgvector ≥0.5), generated stored columns, `websearch_to_tsquery`, `pg_cron` interval schedules `'15 seconds'` (pg_cron ≥1.5; apt ships 1.6.2).
- Security-definer functions are owned by `postgres`. On hosted Supabase `postgres` has `BYPASSRLS`; in tier C it is a superuser. Test `000` asserts that the owner of every `SECURITY DEFINER` function has `rolbypassrls or rolsuper`, so `FORCE ROW LEVEL SECURITY` never blocks internal functions.
- `squawk` lints every migration in CI: no `create index` without `concurrently` after the initial release, and no `not null` added without a default on populated tables.

### 1.8 Extensions (0001) with guards

```sql
create schema if not exists extensions;
create extension if not exists pgcrypto  with schema extensions;
create extension if not exists pg_trgm   with schema extensions;
create extension if not exists unaccent  with schema extensions;
create extension if not exists citext    with schema extensions;
create extension if not exists vector    with schema extensions;   -- 0.6+ (tier C) / 0.8 (hosted)
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;                           -- schema cron
  else raise notice 'pg_cron unavailable: cron schedules in 0015 will be skipped'; end if;
  if to_regproc('net.http_post') is null
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;     -- tier C: shim provides net.http_post
  end if;
end $$;
-- Turkish FTS config with unaccent (immutable when referenced by regconfig constant)
create text search configuration private.tr_search (copy = pg_catalog.turkish);
alter text search configuration private.tr_search
  alter mapping for hword, hword_part, word with extensions.unaccent, turkish_stem;
create function private.immutable_unaccent(text) returns text language sql immutable parallel safe
  set search_path = '' as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;
```

`vault` (`supabase_vault`) is pre-installed on hosted Supabase; the shim stubs it (§12). The `pgtap` extension is created only by the test runner, never by migrations.

---

## 2. Enums (0001): `CREATE TYPE` specs

Canonical enums come from plan §5. The additions (marked ➕) are justified in §14.

```sql
create type public.provider            as enum ('google','microsoft','apple_device','android_device','demo');
create type public.capability          as enum ('mail_read','mail_send','calendar_read','calendar_write','tasks_read','tasks_write');
create type public.account_status      as enum ('connecting','healthy','syncing','partial','needs_reauth','admin_consent_required','error','disconnected');
create type public.mail_category       as enum ('important','awaiting_my_reply','awaiting_their_reply','has_deadline','informational','low_priority');
create type public.decision_tier       as enum ('explicit_rule','learned_preference','deterministic_signal','ai_classification');
create type public.insight_kind        as enum ('reply_needed','meeting','deadline','follow_up','commitment','life_event','security','conflict','schedule_suggestion','approval_pending','digest');
create type public.urgency             as enum ('urgent','today','normal','low');
create type public.item_status         as enum ('open','done','dismissed','snoozed','expired');
create type public.life_event_type     as enum ('shipment','flight','reservation','payment','subscription','security');
create type public.flow_card_type      as enum ('email','meeting','deadline','shipment','flight','reservation','payment','subscription','security','follow_up','commitment');
create type public.commitment_direction as enum ('user_owes','they_owe');
create type public.commitment_status   as enum ('open','done','snoozed','cancelled');
create type public.approval_action_type as enum ('email_send','calendar_create','calendar_update','task_create','reminder_create','commitment_create');
create type public.approval_status     as enum ('pending','approved','rejected','executing','executed','failed','expired');
create type public.briefing_kind       as enum ('morning','midday','evening','weekly');
create type public.briefing_status     as enum ('scheduled','generating','ready','delivered','skipped','failed');
create type public.capture_kind        as enum ('photo','screenshot','pdf','file','link','text','share');
create type public.capture_status      as enum ('pending_upload','uploaded','analyzing','extracted','actioned','discarded','failed');  -- ➕ 'pending_upload': row created by POST /captures/upload-url before the upload (API-CAP-01)
create type public.extracted_entity_type as enum ('event','task','deadline','person','payment','reservation','flight','shipment','product','note');
create type public.notification_category as enum ('morning','midday','evening','critical_email','meeting','deadline','follow_up','life_intel','approval','account');
create type public.notification_detail as enum ('full','title_only','generic');
create type public.notification_decision as enum ('scheduled','sent','suppressed','deduplicated','failed');
create type public.job_type            as enum ('initial_sync','gmail_sync','outlook_sync','calendar_sync','tasks_sync','device_calendar_ingest','watch_renewal','reconciliation','provider_webhook','email_triage','email_analysis','insight_refresh','first_analysis','briefing','meeting_prep','embedding','approval_execute','notification','push_receipts','retention','export','history_deletion','account_deletion','billing_sync','referral_evaluate','health_check','capture_analysis','credential_reencrypt','integration_purge','ai_batch','ai_eval','briefing_audio','transactional_email');  -- ➕ the last seven values (§6.2 keys, §14)
create type public.job_status          as enum ('queued','running','completed','retrying','failed','dead_letter');
create type public.admin_role          as enum ('super_admin','operations','support','finance','ai_ops','analyst','readonly');
create type public.prompt_status       as enum ('draft','active','archived');
create type public.ticket_status       as enum ('open','in_progress','waiting_user','resolved','closed');
create type public.ticket_category     as enum ('account','integration','sync','billing','ai_quality','notification','privacy','other');
create type public.feedback_type       as enum ('bug','feature','general','ai_quality');
create type public.grant_source        as enum ('referral_referrer','referral_referee','admin','support','compensation');
create type public.retention_policy    as enum ('d30','d90','d365','until_deleted');
-- ➕ additions
create type public.source_type         as enum ('email_message','email_thread','calendar_event','device_calendar_event','task','capture','meeting_note','post_meeting_note','android_notification','assistant_message','user_input','commitment','life_event','contact','briefing','ai_feedback');
create type public.platform            as enum ('ios','android');
create type public.user_state          as enum ('active','disabled','deletion_pending');
create type public.vip_relationship    as enum ('spouse','family','manager','key_client','friend','other');
create type public.rule_condition      as enum ('person','domain','keyword','category','sender','android_app');
create type public.rule_outcome        as enum ('always_important','high','low','always_notify','mute');
create type public.referral_status     as enum ('pending','qualified','rewarded','rejected','flagged');
create type public.referral_side       as enum ('referrer','referee');
create type public.subscription_status as enum ('none','trial','active','grace_period','billing_issue','cancelled','paused','expired','refunded');
create type public.reminder_status     as enum ('scheduled','delivered','done','cancelled','failed');
create type public.export_status       as enum ('requested','processing','ready','expired','failed','cancelled');
create type public.deletion_kind       as enum ('history','account');
create type public.deletion_status     as enum ('requested','verified','queued','processing','completed','failed','cancelled');
create type public.ai_feature          as enum ('email_triage','thread_summary','email_deep_extract','commitment_extract','life_intel_extract','briefing_morning','briefing_midday','briefing_evening','weekly_review','meeting_prep','post_meeting_parse','capture_extract','assistant_intent','assistant_qa','reply_draft','follow_up_draft','embedding_doc','embedding_query','stt','tts','admin_probe');  -- vocabulary owned by AI_PIPELINE_PLAN (R-20); admin_probe = model health probes only
create type public.routing_profile     as enum ('balanced','lean');                -- R-02 / R-18; plan default 'balanced'
create type public.ai_tier             as enum ('t0','t1','t2','t3');              -- AI_PIPELINE_PLAN §3.1
create type public.approval_via        as enum ('approval_center','inline_sheet','voice_card','capture_batch','in_place');  -- R-03: every value is a tap
create type public.support_access_scope as enum ('pii','email_metadata','insights','notifications','captures','assistant_transcript','ai_feedback');  -- R-09
create type public.admin_status        as enum ('invited','active','disabled');
```

`packages/domain/src/enums.ts` mirrors every enum as a `const` tuple. CI test `enums.parity.test.ts` diffs it against `database.types.ts`.

---

## 3. RLS and grant model (M§79)

### 3.1 Baseline applied to every table (0014)

```sql
alter table public.<t> enable row level security;
alter table public.<t> force row level security;
revoke all on table public.<t> from public, anon, authenticated;
grant select, insert, update, delete on table public.<t> to service_role;   -- Edge Functions (secret key)
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
```

`service_role` has `BYPASSRLS`. Only Edge Functions hold the secret key (ADR-04 and M§79 "Service role yalnız güvenli backend context'te").

Supabase Realtime is **not used** (R-19): the `supabase_realtime` publication stays empty (test 001 asserts it). Clients refresh through TanStack Query invalidation and polling (e.g. First Analysis progress every 1–2 s, approval status while `executing`) plus push for background changes.

### 3.2 `anon`

- `anon` has **no** table, sequence or function privileges in `public`, `private` or `admin_api`.
- Unauthenticated web flows (support form, deletion request, referral resolve) go through the `public-api` Edge Function with the secret key.
- The generic test (§13.1) asserts this.

### 3.3 Owner policy templates (`to authenticated` only)

```sql
-- OWN-R
create policy <t>_select_own on public.<t> for select to authenticated using ((select auth.uid()) = user_id);
-- OWN-I (optionally "and <extra>")
create policy <t>_insert_own on public.<t> for insert to authenticated with check ((select auth.uid()) = user_id);
-- OWN-U
create policy <t>_update_own on public.<t> for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- OWN-D
create policy <t>_delete_own on public.<t> for delete to authenticated using ((select auth.uid()) = user_id);
```

- `(select auth.uid())` is written as a subselect so Postgres evaluates it once per statement (initPlan), not once per row.
- Every owner table has an index whose leading column is `user_id`.

### 3.4 Column-level privileges

- User-editable columns are granted explicitly, e.g. `grant update (display_name, locale) on public.profiles to authenticated`.
- State-machine columns, entitlement columns, plan columns, provenance, AI outputs and ids are **never** granted for update (ADR-04).
- Where some columns are hidden from the owner (cursor internals, hashes, embeddings), `select` is granted per column. Clients must therefore request explicit column lists; `select=*` fails by design. `packages/api-client` generates the column lists.

### 3.5 Admin paths

- Admin-only tables are **SYS**. The backoffice never reads tables directly; it calls `admin_api.*` definer functions through `admin-api`.
- Defence in depth: each admin-only table also gets a `RESTRICTIVE` policy for `authenticated`:
  `create policy <t>_admin_aal2 on public.<t> as restrictive for all to authenticated using ((select auth.jwt()->>'aal') = 'aal2')`.
  Because no permissive policy exists, this still denies all access. It stays in place so that adding a permissive policy later can never accidentally expose data to non-aal2 sessions (§13.1 asserts it exists).

### 3.6 Append-only tables

| Table | Grant | Trigger | Scope |
|---|---|---|---|
| `audit_logs` | `revoke update, delete, truncate … from public, anon, authenticated, service_role` | `trg_audit_logs_immutable` (`BEFORE UPDATE OR DELETE`) + `trg_audit_logs_no_truncate` (`BEFORE TRUNCATE`, statement-level) raise `AUDIT_IMMUTABLE` | Hash chain in §6.7 |
| `approval_events` | same revokes | same immutability triggers | — |
| `support_notes` | no update grant | — | — |

---

## 4. Table specifications

### 4.1 Identity and settings

#### `profiles`
- **Purpose:** App profile and account state. It is created by `private.handle_new_user()` on `auth.users` insert (M§88, M§130).
- **Columns:**
  - `user_id` uuid NN.
  - `display_name` text check(char_length between 1 and 80).
  - `avatar_path` text check(avatar_path ~ '^[0-9a-f-]{36}/avatar\.(png|jpg|webp)$').
  - `locale` text NN ='tr-TR' check(in ('tr-TR','en-US')).
  - `state` user_state NN ='active'.
  - `disabled_at`, `disabled_reason` text (admin; check char_length ≤500), `disabled_by` uuid.
  - `onboarding_step` text check(in ('welcome','noise','proactive','control','account','connect_mail','connect_calendar','permissions','personalization','briefing_schedule','vip','analysis','ready','notifications','android_notifications','done')).
  - `onboarding_completed_at` timestamptz.
  - `terms_accepted_at` timestamptz, `terms_version` text.
  - `last_active_at` timestamptz (written by `api /me/bootstrap`, throttled to 10 min).
  - `apple_sub_hash` bytea (SIWA identity, for revocation lookup).
  - `is_demo` boolean NN =false (set only by the gated demo seed; demo users are excluded from business metrics, referrals and revenue).
  - `is_internal` boolean NN =false (set by `admin_api.user_mark_internal`, permission `users.mark_internal`; excluded from metrics).
  - ⟨TS⟩.
- **PK:** `user_id`.
- **FKs:** `user_id` → `auth.users(id)` on delete cascade. `disabled_by` → `admin_users(user_id)` on delete set null.
- **Unique:** —
- **Indexes:** `profiles_state_idx (state) where state <> 'active'`; `profiles_last_active_idx (last_active_at desc)` (backoffice "Inactive" filter).
- **RLS:** OWN-R and OWN-U. `grant select (user_id, display_name, avatar_path, locale, state, onboarding_step, onboarding_completed_at, terms_accepted_at, terms_version, created_at, updated_at)` and `grant update (display_name, avatar_path, locale, onboarding_step, onboarding_completed_at, terms_accepted_at, terms_version)` to authenticated. There is no insert or delete grant; the trigger creates the row and account deletion removes it.
- **Retention:** Lifetime of the account; deleted by cascade at account deletion.
- **Sensitive:** `display_name` is PII (masked in admin lists as "Y***"). `apple_sub_hash` is pseudonymous.
- **Audit:** Admin disable/restore → `user.disable` / `user.restore` (reason required). Internal flag → `user.internal_flag_changed` (reason required). `state='deletion_pending'` is set by `/privacy/delete-account` → `account.deletion.requested`.

#### `user_preferences`
- **Purpose:** Timezone, briefing schedule, appearance, retention, AI access, personalization (M§9–12, §32, §38–41, SREQ-53/54/61).
- **Columns:**
  - `user_id` uuid NN.
  - `timezone` text NN ='Europe/Istanbul' (validated by trigger against `pg_timezone_names`).
  - `theme` text NN ='system' check(in ('system','light','dark')). `reduce_motion` boolean NN =false. `haptics_enabled` boolean NN =true.
  - `retention_policy` retention_policy NN ='d90'.
  - `learn_from_interactions` boolean NN =true.
  - `ai_data_access` jsonb NN ='{"mail_body":true,"attachments":true,"calendar":true,"contacts":true,"location_coarse":false}' check(`private.valid_ai_data_access(ai_data_access)`: exactly these 5 boolean keys).
  - `interest_categories` text[] NN ='{}' check(interest_categories <@ array['work','family','finance','travel','shopping','appointments','deadlines']).
  - `morning_enabled` boolean NN =true, `morning_time` time NN ='08:00'.
  - `midday_enabled` boolean NN =true, `midday_time` time NN ='13:00'.
  - `evening_enabled` boolean NN =true, `evening_time` time NN ='19:00'.
  - `weekly_enabled` boolean NN =true, `weekly_dow` smallint NN =7 check(between 1 and 7, ISO; 7=Sunday), `weekly_time` time NN ='18:00'.
  - `briefing_weekdays` smallint[] NN ='{1,2,3,4,5,6,7}' check(briefing_weekdays <@ '{1,2,3,4,5,6,7}' and cardinality ≥1). "Brifing günleri" (SREQ-61) is distinct from quiet hours.
  - `weekend_morning_time` time NN ='10:00' (PRIMARY "Sadece sabah, 10:00"). `weekend_morning_only` boolean NN =true.
  - `working_hours_start` time NN ='09:00', `working_hours_end` time NN ='18:00', check(start < end). Used by "Uygun zamanda" (SREQ-34).
  - `dismissed_gates` jsonb NN ='{}' (e.g. `{"midday_gate":"<until ts>"}`, PRIMARY 7.6).
  - `timezone_mode` text NN ='auto' check(in ('auto','manual')) (SREQ-61; `auto`: `api /devices/register` updates `timezone` when the device IANA zone changes; `manual`: only the user changes it).
  - `weekend_personal_first` boolean NN =true ("Hafta sonu · Kişisel öncelikli": weekend briefings rank personal items first).
  - `work_days` smallint[] NN ='{1,2,3,4,5}' check(work_days <@ '{1,2,3,4,5,6,7}' and cardinality ≥1) (ISO days used by the "Uygun zamanda" slot finder).
  - `default_write_calendar_id` uuid (default destination of "Planla" / `calendar_create` proposals; validated by `trg_user_preferences_validate_calendar`).
  - `default_reply_tone` text NN ='professional' check(in ('short','professional','friendly','detailed')).
  - `default_task_destination` jsonb NN ='{"kind":"in_app"}', `default_reminder_destination` jsonb NN ='{"kind":"in_app"}', each check(`value->>'kind' in ('in_app','google_tasks','microsoft_todo','apple_reminders')`; optional `account_id`, `list_id`). External destinations are always written through an approval.
  - `follow_up_after_days` smallint NN =2 check(between 1 and 14) (Smart Follow-Up nudge threshold).
  - `analytics_opt_out` boolean NN =false (M§42; the client stops sending and `api /analytics/events` drops the caller's events).
  - `screen_protection` boolean NN =false ("Ekran koruması": `FLAG_SECURE` and the app-switcher privacy overlay on sensitive screens).
  - `first_analysis_job_id` uuid.
  - ⟨TS⟩.
- **PK:** `user_id`.
- **FKs:** `user_id` → `auth.users` on delete cascade. `default_write_calendar_id` → `calendars(id)` on delete set null.
- **Unique:** —
- **Indexes:** `user_preferences_timezone_idx (timezone)` (scheduler grouping).
- **RLS:** OWN-R, OWN-U. Update is granted on every column except `user_id`, `first_analysis_job_id`, `created_at` and `updated_at`.
  - The midday/evening Pro gate is **not** a constraint: the user may store `true`, and `scheduler_tick` skips non-entitled users with `skipped_reason='not_entitled'` (C-21, M§44).
- **Retention:** Account lifetime.
- **Sensitive:** Low. `timezone` is quasi-location.
- **Audit:**
  - A change to `retention_policy` → `trg_user_preferences_retention_changed` enqueues `retention` job `{mode:'recompute'}` and writes audit `privacy.retention_changed` (actor user).
  - A change to `ai_data_access` → audit `privacy.ai_access_changed`.
  - A change to `analytics_opt_out` → audit `privacy.analytics_opt_out_changed`.

#### `notification_preferences`
- **Purpose:** Categories, quiet hours, lock-screen privacy and detail level for the decision engine (M§35, §86, §132; C-19; P-02).
- **Columns:**
  - `user_id` uuid NN.
  - `smart_filter` boolean NN =true ("Yalnızca gerçekten önemliyse bildir").
  - Category booleans: `morning` NN =true, `midday` NN =true, `evening` NN =true, `critical_email` NN =true, `meeting` NN =true, `deadline` NN =true, `follow_up` NN =true, `life_intel` NN =false, `approval` NN =true, `account` NN =true.
  - `quiet_hours_enabled` boolean NN =true, `quiet_start` time NN ='22:30', `quiet_end` time NN ='07:30', `quiet_days` smallint[] NN ='{1,2,3,4,5,6,7}' (check subset). Quiet hours (R-13, evaluated in the user's timezone) suppress everything except (a) user-created smart reminders at the time the user chose and (b) VIP `critical_email` while `vip_bypass_quiet` is on; there is no other exception.
  - `vip_bypass_quiet` boolean NN =true (R-13 default on, PRIMARY 07 "VIP kişilerden gelenler · Sessiz saatlerde bile"; per-VIP override `vip_people.bypass_quiet_hours`; bypassing pushes are still deduped and capped at 3 per quiet window).
  - `detail_level` notification_detail NN ='title_only'.
  - `lock_screen_private` boolean NN =true.
  - `daily_cap` smallint NN =5 check(between 1 and 20). This is the non-critical daily cap (R-14). The only frequency copy is "Sadece önemli olduğunda haber veririz."; the retired "Günde ortalama 3 bildirim" claim is never shown.
  - `snooze_until` timestamptz: set by `POST /briefings/:id/evening-ready` when the user chooses a quiet evening ("Yarına Hazırım"); until then non-critical categories are held, while `critical_email`, `meeting` and user-created reminders still go through the decision engine (quiet hours still apply, R-13).
  - `meeting_prep_lead_min` smallint NN =30 check(between 15 and 30) (R-23: the prep notification fires at T−30…T−15 per this preference).
  - `os_permission` text NN ='undetermined' check(in ('undetermined','granted','denied','provisional')), `os_permission_updated_at` timestamptz.
  - `prompt_deferred_count` smallint NN =0 check(≥0).
  - ⟨TS⟩.
- **PK:** `user_id`.
- **FKs:** `user_id` → `auth.users` cascade.
- **Unique:** —
- **Indexes:** — (PK lookup only).
- **RLS:** OWN-R, OWN-U. Update is granted on all columns except `user_id`, `snooze_until` (server-set), `created_at` and `updated_at`.
- **Retention:** Account lifetime.
- **Sensitive:** None.
- **Audit:** None (a user preference). Changes to `detail_level` emit analytics `notif_detail_changed` (no content).

#### `app_installations`
- **Purpose:** One row per app install. It carries platform/version data for backoffice observability (M§110), device-hash anti-abuse (M§45) and the Android NI grant state.
- **Columns:**
  - ⟨OWN⟩.
  - `installation_id` uuid NN (client-generated, stored in SecureStore).
  - `platform` platform NN.
  - `os_version` text, `app_version` text NN check(~ '^\d+\.\d+\.\d+$'), `build_number` text NN, `device_model` text (coarse, e.g. "iPhone15,2").
  - `locale` text, `timezone` text.
  - `push_enabled` boolean NN =false.
  - `ni_listener_granted` boolean (Android only; check(platform='android' or ni_listener_granted is null)).
  - `ni_mode` text check(in ('all','selected')). `ni_allowed_packages` text[] NN ='{}'.
  - `ni_last_signal_at` timestamptz (Android NI support visibility).
  - `platform_capabilities` jsonb NN ='{}' (reported by the app on register, e.g. `{ni_connected, ios_show_previews, exact_alarm, background_task}`; booleans only).
  - `device_hash` bytea NN = sha256(installation_id‖platform‖`DEVICE_HASH_SALT`), computed in the Edge Function.
  - `last_seen_at` timestamptz NN =now(), `signed_out_at` timestamptz.
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` cascade. On login `api /devices/register` rebinds by upserting `installation_id` with the new `user_id`.
- **Unique:** `(installation_id)`.
- **Indexes:** `(user_id, last_seen_at desc)`; `(app_version, platform)`; `(device_hash)`.
- **RLS:** OWN-R with column grant `select (id, user_id, installation_id, platform, app_version, push_enabled, ni_listener_granted, ni_mode, ni_allowed_packages, ni_last_signal_at, platform_capabilities, last_seen_at, created_at)`. `device_hash` is hidden. Writes go only through `api /devices/register|unregister` (service role).
- **Retention:** Deleted 180 days after `last_seen_at` by `retention_cleanup`, and on account deletion.
- **Sensitive:** `device_hash` is a pseudonymous identifier used only for referral anti-abuse.
- **Audit:** None. Backoffice reads are aggregate only (`admin_api.app_versions_breakdown`).

#### `push_tokens`
- **Purpose:** Expo push tokens per installation (ADR-10).
- **Columns:**
  - ⟨OWN⟩.
  - `installation_id` uuid NN.
  - `expo_push_token` text NN check(~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$').
  - `status` text NN ='active' check(in ('active','disabled')).
  - `disabled_reason` text check(in ('logout','device_not_registered','user_disabled','replaced','account_deleted')).
  - `last_registered_at` timestamptz NN =now().
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `installation_id` → `app_installations(id)` on delete cascade. `user_id` → `auth.users` cascade.
- **Unique:** `(expo_push_token)`.
- **Indexes:** `(user_id) where status='active'`; `(installation_id)`.
- **RLS:** OWN-R with `grant select (id, user_id, installation_id, status, disabled_reason, last_registered_at, created_at)`. The token itself is hidden. Writes go through `api /devices/*` and the worker (DeviceNotRegistered → disabled).
- **Retention:** Disabled tokens are deleted after 30 days; rows are deleted on account deletion.
- **Sensitive:** The token is delivery-capable, so it is never returned to clients or admins (admins see `status` only).
- **Audit:** An admin "push test" writes `notifications.test_sent`.

---

### 4.2 Integrations

#### `connected_accounts`
- **Purpose:** One row per provider account connected for **integration**, separate from login (M§75, §76, §88; ADR-07). It holds the granted-scope capability flags and the per-account data-source toggles (M§40, SREQ-68).
- **Columns:**
  - ⟨OWN⟩.
  - `provider` provider NN.
  - `provider_account_id` text NN (Google `sub`, Graph user `id`, device installation id for `*_device`).
  - `account_email` citext (null for device).
  - `display_label` text (e.g. "Apple Takvim · bu iPhone").
  - `tenant_type` text check(in ('personal','work')), `tenant_id` text.
  - `status` account_status NN ='connecting'.
  - `status_reason` text check(in ('invalid_grant','scope_missing','admin_consent_required','provider_error','quota','revoked_by_user','watch_failed','permission_denied','external_credential_required')).
  - `granted_scopes` text[] NN ='{}'.
  - `capabilities_granted` capability[] NN ='{}' (derived from scopes by the `oauth` function).
  - `data_source_toggles` jsonb NN ='{"mail_read":true,"attachments_analyze":true,"deadline_detect":true,"draft_replies":true,"calendar_read":true,"schedule_suggest":true,"calendar_write_with_approval":true,"tasks_read":true}' check(`private.valid_data_source_toggles(...)`: known keys, boolean values).
  - `analysis_window_days` smallint NN =3 check(between 1 and 14).
  - `connected_at` timestamptz, `last_sync_at` timestamptz, `last_successful_sync_at` timestamptz, `last_error_at` timestamptz, `last_error_code` text, `reauth_required_at` timestamptz, `disconnected_at` timestamptz.
  - `revocation_mode` text check(in ('provider_revoked','local_only','device_local')). Microsoft = `local_only` (ADR-07).
  - `credential_expires_at` timestamptz (Microsoft certificate / refresh horizon, for the backoffice).
  - `pending_binding_until` timestamptz: non-null while an OAuth result awaits the app's completion call `POST /integrations/oauth/complete` (R-07); no sync job runs and `account_can` is false until it is cleared; expired rows are purged (§6.3 step 15).
  - `demo_flavor` text check(in ('google','microsoft')), check((provider = 'demo') = (demo_flavor is not null)) (which provider the demo adapter imitates).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` cascade.
- **Unique:** `(user_id, provider, provider_account_id)`. Reconnecting reuses the row.
- **Indexes:** `(user_id, status)`; `(status) where status in ('needs_reauth','error','admin_consent_required','partial')` (backoffice filters); `(provider, last_successful_sync_at)`.
- **RLS:** OWN-R with column grant excluding nothing sensitive: all columns are selectable. There are **no** user write grants. Toggles change via `PATCH /integrations/:accountId/data-sources` (audited, validated); start/upgrade/disconnect go through `api`.
- **Retention:** Account lifetime. After disconnect the row is kept 30 days (soft), then hard-deleted by the purge job.
- **Sensitive:** `account_email` is PII (masked `yu***@gmail.com` in admin_api).
- **Audit:**
  - `integration.connected`, `integration.scope_upgraded`, `integration.disconnected` (actor user), `integration.data_sources_changed`.
  - Admin "Disconnect Integration" → `integration.admin_disconnect` (reason).
  - `trg_connected_accounts_plan_limit` (§6.5) enforces `plan_limits.max_mail_accounts` / `max_calendar_accounts` on insert or reactivation (M§44).
  - `trg_connected_accounts_status_notify` enqueues an `account` notification on the transition to `needs_reauth`, key `account_reauth:{id}:{utc_date}`.

**Effective capability** (enforced server-side before every provider call and every LLM call, M§40):
`private.account_can(account_id, cap)` = `cap = any(capabilities_granted)` ∧ the matching toggle is true ∧ `status in ('healthy','syncing','partial')` ∧ `pending_binding_until is null` ∧ (a Pro capability ⇒ `private.is_pro(user_id)`).

Toggle ↔ capability map:

| Toggle | Capability | Effect |
|---|---|---|
| `mail_read` | `mail_read` | Ingestion pauses |
| `attachments_analyze` | — | Attachments are neither downloaded nor parsed |
| `deadline_detect` | — | Deadline extraction is skipped |
| `draft_replies` | — | Reply generation is refused |
| `calendar_read` | `calendar_read` | — |
| `schedule_suggest` | — | Planning proposals are skipped |
| `calendar_write_with_approval` | `calendar_write` | — |
| `tasks_read` | `tasks_read` | — |

#### `oauth_credentials`
- **Purpose:** Encrypted provider tokens and the Apple SIWA refresh token (ADR-05, M§76). **Decryption happens only in Edge Functions.**
- **Columns:**
  - ⟨OWN⟩.
  - `connected_account_id` uuid (null only for `token_kind='apple_siwa_refresh'`).
  - `provider` provider NN.
  - `token_kind` text NN check(in ('refresh','access','apple_siwa_refresh')).
  - `key_version` smallint NN check(≥1).
  - `iv` bytea NN check(octet_length(iv)=12).
  - `ciphertext` bytea NN check(octet_length(ciphertext) between 17 and 16384). The AES-256-GCM output includes the 16-byte tag appended (WebCrypto layout).
  - `aad_hash` bytea NN check(octet_length=32) = sha256(`'v1|'‖coalesce(connected_account_id,user_id)‖'|'‖provider‖'|'‖token_kind`). The AAD string itself is recomputed in the Edge Function; the hash is stored so re-binding can be verified.
  - `access_expires_at` timestamptz.
  - `scope_snapshot` text.
  - `refresh_lock_until` timestamptz, `refresh_lock_owner` text (single-flight token refresh through `private.try_lock_credential_refresh`, INTEGRATION_PLAN §3.4).
  - `client_id_hint` text (Apple SIWA: the bundle ID or Services ID used at exchange, needed for revocation).
  - `rotated_at` timestamptz.
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `connected_account_id` → `connected_accounts(id)` on delete cascade. `user_id` → `auth.users` cascade.
- **Unique:** `(connected_account_id, token_kind) where connected_account_id is not null`; `(user_id, token_kind) where connected_account_id is null`.
- **Indexes:** `(key_version)` (rotation sweep); `(access_expires_at) where token_kind='access'`.
- **RLS:** **SYS.** Invisible even to the owner. Only `service_role` has access.
- **Retention:** Hard-deleted on disconnect (after the provider revoke) and on account deletion. Rows are re-encrypted with the active key version on each refresh and by the daily `credential_reencrypt` job (key `credential_reencrypt:{utc_date}`, batch 500).
- **Sensitive:** **Secret.** Never exported (M§128), never shown in the backoffice (M§52/§71), never logged.
- **Audit:** `integration.token_revoked` with `details {provider, revocation_mode}`; `credentials.key_rotated` (system, counts only).

#### `oauth_states`
- **Purpose:** Single-use PKCE state for the integration OAuth flow, valid 10 minutes (ADR-07), plus the completion binding of R-07: the callback never finalises alone. The `oauth` callback exchanges the code, stores the result (a `connecting` account with `pending_binding_until`, or a held token set for reconnect/upgrade) and redirects to the app with a one-time `completion_code`. `POST /integrations/oauth/complete {completion_code, device_nonce}` (user JWT) succeeds only when `oauth_states.user_id = auth.uid()`, `sha256(device_nonce) = device_nonce_hash`, `sha256(completion_code) = completion_code_hash`, the state is unexpired and `completed_at is null`; otherwise it is rejected. This prevents connecting a victim's mailbox to an attacker's account.
- **Columns:**
  - ⟨OWN⟩.
  - `state_hash` bytea NN check(octet_length=32). This is sha256 of the opaque 32-byte base64url `state` sent to the provider.
  - `provider` provider NN check(provider in ('google','microsoft')).
  - `purpose` text NN check(in ('connect','upgrade','reauth')).
  - `connected_account_id` uuid.
  - `requested_capabilities` capability[] NN, `requested_scopes` text[] NN.
  - `code_verifier_iv` bytea NN, `code_verifier_ciphertext` bytea NN, `key_version` smallint NN.
  - `nonce_hash` bytea.
  - `return_to` text NN check(return_to ~ '^(dijitalasistan://integrations/callback|https://[a-z0-9.-]+/oauth/done)').
  - `expires_at` timestamptz NN =now()+interval '10 minutes'.
  - `used_at` timestamptz (callback consumed the state).
  - `device_nonce_hash` bytea NN check(octet_length=32): sha256 of the random device nonce the app generated at `start` and keeps in memory and SecureStore (R-07).
  - `completion_code_hash` bytea check(octet_length=32): sha256 of the one-time `completion_code` minted by the callback and carried in the app redirect (never a provider code or token).
  - `approval_id` uuid (progressive-upgrade resume target).
  - `token_ciphertext` bytea, `token_iv` bytea check(token_iv is null or octet_length(token_iv)=12): the reconnect/upgrade token set held (AES-256-GCM, same `key_version`) until completion, then swapped atomically into `oauth_credentials` and nulled, so working tokens are never replaced by unbound ones.
  - `result` text check(in ('pending_confirmation','success','partial','denied','error','account_mismatch','already_linked','plan_limit','admin_consent_required')), `error_code` text.
  - `completed_at` timestamptz (set by `POST /integrations/oauth/complete`).
  - `created_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` cascade. `connected_account_id` → `connected_accounts` cascade. `approval_id` → `approval_actions` set null (added in 0006).
- **Unique:** `(state_hash)`; `(completion_code_hash) where completion_code_hash is not null`.
- **Indexes:** `(expires_at)`.
- **RLS:** **SYS.**
- **Retention:** `retention_cleanup` deletes rows where `expires_at < now()-interval '1 day'`.
- **Sensitive:** The code verifier and any held token set are encrypted; the device nonce and completion code are stored only as hashes.
- **Audit:** Not audited per row. A state reuse attempt (`used_at is not null`) writes `security.oauth_state_replay` (system). A completion with a wrong user, nonce or code writes `security.oauth_binding_mismatch`; an unbound account purged at expiry writes `integration.binding_expired`.

#### `calendars`
- **Purpose:** Provider and device calendar list; the user chooses which calendars are analysed (the "Kişisel", "İş" selection).
- **Columns:**
  - ⟨OWN⟩.
  - `connected_account_id` uuid NN.
  - `provider` provider NN.
  - `provider_calendar_id` text NN.
  - `name` text NN check(char_length ≤200), `color` text check(~ '^#[0-9A-Fa-f]{6}$').
  - `time_zone` text.
  - `access_role` text NN check(in ('owner','writer','reader','free_busy_reader')).
  - `is_primary` boolean NN =false, `selected` boolean NN =true, `can_write` boolean NN =false.
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `connected_account_id` → `connected_accounts` cascade. `user_id` → `auth.users` cascade.
- **Unique:** `(connected_account_id, provider_calendar_id)`.
- **Indexes:** `(user_id, selected)`.
- **RLS:** OWN-R; OWN-U with `grant update (selected)`. `trg_calendars_plan_limit` (`private.enforce_calendar_selection_limit`) enforces `plan_limits.max_calendars` on the count of `selected` rows across all sources (M§44, "1 calendar").
- **Retention:** Deleted when the provider removes the calendar, when the account is disconnected (cascade) and on account deletion.
- **Sensitive:** Calendar names are low-sensitivity PII.
- **Audit:** None.

#### `sync_states`
- **Purpose:** Per (account, resource) cursor, health, backfill window and **watch/subscription** state (M§117; ADR-07; integrations audit A.6–9, B.4).
- **Columns:**
  - ⟨OWN⟩.
  - `connected_account_id` uuid NN.
  - `calendar_id` uuid.
  - `resource` text NN check(in ('gmail_mailbox','graph_mail_inbox','graph_mail_sentitems','google_calendar','graph_calendar_view','google_tasks','todo_list','device_calendar','device_reminders')).
  - `resource_key` text NN ='' (calendar id or task list id).
  - `cursor` text: Gmail `historyId`, Calendar `nextSyncToken`, Graph `deltaLink`, or Tasks `updatedMin` ISO.
  - `status` text NN ='idle' check(in ('idle','running','backfilling','resync_required','error','paused')).
  - `cursor_invalidated_at` timestamptz (Gmail 404 / Calendar 410).
  - `last_full_sync_at`, `last_incremental_sync_at`, `last_success_at` timestamptz.
  - `last_error_code` text, `last_error_at` timestamptz.
  - `consecutive_failures` integer NN =0.
  - `backfill_until` timestamptz (retention cutoff reached), `backfill_cursor` text.
  - `window_start` timestamptz, `window_end` timestamptz (Graph calendarView: today−2d … today+60d), `rebaseline_due_at` timestamptz (daily at 03:00 local).
  - `watch_kind` text NN ='none' check(in ('none','gmail_watch','gcal_channel','graph_subscription')).
  - `watch_id` text (Calendar channel id / Graph subscription id / Gmail topic name).
  - `watch_resource_id` text (Google `resourceId`, needed for `channels.stop`).
  - `watch_token_hash` bytea: HMAC(`WEBHOOK_HMAC_SECRET`, channel_id) for gcal; sha256(clientState) for Graph. Compared in constant time.
  - `watch_history_id` text (Gmail watch response historyId).
  - `watch_expires_at` timestamptz.
  - `watch_renew_after` timestamptz: gmail = +24 h with jitter; gcal = expires − 24 h; graph = expires − 48 h.
  - `lifecycle_last_event` text check(in ('reauthorizationRequired','subscriptionRemoved','missed')), `lifecycle_last_at` timestamptz.
  - `page_token` text (in-flight page of the current full or backfill pass), `next_poll_at` timestamptz (polled resources: Google Tasks / To Do every 15 min).
  - `lease_owner` text, `lease_expires_at` timestamptz (one sync runner per resource).
  - `stats` jsonb NN ='{}' (counts only, e.g. `{messages_seen, messages_new, events_changed}`).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `connected_account_id` → `connected_accounts` cascade. `calendar_id` → `calendars` cascade. `user_id` → `auth.users` cascade.
- **Unique:** `(connected_account_id, resource, resource_key)`; `(watch_kind, watch_id) where watch_id is not null`.
- **Indexes:** `(watch_renew_after) where watch_kind <> 'none'`; `(rebaseline_due_at) where resource='graph_calendar_view'`; `(status) where status in ('error','resync_required')`; `(user_id)`.
- **RLS:** OWN-R with `grant select (id, user_id, connected_account_id, calendar_id, resource, status, last_success_at, last_incremental_sync_at, last_error_code, last_error_at, created_at, updated_at)`. Cursors and watch secrets are hidden. There are no user writes.
- **Retention:** Deleted with the account (cascade).
- **Sensitive:** Cursors and watch token hashes are internal.
- **Audit:** None per row. Watch failures surface in the backoffice Integrations "watch/subscription issue" view (M§52).

#### `connected_account_sync_health` (view)
- **Purpose:** Owner-visible sync freshness per account and resource without exposing cursors or watch secrets (INTEGRATION_PLAN §3.1; device staleness in provenance, KNOWN_PLATFORM_LIMITATIONS).
- **Definition:** `create view public.connected_account_sync_health with (security_invoker = true) as select s.user_id, s.connected_account_id, s.resource, s.status, s.last_success_at, s.last_error_code, extract(epoch from (now() - s.last_success_at))::int as lag_seconds from public.sync_states s;`
- **RLS:** Security invoker, so the `sync_states` owner policy and column grants apply (every selected column is in the `sync_states` select grant). `grant select` to authenticated.
- **Sensitive:** None (no cursors, tokens or watch data).

#### `provider_quota_usage`
- **Purpose:** Token buckets and usage metering per bucket (INTEGRATION_PLAN §3.6; integrations audit A.8, B.6): per-account buckets (`gmail_user_units`, `gcal_user_requests`, `graph_mailbox_requests`, `graph_subscription_ops`) and project-level buckets (`gmail_project_units_day`, `gtasks_project_requests_day`), plus 429 counts.
- **Columns:**
  - `id` bigint generated always as identity.
  - `bucket` text NN check(bucket ~ '^[a-z][a-z0-9_]{2,48}$').
  - `connected_account_id` uuid, `user_id` uuid (both null for project buckets), check((connected_account_id is null) = (user_id is null)).
  - `provider` provider NN.
  - `window_start` timestamptz NN, `window_seconds` integer NN check(between 1 and 86400).
  - `units_used` integer NN =0 check(≥0), `units_limit` integer NN check(>0), `request_count` integer NN =0, `throttled_count` integer NN =0.
  - `updated_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `connected_account_id` → `connected_accounts` cascade. `user_id` → `auth.users` cascade.
- **Unique:** `(bucket, coalesce(connected_account_id, '00000000-0000-0000-0000-000000000000'::uuid), window_start)` (expression unique index).
- **Indexes:** `(window_start)`; `(connected_account_id)`.
- **RLS:** **SYS.** Consumption goes only through `private.consume_provider_quota(bucket, account_id, units, limit, window_seconds) → wait_ms` (0 = admitted). The Graph 4-concurrent-per-mailbox limit is an in-process semaphore, not a column.
- **Retention:** 7 days (`retention_cleanup`).
- **Sensitive:** None.
- **Audit:** None. Aggregates feed `admin_api.integrations_overview`.

#### `webhook_events`
- **Purpose:** Replay dedupe and ingest ledger for provider and RevenueCat webhooks (ADR-04, M§113 webhook forgery).
- **Columns:**
  - `id` bigint identity.
  - `source` text NN check(in ('google_gmail','google_calendar','microsoft_graph','microsoft_lifecycle','revenuecat')).
  - `external_id` text NN check(char_length ≤300).
  - `user_id` uuid (resolved when possible).
  - `connected_account_id` uuid.
  - `signature_valid` boolean NN.
  - `status` text NN ='received' check(in ('received','enqueued','ignored','rejected','failed')).
  - `job_id` uuid.
  - `payload_digest` bytea NN (sha256 of the raw body).
  - `payload` jsonb NN ='{}'. This is minimal and content-free: Gmail `{emailAddress_hash, historyId}`; gcal `{channel_id, resource_state, message_number}`; Graph `{subscriptionId, changeType, resource_id, lifecycleEvent?}`; RevenueCat `{type, app_user_id}`.
  - `received_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` on delete set null. `connected_account_id` → `connected_accounts` on delete set null.
- **Unique:** `(source, external_id)`.
- **Indexes:** `(received_at)`; `(status) where status in ('failed','rejected')`.
- **RLS:** **SYS.**
- **Retention:** 30 days.
- **Sensitive:** None. Emails are hashed and bodies are never stored.
- **Audit:** An invalid signature writes `security.webhook_rejected` (system, source + digest).

---

### 4.3 Content (derived from provider data; **no raw mail body anywhere**, ADR-05, M§87)

#### `email_threads`
- **Purpose:** Thread-level mail intelligence: category, reply state, summary, deadline (M§14, §15, §17).
- **Columns:**
  - ⟨OWN⟩.
  - `connected_account_id` uuid NN.
  - `provider` provider NN.
  - `provider_thread_id` text NN (Gmail `threadId` / Graph `conversationId`).
  - `subject` text check(char_length ≤300).
  - `participants` jsonb NN ='[]' (array ≤50 `{email, name, contact_id, role: from|to|cc}`).
  - `message_count` integer NN =0.
  - `last_message_at` timestamptz NN, `last_inbound_at` timestamptz, `last_outbound_at` timestamptz.
  - `has_unread` boolean NN =false.
  - `category` mail_category, `category_tier` decision_tier, `category_reason` text check(≤300), `category_rule_id` uuid, `category_learned_preference_id` uuid, `category_confidence` numeric(4,3) check(0..1).
  - `urgency` urgency.
  - `reply_state` text NN ='none' check(in ('none','awaiting_my_reply','awaiting_their_reply')).
  - `ai_summary` text check(≤1200).
  - `key_points` jsonb NN ='[]' (array ≤5 `{text ≤200, evidence}`).
  - `deadline_at` timestamptz, `deadline_evidence` jsonb, check(deadline_at is null or jsonb_array_length(deadline_evidence) ≥1). No deadline without a source (M§83).
  - `labels` text[] NN ='{}'.
  - `web_link` text check(web_link ~ '^https://').
  - `is_muted` boolean NN =false.
  - `analysis_hash` bytea, `analyzed_at` timestamptz, `prompt_version_id` uuid.
  - `rolling_summary` text check(≤1200) (thread incrementality: the prior summary is the context, never the whole thread; AI_PIPELINE_PLAN §8.5), `last_processed_message_id` uuid.
  - `follow_up_state` text NN ='none' check(in ('none','waiting','nudge_due','nudged','muted','resolved')): the Smart Follow-Up lifecycle of `reply_state='awaiting_their_reply'` threads ("Takip etme" = `muted`); `reply_state` stays the canonical who-owes-a-reply column.
  - `awaiting_since` timestamptz, `expects_reply_message_id` uuid (the user's sent message that expects an answer).
  - `topic_label` text check(≤60) (short topic for person intelligence "recent topics").
  - `search_tsv` tsvector generated always as (to_tsvector('private.tr_search', coalesce(subject,'')‖' '‖coalesce(ai_summary,''))) stored.
  - ⟨EXP⟩ (anchor `last_message_at`).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `connected_account_id` → `connected_accounts` cascade. `category_rule_id` → `priority_rules` on delete set null. `category_learned_preference_id` → `learned_preferences` set null. `prompt_version_id` → `prompt_versions` set null. `user_id` → `auth.users` cascade.
- **Unique:** `(connected_account_id, provider_thread_id)`.
- **Indexes:** `(user_id, category, last_message_at desc)`; `(user_id, reply_state, last_message_at desc) where reply_state <> 'none'`; `(user_id, deadline_at) where deadline_at is not null`; GIN `(search_tsv)`; `(expires_at) where expires_at is not null`.
- **RLS:** OWN-R with a column grant that excludes `analysis_hash`. No writes (user feedback goes to `ai_feedback`; mute rules go to `priority_rules`).
- **Retention:** R-USER, plus history deletion.
- **Sensitive:** The subject, participants and AI summary are personal content. Admins never see them (M§48) except through a Support Access grant (R-09: scope `email_metadata` for subject, participants and snippet; scope `insights` for AI summaries; §4.9).
- **Audit:** None per row.

#### `email_messages`
- **Purpose:** Message metadata, triage and classification. **There is no body column.** "Orijinal Mail" is fetched on demand through `GET /mail/:messageId/original` and is neither stored nor logged (ADR-05).
- **Columns:**
  - ⟨OWN⟩.
  - `connected_account_id` uuid NN, `thread_id` uuid NN.
  - `provider` provider NN.
  - `provider_message_id` text NN (Gmail id / Graph ImmutableId).
  - `internet_message_id` text (RFC `Message-ID`).
  - `in_reply_to` text, `references_ids` text[] NN ='{}'.
  - `direction` text NN check(in ('inbound','outbound')).
  - `from_email` citext NN, `from_name` text.
  - `to_emails` citext[] NN ='{}', `cc_emails` citext[] NN ='{}'.
  - `subject` text check(≤300).
  - `snippet` text check(char_length(snippet) ≤200).
  - `sent_at` timestamptz, `received_at` timestamptz NN.
  - `is_read` boolean NN =false, `importance` text check(in ('low','normal','high')), `labels` text[] NN ='{}'.
  - `has_attachments` boolean NN =false.
  - `attachment_meta` jsonb NN ='[]' (array ≤20 `{name, mime, size, provider_attachment_id}`; no content).
  - `list_unsubscribe` boolean NN =false, `auto_submitted` boolean NN =false, `precedence_bulk` boolean NN =false.
  - `dkim_pass` boolean, `spf_pass` boolean (anti-phishing for security life events, SREQ-25).
  - `content_hash` bytea NN.
  - `ai_status` text NN ='pending_t0' check(in ('pending_t0','t0_final','skipped_source_control','skipped_budget','skipped_flag','queued_realtime','queued_batch','classified','failed')) (AI_PIPELINE_PLAN §1.4; replaces the former `triage_result`).
  - `injection_suspected` boolean NN =false, `dropped_fields` text[] NN ='{}' (fields removed by the grounding verifier, rendered as "Kaynakta kesinleşmiyor."), `life_signal` text NN ='none' check(in ('none','shipment','flight','reservation','payment','subscription')).
  - `classification` mail_category, `classification_tier` decision_tier, `classification_reason` text check(≤300), `classification_rule_id` uuid, `classification_confidence` numeric(4,3).
  - `ai_summary` text check(≤800), `key_points` jsonb NN ='[]'.
  - `analyzed_at` timestamptz, `prompt_version_id` uuid.
  - `provider_deleted_at` timestamptz (reconciliation).
  - `web_link` text.
  - `search_tsv` tsvector generated (subject‖snippet‖ai_summary via `private.tr_search`) stored.
  - ⟨EXP⟩ (anchor `received_at`).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `thread_id` → `email_threads(id)` cascade. `connected_account_id` → `connected_accounts` cascade. `classification_rule_id` → `priority_rules` set null. `prompt_version_id` → `prompt_versions` set null. `user_id` → `auth.users` cascade.
- **Unique:** `(connected_account_id, provider_message_id)`.
- **Indexes:** `(user_id, received_at desc)`; `(thread_id, received_at)`; `(user_id, content_hash)`; `(user_id, from_email)`; `(internet_message_id) where internet_message_id is not null` (cross-account dedupe and the idempotency check for sends); GIN `(search_tsv)`; `(expires_at)`.
- **RLS:** OWN-R with a column grant that excludes `content_hash`, `references_ids` and `attachment_meta→provider_attachment_id` (the whole `attachment_meta` column stays readable; `api` strips provider ids before returning). No writes.
- **Retention:** R-USER, plus history deletion.
- **Sensitive:** Addresses, subject and snippet are PII/content. Admin views show counts only.
- **Audit:** On-demand original fetches are not audited for the user (it is their own data). A support-access reveal writes `pii.reveal`.

#### `calendar_events`
- **Purpose:** Normalized events from Google, Graph, EventKit and CalendarContract snapshots (M§19–22, §75).
- **Columns:**
  - ⟨OWN⟩.
  - `connected_account_id` uuid NN, `calendar_id` uuid NN.
  - `provider` provider NN.
  - `provider_event_id` text NN. For device events this is `hex(sha256(eventIdentifier‖calendarItemExternalIdentifier))`.
  - `ical_uid` text, `recurring_event_id` text, `etag` text.
  - `title` text check(≤300).
  - `description_excerpt` text check(≤500) (the purpose source for Meeting Prep).
  - `location` text check(≤300), `is_online` boolean NN =false.
  - `conference_url` text check(conference_url ~ '^https://(meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|([a-z0-9-]+\.)?zoom\.us)/'). SREQ-23: allowlisted handoff hosts only.
  - `start_at` timestamptz NN, `end_at` timestamptz NN, check(end_at >= start_at).
  - `all_day` boolean NN =false, `start_date` date, `end_date` date, `time_zone` text.
  - `status` text NN ='confirmed' check(in ('confirmed','tentative','cancelled')).
  - `organizer_email` citext, `organizer_self` boolean NN =false, `can_modify` boolean NN =false.
  - `attendees` jsonb NN ='[]' (≤200 `{email, name, response, self, contact_id}`), `attendee_count` integer NN =0.
  - `origin` text NN check(in ('provider_sync','device_snapshot','demo','approval_write')), `device_last_synced_at` timestamptz.
  - `da_approval_id` uuid (event created by us; reconciliation).
  - `provider_updated_at` timestamptz, `provider_deleted_at` timestamptz.
  - `search_tsv` tsvector generated (title‖location‖description_excerpt) stored.
  - ⟨EXP⟩ (anchor `end_at`).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `calendar_id` → `calendars` cascade. `connected_account_id` → `connected_accounts` cascade. `da_approval_id` → `approval_actions` set null. `user_id` → `auth.users` cascade.
- **Unique:** `(calendar_id, provider_event_id)`.
- **Indexes:** `(user_id, start_at)`; `(user_id, end_at)`; `(start_at) where status <> 'cancelled'` (scheduler meeting-prep scan); GIN `(attendees jsonb_path_ops)`; GIN `(search_tsv)`; `(ical_uid)`; `(expires_at)`.
- **RLS:** OWN-R. No writes; creates and updates go through approvals.
- **Retention:** R-USER anchored on `end_at`. History deletion removes events whose `end_at < now()` and keeps future events.
- **Sensitive:** Attendees and location are PII.
- **Audit:** Writes happen via `approval_actions`, which are audited.

#### `tasks`
- **Purpose:** Google Tasks, Microsoft To Do, Apple Reminders snapshots, and in-app tasks (M§19, §75; SREQ-14).
- **Columns:**
  - ⟨OWN⟩.
  - `connected_account_id` uuid (null = in-app task).
  - `provider` provider, `provider_task_id` text, `provider_list_id` text.
  - `title` text NN check(char_length between 1 and 500).
  - `notes_excerpt` text check(≤1000).
  - `due_date` date, `due_at` timestamptz (in-app only; Google `due` is date-only).
  - `status` item_status NN ='open', `completed_at` timestamptz.
  - `origin` text NN check(in ('provider_sync','user','ai_proposal','capture','approval_write')).
  - `approval_action_id` uuid.
  - `idempotency_key` text.
  - ⟨PROV⟩ columns (**nullable** here), ⟨EVID⟩, check(origin not in ('ai_proposal','capture') or (source_type is not null and confidence is not null)).
  - `search_tsv` generated (title‖notes_excerpt) stored.
  - ⟨EXP⟩ (anchor `coalesce(completed_at, due_at, created_at)`; open tasks are never expired: the `set_expires_at` rule applies only when status ≠ open, and is re-evaluated on update).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `connected_account_id` → `connected_accounts` cascade. `approval_action_id` → `approval_actions` set null. `user_id` → `auth.users` cascade.
- **Unique:** `(connected_account_id, provider_list_id, provider_task_id) where provider_task_id is not null`; `(user_id, idempotency_key) where idempotency_key is not null`.
- **Indexes:** `(user_id, status, due_date)`; `(user_id, due_at) where due_at is not null`; GIN `(search_tsv)`.
- **RLS:**
  - OWN-R.
  - OWN-I with check `connected_account_id is null and origin = 'user' and approval_action_id is null`.
  - OWN-U using `connected_account_id is null` with `grant update (title, notes_excerpt, due_date, due_at, status, completed_at)`.
  - OWN-D using `connected_account_id is null`.
  - Provider tasks are read-only in-app; changing them requires a `task_create` approval (M§115).
- **Retention:** R-USER for completed tasks; open tasks are kept.
- **Sensitive:** Content.
- **Audit:** None (external writes are audited via approvals).

#### `commitments`
- **Purpose:** Detected or user-confirmed promises: "Cuma gönderirim." (M§18, §22).
- **Columns:**
  - ⟨OWN⟩.
  - `contact_id` uuid, `counterparty_name` text check(≤120), check(contact_id is not null or counterparty_name is not null).
  - `direction` commitment_direction NN.
  - `text` text NN check(char_length between 3 and 500).
  - `due_at` timestamptz, `due_is_date_only` boolean NN =false.
  - `status` commitment_status NN ='open'.
  - `snoozed_until` timestamptz, `completed_at` timestamptz, `cancelled_at` timestamptz.
  - `dedupe_key` text NN.
  - `origin` text NN check(in ('email_analysis','post_meeting','capture','assistant','user')).
  - `approval_action_id` uuid, `calendar_event_id` uuid.
  - ⟨PROV⟩, ⟨EVID⟩, check(origin = 'user' or jsonb_array_length(evidence) ≥1). No commitment without a source (M§83).
  - `user_overrides` jsonb NN ='{}' (user corrections `{field: {value, corrected_at}}`; readers apply them over AI values and show "Sen düzelttin"; written only by `submit_ai_correction`, never granted to clients).
  - `search_tsv` generated (text‖counterparty_name).
  - ⟨EXP⟩ (anchor `coalesce(completed_at, cancelled_at, due_at, created_at)`; open ones stay).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `contact_id` → `contacts` set null. `approval_action_id` → `approval_actions` set null. `calendar_event_id` → `calendar_events` set null. `user_id` → `auth.users` cascade.
- **Unique:** `(user_id, dedupe_key)`.
- **Indexes:** `(user_id, status, due_at)`; `(user_id, contact_id)`; `(user_id, direction) where status='open'`; GIN `(search_tsv)`.
- **RLS:**
  - OWN-R.
  - OWN-U with `grant update (status, snoozed_until, due_at, due_is_date_only, completed_at, cancelled_at)` ("Tamamlandı", "Ertele", "Kapat"). Clients use `set_commitment_status` (RPC-06, Pro) or a direct PATCH of these columns.
  - `trg_commitments_status_ts` validates transitions: open↔snoozed, open/snoozed→done/cancelled, done→open (undo).
  - Inserts happen **only** via `approval_execute` (`commitment_create`) or detection with high confidence. Detections below 0.8 confidence become a pending approval instead (M§18, §115).
- **Retention:** R-USER for closed commitments.
- **Sensitive:** Content and person relation.
- **Audit:** Creation via approval is audited through `approval_events`.

#### `reminders`
- **Purpose:** Smart reminders created through the sheet (M§29; SREQ-34/35; C-08).
- **Columns:**
  - ⟨OWN⟩.
  - `title` text NN check(1..200), `note` text check(≤500).
  - `remind_at` timestamptz NN.
  - `preset` text NN check(in ('before_30m','before_1h','this_evening','tomorrow_morning','smart','custom')) (API-REM-01/02; "Uygun zamanda" = `smart`).
  - `anchor_at` timestamptz (the event or deadline a `before_*` preset is relative to), check(preset not in ('before_30m','before_1h') or anchor_at is not null).
  - `destination` jsonb NN ='{"kind":"in_app"}' check(`destination->>'kind' in ('in_app','google_tasks','microsoft_todo','apple_reminders')`); non-`in_app` destinations are created through a `reminder_create`/`task_create` approval (`approval_action_id`) and `channel` records the delivery mechanism.
  - `origin` text NN ='today' check(in ('email_detail','today','deadline','meeting','commitment','life_event','followup','assistant','plan')).
  - `resolution_reason` text check(≤200) (e.g. "Takvimine göre: 12:10").
  - `channel` text NN ='push' check(in ('push','local','provider_task','apple_reminders')).
  - `status` reminder_status NN ='scheduled'.
  - `target_type` text check(in ('email_thread','insight','commitment','life_event','calendar_event','capture','task','follow_up')), `target_id` uuid.
  - `idempotency_key` text NN.
  - `approval_action_id` uuid (external channels), `notification_id` uuid.
  - `delivered_at` timestamptz, `cancelled_at` timestamptz.
  - ⟨PROV⟩ (nullable; default `source_type='user_input'`).
  - ⟨EXP⟩ (anchor `remind_at`).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `approval_action_id` → `approval_actions` set null. `notification_id` → `notifications` set null. `user_id` → `auth.users` cascade.
- **Unique:** `(user_id, idempotency_key)`.
- **Indexes:** `(remind_at) where status='scheduled'` (scheduler); `(user_id, status, remind_at)`.
- **RLS:** OWN-R. Writes go through `api POST /reminders` and `/reminders/:id/cancel`, which confirm the resolved time and check quiet hours.
- **Retention:** R-USER after delivery or cancellation.
- **Sensitive:** Content.
- **Audit:** None (external channels are audited via approvals).

#### `meeting_notes`
- **Purpose:** "Not Al" prep notes and post-meeting text or voice transcripts (SREQ-22, M§22). Audio is **not** stored.
- **Columns:**
  - ⟨OWN⟩.
  - `calendar_event_id` uuid NN.
  - `kind` text NN check(in ('prep_note','post_meeting')).
  - `body` text NN check(char_length between 1 and 10000).
  - `input` text NN check(in ('text','voice_transcript')).
  - `processed_at` timestamptz (commitment proposals generated).
  - ⟨EXP⟩ (anchor `created_at`).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `calendar_event_id` → `calendar_events` cascade. `user_id` → `auth.users` cascade.
- **Unique:** —
- **Indexes:** `(user_id, calendar_event_id, created_at)`.
- **RLS:** OWN-R, OWN-U (`grant update (body)`), OWN-D. Insert goes via `api POST /meetings/:eventId/notes|post` (STT and proposal pipeline).
- **Retention:** R-USER, plus history deletion.
- **Sensitive:** Content.
- **Audit:** None.

#### `meeting_preps`
- **Purpose:** The Meeting Prep artifact and "2 Dakikalık Özet" (M§21).
- **Columns:**
  - ⟨OWN⟩.
  - `calendar_event_id` uuid NN.
  - `status` text NN ='pending' check(in ('pending','generating','ready','failed','stale')).
  - `purpose` text check(≤400), `purpose_evidence` jsonb NN ='[]'.
  - `primary_contact_id` uuid.
  - `last_interaction` jsonb (`{at, summary ≤300, source_type, source_id}`).
  - `recent_email_ids` uuid[] NN ='{}', `open_loops` jsonb NN ='[]'.
  - `user_commitment_ids` uuid[] NN ='{}', `their_commitment_ids` uuid[] NN ='{}'.
  - `relevant_files` jsonb NN ='[]' (only real attachment metadata).
  - `talking_points` jsonb NN ='[]' check(jsonb_array_length ≤3).
  - `summary_2min` text check(≤2500), `reading_time_sec` integer.
  - `sources` jsonb NN ='[]'.
  - `input_hash` bytea, `generated_at` timestamptz, `model` text, `prompt_version_id` uuid, `ai_request_id` uuid.
  - ⟨PROV⟩ (`source_type='calendar_event'`), ⟨EVID⟩.
  - ⟨EXP⟩ (anchor = event `end_at`).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `calendar_event_id` → `calendar_events` cascade. `primary_contact_id` → `contacts` set null. `prompt_version_id` → `prompt_versions` set null. `user_id` → `auth.users` cascade.
- **Unique:** `(user_id, calendar_event_id)`.
- **Indexes:** `(user_id, status)`.
- **RLS:** OWN-R. Generation goes via `api /meetings/:eventId/prep` (Pro gate).
- **Retention:** R-USER, plus history deletion.
- **Sensitive:** Content.
- **Audit:** None.

#### `contacts`
- **Purpose:** People resolved from mail, calendar and manual entry (M§30).
- **Columns:**
  - ⟨OWN⟩.
  - `display_name` text NN check(1..120).
  - `primary_email` citext, `emails` citext[] NN ='{}'.
  - `organization` text check(≤120).
  - `title` text check(≤120), `title_evidence` jsonb (title only if sourced).
  - `avatar_seed` integer NN.
  - `first_seen_at` timestamptz, `last_contact_at` timestamptz, `last_inbound_at` timestamptz, `last_outbound_at` timestamptz.
  - `message_count_30d` integer NN =0, `meeting_count_30d` integer NN =0.
  - `origin` text NN check(in ('mail','calendar','device','manual','capture')).
  - `merged_into_id` uuid.
  - `search_tsv` generated (display_name‖organization‖array_to_string(emails,' ')) stored.
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `merged_into_id` → `contacts(id)` set null. `user_id` → `auth.users` cascade.
- **Unique:** `(user_id, primary_email) where primary_email is not null`.
- **Indexes:** `(user_id, last_contact_at desc)`; GIN `(emails)`; GIN `(private.immutable_unaccent(lower(display_name)) gin_trgm_ops)`; GIN `(search_tsv)`.
- **RLS:**
  - OWN-R.
  - OWN-I with check `origin = 'manual'` (VIP "Kişi Ekle" by email).
  - OWN-U with `grant update (display_name, organization)`.
- **Retention:** No `expires_at`. `retention_cleanup` deletes contacts with no VIP row, no open commitment, `last_contact_at` older than the user's retention cutoff and `origin <> 'manual'`. History deletion applies the same rule with cutoff = now.
- **Sensitive:** PII.
- **Audit:** None.

#### `vip_people`
- **Purpose:** User-marked important people with a relationship group (M§30; SREQ-37).
- **Columns:**
  - ⟨OWN⟩.
  - `contact_id` uuid NN.
  - `relationship` vip_relationship NN ='other'.
  - `always_notify` boolean NN =true, `bypass_quiet_hours` boolean NN =true.
  - `note` text check(≤200).
  - `origin` text NN ='user' check(in ('user','suggestion','onboarding')).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `contact_id` → `contacts` cascade. `user_id` → `auth.users` cascade.
- **Unique:** `(user_id, contact_id)`.
- **Indexes:** `(user_id)`.
- **RLS:** OWN-R, OWN-I, OWN-U (`grant update (relationship, always_notify, bypass_quiet_hours, note)`), OWN-D. `trg_vip_people_plan_limit` enforces `plan_limits.vip_max`.
  - **Entitlement semantics:** Rows may be stored on Free, because the onboarding VIP step (M§34 step 11) persists them. The **effects** (deterministic priority boost, always-notify, quiet-hour bypass) are applied by the priority and notification engines only when `effective_entitlement` is Pro (M§44).
- **Retention:** Account lifetime. It survives history deletion (PRIMARY 7.4: "Korunan: … VIP listesi").
- **Sensitive:** The relationship is personal.
- **Audit:** None.

#### `life_events`
- **Purpose:** Shipment, flight, reservation, payment, subscription and security cards (M§23; C-15).
- **Columns:**
  - ⟨OWN⟩.
  - `type` life_event_type NN.
  - `title` text NN check(1..200).
  - `status` item_status NN ='open', `snoozed_until` timestamptz, `resolved_at` timestamptz.
  - `event_at` timestamptz (ETA / departure / reservation time / security time), `due_at` timestamptz.
  - `payload` jsonb NN ='{}' check(jsonb_typeof(payload)='object'). Typed per type and validated by zod `LifeEventPayload[type]`:
    - shipment `{merchant, carrier, tracking_no, eta_window}`
    - flight `{carrier, flight_no, from, to, depart_at, gate?, checkin_url?}`
    - reservation `{venue, at, party_size?, confirm_url?, address?}`
    - payment `{payee, account_ref_masked?}`
    - subscription `{service, period?, manage_url?}`
    - security `{provider, event, device?, location?}`
  - `amount` numeric(14,2), `currency` char(3), `amount_evidence` jsonb.
    - check((amount is null) = (currency is null))
    - check(amount is null or jsonb_array_length(amount_evidence) ≥1)
    - check(due_at is null or jsonb_array_length(evidence) ≥1)
  - `tracking_url` text check(~ '^https://').
  - `dedupe_key` text NN.
  - `suppressed` boolean NN =false ("Bir Daha Gösterme").
  - `user_overrides` jsonb NN ='{}' (user corrections of amount, date, type or title; applied over AI values; written only by `submit_ai_correction`).
  - ⟨PROV⟩, ⟨EVID⟩.
  - `search_tsv` generated (title‖payload text values) stored.
  - ⟨EXP⟩ (anchor `coalesce(event_at, due_at, created_at)`).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` cascade.
- **Unique:** `(user_id, dedupe_key)`.
- **Indexes:** `(user_id, status, coalesce(event_at, due_at))`; `(user_id, type, created_at desc)`; GIN `(search_tsv)`; `(expires_at)`.
- **RLS:** OWN-R; OWN-U with `grant update (status, snoozed_until, resolved_at, suppressed)` ("Ödendi", "Bendim", "Bir Daha Gösterme").
- **Retention:** R-USER, plus history deletion.
- **Sensitive:** Amounts and masked account refs are **financial**. Security events are sensitive.
- **Audit:** None.

#### `captures`
- **Purpose:** Universal Capture: photo, screenshot, pdf, file, link, text, share (M§27, §28, §85).
- **Columns:**
  - ⟨OWN⟩.
  - `kind` capture_kind NN, `status` capture_status NN ='pending_upload'.
  - `storage_path` text check(storage_path ~ ('^' ‖ user_id ‖ '/[0-9a-f-]{36}/[^/]{1,120}$')). This uses a trigger check because a check constraint cannot reference other columns via `~` concatenation portably. It lives in the `captures` bucket.
  - `mime_type` text check(in ('image/jpeg','image/png','image/heic','image/heif','image/webp','application/pdf','text/plain')).
  - `size_bytes` integer check(between 1 and 20971520).
  - `sha256` bytea, `original_filename` text check(≤200).
  - `source_url` text check(source_url ~ '^https://' and char_length ≤2048), `final_url` text.
  - `text_content` text check(≤20000) (text/link-extracted text, derived).
  - `page_count` smallint.
  - `extracted` jsonb NN ='[]' (array ≤20 `{entity_type, fields, evidence, confidence}`), `extracted_types` extracted_entity_type[] NN ='{}', `primary_type` extracted_entity_type.
  - `share_origin` text NN ='in_app' check(in ('in_app','ios_share','android_send','assistant','today')).
  - `progress` jsonb NN ='{}' (real analysis steps and counters, e.g. `{step:'ocr', pages_done:3, pages_total:14}`; polled by the client, R-19).
  - `file_deleted_at` timestamptz (set when the worker deletes the original object; the row and its extracted data follow retention).
  - `idempotency_key` text NN.
  - `error_code` text, `analyzed_at` timestamptz, `ai_request_id` uuid.
  - `search_tsv` generated (original_filename‖text_content) stored.
  - ⟨EXP⟩ (anchor `created_at`).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` cascade.
- **Unique:** `(user_id, idempotency_key)`.
- **Indexes:** `(user_id, created_at desc)`; `(status, created_at) where status in ('pending_upload','uploaded','analyzing')` (`pending_upload` rows older than 1 h are discarded by `retention_cleanup`); GIN `(search_tsv)`; `(expires_at)`.
- **RLS:** OWN-R; OWN-U with `grant update (status)` and `with check (status = 'discarded')`. Creation, analysis and actions go through `api` (Pro gate; SSRF-safe fetcher).
- **Retention:** R-USER. `retention_cleanup` returns `storage_path` values so the worker can delete objects through the Storage API. Rows are discarded after 7 days.
- **Sensitive:** Files may contain anything (IDs, bills). Private bucket, 300 s signed URLs.
- **Audit:** None. Support Access scope `captures` shows extracted fields only, never the file (R-09); each view writes `pii.reveal`.

#### `android_notification_signals`
- **Purpose:** **Structured, on-device-extracted** signals only. The raw notification title/text is never uploaded (ADR-12, M§36, C-12).
- **Columns:**
  - ⟨OWN⟩.
  - `installation_id` uuid NN.
  - `package_name` text NN check(~ '^[a-zA-Z0-9_.]{3,200}$'), `app_label` text check(≤80).
  - `category` text NN check(in ('cargo','bank_payment','flight','reservation','other')).
  - `amount` numeric(14,2), `currency` char(3), `due_date` date.
  - `tracking_status` text check(in ('created','in_transit','out_for_delivery','delivered','exception')).
  - `flight_no` text check(~ '^[A-Z0-9]{2}\d{1,4}$'), `gate` text check(≤8).
  - `posted_at` timestamptz NN.
  - `signal_hash` bytea NN.
  - `life_event_id` uuid.
  - ⟨EXP⟩ (anchor `posted_at`).
  - `created_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `installation_id` → `app_installations` cascade. `life_event_id` → `life_events` set null. `user_id` → `auth.users` cascade.
- **Unique:** `(user_id, signal_hash)`.
- **Indexes:** `(user_id, posted_at desc)`.
- **RLS:** OWN-R, OWN-D (the user may delete single signals or all of them, M§40 transparency). Insert only via `api POST /android-notifications/signals` (Pro, flag `feature.android_ni`, denylist re-checked server-side).
- **Retention:** R-USER capped at 30 days (`expires_at = least(policy, posted_at + 30 d)`).
- **Sensitive:** Financial amounts.
- **Audit:** Enable and disable are logged as analytics `ni_enabled`/`ni_disabled` (not audit).

---

### 4.4 Intelligence

#### `priority_rules`
- **Purpose:** Explicit rules, the first tier of the priority engine (M§31; C-20; PRIMARY 7.9–7.12).
- **Columns:**
  - ⟨OWN⟩.
  - `condition_type` rule_condition NN.
  - `condition_value` jsonb NN check(`private.valid_rule_condition(condition_type, condition_value)`):
    - person `{contact_id}`
    - domain `{domain}` (regex `^[a-z0-9.-]+\.[a-z]{2,}$`)
    - keyword `{keywords: text[1..10]}`
    - category `{category: mail_category|'promotions'}`
    - sender `{address}`
    - android_app `{package}` (regex `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$`; used with `applies_to='android_notification'`, M-ANI-03)
  - `outcome` rule_outcome NN.
  - `search_body` boolean NN =false ("Konu ve gövdede ara"; body is searched transiently during triage).
  - `exceptions` jsonb NN ='[]'.
  - `applies_to` text NN ='mail' check(in ('mail','android_notification','all')) (SREQ-62).
  - `enabled` boolean NN =true, `sort_order` integer NN =0.
  - `match_count_30d` integer NN =0, `last_matched_at` timestamptz.
  - `deleted_at` timestamptz.
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` cascade.
- **Unique:** `(user_id, condition_type, md5(condition_value::text), outcome) where deleted_at is null` (expression unique index).
- **Indexes:** `(user_id, enabled) where deleted_at is null`.
- **RLS:** OWN-R, OWN-I, OWN-U (`grant update (condition_value, outcome, search_body, exceptions, applies_to, enabled, sort_order, deleted_at)`). No delete grant; delete is soft. Saving a rule is not an approval item (PRIMARY 7.10). `trg_priority_rules_plan_limit` enforces `plan_limits.priority_rules_max` on non-deleted rows.
- **Retention:** Account lifetime. Soft-deleted rows are purged after 30 days. **Survives history deletion.**
- **Sensitive:** Contact/domain references.
- **Audit:** None (a user preference).

#### `learned_preferences`
- **Purpose:** AI-learned personalization, separate from explicit rules (M§32; SREQ-72/76).
- **Columns:**
  - ⟨OWN⟩.
  - `group_key` text NN check(in ('people','topics','timing','tone','categories')).
  - `statement` text NN check(1..200).
  - `target_type` text NN check(in ('contact','sender','domain','category','topic','setting')), `target_ref` text NN.
  - `effect` jsonb NN (`{priority:'high'|'normal'|'low'}` | `{reminder_offset_min:int}` | `{tone:…}`).
  - `priority_override` text check(in ('high','normal','low')).
  - `evidence_count` integer NN =0, `evidence_summary` text check(≤200) (e.g. "3 kez 'önemli değil' dedin").
  - `origin` text NN ='learned' check(in ('learned','user','onboarding','settings')).
  - `enabled` boolean NN =true.
  - `deleted_at` timestamptz.
  - ⟨PROV⟩ (`source_type='ai_feedback'`, `source_id` = aggregate key).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` cascade.
- **Unique:** `(user_id, target_type, target_ref, group_key)`. Tombstones are included, so a deleted preference is never re-learned.
- **Indexes:** `(user_id, enabled) where deleted_at is null`.
- **RLS:** OWN-R; OWN-U with `grant update (enabled, priority_override, deleted_at)`. Writes come from the worker, and only when `learn_from_interactions=true` (checked in `private.upsert_learned_preference`).
- **Retention:** Deleted by history deletion (including tombstones) and on account deletion.
- **Sensitive:** Behavioural profile.
- **Audit:** None.

#### `insights`
- **Purpose:** Every user-facing AI or deterministic finding (Today, Flow, follow-ups, conflicts, schedule suggestions) (M§8, §13, §17, §20, §131).
- **Columns:**
  - ⟨OWN⟩.
  - `kind` insight_kind NN, `urgency` urgency NN ='normal'.
  - `status` item_status NN ='open'.
  - `title` text NN check(1..200), `body` text check(≤600).
  - `why_important` text check(≤300).
  - `decision_tier` decision_tier NN, `reason_code` text NN check(~ '^[a-z_]{3,48}$').
  - `rule_id` uuid, `learned_preference_id` uuid.
  - `entity_type` text NN check(in ('email_thread','email_message','calendar_event','commitment','life_event','task','capture','approval_action','contact','briefing')), `entity_id` uuid NN.
  - `flow_card_type` flow_card_type.
  - `actions` jsonb NN ='[]' check(jsonb_array_length ≤2). Items are `{action_type, target_id, requires_approval}` (SREQ-89).
  - `due_at` timestamptz, `event_at` timestamptz.
  - `rank_score` numeric(8,4) NN =0.
  - `snoozed_until` timestamptz, `done_at` timestamptz, `dismissed_at` timestamptz.
  - `suppression_key` text (conflict pair hash, SREQ-20).
  - `user_overrides` jsonb NN ='{}' (user corrections of `due_at` / `title`; applied over AI values; written only by `submit_ai_correction`).
  - `dedupe_key` text NN.
  - ⟨PROV⟩, ⟨EVID⟩.
  - ⟨EXP⟩ (anchor `coalesce(event_at, due_at, created_at)`).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `rule_id` → `priority_rules` set null. `learned_preference_id` → `learned_preferences` set null. `user_id` → `auth.users` cascade.
- **Unique:** `(user_id, dedupe_key)`.
- **Indexes:** `(user_id, urgency, rank_score desc) where status='open'`; `(user_id, kind, created_at desc)`; `(user_id, due_at) where status in ('open','snoozed')`; `(user_id, entity_type, entity_id)`; `(user_id, suppression_key) where suppression_key is not null`; `(snoozed_until) where status='snoozed'`; `(expires_at)`.
- **RLS:** OWN-R; OWN-U with `grant update (status, snoozed_until, done_at, dismissed_at)`. The client uses the `set_insight_status` RPC (security invoker, validates transitions and writes feedback).
- **Retention:** R-USER, plus history deletion. `status='expired'` is set by `insight_refresh` when a due or event time passes.
- **Sensitive:** Derived content.
- **Audit:** None.

#### `briefings`
- **Purpose:** Morning, midday, evening and weekly briefings, including audio and weekly stats (M§9–12, §54; SREQ-07).
- **Columns:**
  - ⟨OWN⟩.
  - `kind` briefing_kind NN, `local_date` date NN, `time_zone` text NN.
  - `scheduled_for` timestamptz NN.
  - `status` briefing_status NN ='scheduled'.
  - `skipped_reason` text check(in ('no_meaningful_delta','disabled','not_entitled','no_sources','weekday_off','flag_off')).
  - `generated_at`, `delivered_at`, `opened_at`, `failed_at` timestamptz, `error_code` text.
  - `headline` text check(≤200), `hero_line` text check(≤200).
  - `narrative` text check(≤3000).
  - `sections` jsonb NN ='[]' (ordered keys per kind; M§9 labels are rendered by i18n).
  - `counts` jsonb NN ='{}', `provenance` jsonb NN ='{}' (`{mail_count, calendar_count, lookback_hours, generated_at}`).
  - `audio_status` text NN ='none' check(in ('none','queued','generating','ready','failed')), `audio_engine` text check(in ('premium_tts','native_tts')), `audio_storage_path` text (`{user_id}/{briefing_id}/{version}.mp3` in `briefing-audio`, one object per version), `audio_duration_s` integer, `audio_chapters` jsonb NN ='[]'.
  - `evening_ready_at` timestamptz ("Yarına Hazırım").
  - `origin` text NN ='scheduled' check(in ('scheduled','onboarding','retry')) (`retry` = "Tekrar Dene" after dead-letter or an admin regenerate; the same row is reused, so `(user_id, kind, local_date)` stays unique).
  - `version` integer NN =1 (bumped on every regeneration; the audio path and audio cache key include it).
  - `source_freshness` jsonb NN ='{}' (`{connected_account_id: {provider, last_success_at, stale}}` at generation; device calendars show their last sync in provenance).
  - `weekly_stats` jsonb (weekly only: `{mails_analyzed, important_count, meetings, followups, deadlines, time_saved_min, time_saved_basis}`; check((kind='weekly') or weekly_stats is null)).
  - `idempotency_key` text NN.
  - `job_id` uuid, `prompt_version_id` uuid.
  - `ai_cost_usd_micros` bigint NN =0, `latency_ms` integer.
  - ⟨EXP⟩ (anchor `scheduled_for`).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `prompt_version_id` → `prompt_versions` set null. `user_id` → `auth.users` cascade.
- **Unique:** `(user_id, kind, local_date)`; `(idempotency_key)`.
- **Indexes:** `(user_id, kind, local_date desc)`; `(status, scheduled_for)`; `(kind, status, local_date)` (backoffice M§54).
- **RLS:** OWN-R; OWN-U with `grant update (opened_at)`. Carry-over goes via `api /briefings/:id/evening-ready`.
- **Retention:** R-USER, plus history deletion. Audio objects are deleted with the row.
- **Sensitive:** Narrative content.
- **Audit:** None. Admin "regenerate" → `briefing.regenerated` (reason).

#### `briefing_items`
- **Purpose:** The source-linked lines of a briefing (M§9, §97).
- **Columns:**
  - ⟨OWN⟩.
  - `briefing_id` uuid NN.
  - `section` text NN check(in ('priorities','schedule','awaiting_me','awaiting_them','deadlines','life','completed','carry_over','follow_up','tomorrow_first','midday_delta','weekly_highlight','weekly_outlook')).
  - `position` smallint NN.
  - `insight_id` uuid.
  - `entity_type` text NN, `entity_id` uuid NN.
  - `title` text NN check(≤200), `meta` text check(≤200), `badge` text check(in ('urgent','deadline','follow_up','meeting','today','shipment','flight','reservation','payment','subscription','security','personal','commitment')).
  - `carried_over_to` date, `done_at` timestamptz.
  - ⟨PROV⟩, ⟨EVID⟩.
  - ⟨EXP⟩ (same as the parent).
  - `created_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `briefing_id` → `briefings` cascade. `insight_id` → `insights` set null. `user_id` → `auth.users` cascade.
- **Unique:** `(briefing_id, section, position)`.
- **Indexes:** `(briefing_id)`; `(user_id, entity_type, entity_id)`.
- **RLS:** OWN-R.
- **Retention:** R-USER, plus history deletion.
- **Sensitive:** Content.
- **Audit:** None.

#### `reply_drafts`
- **Purpose:** AI reply and follow-up drafts. They are **not** provider drafts: there is no `gmail.compose` (ADR-07; M§16, §17).
- **Columns:**
  - ⟨OWN⟩.
  - `thread_id` uuid NN, `message_id` uuid, `connected_account_id` uuid NN.
  - `kind` text NN ='reply' check(in ('reply','follow_up')).
  - `tone` text NN check(in ('short','professional','friendly','detailed')) (Kısa/Profesyonel/Samimi/Detaylı).
  - `to_emails` citext[] NN, `cc_emails` citext[] NN ='{}'.
  - `subject` text check(≤300), `body` text NN check(1..10000).
  - `version` integer NN =1.
  - `status` text NN ='draft' check(in ('draft','submitted','sent','discarded','failed')).
  - `generated_by` text NN check(in ('ai','user_edit')).
  - `approval_action_id` uuid, `ai_request_id` uuid, `prompt_version_id` uuid.
  - `attachments` jsonb NN ='[]' (array ≤5 `{storage_path, name, mime, size}`; objects in the `captures` bucket under `{user_id}/replies/{draft_id}/`, total ≤20 MB; listed in the approval's `exact_change`).
  - ⟨PROV⟩ (`source_type='email_thread'`).
  - ⟨EXP⟩ (anchor `updated_at`; capped at 30 days for status draft/discarded).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `thread_id` → `email_threads` cascade. `message_id` → `email_messages` set null. `connected_account_id` → `connected_accounts` cascade. `approval_action_id` → `approval_actions` set null. `user_id` → `auth.users` cascade.
- **Unique:** `(approval_action_id) where approval_action_id is not null`.
- **Indexes:** `(user_id, thread_id, created_at desc)`.
- **RLS:** OWN-R. Edits go via `PATCH /reply-drafts/:id` (re-validation, new version).
- **Retention:** As in ⟨EXP⟩, plus history deletion.
- **Sensitive:** User-authored content.
- **Audit:** Submission creates an approval, which is audited.

#### `approval_actions`
- **Purpose:** Every side-effecting action proposed by AI or the user (M§33, §115; ADR-09; C-06/07/08/16).
- **Columns:**
  - ⟨OWN⟩.
  - `action_type` approval_action_type NN.
  - `status` approval_status NN ='pending'.
  - `payload` jsonb NN (zod `ApprovalPayload[action_type]`), `payload_version` integer NN =1, `payload_hash` bytea NN.
  - `what` text NN check(≤200), `why` text check(≤300), `change_summary` text NN check(≤500).
  - `side_effects` jsonb NN ='[]' (e.g. `["attendees_notified"]`).
  - `destination_account_id` uuid, `destination_label` text (masked account).
  - `idempotency_key` text NN, `provider_idempotency_ref` text (Message-ID / base32hex event id / transactionId).
  - `origin` text NN check(in ('reply_draft','assistant','voice','capture','plan_proposal','conflict_resolution','post_meeting','email_detail','life_event','follow_up','reminder_sheet','commitment_detection')), `origin_ref_id` uuid.
  - `requires_scope` text (progressive auth needed).
  - `approved_via` approval_via (R-03: `approval_center | inline_sheet | voice_card | capture_batch | in_place`; every value is a tap. A spoken "onayla" never approves: voice shows the card with "Onaylamak için karta dokun."). C-06 inline "Kaydet" = `in_place`.
  - `exact_change` jsonb NN ='{}' (the M§33 "exact change" the card shows: fields before → after, recipients, attachments; computed by the server at proposal).
  - `batch_id` uuid (groups a capture batch or multi-action sheet, "Onaylandı · 3 işlem").
  - `executor` text NN ='server' check(in ('server','device')), `device_installation_id` uuid, check(executor = 'server' or device_installation_id is not null), `device_token_hash` bytea check(device_token_hash is null or octet_length(device_token_hash)=32) (sha256 of the one-time execution token handed to that installation; `POST /approvals/:id/device-execution` must present it; R-18).
  - `approval_expires_at` timestamptz NN =now()+interval '72 hours'.
  - `approved_at`, `rejected_at` timestamptz, `rejection_reason` text check(in ('user_reject','user_cancel')).
  - `executing_at`, `executed_at`, `failed_at` timestamptz.
  - `attempt_count` smallint NN =0, `last_error_code` text, `last_error_message` text check(≤300).
  - `result` jsonb (provider ids, web link).
  - ⟨PROV⟩, ⟨EVID⟩.
  - ⟨EXP⟩ (anchor `coalesce(executed_at, rejected_at, created_at)`; pending rows never expire through retention).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `destination_account_id` → `connected_accounts` set null. `device_installation_id` → `app_installations(id)` set null. `user_id` → `auth.users` cascade.
- **Unique:** `(idempotency_key)`.
- **Indexes:** `(user_id, status, created_at desc)`; `(approval_expires_at) where status='pending'`; `(status) where status in ('approved','executing','failed')`; `(executing_at) where status='executing' and executor='device'`; `(user_id, batch_id) where batch_id is not null`.
- **RLS:** OWN-R. **No user writes.** Clients never insert approvals; they propose them through `api` (§5b). `trg_approval_actions_guard` rejects any change to `status`, `payload`, `payload_version`, `idempotency_key`, `exact_change`, `executor` or `device_installation_id` unless `current_setting('da.approval_tx', true) = 'on'`, which only `private.transition_approval` and `private.edit_approval_payload` set with `set_config(..., true)`.
- **Retention:** R-USER (P-04: history retention follows the user's setting; the UI copy is bound to `{retention}`). Also removed by history deletion (non-pending only).
- **Sensitive:** The payload contains mail text and attendee emails.
- **Audit:** Every transition writes `approval_events`. `executed`/`failed` also write `audit_logs` (`approval.executed`, actor worker, target approval id, **no payload**).

#### `approval_events`
- **Purpose:** Immutable transition history of approvals (M§33 idempotency proof).
- **Columns:**
  - `id` bigint identity.
  - `user_id` uuid NN.
  - `approval_action_id` uuid NN.
  - `from_status` approval_status, `to_status` approval_status NN.
  - `actor` text NN check(in ('user','system','worker','admin')), `actor_id` uuid.
  - `payload_version` integer NN, `idempotency_key` text NN.
  - `reason` text check(≤300).
  - `correlation_id` uuid.
  - `created_at` timestamptz NN =clock_timestamp().
- **PK:** `id`.
- **FKs:** `approval_action_id` → `approval_actions` cascade. `user_id` → `auth.users` cascade.
- **Unique:** —
- **Indexes:** `(approval_action_id, id)`.
- **RLS:** OWN-R. Append-only (§3.6).
- **Retention:** Deleted with the parent row.
- **Sensitive:** None (no payload).
- **Audit:** It is itself an audit trail.

#### `assistant_threads`
- **Purpose:** Assistant conversations, global or person-scoped ("Mehmet hakkında sor…", SREQ-38).
- **Columns:**
  - ⟨OWN⟩.
  - `title` text check(≤120).
  - `scope` text NN ='global' check(in ('global','person','meeting')), `scope_ref_id` uuid.
  - `last_message_at` timestamptz, `message_count` integer NN =0.
  - `archived_at` timestamptz.
  - ⟨EXP⟩ (anchor `last_message_at`, recomputed on each message).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` cascade.
- **Unique:** —
- **Indexes:** `(user_id, last_message_at desc)`.
- **RLS:** OWN-R, OWN-U (`grant update (title, archived_at)`), OWN-D. Create goes via `api`.
- **Retention:** R-USER, plus history deletion.
- **Sensitive:** Conversation.
- **Audit:** None.

#### `assistant_messages`
- **Purpose:** Messages with citations and proposed actions (M§24, §25).
- **Columns:**
  - ⟨OWN⟩.
  - `thread_id` uuid NN.
  - `role` text NN check(in ('user','assistant')).
  - `content` text NN check(≤8000).
  - `cards` jsonb NN ='[]', `citations` jsonb NN ='[]' (`{source_type, source_id, memory_chunk_id, title}`).
  - `proposed_approval_ids` uuid[] NN ='{}', `followup_suggestions` jsonb NN ='[]'.
  - `status` text NN ='complete' check(in ('streaming','complete','failed','refused')).
  - `grounded` boolean NN =false.
  - `input_channel` text NN ='text' check(in ('text','voice')).
  - `model` text, `prompt_version_id` uuid, `ai_request_id` uuid.
  - ⟨EXP⟩.
  - `created_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `thread_id` → `assistant_threads` cascade. `user_id` → `auth.users` cascade.
- **Unique:** —
- **Indexes:** `(thread_id, created_at)`.
- **RLS:** OWN-R. Delete happens by thread cascade.
- **Retention:** R-USER, plus history deletion.
- **Sensitive:** **Conversation content.** Never sent to analytics (M§42) and hidden from admins (M§48) unless Support Access scope `assistant_transcript` is granted (R-09).
- **Audit:** None.

#### `memory_chunks`
- **Purpose:** The derived retrieval index: AI memory plus hybrid search (M§26, §95; ADR-08). **No full bodies.**
- **Columns:**
  - ⟨OWN⟩.
  - ⟨PROV⟩.
  - `chunk_kind` text NN check(in ('email_summary','thread_summary','key_point','event','commitment','life_event','capture_extract','meeting_note','person_fact','briefing_fact')).
  - `content` text NN check(1..2000), `content_hash` bytea NN.
  - `embedding` vector(1024) (R-01: Voyage `voyage-4` for documents, `voyage-4-lite` for queries, one shared 1024-d space), `embedding_model` text (e.g. `voyage-4@1024`), `embedded_at` timestamptz.
  - `embedding_dr` vector(1024): null except during a disaster-recovery re-embed with OpenAI `text-embedding-3-small` (`dimensions:1024`, ADR-45); its HNSW index is created only by that runbook.
  - `tsv` tsvector generated always as (to_tsvector('private.tr_search', content)) stored.
  - `page_no` integer.
  - `contact_ids` uuid[] NN ='{}'.
  - `occurred_at` timestamptz NN.
  - ⟨EXP⟩ (anchor `occurred_at`).
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` cascade. The source is polymorphic via ⟨PROV⟩; `retention_cleanup` and `private.purge_source(source_type, source_id)` delete dependents.
- **Unique:** `(user_id, source_type, source_id, chunk_kind, content_hash)`.
- **Indexes:**
  - HNSW `memory_chunks_embedding_hnsw on memory_chunks using hnsw (embedding extensions.vector_cosine_ops) with (m = 16, ef_construction = 64)`.
  - GIN `(tsv)`; `(user_id, occurred_at desc)`; `(user_id, source_type, source_id)`; GIN `(contact_ids)`; `(embedded_at) where embedding is null`; `(expires_at)`.
- **RLS:** OWN-R with a column grant that **excludes `embedding` and `embedding_dr`**. Search goes through `search_user_content`. Writes come from the worker.
- **Retention:** R-USER, plus history deletion. Embeddings are always deleted with the row (M§41).
- **Sensitive:** Derived facts.
- **Audit:** None.

#### `ai_feedback`
- **Purpose:** 👍/👎, "Önemli değil" and correction signals (M§32, §59; SREQ-04/83). `learned_preferences` are derived from these rows only through `private.upsert_learned_preference` and only while `learn_from_interactions=true`.
- **Columns:**
  - ⟨OWN⟩.
  - `feature` ai_feature NN.
  - `target_type` text NN check(in ('insight','email_thread','email_message','briefing','briefing_item','assistant_message','reply_draft','meeting_prep','capture','approval_action','learned_preference','life_event','commitment')), `target_id` uuid NN.
  - `rating` smallint NN check(in (-1,1)) (−1 for `not_important`, `wrong_*`, `not_a_commitment`, `inaccurate`, `stop_tracking`, `never_show`; +1 for `helpful`, `show_more`, `make_vip`).
  - `reason_code` text check(in ('not_important','wrong_category','wrong_date','wrong_person','wrong_amount','wrong_type','not_a_commitment','inaccurate','show_more','make_vip','stop_tracking','never_show','helpful','other')). The briefing "yararlı / yararlı değil" feedback maps to `helpful` / `inaccurate` with `target_type='briefing'`.
  - `comment` text check(≤500).
  - `detail` jsonb NN ='{}' (structural only, never free text: e.g. `{field:'due_at'}`, `{from_category, to_category}`).
  - `client_mutation_id` uuid (offline replay key of `apply_insight_feedback`).
  - `model` text, `prompt_version_id` uuid, `ai_request_id` uuid.
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `prompt_version_id` → `prompt_versions` set null. `user_id` → `auth.users` cascade.
- **Unique:** `(user_id, feature, target_type, target_id)` (upsert changes the vote); `(user_id, client_mutation_id) where client_mutation_id is not null`.
- **Indexes:** `(feature, created_at)`; `(prompt_version_id)`.
- **RLS:** OWN-R, OWN-I, OWN-U (`grant update (rating, reason_code, comment)`), OWN-D.
- **Retention:** 365 days; history deletion; account deletion.
- **Sensitive:** `comment` is free text (hidden in the backoffice; revealed only with `ai_feedback.reveal` or Support Access scope `ai_feedback`, audited, M§59).
- **Audit:** None.

#### `ai_requests`
- **Purpose:** Per-call AI telemetry **without content** (ADR-08, M§56, §82): one row per provider attempt, plus zero-cost rows for `cached`, `budget_blocked` and `killed` outcomes (AI_PIPELINE_PLAN §15.4).
- **Columns:**
  - `id` uuid =gen_random_uuid().
  - `user_id` uuid.
  - `plan` text check(in ('free','pro')), `profile` routing_profile.
  - `feature` ai_feature NN, `tier` ai_tier.
  - `provider` text NN check(in ('anthropic','openai','voyage','deepgram','azure_speech','elevenlabs','fixture','native')).
  - `model` text NN, `prompt_version_id` uuid, `schema_name` text, `schema_hash` text, `feature_variant` text check(char_length ≤40) (e.g. `tones_4`, `single_tone`, `vision`, `pdf`).
  - `operation` text NN check(in ('generate','embed','transcribe','synthesize','probe')).
  - `batch` boolean NN =false, `batch_id` text.
  - `status` text NN check(in ('ok','error','refused','timeout','budget_blocked','killed','cached','validation_failed','grounding_partial','grounding_failed')), `error_code` text (AI_PIPELINE_PLAN `ai_error_code` vocabulary), `http_status` smallint, `provider_request_id` text.
  - `input_tokens` integer NN =0, `output_tokens` integer NN =0, `cache_read_tokens` integer NN =0, `cache_write_tokens` integer NN =0 (5-minute TTL), `cache_write_1h_tokens` integer NN =0, `reasoning_tokens` integer NN =0.
  - `audio_seconds` numeric(10,2), `characters` integer.
  - `units_charged` smallint NN =0 (Free "AI analiz" units, §6.5).
  - `latency_ms` integer NN, `ttft_ms` integer.
  - `retry_count` smallint NN =0, `fallback_used` boolean NN =false, `fallback_from_model` text, `inference_geo` text.
  - `cost_usd_micros` bigint NN =0 (computed from `ai_model_prices`).
  - `source_type` source_type, `source_count` smallint, `content_hash` bytea (the per-user HMAC used by `ai_result_cache`; never plaintext).
  - `grounding_proposed` smallint, `grounding_verified` smallint, `grounding_dropped` smallint, `citation_coverage` numeric(4,3), `injection_suspected` boolean NN =false.
  - `correlation_id` uuid, `job_id` uuid.
  - `created_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` **on delete set null** (anonymized cost history). `prompt_version_id` → `prompt_versions` set null.
- **Unique:** —
- **Indexes:** `(created_at)`; `(feature, created_at)`; `(model, created_at)`; `(provider, model, created_at) where status in ('error','timeout')` (circuit breaker); `(user_id, created_at) where user_id is not null`; `(correlation_id)`.
- **RLS:** **SYS.**
- **Retention:** 180 days raw (aggregates stay in `ai_usage_daily` and `ai_metrics_daily`).
- **Sensitive:** None. No prompt, output, subject, name or address is ever stored (M§126).
- **Audit:** None.

#### `ai_usage_daily`
- **Purpose:** Per-user budget accounting on the user's **local** day (Free visible "AI analiz limiti 50/gün"; Pro "Adil kullanım", never "Sınırsız", C-10) and cost rollups.
- **Columns:**
  - `user_id` uuid NN, `local_date` date NN (the date in `user_preferences.timezone`; units reset at local midnight), `feature` ai_feature NN.
  - `requests` integer NN =0.
  - `input_tokens` bigint NN =0, `output_tokens` bigint NN =0, `cache_read_tokens` bigint NN =0, `cache_write_tokens` bigint NN =0.
  - `cost_usd_micros` bigint NN =0.
  - `units_used` integer NN =0.
  - `reserved_usd_micros` bigint NN =0 check(≥0), `reserved_units` integer NN =0 check(≥0) (open holds, §6.5).
  - `updated_at` timestamptz NN =now().
- **PK:** `(user_id, local_date, feature)`.
- **FKs:** `user_id` → `auth.users` cascade.
- **Unique:** PK.
- **Indexes:** `(local_date)`.
- **RLS:** OWN-R (the remaining quota is shown through `get_usage_summary`). Writes come only from `private.ai_budget_reserve` and `private.ai_budget_settle`.
- **Retention:** 400 days.
- **Sensitive:** None.
- **Audit:** None.

#### `ai_model_config`
- **Purpose:** Backoffice-editable model routing per routing profile, role and feature (R-02, R-18; AI_PIPELINE_PLAN §3.3–3.6). **No secrets** (M§57, §81). Model IDs appear only here, in `ai_model_prices` and in their seed files, so replacing a retiring model (Haiku 4.5: "not sooner than 2026-10-15") is a config change, never a code change.
- **Columns:**
  - `id` uuid =gen_random_uuid().
  - `profile` routing_profile NN ='balanced' (R-18; a user runs on `plan_limits.ai_routing_profile` of their effective plan).
  - `role` text NN check(in ('classifier','reasoning','assistant','embedding','stt','tts','probe')): the model slot. Most features have one slot; `capture_extract` has `classifier` (text/link, T1) and `reasoning` (vision and PDF, T2 with T3 escalation).
  - `feature` ai_feature NN.
  - `tier` ai_tier NN.
  - `provider` text NN check(in ('anthropic','openai','voyage','deepgram','azure_speech','elevenlabs','fixture','native')), `model` text NN check(char_length between 1 and 120): together the **primary target**.
  - `params` jsonb NN ='{}' (`effort`, `thinking`, `max_output_tokens`, `timeout_ms`, `input_type` for embeddings; validated by zod `ModelTargetParams`: no sampling params or prefill on Sonnet 5 / Opus 5.5, no `effort` on Haiku).
  - `fallback_targets` jsonb NN ='[]' (ordered array ≤4 of `{provider, model, params}`; the T0 path is the implicit last step).
  - `escalation_target` jsonb (T3 `{provider, model, params}`, used only while flag `ai.model.opus_escalation` is on).
  - `batch_policy` text NN ='never' check(in ('never','non_urgent','always')).
  - `cache_ttl` text check(in ('5m','1h')).
  - `max_input_tokens` integer NN check(between 1 and 200000).
  - `eval_status` text NN ='missing' check(in ('passed','failed','missing')) (for the primary target and the active prompt version).
  - `retires_not_before` date (provider-announced retirement; System Health shows a countdown).
  - `enabled` boolean NN =true (false → the feature runs its T0 path).
  - `version` integer NN =1 (optimistic concurrency).
  - `updated_by` uuid.
  - ⟨TS⟩.
  - **Check (ADR-44, R-02):** `private.model_routable(model) and private.targets_routable(fallback_targets, escalation_target)`; `model_routable(m)` is false for `claude-fable-%` and `claude-mythos-%` (Covered Models are never routable).
- **PK:** `id`.
- **FKs:** `updated_by` → `admin_users(user_id)` set null.
- **Unique:** `(profile, role, feature)` (R-18).
- **Indexes:** `(feature, profile)`; `(retires_not_before) where retires_not_before is not null`.
- **RLS:** **SYS** + restrictive aal2. Read via `admin_api` (`ai.read`); written only by `admin_api.ai_model_config_update` (`ai.models.write`), which requires `eval_status='passed'` for a new primary. The worker reads with the secret key and caches routes for 60 s.
- **Retention:** Permanent.
- **Sensitive:** None ("configured / not configured" is computed by `health` from the Edge env).
- **Audit:** Every change → `ai.model_config_updated` (before/after); a per-plan profile switch → `ai.routing_profile_changed`.
- **Seed** (reference data in 0005, generated from `supabase/seed/ai_model_config.sql`): both profiles for every feature per AI_PIPELINE_PLAN §3.3/§3.4. `balanced`: Haiku 4.5 at T1, Sonnet 5 at T2, Opus 5.5 escalation. `lean`: `gpt-5.6-luna` triage once its Turkish eval passes, Haiku briefings, tap-only prep, single-tone drafts. Embeddings: `voyage-4` (`embedding_doc`) and `voyage-4-lite` (`embedding_query`), 1024-d, with no hot cross-provider fallback (R-01).

#### `prompt_versions`
- **Purpose:** Versioned prompts with activate and rollback (M§58). The key catalogue and eval sets are owned by AI_PIPELINE_PLAN §5.2 (R-20).
- **Columns:**
  - `id` uuid.
  - `prompt_key` text NN check(in ('email_classification','thread_summary','email_deep_extract','commitment','post_meeting','follow_up','life_intel','briefing_morning','briefing_midday','briefing_evening','weekly_review','meeting_prep','capture','capture_vision','capture_pdf','assistant_intent','assistant','reply_draft')).
  - `version` integer NN check(≥1).
  - `status` prompt_status NN ='draft'.
  - `system_prompt` text NN check(≤40000), `user_template` text NN check(≤20000).
  - `output_schema_ref` text NN (zod schema export name, e.g. `EmailTriageV1`), `schema_hash` text NN (sha256 of the JSON Schema sent to the provider).
  - `model_role` text NN (an `ai_model_config.role` value).
  - `model_constraints` jsonb NN ='{}' (e.g. `{min_cache_prefix_tokens: 4096}`).
  - `eval_dataset_version` text, `eval_report` jsonb (metrics only), `eval_passed` boolean NN =false.
  - `notes` text check(≤2000), `changelog` text check(≤2000).
  - `created_by`, `activated_by` uuid, `activated_at`, `archived_at` timestamptz.
  - `created_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `created_by` / `activated_by` → `admin_users(user_id)` set null.
- **Unique:** `(prompt_key, version)`; partial unique `(prompt_key) where status='active'`.
- **Indexes:** `(prompt_key, status)`.
- **RLS:** **SYS** + restrictive aal2. `trg_prompt_versions_guard`: content columns are immutable once status ≠ draft; allowed transitions are draft→active, active→archived and archived→active (rollback); activation requires `eval_passed`. Activation archives the previous active version in the same transaction (`admin_api.prompt_activate`).
- **Retention:** Permanent.
- **Sensitive:** None.
- **Audit:** `prompt.draft_created`, `prompt.activated`, `prompt.rolled_back`, `prompt.archived`.

#### `ai_result_cache`
- **Purpose:** Per-user dedupe of validated and grounded AI results, so the same content is never re-analysed (R-02; plan §8 cost control; AI_PIPELINE_PLAN §8.4; M§82, §125). Re-syncs, label changes, multi-account and forwarded duplicates reuse the result; per-user keys prevent cross-user correlation.
- **Columns:**
  - ⟨OWN⟩.
  - `feature` ai_feature NN.
  - `content_hash` bytea NN check(octet_length(content_hash)=32): `HMAC-SHA256(k_user, normalised input)` with `k_user = HMAC-SHA256(AI_HASH_PEPPER, user_id)` derived at runtime in Edge Functions and never stored. The input text itself is never stored.
  - `prompt_version_id` uuid NN.
  - `model` text NN.
  - `result` jsonb NN (zod-validated, grounded structured output; derived data only, evidence quotes ≤300 chars).
  - `hit_count` integer NN =0, `last_hit_at` timestamptz.
  - `created_at` timestamptz NN =now().
  - ⟨EXP⟩ (anchor `created_at`; follows the source retention).
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` cascade. `prompt_version_id` → `prompt_versions` cascade.
- **Unique:** `(user_id, feature, content_hash, prompt_version_id)` (R-02).
- **Indexes:** `(expires_at) where expires_at is not null`; `(prompt_version_id)`.
- **RLS:** **SYS** (worker only; no `anon`/`authenticated` policies or grants).
- **Retention:** R-USER through `retention_cleanup`; also deleted by history deletion ("Analiz geçmişini sil") and account deletion (cascade). Rotating `AI_HASH_PEPPER` invalidates the cache.
- **Sensitive:** Derived content.
- **Audit:** None.

#### `ai_budget_reservations`
- **Purpose:** Open budget holds between `private.ai_budget_reserve` and `private.ai_budget_settle`, so concurrent calls cannot overshoot the Free units or the USD caps (§6.5).
- **Columns:**
  - ⟨OWN⟩.
  - `local_date` date NN, `feature` ai_feature NN.
  - `est_cost_usd_micros` bigint NN check(≥0), `units` smallint NN =0 check(≥0).
  - `level` text NN check(in ('l0','l1','l2')) (degradation level at reserve time, AI_PIPELINE_PLAN §8.10).
  - `hold_until` timestamptz NN =now()+interval '15 minutes'.
  - `settled_at` timestamptz, `ai_request_id` uuid.
  - `created_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` cascade.
- **Unique:** —
- **Indexes:** `(hold_until) where settled_at is null`; `(user_id, local_date)`.
- **RLS:** **SYS.**
- **Retention:** Settled rows are deleted after 1 day by `retention_cleanup`; unsettled rows past `hold_until` are released by `scheduler_tick` (§6.3 step 14) and deleted.
- **Sensitive:** None.
- **Audit:** None.

#### `ai_model_prices`
- **Purpose:** Provider price book feeding `ai_requests.cost_usd_micros` and budget estimates (AI_PIPELINE_PLAN §8.13).
- **Columns:** `id` uuid; `provider` text NN; `model` text NN; `input_per_mtok_usd` numeric(12,6) NN; `output_per_mtok_usd` numeric(12,6) NN; `cache_write_5m_per_mtok_usd`, `cache_write_1h_per_mtok_usd`, `cache_read_per_mtok_usd` numeric(12,6); `batch_discount` numeric(4,3) NN =0.5; `audio_per_min_usd`, `chars_per_million_usd` numeric(12,6); `effective_from` timestamptz NN; `updated_by` uuid; `created_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `updated_by` → `admin_users(user_id)` set null.
- **Unique:** `(provider, model, effective_from)`.
- **Indexes:** `(provider, model, effective_from desc)`.
- **RLS:** **SYS** + restrictive aal2. Seeded from `supabase/seed/ai_model_prices.sql` (vendor prices re-verified before production seeding); read via `admin_api` (`ai.read`), changed via `admin_api.ai_model_prices_upsert` (`ai.models.write`).
- **Retention:** Permanent (historic costs stay reproducible).
- **Sensitive:** None.
- **Audit:** `ai.prices_updated`.

#### `ai_calibration_versions`
- **Purpose:** Confidence-calibration models per feature and field (AI_PIPELINE_PLAN §6.7), refit weekly by the `ai_eval` job.
- **Columns:** `id` uuid; `feature` ai_feature NN; `field` text NN check(char_length ≤60); `version` integer NN; `method` text NN check(in ('isotonic','platt','logistic_isotonic')); `params` jsonb NN; `ece` numeric(5,4); `status` text NN ='draft' check(in ('draft','active','archived')); `activated_by` uuid; `activated_at` timestamptz; `created_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `activated_by` → `admin_users(user_id)` set null.
- **Unique:** `(feature, field, version)`; partial unique `(feature, field) where status='active'`.
- **Indexes:** PK and uniques.
- **RLS:** **SYS** + restrictive aal2. Activation through `admin_api.ai_calibration_activate` (`ai.models.write`) requires `ece ≤ 0.05`.
- **Retention:** Permanent.
- **Sensitive:** None (parameters only, no labels or content).
- **Audit:** `ai.calibration_activated`.

#### `ai_batches`
- **Purpose:** Message Batch lifecycle for non-urgent AI work (weekly review, batch triage), driven by job `ai_batch` (submit, collect, purge; AI_PIPELINE_PLAN §8.8).
- **Columns:** `id` uuid; `provider` text NN ='anthropic'; `batch_id` text NN (provider batch id); `feature` ai_feature NN; `status` text NN check(in ('submitted','in_progress','ended','collected','purged','failed','expired')); `request_count` integer NN; `submitted_at` timestamptz NN; `ended_at`, `collected_at`, `purged_at` timestamptz; `correlation_id` uuid; `created_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** —
- **Unique:** `(provider, batch_id)`.
- **Indexes:** `(status) where status in ('submitted','in_progress','ended')`.
- **RLS:** **SYS.**
- **Retention:** 90 days after `purged_at` (results are purged at the provider after collection).
- **Sensitive:** None (request custom ids reference row ids only).
- **Audit:** None.

---

### 4.5 Notifications

#### `notifications`
- **Purpose:** Decision-engine ledger. Every candidate push is recorded with its decision and any suppression reason (M§86, §132; ADR-10).
- **Columns:**
  - ⟨OWN⟩.
  - `category` notification_category NN, `decision` notification_decision NN.
  - `suppression_reason` text check(in ('quiet_hours','category_disabled','frequency_cap','low_relevance','deduplicated','no_device','not_entitled','os_permission_denied','smart_filter','snoozed')), check(decision not in ('suppressed','deduplicated') or suppression_reason is not null).
  - `dedupe_key` text NN.
  - `priority` smallint NN =50 check(0..100).
  - `detail_mode` notification_detail NN.
  - `title_rendered` text check(≤120), `body_rendered` text check(≤240).
  - `data` jsonb NN check(`data ?& array['type','deeplink']` and not (`data ? 'body'`)). Only `{type, entity_id, deeplink}`.
  - `entity_type` text, `entity_id` uuid.
  - `interruption_level` text NN ='active' check(in ('passive','active','time_sensitive')).
  - `android_channel` text NN check(in ('briefings','critical_email','meetings','deadlines','follow_up','life_intel','approvals','reminders','account','phone_digest')) (R-12; IDs are permanent once shipped; every channel is created at first launch, before the permission prompt, with `lockscreenVisibility = PRIVATE`). Mapping: `morning`/`midday`/`evening` and weekly → `briefings`; `critical_email` → `critical_email`; `meeting` → `meetings`; `deadline` → `deadlines`; `follow_up` → `follow_up`; `life_intel` → `life_intel`; `approval` → `approvals`; `account` → `account`; reminder pushes → `reminders`; Android NI digests → `phone_digest`.
  - `scheduled_for` timestamptz NN, `sent_at`, `opened_at`, `failed_at` timestamptz, `error_code` text.
  - `job_id` uuid, `correlation_id` uuid.
  - ⟨EXP⟩ (fixed 30 days).
  - `created_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` cascade.
- **Unique:** `(user_id, dedupe_key)`.
- **Indexes:** `(user_id, created_at desc)`; `(decision, created_at)`; `(category, decision, created_at)` (M§55 metrics); `(scheduled_for) where decision='scheduled'`.
- **RLS:** OWN-R; OWN-U with `grant update (opened_at)`.
- **Retention:** 30 days.
- **Sensitive:** In `full` mode the rendered text can contain names and subjects. Admin debugging shows category, decision and reason, and shows rendered text only for `generic` mode or under Support Access scope `notifications` (R-09).
- **Audit:** An admin push test → `notifications.test_sent`.

#### `push_tickets`
- **Purpose:** Expo ticket and receipt tracking (ADR-10).
- **Columns:**
  - `id` uuid.
  - `user_id` uuid NN, `notification_id` uuid NN, `push_token_id` uuid.
  - `expo_ticket_id` text.
  - `status` text NN check(in ('ok','error','pending_receipt','receipt_ok','receipt_error')).
  - `error_code` text check(in ('DeviceNotRegistered','MessageTooBig','MessageRateExceeded','MismatchSenderId','InvalidCredentials','Unknown')).
  - `sent_at` timestamptz NN, `receipt_checked_at` timestamptz.
  - `created_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `notification_id` → `notifications` cascade. `push_token_id` → `push_tokens` set null. `user_id` → `auth.users` cascade.
- **Unique:** `(expo_ticket_id) where expo_ticket_id is not null`.
- **Indexes:** `(sent_at) where status='pending_receipt'`.
- **RLS:** **SYS.**
- **Retention:** 7 days.
- **Sensitive:** None.
- **Audit:** None.

---

### 4.6 Business

#### `subscriptions`
- **Purpose:** The RevenueCat **mirror**. Each webhook causes a REST v2 refetch and the row is **overwritten**, never incrementally applied (ADR-11; integrations audit E.3).
- **Columns:**
  - `user_id` uuid NN.
  - `entitlement` text NN ='pro' check(='pro').
  - `rc_app_user_id` text NN.
  - `is_active` boolean NN =false.
  - `status` subscription_status NN ='none'.
  - `store` text check(in ('app_store','play_store','promotional','stripe','amazon','mac_app_store','test_store')).
  - `environment` text check(in ('sandbox','production')).
  - `product_id` text (e.g. `da_pro_annual`, `da_pro_monthly:monthly`).
  - `period_type` text check(in ('normal','trial','intro','prepaid')).
  - `purchased_at`, `original_purchased_at`, `expires_at` timestamptz.
  - `will_renew` boolean NN =false.
  - `unsubscribe_detected_at`, `billing_issue_at`, `grace_expires_at` timestamptz.
  - `cancel_reason` text, `expiration_reason` text.
  - `is_family_share` boolean NN =false.
  - `last_event_id` text, `last_event_type` text.
  - `trial_reminder_at` timestamptz (P-03 "24 saat önce hatırlatırız").
  - `synced_at` timestamptz NN.
  - ⟨TS⟩.
- **PK:** `(user_id, entitlement)`.
- **FKs:** `user_id` → `auth.users` cascade.
- **Unique:** `(rc_app_user_id, entitlement)`.
- **Indexes:** `(status)`; `(expires_at) where is_active`; `(store, product_id)`.
- **RLS:** OWN-R with `grant select (user_id, entitlement, is_active, status, store, product_id, period_type, expires_at, will_renew, billing_issue_at, synced_at)`. No writes (`billing_sync` worker only).
- **Retention:** Account lifetime.
- **Sensitive:** Financial status.
- **Audit:** None per sync. Finance reads through `admin_api`.

#### `billing_events`
- **Purpose:** Raw RevenueCat webhook ledger, deduplicated on the event `id` (M§60).
- **Columns:**
  - `id` bigint identity.
  - `event_id` text NN.
  - `user_id` uuid, `rc_app_user_id` text.
  - `event_type` text NN check(in ('TEST','INITIAL_PURCHASE','RENEWAL','CANCELLATION','UNCANCELLATION','NON_RENEWING_PURCHASE','SUBSCRIPTION_PAUSED','EXPIRATION','BILLING_ISSUE','PRODUCT_CHANGE','TRANSFER','SUBSCRIPTION_EXTENDED','TEMPORARY_ENTITLEMENT_GRANT','REFUND_REVERSED','INVOICE_ISSUANCE','VIRTUAL_CURRENCY_TRANSACTION')).
  - `environment` text, `store` text, `product_id` text.
  - `event_timestamp` timestamptz NN.
  - `transferred_from` text[], `transferred_to` text[].
  - `payload` jsonb NN (the RC body with `subscriber_attributes` **stripped**).
  - `process_status` text NN ='received' check(in ('received','processed','ignored_sandbox','failed')), `processed_at` timestamptz.
  - `job_id` uuid.
  - `received_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` on delete set null.
- **Unique:** `(event_id)`.
- **Indexes:** `(user_id, event_timestamp desc)`; `(event_type, event_timestamp)`; `(process_status) where process_status <> 'processed'`.
- **RLS:** **SYS** + restrictive aal2 (finance via `admin_api`).
- **Retention:** 3 years (financial). On account deletion `user_id` is set null and `rc_app_user_id` is replaced with `private.hash_subject(user_id)`.
- **Sensitive:** Price and country.
- **Audit:** None per row. A reprocess by an admin → `billing.event_reprocessed`.

#### `entitlement_grants`
- **Purpose:** Referral, admin, support and compensation Pro grants, kept separate from store state (M§43, §61; ADR-11).
- **Columns:**
  - ⟨OWN⟩.
  - `entitlement` text NN ='pro' check(='pro').
  - `source` grant_source NN.
  - `starts_at` timestamptz NN, `ends_at` timestamptz NN, check(ends_at > starts_at).
  - `duration_days` smallint NN check((source in ('admin','support','compensation') and duration_days in (1,7,14,30)) or (source in ('referral_referrer','referral_referee') and duration_days between 1 and 60)).
  - `reason` text check(char_length ≥10), check(source in ('referral_referrer','referral_referee') or reason is not null).
  - `granted_by_admin_id` uuid, `referral_credit_id` uuid.
  - `idempotency_key` text NN.
  - `revoked_at` timestamptz, `revoked_by_admin_id` uuid, `revoke_reason` text.
  - `created_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `granted_by_admin_id` / `revoked_by_admin_id` → `admin_users(user_id)` set null. `referral_credit_id` → `referral_credits` set null. `user_id` → `auth.users` cascade.
- **Unique:** `(idempotency_key)`.
- **Indexes:** `(user_id, ends_at desc) where revoked_at is null`.
- **RLS:** OWN-R. Writes only via `private.grant_entitlement` (stacking: `starts_at = greatest(now(), max(ends_at) of active grants)`).
- **Retention:** Account lifetime.
- **Sensitive:** None.
- **Audit:** `entitlement.granted` / `entitlement.revoked` (reason, days, source).

#### `plan_limits`
- **Purpose:** Free/Pro limits, AI budgets, routing profile and feature switches used by server gates (M§44, §82; plan §8, §15). Shape and canonical keys per R-22.
- **Columns:**
  - `plan` text NN check(in ('free','pro')).
  - `key` text NN check(key in ('max_mail_accounts','max_calendar_accounts','max_calendars','vip_max','priority_rules_max','ai_daily_budget_units','ai_soft_cap_usd_day','ai_hard_cap_usd_day','ai_hard_cap_usd_month','ai_briefing_reserve_ratio','ai_routing_profile','email_analysis_daily','reply_drafts_daily','assistant_messages_daily','assistant_retrieval_days','transcribe_seconds_daily','captures_daily','meeting_preps_daily','semantic_search_daily','backfill_days','referral_rewards_per_year','meeting_prep','memory_search','voice_briefing','android_ni','midday_evening','advanced_planning','follow_up_commitments','capture','vip')).
  - `value` jsonb NN check(`private.valid_plan_limit(key, value)`): count and quota keys → non-negative JSON integer; `ai_*_usd_*` keys → non-negative JSON number in USD; `ai_briefing_reserve_ratio` → number in [0,1]; `ai_routing_profile` → JSON string `"balanced"` or `"lean"`; feature keys → JSON boolean; `ai_daily_budget_units` and `assistant_retrieval_days` may be JSON `null` (no unit cap / follows the retention window).
  - `updated_by` uuid, `updated_at` timestamptz NN =now().
- **PK:** `(plan, key)`.
- **FKs:** `updated_by` → `admin_users` set null.
- **Unique:** PK.
- **Indexes:** —
- **RLS:** Policy `plan_limits_select_all` for select to authenticated using (true); `grant select` to authenticated. Writes go via `admin_api.plan_limits_update` (`settings.system.write`) and `admin_api.plan_routing_profile_set` (`ai.models.write`).
- **Retention:** Permanent.
- **Sensitive:** None.
- **Audit:** `plan_limits.updated` (before/after); `ai.routing_profile_changed`.
- **Readers:** `private.plan_limit(user, key) → jsonb` for the user's effective plan (`effective_entitlement.is_active` → `pro`, else `free`); `public.check_plan_limit`; `private.ai_budget_reserve`; the AI router (AI_PIPELINE_PLAN §3.6).
- **Units** (Free): 1 unit = 1 inbound email triaged by an LLM, 1 capture analysis, 1 assistant answer produced by a model, or 1 reply/follow-up draft generation or thread summary. Cache hits, T0 decisions and briefings never count. Units reset at local midnight.
- **Seed (in 0009; values per plan §8 budgets; editable in backoffice Settings, never hard-coded):**

| key | free | pro | unit / notes |
|---|---|---|---|
| max_mail_accounts | 1 | 10 | active mail-capable accounts |
| max_calendar_accounts | 1 | 10 | active calendar-capable accounts |
| max_calendars | 1 | 30 | selected calendars across all sources |
| vip_max | 5 | 100 | rows (effects are Pro-only, §4.3) |
| priority_rules_max | 10 | 200 | non-deleted rules |
| ai_daily_budget_units | 50 | 600 | Free visible "AI analiz limiti 50/gün"; Pro internal fair-use ceiling, UI "Adil kullanım" (never "Sınırsız") |
| ai_soft_cap_usd_day | 0.02 | 0.20 | USD per local day → degradation L1 |
| ai_hard_cap_usd_day | 0.03 | 0.60 | USD per local day → L2 |
| ai_hard_cap_usd_month | 0.90 | 6.00 | USD per local calendar month → L2 |
| ai_briefing_reserve_ratio | 0.25 | 0.15 | share of the daily caps kept for briefings |
| ai_routing_profile | "lean" | "balanced" | switchable per plan in backoffice (AI_PIPELINE_PLAN §3.4–3.5) |
| email_analysis_daily | 150 | 1500 | LLM-analysed mails per local day |
| reply_drafts_daily | 5 | 60 | generate + regenerate + follow-up drafts |
| assistant_messages_daily | 10 | 200 | user messages |
| assistant_retrieval_days | 7 | null | null = the user's retention window |
| transcribe_seconds_daily | 60 | 1800 | server STT seconds |
| captures_daily | 0 | 50 | analyses |
| meeting_preps_daily | 0 | 30 | generations incl. refresh |
| semantic_search_daily | 0 | 300 | vector searches |
| backfill_days | 30 | 90 | initial backfill window (capped by retention) |
| referral_rewards_per_year | 6 | 6 | P-06 |
| meeting_prep | false | true | feature (M§44) |
| memory_search | false | true | feature |
| voice_briefing | false | true | feature |
| android_ni | false | true | feature |
| midday_evening | false | true | feature |
| advanced_planning | false | true | feature |
| follow_up_commitments | false | true | feature |
| capture | false | true | feature |
| vip | false | true | feature (VIP effects) |

#### `referral_codes`
- **Purpose:** One shareable code per user (M§45).
- **Columns:**
  - `user_id` uuid NN.
  - `code` text NN check(code ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{7}$').
  - `disabled_at` timestamptz.
  - `created_at` timestamptz NN =now().
- **PK:** `user_id`.
- **FKs:** `user_id` → `auth.users` cascade.
- **Unique:** `(code)`.
- **Indexes:** —
- **RLS:** OWN-R. Created by `handle_new_user` (retry on collision).
- **Retention:** Account lifetime.
- **Sensitive:** None.
- **Audit:** Admin disable → `referral.code_disabled`.

#### `referrals`
- **Purpose:** The referral lifecycle and anti-abuse record (M§45; plan §16; P-06).
- **Columns:**
  - `id` uuid.
  - `referrer_id` uuid, `referee_id` uuid.
  - `code` text NN.
  - `status` referral_status NN ='pending'.
  - `applied_at` timestamptz NN =now(), `qualified_at`, `rewarded_at`, `rejected_at` timestamptz.
  - `reject_reason` text check(in ('self_referral','duplicate_account','loop','cap_reached','velocity','admin_rejected','qualification_timeout','tombstoned')) (`tombstoned` = a referee signal hash matches `privacy_tombstones`).
  - `risk_score` smallint NN =0 check(0..100), `risk_signals` jsonb NN ='{}' (hashed signals only).
  - `referee_device_hash` bytea, `referee_email_hash` bytea.
  - `qualification` jsonb NN ='{}' (`{onboarding_completed_at, account_connected_at, first_briefing_at, account_age_ok}`).
  - `reviewed_by_admin_id` uuid, `reviewed_at` timestamptz, `review_reason` text.
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `referrer_id`, `referee_id` → `auth.users` **on delete set null**. `reviewed_by_admin_id` → `admin_users` set null.
- **Unique:** `(referee_id) where referee_id is not null` (one referral per referee).
- **Indexes:** `(referrer_id, status)`; `(status) where status in ('pending','flagged')`; `(referee_device_hash)`; `(referee_email_hash)`.
- **RLS:** **SYS**. Users see their invites through `api GET /referrals/me` with masked referee identity ("elif.a@…").
- **Retention:** 365 days after the terminal status, or when both user ids are null (`retention_cleanup`).
- **Sensitive:** The hashes are pseudonymous.
- **Audit:** `referral.reviewed` (approve/reject, reason), `referral.flagged` (system).

#### `referral_credits`
- **Purpose:** Idempotent reward records for each side (M§45, §116).
- **Columns:**
  - `id` uuid.
  - `referral_id` uuid NN.
  - `user_id` uuid NN (beneficiary).
  - `side` referral_side NN.
  - `days` smallint NN =14.
  - `entitlement_grant_id` uuid.
  - `idempotency_key` text NN (= `'referral:{referral_id}:{side}'`).
  - `created_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `referral_id` → `referrals` on delete restrict. `user_id` → `auth.users` cascade. `entitlement_grant_id` → `entitlement_grants` set null.
- **Unique:** `(referral_id, side)`; `(idempotency_key)`.
- **Indexes:** `(user_id, created_at)` (per-year cap).
- **RLS:** OWN-R.
- **Retention:** Account lifetime.
- **Sensitive:** None.
- **Audit:** Written in the same transaction as `entitlement.granted`.

---

### 4.7 Ops and product

#### `jobs`
- **Purpose:** First-party queue: idempotent, leased, backoff, dead letter (ADR-04; M§53, §127).
- **Columns:**
  - `id` uuid =gen_random_uuid().
  - `type` job_type NN.
  - `status` job_status NN ='queued'.
  - `priority` smallint NN =100 check(0..1000) (lower runs first).
  - `user_id` uuid, `connected_account_id` uuid.
  - `payload` jsonb NN ='{}' check(pg_column_size(payload) ≤ 8192). Ids only, never content.
  - `idempotency_key` text NN check(char_length ≤200).
  - `run_after` timestamptz NN =now().
  - `attempts` integer NN =0, `max_attempts` integer NN =5 check(1..20).
  - `lease_owner` text, `lease_expires_at` timestamptz.
  - `last_error_code` text, `last_error_message` text check(≤500).
  - `correlation_id` uuid NN =gen_random_uuid(), `parent_job_id` uuid.
  - `progress` jsonb NN ='{}' (First Analysis steps and counters, SREQ-55).
  - `result` jsonb.
  - `started_at`, `completed_at`, `dead_lettered_at` timestamptz.
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` cascade (for `account_deletion` jobs `user_id` stays **null** and the subject lives in `payload.subject_user_id`, so the job survives the cascade). `connected_account_id` → `connected_accounts` cascade. `parent_job_id` → `jobs` set null.
- **Unique:** `(idempotency_key)`.
- **Indexes:** `jobs_claim_idx (priority, run_after) where status in ('queued','retrying')`; `(type, status, run_after)`; `(lease_expires_at) where status='running'`; `(user_id, created_at desc)`; `(correlation_id)`; `(status, updated_at) where status in ('failed','dead_letter')`.
- **RLS:** **SYS** + restrictive aal2. First-analysis progress reaches users through `api GET /onboarding/first-analysis/:jobId`, which checks ownership.
- **Retention:** `completed` 14 days; `failed`/`dead_letter` 90 days.
- **Sensitive:** None (ids only).
- **Audit:** Admin retry/cancel → `job.retried` / `job.cancelled` (reason).

#### `job_attempts`
- **Purpose:** Per-attempt history (M§53 observability).
- **Columns:**
  - `id` bigint identity.
  - `job_id` uuid NN, `attempt` integer NN.
  - `user_id` uuid.
  - `worker_id` text NN.
  - `started_at` timestamptz NN, `finished_at` timestamptz.
  - `outcome` text check(in ('completed','failed','retrying','timeout','lease_lost','dead_letter')).
  - `error_code` text, `error_message` text check(≤500).
  - `duration_ms` integer.
- **PK:** `id`.
- **FKs:** `job_id` → `jobs` cascade. `user_id` → `auth.users` set null.
- **Unique:** `(job_id, attempt)`.
- **Indexes:** `(job_id)`.
- **RLS:** **SYS.**
- **Retention:** With the parent job.
- **Sensitive:** Error messages are sanitized: no tokens, no content (enforced in `_shared/errors.ts`).
- **Audit:** None.

#### `analytics_events`
- **Purpose:** First-party, allow-listed, content-free product analytics (M§42, §119; ADR-13).
- **Columns:**
  - `id` bigint identity.
  - `user_id` uuid, `installation_id` uuid, `session_id` uuid.
  - `event_name` text NN check(event_name ~ '^[a-z][a-z0-9_]{2,63}$') (the single event catalogue is generated into `packages/domain/analytics/events.ts` from the screen maps and API_CONTRACTS backend events, R-21, and enforced in `api`).
  - `props` jsonb NN ='{}' check(pg_column_size(props) ≤ 2048).
  - `platform` text check(in ('ios','android','web','backoffice')).
  - `app_version` text.
  - `occurred_at` timestamptz NN.
  - `received_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` **set null**.
- **Unique:** —
- **Indexes:** `(occurred_at)`; `(event_name, occurred_at)`; `(user_id, occurred_at) where user_id is not null`.
- **RLS:** **SYS** (insert via `api /analytics/events`, which drops events of users with `user_preferences.analytics_opt_out=true`).
- **Retention:** 400 days.
- **Sensitive:** None by construction (no content, no emails).
- **Audit:** None.

#### `feature_flags`
- **Purpose:** Flags and kill switches with targeting (M§63).
- **Columns:**
  - `key` text NN check(~ '^[a-z][a-z0-9_.]{2,63}$').
  - `description` text NN.
  - `enabled` boolean NN =false.
  - `is_kill_switch` boolean NN =false.
  - `rollout_percentage` smallint NN =100 check(0..100).
  - `platforms` platform[], `plans` text[] check(plans <@ '{free,pro}').
  - `min_app_version` text, `max_app_version` text.
  - `payload` jsonb NN ='{}' (remote config, e.g. the NI package denylist).
  - `updated_by` uuid.
  - ⟨TS⟩.
- **PK:** `key`.
- **FKs:** `updated_by` → `admin_users` set null.
- **Unique:** PK.
- **Indexes:** —
- **RLS:** **SYS**. Evaluation happens in `private.evaluate_flags(user_id, platform, app_version)`, returned by `/me/bootstrap`. Bucketing is `abs(hashtext(key‖user_id)) % 100`.
- **Retention:** Permanent.
- **Sensitive:** None.
- **Audit:** `flag.updated`, `flag.killed` (before/after).
- **Seed** (R-10: exactly these keys; `ai.feature.<name>` exists once per `ai_feature` value):
  - AI kill switches (`is_kill_switch=true`, enabled): `ai.global.enabled`, `ai.provider.anthropic.enabled`, `ai.provider.openai.enabled`, `ai.provider.voyage.enabled`, `ai.feature.<name>`, `ai.model.large.enabled`, `ai.batch.enabled`, `ai.backfill.enabled`.
  - `ai.model.opus_escalation`: disabled by default (T3 stays under 2% of calls when enabled).
  - `ai.budget.org_daily_usd`: enabled, `payload {usd}` = the organisation daily ceiling; at 100% `health_check` auto-trips `ai.model.large.enabled=false` and `ai.model.opus_escalation=false`.
  - Voice: `voice.stt_server` (enabled), `voice.tts_premium` (disabled until a premium TTS credential exists).
  - Product: `feature.midday`, `feature.evening`, `feature.voice`, `feature.meeting_prep`, `feature.capture`, `feature.android_ni` (payload `{denylist[], default_off[]}` from integrations audit G.3/G.4), `feature.weekly_review` (enabled); `feature.new_ai_model` (disabled).
  - Referral parameters, pricing display and product thresholds live in `app_settings`, not in flags.
  - `ai_ops` may change only `ai.*` and `voice.*` keys (`flags.write_ai`).

#### `feature_flag_overrides`
- **Purpose:** Per-user overrides (support and QA).
- **Columns:**
  - `id` uuid.
  - `flag_key` text NN, `user_id` uuid NN.
  - `value` boolean NN.
  - `reason` text NN check(≥10).
  - `expires_at` timestamptz.
  - `created_by_admin_id` uuid NN.
  - `created_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `flag_key` → `feature_flags(key)` cascade. `user_id` → `auth.users` cascade. `created_by_admin_id` → `admin_users` restrict.
- **Unique:** `(flag_key, user_id)`.
- **Indexes:** `(user_id)`.
- **RLS:** **SYS.**
- **Retention:** Expired rows deleted by `retention_cleanup`.
- **Sensitive:** None.
- **Audit:** `flag.override_set` / `flag.override_removed`.

#### `announcements`
- **Purpose:** In-app announcements (M§64; REQ-BO-ANN-03).
- **Columns:**
  - `id` uuid.
  - `title_tr` text NN check(≤80), `title_en` text NN check(≤80).
  - `body_tr` text NN check(≤500), `body_en` text NN check(≤500).
  - `audience` text NN ='all' check(in ('all','free','pro')).
  - `platforms` platform[].
  - `min_app_version`, `max_app_version` text.
  - `starts_at` timestamptz NN, `ends_at` timestamptz NN, check(ends_at > starts_at).
  - `severity` text NN ='info' check(in ('info','warning')).
  - `cta_deeplink` text check(~ '^dijitalasistan://').
  - `published_at`, `cancelled_at` timestamptz.
  - `created_by`, `updated_by` uuid.
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** admin ids → `admin_users` set null.
- **Unique:** —
- **Indexes:** `(starts_at, ends_at) where cancelled_at is null and published_at is not null`.
- **RLS:** **SYS**. Delivery via `/me/bootstrap` (targeting evaluated server-side).
- **Retention:** Permanent.
- **Sensitive:** None.
- **Audit:** `announcement.published` / `announcement.updated` / `announcement.cancelled`.

#### `announcement_dismissals`
- **Columns:** `user_id` uuid NN, `announcement_id` uuid NN, `dismissed_at` timestamptz NN =now().
- **PK:** `(user_id, announcement_id)`.
- **FKs:** `user_id` → `auth.users` cascade. `announcement_id` → `announcements` cascade.
- **Unique:** PK.
- **Indexes:** PK.
- **RLS:** OWN-R, OWN-I.
- **Retention:** With the parent row.
- **Sensitive:** None.
- **Audit:** None.

#### `user_feedback`
- **Purpose:** In-app feedback (M§62; SREQ-71).
- **Columns:**
  - `id` uuid.
  - `user_id` uuid NN.
  - `type` feedback_type NN.
  - `rating` smallint check(1..5).
  - `message` text NN check(1..4000).
  - `contact_email` citext.
  - `diagnostics_consent` boolean NN =false, `diagnostics` jsonb NN ='{}' (app/os version only).
  - `platform` platform, `app_version` text.
  - `status` text NN ='new' check(in ('new','triaged','planned','closed')).
  - `assigned_admin_id` uuid.
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` cascade. `assigned_admin_id` → `admin_users` set null.
- **Unique:** —
- **Indexes:** `(status, created_at desc)`; `(type)`.
- **RLS:** **SYS** (insert via `api POST /feedback`).
- **Retention:** 2 years; account deletion.
- **Sensitive:** Free text and email (masked in lists).
- **Audit:** `feedback.updated`.

#### `system_health_checks`
- **Purpose:** Real probe results. There is never a fake green status (M§67).
- **Columns:**
  - `id` bigint identity.
  - `component` text NN check(in ('api','database','supabase_auth','storage','google_oauth','microsoft_oauth','gmail','microsoft_graph','push','ai_anthropic','ai_openai','ai_voyage','revenuecat','cron','webhooks','worker')).
  - `status` text NN check(in ('healthy','degraded','down','external_credential_required','unknown')).
  - `latency_ms` integer.
  - `detail` jsonb NN ='{}' (no secrets).
  - `checked_by` text NN check(in ('cron','admin')).
  - `checked_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** —
- **Unique:** —
- **Indexes:** `(component, checked_at desc)`.
- **RLS:** **SYS** + restrictive aal2.
- **Retention:** 30 days.
- **Sensitive:** None.
- **Audit:** A manual run → `health.run`.

#### `rate_limits`
- **Purpose:** Fixed-window counters for `api`, `public-api` and `admin-api` (ADR-06).
- **Columns:**
  - `key` text NN check(char_length ≤200) (e.g. `api:{uid}:assistant`, `public:{ip_hash}:support`, `admin:{uid}:mutation`).
  - `window_start` timestamptz NN.
  - `count` integer NN =0.
- **PK:** `(key, window_start)`.
- **FKs:** —
- **Unique:** PK.
- **Indexes:** `(window_start)`.
- **RLS:** **SYS.**
- **Retention:** 1 day.
- **Sensitive:** IPs are stored only as HMAC hashes.
- **Audit:** None.

#### `api_idempotency_keys`
- **Purpose:** HTTP `Idempotency-Key` store for the `[IK]` routes of `api` (API_CONTRACTS §2.11; M§94 "Duplicate write oluşmamalı"), including offline-queue replays.
- **Columns:**
  - `user_id` uuid NN.
  - `key` uuid NN (client-generated, reused for every retry of one user intent).
  - `route` text NN check(char_length ≤120) (route template, e.g. `POST /approvals/:id/approve`).
  - `fingerprint` bytea NN check(octet_length=32) (sha256 of method + route + canonical JSON body; the same key with a different body is rejected).
  - `state` text NN ='in_progress' check(in ('in_progress','completed')).
  - `response_status` smallint, `resource_ref` jsonb (`{type, id}`; ids only, never bodies).
  - `created_at` timestamptz NN =now(), `expires_at` timestamptz NN =now()+interval '24 hours' (fixed TTL, not ⟨EXP⟩).
- **PK:** `(user_id, key)`.
- **FKs:** `user_id` → `auth.users` cascade.
- **Unique:** PK.
- **Indexes:** `(expires_at)`.
- **RLS:** **SYS** (written and read only by `api` with the secret key).
- **Retention:** Deleted after `expires_at` by `retention_cleanup`.
- **Sensitive:** None (no request or response bodies).
- **Audit:** None.

#### `app_settings`
- **Purpose:** System configuration edited in backoffice Settings (BACKOFFICE_PLAN §6.24): admin session policy, metric parameters, referral parameters, Support Access bounds, notification category caps, pricing display and product thresholds. Feature flags stay in `feature_flags`. The non-critical daily push cap is the per-user `notification_preferences.daily_cap` (default 5, R-14) and the yearly referral cap is `plan_limits.referral_rewards_per_year`; neither is duplicated here.
- **Columns:**
  - `key` text NN check(key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$').
  - `value` jsonb NN check(`private.valid_app_setting(key, value)`: type and bounds per key).
  - `description` text NN check(char_length ≤300).
  - `updated_by` uuid, `updated_at` timestamptz NN =now().
- **PK:** `key`.
- **FKs:** `updated_by` → `admin_users(user_id)` set null.
- **Unique:** PK.
- **Indexes:** PK.
- **RLS:** **SYS** + restrictive aal2. Read and written through `admin_api.settings_get` / `settings_update` (`settings.system.write`; session values can only be tightened). Edge Functions read with the secret key (cached 60 s).
- **Retention:** Permanent.
- **Sensitive:** None, except `admin.gateway_secret_sha256` (a digest), which `settings_get` never returns and `settings_update` never accepts; the deploy job writes it with the secret key.
- **Audit:** `settings.system_updated` (before/after).
- **Seed (0010):**

| key | value | bounds / use |
|---|---|---|
| `session.idle_minutes` | 30 | 10–30; admin idle limit enforced by `require_admin` |
| `session.absolute_hours` | 12 | 4–12; absolute admin session limit |
| `metrics.inactive_after_days` | 14 | 7–60; "Inactive" user filter |
| `metrics.reporting_timezone` | "Europe/Istanbul" | IANA zone of rollup days |
| `referral.reward_days` | 14 | 1–60; Pro days per side (plan §16) |
| `referral.min_account_age_hours` | 48 | 24–168; qualification (plan §16) |
| `referral.velocity_max_per_hour` | 3 | 1–20; codes applied per referrer per hour before `flagged` |
| `support_access.max_minutes` | 60 | one of 15 / 30 / 60 (R-09) |
| `notifications.cap.follow_up` | 2 | rolling 24 h per category |
| `notifications.cap.life_intel` | 3 | rolling 24 h per category |
| `notifications.cap.deadline` | 3 | rolling 24 h per category |
| `followup.wait_thresholds_days` | [3, 7] | days-waiting badge (amber, coral) |
| `first_analysis.mail_window_hours` | 72 | First Analysis mail window |
| `first_analysis.calendar_window_hours` | 48 | First Analysis calendar window |
| `first_analysis.slow_threshold_s` | 60 | slow-state copy threshold |
| `first_analysis.timeout_s` | 600 | job timeout |
| `today.max_priorities` | 5 | Today priority cards |
| `pro_gate.snooze_days` | 7 | contextual Pro gate "Sonra" |
| `web.pricing_display` | `{verified:false}` | store price ranges for `/pricing`, shown only when `verified=true` and `as_of` ≤ 90 days |
| `pricing.estimates` | `{}` | MRR/ARR estimate inputs for `subscriptions_metrics` |

#### `metrics_daily`
- **Purpose:** Anonymous daily rollups for backoffice 30d/90d views that survive per-user retention purges and account deletions (M§50, §119; BACKOFFICE_PLAN §7.6).
- **Columns:** `day` date NN; `metric_key` text NN; `dim1`, `dim2`, `dim3` text NN =''; `value` bigint NN =0; `value_sum` numeric; `latency_hist` integer[]; `computed_at` timestamptz NN =now().
- **PK:** `(day, metric_key, dim1, dim2, dim3)`.
- **FKs:** —
- **Unique:** PK.
- **Indexes:** `(metric_key, day)`.
- **RLS:** **SYS** + restrictive aal2. Written only by `private.rollup_metrics_daily(p_day)` (idempotent delete and re-insert of one day), called from `scheduler_tick`; internal and demo users are excluded.
- **Retention:** 25 months.
- **Sensitive:** None (aggregates, no user ids).
- **Audit:** None.

#### `ai_metrics_daily`
- **Purpose:** Daily AI aggregates for `/ai` 30d/90d views and AI COGS review (AI_PIPELINE_PLAN §8.14).
- **Columns:** `id` bigint identity; `day` date NN; `feature` ai_feature NN; `provider` text NN; `model` text NN; `prompt_version_id` uuid; `plan` text NN check(in ('free','pro')); `profile` routing_profile; `status` text NN; `requests` bigint NN =0; `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` bigint NN =0; `units_charged` bigint NN =0; `cost_usd_micros` bigint NN =0; `grounding_proposed`, `grounding_dropped` bigint NN =0; `latency_hist` integer[]; `computed_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** —
- **Unique:** `(day, feature, provider, model, coalesce(prompt_version_id, '00000000-0000-0000-0000-000000000000'::uuid), plan, coalesce(profile::text, ''), status)` (expression unique index).
- **Indexes:** `(day)`; `(feature, day)`.
- **RLS:** **SYS** + restrictive aal2; written only by `private.rollup_metrics_daily`.
- **Retention:** 25 months.
- **Sensitive:** None.
- **Audit:** None.

#### `web_analytics_daily`
- **Purpose:** Content-free, counter-only analytics of the marketing site (SCREEN_AND_FLOW_MAP web events); no row per visit, no user id, no IP.
- **Columns:** `day` date NN; `event` text NN check(event ~ '^web_[a-z0-9_]{2,60}$'); `dims_hash` bytea NN (sha256 of the canonical `dims`); `dims` jsonb NN (allow-listed enums only: page, locale, device class, theme); `count` bigint NN =0.
- **PK:** `(day, event, dims_hash)`.
- **FKs:** —
- **Unique:** PK.
- **Indexes:** `(event, day)`.
- **RLS:** **SYS**; incremented by `public-api` (`insert … on conflict do update set count = count + 1`).
- **Retention:** 25 months.
- **Sensitive:** None.
- **Audit:** None.

#### `private.demo_fixture_state`
- **Purpose:** Real state changes of the demo adapter (only when `DEMO_MODE=true`): a sent reply appears in its thread and a created event in its calendar, without any provider call and without fake success (INTEGRATION_PLAN §13.2; M§89, M§100).
- **Columns:** `connected_account_id` uuid NN; `user_id` uuid NN; `resource` text NN check(in ('mail','calendar','tasks')); `state` jsonb NN ='{}' (fixture deltas: sent replies, created events and tasks with their approval ids); `demo_clock` timestamptz (last timestamp the demo sync has seen); `updated_at` timestamptz NN =now().
- **PK:** `(connected_account_id, resource)`.
- **FKs:** `connected_account_id` → `connected_accounts` cascade. `user_id` → `auth.users` cascade.
- **Unique:** PK.
- **Indexes:** `(user_id)`.
- **RLS:** Schema `private` is not exposed; RLS enabled + forced with no policies; accessed only by the demo adapter with the secret key.
- **Retention:** With the demo account.
- **Sensitive:** None (fixture data only).
- **Audit:** None (`demo.seeded` is written by the seed script).

---

### 4.8 Privacy

#### `data_export_requests`
- **Purpose:** Async user export (M§128; ADR-05).
- **Columns:**
  - `id` uuid.
  - `user_id` uuid NN.
  - `status` export_status NN ='requested'.
  - `job_id` uuid.
  - `requested_via` text NN ='app' check(in ('app','admin')).
  - `storage_path` text (`exports/{user_id}/{id}.zip`).
  - `file_size_bytes` bigint, `sha256` bytea.
  - `ready_at` timestamptz.
  - `expires_at` timestamptz (artifact availability = `ready_at + 24 h`, plan §13).
  - `downloaded_at` timestamptz.
  - `error_code` text.
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` cascade.
- **Unique:** `(user_id) where status in ('requested','processing')` (one in flight).
- **Indexes:** `(status, created_at)`; `(expires_at) where status='ready'`.
- **RLS:** OWN-R. Create goes via `api POST /privacy/export`.
- **Retention:** The artifact is deleted at `expires_at` (status → `expired`). Rows are kept 90 days.
- **Sensitive:** The artifact contains all user data. The export excludes `oauth_credentials`, `oauth_states`, hashes, embeddings and internal cursors (M§128).
- **Audit:** `export.requested`, `export.ready`, `export.downloaded`.

#### `data_deletion_requests`
- **Purpose:** History and account deletion lifecycle with honest status (M§129; C-24 web OTP path).
- **Columns:**
  - `id` uuid.
  - `user_id` uuid.
  - `subject_hash` bytea NN (= `private.hash_subject(user_id)`).
  - `subject_email_hash` bytea.
  - `kind` deletion_kind NN, `status` deletion_status NN ='requested'.
  - `origin` text NN check(in ('app','web_otp','admin')).
  - `confirmation_method` text NN check(in ('reauth','email_otp','admin')), check(kind <> 'history' or confirmation_method in ('reauth','admin')) (R-16: history deletion requires the same re-auth as account deletion).
  - `status_token_hash` bytea check(octet_length=32): sha256 of the one-time status token returned to a web requester; `public-api GET /data-deletion/:requestId/status?token=` compares it in constant time.
  - `reason` text check(≤500).
  - `steps` jsonb NN ='{}' (`{watches_stopped, provider_revoke:{google:'revoked'|'failed', microsoft:'local_only'}, apple_siwa_revoked, revenuecat_deleted, storage_purged, embeddings_purged, tokens_purged, db_purged, auth_user_deleted}`).
  - `job_id` uuid.
  - `completed_at`, `failed_at` timestamptz, `error_code` text.
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` **on delete set null** (the row survives account deletion with `subject_hash`).
- **Unique:** `(user_id, kind) where status in ('requested','verified','queued','processing')`.
- **Indexes:** `(status, created_at)`; `(subject_hash)`.
- **RLS:** OWN-R (while the user exists).
- **Retention:** 3 years (legal proof of deletion).
- **Sensitive:** Hashes only after completion.
- **Audit:** `privacy.deletion_requested`, `privacy.deletion_completed` / `failed`; admin retry → `data_request.retried` (reason).

#### `privacy_tombstones`
- **Purpose:** Referral anti-abuse after account deletion without keeping raw identifiers (plan §16 "delete-and-recreate"; SECURITY_AND_PRIVACY_PLAN THR-15).
- **Columns:** `id` bigint identity; `kind` text NN check(in ('email','installation','apple_sub')); `signal_hash` bytea NN check(octet_length=32) (`HMAC(HASH_PEPPER_V1, kind ‖ ':' ‖ normalised value)`); `reason` text NN ='account_deleted' check(in ('account_deleted','admin_rejected_abuse')); `created_at` timestamptz NN =now(); `expires_at` timestamptz NN =now()+interval '12 months'.
- **PK:** `id`.
- **FKs:** None, by design (never linked to a user id).
- **Unique:** `(kind, signal_hash)` (a later deletion extends `expires_at`).
- **Indexes:** `(expires_at)`.
- **RLS:** **SYS.** Written by the `account_deletion` job; read only by `referral_evaluate` (a match → `referrals.status='rejected'`, `reject_reason='tombstoned'`).
- **Retention:** Deleted at `expires_at` (12 months) by `retention_cleanup`.
- **Sensitive:** Pseudonymous hashes only.
- **Audit:** None per row (the deletion itself is audited).

---

### 4.9 Admin

**Permission catalogue and matrix.** Permission strings are exactly BACKOFFICE_PLAN §4.1 (R-20). They are stored in `private.admin_role_permissions (role admin_role NN, permission text NN check(permission ~ '^[a-z_]+(\.[a-z_]+){1,2}$'), primary key (role, permission))`, a table seeded in 0012 with the matrix below and mirrored in `packages/domain/rbac.ts`; a unit test and pgTAP `120` assert row-for-row parity. `private.require_admin` looks permissions up in this table (§6.8).

| Permission | super_admin | operations | support | finance | ai_ops | analyst | readonly |
|---|---|---|---|---|---|---|---|
| `dashboard.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `metrics.ops.read` | ✓ | ✓ | — | — | ✓ | ✓ | ✓ |
| `metrics.ai.read` | ✓ | ✓ | — | — | ✓ | ✓ | ✓ |
| `metrics.revenue.read` | ✓ | — | — | ✓ | — | ✓ | — |
| `metrics.product.read` | ✓ | ✓ | — | ✓ | — | ✓ | ✓ |
| `users.read` (masked) | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| `users.pii.reveal` | ✓ | — | ✓ | — | — | — | — |
| `users.force_sync` | ✓ | ✓ | ✓ | — | — | — | — |
| `users.disable` (disable and restore) | ✓ | ✓ | — | — | — | — | — |
| `users.mark_internal` | ✓ | ✓ | — | — | — | — | — |
| `integrations.read` | ✓ | ✓ | ✓ | — | — | — | ✓ |
| `integrations.disconnect` | ✓ | ✓ | — | — | — | — | — |
| `integrations.renew_watch` | ✓ | ✓ | — | — | — | — | — |
| `jobs.read` | ✓ | ✓ | ✓ | — | ✓ | — | ✓ |
| `jobs.retry`, `jobs.cancel` | ✓ | ✓ | — | — | — | — | — |
| `briefings.read` | ✓ | ✓ | ✓ | — | ✓ | — | ✓ |
| `briefings.regenerate` | ✓ | ✓ | — | — | — | — | — |
| `notifications.read` | ✓ | ✓ | ✓ | — | — | — | ✓ |
| `push.test` | ✓ | ✓ | — | — | — | — | — |
| `ai.read` | ✓ | ✓ | — | — | ✓ | — | ✓ |
| `ai.models.write` | ✓ | — | — | — | ✓ | — | — |
| `prompts.read` | ✓ | ✓ | — | — | ✓ | — | ✓ |
| `prompts.write`, `prompts.activate` | ✓ | — | — | — | ✓ | — | — |
| `ai_feedback.read` | ✓ | — | — | — | ✓ | — | ✓ |
| `ai_feedback.reveal` | ✓ | — | — | — | ✓ | — | — |
| `subscriptions.read` | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| `billing_events.read` | ✓ | — | — | ✓ | — | — | ✓ |
| `subscriptions.resync` | ✓ | — | ✓ | ✓ | — | — | — |
| `entitlements.grant` | ✓ | — | — | ✓ | — | — | — |
| `entitlements.grant_limited` | ✓ | — | ✓ | — | — | — | — |
| `entitlements.revoke` | ✓ | — | — | ✓ | — | — | — |
| `referrals.read` | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| `referrals.review` | ✓ | — | — | ✓ | — | — | — |
| `support.read` | ✓ | ✓ | ✓ | — | — | — | ✓ |
| `support.write`, `support.access` | ✓ | — | ✓ | — | — | — | — |
| `feedback.read` | ✓ | ✓ | ✓ | — | ✓ | — | ✓ |
| `feedback.write` | ✓ | ✓ | ✓ | — | — | — | — |
| `flags.read` | ✓ | ✓ | — | — | ✓ | — | ✓ |
| `flags.write` | ✓ | ✓ | — | — | — | — | — |
| `flags.write_ai` | ✓ | ✓ | — | — | ✓ | — | — |
| `announcements.read` | ✓ | ✓ | ✓ | — | — | — | ✓ |
| `announcements.write` | ✓ | ✓ | — | — | — | — | — |
| `data_requests.read` | ✓ | ✓ | ✓ | — | — | — | ✓ |
| `data_requests.manage` | ✓ | ✓ | ✓ | — | — | — | — |
| `audit.read` | ✓ | ✓ | ✓ | — | — | — | ✓ |
| `health.read` | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| `health.run` | ✓ | ✓ | — | — | — | — | — |
| `admins.read` | ✓ | ✓ | — | — | — | — | ✓ |
| `admins.manage`, `settings.system.write` | ✓ | — | — | — | — | — | — |
| `search.global` | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |

Argument-dependent rules: `entitlement_grant` accepts `entitlements.grant_limited` only for 1 or 7 days with source `support`; flag mutations on `ai.*` / `voice.*` keys accept `flags.write_ai`; Support Access (`support.access`) is limited to `support` and `super_admin` (R-09). `analyst` sees aggregates only; `readonly` sees masked views with no reveal and no mutation.

#### `admin_users`
- **Columns:**
  - `user_id` uuid NN.
  - `role` admin_role NN.
  - `status` admin_status NN ='invited'.
  - `display_name` text NN check(1..80), `email` citext NN.
  - `mfa_required` boolean NN =true check(mfa_required).
  - `invited_by` uuid, `invited_at` timestamptz NN =now().
  - `activated_at` timestamptz.
  - `disabled_at`, `disabled_by` uuid, `disabled_reason` text.
  - `last_login_at` timestamptz.
  - ⟨TS⟩.
- **PK:** `user_id`.
- **FKs:** `user_id` → `auth.users` **on delete restrict**. `invited_by` / `disabled_by` → `admin_users` set null.
- **Unique:** `(email)`.
- **Indexes:** `(role, status)`.
- **RLS:** **SYS** + restrictive aal2. The token hook reads it as a definer.
- `trg_admin_users_last_super_admin` (§6.8).
- `trg_admin_users_identity` (R-08): the auth user must carry `raw_app_meta_data->>'da_kind' = 'admin'` and must have no `profiles` row; an existing app-user email can never become an admin (`EMAIL_IN_USE_BY_APP_USER`). `api` and `public-api` reject admin JWTs.
- **Retention:** Permanent (disabled, never deleted).
- **Sensitive:** Admin email.
- **Audit:** `admin.invited`, `admin.role_changed`, `admin.disabled`, `admin.enabled`.

#### `admin_sessions`
- **Columns:**
  - `id` uuid.
  - `admin_user_id` uuid NN.
  - `auth_session_id` uuid NN (JWT `session_id`).
  - `aal` text NN check(='aal2').
  - `created_at` timestamptz NN =now(), `last_activity_at` timestamptz NN =now().
  - `idle_expires_at` timestamptz NN (= last_activity + 30 min), `absolute_expires_at` timestamptz NN (= created + 12 h).
  - `ended_at` timestamptz, `end_reason` text check(in ('logout','idle_timeout','absolute_timeout','revoked_all','admin_disabled')).
  - `ip_hash` bytea, `user_agent` text check(≤300).
- **PK:** `id`.
- **FKs:** `admin_user_id` → `admin_users` cascade.
- **Unique:** `(auth_session_id)`.
- **Indexes:** `(admin_user_id) where ended_at is null`.
- **RLS:** **SYS** + aal2. `private.require_admin` validates and touches the session.
- **Retention:** 180 days.
- **Sensitive:** IP hash.
- **Audit:** `admin.login`, `admin.logout`, `admin.sessions_revoked`.

#### `admin_preferences`
- **Columns:**
  - `admin_user_id` uuid NN.
  - `theme` text NN ='light' check(in ('light','dark','system')) (M§72).
  - `locale` text NN ='tr-TR'.
  - `table_prefs` jsonb NN ='{}' (column visibility and page size per table).
  - `updated_at` timestamptz NN =now().
- **PK:** `admin_user_id`.
- **FKs:** `admin_user_id` → `admin_users` cascade.
- **Unique:** PK.
- **Indexes:** PK.
- **RLS:** **SYS**; read and written via `admin_api.admin_preferences_get|set` (own row only).
- **Retention:** With the admin.
- **Sensitive:** None.
- **Audit:** None.

#### `admin_mfa_recovery_codes`
- **Purpose:** One-time MFA recovery codes for admins (BACKOFFICE_PLAN §3.4); Supabase has no native recovery codes. TOTP stays mandatory (`aal2`).
- **Columns:** `id` uuid; `admin_user_id` uuid NN; `code_hash` bytea NN check(octet_length=32) (`HMAC_SHA256(RECOVERY_CODE_PEPPER, code)`); `created_at` timestamptz NN =now(); `used_at` timestamptz; `replaced_at` timestamptz.
- **PK:** `id`.
- **FKs:** `admin_user_id` → `admin_users(user_id)` cascade.
- **Unique:** `(code_hash)`.
- **Indexes:** `(admin_user_id) where used_at is null and replaced_at is null`.
- **RLS:** **SYS** + restrictive aal2. Written only by `admin-api` with the secret key: generation marks earlier unused codes `replaced_at`; redemption is a single `update … where used_at is null and replaced_at is null returning`.
- **Retention:** Used or replaced codes are deleted after 90 days; the rest live with the admin.
- **Sensitive:** Hashes only; plaintext codes are shown once.
- **Audit:** `admin.recovery_codes_regenerated`, `admin.mfa_recovery_used`.

#### `audit_logs`
- **Purpose:** Immutable, hash-chained record of sensitive actions (M§66, §48; ADR-05).
- **Columns:**
  - `id` bigint identity.
  - `chain_seq` bigint NN.
  - `occurred_at` timestamptz NN =clock_timestamp().
  - `actor_type` text NN check(in ('admin','user','system','worker')), `actor_id` uuid, `actor_role` text (admin role snapshot).
  - `action` text NN check(action ~ '^[a-z_]+(\.[a-z_]+){1,3}$').
  - `target_type` text, `target_id` text.
  - `target_user_id` uuid. This is **not** an FK: after account deletion the random uuid links to nothing.
  - `reason` text check(≤1000), check(actor_type <> 'admin' or action like '%.read%' or reason is not null).
  - `result` text NN check(in ('success','failure','denied')).
  - `details` jsonb NN ='{}' (masked; never content, tokens or raw emails).
  - `correlation_id` uuid.
  - `ip_hash` bytea.
  - `prev_hash` bytea, `row_hash` bytea NN.
- **PK:** `id`.
- **FKs:** None, by design.
- **Unique:** `(chain_seq)`.
- **Indexes:** `(occurred_at desc)`; `(actor_id, occurred_at desc)`; `(target_user_id, occurred_at desc)`; `(action, occurred_at desc)`.
- **RLS:** **SYS** + restrictive aal2. Inserts happen only through `private.audit_log_append` (§6.7). Append-only (§3.6).
- **Retention:** **Never deleted** (M§66). No delete function exists.
- **Sensitive:** Details are masked.
- **Audit:** It is the audit log. `admin_api.audit_verify` itself writes `audit.verified`.

#### `support_tickets`
- **Columns:**
  - `id` uuid.
  - `public_ref` text NN (`'DA-'‖to_char(created_at,'YYYY')‖'-'‖lpad(seq,6,'0')`).
  - `user_id` uuid.
  - `category` ticket_category NN, `status` ticket_status NN ='open'.
  - `priority` text NN ='normal' check(in ('low','normal','high','urgent')).
  - `subject` text NN check(1..200), `message` text NN check(1..5000).
  - `contact_email` citext.
  - `platform` text check(in ('ios','android','web')), `app_version` text.
  - `origin` text NN check(in ('app','web','email')).
  - `assigned_admin_id` uuid.
  - `first_response_at`, `resolved_at`, `closed_at` timestamptz.
  - ⟨TS⟩.
- **PK:** `id`.
- **FKs:** `user_id` → `auth.users` **set null** (the account deletion job also nulls `contact_email`). `assigned_admin_id` → `admin_users` set null.
- **Unique:** `(public_ref)`.
- **Indexes:** `(status, category, created_at desc)`; `(user_id)`; `(assigned_admin_id) where status in ('open','in_progress')`.
- **RLS:** OWN-R with `grant select (id, public_ref, user_id, category, status, subject, created_at, updated_at)` (help screen). Insert goes via `api` / `public-api` (rate-limited).
- **Retention:** 2 years after close.
- **Sensitive:** Message and email (masked in lists).
- **Audit:** `support.ticket_updated`.

#### `support_notes`
- **Columns:**
  - `id` uuid.
  - `ticket_id` uuid NN.
  - `user_id` uuid (the ticket's user; retention).
  - `author_admin_id` uuid NN.
  - `body` text NN check(1..5000).
  - `created_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `ticket_id` → `support_tickets` cascade. `author_admin_id` → `admin_users` restrict. `user_id` → `auth.users` set null.
- **Unique:** —
- **Indexes:** `(ticket_id, created_at)`.
- **RLS:** **SYS** + aal2. Append-only (no update grant).
- **Retention:** With the ticket.
- **Sensitive:** Internal.
- **Audit:** `support.note_added`.

#### `support_access_grants`
- **Purpose:** Time-boxed, reasoned access to sensitive user content. There is no impersonation (M§49, §71).
- **Columns:**
  - `id` uuid.
  - `admin_user_id` uuid NN.
  - `user_id` uuid NN (subject).
  - `ticket_id` uuid.
  - `scope` support_access_scope[] NN check(cardinality(scope) ≥1) (R-09: `pii` unmask identifiers · `email_metadata` subjects, senders, snippets · `insights` insight titles, AI summaries, briefing text · `notifications` rendered push text · `captures` extracted data only, never files · `assistant_transcript` · `ai_feedback` comments). Never grantable: tokens, secrets, passwords, provider fetch of original mail, attachments or files.
  - `reason` text NN check(char_length ≥15).
  - `starts_at` timestamptz NN =now(), `expires_at` timestamptz NN, check(expires_at - starts_at in (interval '15 minutes', interval '30 minutes', interval '60 minutes')) (R-09: 15 / 30 / 60 min, max 60).
  - `revoked_at` timestamptz, `revoked_by` uuid.
  - `expired_audited_at` timestamptz (set by the `scheduler_tick` expiry sweep).
  - `reveal_count` integer NN =0.
  - `created_at` timestamptz NN =now().
- **PK:** `id`.
- **FKs:** `admin_user_id` → `admin_users` restrict. `user_id` → `auth.users` cascade. `ticket_id` → `support_tickets` set null.
- **Unique:** —
- **Indexes:** `(user_id, expires_at) where revoked_at is null`; `(admin_user_id)`.
- **RLS:** **SYS** + aal2.
- **Retention:** 2 years.
- **Sensitive:** None itself.
- **Audit:** `support_access.granted` / `revoked`. **Every** reveal writes `pii.reveal` with `{grant_id, resource_type, resource_id}`.

---

## 5. Relationship summary (FK cascade map)

- `auth.users` delete cascades to every ⟨OWN⟩ table.
- It sets null in `ai_requests`, `analytics_events`, `billing_events`, `webhook_events`, `referrals`, `data_deletion_requests`, `support_tickets` and `support_notes`.
- It is **restricted** by `admin_users`.
- `connected_accounts` → cascades to `oauth_credentials`, `calendars`, `sync_states`, `provider_quota_usage`, `email_threads`, `email_messages`, `calendar_events`, `tasks` (provider) and `reply_drafts`.
- `email_threads` → cascades to `email_messages` and `reply_drafts`.
- `calendar_events` → cascades to `meeting_notes` and `meeting_preps`.
- `briefings` → `briefing_items`; `approval_actions` → `approval_events`; `assistant_threads` → `assistant_messages`; `notifications` → `push_tickets`; `jobs` → `job_attempts`.
- `prompt_versions` → cascades to `ai_result_cache`; `admin_users` → cascades to `admin_mfa_recovery_codes`; `app_installations` → sets null in `approval_actions.device_installation_id`; `calendars` → sets null in `user_preferences.default_write_calendar_id`; `approval_actions` → sets null in `oauth_states.approval_id`.

**Rule enforced by test 001:** every FK column has a supporting index whose leading column is the FK.

---

## 6. Functions and RPCs catalogue

All functions: `language plpgsql` unless noted, `set search_path = ''`, fully qualified names, `revoke execute … from public`. "SD" = SECURITY DEFINER, "SI" = SECURITY INVOKER.

### 6.1 Core helpers (`private`)

| Signature | Lang | Sec | Grants | Purpose |
|---|---|---|---|---|
| `private.set_updated_at() returns trigger` | plpgsql | SI | — | Trigger |
| `private.handle_new_user() returns trigger` | plpgsql | SD | trigger on `auth.users` AFTER INSERT | Inserts `profiles`, `user_preferences` (timezone from `raw_user_meta_data->>'timezone'` if valid), `notification_preferences`, `referral_codes` (retry ×5 on collision). Skips identities with `raw_app_meta_data->>'da_kind' = 'admin'` (R-08: dedicated admin identities get no profile, preferences or referral code) |
| `private.compute_expires_at(p_user uuid, p_anchor timestamptz) returns timestamptz` | sql stable | SD | service_role | `d30`/`d90`/`d365` → anchor + interval; `until_deleted` → null |
| `private.set_expires_at() returns trigger` | plpgsql | SD | — | Trigger; anchor column passed as `TG_ARGV[0]` |
| `private.valid_evidence(jsonb) / valid_ai_data_access(jsonb) / valid_data_source_toggles(jsonb) / valid_rule_condition(rule_condition, jsonb) returns boolean` | sql immutable | SI | — | Check helpers |
| `private.immutable_unaccent(text) returns text` | sql immutable | SI | authenticated (used in index expressions) | Trigram / accent-insensitive |
| `private.mask_email(citext) returns text` | sql immutable | SI | — | `yunus@gmail.com` → `yu***@gmail.com` (M§71) |
| `private.hash_subject(uuid) returns bytea` | sql immutable | SI | — | `sha256('da-subject-v1:'‖id)` |
| `private.is_pro(p_user uuid) returns boolean` | sql stable | SD | — | `effective_entitlement` `is_active` |
| `private.plan_limit(p_user uuid, p_key text) returns jsonb` | sql stable | SD | — | `plan_limits.value` for the user's effective plan (`pro` when `effective_entitlement.is_active`, else `free`) |
| `private.account_can(p_account uuid, p_cap capability) returns boolean` | sql stable | SD | service_role | Effective capability (§4.2) |
| `private.evaluate_flags(p_user uuid, p_platform platform, p_app_version text) returns jsonb` | plpgsql stable | SD | service_role | Flags + overrides + kill switches |
| `private.custom_access_token_hook(event jsonb) returns jsonb` | plpgsql stable | SD | **only** `supabase_auth_admin` (execute) + `usage on schema private` | Adds `admin_role` only when an `admin_users` row is `active`; otherwise removes it (ADR-06) |
| `private.mask_name(text) returns text` | sql immutable | SI | — | "Yunus Emre" → "Y*** E***" (M§71) |
| `private.mask_push_token(text) returns text` | sql immutable | SI | — | Keeps only the last 4 characters |
| `private.valid_plan_limit(p_key text, p_value jsonb) / valid_app_setting(p_key text, p_value jsonb) returns boolean` | sql immutable | SI | — | Type and bounds per key (§4.6, §4.7) |
| `private.model_routable(text) / targets_routable(jsonb, jsonb) returns boolean` | sql immutable | SI | — | ADR-44 Covered-Model exclusion (`claude-fable-%`, `claude-mythos-%`) used by the `ai_model_config` check |
| `private.consume_provider_quota(p_bucket text, p_account uuid, p_units int, p_limit int, p_window_seconds int) returns int` | plpgsql | SD | service_role | Upserts the window row in one statement and returns `wait_ms` (0 = admitted) |
| `private.try_lock_credential_refresh(p_account uuid, p_owner text, p_seconds int default 30) returns boolean` | plpgsql | SD | service_role | Atomic `update … where refresh_lock_until is null or refresh_lock_until < now() returning` on the account's access-token row |
| `private.user_apple_sub(p_user uuid) returns text` | sql stable | SD | service_role | Apple `sub` from `auth.identities` (provider `apple`) for SIWA revocation at account deletion |
| `private.assert_admin_gateway() returns void` | plpgsql stable | SD | — | Raises `ADMIN_GATEWAY_REQUIRED` unless sha256 of the `x-da-admin-gateway` request header equals `app_settings['admin.gateway_secret_sha256']` (constant-time); blocks direct PostgREST calls to `admin_api`. Vault stays limited to the two ADR-04 secrets |
| `private.fail_stale_device_approvals(p_now timestamptz) returns int` | plpgsql | SD | — | Device-executor approvals still `executing` 10 min after `executing_at` → `failed` (`DEVICE_RESULT_MISSING`, §6.6) |
| `private.rollup_metrics_daily(p_day date) returns jsonb` | plpgsql | SD | — | Idempotent delete and re-insert of one day in `metrics_daily` / `ai_metrics_daily`; called by `scheduler_tick` |
| `private.ai_breaker_state(p_provider text, p_model text) returns jsonb` | sql stable | SD | service_role | `{open, error_rate, since}` from the last 60 s of `ai_requests` (circuit breaker) |
| `private.memory_stats(p_user uuid) returns jsonb` | sql stable | SD | service_role | `{chunks, embedded, pending_embedding, by_kind}` for the Memory screen and support views |
| `private.job_admin_policy(p_type job_type) returns jsonb` | sql immutable | SI | — | `{retryable_by_admin, cancellable, max_manual_retries}` used by `admin_api.job_retry` / `job_cancel` |
| `private.upsert_learned_preference(p_user uuid, p_target_type text, p_target_ref text, p_group_key text, p_effect jsonb, p_evidence_delta int) returns uuid` | plpgsql | SD | service_role | No-op when `learn_from_interactions=false` or a tombstone exists (§4.4) |

### 6.2 Jobs

| Signature | Sec | Grants | Behaviour |
|---|---|---|---|
| `public.enqueue_job(p_type job_type, p_idempotency_key text, p_payload jsonb default '{}', p_user_id uuid default null, p_account_id uuid default null, p_run_after timestamptz default now(), p_priority smallint default 100, p_max_attempts int default 5, p_correlation_id uuid default null) returns uuid` | SD (wraps `private.enqueue_job`) | service_role | `insert … on conflict (idempotency_key) do nothing`, then returns the existing or new id |
| `public.claim_jobs(p_worker_id text, p_types job_type[], p_limit int default 10, p_lease_seconds int default 120) returns setof public.jobs` | SD | service_role | See the SQL sketch below |
| `public.extend_job_lease(p_job_id uuid, p_worker_id text, p_seconds int) returns boolean` | SD | service_role | Only if `lease_owner = p_worker_id` |
| `public.complete_job(p_job_id uuid, p_worker_id text, p_result jsonb default null) returns void` | SD | service_role | `status='completed'`, `completed_at`, finalizes `job_attempts`. A lease mismatch raises `LEASE_LOST`. |
| `public.fail_job(p_job_id uuid, p_worker_id text, p_error_code text, p_error_message text, p_retryable boolean default true, p_retry_after_seconds int default null) returns job_status` | SD | service_role | See the backoff rule below |
| `public.update_job_progress(p_job_id uuid, p_worker_id text, p_progress jsonb) returns void` | SD | service_role | First Analysis counters |
| `private.reap_expired_leases(p_now timestamptz) returns int` | SD | — | `running` with `lease_expires_at < p_now` → handled like `fail_job(retryable, 'LEASE_EXPIRED')` |
| `private.poke_worker(p_reason text default 'cron') returns bigint` | SD | — | `net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name='da_project_url')‖'/functions/v1/worker', headers := jsonb_build_object('apikey', <da_cron_secret>, 'x-da-reason', p_reason), body := '{}', timeout_milliseconds := 2000)`. Only sends if `exists(select 1 from public.jobs where status in ('queued','retrying') and run_after <= now())`. |

`claim_jobs` claim statement:

```sql
with c as (
  select id from public.jobs
  where status in ('queued','retrying') and run_after <= now() and type = any(p_types)
  order by priority, run_after
  limit p_limit
  for update skip locked
)
update public.jobs j
  set status = 'running', attempts = attempts + 1, lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      started_at = coalesce(started_at, now())
  from c where j.id = c.id returning j.*;
```

`claim_jobs` also inserts one `job_attempts` row per claimed job.

`fail_job` backoff: if `not p_retryable` → `failed`. Else if `attempts >= max_attempts` → `dead_letter` + `dead_lettered_at`. Else `retrying` with `run_after = now() + coalesce(p_retry_after_seconds, least(3600, 30 * 2^(attempts-1)) * (0.8 + random()*0.4))` seconds (a provider `Retry-After` overrides the computed delay).

**Idempotency key catalogue** (used by `scheduler_tick`, `api` and webhooks):

| Key pattern | Job / purpose |
|---|---|
| `briefing:{user}:{kind}:{local_date}` | briefing |
| `meeting_prep:{event_id}:{start_at_epoch}` | meeting_prep |
| `post_meeting:{event_id}` | post-meeting prompt |
| `watch_renewal:{sync_state_id}:{utc_hour}` | watch_renewal |
| `reconciliation:{account}:{utc_6h_bucket}` | reconciliation |
| `tasks_sync:{account}:{utc_15min_bucket}` | tasks_sync |
| `rebaseline:{sync_state_id}:{local_date}` | Graph calendarView re-baseline |
| `reminder:{reminder_id}` | reminder push |
| `nudge:{insight_id}:{local_date}` | deadline / follow-up nudge |
| `approval_execute:{approval_id}:v{payload_version}` | approval_execute |
| `webhook:{source}:{external_id}` | provider_webhook |
| `billing:{rc_event_id}` | billing_sync |
| `referral_evaluate:{referral_id}:{utc_date}` | referral_evaluate |
| `retention:{utc_date}` / `retention_recompute:{user}:{updated_at_epoch}` | retention |
| `export:{request_id}` | export |
| `deletion:{request_id}` | history_deletion / account_deletion |
| `first_analysis:{user}` | first_analysis |
| `initial_sync:{account}:{connected_at_epoch}` | initial_sync |
| `push_receipts:{utc_5min_bucket}` | push_receipts |
| `health:{utc_5min_bucket}` | health_check |
| `embedding:{user}:{utc_minute}` | embedding |
| `capture_analysis:{capture_id}` | capture_analysis |
| `credential_reencrypt:{utc_date}` | credential_reencrypt (daily, from `da_reconciliation`) |
| `integration_purge:{account}:{disconnected_at_epoch}` (binding expiry uses the `pending_binding_until` epoch) | integration_purge |
| `ai_batch:{feature}:{utc_hour}` | ai_batch (Message Batches submit / collect / purge) |
| `ai_eval:{feature}:{iso_week}` | ai_eval (staging evals, weekly calibration refit) |
| `briefing_audio:{briefing_id}:{version}` | briefing_audio |
| `transactional_email:{template}:{request_id}` | transactional_email (deletion confirmation, admin invite, ticket reply) |
| `meeting_prep_notify:{event_id}:{start_at_epoch}` | notification (prep push, R-23) |
| `insight_refresh:{user}:{utc_minute}` | insight_refresh (incl. `payload.scope='learned_preferences'`) |

### 6.3 `private.scheduler_tick(p_now timestamptz default now()) returns jsonb`

- **Security:** SD. Called by pg_cron every minute. `p_now` makes the function deterministic in tests.
- **Concurrency:** `pg_try_advisory_xact_lock(hashtext('da_scheduler_tick'))`. If the lock is not acquired it returns `{"skipped":"locked"}`, so overlapping ticks are no-ops.

Steps (each step is bounded by a `LIMIT` and the function returns counts):

1. **Reap leases:** `private.reap_expired_leases(p_now)`.
2. **Briefings (DST-safe).** For each user with `profiles.state='active'` (join `user_preferences`, limit 5000 per tick, ordered by `user_id`):
   - `local_ts := p_now at time zone up.timezone`, `local_date := local_ts::date`, `local_time := local_ts::time`, `iso_dow := extract(isodow from local_ts)`.
   - For each kind with its slot:
     - morning: `morning_time`, or `weekend_morning_time` when iso_dow ∈ {6,7}.
     - midday: `midday_time`; skipped on weekends when `weekend_morning_only`.
     - evening: `evening_time`; same weekend rule.
     - weekly: `weekly_time` only when `iso_dow = weekly_dow`.
   - Eligibility: `<kind>_enabled` ∧ `iso_dow = any(briefing_weekdays)` (weekly ignores this) ∧ `local_time >= slot` ∧ `local_time < slot + interval '3 hours'` (catch-up window) ∧ no `briefings` row for `(user, kind, local_date)`.
   - Then: `insert into briefings(..., scheduled_for := (local_date + slot) at time zone tz, idempotency_key := 'briefing:'||user||':'||kind||':'||local_date, status := 'scheduled') on conflict do nothing`. On insert, `enqueue_job('briefing', same key, {briefing_id})`.
   - Entitlement and flags are evaluated by the worker, which sets `skipped` + `skipped_reason`. Midday evaluates "meaningful delta" there (C-21).
   - **DST correctness:**
     - Evaluation uses local wall time each minute. A slot that falls inside a spring-forward gap fires at the first existing local minute after it.
     - A fall-back repeated hour cannot double-fire, because `(user, kind, local_date)` is unique.
     - `scheduled_for` is computed with `AT TIME ZONE` (PG resolves gap times forward).
     - `Europe/Istanbul` has no DST; tests also cover `Europe/Berlin` and `America/New_York`.
3. **Meeting prep (R-23):**
   - **3a precompute:** `calendar_events` with `start_at between p_now + interval '45 minutes' and p_now + interval '60 minutes'`, status ≠ cancelled, with an external attendee (an attendee email domain outside the domains of the user's `connected_accounts.account_email`) or a VIP attendee, user Pro, flag `feature.meeting_prep` on, and no `ready` `meeting_preps` row → enqueue `meeting_prep` (key `meeting_prep:{event_id}:{start_at_epoch}`). Every other meeting gets its prep on tap ("Hazırlan", `POST /meetings/:eventId/prep`).
   - **3b prep notification:** events with attendee_count ≥ 1 whose `start_at` is in `[p_now + lead, p_now + lead + 1 min)`, where `lead = notification_preferences.meeting_prep_lead_min` (15–30), user Pro, category `meeting` on → enqueue `notification` (key `meeting_prep_notify:{event_id}:{start_at_epoch}`). The push opens the prep screen, which generates on tap when nothing was precomputed.
4. **Post-meeting prompt:** events with `end_at between p_now - 2 min and p_now` and attendee_count ≥ 1 → enqueue `notification` with key `post_meeting:{event_id}`.
5. **Watch renewals:** `sync_states.watch_renew_after <= p_now` → `watch_renewal`.
6. **Graph re-baseline:** `rebaseline_due_at <= p_now` → `calendar_sync {mode:'rebaseline'}`.
7. **Tasks poll:** accounts with the `tasks_read` capability, every 15 min bucket → `tasks_sync`.
8. **Reminders:** `status='scheduled' and remind_at <= p_now + interval '1 minute'` → `notification` with key `reminder:{id}`.
9. **Approval expiry:** `pending and approval_expires_at < p_now` → `private.transition_approval(id,'expired','system',null,null,'expired')`, limit 500.
10. **Snooze wake-ups:** `insights`/`commitments`/`life_events` with `snoozed_until <= p_now` → set back to `open`.
11. **Nudges:** open deadline/follow-up insights whose `due_at` falls within [local 09:00 window] → `nudge:*` (the notification engine applies caps).
12. **Referral qualification sweep:** `pending` referrals whose referee now meets the conditions → `referral_evaluate`.
13. **Device approvals:** `private.fail_stale_device_approvals(p_now)` (limit 500).
14. **Budget holds:** unsettled `ai_budget_reservations` with `hold_until < p_now` are released from `ai_usage_daily.reserved_*` and deleted (limit 1000).
15. **OAuth binding expiry (R-07):** `connected_accounts` with `pending_binding_until < p_now` → enqueue `integration_purge` (revoke at Google, delete credentials and the row, audit `integration.binding_expired`).
16. **Support Access expiry:** grants with `expires_at <= p_now`, `revoked_at is null` and `expired_audited_at is null` → audit `support_access.expired` (system) and set `expired_audited_at`.
17. **Metric rollups:** when `extract(minute from p_now)::int % 15 = 0`, `private.rollup_metrics_daily` for today and yesterday (days in `app_settings.metrics.reporting_timezone`); at 03:30 UTC also for day − 2 (final). No extra cron job (§9 stays at 8).
18. **Poke** the worker if anything was enqueued.

### 6.4 Retention

`private.retention_cleanup(p_batch int default 5000, p_now timestamptz default now()) returns jsonb`

- **Security:** SD. The `retention` worker job calls it in a loop until every count is 0.
- **Deletes with `expires_at < p_now`:** `email_messages`, `email_threads` (only when no messages remain), `calendar_events`, `tasks` (non-open), `commitments` (non-open), `reminders` (non-scheduled), `meeting_notes`, `meeting_preps`, `life_events`, `captures` (**returns** `storage_path[]`), `android_notification_signals`, `insights`, `briefing_items`, `briefings` (**returns** the audio paths of every version), `reply_drafts` (**returns** attachment paths), `approval_actions` (non-pending), `assistant_threads` (cascading messages), `memory_chunks`, `notifications`, `ai_result_cache`.
- **System TTLs:**

| Table | TTL |
|---|---|
| `oauth_states` | 1 d |
| `webhook_events` | 30 d |
| `provider_quota_usage` | 7 d |
| `push_tickets` | 7 d |
| `rate_limits` | 1 d |
| `system_health_checks` | 30 d |
| `ai_requests` | 180 d |
| `ai_usage_daily` | 400 d |
| `analytics_events` | 400 d |
| `jobs` | completed 14 d; failed/dead 90 d |
| `app_installations` | 180 d since last seen |
| `push_tokens` | disabled 30 d |
| `priority_rules` | soft-deleted 30 d |
| `feature_flag_overrides` | expired |
| `data_export_requests` | artifact at `expires_at` → status `expired`, **returns** path |
| `referrals` | terminal 365 d |
| `ai_feedback` | 365 d |
| `admin_sessions` | 180 d |
| `api_idempotency_keys` | at `expires_at` (24 h) |
| `ai_budget_reservations` | settled 1 d (unsettled holds are released by `scheduler_tick`) |
| `ai_batches` | 90 d after `purged_at` |
| `privacy_tombstones` | at `expires_at` (12 months) |
| `admin_mfa_recovery_codes` | used or replaced 90 d |
| `metrics_daily`, `ai_metrics_daily`, `web_analytics_daily` | 25 months (anonymous aggregates) |
| `captures` in `pending_upload` | 1 h |

- Contacts are pruned by the §4.3 rule.
- The result `{deleted:{table:count}, storage_paths:{bucket:[...]}}` lets the worker delete objects through the Storage API; deleting `storage.objects` rows directly does not remove the blobs.

`private.recompute_expires_at(p_user uuid, p_batch int) returns int` (SD) recomputes `expires_at` for every ⟨EXP⟩ table in batches after a retention policy change.

`private.purge_user_history(p_user uuid) returns jsonb` (SD): history deletion (C-§4.7 scope).
- Deletes insights, briefings, briefing_items, memory_chunks, assistant_threads, learned_preferences (including tombstones), ai_feedback, email_threads/messages, past calendar_events, meeting_notes/preps, life_events, captures (returns paths), commitments, non-scheduled reminders, non-pending approvals, reply_drafts (returns attachment paths), notifications, android signals and `ai_result_cache` rows.
- Sets `sync_states.backfill_until = now()` so history is not re-ingested.
- **Keeps** connections, credentials, settings, VIP, priority rules, future events, provider tasks, subscriptions and referrals (PRIMARY 7.4 "Korunan: bağlantılar, ayarlar, VIP listesi").

### 6.5 Plan limits, entitlements, budgets, rate limits

| Signature | Sec | Grants | Purpose |
|---|---|---|---|
| `public.effective_entitlement(p_user_id uuid default auth.uid()) returns table(entitlement text, is_active boolean, source text, is_trial boolean, will_renew boolean, store_expires_at timestamptz, grant_ends_at timestamptz, active_until timestamptz)` | SD, stable | authenticated, service_role | Raises `FORBIDDEN` if `auth.role() <> 'service_role' and p_user_id is distinct from auth.uid()`. `source` ∈ `store` / `grant` / `none` (store wins when both are active). `active_until = greatest(store expiry if active, max(ends_at) of unrevoked grants covering now)` (ADR-11). |
| `public.check_plan_limit(p_key text, p_increment int default 1, p_user_id uuid default auth.uid()) returns jsonb` | SD, stable | authenticated, service_role | `{allowed, limit, used, plan, resets_at}` for count keys (`max_mail_accounts`, `max_calendar_accounts`, `max_calendars`, `vip_max`, `priority_rules_max`) and daily quota keys (`captures_daily`, `assistant_messages_daily`, `email_analysis_daily`, `reply_drafts_daily`, `meeting_preps_daily`, `semantic_search_daily`, `transcribe_seconds_daily`; reset at local midnight); feature keys return `{allowed: value}` |
| `private.enforce_plan_limit() returns trigger` | SD | — | Used by `trg_connected_accounts_plan_limit` (BEFORE INSERT OR UPDATE OF status; counts non-disconnected accounts by capability class against `max_mail_accounts` / `max_calendar_accounts`), `trg_vip_people_plan_limit` (`vip_max`) and `trg_priority_rules_plan_limit` (`priority_rules_max`). Raises `PLAN_LIMIT:<key>` (mapped by `api` to the paywall, M§44). |
| `private.enforce_calendar_selection_limit() returns trigger` | SD | — | `trg_calendars_plan_limit`: the count of `selected` calendars across all sources must stay ≤ `max_calendars`; raises `PLAN_LIMIT:max_calendars` |
| `private.grant_entitlement(p_user uuid, p_source grant_source, p_days smallint, p_reason text, p_admin uuid, p_idempotency_key text, p_referral_credit uuid default null) returns public.entitlement_grants` | SD | service_role | Stacking insert, `on conflict (idempotency_key) do nothing` → returns the existing row, plus an audit append |
| `private.reward_referral(p_referral_id uuid) returns jsonb` | SD | service_role | Locks the referral `for update`. Requires `qualified`. Checks the referrer cap (`referral_rewards_per_year` over a rolling 365 d). Inserts both `referral_credits` (on conflict do nothing) and both grants (+14 d), sets `rewarded`, and writes audit. Fully idempotent (M§45, §116). |
| `private.ai_budget_reserve(p_user uuid, p_feature ai_feature, p_est_cost_micros bigint, p_units int default 0) returns jsonb` | SD | service_role | `{allow, level, reason, reservation_id}`. Takes `pg_advisory_xact_lock(hashtextextended(p_user::text ‖ local_date, 0))`, sums the user's local-day and local-month `ai_usage_daily` actuals plus open holds, and compares them with the plan's `ai_daily_budget_units` (units), `ai_soft_cap_usd_day` (→ `l1`), `ai_hard_cap_usd_day` and `ai_hard_cap_usd_month` (→ `l2`). Non-briefing features may use only `1 − ai_briefing_reserve_ratio` of the daily hard cap; briefing features never consume units. When allowed it inserts `ai_budget_reservations` and adds the hold to `ai_usage_daily.reserved_*`; otherwise `allow=false` with `reason in ('units_exhausted','hard_cap_day','hard_cap_month')` (mapped by `api` to `QUOTA_EXCEEDED`). |
| `private.ai_budget_settle(p_reservation_id uuid, p_ai_request_id uuid, p_actual_cost_micros bigint, p_units int, p_tokens jsonb) returns void` | SD | service_role | Idempotent (a settled reservation is a no-op). Releases the hold, adds the actual cost, units and tokens (`{input, output, cache_read, cache_write}`) to `ai_usage_daily` for the reservation's local date and feature, and sets `settled_at`. |
| `public.rate_limit_hit(p_key text, p_limit int, p_window_seconds int) returns boolean` | SD | service_role | `window_start := to_timestamp(floor(extract(epoch from now())/p_window_seconds)*p_window_seconds)`; `insert … on conflict do update set count = count+1 returning count`; returns `count <= p_limit` (true = allowed) |

### 6.6 Approvals

`private.transition_approval(p_id uuid, p_to approval_status, p_actor text, p_actor_id uuid, p_idempotency_key text, p_reason text default null, p_result jsonb default null, p_error_code text default null, p_error_message text default null, p_via public.approval_via default null) returns public.approval_actions` (SD; granted to service_role via the wrapper `public.transition_approval` with the same signature).

- Locks the row `for update`.
- **Legal edges:**

| From | To |
|---|---|
| `pending` | `approved`, `rejected`, `expired` |
| `approved` | `executing` |
| `executing` | `executed`, `failed` |
| `failed` | `executing` (retry, same key) |

- **Idempotent:** if `status = p_to` and `idempotency_key = p_idempotency_key`, it returns the row without a new event.
- For `approved` it requires `p_idempotency_key = row.idempotency_key` (the client-sent key). Otherwise it raises `IDEMPOTENCY_MISMATCH`. `approved` also requires `approval_expires_at > now()`, otherwise it transitions to `expired` and raises `APPROVAL_EXPIRED`.
- Illegal edges raise `ILLEGAL_TRANSITION:<from>-><to>`.
- Sets timestamps, increments `attempt_count` on `executing`, and writes `approval_events`. On `approved` with `executor='server'` it enqueues `approval_execute:{id}:v{payload_version}` (`run_after = now()`). On `executed`/`failed` it writes `audit_logs` via `private.audit_log_append`.
- Uses `set_config('da.approval_tx','on',true)`.
- **No undo status (R-06).** The legal-edge table above is exactly plan §5: there is no `approved → rejected` edge and `failed` is left only by a retry (`failed → executing`). "Geri al" is a client-side 5 s delay before `POST /approvals/:id/approve` is sent; if the app closes during the delay the row simply stays `pending` in the Approval Center.
- **Tap only (R-03).** `approved` requires `p_via` (`approval_center | inline_sheet | voice_card | capture_batch | in_place`) and stores it in `approved_via`; a spoken "onayla" never reaches this function.
- **Device executor** (`executor='device'`: EventKit, CalendarContract, Apple Reminders; `POST /approvals/:id/device-execution`, R-18). Approving requires `device_installation_id` to belong to the owner. The `api` performs `pending → approved → executing` in one request, stores `device_token_hash` for the one-time execution token handed to that installation and enqueues **no** job. The device result maps to `executed` (`provider_idempotency_ref` = the device ref hash) or `failed` (`DEVICE_WRITE_FAILED`; a user cancel in the system editor is `failed` with `DEVICE_CANCELLED`, retryable through `failed → executing` after the app checks its marker). `private.fail_stale_device_approvals` fails rows with no result after 10 minutes (`DEVICE_RESULT_MISSING`).

`private.edit_approval_payload(p_id uuid, p_user uuid, p_payload jsonb, p_payload_hash bytea, p_change_summary text) returns public.approval_actions` (SD, service_role wrapper).
- Only while `pending` and owned by `p_user`.
- `payload_version += 1`, new `idempotency_key := 'approval:'||id||':v'||payload_version`, writes an event `pending→pending` with reason `edited` (SREQ-44).

### 6.7 Audit

`private.audit_log_append(p_actor_type text, p_actor_id uuid, p_actor_role text, p_action text, p_target_type text, p_target_id text, p_target_user_id uuid, p_reason text, p_result text, p_details jsonb, p_correlation_id uuid, p_ip_hash bytea default null) returns bigint` (SD).

1. `perform pg_advisory_xact_lock(hashtext('da_audit_chain'))`.
2. `select chain_seq, row_hash into v_prev from audit_logs order by chain_seq desc limit 1`.
3. `v_seq := coalesce(v_prev.chain_seq,0)+1`.
4. `v_canon := concat_ws('|', v_seq, to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), p_actor_type, p_actor_id, p_actor_role, p_action, p_target_type, p_target_id, p_target_user_id, p_reason, p_result, p_details::text /* jsonb canonical */, p_correlation_id)`.
5. `row_hash := extensions.digest(coalesce(v_prev.row_hash,'\x00'::bytea) || convert_to(v_canon,'UTF8'), 'sha256')`.
6. Insert and return the id.

The public wrapper `public.audit_log_append(...)` is granted to `service_role` only (Edge Functions).

`private.audit_verify_chain(p_from bigint default 1, p_to bigint default null) returns table(ok boolean, checked bigint, first_bad_seq bigint)` (SD) recomputes the chain. `admin_api.audit_verify` requires `audit.read`.

### 6.8 Admin guard and last-super-admin trigger

`private.require_admin(p_permission text) returns public.admin_users` (SD, stable-ish; it updates the session):

0. `perform private.assert_admin_gateway()` (raises `ADMIN_GATEWAY_REQUIRED` without the admin-api gateway header).
1. `v_claims := auth.jwt()`. If `v_claims->>'aal' is distinct from 'aal2'`, raise `ADMIN_AAL2_REQUIRED` (sqlstate `42501`).
2. If `v_claims->'app_metadata'->>'da_kind' is distinct from 'admin'`, raise `ADMIN_REQUIRED` (R-08). Select the `admin_users` row where `user_id = auth.uid() and status = 'active'`, else raise `ADMIN_REQUIRED`.
3. If `not exists (select 1 from private.admin_role_permissions p where p.role = v_admin.role and p.permission = p_permission)`, write audit `admin.permission_denied` (result `denied`) and raise `ADMIN_FORBIDDEN`.
4. Fetch the `admin_sessions` row for `(v_claims->>'session_id')::uuid`.
   - If it is missing, ended or expired (`idle_expires_at < now()` or `absolute_expires_at < now()`), end it with the reason and raise `ADMIN_SESSION_EXPIRED`.
   - Else update `last_activity_at = now()`, `idle_expires_at = now()+30 min`.
5. Return the row.

`private.guard_last_super_admin() returns trigger` (SD; `trg_admin_users_last_super_admin` BEFORE UPDATE OR DELETE on `admin_users`):
- If `OLD.role='super_admin' and OLD.status='active'` and (`TG_OP='DELETE'` or `NEW.role<>'super_admin'` or `NEW.status<>'active'`):
  - `perform 1 from admin_users where role='super_admin' and status='active' for update;`
  - if `(select count(*) … where … and user_id <> OLD.user_id) = 0`, raise `LAST_SUPER_ADMIN` (M§68).

### 6.9 User-facing RPCs (`public`, exposed to `authenticated`)

| Signature | Sec | Purpose |
|---|---|---|
| `public.set_insight_status(p_insight_id uuid, p_status item_status, p_snoozed_until timestamptz default null, p_reason text default null) returns public.insights` | **SI** | RPC-01. RLS scopes the row. Validates edges: open→done/dismissed/snoozed; snoozed→open/done/dismissed; done/dismissed→open (undo). `snoozed` requires a future `p_snoozed_until`. Sets `done_at`/`dismissed_at`; the same status again is a no-op. If `p_reason = 'not_important'`, inserts `ai_feedback(rating -1, reason 'not_important')` (learned preferences are derived only if `learn_from_interactions`). |
| `public.search_user_content(p_query text, p_types text[] default null, p_query_embedding extensions.vector(1024) default null, p_limit int default 20, p_cursor text default null, p_from timestamptz default null, p_to timestamptz default null, p_contact_id uuid default null) returns table(result_type text, entity_id uuid, title text, snippet text, source_type public.source_type, source_id text, source_provider public.provider, source_timestamp timestamptz, score double precision)` | **SI** | RPC-02 (parameter names and order per API_CONTRACTS, R-20). Detailed below |
| `public.person_intelligence(p_contact_id uuid) returns jsonb` | **SI** | Detailed below |
| `public.preview_priority_rule(p_condition_type rule_condition, p_condition_value jsonb, p_outcome rule_outcome) returns jsonb` | **SI** | Last 30 days of `email_messages`: `{match_count, sample:[{from_name, subject, received_at}]×3, already_important, will_move_up}` (PRIMARY 7.10) |
| `public.effective_entitlement(...)`, `public.check_plan_limit(...)` | SD | §6.5 |
| `public.today_overview(p_local_date date default null) returns jsonb` | **SI** | RPC-04. Today for the caller's local date (default: today in `user_preferences.timezone`): hero count ("Bugün bilmen gereken {n} şey var."), open insights ranked by `urgency` then `rank_score`, next meeting, deadlines, follow-ups, life intel, pending approvals count, briefing status and audio availability; `user_overrides` applied. Announcements come from `GET /me/bootstrap` (R-25). |
| `public.flow_feed(p_filter text default 'all', p_cursor text default null, p_limit int default 30) returns jsonb` | **SI** | RPC-05. `p_filter in ('all','important','mail','calendar','followup','personal')`; the 9 `flow_card_type` cards plus neutral follow-up and commitment variants, ordered urgency → time (SREQ-08); keyset cursor. |
| `public.flow_meta(p_filter text default 'all') returns jsonb` | **SI** | Flow header: `{total, important, last_analysis_at, accounts:[{id, provider, status, last_success_at}]}`. |
| `public.set_commitment_status(p_commitment_id uuid, p_status commitment_status, p_due_at timestamptz default null) returns public.commitments` | **SI** | RPC-06. Pro (checked with `public.effective_entitlement()`); legal edges from `trg_commitments_status_ts`; "Ertele" sets `due_at`/`snoozed_until`; idempotent. |
| `public.mark_briefing_opened(p_briefing_id uuid) returns void` | SD (owner check `user_id = auth.uid()`) | RPC-07. Sets `opened_at` once and moves `ready → delivered`; idempotent. Definer because `status` is not client-writable. |
| `public.mail_intelligence(p_local_date date default null, p_category mail_category default null, p_account_id uuid default null, p_cursor text default null, p_limit int default 30) returns jsonb` | **SI** | RPC-08. "Bugün {n} mail" / "{k} tanesi dikkat gerektiriyor.", category counts inside the user's local-day bounds and rows with their decision explanation (tier, reason, rule), optionally for one account. |
| `public.plan_range(p_from timestamptz, p_to timestamptz) returns jsonb` | **SI** | RPC-09. Events of selected calendars, timed tasks, commitments due and schedule proposals with their approval status; `p_to − p_from ≤ 35 days`. |
| `public.plan_week_density(p_week_start date) returns table(local_date date, meeting_minutes int, focus_minutes int, event_count int, is_hot boolean, is_today boolean)` | **SI** | RPC-18. Seven rows: `meeting_minutes` = non-all-day busy events with ≥1 other attendee or a conference URL; `focus_minutes` = Dijital Asistan–created blocks + timed tasks; `is_hot` = `meeting_minutes ≥ 300`. |
| `public.list_approvals(p_status approval_status[] default '{pending}', p_cursor text default null, p_limit int default 30) returns jsonb` | **SI** | RPC-10. `ApprovalView` projections (what, why, source, `exact_change`, destination label, side effects, `executor`); history follows retention (P-04). |
| `public.get_usage_summary() returns jsonb` | **SI** | RPC-12. `{key, limit, used, remaining, resets_at}` per quota from `plan_limits` and `ai_usage_daily` (local day). Free shows AI units ("AI analiz limiti 50/gün"); Pro shows only the "Adil kullanım" state, never unit numbers. |
| `public.vip_suggestions(p_limit int default 5) returns jsonb` | **SI** | RPC-13. Pro. Contacts with ≥10 exchanges in 30 days and no VIP row ("son 30 günde 14 kez yazıştın. VIP yapayım mı?"). |
| `public.dismiss_announcement(p_announcement_id uuid) returns void` | **SI** | RPC-14. Inserts `announcement_dismissals` on conflict do nothing (R-25). |
| `public.get_explanation(p_target_type text, p_target_id uuid) returns jsonb` | **SI** | RPC-16 "Bu nereden çıktı?" (M§97, §131): `{reason_text, decision_tier, rule {id, name}?, learned_preference {id, text}?, signals[], confidence, sources[{source_type, source_id, provider, account_label, display, source_timestamp, evidence[], in_app_deeplink, provider_web_link?, freshness{last_sync_at, is_device}}]}`; `p_target_type in ('insight','email_thread','email_message','commitment','life_event','briefing_item','capture','approval_action','meeting_prep')`; never raw bodies. |
| `public.submit_ai_correction(p_target_type text, p_target_id uuid, p_kind text, p_field text, p_corrected jsonb, p_comment text default null) returns jsonb` | SD (owner check) | RPC-17. `p_target_type in ('commitment','life_event','insight')`; field allowlist: commitments `{due_at, text, contact_id, counterparty_name, direction}`, life events `{amount, currency, due_at, event_at, type, title}`, insights `{due_at, title}`; `p_kind in ('wrong_date','wrong_amount','wrong_person','wrong_type','not_a_commitment','other')`. Merges `{field: {value, corrected_at}}` into `user_overrides`, inserts `ai_feedback` (rating −1, `detail {field}`), and `not_a_commitment` cancels the commitment. |
| `public.apply_insight_feedback(p_insight_id uuid, p_kind text, p_client_mutation_id uuid default null) returns jsonb` | SD (owner check) | `p_kind in ('not_important','show_more','make_vip','stop_tracking','never_show')`. Atomically upserts `ai_feedback`; updates `learned_preferences` through `private.upsert_learned_preference` only when `learn_from_interactions=true`; `make_vip` inserts `vip_people` (`vip_max` applies); `not_important`, `stop_tracking` and `never_show` dismiss the insight (`never_show` on a life event also sets `life_events.suppressed`); enqueues `insight_refresh`. Returns `{feedback_id, learned_preference_id?, vip_id?}`; a replay with the same `p_client_mutation_id` returns the first result. |
| `public.revert_insight_feedback(p_feedback_id uuid) returns jsonb` | SD (owner check) | Undo from the toast: deletes the feedback row, reverses its learned-preference evidence, removes a VIP row it created and restores the insight status. |
| `public.history_deletion_preview(p_older_than timestamptz default null) returns jsonb` | **SI** | RPC-19. Counts `{summaries, priority_decisions, memory_entries, learned_preferences, assistant_conversations, captures}` that a retention shortening (`p_older_than`) or "Geçmişi sil" (null = the whole §6.4 purge scope) would delete. |
| `public.upsert_manual_contact(p_email extensions.citext, p_display_name text default null) returns uuid` | **SI** | VIP "Kişi Ekle" by email without the contacts permission: inserts `contacts(origin='manual')` or returns the existing id for `(user_id, primary_email)`. |

`search_user_content` details:
- **Types:** emails (`email_threads`), people (`contacts`), calendar (`calendar_events`), tasks, commitments, life_events, memories (`memory_chunks`), captures (M§95).
- **FTS leg:** `websearch_to_tsquery('private.tr_search', p_query)` against each table's `search_tsv` (memory: `tsv`), ranked by `ts_rank_cd`. Contacts also use trigram similarity on `immutable_unaccent(lower(display_name))`.
- **Vector leg** (only when `p_query_embedding` is given and `(select is_active from public.effective_entitlement())`; `api GET /search` embeds the query with `voyage-4-lite`, 1024-d in the `voyage-4` space (R-01), only while `ai.provider.voyage.enabled` is on): `set local hnsw.ef_search = 200`. Take the top 200 by `embedding <=> p_query_embedding` from `memory_chunks where user_id = auth.uid()`. If fewer than `p_limit` rows come back (the HNSW post-filter under-fill in pgvector 0.6), fall back to an exact scan over the user's rows via a `materialized` CTE.
- **Fusion:** RRF `score = Σ 1/(60 + rank)`.
- **Filters:** always `user_id = (select auth.uid())` (index use; RLS also applies) and `(expires_at is null or expires_at > now())`; optional `p_from`/`p_to` on `source_timestamp` and `p_contact_id` on `memory_chunks.contact_ids` and contact-linked rows; `p_cursor` is an opaque keyset cursor over `(score, result_type, entity_id)`. Free callers get the FTS leg only, limited to the last `plan_limits.assistant_retrieval_days`. Every row carries provenance.

`person_intelligence` returns `{contact, is_vip, relationship, last_contact_at, upcoming_meetings[≤5], open_loops[≤10], recent_topics[≤5], user_owes[], they_owe[], related_threads[≤10]}` (M§30).
- Meetings match via `attendees @> jsonb_build_array(jsonb_build_object('email', e))` for each of the contact's emails.
- Open loops = open insights/commitments linked to the contact.

**Rules for every §6.9 RPC:** `set search_path = ''`; `grant execute` to `authenticated` only. SI functions never call `private.*` (the schema is not granted to `authenticated`); they check Pro with `public.effective_entitlement()` and read `plan_limits` directly. SD functions start with an ownership check against `auth.uid()` and write only the listed columns. Errors: `P0002` → `NOT_FOUND`, `P0001` with `ENTITLEMENT_REQUIRED:<feature>`, `23505` → `STATE_CONFLICT`.

### 6.10 `admin_api` functions (SD; each starts with `perform private.require_admin('<perm>')`; list reads are paginated `(p_page int, p_page_size int ≤100, p_sort text whitelist, p_filter jsonb)` and return `{rows, total}`)

| Module (route) | Functions (permission) | Masking and notes |
|---|---|---|
| Dashboard `/dashboard` | `dashboard_metrics(p_range text in ('24h','7d','30d','90d'))`, `dashboard_series(p_metric text, p_range text)` (`dashboard.read`); `metrics_ops(p_range)` (`metrics.ops.read`); `metrics_product(p_range)` (`metrics.product.read`) | Aggregates only (M§50, §119); 30d/90d read `metrics_daily`; internal and demo users excluded |
| Users `/users`, `/users/[id]/*` | `users_list` (`users.read`; filters free/pro/trial/inactive/sync_error/connection_error/internal); `user_overview`, `user_integrations`, `user_briefings`, `user_usage`, `user_referrals`, `user_support`, `user_audit` (`users.read`); `user_subscription` (`subscriptions.read`; amounts only with `metrics.revenue.read`); `user_reveal_email(p_user uuid, p_reason text)` (`users.pii.reveal`); `user_force_sync(p_user, p_account uuid, p_reason)` (`users.force_sync`); `user_disable(p_user, p_reason)` / `user_restore(p_user, p_reason)` (`users.disable`); `user_mark_internal(p_user, p_internal boolean, p_reason)` (`users.mark_internal`) | Emails via `mask_email`, names via `mask_name`; never content. Every mutation requires a reason (≥10 chars) + audit (M§51). Disable also ends the user's sessions via `admin-api` (GoTrue admin). |
| Support `/support[/id]` | `tickets_list`, `ticket_detail` (`support.read`); `ticket_update(p_id, p_status, p_assignee, p_priority, p_reason)`, `ticket_add_note` (`support.write`); `support_access_grant(p_user, p_scope support_access_scope[], p_reason, p_minutes int in (15,30,60), p_ticket uuid)`, `support_access_revoke(p_grant, p_reason)`, `support_access_authorize(p_grant uuid, p_scope support_access_scope, p_resource_type text, p_resource_id uuid, p_reason text) returns jsonb` (`support.access`) | `authorize` checks grant owner = caller, scope, expiry and revocation, increments `reveal_count`, writes `pii.reveal`, and returns only **stored derived fields** of that scope (R-09). No provider call is ever made for staff: original mail bodies, attachments, files, tokens and secrets are never returned. |
| Integrations `/integrations` | `integrations_overview(p_filter)`, `integration_detail(p_account)` (`integrations.read`); `integration_disconnect(p_account, p_reason)` (`integrations.disconnect`) → enqueues `integration_purge`; `integration_renew_watch(p_account, p_reason)` (`integrations.renew_watch`) → enqueues `watch_renewal` | Never tokens (M§52); status maps to "needs reconnect / OAuth error / refresh error / watch issue" |
| Sync & Jobs `/jobs[/id]` | `jobs_list`, `job_detail` (`jobs.read`); `job_retry(p_job, p_reason)`, `job_retry_bulk(p_type, p_status, p_reason, p_max ≤500)` (`jobs.retry`); `job_cancel(p_job, p_reason)` (`jobs.cancel`) | `private.job_admin_policy(type)` decides eligibility; retry resets to `queued`, `attempts` kept, `max_attempts += 1`; payload shown as ids only |
| Briefings `/briefings` | `briefings_metrics(p_range, p_kind)`, `briefings_list` (`briefings.read`); `briefing_regenerate(p_briefing, p_reason)` (`briefings.regenerate`) → same row, `origin='retry'`, `version += 1` | Scheduled/generated/delivered/failed/skipped, latency, AI cost (M§54); no narrative |
| Notifications `/notifications` | `notifications_metrics(p_range)`, `notifications_user_debug(p_user, p_page)` (`notifications.read`); `notification_send_test(p_user, p_reason)` (`push.test`) | Rendered text only for `generic` mode or under Support Access scope `notifications` (M§55); test pushes use generic content and never bypass quiet hours (R-13) |
| AI `/ai`, `/ai/models` | `ai_metrics(p_range, p_group in ('feature','model','provider','prompt_version','profile','day'))`, `ai_cost_series` (`metrics.ai.read`); `ai_requests_list`, `ai_model_config_list`, `ai_model_prices_list` (`ai.read`); `ai_model_config_update(p_profile routing_profile, p_role text, p_feature ai_feature, p_provider text, p_model text, p_params jsonb, p_fallback_targets jsonb, p_escalation_target jsonb, p_enabled boolean, p_expected_version int, p_reason text)`, `plan_routing_profile_set(p_plan text, p_profile routing_profile, p_reason text)`, `ai_model_prices_upsert(p_provider, p_model, p_prices jsonb, p_effective_from, p_reason)`, `ai_calibration_activate(p_id uuid, p_reason)` (`ai.models.write`) | p50/p95 from `latency_hist`; a model update needs `eval_status='passed'` for a new primary, is rejected for Covered Models (ADR-44) and for a stale `p_expected_version` (`STATE_CONFLICT`); "configured" comes from the latest `health` detail |
| Prompts `/ai/prompts[/key]` | `prompts_list`, `prompt_versions_list(p_key)`, `prompt_diff(p_a uuid, p_b uuid)` (`prompts.read`); `prompt_create_draft`, `prompt_update_draft` (`prompts.write`); `prompt_activate(p_version, p_reason)`, `prompt_rollback(p_key, p_version, p_reason)`, `prompt_archive(p_version, p_reason)` (`prompts.activate`) | Activation requires `eval_passed`; diffs are computed client-side from the two texts |
| AI Feedback `/ai/feedback` | `ai_feedback_aggregate(p_range, p_group)`, `ai_feedback_list` (`ai_feedback.read`); `ai_feedback_reveal_comment(p_id, p_reason)` (`ai_feedback.reveal`) | `comment` hidden unless revealed (audited `pii.reveal`) |
| Subscriptions `/subscriptions` | `subscriptions_metrics(p_range)` (`metrics.revenue.read`; MRR/ARR estimate from `app_settings` `pricing.estimates`), `subscriptions_list` (`subscriptions.read`), `billing_events_list` (`billing_events.read`); `subscription_resync(p_user, p_reason)` (`subscriptions.resync`) → `billing_sync`; `entitlement_grant(p_user, p_days in (1,7,14,30), p_source in ('admin','support','compensation'), p_reason)` (`entitlements.grant`, or `entitlements.grant_limited` for 1/7 days with source `support`); `entitlement_revoke(p_grant, p_reason)` (`entitlements.revoke`) | Store vs grant shown separately (M§60, §61) |
| Referrals `/referrals` | `referrals_metrics(p_range)`, `referrals_list` (`referrals.read`); `referral_review(p_referral, p_decision in ('approve','reject'), p_reason)` (`referrals.review`) → `reward_referral` or reject | Hashed signals shown as risk factors only |
| Feedback `/feedback` | `feedback_list` (`feedback.read`); `feedback_update(p_id, p_status, p_assignee, p_reason)` (`feedback.write`) | Masked email |
| Flags `/flags` | `flags_list` (`flags.read`); `flag_upsert(p_key, p_description, p_enabled, p_rollout, p_platforms, p_plans, p_min_ver, p_max_ver, p_payload, p_reason)`, `flag_kill(p_key, p_reason)`, `flag_override_set(p_key, p_user, p_value, p_reason, p_expires)`, `flag_override_delete(p_id, p_reason)` (`flags.write`; `ai.*` / `voice.*` keys also accept `flags.write_ai`) | Keys limited to the R-10 catalogue (§4.7) |
| Announcements `/announcements` | `announcements_list` (`announcements.read`); `announcement_upsert(..., p_reason)`, `announcement_publish(p_id, p_reason)`, `announcement_cancel(p_id, p_reason)` (`announcements.write`) | Preview is client-rendered |
| Data Requests `/data-requests` | `data_requests_list(p_kind in ('export','history','account'), ...)` (`data_requests.read`); `data_request_retry(p_id, p_reason)`, `data_request_cancel(p_id, p_reason)` (`data_requests.manage`) | Subject shown as hash prefix after completion |
| Audit `/audit` | `audit_list`, `audit_verify(p_from, p_to)` (`audit.read`) | No delete function exists (M§66) |
| Health `/health` | `health_latest()`, `health_history(p_component, p_range)`, `app_versions_breakdown(p_range)` (`health.read`); `health_record(...)` is service-role only (Edge `health` writes) | `app_installations` aggregates (M§110) |
| Admin Users `/admins` | `admins_list` (`admins.read`); `admin_invite_record(p_user, p_email, p_role, p_display_name, p_reason)` (the auth user is created by `admin-api` via GoTrue with `app_metadata.da_kind='admin'`), `admin_update_role(p_user, p_role, p_reason)`, `admin_disable(p_user, p_reason)`, `admin_enable(p_user, p_reason)`, `admin_sessions_revoke_all(p_user, p_reason)`, `admin_mfa_reset(p_user, p_reason)` (`admins.manage`) | Last-super-admin trigger applies; an admin cannot change their own role, status or MFA; an app-user email is rejected (R-08) |
| Settings `/settings` | `admin_me()`, `admin_session_start(p_ip_hash, p_user_agent)`, `admin_session_end(p_reason)`, `admin_preferences_get()`, `admin_preferences_set(p_theme, p_locale, p_table_prefs)` (any active aal2 admin, own row, no permission); `settings_get()`, `settings_update(p_key, p_value jsonb, p_reason)`, `plan_limits_list`, `plan_limits_update(p_plan, p_key, p_value jsonb, p_reason)` (`settings.system.write`) | `settings_update` accepts whitelisted keys only; session values can only be tightened |
| Command palette | `command_search(p_q text)` (`search.global`; each result type also needs its read permission) | Exact matches only: uuid → users/jobs/integrations/tickets; `DA-YYYY-######` → ticket; 7-char code → referral; RevenueCat id/transaction → subscription; email → equality against `auth.users.email` returning a masked row. **Never** a content search (M§69). |

Every mutating `admin_api` function calls `private.audit_log_append('admin', auth.uid(), role, '<action>', …, p_reason, 'success', details)` in the same transaction. On an exception it logs `result='failure'` in an autonomous path: the Edge `admin-api` writes the failure audit via the service wrapper.

---

## 7. Triggers list

| Trigger | Table / event | Function |
|---|---|---|
| `trg_<t>_updated_at` | every table with `updated_at` / BEFORE UPDATE | `private.set_updated_at` |
| `trg_<t>_set_expires_at` | every ⟨EXP⟩ table / BEFORE INSERT (and BEFORE UPDATE OF status for tasks/commitments/reminders/approval_actions) | `private.set_expires_at(<anchor>)` |
| `on_auth_user_created` | `auth.users` AFTER INSERT | `private.handle_new_user` |
| `trg_user_preferences_validate_tz` | BEFORE INSERT/UPDATE OF timezone | Validates against `pg_timezone_names` |
| `trg_user_preferences_retention_changed` | AFTER UPDATE OF retention_policy | Enqueue `retention_recompute` + audit |
| `trg_connected_accounts_plan_limit`, `trg_vip_people_plan_limit`, `trg_priority_rules_plan_limit` | BEFORE INSERT/UPDATE | `private.enforce_plan_limit` (`max_mail_accounts` / `max_calendar_accounts`, `vip_max`, `priority_rules_max`) |
| `trg_calendars_plan_limit` | BEFORE INSERT/UPDATE OF selected | `private.enforce_calendar_selection_limit` (`max_calendars`) |
| `trg_connected_accounts_status_notify` | AFTER UPDATE OF status | Enqueue an `account` notification on `needs_reauth`/`admin_consent_required` |
| `trg_captures_path_check` | BEFORE INSERT/UPDATE OF storage_path | Path prefix = `user_id/` |
| `trg_commitments_status_ts`, `trg_insights_status_ts` | BEFORE UPDATE OF status | Legal edges + timestamps |
| `trg_approval_actions_guard` | BEFORE UPDATE | Blocks guarded columns outside `da.approval_tx` |
| `trg_approval_events_immutable`, `trg_audit_logs_immutable`, `trg_audit_logs_no_truncate` | BEFORE UPDATE/DELETE/TRUNCATE | Raise |
| `trg_prompt_versions_guard` | BEFORE UPDATE | Content immutability + transitions |
| `trg_admin_users_last_super_admin` | BEFORE UPDATE/DELETE | `private.guard_last_super_admin` |
| `trg_briefings_delivered_referral` | AFTER UPDATE OF status (→ `delivered`, first per user) | Enqueue `referral_evaluate` for the pending referral where the user is the referee |
| `trg_profiles_state_disabled` | AFTER UPDATE OF state (→ disabled) | Disable `push_tokens` and cancel scheduled reminders |
| `trg_user_preferences_validate_calendar` | BEFORE INSERT/UPDATE OF default_write_calendar_id | The calendar must belong to the user, be `selected` and have `can_write` |
| `trg_admin_users_identity` | BEFORE INSERT on `admin_users` | R-08: requires `raw_app_meta_data->>'da_kind' = 'admin'` and no `profiles` row, else `EMAIL_IN_USE_BY_APP_USER` |
| `trg_ai_model_config_version` | BEFORE UPDATE on `ai_model_config` | Bumps `version`; rejects a new primary target whose `eval_status <> 'passed'` |

---

## 8. Storage buckets and policies (0016)

| Bucket | Public | Size limit | Allowed MIME | Path | Signed URL TTL |
|---|---|---|---|---|---|
| `captures` | false | 20 MB | image/jpeg, image/png, image/heic, image/heif, image/webp, application/pdf, text/plain, audio/mp4, audio/aac, audio/mpeg, application/json | `{user_id}/{capture_id}/{sanitized_filename}`; worker-written transient objects `{user_id}/voice-tmp/{uuid}.m4a` (server STT audio, deleted after transcription) and `{user_id}/tmp/{capture_id}/pages.json` (PDF page text, deleted after analysis); reply attachments `{user_id}/replies/{draft_id}/{sanitized_filename}` | 300 s (view) |
| `exports` | false | 512 MB | application/zip | `{user_id}/{export_request_id}.zip` | 300 s per download tap; artifact available 24 h |
| `briefing-audio` | false | 20 MB | audio/mpeg, audio/mp4, audio/aac | `{user_id}/{briefing_id}/{version}.mp3` (cached per briefing version) | 300 s |

Buckets are inserted into `storage.buckets` with `on conflict (id) do update`.

**Policies on `storage.objects`:**

```sql
create policy captures_select_own on storage.objects for select to authenticated
  using (bucket_id = 'captures' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy exports_select_own on storage.objects for select to authenticated
  using (bucket_id = 'exports' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy briefing_audio_select_own on storage.objects for select to authenticated
  using (bucket_id = 'briefing-audio' and (storage.foldername(name))[1] = (select auth.uid())::text);
```

- There are **no** insert, update or delete policies for `authenticated`.
- Uploads use `createSignedUploadUrl` minted by `api POST /captures/upload-url` after validating size, MIME and extension (M§85). Magic bytes are re-checked on `POST /captures/:id/analyze`. Reply attachments use the same helper through the reply-attachment upload route of API_CONTRACTS §8.5, with the same checks. Server STT audio and PDF page text are written by the worker with the secret key.
- Deletes are done by the worker through the Storage API.
- `anon` has no policies.
- Signed URLs are never embedded in widgets or push payloads.

---

## 9. pg_cron schedules (0015; UTC; 8 jobs ≤ Supabase's 8-concurrent limit; each runs < 1 s)

| Job name | Schedule | Command |
|---|---|---|
| `da_scheduler_tick` | `* * * * *` | `select private.scheduler_tick();` |
| `da_worker_poke` | `15 seconds` | `select private.poke_worker('cron');` |
| `da_push_receipts` | `*/5 * * * *` | `select public.enqueue_job('push_receipts', 'push_receipts:'||to_char(date_trunc('minute', now()) - make_interval(mins => extract(minute from now())::int % 5), 'YYYYMMDDHH24MI'));` |
| `da_health_check` | `*/5 * * * *` | `select public.enqueue_job('health_check', 'health:'||to_char(date_trunc('minute', now()) - make_interval(mins => extract(minute from now())::int % 5), 'YYYYMMDDHH24MI'));` |
| `da_reconciliation` | `7 */6 * * *` | `select private.enqueue_reconciliation();` (one job per healthy account; key `reconciliation:{account}:{6h bucket}`; also enqueues `credential_reencrypt` (key `credential_reencrypt:{utc_date}`) once daily at the 00:07 run) |
| `da_retention` | `30 2 * * *` | `select public.enqueue_job('retention', 'retention:'||to_char(now(),'YYYY-MM-DD'));` |
| `da_billing_reconcile` | `45 3 * * *` | `select private.enqueue_billing_reconcile();` (`billing_sync` for mirrors with `is_active and expires_at < now()` or `synced_at < now()-interval '7 days'`) |
| `da_cron_housekeeping` | `15 3 * * *` | `delete from cron.job_run_details where end_time < now() - interval '7 days'; delete from net._http_response where created < now() - interval '1 day';` (the second statement is guarded by `to_regclass('net._http_response') is not null`) |

Scheduling is idempotent: `select cron.unschedule(jobname) from cron.job where jobname like 'da\_%'` runs first, then `cron.schedule(name, schedule, command)`. The whole block is wrapped in `if exists (select 1 from pg_extension where extname='pg_cron')`.

**Vault** (M§152; ADR-04: *only* these two secrets):
- `da_project_url` (`https://<ref>.supabase.co` or the custom API domain).
- `da_cron_secret` (the `sb_secret_…` key named `automations`, which `worker` accepts via `auth:'secret:automations'`).

Both are created in production with `select vault.create_secret('<value>','da_project_url')`. This is a **Manual external step** (Supabase SQL editor or a CI deploy job with `SUPABASE_DB_URL`); the values are never in migrations. Locally, `supabase/seed/00_local_vault.sql` sets them to `http://host.docker.internal:54321` and the local secret key.

---

## 10. Migration file plan (`supabase/migrations/`, forward-only)

| # | File | Contents |
|---|---|---|
| 0001 | `20260924000100_extensions_schemas_enums.sql` | `alter database … set timezone 'UTC'`; schemas `private`, `admin_api` (+ grants §1.1); extensions with guards (§1.8); `private.tr_search`; `private.immutable_unaccent`; all enums (§2); check helpers (`valid_evidence`, etc.); `private.set_updated_at`, `private.mask_email`, `private.hash_subject` |
| 0002 | `20260924000200_identity_settings.sql` | `profiles`, `user_preferences`, `notification_preferences`, `app_installations`, `push_tokens`; `private.handle_new_user` + `on_auth_user_created`; tz validation trigger |
| 0003 | `20260924000300_integrations.sql` | `connected_accounts`, `oauth_credentials`, `oauth_states`, `calendars`, `sync_states`, view `connected_account_sync_health` (security invoker), `provider_quota_usage`, `webhook_events`, `private.demo_fixture_state` |
| 0004 | `20260924000400_content.sql` | `contacts`, `vip_people`, `email_threads`, `email_messages`, `calendar_events`, `tasks`, `commitments`, `reminders`, `meeting_notes`, `meeting_preps`, `life_events`, `captures`, `android_notification_signals` (FKs to `approval_actions`/`priority_rules`/`prompt_versions`/`notifications` are added with `alter table … add constraint` in 0005–0008) |
| 0005 | `20260924000500_intelligence.sql` | `priority_rules`, `learned_preferences`, `insights`, `briefings`, `briefing_items`, `reply_drafts`, `ai_feedback`, `ai_requests`, `ai_usage_daily`, `ai_model_config`, `prompt_versions`, `ai_result_cache`, `ai_budget_reservations`, `ai_model_prices`, `ai_calibration_versions`, `ai_batches` + **reference data**: `ai_model_config` routing seeds for both profiles `balanced` and `lean` (per AI_PIPELINE_PLAN §3.3/§3.4, from `supabase/seed/ai_model_config.sql`), `ai_model_prices` (from `supabase/seed/ai_model_prices.sql`) and `prompt_versions` v1 `active` for every key (text generated from `supabase/prompts/*.md` by `scripts/gen-prompt-migration.ts` at authoring time); deferred FKs from 0004 |
| 0006 | `20260924000600_approvals.sql` | `approval_actions`, `approval_events`; guard/immutability triggers; deferred FKs (`tasks`, `commitments`, `reminders`, `calendar_events`, `reply_drafts`, `oauth_states` → `approval_actions`) |
| 0007 | `20260924000700_assistant_memory.sql` | `assistant_threads`, `assistant_messages`, `memory_chunks` + HNSW + GIN |
| 0008 | `20260924000800_notifications.sql` | `notifications`, `push_tickets`; FK `reminders.notification_id` |
| 0009 | `20260924000900_business.sql` | `subscriptions`, `billing_events`, `entitlement_grants`, `plan_limits` (+ seed §4.6), `referral_codes`, `referrals`, `referral_credits` |
| 0010 | `20260924001000_ops_product.sql` | `jobs`, `job_attempts`, `analytics_events`, `feature_flags` (+ R-10 seed), `feature_flag_overrides`, `announcements`, `announcement_dismissals`, `user_feedback`, `system_health_checks`, `rate_limits`, `api_idempotency_keys`, `app_settings` (+ seed), `metrics_daily`, `ai_metrics_daily`, `web_analytics_daily` |
| 0011 | `20260924001100_privacy.sql` | `data_export_requests`, `data_deletion_requests`, `privacy_tombstones` |
| 0012 | `20260924001200_admin_audit.sql` | `admin_users`, `admin_sessions`, `admin_preferences`, `audit_logs`, `support_tickets` (+ `public_ref` sequence), `support_notes`, `support_access_grants`; `private.admin_role_permissions` (table seeded from BACKOFFICE_PLAN §4.2), `admin_mfa_recovery_codes`; audit chain functions + immutability; last-super-admin trigger; deferred admin FKs |
| 0013 | `20260924001300_functions_rpcs.sql` | Every §6 function (jobs, scheduler, retention, purge, entitlements, limits, budgets, rate limits, approvals, search, person intelligence, preview rule, flags, token hook, `require_admin`, all `admin_api.*`); plan-limit, status and referral triggers; `revoke`/`grant execute` |
| 0014 | `20260924001400_rls_policies_grants.sql` | Baseline (§3.1) for every table; owner policies; column grants; restrictive aal2 policies; `plan_limits` read policy; `alter default privileges` |
| 0015 | `20260924001500_cron_schedules.sql` | §9 (guarded) |
| 0016 | `20260924001600_storage.sql` | §8 buckets + `storage.objects` policies |

`supabase/config.toml`:
- `[api] schemas=["public","admin_api"]`, `extra_search_path=["public","extensions"]`.
- `[auth.hook.custom_access_token] enabled=true`, `uri="pg-functions://postgres/private/custom_access_token_hook"`.
- `[auth.mfa.totp] enroll_enabled=true`, `verify_enabled=true`.
- `[db.seed] sql_paths=["./seed/00_local_vault.sql"]` (demo seed is **not** listed; see §11).

### Type generation

`pnpm db:types`:
- Tier A: `supabase gen types typescript --local --schema public,admin_api`.
- Tier C: the `@supabase/postgres-meta` 0.99.0 `PG_META_GENERATE_TYPES` fallback.
- Both write `packages/api-client/src/database.types.ts`. CI diffs it.

---

## 11. Seed strategy

- **Reference data** (plan limits, flags, model config, prompt v1) ships **inside migrations** (0005, 0009, 0010), so production has it without `seed.sql`.
- **Demo seed** is `supabase/seed/demo/*.sql`, run only by `pnpm db:seed:demo` (`scripts/seed-demo.ts`). The script refuses unless `DEMO_MODE=true`, and refuses when `APP_ENV=production` unless `ALLOW_DEMO_IN_PRODUCTION=true` (M§89, M§100). It also writes the audit `demo.seeded`.
- **Deterministic ids:** `md5('da-demo:'||<entity>||':'||<slug>)::uuid`. Re-running is idempotent (`on conflict do update`).
- **Relative dates:** every timestamp derives from `v_today := (now() at time zone 'Europe/Istanbul')::date`, e.g. `(v_today + time '17:00') at time zone 'Europe/Istanbul'`. Nothing is frozen to "5 Eylül" (SREQ-104).

**Demo dataset** (PRIMARY names; M§89 coverage):

| Entity | Rows |
|---|---|
| User | `demo@dijitalasistan.app`, display name "Yunus", tz `Europe/Istanbul`, Pro via `entitlement_grants(source='admin', reason='demo seed', 30 d)` plus a second Free user `demo-free@dijitalasistan.app`; both have `profiles.is_demo=true` (excluded from metrics, referrals and revenue) |
| Connected accounts | `demo` provider: "Gmail · yunus@…" (mail_read + mail_send), "Google Takvim" (Kişisel, İş calendars), both with `demo_flavor='google'` |
| Contacts / VIP | Ahmet Yılmaz (Kuzey Lojistik, `ahmet@kuzeylojistik.com`, VIP key_client), Mehmet Yılmaz (Yılmaz Endüstri, `mehmet@yilmazendustri.com`, VIP key_client), Selin Kaya (VIP suggestion), Ayşe Kara (`ayse@yilmazendustri.com`), `muhasebe@yilmazendustri.com` |
| Mail | "Revize teklif" from Ahmet, awaiting my reply, deadline today 17:00 with an evidence quote; "Re: Teklif" thread with Mehmet, awaiting their reply (sent D−3); informational newsletters; low-priority promotions; 46 messages in the last 72 h for First Analysis counts |
| Events | Today 14:30–15:30 "Müşteri toplantısı · Mehmet Yılmaz" (Meet link), 10:00 "Haftalık ekip", tomorrow 09:00 "Haftalık ekip"; a deliberate conflict pair 14:00 / 14:30 on D+1 |
| Commitments | user_owes "Mehmet'e yarın teklif göndereceğim." (post_meeting, due D+1); they_owe "Ahmet sevkiyat planını Cuma gönderecek" |
| Life events | shipment Trendyol / Yurtiçi, today 14:00–18:00; flight TK2412 İstanbul→Antalya D+1 09:15; payment Elektrik faturası 1.842 TL (CK Enerji, due D+2, amount evidence); subscription Netflix 229,99 TL renews D+3; reservation Karaköy, 4 kişi, D+4 20:30; security "Google hesabında yeni giriş." today 07:12 (DKIM pass) |
| Briefings | Today's morning briefing `ready` with 5 priority items; last Sunday's weekly with `weekly_stats` (`mails_analyzed 684, important_count 32, meetings 21, followups 8, deadlines 4, time_saved_min 168`) |
| Approvals | pending `email_send` (reply to Ahmet), pending `calendar_create` ("Teklif hazırlama", tomorrow 14:00–16:30) |
| Rules and preferences | `priority_rules`: domain `yilmazendustri.com` → always_important; keyword "fatura" → high; category promotions → low. `learned_preferences`: "Mehmet yüksek öncelikli." |
| Memory | `memory_chunks` for the above with FTS only (embeddings null unless `VOYAGE_API_KEY` exists; the fixture embedding provider fills deterministic vectors in tests) |

Demo sign-in uses email OTP via local Inbucket. Demo data is never generated by production code paths.

---

## 12. Tier-C Supabase compatibility shim: `supabase/tests/shim/000_supabase_compat.sql`

This is loaded **before** migrations on a plain PG16 cluster with `postgresql-16-pgvector` 0.6, `postgresql-16-pgtap` 1.3.2, `postgresql-16-cron` 1.6.2 (with `shared_preload_libraries='pg_cron'`, `cron.database_name` set) and `pg_prove`. It is idempotent.

```sql
-- Roles
do $$ begin
  create role anon nologin noinherit;                 exception when duplicate_object then null; end $$;
-- (same pattern for:) authenticated nologin noinherit; service_role nologin noinherit bypassrls;
-- authenticator login noinherit password 'postgres'; supabase_auth_admin nologin; supabase_storage_admin nologin;
grant anon, authenticated, service_role to authenticator;
-- Schemas
create schema if not exists auth; create schema if not exists storage; create schema if not exists extensions;
create schema if not exists net; create schema if not exists vault;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
-- auth.users (minimal GoTrue subset)
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(), aud text default 'authenticated', role text default 'authenticated',
  email text unique, phone text, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}',
  is_anonymous boolean default false, created_at timestamptz default now(), updated_at timestamptz default now(),
  deleted_at timestamptz);
-- Claims contract identical to PostgREST/GoTrue
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(coalesce(current_setting('request.jwt.claim.sub', true), auth.jwt()->>'sub'), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select nullif(coalesce(current_setting('request.jwt.claim.role', true), auth.jwt()->>'role'), '')::text $$;
grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;
-- storage (minimal)
create table if not exists storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text not null, owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (bucket_id, name));
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
create or replace function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
create or replace function storage.filename(name text) returns text language sql immutable as
  $$ select (string_to_array(name,'/'))[array_length(string_to_array(name,'/'),1)] $$;
-- pg_net stub (records calls for assertions)
create table if not exists net._shim_requests (id bigserial primary key, url text, headers jsonb, body jsonb, created_at timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
  headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as
  $$ insert into net._shim_requests(url, headers, body) values (url, headers, body) returning id $$;
-- vault stub (plaintext; test only)
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
create or replace view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
create or replace function vault.create_secret(secret text, name text, description text default '') returns uuid language sql as
  $$ insert into vault.secrets(name, secret, description) values (name, secret, description)
     on conflict (name) do update set secret = excluded.secret returning id $$;
select vault.create_secret('http://localhost:54321', 'da_project_url'); select vault.create_secret('test-secret', 'da_cron_secret');
```

- `alter role postgres set search_path = public, extensions` is run by the runner.
- The runner is `supabase/tests/run-tier-c.sh`: `createdb` → `psql -f shim` → apply `migrations/*.sql` in order → `create extension pgtap` → `pg_prove -d … supabase/tests/database/*.test.sql`.
- Tier A (CI) uses `supabase test db` with the same test files. The shim is **not** loaded there; `tests/database/000_helpers.sql` detects the real Supabase schemas.

---

## 13. pgTAP test inventory (`supabase/tests/database/`)

Helpers live in `000_helpers.sql`, schema `tests`:
- `tests.create_user(p_email text) returns uuid`: inserts into `auth.users`, which fires `handle_new_user`.
- `tests.authenticate_as(uuid, p_aal text default 'aal1', p_session uuid default gen_random_uuid())`: `set local role authenticated; set local request.jwt.claims = json {sub, role:'authenticated', aal, session_id}`.
- `tests.authenticate_as_admin(uuid, p_role admin_role, p_aal text)`: inserts `admin_users` + `admin_sessions` rows, then authenticates.
- `tests.as_anon()`, `tests.as_service_role()`, `tests.clear_authentication()`.
- `tests.rls_isolation(p_table regclass, p_owner_insert_sql text)`: a generic assertion set. Owner sees 1 row; other user sees 0; other user cannot update or delete it (0 rows affected); insert with a foreign `user_id` throws `42501`; anon select throws `42501`.

Every file runs in `begin; select plan(n); … select * from finish(); rollback;`.

### 13.1 `001_global_invariants.test.sql` (the generic assertion)

For every relation in `public` with `relkind in ('r','p')`:
- `relrowsecurity` is true **and** `relforcerowsecurity` is true.
- `select count(*) from pg_policies where schemaname in ('public','storage') and 'anon' = any(roles)` = 0.
- `information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'` = 0.
- No `public`-schema function is executable by `anon`: `has_function_privilege('anon', oid, 'execute')` is false for all.

Also in this file:
- Every table except the allowlist has a `user_id` column. The allowlist is `plan_limits`, `feature_flags`, `announcements`, `prompt_versions`, `ai_model_config`, `system_health_checks`, `rate_limits`, `audit_logs`, `admin_users`, `admin_sessions`, `admin_preferences`, `billing_events`, `webhook_events`, `referrals`, `referral_codes` (uses `user_id` PK), `jobs`, `job_attempts`, `analytics_events`, `ai_requests`, `support_tickets`, `support_notes`, `feature_flag_overrides`, `ai_model_prices`, `ai_calibration_versions`, `ai_batches`, `app_settings`, `metrics_daily`, `ai_metrics_daily`, `web_analytics_daily`, `privacy_tombstones` and `admin_mfa_recovery_codes`. Where these tables do have `user_id`, the check is still satisfied.
- Every **SYS** table (list from §4) has zero policies for `authenticated` except restrictive ones, and `has_table_privilege('authenticated', t, 'select')` is false.
- Every admin-only table has the restrictive `*_admin_aal2` policy.
- Every `SECURITY DEFINER` function in `public`, `private` and `admin_api` has `proconfig @> '{search_path=""}'` and an owner with `rolbypassrls or rolsuper`.
- Every FK has a covering index.
- Every table with `updated_at` has an `_updated_at` trigger.
- The `memory_chunks_embedding_hnsw` index exists with `vector_cosine_ops`, and `memory_chunks.embedding` / `embedding_dr` are `vector(1024)` (R-01; checked with `format_type`).
- The `supabase_realtime` publication contains no tables (R-19: `select count(*) from pg_publication_tables where pubname = 'supabase_realtime'` = 0; tier C skips when the publication does not exist).
- `ai_model_config` carries the Covered-Model check constraint (ADR-44).

### 13.2 Per-area files and assertions

| File | Assertions |
|---|---|
| `010_identity.test.sql` | `handle_new_user` creates 4 rows; `profiles` OWN-R isolation; update of `display_name` ok; update of `state` / `disabled_at` denied (column privilege error `42501`); insert/delete denied; `user_preferences` tz `'Mars/Olympus'` rejected; `briefing_weekdays '{}'` rejected; `ai_data_access` with an unknown key rejected; `notification_preferences.daily_cap = 0` rejected; defaults (`title_only`, `d90`, `08:00`) correct |
| `011_devices.test.sql` | `app_installations` owner can read but not select `device_hash`; no user writes; `push_tokens` token column not selectable; token format check |
| `020_integrations.test.sql` | `connected_accounts` OWN-R, no update even of `data_source_toggles`; plan limit: Free user second mail account → `PLAN_LIMIT:max_mail_accounts`, Pro allowed; `account_can` truth table (scope × toggle × status × Pro × `pending_binding_until`); `oauth_credentials` owner select → 0 rows / permission denied, iv length check, unique `(account, kind)`, `try_lock_credential_refresh` grants the lock once; `oauth_states` invisible, `return_to` check rejects `https://evil.example/x`, `device_nonce_hash` / `completion_code_hash` length checks and unique `completion_code_hash`; `calendars` update `selected` allowed, update `name` denied, Free second selected calendar → `PLAN_LIMIT:max_calendars`; `sync_states` cursor column not selectable, unique watch id; `connected_account_sync_health` returns only own rows and no cursor; `provider_quota_usage`, `webhook_events` invisible; `consume_provider_quota` returns `wait_ms > 0` over the limit and accepts project buckets without an account; `webhook_events` duplicate `(source, external_id)` → unique violation |
| `030_content_mail.test.sql` | Isolation for threads and messages; no `body`-like column exists (`select count(*) from information_schema.columns where table_name in ('email_messages','email_threads') and column_name ~ 'body'` = 0); snippet >200 chars rejected; deadline without evidence rejected; unique provider ids; FTS: a thread with subject "Ödeme hatırlatması" matches the query `odeme` and `ÖDEME`; `İstanbul` matches `istanbul` |
| `031_calendar_tasks.test.sql` | Events isolation; `conference_url` `https://evil.example` rejected, `https://meet.google.com/abc-defg-hij` accepted; `end_at < start_at` rejected; tasks: owner can insert an in-app task, cannot insert with `connected_account_id`, cannot update a provider task; AI-origin task without provenance rejected |
| `032_commitments_reminders.test.sql` | Commitment dedupe_key uniqueness; non-user origin without evidence rejected; owner can set `snoozed_until`/`status`, cannot update `text`/`confidence`; illegal status edge `cancelled→snoozed` rejected; reminders unique idempotency key; owner read-only |
| `033_meetings.test.sql` | `meeting_notes` update body ok, insert denied; `meeting_preps` read-only, `talking_points` of 4 rejected |
| `034_contacts_vip.test.sql` | Manual contact insert allowed only with `origin='manual'`; VIP CRUD; `vip_max` limit (Free 6th rejected); relationship enum |
| `035_life_captures_ni.test.sql` | Amount without evidence rejected; amount without currency rejected; owner can set `status`/`suppressed`, not `amount`; captures: owner can update to `discarded` only (update to `actioned` → policy violation), path prefix check, MIME check; NI signals read-only, no raw-text columns (`column_name in ('text','title','body')` absent); the owner can delete own NI signals, another user's delete affects 0 rows |
| `040_rules_prefs.test.sql` | Priority rule CRUD, invalid domain rejected, duplicate active rule rejected but duplicate of a soft-deleted rule allowed; learned preferences owner can disable/override/tombstone, cannot insert; tombstone unique blocks re-insert by service |
| `041_insights_briefings.test.sql` | `set_insight_status`: open→done ok; done→snoozed rejected; snooze without a future time rejected; `not_important` writes `ai_feedback`; another user's insight → 0 rows / not found; briefings unique `(user, kind, local_date)`; owner can set `opened_at` only; `weekly_stats` on morning rejected |
| `042_reply_drafts.test.sql` | Owner read-only; tone check |
| `050_approvals.test.sql` | Every legal edge succeeds and writes exactly one `approval_events` row; every illegal edge (`pending→executing`, `executed→failed`, `rejected→approved`, `expired→approved`) raises `ILLEGAL_TRANSITION`; approve with a wrong key raises `IDEMPOTENCY_MISMATCH`; repeated approve with the same key is a no-op (event count unchanged); approve after `approval_expires_at` → `expired`; direct `update approval_actions set status='executed'` as service_role (outside the function) raises; as authenticated it is denied; `failed→executing` retry keeps the key; `edit_approval_payload` bumps version and key and is rejected when not pending; `approval_events` update/delete raise `AUDIT_IMMUTABLE`-style errors; enqueue of `approval_execute` on approve (job exists with the expected key); R-06: `approved→rejected`, `failed→rejected` and `failed→expired` raise `ILLEGAL_TRANSITION` (no undo status); `approved` without `p_via` or with a value outside the R-03 tap surfaces is rejected; device executor: approve with another user's installation is rejected, `pending→approved→executing` in one call enqueues no job, a device result is accepted only with the matching `device_token_hash`, and `fail_stale_device_approvals` fails a device row still `executing` after 10 min (`DEVICE_RESULT_MISSING`) while ignoring server rows; `exact_change`, `executor` and `device_installation_id` are guarded like `payload` |
| `060_assistant_memory.test.sql` | Threads/messages isolation; `embedding` column not selectable by authenticated; `search_user_content` returns only the caller's rows (user B's identical content is invisible); expired chunks are excluded; the vector leg with a fixture embedding ranks the exact match first; RRF combines both legs; `person_intelligence` for another user's contact returns null; `preview_priority_rule` counts only own mail; `embedding_dr` not selectable; `search_user_content` rejects a 1536-d vector and accepts 1024-d; `p_contact_id` restricts results to rows linked to that contact; `p_from`/`p_to` filter on `source_timestamp`; a Free caller gets no vector leg |
| `061_ai_telemetry.test.sql` | `ai_requests`, `ai_model_config`, `prompt_versions`, `ai_result_cache`, `ai_budget_reservations`, `ai_model_prices`, `ai_calibration_versions` and `ai_batches` invisible to authenticated; `ai_usage_daily` OWN-R; `ai_budget_reserve` denies the 51st Free unit on the same local date (Istanbul) and allows it after local midnight, returns `l1` above `ai_soft_cap_usd_day` and denies above the daily or monthly hard cap, keeps the briefing reserve share, and `ai_budget_settle` is idempotent; expired holds are released by `scheduler_tick`; `ai_result_cache` duplicate `(user_id, feature, content_hash, prompt_version_id)` → unique violation, a 16-byte `content_hash` rejected; `ai_model_config` with model `claude-fable-5-1` (primary or inside `fallback_targets`) → check violation, a second row for the same `(profile, role, feature)` → unique violation; `ai_requests.status` outside the vocabulary rejected; `prompt_versions` unknown `prompt_key` rejected, second active per key → unique violation, activation with `eval_passed=false` rejected, content edit of an active version rejected, archived→active allowed |
| `070_notifications.test.sql` | Isolation; `data` containing `body` rejected; suppressed without a reason rejected; unique dedupe; `android_channel` accepts only the R-12 IDs (`brifing` rejected); `push_tickets` invisible |
| `080_business.test.sql` | `subscriptions` read-only and hidden columns (`rc_app_user_id` not selectable); `effective_entitlement` matrix (none; store active; store expired + grant active; two stacked grants → `active_until` = sum; revoked grant ignored; trial flag); a user calling it for another user raises `FORBIDDEN`; `grant_entitlement` idempotent on key; admin grant with `duration_days=3` rejected; `reward_referral` twice → exactly 2 credits and 2 grants; cap of 6 per 365 days blocks the 7th; `referrals` invisible to users; `plan_limits` readable, not writable; `plan_limits` value checks (`ai_routing_profile` = `"fast"` rejected, `max_mail_accounts` = `-1` rejected, `meeting_prep` = `1` rejected), seeded Free `ai_daily_budget_units` = 50 and Free/Pro routing profiles `lean`/`balanced` |
| `090_jobs.test.sql` | `enqueue_job` twice with the same key returns the same id; `claim_jobs` from two sessions (dblink-free variant: claim in session 1, then `select … for update skip locked` in a second transaction via `pg_background` is unavailable, so the test asserts the lease fields, and a tier-A-only test `090b_jobs_concurrency.test.sql` uses two connections through `pg_prove --jobs`); `fail_job` retryable → `retrying` with `run_after` within the backoff bounds [24 s, 36 s] for attempt 1; attempts ≥ max → `dead_letter`; non-retryable → `failed`; `complete_job` with a wrong worker → `LEASE_LOST`; `reap_expired_leases` moves expired leases; authenticated cannot execute `claim_jobs` |
| `091_scheduler_dst.test.sql` | Using `p_now`: Istanbul user at 05:00Z (08:00 local) → morning enqueued once, a second tick → no duplicate; Berlin user on 2026-10-25 (fall back) across 00:00Z–03:00Z → exactly one morning; New York user with `morning_time=02:30` on 2026-03-08 (gap) → fires at 03:00 local; weekly fires only on ISO Sunday ≥18:00 local; `briefing_weekdays` excludes Saturday → none; disabled user → none; midday for Free is enqueued and the worker marks it skipped (row status asserted by a worker test, here only the job exists); reminders due → a notification job; expired pending approval → `expired`; watch renewal job keys unique per hour; R-23: an event with an external attendee at T−60 enqueues `meeting_prep` once while an internal-only, non-VIP event does not; the prep notification job is keyed at `start_at − meeting_prep_lead_min`; an account past `pending_binding_until` enqueues `integration_purge`; a device approval past 10 min fails; support grants past expiry get one `support_access.expired` audit; rollups run at minutes 0/15/30/45 |
| `092_rate_limits.test.sql` | 5 hits allowed at limit 5, 6th false; new window resets; authenticated cannot execute |
| `100_ops_product.test.sql` | `analytics_events`, `feature_flags`, `announcements`, `user_feedback`, `system_health_checks` invisible to authenticated; bad `event_name` rejected; props >2 KB rejected; `announcement_dismissals` OWN-R/I; `evaluate_flags` honours kill switch, platform, plan, version, percentage bucketing determinism, and override precedence |
| `110_privacy.test.sql` | Export: second in-flight request → unique violation, owner read-only; deletion requests survive `auth.users` deletion with `user_id` null and `subject_hash` intact; `retention_cleanup` with `p_now = now()+100 days` deletes d90 content, memory_chunks and briefings, returns capture storage paths, keeps `until_deleted` users' rows and open tasks; `recompute_expires_at` after `d90→d30` shortens `expires_at`; `purge_user_history` keeps VIP, priority rules, connections and future events and deletes the listed sets; deleting `auth.users` cascades every ⟨OWN⟩ table to 0 rows for that user while `audit_logs` rows remain; `purge_user_history` also deletes `ai_result_cache`; account deletion writes `privacy_tombstones` hashes that survive the cascade and are invisible to authenticated; a history deletion request without re-auth (`confirmation_method='email_otp'`) is rejected |
| `120_admin_rbac.test.sql` | For **each** `admin_api` function (table-driven from `private.admin_function_permissions`, a static mapping view): non-admin → `ADMIN_REQUIRED`; admin with `aal1` → `ADMIN_AAL2_REQUIRED`; disabled admin → `ADMIN_REQUIRED`; roles lacking the permission → `ADMIN_FORBIDDEN` and a `denied` audit row; permitted role succeeds. Also: idle-expired and absolute-expired sessions → `ADMIN_SESSION_EXPIRED`; `users_list` returns masked emails (`~ '^.{1,2}\*\*\*@'`); a mutation without a reason → error; `command_search` with a free-text word returns no content matches; `custom_access_token_hook` adds `admin_role` only for active admins; a call without the gateway header → `ADMIN_GATEWAY_REQUIRED`; a JWT without `app_metadata.da_kind='admin'` → `ADMIN_REQUIRED`; `private.admin_role_permissions` equals the BACKOFFICE_PLAN §4.2 matrix row for row; `trg_admin_users_identity` rejects an auth user that has a `profiles` row |
| `121_audit_chain.test.sql` | Append 3 rows → `audit_verify_chain` ok; update/delete as `service_role` and `authenticated` → error; truncate → error; superuser tampering (disable trigger, alter a row, re-enable) → verify reports `first_bad_seq`; concurrent appends keep `chain_seq` contiguous (advisory lock) |
| `122_admin_users_guard.test.sql` | Single active super_admin: demote → `LAST_SUPER_ADMIN`, disable → same, delete → same; with two, one can be demoted; `admin_users.mfa_required=false` rejected |
| `123_support_access.test.sql` | A grant of any duration other than 15, 30 or 60 min rejected (R-09); `support_access_scope` values only (`mail_original_view` rejected as invalid input); reason <15 chars rejected; `support_access_authorize` after expiry or revocation → error; a scope outside the grant → error; valid use increments `reveal_count`, writes `pii.reveal` and returns stored derived fields only; `finance` and `readonly` roles cannot grant (no `support.access`) |
| `130_storage.test.sql` | Owner can select own `captures/…` object, not another user's; anon none; authenticated insert/update/delete on `storage.objects` → denied for all three buckets; bucket limits and MIME lists as specified; briefing audio paths are `{user}/{briefing}/{version}.mp3`; `captures` accepts `audio/mp4` and `application/json` for worker-written transient objects and reply attachments under `{user}/replies/` |
| `140_cron.test.sql` | (skipped with `skip()` if pg_cron is absent) `cron.job` contains exactly the 8 `da_*` jobs with the §9 schedules; count ≤ 8; `private.poke_worker` writes to `net._shim_requests` only when due jobs exist and uses the vault URL |
| `150_column_grants.test.sql` | Table-driven expectations of `has_column_privilege('authenticated', table, column, 'UPDATE'/'SELECT')` for every column grant in §4 (positive and negative), e.g. `insights.status` UPDATE true, `insights.confidence` UPDATE false, `email_messages.content_hash` SELECT false; `insights` / `commitments` / `life_events` `user_overrides` UPDATE false; `user_preferences.analytics_opt_out` UPDATE true; `notification_preferences.snooze_until` UPDATE false; `approval_actions.executor` UPDATE false |
| `160_user_rpcs.test.sql` | For every §6.9 RPC (RPC-01…19, `flow_meta`, `apply_insight_feedback`, `revert_insight_feedback`, `upsert_manual_contact`): owner success, another user's id → 0 rows or `NOT_FOUND`, anon denied; `mark_briefing_opened` moves `ready→delivered` once; `submit_ai_correction` rejects a field outside the allowlist and writes `user_overrides` + one `ai_feedback`; `apply_insight_feedback('make_vip')` stores the VIP row within `vip_max` and `revert_insight_feedback` removes it; with `learn_from_interactions=false` no `learned_preferences` row is written; `history_deletion_preview` counts equal what `purge_user_history` deletes; `plan_week_density` returns 7 rows with exactly one `is_today`; `set_commitment_status` on Free raises `ENTITLEMENT_REQUIRED:commitments` |

**CI gates:**
- Tier A: `supabase db reset && supabase test db && supabase db lint`.
- Tier C: `run-tier-c.sh`.
- `squawk` on migrations.
- The quality gate applies the plan R-17 banned-marker list (`scripts/quality-gate/banned-markers.txt`) to migrations, seeds and SQL tests.

---

## 14. Proposed additions to the canonical registry

| Addition | Kind | Justification |
|---|---|---|
| `source_type` (16 values incl. `android_notification`, `post_meeting_note`, `user_input`) | enum | ⟨PROV⟩ needs a typed `source_type` (M§97); SREQ-03 requires `android_notification` |
| `platform`, `user_state`, `vip_relationship`, `rule_condition`, `rule_outcome`, `referral_status`, `referral_side`, `subscription_status`, `reminder_status`, `export_status`, `deletion_kind`, `deletion_status`, `ai_feature` | enums | Vocabularies implied by M§30 (SREQ-37), §31 (PRIMARY 7.10 outcomes), §45/plan §16 statuses, §43/§60 subscription states, §29 reminders, §65/§128/§129 statuses, §56 feature breakdown. `deletion_kind` formalizes the plan's "kinds history \| account". |
| Columns `connected_accounts.capabilities_granted capability[]` + `data_source_toggles jsonb` | column group | Capability flags + Data Source Controls (M§40, SREQ-68) |
| `sync_states` watch fields (`watch_kind, watch_id, watch_resource_id, watch_token_hash, watch_history_id, watch_expires_at, watch_renew_after, lifecycle_*`, `window_*`, `rebaseline_due_at`) | column group | Gmail watch, Calendar channels, Graph subscriptions and delta windows (ADR-07, M§117) |
| `user_preferences` briefing schedule, `briefing_weekdays`, `working_hours_*`, `interest_categories`, `ai_data_access`, `dismissed_gates` | column group | M§9–12, SREQ-34/53/54/61, PRIMARY 7.3/7.6 |
| `notification_preferences.daily_cap`, `os_permission`, `vip_bypass_quiet`, `smart_filter` | columns | P-02, SREQ-57/60, PRIMARY 7.9 |
| `approval_actions.origin`, `approved_via` (enum `approval_via`, R-03), `approval_expires_at`, `requires_scope`, `side_effects`, `destination_label`, `exact_change`, `batch_id`, `executor`, `device_installation_id`, `device_token_hash` | columns | C-06/C-07, SREQ-20/43/45, progressive auth (ADR-07), device-executed approvals (R-18) |
| `jobs.progress` | column | First Analysis real counters (SREQ-55, F-08) instead of a separate `onboarding_analysis_jobs` table |
| `briefings.weekly_stats`, audio columns, `evening_ready_at` | columns | Weekly Review and audio without new tables (M§9, §11, §12) |
| `referrals` anti-abuse columns (`risk_score`, `risk_signals`, hashes, `qualification`) | columns | M§45, plan §16 |
| `plan_limits` key/value rows (`value jsonb`; R-22 canonical keys `max_mail_accounts`, `max_calendars`, `ai_daily_budget_units`, `ai_soft_cap_usd_day`, `ai_hard_cap_usd_day`, `ai_hard_cap_usd_month`, `ai_routing_profile`, feature booleans, plus `max_calendar_accounts`, `vip_max`, `priority_rules_max`, `ai_briefing_reserve_ratio` and the API_CONTRACTS §4.2 quota keys) with seeded values | reference data | Server gates for M§44/§82 and plan §8 budgets; `vip_max` semantics (storage allowed, effects Pro-only) resolves the M§34-step-11 vs M§44 tension |
| `private.tr_search` text search config, `private.immutable_unaccent` | DB objects | Turkish + unaccent FTS usable in generated columns (M§26, §95) |
| RPCs `public.preview_priority_rule`, `public.check_plan_limit`, `public.update_job_progress`, `public.extend_job_lease`, `public.transition_approval` (service wrapper), `public.audit_log_append` (service wrapper); private `edit_approval_payload`, `purge_user_history`, `recompute_expires_at`, `reward_referral`, `grant_entitlement`, `ai_budget_reserve`, `ai_budget_settle`, `evaluate_flags`, `enqueue_reconciliation`, `enqueue_billing_reconcile`, `poke_worker`, `reap_expired_leases`, `custom_access_token_hook` | functions | Needed to implement plan §5b/§6 behaviours: PRIMARY 7.10 preview, SREQ-44 edits, M§41/§129 purges, ADR-11 grants, ADR-04 jobs and cron, ADR-06 token hook |
| `admin_api.*` list in §6.10 | functions | One-to-one with plan §10 modules |
| `admin_api.support_access_authorize` + enum `support_access_scope` (R-09 values) | function + enum | M§49 reveal flow; 15/30/60-minute grants |
| Vault secret names `da_project_url`, `da_cron_secret` | config | Names for ADR-04's two Vault secrets |
| pg_cron job names `da_*` (8) | config | ADR-04 "≤8 concurrent" |
| Export artifact availability 24 h with **per-tap 300 s signed URLs** (instead of issuing a 24 h signed URL) | reconciliation | Signed URLs cannot be revoked (integrations audit F); this keeps plan §13's 24 h window without long-lived links |
| `admin_sessions.auth_session_id` + `idle_expires_at`/`absolute_expires_at` | columns | ADR-06 30 min idle / 12 h absolute |
| `support_tickets.public_ref` | column | M§69 "Ticket ID" palette lookup |
| `life_events.amount/currency/amount_evidence` + evidence checks | columns | M§23/§83, C-15 enforced at the DB level |
| Account-deletion jobs keep `jobs.user_id` null (subject in the payload) | rule | Lets the job survive the `auth.users` cascade it triggers (M§129) |
| Enums `routing_profile`, `ai_tier`, `approval_via`, `support_access_scope`, `admin_status` | enums | R-02/R-18 routing profiles; AI tiers (AI_PIPELINE_PLAN §3.1); R-03 tap surfaces; R-09 scopes; admin invite/disable |
| Enum values: `capture_status.pending_upload`; `job_type` `capture_analysis`, `credential_reencrypt`, `integration_purge`, `ai_batch`, `ai_eval`, `briefing_audio`, `transactional_email`; `rule_condition.android_app`; `ai_feature` vocabulary from AI_PIPELINE_PLAN plus `admin_probe` | enum values | API-CAP-01 row before upload; jobs named by INTEGRATION/AI/API/SECURITY plans; M-ANI-03 rules; R-20 |
| Tables `ai_result_cache` (spine §5), `ai_budget_reservations`, `ai_model_prices`, `ai_calibration_versions`, `ai_batches`, `api_idempotency_keys`, `app_settings`, `metrics_daily`, `ai_metrics_daily`, `web_analytics_daily`, `privacy_tombstones`, `admin_mfa_recovery_codes`, `private.admin_role_permissions`, `private.demo_fixture_state`; view `connected_account_sync_health` | tables / view | Cost control (plan §8), HTTP idempotency, backoffice settings and rollups, referral anti-abuse after deletion, MFA recovery, SQL-layer RBAC, real demo writes, owner-visible sync freshness |
| Columns: `oauth_states` completion binding (`device_nonce_hash`, `completion_code_hash`, `completed_at`, `approval_id`, `token_ciphertext`, `token_iv`, `result`, `error_code`); `connected_accounts.pending_binding_until`, `demo_flavor`; `oauth_credentials` refresh lock + `client_id_hint`; `sync_states` `page_token`, `next_poll_at`, `lease_*`, `stats`; `user_overrides` on insights, commitments and life events; `user_preferences` and `notification_preferences` additions (§4.1); `email_messages` / `email_threads` AI columns; `briefings.origin`, `version`, `source_freshness`; `captures.progress`, `file_deleted_at`; `reminders.anchor_at`, `destination`, `origin`; `reply_drafts.attachments`; `ai_feedback.detail`, `client_mutation_id`; `profiles.is_demo`, `is_internal`; `app_installations.ni_last_signal_at`, `platform_capabilities`; `data_deletion_requests.status_token_hash`; `support_access_grants.revoked_by`, `expired_audited_at` | columns | R-07, R-13, R-14, R-16, R-19, R-23, R-24 and the accepted registry decisions of the cross-document critique |
| RPCs RPC-04…19 (`today_overview`, `flow_feed`, `set_commitment_status`, `mark_briefing_opened`, `mail_intelligence`, `plan_range`, `list_approvals`, `get_usage_summary`, `vip_suggestions`, `dismiss_announcement`, `get_explanation`, `submit_ai_correction`, `plan_week_density`, `history_deletion_preview`) plus `flow_meta`, `apply_insight_feedback`, `revert_insight_feedback`, `upsert_manual_contact`; private helpers `mask_name`, `mask_push_token`, `consume_provider_quota`, `try_lock_credential_refresh`, `enforce_calendar_selection_limit`, `user_apple_sub`, `assert_admin_gateway`, `fail_stale_device_approvals`, `rollup_metrics_daily`, `ai_breaker_state`, `memory_stats`, `job_admin_policy`, `valid_plan_limit`, `valid_app_setting`, `model_routable`, `targets_routable` | functions | R-24 dead-action closure; INTEGRATION_PLAN §3.4/§3.6; BACKOFFICE_PLAN §3 and §7.6; ADR-44 |

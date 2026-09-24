# Dijital Asistan — Implementation Plan

> This is the master implementation document for the build (M§0.A, M§106, M§120).
>
> - **Part A** is the 22-part plan summary that M§120 requires. It restates the canonical master plan in tighter wording and keeps every decision.
> - **Part B** is the Work Breakdown Structure (WBS), in dependency order. A Claude Code session executes it from top to bottom.
> - **Parts C–F** cover the commit plan, where each check is verified, the risk register and requirement traceability.
> - The last section lists names this plan uses that the canonical spine does not yet contain.

| Item | Value |
|---|---|
| File | `docs/IMPLEMENTATION_PLAN.md` |
| Date | 2026-09-23. Every package version was verified on this date. |
| Branch | `claude/magical-pascal-edvjgn` (repository `aieasycep/DijitalAsistanim-Opus5.5-`) |
| Canonical spine | The master plan. It fixes the following, and this document uses its names exactly: ADR-01…ADR-15, the §5 enums and tables, the §5b `api` routes, the §9 mobile route tree, the §10 backoffice routes, the §11 web routes, the §21 execution order and the §22 Definition of Done. |
| Functional authority | The master prompt, cited as `M§n` (154 sections). The `secondary-docs` audit adds the adopted secondary requirements `SREQ-01…104` and the resolved contradictions `C-01…C-37`, `V-01…V-09`, `S-01…S-11` and `P-01…P-06`. |
| Visual authority | The PRIMARY archive, `Dijital Asistan tasarım sistemi son.zip`. The SECONDARY archive is used for coverage only; its fake behaviour is never copied. |
| Companion specs (the detail lives there) | `ARCHITECTURE_DECISIONS.md`, `DESIGN_AUDIT.md`, `SCREEN_AND_FLOW_MAP.md`, `DATABASE_AND_RLS_PLAN.md`, `INTEGRATION_PLAN.md`, `API_CONTRACTS.md`, `AI_PIPELINE_PLAN.md`, `BACKOFFICE_PLAN.md`, `SECURITY_AND_PRIVACY_PLAN.md`, `TEST_PLAN.md`, `DELIVERY_CHECKLIST.md`, `KNOWN_PLATFORM_LIMITATIONS.md` |
| Scope rule | The build is one product. The step order is purely a technical dependency order, and every item ships (M§120, M§139). |

**Markers**

- **External credential required.** The owner supplies a secret or account at runtime. The code ships either way. Adapters report `external_credential_required`, the UI shows "Harici kimlik bilgisi gerekli" and System Health shows `external_credential_required`, the `system_health_checks.status` value (M§90).
- **Manual external step.** The owner performs a console, DNS, store or partner action outside the repository.

**Contents**
- Part A: plan summary A1–A22
- Part B: WBS. It covers steps 0–12 in 173 tasks, T-0.01 through T-12.11.
- Part C: milestones and commit plan
- Part D: what is verified in the container, in CI and on EAS
- Part E: risk register (top 15)
- Part F: index from requirement area to task ID
- Proposed additions to the canonical registry

---

## Part A — Plan summary (M§120)

### A1. Repository state

| Item | Finding |
|---|---|
| Git | Branch `claude/magical-pascal-edvjgn`. There are **no commits** and the working tree holds only `.git`. `git status` re-checked this on 2026-09-23. |
| Source, config, lockfile, CI, native, Supabase, env, secrets | None exist, so a clean monorepo is created (M§5). |
| Design inputs | Two ZIPs in the session upload directory: `359bbc52-Dijital_Asistan_tasar_m_sistemi_son.zip` (PRIMARY) and `3f76aa8a-Dijital_Asistan_m_21.zip` (SECONDARY). Execution extracts them into `design/reference/`, which is git-ignored. Only the tokens, icon lists and copy extracted from them are committed. |
| Container | Ubuntu 24.04.4 running as root, 4 vCPU, 15 GB RAM.<br>Node 22.22.2. CI, EAS and Vercel use Node 24.21.0 LTS.<br>pnpm comes through corepack.<br>The Docker client is present but **the daemon is not running**.<br>PG16 binaries are installed and the cluster is down. pgvector, pgTAP and pg_cron are not installed; apt provides pgvector 0.6.0, pgTAP 1.3.2, pg_prove 3.36 and pg_cron 1.6.2. pg_net is unavailable.<br>Deno is not installed; the npm package `deno@2.1.4` works.<br>There is no Android SDK or Xcode.<br>Playwright Chromium 141 is at `/opt/pw-browsers`, and Chrome for Testing 153 can be downloaded.<br>OpenJDK 21 is present; the `gh` CLI is not. |
| Network | **Reachable:** registry.npmjs.org, jsr.io, raw.githubusercontent.com, GitHub release downloads, storage.googleapis.com, fonts.googleapis.com, archive.ubuntu.com, repo1.maven.org, api.anthropic.com.<br>**Blocked:** api.expo.dev, expo.dev, exp.host, api.supabase.com, graph.microsoft.com, api.openai.com, api.revenuecat.com, sentry.io, vercel.com, deno.land, esm.sh, cdn.playwright.dev, dl.google.com, get.maestro.mobile.dev. |

**Consequence.** The container can verify the following:
- lint and typecheck;
- Vitest and jest-expo unit tests;
- database and RLS tests on local PG16 through a Supabase compatibility shim (tier C);
- Deno tests for the Edge Functions;
- `next build` for both web apps;
- Playwright for the web app;
- the `expo export` bundle smoke test and `expo prebuild` plugin validation.

The authoritative database tier A (the full Supabase stack), native EAS builds, Maestro, remote deploys and live provider calls run in CI or with the owner. The final report states where each check ran (Part D).

### A2. Design findings (full detail in `DESIGN_AUDIT.md`)

**The PRIMARY archive is the binding visual language.** It has ten canvases: `01 Tasarım Sistemi`, `02 Onboarding`, `03 Bugün ve Brifingler`, `04 Akış ve Mail`, `05 Plan ve Toplantılar`, `06 Asistan Hafıza Kişiler`, `07 Hesap Gizlilik Pro`, `08 Durumlar Widgetlar Etkileşimler` and `09 Pazarlama`, plus the hub `Dijital Asistan.dc.html`.

**Tokens** (names verbatim; they become `packages/design-tokens`):

| Group | Light values | Dark values |
|---|---|---|
| Brand | `brand/primary #5B5CE2`, pressed `#4B4CCB`, soft `#EDEDFC`, text-on-soft `#4547C9`, dark glow `#A9AAF5` | primary `#8586F2`, glow `#A9AAF5`, on-primary `#0F0F2A` |
| Critical | `#E0553F`, soft `#FCEDE9`, text `#C7432F` | text `#F08B78` |
| Warning | `#E09A1C`, soft `#FDF2DC`, text `#9A6300` | text `#F0B85A` |
| Success | `#2FA062`, soft `#E4F5EA`, text `#1E7A47` | text `#6FCF97` |
| Info | `#3B82E6`, soft `#E7F0FD`, text `#2262BE` | — |
| Surfaces | `bg #F5F4F0`, `surface #FFFFFF`, `surface-2 #F0EFEB`, `hairline #E9E7E1` (rgba 27,25,23,.06), `editorial/paper #FBFAF7` | bg `#141311`, surface `#1F1E1B`, surface-2 `rgba(255,255,255,.08)` |
| Ink | `#1A1917`, `#6B6860`, `#9B978E`, disabled `#B8B4AA` | text `#F2F0EB`, `#A39F96`, `#7A776F` |
| Gradients | `dawn` (morning), `night` (voice, audio, analysis), `dusk` (evening) | — |

Dark cards use a 6% white ring instead of a shadow.

**Typography, icons and layout**
- Type is Geist:
  - display 34/40/600/−2.5%;
  - h1 28/34/600, h2 22/28/600, h3 17/23/600;
  - body 15/22/400, secondary 14/20;
  - kicker 12/16/600, +8%, caps;
  - micro 11/14/700, +5%.
- Lora is used for editorial text (narrative 18/29, editorial display 34/40/500).
- Icons are Material Symbols Rounded, with FILL 0 by default and FILL 1 when active. React Native cannot drive variable-font axes, so the icons are generated as SVG components.
- Spacing is a 4-pt grid (4…40) with a 20 gutter.
- Radius: 10 icon tile · 12 inline button · 14 button · 16 small card · 20 card · 28 hero/page · 999 pill.
- Card elevation: `0 1px 2px rgba(27,25,23,.04), 0 6px 20px rgba(27,25,23,.05)`.

**Rules stated in the design**
- Colour carries meaning only.
- Indigo appears only on AI markers, the primary action, the selected tab and links.
- Only ACİL, SON TARİH, GÜVENLİK and ONAYLANDI badges are coloured.
- A dashed border means "proposed, not real yet".
- Every AI inference carries a source line.
- A raw mail body appears only under "Orijinal Mail".
- There are exactly 4 tabs. New capability appears as cards inside a tab.

**Accessibility debt**
- `ink/tertiary #9B978E` on `#F5F4F0` fails AA. It is kept only for kicker and meta text of at least 12px. Informational text uses `ink/tertiary-strong #6F6C66`. This is a documented, minimal deviation.
- The design claims a 9:1 ratio for on-primary text. The real ratio is 5.96:1, which still passes AA.

**Coverage.** PRIMARY covers:
- Onboarding 2.1–2.13, including Android notification access.
- Today (light and dark), Morning/Audio/Midday/Evening/Weekly and the share card.
- Flow with 10 card types; Mail Intelligence; Email Detail; AI Reply in 4 tones; Follow-up; Waiting; Commitments; Life cards.
- The Smart Reminder sheet and Universal Capture 4.10–4.14.
- Plan day and week; conflicts; Meeting Prep and the 2-minute summary; Post-meeting.
- Assistant with rich cards; Voice; Memory; VIP; Person.
- Approval Center; AI Personalization; the Settings hub; Privacy Center; Data Sources; Retention and deletion.
- Paywall and the contextual Pro gate; Referral; Appearance and Language; Priority Rules CRUD.
- All states; widgets; motion; store screenshots; 9:16 ads.

**SECONDARY-only screens.** Their structure is adopted and restyled to PRIMARY:
- Notification Settings, Briefing Settings, Help and Feedback;
- the per-account axis of Data Source Control;
- the Integrations list with Google Tasks, Microsoft To Do and Apple Reminders;
- the calendar-permission-denied state and the VIP onboarding step;
- the marketing landing page structure and the notification copy catalogue.

**Rejected from SECONDARY:** timer-only splash navigation, the Android frame, IA/UserFlows/DesignSystem pages presented as app screens, the accent-colour picker, "Yakında" languages, the purple deadline colour, the Inter font and emoji icons.

**Prototype fakes never copied** (full inventory in DESIGN_AUDIT):
- canned assistant answers and timer-driven "analysis";
- fake send / "Gönderildi" and the fake Meet handoff;
- instant fake connect and disconnect;
- approvals that exist only locally and fake audio progress;
- hard-coded counts;
- "Çözüldü!" calendar changes made without approval;
- settings that are never persisted;
- the swapped Mail Intelligence wiring and the ±10% "15 s" seek bug.

**Resolved contradictions.** Contradictions C-01…C-37 are resolved; the table is in DESIGN_AUDIT and the secondary-docs audit. The master prompt wins on function:
- briefing section labels and the 9 Flow card types;
- onboarding order;
- a trial is offered only when the store offers one; the word "Sınırsız" is never used;
- voice-initiated writes need on-screen approval;
- push content is non-sensitive by default;
- Android notification-intelligence (NI) copy matches the on-device processing.

PRIMARY wins on visuals. Demo data uses PRIMARY names (Ahmet Yılmaz — Kuzey Lojistik, Mehmet Yılmaz — Yılmaz Endüstri, Selin Kaya), with dates relative to "now".

### A3. Architecture (rationale in `ARCHITECTURE_DECISIONS.md`)

**ADR-01 Monorepo**
- pnpm **11.27.1** workspaces with **Turborepo 2.11.3**. CI, EAS and Vercel run Node **24 LTS**; `engines.node >=22.13.0`.
- A default pnpm catalog plus a named catalog `expo`, pinned exactly to `expo@57.0.24/bundledNativeModules.json`.
- `overrides` pin react, react-dom and react-native.
- pnpm's `minimumReleaseAge` (1440 min) is respected.
- Prettier 3.9.9, ESLint **9.39.5** flat config and typescript-eslint 8.70.1.

```
apps/mobile      Expo SDK 57 · RN 0.86.3 · React 19.2.3 · Expo Router 57 (development build + EAS; never Expo Go)
  app/ (routes §A9) · src/ (features, lib) · modules/{notification-intelligence,da-widgets,da-share,da-tts} · targets/widget (SwiftUI)
apps/web         Next.js 16.3.6 App Router · Tailwind v4 · next-intl (marketing, SEO)
apps/backoffice  Next.js 16.3.6 · Tailwind v4 · shadcn/Radix · TanStack Table v9 · Recharts (admin.<domain>)
packages/{design-tokens, ui (RN only), domain (pure, Deno-safe), validation (zod 4, Deno-safe), api-client, i18n, config}
supabase/        config.toml · migrations/ · seed/ (demo, gated) · tests/ (pgTAP + shim) · functions/ (Deno 2.1)
design/  docs/  scripts/  .github/workflows/
```

**ADR-02 Versions**

| Area | Pins |
|---|---|
| Language and React | TypeScript **~6.0.3** (7.0 has no programmatic API; typescript-eslint requires <6.1) · React **19.2.3** everywhere |
| Expo and React Native | Expo **~57.0.24** · RN **0.86.3** · reanimated **4.5.1** + worklets 0.10.1 · gesture-handler ~2.32 · screens ~4.26 · safe-area ~5.7 · flash-list 2.0.2 |
| Web | Next **16.3.6** (fallback 16.3.5) · Tailwind 4.3 |
| Shared runtime | zod **4.6.5** · supabase-js 2.117.x · @supabase/ssr 0.12.7 · TanStack Query 5.103 (+ persist-client) · zustand 5.0.15 · react-hook-form 7.88 · next-intl / use-intl 4.14.6 · date-fns 4.4 + @date-fns/tz 1.5 |
| Mobile libraries | MMKV 4.3.2 (AES-256) · react-native-purchases **10.10.1** · @sentry/react-native 8.27 (excluded from the Expo install check) · @react-native-google-signin 16.1.5 · expo-apple-authentication · expo-web-browser · expo-share-intent **8.0.1** · @bacons/apple-targets **5.0.0** · expo-speech-recognition 57.1.0 · @expo-google-fonts/geist and lora · @material-symbols/svg-400 (codegen input) |
| Monitoring | @sentry/nextjs 10.75 |
| Testing | jest-expo ~57.0.5 + jest 29.7 + RNTL 14 · Vitest **4.1.11** · Playwright 1.63 · Maestro 2.10 |
| Backend runtime | Deno **2.1.4** · Hono 4.13.8 · @anthropic-ai/sdk 0.128 · openai 7.23 · Supabase CLI 2.117 (hosted Postgres 17; migrations stay PG16-compatible) |

**Not used:** NativeWind, Tamagui, Unistyles, expo-widgets, react-native-purchases-ui, Detox, expo-auth-session, i18next.

**ADR-03 Mobile styling.**
- Plain `StyleSheet` with typed `useTheme()` token hooks; React Compiler on.
- Every component is theme-aware.
- Accessibility is built into the primitives: labels, roles, 44pt/48dp hit slop, Dynamic Type with capped multipliers, reduce motion, and `accessibilityActions` for every swipe.

**ADR-04 Backend shape.**
- **Reads** go to PostgREST under RLS through `packages/api-client`, with explicit column lists and `security invoker` views and RPCs.
- **Writes with no side effect** go to PostgREST under RLS with column-level GRANTs.
- **Anything with a side effect, AI, provider access or secrets** goes to Edge Functions: Deno 2.1, Hono routers, one `deno.json` per function, a relative import map into `packages/domain` and `packages/validation`, deployed with `--use-api`.

| Function | Auth | Purpose |
|---|---|---|
| `api` | user JWT (`verify_jwt=true`) | Mobile/web BFF: integrations, approvals, reply drafts, assistant, search, capture, reminders, briefing audio, meeting prep, post-meeting, entitlements, referrals, export/deletion, devices/push, Apple token exchange, feedback/support |
| `oauth` | none (state-validated) | `/google/callback`, `/microsoft/callback`: PKCE exchange, token encryption, account upsert, deep-link redirect |
| `webhooks-google` | Pub/Sub OIDC JWT / channel-token HMAC | Gmail push, Calendar channel notifications → enqueue |
| `webhooks-microsoft` | clientState (hashed, constant-time) | Graph change and lifecycle notifications, validationToken echo → enqueue (<3 s) |
| `webhooks-revenuecat` | Authorization secret (constant-time) | Store events → `billing_events` + enqueue |
| `worker` | secret key (`automations`) | Job runner invoked by pg_cron/pg_net |
| `admin-api` | admin JWT, `aal2`, active `admin_users`, permission | Every backoffice read/mutation, audit, privileged ops |
| `public-api` | none + rate limit | Web support form, data-deletion (email-OTP verified), referral resolve |
| `health` | secret or admin | Real probes for System Health |

- **Jobs.** A first-party `jobs` table with statuses `queued | running | completed | retrying | failed | dead_letter`.
  - `claim_jobs(worker_id, types[], limit, lease_seconds)` uses `FOR UPDATE SKIP LOCKED`.
  - `idempotency_key` is unique.
  - Retries use exponential backoff with jitter; after `max_attempts` a job goes to `dead_letter`. Every attempt is recorded in `job_attempts`, and each job carries a correlation ID.
  - pg_cron (UTC) runs `scheduler_tick()` every minute and pokes `worker` every 15 s through pg_net.
  - Latency-sensitive enqueues poke the worker immediately. At most 8 cron jobs run concurrently.
  - pgmq was rejected.
- **Secrets.**
  - Secrets live in Edge secrets, using `sb_publishable_…` / `sb_secret_…` keys.
  - Vault holds only `da_project_url` and `da_cron_secret` (DATABASE_AND_RLS_PLAN §9).
  - Web and backoffice hold no Supabase secret key.

**ADR-05 Data and privacy.**
- **Every user-data table** has:
  - `user_id uuid not null` → `auth.users` on delete cascade;
  - RLS enabled and forced;
  - UTC `created_at` / `updated_at`;
  - indexes on `(user_id, …)`.
- **Timezone** lives in `user_preferences.timezone` (IANA, default `Europe/Istanbul`).
- **Provenance.** Derived objects carry `source_type, source_id, source_provider, source_timestamp, confidence` plus `evidence jsonb` (verified quotes of at most 300 chars).
- **No raw email bodies are stored.** "Orijinal Mail" is fetched on demand through `api`, sanitized, and neither stored nor logged.
- **OAuth tokens** are AES-256-GCM ciphertext in `oauth_credentials`:
  - encryption and decryption happen only in Edge Functions;
  - key versions are `TOKEN_ENC_KEY_V{n}`, with the active one in `TOKEN_ENC_ACTIVE_VERSION`;
  - the AAD binds account + provider + kind;
  - the table has RLS on and no policies.
- **Retention** defaults to 90 days (options 30 / 90 / 365 / until deleted). The `retention` job enforces it, including embeddings and storage.
- **Audit logs** are append-only and hash-chained.

**ADR-06 Auth.**
- **App login uses Supabase Auth:**
  - Sign in with Apple: a native id_token + nonce. The server also exchanges `authorizationCode` and stores the Apple refresh token encrypted, so it can be revoked at deletion.
  - Google: native sign-in → `signInWithIdToken`, scopes openid/email/profile only.
  - Microsoft: `signInWithOAuth` azure + PKCE via `openAuthSessionAsync`, with the `xms_edov` claim.
  - Email OTP: 6 digits over custom SMTP.
  - Android also offers Apple through web OAuth.
- **Session storage** uses LargeSecureStore: the AES key sits in SecureStore and the ciphertext in MMKV. The keychain is purged on first run.
- **Logout** = `signOut({scope:'local'})` + push token disable + encrypted cache wipe + RevenueCat `logOut`. "Tüm cihazlardan çıkış" signs out globally.
- **Integrations are separate from login** (an Apple-login user can connect Gmail).
- **Backoffice boundary:**
  - same Supabase project, but a separate app, domain and cookie `__Host-da_admin` (httpOnly, Secure, SameSite=Strict);
  - `admin_users` rows define admins, and a custom access token hook adds `admin_role` only for active admins;
  - TOTP MFA is mandatory, so `admin-api` and restrictive `admin_api` policies require `aal2`;
  - idle timeout 30 min and absolute limit 12 h, tracked in `admin_sessions`; "logout all sessions" is supported;
  - server actions reject a missing or foreign `Origin`;
  - rate limiting runs in `proxy.ts` plus the DB function `rate_limit_hit()`.

**ADR-07 Integrations.**
- Provider adapter interfaces live in `packages/domain`: `MailProvider`, `CalendarProvider`, `TaskProvider`.
- Implementations are `google`, `microsoft` and `demo`. `demo` runs only when `DEMO_MODE=true` and refuses production unless `ALLOW_DEMO_IN_PRODUCTION=true`.
- The device providers `apple_device` and `android_device` upload minimal normalized snapshots.
- OAuth is server-side (authorization code + PKCE, single-use `oauth_states` valid for 10 min) with least privilege and progressive scopes.
- **There is no `gmail.compose` scope**: drafts live in our database.
- Sync, watches, disconnect and revoke are summarized in A7.

**ADR-08 AI** → A8. **ADR-09 Approvals** → A5 invariants, A7 idempotency.

**ADR-10 Notifications.**
- `worker` sends through Expo Push with the enhanced security token.
- A server-side decision engine decides what to send.
- Android uses channels; iOS uses interruption levels.
- Detail modes are rendered server-side, with `title_only` as the default.
- Receipts are polled.
- Device-local notifications are used only for smart reminders the user creates.

**ADR-11 Subscriptions.**
- RevenueCat with entitlement `pro` and products `da_pro_monthly` / `da_pro_annual`.
- Each webhook triggers a customer re-fetch (REST v2), which overwrites the `subscriptions` mirror.
- Referral and admin grants live in `entitlement_grants`.
- `effective_entitlement(user_id)` is used by both client and server.
- A custom PRIMARY-style paywall; trial copy appears only when the store offer exists.

**ADR-12 Widgets, share, Android NI.**
- **iOS widgets:** WidgetKit (SwiftUI) via `@bacons/apple-targets` and App Group `group.com.dijitalasistan.app`.
- **Android widgets:** Jetpack Glance 2×2 and 4×2 in the local module `da-widgets`.
- **Widget data:** a shared, privacy-safe `WidgetSnapshot` (zod). Widgets are read-only and link deep into the app.
- **Share:** `expo-share-intent` feeds the common Universal Capture flow.
- **Android NI:** a Kotlin `NotificationListenerService`:
  - explicit opt-in, with all-apps or selected-apps mode;
  - a locked default denylist (authenticators, password managers, e-Devlet, an OTP detector);
  - **on-device structured-signal extraction only**;
  - hidden entirely on iOS.

**ADR-13 Analytics and observability.**
- First-party `analytics_events`: allow-listed names and typed properties, no content.
- Sentry adapters with PII scrubbing.
- JSON logs carry a `correlation_id` along User → Integration → Job → AI/Briefing → Notification.
- `ai_requests` records telemetry without content.

**ADR-14 i18n.**
- ICU catalogs in `packages/i18n`: `tr` is the default and `en` is complete. Keys are typed.
- `use-intl` on mobile, `next-intl` on web.
- 24-hour clock and `tr-TR` number and currency formats.
- date-fns `tr` for relative time (Hermes lacks `Intl.RelativeTimeFormat`).
- A pseudo-locale adds 40% length.
- The gate bans hard-coded strings and "yakında" / "coming soon".

**ADR-15 Testing and CI** → A17 and A18.

### A4. App boundaries

| Boundary | Talks to | Holds secrets? | Auth |
|---|---|---|---|
| Mobile | PostgREST (RLS, publishable key), `api`, provider OAuth pages via the system browser, RevenueCat SDK, Expo push registration | No: only the publishable key and RevenueCat public SDK keys | Supabase session (SecureStore) |
| Web | `public-api`, Supabase Auth OTP (for data deletion) | No | none / OTP |
| Backoffice | `admin-api` only (server-side, from the admin's access-token cookie) | Only its own session secrets; no Supabase secret | Supabase Auth + TOTP (`aal2`) + `admin_users` role |
| Edge Functions | Postgres, Storage, providers, AI, Expo Push, RevenueCat | Yes (Edge secrets) | per function |
| Postgres | pg_cron → pg_net → `worker` | Vault: project URL + cron secret | RLS + restrictive admin policies |

### A5. Domain model (canonical names; full spec in `DATABASE_AND_RLS_PLAN.md`)

**Enums.** Each one exists both as a Postgres enum and as a const union in `packages/domain`.

| Enum | Values |
|---|---|
| `provider` | `google \| microsoft \| apple_device \| android_device \| demo` |
| `capability` | `mail_read \| mail_send \| calendar_read \| calendar_write \| tasks_read \| tasks_write` |
| `account_status` | `connecting \| healthy \| syncing \| partial \| needs_reauth \| admin_consent_required \| error \| disconnected` |
| `mail_category` | `important \| awaiting_my_reply \| awaiting_their_reply \| has_deadline \| informational \| low_priority` (UI labels: Önemli / Senden Cevap Bekleyen / Senin Cevap Beklediğin / Son Tarih İçeren / Bilgilendirme / Düşük Öncelik) |
| `decision_tier` | `explicit_rule \| learned_preference \| deterministic_signal \| ai_classification` |
| `insight_kind` | `reply_needed \| meeting \| deadline \| follow_up \| commitment \| life_event \| security \| conflict \| schedule_suggestion \| approval_pending \| digest` |
| `urgency` | `urgent \| today \| normal \| low` |
| `item_status` | `open \| done \| dismissed \| snoozed \| expired` |
| `life_event_type` | `shipment \| flight \| reservation \| payment \| subscription \| security` |
| `flow_card_type` | `email \| meeting \| deadline \| shipment \| flight \| reservation \| payment \| subscription \| security` (plus `follow_up` and `commitment` rendered as neutral variants) |
| `commitment_direction` | `user_owes \| they_owe` |
| `commitment_status` | `open \| done \| snoozed \| cancelled` |
| `approval_action_type` | `email_send \| calendar_create \| calendar_update \| task_create \| reminder_create \| commitment_create` |
| `approval_status` | `pending \| approved \| rejected \| executing \| executed \| failed \| expired` |
| `briefing_kind` | `morning \| midday \| evening \| weekly` |
| `briefing_status` | `scheduled \| generating \| ready \| delivered \| skipped \| failed` |
| `capture_kind` | `photo \| screenshot \| pdf \| file \| link \| text \| share` |
| `capture_status` | `uploaded \| analyzing \| extracted \| actioned \| discarded \| failed` |
| `extracted_entity_type` | `event \| task \| deadline \| person \| payment \| reservation \| flight \| shipment \| product \| note` |
| `notification_category` | `morning \| midday \| evening \| critical_email \| meeting \| deadline \| follow_up \| life_intel \| approval \| account` |
| `notification_detail` | `full \| title_only \| generic` |
| `notification_decision` | `scheduled \| sent \| suppressed \| deduplicated \| failed` |
| `job_type` | `initial_sync \| gmail_sync \| outlook_sync \| calendar_sync \| tasks_sync \| device_calendar_ingest \| watch_renewal \| reconciliation \| provider_webhook \| email_triage \| email_analysis \| insight_refresh \| first_analysis \| briefing \| meeting_prep \| embedding \| approval_execute \| notification \| push_receipts \| retention \| export \| history_deletion \| account_deletion \| billing_sync \| referral_evaluate \| health_check` |
| `job_status` | `queued \| running \| completed \| retrying \| failed \| dead_letter` |
| `admin_role` | `super_admin \| operations \| support \| finance \| ai_ops \| analyst \| readonly` |
| `prompt_status` | `draft \| active \| archived` |
| `ticket_status` | `open \| in_progress \| waiting_user \| resolved \| closed` |
| `ticket_category` | `account \| integration \| sync \| billing \| ai_quality \| notification \| privacy \| other` |
| `feedback_type` | `bug \| feature \| general \| ai_quality` |
| `grant_source` | `referral_referrer \| referral_referee \| admin \| support \| compensation` |
| `retention_policy` | `d30 \| d90 \| d365 \| until_deleted` |

**Tables**

| Group | Tables |
|---|---|
| Identity & settings | `profiles`, `user_preferences`, `notification_preferences`, `app_installations`, `push_tokens` |
| Integrations | `connected_accounts`, `oauth_credentials`, `oauth_states`, `calendars`, `sync_states`, `provider_quota_usage`, `webhook_events` |
| Content | `email_threads`, `email_messages`, `calendar_events`, `tasks`, `commitments`, `reminders`, `meeting_notes`, `meeting_preps`, `contacts`, `vip_people`, `life_events`, `captures`, `android_notification_signals` |
| Intelligence | `priority_rules`, `learned_preferences`, `insights`, `briefings`, `briefing_items`, `reply_drafts`, `approval_actions`, `approval_events`, `assistant_threads`, `assistant_messages`, `memory_chunks` (`vector(1024)`), `ai_feedback`, `ai_requests`, `ai_usage_daily`, `ai_model_config` (routing profile `balanced \| lean`), `ai_result_cache`, `prompt_versions` |
| Notifications | `notifications`, `push_tickets` |
| Business | `subscriptions`, `billing_events`, `entitlement_grants`, `plan_limits`, `referral_codes`, `referrals`, `referral_credits` |
| Ops/product | `jobs`, `job_attempts`, `analytics_events`, `feature_flags`, `feature_flag_overrides`, `announcements`, `announcement_dismissals`, `user_feedback`, `system_health_checks`, `rate_limits` |
| Privacy | `data_export_requests`, `data_deletion_requests` (kinds `history \| account`) |
| Admin | `admin_users`, `admin_sessions`, `admin_preferences`, `audit_logs`, `support_tickets`, `support_notes`, `support_access_grants` |

**Schemas**
- `public`: RLS-protected user data plus the exposed RPCs.
- `private`: security-definer helpers; not exposed.
- `admin_api`: exposed only for `admin-api` calls. Every function calls `private.require_admin(permission)`.

**Invariants**
- **Unique keys:**
  - `email_messages (connected_account_id, provider_message_id)`, `email_threads (connected_account_id, provider_thread_id)`, `calendar_events (calendar_id, provider_event_id)`;
  - `insights / life_events / commitments (user_id, dedupe_key)`, `reminders (user_id, idempotency_key)`, `approval_actions (idempotency_key)`, `briefings (user_id, kind, local_date)`, `notifications (user_id, dedupe_key)`;
  - `jobs (idempotency_key)`, `billing_events (event_id)`, `webhook_events (source, external_id)`, `referral_credits (referral_id, side)`, `entitlement_grants (idempotency_key)`;
  - `prompt_versions (prompt_key, version)` plus a partial unique index that allows one `active` version per key;
  - `vip_people (user_id, contact_id)`.
- **Priority precedence:** `explicit_rule → learned_preference → deterministic_signal → ai_classification`. Each result stores `decision_tier`, `reason`, `rule_id?` and `confidence`.
- **Approval state machine** (DB-enforced by `private.transition_approval`):
  - `pending → approved → executing → executed | failed`;
  - `pending → rejected | expired`;
  - `failed → executing` (a retry keeps the same key);
  - an edit while `pending` creates a new payload version with a new idempotency key.

**`api` route catalogue** (Hono at `/functions/v1/api`; contracts in `API_CONTRACTS.md`). Clients never insert `approval_actions`: every side-effecting write is *proposed* through `api`.

| Area | Routes |
|---|---|
| Devices/auth | `POST /devices/register`, `POST /devices/unregister`, `POST /auth/apple/exchange` |
| Bootstrap | `GET /me/bootstrap`, `GET /me/entitlements` |
| Integrations | `POST /integrations/:provider/start`, `POST /integrations/:accountId/upgrade`, `POST /integrations/:accountId/disconnect`, `POST /integrations/:accountId/sync`, `PATCH /integrations/:accountId/data-sources`, `POST /integrations/device-calendar/snapshot` |
| Onboarding | `POST /onboarding/first-analysis`, `GET /onboarding/first-analysis/:jobId` |
| Mail | `GET /mail/:messageId/original`, `POST /mail/:messageId/reply-drafts`, `POST /reply-drafts/:id/regenerate`, `PATCH /reply-drafts/:id`, `POST /reply-drafts/:id/submit`, `POST /followups/:threadId/draft` |
| Approvals | `POST /approvals`, `PATCH /approvals/:id`, `POST /approvals/:id/approve`, `POST /approvals/:id/reject` |
| Reminders | `POST /reminders/resolve-time`, `POST /reminders`, `POST /reminders/:id/cancel` |
| Plan | `GET /plan/free-slots`, `POST /plan/proposals`, `POST /plan/conflicts/:insightId/options`, `POST /plan/conflicts/:insightId/resolve` |
| Meetings | `POST /meetings/:eventId/prep`, `POST /meetings/:eventId/notes`, `POST /meetings/:eventId/post` |
| Assistant | `POST /assistant/threads`, `POST /assistant/threads/:id/messages` (SSE), `POST /assistant/transcribe` |
| Search | `GET /search?q=&types=` |
| Capture | `POST /captures/upload-url`, `POST /captures`, `POST /captures/:id/analyze`, `POST /captures/:id/actions` |
| Briefings | `POST /briefings/:id/audio`, `POST /briefings/:id/evening-ready`, `GET /weekly/:id/share-card` |
| Business | `POST /referrals/apply`, `GET /referrals/me`, `POST /purchases/sync` |
| Privacy | `POST /privacy/export`, `POST /privacy/delete-history`, `POST /privacy/delete-account` |
| Support | `POST /support/tickets`, `POST /feedback` |
| Android NI | `POST /android-notifications/signals` (Pro) |
| Analytics | `POST /analytics/events` |

Simple owner-scoped writes go straight to PostgREST: the `set_insight_status` RPC, `ai_feedback` inserts, CRUD on `priority_rules`, `vip_people` and `learned_preferences`, and preference updates.

**Accepted additions** (spine §23b R-07, R-18 and R-24; names and shapes in `API_CONTRACTS.md`, which is authoritative per R-20):
- `api` routes: `POST /integrations/oauth/complete` (R-07), `POST /approvals/:id/device-execution` (API-APR-05), `POST /captures/:id/discard` (API-CAP-05), `POST /briefings/:id/retry` (API-BRF-04), `POST /notifications/test` (API-DEV-04), `GET /widgets/snapshot` (API-WDG-01), `POST /mail/threads/:threadId/summary`, `POST /meetings/:eventId/prep/audio`, `POST /reply-drafts/:id/attachments/upload-url` and `POST /privacy/export/:id/download`.
- PostgREST RPCs: `today_overview`, `flow_feed` (its response carries `meta`), `mail_intelligence`, `plan_range`, `plan_week_density`, `person_intelligence`, `vip_suggestions`, `get_explanation`, `submit_ai_correction`, `apply_insight_feedback`, `revert_insight_feedback`, `set_commitment_status`, `mark_briefing_opened`, `list_approvals`, `preview_priority_rule`, `get_usage_summary`, `dismiss_announcement`, `history_deletion_preview`, `upsert_manual_contact`, `search_user_content` and `effective_entitlement`.
- Supabase Realtime is not used (R-19). Freshness comes from TanStack Query invalidation and polling, plus push for background changes.

### A6. Database + RLS (full spec in `DATABASE_AND_RLS_PLAN.md`)

- **Migrations** are forward-only files named `supabase/migrations/<UTC timestamp>_<name>.sql`, in this order:
  - 0001 extensions + schemas + enums
  - 0002 identity/settings
  - 0003 integrations
  - 0004 content
  - 0005 intelligence
  - 0006 approvals
  - 0007 assistant/memory
  - 0008 notifications
  - 0009 business
  - 0010 ops/product
  - 0011 privacy
  - 0012 admin + audit
  - 0013 functions/RPCs
  - 0014 RLS + grants
  - 0015 cron
  - 0016 storage

  The SQL stays PG16-compatible and pgvector stays within the 0.6 feature set: `vector(1024)` and HNSW `vector_cosine_ops`.
- **RLS on every user-data table:**
  - `enable` + `force row level security`;
  - policies of the form `to authenticated using ((select auth.uid()) = user_id) with check (…)`;
  - column-level `GRANT update(col…)` for user-editable columns only;
  - every table carries `user_id`.
- **System tables** have RLS on and no `anon` or `authenticated` policies: `jobs`, `oauth_credentials`, `oauth_states`, `webhook_events`, `billing_events`, `ai_requests`, `audit_logs`, `admin_*`, `support_*`, `system_health_checks` and `rate_limits`.
- Every `admin_api` path is restricted to `aal2`.
- **Storage buckets** `captures`, `exports` and `briefing-audio` are private, with `(storage.foldername(name))[1] = auth.uid()::text` policies and signed URLs valid 60–300 s.
- **Security-definer functions** live in `private`, set `search_path = ''`, use fully qualified names and `revoke execute from public`.
- **pgTAP tests cover:**
  - owner CRUD; zero rows for another user; foreign `user_id` rejected; anon denied;
  - system tables invisible;
  - admin functions rejecting `aal1` and non-admins;
  - audit immutability; legal and illegal approval transitions; idempotency uniques;
  - a generic "every public table has RLS forced" assertion.

### A7. OAuth and integrations (detail in `INTEGRATION_PLAN.md`)

| Provider | Login | Initial integration scopes | Progressive scopes | Sync | Push / watch | Revoke |
|---|---|---|---|---|---|---|
| Google | native id_token (openid email profile) | `gmail.readonly` (restricted → CASA); Calendar `calendar.events.readonly calendar.calendarlist.readonly calendar.settings.readonly`; `tasks.readonly` | `gmail.send`, `calendar.events.owned` (→ `calendar.events`), `tasks` | history.list / syncToken / Tasks poll every 15 min | Gmail `watch` → Pub/Sub (OIDC push); Calendar `events.watch` channels | `POST oauth2.googleapis.com/revoke` |
| Microsoft | Supabase `azure` + PKCE | `openid profile email offline_access User.Read Mail.Read`, `Calendars.Read`, `Tasks.Read` | `Mail.Send` (reply via `POST /messages/{id}/reply`, never `createReply`), `Calendars.ReadWrite`, `Tasks.ReadWrite` | Per-folder message delta (inbox, sentitems); `calendarView/delta` rolling window re-baselined daily; To Do delta poll | Subscriptions of at most 7 days, renewed at <48 h; lifecycle events | No per-app revoke → documented user link plus local purge |
| Apple | native SIWA (+ web OAuth on Android) | EventKit full access (events + reminders) | — | device snapshot upload | EKEventStoreChanged / foreground / background task | local; SIWA revoke at account deletion |
| Android | — | CalendarContract `READ_CALENDAR` | `WRITE_CALENDAR` at write time | device snapshot | foreground / background task | local |

**Operational rules**
- **Microsoft client** uses a certificate credential and `Prefer: IdType="ImmutableId"`.
- **Gmail sync:**
  - initial sync covers 72 h for First Analysis, then backfills to the retention window;
  - metadata comes first, and full bodies are fetched only for triage survivors, transiently;
  - a history 404 triggers a bounded resync;
  - the watch is renewed daily;
  - each user has a quota token bucket (6,000 units/min limit for a new project).
- **Calendar:** HTTP 410 triggers a full resync; channels are renewed 24 h before expiry.
- **Graph:** at most 4 concurrent requests per mailbox; 429 responses honour `Retry-After`.
- **Tasks and To Do:** polled every 15 min and on foreground.
- **Device calendars:** full access is requested only on "Bağla"; provenance shows the time of the last device sync.
- **Disconnect:** stop watches → provider revoke → delete ciphertext → purge → audit.

**Provider-side idempotency for approved writes**
- **Gmail:** sets `Message-ID: <approval-{id}@mail.dijitalasistan.app>` and checks `rfc822msgid:` before any retry.
- **Google Calendar:** a deterministic `id` (base32hex of the approval id), so a duplicate insert returns 409, which means already done.
- **Graph events:** `transactionId` = the approval id.
- **Graph mail:** a `singleValueExtendedProperty` tag, and a Sent Items check before retry.
- **Tasks and To Do:** store the provider id, and search for a notes / `linkedResources` marker before retry.
- **Every created event** carries `extendedProperties.private.da_approval_id` or the equivalent Graph extended property.

Provider errors map to `account_status` and to the design-08 copy ("Gmail bağlantısı yenilenmeli." / "Yeniden Bağlan").

### A8. AI architecture (detail in `AI_PIPELINE_PLAN.md`)

**Pipeline:** ingestion → normalization → deterministic filters and rules (priority rules, VIP, List-Unsubscribe / Precedence / Auto-Submitted, DKIM/SPF, sender reputation, content-hash dedupe) → batched small-model classification → large model only for survivors → zod validation → grounding verification (the quote must exist in the source; dates and amounts are re-parsed deterministically) → persistence with provenance → insight / briefing / notification.

**Provider abstraction and configuration**
- The abstraction lives in `supabase/functions/_shared/ai/`: `LLMProvider.generateStructured`, `embed`, `transcribe`, `synthesize`.
- Adapters: `anthropic`, `openai`, and `fixture` (demo and tests only).
- The model for each feature comes from `ai_model_config` (backoffice-editable, audited). Prompts come from `prompt_versions`.
- Every call writes an `ai_requests` row with no content.

**Tiers**

| Tier | Model | Used for |
|---|---|---|
| T0 | deterministic code | pre-filter, rules and VIP, follow-up state machine, midday and evening lists, security events, JSON-LD and Turkish sender-template parsers, slot finder, TR date/amount/tracking/flight/PNR extractors, intent grammar |
| T1 | `claude-haiku-4-5-20251001` | triage: 6-way category + needs_reply / expects_reply + evidence, at most 5 emails per request; commitments; life-intel fallback; post-meeting; capture text and links; assistant intent |
| T2 | `claude-sonnet-5` | morning briefing from ranked JSON; thread summaries; deep extraction; meeting prep (T−60 for external or VIP meetings, else on tap); weekly review via Message Batches; reply drafts (all 4 tones in one call); capture photo and PDF; grounded QA with `search_result` citations |
| T3 | `claude-opus-5-5` | escalation behind `ai.model.opus_escalation` (<2% of calls) |

- **Fable 5.1 is excluded**, because its 30-day retention conflicts with the privacy copy.
- **Fallback chains:**
  - T1 → Sonnet 5 (low effort) → `gpt-5.6-luna` → T0;
  - T2 → Haiku → `gpt-5.6-terra` → T0 template;
  - if AI is fully down, the last analysis is shown.
- **Adapter request rules** are keyed by per-model capability flags stored in config (the `ai_model_config` targets and `ai_model_prices`), never by model-ID literals in adapter code:
  - no sampling parameters and no prefill on Sonnet 5 or Opus 5.5;
  - no `effort` parameter on Haiku;
  - the Haiku cache prefix must be at least 4,096 tokens.
- **Haiku retirement.** Haiku 4.5 retires "not sooner than 2026-10-15". Model IDs are config only, so replacing it is a backoffice change.

**Embeddings and voice**
- Embeddings use Voyage `voyage-4` for documents and `voyage-4-lite` for queries, in 1024 dimensions.
- There is no hot fallback: the job is retried, and search degrades to FTS only.
- Disaster recovery re-embeds with OpenAI `text-embedding-3-small` at `dimensions:1024`.
- A Turkish retrieval eval set is required.
- **Voice:**
  - STT runs on-device with `expo-speech-recognition` (tr-TR). The server fallback is `gpt-transcribe` or Deepgram Nova-3.
  - TTS runs natively, including the synth-to-file module. Premium adapters (Azure tr-TR, `gpt-4o-mini-tts`, ElevenLabs) sit behind `voice.tts_premium`.
  - Audio is cached per briefing version.

**"Model locates, code computes"**
- Models return verbatim quotes and short refs such as `m1` and `e2`.
- Code resolves dates, amounts and IDs from those quotes.
- Recipients are never taken from model output.

**Cost control**
- The T0 pre-filter keeps 55–70% of mail away from the LLM.
- Per-user HMAC content-hash dedupe in `ai_result_cache`, thread incrementality, and token hygiene (at most 1,200 tokens per email).
- Explicit cache breakpoints, micro-batching and Message Batches.
- Per-plan budgets:
  - Free shows "AI analiz limiti 50/gün", with soft/hard caps of $0.02 / $0.03 per day.
  - Pro shows "Adil kullanım", never "Sınırsız", with soft $0.20/day and hard $0.60/day and $6/month.
- Kill switches (exactly the R-10 keys): `ai.global.enabled`, `ai.provider.{anthropic,openai,voyage}.enabled`, `ai.feature.<ai_feature>`, `ai.model.large.enabled`, `ai.model.opus_escalation`, `ai.batch.enabled`, `ai.backfill.enabled` and `ai.budget.org_daily_usd` (auto-trips).
- Costs are reconciled nightly by a `reconciliation` job with `payload.scope='ai_cost'`.
- **Routing profiles:** `balanced` (default, ≈$2.24/month for a typical Pro user) and `lean` (≈$1.02/month), switchable per plan. The trade-off is flagged to the owner.

**Grounding and safety**
- **Hallucination control:** a deadline, amount, event, person relation or commitment is kept only with a verified source span. Otherwise the field is dropped or shown as "Kaynakta kesinleşmiyor.". Low confidence leads to a confirmation instead of silent creation.
- **Prompt injection:**
  - external content is wrapped as delimited untrusted data;
  - extraction calls have **no tools**;
  - the assistant LLM gets only read-only retrieval (`search_result` blocks and read tools scoped to the user). Write intents are detected by `AssistantIntentV1` (T0 grammar, then T1), and the server builds the proposal through the `POST /approvals` code path (R-04);
  - any write intent becomes a proposal → zod → `approval_actions` → human approval → server execution;
  - validators reject instructions, URLs not present in the source, and cross-user references.
- **Retrieval:** `memory_chunks` holds derived facts only. The `search_user_content` RPC combines pgvector with FTS (`turkish` + `unaccent`) through reciprocal rank fusion (RRF), always filtered by `user_id` and `expires_at`. Answers either cite their sources or say "bilmiyorum".

### A9. Mobile screen map (per-screen spec in `SCREEN_AND_FLOW_MAP.md`)

The deep-link scheme is `dijitalasistan://`. Universal links use `https://<web-domain>/app/...`.

```
app/_layout.tsx                      providers, auth gate, deep-link + notification router, toast/sheet hosts
app/(onboarding)/welcome|noise|proactive|control            M-ON-01..04
app/(auth)/sign-in · email-otp                              M-ON-05
app/(onboarding)/connect-mail · connect-calendar           M-ON-06/07
app/(onboarding)/permissions · personalization · briefing-schedule · vip · analysis · ready · notifications · android-notifications
app/(tabs)/_layout.tsx               4 fixed tabs, one stack per tab: Bugün · Akış · Plan · Asistan
app/(tabs)/today/index · flow/index · plan/index · assistant/index
app/briefing/[id] · briefing/[id]/listen (modal) · weekly/[id] · weekly/[id]/share
app/mail/index · mail/[id] · mail/[id]/reply (modal) · waiting · followups · commitments · commitments/[id]
app/life/[id] (sheet) · event/[id] · meeting/[eventId]/prep · meeting/[eventId]/summary · meeting/[eventId]/post
app/plan/proposal/[id] (sheet) · plan/conflict/[id]
app/person/[id] · vip · search · memory · voice (fullScreenModal) · capture (modal) · capture/[id]
app/approvals/index · approvals/[id] · app/reminders/new (global sheet)
app/settings/index · profile · accounts · accounts/[id] · notifications · briefings · privacy · privacy/permissions ·
    privacy/data-sources · privacy/retention · privacy/history · privacy/export · privacy/delete-account ·
    personalization · priority-rules · priority-rules/[id] · appearance · language · subscription · referral ·
    android-notifications · help · feedback · about
app/paywall (modal) · app/+not-found
app/chat/[threadId]                  M-ASST-02 assistant thread (root stack, tabs hidden; threadId=new is an unsaved thread)
app/index · update-required · +native-intent · auth/callback · integrations/callback · mail/category/[category] · briefings/index
app/demo/setup                       DEMO_MODE builds only (demo scenario reset for Maestro and store screenshots)
```

Every screen implements these states: loading (skeleton), empty, error, offline (cached data plus a banner), retry, reconnect, partial data and permission edge cases. Every visible control performs a real action.

### A10. Backoffice screen map (spec in `BACKOFFICE_PLAN.md`)

- **App:** `admin.<domain>`, desktop-first. Light theme by default, with a dark toggle persisted in `admin_preferences`.
- **Sidebar** exactly as M§46. **Routes:**
  - `/login`, `/mfa`, `/dashboard`
  - `/users`, `/users/[id]/{overview,integrations,briefings,usage,subscription,referrals,support,audit}`
  - `/support[/id]`, `/integrations`, `/jobs[/id]`, `/briefings`, `/notifications`
  - `/ai`, `/ai/models`, `/ai/prompts[/key]`, `/ai/feedback`
  - `/subscriptions`, `/referrals`, `/feedback`, `/flags`, `/announcements`, `/data-requests`, `/audit`, `/health`, `/admins`, `/settings`
- **Cmd/Ctrl+K palette:** searches IDs and masked emails. Destructive commands open a confirmation flow.
- **Tables:** server-side pagination, sorting, filtering, column visibility, and loading / empty / error / retry states.
- **Sensitive mutations** require a permission, a reason, a confirmation and an audit entry.
- **PII** is masked (`yu***@gmail.com`). Reveal is permission-gated and audited. Support Access grants carry a reason and a limited duration, and every reveal is logged. There is no impersonation.

**RBAC matrix.** It is enforced server-side in `admin-api` and again in `admin_api` SQL.

| Role | Access |
|---|---|
| `super_admin` | everything |
| `operations` | users (non-financial), integrations, job retry, briefings, notifications, flags, announcements, health |
| `support` | users (masked), tickets, support-access requests, data requests (view and retry), force sync |
| `finance` | subscriptions, entitlement grants, referrals, revenue metrics |
| `ai_ops` | AI operations, model config, prompts, AI feedback, AI flags |
| `analyst` | read-only aggregates |
| `readonly` | read-only masked views |

A DB trigger makes it impossible to disable or demote the last `super_admin`. Permission strings are the BACKOFFICE_PLAN §4.1 catalogue (R-20): `packages/domain/src/rbac.ts` is the source, and the `private.admin_role_permissions` table mirrors it. Support Access is available only to roles holding `support.access` (`support`, `super_admin`; R-09).

### A11. Public web map

**Home page `/` sections**
- Hero: "Bugün bilmen gerekenleri, sen sormadan söyler." with the supporting line "Dijital Asistan mailini, takvimini ve açık işlerini anlayıp her gün sana kısa bir brifing hazırlar."
- Integrations, How it works, Morning Briefing, Mail Intelligence, Meeting Prep, Smart Planning, AI Memory, Security, Pricing, FAQ.
- CTA: store badges, or a QR code on desktop.

**Other routes**

| Route | Content |
|---|---|
| `/pricing` | "mağaza fiyatı" ranges; no fake trial claims |
| `/privacy` | Includes the Google Limited Use statement, the AI sub-processors and the no-training statement |
| `/terms` | Terms of service |
| `/support` | Shared FAQ and a contact form (`public-api` → `support_tickets`) |
| `/data-deletion` | Email-OTP deletion request → `data_deletion_requests` |
| `/r/[code]` | Referral landing |
| `/oauth/done` | Universal-link fallback |
| `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json` | App and universal link verification |
| `/app/[[...path]]` | Universal-link fallback page with store badges |
| `/get` | Store redirector: iOS → App Store, Android → Play, desktop → `/#download` |
| `/.well-known/security.txt` | Security contact |
| `/.well-known/microsoft-identity-association.json` | Microsoft Entra publisher-domain verification |
| `sitemap.xml`, `robots.txt`, OG images | SEO |

- Turkish is the default locale; English lives under `/en`.
- Pages are built with SSG/ISR.
- Targets: Lighthouse ≥90, keyboard navigation, reduced motion.

### A12. Security model (→ `SECURITY_AND_PRIVACY_PLAN.md`, `SECURITY.md`)

**Threat model.** It covers token theft, session theft, account takeover, OAuth misconfiguration, webhook forgery, privilege escalation, SSRF, malicious uploads, prompt injection, AI data exfiltration, cross-tenant access, admin abuse, replayed writes, notification leakage and referral abuse. Each has mitigations and a stated residual risk.

**Controls**
- Encrypted tokens never leave the Edge Functions.
- OAuth uses PKCE and single-use state.
- Webhooks are authenticated (OIDC JWT, HMAC channel token, hashed clientState, RevenueCat secret) and deduplicated against replay (`webhook_events`).
- RLS is forced everywhere and covered by pgTAP.
- Admin access requires `aal2`, RBAC is enforced in two layers, and the audit log is hash-chained.
- **SSRF-safe fetcher:**
  - https only;
  - DNS resolution on every hop, blocking private, loopback, link-local and metadata ranges;
  - at most 3 redirects, 5 MB, 10 s;
  - content-type allow-list; no cookies.
- **Uploads:**
  - checks on size, MIME type, extension and magic bytes;
  - a private per-user bucket; no execution;
  - parsing on an isolated worker path with timeouts;
  - cleanup through retention.
- **Push payloads** contain only `{type, entity_id, deeplink}` plus server-rendered text for the detail mode.
- **Secrets** live only in Edge or CI secrets. The env schema splits server and client values, and CI greps bundles for secrets.

### A13. Privacy model

**Privacy Center areas:** Connected Accounts, Permissions (scopes and OS permissions), AI Accessible Data with per-account Data Source Controls (enforced server-side), Retention, Delete History, Export Data, Delete Account and AI Personalization.

**Copy states only what is true:**
- "Veriler aktarım sırasında ve saklanırken şifrelenir."
- "Önemli işlemler sen onaylamadan gerçekleştirilmez."
- "Verilerin reklam amacıyla satılmaz."
- Mail content is never used to train models.
- "Mail içeriğinin tamamı saklanmaz; yalnızca özetler, kısa alıntılar ve analiz sonuçları saklama süren boyunca tutulur." (R-15)
- There is no "uçtan uca şifreleme" claim.

**Export:** an async job builds a zip (JSON per entity, no tokens) in a private bucket. The archive stays available for 24 h; each download goes through `POST /privacy/export/:id/download`, which mints a signed URL valid 300 s. The user sees a status screen, and the export is audited.

**History and account deletion**
1. Explicit confirmation, a list of consequences, and re-authentication.
2. A queued job.
3. Provider cleanup: watches stopped; Google and SIWA tokens revoked; Graph cleanup is local-only and documented.
4. Purge of DB rows, storage, embeddings and tokens.
5. RevenueCat customer deletion and local cache wipe.
6. Audit, with subject identifiers hashed after completion.

The status shown is always honest; the UI never shows a fake "deleted".

### A14. Notification and jobs architecture

**Decision engine** (`packages/domain/notifications`): relevance → urgency → category preference → quiet hours (user timezone) → dedupe key → frequency cap (rolling 24 h per category and globally) → lock-screen sensitivity / detail mode → send, schedule or suppress. The reason is always recorded.

- **Quiet hours (R-13):** on by default, 22:30–07:30 in the user's timezone. They suppress everything except (a) user-created smart reminders at the time the user chose and (b) VIP `critical_email` when `notification_preferences.vip_bypass_quiet` is on (default on; per-VIP override `vip_people.bypass_quiet_hours`). Those are still deduped and capped at 3 per quiet window. Admin test pushes never bypass quiet hours and carry generic content.
- **Frequency cap (R-14):** `notification_preferences.daily_cap` defaults to 5 non-critical pushes per day. The settings copy is "Sadece önemli olduğunda haber veririz."; "Günde ortalama 3 bildirim" is not used.
- **Android channels (R-12):** `briefings`, `critical_email`, `meetings`, `deadlines`, `follow_up`, `life_intel`, `approvals`, `reminders`, `account` and `phone_digest` (Android NI only). Every channel uses `lockscreenVisibility = PRIVATE`, and all are created at first launch, before the permission prompt.
- **Weekly review push:** category `evening` on channel `briefings`; `notification_category` has no `weekly` value.

**Scheduled work**
- Morning, midday (only on a meaningful delta, otherwise `skipped`), evening and weekly (Sunday 18:00 local) briefings.
- Meeting reminders at T−30…T−15 and a post-meeting prompt at end + 1 min.
- Deadline and follow-up nudges; approval expiry.
- Retention, reconciliation, watch renewal, push receipts and health checks.

Every job is idempotent with a deterministic key (for example `briefing:{user}:{kind}:{local_date}`), timeout-bounded, retryable, dead-letterable and DST-safe (evaluated with `AT TIME ZONE`).

### A15. Subscription architecture

| Plan | Features |
|---|---|
| Free | 1 mail account, 1 calendar, Morning Briefing, basic important mail, limited AI, basic Today |
| Pro | multiple accounts and calendars, Midday, Evening, Meeting Prep, Follow-Up, Commitments, Voice Briefing, AI Memory, VIP, advanced planning, Universal Capture, Android NI |

- `effective_entitlement(user)` = an active store subscription (RevenueCat mirror) **or** active `entitlement_grants` (stacked, non-overlapping).
- Every Pro capability is enforced server-side in `api` and `worker`. The client also gates for UX, including the contextual Pro gate from design 7.6.
- **The paywall:**
  - loads offerings from RevenueCat and shows the localized `priceString`;
  - computes the annual savings;
  - shows trial copy only when the user is eligible;
  - offers Restore, Manage, Terms, Privacy and a close button.
- Development and demo builds use the RevenueCat Test Store key.

### A16. Referral architecture

1. **Code and invite.** Each user has one short code in an unambiguous alphabet (`referral_codes`), shared as a `/r/{code}` link through the native share sheet.
2. **Application.** The code is applied at sign-up and creates a `referrals` row in `pending`.
3. **Qualification.** The referee must finish onboarding, connect at least one account, receive a first briefing, and have an account at least 48 h old.
4. **Anti-abuse checks:**
   - self-referral detected by user id, email, Apple relay or installation hash;
   - duplicate-account heuristics on hashed signals;
   - loop detection (A→B→A);
   - a cap of 6 per year and velocity limits;
   - a risk score that sends the referral to `flagged`.
5. **Reward.** `referral_credits` are written idempotently on `(referral_id, side)`, and each side gets `entitlement_grants` of +14 days of Pro, stacked. Both sides are notified.
6. **Admin view:** metrics, flags, and manual approve or reject with a reason and an audit entry.

### A17. Test architecture (→ `TEST_PLAN.md`)

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest | priority engine, classification normalization, TR date and amount parsing, timezone and DST, commitment detection, reminder rules and slot finder, referral anti-abuse, entitlements, grounding verifier, notification engine, RBAC matrix, SSRF guard, env schema |
| Mobile | jest-expo + RNTL | UI kit, theme, accessibility props, screen states |
| Database | pgTAP | RLS isolation, grants, state machines, idempotency, audit immutability, retention |
| Edge | `deno test` | OAuth (mocked providers), webhooks (signature and replay), sync adapters (recorded fixtures), AI adapters (fixture provider + schemas), approval idempotency, RevenueCat, notifications |
| Web E2E | Playwright | landing, pricing, CTA, legal pages, responsive, keyboard, SEO |
| Backoffice E2E | Playwright | login + MFA, dashboard, user search and detail, integrations, job retry, briefing ops, AI cost, prompt activation, flags, support, audit, data request, entitlement grant, logout |
| Mobile E2E | Maestro | every M§102 item plus secondary flows A–J, run in CI on e2e/preview builds in demo mode |

### A18. CI/CD

**GitHub Actions pipeline:** install → lint → typecheck → unit → db (`supabase start` → `db reset` → `test db` → `db lint`) → functions (deno check / lint / test) → integration → web build → backoffice build → migration validation (squawk, reset from zero) → E2E web and backoffice → mobile checks (`expo install --check`, expo-doctor, `expo export`, prebuild smoke) → secret and bundle scan → quality gate.

**Deployment targets**
- EAS profiles `development`, `preview`, `e2e` and `production`; Maestro runs on EAS Workflows.
- Two Vercel projects: web and backoffice.
- The Supabase deploy job (migrations, `functions deploy --use-api`, secrets check) runs on a protected environment with manual approval.

### A19. External credentials (full matrix in `INTEGRATION_PLAN.md` §14, key names in `.env.example`)

| Provider | Credential | Why | Env | Used by | Local demo? | Production? |
|---|---|---|---|---|---|---|
| Supabase | project URL, publishable key, secret key, DB URL, JWT settings | backend | all | api-client, functions, CI | No (local stack or shim) | Yes |
| Google Cloud | Web, iOS and Android OAuth clients; Pub/Sub topic and push service account; consent screen and **CASA** | Gmail/Calendar/Tasks, login | functions, mobile | oauth, sync, login | No (demo adapter) | Yes |
| Microsoft Entra | client ID, certificate (key + thumbprint), tenant `common` | Outlook/Calendar/To Do, login | functions, Auth | oauth, sync | No | Yes |
| Apple | Team ID, SIWA key (.p8) + key ID, Services ID, App Group, APNs key (via EAS) | login, revocation, push, widgets | functions, EAS | auth, deletion | No | Yes |
| Anthropic | API key | LLM | functions | ai | No (fixture) | Yes |
| OpenAI | API key | fallback LLM, DR embeddings, STT/TTS | functions | ai | No | Recommended |
| Voyage AI | API key | embeddings | functions | memory, search | No (FTS-only) | Yes |
| Premium TTS/STT | API key | voice | functions | voice | No (native) | Optional |
| RevenueCat | iOS and Android SDK keys, v2 secret, webhook secret, Test Store key | subscriptions | mobile, functions | paywall, billing | No (Test Store) | Yes |
| Expo / EAS | project ID, access token, FCM v1 service account, APNs key | builds, push | CI, functions | push, builds | No | Yes |
| Sentry | DSNs, CI auth token | errors | all apps | observability | No | Recommended |
| SMTP / email API | SMTP credentials for Auth, plus an HTTPS email API key | email OTP, tickets | Auth, functions | auth, support | No (local mail catcher) | Yes |
| Encryption | `TOKEN_ENC_KEY_V1…`, `TOKEN_ENC_ACTIVE_VERSION`, `WEBHOOK_HMAC_SECRET`, `CRON_SECRET` | token encryption, channel tokens | functions | oauth, webhooks | generated locally | Yes |
| Domains | web, `admin.`, API custom domain, mail domain (SPF/DKIM/DMARC) | brand verification, links | DNS | all | No | Yes |

A missing credential never blocks development.

### A20. Known platform limitations (→ `KNOWN_PLATFORM_LIMITATIONS.md`)

- **iOS:**
  - has no system notification stream, so Android NI is hidden on iOS;
  - BGTaskScheduler timing is not guaranteed;
  - WidgetKit allows roughly 40–70 refreshes per day;
  - a share extension gets about 120 MB of memory.
- **Device calendars** (Apple and Android) sync only while the app runs, so provenance shows the time of the last device sync.
- **Google:**
  - Tasks supports date-only due values and has no push, so it is polled every 15 min;
  - the Gmail restricted scope needs an annual CASA assessment and is capped at 100 users before verification.
- **Microsoft** has no per-app revoke.
- **Android:** restricted settings apply to sideloaded NI on 13+, and OTP content is redacted on 15.
- **Hermes** lacks `Intl.RelativeTimeFormat`.
- **Product-level limits:**
  - RTL is not supported;
  - travel time appears only when the source provides it;
  - premium TTS is optional;
  - trials exist only where the store has one configured.

### A21. Execution order (technical dependency only; everything ships)

| Step | Content | Tasks |
|---|---|---|
| 0 | Materialize the plan docs, extract the design, scaffold the monorepo, `.env.example`, CI skeleton, quality gate | T-0.01…T-0.07 |
| 1 | Config, tokens, icons, i18n, domain engines, validation, API client | T-1.01…T-1.17 |
| 2 | Supabase config, shim, migrations 0001–0016, pgTAP, demo seed, types | T-2.01…T-2.26 |
| 3 | Edge shared libraries, worker, health, AI abstraction, `api` core | T-3.01…T-3.11 |
| 4 | OAuth, Google/Microsoft/demo/device adapters, sync, webhooks, revoke | T-4.01…T-4.13 |
| 5 | AI pipeline: triage → … → capture → planning | T-5.01…T-5.17 |
| 6 | Approvals execution, reminders, notifications | T-6.01…T-6.08 |
| 7 | Subscriptions and referrals | T-7.01…T-7.03 |
| 8 | Mobile, from the UI kit through accessibility | T-8.01…T-8.31 |
| 9 | Marketing web | T-9.01…T-9.08 |
| 10 | Backoffice | T-10.01…T-10.15 |
| 11 | Privacy and security hardening | T-11.01…T-11.06 |
| 12 | CI/CD, test completion, builds, E2E, fix loop, quality gate, docs, final report, PR | T-12.01…T-12.11 |

### A22. Definition of Done

**A feature is done only when all of the following hold:**
- Its whole chain is real and tested: UI → state → API → backend → DB → provider/AI → approval → side effect → confirmation → refreshed state.
- Every screen has loading, empty, error, offline, retry, reconnect and partial-data states.
- Every visible control performs a real action.
- Strings are in i18n (tr + en).
- Dark mode is verified and accessibility props are present.
- Content-free analytics events are emitted.
- RLS/pgTAP, unit and integration tests pass.
- The feature appears as ✅ in the `FINAL_IMPLEMENTATION_REPORT` feature matrix, with its external-credential dependency stated.

**Release gate:**
- lint and typecheck;
- every test tier;
- `next build` for both web apps;
- the mobile bundle and prebuild checks;
- Playwright E2E;
- the quality-gate greps come back clean: TODO/FIXME/placeholder/"coming soon"/"yakında", empty handlers, fake success, secrets in client bundles, missing RLS.

---

## Part B — Work Breakdown Structure

### B0. Conventions

**Task fields.** Each task lists:
- **Depends:** the task IDs it needs.
- **Files:** repository-relative paths to create or change.
- **Contents:** the decisions that bind the implementation.
- **Commands:** the commands to run.
- **Acceptance:** tests that must pass and observable behaviour.
- **Satisfies:** master-prompt sections (M§).

**Standard command sets** (tasks refer to them by name)

| Set | Commands |
|---|---|
| `C-TS <pkg>` | `pnpm turbo run lint typecheck test --filter=<pkg>` |
| `C-GEN` | `pnpm generate && git diff --exit-code` (generated files are committed and drift-checked) |
| `C-DB` | Container: `bash scripts/db/tier-c.sh`. CI: `bash scripts/db/tier-a.sh` |
| `C-FN` | `pnpm functions:imports && pnpm functions:check && pnpm functions:lint && pnpm functions:test` |
| `C-MOB` | `pnpm turbo run lint typecheck test --filter=@da/mobile --filter=@da/ui` |
| `C-MOB-SMOKE` | `EXPO_OFFLINE=1 pnpm --filter @da/mobile exec expo install --check`<br>`pnpm --filter @da/mobile exec expo export --platform ios,android --output-dir .expo-export`<br>`bash scripts/mobile/prebuild-smoke.sh` (runs `expo prebuild --clean --no-install` in a temp copy for every `APP_ENV`) |
| `C-WEB` / `C-BO` | `pnpm turbo run lint typecheck test build --filter=@da/web` (or `--filter=@da/backoffice`) |
| `C-E2E` | `pnpm e2e:web` and/or `pnpm e2e:backoffice` |
| `C-GATE` | `pnpm quality-gate` |

**Task DoD baseline.** It applies to every UI task, and each task's own Acceptance section adds to it:
- i18n keys exist in tr and en;
- dark mode is verified;
- accessibility props are present;
- all M§93 states are present;
- no dead action;
- the listed analytics events are emitted;
- tests are written.

**Import rules**
- Workspace packages are named `@da/*`.
- `packages/domain` and `packages/validation` import only `zod`, `date-fns` and `@date-fns/tz`, with relative `.ts` imports, so Deno 2.1 can import them unchanged.
- Services shared by `api` and `worker` live in `supabase/functions/_shared/services/<area>/`.

### Step 0 — Foundation

#### T-0.01 · Materialize the plan documents and the canonical registry
- **Depends:** —
- **Files:**
  - `docs/IMPLEMENTATION_PLAN.md`, `ARCHITECTURE_DECISIONS.md`, `DESIGN_AUDIT.md`, `SCREEN_AND_FLOW_MAP.md`, `DATABASE_AND_RLS_PLAN.md`, `INTEGRATION_PLAN.md`, `API_CONTRACTS.md`, `AI_PIPELINE_PLAN.md`, `BACKOFFICE_PLAN.md`, `SECURITY_AND_PRIVACY_PLAN.md`, `TEST_PLAN.md`, `DELIVERY_CHECKLIST.md`, `KNOWN_PLATFORM_LIMITATIONS.md`;
  - `docs/plan-audits/{design-system,design-hub,design-onboarding-today,design-flow-mail,design-plan-assistant,design-account-states-marketing,design-secondary-code,secondary-docs,stack-versions,integrations,ai-research}.md`;
  - `docs/CANONICAL_REGISTRY.md`.
- **Contents:**
  - Reconstruct each document with the master plan §24 step-0 procedure:
    - map journal labels to agent transcripts;
    - concatenate the assistant text after the last `tool_use`;
    - drop everything before the first `# `;
    - apply every `fix:<NAME>` patch set. A patch set is either the plain-text `# PATCHSET <NAME>` form (`@@@FIND@@@` / `@@@REPLACE@@@` / `
  - If the journals are gone (container recycled), regenerate each document section by section from the master plan before any code is written.
- **Commands:** `python3 <scratchpad>/materialise_docs.py --out docs/`, then `grep -rnE 'TODO|FIXME|coming soon|yakında' docs/` (must be empty apart from quality-gate policy text).
- **Acceptance:**
  - All 13 plan docs (DELIVERY_CHECKLIST.md from its draft, or generated as above) and the 11 audits exist, and each starts with `# `.
  - DELIVERY_CHECKLIST.md contains the requirement traceability table, the No-Dead-Action inventory, the M§135–M§137 acceptance checklists and the M§153 release checklist.
  - Every registry item has a disposition.
  - The drift grep for non-canonical table, enum and route names is clean. It covers the retired names in DELIVERY_CHECKLIST QG-27 and in `CANONICAL_REGISTRY.md`.
  - Commit: `docs: add implementation plan documents`.
- **Satisfies:** M§0.A, M§0.B(1), M§106, M§120, M§121(1), M§143, M§145–149.

#### T-0.02 · Extract the design references
- **Depends:** T-0.03 (the `.gitignore` must exist first)
- **Files:**
  - `design/README.md`;
  - `design/reference/{primary,secondary}/` (git-ignored);
  - `design/tokens/primary-tokens.json`, `design/icons/used-icons.txt`, `design/copy/primary-copy.tsv`, `design/marketing/frames.json`;
  - `scripts/design/{extract-tokens,extract-icons,extract-copy}.ts` and `scripts/design/__tests__/tokens.test.ts`.
- **Contents:**
  - Unzip both archives from `/root/.claude/uploads/46bfff87-…/`. If the upload directory is missing, re-supplying the ZIPs is a **Manual external step**.
  - `extract-tokens` parses the `COLORS`, `DARK` and `TYPE` arrays from `01 Tasarim Sistemi.dc.html`.
  - `extract-icons` collects every Material Symbols name used in the PRIMARY canvases.
  - `extract-copy` collects the Turkish UI strings per canvas and screen, which seed the i18n catalogs.
  - The README records the precedence rules (PRIMARY for visuals, master prompt for function) and the list of fakes never to copy.
- **Commands:**
  - `unzip -q <primary.zip> -d design/reference/primary`, and the same for the secondary archive;
  - `node scripts/design/extract-tokens.ts`, `node scripts/design/extract-icons.ts`, `node scripts/design/extract-copy.ts`;
  - `node --test scripts/design/__tests__/`.
- **Acceptance:**
  - The token JSON matches the A2 values.
  - `git check-ignore design/reference` succeeds.
  - The icon list is non-empty.
- **Satisfies:** M§4, M§121(2–4), M§122, M§124, M§144.

#### T-0.03 · Root workspace scaffold
- **Depends:** —
- **Files:** `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `.gitignore`, `.gitattributes`, `.editorconfig`, `prettier.config.mjs`, `.prettierignore`, `eslint.config.mjs`, `tsconfig.json` (for scripts only), `README.md` (bootstrap version).
- **Contents:**
  - `package.json`:
    - `name: "dijital-asistan"`, `private: true`, `packageManager: "pnpm@11.27.1"`, `engines.node: ">=22.13.0"`.
    - Scripts:

      | Group | Scripts |
      |---|---|
      | Dev | `dev:web`, `dev:backoffice`, `dev:mobile` |
      | Checks and build | `lint`, `typecheck`, `test`, `build`, `generate`, `format`, `format:check` |
      | Database | `db:start`, `db:reset`, `db:test` (tier A), `db:test:local` (tier C), `db:types`, `db:lint`, `db:seed:demo` |
      | Functions | `functions:imports`, `functions:check`, `functions:lint`, `functions:test` |
      | Mobile and E2E | `mobile:check`, `e2e:web`, `e2e:backoffice` |
      | Gates and ops | `quality-gate`, `scan:bundles`, `admin:bootstrap`, `ai:eval` |

      TypeScript scripts run with `node` (type stripping is on by default in Node ≥22.18 and in 24; scripts use erasable syntax only).
    - Root devDependencies: `turbo 2.11.3`, `prettier 3.9.9`, `eslint 9.39.5`, `typescript catalog:`, `@types/node 24.13.6`, `supabase 2.117.0`, `deno 2.1.4`, `squawk-cli 2.65.0`, `@supabase/postgres-meta 0.99.0`, `@da/config workspace:*`.
  - `pnpm-workspace.yaml`:
    ```yaml
    packages: ['apps/*', 'packages/*']
    catalog:
      react: 19.2.3
      react-dom: 19.2.3
      '@types/react': ~19.2.18
      '@types/react-dom': ~19.2.7
      typescript: ~6.0.3
      zod: 4.6.5
      date-fns: 4.4.0
      '@date-fns/tz': 1.5.0
      '@supabase/supabase-js': 2.117.1
      '@supabase/ssr': 0.12.7
      '@tanstack/react-query': 5.103.2
      zustand: 5.0.15
      react-hook-form: 7.88.0
      '@hookform/resolvers': 5.9.1
      next-intl: 4.14.6
      use-intl: 4.14.6
      next: 16.3.6
      eslint-config-next: 16.3.6
      babel-plugin-react-compiler: 1.0.0
      tailwindcss: 4.3.3
      '@tailwindcss/postcss': 4.3.3
      '@sentry/nextjs': 10.75.2
      '@t3-oss/env-nextjs': 0.13.11
      server-only: 0.0.1
      clsx: 2.1.1
      tailwind-merge: 3.7.0
      class-variance-authority: 0.7.1
      radix-ui: 1.6.7
      '@tanstack/react-table': 9.2.4
      '@tanstack/react-virtual': 3.14.13
      recharts: 3.10.1
      cmdk: 1.1.1
      sonner: 2.0.8
      next-themes: 0.4.6
      nuqs: 2.10.1
      react-day-picker: 10.0.1
      tw-animate-css: 1.4.0
      vitest: 4.1.11
      '@vitest/coverage-v8': 4.1.11
      vite: 8.3.0
      happy-dom: 20.14.5
      '@playwright/test': 1.63.0
      '@eslint/js': 9.39.5
      typescript-eslint: 8.70.1
      eslint-plugin-react-hooks: 7.1.1
      globals: 17.12.0
      prettier-plugin-tailwindcss: 0.8.1
    catalogs:
      expo:
        expo: ~57.0.24
        react-native: 0.86.3
        expo-router: ~57.0.22
        react-native-reanimated: 4.5.1
        react-native-worklets: 0.10.1
        react-native-gesture-handler: ~2.32.0
        react-native-screens: ~4.26.0
        react-native-safe-area-context: ~5.7.0
        react-native-svg: 15.15.4
        react-native-keyboard-controller: 1.21.9
        '@shopify/flash-list': 2.0.2
        '@react-native-community/netinfo': 12.0.1
        expo-notifications: ~57.0.20
        expo-calendar: ~57.0.4
        expo-secure-store: ~57.0.4
        expo-audio: ~57.0.5
        expo-speech: ~57.0.3
        expo-image-picker: ~57.0.19
        expo-document-picker: ~57.0.2
        expo-file-system: ~57.0.7
        expo-sharing: ~57.0.21
        expo-dev-client: ~57.0.19
        expo-updates: ~57.0.23
        expo-background-task: ~57.0.19
        expo-task-manager: ~57.0.19
        expo-apple-authentication: ~57.0.2
        expo-web-browser: ~57.0.3
        expo-linking: ~57.0.10
        expo-localization: ~57.0.2
        expo-crypto: ~57.0.3
        expo-local-authentication: ~57.0.3
        expo-haptics: ~57.0.3
        expo-image: ~57.0.5
        expo-font: ~57.0.4
        expo-splash-screen: ~57.0.9
        expo-system-ui: ~57.0.4
        expo-status-bar: ~57.0.1
        expo-constants: ~57.0.19
        expo-device: ~57.0.2
        expo-application: ~57.0.3
        expo-build-properties: ~57.0.21
        react-native-mmkv: 4.3.2
        react-native-nitro-modules: 0.37.1
        react-native-purchases: 10.10.1
        '@sentry/react-native': 8.27.0
        '@react-native-google-signin/google-signin': 16.1.5
        expo-share-intent: 8.0.1
        '@bacons/apple-targets': 5.0.0
        expo-speech-recognition: 57.1.0
        '@expo-google-fonts/geist': 0.4.2
        '@expo-google-fonts/lora': 0.4.2
        '@material-symbols/svg-400': 0.47.5
        '@tanstack/react-query-persist-client': 5.103.2
        '@tanstack/query-async-storage-persister': 5.103.2
        jest-expo: ~57.0.5
        jest: 29.7.0
        '@testing-library/react-native': 14.0.1
        test-renderer: 1.3.0
        '@react-native/jest-preset': 0.86.3
    overrides:
      react: 19.2.3
      react-dom: 19.2.3
      react-native: 0.86.3
    allowBuilds:
      esbuild: true
      unrs-resolver: true
      deno: true
      '@sentry/cli': true
      core-js: false
      msw: false
    minimumReleaseAge: 1440
    ```
  - The Expo-bundled additions `expo-clipboard`, `@react-native-community/datetimepicker`, `expo-image-manipulator`, `expo-store-review`, `expo-screen-capture` and `react-native-view-shot` are added to `catalogs.expo` with the exact version from `expo@57.0.24/bundledNativeModules.json` at install.
  - `nodeLinker` stays at the default `isolated`; the documented fallback is `hoisted`.
  - `turbo.json` tasks:

    | Task | Settings |
    |---|---|
    | `generate` | outputs `src/generated/**`, `generated/**` |
    | `lint`, `typecheck`, `test` | depend on `^generate`; `test` outputs `coverage/**` |
    | `build` | outputs `.next/**`, `!.next/cache/**`; env `NEXT_PUBLIC_*`, `SENTRY_*` |
    | `dev` | `persistent`, `cache: false` |
    | `mobile:check`, `db:test`, `functions:test` | `cache: false` |
    | `e2e:web`, `e2e:backoffice` | depend on `build`, `cache: false` |

    `globalDependencies`: `.nvmrc`, `pnpm-workspace.yaml`.
  - `.nvmrc` = `24`.
  - `.gitignore` covers:
    - `node_modules`, `.turbo`, `.next`, `dist`, `coverage`, `.expo`, `.expo-export`;
    - `apps/mobile/ios`, `apps/mobile/android` (continuous native generation);
    - `.env`, `.env.*` except `!.env.example`, `*.p8`, `*.pem`, `*.p12`, `*.jks`, `*.keystore`, `google-services.json`, `GoogleService-Info.plist`;
    - `design/reference/`, `supabase/.temp`, `supabase/.branches`;
    - `playwright-report`, `test-results`, `*.apk`, `*.aab`, `*.ipa`, `.cache/`.
- **Commands:**
  - `corepack enable && corepack prepare pnpm@11.27.1 --activate`;
  - `pnpm install`;
  - `pnpm why --depth=10 react react-native`.
  - If `minimumReleaseAge` blocks a pin, use the documented fallback (next 16.3.5, turbo 2.11.2, supabase-js 2.117.0).
- **Acceptance:**
  - `pnpm install --frozen-lockfile` passes on Node 22.22.2 and on Node 24.
  - Exactly one react@19.2.3 and one react-native@0.86.3 are installed.
- **Satisfies:** M§5, M§6, M§7, M§121(5).

#### T-0.04 · Environment templates
- **Depends:** T-0.03
- **Files:** `.env.example`, `scripts/dev/env.sh`
- **Contents:**
  - `.env.example` holds key **names only**. Each key is marked `# client-safe`, `# SERVER-ONLY` or `# build-time`, and keys are grouped per M§107.
  - The key names follow `INTEGRATION_PLAN.md` §15:

    | Group | Keys |
    |---|---|
    | Supabase | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_AUTH_SMTP_*`, `SUPABASE_AUTH_EXTERNAL_{GOOGLE,AZURE,APPLE}_*` |
    | Google | `GOOGLE_CLOUD_PROJECT_ID`, `GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI`, `GOOGLE_PUBSUB_TOPIC`, `GOOGLE_PUBSUB_PUSH_AUDIENCE`, `GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT`, `GOOGLE_CALENDAR_WEBHOOK_URL`, `GOOGLE_CASA_LOA_NOT_AFTER`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `GOOGLE_IOS_URL_SCHEME` |
    | Microsoft | `MICROSOFT_CLIENT_ID`, `MICROSOFT_AUTHORITY_TENANT`, `MICROSOFT_CERT_PRIVATE_KEY`, `MICROSOFT_CERT_THUMBPRINT_S256`, `MICROSOFT_CERT_NOT_AFTER`, `MICROSOFT_LOGIN_SECRET_NOT_AFTER`, `MICROSOFT_OAUTH_REDIRECT_URI`, `MICROSOFT_GRAPH_NOTIFICATION_URL`, `MICROSOFT_GRAPH_LIFECYCLE_URL` |
    | Apple | `APPLE_TEAM_ID`, `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_PRIVATE_KEY`, `APPLE_SIWA_NATIVE_CLIENT_ID`, `APPLE_SIWA_SERVICES_ID`, `APPLE_SIWA_WEB_SECRET_NOT_AFTER` |
    | AI | `ANTHROPIC_API_KEY`, `ANTHROPIC_ADMIN_API_KEY`, `OPENAI_API_KEY`, `OPENAI_ADMIN_API_KEY`, `AI_FIXTURE_PROVIDER_ENABLED`, `AI_HASH_PEPPER` |
    | Embeddings, STT, TTS | `VOYAGE_API_KEY`, `STT_SERVER_PROVIDER`, `STT_API_KEY`, `TTS_PREMIUM_PROVIDER`, `TTS_API_KEY` |
    | RevenueCat | `EXPO_PUBLIC_REVENUECAT_{APPLE,GOOGLE,TEST_STORE}_API_KEY`, `REVENUECAT_PROJECT_ID`, `REVENUECAT_API_V2_SECRET_KEY`, `REVENUECAT_ENTITLEMENT_PRO_ID`, `REVENUECAT_API_V1_SECRET_KEY`, `REVENUECAT_WEBHOOK_AUTH` |
    | Sentry | `EXPO_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` |
    | Analytics | `EXPO_PUBLIC_ANALYTICS_ENABLED`, `NEXT_PUBLIC_ANALYTICS_ENABLED`, `ANALYTICS_EXTERNAL_ADAPTER`, `ANALYTICS_EXTERNAL_WRITE_KEY` |
    | Push | `EXPO_PUBLIC_EAS_PROJECT_ID`, `EXPO_ACCESS_TOKEN`, `GOOGLE_SERVICES_JSON` |
    | Encryption and webhooks | `TOKEN_ENC_KEY_V1`, `TOKEN_ENC_ACTIVE_VERSION`, `HASH_PEPPER`, `CRON_SECRET` (its value is loaded into Vault `da_cron_secret`), `WEBHOOK_HMAC_SECRET` |
    | Admin | `ADMIN_BFF_SECRET`, `ADMIN_GATEWAY_SECRET`, `ADMIN_ORIGIN`, `ADMIN_ALLOWED_EMAIL_DOMAINS`, `RECOVERY_CODE_PEPPER`, `PII_LOOKUP_PEPPER`, `AUDIT_SUBJECT_PEPPER` |
    | Email | `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_REPLY_TO`, `EMAIL_INBOUND_BASIC_AUTH` |
    | Public web | `DATA_REGION_LABEL`, `TURNSTILE_SECRET_KEY` |
    | App URLs and identifiers | `APP_ENV`, `EXPO_PUBLIC_APP_ENV`, `EXPO_PUBLIC_APP_SCHEME`, `EXPO_PUBLIC_WEB_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_ADMIN_URL`, `PUBLIC_WEB_URL`, `API_PUBLIC_BASE_URL`, `OAUTH_RESULT_REDIRECT_URI`, `MAIL_MESSAGE_ID_DOMAIN`, `IOS_BUNDLE_IDENTIFIER`, `ANDROID_PACKAGE`, `IOS_APP_GROUP`, `IOS_APP_STORE_ID`, `ANDROID_SHA256_CERT_FINGERPRINTS` |
    | Demo | `DEMO_MODE`, `ALLOW_DEMO_IN_PRODUCTION`, `EXPO_PUBLIC_DEMO_MODE` |
    | CI and stores | `EXPO_TOKEN`, `EXPO_OWNER`, `EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_WEB`, `VERCEL_PROJECT_ID_BACKOFFICE` |

  - `EMBEDDINGS_PROVIDER` and `ADMIN_SESSION_SECRET` are not keys: Voyage is the only embedding provider (R-01), and the backoffice holds no session-sealing secret (BACKOFFICE_PLAN §2.7).
  - `scripts/dev/env.sh` exports `.env` values for the Supabase CLI and generates local random values for `TOKEN_ENC_KEY_V1`, `HASH_PEPPER`, `AI_HASH_PEPPER`, `CRON_SECRET`, `WEBHOOK_HMAC_SECRET`, `ADMIN_BFF_SECRET`, `ADMIN_GATEWAY_SECRET` and the three admin peppers when they are absent.
- **Commands:** `bash scripts/dev/env.sh --init`
- **Acceptance:**
  - `.env.example` contains no value that matches the secret patterns (`sb_secret_`, `sk-`, `-----BEGIN`).
  - Every key used by `packages/validation/src/env.ts` (T-1.16) appears in `.env.example`; a parity test checks this.
- **Satisfies:** M§90, M§107, M§149, M§152.

#### T-0.05 · CI skeleton
- **Depends:** T-0.03
- **Files:** `.github/workflows/ci.yml`
- **Contents:**
  - Runs on `push` (all branches) and `pull_request`.
  - Jobs `install` → `lint` → `typecheck` → `unit` on `ubuntu-24.04`, with `actions/setup-node` using `node-version-file: .nvmrc`, corepack pnpm, the pnpm store cache and the Turbo cache (`.turbo`).
  - `concurrency` cancels superseded runs.
  - T-12.01 expands this workflow.
- **Commands:** `act` is not used. The workflow is validated by pushing to the branch.
- **Acceptance:** the first push shows green `install`, `lint`, `typecheck` and `unit` jobs.
- **Satisfies:** M§105.

#### T-0.06 · Quality-gate scaffolding
- **Depends:** T-0.03
- **Files:** `scripts/quality-gate/run.ts`, `scripts/quality-gate/banned-markers.txt`, `scripts/quality-gate/quality-gate.allow`, `scripts/quality-gate/__tests__/run.test.ts`
- **Contents:** `run.ts` scans tracked files, excluding `docs/`, `design/reference/` and generated files, for:
  - the R-17 markers in `banned-markers.txt`, matched case-insensitively in product code and copy (the character classes below keep the literal markers out of this document): `TO[D]O`, `FIX[M]E`, `X[X]X`, `T[B]D`, `place[h]older`, `lorem ipsum`, `c[o]ming soon`, `not implemented`, `yak[ı]nda`, `çok yak[ı]nda`, `sonraki sürüm`, `ileride eklenecek`. "later" and "sonra" are not banned;
  - the product-copy bans `uçtan uca şifreleme` and `Kredi kartı gerekmez`;
  - `sınırsız` and `unlimited`, flagged only in positive claims. Negated fair-use strings are listed in `quality-gate.allow`.

  JSX attribute names (such as the React Native text-input hint prop) and the CSS pseudo-element of the same name are not string literals and are ignored. T-12.07 adds structural checks. Every `quality-gate.allow` entry needs a justification comment.
- **Commands:** `C-GATE`
- **Acceptance:** the gate exits non-zero on a seeded offending fixture and zero on the clean repository.
- **Satisfies:** M§100, M§133.

#### T-0.07 · Container toolchain bootstrap
- **Depends:** T-0.03
- **Files:** `scripts/dev/bootstrap-container.sh`
- **Contents:** an idempotent script (local and container use only; never run in CI):
  1. `apt-get install -y postgresql-16-pgvector postgresql-16-pgtap libtap-parser-sourcehandler-pgtap-perl postgresql-16-cron`.
  2. `ALTER SYSTEM SET shared_preload_libraries='pg_cron'` and `cron.database_name='da_test'`, then `pg_ctlcluster 16 main start`.
  3. Download Chrome for Testing 153.0.8010.12 from storage.googleapis.com into `.cache/cft/` and export `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. The fallback is `/opt/pw-browsers/chromium-1194`.
  4. Deno comes from the root devDependency: `pnpm exec deno --version` must print 2.1.4.
  5. Optionally attempt tier B: start `dockerd` manually as best effort, and continue if it fails.
- **Commands:** `bash scripts/dev/bootstrap-container.sh`
- **Acceptance:**
  - `psql -c "create extension vector; create extension pgtap;"` succeeds on `da_test`.
  - `pg_prove --version` prints 3.36.
- **Satisfies:** M§134.

### Step 1 — Shared packages

#### T-1.01 · `packages/config`
- **Depends:** T-0.03
- **Files:**
  - `packages/config/package.json` (`@da/config`, exports `./tsconfig/*`, `./eslint/*`, `./prettier`);
  - `tsconfig/{base,library,expo,nextjs,scripts}.json`;
  - `eslint/{base,react-native,next,deno-safe}.mjs`;
  - `eslint/rules/{no-empty-handler,no-raw-color,no-service-client-in-user-routes}.mjs`;
  - `prettier/index.mjs`;
  - `test/rules.test.ts`.
- **Contents:**
  - tsconfig bases:
    - `base`: `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `isolatedModules`, `moduleResolution: bundler`, `module: preserve`, `target: ES2022`.
    - `library` (Deno-safe): `allowImportingTsExtensions`, `noEmit`, `lib: ["ES2022"]` (no DOM).
    - `expo` extends `expo/tsconfig.base`.
    - `scripts` sets `erasableSyntaxOnly`.
  - ESLint:
    - typescript-eslint `strictTypeChecked`;
    - `@typescript-eslint/no-floating-promises` as an error (M§133 unhandled async);
    - `react/jsx-no-literals` for product UI (i18n);
    - `no-restricted-imports`: AsyncStorage is allowed only inside the persister module; `@supabase/supabase-js` `createClient` is banned in Next client code; `server-only` is required in files that read secrets;
    - `no-empty-handler` flags `on[A-Z]*={() => {}}` and no-op handlers;
    - `no-raw-color` flags hex and rgb literals outside `packages/design-tokens`;
    - `no-service-client-in-user-routes` stops `serviceClient` from being imported into `supabase/functions/api/routes/*` unless the file is allow-listed.
- **Commands:** `C-TS @da/config`
- **Acceptance:** RuleTester cases pass for each custom rule. The flat configs load in a fixture project.
- **Satisfies:** M§6 (TS strict), M§7, M§99, M§100, M§133.

#### T-1.02 · `packages/design-tokens`
- **Depends:** T-0.02, T-1.01
- **Files:**
  - `packages/design-tokens/package.json` (`@da/design-tokens`; exports `.`, `./tokens.css`, `./native.json`);
  - `src/{palette,color,typography,space,layout,size,radius,shadow,gradient,motion,opacity,z,aliases,index}.ts`;
  - `scripts/generate.ts`;
  - `generated/{tokens.css,native-colors.json}`;
  - `../../apps/mobile/targets/widget/Generated/WidgetColors.swift`;
  - `../../apps/mobile/modules/da-widgets/android/src/main/java/expo/modules/dawidgets/generated/DaColors.kt`;
  - `test/{contrast,generate}.test.ts`.
- **Contents:**
  - The token object follows the design-system audit's proposed shape: light and dark semantic colours, tones, borders, overlays, plan colours, the typography scale, spacing, radii, shadows, gradients and motion.
  - The accessibility fixes recorded in DESIGN_AUDIT are applied, at minimum `ink/tertiary-strong #6F6C66`.
  - The slash names from the design are kept as aliases.
  - `tokens.css` emits:
    - CSS variables for `:root`;
    - `[data-theme="dark"]` overrides;
    - `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`;
    - a Tailwind v4 `@theme inline` block.
- **Commands:** `C-GEN`, `C-TS @da/design-tokens`
- **Acceptance:**
  - Every pair of informational text on its background scores ≥4.5:1 and every UI element ≥3:1 in both themes, per the pair list in the test.
  - Generated output is byte-identical across runs.
- **Satisfies:** M§4, M§38, M§92, M§122, M§124.

#### T-1.03 · Icon code generation
- **Depends:** T-0.02, T-1.01
- **Files:**
  - `packages/ui/package.json` (`@da/ui` skeleton; peers react 19.2.3, react-native 0.86.3, react-native-svg, reanimated);
  - `packages/ui/scripts/gen-icons.ts`, `packages/ui/icons.manifest.json`;
  - `packages/ui/src/icons/generated/*.tsx`, `packages/ui/src/icons/index.ts`;
  - `apps/web/src/components/icons/generated/*.tsx`, `apps/backoffice/src/components/icons/generated/*.tsx`.
- **Contents:**
  - Sources are `@material-symbols/svg-400/rounded/{name}.svg` and `{name}-fill.svg`.
  - The manifest is the union of `design/icons/used-icons.txt` and the icons the app adds.
  - React Native output: `<Icon name filled size color accessibilityLabel />` with a typed `IconName` union.
  - DOM output: `<svg>` using `currentColor`, with `aria-hidden` unless a label is passed.
  - Only manifest icons are emitted.
- **Commands:** `pnpm --filter @da/ui run icons`, then `C-GEN`
- **Acceptance:**
  - Every manifest name resolves to a file.
  - A render test sets the accessibility label.
  - The emitted icon count equals the manifest size.
- **Satisfies:** M§4, M§122, M§125.

#### T-1.04 · `packages/i18n`
- **Depends:** T-0.02, T-1.01
- **Files:**
  - `packages/i18n/package.json` (`@da/i18n`);
  - `src/{index,formats,relative-time,tr-suffix,pseudo}.ts`;
  - `messages/{tr,en}/<namespace>.json`, where the namespaces are: common, states, errors, onboarding, auth, today, briefing, flow, mail, reply, waiting, followups, commitments, life, plan, meeting, assistant, voice, memory, search, person, capture, reminder, approvals, explain, correction, settings, privacy, notifications, push, subscription, paywall, referral, android_ni, widgets, web, legal, faq, backoffice;
  - `STYLE.md`, `scripts/check-catalogs.ts`, `test/*.test.ts`.
- **Contents:**
  - `tr` is the default locale and `en` is complete.
  - Typed keys come from an `AppConfig` augmentation.
  - `formats`: 24-hour time, `d MMMM yyyy` dates, `Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY'})`.
  - Relative time uses date-fns with the `tr` and `en` locales.
  - `trSuffix` / `trNumberSuffix` handle the dative, ablative, accusative and locative cases (Ahmet'e, Ayşe'ye, 09:40'tan, 77'sini).
  - A pseudo-locale adds 40% length.
  - The FAQ is single-sourced here and shared by the web `/support` page and the in-app Help screen.
  - The catalogs are seeded from `design/copy` and the verbatim master-prompt strings, for example:
    - "Bugün bilmen gerekenleri, sen sormadan söyler.", "Brifingimi Gör", "Dinle · {minutes} dk";
    - "Kaynakta kesinleşmiyor.", "Harici kimlik bilgisi gerekli", "Bağlantıyı yenile.";
    - the three Privacy Center statements (M§40);
    - the R-15 truthful-storage copy "Mail içeriğinin tamamı saklanmaz; yalnızca özetler, kısa alıntılar ve analiz sonuçları saklama süren boyunca tutulur.", the First Analysis footer "Son 72 saat analiz edildi. Mail içeriğinin tamamı saklanmaz." and the Android NI disclosure "Bildirim içerikleri cihazında işlenir; yalnızca çıkarılan bilgiler (ör. kargo durumu, tutar, tarih) hesabına kaydedilir. Doğrulama kodları ve güvenlik uygulamaları her zaman hariç tutulur.";
    - the notification copy "Sadece önemli olduğunda haber veririz." (R-14) and the voice hint "Onaylamak için karta dokun." (R-03).
  - `STYLE.md` records the tone rules from SREQ-87.
- **Commands:** `C-TS @da/i18n`, `node packages/i18n/scripts/check-catalogs.ts`
- **Acceptance:**
  - tr and en have identical key sets.
  - Every message parses with `intl-messageformat`.
  - The suffix tests pass.
  - No banned markers remain.
- **Satisfies:** M§2, M§39, M§40, M§100.

#### T-1.05 · Domain: enums, entities, keys, deep links, approval state machine
- **Depends:** T-1.01
- **Files:**
  - `packages/domain/package.json` (`@da/domain`, `"type":"module"`, `exports: {".": "./src/index.ts"}`);
  - `src/{index,enums,provenance,ids,deeplinks}.ts`, `src/entities/*.ts`, `src/approvals/state-machine.ts`, `src/analytics/events.ts`;
  - `test/{enums,approvals,deeplinks}.test.ts`.
- **Contents:**
  - Every A5 enum, plus the accepted additions, as `as const` arrays with their union types.
  - Entity interfaces for Insight, Briefing, BriefingItem, ApprovalAction (with typed payloads per `approval_action_type`), Commitment, LifeEvent, Reminder, Capture, MemoryChunk and others.
  - `Provenance` and `sourceLabel()` (for example "Gmail · Mehmet Yılmaz · 08:42").
  - Dedupe and idempotency key builders: `briefingKey(user,kind,localDate)`, `approval:{id}:{payload_version}`, `sync:{account}:{cursor}`, `notify:{id}`.
  - `deepLinkForInsight()` and route builders for the A9 routes.
  - The approval transition table, which mirrors `private.transition_approval` and is exactly the spine §5 state machine (no undo status and no extra edge; R-06), plus the `approved_via` union `approval_center | inline_sheet | voice_card | capture_batch | in_place` (R-03).
  - The analytics catalogue in `src/analytics/events.ts` (the R-21 `packages/domain/analytics/events.ts`; sources live under `src/`). It is generated at execution from the SCREEN_AND_FLOW_MAP event names plus the backend events listed in API_CONTRACTS, with typed, content-free props under the SECURITY_AND_PRIVACY_PLAN rules.
- **Commands:** `C-TS @da/domain`, `pnpm exec deno check packages/domain/src/index.ts`
- **Acceptance:**
  - Deno check passes.
  - Every legal approval transition is accepted and every illegal one rejected.
  - After T-2.25, the enum values equal the generated Postgres enums.
- **Satisfies:** M§7, M§33, M§77, M§97.

#### T-1.06 · Domain: time zones and Turkish extractors
- **Depends:** T-1.05
- **Files:** `packages/domain/src/time/{zone,format}.ts`, `src/extract/{normalize-tr,date-tr,amount-tr,tracking,flight,pnr}.ts`, `test/extract/*.test.ts`, `test/time/*.test.ts`
- **Contents:**
  - Time helpers:
    - `localDate(now,tz)`;
    - `atLocalTime(date,'HH:mm',tz)`, DST-safe via @date-fns/tz;
    - `isWithinQuietHours(start,end,now,tz)`, including windows that span midnight.
  - Turkish date parsing:
    - month names and abbreviations;
    - day-first numeric formats and ISO;
    - weekdays with suffixes;
    - relative words: bugün, yarın, haftaya, Cuma.
  - Amounts use TRY-first regexes and return minor units, never floats: "1.842 TL" → 184200, "₺1.842,50" → 184250, "12,5 bin TL" → 1250000.
  - Also extracted: tracking numbers, IATA flight numbers (TK2412) and PNRs.
  - Word boundaries use `(?<!\p{L})…(?!\p{L})` with the `u` flag.
- **Commands:** `C-TS @da/domain`
- **Acceptance:**
  - At least 150 Turkish fixtures pass, including DST transitions in a non-Istanbul zone.
  - Ambiguous amounts return `confidence: medium`.
- **Satisfies:** M§39, M§80, M§83, M§96, M§101.

#### T-1.07 · Domain: priority engine
- **Depends:** T-1.05
- **Files:** `packages/domain/src/priority/{engine,signals,explain}.ts`, `test/priority/*.test.ts`
- **Contents:**
  - `evaluatePriority({meta, rules, learned, vipIds, signals, ai?})` returns `{category, importance, urgency, decision_tier, reason_code, rule_id?, confidence}`.
  - Precedence: explicit rule > learned preference > deterministic signal > AI.
  - Rule types:
    - `sender_important`, `domain_important`, `vip_always_notify`, `keyword_high`, `promotions_low`, `mute_sender`;
    - `app_package` (Android NI).
  - Signals:
    - `List-Unsubscribe`, `Precedence: bulk`, `Auto-Submitted`, noreply senders;
    - Gmail `CATEGORY_*` labels;
    - known contact and replied-before;
    - To vs Cc.
  - `explain()` returns i18n keys for "Neden önemli?".
- **Commands:** `C-TS @da/domain`
- **Acceptance:**
  - Table-driven precedence cases pass: mute beats AI "important", and VIP deterministically raises urgency.
  - Every result carries its tier and reason.
- **Satisfies:** M§3(9,10), M§14, M§31, M§32, M§101.

#### T-1.08 · Domain: notification decision engine and renderer
- **Depends:** T-1.06
- **Files:** `packages/domain/src/notifications/{decide,render,channels}.ts`, `test/notifications/*.test.ts`
- **Contents:**
  - `decide()` runs the seven M§132 checks in order:
    1. relevance;
    2. urgency;
    3. category preference;
    4. quiet hours in the user's timezone (R-13: on by default, 22:30–07:30). Only user-created smart reminders at the time the user chose and VIP `critical_email` with `vip_bypass_quiet` on (default on; per-VIP override `vip_people.bypass_quiet_hours`) pass, still deduped and capped at 3 per quiet window;
    5. dedupe key;
    6. rolling 24 h caps, per category and a global non-critical daily cap from `notification_preferences.daily_cap` (default 5; R-14). The settings copy is "Sadece önemli olduğunda haber veririz."; "Günde ortalama 3 bildirim" is not used.
    7. lock-screen sensitivity and detail mode, including the `smart_filter` ("Yalnızca gerçekten önemliyse bildir") toggle.

    The outcome is `send | schedule | suppress` with a reason code, including `late_delivery` for deliveries more than 90 min late.
  - `render()` produces the server-side title and body per `full | title_only | generic`. The payload is exactly `{type, entity_id, deeplink}`.
  - `channels` maps each category to its Android channel and iOS interruption level. The channel IDs are the R-12 set: `briefings` (morning, midday, evening and weekly), `critical_email`, `meetings`, `deadlines`, `follow_up`, `life_intel`, `approvals`, `reminders`, `account` and `phone_digest` (Android NI only), all with `lockscreenVisibility = PRIVATE`. The weekly review uses category `evening` on channel `briefings`.
- **Commands:** `C-TS @da/domain`
- **Acceptance:**
  - Every check has passing and failing cases.
  - Quiet hours across midnight and during DST are correct.
  - `generic` output never contains a name or subject.
- **Satisfies:** M§35, M§86, M§96, M§101, M§132.

#### T-1.09 · Domain: entitlements and plan limits
- **Depends:** T-1.05
- **Files:** `packages/domain/src/entitlements/{effective,features,limits}.ts`, `test/entitlements/*.test.ts`
- **Contents:**
  - `effectiveEntitlement({subscription, grants, now})` returns `{entitlement:'free'|'pro', source:'store'|'grant'|null, expires_at}`. It mirrors the SQL function. Grants stack without overlap.
  - `features.ts` maps each Pro capability from M§44.
  - `limits.ts` reads the `plan_limits` keys (R-22): `max_mail_accounts`, `max_calendars`, `ai_daily_budget_units` (Free 50), `ai_soft_cap_usd_day`, `ai_hard_cap_usd_day`, `ai_hard_cap_usd_month`, `ai_routing_profile` and the M§44 feature booleans. No limit value is hard-coded.
- **Commands:** `C-TS @da/domain`
- **Acceptance:**
  - Expired, refunded and grace-period cases resolve correctly.
  - Stacked referral grants extend without overlap.
- **Satisfies:** M§43, M§44, M§82, M§101.

#### T-1.10 · Domain: referral codes and anti-abuse
- **Depends:** T-1.05
- **Files:** `packages/domain/src/referrals/{code,qualify,risk}.ts`, `test/referrals/*.test.ts`
- **Contents:**
  - Codes are 7 characters from the alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, with a checksum character.
  - `qualify()` implements the A16 criteria.
  - `risk()` checks self-referral (user id, email hash, Apple relay, installation hash), duplicate-account heuristics, loops, the 6-per-year cap and velocity. It returns a score and a `flagged` decision.
- **Commands:** `C-TS @da/domain`
- **Acceptance:** each abuse vector is detected. A clean referral qualifies exactly once.
- **Satisfies:** M§45, M§101, M§116.

#### T-1.11 · Domain: commitments and follow-ups
- **Depends:** T-1.06
- **Files:** `packages/domain/src/commitments/{detect,due}.ts`, `src/followups/state.ts`, `test/commitments/*.test.ts`, `test/followups/*.test.ts`
- **Contents:**
  - Turkish commitment triggers ("gönderirim", "ararım", "dönerim", "iletirim", "hallederim", …) with a certainty of `firm` or `hedged`.
  - Due dates are resolved deterministically from the quote, relative to the message time in the user's timezone ("Cuma", "Yarın", "Haftaya").
  - A thread state machine yields `awaiting_my_reply` / `awaiting_their_reply`.
  - The waiting badge turns amber at 3 days and coral at 7. `follow_up_after_days` defaults to 2.
- **Commands:** `C-TS @da/domain`
- **Acceptance:**
  - The three M§18 example phrases resolve to correct due dates.
  - A `hedged` commitment is flagged as needing confirmation.
- **Satisfies:** M§17, M§18, M§101.

#### T-1.12 · Domain: reminders, slot finder and calendar intelligence
- **Depends:** T-1.06
- **Files:** `packages/domain/src/reminders/presets.ts`, `src/calendar/{slots,intel}.ts`, `test/reminders/*.test.ts`, `test/calendar/*.test.ts`
- **Contents:**
  - Presets, in master order:

    | Preset | Resolves to |
    |---|---|
    | "30 dakika önce" | anchor − 30 min |
    | "1 saat önce" | anchor − 60 min |
    | "Bu akşam" | 19:00 local; disabled after 19:00 |
    | "Yarın sabah" | tomorrow at `working_hours_start` (default 09:00) |
    | "Uygun zamanda" | the first free slot of at least 15 min inside working hours, before the due time, outside quiet hours (SREQ-34) |
    | "Kendin seç" | the user's choice |

    Each preset returns an absolute time and a reason ("Takvimine göre: 12:10").
  - The slot finder applies buffers.
  - `intel` detects conflicts, back-to-back meetings (a gap under 10 min) and the need to prepare (external or VIP attendees). It uses a location only if one is present and never invents travel time.
- **Commands:** `C-TS @da/domain`
- **Acceptance:** the preset and slot cases pass across DST boundaries and quiet hours.
- **Satisfies:** M§19, M§20, M§29, M§101.

#### T-1.13 · Domain: grounding verifier and output guards
- **Depends:** T-1.06
- **Files:** `packages/domain/src/grounding/{verify,calibrate,output-guards}.ts`, `test/grounding/*.test.ts`, `test/grounding/fixtures/*.json`
- **Contents:**
  - Evidence has the shape `{ref, quote}`. The quote, at most 300 chars, must be a substring of the normalized source.
  - Dates and amounts are re-parsed from the quote. When verification fails, the field is dropped or marked `unverified`, which renders as "Kaynakta kesinleşmiyor.".
  - Confidence is calibrated.
  - Output guards reject instruction-like text, URLs not present in the source and cross-user references.
- **Commands:** `C-TS @da/domain`
- **Acceptance:**
  - Fabricated deadlines and amounts are removed.
  - Injection fixtures produce no actions.
- **Satisfies:** M§80, M§83, M§101, M§114.

#### T-1.14 · Domain: RBAC matrix
- **Depends:** T-1.05
- **Files:** `packages/domain/src/rbac.ts` (`PERMISSIONS`, `ROLE_PERMISSIONS`, `can`), `test/rbac/{matrix,sql-parity}.test.ts`
- **Contents:**
  - The permission catalogue is BACKOFFICE_PLAN §4.1, verbatim (R-20): `dashboard.read`, `metrics.ops.read`, `metrics.ai.read`, `metrics.revenue.read`, `metrics.product.read`, `users.read`, `users.pii.reveal`, `users.force_sync`, `users.disable`, `users.mark_internal`, `integrations.read`, `integrations.disconnect`, `integrations.renew_watch`, `jobs.read`, `jobs.retry`, `jobs.cancel`, `briefings.read`, `briefings.regenerate`, `notifications.read`, `push.test`, `ai.read`, `ai.models.write`, `prompts.read`, `prompts.write`, `prompts.activate`, `ai_feedback.read`, `ai_feedback.reveal`, `subscriptions.read`, `billing_events.read`, `subscriptions.resync`, `entitlements.grant`, `entitlements.grant_limited`, `entitlements.revoke`, `referrals.read`, `referrals.review`, `support.read`, `support.write`, `support.access`, `feedback.read`, `feedback.write`, `flags.read`, `flags.write`, `flags.write_ai`, `announcements.read`, `announcements.write`, `data_requests.read`, `data_requests.manage`, `audit.read`, `health.read`, `health.run`, `admins.read`, `admins.manage`, `settings.system.write`, `search.global`.
  - The role matrix follows A10.
  - `can(role, permission)` answers access questions.
  - The `sql-parity` test parses the seed in `20260924001200_admin_audit.sql` and asserts it equals the TypeScript matrix.
- **Commands:** `C-TS @da/domain`
- **Acceptance:** the parity and matrix tests pass. The `analyst` and `readonly` roles have no mutation permissions.
- **Satisfies:** M§47, M§101, M§148.

#### T-1.15 · Domain: provider contracts, URL and IP safety, flow sort, weekly formula
- **Depends:** T-1.05
- **Files:** `packages/domain/src/providers/{types,errors}.ts`, `src/url-safety.ts`, `src/net/ip-ranges.ts`, `src/flow/sort.ts`, `src/weekly/time-saved.ts`, matching tests
- **Contents:**
  - `MailProvider`, `CalendarProvider` and `TaskProvider` follow the integrations-audit contract: auth URL, exchange, refresh, revoke, initial and incremental sync, subscribe, renew, unsubscribe, and optional send / writeEvent / writeTask.
  - Normalized DTOs: `NormalizedMessage`, `NormalizedEvent`, `NormalizedTask`.
  - The `ProviderError` taxonomy maps to `account_status`.
  - `url-safety` defines the scheme allow-list, the conferencing-domain allow-list (meet.google.com, teams.microsoft.com, *.zoom.us), IDN display and anchor-mismatch detection.
  - `ip-ranges` covers private, loopback, link-local, CGNAT, ULA and metadata ranges, including decimal and hex encodings.
  - Flow sort order: urgency bucket, then time.
  - The weekly time-saved formula `v1` is documented and deterministic.
- **Commands:** `C-TS @da/domain`
- **Acceptance:** the IP-range and URL tests pass. The sort is stable.
- **Satisfies:** M§12, M§13, M§75, M§84.

#### T-1.16 · `packages/validation`
- **Depends:** T-1.05
- **Files:**
  - `packages/validation/package.json` (`@da/validation`);
  - `src/{index,env,errors,widget-snapshot,analytics-events}.ts`;
  - `src/api/{devices,bootstrap,integrations,onboarding,mail,approvals,reminders,plan,meetings,assistant,search,capture,briefings,business,privacy,support,android-ni,analytics}.ts`;
  - `src/ai/*.ts`, `src/admin/*.ts`, `src/public/*.ts`, `src/webhooks/{revenuecat,graph,pubsub}.ts`;
  - `test/**`.
- **Contents:**
  - `serverEnv` / `clientEnv` schemas.
  - `ErrorCode` and the error envelope `{error:{code, message_key, details?, correlation_id}}`.
  - Request and response schemas for every A5 route.
  - The assistant SSE event union from API-AST-02: `meta | status | delta | citation | card | action_proposal | done | error`.
  - Approval payloads per action type, including `exact_change`, `destination` and `side_effects`.
  - AI output schemas: EmailTriageV1, ThreadSummaryV1, EmailDeepExtractV1, CommitmentExtractV1, LifeIntelV1, BriefingMorningV1, MiddayPulseV1, EveningCloseV1, WeeklyReviewV1, MeetingPrepV1, PostMeetingCommitmentV1, CaptureExtractV1, AssistantIntentV1, AssistantGroundedJsonV1, AssistantAnswerV1, ReplyDraftsV1, FollowUpDraftV1 and BriefingPolishV1 (the AI_PIPELINE_PLAN §4.3 catalogue). They follow the cross-provider rules: every field required (nullable where optional), `additionalProperties:false`, depth ≤4, discriminated unions.
  - `WidgetSnapshotV1`.
  - zod validators for the R-21 analytics catalogue in `@da/domain` (`src/analytics/events.ts`), with typed, content-free properties.
- **Commands:** `C-TS @da/validation`, `pnpm exec deno check packages/validation/src/index.ts`
- **Acceptance:**
  - Every schema has valid and invalid fixtures.
  - A strictness test walks the `z.toJSONSchema()` output of every AI schema.
- **Satisfies:** M§7, M§42, M§80, M§107, M§146.

#### T-1.17 · `packages/api-client`
- **Depends:** T-1.16
- **Files:**
  - `packages/api-client/package.json` (`@da/api-client`; peer @tanstack/react-query);
  - `src/{index,supabase,api,sse,errors,query-keys}.ts`, `src/hooks/.gitkeep-free index.ts` (hooks are added per feature);
  - `src/database.types.ts` (generated in T-2.25);
  - `test/*.test.ts`.
- **Contents:**
  - `createDaClient({url, publishableKey, storage})`: publishable key only.
  - `apiFetch(route, input, {idempotencyKey?})`:
    - `x-correlation-id` header;
    - `Idempotency-Key` header;
    - error-envelope parsing into a typed `ApiError`;
    - one refresh-and-retry on 401.
  - `sse()` parses `text/event-stream` from `expo/fetch` or web fetch streams.
  - `query-keys` holds a hierarchical key factory per area.
- **Commands:** `C-TS @da/api-client`
- **Acceptance:** fetch-mock tests cover envelope parsing, retry-on-401 and SSE chunk boundaries.
- **Satisfies:** M§6, M§7.

### Step 2 — Supabase database

Every migration task shares the same **Commands** (`C-DB`) and the same base **Acceptance**: the file applies from zero on tier C (PG16 + shim) and on tier A (CI, PG17), and the pgTAP suites named for it in T-2.22 and T-2.23 pass. Complete column specs are in `DATABASE_AND_RLS_PLAN.md`.

#### T-2.01 · `supabase/config.toml` and project layout
- **Depends:** T-0.04
- **Files:** `supabase/config.toml`, `supabase/README.md`
- **Contents:**
  - `[api]`: `schemas = ["public","admin_api"]`, `extra_search_path = ["public","extensions"]`.
  - `[db]`: `major_version = 17`; `[db.seed]` disabled (demo seeding runs through T-2.24).
  - `[auth]`:
    - `site_url`;
    - `additional_redirect_urls` for every variant scheme (`dijitalasistan://auth/callback`, `-preview`, `-dev`, `-e2e`), `ADMIN_ORIGIN` and the web origin;
    - refresh-token rotation; `[auth.email]` 6-digit OTP with a 600 s expiry; SMS disabled;
    - `[auth.mfa.totp] enroll_enabled = verify_enabled = true`;
    - `[auth.hook.custom_access_token] uri = "pg-functions://postgres/private/custom_access_token_hook"`;
    - `[auth.external.{apple,google,azure}]` with `env(…)` substitutions;
    - `[auth.email.smtp]` via `env(…)` (**External credential required**).
  - `[storage]`: file-size limit 20 MiB.
  - `[edge_runtime]`: `policy = "per_worker"`, `deno_version = 2`.
  - `[functions.*]`: `verify_jwt = true` for `api`; `false` for `oauth`, the `webhooks-*` functions, `worker`, `admin-api`, `public-api` and `health`, all of which verify in code.
  - Hosted-project auth settings are applied with `supabase config push` from the deploy job. Where a setting cannot be pushed, it becomes a **Manual external step** in Dashboard → Auth.
- **Commands:** `pnpm exec supabase init` (then edit), `pnpm db:start` (CI / tier B)
- **Acceptance:**
  - `supabase start` succeeds in CI.
  - The file contains no literal secrets.
- **Satisfies:** M§6, M§88, M§109.

#### T-2.02 · Tier-C compatibility shim and database runners
- **Depends:** T-0.07
- **Files:** `supabase/tests/shim/000_supabase_compat.sql`, `scripts/db/{tier-c,tier-a,reset-twice}.sh`, `scripts/db/README.md`
- **Contents:**
  - The shim provides:
    - roles `anon`, `authenticated`, `service_role BYPASSRLS`, `authenticator`, `supabase_auth_admin`;
    - schemas `auth`, `storage`, `extensions`, `net`, `vault`;
    - `auth.users` (id, email, raw_app_meta_data, raw_user_meta_data, created_at), `auth.sessions`, `auth.mfa_factors`;
    - `auth.uid()`, `auth.role()` and `auth.jwt()` reading `request.jwt.claims`;
    - `storage.buckets`, `storage.objects` and `storage.foldername()`;
    - `net.http_post()`, which records calls to `net._requests`;
    - a `vault.decrypted_secrets` view over a shim table.
  - `tier-c.sh` recreates `da_test`, loads the shim, applies the migrations in order with `ON_ERROR_STOP`, then runs `pg_prove -d da_test supabase/tests/database/*.test.sql`.
  - `tier-a.sh` runs `supabase start && supabase db reset && supabase test db && supabase db lint --level warning`.
- **Commands:** `bash scripts/db/tier-c.sh`
- **Acceptance:** an empty migration set plus the shim and a smoke pgTAP file pass on both tiers.
- **Satisfies:** M§79, M§101, M§134.

#### T-2.03 · Migration 0001: extensions, schemas, enums
- **Depends:** T-2.02, T-1.05
- **Files:** `supabase/migrations/20260924000100_extensions_schemas_enums.sql`
- **Contents:**
  - Extensions in the `extensions` schema: `pgcrypto`, `vector`, `pg_trgm`, `unaccent`.
  - `pg_net` and `pg_cron` are created inside a guard: `do $$ … if exists (select from pg_available_extensions where name='pg_net') …`.
  - Schemas `private` and `admin_api`, with `revoke all … from public`.
  - Every A5 enum plus the accepted additions from the registry.
  - The text-search configuration `private.tr_search` (Turkish with `unaccent`) and the `private.immutable_unaccent` helper (DATABASE_AND_RLS_PLAN §10).
  - `private.set_updated_at()` trigger function.
- **Acceptance:** the enum values equal `@da/domain` (asserted in T-2.25).
- **Satisfies:** M§77, M§78.

#### T-2.04 · Migration 0002: identity and settings
- **Depends:** T-2.03
- **Files:** `supabase/migrations/20260924000200_identity_settings.sql`
- **Contents:**
  - `profiles` (PK `user_id` → `auth.users`): `locale`, `state` (`user_state`: `active | disabled | deletion_pending`; account deletion sets `deletion_pending`, so there is no `deletion_requested_at` column), onboarding step and completion, terms version and acceptance time, `is_demo`, `is_internal`, `disabled_at`, `last_active_at`.
  - `user_preferences`:
    - `timezone` (default `Europe/Istanbul`; validated by a trigger), `timezone_auto`, `theme` (the locale lives on `profiles.locale`);
    - `retention_policy` (default `d90`);
    - briefing times 08:00 / 13:00 / 19:00, weekly day 0 at 18:00, weekend briefings, silent days;
    - working hours 09:00–18:00, interest categories, `learn_from_interactions` (default true), `default_reply_tone`, `follow_up_after_days`, `analytics_opt_out`, `ai_data_access`.
  - `notification_preferences`: one toggle per category; `quiet_hours_enabled` (default true), `quiet_start` 22:30, `quiet_end` 07:30 and `vip_bypass_quiet` (default true) (R-13); `detail_level` (default `title_only`); `lock_screen_private` (default true); `smart_filter` (default true); `daily_cap` (default 5 non-critical pushes; R-14).
  - `app_installations` and `push_tokens`.
  - `private.handle_new_user()` trigger on `auth.users`: creates the profile, preference and notification-preference rows and the referral code, and skips identities with `raw_app_meta_data.da_kind='admin'`.
- **Acceptance:** a new auth user gets exactly one row in each settings table; an admin identity gets none.
- **Satisfies:** M§39 (timezone stored separately), M§78, M§130.

#### T-2.05 · Migration 0003: integrations
- **Depends:** T-2.04
- **Files:** `supabase/migrations/20260924000300_integrations.sql`
- **Contents:**
  - `connected_accounts`: provider, provider account id, account email, `account_status`, status reason, `granted_scopes`, `capabilities_granted`, `data_source_toggles` (DATABASE_AND_RLS_PLAN §4.2 keys), `demo_flavor` (`google | microsoft`, demo accounts only), `last_successful_sync_at`, `disconnected_at`, and a unique `(user_id, provider, provider_account_id)`.
  - `oauth_credentials`: key version, IV, ciphertext, `token_kind` (`refresh | access | apple_siwa_refresh`), expiry, nullable `connected_account_id` (null only for `apple_siwa_refresh`), `refresh_lock_until` and `refresh_lock_owner`.
  - `oauth_states`: state hash, PKCE verifier ciphertext, requested capabilities, `return_to`, expiry, `used_at`, and the R-07 binding columns `device_nonce_hash`, `completion_code_hash` and `completed_at`.
  - `calendars`: `is_selected`, `can_write`, `access_role`; the trigger `private.enforce_calendar_selection_limit` applies the Free limit.
  - `sync_states`: resource key, cursor, `page_token`, backfill state, watch id / expiry / secret hash, `lease_owner` / `lease_expires_at`, consecutive failures, `next_poll_at`, `stats`. Owners read sync health only through the security-invoker view `connected_account_sync_health`.
  - `provider_quota_usage` (`bucket`, nullable `connected_account_id` / `user_id`, `window_start`, `window_seconds`, `units_used`, `units_limit`), consumed through `private.consume_provider_quota`.
  - `webhook_events`: unique `(source, external_id)`, status.
- **Acceptance:** the uniques hold; the Free calendar-selection limit is enforced.
- **Satisfies:** M§75, M§76, M§77, M§116, M§117.

#### T-2.06 · Migration 0004: content
- **Depends:** T-2.05
- **Files:** `supabase/migrations/20260924000400_content.sql`
- **Contents:**
  - `email_threads` and `email_messages`. The analysis column group (names per DATABASE_AND_RLS_PLAN §4.3) is: category, decision tier, reason, rule id, confidence, one-liner, key points, deadline, evidence, `ai_status`, `injection_suspected`, `dropped_fields`, `life_signal`, web link, attachment metadata, and a snippet of at most 200 chars. Threads add `rolling_summary`, `last_processed_message_id`, `follow_up_state`, `awaiting_since`, `expects_reply_message_id` and `topic_label`. **There are no body columns.**
  - `calendar_events` (organizer flag, attendees, location, conference URL, `da_approval_id`).
  - `tasks`, `commitments` (direction, person, due, quote, status, confidence, `user_overrides`), `reminders` (preset, anchor, fire time, reason, status, `idempotency_key`).
  - `meeting_notes`, `meeting_preps`, `contacts` (email, name, domain, stats, `origin` including `manual`), `vip_people` (`relationship` typed `vip_relationship`: `spouse | family | manager | key_client | friend | other`; `bypass_quiet_hours`, R-13).
  - `life_events` (typed `fields jsonb` with evidence refs).
  - `captures`: kind, status (`capture_status` gains `pending_upload`, the default), storage path, MIME, size, sha256, text and link, `extracted`, `extracted_types`, `primary_type`, `share_origin` (`in_app | ios_share | android_send | assistant | today`), `idempotency_key`, `progress`, `file_deleted_at`.
  - `android_notification_signals`: unique `(user_id, signal_hash)`, `extractor_version`.
  - Every derived table carries the provenance columns and `expires_at`.
- **Acceptance:** all A5 uniques exist, and the `(user_id, …)` indexes are present.
- **Satisfies:** M§77, M§78, M§97, M§116.

#### T-2.07 · Migration 0005: intelligence
- **Depends:** T-2.06
- **Files:** `supabase/migrations/20260924000500_intelligence.sql`
- **Contents:**
  - `priority_rules` (type, matcher, action, enabled, position).
  - `learned_preferences` (`group_key`, `statement`, `target_type`, `target_ref`, `effect`, `priority_override`, `evidence_count`, `origin`, `enabled`, and a `deleted_at` tombstone so a deleted preference is never re-learned).
  - `insights`: kind, card type, urgency, status, snoozed until, dedupe key, primary action, reason, entity foreign keys, provenance.
  - `briefings` (kind, `local_date`, status, headline, narrative, stats, audio columns, version, timestamps) and `briefing_items` (section, position, entity refs, provenance).
  - `reply_drafts` (kind `reply | follow_up`, tone `short | professional | friendly | detailed`, status `draft | submitted | sent | discarded | failed`, version, variants, recipients, `approval_action_id`).
  - `ai_feedback`, `ai_requests` (no content columns), `ai_usage_daily`.
  - `ai_model_config` in the AI_PIPELINE_PLAN §3.6 shape: `profile` (enum `routing_profile`: `balanced | lean`), `role` (the model slot edited in the backoffice), `feature` (`ai_feature`), `tier` (`ai_tier`), `enabled`, `primary_target`, `fallback_targets`, `escalation_target`, `batch_policy`, `cache_ttl`, `max_input_tokens`, `eval_status`, `retires_not_before` and `version`. It is unique on `(profile, role, feature)` (R-18) and has a check that rejects `claude-fable-*` model IDs (R-02).
  - `ai_result_cache` (`user_id`, `feature`, a per-user HMAC `content_hash`, `prompt_version_id`, `model`, `result`, `hit_count`, `expires_at`), unique on `(user_id, feature, content_hash, prompt_version_id)` (R-02). It is a system table.
  - `ai_calibration_versions` and `ai_batches` (system tables from AI_PIPELINE_PLAN).
  - `prompt_versions`: unique `(prompt_key, version)` and a partial unique index allowing one active version per key.
  - `ai_model_prices`.
- **Acceptance:** activating a second prompt version for the same key fails; the fable check rejects inserts; a duplicate `ai_result_cache` key is rejected.
- **Satisfies:** M§32, M§57, M§58, M§77, M§82.

#### T-2.08 · Migration 0006: approvals
- **Depends:** T-2.07
- **Files:** `supabase/migrations/20260924000600_approvals.sql`
- **Contents:**
  - `approval_actions` columns (names per DATABASE_AND_RLS_PLAN §4.4):
    - `action_type` and `status`;
    - `payload jsonb`, `payload_version` and `payload_hash`;
    - `what`, `why`, `change_summary`, `exact_change jsonb`, `side_effects`, `destination_account_id` and `destination_label`;
    - `origin`, `origin_ref_id`, `executor` (`server | device`), `device_installation_id` and `device_token_hash`;
    - `approved_via` (R-03): `approval_center | inline_sheet | voice_card | capture_batch | in_place`. Every value is a tap; a spoken "onayla" never approves;
    - `idempotency_key` (unique) and `provider_idempotency_ref`;
    - `approval_expires_at` (the retention column `expires_at` is separate), `result`, `attempt_count`, `last_error_code`, `last_error_message`, `batch_id`;
    - provenance.
  - The state machine is exactly spine §5 (R-06). There is no undo status, no `execute_after` column and no extra edge such as `approved → rejected` or `failed → rejected`.
  - `approval_events` is an append-only audit trail with columns `approval_id`, `from_status`, `to_status`, `actor`, `at` and `detail`.
- **Acceptance:** A direct client `insert` into `approval_actions` is denied. Status changes are only possible through `private.transition_approval` (T-2.15).
- **Satisfies:** M§33, M§115, M§116.

#### T-2.09 · Migration 0007: assistant and memory
- **Depends:** T-2.08
- **Files:** `supabase/migrations/20260924000700_assistant_memory.sql`
- **Contents:**
  - `assistant_threads` has an optional `person_contact_id`.
  - `assistant_messages` has `role`, `content`, `client_message_id`, `citations`, `cards` and `finish_reason`, and is bound by retention.
  - `memory_chunks` has:
    - `chunk_kind`, `content`, `content_hash`, `contact_ids`, `page_no` and `occurred_at`;
    - `embedding vector(1024)` with `embedding_model = 'voyage-4@1024'` (R-01), plus `embedding_dr vector(1024)` for the disaster-recovery re-embed;
    - a generated `tsv` column (`private.tr_search`);
    - provenance and `expires_at`.
  - Indexes on `memory_chunks`:
    - btree `(user_id, expires_at)`;
    - GIN on `tsv` and on `contact_ids`;
    - HNSW `using hnsw (embedding extensions.vector_cosine_ops)`.
- **Acceptance:** The index DDL runs on pgvector 0.6.
- **Satisfies:** M§24, M§26, M§95.

#### T-2.10 · Migration 0008: notifications
- **Depends:** T-2.09
- **Files:** `supabase/migrations/20260924000800_notifications.sql`
- **Contents:**
  - `notifications` columns:
    - `category`, `decision`, `suppression_reason`, `detail_mode`;
    - `dedupe_key`, unique per user;
    - `rendered_title` and `rendered_body`, which are server-rendered and never include full content by default;
    - `payload` in the shape `{type, entity_id, deeplink}`;
    - `scheduled_for`, `sent_at`, `opened_at`, `correlation_id`, `is_test`.
  - `push_tickets` has `ticket_id`, `receipt_status` and `receipt_error`.
- **Acceptance:** Inserting a duplicate `dedupe_key` for the same user fails.
- **Satisfies:** M§86, M§132.

#### T-2.11 · Migration 0009: business
- **Depends:** T-2.10
- **Files:** `supabase/migrations/20260924000900_business.sql`
- **Contents:**
  - `subscriptions` is the RevenueCat mirror: `entitlement`, `store`, `product_id`, `period_type`, `is_active`, `will_renew`, `expires_at`, `refunded_at`, `environment` and `synced_at`.
  - `billing_events` has a unique `event_id`.
  - `entitlement_grants` has `source grant_source`, `starts_at`, `ends_at`, `reason`, `created_by` and a unique `idempotency_key`.
  - `plan_limits` is key/value: `plan_limits(plan, key, value jsonb, updated_by, updated_at)` (R-22). It is seeded with one `(plan, key)` row per canonical key for `free` and `pro`: `max_mail_accounts`, `max_calendars`, `ai_daily_budget_units` (Free 50, shown as "AI analiz limiti 50/gün"; Pro shows "Adil kullanım"), `ai_soft_cap_usd_day` ($0.02 / $0.20), `ai_hard_cap_usd_day` ($0.03 / $0.60), `ai_hard_cap_usd_month` (Pro $6), `ai_routing_profile` (`lean` / `balanced`) and the M§44 feature booleans. Exact seed values are in DATABASE_AND_RLS_PLAN §4.6.
  - `referral_codes` has one code per user.
  - `referrals` has `status` (`referral_status`: `pending | qualified | rewarded | rejected | flagged`), `risk_score` and `signals`.
  - `referral_credits` is unique on `(referral_id, side)`.
- **Acceptance:** The seed rows exist, and the uniques hold.
- **Satisfies:** M§43, M§44, M§45, M§116.

#### T-2.12 · Migration 0010: ops and product
- **Depends:** T-2.11
- **Files:** `supabase/migrations/20260924001000_ops_product.sql`
- **Contents:**
  - `jobs` columns (names per DATABASE_AND_RLS_PLAN §4.7): `type`, `status`, `payload`, a unique `idempotency_key`, `run_after`, `priority`, `attempts`, `max_attempts`, `lease_owner`, `lease_expires_at`, `progress`, `result`, `last_error_code`, `parent_job_id`, `correlation_id` and `user_id`.
  - `job_attempts` records one row per attempt.
  - `analytics_events` stores only an allow-listed name and typed props.
  - Feature flags:
    - `feature_flags` (columns per DATABASE_AND_RLS_PLAN §4.7) carries the kill-switch marker, targeting (global, percentage, platform, plan, version) and `payload`.
    - `feature_flag_overrides` holds per-flag overrides.
    - Seeded keys, exactly the R-10 set: the product flags `feature.midday`, `feature.evening`, `feature.voice`, `feature.meeting_prep`, `feature.capture`, `feature.android_ni`, `feature.weekly_review` and `feature.new_ai_model`; the AI switches `ai.global.enabled`, `ai.provider.{anthropic,openai,voyage}.enabled`, `ai.feature.<ai_feature>` for every `ai_feature` value plus `ai.feature.briefing_polish` (R-05), `ai.model.large.enabled`, `ai.model.opus_escalation`, `ai.batch.enabled`, `ai.backfill.enabled` and `ai.budget.org_daily_usd`; and the voice switches `voice.stt_server` and `voice.tts_premium`.
  - `announcements` and `announcement_dismissals`.
  - `user_feedback`.
  - `system_health_checks` (`status`: `healthy | degraded | down | external_credential_required | unknown`).
  - `rate_limits`.
  - `api_idempotency_keys` (the HTTP `Idempotency-Key` store; columns per API_CONTRACTS §2.11), `app_settings` (system configuration such as the admin session limits), `web_analytics_daily` (aggregated public-web events with no user id) and `private.demo_fixture_state` (demo adapter writes, used only when `DEMO_MODE` is on). All four are system tables: RLS on, no client policies.
- **Acceptance:** The seeded flags are present.
- **Satisfies:** M§53, M§63, M§64, M§67, M§127.

#### T-2.13 · Migration 0011: privacy
- **Depends:** T-2.12
- **Files:** `supabase/migrations/20260924001100_privacy.sql`
- **Contents:**
  - `data_export_requests` has `status` (`export_status`: `requested | processing | ready | expired | failed | cancelled`), `storage_paths`, `size_bytes`, `expires_at` and `download_count`.
  - `data_deletion_requests` has:
    - `kind` (`history | account`), `status` (`deletion_status`: `requested | verified | queued | processing | completed | failed | cancelled`), `scope`, `connected_account_id`, `source` (`app | web`), `steps jsonb` and `subject_hash`;
    - a nullable `user_id` with no cascade, so the request row survives the user's deletion.
  - `privacy_tombstones` keeps hashed anti-abuse signals for 12 months after an account deletion (system table; read by referral anti-abuse).
- **Acceptance:** The request row survives deletion of its user.
- **Satisfies:** M§41, M§65, M§128, M§129.

#### T-2.14 · Migration 0012: admin and audit
- **Depends:** T-2.13, T-1.14
- **Files:** `supabase/migrations/20260924001200_admin_audit.sql`
- **Contents:**
  - `admin_users` has `role`, `status` (enum `admin_status`: `invited | active | disabled`), `invite` fields, `last_login_at` and `locked_until`.
  - `admin_sessions` has `auth_session_id`, `last_activity_at`, `absolute_expires_at`, `step_up_at`, `ended_at` and `end_reason`.
  - `admin_preferences` stores `theme`, `locale`, `table_prefs` and `dashboard_range`.
  - `audit_logs` has `actor_type`, `actor_role`, `action`, `target`, `reason`, `result`, `correlation_id`, `ip_hash`, `prev_hash` and `row_hash`.
    - It is append-only: no UPDATE or DELETE grants, a trigger that rejects both, and a hash chain.
  - `support_tickets` (with a display number `DA-{n}`), `support_notes` and `support_access_grants` (R-09): scope `support_access_scope[]` (`pii | email_metadata | insights | notifications | captures | assistant_transcript | ai_feedback`), reason, start, an expiry 15, 30 or 60 minutes after the start (never more), and revoke.
  - `private.admin_role_permissions` is seeded from the T-1.14 matrix.
  - A constraint trigger prevents disabling or demoting the last active `super_admin`.
  - `admin_mfa_recovery_codes`.
- **Acceptance:**
  - An update on `audit_logs` raises an error.
  - Disabling the last super_admin raises an error.
- **Satisfies:** M§47, M§48, M§49, M§62, M§66, M§68.

#### T-2.15 · Migration 0013a: private helper functions
- **Depends:** T-2.14
- **Files:** `supabase/migrations/20260924001300_functions_private.sql`
- **Contents:** Every function is `security definer` with `set search_path=''` and `revoke execute from public`.
  - Auth and access:
    - `require_admin(permission)` checks `aal2`, an active admin, the session's idle and absolute limits, and the permission.
    - `custom_access_token_hook`.
  - Jobs and approvals:
    - `transition_approval(p_id, p_to, p_actor, p_actor_id, p_idempotency_key, p_reason, p_result, p_error_code, p_error_message)` and `edit_approval_payload` (DATABASE_AND_RLS_PLAN §6.6).
    - The job functions of DATABASE_AND_RLS_PLAN §6.2, executable by `service_role` only: `public.enqueue_job` (wrapping `private.enqueue_job`; `on conflict (idempotency_key) do nothing`, returns the job id), `public.claim_jobs(p_worker_id, p_types, p_limit, p_lease_seconds)` with `FOR UPDATE SKIP LOCKED`, `public.extend_job_lease`, `public.complete_job`, `public.fail_job` (backoff, then `dead_letter`) and `public.update_job_progress`; plus `private.reap_expired_leases` and `private.poke_worker`.
  - Rate limits, entitlements and flags:
    - `public.rate_limit_hit(p_key text, p_limit int, p_window_seconds int)` (service_role only).
    - `is_pro(p_user)` and `plan_limit(p_user, p_key)`. `public.effective_entitlement` lives in `public` (T-2.16).
    - `evaluate_flags(p_user, p_platform, p_app_version)`. There is no separate `flag_enabled` helper.
  - Audit and masking:
    - `audit_log_append(...)` (hash chain under an advisory lock) and `audit_verify_chain(p_from, p_to)`.
    - `mask_email` returns `yu***@gmail.com`; `mask_name` and `mask_push_token` mask names and push tokens.
  - Other helpers:
    - `set_expires_at` derives `expires_at` from the retention policy.
    - `consume_provider_quota`, `try_lock_credential_refresh`, `enforce_calendar_selection_limit`, `user_apple_sub`, `assert_admin_gateway`, `ai_breaker_state`, `memory_stats`, `job_admin_policy`.
    - `ai_budget_reserve` and `ai_budget_settle`.
    - `fail_stale_device_approvals` and `pseudonymize_audit_subject`. Approval expiry has no separate helper: it is step 9 of `scheduler_tick` (T-2.18).
- **Acceptance:** Covered by the T-2.23 suites.
- **Satisfies:** M§33, M§47, M§71, M§79, M§82, M§127.

#### T-2.16 · Migration 0013b: public RPCs and views
- **Depends:** T-2.15
- **Files:** `supabase/migrations/20260924001310_functions_public_rpcs.sql`
- **Contents:** Names and signatures follow API_CONTRACTS §15 (RPC-01…RPC-19) and DATABASE_AND_RLS_PLAN §6.9 (R-20). All are `security invoker` unless noted.
  - `public.effective_entitlement(p_user_id uuid default auth.uid())` (RPC-15; SD) returns the caller's entitlement and raises `FORBIDDEN` for another user's id.
  - Insight and commitment state:
    - `set_insight_status` (RPC-01).
    - `apply_insight_feedback` and `revert_insight_feedback` (kept by R-24): apply or revert a feedback-driven status change together with its `ai_feedback` row.
    - `set_commitment_status` (RPC-06).
  - Screen data:
    - `today_overview(p_local_date)` (RPC-04) and `flow_feed(p_filter, p_cursor, p_limit)` (RPC-05), whose response carries `meta` (totals, the last analysis time and account states). There is no separate `flow_meta` RPC.
    - `mail_intelligence` (RPC-08, with `p_account_id`), `plan_range(p_from, p_to)` (RPC-09), `plan_week_density(p_week_start)` (RPC-18) and `list_approvals` (RPC-10).
    - `person_intelligence(p_contact_id)` (RPC-03; Pro-only sections arrive under `locked_sections` for Free users), `vip_suggestions` (RPC-13) and `upsert_manual_contact(p_email, p_display_name)` (R-24).
    - `get_explanation(p_target_type, p_target_id)` (RPC-16).
  - Search and corrections:
    - `search_user_content(p_query, p_query_embedding vector(1024), p_types, p_from, p_to, p_contact_id, p_cursor, p_limit)` (RPC-02) does RRF with k=60. Its vector leg takes the HNSW top results for the caller; when HNSW under-fills (the pgvector 0.6 post-filter), it falls back to an exact KNN over the user's rows in a `MATERIALIZED` CTE filtered by `user_id` and `expires_at`. It then fuses with FTS.
    - `submit_ai_correction` (RPC-17; SD with an owner check) and `preview_priority_rule(p_condition_type, p_condition_value, p_outcome)` (RPC-11).
  - Privacy: `history_deletion_preview(p_older_than)` (RPC-19) returns the counts shown before a history deletion.
  - Misc: `mark_briefing_opened` (RPC-07), `dismiss_announcement` (RPC-14) and `get_usage_summary` (RPC-12).
- **Acceptance:** User A calling any RPC never sees rows belonging to user B.
- **Satisfies:** M§8, M§13, M§14, M§26, M§30, M§95, M§131, M§151.

#### T-2.17 · Migration 0013c: `admin_api` functions
- **Depends:** T-2.16
- **Files:** `supabase/migrations/20260924001320_functions_admin_api.sql`
- **Contents:**
  - Function names follow DATABASE_AND_RLS_PLAN §6.10 (R-20). Each `<permission>` string is from the BACKOFFICE_PLAN §4.1 catalogue:

    | Area | Functions |
    |---|---|
    | Gateway and context (BACKOFFICE_PLAN §2.6) | `ctx`, `authorize`, `audit_write`, `audit_denied` |
    | Dashboard and metrics | `dashboard_metrics`, `dashboard_series`, `metrics_ops`, `metrics_product` |
    | Users | `users_list`, `user_overview`, `user_integrations`, `user_briefings`, `user_usage`, `user_subscription`, `user_referrals`, `user_support`, `user_audit`, `user_reveal_email`, `user_force_sync`, `user_disable`, `user_restore` |
    | Support | `tickets_list`, `ticket_detail`, `ticket_update`, `ticket_add_note`, `support_access_grant`, `support_access_revoke`, `support_access_authorize` |
    | Integrations | `integrations_overview`, `integration_detail`, `integration_disconnect` |
    | Jobs | `jobs_list`, `job_detail`, `job_retry`, `job_retry_bulk`, `job_cancel`, `correlation_trace` |
    | Briefings and notifications | `briefings_metrics`, `briefings_list`, `briefing_regenerate`, `notifications_metrics`, `notifications_user_debug`, `notification_send_test` |
    | AI | `ai_metrics`, `ai_cost_series`, `ai_model_config_list`, `ai_model_config_update`, `prompts_list`, `prompt_versions_list`, `prompt_diff`, `prompt_create_draft`, `prompt_update_draft`, `prompt_activate`, `prompt_rollback`, `prompt_archive`, `ai_feedback_aggregate`, `ai_feedback_list` |
    | Business | `subscriptions_metrics`, `subscriptions_list`, `billing_events_list`, `entitlement_grant`, `entitlement_revoke`, `referrals_metrics`, `referrals_list`, `referral_review` |
    | Product | `feedback_list`, `feedback_update`, `flags_list`, `flag_upsert`, `flag_kill`, `flag_override_set`, `flag_override_delete`, `announcements_list`, `announcement_upsert`, `announcement_publish`, `announcement_cancel` |
    | Privacy and audit | `data_requests_list`, `data_request_retry`, `data_request_cancel`, `audit_list`, `audit_verify` |
    | System | `health_latest`, `health_history`, `health_record` (service_role only, written by the `health` function), `app_versions_breakdown`, `admins_list`, `admin_invite_record`, `admin_update_role`, `admin_disable`, `admin_enable`, `admin_sessions_revoke_all`, `admin_me`, `admin_session_start`, `admin_session_end`, `admin_preferences_get`, `admin_preferences_set`, `plan_limits_list`, `plan_limits_update`, `command_search` |

  - Every function:
    - starts with `perform private.require_admin('<permission>')`;
    - calls `private.assert_admin_gateway()`;
    - returns masked PII;
    - writes an audit row for each mutation.
  - Paginated functions use keyset pagination with sort and filter parameters.
- **Acceptance:**
  - An `aal1` caller and a non-admin caller are both rejected.
  - Each role gets exactly its matrix permissions.
- **Satisfies:** M§46–M§72, M§148, M§151.

#### T-2.18 · Migration 0013d: scheduler and job SQL
- **Depends:** T-2.17
- **Files:** `supabase/migrations/20260924001330_scheduler_jobs.sql`
- **Contents:**
  - `private.scheduler_tick(p_now timestamptz default now())` runs set-based inserts. Each insert uses an idempotency key and `on conflict do nothing`, and local time is evaluated with `AT TIME ZONE user_preferences.timezone`.
  - Briefing jobs, keyed `briefing:{user}:{kind}:{local_date}`:
    - Morning, midday and evening each run 10 minutes before their configured time.
    - Silent days and weekend preferences are respected.
    - Midday and evening only run for Pro users (`private.is_pro`); the worker marks non-entitled rows `skipped` with `skipped_reason='not_entitled'`.
    - Weekly runs on Sunday: the batch is submitted at 12:00 and the sync fallback runs at 17:30.
  - Meeting-related jobs:
    - `meeting_prep` at T−60 for external or VIP meetings (Pro only).
    - A meeting `notification` at T−30…T−15.
    - A post-meeting prompt at event end + 1 minute.
  - Deadline and follow-up nudges.
  - Maintenance jobs:
    - `watch_renewal` when a Google watch expires in under 24 h or a Graph subscription in under 48 h.
    - `tasks_sync` every 15 minutes.
    - Approval expiry is step 9 of the tick: `pending` rows past `approval_expires_at` move to `expired` through `private.transition_approval`. There is no separate `expire_approvals` helper.
    - Accounts still `connecting` 10 minutes after their OAuth callback, because `POST /integrations/oauth/complete` never arrived, are revoked and purged (R-07).
    - Metrics rollups (`private.rollup_metrics_daily`, T-10.05) run inside the tick, idempotently per UTC day.
    - `pending` referrals whose referee now qualifies are swept into `referral_evaluate`.
    - `reconciliation` (every 6 hours; the 00:07 UTC run also enqueues `credential_reencrypt`), `push_receipts` and `health_check` (every 5 minutes), `retention` (daily) and the nightly `billing_sync` reconciliation are enqueued by their own cron jobs (T-2.20), not by the tick. The nightly AI cost reconciliation is a `reconciliation` job with `payload.scope='ai_cost'`.
  - `private.poke_worker(p_reason)` calls `net.http_post` to `{vault da_project_url}/functions/v1/worker/run` with the `da_cron_secret` header, and only when due jobs exist.
- **Acceptance:**
  - The pgTAP scheduler suite passes, including a DST boundary fixture.
  - Running the tick twice enqueues nothing new.
- **Satisfies:** M§96, M§111, M§127.

#### T-2.19 · Migration 0014: RLS policies and grants
- **Depends:** T-2.18
- **Files:** `supabase/migrations/20260924001400_rls_policies_grants.sql`
- **Contents:**
  - Every table gets `enable` and `force row level security`.
  - Owner policies are written as `(select auth.uid()) = user_id` for select, insert, update and delete, but only where the client is allowed to act.
  - Column-level `grant update(…)` covers only user-editable columns, such as preferences, rule fields, and `vip_people` insert/delete (with a check that the user is Pro).
  - System and global tables get no `anon` or `authenticated` policies.
  - A restrictive policy requires `aal2` on the `admin_api` paths.
  - `revoke all on all tables in schema public from anon`.
  - `grant execute` is limited to the listed public RPCs.
- **Acceptance:** The T-2.22 suites pass.
- **Satisfies:** M§79, M§151.

#### T-2.20 · Migration 0015: cron schedules
- **Depends:** T-2.19
- **Files:** `supabase/migrations/20260924001500_cron_schedules.sql`
- **Contents:**
  - The schedules are the DATABASE_AND_RLS_PLAN §9 set, in UTC, created inside a guard that checks `pg_cron` exists. Existing `da_*` jobs are unscheduled first, so the migration is idempotent:

    | Job | Schedule | Command |
    |---|---|---|
    | `da_scheduler_tick` | `* * * * *` | `private.scheduler_tick()` |
    | `da_worker_poke` | `15 seconds` | `private.poke_worker('cron')` |
    | `da_push_receipts` | `*/5 * * * *` | enqueue `push_receipts` |
    | `da_health_check` | `*/5 * * * *` | enqueue `health_check` |
    | `da_reconciliation` | `7 */6 * * *` | enqueue `reconciliation` per healthy account; the 00:07 run also enqueues `credential_reencrypt` |
    | `da_retention` | `30 2 * * *` | enqueue `retention` |
    | `da_billing_reconcile` | `45 3 * * *` | enqueue `billing_sync` for stale mirrors |
    | `da_cron_housekeeping` | `15 3 * * *` | prune `cron.job_run_details` and `net._http_response` |

    Metrics rollups run inside `scheduler_tick`, not as a separate cron job.
  - Vault secret names are `da_project_url` and `da_cron_secret`. Setting their values is a **Manual external step**, done in the deploy job.
  - That is 8 jobs, within Supabase's limit of 8 concurrent jobs; each runs in under 1 s.
- **Acceptance:**
  - `cron.job` lists exactly the 8 `da_*` jobs on tier A.
  - The migration applies cleanly on tier C.
- **Satisfies:** M§96, M§109.

#### T-2.21 · Migration 0016: storage buckets and policies
- **Depends:** T-2.20
- **Files:** `supabase/migrations/20260924001600_storage.sql`
- **Contents:**
  - Private buckets:
    - `captures`: 20 MiB, MIME allow-list of images, PDF and text.
    - `exports`: 500 MiB.
    - `briefing-audio`: 25 MiB.
  - Each bucket has a policy of the form `(storage.foldername(name))[1] = auth.uid()::text`. The `exports` bucket is read-only, and only the service role writes to it.
- **Acceptance:** A user cannot read another user's folder.
- **Satisfies:** M§85, M§128.

#### T-2.22 · pgTAP suites: isolation, grants and storage
- **Depends:** T-2.21
- **Files:** the DATABASE_AND_RLS_PLAN §13 inventory: `supabase/tests/database/000_helpers.sql` (`tests.create_user`, `tests.authenticate_as(uuid, aal, session)`, `tests.authenticate_as_admin(uuid, role, aal)`, `tests.as_anon()`, `tests.as_service_role()`, `tests.rls_isolation(table, owner_insert_sql)`) and `supabase/tests/database/{001_global_invariants,010_identity,011_devices,020_integrations,030_content_mail,031_calendar_tasks,032_commitments_reminders,033_meetings,034_contacts_vip,035_life_captures_ni,040_rules_prefs,041_insights_briefings,042_reply_drafts,060_assistant_memory,061_ai_telemetry,070_notifications,100_ops_product,110_privacy,130_storage,150_column_grants}.test.sql`
- **Contents:**
  - Every public table has RLS forced.
  - Every non-system table has a `user_id`.
  - Owner CRUD is allowed.
  - A foreign `user_id` insert is rejected, and another user sees 0 rows.
  - Anon is denied.
  - System tables are invisible to clients.
  - Only the granted columns are updatable.
  - The Realtime publication stays empty (R-19): `pg_publication_tables` has no row for `supabase_realtime` on tier A, and no publication includes a `public` table on tier C.
- **Commands:** `C-DB`
- **Acceptance:** All green on tier C and tier A.
- **Satisfies:** M§79, M§101.

#### T-2.23 · pgTAP suites: state machines, functions, admin, audit, scheduler
- **Depends:** T-2.22
- **Files:** `supabase/tests/database/{050_approvals,080_business,090_jobs,090b_jobs_concurrency,091_scheduler_dst,092_rate_limits,120_admin_rbac,121_audit_chain,122_admin_users_guard,123_support_access,140_cron}.test.sql` (DATABASE_AND_RLS_PLAN §13; `090b` runs on tier A only)
- **Contents:**
  - Approvals: legal and illegal transitions exactly as spine §5 (R-06), an edit gets a new key, and `approved_via` accepts only the R-03 values.
  - Jobs:
    - Concurrent claims simulated with `SKIP LOCKED`.
    - Backoff, dead-letter handling and reclaiming after lease expiry.
  - Admin access: `aal1` is rejected, the permission matrix holds, and the last super_admin is protected. Support Access grants longer than 60 minutes or outside the R-09 scopes are rejected.
  - Audit: records are immutable and the hash chain verifies.
  - Scheduler: DST handling and idempotency.
  - Entitlements: `effective_entitlement` stacking.
  - Referrals: credits are idempotent.
  - Search (in `060_assistant_memory`): `search_user_content` RRF results are scoped to the user and respect `expires_at`.
  - Cron: exactly the 8 `da_*` jobs exist (`140_cron`, skipped when `pg_cron` is absent).
- **Commands:** `C-DB`
- **Acceptance:** All green.
- **Satisfies:** M§33, M§53, M§66, M§96, M§101, M§116.

#### T-2.24 · Demo seed tooling
- **Depends:** T-2.23
- **Files:** `supabase/seed/demo/seed-demo.ts`, `supabase/seed/demo/README.md`. The fixtures themselves live in T-4.10.
- **Contents:**
  - The script refuses to run when `APP_ENV=production` and `ALLOW_DEMO_IN_PRODUCTION!=='true'`.
  - It creates demo auth users through the Auth Admin API against the local stack, and sets `profiles.is_demo=true`.
  - It creates `connected_accounts(provider='demo')` and enqueues `initial_sync`, so the full pipeline produces the demo data.
  - Demo users are excluded from metrics and referrals.
- **Commands:** `pnpm db:seed:demo` on tier A.
- **Acceptance:**
  - A seeded demo user reaches a morning briefing through the real pipeline, using the fixture LLM.
  - The production guard throws.
- **Satisfies:** M§89, M§100.

#### T-2.25 · Type generation and drift checks
- **Depends:** T-2.23, T-1.17
- **Files:** `scripts/db/gen-types.ts`, `packages/api-client/src/database.types.ts`, `packages/domain/test/enum-parity.test.ts`
- **Contents:**
  - On tier C, types come from `PG_META_GENERATE_TYPES=typescript` and postgres-meta 0.99.0 for schemas `public` and `admin_api`.
  - On tier A, they come from `supabase gen types typescript --local`.
  - A parity test asserts that `@da/domain` enums equal `Database['public']['Enums']`.
- **Commands:** `pnpm db:types && git diff --exit-code`
- **Acceptance:** No drift between the generated types and the committed file.
- **Satisfies:** M§7, M§77.

#### T-2.26 · Migration lint and reset-from-zero
- **Depends:** T-2.25
- **Files:** `supabase/.squawk.toml`, `scripts/db/lint-migrations.sh`
- **Contents:**
  - Squawk runs with a documented list of excluded rules.
  - The database is reset from zero twice to prove idempotent seeds.
  - `supabase db lint` must return no errors (tier A).
- **Commands:** `pnpm db:lint`, `bash scripts/db/reset-twice.sh`
- **Acceptance:** Both are clean.
- **Satisfies:** M§78, M§105.

### Step 3 — Edge core

#### T-3.01 · Function layout and import maps
- **Depends:** T-1.16, T-2.01
- **Files:**
  - `supabase/functions/deno.json`
  - `supabase/functions/import_map.base.json`
  - `scripts/functions/sync-import-maps.ts`
  - `supabase/functions/{api,oauth,webhooks-google,webhooks-microsoft,webhooks-revenuecat,worker,admin-api,public-api,health}/{index.ts,deno.json}`
- **Contents:** Each function has a generated `deno.json` import map with these entries:

  | Import | Target |
  |---|---|
  | `@da/domain` | `../../../packages/domain/src/index.ts` |
  | `@da/validation` | `../../../packages/validation/src/index.ts` |
  | `hono` | `jsr:@hono/hono@4.13.8` |
  | `@supabase/supabase-js` | `npm:@supabase/supabase-js@2.117.1` |
  | `zod` | `npm:zod@4.6.5` |
  | `date-fns`, `@date-fns/tz` | npm, same versions as the rest of the repo |
  | `@anthropic-ai/sdk` | `npm:@anthropic-ai/sdk@0.128.0` |
  | `openai` | `npm:openai@7.23.0` |
  | `jose` | `npm:jose@6.2.12` |
  | `@std/assert` | `jsr:@std/assert@1.0.19` |
  | `@std/testing` | `jsr:@std/testing@1.0.20` |
  | `fflate`, `htmlparser2`, `@mozilla/readability`, `linkedom`, `unpdf` | versions verified at install time |

  Every function's `index.ts` calls `Deno.serve(app.fetch)`, with Hono's `basePath` set to `/<fn>`.
- **Commands:** `C-FN`
- **Acceptance:**
  - `deno check` passes for all 9 entrypoints.
  - The generated maps show no drift.
- **Satisfies:** M§6, M§7.

#### T-3.02 · `_shared` core: env, errors, HTTP, logging, Sentry
- **Depends:** T-3.01
- **Files:** `supabase/functions/_shared/{env,config,errors}.ts`, `_shared/http/app.ts`, `_shared/logging/logger.ts`, `_shared/observability/sentry.ts`, and a colocated `*.test.ts` for each
- **Contents:**
  - **Env:** the server env schema is parsed per function. `credentialStatus(name)` reports `configured` or `external_credential_required`.
  - **Hono factory:**
    - Middleware: correlation ID, request log, 1 MB body limit, and CORS (only on `public-api`, only for the web origin).
    - The error handler turns errors into the standard envelope.
  - **Logger:** JSON with these fields: `ts`, `level` (`debug`/`info`/`warn`/`error`), `fn`, `correlation_id`, `job_id`, `user_hash`. A scrubber removes emails, bearer tokens and keys. Message bodies are never logged.
  - **Sentry:** a fetch-based envelope adapter. It is a no-op when no DSN is set.
- **Commands:** `C-FN`
- **Acceptance:**
  - A scrubber test proves that no email address or token reaches the output.
  - The envelope shape matches `@da/validation`.
- **Satisfies:** M§90, M§118, M§126, M§152.

#### T-3.03 · `_shared` auth, DB clients, rate limiting, idempotency
- **Depends:** T-3.02, T-2.19
- **Files:** `_shared/auth/{user,secret,admin}.ts`, `_shared/db/clients.ts`, `_shared/ratelimit.ts`, `_shared/idempotency.ts`, tests
- **Contents:**
  - **User auth:** the user JWT is verified with `getClaims()` (a JWKS/`jose` fallback), yielding `{userId, aal, sessionId}`. Admin identities are rejected with `admin_identity`, and disabled accounts with `account_disabled`.
  - **Secret auth:** the secret-key check uses a constant-time compare against `CRON_SECRET`.
  - **Admin auth:** `aal2`, then `admin_api.authorize` through the gateway header.
  - **DB clients:**
    - `userClient(jwt)` runs under RLS.
    - `serviceClient()` is restricted by lint rule to allow-listed modules.
  - **Rate limiting:** per-route classes via `public.rate_limit_hit(p_key, p_limit, p_window_seconds)` (service_role only).
  - **Idempotency:** the HTTP `Idempotency-Key` store (`api_idempotency_keys`) replays the stored response.
- **Commands:** `C-FN`
- **Acceptance:**
  - Forged, expired and `aal1` tokens are rejected where they should be.
  - A replayed key returns the original response and causes no second DB write.
- **Satisfies:** M§48, M§79, M§82, M§88, M§94.

#### T-3.04 · `_shared` crypto
- **Depends:** T-3.02
- **Files:** `_shared/crypto/{token-cipher,hmac,hash,pkce,jwt-sign}.ts`, tests
- **Contents:**
  - **Token cipher:** AES-256-GCM through WebCrypto with a 96-bit IV. The AAD is `${account}|${provider}|${kind}`. `encrypt()` uses `TOKEN_ENC_ACTIVE_VERSION`; `decrypt()` accepts any `TOKEN_ENC_KEY_V{n}`.
  - **HMAC:** HMAC-SHA256 plus `timingSafeEqual`.
  - **Hashing:** a peppered hash (`HASH_PEPPER`) for PII lookups.
  - **PKCE:** S256.
  - **JWT signing:** ES256 for the Apple client secret and RS256/PS256 with `x5t#S256` for the Microsoft client assertion.
  - **Key rotation:** a `credential_reencrypt` job re-encrypts ciphertext to the active key version.
- **Commands:** `C-FN`
- **Acceptance:**
  - Round-trip works.
  - Decryption fails on AAD mismatch.
  - Old key versions still decrypt.
- **Satisfies:** M§76, M§87, M§152.

#### T-3.05 · `_shared` security: SSRF fetcher, upload validation, sanitizer, untrusted wrapper
- **Depends:** T-3.02, T-1.15
- **Files:** `_shared/security/{ssrf-fetch,upload-validate,html-sanitize}.ts`, `_shared/ai/untrusted.ts`, tests with a fixture matrix
- **Contents:**
  - **SSRF fetcher:**
    - `https:` only; `http:` is rejected and never upgraded (R-11).
    - On every hop, `Deno.resolveDns` A/AAAA results are checked against `@da/domain` ip-ranges.
    - Redirects are followed manually, up to 3.
    - Responses are streamed with a 5 MB cap and a 10 s `AbortSignal`.
    - Allowed content types: HTML, XHTML, plain text, PDF and images.
    - No cookies or auth headers are sent; the User-Agent is `DijitalAsistanBot/1.0`.
    - The residual DNS-rebinding window is documented in SECURITY.
  - **Upload validation:** size, MIME, extension and magic-byte checks (`%PDF`, JPEG `FFD8FF`, PNG, HEIC `ftyp`, WEBP `RIFF`). Executables, archives and SVG are rejected.
  - **HTML sanitizer:** based on htmlparser2 with an allow-list. Scripts, styles and remote images are removed, and links are rewritten to go through `LinkConfirmSheet`.
  - **Untrusted wrapper:** external text is wrapped in `<untrusted_content id=…>` blocks with the delimiters escaped.
- **Commands:** `C-FN`
- **Acceptance:** Each of these is blocked:
  - `127.0.0.1`, `10.0.0.1`, `169.254.169.254`, `[::1]`, `fd00::1`, `0.0.0.0`, and the decimal form `2130706433`;
  - a redirect to a private address, `file://` and `gopher://`;
  - a bad magic number.
- **Satisfies:** M§84, M§85, M§114.

#### T-3.06 · `_shared` jobs and the `worker` function
- **Depends:** T-3.03, T-2.18
- **Files:** `_shared/jobs/{client,runner,types,registry}.ts`, `worker/index.ts`, `worker/handlers/index.ts`, tests
- **Contents:**
  - **Enqueueing:** `enqueueJob()` calls `private.enqueue_job`, and `pokeWorker()` wakes the worker.
  - **Runner:**
    - `claim_jobs` with a 120 s lease.
    - A wall-clock budget: it stops claiming new work at 110 s.
    - Each job has its own timeout from the registry.
    - Retries use exponential backoff with full jitter (base 30 s, cap 1 h). After `max_attempts` a job goes to `dead_letter`.
    - Every attempt is recorded in `job_attempts`, and the correlation ID is propagated.
  - **`worker` endpoint:** `POST /worker/run {types?, limit?}` requires the secret key. Handlers are registered by later tasks.
  - The scheduler SQL comes from T-2.18.
- **Commands:** `C-FN`
- **Acceptance:**
  - A fake handler proves the retry, dead-letter and lease-reclaim behaviour.
  - A duplicate enqueue produces no second job.
- **Satisfies:** M§53, M§96, M§127.

#### T-3.07 · `health` function and probes
- **Depends:** T-3.06
- **Files:** `health/index.ts`, `health/probes/{api,database,auth,storage,cron,webhooks,push,ai,google_oauth,microsoft_oauth,gmail,graph,revenuecat,email_delivery,audit_chain}.ts`, tests
- **Contents:**
  - `GET /health/live` answers 200.
  - `POST /health/run` (secret key or admin) runs every probe and writes `system_health_checks` rows with one of these statuses: `healthy`, `degraded`, `down`, `external_credential_required`, `unknown`.
  - What the probes check:
    - database latency and migration version;
    - the last `cron.job_run_details` entry is less than 2 minutes old;
    - webhook failure ratio;
    - provider metadata endpoints and credential presence;
    - the last-hour AI error rate.
  - Probes never report a fake green: a missing credential is always `external_credential_required`.
- **Commands:** `C-FN`
- **Acceptance:** With no credentials, provider probes return `external_credential_required`, not `healthy`.
- **Satisfies:** M§67, M§90, M§110.

#### T-3.08 · `_shared` providers bridge and demo guard
- **Depends:** T-3.04, T-1.15
- **Files:** `_shared/providers/{registry,http,errors}.ts`, `_shared/providers/demo/guard.ts`, tests
- **Contents:**
  - The registry resolves an adapter by `provider`.
  - The HTTP wrapper:
    - retries 5xx with backoff and honors `Retry-After` on 429;
    - consumes provider quota;
    - maps errors to `account_status`.
  - The demo guard throws at module init when `DEMO_MODE` is on in production without the allowance. System Health then reports "Demo modu üretimde yasak".
- **Commands:** `C-FN`
- **Acceptance:** The guard test passes.
- **Satisfies:** M§75, M§89, M§117.

#### T-3.09 · `_shared/ai` core and the fixture provider
- **Depends:** T-3.06, T-1.13, T-1.16
- **Files:** `_shared/ai/{types,router,budget,retry,errors,telemetry,pricing,cache,output-validators}.ts`, `_shared/ai/prompts/registry.ts`, `_shared/ai/providers/fixture.ts`, `_shared/ai/fixtures/*.json`, tests
- **Contents:**
  - **Provider interface:** `LLMProvider` exposes `generateStructured`, `stream`, `embed`, `transcribe` and `synthesize`.
  - **Router:**
    - Resolves `ai_model_config` by `(profile, feature)`, with the profile taken from `plan_limits.ai_routing_profile`.
    - Applies kill-switch flags.
    - Falls back along the chain in A8.
  - **Budget:** reserves before a call and settles after. When exhausted it returns `ai_budget_exhausted` and degrades to T0.
  - **Cache:** `ai_result_cache` keyed by `(user_id, feature, content_hash, prompt_version_id)`, where `content_hash` is a per-user HMAC derived from `AI_HASH_PEPPER` (R-02).
  - **Telemetry:** one `ai_requests` row per attempt, with no content.
  - **Prompts:** active `prompt_versions` are cached for 60 s.
  - **Fixture provider:** deterministic, keyed by prompt and input hash. It is enabled only when `AI_FIXTURE_PROVIDER_ENABLED=true` and the environment is not production (or the demo allowance is on).
- **Commands:** `C-FN`
- **Acceptance:**
  - The router follows its config.
  - A kill switch forces the fallback.
  - The keys of every inserted telemetry row are asserted to contain no content fields.
- **Satisfies:** M§57, M§58, M§81, M§82.

#### T-3.10 · AI provider adapters
- **Depends:** T-3.09
- **Files:** `_shared/ai/providers/{anthropic,openai,voyage,deepgram,openai-audio,azure-tts,elevenlabs}.ts`, `__fixtures__/*.json`, tests
- **Contents:**
  - **Anthropic** (models come only from `ai_model_config`; the seeds `claude-haiku-4-5-20251001`, `claude-sonnet-5` and `claude-opus-5-5` live in the T-5.16 seed migration):
    - Structured output via `messages.parse` and `zodOutputFormat` (`output_config.format`).
    - Cache breakpoints. Model-specific request rules (no sampling parameters and no prefill where a model forbids them, no `effort` where it is unsupported, a minimum cache-prefix length) are keyed by capability flags stored per model in `ai_model_prices` and the `ai_model_config` target params, never by model-ID literals in adapter code. The AI_PIPELINE_PLAN §3.7 CI grep for `claude-` / `gpt-` / `voyage-` literals outside seeds, evals and adapter tests stays clean.
    - Streaming uses `search_result` citations.
    - A client for Message Batches.
  - **OpenAI:**
    - Strict `json_schema` output for the configured fallback models (seeded as `gpt-5.6-luna` and `gpt-5.6-terra`).
    - `gpt-transcribe` and `gpt-4o-mini-tts`.
    - `text-embedding-3-small` with `dimensions:1024` for disaster recovery.
  - **Voyage:** `voyage-4` for documents and `voyage-4-lite` for queries, both 1024-d.
  - **Premium audio** (behind flags): Deepgram, Azure TTS and ElevenLabs.
  - **External credential required:** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `VOYAGE_API_KEY`, and the premium voice keys.
- **Commands:** `C-FN`
- **Acceptance:**
  - Request-shape assertions pass for each model rule.
  - Errors are normalized.
  - No test makes a network call.
- **Satisfies:** M§25, M§26, M§81.

#### T-3.11 · `api` function skeleton and core routes
- **Depends:** T-3.03, T-3.04
- **Files:** `api/{index,app}.ts`, `api/routes/{devices,me,analytics,support,auth-apple}.ts`, `_shared/services/{bootstrap,devices}.ts`, tests
- **Contents:**
  - **Middleware order:** correlation ID, user auth, disabled check, rate limit, zod validation, handler, response envelope.
  - **Devices:** `POST /devices/register|unregister` upserts `app_installations` and `push_tokens`.
  - **Bootstrap and entitlements:**
    - `GET /me/bootstrap` returns profile, preferences, effective entitlement, evaluated flags, counts, active announcements (the R-25 Today banner), `min_supported_version`, `server_now`, `ai_units_remaining_today` and credential statuses.
    - `GET /me/entitlements`.
  - **Analytics:** `POST /analytics/events` takes batches of up to 50 events and drops anything not on the allow-list. The user's `analytics_opt_out` is respected.
  - **Support and feedback:** `POST /support/tickets` and `POST /feedback`.
  - **Apple:** `POST /auth/apple/exchange` exchanges the authorization code with Apple and stores the encrypted Apple refresh token as an `oauth_credentials` row with `token_kind='apple_siwa_refresh'`. **External credential required:** the Apple SIWA key.
- **Commands:** `C-FN` (unit tests with a stubbed DB), plus integration against tier A in CI.
- **Acceptance:**
  - Every route has tests for unauthorized access, bad input and success.
  - Bootstrap never returns raw provider data.
- **Satisfies:** M§42, M§62, M§88, M§146, M§151.

### Step 4 — Integrations

#### T-4.01 · OAuth start, callback, complete and upgrade
- **Depends:** T-3.08, T-3.11
- **Files:** `api/routes/integrations.ts` (start, complete, upgrade), `oauth/index.ts`, `oauth/routes/{google,microsoft,demo}.ts`, `_shared/services/integrations/{oauth-state,connect}.ts`, tests
- **Contents:**
  - **`POST /integrations/:provider/start`** takes `{capabilities[], return_to, login_hint?, device_nonce_hash}`. The app generates a 32-byte `device_nonce` per flow, keeps it in SecureStore and sends only its sha256:
    - The plan-limit gate blocks a second account on Free.
    - It creates an `oauth_states` row: a hashed state, the PKCE verifier stored as ciphertext, `device_nonce_hash`, and a 10-minute lifetime.
    - It returns the provider authorization URL and `state_id`.
  - **The `oauth` callback never finalizes alone (R-07):**
    - Validates the state: single use and not expired.
    - Exchanges the code and parses the granted scopes into capabilities.
    - Fetches the identity. If that identity is already linked to a different user, it refuses.
    - Upserts `connected_accounts` in `connecting` and stores the encrypted tokens. No sync runs yet.
    - Generates a one-time `completion_code`, stores only `completion_code_hash`, and redirects with 302 to `/oauth/done`, which hands off to `dijitalasistan://integrations/callback?state_id&provider&result&completion_code&error_code` (`result`: `pending_confirmation | denied | error | expired_state | admin_consent_required`). No token, email or scope appears in the URL.
  - **`POST /integrations/oauth/complete {completion_code, device_nonce}`** (R-07) is called by the app with its JWT:
    - It requires `oauth_states.user_id = auth.uid()`, `sha256(device_nonce) = device_nonce_hash`, a matching unused `completion_code`, and a call within 10 minutes of the callback. Otherwise it rejects, revokes the provider grant, purges the account and audits `security.oauth_binding_mismatch`.
    - On success it sets `completed_at`, moves the account to `syncing` (or `partial` for a partial grant), creates `sync_states`, enqueues `initial_sync` (which also sets up watches and subscriptions) and returns `{result: success | partial | account_mismatch | already_linked, account_id, granted_capabilities}`.
  - Accounts still `connecting` 10 minutes after the callback are revoked and purged by `scheduler_tick`.
  - **`POST /integrations/:accountId/upgrade`** adds progressive scopes with `include_granted_scopes`, through the same start → callback → complete sequence.
  - **Demo routes** `GET /oauth/demo/authorize` and `GET /oauth/demo/callback` exist only when `DEMO_MODE` is set.
- **Commands:** `C-FN`
- **Acceptance:** A replayed or expired state, a wrong device nonce, a completion by a different user, a reused completion code and an identity collision are all rejected. A partial scope grant produces status `partial`. No account syncs before completion.
- **Satisfies:** M§75, M§76, M§88.

#### T-4.02 · Google adapter: auth, tokens, revoke
- **Depends:** T-4.01
- **Files:** `_shared/providers/google/{auth,scopes,revoke}.ts`, tests
- **Contents:**
  - The authorization request uses `access_type=offline`, `prompt=consent` on first connect, and PKCE.
  - Token refresh is single-flight through `try_lock_credential_refresh`.
  - An `invalid_grant` response sets the account to `needs_reauth`.
  - Revoke calls `POST https://oauth2.googleapis.com/revoke`.
  - The capability-to-scope map uses least privilege.
  - **External credential required:** Google OAuth client ID and secret.
  - **Manual external step:** consent screen, brand verification, and the CASA assessment for `gmail.readonly`.
- **Commands:** `C-FN`
- **Acceptance:** Recorded fixture tests pass.
- **Satisfies:** M§76, M§117.

#### T-4.03 · Gmail sync and original mail
- **Depends:** T-4.02, T-3.05
- **Files:** `_shared/providers/google/{gmail,mime}.ts`, `worker/handlers/gmail_sync.ts`, `api/routes/mail.ts` (`GET /mail/:messageId/original`), `__fixtures__/gmail/*`, tests
- **Contents:**
  - **Initial sync:** covers 72 hours first, then backfills to the retention window. It fetches `format=metadata` headers first and `format=full` only for triage survivors. Bodies are processed transiently and never stored.
  - **Incremental sync:** runs from `history.list`. A 404 triggers a bounded resync.
  - **Quota:** a per-user token bucket.
  - **Stored data:** only a subset of headers and a snippet of at most 200 characters. Threads are upserted with dedupe.
  - **`GET /mail/:messageId/original`:** returns the sanitized body on demand. It is neither stored nor logged.
- **Commands:** `C-FN`
- **Acceptance:**
  - The pagination, 404, dedupe and "no body persisted" tests pass.
  - The latter asserts that no column contains body text.
- **Satisfies:** M§15, M§87, M§116, M§117.

#### T-4.04 · Gmail push webhook and watch
- **Depends:** T-4.03
- **Files:** `webhooks-google/index.ts`, `webhooks-google/routes/gmail.ts`, `worker/handlers/watch_renewal.ts` (the Google part), tests
- **Contents:**
  - The webhook verifies the Pub/Sub OIDC JWT with `jose`, checking the Google certs, the audience and the service-account email.
  - It dedupes on `webhook_events`, enqueues `gmail_sync` keyed by account and `historyId`, and returns 204 in under 1 second.
  - The Gmail watch is renewed daily.
  - **Manual external step:** create the Pub/Sub topic, the push subscription, and the publisher grant for `gmail-api-push@system.gserviceaccount.com`.
- **Commands:** `C-FN`
- **Acceptance:** A forged JWT, a wrong audience and a replayed message are rejected or ignored.
- **Satisfies:** M§113, M§117.

#### T-4.05 · Google Calendar sync and channels
- **Depends:** T-4.02
- **Files:** `_shared/providers/google/calendar.ts`, `webhooks-google/routes/calendar.ts`, `worker/handlers/calendar_sync.ts`, tests
- **Contents:**
  - The calendar list is stored; Free users get 1 selected calendar.
  - Events sync with a per-calendar `syncToken`. A 410 triggers a bounded full resync. Queries use `singleEvents=true` over a rolling window.
  - Watches use `events.watch` with a channel token of `HMAC(WEBHOOK_HMAC_SECRET, channel id)` and are renewed 24 hours before expiry.
  - Normalized events keep the conference link, `da_approval_id`, and the location only when one exists.
- **Commands:** `C-FN`
- **Acceptance:** The 410 path, a bad channel token and the renewal tests pass.
- **Satisfies:** M§19, M§20, M§117.

#### T-4.06 · Google Tasks sync
- **Depends:** T-4.02
- **Files:** `_shared/providers/google/tasks.ts`, `worker/handlers/tasks_sync.ts` (the Google branch), tests
- **Contents:**
  - Sync covers task lists and tasks, polling with `updatedMin` every 15 minutes and on foreground `sync`.
  - Tasks have date-only due dates.
- **Commands:** `C-FN`
- **Acceptance:** Fixture tests pass.
- **Satisfies:** M§75, M§117.

#### T-4.07 · Microsoft adapter: auth, tokens, Graph client
- **Depends:** T-4.01, T-3.04
- **Files:** `_shared/providers/microsoft/{auth,graph,revoke,errors}.ts`, tests
- **Contents:**
  - Uses the `common` authority with PKCE and a certificate client assertion.
  - AADSTS errors are mapped: consent-required and admin-consent errors set `admin_consent_required`; an expired refresh token sets `needs_reauth`.
  - Every request sends `Prefer: IdType="ImmutableId"`.
  - Each mailbox gets at most 4 concurrent requests, and 429 responses honor `Retry-After`.
  - Revoke purges locally and returns the documented user consent-management link.
  - **External credential required:** Entra client ID and certificate.
  - **Manual external step:** app registration and publisher verification.
- **Commands:** `C-FN`
- **Acceptance:** The error-mapping table test passes.
- **Satisfies:** M§76, M§117.

#### T-4.08 · Graph mail, calendar and To Do sync
- **Depends:** T-4.07
- **Files:** `_shared/providers/microsoft/{mail,calendar,todo}.ts`, `worker/handlers/outlook_sync.ts`, plus the Microsoft branches of `calendar_sync` and `tasks_sync`, tests
- **Contents:**
  - **Mail:** message delta per folder (inbox and sentitems) with `$select` limited to a header subset, and the `deltaLink` stored. Full bodies are fetched only transiently or for "Orijinal Mail", which uses `webLink` as the handoff.
  - **Calendar:** `calendarView/delta` over a rolling window, re-baselined daily.
  - **To Do:** delta polled every 15 minutes.
- **Commands:** `C-FN`
- **Acceptance:** Fixture tests pass for delta, re-baseline and 429 handling.
- **Satisfies:** M§75, M§117.

#### T-4.09 · Graph subscriptions and `webhooks-microsoft`
- **Depends:** T-4.08
- **Files:** `webhooks-microsoft/index.ts`, `routes/{notify,lifecycle}.ts`, the Microsoft part of `worker/handlers/watch_renewal.ts`, tests
- **Contents:**
  - The `validationToken` is echoed as `text/plain`.
  - `clientState` is compared by hash in constant time; matching notifications are enqueued with a 202 in under 3 seconds.
  - Lifecycle events are handled: `reauthorizationRequired` renews, `subscriptionRemoved` recreates, and `missed` reconciles.
  - A subscription is renewed when less than 48 hours remain.
- **Commands:** `C-FN`
- **Acceptance:** A forged `clientState`, validation echo timing and each lifecycle branch are tested.
- **Satisfies:** M§113, M§117.

#### T-4.10 · Demo adapter and fixtures
- **Depends:** T-3.08
- **Files:** `_shared/providers/demo/{mail,calendar,tasks,writes}.ts`, `_shared/providers/demo/fixtures/{people,mails,events,tasks,life}.ts`, tests
- **Contents:**
  - A deterministic dataset uses the PRIMARY names (Ahmet Yılmaz — Kuzey Lojistik, Mehmet Yılmaz — Yılmaz Endüstri, Selin Kaya).
  - It covers:
    - meetings and commitments;
    - the flight TK2412 İstanbul→Antalya;
    - the payment "Elektrik faturası 1.842 TL";
    - a Netflix renewal;
    - a Google security alert;
    - a shipment.
  - Times are relative to now in the user's timezone.
  - Writes change state in `private.demo_fixture_state`, so a sent reply appears in its thread and a created event appears in the calendar.
  - The adapter is only available when `DEMO_MODE` is on.
- **Commands:** `C-FN`
- **Acceptance:**
  - The same seed on the same day yields identical output.
  - Writes are visible on the next sync.
- **Satisfies:** M§34, M§89, M§100.

#### T-4.11 · Device calendar ingest
- **Depends:** T-3.11, T-3.06
- **Files:** `api/routes/integrations.ts` (`POST /integrations/device-calendar/snapshot`), `worker/handlers/device_calendar_ingest.ts`, tests
- **Contents:**
  - The endpoint accepts a zod-limited payload of at most 2,000 events for `apple_device` or `android_device`, together with the installation and the time window.
  - Events are upserted by `calendarItemExternalIdentifier` (iOS) or the `_id`/sync ID (Android). Events missing from the window are deleted.
  - `sync_states.last_device_sync_at` is recorded and shown in provenance.
- **Commands:** `C-FN`
- **Acceptance:** A repeated snapshot is idempotent. Deletes are reconciled.
- **Satisfies:** M§75, M§91.

#### T-4.12 · Sync orchestration, quota, error mapping, data-source controls
- **Depends:** T-4.03, T-4.05, T-4.06, T-4.08, T-4.10
- **Files:** `worker/handlers/{initial_sync,reconciliation,provider_webhook}.ts`, `api/routes/integrations.ts` (`sync`, `data-sources`), `_shared/services/integrations/status.ts`, tests
- **Contents:**
  - `initial_sync` fans out per capability.
  - `reconciliation` compares IDs within the window and repairs differences.
  - Error mapping updates `account_status` and emits an `account` notification ("Gmail bağlantısı yenilenmeli.").
  - `POST /integrations/:accountId/sync` is rate-limited to 1 call per minute. It optionally accepts `{message_ids[], force_analysis}`.
  - `PATCH /integrations/:accountId/data-sources` writes `connected_accounts.data_source_toggles` (keys `mail_read`, `attachments_analyze`, `deadline_detect`, `draft_replies`, `calendar_read`, `schedule_suggest`, `calendar_write_with_approval`, `tasks_read`) and is enforced server-side through `private.account_can`:
    - turning off read pauses ingestion;
    - turning off attachments stops fetching them;
    - turning off drafts disables reply drafts;
    - turning off "create events with approval" blocks calendar proposals.
- **Commands:** `C-FN`
- **Acceptance:** A disabled source produces no ingestion jobs.
- **Satisfies:** M§40, M§52, M§116, M§117.

#### T-4.13 · Disconnect and revoke
- **Depends:** T-4.12
- **Files:** `api/routes/integrations.ts` (`disconnect`), `_shared/services/integrations/disconnect.ts`, tests
- **Contents:** The disconnect sequence is:
  1. Stop watches and subscriptions.
  2. Revoke with the provider. Google revokes the token; Microsoft is local-only, and the documented link is returned.
  3. Delete the ciphertext.
  4. Enqueue `integration_purge` (key `integration_purge:{account}:{disconnected_at_epoch}`), which purges that account's content, derived data and embeddings.
  5. Write the audit entry.
  6. Set the account to `disconnected`.
- **Commands:** `C-FN`
- **Acceptance:** No credentials remain after disconnect, and no content or derived rows remain for the account once `integration_purge` completes.
- **Satisfies:** M§41, M§76, M§129.

### Step 5 — AI pipeline

#### T-5.01 · Email triage (T0 + T1)
- **Depends:** T-3.10, T-1.07, T-4.03
- **Files:** `worker/handlers/email_triage.ts`, `_shared/services/ai/triage.ts`, `_shared/ai/prompts/email_classification.md`, tests
- **Contents:**
  - T0 pre-filter:
    - signals, rules and VIP from `@da/domain`;
    - content-hash dedupe.
  - Messages that survive T0 are micro-batched, up to 5 per request within a 30 s window, and sent to T1 with `EmailTriageV1`.
  - Each result goes through grounding verification before it is persisted.
  - What gets persisted:
    - the analysis group: category, tier, reason, rule, confidence, one-liner, and key points (key points only for important mail);
    - an enqueued `insight_refresh` and `embedding`.
  - When the budget is exhausted, triage falls back to T0 only.
- **Commands:** `C-FN` with the fixture provider.
- **Acceptance:**
  - An explicit rule overrides the AI result.
  - Injected text does not change behaviour.
  - At least 55% of the fixture inbox is resolved at T0.
- **Satisfies:** M§14, M§80, M§82, M§83, M§114.

#### T-5.02 · Deep email analysis and thread summaries
- **Depends:** T-5.01
- **Files:** `worker/handlers/email_analysis.ts`, `api/routes/mail.ts` (`POST /mail/threads/:threadId/summary`), `_shared/services/ai/{deep-extract,thread-summary}.ts`, prompts `email_deep_extract.md` and `thread_summary.md`, tests
- **Contents:**
  - `EmailDeepExtractV1` runs on important or complex threads to extract deadlines and reschedule requests.
  - `ThreadSummaryV1` is triggered when the user opens a thread, through `POST /mail/threads/:threadId/summary`. A summary generated on open counts as 1 Free AI unit.
  - Results are cached per `(thread, last_msg, prompt_version)`.
  - Only incremental context is sent: the prior summary plus new messages.
- **Commands:** `C-FN`
- **Acceptance:** Opening the same thread twice triggers no second LLM call.
- **Satisfies:** M§15, M§80, M§82.

#### T-5.03 · Commitments and follow-ups pipeline
- **Depends:** T-5.02, T-1.11
- **Files:** `_shared/services/ai/commitments.ts`, `_shared/services/followups.ts`, prompt `commitment.md`, tests
- **Contents:**
  - When the Turkish regex fires, T1 runs `CommitmentExtractV1`. If the result is `hedged` or fails verification, it escalates to T2.
  - Commitments with verified evidence are upserted, deduped by key.
  - Low-confidence results create a pending `commitment_create` approval instead of a commitment.
  - The follow-up state machine emits insights in both directions.
- **Commands:** `C-FN`
- **Acceptance:** An ambiguous phrase produces a pending approval, not a commitment.
- **Satisfies:** M§17, M§18, M§83.

#### T-5.04 · Life intelligence
- **Depends:** T-5.01, T-3.05
- **Files:** `_shared/services/life/{jsonld,templates-tr,classify,allowlists}.ts`, prompt `life_intel.md`, tests with fixture emails
- **Contents:**
  - JSON-LD and microdata types are parsed: `ParcelDelivery`, `FlightReservation`, `LodgingReservation`, `FoodEstablishmentReservation`, `EventReservation`, `Order`, `Invoice`.
  - Turkish sender templates cover Trendyol, Hepsiburada, Amazon.com.tr, Yurtiçi, Aras, MNG, PTT, Sürat, HepsiJet, THY, Pegasus, utilities and banks.
  - T1 `LifeIntelV1` is the fallback.
  - A `security` result requires DKIM/SPF alignment.
  - Amounts and deadlines are kept only with verified evidence.
  - A tracking URL is kept only if it appears in the source and its domain is on the allow-list.
- **Commands:** `C-FN`
- **Acceptance:**
  - A spoofed security mail is rejected.
  - An amount without evidence is dropped.
- **Satisfies:** M§23, M§83, M§84.

#### T-5.05 · Insight builder
- **Depends:** T-5.03, T-5.04, T-1.12
- **Files:** `worker/handlers/insight_refresh.ts`, `_shared/services/insights/{build,rank,explain}.ts`, tests
- **Contents:** Insights are built from these sources:
  - mail analysis;
  - calendar intelligence (conflicts, back-to-back meetings, prep needs, free slots → `schedule_suggestion`);
  - deadlines;
  - follow-ups;
  - commitments;
  - life events;
  - pending approvals;
  - security.

  Each insight gets a dedupe key, an urgency, a card type, a primary action and an explainability reason. Dismissed items are suppressed. Today shows at most 5 priorities.
- **Commands:** `C-FN`
- **Acceptance:**
  - Rebuilding is idempotent.
  - Every insight has a source and at least one action (SREQ-89).
- **Satisfies:** M§8, M§13, M§20, M§131.

#### T-5.06 · Contacts and person intelligence
- **Depends:** T-5.05
- **Files:** `_shared/services/contacts/{resolve,stats}.ts`, tests
- **Contents:**
  - Contacts are upserted from mail headers and event attendees. Email addresses are normalized and linked to their domain.
  - Stats: `last_contact_at`, 30-day counts, and recent topics taken from summaries.
  - These stats feed the `person_intelligence` and `vip_suggestions` RPCs.
- **Commands:** `C-FN`, `C-DB`
- **Acceptance:** The Person payload lists the correct owes and owed items.
- **Satisfies:** M§30.

#### T-5.07 · Embeddings, memory and search
- **Depends:** T-5.05, T-3.10
- **Files:** `worker/handlers/embedding.ts`, `api/routes/search.ts`, `_shared/services/memory/{chunk,query-parse}.ts`, `_shared/ai/evals/retrieval-tr.jsonl`, tests
- **Contents:**
  - **Chunks:** derived facts only (summaries, key points, events, commitments, life events, capture extractions, meeting-note summaries), each with provenance and `expires_at`.
  - **Embeddings:** `voyage-4`. If that fails the job retries; if the provider is down, search runs on FTS only.
  - **`GET /search`:**
    - A T0 parser extracts Turkish date ranges ("geçen ay", "bu hafta", "dün"), people and type words.
    - The query is embedded with `voyage-4-lite` and passed to `search_user_content`, with `p_contact_id` for person-scoped search.
    - Results carry source, date, summary and a deep link.
    - `mode=answer` (Pro) returns a grounded answer with its sources. With no grounded source the answer is "Bunu kayıtlarında bulamadım."
- **Commands:** `C-FN`, `pnpm ai:eval`
- **Acceptance:**
  - On the Turkish eval set, recall@6 is at least 0.8.
  - The FTS-only path works.
  - Results are scoped to the requesting user.
- **Satisfies:** M§26, M§95.

#### T-5.08 · Briefings: morning, midday, evening, weekly
- **Depends:** T-5.05, T-3.09
- **Files:** `worker/handlers/briefing.ts`, `_shared/services/briefings/{morning,midday,evening,weekly,share-card}.ts`, `api/routes/briefings.ts` (`evening-ready`, `share-card`, `retry`), prompts `briefing_morning.md`, `briefing_midday.md`, `briefing_evening.md` and `weekly_review.md`, tests
- **Contents:**
  - **Morning:**
    - A T2 `BriefingMorningV1` call builds a narrative of at most 90 words from the ranked item JSON.
    - It fills exactly 6 sections: Bugünün Öncelikleri, Programın, Senden Beklenenler, Senin Beklediklerin, Son Tarihler, Kişisel Gelişmeler.
    - The hero line is a template: "Bugün bilmen gereken {n} şey var."
    - The fallback is a T0 template.
  - **Midday (R-05):** a deterministic T0 composition (`MiddayPulseV1`). When the delta is zero, the status is `skipped` with `skip_reason='no_meaningful_delta'` and no push is sent. Otherwise: "Sabahından beri {n} önemli gelişme oldu." An optional single-sentence T1 polish (`BriefingPolishV1`) runs only behind `ai.feature.briefing_polish`; T2 is never used.
  - **Evening (R-05):** T0 lists (`EveningCloseV1`): Tamamlananlar, Yarına Kalanlar, Takip, Yarının ilk etkinliği. Hero: "Bugünden yarına {n} konu kaldı." The same optional polish applies.
  - **Weekly:** deterministic counts, a narrative from Message Batches (submitted Sunday 12:00 local, with a synchronous fallback at 17:30), and an estimated time saved labelled "tahmini". Its push uses `notification_category='evening'` on channel `briefings`.
  - **Endpoints:**
    - `evening-ready` carries unfinished items over to tomorrow.
    - `share-card` returns numbers only, never names or subjects.
    - `retry` (`POST /briefings/:id/retry`, API-BRF-04) re-enqueues a `failed` briefing for the user's current local date. Any other state returns 409 `STATE_CONFLICT`.
  - **Status flow:** `scheduled → generating → ready → delivered | skipped | failed`, then a `notification` is enqueued.
- **Commands:** `C-FN`
- **Acceptance:**
  - All 6 section labels appear verbatim.
  - A delta of zero makes midday `skipped`.
  - The share card contains no PII.
- **Satisfies:** M§9, M§10, M§11, M§12, M§111.

#### T-5.09 · Briefing audio
- **Depends:** T-5.08
- **Files:** `api/routes/briefings.ts` (`audio`), `worker/handlers/briefing_audio.ts`, `_shared/services/briefings/audio.ts`, tests
- **Contents:**
  - The endpoint returns `{mode:'file', url, duration_s, chapters}` when premium TTS applies: `voice.tts_premium` is on, a key is configured and the user is Pro.
  - Premium audio is stored at `briefing-audio/{user}/{briefing}/{version}.mp3` and served through a signed URL valid for 300 s.
  - In every other case it returns `{mode:'native_tts', chapters[]}` for on-device synthesis (T-8.27).
  - Voice Briefing is a Pro feature and is gated server-side.
- **Commands:** `C-FN`
- **Acceptance:** A Free user gets a `pro_required` error. Without a premium key the endpoint falls back to native TTS.
- **Satisfies:** M§9, M§25, M§44.

#### T-5.10 · Meeting prep, notes and post-meeting
- **Depends:** T-5.06, T-5.07
- **Files:** `worker/handlers/meeting_prep.ts`, `api/routes/meetings.ts`, `_shared/services/meetings/{prep,post}.ts`, prompts `meeting_prep.md` and `post_meeting.md`, tests
- **Contents:**
  - **Prep pipeline:**
    1. Resolve attendees to contacts.
    2. Load recent threads, open loops and commitments on both sides.
    3. Attach files only when real attachments or links exist.
    4. Rank the sources.
    5. Run T2 `MeetingPrepV1` to produce purpose, 3 talking points and "2 Dakikalık Özet".
  - Prep is precomputed at T−60 only for external or VIP meetings; every other meeting is generated on tap ("Hazırlan") (R-23). Prep is regenerated when the source-set hash changes.
  - **`notes`:** stores text, or voice transcribed on the client or through `/assistant/transcribe`.
  - **`post`:** T1 `PostMeetingCommitmentV1` plus the T0 date resolver produce a `commitment_create` approval. In the UI, "Kaydet" performs the approval with `approved_via='in_place'` (C-06, R-03).
  - **`POST /meetings/:eventId/prep/audio`** (R-24) mirrors `POST /briefings/:id/audio` for the "2 Dakikalık Özet". With `voice.tts_premium` on, a configured TTS key and a Pro user, it returns `{signed_url, expires_at, chapters[]}`; otherwise the app reads the summary with native TTS.
  - Meeting prep is a Pro feature and gated.
- **Commands:** `C-FN`
- **Acceptance:** "Mehmet'e yarın teklif göndereceğim." produces a pending approval due tomorrow.
- **Satisfies:** M§21, M§22, M§150.

#### T-5.11 · Assistant and voice server
- **Depends:** T-5.07, T-6.01
- **Files:** `api/routes/assistant.ts`, `_shared/services/assistant/{intents,answer,tools}.ts`, prompts `assistant.md` and `assistant_intent.md`, tests
- **Contents:**
  - **Threads:** `POST /assistant/threads` creates a thread. Threads can be person-scoped.
  - **Messages:** `POST /assistant/threads/:id/messages` answers as an SSE stream (`meta`, `status`, `delta`, `citation`, `card`, `action_proposal`, `done`, `error`; API-AST-02).
  - **Answering:**
    - A T0 grammar answers the suggested prompts directly from SQL: "Bugün neye odaklanmalıyım?", "Kimlere cevap vermem gerekiyor?", "Yarın yoğun muyum?", "Bu hafta hangi son tarihlerim var?", "Ödenmesi gereken bir şey var mı?".
    - Other questions get grounded QA over the top 6 chunks with citations. With no sources it answers "bilmiyorum".
  - **Tools (R-04):** the assistant LLM gets only read-only retrieval (`search_result` blocks and read tools scoped to the user); it has no write-capable or `propose_action` tool. Write intents are detected by `AssistantIntentV1` (T0 grammar first, then T1). The server builds the proposal through the same code path as `POST /approvals` and returns the pending approval card as an `action_proposal` event. Nothing is executed from chat or voice, and approval is tap-only (R-03).
  - **Transcription:** `POST /assistant/transcribe` accepts up to 60 s of audio, which is not stored.
  - Message content is never logged.
- **Commands:** `C-FN`
- **Acceptance:**
  - Every answer cites its sources.
  - Injection fixtures never produce executed actions.
- **Satisfies:** M§24, M§25, M§83, M§114.

#### T-5.12 · Reply drafts and follow-up drafts
- **Depends:** T-5.02, T-6.01
- **Files:** `api/routes/mail.ts` (reply drafts), `api/routes/followups.ts`, `_shared/services/replies/{generate,recipients}.ts`, prompts `reply_draft.md` and `follow_up.md`, tests
- **Contents:**
  - **Generation:** T2 `ReplyDraftsV1` produces all 4 tones (Kısa / Profesyonel / Samimi / Detaylı) in one call. The lean profile produces a single tone.
  - **Recipients** are computed from the thread headers and never taken from the model.
  - **Endpoints:**
    - `regenerate` accepts a tone and an instruction.
    - `PATCH` edits the draft. Recipients are validated.
    - `submit` creates an `email_send` approval with the exact change and the account, then returns it as pending.
    - The follow-up draft endpoint creates `kind: follow_up` (`FollowUpDraftV1`).
    - `POST /reply-drafts/:id/attachments/upload-url` (R-24) returns a signed upload into the private `captures` bucket under `{user_id}/replies/{draft_id}/{file}`, after the size, MIME and extension checks of T-3.05. The attachment list is part of the `email_send` approval's exact change.
- **Commands:** `C-FN`
- **Acceptance:**
  - Model output never sets recipients.
  - No code path sends mail without an approval.
- **Satisfies:** M§3(7), M§16, M§17.

#### T-5.13 · Universal Capture backend
- **Depends:** T-3.05, T-3.10, T-6.01
- **Files:** `api/routes/captures.ts`, `worker/handlers/capture_analysis.ts`, `_shared/services/capture/{text,link,image,pdf,actions}.ts`, prompts `capture.md`, `capture_vision.md` and `capture_pdf.md`, tests
- **Contents:**
  - **Endpoints:**
    - `upload-url` returns a signed upload to `captures/{user}/{capture}/{file}`.
    - `POST /captures` creates a capture.
    - `analyze` enqueues `capture_analysis`.
    - `actions` turns selected items into approvals or internal actions. Approvals created here are approved from the capture batch sheet with `approved_via='capture_batch'`.
    - `POST /captures/:id/discard` (API-CAP-05) discards a capture.
  - **Extraction by input type:**

    | Input | Pipeline |
    |---|---|
    | Text | T1 |
    | Link | SSRF-safe fetch → readability → T1 |
    | Photo | T2 vision: verbatim transcript, then items quoting that transcript |
    | PDF with a text layer | per-page text (`unpdf`) → T2 |
    | Scanned PDF | T3, behind a flag |

  - Output uses `CaptureExtractV1`, which covers all 10 entity types.
  - The file is deleted within 24 h after analysis.
  - Capture is a Pro feature and gated.
- **Commands:** `C-FN`
- **Acceptance:**
  - Magic-byte rejection works.
  - An SSRF link is blocked.
  - Every extracted item carries evidence.
- **Satisfies:** M§27, M§84, M§85.

#### T-5.14 · Plan: free slots, proposals, conflicts
- **Depends:** T-5.05, T-6.01
- **Files:** `api/routes/plan.ts`, `_shared/services/plan/{slots,proposals,conflicts}.ts`, tests
- **Contents:**
  - **Free slots:** `GET /plan/free-slots` uses the domain slot finder over working hours.
  - **Proposals:** `POST /plan/proposals` returns a proposed block, shown with a dashed outline in the UI. Confirming it creates a `calendar_create` approval.
  - **Conflict options** depend on who organizes the event:
    - If the user is the organizer: move the event.
    - If not: draft a "yeni saat öner" reply.
    - Decline is always available.
    - Free/busy is checked only where the provider API allows it.
  - **Conflict resolve:** creates a `calendar_update` approval with the side effect "Katılımcılara güncelleme gönderilir".
  - Advanced planning is a Pro feature.
- **Commands:** `C-FN`
- **Acceptance:** A non-organizer never receives a move option.
- **Satisfies:** M§19, M§20.

#### T-5.15 · First Analysis
- **Depends:** T-5.08, T-4.12
- **Files:** `api/routes/onboarding.ts`, `worker/handlers/first_analysis.ts`, tests
- **Contents:**
  - Scope: 72 h of mail and 48 h of calendar.
  - Progress is written to `jobs.progress`:
    - Step labels: "Son 72 saat taranıyor", "E-postalar sınıflandırılıyor", "Takvim kontrol ediliyor", "Açık konular aranıyor".
    - Counts: mail, important, calendar, follow-up.
  - When finished, it creates a briefing with `origin=onboarding`.
  - The app polls `GET /onboarding/first-analysis/:jobId` every 1–2 s (R-19; no Realtime). The footer reads "Son 72 saat analiz edildi. Mail içeriğinin tamamı saklanmaz." (R-15).
- **Commands:** `C-FN`
- **Acceptance:** Every count reported comes from real data. A demo run completes.
- **Satisfies:** M§34.

#### T-5.16 · AI seeds, prompt registry and eval sets
- **Depends:** T-3.09, T-5.01…T-5.14
- **Files:** `_shared/ai/prompts/*.md` (18 keys), `scripts/ai/gen-prompt-seed.ts`, `supabase/migrations/20260924001700_ai_config_seed.sql`, `_shared/ai/evals/{triage-tr,grounding,injection}.jsonl`, `_shared/ai/evals/*.test.ts`
- **Contents:**
  - **Prompts:** the 18 keys of the AI_PIPELINE_PLAN §5.2 catalogue (R-20): `email_classification`, `thread_summary`, `email_deep_extract`, `commitment`, `post_meeting`, `follow_up`, `life_intel`, `briefing_morning`, `briefing_midday`, `briefing_evening`, `weekly_review`, `meeting_prep`, `capture`, `capture_vision`, `capture_pdf`, `assistant_intent`, `assistant`, `reply_draft`. Version 1 is active for each.
  - **`ai_model_config`** is seeded with the A8 routing for each routed `ai_feature` value (`email_triage`, `thread_summary`, `email_deep_extract`, `commitment_extract`, `life_intel_extract`, `briefing_morning`, `briefing_midday`, `briefing_evening`, `weekly_review`, `meeting_prep`, `post_meeting_parse`, `capture_extract`, `assistant_intent`, `assistant_qa`, `reply_draft`, `follow_up_draft`, `embedding_doc`, `embedding_query`, `stt`, `tts`), in both profiles. This seed is the only place outside evals and adapter tests where model IDs appear.
  - **Seed generation:** the prompt seed is generated from the `.md` sources and checked for drift.
  - **Eval sets:**
    - Turkish triage: at least 200 labelled items.
    - Grounding.
    - Injection: "ignore previous instructions", "send this email", "reveal secret".
- **Commands:** `C-GEN`, `pnpm ai:eval`
- **Acceptance:**
  - Triage macro-F1 is at least 0.85 with the fixture baseline and with the live provider in owner runs.
  - Injection eval: zero approvals and zero executions.
- **Satisfies:** M§58, M§80, M§101, M§114.

#### T-5.17 · AI cost control and reconciliation
- **Depends:** T-5.16
- **Files:** `worker/handlers/reconciliation_ai_cost.ts`, `_shared/ai/budget.ts` (additions), `supabase/migrations/20260924001710_ai_rollups.sql`, tests
- **Contents:**
  - `ai_usage_daily` rolls up usage.
  - Budgets are enforced per user and per plan.
  - `ai.budget.org_daily_usd` automatically turns off `ai.model.large.enabled`.
  - Nightly cost reconciliation runs as a `reconciliation` job with `payload.scope='ai_cost'`; there is no separate job type (AI_PIPELINE_PLAN §8.12). It compares against the Anthropic cost report and the OpenAI usage API. **External credential required:** `ANTHROPIC_ADMIN_API_KEY`, `OPENAI_ADMIN_API_KEY`. If the drift is above 5%, a health `degraded` alert fires.
- **Commands:** `C-FN`, `C-DB`
- **Acceptance:**
  - The Free hard cap forces T0-only processing.
  - The org budget trip is tested.
- **Satisfies:** M§56, M§82, M§119.

### Step 6 — Approvals, reminders, notifications

#### T-6.01 · Approvals API and state machine
- **Depends:** T-3.11, T-2.15
- **Files:** `api/routes/approvals.ts`, `_shared/services/approvals/{propose,edit,approve,reject,exact-change}.ts`, tests
- **Contents:**
  - **`POST /approvals`** creates a proposal:
    - validates the payload for its type;
    - computes the exact change, destination, side effects, why and source;
    - checks the capability;
    - stores it as `pending` with an `idempotency_key` and `approval_expires_at`.
  - **`PATCH /approvals/:id`** bumps `payload_version`, issues a new key and re-validates.
  - **`POST /approvals/:id/approve {idempotency_key, approved_via}`** (`approved_via` is one of the R-03 tap surfaces; speech never approves):
    - When the capability is missing, it returns 409 `scope_upgrade_required {capability}`.
    - Otherwise it moves the approval to `approved`, enqueues `approval_execute` and pokes the worker.
    - A replay returns `{already:true, status}`.
  - **`POST /approvals/:id/reject`**.
  - Clients block approvals while offline (they are never queued).
  - "Geri al" (R-06) is a client-side 5 s delay before the approve request is sent, used by the inline sheet and the capture batch. If the app closes during the delay, the approval simply stays `pending` in the Approval Center. There is no server-side undo status or transition.
- **Commands:** `C-FN`, `C-DB`
- **Acceptance:**
  - A double approve executes once.
  - An edit invalidates the old key.
  - An expired approval returns 410.
- **Satisfies:** M§3(6–8), M§33, M§115.

#### T-6.02 · Execute `email_send`
- **Depends:** T-6.01, T-4.03, T-4.08
- **Files:** `worker/handlers/approval_execute.ts`, `_shared/services/approvals/execute/email-send.ts`, tests
- **Contents:**
  - **Gmail:**
    - Builds an RFC 5322 message with `Message-ID: <approval-{id}@mail.dijitalasistan.app>`, `In-Reply-To` and `References`.
    - Before a retry, it checks `rfc822msgid:` and skips sending if the message already exists.
    - Sends with `messages.send` and the `threadId`.
  - **Graph:**
    - Sends with `POST /me/messages/{id}/reply` and an extended-property marker.
    - Before a retry, it checks Sent Items.
  - **Outcome:**
    - `executing → executed` stores the provider reference; `executing → failed` records whether the failure is retryable.
    - The thread is refreshed, the reply draft becomes `sent`, and an `approval` notification is sent.
- **Commands:** `C-FN`
- **Acceptance:** A retry after a simulated crash sends nothing twice (fixture test).
- **Satisfies:** M§16, M§115, M§116.

#### T-6.03 · Execute `calendar_create` and `calendar_update`
- **Depends:** T-6.01, T-4.05, T-4.08
- **Files:** `_shared/services/approvals/execute/{calendar-create,calendar-update}.ts`, tests
- **Contents:**
  - **Google:**
    - Creates events with a deterministic base32hex id; a 409 response means already done.
    - Sets `extendedProperties.private.da_approval_id`.
    - Updates use `events.patch` with an etag and `sendUpdates`.
  - **Graph:** sends `transactionId` and an extended property.
  - Device calendars follow T-6.05.
  - After a write, the calendar is re-synced so the timeline reflects provider data (F-10).
- **Commands:** `C-FN`
- **Acceptance:** A duplicate execute creates no second event.
- **Satisfies:** M§19, M§115, M§116.

#### T-6.04 · Execute `task_create`, `reminder_create` and `commitment_create`
- **Depends:** T-6.01, T-4.06, T-4.08
- **Files:** `_shared/services/approvals/execute/{task-create,reminder-create,commitment-create}.ts`, tests
- **Contents:**
  - **Google Tasks:** stores the returned id and uses a notes marker for dedupe.
  - **To Do:** uses a `linkedResources` marker.
  - **Apple Reminders:** executed on the device.
  - **In-app tasks:** a `tasks` row.
  - **In-app reminders:** a `reminders` row, which the device schedules.
  - **Commitments:** a `commitments` row with provenance.
- **Commands:** `C-FN`
- **Acceptance:** All three action types are idempotent.
- **Satisfies:** M§18, M§29, M§33.

#### T-6.05 · Device-executed approvals
- **Depends:** T-6.01
- **Files:** `api/routes/approvals.ts` (`POST /approvals/:id/device-execution`), tests
- **Contents:**
  - Approving with `executor='device'` sets the approval to `executing` and returns a device token.
  - The app writes through EventKit or CalendarContract with a marker in the event, and searches for that marker before creating.
  - The app then posts the result to `POST /approvals/:id/device-execution` (API-APR-05).
  - `private.fail_stale_device_approvals` fails any device approval still `executing` 10 minutes after `executing_at` (`DEVICE_RESULT_MISSING`).
- **Commands:** `C-FN`
- **Acceptance:** A wrong device token is rejected. Posting the result twice is a no-op.
- **Satisfies:** M§75, M§115.

#### T-6.06 · Reminders API
- **Depends:** T-1.12, T-3.11
- **Files:** `api/routes/reminders.ts`, `_shared/services/reminders.ts`, tests
- **Contents:**
  - `resolve-time` returns `{fire_at, reason}` for a preset. "Uygun zamanda" uses the slot finder.
  - `POST /reminders` requires a confirm step and an `idempotency_key`. It returns the row, which the device schedules as a local notification.
  - `POST /reminders/:id/cancel`.
  - Creating an external reminder goes through a `reminder_create` approval.
- **Commands:** `C-FN`
- **Acceptance:** A duplicate key returns the same reminder.
- **Satisfies:** M§29.

#### T-6.07 · Notification send pipeline and receipts
- **Depends:** T-1.08, T-3.06
- **Files:** `worker/handlers/{notification,push_receipts}.ts`, `_shared/services/notifications/{create,expo-push}.ts`, `api/routes/{notifications,widgets}.ts`, `_shared/services/widgets/snapshot.ts`, tests
- **Contents:**
  - `decide()` writes a `notifications` row with its decision and reason. Title and body are rendered according to the detail mode.
  - Pushes go to Expo in batches of up to 100, with `EXPO_ACCESS_TOKEN`. Each send creates `push_tickets`.
  - Every notification gets an Android channel from the R-12 set (`briefings`, `critical_email`, `meetings`, `deadlines`, `follow_up`, `life_intel`, `approvals`, `reminders`, `account`, `phone_digest`) and an iOS interruption level; meetings and critical items are time-sensitive. The weekly review push uses category `evening` on channel `briefings`.
  - Receipts are checked after 15 minutes. `DeviceNotRegistered` disables the token.
  - **`POST /notifications/test {category}`** (API-DEV-04) sends the user a test push rendered at the current effective detail level through the same decision engine. During quiet hours it returns 409 `STATE_CONFLICT` with `details.reason='quiet_hours'`.
  - **`GET /widgets/snapshot`** (API-WDG-01) returns `WidgetSnapshotV1`, composed with no LLM call from `today_overview`, briefings, events and follow-up insights. It is filtered by `detail_level` (`generic` gives counts only) and supports ETag / 304.
  - **External credential required:** the Expo token. FCM and APNs are configured through EAS credentials.
- **Commands:** `C-FN`
- **Acceptance:**
  - Suppressions are recorded with a reason.
  - `generic` mode payloads contain no personal data.
- **Satisfies:** M§35, M§86, M§96, M§132.

#### T-6.08 · Time-based notifications
- **Depends:** T-6.07, T-2.18
- **Files:** `_shared/services/notifications/triggers/{meeting,post-meeting,deadline,follow-up,approval-expiry,trial-ending,briefing}.ts`, tests
- **Contents:**
  - **Meeting:** "{saat} toplantına {n} dakika kaldı." sent between T−30 and T−15.
  - **Post-meeting:** "Toplantın bitti. Takip etmen gereken bir şey var mı?" sent 1 minute after the meeting ends.
  - **Deadline and follow-up** nudges.
  - **Approval expiry.**
  - **Trial ending:** sent 24 h before the RevenueCat `expiration_at`.
  - **Briefing delivered.**
- **Commands:** `C-FN`
- **Acceptance:** The scheduler plus handler tests pass across timezones.
- **Satisfies:** M§22, M§96, M§111.

### Step 7 — Subscriptions and referrals

#### T-7.01 · RevenueCat webhook and billing sync
- **Depends:** T-3.06
- **Files:** `webhooks-revenuecat/index.ts`, `worker/handlers/billing_sync.ts`, `_shared/services/billing/revenuecat.ts`, tests
- **Contents:**
  - The webhook compares the Authorization secret in constant time.
  - Each event is stored in `billing_events` (unique `event_id`) and enqueues `billing_sync`.
  - `billing_sync` re-fetches the customer from REST v2 and overwrites the `subscriptions` row.
  - **External credential required:** the RevenueCat v2 key and the webhook secret.
- **Commands:** `C-FN`
- **Acceptance:** A replayed event is ignored. An out-of-order event cannot regress the state.
- **Satisfies:** M§43, M§60.

#### T-7.02 · Entitlement gates and plan-limit enforcement
- **Depends:** T-7.01, T-1.09
- **Files:** `_shared/entitlements.ts`, `api/routes/business.ts` (`/purchases/sync`), plus route-level gates, tests
- **Contents:**
  - `requirePro(feature)`, backed by `private.is_pro` and the `plan_limits` keys, guards every Pro capability in both `api` and `worker`: Midday and Evening, prep, follow-up, commitments, voice, memory, VIP, advanced plan, capture, NI, and extra accounts and calendars.
  - When a check fails the response is 403 `pro_required {feature}`.
  - `/purchases/sync` refreshes the entitlement immediately after a purchase.
- **Commands:** `C-FN`
- **Acceptance:** A matrix test runs every Pro route as a Free user and expects 403.
- **Satisfies:** M§43, M§44.

#### T-7.03 · Referrals
- **Depends:** T-7.02, T-1.10
- **Files:** `api/routes/referrals.ts`, `worker/handlers/referral_evaluate.ts`, `public-api/routes/referrals.ts`, tests
- **Contents:**
  - **Applying a code:** `POST /referrals/apply` records a `pending` referral.
  - **Viewing:** `GET /referrals/me` returns the user's code, link, status and remaining yearly cap.
  - **Evaluation:** the `referral_evaluate` job checks whether the referral qualifies and computes a risk score, which may flag it.
  - **Rewards:**
    - `referral_credits` are created for both sides.
    - `entitlement_grants` of 14 days are created, stacked, with an idempotency key.
    - Both sides are notified.
  - **Code lookup:** `GET /public-api/referrals/:code` resolves a code.
- **Commands:** `C-FN`, `C-DB`
- **Acceptance:** The reward is idempotent. Self-referrals and loops are rejected or flagged.
- **Satisfies:** M§45, M§116.

### Step 8 — Mobile

All mobile tasks share `C-MOB`. Tasks that touch native modules or config also run `C-MOB-SMOKE`. Feature code lives in `apps/mobile/src/features/<area>/{components,hooks}`. Route files are thin. Screen IDs are defined in `SCREEN_AND_FLOW_MAP.md`.

#### T-8.01 · Mobile scaffold, app config and EAS profiles
- **Depends:** T-1.02, T-1.04, T-1.17
- **Files:** `apps/mobile/{package.json,app.config.ts,eas.json,babel.config.js,metro.config.js,tsconfig.json,jest.config.js,index.ts}`, `apps/mobile/src/lib/env.ts`, `scripts/mobile/prebuild-smoke.sh`, `apps/mobile/assets/{icon,adaptive-icon,splash,notification-icon}.png`
- **Contents:**
  - **Package:** `@da/mobile`, with `expo.install.exclude: ["@sentry/react-native"]`.
  - **Variants** are derived from `APP_ENV` (`development`, `preview`, `e2e`, `production`):
    - Bundle ID and package: `IOS_BUNDLE_IDENTIFIER` / `ANDROID_PACKAGE`, both defaulting to `com.dijitalasistan.app`, plus a suffix of `.dev`, `.preview` or `.e2e` (none in production).
    - Scheme: `APP_SCHEME`, defaulting to `dijitalasistan` (with `-dev`, `-preview` or `-e2e` appended).
    - App group: `IOS_APP_GROUP`, defaulting to `group.<bundleId>`.
  - **Demo guard:** the build fails when `production` is combined with `EXPO_PUBLIC_DEMO_MODE=true` unless `ALLOW_DEMO_IN_PRODUCTION=true`.
  - **Build settings:**
    - `runtimeVersion` uses the `fingerprint` policy.
    - `expo-build-properties`: iOS 16.4; Android compile and target SDK 36, minimum SDK 24.
    - New architecture and Hermes V1 are on.
    - The React Compiler is enabled.
  - **Plugin list** follows INTEGRATION_PLAN §12.1, together with `./modules/da-widgets/plugin`, `./modules/da-share/plugin`, `expo-font` (Geist and Lora) and `expo-splash-screen` (background `#F5F4F0`, dark `#141311`).
  - **`appExtensions`** declares the widget and share-extension bundle IDs.
  - **`eas.json`:**
    - `cli.version >= 24.7.0` and `appVersionSource: remote`.
    - A base profile with `node 24.21.0` and `pnpm 11.27.1`.
    - `development` is a dev client with internal distribution.
    - `preview` is internal distribution on the `preview` channel.
    - `e2e` builds an Android APK and an iOS simulator build with the demo flag.
    - `production` auto-increments and uses the `production` channel.
    - Submit credentials come from EAS. **External credential required:** `EXPO_TOKEN` and the ASC API key.
- **Commands:** `C-MOB`, `C-MOB-SMOKE`
- **Acceptance:**
  - Prebuild succeeds for all 4 variants.
  - The production identifiers equal the M§108 defaults.
  - The bundle is exported.
- **Satisfies:** M§6, M§108, M§109, M§112.

#### T-8.02 · `packages/ui` foundation
- **Depends:** T-1.02, T-1.03, T-8.01
- **Files:** `packages/ui/src/{theme/ThemeProvider.tsx,theme/useTheme.ts,theme/makeStyles.ts,fonts.ts}`, `src/primitives/{Text,Pressable,Button,IconButton,Card,Surface,Divider,Badge,Chip,Switch,SegmentedControl,TextField,Avatar,Skeleton,Spinner}.tsx`, `jest.config.js`, `src/**/__tests__/*.test.tsx`
- **Contents:**
  - **Theme:** System, Açık or Koyu, persisted in MMKV and mirrored to `user_preferences.theme`.
  - **Styles:** `makeStyles` memoizes per scheme.
  - **Accessibility defaults:** every primitive sets role and label, a hit slop of 44 pt or 48 dp, `maxFontSizeMultiplier` and reduce-motion.
  - **Buttons:** 5 variants with pressed, disabled and loading states.
  - **Badges:** only `critical`, `warning` and `success` carry colour.
- **Commands:** `C-MOB`
- **Acceptance:**
  - Snapshot tests exist in both themes.
  - An accessibility-props test covers every primitive.
  - `no-raw-color` lint reports nothing.
- **Satisfies:** M§38, M§92, M§122.

#### T-8.03 · `packages/ui` components
- **Depends:** T-8.02
- **Files:** `packages/ui/src/components/*.tsx`. The full list is in SCREEN_AND_FLOW_MAP §0.3:
  - `LargeTitleHeader`, `NavHeader`, `FilterChipRow`, `MetaLine`
  - `AttentionCard`, `SwipeableRow`, `MailSummaryCard`, `WaitingCard`, `CommitmentCard`, `LifeCard`, `ApprovalCard`, `AICard`
  - `StatusBadge`, `SourceLine`, `SuggestedSurface`, `SectionKicker`, `GroupedList`, `HeroStat`, `StickyCTABar`
  - `Sheet`, `Toast`, `UndoToast`, `EmptyState`, `ErrorCard`, `OfflineBanner`, `ProGateCard`, `SuccessState`
  - `AudioControls`, `ChatInput`, `DraftEditorCard`, `CaptureSourceTiles`, `AnalysisProgressCard`, `ExplainSheetContent`, `FeedbackActions`
- **Contents:**
  - **Sheet:** scrim `rgba(27,25,23,.35)`, radius 28, grabber, opens in 300 ms and closes in 240 ms, light haptic. Android back closes it. It traps focus.
  - **Swipe:** a swipe right means "Tamamlandı". Every swipe action is also available as a button and as an `accessibilityAction`.
  - **SourceLine:** always tappable, and opens the explain sheet from `get_explanation` (RPC-16); its correction path calls `submit_ai_correction` (RPC-17).
  - **SuggestedSurface:** dashed border.
  - **Feedback:** 👍 Doğru and 👎 Önemli değil write to `ai_feedback`. On an insight, "Önemli değil" goes through `apply_insight_feedback`, and its undo through `revert_insight_feedback` (R-24).
- **Commands:** `C-MOB`
- **Acceptance:** Component tests cover every state. A swipe `accessibilityActions` test passes.
- **Satisfies:** M§59, M§93, M§97, M§122, M§123, M§131.

#### T-8.04 · App shell and navigation
- **Depends:** T-8.03
- **Files:**
  - Routes: `app/{_layout,index,+not-found,+native-intent,update-required}.tsx`, `app/(tabs)/_layout.tsx`, `app/(tabs)/{today,flow,plan,assistant}/_layout.tsx`, `app/auth/callback.tsx`, `app/integrations/callback.tsx`, `app/demo/setup.tsx` (compiled only into `DEMO_MODE` builds)
  - Providers: `src/providers/{AppProviders,QueryProvider,AuthProvider,SheetHost,ToastHost}.tsx`
  - Lib: `src/lib/{deeplinks,router-guards,bootstrap}.ts`
- **Contents:**
  - **Tabs:** exactly 4 fixed tabs, "Bugün", "Akış", "Plan" and "Asistan". The active tab shows a filled icon. Each tab keeps its own stack, and re-tapping a tab pops it to the root.
  - **Avatar:** opens `/settings`.
  - **Guards** apply in this order:
    1. auth;
    2. onboarding step;
    3. `min_supported_version` (routes to `update-required`);
    4. account disabled.
  - **Deep links:**
    - Notification payloads, universal links (`https://<web>/app/*`) and share intents map to routes.
    - Unknown links go to `+not-found`, which offers "Bugün'e dön".
  - **Demo setup:** `dijitalasistan://demo/setup?scenario&clock&locale&theme` resets the demo data, pins the clock and sets the language and theme for Maestro store-screenshot and E2E flows. The route does not exist in production builds.
- **Commands:** `C-MOB`
- **Acceptance:** A deep-link table test resolves every route in A9.
- **Satisfies:** M§8, M§37, M§99, M§112.

#### T-8.05 · Auth and secure session
- **Depends:** T-8.04, T-3.11
- **Files:** `app/(auth)/{_layout,sign-in,email-otp}.tsx`, `src/lib/auth/{large-secure-store,supabase,apple,google,microsoft,email-otp,logout,first-run-purge}.ts`, tests
- **Contents:**
  - **Buttons:** "Apple ile devam et", "Google ile devam et", "Microsoft ile devam et", "E-posta ile devam et". On iOS, Apple is shown first.
  - **Apple:** native sign-in with a SHA-256 nonce, then `/auth/apple/exchange`. On Android, Apple sign-in runs through web OAuth.
  - **Google:** native sign-in via `signInWithIdToken`.
  - **Microsoft:** `signInWithOAuth({provider:'azure', skipBrowserRedirect})`, then `openAuthSessionAsync`, then `exchangeCodeForSession`.
  - **Email:** a 6-digit OTP.
  - **Session storage (LargeSecureStore):** the SecureStore key uses `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, and the ciphertext lives in MMKV. The keychain is purged on first run.
  - **Logout** runs the full cleanup:
    - `signOut({scope:'local'})` and `/devices/unregister`;
    - wipes MMKV and the query cache;
    - calls RevenueCat `logOut`;
    - clears the widget snapshot and the NI buffer.

    "Tüm cihazlardan çıkış" uses the `global` scope instead.
- **Commands:** `C-MOB`
- **Acceptance:**
  - After logout, no session remains in storage.
  - No token is written to AsyncStorage (lint plus test).
- **Satisfies:** M§87, M§88.

#### T-8.06 · Onboarding flow
- **Depends:** T-8.05, T-5.15
- **Files:** `app/(onboarding)/{_layout,welcome,noise,proactive,control,connect-mail,connect-calendar,permissions,personalization,briefing-schedule,vip,analysis,ready,notifications,android-notifications}.tsx`, `src/features/onboarding/**`
- **Contents:**
  - **Order:** M§34, as resolved in C-01. The explainer comes before each OAuth or OS prompt.
  - **Mail and calendar options** are filtered per platform (C-35).
  - **Gating (C-17):** at least one connected source is required; "Şimdilik geç" is also available.
  - **Permissions review:** shows the granted scopes, Data Source Controls and calendar permission.
  - **Personalization** uses chips (SREQ-54).
  - **Briefing schedule:** defaults 08:00 / 13:00 / 19:00. Midday and evening show a lock on Free.
  - **VIP:** suggestions after sync, plus manual add. Saving requires Pro, shown with an honest gate.
  - **Analysis:** progress shown from the real job, polled every 1–2 s (R-19), with the R-15 footer.
  - **Ready:** shows the real count N and has a copy variant for N = 0.
  - **Notifications:** a pre-prompt ("Sadece önemli olduğunda haber verelim.") before the Android 13+ `POST_NOTIFICATIONS` request.
  - **Android NI:** Android only, with the R-15 disclosure copy.
  - **Resuming:** `profiles.onboarding_step` is persisted.
- **Commands:** `C-MOB`
- **Acceptance:**
  - In demo mode, a Maestro flow runs from `01-onboarding` to Today.
  - No step uses a timer-driven animation.
- **Satisfies:** M§34, M§3.

#### T-8.07 · Integrations: connect and accounts
- **Depends:** T-8.05, T-4.01, T-4.11
- **Files:** `app/settings/accounts/{index,[id]}.tsx`, `src/features/integrations/{connect,device-calendar,status}.ts(x)`, tests
- **Contents:**
  - **Connecting a provider:** `/integrations/:provider/start` (with `device_nonce_hash`) → `WebBrowser.openAuthSessionAsync` → `app/integrations/callback` → `POST /integrations/oauth/complete {completion_code, device_nonce}` (R-07) → refetch. The account list is polled while an account is `syncing` (R-19).
  - **Device calendar:**
    - `expo-calendar` asks for access only when the user taps "Bağla".
    - A denied state shows "Takvim erişimi kapalı" and "Ayarları Aç" (`Linking.openSettings()`).
    - Snapshots upload on foreground, on EventKit change, and from the background task.
  - **Status copy** by state: Bağlı, Yeniden bağlan, Hata, Senkronize ediliyor. "Yeniden Bağlan" restarts OAuth.
  - **Disconnect** needs confirmation.
  - **Plan gate:** adding a second account needs Pro.
  - **Permission upgrade:** a scope-upgrade sheet.
- **Commands:** `C-MOB`
- **Acceptance:** Connecting through the demo OAuth reaches the "Bağlı" state from a real row.
- **Satisfies:** M§34, M§40, M§75, M§76.

#### T-8.08 · Today
- **Depends:** T-8.06, T-5.05
- **Files:** `app/(tabs)/today/index.tsx`, `src/features/today/**`
- **Contents:**
  - **Data source:** the `today_overview` RPC (RPC-04).
  - **Header:**
    - "Günaydın, {firstName}".
    - "23 Eylül 2026", formatted in the user's timezone.
    - "Bugün bilmen gereken {n} şey var."
  - **Calls to action:**
    - "Brifingimi Gör".
    - "Dinle · {n} dk", which shows a Pro gate on Free.
  - **Sections:** Priorities, AI insights, Meeting, Deadline, Follow-up, Life.
  - **Also on the screen:** the approval pill "Onay Bekleyenler · {n}", the announcement banner card from the `GET /me/bootstrap` announcements, dismissed through `dismiss_announcement` (R-25), and quick capture.
  - **Offline:** shows the cached Today.
- **Commands:** `C-MOB`
- **Acceptance:**
  - Every count comes from the RPC.
  - All states render.
- **Satisfies:** M§8, M§64, M§93, M§94.

#### T-8.09 · Briefings, audio and weekly
- **Depends:** T-8.08, T-5.08, T-5.09, T-8.27
- **Files:** `app/briefing/[id]/{index,listen}.tsx`, `app/briefings/index.tsx`, `app/weekly/[id]/{index,share}.tsx`, `src/features/briefing/**`
- **Contents:**
  - **Briefing screen:** a narrative page with the 6 sections. Midday and evening variants use the evening gradient, `dusk`.
  - **Listen modal:**
    - play, pause, seek, ±15 s;
    - speeds 1x / 1.25x / 1.5x;
    - chapters;
    - `expo-audio` for file mode, `da-tts` for native mode.
  - **"Yarına Hazırım":** asks for confirmation, then carries items over.
  - **Weekly review:** "Haftan Nasıl Geçti?"
  - **Share:** `react-native-view-shot` captures the privacy-safe card, then the native share sheet opens.
  - **History:** `briefings/index` lists past and skipped briefings.
  - **Failure:** a `failed` briefing offers "Tekrar Dene", which calls `POST /briefings/:id/retry`. Opening a briefing calls `mark_briefing_opened`.
- **Commands:** `C-MOB`
- **Acceptance:**
  - Seek moves exactly ±15 s (a regression guard for the prototype bug).
  - The share card contains no names.
- **Satisfies:** M§9, M§10, M§11, M§12.

#### T-8.10 · Flow
- **Depends:** T-8.08
- **Files:** `app/(tabs)/flow/index.tsx`, `src/features/flow/**`
- **Contents:**
  - **Data:** the `flow_feed` RPC (RPC-05); its `meta` feeds the header counts.
  - **Filters:** Tümü, Önemli, Mail, Takvim, Takip, Kişisel.
  - **Cards:** all 9 card types, plus follow-up and commitment.
  - **Card actions:**
    - swipe to done, dismiss or snooze through `set_insight_status`, with an undo toast;
    - every card action is real.
  - **Rendering:** `FlashList`.
- **Commands:** `C-MOB`
- **Acceptance:** A test asserts every card type's actions.
- **Satisfies:** M§13, M§99, M§125.

#### T-8.11 · Mail Intelligence, Email Detail, AI Reply, Waiting, Follow-ups
- **Depends:** T-8.10, T-5.12, T-6.02
- **Files:** `app/mail/{index,category/[category]}.tsx`, `app/mail/[id]/{index,reply}.tsx`, `app/{waiting,followups}.tsx`, `src/features/{mail,reply,followups}/**`
- **Contents:**
  - **Mail Intelligence:**
    - Built from `mail_intelligence` (RPC-08; `p_account_id` filters by account): "Bugün {n} mail", the 6 categories, and a source/confidence/reason for each.
    - Tapping a category opens a drill-down.
  - **Email Detail:**
    - Shows Sender, Subject, Date, AI Summary, Key Points and Source. The thread summary comes from `POST /mail/threads/:threadId/summary`.
    - The original message sits in an "Orijinal Mail" accordion, fetched on demand.
    - Actions:
      - "Yanıt Hazırla" opens the reply modal.
      - "Görev Oluştur" opens a `task_create` sheet.
      - "Takvime Ekle" starts a `calendar_create` proposal.
      - "Hatırlat" opens the reminder sheet.
      - "Orijinal Maili Aç" hands off to Graph `webLink` or the Gmail URL.
  - **Reply:**
    - Tone switch (4 tones), editor, recipients, and attachments uploaded through `POST /reply-drafts/:id/attachments/upload-url`.
    - "Göndermeyi Onayla" leads to submit, then the approval sheet, then an honest `executing` / `executed` state.
    - If the send scope is missing, a scope-upgrade sheet appears.
  - **Waiting:** grouped Acil / Bugün / Bu hafta.
  - **Follow-ups:** "Takip mesajı hazırla", "Yarın hatırlat" and "Kapat".
- **Commands:** `C-MOB`
- **Acceptance:**
  - There is no send path without approval.
  - Categories are wired correctly (the prototype's swap is not reproduced).
- **Satisfies:** M§14, M§15, M§16, M§17.

#### T-8.12 · Commitments, Life and Event detail
- **Depends:** T-8.10, T-5.03, T-5.04
- **Files:** `app/commitments/{index,[id]}.tsx`, `app/life/[id].tsx`, `app/event/[id].tsx`, `src/features/{commitments,life,event}/**`
- **Contents:**
  - **Commitments:**
    - "Tamamlandı" goes through the RPC.
    - "Ertele" opens a reschedule sheet.
    - "Kaynağı Gör" opens the source.
    - Ambiguous items require confirmation.
  - **Life sheet:** per-type actions from SREQ-25. Amounts are shown only when grounded; otherwise "Kaynakta kesinleşmiyor.".
  - **Event detail:** the meeting link is handed off only for allow-listed domains.
- **Commands:** `C-MOB`
- **Acceptance:** Every action is wired, and the grounding copy renders.
- **Satisfies:** M§18, M§23, M§83.

#### T-8.13 · Plan and calendar intelligence
- **Depends:** T-8.10, T-5.14, T-6.03
- **Files:** `app/(tabs)/plan/index.tsx`, `app/plan/{proposal/[id],conflict/[id]}.tsx`, `src/features/plan/**`
- **Contents:**
  - **Views:** Day and Week. The timeline comes from `plan_range` (RPC-09), which merges events, tasks and commitments; the week density comes from `plan_week_density` (RPC-18).
  - **Proposal flow:**
    1. A proposed block is shown dashed.
    2. The sheet offers "Onayla", "Saati Değiştir" (free slots only) and "İptal".
    3. The approval executes.
    4. The timeline refreshes from provider data.
  - **Conflicts:** options come from `conflicts/options`; resolving creates an approval.
  - **Gating:** advanced planning is gated to Pro.
- **Commands:** `C-MOB`
- **Acceptance:** The Maestro flow `09-plan` passes.
- **Satisfies:** M§19, M§20.

#### T-8.14 · Meeting Prep, summary and post-meeting
- **Depends:** T-8.13, T-5.10
- **Files:** `app/meeting/[eventId]/{prep,summary,post}.tsx`, `src/features/meeting/**`
- **Contents:**
  - **Prep screen:**
    - person, time, purpose, previous communication, recent mails, open loops and both sides' commitments;
    - files only where they really exist;
    - 3 talking points and "2 Dakikalık Özet", played with native TTS or through `POST /meetings/:eventId/prep/audio`;
    - a live "{n} dakika kaldı" countdown.
  - **Links:**
    - tapping a person opens `/person/[id]`;
    - tapping a mail opens `/mail/[id]`;
    - "Toplantıyı Başlat" hands off externally;
    - "Not Al" takes text or voice.
  - **Post-meeting:** the parsed commitment card saves through the approval with "Kaydet" (`approved_via='in_place'`).
- **Commands:** `C-MOB`
- **Acceptance:** The Maestro flows `10-meeting-prep` and `F` pass.
- **Satisfies:** M§21, M§22.

#### T-8.15 · Assistant, Voice, Search and Memory
- **Depends:** T-8.03, T-5.11, T-5.07
- **Files:** `app/(tabs)/assistant/index.tsx`, `app/chat/[threadId].tsx` (M-ASST-02: root stack with tabs hidden; `threadId='new'` is an unsaved thread; params `prompt`, `contactId`, `origin`), `app/{voice,search,memory}.tsx`, `src/features/{assistant,voice,search}/**`
- **Contents:**
  - **Assistant:**
    - Suggested prompts: the 5 from M§24 plus "Ödenmesi gereken bir şey var mı?".
    - Input hint "Dijital hayatına sor…".
    - SSE streaming, source cards, and rich mail / calendar / person cards.
    - The "+" button opens the capture menu.
    - An `action_proposal` event renders a pending approval card that opens the approval sheet (R-04).
  - **Voice:**
    - Full screen with the `night` gradient.
    - On-device `expo-speech-recognition` (tr-TR), with a server fallback.
    - "Brifingimi oku." plays the audio.
    - Any write shows the approval card, and approval is tap-only with `approved_via='voice_card'`. A spoken "onayla" never approves; the hint reads "Onaylamak için karta dokun." (R-03, C-07).
  - **Search:** results route to the right detail screens (SREQ-41).
  - **Memory:** semantic examples, gated to Pro.
- **Commands:** `C-MOB`
- **Acceptance:**
  - Answers render with their citations.
  - Voice never executes a write without an approval tap.
- **Satisfies:** M§24, M§25, M§26, M§95.

#### T-8.16 · Person and VIP
- **Depends:** T-8.15, T-5.06
- **Files:** `app/{person/[id],vip}.tsx`, `src/features/person/**`
- **Contents:**
  - **Person page:** built from `person_intelligence` (RPC-03; Pro sections arrive under `locked_sections` for Free users): last contact, upcoming meetings, open loops, recent topics, user owes, they owe, commitments and related emails.
  - **Person-scoped questions:** "Mehmet hakkında sor…".
  - **VIP:** add or remove on `vip_people` (Pro). Suggestions come from `vip_suggestions` and read like "son 30 günde 14 kez yazıştın". A VIP can also be added by email through `upsert_manual_contact` (R-24). Each VIP has a relationship group and a per-VIP quiet-hours bypass (`bypass_quiet_hours`, R-13).
- **Commands:** `C-MOB`
- **Acceptance:** A VIP toggle changes priority on the next triage (integration test).
- **Satisfies:** M§30.

#### T-8.17 · Universal Capture and share intent
- **Depends:** T-8.03, T-5.13
- **Files:**
  - Routes: `app/capture/{index,[id]}.tsx`.
  - Features: `src/features/capture/**`.
  - Module: `apps/mobile/modules/da-share/{expo-module.config.json,plugin/withDaShare.ts,src/stage.ts}`.
- **Contents:**
  - **Sources:**
    - Fotoğraf: camera or photo picker (system picker, no `READ_MEDIA_IMAGES`).
    - Screenshot.
    - PDF / Dosya via `expo-document-picker`.
    - Link.
    - Metin.
  - **Result screen:** detected type, extracted information, and suggested action.
  - **Flow:** actions go to the approval batch (`approved_via='capture_batch'`; "Geri al" is the R-06 client-side 5 s delay before approve is sent), then a success screen, then Today. Discarding calls `POST /captures/:id/discard` (API-CAP-05).
  - **Share intake:** handled by `ShareIntentProvider`:
    1. stage the files;
    2. validate them (≤5 items, image ≤15 MB, PDF ≤20 MB, text ≤20,000 characters);
    3. route them: signed-out users resume the share after sign-in; Free users hit the Pro gate; Pro users go to capture.
  - **`da-share` plugin:** enforces App Group parity and the Android `singleTask` launch mode.
- **Commands:** `C-MOB`, `C-MOB-SMOKE`
- **Acceptance:** Prebuild shows the share extension and the intent filters. The Maestro flow `14-capture` passes.
- **Satisfies:** M§27, M§28, M§85.

#### T-8.18 · Approval Center, inline approval sheet and Smart Reminder sheet
- **Depends:** T-8.03, T-6.01, T-6.06
- **Files:** `app/approvals/{index,[id]}.tsx`, `app/reminders/new.tsx`, `src/features/{approvals,reminders}/**`, `src/features/approvals/ApprovalSheet.tsx`
- **Contents:**
  - **Approval item:** shows what, why, source, exact change, destination account and side effect.
  - **Actions:** "Onayla", "Düzenle" (typed editors) and "Reddet".
  - **Status badges:** BEKLİYOR, İŞLENİYOR, ONAYLANDI and HATA. "ONAYLANDI" appears only after `executed`.
  - **History** tab.
  - **Reminder presets**, each showing its absolute time:
    - "30 dakika önce"
    - "1 saat önce"
    - "Bu akşam"
    - "Yarın sabah"
    - "Uygun zamanda", with an explanation and a confirmation
    - "Kendin seç", via datetimepicker
  - **Destination picker.**
  - **Device executor:** the calendar or reminder write runs through `expo-calendar`, then the result is posted to `POST /approvals/:id/device-execution` (API-APR-05).
  - **Approve paths and undo:** `approved_via` is `approval_center` here and `inline_sheet` in the inline sheet (R-03). The inline sheet shows "Geri al" for 5 s before it sends the approve request (R-06); if the app closes during the delay, the approval stays `pending`. While an approval is `executing`, the app polls `list_approvals` (R-19).
  - **Offline:** approvals are blocked, with the copy "İnternet gerekli".
- **Commands:** `C-MOB`
- **Acceptance:** The Maestro flows `07`, `08` and `J` pass.
- **Satisfies:** M§29, M§33, M§94, M§115.

#### T-8.19 · Settings
- **Depends:** T-8.04
- **Files:** `app/settings/{index,profile,notifications,briefings,appearance,language,help,feedback,about}.tsx`, `src/features/settings/**`
- **Contents:**
  - **Screen list:** the union from C-18. Every screen reflects real state.
  - **Notifications:** the category toggles; quiet hours (default on, 22:30–07:30) with the "VIP kişilerden gelenler · Sessiz saatlerde bile" bypass (default on; R-13); lock-screen privacy; detail level (full / title_only / generic); "Yalnızca gerçekten önemliyse bildir" (`smart_filter`); the copy "Sadece önemli olduğunda haber veririz." (R-14); and "Test bildirimi gönder" (`POST /notifications/test`).
  - **Briefings:** times, timezone (auto or manual), silent days and the weekend setting.
  - **Appearance:** System / Açık / Koyu.
  - **Language:** Türkçe / English, stored in `profiles.locale`.
  - **Help:** FAQ from `@da/i18n`, plus contact that creates a ticket.
  - **Feedback:** Bug / Özellik / Genel / AI Kalitesi, with `expo-store-review`.
  - **About:** version, licences and legal links.
- **Commands:** `C-MOB`
- **Acceptance:** Every toggle round-trips to the database (integration test).
- **Satisfies:** M§35, M§38, M§39, M§62, M§130.

#### T-8.20 · Privacy Center
- **Depends:** T-8.19, T-11.01
- **Files:** `app/settings/privacy/{index,permissions,data-sources,retention,history,export,delete-account}.tsx`, `src/features/privacy/**`
- **Contents:**
  - **Statements:** the three M§40 statements, the no-training statement and the R-15 storage sentence.
  - **Permissions:** scopes and OS permissions, with "Sistem Ayarlarına Git".
  - **Data Source Controls:** per account.
  - **Retention:** 30 gün / 90 gün / 1 yıl / Ben silene kadar.
  - **Delete history (R-16):** the counts from `history_deletion_preview` and the consequences, explicit confirmation, and re-authentication with the same contract as account deletion; then `POST /privacy/delete-history`, a queued job and an honest status.
  - **Export:** request, then status, then download through `POST /privacy/export/:id/download` (a 300 s signed URL while the archive is available for 24 h).
  - **Delete account:** a multi-step flow: consequences, re-auth (biometric via `expo-local-authentication` or OTP), type-to-confirm, then a queued status.
- **Commands:** `C-MOB`
- **Acceptance:** The UI never shows "deleted" before the job completes.
- **Satisfies:** M§40, M§41, M§128, M§129.

#### T-8.21 · AI Personalization and Priority Rules
- **Depends:** T-8.19, T-1.07
- **Files:** `app/settings/{personalization,priority-rules/index,priority-rules/[id]}.tsx`, `src/features/rules/**`
- **Contents:**
  - **Learned preferences:** edit (High / Normal / Low), disable or delete, plus the "Etkileşimlerimden öğren" toggle.
  - **Priority rules:** full CRUD for all rule types, with a preview via `preview_priority_rule` and the precedence explanation.
- **Commands:** `C-MOB`
- **Acceptance:** A rule overrides the AI result in a test.
- **Satisfies:** M§31, M§32.

#### T-8.22 · Paywall, subscription, Pro gates and referral
- **Depends:** T-7.02, T-7.03, T-8.19
- **Files:** `app/{paywall}.tsx`, `app/settings/{subscription,referral}.tsx`, `src/features/{paywall,subscription,referral}/**`, `src/lib/purchases.ts`
- **Contents:**
  - **Purchases setup:** `Purchases.configure` with the platform key (Test Store key outside production), plus `logIn(userId)`.
  - **Offerings:** show `priceString` and the computed annual savings. Trial copy appears only when the user is eligible.
  - **Purchase flow:** buy, then `/purchases/sync`. Success shows only once the `pro` entitlement is active (F-07).
  - **Restore and manage:** "Satın Alımları Geri Yükle" and "Aboneliği Yönet" (`showManageSubscriptions`).
  - **Paywall chrome:** Terms and Privacy links, and a close button. The Android NI benefit is hidden on iOS.
  - **Subscription screen:** shows the real status.
  - **Referral:** "Arkadaşını Davet Et" with native share and code entry.
  - **Contextual Pro gate** from design 7.6.
- **Commands:** `C-MOB`
- **Acceptance:** The Maestro flows `15-paywall` (Test Store) and `16-referral` pass.
- **Satisfies:** M§43, M§44, M§45.

#### T-8.23 · Offline, persistence and mutation queue
- **Depends:** T-8.04
- **Files:** `src/lib/offline/{persister,online-manager,mutation-queue}.ts`, tests
- **Contents:**
  - **Persistence:** `createAsyncStoragePersister` over encrypted MMKV. Only queries marked `meta.persist` are dehydrated, and mail bodies never are.
  - **Online state:** NetInfo drives `onlineManager`.
  - **Mutation queue:** only internal writes are queued, and they are replayed in order with idempotency keys. Approvals are blocked, not queued.
  - **UI:** an offline banner with "Son güncelleme {saat}".
- **Commands:** `C-MOB`
- **Acceptance:** A replay after reconnect creates no duplicates. The Maestro flow `19-offline-reconnect` passes.
- **Satisfies:** M§87, M§94.

#### T-8.24 · Push registration, notification routing and local reminders
- **Depends:** T-8.04, T-6.07
- **Files:** `src/lib/notifications/{register,channels,handlers,local-reminders}.ts`, tests
- **Contents:**
  - **Registration:** `getExpoPushTokenAsync({projectId})`, then `/devices/register`.
  - **Android channels (R-12):** `briefings`, `critical_email`, `meetings`, `deadlines`, `follow_up`, `life_intel`, `approvals`, `reminders`, `account` and `phone_digest` (Android NI only). Names are localized, every channel uses `lockscreenVisibility = PRIVATE` (including `account`), and all are created at first launch, before the permission prompt.
  - **Tap handling:** a tapped notification routes through the deep-link map.
  - **Local reminders:** scheduled for reminder rows and cancelled when the reminder is cancelled.
  - **Permission:** the pre-prompt is shown again at most once.
- **Commands:** `C-MOB`
- **Acceptance:** A payload-to-route test covers every notification type.
- **Satisfies:** M§35, M§86, M§96.

#### T-8.25 · Widgets
- **Depends:** T-8.08, T-1.16
- **Files:**
  - iOS target: `apps/mobile/targets/widget/{expo-target.config.js,index.swift,Provider.swift,Views/*.swift,Assets.xcassets}`
  - Module: `apps/mobile/modules/da-widgets/{expo-module.config.json,android/src/main/java/expo/modules/dawidgets/{DaWidgetsModule,DaTodayWidget,DaNextWidget,Receivers,SnapshotStore}.kt,android/src/main/res/xml/*.xml,ios/DaWidgetsModule.swift,plugin/withDaWidgets.ts,src/index.ts}`
  - App code: `src/features/widgets/snapshot.ts`
- **Contents:**
  - **Snapshot:** fetched from `GET /widgets/snapshot` (API-WDG-01) as `WidgetSnapshotV1`, already filtered by the detail mode, and written to the App Group / Glance store.
  - **iOS families:** small, medium and large, plus the lock-screen `accessoryInline`, `accessoryCircular` and `accessoryRectangular`.
  - **Android sizes:** 4×2 and 2×2.
  - **Deep links** go to real routes. Widgets are read-only.
  - **Refresh triggers:** foreground, a Today refetch, a push, a settings change, the background task, and sign-out (which clears the widget).
- **Commands:** `C-MOB`, `C-MOB-SMOKE`
- **Acceptance:**
  - Prebuild contains the widget target and the receivers.
  - The snapshot unit test confirms no names appear in `generic` mode.
  - The native render is verified in an EAS build.
- **Satisfies:** M§37.

#### T-8.26 · Android Notification Intelligence
- **Depends:** T-8.19, T-7.02
- **Files:**
  - Module: `apps/mobile/modules/notification-intelligence/{expo-module.config.json,android/src/main/AndroidManifest.xml,android/src/main/java/expo/modules/notificationintelligence/{NotificationIntelligenceModule,DaNotificationListenerService,SignalExtractor,PackageRules,EncryptedBuffer}.kt,ios/NotificationIntelligenceModule.swift,src/index.ts}`
  - Screens: `app/settings/android-notifications.tsx`
  - Uploader: `src/features/android-ni/upload.ts`
- **Contents:**
  - **Service:** a `NotificationListenerService` with `<queries>` for launchers (no `QUERY_ALL_PACKAGES`).
  - **Consent:** explicit opt-in behind a prominent disclosure.
  - **Modes:** selected apps (default) or all apps.
  - **Locked denylist:** authenticators, password managers, e-Devlet, banking, and an OTP detector.
  - **Processing:** structured signals are extracted on-device and batch-uploaded to `/android-notifications/signals`. Raw text never leaves the device.
  - **UI:**
    - The switch reflects the real system grant.
    - The copy matches on-device processing (C-12) and uses the R-15 text "Bildirim içerikleri cihazında işlenir; yalnızca çıkarılan bilgiler (ör. kargo durumu, tutar, tarih) hesabına kaydedilir. Doğrulama kodları ve güvenlik uygulamaları her zaman hariç tutulur."
    - NI digest pushes use the `phone_digest` channel (R-12).
    - The feature is Pro only.
  - **iOS:** a stub reports `isSupported:false`, and the row is hidden.
- **Commands:** `C-MOB`, `C-MOB-SMOKE`
- **Acceptance:**
  - Prebuild merges the service into the manifest.
  - A unit test asserts the uploaded payload has no text fields.
  - Device behaviour is verified in an EAS or emulator build.
- **Satisfies:** M§36, M§91, M§141.

#### T-8.27 · Native TTS synth-to-file module (`da-tts`)
- **Depends:** T-8.01
- **Files:** `apps/mobile/modules/da-tts/{expo-module.config.json,ios/DaTtsModule.swift,android/src/main/java/expo/modules/datts/DaTtsModule.kt,src/index.ts}`, tests
- **Contents:**
  - **iOS:** `AVSpeechSynthesizer.write`.
  - **Android:** `TextToSpeech.synthesizeToFile`.
  - Both use a tr-TR voice and write one file per chapter to the cache.
  - The briefing player uses these files for seek and speed.
- **Commands:** `C-MOB`, `C-MOB-SMOKE`
- **Acceptance:** The JS contract test passes. Native output is verified in EAS.
- **Satisfies:** M§9, M§25.

#### T-8.28 · Analytics, Sentry and performance
- **Depends:** T-8.04
- **Files:** `src/lib/{analytics,sentry,perf}.ts`
- **Contents:**
  - **Analytics:** a batcher for the R-21 catalogue (`@da/domain` `src/analytics/events.ts`) that sends to `/analytics/events` and respects opt-out.
  - **Sentry:** `@sentry/react-native` with PII scrubbing, and no screenshots of content screens.
  - **Performance:** FlashList for long lists, `expo-image` caching, and a startup budget measured in preview builds.
- **Commands:** `C-MOB`
- **Acceptance:** A test asserts no event carries free text.
- **Satisfies:** M§42, M§110, M§125.

#### T-8.29 · Accessibility, dark mode and pseudo-locale pass
- **Depends:** T-8.08…T-8.26
- **Files:** `apps/mobile/src/**` (fixes), `apps/mobile/test/a11y/*.test.tsx`
- **Contents:**
  - **Screen-level checks:** labels, roles, focus order, Dynamic Type at maximum, hit targets, and reduce-motion.
  - **Themes:** dark theme across every screen, with no hard-coded white.
  - **Text expansion:** a +40% pseudo-locale run.
  - **Motion:** timings follow the token motion values.
- **Commands:** `C-MOB`
- **Acceptance:**
  - The accessibility test suite passes for every route.
  - The Maestro dark-mode flow passes.
- **Satisfies:** M§38, M§92, M§123.

#### T-8.30 · Mobile tests and Maestro flows
- **Depends:** T-8.29
- **Files:** `apps/mobile/e2e/maestro/{01-onboarding,02-auth,03-gmail-connect,04-calendar-connect,05-briefing,06-important-mail,07-reply-approval,08-reminder,09-plan,10-meeting-prep,11-commitment,12-assistant,13-search,14-capture,15-paywall,16-referral,17-dark-mode,18-privacy,19-offline-reconnect,a-…j-}.yaml`, `apps/mobile/e2e/maestro/config.yaml`
- **Contents:**
  - **Flow coverage:** every M§102 item plus the SREQ-100 flows A–J.
  - **Environment:** flows run against the demo stack, with demo OAuth and the fixture LLM.
  - **Offline flow:** uses `setAirplaneMode`, which is Android only. On iOS the offline layer is covered by component tests.
- **Commands:** `maestro test apps/mobile/e2e/maestro` (CI and EAS only)
- **Acceptance:** Green on the Android emulator in CI and on iOS EAS Workflows.
- **Satisfies:** M§101, M§102.

#### T-8.31 · Store readiness config
- **Depends:** T-8.01
- **Files:** `apps/mobile/app.config.ts` (permission strings in tr/en, `privacyManifests`, `associatedDomains`, `intentFilters`), `apps/mobile/src/i18n/native-strings.ts`
- **Contents:**
  - **Permission strings:** following INTEGRATION_PLAN §12.8.
  - **iOS privacy manifest:** `NSPrivacyTracking: false`, plus the declared API reasons.
  - **Encryption declaration:** `ITSAppUsesNonExemptEncryption: false`.
  - **Android:** `allowBackup: false`, and blocked permissions (media, location, contacts, `QUERY_ALL_PACKAGES`, `AD_ID`).
  - **Links:** universal links and app links for `/app` and `/r`.
- **Commands:** `C-MOB-SMOKE`
- **Acceptance:** The prebuilt `Info.plist` and `AndroidManifest.xml` contain the expected keys (checked by the smoke script).
- **Satisfies:** M§112.

### Step 9 — Marketing web

#### T-9.01 · Web scaffold
- **Depends:** T-1.02, T-1.03, T-1.04
- **Files:** `apps/web/{package.json,next.config.ts,postcss.config.mjs,tsconfig.json,vitest.config.ts,playwright.config.ts}`, `apps/web/src/{proxy.ts,env.ts,i18n/request.ts,i18n/routing.ts,app/[locale]/layout.tsx,app/globals.css}`
- **Contents:**
  - **Package and build:** `@da/web`, `reactCompiler`, and `cacheComponents: true`.
  - **Styling:** Tailwind v4, importing `@da/design-tokens/tokens.css`.
  - **Routing:** next-intl with `localePrefix: 'as-needed'` (tr default, `/en` for English).
  - **Fonts:** Geist and Lora via `next/font`.
  - **Environment:** `@t3-oss/env-nextjs`, with a server/client split.
  - **Middleware:** `proxy.ts` handles locale routing and excludes `/.well-known`, `/app` and `/r`.
- **Commands:** `C-WEB`
- **Acceptance:** `next build` passes.
- **Satisfies:** M§6, M§73.

#### T-9.02 · Landing page
- **Depends:** T-9.01
- **Files:** `apps/web/src/app/[locale]/page.tsx`, `apps/web/src/components/landing/{Hero,Integrations,HowItWorks,MorningBriefing,MailIntelligence,MeetingPrep,SmartPlanning,AiMemory,Security,Pricing,Faq,FinalCta,StoreBadges,QrCta,Nav,Footer}.tsx`
- **Contents:**
  - **Hero:** the M§73 copy, a phone mockup and trust text.
  - **Navigation:** Özellikler, Güvenlik, Fiyatlandırma, SSS and Ücretsiz Başla. There is no Giriş link.
  - **Integration logos:** follow the brand guidelines.
  - **Copy truthfulness:** no "Sınırsız" and no "Kredi kartı gerekmez".
  - **Breakpoints:** below 768, 768–1199, and 1200 and above.
- **Commands:** `C-WEB`
- **Acceptance:** Playwright confirms the sections and the CTA.
- **Satisfies:** M§73, M§141.

#### T-9.03 · Pricing and legal pages
- **Depends:** T-9.01
- **Files:** `apps/web/src/app/[locale]/{pricing,privacy,terms}/page.tsx`, `packages/i18n/messages/{tr,en}/legal.json`
- **Contents:**
  - **Pricing:** prices shown as "mağaza fiyatı" ranges, with a note that the store price is authoritative, and no trial claims. The Free limits come from `GET /public-api/plans` (PUB-05), which mirrors `plan_limits`.
  - **Privacy:** includes the Google Limited Use statement, AI sub-processors and cross-border transfer, retention, rights and the no-training statement.
  - **Terms:** Terms of Service.
  - **Legal review:** a **Manual external step** before launch.
- **Commands:** `C-WEB`
- **Acceptance:** The pages render in both locales.
- **Satisfies:** M§73, M§137.

#### T-9.04 · Support, data deletion and `public-api`
- **Depends:** T-9.01, T-3.02
- **Files:** `apps/web/src/app/[locale]/{support,data-deletion}/page.tsx`, `apps/web/src/app/actions/{support,deletion}.ts`, `supabase/functions/public-api/{index.ts,routes/{support,data-deletion,referrals}.ts}`, tests
- **Contents:**
  - **Support:**
    - The FAQ comes from `@da/i18n`.
    - The form posts to `POST /public-api/support`, which is rate-limited and creates a `support_tickets` row with `source: web`. A honeypot field applies, and Cloudflare Turnstile is verified when `TURNSTILE_SECRET_KEY` is configured (**External credential required** for production anti-spam).
  - **Data deletion:**
    - `POST /public-api/data-deletion/start` sends the OTP through GoTrue and always returns a generic response.
    - `POST /public-api/data-deletion/verify` verifies the OTP, creates a `data_deletion_requests` row (`account`, `web`), enqueues the job, and returns a status token.
    - `GET /public-api/data-deletion/:requestId/status?token=` (PUB-07) shows the honest request status after the session is gone.
- **Commands:** `C-WEB`, `C-FN`
- **Acceptance:**
  - There is no way to enumerate accounts.
  - A deletion request is created.
- **Satisfies:** M§62, M§73, M§129.

#### T-9.05 · Referral landing, OAuth done, universal-link fallback and well-known files
- **Depends:** T-9.01
- **Files:** `apps/web/src/app/r/[code]/page.tsx`, `apps/web/src/app/oauth/done/page.tsx`, `apps/web/src/app/app/[[...path]]/page.tsx`, `apps/web/src/app/get/route.ts`, `apps/web/src/app/.well-known/{apple-app-site-association,assetlinks.json,security.txt,microsoft-identity-association.json}/route.ts`
- **Contents:**
  - **`/r/[code]`:** resolves the code, then opens the app or the store.
  - **`/oauth/done`:** hands off to the app scheme.
  - **`/app/*`:** a fallback page with store badges.
  - **AASA file:** built from `APPLE_TEAM_ID` and the bundle IDs.
  - **assetlinks file:** built from `ANDROID_SHA256_CERT_FINGERPRINTS`.
  - Both are served as JSON with no redirect.
  - **`/get`:** a 302 store redirector (iOS → App Store, Android → Play, desktop → `/#download`).
  - **`security.txt`** and **`microsoft-identity-association.json`** (the Entra publisher-domain file carrying the client ID).
- **Commands:** `C-WEB`
- **Acceptance:** A Playwright check of the well-known files' content type and body passes.
- **Satisfies:** M§45, M§112.

#### T-9.06 · SEO, Open Graph, sitemap, robots, headers and CSP
- **Depends:** T-9.02…T-9.05
- **Files:** `apps/web/src/app/{sitemap.ts,robots.ts,[locale]/opengraph-image.tsx}`, `apps/web/next.config.ts` (headers)
- **Contents:**
  - **Metadata:** per-page metadata with `hreflang` alternates.
  - **Security headers:** CSP with a nonce, HSTS, nosniff, and a Referrer-Policy.
  - **Rendering:** SSG and ISR.
  - **Web events:** `POST /public-api/web-events` (PUB-06) records allow-listed, content-free web events into `web_analytics_daily`; no row exists per visit.
- **Commands:** `C-WEB`
- **Acceptance:** SEO checks in Playwright pass. Lighthouse scores at least 90 in CI.
- **Satisfies:** M§73, M§104, M§125.

#### T-9.07 · Marketing assets
- **Depends:** T-9.02, T-2.24
- **Files:** `apps/web/src/app/(assets)/assets/{store,social,pricing}/[slug]/page.tsx`, `scripts/marketing/render-assets.ts`, `design/marketing/output/` (committed PNGs)
- **Contents:**
  - **Store screenshots:** 6 concepts with the M§74 captions, rendered from demo data.
  - **Social:** 3 ads at 9:16 (1080×1920). AD3 is written in the brand voice, not as a testimonial.
  - **Other visuals:** feature and pricing visuals.
  - **Rendering:** Playwright renders the pages to PNG.
- **Commands:** `node scripts/marketing/render-assets.ts`
- **Acceptance:** The asset PNGs are produced, and their numbers match the demo dataset.
- **Satisfies:** M§74.

#### T-9.08 · Web tests
- **Depends:** T-9.06
- **Files:** `apps/web/e2e/{landing,pricing,legal,support,data-deletion,referral,seo,responsive,keyboard}.spec.ts`, `apps/web/src/**/__tests__/*.test.tsx`
- **Contents:**
  - **Axe scans** with `@axe-core/playwright`.
  - **Viewports:** 375, 768 and 1280.
  - **Keyboard:** full tab navigation.
  - **Browser:** tests run on `PLAYWRIGHT_CHROMIUM_EXECUTABLE` in the container.
- **Commands:** `C-WEB`, `C-E2E` (web)
- **Acceptance:** All specs pass.
- **Satisfies:** M§92, M§104.

### Step 10 — Backoffice

#### T-10.01 · `admin-api` core
- **Depends:** T-3.03, T-2.17
- **Files:** `supabase/functions/admin-api/{index.ts,middleware/{auth,session,permission,audit,ratelimit}.ts,routes/{auth,session,me}.ts}`, `_shared/email/{provider,postmark}.ts`, tests
- **Contents:**
  - **Configuration:** `verify_jwt=false`, with the JWT verified in code.
  - **BFF-key routes** (no user session): `/auth/preflight`, `/auth/attempt`, `/auth/invite/redeem`, `/auth/recovery-code/redeem`.
  - **Checks on every other route:** `aal2`, active admin, idle ≤30 min and absolute ≤12 h, permission, rate class (R/S/M/X), and audit.
  - **Session routes:** `/session/start`, `/session/heartbeat`, `/session/step-up`, `/session/end`, `/session/logout-all` and `/me` (API_CONTRACTS ADM-00 names; `logout-all` replaces the earlier `end-all` spelling).
  - **Email:** an adapter using Postmark. **External credential required.**
  - **Module routes:** added by T-10.05 through T-10.14. They follow the BACKOFFICE_PLAN §12 catalogue and call the `admin_api` SQL.
- **Commands:** `C-FN`
- **Acceptance:** `aal1`, idle, revoked and wrong-permission requests are all rejected (the matrix test).
- **Satisfies:** M§47, M§48.

#### T-10.02 · Backoffice scaffold and security
- **Depends:** T-1.02, T-1.04
- **Files:** `apps/backoffice/{package.json,next.config.ts,components.json,tsconfig.json,vitest.config.ts,playwright.config.ts}`, `apps/backoffice/src/{proxy.ts,env.ts,server/admin-api.ts,server/action.ts,server/supabase.ts,app/layout.tsx,app/globals.css}`
- **Contents:**
  - **Package:** `@da/backoffice`, set up with shadcn 4.21 (`pnpm dlx shadcn@4.21.0 init`).
  - **Auth client:** `@supabase/ssr` with the cookie `__Host-da_admin` (httpOnly, Secure, SameSite=Strict, no domain).
  - **`proxy.ts`:**
    - a nonce-based CSP, HSTS and `X-Robots-Tag: noindex`;
    - rejects mutations whose `Origin` is missing or foreign;
    - rate limiting.
  - **Server actions:** wrapped by `server/action.ts`, which checks `Origin`, requires a reason where needed, attaches an idempotency key and maps errors.
  - **Theme:** light by default, stored in the `__Host-da_admin_theme` cookie and mirrored to `admin_preferences`.
  - **i18n:** next-intl.
  - **Secrets:** no Supabase secret key is present.
- **Commands:** `C-BO`
- **Acceptance:**
  - `next build` passes.
  - A bundle scan finds no secret.
  - A server action without an `Origin` returns 403.
- **Satisfies:** M§46, M§48, M§72.

#### T-10.03 · Admin auth screens, session lifecycle and bootstrap
- **Depends:** T-10.01, T-10.02
- **Files:** `apps/backoffice/src/app/(auth)/{login,mfa,invite,forbidden}/page.tsx`, `src/components/session-watcher.tsx`, `scripts/admin-bootstrap.ts`
- **Contents:**
  - **Login:** the first factor is an email one-time code (`signInWithOtp` with `shouldCreateUser:false`, generic responses) behind a preflight lockout.
  - **MFA:** TOTP enrolment or challenge, which yields `aal2`, followed by recovery codes.
  - **Invite:** a button-only page, so link prefetchers cannot consume the invite.
  - **Session watcher:** a warning at T−2 min and redirects for idle, absolute and revoked sessions.
  - **Logout:** "Çıkış yap" and "Tüm oturumlardan çık".
  - **Bootstrap:** `pnpm admin:bootstrap` refuses to run if an active super_admin already exists. This is a **Manual external step**.
- **Commands:** `C-BO`
- **Acceptance:** Playwright covers login → MFA → dashboard → logout, and the idle expiry (with fake timers).
- **Satisfies:** M§48, M§68, M§103.

#### T-10.04 · Shell and UI kit
- **Depends:** T-10.03
- **Files:** `apps/backoffice/src/app/(admin)/layout.tsx`, `src/components/{sidebar,command-palette,theme-toggle,data-table/*,confirm-dialog,masked-value,reveal-button,charts/*,states/*,page-header}.tsx`
- **Contents:**
  - **Sidebar:** exactly the M§46 structure, filtered by permission (a cosmetic filter only).
  - **Command palette:** Cmd/Ctrl+K, searching IDs and masked emails through `admin_api.command_search`. Destructive commands open the confirm dialog.
  - **DataTable:** TanStack Table v9 (`useTable({features})`), with server-side pagination, sorting and filtering, column visibility (persisted), loading, empty, error and retry states, and URL state via `nuqs`.
  - **ConfirmDialog:** a reason field and a typed confirmation.
  - **MaskedValue and reveal:** reveal requires a permission, a reason and an audit entry.
  - **Charts:** Recharts, theme-aware.
- **Commands:** `C-BO`
- **Acceptance:** Kit component tests pass. Axe finds no issues.
- **Satisfies:** M§69, M§70, M§71, M§72, M§125.

#### T-10.05 · Dashboard and metric rollups
- **Depends:** T-10.04
- **Files:** `apps/backoffice/src/app/(admin)/dashboard/page.tsx`, `supabase/migrations/20260924001800_metrics_rollups.sql` (`metrics_daily`, `ai_metrics_daily`, `private.rollup_metrics_daily`)
- **Contents:**
  - **Counters:** total, active, new, Pro, trial, connected emails and calendars, AI requests and cost, briefings, pushes.
  - **Charts:** user growth, active usage, AI cost, subscriptions, sync failures.
  - **Ranges:** 24h, 7d, 30d, 90d.
  - **Product metrics:** from M§119.
  - **Exclusions:** demo and internal users are excluded.
  - **Rollups:** `private.rollup_metrics_daily` fills `metrics_daily` and `ai_metrics_daily`. It is invoked from `scheduler_tick`, not by a separate cron job (DATABASE_AND_RLS_PLAN §9 keeps 8 jobs).
- **Commands:** `C-BO`, `C-DB`
- **Acceptance:** Metric values on fixtures match their definitions.
- **Satisfies:** M§50, M§119.

#### T-10.06 · Users and user detail
- **Depends:** T-10.04
- **Files:** `apps/backoffice/src/app/(admin)/users/page.tsx`, `users/[id]/{layout,overview,integrations,briefings,usage,subscription,referrals,support,audit}/page.tsx`, `src/server/actions/users.ts`
- **Contents:**
  - **Users table:** the M§51 columns and filters, with server-side pagination.
  - **User detail:** 8 tabs.
  - **Actions:** Force Sync, Disable, Restore, Temporary Pro Grant (1, 7, 14 or 30 days) and Disconnect Integration. Each requires a reason, a confirmation and an audit entry, plus step-up where marked.
- **Commands:** `C-BO`
- **Acceptance:** E2E `user-search`, `user-detail` and `entitlement-grant` pass.
- **Satisfies:** M§51, M§61.

#### T-10.07 · Support and Support Access
- **Depends:** T-10.06
- **Files:** `apps/backoffice/src/app/(admin)/support/{page,[id]/page}.tsx`, `src/server/actions/support.ts`
- **Contents:**
  - **Tickets:** statuses and categories from M§62, with assignment, notes and replies (via the email adapter). Inbound replies arrive through `POST /public-api/support/inbound-email` (PUB-08, basic auth `EMAIL_INBOUND_BASIC_AUTH`) as `support_notes`.
  - **Support Access (R-09):** only roles holding `support.access` (`support`, `super_admin`) can open a grant. A grant needs a reason, a duration of 15, 30 or 60 minutes (never more) and scopes from `pii`, `email_metadata`, `insights`, `notifications`, `captures` (extracted data only, never files), `assistant_transcript` and `ai_feedback`. Tokens, secrets, passwords, provider fetches of the original mail, and attachments or files are never reachable. The grant and every reveal are logged in `audit_logs` and `support_access_grants`.
  - **No impersonation.**
- **Commands:** `C-BO`
- **Acceptance:** E2E `support` passes. A reveal writes an audit row.
- **Satisfies:** M§49, M§62.

#### T-10.08 · Integrations and Sync & Jobs
- **Depends:** T-10.04
- **Files:** `apps/backoffice/src/app/(admin)/{integrations,jobs,jobs/[id]}/page.tsx`
- **Contents:**
  - **Integrations:** healthy, needs reconnect, OAuth or refresh error, watch issues, last sync. No tokens are shown.
  - **Jobs:**
    - statuses and types from M§53;
    - safe retry via `job_retry`, with policy per type;
    - dead-letter view;
    - a correlation trace from user to notification.
- **Commands:** `C-BO`
- **Acceptance:** E2E `integration-view` and `job-retry` pass.
- **Satisfies:** M§52, M§53, M§118.

#### T-10.09 · Briefings and Notifications operations
- **Depends:** T-10.04
- **Files:** `apps/backoffice/src/app/(admin)/{briefings,notifications}/page.tsx`
- **Contents:**
  - **Briefings:** scheduled, generated, delivered, failed and skipped counts, plus latency and cost, each per kind.
  - **Notifications:** scheduled, sent, failed, suppressed and deduplicated, with suppression reasons and safe per-user debugging.
  - **Push test:** `POST /notifications/test-push` (permission `push.test`) sends the generic "Dijital Asistan" / "Test bildirimi" content and never bypasses quiet hours (R-13).
- **Commands:** `C-BO`
- **Acceptance:** E2E `briefing-operation` passes.
- **Satisfies:** M§54, M§55.

#### T-10.10 · AI Operations, model config, prompts and AI feedback
- **Depends:** T-10.04
- **Files:** `apps/backoffice/src/app/(admin)/ai/{page,models/page,prompts/page,prompts/[key]/page,feedback/page}.tsx`
- **Contents:**
  - **AI Operations:** requests, tokens, cost, latency (p50 and p95) and error rate, broken down by M§56 feature and by model.
  - **Model config:** classifier, reasoning, embedding, TTS and STT models, and the routing profile. Each shows whether it is configured; secrets are never shown. Changes are audited. Embedding slots accept only 1024-d models (`voyage-4` / `voyage-4-lite`; R-01), and `claude-fable-*` IDs are rejected (R-02).
  - **Prompts:** draft, active and archived versions, a diff view, and activate/rollback.
  - **AI feedback:** aggregates only.
- **Commands:** `C-BO`
- **Acceptance:** E2E `ai-cost` and `prompt-activation` pass.
- **Satisfies:** M§56, M§57, M§58, M§59.

#### T-10.11 · Subscriptions, entitlements and referrals
- **Depends:** T-10.04
- **Files:** `apps/backoffice/src/app/(admin)/{subscriptions,referrals}/page.tsx`
- **Contents:**
  - **Subscriptions:** active Pro, trials, cancelled, expired, refunded, MRR, ARR estimate, webhook events, products, renewals and store. Store entitlements are shown separately from grants.
  - **Referrals:** invites, successes, conversion, bonus days and flags, with review approve/reject that requires a reason.
- **Commands:** `C-BO`
- **Acceptance:** Tests pass on fixture data.
- **Satisfies:** M§60, M§61, M§62.

#### T-10.12 · Feedback, feature flags and announcements
- **Depends:** T-10.04
- **Files:** `apps/backoffice/src/app/(admin)/{feedback,flags,announcements}/page.tsx`
- **Contents:**
  - **Feedback:** types, status, assignment, platform and version.
  - **Flags:** targeting (global, percentage, platform, plan, version), a kill switch, and audit. Keys are the R-10 set; `flags.write_ai` limits `ai_ops` to the `ai.*` and `voice.*` keys.
  - **Announcements:** fields per M§64, with preview, schedule and cancel.
- **Commands:** `C-BO`
- **Acceptance:** E2E `feature-flag` passes.
- **Satisfies:** M§62, M§63, M§64.

#### T-10.13 · Data requests and audit logs
- **Depends:** T-10.04, T-11.01…T-11.03
- **Files:** `apps/backoffice/src/app/(admin)/{data-requests,audit}/page.tsx`
- **Contents:**
  - **Data requests:** Exports, History Deletion and Account Deletion tabs, showing the `export_status` / `deletion_status` values, with retry.
  - **Audit log:** timestamp, admin, role, action, target, reason and result, plus a "Zinciri doğrula" check. There is no delete path.
- **Commands:** `C-BO`
- **Acceptance:** E2E `data-request` and `audit` pass.
- **Satisfies:** M§65, M§66.

#### T-10.14 · System health, observability, admin users and settings
- **Depends:** T-10.04, T-3.07
- **Files:** `apps/backoffice/src/app/(admin)/{health,admins,settings}/page.tsx`
- **Contents:**
  - **Health:** the M§67 probes with their real statuses and a "Şimdi çalıştır" button.
  - **Observability:** app versions, platforms, old-version usage, sync-error correlation, and Sentry crash links where configured.
  - **Admin users:** invite, role, status, last login, MFA state, disable and re-enable, with last-super_admin protection. Admin identities are dedicated (`app_metadata.da_kind='admin'`), and an existing app-user email can never become an admin (R-08).
  - **Settings:** session policy, which can only be tightened.
- **Commands:** `C-BO`
- **Acceptance:** A probe with a missing credential shows `external_credential_required`.
- **Satisfies:** M§67, M§68, M§110.

#### T-10.15 · Backoffice tests
- **Depends:** T-10.05…T-10.14
- **Files:** `apps/backoffice/e2e/{login-mfa,dashboard,user-search,user-detail,integration-view,job-retry,briefing-operation,ai-cost,prompt-activation,feature-flag,support,audit,data-request,entitlement-grant,logout,rbac-matrix}.spec.ts`, `apps/backoffice/src/**/__tests__/*.test.ts`
- **Contents:**
  - **Per-role checks:** for every role, forbidden routes return 403 and forbidden actions are rejected by the API, not only hidden.
  - **Axe scans.**
- **Commands:** `C-BO`, `C-E2E` (backoffice, CI tier A)
- **Acceptance:** All specs pass.
- **Satisfies:** M§47, M§103, M§136.

### Step 11 — Privacy and security hardening

#### T-11.01 · Data export
- **Depends:** T-3.06
- **Files:** `worker/handlers/export.ts`, `api/routes/privacy.ts` (`export`, `export/:id/download`), `_shared/services/privacy/export.ts`, tests
- **Contents:**
  - **Contents of the export:** a zip streamed with fflate, with one JSON file per entity and no tokens or secrets.
  - **Storage and access:** written to `exports/{user}/{id}.zip`. The archive is available for 24 hours; each download calls `POST /privacy/export/:id/download`, which mints a signed URL valid 300 s.
  - **Tracking:** status rows, a notification and an audit entry.
- **Commands:** `C-FN`
- **Acceptance:** A test asserts that the archive contains no token fields.
- **Satisfies:** M§128.

#### T-11.02 · History deletion
- **Depends:** T-11.01
- **Files:** `worker/handlers/history_deletion.ts`, `api/routes/privacy.ts` (`delete-history`), tests
- **Contents:**
  - **Request (R-16):** `POST /privacy/delete-history` requires explicit confirmation, the consequences shown from `history_deletion_preview`, and re-authentication with the same contract as account deletion. It queues a `history_deletion` job and writes an audit entry.
  - Deletes insights, briefings, memory chunks, `ai_result_cache` entries, assistant messages, captures (including their files), and priority decisions.
  - Connected accounts are kept.
  - Each step updates the request's status.
- **Commands:** `C-FN`, `C-DB`
- **Acceptance:** Zero derived rows remain after the job.
- **Satisfies:** M§40, M§41.

#### T-11.03 · Account deletion (app and web)
- **Depends:** T-11.02, T-4.13, T-7.01
- **Files:** `worker/handlers/account_deletion.ts`, `api/routes/privacy.ts` (`delete-account`), tests
- **Contents:** The job runs these steps, and each one is resumable:
  1. Stop watches.
  2. Revoke provider access: Google revoke, and Apple SIWA revoke via `appleid.apple.com/auth/revoke`. Microsoft is purged locally.
  3. Delete the RevenueCat customer.
  4. Purge storage.
  5. Delete the auth user, which cascades.
  6. Pseudonymize audit subjects.

  The request status is honest throughout.
- **Commands:** `C-FN`, `C-DB`
- **Acceptance:** No user rows remain and the audit trail keeps only hashes.
- **Satisfies:** M§41, M§129.

#### T-11.04 · Retention engine
- **Depends:** T-3.06
- **Files:** `worker/handlers/retention.ts`, `supabase/migrations/20260924001720_retention_triggers.sql`, tests
- **Contents:**
  - Rows with `expires_at < now()` are purged in batches of 5,000, including embeddings and storage objects.
  - When a user changes their retention setting, `expires_at` is recomputed.
  - System tables follow their own retention schedule.
- **Commands:** `C-FN`, `C-DB`
- **Acceptance:** Expired rows are gone. Non-expired rows stay.
- **Satisfies:** M§41, M§96.

#### T-11.05 · Threat-model verification suite
- **Depends:** T-10.15, T-5.16
- **Files:** `supabase/functions/tests/security/*.test.ts`, `docs/SECURITY.md` (checklist section)
- **Contents:** One test per M§113 threat:
  - token theft;
  - session theft;
  - OAuth misconfiguration;
  - webhook forgery and replay;
  - privilege escalation;
  - SSRF;
  - malicious uploads;
  - prompt injection;
  - AI data exfiltration;
  - cross-tenant access;
  - admin abuse;
  - replayed writes;
  - notification leakage;
  - referral abuse.
- **Commands:** `C-FN`
- **Acceptance:** Every threat has a test that passes.
- **Satisfies:** M§113, M§114.

#### T-11.06 · Secret and bundle scan, env split, headers audit
- **Depends:** T-9.06, T-10.02, T-8.01
- **Files:** `scripts/security/scan-bundles.ts`, `scripts/security/check-env-split.ts`
- **Contents:**
  - The bundle scan greps `.expo-export`, `.next/static` and `.next/server/app` for secret key patterns (`sb_secret_`, `sk-`, `sk_`, `-----BEGIN`) and for every server-only key name.
  - The env-split check confirms the headers are present on both web apps.
- **Commands:** `pnpm scan:bundles`
- **Acceptance:** Both scans come back clean.
- **Satisfies:** M§7, M§152.

### Step 12 — Pipelines, verification, docs, report

#### T-12.01 · Complete CI/CD workflows
- **Depends:** T-0.05, all test tasks
- **Files:** `.github/workflows/ci.yml`
- **Contents:** The pipeline runs these jobs:
  - `install`, `lint`, `typecheck`, `unit`.
  - `db`, using `supabase/setup-cli` and tier A.
  - `functions`: Deno 2.1.4 check, lint and test.
  - `integration`: `supabase functions serve` plus the integration suite.
  - `build-web` and `build-backoffice`.
  - `migrations`: squawk, reset twice, and a type-generation drift check.
  - `e2e-web` and `e2e-backoffice`.
  - `mobile-checks`: `expo install --check`, `expo-doctor`, export, and a prebuild smoke test.
  - `secret-scan` and `quality-gate`.
- **Commands:** push to the branch.
- **Acceptance:** Every job is green.
- **Satisfies:** M§105.

#### T-12.02 · EAS workflows and the mobile E2E pipeline
- **Depends:** T-8.30
- **Files:** `apps/mobile/.eas/workflows/{build-preview,e2e-ios,e2e-android}.yml`, `.github/workflows/mobile-e2e.yml` (`reactivecircus/android-emulator-runner` + Maestro 2.10.0)
- **Contents:**
  - E2E runs against an `e2e` profile build and a seeded tier-A stack.
  - **External credential required:** `EXPO_TOKEN`.
- **Commands:** `eas workflow:run` (CI)
- **Acceptance:** Both platforms pass.
- **Satisfies:** M§102, M§105.

#### T-12.03 · Deploy pipelines
- **Depends:** T-12.01
- **Files:** `.github/workflows/deploy-supabase.yml`, `scripts/deploy/check-secrets.ts`, `docs/DEPLOYMENT.md` (draft)
- **Contents:**
  - **Supabase deploy:**
    - runs in the protected `production` environment with manual approval;
    - runs `supabase link`, `db push`, `config push`, then `functions deploy --use-api` for each function;
    - compares the required secret names against `supabase secrets list`.
  - **Vercel:** Git integration for the `da-web` and `da-backoffice` projects, deployed with `turbo-ignore`. This is a **Manual external step**.
  - **EAS Submit:** done by the owner.
- **Commands:** workflow dispatch
- **Acceptance:** A dry run shows only the missing-secret report.
- **Satisfies:** M§109.

#### T-12.04 · Test completion and coverage gates
- **Depends:** all feature tasks
- **Files:** per-package `vitest.config.ts` and `jest.config.js` thresholds
- **Contents:**
  - Coverage thresholds:
    - `@da/domain` and `@da/validation`: at least 90% lines.
    - Functions `_shared`: at least 80%.
    - UI packages: at least 70%.
  - Every M§101 unit and integration item is mapped to a test in `TEST_PLAN.md`.
- **Commands:** `pnpm test`
- **Acceptance:** Every threshold is met.
- **Satisfies:** M§101.

#### T-12.05 · Build and fix loop
- **Depends:** T-12.04
- **Files:** fixes across the repository
- **Contents:** Run install → lint → typecheck → unit → integration → build and fix the root cause of each failure until everything is green.
- **Commands:** `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm db:test:local && pnpm functions:test && pnpm build && C-MOB-SMOKE`
- **Acceptance:** The whole chain passes in the container and in CI.
- **Satisfies:** M§121, M§134.

#### T-12.06 · E2E runs and fix loop
- **Depends:** T-12.05, T-12.02
- **Files:** fixes
- **Contents:** Playwright (web in the container and in CI; backoffice in CI), Maestro (CI and EAS), then a manual flow audit against the full UI → state → API → DB → provider → approval → refresh chain.
- **Commands:** `C-E2E`
- **Acceptance:** All E2E suites pass.
- **Satisfies:** M§98, M§102–M§104, M§134.

#### T-12.07 · Final quality gate
- **Depends:** T-12.06
- **Files:** `scripts/quality-gate/{run,checks/*}.ts`
- **Contents:** The final checks are:
  - banned markers;
  - empty handlers (lint);
  - fake success: a success toast or state must be preceded by a mutation that resolved successfully (AST check on `onSuccess` usage);
  - fake providers, flagged when they appear outside demo-gated modules;
  - unreachable screens (route files never referenced by navigation);
  - dead navigation (hrefs that are not routes);
  - unhandled async code (`no-floating-promises`);
  - insecure token storage;
  - service keys in clients;
  - missing RLS (queries `pg_class` on tier C);
  - a diff of the No-Dead-Action inventory against DELIVERY_CHECKLIST;
  - Realtime unused (R-19): no client channel subscription and an empty `supabase_realtime` publication;
  - canonical-name drift: retired names such as `get_today`, `mail_digest`, `get_person`, `person_overview`, `search_memory`, `device-result`, `captures/:id/cancel`, `only_important` and `vector(1536)` do not appear.

  The check IDs and patterns are DELIVERY_CHECKLIST §5 (QG-01…QG-27, SG-1…SG-8); banned markers follow R-17.
- **Commands:** `C-GATE`
- **Acceptance:** Zero findings.
- **Satisfies:** M§99, M§100, M§133.

#### T-12.08 · Docs: architecture, database, OAuth, AI, security, privacy
- **Depends:** T-12.07
- **Files:** `docs/{ARCHITECTURE,DATABASE,OAUTH,AI_PIPELINE,SECURITY,PRIVACY}.md`
- **Contents:** These docs describe the system as built, not as planned. They include:
  - diagrams;
  - table and RLS reference (generated section);
  - OAuth scopes;
  - the AI routing and cost model;
  - the threat model with mitigations and residual risks;
  - the privacy statements, with provider no-training terms.
- **Commands:** `C-GATE`
- **Acceptance:** Every file exists and matches the implementation.
- **Satisfies:** M§106, M§113.

#### T-12.09 · Docs: mobile, backoffice, RBAC, deployment, testing, prompts, design mapping, store checklist, limitations, README
- **Depends:** T-12.08
- **Files:** `README.md`, `docs/{MOBILE,BACKOFFICE,BACKOFFICE_RBAC,DEPLOYMENT,TESTING,AI_PROMPTS,DESIGN_MAPPING,STORE_CHECKLIST,KNOWN_PLATFORM_LIMITATIONS}.md`
- **Contents:**
  - **AI_PROMPTS:** generated from the prompt registry.
  - **DESIGN_MAPPING:** each requirement mapped to its screen, component and archive.
  - **STORE_CHECKLIST:** SIWA, account deletion, the share-extension `openURL` risk, the non-IAP referral risk (3.1.1), and the Play Data safety and notification-listener declarations.
  - **README:** quickstart and demo mode.
- **Commands:** `C-GATE`
- **Acceptance:** All files are present.
- **Satisfies:** M§91, M§106, M§112, M§124.

#### T-12.10 · FINAL_IMPLEMENTATION_REPORT and DELIVERY_CHECKLIST closure
- **Depends:** T-12.09
- **Files:** `docs/FINAL_IMPLEMENTATION_REPORT.md`, `docs/DELIVERY_CHECKLIST.md`
- **Contents:**
  - **Report sections:** exactly those in M§138.
  - **Feature matrix:** `| Feature | Status | Tested | External Credential | Notes |`, plus a "Verified where" column (container / CI / EAS / owner).
  - **Owner sandbox checklist** (M§153).
  - **Manual store steps.**
  - **Pricing and AI cost-of-goods flag** (ADR-46).
  - No development diary.
- **Commands:** `C-GATE`
- **Acceptance:** Every M§135–M§137 item has a row, and no row claims container verification for a check that ran only in CI or with the owner.
- **Satisfies:** M§135–M§138, M§140, M§153.

#### T-12.11 · Final push and draft PR
- **Depends:** T-12.10
- **Files:** —
- **Contents:**
  - Run `git push -u origin claude/magical-pascal-edvjgn`.
  - Update the draft PR's description with the report summary and the CI links, using GitHub MCP `create_pull_request` / `update_pull_request` (no `gh` in the container).
- **Commands:** as above.
- **Acceptance:** The PR exists and CI is green.
- **Satisfies:** M§154.

---

## Part C — Milestones and commit plan

Everything happens on branch `claude/magical-pascal-edvjgn`. Each milestone ends with a Conventional Commit, the attribution trailers required by the executing session, and `git push -u origin claude/magical-pascal-edvjgn`. The draft PR is opened after M0 so CI runs on every milestone; it is marked ready only after M12. The build keeps moving forward from one milestone to the next.

| Milestone | Tasks | Commit message | Must be green before the commit |
|---|---|---|---|
| M0 | T-0.01…T-0.07 | `docs: add implementation plan documents` + `chore: scaffold monorepo` | install, format:check, quality gate |
| M1 | T-1.01…T-1.17 | `feat(packages): config, tokens, icons, i18n, domain, validation, api-client` | `C-TS` for all packages, Deno check |
| M2 | T-2.01…T-2.26 | `feat(db): schema, RLS, functions, cron, storage, pgTAP` | tier C green; CI tier A green |
| M3 | T-3.01…T-3.11 | `feat(functions): shared core, worker, health, AI abstraction, api core` | `C-FN` |
| M4 | T-4.01…T-4.13 | `feat(integrations): oauth, google, microsoft, demo, device, webhooks` | `C-FN`, tier A integration |
| M5 | T-5.01…T-5.17 | `feat(ai): triage→briefings→assistant→capture→plan` | `C-FN`, evals |
| M6 | T-6.01…T-6.08 | `feat(approvals): execution, reminders, notifications` | `C-FN`, `C-DB` |
| M7 | T-7.01…T-7.03 | `feat(business): revenuecat, entitlements, referrals` | `C-FN` |
| M8a | T-8.01…T-8.07 | `feat(mobile): app config, ui kit, shell, auth, onboarding, integrations` | `C-MOB`, `C-MOB-SMOKE` |
| M8b | T-8.08…T-8.18 | `feat(mobile): today, briefings, flow, mail, plan, meeting, assistant, capture, approvals` | `C-MOB` |
| M8c | T-8.19…T-8.24 | `feat(mobile): settings, privacy, rules, paywall, offline, push` | `C-MOB` |
| M8d | T-8.25…T-8.31 | `feat(mobile): widgets, android NI, tts, analytics, a11y, maestro, store config` | `C-MOB`, `C-MOB-SMOKE` |
| M9 | T-9.01…T-9.08 | `feat(web): marketing site, legal, support, deletion, SEO, assets` | `C-WEB`, web E2E |
| M10 | T-10.01…T-10.15 | `feat(backoffice): auth, shell, modules, RBAC` | `C-BO`; backoffice E2E (CI) |
| M11 | T-11.01…T-11.06 | `feat(privacy): export, deletion, retention, security suite` | `C-FN`, `C-DB`, scan |
| M12 | T-12.01…T-12.11 | `ci: full pipeline` + `docs: final documentation and implementation report` | full release gate (A22) |

---

## Part D — Where each check is verified

| Check | Container | CI (GitHub Actions) | EAS / owner |
|---|---|---|---|
| Install, lint, format, typecheck | ✅ | ✅ | — |
| Vitest (packages, web, backoffice) and jest-expo (mobile, ui) | ✅ | ✅ | — |
| DB tier C (PG16 + shim + pgTAP) | ✅ after T-0.07 | optional | — |
| DB tier A (`supabase start` → reset → test → lint), the authoritative run | ❌ (no Docker daemon; tier B is best effort) | ✅ | — |
| Type generation and drift check | ✅ (postgres-meta) | ✅ (`gen types --local`) | — |
| Migration lint and reset from zero | ✅ | ✅ | — |
| Deno check, lint, test | ✅ | ✅ | — |
| `functions serve` plus integration suite | ❌ | ✅ | — |
| `next build` for both apps | ✅ | ✅ | Vercel |
| Web Playwright | ✅ (CfT 153 or Chromium 141; `public-api` stubbed) | ✅ | — |
| Backoffice Playwright | ❌ (needs GoTrue and `admin-api`) | ✅ | — |
| `expo install --check`, expo-doctor | ✅ (`EXPO_OFFLINE=1` subset) | ✅ | — |
| `expo export`, prebuild smoke | ✅ | ✅ | — |
| Native builds (Xcode, Gradle) | ❌ | Android possible | ✅ EAS (**External credential required:** `EXPO_TOKEN`) |
| Maestro | ❌ | ✅ Android emulator | ✅ iOS EAS Workflows |
| Bundle and secret scan, quality gate | ✅ | ✅ | — |
| Remote deploys (Supabase, Vercel, EAS Submit) | ❌ | ✅ protected, manual approval | ✅ owner |
| Live provider calls (Google, Graph, RevenueCat, Anthropic, OpenAI, Voyage, Expo Push) | ❌ | recorded-fixture contract tests only | ✅ owner sandbox run per M§153 |

**Reporting rule.** The final report names, for every check, where it actually ran. A check is never reported as verified in the container when it ran only in CI or with the owner.

---

## Part E — Risk register (top 15)

| # | Risk | Likelihood / Impact | Mitigation | Tasks |
|---|---|---|---|---|
| R1 | The Gmail restricted-scope CASA assessment and the 100-user cap block production Gmail | High / High | Start CASA at M0 (**Manual external step**). Outlook, device calendar and demo paths work regardless. A health card tracks `GOOGLE_CASA_LOA_NOT_AFTER`. | T-4.02, T-3.07 |
| R2 | `minimumReleaseAge` blocks fresh pins (supabase-js 2.117.1, next 16.3.6, turbo 2.11.3) | Medium / Low | Documented fallback pins; install after the window passes. | T-0.03 |
| R3 | The container has no Docker, so tier A runs only in CI; there is a PG16 vs PG17 and pgvector 0.6 gap | High / Medium | Stay within the PG16 / pgvector-0.6 subset. Tier C runs every commit; tier A is authoritative in CI. | T-2.02, T-12.01 |
| R4 | Edge CPU and wall-clock limits break capture PDF, briefing or export work | Medium / High | Run these as `worker` jobs with time budgets, `capture_analysis`, streaming zip, batching. | T-3.06, T-5.13, T-11.01 |
| R5 | Native widget, NI, share or TTS code cannot be built in the container | High / Medium | Prebuild smoke, EAS CI builds, Maestro, and pure-logic unit tests. | T-8.25…T-8.27, T-12.02 |
| R6 | Model retirement (Haiku 4.5 ≥ 2026-10-15) or a pricing change | Medium / Medium | Model IDs live in config only; a backoffice switch; evals gate the swap. | T-3.09, T-5.16, T-10.10 |
| R7 | AI cost overrun | Medium / High | T0 pre-filter, caches, budgets, org auto-trip, `lean` profile, nightly reconciliation. | T-5.17 |
| R8 | Hallucination, grounding failure or prompt injection causes wrong or unsafe actions | Medium / High | Verifier, no tools during extraction, approvals for every write, injection evals. | T-1.13, T-5.16, T-11.05 |
| R9 | Retries cause duplicate provider writes | Medium / High | DB state machine plus provider-level idempotency markers, checked before every retry. | T-6.02…T-6.05 |
| R10 | Store review: share-extension `openURL`, referral non-IAP unlock (3.1.1), SIWA, deletion rules; Play notification-listener policy | Medium / High | STORE_CHECKLIST, prominent disclosure, a web deletion URL, and a fallback of in-extension UI via apple-targets. | T-8.17, T-8.26, T-12.09 |
| R11 | Notification fatigue or push delivery failures | Medium / Medium | Decision-engine caps, receipt polling, suppression metrics. | T-1.08, T-6.07, T-10.09 |
| R12 | Timezone or DST errors in scheduling | Medium / Medium | Local-time evaluation with `AT TIME ZONE`; DST fixtures in domain and pgTAP tests. | T-1.06, T-2.18, T-2.23 |
| R13 | Microsoft has no per-app revoke and tenants may require admin consent | High / Low | `admin_consent_required` status, documented user link, local purge. | T-4.07, T-4.13 |
| R14 | Secrets leak into client bundles | Low / High | Env split, lint rules, bundle scan in CI. | T-1.01, T-11.06 |
| R15 | The build is too large for one session; features could end half-done | Medium / High | Milestone gating, a per-feature DoD, and an honest report matrix; nothing is marked ✅ unless verified. | Part C, T-12.10 |

---

## Part F — Requirement index (master-prompt section → task IDs)

| M§ | Area | Tasks |
|---|---|---|
| 0 | Work modes | T-0.01, T-12.05, T-12.10 |
| 1 | Role (process) | whole WBS; T-12.10 |
| 2 | Product and slogan | T-1.04, T-8.08, T-9.02 |
| 3 | Principles | T-1.07, T-1.13, T-6.01, T-5.12, T-1.08 |
| 4 | Design references | T-0.02, T-1.02, T-1.03, T-8.02, T-8.03 |
| 5 | Repository discovery | T-0.01, T-0.03 |
| 6 | Technology | T-0.03, T-2.01, T-3.01, T-8.01, T-9.01, T-10.02 |
| 7 | Monorepo rules | T-0.03, T-1.01, T-1.05, T-1.16, T-11.06 |
| 8 | Navigation and Today | T-8.04, T-8.08, T-5.05 |
| 9 | Morning Briefing | T-5.08, T-5.09, T-8.09, T-8.27 |
| 10 | Midday | T-5.08, T-8.09 |
| 11 | Evening | T-5.08, T-8.09 |
| 12 | Weekly | T-5.08, T-8.09, T-1.15 |
| 13 | Flow | T-5.05, T-8.10, T-1.15 |
| 14 | Mail Intelligence | T-1.07, T-5.01, T-8.11 |
| 15 | Email Detail | T-4.03, T-5.02, T-8.11 |
| 16 | AI Reply | T-5.12, T-6.02, T-8.11 |
| 17 | Follow-up | T-1.11, T-5.03, T-5.12, T-8.11 |
| 18 | Commitments | T-1.11, T-5.03, T-6.04, T-8.12 |
| 19 | Plan | T-1.12, T-5.14, T-6.03, T-8.13 |
| 20 | Calendar intelligence | T-1.12, T-5.05, T-5.14, T-8.13 |
| 21 | Meeting Prep | T-5.10, T-8.14 |
| 22 | Post meeting | T-5.10, T-6.08, T-8.14 |
| 23 | Life intelligence | T-5.04, T-8.12 |
| 24 | Assistant | T-5.11, T-8.15 |
| 25 | Voice | T-3.10, T-5.11, T-8.15, T-8.27 |
| 26 | AI Memory | T-5.07, T-2.09, T-8.15 |
| 27 | Universal Capture | T-5.13, T-8.17 |
| 28 | Share extensions | T-8.17, T-8.01 |
| 29 | Smart reminders | T-1.12, T-6.06, T-8.18 |
| 30 | VIP and Person | T-5.06, T-8.16 |
| 31 | Priority rules | T-1.07, T-8.21 |
| 32 | AI personalization | T-1.07, T-2.07, T-8.21 |
| 33 | Approval Center | T-1.05, T-2.08, T-6.01…T-6.05, T-8.18 |
| 34 | Onboarding | T-5.15, T-8.06, T-8.07, T-4.10 |
| 35 | Notification settings | T-1.08, T-8.19, T-8.24 |
| 36 | Android NI | T-8.26, T-2.06, T-7.02 |
| 37 | Widgets | T-8.25, T-1.16 |
| 38 | Dark mode | T-1.02, T-8.02, T-8.29, T-10.04 |
| 39 | Localization | T-1.04, T-1.06, T-2.04, T-8.19 |
| 40 | Privacy Center | T-8.20, T-4.12 |
| 41 | Retention | T-11.04, T-11.02, T-11.03, T-8.20 |
| 42 | Analytics | T-1.16, T-3.11, T-8.28 |
| 43 | Subscriptions | T-7.01, T-7.02, T-8.22 |
| 44 | Free / Pro | T-1.09, T-7.02, T-8.22 |
| 45 | Referral | T-1.10, T-7.03, T-8.22, T-9.05 |
| 46 | Backoffice, general | T-10.02, T-10.04 |
| 47 | RBAC | T-1.14, T-2.17, T-10.01, T-10.15 |
| 48 | Admin security | T-10.01, T-10.02, T-10.03 |
| 49 | Support access | T-10.07 |
| 50 | Dashboard | T-10.05 |
| 51 | Users | T-10.06 |
| 52 | Integrations (backoffice) | T-10.08, T-4.12 |
| 53 | Sync and jobs | T-3.06, T-10.08 |
| 54 | Briefings (backoffice) | T-10.09 |
| 55 | Notifications (backoffice) | T-10.09 |
| 56 | AI operations | T-10.10, T-5.17 |
| 57 | Model config | T-3.09, T-10.10 |
| 58 | Prompt management | T-5.16, T-10.10 |
| 59 | AI feedback | T-8.03, T-10.10 |
| 60 | Subscriptions (backoffice) | T-10.11 |
| 61 | Entitlement override | T-10.06, T-10.11 |
| 62 | Referrals, support, feedback | T-10.07, T-10.11, T-10.12, T-8.19 |
| 63 | Feature flags | T-2.12, T-10.12 |
| 64 | Announcements | T-10.12, T-8.08 |
| 65 | Data requests | T-10.13, T-11.01…T-11.03 |
| 66 | Audit log | T-2.14, T-10.13 |
| 67 | System health | T-3.07, T-10.14 |
| 68 | Admin users | T-10.03, T-10.14 |
| 69 | Command palette | T-10.04 |
| 70 | Table quality | T-10.04 |
| 71 | Backoffice privacy | T-2.15, T-10.04, T-10.06 |
| 72 | Backoffice dark mode | T-10.02, T-10.04 |
| 73 | Public web | T-9.01…T-9.06 |
| 74 | Marketing assets | T-9.07 |
| 75 | OAuth and providers | T-1.15, T-4.01…T-4.11 |
| 76 | OAuth security | T-3.04, T-4.01, T-4.02, T-4.07, T-4.13 |
| 77 | Database schema | T-2.03…T-2.21 |
| 78 | Database rules | T-2.03…T-2.21, T-2.26 |
| 79 | RLS | T-2.19, T-2.22 |
| 80 | AI pipeline | T-1.13, T-5.01…T-5.05 |
| 81 | AI abstraction | T-3.09, T-3.10 |
| 82 | AI cost | T-3.09, T-5.01, T-5.17 |
| 83 | Hallucination control | T-1.13, T-5.03, T-5.04, T-5.11 |
| 84 | Web fetch security | T-3.05, T-5.13 |
| 85 | File security | T-3.05, T-5.13, T-2.21 |
| 86 | Notification security | T-1.08, T-6.07, T-8.24 |
| 87 | Local security | T-8.05, T-8.23 |
| 88 | Authentication | T-2.01, T-3.11, T-8.05 |
| 89 | Demo mode | T-3.08, T-4.10, T-2.24 |
| 90 | External credential rule | T-0.04, T-3.02, T-3.07, T-12.10 |
| 91 | Platform limitations | T-4.11, T-8.26, T-12.09 |
| 92 | Accessibility | T-8.02, T-8.29, T-9.08, T-10.15 |
| 93 | States | T-8.03, T-8.29, all UI tasks |
| 94 | Offline | T-3.03, T-8.23, T-8.18 |
| 95 | Search | T-5.07, T-8.15 |
| 96 | Scheduling | T-1.08, T-2.18, T-6.08 |
| 97 | Provenance | T-1.05, T-2.06, T-8.03 |
| 98 | End-to-end standard | T-12.06, all feature tasks |
| 99 | No dead action | T-1.01, T-12.07 |
| 100 | No placeholder | T-0.06, T-12.07 |
| 101 | Tests | T-1.*, T-2.22, T-2.23, T-12.04 |
| 102 | Mobile E2E | T-8.30, T-12.02, T-12.06 |
| 103 | Backoffice E2E | T-10.15, T-12.06 |
| 104 | Web E2E | T-9.08, T-12.06 |
| 105 | CI/CD | T-0.05, T-12.01…T-12.03 |
| 106 | Documentation | T-0.01, T-12.08, T-12.09 |
| 107 | Environment | T-0.04, T-1.16 |
| 108 | App identifiers | T-8.01 |
| 109 | Deployment | T-8.01, T-12.03 |
| 110 | App health / observability | T-8.28, T-10.14 |
| 111 | Retention loop | T-5.08, T-6.08 |
| 112 | Store preparation | T-8.31, T-12.09 |
| 113 | Threat model | T-11.05, T-12.08 |
| 114 | Prompt injection | T-1.13, T-3.05, T-5.16, T-11.05 |
| 115 | Write safety | T-6.01…T-6.05 |
| 116 | Data consistency | T-2.05, T-2.06, T-6.02…T-6.04, T-7.03 |
| 117 | Provider sync | T-4.03…T-4.12 |
| 118 | Operability | T-3.02, T-10.08 |
| 119 | Metrics | T-10.05, T-5.17 |
| 120 | Plan output | Part A |
| 121 | Execution principle | Part B order, T-12.05 |
| 122 | UI standard | T-1.02, T-8.02, T-8.03 |
| 123 | Micro-interactions | T-8.03, T-8.29 |
| 124 | No redesign | T-0.02, T-1.02, T-12.09 |
| 125 | Performance | T-8.28, T-9.06, T-10.04 |
| 126 | Logging | T-3.02 |
| 127 | Job safety | T-3.06, T-2.18 |
| 128 | Data export | T-11.01 |
| 129 | Account deletion | T-11.03, T-9.04 |
| 130 | User settings | T-8.19 |
| 131 | Explainability | T-5.05, T-8.03, T-8.11 |
| 132 | Notification decision engine | T-1.08, T-6.07 |
| 133 | Quality gate | T-0.06, T-12.07 |
| 134 | Build, test, fix loop | T-12.05, T-12.06 |
| 135 | Mobile acceptance | T-8.*, T-12.10 |
| 136 | Backoffice acceptance | T-10.*, T-12.10 |
| 137 | Web acceptance | T-9.*, T-12.10 |
| 138 | Final report | T-12.10 |
| 139 | Scope rule | whole WBS |
| 140 | No questions to the user | process; T-12.10 manual steps |
| 141 | Realism rule | T-8.26, T-9.02, T-12.07 |
| 142 | Working style | Part C milestones |
| 143 | Sub-audits | T-0.01 |
| 144 | Design coverage audit | T-0.01, T-12.09 |
| 145 | Screen map standard | T-0.01 |
| 146 | API contract standard | T-0.01, T-1.16 |
| 147 | Database standard | T-0.01 |
| 148 | Backoffice standard | T-0.01, T-1.14 |
| 149 | Credential matrix | A19, T-0.04 |
| 150 | Dependency target | WBS dependencies |
| 151 | Production data boundary | T-2.16, T-2.19, T-3.11, T-10.01 |
| 152 | Secret management | T-0.04, T-3.02, T-11.06 |
| 153 | Release quality | T-12.06, T-12.10 |
| 154 | Final start and completion | Part C, T-12.11 |

---

## Proposed additions to the canonical registry

Each item below is used by this plan but is not in the spine. Where another draft proposes the same item, that draft is named.

**Naming and file conventions**
1. Workspace package names:
   - Packages: `@da/config`, `@da/design-tokens`, `@da/ui`, `@da/domain`, `@da/validation`, `@da/api-client`, `@da/i18n` (same as the ADR draft).
   - Apps: `@da/mobile`, `@da/web`, `@da/backoffice`. These give stable Turbo filters.
2. Migration file splits keep the group order:
   - `0013` is split into `…001300_functions_private`, `…001310_functions_public_rpcs`, `…001320_functions_admin_api` and `…001330_scheduler_jobs`.
   - Later groups are `…001700_ai_config_seed`, `…001710_ai_rollups`, `…001720_retention_triggers` and `…001800_metrics_rollups`.
   - Nothing is inserted before a migration that has already been authored, which keeps the history forward-only.
3. Generated artifacts are committed and checked for drift (`pnpm generate`):
   - token CSS, JSON, Swift and Kotlin;
   - icon components for RN and DOM (in the web and backoffice apps);
   - `database.types.ts`;
   - per-function `deno.json`;
   - the prompt seed SQL.

   Shared services live in `supabase/functions/_shared/services/`.
4. `docs/CANONICAL_REGISTRY.md` gives every proposed addition across the plan docs a disposition.

**Routes**

5. Mobile routes. Plan §7 needs the OAuth and auth return targets; the others come from SCREEN_MAP drafts 1 and 2.

   | Route | Why it is needed |
   |---|---|
   | `app/auth/callback.tsx` | OAuth and auth return target |
   | `app/integrations/callback.tsx` | OAuth and auth return target |
   | `app/mail/category/[category].tsx` | Mail category drill-down |
   | `app/briefings/index.tsx` | Briefing history |
   | `app/update-required.tsx` | Version gate |
   | `app/index.tsx` | Root resolver |
   | `app/+native-intent.tsx` | Share-intent URL rewriting |
   | `app/chat/[threadId].tsx` | Assistant thread (M-ASST-02; `new` = unsaved thread) |
   | `app/demo/setup.tsx` | Demo scenario reset for Maestro and store screenshots (`DEMO_MODE` builds only) |

6. `api` routes (contracts in API_CONTRACTS, which is authoritative for names per R-20):
   - `POST /integrations/oauth/complete {completion_code, device_nonce}` (R-07; the `:provider/complete` variants proposed by drafts and critics are renamed to this);
   - `POST /approvals/:id/device-execution` (API-APR-05; R-18);
   - `POST /captures/:id/discard` (API-CAP-05);
   - `POST /briefings/:id/retry` (API-BRF-04);
   - `POST /notifications/test` (API-DEV-04);
   - `GET /widgets/snapshot` (API-WDG-01);
   - `POST /mail/threads/:threadId/summary`;
   - `POST /meetings/:eventId/prep/audio` (R-24);
   - `POST /reply-drafts/:id/attachments/upload-url` (R-24);
   - `POST /privacy/export/:id/download`.
7. `public-api` routes, aligned with API_CONTRACTS:
   - `POST /support`
   - `POST /data-deletion/start`
   - `POST /data-deletion/verify`
   - `GET /referrals/:code`
   - `GET /plans` (PUB-05)
   - `POST /web-events` (PUB-06)
   - `GET /data-deletion/:requestId/status?token=` (PUB-07)
   - `POST /support/inbound-email` (PUB-08)
8. `health` routes: `GET /health/live`, `POST /health/run`.
9. `oauth` demo routes (only when `DEMO_MODE`): `GET /oauth/demo/authorize|callback`.
10. Web routes: `/app/[[...path]]` (universal-link fallback), `/get` (store redirector), `/.well-known/security.txt` and `/.well-known/microsoft-identity-association.json`.
11. Backoffice routes: `/invite`, `/forbidden`, `/api/admin/[...path]` (GET-only read proxy) and `/api/healthz` (liveness, no data).

**Job types and enums**

12. `job_type` additions (accepted; DATABASE_AND_RLS_PLAN adds them to the enum):
    - `capture_analysis` (key `capture_analysis:{capture_id}`): CPU-heavy parsing runs in the worker (also proposed by API_CONTRACTS, SCREEN_MAP 2 and SECURITY).
    - `briefing_audio` (key `briefing_audio:{briefing_id}:{version}`): premium TTS (SCREEN_MAP 1).
    - `credential_reencrypt` (key `credential_reencrypt:{utc_date}`): key rotation, enqueued daily by the 00:07 `da_reconciliation` run (SECURITY).
    - `integration_purge` (key `integration_purge:{account}:{disconnected_at_epoch}`): the disconnect purge (T-4.13).
    - `ai_batch`: Message Batches submission and result collection.
    - `transactional_email`: support replies, admin invites and security emails sent through the email adapter.
    - No new type is added for AI cost reconciliation: it runs as `reconciliation` with `payload.scope='ai_cost'`, and `ai_cost_reconcile` is rejected.
13. Enums:

    | Enum | Values |
    |---|---|
    | `source_type` | the DATABASE_AND_RLS_PLAN §2 list: `email_message \| email_thread \| calendar_event \| device_calendar_event \| task \| capture \| meeting_note \| post_meeting_note \| android_notification \| assistant_message \| user_input \| commitment \| life_event \| contact \| briefing \| ai_feedback` |
    | `ai_feature` | `email_triage \| thread_summary \| email_deep_extract \| commitment_extract \| life_intel_extract \| briefing_morning \| briefing_midday \| briefing_evening \| weekly_review \| meeting_prep \| post_meeting_parse \| capture_extract \| assistant_intent \| assistant_qa \| reply_draft \| follow_up_draft \| embedding_doc \| embedding_query \| stt \| tts \| admin_probe` (the AI_PIPELINE_PLAN list plus `admin_probe`) |
    | `reply_tone` | `short \| professional \| friendly \| detailed` |
    | `reply_draft_status` | `draft \| submitted \| sent \| discarded \| failed` |
    | `referral_status` | `pending \| qualified \| rewarded \| rejected \| flagged` |
    | `system_health_checks.status` (DB) | `healthy \| degraded \| down \| external_credential_required \| unknown` |
    | data request statuses (DB) | `export_status` and `deletion_status`; there is no `data_request_status` |
    | `admin_status` | `invited \| active \| disabled` |
    | `routing_profile` (R-18) | `balanced \| lean`, typing `ai_model_config.profile`; `plan_limits` key `ai_routing_profile` |
    | `approved_via` (R-03) | `approval_center \| inline_sheet \| voice_card \| capture_batch \| in_place` |
    | `support_access_scope` (R-09) | `pii \| email_metadata \| insights \| notifications \| captures \| assistant_transcript \| ai_feedback` |
    | `capture_status` += | `pending_upload` (the default) |

    `notification_category` gets no `weekly` value: the weekly review push uses category `evening` on channel `briefings`, and `user_preferences.weekly_enabled` controls it. The approval state machine is exactly spine §5 (R-06); no undo status or extra transition is added.

**Tables, columns and SQL**

14. Tables:
    - `api_idempotency_keys` (HTTP replay; API_CONTRACTS);
    - `ai_model_prices` (ADR draft);
    - `admin_mfa_recovery_codes`;
    - `private.admin_role_permissions`;
    - `private.demo_fixture_state`;
    - `metrics_daily` and `ai_metrics_daily` (BACKOFFICE_PLAN);
    - `ai_calibration_versions` and `ai_batches` (AI_PIPELINE_PLAN);
    - `web_analytics_daily` (SCREEN_MAP 5), `app_settings` (BACKOFFICE_PLAN) and `privacy_tombstones` (SECURITY);
    - the security-invoker view `connected_account_sync_health` (INTEGRATION_PLAN).
15. Column groups, as listed in the tasks:
    - the analysis group on `email_messages`;
    - audio and stats on `briefings`;
    - `executor`, `device_installation_id`, `device_token_hash`, `origin`, `payload_version`, `exact_change`, `batch_id`, `approved_via`, `side_effects` and `approval_expires_at` on `approval_actions`;
    - the watch and lease columns on `sync_states`;
    - `token_kind` (`refresh | access | apple_siwa_refresh`) and `key_version` on `oauth_credentials`, where `apple_siwa_refresh` has a nullable account;
    - `device_nonce_hash`, `completion_code_hash` and `completed_at` on `oauth_states` (R-07);
    - `jobs.progress`;
    - the `profiles` onboarding, demo (`is_demo`), `state` (`user_state`) and internal (`is_internal`) fields, and `profiles.locale`;
    - schedule and working hours in `user_preferences`;
    - `notification_preferences.smart_filter`, `quiet_hours_enabled`, `quiet_start`, `quiet_end`, `vip_bypass_quiet` and `daily_cap` (R-13, R-14), and `vip_people.bypass_quiet_hours`;
    - NI fields on `app_installations` (`ni_listener_granted`, `ni_mode`, `ni_allowed_packages`, `ni_last_signal_at`, `platform_capabilities`);
    - the hash chain on `audit_logs`.

    Full definitions belong in DATABASE_AND_RLS_PLAN.
16. SQL functions:
    - RPCs (names per API_CONTRACTS §15, R-20): `today_overview`, `flow_feed`, `flow_meta` (RPC-20, the Flow header counts), `mail_intelligence`, `plan_range`, `plan_week_density`, `person_intelligence`, `vip_suggestions`, `get_explanation`, `submit_ai_correction`, `apply_insight_feedback` / `revert_insight_feedback` (kept by R-24), `set_commitment_status`, `search_user_content`, `preview_priority_rule`, `get_usage_summary`, `list_approvals`, `dismiss_announcement`, `mark_briefing_opened`, `history_deletion_preview` and `upsert_manual_contact` (R-24). The retired names `get_today`, `mail_digest`, `get_person`, `person_overview`, `plan_timeline` and `search_memory` are not used.
    - Private helpers are listed in T-2.15, with the canonical renames `private.is_pro` (not `has_pro` / `require_pro`), `private.evaluate_flags`, `private.audit_log_append`, `private.audit_verify_chain`, the `private.admin_role_permissions` table, `private.poke_worker`, `admin_api.prompt_activate` and `public.effective_entitlement`. Approval expiry is step 9 of `scheduler_tick`.
17. Cron jobs: the DATABASE_AND_RLS_PLAN §9 set of 8: `da_scheduler_tick`, `da_worker_poke`, `da_push_receipts`, `da_health_check`, `da_reconciliation`, `da_retention`, `da_billing_reconcile` and `da_cron_housekeeping`. Metrics rollups run inside `scheduler_tick`; `da-metrics-rollup` and `da-cron-history-prune` are rejected. The Vault secrets are `da_project_url` and `da_cron_secret`.

**Identifiers, environment and dependencies**

18. Identifiers:
    - App variant suffixes `.dev`, `.preview` and `.e2e`, with matching scheme suffixes.
    - The share extension is `<bundleId>.share-extension` (the expo-share-intent default). This reconciles the ADR draft's `.ShareExtension` spelling.
    - The widget is `<bundleId>.widget`.
    - Local modules are `da-share` (plugin and staging) and `da-tts` (ADR draft).
19. Environment names:
    - The INTEGRATION_PLAN §15 names are canonical, for example `MICROSOFT_CERT_PRIVATE_KEY` and `MICROSOFT_CERT_THUMBPRINT_S256`. This supersedes the ADR draft's `MS_*` spellings.
    - New keys (accepted): `ANTHROPIC_ADMIN_API_KEY`, `OPENAI_ADMIN_API_KEY`, `ADMIN_BFF_SECRET`, `ADMIN_GATEWAY_SECRET`, `ADMIN_ORIGIN`, `ADMIN_ALLOWED_EMAIL_DOMAINS`, `AI_HASH_PEPPER`, `HASH_PEPPER`, `PII_LOOKUP_PEPPER`, `RECOVERY_CODE_PEPPER`, `AUDIT_SUBJECT_PEPPER`, `EMAIL_INBOUND_BASIC_AUTH`, `DATA_REGION_LABEL` and `TURNSTILE_SECRET_KEY`, plus the INTEGRATION_PLAN §15 `EMAIL_*` HTTPS email API keys.
    - Rejected: `EMBEDDINGS_PROVIDER` (Voyage is the only embedding provider, R-01) and `ADMIN_SESSION_SECRET` (the backoffice holds no session-sealing secret; BACKOFFICE_PLAN §2.7).
20. Dependencies, all at Expo-bundled versions:
    - `expo-clipboard`, `@react-native-community/datetimepicker`, `expo-image-manipulator`, `expo-store-review`, `expo-screen-capture`, `react-native-view-shot`.
    - Functions: `fflate`, `htmlparser2`, `@mozilla/readability`, `linkedom`, `unpdf`.
    - Dev: `@axe-core/playwright`.

**Decisions and scripts**

21. **Reconciliation decision.** The backoffice first factor is an email one-time code, with TOTP as the second factor (giving `aal2`). This matches the ADR draft (ADR-30) and SECURITY R-10. BACKOFFICE_PLAN §3's password, set-password and reset flows are replaced by OTP equivalents; its lockout, recovery-code, invite, step-up and session rules are kept.
22. **Search decision.** `search_user_content` (RPC-02; DATABASE_AND_RLS_PLAN §6.9) takes the HNSW top results for the caller, and its vector leg falls back to an exact KNN over the user's materialized rows when HNSW under-fills. The HNSW index from the spine stays in place for scale. This avoids the post-filter recall loss of pgvector 0.6.
23. Feature-flag keys: exactly the R-10 set listed in T-2.12.
24. Scripts:
    - `scripts/quality-gate/*`
    - `scripts/db/{tier-a,tier-c,reset-twice,gen-types,lint-migrations}`
    - `scripts/functions/sync-import-maps.ts`
    - `scripts/ai/gen-prompt-seed.ts`
    - `scripts/security/{scan-bundles,check-env-split}.ts`
    - `scripts/marketing/render-assets.ts`
    - `scripts/admin-bootstrap.ts`
    - `scripts/dev/{bootstrap-container,env}.sh`
    - `scripts/deploy/check-secrets.ts`
    - `scripts/mobile/prebuild-smoke.sh`
25. **Weekly push decision.** The weekly review push uses `notification_category='evening'` on channel `briefings`; `notification_category` has no `weekly` value.
26. **Reconciliation rulings applied.** This plan follows spine §23b R-01…R-25: Voyage 1024-d embeddings (R-01), the AI data objects and the Free quota of 50 (R-02, R-22), tap-only approvals with the R-03 `approved_via` values, assistant retrieval-only tools (R-04), deterministic midday and evening (R-05), the client-side 5 s undo (R-06), the client-bound OAuth completion (R-07), the email-code plus TOTP backoffice sign-in (R-08), Support Access scopes and durations (R-09), the flag keys (R-10), the `https:`-only fetcher (R-11), the Android channels (R-12), quiet hours and the VIP bypass (R-13), the daily cap of 5 (R-14), truthful storage copy (R-15), re-authenticated history deletion (R-16), the quality-gate patterns (R-17), `device-execution` and `routing_profile` (R-18), no Realtime (R-19), the per-artefact precedence (R-20), the analytics catalogue (R-21), meeting-prep timing (R-23), the dead-action additions (R-24) and the Today announcement banner (R-25).

` block, and a `@@@NOTES@@@` block that is never applied) or the JSON form `{edits:[{find, replace}], append}`. Edits apply in order, each `find` must match exactly once, and failures are reported, not skipped.
  - `SCREEN_AND_FLOW_MAP.md` is the concatenation of `SCREEN_MAP_1`, `SCREEN_MAP_2`, `SCREEN_MAP_3`, `SCREEN_MAP_4`, `SCREEN_MAP_4B` and `SCREEN_MAP_5`, in that order.
  - `DELIVERY_CHECKLIST.md` (required by M§0.A) comes from its `doc:DELIVERY_CHECKLIST` draft. If no journal holds that draft (the critique pass found none), step 0 generates it from the other plan docs before any code is written, with four parts:
    1. a requirement traceability table (REQ-* / SREQ-* / C-* → M§ → screens → API / RPC / JOB → tables → backoffice and security controls → tests → WBS → status), seeded from the `coverage_matrix_md` of the `critic:coverage` journal result;
    2. the No-Dead-Action inventory: every Primary CTA and Secondary action of every SCREEN_AND_FLOW_MAP block, with the columns ACTION | SCREEN | TARGET (route, API- / RPC- / PUB- ID, or local handoff) | SUCCESS STATE | TEST (SREQ-99), cross-checked against API_CONTRACTS §16. The generator fails if any action has no contract;
    3. the M§135–M§137 acceptance checklists;
    4. the M§153 release checklist.

    The drafted checklist already carries all four (its §2, §4, §3 and §7).
  - The reconstruction script runs from the scratchpad and is not committed.
  - `CANONICAL_REGISTRY.md` merges every "Proposed additions" section. Each item gets a disposition (accepted as-is / renamed / rejected, with a reason). The spine names and the spine §23b reconciliation rulings R-01…R-25 win; after them the R-20 per-artefact precedence applies, and the critic `registry_decisions` supply the remaining dispositions.

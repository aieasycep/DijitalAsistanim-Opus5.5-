# Dijital Asistan — Master Implementation Plan (Plan Mode output)

> Source of truth for the build. Produced in Plan Mode from: the master prompt (154 sections), the PRIMARY design archive (`Dijital Asistan tasarım sistemi son.zip`, 10 `.dc.html` canvases), the SECONDARY archive (`Dijital Asistanım` Figma-Make React prototype, 99 files + 4 product docs), and 11 independent read-only audits (design ×6, secondary code/docs ×2, stack/versions, provider integrations, AI providers).
> Plan Mode could only write this file. **Execution step 0** materialises the 11 required plan documents (+ `API_CONTRACTS.md`, `KNOWN_PLATFORM_LIMITATIONS.md`) into `docs/` from the drafts referenced in §24 and from this file.

---

## Context

The repository `aieasycep/DijitalAsistanim-Opus5.5-` is **empty** (branch `claude/magical-pascal-edvjgn`, no commits, no files). The user wants a production-grade, integrated product — not a demo, not an MVP, not split into V1/V2 — consisting of:

- a React Native / Expo mobile app (iOS + Android) that acts as a **personal command center** ("Bugün bilmen gerekenleri, sen sormadan söyler."), not a chatbot;
- a Next.js public marketing website;
- a separate Next.js admin backoffice with its own security boundary;
- a Supabase backend (Postgres + RLS, Auth, Storage, Edge Functions, Cron, pgvector);
- real Google / Microsoft / Apple / Android integrations, an AI pipeline with source grounding and cost control, approval-gated write actions, subscriptions (RevenueCat), referrals, privacy (export/deletion/retention), tests, CI/CD and store readiness.

The two design archives are prototypes with fake interactions; the product must implement real, end-to-end flows (UI → state → API → backend → DB → provider/AI → approval → side effect → confirmation → refreshed state) with no dead buttons, placeholders or fake success.

---

## 1. Repository state

| Item | Finding |
|---|---|
| Git | Branch `claude/magical-pascal-edvjgn`, **no commits**, working tree empty |
| Source / config / lockfiles / CI / native / Supabase | None — clean monorepo will be created |
| Existing secrets / env | None |
| Design inputs | Only in the two uploaded ZIPs (extracted to the session scratchpad during planning; execution re-extracts them into `design/reference/` — git-ignored except for extracted tokens/assets) |
| Container facts (execution-relevant) | Ubuntu 24.04, Node 22.22.2 (Node 24 LTS used in CI/EAS/Vercel), pnpm via corepack, Docker client present but **daemon not running**, PostgreSQL 16 binaries present (no pgvector/pgTAP; installable via apt), no Deno (installable from npm `deno@2.1.4`), no Android SDK / Xcode, **api.expo.dev, api.supabase.com, graph.microsoft.com, api.openai.com, api.revenuecat.com blocked**; api.anthropic.com, registry.npmjs.org, jsr.io, archive.ubuntu.com, storage.googleapis.com reachable. Playwright Chromium 141 preinstalled at `/opt/pw-browsers`. |

Consequences: in-container verification = lint, typecheck, unit tests (vitest/jest-expo), DB + RLS tests on local Postgres 16 with a Supabase-compat shim (tier C) and on the full Supabase stack in CI (tier A), Deno tests for Edge Functions, `next build` ×2, Playwright E2E for web/backoffice, `expo export` bundle smoke + `expo prebuild` plugin validation for mobile. Native builds (EAS), Maestro mobile E2E, remote Supabase deploys and live provider calls run in CI / by the owner with credentials; the final report says so explicitly.

---

## 2. Design findings (summary; full detail → `docs/DESIGN_AUDIT.md`)

**PRIMARY (binding visual language)** — 10 canvases: `01 Tasarım Sistemi`, `02 Onboarding`, `03 Bugün ve Brifingler`, `04 Akış ve Mail`, `05 Plan ve Toplantılar`, `06 Asistan Hafıza Kişiler`, `07 Hesap Gizlilik Pro`, `08 Durumlar Widgetlar Etkileşimler`, `09 Pazarlama`, plus the clickable hub `Dijital Asistan.dc.html` (iOS prototype + IA panel).

- **Tokens** (names verbatim, become `packages/design-tokens`): `brand/primary #5B5CE2` (pressed `#4B4CCB`, soft `#EDEDFC`, text-on-soft `#4547C9`, dark-glow `#A9AAF5`); `critical #E0553F / soft #FCEDE9 / text #C7432F`; `warning #E09A1C / #FDF2DC / #9A6300`; `success #2FA062 / #E4F5EA / #1E7A47`; `info #3B82E6 / #E7F0FD / #2262BE`; neutrals `bg #F5F4F0`, `surface #FFFFFF`, `surface-2 #F0EFEB`, `hairline #E9E7E1 (rgba 27,25,23,.06)`; ink `#1A1917 / #6B6860 / #9B978E / disabled #B8B4AA`; `editorial/paper #FBFAF7`; gradients `dawn` (morning), `night` (voice/audio/analysis), `dusk` (evening). Dark: `bg #141311`, `surface #1F1E1B`, `surface-2 rgba(255,255,255,.08)`, text `#F2F0EB / #A39F96 / #7A776F`, primary `#8586F2`, glow `#A9AAF5`, critical-text `#F08B78`, warning-text `#F0B85A`, success-text `#6FCF97`, on-primary `#0F0F2A`; dark cards use a 6% white hairline instead of shadow.
- **Type**: Geist (UI) — display 34/40/600/−2.5%, h1 28/34/600, h2 22/28/600, h3 17/23/600, body 15/22/400, secondary 14/20, kicker 12/16/600/+8% caps, micro 11/14/700/+5%; Lora (editorial narrative 18/29, editorial-display 34/40/500). Icons: Material Symbols Rounded (FILL 0 default, FILL 1 active) → generated SVG components (RN cannot drive variable axes).
- **Spacing** 4-pt grid (4…40), gutter 20; **radius** 10 icon tile · 12 inline button · 14 button · 16 small card · 20 card · 28 hero/page · 999 pill; **elevation** card `0 1px 2px rgba(27,25,23,.04), 0 6px 20px rgba(27,25,23,.05)`.
- **Rules stated in the design**: colour carries meaning only; indigo only for AI markers / primary action / selected tab / links — never decoration; coloured badges only for ACİL, SON TARİH, GÜVENLİK (and ONAYLANDI); dashed border = "proposed / not yet real"; every AI inference has a source line; raw mail body never appears in lists (only under "Orijinal Mail" in detail); 4 fixed tabs — new capabilities open as cards inside a tab, never a new tab.
- **Accessibility debt found**: `ink/tertiary #9B978E` on `#F5F4F0` fails AA for body text → used only for ≥12px kicker/meta with a darker `ink/tertiary-strong` token for any informational text (documented as a minimal, justified deviation in DESIGN_AUDIT); the design's "9:1" on-primary claim is actually 5.96:1 (still AA).
- **Coverage**: PRIMARY covers onboarding (2.1–2.13 incl. Android notification access), Today light/dark, morning/audio/midday/evening/weekly + share card, Flow (the 9 master card types + follow-up/commitment variants), Mail Intelligence, Email Detail, AI Reply (4 tones), Follow-up, Waiting, Commitments, Life cards, Smart Reminder sheet, Universal Capture (4.10–4.14 screenshot/bill/PDF/link/text), Plan day/week, conflict resolution, Meeting Prep + 2-min summary, Post-meeting, Assistant (+rich cards), Voice, Memory search, VIP, Person, Approval Center, AI Personalization, Profile/Settings hub, Privacy Center, Data sources, Retention/deletion, Paywall + contextual Pro gate, Referral, Appearance/Language, Priority Rules CRUD, empty/error/loading/offline states, widgets (iOS S/M/L + lock screen, Android 2×2/4×2), micro-interactions/motion, store screenshots and 9:16 ads.
- **SECONDARY-only (adopt IA, restyle to PRIMARY)**: Notification Settings screen, Briefing Settings screen, Help, Feedback, Data Source Control per-account axis, Integrations list incl. Google Tasks / Microsoft To Do / Apple Reminders rows, calendar-permission denied state, VIP onboarding step, marketing landing page structure, notification copy catalogue. **Rejected**: splash-only timer navigation, Android frame, IA/UserFlows/DesignSystem pages as app screens, accent-colour picker, "Yakında" languages, purple deadline colour, Inter font, emoji icons.
- **Prototype fakes to never copy** (full inventory in DESIGN_AUDIT §Interaction coverage): canned assistant answers, timer-driven "analysis", fake send/"Gönderildi", fake Meet handoff, instant fake connect/disconnect, local-only approvals, fake audio progress, hard-coded counts, "Çözüldü!" direct calendar changes without approval, un-persisted settings, swapped Mail-Intelligence wiring, ±10% "15 s" seek bug, etc.
- **Resolved contradictions** (C-01…C-37 + design-level P-items, full table in DESIGN_AUDIT; cross-document rulings in §23b): master prompt wins functionally (briefing section labels, 9 Flow card types, onboarding order, trial only if store offers it, no "Sınırsız", voice writes require on-screen approval, push content defaults to non-sensitive, Android NI copy must match on-device processing, etc.); PRIMARY wins visually. Demo data uses PRIMARY names (Ahmet Yılmaz — Kuzey Lojistik, Mehmet Yılmaz — Yılmaz Endüstri, Selin Kaya) with dates computed relative to "now".

---

## 3. Architecture (decisions; rationale & alternatives → `docs/ARCHITECTURE_DECISIONS.md`)

### ADR-01 Monorepo
pnpm **11.27.1** workspaces (`packageManager` pinned; pnpm 12 Rust rewrite deferred until verified with Turbo/EAS) + **Turborepo 2.11.x**; Node **24 LTS** in CI/EAS/Vercel, `engines.node >=22.13`. Default pnpm catalog + named catalog `expo` pinned exactly to `expo@57.0.24/bundledNativeModules.json`; `overrides` for `react`, `react-dom`, `react-native`. `minimumReleaseAge` respected (use previous patch if a pin is <24h old). Prettier 3.9 + ESLint **9.39.5** flat config (ESLint 10 blocked by eslint-config-next/-expo plugins) + typescript-eslint 8.70.

```
apps/
  mobile/        Expo SDK 57 · RN 0.86.3 · React 19.2.3 · Expo Router 57 (dev build + EAS; never Expo Go)
    app/         file-based routes (see §9)
    modules/     local Expo modules: notification-intelligence (Kotlin), da-widgets (Kotlin Glance + iOS bridge), da-share (glue)
    targets/     @bacons/apple-targets: widget (SwiftUI WidgetKit)
  web/           Next.js 16.3 App Router · Tailwind v4 · next-intl (marketing, SEO)
  backoffice/    Next.js 16.3 App Router · Tailwind v4 · shadcn/Radix · TanStack Table v9 · Recharts (admin.<domain>)
packages/
  design-tokens/ source tokens → generated tokens.ts (RN) + tokens.css (@theme for Tailwind v4)
  ui/            React Native UI kit (RN only) + generated Material Symbols SVG icon components
  domain/        pure, Deno-safe TS: enums, entities, priority engine, notification decision engine, entitlement logic,
                 referral anti-abuse, date/tz parsing (TR), commitment detection, reminder rules, grounding verifier, RBAC matrix
  validation/    zod 4 schemas: API contracts, AI structured outputs, approval payloads, env schemas (Deno-safe)
  api-client/    typed Supabase client wrappers, generated database.types.ts, TanStack Query hooks/keys
  i18n/          ICU message catalogs tr (default) + en, shared by use-intl (mobile) and next-intl (web/backoffice); STYLE.md
  config/        tsconfig bases, ESLint flat configs, Prettier config
supabase/
  config.toml · migrations/ (versioned SQL) · seed/ (demo, gated) · tests/ (pgTAP + shim) · functions/ (Deno 2.1)
design/          extracted tokens/assets + reference README (ZIPs themselves not committed)
docs/            all plan + product docs
.github/workflows/ CI
```

### ADR-02 Versions (verified 2026-09-23; full matrix → ARCHITECTURE_DECISIONS)
TypeScript **~6.0.3** (TS 7.0 has no programmatic API; typescript-eslint caps <6.1) · React **19.2.3** everywhere · Expo **~57.0.24**, RN **0.86.3** (not npm-latest 0.87), reanimated **4.5.1** + worklets 0.10.1, gesture-handler **~2.32**, screens ~4.26, safe-area ~5.7, flash-list 2.0.2 · Next **16.3.6** (fallback 16.3.5) · Tailwind 4.3 · zod **4.6.5** · @supabase/supabase-js 2.117.x, @supabase/ssr 0.12.7 · TanStack Query 5.103 (+persist-client) · zustand 5.0.15 · react-hook-form 7.88 · next-intl/use-intl 4.14.6 · date-fns 4.4 + @date-fns/tz 1.5 · react-native-mmkv 4.3.2 (AES-256) · react-native-purchases **10.10.1** (custom paywall; no purchases-ui) · @sentry/react-native 8.27 (excluded from expo install check) · @sentry/nextjs 10.75 · @react-native-google-signin 16.1.5 · expo-apple-authentication · expo-web-browser · expo-share-intent **8.0.1** · @bacons/apple-targets **5.0.0** · expo-speech-recognition 57.1.0 · @expo-google-fonts/geist + lora · @material-symbols/svg-400 (codegen input) · jest-expo ~57.0.5 + jest 29.7 + RNTL 14 (mobile/ui) · vitest **4.1.11** (packages, web, backoffice) · Playwright 1.63 · Maestro 2.10 (mobile E2E) · Deno **2.1.4** (matches Supabase edge-runtime) · Hono 4.13.8 · @anthropic-ai/sdk 0.128 · openai 7.23 · Supabase CLI 2.117 (Postgres 17 hosted/CI; migrations kept PG16-compatible for tier-C tests). **Not used**: NativeWind (v5 only RC), Tamagui, Unistyles, expo-widgets (iOS-only, isolated runtime, monorepo bug), react-native-purchases-ui, Detox, expo-auth-session, i18next.

### ADR-03 Mobile styling & UI kit
Plain `StyleSheet` + typed `useTheme()` token hooks from `packages/design-tokens` (the PRIMARY canvases are inline-style specs that map 1:1), React Compiler on (SDK 57 default). All components theme-aware; no hard-coded surfaces; accessibility built into primitives (labels, roles, 44pt/48dp hit slop, Dynamic Type via `allowFontScaling` + max multipliers, reduce-motion, `accessibilityActions` for every swipe).

### ADR-04 Backend shape (Supabase)
- **Reads**: mobile reads curated data through `packages/api-client` → PostgREST with RLS (explicit column lists; views/RPCs `security invoker` for aggregates). No raw provider payloads exposed.
- **Writes without external side effects** (preferences, rules, VIP, insight status, feedback): PostgREST under RLS with column-level GRANTs (users cannot write plan/entitlement/status-machine columns).
- **Everything with side effects, AI, providers, secrets**: Supabase **Edge Functions** (Deno 2.1, Hono routers, per-function `deno.json`, import `packages/domain` + `packages/validation` via relative import map; deploy with `--use-api`). Canonical function set:

| Function | Auth | Purpose |
|---|---|---|
| `api` | user JWT (`verify_jwt=true`) | Mobile/web authenticated BFF: integrations start/disconnect, approvals (approve/edit/reject), reply drafts, assistant, search, capture, reminders, briefings audio/TTS, meeting prep, post-meeting, entitlements, referrals, export/deletion requests, devices/push tokens, Apple token exchange, feedback/support |
| `oauth` | none (state-validated) | `/google/callback`, `/microsoft/callback`: PKCE code exchange, token encryption, account upsert, deep-link redirect |
| `webhooks-google` | Pub/Sub OIDC JWT / channel token HMAC | Gmail push, Calendar channel notifications → enqueue |
| `webhooks-microsoft` | clientState (hashed, constant-time) | Graph change + lifecycle notifications, validationToken echo → enqueue (tiny, <3 s) |
| `webhooks-revenuecat` | Authorization secret (constant-time) | Store billing events → `billing_events` + enqueue |
| `worker` | secret key (`auth:'secret:automations'`) | Job runner invoked by pg_cron/pg_net; drains `jobs` by type within wall-clock/CPU limits |
| `admin-api` | admin JWT, `aal2`, active `admin_users` row, permission check | Every backoffice read/mutation (masked PII), audit writes, privileged ops needing the secret key |
| `public-api` | none + rate limit | Web support form, data-deletion request (Supabase email-OTP verified), referral link resolve |
| `health` | secret or admin | Real probes for System Health |

- **Jobs**: a first-party `jobs` table (portable, fully observable, testable on plain Postgres) — statuses `queued | running | completed | retrying | failed | dead_letter`; `claim_jobs(worker_id, types[], limit, lease_seconds)` uses `FOR UPDATE SKIP LOCKED`; unique `idempotency_key`; exponential backoff with jitter; `max_attempts` → `dead_letter`; `job_attempts` history; correlation IDs. **pg_cron** (UTC) runs `scheduler_tick()` every minute (enqueue due briefings per user timezone/DST, watch renewals, reconciliation, retention, receipts, health) and pokes `worker` every 15 s via pg_net; latency-sensitive enqueues (approval execution, webhook ingest) also poke immediately. ≤8 concurrent cron jobs. (pgmq rejected: no DLQ/visibility for backoffice, not available in tier-C tests.)
- **Secrets**: Edge secrets only; new `sb_publishable_…` / `sb_secret_…` keys from day one; Vault only for `project_url` + cron secret used by pg_net. Backoffice and web hold **no** Supabase secret key.

### ADR-05 Data & privacy model
- Every user-data table: `user_id uuid not null` FK → `auth.users` on delete cascade, RLS enabled + forced, `created_at/updated_at timestamptz` (UTC), indexes on `(user_id, …)`; timezone stored separately in `user_preferences.timezone` (IANA, default `Europe/Istanbul`).
- **Provenance columns** on every derived object (insights, briefing_items, life_events, commitments, memory_chunks, approval_actions, reminders, tasks from AI): `source_type, source_id, source_provider, source_timestamp, confidence` + `evidence jsonb` (short verified quotes ≤300 chars) → "Bu nereden çıktı?" opens the real source.
- **Raw email bodies are not persisted.** Stored: headers subset, ≤200-char snippet, AI summary/key points, verified evidence spans, embeddings of derived chunks. "Orijinal Mail" fetches the body on demand from the provider through `api` (sanitised, not stored, not logged).
- **OAuth tokens**: `oauth_credentials` holds AES-256-GCM ciphertext (app-level in Edge Functions; key versions `TOKEN_ENC_KEY_V{n}` + `TOKEN_ENC_ACTIVE_VERSION`; AAD binds account+provider+kind); RLS enabled with **no** policies → invisible to `anon`/`authenticated`; decrypt only in Edge Functions.
- Retention default 90 days (30 / 90 / 365 / until deleted) enforced by `retention_cleanup` job incl. embeddings and storage objects; `expires_at` columns on content tables.
- Audit logs append-only (no UPDATE/DELETE grants + trigger + hash chain).

### ADR-06 Auth
- **App login** (Supabase Auth): Sign in with Apple (native id_token + nonce; also exchange `authorizationCode` server-side to store the Apple refresh token encrypted for revocation at deletion), Google (native `@react-native-google-signin` → `signInWithIdToken`, scopes openid/email/profile only), Microsoft (`signInWithOAuth` azure + PKCE via `openAuthSessionAsync`, `xms_edov` claim), Email OTP (6-digit, custom SMTP). Android also offers Apple via web OAuth. Session stored with LargeSecureStore pattern (AES key in SecureStore, ciphertext in MMKV); first-run keychain purge. Logout = `signOut({scope:'local'})` + push token disable + encrypted cache wipe + RevenueCat `logOut`; "Tüm cihazlardan çıkış" = global.
- **Integrations are separate** from login (ADR-07). An Apple-login user can connect Gmail.
- **Backoffice boundary**: same Supabase project, separate app/domain/cookie (`__Host-da_admin`, httpOnly, Secure, SameSite=Strict); dedicated admin identities (`app_metadata.da_kind='admin'`) that are rows in `admin_users` (role, status); first factor = 6-digit email one-time code (no password, no magic link — R-08); custom access token hook adds `admin_role` claim only for active admins; **MFA (TOTP) mandatory → `aal2` required** by `admin-api` and by restrictive policies on `admin_api` schema functions; app-level idle timeout 30 min + absolute 12 h tracked in `admin_sessions`; "logout all sessions" revokes via admin function; Next server actions reject missing/foreign `Origin`; rate limiting in `proxy.ts` + DB `rate_limit_hit()`.

### ADR-07 Integrations (full detail → `docs/INTEGRATION_PLAN.md`)
- Provider adapter interface in `packages/domain` (`MailProvider`, `CalendarProvider`, `TaskProvider`) with implementations `google`, `microsoft`, `demo` (deterministic fixtures, only when `DEMO_MODE=true`; refuses to start in production unless `ALLOW_DEMO_IN_PRODUCTION=true`); device providers (`apple_device`, `android_device`) run in the app and upload minimal normalised snapshots. Provider-specific logic never leaks into domain.
- **OAuth**: server-side authorization code + PKCE; `api` `/integrations/:provider/start` creates `oauth_states` (10 min, single use) and returns the auth URL; app opens `WebBrowser.openAuthSessionAsync`; provider redirects to `oauth` function on our custom API domain; tokens encrypted; granted-scope string parsed (Google granular consent → `partial` status); redirect to `dijitalasistan://integrations/callback?...` (universal/app link preferred). **Least privilege + progressive authorization**: Gmail `gmail.readonly` (restricted → CASA required, documented manual blocker), Calendar `calendar.events.readonly` + `calendar.calendarlist.readonly` + `calendar.settings.readonly`, Tasks `tasks.readonly`; on first approved write: `gmail.send` (sensitive), `calendar.events.owned` (fallback `calendar.events`), `tasks`. Microsoft: `openid profile email offline_access User.Read Mail.Read` → `Calendars.Read`, `Tasks.Read` → progressive `Mail.Send` (reply via `POST /messages/{id}/reply`, never `createReply`), `Calendars.ReadWrite`, `Tasks.ReadWrite`; certificate client credential; `Prefer: IdType="ImmutableId"`. **No `gmail.compose`** (drafts live in our DB).
- **Sync**: Gmail initial (last 72 h for First Analysis → backfill to retention window, metadata first, full body only for triage survivors, transient), incremental `history.list` from Pub/Sub push (OIDC-verified) + reconciliation; 404 → bounded resync; daily `watch` renewal; per-user quota token bucket (6,000 units/min new-project limit). Calendar `syncToken` + `events.watch` channels (410 → full resync, renew 24 h before expiry). Graph per-folder message delta (inbox/sentitems) + `calendarView/delta` rolling window re-baselined daily; subscriptions ≤7 days renewed at <48 h; lifecycle handling; 4-concurrent/mailbox limiter; 429 `Retry-After`. Tasks/To Do: poll 15 min + foreground. Apple EventKit / Android CalendarContract: device read (full access requested only on "Bağla") → upload normalised events on foreground/change/background task; staleness shown in provenance.
- **Disconnect/revoke**: stop watches/subscriptions → provider revoke (Google `/revoke`; Microsoft has no per-app revoke → documented user-side removal link) → delete ciphertext → purge per retention → audit.

### ADR-08 AI architecture (full detail → `docs/AI_PIPELINE_PLAN.md`) — see §8
### ADR-09 Approvals & write safety — see §6 / §7 (approval state machine + provider-level idempotency)
### ADR-10 Notifications — Expo Push Service (enhanced security token) from `worker`; server-side decision engine; Android channels; iOS interruption levels; detail modes rendered server-side (default `title_only`); receipts polling; device-local notifications only for user-created smart reminders.
### ADR-11 Subscriptions — RevenueCat (entitlement `pro`, `da_pro_monthly`, `da_pro_annual`), webhook → re-fetch customer (REST v2) → overwrite `subscriptions` mirror; referral/admin grants kept in our DB (`entitlement_grants`), `effective_entitlement(user_id)` SQL function used by client and server; custom paywall in PRIMARY style; trial copy only when the store offer exists.
### ADR-12 Widgets / share / Android NI
iOS WidgetKit (SwiftUI) via `@bacons/apple-targets` + App Group `group.com.dijitalasistan.app`; Android Jetpack Glance widgets (2×2, 4×2) in local module `da-widgets`; shared privacy-safe `WidgetSnapshot` (zod schema) written by the app; widgets read-only with deep links. Share: `expo-share-intent` (iOS text/URL/image/PDF, Android `ACTION_SEND`/`ACTION_SEND_MULTIPLE`) → Universal Capture common domain flow. Android Notification Intelligence: local Kotlin module with `NotificationListenerService`, explicit opt-in, selected/all-apps modes, locked default denylist (authenticators, password managers, e-Devlet, OTP detector), **on-device structured-signal extraction only** (raw notification text never uploaded); iOS hides the feature entirely.
### ADR-13 Analytics & observability
First-party `analytics_events` (allow-listed event names + typed props, no content) feeding backoffice metrics; optional external adapter interface. Sentry adapters (mobile, web, backoffice, functions) with PII scrubbing; structured JSON logs with `correlation_id` threaded User → Integration → Job → AI/Briefing → Notification; `ai_requests` telemetry without content.
### ADR-14 i18n
ICU catalogs in `packages/i18n` (`tr` default, `en` complete), typed keys, one API (`use-intl` mobile, `next-intl` web/backoffice); 24-h clock, `tr-TR` number/currency formatting (`Intl.NumberFormat('tr-TR',{currency:'TRY'})`), date-fns `tr` for relative time (Hermes lacks `Intl.RelativeTimeFormat`); pseudo-locale (+40%) for truncation QA; quality-gate grep bans hard-coded user-facing strings and "yakında/coming soon" tokens.
### ADR-15 Testing & CI — see §17/§18.

---

## 4. App boundaries

| Boundary | Talks to | Holds secrets? | Auth |
|---|---|---|---|
| Mobile app | PostgREST (RLS, publishable key), `api`, provider OAuth pages via system browser, RevenueCat SDK, Expo push registration | No (only publishable key, RevenueCat public SDK keys) | Supabase user session (SecureStore) |
| Web (marketing) | `public-api` (support, data-deletion), Supabase Auth OTP (data-deletion identity) | No | none / OTP for deletion |
| Backoffice | `admin-api` only (server-side from Next route handlers/server actions using the admin's access token cookie) | No Supabase secret; only its own session cookie secret | Supabase Auth + TOTP (`aal2`) + `admin_users` role |
| Edge Functions | Postgres, Storage, providers, AI providers, Expo Push, RevenueCat | Yes (Edge secrets) | per function (table in ADR-04) |
| Postgres | pg_cron → pg_net → `worker` | Vault: project URL + cron secret only | RLS + restrictive admin policies |

---

## 5. Domain model (canonical names — every document and migration must use these)

**Enums** (Postgres enums + `packages/domain` const unions):
- `provider`: `google | microsoft | apple_device | android_device | demo`
- `capability`: `mail_read | mail_send | calendar_read | calendar_write | tasks_read | tasks_write`
- `account_status`: `connecting | healthy | syncing | partial | needs_reauth | admin_consent_required | error | disconnected`
- `mail_category`: `important | awaiting_my_reply | awaiting_their_reply | has_deadline | informational | low_priority` (UI: Önemli / Senden Cevap Bekleyen / Senin Cevap Beklediğin / Son Tarih İçeren / Bilgilendirme / Düşük Öncelik)
- `decision_tier`: `explicit_rule | learned_preference | deterministic_signal | ai_classification`
- `insight_kind`: `reply_needed | meeting | deadline | follow_up | commitment | life_event | security | conflict | schedule_suggestion | approval_pending | digest`
- `urgency`: `urgent | today | normal | low`
- `item_status`: `open | done | dismissed | snoozed | expired`
- `life_event_type`: `shipment | flight | reservation | payment | subscription | security`
- `flow_card_type`: `email | meeting | deadline | shipment | flight | reservation | payment | subscription | security` (+ `follow_up`, `commitment` rendered as neutral variants)
- `commitment_direction`: `user_owes | they_owe`; `commitment_status`: `open | done | snoozed | cancelled`
- `approval_action_type`: `email_send | calendar_create | calendar_update | task_create | reminder_create | commitment_create`
- `approval_status`: `pending | approved | rejected | executing | executed | failed | expired`
- `briefing_kind`: `morning | midday | evening | weekly`; `briefing_status`: `scheduled | generating | ready | delivered | skipped | failed`
- `capture_kind`: `photo | screenshot | pdf | file | link | text | share`; `capture_status`: `uploaded | analyzing | extracted | actioned | discarded | failed`
- `extracted_entity_type`: `event | task | deadline | person | payment | reservation | flight | shipment | product | note`
- `notification_category`: `morning | midday | evening | critical_email | meeting | deadline | follow_up | life_intel | approval | account`
- `notification_detail`: `full | title_only | generic`; `notification_decision`: `scheduled | sent | suppressed | deduplicated | failed`
- `job_type`: `initial_sync | gmail_sync | outlook_sync | calendar_sync | tasks_sync | device_calendar_ingest | watch_renewal | reconciliation | provider_webhook | email_triage | email_analysis | insight_refresh | first_analysis | briefing | meeting_prep | embedding | approval_execute | notification | push_receipts | retention | export | history_deletion | account_deletion | billing_sync | referral_evaluate | health_check`
- `job_status`: `queued | running | completed | retrying | failed | dead_letter`
- `admin_role`: `super_admin | operations | support | finance | ai_ops | analyst | readonly`
- `prompt_status`: `draft | active | archived`; `ticket_status`: `open | in_progress | waiting_user | resolved | closed`; `ticket_category`: `account | integration | sync | billing | ai_quality | notification | privacy | other`; `feedback_type`: `bug | feature | general | ai_quality`
- `grant_source`: `referral_referrer | referral_referee | admin | support | compensation`
- `retention_policy`: `d30 | d90 | d365 | until_deleted`

**Entities → tables** (full column/index/RLS spec → `docs/DATABASE_AND_RLS_PLAN.md`):
- Identity & settings: `profiles`, `user_preferences`, `notification_preferences`, `app_installations`, `push_tokens`
- Integrations: `connected_accounts`, `oauth_credentials`, `oauth_states`, `calendars`, `sync_states`, `provider_quota_usage`, `webhook_events`
- Content: `email_threads`, `email_messages`, `calendar_events`, `tasks`, `commitments`, `reminders`, `meeting_notes`, `meeting_preps`, `contacts`, `vip_people`, `life_events`, `captures`, `android_notification_signals` (structured, on-device-extracted signals only)
- Intelligence: `priority_rules`, `learned_preferences`, `insights`, `briefings`, `briefing_items`, `reply_drafts`, `approval_actions`, `approval_events`, `assistant_threads`, `assistant_messages`, `memory_chunks` (embedding `vector(1024)`), `ai_feedback`, `ai_requests`, `ai_usage_daily`, `ai_model_config` (incl. routing profile `balanced | lean`), `ai_result_cache` (per-user HMAC content-hash dedupe), `prompt_versions`
- Notifications: `notifications`, `push_tickets`
- Business: `subscriptions`, `billing_events`, `entitlement_grants`, `plan_limits`, `referral_codes`, `referrals`, `referral_credits`
- Ops/product: `jobs`, `job_attempts`, `analytics_events`, `feature_flags`, `feature_flag_overrides`, `announcements`, `announcement_dismissals`, `user_feedback`, `system_health_checks`, `rate_limits`
- Privacy: `data_export_requests`, `data_deletion_requests` (kinds `history | account`)
- Admin: `admin_users`, `admin_sessions`, `admin_preferences`, `audit_logs`, `support_tickets`, `support_notes`, `support_access_grants`
- Schemas: `public` (RLS user data + exposed RPCs), `private` (security-definer helpers, not exposed), `admin_api` (exposed to PostgREST only for `admin-api` calls; every function checks `private.require_admin(permission)` = active admin + `aal2`).

**Key invariants**
- Uniqueness/dedupe: `email_messages (connected_account_id, provider_message_id)`, `email_threads (connected_account_id, provider_thread_id)`, `calendar_events (calendar_id, provider_event_id)`, `insights (user_id, dedupe_key)`, `life_events (user_id, dedupe_key)`, `commitments (user_id, dedupe_key)`, `reminders (user_id, idempotency_key)`, `approval_actions (idempotency_key)`, `briefings (user_id, kind, local_date)`, `notifications (user_id, dedupe_key)`, `jobs (idempotency_key)`, `billing_events (event_id)`, `webhook_events (source, external_id)`, `referral_credits (referral_id, side)`, `entitlement_grants (idempotency_key)`, `prompt_versions (prompt_key, version)` + partial unique one-`active`-per-key, `vip_people (user_id, contact_id)`.
- Priority precedence (domain `priority-engine`): `explicit_rule` → `learned_preference` → `deterministic_signal` → `ai_classification`; each result stores `decision_tier`, `reason`, `rule_id?`, `confidence`.
- Approval state machine (DB-enforced `private.transition_approval`): `pending → approved → executing → executed | failed`; `pending → rejected | expired`; `failed → executing` (retry, same idempotency key); edits create a new payload version + new idempotency key while `pending`.

### 5b. Canonical `api` route catalogue (Hono, `/functions/v1/api`; full contracts per master §146 → `docs/API_CONTRACTS.md`)
Clients never insert `approval_actions` directly — every write with a side effect is *proposed* through `api`, which validates, computes the exact change, and returns a `pending` approval.

| Area | Routes |
|---|---|
| Devices/auth | `POST /devices/register`, `POST /devices/unregister`, `POST /auth/apple/exchange` |
| Bootstrap | `GET /me/bootstrap` (profile, prefs, entitlements, flags, counts, announcements), `GET /me/entitlements` |
| Integrations | `POST /integrations/:provider/start`, `POST /integrations/oauth/complete` (client-bound completion, R-07), `POST /integrations/:accountId/upgrade` (progressive scope), `POST /integrations/:accountId/disconnect`, `POST /integrations/:accountId/sync`, `PATCH /integrations/:accountId/data-sources`, `POST /integrations/device-calendar/snapshot` |
| Onboarding | `POST /onboarding/first-analysis`, `GET /onboarding/first-analysis/:jobId` |
| Mail | `GET /mail/:messageId/original` (on-demand, sanitised, not stored), `POST /mail/:messageId/reply-drafts` {tone}, `POST /reply-drafts/:id/regenerate`, `PATCH /reply-drafts/:id`, `POST /reply-drafts/:id/submit` (→ `email_send` approval), `POST /followups/:threadId/draft` |
| Approvals | `POST /approvals` (propose: calendar_create/update, task_create, reminder_create, commitment_create), `PATCH /approvals/:id` (edit → new payload version), `POST /approvals/:id/approve` {idempotency_key}, `POST /approvals/:id/reject`, `POST /approvals/:id/device-execution` (result of on-device EventKit/CalendarContract writes, R-18) |
| Reminders | `POST /reminders/resolve-time` (preset → absolute time + reason; "Uygun zamanda"), `POST /reminders` (in-app, confirm step), `POST /reminders/:id/cancel` |
| Plan | `GET /plan/free-slots`, `POST /plan/proposals`, `POST /plan/conflicts/:insightId/options`, `POST /plan/conflicts/:insightId/resolve` |
| Meetings | `POST /meetings/:eventId/prep` (generate/refresh), `POST /meetings/:eventId/notes`, `POST /meetings/:eventId/post` (text/voice → commitment proposals) |
| Assistant | `POST /assistant/threads`, `POST /assistant/threads/:id/messages` (SSE stream; citations; proposed actions), `POST /assistant/transcribe` (server STT fallback) |
| Search/memory | `GET /search?q=&types=` (hybrid FTS + vector, RLS-scoped) |
| Capture | `POST /captures/upload-url`, `POST /captures` (text/link/share), `POST /captures/:id/analyze`, `POST /captures/:id/actions` (→ approval) |
| Briefings | `POST /briefings/:id/audio` (signed URL or native-TTS chapters), `POST /briefings/:id/evening-ready` ("Yarına Hazırım" carry-over), `GET /weekly/:id/share-card` |
| Business | `POST /referrals/apply`, `GET /referrals/me`, `POST /purchases/sync` (post-purchase refresh from RevenueCat) |
| Privacy | `POST /privacy/export`, `POST /privacy/delete-history`, `POST /privacy/delete-account` |
| Support | `POST /support/tickets`, `POST /feedback` |
| Android NI | `POST /android-notifications/signals` (structured signals only; Pro) |
| Analytics | `POST /analytics/events` (batched, allow-listed) |

Simple owner-scoped writes go straight to PostgREST under RLS (e.g. `set_insight_status` RPC, `ai_feedback` insert, `priority_rules` / `vip_people` / `learned_preferences` CRUD, preference updates).

---

## 6. Database + RLS (summary; full per-table spec → `docs/DATABASE_AND_RLS_PLAN.md`)

- **Migrations**: `supabase/migrations/<UTC timestamp>_<name>.sql`, forward-only, ordered: `0001 extensions+schemas+enums` → `0002 identity/settings` → `0003 integrations` → `0004 content` → `0005 intelligence` → `0006 approvals` → `0007 assistant/memory` → `0008 notifications` → `0009 business` → `0010 ops/product` → `0011 privacy` → `0012 admin+audit` → `0013 functions/RPCs` → `0014 RLS policies + grants` → `0015 cron schedules` → `0016 storage buckets+policies`. PG16-compatible SQL (tier-C tests) although hosted runs PG17; pgvector features limited to 0.6 (vector(1024) + HNSW `vector_cosine_ops`).
- **RLS pattern** (every user-data table): `enable` + `force row level security`; policies `select/insert/update/delete to authenticated using ((select auth.uid()) = user_id) with check (...)`; column-level `GRANT update(col,…)` for user-editable columns only; child tables without `user_id` are forbidden (every table carries `user_id` for RLS + retention). System tables (`jobs`, `oauth_credentials`, `oauth_states`, `webhook_events`, `billing_events`, `ai_requests`, `audit_logs`, `admin_*`, `support_*`, `system_health_checks`, `rate_limits`) have RLS enabled with **no** `anon/authenticated` policies (service/admin paths only). Restrictive policy `aal2` on every `admin_api` path. Storage buckets `captures`, `exports`, `briefing-audio` private with `(storage.foldername(name))[1] = auth.uid()::text` policies; signed URLs 60–300 s.
- **Security-definer functions** live in `private`, `set search_path = ''`, fully qualified names, `revoke execute from public`.
- **Tests**: pgTAP suites per table (owner can CRUD own rows; other user sees 0 rows / cannot insert with foreign `user_id`; anon denied; system tables invisible; admin functions reject `aal1` and non-admins; audit log immutable; approval transitions legal/illegal; idempotency uniques) + a generic "every table in public has RLS forced" assertion.

---

## 7. OAuth / integrations (summary of ADR-07; contracts → `docs/INTEGRATION_PLAN.md`, `docs/API_CONTRACTS.md`)

| Provider | Login | Integration (initial scopes) | Progressive scopes | Sync | Push/watch | Revoke |
|---|---|---|---|---|---|---|
| Google | native id_token (openid email profile) | Gmail `gmail.readonly`; Calendar `calendar.events.readonly calendar.calendarlist.readonly calendar.settings.readonly`; Tasks `tasks.readonly` | `gmail.send`, `calendar.events.owned` (→`calendar.events`), `tasks` | history.list / syncToken / Tasks poll 15 min | Gmail `watch`→Pub/Sub (OIDC push), Calendar `events.watch` channels | `POST oauth2.googleapis.com/revoke` |
| Microsoft | Supabase `azure` OAuth + PKCE | `openid profile email offline_access User.Read Mail.Read`, `Calendars.Read`, `Tasks.Read` | `Mail.Send`, `Calendars.ReadWrite`, `Tasks.ReadWrite` | message delta per folder, calendarView delta, To Do delta poll | Graph subscriptions ≤7 days + lifecycle | none per-app → documented user link; local purge |
| Apple | native SIWA (+ web OAuth on Android) | EventKit full access (events + reminders) on device | — | device snapshot upload | EKEventStoreChanged / foreground / background task | local; SIWA token revoke at account deletion |
| Android | — | CalendarContract `READ_CALENDAR` | `WRITE_CALENDAR` on write | device snapshot upload | foreground / background task | local |

- Provider-side idempotency for approved writes: Gmail sets `Message-ID: <approval-{id}@mail.dijitalasistan.app>` and checks `rfc822msgid:` before any retry; Google Calendar inserts with deterministic `id` (base32hex of approval id) → duplicate insert = 409 = already done; Graph event create uses `transactionId = approval id`; Graph mail tags a `singleValueExtendedProperty` and checks Sent Items before retry; Tasks/To Do store the returned provider id and search notes/`linkedResources` marker before retry. Created events carry `extendedProperties.private.da_approval_id` / Graph extended property for reconciliation.
- Error mapping → `account_status` + UI copy from design 08 ("Gmail bağlantısı yenilenmeli." / "Yeniden Bağlan").

---

## 8. AI architecture (summary; full detail → `docs/AI_PIPELINE_PLAN.md`)

Pipeline per ingested item: **provider ingestion → normalisation → deterministic filters/rules (priority rules, VIP, List-Unsubscribe/Precedence/Auto-Submitted, DKIM/SPF, sender reputation, dedupe by content hash) → lightweight classification (small model, batched) → larger reasoning model only for survivors that need summary/extraction → zod structured-output validation → source grounding verification (quoted evidence must exist in source; dates/amounts re-parsed deterministically from the evidence) → persistence with provenance → insight/briefing/notification**.

- **Provider abstraction** (`supabase/functions/_shared/ai/`): `LLMProvider.generateStructured(schema, prompt, opts)`, `embed()`, `transcribe()`, `synthesize()`; adapters `anthropic`, `openai`, `fixture` (deterministic, demo/tests only). Model per feature comes from `ai_model_config` (backoffice-editable, audited), never hard-coded in product code; prompts from `prompt_versions` (active version per key, cached); every call writes `ai_requests` (feature, provider, model, prompt_version_id, tokens incl. cache read/write, latency, cost_usd_micros, status, correlation_id — no content).
- **Tiers & default routing (seeded into `ai_model_config`, editable + audited; verified 2026-09-23)**: **T0 deterministic** (pre-filter, rules/VIP, follow-up state machine, midday/evening lists, security events, schema.org/JSON-LD + Turkish sender-template life-intel parsers, slot finder, TR date/amount/tracking/flight/PNR extractors, intent grammar for suggested prompts/voice commands) → **T1 small** `claude-haiku-4-5-20251001` (email triage 6-way + needs_reply/expects_reply + evidence quotes, micro-batched ≤5 emails/request; commitment extraction when TR commitment regex fires; life-intel fallback; post-meeting parse; capture text/link; assistant intent) → **T2 large** `claude-sonnet-5` (morning briefing from ranked item JSON only, thread summaries on open, deep extraction escalations, meeting prep (precomputed T-60 for external/VIP meetings, else on tap), weekly review via Message Batches, reply drafts (all 4 tones in one call), capture photo/PDF, grounded assistant QA with native `search_result` citations) → **T3** `claude-opus-5-5` escalation behind flag `ai.model.opus_escalation` (<2% of calls). **Fable 5.1 excluded** (Covered Model: mandatory 30-day retention conflicts with privacy copy). Fallback chains T1 → Sonnet 5 (low effort) → OpenAI `gpt-5.6-luna` → T0; T2 → Haiku → `gpt-5.6-terra` → T0 template; AI fully down → last analysis shown. Model-specific request rules enforced in adapters (no sampling params/prefill on Sonnet 5/Opus 5.5; no `effort` on Haiku; Haiku cache prefix ≥4,096 tokens). **Haiku 4.5 retirement "not sooner than 2026-10-15" → model IDs are config-only; replacement is a backoffice config change, never a code change.**
- **Embeddings**: Voyage **`voyage-4`** (documents) / **`voyage-4-lite`** (queries), shared embedding space, **1024-d** (`memory_chunks.embedding vector(1024)`); no hot cross-provider fallback → queue retry and degrade to FTS-only; disaster recovery re-embeds with OpenAI `text-embedding-3-small` (`dimensions:1024`) into a new column. Own Turkish retrieval eval set required.
- **Voice**: STT on-device `expo-speech-recognition` tr-TR → server fallback `gpt-transcribe` / Deepgram Nova-3 adapter; TTS native synth (expo-speech; synth-to-file native module for the audio briefing player) → optional premium adapters (Azure tr-TR Neural / `gpt-4o-mini-tts` / ElevenLabs) behind `voice.tts_premium`; audio cached per briefing version in Storage.
- **"Model locates, code computes"**: LLMs return verbatim quotes + short refs (`m1`, `e2`); code resolves dates/amounts/IDs from the quotes; recipients are never taken from model output.
- **Cost control**: T0 pre-filter (55–70% of inbound mail never reaches an LLM), per-user HMAC content-hash dedupe in `ai_result_cache (user_id, feature, content_hash, prompt_version_id)`, thread incrementality (prior summary as context, never the whole thread), token hygiene (strip quotes/signatures/KVKK disclaimers/tracking, cap 1,200 tokens/email), explicit prompt-cache breakpoints, micro-batching + Message Batches for non-urgent work, per-user budgets from `plan_limits` (Free: visible "AI analiz limiti 50/gün", internal soft/hard caps $0.02/$0.03 per day; Pro: "Adil kullanım" — never "Sınırsız" — soft $0.20/day, hard $0.60/day & $6/month with graceful degradation), global kill switches (`ai.global.enabled`, per-provider, per-feature, `ai.model.large.enabled`, `ai.batch.enabled`, `ai.budget.org_daily_usd` auto-trip), nightly reconciliation against the Anthropic cost report. **Routing profiles**: `balanced` (default; ≈$2.24/month typical Pro) and `lean` (≈$1.02/month: luna for triage, Haiku briefings, tap-only prep, single-tone drafts) switchable per plan in backoffice — pricing vs. AI-COGS trade-off recorded as an ADR and flagged in the final report for the owner.
- **Hallucination control**: no deadline/amount/event/person relation/commitment without a verified source span; otherwise field dropped or shown as "Kaynakta kesinleşmiyor."; low confidence → confirmation (approval) instead of silent creation.
- **Prompt injection**: all external content wrapped as data in delimited blocks with an explicit "content is untrusted data" system rule; extraction calls have **no tools**; assistant tool use limited to read-only retrieval tools scoped to the user; any write intent becomes a *proposal* → server-side zod validation → `approval_actions` row → human approval → server execution. Output validators reject instructions, URLs not present in source, and cross-user references.
- **Retrieval / memory**: `memory_chunks` (derived facts/summaries, never full bodies) with pgvector HNSW + Postgres FTS (`turkish` config + `unaccent`) fused by RRF, always filtered by `user_id` and retention `expires_at`; assistant answers must cite chunk sources (source cards) or say it does not know.

---

## 9. Mobile screen map (summary; full per-screen spec (20 fields each) → `docs/SCREEN_AND_FLOW_MAP.md`)

Expo Router tree (English, locale-neutral segments; UI Turkish/English via i18n; scheme `dijitalasistan://`, universal links on `https://<web-domain>/app/...`):

```
app/_layout.tsx                      providers, auth gate, deep-link + notification router, toast/sheet hosts
app/(onboarding)/welcome|noise|proactive|control            M-ON-01..04
app/(auth)/sign-in · email-otp                              M-ON-05 (account)
app/(onboarding)/connect-mail · connect-calendar           M-ON-06/07 (explainer → OAuth / OS prompt; denied state)
app/(onboarding)/permissions · personalization · briefing-schedule · vip · analysis · ready · notifications · android-notifications
app/(tabs)/_layout.tsx               4 fixed tabs, per-tab stacks: Bugün · Akış · Plan · Asistan
app/(tabs)/today/index               Today (hero, priorities, meeting, deadline, follow-up, life intel, approval pill)
app/(tabs)/flow/index                Flow (filters Tümü/Önemli/Mail/Takvim/Takip/Kişisel, 9 card types, swipe)
app/(tabs)/plan/index                Plan day/week, calendar intelligence, AI schedule proposals
app/(tabs)/assistant/index           Assistant (suggested prompts, grounded chat, source cards)
app/briefing/[id] · briefing/[id]/listen (modal) · weekly/[id] · weekly/[id]/share
app/mail/index (Mail Intelligence) · mail/[id] · mail/[id]/reply (modal) · waiting · followups · commitments · commitments/[id]
app/life/[id] (sheet) · event/[id] · meeting/[eventId]/prep · meeting/[eventId]/summary · meeting/[eventId]/post
app/plan/proposal/[id] (sheet) · plan/conflict/[id]
app/person/[id] · vip · search · memory · voice (fullScreenModal) · capture (modal) · capture/[id]
app/approvals/index · approvals/[id]
app/reminders/new (global sheet; deep-linkable)
app/settings/index · profile · accounts · accounts/[id] · notifications · briefings · privacy · privacy/permissions ·
    privacy/data-sources · privacy/retention · privacy/history · privacy/export · privacy/delete-account ·
    personalization · priority-rules · priority-rules/[id] · appearance · language · subscription · referral ·
    android-notifications · help · feedback · about
app/paywall (modal) · app/+not-found
```

Every screen implements loading (skeleton), empty, error, offline (cached data + banner), retry, reconnect, partial-data and permission edge states; every visible control maps to a real action (No-Dead-Action inventory in DELIVERY_CHECKLIST).

---

## 10. Backoffice screen map (summary; per-module spec → `docs/BACKOFFICE_PLAN.md`)

`admin.<domain>` Next.js app, desktop-first, light default + dark toggle (persisted in `admin_preferences`), sidebar exactly as master §46: Overview/Dashboard · Users/Users, Support · Operations/Integrations, Sync & Jobs, Briefings, Notifications · AI/AI Operations (incl. costs, model config), Prompt Management (+ AI Feedback) · Business/Subscriptions (incl. entitlement overrides), Referrals · Product/Feedback, Feature Flags, Announcements · Privacy/Data Requests, Audit Logs · System/System Health (+ app versions/observability), Admin Users, Settings. Routes `/login`, `/mfa`, `/dashboard`, `/users`, `/users/[id]/{overview,integrations,briefings,usage,subscription,referrals,support,audit}`, `/support[/id]`, `/integrations`, `/jobs[/id]`, `/briefings`, `/notifications`, `/ai`, `/ai/models`, `/ai/prompts[/key]`, `/ai/feedback`, `/subscriptions`, `/referrals`, `/feedback`, `/flags`, `/announcements`, `/data-requests`, `/audit`, `/health`, `/admins`, `/settings`. Cmd/Ctrl+K palette (IDs, masked email lookups; destructive actions route into confirmation flows). All tables: server pagination, sorting, filtering, column visibility, loading/empty/error/retry. Sensitive mutations: permission + reason + confirmation + audit; PII masked (`yu***@gmail.com`) with audited, permission-gated reveal; Support Access grants (reason, limited duration, reveal events logged); no impersonation.

RBAC matrix (server-enforced in `admin-api` and again in `admin_api` SQL; sidebar hiding is cosmetic): `super_admin` all; `operations` users (non-financial), integrations, jobs retry, briefings, notifications, flags, announcements, health; `support` users (masked), support tickets, support-access requests, data requests (view/retry), force sync; `finance` subscriptions, entitlement grants, referrals, revenue metrics; `ai_ops` AI ops, model config, prompts, AI feedback, AI flags; `analyst` read-only aggregates; `readonly` read-only masked views. Last `super_admin` cannot be disabled/demoted (DB constraint trigger).

---

## 11. Public web map (summary → SCREEN_AND_FLOW_MAP §Web)

`/` (Hero "Bugün bilmen gerekenleri, sen sormadan söyler." + supporting line, Integrations, How it works, Morning Briefing, Mail Intelligence, Meeting Prep, Smart Planning, AI Memory, Security, Pricing, FAQ, CTA → store badges / QR on desktop), `/pricing` (prices shown as "mağaza fiyatı" ranges with store-authoritative note; no fake trial claims), `/privacy` (incl. Google API Services User Data Policy Limited Use statement, AI sub-processors, no training), `/terms`, `/support` (FAQ from shared i18n content + contact form → `public-api` → `support_tickets`), `/data-deletion` (email-OTP verified request → `data_deletion_requests`), `/r/[code]` (referral landing → store / deep link), `/oauth/done` (universal-link fallback), `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json`, `sitemap.xml`, `robots.txt`, OG images; `tr` default + `/en`. SSG/ISR, Lighthouse ≥90 targets, keyboard navigation, reduced motion.

---

## 12. Security model (summary → `docs/SECURITY_AND_PRIVACY_PLAN.md`, later `docs/SECURITY.md`)

Threat model covers token theft, session theft, account takeover, OAuth misconfiguration, webhook forgery, privilege escalation, SSRF, malicious uploads, prompt injection, AI data exfiltration, cross-tenant access, admin abuse, replayed write actions, notification leakage, referral abuse — each with mitigations + residual risk. Highlights: encrypted tokens never leave Edge Functions; PKCE + single-use state; webhook authenticity (OIDC JWT, HMAC channel token, hashed clientState, RevenueCat secret) + replay dedupe (`webhook_events`); RLS forced everywhere + pgTAP; admin `aal2` + RBAC in two layers + audit hash chain; SSRF-safe fetcher for links (https only, DNS resolve + block private/loopback/link-local/metadata ranges on every hop, ≤3 redirects, 5 MB cap, 10 s timeout, content-type allowlist, no cookies); uploads (size/MIME/extension/magic-byte checks, private per-user bucket, no execution, parsing in isolated worker path with timeouts, cleanup by retention); push payloads contain only `{type, entity_id, deeplink}` and server-rendered text per detail mode; secrets only in Edge secrets/CI secrets, env schema split server/client, CI grep for secret patterns in bundles.

## 13. Privacy model
Privacy Center (Connected Accounts, Permissions (granted scopes + OS permissions), AI Accessible Data + per-account Data Source Controls enforced server-side, Retention, Delete History, Export Data, Delete Account, AI Personalization). Copy only states what is true (encrypted in transit and at rest; no approval → no important action; data never sold for ads; mail content never used to train models; **no** "uçtan uca şifreleme" claim). Export: async job → zip (JSON per entity, no tokens/secrets) in private bucket → signed URL (24 h) → status screen → audit. History deletion and account deletion: explicit confirmation + consequences + re-auth + queued job + provider watch stop/revoke (Google revoke, SIWA revoke, Graph local-only documented) + DB/storage/embeddings/tokens purge + RevenueCat customer delete + local cache wipe + audit (subject identifiers hashed after completion) + honest status (never fake "deleted").

## 14. Notification / jobs architecture
Decision engine (`packages/domain/notifications`): relevance → urgency → user category preference → quiet hours (user tz) → dedupe key → frequency cap (rolling 24 h per category + global) → lock-screen sensitivity/detail mode → send / schedule / suppress (reason recorded → backoffice suppression metrics). Scheduled work: morning / midday (only if meaningful delta, else `skipped`) / evening / weekly (Sunday 18:00 local) briefings, meeting prep T-30…T-15, post-meeting prompt at event end (+1 min), deadline and follow-up nudges, approval expiry, retention, provider sync reconciliation, watch renewal, push receipts, health checks — all idempotent with deterministic keys (`briefing:{user}:{kind}:{local_date}` etc.), timeout-bounded, retryable, dead-letterable, DST-safe (local-time evaluation via `AT TIME ZONE`).

## 15. Subscription architecture
Free: 1 mail account, 1 calendar, Morning Briefing, basic important mail, limited AI (daily budget), basic Today. Pro: multiple accounts/calendars, Midday, Evening, Meeting Prep, Follow-Up, Commitments, Voice Briefing, AI Memory, VIP, advanced planning, Universal Capture, Android Notification Intelligence. `effective_entitlement(user)` = active store subscription (RevenueCat mirror) OR active `entitlement_grants` (referral/admin/support, stacked, non-overlapping). Enforced server-side in `api`/`worker` for every Pro capability (+ client gating for UX, contextual Pro gate per design 7.6). Paywall: offerings from RevenueCat, localized `priceString`, annual savings computed, trial copy only if eligible, Restore Purchases, Manage Subscription, Terms/Privacy links, close button; Test Store key in dev/demo.

## 16. Referral architecture
`referral_codes` (one per user, short, unambiguous alphabet) → share via native share (`/r/{code}` link) → install → code applied at sign-up (deep link or manual entry) → `referrals` row `pending` → qualification (referee completes onboarding, connects ≥1 account, receives first briefing, account age ≥48 h) → anti-abuse (self-referral by user id/email/Apple relay/device installation hash, duplicate-account heuristics on hashed signals, loop detection A→B→A, per-referrer cap 6/year, velocity limits, risk score → `flagged` for admin review) → `referral_credits` for both sides (idempotent `(referral_id, side)`) → `entitlement_grants` +14 days Pro each (stacked) → notifications; admin visibility (metrics, flags, manual approve/reject with reason + audit).

## 17. Test architecture (→ `docs/TEST_PLAN.md`)
Unit (vitest): priority engine, classification normalisation, TR date/amount parsing, timezone/DST, commitment detection, reminder rules ("Uygun zamanda" slot finder), referral anti-abuse, entitlement logic, grounding verifier, notification decision engine, RBAC matrix, SSRF guard, env schema. Mobile unit/component (jest-expo + RNTL): UI kit, theme, a11y props, screen states. DB (pgTAP): RLS isolation, grants, state machines, idempotency, audit immutability, retention. Edge (deno test): OAuth start/callback (mocked provider), webhooks (signature/replay), sync adapters (recorded fixtures), AI adapters (fixture provider + schema validation), approval execution idempotency, RevenueCat webhook, notifications. E2E: Playwright web (landing, pricing, CTA, legal, responsive, keyboard, SEO) and backoffice (login+MFA, dashboard, user search/detail, integration view, job retry, briefing ops, AI cost, prompt activation, feature flag, support, audit, data request, entitlement grant, logout) against local Supabase; Maestro mobile flows (all master §102 items + secondary acceptance flows A–J) in CI on dev/preview builds with demo mode.

## 18. CI/CD
GitHub Actions: `install (pnpm, cache) → lint → typecheck → unit (vitest + jest-expo) → db (supabase start → db reset → test db → db lint) → functions (deno check/lint/test) → integration → web build → backoffice build → migration validation (squawk + reset from zero) → E2E web/backoffice (Playwright) → mobile checks (expo install --check, expo-doctor, expo export, prebuild smoke) → secret scan / bundle scan → quality gate (placeholder/TODO grep, no service-role in client bundles, RLS-forced assertion)`. EAS: `development`, `preview`, `e2e`, `production` profiles; EAS Workflows for Maestro; Vercel projects for web and backoffice (separate); Supabase deploy job (migrations + functions `--use-api` + secrets check) on protected branch with manual approval.

## 19. External credentials (matrix → `docs/INTEGRATION_PLAN.md` §Credentials and `.env.example`)

| Provider | Credential | Why | Environment | Used by | Required for local demo? | Production required? |
|---|---|---|---|---|---|---|
| Supabase | project URL, publishable key, secret key, DB URL, JWT settings | backend | all | api-client, functions, CI | No (local stack/shim) | Yes |
| Google Cloud | Web OAuth client ID/secret, iOS/Android client IDs (login), Pub/Sub topic + push SA, OAuth consent + **CASA** | Gmail/Calendar/Tasks, login | functions, mobile | oauth, sync, login | No (demo adapter) | Yes |
| Microsoft Entra | app (client) ID, certificate (private key + thumbprint), tenant `common` | Outlook/Calendar/To Do, login | functions, Supabase Auth | oauth, sync | No | Yes |
| Apple | Team ID, SIWA key (.p8) + key ID, Services ID, App Group, APNs key (via EAS) | login, revocation, push, widgets | functions, EAS | auth, deletion | No | Yes |
| Anthropic | API key | LLM | functions | ai | No (fixture provider) | Yes |
| OpenAI | API key | fallback LLM (luna/terra), DR embeddings, STT/TTS adapter | functions | ai | No (fixture provider) | Recommended (fallback) |
| Voyage AI | API key | embeddings (voyage-4 / voyage-4-lite, 1024-d) | functions | memory, search | No (FTS-only degrade) | Yes |
| TTS/STT premium (optional) | API key | voice briefing audio | functions | voice | No (native TTS) | Optional |
| RevenueCat | iOS/Android public SDK keys, v2 secret key, webhook auth secret, Test Store key | subscriptions | mobile, functions | paywall, billing | No (Test Store / disabled) | Yes |
| Expo / EAS | project ID, access token (push security), FCM v1 service account, APNs key | builds, push | CI, functions | push, builds | No | Yes |
| Sentry | DSNs, auth token (CI) | errors | all apps | observability | No | Recommended |
| SMTP (Resend/Postmark/SES) | SMTP creds for Supabase Auth | email OTP | Supabase Auth | auth | No (local inbucket) | Yes |
| Encryption | `TOKEN_ENC_KEY_V1…`, `TOKEN_ENC_ACTIVE_VERSION`, `WEBHOOK_HMAC_SECRET`, `CRON_SECRET` | token encryption, channel tokens | functions | oauth, webhooks | generated locally | Yes |
| Domains | web domain, `admin.` subdomain, API custom domain (Supabase add-on), mail domain (SPF/DKIM/DMARC) | brand verification, links | DNS | all | No | Yes |

Missing credentials never block development: adapters report `external_credential_required` states surfaced in UI ("Harici kimlik bilgisi gerekli") and in System Health (not green).

## 20. Known platform limitations (→ `docs/KNOWN_PLATFORM_LIMITATIONS.md`)
iOS has no system-wide notification stream (Android NI hidden on iOS); Apple/Android device calendars sync only when the app runs (foreground/background task best-effort) → provenance shows last device sync; iOS BGTaskScheduler timing not guaranteed; WidgetKit refresh budget (~40–70/day); Google Tasks has date-only due and no push (15-min poll); Microsoft has no per-app token revoke (user link documented); Gmail restricted scope needs annual CASA and ≤100 users before verification; Android 13+ restricted settings for sideloaded NI; Android 15 OTP redaction; Hermes lacks `Intl.RelativeTimeFormat`; share extension memory ~120 MB; RTL not supported; travel time only when source provides it; premium TTS optional; store trials only where configured.

## 21. Execution order (technical dependency order — not a product-scope split; everything ships)

0. Materialise `docs/` from drafts; extract design ZIPs → `design/reference`; scaffold monorepo (pnpm/turbo/tsconfig/eslint/prettier), `.env.example`, `.gitignore`, CI skeleton, README.
1. `packages/config`, `packages/design-tokens` (tokens.ts + tokens.css + contrast test), icon codegen, `packages/i18n` (catalog skeleton + typed keys), `packages/domain` (enums/entities + pure engines with unit tests), `packages/validation` (zod contracts).
2. Supabase: migrations 0001–0016, compat shim, pgTAP RLS suites, demo seed (gated), type generation → `packages/api-client`.
3. Edge shared libs (`_shared`: auth wrappers, logger+correlation, errors, crypto (AES-GCM), rate limit, SSRF fetcher, jobs client, provider adapter interfaces, AI provider abstraction + fixture provider) + `worker` + `scheduler_tick` + `health`.
4. Integrations: `oauth`, `api /integrations/*`, Google + Microsoft adapters, demo adapter, sync engine (initial/incremental/reconciliation/watch), webhooks (google, microsoft), quota limiter, disconnect/revoke.
5. AI pipeline: triage/filters → classification → analysis (summary, key points, follow-ups, commitments, life events) → grounding → insights → contacts/person intelligence → embeddings/memory → briefings (+audio) → meeting prep → assistant (grounded RAG) → reply drafts (4 tones) → capture extraction (text/OCR/PDF/link via SSRF fetcher) → schedule proposals/free-slot finder.
6. Approvals execution (all 6 action types, provider idempotency) + reminders + notifications engine + push + receipts + scheduling.
7. Subscriptions (RevenueCat webhook, mirror, entitlements, plan limits, server gates) + referrals (codes, qualification, anti-abuse, grants).
8. Mobile: UI kit → theming/fonts/icons → navigation shell + auth + onboarding → Today/briefings/audio → Flow/Mail/Reply/Follow-up/Commitments/Life → Plan/Calendar intelligence/Meeting Prep/Post-meeting → Assistant/Voice/Memory/Search/Person/VIP → Capture + share intent → Approvals → Settings/Privacy/Notifications/Priority rules/Personalization/Appearance/Language → Paywall/Referral → offline/persist/queue → widgets (iOS target + Android Glance) → Android NI module → analytics hooks → a11y pass.
9. Web marketing site (+ legal content, SEO, well-known files, data-deletion, support).
10. Backoffice (auth+MFA+sessions → shell/sidebar/palette/theme → every module in §10 → RBAC tests).
11. Privacy/security hardening (export/deletion/retention jobs end-to-end, threat-model checklist, bundle secret scan, headers/CSP).
12. Tests to completion → builds → E2E → fix loop → quality gate → docs (`README`, `ARCHITECTURE`, `DATABASE`, `OAUTH`, `AI_PIPELINE`, `SECURITY`, `PRIVACY`, `MOBILE`, `BACKOFFICE`, `BACKOFFICE_RBAC`, `DEPLOYMENT`, `TESTING`, `AI_PROMPTS`, `DESIGN_MAPPING`, `STORE_CHECKLIST`, `KNOWN_PLATFORM_LIMITATIONS`) → `docs/FINAL_IMPLEMENTATION_REPORT.md` with feature matrix. Commit per milestone on `claude/magical-pascal-edvjgn`, push, open draft PR.

## 22. Definition of Done
A feature is done only when its full chain (UI → state → API → backend → DB → provider/AI → approval → side effect → confirmation → refreshed state) is real and tested, all its screens have loading/empty/error/offline/retry/reconnect/partial states, every visible control performs a real action, strings are i18n'd (tr+en), dark mode verified, a11y props present, analytics events (content-free) emitted, RLS/pgTAP green, unit/integration tests green, and it appears as ✅ in the FINAL_IMPLEMENTATION_REPORT feature matrix with its external-credential dependency stated. Release gate: lint, typecheck, all test tiers, `next build` ×2, mobile bundle/prebuild checks, Playwright E2E, quality-gate greps (TODO/FIXME/placeholder/"coming soon"/"yakında"/empty handlers/fake success/secret in client bundle/missing RLS) all clean.

---

## 23. Answers to the master prompt's Plan-Mode questions (M§0.A) — where each is decided

| Question | Decided in this plan | Full detail |
|---|---|---|
| Monorepo setup / packages / apps & shared packages | ADR-01, ADR-02, ADR-03 | ARCHITECTURE_DECISIONS, IMPLEMENTATION_PLAN (WBS) |
| Exact database schema / RLS policies | §5, §6 | DATABASE_AND_RLS_PLAN |
| OAuth flows | ADR-06, ADR-07, §7 | INTEGRATION_PLAN, API_CONTRACTS |
| Sync architecture | ADR-07, ADR-04 (jobs) | INTEGRATION_PLAN |
| AI pipeline / which AI step for which data / cost control | §8 | AI_PIPELINE_PLAN |
| Mobile navigation, screen map, real interactions per screen | §9 | SCREEN_AND_FLOW_MAP Parts 1–4 |
| Backoffice IA, modules, admin RBAC | §10 | BACKOFFICE_PLAN |
| Approval Center | §5 invariants, §7 idempotency, §5b | API_CONTRACTS, SCREEN_AND_FLOW_MAP Part 2, DATABASE_AND_RLS_PLAN |
| Notification system | ADR-10, §14 | INTEGRATION_PLAN (push), AI_PIPELINE_PLAN (briefings), SCREEN_AND_FLOW_MAP Part 4 (templates) |
| Subscription / RevenueCat | ADR-11, §15 | INTEGRATION_PLAN, API_CONTRACTS |
| Referral | §16 | API_CONTRACTS, DATABASE_AND_RLS_PLAN, BACKOFFICE_PLAN |
| Privacy / deletion / export | ADR-05, §13 | SECURITY_AND_PRIVACY_PLAN |
| Test strategy | §17 | TEST_PLAN |
| CI/CD | §18 | TEST_PLAN, IMPLEMENTATION_PLAN |
| Credentials needed / development without them | §19, ADR-07 demo mode | INTEGRATION_PLAN (credential matrix, `.env.example`) |
| Platform limitations | §20 | KNOWN_PLATFORM_LIMITATIONS |
| Design ↔ requirement mapping | §2 | DESIGN_AUDIT, DELIVERY_CHECKLIST (traceability) |

---

## 23b. Reconciliation rulings (from the cross-document critique; binding for all documents and code)

| # | Topic | Ruling |
|---|---|---|
| R-01 | Embeddings | Voyage `voyage-4` (documents) / `voyage-4-lite` (queries), **1024-d** everywhere (`memory_chunks.embedding vector(1024)`, search RPC, API contracts, credential matrix `VOYAGE_API_KEY`, backoffice model-slot validation). OpenAI `text-embedding-3-small` (`dimensions:1024`) only as disaster-recovery re-embed path. |
| R-02 | AI data objects | `ai_result_cache (user_id, feature, content_hash, prompt_version_id)` unique; `ai_model_config.routing_profile` (`balanced`\|`lean`) + check constraint rejecting `claude-fable-*`; `plan_limits` has `ai_routing_profile` and Free visible quota **50 units/day** ("AI analiz limiti 50/gün"). |
| R-03 | Voice approvals | Tap-only. Spoken "onayla" never approves; voice shows the approval card and the hint "Onaylamak için karta dokun." `approval_actions.approved_via` enum = `approval_center \| inline_sheet \| voice_card \| capture_batch \| in_place` (all taps). |
| R-04 | Assistant tools | The assistant LLM gets **only read-only retrieval** (search_result blocks / read tools scoped to the user). No write-capable or `propose_action` tool. Write intents are detected by `AssistantIntentV1` (T0 grammar → T1) and the **server** builds the proposal through the same code path as `POST /approvals`, returning a pending approval card in the stream. |
| R-05 | Midday / evening | Deterministic T0 composition; optional single-sentence T1 polish behind flag `ai.feature.briefing_polish`; never T2. Midday skipped (`skip_reason='no_meaningful_delta'`) when delta = 0. |
| R-06 | Approval undo | No new status or transition. "Geri al" is a **client-side 5 s delay** before `POST /approvals/:id/approve` is sent (inline sheet / capture batch); if the app is closed during the delay the approval simply stays `pending` in the Approval Center. State machine exactly as §5. |
| R-07 | OAuth account binding | Callback never finalises alone: `oauth` redirects to the app with a one-time `completion_code`; the app calls **`POST /integrations/oauth/complete`** {completion_code, device_nonce} with its JWT; the server requires `oauth_states.user_id = auth.uid()` and the device nonce hash match, else rejects (prevents connecting a victim's mailbox to an attacker's account). `oauth_states` stores `device_nonce_hash`, `completion_code_hash`, `completed_at`. |
| R-08 | Backoffice sign-in | **Email one-time code** (6-digit, no magic link, no password) as first factor + **mandatory TOTP** (aal2) — as chosen by ARCHITECTURE_DECISIONS/SECURITY/IMPLEMENTATION; BACKOFFICE_PLAN aligns. Admin identities are dedicated (`app_metadata.da_kind='admin'`); an existing app-user email cannot become an admin; `api`/`public-api` reject admin JWTs. |
| R-09 | Support Access | Roles with `support.access` (support, super_admin). Enum `support_access_scope`: `pii` (unmask identifiers), `email_metadata` (subjects, senders, snippets), `insights` (insight titles, AI summaries, briefing text), `notifications`, `captures` (extracted data only, never files), `assistant_transcript`, `ai_feedback`. Durations 15 / 30 / 60 min (max 60). Never: tokens, secrets, passwords, provider fetch of original mail, attachments/files. Reason required; grant + every reveal logged in `audit_logs` and `support_access_grants`. |
| R-10 | Feature-flag / kill-switch keys | Exactly the spine keys: `ai.global.enabled`, `ai.provider.{anthropic,openai,voyage}.enabled`, `ai.feature.<name>`, `ai.model.large.enabled`, `ai.model.opus_escalation`, `ai.batch.enabled`, `ai.backfill.enabled`, `ai.budget.org_daily_usd`, `voice.stt_server`, `voice.tts_premium`, product flags `feature.{midday,evening,voice,meeting_prep,capture,android_ni,weekly_review,new_ai_model}`. |
| R-11 | SSRF fetcher | `https:` only (http rejected, no upgrade), rules as §12. |
| R-12 | Android channels | IDs aligned with categories: `briefings` (morning/midday/evening/weekly), `critical_email`, `meetings`, `deadlines`, `follow_up`, `life_intel`, `approvals`, `reminders`, `account`, `phone_digest` (Android NI only); Turkish names localised; **all `lockscreenVisibility = PRIVATE`** (including `account`). Channels created at first launch before the permission prompt. |
| R-13 | Quiet hours & VIP | Defaults `quiet_hours_enabled=true`, **22:30–07:30** (user tz). Quiet hours suppress everything except (a) user-created smart reminders at the time the user chose and (b) VIP `critical_email` when `notification_preferences.vip_bypass_quiet` is on (**default on**, PRIMARY 07 "VIP kişilerden gelenler · Sessiz saatlerde bile"; per-VIP override `vip_people.bypass_quiet_hours`), still deduped and capped at 3 per quiet window. Admin test pushes (`admin-api POST /notifications/test-push`) never bypass quiet hours and use generic content. |
| R-14 | Notification frequency copy | Remove "Günde ortalama 3 bildirim"; `notification_preferences.daily_cap` default **5** for non-critical categories; copy "Sadece önemli olduğunda haber veririz." |
| R-19 | Supabase Realtime | **Not used** (publication stays empty; pgTAP asserts it). Freshness via TanStack Query invalidation/polling (e.g. First Analysis progress polled every 1–2 s, approval status polled while `executing`) + push for background changes. Docs using Realtime switch to polling. |
| R-20 | Source-of-truth precedence per artefact | Master prompt → this plan (§3–§23b) → then: DATABASE_AND_RLS_PLAN for tables/columns/enums/functions/cron/Vault/buckets (except `ai_feature` vocabulary and prompt keys → AI_PIPELINE_PLAN); API_CONTRACTS for endpoint/RPC names and shapes and SSE event names; BACKOFFICE_PLAN §4.1 for admin permission strings (DB `admin_api` checks and API `admin-api` use them); ARCHITECTURE_DECISIONS for versions; INTEGRATION_PLAN §15 for env var names; SCREEN_AND_FLOW_MAP for screen IDs and analytics event names. |
| R-21 | Analytics catalogue | Event names defined in the screen maps (+ backend events listed in API_CONTRACTS) form the single catalogue, generated at execution into `packages/domain/analytics/events.ts`; SECURITY_AND_PRIVACY_PLAN defines the rules (snake_case, allowed prop types, banned fields/content) and includes the catalogue by reference instead of a divergent list. |
| R-22 | `plan_limits` shape | Key/value `plan_limits(plan, key, value jsonb, updated_by, updated_at)`; canonical keys incl. `max_mail_accounts`, `max_calendars`, `ai_daily_budget_units` (Free 50), `ai_soft_cap_usd_day`, `ai_hard_cap_usd_day`, `ai_hard_cap_usd_month`, `ai_routing_profile`, feature booleans per M§44. Values per §8 budgets. |
| R-23 | Meeting prep timing | Precompute at **T-60 only for external or VIP meetings**; otherwise generated on tap ("Hazırlan"); prep notification at T-30…T-15 per user preference. |
| R-24 | Dead actions | Every screen action must resolve to a route/RPC defined in API_CONTRACTS (or DB for PostgREST RPCs/views) or an explicit local/navigation action. Legitimate needs found by the coverage critic (e.g. Today aggregate RPC, flow feed view, explanation RPC, insight feedback apply/revert, person overview, plan timeline/density, history-deletion preview, manual contact upsert, briefing retry, meeting-prep audio, widget snapshot, reply attachments, web data-deletion endpoints) are **added** to API_CONTRACTS / DATABASE_AND_RLS_PLAN with full contracts; duplicates are re-pointed to the existing canonical name (`device-execution`, `captures/:id/discard`, `person_intelligence`). RLS/grants must allow every client write a screen performs. |
| R-25 | Announcements | Today shows active announcements as a dismissible banner card (PRIMARY card language) using `announcements` + `announcement_dismissals`; covered in SCREEN_MAP_1 and API_CONTRACTS (`GET /me/bootstrap` includes them). |
| R-18 | Canonical additions accepted | `plan_limits.ai_daily_budget_units` (Free 50); `POST /approvals/:id/device-execution` (result of EventKit / device-calendar writes executed on-device after approval); `routing_profile` enum `balanced\|lean` with `ai_model_config (profile, role, feature)` unique. |
| R-15 | Truthful storage copy | Canonical: "Mail içeriğinin tamamı saklanmaz; yalnızca özetler, kısa alıntılar ve analiz sonuçları saklama süren boyunca tutulur." First Analysis footer: "Son 72 saat analiz edildi. Mail içeriğinin tamamı saklanmaz." Android NI: "Bildirim içerikleri cihazında işlenir; yalnızca çıkarılan bilgiler (ör. kargo durumu, tutar, tarih) hesabına kaydedilir. Doğrulama kodları ve güvenlik uygulamaları her zaman hariç tutulur." |
| R-16 | History deletion | Requires explicit confirmation + consequences + re-auth (same re-auth contract as account deletion), queued job, audit. |
| R-17 | Quality-gate patterns | Ban `TODO|FIXME|XXX|TBD|placeholder|lorem ipsum|coming soon|not implemented|yakında|çok yakında|sonraki sürüm|ileride eklenecek` in product code/copy; **do not** ban "later"/"sonra"; "sınırsız|unlimited" flagged only in positive claims (allow-list file `quality-gate.allow` for negated fair-use text). |

---

## 24. Plan documents — drafts and materialisation (execution step 0)

The following documents were drafted in Plan Mode by read-only agents (each reading this plan as the binding spine plus the audits), then cross-checked by consistency / coverage / policy critics and corrected. Their text lives in the workflow run directories under `/root/.claude/projects/-home-user-DijitalAsistanim-Opus5-5-/46bfff87-a0f2-5945-9ff9-2be44e81df58/subagents/workflows/wf_*/` (drafts: agent label `doc:<NAME>`; reconciliation patch sets: label `fix:<NAME>`; audits: plain labels).

| Target file | Journal label(s) |
|---|---|
| `docs/IMPLEMENTATION_PLAN.md` | `IMPLEMENTATION_PLAN` |
| `docs/ARCHITECTURE_DECISIONS.md` | `ARCHITECTURE_DECISIONS` |
| `docs/DESIGN_AUDIT.md` | `DESIGN_AUDIT` |
| `docs/SCREEN_AND_FLOW_MAP.md` | `SCREEN_MAP_1`, `SCREEN_MAP_2`, `SCREEN_MAP_3`, `SCREEN_MAP_4`, `SCREEN_MAP_4B` (continuation of Part 4), `SCREEN_MAP_5` concatenated in that order |
| `docs/DATABASE_AND_RLS_PLAN.md` | `DATABASE_AND_RLS_PLAN` |
| `docs/INTEGRATION_PLAN.md` | `INTEGRATION_PLAN` |
| `docs/API_CONTRACTS.md` | `API_CONTRACTS` |
| `docs/AI_PIPELINE_PLAN.md` | `AI_PIPELINE_PLAN` |
| `docs/BACKOFFICE_PLAN.md` | `BACKOFFICE_PLAN` |
| `docs/SECURITY_AND_PRIVACY_PLAN.md` | `SECURITY_AND_PRIVACY_PLAN` |
| `docs/TEST_PLAN.md` | `TEST_PLAN` |
| `docs/DELIVERY_CHECKLIST.md` | `DELIVERY_CHECKLIST` |
| `docs/KNOWN_PLATFORM_LIMITATIONS.md` | `KNOWN_PLATFORM_LIMITATIONS` |
| `docs/plan-audits/*.md` (design & research audits, for reference) | `design-system`, `design-hub`, `design-onboarding-today`, `design-flow-mail`, `design-plan-assistant`, `design-account-states-marketing`, `design-secondary-code`, `secondary-docs`, `stack-versions`, `integrations`, `ai-research` |

**Step 0 procedure**: a one-off Python script reads every `journal.jsonl`, maps `started.key → (label, agentId)` for agents that have a `result` line, and **reconstructs each document from the agent transcript** `agent-<agentId>.jsonl` (long documents were emitted across several consecutive assistant messages and the journal keeps only the last one): concatenate, with no separator, all assistant `text` blocks after the agent's last `tool_use`, then drop anything before the first line starting with `# `. It then applies the reconciliation patch sets in two rounds — first `fix:<NAME>`, then `fix2:<NAME>` — each a plain-text patch set (`# PATCHSET <NAME>` followed by `@@@FIND@@@ … @@@REPLACE@@@ … @@@END@@@` blocks, optional `@@@APPEND@@@ … @@@END@@@`, and `@@@NOTES@@@` which is not applied); every FIND must match exactly once and edits apply in order (failures are reported, never skipped silently). Verified in Plan Mode by an in-memory dry run: round 1 = 2,209 edits across 16 documents, 0 failures; residual drift greps (1536-d, text-embedding primary, Realtime, propose_action, gmail.compose, "Günde ortalama 3", magic link/password admin login, device-result, TODO/V2) only hit negations, quality-gate patterns or tests asserting absence; all 70 spine tables present in DATABASE_AND_RLS_PLAN; every client RPC reference resolves. Round 2 (43 edits across API_CONTRACTS, BACKOFFICE_PLAN, SECURITY_AND_PRIVACY_PLAN, DELIVERY_CHECKLIST, SCREEN_MAP_3, SCREEN_MAP_4B; 0 failures) adds the ~30 admin-api endpoints BACKOFFICE_PLAN specifies (ADM-00…ADM-19 additions) and re-points the remaining references; the automated route cross-check then finds **0 unresolved internal route references** (218+ routes defined). Final corpus ≈ 4.0 MB across 13 documents. The script then writes the files above, then (1) re-applies this plan's canonical names if any drift remains (grep for non-canonical table/enum/route names listed in the reconciliation report), (2) commits `docs: add implementation plan documents` on `claude/magical-pascal-edvjgn`. If the journals are unavailable (container recycled), the documents are regenerated from this plan file section by section before any code is written. The design/research audits are also written to `docs/plan-audits/` for traceability.

---

## 25. Verification (how the finished product is proven end-to-end)

| Layer | In this container | In CI / EAS / owner environment |
|---|---|---|
| Static | `pnpm lint`, `pnpm typecheck` (TS 6.0), quality-gate greps (R-17) incl. canonical-name drift (DELIVERY_CHECKLIST QG-27), secret/bundle scan | same, on every PR |
| Unit | vitest (domain engines, TR parsers, DST, entitlement, referral, grounding, SSRF, RBAC, notification decisions), jest-expo + RNTL (UI kit, screen states, a11y props) | same |
| Database | tier C: local Postgres 16 + compat shim + pgvector/pgTAP via apt → `pg_prove` RLS/state-machine/idempotency/audit suites; migration reset-from-zero | tier A: `supabase start` → `db reset` → `test db` → `db lint` (Postgres 17) |
| Edge Functions | `deno check/lint/test` (Deno 2.1.4) with fixture AI provider, recorded provider fixtures, mocked webhooks | same + `functions serve` smoke under the full stack |
| Web / backoffice | `next build` ×2; Playwright (preinstalled Chromium) for web flows; backoffice E2E against a local stack if the Docker daemon can be started, else CI | Playwright suites (M§103, M§104) against `supabase start` |
| Mobile | `expo install --check`, `expo-doctor`, `expo export` (iOS+Android bundles), `expo prebuild` plugin validation, jest | EAS dev/preview/e2e builds; Maestro flows for M§102 + acceptance flows A–J on demo mode; RevenueCat Test Store |
| Real providers | not reachable/credentialed here (Graph, OpenAI, RevenueCat, EAS blocked) — demo adapters + fixtures | owner-supplied credentials in sandbox: Google/Microsoft OAuth + sync, send via approval, calendar write, push delivery, purchase/restore, deletion (M§153 release checklist) |
| Final gate | DELIVERY_CHECKLIST traceability matrix (720 requirement rows) all ✅ or explicitly marked "External credential required"; `docs/FINAL_IMPLEMENTATION_REPORT.md` with the feature matrix | — |

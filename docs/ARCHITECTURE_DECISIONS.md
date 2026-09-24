# Dijital Asistan — Architecture Decision Records

| Item | Value |
|---|---|
| Document | `docs/ARCHITECTURE_DECISIONS.md` |
| Status of every record | **Accepted** |
| Decision date | 2026-09-23. All package versions were checked on this date with `npm view` or by reading the published tarballs. |
| Canonical spine | Master Implementation Plan: §3 ADR-01…ADR-15, §4 app boundaries, §5 enums and tables, §5b `api` route catalogue, §21 execution order, §22 Definition of Done. Every name in this file is copied verbatim from the spine. |
| Functional authority | Master prompt, cited as `M§n` (154 sections) |
| Evidence base | Read-only audits: `stack-versions`, `integrations`, `ai-research`, `design-system` (2026-09-23) |
| Companion documents | `docs/DESIGN_AUDIT.md` · `docs/DATABASE_AND_RLS_PLAN.md` · `docs/INTEGRATION_PLAN.md` · `docs/AI_PIPELINE_PLAN.md` · `docs/API_CONTRACTS.md` · `docs/SECURITY_AND_PRIVACY_PLAN.md` · `docs/SCREEN_AND_FLOW_MAP.md` · `docs/BACKOFFICE_PLAN.md` · `docs/TEST_PLAN.md` · `docs/KNOWN_PLATFORM_LIMITATIONS.md` |

---

## 0. Conventions

**Record format.** Every record has these fields, in this order:
- ID · Title
- Status
- Parent (for records ADR-16 onward)
- Owner
- Context
- Decision
- Alternatives considered (each with the reason it was rejected)
- Consequences
- Verification (how we know the decision works)
- Related master sections

**ID ranges**
- **ADR-01…ADR-15** are the canonical decisions of the master plan §3, expanded here.
- **ADR-16…ADR-55** are granular decisions that refine a canonical parent. Each one names its parent. These IDs are new to the canonical registry and are listed in the final section.

**Precedence**
- Canonical spine names always beat any name that appears in an audit.
- The master prompt wins on functional questions. The PRIMARY design wins on visual questions.
- The reconciliation rulings R-01…R-25 (plan §23b) are binding. They override older text in any document, this one included.
- Per-artefact precedence (R-20), after the master prompt and the plan:
  - `DATABASE_AND_RLS_PLAN.md`: tables, columns, enums, functions, cron jobs, Vault secrets and buckets. The exception is the `ai_feature` vocabulary and the prompt keys, which `AI_PIPELINE_PLAN.md` owns.
  - `API_CONTRACTS.md`: endpoint and RPC names and shapes (including error codes) and SSE event names.
  - `BACKOFFICE_PLAN.md` §4.1: admin permission strings.
  - This document: package and tool versions.
  - `INTEGRATION_PLAN.md` §15: env var names.
  - `SCREEN_AND_FLOW_MAP.md`: screen IDs and analytics event names.
- Where an audit recommended something different from the spine, the spine wins and the record explains why:
  - pgmq → `jobs`
  - expo-widgets → `@bacons/apple-targets`
  - `halfvec` → `vector(1024)`
  - Opus for briefings → `claude-sonnet-5`

**Single scope.** Records decide *how* something is built, never *whether* it ships (M§139). A "revisit trigger" is an objective condition under which a tooling choice gets re-opened. It is not a deferral of product scope.

**Markers**
- **External credential required**: a secret or account that the owner provides at runtime. Code and adapters ship regardless. Adapters report `external_credential_required`, the UI shows "Harici kimlik bilgisi gerekli", and System Health is not green (M§90).
- **Manual external step**: a console, DNS, store or partner action the owner performs outside the repository.

**Superseding a record.** Create a new record with the next free ID. Set the old record's Status to "Superseded by ADR-n". A patch bump inside a pinned line needs no record. A change of major or minor line does.

---

## 1. Decision index

| ID | Title | Parent | Owner |
|---|---|---|---|
| ADR-01 | Monorepo: pnpm workspaces + Turborepo | — | Platform |
| ADR-02 | Version policy and verified pins | — | Platform |
| ADR-03 | Mobile styling and UI kit | — | Mobile |
| ADR-04 | Backend shape on Supabase | — | Architecture |
| ADR-05 | Data and privacy model | — | Privacy |
| ADR-06 | Authentication and session boundaries | — | Security |
| ADR-07 | Integrations: adapters, OAuth, sync | — | Integrations |
| ADR-08 | AI architecture | — | AI |
| ADR-09 | Approvals and write safety | — | Architecture |
| ADR-10 | Notifications | — | Platform |
| ADR-11 | Subscriptions | — | Business eng. |
| ADR-12 | Widgets, share, Android Notification Intelligence | — | Mobile |
| ADR-13 | Analytics and observability | — | Platform |
| ADR-14 | Internationalisation | — | Mobile/Web |
| ADR-15 | Testing and CI | — | Quality |
| ADR-16 | pnpm 11.27.1, not pnpm 12 | ADR-01 | Platform |
| ADR-17 | TypeScript ~6.0.3, not 7.0 | ADR-02 | Platform |
| ADR-18 | One React 19.2.3; Expo SDK 57 pins beat npm `latest` | ADR-02 | Mobile |
| ADR-19 | ESLint 9.39.5, not 10 | ADR-01 | Platform |
| ADR-20 | Prettier 3.9.9, not oxfmt or Biome | ADR-01 | Platform |
| ADR-21 | Vitest 4.1.11, not 5.0 | ADR-15 | Quality |
| ADR-22 | StyleSheet + tokens, not NativeWind, Unistyles or Tamagui | ADR-03 | Mobile |
| ADR-23 | Generated SVG icon components, not a variable icon font | ADR-03 | Mobile |
| ADR-24 | use-intl / next-intl ICU, not i18next | ADR-14 | Mobile/Web |
| ADR-25 | Reads through PostgREST + RLS, not everything through `api` | ADR-04 | Architecture |
| ADR-26 | Canonical Edge Function set on Hono | ADR-04 | Architecture |
| ADR-27 | First-party `jobs` table, not pgmq | ADR-04 | Platform |
| ADR-28 | pg_cron cadence and DST-safe scheduling | ADR-04 | Platform |
| ADR-29 | App-level AES-256-GCM for OAuth tokens, not Vault or pgsodium | ADR-05 | Security |
| ADR-30 | Admin boundary inside the same Supabase project | ADR-06 | Security |
| ADR-31 | No raw email bodies stored; original fetched on demand | ADR-05 | Privacy |
| ADR-32 | No `gmail.compose`; drafts live in our DB and send via `gmail.send` | ADR-07 | Integrations |
| ADR-33 | Progressive authorization | ADR-07 | Integrations |
| ADR-34 | Provider-level idempotency for approved writes | ADR-09 | Integrations |
| ADR-35 | Custom API domain for OAuth brand verification | ADR-07 | Platform |
| ADR-36 | Expo Push Service, not direct FCM/APNs | ADR-10 | Platform |
| ADR-37 | RevenueCat with custom paywall; grants in our DB | ADR-11 | Business eng. |
| ADR-38 | First-party analytics | ADR-13 | Platform |
| ADR-39 | Sentry for error monitoring | ADR-13 | Platform |
| ADR-40 | Widgets via `@bacons/apple-targets` + Jetpack Glance | ADR-12 | Mobile |
| ADR-41 | Share via `expo-share-intent` | ADR-12 | Mobile |
| ADR-42 | Android NI: on-device structured extraction only | ADR-12 | Privacy/Mobile |
| ADR-43 | AI tiering T0–T3; model IDs are configuration only | ADR-08 | AI |
| ADR-44 | Claude Fable 5.1 excluded from routing | ADR-08 | AI/Privacy |
| ADR-45 | Voyage 4 embeddings at 1024-d, plus a disaster-recovery path | ADR-08 | AI |
| ADR-46 | Routing profiles `balanced` / `lean` (pricing vs AI COGS) | ADR-08 | **Product owner** + AI |
| ADR-47 | Maestro, not Detox | ADR-15 | Quality |
| ADR-48 | Database test tiers A / C (+ D PGlite) | ADR-15 | Quality |
| ADR-49 | Demo-mode gating | ADR-07 | Architecture |
| ADR-50 | Node 24 LTS in CI/EAS/Vercel | ADR-02 | Platform |
| ADR-51 | Supabase publishable and secret keys | ADR-04 | Security |
| ADR-52 | Next 16 `proxy.ts` and server-action `Origin` enforcement | ADR-06 | Security |
| ADR-53 | Deployment topology: Vercel ×2, Supabase, EAS | ADR-01 | Platform |
| ADR-54 | Mobile secure local storage and offline cache | ADR-06 | Mobile/Security |
| ADR-55 | Voice stack: on-device STT, synth-to-file TTS | ADR-08 | Mobile/AI |

---

## 2. Canonical records (ADR-01 … ADR-15)

### ADR-01 · Monorepo: pnpm workspaces + Turborepo
**Status:** Accepted · **Owner:** Platform

**Context**
- M§6 prescribes `apps/{mobile,web,backoffice}` and `packages/{ui,design-tokens,domain,validation,api-client,i18n,config}`.
- M§7 forbids copying the domain model between mobile and web. Types, schemas, enums, validation, tokens and API contracts must be centralised.
- Edge Functions run on Deno 2.1 but must execute the same domain logic: the priority engine, notification decision engine, entitlement logic, grounding verifier and RBAC matrix.
- The repository is empty (plan §1).

**Decision**
- **Package manager.** pnpm **11.27.1** workspaces. The root `package.json` sets `"packageManager": "pnpm@11.27.1"` (ADR-16).
- **Task runner.** Turborepo **2.11.3** (fallback 2.11.2).
- **Layout.** Exactly the tree in plan §3 ADR-01: `apps/mobile` (with `app/`, `modules/`, `targets/`), `apps/web`, `apps/backoffice`, `packages/{design-tokens,ui,domain,validation,api-client,i18n,config}`, `supabase/{config.toml,migrations,seed,tests,functions}`, `design/`, `docs/`, `.github/workflows/`.
- **Dependency rules** (enforced by ESLint `no-restricted-imports` plus a CI import-graph check):

  | Package | May depend on | Must not use |
  |---|---|---|
  | `packages/domain` | zod, date-fns, @date-fns/tz | React, RN, DOM, Node built-ins. Relative imports carry explicit `.ts` extensions (`allowImportingTsExtensions`, `noEmit`) so Deno can import the source directly. |
  | `packages/validation` | zod, `packages/domain` | Same Deno-safe rule |
  | `packages/i18n` | none at runtime (ICU JSON plus typed augmentation) | React |
  | `packages/design-tokens` | none at runtime (build script emits `tokens.ts`, `tokens.css`, `tokens.json`) | — |
  | `packages/ui` | peers react 19.2.3, react-native 0.86.3, react-native-svg, reanimated | Web usage. It is **RN-only**, which avoids dual-React peer resolution. |
  | `packages/api-client` | @supabase/supabase-js; peer @tanstack/react-query | Secret keys |
  | `packages/config` | tsconfig bases, ESLint flat configs, Prettier config | — |
  | `apps/*` | `packages/*` | Each other |
  | `supabase/functions/*` | `packages/domain` and `packages/validation` through a per-function `deno.json` import map (relative path), deployed with `supabase functions deploy --use-api` | `packages/ui`, `packages/api-client` |

- **Catalogs**
  - The default catalog holds `react`, `react-dom`, `typescript`, `zod`, `@supabase/supabase-js` and `@tanstack/react-query`.
  - The named catalog `expo` is pinned exactly to `expo@57.0.24/bundledNativeModules.json`.
  - `overrides` force `react`, `react-dom` and `react-native` (ADR-18).
- **pnpm settings** (in `pnpm-workspace.yaml`; `.npmrc` holds only registry and auth)
  - `nodeLinker: isolated`, pnpm's default and supported by Expo since SDK 54. The documented fallback is `hoisted`.
  - `allowBuilds` whitelist: esbuild, unrs-resolver, deno and `@sentry/cli` allowed; core-js and msw denied.
  - `minimumReleaseAge: 1440` is kept.
- **Turbo tasks:** `lint`, `typecheck`, `test`, `build`, `db:test`, `functions:test`, `mobile:check`, `e2e:web`, `e2e:backoffice`.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Nx | Heavier plugin and executor model. Expo and EAS integration is less direct. Turbo is enough for a task graph plus caching. |
| Separate repositories per app | Violates M§7: shared enums and contracts would be duplicated or published as versioned packages, and drift is guaranteed. |
| npm or Yarn workspaces | No pnpm catalogs, no strict dependency-build approval (`allowBuilds`), and no `minimumReleaseAge` supply-chain delay. |
| Bun workspaces | Expo, EAS and Turbo lockfile handling are not verified for Bun in this stack. |
| A shared React UI package for web and mobile | Dual-React peer resolution under the isolated linker. PRIMARY design targets RN inline styles, while web uses Tailwind v4. |

**Consequences**
- One lockfile and one version of every shared library. The domain is written once and runs in RN, Next and Deno.
- Deno compatibility constrains `packages/domain` and `packages/validation`: pure ESM, no Node APIs, syntax Deno 2.1.4 understands.
- The `expo` catalog must never be edited by `expo install --fix`, because that command rewrites `catalog:` references (ADR-18).

**Verification**
- `pnpm install --frozen-lockfile` succeeds in CI.
- `deno check` of every function imports `packages/domain` from source.
- `pnpm why --depth=10 react react-native` reports exactly one version (CI step).
- An import-graph check (ESLint `no-restricted-imports` configured in `packages/config`) fails if a package imports an app, or if `packages/domain` imports React, RN or `node:*`.
- `turbo run build --dry=json` lists the task graph without cycles.

**Related master sections:** M§6, M§7, M§105, M§106, M§150

---

### ADR-02 · Version policy and verified pins
**Status:** Accepted · **Owner:** Platform

**Context**
- M§6 requires "birbirleriyle uyumlu, güncel ve production-safe sürümler" and forbids blindly pinning old versions.
- On 2026-09-23 npm `latest` is ahead of what Expo SDK 57 supports: RN 0.87.1, reanimated 4.7.0, RNGH 3.3.0 and safe-area 5.10.0 all break SDK 57 native builds.
- Several `latest` tools are either too young or break their ecosystems: pnpm 12 (Rust, 4 weeks old), TypeScript 7 (no programmatic API), ESLint 10 (plugins crash) and Vitest 5 (3 weeks old).

**Decision**
1. **Platform pins beat npm `latest`.** For mobile, `expo@57.0.24/bundledNativeModules.json` and the `expo-template-default@57.0.26` manifest are authoritative.
2. **Mature line over newest line.** Take the newest patch of a line that has been stable for at least ~4 weeks and is compatible with its peers, not the newest major.
3. **Release age.** Honour `minimumReleaseAge = 1440` min. If a chosen pin is less than 24 h old at install time, use the previous patch as fallback:
   - next 16.3.6 → 16.3.5
   - turbo 2.11.3 → 2.11.2
   - @supabase/supabase-js 2.117.1 → 2.117.0
   - @sentry/nextjs 10.75.2 → previous patch
   Alternatively, use `minimumReleaseAgeExclude` for exactly those names for one install.
4. **Exact or tilde pins.**
   - Expo modules use `~57.0.x` as Expo publishes them.
   - Core runtime libraries are exact: `react 19.2.3`, `react-native 0.86.3`, `zod 4.6.5`, `react-native-reanimated 4.5.1`.
5. **Deliberate deviations** are documented. `@sentry/react-native 8.27.0` is excluded from `expo install --check` via `expo.install.exclude`.
6. The **complete matrix** is §4 of this document. Granular rationales are in ADR-16…ADR-21 and ADR-50.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| npm `latest` everywhere | Breaks SDK 57 native builds (RN 0.87, reanimated 4.7 needs worklets 0.13, RNGH v3 API). TS 7 breaks typescript-eslint. ESLint 10 crashes `@next/eslint-plugin-next`. |
| Caret ranges without catalogs | Non-reproducible installs, and duplicate React is possible across workspaces. |
| Moving to SDK 58 now (preview: RN 0.88, React 19.3, RNGH 3.x) | Preview status. Mixing SDK 58 pins into SDK 57 is unsupported. |

**Consequences**
- The build is reproducible and every pin traces to a source (§4, "Reason" column).
- A version bump is a catalog edit plus CI, never an ad-hoc `expo install --fix`.
- Re-verification happens whenever Expo publishes a new SDK. The SDK 58 upgrade (RNGH v3 API migration) is its own dedicated change set with its own ADR.

**Verification**
- CI runs `pnpm --filter mobile exec expo install --check` (read-only) and `expo-doctor`.
- `pnpm install --frozen-lockfile`.
- `pnpm why` for react and react-native.
- The §4 matrix is diffed against `pnpm list -r --depth 0 --json` by a script in the quality gate.

**Related master sections:** M§6, M§150, M§134, M§153

---

### ADR-03 · Mobile styling and UI kit
**Status:** Accepted · **Owner:** Mobile

**Context**
- The PRIMARY canvases (`*.dc.html`) specify inline styles and tokens, with names quoted verbatim in plan §2. Examples: `brand/primary #5B5CE2`, `critical #E0553F`, radius 10/12/14/16/20/28/999, card elevation `0 1px 2px rgba(27,25,23,.04), 0 6px 20px rgba(27,25,23,.05)`.
- M§124 forbids redesign. M§38 requires system/light/dark with no hard-coded surfaces. M§92 requires accessibility. M§125 requires avoiding re-renders.

**Decision**
- **Styling.** Plain `StyleSheet.create` plus typed `useTheme()` and `makeStyles(theme => …)` hooks from `packages/design-tokens`, memoised per colour scheme. React Compiler is on (SDK 57 template default `experiments.reactCompiler: true`).
- **Token source.** `packages/design-tokens/src` is the single source. A build step emits:
  - `tokens.ts` (RN),
  - `tokens.css` (Tailwind v4 `@theme` variables for web and backoffice),
  - `tokens.json` (native widgets).
- **Primitives** in `packages/ui` are theme-aware and accessibility-complete:
  - `accessibilityLabel` and `accessibilityRole` on every interactive element;
  - hit slop to 44 pt (iOS) / 48 dp (Android);
  - Dynamic Type via `allowFontScaling` with per-style `maxFontSizeMultiplier`;
  - reduce-motion respected for all Reanimated transitions;
  - `accessibilityActions` mirroring every swipe action.
- **Typography**
  - Geist for UI and Lora for the editorial voice: briefing narrative, reading view, weekly summary and share card, commitment quotes, marketing.
  - `fontVariant: ['tabular-nums']` on times, durations, amounts and counters.
  - Turkish uppercase is produced in the i18n layer with `toLocaleUpperCase('tr-TR')`, never with `textTransform: 'uppercase'`.
- **Contrast.** A `packages/design-tokens` test computes WCAG ratios for every text/background pair. `ink/tertiary #9B978E` fails AA on `bg #F5F4F0` (2.65:1), so it is restricted to decoration and to ≥12 px kicker/meta. Informational text uses the darker `ink/tertiary-strong` token. The deviation is logged in `DESIGN_AUDIT.md`.
- **Dark mode.** Dark cards use a 6 % white hairline instead of a shadow, per PRIMARY dark tokens.

**Alternatives considered:** see ADR-22 (styling libraries) and ADR-23 (icons).

**Consequences**
- Zero native styling dependencies to re-verify on each RN or Reanimated upgrade.
- The PRIMARY inline specs translate 1:1.
- Theme switching needs no runtime style compiler.
- Style objects are more verbose than utility classes. This is accepted in exchange for a 1:1 mapping to the design.

**Verification**
- Jest-expo and RNTL tests render every primitive in light and dark and assert token-derived colours and a11y props.
- The contrast test fails CI on any informational pair below 4.5:1 (3:1 for large text and non-text).
- A grep gate bans hex literals outside `packages/design-tokens`.
- Maestro `setDarkMode` / `assertDarkMode` flows cover dark mode (ADR-47).

**Related master sections:** M§4, M§38, M§92, M§122, M§123, M§124, M§125

---

### ADR-04 · Backend shape on Supabase
**Status:** Accepted · **Owner:** Architecture

**Context**
- M§6 mandates Supabase: Postgres, Auth, Storage, Edge Functions, Cron, pgvector and RLS. An extra service is allowed only if Supabase cannot solve the need.
- The product needs:
  - low-latency reads of curated data;
  - side-effecting operations with secrets (OAuth, provider writes, AI, push, billing);
  - webhooks with strict latency (Graph must answer in <3 s);
  - background jobs that are idempotent, retryable, observable and dead-letterable (M§127).
- Edge Function limits: 256 MB memory; wall clock 150 s (Free) / 400 s (paid); **2 s CPU per request** (async I/O not counted); max 100 secrets of 48 KiB each, with names never starting `SUPABASE_`; outbound ports 25 and 587 blocked.

**Decision**
- **Reads:** PostgREST under forced RLS through `packages/api-client`, with explicit column lists. Aggregates use `security invoker` views and RPCs (ADR-25).
- **Side-effect-free owner writes:** PostgREST under RLS, with column-level `GRANT update(col…)`. Examples: preferences, `priority_rules`, `vip_people`, `learned_preferences`, `ai_feedback`, the `set_insight_status` RPC.
- **Everything with side effects, AI, providers or secrets:** Edge Functions (Deno 2.1.4, Hono 4.13.8, per-function `deno.json`, deploy `--use-api`). The canonical set is below; details are in ADR-26.

  | Function | Auth |
  |---|---|
  | `api` | user JWT (`verify_jwt=true`) |
  | `oauth` | none, state-validated |
  | `webhooks-google` | Pub/Sub OIDC JWT or channel-token HMAC |
  | `webhooks-microsoft` | hashed `clientState`, constant-time compare |
  | `webhooks-revenuecat` | Authorization secret, constant-time compare |
  | `worker` | secret key (`auth:'secret:automations'`) |
  | `admin-api` | admin JWT + `aal2` + active `admin_users` row + permission |
  | `public-api` | none, plus rate limit |
  | `health` | secret or admin |

- **Jobs:** the first-party `jobs` table with `claim_jobs(worker_id, types[], limit, lease_seconds)` using `FOR UPDATE SKIP LOCKED`, `job_attempts`, backoff with jitter and `dead_letter` (ADR-27). pg_cron runs `scheduler_tick()` every minute and pokes `worker` every 15 s through pg_net (ADR-28).
- **Secrets:**
  - Edge secrets only.
  - New `sb_publishable_…` / `sb_secret_…` keys from day one (ADR-51).
  - Vault holds only `da_project_url` and `da_cron_secret` (the value of the `automations` secret key), both read by pg_net.
  - Web and backoffice hold **no** Supabase secret key.
- **Schemas:**
  - `public`: RLS user data plus exposed RPCs.
  - `private`: security-definer helpers, `set search_path = ''`, `revoke execute from public`.
  - `admin_api`: functions that each call `private.require_admin(permission)`.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| A separate Node backend (Fly, Render, containers) | Duplicates infrastructure that Supabase provides (M§6 "gereksiz altyapı çoğaltma"). Adds another secret store and another deploy surface. |
| Next.js route handlers as the mobile BFF | Couples the mobile backend to the marketing deploy. Would put secret keys into Vercel. The backoffice boundary gets muddled. |
| pg_graphql for reads | A second query surface with its own authorization review. PostgREST plus typed `api-client` already covers the needs. |
| All reads through `api` | See ADR-25. |

**Consequences**
- CPU-heavy work (PDF text extraction, image handling) must fit the 2 s CPU budget or move to provider-native processing (the Claude PDF document block). This is measured in `AI_PIPELINE_PLAN.md`.
- Webhook functions stay tiny so cold start is well under Graph's 3 s.
- All long work flows through `jobs`, never `EdgeRuntime.waitUntil`, which does not extend the wall clock.

**Verification**
- Deno tests per function.
- pgTAP asserts that system tables (`jobs`, `oauth_credentials`, `oauth_states`, `webhook_events`, `billing_events`, `ai_requests`, `audit_logs`, `admin_*`, `support_*`, `system_health_checks`, `rate_limits`) have RLS enabled and no `anon`/`authenticated` policies.
- A generic test asserts that every `public` table has RLS **forced**.
- A bundle scan proves no `sb_secret_` / `service_role` string reaches the mobile, web or backoffice bundles.

**Related master sections:** M§6, M§7, M§79, M§96, M§127, M§146, M§151, M§152

---

### ADR-05 · Data and privacy model
**Status:** Accepted · **Owner:** Privacy

**Context**
- M§78: every user-data table is user-scoped, indexed, validated and timestamped (UTC), with the timezone stored separately.
- M§97: provenance on derived objects.
- M§41: retention.
- M§87: no unnecessary raw mail body persistence.
- M§66: audit.
- M§128 / M§129: export and deletion.
- The design copy says "biz kopya tutmayız" (primary 07 · 7.4). Snippets, summaries and evidence quotes are stored, so the shipped copy is the truthful R-15 line in the Decision below.

**Decision**
- **Common table shape**
  - `user_id uuid not null` FK → `auth.users` `on delete cascade`.
  - RLS enabled **and forced**.
  - `created_at` / `updated_at timestamptz` (UTC).
  - Indexes lead with `user_id`.
  - Child tables without `user_id` are forbidden, because retention and RLS depend on it.
  - The timezone lives in `user_preferences.timezone` (IANA, default `Europe/Istanbul`).
- **Provenance.** Every derived object (`insights`, `briefing_items`, `life_events`, `commitments`, `memory_chunks`, `approval_actions`, `reminders`, AI-created `tasks`) carries `source_type, source_id, source_provider, source_timestamp, confidence` plus `evidence jsonb`, which holds verified quotes of ≤300 chars. "Bu nereden çıktı?" opens the real source.
- **Mail bodies are not persisted** (ADR-31).
- **OAuth tokens** are AES-256-GCM ciphertext in `oauth_credentials`, with RLS enabled and no policies (ADR-29).
- **Retention**
  - `retention_policy` values `d30 | d90 | d365 | until_deleted`; default `d90`.
  - Content tables carry `expires_at`.
  - The `retention` job purges rows, embeddings and Storage objects.
  - Changing the policy batch-updates `expires_at`.
- **Audit.** `audit_logs` is append-only: no UPDATE/DELETE grants, a blocking trigger, and a hash chain (`prev_hash`, `row_hash`).
- **Export and deletion.** `data_export_requests` and `data_deletion_requests` (kinds `history | account`) are processed by the `export`, `history_deletion` and `account_deletion` jobs. The result status is honest; the product never claims "deleted" before the purge actually completes. History deletion and account deletion both require explicit confirmation, a consequences screen, re-authentication (one shared re-auth contract), a queued job and an audit entry (R-16).
- **Truthful copy (M§141).** Privacy copy states only what is true. There is **no** "uçtan uca şifreleme" claim. The PRIMARY on-device-processing lines that are false for a server-side pipeline are replaced; `DESIGN_AUDIT.md` tracks them. Example: "Mail içerikleri cihazında özetlenir, hiçbir şey gönderilmez." becomes "Mail içeriklerin şifreli bağlantıyla analiz edilir; yapay zekâ sağlayıcımız içerikleri model eğitiminde kullanmaz." The canonical storage line (R-15) is "Mail içeriğinin tamamı saklanmaz; yalnızca özetler, kısa alıntılar ve analiz sonuçları saklama süren boyunca tutulur." The First Analysis footer is "Son 72 saat analiz edildi. Mail içeriğinin tamamı saklanmaz."

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Store encrypted mail bodies until retention expiry | Contradicts the truthful storage copy (R-15: the full mail content is not kept). Raises breach impact. Needs a copy change and a privacy review (ADR-31). |
| Soft-delete everywhere | Deletion must be real (M§129). Soft delete is used only where an audit trail is legally needed; `audit_logs` subjects are hashed after completion. |
| Tables without `user_id` joined through a parent | RLS policies would need joins, retention would be harder, and there is a cross-tenant risk. |

**Consequences**
- Every query path is tenant-scoped by construction.
- Provenance makes hallucination control (ADR-08) enforceable at the storage layer.
- The "Orijinal Mail" view needs the provider to be reachable (ADR-31).

**Verification**
- pgTAP per table checks:
  - the owner can CRUD its own rows;
  - another user sees 0 rows and cannot insert with a foreign `user_id`;
  - `anon` is denied;
  - `hasnt_column('email_messages','body')`.
- Retention job tests prove that expired rows, embeddings and Storage objects are gone.
- An audit immutability test: UPDATE and DELETE raise, and the hash chain verifies.
- Export content test: no tokens or secrets in the zip.
- Deno tests prove that `POST /privacy/delete-history` and `POST /privacy/delete-account` both reject a request without fresh re-authentication (R-16).

**Related master sections:** M§40, M§41, M§66, M§77, M§78, M§79, M§87, M§97, M§128, M§129, M§141

---

### ADR-06 · Authentication and session boundaries
**Status:** Accepted · **Owner:** Security

**Context**
- M§88: Apple, Google, Microsoft and Email login via Supabase Auth. App login is separate from integrations. The backoffice is a separate security boundary.
- App Review 4.8 requires Sign in with Apple when third-party login is offered.
- App Review 5.1.1(v) says apps "should use the Sign in with Apple REST API to revoke user tokens" at deletion.

**Decision**
- **Sign in with Apple (iOS)**
  - Native id_token with a nonce: SHA-256 of a raw 32-byte nonce goes to Apple, and the raw nonce goes to `signInWithIdToken`.
  - `credential.authorizationCode` is sent to `POST /auth/apple/exchange` within its 5-minute validity. The server mints an ES256 client-secret JWT on the fly, calls `/auth/token`, and stores the Apple refresh token encrypted (ADR-29). It is used only for revocation at account deletion.
  - The full name is captured on first authorization via `updateUser`.
- **Google:** native `@react-native-google-signin/google-signin` (Credential Manager on Android) → `signInWithIdToken({provider:'google'})`, scopes `openid email profile` only.
- **Microsoft:** `signInWithOAuth({provider:'azure', options:{scopes:'email', redirectTo:'dijitalasistan://auth/callback', skipBrowserRedirect:true}})` → `WebBrowser.openAuthSessionAsync` → `exchangeCodeForSession` with PKCE. The `xms_edov` optional claim is configured.
- **Email OTP:** 6-digit code with custom SMTP. The built-in SMTP only delivers to team members.
- **Android** also offers "Apple ile devam et" via web OAuth (Services ID; client-secret rotation every 6 months, ADR-53).
- **Session storage.** Uses the LargeSecureStore pattern (ADR-54). On first run, stale keychain items are purged, because the iOS Keychain survives reinstall.
- **Logout** runs `signOut({scope:'local'})`, disables the push token, wipes the encrypted cache, and calls RevenueCat `logOut`. "Tüm cihazlardan çıkış" uses `global`.
- **Integrations are separate** (ADR-07). An Apple-login user can connect Gmail. Integration tokens never come from Supabase `provider_token`.
- **Backoffice:** same Supabase project, separate app, domain and cookie; `aal2` required. Details in ADR-30 and ADR-52.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| `expo-auth-session` for login | Native SDKs give better UX and Credential Manager on Android. Supabase `signInWithIdToken` covers Apple and Google natively. |
| Reusing Supabase `provider_token` for Gmail/Graph access | Mixes login and integration consent, violates least privilege (M§76), and loses control of refresh tokens. |
| Web-only Apple on iOS | Worse UX, and the web path adds 6-month secret rotation. |
| AsyncStorage for the session | M§87 forbids tokens in AsyncStorage. |

**Consequences**
- Four login methods on iOS, four on Android (Apple via web).
- A Manual external step recurs every 6 months for the Apple web-flow client secret (automated workflow, ADR-53).
- Apple private-relay users need our sending domain registered with Apple.

**Verification**
- Deno tests for `/auth/apple/exchange`: code expiry, retry, and encryption of the stored token.
- Jest tests for the logout wipe sequence.
- The Maestro auth flow runs against demo mode.
- pgTAP: `oauth_credentials` is invisible to `authenticated`.
- The account-deletion job test proves the SIWA revoke call is attempted (mocked in tests).
- **External credential required:** Apple Team ID, SIWA key (.p8) and key ID, Services ID; Google Web/iOS/Android client IDs; Entra app ID; SMTP credentials.

**Related master sections:** M§48, M§76, M§87, M§88, M§129

---

### ADR-07 · Integrations: adapters, OAuth, sync
**Status:** Accepted · **Owner:** Integrations

**Context**
- M§75: Gmail, Google Calendar and Google Tasks; Outlook, Microsoft Calendar and To Do; Apple Calendar and Reminders via EventKit; Android device calendar. Adapter interfaces keep provider logic out of the domain.
- M§76: least privilege, progressive write scopes, server-side refresh tokens, revoke.
- M§117: initial and incremental sync, pagination, rate limits, retry, refresh, reconnect, webhooks, reconciliation.

**Decision**
- **Adapters**
  - `packages/domain` defines `MailProvider`, `CalendarProvider` and `TaskProvider`.
  - Implementations: `google`, `microsoft` and `demo`. `demo` is gated as described in ADR-49.
  - `apple_device` and `android_device` run on the phone and upload minimal normalised snapshots through `POST /integrations/device-calendar/snapshot`.
- **OAuth flow** (account binding per R-07; the callback never finalises alone)
  1. `POST /integrations/:provider/start` (user JWT) creates an `oauth_states` row: 10 minutes, single use, PKCE verifier encrypted, `user_id = auth.uid()`, and the `device_nonce_hash` of a fresh nonce that the app generates and keeps in memory.
  2. The app opens `WebBrowser.openAuthSessionAsync`.
  3. The provider redirects to the `oauth` function on our custom API domain (ADR-35).
  4. The function validates the state, exchanges the code, parses the granted `scope` string and holds the encrypted token set on the `oauth_states` row. It creates no `connected_accounts` row. It generates a one-time `completion_code` and stores only `completion_code_hash`.
  5. It redirects to `dijitalasistan://integrations/callback?completion_code=…`, preferring the universal/app link `https://<web-domain>/oauth/done`.
  6. The app calls **`POST /integrations/oauth/complete`** `{completion_code, device_nonce}` with its own JWT. The server requires `oauth_states.user_id = auth.uid()` and a matching device-nonce hash; otherwise it rejects and nothing is connected. On success it upserts `connected_accounts` and `oauth_credentials` in one transaction, sets `completed_at` and enqueues `initial_sync`. This prevents connecting a victim's mailbox to an attacker's account.
- **Scope strategy.** Least privilege plus progressive authorization (ADR-33). `gmail.compose` is never requested (ADR-32).
- **Sync strategy**

  | Provider | Initial | Incremental | Push/watch | Recovery |
  |---|---|---|---|---|
  | Gmail | last 72 h for First Analysis → backfill to the retention window; `format=metadata` first, full body only for triage survivors, transient | `history.list` from the stored `historyId` | `watch` → Pub/Sub push with OIDC-verified JWT, renewed daily | 404 → bounded resync (7 days); reconciliation job |
  | Google Calendar | full `events.list` per calendar | `syncToken` | `events.watch` channels (TTL 7 d, renewed 24 h before expiry), token = HMAC(channel id) | 410 → wipe the calendar and resync |
  | Google Tasks | full list | `updatedMin` poll every 15 min plus on foreground | none (the API has no push) | full re-list |
  | Microsoft mail | per-folder `messages/delta` (inbox, sentitems) with `Prefer: IdType="ImmutableId"` | `deltaLink` | Graph subscriptions ≤7 days, renewed at <48 h, plus `lifecycleNotificationUrl` | `syncStateNotFound` / 410 → full delta |
  | Microsoft calendar | `calendarView/delta` over a rolling window | `deltaLink` | subscription on `/me/events` | window re-baselined daily at ~03:00 user-local time |
  | Microsoft To Do | lists + tasks | `tasks/delta` poll every 15 min | none (lifetime <3 d, latency up to 15 min) | full re-list |
  | Apple EventKit / Android CalendarContract | device read after the user taps "Bağla" (full access; iOS 17 has no read-only access) | snapshot upload on foreground, `EKEventStoreChanged` and background task | — | provenance shows last device sync, e.g. "Apple Takvim · son eşitleme 07:12" |

- **Quota and throttling**
  - Gmail: per-user token bucket of 4,000 of the 6,000 units/min (new-project limit; `messages.get` = 20 units).
  - Graph: ≤4 concurrent requests per mailbox and ~8,000 requests per 10 min; honour 429 `Retry-After`; JSON batches of ≤20.
  - Usage is recorded in `provider_quota_usage`.
- **Error mapping → `account_status`**

  | Condition | Status | UI |
  |---|---|---|
  | `invalid_grant` | `needs_reauth` | "Gmail bağlantısı yenilenmeli." / "Google oturumu süresi doldu. Yeniden bağlanana kadar yeni mailler analiz edilmez." / [Yeniden Bağlan] [Sonra] |
  | Scope missing after granular consent | `partial` | Feature card says why |
  | Entra consent codes (AADSTS65001 / admin-approval family) | `admin_consent_required` | Explains organisational consent |
  | Sync backlog | `syncing` | — |
  | Unrecoverable | `error` | — |

- **Disconnect**
  1. Stop watches and subscriptions (`users.stop`, `channels.stop`, `DELETE /subscriptions/{id}`).
  2. Revoke at the provider: Google `POST oauth2.googleapis.com/revoke`. Microsoft has no per-app revoke, so show the documented user link and record `local_only`.
  3. Delete ciphertext.
  4. Purge synced content per retention.
  5. Write an audit entry.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Client-side OAuth (tokens on device) | M§76 forbids giving refresh tokens to the client. Background sync and briefings need server access. |
| `gmail.metadata` instead of `gmail.readonly` | Also a *restricted* scope, so no CASA advantage. It also forbids `q` search, which retrieval needs. |
| Polling Gmail and Graph instead of push | Burns quota and adds latency to "critical email" notifications. |
| Application (tenant-wide) Graph permissions | Needs admin consent, over-privileged, and contradicts the "yalnızca sana verilen izinler" explainer. |
| Unified vendors (Nylas, Merge) | Adds a sub-processor holding mail data, cost per account, and loss of provider-level idempotency control. |

**Consequences**
- **Manual external step:** Gmail restricted scope requires annual CASA plus verification. Unverified apps are capped at 100 users.
- **Manual external step:** Microsoft publisher verification (Partner One ID) is strongly recommended.
- Device calendars are only as fresh as the last app run. This is documented in `KNOWN_PLATFORM_LIMITATIONS.md`.

**Verification**
- Deno tests with recorded provider fixtures: start/callback/complete (state reuse rejected, expired state rejected, `POST /integrations/oauth/complete` with another user's JWT or a wrong `device_nonce` rejected with nothing connected, partial scopes → `partial`), history 404 → resync, Calendar 410, Graph `validationToken` echo in text/plain within budget, lifecycle `reauthorizationRequired`, 429 honouring `Retry-After`.
- Idempotency uniques verified by pgTAP.
- **External credential required:** Google Cloud project (OAuth clients, Pub/Sub topic plus push service account with publisher role for `gmail-api-push@system.gserviceaccount.com`); Entra app plus certificate.

**Related master sections:** M§75, M§76, M§89, M§90, M§116, M§117

---

### ADR-08 · AI architecture
**Status:** Accepted · **Owner:** AI

**Context**
- M§80: the pipeline order.
- M§81: swappable Anthropic/OpenAI adapters with no hard-coded model.
- M§82: cost control.
- M§83: no source-less deadline, amount, event, person relation or commitment.
- M§114: prompt injection.
- M§57 / M§58: model config and prompt versioning from the backoffice.
- The product is a command centre, not a chatbot (M§2).

**Decision**
- **Pipeline per ingested item**
  1. ingestion
  2. normalisation
  3. deterministic filters and rules: priority rules, VIP, `List-Unsubscribe`/`Precedence`/`Auto-Submitted`, DKIM/SPF, sender reputation, content-hash dedupe
  4. small-model classification (micro-batched)
  5. large model only for survivors
  6. zod structured-output validation
  7. grounding verification
  8. persistence with provenance
  9. insight, briefing or notification
- **Abstraction** in `supabase/functions/_shared/ai/`:
  - interfaces: `LLMProvider.generateStructured(schema, prompt, opts)`, `embed()`, `transcribe()`, `synthesize()`;
  - adapters: `anthropic`, `openai`, `fixture` (deterministic, demo and tests only);
  - models per feature come from `ai_model_config`, prompts from `prompt_versions` (one `active` per key);
  - every attempt writes `ai_requests` (tokens incl. cache read/write, latency, `cost_usd_micros`, status, `correlation_id`) with **no content**.
- **Tiers:** T0 deterministic / T1 `claude-haiku-4-5-20251001` / T2 `claude-sonnet-5` / T3 `claude-opus-5-5` behind `ai.model.opus_escalation`. Fallback chains and model-specific request rules are in ADR-43. Fable excluded (ADR-44).
- **"Model locates, code computes"**
  - LLMs return verbatim quotes and local refs (`m1`, `e2`).
  - Code derives dates, amounts and IDs from verified spans with the Turkish extractors (`amount-tr`, `date-tr`, tracking, flight, PNR). chrono-node has no Turkish locale.
  - Recipients, attendees and destination accounts are never taken from model output.
- **Grounding verifier** in `packages/domain`:
  1. ref check
  2. `normTR` normalisation: NFKC, `toLocaleLowerCase('tr-TR')`, zero-width strip, quote and dash folding
  3. exact span match, with a guarded fuzzy fallback
  4. field re-derivation from the span only
  5. semantic sanity bounds
  6. outcome:
     - persist;
     - drop the field and show "Kaynakta kesinleşmiyor.";
     - convert to a `commitment_create` approval ("Emin değilim — onaylar mısın?");
     - or drop the item.
- **Prompt-injection containment**
  - Untrusted content goes in nonce-delimited `<untrusted>` blocks after the cache breakpoint.
  - The static system prompt declares that content untrusted.
  - Extraction calls have **no tools**.
  - The assistant LLM gets **only read-only retrieval**: `search_result` blocks and read tools scoped to the user. It has no write-capable or `propose_action` tool (R-04).
  - Write intents are detected by `AssistantIntentV1` (T0 grammar → T1). The **server** builds the proposal through the same code path as `POST /approvals` and returns a `pending` approval card in the stream (ADR-09).
  - Structured extraction outputs are data. A suggested action is limited to the six `approval_action_type` values and becomes a proposal only through server-side validation.
  - Output validators reject URLs not present in the source, cross-user references and canary leaks.
  - A heuristic pre-scan flags injection risk.
  - Learned preferences update only from user behaviour.
- **Cost control**
  - T0 pre-filter (55–70 % of inbound mail never reaches an LLM).
  - Per-user HMAC content-hash dedupe in `ai_result_cache (user_id, feature, content_hash, prompt_version_id)`.
  - Thread incrementality: prior summary ≤150 tokens.
  - Token hygiene: strip quotes, signatures, KVKK disclaimers and tracking; cap 1,200 tokens per email.
  - Explicit prompt-cache breakpoints.
  - Message Batches for non-urgent work.
  - Budgets from `plan_limits` (R-22 keys): Free shows "AI analiz limiti 50/gün" (`ai_daily_budget_units` = 50) with internal soft/hard caps of $0.02/$0.03 per day (`ai_soft_cap_usd_day`, `ai_hard_cap_usd_day`). Pro shows "Adil kullanım", never "Sınırsız", with soft $0.20/day and hard $0.60/day and $6/month (`ai_hard_cap_usd_month`).
  - Kill switches (R-10 keys): `ai.global.enabled`, `ai.provider.{anthropic,openai,voyage}.enabled`, `ai.feature.<ai_feature>`, `ai.model.large.enabled`, `ai.model.opus_escalation`, `ai.batch.enabled`, `ai.backfill.enabled`, and `ai.budget.org_daily_usd` (auto-trip).
  - Nightly reconciliation against the Anthropic cost report.
  - Routing profiles `balanced | lean` (ADR-46).
- **Retrieval:** `memory_chunks` holds derived facts and summaries only, with `embedding vector(1024)` (ADR-45). Hybrid search combines Postgres FTS (`turkish` config + `unaccent`) with pgvector, fused by RRF and always filtered by `user_id` and `expires_at`. Assistant answers cite chunk sources, or say they do not know.
- **Voice:** ADR-55.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| One large model for everything | Naive baseline ≈ $36/month for a heavy user versus ≈ $5.55 optimised (about 6.5× cheaper). Latency is also worse. |
| LLM returns resolved dates and amounts | Hallucination risk on Turkish relative dates ("gelecek Salı", "en geç Cuma"). M§83 requires source-backed values. |
| Agentic tool-using extraction | A hijacked model could invoke tools. Extraction must be schema-only (M§114). |
| OpenAI-compatible shim for Claude | Loses Anthropic structured outputs, caching semantics and citations. The official SDKs are required. |
| Storing prompts and outputs in logs for debugging | Violates M§126. `ai_requests` holds metadata only. |

**Consequences**
- AI features degrade gracefully: when AI is unavailable the briefing shows the last analysis, and T0 templates cover the essentials.
- Quality depends on Turkish golden sets that must exist before prompt activation: 300 triage emails, 200 date expressions, 100 amounts, ≥60 injection cases and ≥150 retrieval pairs, all synthetic (M§151).
- Anthropic inference is `us`/`global` only (workspace geo `us`), so cross-border processing must be disclosed in the privacy policy: "AI analizi ABD'deki alt işleyicilerimizde yapılır." Legal confirms the KVKK/GDPR basis.

**Verification**
- Vitest suites for `normTR`, the extractors, the grounding verifier and the budget logic.
- Deno tests for adapters against the `fixture` provider and for schema rejection paths.
- CI adversarial eval gating prompt activation: zero approvals created and `injection_suspected` recall ≥0.9.
- Golden-set evals run against the fixture provider in CI. Live provider evals run owner-side (**External credential required:** Anthropic, OpenAI and Voyage API keys).
- The nightly cost reconciliation alerts on >5 % drift.

**Related master sections:** M§24, M§25, M§26, M§56, M§57, M§58, M§80, M§81, M§82, M§83, M§114, M§126

---

### ADR-09 · Approvals and write safety
**Status:** Accepted · **Owner:** Architecture

**Context**
- M§33 defines the statuses, the action types, the six fields every approval item carries (what / why / source / exact change / destination / side effect), and the buttons Onayla / Düzenle / Reddet. Idempotency is mandatory.
- M§115 lists actions that must never run without approval and requires server-side execution with no second run.

**Decision**
- **Proposal.** Clients never insert `approval_actions`. Every side-effecting write is proposed through `api`:
  - `POST /approvals`
  - `POST /reply-drafts/:id/submit`
  - `POST /captures/:id/actions`
  - `POST /plan/proposals`
  - `POST /meetings/:eventId/post`
  - assistant write intents, which the server turns into proposals through the same code path as `POST /approvals` (R-04)
  The server validates with zod (`packages/validation`), checks ownership, entitlement and provider capability, computes the **exact** change, and returns a `pending` approval.
- **State machine**, enforced in the DB by `private.transition_approval`:
  - `pending → approved → executing → executed | failed`
  - `pending → rejected | expired`
  - `failed → executing` (retry, same idempotency key)
  - Every transition writes `approval_events`.
- **Edits.** `PATCH /approvals/:id` creates a new payload version and a new idempotency key while the approval is `pending`.
- **Execution.** The client calls `POST /approvals/:id/approve` with `{idempotency_key, payload_version, approved_via}` plus the HTTP `Idempotency-Key` header (API_CONTRACTS §2.11). The approval's own key is `approval:{id}:v{payload_version}`. The route enqueues a job `approval_execute` with the job key `approval_execute:{id}:v{payload_version}`. The job handler is the **only** server code path that calls provider write methods (`send`, `writeEvent`, `writeTask`), and it uses provider-level idempotency (ADR-34).
- **Device-calendar writes** (`apple_device`, `android_device`) cannot run on the server. After approval the app performs the write through EventKit or CalendarContract and reports the result with `POST /approvals/:id/device-execution` (R-18), which moves the approval to `executed` or `failed`.
- **Undo (R-06).** "Geri al" adds no status and no transition. It is a client-side 5 s delay before `POST /approvals/:id/approve` is sent (inline sheet, capture batch). If the app closes during the delay, the approval stays `pending` in the Approval Center.
- **Privilege separation.** AI modules (`_shared/ai/**`) cannot import the credential decryption module. This is enforced by lint.
- **Voice (R-03).** A spoken "onayla" never approves. In voice mode every write shows the approval card with the hint "Onaylamak için karta dokun.", and the user must tap it (`approved_via='voice_card'`). Every `approved_via` value is a tap: `approval_center`, `inline_sheet`, `voice_card`, `capture_batch` or `in_place`.
- **Expiry and audit.** The `scheduler_tick()` expiry scan moves stale `pending` approvals to `expired`. Executed writes are audited.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Client-side execution after local confirmation | The client would need write tokens (M§76), and the prototype's "local-only approvals" fake must not be copied. |
| Auto-execute when confidence is high | M§115 lists no exception. Trust depends on "no approval → no important action". |
| Approval state in app memory | Not durable, not auditable, not visible in the Approval Center across devices. |

**Consequences**
- Every write has an audit trail and survives retries and crashes.
- A slight latency is added: approve → job → provider → refresh. It is mitigated by an immediate worker poke (ADR-28).

**Verification**
- pgTAP runs a legal/illegal transition matrix against `private.transition_approval` and checks the `approval_actions (idempotency_key)` uniqueness.
- Deno tests:
  - a double approve yields a single provider call;
  - a crash after a provider success but before the DB update, followed by retry, is detected as already done via ADR-34;
  - an edit after approval is rejected;
  - a spoken "onayla" in voice mode leaves the approval `pending`, and only the tap records `approved_via='voice_card'` (R-03);
  - `POST /approvals/:id/device-execution` moves a device-calendar approval to `executed` exactly once.
- Maestro approval flow, including the 5 s "Geri al" delay (R-06).

**Related master sections:** M§18, M§33, M§114, M§115, M§116, M§150

---

### ADR-10 · Notifications
**Status:** Accepted · **Owner:** Platform

**Context**
- M§132: decision order relevance → urgency → preference → quiet hours → dedupe → frequency → lock-screen sensitivity; suppressions visible in the backoffice.
- M§86: detail modes `full`, `title_only` and `generic`, with sensitive detail hidden by default.
- M§35: notification settings.
- M§96: server vs local scheduling.

**Decision**
- **Transport.** Expo Push Service with the enhanced security token, sent from `worker` (ADR-36).
- **Decision engine** in `packages/domain/notifications` evaluates:
  1. relevance
  2. urgency
  3. category preference
  4. quiet hours (user timezone)
  5. `dedupe_key`
  6. rolling 24 h frequency cap, per category and global
  7. detail mode
  The result is send, schedule or suppress. The reason is recorded in `notifications` and aggregated for backoffice suppression metrics.
- **Quiet hours (R-13).** `quiet_hours_enabled` defaults to true, 22:30–07:30 in the user's timezone. Quiet hours suppress everything except:
  - user-created smart reminders, at the time the user chose;
  - VIP `critical_email` when `notification_preferences.vip_bypass_quiet` is on (default on, per PRIMARY 07 "VIP kişilerden gelenler · Sessiz saatlerde bile"; per-VIP override `vip_people.bypass_quiet_hours`). These are still deduped and capped at 3 per quiet window.
- **Admin test pushes** (`admin-api POST /notifications/test-push`) never bypass quiet hours and always use generic content (R-13).
- **Frequency (R-14).** `notification_preferences.daily_cap` defaults to **5** for non-critical categories. The settings copy is "Sadece önemli olduğunda haber veririz." No average-count promise is shown.
- **Detail modes** are rendered on the server. Default is `title_only`. Payload `data` contains only `{type, entity_id, deeplink}`; mail body text never enters a push.
- **Android channels (R-12)** are created at first launch, before the notification-permission prompt (Android 13 prompts only after a channel exists). IDs align with the categories: `briefings` (morning, midday, evening, weekly), `critical_email`, `meetings`, `deadlines`, `follow_up`, `life_intel`, `approvals`, `reminders`, `account`, and `phone_digest` (Android NI only). Names are localised, Turkish by default. **Every channel, including `account`, uses `lockscreenVisibility = PRIVATE`.**
- **iOS interruption levels**
  - `time-sensitive`: meeting ≤10 min, approval expiring, user smart reminders.
  - `active`: morning briefing, critical email.
  - `passive`: midday and evening digests.
- **Device-local notifications** are used only for user-created smart reminders. Everything else is server-decided.
- **Receipts** are polled by the `push_receipts` job about 15 minutes after send (ADR-36).

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Client-side decision engine | The server knows cross-device state, quiet hours and budgets. Local-only rules cannot dedupe across devices. |
| Full detail by default | M§86 requires sensitive details hidden by default. |
| Scheduling everything as device-local notifications | Briefing content is generated server-side when the app is not running. |

**Consequences**
- Consistent behaviour across devices. Suppression metrics are real.
- Requires channels and categories to be registered at first launch.

**Verification**
- Vitest decision-table tests: quiet hours across DST, the R-13 exceptions (smart reminders; VIP `critical_email` capped at 3 per quiet window; admin test pushes never bypass), dedupe, frequency caps including the non-critical `daily_cap` of 5, and detail rendering in tr/en.
- A channel-registry unit test asserts exactly the R-12 channel IDs and `PRIVATE` lock-screen visibility on every channel, including `account`.
- Deno tests for push batching and receipt handling, including `DeviceNotRegistered` disabling the token.
- Maestro checks for notification settings persistence.

**Related master sections:** M§35, M§86, M§96, M§111, M§132

---

### ADR-11 · Subscriptions
**Status:** Accepted · **Owner:** Business engineering

**Context**
- M§43: RevenueCat, entitlement `pro`, products `da_pro_monthly` / `da_pro_annual`; free trial only if the store product supports it; Restore; Manage; store status separated from referral and admin grants.
- M§44: Free vs Pro, enforced server-side.

**Decision**
- **Store state.** The `webhooks-revenuecat` function:
  1. compares `Authorization` in constant time;
  2. inserts into `billing_events` (unique `event_id`);
  3. enqueues `billing_sync`.
  The job **re-fetches** the customer via REST v2 and overwrites the `subscriptions` mirror. Events arrive at-least-once and unordered, so they are never applied incrementally.
- **Grants.** Referral, admin and support grants live in `entitlement_grants` (`grant_source`, unique `idempotency_key`). `effective_entitlement(user_id)` = active store subscription OR active grant, with stacked non-overlapping grant periods. It is used by the client (`GET /me/entitlements`) and by every server gate.
- **Paywall.** Custom paywall in PRIMARY style (ADR-37):
  - offerings from RevenueCat, localized `priceString`, annual savings computed;
  - trial copy only when the store offer exists;
  - Restore Purchases, Manage Subscription, Terms and Privacy links, close button.
- **Test Store** key in development and demo.

**Alternatives considered:** see ADR-37.

**Consequences**
- Entitlement is correct even with out-of-order webhooks. Referral anti-abuse and audit stay first-party.
- RevenueCat dashboards do not show referral grants, so revenue metrics stay clean.

**Verification**
- Deno tests covering: duplicate event ID, out-of-order `CANCELLATION` before `INITIAL_PURCHASE`, `TRANSFER` recompute for both sides, `SANDBOX` ignored in production.
- pgTAP tests for `effective_entitlement` covering stacking, expiry and revocation.
- Maestro paywall flow using the Test Store.
- **External credential required:** RevenueCat public SDK keys, v2 secret key and webhook secret.
- **Manual external step:** App Store Connect and Play agreements, plus products.

**Related master sections:** M§43, M§44, M§45, M§60, M§61

---

### ADR-12 · Widgets, share, Android Notification Intelligence
**Status:** Accepted · **Owner:** Mobile

**Context**
- M§37: iOS Small, Medium, Large and Lock Screen widgets; Android 2×2 and 4×2; privacy-safe data; real deep links.
- M§28: share extensions into the capture flow.
- M§36: opt-in Kotlin `NotificationListenerService` with selected or all apps, sensitive apps excluded, and no pretending on iOS.

**Decision**
- **Widgets.** iOS uses WidgetKit in SwiftUI via `@bacons/apple-targets` with App Group `group.com.dijitalasistan.app`. Android uses Jetpack Glance in the local module `da-widgets`. Both read a shared zod-validated `WidgetSnapshot` written by the app. Widgets are read-only and use deep links (ADR-40).
- **Share.** `expo-share-intent` 8.0.1 feeds the Universal Capture common domain flow: iOS text, URL, image and PDF; Android `ACTION_SEND` / `ACTION_SEND_MULTIPLE` (ADR-41).
- **Android NI.** Local Kotlin module `notification-intelligence`:
  - explicit opt-in;
  - selected-apps or all-apps mode;
  - locked default denylist (authenticators, password managers, e-Devlet, OTP detector);
  - **on-device structured-signal extraction only**; raw notification text is never uploaded (ADR-42).
  iOS hides the feature entirely.

**Alternatives considered:** ADR-40, ADR-41, ADR-42.

**Consequences**
- Native code in Swift and Kotlin lives in `apps/mobile/targets` and `apps/mobile/modules`.
- `expo prebuild --clean` must succeed with both apple-targets and share-intent editing the pbxproj.

**Verification**
- CI prebuild smoke test.
- Snapshot schema tests.
- Maestro deep links from widget URLs.
- Instrumented Android check of the NI grant.

**Related master sections:** M§28, M§36, M§37, M§91

---

### ADR-13 · Analytics and observability
**Status:** Accepted · **Owner:** Platform

**Context**
- M§42: privacy-safe analytics with no raw email body, conversation content, tokens, full event payloads or secrets.
- M§110: app versions, platform, crash correlation, sync error correlation.
- M§126: structured logs, minimised PII, correlation IDs, severity levels.

**Decision**
- **Product analytics.** First-party `analytics_events`: allow-listed event names with typed props (zod) and no content, batched through `POST /analytics/events`. It feeds backoffice metrics (ADR-38). An optional external adapter interface exists and is disabled by default.
- **Errors.** Sentry adapters for mobile, web, backoffice and functions, with PII scrubbing (ADR-39).
- **Logs.** Structured JSON (`level`: `debug|info|warn|error`, `correlation_id`, `user_hash`, `job_id`, `fn`, `event`). `correlation_id` is threaded User → Integration → Job → AI/Briefing → Notification.
- **AI telemetry.** `ai_requests` holds metadata only.

**Alternatives considered:** ADR-38, ADR-39.

**Consequences**
- Metrics are computed in SQL from our own data. There is no third-party analytics SDK in the app and no content leakage.

**Verification**
- A schema test rejects unknown event names and unknown props.
- A log-scrubber unit test covers emails, tokens and bodies.
- A correlation-ID propagation test runs across `api` → `jobs` → `worker`.

**Related master sections:** M§42, M§110, M§119, M§126

---

### ADR-14 · Internationalisation
**Status:** Accepted · **Owner:** Mobile/Web

**Context**
- M§39: Turkish default, English fully supported, i18n keys for every string, 24-hour clock, Europe/Istanbul awareness, timezone separate from profile.
- M§100 and M§133: no stub copy and no "soon" promises.

**Decision**
- ICU catalogs live in `packages/i18n`: `tr` default, `en` complete, typed keys. There is one API:
  - `use-intl` on mobile;
  - `next-intl` on web and backoffice (ADR-24).
- **Formatting**
  - 24-h clock.
  - `Intl.NumberFormat('tr-TR', {style:'currency', currency:'TRY'})`.
  - date-fns `tr` for relative time, because Hermes lacks `Intl.RelativeTimeFormat`.
- A pseudo-locale (+40 % length) for truncation QA.
- A quality-gate grep bans hard-coded user-facing strings and the R-17 pattern list (plan §23b): unfinished-work markers and "soon" or "next version" promises in both locales. Ordinary words for "later" ("sonra") are not banned. Unlimited-type words are flagged only in positive claims; negated fair-use text is allowed through the allow-list file `quality-gate.allow`.
- Turkish-aware case mapping is done in the i18n layer.

**Alternatives considered:** ADR-24.

**Consequences**
- Both locales ship complete. Turkish casing (İ/ı) is always correct.

**Verification**
- A catalog key-parity test between tr and en.
- An ICU syntax compile test.
- Pseudo-locale Playwright screenshots on web.
- The grep gate.

**Related master sections:** M§39, M§100, M§133

---

### ADR-15 · Testing and CI
**Status:** Accepted · **Owner:** Quality

**Context**
- M§101–M§105: unit, integration and E2E testing, and the CI pipeline.
- M§133 / M§134: quality gate and fix loop.
- M§153: release verification.
- The container cannot run Docker, native builds or remote deploys (§5).

**Decision**
- **Unit**
  - Vitest 4.1.11 (ADR-21) for `packages/*`, web and backoffice.
  - jest-expo ~57.0.5 with jest 29.7.0 and RNTL 14 for `apps/mobile` and `packages/ui`.
- **Database:** pgTAP in tiers A / C, plus D (ADR-48).
- **Edge:** `deno check`, `deno lint`, `deno test` with Deno 2.1.4.
- **E2E:** Playwright 1.63 for web and backoffice. Maestro 2.10 for mobile (ADR-47).
- **GitHub Actions pipeline**, in this order:
  1. `install`
  2. `lint`
  3. `typecheck`
  4. `unit`
  5. `db` (`supabase start` → `db reset` → `test db` → `db lint`)
  6. `functions`
  7. `integration`
  8. `build-web`
  9. `build-backoffice`
  10. `migrations` (squawk plus reset from zero)
  11. `e2e-web`
  12. `e2e-backoffice`
  13. `mobile-checks` (`expo install --check`, `expo-doctor`, `expo export`, prebuild smoke)
  14. `secret-scan` (repository plus built bundles)
  15. `quality-gate` (banned markers, no secret keys in client bundles, RLS-forced assertion, empty-handler lint)
- **EAS** profiles `development`, `preview`, `e2e` and `production`; EAS Workflows run Maestro on iOS. `deploy-supabase` runs on a protected branch with manual approval.

**Alternatives considered:** ADR-21, ADR-47, ADR-48.

**Consequences**
- Tier A in CI is the source of truth for the database. The container only guarantees tier C/D and must say so in the final report (§5).

**Verification**
- The pipeline itself: a release is gated on all jobs green (plan §22 release gate).

**Related master sections:** M§101, M§102, M§103, M§104, M§105, M§133, M§134, M§153

---

## 3. Granular records (ADR-16 … ADR-55)

### ADR-16 · pnpm 11.27.1, not pnpm 12
**Status:** Accepted · **Parent:** ADR-01 · **Owner:** Platform

**Context**
- pnpm 11 is maintained: 11.27.1 shipped on 2026-09-20.
- pnpm 12 is a Rust rewrite, stable only since 2026-08-26, with six minors in four weeks (12.6.0 shipped on 2026-09-22).
- Turbo lockfile parsing and EAS Build have not been verified against pnpm 12.
- pnpm 12 also removes `--resolution-only` and canonicalises lockfiles for cyclic graphs.

**Decision**
- Use `"packageManager": "pnpm@11.27.1"`, fetched by corepack from registry.npmjs.org. The container's global pnpm 10.33.0 is ignored.
- Use pnpm ≥11 semantics: `allowBuilds`, `strictDepBuilds: true`, `minimumReleaseAge: 1440`, `blockExoticSubdeps: true`. Settings live in `pnpm-workspace.yaml`.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| pnpm 12.6.x | Too young. Unverified with Turbo lockfile parsing and EAS. Minors are churning. |
| pnpm 10 (container global) | No `allowBuilds` / default strict builds; older supply-chain defaults. |

**Consequences**
- The config model is identical between 11 and 12, so switching later is a one-line change. A new ADR is required for it.
- Revisit trigger: all three of the following pass under 12.x — `turbo run build --dry=json`, an EAS build, and `pnpm install --frozen-lockfile`.

**Verification**
- CI prints `pnpm --version` and asserts it equals 11.27.1.
- `pnpm install --frozen-lockfile` passes.
- EAS build logs show pnpm 11.27.1.

**Related master sections:** M§6, M§105, M§150

---

### ADR-17 · TypeScript ~6.0.3, not 7.0
**Status:** Accepted · **Parent:** ADR-02 · **Owner:** Platform

**Context**
- The `typescript@7.0.2` tarball exposes only `version` plus `unstable/*` exports and a Go binary. There is **no `ts.createProgram` JavaScript API**; that arrives with 7.1.
- typescript-eslint 8.70.1 declares the peer `typescript >=4.8.4 <6.1.0`.
- The Expo SDK 57 template uses `~6.0.3`, and so does the SDK 58 preview.
- Deno 2.1.4 embeds its own TypeScript, so shared code must avoid syntax newer than Deno 2.1 understands.

**Decision**
- `typescript ~6.0.3` in the default catalog, with `strict: true` everywhere.
- Base configs:
  - mobile extends `expo/tsconfig.base` (`moduleResolution: bundler`, `module: preserve`);
  - Deno-safe packages add `allowImportingTsExtensions`.
- An optional CI-only fast check may alias `"@typescript/native": "npm:typescript@7.0.2"`, but it never replaces the gating `tsc`.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| TypeScript 7.0.2 as `typescript` | Breaks typescript-eslint (peer <6.1) and every tool that uses the programmatic API. |
| TypeScript 5.x | Older than the Expo template. Loses 6.0 deprecation hygiene that eases the 7.x path. |

**Consequences**
- Compilation is slower than TS 7's native compiler; this is acceptable.
- Revisit trigger: TypeScript 7.1 ships its programmatic API **and** typescript-eslint allows `>=7`.

**Verification**
- `turbo run typecheck` passes with `tsc` 6.0.x.
- `deno check` passes for the functions (Deno 2.1.4 compatibility).
- CI asserts `npx tsc -v` starts with `Version 6.0.`.

**Related master sections:** M§6, M§150

---

### ADR-18 · One React 19.2.3; Expo SDK 57 pins beat npm `latest`
**Status:** Accepted · **Parent:** ADR-02 · **Owner:** Mobile

**Context**
- RN 0.86.3's Fabric renderer hard-codes `reconcilerVersion: "19.2.3"`, and its peer is `react ^19.2.3`.
- Expo SDK 57 pins `react 19.2.3`, `react-native 0.86.3`, reanimated **4.5.1** with worklets 0.10.1, RNGH **~2.32.0**, screens ~4.26.0 and safe-area ~5.7.0.
- npm `latest` is ahead:
  - RN 0.87.1;
  - reanimated 4.7.0 (needs worklets 0.13);
  - RNGH 3.3.0 (new API, ships with SDK 58);
  - safe-area 5.10.0.
- Expo's monorepo guide: "Duplicate React versions in a single app will cause runtime errors."
- Next 16.3.6 peers `react ^19.0.0` and vendors its own React for App Router.
- CVE-2026-23864 and CVE-2026-23870 affect `react-server-dom-*` only.

**Decision**
- `react` and `react-dom` are **19.2.3 exactly** workspace-wide (default catalog plus `overrides`), including web and backoffice.
- `react-native 0.86.3` is forced via `overrides`.
- The named catalog `expo` mirrors `bundledNativeModules.json` exactly.
- `react-server-dom-webpack` is **not installed** on mobile (it is an optional peer of expo-router and jest-expo).
- Web and backoffice stay on the newest Next 16.3.x patch for their vendored RSC.
- `@types/react ~19.2.18` and `@types/react-dom ~19.2.7`. Never 19.3.x types, which belong to SDK 58.
- `npx expo install --fix` is never run in CI, because it rewrites `catalog:` references. Deviations go into `expo.install.exclude`.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| npm-latest native modules | Native build failures on SDK 57 (see the pin list above). |
| React 19.3 on web only | Two Reacts in one workspace. Shared peers would resolve inconsistently under the isolated linker. |
| SDK 58 preview now | Preview status. Requires the RNGH v3 API migration. |

**Consequences**
- Upgrades happen per Expo SDK as a single coherent change set.
- The Hermes V1 default can increase Android memory by roughly 25–30 % together with Reanimated. This is measured against the M§125 budget, with opt-out via `expo.useHermesV1: false` if it regresses.

**Verification**
- CI runs `pnpm --filter mobile exec expo install --check`.
- `expo-doctor`.
- `pnpm why --depth=10 react react-native` shows exactly one version of each.
- `expo export --platform ios,android` bundles without duplicate-module warnings.

**Related master sections:** M§6, M§125, M§150

---

### ADR-19 · ESLint 9.39.5, not 10
**Status:** Accepted · **Parent:** ADR-01 · **Owner:** Platform

**Context**
- eslint-config-next 16.3.6 depends on eslint-plugin-react ^7.37 (peer up to ^9.7), eslint-plugin-import ^2.32 and jsx-a11y ^6.10 (peers up to ^9). eslint-config-expo 57.0.2 uses the same react and import plugins.
- `@next/eslint-plugin-next` calls `context.getFilename()`, which ESLint 10 removed, so it crashes at runtime.
- ESLint 9 security maintenance ended on 2026-08-06.
- `next lint` no longer exists in Next 16.

**Decision**
- ESLint **9.39.5** (the `maintenance` tag) with flat configs in `packages/config`:
  - `@eslint/js 9.39.5`
  - `typescript-eslint 8.70.1`
  - `eslint-plugin-react-hooks 7.1.1` (React Compiler rules)
  - `globals 17.12.0`
  - `eslint-config-expo/flat ~57.0.2` for mobile
  - `eslint-config-next 16.3.6` for web and backoffice, run via the ESLint CLI
- Custom rules live in `packages/config`:
  - `no-restricted-imports` (package boundaries, AI → crypto ban);
  - a ban on `.select('*')` in `api-client`;
  - no empty event handlers.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| ESLint 10.11.0 | Crashes `@next/eslint-plugin-next`; plugin peers stop at ^9. |
| Custom ESLint 10 config (`@eslint-react/eslint-plugin` 5.20.5, `eslint-plugin-import-x` 4.17.1) | Drops the official Next and Expo presets; more maintenance for a dev-only tool. |
| Oxlint or Biome lint only | Lacks Expo and Next rule parity (hooks, a11y, Next-specific rules). |

**Consequences**
- ESLint is a dev-only tool, so exposure after its maintenance window is confined to CI.
- Revisit trigger: eslint-config-next and eslint-plugin-react publish ESLint 10 support.

**Verification**
- `turbo run lint` passes.
- A CI step asserts `eslint --version` equals v9.39.5.
- A self-test fixture proves the custom rules fire.

**Related master sections:** M§105, M§133

---

### ADR-20 · Prettier 3.9.9, not oxfmt or Biome
**Status:** Accepted · **Parent:** ADR-01 · **Owner:** Platform

**Context**
- A formatter is needed for TS, TSX, JSON, Markdown, SQL-adjacent files and Tailwind class ordering.
- oxfmt 0.70.0 is pre-1.0. The Figma prototype pinned `oxfmt ^0.2.0`, which must not be copied.
- Biome 2.5.14 lacks Expo and Next rule parity and has no Tailwind v4 class-sorting parity with `prettier-plugin-tailwindcss`.

**Decision**
- Prettier **3.9.9**, plus `prettier-plugin-tailwindcss 0.8.1` in web and backoffice. The shared config lives in `packages/config`.
- `prettier --check` runs in the `lint` job.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| oxfmt 0.70 | Pre-1.0 and formatting output not yet stable. |
| Biome 2.5 | Rule and plugin parity gaps. Would split lint and format responsibilities awkwardly with ESLint 9. |

**Consequences**
- Slower than Rust formatters, but the output is stable.

**Verification**
- `prettier --check .` runs in CI.
- An EditorConfig consistency check.

**Related master sections:** M§105

---

### ADR-21 · Vitest 4.1.11, not 5.0
**Status:** Accepted · **Parent:** ADR-15 · **Owner:** Quality

**Context**
- Vitest 5.0.x shipped on 2026-09-03, three weeks before this decision. 4.1.11 is the mature line.
- 4.1.11 peers: `vite ^6||^7||^8` and `@types/node ^20||^22||>=24`.
- React Native components cannot run under Vitest: RN Flow sources and `@react-native/jest-preset 0.86.3` mocks are Jest-only.

**Decision**
- Vitest **4.1.11** with `@vitest/coverage-v8 4.1.11` and vite 8.3.0 for `packages/domain`, `validation`, `i18n`, `api-client` and `design-tokens`, and for web and backoffice. Web and backoffice component tests use happy-dom 20.14.5.
- jest-expo ~57.0.5 with jest 29.7.0, RNTL 14.0.1 and test-renderer 1.3.0 for `apps/mobile` and `packages/ui`.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Vitest 5.0 | Too young for a release gate. |
| Jest everywhere | Slower for pure TS packages and duplicates the ESM/TS transform setup that Vitest provides natively. |
| Vitest for RN components | Incompatible with the RN jest preset and Flow sources. |
| jsdom 30.1.1 | Works, but happy-dom is faster. Only one is used, to avoid split behaviour. |

**Consequences**
- There are two runners, split cleanly at the RN boundary.
- Revisit trigger: Vitest 5.x has had ≥8 weeks of patch releases with peer compatibility unchanged.

**Verification**
- `turbo run test` runs both runners.
- Coverage thresholds per package are defined in `TEST_PLAN.md`.

**Related master sections:** M§101

---

### ADR-22 · StyleSheet + tokens, not NativeWind, Unistyles or Tamagui
**Status:** Accepted · **Parent:** ADR-03 · **Owner:** Mobile

**Context**
- As of 2026-09-23:
  - NativeWind `latest` is 4.2.7 (Tailwind v3 only); v5 is only `5.0.0-rc.0`.
  - Unistyles 3.3.0 is stable but adds a C++ Nitro module plus a Babel plugin.
  - Tamagui 2.7.7 has a compiler and its own design-system opinions.
- PRIMARY is specified as inline styles.

**Decision**
- Plain `StyleSheet` with `useTheme()` and `makeStyles`, as specified in ADR-03.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| NativeWind v5 RC | Release candidate, not production-safe. v4 only supports Tailwind v3, while the web uses v4 tokens. |
| Unistyles 3.3 | Viable, but a native C++ dependency and Babel plugin must be re-verified on every SDK and Reanimated upgrade. |
| Tamagui 2.7 | Heavy compiler, and its design-system conventions conflict with the no-redesign rule (M§124). |
| Restyle or styled-components | Theming abstractions that the 1:1 token mapping does not need. |

**Consequences**
- Nothing is installed, so there is nothing to break on upgrades. Web uses Tailwind v4 with the same tokens through `tokens.css`.

**Verification:** as ADR-03. In addition, `pnpm why nativewind unistyles tamagui` must return nothing, checked by the quality gate.

**Related master sections:** M§38, M§122, M§124

---

### ADR-23 · Generated SVG icon components, not a variable icon font
**Status:** Accepted · **Parent:** ADR-03 · **Owner:** Mobile

**Context**
- PRIMARY uses Material Symbols Rounded with `FILL 0` by default and `FILL 1` for active, selected and AI markers (126 `FILL 1` usages), wght 400/500, GRAD 0.
- React Native cannot drive variable-font axes (`fontVariationSettings`).
- `@expo-google-fonts/material-symbols-rounded` 0.4.60 ships only static FILL=0 weights.
- More than 150 distinct icon names are used; all were verified against the codepoints list.

**Decision**
- A codegen script in `packages/ui` reads `@material-symbols/svg-400@0.47.5` `rounded/{name}.svg` and `rounded/{name}-fill.svg` for **only the names in use**. It emits typed `react-native-svg` components and a union type `IconName`.
- API: `<Icon name="auto_awesome" filled size={20} color={theme.brand.primary} accessibilityLabel=… />`. Icon-only controls must provide a label (lint rule).
- Web renders the same SVGs as inline React components generated by the same script.
- Widgets get exported assets: an iOS asset catalog (PDF or SVG) and Android VectorDrawables.
- The generated output is committed, so Metro and Next need no codegen at build time. CI re-runs the codegen and fails on any diff.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Variable Material Symbols font on RN | FILL and wght axes cannot be driven. |
| Two static subset fonts (FILL0 and FILL1) | Glyph weight 500 for the active tab needs a third font. Icon fonts also have weaker a11y semantics and ligature pitfalls. |
| `@expo/vector-icons` MaterialIcons | Different glyph set (not Rounded Symbols), so it would redesign the icons. |

**Consequences**
- Bundle contains only the icons used. Fill states render exactly. A new icon means adding a name and re-running the codegen.

**Verification**
- The codegen diff check in CI.
- A unit test that every `IconName` has both variants.
- A lint rule requiring an accessibility label on icon-only pressables.

**Related master sections:** M§4, M§92, M§122, M§124

---

### ADR-24 · use-intl / next-intl ICU, not i18next
**Status:** Accepted · **Parent:** ADR-14 · **Owner:** Mobile/Web

**Context**
- Three apps must share one catalog with plural and select rules.
- next-intl 4.14.6 (peer `next ^16`) and use-intl 4.14.6 (peer `react ^19`, `intl-messageformat ^11.1.0`) expose the same `useTranslations` API.

**Decision**
- ICU JSON catalogs in `packages/i18n` (`tr`, `en`) with typed `AppConfig` augmentation, so a missing key is a type error.
- Mobile uses `use-intl`. Web and backoffice use `next-intl`.
- Relative time uses date-fns `tr` because of the Hermes gap.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| i18next 26.4.2 + react-i18next 17.0.15 + i18next-icu 2.4.4 | Works, but it is a second API next to next-intl. ICU support comes through a plugin, and the key-typing story differs. |
| Lingui | Needs a macro and extraction compile step on three bundlers, including Metro. |
| Custom message format | Reinvents ICU plural and select rules. Turkish plurals and English variants would drift. |

**Consequences**
- One message syntax and one hook API everywhere.
- `@formatjs/intl-relativetimeformat` is not needed on mobile.

**Verification**
- A typecheck fails on unknown keys.
- A catalog parity test.
- An ICU compile test.

**Related master sections:** M§39

---

### ADR-25 · Reads through PostgREST + RLS, not everything through `api`
**Status:** Accepted · **Parent:** ADR-04 · **Owner:** Architecture

**Context**
- M§151: the frontend receives only the data it needs, with no raw provider payloads.
- M§79: RLS on all user data.
- Routing every read through Edge Functions would add cold starts, the 2 s CPU limit and duplicated authorisation code.

**Decision**
- **Reads.** Mobile reads curated tables through `packages/api-client`: typed query functions, TanStack Query keys, and **explicit column lists**.
  - Aggregates (counts, Today composition) use `security invoker` views and RPCs.
  - Raw provider payloads are never stored in readable columns.
  - Job progress (First Analysis) is read via `GET /onboarding/first-analysis/:jobId`.
- **Owner-scoped writes without side effects.** These use PostgREST with column-level grants. Examples: the `set_insight_status` RPC, `ai_feedback` insert, `priority_rules` / `vip_people` / `learned_preferences` CRUD, preference updates.
  - Users cannot write plan, entitlement or state-machine columns.
- **Everything else** goes through `api`, following the catalogue in plan §5b.
- **Supabase Realtime is not used (R-19).** The `supabase_realtime` publication stays empty, and a pgTAP test asserts it. Freshness comes from TanStack Query invalidation on push receipt, foreground and mutation success, plus polling while a screen waits on server work: First Analysis progress every 1–2 s, and approval status while it is `executing`.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| All reads through `api` (BFF) | Cold starts and CPU limits on every screen load. Duplicates RLS logic in code. Loses PostgREST filtering and pagination. |
| Direct DB connections from clients | Impossible securely. |
| Realtime subscriptions for all lists | More battery and connections for little gain. Push plus focus refetch suffices. |

**Consequences**
- RLS is the security boundary for reads, so pgTAP coverage is mandatory for every table.
- Column-level grants must be maintained in migration `0014`.

**Verification**
- pgTAP isolation suites.
- An ESLint rule bans `.select('*')` and argument-less `.select()` in `api-client`.
- An api-client unit test snapshots the column lists.
- The quality gate asserts no client code references system tables (`oauth_credentials`, `jobs`, `webhook_events`, …).

**Related master sections:** M§79, M§146, M§151

---

### ADR-26 · Canonical Edge Function set on Hono
**Status:** Accepted · **Parent:** ADR-04 · **Owner:** Architecture

**Context**
- The function count and shape affect cold starts, blast radius and webhook latency. Graph requires a 2xx within 3 s; validation must answer within 10 s.
- Supabase recommends per-function `deno.json` and a `_shared` directory.
- CLI ≥2.13.3 supports imports from outside `supabase/` with `--use-api`.

**Decision**
- **Exactly nine functions:** `api`, `oauth`, `webhooks-google`, `webhooks-microsoft`, `webhooks-revenuecat`, `worker`, `admin-api`, `public-api`, `health`. Auth per function is as in ADR-04.
- **`verify_jwt` in `supabase/config.toml`:**
  - `api` and `admin-api` are `true`;
  - all others are `false`, and authenticate by signature, secret or state.
- **Router.** Hono **4.13.8** (`jsr:@hono/hono@4.13.8`), `new Hono().basePath('/<fn>')`, served by `Deno.serve(app.fetch)`.
- **Middleware order**
  1. correlation ID (accept or generate `x-correlation-id`)
  2. structured logger
  3. auth wrapper (`npm:@supabase/server@1.8.0` `withSupabase` modes: `user`, `secret:automations`, `none`)
  4. rate limit
  5. zod validation from `packages/validation`
  6. handler
  7. error mapper to the envelope defined in `API_CONTRACTS.md`
- **Assistant** messages stream via Hono `streamSSE`.
- **Webhook functions stay tiny.** They import only the verifier, `webhook_events` insert and job enqueue, then return (Graph `202`, Pub/Sub `204`, RevenueCat `200`).
- **`_shared/` modules:** `auth/`, `logger/`, `errors/`, `crypto/` (AES-GCM), `ratelimit/`, `ssrf/`, `jobs/`, `providers/`, `ai/`, `observability/`, `env/`.
- **Dependency pins:** Deno 2.1.4, matching the Supabase edge-runtime crate.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| One mega-function | Large cold start endangers Graph's 3 s; one bug takes down webhooks and API together. |
| One function per route | Hits the 100-function limit, many cold starts, config sprawl. |
| Oak, itty-router or raw `Deno.serve` routing | Weaker typed middleware and SSE helpers. Hono is JSR-published and Deno-native. |
| Separate `approval-execute` function | Execution already runs as the `approval_execute` job in `worker`, where the lint-enforced module boundary isolates it (ADR-09). |

**Consequences**
- The route catalogue changes in one place (`api`). Webhook latency stays bounded. Deploys go per function.

**Verification**
- Deno tests per function using `app.request()`.
- A cold-start budget test: the `webhooks-microsoft` bundle size is checked in CI against a threshold.
- The `config.toml` `verify_jwt` matrix is asserted by a script.

**Related master sections:** M§6, M§127, M§146

---

### ADR-27 · First-party `jobs` table, not pgmq
**Status:** Accepted · **Parent:** ADR-04 · **Owner:** Platform

**Context**
- M§127: jobs must be idempotent, retryable, timeout-controlled, observable, failure-persisted and dead-letterable.
- M§53: the backoffice Sync & Jobs screen needs listing, filtering, retry and a dead-letter view.
- pgmq has no built-in dead-letter queue. Its visibility-timeout model hides in-flight messages from SQL inspection, and it is unavailable on tier-C PG16 test clusters (not in apt).

**Decision**
- **Table `jobs`** (columns per DATABASE_AND_RLS_PLAN §4.7), a system table with RLS on and no user policies:
  - `type job_type`, `status job_status` (`queued | running | completed | retrying | failed | dead_letter`);
  - `payload jsonb` (ids only, never content), `idempotency_key` UNIQUE, `priority`, `run_after`, `attempts`, `max_attempts`;
  - `lease_owner`, `lease_expires_at`, `last_error_code`, `last_error_message` (sanitised, no content);
  - `correlation_id`, `parent_job_id`, `progress`, `result`, and the nullable `user_id` and `connected_account_id` (per-user views and purge).
- **`job_attempts`** holds history per attempt.
- **Claiming.** `public.claim_jobs(p_worker_id, p_types, p_limit, p_lease_seconds)`, executable only by `service_role`, selects `queued`/`retrying` rows whose `run_after <= now()`, using `FOR UPDATE SKIP LOCKED`, and sets `running` plus a lease. `private.reap_expired_leases` reclaims expired leases.
- **Backoff** (`public.fail_job`): jittered exponential, `least(3600, 30 × 2^(attempts−1)) × (0.8 + random() × 0.4)` seconds. A provider `Retry-After` overrides the computed delay. When `attempts ≥ max_attempts` the job goes to `dead_letter`. The backoffice retry resets `attempts` with an audit entry.
- **Worker drain.** Each `worker` invocation drains by type priority until a soft deadline of 120 s (well under the 400 s wall clock). CPU-heavy handlers yield between items.
- **Enqueue** goes through a single helper (`public.enqueue_job`) that always sets a deterministic key from the DATABASE_AND_RLS_PLAN §6.2 catalogue. Examples: `briefing:{user}:{kind}:{local_date}`, `approval_execute:{approval_id}:v{payload_version}`, `reconciliation:{account}:{utc_6h_bucket}`, `initial_sync:{account}:{connected_at_epoch}`, `credential_reencrypt:{utc_date}`. The approval row carries its own key `approval:{id}:v{payload_version}`, and notifications dedupe on `'{category}:{entity_type}:{entity_id}:{local_date}'` (DB §1.5).

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| pgmq (Supabase Queues) | No dead-letter queue. Messages are opaque to backoffice filtering. Not testable on tier C. |
| External queue (SQS, Upstash QStash) | Another vendor and secret. Loses transactional enqueue with domain writes. |
| pg_cron job per task | At most 8 concurrent cron jobs, each ≤10 min. No per-item retry or dead-letter state. |

**Consequences**
- Full observability in SQL. Enqueue is transactional with the business write. Portable to plain Postgres.
- The worker must be carefully written: lease renewal for long items, idempotent handlers.

**Verification**
- pgTAP tests:
  - concurrent `claim_jobs` never returns the same row twice (two sessions);
  - an expired lease is reclaimed;
  - `max_attempts` leads to `dead_letter`;
  - the `idempotency_key` unique holds.
- A Deno test for handler idempotency.
- Backoffice E2E "sync job retry" (M§103).

**Related master sections:** M§53, M§96, M§127

---

### ADR-28 · pg_cron cadence and DST-safe scheduling
**Status:** Accepted · **Parent:** ADR-04 · **Owner:** Platform

**Context**
- pg_cron schedules run in UTC, allow at most 8 concurrent jobs of ≤10 min each, and support sub-minute syntax.
- Briefings are due at user-local times across IANA zones (M§96, including DST).
- Europe/Istanbul is UTC+03:00 year-round, but users travel and can choose other zones.

**Decision**
- **Cron entries**: exactly 8, the Supabase concurrency limit. Names, schedules and commands follow DATABASE_AND_RLS_PLAN §9 (migration `0015`):

  | Name | Schedule | Action |
  |---|---|---|
  | `da_scheduler_tick` | `* * * * *` | `select private.scheduler_tick()` |
  | `da_worker_poke` | `15 seconds` | `select private.poke_worker('cron')`: `net.http_post` to `worker` with the URL and secret read from Vault (`da_project_url`, `da_cron_secret`); sent only when due jobs exist |
  | `da_push_receipts` | `*/5 * * * *` | enqueue `push_receipts` (key `push_receipts:{utc_5min_bucket}`) for tickets older than 15 min |
  | `da_health_check` | `*/5 * * * *` | enqueue `health_check` (key `health:{utc_5min_bucket}`) |
  | `da_reconciliation` | `7 */6 * * *` | `select private.enqueue_reconciliation()`: one `reconciliation` job per healthy account (key `reconciliation:{account}:{utc_6h_bucket}`); the 00:07 UTC run also enqueues the daily `credential_reencrypt` sweep (ADR-29) |
  | `da_retention` | `30 2 * * *` | enqueue `retention` (key `retention:{utc_date}`) |
  | `da_billing_reconcile` | `45 3 * * *` | `select private.enqueue_billing_reconcile()`: `billing_sync` for stale or expired subscription mirrors |
  | `da_cron_housekeeping` | `15 3 * * *` | delete `cron.job_run_details` older than 7 days and `net._http_response` older than 1 day |

  Metrics rollups (`private.rollup_metrics_daily`) run inside `scheduler_tick`, so there is no ninth cron entry.

- **`private.scheduler_tick(p_now timestamptz default now()) returns jsonb`** is idempotent and takes an advisory lock, so overlapping ticks are no-ops. The `p_now` parameter exists for tests. It enqueues all due work with deterministic keys:
  - briefings `morning | midday | evening | weekly` (weekly = Sunday 18:00 local);
  - meeting prep: precomputed at T-60 only for external or VIP meetings, otherwise generated on tap ("Hazırlan"); the prep notification goes out at T-30…T-15 per the user's preference (R-23);
  - post-meeting prompt at event end +1 min;
  - approval expiry;
  - watch and subscription renewals;
  - Tasks and To Do polls every 15 min;
  - Graph calendarView re-baseline at ~03:00 local;
  - reminder pushes, snooze wake-ups, and deadline and follow-up nudges;
  - the referral qualification sweep;
  - daily metrics rollups.
- **Local-time evaluation.** `local_now := p_now AT TIME ZONE user_preferences.timezone`. A briefing is due when `local_now::time >= configured_time` and no `briefings (user_id, kind, local_date)` row exists.
  - **Spring-forward gap:** a configured time inside the skipped hour becomes due at the first valid local instant after it.
  - **Fall-back overlap:** the repeated hour cannot double-fire, because of the unique `(user_id, kind, local_date)` key and the job `idempotency_key`.
  - **Generation lead.** Morning generation is enqueued at configured time −20 min, staggered by `hash(user_id) mod 10` minutes. Delivery is its own `notification` job at the configured time.
  - **Late delivery.** If delivery would be more than 90 min late (e.g. after an outage), the briefing is still generated and shown. Its push is `suppressed` with reason `late_delivery`.
  - **Midday and evening** are composed deterministically (T0), with an optional one-sentence T1 polish behind `ai.feature.briefing_polish` and never T2 (R-05). Midday is sent only if there is a meaningful delta since morning; otherwise the briefing is `skipped` with reason `no_meaningful_delta`.
- **Immediate pokes.** Latency-sensitive enqueues (approval execution, webhook ingest) call `private.poke_worker('<reason>')` in the same transaction; pg_net sends the request after commit.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Per-user cron entries | Thousands of entries. DST drift. Violates the 8-concurrent limit. |
| Storing next-run timestamps in UTC | Breaks at DST transitions unless recomputed. Local-date keys are simpler and idempotent. |
| Client-scheduled briefing triggers | The app may not run. Briefings must exist server-side. |

**Consequences**
- At most 1 minute scheduling granularity, plus ≤15 s worker latency.
- Correctness relies on unique keys, not on timing.

**Verification**
- Vitest DST fixtures (`@date-fns/tz`): Europe/Berlin 2026-03-29 and 2026-10-25, America/New_York 2026-03-08 and 2026-11-01, Europe/Istanbul constant offset.
- pgTAP calls `private.scheduler_tick(p_now)` at simulated instants around transitions. It asserts exactly one briefing job per `(user, kind, local_date)`, and that the gap case fires at the first valid instant.
- A pgTAP test asserts that exactly the eight `da_*` cron entries of DATABASE_AND_RLS_PLAN §9 exist.

**Related master sections:** M§9, M§10, M§11, M§12, M§96, M§127

---

### ADR-29 · App-level AES-256-GCM for OAuth tokens, not Vault or pgsodium
**Status:** Accepted · **Parent:** ADR-05 · **Owner:** Security

**Context**
- Refresh tokens are the most sensitive data we hold (M§76, M§152).
- With Supabase Vault, plaintext is readable through `vault.decrypted_secrets`, so any SQL-injection or secret-key leak exposes it. The Management API can return the root key. Vault is meant for a few project-level secrets.
- pgsodium is "pending deprecation", and Supabase does not recommend its TCE (transparent column encryption).

**Decision**
- **Table `oauth_credentials`**: RLS enabled, **no** policies, invisible to `anon` and `authenticated`. Columns (DATABASE_AND_RLS_PLAN §4.2) include `user_id`, `connected_account_id` (null only for `token_kind='apple_siwa_refresh'`), `provider`, `token_kind` (`refresh`, `access` or `apple_siwa_refresh`), `key_version`, a 96-bit random `iv`, `ciphertext` (GCM tag appended), `aad_hash`, `access_expires_at`, `scope_snapshot` and `rotated_at`.
- **Encryption.** WebCrypto AES-256-GCM in Edge Functions (`_shared/crypto`).
  - AAD is `v1|{connected_account_id}|{provider}|{token_kind}`. For the SIWA revocation token, which has no connected account, it is `v1|{user_id}|apple_device|apple_siwa_refresh`. `aad_hash` stores the SHA-256 of the AAD, so a row re-bound to another account is detected.
  - Keys: `TOKEN_ENC_KEY_V{n}` (base64, 32 bytes) plus `TOKEN_ENC_ACTIVE_VERSION`, stored in Edge secrets only.
  - Decryption happens only in Edge Functions, never in SQL.
- **Rotation.** On each refresh, decrypt with the stored version and re-encrypt with the active version. The daily `credential_reencrypt` job (enqueued by the 00:07 UTC `da_reconciliation` run, key `credential_reencrypt:{utc_date}`, batches of 500) re-encrypts the rest. An old key is retired once `count(key_version = old) = 0`.
- Vault holds only `da_project_url` and `da_cron_secret`.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Supabase Vault for tokens | Plaintext reachable from SQL, and the key is held by the platform. |
| pgsodium TCE | Pending deprecation; not recommended. |
| External KMS (AWS KMS, GCP KMS) | Another vendor and network hop per decrypt. Envelope encryption is equivalent at our scale; the design is revisited if compliance demands HSM custody. |
| Plaintext column with RLS only | Any secret-key or backup leak exposes every token. |

**Consequences**
- A DB dump alone reveals nothing. Rotation is operationally simple.
- Losing the key means losing tokens, which forces reauth. Key backup is a **Manual external step** (an offline escrow procedure in `SECURITY.md`).

**Verification**
- Deno tests:
  - encrypt/decrypt round trip;
  - an AAD mismatch fails (a ciphertext swapped between rows is rejected);
  - rotation with V1 → V2;
  - a missing key version gives a clear error.
- pgTAP: `authenticated` and `anon` see no rows.
- The log scrubber never prints token material.

**Related master sections:** M§76, M§87, M§113, M§152

---

### ADR-30 · Admin boundary inside the same Supabase project
**Status:** Accepted · **Parent:** ADR-06 · **Owner:** Security

**Context**
- M§88: the backoffice is a separate security boundary.
- M§48: secure session, server authorisation, rate limiting, expiry, logout-all, MFA, CSRF safety, audit.
- M§47: RBAC.
- M§71 / M§151: admin data is even more restricted.
- The admin must read user data. A second project would require a cross-project secret key somewhere.

**Decision**
- **Same project, separate app** (`apps/backoffice` at `admin.<domain>`) with cookie `__Host-da_admin` (httpOnly, Secure, SameSite=Strict).
- **Identities.** Admins are dedicated Supabase Auth users with an `admin_users` row (role `admin_role`, status).
  - First factor: 6-digit email one-time code (no magic link, no password). Second factor: **TOTP, mandatory**, giving `aal2` (R-08).
  - Admin identities are dedicated (`app_metadata.da_kind='admin'`). An existing app-user email can never become an admin, and `api` and `public-api` reject admin JWTs (R-08).
  - The custom access token hook adds the `admin_role` claim only for active admins.
- **`admin-api`** verifies the JWT, `aal = 'aal2'`, an active `admin_users` row, and the permission from the RBAC matrix in `packages/domain`.
  - It calls `admin_api` schema functions, each of which re-checks `private.require_admin(permission)`: two layers.
  - It returns masked PII (`yu***@gmail.com`). Reveal is permission-gated and audited.
  - Support Access (R-09) is limited to roles with `support.access` (`support`, `super_admin`). Scopes are the enum `support_access_scope`: `pii` (unmask identifiers), `email_metadata` (subjects, senders, snippets), `insights` (insight titles, AI summaries, briefing text), `notifications`, `captures` (extracted data only, never files), `assistant_transcript` and `ai_feedback`. Durations are 15, 30 or 60 min (max 60), and a reason is required. Tokens, secrets, passwords, provider fetches of the original mail, and attachments or files are never viewable. The grant and every reveal are logged in `audit_logs` and `support_access_grants`. There is no impersonation.
- **The backoffice holds no Supabase secret key.** Its Next route handlers and server actions forward the admin's access token from the cookie to `admin-api`.
- **Sessions.** Idle timeout 30 min and absolute limit 12 h, tracked in `admin_sessions`. "Logout all sessions" revokes via an admin function. Project-wide Supabase session settings are **not** used, because they would also log out mobile users.
- The last `super_admin` cannot be disabled or demoted (constraint trigger).

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Separate Supabase project for admin auth | Cross-project data access would need a secret key in a service. Two Auth configs. Double cost. No isolation gain for data that lives in the user project anyway. |
| Backoffice using the secret key server-side | A compromised Vercel env would bypass RLS entirely, and it contradicts plan §4. |
| Client-side admin SPA | Tokens exposed to XSS. M§48 requires server-side authorisation. |
| RBAC only in the UI | Cosmetic. M§47 requires server enforcement. |

**Consequences**
- The admin blast radius is limited by `aal2`, the RBAC matrix and audit.
- Mobile users can never obtain admin claims, because the hook only fires for active `admin_users` rows.

**Verification**
- pgTAP: `admin_api` functions reject `aal1`, non-admins and inactive admins; the RBAC matrix runs per role.
- Deno tests: `api` and `public-api` reject a JWT with `app_metadata.da_kind='admin'`; `admin-api` refuses to add an existing app-user email to `admin_users`; a Support Access grant longer than 60 min, or with a scope outside `support_access_scope`, is rejected.
- Playwright: login + MFA, idle-timeout expiry, logout-all, permission-denied paths.
- Bundle and env scan: no `sb_secret_` in the backoffice build output or Vercel env schema (`@t3-oss/env-nextjs` server schema has no such key).

**Related master sections:** M§46, M§47, M§48, M§49, M§68, M§71, M§88, M§151

---

### ADR-31 · No raw email bodies stored; original fetched on demand
**Status:** Accepted · **Parent:** ADR-05 · **Owner:** Privacy

**Context**
- M§87 forbids unnecessary raw mail persistence.
- The design lists never show raw bodies; the body appears only under "Orijinal Mail" in detail. The design's privacy copy says "biz kopya tutmayız"; the shipped copy is the truthful R-15 line below.
- M§77 still requires `email_threads` / `email_messages` tables.

**Decision**
- **Stored:** a header subset (from, to, cc, date, subject, Message-ID, In-Reply-To, References, list headers), a snippet of ≤200 chars, the AI summary and key points, verified evidence spans of ≤300 chars, and embeddings of derived chunks.
- **Not stored, not logged, not cached on device:** bodies and attachments.
- **"Orijinal Mail"** calls `GET /mail/:messageId/original`. The server fetches the body from the provider, sanitises it (script/style/iframe stripped, remote images and tracking pixels blocked by default), and returns it with `Cache-Control: no-store`. On the client the query is marked `meta.persist = false` (ADR-54).
- **AI processing** reads bodies transiently in `worker` memory for triage survivors only.
- **Grounded assistant answers** may fetch the top-k (≤6) source bodies live, verify, then discard them.
- **Copy (R-15):** "Mail içeriğinin tamamı saklanmaz; yalnızca özetler, kısa alıntılar ve analiz sonuçları saklama süren boyunca tutulur." The First Analysis footer is "Son 72 saat analiz edildi. Mail içeriğinin tamamı saklanmaz."

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Store encrypted, redacted bodies until retention | Contradicts the design promise and increases breach impact. Needs a privacy review and a copy change. |
| Store no mail metadata at all | Breaks Mail Intelligence lists, follow-up state and dedupe. |

**Consequences**
- Opening an original costs provider quota (`messages.get` = 20 Gmail units) and needs connectivity. Offline, the view shows the offline state with the cached summary.
- If a provider message is deleted, the original is unavailable while the derived data remains until retention expiry.

**Verification**
- pgTAP `hasnt_column` for body-like columns on `email_messages` / `email_threads`.
- A Deno test proves the response carries `no-store` and that the handler performs no DB write of body content.
- Log-scrubber tests.
- A mobile persister test proves the original query is excluded from dehydration.

**Related master sections:** M§15, M§40, M§87, M§151

---

### ADR-32 · No `gmail.compose`; drafts in our DB, send via `gmail.send`
**Status:** Accepted · **Parent:** ADR-07 · **Owner:** Integrations

**Context**
- Gmail `drafts.create` / `drafts.send` accept only `gmail.compose` or `gmail.modify`. Both are **restricted** scopes.
- `messages.send` accepts `gmail.send`, which is **sensitive**: brand verification, no additional restricted surface.
- On Graph, `createReply` needs `Mail.ReadWrite`, whereas `POST /me/messages/{id}/reply` needs only `Mail.Send`.

**Decision**
- AI reply drafts (four tones) live in `reply_drafts` and become `email_send` approvals via `POST /reply-drafts/:id/submit`.
- **Gmail send on execution:**
  1. Build RFC 2822 MIME with `In-Reply-To: <orig Message-ID>`, `References: <orig References> <orig Message-ID>`, `Subject: Re: <orig subject>`, and our `Message-ID` (ADR-34).
  2. base64url-encode it.
  3. Call `messages.send` with `threadId`.
- **Graph send:** `POST /me/messages/{immutableId}/reply` with `comment` only (never both `comment` and `message.body`), or `sendMail` for new mail.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| `gmail.compose` to create provider drafts | Adds another restricted scope and a bigger security assessment surface. Drafts in Gmail are not needed for approval-gated sending. |
| Graph `createReply` + `send` | Requires `Mail.ReadWrite`, which is over-privileged. |

**Consequences**
- Drafts are not visible in the user's Gmail or Outlook Drafts folder. Editing happens in-app. This is consistent with the Approval Center.

**Verification**
- Deno MIME builder tests: headers, Turkish subject encoding (RFC 2047), threading.
- A scope-set test asserts `gmail.compose`, `gmail.modify` and `Mail.ReadWrite` never appear in any requested scope string.

**Related master sections:** M§16, M§76, M§115

---

### ADR-33 · Progressive authorization
**Status:** Accepted · **Parent:** ADR-07 · **Owner:** Integrations

**Context**
- M§76: request only read scopes at the start, and request write scopes when an action needs them.
- Google granular consent lets users untick individual scopes.
- Microsoft uses dynamic consent: a new authorize request extends the grant.

**Decision**
- **Scope sets**

  | Provider | Initial | Progressive (on first approved write) |
  |---|---|---|
  | Google | `gmail.readonly`; `calendar.events.readonly calendar.calendarlist.readonly calendar.settings.readonly`; `tasks.readonly` (plus `openid email`) | `gmail.send`; `calendar.events.owned` (fallback `calendar.events`); `tasks` |
  | Microsoft | `openid profile email offline_access User.Read Mail.Read`; `Calendars.Read`; `Tasks.Read` | `Mail.Send`; `Calendars.ReadWrite`; `Tasks.ReadWrite` |
  | Android | `READ_CALENDAR` | `WRITE_CALENDAR` |

- **Upgrade flow**
  1. If `POST /approvals/:id/approve` finds a capability missing, it returns HTTP 424 `PROVIDER_SCOPE_MISSING` with `details.upgrade` (a `ScopeUpgrade`, API_CONTRACTS). The approval stays `pending`.
  2. The app calls `POST /integrations/:accountId/upgrade`, which returns an auth URL with `include_granted_scopes=true` (Google), then opens it.
  3. On return, the app completes the binding with `POST /integrations/oauth/complete` (R-07), then re-issues the approve call with the **same** idempotency key.
- The granted-scope string is parsed after every exchange. Capabilities are stored per account. Missing scopes give `partial`.
- **Every** scope, including progressive ones, is listed on the Google consent screen and in the verification submission up front (**Manual external step**).

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Request all read and write scopes at connect | Violates least privilege. Scary consent lowers conversion. Enlarges breach impact. |
| Separate OAuth client per capability | Separate consent screens and verification per client. Confusing for users. |

**Consequences**
- The first write adds one consent step. Users who never write never grant write scopes.

**Verification**
- Deno tests:
  - approve without scope gives 424 `PROVIDER_SCOPE_MISSING`, and the approval stays `pending`;
  - approve after upgrade executes once;
  - a partial grant parses to `partial`.
- Maestro reply-approval flow in demo mode (the demo adapter simulates the scope upgrade).

**Related master sections:** M§33, M§76, M§115

---

### ADR-34 · Provider-level idempotency for approved writes
**Status:** Accepted · **Parent:** ADR-09 · **Owner:** Integrations

**Context**
- DB idempotency alone cannot prevent duplicate provider writes. A crash can happen after the provider accepts the write but before we record it (M§115, M§116).

**Decision**

| Provider write | Idempotency mechanism | Retry check |
|---|---|---|
| Gmail send | `Message-ID: <approval-{id}@mail.dijitalasistan.app>` | `messages.list q=rfc822msgid:<…>` before any retry |
| Google Calendar insert | deterministic event `id` = base32hex(approval id) | duplicate insert returns 409, which means already done |
| Graph event create | `transactionId` = approval id | Graph dedupes |
| Graph mail send/reply | `singleValueExtendedProperty` tag = approval id | search Sent Items for the tag before retry |
| Google Tasks / To Do | store the returned provider id; notes / `linkedResources` marker | search by marker before retry |
| Reconciliation | created events carry `extendedProperties.private.da_approval_id` / a Graph extended property | the reconciliation job links provider objects to approvals |

- Retries use the same approval idempotency key (`failed → executing`).

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| DB-only idempotency | Duplicate sends after a partial failure. |
| Never retry provider writes | Transient 5xx and 429 errors would fail user-approved actions. |

**Consequences**
- Each adapter implements a "find-by-marker" method. There is a small extra read cost before retries.

**Verification**
- Deno fault-injection tests: provider success followed by a crash before the DB update. The retry detects the existing object and marks the approval `executed` without a second write, for every row of the table above.

**Related master sections:** M§33, M§115, M§116

---

### ADR-35 · Custom API domain for OAuth brand verification
**Status:** Accepted · **Parent:** ADR-07 · **Owner:** Platform

**Context**
- Google brand verification requires every authorized domain, including redirect-URI domains, to be verified in Search Console. We cannot verify `<ref>.supabase.co`, and Google shows that domain on the consent screen until verification passes.
- Supabase custom domains are a paid add-on: CNAME subdomain only, one per project.

**Decision**
- Production Supabase uses the custom domain `api.dijitalasistan.app`.
- Redirect URIs:
  - `https://api.dijitalasistan.app/functions/v1/oauth/google/callback`
  - `.../oauth/microsoft/callback`
- Webhook endpoints for Pub/Sub, Graph and RevenueCat use the same host. Supabase Auth callbacks (Azure login, Apple web OAuth) are also served from it.
- Final redirects prefer the universal/app link `https://dijitalasistan.app/oauth/done`, with `dijitalasistan://integrations/callback` as fallback.
- Staging uses its `<ref>.supabase.co` domain with separate OAuth clients in Testing status. Testing status means ≤100 test users and 7-day refresh tokens, which is acceptable for staging.
- **Manual external step:** Supabase Pro plus the custom-domain add-on, a DNS CNAME, Search Console verification of `dijitalasistan.app` and its subdomains, and consent-screen setup.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Default `supabase.co` redirect in production | Brand verification cannot pass, and consent screens show an unverified third-party domain. |
| A proxy on Vercel forwarding to Supabase | Another hop in the token path; secrets could leak into Vercel logs. |

**Consequences**
- The domain is a hard production dependency. `health` probes it.

**Verification**
- A `health` check resolves the domain and TLS.
- An OAuth callback smoke test in staging.
- `.env.example` documents `API_PUBLIC_BASE_URL`.

**Related master sections:** M§75, M§76, M§109

---

### ADR-36 · Expo Push Service, not direct FCM/APNs
**Status:** Accepted · **Parent:** ADR-10 · **Owner:** Platform

**Context**
- Expo Push:
  - one API for iOS and Android;
  - ≤100 messages per request;
  - 600 notifications/s per project;
  - tickets, then receipts about 15 min later (purged after 24 h);
  - 4,096-byte payload;
  - "enhanced push security" requires `Authorization: Bearer <EAS access token>`.
- Direct APNs is only needed for WidgetKit push, which is not required.

**Decision**
- `worker` `notification` jobs send via `POST https://exp.host/--/api/v2/push/send`, in batches of 100, self-limited to ≤500/s, with the enhanced security token (`EXPO_ACCESS_TOKEN`).
- Tickets go to `push_tickets`. The `push_receipts` job polls getReceipts (≤1,000 IDs per call). `DeviceNotRegistered` disables the `push_tokens` row.
- Retry 429 and 5xx with backoff.
- Message fields: `priority`, `interruptionLevel`, `channelId`, `categoryId`, `threadId`, `collapseId`, `ttl`.
- iOS categories set neutral hidden-preview text ("Dijital Asistan güncellemesi").

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Direct FCM v1 + APNs | Two credential flows, two payload formats, token management per platform. Expo handles both, with credentials in EAS. |
| OneSignal or other push vendors | Another sub-processor seeing notification text. The decision engine must stay ours. |

**Consequences**
- A dependency on the Expo service. Receipts processing is mandatory.
- **External credential required:** EAS access token, APNs key and FCM v1 service account (uploaded to EAS).

**Verification**
- Deno tests: batch splitting, 429 backoff, receipt mapping, token disable.
- Payload-size test below 4,096 bytes.
- A privacy test proves `data` contains only `{type, entity_id, deeplink}`.

**Related master sections:** M§35, M§86, M§96

---

### ADR-37 · RevenueCat with custom paywall; grants in our own DB
**Status:** Accepted · **Parent:** ADR-11 · **Owner:** Business engineering

**Context**
- M§43 separates store status from referral and admin grants.
- The paywalls in `react-native-purchases-ui` would impose RevenueCat's templates (M§124 no-redesign).
- RevenueCat webhooks are at-least-once and unordered; RevenueCat recommends re-fetching the customer. REST v2 needs a v2 secret key and allows about 60 requests/min.

**Decision**
- **SDK.** `react-native-purchases` **10.10.1** only (no `-ui`).
  - `Purchases.configure({ apiKey, appUserID: session.user.id })` is called after the session exists.
  - `logIn` on account switch, `logOut` on logout.
  - Test Store key in development and demo.
- **Paywall.** A custom screen in PRIMARY style built from `getOfferings()` and `purchasePackage()`, with `restorePurchases()` and `showManageSubscriptions()`.
  - Trial copy only when `introPrice` (iOS) or a free-trial phase (Android) exists.
  - After purchase, the app calls `POST /purchases/sync`.
- **Grants.** Kept in `entitlement_grants`. RevenueCat promotional grants are not used, so there are no `PROMOTIONAL` entries in revenue metrics.
- **Account deletion** deletes the RevenueCat customer and tells the user that the store subscription continues until they cancel it (App Review requirement).

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| `react-native-purchases-ui` paywalls | Dashboard-driven templates that break the PRIMARY design. |
| RevenueCat promotional grants for referrals | Pollutes revenue metrics. Anti-abuse and audit move outside our DB. |
| Store APIs directly (StoreKit 2 / Play Billing) | Receipt validation, server notifications and cross-platform entitlements would be rebuilt by hand. |

**Consequences**
- Paywall UI is fully ours, including localisation and a11y.
- Referral credit logic is testable in SQL.

**Verification**
- A Maestro Test Store purchase and restore flow.
- Deno webhook tests (see ADR-11).
- pgTAP tests for grant stacking.

**Related master sections:** M§43, M§44, M§45, M§60, M§61, M§124

---

### ADR-38 · First-party analytics
**Status:** Accepted · **Parent:** ADR-13 · **Owner:** Platform

**Context**
- M§42 bans content in analytics and requires tracking of onboarding, briefing open, meeting prep, assistant, capture, follow-up, subscription and referral.
- M§119 lists AI and business metrics.
- Third-party SDKs increase the data-sharing surface and the store privacy labels.

**Decision**
- **Table `analytics_events`:** `user_id`, `event_name` (an allow-listed enum-like text validated by zod), `props jsonb` (typed per event: no free text, no IDs of provider content), `app_version`, `platform`, `occurred_at`.
- The client batches events and posts them to `POST /analytics/events`. The server validates against the allow-list and drops unknown props.
- Backoffice dashboards query SQL rollups.
- Raw events are pruned by the `retention` job after 400 days (the `analytics_events` system TTL in DATABASE_AND_RLS_PLAN §6.4); daily rollups are kept.
- **Event catalogue (R-21).** The event names defined in the screen maps, plus the backend events listed in `API_CONTRACTS.md`, form the single catalogue. It is generated at execution into `packages/domain/analytics/events.ts`. `SECURITY_AND_PRIVACY_PLAN.md` defines the rules (snake_case names, allowed prop types, banned fields and content) and includes the catalogue by reference.
- An optional external adapter interface exists with no default implementation enabled.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Firebase Analytics or Amplitude SDK | Another sub-processor. Content-leak risk through automatic screen and property capture. Store privacy labels grow. |
| PostHog self-hosted | Extra infrastructure (M§6). The adapter interface allows it if the owner decides so. |

**Consequences**
- Full control and no content. Dashboards are built in the backoffice.

**Verification**
- A zod allow-list test.
- The server drops unknown events.
- A grep gate forbids `props` keys named `body`, `subject`, `text` or `content`.
- Backoffice metric E2E.

**Related master sections:** M§42, M§50, M§119

---

### ADR-39 · Sentry for error monitoring
**Status:** Accepted · **Parent:** ADR-13 · **Owner:** Platform

**Context**
- M§110: crash correlation and app versions.
- Expo SDK 57 support landed in `@sentry/react-native` v8 (getsentry#6384). Expo's table still lists ~7.11.
- sentry.io is blocked in the container.

**Decision**
- **Mobile:** `@sentry/react-native` **8.27.0** with the `@sentry/react-native/expo` plugin (`useNativeInit`) and `getSentryExpoConfig` for Metro. It is listed in `expo.install.exclude`.
- **Web and backoffice:** `@sentry/nextjs` **10.75.2**.
- **Functions:** a thin first-party adapter `_shared/observability/sentry.ts` posts error envelopes via `fetch` to the DSN. It has no SDK dependency, so it is Deno 2.1-safe.
- **Common settings everywhere:**
  - `sendDefaultPii: false`;
  - `beforeSend` scrubber shared from `packages/domain` (emails, tokens, bodies, query strings);
  - release = app version plus EAS fingerprint;
  - `correlation_id` tag.
- Source maps are uploaded in CI only.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Bugsnag or Datadog RUM | No advantage for this stack, and Sentry has first-class Expo plugin support. |
| No external error tool | M§110 crash correlation would be missing for native crashes. |
| `@sentry/react-native` 7.11 (Expo table) | Lacks SDK 57 support. |

**Consequences**
- **External credential required:** Sentry DSNs (`EXPO_PUBLIC_SENTRY_DSN` for mobile, `NEXT_PUBLIC_SENTRY_DSN` with one value per Next app, `SENTRY_DSN` for functions) and the CI token `SENTRY_AUTH_TOKEN`. Without them the adapters are no-ops and `health` reports "not configured".

**Verification**
- A scrubber unit test with a PII corpus.
- An EAS build smoke test.
- CI source-map upload step (skipped with a report line when no token is present).

**Related master sections:** M§110, M§126

---

### ADR-40 · Widgets via `@bacons/apple-targets` + Jetpack Glance
**Status:** Accepted · **Parent:** ADR-12 · **Owner:** Mobile

**Context**
- **expo-widgets 57.0.20** is iOS-only. Android is hidden behind an undocumented flag using Glance `1.2.0-rc01`. Widget code runs in an isolated runtime with only `@expo/ui/swift-ui` components, no hooks, app state or async. It also has a monorepo Metro resolution bug (expo#49750 / #49752).
- **react-native-android-widget 0.22.1** runs a headless JS runtime per update.
- **Platform limits:**
  - WidgetKit budget is about 40–70 refreshes per day, and the extension memory limit is about 30 MB.
  - Android `updatePeriodMillis` cannot go below 30 min.
  - Android 17 caps RemoteViews bitmaps.

**Decision**
- **iOS**
  - A hand-written SwiftUI WidgetKit extension in `apps/mobile/targets/widget/` via `@bacons/apple-targets` **5.0.0** (`type: "widget"`, App Group `group.com.dijitalasistan.app`, `deploymentTarget: "16.4"`).
  - Families: `systemSmall`, `systemMedium`, `systemLarge`, `accessoryCircular`, `accessoryRectangular`, `accessoryInline`.
  - `containerBackground` behind `#available(iOS 17, *)`; `widgetURL` / `Link` deep links to `dijitalasistan://…`.
  - `privacySensitive()` on names and subjects for the lock screen.
- **Android**
  - Kotlin `GlanceAppWidget` for 2×2 and 4×2 in local module `da-widgets`.
  - The config plugin adds the `<receiver>` and `appwidget-provider` XML (`targetCellWidth/Height` on API 31+, min-size fallback).
  - `updatePeriodMillis=0` plus WorkManager.
  - `PendingIntent` `FLAG_IMMUTABLE` deep links.
- **Shared data**
  - The app writes a zod-validated `WidgetSnapshot` (counts, next event time, titles only if the privacy mode allows, no mail bodies).
  - iOS: App Group `UserDefaults` plus `WidgetCenter.reloadTimelines(ofKind:)`. Android: SharedPreferences/DataStore plus `updateAll()`.
  - Triggers: foreground, sync completion, `expo-background-task` tick.
- Widgets are read-only; there are no interactive buttons.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| expo-widgets | iOS-only, isolated runtime, monorepo bug, Android flag undocumented. |
| react-native-android-widget | A JS runtime per update costs battery and startup. Glance is native and first-party. |
| WidgetKit push via direct APNs | Not needed. Foreground reloads and timelines suffice, and it would add a second push credential path. |

**Consequences**
- Swift and Kotlin code must be maintained.
- Requires Xcode 16 and CocoaPods 1.16.2 on EAS (default images).
- The `androidx.glance:glance-appwidget` version (1.1.1 stable) is confirmed against Google Maven in CI, because `dl.google.com` is blocked in the container.

**Verification**
- `expo prebuild --clean` smoke test (targets present, entitlements merged).
- `WidgetSnapshot` schema tests.
- Maestro opens the deep links behind widget URLs.
- The EAS build compiles both widget targets.

**Related master sections:** M§37, M§38, M§91

---

### ADR-41 · Share via `expo-share-intent`
**Status:** Accepted · **Parent:** ADR-12 · **Owner:** Mobile

**Context**
- M§28: share into the capture flow.
- `expo-share-intent` 8.0.1 supports SDK 57 (peers `expo ^57`, `expo-linking >=57.0.1`, `expo-constants >=57.0.3`). It redirects into the main app.
- `expo-share-extension` 5.0.6 documents support only up to SDK 54.
- The iOS share extension memory limit is about 120 MB.

**Decision**
- `expo-share-intent` **8.0.1** configured with:
  - `iosActivationRules`: `NSExtensionActivationSupportsText: true`, `…WebURLWithMaxCount: 1`, `…WebPageWithMaxCount: 1`, `…ImageWithMaxCount: 5`, `…FileWithMaxCount: 5` (PDF and files);
  - `iosAppGroupIdentifier: group.com.dijitalasistan.app`;
  - `androidIntentFilters: ["text/*","image/*","application/pdf"]`, `androidMultiIntentFilters: ["image/*","*/*"]`.
- Payloads land in the main app and go to Universal Capture (`POST /captures/upload-url` → `POST /captures`).
- Android copies `content://` URIs immediately, because the read grant is temporary.
- Images are downsampled and passed by file URL, never as in-memory base64.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| expo-share-extension (RN inside the extension) | Not supported on SDK 57. RN in a 120 MB extension is risky. |
| Custom Swift share extension with SwiftUI confirmation | Kept as the documented fallback if App Review rejects the redirect behaviour. Otherwise more code for the same result. |

**Consequences**
- The redirect relies on an undocumented responder-chain `openURL`. It is widely shipped but remains an App Review risk, recorded in `KNOWN_PLATFORM_LIMITATIONS.md` and `STORE_CHECKLIST`.

**Verification**
- Prebuild smoke test with both apple-targets and share-intent (separate bundle IDs `.widget` and `.share-extension`, the expo-share-intent default).
- A Maestro Android `ACTION_SEND` test via `adb am start`.
- Jest tests of the capture domain flow with each payload kind.

**Related master sections:** M§27, M§28

---

### ADR-42 · Android NI: on-device structured extraction only
**Status:** Accepted · **Parent:** ADR-12 · **Owner:** Privacy/Mobile

**Context**
- Design copy promises "Bildirim erişimi cihazda işlenir" and "Mesaj içerikleri asla saklanmaz".
- M§36 requires an explicit opt-in and a sensitive-app exclusion.
- Platform behaviour:
  - Android 15 redacts OTP content for untrusted listeners, but Android 10–14 does not.
  - Android 13+ sideloads require the user to "allow restricted settings".
  - Play requires prominent disclosure plus affirmative consent and accurate Data safety answers.

**Decision**
- **Module.** Local Kotlin `notification-intelligence` with a `NotificationListenerService`:
  - `default_filter_types="conversations|alerting"`;
  - `BIND_NOTIFICATION_LISTENER_SERVICE` permission;
  - explicit `android:exported`, following the current platform reference and verified by the bind test below.
- **JS API:** `isGranted()`, `openSettings()` (`ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS` on API 30+), `getRecentSignals()`, `setMode('all'|'selected')`, `setAllowedPackages([])`, `disable()`. The grant is re-checked on every resume. The in-app toggle reflects the real system grant.
- **On-device rules** extract only `{package, app_label, category: cargo|bank_payment|flight|reservation|other, amount?, currency?, due_date?, tracking_status?, flight_no?, gate?, posted_at, signal_hash}`.
  - Raw `EXTRA_TITLE` / `EXTRA_TEXT` are never persisted or uploaded.
  - An encrypted in-memory/local buffer holds at most N items for at most 24 h.
- **Filtering**
  - **Always excluded**, shown as the locked row "Güvenlik uygulamaları her zaman hariç tutulur": authenticators, password managers, `com.google.android.gms`, e-Devlet `tr.gov.turkiye.edevlet.kapisi`, our own package.
  - **Default off:** messaging and SMS apps.
  - **Default on, content-filtered:** banks, cargo, airlines.
  - An OTP detector drops matching notifications entirely: 4–8 digit tokens near kod / şifre / doğrulama / onay kodu / OTP / code / verification / tek kullanımlık.
  - `VISIBILITY_SECRET` and `CATEGORY_CALL` are dropped.
  - The package list lives in the `catalog` payload of the flag `feature.android_ni` (R-10 keys), so it can be updated without a release.
- **App list** for selected mode uses `<queries>` with a MAIN/LAUNCHER intent, **not** `QUERY_ALL_PACKAGES`.
- **Upload:** structured signals only, via `POST /android-notifications/signals` into `android_notification_signals`. Pro is enforced server-side.
- iOS hides the feature and the module returns `isSupported: false`.
- **Disclosure copy (R-15)**, used in onboarding, settings and the Play prominent disclosure: "Bildirim içerikleri cihazında işlenir; yalnızca çıkarılan bilgiler (ör. kargo durumu, tutar, tarih) hesabına kaydedilir. Doğrulama kodları ve güvenlik uygulamaları her zaman hariç tutulur."

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Upload raw notification text for server AI | Contradicts the design promise. Would require a copy change and a privacy review. Bank OTP leakage risk. |
| `QUERY_ALL_PACKAGES` | Needs a Play declaration. Not needed for launcher apps. |
| An iOS equivalent via app extensions | No system-wide stream exists (M§36, M§91). |

**Consequences**
- Extraction quality is bounded by on-device rules. There is no LLM on raw notification text.
- Package IDs beyond the verified set must be checked against Play before shipping. The remote list makes corrections cheap.

**Verification**
- Kotlin unit tests: OTP detector corpus (Turkish and English), denylist precedence, signal extraction fixtures.
- Instrumented bind test in CI (Android emulator): after the grant, `getEnabledListenerPackages` contains the app and `onListenerConnected` fires.
- Server test: the signal payload rejects any free-text field.
- **Manual external step:** Play Data safety form and prominent-disclosure review.

**Related master sections:** M§36, M§40, M§44, M§91

---

### ADR-43 · AI tiering T0–T3; model IDs are configuration only
**Status:** Accepted · **Parent:** ADR-08 · **Owner:** AI

**Context**
- Verified on 2026-09-23:
  - `claude-haiku-4-5-20251001`: $1/$5 per MTok; retirement "not sooner than **2026-10-15**" with ≥60 days' notice promised; `effort` errors; `inference_geo` returns 400; minimum cacheable prefix 4,096 tokens.
  - `claude-sonnet-5`: $2/$10; sampling params and prefill return 400; minimum cache prefix 1,024.
  - `claude-opus-5-5`: $4/$20; thinking cannot be disabled; effort default `medium`; forced `tool_choice` returns 400; minimum cache prefix 512.
- M§81: the user-facing model choice must not be hard-coded. M§57: model config is audited.

**Decision**
- **Tiers**

  | Tier | Engine | Features |
  |---|---|---|
  | T0 | deterministic code | pre-filter, rules/VIP, follow-up state machine, midday and evening lists, security events, schema.org/JSON-LD plus Turkish sender-template life-intel parsers, slot finder, TR date/amount/tracking/flight/PNR extractors, intent grammar for suggested prompts and voice commands |
  | T1 | `claude-haiku-4-5-20251001` | email triage (6-way plus needs_reply/expects_reply plus evidence; ≤5 emails per request); commitment extraction when the TR commitment regex fires; life-intel fallback; post-meeting parse; capture text/link; assistant intent (`AssistantIntentV1`); optional one-sentence midday/evening polish behind `ai.feature.briefing_polish` (R-05; never T2) |
  | T2 | `claude-sonnet-5` | morning briefing from ranked item JSON; thread summaries on open; deep extraction escalations; meeting prep; weekly review via Message Batches; reply drafts (4 tones in one call); capture photo/PDF; grounded assistant QA with native `search_result` citations |
  | T3 | `claude-opus-5-5` behind `ai.model.opus_escalation` | dense capture layouts, citation coverage <0.8; target <2 % of calls |

- **Fallback chains**
  - T1 → Sonnet 5 (thinking disabled, effort low) → `gpt-5.6-luna` → T0.
  - T2 → Haiku → `gpt-5.6-terra` → T0 template.
  - T3 → Sonnet 5 → terra.
  - If everything fails, the last analysis is shown.
- **Adapter request rules**, keyed by model family:

  | | Haiku 4.5 | Sonnet 5 | Opus 5.5 |
  |---|---|---|---|
  | thinking | omit | `{type:"adaptive"}` (or `disabled` for the T1 fallback role) | omit (always on) |
  | `output_config.effort` | never | `low` (extraction) / `medium` (prep) | explicit `low` |
  | sampling params / prefill | none | none (400) | none (400) |
  | `inference_geo` | never (400) | omit | omit |
  | refusal fallback | — | — | `fallbacks:"default"` + beta `server-side-fallback-2026-07-01` on sync calls (not Batches) |

- **Structured outputs:** `client.messages.parse` with `zodOutputFormat` (`@anthropic-ai/sdk/helpers/zod`, SDK 0.128.0) via `output_config.format`. Always check `stop_reason` first: `refusal` and `max_tokens` are handled explicitly.
- **Config only.** Model IDs live in `ai_model_config` rows (`primary_target`, `fallback_targets`, `escalation_target`; shape per AI_PIPELINE_PLAN §3.6). Rows are unique on `(profile, role, feature)` (R-18): `profile` is the enum `routing_profile` (`balanced | lean`), and `role` is fixed per feature, so there is exactly one row per `(profile, feature)`. Rows are seeded by migration or seed and are editable in the backoffice with audit. Product code refers to features and tiers, never to model strings.
- **Haiku retirement plan.** Replacing Haiku is a backoffice config change. `claude-sonnet-5` (thinking disabled, effort low) and `gpt-5.6-luna` are pre-evaluated as T1 replacements on the golden set before 2026-10-15.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Hard-coded model constants | Violates M§81. Haiku retirement would require a release. |
| Sonnet 5 for all T1 work | About 2× triage cost with no measured quality need. Also weaker cache economics at T1 volume. |
| Opus 5.5 as the default T2 | 2× Sonnet price. Effort-medium default and always-on thinking raise latency for the 08:00 burst. |

**Consequences**
- The adapter carries a per-family rule table.
- Swapping the Haiku prompt needs a ≥4,096-token static prefix (curated Turkish few-shots) to cache.

**Verification**
- CI grep: the model-ID pattern (`claude-`, `gpt-`, `voyage-`, `text-embedding-`) may appear only in `supabase/seed/**`, adapter rule tables keyed by family, and tests.
- Deno adapter tests assert forbidden params are never sent per family.
- Nightly owner-run evals compare replacement candidates (**External credential required:** Anthropic and OpenAI keys).

**Related master sections:** M§57, M§80, M§81, M§82

---

### ADR-44 · Claude Fable 5.1 excluded from routing
**Status:** Accepted · **Parent:** ADR-08 · **Owner:** AI/Privacy

**Context**
- `claude-fable-5-1` costs $10/$50 per MTok, 2.5× Opus 5.5.
- It is a Covered Model: 30-day data retention is mandatory, it is not available under ZDR without express authorisation, and organisations with shorter retention get `400 invalid_request_error`.
- Our privacy posture and copy promise minimal retention and no training. KVKK data minimisation applies.

**Decision**
- Fable 5.1 (and any Covered Model) is **not** routable. An `ai_model_config` check trigger (R-02) rejects, on insert and update, any row whose `primary_target`, `fallback_targets[*]` or `escalation_target` names a model matching `claude-fable-%` or `claude-mythos-%`.
- T3 escalation uses `claude-opus-5-5`.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Fable 5.1 as T3 | Mandatory 30-day retention conflicts with privacy copy. Cost is disproportionate for extraction. |
| Enabling 30-day retention in one workspace for Fable | Splits the prompt cache across workspaces and complicates the retention disclosure. |

**Consequences**
- The highest capability tier is Opus 5.5.
- Revisit trigger: a Covered Model becomes available without mandatory retention **and** the privacy owner approves.

**Verification**
- A pgTAP test proves that `claude-fable-5-1` is rejected in `primary_target`, `fallback_targets` and `escalation_target`.
- A backoffice E2E proves that selecting a Fable ID in model config is rejected with a validation error.

**Related master sections:** M§40, M§57, M§81, M§113

---

### ADR-45 · Voyage 4 embeddings at 1024-d, plus a disaster-recovery path
**Status:** Accepted · **Parent:** ADR-08 · **Owner:** AI

**Context**
- Voyage 4 (2026-01-15):
  - `voyage-4` $0.06/MTok, `voyage-4-lite` $0.02/MTok, first 200 M tokens free;
  - dimensions 256/512/**1024 (default)**/2048;
  - 32K context;
  - a **shared embedding space** across the family, so lite queries match `voyage-4` documents.
- pgvector: the migration subset is kept compatible with 0.6 for tier C. HNSW `vector` indexes support up to 2,000 dimensions.
- No published Turkish benchmark exists for voyage-4 or OpenAI embeddings.
- The `voyageai` npm package depends on node-fetch.

**Decision**
- **Models:** `voyage-4` for documents (`input_type:"document"`) and `voyage-4-lite` for queries (`input_type:"query"`), both 1024-d.
- **Storage:** `memory_chunks.embedding vector(1024)`, HNSW `vector_cosine_ops`. The model tag is stored per row (`voyage-4@1024`).
- **Client:** raw `fetch` from Deno with no SDK.
- **Content embedded:** derived chunks only. Email chunk = subject, sender, date, summary, key points, verified evidence, ≤400 tokens. Also thread rolling summaries, events, capture items and user notes. Commitments, life events and deadlines are queried structurally.
- **Search:** hybrid RRF (k = 60) of FTS (`turkish` plus a folded `simple` column) and vector distance. Candidate selection is always constrained to `user_id` and `expires_at` **before** top-k, so there is no post-filter recall loss.
- **Degradation:** no hot cross-provider fallback, because vector spaces differ. Failures are retried in the queue and search degrades to FTS-only.
- **Disaster recovery:** re-embed with OpenAI `text-embedding-3-small` (`dimensions: 1024`) into a new column, dual-query with RRF during migration, then flip `ai_model_config`.
- Free plan has no embeddings (AI Memory is Pro). Backfill runs on upgrade.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| OpenAI `text-embedding-3-small` as primary | Viable, but Voyage 4's shared space enables a cheap query model with no re-index. Kept as the DR path. |
| `halfvec` / 2048-d | `halfvec` needs pgvector ≥0.7 (tier-C incompatible). 2048-d doubles storage for unproven Turkish gains. |
| Self-hosted BGE-m3 | Needs GPU infrastructure (M§6). |

**Consequences**
- An own Turkish retrieval eval (≥150 query→source pairs) gates activation. Embedding cost is negligible (≈ $0.000018 per chunk).

**Verification**
- pgTAP/integration recall test on the fixture corpus: user-filtered top-k equals exact KNN (100 % recall) and never returns another user's rows.
- The retention purge removes embeddings.
- The owner-run eval compares voyage-4 against text-embedding-3-small on the Turkish set.
- **External credential required:** Voyage API key.

**Related master sections:** M§26, M§95, M§131

---

### ADR-46 · Routing profiles `balanced` / `lean` (pricing vs AI COGS)
**Status:** Accepted · **Parent:** ADR-08 · **Owner:** **Product owner** (pricing and margin decision) with AI engineering (implementation)

**Context**
- Unit economics:
  - Pro monthly at 199 TL gross ≈ $4.07; after 20 % KDV and a 15 % store fee, net ≈ **$2.89/month**.
  - Pro annual at 1.490 TL ≈ **$1.80/month** net.
  - USD/TRY = 48.84 on 2026-09-23.
- Target AI COGS ≤25 % of net ≈ $0.72 (monthly plan) or $0.45 (annual plan).
- Modelled cost of the optimised `balanced` routing for a typical Pro user is ≈ **$2.24/month**, which is above target.
- `lean` routing costs ≈ **$1.02/month**. It uses:
  - `gpt-5.6-luna` for triage, sent mail, life-intel and intent;
  - Haiku for briefings and escalations;
  - meeting prep on tap only;
  - single-tone drafts.

**Decision**
- Both profiles are implemented and seeded in `ai_model_config` (column `profile` = `balanced | lean`, enum `routing_profile`, R-18).
- Each plan names its active profile in the `plan_limits` key `ai_routing_profile` (R-22 key/value shape; `value` is the jsonb string `"balanced"` or `"lean"`). The product default is **`balanced`**. The seed is `pro` → `"balanced"` and `free` → `"lean"`.
- Switching is a backoffice action (permission `ai.models.write`, held by `ai_ops` and `super_admin`), audited.
- **Eval gate for enabling `lean` on a plan:**
  - triage category macro-F1 ≥0.85 and within 0.02 of `balanced`;
  - grounding verified-rate ≥0.95;
  - injection eval creates zero approvals.
- **Decision owner:** the pricing / margin choice (revise price or limits, accept margin, or run `lean` by default) belongs to the product owner. The final implementation report flags it explicitly.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Ship `balanced` only | Leaves the margin decision without an engineering lever. |
| Ship `lean` only | Quality risk until the Turkish evals pass; the design's instant four-tone switch degrades. |
| Hard per-user feature cuts | Violates the single product scope. Budgets degrade gracefully instead (ADR-08). |

**Consequences**
- There are two tested configurations. UX differences in `lean` (single-tone draft with a skeleton per tone, meeting prep on tap) are designed and i18n'd, never hidden.

**Verification**
- Router unit tests per profile.
- A backoffice E2E of the profile switch with an audit row.
- The cost dashboard shows per-profile daily cost from `ai_usage_daily`.

**Related master sections:** M§44, M§56, M§57, M§82, M§119

---

### ADR-47 · Maestro, not Detox
**Status:** Accepted · **Parent:** ADR-15 · **Owner:** Quality

**Context**
- M§102 lists 20 mobile E2E areas, including dark mode and offline/reconnect.
- Maestro 2.10.0 (Java 17+):
  - black-box YAML flows;
  - `setDarkMode` / `toggleDarkMode` / `assertDarkMode` / `assertLightMode` since 2.9;
  - documented on EAS Workflows.
- Detox 20.51.4 needs a native test harness, a config plugin and gray-box synchronisation.

**Decision**
- Maestro **2.10.0** flows in `apps/mobile/.maestro/` cover every M§102 item plus the secondary acceptance flows A–J.
- **Build profile.** Flows run on the EAS `e2e` profile: a Release build with an embedded bundle, `DEMO_MODE` data, and a seeded Supabase.
- **Android** runs on GitHub Actions ubuntu with KVM (`reactivecircus/android-emulator-runner`) against `supabase start` on the same runner. The app uses `http://10.0.2.2:54321`.
- **iOS** runs on EAS Workflows against the staging project in demo mode.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Detox | Native harness, build-time coupling, flakier parity across iOS and Android, more maintenance. |
| Appium | Heavier setup, slower authoring, no Expo-documented path. |

**Consequences**
- Black-box tests cannot inspect internal state; assertions go through visible UI and accessibility IDs.
- **External credential required:** `EXPO_TOKEN` for EAS Workflows.

**Verification**
- A CI job publishes the Maestro JUnit report.
- A flow inventory test maps each M§102 item to a flow file.

**Related master sections:** M§102, M§135

---

### ADR-48 · Database test tiers A / C (+ D PGlite)
**Status:** Accepted · **Parent:** ADR-15 · **Owner:** Quality

**Context**
- `supabase start`, `db reset`, `test db` and `gen types` require Docker. The container's Docker daemon is not running.
- The container has PostgreSQL 16 binaries. apt (archive.ubuntu.com, reachable) provides `postgresql-16-pgvector 0.6.0-1`, `postgresql-16-pgtap 1.3.2-2`, pg_prove 3.36-2 and `postgresql-16-cron 1.6.2-1`. pg_net is not in apt.
- Hosted Supabase and CI run Postgres 17 (`supabase/postgres:17.6.1.167`).

**Decision**

| Tier | Where | Stack | Role |
|---|---|---|---|
| **A** | CI (GitHub Actions + `supabase/setup-cli`) | Full Supabase CLI 2.117.0 stack, PG17 | **Authoritative.** `db reset` from zero, `test db` (pgTAP), `db lint`, `gen types --local` diff |
| B | Container, best effort | `dockerd` started manually | Opportunistic; image pulls may be blocked. Never a gate. |
| **C** | Container, guaranteed | PG16 cluster + pgvector 0.6 + pgTAP + pg_cron via apt; `supabase/tests/shim/000_supabase_compat.sql` loaded before migrations | Local RLS/pgTAP gate. The shim provides roles `anon`, `authenticated`, `service_role BYPASSRLS`, `authenticator`; schemas `auth`, `storage`, `extensions`, `net`, `vault`; minimal `auth.users`; `auth.uid()`, `auth.role()`, `auth.jwt()` reading `request.jwt.claims`; `storage.buckets/objects/foldername()`; no-op `net.http_post()` |
| **D** | Container and CI, in-process | PGlite 0.5.8 + `pglite-pgvector` 0.0.9 + `pglite-pgtap` 0.0.9 inside Vitest | Fast pure SQL-function tests (single connection; no pg_cron or pg_net) |

- **Migration portability rules:**
  - PG16-compatible SQL: no `JSON_TABLE`, no `MERGE … RETURNING`, no `transaction_timeout`.
  - pgvector 0.6 subset: `vector(1024)`, HNSW; no `halfvec`, `sparsevec` or `hnsw.iterative_scan`.
  - `create extension if not exists` guards for `pg_net`, `pg_cron` and `vector`.
- **Types without Docker:** `@supabase/postgres-meta 0.99.0` in `PG_META_GENERATE_TYPES=typescript` mode against the tier-C database. CI regenerates the types and diffs them.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Tier A only | The container could never run database tests. The build/test/fix loop (M§134) would stall. |
| Testcontainers | Needs Docker. |
| Mocking Supabase in unit tests | Does not exercise RLS. False confidence. |

**Consequences**
- Shim drift risk is mitigated because the shim mirrors GoTrue's `request.jwt.claims` contract and tier A is the release gate.

**Verification**
- The same pgTAP suites run in tiers A and C.
- A shim conformance test (`auth.uid()` behaviour matches tier A outputs recorded in CI).
- The final report lists which tier ran where.

**Related master sections:** M§79, M§101, M§105, M§134

---

### ADR-49 · Demo-mode gating
**Status:** Accepted · **Parent:** ADR-07 · **Owner:** Architecture

**Context**
- M§89: development must not stop when credentials are missing. Deterministic demo adapters and a demo dataset are required. Demo mode must never be active in production without explicit configuration. No fake success in production code.
- M§90 covers missing credentials.

**Decision**
- **Switches:** `DEMO_MODE=true` enables:
  - the `demo` provider adapters (mail, calendar, tasks), implementing the same interfaces with deterministic, persisted state;
  - the `fixture` AI provider;
  - the RevenueCat Test Store key;
  - the demo seed.
- **Demo seed** in `supabase/seed/demo/`:
  - uses PRIMARY names (Ahmet Yılmaz — Kuzey Lojistik, Mehmet Yılmaz — Yılmaz Endüstri, Selin Kaya);
  - dates are computed relative to `now()`;
  - covers users, emails, calendars, meetings, commitments, briefings, shipments, flights, payments and subscriptions.
- **Production refusal:**
  - `_shared/env` throws at boot when `APP_ENV=production` and `DEMO_MODE=true` unless `ALLOW_DEMO_IN_PRODUCTION=true`.
  - The EAS `production` profile build fails if `EXPO_PUBLIC_DEMO_MODE=true`.
  - `health` reports demo state as not green in production.
- **Demo writes are real within our system.** An approved demo `email_send` persists a sent message into the demo thread in `email_messages` (provider `demo`) and is visible in the UI. There is no external side effect and no fake toast.
- `GET /me/bootstrap` returns the demo flag. The app shows a persistent banner (`demo.banner`: "Demo modu — örnek veriler gösteriliyor.").

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Mock responses inside production handlers | Fake success (M§89, M§99). |
| Separate demo build of the app | Divergent code paths. The same binary must behave identically, with only data sources differing. |

**Consequences**
- Every feature is demo-able end to end. Maestro and Playwright run deterministically.

**Verification**
- A Deno boot test proves `APP_ENV=production` plus `DEMO_MODE` throws.
- An EAS config lint in CI.
- A `health` test.
- A quality-gate grep for demo imports in non-adapter production modules.

**Related master sections:** M§89, M§90, M§99, M§100

---

### ADR-50 · Node 24 LTS in CI/EAS/Vercel
**Status:** Accepted · **Parent:** ADR-02 · **Owner:** Platform

**Context**
- RN 0.86.3 engines: `^20.19.4 || ^22.13.0 || ^24.3.0 || >=25`.
- pnpm 11 needs ≥22.13.
- supabase-js 2.117.1 needs ≥22 and dropped Node 20 in 2.110.0. Node 20 reached end of life on 2026-04-30.
- next 16.3.6 needs ≥20.9.
- The container runs Node 22.22.2.

**Decision**
- Node **24.21.0 LTS** in GitHub Actions, EAS (`eas.json` `node: "24.21.0"`) and both Vercel projects (Node 24.x).
- `.nvmrc` = `24`.
- `engines.node: ">=22.13.0"`, so the container's Node 22.22.2 remains valid for local verification.
- `@types/node 24.13.6`.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Node 22 everywhere | Works, but 24 is the active LTS with a longer support window. |
| Node 20 | End of life; supabase-js dropped it. |
| Node 25 | Not LTS. |

**Consequences**
- Two Node majors are exercised (22 locally, 24 in CI), which catches accidental Node-24-only API use.

**Verification**
- The CI matrix asserts `node -v` is v24.21.0.
- The container run asserts ≥22.13.
- `engines-strict` is enabled in pnpm.

**Related master sections:** M§105, M§109

---

### ADR-51 · Supabase publishable and secret keys
**Status:** Accepted · **Parent:** ADR-04 · **Owner:** Security

**Context**
- Legacy `anon` and `service_role` keys are deprecated by the end of 2026.
- New keys: `sb_publishable_…` (client) and `sb_secret_…` (server; bypasses RLS). Named secret keys are supported, and `@supabase/server` `withSupabase({auth})` supports the modes `user`, `secret`, `secret:<name>`, `publishable:<name>` and `none`.
- M§7 / M§152: no secret key in any frontend bundle.

**Decision**

| Surface | Key |
|---|---|
| Mobile, web | Publishable key only |
| Backoffice | Publishable key only (for Supabase Auth sign-in and MFA); all data via `admin-api` with the admin JWT |
| Edge Functions | Secret key from the platform environment, used inside server code only |
| pg_cron → `worker` / `health` | Named secret key `automations` (`auth:'secret:automations'`); its value is stored in Vault as `da_cron_secret` for pg_net (`CRON_SECRET` in CI and scripts) |

- Legacy keys are never used.
- Env schemas: `@t3-oss/env-nextjs` server/client split on web and backoffice; zod schema in `_shared/env`; `EXPO_PUBLIC_*` only for publishable values on mobile.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Legacy `anon` / `service_role` | Deprecated, with no per-purpose revocation. |
| One secret key shared by all server paths | Rotation blast radius. The named `automations` key can be rotated independently. |

**Consequences**
- Key rotation is per purpose.
- **Manual external step:** create the `automations` secret key in the dashboard and store it in Vault via an ops script that is not committed.

**Verification**
- A bundle scan greps built outputs (`.next`, `expo export` `dist`) for `sb_secret_`, `service_role` and JWT-shaped secrets.
- The env-schema test fails if a server key name is exposed with a `NEXT_PUBLIC_` or `EXPO_PUBLIC_` prefix.

**Related master sections:** M§7, M§79, M§107, M§152

---

### ADR-52 · Next 16 `proxy.ts` and server-action `Origin` enforcement
**Status:** Accepted · **Parent:** ADR-06 · **Owner:** Security

**Context**
- Next 16 behaviour:
  - `proxy.ts` replaces `middleware.ts`, and its runtime is fixed to `nodejs`;
  - `next lint` is removed;
  - Turbopack is the default and a custom `webpack` config fails the build;
  - synchronous `params`, `cookies()` and `headers()` are removed.
- Next's server-action CSRF defence compares `Origin` with the host, but "a request that carries no `Origin` header at all is allowed through with a warning rather than rejected".
- M§48 requires CSRF-safe mutations and rate limiting.

**Decision**
- **Backoffice `proxy.ts`:**
  - session presence and expiry checks (idle 30 min and absolute 12 h, via the `admin_sessions` state returned by `admin-api`);
  - security headers and strict CSP with nonces;
  - a per-instance token-bucket limiter on `/login` and `/mfa`.
  Authoritative rate limits are enforced server-side in `admin-api` / `public-api` via `rate_limit_hit()`.
- **Server actions** are wrapped in `adminAction()`, which **rejects** requests with a missing `Origin` or an `Origin` not equal to `https://admin.<domain>`, and requires a valid `__Host-da_admin` cookie (SameSite=Strict). `serverActions.allowedOrigins` is not widened.
- **Web:** `cacheComponents: true`, `reactCompiler: true`, security headers via `proxy.ts`. The backoffice keeps `cacheComponents: false` so admin data is never cached across requests.
- Both apps run ESLint through its CLI (ADR-19).

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Rely on Next's built-in Origin check | Missing-`Origin` requests pass. |
| Double-submit CSRF tokens on every form | Redundant with strict `Origin` plus SameSite=Strict for a server-rendered admin; adds complexity. |
| Edge-runtime middleware | Not supported by `proxy.ts` in Next 16. |

**Consequences**
- Non-browser clients cannot call server actions. This is intended: automation goes through `admin-api`.

**Verification**
- Playwright tests: a POST to a server action without `Origin` returns 403; with a foreign `Origin` returns 403; with the correct `Origin` succeeds.
- A CSP header snapshot test.
- A rate-limit test on `/login`.

**Related master sections:** M§48, M§73, M§103, M§113

---

### ADR-53 · Deployment topology: Vercel ×2, Supabase, EAS
**Status:** Accepted · **Parent:** ADR-01 · **Owner:** Platform

**Context**
- M§109: EAS-ready mobile; Vercel-compatible marketing; a separately deployed backoffice compatible with an admin subdomain; Supabase migrations, functions, jobs and secrets documented.
- The design copy states EU (Frankfurt) storage.

**Decision**

| Component | Host | Environments | Deploy path | Domain |
|---|---|---|---|---|
| `apps/web` | Vercel project `da-web` (functions region `fra1`) | preview per PR, production | Vercel Git integration, gated by CI status | `dijitalasistan.app` |
| `apps/backoffice` | Vercel project `da-backoffice` (`fra1`, deployment protection on previews) | preview, production | same | `admin.dijitalasistan.app` |
| Supabase | Pro plan, region `eu-central-1` | `staging`, `production` (+ local) | `deploy-supabase` workflow: `db push`, then `functions deploy --use-api`, then a secrets presence check; protected branch plus manual approval | production `api.dijitalasistan.app` (ADR-35) |
| Mobile | EAS Build / Submit / Update | profiles `development`, `preview`, `e2e`, `production`; `runtimeVersion` policy `fingerprint`; `appVersionSource: remote` | EAS Workflows | App Store / Google Play |

- **Identifiers:**
  - `com.dijitalasistan.app` (iOS and Android), scheme `dijitalasistan`;
  - extension bundle IDs `com.dijitalasistan.app.widget` and `com.dijitalasistan.app.share-extension` (the expo-share-intent default);
  - `extra.eas.build.experimental.ios.appExtensions` declares both so credentials are generated for each.
- **Scheduled workflow `rotate-siwa-secret`** (every 150 days) regenerates the Apple web-OAuth client-secret JWT and updates Supabase Auth via the Management API. **External credential required:** Supabase access token, SIWA key.
- **Cross-border disclosure.** Anthropic, OpenAI and Voyage process in the US. The privacy page and Privacy Center state this; storage remains EU.

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Web and backoffice in one Vercel project | Shared env and secrets; breaks the separate security boundary (M§88, M§109). |
| Self-hosted Supabase | Operational burden (M§6). |
| One Supabase project for staging and prod | Test data would mix with production (M§151). |

**Consequences**
- **Manual external step:** Vercel projects, DNS, Supabase projects and add-ons, EAS project, and store listings.
- Deploys are reproducible from CI.

**Verification**
- A `deploy-supabase` dry run in CI (`db push --dry-run` against staging).
- A post-deploy `health` probe.
- An EAS config lint (profiles present, production has no demo flag).
- A DNS/TLS check in `health`.

**Related master sections:** M§108, M§109, M§112, M§151

---

### ADR-54 · Mobile secure local storage and offline cache
**Status:** Accepted · **Parent:** ADR-06 · **Owner:** Mobile/Security

**Context**
- M§87: sensitive local data encrypted; no tokens in AsyncStorage; no unnecessary raw mail bodies; logout cleanup.
- M§94: offline and resilience.
- Supabase sessions exceed about 2 KB, and some iOS releases rejected SecureStore values above that size.
- iOS Keychain items survive reinstall.

**Decision**
- **Session: LargeSecureStore pattern.**
  - A random 256-bit AES key is kept in `expo-secure-store` (`keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`).
  - The encrypted session blob lives in MMKV.
- **Caches:** MMKV v4 `createMMKV({ id, encryptionKey, encryptionType: 'AES-256' })`, with the key in SecureStore.
- **Query persistence:** TanStack Query persistence with `createAsyncStoragePersister` over MMKV. Only queries tagged `meta.persist` are persisted. Mail originals, assistant streams and signed URLs are never persisted.
- **Network state:** netinfo drives TanStack `onlineManager`. An offline banner shows over cached data, and a mutation queue is used only for side-effect-free owner writes. Approvals require being online.
- **First run:** a flag in non-keychain storage. If absent, the Supabase session and stale SecureStore keys are purged.
- **Android backup:** Auto Backup excludes SecureStore and MMKV files.
- **Logout** wipes MMKV instances, the query cache and the widget snapshot, and disables the push token (ADR-06).

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| AsyncStorage for the session | M§87 forbids it. |
| SecureStore for the whole session | Size limits on some iOS versions. |
| expo-sqlite + SQLCipher offline store | Not required by any flow; MMKV plus a persisted query cache covers offline reading. |

**Consequences**
- Offline mode shows the last cached Today, Flow and Plan. Writes that need the provider wait for connectivity with a visible state.

**Verification**
- Jest tests: the persister allow-list, the logout wipe, the first-run purge.
- Maestro offline/reconnect flow (airplane-mode toggle on Android).

**Related master sections:** M§87, M§94, M§125

---

### ADR-55 · Voice stack: on-device STT, synth-to-file TTS
**Status:** Accepted · **Parent:** ADR-08 · **Owner:** Mobile/AI

**Context**
- M§25 voice and M§9 audio briefing need a player with play/pause, seek, ±15 s, speed 1.0 → 1.25 → 1.5, section tabs, the lock screen and CarPlay.
- `expo-speech` alone cannot seek or provide lock-screen controls.
- Design timing: live transcript, and a response after 1.2 s of silence.

**Decision**
- **STT**
  - On-device `expo-speech-recognition` **57.1.0** with `lang: "tr-TR"`, `interimResults`, `requiresOnDeviceRecognition` when supported, and `contextualStrings` (VIP and top contact names).
  - Our own VAD stops after 1.2 s of silence.
  - Android triggers an offline tr-TR model download when missing.
  - **Server fallback** via `POST /assistant/transcribe` (`gpt-transcribe`, then Deepgram Nova-3). It is used when the device lacks tr-TR, for post-meeting dictation longer than about 60 s, or when the user opts in. Audio is uploaded to a private temporary path, deleted right after transcription, with a 24 h lifecycle backstop.
- **TTS**
  - A local native module `da-tts` renders each briefing section to a file: iOS `AVSpeechSynthesizer.write`, Android `TextToSpeech.synthesizeToFile`, choosing the best available tr-TR voice.
  - Playback uses `expo-audio` with real seek, rate and lock-screen metadata.
  - Degraded fallback: `expo-speech` sentence chunks, with section-level skip only.
  - Premium adapters (Azure tr-TR Neural, `gpt-4o-mini-tts`, ElevenLabs) sit behind `voice.tts_premium`. Audio is rendered on first "Dinle" and cached in the `briefing-audio` bucket per briefing version.
- **Deterministic Turkish TTS text normaliser** (no LLM). Examples: "1.842 TL" → "bin sekiz yüz kırk iki lira", "17:00" → "saat on yedi", "TK2412" → "Te Ka yirmi dört on iki".
- **Voice intents** go through the T0 grammar first. Voice write intents always end in an on-screen approval card that must be tapped; a spoken "onayla" never approves (ADR-09, R-03).

**Alternatives considered**

| Alternative | Why rejected |
|---|---|
| Server STT by default | Cost, latency and a privacy transfer for every query. |
| Premium TTS by default | ~$0.035–0.11 per briefing against the COGS target (ADR-46). |
| `expo-speech` only | No seek, scrubbing or lock-screen controls. Violates the design's player spec. |

**Consequences**
- **Manual external step:** the CarPlay audio-app entitlement.
- When on-device recognition is unavailable, the Privacy Center states that audio may be processed by Apple or Google speech services.

**Verification**
- Normaliser unit tests (numbers, currency, times, dates, flight codes, acronyms).
- A player component test for seek and rate state.
- Deno tests for transcribe cleanup (the temp object is deleted).
- Maestro voice-screen flow in demo mode.

**Related master sections:** M§9, M§24, M§25, M§115

---

## 4. Version matrix (verified 2026-09-23)

Sources: `npm view`, published tarballs, `expo@57.0.24/bundledNativeModules.json`, the `expo-template-default@57.0.26` manifest, the RN 0.86.3 `gradle/libs.versions.toml`, and the Supabase CLI 2.117.0 Dockerfile and `config.toml` templates. "~" means Expo-style tilde pins; everything else is exact.

### 4.1 Toolchain / repository root

| Package / tool | Version | Workspace | Reason |
|---|---|---|---|
| Node.js | **24.21.0 LTS** (`.nvmrc` 24); `engines.node >=22.13.0` | root, CI, EAS, Vercel | Satisfies RN 0.86.3, pnpm 11, supabase-js ≥22, next ≥20.9. Container 22.22.2 is valid (ADR-50) |
| pnpm | **11.27.1** (`packageManager`) | root | Maintained line; pnpm 12 unverified with Turbo and EAS (ADR-16) |
| turbo | **2.11.3** (fallback 2.11.2) | root | Latest; less than 24 h old at audit time, so the fallback exists for `minimumReleaseAge` |
| typescript | **~6.0.3** | default catalog | TS 7 has no JS API and typescript-eslint caps below 6.1 (ADR-17) |
| eslint | **9.39.5** | root, packages/config | ESLint 10 breaks Next and React plugins (ADR-19) |
| @eslint/js | 9.39.5 | packages/config | Matches the ESLint major |
| typescript-eslint | **8.70.1** | packages/config | Peer `typescript <6.1.0`, `eslint ^9` |
| eslint-config-expo | ~57.0.2 (`/flat`) | apps/mobile | Official flat config |
| eslint-config-next | 16.3.6 | apps/web, apps/backoffice | `next lint` removed; run via the ESLint CLI |
| eslint-plugin-react-hooks | 7.1.1 | packages/config | React Compiler rules |
| globals | 17.12.0 | packages/config | Flat-config globals |
| prettier | **3.9.9** | root | Stable formatter (ADR-20) |
| prettier-plugin-tailwindcss | 0.8.1 | apps/web, apps/backoffice | Tailwind v4 class ordering |
| vitest / @vitest/coverage-v8 | **4.1.11** / 4.1.11 | packages/*, web, backoffice, api-client | 5.0 is 3 weeks old (ADR-21) |
| vite | 8.3.0 | dev (Vitest peer) | Peer `^6||^7||^8` |
| happy-dom | 20.14.5 | web, backoffice component tests | Chosen over jsdom 30.1.1 for speed; only one DOM is used |
| @playwright/test | **1.63.0** | apps/web, apps/backoffice | Bundles Chromium CfT 153.0.8010.12 (revision 1243) |
| @types/node | 24.13.6 | root | Matches Node 24 |
| supabase (CLI) | **2.117.0** | root devDependency | Node shim plus `@supabase/cli-linux-x64` from npm; no GitHub download |
| deno | **2.1.4** (npm; binary `@deno/linux-x64-glibc`) | supabase/ tooling | Matches edge-runtime `deno` crate 2.1.4; dl.deno.land is blocked in the container |
| squawk-cli | 2.65.0 | supabase/ | Docker-free migration linter |
| @supabase/postgres-meta | **0.99.0** | supabase/ (dev) | Same pg-meta as the CLI image; Docker-free type generation |
| @electric-sql/pglite / -pgvector / -pgtap | 0.5.8 / 0.0.9 / 0.0.9 | supabase/tests (tier D) | In-process PG with pgvector and pgTAP (ADR-48) |
| eas-cli | 24.7.0 (`npx`; `eas.json cli.version ">= 24.7.0"`) | apps/mobile | engines `^20.18.3 || >=22` |
| shadcn (CLI via `pnpm dlx`) | 4.21.0 | apps/backoffice (not a runtime dependency) | Tailwind v4 plus React 19; TanStack Table v9 data-table docs |

### 4.2 Shared runtime (default catalog)

| Package | Version | Workspace | Reason |
|---|---|---|---|
| react / react-dom | **19.2.3 exactly** | all TSX workspaces (react-dom not installed in mobile) | RN 0.86.3 Fabric `reconcilerVersion` 19.2.3; one React (ADR-18) |
| @types/react / @types/react-dom | ~19.2.18 / ~19.2.7 | all TSX workspaces | Never 19.3 types (SDK 58) |
| zod | **4.6.5** | domain, validation, api-client, web, backoffice, Deno | Peers of `@hookform/resolvers` and `@anthropic-ai/sdk` accept ^4 |
| date-fns / @date-fns/tz | 4.4.0 / 1.5.0 | domain | Europe/Istanbul, 24-h, DST tests |
| @supabase/supabase-js | **2.117.1** (fallback 2.117.0) | api-client, mobile, web, backoffice, Deno | Current; Expo ships a URL polyfill |
| @tanstack/react-query | 5.103.2 | mobile, backoffice, api-client (peer) | React ^18||^19 |
| zustand | 5.0.15 | mobile, backoffice | Client state |
| react-hook-form / @hookform/resolvers | 7.88.0 / 5.9.1 | mobile, web, backoffice | Forms with zod |
| next-intl / use-intl | **4.14.6 / 4.14.6** | web and backoffice / mobile | One ICU API (ADR-24) |

### 4.3 apps/mobile (named catalog `expo`, exact to `bundledNativeModules`)

| Package | Version | Reason |
|---|---|---|
| expo | ~57.0.24 | SDK 57 = `latest`; 58 is preview |
| react-native | **0.86.3** | Not 0.87.1 (ADR-18) |
| expo-router | ~57.0.22 | Peers screens ^4.26, safe-area ≥5.4; `react-server-dom-webpack` not installed |
| react-native-reanimated / react-native-worklets | **4.5.1 / 0.10.1** | Not 4.7.0 (needs worklets 0.13) |
| react-native-gesture-handler | **~2.32.0** | Not 3.3.0 (v3 API ships with SDK 58) |
| react-native-screens / react-native-safe-area-context | ~4.26.0 / ~5.7.0 | Not safe-area 5.10.0 |
| react-native-svg | 15.15.4 | Icon pipeline (ADR-23) |
| react-native-keyboard-controller | 1.21.9 | Keyboard handling |
| @shopify/flash-list | 2.0.2 | Expo pin; virtualised lists (M§125) |
| @react-native-community/netinfo | 12.0.1 | TanStack `onlineManager` |
| expo-notifications / calendar / secure-store / audio / speech | ~57.0.20 / ~57.0.4 / ~57.0.4 / ~57.0.5 / ~57.0.3 | M§6 capabilities |
| expo-image-picker / document-picker / file-system / sharing | ~57.0.19 / ~57.0.2 / ~57.0.7 / ~57.0.21 | Capture |
| expo-dev-client / expo-updates | ~57.0.19 / ~57.0.23 | Dev builds; `runtimeVersion` fingerprint |
| @expo/fingerprint | 0.20.13 | Fingerprint policy |
| expo-background-task / expo-task-manager | ~57.0.19 / ~57.0.19 | Widget and device-calendar refresh |
| expo-apple-authentication / web-browser / linking | ~57.0.2 / ~57.0.3 / ~57.0.10 | Auth and OAuth sessions; no `expo-auth-session` |
| expo-localization / crypto / local-authentication / haptics / image / font | ~57.0.2 / ~57.0.3 / ~57.0.3 / ~57.0.3 / ~57.0.5 / ~57.0.4 | — |
| expo-splash-screen / system-ui / status-bar / constants / device / application / build-properties | ~57.0.9 / ~57.0.4 / ~57.0.1 / ~57.0.19 / ~57.0.2 / ~57.0.3 / ~57.0.21 | — |
| expo-modules-core | ~57.0.18 | Local Kotlin/Swift modules |
| react-native-mmkv + react-native-nitro-modules | **4.3.2 + 0.37.1** | AES-256 encrypted storage (ADR-54) |
| react-native-purchases | **10.10.1** | Custom paywall; no `-ui` (ADR-37) |
| @sentry/react-native | **8.27.0** (`expo.install.exclude`) | SDK 57 support is in v8 (ADR-39) |
| @react-native-google-signin/google-signin | 16.1.5 | idToken for `signInWithIdToken` |
| expo-share-intent | **8.0.1** | SDK 57 → 8.0+ (ADR-41) |
| @bacons/apple-targets | **5.0.0** | iOS widget target (ADR-40) |
| expo-speech-recognition | 57.1.0 | On-device tr-TR STT (ADR-55) |
| @expo-google-fonts/geist / @expo-google-fonts/lora | 0.4.2 / 0.4.2 | Static TTFs (Geist 100–900, Lora 400–700, italics) |
| @material-symbols/svg-400 | 0.47.5 (dev) | Icon codegen input (ADR-23) |
| @tanstack/react-query-persist-client / @tanstack/query-async-storage-persister | 5.103.2 / 5.103.2 | The sync persister is deprecated |
| jest-expo / jest | ~57.0.5 / **29.7.0** | Mobile unit tests |
| @testing-library/react-native / test-renderer | 14.0.1 / 1.3.0 | RNTL 14 peers |
| @react-native/jest-preset | 0.86.3 | Peer of jest-expo and RN |
| **Not installed** | react-native-web, react-dom, react-server-dom-webpack, NativeWind, Unistyles, Tamagui, expo-widgets, react-native-purchases-ui, react-native-android-widget, AsyncStorage for secrets, Detox, expo-auth-session, i18next | ADR-18/22/24/37/40/47/54 |

### 4.4 apps/web

| Package | Version | Reason |
|---|---|---|
| next | **16.3.6** (fallback 16.3.5) | Turbopack default, `proxy.ts`, `cacheComponents` (ADR-52) |
| babel-plugin-react-compiler | 1.0.0 | `reactCompiler: true` |
| tailwindcss / @tailwindcss/postcss | 4.3.3 / 4.3.3 | `@theme` from `tokens.css` |
| next-intl | 4.14.6 | tr default, en |
| @sentry/nextjs | 10.75.2 | Peer `next ^16` |
| @supabase/ssr | 0.12.7 | Data-deletion OTP identity; peer supabase-js ^2.114 |
| clsx / tailwind-merge / class-variance-authority | 2.1.1 / 3.7.0 / 0.7.1 | Styling utilities |
| @t3-oss/env-nextjs | 0.13.11 | Server/client env split (M§107) |
| server-only | 0.0.1 | Guards server modules |
| Fonts | `next/font/google` Geist and Lora, `subsets: ['latin','latin-ext']` | Turkish glyphs |

### 4.5 apps/backoffice (in addition to 4.4)

| Package | Version | Reason |
|---|---|---|
| radix-ui | 1.6.7 | shadcn primitives; peer react ^19 |
| @tanstack/react-table | **9.2.4** | v9 API (`useTable({features})`); no `useLegacyTable` |
| @tanstack/react-virtual | 3.14.13 | Large tables |
| recharts | 3.10.1 | Metrics charts |
| cmdk / sonner / next-themes / nuqs / react-day-picker / tw-animate-css | 1.1.1 / 2.0.8 / 0.4.6 / 2.10.1 / 10.0.1 / 1.4.0 | Palette (M§69), toasts, dark mode (M§72), URL table state, dates, animation |
| @supabase/ssr | 0.12.7 | Admin cookie on the `admin.` subdomain; `aal2` checked server-side |

### 4.6 packages/*

| Package | Dependencies | Rule |
|---|---|---|
| design-tokens | none (build emits `tokens.ts`, `tokens.css`, `tokens.json`) | Single token source |
| domain | zod 4.6.5, date-fns 4.4.0, @date-fns/tz 1.5.0 | Deno-safe; explicit `.ts` imports |
| validation | zod 4.6.5 | Deno-safe |
| api-client | @supabase/supabase-js 2.117.1; peer @tanstack/react-query 5.103.2 | Generated `database.types.ts` |
| i18n | ICU JSON + typed augmentation | No React |
| ui | peers react 19.2.3, react-native 0.86.3, react-native-svg 15.15.4, reanimated 4.5.1 | RN only |
| config | tsconfig bases, ESLint 9 flat configs, Prettier 3.9.9 config | — |

### 4.7 supabase/functions (Deno 2.1.4; one `deno.json` per function)

| Import | Version | Reason |
|---|---|---|
| `npm:@supabase/supabase-js` | 2.117.1 | DB and Storage access |
| `npm:@supabase/server` | 1.8.0 | `withSupabase` auth modes (`user`, `secret:automations`, `none`) |
| `jsr:@hono/hono` | 4.13.8 | Router, `basePath('/<fn>')`, SSE (ADR-26) |
| `npm:zod` | 4.6.5 | Shared schemas |
| `npm:@anthropic-ai/sdk` | 0.128.0 | `messages.parse` + `zodOutputFormat` via `output_config.format` |
| `npm:openai` | 7.23.0 | Fallback LLM, DR embeddings, STT/TTS adapters |
| `npm:jose` | 6.2.12 | OIDC JWT verification (Pub/Sub), SIWA and Entra client assertions |
| `jsr:@std/assert` / `jsr:@std/testing` | 1.0.19 / 1.0.20 | Deno tests |
| Voyage AI | raw `fetch` (no SDK; `voyageai` 0.4.0 depends on node-fetch) | ADR-45 |

### 4.8 Native and infrastructure

| Item | Value | Source / reason |
|---|---|---|
| iOS deployment target | **16.4** | Expo bare template Podfile, `ExpoModulesCore.podspec` |
| Swift | 6.0 | `ExpoModulesCore` `swift_version` |
| Xcode / CocoaPods | 16+ / 1.16.2 | `@bacons/apple-targets` requirement |
| Android compileSdk / targetSdk / minSdk | 36 / 36 / 24 | RN 0.86.3 `libs.versions.toml` |
| AGP / Kotlin / NDK / build-tools | 8.12.0 / 2.1.20 / 27.1.12297006 / 36.0.0 | Same |
| Hermes / New Architecture / edge-to-edge | Hermes V1 default, `newArchEnabled=true`, `edgeToEdgeEnabled=true` | Expo bare template |
| androidx.glance:glance-appwidget | 1.1.1 (stable) | Confirmed against Google Maven in CI; dl.google.com is blocked in the container |
| Postgres (hosted and CI) | 17 (`supabase/postgres:17.6.1.167`) | CLI `config.toml` `major_version = 17` |
| Supabase local stack images | edge-runtime v1.74.3, gotrue v2.196.0, postgrest v16.2, postgres-meta v0.99.0, storage-api v1.72.1, realtime v2.130.0, pg_prove 3.36 | CLI 2.117.0 Dockerfile |
| Tier-C Postgres (container) | PG16 + pgvector 0.6.0-1, pgTAP 1.3.2-2, pg_prove 3.36-2, pg_cron 1.6.2-1 | apt, archive.ubuntu.com (ADR-48) |
| Maestro CLI | **2.10.0** (Java 17+) | ADR-47 |
| Chrome for Testing | 153.0.8010.12 (storage.googleapis.com), fallback preinstalled Chromium 141.0.7390.37 at `/opt/pw-browsers` | Playwright 1.63 needs revision 1243; cdn.playwright.dev is blocked |

### 4.9 Service and model identifiers (configuration values, not packages)

| Purpose | Identifier | Where configured |
|---|---|---|
| T1 small | `claude-haiku-4-5-20251001` | `ai_model_config` (ADR-43) |
| T2 large | `claude-sonnet-5` | `ai_model_config` |
| T3 escalation | `claude-opus-5-5` (flag `ai.model.opus_escalation`) | `ai_model_config` |
| Fallback LLMs | `gpt-5.6-luna`, `gpt-5.6-terra` | `ai_model_config` |
| Embeddings | `voyage-4` (documents), `voyage-4-lite` (queries), 1024-d; DR `text-embedding-3-small` (`dimensions: 1024`) | `ai_model_config` (ADR-45) |
| STT fallback | `gpt-transcribe`, Deepgram Nova-3 | `ai_model_config` (ADR-55) |
| TTS premium | Azure tr-TR Neural, `gpt-4o-mini-tts`, ElevenLabs (flag `voice.tts_premium`) | `ai_model_config` |
| Excluded | `claude-fable-5-1` (Covered Model) | Check constraint (ADR-44) |

---

## 5. Container & CI verification boundary

### 5.1 Container facts (execution sandbox, 2026-09-23)

| Item | Fact |
|---|---|
| OS / user / resources | Ubuntu 24.04.4 LTS, root, 4 vCPU, 15 GB RAM, ~30 GB free |
| Node | 22.22.2 default (`/opt/node22`); 20.20.2 also present; npm 10.9.7; global pnpm 10.33.0 (corepack fetches the pinned 11.27.1) |
| Docker | Client 29.3.1 present; **daemon not running** (no `/var/run/docker.sock`); dockerd, containerd and runc binaries exist |
| Postgres | PG16 binaries; cluster `16/main` down; no pgvector or pgTAP until the apt install; pg_net unavailable |
| Deno | Not installed; npm `deno@2.1.4` works |
| Java | OpenJDK 21.0.10 |
| Mobile SDKs | No Android SDK, emulator or adb; no Xcode; `dl.google.com` blocked (Gradle Android impossible) |
| Browsers | Playwright Chromium 141 at `/opt/pw-browsers`; CfT 153 downloadable from storage.googleapis.com |
| Reachable | registry.npmjs.org, jsr.io, raw.githubusercontent.com, github.com release downloads, www.googleapis.com, fonts.googleapis.com, fonts.gstatic.com, storage.googleapis.com, archive.ubuntu.com, repo1.maven.org, api.anthropic.com |
| Blocked | api.expo.dev, expo.dev, exp.host, api.supabase.com, supabase.com, graph.microsoft.com, api.openai.com, api.revenuecat.com, sentry.io, vercel.com, deno.land, esm.sh, unpkg.com, cdn.playwright.dev, get.maestro.mobile.dev, pnpm.io, nextjs.org |

### 5.2 Where each check runs

| Check | Command / tool | Container | CI (GitHub Actions) | EAS / owner |
|---|---|---|---|---|
| Install | `pnpm install --frozen-lockfile` | ✅ | ✅ | — |
| Lint + format | `turbo run lint`, `prettier --check` | ✅ | ✅ | — |
| Typecheck | `turbo run typecheck` (tsc 6.0.x) | ✅ | ✅ | — |
| Unit (pure TS, web, backoffice) | Vitest 4.1.11 | ✅ | ✅ | — |
| Unit (mobile, ui) | jest-expo 57 | ✅ | ✅ | — |
| DB tier C | PG16 + shim + pgTAP (`pg_prove`) | ✅ (after the apt install) | optional | — |
| DB tier D | PGlite in Vitest | ✅ | ✅ | — |
| DB tier A (authoritative) | `supabase start` → `db reset` → `test db` → `db lint` | ❌ (no Docker daemon; tier B best effort only) | ✅ | — |
| Type generation | postgres-meta 0.99.0 (C) / `supabase gen types --local` (A) + diff | ✅ | ✅ | — |
| Migration lint | squawk 2.65.0 + reset from zero | ✅ (C) | ✅ (A) | — |
| Edge static and unit | `deno check` / `deno lint` / `deno test` (2.1.4) | ✅ | ✅ | — |
| Edge serve / integration | `supabase functions serve` + integration suite | ❌ | ✅ | — |
| Web and backoffice builds | `next build` ×2 | ✅ | ✅ | Vercel |
| Web E2E | Playwright 1.63 (CfT 153 or Chromium 141) | ✅ (`public-api` reached through a local stub server) | ✅ against tier A | — |
| Backoffice E2E | Playwright: login + MFA, modules | ❌ (needs GoTrue + `admin-api`; only if tier B works) | ✅ | — |
| Mobile dependency checks | `expo install --check`, `expo-doctor` (`EXPO_OFFLINE=1` in the container) | ✅ (offline subset) | ✅ (full) | — |
| Mobile bundle smoke | `expo export --platform ios,android` | ✅ | ✅ | — |
| Prebuild / plugin validation | `expo prebuild --clean --no-install` into a temp dir | ✅ | ✅ | — |
| Native builds | Gradle / Xcode | ❌ | Android possible | ✅ EAS Build (**External credential required:** `EXPO_TOKEN`) |
| Mobile E2E | Maestro 2.10.0 | ❌ | ✅ Android emulator (KVM) | ✅ iOS via EAS Workflows |
| Secret and bundle scan | grep over `.next`, `dist`, repository | ✅ | ✅ | — |
| Quality gate | banned-marker grep, RLS-forced assertion, empty-handler lint, matrix diff | ✅ | ✅ | — |
| Remote deploys | `db push`, `functions deploy --use-api`, Vercel, EAS Submit | ❌ | ✅ protected, manual approval | ✅ owner (**External credential required:** Supabase access token, DB password, Vercel token) |
| Live provider calls | Google, Graph, RevenueCat, Anthropic, OpenAI, Voyage, Expo Push | ❌ (blocked, or credentials absent) | contract tests on recorded fixtures only | ✅ owner sandbox runs per M§153 (fresh install, sign in, onboarding, connect, first sync, first briefing, insight, approval, provider write, notification, purchase/restore, deletion) |
| Sentry source maps | `@sentry/cli` upload | ❌ | ✅ (with token) | — |

### 5.3 Reporting rule

`docs/FINAL_IMPLEMENTATION_REPORT.md` states, per check, where it actually ran: container (tier C/D), CI (tier A) or owner/EAS. It never reports a CI-only or owner-only check as verified in the container. Every feature row names its external-credential dependency (plan §22).

---

## Proposed additions to the canonical registry

The records above use the following names, which are not yet in the canonical spine. They are proposed for adoption verbatim. Rows that restate a name owned by another document (R-20) say so, and that document's spelling wins.

| Category | Proposed addition | Introduced in |
|---|---|---|
| ADR IDs | ADR-16 … ADR-55 (titles as in §1) | this document |
| Package scope | Workspace package names `@da/design-tokens`, `@da/ui`, `@da/domain`, `@da/validation`, `@da/api-client`, `@da/i18n`, `@da/config` | ADR-01 |
| Turbo tasks | `lint`, `typecheck`, `test`, `build`, `db:test`, `functions:test`, `mobile:check`, `e2e:web`, `e2e:backoffice` | ADR-01, ADR-15 |
| CI jobs / workflows | Jobs `install`, `lint`, `typecheck`, `unit`, `db`, `functions`, `integration`, `build-web`, `build-backoffice`, `migrations`, `e2e-web`, `e2e-backoffice`, `mobile-checks`, `secret-scan`, `quality-gate`; workflows `deploy-supabase`, `rotate-siwa-secret` | ADR-15, ADR-53 |
| Quality-gate files | `scripts/quality-gate/banned-markers.txt` (the R-17 pattern list, both locales) and the allow-list file `quality-gate.allow` for negated fair-use text (R-17) | ADR-14, ADR-15 |
| Test tiers | Tier **B** (best-effort Docker in container) and tier **D** (PGlite); shim path `supabase/tests/shim/000_supabase_compat.sql` | ADR-48 |
| SQL signatures | `private.scheduler_tick(p_now timestamptz default now()) returns jsonb`; `public.claim_jobs(p_worker_id text, p_types job_type[], p_limit int default 10, p_lease_seconds int default 120)`, executable only by `service_role`; `private.poke_worker(p_reason text default 'cron')`. DATABASE_AND_RLS_PLAN §6.2–§6.3 owns these signatures (R-20). | ADR-27, ADR-28 |
| Cron job names | `da_scheduler_tick` (`* * * * *`), `da_worker_poke` (`15 seconds`), `da_push_receipts` (`*/5 * * * *`), `da_health_check` (`*/5 * * * *`), `da_reconciliation` (`7 */6 * * *`), `da_retention` (`30 2 * * *`), `da_billing_reconcile` (`45 3 * * *`), `da_cron_housekeeping` (`15 3 * * *`). DATABASE_AND_RLS_PLAN §9 owns them; 8 is the concurrency limit, and metrics rollups run inside `scheduler_tick`. | ADR-28 |
| Notification reason code | `late_delivery` (push suppressed when >90 min late) | ADR-28 |
| Idempotency key formats | `approval:{id}:v{payload_version}` (approval), `approval_execute:{id}:v{payload_version}` (job), `reconciliation:{account}:{utc_6h_bucket}`, `credential_reencrypt:{utc_date}`, and the notification dedupe key `'{category}:{entity_type}:{entity_id}:{local_date}'`, alongside the canonical `briefing:{user}:{kind}:{local_date}`. DATABASE_AND_RLS_PLAN §1.5/§6.2 owns the catalogue. | ADR-09, ADR-27 |
| `oauth_credentials` columns | `provider`, `token_kind` (`refresh`, `access` or `apple_siwa_refresh`), `key_version`, `iv`, `ciphertext`, `aad_hash`, `access_expires_at`, `scope_snapshot`, `rotated_at`; nullable `connected_account_id` for `apple_siwa_refresh` (AAD `v1\|user_id\|apple_device\|apple_siwa_refresh`). DATABASE_AND_RLS_PLAN §4.2 owns them. | ADR-29 |
| Job type | `credential_reencrypt`: the daily token re-encryption sweep, enqueued by the 00:07 UTC `da_reconciliation` run | ADR-28, ADR-29 |
| `memory_chunks` columns | `embedding_model text` (e.g. `voyage-4@1024`); DR column `embedding_dr vector(1024)` used only during a disaster-recovery re-embed | ADR-45 |
| AI pricing source | Table `ai_model_prices (provider, model, in_usd_per_mtok, out_usd_per_mtok, cache_read_usd_per_mtok, cache_write_5m_usd_per_mtok, cache_write_1h_usd_per_mtok, effective_from)` feeding `ai_requests.cost_usd_micros` | ADR-08, ADR-43 |
| Routing profile plumbing | Enum `routing_profile` (`balanced`, `lean`; R-18); column `ai_model_config.profile`, unique `(profile, role, feature)`; `plan_limits` key `ai_routing_profile` holding a jsonb string (R-22), seeded `free` → `"lean"` and `pro` → `"balanced"`; product default `balanced` | ADR-43, ADR-46 |
| Lean-profile eval thresholds | triage macro-F1 ≥0.85 and within 0.02 of `balanced`; grounding verified-rate ≥0.95; zero approvals in the injection eval | ADR-46 |
| DB constraint | `ai_model_config` check trigger rejecting `claude-fable-%` and `claude-mythos-%` in `primary_target`, `fallback_targets` and `escalation_target` (R-02) | ADR-44 |
| Feature flags | Exactly the R-10 keys: `ai.global.enabled`, `ai.provider.{anthropic,openai,voyage}.enabled`, `ai.feature.<ai_feature>` (vocabulary owned by AI_PIPELINE_PLAN, R-20) plus `ai.feature.briefing_polish` (R-05), `ai.model.large.enabled`, `ai.model.opus_escalation`, `ai.batch.enabled`, `ai.backfill.enabled`, `ai.budget.org_daily_usd`, `voice.stt_server`, `voice.tts_premium`, and the product flags `feature.{midday,evening,voice,meeting_prep,capture,android_ni,weekly_review,new_ai_model}`. The Android NI package list is the `catalog` payload of `feature.android_ni`. | ADR-08, ADR-42, ADR-55 |
| Env / secret names | INTEGRATION_PLAN §15 owns every name (R-20). Used in this document: `APP_ENV` (`development`, `preview`, `e2e` or `production`), `DEMO_MODE`, `ALLOW_DEMO_IN_PRODUCTION`, `EXPO_PUBLIC_DEMO_MODE`, `EXPO_ACCESS_TOKEN`, `EXPO_TOKEN`, `API_PUBLIC_BASE_URL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `VOYAGE_API_KEY`, `REVENUECAT_API_V2_SECRET_KEY`, `REVENUECAT_WEBHOOK_AUTH`, `GOOGLE_PUBSUB_PUSH_AUDIENCE`, `GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT`, `MICROSOFT_CERT_PRIVATE_KEY`, `MICROSOFT_CERT_THUMBPRINT_S256`, `APPLE_SIWA_PRIVATE_KEY`, `APPLE_SIWA_KEY_ID`, `APPLE_TEAM_ID`, `EXPO_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` (one value per Next app), `SENTRY_DSN` (functions), `SENTRY_AUTH_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `TOKEN_ENC_KEY_V{n}`, `TOKEN_ENC_ACTIVE_VERSION`, `WEBHOOK_HMAC_SECRET`, `CRON_SECRET`. There is no embeddings-provider switch: embeddings are Voyage only (R-01). | ADR-26, ADR-36, ADR-39, ADR-49, ADR-51, ADR-53 |
| Supabase named secret key | `automations` (used by `worker` / `health` via pg_net; its value is held in Vault `da_cron_secret`, and in `CRON_SECRET` for CI and scripts) | ADR-51 |
| Domains | `dijitalasistan.app` (web), `admin.dijitalasistan.app` (backoffice), `api.dijitalasistan.app` (Supabase custom domain, production); staging on `<ref>.supabase.co` | ADR-35, ADR-53 |
| OAuth redirect paths | `/functions/v1/oauth/google/callback`, `/functions/v1/oauth/microsoft/callback` | ADR-35 |
| Hosting | Vercel projects `da-web`, `da-backoffice` (region `fra1`); Supabase projects `staging`, `production` in `eu-central-1` | ADR-53 |
| Bundle IDs | `com.dijitalasistan.app.widget`, `com.dijitalasistan.app.share-extension` (the expo-share-intent default) | ADR-40, ADR-41, ADR-53 |
| Local native module | `apps/mobile/modules/da-tts` (synth-to-file TTS) | ADR-55 |
| Functions observability | `supabase/functions/_shared/observability/sentry.ts` (fetch-based envelope adapter) | ADR-39 |
| Android notification channels | The R-12 set, with Turkish names: `briefings` "Brifingler" (morning, midday, evening, weekly), `critical_email` "Önemli e-postalar", `meetings` "Toplantılar", `deadlines` "Son tarihler", `follow_up` "Takipler", `life_intel` "Kişisel gelişmeler", `approvals` "Onay bekleyenler", `reminders` "Hatırlatıcılar" (device-local smart reminders), `account` "Hesap ve bağlantılar", `phone_digest` "Telefon bildirimleri özeti" (Android NI only). Every channel uses `lockscreenVisibility = PRIVATE`. | ADR-10, ADR-36 |
| i18n keys and copy | `demo.banner` "Demo modu — örnek veriler gösteriliyor."; storage line (R-15) "Mail içeriğinin tamamı saklanmaz; yalnızca özetler, kısa alıntılar ve analiz sonuçları saklama süren boyunca tutulur."; First Analysis footer (R-15) "Son 72 saat analiz edildi. Mail içeriğinin tamamı saklanmaz."; Android NI line (R-15) "Bildirim içerikleri cihazında işlenir; yalnızca çıkarılan bilgiler (ör. kargo durumu, tutar, tarih) hesabına kaydedilir. Doğrulama kodları ve güvenlik uygulamaları her zaman hariç tutulur."; voice hint (R-03) "Onaylamak için karta dokun."; notification settings line (R-14) "Sadece önemli olduğunda haber veririz."; cross-border line "AI analizi ABD'deki alt işleyicilerimizde yapılır." | ADR-05, ADR-09, ADR-10, ADR-31, ADR-42, ADR-49 |
| Design token | `ink/tertiary-strong` value `#6F6C66` (4.76:1 on `bg`), per the design-system audit | ADR-03 |
| API error code | `PROVIDER_SCOPE_MISSING` (HTTP 424, `details.upgrade` = `ScopeUpgrade`) from `POST /approvals/:id/approve`. API_CONTRACTS owns it (R-20); it is listed because ADR-33 depends on it. | ADR-33 |
| Admin first factor | 6-digit email one-time code (no magic link, no password) as the first factor, mandatory TOTP as the second (`aal2`); dedicated admin identities (`app_metadata.da_kind='admin'`) that `api` and `public-api` reject (R-08) | ADR-30 |
| Analytics retention | Raw `analytics_events` pruned after 400 days (DATABASE_AND_RLS_PLAN §6.4); daily rollups kept | ADR-38 |
| Realtime | Supabase Realtime not used (R-19): the `supabase_realtime` publication stays empty (pgTAP assertion); freshness via TanStack Query invalidation and polling | ADR-25 |

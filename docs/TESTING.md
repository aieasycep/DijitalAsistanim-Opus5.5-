# Testing

Documented at `ec14e92`. How the repository is tested as built: the tiers, the commands, where each check runs (container, CI, EAS, owner), the coverage gates, the flake policy and the E2E suites. Test IDs and the full inventory are in [TEST_PLAN.md](TEST_PLAN.md); the counts of the final run are in the final implementation report.

**Where things run.** *Container*: the Linux development container (no Docker daemon, no Android SDK, no Xcode). *CI*: GitHub Actions ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml), [`mobile-e2e.yml`](../.github/workflows/mobile-e2e.yml)). *EAS*: Expo Application Services workflows ([`apps/mobile/.eas/workflows`](../apps/mobile/.eas/workflows)). *Owner*: manual runs on real devices and accounts with credentials.

## Tiers

| Tier | Tool | Scope | Location | Container | CI | EAS / owner |
| --- | --- | --- | --- | --- | --- | --- |
| T1 unit (TypeScript) | Vitest 4 with V8 coverage | `@da/domain`, `@da/validation`, `@da/i18n`, `@da/api-client`, `@da/design-tokens` | `packages/*/test` | ✓ | `unit` | — |
| T1 unit (web, backoffice) | Vitest 4 + happy-dom + Testing Library | Server utilities, proxies, server-action wrappers, components, pages | `apps/web/test`, `apps/backoffice/src/**/__tests__` | ✓ | `unit` | — |
| T1m unit (React Native) | jest-expo + React Native Testing Library | `@da/ui` components; the app's services, screens, navigation guards, storage, notification router, journeys, accessibility and text expansion | `packages/ui/test`, `apps/mobile/test` | ✓ | `unit` | — |
| Scripts and config | `node --test` | Repository scripts (generators, quality gate, deploy checks, E2E harness, Maestro lint, integration runner helpers); ESLint rules of `@da/config` | `scripts/**/*.test.ts`, `packages/config/test` | ✓ | `unit` | — |
| T2 database (pgTAP) | Tier C: PostgreSQL 16 + pgvector + pgTAP + pg_cron with the compatibility shim. Tier A: `supabase start` (PostgreSQL 17) + `supabase test db` + `supabase db lint` | Schema, RLS and grants, RPCs, state machines, idempotency, audit chain, retention, `admin_api`, cron, storage, threat suites | `supabase/tests/database` | tier C | `db` (tier A, authoritative) | — |
| T3 Edge unit | Deno 2.1.4, no network permission | Every function's handlers and `_shared` modules with injected fetch, clock and database; security suites; fixture AI evals | `supabase/functions/**` (`*.test.ts`) | ✓ | `functions` | — |
| T4 integration | Deno against a running stack with the mock provider servers | OAuth, sync, AI adapters and failures, approvals and provider writes, RevenueCat, notifications, jobs, privacy jobs, E2E seeds | `supabase/tests/integration` | tier C+ (PostgREST 12 + an HS256 gateway; suites needing GoTrue or Storage are skipped) | `integration` (tier A: real Auth, Kong) | — |
| T5 contract | zod schemas of `@da/validation`, shared by Vitest, Deno and the Playwright mocks | Route requests and responses, AI outputs, provider shapes, widget snapshot, analytics, env | inside T1 and T3 | ✓ | `unit`, `functions` | — |
| T6 web and backoffice E2E | Playwright 1.63, Chromium | Web pages, SEO, headers, deletion flow, referral landing; backoffice modules, RBAC, session, security | `apps/web/e2e`, `apps/backoffice/e2e` | ✓ (preinstalled Chromium) | `web`, `backoffice` | — |
| T7 mobile E2E | Maestro 2.10.0 | M§102 flows, acceptance flows A–J, screen-map flows, security flows | `apps/mobile/.maestro` | ✗ (no emulator) | `Mobile E2E` (Android emulator API 35) | EAS: iOS simulator; Android on demand |
| T8 native | Pure-Kotlin JUnit (JVM) | Android notification-intelligence rules: OTP drop, package rules, signal extraction | `apps/mobile/modules/notification-intelligence/{android/src/test,jvm-test}` | ✗ (needs Gradle) | `mobile` | Kotlin and Swift compile of the modules and extensions: EAS builds |
| Static and security | ESLint 9 (custom `da/*` rules), `tsc`, Prettier, `deno lint` + guard scan, squawk, quality gate, bundle secret scan, env split | Whole repository | — | ✓ | `lint`, `typecheck`, `functions`, `db`, `security` | — |

Rules that hold across tiers:

- No test reaches a real provider: Deno runs without network permission, integration suites talk to the local mock servers (`supabase/functions/_shared/testing/mock-providers`), Playwright uses contract stubs (`apps/web/e2e/stub`, `apps/backoffice/e2e/mock-server.ts`) and Maestro runs against a local or staging stack in demo mode with the fixture AI provider.
- Time-dependent tests inject a clock; the mobile app has a pinnable clock (`src/lib/clock.ts`), Edge code takes `now` as a dependency, and SQL time travel is `scheduler_tick(p_now)`.
- React Native components run only under Jest, never Vitest.

## Commands

| Command | Does | Needs |
| --- | --- | --- |
| `pnpm test` | `turbo run test`: every workspace suite with its coverage gate | — |
| `pnpm test:scripts` | `node --test "scripts/**/*.test.ts"` | — |
| `pnpm lint` · `pnpm exec eslint .` | Workspace lint · root scripts lint | — |
| `pnpm typecheck` · `pnpm exec tsc -p tsconfig.json` | Workspace typecheck · root scripts typecheck | — |
| `pnpm format:check` | Prettier check (`docs/` is excluded) | — |
| `pnpm quality-gate` | Banned markers, retired canonical names and banned product claims (R-17) in `apps`, `packages`, `supabase`, `scripts`, `.github`; QG-16b compares the `apps/mobile/app` route files with the mobile No-Dead-Action inventory (DELIVERY_CHECKLIST §4.2–§4.5, T-12.07; screen IDs from SCREEN_AND_FLOW_MAP, exceptions in `scripts/quality-gate/route-screens.map`) and resolves every route-like Target; `--self-test` expects one finding per fixture | — |
| `pnpm db:test:c` | Tier C: fresh database, shim, migrations, seed-block check, pgTAP, plpgsql lint | local PostgreSQL 16 (`bash scripts/dev/bootstrap-container.sh`); `DA_TEST_DB` picks the database |
| `pnpm db:test` | Tier A: `supabase start`, `db reset`, pgTAP, `db lint` | Docker |
| `pnpm db:lint` · `pnpm db:types:check` · `pnpm db:reset-twice` · `pnpm db:enum-parity` | squawk · generated types match the migrations · tier C twice from zero · enum parity with `@da/domain` | tier C database |
| `pnpm functions:imports --check` · `functions:check` · `functions:lint` · `functions:test` · `functions:coverage` | Generated import maps · `deno check` · `deno lint` + guards · Deno suite · Deno suite with the `_shared` coverage gate | — |
| `pnpm ai:eval` | Prompt-seed drift check + the fixture eval suite (`_shared/ai/evals`) | — |
| `pnpm ai:eval:live` | The `ai_eval` gate suites against a project's configured routes with the real providers, recorded on the prompt versions ([AI_PIPELINE.md](AI_PIPELINE.md#evaluation)); `AI_EVAL_SUITES`, `AI_EVAL_DRY_RUN` | `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and the routes' provider keys, else exit 2 "External credential required" |
| `pnpm test:integration:c` · `pnpm test:integration` | Integration suites on tier C+ · on tier A | tier C database · running local Supabase stack |
| `pnpm --filter @da/web e2e:web` · `pnpm e2e:backoffice` | Playwright web · backoffice (each builds its app first) | Chromium (`PLAYWRIGHT_CHROMIUM_EXECUTABLE`, or the preinstalled build for the backoffice) |
| `pnpm mobile:check` | `expo install --check`, iOS and Android bundle export, prebuild smoke | — |
| `pnpm --filter @da/mobile ni:test` | Kotlin JVM tests of the notification-intelligence rules | Java 17, Gradle |
| `bash scripts/e2e/start-stack.sh` then `bash scripts/e2e/run-maestro-android.sh` | Maestro on Android against the local tier-A stack | Docker, Android SDK and emulator, `E2E_APK` |
| `pnpm scan:bundles` | Env-split check + secret scan of the web and backoffice `.next/static` and the exported mobile bundles | built bundles |

## Where each check runs

| CI job ([`ci.yml`](../.github/workflows/ci.yml), every push and pull request) | Runs |
| --- | --- |
| `lint` | Root ESLint, `pnpm lint`, `pnpm format:check`, `pnpm quality-gate` |
| `typecheck` | Root `tsc`, `pnpm typecheck` |
| `unit` | `pnpm test:scripts`, `pnpm test` (all coverage gates) |
| `mobile` | `pnpm mobile:check`; the notification-intelligence Kotlin tests |
| `functions` | Import-map check, `functions:check`, `functions:lint`, `functions:coverage` |
| `db` | `pnpm db:lint`; tier A (`scripts/db/tier-a.sh`: reset, pgTAP, `supabase db lint`); generated types checked against the live stack |
| `integration` | `supabase start`, then `pnpm test:integration` (tier A); function logs uploaded on failure |
| `web` | Web Playwright (builds the app) |
| `backoffice` | Backoffice Playwright (`bo-contract`, builds the app) |
| `security` | `pnpm secret-scan` (gitleaks over the full history), web and backoffice builds, mobile export, `pnpm scan:bundles` |

| Other pipeline | Trigger | Runs |
| --- | --- | --- |
| [`mobile-e2e.yml`](../.github/workflows/mobile-e2e.yml) `e2e-mobile-android` | pull requests, nightly, manual | Tier-A stack with `APP_ENV=e2e`, demo mode, fixture AI and a fixed seeding anchor ([`scripts/e2e/start-stack.sh`](../scripts/e2e/start-stack.sh)); `expo prebuild` + Gradle release build of the `e2e` APK; emulator API 35 (`tr-TR`, `Europe/Istanbul`); Maestro on one emulator over the `android` tag; JUnit, screenshots and logcat as artefacts, and the failed flows' reasons, the harness log and logcat errors printed in the job log |
| EAS [`e2e-ios.yml`](../apps/mobile/.eas/workflows/e2e-ios.yml) | push to `main`, nightly | `e2e` simulator build + Maestro over the `ios` tag against the staging E2E project (harness in staging mode). External credential required: `EXPO_TOKEN` and the staging secrets |
| [`security-nightly.yml`](../.github/workflows/security-nightly.yml) | nightly, manual | `pnpm security:audit` (high/critical advisories against `security/audit-allowlist.json`, expiry enforced), CodeQL `security-extended` with `scripts/security/sarif-gate.ts` (security-severity ≥ 7.0), ZAP baseline against the web and backoffice builds (`e2e/dast.spec.ts` with `DA_DAST=1`); must be green before a release tag |
| EAS [`e2e-android.yml`](../apps/mobile/.eas/workflows/e2e-android.yml) | manual | The Android equivalent on EAS |
| EAS [`build-preview.yml`](../apps/mobile/.eas/workflows/build-preview.yml) | push to `main` | Internal preview builds for both platforms |
| [`deploy-supabase.yml`](../.github/workflows/deploy-supabase.yml) | manual, `production` environment | Deploy dry run or deploy ([DEPLOYMENT.md](DEPLOYMENT.md)) |
| [`ai-eval.yml`](../.github/workflows/ai-eval.yml) | nightly 01:37 UTC, manual (`suites`, `dry_run`) | `staging` environment: `pnpm ai:eval` (fixture baseline), then `pnpm ai:eval:live` against the staging routes; fails with "External credential required" and the names while `SUPABASE_URL` / `SUPABASE_SECRET_KEY` / provider keys are missing, and on a failed gate |
| [`rotate-siwa-secret.yml`](../.github/workflows/rotate-siwa-secret.yml) | 1 Jan, 1 Jun, 1 Nov 06:41 UTC; manual (dry run by default) | `production` environment: mints the Apple web client secret and sets it on the hosted Auth config ([DEPLOYMENT.md](DEPLOYMENT.md#sign-in-with-apple-client-secret)) |

| Only the owner can verify | How |
| --- | --- |
| Live provider behaviour (Google, Microsoft, Apple, RevenueCat sandbox, Expo push, email delivery) | The owner sandbox checklist in the final implementation report, with real accounts |
| AI quality against real models, STT word error rate | The nightly `ai-eval` run once the `staging` credentials exist (six prompt-keyed gate suites); the retrieval, grounding, claims and speech sets against real models remain a manual run |
| Native rendering and OS grants: widgets per family and theme, share extension under memory pressure, notification listener grant and rebind, exact alarms and the Time Sensitive setting, on-device voices and offline speech models, background scheduling and the data-only `device_refresh` push, lock-screen controls, the iOS system paste control and tab bar blur | Physical iPhone and Android devices ([KNOWN_PLATFORM_LIMITATIONS.md](KNOWN_PLATFORM_LIMITATIONS.md) marks each item "device") |

## Coverage

Every workspace suite runs with coverage on and fails below its threshold. The thresholds live in the configs:

| Workspace | Lines / branches / functions | Config |
| --- | --- | --- |
| `@da/domain` | 95 / 90 / 95 | [`packages/domain/vitest.config.ts`](../packages/domain/vitest.config.ts) |
| `@da/validation` | 95 / 90 / 95 | [`packages/validation/vitest.config.ts`](../packages/validation/vitest.config.ts) |
| `@da/i18n` | 95 / 90 / 95 | [`packages/i18n/vitest.config.ts`](../packages/i18n/vitest.config.ts) |
| `@da/design-tokens` | 100 / 95 / 100 | [`packages/design-tokens/vitest.config.ts`](../packages/design-tokens/vitest.config.ts) |
| `@da/api-client` | 85 / 75 / 85 (generated `database.types.ts` excluded) | [`packages/api-client/vitest.config.ts`](../packages/api-client/vitest.config.ts) |
| `@da/ui` | 85 / 75 / 85 (generated icons excluded) | [`packages/ui/jest.config.cjs`](../packages/ui/jest.config.cjs) |
| `apps/web` | 80 / 70 / 80 (generated icons excluded) | [`apps/web/vitest.config.ts`](../apps/web/vitest.config.ts) |
| `apps/backoffice` | 80 / 70 / 80 (test harness, generated icons and `*.d.ts` excluded) | [`apps/backoffice/vitest.config.ts`](../apps/backoffice/vitest.config.ts) |
| `apps/mobile` | Target 75 / 65 / 75 (TEST_PLAN §16); the enforced value is a regression floor | [`apps/mobile/jest.config.js`](../apps/mobile/jest.config.js) |
| `supabase/functions/_shared` | lines ≥ 80 | `SHARED_LINE_THRESHOLD` in [`scripts/functions/deno-tasks.ts`](../scripts/functions/deno-tasks.ts) (`pnpm functions:coverage`, CI `functions`) |

**Mobile floor.** `apps/mobile/jest.config.js` collects `src/**` and `app/**` and sets `coverageThreshold` below the §16 target: it is a floor that may only go up, so a change that lowers coverage fails, while the populated and handler states of the remaining screens are covered by further screen tests. When the measured values reach 75/65/75, the threshold is set to the target.

`@da/config` (`node --test`) and the scripts suites have no coverage gate. Database coverage is structural: pgTAP suites are table-driven from the catalogues (every `admin_api` function, every RLS-forced table, every column grant).

## Flake policy

- Unit, contract, pgTAP and integration suites run with zero retries. A failure is fixed at its root cause in product or test code, never with a sleep; tests wait on state (Playwright web-first assertions, Maestro `extendedWaitUntil`).
- Playwright: web retries once in CI (`retries: 1`, trace kept on failure) and never locally; the backoffice never retries. `forbidOnly` fails a CI run that contains `.only`.
- Maestro: no retries; the run continues after a failed flow (`continueOnFailure`) so every failure is reported, and the job fails if any flow failed. Every flow seeds its user through the harness, which also clears that user's Auth code-send timer and mailbox so the flow's own code is read; the m102 flows share the demo canon users, so the Android run uses one device.
- A test that cannot be made deterministic is rewritten at a lower tier with the same assertion; there is no quarantine list.
- Known causes fixed so far are recorded in the commit history (for example the scheduler-tick race in `090_jobs_scheduler`, fixed by taking the scheduler advisory lock before the table lock, and the backoffice dashboard range race, fixed by polling on the query state).

## Clock-shift check

Date-dependent tests are found by running the suites with the system clock moved 14 days ahead with libfaketime (container, before a release; not a CI job):

```bash
faketime -f '+14d' pnpm turbo run test --force
faketime -f '+14d' pnpm functions:test
```

Both must pass unchanged. A failure means a test reads the real clock instead of an injected one; the fix pins the clock in that test.

## E2E suites

| Suite | Specs | Runs against |
| --- | --- | --- |
| Web | [`apps/web/e2e`](../apps/web/e2e): landing, pricing, CTA, legal, support, data deletion, referral landing (`/r/[code]`), OAuth done, app links (`/app/…`), `.well-known` files, SEO, security headers, i18n, keyboard, responsive, accessibility (axe), truthfulness, privacy network, not found | `next build` + `next start` and the `public-api` contract stub |
| Backoffice (`bo-contract`) | [`apps/backoffice/e2e`](../apps/backoffice/e2e): login and MFA, logout, idle session, dashboard, users, support, operations, AI, flags, privacy, admin actions, RBAC matrix, security, accessibility, contract gaps | production build + the contract-validated mock admin-api and Auth |
| Mobile (Maestro) | [`apps/mobile/.maestro/flows`](../apps/mobile/.maestro/flows): `m102/` (E2E-M-01…20), `acceptance/` (A–J), `screens/` (E2E-S-*), `security/` (TST-E2E-M-01…04); tags `android`, `ios`, `free`, `pro` | Android: local tier-A stack (CI); iOS: staging E2E project (EAS) |

The Maestro harness ([`scripts/e2e/harness-server.ts`](../scripts/e2e/harness-server.ts)) is a loopback server the flows call through `runScript`: it seeds a user and scenario (`e2e.seed_user` / `e2e.reset_user` from `supabase/seed/e2e/functions.sql`, refused outside local, CI and staging-E2E sessions), reads sign-in codes from the local mail sink, runs `scheduler_tick(p_now)`, drains worker queues, activates a RevenueCat mock purchase and exposes read-only state probes. In staging mode it serves only `/seed`, `/otp` and `/state` for the canon users. [`scripts/mobile/maestro-lint.ts`](../scripts/mobile/maestro-lint.ts) (run by `pnpm test:scripts`) checks without a device that every flow parses, uses only allowed commands, references existing `testID`s and catalogue copy, carries its tags, and that every TEST_PLAN §9 ID has its flow.

## Differences from the plan

| Plan (TEST_PLAN) | As built | Reason |
| --- | --- | --- |
| §1 tier D: PGlite in-process SQL tests | Not used; pure SQL behaviour is covered by tier C pgTAP | Tier C runs every SQL test in the container, so a second SQL engine added no coverage. |
| §1 T8: Robolectric renders and Swift XCTest for widgets; CI jobs `mobile-native-android` and `mobile-native-ios` | JVM tests of the notification-intelligence rules in the `mobile` job; widget, TTS and share native code is compiled and exercised only in EAS builds and on devices | The GitHub workflows run on Linux only; native rendering checks remain EAS and device work. |
| §13 jobs `install`, `db-shim`, `migrations`, `secret-scan` (gitleaks), `quality-gate`, `security-nightly` (CodeQL, ZAP), nightly `ai-eval`, `nightly.yml` | The job set in "Where each check runs" plus `security-nightly` (audit, CodeQL, ZAP) and the nightly `ai-eval.yml`; migrations are linted in `db`, gitleaks and the bundle scans run in `security`, the quality gate runs in `lint`; no `nightly.yml` | The nightly pipelines are split per concern; `ai-eval` needs the `staging` environment's credentials and fails loudly without them (GAP-4). |
| §10 backoffice projects `bo-full` and `bo-visual`; §8 visual screenshot comparisons | `bo-contract` only; no screenshot comparison suites | The full-stack backoffice run needs GoTrue, admin-api and the worker together; admin-api is covered by its Deno pipeline, route and flow tests. |
| §16 `_shared` 90/85/90 and per function 85/75/85 | `_shared` lines ≥ 80 (IMPLEMENTATION_PLAN T-12.04); no per-function gate | T-12.04 sets the Edge gate at 80 % lines. |
| §16 mobile 75/65/75 | Regression floor below the target | See [Coverage](#coverage). |
| §17 `fail-on-flaky` reporter | Web retries once in CI without that reporter | A retried pass still shows in the Playwright report; the reporter was not added. |
| §9.1 `--shard-split 4` with a distinct user key per shard | One emulator, no sharding | The m102 flows sign in as the demo canon users (`u_pro`, `u_free`), and each canon seed resets their data; parallel shards reset each other's users mid-flow. Per-shard canon copies would allow sharding again. |
| §9 E2E build uses the production app id and `APP_ENV=ci` | `com.dijitalasistan.app.e2e` and `APP_ENV=e2e` | `ci` is not an `APP_ENV` value; a separate id keeps the E2E build installable next to other variants. |
| §12.4: `DA_FIXED_NOW` turns the Edge Functions' domain clock into an offset clock | `DA_FIXED_NOW` is the harness's seeding anchor; Edge Functions run on the real clock and scheduled work is driven with `scheduler_tick(p_now)` | The server env schema treats `DA_FIXED_NOW` as a test-only key and no Edge code reads it. |

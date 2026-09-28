# Dijital Asistan

> **Bugün bilmen gerekenleri, sen sormadan söyler.**

Documented at `ec14e92`.

Dijital Asistan is a Turkish-first personal command center. It reads the user's mail, calendar and open work and tells them each day what they actually need to know. It is not a chatbot: AI output is proactive, cites its sources, and needs the user's approval before any write action.

The product is one monorepo:

| Surface                       | Stack                                                                    |
| ----------------------------- | ------------------------------------------------------------------------ |
| Mobile app (iOS + Android)    | Expo SDK 57 · React Native 0.86 · Expo Router · TypeScript               |
| Public website                | Next.js 16 App Router · Tailwind v4                                      |
| Backoffice (`admin.<domain>`) | Next.js 16 App Router · separate auth/RBAC boundary                      |
| Backend                       | Supabase (Postgres + RLS, Auth, Storage, Edge Functions, Cron, pgvector) |

## Repository map

| Path                                               | Contents                                                                                                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`apps/mobile`](apps/mobile)                       | The iOS and Android app, local native modules, the widget extension, Maestro flows ([docs/MOBILE.md](docs/MOBILE.md))                               |
| [`apps/web`](apps/web)                             | The public website: landing, pricing, legal pages, support, web account deletion, app-link fallbacks ([README](apps/web/README.md))                 |
| [`apps/backoffice`](apps/backoffice)               | The admin panel ([docs/BACKOFFICE.md](docs/BACKOFFICE.md))                                                                                          |
| [`packages/domain`](packages/domain)               | `@da/domain`: enums, entities, priority engine, notifications, deep links, approvals, RBAC, referrals, extractors (Deno-safe)                       |
| [`packages/validation`](packages/validation)       | `@da/validation`: zod contracts of every API, admin, public and webhook route, AI output schemas, env schemas                                       |
| [`packages/api-client`](packages/api-client)       | `@da/api-client`: typed Edge client, Supabase client factory, TanStack Query options, generated database types                                      |
| [`packages/ui`](packages/ui)                       | `@da/ui`: the React Native component kit                                                                                                            |
| [`packages/design-tokens`](packages/design-tokens) | `@da/design-tokens`: colours, type, spacing, motion for React Native and CSS                                                                        |
| [`packages/i18n`](packages/i18n)                   | `@da/i18n`: Turkish and English catalogs, formatting helpers                                                                                        |
| [`packages/config`](packages/config)               | `@da/config`: shared TypeScript, ESLint and Prettier configuration                                                                                  |
| [`supabase`](supabase)                             | Migrations, pgTAP suites, Edge Functions, prompts, seeds, `config.toml` ([README](supabase/README.md))                                              |
| [`scripts`](scripts)                               | Database runners, Edge Function tasks, integration and E2E runners, generators, deploy checks, the quality gate ([db README](scripts/db/README.md)) |
| [`design`](design)                                 | What the product consumes from the design archives ([README](design/README.md))                                                                     |
| [`docs`](docs)                                     | Plan documents and as-built documentation (below)                                                                                                   |

## Prerequisites

- Node.js 24 (`.nvmrc`; `>=22.13` works) and pnpm 11.27.1 through Corepack (`corepack enable`).
- Deno 2.1.4 and the Supabase CLI come as dev dependencies (`pnpm exec deno`, `pnpm exec supabase`).
- For the full local backend: Docker (for `supabase start`). Without Docker, the database suites run on a local PostgreSQL 16 ("tier C", set up by `bash scripts/dev/bootstrap-container.sh`).
- For the mobile app: a development build (Xcode or the Android SDK locally, or EAS with `EXPO_TOKEN`). Expo Go is not supported.

Missing provider credentials never block development: adapters report "Harici kimlik bilgisi gerekli" (`external_credential_required`), and demo mode supplies fixture data.

## Quickstart

1. **Install.**

   ```bash
   corepack enable
   pnpm install
   ```

2. **Environment.** Create `.env` from `.env.example` and generate the local secrets (token encryption key, peppers, webhook and admin secrets), then export the variables into the shell that starts the dev servers:

   ```bash
   bash scripts/dev/env.sh --init
   eval "$(bash scripts/dev/env.sh)"
   ```

   Variable names and scopes are documented in `.env.example` (INTEGRATION_PLAN §15). Never commit `.env`.

3. **Database.** Either the full local Supabase stack (Auth, Storage, PostgREST, Edge runtime):

   ```bash
   pnpm db:start                      # supabase start (without Studio and imgproxy)
   pnpm exec supabase db reset        # applies every migration from zero
   ```

   or, without Docker, tier C for the SQL suites only:

   ```bash
   bash scripts/dev/bootstrap-container.sh   # PostgreSQL 16 + pgvector, pgTAP, pg_cron (once)
   pnpm db:test:c                            # fresh database, migrations, pgTAP
   ```

4. **Edge Functions** (full stack only): `pnpm exec supabase functions serve --env-file .env`. [`scripts/e2e/start-stack.sh`](scripts/e2e/start-stack.sh) shows a minimal working function environment.

5. **Demo mode.** Set `DEMO_MODE=true` (and, for AI without provider keys, `AI_FIXTURE_PROVIDER_ENABLED=true`) for the functions, load the demo dataset into the local stack, and build the app with `EXPO_PUBLIC_DEMO_MODE=true` (the `e2e` EAS profile does this):

   ```bash
   DEMO_MODE=true DEMO_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm db:seed:demo
   ```

   Demo mode is refused when `APP_ENV=production` unless `ALLOW_DEMO_IN_PRODUCTION=true`.

6. **Web:** `pnpm --filter @da/web dev` (http://localhost:3000). **Backoffice:** `pnpm --filter @da/backoffice dev` (http://localhost:3100); it needs admin-api and a first administrator (`pnpm admin:bootstrap`, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#first-administrator)).

7. **Mobile:** build a development client once (`eas build --profile development`, or `pnpm --filter @da/mobile exec expo run:ios` / `expo run:android`), then `pnpm --filter @da/mobile start`. Details in [docs/MOBILE.md](docs/MOBILE.md#running-the-app).

## Common commands

| Command                                                                             | Does                                                                                         |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm lint` · `pnpm typecheck` · `pnpm test`                                        | Every workspace through Turbo (tests run with coverage gates)                                |
| `pnpm exec eslint .` · `pnpm exec tsc -p tsconfig.json`                             | Lint and typecheck the repository scripts                                                    |
| `pnpm format` · `pnpm format:check`                                                 | Prettier                                                                                     |
| `pnpm quality-gate`                                                                 | Banned markers, retired canonical names and banned product claims                            |
| `pnpm test:scripts`                                                                 | Tests of the repository scripts and generators                                               |
| `pnpm db:test:c` · `pnpm db:test`                                                   | pgTAP on tier C (local PostgreSQL 16) · on the full local stack (Docker)                     |
| `pnpm db:lint` · `pnpm db:types` · `pnpm db:types:check`                            | Migration lint (squawk) · regenerate · check the generated database types                    |
| `pnpm functions:check` · `functions:lint` · `functions:test` · `functions:coverage` | Edge Functions: `deno check`, `deno lint` + guards, Deno tests, tests with the coverage gate |
| `pnpm functions:imports`                                                            | Regenerate the per-function import maps from `supabase/functions/import_map.base.json`       |
| `pnpm test:integration:c` · `pnpm test:integration`                                 | Integration suites on tier C+ · on the full local stack                                      |
| `pnpm --filter @da/web e2e:web` · `pnpm e2e:backoffice`                             | Playwright                                                                                   |
| `pnpm mobile:check`                                                                 | Expo dependency check, bundle export, prebuild smoke                                         |
| `pnpm scan:bundles`                                                                 | Secret scan of the built web, backoffice and mobile bundles                                  |
| `pnpm ai:prompts` · `pnpm ai:eval`                                                  | Regenerate the prompt seed migrations · run the fixture AI evals                             |
| `node scripts/docs/gen-rbac.ts`                                                     | Regenerate the RBAC reference in `docs/BACKOFFICE_RBAC.md` (`--check` for drift)             |

Where each check runs (container, CI, EAS, owner) is in [docs/TESTING.md](docs/TESTING.md).

## Documentation

As-built documentation (what the code does):

| Document                                                                      | Contents                                                                                  |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [ARCHITECTURE](docs/ARCHITECTURE.md)                                          | System architecture and diagrams                                                          |
| [DATABASE](docs/DATABASE.md)                                                  | Tables, RLS, functions, cron                                                              |
| [OAUTH](docs/OAUTH.md)                                                        | Provider OAuth, scopes, token handling                                                    |
| [AI_PIPELINE](docs/AI_PIPELINE.md) · [AI_PROMPTS](docs/AI_PROMPTS.md)         | AI routing, cost model, grounding · the prompt registry                                   |
| [SECURITY](docs/SECURITY.md) · [PRIVACY](docs/PRIVACY.md)                     | Threat model with verification · privacy statements, retention, export and deletion       |
| [MOBILE](docs/MOBILE.md)                                                      | App structure, navigation, offline queue, notifications, widgets, share, Android NI, TTS  |
| [BACKOFFICE](docs/BACKOFFICE.md) · [BACKOFFICE_RBAC](docs/BACKOFFICE_RBAC.md) | Admin modules, auth, sessions, masking, Support Access, audit · the generated RBAC matrix |
| [TESTING](docs/TESTING.md)                                                    | Test tiers, commands, CI, coverage gates, flake policy, E2E suites                        |
| [DEPLOYMENT](docs/DEPLOYMENT.md)                                              | Supabase, Vercel and EAS deployment, owner steps, release checks                          |
| [DESIGN_MAPPING](docs/DESIGN_MAPPING.md)                                      | Design artboards → screens → routes, and the deviation log as built                       |
| [STORE_CHECKLIST](docs/STORE_CHECKLIST.md)                                    | App Store and Google Play submission                                                      |
| [KNOWN_PLATFORM_LIMITATIONS](docs/KNOWN_PLATFORM_LIMITATIONS.md)              | What each platform cannot do and what the product does instead                            |
| [CANONICAL_REGISTRY](docs/CANONICAL_REGISTRY.md)                              | Canonical names and retired names                                                         |

## Planning documents

Implementation follows the plan in [`docs/`](docs). Start with [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md) (binding decisions and cross-document rulings) and [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) (plan summary plus a work breakdown of 173 tasks in dependency order). The plan documents describe intent; where the implementation differs, the as-built documents above say so.

| Document                                                       | Contents                                                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [ARCHITECTURE_DECISIONS](docs/ARCHITECTURE_DECISIONS.md)       | ADRs and the verified version matrix                                                           |
| [DESIGN_AUDIT](docs/DESIGN_AUDIT.md)                           | Design tokens, component inventory, screen coverage across both design archives, deviation log |
| [SCREEN_AND_FLOW_MAP](docs/SCREEN_AND_FLOW_MAP.md)             | Every mobile screen, sheet and widget (20-field spec each), public web pages, end-to-end flows |
| [DATABASE_AND_RLS_PLAN](docs/DATABASE_AND_RLS_PLAN.md)         | Every table, enum, function, RLS policy, cron job and pgTAP suite                              |
| [API_CONTRACTS](docs/API_CONTRACTS.md)                         | Edge Function, webhook, job and admin-api contracts                                            |
| [INTEGRATION_PLAN](docs/INTEGRATION_PLAN.md)                   | Google, Microsoft, Apple, Android, push, RevenueCat; credential matrix and `.env` keys         |
| [AI_PIPELINE_PLAN](docs/AI_PIPELINE_PLAN.md)                   | Model routing, schemas, prompts, grounding, cost control, retrieval, voice                     |
| [BACKOFFICE_PLAN](docs/BACKOFFICE_PLAN.md)                     | Admin auth, RBAC matrix, every module                                                          |
| [SECURITY_AND_PRIVACY_PLAN](docs/SECURITY_AND_PRIVACY_PLAN.md) | Threat model, controls, privacy, retention, export and deletion                                |
| [TEST_PLAN](docs/TEST_PLAN.md)                                 | Unit, integration, database, E2E, quality gate                                                 |
| [DELIVERY_CHECKLIST](docs/DELIVERY_CHECKLIST.md)               | Requirement traceability matrix, Definition of Done, release checklist                         |
| [plan-audits/](docs/plan-audits)                               | The design and research audits the plan was built from                                         |

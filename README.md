# Dijital Asistan

> **Bugün bilmen gerekenleri, sen sormadan söyler.**

Dijital Asistan is a Turkish-first personal command center. It reads the user's mail, calendar and open work and tells them each day what they actually need to know. It is not a chatbot: AI output is proactive, cites its sources, and needs the user's approval before any write action.

The product is one monorepo:

| Surface | Stack |
|---|---|
| Mobile app (iOS + Android) | Expo SDK 57 · React Native 0.86 · Expo Router · TypeScript |
| Public website | Next.js 16 App Router · Tailwind v4 |
| Backoffice (`admin.<domain>`) | Next.js 16 App Router · separate auth/RBAC boundary |
| Backend | Supabase (Postgres + RLS, Auth, Storage, Edge Functions, Cron, pgvector) |

## Planning documents

Implementation follows the plan in [`docs/`](docs). Start with [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md) (binding decisions and cross-document rulings) and [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) (plan summary plus a work breakdown of 173 tasks in dependency order).

| Document | Contents |
|---|---|
| [ARCHITECTURE_DECISIONS](docs/ARCHITECTURE_DECISIONS.md) | ADRs and the verified version matrix |
| [DESIGN_AUDIT](docs/DESIGN_AUDIT.md) | Design tokens, component inventory, screen coverage across both design archives, deviation log |
| [SCREEN_AND_FLOW_MAP](docs/SCREEN_AND_FLOW_MAP.md) | Every mobile screen, sheet and widget (20-field spec each), public web pages, end-to-end flows |
| [DATABASE_AND_RLS_PLAN](docs/DATABASE_AND_RLS_PLAN.md) | Every table, enum, function, RLS policy, cron job and pgTAP suite |
| [API_CONTRACTS](docs/API_CONTRACTS.md) | Edge Function, webhook, job and admin-api contracts |
| [INTEGRATION_PLAN](docs/INTEGRATION_PLAN.md) | Google, Microsoft, Apple, Android, push, RevenueCat; credential matrix and `.env` keys |
| [AI_PIPELINE_PLAN](docs/AI_PIPELINE_PLAN.md) | Model routing, schemas, prompts, grounding, cost control, retrieval, voice |
| [BACKOFFICE_PLAN](docs/BACKOFFICE_PLAN.md) | Admin auth, RBAC matrix, every module |
| [SECURITY_AND_PRIVACY_PLAN](docs/SECURITY_AND_PRIVACY_PLAN.md) | Threat model, controls, privacy, retention, export and deletion |
| [TEST_PLAN](docs/TEST_PLAN.md) | Unit, integration, database, E2E, quality gate |
| [DELIVERY_CHECKLIST](docs/DELIVERY_CHECKLIST.md) | Requirement traceability matrix, Definition of Done, release checklist |
| [KNOWN_PLATFORM_LIMITATIONS](docs/KNOWN_PLATFORM_LIMITATIONS.md) | What each platform cannot do and what the product does instead |
| [plan-audits/](docs/plan-audits) | The design and research audits the plan was built from |

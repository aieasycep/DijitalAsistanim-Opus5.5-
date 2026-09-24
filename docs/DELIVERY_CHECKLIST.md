# Delivery Checklist

> `docs/DELIVERY_CHECKLIST.md`. This is the execution-time control document for Dijital Asistan. It covers the mobile app (Expo SDK 57 / RN 0.86), the public web (Next.js 16.3), the separate backoffice (Next.js 16.3, `admin.<domain>`) and Supabase (Postgres + RLS, Auth, Storage, Edge Functions, Cron, pgvector).
>
> **Binding order:**
> 1. MASTER_PROMPT (cited as M§n).
> 2. The plan spine §3–§23b. Reconciliation rulings R-01…R-25 override any draft or critic text they conflict with.
> 3. The per-artefact precedence of R-20:
>    - DATABASE_AND_RLS_PLAN for tables, columns, enums, functions, cron and buckets;
>    - API_CONTRACTS for route and RPC names, shapes and SSE events;
>    - BACKOFFICE_PLAN §4.1 for admin permission strings;
>    - ARCHITECTURE_DECISIONS for versions;
>    - INTEGRATION_PLAN §15 for env var names;
>    - SCREEN_AND_FLOW_MAP for screen IDs and analytics event names.
>
> **Inputs:**
> - The 720-row requirement coverage matrix built across all 16 drafts.
> - The naming, coverage and policy critic findings. Every blocker and major finding is treated as resolved by the reconciliation patch pass. Those rows read `planned (patched → target doc)`.
> - M§98–§100, §120, §133–§138 and §153.
> - The secondary-docs audit: SREQ-99 per-screen action inventory format and SREQ-100 acceptance flows A–J.
>
> **Canonical names this document applies** (R-rulings win over critic proposals):

| Topic | Canonical choice |
|---|---|
| OAuth completion | `POST /integrations/oauth/complete {completion_code, device_nonce}` (R-07) |
| Embeddings | Voyage `voyage-4` / `voyage-4-lite`, `vector(1024)` (R-01) |
| AI result cache | `ai_result_cache` (R-02) |
| Plan limits | `plan_limits(plan, key, value)` keys `max_mail_accounts`, `max_calendars`, `ai_daily_budget_units` (Free 50), `ai_soft_cap_usd_day`, `ai_hard_cap_usd_day`, `ai_hard_cap_usd_month`, `ai_routing_profile` (R-22) |
| Routing profile | `balanced`/`lean` on `ai_model_config (profile, role, feature)` (R-18) |
| Voice approvals | Tap-only; `approved_via` = `approval_center`/`inline_sheet`/`voice_card`/`capture_batch`/`in_place` (R-03) |
| Undo | 5 s client-side delay before approve; no new status (R-06) |
| Quiet hours | 22:30–07:30 with VIP bypass on by default (R-13) |
| Daily push cap | `daily_cap` 5 (R-14) |
| Realtime | Not used; polling and push instead (R-19) |
| Dead actions | Additions per R-24 |
| Announcements | Today banner (R-25) |

---

## 1. How to use this checklist during execution

### 1.1 Status legend

Every row in §2, §3, §4 and §9 moves through the same states. A state is never skipped, and a row never moves backwards without a note in its Evidence cell.

| Status | Meaning | Minimum evidence to enter this state |
|---|---|---|
| `planned` | Specified in the plan documents. No code merged yet. | The spec reference (screen ID, API ID, table, test ID) already in the row. |
| `planned (patched → DOC)` | The critic found a gap and the patch pass closed it in the named document. The patched text is binding and is implemented like any other `planned` row. | The finding ID and the patched section in the named doc. |
| `implemented` | Code merged on `claude/magical-pascal-edvjgn` (or the PR branch) and wired through the full M§98 chain. | PR number + commit SHA (7 chars) + WBS task ID. |
| `tested` | Every test ID in the row's Tests column passes in the tier where it can run (container tier C/D, CI tier A, EAS). | CI run URL or job name + test IDs + tier. A test that only runs in CI is never reported as passing in the container (TEST_PLAN §15). |
| `verified` | The end-to-end chain was exercised in the target environment. For rows whose last hop needs an external credential, this is the owner sandbox run (REL-*). | REL-ID, screenshot or recording, `correlation_id` (Settings → Hakkında → "Tanılama kimliği") and the matching backoffice record (Sync & Jobs / Audit). |
| `rejected` | An SREQ REJECT decision from the secondary-docs audit. It stays rejected. | DESIGN_AUDIT reference. |

**External credentials.** When the last hop needs an owner credential (Google CASA, Apple keys, RevenueCat secret, and so on), the row can reach `tested` with the demo/fixture adapters (M§89, M§90). Add `EXT: <credential>` to its Evidence cell. It reaches `verified` only after the owner run in §7.

### 1.2 Evidence column

- **Format:** `PR #<n> · <sha7> · <test IDs> · <run>`. Examples: `PR #14 · a1b2c3d · E2E-M-05, IT-AI-08 · ci#2231 (tier A)`, `REL-06 · rec-0923.mp4 · corr 7f3c…`.
- Several evidence items are separated with `;`.
- The matrix's Evidence cells stay empty at planning time and are filled only by the executing session.

### 1.3 Working rules

1. **Start of each milestone (IMPLEMENTATION_PLAN Part C):** filter §2 by the milestone's WBS IDs. Those rows are the milestone's acceptance list.
2. **Before a milestone commit:**
   - update the Status and Evidence of every touched row;
   - run the commands in §6;
   - make the quality gate in §5 green.
3. **A feature (§3) is `verified` only when:**
   - every §2 row that references its screens is at least `tested`;
   - every §4 row of its screens is PASS;
   - its §9 feature-matrix row is filled.
4. **Canonical-name drift:** a row is not `implemented` if its code uses a retired name. QG-27 in §5 enforces this.
5. **Failing test (M§134):** never ask the user. Root-cause it, fix, rerun (§6) and record the root cause in the PR.
6. **At M12 (T-12.10):**
   - copy §4's completed table and §9's feature matrix into `docs/FINAL_IMPLEMENTATION_REPORT.md`;
   - the release checklist issue (§7) must be closed with evidence before store promotion.

### 1.4 Totals at planning time

| Source | Rows | `planned` | `planned (patched)` | `rejected` |
|---|---|---|---|---|
| REQ-* (M§1–§154) | 573 | 529 | 44 | 0 |
| SREQ-01…104 (secondary docs) | 104 | 88 | 13 | 3 |
| C-01…C-37, P-01…P-06 (audit resolutions) | 43 | 40 | 3 | 0 |
| **Total** | **720** | **657** | **60** | **3** |

> These are the matrix counts after the patch mapping. The coverage critic's original 56 "partial" rows and 1 "missing" row are the 57 core patched rows. Three more rows (SREQ-04, SREQ-12, SREQ-37) that the critic marked partial are counted under SREQ, which gives 60.

---

## 2. Requirement traceability matrix

**Column legend:**
- **Screens:** M-/F-/W- IDs from SCREEN_AND_FLOW_MAP Parts 1–5.
- **API / Jobs:** API-/JOB-/ADM-/PUB-/RPC-/WH-/OAUTH-/HLT- IDs in API_CONTRACTS; AI§ = AI_PIPELINE_PLAN; INT§ = INTEGRATION_PLAN.
- **Tables:** DATABASE_AND_RLS_PLAN specs.
- **Backoffice / Security:** BO§ = BACKOFFICE_PLAN modules; CTL/THR/SEC§ = SECURITY_AND_PRIVACY_PLAN.
- **Tests:** TEST_PLAN IDs. "SM Tests field", "API Tests bullet" and "BO Tests row" mean the test is specified inside the screen block, the contract block or the backoffice module row.
- **WBS:** IMPLEMENTATION_PLAN task IDs, or the Part F entry.

"+n" means n more IDs of the same kind exist in the source row. No row has been dropped: 720 rows, grouped by area.

### 2.1 Process and plan

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-PROC-01 | In Plan Mode: no production code, no fake files, no stub code… | 0A |  |  |  |  |  | T-0.01 | planned |  |
| REQ-PROC-02 | Plan produces docs/IMPLEMENTATION_PLAN.md… | 0A |  |  |  |  | QG-16 | T-0.01, T-12.07 +1 | planned (patched → DELIVERY_CHECKLIST (this document)) |  |
| REQ-PROC-03 | The plan answers all 25 enumerated questions: monorepo, packages… | 0A |  |  |  |  |  | T-0.01 | planned |  |
| REQ-PROC-04 | Every technical decision and its rationale is recorded in… | 0A |  | AI§16.4 |  |  | API Tests bullet | T-0.01 | planned |  |
| REQ-PROC-05 | Plan detail is sufficient for an independent Claude Code session… | 0A |  |  |  |  |  | T-0.01 | planned |  |
| REQ-PROC-06 | Execution starts by reading the plan docs, re-auditing the repo… | 0B |  |  |  |  |  | T-0.01 | planned |  |
| REQ-PROC-07 | Execution delivers architecture, DB, backend, mobile, web… | 0B |  |  |  |  |  | T-0.01 | planned |  |
| REQ-PROC-08 | The deliverable is a production-ready product, not a demo. | 1 |  |  |  |  |  | whole WBS; T-12.10 | planned |  |
| REQ-PROC-09 | Repo discovery inventories: folders, package manager, workspaces… | 5 |  |  |  |  |  | T-0.03, T-12.11 | planned |  |
| REQ-PROC-10 | Existing code is never deleted blindly. An empty repo gets a… | 5 |  |  |  |  |  | T-12.11 | planned |  |
| REQ-PROC-11 | The plan summary has 22 sections: Repository state, Design… | 120 |  |  |  |  |  | T-0.01, T-12.11 | planned |  |
| REQ-PROC-12 | Execution order is technical dependency order only. No V1/V2/MVP… | 120,139 |  |  |  | BO§14.1 | BO Tests row | Part A | planned |  |
| REQ-PROC-13 | Execution sequence (dependency-optimizable, nothing deferred)… | 121 |  |  |  |  |  | T-0.01, T-0.02 +2 | planned |  |
| REQ-PROC-14 | Self-run loop: install → lint → typecheck → unit → integration →… | 134 |  |  |  |  |  | T-0.07, T-2.02 +2 | planned |  |
| REQ-PROC-15 | docs/FINAL_IMPLEMENTATION_REPORT.md has sections Completed… | 138 |  | AI§3.5 |  | BO§14.2 | API Tests bullet | T-12.10 | planned |  |
| REQ-PROC-16 | Scope is a single, complete product (not wireframe, demo… | 139 |  |  |  |  |  | whole WBS | planned |  |
| REQ-PROC-17 | Never ask the user for technical, framework, DB or architecture… | 140 |  |  |  |  |  | T-12.10 | planned |  |
| REQ-PROC-18 | An impossible capability gets the real capability, a… | 141 | W-LEGAL-01 |  |  | SEC§4.1 | QG-06 | T-8.26, T-9.02 | planned |  |
| REQ-PROC-19 | Root-cause and dependency analysis come before changes. Split… | 142 |  |  |  |  |  | Part C milestones | planned |  |
| REQ-PROC-20 | Plan-mode sub-audits: Design, Architecture, Data, Integration… | 143 |  |  |  |  |  | T-0.01 | planned |  |
| REQ-PROC-21 | Plan-mode steps 1–17, ending in a self-consistency check with no… | 154 |  |  |  |  |  | T-12.11 | planned |  |

### 2.2 Product, principles and design

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-PROD-01 | Name "Dijital Asistan". Slogan "Bugün bilmen gerekenleri, sen"… | 2 | M-ON-01, M-BR-06 |  |  |  | WEB-E2E-01, E2E-M-01 | T-1.04 | planned |  |
| REQ-PROD-02 | Positioned as a Personal Command Center, not a chatbot. | 2 | W-HOME-01, W-LEGAL-02 | AI§5.1 |  |  | SM Tests field | T-1.04 | planned |  |
| REQ-PROD-03 | Understands emails, calendar, tasks, deadlines, waiting-for… | 2 | M-TD-01, M-LIFE-01 |  | life_events |  | SM Tests field | T-1.04 | planned |  |
| REQ-PROD-04 | Answers "Bugün gerçekten neyi bilmeliyim?" with meaningful… | 2 | M-ON-01, M-ON-13 +6 | API-ONB-02, JOB-14 +4 |  | CTL-3.12 | WEB-E2E-01, E2E-M-01 | T-1.04, T-5.08 +1 | planned |  |
| REQ-PRIN-01 | Chat is not the home screen. | 3.1 | M-ASST-01, W-HOME-01 +1 |  |  |  | SM Tests field | T-1.07 | planned |  |
| REQ-PRIN-02 | AI is proactive (briefings and insights without user prompting). | 3.2 | M-GL-02, M-ON-01 +1 | AI§3.5 | profiles |  | E2E-M-01 | T-8.06 | planned |  |
| REQ-PRIN-03 | Minimum user effort. | 3.3 | M-APPR-04 |  |  |  | SM Tests field | T-1.07 | planned |  |
| REQ-PRIN-04 | Reduces information clutter. | 3.4 | M-GL-02, M-ON-01 +1 | AI§16.2 | profiles |  | E2E-M-01 | T-8.06 | planned |  |
| REQ-PRIN-05 | Important insights show their source. | 3.5 | M-FLOW-01, M-MAIL-03 +5 |  |  |  | SM Tests field | T-8.03 | planned |  |
| REQ-PRIN-06 | Approval before any write or modify on the user's behalf. | 3.6 | M-GL-04, M-ON-06A +19 | API-MAIL-05, API-APR-01 +13 | calendar_events, tasks +6 | BO§7.4, BO§7.7 +2 | DB-03 | T-2.08, T-12.11 | planned |  |
| REQ-PRIN-07 | Mail is never sent without user approval. | 3.7 | M-TD-01, M-BR-03 +19 | API-MAIL-05, API-APR-01 +6 |  | SEC§0.2, THR-10 | IT-APR-01, E2E-M-08 | T-5.12, T-6.02 | planned |  |
| REQ-PRIN-08 | Calendar is never changed without user approval. | 3.8 | M-ON-07, M-BR-03 +12 | API-APR-01, API-APR-02 +4 |  | SEC§0.2, CTL-3.16 | IT-APR-11, E2E-J | T-5.14, T-6.03 | planned |  |
| REQ-PRIN-09 | The user can correct AI importance decisions. | 3.9 | M-TD-01, M-TD-02 +9 | HLT-02, AI§6.7 | ai_feedback |  | E2E-S-01, E2E-M-06 | T-8.03 | planned (patched → API_CONTRACTS, DB: `submit_ai_correction`, `apply_`/`revert_insight_feedback` (R-24)) |  |
| REQ-PRIN-10 | Precedence: explicit priority rules > learned preferences >… | 3.10 | M-TD-01, M-TD-03 | AI§1.1 |  |  | SM Tests field | T-1.07 | planned |  |
| REQ-PRIN-11 | No information that is absent from the source. | 3.11 | F-01, F-03 +6 | API-APR-01, API-MEET-03 +7 | ai_requests | BO§6.11, SEC§4.16 | UT-AMT-09, UT-COM-05 +1 | T-1.13, T-5.01 +3 | planned |  |
| REQ-PRIN-12 | Privacy-first defaults. | 3.12 | M-GL-03, M-GL-13 +36 | API-INT-01, API-INT-03 +40 | reminders, ai_feedback +2 | BO§2.4, BO§3.8 +2 | UT-REM-10, UT-NTF-11 +4 | T-0.03, T-1.04 +13 | planned |  |
| REQ-PRIN-13 | iOS and Android offer the same core experience. | 3.13 | M-SET-62 | AI§15.5 |  | BO§2.2, BO§4.1 +2 | UT-RBAC-02, UT-ENV-07 +6 | T-0.04, T-1.14 +2 | planned |  |
| REQ-PRIN-14 | Android-only features never block the iOS core. | 3.14 |  |  |  |  |  | T-1.07 | planned |  |
| REQ-PRIN-15 | No artificial streaks or FOMO mechanics. | 3.15 |  |  |  |  |  | T-1.07 | planned |  |
| REQ-PRIN-16 | No notification without value. | 3.16 | M-BR-04C, F-05 +2 | API-REM-02, JOB-18 +3 | notification_preferences | SEC§4.16 | SM Tests field | T-1.08, T-12.11 | planned |  |
| REQ-PRIN-17 | User control is always preserved. | 3.17 | M-COMMIT-03 |  |  |  | SM Tests field | T-1.07 | planned |  |
| REQ-PRIN-18 | Important AI output is source-grounded wherever possible. | 3.18 | F-01, F-03 +6 | API-APR-01, API-MEET-03 +7 | ai_requests | BO§6.11, SEC§4.16 | UT-AMT-09, UT-COM-05 +1 | T-1.13, T-5.01 +3 | planned |  |
| REQ-PRIN-19 | Uncertain data is never presented as fact. | 3.19 | M-BR-01, M-COMMIT-02 +3 | API-AST-02, JOB-11 +1 |  | CTL-3.15 | UT-GRD-06, UT-GRD-14 +2 | T-1.04, T-1.13 +1 | planned |  |
| REQ-PRIN-20 | Aim for less cognitive load, not more screens. | 3.20 |  |  |  |  |  | T-1.07 | planned |  |
| REQ-DES-01 | On visual conflict, the primary archive wins (visual language… | 4 |  |  |  |  |  | T-0.02 | planned |  |
| REQ-DES-02 | The secondary archive covers missing screens, settings, privacy… | 4 | M-ON-07D, M-ON-09 +55 |  |  |  | SM Tests field | T-0.02 | planned |  |
| REQ-DES-03 | Functional behavior follows MASTER. | 4 |  |  |  |  |  | T-0.02 | planned |  |
| REQ-DES-04 | Never copy dead buttons, fake loading, non-working CTAs, fake… | 4 |  |  |  | BO§5.5 | QG-24 | T-0.02 | planned |  |
| REQ-DES-05 | Extract required assets and design tokens from the archives. | 4 |  |  |  |  |  | T-0.02 | planned |  |
| REQ-DES-06 | No WebView of the prototype. Native React Native UI. | 4 |  |  |  | SEC§0.2, CTL-3.2 |  | T-0.02 | planned |  |
| REQ-DES-07 | Extract color, type scale, spacing, radius, shadows, icon… | 122 | M-GL-01 |  |  | BO§2.2, BO§5.1 | SM Tests field | T-1.01, T-1.02 +2 | planned |  |
| REQ-DES-08 | Do not copy screenshots arbitrarily. Minimize visual regression… | 122 |  |  |  |  | VIS-01, VIS-02 +4 | T-1.02 | planned |  |
| REQ-DES-09 | Minimum visual change, maximum functional completeness. Any… | 124 | M-FUP-01, M-CAP-03 +4 |  |  |  | SM Tests field | T-0.02 | planned |  |
| REQ-DES-10 | Subtle motion, contextual transitions, useful loading states… | 123 | M-GL-03, M-GL-06 +23 |  | user_preferences | BO§5.3 | SM Tests field | T-0.03, T-8.02 +2 | planned |  |
| REQ-DES-11 | Design coverage audit row per requirement: requirement →… | 144 |  |  |  |  |  | T-0.02 | planned |  |
| REQ-DES-12 | A requirement with no reference screen gets a production screen… | 144 | M-PLAN-06, M-SET-20 +6 |  |  |  | SM Tests field | T-0.01 | planned |  |
| REQ-DES-13 | Each screen-map entry has: Screen ID, Route, Entry points… | 145 |  |  |  |  |  | T-0.01 | planned |  |

### 2.3 Architecture and monorepo

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-ARCH-01 | Layout: `apps/{mobile,web,backoffice}` and… | 6 |  | HLT-02, INT§1.1 |  |  | UT-RLS-01, CT-03 | T-1.17, T-2.25 | planned |  |
| REQ-ARCH-02 | Mobile stack: React Native, Expo, Expo Router, TypeScript strict… | 6 |  |  |  |  | QG-16 | T-0.03 | planned |  |
| REQ-ARCH-03 | Swift/Kotlin native modules where needed. | 6 | M-ON-14A, M-ANI-01 +1 | API-ANI-01, AI§1.8 +1 |  | SEC§4.1, SEC§4.16 | CT-09 | T-12.11 | planned |  |
| REQ-ARCH-04 | No dependency on Expo Go. Development Build and EAS compatible. | 6 |  |  |  |  |  | T-0.03 | planned |  |
| REQ-ARCH-05 | Web: Next.js App Router, TypeScript, SEO, responsive. | 6 |  |  |  | BO§2.4 | BO Tests row | T-0.03 | planned |  |
| REQ-ARCH-06 | Backoffice: Next.js App Router, TypeScript, desktop-first… | 6 |  |  |  | BO§2.1 | BO Tests row | T-0.03 | planned |  |
| REQ-ARCH-07 | Backend on Supabase (Postgres, Auth, Storage, Edge Functions… | 6 |  | HLT-02, INT§0.4 | oauth_credentials | BO§14.2, SEC§1.1 +1 | API Tests bullet | T-0.03 | planned |  |
| REQ-ARCH-08 | Current, mutually compatible, production-safe package versions… | 6 |  |  |  |  |  | T-0.03 | planned |  |
| REQ-ARCH-09 | Types, schemas, domain enums, validation, design tokens and API… | 7 | M-GL-07, M-CAP-06 +3 | API-ANL-01, HLT-02 +2 | analytics_events | BO§2.2, BO§2.5 +2 | CT-01, EF-SMOKE-01 | T-0.04, T-1.16 +1 | planned |  |
| REQ-ARCH-10 | Frontends have no server secrets. | 7 |  |  |  | BO§2.7, SEC§2.0 +1 | BO Tests row | T-10.02, T-11.06 +1 | planned |  |
| REQ-ARCH-11 | The service-role key never reaches a browser bundle. | 7 |  |  | app_installations, oauth_credentials | BO§7.7, CTL-3.9 +1 | QG-09 | T-2.02, T-2.21 | planned |  |
| REQ-ARCH-12 | AI API keys never reach mobile or web clients. | 7 |  | AI§16.4, INT§10.8 |  | BO§6.10, CTL-3.9 | API Tests bullet | T-0.04, T-3.10 | planned |  |
| REQ-ARCH-13 | Each backend capability contract states: Capability, Auth, Role… | 146 |  |  |  |  |  | T-1.16, T-3.11 | planned |  |
| REQ-ARCH-14 | A feature's real dependency chain exists before the feature… | 150 |  | JOB-15 |  |  | API Tests bullet | T-5.10 | planned |  |

### 2.4 Today and briefings

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-NAV-01 | Bottom navigation has exactly four tabs: Bugün, Akış, Plan… | 8 | M-GL-02, M-GL-03 +11 |  |  |  | SM Tests field | T-8.04, T-8.08 +3 | planned |  |
| REQ-NAV-02 | Profile/Settings opens from the avatar. | 8 | M-GL-04, M-ON-11 +19 |  | profiles, contacts |  | E2E-M-02 | T-8.04 | planned |  |
| REQ-TODAY-01 | Today is an editorial, calm, premium layout, not a dense… | 8 | M-TD-01, M-BR-05 +2 | AI§5.2 |  |  | SM Tests field | T-8.04 | planned |  |
| REQ-TODAY-02 | Greeting "Günaydın, {firstName}". | 8 | M-ON-03, M-BR-01 +1 | JOB-14, AI§12.3 +1 |  | CTL-3.12 | SM Tests field | T-8.08 | planned |  |
| REQ-TODAY-03 | Date line in Turkish long format ("23 Eylül 2026") in the user's… | 8 | M-GL-04, M-GL-14 +2 | AI§5.1, INT§13.2 |  |  | SM Tests field | T-8.08 | planned |  |
| REQ-TODAY-04 | Headline "Bugün bilmen gereken {N} şey var.", where N is the real… | 8 | M-ON-01, M-ON-13 +6 | API-ONB-02, JOB-14 +4 |  | CTL-3.12 | WEB-E2E-01, E2E-M-01 | T-1.04, T-5.08 +1 | planned |  |
| REQ-TODAY-05 | CTA "Brifingimi Gör" opens the Morning Briefing. | 8 | M-ON-13, M-TD-01 +3 | HLT-02 |  |  | E2E-M-01 | T-1.04, T-8.08 | planned |  |
| REQ-TODAY-06 | CTA "Dinle · {n} dk" plays the audio briefing; the duration is… | 8 | M-ON-03, M-TD-01 +4 | API-BRF-01, HLT-02 +1 |  |  | SM Tests field | T-1.04, T-8.08 | planned |  |
| REQ-TODAY-07 | Sections: Priorities, AI insight cards, Meeting, Deadline… | 8 | M-ON-09, M-TD-01 |  |  |  | SM Tests field | T-8.04 | planned |  |
| REQ-TODAY-08 | Approval badge with the pending count opens the Approval Center. | 8 | M-GL-04, M-TD-01 +1 |  |  |  | SM Tests field | T-8.08 | planned |  |
| REQ-BRIEF-01 | Morning Briefing is a full-screen narrative. | 9 | M-BR-01, M-BR-05 +3 | JOB-14, ADM-06 +2 | briefings | BO§6.7 | SM Tests field | T-2.07, T-5.08 +1 | planned |  |
| REQ-BRIEF-02 | Sections exactly: Bugünün Öncelikleri, Programın, Senden… | 9 | M-BR-01, M-MAIL-01 +3 | API-MAIL-06, JOB-14 +1 |  |  | E2E-M-05, E2E-M-11 | T-5.08 | planned |  |
| REQ-BRIEF-03 | Audio: play, pause, seek, ±15 s, speed. | 9 | M-BR-02, F-03 +1 | AI§14.2 |  |  | SM Tests field | T-8.09 | planned |  |
| REQ-BRIEF-04 | Native on-device TTS fallback. | 9 | M-CAP-01, M-MEET-01 +4 | API-AST-03, AI§1.8 +1 |  |  | SM Tests field | T-0.03, T-5.09 +1 | planned |  |
| REQ-BRIEF-05 | Pluggable external premium TTS adapter (server-side key). | 9 | M-BR-02, F-03 +1 | API-BRF-01, JOB-14 +1 | briefings | CTL-3.9, SEC§4.9 | SM Tests field | T-2.12, T-5.09 +1 | planned |  |
| REQ-BRIEF-06 | Midday is generated and notified only when a meaningful change… | 10 |  | JOB-14, AI§12.4 |  |  | UT-NTF-08 | T-5.08 | planned |  |
| REQ-BRIEF-07 | Midday copy pattern "Sabahından beri {n} önemli gelişme oldu." | 10 | M-GL-13, M-TD-01 +3 | JOB-14, AI§12.4 +1 |  | CTL-3.12 | E2E-M-05, E2E-M-16 | T-5.08 | planned |  |
| REQ-BRIEF-08 | No routine or meaningless midday notifications. | 10 | M-ON-02, M-ON-03 +17 | API-DEV-02, API-INT-05 +11 | user_preferences, connected_accounts +1 | BO§4.1, BO§6.3a +1 | UT-REM-06, UT-NTF-08 +3 | T-0.01, T-5.08 +2 | planned |  |
| REQ-BRIEF-09 | Evening copy pattern "Bugünden yarına {n} konu kaldı." | 11 | M-GL-13, M-TD-01 +3 | JOB-14, AI§12.5 +1 |  | CTL-3.12 | SM Tests field | T-5.08 | planned |  |
| REQ-BRIEF-10 | Evening sections: Tamamlananlar, Yarına Kalanlar, Takip, Yarının… | 11 | M-BR-04 | JOB-14, AI§12.5 |  |  | E2E-M-05 | T-5.08 | planned |  |
| REQ-BRIEF-11 | "Yarına Hazırım" → confirmation → persisted carry-over of open… | 11 | M-BR-04, M-BR-04C +1 | API-BRF-02, HLT-02 +1 | briefings |  | IT-AI-08, E2E-M-05 | T-8.09 | planned (patched → DB: `notification_preferences.snooze_until`) |  |
| REQ-BRIEF-12 | Weekly Review shows analyzed emails, important subjects… | 12 | M-BR-05, M-BR-06 | HLT-02 |  |  | SM Tests field | T-8.09 | planned |  |
| REQ-BRIEF-13 | Weekly share card is privacy-safe (no names, subjects or content). | 12 | M-BR-05, M-BR-06 +1 | API-BRF-03, HLT-02 +1 |  |  | E2E-M-05 | T-5.08, T-8.09 | planned |  |
| REQ-BRIEF-14 | Weekly sharing uses the native share sheet. | 12 | M-BR-06, F-06 +3 | API-BRF-03, HLT-02 |  |  | E2E-M-17 | T-8.09, T-8.22 | planned |  |

### 2.5 Flow, mail, reply, follow-up, commitments

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-FLOW-01 | Flow is a smart attention feed, not an inbox clone. | 13 | M-FLOW-01 |  |  |  | SM Tests field | T-5.05 | planned |  |
| REQ-FLOW-02 | Filters: Tümü, Önemli, Mail, Takvim, Takip, Kişisel. | 13 | M-FLOW-01 | AI§7.6 |  |  | UT-FLOW-01 | T-8.10 | planned |  |
| REQ-FLOW-03 | Card types: Email, Meeting, Deadline, Shipment, Flight… | 13 | M-FLOW-01 | HLT-02, RPC-05 | insights |  | SM Tests field | T-5.05 | planned |  |
| REQ-FLOW-04 | Every card action performs a real action. | 13 | M-ON-02, M-PLAN-06 | HLT-02, RPC-01 |  | BO§5.4, BO§14.2 | UT-MB-08, E2E-S-03 | T-1.01, T-8.04 +2 | planned |  |
| REQ-MAIL-01 | Categories: Önemli, Senden Cevap Bekleyen, Senin Cevap… | 14 | M-FLOW-01, M-MAIL-01 | AI§4.3, INT§13.3 | email_threads |  | UT-PRI-11, UT-PRI-13 +3 | T-1.11 | planned |  |
| REQ-MAIL-02 | AI summary shown first. | 14 | M-MAIL-01, M-MAIL-02 +1 | JOB-11, AI§4.3 | email_threads, email_messages | BO§6.9, BO§7.7 | SM Tests field | T-1.07 | planned |  |
| REQ-MAIL-03 | Each classification stores source, confidence, reason and… | 14 | M-TD-02, M-TD-03 +5 | JOB-10, AI§4.3 | email_threads, email_messages +1 | BO§7.4, BO§7.6 +1 | UT-PRI-17 | T-1.07 | planned |  |
| REQ-EMAIL-01 | Shows Sender, Subject, Date, AI Summary, Key Points, Source… | 15 | M-MAIL-03, M-MAIL-04 +1 | API-MAIL-01, HLT-02 +2 | email_messages | BO§2.1, SEC§0.2 +1 | E2E-M-06 | T-4.08, T-8.11 | planned |  |
| REQ-EMAIL-02 | Actions: Yanıt Hazırla, Görev Oluştur, Takvime Ekle, Hatırlat… | 15 | M-MAIL-03, M-CAP-06 +1 | API-APR-01, HLT-02 |  |  | E2E-M-06 | T-8.11 | planned |  |
| REQ-EMAIL-03 | Each action is wired to a real provider or domain flow. | 15 | M-MAIL-03, M-MAIL-04 | API-MAIL-01, JOB-15 +2 |  | BO§2.1, BO§2.5 +2 | UT-ENV-07, E2E-M-06 | T-0.04, T-2.16 +12 | planned |  |
| REQ-REPLY-01 | Tones: Kısa, Profesyonel, Samimi, Detaylı. | 16 | M-REPLY-01, F-06 +1 | API-MAIL-02, AI§4.3 | reply_drafts |  | E2E-M-07 | T-5.12 | planned |  |
| REQ-REPLY-02 | Flow: Generate → Edit → Approval → Send. | 16 | M-REPLY-01, M-ASST-02 +1 | API-MAIL-05, API-APR-03 +3 |  |  | E2E-M-07, E2E-M-13 | T-8.11 | planned (patched → API_CONTRACTS, DB: reply attachments (R-24)) |  |
| REQ-REPLY-03 | Silent send is impossible on every code path, including AI, voice… | 16 | M-GL-13, F-03 +1 | API-MAIL-02, API-AST-02 +2 |  | CTL-3.2, SEC§4.4 | SM Tests field | T-5.12 | planned |  |
| REQ-FOLLOW-01 | Two types: user waiting on others, and others waiting on the user. | 17 | M-FLOW-01, M-MAIL-01 +2 | API-MAIL-06, AI§1.8 +1 | email_threads |  | UT-CLS-04, UT-CLS-06 | T-1.11 | planned |  |
| REQ-FOLLOW-02 | "Takip mesajı hazırla" opens the Reply flow. | 17 | M-TD-01, M-BR-03 +5 | API-MAIL-06, HLT-02 +1 |  |  | E2E-S-05 | T-8.11 | planned |  |
| REQ-FOLLOW-03 | "Yarın hatırlat" opens the reminder flow. | 17 | M-TD-01, M-FUP-01 +1 | API-REM-02, HLT-02 |  |  | E2E-S-05 | T-8.11 | planned |  |
| REQ-FOLLOW-04 | "Kapat" persists the closed status. | 17 | M-GL-06, M-ON-06M +11 | HLT-02, RPC-01 +1 | commitments | BO§6.4 | E2E-S-05 | T-8.11 | planned |  |
| REQ-COMMIT-01 | Detects commitment statements ("Cuma gönderirim.", "Yarın"… | 18 | M-COMMIT-01, M-MEET-04 | AI§6.9 | commitments |  | UT-COM-01, UT-COM-04 +1 | T-1.11 | planned |  |
| REQ-COMMIT-02 | Model fields: commitment, person, due date, source, status… | 18 | M-TD-01, M-BR-01 +13 | API-APR-01, API-MEET-03 +7 | commitments | SEC§4.5, SEC§4.7 | E2E-F, E2E-M-12 | T-2.06, T-6.04 | planned |  |
| REQ-COMMIT-03 | Actions: Tamamlandı, Ertele, Kaynağı Gör. | 18 | M-TD-01, M-MAIL-03 +2 | HLT-02 |  |  | E2E-M-12 | T-8.12 | planned |  |
| REQ-COMMIT-04 | Created only with explicit source support. | 18 |  | API-APR-01, API-MEET-01 +2 |  |  | API Tests bullet | T-1.11 | planned |  |
| REQ-COMMIT-05 | Ambiguous inference requires user confirmation before creation. | 18 | M-BR-01, M-COMMIT-01 +3 | API-BIZ-01, API-BIZ-02 +2 |  |  | UT-DATE-02, UT-DATE-03 +9 | T-5.03 | planned |  |

### 2.6 Plan, calendar intelligence, meetings

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-PLAN-01 | Day and Week views. | 19 | M-PLAN-01, M-PLAN-02 |  |  |  | SM Tests field | T-1.12 | planned |  |
| REQ-PLAN-02 | Merges calendar events, tasks and commitments. | 19 | M-PLAN-01, M-PLAN-05 +1 | API-REM-01, HLT-02 +1 |  |  | SM Tests field | T-2.16, T-8.13 +1 | planned |  |
| REQ-PLAN-03 | AI schedule suggestion into a free slot, e.g. "Yarın 14:00–16:30"… | 19 | M-APPR-05, M-PLAN-04 +1 | API-PLAN-01, API-PLAN-02 +1 |  | SEC§4.4 | SM Tests field | T-5.14 | planned |  |
| REQ-PLAN-04 | Flow: proposed block → user approval → calendar update → updated… | 19 | M-TD-01, M-BR-05 +8 | API-PLAN-02, AI§13.6 |  | CTL-3.17, SEC§4.4 | SM Tests field | T-5.14 | planned |  |
| REQ-PLAN-05 | No calendar modification without approval. | 19 | M-ON-07, M-TD-01 +17 | API-APR-01, API-PLAN-02 +3 |  | SEC§0.2, CTL-3.16 | E2E-M-08 | T-5.14, T-6.03 +1 | planned |  |
| REQ-CAL-01 | Detects conflicts. | 20 | M-ON-06A, M-TD-01 +12 | API-APR-01, API-PLAN-03 +6 | insights, approval_actions | BO§2.5, BO§6.10 +2 | UT-MB-09, IT-APR-03 +1 | T-1.12, T-2.15 +4 | planned |  |
| REQ-CAL-02 | Detects back-to-back meetings. | 20 | M-PLAN-01, M-PLAN-02 | JOB-12, AI§1.8 |  |  | SM Tests field | T-1.12, T-5.05 | planned (patched → SCREEN_MAP_3: `kind=meeting` + `reason_code=back_to_back`) |  |
| REQ-CAL-03 | Detects preparation need. | 20 | M-PLAN-01, M-PLAN-02 | JOB-12 |  |  | SM Tests field | T-5.05 | planned (patched → SCREEN_MAP_3: `kind=meeting` + `reason_code=prep_needed`) |  |
| REQ-CAL-04 | Detects free slots. | 20 | M-REM-01, M-APPR-05 +3 | API-APR-02, API-REM-01 +5 |  | SEC§4.4 | UT-REM-05, E2E-J +1 | T-1.12, T-5.05 +3 | planned |  |
| REQ-CAL-05 | Surfaces deadlines. | 20 | M-GL-08, M-ON-08 +20 | API-REM-02, API-PLAN-02 +10 | user_preferences, notification_preferences +4 | CTL-3.12, CTL-3.15 | UT-CLS-04, UT-CLS-05 +4 | T-1.13, T-2.06 +5 | planned |  |
| REQ-CAL-06 | Uses location only when it is actually available. | 20 | M-TD-01, M-LIFE-01 +5 | API-INT-06, API-MEET-01 +2 | user_preferences, calendar_events +1 | BO§3.8, SEC§0.2 +1 | SM Tests field | T-1.12, T-2.06 +2 | planned |  |
| REQ-CAL-07 | Never fabricates travel time. | 20 |  | INT§12.8 |  | SEC§0.2 | API Tests bullet | T-1.12 | planned |  |
| REQ-PREP-01 | Shows person, meeting time, purpose, previous communication… | 21 | M-MEET-01, M-MEET-02 +1 | API-MEET-01, JOB-15 +1 |  |  | SM Tests field | T-5.10, T-8.14 | planned |  |
| REQ-PREP-02 | "2 Dakikalık Özet". | 21 | M-MEET-01, M-MEET-03 +1 | API-MEET-01, JOB-15 +1 | meeting_preps |  | E2E-M-11 | T-5.10, T-8.14 | planned |  |
| REQ-PREP-03 | Tapping a person opens Person Intelligence. | 21 | M-PERS-01 | AI§10.6 |  |  | SM Tests field | T-8.14, T-8.16 | planned |  |
| REQ-PREP-04 | Tapping a mail opens Email Detail. | 21 | M-FLOW-01, M-MAIL-01 +8 | HLT-02, AI§10.6 |  | CTL-3.13 | SM Tests field | T-8.11, T-8.14 | planned |  |
| REQ-PREP-05 | The meeting link is a real external handoff. | 21 | M-MEET-01 | API-MEET-01, HLT-02 |  |  | SM Tests field | T-8.14 | planned |  |
| REQ-POST-01 | At event end, prompts "Toplantın bitti. Takip etmen gereken bir"… | 22 | M-MEET-04, F-04 | API-MEET-03, AI§13.2 |  |  | E2E-M-12 | T-6.08 | planned |  |
| REQ-POST-02 | Accepts text or voice input. | 22 | M-MEET-04, F-04 | API-MEET-03, AI§1.8 |  |  | SM Tests field | T-5.10 | planned |  |
| REQ-POST-03 | Input → commitment proposal → approval → save. | 22 | M-COMMIT-01, M-CAP-06 +8 | API-APR-01, API-MEET-03 +4 | commitments | SEC§0.2, CTL-3.16 | UT-COM-03, UT-GRD-10 +3 | T-5.03, T-5.10 +1 | planned |  |

### 2.7 Life, assistant, voice, memory, capture, share, reminders

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-LIFE-01 | Detects Shipment, Flight, Reservation, Payment, Subscription and… | 23 | M-TD-01, M-LIFE-01 +8 | API-ANI-01, JOB-11 +6 | life_events, android_notification_signals | SEC§4.2, SEC§4.5 | IT-AI-03 | T-2.06 | planned |  |
| REQ-LIFE-02 | Every card is linked to its source. | 23 | M-GL-06, M-FLOW-01 +1 |  |  |  | SM Tests field | T-8.12 | planned |  |
| REQ-LIFE-03 | Amount and deadline are shown only when the source states them… | 23 | M-BR-01, M-COMMIT-02 +3 | API-AST-02, JOB-11 +1 | life_events | CTL-3.15 | UT-GRD-06, UT-GRD-14 +2 | T-1.04, T-1.13 +1 | planned |  |
| REQ-ASSIST-01 | Conversational AI interface, not the home screen. | 24 | M-ASST-01, M-ASST-02 +4 |  |  |  | SM Tests field | T-5.11 | planned |  |
| REQ-ASSIST-02 | Suggested prompts: "Bugün neye odaklanmalıyım?", "Kimlere cevap"… | 24 | M-ASST-01 | API-AST-02, AI§11.2 |  |  | E2E-M-13 | T-5.11 | planned |  |
| REQ-ASSIST-03 | Grounded retrieval over the user's own data. | 24 | M-GL-01, M-TD-03 +22 | API-AST-02, JOB-14 +1 | assistant_messages |  | UT-CLS-04, UT-CLS-05 +3 | T-5.11, T-8.12 | planned |  |
| REQ-ASSIST-04 | Source cards shown with answers. | 24 | M-MAIL-03, M-SRC-01 +5 | API-AST-02, AI§1.8 |  |  | IT-AI-10, E2E-M-13 | T-8.15 | planned |  |
| REQ-ASSIST-05 | Hallucination control is mandatory. | 24 |  | API-AST-02, AI§5.4 |  |  | API Tests bullet | T-12.11 | planned |  |
| REQ-VOICE-01 | Handles voice queries: "Bugün ne var?", "Brifingimi oku."… | 25 | M-BR-01, M-BR-02 +1 | AI§11.2 |  |  | SM Tests field | T-8.15 | planned |  |
| REQ-VOICE-02 | Any voice-initiated write requires approval. | 25 | M-ASST-03, M-VOICE-01 +1 | JOB-14, HLT-02 +2 | approval_actions | SEC§0.2 | IT-SYNC-07, IT-RC-07 | T-8.15 | planned |  |
| REQ-MEM-01 | Semantic search, e.g. "Geçen ay aldığım uçak bileti neydi?"… | 26 | M-MEM-01, M-SRCH-01 +1 | AI§10.5 |  |  | E2E-H, E2E-M-14 | T-5.07 | planned (patched → API_CONTRACTS: `/search` `mode=answer`, `contact_id`) |  |
| REQ-MEM-02 | pgvector preferred. | 26 | M-MEM-01 | JOB-16, AI§10.2 | memory_chunks |  | DB-25 | T-0.07, T-2.09 +1 | planned (patched → DB, API_CONTRACTS: `vector(1024)` Voyage (R-01)) |  |
| REQ-MEM-03 | Postgres full-text search as the fallback. | 26 | M-MEM-01, M-SRCH-01 +1 | API-AST-02, API-SRCH-01 +5 |  |  | DB-25, IT-AI-09 | T-2.16, T-5.07 | planned |  |
| REQ-MEM-04 | Every memory record is linked to its source and bound to the… | 26 | M-CAP-06, M-MEM-01 +3 | API-CAP-04, API-PRV-02 +5 | memory_chunks | SEC§4.2, SEC§4.5 | DB-11, IT-AI-09 +1 | T-2.09 | planned |  |
| REQ-CAPTURE-01 | Sources: Photo, Screenshot, PDF, File, Link, Text. | 27 | M-CAP-01 | API-CAP-01, AI§1.8 | captures | THR-17, THR-18 | VIS-01, VIS-03 +1 | T-8.17 | planned |  |
| REQ-CAPTURE-02 | Extracts Event, Task, Deadline, Person, Payment, Reservation… | 27 | M-CAP-06 | API-CAP-03, JOB-27 +1 | captures |  | SM Tests field | T-5.13 | planned |  |
| REQ-CAPTURE-03 | Suggested actions go through approval. | 27 | M-CAP-06 | API-CAP-04, AI§13.4 |  |  | IT-APR-14 | T-5.13 | planned |  |
| REQ-SHARE-01 | iOS native Share Extension accepts text, URL, image and PDF/file. | 28 | M-CAP-04 | AI§1.8, INT§0.2 |  | SEC§1.2, SEC§1.3 | SM Tests field | T-8.17, T-12.11 | planned |  |
| REQ-SHARE-02 | Android handles ACTION_SEND and ACTION_SEND_MULTIPLE. | 28 | M-CAP-04 | INT§12.4 |  |  | REL-14 | T-8.17 | planned |  |
| REQ-SHARE-03 | Share entry uses the common capture domain layer. | 28 | M-CAP-04 | AI§1.8, INT§0.5 |  |  | SM Tests field | T-0.03, T-12.11 | planned |  |
| REQ-REM-01 | Presets: 30 dakika önce, 1 saat önce, Bu akşam, Yarın sabah… | 29 | M-REM-01, M-SET-45 | API-REM-01, AI§7.3 |  |  | UT-REM-01, E2E-M-09 | T-1.12, T-8.18 | planned |  |
| REQ-REM-02 | "Uygun zamanda" uses calendar context. | 29 | M-REM-01 | API-REM-01, AI§6.9 | user_preferences |  | E2E-D, E2E-M-09 | T-1.12, T-6.06 +1 | planned |  |
| REQ-REM-03 | Reminder creation goes through confirmation or approval. | 29 | M-REM-01 | API-REM-01, AI§11.2 |  | CTL-3.17 | SM Tests field | T-1.12 | planned |  |

### 2.8 People, rules, personalization, approvals

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-PERSON-01 | The user can mark people as VIP. | 30 | M-ON-11, M-ON-11A +10 | JOB-10, JOB-22 +2 | vip_people | SEC§4.2, SEC§4.6 | UT-PRI-04 | T-2.06, T-2.19 +1 | planned (patched → SCREEN_MAP_1/3: `relationship`; `upsert_manual_contact` (R-24)) |  |
| REQ-PERSON-02 | Person page shows Last contact, Upcoming meetings, Open loops… | 30 | M-BR-04, M-COMMIT-01 +4 | HLT-02, RPC-03 +2 |  |  | UT-COM-07 | T-5.06 | planned |  |
| REQ-PERSON-03 | VIP status deterministically raises priority. | 30 | M-ON-11, M-SRC-01 +2 |  | vip_people |  | SM Tests field | T-1.07 | planned |  |
| REQ-RULES-01 | Dedicated CRUD UI for rules. | 31 | M-TD-03, M-VIP-01 +9 | API-PRV-02, JOB-10 +3 | email_threads, email_messages +2 | SEC§4.2, SEC§4.6 | SM Tests field | T-2.07 | planned |  |
| REQ-RULES-02 | Rule types: sender always important, domain always important, VIP… | 31 | M-MAIL-03, M-ANI-03 | AI§1.4 | email_threads |  | UT-PRI-02, UT-PRI-06 | T-1.07 | planned |  |
| REQ-RULES-03 | Engine order: explicit user rules → learned preference →… | 31 | M-TD-01, M-TD-03 +3 | AI§1.1 |  |  | UT-PRI-01, UT-PRI-02 +2 | T-1.07 | planned |  |
| REQ-RULES-04 | Explainability shown for each result where possible. | 31 | M-TD-03, M-SRC-01 +1 | AI§7.7 |  | SEC§4.14 | SM Tests field | T-1.07 | planned |  |
| REQ-PERS-01 | Learned preferences are stored and shown separately from explicit… | 32 | M-TD-02, M-FLOW-01 +8 | API-APR-04, API-PRV-02 +4 | email_threads, learned_preferences +1 | SEC§4.2, SEC§4.6 | SM Tests field | T-2.07 | planned (patched → DB: owner insert/update grants on `learned_preferences` (R-24)) |  |
| REQ-PERS-02 | Displays learned preferences, e.g. "Mehmet yüksek öncelikli."… | 32 | M-TD-02, M-FLOW-01 +8 | API-APR-04, API-PRV-02 +4 | email_threads, learned_preferences +1 | SEC§4.2, SEC§4.6 | SM Tests field | T-2.07 | planned (patched → DB: owner insert/update grants on `learned_preferences` (R-24)) |  |
| REQ-PERS-03 | The user can edit, disable or delete each learned preference. | 32 | M-TD-02, M-FLOW-01 +8 | API-APR-04, API-PRV-02 +4 | email_threads, learned_preferences +1 | SEC§4.2, SEC§4.6 | SM Tests field | T-2.07 | planned (patched → DB: `learned_preferences.params` update grant (R-24)) |  |
| REQ-PERS-04 | "Learn from interactions" toggle, persisted and enforced. | 32 | M-ON-09, M-TD-02 +4 | API-BOOT-01, API-APR-04 +3 | user_preferences, learned_preferences |  | UT-PRI-15 | T-2.04 | planned |  |
| REQ-APPR-01 | Statuses: pending, approved, rejected, executing, executed… | 33 | M-PLAN-01 | HLT-02, RPC-10 +1 | approval_actions, approval_events |  | SM Tests field | T-1.05 | planned |  |
| REQ-APPR-02 | Action types: email_send, calendar_create, calendar_update… | 33 | M-APPR-01 | AI§8.14 | approval_actions | BO§7.4, THR-09 +1 | SM Tests field | T-1.05 | planned |  |
| REQ-APPR-03 | Each item shows what, why, source, exact change… | 33 | F-04, M-REPLY-01 +2 | API-MAIL-04, API-MAIL-05 +12 |  | THR-10, CTL-3.15 | REL-08 | T-5.12, T-6.01 +1 | planned |  |
| REQ-APPR-04 | Buttons: Onayla, Düzenle, Reddet. | 33 | M-ON-04, M-APPR-01 | HLT-02 |  |  | SM Tests field | T-1.05 | planned |  |
| REQ-APPR-05 | Idempotency key is mandatory. | 33 | M-REPLY-01, M-REM-01 +7 | API-INT-06, API-APR-01 +10 | tasks, reminders +7 | BO§2.5, BO§6.14 +2 | DB-08, DB-16 +2 | T-2.06, T-2.08 +6 | planned |  |
| REQ-APPR-06 | The same action never executes twice. | 33 | M-GL-02, M-REPLY-02 +1 | ADM-12 |  |  | UT-REF-09, DB-18 +4 | T-0.01, T-1.10 +8 | planned |  |

### 2.9 Onboarding, notifications, Android NI, widgets

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-ONB-01 | Sequence: Welcome → Noise reduction → Proactive → Control/trust →… | 34 | M-GL-01, M-ON-10 +13 |  |  |  | SM Tests field | T-5.15 | planned |  |
| REQ-ONB-02 | First analysis covers about the last 72 hours. | 34 | M-ON-11, M-ON-12 +3 | API-ONB-01, API-ONB-02 +5 | approval_actions | CTL-3.16, CTL-3.20 | IT-SYNC-01, E2E-M-01 | T-4.03, T-5.15 | planned |  |
| REQ-ONB-03 | Shows mail count, important count, calendar count and follow-up… | 34 | M-ON-12, M-ON-13 +2 | API-ONB-01, API-ONB-02 +2 | jobs |  | SM Tests field | T-5.15 | planned |  |
| REQ-ONB-04 | Onboarding can be tested end to end in dev/demo mode without… | 34 | M-GL-04, M-ON-06 +18 | API-BOOT-01, API-INT-01 +6 | calendar_events | BO§13.4, CTL-3.6 +1 | DB-12, EF-DEMO-01 +7 | T-0.03, T-2.01 +17 | planned |  |
| REQ-NOTIF-01 | Per-category toggles: Morning, Midday, Evening, Critical Emails… | 35 | M-GL-08, M-BR-04C +3 | JOB-18, INT§9.3 | notification_preferences | CTL-3.12, SEC§4.16 | UT-NTF-02, UT-NTF-14 | T-8.24 | planned |  |
| REQ-NOTIF-02 | Quiet Hours. | 35 | F-03, M-REM-01 +8 | API-APR-01, API-REM-01 +4 | user_preferences, notification_preferences +1 | BO§6.8 | UT-TZ-08, UT-REM-09 +4 | T-1.08, T-1.12 +2 | planned (patched → DB, SCREEN_MAP_4: quiet-hours columns, 22:30–07:30 (R-13)) |  |
| REQ-NOTIF-03 | Lock Screen Privacy. | 35 | M-SET-20 | API-BOOT-01, HLT-02 +1 | notification_preferences | SEC§0.2, SEC§2.0 | E2E-S-10 | T-2.04, T-8.19 | planned |  |
| REQ-NOTIF-04 | Notification detail level setting. | 35 | M-ON-05, F-01 +4 | JOB-18, INT§9.5 | notification_preferences | BO§6.5, BO§6.14 +2 | UT-NTF-11, UT-NTF-13 +2 | T-1.08, T-2.04 +1 | planned |  |
| REQ-ANDNI-01 | Android-only and optional. | 36 | M-SET-01, M-SET-31 +1 | HLT-02, AI§1.8 +1 | app_installations | SEC§0.2, SEC§1.2 | UT-MB-11, REL-20 | T-1.07, T-8.06 +3 | planned |  |
| REQ-ANDNI-02 | Implemented as a native Kotlin NotificationListenerService. | 36 | M-ON-14A | INT§1.1 |  |  | SM Tests field | T-8.26 | planned |  |
| REQ-ANDNI-03 | Requires explicit user enablement. | 36 | M-ON-06G, M-ON-14A +2 | AI§14.1, INT§12.5 |  | SEC§4.10, SEC§4.13 | E2E-S-17 | T-8.26, T-12.11 | planned |  |
| REQ-ANDNI-04 | Mode choice: all apps or selected apps. | 36 | M-ANI-01 |  |  |  | SM Tests field | T-8.26 | planned (patched → SCREEN_MAP_1, API_CONTRACTS: `ni_mode` all/selected via `/devices/register`) |  |
| REQ-ANDNI-05 | Sensitive authentication apps are excluded by default. | 36 | M-ON-14A, M-ANI-01 +1 | API-ANI-01, HLT-02 +2 | android_notification_signals, feature_flags | SEC§1.4, THR-01 | QG-22, REL-20 | T-8.26 | planned |  |
| REQ-ANDNI-06 | iOS never pretends to have a system notification stream. | 36 | M-ON-07E, F-04 +4 |  |  | THR-01, SEC§4.1 | UT-REF-04, UT-NTF-04 +4 | T-8.22 | planned |  |
| REQ-ANDNI-07 | The feature never blocks the iOS core. | 36 | M-ANI-01 |  |  |  | SM Tests field | T-8.26 | planned |  |
| REQ-WIDGET-01 | iOS Small, Medium and Large widgets. | 37 |  | INT§12.2 |  |  | API Tests bullet | T-8.25 | planned (patched → SCREEN_MAP_4: M-WGT-01..03) |  |
| REQ-WIDGET-02 | iOS Lock Screen widgets where supported. | 37 |  | INT§12.2 |  |  | API Tests bullet | T-8.25 | planned (patched → SCREEN_MAP_4: M-WGT-04..06) |  |
| REQ-WIDGET-03 | Android 2×2 and 4×2 widgets. | 37 | M-BR-01 | INT§12.3 |  |  | REL-13 | T-8.25 | planned (patched → SCREEN_MAP_4: M-WGT-07/08) |  |
| REQ-WIDGET-04 | Widget data is privacy-safe. | 37 |  | INT§1.2 |  | CTL-3.13 | UT-WID-01, CT-09 | T-1.16, T-8.25 | planned (patched → SCREEN_MAP_4, API_CONTRACTS: M-WGT, `GET /widgets/snapshot`) |  |
| REQ-WIDGET-05 | Widget deep links open the real screens. | 37 | M-MEET-01 | INT§12.2 |  | SEC§4.9 | SM Tests field | T-8.25 | planned (patched → SCREEN_MAP_4: M-WGT deep links) |  |

### 2.10 Theme, localization, privacy, retention, analytics

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-THEME-01 | Appearance options: System, Light, Dark. | 38 | M-SET-01, M-SET-60 |  |  |  | E2E-I, E2E-M-18 | T-1.02 | planned |  |
| REQ-THEME-02 | All shared components are theme-aware. | 38 | M-GL-01, M-SET-60 |  |  | BO§5.7 | SM Tests field | T-8.02, T-10.04 | planned |  |
| REQ-THEME-03 | No hardcoded white surfaces in dark theme. | 38 | M-GL-01, M-GL-03 +18 | ADM-00, INT§12.2 | user_preferences, admin_preferences | BO§3.8, BO§5.1 | UT-MB-01, A11Y-08 +10 | T-1.02, T-8.01 +3 | planned |  |
| REQ-THEME-04 | Contrast verified in both themes. | 38 | M-MEET-01, M-SET-01 +1 |  |  | BO§5.9 | VIS-01, VIS-02 +4 | T-1.02 | planned |  |
| REQ-I18N-01 | Turkish is the default language. | 39 | M-MEET-03, M-VOICE-01 +2 | AI§14.1 |  |  | E2E-S-15 | T-8.19 | planned |  |
| REQ-I18N-02 | English is fully supported. | 39 | M-GL-07, M-SET-01 +1 | AI§5.1, INT§4.1 |  | BO§5.2 | E2E-S-15 | T-8.19, T-9.01 | planned (patched → SCREEN_MAP_1/4, API_CONTRACTS: `profiles.locale`) |  |
| REQ-I18N-03 | Every user-facing string uses an i18n key. | 39 | M-SET-62 |  |  | CTL-3.12 | QG-15 | T-1.07 | planned |  |
| REQ-I18N-04 | Turkish locale uses the 24-hour clock. | 39 | M-ON-10T | AI§5.1 |  | BO§5.8 | UT-TZ-09 | T-1.04 | planned |  |
| REQ-I18N-05 | Correct locale date formatting. | 39 | M-WAIT-01, M-SET-62 | INT§13.3 |  | BO§5.8 | UT-TZ-04, UT-TZ-10 | T-0.03, T-1.04 +2 | planned |  |
| REQ-I18N-06 | Europe/Istanbul timezone awareness. | 39 | M-ON-05, F-01 +5 | API-REM-01, AI§0.2 +1 | user_preferences | BO§5.8, BO§7.1 +1 | UT-TZ-01 | T-2.04 | planned |  |
| REQ-I18N-07 | Timezone is stored separately from the profile. | 39 | M-GL-01, M-ON-10 +4 | API-DEV-01, API-REM-01 +2 |  | SEC§0.1 | SM Tests field | T-2.18 | planned |  |
| REQ-PRIV-01 | Areas: Connected Accounts, Permissions, AI Accessible Data, Data… | 40 | M-SET-30, M-SET-32 | API-BOOT-01, API-MAIL-01 +5 | user_preferences | SEC§4.4, SEC§4.16 | SM Tests field | T-2.04 | planned |  |
| REQ-PRIV-02 | All privacy copy is true to the implemented architecture. | 40 | M-CAP-07, W-HOME-01 | AI§13.4, INT§13.4 |  | SEC§0.2, SEC§4.1 | SM Tests field | T-9.02 | planned |  |
| REQ-PRIV-03 | Copy: "Veriler aktarım sırasında ve saklanırken şifrelenir."… | 40 | M-SET-30 |  |  | SEC§4.1, SEC§4.3 | E2E-M-19 | T-8.20 | planned |  |
| REQ-PRIV-04 | No "uçtan uca şifreleme" claim unless E2E encryption is actually… | 40 | M-SET-30 |  |  | SEC§4.1 | E2E-M-19 | T-0.06 | planned |  |
| REQ-RET-01 | Default retention is 90 days. | 41 | M-SET-34 | JOB-20, INT§3.15 | user_preferences | SEC§4.5 | UT-RLS-04 | T-2.04 | planned |  |
| REQ-RET-02 | Options: 30 days, 90 days, 1 year, until the user deletes. | 41 | M-REM-02, M-SET-34 | JOB-20, INT§3.15 |  | SEC§4.3, SEC§4.5 | UT-RLS-04 | T-8.20 | planned |  |
| REQ-RET-03 | A scheduled cleanup job enforces retention. | 41 |  | JOB-20, JOB-21 +1 | app_installations, oauth_states +6 |  | DB-11 | T-11.04 | planned |  |
| REQ-RET-04 | Account deletion covers database, storage, embeddings, tokens… | 41 | M-ON-05N, M-SET-39 | API-PRV-03, JOB-23 +4 | jobs | BO§6.6, CTL-3.20 +1 | IT-PRIV-04 | T-11.03 | planned |  |
| REQ-RET-05 | Where provider revoke cannot be guaranteed, the limitation is… | 41 | M-ON-06A | API-INT-03 |  | THR-01 | SM Tests field | T-12.11 | planned |  |
| REQ-ANLY-01 | Product analytics are privacy-safe. | 42 | F-01, F-03 | API-ANL-01, JOB-20 +2 | analytics_events, support_access_grants | BO§6.3d, BO§7.1 +2 | SM Tests field | T-2.12 | planned (patched → SECURITY_AND_PRIVACY_PLAN: catalogue by reference (R-21)) |  |
| REQ-ANLY-02 | Never sent to analytics: raw email body, assistant conversation… | 42 |  |  |  | SEC§4.9 |  | T-1.16 | planned |  |
| REQ-ANLY-03 | Tracked: onboarding completion, briefing open, meeting prep… | 42 | M-GL-02, M-ON-15 +1 | API-BIZ-01, API-ANL-01 +1 | profiles, referrals | SEC§4.9 | E2E-M-01 | T-1.16 | planned (patched → SECURITY_AND_PRIVACY_PLAN: catalogue by reference (R-21)) |  |

### 2.11 Subscriptions, Free/Pro, referral

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-SUB-01 | Subscriptions run through RevenueCat. | 43 | M-GL-13, M-ON-06S +4 | API-BIZ-03, WH-05 +5 | webhook_events, subscriptions +1 | BO§2.5, BO§4.1 +2 | UT-ENT-06, UT-ENV-02 +6 | T-0.04, T-2.11 +5 | planned |  |
| REQ-SUB-02 | Entitlement id `pro`. | 43 |  | INT§10.1 |  | BO§6.3e | UT-ENT-01, UT-ENT-02 +2 | T-8.22 | planned |  |
| REQ-SUB-03 | Products `da_pro_monthly` and `da_pro_annual`. | 43 |  | INT§10.1 | subscriptions |  | API Tests bullet | T-7.01 | planned |  |
| REQ-SUB-04 | UI offers Monthly, Annual, a free trial only if the store product… | 43 | M-SUB-01, M-PAY-01 |  |  |  | SM Tests field | T-7.01 | planned |  |
| REQ-SUB-05 | A single central entitlement state. | 43 | M-SUB-01 | API-BOOT-01, API-BOOT-02 +4 | vip_people | BO§6.2, BO§6.3e | DB-17, IT-RC-08 | T-2.15, T-2.16 +1 | planned |  |
| REQ-SUB-06 | Store entitlements are stored and shown separately from referral… | 43 | M-SUB-01 | API-BOOT-02, JOB-25 +3 | entitlement_grants, referral_credits | BO§6.3e, BO§6.13 +2 | DB-03, DB-19 | T-2.11, T-7.03 | planned |  |
| REQ-PLANS-01 | Free: 1 email account, 1 calendar, Morning Briefing, basic… | 44 | M-ON-06, M-ON-07 +3 | API-BOOT-01, API-BOOT-02 +3 | connected_accounts, calendars +2 | BO§4.1, BO§6.3d +1 | SM Tests field | T-2.11 | planned (patched → DB, API_CONTRACTS: `plan_limits` keys (R-22)) |  |
| REQ-PLANS-02 | Pro: multiple email accounts, multiple calendars, Midday… | 44 | M-GL-13, M-TD-01 +23 | API-SRCH-01, HLT-02 +1 | user_preferences, meeting_preps +1 |  | E2E-M-01, E2E-M-03 +1 | T-8.03, T-8.08 +2 | planned |  |
| REQ-PLANS-03 | Critical Pro features are also checked server-side. | 44 |  | API-INT-01, API-INT-02 +20 |  |  | API Tests bullet | T-1.09 | planned |  |
| REQ-REF-01 | Referral link and code. | 45 | M-GL-07, M-ON-05 +7 | API-BIZ-01, API-BIZ-02 +2 | referral_codes | BO§6.3f, CTL-3.18 +1 | VIS-01, WEB-E2E-07 +3 | T-2.11, T-9.05 | planned |  |
| REQ-REF-02 | An eligible referral gives bonus Pro to both parties. | 45 | M-REF-01 | JOB-25 | entitlement_grants, referral_credits | BO§6.3f, BO§6.15 +2 | DB-03, DB-19 | T-2.11, T-7.03 | planned |  |
| REQ-REF-03 | Anti-abuse: self-referral prevention, duplicate-account… | 45 | M-REF-01, W-LEGAL-02 | JOB-25 |  |  | SM Tests field | T-1.10 | planned |  |
| REQ-REF-04 | Referrals are visible in the backoffice. | 45 | M-GL-07, M-ON-05 +11 | API-DEV-01, API-BOOT-01 +13 | app_installations, entitlement_grants +6 | BO§2.2, BO§4.1 +2 | UT-REF-01, UT-REF-02 +12 | T-1.04, T-1.09 +19 | planned |  |
| REQ-REF-05 | Invites use the native share sheet. | 45 | M-REF-01 | HLT-02 |  |  | E2E-M-17 | T-1.10 | planned |  |

### 2.12 Backoffice

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-BO-GEN-01 | The backoffice is a separate web app, never inside the mobile app. | 46 | M-ON-05, M-TD-01 +10 | API-BOOT-02, ADM-11 +2 | connected_accounts, learned_preferences +1 | BO§2.5, BO§2.8 +2 | SM Tests field | T-2.04, T-10.11 | planned |  |
| REQ-BO-GEN-02 | Desktop-first. | 46 |  |  |  | BO§2.1 | BO Tests row | T-10.02 | planned |  |
| REQ-BO-GEN-03 | Deployable at admin.{domain}. | 46 |  |  |  | BO§2.7, BO§2.8 +1 | BO Tests row | T-10.02 | planned |  |
| REQ-BO-GEN-04 | Separate authentication, session and RBAC boundary. | 46 |  |  |  | BO§2.1, BO§2.3 +2 | BO-E2E-01 | T-10.02 | planned |  |
| REQ-BO-GEN-05 | Sidebar IA exactly: Overview (Dashboard); Users (Users, Support)… | 46 |  |  |  | BO§2.2, BO§4.3 +1 | UT-RBAC-05, BO-E2E-08 | T-10.04 | planned |  |
| REQ-BO-RBAC-01 | Roles: super_admin, operations, support, finance, ai_ops… | 47 |  | ADM-14, AI§1.6 | ai_model_config | BO§4.2, BO§13.4 +1 | UT-RBAC-04, BO-E2E-04 +4 | T-1.14 | planned |  |
| REQ-BO-RBAC-02 | RBAC is enforced server-side. | 47 |  |  | admin_sessions | BO§2.1, BO§2.6 +2 | UT-RLS-06 | T-2.15, T-2.17 | planned |  |
| REQ-BO-RBAC-03 | Hiding a sidebar item is never treated as authorization. | 47 |  |  |  | BO§4.3 | UT-RBAC-05 | T-10.04 | planned |  |
| REQ-BO-RBAC-04 | Every sensitive mutation re-checks permission on the backend. | 47 | M-GL-09, M-ON-07 +5 | API-APR-02, API-APR-03 +7 | android_notification_signals | BO§2.4, CTL-3.16 +1 | SM Tests field | T-1.14 | planned |  |
| REQ-BO-SEC-01 | Secure cookie/session. | 48 |  |  |  | BO§2.1, BO§2.4 | BO-E2E-01 | T-10.02 | planned |  |
| REQ-BO-SEC-02 | Server-side authorization. | 48 | M-ON-06, M-ON-08 +18 | API-DEV-01, API-INT-01 +8 | connected_accounts, android_notification_signals +1 | BO§3.2, BO§3.5 +2 | EF-AI-01, EF-NTF-01 | T-1.08, T-4.12 +3 | planned |  |
| REQ-BO-SEC-03 | Rate limiting. | 48 | M-FLOW-01, M-SET-20 +1 | API-INT-04, API-SUP-01 +6 |  | BO§2.1, BO§2.5 +2 | EF-PUB-01 | T-2.15, T-3.03 +2 | planned |  |
| REQ-BO-SEC-04 | Session expiry. | 48 | M-GL-14, M-MEET-02 +9 | ADM-00, INT§2.9 | sync_states, admin_sessions | BO§2.3, BO§2.5 +2 | DB-05, EF-ADM-01 +1 | T-2.15, T-10.01 +1 | planned |  |
| REQ-BO-SEC-05 | "Logout all sessions". | 48 |  | ADM-00, HLT-02 |  | BO§3.7, BO§6.24 +1 | BO-E2E-06 | T-10.01 | planned |  |
| REQ-BO-SEC-06 | MFA-ready architecture. | 48 |  | ADM-00, HLT-02 +1 | ai_model_config, prompt_versions +8 | BO§2.3, BO§2.4 +2 | UT-RLS-06 | T-2.15, T-2.19 +4 | planned |  |
| REQ-BO-SEC-07 | CSRF-safe mutation patterns where relevant. | 48 |  |  |  | BO§3.10, SEC§1.4 +1 | BO Tests row | T-10.01 | planned |  |
| REQ-BO-SEC-08 | Audit logging. | 48 | F-01 | JOB-17, JOB-20 +4 | approval_actions, audit_logs | BO§2.5, BO§2.6 +2 | DB-04, DB-07 +1 | T-2.14, T-12.11 | planned |  |
| REQ-BO-SEC-09 | Hidden by default: raw email body, assistant conversations, OAuth… | 48 | M-MAIL-03, M-REPLY-01 +2 | API-BIZ-02, ADM-02 +6 | profiles, connected_accounts +6 | BO§2.5, BO§4.1 +2 | DB-14, BO-E2E-10 +3 | T-2.17, T-10.04 | planned |  |
| REQ-BO-SUPP-01 | No impersonation / "login as user" by default. | 49 |  | ADM-03 | support_access_grants | BO§2.1, BO§7.7 +2 | DB-00 | T-10.07 | planned |  |
| REQ-BO-SUPP-02 | Privacy-safe support view shows User ID, account status, plan… | 49 |  |  |  | BO§6.3a, BO§6.4 | REL-20 | T-10.07 | planned |  |
| REQ-BO-SUPP-03 | Sensitive content reveal requires an authorized role, a mandatory… | 49 |  | ADM-03 | support_access_grants | BO§7.7, BO§14.2 +2 | API Tests bullet | T-2.14 | planned |  |
| REQ-BO-DASH-01 | Metrics: Total, Active, New, Pro, Trials, Connected emails… | 50 |  |  |  | BO§4.1, BO§5.1 | BO-E2E-09, BO-E2E-18 | T-10.05 | planned |  |
| REQ-BO-DASH-02 | Charts: User growth, Active usage, AI costs, Subscriptions, Sync… | 50 |  | ADM-01 |  | BO§6.1, BO§7.3 | API Tests bullet | T-10.05 | planned |  |
| REQ-BO-DASH-03 | Ranges: 24h, 7d, 30d, 90d. | 50 |  | ADM-01 |  | BO§6.1, BO§13.4 | BO-E2E-09 | T-10.05 | planned |  |
| REQ-BO-USERS-01 | Table columns: User, Email, Plan, Created, Last Active, Platform… | 51 |  | ADM-02 | profiles | BO§2.5, BO§6.2 | API Tests bullet | T-2.04 | planned |  |
| REQ-BO-USERS-02 | Filters: Free, Pro, Trial, Inactive, Sync Error, Connection Error. | 51 |  |  |  | BO§6.2, BO§13.4 | BO-E2E-10 | T-10.06 | planned |  |
| REQ-BO-USERS-03 | Server-side pagination. The full user DB is never loaded… | 51 |  |  |  | BO§6.0, BO§6.1 | BO-E2E-10 | T-10.04, T-10.06 | planned |  |
| REQ-BO-USERS-04 | Detail tabs: Overview, Integrations, Briefings, Usage… | 51 |  |  |  | BO§4.1, BO§6.3h | BO Tests row | T-10.06 | planned |  |
| REQ-BO-USERS-05 | Force Sync, Disable Account, Restore, Temporary Pro Grant and… | 51 |  |  |  | BO§5.4, BO§6.3a +1 | BO-E2E-12 | T-10.06 | planned |  |
| REQ-BO-INT-01 | Integrations view covers Google, Microsoft and Apple-device. | 52 | M-ON-07 | API-INT-01, API-INT-06 +4 |  | BO§6.2, BO§6.5 | SM Tests field | T-4.11 | planned |  |
| REQ-BO-INT-02 | Statuses: healthy, needs reconnect, OAuth error, refresh error… | 52 | M-ON-06, M-TD-01 +6 | API-INT-04, JOB-01 +2 | connected_accounts | BO§5.1, BO§6.2 +2 | IT-OAUTH-08 | T-4.02, T-4.07 | planned |  |
| REQ-BO-INT-03 | Raw tokens are never shown. | 52 | M-GL-01, M-GL-02 +27 | API-DEV-01, API-DEV-02 +26 | push_tokens, oauth_credentials +10 | BO§2.1, BO§2.2 +2 | UT-GRD-04, UT-RLS-01 +21 | T-0.02, T-0.06 +29 | planned |  |
| REQ-BO-JOBS-01 | Job statuses: Queued, Running, Completed, Retrying, Failed, Dead… | 53 | M-ON-12 | JOB-00, ADM-05 +2 | jobs, job_attempts | BO§5.1, BO§6.6 | DB-16, IT-APR-10 +2 | T-3.06 | planned |  |
| REQ-BO-JOBS-02 | Job types: Initial Sync, Gmail Sync, Outlook Sync, Calendar Sync… | 53 |  | API-INT-04, JOB-02 +3 |  | BO§6.3a, BO§7.3 +1 | API Tests bullet | T-4.03, T-4.04 | planned |  |
| REQ-BO-JOBS-03 | Safe retry mechanism. | 53 | M-GL-02, M-GL-10 +32 | API-BOOT-01, API-INT-06 +20 | referral_codes, jobs +2 | BO§2.2, BO§3.2 +2 | IT-SYNC-05, IT-AI-09 +11 | T-1.14, T-1.17 +11 | planned |  |
| REQ-BO-JOBS-04 | Jobs are idempotent. | 53 | M-ON-12, M-TD-02 +30 | API-DEV-02, API-INT-06 +23 | email_messages, tasks +8 | BO§2.1, BO§2.5 +2 | DB-08, DB-15 +6 | T-0.07, T-1.05 +18 | planned |  |
| REQ-BO-JOBS-05 | Dead-letter visibility. | 53 | M-ON-12, M-TD-01 +1 | JOB-00, ADM-05 +2 | jobs, job_attempts | BO§4.1, BO§5.1 +2 | DB-16, IT-APR-10 +2 | T-2.15, T-2.23 +2 | planned |  |
| REQ-BO-BRIEF-01 | Covers Morning, Midday, Evening and Weekly briefings. | 54 | M-GL-08, M-GL-13 +10 | JOB-14, JOB-18 +4 | user_preferences, notification_preferences +5 | BO§6.3c, BO§6.17 +1 | UT-ENT-09, UT-NTF-01 +7 | T-2.12, T-2.18 +1 | planned |  |
| REQ-BO-BRIEF-02 | Metrics: scheduled, generated, delivered, failed, skipped… | 54 | M-ON-02, M-ON-03 +17 | API-DEV-02, API-INT-05 +11 | user_preferences, connected_accounts +1 | BO§4.1, BO§6.3a +1 | UT-REM-06, UT-NTF-08 +3 | T-0.01, T-5.08 +2 | planned |  |
| REQ-BO-NOTIF-01 | Metrics: scheduled, sent, failed, suppressed, deduplicated. | 55 | M-SET-14 | JOB-18, ADM-07 | notifications, billing_events | BO§6.8, BO§7.4 | UT-NTF-04, IT-NTF-01 | T-10.09 | planned |  |
| REQ-BO-NOTIF-02 | User-level debugging that is privacy-safe. | 55 |  |  |  | BO§6.5, BO§6.6 | BO Tests row | T-10.09 | planned |  |
| REQ-BO-NOTIF-03 | Push test action restricted to authorized roles. | 55 |  |  | push_tokens, notifications | BO§3.9, BO§5.4 | BO-E2E-17 | T-10.09 | planned |  |
| REQ-BO-AIOPS-01 | Shows requests, input/output tokens where available, estimated… | 56 | M-FUP-01, M-ASST-02 | WH-03, ADM-06 +4 | briefings, ai_requests +1 | BO§3.7, BO§4.1 +1 | BO-E2E-16 | T-3.07, T-10.09 +1 | planned |  |
| REQ-BO-AIOPS-02 | Feature breakdown: Email Classification, Briefing, Assistant… | 56 |  | JOB-10, ADM-08 +3 | prompt_versions | BO§6.11, BO§6.17 | API Tests bullet | T-5.01, T-5.16 +1 | planned |  |
| REQ-BO-AIOPS-03 | Charts: daily cost, feature cost, model cost, p50 latency, p95… | 56 |  | WH-03, ADM-06 +2 |  | BO§5.3, BO§6.7 | BO-E2E-18 | T-10.10 | planned |  |
| REQ-BO-MODEL-01 | Secrets are never shown; only configured / not configured. | 57 | M-ON-05, M-ON-06 +2 | API-BRF-01, JOB-07 +6 | ai_model_config | BO§6.4, BO§6.9 | EF-HLT-01, BO-E2E-18 +1 | T-3.07, T-10.14 +1 | planned |  |
| REQ-BO-MODEL-02 | Configurable: classifier model, reasoning model, embedding model… | 57 |  | HLT-02, INT§1.2 | ai_model_config | BO§6.10, BO§14.2 | API Tests bullet | T-10.10 | planned (patched → BACKOFFICE_PLAN, API_CONTRACTS ADM-08: Voyage 1024-d, routing profile (R-01, R-18)) |  |
| REQ-BO-MODEL-03 | Every config change is audited. | 57 | F-01, M-MEM-01 | API-MAIL-02, API-MEET-03 +8 | ai_model_config | BO§4.1, BO§6.10 +1 | EF-AI-02 | T-2.07, T-2.17 +2 | planned |  |
| REQ-BO-MODEL-04 | Model provider abstraction. | 57 | M-GL-01, M-GL-07 +56 | API-DEV-01, API-DEV-02 +89 | connected_accounts, oauth_credentials +16 | BO§2.1, BO§6.2 +2 | UT-ENV-05, UT-LINK-01 +21 | T-1.15, T-1.16 +37 | planned |  |
| REQ-BO-PROMPT-01 | Versioned prompts: Email Classification, Briefing, Meeting Prep… | 58 |  | API-MAIL-02, JOB-10 +1 | email_threads, email_messages +5 | BO§6.11, BO§7.7 +1 | DB-28 | T-2.07, T-3.09 | planned |  |
| REQ-BO-PROMPT-02 | Prompt statuses: Draft, Active, Archived. | 58 |  | ADM-09, AI§5.4 | assistant_threads, prompt_versions | BO§6.11, BO§6.17 | API Tests bullet | T-10.10 | planned |  |
| REQ-BO-PROMPT-03 | Diff view between versions. | 58 | M-REPLY-01, M-APPR-03 +3 | API-DEV-01, API-REM-02 +7 |  | BO§6.10, BO§6.11 +1 | UT-GRD-05, VIS-01 +3 | T-2.25, T-4.01 +3 | planned |  |
| REQ-BO-PROMPT-04 | Activate and Rollback. | 58 | M-FLOW-01, M-MAIL-04 +2 | ADM-09, AI§1.2 | prompt_versions | BO§4.1, BO§5.4 | DB-28, BO-E2E-19 | T-2.17, T-10.10 | planned |  |
| REQ-BO-PROMPT-05 | Every prompt change is audited. | 58 | M-ON-14 | ADM-09, HLT-02 | prompt_versions | BO§6.11, BO§7.7 +1 | SM Tests field | T-8.06 | planned |  |
| REQ-BO-PROMPT-06 | Prompt version is linked to AI output telemetry. | 58 | M-BR-01, M-REPLY-01 +2 | API-MAIL-02, API-MAIL-03 +5 | email_threads, email_messages +6 | BO§6.11, BO§7.6 | IT-AI-04 | T-2.07 | planned |  |
| REQ-BO-AIFB-01 | Aggregates positive/negative feedback by feature, model and… | 59 | M-TD-02, M-BR-01 +19 | API-APR-04, API-PRV-01 +5 | email_threads, learned_preferences +1 | BO§4.1, BO§4.2 +2 | SM Tests field | T-2.07, T-2.17 +1 | planned |  |
| REQ-BO-AIFB-02 | Private content hidden by default. | 59 | M-GL-04, M-GL-13 +43 | API-INT-03, API-INT-05 +4 | app_installations, push_tokens +3 | BO§4.3, BO§5.3 +2 | UT-REM-02, UT-REM-03 +4 | T-1.03, T-8.22 +2 | planned |  |
| REQ-BO-SUBS-01 | Shows Active Pro, Trials, Cancelled, Expired, Refunded, MRR, ARR… | 60 |  | ADM-11, AI§10.10 |  | BO§4.1, BO§6.13 | BO-E2E-21 | T-10.11 | planned |  |
| REQ-BO-SUBS-02 | Store entitlements are clearly separated from admin grants. | 60 |  | API-BOOT-02, JOB-25 +3 | entitlement_grants, referral_credits | BO§6.3e, BO§6.13 +2 | DB-03, DB-19 | T-2.11, T-7.03 | planned |  |
| REQ-BO-ENT-01 | Entitlement override is limited to authorized roles. | 61 | M-GL-13, M-ON-06 +35 | API-BOOT-01, API-BOOT-02 +10 | vip_people, subscriptions +2 | BO§4.1, BO§4.2 +2 | UT-ENT-06, UT-ENT-10 +7 | T-1.09, T-1.14 +13 | planned |  |
| REQ-BO-ENT-02 | Temporary Pro durations: 1, 7, 14 or 30 days. | 61 |  | ADM-02 |  | BO§4.1, BO§6.14 +1 | API Tests bullet | T-10.06 | planned |  |
| REQ-BO-ENT-03 | A reason is mandatory. | 61 | M-ON-06G, M-TD-02 +24 | API-DEV-01, API-DEV-02 +45 | profiles, user_preferences +22 | BO§2.3, BO§2.4 +2 | UT-PRI-01, UT-PRI-04 +13 | T-0.01, T-1.07 +23 | planned |  |
| REQ-BO-REF-01 | Referral metrics: invites, successful referrals, conversion… | 62 | M-REF-01, W-LEGAL-02 | API-DEV-01, JOB-23 +2 | app_installations, referrals | BO§6.15, SEC§2.0 +1 | SM Tests field | T-1.10, T-11.05 | planned |  |
| REQ-BO-TICKET-01 | Ticket statuses: Open, In Progress, Waiting User, Resolved… | 62 |  |  |  | BO§5.1, BO§6.4 | BO Tests row | T-10.07 | planned |  |
| REQ-BO-TICKET-02 | Ticket categories: Account, Integration, Sync, Billing, AI… | 62 |  | API-SUP-01, PUB-01 | support_tickets | BO§6.4 | API Tests bullet | T-10.07 | planned |  |
| REQ-BO-FEEDBACK-01 | Feedback types: Bug, Feature, General, AI Quality. | 62 |  | API-SUP-02 | user_feedback | BO§6.16, BO§14.2 +2 | API Tests bullet | T-2.12 | planned |  |
| REQ-BO-FEEDBACK-02 | Feedback and tickets carry platform, app version, status and… | 62 | M-GL-02, M-GL-12 +2 | API-DEV-01, API-SUP-01 +6 | app_installations, analytics_events +4 | BO§6.4, BO§6.16 +2 | SM Tests field | T-2.15 | planned |  |
| REQ-BO-FLAGS-01 | Flags include midday, evening, voice, meeting prep, capture… | 63 | M-GL-12, M-ON-14A | API-BOOT-01, ADM-20 +3 | feature_flags, feature_flag_overrides | BO§14.2, CTL-3.20 | SM Tests field | T-2.12 | planned |  |
| REQ-BO-FLAGS-02 | Targeting: global, percentage, platform, plan, version. | 63 |  | ADM-14, AI§8.11 | feature_flags | BO§6.17, BO§13.1 | UT-FLAG-01, BO-E2E-26 | T-2.12, T-10.12 | planned |  |
| REQ-BO-FLAGS-03 | Kill switch. | 63 |  | ADM-14, AI§1.1 +1 | feature_flags | BO§4.1, BO§5.4 +2 | UT-FLAG-01, IT-AI-06 +1 | T-3.09, T-10.12 +1 | planned |  |
| REQ-BO-FLAGS-04 | Flag changes are audited. | 63 |  | ADM-14, HLT-02 +2 | feature_flags, feature_flag_overrides | BO§6.17, BO§7.7 +1 | API Tests bullet | T-1.06, T-8.01 | planned |  |
| REQ-BO-ANN-01 | Announcement fields: title, body, audience, platform, version… | 64 | W-LEGAL-02 | API-BOOT-01, ADM-15 | announcements, announcement_dismissals | BO§2.2, BO§4.1 +1 | DB-29, BO-E2E-27 | T-2.12, T-2.17 +2 | planned |  |
| REQ-BO-ANN-02 | Preview, Schedule, Cancel. | 64 | M-GL-01, M-ON-04 +27 | API-CAP-02, JOB-01 +5 |  | BO§2.7, BO§2.8 +2 | E2E-S-11, TST-E2E-M-04 +2 | T-2.01, T-2.16 +6 | planned |  |
| REQ-BO-ANN-03 | The mobile client fetches and renders active announcements… | 64, derived | W-LEGAL-02 | API-BOOT-01, ADM-15 +2 | announcements, announcement_dismissals | BO§2.2, BO§4.1 +1 | DB-29, BO-E2E-27 | T-2.12, T-2.16 +5 | planned (patched → SCREEN_MAP_1: Today announcement banner (R-25)) |  |
| REQ-BO-DATAREQ-01 | Tabs: Exports, History Deletion, Account Deletion. | 65 | M-SET-35, M-SET-36 | API-PRV-02, JOB-22 +3 |  | BO§6.6, SEC§0.2 +1 | IT-PRIV-03 | T-10.13, T-11.02 | planned |  |
| REQ-BO-DATAREQ-02 | Request statuses are shown. | 65 | M-SET-30, M-SET-38 | API-PRV-01, JOB-21 +1 | data_export_requests | BO§6.19, SEC§4.2 +1 | DB-27 | T-2.13 | planned |  |
| REQ-BO-DATAREQ-03 | Failed requests can be retried. | 65 | M-GL-02, M-GL-10 +32 | API-BOOT-01, API-INT-06 +20 | referral_codes, jobs +2 | BO§2.2, BO§3.2 +2 | IT-SYNC-05, IT-AI-09 +11 | T-1.14, T-1.17 +11 | planned |  |
| REQ-BO-DATAREQ-04 | Manual sensitive actions require permission, reason and audit. | 65 | M-ON-06G, M-TD-02 +24 | API-DEV-01, API-DEV-02 +45 | profiles, user_preferences +22 | BO§2.3, BO§2.4 +2 | UT-PRI-01, UT-PRI-04 +13 | T-0.01, T-1.07 +23 | planned |  |
| REQ-BO-AUDIT-01 | Log fields: timestamp, admin, role, action, target, reason… | 66 | F-01 | JOB-17, JOB-20 +5 | approval_actions, audit_logs | BO§2.5, BO§2.6 +2 | DB-04, DB-07 +1 | T-2.14, T-12.11 | planned |  |
| REQ-BO-AUDIT-02 | No function exists to delete audit records. | 66 |  | API-MAIL-01, API-APR-02 +2 | contacts, prompt_versions | BO§6.20, BO§7.7 +2 | IT-SYNC-11 | T-2.08, T-2.14 +1 | planned |  |
| REQ-BO-AUDIT-03 | Sensitive-action logs are complete and immutable. | 66 |  | HLT-02 |  | BO§6.20, BO§7.7 +2 | API Tests bullet | T-2.14, T-2.23 +1 | planned |  |
| REQ-BO-HEALTH-01 | Real health checks: API, Database, Supabase, Google OAuth… | 67 |  | JOB-19, JOB-26 +4 | system_health_checks | BO§6.21, BO§7.7 +2 | DB-04 | T-2.12, T-3.07 | planned |  |
| REQ-BO-HEALTH-02 | No fake green status. | 67 | M-ON-06, M-TD-01 +3 | ADM-18, HLT-02 +1 | system_health_checks | BO§6.21, BO§7.7 +1 | EF-HLT-01 | T-0.05, T-2.22 +5 | planned |  |
| REQ-BO-ADMINS-01 | Invite admin, role, status, last login, MFA state, disable… | 68 |  | ADM-19 | profiles, ai_model_config +14 | BO§2.6, BO§3.1 +2 | API Tests bullet | T-2.14 | planned |  |
| REQ-BO-ADMINS-02 | The last super_admin cannot be deleted or disabled. | 68 |  | ADM-19 |  | BO§13.4, THR-12 +1 | BO-E2E-31 | T-2.14, T-2.23 | planned |  |
| REQ-BO-CMDK-01 | Command palette opens with Cmd/Ctrl+K. | 69 |  |  |  | BO§6.25, BO§13.4 | A11Y-09, BO-E2E-33 | T-10.04 | planned |  |
| REQ-BO-CMDK-02 | Searches user email, user ID, job ID, ticket ID, subscription ID… | 69 | M-REF-02 | API-BIZ-01, ADM-21 +1 |  | BO§6.25 | SM Tests field | T-1.10, T-2.04 | planned |  |
| REQ-BO-CMDK-03 | Never searches raw user email content. | 69 | M-ON-11, M-MAIL-01 +3 | ADM-21 |  | BO§2.1, BO§2.2 +2 | A11Y-09, BO-E2E-10 +1 | T-1.02, T-2.17 +2 | planned |  |
| REQ-BO-CMDK-04 | Destructive commands open a confirmation flow instead of… | 69 | M-GL-06, M-ON-06A +11 | API-PRV-02, ADM-21 |  | BO§5.1, BO§5.4 +2 | BO-E2E-33 | T-10.04 | planned |  |
| REQ-BO-TABLE-01 | Every large table supports server pagination, sorting, filtering… | 70 |  | INT§3.1 | admin_preferences | BO§13.1, BO§13.4 | BO-E2E-10 | T-10.04 | planned |  |
| REQ-BO-PRIV-01 | PII is masked (e.g. `yu*@gmail.com`). | 71 |  |  | connected_accounts | BO§5.5, CTL-3.4 +1 | UT-RLS-03 | T-2.15 | planned |  |
| REQ-BO-PRIV-02 | Reveal requires permission, a reason where appropriate, and an… | 71 | M-FLOW-01, M-GATE-01 | ADM-02, ADM-03 +3 | email_messages, captures +1 | BO§2.2, BO§3.9 +2 | BO-E2E-11, BO-E2E-20 +1 | T-1.14, T-5.16 +2 | planned |  |
| REQ-BO-PRIV-03 | Provider tokens, passwords and secrets are never shown. | 71 | M-BR-01 | ADM-08, AI§13.7 +1 | oauth_credentials | BO§5.4, BO§5.5 | UT-REM-02 | T-10.10 | planned |  |
| REQ-BO-THEME-01 | Light theme by default, with a dark toggle. | 72 | M-SET-60 |  |  | BO§13.4 | BO-E2E-32 | T-8.29, T-12.11 | planned |  |
| REQ-BO-THEME-02 | Theme preference is persisted per admin. | 72 |  | ADM-00 | admin_preferences | BO§5.3, BO§5.8 +2 | API Tests bullet | T-2.14, T-10.02 | planned |  |
| REQ-BO-THEME-03 | Charts and tables are theme-aware. | 72 |  |  |  | BO§5.7, BO§13.4 | BO-E2E-32 | T-10.04 | planned |  |
| REQ-BO-OBS-01 | Shows app versions, platform, crash correlation where available… | 110 | M-GL-02, M-GL-12 +3 | API-DEV-01, API-SUP-01 +6 | app_installations, analytics_events +4 | BO§4.1, BO§6.2 +2 | SM Tests field | T-2.15, T-10.14 | planned |  |
| REQ-BO-OBS-02 | Sentry or an equivalent provider behind an adapter. | 110 | M-GL-01, M-GL-10 +2 | JOB-19, JOB-26 +2 |  | BO§2.1, BO§6.22 +2 | REL-01 | T-0.04, T-3.02 +2 | planned |  |
| REQ-BO-OPS-01 | Correlation IDs span User → Integration → Sync Job → AI/Briefing… | 118 |  | API-APR-03, API-AST-02 +6 | approval_events, ai_requests +3 | BO§2.3, BO§2.5 +2 | CT-02, EF-LOG-01 +3 | T-1.16, T-1.17 +10 | planned |  |
| REQ-BO-OPS-02 | Logs are structured, PII-minimized and environment-aware. | 118 | M-ON-14A, F-03 +3 | API-AST-02, API-ANI-01 +2 |  | BO§6.10, BO§7.7 +2 | CT-06, REL-20 | T-8.26 | planned |  |
| REQ-BO-METRIC-01 | Shows AI cost per active user, classification rate, briefing… | 119 |  |  |  | BO§4.1, BO§6.8 | BO Tests row | T-10.05 | planned |  |
| REQ-BO-METRIC-02 | Metrics are computed without collecting personal content. | 119 | M-ASST-02, F-05 | JOB-20, ADM-08 +2 | notification_preferences, email_threads +3 | BO§6.9, SEC§1.1 +1 | E2E-M-01 | T-2.07, T-3.09 | planned |  |

### 2.13 Public web and marketing

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-WEB-01 | Routes: `/`, `/pricing`, `/privacy`, `/terms`, `/support`… | 73 | M-SET-39, W-LEGAL-02 +2 | JOB-23, PUB-02 +3 |  | SEC§1.2, CTL-3.18 | VIS-01, REL-12 | T-9.04, T-12.11 | planned (patched → SCREEN_MAP_5, API_CONTRACTS: public-api data-deletion endpoints (R-24)) |  |
| REQ-WEB-02 | Landing sections: Hero, Integrations, How it works, Morning… | 73 | W-SUP-01, W-SYS-05 |  |  | THR-03 | E2E-S-16, WEB-E2E-01 +2 | T-1.04, T-8.19 +1 | planned |  |
| REQ-WEB-03 | Hero "Bugün bilmen gerekenleri, sen sormadan söyler." Supporting… | 73 | W-REF-01 |  |  |  | WEB-E2E-01 | T-9.01…T-9.06 | planned |  |
| REQ-WEB-04 | Basic SEO, Open Graph tags, sitemap, robots. | 73 | W-REF-01, W-OAUTH-01 +3 |  |  |  | WEB-E2E-12 | T-9.06 | planned |  |
| REQ-WEB-05 | Legal pages contain real, consistent content. | 73 | W-LEGAL-01, W-LEGAL-02 |  |  |  | SM Tests field | T-9.01…T-9.06 | planned |  |
| REQ-WEB-06 | Premium, responsive layout. | 73 |  | AI§3.3 |  |  | EF-AI-02, WEB-E2E-10 | T-3.10, T-9.08 | planned |  |
| REQ-MKT-01 | Assets in the final design language: app store screenshot… | 74 | M-CAP-01, M-CAP-06 +2 | API-CAP-01, API-CAP-03 +2 | captures | THR-17, THR-18 | A11Y-07, VIS-01 +4 | T-8.17, T-8.28 +1 | planned |  |
| REQ-MKT-02 | The six messages: "Bugün bilmen gerekenleri, sen sormadan"… | 74 |  |  |  |  |  | T-9.07 | planned |  |
| REQ-MKT-03 | Marketing copy matches real product capability. | 74 | M-GL-02, M-CAP-07 +1 | AI§13.4, INT§3.12 |  | BO§4.1, SEC§0.2 +1 | UT-ENT-06, IT-RC-03 | T-9.02 | planned (patched → API_CONTRACTS: public-api `GET /plans`) |  |

### 2.14 OAuth, database, RLS

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-OAUTH-01 | Google: Gmail, Google Calendar, Google Tasks. | 75 |  | INT§2.11 |  | CTL-3.2 | API Tests bullet | T-1.15 | planned |  |
| REQ-OAUTH-02 | Microsoft: Outlook Mail, Microsoft Calendar, Microsoft To Do. | 75 | M-REM-03, M-APPR-05 +2 | AI§1.8, INT§2.10 | tasks |  | E2E-D, REL-04 +1 | T-1.15 | planned |  |
| REQ-OAUTH-03 | Apple: Apple Calendar and, where possible, Apple Reminders via… | 75 | M-REM-01, M-REM-03 | API-INT-06, API-APR-05 +2 | calendar_events | SEC§4.2 | SM Tests field | T-6.05, T-8.07 | planned |  |
| REQ-OAUTH-04 | Android: device calendar. | 75 |  | API-INT-06, API-APR-05 +2 | calendar_events | SEC§4.2 | API Tests bullet | T-6.05 | planned |  |
| REQ-OAUTH-05 | Adapter interface. No provider-specific logic in the domain layer. | 75 |  | INT§2.5 |  |  | EF-DEMO-01 | T-1.15 | planned |  |
| REQ-OAUTH-06 | Least privilege. Only the needed read scopes at first. | 76 |  | INT§0.2 |  | SEC§4.11 | API Tests bullet | T-4.02 | planned |  |
| REQ-OAUTH-07 | Write scopes (mail send, calendar write) requested progressively… | 76 | M-ON-07, M-REPLY-01 +5 | API-INT-02, AI§8.14 +1 | approval_actions | THR-04, CTL-3.2 | IT-OAUTH-04 | T-4.01 | planned |  |
| REQ-OAUTH-08 | Initial Google scopes: openid, email, profile, Gmail read… | 76 | M-ON-06, F-01 | INT§2.11 |  | CTL-3.2 | IT-OAUTH-03, E2E-M-03 | T-4.02 | planned |  |
| REQ-OAUTH-09 | Refresh tokens are stored in server-side secure storage and never… | 76 | F-01, M-SET-13 +1 | API-DEV-03, API-INT-03 +7 | oauth_credentials, data_export_requests +1 | BO§6.3b, BO§6.5 +2 | DB-04 | T-2.05, T-12.11 | planned |  |
| REQ-OAUTH-10 | Disconnect and revoke supported. | 76 | M-ON-06A, M-ASST-02 +3 | API-INT-01, API-INT-02 +6 | connected_accounts, oauth_credentials +1 | BO§3.3, BO§4.1 +2 | IT-OAUTH-09, IT-OAUTH-10 +2 | T-2.05, T-4.13 | planned |  |
| REQ-OAUTH-11 | An expired connection shows "Bağlantıyı yenile." | 76 | M-TD-01, M-REPLY-01 +4 | API-INT-01, HLT-02 +1 |  |  | E2E-S-18, E2E-M-03 | T-1.04, T-8.07 | planned |  |
| REQ-DB-01 | Minimum tables: profiles, user_preferences, connected_accounts… | 77 | M-ON-05, M-ON-15 +1 | API-BOOT-01, ADM-01 +2 | profiles | BO§3.1, BO§6.2 +2 | SM Tests field | T-2.04, T-12.11 | planned |  |
| REQ-DB-02 | New tables only when needed, with no duplicate schema. | 77 | M-ON-11A, F-05 +9 | API-APR-01, API-ANI-01 +9 | notifications, billing_events +1 | BO§6.6, BO§6.8 +2 | UT-NTF-04, DB-15 +5 | T-1.10, T-2.10 +6 | planned |  |
| REQ-DB-03 | Migrations are versioned. | 77 |  | INT§13.4 |  |  | UT-RLS-02, QG-10 +1 | T-2.02, T-2.03 +25 | planned |  |
| REQ-DB-04 | Every user-data table is user-scoped, indexed, validated and… | 78 |  | AI§10.2 | app_installations, push_tokens +32 |  | API Tests bullet | T-2.03…T-2.21 | planned |  |
| REQ-DB-05 | Timestamps are UTC. | 78 | F-03 | AI§0.2, INT§2.1 | ai_usage_daily | BO§5.8, SEC§0.1 +1 | UT-TZ-08 | T-2.03…T-2.21 | planned |  |
| REQ-DB-06 | User timezone is stored separately. | 78 | M-GL-01, M-GL-04 +13 | API-DEV-01, API-BOOT-01 +7 | user_preferences, app_installations | BO§5.8, BO§6.3a +2 | SM Tests field | T-1.08, T-1.11 +6 | planned |  |
| REQ-DB-07 | Idempotency keys are enforced via a required field, unique… | 78 | M-REPLY-01, M-REM-01 +7 | API-INT-06, API-APR-01 +10 | tasks, reminders +7 | BO§2.5, BO§6.14 +2 | DB-08, DB-16 +2 | T-2.06, T-2.08 +6 | planned |  |
| REQ-DB-08 | Unique constraints are used. | 78 | M-APPR-01, M-VIP-01 +1 | API-MAIL-05, API-APR-01 +20 | profiles, user_preferences +67 | BO§2.1, BO§2.5 +2 | UT-REF-11, DB-08 +6 | T-2.05, T-2.06 +6 | planned |  |
| REQ-DB-09 | Soft deletion where needed. | 78 | M-SET-45, M-SET-53 +1 | INT§3.13 | priority_rules |  | SM Tests field | T-2.03…T-2.21 | planned |  |
| REQ-DB-10 | Each table spec has: Table, Purpose, Columns, PK, FKs, Unique… | 147 |  |  |  |  |  | T-0.01 | planned |  |
| REQ-RLS-01 | RLS is enabled on every user-data table. | 79 | M-ON-08, M-APPR-04 +5 | JOB-25, AI§1.8 +1 | notification_preferences, connected_accounts +3 | BO§5.1, SEC§0.2 +1 | UT-RLS-02, DB-01 | T-2.05, T-2.19 +3 | planned |  |
| REQ-RLS-02 | Users can read and write only their own data. | 79 |  | API-BOOT-02, API-AST-02 +4 |  | BO§2.6, THR-11 +1 | DB-00, DB-01b +1 | T-2.02, T-2.19 +1 | planned |  |
| REQ-RLS-03 | Admin operations are protected server-side. | 79 |  | ADM-01, HLT-02 +1 | app_installations, connected_accounts +8 | BO§2.1, BO§2.5 +2 | DB-01, DB-05 +3 | T-2.01, T-2.03 +6 | planned |  |
| REQ-RLS-04 | The service role is used only in trusted backend contexts and… | 79 |  | AI§8.9, INT§10.1 | app_installations, oauth_credentials +1 | BO§2.1, BO§7.7 +2 | QG-09 | T-2.02, T-2.21 +4 | planned |  |
| REQ-RLS-05 | RLS has automated tests. | 79 | M-ON-05, M-ON-11 +38 | API-DEV-01, API-APR-01 +7 | profiles, user_preferences +67 | BO§3.7, BO§4.3 +2 | UT-RLS-01, UT-RLS-02 +7 | T-0.01, T-1.17 +9 | planned |  |

### 2.15 AI pipeline, cost, hallucination control

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-AI-01 | Pipeline stages: ingestion → normalization → deterministic… | 80 | W-REF-01 | AI§6.2 |  |  | UT-CLS-03, UT-REF-02 +1 | T-1.13 | planned |  |
| REQ-AI-02 | Structured outputs are validated with Zod. | 80 | F-01, M-REPLY-03 +11 | API-MEET-01, API-MEET-03 +9 | life_events, approval_actions +1 | BO§2.1, BO§2.2 +2 | UT-CLS-09, UT-WID-01 +2 | T-0.03, T-3.01 +3 | planned |  |
| REQ-AI-03 | LLM free text is never wired directly to a critical domain action. | 80 | M-APPR-05 | API-MAIL-02, AI§4.2 +1 | ai_feedback | BO§7.7, SEC§4.1 | SM Tests field | T-8.28 | planned |  |
| REQ-AI-04 | AI-derived deadline, amount, person relation, event and… | 80 | M-TD-03, M-MAIL-03 +14 | API-APR-01, API-CAP-03 +5 | email_threads, commitments +5 | BO§7.7, CTL-3.8 +1 | UT-CLS-09, CT-06 +1 | T-2.06, T-5.03 +2 | planned |  |
| REQ-AI-05 | Low-confidence facts are shown with explicit wording, e.g… | 80 | M-BR-01, M-COMMIT-02 +3 | API-AST-02, JOB-11 +1 |  | CTL-3.15 | UT-GRD-06, UT-GRD-14 +2 | T-1.04, T-1.13 +1 | planned |  |
| REQ-AI-06 | Backend model/provider adapters, at least Anthropic and OpenAI… | 81 |  | ADM-08, HLT-02 +2 | ai_requests, ai_model_config +1 | BO§7.7 | API Tests bullet | T-2.12, T-3.01 +1 | planned |  |
| REQ-AI-07 | Model choice is not hardcoded. | 81 |  | AI§3.7 |  |  | API Tests bullet | T-3.09 | planned |  |
| REQ-AI-08 | Model config and prompt versions are controllable from the… | 81 | F-01, M-MEM-01 | API-MAIL-02, API-MEET-03 +8 | ai_model_config | BO§4.1, BO§6.10 | EF-AI-02 | T-2.07, T-3.09 +1 | planned (patched → DB, API_CONTRACTS, BACKOFFICE_PLAN: `ai_model_config (profile, role, feature)` (R-18)) |  |
| REQ-COST-01 | Caching. | 82 |  | AI§1.1 |  |  | IT-AI-04 | T-2.07, T-3.09 +1 | planned (patched → DB: `ai_result_cache` (R-02)) |  |
| REQ-COST-02 | Deduplication. | 82 |  | API-INT-06, JOB-06 +4 | email_messages, memory_chunks |  | API Tests bullet | T-2.07, T-5.01 | planned |  |
| REQ-COST-03 | Prompt limits. | 82 |  | ADM-08, AI§3.6 | ai_model_config |  | API Tests bullet | T-3.09 | planned |  |
| REQ-COST-04 | Token limits. | 82 |  | ADM-08, AI§3.2 | ai_model_config | BO§6.10 | API Tests bullet | T-3.09 | planned |  |
| REQ-COST-05 | Batching where valid. | 82 | F-01, M-CAP-06 +3 | API-APR-01, API-APR-03 +14 | oauth_credentials, ai_requests +1 | BO§6.10, CTL-3.3 +1 | IT-AI-01, IT-APR-14 +4 | T-2.08, T-2.12 +11 | planned |  |
| REQ-COST-06 | Rate limits. | 82 | M-FLOW-01, M-SET-20 +1 | API-INT-04, API-SUP-01 +6 |  | BO§2.1, BO§2.6 +2 | EF-PUB-01 | T-3.03, T-3.11 +1 | planned |  |
| REQ-COST-07 | Per-user usage limits. | 82 | M-ASST-01 | API-BOOT-01, API-MAIL-02 +10 | ai_requests, ai_usage_daily | BO§6.3d, SEC§4.2 +1 | SM Tests field | T-2.07, T-5.17 | planned (patched → DB, API_CONTRACTS: `plan_limits` caps (R-22)) |  |
| REQ-COST-08 | Free-plan limits. | 82 |  | AI§8.9 |  |  | UT-ENT-11 | T-3.09 | planned (patched → DB: Free `ai_daily_budget_units` = 50 (R-02, R-22)) |  |
| REQ-COST-09 | Cost telemetry. | 82 | F-01, F-03 +3 | API-MAIL-02, API-MEET-03 +14 | ai_requests, support_access_grants | BO§6.9, BO§6.10 +2 | DB-04, IT-AI-02 +1 | T-2.07, T-3.09 | planned |  |
| REQ-COST-10 | The same mail is never reprocessed with full reasoning repeatedly. | 82 | M-ON-07 | WH-01, WH-02 +8 | sync_states, subscriptions +1 |  | IT-SYNC-02, IT-SYNC-08 | T-1.15, T-5.02 | planned (patched → DB: `ai_result_cache` (R-02)) |  |
| REQ-HALL-01 | No deadline without a source. | 83 | M-BR-03, M-FLOW-01 +2 | AI§1.3, INT§12.2 | email_threads |  | IT-AI-03, REL-07 | T-2.06, T-5.04 | planned |  |
| REQ-HALL-02 | No amount without a source. | 83 | M-MAIL-03, M-LIFE-01 +2 | AI§4.3 | life_events |  | SM Tests field | T-5.04 | planned |  |
| REQ-HALL-03 | No event without a source. | 83 | M-GL-07, M-ON-12 +10 | API-INT-05, API-PLAN-01 +11 |  | BO§14.2, THR-05 +1 | EF-WH-01 | T-2.05, T-2.06 | planned |  |
| REQ-HALL-04 | No person relation without a source. | 83 |  | AI§4.3 | commitments | CTL-3.15 | API Tests bullet | T-1.13 | planned |  |
| REQ-HALL-05 | No commitment without a source. | 83 | M-COMMIT-01, M-COMMIT-02 +2 | API-APR-01, HLT-02 +1 | commitments | CTL-3.15 | E2E-F | T-1.13 | planned |  |
| REQ-HALL-06 | Every important claim carries source ID, source timestamp… | 83 | M-TD-01, M-FLOW-01 +9 | AI§0.1 |  | SEC§4.5 | IT-AI-01 | T-1.13 | planned |  |

### 2.16 Security controls (SSRF, files, notifications, local, auth)

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-SSRF-01 | Block localhost. | 84 |  | JOB-27 |  | CTL-3.10 | UT-SSRF-04 | T-3.05 | planned |  |
| REQ-SSRF-02 | Block private IP ranges. | 84 | M-ON-05N, M-CAP-01 +5 | API-BOOT-01, API-APR-03 +9 | profiles, user_preferences +16 | BO§2.1, BO§2.5 +2 | UT-RLS-03, UT-RLS-04 +8 | T-0.03, T-1.05 +19 | planned |  |
| REQ-SSRF-03 | Block loopback. | 84 |  | JOB-27, AI§13.4 |  | THR-07, CTL-3.10 | API Tests bullet | T-1.15 | planned |  |
| REQ-SSRF-04 | Block `file://`. | 84 | M-GL-04, M-GL-07 +5 | API-BOOT-01, API-INT-01 +4 |  | THR-07, CTL-3.2 | UT-SSRF-04, UT-URL-01 | T-0.05, T-1.02 +6 | planned |  |
| REQ-SSRF-05 | Reject unsupported schemes. | 84 | M-GL-04, M-GL-07 +4 | API-INT-01, API-CAP-02 +1 |  | THR-07, CTL-3.2 | UT-URL-01 | T-1.02, T-1.15 +4 | planned |  |
| REQ-SSRF-06 | Limit redirects. | 84 | M-GL-07, M-ON-05 +9 | API-INT-01, OAUTH-01 +6 |  | BO§2.2, BO§2.3 +2 | EF-OAUTH-02, EF-SEC-01 +2 | T-2.01, T-3.05 +2 | planned |  |
| REQ-SSRF-07 | Limit response size. | 84 | M-REPLY-01, M-CAP-01 | AI§13.4, INT§3.12 |  | SEC§1.4, SEC§2.0 | EF-WH-02, EF-SEC-01 | T-3.05, T-8.17 | planned |  |
| REQ-SSRF-08 | Enforce a timeout. | 84 | M-ON-12, M-REM-01 +7 | API-APR-05, API-AST-03 +7 | ai_requests, referrals +2 | BO§2.6, BO§3.7 +2 | EF-SEC-01, QG-17 | T-3.06 | planned |  |
| REQ-SSRF-09 | Validate content-type. | 84 | M-CAP-01 | API-MAIL-01, JOB-27 +2 |  | CTL-3.10, SEC§4.16 | EF-SEC-01 | T-3.05 | planned |  |
| REQ-SSRF-10 | Mitigate DNS rebinding (resolve, pin the IP, re-check on each… | 84 | M-CAP-01 | JOB-27 |  | THR-07, THR-14 | EF-SEC-01 | T-3.05 | planned |  |
| REQ-FILE-01 | Upload size limit. | 85 | M-ON-05, M-BR-04C +13 | API-MAIL-01, API-CAP-01 +10 | email_messages, life_events +6 | BO§5.3, BO§6.11 +2 | UT-CAP-01, EF-WH-02 +3 | T-1.02, T-1.03 +7 | planned |  |
| REQ-FILE-02 | MIME validation. | 85 | M-REPLY-01, M-CAP-01 | API-MAIL-01, API-AST-03 +5 |  | THR-08, CTL-3.11 | UT-CAP-01, EF-SEC-02 +1 | T-2.06, T-2.21 +1 | planned |  |
| REQ-FILE-03 | Extension validation. | 85 | M-MAIL-03, M-CAP-01 +2 | API-CAP-01, API-CAP-02 +2 | memory_chunks | SEC§1.2, SEC§1.3 | UT-CAP-01, EF-SEC-02 +1 | T-0.07, T-2.01 +8 | planned |  |
| REQ-FILE-04 | Uploaded files are never executed. | 85 | M-GL-07, M-TD-01 +24 | API-APR-03, API-APR-04 +9 | commitments, approval_actions +1 | BO§2.5, BO§2.6 +2 | UT-RLS-05, DB-10 +15 | T-2.08, T-2.15 +13 | planned |  |
| REQ-FILE-05 | Storage is isolated per user. | 85 |  |  |  | THR-11 | DB-09 | T-2.02, T-2.21 | planned |  |
| REQ-FILE-06 | Access only via signed URLs. | 85 | F-03, M-CAP-05 +2 | API-CAP-01, API-BRF-01 +2 | captures | BO§2.5, BO§6.19 +2 | IT-PRIV-02, BO-E2E-28 | T-5.09, T-11.01 | planned |  |
| REQ-FILE-07 | Uploads are cleaned up. | 85 | M-SET-02, M-SET-35 | API-INT-03, INT§3.5 | app_installations, oauth_states +6 | SEC§1.4, CTL-3.1 | DB-11 | T-8.05 | planned |  |
| REQ-FILE-08 | PDF and image parsing runs in a sandboxed worker. | 85 |  | JOB-24, AI§0.3 +1 | subscriptions, billing_events | CTL-3.11, SEC§4.16 | DB-21, REL-04 +1 | T-0.03, T-1.01 +2 | planned |  |
| REQ-NSEC-01 | Sensitive mail details are not shown in pushes by default. | 86 | M-ON-05, F-01 +4 | JOB-18, INT§9.5 | notification_preferences | BO§6.5, BO§6.14 +2 | UT-NTF-11, UT-NTF-13 +2 | T-1.08, T-2.04 +1 | planned |  |
| REQ-NSEC-02 | Detail modes: full detail, title only, generic. | 86 | F-03, M-FLOW-01 +16 | JOB-15, JOB-18 +6 | notifications | BO§3.9, BO§4.1 +2 | UT-NTF-12, UT-NTF-13 +4 | T-1.08, T-6.07 +4 | planned |  |
| REQ-NSEC-03 | The detail mode is a user preference. | 86 | F-03, F-02 +1 | JOB-18, AI§13.1 +1 | notification_preferences | BO§6.3a, BO§7.7 | UT-WID-01, E2E-S-10 | T-1.08, T-6.07 +2 | planned |  |
| REQ-NSEC-04 | Lock-screen privacy control. | 86 | M-BR-02, F-03 +1 | API-BOOT-01, JOB-18 +3 | notification_preferences | SEC§0.2, SEC§1.4 | REL-10, REL-13 | T-1.08, T-2.04 +2 | planned |  |
| REQ-LSEC-01 | Sensitive local data is encrypted. | 87 | M-GL-01, M-GL-02 +25 | INT§8.5 |  | SEC§1.3, SEC§2.0 | UT-MB-02 | T-8.02, T-8.05 +1 | planned |  |
| REQ-LSEC-02 | OAuth and session tokens are never stored in AsyncStorage. | 87 | M-GL-01 |  |  | THR-02, SEC§4.16 | UT-MB-02, QG-12 | T-1.01, T-8.05 +1 | planned |  |
| REQ-LSEC-03 | Tokens use SecureStore or platform secure storage. | 87 | M-GL-01, M-GL-02 +3 | INT§3.2 | app_installations | SEC§1.3, SEC§2.0 | UT-MB-02 | T-8.05 | planned |  |
| REQ-LSEC-04 | No unnecessary persistence of raw mail bodies. | 87 | M-GL-01, M-GL-06 +44 | API-BOOT-01, API-MAIL-01 +24 | user_preferences, webhook_events +10 | BO§2.2, BO§2.4 +2 | UT-RLS-01, UT-NTF-10 +11 | T-1.08, T-2.06 +7 | planned |  |
| REQ-LSEC-05 | Logout clears sensitive cache and local account data and… | 87 | M-GL-06, M-ON-05 +6 | API-DEV-02, API-PRV-03 +3 | push_tokens, admin_sessions | BO§2.4, BO§3.7 +2 | UT-MB-03, TST-E2E-M-01 +3 | T-8.05, T-8.25 +2 | planned |  |
| REQ-AUTH-01 | App sign-in with Apple, Google, Microsoft and Email. | 88 | M-ON-05, F-01 | INT§6.2 |  |  | E2E-M-01 | T-8.05 | planned |  |
| REQ-AUTH-02 | App login is separate from integration auth (e.g. an Apple app… | 88 | M-ON-05 | INT§8.1 | connected_accounts |  | SM Tests field | T-2.01 | planned |  |
| REQ-AUTH-03 | Uses Supabase Auth. | 88 | M-ON-05, M-ON-05E +1 | ADM-00, ADM-19 +3 |  | BO§3.1, BO§6.0 +2 | SM Tests field | T-2.01 | planned |  |
| REQ-AUTH-04 | Backoffice auth is a separate security boundary. | 88 | M-ON-05, M-TD-01 +10 | API-BOOT-02, ADM-11 +2 | connected_accounts, learned_preferences +1 | BO§2.5, BO§2.8 +2 | SM Tests field | T-2.04, T-10.11 | planned |  |

### 2.17 Demo, credentials, platform limits, accessibility, states, search, scheduling, provenance

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-DEMO-01 | Development never stops for missing credentials. | 89 | M-SET-02 | API-SRCH-01, JOB-10 +1 |  |  | SM Tests field | T-3.08 | planned |  |
| REQ-DEMO-02 | Deterministic demo adapters. | 89 |  | API-INT-01, OAUTH-03 +3 |  | BO§13.4, CTL-3.6 +1 | UT-ENV-03, UT-ENV-08 +2 | T-0.04, T-3.08 +4 | planned |  |
| REQ-DEMO-03 | Demo dataset covers users, emails, calendars, meetings… | 89 | M-SET-50, W-LEGAL-02 | API-ONB-02, API-MAIL-02 +6 | contacts | BO§4.1, BO§6.1 | UT-RBAC-02, DB-02 +3 | T-0.02, T-0.03 +13 | planned |  |
| REQ-DEMO-04 | Demo mode is never active in production without explicit… | 89 |  | API-INT-01, OAUTH-03 +2 |  | CTL-3.6 | UT-ENV-03 | T-0.04, T-2.24 +1 | planned |  |
| REQ-DEMO-05 | No fake success responses in production code. | 89 | M-GL-05, M-ON-12 +14 | API-PRV-03, JOB-23 +4 | system_health_checks | BO§5.4, BO§6.0 +2 | QG-24 | T-0.02, T-3.06 +3 | planned |  |
| REQ-CRED-01 | When a credential is missing, create `.env.example`, the adapter… | 90 |  | HLT-02, INT§0.1 |  | BO§14.2, THR-17 +1 | UT-ENV-07, QG-20 | T-0.03, T-0.04 | planned |  |
| REQ-CRED-02 | Show a clearly marked "external credential required" state. | 90 | M-ON-05, M-ON-06 +2 | API-BOOT-01, OAUTH-01 +2 | connected_accounts, system_health_checks | BO§2.5, BO§3.5 +1 | BO-E2E-30 | T-1.04, T-3.02 | planned |  |
| REQ-CRED-03 | Credential matrix columns: Provider, Credential, Why… | 149 |  | INT§0.1 |  |  | API Tests bullet | T-12.11 | planned |  |
| REQ-PLAT-01 | No faked capabilities or misleading UI. Implement the closest… | 91 | M-ANI-01 | AI§14.2, INT§3.15 |  | CTL-3.13 | SM Tests field | T-0.01, T-12.09 | planned |  |
| REQ-PLAT-02 | Every limitation is documented in docs/KNOWN_PLATFORM_LIMITATIONS… | 91 | M-ANI-01 | AI§14.2, INT§3.15 |  | CTL-3.13 | SM Tests field | T-0.01, T-12.09 | planned |  |
| REQ-PLAT-03 | iOS never claims Android-style system notification access. | 91 | M-GL-06, M-ON-14A +3 |  |  |  | SM Tests field | T-4.11 | planned |  |
| REQ-A11Y-01 | Semantic labels and screen-reader labels on mobile, web and… | 92 | M-GL-02, M-GL-05 +7 |  |  |  | QG-15 | T-1.03 | planned |  |
| REQ-A11Y-02 | Dynamic text sizing. | 92 | M-GL-04, M-ON-05 +9 |  |  |  | REL-17 | T-8.29 | planned |  |
| REQ-A11Y-03 | Contrast. | 92 | M-MEET-01, M-SET-01 +1 |  |  | BO§5.9 | SM Tests field | T-1.02 | planned |  |
| REQ-A11Y-04 | Hit targets. | 92 | M-GL-03, M-GL-04 +9 |  |  |  | A11Y-01 | T-8.02 | planned |  |
| REQ-A11Y-05 | Keyboard navigation where relevant. | 92 | M-GL-01, M-GL-03 +12 |  |  | BO§5.3, BO§5.9 | A11Y-09, BO-E2E-34 +2 | T-0.03, T-9.08 | planned |  |
| REQ-A11Y-06 | Focus management. | 92 | M-GL-01, M-GL-05 +48 | AI§4.3, INT§2.2 |  | BO§5.1, BO§5.3 | UT-MB-01, A11Y-06 +4 | T-8.03, T-8.29 | planned |  |
| REQ-A11Y-07 | Accessibility is implemented in the component layer, not as final… | 92 | M-PLAN-09, M-SRCH-01 | INT§2.1 |  |  | A11Y-03 | T-8.02 | planned |  |
| REQ-STATE-01 | Every main screen implements loading, empty, error, offline… | 93 | M-ON-06, M-ON-06G +20 | API-INT-04, API-INT-05 +13 | connected_accounts, prompt_versions | BO§2.5, BO§2.6 +2 | UT-LINK-01, UT-MB-08 +6 | T-2.07, T-4.01 | planned (patched → SCREEN_MAP_4: M-STATE-01..12) |  |
| REQ-STATE-02 | Production edge states exist even where the prototype shows only… | 93 | M-FLOW-01 |  |  |  | UT-MB-08 | T-8.03, T-8.08 | planned (patched → SCREEN_MAP_4: M-STATE-01..12) |  |
| REQ-OFF-01 | Mobile caches data where appropriate. | 94 | M-GL-01, M-GL-04 +59 | API-BOOT-01, API-MAIL-01 +6 | vip_people | BO§5.3, BO§6.1 +2 | UT-MB-04, UT-MB-06 +9 | T-0.03, T-1.01 +6 | planned |  |
| REQ-OFF-02 | Offline, cached Today and Calendar are shown meaningfully. | 94 | M-GL-01, M-GL-02 +162 | API-BOOT-01, API-INT-01 +8 |  | BO§5.6, THR-13 +1 | UT-MB-06, UT-MB-08 +4 | T-4.02, T-6.01 +6 | planned |  |
| REQ-OFF-03 | Offline writes are queued or blocked with a clear state. | 94 | M-GL-08, M-GL-13 +60 | API-DEV-02, API-INT-04 +18 | webhook_events, briefings +2 | BO§4.1, BO§6.3a +2 | UT-MB-06, DB-18 +8 | T-4.09, T-5.01 +4 | planned |  |
| REQ-OFF-04 | The real sync status is shown. | 94 | M-GL-09, M-TD-01 +5 | JOB-01, JOB-02 +1 | sync_states | BO§6.2, BO§14.2 | E2E-M-20 | T-3.03 | planned |  |
| REQ-OFF-05 | Safe resync when back online. | 94 | M-GL-02, M-ON-11 +9 | API-DEV-02, API-INT-01 +17 | oauth_states, sync_states | BO§2.5, BO§4.1 +2 | UT-REM-11, UT-MB-06 +6 | T-3.03, T-4.01 +8 | planned |  |
| REQ-OFF-06 | No duplicate writes after reconnect. | 94 | M-ON-11A, F-05 +9 | API-APR-01, API-ANI-01 +9 | notifications, billing_events +1 | BO§6.6, BO§6.8 +2 | UT-NTF-04, DB-15 +5 | T-1.10, T-2.10 +6 | planned |  |
| REQ-SEARCH-01 | Global search covers emails, people, calendar, tasks… | 95 | M-MEM-01, M-SRCH-01 +2 | API-AST-02, API-SRCH-01 +4 | memory_chunks | BO§6.25, BO§7.7 +2 | SM Tests field | T-2.16, T-5.07 +1 | planned (patched → API_CONTRACTS: `/search` `contact_id`, `mode`) |  |
| REQ-SEARCH-02 | Access control and source provenance are preserved in results. | 95 | M-BR-01, F-01 +6 | API-APR-01, API-REM-02 +7 | briefings | BO§7.7, CTL-3.4 +1 | IT-SYNC-17, IT-AI-01 | T-1.05, T-2.06 +6 | planned |  |
| REQ-SCHED-01 | Backend scheduling and client local scheduling are separated… | 96 | M-COMMIT-02, M-REM-01 +2 | API-REM-03, INT§8.6 |  | CTL-3.13 | SM Tests field | T-6.06 | planned |  |
| REQ-SCHED-02 | Recurring jobs: morning briefing, midday pulse, evening close… | 96 | F-03, F-04 +3 | API-DEV-01, JOB-00 +4 | user_preferences | BO§7.7, SEC§4.5 | DB-18, IT-JOB-06 | T-2.18 | planned |  |
| REQ-SCHED-03 | Jobs are idempotent. | 96 | M-ON-12, M-TD-02 +30 | API-DEV-02, API-INT-06 +23 | email_messages, tasks +8 | BO§2.1, BO§2.5 +2 | DB-08, DB-15 +6 | T-0.07, T-1.05 +18 | planned |  |
| REQ-SCHED-04 | Jobs use the user's timezone. | 96 | M-ON-10, M-ON-10T +4 | API-DEV-01, API-REM-01 +4 |  | BO§6.8, SEC§4.5 +1 | SM Tests field | T-2.18, T-12.11 | planned |  |
| REQ-SCHED-05 | DST transitions are handled correctly. | 96 | M-ON-06O, M-ON-10 +7 | API-DEV-01, API-REM-01 +5 |  | BO§13.1 | UT-TZ-02, DB-18 +4 | T-1.06, T-1.08 +5 | planned |  |
| REQ-NENG-01 | Before sending, check relevance, urgency, user preference, quiet… | 132 | F-03, M-REM-01 +7 | API-APR-01, API-REM-01 +4 | user_preferences, notification_preferences +1 | BO§6.8 | UT-REM-09, UT-NTF-03 +2 | T-1.08, T-1.12 +2 | planned |  |
| REQ-NENG-02 | Low-value notifications are suppressed. | 132 | M-GL-13, F-05 +5 | API-REM-03, API-PLAN-04 +7 | life_events, insights +1 | BO§6.8, BO§7.4 | UT-NTF-01, UT-NTF-03 +6 | T-1.08, T-2.10 +3 | planned |  |
| REQ-NENG-03 | Suppression counts are visible as a backoffice metric. | 132 | M-GL-13, F-05 +5 | API-REM-03, API-PLAN-04 +7 | life_events, insights +1 | BO§6.8, BO§7.4 | UT-NTF-01, UT-NTF-03 +6 | T-1.08, T-2.10 +3 | planned |  |
| REQ-PROV-01 | Insights and derived objects store source_type, source_id… | 97 | M-TD-01, M-FLOW-01 +5 | AI§0.1, INT§13.2 |  |  | IT-AI-01 | T-1.05 | planned |  |
| REQ-PROV-02 | "Bu nereden çıktı?" opens the real source. | 97 | M-TD-03, M-FLOW-01 +8 | AI§6.8 |  |  | REL-07, E2E-M-05 | T-1.05 | planned (patched → API_CONTRACTS, DB: `get_explanation` (R-24)) |  |
| REQ-EXPL-01 | Tapping an insight shows its source. | 131 | M-FLOW-01, M-MAIL-03 +10 |  |  |  | SM Tests field | T-8.03 | planned (patched → API_CONTRACTS, DB: `get_explanation` (R-24)) |  |
| REQ-EXPL-02 | Tapping an insight shows a short "why important" explanation. | 131 | M-TD-03, M-SRC-01 +1 | AI§7.7 |  | SEC§4.14 | SM Tests field | T-1.07 | planned (patched → API_CONTRACTS, DB: `get_explanation` (R-24)) |  |
| REQ-EXPL-03 | The original provider screen can be opened where needed. | 131 | M-MAIL-03, M-MAIL-04 +4 | API-MAIL-01, JOB-17 +1 | email_threads, email_messages |  | SM Tests field | T-5.05 | planned (patched → API_CONTRACTS, DB: `get_explanation` (R-24)) |  |
| REQ-EXPL-04 | No opaque, unexplained AI verdicts. | 131 | M-SRC-01 | API-MAIL-01, INT§3.1 | oauth_states |  | SM Tests field | T-5.05 | planned (patched → API_CONTRACTS, DB: `get_explanation` (R-24)) |  |

### 2.18 Completion policies, tests, CI, docs, environment, deployment, store

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-E2EF-01 | Each feature completes the chain UI → state → API/action →… | 98 | M-CAP-07 |  |  |  | SM Tests field | T-12.06 | planned |  |
| REQ-DEAD-01 | Every visible button, CTA, setting row, card action, switch or… | 99 | M-ON-02, M-PLAN-06 +1 | HLT-02, RPC-01 |  | BO§5.4, BO§14.2 | UT-MB-08, E2E-S-03 +1 | T-1.01, T-8.04 +2 | planned |  |
| REQ-NOPH-01 | The production path contains none of the M§100 markers (work markers, deferral copy, fake success, fake provider, empty handlers). | 100 |  |  |  | SEC§4.16 | QG-01 | T-0.01, T-0.06 | planned |  |
| REQ-NOPH-02 | Demo fixtures sit behind an explicit dev/demo flag. | 100 |  | API-INT-01, OAUTH-03 +3 |  | BO§13.4, CTL-3.6 +1 | UT-ENV-03, UT-ENV-08 +2 | T-0.04, T-3.08 +4 | planned |  |
| REQ-QG-01 | Before acceptance, scan the repo for the M§133 list (work markers, empty handlers…) | 133 |  |  |  |  | UT-I18N-03, WEB-E2E-04 +24 | T-0.06 | planned |  |
| REQ-TEST-01 | Unit tests: priority engine, classification normalization, date… | 101 |  |  |  |  | UT-PRI-01, UT-PRI-02 +15 | T-1.* | planned |  |
| REQ-TEST-02 | Integration tests: OAuth, sync, database, AI adapters, approval… | 101 |  |  |  |  | IT-OAUTH-01, IT-OAUTH-02 +20 | T-1.* | planned |  |
| REQ-TEST-03 | E2E for critical flows on mobile, backoffice and web. | 101 |  | HLT-02, INT§13.4 |  | BO§5.9, BO§6.0 +2 | A11Y-07, VIS-03 +107 | T-0.03, T-9.08 +11 | planned |  |
| REQ-TEST-04 | Mobile E2E: onboarding, auth, Gmail connect, Calendar connect… | 102 |  |  |  | THR-03, SEC§4.16 | E2E-M-01..20 (all 20 M§102 items) | T-8.30 | planned |  |
| REQ-TEST-05 | Backoffice E2E with Playwright: admin login, dashboard, user… | 103 |  |  |  | BO§5.9, BO§6.0 | BO-E2E-01..45 (all 15 M§103 items) | T-10.15 | planned |  |
| REQ-TEST-06 | Web QA: landing, pricing, CTA, legal pages, responsive… | 104 |  |  |  |  | WEB-E2E-01..18 (all 7 M§104 items) | T-9.08 | planned |  |
| REQ-CI-01 | GitHub Actions (or equivalent) pipeline: install → lint →… | 105 |  | INT§13.4 |  | THR-16, CTL-3.9 | API Tests bullet | T-12.11 | planned |  |
| REQ-CI-02 | Mobile EAS build validation. | 105 | M-ON-14, M-CAP-04 +1 | INT§0.5 |  | SEC§1.2, CTL-3.9 | UT-ENV-08, VIS-04 | T-0.04, T-6.07 +10 | planned |  |
| REQ-DOCS-01 | README.md. | 106 |  | INT§8.2 |  | SEC§4.6 | API Tests bullet | T-0.02, T-0.03 +4 | planned |  |
| REQ-DOCS-02 | docs/: ARCHITECTURE, DATABASE, OAUTH, AI_PIPELINE, SECURITY… | 106 |  | INT§12.1 |  | SEC§4.13 | REL-18 | T-12.09, T-12.11 | planned |  |
| REQ-ENV-01 | Complete `.env.example` covering Supabase, Google, Microsoft… | 107 |  | HLT-02, INT§0.1 |  | BO§14.2, THR-17 +1 | UT-ENV-07, QG-20 | T-0.03, T-0.04 | planned |  |
| REQ-ENV-02 | No secrets in frontend bundles. | 107 | M-CAP-04, M-VOICE-01 +2 | AI§6.9, INT§0.5 |  | BO§2.7, BO§14.1 +2 | QG-09 | T-0.03, T-1.01 +5 | planned |  |
| REQ-ENV-03 | `.env` is never committed. | 107 |  |  |  | SEC§2.0, THR-17 |  | T-0.02, T-0.03 | planned |  |
| REQ-ID-01 | iOS bundle id `com.dijitalasistan.app`. | 108 | M-CAP-04, M-SET-01 +2 | INT§0.5 |  | BO§6.22 | WEB-E2E-09 | T-8.01 | planned |  |
| REQ-ID-02 | Android package `com.dijitalasistan.app`. | 108 | M-CAP-04, M-SET-01 +2 | INT§0.5 |  | BO§6.22 | WEB-E2E-09 | T-8.01 | planned |  |
| REQ-ID-03 | URL scheme `dijitalasistan`. | 108 | M-GL-03, M-GL-07 +75 | API-INT-01, OAUTH-01 +2 | oauth_states, announcements | BO§6.18, CTL-3.2 | IT-OAUTH-01, WEB-E2E-07 +4 | T-2.01, T-4.01 | planned |  |
| REQ-ID-04 | All three identifiers are configurable. | 108 | M-VOICE-01 | HLT-02, INT§0.5 |  |  | UT-ENV-08 | T-8.01 | planned |  |
| REQ-DEPLOY-01 | Mobile is EAS-ready for iOS and Android. | 109 | M-ON-14, M-CAP-04 +1 | INT§0.5 |  | SEC§1.2, CTL-3.9 | UT-ENV-08, VIS-04 | T-0.04, T-6.07 +10 | planned |  |
| REQ-DEPLOY-02 | Web is Vercel-compatible. | 109 |  | INT§13.4 |  | BO§2.1, BO§2.2 +2 | API Tests bullet | T-12.03, T-12.11 | planned |  |
| REQ-DEPLOY-03 | Backoffice deploys separately and is admin-subdomain compatible. | 109 | M-ON-06M, M-SET-39 | API-PRV-03, JOB-23 +21 | admin_users, admin_sessions +1 | BO§2.7, BO§2.8 +2 | DB-12, BO-E2E-01 +1 | T-8.01 | planned |  |
| REQ-DEPLOY-04 | Supabase migrations, functions and scheduled jobs are deployable… | 109 |  |  |  | BO§2.5 | BO Tests row | T-12.03 | planned |  |
| REQ-LOOP-01 | Core recurring value: Morning Briefing, meaningful Midday… | 111 |  |  |  |  |  | T-2.18, T-5.08 +1 | planned |  |
| REQ-LOOP-02 | Notification frequency is earned by usefulness. | 111 | F-03, M-SET-20 | JOB-18, ADM-20 +1 | notification_preferences |  | UT-NTF-05 | T-5.08 | planned |  |
| REQ-STORE-01 | App icon and config. | 112 | M-BR-02, M-ANI-03 +1 |  |  |  | SM Tests field | T-8.31 | planned |  |
| REQ-STORE-02 | Splash screen. | 112 | M-GL-01, M-GL-02 +1 |  |  |  | REL-01 | T-0.03, T-8.01 | planned |  |
| REQ-STORE-03 | Permission explanations. | 112 | M-ON-07 | INT§12.8 |  |  | SM Tests field | T-8.31 | planned |  |
| REQ-STORE-04 | Notification permission rationale. | 112 | M-ON-14 | INT§12.8 |  |  | E2E-M-01 | T-8.06 | planned |  |
| REQ-STORE-05 | Privacy manifest and platform declarations. | 112 |  |  |  | SEC§4.12 |  | T-8.31 | planned |  |
| REQ-STORE-06 | URL schemes. | 112 | M-GL-04, M-GL-07 +4 | API-INT-01, API-CAP-02 +1 |  | THR-07, CTL-3.2 | UT-URL-01 | T-1.02, T-1.15 +4 | planned |  |
| REQ-STORE-07 | Universal/app links where needed. | 112 | W-SYS-01 | INT§12.9 |  |  | WEB-E2E-09 | T-9.05 | planned |  |
| REQ-STORE-08 | Deep links. | 112 | M-GL-01, M-GL-02 +157 | API-BIZ-01, AI§10.6 +1 |  | BO§6.22, SEC§1.3 | WEB-E2E-07, WEB-E2E-08 +1 | T-1.05, T-5.07 +2 | planned |  |
| REQ-STORE-09 | Release config. | 112 |  | INT§0.5 |  | BO§2.7, CTL-3.9 +1 | UT-ENV-08 | T-8.01, T-12.03 | planned |  |
| REQ-STORE-10 | EAS profiles. | 112 |  |  |  |  |  | T-8.01 | planned |  |
| REQ-STORE-11 | STORE_CHECKLIST.md with Apple and Google review notes. | 112 |  | INT§12.1 |  | SEC§4.13 | REL-18 | T-12.09, T-12.11 | planned |  |

### 2.19 Security, consistency, performance, export/deletion, release

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| REQ-THREAT-01 | SECURITY.md threat-models token theft, session theft, account… | 113 |  |  |  | SEC§0.1, THR-01 |  | T-11.05 | planned |  |
| REQ-PINJ-01 | Email, document, webpage and capture content is untrusted input. | 114 |  | API-MAIL-02, JOB-11 +2 |  | BO§6.11, SEC§1.1 +1 | API Tests bullet | T-3.05 | planned |  |
| REQ-PINJ-02 | Embedded instructions ("ignore previous instructions", "send this"… | 114 | M-MAIL-03, M-ASST-02 +1 | API-MAIL-02, API-AST-02 +3 |  | SEC§0.2, SEC§2.0 | EF-AI-01, IT-AI-07 | T-1.13, T-5.11 +3 | planned |  |
| REQ-PINJ-03 | External content is processed as data only. | 114 | M-MAIL-03, M-ASST-02 +1 | API-MAIL-02, API-AST-02 +3 |  | SEC§0.2, SEC§2.0 | EF-AI-01, IT-AI-07 | T-1.13, T-5.11 +3 | planned |  |
| REQ-PINJ-04 | Before any tool or action call, check authorization, user intent… | 114 | M-MAIL-03, M-ASST-02 +1 | API-MAIL-02, API-AST-02 +3 |  | SEC§0.2, SEC§2.0 | EF-AI-01, IT-AI-07 | T-1.13, T-5.11 +3 | planned |  |
| REQ-WSAFE-01 | Approval is mandatory for: send email, create calendar event… | 115 |  |  |  | CTL-3.16 |  | T-6.01…T-6.05 | planned |  |
| REQ-WSAFE-02 | Execution after approval happens server-side. | 115 | M-REPLY-01, M-PLAN-03 +3 | API-APR-03, API-APR-04 +4 | commitments | BO§6.6, THR-13 +1 | SM Tests field | T-6.01, T-6.02 | planned |  |
| REQ-WSAFE-03 | Re-execution is prevented. | 115 |  |  | approval_actions | CTL-3.16 |  | T-6.01…T-6.05 | planned |  |
| REQ-CONS-01 | No duplicate emails, events, reminders, commitments or referral… | 116 | M-LIFE-01, F-01 | API-REM-02, API-PLAN-02 +6 | commitments, life_events +2 | CTL-3.12, CTL-3.16 | UT-NTF-04, DB-22 +1 | T-2.10 | planned |  |
| REQ-CONS-02 | Provider updates and deletes are reconciled. | 116 | M-ASST-02 | WH-02, WH-04 +8 | oauth_credentials, email_messages +1 | BO§3.7, BO§6.3a +2 | IT-SYNC-04, IT-SYNC-14 | T-2.18, T-4.09 +4 | planned |  |
| REQ-SYNC-01 | Per provider: initial sync, incremental sync, pagination… | 117 |  | JOB-02, AI§1.2 +1 |  | THR-05 | IT-SYNC-02, IT-SYNC-03 | T-4.03 | planned |  |
| REQ-SYNC-02 | Designed against the real Gmail and Graph API limits in official… | 117 |  | API-INT-04, JOB-03 +5 |  | BO§2.5, BO§13.2 +2 | EF-RL-01, IT-SYNC-05 +1 | T-3.08, T-4.07 | planned |  |
| REQ-PERF-01 | Mobile avoids unnecessary rerenders. | 125 |  |  |  |  |  | T-8.01 | planned |  |
| REQ-PERF-02 | Long lists are virtualized. | 125 | M-TD-01, M-BR-07 +2 |  |  |  | SM Tests field | T-0.03, T-8.10 +1 | planned |  |
| REQ-PERF-03 | Images are optimized. | 125 |  | INT§12.1 |  | CTL-3.11, SEC§4.16 | API Tests bullet | T-0.03, T-8.28 +1 | planned |  |
| REQ-PERF-04 | Queries are cached. | 125 | M-FLOW-01, M-SET-10 +1 |  |  |  | SM Tests field | T-8.28 | planned |  |
| REQ-PERF-05 | Background work is scheduled carefully. | 125 |  | INT§0.1 |  |  | API Tests bullet | T-8.07, T-8.25 | planned |  |
| REQ-PERF-06 | Web and backoffice use SSR where beneficial. | 125 | M-MAIL-05, M-CAP-01 | API-CAP-02, JOB-27 +2 | captures | BO§3.8, SEC§2.0 +1 | UT-SSRF-01, UT-SSRF-02 +3 | T-2.02, T-3.05 +3 | planned |  |
| REQ-PERF-07 | Web and backoffice paginate. | 125 | M-BR-07, M-FLOW-01 +3 | INT§4.4 |  | BO§2.4, BO§5.3 | BO-E2E-10 | T-2.17, T-4.03 +2 | planned |  |
| REQ-PERF-08 | Web and backoffice cache. | 125 | M-GL-01, M-GL-02 +60 | API-BOOT-01, API-MAIL-03 +11 | ai_requests | BO§2.2, BO§2.3 +2 | UT-MB-03, EF-AI-02 +4 | T-0.03, T-0.05 +11 | planned |  |
| REQ-PERF-09 | Large datasets are never loaded client-side. | 125 | M-BR-07, M-FLOW-01 +3 | INT§4.4 |  | BO§2.4, BO§5.3 | BO-E2E-10 | T-2.17, T-4.03 +2 | planned |  |
| REQ-PERF-10 | Duplicate AI requests are avoided. | 125 | M-GL-05, M-GL-08 +10 | API-INT-06, API-REM-02 +12 | webhook_events, email_messages +4 | BO§6.8, SEC§1.4 +1 | UT-NTF-04, UT-KEY-01 +8 | T-1.08, T-2.07 +9 | planned (patched → DB: `ai_result_cache` (R-02)) |  |
| REQ-PERF-11 | AI results are cached where safe. | 125 |  | AI§1.1 |  |  | IT-AI-04 | T-2.07, T-3.09 +1 | planned (patched → DB: `ai_result_cache` (R-02)) |  |
| REQ-PERF-12 | Stale AI requests are cancelled. | 125 | M-CAP-05, M-ASST-02 +2 | API-AST-02, AI§11.5 +1 |  | SEC§4.16 | EF-SEC-01 | T-8.28 | planned |  |
| REQ-LOG-01 | Production logs are structured. | 126 | M-ON-14A, F-03 +3 | API-AST-02, API-ANI-01 +2 |  | BO§6.10, BO§7.7 +2 | CT-06, REL-20 | T-8.26 | planned |  |
| REQ-LOG-02 | PII is minimized in logs. | 126 | M-GL-10, M-BR-06 +2 | AI§1.1, INT§13.4 | profiles, connected_accounts +4 | BO§2.5, BO§2.7 +2 | SM Tests field | T-2.17, T-3.04 +2 | planned |  |
| REQ-LOG-03 | Full email bodies are never logged. | 126 | M-MAIL-02, M-MAIL-03 | API-MAIL-01, API-MAIL-02 +5 | oauth_credentials, email_messages | BO§5.5, CTL-3.7 +1 | EF-AI-03, EF-MAIL-01 | T-2.06, T-3.02 +2 | planned |  |
| REQ-LOG-04 | Prompt logs contain no raw private source content. | 126 | M-GL-01, M-GL-04 +38 | API-DEV-01, API-DEV-03 +36 | notification_preferences, webhook_events +18 | BO§2.1, BO§2.2 +2 | UT-GRD-12, DB-15 +17 | T-0.02, T-1.04 +33 | planned |  |
| REQ-LOG-05 | Every log line carries a correlation ID. | 126 |  | API-AST-02, JOB-18 +5 | approval_events, ai_requests +3 | BO§2.5, BO§6.22 +2 | CT-02, EF-LOG-01 +1 | T-1.16, T-2.10 +3 | planned |  |
| REQ-LOG-06 | Severities: debug, info, warn, error. | 126 |  |  |  | CTL-3.14 |  | T-3.02 | planned |  |
| REQ-JOB-01 | Every cron/job is idempotent. | 127 | M-REPLY-01, M-REM-01 +7 | API-INT-06, API-APR-01 +10 | tasks, reminders +7 | BO§2.5, BO§6.14 +2 | DB-08, DB-16 +2 | T-2.06, T-2.08 +6 | planned |  |
| REQ-JOB-02 | Jobs are retryable where appropriate. | 127 | M-GL-02, M-GL-10 +32 | API-BOOT-01, API-INT-06 +20 | referral_codes, jobs +2 | BO§2.2, BO§3.2 +2 | IT-SYNC-05, IT-AI-09 +11 | T-1.14, T-1.17 +11 | planned |  |
| REQ-JOB-03 | Jobs are timeout-controlled. | 127 | M-VOICE-01 | JOB-00, JOB-01 +28 | jobs, job_attempts | BO§6.22, SEC§2.0 +1 | DB-16, EF-DEMO-01 +4 | T-0.03, T-2.05 +4 | planned |  |
| REQ-JOB-04 | Jobs are observable. | 127 |  | JOB-00, JOB-20 +3 | job_attempts, support_access_grants | BO§6.6, BO§7.3 +2 | DB-04, DB-16 +1 | T-2.12, T-3.06 | planned |  |
| REQ-JOB-05 | Job failure state is persisted. | 127 | M-SET-12 | ADM-02, ADM-04 +3 | connected_accounts, sync_states +2 | BO§6.2, BO§6.6 | SM Tests field | T-2.12 | planned |  |
| REQ-JOB-06 | Jobs are dead-letterable where appropriate. | 127 | M-ON-12 | JOB-00, ADM-05 +2 | jobs, job_attempts | BO§5.1, BO§6.6 | DB-16, IT-APR-10 +2 | T-3.06 | planned |  |
| REQ-EXPORT-01 | Export runs as an async job. | 128 | M-SET-38 | API-PRV-01, JOB-21 +1 |  | BO§6.6, BO§6.19 +2 | IT-PRIV-02, E2E-M-19 | T-11.01 | planned |  |
| REQ-EXPORT-02 | The export is a secure artifact. | 128 | M-GL-01, M-SET-38 +1 | API-PRV-01, JOB-21 +4 | data_export_requests | BO§2.2, BO§6.19 +2 | DB-09 | T-0.04, T-1.01 +4 | planned |  |
| REQ-EXPORT-03 | Access is via an expiring signed URL. | 128 | F-03, M-CAP-05 +2 | API-CAP-01, API-BRF-01 +3 | captures | BO§2.5, BO§6.19 +2 | IT-PRIV-02, BO-E2E-28 | T-5.09, T-11.01 | planned |  |
| REQ-EXPORT-04 | A status page shows export progress. | 128 | M-SET-38 | API-PRV-01, HLT-02 | data_export_requests | SEC§0.2, CTL-3.1 | SM Tests field | T-11.01 | planned |  |
| REQ-EXPORT-05 | Exports are audited. | 128 | M-SET-38 | API-PRV-01, HLT-02 |  | SEC§4.9 | SM Tests field | T-11.01 | planned |  |
| REQ-EXPORT-06 | No secrets or tokens in exports. | 128 |  | API-PRV-01, INT§12.3 | job_attempts, system_health_checks | BO§2.1, BO§7.7 +2 | API Tests bullet | T-11.01 | planned |  |
| REQ-DEL-01 | Deletion requires explicit confirmation. | 129 | M-GL-05, M-GL-06 +38 | API-DEV-02, API-INT-03 +26 | calendar_events, commitments +4 | BO§2.2, BO§2.4 +2 | TST-E2E-M-02, TST-E2E-M-03 +7 | T-1.11, T-6.06 +10 | planned |  |
| REQ-DEL-02 | Deletion states its consequences clearly. | 129 | M-SET-13, M-SET-39 | API-INT-05, API-PRV-03 |  | BO§6.5, CTL-3.16 +1 | TST-E2E-M-02 | T-8.20 | planned |  |
| REQ-DEL-03 | Deletion is a queued job where necessary. | 129 | M-ON-05N, M-SET-39 | API-PRV-03, JOB-23 +4 | jobs | BO§6.6, CTL-3.20 +1 | IT-PRIV-04 | T-11.03 | planned |  |
| REQ-DEL-04 | Deletion is audited. | 129 |  | API-PRV-03, PUB-03 +1 |  | SEC§4.9 | API Tests bullet | T-11.03 | planned |  |
| REQ-DEL-05 | Deletion includes local cleanup. | 129 | M-GL-05, M-GL-14 +24 | API-REM-03, JOB-04 +4 |  | THR-11, CTL-3.13 | UT-MB-03, IT-SYNC-09 +4 | T-8.03, T-8.05 +1 | planned |  |
| REQ-DEL-06 | Deletion revokes provider access where possible. | 129 | M-ON-06A, M-ON-07P +12 | API-DEV-03, API-INT-03 +12 | connected_accounts, oauth_credentials +4 | BO§2.3, BO§2.5 +2 | UT-ENT-04, IT-OAUTH-09 +7 | T-1.15, T-2.03 +10 | planned |  |
| REQ-DEL-07 | No fake "deleted" success. | 129 | M-ASST-01, M-SET-36 +3 | JOB-22 |  | BO§6.19, SEC§4.3 +1 | TST-E2E-M-02 | T-11.03 | planned |  |
| REQ-SET-01 | Settings include at least Profile, Connected Accounts… | 130 | M-SET-01, M-SET-02 +1 |  |  |  | SM Tests field | T-8.19 | planned (patched → SCREEN_MAP_4: M-SET-70..74) |  |
| REQ-SET-02 | Every setting is bound to real persisted state. | 130 | M-GL-01, M-GL-04 +40 | API-BOOT-01, API-MAIL-01 +4 |  | BO§5.3, BO§7.7 +2 | UT-MB-04, UT-MB-06 +3 | T-4.03, T-5.01 +3 | planned |  |
| REQ-DATA-01 | Frontends receive only the data they need. | 151 |  | AI§3.1, INT§0.2 |  | BO§2.1, BO§2.5 +2 | API Tests bullet | T-2.16, T-2.17 +2 | planned |  |
| REQ-DATA-02 | No unnecessary raw provider data in API responses. | 151 |  | JOB-21 |  |  | API Tests bullet | T-3.11 | planned |  |
| REQ-DATA-03 | Sensitive provider content is minimized. | 151 |  | AI§3.1, INT§3.10 |  | BO§2.5, SEC§1.4 +1 | API Tests bullet | T-2.16 | planned |  |
| REQ-DATA-04 | Admin APIs return even less data. | 151 | M-MAIL-03, M-REPLY-01 +2 | API-BIZ-02, ADM-02 +6 | profiles, connected_accounts +6 | BO§2.5, BO§4.1 +2 | DB-14, BO-E2E-10 +3 | T-2.17, T-10.04 | planned |  |
| REQ-SECRET-01 | Secrets are never in git. | 152 |  |  |  | BO§2.7, BO§14.1 +2 | BO Tests row | T-12.11 | planned |  |
| REQ-SECRET-02 | Secrets are never in frontend bundles. | 152 | M-CAP-04, M-VOICE-01 +2 | AI§6.9, INT§0.5 |  | BO§2.7, BO§14.1 +2 | QG-09 | T-0.03, T-1.01 +5 | planned |  |
| REQ-SECRET-03 | Secrets are never in logs. | 152 | M-SET-32, M-ANI-01 | API-MAIL-02, JOB-11 +4 |  | THR-18, CTL-3.14 | UT-GRD-16, EF-AI-03 | T-0.04 | planned |  |
| REQ-SECRET-04 | Secrets are never shown in the backoffice UI. | 152 | M-ON-05, M-ON-06 +8 | API-BRF-01, API-BIZ-03 +12 | ai_model_config | BO§3.8, BO§6.4 +2 | EF-HLT-01, BO-E2E-18 +5 | T-2.18, T-3.02 +6 | planned |  |
| REQ-SECRET-05 | Secrets are never sent to analytics. | 152 | F-01, F-03 +2 | API-DEV-01, API-INT-01 +22 | notification_preferences, android_notification_signals +3 | BO§6.3d, BO§7.1 +2 | CT-10, QG-22 +1 | T-1.16, T-2.04 +4 | planned |  |
| REQ-SECRET-06 | `.env.example` contains key names only. | 152 |  | INT§13.4 |  | THR-17 | UT-ENV-07 | T-0.04 | planned |  |
| REQ-REL-01 | Before release, verify in a real or sandbox environment: fresh… | 153 |  |  |  |  | A11Y-10, E2E-S-17 +22 | T-12.06 | planned |  |
| REQ-ACC-MOB-01 | Mobile has real working implementations of: Authentication… | 135 |  |  |  |  |  | T-12.10 | planned |  |
| REQ-ACC-BO-01 | Backoffice has real working implementations of: Admin auth, RBAC… | 136 |  |  |  | BO§14.2 | BO Tests row | T-10.15 | planned |  |
| REQ-ACC-WEB-01 | Public web delivers: responsive landing, pricing, privacy, terms… | 137 | W-HOME-01 |  |  |  | SM Tests field | T-9.03, T-12.10 | planned |  |

### 2.20 Secondary requirements: Today, Flow, Plan, Life, Assistant (SREQ)

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| SREQ-01 | [ADOPT] "Hero kartında küçük özet: 3 önemli mail · 4 etkinlik · 2"… | sec. | M-TD-01, W-SYS-05 | AI§12.3 |  |  | SM Tests field | T-8.08, T-9.05 | planned |  |
| SREQ-02 | [ADAPT] Priority card taxonomy and actions | sec. | M-TD-01, M-FLOW-01 +4 | API-MEET-01, HLT-02 +1 |  | SEC§4.3 | E2E-M-11 | T-8.08, T-8.10 +3 | planned |  |
| SREQ-03 | [ADOPT] Source line "Gmail · Mehmet Yılmaz · 08:42"; tapping it… | sec. | M-FLOW-01, M-MAIL-03 +5 |  |  |  | SM Tests field | T-8.03 | planned |  |
| SREQ-04 | [ADOPT] "Neden önemli?" opens a bottom sheet with a reason… | sec. | M-TD-03, M-SRC-01 +1 | AI§7.7 |  | SEC§4.14 | SM Tests field | T-1.07 | planned (patched → API_CONTRACTS, DB: `get_explanation` (R-24)) |  |
| SREQ-05 | [ADOPT] Morning hero line "Bugün oldukça sakin bir günün var."… | sec. | M-ON-03, M-BR-01 +2 | AI§12.3 |  |  | SM Tests field | T-8.06, T-8.09 +2 | planned |  |
| SREQ-06 | [ADOPT] Audio speeds "1x / 1.25x / 1.5x". | sec. | M-BR-02, F-03 +1 | AI§0.3 |  |  | E2E-M-05 | T-8.09 | planned |  |
| SREQ-07 | [ADOPT] Weekly title "Haftan Nasıl Geçti?" | sec. | M-BR-05 |  |  |  | SM Tests field | T-8.09 | planned |  |
| SREQ-08 | [ADOPT] Flow item anatomy "icon, source, title, summary, time"… | sec. | M-FLOW-01 |  |  |  | SM Tests field | T-8.10 | planned |  |
| SREQ-09 | [ADOPT] Mail Intelligence header "Bugün 83 mail" / "6 tanesi"… | sec. | M-FLOW-01, M-MAIL-01 | HLT-02, RPC-08 +1 |  |  | SM Tests field | T-8.10, T-8.11 | planned |  |
| SREQ-10 | [ADOPT] Mail Intelligence rows open separate smart views | sec. | M-FUP-01 | AI§12.3 |  |  | SM Tests field | T-8.11 | planned |  |
| SREQ-11 | [ADAPT] Waiting-for-you buckets "Acil / Bugün / Yakında". Card… | sec. | M-WAIT-01 |  |  |  | E2E-S-04 | T-8.11 | planned |  |
| SREQ-12 | [ADOPT] Waiting Reply actions "İlgili maili aç / Yanıt Hazırla"… | sec. | M-FLOW-01, M-MAIL-01 +4 | API-MAIL-02, HLT-02 |  |  | E2E-S-04, E2E-M-06 | T-8.11 | planned (patched → SCREEN_MAP_2: label “İlgili maili aç”) |  |
| SREQ-13 | [ADOPT] Follow-up card: "Mehmet Yılmaz · Teklif · Son mesaj: 3"… | sec. | M-ON-04, M-GATE-01 |  |  |  | SM Tests field | T-8.06, T-8.22 | planned |  |
| SREQ-14 | [ADAPT] Email Detail "Görev Oluştur" sheet with fields "Görev"… | sec. | M-MAIL-03, M-CAP-06 +4 | API-APR-01, API-CAP-04 +2 | tasks | SEC§0.2, CTL-3.16 | SM Tests field | T-6.04, T-8.11 | planned |  |
| SREQ-15 | [ADOPT] "Orijinal Maili Aç" must work: an "external-mail opening"… | sec. | M-MAIL-03, M-MAIL-04 +1 | API-MAIL-01, HLT-02 +2 | email_messages | BO§2.1, SEC§0.2 +1 | E2E-M-06 | T-4.08, T-8.11 | planned |  |
| SREQ-16 | [ADAPT] AI Draft "Gmail'de Aç" is a prototype external-app… | sec. | M-MAIL-03, M-MAIL-04 +4 | API-MAIL-01, JOB-17 +1 | email_threads, email_messages |  | SM Tests field | T-8.11, T-8.17 +3 | planned |  |
| SREQ-17 | [ADOPT] Commitments "Ertele" opens a date/time reschedule sheet… | sec. | M-TD-01, M-MAIL-03 +2 | HLT-02 |  |  | E2E-M-12 | T-8.12 | planned |  |
| SREQ-18 | [ADOPT] "Plan bölümünde 'Taahhütler' ekranı". | sec. | M-FLOW-01, M-FUP-01 +7 |  |  |  | SM Tests field | T-8.10, T-8.11 +5 | planned |  |
| SREQ-19 | [ADOPT] "Planla" shows the proposed block "14:00–16:30" with task… | sec. | M-PLAN-03, M-PLAN-04 +3 | API-APR-02, API-PLAN-01 +1 |  |  | E2E-M-10 | T-8.13 | planned |  |
| SREQ-20 | [ADAPT] Conflict alert "Takvim Çakışması · 14:00–15:00 müşteri"… | sec. | M-TD-01, M-BR-03 +2 | API-PLAN-03, HLT-02 |  |  | SM Tests field | T-8.08, T-8.09 +1 | planned |  |
| SREQ-21 | [ADOPT] Live countdown "18 dakika kaldı". | sec. | M-ON-14, M-MEET-01 | JOB-15, AI§13.1 +1 |  | CTL-3.12 | SM Tests field | T-6.08, T-8.14 | planned |  |
| SREQ-22 | [ADOPT] Meeting Prep "Not Al" opens a notes sheet or page that… | sec. | M-PLAN-09, M-MEET-01 +2 | API-MEET-02, HLT-02 +1 | meeting_notes |  | E2E-F, E2E-M-11 | T-8.14 | planned |  |
| SREQ-23 | [ADOPT] "Toplantıyı Başlat" is an external Google Meet / Teams… | sec. | M-MEET-01 | HLT-02 |  |  | SM Tests field | T-8.14 | planned |  |
| SREQ-24 | [ADAPT] Post-meeting parsed card "Yeni Taahhüt · Mehmet'e teklif"… | sec. | M-ON-07P, M-ON-10T +18 | API-APR-03, API-MEET-03 +2 | approval_actions | CTL-3.16 | IT-APR-15, E2E-F +1 | T-5.10, T-8.14 | planned |  |
| SREQ-25 | [ADOPT] Per-type actions | sec. | M-FLOW-01, M-LIFE-01 |  |  |  | SM Tests field | T-8.10, T-8.12 | planned |  |
| SREQ-26 | [ADAPT] Fixtures "TK2412 İstanbul→Antalya Yarın 09:15", "Netflix"… | sec. | F-08 | AI§6.9, INT§13.3 |  |  | UT-AMT-08, UT-GRD-15 +1 | T-1.06, T-4.10 | planned |  |
| SREQ-27 | [ADOPT] Extra suggested prompt "Ödenmesi gereken bir şey var mı?"… | sec. | M-ASST-01 | API-AST-02, AI§11.2 |  |  | SM Tests field | T-5.11, T-8.15 | planned |  |
| SREQ-28 | [ADOPT] Assistant "+" / attachment button opens a menu "Fotoğraf"… | sec. | M-GL-07, M-GL-10 +32 | API-MAIL-01, API-AST-03 +20 | tasks, commitments +11 | BO§5.5, BO§6.3d +2 | UT-ENT-09, CT-06 +10 | T-0.03, T-1.04 +15 | planned |  |
| SREQ-29 | [ADOPT] Rich answer cards: mail card, calendar card, person card. | sec. | M-ASST-02, M-PERS-01 |  |  |  | SM Tests field | T-8.15 | planned |  |
| SREQ-30 | [ADAPT] Voice examples "Yarınki toplantımı 30 dakika ileri al."… | sec. | M-BR-02, M-MEET-04 +2 |  |  |  | SM Tests field | T-8.09, T-8.14 +1 | planned |  |
| SREQ-31 | [ADOPT] Capture screen title "Dijital Asistan'a Ekle". The result… | sec. | M-CAP-01 |  |  |  | E2E-M-15 | T-8.17 | planned |  |
| SREQ-32 | [ADOPT] Pickers | sec. | M-CAP-01, M-CAP-02 +1 |  |  |  | SM Tests field | T-8.17, T-8.20 | planned |  |
| SREQ-33 | [ADOPT] Capture actions "Takvime Ekle / Görev Oluştur"… | sec. | M-REM-01, M-CAP-06 +5 | API-APR-01, API-REM-02 +3 |  | SEC§0.2, CTL-3.16 | E2E-D, E2E-M-08 +1 | T-6.04, T-6.06 | planned |  |
| SREQ-34 | [ADOPT] "Uygun zamanda" explainer "Takvimindeki boşluklara göre"… | sec. | M-REM-01 | API-REM-01, AI§6.9 | user_preferences |  | E2E-D, E2E-M-09 | T-1.12, T-6.06 +1 | planned |  |
| SREQ-35 | [ADOPT] One canonical `SmartReminderSheet`, callable from Email… | sec. | M-GL-06, M-GL-07 +15 | API-REM-01, API-REM-02 +2 |  |  | SM Tests field | T-8.18 | planned |  |
| SREQ-36 | [ADOPT] "Kendin seç" opens a real date/time picker. | sec. | M-TD-04, M-REM-01 +1 |  |  |  | UT-REM-08, E2E-M-09 | T-1.12, T-8.18 | planned |  |
| SREQ-37 | [ADAPT] VIP categories "eş, aile, yönetici, önemli müşteri, özel"… | sec. | M-PERS-01, M-VIP-01 +2 | HLT-02 | vip_people |  | SM Tests field | T-8.16 | planned (patched → SCREEN_MAP_1/3: `relationship` groups, manual add) |  |
| SREQ-38 | [ADOPT] Person page query box "Mehmet hakkında sor…". | sec. | M-ASST-02, M-PERS-01 | API-AST-01, AI§11.2 | assistant_threads |  | E2E-S-13 | T-8.16 | planned |  |
| SREQ-39 | [ADOPT] Person Intelligence entry points: email sender… | sec. | M-PERS-01 | AI§10.6 |  |  | SM Tests field | T-8.14, T-8.16 | planned |  |
| SREQ-40 | [ADOPT] Search examples "Geçen ay gelen uçak bileti / Mehmet'in"… | sec. | M-SRCH-01, M-SET-50 +1 | AI§10.10 |  |  | E2E-G, E2E-H +1 | T-4.10 | planned (patched → API_CONTRACTS: `/search` params) |  |
| SREQ-41 | [ADOPT] Search result routing | sec. | M-GL-06, M-FLOW-01 +1 |  |  |  | SM Tests field | T-8.12 | planned |  |
| SREQ-42 | [ADOPT] "Onay Bekleyenler" entry in the Today header and in… | sec. | M-GL-04, M-TD-01 +3 |  |  |  | SM Tests field | T-8.04, T-8.08 +2 | planned |  |
| SREQ-43 | [ADAPT] "AI write action sonrası otomatik açılabilmeli" and… | sec. | M-FLOW-01, M-MAIL-01 +9 |  |  |  | SM Tests field | T-8.10, T-8.11 +2 | planned |  |
| SREQ-44 | [ADOPT] Approval "Düzenle" opens an edit sheet where the action's… | sec. | M-MAIL-03, M-REPLY-01 +4 |  |  |  | SM Tests field | T-8.11, T-8.18 | planned |  |
| SREQ-45 | [ADOPT] Approval item shows "Hangi kaynak nedeniyle?"; a success… | sec. | M-GL-06, M-ON-04 +13 | AI§4.3, INT§3.9 | insights, approval_actions | BO§6.8, BO§6.12 +2 | E2E-M-06, E2E-M-07 | T-0.03, T-1.07 +3 | planned |  |
| SREQ-46 | [ADOPT] "AI tarafından önerilen planlama" and "Universal Capture"… | sec. | M-GL-01, M-GL-05 +36 | API-MAIL-01, API-MAIL-05 +15 | email_messages, calendar_events +11 | BO§2.3, BO§2.4 +2 | UT-MB-04, EF-MAIL-01 +2 | T-2.01, T-2.08 +6 | planned |  |

### 2.21 Secondary requirements: Onboarding, notifications, settings, states, web, process (SREQ)

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| SREQ-47 | [ADOPT] Intro copy | sec. | M-ON-04 |  |  |  | E2E-M-01 | T-8.06 | planned |  |
| SREQ-48 | [ADOPT] "Google ile devam et / Apple ile devam et / Microsoft ile"… | sec. | M-ON-05, M-ON-05E |  |  |  | E2E-M-01 | T-8.05 | planned |  |
| SREQ-49 | [ADAPT] "Dijital hayatını bağla." with cards Gmail / Outlook… | sec. | M-ON-06 |  |  |  | E2E-M-01 | T-8.06 | planned |  |
| SREQ-50 | [ADAPT] "Kullanıcı minimum bir mail + bir calendar bağladığında"… | sec. | M-ON-06, M-ON-07 +3 | API-ONB-01 |  |  | E2E-M-01 | T-8.06 | planned |  |
| SREQ-51 | [ADOPT] Permission explainer before OAuth | sec. | M-ON-06, M-ON-06G +8 |  |  |  | SM Tests field | T-8.06 | planned |  |
| SREQ-52 | [ADOPT] Calendar permission screen | sec. | M-ON-06A, M-ON-07 +5 |  |  |  | SM Tests field | T-8.06 | planned |  |
| SREQ-53 | [ADOPT] "Günün ne zaman başlıyor?" with times and toggles for… | sec. | M-ON-10, M-ON-10T +1 | AI§6.9 |  |  | UT-DATE-09 | T-8.06, T-8.19 | planned |  |
| SREQ-54 | [ADOPT] "Senin için neler daha önemli?" chips "İş / Aile / Finans"… | sec. | M-ON-09 |  |  |  | E2E-M-01 | T-8.06 | planned |  |
| SREQ-55 | [ADAPT] First analysis steps "Son 72 saat taranıyor / E-postalar"… | sec. | M-ON-12 |  |  |  | E2E-M-01 | T-8.06 | planned |  |
| SREQ-56 | [ADAPT] "Hazır." / "Son 72 saatte bilmen gereken 5 şey bulduk."… | sec. | M-ON-13 | API-ONB-02, AI§1.7 +1 |  |  | E2E-M-01 | T-8.06 | planned |  |
| SREQ-57 | [ADOPT] Notification pre-prompt "Sadece önemli olduğunda haber"… | sec. | M-ON-14 | INT§12.8 |  |  | E2E-M-01 | T-8.06 | planned |  |
| SREQ-58 | [ADOPT] Splash "Logo + tagline animasyonu". [PL] | sec. | M-GL-01, M-GL-02 +1 |  |  |  | REL-01 | T-0.03, T-8.01 | planned |  |
| SREQ-59 | [ADAPT] Push copy | sec. | M-ON-05E, M-BR-06 +7 | API-PLAN-02, JOB-14 +6 | prompt_versions | BO§6.11, BO§14.2 +2 | IT-AI-06 | T-0.04, T-5.04 +1 | planned (patched → SCREEN_MAP_4: push template catalogue) |  |
| SREQ-60 | [ADOPT] "Yalnızca gerçekten önemliyse bildir." | sec. | M-SET-01, M-SET-20 | API-BOOT-01, JOB-18 +1 | notification_preferences, notifications |  | UT-NTF-07 | T-1.08, T-2.04 +2 | planned |  |
| SREQ-61 | [ADOPT] Briefing settings "Timezone" and "Sessiz günler". | sec. | M-TD-01, M-SET-23 | HLT-02, AI§12.1 | user_preferences |  | SM Tests field | T-8.08, T-8.19 | planned |  |
| SREQ-62 | [ADOPT] Android NI "App list. Priority rules. Privacy warning." | sec. | M-ANI-01, M-ANI-03 |  |  |  | SM Tests field | T-8.26 | planned (patched → DB: owner delete on `android_notification_signals`) |  |
| SREQ-63 | [ADOPT] Widget content | sec. |  | INT§1.2 |  | CTL-3.13 | UT-WID-01, CT-09 | T-1.16, T-8.25 | planned (patched → SCREEN_MAP_4: M-WGT-01..08) |  |
| SREQ-64 | [ADAPT] Paywall headline "Dijital Asistan'ın tamamını aç." | sec. | M-PAY-01 |  |  |  | SM Tests field | T-8.22 | planned |  |
| SREQ-65 | [ADAPT] "Aylık 199 TL / ay · Yıllık 1.490 TL / yıl · 7 Gün"… (store prices replace fixed values) | sec. | M-PAY-01 | INT§10.3 |  |  | E2E-M-16 | T-8.22 | planned |  |
| SREQ-66 | [ADOPT] "Arkadaşını Davet Et" / "İkiniz de 14 gün Pro kazanın."… | sec. | M-REF-01, M-REF-02 +1 |  |  |  | E2E-M-17 | T-8.22, T-9.05 | planned |  |
| SREQ-67 | [ADOPT] Integrations: Gmail, Outlook, Google Calendar, Microsoft… | sec. | M-REM-03, M-APPR-05 +2 | AI§1.8, INT§2.10 | tasks |  | E2E-D, REL-04 +1 | T-8.18, T-8.13 +1 | planned |  |
| SREQ-68 | [ADOPT] Data Source Control | sec. | M-ON-07P, M-ON-08 +4 | API-INT-05, HLT-02 +2 | connected_accounts | SEC§4.3, SEC§4.4 | SM Tests field | T-4.12, T-8.20 | planned |  |
| SREQ-69 | [ADOPT] Profile list includes "Briefing Settings, VIP People"… | sec. | M-SET-01 |  |  |  | SM Tests field | T-8.19 | planned |  |
| SREQ-70 | [ADOPT] Help: "FAQ / Getting Started / Integrations / Privacy"… | sec. |  |  |  |  | E2E-S-16 | T-8.19 | planned (patched → SCREEN_MAP_4: M-SET-70/71) |  |
| SREQ-71 | [ADAPT] Feedback: "Bug Report / Feature Request / General"… | sec. |  | API-SUP-02 | user_feedback |  | E2E-S-16 | T-8.19 | planned (patched → SCREEN_MAP_4: M-SET-72) |  |
| SREQ-72 | [ADOPT] Learned preference "Edit → Priority: High / Normal / Low"… | sec. | M-SET-46 | AI§7.3 |  |  | E2E-S-12 | T-8.21 | planned (patched → DB: `learned_preferences.params` grant) |  |
| SREQ-73 | [ADOPT] Privacy sub-screens | sec. | M-SET-01, M-SET-03 +5 | API-PRV-03, JOB-23 +1 |  | SEC§4.8 | IT-OAUTH-11 | T-8.20, T-11.03 | planned |  |
| SREQ-74 | [ADOPT] Retention options with a real selected state. "Sistem"… | sec. | M-ON-07, M-ON-07D +12 | INT§3.9 |  | CTL-3.12, SEC§4.3 | SM Tests field | T-8.07 | planned |  |
| SREQ-75 | [ADOPT] Appearance offers only System / Light / Dark. The… | sec. | M-SET-01, M-SET-60 |  |  |  | E2E-I, E2E-M-18 | T-8.19 | planned |  |
| SREQ-76 | [ADOPT] "Etkileşimlerimden öğren". | sec. | M-CORR-01, M-SET-45 | HLT-02, AI§1.8 |  | SEC§4.3, SEC§4.14 | E2E-S-12 | T-8.21 | planned |  |
| SREQ-77 | [ADOPT] "Veriler aktarım sırasında ve saklanırken şifrelenir." or… | sec. | M-SET-30 |  |  | SEC§4.1, SEC§4.3 | E2E-M-19 | T-8.20 | planned |  |
| SREQ-78 | [REJECT] "Training toggle wording son derece açık olsun." | sec. | M-SET-30, M-SET-45 +1 | AI§1.7, INT§10.8 |  | SEC§1.4, THR-10 | SM Tests field | T-8.20, T-9.03 +1 | rejected (SREQ REJECT) |  |
| SREQ-79 | [ADOPT] Empty-state copy: "Her şey kontrol altında." / "Bugün"… | sec. | M-TD-01, M-FLOW-01 | INT§12.2 |  |  | SM Tests field | T-8.08, T-8.10 | planned |  |
| SREQ-80 | [ADOPT] Error cases: "Connection expired, OAuth failed, Calendar"… | sec. | M-TD-01 | AI§1.6, INT§3.8 |  |  | E2E-S-18 | T-8.08 | planned |  |
| SREQ-81 | [ADOPT] Loading states: skeletons, AI processing state… | sec. | M-TD-01, M-BR-07 +4 | API-BOOT-01, API-INT-04 +1 |  |  | SM Tests field | T-8.08, T-8.09 +4 | planned |  |
| SREQ-82 | [ADOPT] Micro-interactions: card expand, priority swipe actions… | sec. | M-GL-06, M-ON-05V +17 |  | user_preferences |  | SM Tests field | T-0.03, T-8.03 | planned |  |
| SREQ-83 | [ADOPT] Insight feedback "👍 Doğru / 👎 Önemli değil veya context"… | sec. | M-ON-05V, M-ON-14A +5 | PUB-02, HLT-02 +1 |  | BO§2.5, BO§3.3 +1 | UT-GRD-16 | T-8.03 | planned (patched → SCREEN_MAP_2, API_CONTRACTS: `ai_feedback` kind/rating) |  |
| SREQ-84 | [ADOPT] Component list: Toast, Snackbar, Date pickers, Segmented… | sec. | M-ON-14A, M-REPLY-01 +5 |  |  |  | SM Tests field | T-8.02 | planned |  |
| SREQ-85 | [ADOPT] "Bir UI elementi button görünümündeyse … veya … button"… | sec. | M-ON-02, M-PLAN-06 | HLT-02, RPC-01 |  | BO§5.4, BO§14.2 | UT-MB-08, E2E-S-03 | T-1.01, T-8.04 +2 | planned |  |
| SREQ-86 | [ADOPT] "Color tek başına status anlamı taşımasın. Icon + text"… | sec. | M-ON-06, M-BR-03 +5 |  |  | BO§5.7 | SM Tests field | T-8.06, T-8.09 +5 | planned |  |
| SREQ-87 | [ADOPT] Tone "sakin, net, zeki, kısa, yardımcı; asla patronluk"… | sec. |  |  |  |  | UT-I18N-03 | T-1.04 | planned |  |
| SREQ-88 | [ADOPT] "Text container'ları çok dar tasarlama. RTL zorunlu"… | sec. |  |  |  |  | pseudo-locale +40% QA | T-8.29 | planned |  |
| SREQ-89 | [ADOPT] "Her kart 'Peki şimdi ne yapacağım?' sorusuna bir action"… | sec. | M-FLOW-01, M-MAIL-01 |  |  |  | SM Tests field | T-8.10, T-8.11 | planned |  |
| SREQ-90 | [ADAPT] Representative widths: iOS 393, Android 412. | sec. | M-PLAN-01, F-08 | JOB-17, AI§6.9 +1 |  |  | UT-AMT-08, UT-GRD-15 +2 | T-1.06, T-4.10 | planned |  |
| SREQ-91 | [ADOPT] Android: "Dynamic Island kullanma. Android"… | sec. | M-GL-03 |  |  |  | SM Tests field | T-8.04 | planned |  |
| SREQ-92 | [ADOPT] Remove deferral wording (TR/EN) from product copy (QG-03/QG-04) | sec. |  |  |  |  | QG-04 | T-0.06 | planned |  |
| SREQ-93 | [ADAPT] Desktop nav "Logo / Özellikler / Güvenlik / Fiyatlandırma"… | sec. | W-HOME-01 |  |  |  | WEB-E2E-11 | T-9.02 | planned |  |
| SREQ-94 | [ADOPT] Landing layout | sec. | W-SYS-05 | JOB-00 | email_threads | BO§7.6 | WEB-E2E-10 | T-9.02 | planned |  |
| SREQ-95 | [ADOPT] Hero logos Gmail / Outlook / Google Calendar / Apple… | sec. | M-ON-06, M-ON-06O +8 | JOB-03, HLT-02 +2 |  | BO§6.6, CTL-3.2 +1 | IT-OAUTH-08, REL-04 +2 | T-12.11 | planned |  |
| SREQ-96 | [ADOPT] 6 store screenshots with fixed captions. | sec. | M-CAP-01, M-CAP-06 +2 | API-CAP-01, API-CAP-03 +2 | captures | CTL-3.11, CTL-3.13 | A11Y-07, VIS-01 +3 | T-8.28, T-9.07 | planned |  |
| SREQ-97 | [ADAPT] 3 social ads in true 9:16, 1080×1920 | sec. | M-BR-06, F-06 | AI§12.6 |  |  | SM Tests field | T-9.07 | planned |  |
| SREQ-98 | [ADAPT] IA page and User Flow page (FLOW 1–6). | sec. | M-FLOW-01 | INT§13.4 |  |  | UT-FLOW-01 | T-0.01, T-7.03 +1 | planned |  |
| SREQ-99 | [ADOPT] Final self-audit matrix "DONE / FIXED NOW / NOT"… | sec. | M-ON-14A, M-CAP-04 | JOB-23, ADM-03 +3 | billing_events | CTL-3.9, SEC§4.8 | REL-14 | T-12.06 | planned |  |
| SREQ-100 | [ADOPT] Acceptance flows A–J | sec. |  | HLT-02, INT§13.4 |  | BO§2.2 | E2E-A..E2E-J | T-8.30, T-12.06 | planned |  |
| SREQ-101 | [REJECT] Figma-only instructions: Auto Layout, the page list "00"… | sec. |  |  |  |  |  |  | rejected (SREQ REJECT) |  |
| SREQ-102 | [REJECT] PL architecture: "React Router v6", "React Context +"… | sec. |  |  |  |  |  |  | rejected (SREQ REJECT) |  |
| SREQ-103 | [ADAPT] PL Turkish route slugs (`/sabah-brifing`… | sec. | M-GL-07, M-SET-01 +4 | AI§5.1, INT§4.1 |  | BO§5.2 | E2E-S-15 | T-8.19, T-9.01 | planned |  |
| SREQ-104 | [ADAPT] PL mock data (Yunus; Ahmet Yılmaz, Mehmet Kaya, Ayşe… | sec. | M-TD-03, M-SRC-01 +3 | OAUTH-03, AI§5.1 +1 |  | BO§13.4 | UT-NTF-10, E2E-M-06 +1 | T-4.10 | planned |  |

### 2.22 Audit resolutions (C-01…C-37, P-01…P-06)

| REQ-ID | Requirement | M§ | Screens | API / Jobs | Tables | Backoffice / Security | Tests | WBS | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| C-01 | Onboarding order — Keep MASTER's order: Personalization before… | C | M-ON-08, M-ON-09 +1 |  |  |  | SM Tests field | T-8.06 | planned |  |
| C-02 | Morning Briefing sections — Use MASTER's six labels exactly. | C | M-BR-01 |  |  |  | E2E-M-05 | T-8.09 | planned |  |
| C-03 | Evening sections — Use MASTER. "Yarın Sabah" content folds into… | C | M-BR-04 | JOB-14, AI§12.5 |  |  | E2E-M-05 | T-5.08 | planned |  |
| C-04 | Flow card types — Use MASTER's 9 types. Add Flight; bill becomes… | C | M-ON-08, M-TD-01 +8 | API-INT-06, API-APR-01 +3 | life_events, android_notification_signals +2 | BO§2.5, BO§3.2 +2 | UT-PRI-16, UT-GRD-15 +2 | T-1.06, T-4.02 +3 | planned |  |
| C-05 | Mail category label — Use "Düşük Öncelik". "Gereksiz" is… | C | M-MAIL-01, M-MAIL-02 | AI§4.3 |  |  | UT-PRI-01, UT-PRI-02 +4 | T-8.11 | planned |  |
| C-06 | Post-meeting save — "Kaydet" on the editable proposal card is the… | C | M-ON-07P, M-ON-10T +15 | API-APR-03, API-MEET-03 +2 | approval_actions | CTL-3.16 | IT-APR-15, E2E-F +1 | T-5.10, T-8.14 | planned |  |
| C-07 | Voice write actions — Voice command → approval sheet → the user… | C | M-ASST-03, M-VOICE-01 +1 | JOB-14, HLT-02 +2 | approval_actions | SEC§0.2 | IT-SYNC-07, IT-RC-07 | T-8.15 | planned |  |
| C-08 | Reminder creation — In-app reminders (local or server push) use a… | C | M-TD-01, M-MAIL-03 +6 | API-REM-02, HLT-02 +1 | reminders | CTL-3.16 | IT-SYNC-08, IT-RC-08 +1 | T-6.06 | planned |  |
| C-09 | Trial and prices — Trial CTA and copy are conditional on… | C | M-GL-13, M-PAY-01 +2 | API-BIZ-01, AI§0.3 +1 |  |  | UT-MB-10, E2E-M-16 | T-8.22 | planned |  |
| C-10 | "Sınırsız AI analiz" — Remove "Sınırsız". Pro has higher… | C | W-PRICE-01, W-LEGAL-02 | AI§8.9 |  | SEC§4.1 | UT-ENT-12, WEB-E2E-03 +1 | T-0.06, T-9.02 | planned |  |
| C-11 | Android NI scope — Even in "Tüm uygulamalar" mode, a default… | C | M-ON-14A, M-ANI-01 +1 | API-ANI-01, HLT-02 +2 | android_notification_signals, feature_flags | SEC§1.4, THR-01 | QG-22, REL-20 | T-8.26 | planned |  |
| C-12 | Android NI processing claim — Claim it only if classification… | C | M-ON-14A, M-MEET-02 +5 | API-APR-05, API-AST-03 +4 | android_notification_signals | SEC§1.3, SEC§1.4 | QG-06, REL-16 | T-5.09, T-8.26 | planned |  |
| C-13 | Training toggle — No training toggle. Show a static no-training… | C | M-SET-30, M-SET-45 +1 | AI§1.7, INT§10.8 |  | SEC§1.4, THR-10 | SM Tests field | T-8.20, T-9.03 +1 | planned |  |
| C-14 | Push content — Default mode = generic or title-only (e.g. "Bugün"… | C | M-ON-05, F-01 +4 | JOB-18, INT§9.5 | notification_preferences | BO§6.5, BO§6.14 +2 | UT-NTF-11, UT-NTF-13 +2 | T-1.08, T-2.04 +1 | planned |  |
| C-15 | Life card amounts — Render amount and deadline fields only when… | C | M-BR-01, M-COMMIT-02 +3 | API-AST-02, JOB-11 +1 |  | CTL-3.15 | UT-GRD-06, UT-GRD-14 +2 | T-1.04, T-1.13 +1 | planned |  |
| C-16 | Approval action vocabulary — Map to the MASTER enum only… | C | M-APPR-01 | AI§8.14 | approval_actions | BO§7.4, THR-09 +1 | SM Tests field | T-1.05 | planned |  |
| C-17 | Onboarding gate — Primary CTA is enabled once at least one source… | C | M-ON-06, M-ON-07 +3 | API-ONB-01 |  |  | E2E-M-01 | T-8.06 | planned |  |
| C-18 | Settings list — Use the union of both lists. Delete Account is… | C | M-SET-30, M-SET-39 | API-PRV-03, HLT-02 | profiles | CTL-3.1, CTL-3.17 | SM Tests field | T-8.20, T-11.03 | planned (patched → SCREEN_MAP_4: M-SET-70..74) |  |
| C-19 | Notification settings — Use the union. Quiet Hours, Lock Screen… | C | M-SET-20, M-SET-21 +1 | AI§7.2 |  | BO§6.8 | SM Tests field | T-8.19, T-8.21 | planned (patched → DB, SCREEN_MAP_4: quiet-hours columns (R-13)) |  |
| C-20 | Priority rules — Use the union with the MASTER precedence… | C | M-MAIL-03, M-ANI-03 | AI§1.4 | email_threads |  | UT-PRI-02, UT-PRI-06 | T-1.07 | planned |  |
| C-21 | Midday cadence — 13:00 is the evaluation window. Generate and… | C | M-ON-02, M-ON-03 +17 | API-DEV-02, API-INT-05 +11 | user_preferences, connected_accounts +1 | BO§4.1, BO§6.3a +1 | UT-REM-06, UT-NTF-08 +3 | T-0.01, T-5.08 +2 | planned |  |
| C-22 | Localization — Full EN at launch. All strings go through i18n… | C | M-GL-07, M-SET-01 +1 | AI§5.1, INT§4.1 |  | BO§5.2 | E2E-S-15 | T-8.19, T-9.01 | planned |  |
| C-23 | Dark mode scope — Every screen supports dark mode. The 7 screens… | C | M-GL-01, M-GL-03 +18 | ADM-00, INT§12.2 | user_preferences, admin_preferences | BO§3.8, BO§5.1 | UT-MB-01, A11Y-08 +10 | T-1.02, T-8.01 +3 | planned |  |
| C-24 | Web login — Remove "Giriş". `/data-deletion` hosts an… | C | M-SET-39, W-LEGAL-02 +2 | JOB-23, PUB-02 +3 |  | SEC§1.2, CTL-3.18 | VIS-01, REL-12 | T-9.04, T-12.11 | planned |  |
| C-25 | Widgets — Use the union. | C | M-ON-06O, M-MAIL-03 | INT§12.3 |  |  | REL-13 | T-8.25 | planned (patched → SCREEN_MAP_4: M-WGT-01..08) |  |
| C-26 | Landing sections — Add FAQ. | C | W-SUP-01, W-SYS-05 |  |  | THR-03 | E2E-S-16, WEB-E2E-01 +2 | T-1.04, T-8.19 +2 | planned |  |
| C-27 | Marketing truthfulness — Remove "Kredi kartı gerekmez": store… | C |  |  |  | SEC§4.1 | WEB-E2E-01 | T-0.06, T-9.02 | planned |  |
| C-28 | Follow-up labels — Use the MASTER labels. "Yarın hatırlat" opens… | C | M-TD-01, M-FUP-01 +1 | API-REM-02, HLT-02 |  |  | E2E-S-05 | T-8.11 | planned |  |
| C-29 | Email detail meta — Use MASTER. | C | M-MAIL-03, M-MAIL-04 +1 | API-MAIL-01, HLT-02 +2 | email_messages | BO§2.1, SEC§0.2 +1 | E2E-M-06 | T-4.08, T-8.11 | planned |  |
| C-30 | Audio — Add a seek bar. | C | M-BR-02, M-MEET-03 | AI§14.2 |  |  | REL-06, E2E-M-05 | T-8.09, T-8.27 | planned |  |
| C-31 | Privacy highlights copy — Use MASTER copy verbatim. | C | M-SET-30 |  |  | CTL-3.19, SEC§4.1 | WEB-E2E-04, E2E-M-19 | T-8.20 | planned |  |
| C-32 | Capture extraction types — Use MASTER's 10 types. | C | M-GL-03, M-ON-05 +11 | API-INT-01, API-ANL-01 +8 | subscriptions, billing_events +1 | BO§2.7, BO§4.1 +2 | UT-ENT-08, UT-ENV-03 +7 | T-0.06, T-1.01 +10 | planned |  |
| C-33 | Capture sources — Use the MASTER set plus share-sheet entry. | C | M-GL-01, M-GL-02 +44 | API-BOOT-01, API-MEET-01 +18 | profiles, meeting_preps +3 | BO§2.5, BO§3.1 +2 | UT-SSRF-04, UT-ENV-08 +4 | T-0.01, T-0.02 +171 | planned |  |
| C-34 | First flow ends — Use MASTER. | C | M-GL-01, M-ON-14 +6 |  |  |  | SM Tests field | T-8.04, T-8.06 +1 | planned |  |
| C-35 | Integrations on Android — Filter by platform. Apple Calendar and… | C | M-ON-07E, M-FLOW-01 +2 | INT§3.9 |  |  | SM Tests field | T-8.06, T-8.10 +2 | planned |  |
| C-36 | Conflict resolution — See SREQ-20. | C | M-CAP-06, M-PLAN-02 +2 | API-APR-02, API-PLAN-03 +2 |  |  | SM Tests field | T-8.17, T-8.13 | planned |  |
| C-37 | Approval navigation — Inline approval sheet; Approval Center is… | C | M-FLOW-01, M-MAIL-01 +10 |  |  |  | SM Tests field | T-8.18 | planned |  |
| P-01 | "Uçtan uca TLS · Veriler AB'de (Frankfurt) saklanır · KVKK ve"… | C | M-GL-09, M-MAIL-03 +11 | HLT-01, AI§16.4 +1 |  | BO§5.3, SEC§0.2 +1 | SM Tests field | T-8.04, T-8.11 +7 | planned |  |
| P-02 | "Günde ortalama 3 bildirim." (`02 Onboarding`) — replaced per R-14 by `daily_cap` 5 and "Sadece önemli olduğunda haber veririz." | C | M-ON-14, M-SET-20 | JOB-18, ADM-20 +2 | notification_preferences | SEC§0.2, SEC§4.1 | UT-NTF-05 | T-1.08 | planned |  |
| P-03 | "Deneme bitmeden 24 saat önce hatırlatırız." — Schedule a push… | C | M-PAY-01 | JOB-24, AI§4.3 +1 | subscriptions |  | IT-RC-07 | T-8.22 | planned |  |
| P-04 | "Onaylananlar geçmişte 30 gün saklanır." / "geçmiş özetler 30 gün"… | C | M-SET-13, M-SET-37 |  | approval_actions | SEC§0.2 | SM Tests field | T-8.19, T-8.20 | planned |  |
| P-05 | "Mail içerikleri model eğitiminde kullanılmaz." — Keep, and… | C | M-SET-30, M-SET-45 +1 | AI§1.7, INT§10.8 |  | SEC§1.4, SEC§4.3 | SM Tests field | T-8.20, T-9.03 +1 | planned |  |
| P-06 | Referral "Sınır: yılda 6 davet" — Adopt as the default config… | C | W-LEGAL-02 | API-BOOT-01, ADM-20 | plan_limits | BO§6.24 | UT-REF-05 | T-9.03 | planned |  |

---

## 3. Definition of Done per feature

### 3.1 DoD chain template (M§98; plan §22)

Copy this checklist into the PR description of every feature PR. A feature is done only when every box is ticked and has evidence. If any link in the chain is faked, the feature is not done.

- [ ] **1. UI**
  - Every screen of the feature exists as specified in SCREEN_AND_FLOW_MAP.
  - All of these states are implemented and visible in RNTL or snapshot tests (M§93): loading (skeleton), empty, error, offline (cached data + banner), retry, reconnect, partial data and OS-permission edge.
  - Strings exist in `tr` and `en` (QG-15); dark mode is verified; `accessibilityLabel`/`Role`/`Hint` are set, hit targets are 44 pt / 48 dp and Dynamic Type is supported.
  - Content-free analytics events come from the generated catalogue (R-21).
  - Every visible control has a PASS row in §4.
- [ ] **2. State**
  - A TanStack Query key comes from the `qk` factory; Zustand/MMKV persistence is set only where specified.
  - Optimistic updates roll back on error. Offline writes are either queued idempotently or blocked with a clear state (M§94).
  - Freshness uses polling or invalidation, never Realtime (R-19).
- [ ] **3. API / action**
  - The route or RPC exists in API_CONTRACTS (or DB for PostgREST RPCs/views) with its zod schema, and a CT-* contract test passes.
  - Every client write is allowed by RLS and column GRANTs (R-24).
- [ ] **4. Backend**
  - The Edge Function handler (Hono, wrapped by `_shared/errors`) or SQL function has: auth wrapper, rate limit, `correlation_id`, and server-side Pro gate (M§44).
  - Security-definer functions live in `private` with `search_path=''`.
- [ ] **5. Database**
  - The migration applies from zero on tier C and tier A.
  - RLS is enabled and forced; pgTAP DB-* suites pass (owner CRUD, foreign user denied, anon denied).
  - Idempotency and dedupe uniques exist, and provenance columns are filled.
- [ ] **6. Provider / AI**
  - The adapter call is real (Google, Graph, EventKit/CalendarContract, RevenueCat, Expo Push, Anthropic/OpenAI/Voyage), with a demo/fixture adapter for credential-less runs (M§89) and `external_credential_required` surfaced when a key is missing (M§90).
  - AI output is zod-validated and grounding-verified; `ai_requests` telemetry is written without content; the model comes from `ai_model_config`, never from code.
- [ ] **7. Approval (if the feature writes externally)**
  - An `approval_actions` row is proposed only by the server.
  - The approval shows what, why, source, exact change and destination (M§33).
  - Approval is tap-only (R-03), and `approved_via` is recorded.
  - Undo is a 5 s client-side delay before approve (R-06).
  - Transitions go through `private.transition_approval`.
- [ ] **8. External side effect**
  - The provider write runs server-side, after approval, with a provider-level idempotency marker (Gmail `Message-ID`, Calendar deterministic id, Graph `transactionId`, and so on).
  - A retry after interruption does not duplicate (IT-APR-*).
- [ ] **9. Confirmation**
  - The success UI appears only after `executed`, a 2xx response or job `completed`. No timer-driven success (QG-07).
  - Failure shows honest copy with a retry that reuses the same idempotency key.
- [ ] **10. Refreshed state**
  - Affected queries are invalidated; push or local notification is sent where specified.
  - The backoffice shows the job/audit trail through `correlation_id` (M§118).
  - §2 rows are updated to `tested`; the §9 feature-matrix row is filled.

### 3.2 Mobile features (M§135)

| # | Feature | Screens | API / RPC / jobs | Tables | Provider / AI | Approval | Tests | WBS | External credential | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Authentication | M-ON-05, 05E, 05V, 05N; M-SET-02, M-SET-03 | Supabase Auth (Apple native id_token + nonce, Google `signInWithIdToken`, Microsoft azure PKCE, Email OTP); `POST /auth/apple/exchange`; `POST /devices/register`/`unregister` | profiles, app_installations, push_tokens, oauth_credentials (SIWA) | Apple, Google, Microsoft identity | — | E2E-M-02, E2E-M-01, EF-AUTH-01, TST-E2E-M-01, REL-02 | T-8.05, T-3.11 | SIWA key + Services ID, Google iOS/Android client IDs, Entra app + login secret, SMTP (Resend) | planned |
| 2 | Onboarding | M-ON-01…M-ON-15 | `POST /onboarding/first-analysis`, `GET /onboarding/first-analysis/:jobId` (polled 1–2 s), preference PATCH, `POST /devices/register` | user_preferences, notification_preferences, vip_people, jobs | T0 + T1 first analysis (72 h) | — | E2E-M-01, E2E-A, REL-03 | T-8.06, T-5.15 | none in demo mode (fixture provider) | planned |
| 3 | Integration setup | M-ON-06/06G/06O/06A/06M, M-ON-07/07E/07P/07D, M-SET-10…M-SET-14 | `POST /integrations/:provider/start`, `oauth` callback, `POST /integrations/oauth/complete` (R-07), `/upgrade`, `/disconnect`, `/sync`, `PATCH /integrations/:accountId/data-sources`, `POST /integrations/device-calendar/snapshot` | connected_accounts, oauth_credentials, oauth_states, calendars, sync_states | Google, Microsoft Graph, EventKit, CalendarContract | — (progressive scope consent) | E2E-M-03, E2E-M-04, IT-OAUTH-*, IT-SYNC-*, REL-04, REL-05 | T-4.01…T-4.13, T-8.07 | Google OAuth client + Pub/Sub + CASA; Entra app + certificate | planned |
| 4 | Today | M-TD-01…M-TD-04 | RPC `today_overview`, `set_insight_status`, `apply_insight_feedback`/`revert_insight_feedback`, `dismiss_announcement` (R-25), `GET /me/bootstrap`, `POST /briefings/:id/retry` | insights, briefings, calendar_events, life_events, approval_actions, announcements | T0 priority engine | via M-APPR-04 for "Takvime Ekle" | E2E-M-06, E2E-A, UT-PRI-*, mf_today_* | T-8.08, T-5.05 | — | planned |
| 5 | Morning Briefing | M-BR-01, M-BR-02, M-GL-14 | job `briefing` (morning), `POST /briefings/:id/audio`, `POST /briefings/:id/retry`, RPC `mark_briefing_opened` | briefings, briefing_items, notifications | T2 from ranked item JSON; native TTS (`da-tts`); premium TTS adapter behind `voice.tts_premium` | — | E2E-M-05, IT-AI-*, REL-06 | T-5.08, T-5.09, T-8.09, T-8.27 | Anthropic key (fixture in demo); optional TTS key | planned |
| 6 | Midday | M-BR-03 | job `briefing` (midday); skipped with `skip_reason='no_meaningful_delta'` (R-05) | briefings | T0 (+ T1 polish flag `ai.feature.briefing_polish`) | — | mf_midday_deliver, mf_midday_skip, UT-NTF-08 | T-5.08, T-8.09 | — | planned |
| 7 | Evening Close | M-BR-04, M-BR-04C | job `briefing` (evening), `POST /briefings/:id/evening-ready` | briefings, insights, commitments, notification_preferences (`snooze_until`) | T0 (R-05) | explicit confirmation sheet | mf_evening_carry_over, IT-AI-08, E2E-M-05 | T-5.08, T-8.09 | — | planned |
| 8 | Weekly Review | M-BR-05, M-BR-06 | job `briefing` (weekly, Sunday 18:00 local), `GET /weekly/:id/share-card` | briefings | T2 via Message Batches | — | mf_weekly_share, E2E-M-05 | T-5.08, T-8.09 | Anthropic | planned |
| 9 | Flow | M-FLOW-01, M-SRC-01, M-CORR-01 | RPC `flow_feed` (incl. meta), `set_insight_status`, `get_explanation`, `submit_ai_correction`; `ai_feedback` insert; `learned_preferences` insert (R-24 grants) | insights, life_events, ai_feedback, learned_preferences | T0/T1 | per card through M-APPR-04 | E2E-S-01, UT-FLOW-01 | T-8.10, T-5.05 | — | planned |
| 10 | Mail Intelligence | M-MAIL-01, M-MAIL-02 | RPC `mail_intelligence` | email_threads, email_messages, insights | T0 filters + T1 six-way triage | — | E2E-S-02, UT-CLS-* | T-5.01, T-8.11 | Gmail/Graph (demo adapter otherwise) | planned |
| 11 | Email Detail | M-MAIL-03, M-MAIL-04, M-MAIL-05 | `GET /mail/:messageId/original` (sanitised, not stored), `POST /approvals` (task/calendar) | email_messages (no raw body) | on-demand provider fetch; T2 thread summary | task_create / calendar_create | E2E-S-03, EF-MAIL-01, E2E-M-06 | T-4.03, T-5.02, T-8.11 | Gmail/Graph | planned |
| 12 | AI Reply | M-REPLY-01…M-REPLY-05 | `POST /mail/:messageId/reply-drafts`, `/reply-drafts/:id/regenerate`, `PATCH /reply-drafts/:id`, `/submit`, reply-attachment route (R-24), `POST /approvals/:id/approve` | reply_drafts, approval_actions, approval_events | T2 (all 4 tones); Gmail `messages.send` / Graph `reply` with idempotency marker | `email_send` (mandatory) | E2E-M-07, E2E-B, IT-APR-*, REL-08, REL-09 | T-5.12, T-6.02, T-8.11 | `gmail.send` / `Mail.Send` progressive consent | planned |
| 13 | Follow-Up | M-FUP-01, M-WAIT-01 | `POST /followups/:threadId/draft`, `set_insight_status` | insights, learned_preferences | T0 follow-up state machine + T2 draft | `email_send` | E2E-S-04, E2E-S-05, UT-FUP-01 | T-1.11, T-5.03, T-5.12 | — | planned |
| 14 | Commitments | M-COMMIT-01…M-COMMIT-03 | `set_commitment_status`, `POST /approvals` (`commitment_create`), `/approve`, `/reject`, `submit_ai_correction` | commitments, approval_actions | T1 extraction when the TR regex fires; grounding | `commitment_create` for AI proposals and ambiguous parses | E2E-M-12, UT-COM-* | T-5.03, T-6.04, T-8.12 | — | planned |
| 15 | Plan | M-PLAN-01…M-PLAN-06, M-PLAN-09 | RPC `plan_range`, `plan_week_density`, `GET /plan/free-slots`, `POST /plan/proposals` | calendar_events, tasks, commitments, approval_actions | T0 slot finder; Calendar/Graph write | `calendar_create` / `calendar_update` | E2E-M-10, E2E-E | T-5.14, T-6.03, T-8.13 | calendar write scope (progressive) | planned |
| 16 | Calendar Intelligence | M-PLAN-01, M-PLAN-02, M-PLAN-07, M-PLAN-08 | `POST /plan/conflicts/:insightId/options`, `/resolve` | insights (`conflict`, `schedule_suggestion`, `meeting` + `reason_code`) | T0 | `calendar_update` / `email_send` | E2E-M-10 (plan-conflict-resolve) | T-1.12, T-5.14 | — | planned |
| 17 | Meeting Prep | M-MEET-01, M-MEET-03 | `POST /meetings/:eventId/prep`, job `meeting_prep` (T-60 only for external/VIP, R-23), `POST /meetings/:eventId/prep/audio` (R-24) | meeting_preps, contacts | T2; native TTS | — | E2E-M-11, E2E-F | T-5.10, T-8.14 | Anthropic | planned |
| 18 | Post Meeting | M-MEET-02, M-MEET-04, M-MEET-05 | `POST /meetings/:eventId/notes`, `POST /meetings/:eventId/post` | meeting_notes, commitments, approval_actions | T1 parse; on-device STT | `commitment_create` ("Kaydet" = approval, C-06) | E2E-F, post-meeting-text | T-5.10, T-8.14 | — | planned |
| 19 | Life Intelligence | M-LIFE-01 | pipeline `life_events`; `set_insight_status` | life_events, android_notification_signals | T0 schema.org + TR templates, T1 fallback | reminder / calendar via approval | E2E-S-06, UT-AMT-* | T-5.04, T-8.12 | — | planned |
| 20 | Assistant | M-ASST-01…M-ASST-03 | `POST /assistant/threads`, `POST /assistant/threads/:id/messages` (SSE); write intents → server-built proposals (R-04) | assistant_threads, assistant_messages, approval_actions | T2 grounded QA with citations; read-only retrieval tools only | every write through the approval card | E2E-M-13, IT-AI-* | T-5.11, T-8.15 | Anthropic, Voyage | planned |
| 21 | Voice | M-VOICE-01 | on-device STT; `POST /assistant/transcribe` fallback (`voice.stt_server`) | assistant_messages | `expo-speech-recognition` tr-TR; server STT adapter | tap-only (R-03) | E2E-S-14, REL-16 | T-5.11, T-8.15 | OpenAI key for server STT (optional) | planned |
| 22 | Memory | M-MEM-01 | `GET /search?mode=answer` | memory_chunks (`vector(1024)`) | Voyage `voyage-4`/`voyage-4-lite` + FTS (RRF) | — | E2E-H, DB-25, IT-AI-09 | T-5.07, T-8.15 | Voyage (FTS-only degrade without it) | planned |
| 23 | Search | M-SRCH-01 | `GET /search?q=&types=&contact_id=`; RPC `search_user_content` | memory_chunks + FTS | hybrid retrieval | — | E2E-M-14, E2E-H | T-5.07, T-8.15 | Voyage | planned |
| 24 | Universal Capture | M-CAP-01…M-CAP-07 | `POST /captures/upload-url`, `POST /captures`, `/captures/:id/analyze`, `/captures/:id/actions`, `/captures/:id/discard`; job `capture_analysis` | captures, approval_actions | T1 text/link, T2 photo/PDF; SSRF-safe fetcher | batch approval (`capture_batch`) | E2E-M-15, E2E-G, E2E-S-08, E2E-S-09, REL-14 | T-5.13, T-8.17 | Anthropic | planned |
| 25 | Smart Reminders | M-REM-01…M-REM-03, M-TD-04 | `POST /reminders/resolve-time`, `POST /reminders`, `/reminders/:id/cancel`; `reminder_create` for external destinations | reminders, approval_actions | T0 slot finder; local notifications | confirm step; `reminder_create` for Tasks/To Do/Apple Reminders | E2E-M-09, E2E-D, E2E-S-07, UT-REM-* | T-6.06, T-8.18 | tasks write scopes (progressive) | planned |
| 26 | VIP | M-VIP-01…M-VIP-03, M-ON-11, M-ON-11A | PostgREST `vip_people` CRUD (`relationship`), RPC `vip_suggestions()`, `upsert_manual_contact` (R-24) | vip_people, contacts, priority_rules | T0 | — | E2E-S-13, UT-PRI-04 | T-5.06, T-8.16 | — | planned |
| 27 | Person Intelligence | M-PERS-01 | RPC `person_intelligence` (`locked_sections`) | contacts, email_threads, commitments, calendar_events | derived | — | E2E-S-13 | T-5.06, T-8.16 | — | planned |
| 28 | Priority Rules | M-SET-50…M-SET-54 | PostgREST `priority_rules` CRUD, RPC `preview_priority_rule`; trigger enqueues `insight_refresh` | priority_rules | T0 `explicit_rule` tier | — | E2E-S-11, UT-PRI-* | T-1.07, T-8.21 | — | planned |
| 29 | AI Personalization | M-SET-45, M-SET-46 | PostgREST `learned_preferences` insert/update (incl. `params`) and soft delete (R-24 grants) | learned_preferences, user_preferences | `learned_preference` tier | — | E2E-S-12, UT-PRI-15 | T-8.21 | — | planned |
| 30 | Approval Center | M-APPR-01…M-APPR-05 | `POST /approvals`, `PATCH /approvals/:id`, `/approve`, `/reject`, `/device-execution`; RPC `list_approvals` | approval_actions, approval_events | provider writes with idempotency | all six action types | E2E-M-08, E2E-J, IT-APR-*, REL-08, REL-09 | T-6.01…T-6.05, T-8.18 | write scopes per provider | planned |
| 31 | Notifications | M-SET-20, M-SET-21, M-SET-23…M-SET-25, M-ON-14, M-ON-14S, M-GL-08 | `POST /devices/register`, `POST /notifications/test`, worker `notification`, `push_receipts` | notifications, push_tickets, notification_preferences | Expo Push (enhanced security), decision engine | — | E2E-S-10, TST-E2E-M-04, IT-NTF-*, UT-NTF-*, REL-10 | T-1.08, T-6.07, T-6.08, T-8.24 | `EXPO_ACCESS_TOKEN`, APNs key, FCM v1 | planned |
| 32 | Widgets | M-WGT-01…M-WGT-08 | `GET /widgets/snapshot` (R-24) | — (WidgetSnapshotV1 in the App Group / Glance DataStore) | WidgetKit, Jetpack Glance | — | UT-WID-01, CT-09, REL-13 | T-8.25 | App Group capability | planned |
| 33 | Dark Mode | M-SET-60, M-SET-61, all screens | user preference PATCH | user_preferences | — | — | E2E-M-18, E2E-I, VIS-01…04 | T-8.29 | — | planned |
| 34 | Privacy Center | M-SET-30…M-SET-40 | `POST /privacy/export`, `/privacy/delete-history`, `/privacy/delete-account`, RPC `history_deletion_preview` | data_export_requests, data_deletion_requests | provider revoke (Google, SIWA), RevenueCat customer delete | re-auth + explicit confirmation (R-16) | E2E-M-19, TST-E2E-M-02, TST-E2E-M-03, IT-PRIV-*, REL-12 | T-8.20, T-11.01…T-11.04 | SIWA key, RevenueCat v2 secret | planned |
| 35 | Subscription / Paywall | M-PAY-01, M-SUB-01, M-GATE-01, M-GATE-02, M-GL-13 | RevenueCat SDK, `POST /purchases/sync`, `GET /me/entitlements`, `webhooks-revenuecat` | subscriptions, billing_events, entitlement_grants, plan_limits | RevenueCat | — | E2E-M-16, IT-RC-*, UT-ENT-*, REL-11 | T-7.01, T-7.02, T-8.22 | RevenueCat keys, store products | planned |
| 36 | Referral | M-REF-01, M-REF-02, W-REF-01 | `POST /referrals/apply`, `GET /referrals/me`, job `referral_evaluate` | referral_codes, referrals, referral_credits, entitlement_grants | — | — | E2E-M-17, UT-REF-*, WEB-E2E-07 | T-7.03, T-8.22 | — | planned |
| 37 | Settings | M-SET-01…M-SET-03, M-SET-62, M-SET-70…M-SET-74 | PostgREST preference PATCH (`profiles.locale`, `dismissed_gates`), `POST /support/tickets`, `POST /feedback` | profiles, user_preferences, support_tickets, user_feedback | — | — | E2E-M-02, E2E-S-15, E2E-S-16 | T-8.19 | — | planned |

### 3.3 Backoffice features (M§136)

| # | Feature | Route(s) | admin-api / `admin_api` | Permission(s) (BACKOFFICE_PLAN §4.1) | Audit | Tests | WBS | External credential | Status |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Admin auth | `/login`, `/mfa`, `/invite` | Supabase Auth email one-time code + mandatory TOTP (`aal2`) (R-08); `admin_sessions` (idle 30 min, absolute 12 h); custom access token hook | own-account | login, lockout, session events | BO-E2E-01…07, EF-ADM-01, pgTAP aal2 | T-10.01…T-10.03 | transactional email provider, Supabase MFA | planned |
| 2 | RBAC | all | `private.require_admin(permission)` in `admin_api` + admin-api check; `private.admin_role_permissions` | §4.1 catalogue | denied attempts | BO-E2E-08, UT-RBAC-*, pgTAP | T-1.14, T-2.17, T-10.01 | — | planned |
| 3 | Dashboard | `/dashboard` | dashboard KPIs and charts | `dashboard.read`, `metrics.*.read` | — | BO-E2E-09 | T-10.05 | — | planned |
| 4 | Users | `/users` | masked user list, keyset pagination | `users.read` | reveal events | BO-E2E-10 | T-10.06 | — | planned |
| 5 | User detail | `/users/[id]/{overview,integrations,briefings,usage,subscription,referrals,support,audit}` | force sync, disable/restore, mark internal | `users.read`, `users.force_sync`, `users.disable`, `users.mark_internal` | `user.*` | BO-E2E-11, BO-E2E-12 | T-10.06 | — | planned |
| 6 | Integrations | `/integrations` | renew watch, disconnect (shared disconnect service) | `integrations.read`, `integrations.renew_watch`, `integrations.disconnect` | `integration.*` | BO-E2E-13 | T-10.08 | Google/Entra for live providers | planned |
| 7 | Sync & Jobs | `/jobs`, `/jobs/[id]` | `job_retry`, `jobs_retry_bulk`, `job_cancel`, correlation trace | `jobs.read`, `jobs.retry`, `jobs.cancel` | `job.*` | BO-E2E-14, BO-E2E-15 | T-10.08 | — | planned |
| 8 | Briefings | `/briefings` | `briefing_regenerate` (failed/skipped today only) | `briefings.read`, `briefings.regenerate` | `briefing.regenerated` | BO-E2E-16 | T-10.09 | Anthropic | planned |
| 9 | Notifications | `/notifications` | `POST /notifications/test-push` (generic content, never bypasses quiet hours, R-13) | `notifications.read`, `push.test` | `push.test_sent` | BO-E2E-17 | T-10.09 | `EXPO_ACCESS_TOKEN` | planned |
| 10 | AI Operations | `/ai` | request telemetry and aggregates | `ai.read`, `metrics.ai.read` | — | BO-E2E-18 | T-10.10 | — | planned |
| 11 | AI Costs | `/ai`, `/ai/models` | cost rollups + nightly reconciliation; model config with Voyage 1024-d embedding slot and per-plan routing profile `balanced`/`lean` (R-01, R-18) | `metrics.ai.read`, `ai.models.write` | `ai_model_config.updated` | BO-E2E-18, EF-AI-02 | T-5.17, T-10.10 | Anthropic admin key (cost report) | planned |
| 12 | Prompt Management | `/ai/prompts`, `/ai/prompts/[key]`, `/ai/feedback` | draft, test, activate, rollback, archive; AI feedback reveal | `prompts.read`/`prompts.write`/`prompts.activate`, `ai_feedback.read`/`ai_feedback.reveal` | `prompt.*` | BO-E2E-19, BO-E2E-20, DB-28 | T-10.10 | — | planned |
| 13 | Subscriptions | `/subscriptions` | mirror, events, trials, resync | `subscriptions.read`, `billing_events.read`, `subscriptions.resync`, `metrics.revenue.read` | `subscription.resync` | BO-E2E-21 | T-10.11 | RevenueCat v2 secret | planned |
| 14 | Entitlements | dialog on `/users/[id]/subscription` | grant 1/7/14/30 days (stacked), revoke; reason mandatory | `entitlements.grant`, `entitlements.grant_limited`, `entitlements.revoke` | `entitlement.*` | BO-E2E-22 | T-10.11 | — | planned |
| 15 | Referrals | `/referrals` | review flagged (approve/reject with reason) | `referrals.read`, `referrals.review` | `referral.reviewed` | BO-E2E-23 | T-10.11 | — | planned |
| 16 | Support | `/support`, `/support/[id]`, Support Access (§9) | ticket update, notes, outbound reply; Support Access grant with scopes per R-09, 15/30/60 min | `support.read`, `support.write`, `support.access` | `support.*`, every reveal | BO-E2E-24 | T-10.07 | transactional email provider | planned |
| 17 | Feedback | `/feedback` | triage, reveal | `feedback.read`, `feedback.write` | `feedback.*` | BO-E2E-25 | T-10.12 | — | planned |
| 18 | Feature Flags | `/flags` | create, targeting, kill switch, overrides (R-10 keys) | `flags.read`, `flags.write`, `flags.write_ai` | `flag.*` | BO-E2E-26 | T-10.12 | — | planned |
| 19 | Announcements | `/announcements` | create, schedule, cancel; rendered on Today (R-25) | `announcements.read`, `announcements.write` | `announcement.*` | BO-E2E-27, DB-29 | T-10.12 | — | planned |
| 20 | Data Requests | `/data-requests` | retry from first incomplete step; regenerate export | `data_requests.read`, `data_requests.manage` | `data_request.*` | BO-E2E-28 | T-10.13 | — | planned |
| 21 | Audit Logs | `/audit` | read-only; hash chain; no delete path | `audit.read` | immutable | BO-E2E-29, pgTAP | T-10.13 | — | planned |
| 22 | System Health | `/health` | probes, "Şimdi çalıştır", app versions (M§110), cron | `health.read`, `health.run` | `health.run` | BO-E2E-30, EF-HLT-01 | T-10.14 | all provider credentials (`not_configured` otherwise) | planned |
| 23 | Admin Users | `/admins` | invite, role, disable/enable, MFA reset, revoke sessions, unlock; last super_admin guard | `admins.read`, `admins.manage` | `admin.*` | BO-E2E-31 | T-10.14 | transactional email provider | planned |
| 24 | Global Search | topbar "Ara… ⌘K" | masked entity lookups filtered per role | `search.global` | — | BO-E2E-33 | T-10.04 | — | planned |
| 25 | Command Palette | ⌘K / Ctrl+K overlay | action commands navigate to the ConfirmDialog; never mutate directly | per target | per target | BO-E2E-33 | T-10.04 | — | planned |
| 26 | Dark Mode | `/settings?tab=preferences` | theme persisted in `admin_preferences` | own-account | — | BO-E2E-32 | T-10.04 | — | planned |
| 27 | Privacy controls | all tables and detail views | masking, audited reveal with reason, Support Access, no impersonation | `users.pii.reveal`, `support.access` | reveal events | BO-E2E-11, BO-E2E-20, DB-14 | T-10.04, T-10.06 | — | planned |
| 28 | Server pagination | all large tables | server pagination, sorting, filtering, column visibility, states | — | — | BO-E2E-10, BO-E2E-35 | T-10.04 | — | planned |

### 3.4 Public web features (M§137)

| # | Feature | Pages | Data / endpoints | Tests | WBS | External credential | Status |
|---|---|---|---|---|---|---|---|
| 1 | Responsive landing | W-HOME-01 | `@da/i18n` web catalog, public-api `GET /plans` (cached 1 h) | WEB-E2E-01, WEB-E2E-10, WEB-E2E-18 | T-9.02 | — | planned |
| 2 | Pricing | W-PRICE-01 | public-api `GET /plans`; store-authoritative prices; no web checkout | WEB-E2E-03 | T-9.03 | — | planned |
| 3 | Privacy | W-LEGAL-01 | legal content incl. the Google Limited Use statement, AI sub-processors and retention table | WEB-E2E-04 | T-9.03 | — | planned |
| 4 | Terms | W-LEGAL-02 | legal content; store subscription management links | WEB-E2E-04 | T-9.03 | — | planned |
| 5 | Data deletion | W-DEL-01 | Supabase email OTP (in-memory session) → public-api data-deletion endpoints (R-24) → `data_deletion_requests` → job | WEB-E2E-06, REL-12 | T-9.04, T-11.03 | SMTP (Resend) | planned |
| 6 | Support | W-SUP-01 | FAQ shared with M-SET-70; form → public-api `POST /support` → `support_tickets` | WEB-E2E-05 | T-9.04 | — | planned |
| 7 | App CTA | W-HOME-01, W-GET-01, W-REF-01, W-APP-01, W-OAUTH-01, W-SYS-01/02 | `/get` redirector, store badges, QR, universal/app links, AASA, assetlinks | WEB-E2E-02, WEB-E2E-07, WEB-E2E-08, WEB-E2E-09 | T-9.05 | `APPLE_TEAM_ID`, Play signing SHA-256, `IOS_APP_STORE_ID` | planned |
| 8 | Integrations | W-HOME-01 (integrations section) | truthful integration list (no unsupported providers) | WEB-E2E-01 | T-9.02 | — | planned |
| 9 | Security messaging | W-HOME-01 (security section), W-LEGAL-01 | truthful-claims register (SEC §4.1); QG-06 | WEB-E2E-01, WEB-E2E-04 | T-9.02 | — | planned |
| 10 | SEO basics | all pages, W-SYS-03/04/05 | metadata, canonical, OG images, sitemap, robots, JSON-LD, `/en` | WEB-E2E-12, WEB-E2E-17 (Lighthouse) | T-9.06 | — | planned |

---

## 4. No-Dead-Action inventory (M§99; SREQ-99)

### 4.1 How to fill it

**Coverage.**
- One or more rows per visible control of every screen ID in SCREEN_AND_FLOW_MAP Parts 1–5 (including the Part 4 continuation M-SET-70…74, M-WGT-01…08 and M-STATE-01…12), plus the backoffice routes.
- The rows are pre-filled from each block's Primary CTA and Secondary actions fields, with canonical names applied.

**Row format.** Each row answers "ACTION = ? TARGET = ? SUCCESS STATE = ?" (SREQ-99 / QA§20):
- **Action:** `tap`, `swipe→`, `swipe←`, `long-press`, `pull`, `toggle`, `drag`, `input`, `key`, `link`, `submit` or `auto`.
- **Target:** a route, RPC or API, a navigation, or an explicit local/OS action (R-24).
- **Success state:** what must be observable afterwards.

**Walk (TEST_PLAN §20).**
- Build the `preview` profile against staging with `DEMO_MODE=true`, plus one run with real sandbox accounts.
- Walk every row in this matrix:
  - light and dark;
  - `tr` and `en`;
  - Free and Pro;
  - default and maximum Dynamic Type;
  - online and airplane mode (write controls);
  - Android at 360 dp and iPhone at 393 pt.
- Record PASS/FAIL as `☑ PASS` or `☒ FAIL #issue`.

**Other rules.**
- For each screen, also force loading, empty, error, offline, retry, reconnect and partial states, using the `u_empty` and `u_error` scenarios and airplane mode.
- QG-16 fails when a route file under `apps/mobile/app/**` has no row here, or when a row's target does not resolve.
- A control that cannot perform a real action is not rendered as clickable (M§99). Such rows read "not clickable".

### 4.2 Part 1: global shell, auth, onboarding, Today, briefings

| Screen | Element | Action | Target (route / RPC / navigation) | Success state | Test ID | PASS/FAIL |
|---|---|---|---|---|---|---|
| M-GL-01 | No interactive control (providers container) | — | — | providers mount; cold start restores cache | mf_cold_start | ☐ |
| M-GL-02 | No interactive control (entry resolver, auth gate) | auto | `Stack.Protected` → onboarding / sign-in / today | correct first screen, no timer navigation | mf_onboarding_resume | ☐ |
| M-GL-03 | **Tab press** | tap | the tab's stack (Bugün · Akış · Plan · Asistan) | tab root shown | mf_tabs | ☐ |
| M-GL-03 | Active tab re-tap | tap | pop to root + `useScrollToTop` | list at top | mf_tabs | ☐ |
| M-GL-03 | Android hardware back on a non-Today root | key | switch to Today; on Today root the app exits | Today tab selected | mf_tabs | ☐ |
| M-GL-04 | **ApprovalChip** | tap | `approvals/index` (hidden when count = 0) | Approval Center opens | E2E-M-08 | ☐ |
| M-GL-04 | Avatar | tap | `settings/index` | Settings hub opens | E2E-M-02 | ☐ |
| M-GL-04 | Search | tap | `search` | Search opens | E2E-M-14 | ☐ |
| M-GL-04 | Back / Close | tap | `router.back()` / dismiss modal | previous screen | E2E-M-01 | ☐ |
| M-GL-05 | **Toast action** ("Geri al", "Görüntüle", "Aç") | tap | the action's revert RPC or route | state reverted / target opens | mf_today_complete_undo | ☐ |
| M-GL-05 | Toast | swipe down | dismiss | toast gone | ToastHost.test | ☐ |
| M-GL-06 | Scrim / drag down / Android back | drag | close the top sheet (`BackHandler`) | sheet closed | SheetHost.test | ☐ |
| M-GL-07 | No visible control (deep-link router) | auto | `app/+native-intent.tsx` maps `/app/*`, `/r/{code}`, `integrations/callback` | correct route, no +not-found flash | mf_deeplink_router | ☐ |
| M-GL-08 | **Notification tap** | tap | route from `{type, entity_id, deeplink}` | target screen | mf_notification_route | ☐ |
| M-GL-08 | Foreground toast "Aç" | tap | same route | target screen | mf_notification_route | ☐ |
| M-GL-09 | **"Yenile"** (offline banner) | tap | refetch active queries | banner clears when online; "Güncel · HH:MM" | mf_today_offline | ☐ |
| M-GL-10 | **"Tekrar Dene"** | tap | `retry()` of the error boundary | screen re-renders | ErrorBoundary.test | ☐ |
| M-GL-10 | "Bugün'e Dön" | tap | `router.replace('/(tabs)/today')` (or `/` before onboarding) | Today | ErrorBoundary.test | ☐ |
| M-GL-11 | **"Bugün'e Dön"** | tap | Today tab | Today | mf_deeplink_router | ☐ |
| M-GL-11 | Back (if history) | tap | `router.back()` | previous screen | mf_deeplink_router | ☐ |
| M-GL-12 | **"Güncelle"** | tap | App Store / Play URL from bootstrap `store_urls` (`Linking.openURL`) | store listing opens; screen stays blocking | UpdateRequired.test | ☐ |
| M-GL-13 | **"{n} gün ücretsiz dene"** (only if eligible) / "Pro'yu Gör" | tap | `paywall?source={surface}`; after purchase `POST /purchases/sync` | gated action re-runs automatically | mf_pro_gate_midday | ☐ |
| M-GL-13 | "Şimdi değil" | tap | PATCH `dismissed_gates` (7-day suppression) | card collapses | mf_pro_gate_midday | ☐ |
| M-GL-14 | **Play/pause** | tap | player / TTS queue | playback toggles; lock-screen controls | mf_briefing_read_listen | ☐ |
| M-GL-14 | Player body | tap | `briefing/{id}/listen` | full player | mf_briefing_read_listen | ☐ |
| M-GL-14 | Close | tap | stop + `clearLockScreenControls()` | mini-player hidden | MiniPlayer.test | ☐ |
| M-ON-05 | **Platform-first provider button** (Apple on iOS, Google on Android) | tap | native SIWA / Google `signInWithIdToken` → post-sign-in resolver | session + next onboarding step | mf_auth_email_otp | ☐ |
| M-ON-05 | Other provider buttons (Google/Apple web OAuth/Microsoft PKCE) | tap | Supabase Auth per ADR-06 | session | E2E-M-02 | ☐ |
| M-ON-05 | "E-posta ile devam et" | tap | M-ON-05E | email step | mf_auth_email_otp | ☐ |
| M-ON-05 | "Kullanım Koşulları" / "Gizlilik Politikası" | tap | `WebBrowser.openBrowserAsync('<web>/terms' / '/privacy')` | in-app browser | SignInScreen.test | ☐ |
| M-ON-05 | Mode toggle | tap | `router.setParams({mode})` | signup/signin copy | SignInScreen.test | ☐ |
| M-ON-05 | Back | tap | M-ON-04 (signup) / M-ON-01 (signin) | previous page | SignInScreen.test | ☐ |
| M-ON-05E | **"Kod Gönder"** | tap | `signInWithOtp` | M-ON-05V | mf_auth_email_otp | ☐ |
| M-ON-05E | Back | tap | M-ON-05 | sign-in | mf_auth_email_otp | ☐ |
| M-ON-05V | **"Doğrula"** (auto-submit at 6 digits) | input | `verifyOtp` | session; resolver continues | mf_auth_email_otp | ☐ |
| M-ON-05V | Resend (60 s cooldown) | tap | `signInWithOtp` again | cooldown restarts | OtpCells.test | ☐ |
| M-ON-05V | "E-postayı değiştir" | tap | M-ON-05E | email step | mf_auth_email_otp | ☐ |
| M-ON-05N | **"Devam Et"** | tap | `(onboarding)/connect-mail` | connect mail | post-sign-in.test | ☐ |
| M-ON-05N | "Farklı yöntemle dene" | tap | local sign-out → M-ON-05 (signin) | sign-in screen | post-sign-in.test | ☐ |
| M-ON-01 | **"Başlayalım"** | tap | M-ON-02 | next intro page | mf_onboarding_first_run | ☐ |
| M-ON-01 | "Giriş yap" | tap | `(auth)/sign-in?mode=signin` | sign-in | mf_onboarding_first_run | ☐ |
| M-ON-01 | Pager | swipe← | next page (dots are not focusable) | page 2 | IntroPager.test | ☐ |
| M-ON-02 | **"Devam"** | tap | M-ON-03 | page 3 | mf_onboarding_first_run | ☐ |
| M-ON-02 | "Atla" | tap | `(auth)/sign-in?mode=signup` | sign-up | IntroPager.test | ☐ |
| M-ON-03 | **"Devam"** | tap | M-ON-04 | page 4 | E2E-M-01 | ☐ |
| M-ON-03 | "Atla"; decorative "Brifingi Dinle" not clickable | tap | sign-in (signup) | sign-up | E2E-M-01 | ☐ |
| M-ON-04 | **"Hesap Oluştur"** | tap | `(auth)/sign-in?mode=signup` | sign-up | E2E-M-01 | ☐ |
| M-ON-04 | Back swipe; illustration approval buttons not focusable | swipe→ | M-ON-03 | previous page | E2E-M-01 | ☐ |
| M-ON-06 | **"Devam · {n} hesap bağlı"** (disabled at 0) | tap | `connect-calendar` | calendar step | mf_onboarding_first_run | ☐ |
| M-ON-06 | "Bağla" (Gmail / Outlook) | tap | M-ON-06G / M-ON-06O | explainer | mf_onboarding_first_run | ☐ |
| M-ON-06 | OAuth return | auto | `POST /integrations/oauth/complete {completion_code, device_nonce}` (R-07) | row "Bağlandı" (`healthy`/`partial`) | IT-OAUTH-*, E2E-M-03 | ☐ |
| M-ON-06 | "Bağlandı" | tap | M-ON-06A | account sheet | IntegrationAccountSheet.test | ☐ |
| M-ON-06 | "Eksik izin" / "Tekrar Dene" | tap | explainer → `POST /integrations/:accountId/upgrade` or start again | scope granted | ConnectMailScreen.test | ☐ |
| M-ON-06 | "Yönetici onayı" | tap | M-ON-06M | admin-consent sheet | AdminConsentSheet.test | ☐ |
| M-ON-06 | "Şimdilik geç" | tap | `connect-calendar` (C-17) | calendar step | ConnectMailScreen.test | ☐ |
| M-ON-06 | Back circle | tap | M-ON-06S | sign-out confirm | sign-out.test | ☐ |
| M-ON-06G | **"Google ile Bağlan"** | tap | `POST /integrations/google/start` → auth session | sheet closes on return | IntegrationExplainer.test | ☐ |
| M-ON-06G | "Şimdi değil" / scrim / drag | tap | close | sheet closed | IntegrationExplainer.test | ☐ |
| M-ON-06O | **"Microsoft ile Bağlan"** | tap | `POST /integrations/microsoft/start` → auth session | sheet closes on return | IntegrationExplainer.test | ☐ |
| M-ON-06O | "Şimdi değil" | tap | close | sheet closed | IntegrationExplainer.test | ☐ |
| M-ON-06A | **"Bağlantıyı kaldır"** → "Kaldır" | tap | `POST /integrations/:accountId/disconnect` | row returns to "Bağla" | IntegrationAccountSheet.test | ☐ |
| M-ON-06A | "Takvimleri seç"; close | tap | M-ON-07P / dismiss | picker / closed | IntegrationAccountSheet.test | ☐ |
| M-ON-06M | **"Yöneticiye Gönder"** | tap | `Share.share({message: consentUrl})` | system share sheet | AdminConsentSheet.test | ☐ |
| M-ON-06M | "Kapat" | tap | dismiss | sheet closed | AdminConsentSheet.test | ☐ |
| M-ON-06S | **"Çıkış Yap"** | tap | local sign-out → `(auth)/sign-in?mode=signin` | sign-in | sign-out.test | ☐ |
| M-ON-06S | "Vazgeç" | tap | dismiss | stays on connect-mail | sign-out.test | ☐ |
| M-ON-07 | **"Devam · {n} hesap bağlı"** (enabled at n ≥ 1) | tap | `permissions` | permissions review | mf_onboarding_first_run | ☐ |
| M-ON-07 | Row "Bağla" | tap | M-ON-07E with the chip preselected | explainer | E2E-M-04 | ☐ |
| M-ON-07 | "Bağlandı" | tap | M-ON-06A | account sheet | E2E-M-04 | ☐ |
| M-ON-07 | Meta "{n} takvim" | tap | M-ON-07P | calendar picker | CalendarPicker.test | ☐ |
| M-ON-07 | "Şimdilik geç" | tap | `permissions` (`skippedAllSources` when no source) | permissions review | ConnectCalendarScreen.test | ☐ |
| M-ON-07 | Back | tap | `connect-mail` | connect mail | E2E-M-04 | ☐ |
| M-ON-07E | **Per-chip CTA** | tap | cloud: `/integrations/:provider/start`; device: OS calendar prompt → `POST /integrations/device-calendar/snapshot` | row "Bağlandı" | device-snapshot.test | ☐ |
| M-ON-07E | Chip; "Şimdi değil" | tap | select provider / close | chip selected / closed | IntegrationExplainer.test | ☐ |
| M-ON-07P | **"Kaydet"** | tap | `PATCH /integrations/:accountId/data-sources` (calendars) | sheet closes; count updated | CalendarPicker.test | ☐ |
| M-ON-07P | Row switch; close | toggle | local selection / discard | switch state | CalendarPicker.test | ☐ |
| M-ON-07D | **"Ayarları Aç"** | tap | `Linking.openSettings()` | OS settings | mf_onboarding_calendar_denied | ☐ |
| M-ON-07D | "Şimdilik Atla" | tap | close; row "İzin verilmedi" + "İzin Ver" | row updated | mf_onboarding_calendar_denied | ☐ |
| M-ON-08 | **"Devam"** | tap | `personalization` | personalization | PermissionsReview.test | ☐ |
| M-ON-08 | Source switches (`analyze_mail` off asks for confirmation) | toggle | `PATCH /integrations/:accountId/data-sources` | switch persisted | PermissionsReview.test | ☐ |
| M-ON-08 | "Ayarları Aç" / "İzin Ver"; Back | tap | OS settings / OS prompt / back | permission state refreshed | PermissionsReview.test | ☐ |
| M-ON-09 | **"Devam · {n} seçili"** | tap | preference PATCH → `briefing-schedule` | next step | PersonalizationScreen.test | ☐ |
| M-ON-09 | Tile toggles; back | toggle | local selection (light haptic) | tile selected | PersonalizationScreen.test | ☐ |
| M-ON-10 | **"Devam"** | tap | preference PATCH → `vip` or `analysis` | next step | BriefingSchedule.test | ☐ |
| M-ON-10 | TimeChip / weekend meta time | tap | M-ON-10T | time picker | BriefingSchedule.test | ☐ |
| M-ON-10 | Weekend switch | toggle | local → PATCH on Devam | switch state | BriefingSchedule.test | ☐ |
| M-ON-10 | Locked row (midday/evening) | tap | M-GL-13 | Pro gate | mf_pro_gate_midday | ☐ |
| M-ON-10T | **"Kaydet"** / Android OK | tap | returns `HH:mm` | chip updated | schedule-validation.test | ☐ |
| M-ON-10T | Cancel / close | tap | dismiss | unchanged | schedule-validation.test | ☐ |
| M-ON-11 | **"Devam ({n})"** | tap | insert `vip_people {contact_id, relationship}` → `analysis` | VIPs persisted | VipStep.test | ☐ |
| M-ON-11 | Row toggle; "Kişi Ekle"; "Atla"; back | tap | select / M-ON-11A / `analysis` / back | expected route | VipStep.test | ☐ |
| M-ON-11A | **"Ekle"** | tap | `upsert_manual_contact` (R-24) → row selected in M-ON-11 | contact appears selected | VipAddSheet.test | ☐ |
| M-ON-11A | Close | tap | dismiss | unchanged | VipAddSheet.test | ☐ |
| M-ON-12 | No control while running (auto-advance at completion) | auto | poll `GET /onboarding/first-analysis/:jobId` | counters from real progress → `ready` | mf_onboarding_first_run | ☐ |
| M-ON-12 | "Bugün'e geç" (slow state > threshold) | tap | `notifications` → completion; job continues | Today shows `first_analysis_running` | mf_onboarding_first_run | ☐ |
| M-ON-13 | **"Brifingimi Gör"** | tap | `notifications`, then the briefing | permission step | mf_onboarding_zero_findings | ☐ |
| M-ON-13 | Finding rows | — | not clickable | — | AhaScreen.test | ☐ |
| M-ON-14 | **"Bildirimleri Aç"** | tap | Android channels created first (R-12) → OS prompt → `POST /devices/register` | token registered → next step | mf_notification_permission_android13 | ☐ |
| M-ON-14 | "Daha sonra" | tap | `POST /devices/register {notification_permission:'deferred'}` | next step; one re-ask at the first briefing | NotificationStep.test | ☐ |
| M-ON-14S | **"Bildirimleri Aç"** | tap | OS prompt → register token | permission granted | mf_auth_returning_signin | ☐ |
| M-ON-14S | "Daha sonra" | tap | installation-level deferral | next screen | mf_auth_returning_signin | ☐ |
| M-ON-14A | **"Bildirim Erişimini Aç"** | tap | `POST /devices/register {ni_listener_granted, ni_mode, ni_allowed_packages}` → `openSettings()` → `isGranted()` on return | toast "Telefon bildirimleri açık" → M-ON-15, or inline "Tekrar Dene" | mf_android_ni_optin | ☐ |
| M-ON-14A | "Atla" | tap | M-ON-15 | completion | AndroidNiStep.test | ☐ |
| M-ON-14A | Category switches; mode segment (all/selected) | toggle | local → reported through `/devices/register` | state persisted | AndroidNiStep.test | ☐ |
| M-ON-14A | Locked row | tap | read-only exclusions sheet | sheet opens | AndroidNiStep.test | ☐ |
| M-ON-14A | "Sorun mu yaşıyorsun?" | tap | expands restricted-settings help | text visible | AndroidNiStep.test | ☐ |
| M-ON-15 | No control (completion handoff) | auto | complete onboarding → Today | Today | mf_onboarding_first_run | ☐ |
| M-TD-01 | **Hero primary per mode** (e.g. "Brifingimi Gör") | tap | `briefing/{id}` | briefing opens | E2E-M-06 | ☐ |
| M-TD-01 | Hero "Dinle · {m} dk" | tap | `briefing/{id}/listen?autoplay=1` (Pro gate) | audio plays | mf_briefing_read_listen | ☐ |
| M-TD-01 | Hero failed "Tekrar Dene" | tap | `POST /briefings/:id/retry` | hero `generating` → `ready` | E2E-S-18 | ☐ |
| M-TD-01 | Announcement banner CTA (R-25) | tap | allow-listed `dijitalasistan://` deep link | target screen | DB-29, BO-E2E-27 | ☐ |
| M-TD-01 | Announcement banner "×" | tap | RPC `dismiss_announcement` | banner removed on all devices | DB-29 | ☐ |
| M-TD-01 | Card body | tap | source route (Annex B) | source opens | E2E-M-06 | ☐ |
| M-TD-01 | `check_circle` | tap | `set_insight_status(done)` | toast "Tamamlandı · Bir sonraki konu yukarı taşındı" + "Geri al" → `set_insight_status(open)` | mf_today_complete_undo | ☐ |
| M-TD-01 | `more_horiz` | tap | M-TD-02 | correction sheet | mf_today_correction | ☐ |
| M-TD-01 | Card | swipe→ | complete (as `check_circle`) | card removed + undo toast | mf_today_complete_undo | ☐ |
| M-TD-01 | Card: "Ertele" | swipe← | M-TD-04 | snooze sheet | mf_today_swipe_snooze | ☐ |
| M-TD-01 | Card: "Önemli değil" | swipe← | `apply_insight_feedback(not_important)` + dismiss | toast "Öğrendim · Bu tür konuları daha aşağıda göstereceğim." + "Geri al" (`revert_insight_feedback`) | mf_today_correction | ☐ |
| M-TD-01 | Card actions (Annex M-TD-01-B: "Takvime Ekle", "Takip Mesajı Hazırla", "Planla", …) | tap | `POST /approvals` / `POST /followups/:threadId/draft` / `POST /plan/proposals` | M-APPR-04 / reply modal / proposal sheet | insight-actions.test | ☐ |
| M-TD-01 | PROGRAMIN row | tap | `meeting/{eventId}/prep` (Pro, attendees) or `event/{id}` | prep / event | E2E-M-11 | ☐ |
| M-TD-01 | TAKVİM ZEKÂSI "Seçenekleri Gör" / "Planla" | tap | `plan/conflict/{insightId}` / `POST /plan/proposals` → `plan/proposal/{id}` | conflict screen / proposal sheet | E2E-M-10 | ☐ |
| M-TD-01 | DİJİTAL HAYATIN row / "Tümü" | tap | `life/{id}` / `flow?filter=kisisel` | life sheet / Flow | E2E-S-06 | ☐ |
| M-TD-01 | Weekly card | tap | `weekly/{id}` | Weekly Review | mf_weekly_share | ☐ |
| M-TD-01 | Account alert "Yeniden Bağlan" | tap | `POST /integrations/:accountId/upgrade` → auth session → `POST /integrations/oauth/complete` | card disappears; status `healthy` | E2E-S-18 | ☐ |
| M-TD-01 | Account alert "Sonra" / "Tamam" | tap | hide until next session / dismiss | card hidden | E2E-S-18 | ☐ |
| M-TD-01 | Account alert "İzin Ver" / "Neden gerekli?" | tap | `Linking.openSettings()` or re-consent / explainer | OS settings / sheet | E2E-S-18 | ☐ |
| M-TD-01 | Account alert "Şimdi Dene" / "Tekrar Dene" / "Brifinge Dön" | tap | `POST /integrations/:accountId/sync` / refetch / `briefing/{id}` | fresh data / briefing | E2E-S-18 | ☐ |
| M-TD-01 | Header search / approval chip / avatar | tap | `search` / `approvals/index` / `settings/index` | target screen | E2E-M-06 | ☐ |
| M-TD-01 | Screen | pull | `POST /integrations/:accountId/sync` per healthy account (429 = fresh) + refetch | "Güncel · {HH:MM}" for 1.5 s | mf_today_offline | ☐ |
| M-TD-02 | **Option rows** (commit immediately and close) | tap | `set_insight_status` / `apply_insight_feedback` / `learned_preferences` insert | toast with "Geri al" → revert | mf_today_correction | ☐ |
| M-TD-02 | Reason line | tap | M-TD-03 | why sheet | mf_today_correction | ☐ |
| M-TD-02 | "Kaynağı aç" | tap | source route | source opens | mf_today_correction | ☐ |
| M-TD-02 | "Kural oluştur" | tap | `settings/priority-rules/new?fromInsight={id}` | rule editor prefilled | E2E-S-11 | ☐ |
| M-TD-03 | **"Kaynağı aç"** | tap | source route from `get_explanation` | source opens | WhySheet.test | ☐ |
| M-TD-03 | Tier row | tap | `settings/priority-rules/{rule_id}` or `settings/personalization` | rule / personalization | WhySheet.test | ☐ |
| M-TD-03 | "Önemli değil" / "Kural oluştur" | tap | as M-TD-02 | as M-TD-02 | WhySheet.test | ☐ |
| M-TD-04 | **Preset row** | tap | `set_insight_status(snoozed, snoozed_until)` | card removed until the time + undo toast | mf_today_swipe_snooze | ☐ |
| M-TD-04 | "Kendin seç" | tap | native date-time picker (future only) | custom snooze applied | SnoozeSheet.test | ☐ |
| M-BR-01 | **"Brifingi Dinle · {m} dk"** | tap | `briefing/{id}/listen?autoplay=1`; Free → M-GL-13 `voice_briefing` | player / gate | mf_briefing_read_listen | ☐ |
| M-BR-01 | Row | tap | `mail/{id}` / `event/{id}` / `meeting/{id}/prep` / `commitments/{id}` / `life/{id}` | source screen | E2E-M-05 | ☐ |
| M-BR-01 | Row | long-press | M-TD-03 | why sheet | MorningBriefingView.test | ☐ |
| M-BR-01 | Feedback thumbs | tap | `ai_feedback` insert | thumb selected + toast | MorningBriefingView.test | ☐ |
| M-BR-01 | Re-ask banner / Back | tap | OS prompt or dismiss forever (`notification_reprompted_at`) / previous screen | banner gone | MorningBriefingView.test | ☐ |
| M-BR-02 | **Play/pause** | tap | expo-audio / TTS queue | playback toggles | mf_briefing_read_listen | ☐ |
| M-BR-02 | ±15 s | tap | `seekTo(clamp(pos±15))` | position moves exactly 15 s | AudioPlayerScreen.test | ☐ |
| M-BR-02 | Scrubber | drag | `seekTo` | position updated | AudioPlayerScreen.test | ☐ |
| M-BR-02 | Speed chip | tap | cycles 1.0 → 1.25 → 1.5 | rate applied | AudioPlayerScreen.test | ☐ |
| M-BR-02 | Chapter row | tap | `seekTo(start_s)` | chapter plays | AudioPlayerScreen.test | ☐ |
| M-BR-02 | Collapse | tap | M-GL-14 | playback continues docked | mf_briefing_read_listen | ☐ |
| M-BR-02 | Ended "Baştan Dinle" / "Brifinge Dön" | tap | restart / `briefing/{id}` | as labelled | AudioPlayerScreen.test | ☐ |
| M-BR-02 | Failed file "Cihaz Sesiyle Dinle" | tap | switch to native TTS mode | TTS plays | tts-queue.test | ☐ |
| M-BR-03 | **"Tamam"** | tap | dismiss + mark opened | pulse closed | mf_midday_deliver | ☐ |
| M-BR-03 | DeltaCard actions; timeline rows; close | tap | `meeting/{id}/prep` / `event/{id}` / deadline source / dismiss | target screen | MiddayPulseView.test | ☐ |
| M-BR-04 | **"Yarına Hazırım"** | tap | M-BR-04C | confirmation sheet | mf_evening_carry_over | ☐ |
| M-BR-04 | Open-row radio | tap | complete (optimistic) | row done + "Geri al" | EveningCloseView.test | ☐ |
| M-BR-04 | Done / carry-over / follow-up rows | tap | source / `commitments/{id}` / `mail/{id}` | target screen | EveningCloseView.test | ☐ |
| M-BR-04 | NextEventCard / its `alarm` icon | tap | `event/{id}` / `reminders/new?sourceType=event&sourceId={id}&preset=before_1h` | event / reminder sheet | EveningCloseView.test | ☐ |
| M-BR-04 | "Dinle · {1} dk"; Back | tap | M-BR-02 / back | player / previous | EveningCloseView.test | ☐ |
| M-BR-04C | **"Yarına Hazırım"** | tap | `POST /briefings/:id/evening-ready` | success state in sheet | mf_evening_carry_over | ☐ |
| M-BR-04C | Item switches; quiet switch; "Vazgeç" | toggle | local selection / dismiss | as selected | EveningReadySheet.test | ☐ |
| M-BR-04C | Success "Bugün'e Dön" | tap | `router.replace('/(tabs)/today')` | hero `evening_confirmed` | mf_evening_carry_over | ☐ |
| M-BR-05 | **"Dijital Haftamı Paylaş"** | tap | `weekly/{id}/share` | share card | mf_weekly_share | ☐ |
| M-BR-05 | Close / person row / "Planla" / "Bu haftanın brifingleri" | tap | back / `person/{id}` / `POST /plan/proposals` / M-BR-07 | target screen | WeeklyReview.test | ☐ |
| M-BR-06 | **"Paylaş"** | tap | capture card → `shareAsync` (`GET /weekly/:id/share-card` data) | system share sheet, no names/subjects | mf_weekly_share | ☐ |
| M-BR-06 | Format segment; invite switch; close | toggle | local / dismiss | preview updates | ShareCard.test | ☐ |
| M-BR-07 | **Row** | tap | `briefing/{id}` or `weekly/{id}` | briefing | BriefingHistory.test | ☐ |
| M-BR-07 | List | pull | refetch; infinite scroll loads next page | list updated | BriefingHistory.test | ☐ |

### 4.3 Part 2: Flow, mail, reply, follow-up, commitments, life, reminders, capture, approvals

| Screen | Element | Action | Target (route / RPC / navigation) | Success state | Test ID | PASS/FAIL |
|---|---|---|---|---|---|---|
| M-FLOW-01 | **email card primary** ("Yanıt Hazırla" / "Takvime Ekle" / "Aç") | tap | `mail/[id]/reply` / `POST /approvals` → M-APPR-04 / `mail/[id]` | reply modal / approval sheet / detail | E2E-S-01 | ☐ |
| M-FLOW-01 | **meeting card primary** | tap | `meeting/[eventId]/prep`; Free "Etkinliği Aç" → `event/[id]` | prep / event | E2E-S-01 | ☐ |
| M-FLOW-01 | **deadline / payment card primary** | tap | `reminders/new?anchorAt=` (grounded due date) | reminder sheet | E2E-S-01 | ☐ |
| M-FLOW-01 | **follow_up card primary** | tap | `POST /followups/:threadId/draft` → reply modal (`mode=follow_up`) | draft shown | E2E-S-05 | ☐ |
| M-FLOW-01 | **commitment card primary** | tap | `POST /plan/proposals {commitment_id}` → `plan/proposal/[id]` | proposal sheet | E2E-S-01 | ☐ |
| M-FLOW-01 | **shipment / flight / reservation / subscription / security card primary** | tap | `life/[id]` (URL actions only for allow-listed grounded URLs) | life sheet | E2E-S-06 | ☐ |
| M-FLOW-01 | "Ekle" | tap | `capture` modal (Free sees the Capture Pro gate inside) | capture composer | E2E-M-15 | ☐ |
| M-FLOW-01 | Avatar | tap | `settings/index` | Settings | E2E-S-01 | ☐ |
| M-FLOW-01 | Filter chip | tap | update `filter` (URL param + MMKV) via `flow_feed`; emits `flow_filter_select` | filtered list at top | E2E-S-01 | ☐ |
| M-FLOW-01 | Digest row | tap | `mail/index` | Mail Intelligence | E2E-S-02 | ☐ |
| M-FLOW-01 | `SourceLine` | tap | M-SRC-01 | source sheet | REL-07 | ☐ |
| M-FLOW-01 | Card / "···" | long-press | action sheet: Tamamlandı / Ertele / Önemli değil / Bu nereden çıktı? / Düzelt… (M-CORR-01) | sheet opens | E2E-S-01 | ☐ |
| M-FLOW-01 | "Tamamlandı" (full ≥60% auto-applies) | swipe→ | `set_insight_status(done)` | optimistic removal + "Tamamlandı · Geri al" (5 s) | E2E-S-01 | ☐ |
| M-FLOW-01 | "Ertele" | swipe← | `reminders/new?mode=snooze&targetType=insight&targetId=` | snooze sheet | E2E-S-01 | ☐ |
| M-FLOW-01 | "Önemli değil" (security cards: dismiss only, no learning) | swipe← | `set_insight_status(dismissed)` + `ai_feedback{not_important}` + `learned_preferences` insert (learning on) | toast "Öğrendim · …" + "Geri al" | E2E-S-01 | ☐ |
| M-FLOW-01 | Screen | pull | sync calls + refetch | 2 px indigo line; "Güncel · {HH:mm}" | E2E-S-01 | ☐ |
| M-FLOW-01 | List end | scroll | next page at 70% | more cards | E2E-S-01 | ☐ |
| M-MAIL-01 | **Category row** (6 rows) | tap | `mail/category/{important,has_deadline,informational,low_priority}` / `waiting` / `followups` | category list | E2E-S-02 | ☐ |
| M-MAIL-01 | Back / Search | tap | back / `search?types=email` | previous / search | E2E-S-02 | ☐ |
| M-MAIL-01 | Account chip | tap | re-query `mail_intelligence(p_local_date, p_account_id)` | counts for that account | E2E-S-02 | ☐ |
| M-MAIL-01 | `MailSummaryCard` / card actions | tap | `mail/[id]` / `mail/[id]/reply` / `POST /approvals` → M-APPR-04 | target screen | E2E-S-02 | ☐ |
| M-MAIL-01 | Card "···"; pull | tap | M-CORR-01 (priority mode); refetch | sheet / fresh data | E2E-S-02 | ☐ |
| M-MAIL-01 | Distribution bar | — | not clickable (`accessible=false`) | — | E2E-S-02 | ☐ |
| M-MAIL-02 | **Card** | tap | `mail/[id]` | detail | E2E-S-02 | ☐ |
| M-MAIL-02 | Card action by category | tap | `mail/[id]/reply` / `POST /approvals` (has_deadline) | reply / approval | E2E-S-02 | ☐ |
| M-MAIL-02 | "···" incl. "Bu önemliydi" | tap | M-CORR-01 (`show_more`) | reclassified + toast | E2E-S-12 | ☐ |
| M-MAIL-03 | **"Yanıt Hazırla" / "Taslağa Devam Et"** | tap | `mail/[id]/reply?tone={default_reply_tone}` (`draftId` if a ready draft exists) | reply modal | E2E-S-03 | ☐ |
| M-MAIL-03 | "Görev Oluştur" | tap | `POST /approvals {task_create, source}` → M-APPR-04 | approval sheet with server-proposed task | E2E-C | ☐ |
| M-MAIL-03 | "Takvime Ekle" | tap | `POST /approvals {calendar_create, source}` → M-APPR-04 | approval sheet | E2E-S-03 | ☐ |
| M-MAIL-03 | "Hatırlat" | tap | `reminders/new?targetType=email_message&targetId={id}&anchorAt=` | reminder sheet | E2E-D | ☐ |
| M-MAIL-03 | "Orijinal Mail" accordion | tap | `GET /mail/:messageId/original` (sanitised, not stored) | plain text, no remote images | E2E-S-03 | ☐ |
| M-MAIL-03 | Link inside the original | tap | M-MAIL-05 | link confirmation | url-safety.test | ☐ |
| M-MAIL-03 | `SourceLine` / badge | tap | M-SRC-01 | source sheet | E2E-S-03 | ☐ |
| M-MAIL-03 | `more_horiz` | tap | M-MAIL-04 | overflow sheet | E2E-S-03 | ☐ |
| M-MAIL-03 | Sender row / thread row | tap | `person/[contactId]` / `mail/[siblingId]` | person / sibling mail | E2E-S-03 | ☐ |
| M-MAIL-04 | **"{Gmail'de/Outlook'ta} Aç"** | tap | allow-listed provider web link (external handoff) | provider app/browser | E2E-S-03 | ☐ |
| M-MAIL-04 | "Bu nereden çıktı?" | tap | M-SRC-01 | source sheet | E2E-S-03 | ☐ |
| M-MAIL-04 | "Önemli değil" / "Bu önemliydi" | tap | M-CORR-01 priority mode, preselected | correction applied | E2E-S-12 | ☐ |
| M-MAIL-04 | "Göndereni VIP yap" / "VIP'den çıkar" | tap | `vip_people` insert/delete (Pro; Free → `paywall?source=vip`) | toast + undo | E2E-S-13 | ☐ |
| M-MAIL-04 | "Kural oluştur" | tap | `settings/priority-rules/new?sender={email}&kind=sender_important` | rule editor | E2E-S-11 | ☐ |
| M-MAIL-04 | "Göndereni gör" / "Kapat" | tap | `person/[contactId]` / dismiss | person / closed | E2E-S-03 | ☐ |
| M-MAIL-05 | **"Bağlantıyı Aç"** | tap | `openBrowserAsync(url)` (https/http); `mailto:`/`tel:` → `Linking.openURL`; other schemes blocked | browser / "Bu bağlantı türü açılamaz." | url-safety.test | ☐ |
| M-MAIL-05 | "Bağlantıyı kopyala" / "Vazgeç" | tap | `expo-clipboard` / dismiss | copied toast / closed | url-safety.test | ☐ |
| M-REPLY-01 | **"Göndermeyi Onayla"** | tap | flush PATCH → capability gate (M-REPLY-02) → `POST /reply-drafts/:id/submit` → hashes equal → `POST /approvals/:id/approve` (else M-APPR-04) → poll | "Gönderildi" success view only on `executed`; "Tekrar dene" reuses the key on `failed` | E2E-M-07, E2E-B | ☐ |
| M-REPLY-01 | Tone segment | tap | `POST /reply-drafts/:id/regenerate {tone}` (M-REPLY-04 if edited) | body replaced with shimmer | E2E-M-07 | ☐ |
| M-REPLY-01 | "Kısalt" | tap | regenerate `instruction:'shorten'` | toast "Kısaltıldı · Geri al" | reply.test | ☐ |
| M-REPLY-01 | Attachment chip / "Dosya ekle" | tap | `expo-document-picker` → reply-attachment upload route (R-24) → `PATCH /reply-drafts/:id` | chip shown; size limits enforced | reply.test | ☐ |
| M-REPLY-01 | "Düzenle" | tap | full edit mode; recipients → M-REPLY-03 | editable subject/body | reply.test | ☐ |
| M-REPLY-01 | `more_horiz`: "Metni kopyala" / "{Gmail'de} konuyu aç" / "Taslağı sil" | tap | clipboard / handoff / `PATCH status:'discarded'` | toast / external / dismissed | reply.test | ☐ |
| M-REPLY-01 | Close with unsaved edits | tap | M-REPLY-05 | discard dialog | reply.test | ☐ |
| M-REPLY-01 | Approval-edit mode "Göndermeyi Onayla" / "Kaydet" | tap | `PATCH /approvals/:id {payload}` then approve with the new key / PATCH only | sent / pending with a new version | E2E-J | ☐ |
| M-REPLY-02 | **"İzin Ver"** | tap | `POST /integrations/:accountId/upgrade` → consent → `POST /integrations/oauth/complete` | continuation resumes automatically | E2E-M-07 | ☐ |
| M-REPLY-02 | "Vazgeç" / "Neden gerekli?" | tap | close (approval stays pending) / expand explanation | as labelled | E2E-M-07 | ☐ |
| M-REPLY-03 | **"Kaydet"** | tap | `PATCH /reply-drafts/:id` → recompute `send_preview` | recipients updated | E2E-M-07 | ☐ |
| M-REPLY-03 | "Tümünü yanıtla" switch; chip ×; add address or contact; "Vazgeç" | toggle | local edit / dismiss | recipient list updated | E2E-M-07 | ☐ |
| M-REPLY-04 | **"Yeniden Yaz"** | tap | `POST /reply-drafts/:id/regenerate {tone}` | toast "Yeni ton uygulandı · Geri al" | E2E-M-07 | ☐ |
| M-REPLY-04 | "Vazgeç" | tap | tone segment reverts | unchanged | E2E-M-07 | ☐ |
| M-REPLY-05 | **"Taslağı Sakla"** | tap | flush PATCH → dismiss | Email Detail shows "Taslağa Devam Et" | E2E-M-07 | ☐ |
| M-REPLY-05 | "Taslağı Sil" / "Düzenlemeye Dön" | tap | `PATCH status:'discarded'` → dismiss / back to editor | as labelled | E2E-M-07 | ☐ |
| M-WAIT-01 | **"Yanıt Hazırla"** | tap | `mail/[latestInboundMessageId]/reply?mode=reply` | reply modal | E2E-S-04 | ☐ |
| M-WAIT-01 | Card ("İlgili maili aç", SREQ-12) | tap | `mail/[id]` | detail | E2E-S-04 | ☐ |
| M-WAIT-01 | "Tamamlandı" | swipe→ | `set_insight_status(done, 'replied_elsewhere')` | undo toast | E2E-S-04 | ☐ |
| M-WAIT-01 | "Ertele" / "Önemli değil" | swipe← | snooze sheet / dismiss + feedback | as Flow | E2E-S-04 | ☐ |
| M-WAIT-01 | "···": "Hatırlat" / "Yanıt gerekmiyor" / "Bu nereden çıktı?" / "Düzelt…" | tap | `reminders/new…` / done `no_reply_needed` / M-SRC-01 / M-CORR-01 | as labelled | E2E-S-04 | ☐ |
| M-FUP-01 | **"Takip Mesajı Hazırla"** | tap | `POST /followups/:threadId/draft {tone:'short'}` → `mail/[lastOutboundMessageId]/reply?mode=follow_up&draftId=` | draft to original To | E2E-S-05 | ☐ |
| M-FUP-01 | "Yarın Hatırlat" | tap | `reminders/new?…&preset=tomorrow_morning` (confirm tap required) | reminder created after confirm | E2E-S-05 | ☐ |
| M-FUP-01 | "Kapat" | tap | `set_insight_status(done, 'closed')` | toast "Kapatıldı · Geri al" | E2E-S-05 | ☐ |
| M-FUP-01 | "···": "Bu kişiyi takip etme" | tap | `learned_preferences {stop_follow_up_contact}` insert + dismiss | toast "Öğrendim · …" + "Geri al" | E2E-S-05 | ☐ |
| M-FUP-01 | "···": "Ara" (only with a sourced phone) / "Bu nereden çıktı?" / "Düzelt…" | tap | `tel:` / M-SRC-01 / M-CORR-01 | as labelled | E2E-S-05 | ☐ |
| M-FUP-01 | Swipes | swipe→ | right = close; left = Ertele / Önemli değil | as Flow | E2E-S-05 | ☐ |
| M-FUP-01 | Card | tap | `mail/[lastOutboundMessageId]` | detail | E2E-S-05 | ☐ |
| M-COMMIT-01 | **"Tamamlandı"** (open card) | tap | `set_commitment_status(done)` | card moves to TAMAMLANANLAR + "Geri al" | E2E-M-12 | ☐ |
| M-COMMIT-01 | "Ertele" | tap | `reminders/new?mode=snooze&targetType=commitment&targetId={id}` | snooze sheet (confirm) | E2E-M-12 | ☐ |
| M-COMMIT-01 | "Kaynağı Gör" | tap | `mail/[id]?highlight=` / `meeting/[eventId]/summary` / `capture/[id]` | exact source | E2E-M-12 | ☐ |
| M-COMMIT-01 | Card | tap | `commitments/[id]` | detail | E2E-M-12 | ☐ |
| M-COMMIT-01 | Ambiguous card "Evet, takip et" / "Hayır" | tap | `POST /approvals/:id/approve` / `POST /approvals/:id/reject` | commitment created / `ai_feedback{not_a_commitment}` written | E2E-M-12 | ☐ |
| M-COMMIT-01 | they_owe "Takip Mesajı Hazırla"; done card "Geri al" (24 h) | tap | `POST /followups/:threadId/draft` / `set_commitment_status(open)` | draft / reopened | E2E-M-12 | ☐ |
| M-COMMIT-02 | **"Tamamlandı" / "Yeniden aç"** | tap | `set_commitment_status(done / open)` | status chip updated | E2E-M-12 | ☐ |
| M-COMMIT-02 | "Ertele" / "Kaynağı Gör" / "Takip Mesajı Hazırla" | tap | snooze sheet / source / follow-up draft | as labelled | E2E-M-12 | ☐ |
| M-COMMIT-02 | "Planla" | tap | `POST /plan/proposals` → `plan/proposal/[id]` (Pro) | proposal sheet | E2E-M-12 | ☐ |
| M-COMMIT-02 | Reminder row "İptal" | tap | `POST /reminders/:id/cancel` + cancel local notification | row removed | E2E-M-12 | ☐ |
| M-COMMIT-02 | `more_horiz`: "Düzenle" / "Bu bir söz değil" / "Bu nereden çıktı?" / "Bilgi yanlış…" | tap | M-COMMIT-03 / `set_commitment_status(cancelled)` + `ai_feedback` / M-SRC-01 / M-CORR-01 fact mode | as labelled | E2E-M-12 | ☐ |
| M-COMMIT-03 | **"Kaydet"** | tap | `submit_ai_correction` (R-24) | toast "Güncellendi"; chip "Sen düzelttin" | E2E-M-12 | ☐ |
| M-COMMIT-03 | "Son tarihi kaldır" / "Vazgeç" | tap | clear the field / dismiss | as labelled | E2E-M-12 | ☐ |
| M-LIFE-01 | **Per-type primary** ("Takibi Gör", "Check-in", "Hatırlat", "Kaynağı Aç") | tap | allow-listed grounded URL (`expo-web-browser`), DKIM-aligned domain / `reminders/new` anchored to the due date / source | external page / reminder sheet / source | E2E-S-06 | ☐ |
| M-LIFE-01 | Reservation phone | tap | `tel:` | OS dialer | E2E-S-06 | ☐ |
| M-LIFE-01 | `SourceLine` / `more_horiz` ("Bilgi yanlış…", "Bu nereden çıktı?") | tap | M-SRC-01 / M-CORR-01 fact mode | sheet opens | E2E-S-06 | ☐ |
| M-LIFE-01 | "Kaynağı Aç" by source | tap | `mail/[id]` / `capture/[id]` / in-sheet structured-signal view (android_notification) | source | E2E-S-06 | ☐ |
| M-REM-01 | **"Hatırlatıcıyı Kur · {time}"** | tap | client `idempotency_key` → schedule local notification → `POST /reminders` | toast "Hatırlatıcı kuruldu · {time} · Geri al" (undo → `/reminders/:id/cancel`) | E2E-S-07, E2E-M-09 | ☐ |
| M-REM-01 | **"Ertele · {time}"** (snooze mode) | tap | `set_insight_status`/`set_commitment_status(snoozed)` (+ reminder when the switch is on) | toast "Ertelendi · {time} · Geri al" | E2E-S-07 | ☐ |
| M-REM-01 | **"Onaya Gönder"** (external destination) | tap | `POST /approvals {reminder_create}` → M-APPR-04 | approval sheet | E2E-D | ☐ |
| M-REM-01 | Preset rows (30 dakika önce, 1 saat önce, Bu akşam, Yarın sabah, Gelecek hafta) | tap | `resolvePreset` → absolute time (disabled with a meta reason) | row selected, CTA shows the time | UT-REM-01, E2E-S-07 | ☐ |
| M-REM-01 | "Uygun zamanda" | tap | `POST /reminders/resolve-time {preset:'smart'}` | reason line "Takvimine göre: …" | E2E-D | ☐ |
| M-REM-01 | "Kendin seç" / destination row | tap | M-REM-02 / M-REM-03 | picker / destination page | E2E-S-07 | ☐ |
| M-REM-01 | "Ayarlar" (permission denied warning) | tap | `Linking.openSettings()` | OS settings | E2E-S-07 | ☐ |
| M-REM-02 | **"Bu zamanı seç"** | tap | back to M-REM-01 with `custom` selected | meta shows the time | E2E-S-07 | ☐ |
| M-REM-02 | Back | tap | M-REM-01 (keeps the previous selection) | unchanged | E2E-S-07 | ☐ |
| M-REM-03 | **Destination row** (Dijital Asistan bildirimi / Apple Anımsatıcılar (iOS) / Google Görevler / Microsoft To Do) | tap | back to M-REM-01 with the destination | destination shown | E2E-S-07 | ☐ |
| M-REM-03 | "Varsayılan yap" switch / "Hesap bağla" | toggle | PATCH `user_preferences.default_reminder_destination` / `settings/accounts` | persisted / accounts | E2E-S-07 | ☐ |
| M-CAP-01 | **"Analiz Et"** | tap | text: `POST /captures` → `/captures/:id/analyze`; link: `/analyze`; media: upload → `/analyze`; then `capture/[id]` | M-CAP-05 progress | E2E-M-15, E2E-G | ☐ |
| M-CAP-01 | Tiles: Fotoğraf / Ekran görüntüsü / PDF / Link | tap | M-CAP-02 / system image picker (`kind='screenshot'`) / M-CAP-03 / link mode | picker or mode | E2E-G | ☐ |
| M-CAP-01 | "Sesle yaz" / "Yapıştır" / "Temizle" | tap | on-device dictation / `Clipboard.getStringAsync()` / clear | field updated | E2E-M-15 | ☐ |
| M-CAP-01 | Link field paste | input | debounced `POST /captures {kind:'link'}` (SSRF-safe fetch) | preview card | E2E-M-15 | ☐ |
| M-CAP-01 | Recent link row | tap | `capture/[id]` | existing result | E2E-M-15 | ☐ |
| M-CAP-01 | Close with draft | tap | "Taslak silinsin mi?" → "Sil" (`POST /captures/:id/discard`) / "Sakla" (MMKV) | as chosen | E2E-M-15 | ☐ |
| M-CAP-02 | **"Kamera"** | tap | camera (permission explainer first) | photo attached | E2E-M-15 | ☐ |
| M-CAP-02 | "Fotoğraflar" / "Vazgeç" | tap | system photo picker / dismiss | photo attached / closed | E2E-M-15 | ☐ |
| M-CAP-03 | **"Analiz Et"** | tap | create capture → analyze → `capture/[id]` | progress | E2E-M-15 | ☐ |
| M-CAP-03 | Row select / "Dosyalar'dan seç…" / "Vazgeç" | tap | select / device document picker / dismiss | file selected | E2E-M-15 | ☐ |
| M-CAP-04 | **"Analiz Et"** (share intake) | tap | same as M-CAP-01 | progress | E2E-S-08, REL-14 | ☐ |
| M-CAP-04 | Item × / "Metin ekle" / close | tap | remove item / note field / discard payload and cached files | as labelled | E2E-S-08 | ☐ |
| M-CAP-05 | **"İptal"** / × (after confirm) | tap | `POST /captures/:id/discard` | status `discarded`; back to M-CAP-01 with draft | E2E-M-15 | ☐ |
| M-CAP-06 | **"{N} Öğeyi Onaya Gönder"** (disabled at 0) | tap | `POST /captures/:id/actions` → M-APPR-04 batch mode | batch approval sheet | E2E-S-09, E2E-G | ☐ |
| M-CAP-06 | Row checkbox / row inline editor / "Düzenle" | tap | local selection / field editors (date, place, amount, person, destination) | N updated / values edited | E2E-S-09 | ☐ |
| M-CAP-06 | Type chips (link) | tap | `POST /captures/:id/analyze {type_override}` | suggestions re-mapped | E2E-G | ☐ |
| M-CAP-06 | "Aç" (hidden after `file_delete_at`) | tap | signed URL in `expo-web-browser` | file opens | E2E-M-15 | ☐ |
| M-CAP-06 | "{Ad}'e bağla" / invite toggle / quick-type chips | toggle | link capture to contact / attendees side effect shown / select rows by type | as labelled | E2E-S-09 | ☐ |
| M-CAP-07 | **"{Origin}'{suffix} Dön"** | tap | dismiss the capture modal to its origin | origin screen | E2E-M-15 | ☐ |
| M-CAP-07 | Result chip / failed chip | tap | created object (`event/[id]`, Plan task, `commitments/[id]`, reminder target) / `approvals/[id]` | target screen | E2E-M-15 | ☐ |
| M-APPR-01 | **Card "Onayla"** | tap | capability gate → `POST /approvals/:id/approve {idempotency_key}` → poll while `executing` | ONAYLANDI → İŞLENİYOR → BUGÜN TAMAMLANANLAR + executed toast | E2E-J, E2E-M-08 | ☐ |
| M-APPR-01 | "Düzenle" | tap | M-APPR-05 (`email_send` → `mail/[messageId]/reply?approvalId=`) | editor | E2E-J | ☐ |
| M-APPR-01 | "Reddet" | tap | `POST /approvals/:id/reject` | toast "Reddedildi" (+ "· Öğrendim" for AI suggestions with learning on) | E2E-M-08 | ☐ |
| M-APPR-01 | Card / "Kaynak" / "Değişim · Ayrıntı" | tap | `approvals/[id]` / M-SRC-01 | detail / source | E2E-J | ☐ |
| M-APPR-01 | Failed card "Tekrar dene" / "Vazgeç" | tap | re-approve with the same key / reject | executed / rejected | IT-APR-* | ☐ |
| M-APPR-01 | "Geçmiş"; pull | tap | `approvals/index?view=history`; refetch `list_approvals` | history / fresh | E2E-J | ☐ |
| M-APPR-02 | **Row** | tap | `approvals/[id]` | detail | E2E-J | ☐ |
| M-APPR-02 | Filter chips / "Yeniden öner" / "Tekrar dene" | tap | re-query / new proposal / re-approve (retryable only) | as labelled | E2E-J | ☐ |
| M-APPR-03 | **"Onayla" / "Tekrar dene" / "Sonucu gör"** | tap | approve / re-approve / `result.deeplink` (+ provider web link) | executed / result screen | E2E-J | ☐ |
| M-APPR-03 | "Düzenle" / "Reddet" / "Vazgeç" / "Kaynak" / "Destek kodu" | tap | M-APPR-05 / reject / reject / M-SRC-01 / copy first 8 chars of the id | as labelled | E2E-J | ☐ |
| M-APPR-04 | **"Onayla" / "Onayla · {N}"** | tap | per-destination capability gate → approve calls (`approved_via` `inline_sheet`/`capture_batch`) | per-row check; single: close + toast; batch: M-CAP-07; summary "{k}/{n} işlem tamamlandı" | E2E-S-09, E2E-J | ☐ |
| M-APPR-04 | "Geri al" (5 s, R-06) | tap | cancels before approve is sent; approval stays `pending` | no side effect | E2E-J | ☐ |
| M-APPR-04 | "Düzenle" / "Reddet" (single) / "Vazgeç" (batch) | tap | M-APPR-05 / reject / reject all pending with `user_cancel` | as labelled | E2E-S-09 | ☐ |
| M-APPR-04 | Row check / "Kaynak" | toggle | batch selection / M-SRC-01 | as labelled | E2E-S-09 | ☐ |
| M-APPR-04 | Drag/close undecided | drag | dismiss | toast "Onay Merkezi'nde bekliyor · Görüntüle" | E2E-J | ☐ |
| M-APPR-05 | **"Kaydet"** / "Devam" (new proposal) | tap | `PATCH /approvals/:id` (new version + key) / `POST /approvals` → M-APPR-04 | "Düzenlendi" chip / sheet | E2E-J | ☐ |
| M-APPR-05 | Typed editor fields (calendar invite switch, task destination, reminder presets, commitment direction); "Vazgeç" | input | local edit / discard | diff updates live | E2E-J | ☐ |
| M-SRC-01 | **"Uygulamada aç"** | tap | `in_app_deeplink` from `get_explanation` (`mail/[id]?highlight=`, `event/[id]`, `capture/[id]`, `meeting/[eventId]/summary`) | source opens | REL-07 | ☐ |
| M-SRC-01 | "{Gmail'de/Outlook'ta/Takvimde} aç" / "Bu yanlış" / "Önemli değil" / "Kapat" | tap | provider web link / M-CORR-01 fact / M-CORR-01 priority / dismiss | as labelled | REL-07 | ☐ |
| M-CORR-01 | **Priority-mode row** ("Önemli değil", "Bu önemliydi", VIP, "Bunu takip etme", "Kural oluştur") | tap | `set_insight_status` + `ai_feedback` + `learned_preferences` insert / `vip_people` / rule editor | toast "Öğrendim · …" + "Geri al" (5 s); learning off → "Kaydedildi · Etkileşimlerimden öğren kapalı" | E2E-S-12 | ☐ |
| M-CORR-01 | Fact-mode row → "Düzeltmeyi Kaydet" | tap | `submit_ai_correction` (R-24) | chip "Sen düzelttin" | E2E-S-12 | ☐ |
| M-CORR-01 | "Başka bir sorun" → "Gönder" / "Kapat" | tap | `ai_feedback.comment` (≤280, never in analytics) / dismiss | toast / closed | E2E-S-12 | ☐ |

### 4.4 Part 3: Plan, meetings, assistant, voice, memory, search, people

| Screen | Element | Action | Target (route / RPC / navigation) | Success state | Test ID | PASS/FAIL |
|---|---|---|---|---|---|---|
| M-PLAN-01 | **"Planla"** (schedule_suggestion card) | tap | `POST /plan/proposals {insight_id}` → `plan/proposal/{approval.id}` | M-PLAN-03 | E2E-M-10, E2E-E | ☐ |
| M-PLAN-01 | Segment "Hafta" | tap | M-PLAN-02 in place (`view=week`, persisted) | week view | plan-week | ☐ |
| M-PLAN-01 | Day cell / strip swipe / "Bugün" pill | tap | set `date` → `plan_range` | timeline for the day | plan-day | ☐ |
| M-PLAN-01 | "Başka zaman" | tap | `POST /plan/proposals {insight_id, action:'next_slot'}` | toast "Yeni öneri: …" or "Bu hafta uygun başka boşluk bulamadım." | plan-day | ☐ |
| M-PLAN-01 | "Böyle Kalsın" | tap | `set_insight_status(dismissed)` + `ai_feedback{keep_as_is}` | toast "Tamam, bunu bir daha göstermem" + "Geri al" | plan-day | ☐ |
| M-PLAN-01 | Insight card body | tap | SourceSheet (`get_explanation`) | sources + "Neden önemli?" | plan-day | ☐ |
| M-PLAN-01 | Timeline items (meeting / event / proposal / gap / life / deadline / task / commitment / "Çakışma") | tap | M-MEET-01 (Pro) or M-PLAN-09 / `plan/proposal/{id}` / M-PLAN-05 / `life/{id}` / source / M-PLAN-06 / `commitments/{id}` / `plan/conflict/{id}` | target screen | plan-day | ☐ |
| M-PLAN-01 | Avatar | tap | `settings/index` | Settings | plan-day | ☐ |
| M-PLAN-01 | Screen | pull | sync calendar accounts (throttled) + refetch | "Güncel · {HH:MM}" | plan-day | ☐ |
| M-PLAN-02 | **Top insight card first action** (e.g. "Seçenekleri Gör") | tap | `plan/conflict/{id}` | conflict screen | plan-week | ☐ |
| M-PLAN-02 | Bar column / day label; chevrons / swipe | tap | `view=day&date=` / ±1 week (`plan_week_density`) | day view / week changes | plan-week | ☐ |
| M-PLAN-02 | "{HH:MM}'e Kaydır" | tap | `POST /approvals {calendar_update}` → in-screen approval preview | approved update in calendar | plan-week | ☐ |
| M-PLAN-02 | "Yeni Saat Öner" (not organizer) | tap | `email_send` approval with draft; "Düzenle" → `mail/{messageId}/reply?draftId=` | preview shows draft | plan-week | ☐ |
| M-PLAN-02 | "Hazırlığı Buraya Koy" / "Zaman Ayır" | tap | `POST /plan/proposals` → M-PLAN-03 | proposal sheet | plan-week | ☐ |
| M-PLAN-02 | "Hazırlığı Aç" / "{HH:MM}'e Hatırlat" / "Kaynağı Aç" / card body | tap | `meeting/{eventId}/prep` / `reminders/new?…` / source / SourceSheet | target | plan-week | ☐ |
| M-PLAN-03 | **"Onayla"** | tap | `POST /approvals/:id/approve` → execute `calendar_create` (deterministic event id) | "Planlandı" success view | plan-schedule-proposal, E2E-E | ☐ |
| M-PLAN-03 | "Plan'a Dön" | tap | `plan?date={day}&focus=event:{id}` | created event highlighted | plan-schedule-proposal | ☐ |
| M-PLAN-03 | "Saati Değiştir" / title edit (`edit`) | tap | M-PLAN-04 / `PATCH /approvals/:id {payload:{title}}` | new version + key | plan-schedule-proposal | ☐ |
| M-PLAN-03 | "İptal" | tap | `POST /approvals/:id/reject {reason:'user_cancel'}` | insight stays `open` | plan-schedule-proposal | ☐ |
| M-PLAN-03 | Swipe-down / scrim | drag | dismiss without reject | approval stays `pending` in Approval Center | plan-schedule-proposal | ☐ |
| M-PLAN-03 | "Kaynak" / failed "Tekrar Dene" / expired "Yeni saat bul" | tap | source / re-approve same key / `POST /plan/proposals {action:'next_slot'}` | as labelled | plan-schedule-proposal | ☐ |
| M-PLAN-04 | **Slot → "Bu saati kullan"** | tap | `GET /plan/free-slots` → `PATCH /approvals/:id` (or new `calendar_update` from M-PLAN-09) | parent re-renders "Değişim" | FreeSlotPicker.test | ☐ |
| M-PLAN-04 | Day chips / "Vazgeç" | tap | refetch slots / pop | slots update / unchanged | FreeSlotPicker.test | ☐ |
| M-PLAN-05 | **"Odak bloğu öner"** | tap | `POST /plan/proposals {kind:'focus_block'}` → M-PLAN-03 | proposal sheet | plan-day | ☐ |
| M-PLAN-05 | Task row / "Bu saatte hatırlat" / scrim | tap | `task_block` proposal → M-PLAN-03 / `reminders/new?sourceType=plan_gap&at=` / close | as labelled | plan-day | ☐ |
| M-PLAN-06 | **"Takvime Yerleştir"** (Pro) | tap | `POST /plan/proposals {kind:'task_block', task_id}` → M-PLAN-03 | proposal sheet | TaskSheet.test | ☐ |
| M-PLAN-06 | "Hatırlat" / "{Google Tasks}'ta Aç" / provenance | tap | `reminders/new?sourceType=task` / allow-listed handoff / `mail/{id}` | as labelled | TaskSheet.test | ☐ |
| M-PLAN-07 | **Recommended option row** | tap | `POST /plan/conflicts/:insightId/resolve` → M-PLAN-08 preview | preview in sheet | plan-conflict-resolve | ☐ |
| M-PLAN-07 | Other options: `call_booking` / `remind_me` / `keep` | tap | `tel:` / `reminders/new?…&at=` (server prefill) / `resolve {option_id:'keep'}` | dialer / reminder sheet / toast "Tamam, bu çakışmayı bir daha göstermem" + "Geri al" | plan-conflict-resolve | ☐ |
| M-PLAN-07 | Back / sheet swipe-down / card tap | tap | pop to origin / peek detent / `event/{id}` or `life/{id}` | as labelled | plan-conflict-resolve | ☐ |
| M-PLAN-08 | **"Onayla"** | tap | approve `calendar_update` / `email_send` | executed success | plan-conflict-resolve | ☐ |
| M-PLAN-08 | "Düzenle" / "Vazgeç" / "Kaynak" | tap | M-PLAN-04 or reply modal / reject `user_cancel` / source | as labelled | ResolutionPreview.test | ☐ |
| M-PLAN-09 | **"Toplantıya Hazırlan"** (meetings; Free → ProGateCard) / "Hatırlat" (non-meetings) | tap | `meeting/{id}/prep` / `reminders/new?sourceType=event&sourceId={id}` | prep / reminder sheet | plan-day | ☐ |
| M-PLAN-09 | "Toplantıya Katıl" / "Haritada Aç" / "Takvimde Aç" | tap | allow-listed external handoffs | external app | EventDetail.test | ☐ |
| M-PLAN-09 | Attendee row / long-press "E-postayı kopyala" | tap | `person/{contactId}` / clipboard | person / copied | EventDetail.test | ☐ |
| M-PLAN-09 | "Saati Değiştir" (organizer only) / "Not Al" / note row / "Toplantı sonrası not al" | tap | M-PLAN-04 → M-PLAN-08 / M-MEET-02 / expand / `meeting/{id}/post` | as labelled | EventDetail.test | ☐ |
| M-MEET-01 | **"2 Dakikalık Özeti Oku"** | tap | `meeting/{eventId}/summary` | M-MEET-03 | meeting-prep-notification, E2E-M-11 | ☐ |
| M-MEET-01 | "Not Al" / person row / SON MAİLLER row / SON GÖRÜŞMENİZ | tap | M-MEET-02 / `person/{contactId}` / `mail/{messageId}` / previous meeting or mail | target | E2E-F | ☐ |
| M-MEET-01 | AÇIK KONULAR row / long-press "Taahhüde çevir" / "Çözüldü" | tap | source / `POST /approvals {commitment_create}` → M-ASST-03 anatomy / `set_insight_status(done)` + undo | as labelled | E2E-M-11 | ☐ |
| M-MEET-01 | SENDEN BEKLENENLER / SENİN BEKLEDİKLERİN rows; "Takip hazırla" | tap | `commitments/{id}` or `mail/{id}/reply` / `mail/{id}` / `POST /followups/:threadId/draft` | target; never auto-sends | E2E-M-11 | ☐ |
| M-MEET-01 | Talking point / İLGİLİ DOSYALAR row (non-allow-listed: not clickable) | tap | SourceSheet / allow-listed handoff or `capture/{id}` | target | E2E-M-11 | ☐ |
| M-MEET-01 | "{Google Meet}'e Katıl" / "Yenile" / "Toplantı sonrası not al" (after end) | tap | `Linking.openURL` / `POST /meetings/:eventId/prep {force:true}` (1/5 min) / `meeting/{eventId}/post` | external / refreshed prep / post screen | E2E-M-11 | ☐ |
| M-MEET-02 | **"Kaydet"** (disabled when empty) | tap | `POST /meetings/:eventId/notes` (+ server `embedding` job) | toast "Not kaydedildi"; NOTLARIN refetched | E2E-F | ☐ |
| M-MEET-02 | Mic / "Vazgeç" (confirm "Not silinsin mi?" when text exists) | tap | on-device dictation / discard | text appended / closed | MeetingNoteSheet.test | ☐ |
| M-MEET-03 | **`headphones`** | tap | native TTS `Speech.speak(tr-TR)`; premium: `POST /meetings/:eventId/prep/audio` (R-24) player with ±15 s | paragraph highlight follows audio | meeting-prep-notification | ☐ |
| M-MEET-03 | close / "{n} mail" chip / note chip / file chip / paragraph long-press "Kaynağı göster" | tap | back (stops audio) / mail list sheet → `mail/{id}` / `event/{id}` / handoff or `capture/{id}` / SourceSheet | target | MeetingSummary.test | ☐ |
| M-MEET-04 | **"Kaydet"** (≥1 selected) | tap | sequential `POST /approvals/:id/approve` (`commitment_create`, `approved_via=in_place`); unselected → reject `user_excluded` | "{2} taahhüt kaydedildi." + "Taahhütleri Gör" / "Bugün'e Dön" | post-meeting-text, E2E-F | ☐ |
| M-MEET-04 | Row / include toggle / keyboard toggle / "Tekrar kaydet" | tap | M-MEET-05 / local selection / text mode ("Taahhütleri Çıkar" → `POST /meetings/:eventId/post`) / re-listen | as labelled | PostMeeting.test | ☐ |
| M-MEET-04 | Close × with pending proposals | tap | alert → "Sil" rejects all `user_cancel` + deletes note | nothing saved | PostMeeting.test | ☐ |
| M-MEET-05 | **"Kaydet"** | tap | `PATCH /approvals/:id {payload}` | row updated, `selected` | CommitmentEditSheet.test | ☐ |
| M-MEET-05 | "Vazgeç" | tap | discard edits | unchanged | CommitmentEditSheet.test | ☐ |
| M-ASST-01 | **Suggested prompt** | tap | `chat/new?prompt={key}` → thread created + prompt sent | streaming answer | assistant-home, E2E-M-13 | ☐ |
| M-ASST-01 | Composer send / mic / "+" | tap | `chat/new` with text / `voice?origin=assistant` / `capture?origin=assistant` | target | assistant-home | ☐ |
| M-ASST-01 | "Hafıza" / search icon / recent thread row | tap | `memory` (Free → Pro gate) / `search` / `chat/{threadId}` | target | assistant-home | ☐ |
| M-ASST-01 | Thread row "Sil" (swipe← or accessibility action) | swipe← | confirm → PostgREST `DELETE assistant_threads` (cascade) | toast "Sohbet silindi" | AssistantHome.test | ☐ |
| M-ASST-01 | "Daha fazla" | tap | next page | more threads | AssistantHome.test | ☐ |
| M-ASST-02 | **Send** | tap | `POST /assistant/threads/:id/messages` (SSE); `final` replaces text with verified text | answer + source cards after `final` | assistant-citations, E2E-M-13 | ☐ |
| M-ASST-02 | Source card rows (mail / calendar / person / commitment / life / capture / note / day) | tap | `mail/{id}` / `meeting/{id}/prep` or `event/{id}` / `person/{id}` / `commitments/{id}` / `life/{id}` / `capture/{id}` / `event/{id}` / `plan?date=` | target | assistant-citations | ☐ |
| M-ASST-02 | "Yanıtla" / FollowUpChip / "Düzenle" (draft) | tap | `mail/{messageId}/reply` / sends chip text / `mail/{id}/reply?draftId=` | target | assistant-citations | ☐ |
| M-ASST-02 | "Göndermeyi Onayla" (server-built proposal, R-04) | tap | `POST /approvals/:id/approve` | "Gönderildi" only on `executed` | assistant-write-intent | ☐ |
| M-ASST-02 | "Durdur" / "Yeni sohbet" / mic / "+" | tap | abort stream / `router.replace('/chat/new')` / `voice?threadId=` / capture | as labelled | ChatThread.test | ☐ |
| M-ASST-02 | Message long-press: "Kopyala" / "Faydalı" / "Faydalı değil" | long-press | clipboard / `ai_feedback{feature:'assistant_answer'}` | toast "Teşekkürler · Öğrendim" | ChatThread.test | ☐ |
| M-ASST-02 | No-answer chips "Hafızada ara" / "Soruyu değiştir" | tap | `memory?q=` (Pro) / focus composer | target | assistant-citations | ☐ |
| M-ASST-03 | **"Onayla"** | tap | approve lifecycle (`approved_via` per surface) | success line per type ("Gönderildi", "Takvime eklendi", …) | ApprovalCard.test, E2E-M-13 | ☐ |
| M-ASST-03 | "Düzenle" | tap | `mail/{id}/reply?draftId=` / M-PLAN-04 / `reminders/new?approvalId=` / `approvals/{id}?mode=edit` / M-MEET-05 | editor | ApprovalCard.test | ☐ |
| M-ASST-03 | "Reddet" (chat) / "İptal" (voice) / "Ayrıntılar" | tap | reject `user_rejected` / reject `user_cancel` / `approvals/{id}` | as labelled | ApprovalCard.test | ☐ |
| M-VOICE-01 | **Orb / mic** | tap | start listening (on-device tr-TR STT; barge-in stops TTS) | transcript + answer | voice-mehmet-reply, E2E-S-14 | ☐ |
| M-VOICE-01 | Prompt chip / "Brifingimi oku." | tap | send with `input_mode:'voice'` / deterministic intent → `briefing/{id}/listen` (Free → ProGateCard) | answer / player | E2E-S-14 | ☐ |
| M-VOICE-01 | Approval card "Onayla" (tap only; spoken "onayla" never approves, R-03) | tap | approve with `approved_via=voice_card` | executed; TTS hint "Onaylamak için karta dokun." on spoken attempt | E2E-S-14, REL-16 | ☐ |
| M-VOICE-01 | "Düzenle" / "İptal" / "Metinle devam et" / close × / disambiguation chips | tap | text-mode editor / reject `user_cancel` / `chat/{threadId}` / stop STT+TTS / `context.entity_ref` | as labelled | VoiceMode.test | ☐ |
| M-MEM-01 | **Submit query** | key | `GET /search?mode=answer&q=` (Pro) | answer + sources + related questions | memory-flight-ticket, E2E-H | ☐ |
| M-MEM-01 | Filter chips / "Son 30 gün" | tap | re-query `types` / `from=now-30d` | filtered answer | E2E-H | ☐ |
| M-MEM-01 | "Orijinali Aç" / card | tap | `open_target` (`mail/{id}`, `event/{id}`, `capture/{id}`, `life/{id}`, `commitments/{id}`) | source | E2E-H | ☐ |
| M-MEM-01 | Related question / clear / recent row / "Temizle" / "Asistana sor" / retention footer | tap | new query / idle / re-run / clear MMKV recents / `chat/new` / settings retention | as labelled | MemoryScreen.test | ☐ |
| M-MEM-01 | Answer long-press "Kopyala" / "Faydalı"/"Faydalı değil" | long-press | clipboard / `ai_feedback{feature:'memory_answer'}` | toast | MemoryScreen.test | ☐ |
| M-SRCH-01 | **Result row** (email / person / event / task / commitment / life_event / memory / capture) | tap | `mail/{id}` / `person/{id}` / prep or `event/{id}` / `plan?date=&focus=task:` / `commitments/{id}` / `life/{id}` / `open_target` / `capture/{id}` | correct detail (E2E-H) | search-routing, E2E-M-14 | ☐ |
| M-SRCH-01 | Scope chips / "Tümünü gör" / "İptal" / clear / recent row / "Temizle" / example chip / "Hafızaya sor" | tap | `GET /search?q=&types=&contact_id=` / pop / re-run / `memory?q=` | as labelled | SearchScreen.test | ☐ |
| M-PERS-01 | **Composer** | input | `chat/new?contactId={id}` (person-scoped retrieval) | scoped answer | vip-add-suggestion, E2E-S-13 | ☐ |
| M-PERS-01 | VIP chip | tap | M-VIP-03 (Free → ProGateCard) | VIP edit | E2E-S-13 | ☐ |
| M-PERS-01 | Tiles: "Son iletişim" / "Yaklaşan" / "Açık konu" | tap | `last_contact.ref` / prep or event / scroll to AÇIK KONULAR (`person_intelligence`) | target | E2E-S-13 | ☐ |
| M-PERS-01 | Meeting / open loop (long-press "Çözüldü") / topic / SENDEN / SENİN rows; "Takip hazırla" | tap | prep/event / source + `set_insight_status(done)` / source / `commitments/{id}` or reply / `mail/{id}` / follow-up draft | target | E2E-S-13 | ☐ |
| M-PERS-01 | "Tüm taahhütleri gör" / "Tüm mailleri gör" / mic | tap | `commitments?contactId=` / `search?types=email&contactId=` / `voice?contactId=` | target | E2E-S-13 | ☐ |
| M-VIP-01 | **"Kişi Ekle"** | tap | M-VIP-02 | contact picker | vip-add-suggestion | ☐ |
| M-VIP-01 | Row / star | tap | `person/{contactId}` / delete `vip_people` + always-notify rule | person / toast "{Ad} VIP'lerden çıkarıldı" + "Geri al" | E2E-S-13 | ☐ |
| M-VIP-01 | Row long-press "Grubu değiştir" / "VIP'lerden çıkar" | long-press | M-VIP-03 | VIP edit | E2E-S-13 | ☐ |
| M-VIP-01 | Suggestion "Evet" / "Şimdi değil" | tap | insert `vip_people{source:'suggestion'}` → M-VIP-03 / `ai_feedback{vip_suggestion, negative}` | toast + undo / row collapses | E2E-S-13 | ☐ |
| M-VIP-02 | **Contact row** | tap | M-VIP-03 prefilled | VIP edit | ContactPickerSheet.test | ☐ |
| M-VIP-02 | Search field / "Vazgeç" / manual e-mail row | input | filter / close / `upsert_manual_contact` (R-24) → M-VIP-03 | as labelled | ContactPickerSheet.test | ☐ |
| M-VIP-03 | **"Kaydet"** | tap | upsert `vip_people {relationship, bypass_quiet_hours}` (+ rule upsert/delete) | toast "Kaydedildi"; invalidate `['vip']`, `['person',id]`, `['today']` | VipEditSheet.test | ☐ |
| M-VIP-03 | "VIP'lerden çıkar" / "Vazgeç" | tap | delete + rule delete / close | toast with "Geri al" / closed | VipEditSheet.test | ☐ |

### 4.5 Part 4: Settings, privacy, notifications, subscription, referral, Android NI, help, widgets, global states

| Screen | Element | Action | Target (route / RPC / navigation) | Success state | Test ID | PASS/FAIL |
|---|---|---|---|---|---|---|
| M-SET-01 | **Ink card** (pending approvals) | tap | `/approvals` | Approval Center | settings/hub | ☐ |
| M-SET-01 | Identity row / `edit` | tap | M-SET-03 | Profile | settings/hub | ☐ |
| M-SET-01 | "Pro'ya geç" | tap | `/paywall?source=hub_upgrade` | paywall | settings/hub | ☐ |
| M-SET-01 | Rows: Brifing / Bildirimler / Öncelik Kuralları / AI Kişiselleştirme | tap | M-SET-23 / M-SET-20 / M-SET-50 / M-SET-45 | target | settings/hub | ☐ |
| M-SET-01 | Önemli Kişiler | tap | `/vip` or M-GATE-02(`vip`) for Free | VIP / gate | settings/hub | ☐ |
| M-SET-01 | Telefon Bildirimleri (Android only) / Abonelik / Bağlantılar / Gizlilik | tap | M-ANI-01 / M-SUB-01 / M-SET-10 / M-SET-30 | target | settings/hub | ☐ |
| M-SET-01 | Davet / Hesabımı Sil / Görünüm / Dil | tap | M-REF-01 / M-SET-39 / M-SET-60 / M-SET-62 | target | settings/hub | ☐ |
| M-SET-01 | Yardım / Geri Bildirim / Hakkında / Çıkış Yap | tap | M-SET-70 / M-SET-72 / M-SET-73 / M-SET-02 | target | settings/hub | ☐ |
| M-SET-01 | "Sürüm notları" | tap | store listing (`itms-apps://…id{APP_STORE_ID}` / `market://details?id=com.dijitalasistan.app`) | store opens | settings/hub | ☐ |
| M-SET-02 | **"Çıkış Yap"** | tap | `POST /devices/unregister` → `Purchases.logOut()` → `signOut({scope:'local'})` → local wipe → `router.replace('/(auth)/sign-in')` | sign-in; relaunch does not restore the session | auth/sign-out, TST-E2E-M-01 | ☐ |
| M-SET-02 | "Vazgeç" / drag | tap | dismiss | unchanged | auth/sign-out | ☐ |
| M-SET-03 | **Name field** (blur / "Bitti") | input | PATCH `profiles.display_name` (optimistic) | hub shows the new name | E2E-M-02 | ☐ |
| M-SET-03 | "Tüm cihazlardan çıkış yap" → confirm "Çıkış Yap" | tap | `POST /devices/unregister {scope:'all'}` → `signOut({scope:'global'})` → wipe | sign-in on every device | REL-02 | ☐ |
| M-SET-10 | **"Hesap ekle"** | tap | M-SET-11 | add-account sheet | integrations/connect-gmail-demo | ☐ |
| M-SET-10 | "Yönet" / row / "Bağla" / "PRO" | tap | M-SET-12 / M-SET-11 preselected / M-GATE-02(`second_account`/`extra_calendar`) | target | E2E-M-03 | ☐ |
| M-SET-10 | Inline "Yeniden Bağlan" / "İzin Ver" / "Şimdi Dene" | tap | `/integrations/:accountId/upgrade` / OS settings / `/integrations/:accountId/sync` | status updated | E2E-M-03 | ☐ |
| M-SET-11 | **Continue** | tap | `POST /integrations/:provider/start` → auth session, or OS prompt | M-SET-14 on return | E2E-M-03 | ☐ |
| M-SET-11 | "Vazgeç" / Pro-locked provider | tap | dismiss (`WebBrowser.dismissAuthSession()`) / M-GATE-02 | closed / gate | E2E-M-03 | ☐ |
| M-SET-12 | **"Yeniden Bağlan" / "İzin Ver" / "Şimdi eşitle"** | tap | `/upgrade` → consent → `/integrations/oauth/complete` / `/sync` | status `healthy` / fresh sync | E2E-M-03 | ☐ |
| M-SET-12 | Status card "Sonra" | tap | hide until next launch (MMKV) | card hidden | E2E-M-03 | ☐ |
| M-SET-12 | Data-source toggles (`*_ingest`, `mail_attachments`, `mail_deadlines`, `mail_drafts`, write controls) | toggle | `PATCH /integrations/:accountId/data-sources` (write control on without scope → `/upgrade`) | server enforces immediately (e.g. reply drafts 403 `source_control_off`) | E2E-M-19 | ☐ |
| M-SET-12 | Calendar check / "Bağlantıyı kaldır" | tap | PATCH calendars (Pro check) → `calendar_sync` / M-SET-13 | calendar synced / disconnect sheet | E2E-M-03 | ☐ |
| M-SET-13 | **"Bağlantıyı Kaldır"** | tap | `POST /integrations/:accountId/disconnect {purge_derived}` → 202; row "Kaldırılıyor…" polled until done | toast "Gmail bağlantısı kaldırıldı"; Microsoft toast action "Microsoft'ta kaldır" → `Linking.openURL` | E2E-M-03, IT-OAUTH-09 | ☐ |
| M-SET-13 | "Vazgeç" / Microsoft links / "Ayarları Aç" (device calendar) | tap | dismiss / external browser / OS settings | as labelled | E2E-M-03 | ☐ |
| M-SET-14 | OAuth return handler (no visible control) | auto | `POST /integrations/oauth/complete {completion_code, device_nonce}` (R-07) → `router.replace(pendingIntent.return_to)` | account detail with the result toast; no +not-found flash | IT-OAUTH-*, E2E-M-03 | ☐ |
| M-SET-20 | **Category toggles** | toggle | PATCH `notification_preferences` (auto-save) | persisted across devices | E2E-S-10 | ☐ |
| M-SET-20 | "Ayarları Aç" / "Bildirimlere İzin Ver" | tap | `Linking.openSettings()` / channels (R-12) then `requestPermissionsAsync()` → register token | permission banner updates | E2E-S-10 | ☐ |
| M-SET-20 | PRO-locked row | tap | M-GATE-02(`midday`/`evening`/`follow_up`) | gate | E2E-S-10 | ☐ |
| M-SET-20 | Detail radio (full / title_only / generic) | tap | PATCH `detail_level` + preview re-render | lock-screen preview updated | TST-E2E-M-04 | ☐ |
| M-SET-20 | "Test bildirimi gönder" | tap | `POST /notifications/test {category:'critical_email'}` (rate-limited) | toast "Test bildirimi gönderildi. …"; push arrives | E2E-S-10 | ☐ |
| M-SET-20 | Android lock-screen toggle / quiet hours row | toggle | F-05 channel-set swap (visibility PRIVATE by default, R-12) / M-SET-21 | as labelled | E2E-S-10 | ☐ |
| M-SET-21 | **"Kaydet"** | tap | PATCH quiet-hours columns (default 22:30–07:30, VIP bypass, R-13) | row "22:30–07:30" | E2E-S-10 | ☐ |
| M-SET-21 | "Vazgeç" | tap | discard | unchanged | E2E-S-10 | ☐ |
| M-SET-23 | **Toggles and time chips** | toggle | PATCH briefing columns (auto-save) | next briefing uses the new schedule | E2E-S-10 | ☐ |
| M-SET-23 | TimeChip / locked row / timezone | tap | M-SET-24 / M-GATE-02 (`source=briefing_settings`) / M-SET-25 | target | E2E-S-10 | ☐ |
| M-SET-24 | **"Tamam"** / "Vazgeç" | tap | save `HH:mm` / discard | chip updated / unchanged | E2E-S-10 | ☐ |
| M-SET-25 | **Timezone row** | tap | PATCH `user_preferences.timezone` (+ auto/manual mode) and close | scheduled jobs use the new tz | E2E-S-10 | ☐ |
| M-SET-30 | Rows: Yönet / Hesap bağla / İzinler / AI'ın eriştiği veriler / Veri saklama / AI kişiselleştirme | tap | M-SET-12 / M-SET-11 / M-SET-31 / M-SET-32 / M-SET-34 / M-SET-45 | target | privacy/center, E2E-M-19 | ☐ |
| M-SET-30 | Dışa aktar / Geçmişi sil / Hesabımı sil / Gizlilik Politikası | tap | M-SET-38 / M-SET-36 / M-SET-39 / `openBrowserAsync('<web>/privacy')` | target | privacy/center | ☐ |
| M-SET-31 | **Permission row** | tap | undetermined → explanation sheet → `request…PermissionsAsync()`; denied → `Linking.openSettings()`; Android NI → M-ANI-01 | permission state refreshed | TST-E2E-M-03 | ☐ |
| M-SET-31 | "Yönet" | tap | M-SET-12 | account detail | E2E-M-19 | ☐ |
| M-SET-32 | **Data-class toggle** | toggle | off → M-SET-33 first; on → PATCH directly | server enforces (SEC §4.4) | TST-E2E-M-03 | ☐ |
| M-SET-32 | Account rows | tap | M-SET-12 | account detail | E2E-M-19 | ☐ |
| M-SET-33 | **"Kapat"** / "Vazgeç" | tap | PATCH `user_preferences.ai_data_access` / toggle stays on | source off / unchanged | TST-E2E-M-03 | ☐ |
| M-SET-34 | **Retention segment** (30 / 90 / 365 / until deleted) | tap | shorten → M-SET-35; lengthen → PATCH `retention_policy` | persisted | E2E-M-19 | ☐ |
| M-SET-34 | Rows | tap | M-SET-38 / M-SET-36 / M-SET-39 | target | E2E-M-19 | ☐ |
| M-SET-35 | **"Süreyi Kısalt"** / "Vazgeç" | tap | PATCH `retention_policy` (counts from `history_deletion_preview`) → `retention` job / segment reverts | toast + cleanup scheduled / unchanged | E2E-M-19 | ☐ |
| M-SET-36 | **"Analiz geçmişini sil"** / failed "Tekrar dene" | tap | M-SET-37 | confirmation sheet | privacy/delete-history | ☐ |
| M-SET-37 | **"Geçmişi Sil"** | tap | re-auth (M-SET-40, R-16) → `POST /privacy/delete-history` → 202 | M-SET-36 shows processing; completion only after the job finishes | privacy/delete-history, IT-PRIV-03 | ☐ |
| M-SET-37 | "Vazgeç" / drag | tap | dismiss | unchanged | privacy/delete-history | ☐ |
| M-SET-38 | **"Dışa aktarma talebi oluştur"** | tap | `POST /privacy/export` → `export` job | status row "Hazırlanıyor" → "Hazır" | privacy/export, IT-PRIV-02 | ☐ |
| M-SET-38 | "İndir" | tap | fresh signed URL (300 s) → download → system share/save | zip saved (no tokens/secrets) | privacy/export | ☐ |
| M-SET-39 | **"Hesabımı Kalıcı Olarak Sil"** | tap | re-auth → `POST /privacy/delete-account` → 202 → `Purchases.logOut()`, NI `disable()`, cancel local notifications, widget `{auth:'signed_out'}`, wipe → poll → sign-in | honest status; no fake "deleted" | privacy/delete-account, TST-E2E-M-02 | ☐ |
| M-SET-39 | "Vazgeç" / "Aboneliği Yönet" / Microsoft links | tap | back / store management / browser | as labelled | TST-E2E-M-02 | ☐ |
| M-SET-40 | **Provider button / "Doğrula"** | tap | provider re-auth or email OTP `verifyOtp` | continuation proceeds | TST-E2E-M-02 | ☐ |
| M-SET-40 | "Vazgeç" / "Kodu tekrar gönder" (after 60 s) | tap | cancel / resend OTP | as labelled | TST-E2E-M-02 | ☐ |
| M-SET-45 | **Row toggle** | toggle | PATCH `learned_preferences.enabled` (owner grant, R-24) | preference disabled/enabled | E2E-S-12 | ☐ |
| M-SET-45 | `edit` / `delete` | tap | M-SET-46 / soft delete (`deleted_at`) + "Tercih silindi · Geri al" | editor / removed with undo | E2E-S-12 | ☐ |
| M-SET-45 | Learn toggle / footer link | toggle | PATCH "Etkileşimlerimden öğren" / M-SET-50 | persisted / rules | E2E-S-12 | ☐ |
| M-SET-46 | **"Kaydet"** / "Vazgeç" | tap | PATCH `learned_preferences.params` (e.g. priority High/Normal/Low; grant patched) / discard | row updated | E2E-S-12 | ☐ |
| M-SET-50 | **"Kural Ekle"** | tap | `/settings/priority-rules/new` | rule editor | settings/priority-rule-crud, E2E-S-11 | ☐ |
| M-SET-50 | Row / toggle / footer link | tap | `/settings/priority-rules/{id}` / PATCH `enabled` (trigger enqueues `insight_refresh`) / M-SET-45 | editor / re-ranked insights / personalization | E2E-S-11 | ☐ |
| M-SET-51 | **Save** | tap | insert or PATCH `priority_rules` | pop + toast "Kural kaydedildi" | E2E-S-11 | ☐ |
| M-SET-51 | Chips / suggestion fill / exceptions / delete / dirty back | tap | local edit / M-SET-52 / M-SET-53 / dialog "Değişiklikler kaydedilmesin mi?" | as labelled | E2E-S-11 | ☐ |
| M-SET-52 | **"Tamam"** / remove token | tap | apply exceptions / remove | editor updated | E2E-S-11 | ☐ |
| M-SET-53 | **"Kuralı Sil"** | tap | PATCH soft delete → pop | toast + "Geri al" (5 s; 10 s with a screen reader) | E2E-S-11 | ☐ |
| M-SET-54 | **"Tamam"** | tap | dismiss precedence sheet | closed | E2E-S-11 | ☐ |
| M-SET-60 | **Tile** (Sistem / Açık / Koyu) | tap | PATCH appearance; applies instantly | whole app re-themes, no restart | settings/dark-mode, E2E-I | ☐ |
| M-SET-60 | Rows (text size) | tap | M-SET-61 | text-size sheet | E2E-M-18 | ☐ |
| M-SET-61 | **Size option** / "Tamam" | tap | applies immediately / close | text scales | E2E-M-18 | ☐ |
| M-SET-62 | **Language radio** | tap | switch UI → PATCH `profiles.locale` → re-register device → rename Android channels → rewrite widget snapshot | UI in the chosen language everywhere | E2E-S-15 | ☐ |
| M-SET-62 | Timezone row | tap | M-SET-25 | timezone sheet | E2E-S-15 | ☐ |
| M-SUB-01 | **"Pro'ya Geç"** (Free) | tap | `/paywall?source=subscription_screen` | paywall | subscription/restore | ☐ |
| M-SUB-01 | "Aboneliği Yönet" / "Planı değiştir" / "Satın alımları geri yükle" | tap | `showManageSubscriptions()` (fallback `managementURL`) / `/paywall?mode=change` / F-07 restore → `POST /purchases/sync` | store sheet / paywall / entitlement restored | E2E-M-16, REL-11 | ☐ |
| M-PAY-01 | **Purchase** | tap | `purchasePackage` → `POST /purchases/sync` → poll `GET /me/entitlements` (1 s, ≤10 s) | "Pro etkin" + "Devam" resumes `pendingIntent` | purchase-test-store, E2E-M-16 | ☐ |
| M-PAY-01 | Plan card / "Satın alımı geri yükle" / close or "Free ile devam et" / legal links | tap | select / F-07 / dismiss + `paywall_dismissed` / `openBrowserAsync(terms/privacy)` | as labelled | E2E-M-16 | ☐ |
| M-GATE-01 | **Card CTA** | tap | `/paywall?source=gate_{id}` | on success the host reveals the feature | E2E-M-16 | ☐ |
| M-GATE-01 | "Şimdi değil" | tap | PATCH `dismissed_gates[id] = now + 7 d` | card collapses (cross-device) | E2E-M-16 | ☐ |
| M-GATE-02 | **CTA** / "Şimdi değil" | tap | `/paywall?source=gate_{id}` / close (intent cleared, no suppression) | paywall / closed | E2E-M-16 | ☐ |
| M-REF-01 | **"Davet Gönder"** | tap | `Share.share({message, url})` with `/r/{code}` from `GET /referrals/me` | system share sheet | referral/share, E2E-M-17 | ☐ |
| M-REF-01 | "Kopyala" / "Davet kodun var mı?" | tap | `setStringAsync(link)` / M-REF-02 | toast "Bağlantı kopyalandı" / code sheet | E2E-M-17 | ☐ |
| M-REF-02 | **"Kodu Uygula"** / "Vazgeç" | tap | `POST /referrals/apply` / dismiss | toast "Davet kodu eklendi. İlk brifinginden sonra ikiniz de 14 gün Pro kazanacaksınız." | E2E-M-17 | ☐ |
| M-ANI-01 | **"Bildirim Erişimini Aç"** | tap | M-ANI-02 (first time) or `openSettings()` → re-check (F-06) | status row updated | E2E-S-17, REL-20 | ☐ |
| M-ANI-01 | Enable toggle / mode / category (Free → M-GATE-02(`android_ni`)) | toggle | `setEnabled` / `setMode` / `setAllowedPackages` + report via `POST /devices/register` | native module updated | E2E-S-17 | ☐ |
| M-ANI-01 | Signal delete / "Tümünü sil" | tap | `deleteSignal` + PostgREST delete own `android_notification_signals` (grant patched) / confirm → `clearBuffer()` + delete all own rows | rows removed | E2E-S-17 | ☐ |
| M-ANI-02 | **Accept** / "Vazgeç" | tap | store disclosure timestamp → `openSettings()` / dismiss | system listener settings | E2E-S-17 | ☐ |
| M-ANI-03 | **"Tamam"** / importance segment | tap | apply package selection / rule write (Normal = soft delete) | selection saved | E2E-S-17 | ☐ |
| M-ANI-04 | **"Tamam"** | tap | dismiss always-excluded sheet (read-only list) | closed | E2E-S-17 | ☐ |
| M-SET-70 | **FAQ rows** (Sık sorulan sorular / Başlarken / Entegrasyonlar / Gizlilik) | tap | expand accordion (shared `faq.*` catalog) | answer visible | help-feedback, E2E-S-16 | ☐ |
| M-SET-70 | "Destek ile iletişime geç" | tap | M-SET-71 | contact sheet | E2E-S-16 | ☐ |
| M-SET-71 | **Submit** (category + message 20–2000; platform/app version attached) | tap | `POST /support/tickets` (offline blocked) | toast with the ticket reference | E2E-S-16 | ☐ |
| M-SET-71 | "Vazgeç" | tap | dismiss | closed | E2E-S-16 | ☐ |
| M-SET-72 | **"Gönder"** (Hata / Özellik isteği / Genel / AI Kalitesi; rating 1–5; comment ≤2000) | tap | `POST /feedback` | toast "Teşekkürler" | E2E-S-16 | ☐ |
| M-SET-72 | "Uygulamayı değerlendir" | tap | `expo-store-review` `requestReview()` (no gating) | OS review prompt | E2E-S-16 | ☐ |
| M-SET-73 | "Kullanım Koşulları" / "Gizlilik" | tap | `WebBrowser.openBrowserAsync` | in-app browser | E2E-S-16 | ☐ |
| M-SET-73 | "Lisanslar" / "Tanılama kimliği" | tap | M-SET-74 / copy `correlation_id` | licenses / copied toast | E2E-S-16 | ☐ |
| M-SET-74 | Close | tap | dismiss licenses sheet | closed | E2E-S-16 | ☐ |
| M-WGT-01 | iOS small "Sıradaki önemli şey" | tap | `dijitalasistan://…?src=widget&w=small` (item or `today`) | app opens the target; `widget_tapped{family}` | UT-WID-01, REL-13 | ☐ |
| M-WGT-02 | iOS medium "Bugün · {n} öncelik" | tap | `dijitalasistan://today?src=widget&w=medium` | Today | REL-13 | ☐ |
| M-WGT-03 | iOS large rows: Brifing / Sıradaki etkinlik / Açık takipler | tap | `briefing/{id}` / `event/{id}` / `followups` | target screen | REL-13 | ☐ |
| M-WGT-04 | Lock screen inline | tap | `today` | Today | REL-13 | ☐ |
| M-WGT-05 | Lock screen circular (count) | tap | `today` | Today | REL-13 | ☐ |
| M-WGT-06 | Lock screen rectangular (next event time) | tap | `event/{id}` or `today` | target | REL-13 | ☐ |
| M-WGT-07 | Android 2×2 NextWidget | tap | `event/{id}` or `today` | target | REL-13, CT-09 | ☐ |
| M-WGT-08 | Android 4×2 BriefingWidget | tap | `briefing/{id}` | briefing | REL-13, CT-09 | ☐ |
| M-WGT-01…08 | Content in `generic` detail mode | — | `GET /widgets/snapshot` honours `detail_level` (counts only) | no names/subjects shown | UT-WID-01 | ☐ |
| M-STATE-01 | Offline banner "Yenile" | tap | refetch | banner clears when online | E2E-M-20 | ☐ |
| M-STATE-02 | Reauth card "Yeniden Bağlan" / "Sonra" | tap | `/integrations/:accountId/upgrade` → `/integrations/oauth/complete` / hide until next session | status `healthy` / hidden | E2E-S-18 | ☐ |
| M-STATE-03 | Sync delayed "Şimdi Dene" / "Tamam" | tap | `POST /integrations/:accountId/sync` / dismiss | fresh timestamp / hidden | E2E-S-18 | ☐ |
| M-STATE-04 | AI unavailable "Tekrar Dene" / "Brifinge Dön" | tap | refetch / `briefing/{id}` | answer / briefing | E2E-S-18 | ☐ |
| M-STATE-05 | "Harici kimlik bilgisi gerekli" | — | not clickable (status text; the dependent CTA is hidden) | — | E2E-S-18 | ☐ |
| M-STATE-06 | Update required "Güncelle" | tap | store URL (as M-GL-12) | store | UpdateRequired.test | ☐ |
| M-STATE-07 | Empty, no account: "Hesap Bağla" | tap | `settings/accounts` | Connected Accounts | E2E-S-18 | ☐ |
| M-STATE-08 | Partial data banner | — | not clickable (informational; sections hidden per M-TD-01) | — | E2E-S-18 | ☐ |
| M-STATE-09 | OS permission denied "İzin Ver" / "Neden gerekli?" | tap | `Linking.openSettings()` / explainer sheet | permission refreshed / sheet | E2E-S-18 | ☐ |
| M-STATE-10 | AI quota exhausted: "Pro'yu Gör" (Free) / "Tamam" | tap | `paywall?source=ai_quota` / dismiss | paywall / hidden | E2E-S-18 | ☐ |
| M-STATE-11 | Rate limited "Tamam" (auto-retry after `Retry-After`) | tap | dismiss | retried automatically | E2E-S-18 | ☐ |
| M-STATE-12 | Generic error "Tekrar Dene" / "Bugün'e Dön" | tap | retry / Today | recovered | E2E-S-18 | ☐ |

### 4.6 Part 5: public web

| Screen | Element | Action | Target (route / RPC / navigation) | Success state | Test ID | PASS/FAIL |
|---|---|---|---|---|---|---|
| W-HOME-01 | **Header "Ücretsiz Başla"** | link | `/get?src=header` | 302 to the right store or `/#download` | WEB-E2E-02 | ☐ |
| W-HOME-01 | Store badges | link | App Store / Play URLs (same tab) | store page | WEB-E2E-02 | ☐ |
| W-HOME-01 | QR (≥1200 inline; 768–1199 "QR ile indir" `<dialog>`) | tap | QR encodes `/get?src=qr_*`; dialog traps focus, `Esc` closes | dialog / QR visible | WEB-E2E-11 | ☐ |
| W-HOME-01 | Nav anchors | link | section anchor; heading focused; hash updated | section in view | WEB-E2E-11 | ☐ |
| W-HOME-01 | Locale switch | link | `/en` (or `/`) at the same anchor | English page | WEB-E2E-15 | ☐ |
| W-HOME-01 | Pricing link / FAQ link / Google "Ayrıntılar" | link | `/pricing` / FAQ / `/privacy#google` | target page | WEB-E2E-01 | ☐ |
| W-HOME-01 | FAQ `<details>` | tap | toggle | answer visible | WEB-E2E-01 | ☐ |
| W-HOME-01 | Footer mailto / Smart App Banner | link | mail client / OS-native "Aç/Görüntüle" | external | WEB-E2E-01 | ☐ |
| W-PRICE-01 | **Period toggle** | tap | client-side price switch; `web_pricing_period` | price line changes (from `GET /plans`) | WEB-E2E-03 | ☐ |
| W-PRICE-01 | "Ücretsiz Başla" / "Uygulamada Pro'ya geç" / badges / QR | link | `/get?src=pricing_*` / store handoff | store | WEB-E2E-03 | ☐ |
| W-PRICE-01 | FAQ `<details>` | tap | toggle | answer visible | WEB-E2E-03 | ☐ |
| W-LEGAL-01 | **TOC links** / "Başa dön" | link | anchor + focus / `#top` | section focused | WEB-E2E-04 | ☐ |
| W-LEGAL-01 | External policy links / mailto / "Veri silme sayfasına git" | link | same tab `rel="noopener"` / mail client / `/data-deletion` | target | WEB-E2E-04 | ☐ |
| W-LEGAL-02 | **TOC anchors**; links to `/pricing`, `/privacy`, `/data-deletion`; store subscription management URLs | link | target pages / Apple & Play account subscriptions | target | WEB-E2E-04 | ☐ |
| W-SUP-01 | **Contact form submit** | submit | public-api `POST /support` → `support_tickets` | success panel (focus on heading) or field errors | WEB-E2E-05 | ☐ |
| W-SUP-01 | Category chips / FAQ `#faq-*` deep links / "Yeni talep oluştur" / mailto / privacy hint | tap | scroll / open matching `<details>` / reset form / mail client / `/data-deletion` | as labelled | WEB-E2E-05 | ☐ |
| W-DEL-01 | **"Kod gönder"** | submit | `signInWithOtp({shouldCreateUser:false})` (in-memory session) | `code` state (anti-enumeration copy) | WEB-E2E-06 | ☐ |
| W-DEL-01 | "Doğrula" / "Kodu tekrar gönder" (60 s) / "E-posta adresini değiştir" | submit | `verifyOtp` → preflight endpoint (R-24) / resend / back to `email` | `choose` or existing `status` | WEB-E2E-06 | ☐ |
| W-DEL-01 | "Devam" (account or history) / "Vazgeç" | tap | `confirm` / clear session → `email` | confirm step / reset | WEB-E2E-06 | ☐ |
| W-DEL-01 | Destructive "Hesabımı sil" / "Geçmişimi sil" (typed SİL/DELETE) | submit | public-api data-deletion request endpoint (R-24) → `data_deletion_requests` → job | 202 → `status`; no success state without 202 | WEB-E2E-06, REL-12 | ☐ |
| W-DEL-01 | Subscription / Microsoft links / support link | link | external handoffs / `/support?category=privacy#contact` | target | WEB-E2E-06 | ☐ |
| W-REF-01 | **Store badges** (Play URL carries `referrer=da_ref%3D{CODE}`) | link | store | store page | WEB-E2E-07 | ☐ |
| W-REF-01 | QR (≥768) / Android "Uygulamada aç" | tap | QR of `/r/{CODE}` / intent to `settings/referral?code={CODE}` with Play fallback | app opens with code / store | WEB-E2E-07 | ☐ |
| W-OAUTH-01 | **Open-in-app button** | link | callback URL rebuilt from validated params only | app handles `integrations/callback` | WEB-E2E-08 | ☐ |
| W-APP-01 | **"Uygulamada aç"** / badges / QR | link | intent `dijitalasistan://{path}` (Play fallback) / stores / same URL QR | app opens the path | app-link.spec | ☐ |
| W-GET-01 | `/get?src=` (route handler, no UI) | auto | 302 by UA (iOS → App Store, Android → Play, desktop → `/#download`) | correct `Location` | WEB-E2E-02 | ☐ |
| W-SYS-01…07 | System routes (AASA, assetlinks, sitemap, robots, OG images, security.txt, manifest) | auto | served JSON/XML/PNG with correct content types | 200, no redirect | WEB-E2E-09, WEB-E2E-12 | ☐ |
| W-ERR-01 | **"Ana sayfaya dön"** | link | `/` (HTTP 404, `noindex`) | home | WEB-E2E-16 | ☐ |
| W-ERR-02 | **"Tekrar dene"** / "Ana sayfa" | tap | `reset()` / `/` | page recovers / home | WEB-E2E-16 | ☐ |

### 4.7 Backoffice routes

| Route | Element | Action | Target (admin-api / navigation) | Success state | Test ID | PASS/FAIL |
|---|---|---|---|---|---|---|
| `/login` | **"Kod gönder"** → code input | submit | Supabase Auth email one-time code (R-08; no password) | `/mfa` | BO-E2E-01 | ☐ |
| `/mfa` | **TOTP code** / enrol (first login) / recovery code | submit | MFA verify → `aal2`; `admin_sessions` row | `/dashboard`; lockout after the threshold | BO-E2E-01, BO-E2E-02, BO-E2E-04 | ☐ |
| `/invite` | **Accept invite** → OTP + TOTP enrolment | submit | invite token → `admin_users` active | first login | BO-E2E-03 | ☐ |
| topbar | "Çıkış yap" / "Tüm oturumlardan çık" | tap | confirmation → end session / revoke all | `/login` | BO-E2E-06 | ☐ |
| `/dashboard` | **Range / platform** | tap | `PATCH /preferences` (`dashboard_range`) → KPIs | charts re-query | BO-E2E-09 | ☐ |
| `/users` | **Row** / filters / search / column visibility | tap | `/users/[id]/overview` / server-side query | detail / filtered page | BO-E2E-10 | ☐ |
| `/users/[id]/overview` | **"Senkronu başlat…"** (reason) | tap | `POST /users/:id/force-sync` | jobs enqueued; audit row | BO-E2E-12 | ☐ |
| `/users/[id]/overview` | "Hesabı devre dışı bırak" / "Geri yükle" (reason, confirm) | tap | `POST /users/:id/disable` / `restore` | status updated; audit | BO-E2E-12 | ☐ |
| `/users/[id]/overview` | "Göster" (masked PII) | tap | reveal with reason (`users.pii.reveal`) | value visible; reveal audited | BO-E2E-11 | ☐ |
| `/users/[id]/integrations` | "Senkronu başlat" / "Watch'ı yenile" / "Bağlantıyı kes…" | tap | force sync / `integration_renew_watch` / disconnect (SU) | job queued / status `disconnected`; user notified | BO-E2E-13 | ☐ |
| `/users/[id]/briefings` | "Yeniden oluştur" (today failed/skipped) | tap | `POST /briefings/:id/regenerate` | `briefing` job queued | BO-E2E-16 | ☐ |
| `/users/[id]/subscription` | "Geçici Pro tanımla" (1/7/14/30 d, reason) / "Geri al" / "Aboneliği yeniden eşitle" | tap | grant / revoke / `POST /subscriptions/:userId/sync` | effective entitlement changes; audit | BO-E2E-21, BO-E2E-22 | ☐ |
| `/users/[id]/referrals` | Approve / reject flagged | tap | `POST /referrals/:id/approve` / `POST /referrals/:id/reject` | status updated; credits idempotent | BO-E2E-23 | ☐ |
| `/users/[id]/support` | "Destek erişimi iste…" / "Erişimi sonlandır" | tap | Support Access grant (scope per R-09, 15/30/60 min, reason) / end grant | grant active / ended; audited | BO-E2E-24 | ☐ |
| `/users/[id]/audit` | Row | tap | detail sheet (read-only) | detail | BO-E2E-29 | ☐ |
| `/support`, `/support/[id]` | **Status / category / assignee** | tap | `PATCH /support/tickets/:id` | updated | BO-E2E-24 | ☐ |
| `/support/[id]` | "Not ekle" / "Yanıtla" | submit | `POST /support/tickets/:id/notes {internal / outbound_reply}` | note saved / email sent → `waiting_user` | BO-E2E-24 | ☐ |
| `/integrations` | Force sync / renew watch / disconnect | tap | as user integrations tab | as above | BO-E2E-13 | ☐ |
| `/jobs`, `/jobs/[id]` | **"Tekrar dene"** / bulk retry / "İptal et" / correlation trace | tap | `POST /jobs/:id/retry` / `POST /jobs/retry-bulk` / `POST /jobs/:id/cancel` / trace view | job `queued` or reason shown / `failed` | BO-E2E-14, BO-E2E-15 | ☐ |
| `/briefings` | "Yeniden oluştur" | tap | `POST /briefings/:id/regenerate` | job queued | BO-E2E-16 | ☐ |
| `/notifications` | "Test bildirimi gönder" (reason) | tap | `POST /notifications/test-push` (generic, never bypasses quiet hours, R-13) | ticket then receipt shown | BO-E2E-17 | ☐ |
| `/ai` | Filters (range / feature / model / provider / plan) | tap | aggregates re-query | charts update | BO-E2E-18 | ☐ |
| `/ai/models` | **"Kaydet"** (provider, model, fallback, routing profile per plan, reason) / "Test et" | submit | `PATCH /ai/models/:profile/:feature` (Voyage 1024-d validation) / `POST /ai/models/:profile/:feature/test` | config saved + audit / probe result | BO-E2E-18 | ☐ |
| `/ai/prompts/[key]` | Draft / edit / test / **activate** / rollback / archive | tap | `POST …/versions`, `PATCH …`, `…/test`, `…/activate` (lint gate; `ai-eval` green), `POST /ai/prompts/:key/rollback`, `…/archive` | one active version per key; audit | BO-E2E-19 | ☐ |
| `/ai/feedback` | Group / reveal comment | tap | re-query / `POST /ai/feedback/:id/reveal` | reveal audited | BO-E2E-20 | ☐ |
| `/subscriptions` | Tabs / row menu resync | tap | re-query / resync | job queued | BO-E2E-21 | ☐ |
| `/referrals` | Review flagged | tap | `POST /referrals/:id/approve` / `POST /referrals/:id/reject` | status updated | BO-E2E-23 | ☐ |
| `/feedback` | Status / assignee / reveal | tap | `PATCH /feedback/:id` / `POST /feedback/:id/reveal` | updated / audited | BO-E2E-25 | ☐ |
| `/flags` | Create / targeting / **kill switch** (typed key) / overrides / archive | tap | `POST /flags`, `PATCH /flags/:key`, `POST /flags/:key/kill`, `…/overrides`, archive | flag state; audit | BO-E2E-26 | ☐ |
| `/announcements` | Create/update draft / "Şimdi yayınla" / schedule / cancel / preview | tap | editor → `…/schedule` / `…/cancel` | banner visible on Today in target app versions | BO-E2E-27 | ☐ |
| `/data-requests` | Retry / regenerate export | tap | `POST /data-requests/:kind/:id/retry` / `POST /data-requests/export/:id/regenerate` | job resumes; admin never sees the file | BO-E2E-28 | ☐ |
| `/audit` | Row | tap | detail sheet (no edit/delete path) | detail | BO-E2E-29 | ☐ |
| `/health` | **"Şimdi çalıştır"** (1/min) / tabs probes/versions/cron | tap | `health` run / re-query | real probe results; `not_configured` when a credential is missing | BO-E2E-30 | ☐ |
| `/admins` | Invite / resend / role / disable / enable / MFA reset / revoke sessions / unlock | tap | `admins.manage` endpoints | state updated; last super_admin protected | BO-E2E-31 | ☐ |
| `/settings` | Theme / language / timezone / density; security (backup factor, recovery codes, sessions); system settings + `plan_limits` (SU) | tap | preferences persist / security actions / settings with bounds | persisted; `plan_limits` audited | BO-E2E-32 | ☐ |
| ⌘K palette | Entity lookup / action commands / "Tema" / "Çıkış yap" | key | navigate to entity; actions open the ConfirmDialog (`?action=`); never mutate directly | target page | BO-E2E-33 | ☐ |
| all tables | Pagination / sort / filter / column visibility / retry | tap | server-side query | correct page; loading/empty/error states | BO-E2E-10, BO-E2E-35 | ☐ |

---

## 5. Quality gate (M§133 + R-17)

### 5.1 Where it runs

| Place | Job / command | Needs | Output |
|---|---|---|---|
| CI `.github/workflows/ci.yml` | `quality-gate` → `pnpm quality-gate` (`node scripts/quality-gate/run.mjs`, ripgrep `--pcre2` + ESLint `da/*` AST rules); runs `run.mjs --self-test` first | `lint`, `db` (exports `rls-report.json`), `secret-scan` | `quality-gate.json` (`{id, file, line, match}`) |
| CI | `secret-scan` → gitleaks over full history + `scripts/security/bundle-scan.mjs` | `build-web`, `build-backoffice`, `mobile-checks` (exported bundles and source maps) | scan report |
| CI | `db` → pgTAP incl. the RLS-forced assertion, `admin_api` aal2 suites and the Realtime publication check | `install` | TAP, `rls-report.json` |
| CI | `mobile-checks` / `mobile-native-ios` | `install` | Android manifest assertions, `plutil -lint`, privacy-manifest assertions |
| Local / container | `pnpm quality-gate`, `pnpm secret-scan` | built outputs | same files |

**Global exclusions:** `docs/**`, `**/*.md`, `scripts/quality-gate/**`, `**/node_modules/**`, `**/generated/**`, `design/reference/**`, `**/*.snap`, `scripts/quality-gate/fixtures/**`.

**Regex notation.** Some regexes use character classes such as `TO[D]O`. This keeps the literal marker out of this document. The regex matches exactly the same strings.

### 5.2 Checks

| ID | Check (M§133 item) | Pattern / rule | Scope | Pass |
|---|---|---|---|---|
| QG-01 | Work markers | `\b(TO[D]O\|FIX[M]E\|X[X]X\|HA[C]K\|T[B]D)\b` | `apps/**`, `packages/**`, `supabase/**`, `scripts/**` | 0 |
| QG-01b | Deferral comments (M§100 "Later/Future" in the production path) | `(//\|/\*\|^\s*\*\|--\|^\s*#)\s*(?i:later\b\|in\s+the\s+future\|future\s+work\|ileride\|sonra\s+yap[ıi]lacak)` in comments only (ESLint `da/no-deferral-comment` + grep backstop). UI copy "Sonra", "Daha sonra" and "later" stay allowed (R-17). | code | 0 |
| QG-02 | Stub copy in code | `(?i)(lorem\s+ipsum\|coming\s+soon\|not\s+implemented\|place[h]older\s*(text\|data\|content)?\|dummy\s+data)` in string literals and JSX text (ESLint `da/no-banned-copy`). JSX attribute names such as the TextInput hint prop are not string literals and are excluded; their values must be i18n keys (QG-15). | `apps/**/{app,src}/**`, `packages/ui/src/**` | 0 |
| QG-03 | Banned copy in catalogs (EN) | `(?i)\b(coming\s+soon\|not\s+implemented\|place[h]older\|lorem\s+ipsum\|T[B]D\|future\s+(release\|version\|update))\b` over JSON values. "later" is not banned (R-17). | `packages/i18n/**/*.json`, `apps/web/content/**` | 0 |
| QG-04 | Banned copy in catalogs (TR) | `(?i)(yak[ıIiİ]nda\|[çc]ok\s+yak[ıIiİ]nda\|sonraki\s+s[üu]r[üu]m\|ileride\s+eklenecek\|gelecek\s+s[üu]r[üu]mde)` | same | 0 |
| QG-05 | Empty onPress / onClick | ESLint `da/no-empty-handler` + grep `on(Press\|Click\|LongPress\|Submit\|Change\|ValueChange)\s*=\s*\{\s*(\(\s*\)\s*=>\s*(\{\s*\}\|null\|undefined\|void\s+0)\|noop\|\(\)\s*=>\s*console\.)\s*\}` | `apps/**`, `packages/ui/**` | 0 |
| QG-06 | Banned claims (M§40, M§141) | `(?i)(u[çc]tan\s+uca\s+[şs]ifrel\|end[-\s]to[-\s]end\s+encrypt\|kredi\s+kart[ıi]\s+gerekmez\|no\s+credit\s+card\|KVKK\s+ve\s+GDPR\s+uyumlu\|reklamverenlere\s+sat\|cihaz[ıi]nda\s+[öo]zetlenir)`. `yaln[ıi]zca\s+cihaz[ıi]nda\s+i[şs]lenir` is allowed only under Android NI keys (R-15 copy). | catalogs, `apps/web/**` | 0 |
| QG-06b | "Unlimited" claims (R-17) | `(?i)(s[ıi]n[ıi]rs[ıi]z\|unlimited)` flagged unless the key/line is listed in `quality-gate.allow` (negated fair-use copy only, e.g. "Adil kullanım") | catalogs, `apps/**` | 0 unlisted |
| QG-07 | Fake success / fake async | grep `setTimeout\([^)]{0,200}\b(set(Success\|Done\|Sent\|Connected\|Status)\|toast\.success\|navigate)\b`; ESLint `da/no-timer-in-screens`; `Promise\.resolve\(\s*\{\s*(ok\|success)\s*:\s*true` outside tests; AST check that success UI follows a resolved mutation (`onSuccess`) | `apps/**` | 0 |
| QG-08 | Secrets in logs | `console\.(log\|info\|debug\|warn\|error)\([^)]*(?i:token\|secret\|password\|authorization\|cookie\|api[_-]?key\|refresh\|sb_secret)`; `\bconsole\.log\(` in production paths | `apps/**`, `packages/**`, `supabase/functions/**` | 0 |
| QG-09 | Service role / secret exposed client-side | source: `service_role\|sb_secret_\|SUPABASE_SECRET_KEY\|SUPABASE_SERVICE_ROLE_KEY\|TOKEN_ENC_KEY\|REVENUECAT_API_V2_SECRET_KEY\|WEBHOOK_HMAC_SECRET\|ADMIN_SESSION_SECRET` in `apps/**`. Bundles (`.next/static/**`, mobile export, source maps): `sb_secret_[A-Za-z0-9_-]{10,}`, `sk-ant-[A-Za-z0-9_-]{20,}`, `sk-(proj-)?[A-Za-z0-9_-]{20,}`, `\bsk_[A-Za-z0-9]{20,}`, `-----BEGIN (RSA \|EC \|)PRIVATE KEY-----`, JWT with payload `"role":"service_role"`, `AIza[0-9A-Za-z_-]{35}`. Allowed public prefixes: `sb_publishable_`, `appl_`, `goog_`, `test_`. | source + build outputs | 0 |
| QG-10 | Missing RLS | `rls-report.json` from `select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','admin_api') and (not c.relrowsecurity or not c.relforcerowsecurity)` must be empty; `scripts/db/rls-static-check.ts` (UT-RLS-02) | DB + `supabase/migrations/**` | empty |
| QG-11 | Skipped / focused tests | `\b(it\|test\|describe)\.(skip\|only\|todo)\(\|\bx(it\|describe)\(\|test\.fixme\(\|\.only\(` | `**/*.test.*`, `**/*.spec.*`, `apps/*/e2e/**` | 0 |
| QG-12 | Insecure token storage | `AsyncStorage\.(setItem\|getItem\|multiSet)\([^)]*(?i:token\|session\|auth\|refresh)`; any AsyncStorage import in `apps/mobile/src/lib/{auth,storage}/**` | `apps/mobile/**` | 0 |
| QG-13 | Fake provider / demo leakage | imports matching `/providers/demo/\|/fixtures/\|\bdemo(Adapter\|Data)\b` outside `supabase/functions/_shared/providers/demo/**`, `_shared/testing/**`, `supabase/seed/**`, tests; production build fails when `EXPO_PUBLIC_DEMO_MODE=true` without `ALLOW_DEMO_IN_PRODUCTION=true` | `apps/**`, `supabase/functions/**` | 0 |
| QG-14 | Hard-coded prices | `\b\d{1,3}(\.\d{3})*(,\d{2})?\s?(TL\|₺)\b\|₺\s?\d` | `apps/mobile/{app,src}/**`, `apps/web/app/**` | 0 |
| QG-15 | Hard-coded user-facing strings | ESLint `da/no-hardcoded-strings` (JSX text, `accessibilityLabel`, `title` and input-hint props must be i18n keys) | `apps/**`, `packages/ui/**` | 0 |
| QG-16 | Dead navigation / unreachable screen | `scripts/quality-gate/routes.mjs`: every `apps/mobile/app/**` route is referenced by `router.push`/`Link href`/deep-link map/notification router or is a tab root; typed routes make invalid hrefs a compile error; every route has a row in §4 and every §4 target resolves to a route, an API_CONTRACTS route/RPC or a declared local action | `apps/mobile/**`, this document | 0 |
| QG-17 | Migration portability | `JSON_TABLE\|MERGE\s+.*RETURNING\|transaction_timeout\|halfvec\|sparsevec\|hnsw\.iterative_scan`; `create extension` for `pg_net`/`pg_cron`/`vector` without `if not exists` | `supabase/migrations/**` | 0 |
| QG-18 | Unhandled async error | `@typescript-eslint/no-floating-promises` and `no-misused-promises` at error level; Hono handlers wrapped (`da/hono-handler-wrapped`) | all TS | 0 |
| QG-19 | Privileged client import | `scripts/security/system-client-gate.mjs` (`systemClient` only in allow-listed paths) | `supabase/functions/**` | 0 |
| QG-20 | `.env` hygiene | no tracked `.env*` except `.env.example`; `.env.example` values empty | repository | 0 |
| QG-21 | Remote imports in Deno | `https://(esm\.sh\|deno\.land/x\|unpkg\.com)` | `supabase/functions/**` | 0 |
| QG-22 | Ad/tracking SDKs | lockfile denylist (`@react-native-firebase/analytics`, `react-native-fbsdk*`, `@amplitude/*`, `appsflyer*`, `adjust*`) | `pnpm-lock.yaml` | 0 |
| QG-23 | Pinned CI actions | `scripts/security/actions-pinned.mjs` | `.github/workflows/**` | 0 |
| QG-24 | Prototype fakes | `Android Frame\|Tasarım Sistemi\|Widget Showcase\|App Store Görseller\|yunus@example\.com\|14 gün kaldı\|Çözüldü!` | `apps/mobile/**` | 0 |
| QG-25 | Realtime unused (R-19) | pgTAP: `select count(*) from pg_publication_tables where pubname='supabase_realtime'` = 0; grep `\.channel\(\|postgres_changes\|supabase\.realtime` | DB, `apps/**` | 0 |
| QG-26 | Analytics catalogue (R-21) | every tracked event name literal is in the generated `packages/domain/analytics/events.ts`; props match the SECURITY_AND_PRIVACY_PLAN rules | `apps/**`, `supabase/functions/**` | 0 |
| QG-27 | Canonical-name drift | `\bget_today\b\|device-result\|captures/:id/cancel\|\bperson_overview\b\|\bplan_timeline\b\|\bmail_digest\b\|vector\(1536\)\|\bonly_important\b\|\bgate_dismissals\b\|user_preferences\.locale\|android_ni_settings\|claude-fable-` | `apps/**`, `packages/**`, `supabase/**` | 0 |

### 5.3 Security gate

| ID | Gate | How it is checked | Where | Pass |
|---|---|---|---|---|
| SG-1 | No secret or service key in any client bundle | QG-09 over `apps/web/.next/**`, `apps/backoffice/.next/static/**`, `apps/mobile/dist/**` (expo export) and source maps. Env schemas (`packages/validation/src/env.ts`, `@t3-oss/env-nextjs`) fail the build when a public var matches a secret pattern. Mobile exposes only allow-listed `EXPO_PUBLIC_*`. | `secret-scan`, `build-*` | 0 findings |
| SG-2 | No secret in git history | gitleaks full history (TST-CI-01); `.gitignore` covers `.env*` (except `.env.example`), `*.p8`, `*.pem`, `google-services.json`, `GoogleService-Info.plist` | `secret-scan` | 0 findings |
| SG-3 | RLS enabled and forced everywhere | QG-10 + pgTAP "every table in `public`/`admin_api` has RLS forced". System tables (`jobs`, `oauth_credentials`, `oauth_states`, `webhook_events`, `billing_events`, `ai_requests`, `ai_result_cache`, `audit_logs`, `admin_*`, `support_*`, `system_health_checks`, `rate_limits`) have no `anon`/`authenticated` policies. Storage buckets `captures`, `exports`, `briefing-audio` use per-user folder policies. | `db` | all TAP ok; empty report |
| SG-4 | Admin requires `aal2` | pgTAP: every `admin_api` function rejects `aal1`, non-admin and inactive-admin JWTs (`private.require_admin(permission)`). EF-ADM-01: `admin-api` rejects `aal1`, a missing permission and a disabled admin. BO-E2E-01 (login + MFA), BO-E2E-36…45 security specs. `api`/`public-api` reject admin JWTs (R-08). | `db`, `functions`, `e2e-backoffice` | all green |
| SG-5 | Tokens stay server-side | EF-CRYPTO-01 (AES-256-GCM with AAD); pgTAP `oauth_credentials` invisible to `anon`/`authenticated`; QG-12 | `functions`, `db` | green |
| SG-6 | Webhook authenticity and replay | EF-WH-01…03 (Pub/Sub OIDC, channel HMAC, hashed clientState, RevenueCat secret, `webhook_events` dedupe) | `functions` | green |
| SG-7 | Headers, CSP and CSRF | WEB-E2E-14 (headers/CSP); BO-E2E-07 (CSRF, Origin check) | `e2e-web`, `e2e-backoffice` | green |
| SG-8 | Supply chain | QG-22, QG-23; nightly CodeQL, ZAP baseline, `pnpm audit` with allow-list expiry | `security-nightly` | green before a release tag |

### 5.4 Pass criteria

- `quality-gate.json` is empty.
- `run.mjs --self-test` reports exactly one finding per fixture.
- `rls-report.json` is empty.
- Bundle scan and gitleaks report zero findings.
- SG-1…SG-7 are green on every PR; SG-8 is green on the nightly run before any release tag.
- `quality-gate` is a required check for merge (GitHub branch protection, §8 GH1).
- A finding is fixed in the product code. A finding is never added to an allow-list unless it is a negated fair-use string (QG-06b).

---

## 6. Build / test / fix loop (M§134)

**One command:** `pnpm verify`. It runs the stages below in order and stops at the first failure.

Work through the loop like this:
1. Inspect the first failure.
2. Fix the root cause.
3. Rerun from the failed stage.
4. Push.
5. Inspect CI E2E artefacts (Playwright trace, Maestro recording, logcat, harness `/state` dumps).
6. Fix, rerun, then do the manual flow audit (§4).

A failing test never produces a question to the user.

| # | Stage | Command | Container | CI job | ☐ |
|---|---|---|---|---|---|
| 1 | install | `corepack enable && pnpm install --frozen-lockfile` (pnpm 11.27.1; respect `minimumReleaseAge`, use documented fallback pins) | ✅ | `install` | ☐ |
| 2 | lint | `pnpm lint` (`turbo run lint` + `prettier --check` + `deno lint`) | ✅ | `lint` | ☐ |
| 3 | typecheck | `pnpm typecheck` (`turbo run typecheck`, tsc ~6.0.3, `deno check`) | ✅ | `typecheck` | ☐ |
| 4 | unit | `pnpm test` / `pnpm test:coverage` (vitest 4.1.11, jest-expo 57, tier D) | ✅ | `unit` | ☐ |
| 5 | functions | `pnpm functions:test` (Deno 2.1.4; `npx --yes deno@2.1.4` in the container) | ✅ | `functions` | ☐ |
| 6 | database | container: `pnpm db:test:c` (tier C, PG16 + shim + pgTAP); CI: `pnpm db:test` (tier A, authoritative) | ✅ tier C | `db`, `db-shim`, `migrations` | ☐ |
| 7 | integration | `pnpm test:integration` (tier A; tier C+ with PostgREST binary where available) | ⚠️ | `integration` | ☐ |
| 8 | build | `pnpm build` (`next build` ×2); `pnpm mobile:check` (`expo install --check`, expo-doctor, `expo export`, prebuild smoke for all `APP_ENV`) | ✅ | `build-web`, `build-backoffice`, `mobile-checks` | ☐ |
| 9 | inspect → fix → rerun | rerun from the failed stage; record the root cause in the PR | ✅ | — | ☐ |
| 10 | E2E | `pnpm e2e:web`; `pnpm e2e:backoffice` (`--project bo-contract` in the container); `pnpm e2e:mobile -- android` / EAS iOS | ⚠️ web + bo-contract only | `e2e-web`, `e2e-backoffice`, `e2e-mobile-android`, `e2e-mobile-ios` | ☐ |
| 11 | inspect failures → fix → rerun | artefacts from the CI run | — | — | ☐ |
| 12 | quality gate and scans | `pnpm quality-gate`; `pnpm secret-scan` | ✅ | `quality-gate`, `secret-scan` | ☐ |
| 13 | manual flow audit | walk §4 in the TEST_PLAN §20 matrix; force every M§93 state | device / EAS preview | — | ☐ |

**Standard command sets per WBS task** (IMPLEMENTATION_PLAN B0):

| Set | Commands |
|---|---|
| `C-TS <pkg>` | `pnpm turbo run lint typecheck test --filter=<pkg>` |
| `C-GEN` | `pnpm generate && git diff --exit-code` |
| `C-DB` | `bash scripts/db/tier-c.sh` (container) / `bash scripts/db/tier-a.sh` (CI) |
| `C-FN` | `pnpm functions:imports && pnpm functions:check && pnpm functions:lint && pnpm functions:test` |
| `C-MOB` | `pnpm turbo run lint typecheck test --filter=@da/mobile --filter=@da/ui` |
| `C-MOB-SMOKE` | `EXPO_OFFLINE=1 pnpm --filter @da/mobile exec expo install --check`; `pnpm --filter @da/mobile exec expo export --platform ios,android --output-dir .expo-export`; `bash scripts/mobile/prebuild-smoke.sh` |
| `C-WEB` / `C-BO` | `pnpm turbo run lint typecheck test build --filter=@da/web` (or `@da/backoffice`) |
| `C-E2E` | `pnpm e2e:web` and/or `pnpm e2e:backoffice` |
| `C-GATE` | `pnpm quality-gate` |

**Flake policy (TEST_PLAN §17):**
- Unit, contract, pgTAP and integration tests run with zero retries.
- Playwright uses `retries: 1` in CI only, and `fail-on-flaky` still fails the run.
- Maestro runs with no retries.
- No skip or focus is allowed (QG-11), and there are no quarantine lists.
- Waits are state-based only (`extendedWaitUntil`, web-first assertions).

**Coverage gates (TEST_PLAN §16):**

| Area | Lines / branches / functions |
|---|---|
| `packages/domain` | 95 / 90 / 95 |
| `packages/validation` | 95 / 90 / 95 |
| `packages/design-tokens` | 100 / 95 / 100 |
| `packages/i18n` | 95 / 90 / 95 |
| `packages/api-client` | 85 / 75 / 85 |
| `packages/ui` | 85 / 75 / 85 |
| `apps/mobile` | 75 / 65 / 75 |
| web, backoffice | 80 / 70 / 80 |
| `_shared` | 90 / 85 / 90 |
| functions | 85 / 75 / 85 |

These must also hold at 100%:
- every table/RPC has pgTAP coverage;
- every §5b route has a contract test;
- every M§102/§103/§104 item and every A–J flow maps to a spec;
- every mobile route is visited by E2E or listed in §4 with its manual row.

**Milestone gate (IMPLEMENTATION_PLAN Part C).** Each milestone commit (M0…M12) requires the listed sets to be green. The branch is `claude/magical-pascal-edvjgn`. Push after each milestone and keep the draft PR open from M0.

---

## 7. Release checklist (M§153) and store checklist

### 7.1 Release checklist

Run from `.github/ISSUE_TEMPLATE/release-checklist.md`:
- on a freshly reset iOS device (TestFlight build) and an Android device (internal testing track);
- against the production Supabase project (staging for rehearsal);
- with real sandbox accounts.

Evidence per item: a screenshot or recording, the `correlation_id` (Hakkında → "Tanılama kimliği"), and the matching backoffice record. Store promotion is blocked until the issue is closed with evidence.

| # | M§153 item | REL | Environment | Pass criteria | Evidence | ☐ |
|---|---|---|---|---|---|---|
| 1 | Fresh install | REL-01 | TestFlight + Play internal | installs; splash has no timer navigation; welcome shows; no Sentry crash |  | ☐ |
| 2 | Sign in | REL-02 | production Auth | Apple (iOS native, Android web), Google native, Microsoft PKCE and email OTP each succeed; sign-out/in; "Tüm cihazlardan çıkış" revokes the second device |  | ☐ |
| 3 | Onboarding | REL-03 | production | M§34 order; explainer before each OAuth/OS prompt; First Analysis counters from real job progress |  | ☐ |
| 4 | Connect provider | REL-04 | sandbox Google/Microsoft/Apple accounts | Gmail (unverified-app state documented until CASA), Outlook personal + work tenant (admin consent observed), Google Calendar, Apple Calendar, Android device calendar, Google Tasks, To Do; `POST /integrations/oauth/complete` binds each account (R-07) |  | ☐ |
| 5 | First sync | REL-05 | production | Gmail push arrives within 1 min of a test mail; Graph notification arrives; backoffice shows jobs `completed` |  | ☐ |
| 6 | First briefing | REL-06 | production | morning briefing at the configured local time; audio with seek/speed; sources open |  | ☐ |
| 7 | Important insight | REL-07 | production | VIP test mail with "yarın 17:00'ye kadar" → ACİL card with grounded deadline; "Bu nereden çıktı?" opens the source |  | ☐ |
| 8 | Approval | REL-08 | production | reply draft → approval sheet with exact change and destination → approve (tap) |  | ☐ |
| 9 | Provider write | REL-09 | production + provider UIs | reply in Sent exactly once, correct threading; event created exactly once; Tasks/To Do item created; airplane-mode retry does not duplicate |  | ☐ |
| 10 | Notification | REL-10 | production push | `title_only` default; `full` and `generic` verified on the lock screen; quiet hours 22:30–07:30 defer (VIP bypass per R-13); tap opens the right route; iOS time-sensitive for a meeting ≤10 min |  | ☐ |
| 11 | Purchase / restore | REL-11 | store sandbox | monthly and annual purchase; trial only if configured; restore on a second device; "Aboneliği Yönet"; RevenueCat webhook reaches production and shows in the backoffice |  | ☐ |
| 12 | Deletion | REL-12 | production | history deletion; account deletion (Google revoke visible, SIWA revoke, Microsoft local-only guidance); web `/data-deletion`; Data Requests shows completion only after every step |  | ☐ |
| 13 | Widgets | REL-13 | devices | iOS S/M/L + lock screen, Android 2×2/4×2; privacy-safe in `generic`; deep links correct; refresh after a data change |  | ☐ |
| 14 | Share | REL-14 | devices | iOS text/URL/image/PDF; Android `ACTION_SEND`/`ACTION_SEND_MULTIPLE` land in capture |  | ☐ |
| 15 | Offline (iOS) | REL-15 | device | E2E-M-20 steps manually on iOS |  | ☐ |
| 16 | Voice | REL-16 | device | on-device tr-TR STT; a voice write shows the approval card; spoken "onayla" does not approve (R-03); "İptal" creates no approval |  | ☐ |
| 17 | Accessibility | REL-17 | devices | VoiceOver/TalkBack pass (A11Y-10); maximum Dynamic Type on Today, Email Detail, approval sheet, Paywall |  | ☐ |
| 18 | Store metadata | REL-18 | App Store Connect / Play Console | privacy labels / Data safety match SECURITY_AND_PRIVACY_PLAN §4.12–4.13; review notes attached |  | ☐ |
| 19 | Health | REL-19 | backoffice | every probe real; no `not_configured` for production-required credentials |  | ☐ |
| 20 | Android NI | REL-20 | Android Pro device | listener grant; default denylist excludes authenticators in "all apps"; OTP notification produces no signal; shipment produces a structured signal without raw text; disabling stops signals; restricted-settings flow documented |  | ☐ |

**Release gates (all required):**
- Every required PR check is green on `main`, and `e2e-mobile-ios` is green on `main`.
- `security-nightly` is green, and `ai-eval` is green for the active prompt versions.
- §5 has zero findings, and §4 is 100% PASS.
- The §9 report is updated with where each check ran.
- The release-checklist issue is closed with evidence.

### 7.2 Store checklist

The full content lives in `docs/STORE_CHECKLIST.md` (T-12.09). Each item below must be satisfied and evidenced there.

| # | Platform | Item | Source / value | Verification | ☐ |
|---|---|---|---|---|---|
| ST-01 | both | Identifiers | `com.dijitalasistan.app` (variants `.dev`/`.preview`/`.e2e`), scheme `dijitalasistan`, App Group `group.com.dijitalasistan.app`, extensions `.share-extension`, `.widget` | prebuild smoke; production build uses defaults | ☐ |
| ST-02 | both | EAS profiles | `development` (dev client, internal), `preview` (internal, channel `preview`), `e2e` (APK + iOS simulator, demo flag), `production` (auto-increment, channel `production`); `runtimeVersion` fingerprint; production fails with demo mode on | `eas build --profile preview` succeeds; config lint UT-ENV-08 | ☐ |
| ST-03 | both | App icon, adaptive icon, splash (bg `#F5F4F0`, dark `#141311`), notification icon (`#5B5CE2`) | T-8.01 assets | visual check + prebuild | ☐ |
| ST-04 | iOS | Permission strings (tr/en) | INTEGRATION_PLAN §12.8: `NSCalendarsFullAccessUsageDescription`, `NSRemindersFullAccessUsageDescription`, `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription`, `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSFaceIDUsageDescription`; no location, contacts or ATT | `plutil` + Info.plist assertions (TST-CI-06) | ☐ |
| ST-05 | Android | Permissions and rationale sheets | `POST_NOTIFICATIONS`, `READ_CALENDAR`, `WRITE_CALENDAR`, `RECORD_AUDIO`, `CAMERA`, `SCHEDULE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`; blocked media/location/contacts/`QUERY_ALL_PACKAGES`/`AD_ID`; `allowBackup:false` | manifest assertions (TST-CI-07) | ☐ |
| ST-06 | both | Notification permission rationale | pre-prompt "Sadece önemli olduğunda haber veririz." (R-14); channels created before the Android 13 prompt, all `PRIVATE` (R-12); time-sensitive justification (meetings ≤10 min) | E2E-M-01, REL-10 | ☐ |
| ST-07 | iOS | Privacy manifest | `NSPrivacyTracking=false`; reasons `CA92.1`, `1C8F.1` (App Group), `C617.1`, `35F9.1`, `E174.1`; widget manifest; third-party SDK manifests present | TST-CI-06 | ☐ |
| ST-08 | iOS | App Privacy labels | SECURITY_AND_PRIVACY_PLAN §4.12 table (tracking: No) | REL-18 | ☐ |
| ST-09 | Android | Data safety form | SECURITY_AND_PRIVACY_PLAN §4.13 (incl. NI structured signals; encrypted in transit; deletion in-app + `https://dijitalasistan.app/data-deletion`) | Play Console accepted (P2) | ☐ |
| ST-10 | iOS | Sign in with Apple | offered alongside Google/Microsoft login; `authorizationCode` exchanged and revoked at deletion | REL-02, REL-12 | ☐ |
| ST-11 | both | Account deletion | in-app M-SET-39 + web W-DEL-01; honest status, no fake "deleted" | REL-12, TST-E2E-M-02 | ☐ |
| ST-12 | iOS | Encryption export | `ITSAppUsesNonExemptEncryption=false` (standard encryption exemption) | Info.plist | ☐ |
| ST-13 | iOS | Background modes justification | `remote-notification`, `processing`, `audio` (briefing player) | review notes | ☐ |
| ST-14 | both | Subscriptions | group "Dijital Asistan Pro"; `da_pro_monthly`, `da_pro_annual` (Play base plans `monthly`, `annual`); paywall shows store `priceString`, period, restore, manage, Terms/Privacy links, close; trial copy only when the offer exists | E2E-M-16, REL-11 | ☐ |
| ST-15 | both | Referral reward disclosure | 14 days Pro for both sides after qualification; the promotional grant is described in the review notes and STORE_CHECKLIST (risk R10: guideline 3.1.1) | review notes | ☐ |
| ST-16 | Android | Notification Listener | prominent disclosure (M-ANI-02) before settings; Play permission declaration + listing text; restricted-settings help for sideloaded builds | REL-20 | ☐ |
| ST-17 | Android | Exact alarm | `SCHEDULE_EXACT_ALARM` used only for user-created reminders; declaration text | Play Console | ☐ |
| ST-18 | iOS | Share extension | in-extension UI via `@bacons/apple-targets` fallback; no disallowed `openURL` pattern | REL-14 | ☐ |
| ST-19 | both | Universal/app links | AASA (`/app/*`, `/r/*`, `/oauth/done*`) and assetlinks (Play signing + EAS upload SHA-256) served with 200 JSON | WEB-E2E-09, `adb shell pm get-app-links` | ☐ |
| ST-20 | both | Screenshots | 6 × tr/en generated from the marketing demo canon (SCREEN_MAP_5 §15.4); no real personal data | asset QA checklist (§15.10) | ☐ |
| ST-21 | both | Review notes | how to reach every Pro feature; approval before any write; Gmail verification/CASA status (≤100 users until the LOA); NI is Android-only and optional | REL-18 | ☐ |
| ST-22 | both | Demo account for reviewers | real mailboxes: Google Workspace `review@dijitalasistan.app` (seeded) + Outlook.com test account, added as test users while unverified; Email OTP path note; no `DEMO_MODE` in production | reviewer can sign in and connect (A7) | ☐ |
| ST-23 | both | Listing URLs | privacy `https://dijitalasistan.app/privacy`, support `/support`, marketing `/`, terms `/terms` | links resolve | ☐ |
| ST-24 | both | Age rating, content rights, category, primary language Turkish | App Store Connect / Play Console forms | submitted | ☐ |

---

## 8. External manual steps and credentials

**Source:** INTEGRATION_PLAN §14/§16 and plan §19. Env var names follow INTEGRATION_PLAN §15 (R-20). Corrections applied:
- Voyage is the production embeddings provider (R-01): `EMBEDDINGS_PROVIDER=voyage`, `VOYAGE_API_KEY` required. OpenAI is recommended (fallback LLM, disaster-recovery re-embed, server STT).
- The backoffice uses email one-time code + TOTP, with no password (R-08).

Missing credentials never block development. Adapters report `external_credential_required`, surfaced in the UI as "Harici kimlik bilgisi gerekli" and in System Health as `not_configured`.

| ID | Step | Owner | Where to configure | Keys / artefacts | Verification | ☐ |
|---|---|---|---|---|---|---|
| D1 | Domain + DNS: apex/`www` → Vercel, `admin` CNAME, `api` CNAME → Supabase custom domain, `mail` (SPF, DKIM, bounce MX), `_dmarc`, Search Console TXT | Owner (domain registrar admin) | registrar DNS | `dijitalasistan.app` records | `dig`; Supabase and Resend show "verified" | ☐ |
| S1 | Supabase project (eu-central-1, Pro plan, custom domain `api.dijitalasistan.app`); publishable + secret (default, `automations`) keys, legacy keys disabled; `pg_cron`, `pg_net`, `vector`; MFA TOTP on; custom access token hook; Edge secrets; Vault `project_url`, `cron_secret_key` | Owner (Supabase org admin) | Supabase dashboard / `supabase secrets set --env-file` | `SUPABASE_URL`, `*_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `CRON_SECRET` | `health` all green except provider checks | ☐ |
| ST1 | Staging Supabase E2E project (URL, secret key, SMTP) | Owner | Supabase | CI secrets for `e2e-mobile-ios` | EAS Maestro job green on `main` | ☐ |
| S2 | Resend: domain `mail.dijitalasistan.app`, API key, SMTP into Supabase Auth, Auth email rate limit 300/h | Owner | Resend + Supabase Auth | `SUPABASE_AUTH_SMTP_*`, `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_REPLY_TO` | OTP delivered to Gmail, Outlook and an iCloud relay address | ☐ |
| G1 | GCP projects `dijitalasistan-dev`/`-prod`; enable Gmail, Calendar, Tasks, Pub/Sub APIs | Owner (GCP org admin) | Google Cloud Console | `GOOGLE_CLOUD_PROJECT_ID` | APIs listed as enabled | ☐ |
| G2 | OAuth consent / branding with all scopes; publishing status "In production" | Owner | Google Auth Platform | — | consent screen preview | ☐ |
| G3 | OAuth clients: Web, iOS (per bundle), Android (per package + SHA-1 of debug, EAS upload, Play signing) | Owner | Google Auth Platform | `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `GOOGLE_IOS_URL_SCHEME`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_*` | `health` Google OAuth green; native login on a device | ☐ |
| G4 | Pub/Sub topic + push subscription (OIDC) + publisher grant to `gmail-api-push@system.gserviceaccount.com` + DLQ | Owner | Google Cloud Console | `GOOGLE_PUBSUB_TOPIC`, `GOOGLE_PUBSUB_PUSH_AUDIENCE`, `GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT`, `GOOGLE_CALENDAR_WEBHOOK_URL` | `webhook_events` receives `google_gmail_push` within 1 min | ☐ |
| G5 | Search Console domain verification | Owner | Search Console | TXT record | property "verified" | ☐ |
| G6 | Brand verification (homepage, privacy with Limited Use, terms, logo, demo video of each scope in use) | Owner | Google Verification Center | demo video | status "Verified" | ☐ |
| G7 | Restricted-scope justification for `gmail.readonly` | Owner | Google Verification Center | justification text | CASA requested | ☐ |
| G8 | CASA assessment (annual; critical path for >100 Gmail users) | Owner + authorized lab | lab portal | `GOOGLE_CASA_LOA_NOT_AFTER` | LOA received; health card shows expiry | ☐ |
| M1 | Entra app registration (redirect URIs, API permissions, optional claims incl. `xms_edov`) | Owner (Entra admin) | Microsoft Entra | `MICROSOFT_CLIENT_ID`, `MICROSOFT_AUTHORITY_TENANT`, `MICROSOFT_OAUTH_REDIRECT_URI`, `MICROSOFT_GRAPH_NOTIFICATION_URL`, `MICROSOFT_GRAPH_LIFECYCLE_URL` | `health` Microsoft OAuth green | ☐ |
| M2 | Certificate credential (upload `.crt`; private key, thumbprint, expiry to Edge secrets; renewal reminder 30 days before expiry) | Owner | Entra → Certificates & secrets | `MICROSOFT_CERT_PRIVATE_KEY`, `MICROSOFT_CERT_THUMBPRINT_S256`, `MICROSOFT_CERT_NOT_AFTER` | token exchange with the assertion succeeds | ☐ |
| M3 | Login client secret (12 months) → Supabase azure provider | Owner | Entra + Supabase Auth | `SUPABASE_AUTH_EXTERNAL_AZURE_*`, `MICROSOFT_LOGIN_SECRET_NOT_AFTER` | Microsoft login works | ☐ |
| M4 | Publisher domain (`/.well-known/microsoft-identity-association.json`) | Owner | Entra Branding + web deploy | client ID in the file | "Publisher domain verified" | ☐ |
| M5 | Publisher verification (Microsoft AI Cloud Partner Program ID) | Owner | Partner Center + Entra | Partner ID | verified badge on consent | ☐ |
| M6 | Admin-consent help section `/support#kurum-yoneticileri` | Owner | web content | admin-consent URL | link opens | ☐ |
| A1 | Apple Developer Program (organization, D-U-N-S) | Owner (Account Holder) | developer.apple.com | Team ID (`APPLE_TEAM_ID`) | membership active | ☐ |
| A2 | Identifiers, capabilities (SIWA, App Groups, Associated Domains, Time Sensitive), extension IDs for every variant | Owner | Certificates, IDs & Profiles | `IOS_BUNDLE_IDENTIFIER`, `IOS_APP_GROUP` | EAS build signs | ☐ |
| A3 | Keys: SIWA `.p8` → Edge secret; APNs key → `eas credentials` | Owner | Apple Developer + EAS | `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_PRIVATE_KEY`, `APPLE_SIWA_NATIVE_CLIENT_ID` | Apple exchange works; test push delivered | ☐ |
| A4 | Services ID + web client-secret JWT (≤6 months, CI job `apple-web-secret`) | Owner | Apple Developer + Supabase Auth | `APPLE_SIWA_SERVICES_ID`, `APPLE_SIWA_WEB_SECRET_NOT_AFTER`, `SUPABASE_AUTH_EXTERNAL_APPLE_*` | Android "Apple ile devam et" works | ☐ |
| A5 | Private relay email domain and senders | Owner | Apple Developer | sender domain | OTP arrives at a `privaterelay.appleid.com` address | ☐ |
| A6 | App Store Connect: app record (Turkish primary), agreements/tax/banking, subscription group + products, introductory offer only if chosen, Server Notifications V2 → RevenueCat, IAP key → RevenueCat, ASC API key → EAS | Owner | App Store Connect | `EXPO_ASC_API_KEY_PATH`, `EXPO_ASC_KEY_ID`, `EXPO_ASC_ISSUER_ID`, `IOS_APP_STORE_ID` | products "Ready to Submit"; RevenueCat shows them | ☐ |
| A7 | Reviewer demo access (Workspace `review@dijitalasistan.app` seeded, Outlook.com test account, test users while unverified) | Owner | Google Workspace / Outlook / review notes | credentials in review notes | reviewer can sign in and connect | ☐ |
| P1 | Google Play Console: app, payments, subscriptions, service account → RevenueCat, RTDN, EAS submit account, App Signing SHA-256 | Owner | Play Console | `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `ANDROID_SHA256_CERT_FINGERPRINTS`, `ANDROID_PACKAGE` | RevenueCat shows Play products; assetlinks verified | ☐ |
| P2 | Play Data safety + account-deletion URL | Owner | Play Console | SEC §4.13 answers | form accepted | ☐ |
| P3 | Android NI package list verified against Play listings; flag `android_ni_catalog` | Owner | backoffice Feature Flags | catalog JSON | catalog reviewed | ☐ |
| E1 | EAS project + CI token | Owner | expo.dev | `EXPO_PUBLIC_EAS_PROJECT_ID`, `EXPO_TOKEN`, `EXPO_OWNER` | `eas build --profile preview` succeeds | ☐ |
| E2 | Push credentials (APNs key, FCM v1 service account, `google-services.json` as EAS file env) | Owner | `eas credentials` | `GOOGLE_SERVICES_JSON` | test push on both platforms | ☐ |
| E3 | Enhanced push security + robot access token | Owner | expo.dev → Push | `EXPO_ACCESS_TOKEN` | unauthenticated sends rejected; worker sends succeed | ☐ |
| R1 | RevenueCat project (apps, entitlement `pro`, offering, packages) | Owner | RevenueCat | `REVENUECAT_PROJECT_ID`, `REVENUECAT_ENTITLEMENT_PRO_ID` | offerings load in the app | ☐ |
| R2 | RevenueCat keys + webhook | Owner | RevenueCat + EAS env + Edge secrets | `EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY`, `EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY`, `EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY`, `REVENUECAT_API_V2_SECRET_KEY`, `REVENUECAT_WEBHOOK_AUTH` | webhook `TEST` event marks health green | ☐ |
| V1 | Vercel projects `da-web` (apex/www) and `da-backoffice` (`admin.`), env per §15, firewall allow-list | Owner | Vercel | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_WEB`, `VERCEL_PROJECT_ID_BACKOFFICE`, `NEXT_PUBLIC_*`, `ADMIN_SESSION_SECRET` | previews deploy; AASA/assetlinks return 200 JSON | ☐ |
| SE1 | Sentry org, 4 projects, DSNs, auth token | Owner | Sentry | `EXPO_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | test error visible with scrubbed PII | ☐ |
| AI1 | Anthropic and OpenAI org keys; no-training and retention terms recorded in PRIVACY.md (Limited Use requirement) | Owner | provider consoles + Edge secrets | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_ADMIN_API_KEY` (cost report) | health AI checks green; `ai-eval` runs | ☐ |
| VY1 | Voyage AI key (R-01) | Owner | Voyage dashboard + Edge secrets | `EMBEDDINGS_PROVIDER=voyage`, `VOYAGE_API_KEY` | embedding job writes `vector(1024)`; memory search returns results | ☐ |
| TT1 | Optional premium TTS/STT | Owner | provider console | `TTS_PREMIUM_PROVIDER`, `TTS_API_KEY`, `STT_SERVER_PROVIDER`, `STT_API_KEY` | `voice.tts_premium` flag works | ☐ |
| EN1 | Encryption and webhook secrets (`openssl rand -base64 32`) | Owner | Edge secrets / Vault | `TOKEN_ENC_KEY_V1`, `TOKEN_ENC_ACTIVE_VERSION`, `WEBHOOK_HMAC_SECRET`, `CRON_SECRET` | EF-CRYPTO-01 in prod smoke; pg_net calls authorized | ☐ |
| BO1 | First super_admin bootstrap (`scripts/admin-bootstrap.ts`; email OTP + TOTP enrolment, R-08) | Owner | backoffice | admin identity (`app_metadata.da_kind='admin'`) | login reaches `/dashboard` with `aal2` | ☐ |
| GH1 | GitHub branch protection with the required checks (TEST_PLAN §13) and `production` environment reviewers | Owner (repo admin) | GitHub settings | CI secrets (`EXPO_TOKEN`, `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`) | a PR cannot merge with a red required check | ☐ |

**Credential summary:**

| Provider | Needed for local demo? | Production required? |
|---|---|---|
| Supabase | No (local stack / tier-C shim) | Yes |
| Google Cloud + CASA | No (demo adapter) | Yes |
| Microsoft Entra | No | Yes |
| Apple | No | Yes |
| Anthropic | No (fixture provider) | Yes |
| Voyage | No (FTS-only degrade) | Yes (R-01) |
| OpenAI | No | Recommended (fallback LLM, DR re-embed, server STT) |
| Premium TTS/STT | No (native TTS) | Optional |
| RevenueCat | No (Test Store key recommended) | Yes |
| Expo/EAS + FCM + APNs | No | Yes |
| Sentry | No | Recommended |
| SMTP/Resend | No (local Mailpit) | Yes |
| Encryption secrets | generated locally | Yes |
| Domains/DNS | No | Yes |
| Vercel | No | Yes |

---

## 9. FINAL_IMPLEMENTATION_REPORT template

The executing session creates `docs/FINAL_IMPLEMENTATION_REPORT.md` at T-12.10 with exactly the M§138 sections below and no development diary. Every statement names where it was verified: container tier C/D/C+, CI tier A, EAS, or the owner sandbox. A check that ran only in CI or with the owner is never reported as verified in the container.

```markdown
# Final Implementation Report

### Completed
<!-- Summary per surface (mobile, web, backoffice, backend) with the milestone commits M0–M12, the draft PR link and the counts from DELIVERY_CHECKLIST §1.4 re-computed at completion (planned / implemented / tested / verified / rejected). -->

### Architecture
<!-- Monorepo layout, versions actually pinned (ARCHITECTURE_DECISIONS), deviations from the plan with justification. -->

### Mobile
<!-- Screens shipped per SCREEN_AND_FLOW_MAP part, widgets, share extension, Android NI, No-Dead-Action result (§4: rows, PASS, FAIL fixed). -->

### Backend
<!-- Migrations 0001–0016 (+ additions), Edge Functions, jobs and cron, provider adapters, idempotency markers verified. -->

### AI
<!-- Model routing as configured in ai_model_config (profile balanced/lean per plan), eval results, cost per active user, pricing vs AI-COGS flag (ADR-46), Haiku retirement handling. -->

### Backoffice
<!-- Modules, RBAC verification (two layers), aal2, audit hash chain. -->

### Marketing Website
<!-- Pages, Lighthouse scores, SEO artefacts, well-known files. -->

### Security
<!-- §5 gate results, threat-model verification suite, scans, residual risks. -->

### Privacy
<!-- Export, history deletion, account deletion, retention runs; truthful-claims register check. -->

### Tests
<!-- Per tier: counts, coverage vs targets, where each ran; flake log. -->

### Build
<!-- next build ×2, expo export, prebuild smoke, EAS builds (profile, build IDs). -->

### External Credentials Required
<!-- DELIVERY_CHECKLIST §8 with each item's state (configured / external credential required). -->

### Deployment Steps
<!-- Supabase (db push, config push, functions deploy --use-api, secrets check), Vercel ×2, EAS build/submit, order and rollback. -->

### Known Platform Limitations
<!-- Reference KNOWN_PLATFORM_LIMITATIONS.md; list the ones visible to users. -->

### Remaining Manual Store Steps
<!-- Open items from DELIVERY_CHECKLIST §7.2 and §8 that only the owner can complete (CASA, store agreements, review submission). -->
```

**Feature matrix.**
- Columns are exactly as M§138. "Verified where" goes in Notes.
- Status values: `✅ verified` / `🟡 tested (EXT: …)` / `planned`.
- **Tested** lists the test IDs that must pass. Mark each ☑ with its run reference.

| Feature | Status | Tested | External Credential | Notes |
|---|---|---|---|---|
| Authentication | planned | ☐ E2E-M-02, E2E-M-01, EF-AUTH-01, TST-E2E-M-01, REL-02 | SIWA key + Services ID; Google iOS/Android client IDs; Entra app; SMTP | Verified where: CI (E2E), owner (REL-02). Apple on Android via web OAuth. |
| Onboarding | planned | ☐ E2E-M-01, E2E-A, REL-03 | none in demo mode | M§34 order; First Analysis 72 h. |
| Integration setup | planned | ☐ E2E-M-03, E2E-M-04, IT-OAUTH-*, IT-SYNC-*, REL-04, REL-05 | Google OAuth + Pub/Sub + CASA; Entra app + certificate | R-07 completion binding; Microsoft has no per-app revoke. |
| Today | planned | ☐ E2E-M-06, E2E-A, UT-PRI-* | — | Announcement banner (R-25). |
| Morning Briefing | planned | ☐ E2E-M-05, IT-AI-*, REL-06 | Anthropic; optional premium TTS | Native TTS by default. |
| Midday | planned | ☐ mf_midday_deliver, mf_midday_skip, UT-NTF-08 | — | Skipped when there is no meaningful delta (R-05). |
| Evening Close | planned | ☐ mf_evening_carry_over, IT-AI-08 | — | Deterministic composition (R-05). |
| Weekly Review | planned | ☐ mf_weekly_share, E2E-M-05 | Anthropic | Privacy-safe share card. |
| Flow | planned | ☐ E2E-S-01, UT-FLOW-01 | — | 9 card types (C-04). |
| Mail Intelligence | planned | ☐ E2E-S-02, UT-CLS-* | Gmail/Graph | 6 categories. |
| Email Detail | planned | ☐ E2E-S-03, EF-MAIL-01, E2E-M-06 | Gmail/Graph | Original mail fetched on demand, not stored. |
| AI Reply | planned | ☐ E2E-M-07, E2E-B, IT-APR-*, REL-08, REL-09 | `gmail.send` / `Mail.Send` consent | 4 tones; approval mandatory. |
| Follow-Up | planned | ☐ E2E-S-04, E2E-S-05, UT-FUP-01 | — | |
| Commitments | planned | ☐ E2E-M-12, UT-COM-* | — | Ambiguous parses need confirmation. |
| Plan | planned | ☐ E2E-M-10, E2E-E | calendar write consent | |
| Calendar Intelligence | planned | ☐ E2E-M-10 (conflict flow) | — | `meeting` + `reason_code` for back-to-back / prep. |
| Meeting Prep | planned | ☐ E2E-M-11, E2E-F | Anthropic | T-60 precompute only for external/VIP (R-23). |
| Post Meeting | planned | ☐ E2E-F, post-meeting-text | — | "Kaydet" = approval (C-06). |
| Life Intelligence | planned | ☐ E2E-S-06, UT-AMT-* | — | Amounts only when sourced. |
| Assistant | planned | ☐ E2E-M-13, IT-AI-* | Anthropic, Voyage | Read-only tools; server-built proposals (R-04). |
| Voice | planned | ☐ E2E-S-14, REL-16 | optional OpenAI server STT | Tap-only approvals (R-03). |
| Memory | planned | ☐ E2E-H, DB-25, IT-AI-09 | Voyage | `vector(1024)` (R-01). |
| Search | planned | ☐ E2E-M-14, E2E-H | Voyage (FTS-only degrade) | |
| Universal Capture | planned | ☐ E2E-M-15, E2E-G, E2E-S-08, E2E-S-09, REL-14 | Anthropic | SSRF-safe fetcher. |
| Smart Reminders | planned | ☐ E2E-M-09, E2E-D, E2E-S-07 | tasks write consent (external destinations) | Google Tasks is date-only. |
| VIP | planned | ☐ E2E-S-13, UT-PRI-04 | — | Quiet-hours VIP bypass default on (R-13). |
| Person Intelligence | planned | ☐ E2E-S-13 | — | |
| Priority Rules | planned | ☐ E2E-S-11, UT-PRI-* | — | |
| AI Personalization | planned | ☐ E2E-S-12, UT-PRI-15 | — | |
| Approval Center | planned | ☐ E2E-M-08, E2E-J, IT-APR-*, REL-08, REL-09 | per-provider write scopes | 5 s client undo (R-06). |
| Notifications | planned | ☐ E2E-S-10, TST-E2E-M-04, IT-NTF-*, UT-NTF-*, REL-10 | `EXPO_ACCESS_TOKEN`, APNs, FCM | Default `title_only`; `daily_cap` 5 (R-14). |
| Widgets | planned | ☐ UT-WID-01, CT-09, REL-13 | App Group | Refresh budget limits (KNOWN_PLATFORM_LIMITATIONS). |
| Dark Mode | planned | ☐ E2E-M-18, E2E-I, VIS-01…04 | — | |
| Privacy Center | planned | ☐ E2E-M-19, TST-E2E-M-02, TST-E2E-M-03, IT-PRIV-*, REL-12 | SIWA key, RevenueCat v2 | Re-auth for deletions (R-16). |
| Subscription / Paywall | planned | ☐ E2E-M-16, IT-RC-*, UT-ENT-*, REL-11 | RevenueCat keys, store products | Trial only when the store offers it. |
| Referral | planned | ☐ E2E-M-17, UT-REF-*, WEB-E2E-07 | — | 14 days Pro each; cap 6/year. |
| Settings | planned | ☐ E2E-M-02, E2E-S-15, E2E-S-16 | — | Help/Feedback/About M-SET-70…74. |
| Admin auth | planned | ☐ BO-E2E-01…07, EF-ADM-01 | email provider, Supabase MFA | Email OTP + TOTP (R-08). |
| RBAC | planned | ☐ BO-E2E-08, UT-RBAC-*, pgTAP | — | Two enforcement layers. |
| Dashboard | planned | ☐ BO-E2E-09 | — | |
| Users | planned | ☐ BO-E2E-10 | — | |
| User detail | planned | ☐ BO-E2E-11, BO-E2E-12 | — | |
| Integrations (BO) | planned | ☐ BO-E2E-13 | Google/Entra (live) | |
| Sync & Jobs | planned | ☐ BO-E2E-14, BO-E2E-15 | — | |
| Briefings (BO) | planned | ☐ BO-E2E-16 | Anthropic | |
| Notifications (BO) | planned | ☐ BO-E2E-17 | `EXPO_ACCESS_TOKEN` | Test push never bypasses quiet hours (R-13). |
| AI Operations | planned | ☐ BO-E2E-18 | — | |
| AI Costs | planned | ☐ BO-E2E-18, EF-AI-02 | Anthropic admin key | Routing profile per plan (R-18). |
| Prompt Management | planned | ☐ BO-E2E-19, BO-E2E-20, DB-28 | — | Activation gated by `ai-eval`. |
| Subscriptions (BO) | planned | ☐ BO-E2E-21 | RevenueCat v2 | |
| Entitlements | planned | ☐ BO-E2E-22 | — | |
| Referrals (BO) | planned | ☐ BO-E2E-23 | — | |
| Support | planned | ☐ BO-E2E-24 | email provider | Support Access scopes (R-09). |
| Feedback (BO) | planned | ☐ BO-E2E-25 | — | |
| Feature Flags | planned | ☐ BO-E2E-26 | — | R-10 keys. |
| Announcements | planned | ☐ BO-E2E-27, DB-29 | — | |
| Data Requests | planned | ☐ BO-E2E-28 | — | |
| Audit Logs | planned | ☐ BO-E2E-29 | — | Immutable, hash chain. |
| System Health | planned | ☐ BO-E2E-30, EF-HLT-01 | all provider credentials | No fake green. |
| Admin Users | planned | ☐ BO-E2E-31 | email provider | Last super_admin guard. |
| Global Search | planned | ☐ BO-E2E-33 | — | |
| Command Palette | planned | ☐ BO-E2E-33 | — | |
| Dark Mode (BO) | planned | ☐ BO-E2E-32 | — | |
| Privacy controls (BO) | planned | ☐ BO-E2E-11, BO-E2E-20, DB-14 | — | |
| Server pagination | planned | ☐ BO-E2E-10, BO-E2E-35 | — | |
| Responsive landing | planned | ☐ WEB-E2E-01, WEB-E2E-10, WEB-E2E-18 | — | |
| Pricing | planned | ☐ WEB-E2E-03 | — | Prices from the store / `GET /plans`. |
| Privacy (web) | planned | ☐ WEB-E2E-04 | — | |
| Terms | planned | ☐ WEB-E2E-04 | — | |
| Data deletion (web) | planned | ☐ WEB-E2E-06, REL-12 | SMTP | |
| Support (web) | planned | ☐ WEB-E2E-05 | — | |
| App CTA | planned | ☐ WEB-E2E-02, WEB-E2E-07, WEB-E2E-08, WEB-E2E-09 | `APPLE_TEAM_ID`, Play SHA-256, `IOS_APP_STORE_ID` | |
| Integrations (web) | planned | ☐ WEB-E2E-01 | — | |
| Security messaging | planned | ☐ WEB-E2E-01, WEB-E2E-04, QG-06 | — | |
| SEO basics | planned | ☐ WEB-E2E-12, WEB-E2E-17 | — | |

**Appendices** the report must also carry:
1. The completed §4 No-Dead-Action inventory with PASS/FAIL.
2. The §7.1 release checklist with evidence links.
3. A "where each check ran" table (IMPLEMENTATION_PLAN Part D) filled with the actual run references.

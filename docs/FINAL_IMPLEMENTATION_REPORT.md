# Final Implementation Report

Dijital Asistan as built on branch `claude/magical-pascal-edvjgn`, draft PR
[#3](https://github.com/aieasycep/DijitalAsistanim-Opus5.5-/pull/3) into `main`. Every statement
names where it was checked:

- **container**: this repository's own commands in the build container. That covers the unit suites, Deno, the tier C pgTAP suites on PostgreSQL 16 with the Supabase shim, the tier C+ integration suites on PostgREST with the mock providers, the builds and the bundle scans.
- **CI**: GitHub Actions. That covers tier A (`supabase start` with real GoTrue, PostgREST and the edge runtime), Playwright, the Android emulator and security-nightly.
- **EAS**: native builds and device runs on Expo's infrastructure.
- **owner**: the owner's sandbox with real accounts and credentials. These are the M§153 release checks in [DELIVERY_CHECKLIST §7.1](DELIVERY_CHECKLIST.md#71-release-checklist).

A check that ran only in CI, on EAS or with the owner is never reported as checked in the
container.

### Completed

**Surfaces:**

- **Mobile app** (`apps/mobile`, Expo SDK 57, React Native 0.86):
  - 83 routes.
  - The four fixed tabs and every screen of SCREEN_AND_FLOW_MAP parts 1–4.
  - Home-screen widgets: iOS WidgetKit and Android Glance.
  - Share intake on iOS and Android.
  - Android Notification Intelligence (on-device extraction only).
  - Voice with on-device STT and native TTS.
  - An offline mutation queue, local reminders, and analytics without content.
- **Marketing web** (`apps/web`, Next.js 16):
  - Landing, pricing, privacy, terms, support, data deletion, referral landing (`/r/[code]`), OAuth fallback (`/oauth/done`) and the `/app/*` universal-link fallback.
  - The `.well-known` files (AASA, assetlinks, Microsoft identity association, security.txt), `tr` by default and `en`.
- **Backoffice** (`apps/backoffice`, Next.js 16):
  - 38 pages covering every module of BACKOFFICE_PLAN §46.
  - Access requires an email one-time code plus TOTP (`aal2`), and roles are enforced in two layers (admin-api and `admin_api` SQL).
  - The audit log is hash-chained, and PII is masked, with audited reveals.
- **Backend** (`supabase/`):
  - 45 migrations with RLS forced on every table.
  - Nine Edge Functions: `api`, `oauth`, `webhooks-google`, `webhooks-microsoft`, `webhooks-revenuecat`, `worker`, `admin-api`, `public-api` and `health`.
  - A first-party `jobs` queue driven by pg_cron.
  - Google, Microsoft, device and demo provider adapters.
  - The AI pipeline with grounding, approvals with provider-level idempotency, RevenueCat billing, referrals, and privacy export and deletion.

**Milestones:** the first-parent history on the branch carries one merge per milestone.

| Area | Commits |
| --- | --- |
| Foundation, tokens, domain, validation, i18n | `6ec1e02`, `d1cedf9`, `e38e1f1`, `c615f48`, `b8c73e1`, `0c686cc`, `5fae1ed` |
| Database and Edge core | `744d859`, `b9c9893`, `7745b06` |
| Integrations, AI, approvals, billing | `ead751f`, `9d23e4a`, `a3efabd`, `ecadd4d`, `1c3b7e4`, `04abce6` |
| Mobile | `eff3984`, `8b8208b`, `1026668`, `7ab9559`, `a38faa4`, `9a939ef`, `63bd7ef`, `0fe7ff7`, `badb654`, `b814862`, `c104239`, `d54d985`, `f443235` |
| Web and backoffice | `8feeb53`, `535fa87`, `76d53a9`, `23e75a2`, `a4ae1bd` |
| Hardening, tests, gates | `98e7138`, `57fed09`, `80ce487`, `20c9a1a`, `7cad226`, `ec14e92`, `5b83da5`, `e633f43`, `529fe58` |
| As-built docs | `ba1f469`, `4284c5a` |
| Gap closure from the as-built review | `609fb6b` (backend, privacy controls, supply chain), `b66acb3` (mobile platform), `a97e363` (free/busy, calendar merge, attachments, Today AI card), `1f85dfb` (ai-eval, backoffice Sentry, SIWA rotation, leftovers) |

**Requirement counts:** 720 rows. At completion 649 are tested, 66 implemented, 2 not built and 3 rejected; none is verified yet (see [Requirement status](#requirement-status)).

**Feature matrix**

Status: **✅ tested** means every link of the feature's chain is covered by automated suites that pass in the container and in CI, and no owner credential is needed for its real behaviour. **🟡 tested (EXT: …)** means the same suites pass with the demo and fixture adapters, but the live behaviour needs the named owner credential. No row is marked verified: device runs (Maestro, EAS) and the owner's release checks REL-01…20 are still open. Counts: 42 ✅ tested, 33 🟡 tested (EXT), 0 not built.

Evidence compiled read-only at `d59d471` (branch `claude/magical-pascal-edvjgn`). The template (DELIVERY_CHECKLIST §9) has 75 feature rows. All 75 are below, in the template's order. "Tested" gives the planned or as-built IDs that appear literally in the repo's test files, then the key test files. `BO-E2E-nn (x.spec tag)` is the tag written in that spec's header comment. Those tags use a different numbering from TEST_PLAN and BACKOFFICE_PLAN (see Findings).

| Feature | Status | Tested | External Credential | Notes |
|---|---|---|---|---|
| Authentication | 🟡 tested (EXT: SIWA, Google/Entra client IDs, SMTP) | EF-AUTH-01, E2E-M-01, E2E-M-02, TST-E2E-M-01 · `apps/mobile/test/auth-methods.test.ts`, `supabase/functions/_shared/services/account-state.test.ts`, `supabase/functions/api/auth-apple.test.ts`, `supabase/tests/database/010_identity_devices.test.sql`, `apps/mobile/.maestro/flows/m102/auth.yaml` | SIWA key + Services ID; Google web/iOS client IDs; Entra app; SMTP | Where: container unit, container Deno, tier C pgTAP, CI Maestro (pending); owner: REL-02. Apple on Android uses the PKCE browser flow (auth-methods.test.ts); the email code needs custom SMTP live (KPL-49, KPL-57). |
| Onboarding | ✅ tested | E2E-M-01, E2E-A · `apps/mobile/test/onboarding.test.tsx`, `supabase/functions/worker/handlers/assist.test.ts`, `supabase/functions/api/assist-routes.test.ts`, `supabase/tests/database/20260924002600_ai_pipeline_part2.test.sql`, `apps/mobile/.maestro/flows/acceptance/A-onboarding-to-today.yaml` | none in demo mode | Where: container unit, container Deno, tier C pgTAP, CI Maestro (pending); owner: REL-03. C-01 step order and the zero-source path; First Analysis over 72 h (JOB-13 `window_hours: 72`, "Son 72 saatte…" copy). |
| Integration setup | 🟡 tested (EXT: Google OAuth/Pub/Sub/CASA, Entra app) | EF-OAUTH-01, EF-OAUTH-02, EF-DEMO-01, IT-OAUTH-01…13, IT-SYNC-01…18, DB-26, E2E-M-03, E2E-M-04, E2E-S-21, WEB-E2E-08 · `supabase/functions/_shared/services/integrations/connect.test.ts`, `supabase/tests/integration/oauth.test.ts`, `supabase/tests/database/20260924002000_integrations_runtime.test.sql`, `apps/mobile/test/integrations.test.tsx`, `apps/web/e2e/oauth-done.spec.ts` | Google OAuth + Pub/Sub + CASA; Entra app + certificate | Where: container unit, container Deno, tier C pgTAP, tier C+ / CI tier A integration, CI Playwright, CI Maestro (pending); owner: REL-04, REL-05. R-07 completion binding (connect.test.ts, oauth-done.spec.ts); Microsoft has no per-app revoke (KPL-42); Gmail has a 100-user cap until CASA (KPL-32). |
| Today | ✅ tested | UT-PRI-01…17 (no -08), E2E-M-06, E2E-S-19, E2E-A · `apps/mobile/test/states/today.test.tsx`, `apps/mobile/test/today-actions.test.ts`, `packages/domain/test/priority/engine.test.ts`, `supabase/tests/database/160_user_rpcs.test.sql`, `apps/mobile/.maestro/flows/screens/today-announcement.yaml` | — | Where: container unit, tier C pgTAP, CI Maestro (pending). Hero modes, sections, card verbs and the announcement banner (R-25) in the today tests; today_overview and dismiss_announcement are owner-scoped (160_user_rpcs). |
| Morning Briefing | 🟡 tested (EXT: Anthropic) | IT-AI-05, IT-AI-06, IT-AI-08, E2E-M-05 · `apps/mobile/test/states/briefing.test.tsx`, `apps/mobile/test/tts.test.tsx`, `supabase/functions/worker/handlers/intel.test.ts`, `supabase/tests/database/240_ai_pipeline.test.sql`, `supabase/tests/integration/ai.test.ts` | Anthropic; optional premium TTS (Azure/OpenAI/ElevenLabs) | Where: container unit, container Deno, tier C pgTAP, tier C+ / CI tier A integration, CI Maestro (pending); owner: REL-06. Fixture provider in every tier; an exhausted budget or the kill switch leaves the deterministic briefing (IT-AI-05/06); native TTS by default (tts.test.tsx, KPL-25). |
| Midday | ✅ tested | IT-AI-08 · `supabase/functions/_shared/services/briefings/evening-midday.test.ts`, `apps/mobile/test/states/briefing.test.tsx`, `supabase/functions/worker/handlers/intel.test.ts`, `supabase/tests/integration/ai.test.ts` | — | Where: container unit, container Deno, tier C+ / CI tier A integration. A midday with no meaningful delta is skipped (R-05, planned UT-NTF-08); T1 polish runs only behind `ai.feature.briefing_polish`; no Maestro flow (mf_midday_* not built). |
| Evening Close | ✅ tested | IT-AI-08 · `supabase/functions/_shared/services/briefings/evening-midday.test.ts`, `supabase/functions/api/intel-routes.test.ts`, `apps/mobile/test/states/briefing.test.tsx`, `supabase/tests/database/240_ai_pipeline.test.sql`, `supabase/tests/integration/ai.test.ts` | — | Where: container unit, container Deno, tier C pgTAP, tier C+ / CI tier A integration. Deterministic composition (R-05) with carry-over lists; evening-ready is Pro and idempotent (API-BRF-02/04); no Maestro flow (mf_evening_carry_over not built). |
| Weekly Review | 🟡 tested (EXT: Anthropic) | E2E-M-05 · `apps/mobile/test/briefing.test.tsx`, `supabase/functions/worker/handlers/intel.test.ts`, `supabase/functions/api/intel-routes.test.ts`, `packages/domain/test/weekly/time-saved.test.ts`, `apps/mobile/.maestro/flows/m102/briefing.yaml` | Anthropic | Where: container unit, container Deno, CI Maestro (pending); owner. The share card carries only integers and fixed labels, no PII (API-BRF-03, "T-5.08 weekly"); weekly.ts calls the model (fixture provider in tests). |
| Flow | ✅ tested | UT-FLOW-01, E2E-S-01 · `apps/mobile/test/states/flow.test.tsx`, `apps/mobile/test/m2/flow.test.tsx`, `packages/domain/test/flow/sort.test.ts`, `supabase/tests/database/160_user_rpcs.test.sql`, `apps/mobile/.maestro/flows/screens/flow-filters-swipe.yaml` | — | Where: container unit, tier C pgTAP, CI Maestro (pending). Primary actions, swipe verbs and menus per card kind (C-04); flow_feed and flow_meta are owner-scoped (160_user_rpcs). |
| Mail Intelligence | 🟡 tested (EXT: Gmail/Graph, Anthropic) | UT-CLS-01, IT-AI-01, IT-AI-04, E2E-S-02 · `apps/mobile/test/states/mail-intel.test.tsx`, `packages/domain/test/priority/engine.test.ts`, `supabase/functions/worker/handlers/intel.test.ts`, `supabase/functions/_shared/ai/evals/evals.test.ts`, `supabase/tests/integration/ai.test.ts` | Gmail/Graph; Anthropic (T1 triage) | Where: container unit, container Deno, tier C+ / CI tier A integration, CI Maestro (pending); owner. On the fixture inbox, T0 resolves at least 55 % and triage-tr.jsonl reaches macro-F1 ≥ 0.85 with the fixture T1; only Inbox and Sent are analysed (KPL-34). |
| Email Detail | 🟡 tested (EXT: Gmail/Graph) | E2E-M-06, E2E-S-03 · `apps/mobile/test/m2/mail.test.tsx`, `apps/mobile/test/mail-original-text.test.ts`, `supabase/functions/api/integrations.test.ts`, `supabase/functions/_shared/security/html-sanitize.test.ts`, `apps/mobile/.maestro/flows/screens/email-detail-actions.yaml` | Gmail/Graph | Where: container unit, container Deno, CI Maestro (pending); owner. The original mail is fetched on demand and returned sanitised, never stored (API-MAIL-01 in integrations.test.ts; planned EF-MAIL-01 not tagged). |
| AI Reply | 🟡 tested (EXT: send consent, Anthropic) | IT-APR-01, IT-APR-04, IT-APR-06, IT-APR-12, E2E-M-07, E2E-B · `apps/mobile/test/states/reply.test.tsx`, `supabase/functions/api/assist-routes.test.ts`, `supabase/functions/_shared/services/approvals/execute/execute.test.ts`, `supabase/tests/integration/approvals.test.ts`, `apps/mobile/.maestro/flows/acceptance/B-mail-draft-approval.yaml` | `gmail.send` / `Mail.Send` consent; Anthropic (drafts) | Where: container unit, container Deno, tier C+ / CI tier A integration, CI Maestro (pending); owner: REL-08, REL-09. Tone regeneration, and sending only after approval with the R-06 undo window (reply-discard.test.ts); the Message-ID marker makes the send exactly-once (IT-APR-06). |
| Follow-Up | ✅ tested | UT-FUP-01, E2E-S-04, E2E-S-05 · `apps/mobile/test/states/people.test.tsx`, `apps/mobile/test/m2/people.test.tsx`, `packages/domain/test/followups/state.test.ts`, `supabase/functions/api/assist-routes.test.ts`, `apps/mobile/.maestro/flows/screens/waiting-reply.yaml` | — | Where: container unit, container Deno, CI Maestro (pending). T0 code computes reply_state and follow_up_state, never a model label (services/followups.ts); the Pro follow-up draft (API-MAIL-06) uses the AI Reply path (Anthropic). |
| Commitments | 🟡 tested (EXT: Anthropic) | UT-COM-03, -04, -06, -07, -08, -11, -12, E2E-M-12 · `apps/mobile/test/states/commitments.test.tsx`, `packages/domain/test/commitments/detect.test.ts`, `supabase/functions/worker/handlers/intel.test.ts`, `supabase/tests/database/160_user_rpcs.test.sql`, `apps/mobile/.maestro/flows/m102/commitment.yaml` | Anthropic (T1 extraction; the template said —) | Where: container unit, container Deno, tier C pgTAP, CI Maestro (pending); owner. The T0 regex is only a pre-signal; T1 `CommitmentExtractV1` locates the claim (services/ai/commitments.ts). A hedged promise becomes a pending "Bu bir söz mü?" proposal (intel.test.ts T-5.03). |
| Plan | 🟡 tested (EXT: calendar write consent) | IT-PLAN-01, IT-PLAN-02, IT-APR-07, IT-APR-11, IT-APR-13, E2E-M-10, E2E-E · `apps/mobile/test/states/plan.test.tsx`, `apps/mobile/test/states/plan-detail.test.tsx`, `supabase/functions/api/assist-routes.test.ts`, `supabase/tests/integration/calendar-intel.test.ts`, `supabase/tests/database/160_user_rpcs.test.sql` | calendar write consent | Where: container unit, container Deno, tier C pgTAP, tier C+ / CI tier A integration, CI Maestro (pending); owner. API-PLAN-01…04; calendar writes go through the approval executor (deterministic event id, stale etag 412); only the organiser can move a meeting (KPL-45). |
| Calendar Intelligence | ✅ tested | IT-SYNC-19, E2E-M-10 · `apps/mobile/test/states/plan-detail.test.tsx`, `packages/domain/test/calendar/calendar.test.ts`, `supabase/functions/_shared/services/plan/availability.test.ts`, `supabase/tests/database/20260924003410_calendar_merge.test.sql`, `supabase/tests/integration/calendar-intel.test.ts` | — | Where: container unit, container Deno, tier C pgTAP, tier C+ / CI tier A integration, CI Maestro (pending). Cross-source merge (KPL-15) and conflict options (M-PLAN-07/08); attendee availability comes only from a provider free/busy answer (KPL-46). |
| Meeting Prep | 🟡 tested (EXT: Anthropic) | IT-AI-11, E2E-M-11, E2E-F · `apps/mobile/test/states/meeting.test.tsx`, `apps/mobile/test/m2/meeting.test.tsx`, `supabase/functions/api/assist-routes.test.ts`, `supabase/functions/_shared/services/assist/chunked-reads.test.ts`, `supabase/tests/integration/ai.test.ts` | Anthropic | Where: container unit, container Deno, tier C+ / CI tier A integration, CI Maestro (pending); owner. Prep is precomputed at T-60 only for external or VIP meetings on Pro; internal meetings run on demand (IT-AI-11, R-23). |
| Post Meeting | 🟡 tested (EXT: Anthropic) | IT-APR-15, E2E-F · `apps/mobile/test/states/post-meeting.test.tsx`, `supabase/functions/_shared/ai/evals/part2.test.ts`, `supabase/tests/database/20260924002600_ai_pipeline_part2.test.sql`, `supabase/tests/integration/approvals.test.ts`, `apps/mobile/.maestro/flows/acceptance/F-prep-person-email-note-post-commitment.yaml` | Anthropic (post_meeting parse; the template said —) | Where: container unit, container Deno, tier C pgTAP, tier C+ / CI tier A integration, CI Maestro (pending); owner. "Kaydet" is the approval and runs once (C-06, IT-APR-15). services/meetings/post.ts calls the model; without it the fallback is T0 with no proposals. |
| Life Intelligence | ✅ tested | UT-AMT-01, -08, -09, -10, E2E-S-06 · `apps/mobile/test/states/life.test.tsx`, `supabase/functions/_shared/services/life/life.test.ts`, `supabase/functions/worker/handlers/android-life.test.ts`, `supabase/tests/database/20260924002800_android_ni.test.sql`, `packages/domain/test/extract/amount-tr.test.ts` | — | Where: container unit, container Deno, tier C pgTAP, CI Maestro (pending). T0 parsers run first (security templates, JSON-LD, sender templates); the T1 fallback is Pro-only; amounts are kept only with verified evidence; there are no carrier or bank APIs (KPL-48). |
| Assistant | 🟡 tested (EXT: Anthropic, Voyage) | IT-AI-10, CT-06, CT-11, EF-AI-01, E2E-M-13 · `apps/mobile/test/assistant.test.tsx`, `apps/mobile/test/states/chat.test.tsx`, `supabase/functions/api/assist-routes.test.ts`, `supabase/functions/_shared/services/assistant/tools.test.ts`, `supabase/tests/integration/ai.test.ts` | Anthropic, Voyage | Where: container unit, container Deno, tier C+ / CI tier A integration, CI Maestro (pending); owner. Tools are read-only, and each intent yields one server-built pending action_proposal (R-04, IT-AI-10); injection suite in `supabase/functions/tests/security/prompt-injection.test.ts`. |
| Voice | 🟡 tested (EXT: Anthropic via Assistant) | IT-APR-16, E2E-S-14 · `apps/mobile/test/voice.test.tsx`, `apps/mobile/test/voice-gaps.test.tsx`, `supabase/functions/_shared/ai/providers/speech-embed.test.ts`, `supabase/tests/integration/approvals.test.ts`, `apps/mobile/.maestro/flows/screens/voice-chips.yaml` | optional server STT (OpenAI or Deepgram); Anthropic (answers go through the Assistant stream) | Where: container unit, container Deno, tier C+ / CI tier A integration, CI Maestro (pending); owner: REL-16. A spoken "onayla" never approves; only a tap does (R-03, IT-APR-16). On-device Turkish recognition depends on the device and is mocked in jest (KPL-24). |
| Memory | 🟡 tested (EXT: Voyage) | IT-AI-09, E2E-H · `apps/mobile/test/states/memory.test.tsx`, `supabase/functions/_shared/services/memory/search.test.ts`, `supabase/tests/database/060_search_memory.test.sql`, `supabase/tests/integration/ai.test.ts`, `apps/mobile/.maestro/flows/acceptance/H-search-correct-detail.yaml` | Voyage | Where: container unit, container Deno, tier C pgTAP, tier C+ / CI tier A integration, CI Maestro (pending); owner. `vector(1024)` (R-01, planned DB-25 in 060_search_memory); a 503 from mock Voyage retries, then falls back to an FTS-only partial result (IT-AI-09). |
| Search | 🟡 tested (EXT: Voyage, Anthropic) | IT-AI-09, E2E-M-14, E2E-H · `apps/mobile/test/search.test.tsx`, `supabase/functions/api/intel-routes.test.ts`, `supabase/tests/database/060_search_memory.test.sql`, `supabase/tests/database/300_threats_tenant.test.sql`, `supabase/tests/integration/ai.test.ts` | Voyage (FTS-only degrade); Anthropic for the cited answer mode | Where: container unit, container Deno, tier C pgTAP, tier C+ / CI tier A integration, CI Maestro (pending); owner. Free gets FTS only, Pro gets hybrid RRF, and the answer mode is model-written with citations (API-SRCH-01); RPC-02 never returns another user's rows. |
| Universal Capture | 🟡 tested (EXT: Anthropic) | UT-CAP-01, EF-SEC-01, UT-SSRF-01…05, IT-APR-14, E2E-M-15, E2E-G, E2E-S-08, E2E-S-09 · `apps/mobile/test/states/capture.test.tsx`, `supabase/functions/api/assist-routes.test.ts`, `supabase/functions/tests/security/ssrf.test.ts`, `supabase/tests/database/20260924002600_ai_pipeline_part2.test.sql`, `supabase/tests/integration/approvals.test.ts` | Anthropic | Where: container unit, container Deno, tier C pgTAP, tier C+ / CI tier A integration, CI Maestro (pending); owner: REL-14. The link fetcher is SSRF-safe (ssrf-fetch.test.ts, packages/domain/test/net) and uploads are validated (tests/security/uploads.test.ts); a batch of three creates three approvals (IT-APR-14). |
| Smart Reminders | 🟡 tested (EXT: Tasks/To Do write consent) | UT-REM-01…11, IT-APR-09, E2E-M-09, E2E-D, E2E-S-07 · `apps/mobile/test/states/reminder-sheet.test.tsx`, `packages/domain/test/reminders/presets.test.ts`, `supabase/functions/api/reminders.test.ts`, `supabase/tests/database/20260924002100_approvals_reminders_runtime.test.sql`, `supabase/tests/integration/approvals.test.ts` | tasks write consent (external destinations); server-sent reminders need the Notifications push credentials | Where: container unit, container Deno, tier C pgTAP, tier C+ / CI tier A integration, CI Maestro (pending); owner. Google Tasks is date-only (KPL-38); marker search prevents duplicate Tasks and To Do writes (IT-APR-09). |
| VIP | ✅ tested | UT-PRI-04, UT-NTF-09, E2E-S-13 · `apps/mobile/test/states/person.test.tsx`, `packages/domain/test/priority/engine.test.ts`, `packages/domain/test/notifications/decide.test.ts`, `supabase/tests/database/160_user_rpcs.test.sql`, `apps/mobile/.maestro/flows/screens/vip-person.yaml` | — | Where: container unit, tier C pgTAP, CI Maestro (pending). VIP raises urgency on Pro and has no effect on Free (UT-PRI-04); a VIP critical mail may bypass quiet hours up to 3 times per window (UT-NTF-09, R-13). |
| Person Intelligence | ✅ tested | E2E-S-13, E2E-F · `apps/mobile/test/states/person.test.tsx`, `apps/mobile/test/person.test.tsx`, `supabase/functions/_shared/services/assistant/tools.test.ts`, `supabase/tests/database/240_ai_pipeline.test.sql`, `supabase/tests/database/060_search_memory.test.sql` | — | Where: container unit, container Deno, tier C pgTAP, CI Maestro (pending). Contacts come from mail headers, with owes and owed (240_ai_pipeline); person rows are owner-isolated (060_search_memory); the assistant resolves people (tools.test.ts). |
| Priority Rules | ✅ tested | UT-PRI-01…17 (no -08), E2E-S-11 · `apps/mobile/test/rules.test.tsx`, `apps/mobile/test/states/rule-editor.test.tsx`, `packages/domain/test/priority/engine.test.ts`, `supabase/functions/worker/handlers/intel.test.ts`, `supabase/tests/database/060_search_memory.test.sql` | — | Where: container unit, container Deno, tier C pgTAP, CI Maestro (pending). An explicit rule overrides the AI result (rules.test.tsx, intel.test.ts; planned UT-PRI-08 not tagged); rule previews are isolated per user (060_search_memory). |
| AI Personalization | ✅ tested | UT-PRI-15, E2E-S-12 · `apps/mobile/test/rules.test.tsx`, `apps/mobile/test/onboarding.test.tsx`, `packages/domain/test/priority/engine.test.ts`, `apps/mobile/.maestro/flows/screens/personalization.yaml` | — | Where: container unit, CI Maestro (pending). With learning off, learned preferences are ignored (UT-PRI-15); screens M-SET-45/46 and onboarding M-ON-09. |
| Approval Center | 🟡 tested (EXT: per-provider write scopes) | EF-APR-01, IT-APR-01…18, E2E-M-08, E2E-J · `apps/mobile/test/approvals.test.tsx`, `supabase/functions/api/approvals.test.ts`, `supabase/tests/database/050_approvals.test.sql`, `supabase/tests/integration/approvals.test.ts`, `apps/mobile/.maestro/flows/acceptance/J-approval-edit-approve.yaml` | per-provider write scopes | Where: container unit, container Deno, tier C pgTAP, tier C+ / CI tier A integration, CI Maestro (pending); owner: REL-08, REL-09. Undo is client-only (R-06, IT-APR-18); a concurrent approve executes once (IT-APR-02, 300_threats_writes); a missing scope gives 424 plus a resume path (IT-APR-04). |
| Notifications | 🟡 tested (EXT: EXPO_ACCESS_TOKEN, APNs, FCM) | UT-NTF-01…17 (no -08), EF-NTF-01, IT-NTF-01…07, E2E-S-10, TST-E2E-M-04 · `packages/domain/test/notifications/decide.test.ts`, `supabase/functions/_shared/services/notifications/pipeline.test.ts`, `supabase/tests/database/070_notifications_business.test.sql`, `supabase/tests/integration/notifications.test.ts`, `apps/mobile/test/notification-router.test.ts` | `EXPO_ACCESS_TOKEN`, APNs, FCM | Where: container unit, container Deno, tier C pgTAP, tier C+ / CI tier A integration, CI Maestro (pending); owner: REL-10. Every tier uses an Expo stub. Default detail is title_only, and daily_cap 5 suppresses the 6th push (UT-NTF-05, R-14). No sensitive params (tests/security/notification-leakage.test.ts). |
| Widgets | 🟡 tested (EXT: iOS App Group) | UT-WID-01, CT-09 (JS side), EF-WDG-01 · `apps/mobile/test/widgets.test.ts`, `packages/validation/test/widget-snapshot.test.ts`, `supabase/functions/api/widgets.test.ts`, `packages/api-client/test/widgets.test.ts` | App Group (EAS credentials) | Where: container unit, container Deno; owner: REL-13. The snapshot follows the generic, title_only and full levels with ETag/304 (EF-WDG-01); the CT-09 Kotlin/Swift decode is not built; refresh budgets are in KPL-17 and KPL-19. |
| Dark Mode | ✅ tested | E2E-M-18, E2E-I · `packages/ui/test/theme.test.tsx`, `packages/design-tokens/test/contrast.test.ts`, `apps/mobile/test/settings.test.tsx`, `apps/mobile/test/a11y/routes.test.tsx`, `apps/mobile/.maestro/flows/m102/dark-mode.yaml` | — | Where: container unit, CI Maestro (pending). Token contrast is checked in both themes and the M-SET-60 appearance switch is tested; VIS-01…04 pixel comparison is not built (dark-mode.yaml only takes screenshots). |
| Privacy Center | 🟡 tested (EXT: SIWA key, RevenueCat v2) | IT-PRIV-01…05, DB-11, E2E-M-19, TST-E2E-M-02, TST-E2E-M-03 · `apps/mobile/test/privacy.test.tsx`, `supabase/functions/worker/handlers/privacy.test.ts`, `supabase/functions/_shared/services/privacy/privacy.test.ts`, `supabase/tests/database/250_privacy_engine.test.sql`, `supabase/tests/integration/privacy.test.ts` | SIWA key, RevenueCat v2; email API for the deletion confirmation mail | Where: container unit, container Deno, tier C pgTAP, tier C+ / CI tier A integration, CI Maestro (pending); owner: REL-12. Deletions require re-authentication (R-16, api/privacy.test.ts). The SIWA revoke and RevenueCat delete adapters are null without their credentials. Deleting the account does not cancel billing (KPL-51). |
| Subscription / Paywall | 🟡 tested (EXT: RevenueCat keys, store products) | UT-ENT-01…14, UT-MB-10, IT-RC-01…10, EF-WH-03, CT-08, E2E-M-16 · `apps/mobile/test/paywall.test.tsx`, `packages/domain/test/entitlements/effective.test.ts`, `supabase/functions/webhooks-revenuecat/app.test.ts`, `supabase/tests/database/220_business_billing.test.sql`, `supabase/tests/integration/revenuecat.test.ts` | RevenueCat keys, store products | Where: container unit, container Deno, tier C pgTAP, tier C+ / CI tier A integration, CI Maestro (pending); owner: REL-11. The trial CTA appears only when the store reports an eligible free phase (KPL-50); a purchase is confirmed only after the server entitlement; webhooks are unordered (KPL-52). |
| Referral | ✅ tested | UT-REF-01…11, DB-19, WEB-E2E-07, E2E-M-17 · `apps/mobile/test/paywall.test.tsx`, `packages/domain/test/referrals/evaluate.test.ts`, `supabase/functions/_shared/services/referrals/referrals.test.ts`, `supabase/tests/database/221_referrals.test.sql`, `apps/web/e2e/referral-landing.spec.ts` | — | Where: container unit, container Deno, tier C pgTAP, CI Playwright, CI Maestro (pending). 14 days of Pro each; the 7th qualifying referral in 365 days has its credit withheld (UT-REF-05); `referral.rewards_enabled` kill switch (20260924003300_gap_closure); KPL-31. |
| Settings | ✅ tested | E2E-M-02, E2E-S-15, E2E-S-16 · `apps/mobile/test/settings.test.tsx`, `apps/mobile/test/completion.test.tsx`, `supabase/functions/api/me.test.ts`, `supabase/functions/api/support-analytics.test.ts`, `supabase/tests/database/010_identity_devices.test.sql` | — | Where: container unit, container Deno, tier C pgTAP, CI Maestro (pending). Help, Feedback and About (M-SET-70…74, including the licenses sheet); POST /feedback and /support/tickets validation and limits (support-analytics.test.ts). |
| Admin auth | 🟡 tested (EXT: SMTP) | BO-E2E-01 (login-mfa tag), BO-E2E-05, BO-E2E-06, BO-E2E-07, EF-ADM-01 · `apps/backoffice/e2e/login-mfa.spec.ts`, `apps/backoffice/e2e/session-idle.spec.ts`, `apps/backoffice/src/actions/__tests__/auth.test.ts`, `supabase/functions/admin-api/tests/pipeline.test.ts`, `supabase/tests/database/120_admin_rbac.test.sql` | custom SMTP for the Supabase Auth email code (TOTP is built-in Supabase MFA, no credential) | Where: container unit, container Deno, tier C pgTAP, CI Playwright; owner. Email code, then TOTP, then recovery codes, against the admin-api contract mock (R-08); T−2 min idle warning; revoke-elsewhere (logout.spec.ts); preflight lockout (auth.test.ts). |
| RBAC | ✅ tested | UT-RBAC-01…04, BO-E2E-27 (rbac-matrix tag) · `apps/backoffice/e2e/rbac-matrix.spec.ts`, `packages/domain/test/rbac/sql-parity.test.ts`, `supabase/functions/admin-api/tests/catalogue.test.ts`, `supabase/tests/database/120_admin_rbac.test.sql`, `supabase/tests/database/300_threats_admin.test.sql` | — | Where: container unit, container Deno, tier C pgTAP, CI Playwright. Two layers: the sidebar and URL access per role (rbac-matrix.spec.ts), and the admin_api function map for every role and state (120_admin_rbac); TS↔SQL parity (sql-parity.test.ts). |
| Dashboard | ✅ tested | BO-E2E-01 (dashboard tag) · `apps/backoffice/e2e/dashboard.spec.ts`, `apps/backoffice/e2e/contract-gaps.spec.ts`, `apps/backoffice/src/app/__tests__/module-pages.test.tsx`, `supabase/tests/database/231_admin_metrics.test.sql`, `supabase/functions/admin-api/tests/routes.test.ts` | — | Where: container unit, container Deno, tier C pgTAP, CI Playwright. Every KPI matches a hand-built fixture, with demo and internal users excluded (231_admin_metrics); platform filter and stale-rollup notice (contract-gaps.spec.ts). |
| Users | ✅ tested | BO-E2E-02…05 (users tag) · `apps/backoffice/e2e/users.spec.ts`, `apps/backoffice/src/app/__tests__/module-pages.test.tsx`, `supabase/functions/admin-api/tests/flows.test.ts`, `supabase/tests/database/124_admin_api_smoke.test.sql` | — | Where: container unit, container Deno, tier C pgTAP, CI Playwright. Masked list and plan filter; an exact-email lookup never lands in the URL (users.spec.ts); q is an exact email or user id, never partial (flows.test.ts). |
| User detail | ✅ tested | BO-E2E-02…05 (users tag) · `apps/backoffice/e2e/users.spec.ts`, `apps/backoffice/e2e/contract-gaps.spec.ts`, `apps/backoffice/src/app/__tests__/user-actions.test.tsx`, `supabase/tests/database/124_admin_api_smoke.test.sql`, `supabase/tests/database/300_threats_admin.test.sql` | — | Where: container unit, tier C pgTAP, CI Playwright. Each tab renders its own read. Email reveal lasts 60 s and is audited with a reason; operations cannot reveal (users.spec.ts). Disable, restore and force sync are tested (user-actions.test.tsx). |
| Integrations (BO) | 🟡 tested (EXT: Google/Entra live) | BO-E2E-07…10 (operations tag) · `apps/backoffice/e2e/operations.spec.ts`, `apps/backoffice/src/app/__tests__/module-pages.test.tsx`, `supabase/functions/admin-api/tests/routes.test.ts`, `supabase/tests/database/230_admin_api_bridge.test.sql`, `supabase/tests/database/300_threats_admin.test.sql` | Google/Entra (live) | Where: container unit, container Deno, tier C pgTAP, CI Playwright; owner. Integration matrix, account detail and force sync on the contract mock; no admin function touches provider credentials (300_threats_admin). |
| Sync & Jobs | ✅ tested | IT-JOB-01…06, BO-E2E-07…10 (operations tag) · `apps/backoffice/e2e/operations.spec.ts`, `apps/backoffice/src/components/__tests__/contract-gaps.test.tsx`, `supabase/functions/_shared/jobs/runner.test.ts`, `supabase/tests/database/090_jobs_scheduler.test.sql`, `supabase/tests/integration/jobs.test.ts` | — | Where: container unit, container Deno, tier C pgTAP, tier C+ / CI tier A integration, CI Playwright. A dead-letter job is retried with a reason and shows its correlation chain; a running job refuses cancel and says why (operations.spec.ts); claim, lease and back-off are tested (090_jobs_scheduler). |
| Briefings (BO) | 🟡 tested (EXT: Anthropic) | BO-E2E-07…10 (operations tag) · `apps/backoffice/e2e/operations.spec.ts`, `apps/backoffice/src/app/__tests__/module-pages.test.tsx`, `supabase/functions/admin-api/tests/routes.test.ts`, `supabase/tests/database/124_admin_api_smoke.test.sql` | Anthropic | Where: container unit, container Deno, tier C pgTAP, CI Playwright; owner. Regenerating today's failed briefing queues the job and writes an audit row (operations.spec.ts, briefing_regenerate in 124_admin_api_smoke); live, the model pipeline writes the regenerated content. |
| Notifications (BO) | 🟡 tested (EXT: EXPO_ACCESS_TOKEN) | UT-NTF-17 · `apps/backoffice/e2e/users.spec.ts`, `apps/backoffice/e2e/contract-gaps.spec.ts`, `apps/backoffice/src/components/__tests__/contract-gaps.test.tsx`, `supabase/functions/admin-api/tests/flows.test.ts`, `supabase/tests/database/230_admin_api_bridge.test.sql` | `EXPO_ACCESS_TOKEN` | Where: container unit, container Deno, tier C pgTAP, CI Playwright; owner. A test push inside quiet hours is stored as scheduled, never sent at once (R-13, UT-NTF-17); the dialog previews the deferral; the list is always scoped to one user (flows.test.ts). |
| AI Operations | ✅ tested | BO-E2E-15…17 (ai tag) · `apps/backoffice/e2e/ai.spec.ts`, `apps/backoffice/src/components/__tests__/contract-gaps.test.tsx`, `supabase/functions/admin-api/tests/flows.test.ts`, `supabase/tests/database/124_admin_api_smoke.test.sql` | — | Where: container unit, container Deno, tier C pgTAP, CI Playwright. Metrics come from aggregates, never content; a forbidden model family is refused before sending (R-02); a model probe without the provider key is refused, never faked. |
| AI Costs | 🟡 tested (EXT: Anthropic admin key) | BO-E2E-15…17 (ai tag) · `apps/backoffice/e2e/ai.spec.ts`, `supabase/functions/_shared/ai/budget.test.ts`, `supabase/functions/worker/handlers/intel.test.ts`, `supabase/tests/database/061_ai_budget.test.sql`, `supabase/tests/database/20260924003000_admin_contract_gaps.test.sql` | Anthropic admin key (OpenAI admin key when routed to OpenAI) | Where: container Deno, tier C pgTAP, CI Playwright; owner. Reconciliation drift above 5 % is degraded, and missing keys report as needing credentials (intel.test.ts T-5.17); per-profile cost estimate (R-18); planned EF-AI-02 → providers/anthropic.test.ts. |
| Prompt Management | ✅ tested | BO-E2E-15…17 (ai tag) · `apps/backoffice/e2e/ai.spec.ts`, `apps/backoffice/src/app/__tests__/module-pages.test.tsx`, `supabase/functions/worker/handlers/ai_eval.test.ts`, `supabase/tests/database/001_structure.test.sql`, `supabase/tests/database/20260924003500_gap4.test.sql` | — | Where: container unit, container Deno, tier C pgTAP, CI Playwright. One active version per key, with immutable active content (planned DB-28); activation needs a reason and the ai-eval gate runs on the fixture baseline. |
| Subscriptions (BO) | 🟡 tested (EXT: RevenueCat v2) | — · `apps/backoffice/src/app/__tests__/module-pages.test.tsx`, `apps/backoffice/e2e/a11y.spec.ts`, `supabase/functions/admin-api/tests/routes.test.ts`, `supabase/tests/database/124_admin_api_smoke.test.sql`, `supabase/tests/database/220_business_billing.test.sql` | RevenueCat v2 | Where: container unit, container Deno, tier C pgTAP, CI Playwright; owner. Playwright only renders /subscriptions with data and runs axe (planned BO-E2E-21 not built); list, metrics and trial stream are tested in 124_admin_api_smoke. |
| Entitlements | ✅ tested | UT-ENT-01…14, BO-E2E-22…26 (admin-actions tag) · `apps/backoffice/e2e/admin-actions.spec.ts`, `apps/backoffice/src/components/__tests__/module-actions.test.tsx`, `supabase/functions/admin-api/tests/flows.test.ts`, `supabase/tests/database/070_notifications_business.test.sql`, `packages/domain/test/entitlements/effective.test.ts` | — | Where: container unit, container Deno, tier C pgTAP, CI Playwright. Support may grant only 1 or 7 days; super_admin grants and revokes 30 days (admin-actions.spec.ts); stacking is tested in 070. |
| Referrals (BO) | ✅ tested | DB-19 · `apps/backoffice/src/app/__tests__/module-pages.test.tsx`, `apps/backoffice/e2e/a11y.spec.ts`, `supabase/functions/admin-api/tests/routes.test.ts`, `supabase/tests/database/124_admin_api_smoke.test.sql`, `supabase/tests/database/221_referrals.test.sql` | — | Where: container unit, container Deno, tier C pgTAP, CI Playwright. Review approve/reject with no double reward (referral_review in 124, and 221); Playwright only renders /referrals (planned BO-E2E-23 not built). |
| Support | 🟡 tested (EXT: email provider) | BO-E2E-11…14 (support tag), EF-PUB-01, CT-05 · `apps/backoffice/e2e/support.spec.ts`, `apps/backoffice/src/app/__tests__/bff-and-support-access.test.tsx`, `supabase/functions/admin-api/tests/flows.test.ts`, `supabase/functions/public-api/support.test.ts`, `supabase/tests/database/121_audit_admin_guard.test.sql` | email provider (`EMAIL_PROVIDER`/`EMAIL_API_KEY`; `EMAIL_INBOUND_BASIC_AUTH` for replies) | Where: container unit, container Deno, tier C pgTAP, CI Playwright; owner. Support Access is granted with step-up, shows scoped content and is revoked (R-09); without the email API a reply stores nothing (flows.test.ts). |
| Feedback (BO) | ✅ tested | — · `apps/backoffice/src/app/__tests__/module-pages.test.tsx`, `apps/backoffice/e2e/a11y.spec.ts`, `supabase/functions/admin-api/tests/routes.test.ts`, `supabase/tests/database/230_admin_api_bridge.test.sql`, `supabase/tests/database/124_admin_api_smoke.test.sql` | — | Where: container unit, container Deno, tier C pgTAP, CI Playwright. Triage and reveal (feedback_update and POST /feedback/:id/reveal cases); Playwright only renders /feedback (planned BO-E2E-25 not built). |
| Feature Flags | ✅ tested | BO-E2E-18/19 (flags tag) · `apps/backoffice/e2e/flags.spec.ts`, `apps/backoffice/e2e/contract-gaps.spec.ts`, `supabase/functions/admin-api/tests/routes.test.ts`, `supabase/functions/worker/handlers/ai-flags.test.ts`, `supabase/tests/database/070_notifications_business.test.sql` | — | Where: container Deno, tier C pgTAP, CI Playwright. Targeting, preview, and a kill switch that needs the typed key and re-enables with a reason; ai_ops is limited to `ai.*` keys; evaluate_flag rules (R-10). |
| Announcements | ✅ tested | E2E-S-19 · `apps/backoffice/src/app/__tests__/module-pages.test.tsx`, `apps/backoffice/e2e/a11y.spec.ts`, `supabase/functions/admin-api/tests/routes.test.ts`, `supabase/tests/database/124_admin_api_smoke.test.sql`, `apps/mobile/test/states/today.test.tsx` | — | Where: container unit, container Deno, tier C pgTAP, CI Playwright, CI Maestro (pending). Upsert, publish live and cancel run in SQL, and dismiss_announcement in 160_user_rpcs (planned DB-29). Playwright only renders it, light and dark (planned BO-E2E-27 not built). |
| Data Requests | ✅ tested | DB-11, BO-E2E-20/21 (privacy tag) · `apps/backoffice/e2e/privacy.spec.ts`, `apps/backoffice/src/app/__tests__/module-pages.test.tsx`, `supabase/functions/worker/handlers/privacy.test.ts`, `supabase/tests/database/250_privacy_engine.test.sql` | — | Where: container unit, container Deno, tier C pgTAP, CI Playwright. A failed export is retried from its failed step (privacy.spec.ts); step resume and the schema-driven zero-rows check (250_privacy_engine). |
| Audit Logs | ✅ tested | BO-E2E-20/21 (privacy tag) · `apps/backoffice/e2e/privacy.spec.ts`, `apps/backoffice/src/app/__tests__/module-pages.test.tsx`, `supabase/tests/database/121_audit_admin_guard.test.sql`, `supabase/tests/database/300_threats_admin.test.sql` | — | Where: container unit, tier C pgTAP, CI Playwright. UPDATE and DELETE are rejected and the hash chain stays continuous (121); verification detects a deleted or forged row (300_threats_admin); the view is read-only. |
| System Health | 🟡 tested (EXT: all provider credentials) | IT-JOB-26 · `supabase/functions/health/app.test.ts`, `supabase/functions/health/probes/google_oauth.test.ts`, `supabase/functions/worker/handlers/health_check.test.ts`, `supabase/tests/integration/health.test.ts`, `apps/backoffice/e2e/contract-gaps.spec.ts` | all provider credentials | Where: container Deno, tier C+ / CI tier A integration, CI Playwright; owner. A missing credential is never green ("no fake green"; planned EF-HLT-01 not tagged); Google 100-user cap probe (KPL-32); app versions say Sentry is not configured. |
| Admin Users | 🟡 tested (EXT: email provider) | BO-E2E-22…26 (admin-actions tag) · `apps/backoffice/e2e/admin-actions.spec.ts`, `supabase/functions/admin-api/tests/flows.test.ts`, `supabase/tests/database/121_audit_admin_guard.test.sql`, `scripts/__tests__/admin-bootstrap.test.ts` | email provider | Where: container unit, container Deno, tier C pgTAP, CI Playwright; owner. Invites need step-up and the admin's own row is protected; last super_admin guard (121); without email credentials an invite is refused before any change (flows.test.ts). |
| Global Search | ✅ tested | — · `apps/backoffice/src/components/__tests__/command-palette.test.tsx`, `supabase/functions/admin-api/tests/routes.test.ts`, `supabase/tests/database/120_admin_rbac.test.sql`, `supabase/tests/database/124_admin_api_smoke.test.sql` | — | Where: container unit, container Deno, tier C pgTAP. command_search finds an exact email or id, never free text; at least 3 characters or an exact uuid goes through the read proxy; no Playwright search (planned BO-E2E-33 not built). |
| Command Palette | ✅ tested | — · `apps/backoffice/src/components/__tests__/command-palette.test.tsx`, `apps/backoffice/e2e/logout.spec.ts`, `apps/backoffice/e2e/a11y.spec.ts` | — | Where: container unit, CI Playwright. Ctrl+K lists pages and commands; a destructive command opens the confirmation and never executes; "Tüm oturumlardan çık" runs from the palette (logout.spec.ts); axe passes with it open. |
| Dark Mode (BO) | ✅ tested | BO-E2E-34 (a11y tag) · `apps/backoffice/e2e/a11y.spec.ts`, `apps/backoffice/src/actions/__tests__/preferences-session.test.ts`, `apps/backoffice/src/app/__tests__/layouts.test.tsx` | — | Where: container unit, CI Playwright. The toggle persists across reload (server-rendered data-theme) and axe passes in dark on 6 module pages; planned BO-E2E-32 and VIS-02 not built. |
| Privacy controls (BO) | ✅ tested | — · `apps/backoffice/e2e/users.spec.ts`, `apps/backoffice/src/components/__tests__/masked-value.test.tsx`, `apps/backoffice/src/lib/__tests__/sentry-scrub.test.ts`, `supabase/tests/database/120_admin_rbac.test.sql`, `supabase/tests/database/300_threats_admin.test.sql` | — | Where: container unit, tier C pgTAP, CI Playwright. users_list returns only masked emails (planned DB-14, 120_admin_rbac); a reveal needs a reason and is audited; AI feedback comments stay hidden until revealed (contract-gaps.spec.ts). |
| Server pagination | ✅ tested | — · `apps/backoffice/src/components/__tests__/data-table.test.tsx`, `apps/backoffice/src/components/data-table/__tests__/url-state.test.ts`, `supabase/functions/admin-api/tests/routes.test.ts`, `supabase/tests/database/124_admin_api_smoke.test.sql`, `apps/backoffice/e2e/users.spec.ts` | — | Where: container unit, container Deno, tier C pgTAP, CI Playwright. Page, size, sort and filters round-trip in the URL and reach admin-api as p_page and p_page_size; users_list(page, size, sort, filter) runs in SQL (planned BO-E2E-35 not built). |
| Responsive landing | ✅ tested | WEB-E2E-01, WEB-E2E-10 · `apps/web/e2e/landing.spec.ts`, `apps/web/e2e/responsive.spec.ts`, `apps/web/test/pages/site-pages.test.tsx` | — | Where: container unit, CI Playwright. No horizontal scroll at any tested width, the nav collapses below 768 px and tap targets are at least 44 px; WEB-E2E-18 (web-visual, VIS-01) not built. |
| Pricing | ✅ tested | WEB-E2E-03, EF-PUB-01, CT-05 · `apps/web/e2e/pricing.spec.ts`, `apps/web/test/pricing.test.ts`, `apps/web/test/components/PricingPlans.test.tsx`, `supabase/functions/public-api/site.test.ts` | — | Where: container unit, container Deno, CI Playwright. The Free vs Pro table matches M§44. Prices come from the store config with a "mağaza fiyatı" note, and there is no trial line without an intro offer. Limits come from GET /plans (PUB-05). |
| Privacy (web) | ✅ tested | WEB-E2E-04 · `apps/web/e2e/legal.spec.ts`, `apps/web/e2e/privacy-network.spec.ts`, `apps/web/test/legal.test.ts`, `apps/web/test/subprocessors.test.ts` | — | Where: container unit, CI Playwright. The Google Limited Use sentence is verbatim in TR and EN, AI sub-processors and retention are listed; there are no third-party requests or cookies (privacy-network.spec.ts). |
| Terms | ✅ tested | WEB-E2E-04 · `apps/web/e2e/legal.spec.ts`, `apps/web/test/legal.test.ts`, `apps/web/test/pages/site-pages.test.tsx` | — | Where: container unit, CI Playwright. Version and effective date are rendered, TR/EN section ids match, and the page links to pricing, privacy, data deletion and the store subscription pages. |
| Data deletion (web) | 🟡 tested (EXT: SMTP) | WEB-E2E-06, EF-PUB-01 · `apps/web/e2e/data-deletion.spec.ts`, `apps/web/test/components/flows.test.tsx`, `supabase/functions/public-api/data-deletion.test.ts`, `supabase/tests/database/222_public_api.test.sql` | SMTP | Where: container unit, container Deno, tier C pgTAP, CI Playwright; owner: REL-12. The flow goes email, OTP, typed confirmation, then queued; an unknown email gets the same neutral answer and 5 wrong codes lock it; the OTP is sent by Supabase Auth over custom SMTP. |
| Support (web) | ✅ tested | WEB-E2E-05, EF-PUB-01, CT-05 · `apps/web/e2e/support.spec.ts`, `apps/web/test/components/forms.test.tsx`, `supabase/functions/public-api/support.test.ts`, `supabase/tests/database/222_public_api.test.sql` | — (Turnstile optional) | Where: container unit, container Deno, tier C pgTAP, CI Playwright. A valid submission returns a reference and sends only contract fields; 429, 5xx and offline copy; honeypot and IP/e-mail hash limits (PUB-01). |
| App CTA | 🟡 tested (EXT: APPLE_TEAM_ID, Play SHA-256, IOS_APP_STORE_ID) | WEB-E2E-02, WEB-E2E-07, WEB-E2E-08, WEB-E2E-09 · `apps/web/e2e/cta.spec.ts`, `apps/web/e2e/well-known.spec.ts`, `apps/web/e2e/app-link.spec.ts`, `apps/web/test/store-links.test.ts`, `apps/web/test/well-known.test.ts` | `APPLE_TEAM_ID`, Play SHA-256, `IOS_APP_STORE_ID` | Where: container unit, CI Playwright; owner. AASA and assetlinks are built from env values; desktop shows a QR, mobile shows store buttons, and /get routes by platform; real link verification needs the owner's IDs. |
| Integrations (web) | ✅ tested | WEB-E2E-01, QG-06 · `apps/web/e2e/landing.spec.ts`, `apps/web/e2e/truthfulness.spec.ts`, `apps/web/test/pages/site-pages.test.tsx` | — | Where: container unit, CI Playwright. Integration chips are not interactive and name only supported providers. |
| Security messaging | ✅ tested | WEB-E2E-01, WEB-E2E-04, WEB-E2E-14, QG-06 · `apps/web/e2e/truthfulness.spec.ts`, `apps/web/e2e/legal.spec.ts`, `apps/web/e2e/headers.spec.ts`, `scripts/quality-gate/__tests__/run.test.ts` | — | Where: container unit, CI Playwright. No page carries a banned claim in TR or EN (QG-06), and legal pages are checked for banned claims; HSTS, CSP and the other security headers are checked on every page. |
| SEO basics | ✅ tested | WEB-E2E-12 · `apps/web/e2e/seo.spec.ts`, `apps/web/test/sitemap-robots.test.ts`, `apps/web/test/images-routes.test.tsx` | — | Where: container unit, CI Playwright. Unique titles; canonical, hreflang and OG tags; JSON-LD, sitemap and robots; WEB-E2E-17 (Lighthouse CI) not built. |

#### Planned test IDs not tagged literally

- **E2E-M-01…19, E2E-A…J, E2E-S-01…16, TST-E2E-M-01…04.** All are literal in the header comments of `apps/mobile/.maestro/flows/{m102,acceptance,screens,security}/*.yaml`. They are listed only and never counted as verification, because the emulator has not completed a full flow run.
- **mf_midday_deliver, mf_midday_skip, mf_evening_carry_over, mf_weekly_share.** Not built as separate flows. Weekly share is covered in `m102/briefing.yaml` (E2E-M-05). Midday and evening are covered by `apps/mobile/test/states/briefing.test.tsx`, `supabase/functions/_shared/services/briefings/evening-midday.test.ts` and IT-AI-08.
- **post-meeting-text.** Not a separate flow. Covered by `acceptance/F-prep-person-email-note-post-commitment.yaml`, `apps/mobile/test/states/post-meeting.test.tsx` and IT-APR-15.
- **UT-NTF-08** → `evening-midday.test.ts` ("midday without a delta is skipped") and IT-AI-08 in `worker/handlers/intel.test.ts` and `supabase/tests/integration/ai.test.ts`.
- **UT-PRI-08** → `apps/mobile/test/rules.test.tsx` ("an explicit rule overrides the AI result") and `worker/handlers/intel.test.ts` ("an explicit rule overrides the model result").
- **UT-CLS-04, UT-CLS-08.** Tagged only in `packages/domain/src/priority/engine.ts`. The behaviour is tested in `packages/domain/test/priority/engine.test.ts`, which tags only UT-CLS-01.
- **Literal but only for some numbers.** UT-AMT 01/08/09/10; UT-COM 03/04/06/07/08/11/12; UT-REF 01–11; UT-ENT 01–14; UT-NTF 01–17 without 08; UT-RBAC 01–04; UT-REM 01–11; UT-FLOW-01; UT-FUP-01; UT-WID-01.
- **EF-MAIL-01** → `supabase/functions/api/integrations.test.ts` (sanitised original mail) and `supabase/functions/_shared/security/html-sanitize.test.ts`.
- **EF-AI-02** → `supabase/functions/_shared/ai/providers/anthropic.test.ts` and `supabase/functions/_shared/ai/router.test.ts`.
- **EF-HLT-01** → `supabase/functions/health/app.test.ts`, `supabase/functions/health/probes/google_oauth.test.ts` and `supabase/functions/worker/handlers/health_check.test.ts`.
- **EF-AUTH-01, EF-ADM-01, EF-APR-01, EF-NTF-01, EF-OAUTH-01/02, EF-DEMO-01, EF-PUB-01, EF-WDG-01, EF-WH-03, EF-SEC-01, EF-AI-01.** Literal.
- **IT-OAUTH, IT-SYNC, IT-AI, IT-APR, IT-NTF, IT-PRIV, IT-RC, IT-JOB, IT-PLAN-01/02.** Literal in `supabase/tests/integration/*.test.ts`.
- **DB-25** → `060_search_memory.test.sql`. The plan named the file `060_assistant_memory`.
- **DB-28** → `001_structure.test.sql` (one active prompt per key, immutable) and `20260924003500_gap4.test.sql` (eval-gated activation). The plan named the file `061_ai_telemetry`.
- **DB-29** → `070_notifications_business.test.sql` (evaluate_flag), `160_user_rpcs.test.sql` (dismiss_announcement) and `124_admin_api_smoke.test.sql` (announcement publish/cancel).
- **DB-14** → `120_admin_rbac.test.sql` (masked users_list). The file matches the plan; the ID is not tagged.
- **DB-11, DB-19, DB-26.** Literal.
- **CT-09.** Only the JS side is built (`apps/mobile/test/widgets.test.ts`). The Kotlin (Robolectric) and Swift (XCTest) decode tests are not built.
- **VIS-01…04.** Not built (see Findings).
- **BO-E2E-01…35.** The spec tags use a different numbering from the plan (see Findings); per-module coverage is in the matrix above.
  - **Not built as separate specs, covered by unit/SQL tests:** 02 lockout, 03 invite-enrol and 04 recovery code are in `apps/backoffice/src/actions/__tests__/auth.test.ts`, `apps/backoffice/src/app/__tests__/auth-screens.test.tsx` and admin-api `cases-session.ts`. 33 palette is in `command-palette.test.tsx`. 35 states is in `module-pages.test.tsx` (data, forbidden, and error with correlation id).
  - **Not built as separate specs, render-plus-axe only in `a11y.spec.ts`:** 21 subscriptions, 23 referrals, 25 feedback, 27 announcements.
  - **Not built as a separate spec, theme persistence in `a11y.spec.ts`:** 32 settings-theme.
- **WEB-E2E-01…16, QG-06.** Literal. **WEB-E2E-17** (Lighthouse) and **WEB-E2E-18** (web-visual) are not built.
- **REL-02…16.** Owner release checks (M§153), recorded in Notes only; no repo test.

#### Gaps found while compiling the matrix

1. **The template has 75 rows, not 76.** `docs/DELIVERY_CHECKLIST.md` §9 has 77 table lines including the header and separator.
2. **VIS-01…04 are not built.** There is no `toHaveScreenshot`, no `web-visual`/`bo-visual` project, and no `apps/web/e2e/__screenshots__`, `scripts/visual/` or `.maestro/baselines/`. `m102/dark-mode.yaml` only takes screenshots.
3. **WEB-E2E-17 (Lighthouse CI) is not built.** There is no lhci config and no lighthouse step in `.github/workflows/*.yml`.
4. **CT-09 is half built.** `apps/mobile/test/widgets.test.ts` is tagged "(CT-09, JS side)". Nothing in Kotlin or Swift decodes `apps/mobile/targets/widget/golden/preview.json`.
5. **The BO-E2E tags in the spec headers do not match the TEST_PLAN/BACKOFFICE_PLAN numbering**, so literal-ID traceability is misleading. Examples: `users.spec.ts` "02…05" is planned 10–12; `rbac-matrix.spec.ts` "27" is planned 08 (27 is announcements); `dashboard.spec.ts` "01" is planned 09. The operations, ai, flags, privacy, support and admin-actions specs are off too.
6. **Four backoffice modules have no Playwright interaction test.** Subscriptions, Referrals (BO), Feedback (BO) and Announcements are only rendered and axe-checked (`apps/backoffice/e2e/a11y.spec.ts`). Their actions are tested in `module-pages.test.tsx`, the admin-api Deno cases and `124_admin_api_smoke.test.sql`.
7. **Mobile end-to-end coverage is missing.** There is no Maestro flow for midday or evening (mf_* not built), and no Maestro flow has completed an emulator run, so every mobile UI chain is proven only by jest/RNTL.
8. **The template's External Credential column is wrong for several rows.**
   - Anthropic is needed for Commitments (`services/ai/commitments.ts`), Post Meeting (`services/meetings/post.ts`), Voice (`VoiceScreen.tsx` uses the assistant stream), Search answer mode, Mail Intelligence T1 triage and AI Reply drafts.
   - Admin auth sends its code with a Supabase Auth OTP over SMTP (`apps/backoffice/src/server/auth-flow.ts`); MFA needs no credential.
   - The account-deletion confirmation uses the JOB-31 email API (`account-deletion.ts`).
9. **No feature is missing, and every feature has automated tests** (no ❌ rows).


### Architecture

- **Monorepo:**
  - pnpm 11.27.1 workspaces with a default catalog and an `expo` catalog pinned to Expo's bundled native modules, plus Turborepo.
  - Node 24 in CI (`.nvmrc`); `engines.node >= 22.13`.
  - TypeScript ~6.0.3, React 19.2.3, zod 4.6.5, `@supabase/supabase-js` 2.117.0, Next.js 16.3.6, Expo ~57.0.24 with React Native 0.86.3, vitest 4.1.11, Playwright 1.63.0, Deno 2.1.4 for Edge Functions, and Maestro 2.10.0.
  - Supply chain: `minimumReleaseAge` is honoured, Dependabot is on, and a frozen Deno lock (`supabase/functions/deno.lock`) is enforced with `--frozen` in CI and before every deploy.
- **Shared packages:** `design-tokens`, `ui`, `domain`, `validation`, `api-client`, `i18n` and `config`. `domain` and `validation` are Deno-safe and are imported by the Edge Functions through generated import maps (`pnpm functions:imports`).
- **Architecture decisions and differences from the plan:** [ARCHITECTURE.md](ARCHITECTURE.md) (its "Differences from the plan" section) and [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md). The main differences are:
  - Maestro runs on one Android emulator, not four shards. See [TESTING.md](TESTING.md#differences-from-the-plan).
  - The Edge gate is 80% `_shared` line coverage, per IMPLEMENTATION_PLAN T-12.04.
  - There is no PGlite tier.
  - `DA_FIXED_NOW` is a seeding anchor only.

### Mobile

- **Screens.** Every screen ID of SCREEN_AND_FLOW_MAP parts 1–4 has a route under `apps/mobile/app` (83 route files). Each screen has loading, empty, error, offline, retry, reconnect and partial states.
  - Checked in the container and in CI `unit` by 77 jest-expo suites (1509 tests), including one state suite per screen family (`apps/mobile/test/states/`), an accessibility route suite over every route, and pseudo-locale text expansion.
  - Coverage: 83.87% lines, 70.16% branches, 78.27% functions against a gate of 75/65/75.
- **No-Dead-Action.**
  - The inventory in [DELIVERY_CHECKLIST §4](DELIVERY_CHECKLIST.md#4-no-dead-action-inventory-m99-sreq-99) is enforced by quality gate QG-16b (`scripts/quality-gate/checks/inventory.ts`): every route file must be named by an inventory row, and every inventory target must resolve to a route file, an API route or a link prefix.
  - Two link targets (`auth/callback`, `demo/setup`) are justified in `scripts/quality-gate/route-screens.map`. Result: clean.
  - The controls deliberately left hidden, each with a reason, are listed in [DESIGN_MAPPING.md](DESIGN_MAPPING.md). One example is DEV-64, the wallet action: pass bytes need the account's bearer token, and there is no PassKit module.
- **Native modules.**
  - Local Expo modules: `notification-intelligence` (Kotlin listener with on-device signal extraction), `da-widgets` (Glance widgets and the iOS App Group bridge), `da-tts` (synth-to-file) and `da-platform` (exact alarm state, Time Sensitive, battery handoff).
  - WidgetKit and share extension targets via `@bacons/apple-targets`.
  - Where they are compiled:
    - The Kotlin sources compile in CI's Mobile E2E release build, first on run 16 and every build since.
    - The Swift sources compile only on EAS.
    - The JVM rule tests for Notification Intelligence run in CI `mobile`.
- **Mobile E2E.**
  - 57 Maestro flows (`apps/mobile/.maestro`, including M§102 E2E-M-01…20, acceptance flows A–J, screen flows S-01…22 and the security flows) are parsed by the real Maestro parser in CI and linted in the container.
  - Status of the Android emulator run in CI:
    - It builds the e2e APK, boots the emulator and installs the APK.
    - Its first full run (run 21) failed every flow at sign-in. The shared demo users hit Auth's one-code-per-60-seconds limit, and two shards re-seeded the same user under each other.
    - Fixed in `4b74183`: the harness resets the send timer and mailbox, the run uses one device, and failure reasons are printed to the log.
    - A green Maestro run is not claimed in this report.
  - iOS flows run on EAS Workflows (`apps/mobile/.eas/workflows/e2e-ios.yml`) once `EXPO_TOKEN` and the staging project exist (owner).

### Backend

- **Database.**
  - 45 forward-only migrations (`supabase/migrations`), kept PostgreSQL 16-compatible.
  - RLS is enabled and forced on every table, users can update only the columns granted to them, security-definer functions live in `private` with an empty `search_path`, and the Realtime publication is empty (R-19).
  - Checked:
    - Container: 35 pgTAP files with 1206 assertions (tier C). plpgsql_check reports 0 errors, squawk reports 0 issues, and `database.types.ts` has no drift.
    - CI: tier A (`db` job), with `supabase db reset` from zero, the pgTAP suites, the lint and the type-drift check.
- **Edge Functions.**
  - Hono routers.
  - The `jobs` queue: `claim_jobs` with `SKIP LOCKED`, leases, exponential backoff, dead letters and correlation IDs.
  - `scheduler_tick()` from pg_cron (8 cron jobs).
  - Idempotent webhooks: Pub/Sub OIDC, channel-token HMAC, hashed Graph `clientState` and the RevenueCat secret, with replay dedupe in `webhook_events`.
  - Checked:
    - Container: 1499 Deno tests, with `_shared` line coverage at 80.85% against an 80% gate.
    - CI: the `functions` job.
    - Tier C+ integration (container): 99 pass, and 4 are CI-only because they need Storage or real Auth.
    - Tier A integration (CI): green on `b66acb3` with real GoTrue, ES256 user tokens and the Kong 8 KB request-line limit. All data-sized PostgREST list filters are chunked (`_shared/db/in-chunks.ts`).
- **Providers.**
  - Google: Gmail, Calendar and Tasks, including free/busy.
  - Microsoft Graph: Mail, Calendar, To Do and `getSchedule`.
  - Apple EventKit and Android CalendarContract, through device snapshots.
  - A deterministic demo adapter, refused in production unless explicitly allowed.
- **Provider-level idempotency markers for approved writes:**
  - Gmail: an `approval-{id}` Message-ID, checked with `rfc822msgid:` before a retry.
  - Google Calendar: a deterministic event id.
  - Graph events: `transactionId`.
  - Graph mail: an extended property checked in Sent Items.
  - Tasks and To Do: the stored provider id plus a marker search.
  - These are checked against recorded fixtures and the mock provider server (container, CI). Live provider writes are owner checks (REL-09).

### AI

- **Pipeline** ([AI_PIPELINE.md](AI_PIPELINE.md)): T0 deterministic filters and parsers, then T1 small-model triage (micro-batches of up to 5), then T2 large-model work only for survivors, then zod validation, then grounding, then persistence with provenance.
  - Output is grounded: quotes are checked against the source, and dates and amounts are re-parsed from the quotes.
  - Guards: a prompt-injection pre-scan, output guards for URLs, e-mails, phones and UUIDs, and read-only assistant tools. Write intents become server-built proposals that need approval.
- **Routing.**
  - Routing lives in `ai_model_config`: seeded, editable in the backoffice, audited, with `balanced` and `lean` profiles per plan.
  - Model IDs are configuration only. Replacing a retired model is a backoffice change, never a code change.
  - The T3 escalation is behind `ai.model.opus_escalation`.
  - The generated routing table is in AI_PIPELINE.md.
- **Embeddings:** 1024 dimensions (R-01) from the Voyage adapter, with a disaster-recovery re-embed path into `memory_chunks.embedding_dr` and FTS-only degradation.
- **Budgets and kill switches:** per-plan budgets from `plan_limits`, global and per-provider/feature/model kill switches (R-10), a per-user result cache, and nightly cost reconciliation.
  - Checked: domain and Edge unit tests plus the AI integration tests IT-AI-01…12 (container, CI).
- **Evals.**
  - Fixture baselines run in the container (`pnpm ai:eval`).
  - The `ai_eval` job and the nightly `ai-eval.yml` record live results per prompt version and gate activation. They need the `staging` environment's Anthropic, OpenAI and Voyage keys (owner) and fail with "External credential required" until those exist.
  - The retrieval, grounding, claims and speech sets keep only their fixture gates.
- **Pricing vs AI cost of goods (owner decision, [AI_PIPELINE_PLAN §3.5](AI_PIPELINE_PLAN.md) ADR-08a).**
  - A typical Pro user is estimated to cost:
    - about $2.24/month on `balanced`: 77% of monthly net, 124% of annual net;
    - about $1.02/month on `lean`: 35% and 57%.
  - The target is at most 25% of net.
  - With the planned prices, `balanced` exceeds the target, and on the annual plan it costs more than the net revenue.
  - The owner decides the store prices and the default profile per plan; the profile is switchable in the backoffice without a release.
  - `ai.budget.org_daily_usd` is seeded at 50 USD per day, for the owner to confirm.

### Backoffice

- **Modules:** every module of BACKOFFICE_PLAN §46: dashboard, users (masked, audited reveal), support with Support Access grants (R-09), integrations, sync and jobs (bulk retry, live polling), briefings, notifications (test push previewing quiet hours), AI operations, costs and models, prompts (with eval runs), AI feedback, subscriptions and entitlement grants, referrals, feedback, feature flags, announcements, data requests, audit logs, system health (real probes; not-configured is never green), admin users and settings.
- **Features:** a command palette, server-side pagination, and a dark theme saved per admin.
- **Auth:**
  - An email one-time code plus mandatory TOTP (`aal2`), with a second TOTP device and recovery codes.
  - An idle timeout of 30 minutes and an absolute session limit of 12 hours.
  - `__Host-` cookies with SameSite=Strict, and an Origin check in the proxy and in every server action.
  - Security headers: COEP, COOP and CORP.
- **Checked:**
  - Container: 554 vitest tests (86.72% line coverage) and the admin-api Deno suites.
  - CI: Playwright `backoffice`, including the RBAC matrix spec.
  - Tier C: pgTAP for `admin_api` (non-admins and `aal1` are rejected, the last super_admin is guarded, the audit log is immutable and hash-chained).
- **Sentry:** the backoffice reports errors only when `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are set, and scrubs them first.

### Marketing Website

- **Pages:**
  - Landing, pricing (store-authoritative price copy, no trial claim), privacy (including the Google API Services Limited Use statement and the AI sub-processors), terms, support (FAQ plus a contact form to `public-api`), data deletion (email-OTP verified), the referral landing, and the OAuth and app-link fallbacks.
  - Both `tr` and `en`, plus `sitemap.xml`, `robots.txt` and OG images.
- **Checked:**
  - Container: 165 vitest tests (97.67% line coverage) and `next build`.
  - CI: Playwright `web` (landing, CTA, pricing, legal, data deletion, referral, app links, headers, i18n, keyboard, a11y, 404) and the ZAP baseline in security-nightly.
- **Not measured:** Lighthouse scores, because no Lighthouse run is wired into CI.
- **Known build-time dependency:** Google Fonts are fetched at build time by `next/font/google`. One CI build failed on that fetch (see [Security](#security) residual risks).

### Security

- **Quality gate** (`pnpm quality-gate`, 33 checks with a self-test; container and CI `lint`). It covers:
  - banned placeholder and TODO patterns, and "coming soon" copy;
  - empty handlers and fake success;
  - secrets in client bundles and the client/server env split;
  - RLS forced;
  - Actions pinned by SHA;
  - i18n key integrity;
  - canonical-name drift;
  - the No-Dead-Action inventory.
- **Security job (CI):** a gitleaks scan over the full history, a bundle secret scan over the web, backoffice and mobile outputs (`scan:bundles`, also clean in the container), the env split, and header checks.
- **security-nightly (CI)** is green on `4b74183`, which includes all the gap-closure code:
  - `pnpm security:audit`: high and critical advisories block, and the allow-list entries expire.
  - CodeQL `security-extended`: 0 results since the remediation merge `e633f43`; SARIF findings at severity 7.0 or above block.
  - ZAP 2.17.0 baseline against web and backoffice.
- **Threat model:** each threat in [SECURITY.md](SECURITY.md) has a mitigation and a residual risk. Covered by the threat-model suites: pgTAP `300_threats_*` and the Deno and integration threat tests.
- **ReDoS regression tests** measure growth rate on thread CPU time, so they don't trip under load.
- **Residual risks:**
  - The SSRF guard resolves DNS on each hop but cannot pin the address the fetch then connects to, so DNS rebinding between resolve and connect is possible (SECURITY.md).
  - Web and backoffice builds depend on Google Fonts being reachable at build time.
  - Microsoft has no per-app token revoke, so users get guidance to remove the app themselves.
  - Gmail's restricted scope is limited to 100 users until CASA is complete.

### Privacy

- **Features:**
  - Export: an asynchronous job builds a zip with JSON per entity and no secrets, served as a signed URL valid for 24 hours.
  - History deletion and account deletion: both need re-authentication and confirmation, and run as queued jobs. Account deletion stops watches, revokes Google and SIWA tokens, gives Microsoft guidance, purges the database, storage, embeddings and tokens, deletes the RevenueCat customer, wipes the local cache and hashes the audit subject.
  - Retention: 30, 90 or 365 days, or until deleted, enforced by the retention job, including embeddings and storage objects.
  - Five Data Source Controls (mail body, attachments, calendar, contacts, coarse location) enforced by one guard on every model path, the result cache key, embeddings and retrieval.
  - Push payloads carry only `{type, entity_id, deeplink}`.
  - Raw mail bodies are never stored; "Orijinal Mail" is fetched on demand.
- **Checked:**
  - Container: Deno privacy tests and tier C+ IT-PRIV-01…05.
  - CI: tier A, including IT-PRIV-02 and IT-PRIV-04.
  - Mobile state suites.
  - The truthful-claims register in [PRIVACY.md](PRIVACY.md).
- **Owner:** the RevenueCat customer-delete endpoint is to be verified against RevenueCat's documentation before launch, and REL-12 is to be run.

### Tests

Where each tier ran, with counts at `1f85dfb` (details in [TESTING.md](TESTING.md)):

| Tier | Where | Result |
| --- | --- | --- |
| Unit, TS workspaces (vitest / jest / node:test) | container; CI `unit` | domain 1539 (lines 99.06%), validation 1299 (97.78%), i18n 279 (100%), design-tokens 385 (100%), api-client 140 (94.65%), ui 723 (97.47%), web 165 (97.67%), backoffice 554 (86.72%), mobile 1509 (83.87%), config 20; scripts 139 |
| Edge (Deno) | container; CI `functions` | 1499 pass; `_shared` lines 80.85% (gate 80%) |
| Database (pgTAP) | container tier C (PG16 + shim); CI tier A `db` | 35 files / 1206 assertions; plpgsql_check 0 errors; squawk 0 |
| Integration | container tier C+; CI tier A `integration` | 99 pass / 4 CI-only (container); tier A green on `b66acb3` |
| Web E2E (Playwright) | CI `web` | green on `b66acb3` |
| Backoffice E2E (Playwright, contract project) | CI `backoffice` | green on `b66acb3` |
| Mobile E2E (Maestro, Android) | CI Mobile E2E | not yet green (see [Mobile](#mobile)) |
| Mobile E2E (Maestro, iOS) | EAS | not run (owner: `EXPO_TOKEN`, staging project) |
| Security (audit, CodeQL, ZAP) | CI security-nightly | green on `4b74183` |
| Live AI evals | CI `ai-eval` (staging) | not run (owner: staging keys) |

**Planned suites not built:**
- VIS-01…04, the screenshot comparisons for web, backoffice and mobile.
- WEB-E2E-17, Lighthouse CI.
- CT-09 native decode tests: Robolectric and XCTest. Only the JS side exists.
- The separate midday and evening Maestro flows (`mf_*`). They are covered by the jest, Deno and integration suites instead.
- Playwright interaction specs for backoffice subscriptions, referrals, feedback and announcements. These are render-plus-axe only; their actions are covered by the unit, admin-api and pgTAP tests.
- The BO-E2E numbers in the backoffice spec headers don't follow TEST_PLAN's numbering. The matrix above maps them.

**Flake log:**
- The ReDoS timing tests used wall-clock budgets and tripped under parallel load. They now check growth rate on CPU time.
- The `090_jobs_scheduler` pgTAP suite collided with the live `da_health_check` cron. The suite now takes the scheduler advisory lock and then locks the table.
- The emulator failed in CI after the framework restarted post-boot. A readiness wait and install retries fixed it.
- The CI security job failed once fetching Google Fonts. The push run of the same commit passed.
- The backoffice eval-run spec (`e2e/ai.spec.ts`) failed on `17b7937`. This was a test bug, not a flake: the toast text also matched the `aria-live` announcer, and during streaming a hidden copy of the version panel can sit next to the swapped-in one. The assertions now take the first match, as the sibling specs do. It passed 12/12 when repeated locally.

### Build

- **Container** (`pnpm mobile:check`): `next build` for web and backoffice, the mobile `expo export` bundles, the prebuild smoke tests (plist, privacy manifest, Android manifest and every config plugin, across four variants) and the bundle scans.
- **CI:**
  - The same checks run in `mobile`, `web` and `backoffice`.
  - The Android e2e release APK (`expo prebuild` + Gradle `assembleRelease`) builds in Mobile E2E. Every Kotlin module compiles.
- **EAS** (owner, needs `EXPO_TOKEN`): the `development`, `preview`, `e2e` and `production` profiles, and the iOS builds. No EAS build IDs exist yet.

### External Credentials Required

None of the production credentials are configured in this repository. Every adapter reports `external_credential_required`: the app shows "Harici kimlik bilgisi gerekli" and System Health shows `not_configured`.

- **Full list:** [DELIVERY_CHECKLIST §8](DELIVERY_CHECKLIST.md#8-external-manual-steps-and-credentials) (D1 … GH1). The variable names are in `.env.example`, and [KNOWN_PLATFORM_LIMITATIONS §12](KNOWN_PLATFORM_LIMITATIONS.md) lists the steps each limitation implicates.
- **Additions made during the build**, beyond §8:
  - `VOYAGE_TRAINING_OPT_OUT_CONFIRMED`: required in preview and production when Voyage is configured.
  - The Google progressive scope `calendar.events.freebusy` must be added to the consent screen and the verification submission.
  - The GitHub `staging` environment (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `VOYAGE_API_KEY`) for `ai-eval`.
  - The GitHub `production` environment with required reviewers, plus `APPLE_TEAM_ID`, `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_PRIVATE_KEY` and `APPLE_SIWA_SERVICES_ID` for the SIWA secret rotation.
  - `REVENUECAT_TEST_STORE_API_KEY` as a CI variable for the E2E paywall.
  - Optional: `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` for the backoffice, and `SENTRY_AUTH_TOKEN` for source maps.

### Deployment Steps

The full procedure is in [DEPLOYMENT.md](DEPLOYMENT.md). In order:

1. **Supabase:**
   1. One-time project setup: DEPLOYMENT.md §1, with the keys, extensions, MFA, the access-token hook, SMTP and Vault.
   2. Then `deploy-supabase.yml` on the protected `production` environment. It is a dry run by default. It checks the secrets (`scripts/deploy/check-secrets.ts`), then runs `db push`, then `config push` (after minting a fresh SIWA client secret), then deploys the functions with `--use-api` from the frozen Deno lock.
2. **Provider endpoints:** register the OAuth redirect, Pub/Sub push, Graph notification and RevenueCat webhook URLs (DEPLOYMENT.md §1).
3. **First administrator:** bootstrap it.
4. **Vercel:** `da-web` and `da-backoffice` as separate projects, with env per INTEGRATION_PLAN §15.
5. **EAS:** build and submit with the `production` profile.

**Rollback:** functions are redeployed from the previous commit. Migrations are forward-only, so a fix goes in as a new migration.

### Known Platform Limitations

The full register is [KNOWN_PLATFORM_LIMITATIONS.md](KNOWN_PLATFORM_LIMITATIONS.md). Visible to users:

- **iOS:**
  - Notification Intelligence doesn't exist on iOS; the feature is hidden there.
  - Device calendars sync only while the app runs; the provenance line shows the last device sync.
- **Refresh budgets:** WidgetKit refresh budgets and iOS background task timing are not guaranteed.
- **Provider limits:**
  - Google Tasks has date-only due dates and no push (it is polled every 15 minutes).
  - Microsoft has no per-app revoke.
  - Gmail is limited to 100 users until CASA.
  - Attendee availability is shown only where the provider shares free/busy.
- **Android:**
  - Android 13+ restricted settings apply to a sideloaded listener.
  - Android 15 redacts OTP notifications.
- **Voice:** voices and offline speech models depend on what the device has installed; the app guides the install.
- **Unsupported:** RTL.
- **Offer-dependent:** store trials appear only where configured.

### Remaining Manual Store Steps

The owner completes these from [DELIVERY_CHECKLIST §7](DELIVERY_CHECKLIST.md#7-release-checklist-m153-and-store-checklist) and [STORE_CHECKLIST.md](STORE_CHECKLIST.md):

- **Accounts and agreements:** the Apple Developer Program and App Store Connect agreements, tax and banking; the Google Play Console account and payments.
- **Subscription products:** `da_pro_monthly` and `da_pro_annual`, with an introductory offer only if chosen, connected to RevenueCat.
- **Google verification:** brand verification, the restricted-scope justification and the annual CASA assessment for `gmail.readonly`; the consent screen update for `calendar.events.freebusy`.
- **Microsoft:** publisher domain and publisher verification.
- **Store forms:** privacy labels and the Data safety form (answers in SECURITY_AND_PRIVACY_PLAN §4.12–4.13), the Notification Listener and exact-alarm declarations, and the encryption, background-mode and review notes.
- **Assets:** store screenshots and ads rendered from demo builds (P:09, ST-20), and the official store badge artwork on the web.
- **Reviewer access:** a Google Workspace mailbox and an Outlook.com test account.
- **Release run:** the release checklist REL-01…REL-20 on TestFlight and on Play's internal track with real sandbox accounts. Its issue must be closed with evidence before promotion.

### Requirement status

The 720 rows of the [DELIVERY_CHECKLIST §2](DELIVERY_CHECKLIST.md#2-requirement-traceability-matrix) traceability matrix were stamped with their status and evidence against the code and test suites at `4b74183`. The totals are also in [§1.5](DELIVERY_CHECKLIST.md#15-totals-at-completion-t-1210).

| Source | Rows | tested | implemented | not built | rejected |
| --- | --- | --- | --- | --- | --- |
| REQ-* (M§1–§154) | 573 | 513 | 59 | 1 | 0 |
| SREQ-01…104 | 104 | 95 | 5 | 1 | 3 |
| C-01…C-37, P-01…P-06 | 43 | 41 | 2 | 0 | 0 |
| **Total** | **720** | **649** | **66** | **2** | **3** |

- **Not built:**
  - REQ-MKT-01 (store screenshot and social ad concepts) and SREQ-97 (three 9:16 social ads).
  - The screenshots are an owner step, rendered from demo builds (STORE_CHECKLIST, DESIGN_MAPPING DEV-38). The ads are not produced.
- **Implemented but not tested by an automated suite:**
  - Native widget rendering (REQ-WIDGET-01…03, C-25; owner check REL-13).
  - Mobile E2E proof that depends on Maestro (REQ-TEST-03, REQ-TEST-04, REQ-E2EF-01, SREQ-100).
  - Performance rows REQ-PERF-02, -03, -06 and -08.
  - Visual baselines (REQ-DES-08; VIS-01 is not built).
  - Rows that need the live domain, such as `admin.<domain>`.
  - Process and document rows.
- **Verified:** none. That needs the owner's release run REL-01…20.

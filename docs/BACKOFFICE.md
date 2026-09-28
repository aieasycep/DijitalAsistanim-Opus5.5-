# Backoffice

Documented at `ec14e92`. The admin panel at `admin.<domain>` as built: [`apps/backoffice`](../apps/backoffice) (Next.js 16 App Router, server components and server actions), the [`admin-api`](../supabase/functions/admin-api) Edge Function and the `admin_api` SQL schema. Roles and permissions are in [BACKOFFICE_RBAC.md](BACKOFFICE_RBAC.md); the plan is [BACKOFFICE_PLAN.md](BACKOFFICE_PLAN.md); the system-wide picture is in [ARCHITECTURE.md](ARCHITECTURE.md) and [SECURITY.md](SECURITY.md).

## Topology

```
Admin browser ── HTML/RSC only, no Supabase client, no token readable by JS
   │  sealed httpOnly cookies (__Host-da_admin*)
   ▼
apps/backoffice (Vercel, Node runtime)
   src/proxy.ts            nonce CSP + security headers, Origin check on non-GET, pre-auth throttle,
                           sealed Supabase session (getClaims), /login · /mfa redirects
   server components       → src/server/admin-api.ts (server-only fetch client)
   server actions          → src/server/action.ts (adminAction wrapper)
   GET /api/admin/*        → allow-listed read proxy for client polling (x-da-activity: background)
   │  x-da-bff: ADMIN_BFF_SECRET · Authorization: Bearer <admin JWT> · x-correlation-id
   ▼
admin-api Edge Function (verify_jwt=false, JWT verified in code; browser Origin refused)
   │  PostgREST rpc on schema admin_api with the admin's JWT + x-da-admin-gateway header;
   │  service client only after the SQL gate (Auth admin operations, email, health, worker poke)
   ▼
Postgres: admin_api.* security-definer functions → private.admin_guard / require_admin(permission)
```

The backoffice holds no Supabase secret key: its server environment is `APP_ENV`, `API_PUBLIC_BASE_URL`, `ADMIN_BFF_SECRET`, `ADMIN_ORIGIN`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ([`src/env.ts`](../apps/backoffice/src/env.ts)). The two `NEXT_PUBLIC_*` values are read only in server code. The server refuses to boot when it sees a secret key, a database URL, a token-encryption key, a pepper, the admin gateway secret or a provider secret. There is no impersonation, no "log in as user", no provider-content fetch (no original mail, attachments or audio) and no bulk export of user data.

## Modules

The sidebar ([`src/lib/navigation.ts`](../apps/backoffice/src/lib/navigation.ts)) shows an entry when the admin holds any of its permissions and the route exists (a unit test checks the list against the pages on disk). Hiding is cosmetic; admin-api and SQL decide.

| Group | Route | Module | Shown with | What it does |
| --- | --- | --- | --- | --- |
| Genel | `/dashboard` | Dashboard | `dashboard.read` | KPIs, charts and ops/product panels for 24h/7d/30d/90d and a platform filter; every number is counted in SQL over the non-internal, non-demo population; each panel loads and fails on its own; a stale-rollup note after 30 min. Revenue figures need `metrics.revenue.read`. |
| Kullanıcılar | `/users` | Users | `users.read` | Masked, server-paginated list; id or id-prefix search; exact email lookup through a POST body (`/users/lookup`), never the URL. |
| | `/users/[id]/*` | User detail | `users.read` | Header with masked identity and audited reveal, "İşlemler" menu by permission, Support Access banner, and eight tabs: overview, integrations, briefings, usage, subscription (entitlement grant/revoke), referrals, support, audit. |
| | `/support`, `/support/[id]` | Support tickets | `support.read` | Tickets with status, category, source and assignee filters; notes, assignment, status and replies with `support.write`; masked contact email. |
| Operasyon | `/integrations` | Integrations | `integrations.read` | Provider × status summary, stalest-sync-first account list, account panel (granted scopes, per-resource sync state, recent jobs, webhook stats); disconnect (step-up) and watch renewal. No token or ciphertext is ever returned. |
| | `/jobs`, `/jobs/[id]` | Sync and jobs | `jobs.read` or `metrics.ops.read` | 24 h summary, dead-letter count, filtered job list with a 10 s live view (polling), retry by type policy, cancel for queued/retrying jobs, bulk retry by type + status + window (level 3 above 10 jobs), correlation trace. |
| | `/briefings` | Briefings | `briefings.read` or `metrics.ops.read` | Counts per status and kind, latency p50/p95, AI cost, template-fallback rate; rows never include briefing text; regenerate today's failed or skipped briefing. |
| | `/notifications` | Notifications | `notifications.read` or `metrics.ops.read` | Decision counts, suppression reasons, push receipt errors, decision rows (category, decision, reason; never the rendered text). The test push is sent from the user page with a quiet-hours preview; it never bypasses quiet hours. |
| Yapay Zekâ | `/ai`, `/ai/models`, `/ai/feedback` | AI operations, model config, AI feedback | `ai.read` or `metrics.ai.read` | Telemetry by feature, model, day, prompt version and routing profile (no prompt or response content); per-plan routing profile, credential presence, model slots and per-feature rows (edits validated, eval gate re-checked by admin-api); feedback counts with comments hidden until an audited `ai_feedback.reveal`. |
| | `/ai/prompts`, `/ai/prompts/[key]` | Prompt management | `prompts.read` or `ai_feedback.read` | Prompt keys with the active version; versions, diff, test, activate, rollback and archive. |
| İş | `/subscriptions` | Subscriptions | `subscriptions.read` or `metrics.revenue.read` | Store subscriptions and admin/referral grants counted separately; MRR/ARR only with `metrics.revenue.read`; resync; sanitised RevenueCat events (never the raw payload); grants with revoke; trial → paid stream. |
| | `/referrals` | Referrals | `referrals.read` or `metrics.product.read` | Funnel, bonus days and abuse flags; flagged-review queue (approve or reject with a reason). |
| Ürün | `/feedback` | Product feedback | `feedback.read` | Rows with emails and phone numbers auto-masked; the raw message needs `users.pii.reveal` and a reason; triage with `feedback.write`. |
| | `/flags` | Feature flags | `flags.read` | The R-10 keys with targeting (percentage, platform, plan, version range), kill switch (level 3, typed key) and re-enable, user overrides, archive, per-user evaluation preview, history. |
| | `/announcements` | Announcements | `announcements.read` | Bilingual (tr and en required) plain-text announcements with audience, platforms, version range, an allow-listed in-app CTA route and a window of at most 30 days; phone preview; schedule and cancel. |
| Gizlilik | `/data-requests` | Data requests | `data_requests.read` | Exports, history deletions and account deletions with step progress and age against the 30-day window; retry from the first incomplete step, regenerate an export. Never marks a request completed, never sees export contents or signed URLs; deleted users appear only by hash prefix. |
| | `/audit` | Audit log | `audit.read` | Filtered, newest-first audit rows with detail and hash-chain position; "Zinciri doğrula" verifies a window and flags the first broken entry. No edit, delete, export or purge exists. |
| Sistem | `/health` | System health and app versions | `health.read` | Latest probe per component (older than 10 min shows as unknown), services without credentials listed as "Yapılandırılmadı — Harici kimlik bilgisi gerekli", credential expiries, "Şimdi çalıştır" (`health.run`), probe history, app versions with installs, sync-error rate, old versions and crash-free rates (Sentry, when its credentials are set), cron schedules and worker lag. |
| | `/admins` | Admin users | `admins.read` | Invite, change role, disable and re-enable, reset MFA, revoke sessions, resend invite and unlock (`admins.manage`, step-up). |
| | `/settings` | Settings | every admin | Own preferences (theme, language, timezone, density), own security (sessions, recovery codes, second TOTP device, sign-out elsewhere) and system settings (`app_settings`, `plan_limits`; changes need `settings.system.write` and step-up; session limits can only be tightened; `referral.risk_threshold` is edited as 0–1 and stored as 0–100, API_CONTRACTS ADM-20). |

A command palette (`cmdk`, [`src/components/command-palette.tsx`](../apps/backoffice/src/components/command-palette.tsx)) searches entities through `GET /search` with `search.global`; results are filtered by the per-entity read permissions and only link to built modules.

### Mutations, confirmations and errors

- Every mutation is a server action wrapped by [`src/server/action.ts`](../apps/backoffice/src/server/action.ts): `Origin` must equal `ADMIN_ORIGIN` (a missing Origin is refused), `Sec-Fetch-Site` must be `same-origin` when present, the dialog envelope is validated, a reason (10–500 characters) and `confirm: true` are required exactly where the route's body contract declares them, step-up routes re-check a TOTP code first, and admin-api receives the dialog's `Idempotency-Key` and a fresh correlation id. Route handlers are GET-only.
- Confirmation levels ([`src/components/confirm-dialog.tsx`](../apps/backoffice/src/components/confirm-dialog.tsx)): level 1 is a plain action, level 2 asks for a reason, level 3 adds a typed confirmation and, on step-up routes, the TOTP field.
- admin-api answers with `{data, page?, meta:{correlation_id}}` or `{error:{code, message_key, details?}, meta}`. A missing provider credential is `503 EXTERNAL_CREDENTIAL_REQUIRED`; a partly applied Edge-side operation is `503 SERVICE_UNAVAILABLE` with `details.partial=true` and `details.step`, and retrying with the same idempotency key resumes it.

## Authentication

Admins are dedicated Supabase Auth users with `app_metadata.da_kind='admin'`, created only by admin-api. They have no `profiles` row, the app APIs (`api`, `public-api`) refuse their JWTs with `403`, and an email that belongs to an app user can never become an admin. There is no password and no magic link.

| Step | Implementation |
| --- | --- |
| 1. Email | `/login`: `POST /auth/preflight` (BFF key; SHA-256 digests of the email and client IP) applies the IP (5 / 15 min) and email (5 / h) limits; a code is sent through Supabase Auth only for an active admin, with an identical, time-padded response otherwise (no enumeration). The email waits in the sealed `__Host-da_admin_login` cookie (10 min), never in the URL; resend after 60 s. |
| 2. Code | `verifyOtp` → `aal1` session; `POST /auth/attempt` records the result (5 failures / 5 min lock the email for 15 min; 20 / 24 h lock it until a super admin unlocks it); `GET /auth/status` confirms the identity is an admin. |
| 3. TOTP | `/mfa`: enrolment (QR + manual secret; an abandoned unverified factor is removed first) or challenge; 5 consecutive failures in a session sign out. |
| 4. Session | `POST /session/start` creates the `admin_sessions` row (hashed IP, user agent); an invited admin becomes active and the first recovery codes are shown. |
| Recovery codes | 10 single-use Crockford base32 codes (50 bits each) shown once; only `HMAC_SHA256(RECOVERY_CODE_PEPPER, code)` is stored. Redeeming one (`/auth/recovery-code/redeem`, 5 / h) deletes the TOTP factors, ends the admin's other sessions, audits `admin.mfa_recovery_used`, alerts super admins and returns the admin to enrolment. |
| Second device | Settings › Güvenlik adds a second TOTP factor (at most two); removing one needs step-up and leaves at least one. A code from either device passes challenges and step-up. |
| Invite | A super admin (`admins.manage`, step-up) invites by email, name, role and reason; `/invite?token=` shows only an accept button (link scanners cannot consume it); accepting sends a sign-in code and continues at step 2. Invites last 72 h. Missing email credentials give `503 EXTERNAL_CREDENTIAL_REQUIRED` before anything is created. |
| Lost access | No password to reset: a super admin disables the old identity and invites the person again; a lost authenticator uses a recovery code or "MFA sıfırla". Admin rows are never deleted. |
| First admin | `pnpm admin:bootstrap` from the owner's shell ([DEPLOYMENT.md](DEPLOYMENT.md#first-administrator)); refuses while an active `super_admin` exists. |

### Sessions

- **Limits:** idle 30 min and absolute 12 h, from `app_settings` `session.idle_minutes` (10–30) and `session.absolute_hours` (4–12); every `admin_api` call checks them in `private.admin_guard`, so revocation takes effect on the next request even with a valid JWT. `admin_api.admin_me` extends the idle window only for user activity (`x-da-activity: user`), at most every 30 s; background polling never extends it.
- **SessionWatcher** ([`src/components/session-watcher.tsx`](../apps/backoffice/src/components/session-watcher.tsx)) mirrors the deadlines, warns two minutes before idle expiry ("Oturumu sürdür" → heartbeat) and redirects to `/login?reason=…` on expiry or revocation.
- **Step-up:** routes marked step-up in the registry need a TOTP re-check within 10 minutes (`admin_sessions.step_up_at`).
- **Sign-out:** "Çıkış yap" (this session), "Diğer oturumları kapat" and "Tüm oturumlardan çık" (ends every row and revokes refresh tokens).

### Cookies and headers

| Item | Value |
| --- | --- |
| Auth cookie | `__Host-da_admin` (chunked as `.0…n` when large): httpOnly, Secure, SameSite=Strict, Path=/, 12 h; the `@supabase/ssr` cookie jar is sealed with AES-256-GCM under a key derived by HKDF from `ADMIN_BFF_SECRET` ([`src/server/cookie-seal.ts`](../apps/backoffice/src/server/cookie-seal.ts)); a cookie that fails to unseal counts as no session. |
| Other cookies | `__Host-da_admin_login` (sealed email between steps 1 and 2), `__Host-da_admin_mfa`, theme and locale preference cookies. |
| Headers | Per-request nonce CSP, HSTS (2 years, preload), `nosniff`, `Referrer-Policy: no-referrer`, restrictive `Permissions-Policy`, COOP/CORP same-origin, `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store` ([`src/server/security-headers.ts`](../apps/backoffice/src/server/security-headers.ts)). |
| Rate limits | Pre-auth POSTs to `/login`, `/mfa` and `/invite`: 30 / 5 min per IP in the proxy (best effort). Authoritative limits in SQL and admin-api: read 600/min, search 60/min, mutation 60/min, sensitive 30/h (refusals of the sensitive class are audited as `admin.rate_limited`). |

## PII masking and reveal

- PII leaves Postgres masked (`private.mask_email`, `mask_name`, `mask_push_token`): `yu***@gmail.com`, Apple relay addresses as `***@privaterelay.appleid.com`, push tokens as `ExponentPushToken[ab…yz]`. Free text (feedback) is auto-masked for emails and phone numbers ([`src/lib/automask.ts`](../apps/backoffice/src/lib/automask.ts)).
- Reveal ([`src/actions/reveal.ts`](../apps/backoffice/src/actions/reveal.ts)): `POST /users/:id/reveal` with a field (`email`, `display_name`, `integration_email:{account_id}`, `ticket_contact_email:{ticket_id}`), a reason and `users.pii.reveal`; AI feedback comments with `ai_feedback.reveal`. The value is shown in the dialog for 60 s, is never put in a URL, logged or cached, and every reveal is audited.
- Never returned by admin-api: OAuth tokens or ciphertext, passwords, secrets and API keys, email bodies, memory chunks, audio, uploaded files and their signed URLs, end-user IP addresses, raw RevenueCat subscriber attributes.

## Support Access

Admins holding `support.access` (`super_admin`, `support`) can request a time-boxed grant for one user ([BACKOFFICE_PLAN §9](BACKOFFICE_PLAN.md#9-support-access-flow-m49-req-bo-supp-03)):

1. "Destek erişimi iste…" (level 3 + step-up): scopes, duration 15, 30 or 60 min (capped by `support_access.max_minutes`, never above 60), a linked open ticket, and a reason → `POST /support-access/grants` (audit `support_access.granted`).
2. While the grant is active, the user pages show a banner with the countdown, the scopes and "Erişimi sonlandır" ([`support-access-banner.tsx`](../apps/backoffice/src/app/%28admin%29/users/%5Bid%5D/support-access-banner.tsx)).
3. Content is read one entity at a time through `GET /support-access/grants/:id/content/:scope`; each view is authorised in SQL (owner, not expired, not revoked, scope granted), counted in `support_access_grants.reveal_count` and audited as `support_access.content_viewed`. The value is held in memory for 60 s.
4. Expiry is enforced server-side; revocation is `POST /support-access/grants/:id/revoke`.

| Scope | Returns |
| --- | --- |
| `pii` | The user's unmasked identifiers |
| `email_metadata` | Subject, sender, stored snippet (≤200 characters), category of threads behind a selected insight or job |
| `insights` | Insight fields, stored summaries and the rendered briefing text of a selected briefing |
| `notifications` | The rendered title and body that was sent |
| `captures` | Extracted entity fields (never the file, its OCR text or a URL) |
| `assistant_transcript` | Messages of a selected assistant thread with their source references |
| `ai_feedback` | The user's comment text |

Tokens, passwords, secrets, raw email bodies, attachments and uploaded files, memory chunks and voice audio stay out of reach even with a grant.

## Audit

- `audit_logs` is append-only: no role can update, delete or truncate it (triggers raise), and every insert goes through `private.audit_log_append`, which serialises on an advisory lock and chains `row_hash = sha256(prev_hash || canonical row)`.
- `admin_api` mutations write their audit row in the same transaction as the change; Edge-side operations call `admin_api.authorize` first and `admin_api.audit_write` after, with `result` `success`, `failure` (partial outcomes carry `details.partial=true`) or `denied`.
- Action names come from one catalogue, `AUDIT_ACTIONS` in [`packages/validation/src/admin/audit-actions.ts`](../packages/validation/src/admin/audit-actions.ts), kept equal to the SQL `private.audit_action_catalogue` by a Deno test, a pgTAP scan of every SQL emitter and the registry test of each route's declared action.
- The chain is verified by the `audit_chain` health probe and on demand from `/audit` (`GET /audit/verify-chain`). After an account deletion a subject shows only as "Silinmiş kullanıcı · #{hash prefix}".

## Running and testing

| Task | Command |
| --- | --- |
| Dev server | `pnpm --filter @da/backoffice dev` (port 3100); needs the six variables above and a running admin-api (local stack: [README](../README.md#quickstart)) |
| Unit tests (Vitest, coverage gate) | `pnpm --filter @da/backoffice test` |
| E2E (Playwright, project `bo-contract`) | `pnpm e2e:backoffice`: the production build against the contract-validated mock admin-api and Auth in [`e2e/mock-server.ts`](../apps/backoffice/e2e/mock-server.ts); runs in the container and in the CI `backoffice` job |
| Build | `pnpm --filter @da/backoffice build` (also scans `.next/static` for secrets) |

Tests and where they run are in [TESTING.md](TESTING.md).

## Differences from the plan

| Plan (BACKOFFICE_PLAN) | As built | Reason |
| --- | --- | --- |
| §2.1, §2.7: a separate `ADMIN_SESSION_SECRET` seals the auth cookie | The sealing key is derived with HKDF-SHA256 from `ADMIN_BFF_SECRET` under its own `info` label | `.env.example` (INTEGRATION_PLAN §15) defines no session-sealing variable; the derivation keeps the two uses on separate key material ([`cookie-seal.ts`](../apps/backoffice/src/server/cookie-seal.ts)). |
| §2.2: `instrumentation.ts` with `@sentry/nextjs`; `NEXT_PUBLIC_SENTRY_DSN` | No Sentry SDK in the backoffice; server errors surface through the error boundary with the correlation id and admin-api's own logging | Not wired during the backoffice tasks. Crash data of the mobile app is read by admin-api's Sentry adapter on `/health` when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are set. |
| §2.5 error table and §12: `424` for missing credentials, `207` for partial outcomes | `503 EXTERNAL_CREDENTIAL_REQUIRED` and `503 SERVICE_UNAVAILABLE {partial, step}` | API_CONTRACTS §2 and §12.1 own status codes (R-20); recorded in BACKOFFICE_PLAN §2.5 and ADM-20. |
| §13.4: Playwright projects `bo-contract`, `bo-full` and `bo-visual` | Only `bo-contract` (mock admin-api and Auth) exists; CI runs it | The full-stack run needs GoTrue, admin-api and the worker together; the admin-api pipeline, routes and flows are covered by the Deno suite and pgTAP instead ([TESTING.md](TESTING.md)). |
| §2.4: the proxy's best-effort pre-auth throttle covers POSTs to `/login` and `/mfa` | It also covers `/invite` | Accepting an invite sends a sign-in code, so it is throttled like the login form. |

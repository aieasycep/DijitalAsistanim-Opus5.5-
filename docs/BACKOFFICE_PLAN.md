# Backoffice Plan: the Dijital Asistan admin panel (`admin.<domain>`)

> **File:** `docs/BACKOFFICE_PLAN.md`
> **Status:** binding implementation spec for execution step 10 of the master plan (§21).
> **Date:** 2026-09-23
>
> **Inputs**
> - Master prompt: M§46–M§72, M§103, M§110, M§118, M§119, M§136 and M§148, plus the sections cross-referenced below.
> - Master plan: ADR-04, ADR-06, ADR-11, ADR-13, §5 (canonical enums and tables), §10 (backoffice map), §16 (referrals) and the §23b reconciliation rulings (R-01, R-02, R-05, R-08, R-09, R-10, R-13, R-18, R-20, R-21, R-22).
> - Audits:
>   - `secondary-docs`: REQ-BO-*, and resolutions C-21 and P-06.
>   - `integrations`: RevenueCat webhooks and REST v2; Supabase MFA, sessions and access-token hook; the jobs design.
>   - `stack-versions`: Next 16.3.6 `proxy.ts`, the server-action CSRF note, TanStack Table 9.2.4, shadcn 4.21, radix-ui 1.6.7, recharts 3.10.1, cmdk 1.1.1, next-themes 0.4.6, nuqs 2.10.1, sonner 2.0.8.
>   - `design-system`: tokens and the AA contrast fixes.
>
> **Precedence.** Where the documents disagree, the master prompt decides functional behaviour and PRIMARY decides visual behaviour.
>
> **Names (master plan §23b R-20).** Tables, columns, enums, SQL functions, cron jobs and Vault entries follow DATABASE_AND_RLS_PLAN. admin-api paths and request/response shapes follow API_CONTRACTS §12.3. `ai_feature` values and prompt keys follow AI_PIPELINE_PLAN. Env var names follow INTEGRATION_PLAN §15. This document's §4.1 is the source of truth for admin permission strings; the `admin_api` SQL checks and the admin-api route guard both use them.

---

## 0. Conventions

- **Canonical names.** Every `code` name is the canonical name from master plan §5 / ADR-04 unless it is marked **⊕**.
  - ⊕ marks a proposed registry addition. Each one is listed with a justification in §16.
- **Citations.** `M§n` refers to a master prompt section. `REQ-BO-*` IDs come from the `secondary-docs` requirement catalogue.
- **Language.** UI copy is Turkish, shown verbatim, and is the default locale. Every string also has an `en` translation in `packages/i18n` under the `backoffice.*` namespace (ADR-14).
- **Terms:**
  - **BO**: the backoffice Next.js app (`apps/backoffice`).
  - **admin-api**: the Supabase Edge Function.
  - **`admin_api`**: the Postgres schema.
  - **Reason**: a required free-text justification of 10–500 characters, trimmed, stored in `audit_logs.reason`.
- **Module blocks.** Every module block in §6 has exactly the M§148 fields: Module · Route · Role access · Data source · Filters · Server pagination · Mutations · Confirmation · Audit event · PII handling · Empty/error state · Tests.
- **Whole product.** The backoffice ships whole, as one product. Nothing in this document is deferred.
  - Where a capability needs a credential that only the owner can supply, it is marked **External credential required**.
  - Where it needs a console action, it is marked **Manual external step**.
  - In both cases the UI shows the real state ("Harici kimlik bilgisi gerekli") and never fakes success.

---

## 1. Requirement traceability

| Requirement | Satisfied in |
|---|---|
| REQ-BO-GEN-01..05 (separate app, desktop-first, `admin.<domain>`, separate auth/session/RBAC, sidebar IA) M§46 | §2, §3, §5.2 |
| REQ-BO-RBAC-01..04 M§47 | §4 |
| REQ-BO-SEC-01..09 M§48 | §3, §5.5, §10 |
| REQ-BO-SUPP-01..03 M§49 | §9, §6.3a |
| REQ-BO-DASH-01..03 M§50 | §6.1, §7.2–7.3 |
| REQ-BO-USERS-01..05 M§51 | §6.2, §6.3 |
| REQ-BO-INT-01..03 M§52 | §6.5 |
| REQ-BO-JOBS-01..05 M§53, M§127 | §6.6 |
| REQ-BO-BRIEF-01..02 M§54, C-21 | §6.7, §7.5 |
| REQ-BO-NOTIF-01..03 M§55, M§132 | §6.8 |
| REQ-BO-AIOPS-01..03 M§56 | §6.9, §7.5 |
| REQ-BO-MODEL-01..04 M§57 | §6.10 |
| REQ-BO-PROMPT-01..06 M§58 | §6.11 |
| REQ-BO-AIFB-01..02 M§59 | §6.12 |
| REQ-BO-SUBS-01..02 M§60, M§43 | §6.13, §7.5 |
| REQ-BO-ENT-01..03 M§61 | §6.14 |
| REQ-BO-REF-01 M§62, M§45, P-06 | §6.15 |
| REQ-BO-TICKET-01..02, REQ-BO-FEEDBACK-01..02 M§62 | §6.4, §6.16 |
| REQ-BO-FLAGS-01..04 M§63 | §6.17 |
| REQ-BO-ANN-01..03 M§64 | §6.18 |
| REQ-BO-DATAREQ-01..04 M§65, M§128, M§129 | §6.19 |
| REQ-BO-AUDIT-01..03 M§66 | §6.20, §10 |
| REQ-BO-HEALTH-01..02 M§67 | §6.21, §11 |
| REQ-BO-ADMINS-01..02 M§68 | §6.23, §4.4 |
| REQ-BO-CMDK-01..04 M§69 | §6.25 |
| REQ-BO-TABLE-01 M§70 | §5.3 |
| REQ-BO-PRIV-01..03 M§71 | §5.5 |
| REQ-BO-THEME-01..03 M§72 | §5.1, §5.7, §6.24 |
| REQ-BO-OBS-01..02 M§110 | §6.22 |
| REQ-BO-OPS-01..02 M§118, M§126 | §8, §2.5 |
| REQ-BO-METRIC-01..02 M§119 | §7.4, §7.7 |
| REQ-TEST-05 M§103 | §13.4 |
| REQ-DATA-04 M§151; REQ-SECRET-* M§152 | §2.5, §2.7, §5.5 |
| M§136 acceptance list | §14.2 DoD checklist |

---

## 2. Architecture

### 2.1 Topology (ADR-04, ADR-06; M§46, M§88)

```
Admin browser (desktop-first)          Vercel project "backoffice" — apps/backoffice          Supabase (same project as the app)
──────────────────────────────         ─────────────────────────────────────────────         ─────────────────────────────────────
Receives HTML/RSC only.                proxy.ts (runtime nodejs, Next 16):                   Auth (GoTrue): email OTP, TOTP MFA,
No Supabase client, no tokens            • CSP nonce + security headers                        custom access token hook → admin_role claim
readable by JS.                          • non-GET without matching Origin → 403            ┌► Edge Function admin-api (Hono, Deno 2.1)
Cookie __Host-da_admin (httpOnly,        • @supabase/ssr session refresh (publishable key)  │   1 BFF key  2 JWT verify (getClaims)
Secure, SameSite=Strict, Path=/)         • no session → /login ; aal1 → /mfa                │   3 admin ctx (admin_api.admin_me) 4 permission
                                        RSC pages → lib/admin-api.ts (server-only) ─────────┤   5 rate limit 6 idempotency 7 zod contracts
                                        Server actions → adminAction() wrapper ─────────────┤   → PostgREST rpc admin_api.* with the
                                        GET /api/admin/* read proxy (polling, palette) ─────┘     admin's JWT + x-da-admin-gateway header
                                                                                              → service client (sb_secret, Edge secret only)
                                                                                                for Auth admin ops after the SQL gate
                                                                                              → invokes `health`, pokes `worker`
                                                                                            Postgres: schema admin_api (security definer fns)
                                                                                              every fn → private.require_admin(permission)
```

**Invariants**
- The BO holds **no** Supabase secret key.
- Its only secrets are:
  - `ADMIN_SESSION_SECRET` (INTEGRATION_PLAN §15), which seals the auth cookie values (§3.8). This is the BO's "own session cookie secret" of master plan §4;
  - `ADMIN_BFF_SECRET` ⊕, a shared secret that authenticates BO→admin-api calls;
  - the Sentry DSN.
- Every data read and every mutation goes through `admin-api`. The BO never talks to PostgREST directly, which keeps admin traffic within M§151 limits.
- The admin's access token never reaches client-side JavaScript.
  - It is stored in an httpOnly cookie.
  - It is marked with React's `experimental_taintUniqueValue` in the server helper, so it cannot be passed to a client component by accident.
- There is **no** impersonation or "login as user" feature (M§49, REQ-BO-SUPP-01).
- There is **no** backoffice feature that fetches provider content: no "Orijinal Mail", attachments or audio (M§48).
- There is **no** bulk export of user data from the BO (M§151). Tables are view-only.

### 2.2 App structure (`apps/backoffice`)

```
apps/backoffice/
  proxy.ts                         # §2.4
  next.config.ts                   # reactCompiler:true, cacheComponents:false, experimental.taint:true,
                                   # serverActions:{allowedOrigins:[ADMIN_HOST], bodySizeLimit:'256kb'}, poweredByHeader:false
  instrumentation.ts               # @sentry/nextjs 10.75 (sendDefaultPii:false, beforeSend scrubber)
  src/app/
    layout.tsx                     # <html lang data-theme>, next-themes ThemeProvider(attribute="data-theme", enableSystem=false)
    page.tsx                       # "/" → redirect("/dashboard")                                          ⊕ route
    (auth)/login/page.tsx          # §6.0
    (auth)/mfa/page.tsx            # enrol | challenge | recovery (state from getAuthenticatorAssuranceLevel + factors)
    (auth)/invite/page.tsx         # invite acceptance (button-gated; defeats link prefetchers)             ⊕ route
    (admin)/layout.tsx             # requires admin ctx; Sidebar, Topbar, CommandPalette, SessionWatcher, SupportAccessBanner
    (admin)/dashboard/page.tsx
    (admin)/users/page.tsx
    (admin)/users/[id]/layout.tsx  # user header + tab nav; [id]/page.tsx → redirect overview
    (admin)/users/[id]/{overview,integrations,briefings,usage,subscription,referrals,support,audit}/page.tsx
    (admin)/support/page.tsx · support/[id]/page.tsx
    (admin)/integrations/page.tsx
    (admin)/jobs/page.tsx · jobs/[id]/page.tsx
    (admin)/briefings/page.tsx · (admin)/notifications/page.tsx
    (admin)/ai/page.tsx · ai/models/page.tsx · ai/prompts/page.tsx · ai/prompts/[key]/page.tsx · ai/feedback/page.tsx
    (admin)/subscriptions/page.tsx · (admin)/referrals/page.tsx
    (admin)/feedback/page.tsx · (admin)/flags/page.tsx · (admin)/announcements/page.tsx
    (admin)/data-requests/page.tsx · (admin)/audit/page.tsx
    (admin)/health/page.tsx · (admin)/admins/page.tsx · (admin)/settings/page.tsx
    (admin)/forbidden/page.tsx     # rendered via notFound-like boundary for 403                          ⊕ route
    api/admin/[...path]/route.ts   # GET-only read proxy (allow-listed prefixes), x-da-activity: background  ⊕ route
    api/healthz/route.ts           # BO liveness for Vercel monitoring; returns {ok:true}, no data          ⊕ route
  src/components/
    data-table/ (DataTable, ColumnHeader, Toolbar, FilterChips, ColumnVisibilityMenu, Pagination, BulkBar, states)
    charts/ (TimeSeriesChart, StackedBarChart, BarBreakdown, LatencyChart, ChartTableFallback)
    confirm/ (ConfirmDialog levels 1–3, ReasonField, TypedConfirm, StepUpField)
    pii/ (MaskedValue, RevealButton)
    kpi/ (KpiCard, DeltaBadge), range/ (RangePicker), status/ (StatusBadge per enum), page/ (PageHeader, Tabs, EmptyState, ErrorState, ForbiddenState)
    command-palette/ (cmdk), session/ (SessionWatcher, IdleWarningDialog), support-access/ (Banner, RequestDialog, ContentPanel)
  src/lib/
    admin-api.ts (server-only fetch client), actions.ts (adminAction wrapper), auth.ts (@supabase/ssr factories),
    permissions.ts (re-exports packages/domain rbac), env.ts (@t3-oss/env-nextjs), format.ts (tr-TR), url-state.ts (nuqs parsers)
  e2e/ (Playwright; §13.4) · vitest.config.ts · playwright.config.ts
```

**Shared packages**
- `packages/domain/rbac.ts` holds the permission catalogue and role matrix (§4).
- `packages/domain/flags.ts` holds the flag evaluator. It must stay in parity with SQL.
- `packages/domain/jobs-registry.ts` holds job labels and admin retry policy.
- `packages/validation/admin/*.ts` holds the zod request/response contracts for every admin-api route. They are Deno-safe and shared by admin-api and the BO.
- `packages/i18n` holds the `backoffice` namespace.
- `packages/design-tokens` provides `tokens.css`.

### 2.3 Request paths

**Read path (server components)**
1. The page parses URL state with nuqs server parsers.
2. It calls `adminGet(path, query, schema)`. That helper:
   - reads the access token from the `@supabase/ssr` server client (cookie `__Host-da_admin`);
   - sends `Authorization: Bearer`, `x-da-bff: ADMIN_BFF_SECRET`, `x-correlation-id: <uuid v7>` and `x-da-activity: user`;
   - uses `cache:'no-store'`.
3. The response is validated with zod.
4. A typed `Result<T>` is returned: `ok`, or `err{code, correlationId}`.
5. Errors render the segment's state components (§5.6).
6. `session_expired`, `session_revoked` and `aal2_required` → `redirect('/login?reason=…')`.

**Mutation path (server actions only)**
1. The client component opens a ConfirmDialog, which generates an `Idempotency-Key` (uuid v7) when it opens.
2. On submit, a `'use server'` action wrapped with `adminAction(schema, handler)` runs. The wrapper:
   - (a) requires `Origin` to equal `ADMIN_ORIGIN`. A missing Origin is rejected, because the stack audit notes that Next 16 lets Origin-less requests through with only a warning.
   - (b) requires `Sec-Fetch-Site` to be `same-origin` when present;
   - (c) validates the input with zod;
   - (d) calls admin-api POST/PATCH with `Idempotency-Key`, the correlation id and the step-up token (when required);
   - (e) maps errors;
   - (f) calls `revalidatePath` / `router.refresh()` for the affected route.
3. Mutations never go through route handlers. Route handlers are GET-only.

**Client reads (palette, polling)**
- TanStack Query 5.103 calls `GET /api/admin/<path>`.
- The route handler forwards to admin-api with the same headers, but `x-da-activity: background`. Background calls do not refresh the idle timer.
- Allow-listed prefixes: `search`, `health`, `jobs`, `dashboard`, `me`, `notifications`, `support-access`.

### 2.4 Next.js 16 specifics (stack audit)

| Topic | Decision |
|---|---|
| Middleware | `proxy.ts`. The runtime is fixed to `nodejs`; edge is not supported. Matcher: everything except `/_next/static`, `/_next/image`, `/favicon.ico`, `/robots.txt`. |
| proxy.ts steps | 1. Build the CSP nonce and headers (§3.8). 2. If the method is not GET/HEAD/OPTIONS, require an `Origin` header equal to `ADMIN_ORIGIN`, else respond 403 `{"error":"csrf_origin"}`. 3. Use `createServerClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {cookieOptions:{name:'__Host-da_admin', httpOnly:true, secure:true, sameSite:'strict', path:'/', maxAge:43200}, cookies:{getAll, setAll}})`, where `setAll`/`getAll` seal and unseal the values with `ADMIN_SESSION_SECRET` (§3.8), then `auth.getClaims()` to refresh and verify. 4. Public routes: `/login`, `/mfa`, `/invite`, `/api/healthz`. For every other route, no claims → redirect to `/login?next=<path>`. 5. `aal !== 'aal2'` on a non-auth route → redirect to `/mfa`. 6. aal2 but no `admin_role` claim → server sign-out and redirect to `/login?reason=not_admin`. The claim is only a fast gate; §4.3 is the authoritative check. 7. Best-effort per-instance token bucket for POSTs to `/login` and `/mfa`: 30/5 min per IP. The authoritative limits are in the database (§3.9). |
| Server actions | `serverActions.allowedOrigins=[ADMIN_HOST]`. The wrapper also re-checks Origin (defence in depth). `bodySizeLimit 256kb`. |
| Async request APIs | `cookies()`, `headers()` and `params` are awaited. Synchronous access was removed in Next 16. |
| Caching | `cacheComponents:false`. Every admin page reads cookies and is therefore dynamic. `fetch(..., {cache:'no-store'})`. Response header `Cache-Control: no-store`. |
| Lint | `next lint` was removed; ESLint 9.39.5 flat config runs via the CLI. |
| Build | Turbopack is the default and no custom webpack config is allowed. `next build` is part of CI (plan §18). |
| Tables | `@tanstack/react-table` 9.2.4 API `useTable({features, …})`, with manual (server) sorting, pagination and filtering. `useLegacyTable` is never used. Follow the shadcn 4.21 v9 data-table recipe. |
| URL state | nuqs 2.10.1 with `shallow:false`, so state changes re-render the server component. `useTransition` drives the pending overlay. |

### 2.5 admin-api Edge Function (`supabase/functions/admin-api`)

- **Stack:** Hono 4.13.8 with `basePath('/admin-api')`, a per-function `deno.json` importing `packages/domain` and `packages/validation`, deployed with `--use-api`.
- **Gateway config:** `config.toml`: `[functions.admin-api] verify_jwt = false`.
  - JWT verification is done in code (step 2 below), so three pre-login routes can instead be authenticated by the BFF key ⊕. This clarifies the ADR-04 row.

**Middleware pipeline, in order**

1. **Correlation.** Take `x-correlation-id` (uuid) or generate one. Log in JSON with fields `{ts, level, fn:'admin-api', route, correlation_id, admin_id?, status, duration_ms}`. PII-minimised; no request bodies (M§126).
2. **BFF key.** Constant-time compare of `x-da-bff` against `ADMIN_BFF_SECRET`. Mismatch → 401 `bff_required`. Any request carrying a browser `Origin` header → 403 (admin-api is server-to-server only).
3. **JWT** (all routes except `/auth/preflight`, `/auth/attempt`, `/auth/invite/redeem`).
   - `supabase.auth.getClaims(token)` checks the signature against JWKS.
   - It requires `aal === 'aal2'`, except on the aal1 allow-list `/auth/status` and `/auth/recovery-code/redeem`.
   - Failure → 401 `unauthenticated` or `aal2_required`.
4. **Admin context.**
   - Create a per-request supabase-js client with the publishable key, `Authorization: Bearer <admin JWT>` and `x-da-admin-gateway: ADMIN_GATEWAY_SECRET` ⊕.
   - Call `rpc('admin_me', {p_activity})` on schema `admin_api` (`p_activity` = header `x-da-activity` === 'user').
   - The result carries `{admin_id, role, permissions[], session:{id, idle_expires_at, absolute_expires_at, step_up_valid_until}, preferences}`.
   - Mapped errors: `forbidden`, `session_expired`, `session_revoked`, `locked`.
5. **Rate limit.** `public.rate_limit_hit(p_key, p_limit, p_window_seconds)` (DB §6.5), called inside `admin_me` for the read class and inside mutation functions for the other classes (§3.9). Exceeded → 429 `rate_limited` with `Retry-After`.
6. **Route guard.** `requirePermission(p…)` checks the ctx permissions and fails fast. A denial writes an audit row through a separate RPC call, `admin_api.audit_denied(route, permission)`.
7. **Step-up guard** (routes marked SU in §12): `session.step_up_valid_until > now()`, else 403 `step_up_required` (§3.3).
8. **Contract.** A zod schema from `packages/validation/admin` parses params, query and body. Failure → 422 `validation_failed` with field paths.
9. **Idempotency.**
   - Every POST/PATCH needs an `Idempotency-Key` header (uuid). It is passed to SQL as `p_idem`.
   - The SQL mutation first looks up `audit_logs (actor_id, idempotency_key)`, which is a unique partial index ⊕.
   - A hit returns `{replayed:true, audit_id, result}` without re-executing.
10. **Handler.** Calls `rpc(...)` on schema `admin_api`. Operations that need Auth admin, email, `health` invocation or a `worker` poke run through the service client **only after** a successful SQL gate (`admin_api.authorize(permission)`), and end with `admin_api.audit_write(...)`.
11. **Response.** `Cache-Control: no-store`.
    - Success envelope: `{data, page?, meta:{correlation_id}}`.
    - Error envelope: `{error:{code, message_key, details?}, meta:{correlation_id}}`.

**Error codes, with HTTP status and UI copy (tr)**

| Code | HTTP | UI copy (tr) |
|---|---|---|
| `bff_required` | 401 | (not user-facing; logged) |
| `unauthenticated`, `aal2_required` | 401 | redirect to /login or /mfa |
| `session_expired` | 401 | redirect `/login?reason=idle` or `expired` |
| `session_revoked` | 401 | redirect `/login?reason=revoked` |
| `forbidden` | 403 | "Bu işlem için yetkin yok." |
| `step_up_required` | 403 | the dialog shows the "Doğrulama kodu" field |
| `not_found` | 404 | "Kayıt bulunamadı veya silinmiş." |
| `conflict` | 409 | "Kayıt başka bir yönetici tarafından değiştirildi. Sayfayı yenileyip tekrar dene." |
| `last_super_admin` | 409 | "Son aktif süper yönetici devre dışı bırakılamaz veya rolü değiştirilemez." |
| `invalid_state` | 409 | "Bu kayıt mevcut durumunda bu işleme uygun değil." (+ `details.reason_key`) |
| `validation_failed`, `reason_required` | 422 | field errors; "Gerekçe zorunlu (en az 10 karakter)." |
| `rate_limited` | 429 | "Çok fazla istek. Lütfen {seconds} saniye sonra tekrar dene." |
| `external_credential_required` | 424 | "Harici kimlik bilgisi gerekli: {service}. Yapılandırma tamamlanana kadar bu işlem yapılamaz." |
| `upstream_unavailable` | 502 | "{service} şu anda yanıt vermiyor. Daha sonra tekrar dene." |
| `partial_failure` | 207 | action-specific honest message (e.g. §6.3a Disable) |
| `internal` | 500 | "Beklenmeyen bir hata oluştu. Hata kimliği: {correlationId}" |

**Rules for returned data (M§151)**
- admin-api never returns email bodies, snippets or assistant content.
- It never returns OAuth tokens or ciphertext, push tokens (only masked `ExponentPushToken[ab…yz]`), passwords, API keys, raw RevenueCat payload fields `subscriber_attributes` or `aliases`, IP addresses of end users, or storage paths or signed URLs of user files.
- PII is masked in SQL (§5.5) before it leaves Postgres.

### 2.6 `admin_api` SQL layer (ADR-04, plan §6)

- **Schema.** `admin_api` is exposed to PostgREST (plan §5).
- **Function shape.** Every function is:
  - `security definer`, `set search_path = ''`, fully qualified;
  - `revoke execute from public, anon`, `grant execute to authenticated`;
  - bounded with `set statement_timeout = '10s'`; mutations also get `set lock_timeout = '2s'`.
- **First statement:** `perform private.require_admin('<permission>')`, or `private.require_admin(null)` for context-only functions.
- **`private.require_admin(p_permission text) returns public.admin_users`** (DB §6.8) does the following:
  1. `auth.uid()` is not null.
  2. `auth.jwt()->>'aal' = 'aal2'`.
  3. `private.assert_admin_gateway()` ⊕: `sha256(current_setting('request.headers',true)::jsonb->>'x-da-admin-gateway')` matches a non-retired row of `private.admin_gateway_keys` ⊕ (`sha256 bytea primary key, created_at, retired_at`; written by the deploy job; two rows overlap during a rotation). The hash is not stored in Vault, which holds only the project URL and the cron secret (ADR-04, DB §9). This rejects direct PostgREST calls, even with a stolen admin JWT.
  4. `public.admin_users` has a row for `auth.uid()` with `status='active'` and `locked_until` null or in the past.
  5. `public.admin_sessions` has a row with `auth_session_id = (auth.jwt()->>'session_id')::uuid`, `ended_at is null`, `absolute_expires_at > now()` and `last_activity_at > now() - idle_timeout`.
  6. If `p_permission` is not null, a row exists in `private.admin_role_permissions(role, permission)` ⊕.

  Each failure raises `42501` with message ∈ {`unauthenticated`,`aal2_required`,`gateway`,`forbidden`,`locked`,`session_revoked`,`session_expired`}. The `admin_role` JWT claim is **never** used for authorisation in SQL, so a role change takes effect on the next call.
- **`admin_api.admin_me(p_activity boolean default true)`** (DB §6.10 name; the parameter is ⊕) is volatile. It calls `require_admin(null)`, applies the read-class rate limit, and updates `admin_sessions.last_activity_at = now()` when `p_activity` is true and the last update is more than 30 s old. It returns the context JSON.
- **`admin_api.authorize(p_permission text)`** is volatile. It checks the permission and the mutation-class rate limit for Edge-side operations.
- **`admin_api.audit_write(p_action text, p_target_type text, p_target_id text, p_target_user_id uuid, p_reason text, p_result text, p_details jsonb, p_idem text)`**:
  - checks that the caller is an active admin (aal2) and that `p_action` is in `private.audit_action_catalogue` ⊕;
  - appends through `private.audit_log_append` (DB §6.7; §10).
- **Read functions** are `stable` and return `jsonb`.
  - Lists return `{rows:[…], next_cursor, prev_cursor, total_estimate, total_exact?}`.
  - Masking helpers: `private.mask_email(text)`, `private.mask_name(text)`, `private.mask_push_token(text)` ⊕.
- **Mutation functions** are volatile and write `audit_logs` in the **same transaction** as the change. So there is no successful mutation without an audit row, and no audit row without a committed change. The exception is Edge-side operations, which use the explicit `audit_write` with `result` (`success`/`failure`/`denied`). A partial outcome is a `failure` row with `details.partial=true`.

### 2.7 Environment and secrets (M§107, M§152)

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | BO (names per INTEGRATION_PLAN §15; read only in server code, so they are never inlined into the client bundle) | `@supabase/ssr` auth calls (email code, MFA, refresh) |
| `API_PUBLIC_BASE_URL` | BO | `https://<api-domain>`; the admin-api base is `${API_PUBLIC_BASE_URL}/functions/v1/admin-api` |
| `ADMIN_SESSION_SECRET` | BO server env | 32-byte key that seals the `__Host-da_admin` cookie values (AES-256-GCM, §3.8) |
| `ADMIN_BFF_SECRET` ⊕ | BO + Edge secret | BFF authentication (32-byte random, base64) |
| `ADMIN_ORIGIN` ⊕ | BO + Edge secret | `https://admin.<domain>` (Origin checks, email links) |
| `APP_ENV` | BO + Edge | `development` \| `preview` \| `e2e` \| `production` (INTEGRATION_PLAN §15; health overall rule §11) |
| `NEXT_PUBLIC_SENTRY_DSN` (backoffice value) | BO | BO error reporting (PII scrubbed) — External credential required (recommended) |
| `ADMIN_GATEWAY_SECRET` ⊕ | Edge secret; its SHA-256 in `private.admin_gateway_keys` ⊕ (never in Vault) | §2.6 gateway assertion |
| `SUPABASE_SECRET_KEY` (`sb_secret_…`) | Edge secret only | service client for Auth admin ops |
| `RECOVERY_CODE_PEPPER`, `PII_LOOKUP_PEPPER` ⊕ | Edge secrets | HMAC for recovery codes and for email/IP lookup and rate-limit hashes (audit subjects use `target_user_id` and `private.hash_subject`, §10) |
| `EMAIL_PROVIDER` (=`postmark`), `EMAIL_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_REPLY_TO` (INTEGRATION_PLAN §15), `EMAIL_INBOUND_BASIC_AUTH` ⊕ | Edge secrets | admin invites, support replies, security alerts, inbound support replies — External credential required. Admin sign-in codes are sent by Supabase Auth over its SMTP settings, not by this adapter |
| `ADMIN_ALLOWED_EMAIL_DOMAINS` ⊕ | Edge secret (comma list) | invite domain allow-list (empty = any domain, but still never an app-user email) |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (INTEGRATION_PLAN §15; `SENTRY_PROJECT` = the mobile project) | also set as Edge secrets for admin-api | crash correlation adapter (§6.22) — External credential required |

A CI bundle scan fails the build if `sb_secret_`, `ADMIN_BFF_SECRET`, `ADMIN_SESSION_SECRET` or any `*_PEPPER` value pattern appears in `.next/static` (plan §18 secret scan).

### 2.8 Deployment (M§109)

- **Vercel project** `dijital-asistan-backoffice`, separate from web.
  - Root `apps/backoffice`, Node 24, build `pnpm turbo build --filter=backoffice`.
  - Production domain `admin.<domain>`. **Manual external step:** DNS CNAME and Vercel domain verification.
  - Preview deployments are protected by Vercel Deployment Protection (**Manual external step**) and point at the preview Supabase project.
- **Hardening (Manual external step).** If the operating team has fixed egress IPs, add a Vercel Firewall allow-list rule for `admin.<domain>`.
- **Crawling.** `robots.txt` has `Disallow: /`, and every response carries `X-Robots-Tag: noindex, nofollow`.
- **Supabase side.** admin-api and `health` deploy via the Supabase deploy job (plan §18), with secrets checked by `scripts/check-edge-secrets.ts`.

---

## 3. Authentication and session (ADR-06; M§48, M§88)

### 3.1 Admin identities

- **Separate identity.** An admin is a Supabase Auth user with `raw_app_meta_data.da_kind = 'admin'` ⊕, created only by admin-api via `auth.admin.createUser({email, email_confirm:true, app_metadata:{da_kind:'admin'}})`.
  - The app's `handle_new_user` trigger skips profile creation when `da_kind='admin'` ⊕. Admins have no `profiles` row and never appear in user metrics.
  - The mobile/web `api` and `public-api` reject JWTs whose `app_metadata.da_kind='admin'` with 403 `admin_identity` ⊕.
- **Sign-in method.** Email one-time code (`signInWithOtp({email, options:{shouldCreateUser:false}})`, 6 digits, generic responses) as the primary factor + TOTP (mandatory second factor → `aal2`), per master plan R-08.
  - No password and no magic link: the email code is the only primary factor. Admin accounts have no password, so there is none to reset or leak.
  - An existing app-user email (one with a `profiles` row) can never become an admin. Invites for it are rejected with `email_in_use_by_app_user`: "Bu e-posta bir uygulama hesabına ait. Yönetici hesapları için ayrı bir kurumsal e-posta kullan."
- **Auth settings (project-wide; Manual external step in the Supabase dashboard / `config.toml`):**
  - Email OTP: 6-digit codes over the project's custom SMTP, shared with the app's email-OTP sign-in (ADR-06). No client uses password sign-in.
  - MFA TOTP enabled (`[auth.mfa.totp] enroll_enabled=true, verify_enabled=true`).
  - Custom access token hook `pg-functions://postgres/private/custom_access_token_hook`, with `grant usage on schema private` and `grant execute` to `supabase_auth_admin`.
- **Custom access token hook** `private.custom_access_token_hook(event jsonb)` adds `admin_role` only when `admin_users.status='active'` for `event->>'user_id'`, and otherwise leaves the claims untouched.

### 3.2 Login sequence

```
/login (e-posta)  ── server action sendCodeAction ─────────────────────────────────────────────
  1 admin-api POST /auth/preflight {email, client_ip}  (BFF key; admin-api computes
      email_hash = HMAC(PII_LOOKUP_PEPPER, lower(email)) and ip_hash for the rate-limit keys; the raw
      email is used only for the admin_users match and is never stored or logged)
      → {allowed:false, retry_after} ⇒ "Çok fazla deneme. {minutes} dakika sonra tekrar dene."
      → {locked:true} ⇒ "Hesabın güvenlik nedeniyle kilitlendi. Bir süper yöneticiye başvur."
      → {allowed:true, send} ; send=false when no active admin (or invited admin with a redeemed invite) has this email
  2 send=true: supabase.auth.signInWithOtp({email, options:{shouldCreateUser:false}}) (publishable key, server-side)
    send=false: no Supabase call and no email; the same response after the same padded delay (no enumeration)
      ⇒ always "Hesap mevcutsa 6 haneli giriş kodu e-postana gönderildi." → /login?step=code
        (the email is kept in the sealed __Host-da_admin_login cookie, never in the URL; "Kodu tekrar gönder" after 60 s)
/login?step=code (6 haneli kod)  ── server action verifyCodeAction
  3 supabase.auth.verifyOtp({email, token, type:'email'}) → aal1 session cookie (sealed, httpOnly)
  4 admin-api POST /auth/attempt {email, client_ip, kind:'otp', success}
      failure ⇒ "Kod hatalı veya süresi dolmuş."   (same text for unknown emails: no enumeration)
  5 GET /auth/status (aal1) → {is_admin, status, mfa_verified_factors}
      not admin / disabled ⇒ signOut({scope:'local'}) + "Bu hesapla yönetim paneline giriş yapılamaz."
  6 redirect /mfa  (enrol if 0 verified TOTP factors, else challenge)
/mfa ── challenge: mfa.challengeAndVerify({factorId, code}) → aal2 cookie
  7 POST /auth/attempt {kind:'mfa', success}; 5 consecutive MFA failures ⇒ signOut + counts as login failure
  8 POST /session/start → admin_sessions row (ip_hash and user_agent taken from the forwarded request);
      invited→active on first start; audit admin.login ; admin_users.last_login_at
  9 redirect next || /dashboard
```

### 3.3 MFA enrolment, factors and step-up

- **Enrolment screen** "İki adımlı doğrulamayı kur":
  - `mfa.enroll({factorType:'totp', friendlyName:'Birincil'})` renders the QR SVG plus "Kodu elle gir: {secret}", with the hint "Google Authenticator, 1Password veya benzeri bir uygulamayla QR kodu tara."
  - The user types a 6-digit code → `challengeAndVerify` → aal2 → `/session/start` → recovery codes (§3.4) → dashboard.
  - An unverified factor left behind by an abandoned enrolment is deleted before a new enrol (`mfa.unenroll`).
- **Challenge screen** "İki adımlı doğrulama": "Kimlik doğrulayıcı uygulamandaki 6 haneli kodu gir." · [Doğrula] · link "Kimlik doğrulayıcıma erişemiyorum" (recovery).
- **Backup factor.** Settings › Güvenlik offers "Yedek cihaz ekle": a second TOTP factor, at most 2. Removing a factor requires at least 1 to remain, plus step-up.
- **Step-up** ⊕ protects routes marked **SU** in §12: `admins.manage` actions, `settings.system.write`, `support.access`, `users.disable`, `integrations.disconnect` and recovery-code regeneration.
  - If `admin_sessions.step_up_at` ⊕ is older than 10 min, the confirm dialog shows "Doğrulama kodu" (6 digits).
  - The server action runs `mfa.challengeAndVerify` with the admin's session, then POST `/session/step-up`, which sets `step_up_at = now()`, and only then the mutation.
  - A wrong code gives "Kod doğrulanamadı. Tekrar dene." and counts toward the MFA failure bucket.

### 3.4 Recovery codes (MFA-ready recovery process)

- **Generation.** Supabase has no native recovery codes, so they are implemented in admin-api.
  - On the first aal2 session start (and on "Kodları yenile", SU) admin-api generates 10 codes in the format `XXXX-XXXX-XX` (Crockford base32, 50 bits).
  - It stores `HMAC_SHA256(RECOVERY_CODE_PEPPER, code)` in `admin_mfa_recovery_codes` ⊕ (`id, admin_user_id, code_hash, created_at, used_at`), replacing earlier unused codes.
  - The codes are returned once.
- **Display.** Title "Kurtarma kodların", text "Her kod yalnızca bir kez kullanılabilir. Güvenli bir yerde sakla.", actions [Kopyala] [İndir (.txt)] (client-side Blob). The "Devam et" button stays disabled until the checkbox "Kodları güvenli bir yere kaydettim" is ticked.
- **Redeem.** `/mfa` › "Kimlik doğrulayıcıma erişemiyorum" › code field → POST `/auth/recovery-code/redeem` (aal1 JWT + BFF key; rate limit 5/h per admin). admin-api then:
  1. marks the code used;
  2. calls `auth.admin.mfa.deleteFactor` for every TOTP factor (service client);
  3. ends all other admin sessions;
  4. writes audit `admin.mfa_recovery_used`;
  5. sends a security email to all active super_admins ("Güvenlik olayı: kurtarma kodu kullanıldı", External credential required: email). The event also always appears in the Dashboard "Güvenlik olayları" panel.
  6. The user is sent back to enrolment, and new codes are issued.
- **Admin-assisted reset.** A super_admin can run "MFA sıfırla" (§6.23).

### 3.5 Invite flow (M§68)

1. A super_admin (`admins.manage`, SU) opens "Yönetici davet et" with: e-posta, ad soyad, rol, gerekçe.
2. admin-api:
   - `admin_api.authorize('admins.manage')` (with step-up) and the `ADMIN_ALLOWED_EMAIL_DOMAINS` check;
   - missing email credentials → 424 `external_credential_required` before anything is created;
   - `auth.admin.createUser({email, email_confirm:true, app_metadata:{da_kind:'admin'}})`. An email that already exists in `auth.users` is refused: `email_in_use_by_app_user` for an app user, `admin_exists` for an admin;
   - `admin_api.admin_invite_record(p_user, p_email, p_role, p_display_name, p_reason)` (DB §6.10) inserts `admin_users(status='invited', invite_token_hash=SHA256(token), invite_expires_at=now()+72h)` ⊕ and audits `admin.invited`. If it fails, the auth user is deleted again (rollback);
   - enqueues a `transactional_email` job (the worker is poked at once) that sends "Dijital Asistan yönetim paneline davet edildin" with the link `ADMIN_ORIGIN/invite?token=<32-byte base64url>`. The admin list shows the delivery state: "Davet e-postası gönderildi" or "Davet e-postası gönderilemedi" with [Daveti yeniden gönder].
3. `/invite?token=` renders only a [Daveti kabul et] button. This stops email-link scanners from consuming the token. The button's server action calls POST `/auth/invite/redeem`, which:
   - verifies the hash, the expiry and `status='invited'`;
   - sets `invite_redeemed_at` ⊕ (single use) and returns the invited email to the BO server only;
   - the BO server action then runs §3.2 steps 1–2 for that email (a sign-in code is sent) and continues at `/login?step=code`.
   The invite link never signs anyone in; only the email code does (R-08: no magic link, no password).
4. The code is verified (§3.2 step 3) → `/mfa` enrol → aal2 → `/session/start` activates the admin (audit `admin.invite_accepted`) → recovery codes → dashboard.
5. Expired invite: "Davet bağlantısının süresi doldu. Yöneticinden yeni davet iste." "Daveti yeniden gönder" (§6.23) rotates the token.

### 3.6 Lost email access

- There is no password to reset. An admin who can no longer receive the sign-in code asks a super_admin, who disables the old admin identity (§6.23, audit `admin.disabled`) and invites the person again with their current work email (§3.5).
- Admin rows are never deleted, so the audit history stays attached to the old identity.
- A lost authenticator (TOTP) is a different case: recovery codes (§3.4) or "MFA sıfırla" by a super_admin (§6.23).

### 3.7 Session model (`admin_sessions`)

- **Columns** (DATABASE_AND_RLS_PLAN §4.9 is authoritative; ⊕ marks additions): `id uuid pk`, `admin_user_id fk`, `auth_session_id uuid unique` (the JWT `session_id`), `aal` (`aal2`), `created_at`, `last_activity_at`, `idle_expires_at`, `absolute_expires_at` (= created_at + 12 h), `step_up_at` ⊕, `ended_at`, `end_reason` (DB `logout|revoked_all|idle_timeout|absolute_timeout|admin_disabled`, plus ⊕ `logout_others|revoked_by_admin|mfa_reset|recovery_used`), `ip_hash bytea` (HMAC of the client IP; raw IPs are never stored), `user_agent text` (≤300; the UI derives a browser family such as "Chrome 153 · macOS").
- **Idle limit: 30 min; absolute limit: 12 h.**
  - Values come from `app_settings` `session.idle_minutes` (10–30) and `session.absolute_hours` (4–12). The settings UI can tighten them, never loosen them.
  - `require_admin` enforces both on every call. On the first rejection, `admin_api.session_expire()` sets `ended_at` / `end_reason`, and the BO signs out locally.
- **Revocation latency is zero at the application layer.** A still-valid JWT is refused because the session row is ended. Refresh tokens are revoked through `signOut` (own session) or through an Auth ban (disabled admin).
- **SessionWatcher** (client component):
  - It tracks user input: pointer, keys, visibility. A pure-client idle clock mirrors the server's `idle_expires_at`, which comes from `/me` and every server action response.
  - At T−2 min it shows the dialog "Oturumun kapanmak üzere" / "Hareketsizlik nedeniyle oturumun 2 dakika içinde kapanacak." with [Oturumu sürdür] (server action → POST `/session/heartbeat`) and [Çıkış yap].
  - At expiry: `/login?reason=idle` with the banner "Güvenliğin için oturumun kapatıldı. Lütfen tekrar giriş yap."
  - Absolute expiry: "Oturum süren doldu (12 saat). Lütfen tekrar giriş yap." Revoked: "Oturumun başka bir cihazdan veya bir yönetici tarafından sonlandırıldı."
  - Background polling (`x-da-activity: background`) never extends the session.
- **Logout** (user menu "Çıkış yap"): POST `/session/logout` ⊕ → `auth.signOut({scope:'local'})` → cookies cleared → `/login?reason=logged_out` ("Çıkış yaptın."). Audit `admin.logout`.
- **Logout everywhere** (Settings › Güvenlik "Tüm oturumlardan çık", level-2 confirm): POST `/session/logout-all` ends every row for this admin → `auth.signOut({scope:'global'})`, which revokes all refresh tokens → login. Audit `admin.logout_all`. "Diğer oturumları kapat" calls POST `/session/logout-all {scope:'others'}` ⊕, which ends the other rows (`end_reason='logout_others'`), then `signOut({scope:'others'})`.

### 3.8 Cookies and headers

| Item | Value |
|---|---|
| Auth cookie | `__Host-da_admin` (+ `.0`/`.1` chunks), `httpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`, no `Domain`. Values are sealed (AES-256-GCM, key `ADMIN_SESSION_SECRET`) by the `@supabase/ssr` cookie adapter; a cookie that fails to unseal counts as no session |
| Login-step cookie | `__Host-da_admin_login`: the sealed email between the code request and its verification; httpOnly, Secure, SameSite=Strict, Max-Age=600; deleted after verification |
| Theme cookie | `__Host-da_admin_theme` = `light`\|`dark`, httpOnly, SameSite=Lax (SSR `data-theme`, no flash) |
| CSP | `default-src 'self'; script-src 'self' 'nonce-{n}' 'strict-dynamic'; style-src 'self' 'nonce-{n}'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' {sentry-ingest-if-configured}; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'; upgrade-insecure-requests` |
| Others | `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store` |
| Fonts | Geist and Geist Mono via `next/font/google`, self-hosted at build time (no runtime third-party requests) |

### 3.9 Rate limiting and lockout

All limits are implemented with `public.rate_limit_hit(p_key text, p_limit int, p_window_seconds int)` (DB §6.5, the canonical `rate_limits` table). Keys are hashed.

| Class | Key | Limit | On exceed |
|---|---|---|---|
| Code request per IP | `bo_otp_ip:{ip_hash}` | 5 / 15 min | 429 + "Çok fazla deneme…" |
| Code request per email | `bo_otp_send:{email_hash}` | 5 / h | the same generic copy; no email is sent |
| Code verify per email | `bo_login_email:{email_hash}` | 5 failures / 5 min → lock 15 min; 20 failures / 24 h → `admin_users.locked_until='infinity'` ⊕ (unlock by super_admin §6.23) | locked copy; audit `admin.locked` |
| MFA per session | `bo_mfa:{auth_session_id}` | 5 failures → sign-out | counts toward email bucket |
| Recovery redeem | `bo_recovery:{admin_id}` | 5 / h | 429 |
| Read (R) | `bo_r:{admin_id}` | 600 / min | 429 |
| Search (S) | `bo_s:{admin_id}` | 60 / min | 429 |
| Mutation (M) | `bo_m:{admin_id}` | 60 / min | 429 |
| Sensitive (X) | `bo_x:{admin_id}` | 30 / h (reveal, grants, push test, support access, admin ops, model/prompt/flag changes) | 429 + audit `admin.rate_limited` |

### 3.10 CSRF (M§48)

- Mutations exist only as server actions.
- Required `Origin` = `ADMIN_ORIGIN`, checked in both proxy.ts and the wrapper. A missing Origin is rejected.
- `Sec-Fetch-Site` must be `same-origin` when present.
- SameSite=Strict auth cookie.
- Route handlers are GET-only and side-effect-free.
- Idempotency keys stop double submits.

### 3.11 Bootstrap of the first super_admin (Manual external step)

- `pnpm admin:bootstrap --email <owner@company> --name "<Ad Soyad>"` runs `scripts/admin-bootstrap.ts` (Node) with `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from the owner's local environment or a protected CI job, never from the BO.
- It creates the admin identity and the `admin_users(role='super_admin', status='invited')` row, and prints the one-time `/invite?token=…` link to the terminal.
- It refuses to run if any active super_admin already exists.
- Audit `admin.bootstrap` (`actor_type='system'`).

---

## 4. RBAC (M§47; ADR-06; plan §10)

### 4.1 Permission catalogue

The source of truth is `packages/domain/rbac.ts` (`PERMISSIONS`, `ROLE_PERMISSIONS`). SQL mirror: `private.admin_role_permissions(role admin_role, permission text, primary key(role, permission))` ⊕, seeded by migration. A parity unit test compares the TypeScript source with the SQL seed file.

| Permission | Grants |
|---|---|
| `dashboard.read` | Dashboard KPIs/charts (aggregates) |
| `metrics.ops.read` | Ops aggregates: sync, jobs, briefings, notifications (M§119) |
| `metrics.ai.read` | AI aggregates: cost, tokens, latency, feedback ratios |
| `metrics.revenue.read` | MRR/ARR, revenue-derived figures |
| `metrics.product.read` | Feature usage, approval conversion, referral funnel |
| `users.read` | User list and detail (masked) |
| `users.pii.reveal` | Reveal masked PII (user email/name, integration email, ticket contact email, raw feedback text) |
| `users.force_sync` | Enqueue a sync for a user's accounts |
| `users.disable` | Disable and restore an account (SU) |
| `users.mark_internal` | Flag or unflag an internal/test account (metrics exclusion) |
| `integrations.read` | Integrations list and detail |
| `integrations.disconnect` | Disconnect a user integration (SU) |
| `integrations.renew_watch` | Force watch/subscription renewal |
| `jobs.read` | Jobs list/detail, correlation trace |
| `jobs.retry` | Retry failed/dead-letter jobs (single and bulk) |
| `jobs.cancel` | Cancel queued/retrying jobs |
| `briefings.read` | Briefing list (row level) |
| `briefings.regenerate` | Regenerate today's failed/skipped briefing |
| `notifications.read` | Notification decisions, devices (masked) |
| `push.test` | Send the generic test push (`POST /notifications/test-push`; never bypasses quiet hours, R-13) |
| `ai.read` | AI ops row-level views (request telemetry list, model config read) |
| `ai.models.write` | Edit `ai_model_config`, switch the per-plan routing profile (`balanced`/`lean`), run model probes |
| `prompts.read` / `prompts.write` / `prompts.activate` | Read / create-edit drafts / activate, rollback, archive |
| `ai_feedback.read` / `ai_feedback.reveal` | AI feedback aggregates and rows / reveal comment text |
| `subscriptions.read` | Subscription mirror, grants, trial stream (non-revenue) |
| `billing_events.read` | RevenueCat webhook events (sanitised) |
| `subscriptions.resync` | Enqueue `billing_sync` for a user |
| `entitlements.grant` | Temporary Pro 1/7/14/30 days, sources `admin`/`compensation`/`support` |
| `entitlements.grant_limited` | Temporary Pro 1/7 days, source `support` only |
| `entitlements.revoke` | Revoke an admin/support/compensation grant |
| `referrals.read` / `referrals.review` | Referral lists / approve or reject flagged ones |
| `support.read` / `support.write` | Tickets read / status, assignment, notes, replies |
| `support.access` | Request a Support Access grant (SU) and view granted content |
| `feedback.read` / `feedback.write` | Product feedback read / triage |
| `flags.read` / `flags.write` / `flags.write_ai` | Read / write all flags incl. kill switch / write flags whose key matches `ai.%` or `voice.%` only |
| `announcements.read` / `announcements.write` | Read / create, schedule, cancel |
| `data_requests.read` / `data_requests.manage` | Read / retry, regenerate export |
| `audit.read` | Global audit log + user Audit tab |
| `health.read` / `health.run` | System Health and app versions / run probes now |
| `admins.read` / `admins.manage` | Admin list / invite, role, status, MFA reset, sessions, unlock (SU) |
| `settings.system.write` | System settings + `plan_limits` (SU) |
| `search.global` | Command palette entity lookups (results filtered by per-entity read permissions) |

Every admin, whatever the role, can use own-account endpoints (`/me*`, `/session/*`).

### 4.2 Role × permission matrix

SA = super_admin, OP = operations, SU = support, FI = finance, AI = ai_ops, AN = analyst, RO = readonly.

| Permission | SA | OP | SU | FI | AI | AN | RO |
|---|---|---|---|---|---|---|---|
| dashboard.read | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| metrics.ops.read | ✓ | ✓ | — | — | ✓ | ✓ | ✓ |
| metrics.ai.read | ✓ | ✓ | — | — | ✓ | ✓ | ✓ |
| metrics.revenue.read | ✓ | — | — | ✓ | — | ✓ | — |
| metrics.product.read | ✓ | ✓ | — | ✓ | — | ✓ | ✓ |
| users.read | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| users.pii.reveal | ✓ | — | ✓ | — | — | — | — |
| users.force_sync | ✓ | ✓ | ✓ | — | — | — | — |
| users.disable | ✓ | ✓ | — | — | — | — | — |
| users.mark_internal | ✓ | ✓ | — | — | — | — | — |
| integrations.read | ✓ | ✓ | ✓ | — | — | — | ✓ |
| integrations.disconnect | ✓ | ✓ | — | — | — | — | — |
| integrations.renew_watch | ✓ | ✓ | — | — | — | — | — |
| jobs.read | ✓ | ✓ | ✓ | — | ✓ | — | ✓ |
| jobs.retry / jobs.cancel | ✓ | ✓ | — | — | — | — | — |
| briefings.read | ✓ | ✓ | ✓ | — | ✓ | — | ✓ |
| briefings.regenerate | ✓ | ✓ | — | — | — | — | — |
| notifications.read | ✓ | ✓ | ✓ | — | — | — | ✓ |
| push.test | ✓ | ✓ | — | — | — | — | — |
| ai.read | ✓ | ✓ | — | — | ✓ | — | ✓ |
| ai.models.write | ✓ | — | — | — | ✓ | — | — |
| prompts.read | ✓ | ✓ | — | — | ✓ | — | ✓ |
| prompts.write / prompts.activate | ✓ | — | — | — | ✓ | — | — |
| ai_feedback.read | ✓ | — | — | — | ✓ | — | ✓ |
| ai_feedback.reveal | ✓ | — | — | — | ✓ | — | — |
| subscriptions.read | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| billing_events.read | ✓ | — | — | ✓ | — | — | ✓ |
| subscriptions.resync | ✓ | — | ✓ | ✓ | — | — | — |
| entitlements.grant | ✓ | — | — | ✓ | — | — | — |
| entitlements.grant_limited | ✓ | — | ✓ | — | — | — | — |
| entitlements.revoke | ✓ | — | — | ✓ | — | — | — |
| referrals.read | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| referrals.review | ✓ | — | — | ✓ | — | — | — |
| support.read | ✓ | ✓ | ✓ | — | — | — | ✓ |
| support.write / support.access | ✓ | — | ✓ | — | — | — | — |
| feedback.read | ✓ | ✓ | ✓ | — | ✓ | — | ✓ |
| feedback.write | ✓ | ✓ | ✓ | — | — | — | — |
| flags.read | ✓ | ✓ | — | — | ✓ | — | ✓ |
| flags.write | ✓ | ✓ | — | — | — | — | — |
| flags.write_ai | ✓ | ✓ (via flags.write) | — | — | ✓ | — | — |
| announcements.read | ✓ | ✓ | ✓ | — | — | — | ✓ |
| announcements.write | ✓ | ✓ | — | — | — | — | — |
| data_requests.read | ✓ | ✓ | ✓ | — | — | — | ✓ |
| data_requests.manage | ✓ | ✓ | ✓ | — | — | — | — |
| audit.read | ✓ | ✓ | ✓ | — | — | — | ✓ |
| health.read | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| health.run | ✓ | ✓ | — | — | — | — | — |
| admins.read | ✓ | ✓ | — | — | — | — | ✓ |
| admins.manage / settings.system.write | ✓ | — | — | — | — | — | — |
| search.global | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ |

Notes:
- `operations` is "non-financial" (plan §10): no revenue metrics and no billing events.
- `analyst` sees aggregates only. On module pages, aggregate panels render and row-level tables are replaced by the forbidden state "Bu tablo için satır düzeyinde erişim yetkin yok; yalnızca özet metrikleri görebilirsin."
- `readonly` gets masked views with no reveal and no mutations.

### 4.3 Enforcement layers

1. **UI (cosmetic).** Sidebar items and actions are hidden or disabled using `/me.permissions`. This is never treated as authorisation (REQ-BO-RBAC-03).
2. **admin-api route guard** (§2.5 step 6) with the ctx permissions from SQL.
3. **SQL.** Every `admin_api` function calls `private.require_admin('<perm>')`. Mutations that depend on arguments add checks:
   - `entitlement_grant` requires `grant_limited` rules (days ∈ {1,7}, source `support`) when the caller lacks `entitlements.grant`;
   - `flag_*` requires `flags.write`, or `flags.write_ai` when the key matches `ai.%` or `voice.%`.
4. **pgTAP** asserts, for every role × every function, the allowed/denied outcome from the matrix, plus rejection for aal1 JWTs, non-admin JWTs, missing gateway headers, disabled admins and expired sessions.

### 4.4 Last super_admin and self-protection

- Trigger `private.admin_users_guard()` runs BEFORE UPDATE OR DELETE on `admin_users`:
  - DELETE is always refused (`admins_never_deleted`). Admins are only disabled, and audit references stay intact.
  - If the row is the last `role='super_admin' AND status='active'` and the update changes the role or status, it raises `last_super_admin`.
- Self-protection in `admin_update_role` / `admin_disable` / `admin_enable` / `admin_mfa_reset`: `p_admin_id <> caller` → otherwise `invalid_state` "Kendi rolünü, durumunu veya MFA'nı bu ekrandan değiştiremezsin."
- pgTAP covers both.

### 4.5 UI gating rules

- A page with no read permission renders ForbiddenState: "Bu bölümü görüntüleme yetkin yok." and audits `admin.permission_denied` through the guard.
- Actions the admin lacks permission for are **not rendered**. Actions that are permitted but invalid for the current state render disabled, with a tooltip giving the reason (e.g. "Çalışan iş iptal edilemez.").

---

## 5. Cross-cutting UI standards

### 5.1 Design language (from PRIMARY tokens, M§72, ADR-03)

The BO consumes `packages/design-tokens/dist/tokens.css` (Tailwind v4 `@theme`, `[data-theme="dark"]` overrides). No raw hex values are allowed outside tokens; this is lint-enforced. There are no BO artboards in PRIMARY. The rules below derive the admin UI from PRIMARY neutrals, brand and semantics at desktop density, as the design-system audit proposed.

| Role | Light | Dark | Token |
|---|---|---|---|
| Page background | `#F5F4F0` | `#141311` | `--da-bg` |
| Card / panel / table body | `#FFFFFF` | `#1F1E1B` | `--da-surface` |
| Table header, sunken wells, sidebar | `#F0EFEB` | `rgba(255,255,255,.08)` | `--da-surface-sunken` |
| Row hover | `#F7F6F2` | `#2A2926` | `--da-surface-pressed` |
| Selected row / active nav bg | `#EDEDFC` | `rgba(133,134,242,.16)` | `--da-primary-soft` |
| Hairline / row divider | `rgba(27,25,23,.06)` / `.07` | `rgba(255,255,255,.06)` / `.07` | `--da-hairline`, `--da-border-row` |
| Control border | `rgba(27,25,23,.20)` | `rgba(255,255,255,.16)` | `--da-border-control` |
| Text primary / secondary | `#1A1917` / `#6B6860` | `#F2F0EB` / `#A39F96` | `--da-text`, `--da-text-2` |
| Meta text (AA) | `ink/tertiary-strong` (audited `#6F6C66`) | audited `#87857D` | `--da-text-3-strong` |
| Primary action (pressed) | `#5B5CE2` (`#4B4CCB`), text `#FFF` | `#8586F2`, text `#0F0F2A` | `--da-primary` |
| Link / on-soft | `#4547C9` | `#A9AAF5` / `#C3C4F8` | `--da-link` |
| Focus ring (2 px, offset 2) | `#5B5CE2` | `#A9AAF5` | `--da-focus` |
| Critical soft / text / solid | `#FCEDE9` / `critical/text` (AA-fixed value) / `#E0553F` | `rgba(224,85,63,.18)` / `#F08B78` | `--da-critical-*` |
| Warning | `#FDF2DC` / `#9A6300` / `#E09A1C` | `rgba(217,139,11,.18)` / `#F0B85A` | `--da-warning-*` |
| Success | `#E4F5EA` / `#1E7A47` / `#2FA062` | `rgba(47,160,98,.18)` / `#6FCF97` | `--da-success-*` |
| Info | `#E7F0FD` / `#2262BE` / `#3B82E6` | `rgba(59,130,230,.18)` / `#8DB8F5` | `--da-info-*` |
| Toast (sonner) | bg `#1A1917`, text `#FFF`, icon `#A9AAF5` | bg `#2A2926` + ring `.08`, text `#F2F0EB` | `--da-toast-*` |
| Scrim | `rgba(27,25,23,.35)` | `rgba(0,0,0,.5)` | `--da-scrim` |
| Card elevation | `0 1px 2px rgba(27,25,23,.04), 0 6px 20px rgba(27,25,23,.05)` | `0 0 0 1px rgba(255,255,255,.06)` (hairline, no shadow) | `--da-shadow-card` |

**Typography (Geist; desktop density)**

| Use | Style |
|---|---|
| Page title | 22/28/600 (PRIMARY h2) |
| Section / card title | 17/23/600 (h3) |
| Body and forms | 14/20/400 (PRIMARY secondary scale) |
| Table cell | 13/18/400 with `tabular-nums` |
| Table header | 12/16/600, sentence case, `--da-text-2` |
| KPI value | 28/34/600 (h1), tabular |
| KPI label / sidebar group kicker | 12/16/600 +8% caps, `--da-text-3-strong` |
| Badge | micro 11/14/700 +5% caps |
| IDs, hashes, JSON | Geist Mono 12/16 |

Lora is not used in the BO.

**Spacing, radius and icons**
- 4-pt grid. Page padding 24, card padding 20, grid gaps 16/24.
- Table cell padding 12×10, compact 8×6 (admin preference).
- Radius: card 16, dialog/sheet 20, button/input/tooltip 10, badge/pill 999.
- Icons: Material Symbols Rounded as generated DOM SVG components (⊕ web target of the icon codegen). 20 px in nav, 16 px inline. FILL 0 by default, FILL 1 for the active nav item.

**Semantic rules carried over from PRIMARY**
- Indigo is used only for the primary action, the selected nav item and tab, links, focus, and AI markers: AI module headers and AI series in charts.
- Coral is used only for failures and destructive actions.
- Badges are coloured only for semantic states, per enum:
  - `failed` / `dead_letter` / `down` / `error` / `needs_reauth` → critical;
  - `retrying` / `degraded` / `partial` / `waiting_user` / `flagged` → warning;
  - `completed` / `ok` / `healthy` / `executed` / `resolved` → success;
  - `running` / `syncing` / `in_progress` / `scheduled` → info;
  - everything else neutral.
- A **dashed border** means "proposed / not yet real". It is applied to draft prompt versions, draft/scheduled announcements and not-yet-active grants.

**Layout**
- Sidebar 248 px (collapsible to 64 px, state stored in preferences), topbar 56 px, content max-width 1440 px.
- Desktop-first, with a minimum design width of 1024 px. Below that, the sidebar becomes a drawer and tables scroll horizontally inside their card. At phone width, 16 px gutters and no page-level horizontal scroll.
- **Topbar:** breadcrumb · search trigger "Ara… ⌘K" · theme toggle (Açık/Koyu) · environment pill (`APP_ENV` ≠ production shows "ÖNİZLEME" in warning tone) · admin menu (ad, rol, "Ayarlar", "Çıkış yap").

### 5.2 Sidebar (M§46 IA, exact order)

| Group (tr) | Item (tr) → route | Visible if any of |
|---|---|---|
| Genel Bakış | Pano → `/dashboard` | dashboard.read |
| Kullanıcılar | Kullanıcılar → `/users` | users.read |
| | Destek → `/support` | support.read |
| Operasyon | Entegrasyonlar → `/integrations` | integrations.read |
| | Senkron ve İşler → `/jobs` | jobs.read, metrics.ops.read |
| | Brifingler → `/briefings` | briefings.read, metrics.ops.read |
| | Bildirimler → `/notifications` | notifications.read, metrics.ops.read |
| Yapay Zekâ | AI Operasyonları → `/ai` (tabs: Genel `/ai`, Modeller `/ai/models`) | ai.read, metrics.ai.read |
| | Prompt Yönetimi → `/ai/prompts` (tabs: Promptlar, AI Geri Bildirimi `/ai/feedback`) | prompts.read, ai_feedback.read |
| İş | Abonelikler → `/subscriptions` | subscriptions.read, metrics.revenue.read |
| | Davetler → `/referrals` | referrals.read, metrics.product.read |
| Ürün | Geri Bildirim → `/feedback` | feedback.read |
| | Özellik Bayrakları → `/flags` | flags.read |
| | Duyurular → `/announcements` | announcements.read |
| Gizlilik | Veri Talepleri → `/data-requests` | data_requests.read |
| | Denetim Kayıtları → `/audit` | audit.read |
| Sistem | Sistem Sağlığı → `/health` | health.read |
| | Yöneticiler → `/admins` | admins.read |
| | Ayarlar → `/settings` | always |

The `en` labels are the M§46 English names verbatim.

### 5.3 DataTable standard (M§70; REQ-BO-TABLE-01)

`<DataTable<Row>>` is used by every list. Its contract:

| Aspect | Spec |
|---|---|
| Engine | TanStack Table 9.2.4 `useTable({features:{columnVisibility, sorting, pagination, rowSelection?}, manualSorting:true, manualPagination:true, manualFiltering:true})`; rows come from the server component. |
| Pagination modes | `offset` (exact `total`, numbered pages, for bounded tables: admins, flags, prompts, announcements, tickets, feedback, referrals, subscriptions, grants, data requests) and `cursor` (keyset over `(sort_col, id)`; "Önceki / Sonraki"; `total_estimate` from `pg_class.reltuples` or `count(*)` capped at 10,000 → "10.000+"; for users, jobs, audit, notifications, briefings, billing events, AI requests, integrations). |
| Page size | 25 (default) · 50 · 100 (server max 100). Persisted per table in `admin_preferences.table_prefs[tableId].pageSize`. |
| URL state (nuqs) | `?page=` or `?cursor=&dir=next\|prev`, `size`, `sort=<col>`, `order=asc\|desc`, `f.<filter>=` (multi-values comma-separated), `q=` (identifier search only). Every table state is deep-linkable and survives reload. |
| Sorting | Only allow-listed columns per endpoint (documented per module). Headers use `aria-sort`, and a keyboard Enter/Space toggles asc → desc → default. |
| Filtering | Toolbar: typed filter chips (enum multi-select, date range, id input). Active filters render as removable chips + "Filtreleri temizle". Free text is never a content search (M§69). |
| Column visibility | "Sütunlar" menu; required columns (id/primary) are not hideable; persisted in `table_prefs[tableId].hidden`. |
| Density | Comfortable / Kompakt (preference). |
| Row selection | Only where bulk actions exist (Jobs). The header checkbox selects the current page; the bulk bar shows "{n} seçildi". |
| Row click | Navigates to the detail route or opens a detail Sheet (defined per module). Middle-click / ⌘-click opens a new tab (rows render as `<a>`). |
| Loading | First load: Suspense skeleton, 10 rows shimmer (reduce-motion → static). Refetch: rows are kept with 60% opacity and a 2 px indigo progress bar (`useTransition`). |
| Empty (no data) | Module copy (see blocks) + optional primary CTA. |
| Empty (filtered) | "Filtrelerle eşleşen kayıt yok." + [Filtreleri temizle] |
| Error | Icon `error` + "Veriler yüklenemedi." + `code` + "Hata kimliği: {correlationId}" (copy button) + [Tekrar dene] (`reset()` + `router.refresh()`) |
| Forbidden | "Bu bölümü görüntüleme yetkin yok." |
| Partial | When aggregate cards fail but the table loads (or vice versa), each region shows its own error with retry. |
| Accessibility | `<table>` semantics, `<caption class=sr-only>`, row actions menu reachable by Tab, focus visible, 44 px minimum targets for icon buttons. |
| Performance | The server returns ≤100 rows; p95 list latency target is 500 ms (logged per route); `statement_timeout` 10 s. |

### 5.4 Confirmation levels and the reason field

| Level | Used for | UI |
|---|---|---|
| L1 | Low-risk, reversible (ticket status, assignment, internal note, feedback triage, preference) | No dialog; optimistic pending state; sonner toast "Kaydedildi."; audited where listed |
| L2 | Sensitive (force sync, retry, cancel, push test, regenerate, grant, resync, referral review, prompt activate/rollback, model config, flag targeting, announcement schedule/cancel, data-request retry, PII reveal, health run) | Dialog: title = verb, "Ne olacak" summary of exact effects, **Gerekçe** textarea (10–500), primary button with the verb (e.g. "Tekrar dene"), [Vazgeç] |
| L3 | Destructive / high impact (disable/restore account, disconnect integration, kill switch on, bulk retry > 10, admin disable/role change/MFA reset/revoke sessions, settings.system changes, grant revoke) | L2 + typed confirmation ("Onaylamak için **{token}** yaz", token = last 6 chars of target id, flag key, or `DEVRE DIŞI`) + step-up code when required |

- The reason is stored verbatim in `audit_logs.reason`. It is never shown to end users.
- The `Idempotency-Key` is created when the dialog opens. Button states: idle → pending (spinner, disabled) → success toast / inline error.
- There are no timer-based fake successes. Success is shown only when the server returns `ok` (M§99).

### 5.5 PII masking and reveal (M§48, M§71; REQ-BO-PRIV-01..03)

| Data | Default display | Reveal |
|---|---|---|
| User email | `private.mask_email`: the first 2 chars of the local part (1 if the local part is ≤2 chars) + `***@` + domain → `yu***@gmail.com`; Apple relay → `***@privaterelay.appleid.com` | `users.pii.reveal`, reason, audit `user.pii_revealed` |
| User display name | `Y*** K.` | same |
| Integration mailbox email | masked as above | same (`field='integration_email:{account_id}'`) |
| Ticket contact email | masked | same |
| Feedback message | shown with emails and phone numbers auto-masked by regex | `users.pii.reveal` → raw text, audit `feedback.revealed` |
| AI feedback comment | hidden ("Yorum var · gizli") | `ai_feedback.reveal`, audit |
| User IDs | full uuid (not PII by itself); short form `3f9a2c1b` in lists | — |
| Push tokens | `ExponentPushToken[ab…yz]` | never |
| End-user IPs | not stored in BO views | never |
| Admin emails | unmasked to `admins.read`; masked elsewhere | — |
| OAuth tokens, passwords, secrets, API keys, email bodies, memory chunks, audio, captured files | **never displayed or returned** | none (Support Access excludes them, §9) |
| Assistant conversations | not displayed | only through the Support Access scope `assistant_transcript` (R-09, §9) |

- **Reveal UX:** `MaskedValue` with a [Göster] icon button → L2 dialog (reason) → the value appears for 60 s, then re-masks. Rules:
  - the value is never put in URLs, never logged, never cached, and never copied into the palette's recent items;
  - the response carries `Cache-Control: no-store`.
- **Lookup by exact email:** POST `/users/lookup` (the email goes in the body, never in a URL). It is matched by `lower(email)` in `admin_api.command_search` (user results only) and returns masked results. Audit `user.lookup_by_email` stores `details.email_hash` = HMAC with `PII_LOOKUP_PEPPER`.

### 5.6 Standard state copy (tr)

| State | Copy |
|---|---|
| Loading | skeletons (no text) |
| Offline (browser) | banner "Bağlantı yok. Veriler güncel olmayabilir." |
| Error | "Veriler yüklenemedi." / "Hata kimliği: {id}" / [Tekrar dene] |
| Forbidden | "Bu bölümü görüntüleme yetkin yok." |
| External credential | neutral badge "Yapılandırılmadı" + "Harici kimlik bilgisi gerekli: {service}" |
| Stale data | "Son güncelleme {relative}." (when a rollup is older than 30 min) |
| Not found | "Kayıt bulunamadı veya silinmiş." [Listeye dön] |
| Deleted user | "Bu kullanıcı hesabını silmiş. ({date})" with the subject hash prefix |

### 5.7 Charts (M§72 theme-aware)

- **Library:** Recharts 3.10.1 in client components. All colours come from CSS variables, so a theme switch re-renders without a reload.
- **Palette:**

  | Series kind | Colours |
  |---|---|
  | AI series (indigo ramp, AI marker semantics) | light `#3B3CA8, #5B5CE2, #7071EA, #A9AAF5, #C9C7F3`; dark `#C3C4F8, #A9AAF5, #8586F2, #7071EA, #4A4BC8` |
  | Failures | critical solid |
  | Success | success solid |
  | Delayed / warning | warning solid |
  | Neutral / "Diğer" / previous period | `#9B978E` (dashed line) |
  | Users / subscriptions | info blue |

- **Chrome:** grid `--da-hairline`; axis text 12 px `--da-text-2`; tooltip on `--da-surface` with the card shadow token and tabular numbers.
- **Accessibility:**
  - Every chart has a title, an `aria-describedby` summary ("Son 7 günde toplam 1.234; en yüksek 12 Eylül.") and a [Tablo olarak göster] toggle rendering `ChartTableFallback`.
  - Series are never distinguished by colour alone: legends and direct labels are always present.
- **States:** empty → "Bu aralıkta veri yok."; approximate percentiles (rollups) → "≈" prefix plus the tooltip "Günlük histogramlardan yaklaşık hesaplandı."

### 5.8 i18n and formatting (ADR-14)

- next-intl 4.14.6. Default `tr`, full `en`. Locale is stored in `admin_preferences.locale`.
- Numbers: `Intl.NumberFormat('tr-TR')` → `1.234`.
- Currency:
  - AI cost in USD: `Intl.NumberFormat(locale, {style:'currency', currency:'USD', maximumFractionDigits: v<1?4:2})`;
  - store prices are shown in their original currency.
- Dates: 24-hour `dd.MM.yyyy HH:mm` in the admin's timezone (default `Europe/Istanbul`), with a UTC tooltip. Relative times use date-fns `tr`.
- Durations: `1 dk 12 sn`, `850 ms`.

### 5.9 Accessibility (M§92 applied to BO)

- WCAG 2.2 AA contrast, using tokens with the AA fixes.
- Full keyboard operation. A skip link "İçeriğe geç". Radix dialogs trap focus and return it on close.
- `prefers-reduced-motion` respected. Visible focus. Form errors linked with `aria-describedby`.
- Playwright axe scan on every page in both themes (BO-E2E-34).

---

## 6. Module specifications (M§148 blocks)

Shorthand used in the blocks:
- "Roles" are derived from §4.2.
- Every mutation is a server action → admin-api route (§12) → `admin_api` function. It has an `Idempotency-Key`, and its audit row is written in the same transaction.
- "U:" lists unit tests (vitest in `apps/backoffice`, deno in `supabase/functions/admin-api`, pgTAP in `supabase/tests`). "E2E:" references §13.4.

### 6.0 Auth screens (Login, MFA, Invite)

| Field | Spec |
|---|---|
| Module | Admin authentication (M§48, M§88; ADR-06) |
| Route | `/login` (steps `email` → `code`), `/mfa`, `/invite` |
| Role access | Public (pre-auth). The admin gate is applied after authentication (§3.2). |
| Data source | Supabase Auth via `@supabase/ssr` (publishable key, server-side: `signInWithOtp`, `verifyOtp`, MFA); admin-api `/auth/preflight`, `/auth/attempt`, `/auth/status`, `/auth/invite/redeem`, `/auth/recovery-code/redeem`, `/session/start` → `admin_api.login_preflight`, `login_attempt_record`, `auth_status`, `invite_redeem`, `recovery_code_consume` (all ⊕), `admin_session_start` |
| Filters | — |
| Server pagination | — |
| Mutations | sign-in code request; code verify; MFA enrol/verify; recovery redeem; invite accept |
| Confirmation | Recovery-codes acknowledgement checkbox; the invite link needs an explicit button press; "Kodu tekrar gönder" has a 60 s cooldown |
| Audit event | `admin.login`, `admin.login_failed`, `admin.login_denied`, `admin.locked`, `admin.mfa_enrolled`, `admin.mfa_challenge_failed`, `admin.mfa_recovery_used`, `admin.recovery_codes_regenerated`, `admin.invite_accepted` |
| PII handling | admin-api hashes the email and IP (HMAC `PII_LOOKUP_PEPPER`) on receipt; only hashes reach `rate_limits` and `audit_logs`; responses and timing are identical for unknown emails (no account enumeration) |
| Empty/error state | Copy per §3.2–3.6; Supabase Auth outage → "Kimlik doğrulama servisine ulaşılamıyor. Birazdan tekrar dene." (never a fake login) |
| Tests | E2E BO-E2E-01..07. U: sendCodeAction / verifyCodeAction error mapping and identical responses for unknown emails; recovery code format and HMAC; lockout thresholds (pgTAP on `login_attempt_record`); invite token expiry/single use; `/auth/status` aal1 allow-list (deno); proxy redirects for aal1/no-session/no-claim |

### 6.1 Dashboard

| Field | Spec |
|---|---|
| Module | Dashboard (M§50, M§119) |
| Route | `/dashboard?range=24h\|7d\|30d\|90d&platform=all\|ios\|android` (default = `admin_preferences.dashboard_range`, initially `7d`) |
| Role access | `dashboard.read` (all roles). Panels: "Operasyon metrikleri" `metrics.ops.read`; "Ürün metrikleri" `metrics.product.read`; "AI maliyeti / aktif kullanıcı" `metrics.ai.read`; "Sistem durumu" `health.read`; "Güvenlik olayları" `admins.manage` |
| Data source | `GET /dashboard/metrics` → `admin_api.dashboard_metrics(p_range, p_platform)`; `GET /dashboard/charts?series=user_growth\|active_usage\|ai_costs\|subscriptions\|sync_failures` → `admin_api.dashboard_series`; `GET /metrics/ops` → `admin_api.metrics_ops`; `GET /metrics/product` → `admin_api.metrics_product`; `GET /health/summary` → `admin_api.health_latest`; `GET /security-events` → `admin_api.security_events`. Definitions in §7. |
| Filters | Range segmented control "24 saat · 7 gün · 30 gün · 90 gün"; platform (Tümü/iOS/Android; applies to user/active/push KPIs) |
| Server pagination | n/a (aggregates). The security events panel shows the latest 10 plus a link to `/audit?f.action=security` |
| Mutations | Range/platform change persists `dashboard_range` via `PATCH /preferences` (not audited) |
| Confirmation | — |
| Audit event | — (read) |
| PII handling | Aggregates only; security events show the admin display name and action, no end-user identifiers |
| Empty/error state | KPI card: "—" + "Henüz veri yok"; per-card error "Metrik yüklenemedi" + [Tekrar dene] (cards are independent); chart: "Bu aralıkta veri yok."; rollup staleness banner (§5.6) |
| Tests | E2E BO-E2E-09. U: range → window/bucket helper; delta computation vs previous period; KPI number formatting; series transforms. pgTAP: `dashboard_metrics` equals seeded expectations for all 4 ranges; denied for aal1/non-admin |

**Layout**
- Row 1: 11 KPI cards (M§50), 4 per row, with a delta vs the previous equal window.
  - Toplam kullanıcı · Aktif kullanıcı · Yeni kullanıcı · Pro kullanıcı (store + grant split) · Deneme · Bağlı e-posta hesabı · Bağlı takvim · AI istekleri · AI maliyeti · Brifingler · Push bildirimleri.
- Row 2: 5 charts in a 2-column grid: Kullanıcı büyümesi, Aktif kullanım, AI maliyeti, Abonelikler, Senkron hataları.
- Row 3: "Operasyon metrikleri" table (§7.4), "Sistem durumu" mini list (§11), "Güvenlik olayları".

### 6.2 Users

| Field | Spec |
|---|---|
| Module | Users (M§51) |
| Route | `/users` |
| Role access | `users.read` (SA, OP, SU, FI, RO) |
| Data source | `GET /users` → `admin_api.users_list(p_filters jsonb, p_sort text, p_order text, p_cursor text, p_limit int)` over `private.v_admin_users` ⊕ (joins `profiles`, `auth.users` (email), latest `app_installations`, `connected_accounts` agg, `sync_states` agg, `public.effective_entitlement(user_id)`, open `data_deletion_requests`). `POST /users/lookup` → `admin_api.command_search` (exact email, user results only) |
| Filters | Plan: Free · Pro · Deneme (M§51 Trial); Durum: Aktif · Pasif (Inactive = no `app_opened` in `metrics.inactive_after_days`, default 14) · Devre dışı · Silme bekliyor; Senkron hatası (Sync Error: any `sync_states` with `last_error_at > coalesce(last_success_at,'-infinity')` and `last_error_at > now()-24h`, or `consecutive_failures ≥ 3`); Bağlantı hatası (Connection Error: any `connected_accounts.status in ('needs_reauth','admin_consent_required','error')`); Platform: iOS/Android; Sağlayıcı: google/microsoft/apple_device/android_device; Oluşturulma tarihi aralığı; Dahili hesaplar (hidden by default; toggle "Dahili hesapları göster"); `q` = exact user id, id prefix ≥ 8 hex, or exact email (routes to lookup) |
| Server pagination | Cursor. Sort: `created_at` (default desc), `last_active_at`, `last_sync_at`, `connected_accounts_count`. Columns (M§51): Kullanıcı (masked name + short id), E-posta (masked), Plan (badge + source Mağaza/Davet/Yönetici/Destek/Telafi), Oluşturulma, Son aktiflik, Platform (icon + app version), Bağlı hesaplar (provider icons + count), Son senkron, Durum. Hideable: all except Kullanıcı |
| Mutations | None inline. The row menu links to user detail actions |
| Confirmation | — |
| Audit event | Email lookup → `user.lookup_by_email` |
| PII handling | Masked in SQL; no reveal in the list (reveal only in detail) |
| Empty/error state | "Henüz kullanıcı yok." / filtered empty / standard error |
| Tests | E2E BO-E2E-10. U: filter → query-param serialisation; plan badge mapping. pgTAP: each filter predicate on the fixture; masking; keyset stability across pages; email lookup audit |

### 6.3 User detail

Shared header on every tab:
- Masked name and email ([Göster]), full user id (copy), and badges: Plan + source, Durum, "Dahili", "Destek erişimi aktif".
- **"İşlemler" menu** (items rendered by permission):
  - "Senkronu başlat…" (L2)
  - "Geçici Pro tanımla…" (§6.14)
  - "Aboneliği yeniden eşitle…" (L2)
  - "Test bildirimi gönder…" (§6.8)
  - "Destek erişimi iste…" (§9)
  - "Dahili hesap olarak işaretle…" (L2)
  - "Hesabı devre dışı bırak…" / "Hesabı geri aç…" (L3 + SU)
- Tabs link to `/users/[id]/{tab}`.
- An unknown id whose subject hash matches a completed account deletion renders the deleted-user state.

#### 6.3a Overview tab (privacy-safe support view, M§49)

| Field | Spec |
|---|---|
| Module | User › Genel |
| Route | `/users/[id]/overview` |
| Role access | `users.read`; actions per permission |
| Data source | `GET /users/:id` → `admin_api.user_overview(p_user_id)` returning M§49 fields: user id, account status (active/inactive/disabled/deletion_pending), plan + source + expiry, integrations summary (provider, `account_status`, last sync), last sync overall, recent job errors (last 5: type, error code, time, job link), briefing status (latest per `briefing_kind`: status, time), push status (active tokens by platform, last receipt error, notification detail mode), app version(s) + platform(s) (`app_installations`), timezone, locale, retention policy, pending approvals count, open tickets count, flag overrides, created, last active |
| Filters | — |
| Server pagination | — (fixed small lists) |
| Mutations | `POST /users/:id/force-sync {account_ids?, reason}` → `admin_api.user_force_sync`. It enqueues provider sync jobs per account (google: `gmail_sync` if mail_read, `calendar_sync` if calendar_read, `tasks_sync` if tasks_read; microsoft: `outlook_sync`/`calendar_sync`/`tasks_sync`), idempotency `admin_force_sync:{account_id}:{type}:{5-min bucket}`, then pokes `worker`. Accounts in `needs_reauth`/`admin_consent_required`/`disconnected` are skipped with the reason "Hesap yeniden bağlanmalı; senkron başlatılamaz."; device providers are skipped with "Cihaz takvimi yalnızca uygulama açıldığında senkronlanır." `POST /users/:id/disable` / `restore` (SU) → `admin_api.user_disable` / `admin_api.user_restore` set `profiles.disabled_at/disabled_by_admin_id` ⊕ + scheduler exclusion, then Auth `updateUserById(id,{ban_duration:'876000h'\|'none'})`. Restore enqueues `reconciliation` per account. If the ban call fails → 207: "Hesap devre dışı bırakıldı ancak oturum açma engeli uygulanamadı." + [Tekrar dene] (the audit result is `partial`). `POST /users/:id/internal` → `admin_api.user_mark_internal` (`profiles.is_internal` ⊕) |
| Confirmation | Force sync L2 (lists the jobs that will be queued); mark internal L2; disable/restore L3 (typed last 6 of the user id), with the disable dialog stating: "Kullanıcı uygulamaya giriş yapamaz, senkron ve bildirimler durur. Mağaza aboneliği etkilenmez; kullanıcı ücretlendirilmeye devam edebilir." |
| Audit event | `user.force_sync` (metadata: job ids, skipped), `user.disabled`, `user.restored`, `user.marked_internal` / `user.unmarked_internal` |
| PII handling | Masked; reveal via header (`users.pii.reveal`) |
| Empty/error state | Section-level: "Bağlı hesap yok.", "Son 7 günde iş hatası yok.", "Henüz brifing oluşturulmadı."; section error + retry |
| Tests | E2E BO-E2E-11, 12. U: action menu gating; pgTAP: disable sets fields and the scheduler exclusion; force sync idempotency bucket; deno: ban failure → 207 partial + audit `partial` |

Cross-document requirements this tab creates:
- `api` must return 403 `ACCOUNT_DISABLED` for disabled users (API_CONTRACTS §3 account-state gate).
- The mobile app must show "Hesabın geçici olarak devre dışı bırakıldı. Destek ile iletişime geç." (⊕ §16).

#### 6.3b Integrations tab

| Field | Spec |
|---|---|
| Module | User › Entegrasyonlar (M§52) |
| Route | `/users/[id]/integrations` |
| Role access | `users.read` + `integrations.read` |
| Data source | `GET /users/:id/integrations` → `admin_api.user_integrations`: per `connected_accounts` row: provider, masked mailbox email, `capabilities_granted`, `account_status`, error class (§6.5), per-resource `sync_states` (mail/calendar/tasks: last success, last error code, consecutive failures, watch/subscription expiry), data-source control toggles (read-only), last 5 sync jobs |
| Filters | — |
| Server pagination | — (≤10 accounts) |
| Mutations | Per account: "Senkronu başlat" (as §6.3a, single account), "Watch'ı yenile" (`integrations.renew_watch`), "Bağlantıyı kes…" (§6.5) |
| Confirmation | L2 / L2 / L3 + SU |
| Audit event | `user.force_sync`, `integration.watch_renew_requested`, `integration.disconnected` |
| PII handling | Mailbox email masked; reveal field `integration_email:{id}` |
| Empty/error state | "Bu kullanıcı henüz bir hesap bağlamadı." |
| Tests | E2E BO-E2E-13. pgTAP: output never contains `oauth_credentials` columns |

#### 6.3c Briefings tab

| Field | Spec |
|---|---|
| Module | User › Brifingler (M§54) |
| Route | `/users/[id]/briefings` |
| Role access | `users.read` + `briefings.read` |
| Data source | `GET /users/:id/briefings` → `admin_api.user_briefings(p_user_id)` (last 30 local days) |
| Filters | Tür (morning/midday/evening/weekly), Durum (`briefing_status`), date range |
| Server pagination | Cursor; sort `local_date` desc (default), `scheduled_for`. Columns: Tür, Yerel tarih, Durum, Planlanan, Oluşturulma, Teslim, Üretim süresi, Öğe sayısı, AI maliyeti, Bildirim kararı, Atlama nedeni / hata kodu |
| Mutations | "Yeniden oluştur" on today's failed/skipped (§6.7) |
| Confirmation | L2 |
| Audit event | `briefing.regenerated` |
| PII handling | No briefing text (text only via Support Access scope `insights`, R-09) |
| Empty/error state | "Son 30 günde brifing yok." |
| Tests | E2E BO-E2E-16 |

#### 6.3d Usage tab

| Field | Spec |
|---|---|
| Module | User › Kullanım |
| Route | `/users/[id]/usage?range=7d\|30d\|90d` |
| Role access | `users.read` |
| Data source | `GET /users/:id/usage` → `admin_api.user_usage`: AI requests/tokens/cost by feature per day (`ai_usage_daily`) vs the `plan_limits` key `ai_daily_budget_units` (Free 50, master plan R-18/R-22), with budget-hit days; feature usage counts from `analytics_events` (briefing_opened, assistant_query_sent, capture_created, meeting_prep_opened, follow_up_actioned, search_performed, approval_decided); approvals created/approved/executed; reminders created; captures count and bytes; content volumes (email threads, calendar events, insights, memory chunks); notifications by decision |
| Filters | Range |
| Server pagination | — (aggregates) |
| Mutations | — |
| Confirmation | — |
| Audit event | — |
| PII handling | Counts only (M§42, M§119) |
| Empty/error state | "Bu aralıkta kullanım yok." |
| Tests | pgTAP: `user_usage` returns counts only (column allow-list test) |

#### 6.3e Subscription tab

| Field | Spec |
|---|---|
| Module | User › Abonelik (M§60, M§61, ADR-11) |
| Route | `/users/[id]/subscription` |
| Role access | `users.read` + `subscriptions.read`; the grant/revoke/resync actions require their own permissions |
| Data source | `GET /users/:id/subscription` → `admin_api.user_subscription`, three clearly separated panels: **"Mağaza aboneliği (RevenueCat)"** (`subscriptions` mirror: store, product, period type, active, will renew, expires, billing issue, environment, last synced, last event); **"Tanımlanan erişimler"** (`entitlement_grants`: source label Davet eden/Davet edilen/Yönetici/Destek/Telafi, start, end, granted by, reason, state Aktif/Planlandı/Bitti/Geri alındı); **"Etkin yetki"** (`public.effective_entitlement(user_id)`: `pro`/`free`, source, until); the user's `billing_events` (sanitised, 20 latest) |
| Filters | — |
| Server pagination | Grants and events offset, 20 per page |
| Mutations | Grant (§6.14), revoke (§6.14), "Aboneliği yeniden eşitle" → `POST /subscriptions/:userId/sync` → `admin_api.subscription_resync` ⊕, which enqueues `billing_sync` (idempotency `admin_billing_sync:{user}:{5-min}`) |
| Confirmation | Grant L2, revoke L3, resync L2 |
| Audit event | `entitlement.granted`, `entitlement.revoked`, `subscription.resync_requested` |
| PII handling | No store receipts or transaction ids beyond `original_transaction_id` (shown truncated `…4821`) |
| Empty/error state | "Mağaza aboneliği yok." / "Tanımlanmış erişim yok." |
| Tests | E2E BO-E2E-21, 22 |

#### 6.3f Referrals tab

| Field | Spec |
|---|---|
| Module | User › Davetler (M§45, M§62) |
| Route | `/users/[id]/referrals` |
| Role access | `users.read` + `referrals.read` |
| Data source | `GET /users/:id/referrals` → `admin_api.user_referrals`: own `referral_codes.code`, referrals as referrer (masked referees, status, risk), as referee (masked referrer), `referral_credits` + resulting grants, yearly cap usage (x/6, P-06) |
| Filters | Status |
| Server pagination | Offset 20 |
| Mutations | Approve/reject a flagged referral (§6.15) |
| Confirmation | L2 |
| Audit event | `referral.approved`, `referral.rejected` |
| PII handling | Counterparties masked; risk signals as labels only (hashed signals are never shown) |
| Empty/error state | "Davet kaydı yok." |
| Tests | E2E BO-E2E-23 |

#### 6.3g Support tab

| Field | Spec |
|---|---|
| Module | User › Destek (M§49, M§62) |
| Route | `/users/[id]/support` |
| Role access | `users.read` + `support.read`; access grants need `support.access` |
| Data source | `GET /users/:id/support` → `admin_api.user_support(p_user_id)` (the user's tickets plus Support Access grants, active and history: admin, scope, reason, start/end, revoked, `reveal_count`) |
| Filters | Ticket status |
| Server pagination | Offset 20 |
| Mutations | "Destek erişimi iste…" / "Erişimi sonlandır" (§9) |
| Confirmation | L3 + SU (request), L1 (revoke) |
| Audit event | `support_access.granted`, `support_access.revoked` |
| PII handling | Per §5.5 and §9 |
| Empty/error state | "Destek talebi yok." / "Destek erişimi kaydı yok." |
| Tests | E2E BO-E2E-24 |

#### 6.3h Audit tab

| Field | Spec |
|---|---|
| Module | User › Denetim (M§66) |
| Route | `/users/[id]/audit` |
| Role access | `users.read` + `audit.read` |
| Data source | `GET /users/:id/audit` → `admin_api.user_audit(p_user_id)` (rows whose `target_user_id` is this user) |
| Filters | Action, admin, result, date range |
| Server pagination | Cursor, sort `occurred_at` desc (fixed) |
| Mutations | none (read-only; no edit or delete exists) |
| Confirmation | — |
| Audit event | — |
| PII handling | Metadata contains no PII by construction (§10) |
| Empty/error state | "Bu kullanıcıyla ilgili denetim kaydı yok." |
| Tests | E2E BO-E2E-29 |

### 6.4 Support tickets

| Field | Spec |
|---|---|
| Module | Destek talepleri (M§62; SREQ-70) |
| Route | `/support`, `/support/[id]` |
| Role access | Read `support.read` (SA, OP, SU, RO); write `support.write` (SA, SU) |
| Data source | `GET /support/tickets` → `admin_api.tickets_list`; `GET /support/tickets/:id` → `admin_api.ticket_detail` (ticket, conversation `support_notes`, right rail = privacy-safe support view from `user_overview` when `user_id` is set) |
| Filters | Durum (`ticket_status`: Açık · İşlemde · Kullanıcı bekleniyor · Çözüldü · Kapandı); Kategori (`ticket_category`: Hesap · Entegrasyon · Senkron · Faturalama · AI Kalitesi · Bildirim · Gizlilik · Diğer); Kaynak (Uygulama/Web); Platform; Uygulama sürümü; Atanan (Bana atananlar/Atanmamış/admin); date range; `q` = ticket reference `DA-2026-001042` (`support_tickets.public_ref`) or ticket/user uuid |
| Server pagination | Offset. Sort `updated_at` desc (default), `created_at`, `status`. Columns: No, Konu (subject, user-authored, shown), Kategori, Durum, Kaynak, Platform/sürüm, Kullanıcı (masked or "Web formu · eşleşme yok"), Atanan, Oluşturulma, Son güncelleme, İlk yanıt süresi |
| Mutations | `PATCH /support/tickets/:id {status?, category?, assigned_admin_id?, expected_updated_at}` → `admin_api.ticket_update`; `POST /support/tickets/:id/notes {body}` (internal note) → `admin_api.ticket_add_note`; `POST /support/tickets/:id/reply {body}` → `admin_api.ticket_add_note` with `kind='outbound_reply'` and `delivery_status='queued'` ⊕, then a `transactional_email` job sends it through the Postmark adapter (From `EMAIL_FROM_ADDRESS`, Reply-To `destek+t_{public_ref}@<mail-domain>`) and records `sent`/`failed` + `provider_message_id` on the note through `private.ticket_reply_delivery` ⊕; the status moves to `waiting_user`. Inbound replies arrive through `public-api POST /support/inbound-email` ⊕ → `support_notes kind='inbound_reply'`, `waiting_user → open` |
| Confirmation | Status/assign/internal note L1; reply: preview + [Gönder] (L2 without a reason); "Kapat" L2 |
| Audit event | `ticket.updated` (metadata from→to), `ticket.assigned`, `ticket.note_added`, `ticket.reply_sent` / `ticket.reply_failed` |
| PII handling | The message body was addressed to support by the user and is shown to `support.read`; contact email masked (reveal `users.pii.reveal`); diagnostics are content-free by schema |
| Empty/error state | "Açık destek talebi yok." ; reply failure: "Yanıt gönderilemedi. E-posta sağlayıcısı: {code}. [Tekrar gönder]"; email not configured: "Harici kimlik bilgisi gerekli: e-posta sağlayıcısı" (reply disabled, internal notes still work) |
| Tests | E2E BO-E2E-24. U: ticket reference formatting; reply idempotency (deno); inbound parser (deno: basic auth, MailboxHash → ticket, stripped reply, sender mismatch → `system` note flagged); pgTAP: status transitions |

### 6.5 Integrations

| Field | Spec |
|---|---|
| Module | Entegrasyonlar (M§52) |
| Route | `/integrations` |
| Role access | `integrations.read` (SA, OP, SU, RO); summary also with `metrics.ops.read` |
| Data source | `GET /integrations` → `admin_api.integrations_overview`; `GET /integrations/summary?range` ⊕ → `admin_api.integrations_summary` ⊕ (provider × status matrix, reconnect rate §7.4, watches expiring in 24 h, renewals failed in 24 h, oldest last-sync among healthy accounts) |
| Filters | Sağlayıcı (google/microsoft/apple_device/android_device); Durum mapped to M§52: Sağlıklı (`healthy`,`syncing`), Yeniden bağlanmalı (`needs_reauth`,`admin_consent_required`), OAuth hatası (error class `oauth_*`), Token yenileme hatası (`refresh_*`), Watch/abonelik sorunu (`watch_*`/`subscription_*` codes or `watch_expires_at < now()`), Kısmi (`partial`), Hata (`error` other), Bağlantı kesildi; "Son senkron daha eski" (1 h/6 h/24 h/7 d); Kullanıcı id; Hesap id |
| Server pagination | Cursor. Sort `last_sync_at` asc (default: stalest first), `created_at`, `consecutive_failures`. Columns: Hesap id (short), Kullanıcı (masked), Sağlayıcı, Hesap e-postası (masked), Yetenekler (icons), Durum, Hata kodu, Son senkron, Watch bitişi, Ardışık hata, Bağlanma tarihi |
| Mutations | Force sync (§6.3a); renew watch → `POST /integrations/:accountId/renew-watch` → `admin_api.integration_renew_watch` ⊕ (enqueues `watch_renewal`, idempotency `admin_watch:{account}:{15-min}`); disconnect → `POST /users/:id/integrations/:accountId/disconnect` (SU; body per API_CONTRACTS ADM-02): `admin_api.authorize('integrations.disconnect')` → the shared `_shared/integrations/disconnect.ts` used by `api` (stop watches/subscriptions → provider revoke (Google `/revoke`; Microsoft local only) → delete `oauth_credentials` → status `disconnected` → retention purge enqueue) → user notification (`notification_category='account'`, title_only: "Bağlantı kaldırıldı" / "{Sağlayıcı} hesabının bağlantısı destek ekibi tarafından kaldırıldı. Dilediğin zaman yeniden bağlayabilirsin.") → `audit_write` |
| Confirmation | L2 / L2 / L3 + SU (dialog lists the consequences: "Yeni mailler ve etkinlikler analiz edilmez; mevcut veriler saklama süresine göre silinir.") |
| Audit event | `integration.watch_renew_requested`, `integration.disconnected` (result `success`; Microsoft adds `details.revoke='unsupported'`; a failed step is a `failure` row with `details.partial=true`) |
| PII handling | Mailbox email masked; raw tokens are never read (the SQL has no access path to `oauth_credentials` in `admin_api`) |
| Empty/error state | "Henüz bağlı entegrasyon yok." |
| Tests | E2E BO-E2E-13. U: error-class mapping table. pgTAP: `integrations_overview` has no token columns; deno: disconnect partial path |

### 6.6 Sync & Jobs

| Field | Spec |
|---|---|
| Module | Senkron ve İşler (M§53, M§127) |
| Route | `/jobs`, `/jobs/[id]` |
| Role access | Read `jobs.read` (SA, OP, SU, AI, RO); summary with `metrics.ops.read`; retry/cancel SA, OP |
| Data source | `GET /jobs` → `admin_api.jobs_list`; `GET /jobs/stats?range` → `admin_api.jobs_summary` ⊕ (counts by `job_status`, queue depth `queued+retrying with run_at<=now()`, oldest ready job age, throughput/min last 15 min, failure rate by type, dead letters 24 h); `GET /jobs/:id` → `admin_api.job_detail` (job, sanitised payload (ids only; the payload zod schema forbids content), `job_attempts` timeline, parent/child jobs, related entities, correlation link); `GET /correlation/:id` → `admin_api.correlation_trace` (§8) |
| Filters | Durum (Kuyrukta · Çalışıyor · Tamamlandı · Yeniden deneniyor · Başarısız · Ölü mektup); Tür (all `job_type` values; the M§53 list is shown first: Initial Sync, Gmail Sync, Outlook Sync, Calendar Sync, Briefing, Meeting Prep, Retention, Export, Notification, Embedding, Provider Webhook); Kullanıcı id; Hesap id; Hata kodu; Korelasyon id; zaman aralığı (created/finished); "Yalnızca ölü mektuplar" quick filter; live toggle "Canlı (10 sn)" (client polling via `/api/admin/jobs`) |
| Server pagination | Cursor. Sort `created_at` desc (default), `run_at`, `finished_at`, `attempts`. Columns: İş id, Tür, Durum, Kullanıcı (masked/—), Hesap, Deneme (n/max), Çalışma zamanı, Başlangıç, Bitiş, Süre, Son hata kodu, Korelasyon. Row selection for bulk retry |
| Mutations | `POST /jobs/:id/retry` → `admin_api.job_retry`: allowed only for `failed\|dead_letter` and when `packages/domain/jobs-registry` + `private.job_admin_policy(type)` ⊕ allow it (not retryable: `push_receipts`, `health_check`, `watch_renewal` periodic types → "Bu iş türü periyodik; sonraki çalıştırmayı bekle."; `notification`: only if created < 60 min ago and not sent; `briefing`: only if `local_date` = user's today; `approval_execute`: allowed, provider-level idempotency guarantees no duplicate side effect (plan §7); `account_deletion`/`history_deletion`/`export`: via §6.19). Effect: `status='queued', run_at=now(), max_attempts=attempts+1, manual_retry_count+=1` ⊕, then poke `worker`. `POST /jobs/retry-bulk {job_ids ≤100}` → `admin_api.job_retry_bulk` returns `{retried:[…], skipped:[{id, reason_key}]}`. `POST /jobs/:id/cancel` → `admin_api.job_cancel`: only `queued\|retrying` → `failed` with `last_error_code='cancelled_by_admin'` (running: disabled, "Çalışan iş iptal edilemez.") |
| Confirmation | Retry L2 (shows the type-specific guard outcome); bulk retry L2 (≤10) / L3 (>10, typed `TEKRAR DENE`); cancel L2 |
| Audit event | `job.retried`, `job.bulk_retried` (metadata counts + ids), `job.cancelled` |
| PII handling | Error messages are scrubbed by the worker (`scrubPII`) and masked again in SQL (email regex); payload is ids only |
| Empty/error state | "Bu filtrelerle iş yok."; dead-letter empty: "Ölü mektup kuyruğu boş." |
| Tests | E2E BO-E2E-14, 15. U: retry policy table (domain); status badge map. pgTAP: retry allowed/denied per status and type; idempotent replay; cancel of running raises `invalid_state` |

### 6.7 Briefings

| Field | Spec |
|---|---|
| Module | Brifingler (M§54; C-21) |
| Route | `/briefings?range=&kind=` |
| Role access | Metrics `briefings.read` or `metrics.ops.read`; rows `briefings.read`; regenerate SA, OP |
| Data source | `GET /briefings/metrics` → `admin_api.briefings_metrics` (per `briefing_kind`: scheduled, generated, delivered, failed, skipped (+`skip_reason` breakdown: `no_meaningful_delta` (R-05), `no_sources`, `entitlement`, `user_disabled`, `account_disabled`), generation latency p50/p95, delivery delay p50/p95, AI cost, success rate §7.4); `GET /briefings` → `admin_api.briefings_list` |
| Filters | Tür (Sabah/Öğle/Akşam/Haftalık); Durum; Atlama nedeni; Hata kodu; Prompt sürümü; Kullanıcı id; yerel tarih aralığı |
| Server pagination | Cursor. Sort `scheduled_for` desc (default), generation latency. Columns as §6.3c + Kullanıcı (masked) |
| Mutations | `POST /briefings/:id/regenerate` → `admin_api.briefing_regenerate`: only `status in ('failed','skipped')` and `local_date` = today in the user's timezone; enqueues `briefing` with idempotency `briefing:{user}:{kind}:{local_date}:admin:{n}`, payload `{briefing_id, regenerate:true, notify:'if_not_delivered'}` |
| Confirmation | L2 ("Brifing yeniden oluşturulacak; daha önce teslim edilmediyse kullanıcıya bildirim gönderilir.") |
| Audit event | `briefing.regenerated` |
| PII handling | No narrative or item text (Support Access scope `insights` only, R-09) |
| Empty/error state | "Bu aralıkta brifing yok." |
| Tests | E2E BO-E2E-16. pgTAP: summary definitions §7.5; regenerate guard |

### 6.8 Notifications

| Field | Spec |
|---|---|
| Module | Bildirimler (M§55, M§86, M§132) |
| Route | `/notifications?range=&category=` |
| Role access | Metrics `notifications.read` or `metrics.ops.read`; rows `notifications.read`; push test `push.test` (SA, OP) |
| Data source | `GET /notifications/metrics` → `admin_api.notifications_metrics` (by `notification_category` × `notification_decision`: scheduled, sent, failed, suppressed, deduplicated; suppression reasons ⊕ `low_relevance`, `category_disabled`, `quiet_hours`, `frequency_cap`, `duplicate`, `entitlement`, `no_active_device`, `push_disabled`, `account_disabled`; suppression rate; receipts: ok / DeviceNotRegistered / MessageRateExceeded / MessageTooBig / InvalidCredentials / other; open rate from `notification_opened` events; detail-mode distribution); `GET /notifications` → `admin_api.notifications_list`; `GET /users/:id/devices` → `admin_api.user_devices` |
| Filters | Kategori, Karar, Bastırma nedeni, Detay modu, Makbuz durumu, Test bildirimi, Kullanıcı id, Korelasyon id, zaman aralığı |
| Server pagination | Cursor. Sort `created_at` desc. Columns: Bildirim id, Kullanıcı (masked), Kategori, Karar, Neden, Detay modu, Planlanan, Gönderim, Makbuz, Cihaz sayısı, Korelasyon |
| Mutations | `POST /notifications/test-push {user_id, installation_id?, reason, confirm}` (API_CONTRACTS ADM-07) → `admin_api.notification_send_test`: creates a `notifications` row (`category='account'`, `detail='generic'`, `is_test=true` ⊕, dedupe `admin_push_test:{installation or user}:{minute}`), enqueues `notification`, pokes `worker`. Content is fixed and holds no user data: title "Dijital Asistan", body "Test bildirimi". The test push bypasses frequency caps but **never quiet hours** (R-13): inside the user's quiet hours the row gets `decision='scheduled'` with `scheduled_for` = the quiet-hours end in the user's timezone. Without `installation_id` it goes to every active device of the user. Rate limit 3/h per user. The result panel shows the ticket, then "Makbuz bekleniyor" until `push_receipts` updates |
| Confirmation | L2; the dialog shows the device (platform, app version, masked token, or "Tüm aktif cihazlar") and the user's local time; inside quiet hours it states: "Kullanıcının yerel saati {HH:mm}, sessiz saatler içinde. Test bildirimi sessiz saatler bittiğinde ({HH:mm}) gönderilecek." |
| Audit event | `push.test_sent` |
| PII handling | Rendered title/body never shown (Support Access scope `notifications`); tokens masked |
| Empty/error state | "Bu aralıkta bildirim kararı yok."; user with no device: "Kullanıcının aktif cihazı yok." (push test disabled) |
| Tests | E2E BO-E2E-17. pgTAP: suppression rate §7.4; push test rate limit; readonly and support denied; a test inside quiet hours is stored as `scheduled` for the quiet-hours end and never sent at once |

### 6.9 AI Operations

| Field | Spec |
|---|---|
| Module | AI Operasyonları (M§56, M§82, M§119) |
| Route | `/ai?range=&feature=&model=&provider=&plan=` |
| Role access | Aggregates `metrics.ai.read` or `ai.read` (SA, OP, AI, AN, RO); request list `ai.read` |
| Data source | `GET /ai/metrics?range&group_by=feature\|model\|day\|prompt_version\|profile` → `admin_api.ai_metrics(p_range, p_group)` (requests, input/output/cache-read/cache-write tokens, estimated cost, cost per active user, error rate, p50/p95 latency, budget-blocked count, LLM-reach rate from classification tiers); the same function feeds the breakdown table and the latency and error-rate lines); `GET /ai/metrics/series?range&split=feature\|model` ⊕ → `admin_api.ai_cost_series` (stacked daily cost); `GET /ai/requests` → `admin_api.ai_requests_list` ⊕ (telemetry rows only). Raw `ai_requests` (kept 180 d) for 24h/7d, `ai_metrics_daily` ⊕ for 30d/90d (§7.6) |
| Filters | Range; Özellik (M§56 display groups over the canonical `ai_feature` values, mapped in `packages/domain/ai/features.ts`: E-posta sınıflandırma = `email_triage`; E-posta analizi = `thread_summary`, `email_deep_extract`; Brifing = `briefing_morning`, `briefing_midday`, `briefing_evening`, `weekly_review`; Asistan = `assistant_intent`, `assistant_qa`; Toplantı hazırlığı = `meeting_prep`; Toplantı sonrası = `post_meeting_parse`; Yakalama = `capture_extract`; Taahhüt = `commitment_extract`; Takip = `follow_up_draft`; Yanıt taslağı = `reply_draft`; Yaşam zekâsı = `life_intel_extract`; Embedding = `embedding_doc`, `embedding_query`; Ses = `stt`, `tts`; Yönetici testleri = `admin_probe`); Profil (Dengeli/Tasarruflu); Sağlayıcı; Model; Plan (free/pro); Durum |
| Server pagination | Breakdown table: server-sorted, no pagination (≤ 60 rows). Request list: cursor, sort `created_at` desc / `latency_ms` / `cost_usd_micros`; columns: Zaman, Özellik, Sağlayıcı/model, Prompt sürümü, Giriş/Çıkış token, Önbellek, Maliyet, Gecikme, Durum, Korelasyon, Kullanıcı (short id) |
| Mutations | — (kill switches are the `ai.*` / `voice.*` flags in Feature Flags, R-10, linked from here) |
| Confirmation | — |
| Audit event | — |
| PII handling | Telemetry has no content by construction (`ai_requests` has no prompt/response columns) |
| Empty/error state | "Bu aralıkta AI isteği yok."; provider not configured → "Yapılandırılmadı" badge per provider |
| Tests | E2E BO-E2E-18. U: histogram percentile helper parity (TS vs SQL `private.hist_percentile`); cost formatting. pgTAP: exact p50/p95 on raw fixture; rollup equality for complete days |

Charts (M§56):
- Günlük maliyet: stacked by feature, indigo ramp plus "Diğer".
- Özelliğe göre maliyet: bar.
- Modele göre maliyet: bar.
- Gecikme p50/p95: two lines; p95 dashed.
- Hata oranı: line, critical.

### 6.10 AI model config

| Field | Spec |
|---|---|
| Module | Modeller (M§57, M§81) |
| Route | `/ai/models` |
| Role access | Read `ai.read`; write `ai.models.write` (SA, AI) |
| Data source | `GET /ai/models` → `admin_api.ai_model_config_list()`: every `ai_model_config` row in the AI_PIPELINE_PLAN §3.6 shape plus `role` (master plan R-18): `profile` (enum `routing_profile`: `balanced \| lean`), `role` (`classifier \| reasoning \| embedding \| stt \| tts`, the M§57 concepts), `feature` (`ai_feature`), `tier`, `enabled`, `primary_target`, `fallback_targets`, `escalation_target`, `batch_policy`, `cache_ttl`, `max_input_tokens`, `eval_status`, `retires_not_before`, `version`, `updated_by`, `updated_at`; unique `(profile, role, feature)`, and each feature belongs to exactly one role. Also: the plan → profile assignment from the `plan_limits` key `ai_routing_profile` (seed Free `lean`, Pro `balanced`); provider credential presence computed in admin-api from `Deno.env` (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `VOYAGE_API_KEY`, `STT_API_KEY`, `TTS_API_KEY`) → `configured`/`not_configured` only, never values; the model catalogue `packages/domain/ai/model-catalog.ts` (id, provider, capabilities, embedding dimensions) with prices from `ai_model_prices`; the estimated monthly AI cost of a typical Pro user per profile from `ai_metrics_daily`; read-only `plan_limits` AI budgets |
| Filters | Profil (Dengeli · Tasarruflu), Rol, Özellik grubu (§6.9 groups) |
| Server pagination | — (fixed rows: 2 profiles × the `ai_feature` list) |
| Mutations | `PATCH /ai/models/:profile/:feature {enabled?, primary_target?, fallback_targets?, escalation_target?, batch_policy?, cache_ttl?, max_input_tokens?, expected_version, reason, confirm}` → `admin_api.ai_model_config_update`. Validation: only catalogue models whose capabilities satisfy the row's role (structured output for classifier and reasoning rows). Embedding rows accept only **1024-d** models, so they match `memory_chunks.embedding vector(1024)`: Voyage `voyage-4` for `embedding_doc` and `voyage-4-lite` for `embedding_query` (one shared embedding space). OpenAI `text-embedding-3-small` with `dimensions:1024` is offered only as the disaster-recovery re-embed target, never as a hot fallback (R-01). Model IDs matching `claude-fable-*` are refused (DB check, R-02). `fixture` is refused in production. A `not_configured` provider cannot be the primary. A new primary needs `eval_status='passed'` for (feature, provider, model, active prompt version); otherwise the save is refused with "Bu model için geçerli bir değerlendirme yok." and the attempt is audited (AI_PIPELINE_PLAN §3.4). `PATCH /ai/routing-profile {plan: 'free'\|'pro', profile: 'balanced'\|'lean', reason, confirm}` ⊕ → `admin_api.ai_routing_profile_set` ⊕ writes the `plan_limits` key `ai_routing_profile`; it takes effect within ≤60 s (config cache TTL). `POST /ai/models/:profile/:feature/test {fixture_set}` runs a fixed synthetic fixture prompt (no user data) through `_shared/ai` with the row's primary target, records `ai_requests` (`feature='admin_probe'`) and returns latency, token counts and schema-validation pass/fail; embedding rows also assert a vector length of 1024 |
| Confirmation | Model change L2 with a before → after diff; profile switch L2 showing the estimated monthly AI cost of a typical Pro user under both profiles (≈$2.24 `balanced`, ≈$1.02 `lean` at the 2026-09-23 prices, recomputed from `ai_metrics_daily`) |
| Audit event | `ai_model_config.updated` (details before/after), `ai_model_config.tested`, `ai_routing_profile.changed` (plan, from, to) |
| PII handling | No secrets shown (M§57) |
| Empty/error state | Provider not configured: "Yapılandırılmadı — Harici kimlik bilgisi gerekli" on that provider row; test failure shows the provider error code; `retires_not_before` within 30 days → warning badge "Emeklilik tarihi yaklaşıyor: {date}" (Haiku 4.5: not sooner than 2026-10-15; the replacement is a config change here, never a code change) |
| Tests | E2E BO-E2E-18. U: catalogue capability validation (1024-d rule, `claude-fable-*` refusal, eval gate); deno: env presence never echoes values; pgTAP: optimistic concurrency conflict, `(profile, role, feature)` uniqueness, the routing-profile switch writes `plan_limits` and an audit row |

Layout:
- Section "Yönlendirme profili": per plan (Free, Pro) a segmented control "Dengeli (balanced) / Tasarruflu (lean)" → `PATCH /ai/routing-profile` (L2). It shows the estimated monthly AI cost of a typical Pro user (≈$2.24 balanced, ≈$1.02 lean) from `ai_metrics_daily`. The pricing vs. AI-COGS trade-off is an owner decision (AI_PIPELINE_PLAN §3.5, ADR-08a).
- Section "Model yuvaları" shows the M§57 concepts (Sınıflandırıcı model, Akıl yürütme modeli, Embedding modeli, TTS, STT) as the `role` groups of the rows. Each card shows the primary model most features of that role use and lists the exceptions.
- Section "Özellik yönlendirmesi" has one row per (profile, feature): tier, primary, fallbacks, escalation, batch policy, cache TTL, input-token cap, enabled, eval status and `retires_not_before`.
- Section "Sağlayıcılar": Anthropic, OpenAI, Voyage, STT, TTS → Yapılandırıldı / Yapılandırılmadı.
- Worker and api cache the config for 60 s.

### 6.11 Prompt management

| Field | Spec |
|---|---|
| Module | Prompt Yönetimi (M§58) |
| Route | `/ai/prompts`, `/ai/prompts/[key]?compare=<v1>..<v2>&version=<v>` |
| Role access | Read `prompts.read` (SA, OP, AI, RO); drafts `prompts.write`; activate/rollback/archive `prompts.activate` (SA, AI) |
| Data source | `GET /ai/prompts` → `admin_api.prompts_list()` (per `prompt_key`: active version, versions count, last change, 7-day telemetry: requests, error rate, schema-invalid rate, 👍/👎 ratio); `GET /ai/prompts/:key` → `admin_api.prompt_versions_list` + `admin_api.prompt_telemetry(p_key, p_range)` ⊕ (per version: requests, error/schema-invalid/grounding-rejected rates, p95 latency, cost, feedback); `GET …/versions/:v` → `admin_api.prompt_version_get` ⊕. The key registry (allowed variables, output schema id) is in `packages/domain/ai/prompt-registry.ts`; its keys are exactly the AI_PIPELINE_PLAN §5.2 catalogue, which covers the M§58 keys: `email_classification`, `thread_summary`, `email_deep_extract`, `commitment`, `post_meeting`, `follow_up`, `life_intel`, `briefing_morning`, `briefing_midday`, `briefing_evening`, `weekly_review`, `meeting_prep`, `capture`, `capture_vision`, `capture_pdf`, `assistant_intent`, `assistant`, `reply_draft` |
| Filters | Key list: search by key name; versions: status (`prompt_status` Taslak/Aktif/Arşiv) |
| Server pagination | Versions table offset 20; sort `version` desc. Columns: Sürüm, Durum, Oluşturan, Oluşturulma, Aktifleştirilme, Not, İstek (7g), Hata oranı, 👍/👎 |
| Mutations | `POST /ai/prompts/:key/versions {from_version}` → `admin_api.prompt_create_draft` (copy → version max+1, `draft`); `PATCH …/versions/:v {system_text, user_template, notes, expected_updated_at}` → `admin_api.prompt_update_draft` (drafts only); `POST …/versions/:v/test` (fixture golden set from `packages/domain/ai/fixtures`, no user data → schema validation results); `POST …/versions/:v/activate` → `admin_api.prompt_activate` (gate: a passing eval report `eval_passed` for the version (AI_PIPELINE_PLAN §5.4), template variables ⊆ registry, required untrusted-content preamble present, size ≤ 32 KB; in one transaction: current active → `archived`, target → `active`; partial unique one-active-per-key); `POST /ai/prompts/:key/rollback {to_version}` → `admin_api.prompt_rollback` (re-activates an archived version; `rolled_back_from` ⊕); `POST …/archive` for drafts |
| Confirmation | Activate/rollback L2 (shows the diff summary +/− lines); archive L2 |
| Audit event | `prompt.draft_created`, `prompt.draft_updated`, `prompt.tested`, `prompt.activated`, `prompt.rolled_back`, `prompt.archived` (metadata: key, from/to version, content sha256) |
| PII handling | Prompts are product content, not user content; fixtures are synthetic |
| Empty/error state | "Bu anahtar için sürüm yok."; lint failure lists the rule violations ("Tanımsız değişken: {{x}}") |
| Tests | E2E BO-E2E-19. U: prompt lint; diff rendering (jsdiff unified/side-by-side). pgTAP: single active per key, activation atomicity, rollback, drafts-only edit |

Draft versions render with a dashed border. The editor is a monospace textarea with a variable-chip helper. The diff view is side-by-side / unified. Worker and api cache active prompts for 60 s. `ai_requests.prompt_version_id` links telemetry to each version (REQ-BO-PROMPT-06).

### 6.12 AI Feedback

| Field | Spec |
|---|---|
| Module | AI Geri Bildirimi (M§59; SREQ-83) |
| Route | `/ai/feedback?range=&group=feature\|model\|prompt_version` |
| Role access | Aggregates `ai_feedback.read` or `metrics.ai.read`; rows `ai_feedback.read` (SA, AI, RO); reveal `ai_feedback.reveal` (SA, AI) |
| Data source | `GET /ai/feedback/aggregates` → `admin_api.ai_feedback_aggregate` (positive, negative, ratio by feature/model/prompt version; top `reason_code`s; trend); `GET /ai/feedback` → `admin_api.ai_feedback_list` |
| Filters | Range, Özellik, Model, Prompt sürümü, Değerlendirme (👍/👎), Neden kodu, "Yorumlu" |
| Server pagination | Cursor, sort `created_at` desc. Columns: Zaman, Özellik, Model, Prompt sürümü, Değerlendirme, Neden, Yorum ("Gizli" badge), Kullanıcı (short id), AI isteği (link → correlation) |
| Mutations | `POST /ai/feedback/:id/reveal {reason}` → `admin_api.ai_feedback_reveal` |
| Confirmation | L2 |
| Audit event | `ai_feedback.comment_revealed` |
| PII handling | Comment hidden by default (M§59); no link to source content |
| Empty/error state | "Bu aralıkta AI geri bildirimi yok." |
| Tests | E2E BO-E2E-20 |

### 6.13 Subscriptions

| Field | Spec |
|---|---|
| Module | Abonelikler (M§60, M§43; ADR-11) |
| Route | `/subscriptions?tab=overview\|subscribers\|events\|grants\|trials&range=` |
| Role access | Counts `subscriptions.read` (SA, OP, SU, FI, RO); MRR/ARR `metrics.revenue.read` (SA, FI, AN); events `billing_events.read` (SA, FI, RO) |
| Data source | `GET /subscriptions/metrics` → `admin_api.subscriptions_metrics` (Aktif Pro (mağaza), Aktif Pro (yalnızca erişim tanımı), Denemeler, İptal edilen (yenilenmeyecek), Süresi dolan (aralıkta), İade (aralıkta), Faturalama sorunu, Tahmini MRR, Tahmini ARR, Yenilenecek MRR, yenilemeler 7/30 gün, ürünler (product_id × store: active, trial, will_renew), mağaza dağılımı, webhook processing lag p95 and backlog); `GET /subscriptions` → `admin_api.subscriptions_list`; `GET /subscriptions/events` → `admin_api.billing_events_list`; `GET /subscriptions/events/:id` ⊕ → `admin_api.billing_event_get` ⊕ (sanitised projection: id, type, store, environment, product, period type, purchased/expiration/event timestamps, price (USD + local), cancel/expiration reason, is_trial_conversion, received/processed, processing error, job link; never `subscriber_attributes`/`aliases`); `GET /entitlement-grants` ⊕ → `admin_api.entitlement_grants_list` ⊕; `GET /subscriptions/trial-stream` ⊕ → `admin_api.trial_stream` ⊕ |
| Filters | Subscribers: Mağaza, Ürün, Dönem tipi (normal/trial/intro), Aktif, Yenilenecek, Faturalama sorunu, Ortam (default PRODUCTION; SANDBOX shown with a badge). Events: Tür (RevenueCat event types), Mağaza, Ortam, İşlenme (İşlendi/Bekliyor/Hata), date range. Grants: Kaynak (`grant_source`), Durum, Tanımlayan admin |
| Server pagination | Subscribers offset (sort `expires_at`, `purchased_at`); Events cursor (sort `received_at` desc); Grants offset (sort `starts_at` desc); Trials cursor |
| Mutations | From here: resync (§6.3e) via the row menu; grants and revocations via §6.14 |
| Confirmation | As §6.3e / §6.14 |
| Audit event | `subscription.resync_requested` |
| PII handling | Users masked; transaction ids truncated; raw payload never rendered |
| Empty/error state | "Henüz mağaza aboneliği yok."; RevenueCat not configured: "RevenueCat yapılandırılmadı — Harici kimlik bilgisi gerekli" on the overview; unprocessed events older than 10 min → warning banner "İşlenmeyi bekleyen {n} RevenueCat olayı var." |
| Tests | E2E BO-E2E-21. pgTAP: MRR/ARR/refund/trial conversion definitions §7.5 against fixture events; the operations role gets no MRR fields (key absent, not null) |

Store entitlement and admin grant are **visually and structurally separate** (M§60). The "Etkin yetki" source label always names which one grants access.

### 6.14 Entitlement override

| Field | Spec |
|---|---|
| Module | Geçici Pro tanımı (M§61) |
| Route | Dialog on `/users/[id]/subscription` (also reachable from the header menu and the palette → navigates with `?action=grant`) |
| Role access | `entitlements.grant` (SA, FI: 1/7/14/30 days; sources Yönetici/Telafi/Destek), `entitlements.grant_limited` (SU: 1/7 days; source Destek); revoke `entitlements.revoke` (SA, FI) |
| Data source | `POST /users/:id/entitlement-grants {duration_days: 1\|7\|14\|30, source, reason, confirm}` → `admin_api.entitlement_grant`; `POST /users/:id/entitlement-grants/:grantId/revoke {reason, confirm}` → `admin_api.entitlement_revoke` |
| Filters | — |
| Server pagination | — |
| Mutations | Grant: `starts_at = greatest(now(), max(ends_at of active/planned grants))` (stacked, non-overlapping per ADR-11), `ends_at = starts_at + days`, `granted_by_admin_id`, `idempotency_key = 'admin:' \|\| Idempotency-Key`; enqueues `notification` (`account`, title_only): "Pro erişimin tanımlandı" / "{n} günlük Pro erişimin başladı." Revoke: only `source in ('admin','support','compensation')`, sets `revoked_at/by`, `ends_at = least(ends_at, now())` |
| Confirmation | Grant L2: the dialog shows duration radios "1 gün · 7 gün · 14 gün · 30 gün", source, computed start/end, "Mağaza aboneliği etkilenmez." Revoke L3 |
| Audit event | `entitlement.granted` (metadata days, source, starts/ends), `entitlement.revoked` |
| PII handling | — |
| Empty/error state | Validation: "Süre 1, 7, 14 veya 30 gün olmalı."; limited role above 7 days → `forbidden` |
| Tests | E2E BO-E2E-22. U: stacking computation (domain entitlement logic). pgTAP: grant_limited constraints; effective entitlement changes immediately; idempotent replay; referral grants not revocable here |

### 6.15 Referrals

| Field | Spec |
|---|---|
| Module | Davetler (M§62, M§45; plan §16; P-06) |
| Route | `/referrals?tab=overview\|list\|flagged&range=` |
| Role access | Aggregates `referrals.read` or `metrics.product.read`; rows `referrals.read`; review `referrals.review` (SA, FI) |
| Data source | `GET /referrals/metrics` → `admin_api.referrals_metrics` (invites, link opens, applied, successful, conversion, bonus days, abuse flags (new in range + open), top referrers masked with cap usage); `GET /referrals` → `admin_api.referrals_list` |
| Filters | Durum (DB `referral_status`: Beklemede · Nitelikli · Ödüllendirildi · İşaretli · Reddedildi); Risk sinyali (kendi kendine davet, cihaz çakışması, döngü, hız, yıllık limit); risk score range; date range; code |
| Server pagination | Offset. Sort `created_at` desc, `risk_score` desc. Columns: Davet id, Davet eden (masked), Davet edilen (masked), Kod, Durum, Risk skoru, Sinyaller (badges), Oluşturulma, Nitelik tarihi, Ödül tarihi |
| Mutations | `POST /referrals/:id/approve {reason, confirm}` / `POST /referrals/:id/reject {reason, confirm}` → `admin_api.referral_review(p_referral, p_decision, p_reason)`: `flagged → qualified` + enqueue `referral_evaluate` with `admin_decision='approve'` (credits for both sides stay idempotent via `referral_credits (referral_id, side)`), or `flagged\|pending → rejected` |
| Confirmation | L2 |
| Audit event | `referral.approved`, `referral.rejected` |
| PII handling | Hashed anti-abuse signals are never displayed; only labels |
| Empty/error state | "Henüz davet yok."; flagged empty: "İncelenecek işaretli davet yok." |
| Tests | E2E BO-E2E-23. pgTAP: review transitions; no double reward on repeated approve |

The anti-abuse config (cap 6/year, reward 14 days, minimum account age 48 h) is displayed read-only here and edited in Settings › Sistem.

### 6.16 Feedback

| Field | Spec |
|---|---|
| Module | Geri Bildirim (M§62; SREQ-71) |
| Route | `/feedback` |
| Role access | Read `feedback.read` (SA, OP, SU, AI, RO); triage `feedback.write` (SA, OP, SU); raw text `users.pii.reveal` |
| Data source | `GET /feedback` → `admin_api.feedback_list`; `GET /feedback/summary` ⊕ → `admin_api.feedback_summary` ⊕ (by `feedback_type`, rating distribution, by app version, status) — source `user_feedback` |
| Filters | Tür (Hata · Özellik isteği · Genel · AI Kalitesi); Durum (DB `user_feedback.status`, no new enum: Yeni `new` · Değerlendirildi `triaged` · Planlandı `planned` · Kapandı `closed`); Puan; Platform; Uygulama sürümü; Atanan; date range |
| Server pagination | Offset. Sort `created_at` desc, rating. Columns: Zaman, Tür, Puan, Mesaj (auto-masked, 2-line clamp), Platform/sürüm, Durum, Atanan, Kullanıcı (masked) |
| Mutations | `PATCH /feedback/:id {status?, assigned_admin_id?, expected_updated_at}` → `admin_api.feedback_update`; `POST /feedback/:id/reveal {reason}` → `admin_api.feedback_reveal` |
| Confirmation | Triage L1; reveal L2 |
| Audit event | `feedback.updated`, `feedback.revealed` |
| PII handling | Emails and phone numbers in the text are masked by default |
| Empty/error state | "Henüz geri bildirim yok." |
| Tests | E2E BO-E2E-25. U: auto-mask regex (tr phone formats `+90 5xx…`, emails) |

### 6.17 Feature flags

| Field | Spec |
|---|---|
| Module | Özellik Bayrakları (M§63) |
| Route | `/flags` (detail in a right Sheet `?flag=<key>`) |
| Role access | Read `flags.read` (SA, OP, AI, RO); write `flags.write` (SA, OP: all keys), `flags.write_ai` (AI: keys matching `ai.%` or `voice.%` only) |
| Data source | `GET /flags` → `admin_api.flags_list`; `GET /flags/:key` → `admin_api.flag_get` ⊕ (targeting, overrides, change history from audit); `GET /flags/:key/evaluate?user_id=` → `admin_api.flag_evaluate_preview` ⊕ (result + matched rule). Evaluation: `private.evaluate_flags(user_id, platform, app_version)` used by `api GET /me/bootstrap`; server gates read the same `private.evaluate_flags` result (30 s cache); parity with `packages/domain/flags.ts` |
| Filters | Anahtar öneki (`feature.` · `ai.` · `voice.`), Durum (Açık/Kısmi/Kapalı/Acil kapatıldı), arşiv |
| Server pagination | Offset. Sort `key`, `updated_at`. Columns: Anahtar, Açıklama, Hedefleme özeti ("%25 · iOS · Pro · ≥1.4.0"), Acil kapatma, Override sayısı, Son değişiklik, Değiştiren |
| Mutations | Create (`POST /flags`); update targeting (`PATCH /flags/:key {targeting, default_value, description, expected_updated_at}`); kill switch (`POST /flags/:key/kill {on}`: `on=true` sets `enabled=false` at once, `on=false` restores `enabled=true`; the targeting is kept); overrides (`POST …/overrides {user_id, value, expires_at?}`, `DELETE /flags/:key/overrides/:userId`); archive (`POST …/archive` ⊕). SQL: `admin_api.flag_upsert` (create and update), `flag_kill`, `flag_override_set`, `flag_override_delete`, `flag_archive` ⊕. Targeting schema (zod `FeatureFlagTargeting`, stored in `targeting jsonb` ⊕ next to the DB columns `enabled` and `is_kill_switch`): `{percentage:0–100, platforms:('ios'\|'android')[]\|null, plans:('free'\|'pro')[]\|null, min_app_version:semver\|null, max_app_version:semver\|null}`; evaluation order: `enabled=false` (off or killed) → false; active user override; all set targeting conditions AND; percentage bucket = first 32 bits of `md5(key \|\| ':' \|\| user_id)` mod 100 < percentage; else `default_value` |
| Confirmation | Create/update L2 (with a diff and "Etkilenen kullanıcı tahmini"); kill switch on L3 (typed flag key): "Bu özellik tüm kullanıcılar için hemen kapanır; sunucu tarafındaki işlemler de durdurulur." Kill off L2; override L2 |
| Audit event | `flag.created`, `flag.updated` (before/after), `flag.kill_switch_on`, `flag.kill_switch_off`, `flag.override_added`, `flag.override_removed`, `flag.archived` |
| PII handling | Override users shown masked; the user is recorded in `audit_logs.target_user_id` |
| Empty/error state | "Henüz özellik bayrağı yok." |
| Tests | E2E BO-E2E-26. U: evaluator (domain) + percentage parity test against the SQL function on 10,000 ids; semver compare |

Seeded keys are exactly master plan R-10 (AI_PIPELINE_PLAN §8.11 names the `ai.feature.*` keys):
- product flags `feature.midday`, `feature.evening`, `feature.voice`, `feature.meeting_prep`, `feature.capture`, `feature.android_ni`, `feature.weekly_review`, `feature.new_ai_model` (M§63);
- AI and voice switches `ai.global.enabled`, `ai.provider.anthropic.enabled`, `ai.provider.openai.enabled`, `ai.provider.voyage.enabled`, `ai.feature.<name>` (`email_triage`, `deep_extract`, `commitments`, `life_intel`, `briefing`, `briefing_polish` (R-05), `meeting_prep`, `capture`, `assistant`, `reply_draft`, `embeddings`), `ai.model.large.enabled`, `ai.model.opus_escalation`, `ai.batch.enabled`, `ai.backfill.enabled`, `ai.budget.org_daily_usd` (numeric payload), `voice.stt_server`, `voice.tts_premium`;
- `is_kill_switch=true` on every `ai.*` and `voice.*` key. Clients refresh flags on bootstrap (≤5 min cache); server gates cache for 30 s.

### 6.18 Announcements

| Field | Spec |
|---|---|
| Module | Duyurular (M§64) |
| Route | `/announcements` (editor Sheet `?id=` / `?new=1`) |
| Role access | Read `announcements.read` (SA, OP, SU, RO); write `announcements.write` (SA, OP) |
| Data source | `GET /announcements` → `admin_api.announcements_list`; `GET /announcements/:id` → `admin_api.announcement_get`; `POST /announcements/audience-estimate` → `admin_api.announcement_audience_estimate` (count of non-internal users matching audience/platform/version from the latest `app_installations`). Served to mobile by `api GET /me/bootstrap`; dismissals in `announcement_dismissals` |
| Filters | Durum (derived; there is no status column: Taslak = `published_at` null; Planlandı = published and `starts_at` > now; Yayında = published and now in [`starts_at`, `ends_at`); Bitti = `ends_at` ≤ now; İptal edildi = `cancelled_at` set), Platform, Kitle |
| Server pagination | Offset. Sort `starts_at` desc. Columns: Başlık (tr), Kitle, Platform, Sürüm aralığı, Başlangıç, Bitiş, Durum, Kapatılma sayısı, Oluşturan |
| Mutations | Create/update draft (`title_tr ≤60, body_tr ≤280, title_en, body_en` (both locales required), `audience: all\|free\|pro`, `platforms`, `min_app_version`, `max_app_version`, `starts_at`, `ends_at` (≤ start + 30 days), optional `cta_label_tr/en` + `cta_deeplink` from the allow-list of `dijitalasistan://` routes (plan §9), `dismissible`); `POST …/schedule` → `admin_api.announcement_publish` (sets `published_at`; "Şimdi yayınla" also sets `starts_at=now()`); `POST …/cancel` → `admin_api.announcement_cancel` (sets `cancelled_at`) |
| Confirmation | Schedule L2 (shows the audience estimate and preview); cancel L2 |
| Audit event | `announcement.created`, `announcement.updated`, `announcement.scheduled`, `announcement.cancelled` |
| PII handling | Plain text only; no HTML; no personal data |
| Empty/error state | "Henüz duyuru yok." |
| Tests | E2E BO-E2E-27. U: zod lengths; deeplink allow-list; preview renders tr/en × light/dark |

The preview renders the mobile Today announcement card with PRIMARY tokens in a 390 px phone frame, in light and dark, tr and en side by side. Drafts and scheduled items use a dashed border. The mobile Today announcement card is a cross-document dependency (⊕ §16).

### 6.19 Data requests

| Field | Spec |
|---|---|
| Module | Veri Talepleri (M§65, M§128, M§129; F-06) |
| Route | `/data-requests?tab=exports\|history\|account` |
| Role access | Read `data_requests.read` (SA, OP, SU, RO); manage `data_requests.manage` (SA, OP, SU) |
| Data source | `GET /data-requests?kind=export\|history\|account` → `admin_api.data_requests_list` (`data_export_requests`; `data_deletion_requests` kinds `history`/`account`); `GET /data-requests/:kind/:id` → `admin_api.data_request_get` ⊕ (status and per-step progress from `steps jsonb` (DB `data_deletion_requests.steps`; ⊕ on `data_export_requests`): exports `collect → package → upload → notify`; deletions `watches_stopped → provider_revoke → apple_siwa_revoked* → revenuecat_deleted* → db_purged → embeddings_purged → storage_purged → tokens_purged → auth_user_deleted*` (*account only), with attempts, `error_code` and the job link) |
| Filters | Durum: exports use DB `export_status` (Talep edildi · İşleniyor · Hazır · Süresi doldu · Başarısız · İptal edildi); deletions use DB `deletion_status` (Talep edildi · Doğrulandı · Kuyrukta · İşleniyor · Tamamlandı · Başarısız · İptal edildi); Kaynak (`origin` / `requested_via`: Uygulama · Web · Yönetici); age > 7 days; date range |
| Server pagination | Offset. Sort `requested_at` asc (oldest first, default for open), desc. Columns: Talep id, Kullanıcı (masked; completed account deletions: "Silinmiş kullanıcı · #3f9a…"), Kaynak, Talep tarihi, Durum, Adım (n/m), Deneme, Son hata, Tamamlanma, Talep yaşı (warning >7 d, critical >25 d, KVKK/GDPR 30-day window), Export: boyut + bağlantı bitişi |
| Mutations | `POST /data-requests/:kind/:id/retry` → `admin_api.data_request_retry` (failed → queued; resumes from the first incomplete step; same idempotency key; pokes `worker`); `POST /data-requests/export/:id/regenerate` → `admin_api.export_regenerate` (expired or failed export → new `export` job; the user is notified in-app/push; the admin never sees the file or its URL) |
| Confirmation | Retry L2 (deletion retry dialog: "Silme işlemi kaldığı adımdan devam edecek."); regenerate L2 |
| Audit event | `data_request.retried`, `data_request.export_regenerated` |
| PII handling | No export contents or signed URLs; completed deletions show only the subject hash prefix |
| Empty/error state | "Bu sekmede talep yok."; web requests (`origin='web_otp'`) still in `requested` (email code not yet verified) show "E-posta doğrulaması bekleniyor" (no actions) |
| Tests | E2E BO-E2E-28. pgTAP: retry only from `failed`; step resume; completed account deletion leaves no joinable user id |

The BO never marks a request "completed" manually. There is no fake "silindi" (M§129).

### 6.20 Audit logs

| Field | Spec |
|---|---|
| Module | Denetim Kayıtları (M§66) |
| Route | `/audit` (detail Sheet `?id=`) |
| Role access | `audit.read` (SA, OP, SU, RO) |
| Data source | `GET /audit` → `admin_api.audit_list`; `GET /audit/:id` ⊕ → `admin_api.audit_get` ⊕; `GET /audit/verify-chain?from&to` → `admin_api.audit_verify` (wraps `private.audit_verify_chain`; returns ok or the first broken `chain_seq`) |
| Filters | Zaman aralığı, Yönetici, Rol, Aksiyon (multi; group presets: Güvenlik, Kullanıcı işlemleri, Yapılandırma, Destek erişimi), Hedef türü, Hedef id, Sonuç (Başarılı · Başarısız · Reddedildi; partial outcomes are Başarısız rows with a "Kısmi" badge from `details.partial`), Korelasyon id, Aktör türü (admin/system/user/worker) |
| Server pagination | Cursor. Sort `occurred_at` desc (fixed, append-only). Columns (M§66): Zaman, Yönetici, Rol, Aksiyon, Hedef, Gerekçe, Sonuç, Korelasyon |
| Mutations | **None.** No edit, delete, export or purge function exists in UI, API or SQL (REQ-BO-AUDIT-02) |
| Confirmation | — |
| Audit event | — (reading the audit log is not audited; `audit_verify` failures raise a System Health incident) |
| PII handling | `details` is PII-free by construction; `target_user_id` appears as a short id with a link while the user exists, else as "Silinmiş kullanıcı · #{prefix of `private.hash_subject(target_user_id)`}" |
| Empty/error state | "Bu filtrelerle kayıt yok."; chain broken → critical banner "Denetim zinciri doğrulanamadı: kayıt #{id}. Güvenlik olayı olarak ele al." |
| Tests | E2E BO-E2E-29. pgTAP: UPDATE/DELETE/TRUNCATE rejected for every role incl. service; hash chain continuity; an account deletion leaves every audit row intact and `target_user_id` resolves to no user |

### 6.21 System Health

| Field | Spec |
|---|---|
| Module | Sistem Sağlığı (M§67) |
| Route | `/health?tab=probes\|versions\|cron` (probes default) |
| Role access | `health.read` (SA, OP, SU, FI, AI, RO); run `health.run` (SA, OP) |
| Data source | `GET /health/summary` → `admin_api.health_latest()` (latest `system_health_checks` per `component` + staleness); `GET /health/history?component&range` ⊕ → `admin_api.health_history(p_component, p_range)`; `POST /health/run {probes?}` → `admin_api.authorize('health.run')` → admin-api invokes the `health` Edge Function (HLT-02, secret) synchronously (≤20 s) → rows written with `checked_by='admin'` → `audit_write`; `GET /health/cron` → `admin_api.cron_status()` ⊕ (`cron.job_run_details` last runs of the eight DB §9 jobs `da_scheduler_tick`, `da_worker_poke`, `da_push_receipts`, `da_health_check`, `da_reconciliation`, `da_retention`, `da_billing_reconcile`, `da_cron_housekeeping`; queue lag; the last metrics rollup step of `scheduler_tick`, §7.6). Probe catalogue §11 |
| Filters | History: component, range 24h/7d/30d |
| Server pagination | History cursor (sort `checked_at` desc) |
| Mutations | "Şimdi çalıştır" (rate 1/min) |
| Confirmation | L1 (no reason needed; audited) |
| Audit event | `health.run_requested` |
| PII handling | Probe details are codes and latencies only, never secrets or URLs with keys |
| Empty/error state | Never shows green without a fresh successful probe (M§67): status "Bilinmiyor" + "Son kontrol {relative}" when stale (>10 min); `external_credential_required` → "Yapılandırılmadı — Harici kimlik bilgisi gerekli"; overall header rule §11 |
| Tests | E2E BO-E2E-30. deno: each probe's classification thresholds with mocked fetch; `external_credential_required` when env is missing; overall rule |

### 6.22 App health / versions (M§110)

| Field | Spec |
|---|---|
| Module | Uygulama sürümleri ve gözlemlenebilirlik |
| Route | `/health?tab=versions&range=7d\|30d` |
| Role access | `health.read` |
| Data source | `GET /health/app-versions` → `admin_api.app_versions_breakdown(p_range)` (from `app_installations`: platform × app_version × build: active installs (last_seen in range), share %, OS version distribution, push-enabled share; "Eski sürüm" = not among the 3 newest observed versions per platform; sync-error correlation: `device_calendar_ingest` failure rate and push receipt error rate by app version; server sync failure rate by provider) + Sentry adapter in admin-api (`_shared/observability/sentry-api.ts`): crash-free sessions/users per release via the Sentry sessions API (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`; response cached 10 min; endpoint verified during execution) |
| Filters | Platform, range, "Yalnızca eski sürümler" |
| Server pagination | — (≤ 50 version rows; server-sorted by version desc) |
| Mutations | — |
| Confirmation | — |
| Audit event | — |
| PII handling | Aggregates only |
| Empty/error state | Sentry not configured → crash columns "—" with "Sentry yapılandırılmadı — Harici kimlik bilgisi gerekli"; Sentry API failure → "Çökme verisi alınamadı" (other columns still render) |
| Tests | E2E BO-E2E-30. U: semver sort; old-version rule |

Links: "Sentry'de aç" deep links to the release when configured. The mobile and functions Sentry setup must tag `release = com.dijitalasistan.app@{version}+{build}` and `correlation_id` (cross-doc).

### 6.23 Admin users

| Field | Spec |
|---|---|
| Module | Yöneticiler (M§68) |
| Route | `/admins` |
| Role access | Read `admins.read` (SA, OP, RO); manage `admins.manage` (SA only, SU step-up) |
| Data source | `GET /admins` → `admin_api.admins_list` (display name, email, role, status (`admin_status` ⊕ Davet edildi/Aktif/Devre dışı), last login, MFA state (verified TOTP factor count from `auth.mfa_factors`, remaining recovery codes), active sessions, locked, invited by/at) |
| Filters | Rol, Durum, MFA (kurulu/kurulmamış), Kilitli |
| Server pagination | Offset. Sort `display_name`, `last_login_at`. |
| Mutations | Invite (§3.5, `admin_api.admin_invite_record`); resend invite (`POST /admins/:id/resend-invite` ⊕ → `admin_api.admin_invite_rotate` ⊕, rotates the token); `PATCH /admins/:id {role, reason, confirm}` → `admin_api.admin_update_role`; `POST /admins/:id/disable` → `admin_api.admin_disable` (status disabled + end all sessions + Auth ban); `…/enable` → `admin_api.admin_enable` (unban; status active); `…/reset-mfa` ⊕ → `admin_api.admin_mfa_reset` ⊕ (`auth.admin.mfa.deleteFactor` all + invalidate recovery codes + end sessions → next login requires enrolment); `…/revoke-sessions` → `admin_api.admin_sessions_revoke_all`; `…/unlock` ⊕ → `admin_api.admin_unlock` ⊕ (`locked_until=null`, counters reset) |
| Confirmation | Invite L2 + SU; role change, disable, reset MFA L3 + SU (typed `DEVRE DIŞI` for disable); enable, revoke sessions, unlock L2 + SU |
| Audit event | `admin.invited`, `admin.invite_resent`, `admin.role_changed` (from/to), `admin.disabled`, `admin.enabled`, `admin.mfa_reset`, `admin.sessions_revoked`, `admin.unlocked` |
| PII handling | Staff emails visible to `admins.read` |
| Empty/error state | Last-super-admin guard copy (§2.5); self-action guard copy (§4.4); email provider missing → invite disabled with the external-credential copy |
| Tests | E2E BO-E2E-31. pgTAP: guard trigger; self-protection; disabled admin JWT rejected on the next call; deno: invite rollback when `admin_invite_record` fails; 424 when email credentials are missing |

### 6.24 Settings

| Field | Spec |
|---|---|
| Module | Ayarlar (M§72; ADR-06) |
| Route | `/settings?tab=preferences\|security\|system` |
| Role access | Preferences and security: every admin (own account); system: read by all admins, write `settings.system.write` (SA, SU step-up) |
| Data source | `GET /me` ⊕ → `admin_api.admin_me`; `GET /preferences` / `PATCH /preferences` → `admin_api.admin_preferences_get` / `admin_api.admin_preferences_set` (`admin_preferences`: theme `light\|dark` (default light), locale `tr\|en`, timezone, density, `table_prefs`, `dashboard_range`, `recent_items`, sidebar collapsed); `GET /me/sessions` ⊕ → `admin_api.sessions_list_own` ⊕; factors via `supabase.auth.mfa.listFactors()` server-side; `GET /settings` → `admin_api.settings_get` ⊕ (`app_settings` + `plan_limits` via `plan_limits_list`); `PATCH /settings/config/:key {value, reason, confirm}` → `admin_api.settings_update` ⊕ (`app_settings`); `PATCH /settings/plan-limits {plan, key, value, reason, confirm}` → `admin_api.plan_limits_update` |
| Filters | — |
| Server pagination | Sessions list ≤ 20 |
| Mutations | Tercihler: Tema "Açık / Koyu" (next-themes `setTheme` + server action persist + cookie → survives reload, new browsers and devices), Dil, Saat dilimi, Yoğunluk. Güvenlik: yedek doğrulayıcı ekle / kaldır; kurtarma kodlarını yenile (SU); "Diğer oturumları kapat"; "Tüm oturumlardan çık". Sistem: `session.idle_minutes` (10–30), `session.absolute_hours` (4–12), `metrics.inactive_after_days` (7–60, default 14), `metrics.reporting_timezone`, `referral.max_rewards_per_year` (6), `referral.reward_days` (14), `referral.min_account_age_hours` (48), `support_access.max_minutes` (15, 30 or 60; never above 60, R-09), `admin.allowed_email_domains` display (the env value is authoritative and read-only); `plan_limits` rows (key/value per master plan R-22: `max_mail_accounts`, `max_calendars`, `ai_daily_budget_units` (Free 50), `ai_soft_cap_usd_day`, `ai_hard_cap_usd_day`, `ai_hard_cap_usd_month` and the M§44 feature booleans; `ai_routing_profile` is shown read-only here and switched in §6.10) |
| Confirmation | Preferences L1 (not audited); security actions L2; system changes L3 + SU with a before/after diff |
| Audit event | `admin.mfa_factor_added`, `admin.mfa_factor_removed`, `admin.recovery_codes_regenerated`, `admin.logout_all`, `settings.system_updated` (before/after), `plan_limits.updated` |
| PII handling | Own sessions show the browser family (derived from `user_agent`) and times only; IPs are stored only as hashes |
| Empty/error state | Standard |
| Tests | E2E BO-E2E-32. pgTAP: setting bounds (tightening only for session values); `plan_limits` audit |

### 6.25 Global search + command palette

| Field | Spec |
|---|---|
| Module | Genel arama / Komut paleti (M§69) |
| Route | Global overlay (⌘K / Ctrl+K; also the topbar "Ara… ⌘K") |
| Role access | Navigation commands: by sidebar visibility; entity lookup `search.global` + per-entity read permission (users→`users.read`, jobs→`jobs.read`, tickets→`support.read`, subscriptions→`subscriptions.read`, referral codes→`referrals.read`, integrations→`integrations.read`) |
| Data source | `GET /search?q=` (client via `/api/admin/search`, debounce 250 ms, min 3 chars except exact ids) → `admin_api.command_search(p_q)`; pattern routing: uuid → users, jobs, tickets, integrations (`connected_accounts.id`), subscriptions (`subscriptions.id`), referrals, data requests; uuid-prefix ≥ 8 hex → users, tickets only; `DA-\d{4}-\d{6}` → ticket `public_ref`; email → exact user lookup (POST semantics server-side; audited) + exact integration mailbox; referral alphabet `[A-HJ-NP-Z2-9]{6,8}` → referral code; store transaction id (digits ≥ 10 or `GPA.`) → subscription by `original_transaction_id`. Max 5 results per type, masked labels |
| Filters | Type chips inside the palette: Kullanıcı · İş · Talep · Abonelik · Davet kodu · Entegrasyon |
| Server pagination | — (top-N) |
| Mutations | None executed from the palette. Action commands ("Senkronu başlat…", "Geçici Pro tanımla…", "Hesabı devre dışı bırak…", "İşi tekrar dene…", "Bayrağı acil kapat…") navigate to the entity page with `?action=<name>`, which opens the standard ConfirmDialog (REQ-BO-CMDK-04). Local commands: "Tema: Koyu/Açık", "Çıkış yap" (opens a confirmation) |
| Confirmation | Per the target dialog |
| Audit event | Email lookups `user.lookup_by_email`; others none |
| PII handling | Never searches content (M§69); recent items (last 10) are stored server-side in `admin_preferences.recent_items` with masked labels only |
| Empty/error state | "Sonuç bulunamadı." / "Aramak için en az 3 karakter yaz." / "Arama yapılamadı. Tekrar dene." |
| Tests | E2E BO-E2E-33. U: pattern router; keyboard navigation; action commands never call mutations (spy). pgTAP: search permission filtering per role |

---

## 7. Metric definitions (M§50, M§54–56, M§60, M§62, M§119)

### 7.1 Conventions

- **Reporting timezone.** `tz = app_settings['metrics.reporting_timezone']`, default `Europe/Istanbul`.
- **Windows.** `private.metric_window(p_range)` ⊕ returns `(start_at, end_at, prev_start_at, bucket_unit)`:

  | Range | Window | Buckets |
  |---|---|---|
  | `24h` | `[now()-24h, now())` rolling | hourly (24) |
  | `7d` | `[local midnight of (today-6), now())` | daily (7) |
  | `30d` | `[local midnight of (today-29), now())` | daily (30) |
  | `90d` | `[local midnight of (today-89), now())` | ISO weeks (Monday start, local) |

  The previous period is the equally long window immediately before. Deltas show "+12% önceki döneme göre".
- **Population.** `private.metric_population` = `public.profiles where not is_internal`. Admin identities have no profiles (§3.1).
- **Sources.**
  - 24h and 7d come from raw tables.
  - 30d and 90d come from rollups (`metrics_daily` ⊕, `ai_metrics_daily` ⊕; §7.6).
  - Exceptions:
    - distinct-user metrics always use raw `analytics_events` (retained 400 days);
    - subscription/billing metrics always use raw `billing_events` (25 months) and the `subscriptions` mirror;
    - point-in-time counts use current tables.
- **Timestamps.** `analytics_events.effective_at` ⊕ = `occurred_at` if within `[received_at-72h, received_at+5min]`, else `received_at`.
- **Output.** Every metric function returns `{value, prev_value, unit, source:'raw'|'rollup', computed_at}`. Ratios return `null` when the denominator is 0 (UI "—").

### 7.2 Dashboard KPIs (M§50)

```sql
-- K1 Toplam kullanıcı (at end_at)
select count(*) from public.profiles p where not p.is_internal and p.created_at < :end_at;
-- K2 Yeni kullanıcı
select count(*) from public.profiles p where not p.is_internal and p.created_at >= :start_at and p.created_at < :end_at;
-- K3 Aktif kullanıcı (distinct app_opened in window; platform filter via e.props->>'platform')
select count(distinct e.user_id) from public.analytics_events e
join public.profiles p on p.user_id = e.user_id and not p.is_internal
where e.event_name = 'app_opened' and e.effective_at >= :start_at and e.effective_at < :end_at;
-- K4 Pro kullanıcı (now) = store ∪ grant; split store / grant_only
with store as (select s.user_id from public.subscriptions s
               where s.entitlement = 'pro' and s.environment = 'PRODUCTION' and s.is_active and s.expires_at > now()),
     grant_ as (select g.user_id from public.entitlement_grants g
               where g.revoked_at is null and g.starts_at <= now() and g.ends_at > now())
select count(*) filter (where u.user_id in (select user_id from store))                         as store,
       count(*) filter (where u.user_id not in (select user_id from store))                     as grant_only,
       count(*)                                                                                   as total
from (select user_id from store union select user_id from grant_) u
join public.profiles p on p.user_id = u.user_id and not p.is_internal;
-- K5 Deneme (now)
select count(*) from public.subscriptions s join public.profiles p using (user_id)
where not p.is_internal and s.environment='PRODUCTION' and s.is_active and s.period_type='trial';
-- K6 Bağlı e-posta hesabı (now; delta = new in window)
select count(*) from public.connected_accounts ca join public.profiles p using (user_id)
where not p.is_internal and ca.status <> 'disconnected' and 'mail_read' = any(ca.capabilities_granted);
-- K7 Bağlı takvim (now) — includes apple_device / android_device
... same with 'calendar_read' = any(ca.capabilities_granted);
-- K8 AI istekleri (raw ≤7d; rollup sum(requests) for 30d/90d)
select count(*) from public.ai_requests r where r.created_at >= :start_at and r.created_at < :end_at and r.status not in ('budget_blocked','killed','cached');
-- K9 AI maliyeti (USD)
select coalesce(sum(r.cost_usd_micros),0)/1e6 from public.ai_requests r where r.created_at >= :start_at and r.created_at < :end_at;
-- K10 Brifingler (generated; secondary figure delivered)
select count(*) filter (where b.status in ('ready','delivered')) as generated,
       count(*) filter (where b.status = 'delivered')            as delivered
from public.briefings b where b.generated_at >= :start_at and b.generated_at < :end_at;
-- K11 Push bildirimleri (sent)
select count(*) from public.notifications n where n.decision = 'sent' and n.sent_at >= :start_at and n.sent_at < :end_at;
```

Rollup equivalents for 30d/90d:
- K10 = `sum(value)` from `metrics_daily` where `metric_key='briefings.status'` and `dim2 in ('ready','delivered')`.
- K11 = `metric_key='notifications.decision'` and `dim2='sent'`.

### 7.3 Dashboard charts (M§50)

| Chart | Series | Definition |
|---|---|---|
| Kullanıcı büyümesi | bars: new users per bucket; line: cumulative total; line (neutral, dashed): deleted accounts | K2 per bucket (`date_trunc(unit, created_at at time zone tz)`); cumulative = K1 at bucket end; deletions = `data_deletion_requests` `kind='account'`, `status='completed'` by `completed_at` |
| Aktif kullanım | line: distinct active users per bucket (hour → DAU → WAU for 90d); dashed: previous period | K3 per bucket (raw `analytics_events`) |
| AI maliyeti | stacked bars by `ai_feature` group (top 6 + "Diğer") | K9 per bucket; ≤7d raw, else `ai_metrics_daily` |
| Abonelikler | line: active paid store subs (end of bucket); line: active grant-only users; bars: new paid conversions (INITIAL_PURCHASE non-trial + RENEWAL `is_trial_conversion`), cancellations (CANCELLATION non-refund) | Active paid at t = distinct users with a `billing_events` interval `[purchased_at, expiration_at)` from INITIAL_PURCHASE/RENEWAL/PRODUCT_CHANGE/UNCANCELLATION (PRODUCTION, period_type ≠ TRIAL) covering t and no refund CANCELLATION before t for that transaction; grant-only from `entitlement_grants` intervals minus store-covered users |
| Senkron hataları | bars: failed sync attempts; line: dead-lettered sync jobs | `job_attempts` with `outcome<>'success'` and type ∈ SYNC per bucket (raw ≤7d; `metrics_daily` `jobs.attempts`); `jobs` `status='dead_letter'` by `updated_at` (rollup `jobs.finished` dim2=`dead_letter`) |

`SYNC = {initial_sync, gmail_sync, outlook_sync, calendar_sync, tasks_sync, device_calendar_ingest, reconciliation, watch_renewal}`.

### 7.4 Ops and product metrics (M§119; `admin_api.metrics_ops` / `metrics_product`)

| Metric (tr label) | Definition |
|---|---|
| AI maliyeti / aktif kullanıcı | K9 / K3 over the same window |
| Sınıflandırma oranı | triaged / ingested: `count(*) filter (where m.triaged_at is not null) / count(*)` over `email_messages m` with `m.ingested_at` in window (rollup `email.triage`) |
| Karar katmanı dağılımı / LLM'e ulaşma oranı | share by `decision_tier` among triaged messages; LLM reach = `ai_classification` share (target ≤ 45%, from plan §8's 55–70% T0 pre-filter) |
| Brifing üretim başarısı | `count(status in ('ready','delivered')) / count(status in ('ready','delivered','failed'))` for briefings with `scheduled_for` in window; skipped reported separately (C-21) |
| Bildirim bastırma oranı | `count(decision in ('suppressed','deduplicated')) / count(*)` over `notifications.created_at` in window; breakdown by `suppression_reason` |
| Onay dönüşümü | `count(status in ('approved','executing','executed','failed')) / count(status in ('approved','executing','executed','failed','rejected','expired'))` over `approval_actions` created in window (pending excluded); secondary: execution success = `executed / (executed + failed)`; by `approval_action_type` |
| Senkron başarı oranı | `count(outcome='success') / count(*)` over `job_attempts` with type ∈ SYNC and `started_at` in window; by provider |
| Entegrasyon yeniden bağlanma oranı | Among accounts with a server event `integration_status_changed` (to ∈ {`needs_reauth`,`admin_consent_required`}) in window: fraction with a later `integration_status_changed` to `healthy` within 7 days (events after end_at count for the 7-day follow-up, capped at now) |
| Özellik kullanımı | Distinct users per feature event / K3: `briefing_opened`, `briefing_audio_played`, `meeting_prep_opened`, `assistant_query_sent`, `capture_created`, `follow_up_actioned`, `search_performed`, `approval_decided`, `voice_session_started` |
| Denemeden ücretliye akış | Stream (cursor list): billing events INITIAL_PURCHASE (period_type TRIAL), RENEWAL (`is_trial_conversion`), CANCELLATION during trial, EXPIRATION (trial), masked user, product, store, timestamp; conversion = conversions / (conversions + trial expirations) for trials ending in window |

### 7.5 Module metrics

| Module | Metric | Definition |
|---|---|---|
| Briefings | scheduled / generated / delivered / failed / skipped | counts over `briefings` with `scheduled_for` in window grouped by `kind` and final `status` (`generated` = ready + delivered) |
| | Üretim gecikmesi p50/p95 | `generated_at - generation_started_at` (raw `percentile_cont`; rollup histogram `briefings.gen_latency`) |
| | Teslim gecikmesi p50/p95 | `delivered_at - scheduled_for` |
| | AI maliyeti | `sum(cost_usd_micros)` of `ai_requests` with `feature in ('briefing_morning','briefing_midday','briefing_evening','weekly_review')`, one feature per kind |
| Notifications | by decision | `notifications` in window grouped by `category`, `decision`; "Planlanmış (bekleyen)" = current `decision='scheduled' and scheduled_for > now()` |
| | Makbuz hataları | `push_tickets.receipt_status/receipt_error` ⊕ by error in window |
| AI | error rate | `count(status in ('error','timeout','refused','validation_failed','grounding_failed')) / count(status not in ('budget_blocked','killed','cached'))` (rate limits are `error` rows with `error_code='RATE_LIMITED'`) |
| | p50/p95 latency | raw `percentile_cont(0.5/0.95) within group (order by latency_ms)`; rollup `private.hist_percentile(latency_hist, p)` ⊕ (≈) |
| | tokens | sums of `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` |
| Subscriptions | Tahmini MRR (USD) | `sum(case when s.period_months = 12 then s.price_usd_micros/12.0 else s.price_usd_micros end)/1e6` over `subscriptions` with `environment='PRODUCTION' and is_active and period_type='normal' and price_usd_micros > 0`, non-internal; gross (before store commission and taxes), USD from RevenueCat `price`; label "Tahmini MRR (USD, brüt; mağaza komisyonu ve vergiler öncesi)" |
| | Tahmini ARR | MRR × 12 |
| | Yenilenecek MRR | MRR restricted to `will_renew` |
| | İptal edilen | `is_active and not will_renew and unsubscribe_detected_at is not null` |
| | Süresi dolan (window) | distinct `original_transaction_id` with EXPIRATION in window |
| | İade (window) | CANCELLATION with `cancel_reason='CUSTOMER_SUPPORT'` in window minus REFUND_REVERSED for the same transaction |
| | Faturalama sorunu | `is_active and billing_issue_detected_at is not null` |
| Referrals | Davetler | count `referral_shared` events; Bağlantı açılışı = server `referral_link_opened` |
| | Uygulanan / Başarılı | `referrals` created / reached `rewarded` in window |
| | Dönüşüm | successful / applied |
| | Bonus günler | `sum(extract(epoch from ends_at - starts_at)/86400)` of `entitlement_grants` with `source in ('referral_referrer','referral_referee')` created in window |
| | Kötüye kullanım işaretleri | referrals entering `flagged` in window; open = current `flagged` |
| Integrations | provider × status | current `connected_accounts` counts; error class per §6.5 |
| Jobs | throughput / failure rate | `jobs` finished per type and status; failure rate = (failed + dead_letter) / finished |

### 7.6 Rollups ⊕

- **Tables.**
  - `metrics_daily(day date, metric_key text, dim1 text default '', dim2 text default '', dim3 text default '', value bigint, value_sum numeric, latency_hist int[], computed_at timestamptz, primary key(day, metric_key, dim1, dim2, dim3))`.
  - `ai_metrics_daily(day, feature, provider, model, prompt_version_id, plan, profile, status, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd_micros, latency_hist int[], computed_at, pk on all dims)`.
  - Neither table has a `user_id` column. Both have RLS enabled with no policies (admin/service only).
- **Metric keys** (dims in parentheses):
  - `briefings.status` (kind, status), `briefings.gen_latency` (kind), `briefings.delivery_delay` (kind);
  - `notifications.decision` (category, decision, reason), `push.receipts` (platform, error);
  - `jobs.finished` (type, status), `jobs.attempts` (type, outcome);
  - `email.triage` (decision_tier);
  - `approvals.created` (action_type), `approvals.final` (action_type, status);
  - `ai_feedback.rating` (feature, model, rating).
- **Histogram buckets (ms).** `private.latency_bounds()` = {50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 15000, 20000, 30000, 60000, 120000} plus an overflow bucket.
- **Job.** `private.rollup_metrics_daily(p_day date)` (security definer) is idempotent: it deletes and re-inserts the day in one transaction.
  - It runs from `private.scheduler_tick()` as a step executed when `extract(minute from p_now)::int % 15 = 0` (today and yesterday, local), plus the tick at 03:30 reporting-timezone time for day−2 (final).
  - There is no separate cron job: DB §9 keeps exactly eight `da_*` jobs (ADR-04 limit).
- **Why rollups.** They keep aggregate history after per-user retention purges (d30) and account deletions (aggregates are anonymous).

### 7.7 Privacy rules for metrics (M§42, M§119; REQ-BO-METRIC-02)

- Metrics are built only from counts, durations, costs, enums and event names. No content, subject lines, names or free text.
- `analytics_events` props are allow-listed and typed (ADR-13). Metric functions read only `event_name`, `user_id`, `effective_at` and allow-listed enum props (`platform`, `kind`, `category`, `provider`, `from`, `to`).
- Required events. The names come from the single analytics catalogue that the screen maps and API_CONTRACTS define and execution generates into `packages/domain/analytics/events.ts` (R-21); the BO never invents names:
  - client: `app_opened`, `briefing_opened`, `briefing_audio_played`, `meeting_prep_opened`, `assistant_query_sent`, `capture_created`, `follow_up_actioned`, `search_performed`, `approval_decided`, `voice_session_started`, `notification_opened`, `referral_shared`, `paywall_viewed`;
  - server: `integration_status_changed`, `referral_link_opened`, `ai_budget_exceeded`.

---

## 8. Correlation-id drill-down (M§118)

- **Origin.** A `correlation_id uuid` (v7) is created at the start of a causal chain:
  - an `api` request (from `x-correlation-id` or generated);
  - a webhook receipt (`webhook_events`, `billing_events`);
  - a `scheduler_tick` enqueue;
  - an admin mutation (the BO header).
- **Propagation.** The id is carried in job payloads. Child jobs inherit it and set `parent_job_id` ⊕. It is persisted on:
  - `jobs`, `job_attempts`, `webhook_events`, `ai_requests`;
  - `briefings` (`correlation_id` of the generating run), `notifications`, `push_tickets`;
  - `approval_actions` / `approval_events`, `audit_logs`, `system_health_checks`.

  It is also a structured-log field in every Edge Function and a Sentry tag (M§126).
- **`admin_api.correlation_trace(p_correlation_id)`** (`jobs.read`) returns ≤500 rows ordered by timestamp:
  `union all` of `(kind, id, ts, status, label_key, link)` from `webhook_events`, `billing_events`, `jobs`, `job_attempts`, `ai_requests` (feature/model/status/latency/cost), `briefings` (kind/status), `notifications` (category/decision), `push_tickets` (receipt), `approval_actions` (type/status) and `audit_logs` (action/result). No content columns.
- **UI.** The "Korelasyon zinciri" timeline appears on `/jobs/[id]` and in the AI request and notification rows. It is a vertical timeline with status badges, relative timings (+1,2 sn) and a link to each module.
- **Drill path** User → Integration → Job → AI/Briefing → Notification:
  1. `/users/[id]/integrations`, account row → "İşleri gör" → `/jobs?f.account=<id>`;
  2. a job row → `/jobs/[id]` (attempts, correlation chain);
  3. an `ai_requests` entry → `/ai?tab=requests&f.correlation=<id>`;
  4. a briefing → `/briefings?f.correlation=<id>`;
  5. a notification → `/notifications?f.correlation=<id>`.
- **External link.** "Sentry'de ara" opens a Sentry search filtered by the `correlation_id` tag (only when Sentry is configured).

---

## 9. Support Access flow (M§49; REQ-BO-SUPP-03)

```
Admin (support.access, SA/SU) on /users/[id] or /support/[id]
  → "Destek erişimi iste…" (L3 + step-up)
      fields: Kapsam (checkboxes) · Süre (15 · 30 · 60 dk; ≤ support_access.max_minutes, never above 60, R-09) ·
              Bağlı destek talebi (required for support role; super_admin may enter "Olay referansı") · Gerekçe
  → POST /support-access/grants → admin_api.support_access_grant
      checks: permission, user exists & not deleted, ticket belongs to user and is not closed, no active grant
      for same admin+user (extend = new grant), duration bound
      insert support_access_grants(admin_user_id, user_id, ticket_id, scope, reason, starts_at=now(),
                                   expires_at=now()+duration)  ; audit support_access.granted
  → Banner on all /users/[id]/* pages for this admin:
      "Destek erişimi aktif · {mm:ss} kaldı · Kapsam: {scope} · [Erişimi sonlandır]"
  → Content panels appear only while active; each open calls
      GET /support-access/grants/:grantId/content/:scope?entity=… → admin_api.support_access_authorize
      (volatile; verifies grant owner = caller, expires_at > now(), revoked_at is null, scope ∈ grant.scope; increments reveal_count;
       returns content; writes audit support_access.content_viewed {scope, entity_type, entity_id})
  → Expiry: server rejects after expires_at (content disappears on next render; client timer hides it at 0);
      system audit support_access.expired written by scheduler_tick sweep
  → Revoke: POST /support-access/grants/:id/revoke → audit support_access.revoked
```

| Scope (`support_access_scope`, master plan R-09) | Returns | Never returns |
|---|---|---|
| `pii` | this user's unmasked identifiers: account email, display name, connected mailbox addresses, ticket contact email (the §5.5 fields, for the grant's duration, each view audited) | tokens, secrets, passwords |
| `email_metadata` | subject, sender display name and address, ≤200-char stored snippet, labels/category, for threads referenced by a selected insight or job | body, attachments, recipients list, any provider fetch of the original mail |
| `insights` | insight title, reason, decision tier, confidence, provenance metadata (source type, provider, timestamp), status history, stored AI summaries (thread summary, key points) and the rendered briefing text (`briefing_items`) of a selected briefing | evidence quotes beyond 300 chars, briefing audio |
| `notifications` | rendered title/body actually sent (per detail mode) | push tokens |
| `captures` | extracted entity fields (type, values, confidence) | the uploaded file, its OCR full text or any signed URL |
| `assistant_transcript` | the messages of a selected assistant thread and the answers with their source references | retrieved memory chunks, audio |
| `ai_feedback` | user comment text | — |

Always excluded, even with Support Access: OAuth tokens, passwords, secrets, raw email bodies (never stored, never fetched from the provider by an admin), attachments and uploaded files, memory chunks, voice audio.

Durations are 15, 30 or 60 minutes (maximum 60). The reason is required. The grant and every content view are logged in `audit_logs` and counted in `support_access_grants.reveal_count` (R-09).

There is no impersonation, no acting as the user, and no provider call on the user's behalf (M§49).

---

## 10. Audit log design (M§66; ADR-05)

- **Table** `audit_logs` (DATABASE_AND_RLS_PLAN §4.9 is authoritative; ⊕ marks the one addition):
  - `id bigint generated always as identity`, `chain_seq bigint` (unique), `occurred_at timestamptz default clock_timestamp()`;
  - `actor_type text` (`admin|user|system|worker`), `actor_id uuid null`, `actor_role text null` (admin role snapshot);
  - `action text` (catalogue), `target_type text`, `target_id text`;
  - `target_user_id uuid null`, deliberately not an FK;
  - `reason text`, `result text` (`success|failure|denied`); a partial outcome is a `failure` row with `details.partial=true` and `details.error_code`;
  - `correlation_id uuid`, `idempotency_key text` ⊕ (unique with `actor_id` where not null), `ip_hash bytea`;
  - `details jsonb` (PII-free: ids, enums, counts, error codes, before/after of configuration);
  - `prev_hash bytea`, `row_hash bytea`.
- **Subjects after deletion.** There is no side table. After an account deletion `target_user_id` links to nothing (the user row is gone and no FK exists). The BO shows such a subject as "Silinmiş kullanıcı · #{prefix}", where the prefix comes from `private.hash_subject(target_user_id)`, the same hash stored in `data_deletion_requests.subject_hash`. This satisfies both "subject identifiers hashed after completion" (plan §13) and immutability.
- **Immutability:**
  - `revoke update, delete, truncate` from every role;
  - `BEFORE UPDATE OR DELETE` and `BEFORE TRUNCATE` triggers raise `audit_immutable`;
  - inserts only through `private.audit_log_append(...)` (DB §6.7), which takes `pg_advisory_xact_lock(hashtext('da_audit_chain'))`, sets `chain_seq` and `prev_hash` from the last row and computes `row_hash = sha256(prev_hash || canonical row)`.
- **Verification.**
  - `health_check` verifies the last 24 h every hour, and the full chain weekly (`audit_chain` probe, §11).
  - `admin_api.audit_verify` is available on demand.
- **Storage.** Partitioned by month. **No retention purge function exists** (M§66).
- **Action catalogue** (`private.audit_action_catalogue` ⊕):

| Area | Actions |
|---|---|
| Admin auth | `admin.bootstrap`, `admin.login`, `admin.login_failed`, `admin.login_denied`, `admin.locked`, `admin.unlocked`, `admin.mfa_enrolled`, `admin.mfa_challenge_failed`, `admin.mfa_recovery_used`, `admin.mfa_factor_added`, `admin.mfa_factor_removed`, `admin.recovery_codes_regenerated`, `admin.logout`, `admin.logout_all`, `admin.session_expired`, `admin.permission_denied`, `admin.rate_limited` |
| Admin mgmt | `admin.invited`, `admin.invite_resent`, `admin.invite_accepted`, `admin.role_changed`, `admin.disabled`, `admin.enabled`, `admin.mfa_reset`, `admin.sessions_revoked` |
| Users | `user.lookup_by_email`, `user.pii_revealed`, `user.force_sync`, `user.disabled`, `user.restored`, `user.marked_internal`, `user.unmarked_internal` |
| Operations | `integration.disconnected`, `integration.watch_renew_requested`, `job.retried`, `job.bulk_retried`, `job.cancelled`, `briefing.regenerated`, `push.test_sent`, `health.run_requested` |
| AI | `ai_model_config.updated`, `ai_model_config.tested`, `ai_routing_profile.changed`, `prompt.draft_created`, `prompt.draft_updated`, `prompt.tested`, `prompt.activated`, `prompt.rolled_back`, `prompt.archived`, `ai_feedback.comment_revealed` |
| Business | `subscription.resync_requested`, `entitlement.granted`, `entitlement.revoked`, `referral.approved`, `referral.rejected` |
| Support/product | `ticket.updated`, `ticket.assigned`, `ticket.note_added`, `ticket.reply_sent`, `ticket.reply_failed`, `support_access.granted`, `support_access.revoked`, `support_access.expired`, `support_access.content_viewed`, `feedback.updated`, `feedback.revealed`, `flag.created`, `flag.updated`, `flag.kill_switch_on`, `flag.kill_switch_off`, `flag.override_added`, `flag.override_removed`, `flag.archived`, `announcement.created`, `announcement.updated`, `announcement.scheduled`, `announcement.cancelled` |
| Privacy/system | `data_request.retried`, `data_request.export_regenerated`, `settings.system_updated`, `plan_limits.updated` |

- **Dashboard "Güvenlik olayları"** = `admin.login_failed` bursts, `admin.locked`, `admin.mfa_recovery_used`, `admin.mfa_reset`, `admin.role_changed`, `admin.disabled`, `admin.permission_denied` (≥5 per admin per hour), `support_access.granted`, and audit-chain failures.

---

## 11. System health probe catalogue (M§67)

**Execution**
- The `health` Edge Function (auth: secret or admin) runs the probes.
- Schedule: `scheduler_tick` enqueues `health_check` every 5 min (idempotency `health:{5-min bucket}`) → `worker` → `health`. On demand via §6.21.
- Each probe has a 10 s timeout and writes `system_health_checks` (DB columns `component, status, latency_ms, detail, checked_by, checked_at`, plus `correlation_id` ⊕; `detail.code` carries the detail code).

**Status** (DB `system_health_checks.status`): `healthy` · `degraded` · `down` · `external_credential_required` · `unknown`. A probe is `unknown` when its last result is more than 10 min old.

| component | Probe | healthy / degraded / down | external_credential_required when |
|---|---|---|---|
| `api` | HLT-01 `GET {API}/functions/v1/health/live` through the public API domain (Edge runtime and gateway liveness; API_CONTRACTS §14) → `{status, version, region}` | <800 ms / <3 s or non-JSON / error or ≥3 s | — |
| `database` | `select 1` and PostgREST `rpc/health_ping` ⊕; connections used vs `max_connections` | <200 ms & <80% / <95% / failure | — |
| `supabase_auth` | Auth `GET /auth/v1/health` | 200 in <2 s / slower than 2 s / fails | — |
| `storage` | upload 1-byte object to private bucket `health` ⊕ → signed URL fetch → delete | all succeed <3 s / slow / any fail | — |
| `google_oauth` | OIDC discovery `accounts.google.com/.well-known/openid-configuration`; 24 h OAuth callback success ratio (`oauth_states` consumed vs errors) | reachable & ≥80% (or <10 attempts) / <80% / unreachable | Google client env missing |
| `microsoft_oauth` | `login.microsoftonline.com/common/v2.0/.well-known/openid-configuration`; certificate `notAfter` | reachable & cert >30 d / cert ≤30 d or ratio <80% / unreachable or cert expired | Entra app/cert env missing |
| `gmail` | `gmail.googleapis.com/$discovery/rest?version=v1` reachable; share of healthy Gmail accounts synced in 30 min; expired watches; Pub/Sub pushes in 60 min when ≥20 watches active | reachable, ≥95%, 0 expired / <95% or expired > 0 or no pushes / unreachable or <50% | Google env or Pub/Sub topic missing |
| `microsoft_graph` | `graph.microsoft.com/v1.0/$metadata` reachable; subscriptions expiring <24 h unrenewed; delta success ratio | reachable, 0 overdue, ≥95% / overdue > 0 or <95% / unreachable or <50% | Entra env missing |
| `push` | Expo `POST /--/api/v2/push/getReceipts {"ids":[]}` with the access token; receipt error ratio 1 h | 200 & <5% / 5–25% / non-200, InvalidCredentials > 0, or >25% | `EXPO_ACCESS_TOKEN` missing |
| `ai_anthropic`, `ai_openai` | `GET /v1/models` (no tokens consumed); provider error rate 15 min from `ai_requests` | 200 & <5% / 5–25% / non-200 or >25% | key missing |
| `ai_voyage` ⊕ | embeds the fixed string "sağlık" with the configured `embedding_query` model (a few tokens) and checks that the vector length is 1024; embedding error rate 15 min from `ai_requests`; whether search runs in the FTS-only degrade | 200, 1024-d & <5% / 5–25% or FTS-only degrade active / non-200, wrong dimension or >25% | `VOYAGE_API_KEY` missing |
| `revenuecat` | read-only v2 endpoint on the configured project (path verified during execution); `billing_events` backlog >10 min; processing errors 1 h | 200 & no backlog / backlog or errors / non-200 | v2 key or webhook secret missing |
| `cron` | `cron.job_run_details`: `da_scheduler_tick` success <3 min; failed runs 15 min; oldest ready job age | fresh & age <2 min / age <10 min or failures / stale or age ≥10 min | — |
| `webhooks` | per source (`google_pubsub`, `google_calendar`, `microsoft_graph`, `revenuecat`): last received, rejected-signature ratio 1 h, processing backlog | rejects <10%, no backlog / otherwise / backlog >30 min | source's secret missing |
| `worker` | latest `job_attempts` finish time and failed-attempt ratio over 15 min; HTTP status of the last `da_worker_poke` calls (`net._http_response`) | a finish <2 min ago while jobs are ready & failures <10% / 2–10 min or 10–25% / >10 min with ready jobs, >25% or poke 401/5xx | — |
| `email_delivery` ⊕ | Postmark `GET /server` with the API key | 200 / slow / fail | `EMAIL_API_KEY` missing |
| `audit_chain` ⊕ | hash chain verify through `private.audit_verify_chain` (last 24 h hourly; full weekly) | healthy / — / down (chain broken) | — |

**Overall header:**
- any `down` → "Kesinti var" (critical);
- else any `degraded` or `unknown` → "Kısmi sorun" (warning);
- else all configured probes `healthy` → "Tüm sistemler çalışıyor" (success).

`external_credential_required` probes are listed separately under "Yapılandırılmamış servisler". When `APP_ENV='production'`, such a required service (everything except `ai_openai` fallback-only and Sentry) makes the overall status at best "Kısmi sorun". The page is never green by default.

---

## 12. admin-api route catalogue

Legend:
- Rate classes: R, S, M, X and A (the auth limits) (§3.9).
- Paths follow API_CONTRACTS §12.3 (R-20). ⊕ marks a BO-only path or an `admin_api` function that is not yet in DB §6.10; each is listed in §16 for API_CONTRACTS §12.3 and DB §6.10.
- SU = step-up required. All M and X routes need `Idempotency-Key`.
- "svc" = service client after the SQL gate. All SQL functions are in schema `admin_api` unless marked `private`.

| Method & path | Permission | SQL function | Extra | Rate |
|---|---|---|---|---|
| POST /auth/preflight | BFF only | `login_preflight` (service role) | — | A |
| POST /auth/attempt | BFF only | `login_attempt_record` (service role) | — | A |
| POST /auth/invite/redeem | BFF only | `invite_redeem` (service role) | the BO then starts the email-code sign-in (§3.5) | A |
| GET /auth/status | aal1 JWT | `auth_status` | — | A |
| POST /auth/recovery-code/redeem | aal1 JWT | `recovery_code_consume` | svc `mfa.deleteFactor` ×n, email | X |
| POST /session/start · /session/heartbeat · /session/step-up · /session/logout ⊕ · /session/logout-all | own | `admin_session_start` · `admin_me(true)` · `admin_session_step_up` ⊕ · `admin_session_end` · `admin_session_end` (scope `all` or `others`) | — | M |
| GET /me ⊕ · /me/sessions ⊕ | own | `admin_me` · `sessions_list_own` ⊕ | — | R |
| GET /preferences · PATCH /preferences | own | `admin_preferences_get` · `admin_preferences_set` | — | R · M |
| POST /me/recovery-codes (SU) | own | `recovery_codes_store` | — | X |
| GET /dashboard/metrics · /dashboard/charts | dashboard.read | `dashboard_metrics` · `dashboard_series` | — | R |
| GET /metrics/ops · /metrics/product | metrics.ops.read · metrics.product.read | `metrics_ops` · `metrics_product` | — | R |
| GET /security-events | admins.manage | `security_events` | — | R |
| GET /users · /users/:id | users.read | `users_list` · `user_overview` | — | R |
| GET /users/:id/{integrations,briefings,usage,subscription,referrals,support,audit,devices} | users.read + module read | `user_integrations`, `user_briefings`, `user_usage`, `user_subscription`, `user_referrals`, `user_support`, `user_audit`, `user_devices` ⊕ (the `/devices` path is ⊕) | — | R |
| POST /users/lookup | users.read | `command_search` (user results only) | — | S |
| POST /users/:id/reveal | users.pii.reveal | `user_reveal_email` (`p_field` ⊕) | — | X |
| POST /users/:id/force-sync | users.force_sync | `user_force_sync` | poke worker | M |
| POST /users/:id/disable · /restore (SU) | users.disable | `user_disable` · `user_restore` | svc ban/unban | X |
| POST /users/:id/internal | users.mark_internal | `user_mark_internal` | — | M |
| POST /notifications/test-push | push.test | `notification_send_test` | poke worker; never bypasses quiet hours | X |
| POST /users/:id/entitlement-grants | entitlements.grant(_limited) | `entitlement_grant` | — | X |
| POST /subscriptions/:userId/sync | subscriptions.resync | `subscription_resync` ⊕ | poke worker | M |
| GET /integrations · /integrations/summary ⊕ | integrations.read (summary: or metrics.ops.read) | `integrations_overview` · `integrations_summary` ⊕ | — | R |
| POST /users/:id/integrations/:accountId/disconnect (SU) | integrations.disconnect | `authorize` → `audit_write` | svc shared disconnect service | X |
| POST /integrations/:accountId/renew-watch | integrations.renew_watch | `integration_renew_watch` ⊕ | poke worker | M |
| GET /jobs · /jobs/stats · /jobs/:id · /correlation/:id | jobs.read (stats: or metrics.ops.read) | `jobs_list` · `jobs_summary` ⊕ · `job_detail` · `correlation_trace` ⊕ | — | R |
| POST /jobs/:id/retry · /jobs/:id/cancel | jobs.retry · jobs.cancel | `job_retry` · `job_cancel` | poke worker | M |
| POST /jobs/retry-bulk | jobs.retry | `job_retry_bulk` | poke worker | X |
| GET /briefings · /briefings/metrics | briefings.read (metrics: or metrics.ops.read) | `briefings_list` · `briefings_metrics` | — | R |
| POST /briefings/:id/regenerate | briefings.regenerate | `briefing_regenerate` | poke worker | M |
| GET /notifications · /notifications/metrics | notifications.read (metrics: or metrics.ops.read) | `notifications_list` ⊕ · `notifications_metrics` | — | R |
| GET /ai/metrics · /ai/metrics/series ⊕ | ai.read or metrics.ai.read | `ai_metrics` · `ai_cost_series` | — | R |
| GET /ai/requests · /ai/models | ai.read | `ai_requests_list` ⊕ · `ai_model_config_list` | env presence map | R |
| PATCH /ai/models/:profile/:feature · POST /ai/models/:profile/:feature/test · PATCH /ai/routing-profile ⊕ | ai.models.write | `ai_model_config_update` · `authorize`+`audit_write` · `ai_routing_profile_set` ⊕ | fixture probe via `_shared/ai` (embedding rows: 1024-d check) | X |
| GET /ai/prompts · /ai/prompts/:key · …/versions/:v | prompts.read | `prompts_list` · `prompt_versions_list`+`prompt_telemetry` ⊕ · `prompt_version_get` ⊕ | — | R |
| POST /ai/prompts/:key/versions · PATCH …/versions/:v | prompts.write | `prompt_create_draft` · `prompt_update_draft` | — | M |
| POST …/versions/:v/test | prompts.write | `authorize`+`audit_write` | fixture golden set | X |
| POST …/versions/:v/activate · /ai/prompts/:key/rollback | prompts.activate | `prompt_activate` · `prompt_rollback` | — | X |
| POST …/versions/:v/archive | prompts.activate | `prompt_archive` | — | M |
| GET /ai/feedback/aggregates · /ai/feedback | ai_feedback.read (aggregates: or metrics.ai.read) | `ai_feedback_aggregate` · `ai_feedback_list` | — | R |
| POST /ai/feedback/:id/reveal | ai_feedback.reveal | `ai_feedback_reveal` | — | X |
| GET /subscriptions/metrics · /subscriptions · /subscriptions/trial-stream ⊕ · /entitlement-grants ⊕ | subscriptions.read (revenue fields: metrics.revenue.read) | `subscriptions_metrics` · `subscriptions_list` · `trial_stream` ⊕ · `entitlement_grants_list` ⊕ | — | R |
| GET /subscriptions/events · /subscriptions/events/:id ⊕ | billing_events.read | `billing_events_list` · `billing_event_get` ⊕ | — | R |
| POST /users/:id/entitlement-grants/:grantId/revoke | entitlements.revoke | `entitlement_revoke` | — | X |
| GET /referrals/metrics · /referrals | referrals.read (metrics: or metrics.product.read) | `referrals_metrics` · `referrals_list` | — | R |
| POST /referrals/:id/approve · /referrals/:id/reject | referrals.review | `referral_review` | poke worker | X |
| GET /support/tickets · /support/tickets/:id | support.read | `tickets_list` · `ticket_detail` | — | R |
| PATCH /support/tickets/:id · POST …/notes · POST …/reply | support.write | `ticket_update` · `ticket_add_note` · `ticket_add_note` (kind `outbound_reply`) | reply: `transactional_email` job | M |
| POST /support-access/grants (SU) · POST /support-access/grants/:id/revoke | support.access | `support_access_grant` · `support_access_revoke` | — | X · M |
| GET /support-access/grants/:id/content/:scope | support.access + active grant | `support_access_authorize` | — | X |
| GET /feedback · /feedback/summary ⊕ | feedback.read | `feedback_list` · `feedback_summary` ⊕ | — | R |
| PATCH /feedback/:id · POST /feedback/:id/reveal | feedback.write · users.pii.reveal | `feedback_update` · `feedback_reveal` | — | M · X |
| GET /flags · /flags/:key ⊕ · /flags/:key/evaluate ⊕ | flags.read | `flags_list` · `flag_get` ⊕ · `flag_evaluate_preview` ⊕ | — | R |
| POST /flags · PATCH /flags/:key · POST …/kill · …/archive ⊕ | flags.write or flags.write_ai | `flag_upsert` · `flag_upsert` · `flag_kill` · `flag_archive` ⊕ | — | X |
| POST /flags/:key/overrides · DELETE /flags/:key/overrides/:userId | flags.write or flags.write_ai | `flag_override_set` · `flag_override_delete` | — | M |
| GET /announcements · /announcements/:id · POST /announcements/audience-estimate | announcements.read | `announcements_list` · `announcement_get` · `announcement_audience_estimate` | — | R |
| POST /announcements · PATCH /announcements/:id | announcements.write | `announcement_upsert` | — | M |
| POST …/schedule · …/cancel | announcements.write | `announcement_publish` · `announcement_cancel` | — | X |
| GET /data-requests · /data-requests/:kind/:id | data_requests.read | `data_requests_list` · `data_request_get` | — | R |
| POST /data-requests/:kind/:id/retry · /data-requests/export/:id/regenerate | data_requests.manage | `data_request_retry` · `export_regenerate` | poke worker | X |
| GET /audit · /audit/:id ⊕ · /audit/verify-chain | audit.read | `audit_list` · `audit_get` ⊕ · `audit_verify` | — | R |
| GET /health/summary · /health/history ⊕ · /health/app-versions · /health/cron | health.read | `health_latest` · `health_history` · `app_versions_breakdown` · `cron_status` ⊕ | Sentry adapter (app versions) | R |
| POST /health/run | health.run | `authorize`+`audit_write` | invoke `health` | X |
| GET /admins | admins.read | `admins_list` | — | R |
| POST /admins/invite · /admins/:id/resend-invite ⊕ (SU) | admins.manage | `admin_invite_record` · `admin_invite_rotate` ⊕ | svc createUser (+ delete on rollback), `transactional_email` job | X |
| PATCH /admins/:id · POST …/disable · …/enable · …/reset-mfa ⊕ · …/revoke-sessions · …/unlock ⊕ (SU) | admins.manage | `admin_update_role` · `admin_disable` · `admin_enable` · `admin_mfa_reset` ⊕ · `admin_sessions_revoke_all` · `admin_unlock` ⊕ | svc ban/unban, `mfa.deleteFactor` | X |
| GET /settings | any admin | `settings_get` ⊕ (+ `plan_limits_list`) | — | R |
| PATCH /settings/config/:key · PATCH /settings/plan-limits (SU) | settings.system.write | `settings_update` ⊕ · `plan_limits_update` | — | X |
| GET /search | search.global | `command_search` | — | S |
| (internal) denial logging | — | `audit_denied` | — | — |

---

## 13. Testing (M§101, M§103; plan §17)

### 13.1 Unit (vitest 4.1.11): `apps/backoffice`, `packages/domain`, `packages/validation`

- **RBAC:** `ROLE_PERMISSIONS` snapshot; TypeScript ↔ SQL seed parity; every §12 route has a declared permission; sidebar visibility per role.
- **`adminAction` wrapper:**
  - rejects a missing or foreign Origin and `Sec-Fetch-Site: cross-site`;
  - zod errors map to field errors;
  - error-code → copy mapping;
  - the Idempotency-Key is passed through.
- **proxy.ts:** redirects (no session, aal1, no admin claim), CSP nonce present, non-GET Origin enforcement, cookie sealing round-trip (a tampered or foreign cookie counts as no session).
- **UI logic:**
  - masking helpers and the feedback auto-mask regex;
  - `MaskedValue` re-mask after 60 s (fake timers);
  - `SessionWatcher` warning at T−2 min, background polls not extending the session;
  - DataTable URL-state serialisation round-trip;
  - column visibility persistence;
  - state components (empty / filtered-empty / error with correlation id / forbidden).
- **Metrics:** window/bucket helper incl. DST boundaries; `hist_percentile` TS mirror; number, currency and duration formatters (tr/en).
- **Domain:** flag evaluator + percentage parity vectors; semver compare; job retry policy table; prompt lint; announcement deeplink allow-list; palette pattern router.
- **Charts:** data transforms; `ChartTableFallback` content.

### 13.2 Edge (deno test): `supabase/functions/admin-api`, `health`

- **Middleware:** BFF key (missing/wrong → 401); browser Origin → 403; JWT invalid / aal1 / non-allow-listed route; ctx errors mapping; rate-limit 429 with Retry-After; step-up required; idempotent replay returns `replayed:true`; `Cache-Control: no-store`.
- **Contracts:** request and response zod for every route; responses contain no forbidden keys (a deny-list scan for `token`, `secret`, `password`, `body_html`, `ciphertext`, `subscriber_attributes`).
- **Service flows:**
  - invite rollback when `admin_invite_record` fails, and 424 before any change when email credentials are missing;
  - disable → ban failure → 207 partial + audit `partial`;
  - disconnect reuses the shared service; Microsoft → `revoke='unsupported'` partial metadata;
  - recovery redeem deletes factors;
  - support reply email failure → note `failed`.
- **Other:** `public-api /support/inbound-email` parser; `health` probe classification with mocked fetch and `external_credential_required`; Sentry adapter absent → `external_credential_required`.

### 13.3 Database (pgTAP; tier A in CI, tier C shim in-container)

- **Every `admin_api` function:**
  - denied for anon, for an `authenticated` non-admin, for aal1 admins, for a missing gateway header, for disabled/locked admins, and for ended/idle/absolute-expired sessions;
  - role matrix allow/deny for each permission.
- **Guards:** last-super-admin trigger; admin DELETE refused; self-protection.
- **Audit:** immutability (UPDATE/DELETE/TRUNCATE refused); hash-chain continuity and tamper detection; `target_user_id` stays on the row after an account deletion and joins to no user.
- **Masking:** masking outputs; `users_list` has no unmasked email column.
- **Filters and pagination:** each §6.2 filter predicate; keyset pagination stability.
- **Guards per mutation:** job retry/cancel state guards and idempotency; briefing regenerate guard; grant_limited constraints and stacking; `effective_entitlement` after a grant or revoke; referral review idempotent credits; flag evaluation SQL vs vectors; prompt single-active + atomic activation/rollback; announcement schedule/cancel; data request retry only from failed; support access expiry, the 15/30/60-minute bound (R-09) and scope enforcement + `content_viewed` audit per call; a test push inside quiet hours is stored as `scheduled` and never sent at once (R-13); `ai_model_config_update` refuses non-1024-d embedding models and `claude-fable-*` IDs; `ai_routing_profile_set` writes `plan_limits` and audit.
- **Metrics:** `rollup_metrics_daily` idempotence and equality with raw for complete days; metric definitions (§7) against the seeded fixture with hand-computed expected values.

### 13.4 Playwright E2E inventory (M§103)

- **Projects:**
  - `bo-contract`: the BO against a contract-validated mock admin-api (Hono on Node, `e2e/mock-admin-api.ts`, responses validated by the same zod contracts). Runs in-container.
  - `bo-full`: local Supabase stack (`supabase start`, `functions serve admin-api health worker`, `DEMO_MODE=true`, fixture AI provider). Runs in CI.
- **Seed.** `supabase/seed/e2e_backoffice.sql` (refuses to run unless `E2E_SEED=true` and not production):
  - 7 admin identities, one per role;
  - 50 synthetic users with PRIMARY demo names (Ahmet Yılmaz, Mehmet Yılmaz, Selin Kaya…) and dates relative to now;
  - accounts in every `account_status`; jobs in every `job_status` incl. dead letters with correlation chains;
  - briefings and notifications across every status/decision; 90 days of `ai_requests` + rollups;
  - billing events (trial, conversion, refund, expiration); flagged referrals; tickets; feedback; flags; announcements; failed deletion requests; audit rows.
- **Global setup.** `globalSetup` signs each admin in with the email code read from Inbucket, enrolls TOTP through the API (`mfa.enroll` + `challengeAndVerify` with `otpauth`) and stores a `storageState` per role.
- **Email sink.** Local Inbucket (Auth mail) plus the mock Postmark endpoint (invites, replies).
- **Browser.** Chromium CfT 153 (or `/opt/pw-browsers` 141 in-container, per the stack audit).

| ID | Spec (`apps/backoffice/e2e/`) | Role | Tier | Flow and assertions |
|---|---|---|---|---|
| BO-E2E-01 | `auth.login-mfa.spec.ts` | operations | full | email code (Inbucket) → TOTP → dashboard; an unknown email gets the same response and no email; cookie `__Host-da_admin` httpOnly/Secure/Strict and sealed; audit `admin.login` (**M§103 admin login**) |
| BO-E2E-02 | `auth.lockout.spec.ts` | — | full | 5 wrong codes → lock copy; the code request for an unknown email returns the same copy; unlock by super_admin |
| BO-E2E-03 | `auth.invite-enrol.spec.ts` | super_admin → new | full | invite (SU) → email link → [Daveti kabul et] → sign-in code (Inbucket) → enrol → recovery codes gate → dashboard; audit chain |
| BO-E2E-04 | `auth.recovery-code.spec.ts` | ai_ops | full | recovery code → factors removed → re-enrol → security event visible to super_admin |
| BO-E2E-05 | `auth.session-idle.spec.ts` | support | full | `page.clock` 28 min → warning dialog; DB helper sets `last_activity_at` −31 min → next nav `/login?reason=idle`; absolute 12 h variant |
| BO-E2E-06 | `auth.logout.spec.ts` | operations | full | logout → cookie cleared; logout-all from context A → context B redirected `reason=revoked` (**M§103 logout**) |
| BO-E2E-07 | `security.csrf.spec.ts` | operations | contract+full | server-action POST without Origin / foreign Origin → 403, no state change, no audit success row |
| BO-E2E-08 | `rbac.matrix.spec.ts` | all 7 | contract+full | sidebar matches §5.2/§4.2; forbidden URL → "Bu bölümü görüntüleme yetkin yok."; crafted action call → forbidden + `admin.permission_denied` |
| BO-E2E-09 | `dashboard.spec.ts` | analyst, operations | full | 11 KPIs and 5 charts for 24h/7d/30d/90d equal seeded expectations; table fallback; per-card retry (**M§103 dashboard**) |
| BO-E2E-10 | `users.search.spec.ts` | support | full | palette exact email → masked result + audit lookup; filters Free/Pro/Deneme/Pasif/Senkron hatası/Bağlantı hatası; sort; page size; column visibility persists (**M§103 user search**) |
| BO-E2E-11 | `users.detail.spec.ts` | support | full | 8 tabs render; M§49 fields; reveal email with reason → visible 60 s → re-masked; audit `user.pii_revealed` (**M§103 user detail**) |
| BO-E2E-12 | `users.actions.spec.ts` | operations | full | force sync → jobs queued; disable (typed + SU) → status Devre dışı, audit; restore |
| BO-E2E-13 | `integrations.spec.ts` | operations | full | filter by M§52 statuses; no token fields in the DOM or network; renew watch; disconnect L3 (**M§103 integration view**) |
| BO-E2E-14 | `jobs.retry.spec.ts` | operations | full | dead_letter → retry → queued → worker completes → attempts timeline; bulk retry summary; cancel; readonly has no buttons (**M§103 sync job retry**) |
| BO-E2E-15 | `correlation.spec.ts` | operations | full | job detail chain webhook → sync → email_analysis → ai_request → briefing → notification; links navigate |
| BO-E2E-16 | `briefings.spec.ts` | operations | full | per-kind metrics; regenerate today's failed briefing → job queued + audit; old briefing → button disabled (**M§103 briefing operation**) |
| BO-E2E-17 | `notifications.spec.ts` | operations, support | full | suppression breakdown; push test → `is_test` row with body "Test bildirimi" + audit; inside the user's quiet hours the dialog says it is delivered at the quiet-hours end and the row is `scheduled`; support sees no push-test action |
| BO-E2E-18 | `ai.costs.spec.ts` | ai_ops | full | cost KPIs, daily/feature/model charts, p50/p95 match fixture; model page configured/not configured (incl. Voyage); update model → audit; switch the Free/Pro routing profile → audit; a non-1024-d embedding model is refused (**M§103 AI cost**) |
| BO-E2E-19 | `prompts.spec.ts` | ai_ops | full | draft → edit → diff → activate → rollback; single active; audit (**M§103 prompt activation**) |
| BO-E2E-20 | `ai-feedback.spec.ts` | ai_ops | full | aggregates by feature/model/version; comment hidden → reveal audited |
| BO-E2E-21 | `subscriptions.spec.ts` | finance, operations | full | store vs grant panels; MRR/ARR visible to finance, absent for operations; events list sanitised |
| BO-E2E-22 | `entitlements.spec.ts` | finance, support | full | 7-day grant → "Etkin yetki: Pro · Yönetici"; stacking; support sees only 1/7 days; revoke L3 (**M§103 entitlement grant**) |
| BO-E2E-23 | `referrals.spec.ts` | finance | full | flagged approve → rewarded once; reject with reason |
| BO-E2E-24 | `support.spec.ts` | support | full | ticket status/assign/note/reply (mock email); support access grant (SU) → content panel → audit `content_viewed` → revoke → hidden (**M§103 support**) |
| BO-E2E-25 | `feedback.spec.ts` | operations | full | triage; auto-masked text; reveal requires support role |
| BO-E2E-26 | `flags.spec.ts` | operations, ai_ops | full | create; targeting percentage/platform/plan/version; evaluate preview; kill switch typed; ai_ops limited to `ai.*`/`voice.*` keys (**M§103 feature flag**) |
| BO-E2E-27 | `announcements.spec.ts` | operations | full | draft → preview tr/en light/dark → schedule → cancel |
| BO-E2E-28 | `data-requests.spec.ts` | support | full | 3 tabs; failed account deletion retry resumes from the step; export regenerate; no URL exposed (**M§103 data request**) |
| BO-E2E-29 | `audit.spec.ts` | readonly | full | filters; no edit/delete controls; verify OK; tamper fixture → broken banner (**M§103 audit**) |
| BO-E2E-30 | `health.spec.ts` | operations | full | probe list with real statuses; missing credential → "Yapılandırılmadı — Harici kimlik bilgisi gerekli"; run now; versions tab |
| BO-E2E-31 | `admins.spec.ts` | super_admin | full | role change, disable/enable, reset MFA; demoting the last super_admin → blocked copy |
| BO-E2E-32 | `settings-theme.spec.ts` | any | contract+full | dark toggle persists across reload and a new context (server preference); charts/tables themed; locale en |
| BO-E2E-33 | `palette.spec.ts` | support | contract+full | ⌘K/Ctrl+K; all 7 id types; destructive command opens a dialog, never executes |
| BO-E2E-34 | `a11y.spec.ts` | super_admin | contract | `@axe-core/playwright` on every route, light and dark; keyboard-only table and dialog operation |
| BO-E2E-35 | `states.spec.ts` | operations | contract | skeleton, empty, filtered-empty, error with correlation id + retry, forbidden, stale-rollup banner |

---

## 14. Implementation order and Definition of Done

### 14.1 Order within execution step 10

This is dependency order, not phasing; everything ships.

1. Migrations for the BO registry items (§16).
2. `private.require_admin`, gateway assertion, `admin_role_permissions` seed, `audit_log_append` + chain, `admin_users` guard, custom access token hook.
3. pgTAP for those.
4. admin-api skeleton: middleware, envelope, contracts, `/auth/*`, `/session/*`, `/me`.
5. BO scaffold:
   - `proxy.ts`, auth screens, `SessionWatcher`, theme/i18n shell, sidebar, palette shell;
   - DataTable, ConfirmDialog, MaskedValue, charts kit, state components.
6. Modules in §6 order, each with its SQL functions, pgTAP, route and E2E spec.
7. Rollups and metric definitions (§7) with fixture-verified values.
8. `health` probes (§11).
9. RBAC matrix E2E, a11y pass, bundle secret scan, `next build`.

### 14.2 Definition of Done (M§136 checklist; plan §22)

The BO is done when every item below is real and has passing tests:

- **Access and platform:** Admin auth (email code + TOTP + recovery + invite), RBAC (two enforcement layers), Global Search, Command Palette, Dark Mode (persisted), Privacy controls (masking/reveal/Support Access), Server pagination on all large tables.
- **Modules:** Dashboard, Users, User detail (8 tabs), Integrations, Sync & Jobs, Briefings, Notifications, AI Operations, AI Costs, Model config, Prompt Management, AI Feedback, Subscriptions, Entitlements, Referrals, Support, Feedback, Feature Flags, Announcements, Data Requests, Audit Logs, System Health, App versions, Admin Users, Settings.

For each item:
- every visible control performs its real action (M§99);
- no placeholder strings;
- tr + en complete;
- axe clean;
- audit rows are verified for every mutation;
- the quality-gate greps are clean;
- it appears as ✅ in `FINAL_IMPLEMENTATION_REPORT.md`, with its external-credential dependencies listed.

---

## 15. External credentials and manual steps (M§90, M§149)

| Item | Type | Needed for | Behaviour when missing |
|---|---|---|---|
| `admin.<domain>` DNS + Vercel project + domain verification | Manual external step | production BO | preview URL only |
| Supabase Auth: email OTP over the custom SMTP (shared with the app), MFA TOTP on, custom access token hook registration | Manual external step | admin login | local `config.toml` covers development |
| Postmark server token, verified sender domain (SPF/DKIM/DMARC), inbound stream + webhook URL with basic auth, Apple private-relay domain registration | External credential required + Manual external step | invites, support replies/inbound, security alerts | features show "Harici kimlik bilgisi gerekli"; `email_delivery` probe `external_credential_required`; first super_admin via bootstrap link |
| `SENTRY_AUTH_TOKEN` (org:read, project:read), `SENTRY_ORG`, `SENTRY_PROJECT` | External credential required | crash correlation §6.22 | columns "—" + copy |
| RevenueCat v2 secret key, webhook secret | External credential required | subscription data, resync, probe | overview banner, probe `external_credential_required` |
| Expo access token | External credential required | push test, push probe | push test fails honestly with `external_credential_required` |
| Anthropic / OpenAI / Voyage keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `VOYAGE_API_KEY`) | External credential required | model probes, AI features, embeddings and memory search (FTS-only degrade without Voyage) | provider rows "Yapılandırılmadı" |
| First super_admin bootstrap | Manual external step (§3.11) | initial access | — |
| Vercel Firewall allow-list (fixed egress IPs) | Manual external step | network hardening | — |

---

## 16. Proposed additions to the canonical registry

| # | Item | Kind | Justification |
|---|---|---|---|
| 1 | `admin_status` enum `invited \| active \| disabled` | enum | `admin_users.status` values are needed for the invite flow and disable/re-enable (M§68) |
| 2 | `admin_users` columns `invite_token_hash, invite_expires_at, invite_redeemed_at, locked_until` (the other columns used here already exist in DB §4.9) | columns | invite, lockout (M§68, M§48) |
| 3 | `admin_sessions.step_up_at`; `end_reason` values `logout_others`, `revoked_by_admin`, `mfa_reset`, `recovery_used` added to the DB check | columns | step-up and the extra end reasons (ADR-06) |
| 4 | `admin_preferences` columns `theme, locale, timezone, density, table_prefs, dashboard_range, recent_items, sidebar_collapsed` | columns | M§72 persistence, M§70 column visibility |
| 5 | `admin_mfa_recovery_codes` table | table | MFA recovery process (§3.4) |
| 6 | `private.admin_role_permissions` table + permission catalogue (§4.1) | table/seed | SQL-layer RBAC (M§47) |
| 7 | `raw_app_meta_data.da_kind='admin'`; `handle_new_user` skip; `api`/`public-api` reject admin identities with `admin_identity` | auth convention | keeps admin identities apart from app users (M§88) |
| 8 | `x-da-admin-gateway` header + `private.admin_gateway_keys(sha256 bytea primary key, created_at, retired_at)` (RLS on, no policies; written by the deploy job) + `private.assert_admin_gateway()` | security control/table | stops direct PostgREST calls to `admin_api`; Vault keeps only the two ADR-04 secrets |
| 9 | admin-api `verify_jwt=false` with in-code `getClaims`; BFF-key-only routes `/auth/preflight`, `/auth/attempt`, `/auth/invite/redeem` | function config | pre-login lockout and invite flows need unauthenticated but BO-only calls |
| 10 | Edge/BO secrets `ADMIN_BFF_SECRET, ADMIN_GATEWAY_SECRET, ADMIN_ORIGIN, RECOVERY_CODE_PEPPER, PII_LOOKUP_PEPPER, EMAIL_INBOUND_BASIC_AUTH, ADMIN_ALLOWED_EMAIL_DOMAINS`. INTEGRATION_PLAN §15 names used as they are: `ADMIN_SESSION_SECRET`, `API_PUBLIC_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_REPLY_TO`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `VOYAGE_API_KEY` | env | §2.7; add to `.env.example` and the credentials matrix |
| 11 | `EmailProvider` adapter (Postmark implementation) for Edge Functions | adapter | Edge Functions block SMTP ports; support replies, invites and alerts need HTTPS email |
| 12 | `audit_logs.idempotency_key` (unique with `actor_id` where not null) on top of the DB §4.9 columns; `private.audit_action_catalogue`; `admin_api.authorize`, `admin_api.audit_write`, `admin_api.audit_denied` (all append through `private.audit_log_append`) | column/table/fns | admin-api replay safety and the M§66 action catalogue; no side table (subjects stay in `target_user_id`) |
| 13 | `support_access_scope` enum exactly R-09: `pii \| email_metadata \| insights \| notifications \| captures \| assistant_transcript \| ai_feedback`, typing `support_access_grants.scope` (array); duration check 15/30/60 min (maximum 60); `revoked_by` | enum/check/column | M§49 flow (§9), R-09 |
| 14 | `support_tickets` columns `os_version, locale, diagnostics` (the ticket id is the DB `public_ref` `DA-YYYY-######`); `support_notes.kind` `internal \| outbound_reply \| inbound_reply \| system` + `delivery_status, provider_message_id`; `private.ticket_reply_delivery` | columns/enum/fn | M§62 reply channel and inbound replies |
| 15 | `public-api POST /support/inbound-email` | route | inbound support replies (`waiting_user → open`) |
| 16 | No addition: feedback uses DB §4.7 `user_feedback.status` (`new \| triaged \| planned \| closed`, text check) and its `assigned_admin_id`, `rating`, `platform`, `app_version`, `diagnostics_consent` columns | — | M§62 status and assignment for feedback |
| 17 | `referrals` columns `risk_score, risk_signals, reviewed_by_admin_id, reviewed_at, review_reason`; DB `referral_status` stays `pending \| qualified \| rewarded \| rejected \| flagged` | columns | plan §16 manual review |
| 18 | `data_export_requests.steps jsonb` (deletions already have DB `steps`); statuses stay DB `export_status` / `deletion_status` | column | M§65 step-resuming retry |
| 19 | `announcements` columns `cta_label_tr, cta_label_en, dismissible, cancelled_by, cancel_reason` on top of DB §4.7; the status is derived from `published_at` / `cancelled_at` / `starts_at` / `ends_at` (no status enum); mobile Today announcement card fed by `/me/bootstrap` (R-25) | columns/cross-doc | M§64 fields, bilingual (ADR-14) |
| 20 | `feature_flags` columns `targeting jsonb, default_value, archived_at` (DB already has `enabled` and `is_kill_switch`); `feature_flag_overrides` as DB §4.7; seeded keys exactly R-10 (§6.17); `flags.write_ai` scoped by the key prefixes `ai.` / `voice.` (no category column); evaluation in `private.evaluate_flags` | columns/seed | M§63 targeting and kill switch |
| 21 | `system_health_checks.correlation_id`; `component` values `email_delivery`, `audit_chain`, `ai_voyage` added to the DB check (statuses stay `healthy \| degraded \| down \| external_credential_required \| unknown`); private storage bucket `health`; `public.health_ping()` (anon-executable, returns now()) | column/values/bucket/fn | M§67 real probes |
| 22 | `metrics_daily`, `ai_metrics_daily` tables; `private.rollup_metrics_daily` (a `private.scheduler_tick` step every 15 min and at 03:30 reporting time; no extra cron job), `private.metric_window`, `private.latency_bounds`, `private.hist_percentile` | tables/fns | 30d/90d metrics survive per-user retention and deletion (M§119, M§50) |
| 23 | `ai_feature` = the AI_PIPELINE_PLAN list plus `admin_probe`: `email_triage \| thread_summary \| email_deep_extract \| commitment_extract \| life_intel_extract \| briefing_morning \| briefing_midday \| briefing_evening \| weekly_review \| meeting_prep \| post_meeting_parse \| capture_extract \| assistant_intent \| assistant_qa \| reply_draft \| follow_up_draft \| embedding_doc \| embedding_query \| stt \| tts \| admin_probe`; `ai_requests.status` text check `ok \| error \| refused \| timeout \| budget_blocked \| killed \| cached \| validation_failed \| grounding_partial \| grounding_failed` (rate limits are `error` with `error_code='RATE_LIMITED'`); `ai_requests` columns used here: `feature, profile, plan, job_id, cache_read_tokens, cache_write_tokens` | enum/columns | M§56 feature breakdown and error rate |
| 24 | `ai_model_config` = AI_PIPELINE_PLAN §3.6 (`profile, feature, tier, enabled, primary_target, fallback_targets, escalation_target, batch_policy, cache_ttl, max_input_tokens, eval_status, retires_not_before, version, updated_by`) plus `role` (`classifier \| reasoning \| embedding \| stt \| tts`), unique `(profile, role, feature)` (R-18); enum `routing_profile` (`balanced \| lean`); `plan_limits` key `ai_routing_profile` (R-02, R-22); check rejecting `claude-fable-*`; embedding rows limited to 1024-d models (R-01); `PATCH /ai/routing-profile` + `admin_api.ai_routing_profile_set` | columns/enum/route/fn | M§57 concepts, per-feature routing and the per-plan profile switch |
| 25 | `prompt_versions` columns `system_text, user_template, variables, output_schema_id, notes, created_by_admin_id, activated_at, activated_by, archived_at, rolled_back_from` | columns | M§58 diff, activate, rollback |
| 26 | `ai_feedback` columns `feature, model, prompt_version_id, ai_request_id, rating, reason_code, comment` | columns | M§59 aggregates (SREQ-83) |
| 27 | `subscriptions` columns `entitlement, store, product_id, period_type, period_months, is_active, will_renew, expires_at, purchased_at, billing_issue_detected_at, unsubscribe_detected_at, refunded_at, environment, original_transaction_id, price_usd_micros, price_local_micros, currency, last_event_id, synced_at`; `billing_events` typed columns `type, user_id, store, environment, product_id, period_type, purchased_at, expiration_at, event_at, price_usd_micros, price_local_micros, currency, cancel_reason, expiration_reason, is_trial_conversion, transaction_id, original_transaction_id, received_at, processed_at, processing_error_code, job_id` | columns | M§60 metrics (MRR/ARR, refunds, trials) |
| 28 | `profiles` columns `is_internal, disabled_at, disabled_by_admin_id, last_active_at`; `api` 403 `ACCOUNT_DISABLED` (API_CONTRACTS §3) + mobile copy "Hesabın geçici olarak devre dışı bırakıldı. Destek ile iletişime geç." | columns/cross-doc | M§51 Disable/Restore; metric exclusion; users sort |
| 29 | `connected_accounts` columns `capabilities_granted, account_email, last_error_code, last_error_at, last_sync_at`; `sync_states` columns `resource, last_success_at, last_error_at, last_error_code, consecutive_failures, watch_expires_at, watch_status` | columns | M§52 statuses and M§51 filters |
| 30 | `jobs` columns `parent_job_id, manual_retry_count, created_by, created_by_admin_id, last_error_message (scrubbed)`; `job_attempts` columns `worker_id, outcome, error_code, error_message, duration_ms, correlation_id`; `private.job_admin_policy(job_type)` | columns/fn | M§53 safe retry, M§118 chains |
| 31 | `notifications` columns `decision, suppression_reason, detail_mode, rendered_title, rendered_body, is_test, scheduled_for, sent_at, correlation_id`; suppression reason set (§6.8); `push_tickets` columns `receipt_status, receipt_error` | columns | M§55, M§132 metrics; Support Access scope `notifications` |
| 32 | `briefings` columns `scheduled_for, generation_started_at, generated_at, delivered_at, skip_reason, error_code, prompt_version_id, correlation_id, timezone` | columns | M§54 latency and skip metrics |
| 33 | `analytics_events.effective_at` (generated), `source (client \| server)`; required event names (§7.7) | columns/events | M§50/§119 active-user and feature metrics |
| 34 | `app_settings` table (`key, value jsonb, updated_by, updated_at`) with keys in §6.24 | table | system settings (session policy, metrics, referral config) |
| 35 | Backoffice routes `/` (redirect), `/invite`, `/forbidden`, `/api/admin/[...path]` (GET read proxy), `/api/healthz` | routes | an invite flow resistant to email-link prefetchers, client polling, liveness |
| 36 | Icon codegen `dom` target output consumed by `apps/web` and `apps/backoffice` | build | `packages/ui` is React Native only |
| 37 | Dev dependency `@axe-core/playwright` for BO/web E2E | dependency | M§92 accessibility gate |
| 38 | Retention for system tables: `jobs` completed 14 d / failed & dead_letter 90 d, `job_attempts` with the parent job, `ai_requests` 180 d, `webhook_events` 30 d, `system_health_checks` 30 d, `admin_sessions` 180 d, `analytics_events` 400 d, `billing_events` 25 months, `audit_logs` never purged | retention policy | makes rollup sources explicit; M§66 no audit deletion |
| 39 | `private.mask_email`, `private.mask_name`, `private.mask_push_token` SQL helpers | fns | M§71 masking in SQL before data leaves the database |
| 40 | admin-api paths not yet in API_CONTRACTS §12.3 (beyond the BO-only paths already accepted there): `GET /me`, `GET /me/sessions`, `POST /session/logout`, `POST /session/logout-all {scope:'others'}`, `GET /users/:id/devices`, `GET /integrations/summary`, `GET /ai/metrics/series`, `PATCH /ai/routing-profile`, `GET /subscriptions/trial-stream`, `GET /subscriptions/events/:id`, `GET /entitlement-grants`, `GET /feedback/summary`, `GET /flags/:key`, `GET /flags/:key/evaluate`, `POST /flags/:key/archive`, `GET /announcements/:id`, `POST /data-requests/export/:id/regenerate`, `GET /audit/:id`, `GET /health/history`, `POST /admins/:id/resend-invite`, `POST /admins/:id/reset-mfa`, `POST /admins/:id/unlock` | routes | every §6 control resolves to a contract (R-24) |
| 41 | `admin_api` functions not yet in DB §6.10: `login_preflight`, `login_attempt_record`, `auth_status`, `invite_redeem`, `recovery_code_consume`, `recovery_codes_store`, `admin_session_step_up`, `session_expire`, `sessions_list_own`, `authorize`, `audit_write`, `audit_denied`, `metrics_ops`, `metrics_product`, `security_events`, `user_devices`, `user_mark_internal`, `subscription_resync`, `integrations_summary`, `integration_renew_watch`, `jobs_summary`, `correlation_trace`, `notifications_list`, `ai_requests_list`, `ai_routing_profile_set`, `prompt_telemetry`, `prompt_version_get`, `ai_feedback_reveal`, `billing_event_get`, `entitlement_grants_list`, `trial_stream`, `feedback_summary`, `feedback_reveal`, `flag_get`, `flag_evaluate_preview`, `flag_archive`, `announcement_get`, `announcement_audience_estimate`, `data_request_get`, `export_regenerate`, `audit_get`, `cron_status`, `admin_invite_rotate`, `admin_mfa_reset`, `admin_unlock`, `settings_get`, `settings_update`. Parameters added to DB functions: `admin_me(p_activity)`, `admin_session_end(p_scope)`, `user_reveal_email(p_field)`, `ai_model_config_update(p_profile, p_role, p_feature, p_patch, p_expected_version, p_reason)` | fns | names follow DB §6.10 wherever a DB function exists (R-20) |

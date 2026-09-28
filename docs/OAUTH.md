# Dijital Asistan: Sign-in and OAuth integrations (as built)

Documented at `ec14e92`.

Two separate things use OAuth, with separate clients and separate tokens:

| | App sign-in | Integrations |
|---|---|---|
| Purpose | Who the user is (the Supabase Auth session) | Reading mail, calendars and tasks, and approved writes |
| Providers | Apple, Google, Microsoft, e-mail one-time code | Google (Gmail, Calendar, Tasks), Microsoft (Outlook mail, calendar, To Do), demo |
| Tokens held by | Supabase Auth (session in the app's encrypted storage) | `public.oauth_credentials`, AES-256-GCM encrypted, decrypted only in Edge Functions |
| Scopes | Identity only (`openid email profile`) | Per capability, read at connect and write on first use |
| Code | [`apps/mobile/src/lib/auth`](../apps/mobile/src/lib/auth), `supabase/config.toml` `[auth.*]` | [`_shared/services/integrations`](../supabase/functions/_shared/services/integrations), [`_shared/providers`](../supabase/functions/_shared/providers), [`oauth`](../supabase/functions/oauth) |

The plans are [INTEGRATION_PLAN.md](INTEGRATION_PLAN.md) §2–§8 and
[SECURITY_AND_PRIVACY_PLAN.md CTL-3.1–3.3](SECURITY_AND_PRIVACY_PLAN.md#ctl-31-app-authentication-and-sessions-m88-adr-06).
Architecture: [ARCHITECTURE.md](ARCHITECTURE.md); the mobile screens: [MOBILE.md](MOBILE.md).

## App sign-in

| Method | Flow | Notes |
|---|---|---|
| Apple (iOS) | Native `expo-apple-authentication`; a raw nonce (32 random bytes, hex) goes to Supabase and its SHA-256 to Apple; `signInWithIdToken({provider:'apple', token, nonce})` | The single-use authorization code is sent to `POST /auth/apple/exchange` (API-DEV-03), non-blocking and retried once; the server stores the SIWA refresh token encrypted (token kind `apple_siwa_refresh`, bound to the user id) for revocation at account deletion. A missing server key (`EXTERNAL_CREDENTIAL_REQUIRED`) is ignored |
| Apple (Android) | Browser OAuth through Supabase (below) | |
| Google | `@react-native-google-signin/google-signin` → `signInWithIdToken({provider:'google'})` | Identity scopes only; configured only when `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (and on iOS `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`) is set, otherwise the button shows the external-credential state |
| Microsoft | Browser OAuth (`azure` provider, authority `common`) | |
| Browser OAuth | `signInWithOAuth({skipBrowserRedirect:true})` (PKCE, verifier in the encrypted store) → `WebBrowser.openAuthSessionAsync` → `exchangeCodeForSession(code)`; redirect `<scheme>://auth/callback` | A lost auth session is finished by the `app/auth/callback` route; one code is exchanged once |
| E-mail one-time code | Supabase OTP: 6 digits, 10-minute expiry, resend after 60 s, custom SMTP | No passwords. Sign-in mode uses `shouldCreateUser:false`, so an unknown address is reported instead of creating a second account |

Supabase Auth settings (`supabase/config.toml`): JWT expiry 1 h, refresh-token rotation with a
10 s reuse interval, anonymous sign-ins off, manual linking off, TOTP MFA enabled (used by admins),
and the `custom_access_token_hook` that adds `admin_role` only for active dedicated admin
identities. Edge Functions verify tokens with `auth.getClaims()` (JWKS) and a `jose` JWKS fallback;
`api` and `public-api` refuse admin identities (`FORBIDDEN {reason:'admin_identity'}`), and
destructive privacy actions need a sign-in at most 10 minutes old
([PRIVACY.md](PRIVACY.md#account-deletion)).

## Integration capabilities and scopes

Capabilities (`@da/domain` `Capability`): `mail_read`, `mail_send`, `calendar_read`,
`calendar_write`, `tasks_read`, `tasks_write`, `calendar_freebusy` (attendee free/busy for conflict
options, KNOWN_PLATFORM_LIMITATIONS KPL-46). A capability counts as granted only when every
scope it needs appears in the granted scope string (Google) or one of its accepted scopes does
(Microsoft); capabilities are always derived from what the provider returned, never assumed.

### Google ([`providers/google/scopes.ts`](../supabase/functions/_shared/providers/google/scopes.ts))

| Capability | Requested scopes | Also accepted (earlier broader grant) |
|---|---|---|
| identity (every request) | `openid`, `email`, `profile` | |
| `mail_read` | `gmail.readonly` | |
| `mail_send` | `gmail.send` | |
| `calendar_read` | `calendar.events.readonly`, `calendar.calendarlist.readonly`, `calendar.settings.readonly` | `calendar.readonly`; `calendar` |
| `calendar_write` | `calendar.events.owned` | `calendar.events`; `calendar` |
| `calendar_freebusy` | `calendar.events.freebusy` | `calendar.readonly`; `calendar` |
| `tasks_read` | `tasks.readonly` | `tasks` |
| `tasks_write` | `tasks` | |

Scopes are `https://www.googleapis.com/auth/<name>`. Never requested: `gmail.compose`,
`gmail.modify`, `gmail.metadata`, `https://mail.google.com/`. Authorization uses the web client
with PKCE S256, `access_type=offline`, `include_granted_scopes=true`, `prompt=consent` (so a
refresh token is returned on connect, reauth and upgrade) and the OIDC `nonce`.

### Microsoft ([`providers/microsoft/config.ts`](../supabase/functions/_shared/providers/microsoft/config.ts))

| Capability | Requested scopes | Also accepted |
|---|---|---|
| identity (every connect) | `openid`, `profile`, `email`, `offline_access`, `User.Read` | |
| `mail_read` | `Mail.Read` | `Mail.ReadWrite` |
| `mail_send` | `Mail.Send` | |
| `calendar_read` | `Calendars.Read` | `Calendars.ReadWrite` |
| `calendar_write` | `Calendars.ReadWrite` | |
| `calendar_freebusy` | `Calendars.Read` (`getSchedule`) | `Calendars.ReadWrite` |
| `tasks_read` | `Tasks.Read` | `Tasks.ReadWrite` |
| `tasks_write` | `Tasks.ReadWrite` | |

`offline_access` is on every request. Authority `common`, PKCE S256, `response_mode=query`,
`prompt=select_account` on a first connect and `consent` on reauth and upgrade. The client
authenticates with a **certificate assertion** (PS256 JWT with `x5t#S256`, key
`MICROSOFT_CERT_PRIVATE_KEY`); no client secret is sent. Refresh uses the tenant endpoint
(`consumers` for personal accounts); Microsoft rotates the refresh token on every use and the newest
one is stored. The account identity is `oid:tid` from the id_token, confirmed with `GET /me`.

### Initial and progressive scopes

- **Connect** (API-INT-01) accepts read capabilities only (`mail_read`, `calendar_read`,
  `tasks_read`), plus the identity scopes.
- **Write scopes are requested on first use.** Approving an action whose account lacks the write
  capability answers `424 PROVIDER_SCOPE_MISSING` with a `ScopeUpgrade` object and the approval
  stays `pending`; the app opens the upgrade sheet, calls `POST /integrations/:accountId/upgrade`
  (API-INT-02) with `resume.approval_id`, and after completion retries the approval with the same
  idempotency key. The capability map is `email_send → mail_send`, `calendar_create` /
  `calendar_update → calendar_write`, `task_create → tasks_write`.
- **Attendee free/busy is requested on first use too.** When a Google account lacks
  `calendar_freebusy`, `POST /plan/conflicts/:insightId/options` (API-PLAN-03) returns
  `availability_upgrade` and the conflict screen offers "Uygunluğu göster", which runs the same
  API-INT-02 upgrade without an approval; nothing asks for it silently. Microsoft accounts hold it
  with `Calendars.Read` (existing accounts were backfilled by
  `20260924003410_calendar_event_merge.sql`).
- **Upgrade scopes:** Google requests only the missing scopes (`include_granted_scopes` keeps the
  rest); Microsoft and demo request the union of granted and new capabilities. Both always add the
  identity scopes so the callback can prove the same account consented.
- **Plan limits:** adding `mail_read` or `calendar_read` checks `max_mail_accounts` /
  `max_calendar_accounts` (`ENTITLEMENT_REQUIRED {feature, limit, current}`), at start and again in
  the callback.
- **Scope drift:** every token refresh reports the granted scope string; a capability the user
  removed at the provider marks the account `partial` and disables that capability only.

## Connect flow with the R-07 completion binding

```mermaid
sequenceDiagram
  participant App as Mobile app
  participant API as api
  participant P as Provider consent
  participant OA as oauth
  participant DB as Postgres
  App->>App: device_nonce = 32 random bytes (SecureStore, 10 min)
  App->>API: POST /integrations/:provider/start {capabilities, device_nonce_hash} (JWT, Idempotency-Key)
  API->>DB: oauth_states row: state_hash, PKCE verifier (encrypted), nonce_hash, device_nonce_hash, expires +10 min
  API-->>App: auth_url, state_id
  App->>P: openAuthSessionAsync(auth_url, dijitalasistan://integrations/callback)
  P->>OA: GET /oauth/<provider>/callback?code&state
  OA->>DB: consume state once (single use, not expired, same provider)
  OA->>P: token exchange with the PKCE verifier; verify id_token (issuer, audience, expiry, nonce)
  OA->>DB: new identity: connecting account + encrypted credentials; reconnect/upgrade: token set held encrypted on the state row; completion_code_hash
  OA-->>App: 302 OAUTH_RESULT_REDIRECT_URI?result=pending_confirmation&provider&state_id&completion_code
  App->>API: POST /integrations/oauth/complete {completion_code, device_nonce} (same user JWT)
  API->>DB: same user · sha256(device_nonce) matches · within 10 min of the callback · not completed
  API->>DB: activate the account (or swap in the held tokens) atomically; enqueue initial_sync
  API-->>App: {result: success|partial|account_mismatch|already_linked|plan_limit, account, granted, missing, resume, jobs}
```

- **State:** `state` and the id_token `nonce` are HMAC-SHA-256 values of the state row id keyed with
  `HASH_PEPPER` (43 characters, base64url); only their SHA-256 is stored. An idempotent replay of
  start or upgrade re-renders the same authorization URL. The PKCE verifier (64 characters) and a
  held token set are AES-256-GCM encrypted with the token keyring and the AAD
  `v1|oauth_state|{state_id}|{field}`.
- **Callback checks:** a malformed or unknown state is a localized 400 page (no script, no external
  resources); a used state is audited as `security.oauth_state_replay` and redirects with
  `expired_state`; a state for another provider is refused. The redirect carries only `result`,
  `provider`, `state_id`, `completion_code` and `error_code`: never tokens, codes, scopes or e-mail
  addresses. Responses are `Cache-Control: no-store`, `Referrer-Policy: no-referrer`.
- **Identity collisions (R-01):** a reconnect or upgrade that returns another identity ends as
  `account_mismatch` (the new token is revoked, the account is unchanged); an identity linked by
  another user ends as `already_linked`; a new identity without a refresh token is refused
  (`no_refresh_token`).
- **Completion:** nothing is usable and nothing syncs before `POST /integrations/oauth/complete`.
  A wrong user, device nonce, reused code or expired window is `OAUTH_COMPLETION_INVALID`, audited
  as `security.oauth_completion_rejected`, and a pending new account is revoked and purged.
  Unbound `connecting` accounts are purged by `scheduler_tick` (`integration_purge` with reason
  `binding_expired`) once `pending_binding_until` passes.
- **Result page:** `OAUTH_RESULT_REDIRECT_URI` defaults to `dijitalasistan://integrations/callback`.
  The web page `/oauth/done` reads only allow-listed parameters and never says "connected"; the app
  calls `complete` itself.
- **Demo provider:** with demo mode allowed, `GET /oauth/demo/authorize` renders a consent page with
  one checkbox per requested capability ("İzin Ver" / "Reddet"); a ticked subset yields `partial`.
  A Google or Microsoft start without credentials falls back to demo while demo mode is on.

## Token storage, encryption and rotation

[`_shared/crypto/token-cipher.ts`](../supabase/functions/_shared/crypto/token-cipher.ts):

- **Cipher:** AES-256-GCM with a random 12-byte IV per encryption and a 16-byte tag; keys
  `TOKEN_ENC_KEY_V{n}` (32 bytes, base64) are imported non-extractable.
- **Binding:** the AAD is `v1|{account}|{provider}|{kind}` (account id, or the user id for the SIWA
  token); its SHA-256 is stored in `aad_hash`, so a row moved to another account, provider or token
  kind fails to decrypt ("fails closed").
- **Rows:** `oauth_credentials` holds one `refresh` and one `access` row per account, plus
  `apple_siwa_refresh` per user. The table has no client grant; admin SQL reads only
  `key_version`.
- **Rotation:** encryption always uses `TOKEN_ENC_ACTIVE_VERSION`; decryption accepts every loaded
  version. `credential_reencrypt` (enqueued once a day by `da_reconciliation`) re-encrypts up to 200
  stale rows per run with an optimistic swap on `key_version` and re-enqueues itself while rows
  remain; the reconciliation job also re-encrypts the rows of the account it checks. To rotate: add
  `TOKEN_ENC_KEY_V{n+1}`, switch the active version, keep the old key until no row uses it.
- **Refresh:** [`_shared/providers/token-source.ts`](../supabase/functions/_shared/providers/token-source.ts)
  returns a stored access token valid for more than 5 minutes; otherwise
  `try_lock_credential_refresh` (30 s) elects one refresher and the others poll 4 × 500 ms. Plaintext
  tokens live only inside that closure and are never logged (the logger also denies `code`,
  `code_verifier`, `state`, `completion_code` and `device_nonce` by key).

## Disconnect and revoke

`POST /integrations/:accountId/disconnect` (API-INT-03,
[`disconnect.ts`](../supabase/functions/_shared/services/integrations/disconnect.ts)):

1. Provider effects first, sequentially, within an 8-second budget, never failing the request: stop
   the Gmail watch, Calendar channels and Graph subscriptions; then revoke.
2. **Google:** `POST oauth2.googleapis.com/revoke` with the refresh token, removing the whole grant
   of the integration client (login is a separate client and is unaffected); `invalid_token` or
   `invalid_grant` counts as already revoked. **Microsoft:** there is no per-app delegated revoke and
   `revokeSignInSessions` is never used, so the result is `local_only` with the consent-management
   link (`account.live.com/consent/Manage` for personal accounts, `myapps.microsoft.com` for work
   accounts). **Demo:** the grant ends with the credentials.
3. One database transaction (`private.disconnect_integration`): credentials deleted, cursors and
   watches cleared, calendars deselected, queued sync jobs cancelled, status `disconnected`, and
   `integration_purge` enqueued: immediately with `purge_content`, otherwise after 30 days (content
   is hidden meanwhile).

The response reports `revocation: provider_revoked | local_only | revoke_failed` and the manual
link. Account deletion runs the same service for every account
([PRIVACY.md](PRIVACY.md#account-deletion)).

## Webhooks and watch renewal

| Source | Endpoint | Authentication | Effect |
|---|---|---|---|
| Gmail via Pub/Sub | `POST /webhooks-google/gmail` (WH-01) | OIDC bearer JWT verified against Google's keys: issuer, audience `GOOGLE_PUBSUB_PUSH_AUDIENCE`, `email = GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT`, `email_verified` | Deduped by Pub/Sub `messageId`, routed by mailbox address, one `provider_webhook` job per account and history id; 204 after authentication |
| Google Calendar channel | `POST /webhooks-google/calendar` (WH-02) | `X-Goog-Channel-Token = base64url(HMAC-SHA256(WEBHOOK_HMAC_SECRET, channel_id))`, plus the stored token hash and resource id | `sync` handshakes are no-ops; others enqueue a calendar sync |
| Microsoft Graph | `POST /webhooks-microsoft/notifications`, `/lifecycle` (WH-03, WH-04) | The validation handshake echoes `validationToken` as bounded `text/plain`; each notification's `clientState` must match the hash stored for that subscription | 202; lifecycle events drive reauthorization and re-creation |

Payloads are triggers only: the worker re-fetches from the provider; bodies are never logged and
`webhook_events` keeps ids and a digest. Watches ([`watches.ts`](../supabase/functions/_shared/services/integrations/watches.ts)):

- Gmail `users.watch`, Calendar channels (TTL 7 days) and Graph subscriptions (10,070 minutes) are
  created after the first sync pass. Without push configuration the resource is polled.
- `watch_renew_after = max(now + 1 h, min(expiry − 1 day, now + 1 day))`; `scheduler_tick` enqueues
  `watch_renewal` for due rows. Graph `reauthorizationRequired` is honoured at most once per
  10 minutes; `subscriptionRemoved` recreates the subscription; deselecting a calendar or
  disconnecting stops its watch.
- `reconciliation` (every 6 hours per account, and after gaps) checks token health, re-encrypts
  credentials, drops held token sets of abandoned reconnects, repairs missing or expiring watches,
  removes orphan channels and catches up any resource whose last success is older than 6 hours.
- Microsoft Graph `calendarView` is re-baselined when `rebaseline_due_at` passes; Google Tasks and
  Microsoft To Do are polled every 15 minutes.

## Error → account status

Adapters classify every provider failure into a `ProviderErrorCode`
([`@da/domain` `providers/errors.ts`](../packages/domain/src/providers/errors.ts)); the policy
decides the account status and the retry:

| Error code | Account status | Retry |
|---|---|---|
| `auth_invalid_grant`, `auth_token_rejected` | `needs_reauth` | none (the user reconnects) |
| `consent_admin_required` | `admin_consent_required` | none |
| `consent_denied`, `account_mismatch` | unchanged (the flow ends) | none |
| `scope_missing`, `mailbox_unavailable` | `partial` | none |
| `conditional_access_blocked` | `error` | none |
| `client_credential_invalid`, `external_credential_required` | `error` (ops alert: our configuration) | none |
| `rate_limited`, `quota_exhausted_daily` | unchanged | after `Retry-After` (`rate_limited` raises `max_attempts` to 12) |
| `cursor_invalid` | unchanged | bounded resync |
| `not_found` | unchanged | the local copy is deleted |
| `conflict_exists` | unchanged | treated as success (deterministic id) |
| `precondition_failed`, `not_organizer` | unchanged | none (`APPROVAL_STALE` for writes) |
| `provider_unavailable`, `unknown` | unchanged; a sync resource escalates the account to `error` after 5 consecutive failed runs or without a success for 6 h (push) / its poll interval + 1 h (polled) | exponential backoff 30 s … 30 min, ±20 % jitter |
| `payload_invalid` | unchanged (ops alert) | dead letter |

When several conditions hold, the shown status follows the precedence `disconnected` →
`needs_reauth` → `admin_consent_required` → `error` → `partial` → `syncing` → `connecting` →
`healthy`. A change to `needs_reauth` or `admin_consent_required` enqueues an `account` notification
(trigger `trg_connected_accounts_status_notify`).

## Differences from the plan

| Plan | As built | Reason (source) |
|---|---|---|
| `state` = 32 random bytes, base64url (INTEGRATION_PLAN §3.2.1, API_CONTRACTS API-INT-01) | `state` and `nonce` = HMAC(`HASH_PEPPER`, state id); only hashes stored | An idempotent replay of start or upgrade can re-render the same authorization URL without storing the raw state (`state-secrets.ts` header; integration notes A) |
| Callback result `success` (TEST_PLAN WEB-E2E-08) | `pending_confirmation` until the app completes | R-07 completion binding; API_CONTRACTS OAUTH-01 is authoritative (integration notes I, web) |
| Demo consent is implicit (API_CONTRACTS OAUTH-03 text) | A server-rendered consent page with per-capability checkboxes and "Reddet" | Needed for the E2E partial-grant and denial branches (commit `0303b2c`, integration notes X) |
| Google or Microsoft start without credentials fails with `EXTERNAL_CREDENTIAL_REQUIRED` | Falls back to the demo provider while demo mode is on | Keeps the connect flow usable in demo builds (`resolveFlowProvider`; integration notes A) |
| Two token sources for sync and for approval execution | Both remain (`providers/token-source.ts` and `approvals/execute/session.ts`), sharing the binding `{account, provider, kind}` and the `try_lock` refresh | Merge result; recorded as a consolidation candidate (integration notes merge) |

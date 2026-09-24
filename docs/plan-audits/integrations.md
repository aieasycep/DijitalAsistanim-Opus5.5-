# Provider and platform integration research for Dijital Asistan (as of 2026-09-23)

## 0. How the sources were read, and package versions

**Blocked sites.** The egress proxy blocked these hosts: developers.google.com, developers.googleblog.com, support.google.com, learn.microsoft.com, supabase.com, docs.expo.dev, revenuecat.com (including docs-origin), play.google.com and discuss.google.dev.

**What was read instead.** I read the official doc sources in other forms:
- Microsoft Graph docs: `github.com/microsoftgraph/microsoft-graph-docs-contrib`.
- Microsoft Entra docs: `github.com/MicrosoftDocs/entra-docs`.
- Supabase docs: `github.com/supabase/supabase/apps/docs/content`.
- Expo docs and changelogs: `github.com/expo/expo/docs` plus the package CHANGELOGs.
- Google API Discovery documents (`gmail.googleapis.com/$discovery/rest?version=v1`, `www.googleapis.com/discovery/v1/apis/calendar/v3/rest`, `tasks.googleapis.com/$discovery/rest?version=v1`). These are machine-readable and authoritative for scopes and parameters.
- Apple doc JSON (`developer.apple.com/tutorials/data/documentation/...`).
- developer.android.com, read directly.
- The npm registry.

**Citations.** Each fact below cites the canonical public URL.
- **[OFF]** means I read the official source directly.
- **[OFF-S]** means I only saw a search-engine excerpt of an official page.
- **[SEC]** means a third-party source. These must be re-verified in execution mode.

**Environment note.** One read-only probe (`curl -o`) accidentally saved two temporary HTML files, `scratchpad/a16.html` and `scratchpad/a17.html`. No project files were touched.

**Current versions (npm, 2026-09-23):**

| Package | Version |
|---|---|
| expo | 57.0.24 (`latest`; `next` is 58.0.0-preview.5) |
| react-native | 0.87.1 |
| @supabase/supabase-js | 2.117.1 |
| @supabase/server | 1.8.0 (official, repo supabase/server) |
| expo-apple-authentication | 57.0.2 |
| @react-native-google-signin/google-signin | 16.1.5 |
| expo-auth-session | 57.0.12 |
| expo-web-browser | 57.0.3 |
| expo-notifications | 57.0.20 |
| expo-background-task | 57.0.19 |
| expo-task-manager | 57.0.19 |
| expo-secure-store | 57.0.4 |
| expo-calendar | 57.0.4 (repo already at 58.0.2) |
| expo-widgets | 57.0.20 (first-party, iOS only) |
| expo-crypto | 57.0.3 |
| react-native-purchases | 10.10.1 (react-native-purchases-ui 10.10.1) |
| expo-share-intent | 8.0.1 (README: SDK 57 needs 8.0+) |
| expo-share-extension | 5.0.6 (README lists support only up to SDK 54; **do not use**) |
| react-native-android-widget | 0.22.1 (peer expo ≥54) |
| @bacons/apple-targets | 5.0.0 |
| react-native-app-auth | 8.4.1 |

---

## A. Google (Gmail, Calendar, Tasks, OAuth)

### Facts

**Gmail scopes (Discovery document, revision 20260917) [OFF]**
- Source: https://gmail.googleapis.com/$discovery/rest?version=v1 and https://developers.google.com/workspace/gmail/api/auth/scopes
- `https://www.googleapis.com/auth/gmail.readonly`: "View your email messages and settings".
- `.../gmail.metadata`: "View your email message metadata such as labels and headers, but not the email body".
- `.../gmail.send`: "Send email on your behalf".
- `.../gmail.compose`: "Manage drafts and send emails".
- Also present: `.../gmail.modify`, `https://mail.google.com/`, `.../gmail.labels`, `.../gmail.insert`, `.../gmail.settings.basic`, `.../gmail.settings.sharing` and the `gmail.addons.*` scopes.

**Gmail scope classification [OFF-S]/[SEC]**
- Restricted: `gmail.readonly`, **`gmail.metadata`**, `gmail.modify`, `gmail.insert`, `gmail.compose`, `gmail.settings.basic`, `gmail.settings.sharing`, `https://mail.google.com/`.
  - Sources: https://support.google.com/cloud/answer/13464325 and https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- `gmail.send` is **sensitive**, not restricted.
- The app's overall classification is its most restrictive scope.
- One search summary called `gmail.metadata` "basic". That is wrong: it is restricted, so it gives no audit advantage over `gmail.readonly`.

**Which scopes each Gmail method accepts [OFF] (Discovery)**
- `messages.list`, `history.list`, `watch`, `stop`, `threads.list`: `gmail.metadata`, `gmail.readonly` or `gmail.modify`.
- `messages.send`: `gmail.send`, `gmail.compose`, `gmail.modify` or `gmail.addons.current.action.compose`.
- **`drafts.create` and `drafts.send` accept only `gmail.compose` or `gmail.modify` (plus addons). `gmail.send` cannot create Gmail drafts.**
- `messages.list` parameter `q`: "cannot be used when accessing the api using the gmail.metadata scope". `maxResults` defaults to 100, maximum 500. `history.list` is the same.
- `messages.get` `format` values: `minimal | full | raw | metadata`. `metadataHeaders` filters headers when `format=metadata`.
- `history.list` `startHistoryId` [OFF], quoted: "A `historyId` is typically valid for at least a week, but in some rare circumstances may be valid for only a few hours. If you receive an `HTTP 404` error response, your application should perform a full sync." `historyTypes` values: `messageAdded, messageDeleted, labelAdded, labelRemoved`.
- Threading rules for `Message.threadId` [OFF]: (1) `threadId` must be set on the Message or Draft.Message; (2) `References` and `In-Reply-To` headers must follow RFC 2822; (3) the `Subject` must match.
- `messages.send` upload `maxSize` is 36,700,160 bytes (35 MB) [OFF].
- `watch` request [OFF]:
  - `topicName` must be `projects/<same GCP project id>/topics/<t>` and must already exist, with Gmail granted "publish".
  - `labelIds` plus `labelFilterBehavior` (`include` | `exclude`; the older `labelFilterAction` is deprecated).
  - Response contains `historyId` and `expiration` (epoch ms): "Call watch again before this time".

**Gmail push [OFF-S]**
- Sources: https://developers.google.com/workspace/gmail/api/guides/push and https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions
- Call `watch` at least every 7 days; Google recommends once per day.
- Each watched user is limited to 1 notification per second. Extra notifications are dropped.
- Grant the Pub/Sub Publisher role on the topic to `gmail-api-push@system.gserviceaccount.com`. Without it, `watch` succeeds but nothing is ever delivered.
- The Pub/Sub push body `message.data` is base64-encoded JSON `{emailAddress, historyId}`.
- Authenticated push sends an OIDC JWT in `Authorization: Bearer`. Validate the signature, `aud`, `email` (must equal the configured service account) and `email_verified=true`.

**Gmail quotas: changed on 2026-05-01 [OFF-S]/[SEC], verify on https://developers.google.com/workspace/gmail/api/reference/quota**
- Cloud projects **created on or after 2026-05-01** get:
  - 1,200,000 quota units/min per project;
  - **6,000 units/min per user per project** (older projects that used the API between Nov 2025 and Apr 2026 keep their earlier limit, 15,000);
  - an **80,000,000 units/day per-project billing threshold**. It is not charged yet; Google promises billing details later in 2026 with at least 90 days' notice.
- Per-method costs (partly verified):
  - `messages.list` 5, `history.list` 2, **`messages.get` 20** (was 5), `messages.send` 100.
  - `threads.get`: sources conflict (10 or 40).
  - `drafts.*`, `watch` and `labels.list`: not confirmed.
- This is a new project, so the new quotas apply.

**Gmail batching [SEC]**
- Up to 100 calls per batch; Gmail advises at most 50 to avoid rate limiting.
- Each call inside a batch counts against quota separately.
- Source: https://developers.google.com/workspace/gmail/api/guides/batch

**Calendar scopes (Discovery document, revision 20260826) [OFF]**
- Source: https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest
- Available: `calendar`, `calendar.readonly`, `calendar.events`, `calendar.events.readonly`, `calendar.events.owned`, `calendar.events.owned.readonly`, `calendar.calendarlist(.readonly)`, `calendar.calendars(.readonly)`, `calendar.settings.readonly`, `calendar.app.created`, `calendar.freebusy`, `calendar.events.freebusy`, `calendar.events.public.readonly`, `calendar.acls(.readonly)`.
- `calendarList.list` accepts `calendar`, `calendar.calendarlist`, `calendar.calendarlist.readonly` or `calendar.readonly`.
- `events.list`, `events.watch` and `events.instances` accept any events-read scope, including `calendar.events.readonly`.
- `events.insert` and `events.patch` accept `calendar`, `calendar.app.created`, `calendar.events` or `calendar.events.owned`.
- `settings.get` (time zone) accepts `calendar`, `calendar.readonly` or `calendar.settings.readonly`.
- Calendar and Tasks scopes are classified **sensitive** (brand verification required, no CASA assessment) [OFF-S].

**Calendar sync [OFF] (Discovery) and https://developers.google.com/workspace/calendar/api/guides/sync [OFF-S]**
- `syncToken` returns only entries changed since the previous list. Deleted events are always included, and `showDeleted=false` is not allowed with it.
- `syncToken` **cannot be combined** with `iCalUID, orderBy, privateExtendedProperty, q, sharedExtendedProperty, timeMin, timeMax, updatedMin`.
- `nextSyncToken` appears only on the last page.
- `maxResults` defaults to 250, maximum 2,500.
- **HTTP 410 GONE (`fullSyncRequired`)** means: wipe the local store for that calendar and run a full sync.
- `events.insert` `sendUpdates` values: `all | externalOnly | none`. Google warns that `none` "can have significant adverse effects".

**Calendar push [OFF-S]**
- Sources: https://developers.google.com/workspace/calendar/api/guides/push and https://developers.google.com/workspace/calendar/api/v3/reference/events/watch
- The Channel body includes `id` (UUID), `token`, `type=web_hook`, `address` (HTTPS) and `params.ttl` (**default 604,800 s = 7 days**). The response returns `resourceId` and `expiration` (ms).
- Channels do not auto-renew. Create a new channel before expiry and stop the old one with `channels.stop` (`id` + `resourceId`).
- Notification headers: `X-Goog-Channel-ID`, `X-Goog-Channel-Token`, `X-Goog-Resource-ID`, `X-Goog-Resource-State` (`sync` | `exists` | `not_exists`), `X-Goog-Channel-Expiration`, `X-Goog-Message-Number`.
- Notifications carry no payload, so the handler must trigger an incremental sync.

**Calendar quotas [SEC], verify at https://developers.google.com/workspace/calendar/api/guides/quota**
- Projects created on or after 2026-05-01: 10,000 requests/min per project and 600 requests/min per user.
- A 1,000,000 requests/day billing threshold also applies.
- Quota errors come back as HTTP 403 or 429 with `usageLimits` reasons (`rateLimitExceeded`, `userRateLimitExceeded`).

**Tasks (Discovery document, revision 20260920) [OFF]**
- Scopes: `https://www.googleapis.com/auth/tasks.readonly` and `https://www.googleapis.com/auth/tasks`.
- `tasks.list` parameters: `updatedMin`, `showDeleted`, `showHidden`, `showCompleted`, `showAssigned`, `dueMin/dueMax`, `completedMin/Max`; `maxResults` defaults to 20, **maximum 100**.
- `Task.due`, quoted: "Only date information is recorded… It isn't possible to read or write the time".
- Limits: `title` ≤1,024 characters, `notes` ≤8,192. `status` is `needsAction | completed`.
- **Tasks has no watch or push and no sync token.**

**OAuth mechanics**
- Sources: https://developers.google.com/identity/protocols/oauth2/web-server , /oauth2 , /oauth2/native-app , /oauth2/resources/granular-permissions [OFF-S]
- Endpoints:
  - authorize: `https://accounts.google.com/o/oauth2/v2/auth`
  - token: `https://oauth2.googleapis.com/token`
  - revoke: `POST https://oauth2.googleapis.com/revoke`, `Content-Type: application/x-www-form-urlencoded`, body `token=…`
- Revoking removes the whole grant for that client and user, including all incrementally added scopes.
- A refresh token requires `access_type=offline`. Use `prompt=consent` when you need a refresh token re-issued.
- `include_granted_scopes=true` gives incremental authorization: the new token covers the union of granted scopes.
- **Granular consent:** users can untick individual scopes. The app must read the space-delimited `scope` field in the token response, disable features whose scopes were not granted, and re-ask only when the user shows intent.
- **Refresh-token limits:**
  - 100 refresh tokens per Google Account per OAuth client ID; the oldest is silently invalidated when a new one is created.
  - Tokens also die after 6 months unused, on user revocation, and on password change when Gmail scopes are granted.
  - **In "Testing" publishing status (External), refresh tokens expire after 7 days** unless only openid/email/profile scopes are used, and there is a **100 test-user cap**.
  - Source: https://developers.google.com/identity/protocols/oauth2#expiration [OFF-S]
- **Custom URI scheme redirects are disabled by default for new Android OAuth clients.** Google recommends Google Identity Services / Credential Manager instead. iOS clients still use the reversed-client-ID scheme.
  - Source: https://developers.google.com/identity/protocols/oauth2/native-app [OFF-S]
- **Restricted-scope verification and CASA [OFF-S]/[SEC]:**
  - Restricted data accessed from or through a server needs an annual security assessment (CASA) by a Google-approved lab.
  - Reverify every 12 months from the Letter of Assessment (LOA) date. "Tiers" are being renamed to AL1/AL2. Tier-2 self-scan is no longer allowed (TAC Security offers a Google-negotiated discount).
  - Cost is roughly a few hundred USD up to $5,000+ for a penetration test [SEC].
  - Unverified apps show a warning and have a **100 new-user lifetime cap**.
  - Sources: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification , https://support.google.com/cloud/answer/13465431 , https://deepstrike.io/blog/google-casa-security-assessment-2025
- **Limited Use / AI [OFF-S]:**
  - Workspace API data must not be used or transferred to "create, train, or improve a foundational machine learning or artificial intelligence model". It may be used only for user-facing, personalised features.
  - The privacy policy must affirmatively state compliance with the "Google API Services User Data Policy, including the Limited Use requirements".
  - Sources: https://developers.google.com/workspace/workspace-api-user-data-developer-policy and https://workspace.google.com/blog/ai-and-machine-learning/api-policy-protections
- **Brand verification:**
  - Homepage, privacy policy and every authorized domain (including redirect-URI domains) must be verified in Search Console.
  - **`<ref>.supabase.co` cannot be verified by us**, and Google shows the redirect domain on the consent screen until brand verification passes.
  - Supabase custom domains are a paid add-on on paid plans, CNAME subdomain only, one per project.
  - Sources: https://supabase.com/docs/guides/platform/custom-domains [OFF], https://github.com/orgs/supabase/discussions/2925 [SEC]

### Design implications
1. **App login and integration are separate flows (§88).**
   - App login: native Google Sign-In through `@react-native-google-signin/google-signin` 16.x (Credential Manager on Android), scopes `openid email profile` only, then `supabase.auth.signInWithIdToken({provider:'google', token})` (see F).
   - Integration: a separate server-side authorization-code flow with PKCE, using a **Web application** OAuth client in the **same GCP project**, because one project means one consent screen and one verification.
2. **Integration flow:**
   1. The app calls Edge Function `integrations-oauth-start` with its Supabase JWT and `{provider:'google', capability:'mail_read'|'calendar_read'|'tasks_read'|'mail_send'|'calendar_write'|'tasks_write'}`.
   2. The function creates an `oauth_states` row: `id`, `user_id`, `provider`, `requested_scopes[]`, `code_verifier` (encrypted), `nonce`, `return_to`, `expires_at = now()+10min`, `used_at`.
   3. It returns an auth URL with `state=<opaque id>`, `code_challenge` (S256), `access_type=offline`, `include_granted_scopes=true`, `prompt=consent` (first connect or re-consent only), and `login_hint`.
   4. The app opens it with `WebBrowser.openAuthSessionAsync(url, 'dijitalasistan://integrations/callback')` (ASWebAuthenticationSession / Custom Tabs, never a WebView).
   5. Google redirects to `https://api.<our-domain>/functions/v1/oauth-google-callback`. That function validates and consumes the state row once, exchanges code + verifier at `/token`, **parses the granted `scope` string**, encrypts the refresh token, upserts `provider_connections`, and enqueues the initial sync.
   6. It then 302-redirects to `dijitalasistan://integrations/callback?provider=google&result=success|partial|denied&connection=<id>`. **No tokens ever reach the client.**
   7. Prefer an iOS universal link / Android App Link (`https://<marketing-domain>/oauth/done`) as the final redirect, with the custom scheme as fallback. Android custom-scheme restrictions apply only to Google's own redirect, which here is HTTPS.
3. **Initial and progressive scope sets.**

   | Step | Scopes |
   |---|---|
   | Connect Gmail | `openid email https://www.googleapis.com/auth/gmail.readonly` |
   | Connect Google Calendar | `https://www.googleapis.com/auth/calendar.events.readonly https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.settings.readonly` (or the single `calendar.readonly`) |
   | Google Tasks | `https://www.googleapis.com/auth/tasks.readonly` |
   | First approved send (progressive) | `https://www.googleapis.com/auth/gmail.send` |
   | First approved calendar write | `https://www.googleapis.com/auth/calendar.events.owned` (fallback `calendar.events`) |
   | Task write | `https://www.googleapis.com/auth/tasks` |

   **Every scope, including progressive ones, must be listed on the consent screen and in the verification submission up front.**
4. **Do not request `gmail.compose`.**
   - AI reply drafts live in our own `approval_requests` / `draft_messages` tables (Approval Center).
   - On approval, the server builds RFC 2822 MIME with `In-Reply-To: <orig Message-ID>`, `References: <orig References> <orig Message-ID>`, `Subject: Re: <orig subject>`, base64url-encodes it, and calls `messages.send` with `threadId`.
   - This keeps the send path on a *sensitive* scope and avoids adding another restricted one.
5. **Initial sync.**
   - List `INBOX` and `SENT` for the last N days (the design says "3 gün analiz edildi"; use 3 days on Free and up to 14 on Pro).
   - Use `messages.get` with `format=metadata` and `metadataHeaders=From,To,Cc,Subject,Date,Message-ID,In-Reply-To,References,List-Unsubscribe,Auto-Submitted,Precedence`.
   - Fetch `format=full` only for candidates the triage rules keep.
   - Store `historyId` from `getProfile` or the newest message.
6. **Incremental sync.** Pub/Sub push hits Edge Function `webhook-gmail`, which:
   - uses `verify_jwt=false`;
   - verifies the Google OIDC JWT against `https://www.googleapis.com/oauth2/v3/certs` with our configured `aud`, and checks that `email` equals our push service account;
   - enqueues `{connection_id, historyId}` into pgmq and returns 204 immediately.

   The worker then:
   - calls `history.list` with `startHistoryId=stored`, `historyTypes=messageAdded,labelAdded,labelRemoved,messageDeleted`;
   - on **404**, marks the cursor invalid and runs a bounded full resync (last 7 days);
   - dedupes on `(connection_id, provider_message_id)` and uses `threadId` as the thread key.
7. **Watch renewal.** A daily per-connection job (with jitter) calls `watch` with `labelIds=['INBOX','SENT']` and `labelFilterBehavior='include'`, and stores `expiration`. An alert fires if any connection has `watch_expires_at < now()+36h`.
8. **Quota budgeting (new-project numbers).**
   - A per-user token bucket in Postgres budgets at most 4,000 of the 6,000 units/min.
   - 300 `messages.get`/min/user is the ceiling, so backfill is paced.
   - Handle 429 and 403 `rateLimitExceeded` / `userRateLimitExceeded` with exponential backoff plus jitter, and respect `Retry-After`.
   - Record units per call in `provider_api_usage` so the backoffice can watch the 80M/day billing threshold.
9. **Calendar sync.**
   - Per calendar: full `events.list` (`singleEvents=true` for the briefing window, or keep the recurring masters) → store `nextSyncToken`.
   - `events.watch` with TTL 604,800 s and `token = HMAC(secret, channel_id)`.
   - `webhook-gcal` validates `X-Goog-Channel-Token`, ignores the `sync` state, and enqueues an incremental sync.
   - On 410: wipe and resync.
   - Re-create channels 24 h before expiry; call `channels.stop` on disconnect.
10. **Tasks.** Poll every 15 min, plus on app foreground, with `updatedMin=last_sync-60s`, `showDeleted=true`, `showHidden=true`, `maxResults=100`. Treat `due` as a date only; any time-of-day for a reminder stays on our side.
11. **Token-error mapping.**
    - `invalid_grant` → `provider_connections.status='needs_reauth'` → UI `error/oauth-expired`: **"Gmail bağlantısı yenilenmeli." / "Google oturumu süresi doldu. Yeniden bağlanana kadar yeni mailler analiz edilmez." / [Yeniden Bağlan] [Sonra]** (design 08 copy).
    - A missing scope in the token response → `status='partial'`; the feature card shows why.
12. **Disconnect and account deletion.** In order: `users.stop` → `channels.stop` for each channel → `POST /revoke` with the refresh token → hard-delete ciphertext → purge synced content per retention policy → write an audit row.
13. **Privacy and design copy.** The explainer copy "Verilerin reklam amacıyla kullanılmaz, satılmaz" is compatible with Limited Use. Add the Limited Use statement to the privacy page, and state that no mail content is used to train general AI models. The AI provider must be under a zero-retention / no-training agreement, or the transfer becomes a policy violation.
14. **Hard blockers (manual):**
    - **CASA for `gmail.readonly`** (weeks of lead time, annual, paid).
    - Verified domain plus Search Console.
    - **Supabase custom domain** (`api.dijitalasistan.app` or similar), required for brand verification because the Edge Function callback lives on the Supabase domain.
    - Demo video, privacy policy and ToS on the marketing site.
    - Pub/Sub topic and push subscription with OIDC service account.
15. **Until CASA passes:** run the closed beta at 100 users or fewer. Prefer publishing status "In production (unverified)" over "Testing", so refresh tokens avoid the 7-day expiry; users will see the unverified-app warning. **[verify this behaviour in console]**

---

## B. Microsoft (Entra ID v2 / Microsoft Graph)

### Facts

**Endpoints and tenants [OFF]**
- Source: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
- Pattern: `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize|token`, where `{tenant}` is `common | organizations | consumers | <tenant-id>`.
- **PKCE (`code_challenge`, `S256`) is recommended for all client types**, confidential clients included; `code_verifier` is sent at token redemption.
- A `refresh_token` is returned "Only provided if `offline_access` scope was requested".
- `prompt` values: `login | none | consent | select_account`. `login_hint` and `domain_hint` are also supported.

**Refresh tokens [OFF]**
- Source: https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens
- Lifetime: **90 days** by default; 24 h for SPA redirect URIs and email-OTP flows.
- "Refresh tokens replace themselves with a fresh token upon every use"; the old token is not revoked, and the app should discard it.
- Confidential-client tokens survive user password change and SSPR, but are revoked by admin password reset (Entra/M365 admin center), user "revoke all", and admin revoke-all.

**Client credentials [OFF]**
- Source: https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials
- Microsoft says client secrets "should **not be used** in production". Use a certificate (a `client_assertion` JWT signed with the private key) or federated credentials.

**Personal accounts [OFF]**
- Personal Microsoft accounts have `tid = 9188040d-6c67-4c5b-b112-36a304b66dad`.
- Source: https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference

**Publisher verification [OFF]**
- Source: https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview
- It needs a verified Microsoft AI Cloud Partner Program (Partner One / partner global account) ID, and it is free.
- Quoted: "Beginning November 2020, if risk-based step-up consent is enabled, users can't consent to most newly registered multitenant apps that aren't publisher verified" when the app asks for more than basic sign-in and profile.
- Tenant admins can restrict user consent to verified publishers (`microsoft-user-default-low`). The default policy lets users consent to their own mailbox access.
  - Source: https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent

**Delegated Graph permissions [OFF]**
- Source: https://learn.microsoft.com/en-us/graph/permissions-reference
- Each of these has **AdminConsentRequired = No and is available for personal Microsoft accounts**:
  - `User.Read`
  - `offline_access`
  - `Mail.ReadBasic` (no body, previewBody, attachments or extended properties)
  - `Mail.Read`
  - `Mail.Send` ("Send mail as a user")
  - `Calendars.Read`
  - `Calendars.ReadWrite`
  - `Tasks.Read`
  - `Tasks.ReadWrite`

**Least-privilege permission per operation [OFF]** (`.../api-reference/v1.0/includes/permissions/*`)
- **`POST /me/messages/{id}/reply` needs only `Mail.Send`.**
- `POST /me/messages/{id}/send` and `POST /me/sendMail` need `Mail.Send`.
- **`createReply` needs `Mail.ReadWrite`.**
- Message `delta` needs `Mail.ReadBasic`; event `delta` needs `Calendars.Read`.

**Mail send details [OFF]**
- Sources: https://learn.microsoft.com/en-us/graph/api/user-sendmail and https://learn.microsoft.com/en-us/graph/api/message-createreply
- `sendMail` returns `202 Accepted` with no body, saves to Sent Items by default (`saveToSentItems`), and accepts JSON or base64 MIME (`Content-Type: text/plain`).
- Reply and createReply: specify either `comment` or `message.body`, **not both** (400). Honour the original `replyTo` recipients.

**Delta queries [OFF]**
- Sources: https://learn.microsoft.com/en-us/graph/delta-query-messages , /delta-query-events , /delta-query-overview
- Messages delta is **per folder**: `GET /me/mailFolders/{id}/messages/delta`.
  - Supports `$select`, `$top`, `$expand`.
  - `$filter` only `receivedDateTime ge|gt {value}`, and a filtered delta returns at most 5,000 messages.
  - `$orderby` only `receivedDateTime desc`. No `$search`.
  - Custom option `changeType=created|updated|deleted`.
  - `Prefer: odata.maxpagesize={x}`.
- Events delta in v1.0 only works on a **calendar view**: `GET /me/calendarView/delta?startDateTime=&endDateTime=`, with the window encoded in the token. `$select` is **not** supported. Unbounded calendar delta is beta-only.
- Token lifetime: for Outlook entities (message, event, todoTask, …) there is no fixed upper limit; it depends on cache size. An expired token returns 40X `syncStateNotFound`. **`410 Gone` plus a `Location` header** means restart a full sync.
- To Do: `GET /me/todo/lists/{id}/tasks/delta` [OFF].

**Immutable IDs [OFF]**
- Source: https://learn.microsoft.com/en-us/graph/outlook-immutable-id
- Send `Prefer: IdType="ImmutableId"` on requests, delta calls and subscription creation.
- The ID survives folder moves within a mailbox, but changes if the item moves to the archive mailbox.
- Existing subscriptions must be recreated to switch to immutable IDs. `translateExchangeIds` converts up to 1,000 IDs.

**Change notifications [OFF]**
- Source: https://learn.microsoft.com/en-us/graph/api/resources/subscription
- Maximum lifetimes:
  - Outlook `message`, `event`, `contact`: **10,080 min (under 7 days)**; 1,440 min with resource data.
  - `todoTask`: **4,230 min (under 3 days)**, global endpoint only.
- Values under 45 min are raised to 45 min. "In the future, any requests… beyond the maximum value will fail".
- `clientState` is required in practice; maximum 128 characters.
- Duplicate (`resource`, `changeType`) pairs return 409.
- Limit of 1,000 active Outlook subscriptions per mailbox across all apps.
- Supported paths [OFF] (https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview):
  - `/me/messages`, `/users/{id}/mailFolders/{id}/messages` (`Mail.ReadBasic` / `Mail.Read`);
  - `/me/events` (`Calendars.Read`);
  - personal Microsoft accounts are supported.
- **Validation** [OFF] (https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks):
  - Graph POSTs `?validationToken=…`; reply within **10 s** with `200`, `Content-Type: text/plain`, and the URL-decoded token as the body.
  - The `lifecycleNotificationUrl` is validated too.
- **Delivery:**
  - A 2xx within **3 s** counts as delivered. Recommendation: persist or queue and return `202`.
  - Otherwise Graph retries with exponential backoff for up to **4 h**, with a 10 s timeout on retries.
  - More than 10% of responses over 3 s in 10 min marks the endpoint "slow" (10-minute delay). More than 15% over 10 s marks it "drop", and notifications are lost unrecoverably for 10 minutes.
- **Lifecycle** [OFF] (https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events):
  - Event types `reauthorizationRequired`, `subscriptionRemoved`, `missed`. `subscriptionRemoved` and `missed` exist for message and event.
  - Handle reauthorization with `POST /subscriptions/{id}/reauthorize`, or a single `PATCH` with a new `expirationDateTime`.
  - **Do not send reauthorize and PATCH for the same subscription within 10 minutes.**
  - After `subscriptionRemoved` or `missed`, run a delta resync.
- **Latency** [OFF]: message average under 1 min (max 3 min); event unknown; todoTask under 2 min (max 15 min).

**Throttling [OFF]**
- Sources: https://learn.microsoft.com/en-us/graph/throttling , /throttling-limits , /json-batching
- `429` with `Retry-After` (seconds).
- Outlook limit per app per mailbox: **10,000 requests / 10 min, 4 concurrent requests, 150 MB upload / 5 min**.
- JSON batches hold at most **20** requests, and at most 4 run in parallel against Outlook.
- Subscription API limits: POST/PATCH/DELETE 2,000 per 20 s per app (500 per tenant); `GET /subscriptions` list only 40 per 20 s.

**To Do model [OFF]**
- Source: https://learn.microsoft.com/en-us/graph/api/resources/todo-overview
- Resources: `/me/todo/lists`, `/lists/{id}/tasks`, `checklistItems`, `linkedResources` (use for a back-link to our app).
- `todoTask.status` values: `notStarted | inProgress | completed | waitingOnOthers | deferred`. `importance`: `low | normal | high`. `dueDateTime` and `reminderDateTime` are `dateTimeTimeZone`.

**Revocation.** There is no RFC 7009 per-app revoke for delegated consent. `revokeSignInSessions` kills **all** of the user's sessions across all apps, so it is not appropriate. Removing the `oauth2PermissionGrant` needs admin-level permissions. Users remove consent themselves at https://account.live.com/consent/Manage (personal accounts) or https://myapps.microsoft.com (work accounts) **[verify URLs]**.

### Design implications
1. **App registration.** One multitenant plus personal-accounts registration ("Accounts in any organizational directory and personal Microsoft accounts").
   - Web platform redirect `https://api.<domain>/functions/v1/oauth-microsoft-callback`.
   - **Certificate credential.** Deno WebCrypto signs a `client_assertion` (RS256/PS256, `x5t#S256`) with the key taken from Edge secrets. Rotate before expiry; put the expiry date on a backoffice "Credential expiry" card.
   - Use tenant `common` for integrations.
   - For app login, use Supabase's Azure provider (tenant URL default `common`) with the `xms_edov` optional claim configured (see F).
2. **Scopes.** v2 accepts short names, which default to Graph.

   | Step | Scopes |
   |---|---|
   | Connect Outlook | `openid profile email offline_access User.Read Mail.Read` |
   | Microsoft Calendar | `Calendars.Read` |
   | To Do | `Tasks.Read` |
   | First approved send (progressive) | `Mail.Send` |
   | First approved calendar write | `Calendars.ReadWrite` |
   | Task write | `Tasks.ReadWrite` |

   - Each progressive step is a new authorize request (dynamic consent); the new refresh token covers all consented scopes.
   - **Reply implementation: `POST /me/messages/{immutableId}/reply` with `{message:{toRecipients?…}, comment:"<approved text>"}` (Mail.Send only). Never `createReply` (it needs Mail.ReadWrite). New mail goes through `sendMail`.**
3. **Work accounts.**
   - Detect `AADSTS65001` (consent required) and `AADSTS90094` or the "admin approval required" family → `status='admin_consent_required'`, UI: "Kurumunuzun yöneticisi bu uygulamaya onay vermeli." with a link to documentation. **[verify exact AADSTS codes during implementation]**
   - The explainer line "Kurumsal hesapta yalnızca sana verilen izinler kullanılır; şirket politikaların geçerli kalır." is consistent with delegated-only access; never use application permissions.
4. **Sync design.**
   - Mail: delta on the well-known folders `inbox` and `sentitems` with `$select=id,conversationId,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isRead,importance,flag,categories,hasAttachments,bodyPreview,parentFolderId`, `Prefer: IdType="ImmutableId", odata.maxpagesize=50`. Fetch `body` only for kept candidates.
   - Calendar: `calendarView/delta` over a rolling window [today−2 d, today+60 d], **re-baselined daily at about 03:00 in the user's local time**, because the window is fixed in the token.
   - Webhooks: subscribe to `me/mailFolders('inbox')/messages` and `me/mailFolders('sentitems')/messages` (`created,updated,deleted`) and `me/events` (`created,updated,deleted`), each with its own `clientState = random 64 chars` stored hashed, plus `lifecycleNotificationUrl`.
   - Expiration: now + 7 days − 1 h. Renew when fewer than 48 h remain.
   - To Do: poll delta every 15 min (webhook latency is up to 15 min anyway and lifetime is under 3 days). An optional subscription can be renewed daily.
5. **Webhook endpoint.** Use a **dedicated tiny Edge Function** `webhook-msgraph` (not the "fat" function, to keep cold start well under 3 s). It:
   - returns the validation echo in text/plain within 10 s;
   - checks `clientState` (constant-time compare against the hash);
   - `pgmq.send`s `{subscriptionId, resource, changeType}` and returns 202.
   - Lifecycle events run through the same function (separate path `?kind=lifecycle`).
6. **Throttling.** Per-mailbox limiter: at most 4 concurrent calls per connection (Postgres advisory lock slots) and a budget of about 8,000 requests per 10 min. On 429, sleep `Retry-After`. Batches of at most 20, using `dependsOn` only when order matters.
7. **Token refresh.** Refresh when fewer than 5 min remain. Always persist the new refresh token (it rotates each use). `invalid_grant` (inactivity over 90 days, admin revoke, etc.) → `needs_reauth` → **"Outlook bağlantısı yenilenmeli." / "Microsoft oturumu süresi doldu. Yeniden bağlanana kadar yeni mailler analiz edilmez."**, the same pattern as the Gmail design copy.
8. **Disconnect.** `DELETE /subscriptions/{id}` for each subscription → delete tokens and cursors → show "Microsoft hesabından erişimi tamamen kaldırmak için: account.live.com/consent/Manage" (personal) or "myapps.microsoft.com" (work). Record `revocation_mode='local_only'` in the audit.
9. **Blockers (manual):** Entra app registration; certificate; Partner One ID for publisher verification (not strictly required, but without it some tenants block user consent and all users see an "unverified" consent prompt). Microsoft has no mandatory security audit equivalent to CASA; Microsoft 365 App Compliance is optional.

---

## C. Apple (Sign in with Apple, EventKit, background)

### Facts

**App Review guideline 4.8 [OFF]**
- Source: https://developer.apple.com/app-store/review/guidelines/#login-services
- Apps that use a third-party login for the **primary account** must also offer an equivalent option that:
  - limits data collection to name and email;
  - lets the user keep their email private;
  - does not collect interactions for ads without consent.
- Exceptions: the company's own account system **exclusively**; education, enterprise or business apps requiring an existing account; government electronic ID; alternative marketplaces; clients for a specific third-party service.
- We offer Google and Microsoft login, so SIWA (or an equivalent) is required.

**Guideline 5.1.1(v) and the Apple support page [OFF]**
- Sources: https://developer.apple.com/app-store/review/guidelines/ and https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Account deletion must be available **in the app** and must delete the entire account and associated personal data; deactivation alone is insufficient.
- A link to a web page that completes deletion is allowed.
- Manual or delayed deletion is acceptable if the user is told how long it takes and receives a confirmation.
- Re-authentication or confirmation codes are allowed. Non-regulated apps must **not** require phone, email or support contact.
- Users with auto-renewing subscriptions must be told that billing continues and how to cancel.
- "Apps that support Sign in with Apple **should use the Sign in with Apple REST API to revoke user tokens**."

**Token revocation [OFF]**
- Source: https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens
- `POST https://appleid.apple.com/auth/revoke`, `content-type: application/x-www-form-urlencoded`.
- Parameters: `client_id` (App ID / Services ID, without the Team ID), `client_secret` (a JWT signed with the SIWA `.p8` key), `token`, `token_type_hint=refresh_token|access_token`.
- Returns 200 even if the token was already invalid.
- Revoking requires a refresh or access token.

**Token generation [OFF]**
- Source: https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens
- `POST https://appleid.apple.com/auth/token` with `grant_type=authorization_code` and `code` (**single use, valid 5 minutes**).
- `redirect_uri` is needed only if one was used in the authorization request; native flows have none.
- Response: `{access_token, token_type:"Bearer", expires_in:3600, refresh_token, id_token}`.

**Supabase and Apple [OFF]**
- Source: https://supabase.com/docs/guides/auth/social-login/auth-apple
- Native flow: `expo-apple-authentication` → `supabase.auth.signInWithIdToken({provider:'apple', token: identityToken, nonce})`.
- The full name is available **only on first authorization** (not in the ID token), so save it with `updateUser`.
- Every bundle ID variant (e.g. `.dev`, `.preview`) must be listed in "Client IDs". **The Services ID must be first if the web OAuth flow is also used.**
- **The OAuth/web flow requires regenerating the client secret every 6 months** (native-only does not).
- Supabase does not support Apple's server-to-server notification endpoint ("leave blank").

**EventKit (iOS 17+) [OFF]**
- Source: https://developer.apple.com/documentation/eventkit/accessing-the-event-store
- **Read-only access does not exist.** Reading requires full access: `requestFullAccessToEvents` or `requestFullAccessToReminders`.
- Write-only access (`requestWriteOnlyAccessToEvents`) returns a single virtual calendar and cannot read anything, not even events the app created.
- Info.plist keys: `NSCalendarsFullAccessUsageDescription` or `NSCalendarsWriteOnlyAccessUsageDescription`, and `NSRemindersFullAccessUsageDescription`. With only the old `NSCalendarsUsageDescription`, iOS 17 **auto-denies**. Keep the old keys as fallback for iOS 16 and earlier.
- EventKitUI (`EKEventEditViewController`) runs out of process and needs no calendar permission.

**expo-calendar (SDK 57) [OFF]**
- Sources: https://docs.expo.dev/versions/latest/sdk/calendar/ and CHANGELOG https://github.com/expo/expo/blob/main/packages/expo-calendar/CHANGELOG.md
- **Since 56.0.7 the object-oriented API is the root import; the legacy API moved to `expo-calendar/legacy`.**
- Reminders APIs (`listReminders`, `createReminder`, `requestRemindersPermissions`, `ExpoCalendarReminder`) are **iOS-only** and throw `UnavailabilityError` elsewhere.
- Config plugin options: `calendarPermission` (sets `NSCalendarsUsageDescription` and `NSCalendarsFullAccessUsageDescription`), `remindersPermission`, `writeOnlyCalendarPermission`, `writeOnlyAccess`.
- Android permissions: `READ_CALENDAR` and `WRITE_CALENDAR` (CalendarContract under the hood).
- 58.0.2 (2026-09-16) makes `getCalendars` work under iOS write-only access.

**expo-background-task [OFF]**
- Source: https://docs.expo.dev/versions/latest/sdk/background-task/
- Uses WorkManager on Android (**minimum interval 15 min**) and BGTaskScheduler on iOS (the system decides; there is no guarantee).
- Runs only with sufficient battery and network. **One worker per app**: every JS task shares it, and the last registered interval wins.
- iOS needs `UIBackgroundModes: processing` and `BGTaskSchedulerPermittedIdentifiers: com.expo.modules.backgroundtask.processing`. Not available in the Simulator.
- Android 16: JobScheduler/WorkManager runtime quotas are tied to the standby bucket (https://developer.android.com/about/versions/16/behavior-changes-all [OFF]).

**expo-secure-store [OFF]**
- Source: https://docs.expo.dev/versions/latest/sdk/securestore/
- iOS Keychain values **persist across uninstall and reinstall**.
- Values over about 2,048 bytes were historically rejected on some iOS releases.
- `accessGroup` (iOS) shares keychain items with extensions.
- Android Auto Backup must exclude SecureStore entries.

### Design implications
1. **Sign in with Apple on iOS.**
   - `rawNonce = random 32 bytes`. Pass `nonce: sha256hex(rawNonce)` (expo-crypto) to `AppleAuthentication.signInAsync({requestedScopes:[FULL_NAME, EMAIL], nonce})`, then `signInWithIdToken({provider:'apple', token: credential.identityToken, nonce: rawNonce})`.
   - The Supabase sample omits the nonce; add it.
   - **Also send `credential.authorizationCode` to Edge Function `apple-token-exchange` within 5 minutes.** It mints the client-secret JWT on the fly (ES256; `iss`=Team ID, `sub`=bundle ID, `aud`=`https://appleid.apple.com`, `exp` = now+5 min; `.p8` from secrets, so there is no 6-month rotation for the native path), calls `/auth/token`, and stores the **Apple refresh token encrypted**. It is used only for revocation at account deletion.
   - If the code exchange fails, retry on next sign-in; the deletion flow then falls back to prompting a re-sign-in to obtain a fresh code.
2. **Android and web users with Apple accounts.** A user who signed up with SIWA on iOS has no Apple button on Android unless we implement the web OAuth flow (Services ID, return URL, and client-secret JWT regeneration every 6 months, which is a manual or scheduled Management-API task).
   - Recommendation: offer "Apple ile devam et" on Android through `signInWithOAuth({provider:'apple'})` plus `openAuthSessionAsync`, and schedule secret rotation. Alternatively, allow email OTP to the relay address.
   - Either way, **register our outbound email domain and sender addresses in Apple's "Sign in with Apple for Email Communication"** (manual blocker). Otherwise OTP and deletion emails to `@privaterelay.appleid.com` are not forwarded.
3. **Optional (P2): Apple server-to-server notifications.** Our own Edge Function `apple-s2s` for `consent-revoked` / `account-delete` → mark the account and sign out sessions. Supabase will not handle it.
4. **Apple Calendar and Reminders are device-local.**
   - Ask for full access only when the user taps "Apple Takvim'i Bağla" (design card meta: **"iCloud · cihazdan okunur"**).
   - The app reads EventKit for the window [−1 d, +14 d] and uploads **minimal normalized fields** (title, start, end, all-day, location, attendee count, calendar name, a hash of `eventIdentifier` plus `calendarItemExternalIdentifier`, `lastModifiedDate`) on:
     - app foreground;
     - `EKEventStoreChanged` while running;
     - an expo-background-task tick (best effort).
   - Server briefings must show provenance: "Apple Takvim · son eşitleme 07:12".
   - **Document in KNOWN_PLATFORM_LIMITATIONS that a 08:00 server briefing can be stale for Apple and Android device calendars if the app has not run.**
   - Writes go through `EKEventEditViewController` (no write permission needed; the user saves) or `createEvent` after approval.
5. **Android device calendar.** CalendarContract through expo-calendar with `READ_CALENDAR`; the same snapshot-upload model.
6. **Keychain persists after reinstall.** On first launch, check a "first-run" flag in non-keychain storage. If absent, purge the Supabase session and any stale secure-store keys.
7. **Supabase session storage.** Store the session with the "LargeSecureStore" pattern (AES key in SecureStore, encrypted blob in MMKV/AsyncStorage). Supabase sessions easily exceed 2 KB.
8. **Blockers (manual):**
   - Apple Developer Program.
   - App ID with the Sign in with Apple capability.
   - SIWA key (`.p8`).
   - Services ID plus return URL, if the web/Android flow is used.
   - Private-relay email domain registration.
   - App Group `group.com.dijitalasistan.app`.
   - Keychain access group.
   - Time-Sensitive Notifications capability (see D).

---

## D. Push notifications

### Facts

**Expo Push Service [OFF]**
- Source: https://docs.expo.dev/push-notifications/sending-notifications/
- Endpoints: `POST https://exp.host/--/api/v2/push/send` (up to **100 messages per request**, gzip accepted) and `POST https://exp.host/--/api/v2/push/getReceipts` (up to **1,000 IDs**).
- Project rate limit: **600 notifications/sec** (`TOO_MANY_REQUESTS`).
- A ticket with status `ok` means only that Expo accepted it. **Check receipts about 15 min later; receipts are purged after 24 h.**
- Receipt errors:
  - `DeviceNotRegistered`: stop sending to that token.
  - `MessageTooBig`: payload over 4,096 bytes.
  - `MessageRateExceeded`: back off for that device.
  - `MismatchSenderId` / `InvalidCredentials`: fix credentials.
- Retry 429 and 5xx with exponential backoff.
- "Enhanced push security" requires `Authorization: Bearer <EAS access token>`; without it after enabling → `UNAUTHORIZED`.
- Message fields include:
  - `priority` (`default|normal|high`; high corresponds to APNs 10, normal to APNs 5, which Apple throttles);
  - `ttl` / `expiration`;
  - `interruptionLevel` (iOS: `active|critical|passive|time-sensitive`);
  - `relevanceScore`, `filterCriteria` (Focus), `threadId`, `collapseId`;
  - `channelId` (Android; **if the channel does not exist on the device, the notification is not shown**);
  - `categoryId`, `mutableContent`, `contentAvailable`, `richContent.image`, `tag`, `subtitle`, `badge`, `sound`.

**expo-notifications [OFF]**
- Sources: https://docs.expo.dev/versions/latest/sdk/notifications/ and `NotificationChannelManager.types.ts`
- Channel input includes `lockscreenVisibility: AndroidNotificationVisibility` (`UNKNOWN=0`, `PUBLIC=1`, `PRIVATE=2`, `SECRET=3`).
- iOS category option `previewPlaceholder` sets the hidden-previews body placeholder; also `categorySummaryFormat` and `showSubtitle`.
- **Android 13: the permission prompt appears only after at least one channel exists; call `setNotificationChannelAsync` before `getExpoPushTokenAsync`.**
- Exact-time local notifications need `SCHEDULE_EXACT_ALARM`. `USE_EXACT_ALARM` is restricted by Play to alarm, timer and calendar apps.
- The APNs entitlement switches to production automatically on release archives.

**Time Sensitive [OFF]**
- Source: https://developer.apple.com/documentation/usernotifications/unnotificationinterruptionlevel/timesensitive
- Quoted: "can break through system controls such as Notification Summary and Focus. The user can turn off the ability for time sensitive notification interruptions."
- Requires the capability / entitlement `com.apple.developer.usernotifications.time-sensitive` **[entitlement key from knowledge; page JSON not fetched]**.

**Android screen-share protection [OFF]**
- Source: https://developer.android.com/about/versions/15/behavior-changes-all
- Android 15 hides notification content during screen sharing; `setPublicVersion()` replaces it in insecure contexts.
- Expo remote push has no `publicVersion` or FCM `visibility` field. Channel-level `lockscreenVisibility` is what is available.

### Design implications
1. **Use the Expo Push Service**, not direct FCM/APNs, for all user notifications.
   - Enable enhanced push security.
   - Send from Edge Function `notifications-send` (a pgmq consumer).
   - Batch 100 per request; limit to at most 500/s.
   - Store tickets in `push_tickets(ticket_id, device_id, notification_id, sent_at)`.
   - pg_cron every 5 min pulls tickets older than 15 min in batches of 1,000 through getReceipts. On `DeviceNotRegistered`, set `devices.push_enabled=false, disabled_reason='DeviceNotRegistered'`.
   - Direct APNs is needed **only** for WidgetKit push (optional, see H).
2. **Device registry.**
   - `devices(installation_id PK, user_id, platform, expo_push_token, app_version, locale, tz, push_enabled, last_seen_at)`.
   - On login, re-bind the installation to the new user. On logout, `push_enabled=false` for that installation (server call) and **`signOut({scope:'local'})`** (see F).
3. **Android channels.** Create them at first launch with Turkish names; importance cannot be raised programmatically after creation.

   | Channel ID | Name | Importance | Lock screen |
   |---|---|---|---|
   | `brifing` | "Brifingler" | DEFAULT | PRIVATE |
   | `onemli_mail` | "Önemli e-postalar" | HIGH | **PRIVATE** |
   | `toplanti` | "Toplantılar" | HIGH | PRIVATE |
   | `hatirlatici` | "Hatırlatıcılar" | HIGH | PRIVATE |
   | `onay` | "Onay bekleyenler" | DEFAULT | PRIVATE |
   | `hesap` | "Hesap ve bağlantılar" | LOW | PUBLIC |
   | `bildirim_zekasi` | "Telefon bildirimleri özeti" | LOW | PRIVATE (Android only) |

4. **Privacy modes (§86)** are rendered on the server before sending. Default: **title only**.

   | Mode | Title | Body |
   |---|---|---|
   | `full` | "Ahmet Yılmaz · Revize teklif" | "Bugün 17:00'ye kadar yanıt bekliyor." |
   | `title_only` | "Önemli e-posta" | "Ahmet Yılmaz'dan yanıt bekleyen bir konu var." |
   | `generic` | "Dijital Asistan" | "Yeni bir güncellemen var." |

   - iOS categories set `previewPlaceholder: "Dijital Asistan güncellemesi"` so hidden previews stay neutral.
   - Never put mail body text in `data`; send only `{type, entity_id, deeplink}`.
5. **Interruption levels.**
   - `time-sensitive`: meeting starts in 10 min or less (Pro Meeting Prep); approval expiring; user-set smart reminders.
   - `active`: morning briefing ready.
   - `passive`: midday and evening digests.
   - Set `relevanceScore` from priority.
   - Add the Time Sensitive capability through the config plugin (`ios.entitlements`).
6. **Blockers (manual):**
   - EAS project.
   - APNs `.p8` key uploaded to EAS.
   - FCM v1 service-account JSON plus `google-services.json` uploaded to EAS.
   - EAS access token for push security (stored in Edge secrets).

---

## E. RevenueCat

### Facts
- **Webhooks** [OFF-S] (https://www.revenuecat.com/docs/integrations/webhooks):
  - Authorization header value is configured in the dashboard and sent on every request.
  - Respond within **60 s**. Otherwise RevenueCat retries **up to 5 times at 5, 10, 20, 40 and 80 minutes**, then stops.
  - Delivery is at-least-once and **unordered**.
  - Event `id` (and `event_timestamp_ms`) stay the same across retries; RevenueCat says to deduplicate on `id` [OFF-S].
  - RevenueCat recommends calling the REST API after a webhook to get current state.
- **Event types** [OFF-S] (https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields):
  - `TEST`, `INITIAL_PURCHASE`, `RENEWAL` (`is_trial_conversion`), `CANCELLATION` (`cancel_reason`), `UNCANCELLATION`, `NON_RENEWING_PURCHASE`, `SUBSCRIPTION_PAUSED`, `EXPIRATION` (`expiration_reason`), `BILLING_ISSUE`, `PRODUCT_CHANGE`, `TRANSFER` (`transferred_from[]`, `transferred_to[]`, **no `app_user_id`**), `SUBSCRIPTION_EXTENDED`, `TEMPORARY_ENTITLEMENT_GRANT` (store outage; short-term grant), `REFUND_REVERSED`, `INVOICE_ISSUANCE`, `VIRTUAL_CURRENCY_TRANSACTION`.
- **Common fields** [SEC] (https://github.com/puzzmo-com/revenue-cat-webhook-types):
  - `id`, `app_id`, `app_user_id`, `original_app_user_id`, `aliases[]`, `product_id` (Play products created after Feb 2023 use `<subscription_id>:<base_plan_id>`), `entitlement_ids[]`, `period_type`, `purchased_at_ms`, `expiration_at_ms`, `store` (`APP_STORE|PLAY_STORE|PROMOTIONAL|STRIPE|AMAZON|MAC_APP_STORE`), `environment` (`SANDBOX|PRODUCTION`), `is_family_share`, `transaction_id`, `original_transaction_id`, `offer_code`, `price`, `country_code`.
  - `cancel_reason` / `expiration_reason`: `UNSUBSCRIBE | BILLING_ERROR | DEVELOPER_INITIATED | PRICE_INCREASE | CUSTOMER_SUPPORT | UNKNOWN`, plus `SUBSCRIPTION_PAUSED` for expiration.
- **REST API v2** [OFF-S] (https://www.revenuecat.com/docs/api-v2):
  - `GET /v2/projects/{project_id}/customers/{customer_id}` always includes `active_entitlements`; `attributes` is expandable.
  - Requires a **v2 secret key** (e.g. `customer_information:customers:read`); v1 keys do not work.
  - Rate limit about 60 requests/min, returned in headers; 429 → back off.
  - Grants [SEC]: `POST /v2/projects/{pid}/customers/{cid}/actions/grant_entitlement` (`entitlement_id`, `expires_at` in ms; returns 201) and `.../actions/revoke_granted_entitlement` (200). Grants show up with store `PROMOTIONAL`.
- **Identity** [OFF-S] (https://www.revenuecat.com/docs/customers/identifying-customers):
  - Pass `appUserID` in `configure()` only when it is already known; use `Purchases.logIn()` / `logOut()` for later changes.
  - Anonymous `$RCAnonymousID` values get aliased.
  - Project "transfer behavior" decides what happens on restore under a different App User ID.
- **Test Store** [OFF-S] (https://www.revenuecat.com/docs/test-and-launch/sandbox/test-store):
  - Provisioned automatically. Uses a `test_…` API key and a simulated purchase sheet (success, failure, cancel).
  - Real entitlements and `CustomerInfo` updates, with no store setup.
  - The sandbox-access setting can be limited to "Allowed App User IDs only".
- Versions: react-native-purchases 10.10.1 (peer react-native ≥0.73).

### Design implications
1. **SDK setup.**
   - Configure only after the Supabase session exists: `Purchases.configure({apiKey: Platform.select({ios: RC_APPLE_KEY, android: RC_GOOGLE_KEY}), appUserID: session.user.id})`.
   - On account switch: `Purchases.logIn(newUserId)`. On logout: `Purchases.logOut()` (catch the "anonymous" error).
   - Dev and demo mode use the **Test Store key** (§89), so paywall flows work without store credentials.
2. **Store setup.**
   - Entitlement `pro`. Offering `default` with packages `$rc_monthly` → `da_pro_monthly` and `$rc_annual` → `da_pro_annual`.
   - App Store: subscription group "Dijital Asistan Pro".
   - Play: subscriptions `da_pro_monthly` (base plan `monthly`) and `da_pro_annual` (base plan `annual`). RevenueCat IDs become `da_pro_monthly:monthly` and so on.
   - Show "X gün ücretsiz dene" **only** if `product.introPrice` (iOS) or a free-trial phase in `subscriptionOptions` (Android) exists.
   - Restore: `Purchases.restorePurchases()`.
   - Manage: `Purchases.showManageSubscriptions()`, or open `customerInfo.managementURL`.
3. **Webhook ingest.** Edge Function `webhook-revenuecat`, with `verify_jwt=false` and `withSupabase({auth:'none'})`:
   1. Constant-time compare of `Authorization` against the secret.
   2. `INSERT … ON CONFLICT (event_id) DO NOTHING` into `billing_events` (raw JSON, received_at).
   3. Enqueue and return 200 quickly.
   4. The worker ignores `environment='SANDBOX'` in production unless the user is an allow-listed tester.
   5. It then **fetches `GET /v2/.../customers/{app_user_id}` and overwrites `store_subscription_state(user_id, entitlement 'pro', active, expires_at, store, product_id, period_type, will_renew, billing_issue_at, last_event_id, synced_at)`**. It never applies events incrementally, because they arrive out of order.
   6. For `TRANSFER`, recompute state for every ID in `transferred_from` and `transferred_to`.
4. **Grants: keep referral and admin grants in our own database; do not use RevenueCat promotional grants by default.** Reasons:
   - §43 requires store status to be kept separate from referral/admin grants.
   - Anti-abuse and audit (§45, §61) need our own records.
   - It avoids `PROMOTIONAL` entries polluting RevenueCat revenue metrics.

   Implementation:
   - Table `entitlement_grants(id, user_id, entitlement='pro', source ENUM('referral_referrer','referral_referee','admin','support','compensation'), starts_at, ends_at, reason, granted_by_admin_id, idempotency_key UNIQUE, revoked_at, revoked_by)`.
   - Referral reward is **+14 gün** (design 07 "Arkadaşını Davet Et · +14 gün"). Idempotency key `referral:{referral_id}:{side}`.
   - `effective_entitlement(user) = store_active OR exists(active grant)`, computed in SQL (view or function) and returned by `GET /me/entitlements`. Stack grant periods after the end of the current grant.
   - The client gates features on our endpoint (cached), while server-side checks (§44) use the same function.
   - A mirroring flag `mirror_grants_to_revenuecat` (default off) can use `grant_entitlement` later if RevenueCat paywall targeting needs it.
5. **Account deletion.** Delete or anonymise the RevenueCat customer (v1 `DELETE /v1/subscribers/{id}` or the v2 customer delete **[verify endpoint]**). Tell the user the store subscription continues until cancelled (Apple requirement).
6. **Blockers (manual):**
   - App Store Connect agreements (Paid Apps, tax, banking).
   - Play Console payments profile.
   - Products created and "Ready to Submit".
   - App Store Connect In-App Purchase key and Play service account in RevenueCat.
   - RevenueCat v2 secret key and webhook Authorization secret in Edge secrets.

---

## F. Supabase

### Facts

**Native ID-token sign-in [OFF]**
- Sources: https://supabase.com/docs/reference/javascript/auth-signinwithidtoken and supabase-js `types.ts`
- `signInWithIdToken` supports `provider: 'google'|'apple'|'azure'|'facebook'|'kakao'|'custom:<id>'`, plus `token`, optional `access_token` (for `at_hash`) and `nonce`.
- Google native (Expo): `@react-native-google-signin/google-signin` with `webClientId`; register the Web, iOS and Android client IDs in the provider's "Client IDs".
- Nonce validation is on by default; "Skip nonce check" exists only for libraries that cannot handle nonces.
- Source: https://supabase.com/docs/guides/auth/social-login/auth-google

**Azure provider [OFF]**
- Source: https://supabase.com/docs/guides/auth/social-login/auth-azure
- Default tenant is `common`. Use `consumers` or a tenant URL for restricted registrations.
- **The `email` scope is required.**
- Configure the `xms_edov` optional claim so unverified email domains cannot impersonate existing accounts.

**Email OTP [OFF]**
- Source: https://supabase.com/docs/guides/auth/auth-email-passwordless
- Six-digit `{{ .Token }}` in the email template. `verifyOtp({email, token, type:'email'})`. `shouldCreateUser`.
- Expiry is configurable; more than 86,400 s is discouraged.
- **The built-in SMTP delivers only to project team members and is heavily rate-limited, so custom SMTP is required.** After enabling custom SMTP the limit starts at 30 emails/hour and must be raised.
- Source: https://supabase.com/docs/guides/auth/auth-smtp

**Custom access token hook [OFF]**
- Source: https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook
- Required claims: `iss, aud, exp, iat, sub, role, aal, session_id, email, phone, is_anonymous`.
- Optional: `jti, nbf, app_metadata, user_metadata, amr`.
- The hook can trim the JWT.

**MFA [OFF]**
- Source: https://supabase.com/docs/guides/auth/auth-mfa
- TOTP and phone factors. The `aal` claim is `aal1` or `aal2`.
- Enforce with a **restrictive** RLS policy: `using ((select auth.jwt()->>'aal') = 'aal2')`.
- Unenrolling downgrades to `aal1` only after refresh.

**Sessions [OFF]**
- Source: https://supabase.com/docs/guides/auth/sessions
- **Time-boxed sessions, inactivity timeout and single-session-per-user are Pro-plan, project-wide settings.** They are enforced on the next refresh, so the real duration is timeout plus JWT expiry.
- JWT expiry default 1 h; do not go below 5 min.
- Refresh-token reuse interval is 10 s.

**Sign-out [OFF]**
- Source: https://supabase.com/docs/guides/auth/signout
- Scopes `global` (**the JS default**), `local`, `others`. A global sign-out on one device kills every device's refresh token.

**API keys [OFF]**
- Source: https://supabase.com/docs/guides/getting-started/api-keys
- **Legacy `anon` and `service_role` keys are deprecated by the end of 2026.** Use `sb_publishable_…` (client) and `sb_secret_…` (server; bypasses RLS).
- Edge Functions should use `@supabase/server` `withSupabase({auth:'user'|'secret'|'secret:<name>'|'publishable:<name>'|'none'|[…]})`.
  - `verify_jwt=true` for user calls.
  - `verify_jwt=false` for cron and pg_net calls (secret key in the `apikey` header) and for external webhooks (`auth:'none'` plus provider signature check).
  - Source: https://supabase.com/docs/guides/functions/auth

**Edge Function limits [OFF]**
- Source: https://supabase.com/docs/guides/functions/limits
- 256 MB memory.
- Wall clock **150 s on Free, 400 s on paid**. **CPU 2 s per request** (async I/O not counted). Response timeout 150 s.
- Function size 20 MB (CLI bundle) or 5 MB (server-side bundle). 100 functions on Free.
- **Secrets: at most 100 per project, 48 KiB each, and names cannot start with `SUPABASE_`.**
- Outbound ports 25 and 587 are blocked (use an HTTPS email API, not SMTP).
- No Web Workers, no Node `vm`, no multithreaded native libraries (e.g. `sharp`).

**Background tasks [OFF]**
- Source: https://supabase.com/docs/guides/functions/background-tasks
- `EdgeRuntime.waitUntil(promise)` keeps the instance alive after the response, still bounded by the limits above.
- `addEventListener('beforeunload', …)` reports the shutdown reason.

**Dependencies and shared code**
- Per-function `deno.json` is recommended (import maps are legacy) [OFF] (https://supabase.com/docs/guides/functions/dependencies).
- Shared code goes in `supabase/functions/_shared` [OFF] (https://supabase.com/docs/guides/functions/development-tips).
- **Since CLI 2.13.3, Edge Functions can import files outside `supabase/`, from `index.ts` or `deno.json`, which fits monorepos.** Use `supabase functions deploy --use-api` (no Docker; recommended for CI) [OFF-S] (https://supabase.com/changelog/33613-…).

**Cron [OFF]**
- Source: https://supabase.com/docs/guides/cron
- pg_cron; schedules from every second to once a year. Sub-minute syntax `'[1-59] seconds'` (Postgres 15.1.1.61 or later).
- **At most 8 concurrent jobs; each at most 10 minutes.**
- History in `cron.job_run_details`. Schedules run in **UTC/GMT**.
- Calling a function: `net.http_post(url := project_url || '/functions/v1/<fn>', headers := …)`, with URL and key read from `vault.decrypted_secrets`.
- Source: https://supabase.com/docs/guides/functions/schedule-functions [OFF]

**Queues [OFF]**
- Sources: https://supabase.com/docs/guides/queues , /queues/api , /queues/pgmq
- pgmq with "guaranteed delivery" and "exactly once within a visibility window".
- `pgmq_public.send(queue, message, sleep_seconds)`, `send_batch`, `read(queue, sleep_seconds = VT, n)`, `pop`, `archive`, `delete`.
- Extension-level functions: `pgmq.read_with_poll`, `set_vt`, batch `archive(queue, msg_ids[])`. `read_ct` is exposed on each message.
- **No built-in dead-letter queue.**

**Vault and pgsodium [OFF]**
- Sources: https://supabase.com/docs/guides/database/vault and https://supabase.com/docs/guides/database/extensions/pgsodium
- Vault: AEAD (libsodium); the per-project root key lives outside the database, and **the Management API can return the 64-char hex root key**. Plaintext is readable through the `vault.decrypted_secrets` view.
- **pgsodium is "pending deprecation"; Supabase does not recommend its Server Key Management or Transparent Column Encryption.** Vault does not depend on it.

**pgvector [OFF]**
- Sources: https://supabase.com/docs/guides/database/extensions/pgvector and /ai/vector-indexes/hnsw-indexes
- `vector` indexes up to 2,000 dimensions; `halfvec` up to 4,000.
- HNSW is the default choice. From pgvector 0.8.0: `hnsw.iterative_scan` (default off), `hnsw.max_scan_tuples=20000`, `hnsw.scan_mem_multiplier`. Iterative scans fix filtered queries returning fewer rows than the LIMIT.

**Storage [OFF]**
- Source: https://supabase.com/docs/guides/storage/security/access-control
- RLS on `storage.objects`; upload needs INSERT (upsert also needs SELECT and UPDATE).
- Per-user folder pattern: `(storage.foldername(name))[1] = (select auth.jwt()->>'sub')`.
- `createSignedUrl(path, seconds)`. Signed URLs use a separate signing key, **survive Auth key rotation, and cannot be revoked except through support**, so keep expiries short.

**Database webhooks [OFF]**
- Source: https://supabase.com/docs/guides/database/webhooks
- AFTER INSERT/UPDATE/DELETE triggers that call `supabase_functions.http_request` through **pg_net (asynchronous)**.
- Call logs live in the `net` schema.

### Design implications
1. **App auth.**
   - iOS: Apple (native), Google (native), Microsoft, email OTP.
   - Android: Google (native), Microsoft, Apple (web OAuth; see C), email OTP.
   - Microsoft login: `signInWithOAuth({provider:'azure', options:{scopes:'email', redirectTo:'dijitalasistan://auth/callback', skipBrowserRedirect:true}})` + `openAuthSessionAsync` + `exchangeCodeForSession` with `flowType:'pkce'`.
   - **Integration tokens never come from Supabase `provider_token`** (§88: app login and integrations are separate).
   - Mobile logout uses **`signOut({scope:'local'})`**. "Tüm cihazlardan çıkış yap" in Security settings uses `global`.
   - Use the new publishable and secret keys from day one.
2. **Backoffice security boundary.** Same Supabase project, but:
   - Admins are listed in `admin_users(user_id, role, active, mfa_required=true)`.
   - The custom access token hook adds `admin_role` **only** if the row is active.
   - Every admin RPC and function requires `aal2` **and** `admin_role`, enforced with restrictive policies and checks inside functions.
   - The backoffice is a Next.js server-side app with an httpOnly cookie on its own domain.
   - **Implement admin inactivity timeout (e.g. 30 min) and an absolute limit (e.g. 12 h) in the backoffice app.** Middleware tracks last activity and calls `signOut` / revokes `session_id` through an admin function. The project-wide Pro settings would also log out mobile users.
   - A separate Supabase project for admin auth is the higher-isolation alternative (costlier; cross-project data access through a secret key).
3. **OAuth token encryption: use application-level AES-256-GCM in Edge Functions, not Vault.**
   - Table `provider_credentials(connection_id PK, key_version smallint, iv bytea(12), ciphertext bytea, aad_hash, created_at, rotated_at)`.
   - AAD = `connection_id || provider || token_kind`, which binds each ciphertext to its row.
   - Keys come from Edge secrets `TOKEN_ENC_KEY_V1`, `TOKEN_ENC_KEY_V2`, … (base64, 32 bytes) plus `TOKEN_ENC_ACTIVE_VERSION`.
   - Rotation: decrypt with the stored version and re-encrypt with the active version on each refresh; a nightly job re-encrypts the rest; retire the old key once the count reaches 0.
   - The table is RLS-denied to every role except a `SECURITY DEFINER` function called with the secret key. Nothing decrypts in SQL.
   - Why not Vault: plaintext is reachable from SQL (any SQL-injection or leak of the secret key exposes everything), Supabase holds the key, and Vault is meant for a few project-level secrets.
   - **Use Vault only for** the `project_url` and cron secret key that pg_cron/pg_net need.
4. **Jobs.**
   - Queues: `provider_sync`, `webhook_ingest`, `ai_pipeline`, `notification_send`, `push_receipts`, `billing_events`, `account_deletion`, `widget_snapshot`.
   - pg_cron at 10–30 s calls worker function(s) (`auth:'secret:automations'`). Each call `read(queue, vt=120–300, n=10–25)`, processes within the 150/400 s wall clock and 2 s CPU, then `delete` on success.
   - On failure, leave the message so the visibility timeout triggers a retry. **If `read_ct > 5`, `archive` it and insert a `job_dead_letters` row** (payload hash, last error, attempts) for the backoffice Sync and Jobs screen (§53).
   - Keep 8 or fewer concurrent cron jobs.
   - Idempotency keys: `briefing:{user}:{local_date}:{kind}`, `sync:{connection}:{cursor}`, `notify:{notification_id}`.
5. **Timezone and DST scheduling.**
   - One dispatcher every minute: `select users where (now() at time zone tz)::time >= briefing_time and not exists briefing_run(user, local_date, kind)`.
   - Insert `briefing_runs` with a UNIQUE key, then enqueue.
   - This handles DST without per-user cron entries. Weekly review uses local ISO week plus weekday.
6. **Monorepo.**
   - Keep `supabase/functions/<fn>/deno.json` per function.
   - Import `packages/domain` and `packages/validation` through a relative path or an `imports` entry in `deno.json`. This works with CLI 2.13.3+ and `--use-api`, but those packages **must be Deno-compatible**: pure TypeScript, ESM, `.ts` extensions or bundler resolution, and no Node-only APIs.
   - Webhook functions stay tiny and separate. Workers can be "fat".
7. **AI memory.** pgvector HNSW `vector_cosine_ops`. Set `hnsw.iterative_scan = relaxed_order` for user-filtered searches; every embedding row carries `user_id`, enforced by RLS.
8. **Files.**
   - Private buckets `capture` and `attachments`, with per-user folder RLS.
   - Signed URLs of 60–300 s for viewing. Never cache signed URLs in widgets or notifications.
9. **Blockers (manual):**
   - Pro plan (custom domain add-on, longer wall clock, session controls if ever used).
   - Custom domain DNS.
   - Custom SMTP provider (Resend, Postmark or SES over HTTPS), with SPF, DKIM and DMARC.
   - Secrets provisioning.

---

## G. Android NotificationListenerService

### Facts
- **API reference [OFF]** (https://developer.android.com/reference/android/service/notification/NotificationListenerService):
  - The service must require `android.permission.BIND_NOTIFICATION_LISTENER_SERVICE`, with intent-filter action `android.service.notification.NotificationListenerService`, and must be `exported="true"`.
  - Filter meta-data: `android.service.notification.default_filter_types` (pipe-separated `conversations|alerting|silent|ongoing` or ints) and `android.service.notification.disabled_filter_types`.
  - Filter constants (API 31): `FLAG_FILTER_TYPE_CONVERSATIONS=1`, `ALERTING=2`, `SILENT=4`, `ONGOING=8`.
  - `requestRebind(ComponentName)`, `requestUnbind()`, `getActiveNotifications()`, `onListenerConnected()`, `onNotificationPosted`, `onNotificationRemoved`.
- **Settings intents [OFF]** (https://developer.android.com/reference/android/provider/Settings):
  - `ACTION_NOTIFICATION_LISTENER_SETTINGS` (API 22).
  - **`ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS` (API 30) with `EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME`** opens our component's toggle directly.
  - Check the grant with `NotificationManager.isNotificationListenerAccessGranted(ComponentName)` or `NotificationManagerCompat.getEnabledListenerPackages()`.
- **Android 15 [OFF]** (https://developer.android.com/about/versions/15/behavior-changes-all):
  - Quoted: "Android will stop untrusted apps that implement a NotificationListenerService from reading unredacted content from notifications where an OTP has been detected." Trusted apps (e.g. companion device manager associations) are exempt.
  - Notifications are also hidden during screen sharing.
- **Android 17 [OFF]** (https://developer.android.com/about/versions/17/behavior-changes-all and /behavior-changes-17):
  - SMS OTP protection extends to WebOTP-format SMS for all apps, and to standard SMS for apps targeting API 37: a 3-hour delay for non-default-SMS apps.
  - Background audio hardening (relevant to §25 Voice).
- **Restricted settings [SEC]**
  - Sources: https://www.xda-developers.com/android-13-restricted-setting-notification-listener/ and https://www.androidauthority.com/android-15-restricted-settings-sideloading-3481098/
  - Since Android 13, **sideloaded APKs cannot enable notification access until the user taps "Allow restricted settings"** in App info. Android 15 widened the list.
  - Play-installed apps are unaffected.
- **Google Play policy [SEC/verify]:** I found no dedicated Play Console declaration form for notification listeners (unlike SMS/Call Log, Accessibility, `QUERY_ALL_PACKAGES`, exact alarm and FGS types). The User Data policy's **prominent disclosure plus affirmative consent** and accurate **Data safety** answers apply. Verify at https://support.google.com/googleplay/android-developer/answer/10144311 before submission.
- **Package names confirmed via Play listings or third-party mirrors [SEC]:**
  - `tr.gov.turkiye.edevlet.kapisi` (e-Devlet)
  - `com.vakifbank.mobile`
  - `com.tmobtech.halkbank`
  - `com.denizbank.mobildeniz`
  - `com.garanti.cepsubesi`
  - `com.pozitron.iscep` (İşCep)
  - `com.ykb.android`
  - `com.akbank.android.apps.akbank_direkt`
  - `com.ziraat.ziraatmobil`

### Design implications
1. **Native module.** Local Expo module `modules/notification-intelligence` (Kotlin):
   - `DANotificationListenerService` with meta-data `default_filter_types="conversations|alerting"` and `disabled_filter_types="ongoing|silent"`.
   - JS API: `isGranted()`, `openSettings()` (DETAIL intent on API 30+, otherwise the list intent), `getRecentSignals()`, `setMode('all'|'selected')`, `setAllowedPackages([])`, `disable()` (calls `requestUnbind`).
   - A `onGrantChanged` event re-checks the grant on every app resume.
   - The prototype's in-app "Bildirim Erişimi" toggle (secondary `AndroidNotifications.tsx`) is **fake local state; it must reflect the real system grant.**
2. **On-device processing is mandatory to keep the design's promises** ("Bildirim erişimi cihazda işlenir", "Mesaj içerikleri asla saklanmaz").
   - Kotlin rules extract **structured signals only**: `{package, app_label, category: cargo|bank_payment|flight|reservation|other, amount?, currency?, due_date?, tracking_status?, flight_no?, gate?, posted_at, signal_hash}`.
   - Raw `EXTRA_TITLE` and `EXTRA_TEXT` are never persisted or uploaded. An in-memory buffer holds at most N items and at most 24 h, in encrypted Room/SQLCipher or EncryptedFile.
   - If server AI is ever used on raw text, **the copy must change**. Flag this for the plan.
3. **Always excluded, shown as a locked row "Güvenlik uygulamaları her zaman hariç tutulur":**
   - authenticators: `com.google.android.apps.authenticator2`, `com.azure.authenticator`, `com.authy.authy`, `com.duosecurity.duomobile`, `com.okta.android.auth`, `com.twofasapp`, `com.beemdevelopment.aegis`;
   - password managers: `com.x8bit.bitwarden`, `com.agilebits.onepassword`, `com.lastpass.lpandroid`, `com.proton.pass`;
   - `com.google.android.gms` (sign-in / verification prompts);
   - e-Devlet `tr.gov.turkiye.edevlet.kapisi`;
   - our own package.
4. **Default off ("önerilmez", design 02):** messaging apps `com.whatsapp`, `org.telegram.messenger`, `com.turkcell.bip`, and SMS apps `com.google.android.apps.messaging`, `com.samsung.android.messaging`.
5. **Default on, with content filtering:** banks (design: "Banka · Ödeme ve son tarih bildirimleri", on), cargo (Trendyol, Hepsiburada, Yurtiçi) and airlines (THY, Pegasus).
   - Bank notifications carry OTPs. Android 15+ redacts OTP-detected content for us, **but Android 10–14 does not**.
   - Add an OTP detector that drops the notification entirely: 4–8 digit tokens near `kod|şifre|doğrulama|onay kodu|OTP|code|verification|tek kullanımlık`.
   - Also drop `VISIBILITY_SECRET` notifications and `CATEGORY_CALL`.
   - The remaining package IDs (QNB `com.finansbank.mobile.cepsube`, ING `com.ingbanktr.ingmobil`, TEB, Kuveyt Türk, Enpara, etc.) need **verification against Play before shipping.** Keep the list in remote config (backoffice feature flag) so it can be updated without a release.
6. **App list for "Seçili uygulamalar".** Use `<queries><intent><action MAIN/><category LAUNCHER/></intent></queries>`, **not `QUERY_ALL_PACKAGES`** (that one needs a Play declaration).
7. **Onboarding.** Prominent-disclosure screen (design 2.13 copy) → "Bildirim Erişimini Aç" → the DETAIL settings intent.
   - For internal APK testers, show help text: "Uygulama bilgisi → ⋮ → Kısıtlı ayarlara izin ver".
   - Entitlement: Pro-only (§44). Gate server-side on signal ingest as well.
8. **Documentation.** `KNOWN_PLATFORM_LIMITATIONS.md` must record that iOS has no equivalent: the step is hidden on iOS, with no fake UI.

---

## H. Widgets and share

### Facts
- **WidgetKit refresh budget [OFF]** (https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date):
  - Quoted: "a daily budget typically includes from 40 to 70 refreshes… roughly… every 15 to 60 minutes". The budget is per widget instance.
  - Timeline entries should be at least about 5 min apart.
  - Reloads requested while the app is in the foreground do not count against the budget.
  - Use `reloadAllTimelines` / `reloadTimelines(ofKind:)` when data changes.
- **WidgetKit push [OFF]** (https://developer.apple.com/documentation/widgetkit/updating-widgets-with-widgetkit-push-notifications):
  - Uses a `WidgetPushHandler` token and is sent **directly through APNs** (not the User Notifications framework, not broadcast channels).
  - Budgeted and opportunistic.
- **Memory limits [SEC]** (Apple Developer Forums threads 713561 and 115259; https://blog.kulman.sk/dealing-with-memory-limits-in-app-extensions/):
  - Widget extensions: about **30 MB**.
  - **Share extensions: about 120 MB** (`EXC_RESOURCE … limit=120 MB`). The limit is disabled in the Simulator.
- **expo-widgets [OFF]** (https://docs.expo.dev/versions/latest/sdk/widgets/):
  - First-party, **iOS only**; home-screen widgets and Live Activities written with `@expo/ui/swift-ui` components.
  - Config plugin `widgets[]` with `ios.supportedFamilies`: `systemSmall|systemMedium|systemLarge|accessoryCircular|accessoryRectangular|accessoryInline`.
  - `groupIdentifier` defaults to `group.<bundle id>`.
  - API: `Widget.updateSnapshot(props)`, `updateTimeline([...])`, `reload()`, `widgetsDirectory` (shared images).
  - Widget code runs in an isolated runtime (no hooks, no async). Interactive `Button` requires iOS 17.
  - `@expo/ui` modifiers include `widgetURL`, `redacted`, `unredacted`, `privacySensitive`.
- **Android app widgets [OFF]** (https://developer.android.com/develop/ui/views/appwidgets/advanced):
  - Quoted: "`updatePeriodMillis` doesn't support values of less than 30 minutes". Use 0 plus WorkManager for custom intervals.
  - `onUpdate` in a BroadcastReceiver has about 10 s before the receiver is treated as unresponsive.
  - **Android 17 (target API 37): RemoteViews bitmaps plus icons are capped at 1.5 × screen width × screen height × 4 bytes; exceeding it throws a fatal `IllegalArgumentException`** [OFF] (behavior-changes-17).
- **Share libraries.**
  - expo-share-intent 8.0.1 supports SDK 57 [OFF-README]. It is a native share extension that **redirects to the main app**. It handles text, URL, image, video and files through `iosActivationRules` (`NSExtensionActivationSupportsText`, `…WebURLWithMaxCount`, `…ImageWithMaxCount`, `…FileWithMaxCount`), `iosAppGroupIdentifier` and `androidIntentFilters` / `androidMultiIntentFilters` (ACTION_SEND / ACTION_SEND_MULTIPLE).
  - expo-share-extension (React Native inside the extension) documents support only up to SDK 54.

### Design implications
1. **iOS widgets** via expo-widgets.
   - Families: `systemSmall`, `systemMedium`, `systemLarge`, `accessoryCircular`, `accessoryRectangular`, `accessoryInline` (design 08: small, medium, large plus lock-screen circular, rectangular and inline).
   - App Group `group.com.dijitalasistan.app`.
   - The app calls `updateSnapshot` / `updateTimeline` with a **privacy-filtered snapshot**: counts, the next event time, and titles only if the privacy mode allows. Lock-screen variants use `privacySensitive()` on names and subjects (e.g. "Mehmet ile toplantı" becomes a redacted placeholder when locked).
   - Triggers: app foreground, sync completion (while running), and an expo-background-task tick. Timeline entries are pre-computed for known event boundaries.
   - Each view uses `widgetURL('dijitalasistan://today')` or a per-row deep link.
   - **Widgets are read-only** (design 08: "yazma işlemi widget'tan yapılmaz"), so do not use interactive Buttons.
   - WidgetKit push via direct APNs is optional P2; it needs APNs token auth in an Edge Function.
   - Fallback if expo-widgets is too limited: `@bacons/apple-targets` 5.0.0 plus SwiftUI reading App Group `UserDefaults(suiteName:)`.
2. **Android widgets** (2×2 and 4×2).
   - react-native-android-widget 0.22.1, or native Jetpack Glance if richer layout is needed.
   - `targetCellWidth/Height` of 2×2 and 4×2 (API 31+), `updatePeriodMillis=0`, WorkManager refresh, snapshot in SharedPreferences written by the app.
   - `PendingIntent` must be `FLAG_IMMUTABLE`; clicks open deep links.
   - Stay under the Android 17 RemoteViews bitmap cap (no large images) and use the system corner radius.
3. **Share, iOS.**
   - Use expo-share-intent. Payloads (text, URL, image, PDF) land in the App Group container, then Universal Capture processes them in the main app through the shared domain layer (§27–28).
   - Downsample images before holding them in memory (120 MB limit) and pass files by URL, never as base64 in memory.
   - **Flag:** extensions opening the containing app rely on a responder-chain `openURL` workaround that Apple does not document. It is widely shipped but is an App Review risk.
   - Fallback: a custom Swift extension with a small SwiftUI confirmation ("Dijital Asistan'a eklendi") that writes to the App Group and uploads in the background with a short-lived capture token from the shared keychain (`expo-secure-store` `accessGroup`).
4. **Share, Android.** ACTION_SEND and ACTION_SEND_MULTIPLE filters for `text/*`, `image/*`, `application/pdf`. **Copy `content://` URIs immediately**, because the read grant is temporary.

---

## X. Cross-cutting decisions

### 1. Provider adapter contract (packages/domain)
```ts
interface ProviderAdapter {
  kind: 'google'|'microsoft'|'apple_device'|'android_device'
  capabilities: Capability[]
  buildAuthUrl(capability, state, pkce): URL
  exchangeCode(code, verifier): TokenSet
  refresh(conn): TokenSet
  revoke(conn): RevokeResult
  initialSync(conn, resource, window)
  incrementalSync(conn, resource, cursor): { items, nextCursor, resyncRequired }
  subscribe(conn, resource): Subscription
  renew(sub)
  unsubscribe(sub)
  send?(conn, draft)
  writeEvent?(conn, proposal)
  writeTask?(conn, proposal)
}
```
- Cursors are stored per `(connection_id, resource)`:
  - Gmail `historyId`
  - Google Calendar `syncToken` per calendar
  - Google Tasks `updatedMin`
  - Graph `deltaLink` per folder or calendar
  - To Do `deltaLink` per list
- Dedupe keys:
  - Gmail `(connection, message.id)`, thread `threadId`
  - Graph immutable `id`, thread `conversationId`
  - `internetMessageId` for cross-account duplicates
  - events: `(connection, calendar_id, event.id)`, plus `iCalUID` for cross-provider duplicates
  - EventKit: `calendarItemExternalIdentifier`

### 2. Connection state machine
`connecting → active | partial (scope missing) → degraded (sync_delayed) → needs_reauth | admin_consent_required → revoked | disconnected`

UI copy from the design:

| State | Title | Body | Actions |
|---|---|---|---|
| `error/oauth-expired` | "Gmail bağlantısı yenilenmeli." | "Google oturumu süresi doldu. Yeniden bağlanana kadar yeni mailler analiz edilmez." | [Yeniden Bağlan] [Sonra] |
| `error/sync-delayed` | "Senkronizasyon gecikti." | "Son başarılı analiz 09:40. Yeniden deniyoruz; gösterilenler 12 dakika eski olabilir." | [Şimdi Dene] [Tamam] |
| `error/permission-denied` | "Takvim izni verilmedi." | "Toplantı hazırlığı ve çakışma uyarıları takvim erişimi gerektirir. Diğer her şey çalışıyor." | [İzin Ver] [Neden gerekli?] |

### 3. Prototype-only behaviour to flag, not copy
- Secondary `Integrations.tsx`: `toggle()` fakes connecting (sets `'yunus@example.com'`) and "Kaldır" is a local toggle. Both must become the real OAuth start and a revoke flow with confirmation.
- Secondary `AndroidNotifications.tsx`: the access toggle is local state.

### 4. Hard manual blockers and credentials (§149)

| Provider | Credential / action | Why | Environment | Used by | Needed for local demo? | Needed in production? |
|---|---|---|---|---|---|---|
| Google | GCP project, OAuth consent screen, Web / iOS / Android client IDs, Search Console domain verification, brand verification | Sign-in and integrations | dev and prod projects | Edge Functions, mobile app | No (mock adapters) | Yes |
| Google | **CASA / restricted-scope verification for `gmail.readonly`** (annual, paid, weeks of lead time) | Gmail read for more than 100 users | prod | — | No | Yes, **critical path** |
| Google | Pub/Sub topic, push subscription with OIDC service account, publisher role for `gmail-api-push@system.gserviceaccount.com` | Gmail push | prod | `webhook-gmail` | No (polling fallback) | Yes |
| Microsoft | Entra app registration (multitenant plus personal), certificate credential | Sign-in and integrations | dev and prod | Edge Functions, Supabase Azure provider | No | Yes |
| Microsoft | Partner One ID for publisher verification | Enterprise consent, verified badge | prod | — | No | Strongly recommended |
| Apple | Developer Program membership, SIWA key (.p8), App ID capabilities, Services ID (Android/web Apple login) | Sign in with Apple, token revoke | dev and prod | Mobile app, `apple-token-exchange` | No | Yes |
| Apple | Private-relay email domain registration | Emails to relay addresses | prod | Custom SMTP | No | Yes |
| Apple | App Group, keychain access group, Time Sensitive capability | Widgets, share extension, time-sensitive push | dev and prod | Mobile app | No | Yes |
| Apple | APNs key | Push (via EAS) | prod | EAS / Expo Push | No | Yes |
| Firebase | FCM v1 service account + `google-services.json` in EAS | Android push | prod | EAS / Expo Push | No | Yes |
| Expo | EAS project, EAS access token (push security) | Builds, push | dev and prod | CI, `notifications-send` | No | Yes |
| Stores | App Store Connect and Play agreements, products `da_pro_monthly` / `da_pro_annual` | Subscriptions | prod | RevenueCat | No (RevenueCat Test Store) | Yes |
| RevenueCat | Project, Apple / Google API keys, **v2 secret key**, webhook Authorization secret, In-App Purchase key, Play service account | Subscriptions, entitlements | dev and prod | Mobile app, `webhook-revenuecat` | No (Test Store key) | Yes |
| Supabase | Pro plan, custom domain (paid add-on), custom SMTP (SPF/DKIM/DMARC), secrets (`TOKEN_ENC_KEY_V*`, provider secrets), cron secret key in Vault | Backend | dev and prod | All | No (local stack) | Yes |
| Google Play | Account-deletion web URL on the marketing site (Play Data safety requirement **[verify]**), Data safety form covering notification access | Store compliance | prod | Marketing site | No | Yes |

### 5. Items to re-verify in execution mode
Every **[OFF-S]** and **[SEC]** item above. In particular:
- the Gmail and Calendar 2026 quota and cost tables;
- the Microsoft AADSTS error codes;
- the RevenueCat v2 grant and delete endpoint paths;
- the Play policy for notification listeners;
- the user consent-management URLs;
- the time-sensitive entitlement key;
- the Turkish bank package IDs.

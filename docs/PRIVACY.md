# Dijital Asistan: Privacy (as built)

Documented at `ec14e92`.

What the system stores, for how long, what it never stores, and how export and deletion work as
implemented. The intent and the legal analysis (KVKK, GDPR, store policies) are in
[SECURITY_AND_PRIVACY_PLAN.md §4](SECURITY_AND_PRIVACY_PLAN.md#4-privacy); the user-facing policy
text is in [`apps/web/src/content/legal`](../apps/web/src/content/legal). Table-level detail is in
[DATABASE.md](DATABASE.md); AI data flows in [AI_PIPELINE.md](AI_PIPELINE.md); store declarations in
[STORE_CHECKLIST.md](STORE_CHECKLIST.md).

## What is stored

| Category | Where | Notes |
|---|---|---|
| Account and settings | `profiles`, `user_preferences`, `notification_preferences`, `app_installations`, `push_tokens` | Time zone, briefing schedule, retention policy, Data Source Controls, analytics opt-out; push tokens are never returned to clients or admins |
| Connections | `connected_accounts`, `calendars`, `sync_states`; tokens in `oauth_credentials` | Tokens only as AES-256-GCM ciphertext bound to account, provider and kind ([OAUTH.md](OAUTH.md#token-storage-encryption-and-rotation)) |
| Mail metadata and intelligence | `email_threads`, `email_messages` | Sender, recipients, subject (≤ 300 chars), snippet (≤ 200 chars), labels, attachment names and sizes, classification, AI summary (≤ 800 chars), key points, quotes as evidence. **No body column** |
| Calendar and tasks | `calendar_events`, `tasks` | Title, times, attendees, a description excerpt; device calendars as snapshots the user uploads |
| Derived items | `commitments`, `reminders`, `insights`, `life_events`, `briefings`, `briefing_items`, `meeting_preps`, `reply_drafts`, `approval_actions` / `approval_events` | Each derived row carries provenance (source type, id, provider, timestamp) and verified evidence quotes |
| User content | `meeting_notes` (text only), `captures` with files in the private `captures` bucket, `assistant_threads` / `assistant_messages`, reply attachments (`captures` bucket, `{user}/replies/…`) | Audio is never stored: dictation and voice notes keep the transcript only |
| AI memory | `memory_chunks` | Derived facts (≤ 2,000 chars) with a 1024-d embedding; never a raw mail body |
| Android signals | `android_notification_signals` | Structured fields only ([below](#android-notification-intelligence)) |
| Business | `subscriptions` (RevenueCat mirror), `entitlement_grants`, `billing_events` (subscriber attributes stripped), `referral_codes`, `referrals`, `referral_credits` | |
| Support and feedback | `support_tickets`, `support_notes`, `user_feedback`, `ai_feedback` | |
| Operations | `jobs`, `job_attempts`, `webhook_events`, `ai_requests`, `ai_usage_daily`, `analytics_events`, `audit_logs`, `system_health_checks`, `metrics_daily` | Content-free by construction (ids, counts, codes, hashes) |
| Privacy records | `data_export_requests`, `data_deletion_requests`, `privacy_tombstones` | |

## What is never stored

- **Raw mail bodies.** "Orijinal Mail" (API-MAIL-01) fetches the body from the provider on demand,
  sanitises it and answers `Cache-Control: no-store`. The AI pipeline fetches bodies transiently
  ([`services/intel/mail-bodies.ts`](../supabase/functions/_shared/services/intel/mail-bodies.ts))
  and passes them to the model only when `ai_data_access.mail_body` is on; they are never written or
  logged. Mail attachments are not downloaded by sync or AI: triage keeps only their name, type,
  size and provider id (`email_messages.attachment_meta`, while the `attachments` control and the
  account's "Ekleri analiz et" are on). A file is fetched only when the user sends it to capture
  ("Analiz Et"; API-CAP-02), and then lives as that capture under its retention.
- **Plaintext tokens, PKCE verifiers, OAuth states, completion codes and device nonces** (hashes or
  ciphertext only).
- **Prompts and model outputs in telemetry:** `ai_requests` rows are limited to an allow-list of
  content-free columns; logs never carry bodies, subjects, prompts, answers or queries.
- **Audio** of dictation, voice questions and meeting notes (transcripts only; premium briefing
  audio is generated from our own text and deleted after 7 days).
- **Raw Android notification text**, advertising identifiers, precise device ids, IP addresses in
  analytics (admin sessions and audit rows keep a peppered IP hash).

## Retention

Each user chooses `user_preferences.retention_policy`: `d30`, `d90` (default), `d365` or
`until_deleted`. BEFORE INSERT triggers set `expires_at = anchor + period` on content tables
(mail, events, tasks, commitments, reminders, meeting notes and preps, life events, captures,
insights, briefings and items, reply drafts, approvals, assistant threads and messages, memory
chunks, notifications, the AI result cache). Changing the policy enqueues a `retention` recompute
job, so a shorter period applies at the next daily sweep.

The daily sweep (`da_retention` at 02:30 UTC → JOB-20,
[`services/privacy/retention.ts`](../supabase/functions/_shared/services/privacy/retention.ts))
calls `retention_cleanup(5000)` until every count is 0, removes the returned Storage objects,
sweeps orphan objects and runs the system schedules; the run is audited with counts only.
Deleting any source row also deletes the memory chunks and embeddings derived from it in the same
statement.

| Data | Kept |
|---|---|
| Content tables above | Until `expires_at` per the user's policy. Open or snoozed commitments, scheduled reminders, open tasks and approvals that are pending, approved or executing are not swept |
| Contacts | Until the retention cutoff after the last contact, unless manual, VIP or tied to an open commitment |
| Android signals | `least(retention, posted_at + 30 days)` |
| Capture objects without a row, transient worker files | 24 hours |
| Premium briefing audio | 7 days |
| Data exports | 24 hours after `ready`; the request row 90 days |
| OAuth states | 1 day after expiry |
| Webhook ledger | 30 days |
| Provider quota windows, push tickets | 7 days |
| Rate-limit windows | 1 day |
| Health checks, job attempts | 30 days |
| Jobs | Completed 14 days; failed or dead-lettered 90 days |
| AI requests (telemetry) | 180 days |
| AI usage per day, analytics events | 400 days |
| App installations | 180 days after last seen; disabled push tokens 30 days |
| Deleted priority rules | 30 days |
| AI feedback, finished referrals | 365 days |
| Admin sessions | 180 days |
| Metric rollups (`metrics_daily`, `ai_metrics_daily`, `web_analytics_daily`) | 25 months |
| User feedback, closed support tickets, Support Access grants | 2 years |
| Billing events, finished deletion requests | 3 years |
| Privacy tombstones (hashed anti-abuse signals) | 12 months |
| Audit log | Kept (append-only); subjects are pseudonymised at account deletion |

## Data Source Controls

`user_preferences.ai_data_access` holds five booleans (`mail_body`, `attachments`, `calendar`,
`contacts`, `location_coarse`); every change is audited. All five are enforced through one guard
([`_shared/policy/data-access.ts`](../supabase/functions/_shared/policy/data-access.ts)) in every
place that builds a model prompt or writes AI memory
([AI_PIPELINE.md](AI_PIPELINE.md#prompt-assembly-and-injection-defences)):

| Toggle off | What no model sees and nothing embeds |
|---|---|
| `mail_body` | Mail bodies and what was derived from them (summaries, key points); triage uses headers and snippets, analysis, thread summaries and drafts stop |
| `attachments` | Attachment names, file and photo captures (refused with `DATA_SOURCE_DISABLED`; a queued one fails and its file is deleted) |
| `calendar` | Attendees, locations and descriptions of events (title and time stay) |
| `contacts` | The contact book: person profiles and facts, VIP marks, person scopes |
| `location_coarse` | Approximate location (off by default; the app never collects it) |

AI memory chunks of a class that is off are not embedded, and chunks of that class stored earlier
stay out of retrieval until the class is turned on again. Per-account toggles
(`connected_accounts.data_source_toggles`) switch reading of mail, calendar and tasks per account.

## Export

`POST /privacy/export` (API-PRV-01) → JOB-21 `export`
([`services/privacy/export.ts`](../supabase/functions/_shared/services/privacy/export.ts)):

- One export in flight per user (`STATE_CONFLICT {active_request_id}`), at most 3 requests a day;
  the request, the job and the audit row commit together.
- A ZIP (store mode) with one JSON file per entity, read page by page with an explicit column
  allow-list filtered by the owner, plus `manifest.json` (export id, UTC time, the user's time zone,
  schema version, per-file row count and SHA-256). Sections can be chosen with `include`.
- Never exported: `oauth_credentials`, `oauth_states`, ciphertext, token and credential hashes,
  anti-abuse signals, embeddings, cursors, job payloads. A second pass drops secret-looking keys
  and redacts token-shaped values.
- The archive goes to the private `exports` bucket; `ready` notifies the user and sets
  `expires_at = ready_at + 24 h`. `POST /privacy/export/:id/download` (API-PRV-04) mints a fresh
  300-second signed URL on every call; the URL is never stored or logged. The retention sweep
  deletes the object and marks the request `expired`.

## History deletion

`POST /privacy/delete-history` (API-PRV-02) needs a sign-in at most 10 minutes old
(`REAUTH_REQUIRED {max_age_seconds: 600}`) and `confirm: true`; the counts shown in the sheet come
from `history_deletion_preview`. JOB-22 `history_deletion` runs `private.purge_history` for all
analysis history or for one connected account:

- **Deleted:** insights, life events, briefings and their items, memory chunks, meeting preps,
  finished commitments and reminders, finished approvals, reply drafts not tied to an in-flight
  approval, the mail mirror and past calendar events of the scope; for the full scope also
  assistant threads, learned preferences, AI feedback, captures, notifications, Android signals and
  the AI result cache. Capture, reply-attachment and briefing-audio objects are removed through the
  Storage API (paths checkpointed in the job so a retry does not purge twice). Sync cursors stay, so
  old mail is not ingested again.
- **Kept:** connections and settings, VIP and rules, open and snoozed commitments, scheduled
  reminders, in-flight approvals, user-authored meeting notes (and the past events they belong to)
  and future events. Pending approvals of the scope are expired (`history_deleted`).
- Every step is recorded in `data_deletion_requests.steps`; the status moves
  `queued → processing → completed | failed` only.

## Account deletion

In the app `POST /privacy/delete-account` (API-PRV-03) needs a recent sign-in, the localized
confirmation word and the store-subscription acknowledgement; it returns a status token shown once
(only its hash is stored), sets `deletion_pending`, turns push off and signs out the other sessions.
On the web, `POST /data-deletion/start` and `/verify` (PUB-02, PUB-03) confirm the address with an
e-mail one-time code sent by Supabase Auth (`create_user: false`, with lockout), and `GET /data-deletion/:requestId/status` (PUB-07) reports
honest status with the token. JOB-23 `account_deletion`
([`services/privacy/account-deletion.ts`](../supabase/functions/_shared/services/privacy/account-deletion.ts))
runs ordered, resumable steps, each recorded in `steps`:

1. Begin: `processing`, pending approvals expired, other jobs cancelled, new sign-ins blocked.
2. The confirmation address is sealed on the request while the auth user still exists.
3. Every connected account goes through the disconnect service: watches stopped, Google revoked,
   Microsoft purged locally (with the manual consent link), credentials deleted.
4. Sign in with Apple is revoked with the stored refresh token (up to 3 tries).
5. The RevenueCat customer is deleted (up to 5 tries); the store subscription itself is not
   cancelled (the user was told to cancel it in the store).
6. Storage objects under `{user}/` in `captures`, `exports` and `briefing-audio` are purged.
7. System rows without cascade: analytics, AI requests and jobs deleted; support tickets anonymised;
   billing events pseudonymised; hashed anti-abuse tombstones written.
8. The auth user is deleted, cascading every user table including embeddings and credentials;
   audit subjects are pseudonymised.
9. Verification from the schema: no row with the user id in any `public` table and no object under
   the prefix; otherwise the attempt is retried and the request stays `processing`.
10. The confirmation e-mail (JOB-31) is queued when e-mail is configured; the request is `completed`.

A failed revoke never blocks deletion; it is recorded in `steps`. The request row survives the
account through `subject_hash` for 3 years (finished requests).

## AI providers and sub-processors

What is sent to AI providers: redacted text of the documents a feature needs (mail bodies only with
`mail_body` on, after hygiene and PII masking), derived chunks and query text for embeddings, and
speech for the server STT fallback. Requests carry a pseudonymous HMAC of the user id, never the id
or the e-mail address.

Providers' published policies on training (checked 2026-09-28; re-check before launch):

| Provider | Published policy | Source |
|---|---|---|
| Anthropic | Under the Commercial Terms, Anthropic does not train models on customer content from the API; retained data is never used for training without express permission | [Commercial Terms](https://www.anthropic.com/legal/commercial-terms), [API and data retention](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention), [Privacy Center](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training) |
| OpenAI | Data sent to the API is not used to train or improve OpenAI models unless the organisation opts in | [Data controls in the OpenAI platform](https://developers.openai.com/api/docs/guides/your-data), [Enterprise privacy](https://openai.com/enterprise-privacy/) |
| Voyage AI | The Terms of Service let Voyage use customer content to train and improve its models **unless the customer opts out** (a switch in the Voyage dashboard); after the opt-out, new content is deleted once processed | [Terms of Service](https://www.voyageai.com/tos), [Manage data collection for model training](https://www.mongodb.com/docs/voyageai/management/model-training-data/) |

The product copy ("AI providers do not train models on your data", web privacy policy and FAQ)
holds for Voyage only after that opt-out, so it is an enforced owner step: the server-only
`VOYAGE_TRAINING_OPT_OUT_CONFIRMED` must be `true` in preview and production whenever
`VOYAGE_API_KEY` is set, otherwise the Edge Functions refuse to start (the `@da/validation` env
schema) and the deploy secret check lists it as a production key
([DEPLOYMENT.md](DEPLOYMENT.md)). Set it only after switching the opt-out on in the Voyage
dashboard (**manual external step**), together with the DPAs and the Anthropic and OpenAI
zero-data-retention requests listed in SECURITY_AND_PRIVACY_PLAN §4.10. Message Batches (weekly review) keep results at Anthropic until
the `ai_batch` purge phase deletes them.

Sub-processors as configured in the product (the web list is built by
[`apps/web/src/content/subprocessors.ts`](../apps/web/src/content/subprocessors.ts); a web test
keeps it equal to the AI adapters under `_shared/ai/adapters` and the other provider clients):

| Service | Role | When involved |
|---|---|---|
| Supabase | Database, storage, auth, Edge Functions | Always (`DATA_REGION_LABEL`, default EU Frankfurt) |
| Vercel | Web and backoffice hosting | Always |
| Anthropic | Primary LLM | Always (AI features) |
| OpenAI | Fallback LLM, speech-to-text and TTS routes | When a route falls back or voice is used |
| Voyage AI | Embeddings for AI memory and search | Pro memory and search |
| Expo, Apple APNs, Google FCM | Push delivery | When push is enabled; text is `title_only` by default |
| RevenueCat | Subscriptions | Always (app user id = user UUID) |
| Sentry | Error monitoring (mobile SDK, Edge adapter) | When a DSN is configured; scrubbed events |
| Resend or Postmark | Transactional e-mail from the Edge Functions (deletion confirmations, support replies, admin invites); Supabase Auth sends sign-in and web-deletion codes through its own SMTP settings | When `EMAIL_*` is configured |
| Google Cloud Pub/Sub | Gmail push relay (`{emailAddress, historyId}`) | Gmail connected |
| Azure Speech or ElevenLabs | Premium TTS | `voice.tts_premium` with a TTS credential |
| Cloudflare Turnstile | Bot check on web forms | When `TURNSTILE_SECRET_KEY` is set |
| Deepgram | Server STT fallback | Only with `STT_SERVER_PROVIDER=deepgram` and `STT_API_KEY` |

Google, Microsoft and Apple act as independent controllers of their own services. Google user data
follows the Limited Use requirements; the scopes are listed in [OAUTH.md](OAUTH.md).

## Android Notification Intelligence

Android only, opt-in, Pro and behind `feature.android_ni`
([`apps/mobile/modules/notification-intelligence`](../apps/mobile/modules/notification-intelligence)):

- The listener runs only after the system grant and the in-app switch. Each notification is
  evaluated in memory by the Kotlin extractor in `onNotificationPosted`; title and text are never
  stored, logged or uploaded, and exceptions are swallowed without logging.
- A locked denylist applies in both modes (authenticators, password managers, e-Devlet, messaging
  and SMS apps, Google Play services, dialers, system UI, our own app), extendable through the flag
  payload; OTP-like notifications, secret-visibility and call-category notifications are dropped.
  In the default `selected` mode only allowed packages are read.
- Only a structured signal is kept: package, app label, category (`cargo`, `bank_payment`,
  `flight`, `reservation`, `other`), amount and currency, due date, tracking status, flight number,
  gate, posting time and a signal hash. The on-device buffer is AES-256-GCM encrypted with an
  Android Keystore key, excluded from backups, capped at 500 entries and 24 hours, and cleared on
  "Tümünü sil" and sign-out.
- Upload: `POST /android-notifications/signals` (API-ANI-01) accepts only that schema; the server
  keeps signals for `least(retention, posted_at + 30 days)` and derives life events from them. The
  user can delete signals (`android_notification_signals` delete policy); deleting signals keeps
  derived life events with the link cleared.

## Analytics

- First-party only: `POST /analytics/events` (API-ANL-01) validates every event against the
  `@da/domain` catalogue; unknown names, bad timestamps (older than 24 h or more than 5 minutes
  ahead) and oversized props drop the event, and non-conforming props, including e-mail- or
  URL-like strings, are removed. Batches are at most 64 KB.
- `user_preferences.analytics_opt_out` stores nothing at all. Rows carry the user id from the JWT,
  the installation id, a random session id, platform, app version and catalogue props; no advertising ids, IP addresses
  or free text. Events are kept 400 days.
- The web site counts events in `web_analytics_daily` (no row per visit, no user id, no IP).
- Backend events (API_CONTRACTS §17.1: device registration, first analysis, drafts, reminders,
  searches, captures, briefing audio, evening close, weekly share card, subscriptions) are written
  by one server emitter
  ([`_shared/services/analytics/emit.ts`](../supabase/functions/_shared/services/analytics/emit.ts)):
  only catalogue events whose source is `server` or `both`, props typed per event and validated by
  the same catalogue (an event with any refused prop is dropped whole), the opt-out honoured, no
  session id and no content; a storage failure never fails the request. `referral_link_opened` is an
  aggregate row without a user, written inside the PUB-04 resolve RPC. The per-user usage panel of
  the backoffice counts the app's rows only (`search_performed` is sent by both).
- No external analytics adapter exists at `ec14e92` (`ANALYTICS_EXTERNAL_*` keys are reserved).

## Differences from the plan

| Plan | As built | Reason (source) |
|---|---|---|
| Android on-device buffer ≤ 500 signals, ≤ 7 days (SECURITY_AND_PRIVACY_PLAN §4.16) | ≤ 500 signals, 24 hours | API_CONTRACTS API-ANI-01 ("bounded 24 h buffer") is authoritative (R-20; `EncryptedBuffer.kt`) |
| Stale `posted_at` → `422` for the batch | Per-signal rejection; the rest of the batch is accepted | Integration notes N |
| Shipments without a tracking number have no episode | One episode per app for 10 days | Integration notes N |
| Retention batches ≤ 1000 per call (API_CONTRACTS JOB-20) | 5,000 per table per call, repeated until 0 | DATABASE_AND_RLS_PLAN §6.4 batch size kept (integration notes F) |
| History deletion keeps connections, settings, VIP, rules, open commitments, scheduled reminders | Also keeps in-flight approvals, user-authored meeting notes with their past events, and future events | Matches the consequences sheet copy (migration `20260924002500` header, integration notes F) |
| Export includes a `README.txt` and the support notes | Neither is in the archive; support tickets are | Needs i18n keys; recorded as a T-11.01 follow-up (integration notes F) |
| External analytics adapter with `HMAC(HASH_PEPPER, 'v1:analytics:'||user_id)` | Not built | First-party analytics only (integration notes D2) |
| Voyage AI "no training on API data" (SECURITY_AND_PRIVACY_PLAN §4.10) | Voyage's published terms default to training unless the account opts out | The provider's current terms; the opt-out is a manual external step (above) |

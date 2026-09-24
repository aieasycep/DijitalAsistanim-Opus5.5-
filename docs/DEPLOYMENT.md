# Deployment

How each part of Dijital Asistan reaches production, what the owner sets up once, and how a release is checked. Environment variable names are the ones in [`.env.example`](../.env.example) (INTEGRATION_PLAN §15). Nothing here needs a secret value in the repository.

| Part | Runs on | Deployed by | Trigger |
| --- | --- | --- | --- |
| Database, Auth config, Edge Functions, Vault | Supabase (hosted, Postgres 17) | [`.github/workflows/deploy-supabase.yml`](../.github/workflows/deploy-supabase.yml) | Manual dispatch, `production` environment approval |
| Marketing web (`apps/web`) | Vercel project `da-web` | Vercel Git integration | Push to the production branch |
| Backoffice (`apps/backoffice`, `admin.<domain>`) | Vercel project `da-backoffice` | Vercel Git integration | Push to the production branch |
| Mobile app (`apps/mobile`) | App Store / Google Play | EAS Build + EAS Submit | Owner runs `eas build` / `eas submit` |

`APP_ENV` is `development` (local), `e2e` (CI and E2E builds), `preview` or `production`. In `preview` and `production` the server env schema refuses test-only overrides (`DA_FIXED_NOW`, provider `*_BASE_URL`), the fixture AI provider and demo mode (unless `ALLOW_DEMO_IN_PRODUCTION=true`), and every URL must be `https:`.

## 1. Supabase

### One-time setup (manual external steps)

1. Create the project in the chosen region and note the project ref. Add the **custom domain** add-on for the API (`API_PUBLIC_BASE_URL`); OAuth redirect URIs and webhook URLs use it.
2. In GitHub → Settings → Environments, create **`production`** with required reviewers. That approval is the manual gate of the deploy workflow. Add these environment secrets (names only; the workflow reports any that are missing):
   - `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_URL`, `CRON_SECRET`;
   - `SUPABASE_AUTH_SMTP_HOST`, `SUPABASE_AUTH_SMTP_PORT`, `SUPABASE_AUTH_SMTP_USER`, `SUPABASE_AUTH_SMTP_PASS`, `SUPABASE_AUTH_SMTP_SENDER`;
   - `SUPABASE_AUTH_EXTERNAL_{APPLE,GOOGLE,AZURE}_{CLIENT_ID,SECRET}`.
3. Set the Edge Function secrets from a local file that is never committed: `supabase secrets set --project-ref <ref> --env-file ./prod.secrets.env`. The names the code reads come in three tiers (derived by [`scripts/deploy/check-secrets.ts`](../scripts/deploy/check-secrets.ts) from `serverEnvShape` and `CREDENTIALS`):
   - **boot** (functions refuse to start without them): `HASH_PEPPER` and the active `TOKEN_ENC_KEY_V{n}`;
   - **production** (the feature reports `external_credential_required` until set): Anthropic, Voyage, `AI_HASH_PEPPER`, Google OAuth + Pub/Sub + Calendar webhook, Microsoft OAuth (certificate) + Graph notification URLs, Sign in with Apple (revocation), RevenueCat (+ webhook auth), `EXPO_ACCESS_TOKEN`, `CRON_SECRET`, `WEBHOOK_HMAC_SECRET`, `ADMIN_BFF_SECRET` + `ADMIN_GATEWAY_SECRET`, email delivery, and `APP_ENV`, `PUBLIC_WEB_URL`, `API_PUBLIC_BASE_URL`, `OAUTH_RESULT_REDIRECT_URI`, `MAIL_MESSAGE_ID_DOMAIN`, `ADMIN_ORIGIN`, `RECOVERY_CODE_PEPPER`;
   - **optional**: OpenAI (fallback models, disaster-recovery embeddings, server STT/TTS), the Anthropic/OpenAI admin keys (nightly cost reconciliation), Deepgram, premium TTS, Sentry, Turnstile.
   `SUPABASE_*` names are injected by the platform; the CLI refuses to set them.
4. Generate local secrets for new keys with `bash scripts/dev/env.sh --init` (peppers, encryption keys, webhook secrets). The same generator makes production values when run on the owner's machine.

### The deploy workflow

Run **Actions → Deploy Supabase → Run workflow**. `dry_run` is on by default.

| Step | Dry run | Deploy |
| --- | --- | --- |
| `functions:imports --check` (generated per-function `deno.json`) | ✓ | ✓ |
| Secret-name report: `supabase secrets list -o json` → `check-secrets.ts` (names only, also written to the job summary) | report only | fails on a missing boot, production or deploy-job name |
| `supabase link` | ✓ | ✓ |
| `supabase db push --dry-run` (pending migrations) | ✓ | — |
| `supabase db push` | — | ✓ |
| `supabase config push` (auth, SMTP on via `SUPABASE_AUTH_EMAIL_SMTP_ENABLED=true`, MFA TOTP, custom access token hook, rate limits, function `verify_jwt`) | — | ✓ |
| `supabase functions deploy <fn> --use-api` for `api`, `oauth`, `webhooks-google`, `webhooks-microsoft`, `webhooks-revenuecat`, `worker`, `admin-api`, `public-api`, `health` | — | ✓ |
| Vault entries `da_project_url` and `da_cron_secret` (read by `private.poke_worker` for the pg_cron → pg_net → `worker/run` call; upserted with `vault.update_secret` / `vault.create_secret`) | — | ✓ |
| `GET /functions/v1/health/live` with the automations secret must answer 200 | — | ✓ |

Migrations are forward-only. To roll back code, redeploy the functions from the previous commit (dispatch the workflow on that ref); a schema change is undone by a new migration, never by editing an applied one.

### Provider endpoints to register (manual external steps)

With `BASE = <API_PUBLIC_BASE_URL>/functions/v1`:

| Provider | Setting | Value |
| --- | --- | --- |
| Google OAuth client | Authorized redirect URI (`GOOGLE_OAUTH_REDIRECT_URI`) | `BASE/oauth/google/callback` |
| Gmail | Pub/Sub topic `GOOGLE_PUBSUB_TOPIC` with a push subscription to `BASE/webhooks-google/gmail`, OIDC token from `GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT`, audience `GOOGLE_PUBSUB_PUSH_AUDIENCE`; grant `gmail-api-push@system.gserviceaccount.com` publish on the topic | — |
| Google Calendar | Channel address (`GOOGLE_CALENDAR_WEBHOOK_URL`) | `BASE/webhooks-google/calendar` |
| Microsoft Entra app | Redirect URI (`MICROSOFT_OAUTH_REDIRECT_URI`), certificate credential (`MICROSOFT_CERT_*`) | `BASE/oauth/microsoft/callback` |
| Microsoft Graph | `MICROSOFT_GRAPH_NOTIFICATION_URL`, `MICROSOFT_GRAPH_LIFECYCLE_URL` | `BASE/webhooks-microsoft/notifications`, `BASE/webhooks-microsoft/lifecycle` |
| RevenueCat | Webhook URL with the `Authorization` header value `REVENUECAT_WEBHOOK_AUTH` | `BASE/webhooks-revenuecat` |
| Supabase Auth | Sign in with Apple (Services ID + key), Google (web client), Azure (`common` tenant); SMTP sender domain with SPF/DKIM/DMARC | via `config push` |

Google Gmail restricted scopes need OAuth verification plus the annual CASA assessment before more than 100 users can connect (KNOWN_PLATFORM_LIMITATIONS).

### First administrator

Once, from the owner's shell with the project's secret key (never in the backoffice): `SUPABASE_URL=… SUPABASE_SECRET_KEY=… ADMIN_ORIGIN=https://admin.<domain> pnpm admin:bootstrap --email <owner email> --name "<name>"`. It prints a one-time invite link (72 h). The invitee sets up TOTP on first sign-in, and everything after that is done in the backoffice's Admin Users module. The script refuses to run while an active `super_admin` exists.

## 2. Web and backoffice (Vercel)

Two Vercel projects on the same repository (manual external step), each with **Root Directory** `apps/web` or `apps/backoffice`, the pnpm install from the repository root, and the **Ignored Build Step** `npx turbo-ignore` so a project only rebuilds when its package graph changed.

| Project | Domain | Environment variables |
| --- | --- | --- |
| `da-web` | `<domain>` | client: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_ANALYTICS_ENABLED`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; server: `APP_ENV`, `SITE_INDEXABLE`, `API_PUBLIC_BASE_URL`, `APPLE_TEAM_ID`, `IOS_BUNDLE_IDENTIFIER`, `IOS_APP_STORE_ID`, `APP_STORE_PROVIDER_TOKEN`, `ANDROID_PACKAGE`, `ANDROID_SHA256_CERT_FINGERPRINTS` (these feed `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`), `MICROSOFT_CLIENT_ID` (`/.well-known/microsoft-identity-association.json`), and the legal identity fields (`COMPANY_*`, `PRIVACY_CONTACT_EMAIL`, `DATA_REGION_LABEL`, `EU_REPRESENTATIVE`, …) |
| `da-backoffice` | `admin.<domain>` | `APP_ENV`, `API_PUBLIC_BASE_URL`, `ADMIN_BFF_SECRET` (same value as the Edge secret), `ADMIN_ORIGIN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` |

Neither project holds the Supabase secret key. Only the `NEXT_PUBLIC_*` names are allowed in client bundles: `pnpm scan:bundles` in the CI `security` job fails the build if a server-only name or a secret-shaped value appears in `.next/static`. `SITE_INDEXABLE` stays `false` outside production, so preview deployments send `noindex`.

## 3. Mobile (EAS)

Profiles in [`apps/mobile/eas.json`](../apps/mobile/eas.json): `development` (dev client), `preview` (internal), `e2e` (APK and iOS simulator, `EXPO_PUBLIC_DEMO_MODE=true`) and `production` (store, auto-incremented build number, `appVersionSource: remote`). Each sets `APP_ENV` and the scheme (`dijitalasistan`, `-dev`, `-preview`, `-e2e`).

Owner steps (manual, External credential required):

1. `eas init` to create the EAS project (project id into the app config), then `eas credentials` for the iOS distribution certificate, provisioning profiles (app + widget extension + share extension, App Group `group.com.dijitalasistan.app`) and the APNs key; upload the FCM v1 service account for Android push.
2. EAS environment variables: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY`, `EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY`, `EXPO_PUBLIC_SENTRY_DSN`; build-time `GOOGLE_IOS_URL_SCHEME`, `GOOGLE_SERVICES_JSON`, `SENTRY_AUTH_TOKEN` / `SENTRY_ORG` / `SENTRY_PROJECT` (source maps are uploaded from EAS only).
3. `eas build --profile production --platform all`, then `eas submit --profile production` (Android goes to the internal track as a draft).

Store listing, privacy labels, the Play Data safety form and the notification-listener declaration are in [`STORE_CHECKLIST.md`](STORE_CHECKLIST.md).

## 4. Release checks

Before dispatching the deploy:

- CI is green on the commit (lint, typecheck, unit with coverage gates, tier-A database suite with `supabase db lint` and the type-drift check, Edge Functions, web and backoffice Playwright, mobile checks, bundle secret scan, quality gate).
- The deploy dry run shows only the missing-secret report you expect.

After it:

- `health/live` is 200 (checked by the workflow) and the backoffice **System Health** page shows every component with a real probe (`HEALTH_PROBE_VALUES`: `api`, `database`, `supabase_auth`, `storage`, `google_oauth`, `microsoft_oauth`, `gmail`, `microsoft_graph`, `push`, `ai_anthropic`, `ai_openai`, `ai_voyage`, `revenuecat`, `cron`, `webhooks`, `email_delivery`, `audit_chain`). A component whose credential is missing shows `external_credential_required`, never green.
- The owner sandbox checklist in `FINAL_IMPLEMENTATION_REPORT.md` (connect Google and Microsoft sandbox accounts, send through an approval, create a calendar event, receive a push, purchase and restore in the RevenueCat sandbox, request an export and a deletion).

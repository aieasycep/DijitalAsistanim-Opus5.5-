# Deployment

Documented at `ec14e92`.

How each part of Dijital Asistan reaches production, what the owner sets up once, and how a release is checked. Environment variable names are the ones in [`.env.example`](../.env.example) (INTEGRATION_PLAN §15). Nothing here needs a secret value in the repository.

| Part | Runs on | Deployed by | Trigger |
| --- | --- | --- | --- |
| Database, Auth config, Edge Functions, Vault | Supabase (hosted, Postgres 17) | [`.github/workflows/deploy-supabase.yml`](../.github/workflows/deploy-supabase.yml) | Manual dispatch, `production` environment approval |
| Marketing web (`apps/web`) | Vercel project `da-web` | Vercel Git integration | Push to the production branch |
| Backoffice (`apps/backoffice`, `admin.<domain>`) | Vercel project `da-backoffice` | Vercel Git integration | Push to the production branch |
| Mobile app (`apps/mobile`) | App Store / Google Play | EAS Build + EAS Submit | Owner runs `eas build` / `eas submit` |

`APP_ENV` is `development` (local), `e2e` (CI and E2E builds), `preview` or `production`. In `preview` and `production` the server env schema refuses the test-only overrides (`DA_FIXED_NOW`, provider `*_BASE_URL`); in `production` it also refuses the fixture AI provider and demo mode (unless `ALLOW_DEMO_IN_PRODUCTION=true`), and the public URLs must be `https:`.

## 1. Supabase

### One-time setup (manual external steps)

1. Create the project in the chosen region and note the project ref. Add the **custom domain** add-on for the API (`API_PUBLIC_BASE_URL`); OAuth redirect URIs and webhook URLs use it.
2. In GitHub → Settings → Environments, create **`production`** with required reviewers. That approval is the manual gate of the deploy workflow. Add these environment secrets (names only; the workflow reports any that are missing):
   - `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_URL`, `CRON_SECRET`;
   - `SUPABASE_AUTH_SMTP_HOST`, `SUPABASE_AUTH_SMTP_PORT`, `SUPABASE_AUTH_SMTP_USER`, `SUPABASE_AUTH_SMTP_PASS`, `SUPABASE_AUTH_SMTP_SENDER`;
   - `SUPABASE_AUTH_EXTERNAL_{APPLE,GOOGLE,AZURE}_{CLIENT_ID,SECRET}`;
   - `APPLE_TEAM_ID`, `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_PRIVATE_KEY` (the `.p8` PEM), `APPLE_SIWA_SERVICES_ID`: with these four set, `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET` is minted by the workflows and need not be stored ([Sign in with Apple client secret](#sign-in-with-apple-client-secret)).
3. Set the Edge Function secrets from a local file that is never committed: `supabase secrets set --project-ref <ref> --env-file ./prod.secrets.env`. The names the code reads come in three tiers (derived by [`scripts/deploy/check-secrets.ts`](../scripts/deploy/check-secrets.ts) from `serverEnvShape` and `CREDENTIALS`):
   - **boot** (functions refuse to start without them): `HASH_PEPPER` and the active `TOKEN_ENC_KEY_V{n}`;
   - **production** (the feature reports `external_credential_required` until set): Anthropic, Voyage (with `VOYAGE_TRAINING_OPT_OUT_CONFIRMED=true`, see below), `AI_HASH_PEPPER`, Google OAuth + Pub/Sub + Calendar webhook, Microsoft OAuth (certificate) + Graph notification URLs, Sign in with Apple (revocation), RevenueCat (+ webhook auth), `EXPO_ACCESS_TOKEN`, `CRON_SECRET`, `WEBHOOK_HMAC_SECRET`, `ADMIN_BFF_SECRET` + `ADMIN_GATEWAY_SECRET`, email delivery, and `APP_ENV`, `PUBLIC_WEB_URL`, `API_PUBLIC_BASE_URL`, `OAUTH_RESULT_REDIRECT_URI`, `MAIL_MESSAGE_ID_DOMAIN`, `ADMIN_ORIGIN`, `RECOVERY_CODE_PEPPER`;
   - **optional**: OpenAI (fallback models, disaster-recovery embeddings, server STT/TTS), the Anthropic/OpenAI admin keys (nightly cost reconciliation), Deepgram, premium TTS, Sentry, Turnstile.
   `SUPABASE_*` names are injected by the platform; the CLI refuses to set them.
   - **Voyage training opt-out:** Voyage's terms allow training on customer content unless the
     account opts out. Switch the opt-out on in the Voyage dashboard (manual external step), then
     set `VOYAGE_TRAINING_OPT_OUT_CONFIRMED=true`. While `VOYAGE_API_KEY` is set in preview or
     production without it, every Edge Function refuses to start (`voyage_training_opt_out_unconfirmed`,
     key names only) ([PRIVACY.md](PRIVACY.md#ai-providers-and-sub-processors)).
4. Generate local secrets for new keys with `bash scripts/dev/env.sh --init` (peppers, encryption keys, webhook secrets). The same generator makes production values when run on the owner's machine.

### The deploy workflow

Run **Actions → Deploy Supabase → Run workflow**. `dry_run` is on by default.

| Step | Dry run | Deploy |
| --- | --- | --- |
| `functions:imports --check` (generated per-function `deno.json`) | ✓ | ✓ |
| `functions:check` with `DA_DENO_FROZEN=1`: every function entrypoint and module type-checks against the committed `supabase/functions/deno.lock` (THR-16) | ✓ | ✓ |
| Secret-name report: `supabase secrets list -o json` → `check-secrets.ts` (names only, also written to the job summary) | report only | fails on a missing boot, production or deploy-job name |
| `supabase link` | ✓ | ✓ |
| `supabase db push --dry-run` (pending migrations) | ✓ | — |
| `supabase db push` | — | ✓ |
| Apple web client secret minted from the SIWA key (`scripts/deploy/siwa-client-secret.ts --days 180`, exported masked as `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET`), when the four `APPLE_*` secrets are set | — | ✓ |
| `supabase config push` (auth, SMTP on via `SUPABASE_AUTH_EMAIL_SMTP_ENABLED=true`, MFA TOTP, custom access token hook, rate limits, function `verify_jwt`) | — | ✓ |
| Edge secret `APPLE_SIWA_WEB_SECRET_NOT_AFTER` (expiry of the secret just pushed), same condition | — | ✓ |
| `supabase functions deploy <fn> --use-api` for `api`, `oauth`, `webhooks-google`, `webhooks-microsoft`, `webhooks-revenuecat`, `worker`, `admin-api`, `public-api`, `health`; the worker bundle carries the golden eval sets (`[functions.worker] static_files` in `supabase/config.toml`) for the `ai_eval` job | — | ✓ |
| Vault entries `da_project_url` and `da_cron_secret` (read by `private.poke_worker` for the pg_cron → pg_net → `worker/run` call; upserted with `vault.update_secret` / `vault.create_secret`) | — | ✓ |
| `GET /functions/v1/health/live` with the automations secret must answer 200 | — | ✓ |

Migrations are forward-only. To roll back code, redeploy the functions from the previous commit (dispatch the workflow on that ref); a schema change is undone by a new migration, never by editing an applied one.

### Sign in with Apple client secret

Apple accepts the web-flow client secret (an ES256 JWT signed with the SIWA key) for at most six months (KPL-49). [`scripts/deploy/siwa-client-secret.ts`](../scripts/deploy/siwa-client-secret.ts) mints it from `APPLE_TEAM_ID` (`iss`), `APPLE_SIWA_KEY_ID` (`kid`), `APPLE_SIWA_PRIVATE_KEY` (P-256 PKCS#8 PEM, `\n` escapes accepted) and `APPLE_SIWA_SERVICES_ID` (`sub`), with `aud = https://appleid.apple.com` and `exp` at most 180 days ahead, verifies its own signature and never prints the key or the token (only the key id, audience, subject and expiry). Exit 2 names missing or malformed inputs.

- **Scheduled rotation:** [`.github/workflows/rotate-siwa-secret.yml`](../.github/workflows/rotate-siwa-secret.yml) runs on 1 January, 1 June and 1 November at 06:41 UTC (never more than five months apart) in the `production` environment, so the environment's required reviewers approve it. It mints a new secret and, through the Management API (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`), sets `external_apple_secret` on the hosted Auth config and the Edge secret `APPLE_SIWA_WEB_SECRET_NOT_AFTER` (the expiry card on System Health). A manual run is a dry run (mint + verify only) unless `dry_run` is unticked; a missing secret fails the run with its name.
- **Owner run from a shell** (same effect): `APPLE_TEAM_ID=… APPLE_SIWA_KEY_ID=… APPLE_SIWA_PRIVATE_KEY="$(cat AuthKey_XXXX.p8)" APPLE_SIWA_SERVICES_ID=… SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… node scripts/deploy/siwa-client-secret.ts --apply` (without `--apply` it is a dry run).
- The deploy workflow mints a fresh secret before `config push` whenever the four `APPLE_*` secrets exist, so a deploy never pushes back an older stored `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET`; `check-secrets.ts` accepts the four keys in place of that name.

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
| `da-backoffice` | `admin.<domain>` | `APP_ENV`, `API_PUBLIC_BASE_URL`, `ADMIN_BFF_SECRET` (same value as the Edge secret), `ADMIN_ORIGIN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; optional `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN` (browser, handed over by the root layout at runtime) for the backoffice Sentry project — unset, no SDK starts. `VERCEL_GIT_COMMIT_SHA` names the release. Source maps are not uploaded (no `SENTRY_AUTH_TOKEN` build step; a manual owner step if wanted) |

Neither project holds the Supabase secret key. Only the `NEXT_PUBLIC_*` names are allowed in client bundles: `pnpm scan:bundles` in the CI `security` job fails the build if a server-only name or a secret-shaped value appears in `.next/static`. `SITE_INDEXABLE` stays `false` outside production, so preview deployments send `noindex`.

## 3. Mobile (EAS)

Profiles in [`apps/mobile/eas.json`](../apps/mobile/eas.json): `development` (dev client), `preview` (internal), `e2e` (APK and iOS simulator, `EXPO_PUBLIC_DEMO_MODE=true`) and `production` (store, auto-incremented build number, `appVersionSource: remote`). Each sets `APP_ENV` and the scheme (`dijitalasistan`, `-dev`, `-preview`, `-e2e`).

Owner steps (manual, External credential required):

1. `eas init` to create the EAS project, then set its id as `EXPO_PUBLIC_EAS_PROJECT_ID` (the dynamic `app.config.ts` reads it from the environment; push tokens and `updates.url` need it) and `EXPO_OWNER`; then `eas credentials` for the iOS distribution certificate, provisioning profiles (app + widget extension + share extension, App Group `group.com.dijitalasistan.app`) and the APNs key; upload the FCM v1 service account for Android push.
2. EAS environment variables: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY`, `EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY`, `EXPO_PUBLIC_SENTRY_DSN`; build-time `GOOGLE_IOS_URL_SCHEME`, `GOOGLE_SERVICES_JSON`, `SENTRY_ORG` / `SENTRY_PROJECT`. The build does not upload source maps (`disableAutoUpload` in `app.config.ts`) and no workflow uploads them, so uploading them with `SENTRY_AUTH_TOKEN` after a build is a manual step.
3. `eas build --profile production --platform all`, then `eas submit --profile production` (Android goes to the internal track as a draft).

Store listing, privacy labels, the Play Data safety form and the notification-listener declaration are in [`STORE_CHECKLIST.md`](STORE_CHECKLIST.md).

## 4. Release checks

Before dispatching the deploy:

- CI is green on the commit (lint, typecheck, unit with coverage gates, tier-A database suite with `supabase db lint` and the type-drift check, Edge Functions, web and backoffice Playwright, mobile checks, bundle secret scan, quality gate).
- The deploy dry run shows only the missing-secret report you expect.

After it:

- `health/live` is 200 (checked by the workflow) and the backoffice **System Health** page shows every component with a real probe (`HEALTH_PROBE_VALUES`: `api`, `database`, `supabase_auth`, `storage`, `google_oauth`, `microsoft_oauth`, `gmail`, `microsoft_graph`, `push`, `ai_anthropic`, `ai_openai`, `ai_voyage`, `revenuecat`, `cron`, `webhooks`, `email_delivery`, `audit_chain`). A component whose credential is missing shows `external_credential_required`, never green.
- The nightly **ai-eval** workflow ([`.github/workflows/ai-eval.yml`](../.github/workflows/ai-eval.yml), 01:37 UTC and manual) is green against `staging`: create the GitHub environment **`staging`** with `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (the staging project's) and the provider keys its routes use (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `VOYAGE_API_KEY`). Until they exist every run fails with "External credential required: …" and the missing names; a failed gate fails the run and is recorded on the evaluated prompt version ([AI_PIPELINE.md](AI_PIPELINE.md#evaluation)). A dispatch can narrow `suites` or set `dry_run` (no write).
- The owner sandbox checklist in `FINAL_IMPLEMENTATION_REPORT.md` (connect Google and Microsoft sandbox accounts, send through an approval, create a calendar event, receive a push, purchase and restore in the RevenueCat sandbox, request an export and a deletion).

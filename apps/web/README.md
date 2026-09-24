# @da/web — public website

The marketing site of Dijital Asistan (MASTER_PLAN §11, ADR-14; SCREEN_AND_FLOW_MAP Part 5;
IMPLEMENTATION_PLAN T-9.01–T-9.08): landing, pricing, privacy policy, terms, support, web
account deletion, and the browser fallbacks of the app's universal links. There is no sign-in and
no checkout on the web; the product lives in the mobile app.

Stack: Next.js 16 App Router (Cache Components, React Compiler, `proxy.ts`), React 19,
Tailwind CSS v4 with `@da/design-tokens`, next-intl 4 (Turkish at `/`, English at `/en`),
Geist + Lora through `next/font` (self-hosted, no font CDN).

## Routes

| Path                                                                                                                                                       | Page                                               | Rendering                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------ |
| `/`, `/en`                                                                                                                                                 | Landing (12 sections in M§73 order)                | static shell, plans cached 1 h             |
| `/pricing`                                                                                                                                                 | Free vs Pro, store prices, billing FAQ             | static shell, plans cached 1 h             |
| `/privacy`, `/terms`                                                                                                                                       | Legal documents with TOC                           | static                                     |
| `/support`                                                                                                                                                 | FAQ by category + contact form (`POST /support`)   | per request (nonce CSP)                    |
| `/data-deletion`                                                                                                                                           | Email code → typed confirmation → deletion request | per request (nonce CSP)                    |
| `/r/{CODE}`                                                                                                                                                | Referral landing (`GET /referrals/:code`)          | per request, `noindex`                     |
| `/oauth/done`                                                                                                                                              | Integration OAuth fallback (R-07)                  | per request, `noindex`, `no-store`         |
| `/app/*`                                                                                                                                                   | Universal-link fallback                            | per request, `noindex`                     |
| `/get?src=`                                                                                                                                                | UA-routed store redirect (302)                     | route handler                              |
| `/.well-known/apple-app-site-association`, `/.well-known/assetlinks.json`, `/.well-known/microsoft-identity-association.json`, `/.well-known/security.txt` | App link and security files                        | route handlers (rewrite, never a redirect) |
| `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`, OG images, icons                                                                                   | Metadata routes                                    | static                                     |

`/r/*`, `/oauth/done` and `/app/*` are locale-neutral (universal links keep one URL); the proxy
picks the locale from `?lang=`, then `Accept-Language`, then Turkish, and rewrites internally.

## Copy and translations

- Shared product copy comes from `@da/i18n` (`web`, `legal`, `faq`, `common`, `paywall`,
  `privacy`, …) and is reused wherever it fits, so the app and the site say the same thing.
- Copy that only the website needs lives in `messages/{tr,en}/webPages.json` under the
  `webPages.*` namespace. `packages/i18n` is not edited from this app; `src/i18n/messages.ts`
  merges both into one catalog and types it (`src/i18n/app-config.ts`), so a missing key is a
  compile error and `test/i18n.test.ts` checks TR/EN parity and ICU arguments.
- The long-form legal documents (privacy policy, terms) are typed content in
  `src/content/legal/*.{tr,en}.ts` (registry R-26): tables, lists and links stay reviewable, and
  section ids are identical in both languages because the app deep-links to them.
- Client components never import the `@da/i18n` root (it would bundle every catalog); they get a
  message subset through a nested `NextIntlClientProvider`.

## Environment

Key names and meanings are in [`.env.example`](./.env.example); `src/env/schema.ts` validates
them in `next.config.ts` (build) and on every server read. The web holds no secret: the Supabase
key must be a publishable key (`sb_secret_…` is rejected) and there is no server credential.

- `SITE_INDEXABLE=true` with `APP_ENV=production` (and not a Vercel preview) makes the site
  indexable; that build then requires the site/API URLs, `IOS_APP_STORE_ID` and the
  `COMPANY_*` values, and fails if `/plans` cannot be read.
- Store and app-link identifiers (`APPLE_TEAM_ID`, `ANDROID_SHA256_CERT_FINGERPRINTS`,
  `IOS_APP_STORE_ID`, `MICROSOFT_CLIENT_ID`) are external credentials. When unset, the related
  well-known file answers 404 and logs, and the App Store button is hidden; nothing is invented.
  Outside production a "Harici kimlik bilgisi gerekli" notice lists what is missing.

## Security and privacy

- Headers on every response (CTL-3.18): HSTS, `nosniff`, `X-Frame-Options: DENY`,
  `frame-ancestors 'none'`, COOP, Permissions-Policy, Referrer-Policy (`no-referrer` on deletion
  and link routes).
- CSP from `src/proxy.ts`: per-request pages get a fresh nonce with `'strict-dynamic'`; the
  prerendered pages use `script-src 'self' 'unsafe-inline'` (no per-request nonce exists for a
  static file). No page allows `eval`: zod runs jitless (`src/lib/zod.ts`).
- Analytics are first-party and content-free (`NEXT_PUBLIC_ANALYTICS_ENABLED`): enum-only
  events to `public-api /web-events`, off under Global Privacy Control / Do Not Track, no cookie,
  no storage, no third-party script. Form submit buttons stay disabled until hydration so a
  native submit can never put an email address into a URL.

## public-api contract used by the site

Base: `${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/public-api` (browser, `credentials: 'omit'`,
`apikey` header when a publishable key is set) and `${API_PUBLIC_BASE_URL}/functions/v1/public-api`
(server reads). Envelope `{ data }` / `{ error: { code, message_key?, retryable?, field_errors? } }`
(API_CONTRACTS §2, §13). The browser calls need CORS for the site origin with `content-type`,
`apikey` and `x-client-info` allowed and `Retry-After` exposed.

| Call                                                   | Request                                                                     | Success                                                                                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /plans` (PUB-05)                                  | —                                                                           | `free{mail_accounts,calendars,ai_analyses_per_day}`, `pro{…}`, `pricing{storefront,currency,as_of,verified,monthly{app_store,play},annual{…},intro_offer}` |
| `GET /referrals/:code` (PUB-04)                        | —                                                                           | `{ valid, reward_days, apply_window_days? }`, 200 for unknown codes                                                                                        |
| `POST /support` (PUB-01)                               | `{ email, name?, category, message, locale, website?, captcha_token? }`     | 202 `{ reference }`                                                                                                                                        |
| `POST /data-deletion/start` (PUB-02)                   | `{ email, locale, website?, captcha_token? }`                               | 202 `{ status: 'code_sent_if_account_exists' }` for every address                                                                                          |
| `POST /data-deletion/verify` (PUB-03)                  | `{ email, code, kind: 'account', confirmation: 'SİL' \| 'DELETE', locale }` | 202 `{ reference, request_id, status: 'queued', status_token, subscription_notice{active} }`                                                               |
| `GET /data-deletion/:requestId/status?token=` (PUB-07) | —                                                                           | `{ reference, status, requested_at, completed_at }`                                                                                                        |
| `POST /web-events` (PUB-06)                            | `{ event, page, locale, device_class, theme, props }`                       | 204                                                                                                                                                        |

Errors the UI distinguishes: `VALIDATION_FAILED` with `field_errors[].path`, `RATE_LIMITED`
(+ `Retry-After`), `OTP_INVALID`, `OTP_LOCKED`, 5xx. A filled `website` honeypot must be
accepted silently.

## Scripts

```sh
pnpm --filter @da/web dev         # http://localhost:3000
pnpm --filter @da/web build
pnpm --filter @da/web lint
pnpm --filter @da/web typecheck   # next typegen + tsc
pnpm --filter @da/web test        # vitest (unit + components)
pnpm --filter @da/web generate    # icon components from packages/ui/icons.data.json
pnpm --filter @da/web e2e:web     # Playwright (TEST_PLAN §11, WEB-E2E-01…16)
```

The E2E suite builds the site with a production, indexable fixture environment
(`e2e/stub/constants.ts`) and runs it on port 3107 against a `public-api` contract stub on port
4107 (`e2e/stub/public-api.ts`). Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use a preinstalled
Chromium; `E2E_REUSE_SERVER=1` reuses servers that are already running.

## Known limits

- Store buttons are text buttons with the platform names; Apple's and Google's official badge
  artwork and localized badge files are a manual external step.
- Device screenshots for the feature sections (T-9.07) are a separate task; the sections use
  product copy and a clearly labelled sample brief.
- Lighthouse CI (WEB-E2E-17) and the visual regression job (WEB-E2E-18) run in CI, not here.

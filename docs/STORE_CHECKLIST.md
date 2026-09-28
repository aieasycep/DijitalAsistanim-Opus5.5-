# Store checklist

Documented at `ec14e92`. What App Store and Google Play submission needs, answered from what the app does as built. Items marked **Owner** are manual external steps. The release gate items are ST-01…ST-24 in [DELIVERY_CHECKLIST §7.2](DELIVERY_CHECKLIST.md#72-store-checklist); build and credential steps are in [DEPLOYMENT.md](DEPLOYMENT.md#3-mobile-eas); platform constraints are in [KNOWN_PLATFORM_LIMITATIONS.md](KNOWN_PLATFORM_LIMITATIONS.md); the data inventory and deletion pipeline are in [PRIVACY.md](PRIVACY.md).

## Identity and builds

| Item | Value | Where |
| --- | --- | --- |
| Bundle id / package | `com.dijitalasistan.app` (other variants add `.dev`, `.preview`, `.e2e`) | [`app.config.ts`](../apps/mobile/app.config.ts) |
| Extensions | Widget `com.dijitalasistan.app.widget`; share extension `com.dijitalasistan.app.share-extension` ("Dijital Asistan'a Ekle") | `targets/widget`, `expo-share-intent` |
| App Group | `group.com.dijitalasistan.app` (app, widget, share extension) | `ios.entitlements` |
| Scheme and links | `dijitalasistan://`; universal and app links for `https://<web>/app`, `/r`; `applinks:` and `webcredentials:` associated domains | `app.config.ts`, web `/.well-known/*` |
| Entitlements | Sign in with Apple, App Group, Time Sensitive notifications | prebuild smoke asserts each |
| Deployment targets | iOS 16.4 (iPhone only, `supportsTablet: false`); Android min SDK 24, target SDK 36 | `app.config.ts` |
| Encryption export | `ITSAppUsesNonExemptEncryption = false` (standard HTTPS and OS encryption only) | `Info.plist` |
| Background modes (iOS) | `remote-notification` (push), `processing` (`expo-background-task`: widgets, device calendar), `audio` (briefing player) | `Info.plist` |
| Production profile | `eas.json` `production`: store distribution, remote app version, auto-incremented build number, demo mode off | [`eas.json`](../apps/mobile/eas.json) |

**Owner:** EAS project and credentials (distribution certificate, provisioning profiles for the app and both extensions, APNs key, FCM service account), App Store Connect and Play Console apps, agreements, products.

## Sign in with Apple (Guideline 4.8)

- The sign-in screen offers Sign in with Apple next to Google, Microsoft and email code on iOS (native `expo-apple-authentication`, nonce-bound). On Android, Apple is offered through the web flow when the Supabase Apple provider is enabled.
- The full name arrives only on the first authorisation and is saved then. The single-use authorisation code is sent to `POST /auth/apple/exchange`, which stores the Apple refresh token encrypted so it can be revoked at account deletion; a missed exchange is retried on the next Apple sign-in.
- **Owner:** SIWA key (`APPLE_SIWA_KEY_ID`, `APPLE_SIWA_PRIVATE_KEY`), Services ID for the web flow, the native client id, and the private-relay email source registration for the sending domain. The Apple web client secret expires after at most six months: with `APPLE_TEAM_ID`, `APPLE_SIWA_KEY_ID`, `APPLE_SIWA_PRIVATE_KEY` and `APPLE_SIWA_SERVICES_ID` in the GitHub `production` environment, `rotate-siwa-secret.yml` mints a new one (exp 180 days) on 1 January, 1 June and 1 November and every deploy mints one before `config push` ([DEPLOYMENT.md](DEPLOYMENT.md#sign-in-with-apple-client-secret)); System Health shows its expiry.

## Account deletion (Guideline 5.1.1(v), Play account deletion policy)

- **In the app:** Settings › Gizlilik › Hesabımı sil (`settings/privacy/delete-account`): the consequences list (including that the store subscription is not cancelled, with "Aboneliği Yönet"), a fresh sign-in if the last one is older than 10 minutes, typing "SİL" (English: "DELETE"), then `POST /privacy/delete-account` and an honest status page. The account enters `deletion_pending`; the app shows "deleted" only when the request completes.
- **On the web** (Play's deletion resource): `https://<web>/data-deletion`: email → a 6-digit code (sent only if an account exists; the response is identical either way) → the code together with the typed confirmation word, next to the list of what is deleted → the request reference and status.
- **Server:** the `account_deletion` job stops provider push, revokes Google tokens and the Apple token, records Microsoft as local-only (the user gets the manual removal link), deletes the RevenueCat customer, empties storage, deletes system rows, writes tombstones, deletes the Auth user (cascading user data), verifies, emails a confirmation and closes the request ([PRIVACY.md](PRIVACY.md)).
- **Owner:** verify the RevenueCat customer-delete endpoint against the current RevenueCat reference before launch (marked in [`revenuecat.ts`](../supabase/functions/_shared/services/billing/revenuecat.ts)); set the backup/PITR window to ≤30 days.

## Privacy

### iOS privacy manifest

Declared through `ios.privacyManifests` in `app.config.ts` and asserted by the prebuild smoke: `NSPrivacyTracking = false`, `NSPrivacyTrackingDomains = []`, and the required-reason APIs:

| API category | Reasons | Why |
| --- | --- | --- |
| UserDefaults | `CA92.1`, `1C8F.1` | Expo / React Native preferences; the App Group shared with the widget and share extension |
| File timestamp | `C617.1` | `expo-file-system`, audio and capture caches |
| System boot time | `35F9.1` | React Native performance clock |
| Disk space | `E174.1` | Free-space check before downloads |

Third-party SDKs ship their own manifests with their pods (check them in the archive before submission). No IDFA, no ATT prompt (`NSUserTrackingUsageDescription` is absent; `AD_ID` is blocked on Android).

### App Store privacy labels

"Used for tracking": **No** for every type. Derived from what the app and backend actually collect and keep:

| Data type | Collected | Linked | Purpose | Source in the product |
| --- | --- | --- | --- | --- |
| Contact Info – Email Address | Yes | Yes | App Functionality | Account (sign-in), connected mailbox addresses |
| Contact Info – Name | Yes | Yes | App Functionality | Profile display name (optional; Apple first-sign-in name) |
| User Content – Emails or Text Messages | Yes | Yes | App Functionality | Mail from connected accounts: metadata, short snippets, summaries and analysis results are stored for the retention period; full bodies are not stored |
| User Content – Photos or Videos | Yes | Yes | App Functionality | Photos and screenshots the user picks or shares for capture |
| User Content – Audio Data | Yes | Yes | App Functionality | Voice input sent to `POST /assistant/transcribe` only when the device cannot recognise speech on-device; deleted after transcription |
| User Content – Customer Support | Yes | Yes | App Functionality | Support tickets and feedback |
| User Content – Other User Content | Yes | Yes | App Functionality, Product Personalization | Calendar events, tasks, reminders, notes, captures (files and text), assistant conversations, VIP and priority rules, learned preferences |
| Financial Info – Other Financial Info | Yes | Yes | App Functionality | Amounts and due dates extracted from mail, captures and (Android) notification signals |
| Purchases – Purchase History | Yes | Yes | App Functionality | Subscription state from RevenueCat |
| Identifiers – User ID | Yes | Yes | App Functionality, Analytics | Account id (also the RevenueCat app user id) |
| Identifiers – Device ID | Yes | Yes | App Functionality | App-generated installation id and the Expo push token (no advertising identifier) |
| Usage Data – Product Interaction | Yes | Yes | Analytics | Content-free analytics events with the user id; off when the user opts out (`analytics_opt_out`) |
| Diagnostics – Crash Data, Performance Data | Yes (only when `EXPO_PUBLIC_SENTRY_DSN` is set) | No | App Functionality | Scrubbed Sentry events and the startup span; no user id is set |

Not collected: Location, Contacts (the device address book is never read), Health & Fitness, Sensitive Info, Browsing History, Search History (search and memory queries are processed per request and not stored; recent searches stay on the device), Advertising Data.

### Google Play Data safety

General answers: encrypted in transit **Yes**; users can request deletion **Yes** (in the app and at `https://<web>/data-deletion`); data shared with third parties **No** (processors act on our behalf, listed in [PRIVACY.md](PRIVACY.md)); independent security review only after the Google CASA letter of assessment exists.

| Category → type | Collected | Ephemeral | Required | Purpose |
| --- | --- | --- | --- | --- |
| Personal info → Name, Email address, User IDs | Yes | No | Required | App functionality, Account management |
| Financial info → Purchase history | Yes | No | Optional | App functionality |
| Financial info → Other financial info | Yes | No | Optional | App functionality |
| Messages → Emails | Yes | No | Optional | App functionality |
| Messages → Other in-app messages (assistant) | Yes | No | Optional | App functionality |
| Photos and videos → Photos | Yes | No | Optional | App functionality |
| Audio → Voice or sound recordings | Yes | Yes | Optional | App functionality |
| Files and docs | Yes | No | Optional | App functionality |
| Calendar → Calendar events | Yes | No | Optional | App functionality |
| App activity → App interactions | Yes | No | Optional (opt-out) | Analytics |
| App activity → Other user-generated content | Yes | No | Optional | App functionality |
| App activity → Other actions (structured signals from other apps' notifications: shipment, flight, payment status; extracted on the device) | Yes | No | Optional | App functionality |
| App info and performance → Crash logs, Diagnostics | Yes (when Sentry is configured) | No | Optional | App functionality |
| Device or other IDs | Yes | No | Required | App functionality |

Not collected: Location, Contacts, Health and fitness, Web browsing, SMS/MMS (messaging and SMS apps are always excluded from notification analysis), In-app search history.

## Permissions

### iOS usage strings

Turkish is the development region; English comes from `en.lproj/InfoPlist.strings`. Source: [`src/i18n/native-strings.ts`](../apps/mobile/src/i18n/native-strings.ts).

| Key | Asked when | Turkish text |
| --- | --- | --- |
| `NSCalendarsFullAccessUsageDescription` (+ legacy `NSCalendarsUsageDescription`) | Connecting Apple Calendar, or an approved write to it | "Takvimindeki etkinlikleri günlük brifinge, toplantı hazırlığına ve çakışma uyarılarına eklemek için. Etkinlik bilgilerin analiz için hesabına eşitlenir; değişiklikler yalnızca senin onayınla yapılır." |
| `NSRemindersFullAccessUsageDescription` (+ legacy key) | Picking Apple Reminders as a reminder or task destination | "Apple Anımsatıcılar'daki görevlerini brifinge eklemek ve onayınla yeni anımsatıcı oluşturmak için." |
| `NSMicrophoneUsageDescription` | Voice mode, dictation, post-meeting capture | "Asistana sesle soru sorabilmen ve toplantı notu alabilmen için." |
| `NSSpeechRecognitionUsageDescription` | Same | "Söylediklerini yazıya çevirmek için. Mümkün olduğunda bu işlem cihazında yapılır." |
| `NSCameraUsageDescription` | Capture › Fotoğraf › Kamera | "Fatura, bilet veya belgeyi fotoğraflayıp Dijital Asistan'a ekleyebilmen için." |
| `NSPhotoLibraryUsageDescription` | Capture from the library (system picker) | "Seçtiğin ekran görüntüsü ve fotoğrafları analiz için ekleyebilmen için. Yalnızca seçtiklerine erişilir." |
| `NSFaceIDUsageDescription` | Declared by the configured `expo-local-authentication` plugin; no screen currently asks for biometrics | "Hesap silme gibi hassas işlemleri onaylaman için." |

Never present (asserted by the prebuild smoke): location keys, `NSContactsUsageDescription`, `NSUserTrackingUsageDescription`, `NSPhotoLibraryAddUsageDescription`.

### Android

| Permission | Why |
| --- | --- |
| `POST_NOTIFICATIONS` | Push and local reminders; the prompt runs only from a user action, after the channels exist |
| `READ_CALENDAR`, `WRITE_CALENDAR` | Device calendar snapshot; approved writes to the device calendar |
| `RECORD_AUDIO` | Voice input |
| `CAMERA` | Capture photos |
| `SCHEDULE_EXACT_ALARM` | On-time user reminders (the OS may deliver inexactly while the user has not granted "Alarms & reminders") |
| `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK` | Rescheduling local reminders and background work |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK` | Added by `expo-audio` for background briefing playback |
| Notification listener service (`BIND_NOTIFICATION_LISTENER_SERVICE`, bound by the system only) | Android notification intelligence (opt-in, Pro) |
| Launcher `<queries>` | App picker for notification intelligence, instead of `QUERY_ALL_PACKAGES` |

Blocked with `tools:node="remove"` and asserted: media read permissions (`READ_MEDIA_*`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `ACCESS_MEDIA_LOCATION`), location (fine, coarse, background), contacts (read, write), `USE_EXACT_ALARM`, `QUERY_ALL_PACKAGES`, `com.google.android.gms.permission.AD_ID`. `android:allowBackup="false"`. Before each runtime prompt the app shows its own rationale text ([`native-strings.ts`](../apps/mobile/src/i18n/native-strings.ts)).

**Owner (Play Console):** the foreground-service declaration for media playback, the notification-listener declaration below, and the Data safety form above.

## Notification listener (Play) and prominent disclosure

- **What it does:** reads notifications of the apps the user selects (or all apps), drops verification codes, security, messaging, SMS and call notifications and the always-excluded groups (authenticators, password managers, e-Devlet, messaging, Google Play services, the app itself), and keeps only structured signals (category, amount, due date, tracking status, flight number, gate, time) for 24 h in an encrypted on-device buffer before upload. Notification text is never stored or sent. Android only, Pro only, off by default.
- **Prominent disclosure:** shown in the app before the system settings open, on the onboarding step and on "Telefon Bildirimleri": title "Telefon bildirimlerini de anlayayım mı?", body "Kargo, banka ve uygulama bildirimlerinden kişisel sinyaller çıkarırım. Mesaj içerikleri asla saklanmaz.", the always-excluded groups, and the button "Bildirim Erişimini Aç"; the system access screen opens only after the user accepts.
- **Restricted settings:** sideloaded builds (including EAS internal APKs) on Android 13+ need "Allow restricted settings"; the app shows that help after two returns without a grant. Distribute test builds through a Play testing track where this matters.
- **Owner:** the Play permission declaration and a store-listing sentence that describes the feature as Android-only; the App Store listing and screenshots must not mention it (Guideline 2.3).

## Share extension `openURL` risk

The iOS share extension is the one generated by `expo-share-intent`: it writes the shared items to the App Group and opens the main app through a responder-chain `openURL`. Apple's extension guidance says share extensions should not open their containing app, so App Review can reject it.

- **Mitigation if rejected:** switch `expo-share-intent` to Android only and ship a custom share extension (via `@bacons/apple-targets`, like the widget) that shows its own confirmation ("Kaydedildi. Dijital Asistan'ı açtığında analize hazır olacak."), writes the payload to the App Group and does not open the app; the app already picks up staged payloads on the next launch. This fallback is not in the repository.
- Review note: explain that the extension only hands the shared item to the app's capture screen, where analysis starts only after the user taps "Analiz Et".

## Subscriptions and the referral reward (Guideline 3.1.1)

- **Purchases:** Pro is sold only through in-app purchase (RevenueCat, store products; **Owner**: create the subscription group and products and link them in RevenueCat). The paywall shows store prices (`priceString`), the renewal and cancellation text, a trial only when the store reports eligibility, restore, Terms and Privacy links, and a close button; the server stays the source of truth for entitlements.
- **Referral reward risk:** a qualified referral gives both sides 14 days of Pro (`referral.reward_days`, `entitlement_grants` source `referral`, capped per year by `plan_limits.referral_rewards_per_year`). Guideline 3.1.1 reserves unlocking features for in-app purchase, so a reward that unlocks Pro without a purchase can be questioned in review.
- **How the product handles it:** the reward is a time-limited promotional grant, not something that can be bought or exchanged for money; nothing in the app offers it as an alternative way to pay; it is granted only after the referee qualifies (onboarding completed, a connected account healthy, a first briefing delivered, the account at least 48 h old) and passes anti-abuse scoring, with flagged referrals held for admin review; and it is the same Pro entitlement the store sells, extended for a fixed number of days. The review note states this.
- **Kill switch:** if App Review objects, turn `referral.rewards_enabled` off in backoffice Settings (step-up, audited as `settings.system_updated`). No new credit or Pro grant is written for either side from then on; codes still apply, qualification is still recorded, existing grants and history stay, and a withheld referral stays `qualified` with the reason in its risk signals, so an admin can reward it after rewards are turned on again. `/referrals` shows the switch state and `GET /me/bootstrap` sends it as `config.referral_rewards_enabled`.
- **Copy follows the switch:** while rewards are off no surface promises Pro for a referral. The app's "Arkadaşını Davet Et" screen (headline, body, share message, the referee line, status meta and badges, footer), the "Davet kodu" sheet's success toast, the Settings hub row (chevron only, no "+14 gün Pro" trailing) and the Help answer switch to the `referral.rewardsOff.*` copy (tr, en); the web landing `/r/[code]` reads `rewards_enabled` from PUB-04 and shows "Davet ödülleri şu anda verilmiyor…" instead of the reward line. Codes keep applying.

## Screenshots and ads

The PRIMARY design archive's `09 Pazarlama` canvas (store/01–06 at 1290×2796, ad/01–03 at 1080×1920) defines the compositions; DESIGN_AUDIT DEV-38 fixes their copy (no testimonial names, no traffic ETA, the store/02 headline "83 mail. Gerçekten önemli olan 4."). They are **not produced in the repository**.

**Owner:** render six screenshots per language (tr, en) from a demo build using `dijitalasistan-e2e://demo/setup?scenario=…&clock=…&locale=…&theme=…` with the demo canon (no real personal data), compose them per the canvas, and keep Android notification intelligence out of the iOS set. Official App Store and Google Play badges for the web are also an owner step.

## Review notes and listing

- **Demo account (Owner):** a reviewer mailbox with seeded mail (Google Workspace and Outlook.com test accounts, added as test users while Google verification is pending) and the email-code sign-in path. Production builds have demo mode off, so the reviewer uses real sign-in and real connected accounts.
- **Notes to include:** every write (send, calendar change, task, reminder at a provider) needs the user's approval in the app; how to reach each Pro feature (a sandbox purchase, or a promotional grant from the backoffice for the review account); Gmail access is in Google's verification process (at most 100 users until the CASA letter exists); notification intelligence is Android-only and optional; the share extension behaviour above; the referral reward above.
- **Sandbox purchases:** production counts sandbox purchases only for the user ids in `app_settings.billing.sandbox_allowed_app_user_ids` (empty by default). Add the reviewer account there before review so an App Review sandbox purchase unlocks Pro.
- **Listing URLs:** privacy `https://<web>/privacy`, support `https://<web>/support`, terms `https://<web>/terms`, deletion `https://<web>/data-deletion`, marketing `https://<web>/`.
- **Forms (Owner):** age rating, content rights, category, primary language Turkish, export compliance (matches `ITSAppUsesNonExemptEncryption = false`).

## Differences from the plan

| Plan | As built | Reason |
| --- | --- | --- |
| DELIVERY_CHECKLIST ST-18, KPL-20: in-extension share UI through `@bacons/apple-targets` as the shipped path | The `expo-share-intent` redirect extension ships; the in-extension UI is the documented fallback | The redirect is the smaller native surface; the fallback is kept for a review rejection. |
| KPL-49 / ARCHITECTURE_DECISIONS proposal: a `rotate-siwa-secret` workflow | `rotate-siwa-secret.yml` runs three times a year (gaps of at most five months) instead of a fixed five-month interval | Cron cannot express "every five months"; the 1 Jan / 1 Jun / 1 Nov schedule keeps each 180-day secret replaced before it expires (GAP-4). |
| SECURITY_AND_PRIVACY_PLAN §4.12–4.13: Search History / In-app search history collected | Not collected | Search and memory queries are not stored server-side; assistant conversations are declared as user content instead. |
| SECURITY_AND_PRIVACY_PLAN §4.13: crash logs "Required" | Optional, and only when Sentry is configured | Sentry starts only with `EXPO_PUBLIC_SENTRY_DSN`. |
| App config declares `NSFaceIDUsageDescription` for deletion confirmation | No screen uses biometrics; deletion re-authenticates with a fresh sign-in | Re-auth by sign-in is what the server can verify (`amr` ≤10 min). The string can be removed with the plugin if App Review asks. |
| INTEGRATION_PLAN §10.4: sandbox purchases in production count for App Review | Counted only for allow-listed user ids | Owner decision: sandbox events from arbitrary users must not grant Pro in production. |

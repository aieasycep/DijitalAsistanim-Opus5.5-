# Mobile app

Documented at `ec14e92`. The iOS and Android app in [`apps/mobile`](../apps/mobile) as built: Expo SDK 57, React Native 0.86 (Hermes, React Compiler on), Expo Router, TypeScript. Screen specs are in [SCREEN_AND_FLOW_MAP.md](SCREEN_AND_FLOW_MAP.md); how each design artboard maps to a screen is in [DESIGN_MAPPING.md](DESIGN_MAPPING.md); platform limits are in [KNOWN_PLATFORM_LIMITATIONS.md](KNOWN_PLATFORM_LIMITATIONS.md); store submission is in [STORE_CHECKLIST.md](STORE_CHECKLIST.md). The backend side (routes, jobs, AI) is described in [ARCHITECTURE.md](ARCHITECTURE.md) and [AI_PIPELINE.md](AI_PIPELINE.md).

## Layout

| Path | Contents |
| --- | --- |
| `app/` | Expo Router routes. Thin files that render a screen from `src/features`. |
| `src/features/<area>/` | Screens, sheets, data hooks and helpers per area (today, briefing, flow, mail, reply, plan, meeting, assistant, voice, search, person, capture, approvals, reminders, commitments, followups, life, settings, privacy, rules, integrations, subscription, paywall, pro-gate, referral, android-ni, widgets, onboarding, auth, shell, demo, actions, launch). |
| `src/lib/` | App services: auth and session storage, env, query client and persistence, offline queue, notifications, analytics, Sentry, deep links, router guards, background refresh, clock, device info, storage. |
| `src/providers/` | `AppProviders`, `AuthProvider`, `QueryProvider`, `SheetHost`, `ToastHost`. |
| `src/i18n/` | `I18nProvider` over `@da/i18n` catalogs; native permission strings (`native-strings.ts`). |
| `modules/` | Local Expo modules: `da-share` (share staging + config plugin), `da-tts` (on-device synthesis to file), `da-widgets` (widget bridge, Android Glance widgets, config plugin), `notification-intelligence` (Android notification listener, config plugin). |
| `targets/widget/` | The iOS WidgetKit extension (SwiftUI), added by `@bacons/apple-targets`. |
| `.maestro/` | Maestro E2E flows, subflows, assets and the harness script. |
| `.eas/workflows/` | EAS Workflows: preview builds, iOS and Android E2E. |
| `test/` | Jest suites (jest-expo) and helpers. |
| `app.config.ts`, `eas.json` | Variant-aware app config and EAS profiles. |

Shared code comes from the workspace packages: `@da/ui` (theme-aware component kit), `@da/design-tokens`, `@da/i18n`, `@da/domain`, `@da/validation` and `@da/api-client` (typed Edge `api` client, Supabase client factory, TanStack Query options and keys).

## Navigation and guards

The root layout ([`app/_layout.tsx`](../apps/mobile/app/_layout.tsx)) keeps the native splash until fonts are registered and the session is known, mounts the providers and declares the root routes inside `Stack.Protected` groups. The guard flags come from the pure resolver in [`src/lib/router-guards.ts`](../apps/mobile/src/lib/router-guards.ts):

| Order | Check | Target |
| --- | --- | --- |
| 1 | Auth: signed out | `/welcome` (intro) or `/sign-in` (returning user) |
| 2 | Onboarding step (`profiles.onboarding_step`) | the step's route: connect mail → connect calendar → permissions → personalization → briefing schedule → VIP → first analysis → aha → notifications → Android notification access (Android only) |
| 3 | `bootstrap.config.upgrade_required` | `/update-required` |
| 4 | Account state `disabled` / `deletion_pending` | blocked state / the deletion status page only |
| — | otherwise | `/today` |

| Access class | Routes |
| --- | --- |
| Always | `index`, `+not-found`, `update-required`, `auth/callback`, `integrations/callback` |
| Signed out | `(auth)/*` (sign-in, email code) |
| Onboarding | `(onboarding)/*` (intro pages signed out, steps signed in) |
| App (signed in, onboarded, supported version, active) | `(tabs)` and every detail route (briefings, weekly, mail, reply, followups, waiting, commitments, life, event, plan proposal and conflict, meeting prep/summary/post, chat, voice, search, memory, person, VIP, capture, approvals, reminders, paywall) |
| Settings stack | `settings/*`; the deletion status page is also reachable while `deletion_pending` |
| Demo builds only | `demo/setup` (left out of other bundles by `metro.config.js` and rejected by the link allow-list) |

`test/route-registry.test.ts` fails when a file under `app/` is not in exactly one access list, so every new screen is protected by default. The tab bar has exactly four tabs, Bugün · Akış · Plan · Asistan, each with its own stack; Android back on a non-Today tab root returns to Today.

**Deep links** ([`app/+native-intent.tsx`](../apps/mobile/app/+native-intent.tsx), [`src/lib/deeplinks.ts`](../apps/mobile/src/lib/deeplinks.ts)): the build's scheme (`dijitalasistan`, `-dev`, `-preview`, `-e2e`), universal and app links under `https://<web>/app/…`, `/oauth/done` and `/r/{code}`, and notification links are normalised and checked against the `@da/domain` allow-list, which also validates ids. Rejected links open `+not-found`; a link the guards do not allow yet is stored and replayed after sign-in or onboarding; `/r/{code}` keeps the referral code for after sign-in. Links only navigate; they never perform an action. Controls whose target route has no screen in the build are not rendered.

## Providers and app services

Outer to inner ([`src/providers/AppProviders.tsx`](../apps/mobile/src/providers/AppProviders.tsx)): gesture root → safe area → keyboard controller → `DaUiProvider` (theme from `user_preferences.theme` or the OS, reduce motion, haptics, text size, locale, toast offset) → `I18nProvider` (bootstrap locale → device → `tr`, user time zone) → `QueryProvider` (persisted cache) → `AuthProvider` (Supabase session), plus the `SheetHost` and `ToastHost` overlays. Before anything renders, `bootApp()` runs the first-run keychain purge, opens the encrypted stores, loads UI preferences, binds connectivity, the offline queue and analytics delivery, and creates the notification channels.

| Service | Implementation |
| --- | --- |
| Sign-in | Apple (native on iOS; web OAuth on Android when the Supabase provider is on), Google (native `@react-native-google-signin`), Microsoft (Supabase `azure`, PKCE in the system browser) and email one-time code. Providers the project has not enabled show "Harici kimlik bilgisi gerekli" instead of a button ([`src/lib/auth/`](../apps/mobile/src/lib/auth)). The Apple authorization code is exchanged server-side for revocation at deletion. |
| Session storage | The Supabase session lives in MMKV `da-session` encrypted with an AES key kept in SecureStore (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`); cache and preferences in encrypted MMKV `da-cache` / `da-prefs`; AsyncStorage is banned by lint and a test ([`src/lib/storage.ts`](../apps/mobile/src/lib/storage.ts)). A first-run flag outside the keychain purges a stale session after reinstall. Token refresh runs only in the foreground. |
| Data | Edge `api` through `@da/api-client`; owner rows and RPCs through PostgREST under RLS ([`src/lib/postgrest.ts`](../apps/mobile/src/lib/postgrest.ts), [`src/lib/data/rpc.ts`](../apps/mobile/src/lib/data/rpc.ts)); TanStack Query with an MMKV persister for queries that opt in with `meta.persist` (7 days, busted per app version; mail originals, drafts, assistant streams and privacy statuses never persist). No Supabase Realtime (R-19): counts refresh on push, foreground and after mutations. |
| Sign-out | The registered cleanup hooks ([`src/lib/auth/logout.ts`](../apps/mobile/src/lib/auth/logout.ts)) run: RevenueCat log-out, push unregister, widget snapshot cleared, share staging, audio and on-device TTS files deleted, the Android signal buffer, offline queue and analytics buffer emptied, the device-calendar task removed and local reminders cancelled; then the encrypted stores are wiped. A sign-out done offline finishes the session revoke and device unregister on the next start. |
| Purchases | RevenueCat (`react-native-purchases`), configured after sign-in with `appUserID = user.id`; the Test Store key in development and demo builds when present (refused in production). Every customer-info update is mirrored with `POST /purchases/sync`; the server entitlement stays authoritative ([`src/lib/purchases.ts`](../apps/mobile/src/lib/purchases.ts)). |
| Demo mode | `EXPO_PUBLIC_DEMO_MODE=true` builds (the `e2e` profile) talk to a backend seeded with the demo canon; `dijitalasistan-e2e://demo/setup?scenario&clock&locale&theme` resets local state, pins the clock and sets language and theme for Maestro and screenshot runs. Production builds refuse demo mode unless `ALLOW_DEMO_IN_PRODUCTION=true`. |

## Offline queue

[`src/lib/offline/`](../apps/mobile/src/lib/offline): one ordered, persisted queue (encrypted `da-prefs`) of the internal, idempotent writes the specs allow offline. Everything with an external side effect (approvals, sends, provider writes, purchases, privacy actions, integrations) is blocked before the call with an offline message.

| Kind | Class | Call |
| --- | --- | --- |
| `insight_status` | last write wins | RPC `set_insight_status` |
| `insight_feedback` | idempotent | RPC `apply_insight_feedback` (`p_client_mutation_id`) |
| `commitment_status` | last write wins | RPC `set_commitment_status` |
| `own_row` | last write wins per table | PostgREST patch of `user_preferences`, `notification_preferences`, `profiles` |
| `feedback` | idempotent | `POST /feedback` |
| `reminder_create`, `reminder_cancel` | idempotent | `POST /reminders` (`client_reminder_id`), cancel |
| `briefing_opened`, `notification_opened` | idempotent | `mark_briefing_opened`, `opened_at` |
| `vip_set` | last write wins | VIP toggle and settings |
| `meeting_note` | idempotent | `POST /meetings/:eventId/notes` (`client_note_id`) |

Rules: FIFO per scope, up to four scopes in parallel; the idempotency key is fixed at enqueue time; `AUTH_REQUIRED` stops the replay and keeps the queue; entries of another user are discarded; network, timeout and 5xx failures back off from 1 s to 60 s; a terminal 4xx drops the entry, refreshes the affected queries (the optimistic value reverts) and reports it; at most 200 entries and 7 days. Replays run on reconnect and on every foreground. The offline banner appears after 2 s without a connection and flashes "Güncel · {HH:mm}" on reconnect.

## Notifications

[`src/lib/notifications/`](../apps/mobile/src/lib/notifications):

- **Channels and categories** are created at first launch, before any permission prompt: the Android channels from `ANDROID_CHANNELS` in `@da/domain` (`briefings`, `critical_email`, `meetings`, `deadlines`, `follow_up`, `life_intel`, `approvals`, `reminders`, `account`, `phone_digest`), localised, all `lockscreenVisibility = PRIVATE`; iOS categories per notification category plus `da_reminder` ("1 saat ertele", "Tamamlandı"), with the hidden-preview text "Dijital Asistan güncellemesi". `critical` is never used and the badge is never set.
- **Registration**: the OS prompt runs only from a user action (onboarding "Bildirimleri Aç", the settings banner, the reminder sheet). With permission the app gets the Expo push token (needs `EXPO_PUBLIC_EAS_PROJECT_ID`) and calls `POST /devices/register`; it re-registers when the token, permission, locale, time zone, app version or platform capabilities change, and unregisters at sign-out. The body carries `platform_capabilities` ([`src/lib/platform-capabilities.ts`](../apps/mobile/src/lib/platform-capabilities.ts)): booleans the device actually read — exact alarms, Time Sensitive and lock-screen previews (iOS), the notification listener's availability, grant and binding (Android), background-task availability, the placed widget families, on-device Turkish recognition and an installed Turkish voice. A probe that fails leaves its key out; the server keeps only the keys valid for the platform in `app_installations.platform_capabilities`.
- **Payload and routing**: pushes carry `{type, entity_id, deeplink}` and server-rendered text only. A tap goes through the deep-link allow-list, falls back to the route for `type` + `entity_id`, and opens Today for anything unknown; while the guards are closed the route is stored and replayed. Opening never performs an action. In the foreground there is no system banner: an in-app toast with "Aç" appears and the related queries refresh. Opens are tracked (`notification_opened`) and `opened_at` is written (queued offline).
- **Local reminders**: user reminders are scheduled on the device (`reminder:{client_reminder_id}`), fire offline and in quiet hours by design, render at the user's effective detail level, and are reconciled with the server rows on sign-in, cold start, foreground and detail-level changes. On Android `expo-notifications` schedules them exactly (`setExactAndAllowWhileIdle`) when the "Alarms & reminders" access is granted and inexactly otherwise; the reconciliation reschedules them, so they turn exact once it is granted. The reminder sheet explains a missing access ("İzni Aç") and, on iOS, Time Sensitive notifications that are off; Settings › Bildirimler shows the same Time Sensitive card and a delivery footnote. Quiet hours, caps and dedupe for pushes are evaluated server-side.
- **Background refresh push** ([`src/features/integrations/device-refresh-push.ts`](../apps/mobile/src/features/integrations/device-refresh-push.ts)): the data-only `device_refresh` push the server sends before a morning or evening briefing (KNOWN_PLATFORM_LIMITATIONS KPL-12) is handled by the `da-background-notification` task (`expo-notifications` `registerTaskAsync`, registered while a device calendar is connected) and, in the foreground, by the notification handler without a toast: it uploads the device-calendar snapshot and refreshes the widgets, one run at a time. The briefing (morning, evening) and Today compare the device schedule the briefing used with the current one and show the change banner or the stale note ([`src/features/briefing/device-freshness.ts`](../apps/mobile/src/features/briefing/device-freshness.ts)).

## Platform module (`da-platform`)

[`modules/da-platform`](../apps/mobile/modules/da-platform) reads capability states no Expo API exposes and opens the matching system settings (KNOWN_PLATFORM_LIMITATIONS KPL-04, KPL-07, KPL-09):

| Call | Platform | Native source |
| --- | --- | --- |
| `exactAlarmState()` / `openExactAlarmSettings()` | Android (`not_required` on iOS and below API 31) | `AlarmManager.canScheduleExactAlarms`; `ACTION_REQUEST_SCHEDULE_EXACT_ALARM` for the app |
| `batteryOptimization()` / `openBatteryOptimizationSettings()` | Android | `PowerManager.isIgnoringBatteryOptimizations`; `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` (never the direct exemption prompt) |
| `timeSensitiveSetting()` / `openNotificationSettings()` | iOS | `UNNotificationSettings.timeSensitiveSetting`; `UIApplication.openNotificationSettingsURLString` (the app settings elsewhere) |

Every call is guarded: a missing module (Expo Go, unit tests) or a native error reads as unknown (`null`) and screens show nothing for an unknown state. The decision rules live in the pure-Kotlin `PlatformRules.kt` (JVM tests with `ni:test`); [`src/lib/platform-state.ts`](../apps/mobile/src/lib/platform-state.ts) re-reads the states on every return to the foreground. The config plugin declares `SCHEDULE_EXACT_ALARM` and the `com.apple.developer.usernotifications.time-sensitive` entitlement, refuses `USE_EXACT_ALARM` and `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, and the prebuild smoke asserts the generated manifest, entitlements and autolinking.

## Widgets

- **iOS** ([`targets/widget`](../apps/mobile/targets/widget)): `DATodayWidget` (small, medium, large) and `DALockWidget` (inline, circular, rectangular). The extension has no network access and no tokens; it renders the `WidgetSnapshotV1` the app writes to the variant's App Group.
- **Android** ([`modules/da-widgets`](../apps/mobile/modules/da-widgets)): Jetpack Glance widgets `DaNextWidget` (2×2) and `DaTodayWidget` (4×2, resizable to 3×2), home screen only, with strings and colours generated from `@da/i18n` and `@da/design-tokens` (`pnpm --filter @da/mobile widgets:generate`).
- **Refresh** ([`src/features/widgets/`](../apps/mobile/src/features/widgets)): the app fetches `GET /widgets/snapshot` (rendered server-side under the notification detail level), validates it and writes it through `DaWidgets` on sign-in, foreground (5-minute floor), a Today refetch, a push in the foreground, count-changing mutations, detail-level, language and entitlement changes, and the `da-background-refresh` task. An unchanged `etag` does not redraw. The local detail level is a ceiling: a snapshot never shows more than the level last chosen on the device. Sign-out writes a signed-out snapshot. Server links are rewritten to the build's scheme.
- Widgets are read-only: every tap is a deep link with `?src=widget&w=<family>` for the `widget_opened` event.

## Background work

Three `expo-background-task` tasks, each best effort and scheduled by the OS:

| Task | Registered when | Does |
| --- | --- | --- |
| `da-background-refresh` (≥30 min) | signed in | Runs the registered steps; today the widget snapshot refresh ([`src/lib/background-refresh.ts`](../apps/mobile/src/lib/background-refresh.ts)) |
| `da-device-calendar-upload` (≥15 min) | a device calendar (Apple / Android) is connected | Uploads the selected calendars' snapshot (`POST /integrations/device-calendar/snapshot`) |
| `da-ani-upload` (≥15 min) | Android notification intelligence is on | Uploads buffered structured signals |

Plus one `expo-notifications` background task, `da-background-notification`, registered while a device calendar is connected, for the pre-briefing `device_refresh` push (see Notifications).

Foreground refresh is the primary path; server work (sync, briefings, AI, pushes) never depends on the app running.

## Share into the app

`expo-share-intent` provides the iOS share extension "Dijital Asistan'a Ekle" (target `DijitalAsistanaEkle`, bundle `<bundle>.share-extension`, the variant's App Group) and the Android `ACTION_SEND` / `ACTION_SEND_MULTIPLE` filters (`text/*`, `image/*`, `application/pdf`; multiple: images and PDFs). The `da-share` config plugin fails the build when the App Groups differ and sets the Android `singleTask` launch mode. The payload is staged into the app cache at once (at most 5 items; images ≤15 MB, PDF ≤20 MB, text ≤20,000 characters), stored as the capture draft, and the capture flow opens (`/capture?entry=share`); signed-out users continue after sign-in, Free users see the Pro gate with the payload kept. Analysis still needs an explicit "Analiz Et". ([`src/features/capture/ShareIntakeBridge.tsx`](../apps/mobile/src/features/capture/ShareIntakeBridge.tsx), [`modules/da-share`](../apps/mobile/modules/da-share))

In the composer, pasting text or a link uses the iOS 16+ system paste control (`ClipboardPasteButton`, no "Allow Paste" prompt) where available and otherwise a "Yapıştır" chip that reads the clipboard only after the tap ([`src/features/capture/PasteControl.tsx`](../apps/mobile/src/features/capture/PasteControl.tsx)).

## Android notification intelligence

Android only and Pro ([`modules/notification-intelligence`](../apps/mobile/modules/notification-intelligence), [`src/features/android-ni`](../apps/mobile/src/features/android-ni)):

- The config plugin adds `DaNotificationListenerService` (bound only by the system through `BIND_NOTIFICATION_LISTENER_SERVICE`, filter types conversations and alerting) and a launcher `<queries>` entry, so the app picker works without `QUERY_ALL_PACKAGES`.
- The user opts in on "Telefon Bildirimleri" (`/settings/android-notifications`, or the onboarding step) after the prominent disclosure sheet; "Bildirim Erişimini Aç" opens the system detail screen for the listener (API 30+) or the list. The live grant is re-checked on focus and foreground; after two returns without a grant the restricted-settings help appears.
- The Kotlin service drops every notification that looks like a verification code or security message (Turkish and English keywords with 4–8 digit codes), secret-visibility and call notifications, system-redacted text and the locked groups (authenticators, password managers, e-Devlet, messaging, Google Play services, the app itself), then extracts structured signals only (category, amount, due date, tracking status, flight number, gate, time). Signals wait in an AES-256-GCM buffer keyed in the Android Keystore under `noBackupFilesDir` for at most 24 h; no notification text is stored or sent.
- Uploads rebuild each signal from the allow-listed fields and validate it against the strict `AniSignal` schema before `POST /android-notifications/signals`; the server answers 402 for Free, 403 for a non-Android client and 503 when `feature.android_ni` is off.
- Listener health (KPL-04): the service records binding and the last observed notification; `getListenerState()` returns a verdict from the pure-Kotlin `ListenerHealth` rules. On focus and foreground an unbound listener gets one `requestRebind()`; still unbound after 10 s, or silent for 24 h, the screen shows a health card with "Yeniden bağla" and "Pil ayarlarını aç" (the battery-optimisation list through `da-platform`), cleared by the module's `onListenerChanged` event ([`src/features/android-ni/health.ts`](../apps/mobile/src/features/android-ni/health.ts)).
- On iOS the module reports the feature as unavailable and the routes redirect to settings.

## Audio and voice

- **Briefing player** (`briefing/[id]/listen`, [`src/features/briefing/ListenScreen.tsx`](../apps/mobile/src/features/briefing/ListenScreen.tsx)): `POST /briefings/:id/audio` decides the mode. Premium: the signed file is downloaded once per version and played with `expo-audio` (seek, ±15 s, 1.0/1.25/1.5×, chapters, lock-screen controls, offline replay). Native: `da-tts` synthesizes each chapter on the device (`AVSpeechSynthesizer.write` on iOS, `TextToSpeech.synthesizeToFile` on Android; best offline `tr-TR` voice first) into cached files played as a playlist with the same controls. If the module is missing or synthesis fails, `expo-speech` reads the script sentence by sentence with estimated positions. Device-voice modes carry the notice "Cihaz sesiyle okunuyor", and without an installed Turkish voice the player offers the engine's voice-data install (Android) or names the iOS Settings path. Playback starts only from a tap; background playback uses the iOS `audio` background mode and the `expo-audio` media-playback service on Android.
- **Playback session and mini player** ([`src/features/briefing/player/`](../apps/mobile/src/features/briefing/player)): the engines (premium file, synthesized playlist, `expo-speech`) run in `AudioPlayerHost`, mounted once in the root layout, over a small session store; the full player only renders the session. Leaving it keeps playback going in the `@da/ui` `MiniPlayer` (M-GL-14, DEV-52), docked above the tab bar and above the sticky CTA of `briefing/[id]`: play / pause, the body re-opens the full player, close stops playback and clears the lock-screen controls (`mini_player_action`). Sign-out stops the session.
- **Voice mode** (`voice`, [`src/features/voice/`](../apps/mobile/src/features/voice)): on-device `expo-speech-recognition` (`tr-TR`, 60 s maximum) first; when the device has no on-device recognizer and the `voice.stt_server` flag is on, the utterance is recorded (AAC) and sent to `POST /assistant/transcribe`, where it is deleted after transcription; otherwise the screen offers "Metinle sor". The on-device recognizer is probed on entry and on every return ([`availability.ts`](../apps/mobile/src/features/voice/availability.ts)): Android 13+ without the Turkish offline model offers "Türkçe modeli indir"; Android without any recognition service offers "Konuşma hizmetini yükle" (Play Store); the server path shows its privacy notice until the first successful server transcription. A write intent shows an approval card that only a tap approves (`approved_via='voice_card'`); a spoken "onayla" never approves.

## Analytics and error monitoring

- **Analytics** ([`src/lib/events.ts`](../apps/mobile/src/lib/events.ts), [`src/lib/analytics.ts`](../apps/mobile/src/lib/analytics.ts)): `track()` accepts only catalogue events from `@da/domain` with content-free props (closed enums, booleans, bounded integers, screen ids, route patterns), validated twice. Events wait in an encrypted buffer (≤500, 24 h) and go to `POST /analytics/events` in batches of ≤50 (after 20 events, every 30 s in the foreground, and on background). `user_preferences.analytics_opt_out` stops buffering and sending and discards the buffer; builds with `EXPO_PUBLIC_ANALYTICS_ENABLED=false` never register the sink.
- **Sentry** ([`src/lib/sentry.ts`](../apps/mobile/src/lib/sentry.ts)): starts only when `EXPO_PUBLIC_SENTRY_DSN` is set; `sendDefaultPii:false`, no screenshots, no view hierarchy, no Session Replay, no user id; one scrubber for events and breadcrumbs removes emails, tokens, JWTs, Supabase keys, push tokens, secret query parameters and content-like fields; HTTP breadcrumbs keep method, route template and status only. Release is `<application id>@<version>+<build>`, environment the build variant. The startup time (module load → splash hidden) is recorded as a span when Sentry runs. The EAS build uploads source maps when `SENTRY_AUTH_TOKEN` and `SENTRY_ORG` are set (`sentryUploadEnabled` in `app.config.ts`) and skips the upload otherwise, so builds without the token never fail on it. Events carry `intl_fallback` on engines that needed the `Intl` repair below.

## Accessibility

- Every screen route is opened in the real app in the dark theme by [`test/a11y/routes.test.tsx`](../apps/mobile/test/a11y/routes.test.tsx), which checks roles and labels on every pressable, 44 pt hit targets (the kit's `hitSlop` / `minHeight`; 48 dp on Android), a heading per screen, Dynamic Type not disabled outside the fixed-size share card, labelled or hidden images, and that no light-only colour paints in dark mode. [`test/a11y/text-expansion.test.tsx`](../apps/mobile/test/a11y/text-expansion.test.tsx) renders the key screens (Today, Flow, mail detail, approval sheet, settings hub, paywall) with the pseudo-locale (+40 % per text run) at the largest text size and checks that nothing is clipped.
- Text size (Settings › Görünüm): System, Small, Large, Extra large as a multiplier over the OS scale, capped at 2× in `@da/ui`. Reduce motion replaces movement with fades; haptics can be turned off.
- Upper-case kickers and badges are produced with the Turkish-aware `toUpper` of `@da/i18n` (never `textTransform: 'uppercase'`, which maps "i" to "I" instead of "İ"). Colours come only from tokens; the contrast pairs are tested in `@da/design-tokens`. The lint config bans `textTransform: 'uppercase'`, runtime `toUpperCase()`, `'TL'` literals and the `Intl` constructors Hermes lacks in app and kit code.
- `Intl` on Hermes (KPL-27): [`src/lib/intl-setup.ts`](../apps/mobile/src/lib/intl-setup.ts), imported by `index.ts` before the router entry, runs `ensureIntl()` of `@da/i18n`: a Turkish/English `PluralRules` when the engine's is missing or wrong, and a `longOffset` wrapper for `@date-fns/tz` when zone offsets cannot be read directly.
- Tab bar (DEV-20): on iOS the bar is translucent over an `expo-blur` `BlurView`; the kit keeps it opaque on Android and with Reduce Transparency.
- The first open of a morning briefing runs the P:08 staged opening (hero from .4 opacity and 8 px in 240 ms, then the sections from 360 ms at a 60 ms stagger); with reduce motion only the opacity changes.

## Variants and EAS profiles

`app.config.ts` derives every identifier from `APP_ENV`:

| Profile ([`eas.json`](../apps/mobile/eas.json)) | `APP_ENV` | Bundle / package | Scheme | Distribution | Notes |
| --- | --- | --- | --- | --- | --- |
| `development` | `development` | `com.dijitalasistan.app.dev` | `dijitalasistan-dev` | internal | dev client |
| `preview` | `preview` | `…app.preview` | `dijitalasistan-preview` | internal | |
| `e2e` | `e2e` | `…app.e2e` | `dijitalasistan-e2e` | internal (APK, iOS simulator) | demo mode on; Android cleartext allowed for the local stack |
| `production` | `production` | `com.dijitalasistan.app` | `dijitalasistan` | store, build number auto-incremented (`appVersionSource: remote`) | demo mode off |

The App Group is `group.<bundle id>` of the variant, shared by the app, the widget extension (`<bundle>.widget`) and the share extension (`<bundle>.share-extension`). `runtimeVersion` uses the fingerprint policy; `updates.url` is set when `EXPO_PUBLIC_EAS_PROJECT_ID` is. The config refuses to build when an `EXPO_PUBLIC_*` key is not on the INTEGRATION_PLAN §15 allow-list or holds a secret-shaped value, when production enables demo mode without `ALLOW_DEMO_IN_PRODUCTION=true`, or when production carries the RevenueCat Test Store key. Deployment targets: iOS 16.4; Android min SDK 24, compile and target SDK 36. Permission strings and blocked Android permissions are listed in [STORE_CHECKLIST.md](STORE_CHECKLIST.md#permissions).

## Running the app

The app uses local native modules, so it runs in a **development build**, never in Expo Go.

1. Install and set up the environment as in the [README quickstart](../README.md#quickstart). The app reads only the `EXPO_PUBLIC_*` allow-list ([`src/lib/env.ts`](../apps/mobile/src/lib/env.ts)); `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are required.
2. Build a dev client once per native change: `eas build --profile development --platform ios|android` (External credential required: `EXPO_TOKEN`), or locally with Xcode / the Android SDK: `pnpm --filter @da/mobile exec expo run:ios` / `expo run:android`.
3. Start Metro for the dev client: `pnpm --filter @da/mobile start` (`expo start --dev-client`).

Other commands: `pnpm --filter @da/mobile export` (bundle export), `pnpm mobile:check` (`expo install --check`, bundle export, prebuild smoke), `pnpm --filter @da/mobile prebuild:smoke`, `pnpm --filter @da/mobile assets` (app icons and splash), `pnpm --filter @da/mobile licenses`.

## Tests

| Suite | Command | Where it runs |
| --- | --- | --- |
| Jest (jest-expo + React Native Testing Library): unit, screen, journey, a11y and text-expansion suites under `test/`, with the real router and providers | `pnpm --filter @da/mobile test` | container, CI `unit` |
| Prebuild smoke: variant identifiers, plist and privacy manifest keys, blocked permissions, share and widget targets, autolinking | `pnpm mobile:check` | container, CI `mobile` |
| Android notification-intelligence and `da-platform` rules (pure Kotlin, JVM: detectors, package rules, listener health, exact-alarm and battery states) | `pnpm --filter @da/mobile ni:test` | CI `mobile` (needs Java 17 and Gradle) |
| Maestro flows (`.maestro/flows/{m102,acceptance,screens,security}`, tags `android` / `ios`) | `scripts/e2e/start-stack.sh` + `scripts/e2e/run-maestro-android.sh` | CI `Mobile E2E` (Android emulator); EAS Workflows (iOS simulator, Android on demand) |

Coverage: Jest collects `src/**` and `app/**`. The TEST_PLAN §16 target for the app is 75 % lines, 65 % branches, 75 % functions; the `coverageThreshold` in [`jest.config.js`](../apps/mobile/jest.config.js) is currently a regression floor below that target and is raised as screen-state tests land. Details, including the flake policy, are in [TESTING.md](TESTING.md).

## Differences from the plan

| Plan | As built | Reason |
| --- | --- | --- |
| INTEGRATION_PLAN §9 / TEST_PLAN: push `data` includes `v` and `nid` | `{type, entity_id, deeplink}` only (`pushData` in `@da/domain`) | The payload is a trigger; everything else is re-read in the app. The handler reads nothing else from `data`. |
| KNOWN_PLATFORM_LIMITATIONS KPL-11: exactly one background task running every step | Three periodic tasks (widgets, device calendar, Android signals) plus `da-background-notification` | Each task is registered and removed with its own feature (device calendar connected, NI on). |
| KPL-12: `scheduler_tick()` sends the `device_refresh` push 40 min before the briefing time | The `briefing` job sends it when generation starts and generates 3 min later, once | The scheduler is SQL and no migration range was assigned; the deferral keeps the wait bounded. |
| KPL-10: AlarmKit "Alarm Kur" in `da-platform` | Not built | The plan places it on the Today evening card and the flight detail, which do not host it; the module covers the states the reminder sheet uses. |
| Registry proposal: an admin view of `platform_capabilities` | Sent and stored; not shown in the backoffice | The backoffice has no installation-details view (only the push-test device picker). |
| KPL-20: fallback share extension with its own UI if App Review rejects the redirect | The `expo-share-intent` extension (redirects into the app) only | The fallback is kept as the documented response to a rejection ([STORE_CHECKLIST.md](STORE_CHECKLIST.md#share-extension-openurl-risk)). |
| TEST_PLAN §9: E2E build uses the production app id and `APP_ENV=ci` | `com.dijitalasistan.app.e2e`, `APP_ENV=e2e` | Keeps E2E builds installable next to other variants; `ci` is not an `APP_ENV` value. |
| Apple Reminders permission asked at calendar connect | Asked in the reminder sheet (and by the device executor) when Apple Reminders is picked | Asking at the moment of use is the smaller permission surface. |
| M-CAP-03: mail attachments in the file sheet with the sheet CTA "Analiz Et"; PDF, TXT, ICS and images | PDFs and images only (the capture bucket's types); the rows come from `email_messages.attachment_meta` of the 20 latest mails with attachments of accounts whose "Ekleri analiz et" is on, and "Analiz Et" asks `GET /mail/:messageId/attachments` for a fresh ref, then `POST /captures` → analyze → `capture/[id]` ([`capture/mailAttachments.tsx`](../apps/mobile/src/features/capture/mailAttachments.tsx)); Mail Detail's "Ekle'ye gönder" opens a confirm sheet with the same "Analiz Et" instead of M-MAIL-04 | The capture pipeline accepts no text or calendar files; the stored metadata keeps the sheet local and cheap, and refs are signed per tap (never persisted). |
| TEST_PLAN §16: app coverage 75/65/75 | Enforced as a lower regression floor | See [TESTING.md](TESTING.md#coverage). |

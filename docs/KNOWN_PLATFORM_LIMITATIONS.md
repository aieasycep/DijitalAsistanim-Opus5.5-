# Dijital Asistan: Known Platform Limitations

Documented at `ec14e92`. This register lists what each platform (iOS, Android, Google, Microsoft, Apple, the stores, RevenueCat, Supabase, AI vendors, the build environment) **cannot do**, or does only with constraints that change product behaviour, and what the product does instead **as built**. It started as the planning register (research date 2026-09-23); every "As built" line below was checked against the code at the commit above. Binding requirements: M§91 (platform limitations) and M§141 (realism).

Related documents: [MOBILE.md](MOBILE.md) (app services), [STORE_CHECKLIST.md](STORE_CHECKLIST.md) (store-relevant limits), [TESTING.md](TESTING.md) (where checks run), [OAUTH.md](OAUTH.md) and [AI_PIPELINE.md](AI_PIPELINE.md) (provider and AI detail), [PRIVACY.md](PRIVACY.md).

## 0. How to read an entry

Each entry has:

- **Limitation**: what the platform cannot do.
- **Evidence**: a source with a tag. **[OFF]** official source read during planning; **[OFF-S]** official source seen only through a search excerpt; **[SEC]** third-party source; **[KNOW]** engineering knowledge that could not be fetched during planning and must be re-verified (§11). The product behaviour stays conservative either way.
- **As built**: what the product does, with the code that does it.
- **User sees**: the copy or state the user meets (i18n namespace in `packages/i18n/messages/<locale>/`), or nothing.
- **Verified**: *unit* (Jest / Vitest / Deno / pgTAP in the container and CI), *CI* (GitHub Actions only), *EAS* (native builds), *device* (owner, on physical devices; not automated).
- **Plan difference**: where the plan's behaviour was not built or was built differently.

IDs are `KPL-01` … `KPL-61`; other documents reference them and they are never reused.

## 1. Policy

1. **Never fake a capability.** No simulated OS or provider state, no local toggle pretending to grant access, no success before the platform confirms it (the NI screen reflects the real system grant; "Gönderildi" appears only on `executed`).
2. **Closest real behaviour, or absent.** When no real substitute exists, the capability is absent on that platform rather than shown as a teaser.
3. **Tell the truth where the user decides** (explainer before an OS prompt, the destination picker, the approval sheet).
4. **No marketing or store claim a platform cannot deliver** (Android NI never in iOS store text or screenshots; no trial, encryption or usage claim beyond what is true). `pnpm quality-gate` enforces the banned product claims of [`scripts/quality-gate/banned-markers.txt`](../scripts/quality-gate/banned-markers.txt) in code and catalogs.
5. **Enforce on the server too.** A platform-limited capability never becomes a client-only path around approvals, entitlements or RLS.

The communication patterns used below: hide (the capability does not exist on this platform), disabled with a reason, inline note, freshness line ("{kaynak} · son eşitleme {saat}"), error card, explainer sheet, settings footnote, and system handoff (`Linking.openSettings()` or a settings intent).

## 2. Platform baselines

iOS deployment target **16.4** (iPhone only); Android min SDK **24**, compile and target SDK **36** ([`app.config.ts`](../apps/mobile/app.config.ts), asserted by the prebuild smoke).

| OS level | Capability that appears or changes | Product handling as built |
| --- | --- | --- |
| iOS 15 | Time Sensitive interruption level | Used for meetings, expiring approvals and user reminders (KPL-07) |
| iOS 16 | Lock Screen accessory widgets; paste prompts | Lock widgets built (KPL-18); clipboard read only on tap (KPL-23) |
| iOS 16.4 | Minimum supported | Legacy calendar and reminders usage keys kept (KPL-13) |
| iOS 17 | EventKit full / write-only split | Full access only (KPL-13) |
| iOS 18 | Widget accented / tinted rendering | Handled by the widget views (KPL-18) |
| iOS 26 | AlarmKit | Not used (KPL-10) |
| Android 8 (26) | Notification channels mandatory | Ten channels created at first launch (KPL-08) |
| Android 11 (30) | Notification-listener detail settings intent | Used for "Bildirim Erişimini Aç" (KPL-02) |
| Android 12 (31) | Exact-alarm permission; notification trampolines blocked | `SCHEDULE_EXACT_ALARM` declared, no in-app check (KPL-09); taps start the activity directly |
| Android 13 (33) | `POST_NOTIFICATIONS`; restricted settings for sideloads; photo picker | KPL-08, KPL-02, KPL-22 |
| Android 14 (34) | Exact alarms denied by default on new installs; typed foreground services | KPL-09; `expo-audio` declares the media-playback service (KPL-26) |
| Android 15 (35) | OTP redaction for untrusted listeners; edge-to-edge | Own OTP drop on every version (KPL-03) |
| Android 16 (36) | Standby-bucket quotas for background work | Background tasks are best effort (KPL-11) |

## 3. iOS vs Android capability parity

| # | Capability | iOS | Android | As built | KPL |
| --- | --- | --- | --- | --- | --- |
| 1 | Read other apps' notifications | ✗ no API | ✓ user-granted listener | Android-only, Pro, opt-in; hidden on iOS | 01–04 |
| 2 | Read device calendar | ✓ full access only | ✓ `READ_CALENDAR` | Snapshot upload from the device | 12, 13 |
| 3 | Device reminders / tasks | ✓ Apple Reminders | ✗ | Apple Reminders destination on iOS only; Google Tasks / Microsoft To Do on both | 16 |
| 4 | Write device calendar | ✓ on device | ✓ on device | Device executor completes the approval on that device | 14 |
| 5 | Periodic background work | BGTaskScheduler, system-decided | WorkManager, ≥15 min, quotas | Best effort; foreground is primary | 11 |
| 6 | Silent push wake | throttled, none after force-quit | deferred in Doze | Not used | 11, 12 |
| 7 | Home-screen widgets | small, medium, large | 2×2, 4×2 | Read-only, deep links | 17, 19 |
| 8 | Lock-screen widgets | ✓ inline, circular, rectangular | ✗ on phones | iOS only | 18, 19 |
| 9 | Share into the app | Share extension + redirect | `ACTION_SEND` / `SEND_MULTIPLE` | One capture flow | 20, 21 |
| 10 | Exact-time local reminder | ✓ calendar trigger | Needs "Alarms & reminders" on 14+ | Date trigger; exactness is the OS's decision | 09 |
| 11 | System alarm | AlarmKit (26+) | Clock app handoff | Not offered | 10 |
| 12 | Lock-screen content privacy | Show Previews setting | channel visibility + OS setting | Server renders the detail mode; channels `PRIVATE` | 06 |
| 13 | On-device Turkish STT | device-dependent | device-dependent | Server fallback behind a flag | 24 |
| 14 | Turkish TTS voice | built-in / downloadable | engine-dependent | On-device synthesis to file; premium optional | 25 |
| 15 | Sign in with Apple | native | web OAuth | Both offered | 49 |
| 16 | Install referral attribution | ✗ | ✓ Play Install Referrer | Android reads the referrer; iOS types the code | 31 |
| 17 | Keychain after uninstall | persists | removed | First-run purge | 30 |
| 18 | Expo Go | ✗ (local native modules) | ✗ | Development builds only | 31, 59 |

## 4. Register: mobile operating systems

### A. Notifications and system access

#### KPL-01 · iOS has no system-wide notification stream

- **Limitation.** No iOS API lets an app read other apps' notifications; a Notification Service Extension only mutates the app's own pushes.
- **Evidence.** [KNOW] https://developer.apple.com/documentation/usernotifications/unusernotificationcenter ; https://developer.apple.com/documentation/usernotifications/unnotificationserviceextension ; M§36/M§91.
- **As built.** Android notification intelligence is Android-only: the `notification-intelligence` module loads only on Android ([`modules/notification-intelligence/src/index.ts`](../apps/mobile/modules/notification-intelligence/src/index.ts)); the onboarding step is skipped on iOS ([`onboarding/steps.ts`](../apps/mobile/src/features/onboarding/steps.ts)); `/settings/android-notifications` redirects to `/settings` on iOS; the paywall row is added only on Android; `POST /android-notifications/signals` answers 402 for Free and then 403 `android_only` for a non-Android client. iPhone users get shipment, flight and payment signals from connected mail and from capture/share.
- **User sees.** Nothing on iOS. The shared FAQ (`faq` namespace, also on web `/support`) explains that the feature exists only on Android because iOS does not allow it.
- **Verified.** unit (Jest platform tests; Deno `api/android-notifications.test.ts`).

#### KPL-02 · Android 13+ restricted settings block notification access for sideloaded builds

- **Limitation.** Apps not installed from a store (including EAS internal APKs) cannot get notification-listener access until the user taps "Allow restricted settings" in App info; Android 15 widened the list. Play-installed builds are unaffected.
- **Evidence.** [SEC] https://www.xda-developers.com/android-13-restricted-setting-notification-listener/ ; [SEC] https://www.androidauthority.com/android-15-restricted-settings-sideloading-3481098/
- **As built.** "Bildirim Erişimini Aç" opens `ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS` for the listener (API 30+) and falls back to the list screen. The grant is re-checked on focus, foreground and the module's `onGrantChanged` event; after two returns without a grant the restricted-settings help appears ([`AndroidNotificationsScreen.tsx`](../apps/mobile/src/features/android-ni/AndroidNotificationsScreen.tsx)).
- **User sees.** The `android_ni` restricted-settings help ("Uygulama bilgisi › ⋮ › Kısıtlı ayarlara izin ver").
- **Verified.** unit (Jest `android-ni-screens.test.tsx`); device (sideloaded APK on Android 13 and 15).

#### KPL-03 · Android OTP redaction (15+), none on 10–14, screen-share hiding

- **Limitation.** Android 15 hides OTP notification content from untrusted listeners; Android 10–14 do not, so bank OTPs reach listeners in clear text. Android 15 also hides notification content during screen sharing. Android 17 delays SMS OTP access for non-default SMS apps (we read no SMS).
- **Evidence.** [OFF] https://developer.android.com/about/versions/15/behavior-changes-all ; [OFF] https://developer.android.com/about/versions/17/behavior-changes-all
- **As built.** The Kotlin service drops, before any extraction and on every Android version: verification-code and security messages (Turkish and English keywords with 4–8 digit codes, [`OtpDetector`](../apps/mobile/modules/notification-intelligence/android/src/main/java/expo/modules/notificationintelligence/OtpDetector.kt)), system-redacted text, `VISIBILITY_SECRET` and call notifications, and the locked groups (authenticators, password managers, e-Devlet, messaging, Google Play services, the app itself). Only structured signals reach the AES-GCM buffer (Keystore key, `noBackupFilesDir`, 24 h). Uploads are rebuilt from allow-listed fields and validated against the strict `AniSignal` schema, so no text field can be sent.
- **User sees.** The assurance copy on the settings screen (`android_ni`): verification codes and security apps are always excluded.
- **Verified.** CI (pure-Kotlin JVM tests of the detectors and package rules, `ni:test`); unit (Deno: the signals route rejects extra fields); device (a bank-style OTP on Android 14 and 15 yields no signal).

#### KPL-04 · The notification listener can be unbound by the system or OEM battery management

- **Limitation.** The system can disconnect a granted listener (updates, memory pressure, OEM "sleeping apps"); `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is Play-restricted.
- **Evidence.** [OFF] https://developer.android.com/reference/android/service/notification/NotificationListenerService ; [KNOW] https://developer.android.com/training/monitoring-device-state/doze-standby#exemption-cases ; [SEC] https://dontkillmyapp.com
- **As built.** The service tracks connect/disconnect internally, but the app shows only the grant (enabled listener packages), not the connection state; there is no rebind call and no battery-optimisation handoff. `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is not declared.
- **User sees.** Nothing specific; a disconnected listener simply produces no new signals ("Son sinyaller" stays unchanged).
- **Verified.** device.
- **Plan difference.** `getListenerState()` / `requestRebind()`, the disconnected status card and the battery-settings handoff were not built.

#### KPL-05 · Push delivery is best-effort and Expo Push has hard limits

- **Limitation.** A ticket `ok` means only that Expo accepted the message; receipts come ~15 min later and expire after 24 h; 100 messages per request, 600/s per project, 4 KB payload; a missing Android channel hides the notification; APNs and FCM coalesce or drop after long offline periods.
- **Evidence.** [OFF] https://docs.expo.dev/push-notifications/sending-notifications/ ; [KNOW] https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/RemoteNotificationsPG/APNSOverview.html ; [KNOW] https://firebase.google.com/docs/cloud-messaging/concept-options#lifetime
- **As built.** Notifications are hints; Today, Flow and the Approval Center always re-read the database. The `notification` job sends in batches of ≤100 with a `ttl` and a collapse id, stores `push_tickets`, disables the token on `DeviceNotRegistered`, and `push_receipts` polls receipts 15 min later ([`services/notifications/`](../supabase/functions/_shared/services/notifications)). The payload is exactly `{type, entity_id, deeplink}` plus the server-rendered text. Channels are created by the app before any prompt.
- **User sees.** Nothing specific.
- **Verified.** unit (Deno notification pipeline and receipts tests).
- **Plan difference.** No delivery footnote under Settings › Bildirimler; no per-app-version channel gating.

#### KPL-06 · Lock-screen privacy: the server cannot see lock state; no per-notification public version through Expo

- **Limitation.** The server cannot know whether the phone is locked; iOS applies "Show Previews"; Android applies channel `lockscreenVisibility` and the OS setting; Expo exposes neither `setPublicVersion()` nor per-message visibility; delivered content is fixed.
- **Evidence.** [OFF] https://docs.expo.dev/versions/latest/sdk/notifications/ ; [OFF] https://developer.android.com/about/versions/15/behavior-changes-all ; [KNOW] https://developer.apple.com/documentation/usernotifications/unnotificationsettings/showpreviewssetting
- **As built.** The server renders each push per `notification_preferences` detail mode (`full`, `title_only` default, `generic`), capped at `title_only` on iOS while `lock_screen_private` is on. Every Android channel is `lockscreenVisibility = PRIVATE`; iOS categories carry the hidden-preview text "Dijital Asistan güncellemesi". Settings › Bildirimler reads iOS `allowsPreviews` and shows it with a link to the system settings.
- **User sees.** `notifications.settings.lockScreen.*`: the lock-screen privacy switch, the iOS preview state ("Her zaman / Kilit açıkken / Hiçbir zaman") and "iPhone'da kilit ekranı önizlemelerini sistem ayarları da etkiler."
- **Verified.** unit (domain render tables; Jest settings screen); device (locked iPhone shows the hidden-preview text).
- **Plan difference.** The iOS preview value is shown locally, not reported to the server (`platform_capabilities` is not sent).

#### KPL-07 · iOS Time Sensitive is user-controllable; Focus and Scheduled Summary can hold notifications; no Critical Alerts

- **Limitation.** Time-sensitive delivery through Focus depends on a per-app user setting; `active` and `passive` notifications can be held; Critical Alerts need a restricted entitlement.
- **Evidence.** [OFF] https://developer.apple.com/documentation/usernotifications/unnotificationinterruptionlevel/timesensitive ; [KNOW] https://developer.apple.com/documentation/usernotifications/unnotificationsettings/timesensitivesetting
- **As built.** The time-sensitive entitlement is in `ios.entitlements`; the server picks the interruption level per push (`interruptionLevelFor` in `@da/domain`); local reminders are `timeSensitive`; `critical` is never used.
- **User sees.** Nothing specific.
- **Verified.** unit (domain interruption levels); device.
- **Plan difference.** The app does not read `timeSensitiveSetting` and shows no "Zamana Duyarlı Bildirimler kapalı" row (the `da-platform` module was not built).

#### KPL-08 · Android notification channels and the runtime permission

- **Limitation.** After creation, importance belongs to the user; channels can be disabled; Android 13+ shows the permission prompt only after a channel exists; after a second denial the prompt no longer appears.
- **Evidence.** [OFF] https://docs.expo.dev/versions/latest/sdk/notifications/ ; [KNOW] https://developer.android.com/develop/ui/views/notifications/channels ; [KNOW] https://developer.android.com/develop/ui/views/notifications/notification-permission
- **As built.** The ten channels of `ANDROID_CHANNELS` (`briefings`, `critical_email`, `meetings`, `deadlines`, `follow_up`, `life_intel`, `approvals`, `reminders`, `account`, `phone_digest`) are created at first launch, before any prompt and before the push token, with localised names ([`lib/notifications/channels.ts`](../apps/mobile/src/lib/notifications/channels.ts)). The prompt runs only from a user action. Settings › Bildirimler reads `getNotificationChannelsAsync()` and marks blocked channels.
- **User sees.** "Android ayarlarında kapalı" on a blocked category (tap → app settings); "Bildirimler kapalı" with "Ayarları Aç" when the permission is denied.
- **Verified.** unit (Jest channel-before-token order, notification settings); CI (Maestro notification settings flow).
- **Plan difference.** The blocked-channel row opens the app's settings page, not the channel-specific settings intent.

#### KPL-09 · Android exact alarms need user-granted special access on 14+; `USE_EXACT_ALARM` is Play-restricted

- **Limitation.** Exact scheduling needs `SCHEDULE_EXACT_ALARM`, which is not pre-granted on Android 14+ and can be revoked; `USE_EXACT_ALARM` is restricted by Play; inexact alarms drift in Doze.
- **Evidence.** [OFF] https://docs.expo.dev/versions/latest/sdk/notifications/ ; [KNOW] https://developer.android.com/about/versions/14/changes/schedule-exact-alarms ; [KNOW] https://support.google.com/googleplay/android-developer/answer/12253906
- **As built.** The manifest declares `SCHEDULE_EXACT_ALARM` and blocks `USE_EXACT_ALARM`. User reminders are scheduled with an `expo-notifications` date trigger ([`lib/notifications/local-reminders.ts`](../apps/mobile/src/lib/notifications/local-reminders.ts)); whether delivery is exact depends on the OS grant.
- **User sees.** Nothing; a reminder may arrive a few minutes late when the user has not granted "Alarms & reminders".
- **Verified.** device (Doze test).
- **Plan difference.** No exact-alarm check, warning or settings handoff (the `da-platform` module and the `states.permission.exactAlarm` copy are not wired).

#### KPL-10 · Setting a system alarm ("Alarm Kur")

- **Limitation.** Before iOS 26 apps cannot create system alarms; iOS 26 AlarmKit needs authorisation; Android can only hand off to the Clock app.
- **Evidence.** [KNOW] https://developer.apple.com/documentation/alarmkit ; [KNOW] https://developer.android.com/reference/android/provider/AlarmClock#ACTION_SET_ALARM
- **As built.** No "Alarm Kur" action exists on either platform; the user can set a smart reminder instead (M-REM-01).
- **User sees.** Nothing (the action is absent, not disabled).
- **Verified.** —
- **Plan difference.** The AlarmKit / `ACTION_SET_ALARM` path was not built.

### B. Background execution and device data freshness

#### KPL-11 · Background execution is not guaranteed on either platform

- **Limitation.** `expo-background-task` uses BGTaskScheduler on iOS (system-decided, favours idle, unavailable in the Simulator) and WorkManager on Android (≥15 min, battery and network conditions, standby-bucket quotas, OEM killers). Silent pushes are throttled on iOS and deferred in Doze.
- **Evidence.** [OFF] https://docs.expo.dev/versions/latest/sdk/background-task/ ; [OFF] https://developer.android.com/about/versions/16/behavior-changes-all ; [KNOW] https://developer.apple.com/documentation/backgroundtasks/bgprocessingtaskrequest
- **As built.** Server work (sync, briefings, AI, notifications) never depends on the app. The app registers `da-background-refresh` (≥30 min; widget snapshot), `da-device-calendar-upload` (≥15 min, while a device calendar is connected) and `da-ani-upload` (≥15 min, while Android NI is on). Foreground is the primary refresh path; the offline queue replays on reconnect and foreground only.
- **User sees.** Freshness through widget timestamps and "son eşitleme" lines.
- **Verified.** unit (task registration and step runner); device.
- **Plan difference.** Three tasks instead of one; no `da-background-notification` task for silent refresh pushes.

#### KPL-12 · Device calendars reach the server only when the app runs

- **Limitation.** EventKit and CalendarContract data exist only on the device; change notifications fire only while the app runs; background refresh is best effort, so an 08:00 server briefing can miss device events added since the last upload.
- **Evidence.** [OFF] integrations audit §C.4 ; [KNOW] https://developer.apple.com/documentation/foundation/nsnotification/name-swift.struct/ekeventstorechanged
- **As built.** Selected device calendars are uploaded as a minimal snapshot (−1 … +14 days, hashed identifiers) after the first grant, on foreground, on reconnect and from the background task (`POST /integrations/device-calendar/snapshot`, [`integrations/device-calendar.ts`](../apps/mobile/src/features/integrations/device-calendar.ts)). The server stages it and `device_calendar_ingest` applies it. Briefings record `source_freshness` at generation.
- **User sees.** "son eşitleme {saat}" on device-sourced events and in the account detail (`provenance.lastSynced`, account `lastSync`).
- **Verified.** unit (Jest device calendar; Deno ingest); device.
- **Plan difference.** No pre-briefing `device_refresh` push, no stale note in the briefing and no "Takvimin bu brifingden sonra değişti." banner.

#### KPL-13 · EventKit read requires full access

- **Limitation.** iOS 17+ offers full or write-only access (write-only cannot read); Reminders need separate access; without the full-access key iOS 17 auto-denies; after a denial only Settings can grant.
- **Evidence.** [OFF] https://developer.apple.com/documentation/eventkit/accessing-the-event-store ; [OFF] https://docs.expo.dev/versions/latest/sdk/calendar/
- **As built.** Calendar access is requested only when the user taps connect or "İzin Ver"; Reminders access only when Apple Reminders is picked (reminder sheet, device executor). The full-access and legacy usage keys are set in Turkish and English. A denial opens the calendar-denied sheet with "Ayarları Aç".
- **User sees.** The integration explainer sheet before the prompt; the usage strings in [STORE_CHECKLIST.md](STORE_CHECKLIST.md#ios-usage-strings); the denied sheet.
- **Verified.** unit (prebuild smoke asserts both languages; Jest integrations); device (iOS 16.4 and 17+).

#### KPL-14 · Writes to device destinations run on the device

- **Limitation.** The server cannot write to Apple Calendar, Apple Reminders or the Android device calendar; EventKit cannot add attendees.
- **Evidence.** [KNOW] https://developer.apple.com/documentation/eventkit/ekparticipant ; [OFF] https://docs.expo.dev/versions/latest/sdk/calendar/
- **As built.** Approvals to device destinations carry `executor='device'` and complete on the device ([`approvals/device-executor.ts`](../apps/mobile/src/features/approvals/device-executor.ts)): the target is searched for the `[da:{approval_id}]` marker first (no double write after a crash), the item is written with `expo-calendar`, and the result is reported through `POST /approvals/:id/device-execution` with the hashed installation id. The scheduler fails an `executing` device approval after 10 minutes with `DEVICE_RESULT_MISSING`.
- **User sees.** Approval states; a failed write with its reason (permission denied, read-only calendar, …).
- **Verified.** unit (Jest device executor; pgTAP scheduler; Deno route).

#### KPL-15 · The same calendar can arrive twice (OAuth provider + device calendar)

- **Limitation.** A Google or Exchange account connected by OAuth may also be configured on the device, so its events appear again through EventKit or CalendarContract.
- **Evidence.** [KNOW] https://developer.apple.com/documentation/eventkit/ekcalendaritem/calendaritemexternalidentifier ; [OFF] integrations audit §X.1
- **As built.** The user picks which device calendars to share (holiday, birthday and subscribed calendars start deselected). The server stores `ical_uid` but does not merge duplicates across sources.
- **User sees.** Possibly the same event twice when the same account is connected both ways.
- **Verified.** —
- **Plan difference.** Auto-deselecting device calendars that match an OAuth account and cross-source dedupe were not built.

#### KPL-16 · Apple Reminders is iOS-only; Android has no system tasks store

- **Limitation.** The `expo-calendar` reminder APIs are iOS-only; Android has no platform tasks API.
- **Evidence.** [OFF] https://docs.expo.dev/versions/latest/sdk/calendar/
- **As built.** The reminder sheet offers Apple Reminders only on iOS; both platforms offer in-app reminders, Google Tasks and Microsoft To Do. Onboarding and accounts show "Apple Takvim" on iOS and "Cihaz takvimi" on Android.
- **User sees.** Only the destinations the platform supports.
- **Verified.** unit (Jest reminders).

### C. Widgets

#### KPL-17 · WidgetKit refresh budget, extension memory and data protection

- **Limitation.** About 40–70 timeline reloads a day per widget (foreground reloads are free); entries should be ≥5 min apart; extensions have ~30 MB; App Group data can be unreadable before first unlock.
- **Evidence.** [OFF] https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date ; [SEC] Apple Developer Forums 713561 ; [KNOW] https://developer.apple.com/documentation/foundation/fileprotectiontype/completeuntilfirstuserauthentication
- **As built.** The app fetches `GET /widgets/snapshot` (rendered server-side under the detail mode), validates `WidgetSnapshotV1` and writes it to the App Group `UserDefaults` through `DaWidgets` on sign-in, foreground (5-min floor), Today refetch, pushes in the foreground, count-changing mutations, setting changes and the background task; an unchanged `etag` does not redraw ([`features/widgets/snapshot.ts`](../apps/mobile/src/features/widgets/snapshot.ts)). The timeline precomputes entries at meeting starts and ends within 6 h and at the aging and staleness boundaries, ≥5 min apart, and reloads within 30 min ([`targets/widget/Provider.swift`](../apps/mobile/targets/widget/Provider.swift)). The extension has no network access and no tokens. Sign-out writes a signed-out snapshot.
- **User sees.** Widget copy from `widgets`: "Son güncelleme {time}" after 6 h, "Güncellemek için uygulamayı aç" state after 24 h, signed-out, no-source and empty states.
- **Verified.** unit (Jest widget bridge; snapshot schema); EAS (Swift compile); device (rendering per family, reboot before first unlock).

#### KPL-18 · Lock Screen widgets: system rendering and privacy redaction

- **Limitation.** Accessory families render monochrome; inline is one system-placed line; the small widget has one tap target; `.privacySensitive()` content is redacted while locked; iOS 18 tints content.
- **Evidence.** [KNOW] https://developer.apple.com/documentation/widgetkit/creating-lock-screen-widgets-and-watch-complications ; [KNOW] https://developer.apple.com/documentation/swiftui/view/privacysensitive(_:)
- **As built.** `DALockWidget` (inline, circular, rectangular); names and subjects are `.privacySensitive()` in `full` mode; content follows the detail mode (capped at `title_only` while lock-screen privacy is on); read-only, every view deep-links.
- **User sees.** `widgets.lock.*` copy.
- **Verified.** EAS; device.

#### KPL-19 · Android widget update limits and no lock-screen widgets on phones

- **Limitation.** `updatePeriodMillis` below 30 min is not supported; receivers have ~10 s; Android 17 caps RemoteViews bitmaps when targeted; phones have no third-party lock-screen widgets; no per-view redaction.
- **Evidence.** [OFF] https://developer.android.com/develop/ui/views/appwidgets/advanced ; [OFF] https://developer.android.com/about/versions/17/behavior-changes-17
- **As built.** Glance widgets `DaNextWidget` (2×2) and `DaTodayWidget` (4×2, resizable) with `updatePeriodMillis` 30 min; the app redraws them after each snapshot write; icons are vector drawables; content follows the detail mode like iOS ([`modules/da-widgets`](../apps/mobile/modules/da-widgets)).
- **User sees.** The same widget states as iOS; nothing on the lock screen.
- **Verified.** EAS (Kotlin compile); device.

### D. Share, capture and clipboard

#### KPL-20 · iOS share extension: ~120 MB memory and an App Review risk in the redirect

- **Limitation.** Share extensions are killed above ~120 MB (not enforced in the Simulator); Apple's guide says share extensions cannot open their containing app, and `expo-share-intent` does it through an undocumented responder-chain `openURL`.
- **Evidence.** [SEC] Apple Developer Forums 115259 ; [OFF] https://github.com/achorein/expo-share-intent ; [KNOW] https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionOverview.html
- **As built.** The `expo-share-intent` extension "Dijital Asistan'a Ekle" accepts images, PDFs, URLs and text; items are passed by file URL in the App Group (never base64 in memory), then staged into the app cache with limits (≤5 items, images ≤15 MB, PDF ≤20 MB, text ≤20,000 characters) and opened in the capture flow.
- **User sees.** The capture screen with the shared items; analysis starts only on "Analiz Et".
- **Verified.** unit (prebuild smoke: extension target and App Group); device (large PDF and five images on a physical iPhone).
- **Plan difference.** The fallback extension with its own UI (no redirect) is documented for a review rejection ([STORE_CHECKLIST.md](STORE_CHECKLIST.md#share-extension-openurl-risk)) but not built.

#### KPL-21 · Android share: temporary URI grants and payload types

- **Limitation.** `content://` grants from `ACTION_SEND` are temporary; senders may share unsupported types.
- **Evidence.** [OFF] integrations audit §H.4 ; [KNOW] https://developer.android.com/training/sharing/receive
- **As built.** Intent filters: `text/*`, `image/*`, `application/pdf` (single) and `image/*`, `application/pdf` (multiple); files are copied into the app cache at once and deleted on discard or sign-out; the main activity is `singleTask`.
- **User sees.** Capture errors for unsupported or oversized items.
- **Verified.** unit (Jest share intake); CI (Maestro `share-intent-pdf`).

#### KPL-22 · No automatic ingestion of screenshots or photos

- **Limitation.** Watching the photo library needs broad media permissions that Play policy and privacy expectations rule out; iOS screenshot notifications fire only in the foreground.
- **Evidence.** [KNOW] https://developer.android.com/training/data-storage/shared/photopicker ; [KNOW] https://developer.apple.com/documentation/uikit/uiapplication/userdidtakescreenshotnotification
- **As built.** Capture uses the system picker and the camera (camera permission only when "Kamera" is chosen); photos are compressed (`quality 0.8`); share is the second path; there is no background scanning. Media read permissions are blocked in the manifest.
- **User sees.** The picker.
- **Verified.** unit (prebuild smoke: blocked permissions).

#### KPL-23 · Clipboard access prompts and notices

- **Limitation.** iOS 16+ asks before a programmatic pasteboard read unless a system paste control is used; Android 12+ shows a toast on clipboard reads.
- **Evidence.** [KNOW] https://developer.apple.com/documentation/uikit/uipastecontrol ; [KNOW] https://docs.expo.dev/versions/latest/sdk/clipboard/
- **As built.** The clipboard is read only when the user taps "Yapıştır" in the capture composer (the OS prompt or toast may appear then); codes and links are otherwise typed. Copy actions only write to the clipboard.
- **User sees.** The system paste prompt on iOS after tapping "Yapıştır".
- **Verified.** unit (Jest capture).
- **Plan difference.** `ClipboardPasteButton` is not used.

### E. Voice and audio

#### KPL-24 · On-device Turkish speech recognition depends on device and OS

- **Limitation.** On-device recognition exists only on some devices and locales; otherwise audio goes to Apple or Google services with request limits; Android on-device needs API 31+.
- **Evidence.** [OFF-README] https://github.com/jamsch/expo-speech-recognition ; [KNOW] https://developer.apple.com/documentation/speech/sfspeechrecognizer
- **As built.** `expo-speech-recognition` with `tr-TR` and on-device recognition when the device supports it; otherwise, with the `voice.stt_server` flag on and a server credential, the utterance is recorded (AAC, ≤60 s) and sent to `POST /assistant/transcribe`, where it is deleted after transcription; without either, the screen offers text input ([`features/voice/speech.ts`](../apps/mobile/src/features/voice/speech.ts)). A spoken "onayla" never approves anything.
- **User sees.** `voice` copy for unavailable input ("Metinle sor").
- **Verified.** unit (Jest voice); device.
- **Plan difference.** No offline-model download trigger on Android and no first-use server-path notice.

#### KPL-25 · Native Turkish TTS voices vary by device; premium TTS is optional

- **Limitation.** Available `tr-TR` voices differ by device and engine; Android limits utterance length; `expo-speech` alone cannot seek or show lock-screen controls.
- **Evidence.** [KNOW] https://docs.expo.dev/versions/latest/sdk/speech/ ; [KNOW] https://developer.android.com/reference/android/speech/tts/TextToSpeech.Engine#ACTION_INSTALL_TTS_DATA
- **As built.** The audio briefing is Pro and behind `feature.voice`. `POST /briefings/:id/audio` returns a premium file when `voice.tts_premium` and a TTS credential apply; otherwise the chapter script, which `da-tts` synthesizes on the device into files (best offline `tr-TR` voice first; chapters split below the engine's input limit) for real seek, speed and lock-screen controls; if synthesis fails, `expo-speech` reads sentence by sentence ([`ListenScreen.tsx`](../apps/mobile/src/features/briefing/ListenScreen.tsx)).
- **User sees.** "Cihaz sesiyle okunuyor" in device-voice modes.
- **Verified.** unit (Jest `tts.test.tsx`); EAS (native compile); device (real synthesized audio, Android with a non-Google engine).
- **Plan difference.** No "install a Turkish voice" handoff.

#### KPL-26 · Background audio, lock-screen controls, CarPlay and Android foreground services

- **Limitation.** iOS needs the `audio` background mode; CarPlay presence needs an entitlement; Android 14+ needs a typed foreground service and a Play declaration.
- **Evidence.** [KNOW] https://developer.apple.com/documentation/avfoundation/configuring-your-app-for-media-playback ; [KNOW] https://developer.android.com/about/versions/14/changes/fgs-types-required
- **As built.** Playback starts from a tap; `UIBackgroundModes` includes `audio`; `expo-audio` declares its media-playback service (`FOREGROUND_SERVICE_MEDIA_PLAYBACK`) on Android; the player enables lock-screen controls. No CarPlay templates.
- **User sees.** System media controls.
- **Verified.** device.

### F. Runtime, locale and local security

#### KPL-27 · Hermes `Intl` gaps

- **Limitation.** Hermes has historically lacked `RelativeTimeFormat`, `ListFormat`, `DisplayNames`, `Segmenter` and (older releases) `PluralRules`; time-zone formatting coverage was unverified for Hermes V1.
- **Evidence.** [KNOW] https://github.com/facebook/hermes/blob/main/doc/IntlAPIs.md ; ADR-14
- **As built.** Dates, times and time zones are formatted with date-fns and `@date-fns/tz` ([`packages/i18n/src/formats.ts`](../packages/i18n/src/formats.ts)); relative time uses date-fns, never `Intl.RelativeTimeFormat`; plurals come from use-intl's ICU messages, which rely on the engine's `Intl.PluralRules`.
- **User sees.** Correct formatting, or wrong plural forms if the engine lacks the data.
- **Verified.** unit (i18n formats under Node); EAS / CI (Maestro asserts rendered strings on real builds).
- **Plan difference.** No `ensureIntl()` probe or polyfill and no lint ban on the missing `Intl` APIs.

#### KPL-28 · Turkish case mapping (İ/ı)

- **Limitation.** `textTransform: 'uppercase'` and `toUpperCase()` use the root or device locale ("BILGI" instead of "BİLGİ").
- **Evidence.** [KNOW] https://www.unicode.org/Public/UCD/latest/ucd/SpecialCasing.txt ; [KNOW] https://reactnative.dev/docs/text-style-props#texttransform
- **As built.** Caps text (kickers, badges) goes through `toUpper(text, locale)` in `@da/i18n`, which maps i/ı to İ/I explicitly, applied by the `Text` component's caps variants; `textTransform: 'uppercase'` is not used in the app kit.
- **User sees.** Correct Turkish capitals.
- **Verified.** unit (i18n locale helpers; `@da/ui` text tests).
- **Plan difference.** Catalogs are not stored pre-uppercased and no lint rule bans runtime uppercasing; the helper replaces both.

#### KPL-29 · Right-to-left layouts are not supported

- **Limitation.** Product decision: Turkish and English only, both LTR.
- **Evidence.** secondary-docs SREQ-88 ; [KNOW] https://docs.expo.dev/guides/localization/
- **As built.** The app config does not enable RTL; the language screen lists only Türkçe and English; web and backoffice render LTR.
- **User sees.** Only the two available languages.
- **Verified.** unit (Jest language screen).

#### KPL-30 · Platform secure-storage behaviours

- **Limitation.** iOS Keychain items survive reinstall; large SecureStore values were unreliable on some iOS releases; Android Auto Backup copies app data unless excluded.
- **Evidence.** [OFF] https://docs.expo.dev/versions/latest/sdk/securestore/
- **As built.** The Supabase session is stored in MMKV `da-session` encrypted with an AES key kept in SecureStore (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`) ([`lib/auth/large-secure-store.ts`](../apps/mobile/src/lib/auth/large-secure-store.ts)); a first-run flag outside the Keychain purges stale sessions after reinstall; `android:allowBackup="false"`.
- **User sees.** A reinstall starts signed out.
- **Verified.** unit (Jest secure session, first-run purge, logout wipe; prebuild smoke `allowBackup`).

### G. Links, attribution and development builds

#### KPL-31 · Deferred deep links and referral install attribution

- **Limitation.** iOS has no install referrer; Android has the Play Install Referrer (Play installs only); universal links do not open from some in-app browsers; Expo Go cannot run the local native modules.
- **Evidence.** [KNOW] https://developer.android.com/google/play/installreferrer ; [KNOW] https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app ; [KNOW] https://docs.expo.dev/develop/development-builds/introduction/
- **As built.** Android reads the install referrer once per install (`code=` in the referrer string) and keeps it as the pending referral code ([`referral/pending.ts`](../apps/mobile/src/features/referral/pending.ts)); an opened `/r/{code}` link is kept for after sign-in; any user within the apply window can type a code on the referral screen. The web `/r/[code]` page shows the code and store links. Development uses development builds only.
- **User sees.** The code prefilled when attribution worked; otherwise the code field.
- **Verified.** unit (Jest referral; web Playwright referral landing).

## 5. Register: providers

### H. Google

#### KPL-32 · Gmail restricted-scope verification (CASA), the 100-user cap and testing-mode tokens

- **Limitation.** `gmail.readonly` is restricted: server access needs an annual CASA assessment; unverified apps show a warning and have a 100-user cap; "Testing" status expires refresh tokens after 7 days.
- **Evidence.** [OFF-S] https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification ; [OFF-S] https://support.google.com/cloud/answer/13464325 ; [OFF-S] https://support.google.com/cloud/answer/13465431 ; [OFF-S] https://developers.google.com/identity/protocols/oauth2#expiration ; [OFF] https://supabase.com/docs/guides/platform/custom-domains ; [SEC] https://deepstrike.io/blog/google-casa-security-assessment-2025
- **As built.** Least privilege: `gmail.readonly` for reading, `gmail.send` requested progressively for sending; no compose or modify scope. OAuth callbacks use the custom API domain.
- **User sees.** Google's own "unverified app" screen until verification completes.
- **Verified.** unit (scope sets); owner (CASA, brand verification).
- **Plan difference.** No `config.google_oauth_verified` bootstrap flag, no in-app unverified notice and no `google_oauth` health detail counting users against the cap.

#### KPL-33 · Gmail push, history and quota constraints

- **Limitation.** `watch` must be renewed at least weekly; at most 1 notification/s per user (extras dropped); Pub/Sub is at-least-once; `historyId` can expire (404 → full sync); per-user quota units.
- **Evidence.** [OFF-S] https://developers.google.com/workspace/gmail/api/guides/push ; [OFF] https://gmail.googleapis.com/$discovery/rest?version=v1 (history 404 quote) ; [OFF-S] https://developers.google.com/workspace/gmail/api/reference/quota ; [KNOW] https://cloud.google.com/pubsub/docs/subscription-overview
- **As built.** `users.watch` on INBOX + SENT, renewed by `watch_renewal`; `webhooks-google` verifies the Pub/Sub OIDC token and enqueues; `webhook_events (source, external_id)` dedupes; `reconciliation` catches dropped notifications; a 404 triggers one resync per account; provider calls go through a per-user quota gate; First Analysis covers 72 h and reports real progress.
- **User sees.** Sync-delayed and reconnect cards; the First Analysis progress.
- **Verified.** unit (Deno Gmail adapters and webhooks); CI (integration sync suites).

#### KPL-34 · Only Inbox and Sent are analysed

- **Limitation.** Gmail watch filters by label; Graph message delta works per folder; mail that skips the inbox is not seen.
- **Evidence.** [OFF] https://gmail.googleapis.com/$discovery/rest?version=v1 (`watch.labelIds`, `labelFilterBehavior`) ; [OFF] https://learn.microsoft.com/en-us/graph/delta-query-messages ("per folder")
- **As built.** Gmail watch and sync use `INBOX` and `SENT` (category tabs keep `INBOX` and are included); Graph uses `inbox` and `sentitems` ([`providers/google/gmail.ts`](../supabase/functions/_shared/providers/google/gmail.ts), [`providers/microsoft/mail.ts`](../supabase/functions/_shared/providers/microsoft/mail.ts)).
- **User sees.** Nothing specific.
- **Verified.** unit (Deno adapters).
- **Plan difference.** The data-sources footnote about filtered-away mail is not shown.

#### KPL-35 · Google token invalidation rules and granular consent

- **Limitation.** Refresh tokens die after 6 months unused, on revocation, on password change and beyond 100 tokens per client; users can untick scopes.
- **Evidence.** [OFF-S] https://developers.google.com/identity/protocols/oauth2#expiration ; [OFF-S] https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions
- **As built.** `invalid_grant` moves the account to `needs_reauth` (reconnect card and a notification); granted scopes are parsed on each token response and a missing scope marks the account `partial`; re-consent is asked only on user action.
- **User sees.** "{Sağlayıcı} bağlantısı yenilenmeli." with "Yeniden Bağlan".
- **Verified.** unit (Deno integrations status); CI (integration OAuth suite).

#### KPL-36 · Google Calendar push channels and sync tokens

- **Limitation.** Channels expire (7 days), carry no payload and do not renew; `syncToken` cannot be combined with time bounds; 410 means a full resync.
- **Evidence.** [OFF-S] https://developers.google.com/workspace/calendar/api/guides/push ; [OFF-S] https://developers.google.com/workspace/calendar/api/guides/sync ; [OFF] https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest ; [SEC] https://developers.google.com/workspace/calendar/api/guides/quota
- **As built.** `events.watch` per calendar with an HMAC channel token, renewed by `watch_renewal`; notifications trigger incremental `calendar_sync`; 410 triggers a full sync that prunes removed events ([`services/integrations/sync-calendar.ts`](../supabase/functions/_shared/services/integrations/sync-calendar.ts)).
- **User sees.** Nothing specific.
- **Verified.** unit (Deno calendar adapters).
- **Plan difference.** No "outside the sync window" note in Plan.

#### KPL-37 · Calendar write side effects (Google `sendUpdates`, Graph meeting mail)

- **Limitation.** Google `sendUpdates=none` leaves guests with stale times; Graph sends invitations and updates automatically.
- **Evidence.** [OFF] https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest (`sendUpdates` values and warning) ; [KNOW] https://learn.microsoft.com/en-us/graph/api/event-update ; secondary-docs SREQ-20
- **As built.** Google creates and updates of events with attendees use `sendUpdates=all`, events without attendees `none` ([`approvals/execute/`](../supabase/functions/_shared/services/approvals/execute)); Graph notifies attendees by itself; the side effect is shown on the approval before it is approved.
- **User sees.** "Katılımcılara güncelleme gönderilir" on the approval.
- **Verified.** unit (Deno calendar executor).

#### KPL-38 · Google Tasks: date-only due dates and no push

- **Limitation.** `Task.due` stores only a date; no push or sync token.
- **Evidence.** [OFF] https://tasks.googleapis.com/$discovery/rest?version=v1
- **As built.** `tasks_sync` polls every 15 minutes and on foreground; due dates are date-only; created tasks carry the approval marker for idempotency.
- **User sees.** "Yalnızca tarih saklanır; saat bildirimini Google göstermez" on the Google Tasks destination.
- **Verified.** unit (Deno Google Tasks adapter).

### I. Microsoft

#### KPL-39 · Graph change notifications and throttling

- **Limitation.** Subscriptions last <7 days (message, event); validation must answer in 10 s and deliveries within 3 s; lifecycle events signal missed or removed subscriptions; per-mailbox limits.
- **Evidence.** [OFF] https://learn.microsoft.com/en-us/graph/api/resources/subscription ; [OFF] https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks ; [OFF] https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events ; [OFF] https://learn.microsoft.com/en-us/graph/throttling-limits
- **As built.** `webhooks-microsoft` answers the validation echo, checks the hashed `clientState` and enqueues; `watch_renewal` renews subscriptions; lifecycle events trigger delta resyncs; provider calls honour `Retry-After`.
- **User sees.** Sync-delayed card when sync lags.
- **Verified.** unit (Deno webhooks and Graph adapters); CI (integration Graph sync).

#### KPL-40 · Graph calendar delta uses a fixed window

- **Limitation.** v1.0 event delta works on `calendarView` with a window fixed in the token; an expired token returns `syncStateNotFound` or 410.
- **Evidence.** [OFF] https://learn.microsoft.com/en-us/graph/delta-query-events ; [OFF] https://learn.microsoft.com/en-us/graph/delta-query-overview
- **As built.** `calendarView/delta` over a rolling window, re-baselined daily; 410 / `syncStateNotFound` → full window resync; events that leave the window stay stored subject to retention.
- **User sees.** Nothing specific.
- **Verified.** unit (Deno Graph calendar adapter).

#### KPL-41 · Microsoft To Do: short subscriptions and high latency

- **Limitation.** `todoTask` subscriptions last <3 days with up to 15 min latency.
- **Evidence.** [OFF] https://learn.microsoft.com/en-us/graph/api/resources/subscription
- **As built.** No To Do subscription; `tasks_sync` polls each list's `tasks/delta` every 15 minutes.
- **User sees.** Nothing specific.
- **Verified.** unit (Deno Graph tasks adapter).

#### KPL-42 · Microsoft has no per-app token revocation

- **Limitation.** No per-app revoke for delegated consent; removing the grant needs the user (or an admin) on Microsoft's side.
- **Evidence.** [OFF] integrations audit §B "Revocation" (Graph docs) ; consent pages https://account.live.com/consent/Manage and https://myapps.microsoft.com (verify, §11)
- **As built.** Disconnect and account deletion delete subscriptions, ciphertext and cursors and record `local_only` revocation ([`providers/microsoft/revoke.ts`](../supabase/functions/_shared/providers/microsoft/revoke.ts)); the user gets the manual removal pages.
- **User sees.** "Microsoft erişimini ayrıca kaldırman gerekir: account.live.com/consent/Manage veya myapps.microsoft.com." (`privacy`, `settings`).
- **Verified.** unit (Deno disconnect).

#### KPL-43 · Work tenants can block consent

- **Limitation.** Tenant admins can restrict user consent; publisher verification needs a Partner One id.
- **Evidence.** [OFF] https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview ; [OFF] https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent
- **As built.** Admin-approval AADSTS codes map to `admin_consent_required` ([`providers/microsoft/errors.ts`](../supabase/functions/_shared/providers/microsoft/errors.ts)); the app shows the admin-consent sheet; delegated permissions only.
- **User sees.** The admin-consent sheet in onboarding and account settings.
- **Verified.** unit (Deno error mapping; Jest integrations); owner (publisher verification).

#### KPL-44 · Graph send semantics, attachment size and refresh-token lifetime

- **Limitation.** `sendMail` / `reply` return 202 with no message id; attachments above ~3 MB need an upload session that requires `Mail.ReadWrite` (not requested); refresh tokens expire after 90 days idle; Gmail limits attachments to 25 MB.
- **Evidence.** [OFF] https://learn.microsoft.com/en-us/graph/api/user-sendmail ; [KNOW] https://learn.microsoft.com/en-us/graph/outlook-large-attachments ; [OFF] https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens ; [KNOW] https://support.google.com/mail/answer/6584 ; [OFF] Gmail Discovery (`messages.send` maxSize 35 MB)
- **As built.** `executed` is recorded on 202 with an idempotency check before retries; over-limit reply attachments fail with `attachment_too_large` in both adapters; rotated refresh tokens are persisted; `invalid_grant` → `needs_reauth`.
- **User sees.** "Outlook yanıtlarında ekler toplam 3 MB ile sınırlı." / "Ekler toplamda 3 MB sınırını aşıyor." (`reply`).
- **Verified.** unit (Deno mail adapters); CI (integration approvals).

### J. Calendar semantics across providers

#### KPL-45 · Only the organiser (or a guest with modify rights) can move a meeting

- **Limitation.** Google attendees can modify only with `guestsCanModify`; Graph attendees cannot move meetings; Graph's `proposedNewTime` forces an RSVP change.
- **Evidence.** [KNOW] https://developers.google.com/workspace/calendar/api/v3/reference/events (`guestsCanModify`, `organizer.self`) ; [KNOW] https://learn.microsoft.com/en-us/graph/api/resources/event (`isOrganizer`) ; [KNOW] https://learn.microsoft.com/en-us/graph/api/event-tentativelyaccept ; secondary-docs SREQ-20
- **As built.** `calendar_events.organizer_self` / `can_modify` decide; conflict options offer "move" and "shorten" only for modifiable events and a "propose a new time" email draft to the organiser otherwise ([`services/plan/conflicts.ts`](../supabase/functions/_shared/services/plan/conflicts.ts)); `proposedNewTime` is not used.
- **User sees.** The options the user can actually take.
- **Verified.** unit (Deno plan conflicts).

#### KPL-46 · Attendee availability is known only through free/busy APIs

- **Limitation.** Other people's availability is visible only through free/busy APIs where they share it (Google needs an extra scope; Graph `getSchedule` mostly within an organisation).
- **Evidence.** [OFF] Calendar Discovery document (lists `calendar.freebusy`, `calendar.events.freebusy` scopes) ; [KNOW] https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query ; [KNOW] https://learn.microsoft.com/en-us/graph/api/calendar-getschedule ; M§20
- **As built.** Slot suggestions use the user's own calendars; no free/busy lookup exists, so every option reports `attendee_availability: 'unknown'`; availability is never inferred.
- **User sees.** Options without availability claims.
- **Verified.** unit (Deno plan conflicts).
- **Plan difference.** The progressive `calendar.events.freebusy` scope, `getSchedule` and the availability notes were not built.

#### KPL-47 · Travel time and "leave by" times exist only if a source provides them

- **Limitation.** Calendar APIs have no travel-time field; no routing API or home location is used.
- **Evidence.** [KNOW] Google Events resource and Graph event resource field lists (URLs as in KPL-45) ; M§20 ("Seyahat süresi kaynakta yoksa uydurma") ; design-onboarding-today audit (the "06:45'te evden çıkman gerekebilir" copy is prototype-only)
- **As built.** Back-to-back and conflict detection use event times only; locations appear only when the source has one; no travel estimate is computed anywhere.
- **User sees.** Nothing invented.
- **Verified.** unit (domain calendar signals).

#### KPL-48 · No carrier, airline or bank APIs

- **Limitation.** No shipment, flight or payment provider API is integrated; status comes only from mail, captures or Android NI signals and can be outdated.
- **Evidence.** M§23 ("Amount veya deadline yalnızca kaynak açıkça söylüyorsa göster") ; secondary-docs SREQ-25
- **As built.** Life items show the latest status found in a source with its time; fields without a source span are not asserted ([AI_PIPELINE.md](AI_PIPELINE.md) grounding).
- **User sees.** Source-attributed status.
- **Verified.** unit (domain extractors and grounding).

### K. Apple identity

#### KPL-49 · Sign in with Apple constraints

- **Limitation.** The name arrives only on the first authorisation; the authorisation code is single-use for 5 minutes; relay mail needs registered domains; Android needs the web flow whose client secret expires every 6 months; Guideline 4.8.
- **Evidence.** [OFF] https://supabase.com/docs/guides/auth/social-login/auth-apple ; [OFF] https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens ; [OFF] https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens ; [OFF] https://developer.apple.com/app-store/review/guidelines/#login-services
- **As built.** The name is saved on first sign-in; `POST /auth/apple/exchange` stores the Apple refresh token encrypted for revocation at deletion (retried on the next Apple sign-in if it fails); Android uses the web flow when the Supabase Apple provider is enabled.
- **User sees.** The relay email as-is in the profile.
- **Verified.** unit (Deno Apple exchange and revoke with a mocked Apple endpoint); owner (keys, Services ID, relay domain).
- **Plan difference.** No `rotate-siwa-secret` workflow; regenerating the web client secret is an owner step.

## 6. Register: stores and subscriptions

#### KPL-50 · Free-trial availability and eligibility are store-defined

- **Limitation.** A trial exists only if configured in the store; eligibility is per subscription group (iOS) or offer (Play); store trials need a payment method.
- **Evidence.** [KNOW] https://developer.apple.com/documentation/storekit/product/subscriptioninfo/iseligibleforintrooffer ; [KNOW] https://developer.android.com/google/play/billing/subscriptions ; [KNOW] https://www.revenuecat.com/docs/subscription-guidance/subscription-offers/ios-subscription-offers ; secondary-docs C-09, C-27
- **As built.** The paywall shows a trial CTA only when the store reports an eligible free phase; prices come from `priceString`; web `/pricing` explains that eligibility is shown in the app before purchase.
- **User sees.** `paywall.trialCta` / `trialTerms` only when eligible.
- **Verified.** unit (Jest paywall copy); owner (store offers).

#### KPL-51 · Subscriptions are managed only in the purchasing store; deleting the account does not cancel billing

- **Limitation.** Apps cannot cancel store subscriptions; each store manages its own; Apple requires telling users billing continues after deletion.
- **Evidence.** [OFF] https://developer.apple.com/support/offering-account-deletion-in-your-app/ ; [KNOW] https://www.revenuecat.com/docs/customers/customer-info (`managementURL`)
- **As built.** The subscription screen names the purchasing store and opens its management; the deletion flow warns before confirmation and offers "Aboneliği Yönet"; the RevenueCat customer is deleted, not the store subscription.
- **User sees.** "Aboneliğin {store} üzerinden yönetilir." and the deletion warning.
- **Verified.** unit (Jest subscription and privacy screens).

#### KPL-52 · RevenueCat webhooks are unordered and at-least-once; the server lags the client

- **Limitation.** Webhooks retry, arrive unordered and at least once; `TRANSFER` has no app user id; REST is rate-limited; the SDK sees purchases first.
- **Evidence.** [OFF-S] https://www.revenuecat.com/docs/integrations/webhooks ; [OFF-S] https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields ; [OFF-S] https://www.revenuecat.com/docs/api-v2
- **As built.** `webhooks-revenuecat` stores `billing_events` (unique event id) and `billing_sync` re-fetches the customer and overwrites the mirror; sandbox purchases count in production only for allow-listed user ids (`billing.sandbox_allowed_app_user_ids`); the app calls `POST /purchases/sync` after purchases; server gates use `effective_entitlement()`.
- **User sees.** "Pro etkinleştiriliyor… Birkaç dakika içinde Abonelik ekranında görünür."
- **Verified.** unit (Deno RevenueCat webhook and billing sync); CI (integration RevenueCat suite).

#### KPL-53 · Purchases can be pending or blocked by the device owner

- **Limitation.** Ask to Buy, pending payment methods and parental restrictions defer or block purchases.
- **Evidence.** [KNOW] https://www.revenuecat.com/docs/test-and-launch/errors
- **As built.** `PAYMENT_PENDING_ERROR` waits for the customer-info listener; `PURCHASE_NOT_ALLOWED_ERROR` informs only; Pro is never granted client-side ahead of the store.
- **User sees.** "Satın alma onay bekliyor. Onaylandığında Pro otomatik açılır." / "Bu cihazda satın alma kısıtlı."
- **Verified.** unit (Jest paywall).

#### KPL-54 · Store policy constraints that shape features

- **Limitation.** Apple 3.1.1 (non-IAP unlocks), 3.1.2 (paywall terms), 4.8 (SIWA), 5.1.1(v) (in-app deletion), 2.3 (accurate metadata); review prompts are rate-limited; Play prominent disclosure, Data safety, deletion web resource, restricted permissions, foreground-service declarations and the yearly target-API rule.
- **Evidence.** [OFF] https://developer.apple.com/app-store/review/guidelines/ ; [KNOW] https://developer.apple.com/documentation/storekit/requesting-app-store-reviews ; [SEC/verify] https://support.google.com/googleplay/android-developer/answer/10144311 ; [KNOW] https://support.google.com/googleplay/android-developer/answer/13327111 ; [KNOW] https://developer.android.com/google/play/requirements/target-sdk
- **As built.** See [STORE_CHECKLIST.md](STORE_CHECKLIST.md): referral grants are promotional `entitlement_grants`; the paywall carries legal links and renewal text; deletion is in-app and on the web; the NI disclosure precedes the system screen; `<queries>` replaces `QUERY_ALL_PACKAGES`; the review prompt is only a user-tapped action in About.
- **User sees.** Compliance built into the screens.
- **Verified.** unit (prebuild smoke); owner (store forms).

## 7. Register: backend and AI vendors

#### KPL-55 · Supabase Edge Function limits

- **Limitation.** 2 s CPU per request; wall clock 150 s (Free) / 400 s (paid); 256 MB; no workers or native image libraries; outbound SMTP blocked; bundle and secret limits.
- **Evidence.** [OFF] https://supabase.com/docs/guides/functions/limits ; [OFF] https://supabase.com/docs/guides/functions/background-tasks
- **As built.** Webhook functions only verify and enqueue; the worker drains jobs within a wall-clock budget and stops claiming before it ends ([`_shared/jobs/runner.ts`](../supabase/functions/_shared/jobs/runner.ts)); no server image processing (the app compresses photos at pick time); email goes through an HTTPS email API; failed jobs end `failed` / `dead_letter` with an honest UI state.
- **User sees.** Capture and AI error states (`states`, `capture`).
- **Verified.** unit (Deno runner).

#### KPL-56 · pg_cron concurrency and scheduling granularity

- **Limitation.** At most 8 concurrent cron jobs, ≤10 min each, UTC schedules, 1-minute granularity (sub-minute on newer builds).
- **Evidence.** [OFF] https://supabase.com/docs/guides/cron
- **As built.** Exactly eight `da_*` jobs: `da_scheduler_tick`, `da_worker_poke` (every 15 s), `da_push_receipts`, `da_health_check`, `da_reconciliation`, `da_retention`, `da_billing_reconcile`, `da_cron_housekeeping` ([`20260924001500_cron_schedules.sql`](../supabase/migrations/20260924001500_cron_schedules.sql)); local times are evaluated in SQL; exact-minute user reminders are device-local.
- **User sees.** Nothing.
- **Verified.** unit (pgTAP cron and scheduler).

#### KPL-57 · Supabase Auth, Storage and domain constraints

- **Limitation.** Built-in SMTP is for team members only; custom SMTP starts at low rates; signed URLs cannot be revoked; the custom domain is a paid add-on; legacy keys are deprecated.
- **Evidence.** [OFF] https://supabase.com/docs/guides/auth/auth-smtp ; [OFF] https://supabase.com/docs/guides/auth/sessions ; [OFF] https://supabase.com/docs/guides/storage/security/access-control ; [OFF] https://supabase.com/docs/guides/platform/custom-domains ; [OFF] https://supabase.com/docs/guides/getting-started/api-keys
- **As built.** The deploy job turns custom SMTP on (`SUPABASE_AUTH_EMAIL_SMTP_ENABLED=true`); admin idle and absolute timeouts are app-level; only publishable and secret keys are used; OAuth callbacks use the custom API domain.
- **User sees.** Sign-in rate-limit errors from the email-code screen.
- **Verified.** owner (SMTP, domain).

#### KPL-58 · AI vendor residency, retention and model lifecycle

- **Limitation.** No EU inference option at the model vendors used; batch results are retained for a period; some models require longer retention; models retire; embeddings cannot be swapped without re-embedding.
- **Evidence.** [OFF] https://platform.claude.com/docs/en/manage-claude/data-residency ; [OFF] https://platform.claude.com/docs/en/about-claude/model-deprecations ; ai-research §0.1
- **As built.** Model identifiers are configuration (`ai_model_config`), with a check constraint rejecting excluded model families; batch results are removed after ingest; search degrades to full-text only when embeddings are unavailable; the Privacy Center states "AI analizi ABD'deki alt işleyicilerimizde yapılır."
- **User sees.** The cross-border line in the Privacy Center and on web `/privacy`.
- **Verified.** unit (pgTAP `ai_model_config` constraint; Deno AI pipeline); owner (counsel review of the wording).

## 8. Register: build, CI and development environment

#### KPL-59 · Native builds require EAS (or macOS / the Android SDK)

- **Limitation.** The development container has no Xcode, no Android SDK or emulator and cannot reach EAS.
- **Evidence.** stack-versions audit "Container facts" ; ARCHITECTURE_DECISIONS §5.1 ; [KNOW] https://docs.expo.dev/build/introduction/
- **As built.** The container runs TypeScript, Jest, `expo install --check`, the bundle export and the prebuild smoke. Android release builds and the emulator run in CI (`Mobile E2E`); iOS builds and simulators run on EAS; the widget, share, NI and TTS native code compiles only there.
- **User sees.** —
- **Verified.** CI, EAS.

#### KPL-60 · Container network and Docker limits decide which test tiers run where

- **Limitation.** No Docker daemon in the container (so no `supabase start`); several vendor hosts are unreachable.
- **Evidence.** stack-versions audit "Container facts" ; ARCHITECTURE_DECISIONS §5.2
- **As built.** Tier C (PostgreSQL 16 + shim + pgTAP) and tier C+ integration run in the container; tier A runs in CI; provider calls are always stubs or mock servers; missing credentials surface as "Harici kimlik bilgisi gerekli" and `external_credential_required` in System Health ([TESTING.md](TESTING.md)).
- **User sees.** —
- **Verified.** CI.

#### KPL-61 · Capabilities that automation cannot verify

- **Limitation.** Real devices are needed for system grants (notification listener, exact alarms, Time Sensitive), widget rendering, share extensions under memory pressure, push delivery, store purchases, on-device voices and background scheduling; simulators differ.
- **Evidence.** [OFF] https://docs.expo.dev/versions/latest/sdk/background-task/ (not available in Simulator) ; [SEC] share-extension memory limit disabled in Simulator (KPL-20 sources) ; [OFF] https://docs.expo.dev/eas/workflows/examples/e2e-tests/
- **As built.** Maestro covers the UI states on emulators and simulators; the entries marked "device" above are the manual checklist run on a physical iPhone and Android device before submission, with results in the final implementation report.
- **User sees.** —
- **Verified.** device (owner).

## 9. Platform capabilities deliberately not used

| Capability | Why not | Closest behaviour used |
| --- | --- | --- |
| WidgetKit push | A second push credential path; budgeted anyway | Foreground and background reloads (KPL-17) |
| Interactive widgets (App Intents) | Writes never happen from a widget | Deep links into real screens |
| Live Activities, Critical Alerts | No requirement; restricted entitlement | Time Sensitive notifications (KPL-07) |
| Silent refresh pushes | Throttled and deferred by both platforms | Foreground refresh and background tasks (KPL-11) |
| `gmail.compose` / `gmail.modify` / `Mail.ReadWrite` | Least privilege | Drafts in our database; `gmail.send` / `Mail.Send` (KPL-44) |
| Graph `proposedNewTime` | Forces an RSVP change | "Propose a new time" email draft (KPL-45) |
| `QUERY_ALL_PACKAGES`, `USE_EXACT_ALARM`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Play-restricted | `<queries>` launcher intent; `SCHEDULE_EXACT_ALARM` |
| OAuth in embedded WebViews | Google blocks embedded user agents | System auth sessions |
| AlarmKit / Clock handoff | Not built (KPL-10) | Smart reminders |
| Automatic photo or screenshot scanning | Permissions policy and privacy | Picker and share (KPL-22) |
| Location and routing | No travel time invented | Event times only (KPL-47) |

## 10. Feature → limitation index

| Feature / screen | KPL IDs |
| --- | --- |
| Onboarding (sign-in, connect, permissions, analysis, notifications, Android step) | 01, 02, 08, 12, 13, 31, 32, 33, 35, 43, 49 |
| Today, briefings, audio briefing | 05, 11, 12, 17, 25, 26, 27, 28, 56 |
| Flow, mail, reply, follow-ups | 33, 34, 35, 44 |
| Plan, conflicts, proposals, meetings | 12, 14, 15, 36, 37, 40, 45, 46, 47 |
| Smart reminders | 07, 09, 10, 16, 38, 41 |
| Approval Center | 14, 37, 44, 45 |
| Life intelligence | 03, 47, 48 |
| Capture and share | 20, 21, 22, 23, 55 |
| Assistant, voice, memory | 24, 58 |
| Widgets | 11, 17, 18, 19 |
| Notification settings and delivery | 05, 06, 07, 08 |
| Android notification intelligence | 01, 02, 03, 04 |
| Privacy Center | 13, 24, 34, 42, 49, 51, 58 |
| Paywall, subscription, Pro gates | 50, 51, 52, 53, 54 |
| Referral | 31, 54 |
| Public web | 01, 31, 50, 51, 58 |
| Backoffice | 04, 05, 32, 33, 39, 52, 55, 56 |
| Localisation and layout | 27, 28, 29 |
| CI, release, store submission | 54, 59, 60, 61 |

## 11. Re-verification backlog

Facts tagged [KNOW] during planning, with their status as built.

| # | Fact | KPL | Status |
| --- | --- | --- | --- |
| 1 | Hermes V1 `Intl` coverage (PluralRules, time zones) | 27 | Open: check plural forms on EAS builds (Maestro string assertions) |
| 2 | `expo-notifications` Android scheduling uses exact alarms when permitted | 09 | Open: device Doze test |
| 3 | AlarmKit API and usage key | 10 | Not needed (feature not built) |
| 4 | Background notification delivery through Expo | 11, 12 | Not needed (silent pushes not used) |
| 5 | Graph attachment size without `Mail.ReadWrite` | 44 | Implemented as a 3 MB limit; confirm against the current Graph documentation |
| 6 | Graph organiser updates send meeting mail automatically | 37 | Open: owner sandbox |
| 7 | Google free/busy scope | 46 | Not needed (free/busy not built) |
| 8 | Google `guestsCanModify` semantics | 45 | Implemented via `can_modify`; confirm in owner sandbox |
| 9 | Gmail quota table | 33 | Open |
| 10 | Unverified publishing status and refresh-token expiry | 32 | Open: owner (Google console) |
| 11 | AADSTS admin-consent codes | 43 | Implemented (65001, 90094, 90095 → admin consent); confirm with a restricted tenant |
| 12 | Microsoft consent-management URLs | 42 | Implemented in copy; confirm before launch |
| 13 | Time Sensitive entitlement key | 07 | Entitlement asserted by the prebuild smoke; delivery behaviour on device |
| 14 | Play notification-listener policy and Data safety | 02, 54 | Open: owner at submission ([STORE_CHECKLIST.md](STORE_CHECKLIST.md)) |
| 15 | Android restricted-settings scope on 15–17 | 02 | Open: device |
| 16 | APNs coalescing and FCM offline storage | 05 | Open |
| 17 | CarPlay Now Playing without the audio entitlement | 26 | Open: device |
| 18 | RevenueCat customer-delete endpoint | 51 | Open: marked for verification in [`revenuecat.ts`](../supabase/functions/_shared/services/billing/revenuecat.ts) |
| 19 | Current store minimum SDK / target-API rules | 54, 59 | Open: owner at submission (target SDK 36 today) |
| 20 | WidgetKit App Group file protection | 17 | Open: device reboot test |
| 21 | Device calendar source names for duplicate detection | 15 | Not needed (dedupe not built) |

## 12. Manual external steps and credentials implicated

| Item | KPL |
| --- | --- |
| Google CASA letter, brand verification, Search Console domains, custom API domain | 32, 57 |
| Google Pub/Sub topic and push subscription | 33 |
| Entra app registration, certificate, publisher verification | 43, 44 |
| Apple Time Sensitive capability, App Group, widget and share extension identifiers (EAS credentials) | 07, 17, 20 |
| SIWA key, Services ID, relay email domain registration, web client-secret regeneration | 49 |
| Store products, offers and agreements | 50 |
| RevenueCat keys, v2 secret, webhook secret | 52 |
| Play Data safety, notification-listener and foreground-service declarations, deletion URL | 02, 26, 54 |
| Custom SMTP with a raised rate | 57 |
| Server STT and premium TTS credentials (optional) | 24, 25 |
| `EXPO_TOKEN`; physical test devices for the "device" checks | 59, 61 |
| Counsel review of the cross-border processing wording | 58 |

## Differences from the plan

This document replaced the planning register. The plan behaviours that were not built, or were built differently, are marked "Plan difference" in the entries above; in summary:

| Area | Not built or different | KPL |
| --- | --- | --- |
| `da-platform` native module | No exact-alarm check, AlarmKit / Clock handoff, or Time Sensitive state | 07, 09, 10 |
| Listener health | No connection-state card, rebind or battery handoff | 04 |
| Device data freshness | No pre-briefing `device_refresh` push, no briefing stale note or change banner; three background tasks instead of one | 11, 12 |
| Calendar dedupe | No auto-deselect of duplicate device calendars, no cross-source merge | 15 |
| Free/busy | Attendee availability always unknown | 46 |
| Google verification status | No `google_oauth_verified` flag, in-app notice or cap health detail | 32 |
| Platform capability reporting | `app_installations.platform_capabilities` exists but is not sent | 06, 07 |
| Limitation copy | No `limits.*` namespace; the shipped copy lives in the feature namespaces named above, and several planned footnotes (delivery, folders, task polling, outside window) are not shown | 05, 34, 36, 38 |
| Intl and casing | No `ensureIntl()`, no lint bans; date-fns formatting and the `toUpper` helper instead | 27, 28 |
| Share and SIWA fallbacks | No custom share extension; no SIWA secret rotation workflow | 20, 49 |
| Voice extras | No offline model download trigger, no server-path notice, no voice install handoff, no `ClipboardPasteButton` | 23, 24, 25 |

The reasons are the same throughout: each missing piece is a platform refinement that the shipped behaviour does not depend on for correctness, and the product falls back to the platform default instead of simulating it (policy §1).

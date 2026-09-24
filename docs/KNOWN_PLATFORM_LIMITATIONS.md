# Dijital Asistan: Known Platform Limitations

> **Document:** `docs/KNOWN_PLATFORM_LIMITATIONS.md` · **Status:** binding plan document (materialised at execution step 0) · **Research date:** 2026-09-23
> **Binding requirements:** M§91 (Platform Limitations) and M§141 (Gerçekçilik Kuralı). Also M§20, M§23, M§25, M§27–29, M§33–37, M§39–41, M§43–45, M§73–76, M§82, M§86–88, M§93–94, M§96, M§112, M§117, M§125, M§127, M§129, M§132, M§149 and M§153.
> **Spine:** master plan ADR-01…15 and §5, §5b, §7, §9, §14, §19, §20, and the reconciliation rulings of plan §23b (R-01…R-25), which override any conflicting draft text. Names are used exactly as defined there.
> **Audit inputs:** `integrations` (primary; its URLs are kept), `stack-versions`, `design-account-states-marketing`, `secondary-docs` (resolutions C-01…C-37, SREQ-01…104), `ai-research`, and the drafted ARCHITECTURE_DECISIONS and SCREEN_AND_FLOW_MAP parts 2–4.

---

## 0. About this document

This register lists every capability that a platform (iOS, Android, Google, Microsoft, Apple, the stores, RevenueCat, Supabase, AI vendors or the build environment) **cannot provide**, or provides only with constraints that change product behaviour. Each entry gives:

- **(a) Limitation**: what the platform cannot do.
- **(b) Evidence**: a source URL with an evidence tag (see below).
- **(c) Product behaviour**: the closest real native behaviour we implement instead. No fakes (M§91, M§141).
- **(d) UI communication**: how the user learns about it. Exact Turkish copy is given with its i18n key; the English text is in §11.
- **(e) Affected**: the features, screens (SCREEN_AND_FLOW_MAP IDs where they exist, otherwise the Expo Router route from plan §9), endpoints and jobs.
- **Verification**: the automated or manual check that proves the behaviour.

**Evidence tags**

| Tag | Meaning |
|---|---|
| **[OFF]** | An official source read directly during planning (per the integrations and stack audits) |
| **[OFF-S]** | An official source seen only through a search-engine excerpt |
| **[SEC]** | A third-party source |
| **[KNOW]** | Engineering knowledge that could not be fetched during planning because the documentation hosts were blocked. It **must be re-verified during execution** (§13). The product behaviour stays conservative whether or not the fact holds. |

**IDs.** Entries are numbered `KPL-01` … `KPL-61`. Other documents (STORE_CHECKLIST, TEST_PLAN, FINAL_IMPLEMENTATION_REPORT "Known Platform Limitations" section per M§138) reference these IDs. Retired IDs are never reused.

**Adding a limitation.**
1. Add a register entry with all six fields.
2. Add the copy keys to `packages/i18n` under `limits.*`, in both tr and en.
3. Add the verification to TEST_PLAN.
4. If the limitation is store-relevant, reference it from STORE_CHECKLIST.

---

## 1. Handling policy and UI communication patterns

### 1.1 Policy (M§91, M§141, M§99, M§100)

1. **Never fake a capability.** There are no simulated states, no local toggles pretending to grant OS or provider access, and no "success" before the platform confirms it. For example, the Android NI toggle reflects the real system grant, and "Gönderildi" appears only on `executed`.
2. **Implement the closest real native behaviour.** Every entry names it. When no real substitute exists, the capability is **absent** on that platform. It is not shown disabled as a teaser.
3. **Tell the truth where the user makes the decision.** Explain a limitation at the moment it matters (the explainer before an OS prompt, the destination picker, the approval sheet), not in a generic FAQ alone.
4. **No capability claims in marketing or store metadata that a platform cannot deliver** (M§74, M§141). Examples: Android NI must not appear in iOS store text or screenshots; web pricing must not say "Kredi kartı gerekmez".
5. **Enforce on the server as well.** A platform-limited capability never becomes a client-only path that bypasses approvals, entitlements or RLS (ADR-04, ADR-09).
6. **Every limitation has a verification**, either automated or on the manual device checklist in TEST_PLAN, and the FINAL_IMPLEMENTATION_REPORT states where it ran (ARCHITECTURE_DECISIONS §5.3).

### 1.2 Communication patterns (use these; do not invent new ones)

| Code | Pattern | When | Implementation (`packages/ui`, theme-aware, a11y built in per ADR-03) |
|---|---|---|---|
| **P1** | **Hide** | The capability does not exist on this platform (e.g. Android NI on iOS, Apple Reminders on Android) | No row, tab, card or paywall bullet. Routes are guarded (`Platform.OS` check → `router.replace('/settings')`). Pro tables omit the row. |
| **P2** | **Disabled with reason** | The option exists but is unavailable now (permission missing, offline, not organizer) | `OptionRow` `disabled` + meta text. `accessibilityState.disabled` plus the reason in `accessibilityHint`. |
| **P3** | **Inline info note** | A constraint the user should know before acting | A note block: `info` icon 16, text 13/19 in `ink/secondary`, background `info/soft #E7F0FD` (dark: `surface-2`). Never coloured for decoration (design rule: colour carries meaning). |
| **P4** | **Freshness / provenance** | Data can be stale because of the platform (device calendars, delayed sync) | The canonical `SourceTag` meta: "{kaynak} · son eşitleme {saat}". Tapping it opens M-SRC-01. |
| **P5** | **Error card** | A limitation blocks a flow that was expected to work | The design-08 `ErrorCard` (icon tile 36, title 15/600, sub 13/19, one primary + one secondary action). |
| **P6** | **Explainer sheet** | The user must act in OS or provider settings | A bottom sheet with numbered steps and one handoff button (P8). Opened from a "Neden gerekli?" / "Nasıl?" link. |
| **P7** | **Settings footnote** | A standing constraint of a settings group | 12/18 `ink/secondary` text under the group. |
| **P8** | **System handoff** | Only the OS, store or provider can change the setting | iOS/Android app settings: `Linking.openSettings()`. Android settings intents: `Linking.sendIntent(action, extras)` (string/boolean extras only). Anything needing typed extras or data URIs goes through the local module `da-platform` (§Proposed additions). Web pages: `WebBrowser.openBrowserAsync`. |

### 1.3 Claims that must never appear (quality gate)

These strings are banned in `packages/i18n` catalogs, `apps/web` content and store metadata. The patterns are added to `scripts/quality-gate/banned-markers.txt` (see Proposed additions).

| Banned claim | Why | Truthful replacement |
|---|---|---|
| "uçtan uca şifreleme" / "uçtan uca TLS" | E2E is not implemented (M§40) | "Veriler aktarım sırasında ve saklanırken şifrelenir." |
| "Kredi kartı gerekmez" | Store trials need a store account with a payment method (C-27) | Trial copy only when eligible (KPL-50) |
| "Sınırsız" / "unlimited" as a positive claim (AI) | Budgets exist (C-10, plan §8). The gate flags only positive claims; negated fair-use text is allow-listed (R-17) | "Adil kullanım" |
| "cihazında özetlenir", "hiçbir şey gönderilmez" (mail/documents) | AI runs server-side (ai-research §8 P0) | "Mail içeriklerin şifreli bağlantıyla analiz edilir; yapay zekâ sağlayıcımız içerikleri model eğitiminde kullanmaz. Mail içeriğinin tamamı saklanmaz; yalnızca özetler, kısa alıntılar ve analiz sonuçları saklama süren boyunca tutulur." The storage sentence is canonical per R-15; the First Analysis footer is "Son 72 saat analiz edildi. Mail içeriğinin tamamı saklanmaz." |
| Any iOS claim about reading other apps' notifications | KPL-01 | none (hidden) |
| "anında" / "gerçek zamanlı" for sync or push | Push and sync are best-effort (KPL-05, KPL-33, KPL-39) | none |

---

## 2. Platform baselines

Values come from ADR-02 and the stack-versions audit: iOS deployment target **16.4**; Android `minSdk 24`, `compileSdk/targetSdk 36`.

| OS level | Capability that appears or changes | Product handling |
|---|---|---|
| iOS 15 | Time Sensitive interruption level; `UNNotificationSettings.timeSensitiveSetting` | Used (KPL-07) |
| iOS 16 | Lock Screen accessory widgets; `UIPasteControl`; `UIDevice.name` returns a generic name without an entitlement | Used (KPL-18, KPL-23); model name instead of device name (KPL-14) |
| iOS 16.4 | **Minimum supported** | Older EventKit API `requestAccess(to:)` plus the legacy plist keys |
| iOS 17 | EventKit full / write-only access split; widget `containerBackground` | Full access only (KPL-13); `#available(iOS 17, *)` guards |
| iOS 18 | Widget rendering modes (accented/tinted) | `widgetAccentable()` on accents (KPL-18) |
| iOS 26 | AlarmKit | "Alarm Kur" is native only on iOS 26+ (KPL-10) |
| Android 7 (API 24) | **Minimum supported** | — |
| Android 8 (26) | Notification channels are mandatory | KPL-08 |
| Android 11 (30) | `ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS` | Direct deep link to our toggle (KPL-02) |
| Android 12 (31) | Exact-alarm permission; widget `targetCellWidth/Height`; on-device `SpeechRecognizer`; notification trampolines blocked | KPL-09, KPL-19, KPL-24. Notification and widget taps start the activity directly (Expo/Glance defaults). |
| Android 13 (33) | `POST_NOTIFICATIONS`; restricted settings for sideloads; offline speech model download; Photo Picker | KPL-08, KPL-02, KPL-24, KPL-22 |
| Android 14 (34) | `SCHEDULE_EXACT_ALARM` denied by default on new installs; foreground-service types required | KPL-09, KPL-26 |
| Android 15 (35) | OTP redaction for untrusted listeners; notification hiding during screen share; edge-to-edge enforced | KPL-03 |
| Android 16 (36) | JobScheduler/WorkManager quotas tied to standby bucket; predictive back | KPL-11 |
| Android 17 (37, when targeted) | RemoteViews bitmap cap; SMS OTP protections; background-audio hardening | KPL-19, KPL-03, KPL-26 |

---

## 3. iOS vs Android capability parity

| # | Capability | iOS | Android | Product behaviour | KPL |
|---|---|---|---|---|---|
| 1 | Read other apps' notifications | ✗ No API | ✓ `NotificationListenerService`, user-granted | Android NI is Android-only and Pro; on iOS it is hidden (P1) | 01–04 |
| 2 | Read device calendar | ✓ EventKit **full access only** | ✓ `READ_CALENDAR` (CalendarContract) | Snapshot upload from the device | 12, 13 |
| 3 | Device reminders/tasks | ✓ Apple Reminders (EventKit) | ✗ No system tasks store | Android uses Google Tasks / To Do over OAuth | 16 |
| 4 | Write device calendar | ✓ on device (no attendees) | ✓ on device (attendees not offered) | "Device executor" completes the approval on that device | 14 |
| 5 | Periodic background work | BGTaskScheduler (system-decided; processing tasks favour idle/charging) | WorkManager, ≥15 min, standby-bucket quotas, OEM killers | Best-effort; foreground is primary | 11 |
| 6 | Silent push wake | `content-available`, throttled, none after force-quit | Data message; normal priority is deferred in Doze | Pre-briefing refresh nudge | 11, 12 |
| 7 | Home-screen widgets | S / M / L (WidgetKit) | 2×2 / 4×2 (Glance) | Read-only, deep links | 17, 19 |
| 8 | Lock-screen widgets | ✓ accessory circular / rectangular / inline | ✗ on phones | iOS only | 18, 19 |
| 9 | Widget refresh | ~40–70 reloads/day budget; foreground reloads free | `updatePeriodMillis` ≥30 min; WorkManager | Snapshot on foreground, sync and background tick | 17, 19 |
| 10 | Share into app | Share extension (~120 MB) + undocumented redirect | `ACTION_SEND` / `ACTION_SEND_MULTIPLE` | Common capture flow | 20, 21 |
| 11 | Exact-time local reminder | ✓ calendar trigger | Needs the "Alarmlar ve hatırlatıcılar" special access (Android 14+ default off) | Inexact fallback + P3 note | 09 |
| 12 | Break through Focus/DND | Time Sensitive (user can turn off) | Channel importance HIGH (user can change) | Server sets level/channel; UI shows the real state | 07, 08 |
| 13 | Critical alerts | ✗ (restricted entitlement) | n/a (no DND bypass requested) | Not used | 07 |
| 14 | Lock-screen content privacy | Show Previews + hidden-preview text; lock state unknown to server | Channel `lockscreenVisibility` + OS setting; no `publicVersion` via Expo | Server renders the detail mode | 06 |
| 15 | System alarm | iOS 26+ AlarmKit; earlier ✗ | Clock app intent handoff | "Alarm Kur" or a reminder fallback | 10 |
| 16 | On-device Turkish STT | Device/locale-dependent | Android 13+ offline model downloadable | Server STT fallback | 24 |
| 17 | Turkish TTS voice | Built-in voices; Enhanced must be downloaded | Engine-dependent; may be missing | Native synth-to-file; premium optional | 25 |
| 18 | Background audio + lock-screen controls | ✓ (`audio` background mode) | ✓ (media-playback FGS) | Briefing player | 26 |
| 19 | Sign in with Apple | Native | Web OAuth | Both offered | 49 |
| 20 | Install referral attribution | ✗ No install referrer | ✓ Play Install Referrer | iOS: manual or pasted code | 31 |
| 21 | Free trial eligibility | Per subscription group (StoreKit) | Per offer (Play returns only eligible offers) | Trial copy only when eligible | 50 |
| 22 | Subscription management | App Store only | Play only | Store handoff | 51 |
| 23 | Programmatic clipboard read | Paste prompt (iOS 16+) unless a paste control | System toast (Android 12+) | Explicit paste control | 23 |
| 24 | OTP protection in notifications | n/a | Android 15 redacts for untrusted listeners | Our own OTP detector on all versions | 03 |
| 25 | Right-to-left layout | Not supported by product | Not supported by product | tr/en are LTR | 29 |
| 26 | Keychain/secure data after uninstall | Persists | Removed (Auto Backup excluded) | First-run purge | 30 |
| 27 | Expo Go | ✗ (native modules) | ✗ | Dev builds + EAS only | 31, 59 |

---

## 4. Register: mobile operating systems

### A. Notifications and system access

#### KPL-01 · iOS has no system-wide notification stream
| Field | Detail |
|---|---|
| Limitation | No iOS API lets a third-party app read other apps' notifications. `UNUserNotificationCenter` manages only the calling app's notifications. A Notification Service Extension only mutates the app's own remote pushes. |
| Evidence | [KNOW] https://developer.apple.com/documentation/usernotifications/unusernotificationcenter ; https://developer.apple.com/documentation/usernotifications/unnotificationserviceextension ; binding requirement M§36/M§91 ("iOS'ta Android sistem notification stream varmış gibi davranma") |
| Product behaviour | Android Notification Intelligence is **Android-only** (ADR-12, ADR-42). On iOS: <ul><li>the `notification-intelligence` module returns `isSupported: false`;</li><li>`app/(onboarding)/android-notifications` is skipped;</li><li>`app/settings/android-notifications` redirects to `/settings`;</li><li>`POST /android-notifications/signals` (API_CONTRACTS API-ANI-01) rejects every non-Android client with `403 FORBIDDEN`.</li></ul> iOS users get the same life-intel signals (shipment, flight, payment) from connected mail (M§23) and Universal Capture/share (M§27–28). |
| UI communication | **P1 Hide** everywhere in the iOS app, including the Paywall row "Telefon bildirimleri zekâsı" (M-PAY-01 already shows it only on Android). FAQ (shared with web `/support`, SREQ-70): `limits.ios.ni_faq_q` "iPhone'da diğer uygulamaların bildirimlerini okuyabilir misin?" / `limits.ios.ni_faq_a` "Hayır. iOS, uygulamaların başka uygulamaların bildirimlerine erişmesine izin vermez. iPhone'da kargo, uçuş ve ödeme bilgilerini bağladığın mail hesaplarından ve benimle paylaştığın içeriklerden çıkarırım." Web features and pricing mark the item with the badge `limits.web.ni_android_only` "Yalnızca Android". |
| Affected | Onboarding step 2.13; M-ANI-01…04; M-PAY-01; web `/`, `/pricing`, `/support`; App Store metadata and screenshots (STORE_CHECKLIST: no NI in the iOS listing, Guideline 2.3) |
| Verification | <ul><li>Jest: route guard redirects on `Platform.OS='ios'`; paywall renders no NI row on iOS.</li><li>Deno: `POST /android-notifications/signals` from an iOS client → 403 `FORBIDDEN`.</li><li>Maestro iOS: `assertNotVisible` "Telefon bildirimleri" in Settings.</li><li>Web Playwright: NI feature carries the "Yalnızca Android" badge.</li></ul> |
| Master refs | M§36, M§44, M§74, M§91, M§141 |

#### KPL-02 · Android 13+ restricted settings block notification access for sideloaded builds
| Field | Detail |
|---|---|
| Limitation | Since Android 13, apps not installed from an app store (APK sideload, including EAS internal-distribution APKs) cannot receive notification-listener access until the user taps "Allow restricted settings" in App info. Android 15 widened the restricted list. Play-installed apps (including Play internal testing tracks) are unaffected. |
| Evidence | [SEC] https://www.xda-developers.com/android-13-restricted-setting-notification-listener/ ; [SEC] https://www.androidauthority.com/android-15-restricted-settings-sideloading-3481098/ |
| Product behaviour | <ul><li>"Bildirim Erişimini Aç" opens `ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS` with our component (API 30+), or the list intent below that.</li><li>On return, the grant is re-checked via `NotificationManagerCompat.getEnabledListenerPackages()`.</li><li>After **two** returns without a grant, the restricted-settings help is shown.</li><li>QA and testers are distributed through Play internal testing wherever NI is under test.</li></ul> |
| UI communication | P6 help block on M-ANI-01 (copy owned by SCREEN_AND_FLOW_MAP Part 4, reused verbatim): "İzin açılamıyorsa: Ayarlar → Uygulamalar → Dijital Asistan → ⋮ → Kısıtlı ayarlara izin ver, sonra tekrar dene." |
| Affected | `app/(onboarding)/android-notifications`, M-ANI-01, M-ANI-02 |
| Verification | Manual device checklist: sideloaded APK on Android 13 and 15 (help appears after two failed returns; granting works after "Kısıtlı ayarlara izin ver"). Play internal-track install: no restriction. |
| Master refs | M§36, M§91 |

#### KPL-03 · Android OTP redaction (15+), no redaction on 10–14, screen-share hiding, SMS OTP (17)
| Field | Detail |
|---|---|
| Limitation | <ul><li>Android 15 stops untrusted `NotificationListenerService` apps from reading unredacted content of notifications where an OTP was detected. Android 10–14 give no such protection, so bank OTPs reach listeners in clear text.</li><li>Android 15 also hides notification content during screen sharing. Expo push cannot set `setPublicVersion()`.</li><li>Android 17 delays SMS OTP access for non-default-SMS apps. We do not read SMS.</li></ul> |
| Evidence | [OFF] https://developer.android.com/about/versions/15/behavior-changes-all (quote: "Android will stop untrusted apps that implement a NotificationListenerService from reading unredacted content from notifications where an OTP has been detected.") ; [OFF] https://developer.android.com/about/versions/17/behavior-changes-all |
| Product behaviour | Our own OTP detector runs on **every** Android version inside the Kotlin service, before any processing (ADR-42): <ul><li>4–8 digit tokens near `kod|şifre|doğrulama|onay kodu|OTP|code|verification|tek kullanımlık` → the notification is dropped entirely;</li><li>system-redacted text is treated as unparseable and dropped;</li><li>`VISIBILITY_SECRET` and `CATEGORY_CALL` are dropped;</li><li>authenticators, password managers, e-Devlet, messaging/SMS apps and our own package are always excluded (M-ANI-04).</li></ul> Raw text is never persisted or uploaded; only structured signals reach `android_notification_signals`. For screen sharing, nothing is needed: our pushes already carry only detail-mode text (KPL-06). |
| UI communication | Assurance box on M-ANI-01 (owned by Part 4, reused verbatim) includes "Doğrulama kodu içeren bildirimler tamamen yok sayılır." There is no copy for screen-share hiding (system behaviour). |
| Affected | M-ANI-01…04, `POST /android-notifications/signals`, `android_notification_signals` |
| Verification | <ul><li>Kotlin unit tests (Robolectric): Turkish/English OTP corpus dropped; redacted strings dropped; the denylist wins over "all apps" mode.</li><li>Deno: the signals endpoint rejects any free-text `title`/`text` field.</li><li>Manual device checklist on Android 14 and 15: send a bank-style OTP notification → no signal.</li></ul> |
| Master refs | M§36, M§86, M§91 |

#### KPL-04 · The notification listener can be unbound by the system or by OEM battery management
| Field | Detail |
|---|---|
| Limitation | <ul><li>The system can disconnect a granted listener (`onListenerDisconnected`), for example after an update, under memory pressure or through OEM "sleeping apps" features.</li><li>`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (a direct exemption prompt) is restricted by Google Play to specific app categories.</li></ul> |
| Evidence | [OFF] https://developer.android.com/reference/android/service/notification/NotificationListenerService (`requestRebind`, `onListenerConnected`) ; [KNOW] https://developer.android.com/training/monitoring-device-state/doze-standby#exemption-cases ; [SEC] https://dontkillmyapp.com |
| Product behaviour | <ul><li>The `notification-intelligence` module records `connected` / `lastConnectedAt` and exposes `getListenerState()` and `requestRebind()` (Proposed additions).</li><li>On every app resume, if granted but not connected, the app calls `requestRebind(ComponentName)`.</li><li>If still not connected after 10 s, the status card switches.</li><li>We never declare `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`. We open the battery-optimisation list with `Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS')`.</li></ul> |
| UI communication | P5 status card on M-ANI-01: `limits.android.ni_disconnected_title` "Bildirim erişimi açık ama bağlantı koptu" / `limits.android.ni_disconnected_body` "Pil tasarrufu Dijital Asistan'ı durdurmuş olabilir. Yeniden bağlanmayı denedim; sorun sürerse uygulamayı pil optimizasyonundan çıkar." / CTA `limits.android.ni_disconnected_cta` "Pil ayarlarını aç" (P8). |
| Affected | M-ANI-01; `app_installations.platform_capabilities.ni_connected` (Proposed additions); backoffice user detail |
| Verification | Instrumented bind test in CI (emulator, ADR-42). Manual: force-stop the app → resume → rebind succeeds or the card appears. |
| Master refs | M§36, M§93 |

#### KPL-05 · Push delivery is best-effort (APNs/FCM) and the Expo Push Service has hard limits
| Field | Detail |
|---|---|
| Limitation | <ul><li>A ticket `ok` only means Expo accepted the message; receipts arrive about 15 min later and are purged after 24 h.</li><li>Limits: 100 messages per request, 600 notifications/s per project, 4,096-byte payload.</li><li>If the Android `channelId` does not exist on the device, the notification is not shown.</li><li>APNs keeps only the latest undelivered notification per app for an offline device, and FCM keeps a bounded number. Pushes are dropped or coalesced after long offline periods.</li></ul> |
| Evidence | [OFF] https://docs.expo.dev/push-notifications/sending-notifications/ ; [KNOW] https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/RemoteNotificationsPG/APNSOverview.html (store-and-forward, coalescing) ; [KNOW] https://firebase.google.com/docs/cloud-messaging/concept-options#lifetime |
| Product behaviour | <ul><li>Notifications are **hints**. The source of truth is in-app state (Today, Flow, Approval Center), which is always recomputed from the database.</li><li>`worker` batches ≤100 per request and throttles to ≤500/s.</li><li>`push_tickets` are stored and the `push_receipts` job polls after ≥15 min. `DeviceNotRegistered` disables the `push_tokens` row.</li><li>Every push has a `ttl` matched to relevance (meeting prep expires at meeting start; briefings at the next briefing) and a `collapseId`/`tag` equal to the notification `dedupe_key`.</li><li>The server sends only channel IDs that exist in the installed app version (a channel list is versioned in `packages/domain/notifications/channels.ts`, and `app_installations.app_version` gates new channels).</li><li>Payload: `{type, entity_id, deeplink}` plus server-rendered text (ADR-10).</li></ul> |
| UI communication | P7 footnote under Settings → Bildirimler: `limits.notifications.delivery_footnote` "Bildirimler Apple ve Google'ın bildirim servisleri üzerinden iletilir. Telefonun kapalıyken ya da internete bağlı değilken bazıları gecikebilir veya yalnızca en sonuncusu ulaşabilir. Her şeyin güncel hâli Bugün ekranında." |
| Affected | `app/settings/notifications`; `notification` and `push_receipts` jobs; `notifications`, `push_tickets`, `push_tokens`; backoffice `/notifications` (delivery vs receipt metrics) |
| Verification | Deno: batching ≤100, receipt handling, `DeviceNotRegistered` disables the token, unknown channel never sent to an old app version. Vitest: `ttl`/`collapseId` derivation per category. |
| Master refs | M§35, M§86, M§96, M§132 |

#### KPL-06 · Lock-screen privacy: the server cannot see lock state, and per-notification public versions are unavailable through Expo
| Field | Detail |
|---|---|
| Limitation | <ul><li>The server cannot know whether the phone is locked at send time.</li><li>iOS applies the user's "Önizlemeleri Göster" setting.</li><li>Android applies per-channel `lockscreenVisibility` plus the OS "sensitive content" setting. Expo push exposes neither `setPublicVersion()` nor FCM `visibility` per message.</li><li>Content is fixed when sent, so changing the detail mode does not rewrite delivered notifications.</li></ul> |
| Evidence | [OFF] https://docs.expo.dev/versions/latest/sdk/notifications/ (channel `lockscreenVisibility`; iOS category `previewPlaceholder`) ; [OFF] https://developer.android.com/about/versions/15/behavior-changes-all (`setPublicVersion`) ; [KNOW] https://developer.apple.com/documentation/usernotifications/unnotificationsettings/showpreviewssetting |
| Product behaviour | <ul><li>The server renders text per `notification_preferences` detail mode (`full` \| `title_only` \| `generic`; default `title_only`, M§86, ADR-10).</li><li>Every Android channel, including `account`, is created with `lockscreenVisibility: PRIVATE` (R-12).</li><li>iOS categories set the hidden-preview body to "Dijital Asistan güncellemesi".</li><li>The app reports the iOS `allowsPreviews` value (expo `getPermissionsAsync().ios.allowsPreviews`) in `platform_capabilities.ios_show_previews` for support visibility. It does not change server rendering.</li></ul> |
| UI communication | P7 footnote under the detail-level picker: iOS `limits.notifications.detail_footnote_ios` "Kilit ekranında ne görüneceğini bu seçim belirler; iPhone'undaki "Önizlemeleri Göster" ayarı da geçerlidir. Değişiklik, bundan sonra gelecek bildirimlere uygulanır." Android `limits.notifications.detail_footnote_android` "Kilit ekranında ne görüneceğini bu seçim belirler; Android'in kilit ekranı bildirim ayarları da geçerlidir. Değişiklik, bundan sonra gelecek bildirimlere uygulanır." |
| Affected | `app/settings/notifications`; decision engine (`packages/domain/notifications`); widgets (KPL-18, KPL-19) |
| Verification | Vitest: render tables for all three modes (tr/en), no body text in `data`. Jest: footnote per platform. Manual: a locked device shows the hidden-preview text on iOS with previews "Kilitli değilken". |
| Master refs | M§35, M§86, M§132 |

#### KPL-07 · iOS Time Sensitive is user-controllable; Focus and Scheduled Summary can hold notifications; Critical Alerts are unavailable
| Field | Detail |
|---|---|
| Limitation | <ul><li>Time-sensitive notifications break through Focus and the Notification Summary **only if the user allows it**; the user can turn this off per app.</li><li>`active` and `passive` notifications can be held in the Scheduled Summary.</li><li>Critical Alerts need an Apple-granted entitlement reserved for health/safety use cases.</li></ul> |
| Evidence | [OFF] https://developer.apple.com/documentation/usernotifications/unnotificationinterruptionlevel/timesensitive (quote: "The user can turn off the ability for time sensitive notification interruptions.") ; [KNOW] https://developer.apple.com/documentation/usernotifications/unnotificationsettings/timesensitivesetting ; [KNOW] https://developer.apple.com/documentation/usernotifications/unauthorizationoptions/criticalalert |
| Product behaviour | <ul><li>Interruption levels per ADR-10: `time-sensitive` for meetings ≤10 min, expiring approvals and user reminders; `active` for the morning briefing and critical mail; `passive` for midday and evening.</li><li>The `com.apple.developer.usernotifications.time-sensitive` entitlement is added via the config plugin (**Manual external step**: capability in the Apple Developer portal).</li><li>`da-platform.getTimeSensitiveSetting()` reads `timeSensitiveSetting` on each foreground and reports it in `platform_capabilities.ios_time_sensitive`.</li><li>The product never uses `critical`.</li></ul> |
| UI communication | P5-style row on `app/settings/notifications`, only when the setting is `disabled`: `limits.notifications.time_sensitive_off_title` "Zamana Duyarlı Bildirimler kapalı" / `limits.notifications.time_sensitive_off_body` "Toplantı ve hatırlatıcı bildirimlerin Odak modunda ya da Planlanmış Özet'te bekleyebilir." / CTA `limits.common.open_settings` "Ayarları Aç" (P8 `Linking.openSettings()`). |
| Affected | `app/settings/notifications`, M-REM-01 (reminders), meeting prep pushes |
| Verification | Jest: the row appears only for `disabled`. Manual iOS: disable Time Sensitive → row visible; Focus on → meeting push held. |
| Master refs | M§35, M§132 |

#### KPL-08 · Android notification channels and the runtime permission
| Field | Detail |
|---|---|
| Limitation | <ul><li>After creation, a channel's importance and sound belong to the user; the app cannot raise them.</li><li>The user can disable any channel.</li><li>Android 13+ requires `POST_NOTIFICATIONS`, and the prompt appears only after at least one channel exists.</li><li>After a second denial the system stops showing the prompt.</li></ul> |
| Evidence | [OFF] https://docs.expo.dev/versions/latest/sdk/notifications/ ("Android 13: the permission prompt appears only after at least one channel exists") ; [KNOW] https://developer.android.com/develop/ui/views/notifications/channels ; [KNOW] https://developer.android.com/develop/ui/views/notifications/notification-permission |
| Product behaviour | <ul><li>Channels are created at first launch, **before** the permission prompt and before `getExpoPushTokenAsync`. Their IDs are fixed by R-12: `briefings` (morning, midday, evening, weekly), `critical_email`, `meetings`, `deadlines`, `follow_up`, `life_intel`, `approvals`, `reminders`, `account` and `phone_digest` (Android NI only). Names are localised as in SCREEN_AND_FLOW_MAP §12.1, and every channel uses `lockscreenVisibility = PRIVATE`.</li><li>Changing a channel's default importance requires a **new channel ID**; the old one is deleted with `deleteNotificationChannelAsync`.</li><li>On each foreground, `getNotificationChannelsAsync()` is compared with the in-app category toggles.</li><li>The permission prompt is shown only from onboarding step 14 or in context, never at every launch (SREQ-57).</li></ul> |
| UI communication | <ul><li>Category row meta when the channel importance is `NONE`: `limits.notifications.channel_off_meta` "Android ayarlarında kapalı". Tap → P8 `Linking.sendIntent('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [{key:'android.provider.extra.APP_PACKAGE', value: pkg},{key:'android.provider.extra.CHANNEL_ID', value: id}])`.</li><li>Permission denied: `limits.notifications.permission_off_row` "Bildirimler kapalı · Ayarlar'da aç" (P8).</li></ul> |
| Affected | `app/(onboarding)/notifications`, `app/settings/notifications`, the `push_tokens` registration path |
| Verification | Jest: channel-before-token ordering; channel-off meta. Maestro Android: grant/deny flows. |
| Master refs | M§35, M§34 |

#### KPL-09 · Android exact alarms: user-granted special access on Android 14+; `USE_EXACT_ALARM` is Play-restricted
| Field | Detail |
|---|---|
| Limitation | <ul><li>Exact-time scheduling needs `SCHEDULE_EXACT_ALARM`. It is not pre-granted to new installs on Android 14+ (apps targeting 33+) and the user can revoke it on 12–13.</li><li>`USE_EXACT_ALARM` is auto-granted but Play restricts it to alarm/timer/calendar apps.</li><li>Inexact alarms can be delayed, especially in Doze.</li><li>RN `Linking.sendIntent` passes numeric extras as doubles, so typed intents need native code.</li></ul> |
| Evidence | [OFF] https://docs.expo.dev/versions/latest/sdk/notifications/ (exact-time local notifications need `SCHEDULE_EXACT_ALARM`; `USE_EXACT_ALARM` restricted) ; [KNOW] https://developer.android.com/about/versions/14/changes/schedule-exact-alarms ; [KNOW] https://developer.android.com/develop/background-work/services/alarms/schedule ; [KNOW] https://support.google.com/googleplay/android-developer/answer/12253906 |
| Product behaviour | <ul><li>The manifest declares `SCHEDULE_EXACT_ALARM` only (never `USE_EXACT_ALARM`).</li><li>Before scheduling a device-local reminder (M-REM-01; the only device-local notifications, per ADR-10), the app calls `da-platform.canScheduleExactAlarms()`.</li><li>If false, the reminder is still created and scheduled (inexact), and a P3 note offers the special-access screen via `da-platform.openExactAlarmSettings()` (`ACTION_REQUEST_SCHEDULE_EXACT_ALARM` + `package:` URI).</li><li>The state is re-checked on resume.</li><li>**Delivery-path verification:** a manual Doze test (see Verification) must show exact delivery through expo-notifications when access is granted. If it does not, the Android reminder schedule call is routed through `da-platform.scheduleExactReminder({id, fireAt, title, body, deeplink})` (Kotlin `AlarmManager.setExactAndAllowWhileIdle` + a receiver that posts on channel `reminders`), with cancel through `da-platform.cancelExactReminder(id)`.</li></ul> |
| UI communication | P3 in M-REM-01 (Android, access missing): `limits.reminders.exact_alarm_warning` "Tam saatinde hatırlatabilmem için "Alarmlar ve hatırlatıcılar" iznini aç. Bu izin kapalıyken hatırlatıcı birkaç dakika gecikebilir." / CTA `limits.reminders.exact_alarm_cta` "İzni Aç". |
| Affected | M-REM-01, M-REM-02; `reminders`; `da-platform` |
| Verification | <ul><li>Jest: warning shown iff Android and `canScheduleExactAlarms()=false`.</li><li>Manual Android 14: fresh install → warning; grant → warning gone.</li><li>`adb shell dumpsys deviceidle force-idle` + reminder 10 min ahead → delivered within 1 min when granted.</li></ul> |
| Master refs | M§29, M§96 |

#### KPL-10 · Setting a system alarm ("Alarm Kur")
| Field | Detail |
|---|---|
| Limitation | <ul><li>Before iOS 26, third-party apps cannot create system alarms.</li><li>iOS 26+ AlarmKit allows it after user authorization.</li><li>Android apps can only hand off to the Clock app with `AlarmClock.ACTION_SET_ALARM`; the user confirms there.</li></ul> |
| Evidence | [KNOW] https://developer.apple.com/documentation/alarmkit ; [KNOW] https://developer.android.com/reference/android/provider/AlarmClock#ACTION_SET_ALARM ; design audit (evening Today card "Alarm Kur") |
| Product behaviour | `da-platform.scheduleSystemAlarm({fireAt, label})`: <ul><li>**iOS 26+:** AlarmKit authorization (usage string `NSAlarmKitUsageDescription`), then schedule.</li><li>**iOS < 26:** `isSystemAlarmAvailable()` returns false; the button becomes "Hatırlatıcı Kur" and opens M-REM-01 preset to the time (time-sensitive local reminder).</li><li>**Android:** fires `ACTION_SET_ALARM` with `EXTRA_HOUR`, `EXTRA_MINUTES`, `EXTRA_MESSAGE` and `EXTRA_SKIP_UI=false` (permission `com.android.alarm.permission.SET_ALARM`). If no activity resolves the intent, it falls back to M-REM-01.</li></ul> The alarm time comes only from grounded source data (e.g. flight departure) or the user; "leave by" times are never computed (KPL-47). |
| UI communication | <ul><li>iOS < 26: P3 `limits.alarm.ios_unavailable_note` "Bu iOS sürümünde uygulamalar alarm kuramaz. Bunun yerine zamana duyarlı bir hatırlatıcı kurabilirim." + button `limits.alarm.cta_reminder` "Hatırlatıcı Kur".</li><li>Android: P3 `limits.alarm.android_handoff_note` "Saat uygulaması açılacak; alarmı orada onayla."</li><li>iOS 26+ usage string `limits.alarm.ios_usage` "Yalnızca sen istediğinde, örneğin erken bir uçuştan önce, alarm kurabilmek için."</li></ul> |
| Affected | `app/(tabs)/today/index` evening card "Alarm Kur", `app/life/[id]` (flight) |
| Verification | Jest: platform/version branching. Manual: iOS 26 device (alarm set), iOS 17 device (reminder fallback), Android (Clock app prefilled). |
| Master refs | M§11, M§23, M§91 |

### B. Background execution and device data freshness

#### KPL-11 · Background execution is not guaranteed on either platform
| Field | Detail |
|---|---|
| Limitation | <ul><li>`expo-background-task` uses BGTaskScheduler on iOS: the system decides timing and there is no guarantee. It is a processing task, which the system favours when the device is idle, and it is not available in the Simulator.</li><li>On Android it uses WorkManager: minimum interval 15 min; runs only with enough battery and network; one worker per app (the last registered interval wins); Android 16 quotas are tied to the app standby bucket; OEM battery managers kill work.</li><li>Silent pushes: iOS treats background notifications as low priority, throttles them and does not deliver them after a force-quit. On Android, normal-priority data messages wait for Doze maintenance windows, and FCM may deprioritise high-priority messages that show nothing.</li></ul> |
| Evidence | [OFF] https://docs.expo.dev/versions/latest/sdk/background-task/ ; [OFF] https://developer.android.com/about/versions/16/behavior-changes-all ; [KNOW] https://developer.apple.com/documentation/backgroundtasks/bgprocessingtaskrequest ; [KNOW] https://developer.android.com/topic/performance/appstandby ; [KNOW] https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app ; [KNOW] https://firebase.google.com/docs/cloud-messaging/android/message-priority |
| Product behaviour | <ul><li>**Server-side work never depends on the app running.** Briefings, sync, AI and notifications all run in `worker` (ADR-04, ADR-28).</li><li>The app registers **exactly one** periodic background task, `da-background-refresh` (`minimumInterval: 30`, as in INTEGRATION_PLAN §12.7). Within a 25 s budget it (1) refreshes the session, (2) uploads the device-calendar snapshot when a device account and permission exist (KPL-12), (3) on Android uploads the NI signal buffer, (4) fetches `GET /widgets/snapshot` and reloads the widgets (KPL-17/19), and (5) reschedules local reminders.</li><li>A background-notification task `da-background-notification` (expo-notifications `registerTaskAsync`) runs the same routine for `data.type='device_refresh'` pushes (KPL-12).</li><li>Foreground is the primary refresh trigger (app open, resume, pull-to-refresh).</li></ul> |
| UI communication | Surfaced through freshness (P4, KPL-12) and widget timestamps (KPL-17). Help `limits.help.widgets_refresh` "Widget'lar uygulamayı açtığında hemen, arka planda ise telefonunun izin verdiği sıklıkta güncellenir." |
| Affected | Device calendars, widgets, Android NI, the offline mutation queue (flushed only in foreground, ADR-54) |
| Verification | Jest: a single `defineTask`/registration; routine time-budget abort. Manual: iOS device (`e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"com.expo.modules.backgroundtask.processing"]` in the debugger); Android `adb shell cmd jobscheduler run -f`. |
| Master refs | M§94, M§96, M§125 |

#### KPL-12 · Device calendars (Apple/Android) reach the server only when the app runs, so server briefings can be stale
| Field | Detail |
|---|---|
| Limitation | <ul><li>EventKit and CalendarContract data exist only on the device and have no server API.</li><li>`EKEventStoreChanged` fires only while the app runs.</li><li>Background refresh is best-effort (KPL-11). A 08:00 morning briefing generated on the server can miss events added on the device since the last upload.</li><li>Meeting prep and post-meeting pushes cannot be scheduled for device events the server has not seen.</li></ul> |
| Evidence | [OFF] integrations audit §C.4 (device-local read → upload; "Document … that a 08:00 server briefing can be stale for Apple and Android device calendars if the app has not run") ; [KNOW] https://developer.apple.com/documentation/foundation/nsnotification/name-swift.struct/ekeventstorechanged ; KPL-11 sources |
| Product behaviour | <ol><li>The snapshot (window and fields per INTEGRATION_PLAN) is uploaded through `POST /integrations/device-calendar/snapshot` on app foreground, on `EKEventStoreChanged` / content-observer change while running, on `da-background-refresh`, and on a **pre-briefing refresh nudge**.</li><li>The nudge: `scheduler_tick()` enqueues an ordinary `notification` job with `payload.kind='device_refresh'` (no new `job_type`) at *configured briefing time − 40 min* (generation starts at −20 min, ADR-28) for morning and evening briefings. It targets installations that have an `apple_device`/`android_device` connected account and an active push token. Push shape: `{data:{type:'device_refresh'}, _contentAvailable:true, priority:'normal'}`, with no title or body. Idempotency key `device_refresh:{installation_id}:{kind}:{local_date}`; at most 2 per day per installation. The push displays nothing, so it writes no `notifications` ledger row and is exempt from quiet hours and `daily_cap`. The job is observable in `jobs` like any other. No feature flag controls it (R-10).</li><li>`sync_states.last_success_at` for the device account records freshness. At generation, `briefings.source_freshness` stores `{connected_account_id: {provider, last_success_at, stale}}`, where `stale = now − last_success_at > DEVICE_CALENDAR_STALE_MINUTES` (180; a `packages/domain` constant, not a flag, per R-10).</li><li>When a later snapshot changes events inside the briefing's day, the briefing is **not** regenerated (cost, M§82). The briefing screen shows a banner; Plan and Today always read current `calendar_events`.</li></ol> |
| UI communication | <ul><li>P4 on every device-sourced item and in the "Programın" section header: "Apple Takvim · son eşitleme 07:12" / "Cihaz Takvimi · son eşitleme 07:12" (key `limits.device_calendar.provenance`).</li><li>P3 in "Programın" when `stale`: `limits.device_calendar.stale_note` "{source} · son eşitleme {time}. Sonraki değişiklikler uygulamayı açtığında eklenir."</li><li>Banner in `app/briefing/[id]` after a post-generation change: `limits.device_calendar.changed_after_briefing` "Takvimin bu brifingden sonra değişti." + CTA `limits.device_calendar.see_current` "Güncel programı gör" → `/(tabs)/plan?date=today`.</li><li>Connect footnotes: iOS `limits.device_calendar.connect_footnote_ios` "Apple Takvim cihazından okunur; ayrı giriş gerekmez. Uygulamayı açtığında ve iOS izin verdiğinde arka planda güncellenir." Android `limits.device_calendar.connect_footnote_android` "Cihaz takvimi telefonundan okunur. Uygulamayı açtığında ve Android izin verdiğinde arka planda güncellenir."</li><li>`app/settings/accounts/[id]` (device account): "Son eşitleme {time}" + `limits.device_calendar.sync_now` "Şimdi eşitle".</li></ul> |
| Affected | `app/(onboarding)/connect-calendar`, `app/briefing/[id]`, Today, `app/(tabs)/plan/index`, `app/meeting/[eventId]/prep`, `app/settings/accounts/[id]`, M-SRC-01; jobs `device_calendar_ingest`, `briefing`, `notification` (`payload.kind='device_refresh'`); `briefings`, `sync_states` |
| Verification | <ul><li>pgTAP: `scheduler_tick(p_now)` enqueues exactly one `notification` job with `payload.kind='device_refresh'` per installation, kind and local date (key `device_refresh:{installation_id}:{kind}:{local_date}`), and none for an installation without a device account.</li><li>Deno: snapshot endpoint updates `sync_states`; briefing generation writes `source_freshness` with the `stale` flag.</li><li>Jest: stale note and change banner rendering.</li><li>Manual: kill the app at 06:00, add an event at 07:00, observe the 08:00 briefing note, open the app → banner.</li></ul> |
| Master refs | M§9, M§19, M§20, M§75, M§91, M§94, M§97 |

#### KPL-13 · EventKit read requires full access (there is no read-only option)
| Field | Detail |
|---|---|
| Limitation | <ul><li>iOS 17+ offers full access or write-only access. Write-only returns one virtual calendar and cannot read anything.</li><li>Reminders need separate full access.</li><li>Without `NSCalendarsFullAccessUsageDescription`, iOS 17 auto-denies. The old keys are still needed for iOS 16.x.</li><li>After a denial, only the Settings app can grant access.</li></ul> |
| Evidence | [OFF] https://developer.apple.com/documentation/eventkit/accessing-the-event-store ; [OFF] https://docs.expo.dev/versions/latest/sdk/calendar/ (`calendarPermission`, `remindersPermission`; Reminders iOS-only) |
| Product behaviour | <ul><li>Full access is requested only when the user taps "Apple Takvim'e İzin Ver" (M§34 step 7) or picks an Apple destination (M-REM-03, M-APPR-05). Reminders access only on the first "Apple Anımsatıcılar" pick.</li><li>`expo-calendar` config plugin sets `calendarPermission` and `remindersPermission`; the legacy `NSCalendarsUsageDescription` / `NSRemindersUsageDescription` are kept for 16.x.</li><li>Write-only access is never requested.</li><li>`canAskAgain=false` → P8 `Linking.openSettings()`.</li></ul> |
| UI communication | <ul><li>Explainer before the OS prompt (P3 on the calendar explainer): `limits.device_calendar.full_access_explainer` "iOS, Apple Takvim'i okuyabilmem için tam erişim ister; yalnızca okuma diye bir seçenek yok. Takviminde, sen onaylamadan hiçbir değişiklik yapmam."</li><li>Plist strings are owned by INTEGRATION_PLAN §12.8 and reused verbatim (Turkish development region; English through the Expo `locales` config): `NSCalendarsFullAccessUsageDescription` / `NSCalendarsUsageDescription` "Takvimindeki etkinlikleri günlük brifinge, toplantı hazırlığına ve çakışma uyarılarına eklemek için. Etkinlik bilgilerin analiz için hesabına eşitlenir; değişiklikler yalnızca senin onayınla yapılır." and `NSRemindersFullAccessUsageDescription` / `NSRemindersUsageDescription` "Apple Anımsatıcılar'daki görevlerini brifinge eklemek ve onayınla yeni anımsatıcı oluşturmak için."</li><li>Denied state: design 08 `error/permission-denied` "Takvim izni verilmedi." / "Toplantı hazırlığı ve çakışma uyarıları takvim erişimi gerektirir. Diğer her şey çalışıyor." / "İzin Ver" · "Neden gerekli?"</li></ul> |
| Affected | `app/(onboarding)/connect-calendar`, `app/settings/privacy/permissions`, M-REM-03, M-APPR-05 |
| Verification | Prebuild smoke: plist keys present in both languages. Jest: explainer precedes `requestCalendarPermissionsAsync`. Manual iOS 16.4 and iOS 17+: grant/deny/settings round-trip. |
| Master refs | M§34, M§40, M§75, M§76 |

#### KPL-14 · Writes to device destinations run on the device ("device executor")
| Field | Detail |
|---|---|
| Limitation | <ul><li>The server cannot write to Apple Calendar, Apple Reminders or the Android device calendar. Only the app on **that** device can, and only while running with permission.</li><li>EventKit cannot add attendees (`EKParticipant` is read-only).</li><li>`UIDevice.name` returns a generic name on iOS 16+ without an Apple-granted entitlement.</li></ul> |
| Evidence | [KNOW] https://developer.apple.com/documentation/eventkit/ekparticipant ; [OFF] https://docs.expo.dev/versions/latest/sdk/calendar/ ; [KNOW] https://developer.apple.com/documentation/uikit/uidevice/name |
| Product behaviour | <ul><li>An approval whose destination is a device calendar or Apple Reminders is created with `approval_actions.executor='device'` and `device_installation_id` set to the installation that holds the device account and its OS permission. Every other approval keeps `executor='server'`.</li><li>Approved on that installation: the status becomes `executing` without a worker job. The response carries the exact change and a one-time device token; only its hash is stored, in `approval_actions.device_token_hash`. The app writes via `expo-calendar` (`createEventAsync` / `createReminderAsync`) and reports the result through `POST /approvals/:id/device-execution` (API_CONTRACTS API-APR-05; the canonical name per R-18/R-24).</li><li>Approved on another device: the approval stays `approved` until the destination installation next opens and claims it on bootstrap, then executes there. The idempotency key prevents double writes, and a retry first re-checks the device item for the approval marker (API_CONTRACTS §6.7).</li><li>Once `executing`, a missing result after 10 min moves the approval to `failed` with `DEVICE_RESULT_MISSING` (retryable).</li><li>Permission missing at execution → `failed{device_permission_denied}` → "İzin Ver" → "Tekrar dene" (Part 2 flow).</li><li>The attendee field is hidden for device destinations.</li><li>The device label comes from `expo-device` `modelName`.</li></ul> |
| UI communication | <ul><li>Destination line meta on M-APPR-01/03/04: this device → `limits.device_executor.meta_this_device` "Bu işlem bu cihazda, uygulama açıkken tamamlanır."; another device → `limits.device_executor.meta_other_device` "Bu işlem yalnızca {device} üzerinde tamamlanabilir."</li><li>P3 in M-APPR-05 for device calendars: `limits.device_calendar.no_attendees` "Cihaz takviminde katılımcı eklenemez. Davet göndermek için Google veya Outlook takvimini seç."</li></ul> |
| Affected | M-APPR-01/03/04/05, M-REM-03, `app/plan/proposal/[id]`; `approval_actions`; approval types `calendar_create`, `reminder_create`, `task_create` (Apple Reminders) |
| Verification | <ul><li>Deno: `POST /approvals/:id/device-execution` is accepted only from the `device_installation_id` installation with a valid device token; a replay with the same idempotency key is a no-op; the scheduler marks an `executing` device approval `failed` (`DEVICE_RESULT_MISSING`) after 10 min.</li><li>Jest: attendee field hidden.</li><li>Manual: approve on iPad for an iPhone destination → executes on the next iPhone open.</li></ul> |
| Master refs | M§19, M§29, M§33, M§115 |

#### KPL-15 · The same calendar can arrive twice (OAuth provider + device calendar)
| Field | Detail |
|---|---|
| Limitation | A user can connect Google Calendar through OAuth while the same Google or Exchange account is also configured on the device. EventKit and CalendarContract then expose the same events again. Identifier exposure differs: EventKit `calendarItemExternalIdentifier`; CalendarContract `UID_2445`, which `expo-calendar` may not surface. |
| Evidence | [KNOW] https://developer.apple.com/documentation/eventkit/ekcalendaritem/calendaritemexternalidentifier ; [KNOW] https://developer.android.com/reference/android/provider/CalendarContract.Calendars (`ACCOUNT_NAME`, `ACCOUNT_TYPE`) ; [OFF] integrations audit §X.1 (iCalUID for cross-provider duplicates) |
| Product behaviour | <ul><li>On device connect, device calendars whose source/account name matches the email of an OAuth-connected account (EventKit `EKSource.title`, CalendarContract `ACCOUNT_NAME`) are imported with `calendars.selected=false` (DATABASE_AND_RLS_PLAN; the user can change it through the column's update grant).</li><li>Server dedupe on ingest: `iCalUID` / external identifier match. Otherwise a (normalised title, start, end) match within the same user. The OAuth source is preferred as the canonical row (it supports approvals with attendees).</li></ul> |
| UI communication | Data-sources calendar list: the row meta on auto-deselected calendars is `limits.device_calendar.duplicate_meta` "Bu hesap zaten bağlı; iki kez eklenmez." The user can still re-enable it (P2 toggle). |
| Affected | `app/settings/privacy/data-sources`, `app/settings/accounts/[id]`, Plan, briefings |
| Verification | Vitest (`packages/domain`): dedupe matcher fixtures. Deno: snapshot ingest with a duplicate → one `calendar_events` row. |
| Master refs | M§19, M§75, M§116 |

#### KPL-16 · Apple Reminders is iOS-only, and Android has no system tasks store
| Field | Detail |
|---|---|
| Limitation | The `expo-calendar` reminder APIs are iOS-only and throw `UnavailabilityError` elsewhere. Android has no platform-wide tasks API. |
| Evidence | [OFF] https://docs.expo.dev/versions/latest/sdk/calendar/ (Reminders "iOS-only") |
| Product behaviour | <ul><li>Android reminder and task destinations: "Dijital Asistan bildirimi", Google Tasks and Microsoft To Do (OAuth).</li><li>The integrations list shows Apple Takvim / Apple Anımsatıcılar on iOS and "Cihaz Takvimi" on Android (C-35).</li></ul> |
| UI communication | P1: the Apple rows are hidden on Android. |
| Affected | M-REM-03, M-APPR-05, `app/settings/accounts`, `app/(onboarding)/connect-calendar` |
| Verification | Jest: platform filtering of destination options. |
| Master refs | M§29, M§75 |

### C. Widgets

#### KPL-17 · WidgetKit refresh budget, extension memory and data protection
| Field | Detail |
|---|---|
| Limitation | <ul><li>A typical daily budget of about 40–70 timeline reloads per widget (roughly every 15–60 min). Reloads while the app is in the foreground do not count.</li><li>Timeline entries should be ≥ about 5 min apart.</li><li>Widget extensions are limited to about 30 MB.</li><li>App Group data written with default protection is unreadable before the first unlock after reboot.</li></ul> |
| Evidence | [OFF] https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date (quote: "a daily budget typically includes from 40 to 70 refreshes") ; [SEC] Apple Developer Forums thread 713561 (widget ≈30 MB) ; [KNOW] https://developer.apple.com/documentation/foundation/fileprotectiontype/completeuntilfirstuserauthentication |
| Product behaviour | <ul><li>The app fetches `GET /widgets/snapshot` (rendered server-side with the same detail-mode rules as push) and writes the zod-validated `WidgetSnapshotV1` (SCREEN_AND_FLOW_MAP §11.2: counts, next event time, titles only if the detail mode allows, no mail bodies, no images) to App Group `group.com.dijitalasistan.app` `UserDefaults` (protection class *complete until first user authentication*).</li><li>It calls `WidgetCenter.reloadTimelines(ofKind:)` on foreground (free), after sync or briefing completion while running, and from `da-background-refresh`/`da-background-notification` (budgeted).</li><li>Timelines precompute entries at known boundaries: next event start/end, briefing time.</li><li>The provider's `placeholder(in:)` view renders neutral content (app mark + redacted bars).</li><li>The snapshot is cleared on sign-out (ADR-54).</li><li>WidgetKit push is not used (ADR-40).</li></ul> |
| UI communication | <ul><li>Snapshot time is always visible in the medium/large kicker (design "07:58").</li><li>If the snapshot is older than 6 h, the widget meta reads `limits.widgets.stale_meta` "Son güncelleme {time}".</li><li>Signed-out and no-source states use the M-WGT copy owned by SCREEN_AND_FLOW_MAP §11 ("Giriş yap" / "Hesabını bağla"). A snapshot older than 24 h switches to the `stale` state "Güncellemek için uygulamayı aç."</li><li>Empty: "Her şey kontrol altında." (design 08).</li><li>Help: `limits.help.widgets_refresh` (KPL-11).</li></ul> |
| Affected | iOS widgets S/M/L (M-WGT-01…03); `apps/mobile/targets/widget`; `da-widgets` bridge; `GET /widgets/snapshot` |
| Verification | `WidgetSnapshot` schema tests (no body fields, size < 4 KB). Prebuild smoke (target + entitlements). Manual: reboot → pre-unlock widget shows the neutral view; sign-out clears the widget. |
| Master refs | M§37, M§86, M§125 |

#### KPL-18 · Lock Screen widgets: system rendering and privacy redaction
| Field | Detail |
|---|---|
| Limitation | <ul><li>Accessory families (`accessoryCircular`, `accessoryRectangular`, `accessoryInline`) render in vibrant monochrome, so custom colours and backgrounds are ignored.</li><li>`accessoryInline` is a single line placed by the system above the clock.</li><li>The small widget supports only one tap target (`widgetURL`).</li><li>`.privacySensitive()` content is redacted while the device is locked.</li><li>iOS 18+ accented/tinted modes recolour content.</li></ul> |
| Evidence | [KNOW] https://developer.apple.com/documentation/widgetkit/creating-lock-screen-widgets-and-watch-complications ; [KNOW] https://developer.apple.com/documentation/swiftui/view/privacysensitive(_:) ; [KNOW] https://developer.apple.com/documentation/widgetkit/widgetrenderingmode ; design audit §B (lock screen) |
| Product behaviour | <ul><li>Names and subjects are wrapped in `.privacySensitive()`; accents in `widgetAccentable()`.</li><li>Content follows the `notification_preferences` detail mode (SREQ-63): `full` shows titles (redacted while locked); `title_only` shows category + time ("Toplantı · 14:30"); `generic` shows counts only.</li><li>No write actions (design 08); every view deep-links (`dijitalasistan://…`).</li></ul> |
| UI communication | Generic lock-screen strings: inline `limits.widgets.generic_inline` "{n} önemli konu"; rectangular "SONRAKİ · 14:30" + "Toplantı". |
| Affected | iOS Lock Screen widget families (M-WGT-04…06) |
| Verification | SwiftUI previews per mode (CI prebuild + EAS compile). Manual: locked vs Face ID-unlocked lock screen. |
| Master refs | M§37, M§86 |

#### KPL-19 · Android widget update limits, the Android 17 bitmap cap, and no lock-screen widgets on phones
| Field | Detail |
|---|---|
| Limitation | <ul><li>`updatePeriodMillis` values below 30 min are not supported.</li><li>`onUpdate` receivers have about 10 s.</li><li>When targeting API 37 (Android 17), RemoteViews bitmaps plus icons are capped at 1.5 × screen width × height × 4 bytes; exceeding it throws a fatal `IllegalArgumentException`.</li><li>Android phones offer no third-party lock-screen widgets.</li><li>Android widgets have no per-view redaction.</li></ul> |
| Evidence | [OFF] https://developer.android.com/develop/ui/views/appwidgets/advanced (quote: "`updatePeriodMillis` doesn't support values of less than 30 minutes") ; [OFF] https://developer.android.com/about/versions/17/behavior-changes-17 ; [KNOW] lock-screen widget absence on phones |
| Product behaviour | <ul><li>Glance widgets (2×2, 4×2) in `da-widgets` use `updatePeriodMillis=0`, updated by `GlanceAppWidget.updateAll()` from the app and from `da-background-refresh` (WorkManager).</li><li>No bitmaps: vector drawables generated from the Material Symbols SVG pipeline, and the system corner radius (`system_app_widget_background_radius`). The design stays within the Android 17 cap at the current target of 36, so raising the target needs no change.</li><li>Content follows the detail mode like iOS; `generic` shows counts only.</li><li>`PendingIntent` uses `FLAG_IMMUTABLE` and launches the activity directly (no trampoline).</li></ul> |
| UI communication | Help/FAQ `limits.help.widgets_android_lockscreen` "Android telefonlarda kilit ekranı widget'ı yok; ana ekran widget'larını kullanabilirsin." Widget stale/empty states as KPL-17. |
| Affected | Android widgets (M-WGT-07, M-WGT-08); `apps/mobile/modules/da-widgets` |
| Verification | Kotlin unit test: rendered RemoteViews contain no bitmap. Instrumented: `updateAll()` after snapshot write. Glance version confirmed against Google Maven in CI (ADR-40). |
| Master refs | M§37, M§86 |

### D. Share, capture and clipboard

#### KPL-20 · iOS share extension: ~120 MB memory limit and an App Review risk in the redirect
| Field | Detail |
|---|---|
| Limitation | <ul><li>Share extensions are killed above about 120 MB (the limit is not enforced in the Simulator).</li><li>Apple's extension guide says share extensions cannot open their containing app. `expo-share-intent` redirects into the main app through an undocumented responder-chain `openURL`, which is widely shipped but is an App Review risk.</li></ul> |
| Evidence | [SEC] Apple Developer Forums thread 115259 ; [SEC] https://blog.kulman.sk/dealing-with-memory-limits-in-app-extensions/ ; [OFF] https://github.com/achorein/expo-share-intent (README: redirects to main app; SDK 57 → 8.0+) ; [KNOW] https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionOverview.html |
| Product behaviour | <ul><li>`expo-share-intent` 8.0.1 (ADR-41): payloads are passed by file URL in the App Group (never base64 in memory); images are downsampled; activation rules Text, WebURL ≤1, Image ≤5, File ≤5.</li><li>M-CAP-04 processes the payload through the common capture flow.</li><li>**Documented fallback if App Review rejects the redirect:** set `disableIOS: true` and ship a custom Swift share extension (`@bacons/apple-targets`, bundle `com.dijitalasistan.app.ShareExtension`). It shows a SwiftUI confirmation, writes the payload to the App Group and **does not open the app**. The main app picks up pending payloads on next launch and opens M-CAP-04.</li></ul> |
| UI communication | The primary path needs no copy. The fallback extension confirmation: `limits.share.saved_for_later` "Kaydedildi. Dijital Asistan'ı açtığında analize hazır olacak." |
| Affected | M-CAP-04, M-CAP-01; STORE_CHECKLIST (review note) |
| Verification | Prebuild smoke with apple-targets + share-intent. Manual on a physical iPhone: share a 5-image set and a 30 MB PDF → no crash, payload arrives. |
| Master refs | M§27, M§28, M§112 |

#### KPL-21 · Android share: temporary URI grants and payload types
| Field | Detail |
|---|---|
| Limitation | <ul><li>`content://` read grants from `ACTION_SEND` / `ACTION_SEND_MULTIPLE` are temporary.</li><li>Senders may share types we do not analyse (video, audio, archives).</li></ul> |
| Evidence | [OFF] integrations audit §H.4 ("Copy `content://` URIs immediately, because the read grant is temporary") ; [KNOW] https://developer.android.com/training/sharing/receive |
| Product behaviour | <ul><li>Files are copied into the app cache immediately on intake.</li><li>Intent filters: `text/*`, `image/*`, `application/pdf` (single) and `image/*`, `*/*` (multiple).</li><li>Unsupported MIME types are rejected in M-CAP-04.</li><li>Cached files are deleted on discard.</li></ul> |
| UI communication | M-CAP-04 (owned by Part 2): "Bu içerik türü desteklenmiyor. Fotoğraf, PDF, dosya, link veya metin paylaşabilirsin." / "En fazla 5 öğe analiz edebilirim; ilk 5'i seçtim." |
| Affected | M-CAP-04 |
| Verification | Maestro Android `share-intent-pdf.yaml` (adb `am start -a android.intent.action.SEND`). |
| Master refs | M§28 |

#### KPL-22 · No automatic ingestion of screenshots or photos
| Field | Detail |
|---|---|
| Limitation | <ul><li>Watching the photo library or new screenshots needs broad media permissions (Android `READ_MEDIA_IMAGES`, iOS full Photos access), which the Play Photo and Video Permissions policy and privacy expectations disallow for this use.</li><li>iOS `userDidTakeScreenshotNotification` fires only while the app is in the foreground.</li></ul> |
| Evidence | [KNOW] https://developer.android.com/training/data-storage/shared/photopicker ; [KNOW] https://developer.apple.com/documentation/uikit/uiapplication/userdidtakescreenshotnotification ; secondary-docs SREQ-32 |
| Product behaviour | <ul><li>Capture "Screenshot" uses the system photo picker (`expo-image-picker`, no media permission); "Fotoğraf" uses camera or picker, with the camera permission requested only when "Kamera" is chosen.</li><li>The share sheet is the second path.</li><li>There is no background scanning.</li></ul> |
| UI communication | None needed; the picker is the visible, honest entry point. |
| Affected | M-CAP-01/02 |
| Verification | Android manifest check in CI: no `READ_MEDIA_IMAGES`/`READ_EXTERNAL_STORAGE`. |
| Master refs | M§27, M§87 |

#### KPL-23 · Clipboard access prompts and notices
| Field | Detail |
|---|---|
| Limitation | <ul><li>iOS 16+ asks the user for permission when an app reads the pasteboard programmatically, unless the read comes from a system paste control.</li><li>Android 12+ shows a system toast on clipboard reads.</li></ul> |
| Evidence | [KNOW] https://developer.apple.com/documentation/uikit/uipastecontrol ; [KNOW] https://docs.expo.dev/versions/latest/sdk/clipboard/ (`ClipboardPasteButton`) ; [KNOW] https://developer.android.com/about/versions/12/behavior-changes-all#clipboard-access-notifications |
| Product behaviour | <ul><li>The clipboard is never read automatically.</li><li>Link capture and referral-code entry use `ClipboardPasteButton` on iOS 16+ (no prompt) and an explicit "Yapıştır" button on Android.</li></ul> |
| UI communication | None. |
| Affected | M-CAP-01 (Link), M-REF-02 |
| Verification | Lint: no `getStringAsync` outside explicit user handlers. |
| Master refs | M§87 |

### E. Voice and audio

#### KPL-24 · On-device Turkish speech recognition depends on device and OS
| Field | Detail |
|---|---|
| Limitation | <ul><li>On-device recognition exists only on some devices and locales.</li><li>iOS falls back to Apple's servers (≈1 min audio per request, per-device and per-app daily limits).</li><li>Android on-device recognition needs API 31+, and offline model download needs API 33+.</li><li>When not on-device, audio goes to Apple or Google speech services.</li></ul> |
| Evidence | [OFF-README] https://github.com/jamsch/expo-speech-recognition (`supportsOnDeviceRecognition`, `androidTriggerOfflineModelDownload`) ; [KNOW] https://developer.apple.com/documentation/speech/sfspeechrecognizer ; [KNOW] https://developer.android.com/reference/android/speech/SpeechRecognizer ; ai-research §7 |
| Product behaviour | <ul><li>ADR-55: `expo-speech-recognition` with `lang:"tr-TR"` and `requiresOnDeviceRecognition` when supported. On Android 13+ with tr-TR missing, `androidTriggerOfflineModelDownload`.</li><li>If on-device is unavailable and flag `voice.stt_server` is on with a credential: record AAC 16 kHz mono → `POST /assistant/transcribe`, then delete the audio immediately.</li><li>Dictation over ~60 s always uses the server path.</li><li>If neither path is available, the text input is shown instead of the mic.</li><li>Voice never approves (R-03, C-07): a spoken write intent shows the approval card with the hint "Onaylamak için karta dokun.", and only a tap approves.</li></ul> |
| UI communication | <ul><li>Unavailable: `limits.voice.unavailable` "Sesli giriş bu cihazda kullanılamıyor." (same text as SCREEN_AND_FLOW_MAP Part 3).</li><li>First server-path use (P3): `limits.voice.server_fallback_notice` "Bu cihazda Türkçe konuşma tanıma cihaz üzerinde çalışmıyor. Sesin, metne çevrilmek için güvenli bağlantıyla sunucumuza gönderilir ve hemen silinir."</li><li>Privacy Center line: `limits.voice.platform_service_notice` "Cihaz üzerinde tanıma yoksa sesin Apple veya Google konuşma hizmetlerinde işlenebilir."</li><li>Server STT credential missing (plan §19): the backoffice shows "Harici kimlik bilgisi gerekli".</li></ul> |
| Affected | M-VOICE-01, M-MEET-02/04, M-ASST-02 (mic), `app/settings/privacy`; `POST /assistant/transcribe`; `platform_capabilities.stt_on_device_tr` |
| Verification | Jest: engine selection matrix. Deno: transcribe deletes the temporary object. Manual: iPhone with and without Siri language tr; Android 12 vs 14. |
| Master refs | M§25, M§40, M§90 |

#### KPL-25 · Native Turkish TTS voices vary by device; premium TTS is optional
| Field | Detail |
|---|---|
| Limitation | <ul><li>Available tr-TR voices and their quality differ: iOS default vs downloadable Enhanced/Premium (e.g. "Yelda"); Android depends on the installed engine and may lack tr-TR.</li><li>Android limits utterance length (`maxSpeechInputLength`).</li><li>`expo-speech` alone cannot seek or show lock-screen controls.</li></ul> |
| Evidence | [KNOW] https://docs.expo.dev/versions/latest/sdk/speech/ ; [KNOW] https://developer.android.com/reference/android/speech/tts/TextToSpeech.Engine#ACTION_INSTALL_TTS_DATA ; ai-research §7 |
| Product behaviour | <ul><li>`da-tts` synth-to-file (ADR-55) chooses the best tr-TR voice (`getAvailableVoicesAsync`, highest `quality`) and renders per-section files played by `expo-audio` (real seek, speed, lock screen).</li><li>Without a tr-TR voice: Android offers the engine install intent (`Linking.sendIntent('android.speech.tts.engine.INSTALL_TTS_DATA')`); iOS shows the download path.</li><li>With `voice.tts_premium` on, a credential present and the user Pro: `POST /briefings/:id/audio` returns a cached premium file.</li><li>With neither, audio is disabled and the text briefing remains.</li></ul> |
| UI communication | <ul><li>Player engine label: `limits.tts.engine_device` "Cihaz sesi" / `limits.tts.engine_premium` "Doğal ses".</li><li>No voice (P3): `limits.tts.no_tr_voice` "Bu cihazda Türkçe ses yüklü değil." + Android `limits.tts.install_android` "Ses paketini indir".</li><li>iOS P6: `limits.tts.install_ios_help` "Daha doğal bir ses için Ayarlar → Erişilebilirlik → Seslendirilen İçerik → Sesler → Türkçe yolundan bir ses indirebilirsin."</li><li>Nothing available: `limits.tts.unavailable_read_instead` "Bu cihazda dinleme kullanılamıyor; brifingini okuyabilirsin."</li></ul> |
| Affected | `app/briefing/[id]/listen`, Today "Dinle", M-MEET-03; `platform_capabilities.tts_tr_voice` |
| Verification | Normaliser unit tests. Player component test. Manual: an Android device with a non-Google TTS engine. |
| Master refs | M§9, M§25 |

#### KPL-26 · Background audio, lock-screen controls, CarPlay and Android foreground-service rules
| Field | Detail |
|---|---|
| Limitation | <ul><li>iOS needs `UIBackgroundModes: audio` for playback after locking.</li><li>A CarPlay app presence requires an Apple-granted audio entitlement.</li><li>Android 14+ requires a typed foreground service (`mediaPlayback`) plus a Play declaration.</li><li>Android 17 hardens background audio start.</li></ul> |
| Evidence | [KNOW] https://developer.apple.com/documentation/avfoundation/configuring-your-app-for-media-playback ; [KNOW] https://developer.apple.com/carplay/ ; [KNOW] https://developer.android.com/about/versions/14/changes/fgs-types-required ; [OFF] https://developer.android.com/about/versions/17/behavior-changes-all |
| Product behaviour | <ul><li>Playback always starts from a user tap in the foreground.</li><li>`expo-audio` with background playback enabled (iOS audio mode; Android media-playback service) and Now Playing metadata.</li><li>CarPlay: no CarPlay templates are shipped. System Now Playing controls are used. The CarPlay audio entitlement request stays a **Manual external step** (ADR-55) and is needed only for a dedicated CarPlay presence.</li></ul> |
| UI communication | None (standard system controls). |
| Affected | `app/briefing/[id]/listen` |
| Verification | Manual: lock during playback (iOS/Android), Control Center/notification controls, seek. |
| Master refs | M§9, M§25 |

### F. Runtime, locale and local security

#### KPL-27 · Hermes `Intl` gaps
| Field | Detail |
|---|---|
| Limitation | Hermes has historically not implemented `Intl.RelativeTimeFormat`, `Intl.ListFormat`, `Intl.DisplayNames`, `Intl.Segmenter`, `Intl.Locale` and (in older releases) `Intl.PluralRules`. Coverage of `timeZoneName` variants used by timezone libraries is also uncertain. SDK 57 turns on Hermes V1, whose exact coverage was not verifiable during planning. |
| Evidence | [KNOW] https://github.com/facebook/hermes/blob/main/doc/IntlAPIs.md ; stack-versions audit §8 ("recalled, not checked") ; ADR-14 |
| Product behaviour | <ul><li>`packages/i18n` exports `ensureIntl()`, run before i18n init. It probes (a) `Intl.PluralRules` for `tr`/`en` and polyfills with `@formatjs/intl-pluralrules` + tr/en locale data when `shouldPolyfill` says so (needed by ICU plurals in use-intl), and (b) timezone correctness by formatting a fixed instant in `Europe/Istanbul` and `Europe/Berlin` and comparing with known offsets. If (b) fails, it loads `@formatjs/intl-datetimeformat` with timezone data.</li><li>Relative time always uses date-fns `formatDistance`/`formatRelative` with `tr`/`enUS` (ADR-14).</li><li>Lists use `packages/i18n` `joinList(items, locale)` ("A, B ve C" / "A, B and C").</li><li>ESLint `no-restricted-properties` bans `Intl.RelativeTimeFormat`, `Intl.ListFormat`, `Intl.DisplayNames` and `Intl.Segmenter` in `apps/mobile` and `packages/ui`.</li></ul> |
| UI communication | None (correct formatting). |
| Affected | All mobile date, time and plural formatting |
| Verification | Vitest: `joinList`, probe logic with mocked `Intl`. Jest-expo: startup calls `ensureIntl()`. Maestro on EAS builds (both platforms): a hidden debug-free assertion screen is **not** used; instead Maestro asserts rendered strings ("3 gün önce", "14:30", plural forms) on real screens with demo data. |
| Master refs | M§39, M§125 |

#### KPL-28 · Turkish case mapping (İ/ı) with runtime uppercasing
| Field | Detail |
|---|---|
| Limitation | Turkish needs locale-specific casing (i→İ, ı→I). React Native `textTransform: 'uppercase'` and `String.prototype.toUpperCase()` apply the root/device locale, which produces "BILGI" instead of "BİLGİ". Locale-aware `toLocaleUpperCase('tr')` support on Hermes is unverified. |
| Evidence | [KNOW] https://www.unicode.org/Public/UCD/latest/ucd/SpecialCasing.txt (Turkish conditions) ; [KNOW] https://reactnative.dev/docs/text-style-props#texttransform |
| Product behaviour | <ul><li>All uppercase kickers and badges ("ÖNCELİKLERİN", "SONRAKİ", "ACİL", "SON TARİH") are stored **already uppercased** in the tr and en catalogs.</li><li>User data is never uppercased.</li><li>ESLint bans `textTransform: 'uppercase'` and `.toUpperCase()` on user-facing strings in `apps/mobile`/`packages/ui`.</li><li>Web and backoffice may use CSS `text-transform` because `<html lang="tr">` gives correct Turkish casing in browsers.</li></ul> |
| UI communication | None. |
| Affected | All kickers and badges |
| Verification | Lint rule. i18n catalog test: every key ending `.kicker`/`.badge` equals `toLocaleUpperCase('tr-TR')` of itself (computed in Node, which has full ICU). |
| Master refs | M§39, M§122 |

#### KPL-29 · Right-to-left layouts are not supported
| Field | Detail |
|---|---|
| Limitation | Product decision (SREQ-88): only Turkish (default) and English, both left-to-right. RTL mirroring is not implemented or tested. |
| Evidence | secondary-docs SREQ-88 ("RTL zorunlu değil"; record here) ; [KNOW] https://docs.expo.dev/guides/localization/ (RTL is opt-in) |
| Product behaviour | <ul><li>`I18nManager.allowRTL(false)` and `forceRTL(false)` at startup. The Expo config does not enable `supportsRTL`.</li><li>Web and backoffice render `<html dir="ltr">`.</li><li>On an Arabic/Hebrew device, the app shows Turkish (or English, if chosen) in LTR.</li><li>Pseudo-locale (+40% length) QA covers truncation (ADR-14).</li></ul> |
| UI communication | The language screen lists only "Türkçe" and "English". There are no "Yakında" entries (SREQ-92). |
| Affected | `app/settings/language`, all layouts |
| Verification | Jest: `I18nManager.isRTL === false` after init. |
| Master refs | M§39, M§100 |

#### KPL-30 · Platform secure-storage behaviours and runtime memory
| Field | Detail |
|---|---|
| Limitation | <ul><li>iOS Keychain items persist across uninstall/reinstall.</li><li>Some iOS releases rejected SecureStore values above ~2 KB (Supabase sessions are larger).</li><li>Android Auto Backup can copy app data unless excluded.</li><li>Hermes V1 with Reanimated reportedly raises Android memory by about 25–30%.</li></ul> |
| Evidence | [OFF] https://docs.expo.dev/versions/latest/sdk/securestore/ ; [SEC] stack-versions audit (Hermes V1 memory note from Sentry's SDK 57 issue) |
| Product behaviour | <ul><li>ADR-54: LargeSecureStore (AES key in SecureStore `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, ciphertext in MMKV).</li><li>A first-run flag outside the keychain purges stale sessions after reinstall.</li><li>Auto Backup excludes the SecureStore and MMKV files.</li><li>Memory is measured against the M§125 budget; the opt-out `expo.useHermesV1: false` is documented in MOBILE.md if the budget fails.</li></ul> |
| UI communication | None (a reinstall simply starts signed out). |
| Affected | Auth, offline cache |
| Verification | Jest: first-run purge, logout wipe. Manual: reinstall on iOS → signed out. |
| Master refs | M§87, M§125 |

### G. Links, attribution and development builds

#### KPL-31 · Deferred deep links and referral install attribution
| Field | Detail |
|---|---|
| Limitation | <ul><li>iOS provides no install referrer, so a code in the `/r/[code]` link cannot survive an App Store install.</li><li>Android offers the Play Install Referrer API (Play installs only).</li><li>Universal links do not open from some in-app browsers or from same-domain navigation.</li><li>Expo Go cannot run our native modules.</li></ul> |
| Evidence | [KNOW] https://developer.android.com/google/play/installreferrer ; [KNOW] https://developer.apple.com/documentation/xcode/supporting-universal-links-in-your-app ; [KNOW] https://docs.expo.dev/develop/development-builds/introduction/ |
| Product behaviour | <ul><li>Android: read the Install Referrer on first launch → MMKV `pending_referral_code` → auto-open M-REF-02 after sign-up (Part 4).</li><li>iOS: the `/r/[code]` web page shows the code with copy and store buttons, and M-REF-02 accepts a typed or pasted code (paste control, KPL-23).</li><li>Links try the universal link first, then the `dijitalasistan://` scheme.</li><li>Development uses dev-client builds (ADR-01), never Expo Go.</li></ul> |
| UI communication | Web `/r/[code]`: `limits.referral.ios_code_hint` "Uygulamayı yükledikten sonra kayıt olurken bu kodu gir: {code}" + `limits.referral.copy_code` "Kodu kopyala". |
| Affected | Web `/r/[code]`, M-REF-01/02, onboarding "Davet kodun var mı?" |
| Verification | Playwright: `/r/[code]` renders the code and store links. Jest: install-referrer → pending code. Manual: iOS fresh install + manual code. |
| Master refs | M§45, M§73 |

---

## 5. Register: providers

### H. Google

#### KPL-32 · Gmail restricted-scope verification (CASA), the 100-user cap and testing-mode tokens
| Field | Detail |
|---|---|
| Limitation | <ul><li>`gmail.readonly` (and even `gmail.metadata`) is a **restricted** scope. Server-side access needs an annual CASA security assessment by a Google-approved lab (weeks of lead time, paid).</li><li>Unverified apps show a warning and have a 100-new-user lifetime cap.</li><li>In "Testing" status, refresh tokens expire after 7 days and there is a 100-test-user cap.</li><li>Brand verification requires verified domains; `<ref>.supabase.co` cannot be verified by us.</li></ul> |
| Evidence | [OFF-S] https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification ; [OFF-S] https://support.google.com/cloud/answer/13464325 ; [OFF-S] https://support.google.com/cloud/answer/13465431 ; [OFF-S] https://developers.google.com/identity/protocols/oauth2#expiration ; [OFF] https://supabase.com/docs/guides/platform/custom-domains ; [SEC] https://deepstrike.io/blog/google-casa-security-assessment-2025 |
| Product behaviour | <ul><li>Least privilege (ADR-07): no `gmail.compose`/`gmail.modify`; `gmail.send` is progressive (sensitive, not restricted).</li><li>OAuth callbacks are served on the custom API domain (plan §19).</li><li>Until CASA passes, the app runs a closed programme of ≤100 Gmail users with publishing status "In production (unverified)", avoiding the 7-day Testing expiry (verify in console, §13).</li><li>The operator sets `GOOGLE_CASA_LOA_NOT_AFTER` (INTEGRATION_PLAN §15) once the CASA LOA exists and Google marks the scopes verified (INTEGRATION_PLAN §16 G8). While it is unset or in the past, `GET /me/bootstrap` returns `config.google_oauth_verified=false` (Proposed additions), which drives the onboarding note. No feature-flag key is used (R-10).</li><li>While unverified, the `health` probe for component `google_oauth` counts distinct users with a Google mail account connected and records `detail {gmail_users, cap: 100}`. Status is `degraded` at 80 and `down` at 95.</li><li>Outlook, device calendars and demo mode are unaffected (M§89).</li></ul> |
| UI communication | <ul><li>P3 on the Gmail explainer, only when `config.google_oauth_verified=false`: `limits.google.unverified_notice` "Google, doğrulama sürecimiz tamamlanana kadar "Google bu uygulamayı doğrulamadı" uyarısı gösterebilir."</li><li>OAuth callback error (including cap reached): `limits.google.connect_failed` "Google bağlantısı şu an tamamlanamadı. Biraz sonra tekrar dene."</li><li>Backoffice `/health`: cap card.</li></ul> |
| Affected | `app/(onboarding)/connect-mail`, `app/settings/accounts`; `oauth` function; `health`; backoffice `/health`, `/integrations` |
| Verification | Deno: `config.google_oauth_verified` follows `GOOGLE_CASA_LOA_NOT_AFTER`; `google_oauth` health thresholds (80 → `degraded`, 95 → `down`). **Manual external step:** CASA / LOA, brand verification, Search Console, custom domain. |
| Master refs | M§75, M§76, M§90, M§149 |

#### KPL-33 · Gmail push, history and quota constraints
| Field | Detail |
|---|---|
| Limitation | <ul><li>`watch` must be renewed at least every 7 days (daily is recommended).</li><li>Each watched user gets at most 1 notification/s; extras are **dropped**. Pub/Sub delivery is at-least-once (duplicates happen).</li><li>`historyId` is usually valid ≥1 week but sometimes only hours; 404 → full sync.</li><li>New projects: 6,000 quota units/min/user; `messages.get` costs 20 units, so at most 300 gets/min/user.</li></ul> |
| Evidence | [OFF-S] https://developers.google.com/workspace/gmail/api/guides/push ; [OFF] https://gmail.googleapis.com/$discovery/rest?version=v1 (history 404 quote) ; [OFF-S] https://developers.google.com/workspace/gmail/api/reference/quota ; [KNOW] https://cloud.google.com/pubsub/docs/subscription-overview |
| Product behaviour | <ul><li>ADR-07/INTEGRATION_PLAN: daily `watch_renewal` with jitter; `webhooks-google` verifies the OIDC token and enqueues; dedupe via `webhook_events (source, external_id)`.</li><li>The `reconciliation` job catches dropped notifications. 404 → bounded resync.</li><li>A per-user token bucket budgets ≤4,000 units/min.</li><li>First Analysis (72 h) fetches metadata first and paces `messages.get`. With heavy inboxes the counters keep running and the user may continue to Today while it finishes (C-17).</li></ul> |
| UI communication | <ul><li>Sync lag: design 08 `error/sync-delayed` "Senkronizasyon gecikti." / "Son başarılı analiz {time}. Yeniden deniyoruz; gösterilenler {n} dakika eski olabilir." / "Şimdi Dene" · "Tamam".</li><li>Long First Analysis (P3 after 45 s): `limits.onboarding.analysis_long` "Gelen kutun kalabalık; analiz birkaç dakika sürebilir. Hazır olunca haber veririm." + `limits.onboarding.go_today` "Bugün'e geç".</li></ul> |
| Affected | `app/(onboarding)/analysis`, Today; jobs `gmail_sync`, `watch_renewal`, `reconciliation`, `first_analysis`, `provider_webhook`; `provider_quota_usage` |
| Verification | Deno: duplicate Pub/Sub message → one job; 404 → resync; token bucket pacing. Vitest: quota budget maths. |
| Master refs | M§34, M§117 |

#### KPL-34 · Only Inbox and Sent are analysed (Gmail labels and Graph folders)
| Field | Detail |
|---|---|
| Limitation | <ul><li>Gmail `watch` filters by label, and the product watches `INBOX` + `SENT`.</li><li>Graph message delta works per folder only (`inbox`, `sentitems`).</li><li>Mail that skips the inbox (Gmail filters with "Skip the Inbox"; Outlook rules moving mail to custom folders) is not seen.</li></ul> |
| Evidence | [OFF] https://gmail.googleapis.com/$discovery/rest?version=v1 (`watch.labelIds`, `labelFilterBehavior`) ; [OFF] https://learn.microsoft.com/en-us/graph/delta-query-messages ("per folder") |
| Product behaviour | <ul><li>Watch/delta are scoped to Inbox + Sent (ADR-07).</li><li>Gmail category tabs (Promotions, Social) still carry `INBOX` and are included.</li><li>The limitation is stated where the user controls data sources.</li></ul> |
| UI communication | P7 on `app/settings/privacy/data-sources` per account: Gmail `limits.mail.folders_footnote_gmail` "Gelen Kutusu ve Gönderilenler analiz edilir. Filtreyle gelen kutusuna uğramadan arşivlenen mailler dahil edilmez." Outlook `limits.mail.folders_footnote_outlook` "Gelen Kutusu ve Gönderilmiş Öğeler analiz edilir. Kurallarla başka klasöre taşınan mailler dahil edilmez." |
| Affected | Data sources, Mail Intelligence counts, Follow-up (sent detection) |
| Verification | Deno: fixtures with a non-inbox message → not ingested. |
| Master refs | M§14, M§40, M§117 |

#### KPL-35 · Google token invalidation rules and granular consent
| Field | Detail |
|---|---|
| Limitation | <ul><li>Refresh tokens die after 6 months unused, on user revocation, on password change when Gmail scopes are granted, and when more than 100 refresh tokens exist per account per client (the oldest are silently invalidated).</li><li>Users can untick individual scopes on the consent screen (granular consent).</li></ul> |
| Evidence | [OFF-S] https://developers.google.com/identity/protocols/oauth2#expiration ; [OFF-S] https://developers.google.com/identity/protocols/oauth2/resources/granular-permissions |
| Product behaviour | <ul><li>`invalid_grant` → `connected_accounts.status='needs_reauth'`.</li><li>The granted `scope` string is parsed on every token response; a missing scope → `partial`, and the dependent capability is disabled server-side.</li><li>Re-consent is requested only when the user shows intent (ADR-07).</li><li>No per-device token proliferation: one integration grant per account, stored server-side.</li></ul> |
| UI communication | Design 08 `error/oauth-expired` "Gmail bağlantısı yenilenmeli." / "Google oturumu süresi doldu. Yeniden bağlanana kadar yeni mailler analiz edilmez." / "Yeniden Bağlan" · "Sonra". Partial: the feature card explains the missing permission (INTEGRATION_PLAN copy). |
| Affected | Today, `app/settings/accounts/[id]`, M-REPLY-02 |
| Verification | Deno: `invalid_grant` mapping; partial-scope parsing. |
| Master refs | M§76, M§117 |

#### KPL-36 · Google Calendar push channels and sync tokens
| Field | Detail |
|---|---|
| Limitation | <ul><li>Channels expire (default TTL 7 days), do not auto-renew and carry no payload.</li><li>`syncToken` cannot be combined with `timeMin`/`timeMax`/`q` and others; 410 → wipe and full resync.</li><li>New-project quotas: 600 requests/min/user and 10,000/min/project.</li></ul> |
| Evidence | [OFF-S] https://developers.google.com/workspace/calendar/api/guides/push ; [OFF-S] https://developers.google.com/workspace/calendar/api/guides/sync ; [OFF] https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest ; [SEC] https://developers.google.com/workspace/calendar/api/guides/quota |
| Product behaviour | <ul><li>`events.watch` per calendar with an HMAC channel token; renewal 24 h before expiry (`watch_renewal`); every notification triggers an incremental `calendar_sync`; 410 → full resync.</li><li>The synchronised window follows INTEGRATION_PLAN. Dates outside any provider's synchronised window are marked in Plan.</li></ul> |
| UI communication | Plan day/week outside the window: `limits.calendar.outside_window` "Bu tarih eşitleme aralığının dışında; etkinlikler yaklaştıkça görünür." |
| Affected | `app/(tabs)/plan/index`; jobs `calendar_sync`, `watch_renewal` |
| Verification | Deno: 410 path; channel renewal scheduling. Jest: outside-window note. |
| Master refs | M§19, M§117 |

#### KPL-37 · Calendar write side effects: Google `sendUpdates` and Graph automatic meeting mail
| Field | Detail |
|---|---|
| Limitation | <ul><li>Google `events.insert`/`patch` accept `sendUpdates=all|externalOnly|none`. Google warns that `none` "can have significant adverse effects": guests keep stale times.</li><li>Graph sends invitations and updates automatically when an organiser creates or changes a meeting with attendees; there is no per-request switch.</li></ul> |
| Evidence | [OFF] https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest (`sendUpdates` values and warning) ; [KNOW] https://learn.microsoft.com/en-us/graph/api/event-update ; secondary-docs SREQ-20 |
| Product behaviour | <ul><li>`calendar_create` with "Davet gönder" on → `sendUpdates=all` (Google) / attendees included (Graph). Off → the event is created **without attendees** on both providers (Part 2).</li><li>`calendar_update` of an event with other attendees → `sendUpdates=all` always (Google), inherent on Graph. `none` and `externalOnly` are never offered for events with guests.</li><li>Side effects are computed server-side into `approval_actions.side_effects`.</li></ul> |
| UI communication | Approval side-effect line: create "{n} katılımcıya davet gider" (Part 2); update `limits.calendar.update_side_effect` "Katılımcılara güncelleme gönderilir". |
| Affected | M-APPR-03/04/05, `app/plan/conflict/[id]`, `app/plan/proposal/[id]` |
| Verification | Deno: the executor passes `sendUpdates=all` for updates with attendees; the side-effect list matches. |
| Master refs | M§19, M§33, M§115 |

#### KPL-38 · Google Tasks: date-only due dates and no push
| Field | Detail |
|---|---|
| Limitation | <ul><li>`Task.due`: "Only date information is recorded… It isn't possible to read or write the time".</li><li>No watch/push and no sync token.</li><li>`maxResults` ≤100.</li></ul> |
| Evidence | [OFF] https://tasks.googleapis.com/$discovery/rest?version=v1 |
| Product behaviour | <ul><li>`tasks_sync` polls every 15 min plus on app foreground (`updatedMin = last_sync − 60 s`, `showDeleted`, `showHidden`).</li><li>For Google Tasks destinations the time input is hidden. Any time-of-day reminder stays on our side as a device-local reminder (M-REM-01).</li><li>Created tasks carry the in-app deep link and the `DA-{approvalId}` marker for idempotency (plan §7).</li></ul> |
| UI communication | Existing copy (Part 2): "Google Görevler yalnızca tarih saklar" (M-APPR-05) and "Yalnızca tarih saklanır; saat bildirimini Google göstermez" (M-REM-03). P7 on data sources: `limits.tasks.poll_footnote` "Google Görevler ve Microsoft To Do yaklaşık 15 dakikada bir ve uygulamayı açtığında güncellenir." |
| Affected | M-REM-03, M-APPR-05, data sources; job `tasks_sync` |
| Verification | Vitest: `resolvePreset` date-only anchors. Deno: time stripped for Google Tasks payloads. |
| Master refs | M§29, M§75, M§117 |

### I. Microsoft

#### KPL-39 · Graph change notifications and throttling
| Field | Detail |
|---|---|
| Limitation | <ul><li>Subscription lifetimes: message/event ≤10,080 min (<7 days); `todoTask` ≤4,230 min (<3 days).</li><li>Validation must answer within 10 s; delivery needs a 2xx within 3 s.</li><li>Slow endpoints are delayed, and "drop" status loses notifications for 10 minutes.</li><li>Lifecycle events: `reauthorizationRequired`, `subscriptionRemoved`, `missed`.</li><li>Latency: messages <1 min average (max 3 min); todoTask <2 min (max 15 min).</li><li>Limits: 1,000 active Outlook subscriptions per mailbox; 10,000 requests/10 min and 4 concurrent requests per app per mailbox; JSON batches ≤20.</li></ul> |
| Evidence | [OFF] https://learn.microsoft.com/en-us/graph/api/resources/subscription ; [OFF] https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks ; [OFF] https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events ; [OFF] https://learn.microsoft.com/en-us/graph/throttling-limits |
| Product behaviour | <ul><li>`webhooks-microsoft` stays tiny: validation echo, constant-time `clientState` check, enqueue, `202`.</li><li>Renewal below 48 h remaining; reauthorize and PATCH never within 10 min of each other.</li><li>`missed`/`subscriptionRemoved` → delta resync (`reconciliation`).</li><li>Per-mailbox limiter: 4 concurrent, about 8,000 requests/10 min; `Retry-After` honoured.</li></ul> |
| UI communication | Sync lag uses the design 08 `error/sync-delayed` card (KPL-33). |
| Affected | Jobs `outlook_sync`, `calendar_sync`, `watch_renewal`, `reconciliation`, `provider_webhook`; backoffice `/integrations`, `/jobs` |
| Verification | Deno: validation echo <10 s path, `clientState` mismatch → 401, lifecycle handling, limiter. |
| Master refs | M§117 |

#### KPL-40 · Graph calendar delta uses a fixed window
| Field | Detail |
|---|---|
| Limitation | <ul><li>v1.0 event delta works only on `calendarView` with `startDateTime`/`endDateTime` encoded in the token.</li><li>`$select` is not supported; unbounded delta is beta-only.</li><li>An expired token returns `syncStateNotFound` or `410 Gone`.</li></ul> |
| Evidence | [OFF] https://learn.microsoft.com/en-us/graph/delta-query-events ; [OFF] https://learn.microsoft.com/en-us/graph/delta-query-overview |
| Product behaviour | <ul><li>A rolling window (INTEGRATION_PLAN; audit default [today − 2 d, today + 60 d]) is re-baselined daily at about 03:00 user-local time (ADR-28).</li><li>Events that leave the window stay stored (subject to retention), so the weekly review and Person pages keep past meetings.</li><li>Dates beyond the window show the KPL-36 outside-window note.</li></ul> |
| UI communication | `limits.calendar.outside_window` (KPL-36). |
| Affected | Plan week pager, Meeting Prep for far-future events |
| Verification | Deno: re-baseline job; 410 → full window resync. |
| Master refs | M§19, M§117 |

#### KPL-41 · Microsoft To Do: short subscriptions and high latency
| Field | Detail |
|---|---|
| Limitation | `todoTask` subscriptions last <3 days (global endpoint only), with latency up to 15 min. |
| Evidence | [OFF] https://learn.microsoft.com/en-us/graph/api/resources/subscription |
| Product behaviour | No To Do subscription. `tasks_sync` polls `/me/todo/lists/{id}/tasks/delta` every 15 min plus on foreground (ADR-07), which gives the same freshness without renewal churn. |
| UI communication | `limits.tasks.poll_footnote` (KPL-38). |
| Affected | Data sources, reminders/tasks destinations |
| Verification | Deno: delta-link persistence per list. |
| Master refs | M§117 |

#### KPL-42 · Microsoft has no per-app token revocation
| Field | Detail |
|---|---|
| Limitation | <ul><li>There is no RFC 7009 per-app revoke for delegated consent.</li><li>`revokeSignInSessions` kills **all** of the user's sessions across all apps.</li><li>Removing the `oauth2PermissionGrant` needs admin-level permissions.</li></ul> |
| Evidence | [OFF] integrations audit §B "Revocation" (Graph docs) ; consent pages https://account.live.com/consent/Manage and https://myapps.microsoft.com (**verify**, §13) |
| Product behaviour | Disconnect or account deletion: `DELETE /subscriptions/{id}` for each subscription → delete ciphertext and cursors → purge per SECURITY_AND_PRIVACY_PLAN → audit with `revocation_mode='local_only'`. The user is told how to remove the grant on Microsoft's side. We never fake "revoked at Microsoft" (M§41, M§129). |
| UI communication | After disconnect (P3 + P8): personal `limits.ms.disconnect_done_personal` "Bağlantı kaldırıldı. Microsoft tarafındaki uygulama iznini de kaldırmak için account.live.com/consent/Manage adresini aç."; work `limits.ms.disconnect_done_work` "Bağlantı kaldırıldı. Microsoft tarafındaki uygulama iznini de kaldırmak için myapps.microsoft.com adresini aç."; CTA `limits.ms.open_permissions` "Microsoft izinlerini aç". The account-deletion consequences list includes the same line. |
| Affected | `app/settings/accounts/[id]`, `app/settings/privacy/delete-account`; `POST /integrations/:accountId/disconnect`; job `account_deletion` |
| Verification | Deno: the disconnect path writes `local_only` to the audit; no Graph revoke call exists. |
| Master refs | M§41, M§76, M§129 |

#### KPL-43 · Work tenants can block consent; publisher verification
| Field | Detail |
|---|---|
| Limitation | <ul><li>Tenant admins can restrict user consent (e.g. to verified publishers). With risk-based step-up, users cannot consent to unverified multitenant apps requesting more than basic scopes.</li><li>Publisher verification needs a Partner One ID.</li></ul> |
| Evidence | [OFF] https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview ; [OFF] https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent |
| Product behaviour | <ul><li>AADSTS consent-required / admin-approval errors (exact codes verified during implementation, §13) → `connected_accounts.status='admin_consent_required'`.</li><li>The app offers to share the tenant admin-consent URL (`https://login.microsoftonline.com/{tenant}/adminconsent?client_id={id}`).</li><li>Delegated permissions only; application permissions are never used.</li></ul> |
| UI communication | P5 on `app/settings/accounts/[id]` and in onboarding: `limits.ms.admin_consent_title` "Kurum yöneticinin onayı gerekiyor." / `limits.ms.admin_consent_body` "İş hesabın, uygulamaların mail ve takvime erişmesi için BT yöneticisinin onayını istiyor. Onay bağlantısını yöneticinle paylaşabilirsin." / CTA `limits.ms.admin_consent_share` "Bağlantıyı Paylaş" (native share). |
| Affected | `app/(onboarding)/connect-mail`, `app/settings/accounts/[id]`, `oauth` |
| Verification | Deno: error mapping fixtures. **Manual external step:** publisher verification. |
| Master refs | M§75, M§76 |

#### KPL-44 · Graph send semantics, attachment size and refresh-token lifetime
| Field | Detail |
|---|---|
| Limitation | <ul><li>`sendMail` and `reply` return `202 Accepted` with no message ID.</li><li>Attachments over ~3 MB need an upload session on a draft, which requires `Mail.ReadWrite`; we request only `Mail.Send`.</li><li>Refresh tokens expire after 90 days of inactivity and rotate on each use.</li><li>Gmail limits attachments to 25 MB total per message; the API upload cap is 35 MB.</li></ul> |
| Evidence | [OFF] https://learn.microsoft.com/en-us/graph/api/user-sendmail ; [KNOW] https://learn.microsoft.com/en-us/graph/outlook-large-attachments ; [OFF] https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens ; [KNOW] https://support.google.com/mail/answer/6584 ; [OFF] Gmail Discovery (`messages.send` maxSize 35 MB) |
| Product behaviour | <ul><li>Graph: `executed` is recorded on 202; idempotency via extended property + Sent Items check before retry (plan §7). The Sent Items copy appears after the next delta, and later bounces arrive as ordinary inbound mail.</li><li>Reply attachments are capped per provider in `packages/domain` (`REPLY_ATTACHMENT_LIMIT_BYTES`: google 25 MB, microsoft 3 MB); the server rejects over-limit drafts with `attachment_too_large` (the SCREEN_AND_FLOW_MAP Part 2 §0.5 failure code).</li><li>New refresh tokens are persisted on every refresh; `invalid_grant` → `needs_reauth`.</li></ul> |
| UI communication | <ul><li>M-REPLY-01 attachment row P3: `limits.mail.attachment_limit_outlook` "Outlook yanıtlarında eklerin toplamı en fazla 3 MB olabilir." / `limits.mail.attachment_limit_gmail` "Gmail yanıtlarında eklerin toplamı en fazla 25 MB olabilir."</li><li>Expired session: "Outlook bağlantısı yenilenmeli." / "Microsoft oturumu süresi doldu. Yeniden bağlanana kadar yeni mailler analiz edilmez." (integrations audit, design 08 pattern).</li></ul> |
| Affected | M-REPLY-01, M-APPR-04; `POST /reply-drafts/:id/submit`; job `approval_execute` |
| Verification | Deno: limit enforcement per provider; 202 path; retry idempotency. |
| Master refs | M§16, M§33, M§115 |

### J. Calendar semantics across providers

#### KPL-45 · Only the organiser (or a guest with modify rights) can move a meeting
| Field | Detail |
|---|---|
| Limitation | <ul><li>Google: attendees can modify an event only when `guestsCanModify` is true (default false); `organizer.self` identifies the organiser.</li><li>Graph: attendees cannot move meetings (`isOrganizer`). Graph lets an attendee propose a new time only while also responding tentative or declined (`proposedNewTime`); Google has no API equivalent.</li></ul> |
| Evidence | [KNOW] https://developers.google.com/workspace/calendar/api/v3/reference/events (`guestsCanModify`, `organizer.self`) ; [KNOW] https://learn.microsoft.com/en-us/graph/api/resources/event (`isOrganizer`) ; [KNOW] https://learn.microsoft.com/en-us/graph/api/event-tentativelyaccept ; secondary-docs SREQ-20 |
| Product behaviour | <ul><li>`calendar_events.can_modify` (DATABASE_AND_RLS_PLAN, next to `organizer_self`) = Google `organizer.self OR guestsCanModify`; Graph `isOrganizer`; device events: true.</li><li>`POST /plan/conflicts/:insightId/options` never returns "move" options for events with `can_modify=false`.</li><li>For those, it returns "propose a new time", which creates a reply draft to the organiser through the normal AI Reply → `email_send` approval path (the same flow on both providers). Graph `proposedNewTime` is **not** used, because it forces an RSVP change.</li><li>The executor re-checks `can_modify` before `calendar_update` and fails with `not_organizer` if it changed.</li></ul> |
| UI communication | Options sheet: the move option is shown disabled (P2) with meta `limits.calendar.not_organizer_meta` "Düzenleyen sen değilsin"; the offered option is `limits.calendar.propose_new_time` "Düzenleyene yeni saat öner". |
| Affected | `app/plan/conflict/[id]`, `app/event/[id]`, M-APPR-05 |
| Verification | Vitest: `canModify` truth table. Deno: options exclude move for non-organisers; the executor guard. |
| Master refs | M§19, M§20, M§33, M§115 |

#### KPL-46 · Attendee availability is known only through real free/busy APIs
| Field | Detail |
|---|---|
| Limitation | <ul><li>Other people's availability is visible only through free/busy APIs, and only where they share it: Google `freebusy.query` for other people's calendars (needs `calendar.events.freebusy` or a broader scope, which the initial read scopes do not include; §13 item 7); Graph `getSchedule` (works with `Calendars.Read`; typically only within the organisation).</li><li>External attendees usually return nothing.</li></ul> |
| Evidence | [OFF] Calendar Discovery document (lists `calendar.freebusy`, `calendar.events.freebusy` scopes) ; [KNOW] https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query ; [KNOW] https://learn.microsoft.com/en-us/graph/api/calendar-getschedule ; M§20 |
| Product behaviour | <ul><li>Slot suggestions use the user's own calendars (`GET /plan/free-slots`).</li><li>Attendee availability is fetched only when the user opens conflict or reschedule options that involve attendees:<ul><li>Graph via `getSchedule`;</li><li>Google via `freebusy.query` for the attendees' calendars, only when `connected_accounts.granted_scopes` contains `https://www.googleapis.com/auth/calendar.events.freebusy`. That scope is requested progressively through `POST /integrations/:accountId/upgrade` under the existing `calendar_read` capability. The spine `capability` enum is binding, so no new value is added.</li></ul></li><li>API-PLAN-03 (`POST /plan/conflicts/:insightId/options`) returns `feasibility.attendee_availability` = `free` or `busy` only when every attendee returned real free/busy data; otherwise it returns `unknown`. Availability is never inferred.</li></ul> |
| UI communication | In the options sheet (P3): `feasibility.attendee_availability='unknown'` → `limits.calendar.availability_unknown` "Katılımcıların müsaitliği tam görünmüyor; öneriler yalnızca görebildiğim takvimlere göre."; a Google account whose `granted_scopes` lacks `calendar.events.freebusy` → `limits.calendar.availability_scope` "Katılımcıların müsaitliğine bakmak için Google Takvim'den ek izin gerekiyor." + "İzin Ver" (M-REPLY-02 upgrade sheet pattern). |
| Affected | `app/plan/conflict/[id]`, `app/plan/proposal/[id]`; `POST /plan/conflicts/:insightId/options` |
| Verification | Deno: `feasibility.attendee_availability` is `unknown` whenever any attendee has no real free/busy data; Google attendee `freebusy.query` is never called unless `granted_scopes` holds `calendar.events.freebusy`; the upgrade URL requests only that missing scope; no inference. |
| Master refs | M§20, M§76 |

#### KPL-47 · Travel time and "leave by" times exist only if a source provides them
| Field | Detail |
|---|---|
| Limitation | <ul><li>Google Calendar and Graph events have no travel-time field, and EventKit exposes none publicly.</li><li>No routing or maps API is in scope, and the user's home location is not collected.</li></ul> |
| Evidence | [KNOW] Google Events resource and Graph event resource field lists (URLs as in KPL-45) ; M§20 ("Seyahat süresi kaynakta yoksa uydurma") ; design-onboarding-today audit (the "06:45'te evden çıkman gerekebilir" copy is prototype-only) |
| Product behaviour | <ul><li>Back-to-back and conflict detection use event times only.</li><li>A location is shown only when the source has one.</li><li>A "leave by", check-in or arrival recommendation is shown only when quoted from a source (e.g. an airline mail), with provenance.</li><li>If two consecutive events have different non-empty physical locations, the factual gap is shown with no estimate.</li></ul> |
| UI communication | `limits.calendar.locations_differ` "Konumlar farklı · arada {minutes} dk var". Nothing else; unknown values are omitted, not estimated. |
| Affected | Plan, Calendar Intelligence, Meeting Prep, Life (flight) |
| Verification | Vitest: calendar-intelligence fixtures produce no duration fields without source spans. Grounding verifier rejects un-sourced times (plan §8). |
| Master refs | M§20, M§83 |

#### KPL-48 · No carrier, airline or bank APIs
| Field | Detail |
|---|---|
| Limitation | No shipment, flight or payment provider API is integrated. Status comes only from mail, captures or Android NI signals, and can be outdated. |
| Evidence | M§23 ("Amount veya deadline yalnızca kaynak açıkça söylüyorsa göster") ; secondary-docs SREQ-25 |
| Product behaviour | <ul><li>Life cards show the latest status found in a source, with its timestamp.</li><li>Tracking links are shown only if present in the source and on a validated domain; otherwise the source is opened.</li><li>Status is never extrapolated.</li></ul> |
| UI communication | `limits.life.status_source` "Durum, kaynaktaki son bilgiye göre: {source} · {time}". Ungrounded amounts/deadlines: "Kaynakta kesinleşmiyor." (plan §8). |
| Affected | `app/life/[id]`, Flow life cards, briefings "Kişisel Gelişmeler" |
| Verification | Vitest: the life-intel parser never outputs status without an evidence span. |
| Master refs | M§23, M§83 |

### K. Apple identity

#### KPL-49 · Sign in with Apple constraints
| Field | Detail |
|---|---|
| Limitation | <ul><li>The full name is delivered only on the first authorisation.</li><li>The authorisation code is single-use and valid 5 minutes; revocation needs a token.</li><li>Mail to `@privaterelay.appleid.com` is forwarded only from domains registered with Apple.</li><li>Android needs the web OAuth flow, whose client secret must be regenerated every 6 months.</li><li>App Store Guideline 4.8 requires SIWA when third-party login is offered.</li></ul> |
| Evidence | [OFF] https://supabase.com/docs/guides/auth/social-login/auth-apple ; [OFF] https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens ; [OFF] https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens ; [OFF] https://developer.apple.com/app-store/review/guidelines/#login-services |
| Product behaviour | <ul><li>ADR-06: the name is saved on first sign-in via `updateUser`.</li><li>`POST /auth/apple/exchange` runs within 5 min to store the Apple refresh token encrypted; revoked at account deletion.</li><li>If no token is stored, deletion asks for a fresh Apple sign-in.</li><li>Android "Apple ile devam et" uses web OAuth, with the client secret rotated by the `rotate-siwa-secret` workflow (ARCHITECTURE_DECISIONS proposal).</li></ul> |
| UI communication | No limitation copy. Profile shows the relay email as-is. |
| Affected | `app/(auth)/sign-in`, `app/settings/privacy/delete-account` |
| Verification | Deno: exchange + revoke with mocked Apple endpoints. **Manual external steps:** SIWA key, Services ID, private-relay domain registration. |
| Master refs | M§88, M§129 |

---

## 6. Register: stores and subscriptions

#### KPL-50 · Free-trial availability and eligibility are store-defined
| Field | Detail |
|---|---|
| Limitation | <ul><li>A trial exists only if configured as an introductory or free-trial offer in App Store Connect or Play Console.</li><li>iOS eligibility is per subscription group per Apple ID (queried through RevenueCat `checkTrialOrIntroductoryPriceEligibility`).</li><li>On Play, `subscriptionOptions` contain only offers the user is eligible for.</li><li>Store trials require a store account with a payment method.</li></ul> |
| Evidence | [KNOW] https://developer.apple.com/documentation/storekit/product/subscriptioninfo/iseligibleforintrooffer ; [KNOW] https://developer.android.com/google/play/billing/subscriptions ; [KNOW] https://www.revenuecat.com/docs/subscription-guidance/subscription-offers/ios-subscription-offers ; secondary-docs C-09, C-27 |
| Product behaviour | <ul><li>M-PAY-01 and M-GATE-01/02 render trial CTAs ("Ücretsiz Dene · {n} gün") only when eligible; otherwise "Pro'yu Gör" (gates) / "Pro'ya Geç" (paywall).</li><li>Prices come from `priceString` and are never hard-coded (lint on the `TL` literal).</li><li>The "24 saat önce hatırlatırız" promise appears only when the reminder is guaranteed (Part 4).</li><li>Web `/pricing` shows store prices as "mağaza fiyatı" with a note and makes no trial promise.</li></ul> |
| UI communication | Web `/pricing` P7: `limits.store.trial_web_note` "Ücretsiz deneme, mağazada sunulduğunda ve hesabın uygun olduğunda gösterilir." "Kredi kartı gerekmez" is banned (§1.3). |
| Affected | M-PAY-01, M-GATE-01/02, web `/pricing`, `/` Pricing section, store screenshots |
| Verification | Unit tests for `paywallCopy.ts` (Part 4). Playwright: `/pricing` has no hard-coded trial claim. **Manual external step:** configure intro offers per store if a trial is wanted. |
| Master refs | M§43, M§74, M§141 |

#### KPL-51 · Subscriptions are managed only in the purchasing store; deleting the account does not cancel billing
| Field | Detail |
|---|---|
| Limitation | <ul><li>Apps cannot cancel or change a store subscription programmatically.</li><li>A subscription bought on iOS can only be managed with that Apple ID, and a Play one only in Play.</li><li>Apple requires telling users that billing continues after account deletion and how to cancel.</li></ul> |
| Evidence | [OFF] https://developer.apple.com/support/offering-account-deletion-in-your-app/ ; [KNOW] https://www.revenuecat.com/docs/customers/customer-info (`managementURL`) |
| Product behaviour | <ul><li>M-SUB-01 opens `Purchases.showManageSubscriptions()` or `managementURL` for the store matching the current platform.</li><li>For the other store (the entitlement mirror's `store` differs from the platform), text instructions are shown instead of a broken link.</li><li>The deletion flow shows the billing warning before confirmation, and deletes the RevenueCat customer (plan §13), not the store subscription.</li></ul> |
| UI communication | <ul><li>M-SUB-01 P7: `limits.store.manage_store` "Aboneliğin {store} üzerinden. Planını değiştirmek veya iptal etmek için {store} ayarlarını kullan."</li><li>Other store: `limits.store.manage_other_store` "Aboneliğin {store} üzerinden alındı; bu cihazdan yönetilemez. Aboneliği aldığın cihazda {store} ayarlarını kullan."</li><li>Deletion P5 warning: `limits.store.deletion_subscription_warning` "Hesabını silmek {store} aboneliğini iptal etmez. Ücretlendirilmemek için önce aboneliğini iptal et."</li></ul> |
| Affected | `app/settings/subscription` (M-SUB-01), `app/settings/privacy/delete-account`, web `/data-deletion` |
| Verification | Jest: store-mismatch branch. Maestro: the deletion flow shows the warning for a Pro test user. |
| Master refs | M§43, M§129 |

#### KPL-52 · RevenueCat webhooks are unordered and at-least-once; the server entitlement lags the client
| Field | Detail |
|---|---|
| Limitation | <ul><li>Webhooks must be answered within 60 s. Retries happen up to 5 times at 5/10/20/40/80 min.</li><li>Delivery is at-least-once and **unordered**; `TRANSFER` carries no `app_user_id`.</li><li>REST v2 is rate-limited (about 60 requests/min).</li><li>The client SDK sees purchases before our server does.</li></ul> |
| Evidence | [OFF-S] https://www.revenuecat.com/docs/integrations/webhooks ; [OFF-S] https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields ; [OFF-S] https://www.revenuecat.com/docs/api-v2 |
| Product behaviour | <ul><li>ADR-11: `webhooks-revenuecat` → `billing_events` (unique `event_id`) → `billing_sync` re-fetches the customer and overwrites `subscriptions`. Events are never applied incrementally.</li><li>`TRANSFER` recomputes both sides.</li><li>`SANDBOX` events are ignored in production unless the user is allow-listed.</li><li>After purchase, the client calls `POST /purchases/sync` and polls `GET /me/entitlements`.</li><li>Server gates use `effective_entitlement()` only.</li></ul> |
| UI communication | Existing Part 4 copy: "Pro etkinleştiriliyor…" while the store succeeded but the server has not confirmed. |
| Affected | M-PAY-01, M-SUB-01; jobs `billing_sync`; backoffice `/subscriptions` |
| Verification | Deno: duplicate `event_id`, out-of-order `CANCELLATION` before `INITIAL_PURCHASE`, `TRANSFER`, `SANDBOX` (ADR-11). |
| Master refs | M§43, M§44 |

#### KPL-53 · Purchases can be pending or blocked by the device owner
| Field | Detail |
|---|---|
| Limitation | Purchases can be deferred (Ask to Buy, Play pending payment methods) or disallowed (Screen Time or parental restrictions). The app cannot override either. |
| Evidence | [KNOW] https://www.revenuecat.com/docs/test-and-launch/errors |
| Product behaviour | <ul><li>`PAYMENT_PENDING_ERROR` → wait for the `CustomerInfo` listener.</li><li>`PURCHASE_NOT_ALLOWED_ERROR` → inform only.</li><li>Pro is never granted client-side ahead of the store.</li></ul> |
| UI communication | Part 4 copy: "Satın alma onay bekliyor. Onaylandığında Pro otomatik açılır." / "Bu cihazda satın alma kısıtlı." |
| Affected | M-PAY-01 |
| Verification | Jest: error-code mapping. Test Store scenarios (RevenueCat Test Store). |
| Master refs | M§43 |

#### KPL-54 · Store policy constraints that shape features
| Field | Detail |
|---|---|
| Limitation | <ul><li>**Apple 3.1.1:** unlocking features outside IAP (referral grants) is a review risk.</li><li>**3.1.2:** the paywall must show terms/privacy links and renewal terms.</li><li>**4.8:** SIWA is required (KPL-49).</li><li>**5.1.1(v):** in-app account deletion is required.</li><li>**2.3:** metadata must be accurate (no Android NI on iOS).</li><li>`SKStoreReviewController` prompts are limited (3 per 365 days) and may show nothing.</li><li>**Google Play:** prominent disclosure + Data safety for notification access; an account-deletion web resource; restricted permissions (`QUERY_ALL_PACKAGES`, `USE_EXACT_ALARM`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`); foreground-service type declarations; the yearly target-API requirement.</li></ul> |
| Evidence | [OFF] https://developer.apple.com/app-store/review/guidelines/ ; [KNOW] https://developer.apple.com/documentation/storekit/requesting-app-store-reviews ; [SEC/verify] https://support.google.com/googleplay/android-developer/answer/10144311 ; [KNOW] https://support.google.com/googleplay/android-developer/answer/13327111 ; [KNOW] https://developer.android.com/google/play/requirements/target-sdk |
| Product behaviour | <ul><li>Referral grants live in `entitlement_grants` (ADR-11); the review note in STORE_CHECKLIST explains them as a promotional extension tied to real usage.</li><li>The paywall satisfies 3.1.2 (M-PAY-01 legal links).</li><li>Deletion is in-app plus web `/data-deletion`.</li><li>The NI prominent disclosure is M-ANI-02.</li><li>`<queries>` MAIN/LAUNCHER is used instead of `QUERY_ALL_PACKAGES`.</li><li>`requestReview()` is never tied to UI state or promised.</li><li>`targetSdk` 36 is verified against the current Play rule at submission.</li></ul> |
| UI communication | No limitation copy (compliance is built into the screens). |
| Affected | STORE_CHECKLIST, M-PAY-01, M-REF-01, M-ANI-02, `/data-deletion` |
| Verification | STORE_CHECKLIST review, a manifest permission audit in CI, and **Manual external steps** (Data safety form, FGS declaration). |
| Master refs | M§43, M§45, M§112, M§129 |

---

## 7. Register: backend and AI vendors

#### KPL-55 · Supabase Edge Function limits
| Field | Detail |
|---|---|
| Limitation | <ul><li>**2 s CPU per request** (async I/O not counted); wall clock 150 s on Free and 400 s on paid; 256 MB memory.</li><li>No Web Workers, no Node `vm`, no multithreaded native libraries (e.g. `sharp`).</li><li>Outbound SMTP ports 25/587 are blocked.</li><li>Bundle size 20 MB (CLI) or 5 MB (server-side); ≤100 secrets of ≤48 KiB each, with no `SUPABASE_` prefix.</li><li>`EdgeRuntime.waitUntil` does not extend the limits.</li></ul> |
| Evidence | [OFF] https://supabase.com/docs/guides/functions/limits ; [OFF] https://supabase.com/docs/guides/functions/background-tasks |
| Product behaviour | <ul><li>Webhook functions only verify and enqueue.</li><li>`worker` stops claiming jobs when the remaining wall time is under 60 s and keeps each job CPU-light.</li><li>Image downsampling happens on the device before upload (`expo-image-manipulator`); there is no server image processing.</li><li>PDF text extraction is measured against the CPU limit (ai-research §9.4). The fallback sends the PDF to the model as a document block.</li><li>Mail HTML sanitising is size-capped (plan §8 token hygiene).</li><li>Transactional mail from functions uses an HTTPS email API, never SMTP.</li><li>A job that still fails after retries ends as `failed`/`dead_letter` with an honest UI state.</li></ul> |
| UI communication | <ul><li>Capture analysis failure: `limits.capture.too_heavy` "Bu dosyayı şu an analiz edemedim. Daha küçük bir dosya ya da ekran görüntüsüyle tekrar dene."</li><li>AI down: design 08 `error/ai-unavailable` "Asistan şu an yanıt veremiyor." / "Brifingin ve önceliklerin hazır; yalnızca yeni soru ve taslaklar birkaç dakika bekleyebilir."</li></ul> |
| Affected | All Edge Functions; M-CAP-05/06; backoffice `/jobs`, `/health` |
| Verification | Deno: the worker time-budget stop; CPU profiling of the PDF path in CI with a fixture corpus. |
| Master refs | M§84, M§85, M§127 |

#### KPL-56 · pg_cron concurrency and scheduling granularity
| Field | Detail |
|---|---|
| Limitation | At most 8 concurrent cron jobs, each at most 10 minutes; schedules run in UTC; granularity is 1 minute (sub-minute syntax only on newer Postgres builds). |
| Evidence | [OFF] https://supabase.com/docs/guides/cron |
| Product behaviour | <ul><li>Eight `da_*` cron entries, exactly at the limit (DATABASE_AND_RLS_PLAN §9): `da_scheduler_tick` every minute, `da_worker_poke` every 15 s, and six short enqueue or housekeeping entries (push receipts, health, reconciliation, retention, billing reconcile, cron housekeeping), each finishing in under 1 s.</li><li>Local-time scheduling is evaluated in SQL (DST-safe).</li><li>Briefing generation starts 20 min early, so briefings are ready at the configured minute; pushes can lag by up to about 1 minute plus the worker latency.</li><li>Exact-minute user reminders are device-local, not server-scheduled (ADR-10).</li></ul> |
| UI communication | None. |
| Affected | Briefings, meeting prep, nudges; backoffice `/jobs` |
| Verification | pgTAP: cron entry count ≤8; `scheduler_tick(p_now)` DST fixtures (ADR-28). |
| Master refs | M§96, M§127 |

#### KPL-57 · Supabase Auth, Storage and domain constraints
| Field | Detail |
|---|---|
| Limitation | <ul><li>The built-in SMTP delivers only to team members and is heavily rate-limited; custom SMTP starts at 30 emails/hour.</li><li>Session time-box and inactivity settings are project-wide (Pro).</li><li>Signed URLs cannot be revoked except through support.</li><li>The custom domain is a paid add-on: one per project, CNAME only.</li><li>Legacy `anon`/`service_role` keys are deprecated by the end of 2026.</li></ul> |
| Evidence | [OFF] https://supabase.com/docs/guides/auth/auth-smtp ; [OFF] https://supabase.com/docs/guides/auth/sessions ; [OFF] https://supabase.com/docs/guides/storage/security/access-control ; [OFF] https://supabase.com/docs/guides/platform/custom-domains ; [OFF] https://supabase.com/docs/guides/getting-started/api-keys |
| Product behaviour | <ul><li>Custom SMTP with SPF/DKIM/DMARC, with the rate raised before launch (**Manual external step**).</li><li>Admin idle and absolute timeouts are app-level (ADR-06).</li><li>Signed URLs last 60–300 s (exports 24 h) and are never cached in widgets or notifications.</li><li>Custom API domain for OAuth callbacks.</li><li>Only publishable and secret keys are used.</li></ul> |
| UI communication | OTP rate limit reached: the sign-in screen error (owned by SCREEN_AND_FLOW_MAP Part 1). |
| Affected | Email OTP sign-in, `/data-deletion`, exports, backoffice sessions |
| Verification | Deno: signed-URL expiry values. Config check in `health`. |
| Master refs | M§88, M§128, M§152 |

#### KPL-58 · AI vendor residency, retention and model lifecycle
| Field | Detail |
|---|---|
| Limitation | <ul><li>Anthropic offers only `us`/`global` inference geography, with no EU option. OpenAI and Voyage are US-based.</li><li>Message Batches results are stored 29 days unless deleted and are not eligible for zero data retention.</li><li>Fable 5.1 (a Covered Model) requires 30-day retention.</li><li>Haiku 4.5 retires no earlier than 2026-10-15.</li><li>Voyage embeddings cannot be swapped in hot without re-embedding.</li></ul> |
| Evidence | [OFF] https://platform.claude.com/docs/en/manage-claude/data-residency ; [OFF] https://platform.claude.com/docs/en/about-claude/model-deprecations ; ai-research §0.1 |
| Product behaviour | <ul><li>Plan §8: model IDs are configuration only; Fable is excluded; batches are deleted right after ingest; embedding degradation falls back to FTS only.</li><li>The Privacy Center and web `/privacy` disclose cross-border processing (the KVKK/GDPR wording is reviewed by counsel before launch, a **Manual external step** per ai-research §8).</li></ul> |
| UI communication | Privacy Center "AI'ın eriştiği veriler": `limits.ai.subprocessor_region` "AI analizi ABD'deki alt işleyicilerimizde yapılır." |
| Affected | `app/settings/privacy`, web `/privacy`, backoffice `/ai/models` |
| Verification | DB check constraint rejecting `claude-fable-%` (ADR-44 proposal). Deno: batch purge after ingest. |
| Master refs | M§40, M§81, M§82 |

---

## 8. Register: build, CI and development environment

#### KPL-59 · Native builds require EAS (or macOS/Android SDK); the planning container cannot build
| Field | Detail |
|---|---|
| Limitation | <ul><li>The execution container has no Xcode (Linux), no Android SDK or emulator, and `dl.google.com` is blocked (Gradle Android builds are impossible).</li><li>`api.expo.dev` is blocked, so no EAS build, update or submit from the container.</li><li>iOS builds need macOS.</li></ul> |
| Evidence | stack-versions audit "Container facts" ; ARCHITECTURE_DECISIONS §5.1 ; [KNOW] https://docs.expo.dev/build/introduction/ |
| Product behaviour | <ul><li>In-container mobile checks only: TypeScript, jest-expo, `expo install --check` (offline subset), `expo-doctor`, `expo export` bundle smoke, `expo prebuild --clean --no-install` plugin validation.</li><li>Native builds run on EAS Build (profiles `development`, `preview`, `e2e`, `production`). **External credential required:** `EXPO_TOKEN`.</li><li>Widget and share extension targets compile only there.</li></ul> |
| UI communication | n/a (internal). FINAL_IMPLEMENTATION_REPORT states where each check ran. |
| Affected | CI `mobile-checks`; release |
| Verification | CI job logs; EAS build artefacts. |
| Master refs | M§105, M§109, M§134, M§153 |

#### KPL-60 · Container network and Docker limits decide which test tiers run where
| Field | Detail |
|---|---|
| Limitation | <ul><li>The Docker daemon is not running.</li><li>These hosts are blocked: `api.supabase.com`, `graph.microsoft.com`, `api.openai.com`, `api.revenuecat.com`, `exp.host`, `sentry.io`, `deno.land`.</li><li>`supabase start` and `functions serve` need Docker.</li></ul> |
| Evidence | stack-versions audit "Container facts" ; ARCHITECTURE_DECISIONS §5.2 |
| Product behaviour | <ul><li>DB tier C (PG16 + shim + pgTAP) and tier D (PGlite) in the container; tier A (full Supabase) in CI.</li><li>Edge static and unit tests in the container; integration tests in CI.</li><li>Live provider calls happen only in owner sandbox runs following the M§153 checklist. Adapters report `external_credential_required` when a credential is missing (plan §19).</li></ul> |
| UI communication | Missing credentials: "Harici kimlik bilgisi gerekli" (plan §19) in the app states and in backoffice System Health (not green). |
| Affected | TEST_PLAN, CI, FINAL_IMPLEMENTATION_REPORT |
| Verification | CI matrix; the report's per-check location column. |
| Master refs | M§90, M§101, M§105, M§153 |

#### KPL-61 · Capabilities that automation cannot verify, and simulator caveats
| Field | Detail |
|---|---|
| Limitation | Real devices are needed for all of the following: <ul><li>system grants (notification listener, exact alarms, Time Sensitive);</li><li>widget rendering on the home and lock screens;</li><li>share extensions under memory pressure;</li><li>push delivery;</li><li>real-store purchases;</li><li>on-device STT/TTS voices;</li><li>background scheduling.</li></ul> Simulators differ: BGTaskScheduler is unavailable; the share-extension memory limit is not enforced; speech recognition and push behave differently. |
| Evidence | [OFF] https://docs.expo.dev/versions/latest/sdk/background-task/ (not available in Simulator) ; [SEC] share-extension memory limit disabled in Simulator (KPL-20 sources) ; [OFF] https://docs.expo.dev/eas/workflows/examples/e2e-tests/ |
| Product behaviour | <ul><li>Maestro covers the UI states (e.g. NI not granted, permission-denied cards) on EAS or emulators.</li><li>TEST_PLAN keeps a **manual device checklist** with one line per KPL whose Verification field says "Manual", run on at least one physical iPhone (latest iOS + iOS 16.4) and one physical Android device (latest + Android 13) before each store submission.</li><li>Results are recorded in FINAL_IMPLEMENTATION_REPORT.</li></ul> |
| UI communication | n/a. |
| Affected | Release process (M§153) |
| Verification | The checklist sign-off is part of the release gate (plan §22). |
| Master refs | M§101, M§102, M§153 |

---

## 9. Platform capabilities deliberately not used

| Capability | Why not | Closest behaviour used |
|---|---|---|
| WidgetKit push (direct APNs) | A second push credential path; budgeted anyway (ADR-40) | Foreground and background reloads (KPL-17) |
| Interactive widgets (iOS 17 App Intents) | Design 08: "yazma işlemi widget'tan yapılmaz" | Deep links into real screens |
| Live Activities | No requirement maps to it | Time-sensitive notifications |
| iOS Critical Alerts | Entitlement reserved for health/safety | Time Sensitive (KPL-07) |
| iOS provisional notification authorization | Onboarding explains first, then requests full permission (M§34 step 14) | Explainer + `requestPermissionsAsync` |
| `gmail.compose` / `gmail.modify` / `Mail.ReadWrite` | Least privilege (M§76); restricted or broader scopes | Drafts in our DB; `gmail.send` / `Mail.Send` reply (plan §7). Attachment cap per KPL-44 |
| Graph `proposedNewTime` | Forces an RSVP change; no Google equivalent | Email "yeni saat öner" draft (KPL-45) |
| Google `sendUpdates=none/externalOnly` for events with guests | Stale guest calendars | `all` + disclosed side effect (KPL-37) |
| `QUERY_ALL_PACKAGES`, `USE_EXACT_ALARM`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Play-restricted | `<queries>` launcher intent; `SCHEDULE_EXACT_ALARM`; settings handoff |
| OAuth in embedded WebViews | Google blocks embedded user-agents [KNOW] https://developers.googleblog.com/2021/06/upcoming-security-changes-to-googles-oauth-2.0-authorization-endpoint.html | `WebBrowser.openAuthSessionAsync` (ADR-07) |
| expo-widgets, react-native-android-widget, expo-share-extension, react-native-purchases-ui | ADR-02, ADR-40, ADR-41 | apple-targets + Glance; expo-share-intent; custom paywall |
| Android lock-screen widget surfaces on large screens | Not a phone surface; no requirement | Home-screen widgets |
| Automatic photo or screenshot scanning | Permissions policy and privacy | Photo picker and share (KPL-22) |
| Location / maps routing | Not in scope; no travel time invented (M§20) | Factual gaps only (KPL-47) |

---

## 10. Feature and screen → limitation index

| Feature / screen | KPL IDs |
|---|---|
| Onboarding (sign-in, connect mail/calendar, permissions, analysis, notifications, Android step) | 01, 02, 08, 12, 13, 31, 32, 33, 35, 43, 49 |
| Today, briefings, audio briefing | 05, 11, 12, 17, 25, 26, 27, 28, 56 |
| Flow, Mail Intelligence, Email Detail, AI Reply, Follow-up | 33, 34, 35, 44 |
| Plan, Calendar Intelligence, conflicts, proposals, Meeting Prep, Post-meeting | 12, 14, 15, 36, 37, 40, 45, 46, 47 |
| Smart Reminders | 07, 09, 10, 16, 38, 41 |
| Approval Center | 14, 37, 44, 45 |
| Life Intelligence | 03, 10, 47, 48 |
| Universal Capture and share | 20, 21, 22, 23, 55 |
| Assistant, Voice, Memory | 24, 58 |
| Widgets (iOS / Android) | 11, 17, 18, 19 |
| Notification settings and delivery | 05, 06, 07, 08 |
| Android Notification Intelligence | 01, 02, 03, 04 |
| Privacy Center (permissions, data sources, deletion, AI data) | 13, 24, 34, 42, 49, 51, 58 |
| Paywall, subscription, Pro gates | 50, 51, 52, 53, 54 |
| Referral | 31, 54 |
| Public web (`/`, `/pricing`, `/support`, `/privacy`, `/r/[code]`, `/data-deletion`) | 01, 31, 50, 51, 58 |
| Backoffice (`/health`, `/integrations`, `/jobs`, `/notifications`, `/subscriptions`) | 04, 05, 32, 33, 39, 52, 55, 56 |
| Localisation and layout | 27, 28, 29 |
| CI, release, store submission | 54, 59, 60, 61 |

---

## 11. User-facing copy catalogue (`limits.*`)

All keys live in `packages/i18n` (tr default, en complete; ICU plurals). The style follows `packages/i18n/STYLE.md` (sen dili, sakin, kısa). Strings owned by other documents are reused verbatim and not re-keyed here.

| Key | Türkçe (verbatim) | English |
|---|---|---|
| `limits.ios.ni_faq_q` | iPhone'da diğer uygulamaların bildirimlerini okuyabilir misin? | Can you read other apps' notifications on iPhone? |
| `limits.ios.ni_faq_a` | Hayır. iOS, uygulamaların başka uygulamaların bildirimlerine erişmesine izin vermez. iPhone'da kargo, uçuş ve ödeme bilgilerini bağladığın mail hesaplarından ve benimle paylaştığın içeriklerden çıkarırım. | No. iOS doesn't let apps access other apps' notifications. On iPhone, I find shipment, flight and payment details in your connected mail accounts and in content you share with me. |
| `limits.web.ni_android_only` | Yalnızca Android | Android only |
| `limits.android.ni_disconnected_title` | Bildirim erişimi açık ama bağlantı koptu | Notification access is on, but the connection dropped |
| `limits.android.ni_disconnected_body` | Pil tasarrufu Dijital Asistan'ı durdurmuş olabilir. Yeniden bağlanmayı denedim; sorun sürerse uygulamayı pil optimizasyonundan çıkar. | Battery saving may have stopped Dijital Asistan. I tried to reconnect; if it keeps happening, exclude the app from battery optimization. |
| `limits.android.ni_disconnected_cta` | Pil ayarlarını aç | Open battery settings |
| `limits.notifications.delivery_footnote` | Bildirimler Apple ve Google'ın bildirim servisleri üzerinden iletilir. Telefonun kapalıyken ya da internete bağlı değilken bazıları gecikebilir veya yalnızca en sonuncusu ulaşabilir. Her şeyin güncel hâli Bugün ekranında. | Notifications are delivered through Apple's and Google's notification services. If your phone is off or offline, some may arrive late or only the latest may arrive. The Today screen always has the current state. |
| `limits.notifications.detail_footnote_ios` | Kilit ekranında ne görüneceğini bu seçim belirler; iPhone'undaki "Önizlemeleri Göster" ayarı da geçerlidir. Değişiklik, bundan sonra gelecek bildirimlere uygulanır. | This choice sets what appears on your Lock Screen; your iPhone's "Show Previews" setting also applies. Changes apply to notifications you receive from now on. |
| `limits.notifications.detail_footnote_android` | Kilit ekranında ne görüneceğini bu seçim belirler; Android'in kilit ekranı bildirim ayarları da geçerlidir. Değişiklik, bundan sonra gelecek bildirimlere uygulanır. | This choice sets what appears on your lock screen; Android's lock screen notification settings also apply. Changes apply to notifications you receive from now on. |
| `limits.notifications.time_sensitive_off_title` | Zamana Duyarlı Bildirimler kapalı | Time Sensitive Notifications are off |
| `limits.notifications.time_sensitive_off_body` | Toplantı ve hatırlatıcı bildirimlerin Odak modunda ya da Planlanmış Özet'te bekleyebilir. | Meeting and reminder notifications may be held by Focus or the Scheduled Summary. |
| `limits.common.open_settings` | Ayarları Aç | Open Settings |
| `limits.notifications.channel_off_meta` | Android ayarlarında kapalı | Off in Android settings |
| `limits.notifications.permission_off_row` | Bildirimler kapalı · Ayarlar'da aç | Notifications are off · Turn on in Settings |
| `limits.reminders.exact_alarm_warning` | Tam saatinde hatırlatabilmem için "Alarmlar ve hatırlatıcılar" iznini aç. Bu izin kapalıyken hatırlatıcı birkaç dakika gecikebilir. | Turn on "Alarms & reminders" so I can remind you on time. Without it, reminders may arrive a few minutes late. |
| `limits.reminders.exact_alarm_cta` | İzni Aç | Turn On |
| `limits.alarm.ios_unavailable_note` | Bu iOS sürümünde uygulamalar alarm kuramaz. Bunun yerine zamana duyarlı bir hatırlatıcı kurabilirim. | Apps can't set alarms on this iOS version. I can set a time-sensitive reminder instead. |
| `limits.alarm.cta_reminder` | Hatırlatıcı Kur | Set Reminder |
| `limits.alarm.android_handoff_note` | Saat uygulaması açılacak; alarmı orada onayla. | Your Clock app will open; confirm the alarm there. |
| `limits.alarm.ios_usage` | Yalnızca sen istediğinde, örneğin erken bir uçuştan önce, alarm kurabilmek için. | To set an alarm only when you ask, for example before an early flight. |
| `limits.device_calendar.connect_footnote_ios` | Apple Takvim cihazından okunur; ayrı giriş gerekmez. Uygulamayı açtığında ve iOS izin verdiğinde arka planda güncellenir. | Apple Calendar is read from your device; no separate sign-in needed. It updates when you open the app and in the background when iOS allows. |
| `limits.device_calendar.connect_footnote_android` | Cihaz takvimi telefonundan okunur. Uygulamayı açtığında ve Android izin verdiğinde arka planda güncellenir. | Your device calendar is read from your phone. It updates when you open the app and in the background when Android allows. |
| `limits.device_calendar.full_access_explainer` | iOS, Apple Takvim'i okuyabilmem için tam erişim ister; yalnızca okuma diye bir seçenek yok. Takviminde, sen onaylamadan hiçbir değişiklik yapmam. | iOS requires full access for me to read Apple Calendar; there's no read-only option. I never change your calendar without your approval. |
| `limits.device_calendar.provenance` | {source} · son eşitleme {time} | {source} · last synced {time} |
| `limits.device_calendar.stale_note` | {source} · son eşitleme {time}. Sonraki değişiklikler uygulamayı açtığında eklenir. | {source} · last synced {time}. Changes after that are added when you open the app. |
| `limits.device_calendar.changed_after_briefing` | Takvimin bu brifingden sonra değişti. | Your calendar changed after this briefing. |
| `limits.device_calendar.see_current` | Güncel programı gör | See current schedule |
| `limits.device_calendar.sync_now` | Şimdi eşitle | Sync now |
| `limits.device_executor.meta_this_device` | Bu işlem bu cihazda, uygulama açıkken tamamlanır. | This completes on this device while the app is open. |
| `limits.device_executor.meta_other_device` | Bu işlem yalnızca {device} üzerinde tamamlanabilir. | This can only complete on {device}. |
| `limits.device_calendar.no_attendees` | Cihaz takviminde katılımcı eklenemez. Davet göndermek için Google veya Outlook takvimini seç. | Device calendars can't add attendees. To send invitations, choose a Google or Outlook calendar. |
| `limits.device_calendar.duplicate_meta` | Bu hesap zaten bağlı; iki kez eklenmez. | This account is already connected; it won't be added twice. |
| `limits.widgets.stale_meta` | Son güncelleme {time} | Updated {time} |
| `limits.widgets.generic_inline` | {n, plural, other {# önemli konu}} | {n, plural, one {# important item} other {# important items}} |
| `limits.help.widgets_refresh` | Widget'lar uygulamayı açtığında hemen, arka planda ise telefonunun izin verdiği sıklıkta güncellenir. | Widgets update right away when you open the app, and in the background as often as your phone allows. |
| `limits.help.widgets_android_lockscreen` | Android telefonlarda kilit ekranı widget'ı yok; ana ekran widget'larını kullanabilirsin. | Android phones don't have lock screen widgets; you can use the home screen widgets. |
| `limits.share.saved_for_later` | Kaydedildi. Dijital Asistan'ı açtığında analize hazır olacak. | Saved. It'll be ready to analyze when you open Dijital Asistan. |
| `limits.voice.unavailable` | Sesli giriş bu cihazda kullanılamıyor. | Voice input isn't available on this device. |
| `limits.voice.server_fallback_notice` | Bu cihazda Türkçe konuşma tanıma cihaz üzerinde çalışmıyor. Sesin, metne çevrilmek için güvenli bağlantıyla sunucumuza gönderilir ve hemen silinir. | On-device Turkish speech recognition isn't available on this device. Your voice is sent over a secure connection to our server to be transcribed and is deleted right away. |
| `limits.voice.platform_service_notice` | Cihaz üzerinde tanıma yoksa sesin Apple veya Google konuşma hizmetlerinde işlenebilir. | If on-device recognition isn't available, your voice may be processed by Apple or Google speech services. |
| `limits.tts.engine_device` | Cihaz sesi | Device voice |
| `limits.tts.engine_premium` | Doğal ses | Natural voice |
| `limits.tts.no_tr_voice` | Bu cihazda Türkçe ses yüklü değil. | No Turkish voice is installed on this device. |
| `limits.tts.install_android` | Ses paketini indir | Download voice |
| `limits.tts.install_ios_help` | Daha doğal bir ses için Ayarlar → Erişilebilirlik → Seslendirilen İçerik → Sesler → Türkçe yolundan bir ses indirebilirsin. | For a more natural voice, go to Settings → Accessibility → Spoken Content → Voices → Turkish and download a voice. |
| `limits.tts.unavailable_read_instead` | Bu cihazda dinleme kullanılamıyor; brifingini okuyabilirsin. | Listening isn't available on this device; you can read your briefing. |
| `limits.referral.ios_code_hint` | Uygulamayı yükledikten sonra kayıt olurken bu kodu gir: {code} | After installing the app, enter this code when you sign up: {code} |
| `limits.referral.copy_code` | Kodu kopyala | Copy code |
| `limits.google.unverified_notice` | Google, doğrulama sürecimiz tamamlanana kadar "Google bu uygulamayı doğrulamadı" uyarısı gösterebilir. | Until our verification is complete, Google may show a "Google hasn't verified this app" warning. |
| `limits.google.connect_failed` | Google bağlantısı şu an tamamlanamadı. Biraz sonra tekrar dene. | Couldn't finish connecting Google right now. Try again in a little while. |
| `limits.onboarding.analysis_long` | Gelen kutun kalabalık; analiz birkaç dakika sürebilir. Hazır olunca haber veririm. | Your inbox is busy; the analysis may take a few minutes. I'll let you know when it's ready. |
| `limits.onboarding.go_today` | Bugün'e geç | Go to Today |
| `limits.mail.folders_footnote_gmail` | Gelen Kutusu ve Gönderilenler analiz edilir. Filtreyle gelen kutusuna uğramadan arşivlenen mailler dahil edilmez. | Inbox and Sent are analyzed. Mail that a filter archives before it reaches the inbox isn't included. |
| `limits.mail.folders_footnote_outlook` | Gelen Kutusu ve Gönderilmiş Öğeler analiz edilir. Kurallarla başka klasöre taşınan mailler dahil edilmez. | Inbox and Sent Items are analyzed. Mail moved to other folders by rules isn't included. |
| `limits.tasks.poll_footnote` | Google Görevler ve Microsoft To Do yaklaşık 15 dakikada bir ve uygulamayı açtığında güncellenir. | Google Tasks and Microsoft To Do update about every 15 minutes and when you open the app. |
| `limits.calendar.outside_window` | Bu tarih eşitleme aralığının dışında; etkinlikler yaklaştıkça görünür. | This date is outside the sync range; events appear as it gets closer. |
| `limits.calendar.update_side_effect` | Katılımcılara güncelleme gönderilir | Attendees will be sent an update |
| `limits.calendar.not_organizer_meta` | Düzenleyen sen değilsin | You're not the organizer |
| `limits.calendar.propose_new_time` | Düzenleyene yeni saat öner | Suggest a new time to the organizer |
| `limits.calendar.availability_unknown` | Katılımcıların müsaitliği tam görünmüyor; öneriler yalnızca görebildiğim takvimlere göre. | Attendees' availability isn't fully visible; suggestions are based only on the calendars I can see. |
| `limits.calendar.availability_scope` | Katılımcıların müsaitliğine bakmak için Google Takvim'den ek izin gerekiyor. | Checking attendees' availability needs an extra Google Calendar permission. |
| `limits.calendar.locations_differ` | Konumlar farklı · arada {minutes} dk var | Different locations · {minutes} min between |
| `limits.ms.disconnect_done_personal` | Bağlantı kaldırıldı. Microsoft tarafındaki uygulama iznini de kaldırmak için account.live.com/consent/Manage adresini aç. | Disconnected. To also remove the app's permission on Microsoft's side, open account.live.com/consent/Manage. |
| `limits.ms.disconnect_done_work` | Bağlantı kaldırıldı. Microsoft tarafındaki uygulama iznini de kaldırmak için myapps.microsoft.com adresini aç. | Disconnected. To also remove the app's permission on Microsoft's side, open myapps.microsoft.com. |
| `limits.ms.open_permissions` | Microsoft izinlerini aç | Open Microsoft permissions |
| `limits.ms.admin_consent_title` | Kurum yöneticinin onayı gerekiyor. | Your organization's admin needs to approve. |
| `limits.ms.admin_consent_body` | İş hesabın, uygulamaların mail ve takvime erişmesi için BT yöneticisinin onayını istiyor. Onay bağlantısını yöneticinle paylaşabilirsin. | Your work account requires IT admin approval before apps can access mail and calendar. You can share the approval link with your admin. |
| `limits.ms.admin_consent_share` | Bağlantıyı Paylaş | Share Link |
| `limits.mail.attachment_limit_outlook` | Outlook yanıtlarında eklerin toplamı en fazla 3 MB olabilir. | Attachments in Outlook replies can total at most 3 MB. |
| `limits.mail.attachment_limit_gmail` | Gmail yanıtlarında eklerin toplamı en fazla 25 MB olabilir. | Attachments in Gmail replies can total at most 25 MB. |
| `limits.life.status_source` | Durum, kaynaktaki son bilgiye göre: {source} · {time} | Status as of the latest source: {source} · {time} |
| `limits.store.trial_web_note` | Ücretsiz deneme, mağazada sunulduğunda ve hesabın uygun olduğunda gösterilir. | A free trial is shown when the store offers one and your account is eligible. |
| `limits.store.manage_store` | Aboneliğin {store} üzerinden. Planını değiştirmek veya iptal etmek için {store} ayarlarını kullan. | Your subscription is through {store}. Use {store} settings to change or cancel your plan. |
| `limits.store.manage_other_store` | Aboneliğin {store} üzerinden alındı; bu cihazdan yönetilemez. Aboneliği aldığın cihazda {store} ayarlarını kullan. | Your subscription was purchased through {store} and can't be managed from this device. Use {store} settings on the device you bought it on. |
| `limits.store.deletion_subscription_warning` | Hesabını silmek {store} aboneliğini iptal etmez. Ücretlendirilmemek için önce aboneliğini iptal et. | Deleting your account doesn't cancel your {store} subscription. Cancel it first to avoid being charged. |
| `limits.ai.subprocessor_region` | AI analizi ABD'deki alt işleyicilerimizde yapılır. | AI analysis is performed by our sub-processors in the United States. |
| `limits.capture.too_heavy` | Bu dosyayı şu an analiz edemedim. Daha küçük bir dosya ya da ekran görüntüsüyle tekrar dene. | I couldn't analyze this file right now. Try again with a smaller file or a screenshot. |

`{store}` resolves to "App Store" or "Google Play". `{source}` resolves to "Apple Takvim" / "Cihaz Takvimi" (en: "Apple Calendar" / "Device Calendar"). `{device}` resolves to `expo-device` `modelName`.

---

## 12. Configuration, manifest and entitlement changes implied

| Platform | Change | For |
|---|---|---|
| iOS Info.plist | `NSCalendarsFullAccessUsageDescription`, `NSRemindersFullAccessUsageDescription` (+ legacy `NSCalendarsUsageDescription`, `NSRemindersUsageDescription`), `NSSpeechRecognitionUsageDescription`, `NSMicrophoneUsageDescription`, `NSCameraUsageDescription`, `NSAlarmKitUsageDescription`; `UIBackgroundModes`: `processing`, `remote-notification`, `audio`; `BGTaskSchedulerPermittedIdentifiers`: `com.expo.modules.backgroundtask.processing`; `InfoPlist.strings` tr/en | KPL-10, 11, 12, 13, 24, 26 |
| iOS entitlements | App Group `group.com.dijitalasistan.app` (app, widget, share extension); `com.apple.developer.usernotifications.time-sensitive`; Sign in with Apple; keychain access group | KPL-07, 17, 20, 49 |
| Android manifest | `POST_NOTIFICATIONS`, `READ_CALENDAR`, `WRITE_CALENDAR`, `SCHEDULE_EXACT_ALARM`, `com.android.alarm.permission.SET_ALARM`, `RECORD_AUDIO`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`; the `NotificationListenerService` with `BIND_NOTIFICATION_LISTENER_SERVICE`; `<queries>` for MAIN/LAUNCHER and speech/TTS services; Auto Backup exclusions. **Absent:** `QUERY_ALL_PACKAGES`, `USE_EXACT_ALARM`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, `READ_MEDIA_IMAGES`, `READ_EXTERNAL_STORAGE` | KPL-02, 08, 09, 10, 22, 24, 26, 30 |
| App config | `I18nManager` LTR only; no `supportsRTL` | KPL-29 |
| Lint / quality gate | Ban `textTransform: 'uppercase'`, runtime `.toUpperCase()` on UI strings, `Intl.RelativeTimeFormat` / `ListFormat` / `DisplayNames` / `Segmenter`, the `TL` literal in mobile; banned-claim patterns (§1.3) | KPL-27, 28, 50 |

CI verifies the manifest and plist through the `expo prebuild --clean` smoke test plus a grep of the generated `AndroidManifest.xml` and `Info.plist`.

---

## 13. Re-verification backlog (execution mode)

Each item is checked against the live official source at the start of the relevant execution step. If a fact differs, this document and the dependent code are updated in the same commit.

| # | Fact to verify | Where used | Source to check |
|---|---|---|---|
| 1 | Hermes V1 `Intl` coverage (PluralRules, timezone formatting) | KPL-27 | Hermes IntlAPIs.md; on-device Maestro run |
| 2 | `expo-notifications` Android scheduling uses exact alarms when permitted | KPL-09 | expo-notifications source/CHANGELOG + Doze test |
| 3 | AlarmKit API surface and `NSAlarmKitUsageDescription` key | KPL-10 | developer.apple.com/documentation/alarmkit |
| 4 | Background notification support (`registerTaskAsync`) on iOS and Android data-only messages via Expo Push (`_contentAvailable`, `apns-push-type: background`) | KPL-11, 12 | Expo notifications docs |
| 5 | Graph attachment size without `Mail.ReadWrite` (3 MB) and request-size limits for `reply` with attachments | KPL-44 | learn.microsoft.com Graph large attachments |
| 6 | Graph organiser updates auto-send meeting updates | KPL-37 | Graph `event-update` doc |
| 7 | Google `calendar.events.freebusy` covers `freebusy.query` for other calendars | KPL-46 | Calendar Discovery scope descriptions |
| 8 | Google `forbiddenForNonOrganizer` semantics vs `guestsCanModify` | KPL-45 | Calendar API errors guide |
| 9 | Gmail 2026 quota table and `messages.get` cost | KPL-33 | Gmail quota page |
| 10 | Unverified publishing status and refresh-token expiry behaviour | KPL-32 | Google OAuth console / docs |
| 11 | AADSTS error codes for admin consent | KPL-43 | Entra error reference |
| 12 | Microsoft consent-management URLs | KPL-42 | Microsoft account / My Apps |
| 13 | Time Sensitive entitlement key and `timeSensitiveSetting` | KPL-07 | Apple docs |
| 14 | Play notification-listener policy and Data safety requirements | KPL-02, 54 | Play policy center |
| 15 | Android restricted-settings scope on 15/16/17 | KPL-02 | Android docs / device test |
| 16 | APNs coalescing and FCM offline storage behaviour | KPL-05 | Apple / Firebase docs |
| 17 | CarPlay Now Playing without the audio entitlement | KPL-26 | Apple CarPlay docs |
| 18 | RevenueCat v2 customer delete endpoint; eligibility API behaviour | KPL-50, 51 | RevenueCat docs |
| 19 | Current App Store minimum Xcode/SDK and Play target-API requirement | KPL-54, 59 | App Store Connect / Play docs |
| 20 | WidgetKit App Group default file protection | KPL-17 | Apple docs + reboot test |
| 21 | EventKit `EKSource.title` / CalendarContract `ACCOUNT_NAME` values for duplicate detection | KPL-15 | Device test |

---

## 14. Manual external steps and external credentials implicated

| Item | Type | KPL |
|---|---|---|
| Google CASA / LOA for `gmail.readonly`; brand verification; Search Console domains | Manual external step | 32 |
| Supabase custom domain (paid add-on) for OAuth callbacks | Manual external step | 32, 57 |
| Google Pub/Sub topic + push subscription + publisher role | Manual external step | 33 |
| Entra app registration + certificate; Partner One publisher verification | Manual external step / External credential required | 43, 44 |
| Apple Time Sensitive capability, App Group, share extension and widget bundle IDs (EAS credentials) | Manual external step | 07, 17, 20 |
| CarPlay audio entitlement request (only for a CarPlay app presence) | Manual external step | 26 |
| SIWA key, Services ID, private-relay email domain registration | Manual external step / External credential required | 49 |
| Store intro offers (only if trials are wanted); App Store / Play agreements; products | Manual external step | 50 |
| RevenueCat keys, v2 secret, webhook secret | External credential required | 52 |
| Play Data safety (notification access, audio), foreground-service declaration, account-deletion URL | Manual external step | 02, 26, 54 |
| Custom SMTP with raised rate limit | External credential required | 57 |
| Server STT / premium TTS provider keys (optional) | External credential required | 24, 25 |
| `EXPO_TOKEN` for EAS; physical test devices for the manual checklist | External credential required / Manual external step | 59, 61 |
| Counsel review of the KVKK/GDPR cross-border processing wording (Privacy Center, web `/privacy`) | Manual external step | 58 |

---

## Proposed additions to the canonical registry

| # | Category | Proposed addition | Justification (KPL) |
|---|---|---|---|
| 1 | Local native module | `apps/mobile/modules/da-platform` (Kotlin + Swift). JS API: `canScheduleExactAlarms(): boolean`, `openExactAlarmSettings(): void`, `scheduleExactReminder({id, fireAt, title, body, deeplink})` / `cancelExactReminder(id)` (Android; used only if the verification in KPL-09 fails), `isSystemAlarmAvailable(): boolean`, `scheduleSystemAlarm({fireAt, label}): Promise<'scheduled'|'handoff'|'unavailable'>` (AlarmKit iOS 26+ / `ACTION_SET_ALARM`), `getTimeSensitiveSetting(): 'enabled'|'disabled'|'not_supported'` | RN `Linking.sendIntent` cannot pass typed extras or data URIs; there is no Expo API for exact-alarm state, AlarmKit or Time Sensitive state (KPL-07, 09, 10) |
| 2 | Module API extension | `notification-intelligence`: `getListenerState(): {granted, connected, lastConnectedAt}`, `requestRebind(): void` | Listener unbinding (KPL-04) |
| 3 | Notification job kind (no `job_type` change) | `notification` job with `payload.kind='device_refresh'`, key `device_refresh:{installation_id}:{kind}:{local_date}`, enqueued by `scheduler_tick()` at briefing time −40 min | Device-calendar staleness (KPL-12) |
| 4 | Column | `briefings.source_freshness jsonb` (`{connected_account_id: {provider, last_success_at, stale}}`) | Render the stale note and change banner (KPL-12) |
| 5 | Column + request field | `app_installations.platform_capabilities jsonb` (`ios_time_sensitive`, `ios_show_previews`, `android_channels_disabled[]`, `android_exact_alarm`, `stt_on_device_tr`, `tts_tr_voice`, `widgets[]`, `ni_connected`, `alarmkit_available`), sent in the body of the existing `POST /devices/register`. Per the accepted registry rename, the NI grant stays in the existing `ni_listener_granted` column (with `ni_mode`, `ni_allowed_packages` and `ni_last_signal_at`), the OS notification permission lives in `notification_preferences.os_permission`, and `os_version` is already a top-level register field | Cross-device settings truth and support/backoffice visibility (KPL-04, 06, 07, 08, 09, 24, 25) |
| 6 | Scope (no enum change) | Google `calendar.events.freebusy` requested progressively via `POST /integrations/:accountId/upgrade` under the existing `calendar_read` capability; checked via `connected_accounts.granted_scopes`. Graph uses the existing `Calendars.Read` | Real attendee availability (KPL-46) |
| 7 | API route + columns | `POST /approvals/:id/device-execution` (API_CONTRACTS API-APR-05; canonical per R-18/R-24, replacing the draft name `device-result`) + `approval_actions.executor` (`'server'` \| `'device'`), `device_installation_id` and `device_token_hash` (accepted registry decision) | Device-destination writes (KPL-14) |
| 8 | Approval `error_code` values (existing names) | `device_permission_denied` (SCREEN_AND_FLOW_MAP Part 2 §0.5), `not_organizer` (Part 3 A-08), `attachment_too_large` (Part 2 §0.5); `DEVICE_RESULT_MISSING` for the device-execution timeout (API_CONTRACTS §6.7) | KPL-14, 44, 45 |
| 9 | Options payload rule (no shape change) | API-PLAN-03 `feasibility.attendee_availability` (`free` \| `busy` \| `unknown`) is `unknown` whenever any attendee has no real free/busy data | KPL-46 |
| 10 | Bootstrap field + domain constant (no new flag keys, R-10) | `GET /me/bootstrap` `config.google_oauth_verified: boolean`, true only while `GOOGLE_CASA_LOA_NOT_AFTER` (INTEGRATION_PLAN §15) is set and in the future; `DEVICE_CALENDAR_STALE_MINUTES = 180` in `packages/domain` | KPL-12, 32 |
| 11 | Health probe detail (no new component) | Component `google_oauth` in `system_health_checks` records `detail {gmail_users, cap: 100}` while unverified: `degraded` at 80, `down` at 95 | KPL-32 |
| 12 | Background task names | `da-background-refresh` (expo-background-task, `minimumInterval: 30`, as in INTEGRATION_PLAN §12.7), `da-background-notification` (expo-notifications background task for `data.type='device_refresh'` pushes) | KPL-11, 12 |
| 13 | Domain constants | `REPLY_ATTACHMENT_LIMIT_BYTES = {google: 26214400, microsoft: 3145728}` in `packages/domain` | KPL-44 |
| 14 | `calendars` column (already canonical) | `calendars.selected boolean not null default true` exists in DATABASE_AND_RLS_PLAN with a user update grant; it is set to false on import for device duplicates | KPL-15 |
| 15 | i18n namespace | `limits.*` keys listed in §11 | All entries |
| 16 | i18n helpers | `ensureIntl()` and `joinList(items, locale)` in `packages/i18n`; conditional dependencies `@formatjs/intl-pluralrules` and `@formatjs/intl-datetimeformat` (versions pinned at install per the ADR-02 policy) | KPL-27 |
| 17 | Quality-gate patterns | Banned claims from §1.3 appended to `scripts/quality-gate/banned-markers.txt` (file proposed by ARCHITECTURE_DECISIONS); lint rules from §12 | KPL-27, 28, 50; M§141 |
| 18 | Web config | `<html dir="ltr">` (web, backoffice); badge "Yalnızca Android" for NI in the web feature and pricing content | KPL-01, 29 |

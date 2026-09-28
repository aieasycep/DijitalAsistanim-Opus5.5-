# Design mapping

Documented at `ec14e92`. Where each section of the PRIMARY design archive ended up in the product, which screens were adopted from the SECONDARY archive, and how the design deviation log of [DESIGN_AUDIT §7](DESIGN_AUDIT.md#7-deviation--redesign-log-m124-minimum-visual-change-maximum-functional-completeness) was applied. Screen IDs are those of [SCREEN_AND_FLOW_MAP.md](SCREEN_AND_FLOW_MAP.md); archive keys (`P:01` … `P:09`, `P:hub`, `S:`) are those of [DESIGN_AUDIT §1.1](DESIGN_AUDIT.md#11-notation-used-in-this-document). The archives themselves are not committed ([`design/README.md`](../design/README.md)); what the product consumes from them is `design/tokens/primary-tokens.json`, `design/icons/used-icons.txt` and `design/copy/primary-copy.tsv`.

Routes are relative to `apps/mobile/app/`. Components without a path are exports of `@da/ui` ([`packages/ui/src`](../packages/ui/src)); screens live in [`apps/mobile/src/features`](../apps/mobile/src/features). Some code comments use short aliases for three screen IDs: `M-COM-01/02` = M-COMMIT-01/02, `M-FU-01` = M-WAIT-01, `M-FU-02` = M-FUP-01.

**Status:** *Built* — the screen exists and follows the artboard; *Built, see DEV-nn* — follows it with a logged deviation (table at the end); *Partial* — part of the artboard is not in the product (the note says which); *Not produced* — nothing in the repository renders it.

## PRIMARY archive

### P:01 Tasarım Sistemi (design system)

| Section | Product | Status |
| --- | --- | --- |
| RENK · TOKENLAR, DARK MODE TOKENLARI | [`packages/design-tokens`](../packages/design-tokens) (`palette.ts`, `color.ts`, `gradient.ts`), generated for React Native (`native.json`) and CSS; contrast pairs checked by `test/contrast.test.ts` | Built, see DEV-01…DEV-14 |
| TİPOGRAFİ · GEIST + LORA | `typography.ts`; Geist and Lora embedded in the app (`expo-font`) and self-hosted on web and backoffice (`next/font`); `Text` with Dynamic Type limits | Built, see DEV-17, DEV-23 |
| BOŞLUK · 4'LÜK IZGARA · KÖŞE YARIÇAPI · GÖLGE | `space.ts`, `radius.ts`, `shadow.ts`, `layout.ts` | Built |
| İKONLAR · MATERIAL SYMBOLS ROUNDED | SVG components generated from `@material-symbols/svg-400` (outline + fill) per [`packages/ui/icons.manifest.json`](../packages/ui/icons.manifest.json), with aliases for renamed glyphs | Built, see DEV-15, DEV-16 |
| BUTONLAR · 5 VARYANT × DURUMLAR | `Button`, `PrimaryButton`, `SecondaryButton`, `TonalButton`, `PillButton`, `IconButton`, `TextAction`, `ActionTile` | Built, see DEV-22 |
| ÇİPLER · ROZETLER | `FilterChip`, `ChoiceChip`, `MetaChip`, `SourceChip`, `ConfidenceChip`, `Badge`, `StatusPill`, `CountdownPill` | Built, see DEV-66 |
| KARTLAR · 6 KALIP | `PriorityCard`, `AttentionCard`, `AiCard`, `LifeCard`, `CommitmentCard`, `FollowUpCard`, `WaitingCard`, `MailSummaryCard`, `ApprovalCard`, `InkCallout` | Built |
| GİRİŞLER · ARAMA · SOHBET | `TextField`, `SearchField`, `UrlField`, `ChatComposer`, `CaptureTextField` | Built |
| SEGMENTLİ KONTROL · ANAHTAR · ONAY | `SegmentedControl`, `Switch`, `CheckIndicator`, `RadioIndicator`, `OptionRow` | Built, see DEV-07, DEV-08 |
| NAVİGASYON · BAŞLIK KALIPLARI | `RootHeader`, `DetailHeader`, `HeaderPill`, `TabBar` (M-GL-03, M-GL-04) | Built, see DEV-20, DEV-24, DEV-25 |
| ALT SAYFA · MODAL | `BottomSheet`, `ConfirmDialog`, `DestructiveSheet` in the app's `SheetHost` (M-GL-06) | Built, see DEV-56 |
| TOAST · SES · İSKELET | `Toast`, `UndoToast` (M-GL-05); `FullPlayer`, `Scrubber`, `TransportControls`, `MiniPlayer`, `VoiceOrb`, `VoiceWaveform`; `SkeletonBlock`, `TodaySkeleton`, `FeedSkeleton` and screen skeletons | Partial: `MiniPlayer` (M-GL-14) is not mounted in the app, see DEV-52 |

### P:02 Onboarding

| Artboard | Screen | Route / component | Status |
| --- | --- | --- | --- |
| 2.1 Tanıtım 1 · Marka | M-ON-01 | `(onboarding)/welcome` (`IntroPager`) | Built |
| 2.2 Gürültüyü azalt | M-ON-02 | `(onboarding)/noise` | Built |
| 2.3 Brifing | M-ON-03 | `(onboarding)/proactive` | Built, see DEV-37 |
| 2.4 Kontrol sende | M-ON-04 | `(onboarding)/control` | Built |
| 2.5 Hesap Oluştur | M-ON-05, M-ON-05E, M-ON-05V | `(auth)/sign-in`, `(auth)/email-otp` (`AuthProviderButton`) | Built |
| 2.6 Dijital hayatını bağla | M-ON-06, M-ON-07 | `(onboarding)/connect-mail`, `(onboarding)/connect-calendar` | Built, see DEV-36 |
| 2.7 İzin Açıklayıcı · Gmail · 2.7b Outlook · 2.7c Takvim | M-ON-06G, M-ON-06O, M-ON-07E | sheet `ExplainerSheet` (`integrations/sheets`) | Built |
| 2.8 Kişiselleştirme | M-ON-09 | `(onboarding)/personalization` (`SelectableTile`) | Built |
| 2.9 Brifing Ayarları | M-ON-10, M-SET-23 | `(onboarding)/briefing-schedule`, `settings/briefings` | Built |
| 2.10 İlk Analiz · İşleniyor | M-ON-12 | `(onboarding)/analysis` (`PulsingRing`, real job progress) | Built, see DEV-33 |
| 2.11 İlk Analiz · Hazır | M-ON-13 | `(onboarding)/ready` | Built |
| 2.12 Bildirim İzni Açıklayıcı | M-ON-14 | `(onboarding)/notifications` (`NotificationPreview`) | Built |
| 2.13 Android · Telefon Bildirimleri | M-ON-14A, M-ANI-01…04 | `(onboarding)/android-notifications`, `settings/android-notifications` | Built (Android only) |

### P:03 Bugün ve Brifingler

| Artboard | Screen | Route / component | Status |
| --- | --- | --- | --- |
| 3.1 Bugün · Light · Sabah | M-TD-01, M-TD-02…04 | `(tabs)/today/index` (`RootHeader`, `BriefingHero`, `PriorityCard`, `SwipeableRow`, sheets `CorrectionSheet`, `WhySheet`, `SnoozeSheet`) | Built, see DEV-24, DEV-65, DEV-68 |
| 3.2 Bugün · Dark | M-TD-01 (dark, evening hero) | same | Built |
| 3.3 Sabah Brifingi · 3.3D Dark | M-BR-01, M-BR-07 | `briefing/[id]`, `briefings/index` (`GradientHeader`, `EditorialParagraph`, `GroupedList`, `ProvenanceFooter`) | Built, see DEV-53 |
| 3.4 Sesli Brifing | M-BR-02 | `briefing/[id]/listen` (`FullPlayer`, `ChapterList`, `SpeedPill`, `NativeTtsNotice`) | Built, see DEV-52 |
| 3.5 Öğle Nabzı · 13:00 | M-BR-03 | `briefing/[id]` (midday) | Built, see DEV-66 |
| 3.6 Akşam Kapanışı · 19:00 | M-BR-04, M-BR-04C | `briefing/[id]` (evening) + `EveningReadySheet` | Built, see DEV-51 |
| 3.7 Haftalık Özet · Editoryal | M-BR-05 | `weekly/[id]` (`EditorialStatRow`, `HighlightCard`) | Built |
| 3.8 "Dijital Haftam" paylaşım kartı | M-BR-06 | `weekly/[id]/share` (`ShareCardTemplate`, captured with `react-native-view-shot`) | Built, see DEV-50 |

### P:04 Akış ve Mail

| Artboard | Screen | Route / component | Status |
| --- | --- | --- | --- |
| 4.1 Akış · Tümü · 4.2 Kişisel · Dark | M-FLOW-01 | `(tabs)/flow/index` (`FilterChipRow`, `AttentionCard`, mail digest row) | Built, see DEV-25, DEV-26 |
| 4.3 Mail Zekâsı | M-MAIL-01, M-MAIL-02 | `mail/index`, `mail/category/[category]` (`HeroStat`, `StackedBar`, `CategoryRow`, `MailSummaryCard`) | Built |
| 4.4 Mail Detayı | M-MAIL-03, M-MAIL-04, M-MAIL-05 | `mail/[id]` (`SenderHeader`, `AiCard`, `ActionTileGrid`, `Accordion`, `SourceLine`) | Built, see DEV-39 |
| 4.5 AI Yanıt Taslağı | M-REPLY-01…05 | `mail/[id]/reply` (`RecipientChip`, `SegmentedControl`, `DraftEditorCard`, `AssistChip`, `AssuranceNote`) | Built, see DEV-62, DEV-63 |
| 4.6 Akıllı Takip | M-FUP-01 | `followups` | Built, see DEV-59 |
| 4.7 Senden Beklenenler | M-WAIT-01 | `waiting` | Built |
| 4.8 Taahhütler | M-COMMIT-01…03 | `commitments/index`, `commitments/[id]` | Built |
| 4.9 Yaşam Zekâsı | M-LIFE-01 | `life/[id]` (transparent modal, `LifeCard`) | Built, see DEV-64 |
| 4.10 Evrensel Yakalama · Ekran görüntüsü | M-CAP-01, M-CAP-02, M-CAP-05, M-CAP-06 | `capture/index`, `capture/[id]` (`CaptureSourceTiles`, `AnalysisProgressCard`, `ExtractedItemRow`) | Built, see DEV-47 |
| 4.11 Fatura fotoğrafı + Akıllı hatırlatıcı | M-CAP-06, M-REM-01…03 | `capture/[id]`, `reminders/new` | Built, see DEV-31 |
| 4.12a–d PDF · 4.13a–d Link · 4.14a–d Metin | M-CAP-01, M-CAP-03…07, M-APPR-04 | `capture/index`, `capture/[id]`, approval sheet | Built, see DEV-47, DEV-48, DEV-49 |

### P:05 Plan ve Toplantılar

| Artboard | Screen | Route / component | Status |
| --- | --- | --- | --- |
| 5.1 Plan · Gün · 5.1D Dark | M-PLAN-01, M-PLAN-05, M-PLAN-06 | `(tabs)/plan/index` (`DayStrip`, `TimelineBlockRow`, `GapBlock`) | Built, see DEV-27, DEV-45 |
| 5.2 Hafta + Takvim Zekâsı | M-PLAN-02 | same, week view (`WeekDensityChart`, `CalendarIntelCard`) | Built, see DEV-58 |
| 5.3 Takvim Çakışması | M-PLAN-07, M-PLAN-08, M-PLAN-03, M-PLAN-04 | `plan/conflict/[insightId]`, `plan/proposal/[approvalId]` (`ConflictPair`) | Built, see DEV-46 |
| 5.4 Toplantıya Hazırlan · 5.5 Dark | M-MEET-01, M-MEET-02, M-PLAN-09 | `meeting/[eventId]/prep`, `event/[id]` (`TalkingPointsCard`, `CountdownPill`) | Built, see DEV-40, DEV-41 |
| 5.6 2 Dakikalık Özet | M-MEET-03 | `meeting/[eventId]/summary` | Built |
| 5.7 Toplantı Sonrası Yakalama | M-MEET-04, M-MEET-05 | `meeting/[eventId]/post` (`TranscriptCard`) | Built |

### P:06 Asistan, Hafıza, Kişiler

| Artboard | Screen | Route / component | Status |
| --- | --- | --- | --- |
| 6.1 Asistan · Giriş · 6.1D Dark | M-ASST-01 | `(tabs)/assistant/index` | Built (also the entry to global search, see DEV-24) |
| 6.2 Zengin kartlı yanıt | M-ASST-02, M-ASST-03 | `chat/[threadId]` (`AnswerBubble`, `RichAnswerCard`, `DraftCard`, `ConfidenceText`) | Built |
| 6.3 Ses Modu · Dinliyor · 6.4 Yanıt + yazma onayı | M-VOICE-01, M-ASST-03 | `voice` (`VoiceOrb`, `VoiceWaveform`, compact `ApprovalCard`) | Built, see DEV-30 |
| 6.5 AI Hafıza | M-MEM-01, M-SRCH-01 | `memory`, `search` (`SourceResultCard`) | Built |
| 6.6 Önemli Kişiler · VIP | M-VIP-01…03, M-ON-11 | `vip`, `(onboarding)/vip` | Built, see DEV-44 |
| 6.7 Kişi Zekâsı | M-PERS-01 | `person/[id]` | Built, see DEV-42, DEV-61 |
| 6.8 Onay Merkezi | M-APPR-01…05 | `approvals/index`, `approvals/[id]`, sheets `ApprovalSheet`, `ApprovalEditorSheet` | Built, see DEV-28, DEV-29 |
| 6.9 AI Kişiselleştirme | M-SET-45, M-SET-46 | `settings/personalization` | Built, see DEV-43 |

### P:07 Hesap, Gizlilik, Pro

| Artboard | Screen | Route / component | Status |
| --- | --- | --- | --- |
| 7.1 Profil ve Ayarlar | M-SET-01, M-SET-02, M-SET-03 | `settings/index`, `settings/profile` | Built, see DEV-54 |
| 7.2 Gizlilik Merkezi | M-SET-30 | `settings/privacy/index` (`PrivacyNote`, `IntegrationRow`) | Built, see DEV-33 |
| 7.3 AI'ın Eriştiği Veriler | M-SET-32, M-SET-33 | `settings/privacy/data-sources` | Built, see DEV-33 |
| 7.4 Veri Saklama + Silme sayfası | M-SET-34…37, M-SET-40 | `settings/privacy/retention`, `settings/privacy/history` | Built, see DEV-32 |
| 7.5 Paywall · PRO | M-PAY-01 | `paywall` (`PlanComparisonTable`, `PlanOptionCard`) | Built, see DEV-34 |
| 7.6 Bağlamsal Pro kapısı | M-GATE-01, M-GATE-02, M-GL-13 | `ProGateCard`, sheet `pro_gate` (`src/features/pro-gate`) | Built |
| 7.7 Arkadaşını Davet Et | M-REF-01, M-REF-02 | `settings/referral` (`ReferralLinkField`, `InviteRow`) | Built |
| 7.8 Görünüm ve Dil | M-SET-60…62 | `settings/appearance`, `settings/language` (`ThemePreviewTile`) | Built, see DEV-35 |
| 7.9 Öncelik Kuralları | M-SET-50, M-SET-54 | `settings/priority-rules/index` | Built |
| 7.10 Yeni Kural · 7.11 Kuralı Düzenle | M-SET-51, M-SET-52 | `settings/priority-rules/[id]` (`RulePreviewCard`) | Built |
| 7.12 Kuralı Sil + geri al | M-SET-53 | `ConfirmDialog` + `UndoToast` | Built |

### P:08 Durumlar, Widget'lar, Etkileşimler

| Section | Screen | Product | Status |
| --- | --- | --- | --- |
| `EMPTIES` (today, plan, follow-up, approvals) | M-STATE-02 | `EmptyState` with the design copy; derived empties for filters, search, VIP, rules, referrals | Built, see DEV-53 |
| `ERRORS` (oauth-expired, permission-denied, sync-delayed, ai-unavailable) + offline full screen | M-STATE-03…08, M-GL-09 | `ReconnectCard`, `PermissionCard`, `SyncDelayedCard`, `AiUnavailableCard`, `OfflineBanner`, `OfflineScreen`, `ExternalCredentialRequired` | Built |
| Loading · Today skeleton | M-STATE-01 | `TodaySkeleton` and per-screen skeletons | Built |
| iOS widgets S / M / L + lock screen | M-WGT-01…06 | [`targets/widget`](../apps/mobile/targets/widget) (`DATodayWidget`, `DALockWidget`) | Built, see DEV-17 (rendering is verified on EAS builds and devices only) |
| Android widgets 4×2 / 2×2 | M-WGT-07, M-WGT-08 | [`modules/da-widgets`](../apps/mobile/modules/da-widgets) (Glance `DaTodayWidget`, `DaNextWidget`) | Built, see DEV-17 |
| KAYDIRMA AKSİYONLARI | M-TD-04 | `SwipeableRow` on Today and Flow, `SnoozeSheet` | Built, see DEV-10 |
| BRİFİNG AÇILIŞI · KARE KARE | M-BR-01 | The briefing opens with the stack transition; the staged frame-by-frame opening is not animated | Partial |
| `MOTION` (12 rows) | — | `motion.ts` durations and easings in `@da/design-tokens` (no transition over 600 ms; reduce motion keeps only 120 ms opacity) | Built |

### P:09 Pazarlama

| Section | Plan | Status |
| --- | --- | --- |
| store/01–06 (1290×2796) | SCREEN_AND_FLOW_MAP §15.4: six tr/en store screenshots rendered from the demo canon through `dijitalasistan-e2e://demo/setup` | Not produced (owner step, [STORE_CHECKLIST.md](STORE_CHECKLIST.md#screenshots-and-ads)), see DEV-38 |
| ad/01–03 (1080×1920) | SCREEN_AND_FLOW_MAP §15.7 social concepts | Not produced, see DEV-38 |

### P:hub (clickable prototype)

| Block | Product |
| --- | --- |
| VARSAYIMLAR VE KARARLAR, BİLGİ MİMARİSİ | Informed the four-tab IA (M-GL-03) and the route map in [MOBILE.md](MOBILE.md#navigation-and-guards) |
| `isToday`, `isAkis`, `isPlan` / `isDay` / `isWeek`, `isAsistan`, `isBriefing`, `isAudio`, `isPrep`, `isPost`, `isMail`, `isReply`, `isApprovals`, `isProfile`, `isPerson`, `isPaywall` | The screens of the matching artboards above; where the hub and an artboard differ, the artboard won (DESIGN_AUDIT §1.3) |
| `sheetDefs.remind`, `sheetDefs.correct` | M-REM-01 (`reminders/new`), M-TD-02 / M-CORR-01 (`CorrectionSheet`) |
| `voice`, `toast`, tab bar | M-VOICE-01, M-GL-05, M-GL-03 |

## SECONDARY-only adoptions

Screens that PRIMARY does not draw, taken from the SECONDARY archive for information architecture only and rebuilt in the PRIMARY visual language:

| SECONDARY source | Screen | Route | Status |
| --- | --- | --- | --- |
| `S:settings/NotificationSettings.tsx`, `S:marketing/NotificationExamples.tsx` | M-SET-20, M-SET-21 | `settings/notifications` (categories, quiet hours, lock-screen detail level with `NotificationPreview`) | Built |
| `S:settings/BriefingSettings.tsx` (with P:02 2.9) | M-SET-23…25 | `settings/briefings` | Built |
| `S:HelpScreen.tsx`, `S:FeedbackScreen.tsx` | M-SET-70…74, M-SET-03 | `settings/help`, `settings/feedback`, `settings/about`, `settings/profile` | Built |
| `S:settings/DataSourceControl.tsx`, S İzinler sheet | M-SET-31, M-SET-12, M-ON-08 | `settings/privacy/permissions`, `settings/accounts/[id]`, `(onboarding)/permissions` | Built |
| `S:…/OnboardingFlow.tsx` VIP and calendar-denied screens | M-ON-11, M-ON-07D | `(onboarding)/vip`, `CalendarDeniedSheet` | Built |
| `S:today/EveningClose.tsx` | M-BR-04C | `EveningReadySheet` | Built |
| `S:shared/SearchScreen.tsx` | M-SRCH-01 | `search` (P:06 6.5 language) | Built |
| `S:shared/ApprovalCenter.tsx` (history) | M-APPR-02 | `approvals/index` history tab | Built |
| `S:ui/SmartReminderSheet.tsx` (preset order, "Kendin seç") | M-REM-01, M-REM-02 | `reminders/new` | Built |
| `S:plan/CommitmentTracker.tsx` (snooze presets) | M-COMMIT-01 | `commitments/index` | Built |
| `S:settings/AndroidNotifications.tsx` (with P:02 2.13) | M-ANI-01…04 | `settings/android-notifications` | Built |
| S subscription status IA (F-03) | M-SUB-01 | `settings/subscription` | Built |

Screens with no reference in either archive were designed from the requirement with `@da/ui` only: export (`settings/privacy/export`), account deletion (`settings/privacy/delete-account`), the public web ([`apps/web`](../apps/web)) and the backoffice ([BACKOFFICE.md](BACKOFFICE.md)).

## Deviation log as built

Each row is a DESIGN_AUDIT §7 entry and how it stands in the code.

| ID | Deviation (short) | As built |
| --- | --- | --- |
| DEV-01 | Informational tertiary text uses `ink/tertiary-strong` | Applied: light `#6F6C66`; dark `#938F87` (the audit's `#8F8B83` measured 4.29:1 on the dark page, below AA) |
| DEV-02…DEV-09 | Stronger critical, AI-kicker, on-glow, segmented, idle-icon, radio, switch-off and warning colours | Applied in `palette.ts`; each pair is in the contrast test |
| DEV-10 | Swipe-right track `#1E7A47` | Applied; the same value is the light success icon colour on soft tiles |
| DEV-11 | Inactive tab `#6F6C66` | Applied (`tabBar.inactive` = tertiary-strong) |
| DEV-12…DEV-14 | Dawn/dusk text opacity and end colour; dark toast; ink surfaces in dark | Applied in the tokens |
| DEV-15 | SVG icons instead of variable-font axes | Applied |
| DEV-16 | Aliases for missing icon names | Applied in `icons.manifest.json` (for example `auto_awesome` → `star_shine`) |
| DEV-17 | Geist on all mobile text; Android widgets use the system font | Applied in the app and Android widgets; the iOS widget extension also uses the system font (DESIGN_AUDIT §4.10 expected Geist bundled there) |
| DEV-18 | Dates computed relative to now in the user's time zone | Applied (date-fns with `@date-fns/tz`; every demo-seed timestamp is relative to today in Europe/Istanbul) |
| DEV-19 | No drawn device chrome; safe areas, edge-to-edge, back behaviour | Applied |
| DEV-20 | Blurred tab bar on iOS, opaque on Android | Differs: opaque `surface` with a top hairline on both platforms (`expo-blur` is not used) |
| DEV-21 | Toast offset above the tab bar or sticky footer | Applied (tab bar height + 14) |
| DEV-22, DEV-23 | 44 pt / 48 dp hit targets; minimum heights instead of fixed heights | Applied; the route a11y suite checks hit targets |
| DEV-24 | Search icon in the Today header | Differs: global search is reached from the Assistant home header and from mail, memory and person screens; the Today header has the approvals pill and the avatar |
| DEV-25 | Avatar only on Today | Differs: Flow and Plan headers also show the avatar (to settings) |
| DEV-26 | Mail Intelligence entry row at the top of Flow | Applied for the Tümü and Mail filters |
| DEV-27 | Commitment and task rows on the Plan timeline + open-commitments row | Applied |
| DEV-28, DEV-29 | Seven approval statuses; Kaynak, Hesap and Yan etki rows | Applied (`ApprovalCard`, `APPROVAL_STATUS_VALUES`) |
| DEV-30 | Tap-only voice approval with the hint "Onaylamak için karta dokun." | Applied (`approved_via='voice_card'`) |
| DEV-31 | Reminder rows select; sticky "Hatırlatıcıyı Kur · {zaman}"; "Kendin seç" | Applied |
| DEV-32 | Retention adds "Silene kadar" | Applied |
| DEV-33 | Truthful privacy copy | Applied with the shipped wording, e.g. first analysis "Genelde 20–40 saniye sürer. Mail içeriğinin tamamı saklanmaz." and capture "Belge güvenli sunucumuzda analiz edilir; dosya 24 saat içinde silinir, yalnızca çıkarılan öğeler saklanır." |
| DEV-34 | Paywall: store prices, trial only if eligible, AI limit row, extra rows, legal links | Applied; "Aboneliği Yönet" lives on the subscription screen, the paywall has restore, terms and privacy |
| DEV-35 | Appearance Sistem / Açık / Koyu (default Sistem), no Deutsch, working text size | Applied |
| DEV-36 | Split connect steps, permissions and VIP steps, counter "ADIM n / 6" | Steps applied; the step kicker reads "Adım n / 4" (mail, calendar and permissions share step 1) |
| DEV-37 | "Günaydın" without a name before sign-up | Applied |
| DEV-38 | Store and ad copy fixes | Not applicable yet: store screenshots and ads are not produced in the repository |
| DEV-39 | Provider handoff for the original mail | Applied (`webLink` in the overflow sheet and source line) |
| DEV-40 | Join variant of `CountdownPill` and maps handoff | Applied (allow-listed conferencing URLs only) |
| DEV-41 | "İLGİLİ DOSYALAR" only when attachments exist | Section built; the server sends no attachment metadata yet (`relevant_files` is empty), so it never shows |
| DEV-42 | Person open loops + "Tüm iletişimi gör" | Applied |
| DEV-43 | Per-row disable, global "Etkileşimlerimden öğren", "Kural Ekle" to Priority Rules | Applied |
| DEV-44 | VIP suggestion "Şimdi değil" | Applied |
| DEV-45 | Plan "Planla" → proposal sheet → approval | Applied (M-PLAN-03) |
| DEV-46 | Conflict options without invented availability; "Beni hatırlat, kendim çözeyim" | Applied; attendee availability is always reported as unknown (no free/busy lookup is built) |
| DEV-47 | "Dosya" tile accepting PDF, images and text | Applied; mail attachments are not offered as a source |
| DEV-48 | Product links: memory save and reminder only | Applied (no price tracking exists) |
| DEV-49 | 5 s client-side undo before approvals are sent; compensating actions after | Applied in `ApprovalSheet` (R-06) |
| DEV-50 | Weekly share in 4:5 and 9:16 | Applied |
| DEV-51 | Evening confirmation sheet, per-item "Yarına taşı", success | Applied |
| DEV-52 | Draggable scrubber; mini-player docked above the tab bar | Scrubber applied; the mini-player is not mounted |
| DEV-53 | Dead affordances removed | Applied: no briefing share icon; the empty follow-up state's dead "Tamam" is replaced by a real action ("Taahhütleri Gör") |
| DEV-54 | Settings hub rows About, delete account, Android notifications, profile | Applied |
| DEV-55 | Ink CTA becomes dark primary in dark mode | Applied in the tokens |
| DEV-56 | One sheet component in the sheet host; route sheets render the same component | Applied (`SheetHost`; `reminders/new` is a transparent-modal route) |
| DEV-57 | Gradients with `expo-linear-gradient` + SVG radial | Differs slightly: both linear and radial gradients are drawn with `react-native-svg` (`GradientFill`); `experimental_backgroundImage` is not used |
| DEV-58 | Travel time only from a source | Applied (no travel estimates anywhere) |
| DEV-59 | No read receipts | Applied |
| DEV-60 | Facts only with a source reference | Applied server-side by the grounding verifier ([AI_PIPELINE.md](AI_PIPELINE.md)) |
| DEV-61 | Call data only as user notes | Applied (no telephony source) |
| DEV-62 | "AI önerisi" chip and grounded rewording | Rewording applied ("hepsi zamanında öne çıkarıldı", "Yanıtın {name} kişisine gönderildi."); suggestions are labelled "Önerilen" (Plan: "Önerilen · henüz gerçek değil") instead of an "AI önerisi" chip |
| DEV-63 | Draft attachments only from real files | Applied |
| DEV-64 | No "Kapıya Not Bırak"; "Cüzdana Ekle" only with a wallet link | "Kapıya Not Bırak" removed; no wallet action is offered at all |
| DEV-65 | Done variant of the Today hero at 0 items | Applied with the copy "Bugün her şeyi kapattın." |
| DEV-66 | Neutral TAKVİM badge | Applied: only ACİL, SON TARİH and GÜVENLİK carry colour (`today/badges.ts`) |
| DEV-67 | Dark mode on every screen | Applied; the route a11y suite renders every route in dark mode |
| DEV-68 | At most one `AiCard` on Today | Differs: no separate AI card; conflicts and schedule suggestions appear among the priority cards |
| DEV-69 | Backoffice and web in the PRIMARY language | Applied (`@da/design-tokens` CSS in both apps) |

## Differences from the plan

The rows marked "Differs", "Partial" and "Not produced" above are the differences from DESIGN_AUDIT and SCREEN_AND_FLOW_MAP. Their reasons:

| Difference | Reason |
| --- | --- |
| DEV-20 blur, DEV-57 gradient library | Fewer native dependencies; the kit's `TabBar` accepts a blur background if one is added later. |
| DEV-24, DEV-25 header entries | The Today header was kept to the approvals pill and avatar; search moved to the Assistant home, where questions and search sit together. |
| DEV-36 step counter | The connect and permission screens form one step in the shipped copy. |
| DEV-41, DEV-46 | The server has no attachment metadata for meeting prep and no free/busy lookup (KNOWN_PLATFORM_LIMITATIONS KPL-46); the UI never invents either. |
| DEV-52 mini-player, P:08 staged briefing opening | Not wired in the shell; the full-screen player and the plain stack transition are used. |
| DEV-62 "Önerilen" label | One label for every unconfirmed suggestion, matching the Plan proposal kicker. |
| DEV-64 wallet action | No wallet-pass detection exists, so the action is never offered rather than offered conditionally. |
| DEV-68 AI card | Conflict and schedule insights reuse the priority card, ranked with everything else. |
| DEV-17 iOS widget font | The widget extension uses the system font; no font files are bundled into the extension. |
| P:09 assets, DEV-38 | Store screenshots and social assets are rendered by the owner from demo builds before submission. |

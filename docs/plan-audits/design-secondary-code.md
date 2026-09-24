## Screen registry

**How navigation works in the prototype.** `NavigationContext` keeps one stack in `useState` (`{screen, params, history[]}`). `navigate()` always pushes, even when switching tabs. `goBack()` pops, or falls back to `'today'`. **`params` is never passed or read**, so every detail screen shows `mock[0]`. `App.tsx` routes with a `switch(screen)`. `BottomNav` shows only when `MAIN_TABS = ['today','flow','plan','assistant']` contains the screen. `NO_BOTTOM_NAV` is declared and never used. `AppWrapper` renders `landing` outside `MobileFrame` (393×852, radius 48). The default case renders `TodayScreen`. `react-router-dom@^7.18.3` is installed but unused. There are no deep links, no auth gate, and no persistence.

**Screen ids declared in `ScreenName` that have no route:** `onboarding-welcome|noise|proactive|control|account|connect|permission|calendar-permission|preferences|personalization|vip|analysis|aha|notification` (these are internal step state inside `OnboardingFlow`), `smart-reminder` (it is the `SmartReminderSheet` component), and `why-important` (a sheet inside `InsightCard`). Navigating to any of them falls through to Today.

| # | File | Route id | Reached from | Purpose | Key interactions | PRIMARY coverage (confirmed by grep) |
|---|---|---|---|---|---|---|
| 1 | screens/SplashScreen.tsx | `splash` | Initial state | Brand splash: "Dijital Asistan" / "Bugün bilmen gerekenleri, sen sormadan söyler." | Auto `navigate('onboarding')` after 2200 ms on every launch; no session check | SECONDARY-ONLY. Use a native `expo-splash-screen`; the brand moment is 2.1 |
| 2 | onboarding/OnboardingFlow.tsx | `onboarding` (14 internal steps) | Splash; Landing CTAs | Full onboarding | See the onboarding step table below | 02 (2.1–2.12) |
| 3 | today/TodayScreen.tsx | `today` (tab) | Tab; default; all "Bugüne Dön" buttons; Paywall CTAs; end of onboarding | Home: hero briefing card, "Önceliklerin", "Programın", "Dijital Hayatın", midday/evening shortcuts, weekly teaser | Header: ⭐ approvals badge (hardcoded `3`), search, avatar; InsightCards; reminder sheet; life-detail sheet | 03 3.1 Light / 3.2 Dark ("ÖNCELİKLERİN", "BRİFİNG HAZIR · 07:58", "2 onay" pill) |
| 4 | today/MorningBriefing.tsx | `morning-briefing` | Today hero card, "Dinle", "Brifing Aç"; Landing "▶ Demo Gör" | Dark full screen: greeting, narrative, fake audio player, 6 section rows | Play/pause, speed 1→1.25→1.5, ±"15", seek bar | 03 3.3 / 3.3D (dawn gradient, Lora narrative) and 3.4 Sesli Brifing (chapter list) |
| 5 | today/MiddayPulse.tsx | `midday-pulse` | Today "Gün Ortası · 13:00 brifing" | "Sabahından beri 2 önemli gelişme oldu." (2 delta cards) | Action buttons are dead; "Bugüne Dön" | 03 3.5 Öğle Nabzı; 07 7.6 Pro gate |
| 6 | today/EveningClose.tsx | `evening-close` | Today "Akşam Kapanış · 19:00 özet" | "Bugünden yarına 3 konu kalıyor." with completed list, carry-overs, tomorrow morning, follow-ups | "Yarına taşı" works on local state only; "Yarına Hazırım ✓" is dead | 03 3.6 Akşam Kapanışı (+ 3.2 evening hero) |
| 7 | marketing/WeeklyReport.tsx | `weekly-report` | Today teaser "Haftalık Raporun Hazır"; Profile › Diğer | "Haftan Nasıl Geçti?": time saved, 5 stats, busiest day, top contacts, share card | "Paylaş" is dead | 03 3.7 Haftalık Özet · Editoryal; 3.8 "Dijital Haftam" 1080×1350 |
| 8 | flow/FlowScreen.tsx | `flow` (tab) | Tab | Attention feed of 8 inline items (not the mock arrays); 6 filter chips | Chips filter; card tap → email-detail / meeting-prep; all per-card action buttons are dead | 04 4.1 Akış · Tümü; 4.2 Kişisel · Dark |
| 9 | flow/MailIntelligence.tsx | `mail-intelligence` | Flow header "Mail Özeti" | "83 mail bugün / 6 tanesi dikkat gerektiriyor." with 6 categories and "ÖNE ÇIKANLAR" | Category tap filters, or navigates (the two reply categories are wired backwards) | 04 4.3 Mail Zekâsı |
| 10 | flow/EmailDetail.tsx | `email-detail` | Today "Yanıtı Gör"; Flow email card; MailIntel rows; WaitingReply "Maili Aç"; Commitments "Kaynağı Gör"; MeetingPrep "Son E-postalar"; Search | "AI ÖZETİ", "ÖNEMLİ NOKTALAR", SourceTag, 2×2 actions, "Orijinal Maili Aç" | Yanıt Hazırla / Görev Oluştur sheet / Takvime Ekle (→ Plan tab) / Hatırlat sheet / Gmail handoff sheet | 04 4.4 Mail Detayı (original mail expands inline in primary) |
| 11 | flow/AIDraftReply.tsx | `ai-draft-reply` | EmailDetail; SmartFollowUp "Takip Mesajı Hazırla"; WaitingReply "Yanıtla" | Tone chips, To field (hardcoded Ahmet), editable textarea, confirm sheet, success overlay, fake "Gmail açılıyor…" screen | See interaction coverage | 04 4.5; 06 6.2 inline draft card |
| 12 | flow/SmartFollowUp.tsx | `smart-followup` | MailIntel "Cevap Bekleyen" (wrong wiring) | "Takip Etmen Gerekenler": people who have not answered you | Takip Mesajı Hazırla / Hatırlat / Kapat | 04 4.6 Akıllı Takip |
| 13 | flow/WaitingReply.tsx | `waiting-reply` | MailIntel "Cevap Beklediğin" (wrong wiring) | "Senden Beklenenler" grouped ACİL / BUGÜN / YAKINDA | Maili Aç / Yanıtla / 🔔 | 04 4.7 |
| 14 | plan/PlanScreen.tsx | `plan` (tab) | Tab; EmailDetail "Takvime Ekle" | Gün/Hafta segment, static date strip, AI suggestion banner, hourly timeline 08–18, conflict banner | Planla sheet; Çöz; Taahhütler | 05 5.1 / 5.1D / 5.2 Hafta + Takvim Zekâsı |
| 15 | plan/MeetingPrep.tsx | `meeting-prep` | Today insight "Hazırlan", Today program rows, Flow meeting card, Plan timeline, Search | Gradient hero, "TOPLANTIDA KONUŞMAN GEREKEN 3 ŞEY", person card, 4 sections, note, CTAs | Person → person-intelligence; Son E-postalar → email-detail; "2 Dk Özet" → post-meeting (wrong target); "Toplantıyı Başlat" → fake Meet screen | 05 5.4 / 5.5; 5.6 "2 Dakikalık Özet · Okuma görünümü" |
| 16 | plan/PostMeeting.tsx | `post-meeting` | MeetingPrep "2 Dk Özet" (mislabeled) | "Toplantın bitti." with free-text commitment capture | Any text shows the same hardcoded "Mehmet'e teklif gönder"; "Kaydet" shows fake success | 05 5.7 (voice input + 2 detected commitments) |
| 17 | plan/CalendarConflict.tsx | `calendar-conflict` | Plan banner "Çöz" | Conflict card, AI suggestion, 3 options | Only the recommended option works, and it shows a fake "Çözüldü!" | 05 5.3 (4 options; "Seçtiğin çözüm onayına sunulur, otomatik uygulanmaz.") |
| 18 | plan/CommitmentTracker.tsx | `commitments` | Plan header "Taahhütler" | Commitment list with status badge, KİME/TARİH, "Kaynak:" line | Tamamlandı / Ertele sheet / Kaynağı Gör | 04 4.8 Taahhütler (primary puts it under Akış) |
| 19 | assistant/AssistantScreen.tsx | `assistant` (tab) | Tab | Empty state "Dijital hayatına sor." with 6 suggested questions, chat bubbles, input bar | Canned keyword replies; "+" → capture; mic → voice | 06 6.1 / 6.1D / 6.2 zengin kartlı yanıt |
| 20 | assistant/VoiceAssistant.tsx | `voice-assistant` | Assistant header mic; input mic | Dark voice mode: idle → listening → processing → responding | Fake timers and a canned answer | 06 6.3 Dinliyor / 6.4 Yanıt + yazma onayı |
| 21 | settings/ProfileScreen.tsx | `profile` | Avatar on Today, Flow and Plan headers | Profile card (Yunus, yunus@example.com, PRO "14 gün kaldı"), 7 setting groups, "Çıkış Yap" | Row navigation; sign-out is dead | 07 7.1 Profil ve Ayarlar |
| 22 | settings/Integrations.tsx | `integrations` | Profile › Entegrasyonlar; Security › Bağlı Hesaplar | 8 providers with Bağla / Kaldır | Instant fake connect/disconnect | 02 2.6 + 07 7.2 "BAĞLI HESAPLAR · 2" (partial). Google Tasks / Microsoft To Do / Apple Reminders rows are SECONDARY-ONLY (they are required by master §75) |
| 23 | settings/SecurityPrivacy.tsx | `security-privacy` | Profile › Gizlilik ve Güvenlik | "TAAHHÜTLER" trust box, 3 groups, 5 sheets | See interaction coverage | 07 7.2 Gizlilik Merkezi + 7.4 Veri Saklama ve Silme |
| 24 | settings/AIPersonalization.tsx | `ai-personalization` | Profile; Security › AI Kişiselleştirme | "Dijital Asistan beni nasıl tanıyor?": 5 learned prefs, learning toggle | Edit priority / disable / delete (local only) | 06 6.9 (grouped KİŞİLER / KONULAR / TERCİHLER, each with provenance) |
| 25 | settings/DataSourceControl.tsx | `data-source-control` | Profile; Security › "AI'ın Erişebildiği Veriler" | Per-source capability toggles (Gmail ×4, Google Takvim ×3) | Local toggles | 07 7.3 (primary uses per-data-type toggles plus a "HİÇBİR ZAMAN OKUMAZ" list; the per-source axis is secondary-only) |
| 26 | settings/VIPPeople.tsx | `vip-people` | Profile › VIP Kişiler | List of 5 people with VIP toggle | Row → person-intelligence; toggle bubbles up to the row (bug) | 06 6.6 Önemli Kişiler (groups + AI suggestion) |
| 27 | shared/ApprovalCenter.tsx | `approval-center` | Today header ⭐ badge; every UniversalCapture result button | "Onay Bekleyenler": NE YAPILACAK / NEDEN / DEĞİŞİKLİK cards | Onayla / Düzenle sheet / Reddet (local only) | 06 6.8 (plus Geçmiş, "BUGÜN ONAYLANANLAR") |
| 28 | shared/SearchScreen.tsx | `search` | Today header search icon | "SON ARAMALAR", "ÖRNEK ARAMALAR", keyword-map results | Hardcoded match | 06 6.5 AI Hafıza · Anlamsal arama (reached from Asistan header "Hafıza" in primary) |
| 29 | shared/PersonIntelligence.tsx | `person-intelligence` | MeetingPrep person card; VIPPeople rows; Search | Gradient hero with 3 stats, AÇIK KONULAR, SON KONUŞULAN KONULAR, "AI'ya sor" input | Input is dead | 06 6.7 Kişi Zekâsı (SENDEN BEKLEDİKLERİ / SENİN BEKLEDİKLERİN / SON İLETİŞİM) |
| 30 | shared/UniversalCapture.tsx | `universal-capture` | Assistant input "+" | "Dijital Asistan'a Ekle": Fotoğraf/PDF/Link tiles, text box, fake analyze, result | Fake; always detects "12 Eylül · 20:00 · Zorlu PSM" | 04 4.10–4.14d (screenshot, bill photo, PDF, link, text: input → analyzing → detected → approval) |
| 31 | marketing/Paywall.tsx | `paywall` | Profile › Abonelik; Landing pricing "Başla" | Hero, 9 benefits, Yıllık 1.490 TL / Aylık 199 TL, CTA | CTA → Today (fake purchase) | 07 7.5 Paywall; 7.6 Bağlamsal Pro kapısı |
| 32 | marketing/Referral.tsx | `referral` | Profile › Diğer | "İkiniz de 14 gün Pro kazanın.", link, share buttons, stats | All buttons dead | 07 7.7 |
| 33 | marketing/WidgetShowcase.tsx | `widget-showcase` | Profile › Tasarım Sistemi | Small / medium / large / lock-screen widget mocks | None | 08 widgets (iOS small 158×158, medium 338×158, large 338×354, lock screen; Android 4×2, 2×2) |
| 34 | marketing/AppStoreScreenshots.tsx | `appstore-screenshots` | Profile › Tasarım Sistemi | 6 store screenshot concepts | Export buttons dead | 09 "MAĞAZA · 6 EKRAN · 1290×2796" |
| 35 | marketing/SocialAds.tsx | `social-ads` | Profile › Tasarım Sistemi | 3 ads at 9:16 | Selector works; PNG/MP4 export dead | 09 ads (3 × 9:16) |
| 36 | marketing/Landing.tsx | `landing` (rendered outside the phone frame) | Profile › Tasarım Sistemi › Landing Page | Responsive web landing: nav, hero, integrations, 6 features, pricing, CTA | CTAs → onboarding / morning-briefing / paywall. No back button, so the user is trapped | SECONDARY-ONLY (primary has no website design; the hero copy appears in the index file and in 09) |
| 37 | states/EmptyStates.tsx | `empty-states` | Profile › Tasarım Sistemi | 5 empty-state variants | CTAs dead | 08 "BOŞ DURUMLAR" (4 variants) |
| 38 | states/ErrorStates.tsx | `error-states` | Same | 6 error variants | Fake retry | 08 "HATA DURUMLARI" (4 variants + full-screen offline) |
| 39 | states/LoadingStates.tsx | `loading-states` | Same | AI processing, sync bar, 3 skeletons, full refresh | Animations only | 08 loading/today skeleton |
| 40 | settings/AndroidNotifications.tsx | `android-notifications` | Profile › Diğer | "Telefon Bildirimleri": master toggle, all/selected mode, 8 apps, 4 rules, privacy note | Local toggles; hooks-in-`map` bug | 02 2.13 Android · Telefon Bildirimleri (category list; messaging off by default) |
| 41 | marketing/AndroidFrame.tsx | `android-frame` | Profile › Diğer | 412 px Android frame with a Today snapshot | None | SECONDARY-ONLY; drop it (prototype artifact) |
| 42 | marketing/NotificationExamples.tsx | `notification-examples` | Profile › Tasarım Sistemi | 6 notification copy types plus "BİLDİRİM İLKELERİ" | None | Partial: 02 2.12 shows 3 examples. As a catalog it is SECONDARY-ONLY |
| 43 | states/DesignSystem.tsx | `design-system` | Same | Swatches, type, badges, buttons, chips, radius, spacing, shadows, avatar, SourceTag | None | 01 Tasarım Sistemi (supersedes it) |
| 44 | states/IAPage.tsx | `ia-page` | Same | IA diagram | None | "Dijital Asistan.dc.html" › BİLGİ MİMARİSİ (doc only) |
| 45 | states/UserFlows.tsx | `user-flows` | Same | 6 flow diagrams and "TEMEL AKIŞ KURALLARI" | None | Doc only (index "PROTOTİPTE DENE") |
| 46 | settings/BriefingSettings.tsx | `briefing-settings` | Profile › Brifing Ayarları | 3 time pickers (±1 h, ±15 min), weekend toggle, "Saat Dilimi", "Sessiz Günler" | Local | 02 2.9 "Günün ritmi" (onboarding) + 7.1 row "Brifing · 08:00 · 13:00 · 19:00". The settings screen itself is SECONDARY-ONLY |
| 47 | settings/NotificationSettings.tsx | `notification-settings` | Profile › Bildirimler | Akıllı Filtre, 3 briefing toggles, 4 instant-notification toggles, Life Intelligence toggle | Local | SECONDARY-ONLY (7.1 has only the row "Bildirimler · Sadece önemli") |
| 48 | settings/PriorityRules.tsx | `priority-rules` | Profile › Öncelik Kuralları | Chip/list CRUD: VIP people, domains, keywords, 4 low-priority toggles | Local | 07 7.9–7.12 (condition + result + preview, edit, delete with undo). Primary supersedes |
| 49 | settings/AppearanceSettings.tsx | `appearance` | Profile › Görünüm | System/Açık/Koyu + preview | `setMode` (in memory) | 07 7.8 (+ Metin boyutu, Hareketi azalt, Haptik geri bildirim) |
| 50 | settings/LanguageSettings.tsx | `language` | Profile › Dil | Türkçe selected; 4 languages "Yakinda"; date/time format rows | No handlers | 07 7.8 (Türkçe / English / Deutsch) |
| 51 | settings/HelpScreen.tsx | `help` | Profile › Yardım | 4 sections of help rows, support e-mail reveal, version box | Every article opens a placeholder sheet | SECONDARY-ONLY (7.1 row "Yardım" only) |
| 52 | settings/FeedbackScreen.tsx | `feedback` | Profile › Geri Bildirim; Help › "Hata Bildir" | Type (bug/feature/general), 1–5 stars, message, optional e-mail | Fake submit | SECONDARY-ONLY (7.1 row "Geri Bildirim" only) |

**Onboarding internal steps** (`order[]`, progress bar has 14 segments):

| Step | Turkish copy | PRIMARY |
|---|---|---|
| welcome | "Dijital hayatın artık tek yerde." / "Mailini, takvimini ve açık işlerini anlayıp her gün sana kısa bir brifing hazırlar." / "Başlayalım" / "Devam ederek Gizlilik Politikası'nı kabul etmiş olursunuz." | 2.1. Primary copy wins: "Bugün bilmen gerekenleri, sen sormadan söyler." + "Zaten hesabın var mı? Giriş yap" |
| noise | "Gürültüyü azalt." / "127 mail" → "3 önemli konu" | 2.2 (+ "Atla") |
| proactive | "Gününü sen sormadan hazırlarız." | 2.3 |
| control | "Kontrol her zaman sende." (4 bullets) / "Anladım" | 2.4 (real approval card visual) |
| account | "Hesap oluştur" with Google / Apple / Microsoft / "E-posta ile devam et" (all just call onNext) | 2.5 "Hesabını oluştur" (Apple first on iOS, Google first on Android) |
| connect | "Dijital hayatını bağla." / "En az 1 mail + 1 takvim bağla." (5 selectable rows, no OAuth) | 2.6 "ADIM 1 / 4", "Devam · 2 hesap bağlı" |
| permission | "Gmail erişimine neden ihtiyacımız var?" (shown even when Outlook was picked) | 2.7. 2.7b Outlook explainer is missing in secondary |
| calendar-permission (+ denied variant) | "Takvimine neden erişmemiz gerekiyor?"; denied: "Takvim erişimi kapalı" + `alert('Ayarlar açılıyor...')` | 2.7c. The denied state is SECONDARY-ONLY |
| preferences | "Günün ne zaman başlıyor?" 07:30 / 13:00 / 19:00 + weekend toggle | 2.9 "Günün ritmi" 08:00 / 13:00 / 19:00; weekend "Sadece sabah, 10:00" |
| personalization | "Senin için neler daha önemli?" İş, Aile, Finans, Seyahat, Alışveriş, Randevular, Son Tarihler, Hepsi | 2.8 same 8 options. In primary "Hepsi" selects all; in secondary it deselects the others |
| vip | "Kimlerden gelen şeyleri asla kaçırmak istemezsin?" (hardcoded 7 including "Anne / Baba", "Yönetici") | SECONDARY-ONLY (master §34 step 11) |
| analysis | "Dijital hayatın analiz ediliyor…" 5 steps × 1000 ms, then auto-advance | 2.10 |
| aha | "Hazır." / "Son 72 saatte bilmen gereken 5 şey bulduk." / "Brifingimi Gör" | 2.11 |
| notification | "Sadece önemli olduğunda haber verelim." / "Bildirimleri Aç" / "Şimdi Değil". Both buttons go to Today with no OS prompt | 2.12 ("Günde ortalama 3 bildirim.", "Daha sonra") |

**Sheets and overlays (not routes):**
- `InsightCard` "Neden önemli?" sheet. Primary instead uses a "···" correction menu: "Önemli değil · Daha sık göster · VIP yap · Takip etme".
- `SmartReminderSheet` "Hatırlatıcı" → primary 4.11.
- Today life-detail sheet → SECONDARY-ONLY.
- EmailDetail: "Orijinal Mail" handoff sheet, "Görev Oluştur" sheet.
- AIDraftReply: "Son Onay" sheet, "Gönderildi!" overlay.
- Plan: "AI Öneri" sheet.
- MeetingPrep: fake Meet handoff screen.
- CommitmentTracker: "Ertele" sheet.
- ApprovalCenter: "Eylemi Düzenle" sheet.
- SecurityPrivacy: İzinler, Veri Saklama, Geçmişi Sil, Verilerimi İndir, Hesabımı Sil.
- AIPersonalization: "Tercihi Düzenle" sheet.
- Help: article sheet (placeholder).

## Domain types & mock data

**`types.ts` → real entities.** Master §77 tables and §97 provenance fields apply. None of the secondary types carry `source_type`, `source_id`, `source_provider`, `source_timestamp`, `confidence`, `user_id`, `account_id`, or ISO timestamps. Every time value is a display string ("08:42", "Dün", "Bugün 17:00").

| Type (fields) | Real entity / table | Missing / wrong |
|---|---|---|
| `Priority = 'critical'\|'upcoming'\|'deadline'\|'info'\|'success'` | `insights.urgency` + `insights.kind` | Mixes urgency with category. The primary taxonomy is ACİL, SON TARİH, TAKİP, TOPLANTI, KİŞİSEL, TAKVİM, GÜVENLİK, TAAHHÜT, KARGO, UÇUŞ, ÖDEME, ABONELİK, REZERVASYON, ONAYLANDI, BEKLİYOR, PRO, BUGÜN. Split into `urgency` (urgent / normal / low) and `kind` enum |
| `InsightItem {id, priority, title, source, sourceIcon, time, actions: string[], whyImportant?}` | `insights`, `briefing_items` | `source` is a concatenated string ("Gmail · Ahmet Yılmaz · 08:42"); needs the 5 provenance fields plus `entity_type/entity_id` (email_thread / calendar_event / life_event / commitment). Actions are UI label strings; need typed `{action_type, target_id, requires_approval}`. Missing `status` (open/done/dismissed/snoozed), `due_at`, `rank_score`, `reason_code` / `rule_id` (explainability, §31), `created_at`, feedback link (`ai_feedback`) |
| `EmailItem {id, sender, senderInitials, subject, preview, time, priority, category: 'important'\|'awaiting-reply'\|'deadline'\|'info'\|'low', aiSummary, keyPoints[], isRead}` | `email_threads` + `email_messages` + an analysis table | Needs provider message/thread id, `connected_account_id`, from/to/cc addresses, `received_at`, labels, `has_attachments`, provider web link (for "Orijinal Maili Aç"), `deadline_at`. The category enum lacks "Senin Cevap Beklediğin" (the screen invents key `my-awaiting`). Master §14 names: Önemli / Senden Cevap Bekleyen / Senin Cevap Beklediğin / Son Tarih İçeren / Bilgilendirme / Düşük Öncelik. Classification needs `confidence`, `reason`, `rule_id` |
| `MeetingItem {id, title, person, time, duration, platform, minutesLeft?, lastContact?}` | `calendar_events` | Needs `start_at` / `end_at` (UTC + tz), provider event id, calendar/account id, attendees[], organizer, location, conferencing URL (Meet/Zoom/Teams deep link), status, etag. `person` is a single string. `minutesLeft` and `lastContact` should be derived values, not stored |
| `LifeItem {id, type: 'cargo'\|'flight'\|'reservation'\|'payment'\|'subscription'\|'security', title, detail, time, icon, action}` | `life_events` | Types match master §23 (rename cargo → shipment). Needs structured extracted fields (amount + currency, due_date, carrier, tracking_no, flight_no, dep/arr, PNR, venue, party_size), provenance, `confidence`. Master: show amount or deadline only when the source states it. `icon` is an emoji; use an icon token |
| `CommitmentItem {id, commitment, to, source, date, status: 'pending'\|'done'\|'overdue'}` | `commitments` | Needs `contact_id`, `direction` (user_owes / they_owe), `due_at`, `quote_text`, provenance, `confidence` (master §18), `snoozed_until`. Primary statuses: GECİKMİŞ / BUGÜN / AÇIK / TAMAMLANDI |
| `Person {id, name, initials, role, lastContact, openLoops, upcomingMeeting?, isVip}` | `contacts` + `vip_people` | Needs emails[], organization, VIP group (EŞ·AİLE / YÖNETİCİ / MÜŞTERİ / ARKADAŞ, from 6.6), `last_contact_at`. Open loops should be computed |
| `ApprovalItem {id, action, what, why, change, type: 'send-email'\|'create-event'\|'move-event'\|'create-task'\|'set-reminder'}` | `approval_actions` | Map to master §33 types: email_send, calendar_create, calendar_update, task_create, reminder_create; commitment_create is missing. Needs status lifecycle (pending / approved / rejected / executing / executed / failed / expired), structured `payload` (the exact change), destination account, `source_*`, `idempotency_key`, `expires_at`, `executed_at`, `error`. `change` is free text |
| `NavState {screen, params?}`, `ScreenName` (69 ids) | expo-router route table | params unused |

**`mock.ts` contents:**
- `mockInsights` ×4:
  - Ahmet revize teklif 17:00 (critical; actions `['Yanıtı Gör','Hatırlat','Tamamlandı']`)
  - 14:30 Mehmet toplantı (`['Hazırlan']`)
  - Başvuru 17:00 (`['Takvime Ekle']`)
  - Ayşe sunum (`['Görüntüle']`)
- `mockEmails` ×6: Ahmet (critical / awaiting-reply), Fatma Q3, Can toplantı, Netflix "149.99 TL", Mehmet (critical / deadline), Ayşe.
- `mockMeetings` ×3, not in time order: 14:30 (minutesLeft 18), 10:00, 16:00.
- `mockLifeItems` ×6: Trendyol #TY884521, TK2412, Elektrik 1.842 TL / 10 Eylül, Netflix 149,99 TL / 9 Eylül, Nusr-Et Beşiktaş Cumartesi 20:30 4 kişi, Google yeni giriş.
- `mockCommitments` ×4.
- `mockPeople` ×5 (3 VIP).
- `mockApprovals` ×3.
- Untyped:
  - `mockFollowUps {id, person, initials, topic, lastMessage, status, daysWaiting}` → "they owe" follow-ups, derived from outbound threads with no reply (insights kind=`followup`).
  - `mockWaitingReplies {…, expectation, deadline, waitingHours, urgency: 'acil'|'bugun'|'yakinda'}` → "user owes".
  - `weeklyStats {mailsAnalyzed:684, importantFound:32, followupsReminded:8, meetingsTracked:21, deadlinesCaught:4, timeSaved:'2 sa 48 dk', busiestDay:'Salı', topContacts[3]}` → a computed weekly review (`briefings` kind=weekly).

**Inline per-screen data shapes.** These are not in `types.ts`, and most should become real entities:
- Flow `FeedItem` (8 inline items; the imported mocks are unused).
- Search `SearchResult` (a keyword map).
- Assistant `Message {role, text, card?{type: email|calendar|person, title, detail}}` → `assistant_threads` / `assistant_messages` plus source cards.
- AIPersonalization prefs `{text, priority: high|normal|low, enabled}` → learned preferences. These lack provenance; primary shows "3 kez 'önemli değil' dedin".
- DataSourceControl `Source {permissions[{id,label,enabled}]}` → per-account capability flags.
- Integrations `{id, label, account, connected}` → `connected_accounts`.
- AndroidNotifications apps `{name, enabled, priority}`.
- Notification settings booleans → `notification_preferences`.
- Briefing settings `{hour, min, on}×3, weekend, silentDays[7]` → `user_preferences`.
- PriorityRules people[], domains[], keywords[], 4 category toggles → `priority_rules`.
- Retention options.
- Feedback `{type, rating, message, email}` → feedback/support.
- Paywall plan monthly/annual.
- Onboarding choices: connected[], categories[], vip[], times, weekend. None of these persist.

**Entities with no model at all:** profile (name "Yunus" and "yunus@example.com" hardcoded), `connected_accounts` / `sync_states`, `tasks`, `reminders`, `captures`, `memory_chunks`, `ai_feedback` (👍/👎), briefings (narrative, sections, audio), `push_tokens`, subscription/entitlement, referral/credits, weekly review, notification log, user timezone.

**Mock-data inconsistencies (do not port):**
- Email #1 sender is Ahmet Yılmaz but `aiSummary` says "Mehmet, revize fiyat teklifinin…".
- Secondary uses "Mehmet Kaya"; primary uses "Mehmet Yılmaz" (Yılmaz Endüstri) with "Ahmet Yılmaz" (Kuzey Lojistik), "Selin Kaya", and others. Primary names win for demo fixtures.
- Today's life-detail sheet contradicts the mock: cargo no. "TY4821930" vs "#TY884521"; reservation "7 Eylül · 20:00 · 2 kişi · Nişantaşı" vs "Cumartesi 20:30 · 4 kişi · Nusr-Et"; Netflix "79 TL/ay · Premium · 12 Eylül 2025" vs "149,99 TL · 9 Eylül"; security "Şifre değişikliği girişimi" vs "yeni giriş".
- Netflix is 229,99 TL in primary.
- Plan timeline puts Mehmet at 14:00; the mock says 14:30.
- The AI block sits at 09:00 "Teklif Hazırlama" while the banner says "Yarın 14:00–16:30".
- Date strip 1–7 highlights Cmt=7, but the header says "Cumartesi, 5 Eylül" (5 Sept is a Saturday in 2026; the secondary's own "1–7 Eylül 2025" and "12 Eylül 2025" contradict that).
- Briefing length is stated as "2 dakikalık", "60 saniyelik", "90 saniye", and "2:00" in different places. Primary: "Dinle · 2 dk".
- Currency formatting is mixed: "149.99 TL" and "149,99 TL". Use `Intl.NumberFormat('tr-TR', {style:'currency', currency:'TRY'})`.
- Profile says "PRO · 14 gün kaldı"; the Paywall says 7-day trial; primary says "Deneme · 5 gün kaldı".

## Tokens in secondary

The source of truth is `index.css` (`@theme inline`) plus `ThemeContext` light/dark objects. Most screens hardcode hex values anyway. PRIMARY = `01 Tasarim Sistemi.dc.html` `COLORS`, `TYPE`, `RADIUS`, `DARK`.

| Role | Secondary | PRIMARY 01 | Delta |
|---|---|---|---|
| Brand | `--color-primary #5B5CE2` | brand/primary `#5B5CE2` | Same |
| Pressed / dark | `#4647C7` (also the gradient stop) | brand/primary-pressed `#4B4CCB`; brand/text-on-soft `#4547C9` | Different |
| Light / glow | `#7879F1`, gradients to `#9596F5` | brand/dark-glow `#A9AAF5`; dark primary `#8586F2` | Different |
| Soft | `#EEEEFF` (also ad-hoc `#F3F3FD`, `#C8C8F0`) | brand/soft `#EDEDFC` | Close |
| App background | `#F8F8FC` (cool) | neutral/bg `#F5F4F0` (warm) | Warm vs cool |
| Surface | `#FFFFFF` | `#FFFFFF` | Same |
| Surface-2/3 | `#F8F8FC` / `#F1F1F8` | surface-2 `#F0EFEB` | Different |
| Border | `#E8E8F0`, `#F2F2F8` | hairline `#E9E7E1` = rgba(27,25,23,.06) | Different |
| Text | `#0F0F1A` / `#6B6B80` / `#A0A0B2` | ink `#1A1917` / `#6B6860` / `#9B978E`; disabled `#B8B4AA` | Cool vs warm |
| Critical | `#FF3B30` / soft `#FFEEED` / text `#C0251B` (iOS system red) | `#E0553F` / `#FCEDE9` / `#C7432F` (coral) | Different |
| Warning | `#FF9F0A` / `#FFF4E0` / `#8C5200` | `#E09A1C` / `#FDF2DC` / `#9A6300` | Different |
| Success | `#34C759` / `#E8F8EE` / `#1A7A33` | `#2FA062` / `#E4F5EA` / `#1E7A47` | Different |
| Info | `#007AFF` / `#E5F2FF` / `#0051A8` | `#3B82E6` / `#E7F0FD` / `#2262BE` | Different |
| Deadline | `#8B5CF6` / `#F0ECFF` / `#5B21B6` (purple) | None: SON TARİH uses warning amber | Purple has no primary equivalent. Remove it |
| Editorial | None | paper `#FBFAF7`; Lora | Missing in secondary |
| Gradients | indigo-gradient `135deg #5B5CE2 0% → #4647C7 60% → #3A3AB5 100%`; hero-gradient `140deg #5B5CE2 → #7879F1 → #9596F5`; Paywall `#5B5CE2 → #3A3AB5` | dawn `160deg #1E1E4C 0% → #3B3CA8 58% → #7071EA 100%` (morning); night `180deg #15153A → #25266A → #3B3CA8` (voice / analysis); dusk `160deg #2A1E3F → #4A3A8A → #8C6BD6` (evening). Today hero is a white card with `radial-gradient(140% 100% at 100% 0%, #E4E4FA 0%, #FFFFFF 58%)` | Secondary uses indigo as decoration on heroes, profile, person, and prep cards. That violates primary Kural 2: "Indigo: AI işaretleri, birincil buton, seçili sekme, bağlantı. Dekor için asla." |
| Badge rule | Every priority gets a colored badge (KRİTİK / YAKLAŞAN / SON TARİH / BİLGİ / TAMAMLANDI), 9 px / 600, `.06em`, radius 6, 1 px tinted border | 11 px / 700, `.05em`, pill 999, padding 3×8. Kural 1: colored badges only for ACİL (coral), SON TARİH (amber), GÜVENLİK (coral), ONAYLANDI (green); everything else is neutral `#F0EFEB` / `#6B6860` | Secondary over-colors |
| Font | Inter (Google Fonts, opsz 14–32, weights 300–800, italic 400/500) | Geist 300–700 (UI) + Lora 400–600 (editorial) + Material Symbols Rounded (icons, 20/24, wght 400, FILL 0; active FILL 1) | Replace Inter and all emoji icons. npm: `@expo-google-fonts/geist@0.4.2`, `@expo-google-fonts/lora@0.4.2`, `@material-symbols/font-400@0.47.5`. RN styles cannot switch the variable FILL axis, so ship static FILL0 and FILL1 instances. That is my inference; check the TTF exists (the unpkg/jsdelivr check was blocked by the proxy) |
| Type scale | DesignSystem screen: Display 32/800, H1 26/700, H2 20/700, H3 17/600, Body 15/400, Caption 13/400, Micro 11/700. Screens use 800/900 widely | display 34/40/600/−2.5%; h1 28/34/600/−2%; h2 22/28/600/−2%; h3 17/23/600/−1%; body 15/22/400; secondary 14/20/400; kicker 12/16/600/+8% caps `#9B978E`; micro 11/14/700/+5%; editorial Lora 18/29; editorial-display Lora 34/40/500 | Primary never goes above 600 except micro badges |
| Radius | xs 6 / sm 10 / md 14 / lg 20; cards 12–16; sheet 24; buttons 10/12/14; frame 48 | 10 icon tile · 12 inline button · 14 button · 16 small card · 20 card · 28 hero/page; pills 999 | Cards 16 → 20; hero 20 → 28 |
| Shadows | xs `0 1px 3px rgba(15,15,26,.05)`; sm `0 2px 8px …07`; md `0 4px 16px …10`; lg `0 8px 32px …14`; card `0 1px 4px …06, 0 2px 12px …04` | shadow-1 `0 1px 2px rgba(27,25,23,.06)`; shadow-2 (card) `0 1px 2px rgba(27,25,23,.04), 0 6px 20px rgba(27,25,23,.05)`; shadow-3 (page) `0 12px 32px rgba(27,25,23,.14)`; hero adds `0 12px 32px rgba(91,92,226,.10)` | Warm ink tint vs cool tint |
| Spacing | 4-px grid [4, 8, 12, 16, 20, 24, 32, 40]; screen gutter 20 | Same; gutter 20 | Same |
| Buttons | Primary uses a gradient (`#5B5CE2 → #4647C7`); heights 32 / 40 / 50 | Primary is solid `#5B5CE2`, h 48, r 14, 15 / 600. Variants: tonal (`#EDEDFC` / `#4547C9`), dark, surface, destructive, ghost. Card actions are text links 14 / 600 (`#4547C9` primary, `#6B6860` secondary). Disabled is opacity .4; loading shows a 16 px spinner | Drop gradients |
| Toggles | 5 different sizes: 51×31, 50×30, 46×28, 44×26, 44×24. Off states `#E8E8F0`, `#E0E0EA`, `#D0D0E0`, `#D1D1DA` | 50×30, r 15, knob 26 (left 2 / 22), on `#5B5CE2`, off `#D9D6D0`, knob shadow `0 1px 3px rgba(0,0,0,.2)` | Standardize on primary |
| Tab bar | h 82, pad 8 / 24, `rgba(255,255,255,.95)` blur 20, label 10 px, active `#5B5CE2`/600, inactive `#A0A0B2`, custom SVG icons | h 90, pad 8/8/28, `rgba(255,255,255,.92)` blur 20, top border rgba(27,25,23,.06), label 11 / 500, icons 26 px Material `sunny` / `dynamic_feed` / `calendar_today` / `auto_awesome` (FILL 1 when active), inactive `#9B978E` | Use primary |
| Source tag | Brand-tinted chip: gmail rgba(234,67,53,.08) / `#C23121` / dot `#EA4335`; outlook `#0072C6`; calendar `#1E7E34` / dot `#34A853`; apple `#0066CC` | Plain row: 16 px Material icon + 12 px `#9B978E` text "Gmail · Ahmet Yılmaz · 08:42" | Use primary |
| Sheet / overlay | radius 24 top, handle 36×4 `#E8E8F0`, overlay rgba(15,15,26,.45) blur 3 px, open `slideUp .3s cubic-bezier(.32,.72,0,1)` | Open 300 ms / close 240 ms, dim 35% ink over 250 ms, drag to dismiss, light haptic on open | |
| Motion | `.card-press:active scale(.982)` 150 ms; fadeIn .3s; shimmer 1.5s (redefined later as a 1.8 s opacity pulse on `#E8E8F0`, so the class is defined twice) | Pressed scale .98 over 120 ms; standard curve `cubic-bezier(.2,.8,.2,1)`, exit ease-out; shimmer 1.6 s linear `#EFEDE7 / #F7F6F2`; brief-open: hero 240 ms fade + 8 px, count 360 ms, cards stagger 60 ms / 280 ms; success ring 500 ms, icon 450 ms at +100 ms; "Hareketi azalt" → durations 0, opacity only; haptics success / light / warning | Use primary |
| Dark | bg `#0F0F1A`, surface `#1E1E2E`, surface2 `#2A2A3C`, border `#3A3A50`, text `#EAEAF8`, sec `#9090B8`, muted `#6060A0`, primary `#7B7CF4`, primarySoft `#2A2A4A`, critical `#FF6B6B`, success `#4CD47A`, warning `#FFAA44`. Only Today, Flow, Plan, Assistant, MeetingPrep, Profile, and Appearance read `t`; everything else hardcodes `#fff`. Default mode `'light'`, not persisted, no system listener | bg `#141311`, surface `#1F1E1B`, surface-2 rgba(255,255,255,.08), hairline 6% white, text `#F2F0EB`, secondary `#A39F96`, tertiary `#7A776F`, primary `#8586F2`, glow `#A9AAF5`, critical-text `#F08B78`, warning-text `#F0B85A`, success-text `#6FCF97`, on-primary `#0F0F2A` | Use primary everywhere |

**Off-palette ad-hoc hexes in the later-added Tailwind screens (drop all):**
- Settings screens: `#F3F3FD`, `#C8C8F0`, `#FFF3DC`, `#B45309`, `#FFF8E6`, `#F0D88A`, `#92640C`, `#F59E0B` (stars), `#ECFDF5` / `#10B981` (Feedback success, Tailwind emerald), `#B0B0C8`, `#C8C8D8`.
- Other screens: `#D1D1DA`, `#7A4F00`, `#E02E24`.
- Ads and landing: `#FF6B6B`, `#FFB347`, `#A78BFA`, `#9090C8`, `#1A1A2E`, `#2d1b69`, `#0A0A16`.
- Page backgrounds: `#DDDDF0`, `#C8C8E8`, `#D8D8EE`.

## Interaction coverage

Legend: **NAV** = prototype navigation that becomes a real route (needs entity id params). **LOCAL** = React state only (needs persistence). **FAKE** = timer, canned success, or no side effect. **DEAD** = no handler. **BUG** = defect.

**Components**
- `BottomNav` tab → `navigate(tab)`. **BUG**: pushes history on every tab switch; no per-tab stacks. Real: expo-router Tabs with a stack per tab.
- `PageHeader` back → `goBack`; avatar → `profile` (always shows "Y"; `showAvatar` is never used).
- `BottomSheet` backdrop → `onClose`. Also sets `document.body.style.overflow`, which is web-only. Real: native sheet (e.g. @gorhom/bottom-sheet) with drag-to-dismiss.
- `SourceTag` `onClick` is optional and never passed, so tags are not tappable. Real: tap opens the source entity or the provider original (§131).
- `Chip` → `onClick` (Flow filters).
- `InsightCard`:
  - "Tamamlandı" → local `dismissed` (**LOCAL**). Real: set insight status=done plus success haptic, toast, and undo.
  - Other actions → `onAction`.
  - "Neden önemli?" → sheet showing the `whyImportant` text; the sheet's "Önemli değil" → local dismiss.
  - 👍 toggles local; 👎 dismisses after `setTimeout 600` (**FAKE**). Real: `ai_feedback` row plus a learning signal and an "Öğrendim" toast, per primary's "···" menu (Önemli değil / Daha sık göster / VIP yap / Takip etme).
- `SmartReminderSheet` options: 30 dakika sonra, 1 saat sonra, Bu akşam · 19:00, Yarın sabah · 08:00, Uygun zamanda, Kendin seç (native date + time inputs). "Hatırlatıcı Oluştur" → **FAKE** "Hatırlatıcı Oluşturuldu" for 1400 ms, then closes; nothing is created. Real:
  - Master and primary presets are "30 dakika önce / 1 saat önce" (relative to the deadline), "Bu akşam 19:00", "Yarın sabah 08:00", "Uygun zamanda" (calendar-gap based, with its reason shown), "Özel zaman" / "Kendin seç".
  - Create `reminders` through approval (`reminder_create`), schedule via `expo-notifications@57.0.20` local or server push.
- Unused components: `ui/SourceTag`, `ui/Switch`, `ui/Toggle`, `cards/LifeCard`, `ui/Skeleton`, `ui/Button`.

**Onboarding**
- welcome "Başlayalım" → next (NAV). The privacy text is not a link.
- noise / proactive / control "Devam" / "Anladım" → next. No "Atla" (primary has it).
- account: all 4 buttons → next (**FAKE auth**). Real: Supabase Auth. Apple via `expo-apple-authentication` + `signInWithIdToken`; Google native sign-in → `signInWithIdToken`; Microsoft (Azure) via OAuth web flow; e-mail OTP. Add "Giriş yap" for existing users and Terms + Privacy links.
- connect: rows toggle local `connected[]` (**FAKE integration**); the Devam gate requires ≥1 mail and ≥1 calendar. Real: per-provider explainer (2.7 / 2.7b / 2.7c), then OAuth through `expo-web-browser` / AuthSession with server-side code exchange and `oauth_credentials`. Apple Calendar via `expo-calendar@57.0.4` on device.
- permission "Güvenli şekilde bağla" → next with no OAuth (**FAKE**).
- calendar-permission "Takvim Erişimine İzin Ver" → next without an OS or OAuth prompt (**FAKE**). "Şimdi Değil" → denied state, whose "Ayarları Aç" calls `alert('Ayarlar açılıyor...')` (**FAKE, alert**). Real: `Linking.openSettings()`. "Şimdilik Atla" → next.
- preferences: `<input type=time>` ×3 and weekend toggle (**LOCAL**, not saved). Real: `user_preferences` + tz Europe/Istanbul; Pro lock on 13:00 / 19:00 (2.9 note).
- personalization chips (LOCAL; "Hepsi" semantics are inverted vs primary); "Devam" is disabled when nothing is selected.
- vip: rows toggle (LOCAL, hardcoded list); "Atla" / "Devam (n)". Real: suggest top correspondents from the first analysis and write `vip_people`.
- analysis: 5 × `setTimeout` 1000 ms, then auto-next at +1200 ms (**FAKE loading**). Real: first-analysis job over the last 72 h, streaming progress (Supabase Realtime or polling) with real counts.
- aha "Brifingimi Gör" → next; the 5 cards are hardcoded. Real: top 5 insights from the job.
- notification: "Bildirimleri Aç" and "Şimdi Değil" both → Today with no OS prompt (**FAKE**). Real: `Notifications.requestPermissionsAsync()` + push token → `push_tokens`. Per primary, "Daha sonra" re-asks once on the first briefing.

**Today**
- Header ⭐ (hardcoded `3`) → approval-center. Primary: "task_alt N onay" pill with a live pending count.
- Search → `search`; avatar → `profile`.
- Hero card, "Dinle", and "Brifing Aç" all → morning-briefing. "Dinle" should start audio directly (primary "Dinle · 2 dk"). Hero numbers are static.
- Insight actions:
  - "Yanıtı Gör" → email-detail (always `mockEmails[0]`).
  - "Hazırlan" → meeting-prep.
  - "Hatırlat" → reminder sheet.
  - **"Takvime Ekle" DEAD**. Real: `calendar_create` approval.
  - **"Görüntüle" DEAD**.
- Program rows → meeting-prep (always the same meeting).
- Life cards:
  - payment "Ödeme Yap" opens the reminder sheet (**mislabeled**; the app cannot pay. Use "Hatırlat" / "Ödendi" per primary 4.9).
  - Others open a detail sheet with hardcoded contradictory extras (**FAKE data**). "Kapat" closes it.
- "Gün Ortası" → midday; "Akşam Kapanış" → evening; weekly teaser → weekly-report.

**MorningBriefing**
- Back button.
- Speed cycles 1 / 1.25 / 1.5 (matches primary).
- Seek-bar click sets progress %.
- Play → `setInterval` +0.4 % / 100 ms (**FAKE audio**; no sound, time label "0:"+progress×1.2 can exceed 59 s).
- "↩ 15" / "15 ↪" move ±10 %, not 15 s (**BUG**).
- The 6 section rows are not tappable.
- Real: TTS audio (`expo-speech@57.0.3` fallback, or a generated audio file with `expo-audio@57.0.5`) with chapters (Genel bakış, Bugünün öncelikleri, Programın, Cevap bekleyenler, Son tarihler, Kişisel gelişmeler); every row links to its source (3.3 note). Section names should follow master §9.

**MiddayPulse**
- Back and "Bugüne Dön" → `goBack`.
- **DEAD**: "Kabul Et", "Reddet", "Müzakere Et", "Hatırlat", "Yanıt Yaz".
- Real (3.5):
  - "16:30 Öner" → `calendar_update` approval, or a reply-draft proposal.
  - "Seçenekleri Gör" → conflict sheet.
  - "Takip Mesajı Hazırla" → draft.
  - "Toplantıda Sor" → add to the prep talking points.
  - Only generated on a real delta; otherwise "Her şey planlandığı gibi."

**EveningClose**
- Back button.
- "Yarına taşı" → local "✓ Taşındı" (**LOCAL**). Real: re-date the task, commitment, or reminder.
- **"Yarına Hazırım ✓" DEAD**. Real (3.6 note): confirmation, carry-over action, mute evening notifications, schedule the morning brief.
- **BUG**: header typo "YARINALANLAR".

**WeeklyReport**
- **"Paylaş" DEAD**. Real: render a privacy-safe 1080×1350 card with `react-native-view-shot@6.0.1` and share via `expo-sharing@57.0.21` / RN `Share`. Stats must be computed, and "Tahmini" must stay in the label.

**Flow**
- Filter chips (LOCAL filter). **BUG**: "Takip" filters `type==='deadline'`; it should mean follow-ups.
- Card tap → email-detail or meeting-prep only; deadline and life cards do nothing.
- **ALL per-card action buttons are DEAD** (`onClick={e=>e.stopPropagation()}`): Yanıtla, Hazırlan, Takvime Ekle, Takip Et, Görüntüle, Ödeme Yap, İncele.
- "Mail Özeti" → mail-intelligence; avatar → profile.
- Master §13: every card action must be real.

**MailIntelligence**
- Back button.
- **BUG (swapped wiring)**: "Cevap Bekleyen" → smart-followup (things *you* await), and "Cevap Beklediğin" → waiting-reply (things *others* await from you).
- Other categories toggle a local filter. **BUG**: `important` matches no mock row (no email has `category:'important'`), so the list is empty.
- Counts 83 / 6 / 3 / 2 / 3 / 2 / 18 / 56 are hardcoded and do not match the list.
- Email rows → email-detail (always `[0]`).

**EmailDetail**
- "Yanıt Hazırla" → ai-draft-reply.
- "Görev Oluştur" → sheet with title + date inputs → **FAKE** "Görev Oluşturuldu" for 1500 ms. Real: `task_create` approval → Google Tasks / MS To Do / local tasks.
- "Takvime Ekle" → `navigate('plan')` (**FAKE**, creates nothing). Real: `calendar_create` approval with extracted date and time.
- "Hatırlat" → reminder sheet (FAKE).
- "Orijinal Maili Aç" → sheet whose "Gmail'de Aç ↗" only closes it (**DEAD handoff**). Real: expand the original inline (primary 4.4), then `Linking.openURL` to the provider web link or app.
- The screen ignores which email was tapped.

**AIDraftReply**
- Tone chips change only the highlight (**FAKE**; draft text never changes). Real: regenerate through the AI edge function with a tone param (primary: "Ton seçimi taslağı anında değiştirir"). Primary also has "Kısalt" and "Teklif_v3.pdf ekle".
- Textarea (LOCAL).
- "Göndermeyi Onayla" → "Son Onay" sheet → "Evet, Gönder" → **FAKE "Gönderildi!"** overlay → "Bugüne Dön". "İptal" closes.
- "Gmail'de Aç" → **FAKE** full-screen "Gmail açılıyor… Taslak Gmail uygulamasına aktarıldı." ("Geri Dön" only).
- Recipient is hardcoded to Ahmet even when opened from Mehmet's follow-up.
- Real: `approval_actions(email_send)` → execute Gmail `users.messages.send` / Graph `sendMail` with an idempotency key. Alternative: create a provider draft and deep-link to it. Never send silently.

**SmartFollowUp**
- "Takip Mesajı Hazırla" → ai-draft-reply (no context passed).
- "Hatırlat" → sheet (FAKE).
- "Kapat" → 400 ms fade, local removal (**LOCAL**).
- Missing the master action "Yarın hatırlat".
- Empty state "Hepsi tamam!".

**WaitingReply**
- "Maili Aç" → email-detail; "Yanıtla" → draft; 🔔 → reminder sheet. None pass an id.

**PlanScreen**
- Gün / Hafta segment toggles only the style (**DEAD**; no week view). Primary 5.2 has a density week plus intelligence cards.
- Date strip has a pointer cursor but no handler (**DEAD**).
- "Planla" → "AI Öneri" sheet → "Onayla" → **FAKE** "Takvime eklendi" for 1800 ms. `timelineHasTask` is set but never read; the flow bypasses the Approval Center. Real: `calendar_create` approval, provider insert, refreshed timeline.
- **"Saati Değiştir" DEAD**. "İptal" works.
- Meeting blocks → meeting-prep. "Çöz" → calendar-conflict. "Taahhütler" → commitments. Avatar → profile.
- Primary adds "Başka zaman" and shows gaps explicitly ("2 saat boşluk").

**MeetingPrep**
- Back button.
- Person card → person-intelligence (always `[0]`).
- "Son E-postalar" → email-detail.
- "Not Al…" opens a textarea (**LOCAL**, not saved).
- **"2 Dk Özet" → post-meeting (BUG: wrong target)**. It should open 5.6, the reading view plus audio, with KAYNAKLAR chips.
- "Toplantıyı Başlat" → **FAKE** "Google Meet açılıyor…" screen: "Geri Dön" works, **"Meet'i Aç ↗" is DEAD**. Real: `Linking.openURL(conferencing URL)`.
- "18 dakika kaldı" is static.
- Missing sections required by master §21 and primary: SENDEN BEKLENENLER, SENİN BEKLEDİKLERİN; per-row provenance ("Takvim davetinden çıkarıldı", "Görüşme notları").

**PostMeeting**
- Back → `navigate('plan')`.
- Any text triggers the same hardcoded "Mehmet'e teklif gönder · Yarın" card (**FAKE extraction**).
- "Kaydet" → **FAKE** "Taahhüt Kaydedildi · Yarın hatırlatılacak" → "Bugüne Dön".
- Real (5.7): voice or text input → AI extraction into N `commitment_create` proposals → save only on "Kaydet". Silent notification 1 min after the event ends.

**CalendarConflict**
- Recommended option "Müşteri toplantısını 13:00'e al" → **FAKE** "Çözüldü! Müşteri toplantısı 13:00'e alındı." This is a direct calendar change without approval, and it moves another person's meeting.
- The other 2 options ("Doktor randevusunu iptal et", "Beni hatırlat, kendim çözeyim") are **DEAD**.
- Copy claims "Mehmet'in takviminde de bu saat uygun görünüyor", which is unverifiable without free/busy access. Do not fabricate.
- "Plana Dön" works.
- Real (5.3): options "Doktoru 15:45'e al", "Toplantıyı 13:00'a öner" (creates a proposal-mail draft), "Toplantıyı 30 dk kısalt", "Böyle kalsın" (suppress). Each goes to approval. Travel time only if the source provides it (§20).

**CommitmentTracker**
- "Tamamlandı" (LOCAL).
- "Ertele" → sheet: "Yarın", "2 gün sonra", "Önümüzdeki hafta" set the value; "Özel tarih" is a **no-op**; date input; "Kaydet" → **FAKE** "Ertelendi" for 1400 ms, then local update.
- "Kaynağı Gör" → email-detail regardless of source (item 4's source is "Zoom toplantısı").

**Assistant**
- Suggestions and input (Enter / send) → `sendMessage`: `setTimeout 1200 + rand·600` typing dots, then a canned reply matched on the first word of the key (**FAKE AI**).
  - Any text containing "bugün", "kimlere", or "yarın" returns a fixed answer.
  - Suggestions 4–6 get the generic reply "…bulamadım".
  - The canned reply contains a self-contradiction ("Öğleden sonra uçuşun var (TK2412, 09:15 — aslında yarın sabah erken!)").
- Reply cards are not tappable.
- "+" → universal-capture; mic ×2 → voice-assistant.
- Real: grounded RAG over pgvector / FTS with source cards and follow-up chips (6.2). Drafts end in "Göndermeyi Onayla"; no send happens from chat. Hide the tab bar during chat. Persist threads.

**VoiceAssistant**
- Close → `goBack`.
- Main button: idle → listening, 2000 ms → processing, 1500 ms → responding with a canned answer (**FAKE**). Tapping again resets.
- Example commands all trigger the same fake flow.
- `Math.random()` inside render re-randomizes the animation on every render.
- Real: mic permission plus STT (`expo-speech-recognition@57.1.0` by jamsch, or `@react-native-voice/voice@3.2.4`), live transcript, and TTS reply. Write actions show a visible approval card, and voice "Onayla" is allowed (6.4).

**ApprovalCenter**
- "Onayla" / "Reddet" → local remove after 600 ms (**FAKE**; nothing executes).
- "Düzenle" → sheet that edits the *action label* text only; "Kaydet ve Onayla" approves.
- The empty state says "Tüm işlemler onaylandı!" even after rejections.
- The Today badge count does not update.
- Real: status machine executing → executed / failed, idempotent execution, Geçmiş tab (30 days), a reject counts as a learning signal, no bulk approve, edit of the structured payload.

**Search**
- Input, clear ✕, and "İptal" work.
- Recent and example chips fill the query.
- Results come from a hardcoded key map. **BUG**: key `ucus` has no Turkish characters, so the recent search "Uçak bileti" and the example "Geçen ay uçak bileti" return nothing.
- Results with a screen → NAV (no id); others are not tappable.
- Real: semantic memory search (6.5): answer card first, then sources with "Orijinal Aç", "%92 eşleşme" confidence, and "emin değilim" language under 70 %. Filters: Tümü / Mail / Takvim / Notlar / Belgeler / Son 30 gün.

**PersonIntelligence**
- Only the back button works.
- **"AI'ya sor" input DEAD**. Real: person-scoped memory query.
- Data is hardcoded.
- **BUG**: class `gap-14` (56 px).

**UniversalCapture**
- Fotoğraf / PDF / Link tiles inject a sample string, then **FAKE** analyze for 1800 ms. No picker is shown.
- "AI ile Analiz Et" → **FAKE** 2000 ms.
- The result is always "12 Eylül · 20:00 · Zorlu PSM · Etkinlik olarak tespit edildi".
- "Takvime Ekle", "Görev Oluştur", and "Hatırlatıcı Kur" all → `navigate('approval-center')` without creating an approval (**FAKE**). "Tekrar Dene" resets.
- Real (4.10–4.14):
  - Inputs: `expo-image-picker@57.0.19`, `expo-document-picker@57.0.2`, a link fetcher (§84 SSRF-safe), text, and share extensions (`expo-share-intent@8.0.1`, iOS Share Extension / Android ACTION_SEND).
  - Pipeline: upload to Storage → extraction (event / task / deadline / payment…) → suggestions → real approvals → success state.

**Profile**
- Rows navigate.
- **"Çıkış Yap" DEAD**. Real: `supabase.auth.signOut`, clear local cache and push token.
- The "Diğer" (Android Frame) and "Tasarım Sistemi" groups (11 rows) are prototype-only navigation. Do not ship them.
- Missing (master §130): About / version, Delete Account entry, Onay Merkezi shortcut (primary 7.1), and live values per row ("6 kural", "7 öğrenme").

**Integrations**
- "Bağla" / "Kaldır" flip state instantly and set account to `yunus@example.com` (**FAKE integration**; no confirmation on remove).
- Real: OAuth per provider (Gmail, Outlook, Google/Microsoft/Apple calendars, Google Tasks, MS To Do, Apple Reminders via EventKit) with states Bağla / Bağlandı / Yeniden bağlan (expired), last sync time, revoke plus server token deletion, and a "Yönet" link to scopes.

**SecurityPrivacy**
- Rows → integrations / data-source-control / ai-personalization, or open sheets.
- İzinler sheet: statuses are hardcoded (Kamera ✓, Mikrofon ✓, Bildirimler ✓, Takvim ✓, Kişiler ✗). "Sistem Ayarlarına Git ↗" only changes its label to "📱 Sistem Ayarları açılıyor…" (**FAKE**). Real: `getPermissionsAsync` for each, plus `Linking.openSettings()`.
- Veri Saklama: options "3 ay / 6 ay / 1 yıl / Sınırsız (PRO)" (LOCAL). These conflict with master §41 (30 gün / 90 gün default / 1 yıl / silene kadar) and primary 7.4 (30 / 90 / 1 yıl). The copy "Aboneliğin bittiğinde veriler 30 gün içinde silinir" is an unbacked policy claim.
- Geçmişi Sil → **FAKE** "Geçmiş Temizlendi" for 1600 ms. Real: server job plus a confirmation that shows counts ("Silinen: 1.204 özet · 318 öncelik kararı · 42 kural / Korunan: …").
- Verilerimi İndir → **FAKE** "İstek Alındı" with a hardcoded e-mail. Real: async export job, signed expiring URL, status (§128).
- Hesabımı Sil: "Vazgeç" works; **"Evet, Hesabımı Sil" DEAD**. Real: §129 queued deletion, provider revoke, audit; never a fake success.

**AIPersonalization**
- "Düzenle" → priority sheet → "Kaydet"; "Devre Dışı" / "Etkinleştir"; ✕ delete; "Etkileşimlerimden öğren" toggle. All **LOCAL**.
- Missing: provenance per preference and 5 s undo on delete (6.9). Real: a learned-preferences table, separate from `priority_rules`.

**DataSourceControl**
- 7 toggles (**LOCAL**). Real: persisted capability flags enforced server-side, which gate the AI pipeline and write actions (drafts, calendar create).

**VIPPeople**
- Row → person-intelligence.
- "Kaldır" / "VIP Ekle" toggle (**BUG**: no `stopPropagation`, so the tap also navigates).
- Missing: add-from-contacts, groups, and the AI suggestion "Evet".

**Paywall**
- Plan toggle (LOCAL).
- "7 Gün Ücretsiz Dene" → Today (**FAKE purchase**). "Ücretsiz ile devam et" → Today.
- Missing "Satın alımı geri yükle" (required by master §43 and present in primary 7.5), plus Manage Subscription and legal links.
- Real: RevenueCat `react-native-purchases@10.10.1`, entitlement `pro`, products `da_pro_monthly` / `da_pro_annual`. Show a trial only if the store product has one. If "Bitmeden 24 saat önce hatırlatırız" (primary) is claimed, schedule it for real.

**Referral**
- **ALL DEAD**: Kopyala, "WhatsApp'tan Paylaş", "Paylaş…". Stats are static; the link `dijital.asistan/davet/yunus42` is not a valid host (primary: `dijitalasistan.app/d/yunus-7k2`).
- Real: backend code, `expo-clipboard@57.0.2`, RN `Share`, invite list with statuses (+14 GÜN / BEKLİYOR / GÖNDERİLDİ), cap "yılda 6 davet", anti-abuse (§45).

**Appearance**
- `setMode` (in memory only; most screens ignore the theme). Real: persisted preference, `useColorScheme`, full token theming; add Metin boyutu, Hareketi azalt, Haptik (7.8).

**Language**
- **All rows DEAD**. Four languages are marked "Yakinda", which violates the no-placeholder rule (§100); master §39 requires full English support.
- Date and time rows have chevrons and no handler.
- Real: i18n TR/EN, persisted, date and time formats derived from `tr-TR` (24 h). Primary note: "Brifing ve özetler seçtiğin dilde yazılır; maillerin orijinal dili korunur."

**BriefingSettings**
- ± steppers and toggles (**LOCAL**).
- "Saat Dilimi: Istanbul (GMT+3)" is static.
- **BUG**: "Sessiz Günler" says "Brifing almak istediginiz günleri seçin" (inverted meaning) and conflicts with the "Hafta sonu brifing" toggle.
- Root `min-h-screen` inside an `overflow-hidden` frame means the screen does not scroll (applies to all 6 Tailwind settings screens).

**NotificationSettings**
- 9 toggles (**LOCAL**).
- Missing (master §35): Quiet Hours, Lock Screen Privacy, detail level.
- English label "Life Intelligence" left in the UI.

**PriorityRules**
- Add (Enter / "Ekle") and remove chips / rows; 4 toggles. All **LOCAL**; no validation (domain field placeholder is an e-mail "ornek@domain.com").
- Superseded by primary 7.9–7.12.

**Help**
- Every article opens the placeholder "Bu konuyla ilgili yardim içerigi hazirlaniyor." (**placeholder, violates §100**).
- "Hata Bildir" → feedback.
- "Destek ile Iletisim" only reveals `destek@dijitalasistan.app` as text. Real: `mailto:` link or an in-app support ticket (§62).
- Version "v1.0.0" and "© 2025" are hardcoded. Real: from `expo-application`.

**Feedback**
- Type, stars, message, and e-mail (LOCAL); submit → **FAKE** "Gönderiliyor..." for 1000 ms, then "Tesekkürler!". "Yeni Geri Bildirim" resets.
- Real: insert a feedback or support row with platform, app version, and device. Add the "AI Kalitesi" type (master §62).

**AndroidNotifications**
- Master toggle, all / selected radio, per-app toggles, 4 rule toggles. All **LOCAL**.
- **BUG**: `useState` is called inside `.map()`, which violates the Rules of Hooks.
- WhatsApp is ON by default. That conflicts with primary 2.13 ("Sohbet uygulamaları varsayılan olarak kapalıdır ve önerilmez") and master §36 (exclude sensitive / auth apps by default).
- Claims to verify:
  - "Yalnızca Android 12+ cihazlarda geçerlidir": NotificationListenerService is not 12+-specific.
  - "Bildirim içerikleri yalnızca cihazında işlenir": only true if processing really happens on the device.
- Real: native Kotlin NotificationListenerService (config plugin), `Platform.OS==='android'` gate, never shown on iOS (§91).

**States screens**
- EmptyStates CTAs "Etkinlik Ekle", "Hesap Bağla", and "Kişi Ekle" are **DEAD**.
- ErrorStates primary CTA → **FAKE** "✓ Deneniyor..." for 1500 ms; secondary CTAs **DEAD**.
- LoadingStates are pure animation (`setInterval` loops).
- DesignSystem buttons are inert.

**Marketing screens**
- WidgetShowcase: no interactions. Real:
  - iOS WidgetKit via `expo-widgets@57.0.20` (sdk-57 tag) or `@bacons/apple-targets@5.0.0`.
  - Android via `react-native-android-widget@0.22.1`.
  - Deep links to real screens; privacy-safe lock-screen content.
- AppStoreScreenshots "PNG 6.7″/6.1″/5.5″" **DEAD**.
- SocialAds selector works; "PNG İndir", "MP4 İndir", and the in-ad CTAs are **DEAD** (marketing assets, not app features).
- Landing:
  - Desktop nav items "Özellikler / Güvenlik / Fiyatlandırma" are `<span>` with no link (**DEAD**).
  - CTAs → onboarding / morning-briefing / paywall (prototype-only navigation).

**Splash**: auto-advances to onboarding after 2200 ms on every launch (**FAKE**). Real: session and onboarding-state routing.

**Cross-cutting copy defects not to port:**
- ASCII-ified Turkish (missing ğ/ş/ı/İ) in Help, Feedback, Language, PriorityRules, and BriefingSettings: "Baslarken", "Ilk Kurulum", "Hesap Baglama", "Brifing Ayarlari", "Mail Zekasi Nasil Çalisir?", "Takvim Erisimi", "Destek ile Iletisim", "Yardim", "saklidir", "Özellik Istegi", "görüs ve düsüncelerim", "Puanlamaniz", "Mesajiniz", "istege bagli", "Tesekkürler!", "kisa sürede degerlendirip … dönecegiz", "Gelistirilebilir", "Iyi", "Dil Ayarlari", "Yakinda", "Fransizca", "Ispanyolca", "Dil degisikligi uygulamayi yeniden baslatir", "Bölge Ayarlari", "Tarih Formati", "Saat Formati", "VIP Kisiler", "Kisi Ekle...", "Düsük Öncelik Kategorileri", "Ahmet Yilmaz", "istediginiz".
- Other typos: "App Store Görsellleri", "MAİL ZEKASİ", "TAKİP MERKEZI", "SES ASISTANI", "DİJİTAL ASISTAN", "YARINALANLAR", "VEYA METİN YAPIŞTIIR", Landing "Sabah Brifingini" as a card title.
- Formal *siz* register ("seçin", "yazin", "Geri bildiriminiz", "kabul etmiş olursunuz") vs the product's *sen* voice. Primary uses *sen* throughout.

**Misleading or false claims to drop:**
- Landing "Mail Zekası: … Gerisini siler." (the app does not delete mail).
- "ŞU ANDA BAĞLI HESAPLAR" (fake social-proof label).
- "Şu an ücretsiz erişim açık".
- "Kredi kartı gerekmez" (App Store trials need a payment method on the Apple ID).
- Zoom and Teams listed as integrations (not providers in master §75; link handoff only).
- The testimonial "Ben artık sabah Gmail açmıyorum." is fabricated. It appears in the secondary ad as "— Dijital Asistan kullanıcısı" and in primary 09 as "Yunus E. · Kurucu, İstanbul". It needs a real, consented source before publishing.
- AppStore "8 bölümlük AI brifing hazır" (prep has 6 sections).
- "84 mail içinde yalnızca 3 önemli." should be master "83 mail. Gerçekten önemli olan 4."
- Primary 7.2 says "Uçtan uca TLS". Avoid "uçtan uca" wording unless it is true (§40).

## Secondary-only screens worth keeping

All of these are restyled to primary: warm `#F5F4F0` background, white r20 cards with shadow-2, 12/600/+8 % caps kickers in `#9B978E`, rows separated by rgba(27,25,23,.06) hairlines, Material Symbols Rounded icons instead of emoji, Geist type, 50×30 toggles, solid 48 px `#5B5CE2` primary buttons, badges only per Kural 1, *sen* voice.

1. **Notification Settings** (`notification-settings`). Required by master §35; primary has only the 7.1 row.
   - IA: "Akıllı Filtre · Yalnızca gerçekten önemliyse bildir" (hero toggle); BRİFİNG BİLDİRİMLERİ (Sabah / Öğle nabzı / Akşam kapanışı; Pro lock on the last two); ANLIK (Kritik mailler / Toplantılar / Son tarihler / Takip hatırlatmaları); YAŞAM ZEKÂSI.
   - Add: Sessiz saatler (start/end), Kilit ekranı gizliliği (içerik göster / gizle), detay seviyesi, VIP "sessiz saatlerde bile" (from primary 7.9).
   - Backed by `notification_preferences` and the §132 decision engine.
2. **Briefing Settings** (`briefing-settings`) as a settings screen. Reuse 2.9 "Günün ritmi" rows (wb_twilight 08:00, wb_sunny 13:00, bedtime 19:00, weekend "Sadece sabah, 10:00"). The time chip opens the native time picker. Show the editable timezone (Europe/Istanbul) and the psychology hint ("genelde 08:15'te telefonu açıyorsun"). Drop "Sessiz Günler" or turn it into a clear per-weekday "Brifing günleri" control. Changes drive the cron schedule.
3. **Connected Accounts / Integrations manager** (`integrations`). Merge the 2.6 list (Bağla tonal / Bağlandı green ✓), the 7.2 "BAĞLI HESAPLAR" rows with capability summaries ("Okuma · Taslak oluşturma · Gönderme (onaylı)") and "Yönet", and the secondary-only provider rows **Google Tasks, Microsoft To Do, Apple Reminders** (master §75). Per-account states: bağlı / süresi doldu → "Yeniden Bağlan" (08 error/oauth-expired) / hata, plus "son senkron". Removal needs a confirm dialog and a server-side revoke.
4. **Per-source capability control** (`data-source-control`) as the "Yönet" detail of each account. Gmail: Mailleri oku / Ekleri analiz et / Son tarihleri tespit et / Taslak cevap hazırla. Calendar: Etkinlikleri oku / Program öner / Onayınla etkinlik oluştur. It complements 7.3 (per data type, plus "HİÇBİR ZAMAN OKUMAZ"). Enforce the flags server-side.
5. **OS Permissions sheet** (from SecurityPrivacy "İzinler"): live status for Bildirimler, Takvim (device), Mikrofon, Kamera/Fotoğraflar, Kişiler (and Android "Bildirim erişimi"), with "Sistem Ayarlarına Git" → `Linking.openSettings()`. Place it under 7.2 Gizlilik Merkezi.
6. **Help** (`help`): sections Başlarken / Özellikler / Entegrasyonlar / Destek, with real article content (static MDX/JSON or CMS), "Hata Bildir" → Feedback, "Destek ile İletişim" (mailto or in-app ticket), and a live version and build line ("Dijital Asistan 1.0 (240) · Sürüm notları", per 7.1). No placeholder sheets.
7. **Feedback** (`feedback`): types Hata / Özellik isteği / Genel / **AI kalitesi**, 1–5 rating, message, optional e-mail prefilled from the profile, diagnostics consent. Writes a feedback row visible in the backoffice (§62). Use the 01 success pattern (green ring 500 ms).
8. **Onboarding VIP step**, master step 11. Use the 2.8 multi-select card style (selected card: dark background plus filled check), fed by real top correspondents from the first 72 h analysis plus a search box. "Atla" / "Devam (n)". Writes `vip_people`.
9. **Onboarding calendar-denied state**: "Takvim erişimi kapalı. Dilersen Ayarlar'dan daha sonra açabilirsin. Takvim olmadan da temel özellikler çalışır." with "Ayarları Aç" (`Linking.openSettings`) and "Şimdilik Atla". Restyle to the 08 error/permission-denied tone (`#FDF2DC` / `#9A6300`, icon event_busy).
10. **Extra empty and error variants**, extending 08:
    - Empty: "Mailini bağla." / "Gmail veya Outlook bağlayarak önemli konuları burada görebilirsin." (CTA "Hesap Bağla" → integrations).
    - Empty: "Henüz VIP kişi yok." (CTA "Kişi Ekle").
    - Error: "Erişim izni reddedildi." (OAuth consent denied → "Tekrar Dene").
    - Error: "İnternet bağlantısı yok." as an inline banner. Primary already has the full-screen offline state with "Son analiz 09:40'tan gösteriliyor."
11. **Android Notification Intelligence as a settings screen**, post-onboarding management of 2.13. Keep master toggle "Bildirim Erişimi", mode "Tüm Bildirimler" / "Seçili Uygulamalar" (master §36; primary lacks it), and rule toggles ("Para transferleri her zaman önemli", "Toplantı hatırlatmaları ilet", "Teslimat bildirimlerini özetle", "Sosyal medya bildirimlerini filtrele"). Use the primary category list (Kargo, Banka, Havayolu, Rezervasyon on; Mesajlaşma off / "önerilmez"). Exclude auth/OTP apps by default. Android only.
12. **Life-item detail sheet** (Today "Dijital Hayatın" → sheet). Keep the concept of a structured "details" sheet, filled only with real extracted fields (tracking number, delivery window, gate, PNR, amount, due date) and a mandatory source row plus "Orijinali Aç". The two actions follow 4.9: KARGO Takip Et / Kapıya Not Bırak, UÇUŞ Check-in / Cüzdana Ekle, REZERVASYON Teyit Et / Yol Tarifi, ÖDEME Hatırlat / Ödendi, ABONELİK İncele / Bir Daha Gösterme, GÜVENLİK Bendim / Şifreyi Değiştir.
13. **Form sheets absent in primary**:
    - EmailDetail "Görev Oluştur" (GÖREV BAŞLIĞI prefilled with the subject, SON TARİH) → `task_create` approval.
    - Commitment "Ertele" presets (Yarın / 2 gün sonra / Önümüzdeki hafta / Özel tarih with a working date picker).
    - Approval "Eylemi Düzenle" → edit the structured payload (mail body, event time), then re-show the diff.
14. **Evening per-item "Yarına taşı"** inside 3.6 YARINA KALANLAR (real re-dating plus a "✓ Taşındı" confirmation). The final CTA "Yarına Hazırım" follows primary: mute evening notifications and schedule the morning brief.
15. **Global search entry from the Today header.** Primary puts search in Asistan › "Hafıza" (6.5). Keep the secondary pre-query state (SON ARAMALAR from history, ÖRNEK ARAMALAR chips) as the empty state of 6.5. A Today header search icon is optional; primary's Today header has only the "N onay" pill and the avatar.
16. **Notification copy catalog** (NotificationExamples). Not a user screen. Seed push templates and backoffice notification templates:
    - Sabah 07:30 (use 08:00 per primary): "Günaydın. Bugün bilmen gereken 5 şey var."
    - Kritik: "Ahmet senden bugün 17:00'ye kadar dönüş bekliyor."
    - Toplantı 14:10: "14:30 toplantına 20 dakika kaldı."
    - Öğle 13:00: "Sabahından beri 2 önemli gelişme oldu."
    - Akşam 19:00: "Bugünden yarına 3 konu kalıyor."
    - Sessiz özet: "Trendyol siparişin bugün teslim edilecek."
    - Principles: 3–5 per day maximum (primary 2.12: "Günde ortalama 3 bildirim"), one clear action each, no jargon, prefer grouping.
17. **Public marketing landing IA** for the Next.js site. Keep the structure: sticky nav, hero with 2 CTAs, integrations strip (relabeled "Entegrasyonlar"), 6 feature cards (Sabah Brifingi, Mail Zekâsı, Akıllı Plan, Taahhüt Takibi, AI Belleği, Güvenlik), pricing (Aylık 199 TL, Yıllık 1.490 TL "ayda 124 TL · %38 tasarruf"), final CTA.
    - Restyle to primary: light warm `#F5F4F0` and paper `#FBFAF7`, Geist plus Lora editorial headings, dawn gradient only for the brand moment, real product screenshots from 09 store frames.
    - Hero copy per master §73: "Bugün bilmen gerekenleri, sen sormadan söyler." / "Dijital Asistan mailini, takvimini ve açık işlerini anlayıp her gün sana kısa bir brifing hazırlar."
    - Add the missing master sections and routes: How it works, Meeting Prep, Smart Planning, AI Memory, Security, FAQ, `/pricing`, `/privacy`, `/terms`, `/support`, `/data-deletion`, SEO/OG/sitemap/robots.
    - Remove the false claims listed above.

**Do not carry:** SplashScreen timer; AndroidFrame; DesignSystem, IAPage, and UserFlows as app screens (their "TEMEL AKIŞ KURALLARI" match master §98 and §115 and can live in docs); the Profile "Tasarım Sistemi" and "Diğer" groups; secondary PriorityRules (superseded by 7.9–7.12); the secondary purple "deadline" color; gradient buttons; emoji icons; `alert()`; every `setTimeout` success state listed above; hardcoded "Yunus" and `yunus@example.com`; the WebView/prototype frame.

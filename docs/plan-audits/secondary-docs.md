## Legend
- **M§n** = MASTER_PROMPT section. **PD§n** = `src/imports/pasted_text/dijital-asistan-product-design.md` (the original 75-section Figma brief). **RD§n** = `digital-assistant-redesign.md` (audit, repair and completion brief). **QA§n** = `final-qa-cleanup.md`. **PL** = `plans/hen-z-tasar-m-retme-nce-hidden-stallman.md` (the Figma-Make build plan). `AGENTS.md` and `CLAUDE.md` only describe the Figma Make/Vite scaffold (React 19, Vite 8, Tailwind v4, default exports). They contain no product requirements.
- **PRIM** = primary design archive. The facts below were verified by grepping `01 Tasarim Sistemi.dc.html` and the other dc.html files:
  - Font: Geist.
  - Icons: Material Symbols Rounded.
  - Brand: `#5B5CE2`, pressed `#4B4CCB`, soft `#EDEDFC`, text-on-soft `#4547C9`.
  - Neutrals: bg `#F5F4F0`, ink `#1A1917`, secondary `#6B6860`, tertiary `#9B978E`.
  - Critical: `#E0553F`, soft `#FCEDE9`, text `#C7432F`.
  - Warning: `#E09A1C`, soft `#FDF2DC`, text `#9A6300`.
  - Success: `#2FA062`, soft `#E4F5EA`, text `#1E7A47`.
  - Info: `#3B82E6`, soft `#E7F0FD`, text `#2262BE`.
  - Dark theme: bg `#141311`, surface `#1F1E1B`, text `#F2F0EB`, primary `#8586F2`.
  - Gradients: dawn, night and dusk.
  - Badges: ACİL, SON TARİH, TAKİP, TOPLANTI, BUGÜN, KARGO, UÇUŞ, REZERVASYON, ÖDEME, ABONELİK, GÜVENLİK, KİŞİSEL, TAAHHÜT. Only ACİL, SON TARİH, GÜVENLİK and ONAYLANDI are colored.
- **Rec**: ADOPT = take it as written, ADAPT = take it with the stated changes, REJECT = drop it. MASTER is binding for functional behavior. PRIM is binding for visuals.

---

## Requirements in secondary docs NOT in MASTER_PROMPT

Proposed IDs are `SREQ-nn`. Merge the adopted ones into the traceability matrix as `REQ-<AREA>-S<nn>`.

### Today / Briefings
- **SREQ-01**: "Hero kartında küçük özet: 3 önemli mail · 4 etkinlik · 2 takip · 1 son tarih … Ancak ekran spreadsheet gibi görünmesin. Daha insan odaklı anlat." [PD§8]
  - **ADOPT.** Take the counts from the real `briefing_items` grouped by type. Render them as one sentence and omit zero groups.
- **SREQ-02**: Priority card taxonomy and actions [PD§9]:
  - CRITICAL: "Ahmet senden bugün 17:00'ye kadar revize teklif bekliyor.", actions "Yanıtı Gör / Hatırlat / Tamamlandı".
  - UPCOMING: "14:30'da Mehmet ile müşteri toplantın var." with "Son görüşme 4 gün önce.", action "Hazırlan".
  - DEADLINE: "Başvuru bugün saat 17:00'de kapanıyor.", action "Takvime Ekle".
  - **ADAPT.** Use the PRIM Turkish badge set (ACİL / TOPLANTI / SON TARİH …), not the English labels.
  - Action routing: Yanıtı Gör → Email Detail/Reply. Hatırlat → SmartReminderSheet. Tamamlandı → state change with undo. Hazırlan → Meeting Prep. Takvime Ekle → `calendar_create` approval.
- **SREQ-03**: Source line "Gmail · Mehmet Yılmaz · 08:42"; tapping it shows which content the item came from. Source types include "Android Notification". [PD§10]
  - **ADOPT** as the single canonical `SourceTag` component [RD§23].
  - The `source_type` enum must include `android_notification`.
- **SREQ-04**: "Neden önemli?" opens a bottom sheet with a reason sentence. Example: "Bu mailde bugün saat 17:00'ye kadar cevap istendiği için önemli olarak işaretlendi." The sheet includes a "Önemli değil" action. [PD§11]
  - **ADOPT.** Build the reason from the stored `classification.reason`, show the precedence tier (rule / learned / signal / AI) per M§31, and cite the source.
  - "Önemli değil" writes `ai_feedback` and proposes a learned preference, which must appear in AI Personalization.
- **SREQ-05**: Morning hero line "Bugün oldukça sakin bir günün var." plus a narrative paragraph. [PD§12]
  - **ADOPT.** The narrative must be generated only from grounded facts (M§80, M§83).
- **SREQ-06**: Audio speeds "1x / 1.25x / 1.5x". [PD§12]
  - **ADOPT.** MASTER only says "speed". Add the seek bar MASTER requires.
- **SREQ-07**: Weekly title "Haftan Nasıl Geçti?" [PD§15]
  - Sections: "En yoğun günün", "En çok iletişimde olduğun kişiler", "Gelecek haftaya kalanlar", "Önümüzdeki haftanın görünümü".
  - Shows "Tahmini kazandırılan zaman: 2 sa 48 dk", uses a story-style layout, and has a share card "Dijital Haftam".
  - **ADOPT, with these rules:**
    - The people section must never appear on the share card.
    - Time saved comes from a documented deterministic formula and is labelled "tahmini".
    - The review is ready Sunday 18:00, per PRIM.

### Flow / Mail / Reply / Follow-up / Commitments
- **SREQ-08**: Flow item anatomy "icon, source, title, summary, time, priority, suggested action"; "Chronological fakat AI öncelikli". [PD§16]
  - **ADOPT.** Sort by urgency tier, then time (PRIM: "aciliyet → zaman").
- **SREQ-09**: Mail Intelligence header "Bugün 83 mail" / "6 tanesi dikkat gerektiriyor." [PD§17]
  - **ADOPT** with real counts, where "today" is computed in the user's timezone.
- **SREQ-10**: Mail Intelligence rows open separate smart views [RD§3, RD§16]:
  - "Takip Etmen Gerekenler" → Smart Follow-Up
  - "Senden Beklenenler" → Waiting Reply
  - "Senin Cevap Beklediklerin" → its own smart view
  - **ADOPT** as the entry-point map.
- **SREQ-11**: Waiting-for-you buckets "Acil / Bugün / Yakında". Card fields: "Kişi / Konu / Ne bekleniyor? / Son tarih / Kaç saattir/gündür bekliyor". [PD§21]
  - **ADAPT.** Rename the "Yakında" bucket (e.g. "Bu hafta"). It collides with QA§18's ban on "yakında" and with the M§100/M§133 grep gate.
  - Wait badge per PRIM: amber after 3 days, coral after 7 days.
- **SREQ-12**: Waiting Reply actions "İlgili maili aç / Yanıt Hazırla / Hatırlat". [RD§16]
  - **ADOPT.**
- **SREQ-13**: Follow-up card: "Mehmet Yılmaz · Teklif · Son mesaj: 3 gün önce · Durum: Henüz yanıt gelmedi." [PD§20]
  - **ADOPT.**
- **SREQ-14**: Email Detail "Görev Oluştur" sheet with fields "Görev başlığı, Due date, Related person, Source" and CTA "Görevi Oluştur" [RD§8]. QA§4 says it must not create the task directly: Task details → Approval → Created.
  - **ADAPT.** Add a destination selector: Google Tasks, Microsoft To Do, Apple Reminders (iOS) or an in-app task.
  - An external destination creates a `task_create` approval.
  - An in-app task with no external side effect only needs inline confirmation (M§115 "where external side effect exists").
- **SREQ-15**: "Orijinal Maili Aç" must work: an "external-mail opening state or uygun confirmation". [QA§4]
  - **ADOPT, with a real handoff:**
    - Microsoft: Graph `message.webLink` (official property).
    - Gmail: `https://mail.google.com/mail/?authuser={email}#all/{threadId}`. This pattern is unofficial, so fall back to the Gmail app/web inbox.
    - Do not persist the raw body (M§87). Fetch it on demand for the in-app original view.
- **SREQ-16**: AI Draft "Gmail'de Aç" is a prototype external-app handoff state. [PD§19, QA§5]
  - **ADAPT.** Make the label provider-aware ("Gmail'de Aç" / "Outlook'ta Aç").
  - Real options:
    - (a) Create a provider draft. Gmail `drafts.create` needs `gmail.compose`, a RESTRICTED scope that requires a CASA assessment. Graph needs `Mail.ReadWrite`.
    - (b) A `mailto:` handoff, which needs no scope but loses threading headers.
  - Decide in INTEGRATION_PLAN. "Göndermeyi Onayla" needs the send scope via progressive auth: `gmail.send` (sensitive) or Graph `Mail.Send`.
- **SREQ-17**: Commitments "Ertele" opens a date/time reschedule sheet. "Kaynağı Gör" opens the related email or source detail. [QA§7]
  - **ADOPT.**
- **SREQ-18**: "Plan bölümünde 'Taahhütler' ekranı". [PD§22]
  - **ADOPT.** Entry points: the Plan tab (segment or list) and the Person page.

### Plan / Calendar / Meeting Prep / Post-meeting
- **SREQ-19**: "Planla" shows the proposed block "14:00–16:30" with task "Teklif hazırla". Actions "Onayla / Saati Değiştir / İptal". After approval the timeline shows the AI task block. [QA§6]
  - **ADOPT.** "Saati Değiştir" opens a time picker limited to free slots.
  - Tag the created event for reconciliation: Google `extendedProperties.private`, Graph `singleValueExtendedProperties`.
- **SREQ-20**: Conflict alert "Takvim Çakışması · 14:00–15:00 müşteri toplantısı / 14:30 doktor randevusu". AI line: "Müşteri toplantısını 13:00'e almayı önerebilirim." Actions "Seçenekleri Gör / Yoksay". [PD§24]
  - **ADAPT:**
    - If the user is not the organizer, the event cannot be moved. Offer a "yeni saat öner" reply draft instead.
    - The approval must state the side effect "Katılımcılara güncelleme gönderilir" (Google `events.patch` with `sendUpdates=all|externalOnly|none`; Graph sends updates automatically).
    - Check attendee availability only through a real free/busy API; otherwise show the limitation.
    - "Yoksay" persists a dismissal per conflict pair.
- **SREQ-21**: Live countdown "18 dakika kaldı". [PD§25]
  - **ADOPT.**
- **SREQ-22**: Meeting Prep "Not Al" opens a notes sheet or page that accepts voice or text; notes feed Post Meeting. [PD§25, RD§15]
  - **ADOPT.** MASTER has no notes entity. Add a `meeting_notes` table (user_id, calendar_event_id, body, source=text|voice, created_at, retention-bound), or `captures` with kind=`note` and an event FK.
  - Voice goes through the STT adapter.
- **SREQ-23**: "Toplantıyı Başlat" is an external Google Meet / Teams handoff. [QA§8]
  - **ADOPT** (MASTER only says "Meeting link gerçek external handoff").
  - Link sources: Google `hangoutLink` or `conferenceData.entryPoints[type=video].uri`; Graph `onlineMeeting.joinUrl`.
  - Open only https links on allowlisted conferencing domains (meet.google.com, teams.microsoft.com, *.zoom.us). Never open arbitrary links from email bodies.
- **SREQ-24**: Post-meeting parsed card "Yeni Taahhüt · Mehmet'e teklif gönder · Yarın" with CTA "Kaydet". [PD§26]
  - **ADAPT.** See C-06.

### Life Intelligence
- **SREQ-25**: Per-type actions [RD§14, QA§3]:
  - Kargo: "Takibi Gör"
  - Uçuş: "Detayı Gör", "Takvime Ekle"
  - Rezervasyon: "Detayı Gör", "Hatırlat"
  - Ödeme: "Hatırlat"
  - Abonelik: "Yenileme Detayı"
  - Güvenlik: "Kaynağı Aç"
  - One reusable Life Detail bottom sheet [QA§13].
  - **ADOPT, with these limits:**
    - Show a tracking URL only if it is present in the source and its domain is validated. Otherwise open the source email. Never invent a tracking status; MASTER has no carrier API.
    - Security alerts: open the source only, and never surface links embedded in the alert as CTAs.
    - Before a mail is classified as a security alert, require `Authentication-Results` DKIM/SPF pass for the claimed sender domain (anti-phishing).
- **SREQ-26**: Fixtures "TK2412 İstanbul→Antalya Yarın 09:15", "Netflix 9 Eylül'de yenileniyor", "Google hesabında yeni giriş.", "Elektrik faturası 1.842 TL Son ödeme: 10 Eylül". [PD§27]
  - **ADAPT.** Use them only as demo-seed data behind the demo flag (M§89, M§100), with dates relative to now.

### Assistant / Voice / Capture / Reminders
- **SREQ-27**: Extra suggested prompt "Ödenmesi gereken bir şey var mı?" and placeholder "Dijital hayatına sor…". [PD§28]
  - **ADOPT.**
- **SREQ-28**: Assistant "+" / attachment button opens a menu "Fotoğraf / Screenshot / PDF-Dosya / Link / Text" leading to Universal Capture. Today also gets a quick capture action. [PD§28, RD§3, RD§17]
  - **ADOPT.**
- **SREQ-29**: Rich answer cards: mail card, calendar card, person card. [PD§28]
  - **ADOPT.** Cards open Email Detail, Event/Meeting Prep and Person respectively.
- **SREQ-30**: Voice examples "Yarınki toplantımı 30 dakika ileri al.", "Bugünkü brifingimi oku.", "Mehmet'e cevap vermem gerekiyor mu?"; "Her write action sonrasında visual confirmation". Fullscreen UI with a minimal waveform. [PD§29]
  - **ADAPT.** See C-07. Visuals use PRIM `gradient/night`.
- **SREQ-31**: Capture screen title "Dijital Asistan'a Ekle". The result shows "Detected Type / Extracted Information / Suggested Action". Example "Etkinlik tespit edildi. 12 Eylül · 20:00 · Zorlu PSM" with "Takvime ekleyeyim mi?". [PD§30, RD§17]
  - **ADOPT.**
- **SREQ-32**: Pickers [QA§9]:
  - Fotoğraf: camera or photo picker
  - Screenshot: photo picker
  - PDF: file picker
  - Link: URL entry sheet
  - Text: text input
  - **ADOPT.**
    - `expo-image-picker` uses the Android system Photo Picker, so no `READ_MEDIA_IMAGES` permission is needed (Google Play Photo & Video Permissions policy).
    - `expo-document-picker` with `application/pdf` and `image/*`.
    - Request the camera permission only when "Kamera" is chosen.
- **SREQ-33**: Capture actions "Takvime Ekle / Görev Oluştur / Hatırlatıcı Kur". Each goes Action detail → Approval → Success → Today and must not return straight to Today. [QA§9]
  - **ADOPT.**
- **SREQ-34**: "Uygun zamanda" explainer "Takvimindeki boşluklara göre uygun zamanı Dijital Asistan seçer." plus a final confirmation. [RD§9]
  - **ADOPT.**
  - Show the resolved time and its reason (PRIM: "Takvimine göre: 12:10"; "takvim boşluğuna ve mesai saatine göre seçilir").
  - Algorithm: first free slot of at least 15 minutes inside working hours (default 09:00–18:00, user timezone), before the item's due time, never in quiet hours.
- **SREQ-35**: One canonical `SmartReminderSheet`, callable from Email, Deadline, Meeting, Commitment, Life item and Assistant action. The old Today custom sheet is removed. [RD§9, QA§3]
  - **ADOPT.**
  - Each preset shows its absolute time (PRIM: "30 dakika önce · 16:30").
- **SREQ-36**: "Kendin seç" opens a real date/time picker. [RD§8]
  - **ADOPT** with `@react-native-community/datetimepicker`.

### VIP / Person / Search
- **SREQ-37**: VIP categories "eş, aile, yönetici, önemli müşteri, özel kişiler" and a VIP person card. [PD§32]
  - **ADAPT.** Store an optional `relationship` enum (`spouse|family|manager|key_client|other`).
  - Do not request device Contacts permission by default. Suggest VIPs from communication frequency (PRIM: "son 30 günde 14 kez yazıştın. VIP yapayım mı?") and allow manual add by email.
- **SREQ-38**: Person page query box "Mehmet hakkında sor…". [PD§33]
  - **ADOPT** as a person-scoped assistant thread.
- **SREQ-39**: Person Intelligence entry points: email sender avatar/name, meeting participant, VIP row, search person result. [RD§3, QA§12]
  - **ADOPT.**
- **SREQ-40**: Search examples "Geçen ay gelen uçak bileti / Mehmet'in teklif maili / Ödemem gereken faturalar / Ekim toplantıları". Each result shows "source, date, AI summary, original link". [PD§34]
  - **ADOPT.**
- **SREQ-41**: Search result routing [RD§18, QA§13]:
  - person → Person Intelligence
  - mail → Email Detail
  - meeting → Meeting Prep / Event Detail
  - flight, payment, subscription → Life Detail sheet
  - **ADOPT.**

### Approval
- **SREQ-42**: "Onay Bekleyenler" entry in the Today header and in Profile, with a count badge ("3"). [RD§3, QA§2]
  - **ADOPT.**
- **SREQ-43**: "AI write action sonrası otomatik açılabilmeli" and "Approval Sheet veya Approval Center". [RD§3, RD§10, QA§2]
  - **ADAPT.** Use an inline approval bottom sheet (minimum effort, M§3.3). The item persists as `pending` and stays visible in the Approval Center. Do not force-navigate away.
- **SREQ-44**: Approval "Düzenle" opens an edit sheet where the action's fields can be changed. [QA§2]
  - **ADOPT.** An edit creates a new payload version and is re-validated with Zod. Changed content gets a new idempotency key.
- **SREQ-45**: Approval item shows "Hangi kaynak nedeniyle?"; a success state follows approval. [RD§10]
  - **ADOPT.** Show success only when status is `executed`. Render `executing` and `failed` states honestly.
- **SREQ-46**: "AI tarafından önerilen planlama" and "Universal Capture action" go through approval. [QA§2]
  - **ADOPT.** Map them to `calendar_create`, `task_create` or `reminder_create`.

### Onboarding
- **SREQ-47**: Intro copy [PD§36]:
  - S1: "Dijital hayatın artık tek yerde." / "Başlayalım"
  - S2: "Gürültüyü azalt." (127 mail ↓ 3 önemli konu)
  - S3: "Gününü sen sormadan hazırlarız."
  - S4: "Kontrol her zaman sende." (read-only / approval-first)
  - **ADOPT** the copy with PRIM visuals. Present the numbers as an illustration.
- **SREQ-48**: "Google ile devam et / Apple ile devam et / Microsoft ile devam et / E-posta ile devam et" and "Terms/Privacy minimal". [PD§37]
  - **ADOPT.**
  - On iOS, Sign in with Apple is mandatory whenever third-party logins are offered (App Store Guideline 4.8).
  - Email sign-in: Supabase email OTP (6-digit code), no passwords.
- **SREQ-49**: "Dijital hayatını bağla." with cards Gmail / Outlook / Google Calendar / Microsoft Calendar / Apple Calendar and statuses "Bağla / Bağlandı". [PD§38]
  - **ADAPT.** The card list depends on the platform: Apple Calendar only on iOS (EventKit), "Cihaz takvimi" on Android.
- **SREQ-50**: "Kullanıcı minimum bir mail + bir calendar bağladığında devam edebilsin." [PD§38]
  - **ADAPT.** See C-17.
- **SREQ-51**: Permission explainer before OAuth [PD§39]:
  - Title: "Gmail erişimine neden ihtiyacımız var?"
  - Bullets: ✓ önemli mailleri bulmak ✓ cevap bekleyenleri tespit etmek ✓ son tarihleri anlamak
  - Reassurance: "Sen onaylamadan mail göndermeyiz." / "Verilerin reklam için kullanılmaz." / "Bağlantını istediğin zaman kaldırabilirsin."
  - CTA: "Güvenli şekilde bağla"
  - **ADOPT.** This also serves as the in-product disclosure Google expects for sensitive/restricted scopes.
- **SREQ-52**: Calendar permission screen [RD§2]:
  - Title: "Takvimine neden erişmemiz gerekiyor?"
  - Bullets: ✓ Gününü anlayabilmek ✓ Toplantı çakışmalarını fark etmek ✓ Yaklaşan etkinlikleri brifinge eklemek ✓ Uygun zaman önerileri sunmak
  - Trust line: "Takviminde değişiklik yapmadan önce senden onay isteriz."
  - CTAs: "Takvim Erişimine İzin Ver" / "Şimdi Değil"
  - Denied state: "Takvim erişimi kapalı" / "Dilersen Ayarlar'dan daha sonra açabilirsin." with CTA "Ayarları Aç"
  - **ADOPT:**
    - "Ayarları Aç" calls `Linking.openSettings()`.
    - iOS 17+ needs `NSCalendarsFullAccessUsageDescription`, and `NSRemindersFullAccessUsageDescription` if Reminders are used.
    - Android needs `READ_CALENDAR`; request `WRITE_CALENDAR` only when writing.
- **SREQ-53**: "Günün ne zaman başlıyor?" with times and toggles for Morning / Midday / Evening, plus "Hafta sonu brifing gönder." [PD§41]
  - **ADOPT.** Defaults follow PRIM: 08:00 / 13:00 / 19:00 (secondary says 07:30).
  - Midday and Evening show a lock icon on Free and stay visible (PRIM).
- **SREQ-54**: "Senin için neler daha önemli?" chips "İş / Aile / Finans / Seyahat / Alışveriş / Randevular / Son Tarihler / Hepsi", multi-select. [PD§42]
  - **ADOPT.** Store in `user_preferences.interest_categories`. Use as a soft weighting below learned preferences. "Hepsi" selects all.
- **SREQ-55**: First analysis steps "Son 72 saat taranıyor / E-postalar sınıflandırılıyor / Takvim kontrol ediliyor / Açık konular aranıyor" with counters "127 mail bulundu / 8 potansiyel önemli konu / 4 yaklaşan etkinlik / 2 olası takip". [PD§44]
  - **ADAPT.** Drive steps and counters from the real job progress (`sync_states` or a job row via Realtime or polling). No timer animations.
- **SREQ-56**: "Hazır." / "Son 72 saatte bilmen gereken 5 şey bulduk." with 5 cards and CTA "Brifingimi Gör". [PD§45]
  - **ADAPT.** N is the real count (0–5). Write the zero case, e.g. "Son 72 saatte acil bir şey yok."
- **SREQ-57**: Notification pre-prompt "Sadece önemli olduğunda haber verelim." [PD§46]
  - Examples: "Toplantına 20 dakika kaldı." / "Bugün cevaplaman gereken önemli bir mail var." / "Kargon bugün geliyor."
  - CTAs: "Bildirimleri Aç" / "Şimdi Değil"
  - **ADOPT.** Android 13+ requires the runtime `POST_NOTIFICATIONS` permission. "Şimdi Değil" re-asks later in context, never on every launch.
- **SREQ-58**: Splash "Logo + tagline animasyonu". [PL]
  - **ADOPT.** Static native splash via `expo-splash-screen` (bg `#F5F4F0`, dark `#141311`), optionally followed by a JS transition.

### Notifications / Android NI / Widgets
- **SREQ-59**: Push copy [PD§48]:
  - Morning: "☀️ Günaydın. Bugün bilmen gereken 5 şey var."
  - Critical: "Ahmet senden bugün 17:00'ye kadar dönüş bekliyor."
  - Meeting: "14:30 toplantına 20 dakika kaldı. 3 hazırlık notun var."
  - Midday: "Sabahından beri 2 önemli gelişme oldu."
  - Evening: "Bugünden yarına kalan 3 konu var."
  - **ADAPT.** See C-14. Copy that names a person or includes content is used only in full-detail mode.
- **SREQ-60**: "Yalnızca gerçekten önemliyse bildir." [RD§4]
  - **ADOPT** as a toggle that raises the decision-engine threshold to critical/high only.
- **SREQ-61**: Briefing settings "Timezone" and "Sessiz günler". [RD§4]
  - **ADOPT:**
    - Timezone is an IANA value, auto-detected from `expo-localization` with a manual override, stored separately from the profile (M§39).
    - Silent days suppress scheduled briefings per weekday. This is distinct from quiet hours.
- **SREQ-62**: Android NI "App list. Priority rules. Privacy warning." [PD§47]
  - **ADOPT.**
  - Build the app list from packages already seen in notifications, plus a `<queries>` MAIN/LAUNCHER intent query. Do not use `QUERY_ALL_PACKAGES`, which Google Play restricts.
  - Per-app rules reuse the Priority Rules engine with `source_type=android_notification`.
- **SREQ-63**: Widget content [PD§49]:
  - Small: "Next important thing"
  - Medium: "Bugün · 3 öncelik"
  - Large: "Daily Brief / Next Event / Open Follow-ups"
  - **ADOPT.** Widget content respects the notification detail level; in generic mode it shows counts only.

### Paywall / Referral
- **SREQ-64**: Paywall headline "Dijital Asistan'ın tamamını aç." [PD§50]
  - Benefits: Sınırsız AI analiz / Akıllı takip / Meeting Prep / Gün Ortası & Akşam Brifingi / Sesli brifing / AI hafıza / Çoklu hesap / VIP kişiler / Android Notification Intelligence.
  - The annual plan is labelled "En Avantajlı". Secondary action "Free ile devam et". "No manipulative dark patterns."
  - **ADAPT:**
    - Replace "Sınırsız AI analiz" with e.g. "Genişletilmiş AI analiz" (C-10).
    - Hide the Android NI benefit on iOS.
    - Include the full Pro list from M§44 (Commitments, Universal Capture, advanced planning).
    - Show a visible close button, "Satın Alımları Geri Yükle", and functional Terms (EULA) and Privacy links (App Store Guideline 3.1.2).
- **SREQ-65**: "Aylık 199 TL / ay · Yıllık 1.490 TL / yıl · 7 Gün Ücretsiz Pro · CTA Ücretsiz Dene". [PD§50]
  - **ADAPT.** Configure prices in App Store Connect and Play Console. The UI renders RevenueCat `product.priceString`.
  - Compute the savings % at runtime (1490 / (199×12) = 62.4%, i.e. "%38 tasarruf", and "ayda 124 TL" per PRIM).
  - Show trial copy only when the introductory offer is eligible: `checkTrialOrIntroductoryPriceEligibility` on iOS, the subscription option `freePhase` on Android.
- **SREQ-66**: "Arkadaşını Davet Et" / "İkiniz de 14 gün Pro kazanın." with share options, invite link and referral status. [PD§51]
  - **ADOPT.** 14 days as a configurable default. PRIM cap "Sınır: yılda 6 davet".
  - Grant through a server-side entitlement stored separately from store entitlements (M§43), e.g. a RevenueCat promotional entitlement with `end_time_ms`, or our own `referral_credits`. The API shape needs verifying.
  - Record in STORE_CHECKLIST that App Store Guideline 3.1.1 treats non-IAP unlock mechanisms as a store-policy risk.

### Settings / Privacy
- **SREQ-67**: Integrations: Gmail, Outlook, Google Calendar, Microsoft Calendar, Apple Calendar, Google Tasks, Microsoft To Do, Apple Reminders, with "Statuses. Connected accounts. Multiple account support. Add account. Disconnect." [PD§52]
  - **ADOPT** the UI (providers are already in M§75).
  - Statuses: Bağlı / Yeniden bağlan / Hata / Senkronize ediliyor.
  - Additional accounts require Pro (M§44).
- **SREQ-68**: Data Source Control [PD§54]:
  - Gmail: "Read email / Analyze attachments / Detect deadlines / Prepare draft replies"
  - Calendar: "Read events / Suggest schedule / Create events with approval"
  - Individual toggles.
  - **ADOPT** as per-account `capabilities` flags that are enforced server-side in the pipeline. For example, attachments off means attachments are neither downloaded nor parsed; read off means ingestion pauses.
- **SREQ-69**: Profile list includes "Briefing Settings, VIP People, Integrations, Help, Feedback, Sign Out". [PD§55]
  - **ADOPT** as a union with M§130 (see C-18).
- **SREQ-70**: Help: "FAQ / Getting Started / Integrations / Privacy / Contact Support". [RD§4]
  - **ADOPT.** Contact Support creates a `support_tickets` row with an M§62 category plus platform and app version.
  - The FAQ is single-sourced in `packages/i18n` or content and shared with web `/support`.
- **SREQ-71**: Feedback: "Bug Report / Feature Request / General Feedback / Rating / optional comment". [RD§4]
  - **ADAPT.** Add "AI Kalitesi" (M§62). Keep the star rating internal.
  - Store reviews go only through `expo-store-review` `requestReview()` (Apple allows at most 3 prompts per 365 days). No review gating.
- **SREQ-72**: Learned preference "Edit → Priority: High / Normal / Low → Save". [RD§11, QA§10]
  - **ADOPT.**
- **SREQ-73**: Privacy sub-screens [RD§12]:
  - "Permissions": each integration's permission status.
  - "Delete History": confirmation modal.
  - "Export": request → preparing → ready.
  - "Delete Account": multi-step with a danger zone.
  - **ADOPT:**
    - Permissions lists granted OAuth scopes and OS permissions.
    - Export uses real job statuses.
    - Deletion: consequences → re-auth → type-to-confirm → queued status. For Sign in with Apple accounts, revoke the Apple token via `POST https://appleid.apple.com/auth/revoke` (Apple requirement for account deletion).
- **SREQ-74**: Retention options with a real selected state. "Sistem Ayarlarına Git" performs a real handoff. [QA§11]
  - **ADOPT** (`Linking.openSettings()`).
- **SREQ-75**: Appearance offers only System / Light / Dark. The accent-color picker (Mavi / Yeşil / Sarı / Kırmızı) is removed; brand indigo is fixed. [QA§19]
  - **ADOPT.**
- **SREQ-76**: "Etkileşimlerimden öğren" [RD§11].
  - **ADOPT** as the TR label of M§32 "Learn from interactions".
- **SREQ-77**: "Veriler aktarım sırasında ve saklanırken şifrelenir." or "Verilerin güvenli bağlantılar üzerinden işlenir ve saklanırken şifrelenir." [RD§13]
  - **ADOPT** the first variant (identical to M§40).
- **SREQ-78**: "Training toggle wording son derece açık olsun." [PD§53]
  - **REJECT the toggle.** User data is never used for model training, so a training toggle would itself mislead.
  - **ADOPT the statement** "Mail içeriklerin yapay zekâ modellerini eğitmek için kullanılmaz." (PRIM uses "Mail içerikleri model eğitiminde kullanılmaz."). Document it in PRIVACY.md against Anthropic/OpenAI API terms, where no training is the default.

### States / A11y / Design system / Copy
- **SREQ-79**: Empty-state copy [PD§57]: "Her şey kontrol altında." / "Bugün takvimin oldukça sakin." / "Bekleyen takip yok." / "Mailini bağlayarak önemli konuları burada görebilirsin."
  - **ADOPT** as i18n keys.
- **SREQ-80**: Error cases [PD§58]: "Connection expired, OAuth failed, Calendar permission denied, AI temporarily unavailable, No internet, Sync delayed". No technical jargon.
  - **ADOPT.** Map them to M§93 plus a partial-data state.
- **SREQ-81**: Loading states [PD§59]: skeletons, AI processing state, refreshing state, pull-to-refresh, sync status.
  - **ADOPT.**
- **SREQ-82**: Micro-interactions [PD§60]: card expand, priority swipe actions, mark-completed animation, AI analyzing, audio briefing animation, success check, approval confirmation, sheet transitions, haptic moments.
  - **ADOPT.** PRIM swipe mapping: right = "Tamamlandı".
  - Every swipe action also exists as a visible button and as `accessibilityActions`.
  - Add `expo-haptics` to the M§6 dependency list.
- **SREQ-83**: Insight feedback "👍 Doğru / 👎 Önemli değil veya context menu". [PD§61]
  - **ADOPT.** Writes `ai_feedback` with feature, model and `prompt_version_id`.
- **SREQ-84**: Component list [PD§62, PD§73]: Toast, Snackbar, Date pickers, Segmented controls, Audio controls, Chat input, Priority labels; states disabled / pressed / focus / permission.
  - **ADOPT** into `packages/ui`.
- **SREQ-85**: "Bir UI elementi button görünümündeyse … veya … button görünümünden çıkarılmalıdır." [QA§1]
  - **ADOPT.** This is the inverse of M§99: non-interactive elements must not look pressable.
- **SREQ-86**: "Color tek başına status anlamı taşımasın. Icon + text kullan." plus minimum touch target. [PD§65, RD§25]
  - **ADOPT.** 44×44pt on iOS, 48×48dp on Android, WCAG 2.2 AA contrast (4.5:1 text, 3:1 UI).
- **SREQ-87**: Tone "sakin, net, zeki, kısa, yardımcı; asla patronluk taslamasın". Good: "Takvimine eklendi." Bad: "İşleminiz başarıyla gerçekleştirilmiştir." Good: "Önemli mailler". Bad: "Elektronik posta analizi." [PD§66]
  - **ADOPT** as an i18n style guide in `packages/i18n/STYLE.md`.
- **SREQ-88**: "Text container'ları çok dar tasarlama. RTL zorunlu değil." [PD§67]
  - **ADOPT.** Test with a pseudo-locale (+40% length). RTL is out of scope; record that in KNOWN_PLATFORM_LIMITATIONS.
- **SREQ-89**: "Her kart 'Peki şimdi ne yapacağım?' sorusuna bir action sunmalıdır." [PD§74.6]
  - **ADOPT.** Every insight card has at least one primary action.
- **SREQ-90**: Representative widths: iOS 393, Android 412. [PD§64, RD§6, RD§24]
  - **ADAPT** into the QA device and viewport matrix: 375/393/430pt iOS and 360/412dp Android, plus max Dynamic Type.
- **SREQ-91**: Android: "Dynamic Island kullanma. Android status/navigation bar kullan. Back behaviour düşün." [QA§15]
  - **ADOPT.**
  - Edge-to-edge is enforced when targeting API 35+.
  - Predictive back is the default for apps targeting API 36; verify the current Play target-API rule at https://developer.android.com/google/play/requirements/target-sdk.
  - Hardware/gesture back closes sheets first.
- **SREQ-92**: Remove "yakında / coming soon / future / sonraki sürümde" from the whole project. [QA§18]
  - **ADOPT.** Add the Turkish tokens to the M§133 quality-gate grep: `yakında|çok yakında|sonraki sürüm|ileride eklenecek`.

### Web / Marketing
- **SREQ-93**: Desktop nav "Logo / Özellikler / Güvenlik / Fiyatlandırma / Giriş / Ücretsiz Başla". [QA§16]
  - **ADAPT.** Drop "Giriş": there is no end-user web app (C-24). "Ücretsiz Başla" links to store badges, or a QR code on desktop. Add "SSS".
- **SREQ-94**: Landing layout [RD§7, QA§16]:
  - Breakpoints Mobile / Tablet / Desktop; desktop content 1200–1440px.
  - Hero: text on the left, premium phone mockup on the right, plus trust text.
  - Sections: Integrations, How It Works, Morning Briefing, Mail Intelligence, Meeting Prep, Smart Planning, AI Memory, Security, Pricing, Final CTA.
  - **ADOPT**, plus FAQ from M§73. Breakpoints: <768 / 768–1199 / ≥1200.
- **SREQ-95**: Hero logos Gmail / Outlook / Google Calendar / Apple Calendar plus a privacy reassurance. [PD§70]
  - **ADOPT.** Follow Google and Microsoft brand guidelines and do not imply endorsement.
- **SREQ-96**: 6 store screenshots with fixed captions. [PD§68, RD§20]
  - **ADOPT** (captions = M§74).
  - Use current App Store Connect sizes (6.9": 1320×2868) and Play sizes (9:16, e.g. 1080×1920); verify the Apple size at submission.
  - Generate the screenshots from demo mode so the numbers are consistent (C-27).
- **SREQ-97**: 3 social ads in true 9:16, 1080×1920 [PD§69, QA§17]:
  - AD1: "284 okunmamış / 6 etkinlik / 14 görev ↓ Bugün gerçekten bilmen gereken 4 şey var."
  - AD2: "Bir maili cevaplamayı unuttuğun oldu mu?"
  - AD3: "Ben artık sabah Gmail açmıyorum."
  - **ADAPT.** AD3 must not be presented as a real attributed user testimonial (Turkish advertising rules on testimonials); use brand voice. These are design assets, not app screens.

### Process / QA
- **SREQ-98**: IA page and User Flow page (FLOW 1–6). [PD§71–72]
  - **ADAPT** into `docs/SCREEN_AND_FLOW_MAP.md` and E2E specs. REJECT them as in-app screens.
- **SREQ-99**: Final self-audit matrix "DONE / FIXED NOW / NOT APPLICABLE + reason" [RD§26]; per-button "ACTION = ? TARGET = ? SUCCESS STATE = ?" [QA§20]; QA table "Element/Flow · Status · How to reach · What it does · PASS/FAIL" [QA§22].
  - **ADOPT** into DELIVERY_CHECKLIST.md and FINAL_IMPLEMENTATION_REPORT.md as a per-screen action inventory.
- **SREQ-100**: Acceptance flows A–J [QA§21]:
  - A: onboarding → Gmail → Calendar → Permissions → Analysis → Aha → Notification → Today
  - B: Today mail → Detail → Draft → Approval → Success
  - C: Email → Task → Approval
  - D: Email → Reminder → Approval
  - E: Plan → Planla → Approval → Timeline
  - F: Prep → Person → Email → Note → Post → Commitment
  - G: Capture ×4 → Analyze → Action → Approval
  - H: Search → correct detail
  - I: Appearance → Dark
  - J: Approval Center → Edit → Approve
  - **ADOPT** as mobile E2E cases alongside M§102.
- **SREQ-101**: Figma-only instructions: Auto Layout, the page list "00 Cover … 23 Landing Page", layer names "Card/Insight/Critical", "Button/Primary/Large". [PD§63, PD§75]
  - **REJECT** as not applicable to code. Adopt developer-friendly English component APIs (`<InsightCard tone="critical">`).
- **SREQ-102**: PL architecture: "React Router v6", "React Context + useState (backend yok; tüm veri mock)", Inter font, `src/data/mock.ts`, 393px iPhone frame.
  - **REJECT.** Conflicts with M§6 (Expo Router, TanStack Query, Zustand, Supabase) and PRIM (Geist).
- **SREQ-103**: PL Turkish route slugs (`/sabah-brifing`, `/onay-merkezi`, `/kisi/:id` …).
  - **ADAPT.** Use English, locale-neutral Expo Router segments and deep links (`dijitalasistan://briefing/morning`, `/approvals`, `/person/[id]`). The UI stays Turkish.
- **SREQ-104**: PL mock data (Yunus; Ahmet Yılmaz, Mehmet Kaya, Ayşe Demir, Fatma Şahin, Can Öztürk; "5 Eylül Cumartesi").
  - **ADAPT** into the deterministic demo seed (M§89) with dates relative to now. 5 Sep 2026 really is a Saturday, but the demo must not freeze on it.

---

## Contradictions

### A. Secondary docs vs MASTER (functional; MASTER binding)
| ID | Topic | Secondary | MASTER | Resolution |
|---|---|---|---|---|
| C-01 | Onboarding order | RD§1: … Connect → **Gmail/Outlook Permission Explanation → Calendar Permission Explanation → Briefing Preferences → Personalization** → VIP … PD§39: explainer shown **before** OAuth | M§34: 5 Account, 6 Connect mail, 7 Connect Calendar, 8 Permissions, **9 Personalization, 10 Briefing schedule**, 11 VIP | Keep MASTER's order: Personalization before Briefing schedule. Show each provider/OS explainer immediately before its OAuth or OS prompt, inside steps 6/7. Step 8 "Permissions" is a review screen: granted scopes, Data Source Control toggles, calendar permission state with the denied handoff. |
| C-02 | Morning Briefing sections | PD§12: Bugünün Öncelikleri / Programın / **Cevap Bekleyenler** / Senden Beklenenler / Son Tarihler / **Kişisel Hatırlatmalar** | M§9: Bugünün Öncelikleri / Programın / Senden Beklenenler / **Senin Beklediklerin** / Son Tarihler / **Kişisel Gelişmeler** | Use MASTER's six labels exactly. |
| C-03 | Evening sections | PD§14: Tamamlananlar / Yarına Kalanlar / **Yarın Sabah** / **Takip Etmen Gerekenler** | M§11: Tamamlananlar / Yarına Kalanlar / **Takip** / **Yarının ilk etkinliği** | Use MASTER. "Yarın Sabah" content folds into "Yarının ilk etkinliği". |
| C-04 | Flow card types | PD§16: email, meeting, deadline, shipment, reservation, **bill**, **security alert**, subscription (**no flight**) | M§13: …Shipment, **Flight**, Reservation, **Payment**, Subscription, **Security** | Use MASTER's 9 types. Add Flight; bill becomes Payment. |
| C-05 | Mail category label | PD§17: "**Gereksiz /** Düşük Öncelik"; "Senden Cevap Bekleyen / Senin Cevap Beklediğin" | M§14: "Düşük Öncelik" | Use "Düşük Öncelik". "Gereksiz" is judgmental copy. |
| C-06 | Post-meeting save | PD§26: AI creates "Yeni Taahhüt" → CTA "**Kaydet**" | M§22: Commitment proposal → **Approval** → Save; M§33 includes `commitment_create` | "Kaydet" on the editable proposal card is the explicit approval. Write an `approval_actions` row (commitment_create, pending → approved → executed) for audit and idempotency, without routing through the Approval Center queue. If the parse was ambiguous (low confidence), confirmation is mandatory (M§18, M§115). |
| C-07 | Voice write actions | PD§29: "Her write action **sonrasında** visual confirmation" (implies direct execution) | M§25: "Write action gerekiyorsa → approval required" | Voice command → approval sheet → the user taps to approve (no speech-only approval for `email_send` or `calendar_update`, because misrecognition is a risk) → server execution → visual confirmation of the result. |
| C-08 | Reminder creation | PD§31: "Uygun zamanda … AI … doğru zamanı seçebilir" (implied auto-pick); RD/QA: Reminder → Approval → Success | M§29: creation via confirmation/approval; M§115: approval only "where user-visible commitment occurs" | In-app reminders (local or server push) use a confirm step inside the sheet that shows the resolved time. External reminders (Apple Reminders, Google Tasks, MS To Do) go through a `reminder_create`/`task_create` approval with the destination account. The time is never silently committed. |
| C-09 | Trial and prices | PD§50: always "7 Gün Ücretsiz Pro", hardcoded "199 TL / 1.490 TL"; PL: "7 Gün Ücretsiz hero CTA" | M§43: "free trial only if actual store product supports it"; RevenueCat; Restore; Manage | Trial CTA and copy are conditional on intro-offer eligibility. Prices come only from the store. Add "Satın Alımları Geri Yükle" and "Aboneliği Yönet", which opens the platform subscription management URL. |
| C-10 | "Sınırsız AI analiz" | PD§50 Pro benefit | M§82: per-user usage limits and rate limits | Remove "Sınırsız". Pro has higher documented limits. |
| C-11 | Android NI scope | PD§47: "All notifications / Only selected apps" | M§36: sensitive auth apps excluded by default | Even in "Tüm uygulamalar" mode, a default denylist applies: authenticator/OTP apps, banking and password managers. Android 15 also redacts OTP-bearing notifications to untrusted listeners (verify). The user can see the denylist. |
| C-12 | Android NI processing claim | Secondary code (`AndroidNotifications.tsx:189`): "Bildirim içerikleri yalnızca cihazında işlenir." | M§40: messages must match the real architecture; M§141 | Claim it only if classification actually runs on-device. If notification text goes to the server AI pipeline, say so plainly: "Seçtiğin uygulamaların bildirimleri analiz için güvenli bağlantı üzerinden sunucularımıza gönderilir; reklam için kullanılmaz." |
| C-13 | Training toggle | PD§53: "Training toggle wording …" | M§32: only "Learn from interactions" (personalization); no model training anywhere in MASTER | No training toggle. Show a static no-training statement (SREQ-78). |
| C-14 | Push content | PD§48: critical push "Ahmet senden bugün 17:00'ye kadar dönüş bekliyor." | M§86: sensitive mail details hidden by default; modes full / title-only / generic; lock-screen privacy | Default mode = generic or title-only (e.g. "Bugün cevaplaman gereken önemli bir mail var."). Names and subjects appear only in full-detail mode, opted into by the user. Morning, midday and evening examples without personal data are allowed in every mode. |
| C-15 | Life card amounts | PD§27: "1.842 TL · Son ödeme: 10 Eylül" as generic example | M§23, M§83: amount/deadline only if the source says it explicitly | Render amount and deadline fields only when grounded (`source_span` present). Otherwise show "Kaynakta kesinleşmiyor." |
| C-16 | Approval action vocabulary | PD§35: "Mail gönder / Takvim etkinliği oluştur / taşı / Görev oluştur / Hatırlatıcı ayarla"; QA§2 adds "AI tarafından önerilen planlama", "Universal Capture action" | M§33 enum: email_send, calendar_create, calendar_update, task_create, reminder_create, commitment_create | Map to the MASTER enum only. Planning becomes calendar_create. Capture becomes whichever of calendar_create / task_create / reminder_create / commitment_create applies. |
| C-17 | Onboarding gate | PD§38: can continue only after ≥1 mail **and** ≥1 calendar | M§34 silent; M§88: Apple account first, then connect Gmail; M§89: demo mode; PD§57 itself defines the empty state "Mailini bağlayarak …" | Primary CTA is enabled once at least one source is connected (mail or calendar). A skippable "Şimdilik geç" leads to Today in partial mode with connect-prompt empty states. First Analysis runs on whatever is connected. |
| C-18 | Settings list | PD§55: Profile, Subscription, Briefing Settings, Notifications, Priority Rules, VIP People, Integrations, AI Personalization, Privacy & Security, Appearance, Language, Help, Feedback, Sign Out | M§130: Profile, Connected Accounts, Notifications, Privacy, AI Personalization, Priority Rules, Appearance, Language, Subscription, **Referral, About, Delete Account** | Use the union of both lists. Delete Account is reachable from both Settings and the Privacy Center. |
| C-19 | Notification settings | RD§4: 8 toggles + "Yalnızca gerçekten önemliyse bildir." | M§35: same 8 + **Quiet Hours, Lock Screen Privacy, detail level** | Use the union. Quiet Hours, Lock Screen Privacy and the detail-level picker are mandatory. |
| C-20 | Priority rules | RD§4: VIP People, Domains, Senders, Keywords, Low-priority categories | M§31: + "VIP always notify", "mute sender"; precedence order | Use the union with the MASTER precedence: explicit rules → learned → deterministic signals → AI. |
| C-21 | Midday cadence | PD§41: Midday Pulse fixed 13:00 toggle; PD§13 always shows a screen | M§10: generate/notify **only on meaningful change** | 13:00 is the evaluation window. Generate and push only if there is at least one meaningful delta since morning; otherwise mark `skipped` (backoffice M§54 metric). If the screen is opened with no delta, show "Sabahından beri önemli bir değişiklik yok." |
| C-22 | Localization | PD§67: "ileride İngilizce" (future) | M§39: English **fully supported** now | Full EN at launch. All strings go through i18n keys. |
| C-23 | Dark mode scope | RD§5, QA§14: at least 7 representative screens | M§38: all shared components theme-aware; no hardcoded white | Every screen supports dark mode. The 7 screens are only the visual QA baseline. |
| C-24 | Web login | QA§16 nav has "Giriş" | M§73 routes: `/`, `/pricing`, `/privacy`, `/terms`, `/support`, `/data-deletion`; no user web app | Remove "Giriş". `/data-deletion` hosts an email-verified (OTP) deletion request form, which Google Play's account-deletion policy requires as a web resource. |
| C-25 | Widgets | PD§49: Small / Medium / Large + lock-screen concepts | M§37: + Android 2×2 and 4×2; privacy-safe; deep links | Use the union. |
| C-26 | Landing sections | RD§7, QA§16: no FAQ | M§73: includes FAQ | Add FAQ. |
| C-27 | Marketing truthfulness | Secondary code `Landing.tsx`: "Kredi kartı gerekmez · 7 gün ücretsiz"; "7 Gün Ücretsiz Başla" | M§74: copy must match real capability; M§141 | Remove "Kredi kartı gerekmez": store trials require a store account with a payment method. Trial wording only if the offer exists. |
| C-28 | Follow-up labels | PD§20: "1 Gün Sonra Hatırlat", "Takibi Kapat" | M§17: "Yarın hatırlat", "Kapat" | Use the MASTER labels. "Yarın hatırlat" opens SmartReminderSheet preselected to "Yarın sabah". |
| C-29 | Email detail meta | PD§18: Sender / Subject / **Time**; no Source or Original | M§15: Sender, Subject, **Date**, AI Summary, Key Points, **Source**, **Original Mail** | Use MASTER. |
| C-30 | Audio | PD§12: Play/Pause, ±15s, 1x/1.25x/1.5x | M§9: + **seek** | Add a seek bar. |
| C-31 | Privacy highlights copy | PD§53: "Verilerin reklamverenlere satılmaz." / "**Kritik** işlemler sen onaylamadan gerçekleştirilmez." | M§40: "Verilerin reklam amacıyla satılmaz." / "**Önemli** işlemler sen onaylamadan gerçekleştirilmez." | Use MASTER copy verbatim. |
| C-32 | Capture extraction types | PD§30: event, task, deadline, contact, note | M§27: Event, Task, Deadline, Person, Payment, Reservation, Flight, Shipment, Product, Note | Use MASTER's 10 types. |
| C-33 | Capture sources | PD§30: photo, screenshot, PDF, link, text | M§27: + File; M§28 share extensions | Use the MASTER set plus share-sheet entry. |
| C-34 | First flow ends | PD§72 FLOW 1: … Analysis → First Brief → Home (no notification step) | M§34: Aha → Notification Permission → Today (RD§1 agrees) | Use MASTER. |
| C-35 | Integrations on Android | PD§38/§52 list Apple Calendar and Apple Reminders for everyone | M§75: Apple = EventKit (iOS); Android = device calendar | Filter by platform. Apple Calendar and Apple Reminders appear on iOS only; "Cihaz Takvimi" appears on Android. |
| C-36 | Conflict resolution | PD§24: "Müşteri toplantısını 13:00'e almayı önerebilirim." | M§20: no fabricated availability; M§33: side effect disclosure | See SREQ-20. |
| C-37 | Approval navigation | RD§3: Approval Center "otomatik açılabilmeli" | M§3.3 minimum effort; M§33 | Inline approval sheet; Approval Center is the persistent queue (SREQ-43). |

### B. Secondary vs PRIMARY (visual; PRIMARY wins)
| ID | Secondary (PL / prototype) | PRIMARY | Resolution |
|---|---|---|---|
| V-01 | Font Inter ("SF Pro hissi") | Geist, with -apple-system fallback | Geist, via `expo-font`. Check Turkish glyph coverage (İ, ı, ş, ğ). |
| V-02 | Neutrals cool: bg `#F8F8FC`, text `#0F0F1A` / `#6B6B80` / `#A0A0B2`, border `#E8E8F0` | Warm: bg `#F5F4F0`, surface `#FFFFFF`, surface-2 `#F0EFEB`, hairline `#E9E7E1`, ink `#1A1917` / `#6B6860` / `#9B978E` / disabled `#B8B4AA`, editorial paper `#FBFAF7` | PRIMARY. |
| V-03 | Status colors are iOS system colors: `#34C759` / `#FF9F0A` / `#FF3B30` / `#007AFF` | success `#2FA062`, warning `#E09A1C`, critical `#E0553F`, info `#3B82E6`, each with soft and text variants | PRIMARY. |
| V-04 | Badges CRITICAL (coral) / UPCOMING (**amber**) / DEADLINE (**indigo soft `#EEEEFF`**) | Colored only for ACİL (coral), SON TARİH (amber), GÜVENLİK (coral), ONAYLANDI (green); all other badges neutral; TR labels | PRIMARY. |
| V-05 | Primary dark `#4647C7`; hero is "indigo gradient + glassmorphism hint" | pressed `#4B4CCB`, soft `#EDEDFC`, text-on-soft `#4547C9`; gradients dawn `160deg #1E1E4C→#3B3CA8→#7071EA` (morning), night `180deg #15153A→#25266A→#3B3CA8` (voice/analysis), dusk `160deg #2A1E3F→#4A3A8A→#8C6BD6` (evening) | PRIMARY. |
| V-06 | Emoji icons (🔒 📣 🆓 …) | Material Symbols Rounded | Material Symbols Rounded (Apache-2.0), bundled as a font or SVG subset. No emoji UI icons. The ☀️ emoji in the morning push copy may stay. |
| V-07 | Dark tokens unspecified or ad hoc | bg `#141311`, surface `#1F1E1B`, surface-2 `rgba(255,255,255,.08)`, text `#F2F0EB`, secondary `#A39F96`, tertiary `#7A776F`, primary `#8586F2`, glow `#A9AAF5`, critical-text `#F08B78`, warning-text `#F0B85A`, success-text `#6FCF97`, on-primary `#0F0F2A` | PRIMARY. |
| V-08 | Radius sm 8 / md 12 / lg 16 / xl 20; card shadow `0 1px 8px rgba(15,15,26,.06)` | Defined in PRIM `01 Tasarim Sistemi` (extract there) | PRIMARY. |
| V-09 | Reminder preset label "Kendin seç" | "Özel zaman" | Copy conflict between PRIMARY and MASTER. MASTER §29 names "Kendin seç" explicitly, so use **"Kendin seç"**; visual treatment per PRIMARY. |

### C. Secondary docs contradicting each other
| ID | Conflict | Resolution |
|---|---|---|
| S-01 | PD§38 blocks progress without mail + calendar, yet PD§57 defines the Today empty state "Mailini bağlayarak …", which implies Today is reachable without mail | C-17: at least one source; partial mode allowed. |
| S-02 | PD§21 bucket "Yakında" vs QA§18 "yakında … bütün projede ara ve kaldır" | Rename the bucket (SREQ-11). |
| S-03 | Numbers disagree: Today "5 şey" (PD§8) vs AD1 "4 şey" (PD§69); Mail Intelligence "83 mail, 6 dikkat" (PD§17) vs screenshot "83 mail. Gerçekten önemli olan 4." (PD§68); Noise "127 mail → 3 önemli konu" (PD§36) vs First Analysis "127 mail, 8 potansiyel" and Aha "5 şey" (PD§44–45) | Marketing assets are rendered from one deterministic demo dataset so every figure is consistent. In-app numbers are always computed. |
| S-04 | Reminder preset order: PD§31 puts "Kendin seç" before "Uygun zamanda"; RD§8/§9 put "Uygun zamanda" before "Kendin seç" | MASTER order (§29): 30 dk önce, 1 saat önce, Bu akşam, Yarın sabah, Uygun zamanda, Kendin seç. |
| S-05 | PD§4 "Dark Mode için representative ana ekranlar" vs QA§14 "Appearance'da Dark seçildiğinde uygulamanın ana ekranları gerçekten dark theme'e geçsin" | Global theme state across all screens (MASTER §38). |
| S-06 | PD§67 "ileride İngilizce" vs RD§4 Language "Türkçe / English" now | EN now (MASTER). |
| S-07 | PD§72 FLOW 2 ends at "Send"; RD§22 FLOW 2 is "Approval → Success" | Generate → Edit → Approval → Send → confirmation of the executed send (M§16, M§98). |
| S-08 | PD§12 briefing lists both "Cevap Bekleyenler" and "Senden Beklenenler" (duplicative); PD§17 uses "Senden Cevap Bekleyen / Senin Cevap Beklediğin" | MASTER §9 labels. |
| S-09 | PD§41 morning 07:30 vs PRIM 08:00 (MASTER silent) | Default 08:00 / 13:00 / 19:00; weekly Sunday 18:00 (PRIM). |
| S-10 | PL "Bottom nav: beyaz, top border" and hero glassmorphism vs PD§4 "blur/glass … abartmadan" | PRIMARY visuals. |
| S-11 | PL puts WeeklyReport, Paywall, Referral and Widgets under `marketing/`, alongside app-store/social/landing | Weekly Review, Paywall and Referral are product screens. Widgets are native targets. Store, social and landing assets belong in `apps/web` and design assets, not in the mobile app. |

### D. PRIMARY copy/claims vs MASTER (found incidentally; MASTER binding functionally)
| ID | PRIMARY | Issue | Resolution |
|---|---|---|---|
| P-01 | "Uçtan uca TLS · Veriler AB'de (Frankfurt) saklanır · KVKK ve GDPR uyumlu" (`07 Hesap Gizlilik Pro`) | "Uçtan uca" wording risks an E2E claim (M§40). The region claim is true only if the Supabase project is eu-central-1 and storage/backups match, and AI providers may process outside the EU. "KVKK ve GDPR uyumlu" is an unverified legal claim. | Use "Veriler aktarım sırasında ve saklanırken şifrelenir." State the storage region only if configured, and disclose AI subprocessors and cross-border transfer (KVKK Art. 9) in `/privacy`. Replace "uyumlu" with rights-oriented copy until legal review. |
| P-02 | "Günde ortalama 3 bildirim." (`02 Onboarding`) | A factual claim that must be enforced | Implement a default daily cap on non-critical pushes in the decision engine (M§132), or rephrase to "Günde birkaç bildirimle sınırlı tutarız." |
| P-03 | "Deneme bitmeden 24 saat önce hatırlatırız." | Must be real | Schedule a push from the RevenueCat `expiration_at` / webhook (trial type), or remove the line. |
| P-04 | "Onaylananlar geçmişte 30 gün saklanır." / "geçmiş özetler 30 gün saklanır" | Conflicts with M§41 default retention of 90 days | Show copy built from the configured retention (`{retention}`), or define and document a separate approval-history retention in DATABASE_AND_RLS_PLAN. |
| P-05 | "Mail içerikleri model eğitiminde kullanılmaz." | True only under API no-training terms | Keep, and document the providers' terms in PRIVACY.md. |
| P-06 | Referral "Sınır: yılda 6 davet" | MASTER silent | Adopt as the default config (`referral.max_rewards_per_year=6`). |

### E. Prototype-only behavior required by or visible in secondary (FLAG, never copy)
- **F-01**: Fake `setTimeout` loading and success in 15 files: `ApprovalCenter`, `UniversalCapture`, `EmailDetail`, `SmartFollowUp`, `PlanScreen`, `CommitmentTracker`, `ErrorStates`, `SecurityPrivacy`, `FeedbackScreen`, `VoiceAssistant`, `AssistantScreen`, `OnboardingFlow`, `SplashScreen`, `components/ui/SmartReminderSheet`, `components/cards/InsightCard`. Replace with real mutation states from TanStack Query (`isPending`, `onError`).
- **F-02**: Profile group "Tasarım Sistemi" navigates in-app to Boşluk/Hata/Yükleme Durumları, Design System, Bilgi Mimarisi, User Flow Diyagramları, Bildirim Örnekleri, Widget Showcase, App Store Görseller, Sosyal Reklamlar, Landing Page and "Android Frame (412px)" (`ProfileScreen.tsx:55–70`). This is prototype-only navigation and must be excluded. An optional dev-only component gallery may exist behind `EXPO_PUBLIC_DEV_MENU`.
- **F-03**: The "Abonelik" row always opens the Paywall, even for Pro users, with a hardcoded "14 gün kaldı". The real behavior is a subscription status screen (plan, renewal date or trial end from `CustomerInfo`, Restore, Manage) that shows the Paywall only for Free users.
- **F-04**: The "Android Bildirimleri" row is visible on every platform. Show it only when `Platform.OS==='android'`.
- **F-05**: QA§4/§5/§8/§11 ask for "external-mail opening state", "external app handoff state", "handoff state". Replace with real `Linking.openURL` / `Linking.openSettings()` handoffs. No simulated "opening…" screens.
- **F-06**: RD§12 export "preparing / ready" and delete "multi-step" become real job statuses (`data_export_requests`, deletion job). Never show a fake "silindi" (M§129).
- **F-07**: RD§22 FLOW 6 "Trial → Pro Success" happens only after RevenueCat returns `customerInfo.entitlements.active['pro']`.
- **F-08**: The First Analysis animated counters (PD§44) must reflect real job progress.
- **F-09**: Integration "Bağlandı" toggled locally in the prototype (PD§38) must come from real OAuth completion plus a persisted `connected_accounts` row.
- **F-10**: "Timeline updated" after approval (QA§6) must come from re-fetching provider data after the write, not a local insert.
- **F-11**: `UserFlows.tsx` "7 Gün Trial" diagram and similar flow diagrams do not ship in the app.
- **F-12**: Hardcoded prices and discounts ("199 TL", "1.490 TL", "Aylık 124 TL · %38 indirim") must be store-driven (C-09).
- **F-13**: The Android NI "yalnızca cihazında işlenir" claim (C-12) and the landing "Kredi kartı gerekmez" claim (C-27).

---

## Normalized requirement catalogue
Format: `ID [M§] requirement`. Every line is intended to be testable. The IDs cover MASTER §1–§154.

### Process / modes
- REQ-PROC-01 [§0A] In Plan Mode: no production code, no fake files, no placeholder code, no user questions, no "devam edeyim mi?", no stopping for indecision.
- REQ-PROC-02 [§0A] Plan produces docs/IMPLEMENTATION_PLAN.md, ARCHITECTURE_DECISIONS.md, DESIGN_AUDIT.md, SCREEN_AND_FLOW_MAP.md, DATABASE_AND_RLS_PLAN.md, INTEGRATION_PLAN.md, AI_PIPELINE_PLAN.md, BACKOFFICE_PLAN.md, SECURITY_AND_PRIVACY_PLAN.md, TEST_PLAN.md, DELIVERY_CHECKLIST.md.
- REQ-PROC-03 [§0A] The plan answers all 25 enumerated questions: monorepo, packages, apps and shared packages, exact DB schema, RLS, OAuth flows, sync, AI pipeline, AI step per data type, cost control, navigation and screen map, per-screen interactions, backoffice IA and modules, admin RBAC, Approval Center, notifications, RevenueCat, referral, privacy/deletion/export, tests, CI/CD, credentials, credential-less development, platform limits, design↔requirement mapping.
- REQ-PROC-04 [§0A] Every technical decision and its rationale is recorded in ARCHITECTURE_DECISIONS.md.
- REQ-PROC-05 [§0A] Plan detail is sufficient for an independent Claude Code session to implement without clarification: concrete providers, flows, tables, endpoints/functions, security rules and tests.
- REQ-PROC-06 [§0B] Execution starts by reading the plan docs, re-auditing the repo, diffing plan vs. files and inspecting the design archives. The plan may be corrected technically but never reduced in scope.
- REQ-PROC-07 [§0B] Execution delivers architecture, DB, backend, mobile, web, backoffice, integrations, AI, security/privacy and tests; builds, self-fixes, retests and verifies real end-user flows E2E. A first successful build is not completion.
- REQ-PROC-08 [§1] The deliverable is a production-ready product, not a demo.
- REQ-PROC-09 [§5] Repo discovery inventories: folders, package manager, workspaces, source, config, lockfile, env files, design assets, screenshots, docs, test setup, build scripts, CI, native iOS/Android, Supabase files, migrations, secret/config problems.
- REQ-PROC-10 [§5] Existing code is never deleted blindly. An empty repo gets a clean monorepo. Duplicate, conflicting or dead architecture is refactored.
- REQ-PROC-11 [§120] The plan summary has 22 sections: Repository state, Design findings, Architecture, App boundaries, Domain model, DB + RLS, OAuth/integrations, AI architecture, Mobile screen map, Backoffice screen map, Public web map, Security model, Privacy model, Notification/jobs, Subscription, Referral, Test, CI/CD, External credentials, Known platform limitations, Execution order, Definition of Done.
- REQ-PROC-12 [§120,§139] Execution order is technical dependency order only. No V1/V2/MVP split.
- REQ-PROC-13 [§121] Execution sequence (dependency-optimizable, nothing deferred): plan → design ZIPs → tokens → screen/flow inventory → monorepo → shared domain → schema/RLS/migrations → auth → provider adapters → sync → AI → mobile → web → backoffice → notifications/jobs → subscription/referral → hardening → tests → build → E2E → fix → retest → final audit.
- REQ-PROC-14 [§134] Self-run loop: install → lint → typecheck → unit → integration → build → inspect → fix → rerun → E2E → fix → rerun → manual flow audit. Root-cause failures instead of asking for help.
- REQ-PROC-15 [§138] docs/FINAL_IMPLEMENTATION_REPORT.md has sections Completed, Architecture, Mobile, Backend, AI, Backoffice, Marketing Website, Security, Privacy, Tests, Build, External Credentials Required, Deployment Steps, Known Platform Limitations, Remaining Manual Store Steps, plus a feature matrix `| Feature | Status | Tested | External Credential | Notes |`. No development diary.
- REQ-PROC-16 [§139] Scope is a single, complete product (not wireframe, demo, frontend-only, backend-only or MVP) in one repository.
- REQ-PROC-17 [§140] Never ask the user for technical, framework, DB or architecture choices, continuation, credentials or design interpretation. Choose safe defaults. Only true external manual steps go in the final report.
- REQ-PROC-18 [§141] An impossible capability gets the real capability, a platform-appropriate fallback or an explicit limitation. Never fake UI, fake success or marketing claims.
- REQ-PROC-19 [§142] Root-cause and dependency analysis come before changes. Split audits and merge them. Search affected surfaces before large refactors. After a change, verify the related feature boundary.
- REQ-PROC-20 [§143] Plan-mode sub-audits: Design, Architecture, Data, Integration, AI, Security, QA. Merge them into one implementation map.
- REQ-PROC-21 [§154] Plan-mode steps 1–17, ending in a self-consistency check with no implementation. Execution-mode steps 1–15, ending in the quality gate and the final report. No waiting for approval, no credential asks, no WebView, no fake interactions.

### Product / principles
- REQ-PROD-01 [§2] Name "Dijital Asistan". Slogan "Bugün bilmen gerekenleri, sen sormadan söyler." Supporting lines "Gürültüyü değil, önemli olanı gör." and "Mailini, takvimini ve yapman gerekenleri tek yerde anlar."
- REQ-PROD-02 [§2] Positioned as a Personal Command Center, not a chatbot.
- REQ-PROD-03 [§2] Understands emails, calendar, tasks, deadlines, waiting-for, commitments, meetings, travel, shipments, reservations, payments, subscriptions, security notices and important people.
- REQ-PROD-04 [§2] Answers "Bugün gerçekten neyi bilmeliyim?" with meaningful, sourced, actionable items rather than raw data.
- REQ-PRIN-01 [§3.1] Chat is not the home screen.
- REQ-PRIN-02 [§3.2] AI is proactive (briefings and insights without user prompting).
- REQ-PRIN-03 [§3.3] Minimum user effort.
- REQ-PRIN-04 [§3.4] Reduces information clutter.
- REQ-PRIN-05 [§3.5] Important insights show their source.
- REQ-PRIN-06 [§3.6] Approval before any write or modify on the user's behalf.
- REQ-PRIN-07 [§3.7] Mail is never sent without user approval.
- REQ-PRIN-08 [§3.8] Calendar is never changed without user approval.
- REQ-PRIN-09 [§3.9] The user can correct AI importance decisions.
- REQ-PRIN-10 [§3.10] Precedence: explicit priority rules > learned preferences > general AI importance.
- REQ-PRIN-11 [§3.11] No information that is absent from the source.
- REQ-PRIN-12 [§3.12] Privacy-first defaults.
- REQ-PRIN-13 [§3.13] iOS and Android offer the same core experience.
- REQ-PRIN-14 [§3.14] Android-only features never block the iOS core.
- REQ-PRIN-15 [§3.15] No artificial streaks or FOMO mechanics.
- REQ-PRIN-16 [§3.16] No notification without value.
- REQ-PRIN-17 [§3.17] User control is always preserved.
- REQ-PRIN-18 [§3.18] Important AI output is source-grounded wherever possible.
- REQ-PRIN-19 [§3.19] Uncertain data is never presented as fact.
- REQ-PRIN-20 [§3.20] Aim for less cognitive load, not more screens.

### Design reference / UI standard
- REQ-DES-01 [§4] On visual conflict, the primary archive wins (visual language, typography, color, spacing, cards, Today, Morning Briefing, Meeting Prep, Assistant, dark mode, onboarding, premium feel).
- REQ-DES-02 [§4] The secondary archive covers missing screens, settings, privacy, widgets, edge states, marketing, extra screens and interaction coverage, restyled to primary.
- REQ-DES-03 [§4] Functional behavior follows MASTER.
- REQ-DES-04 [§4] Never copy dead buttons, fake loading, non-working CTAs, fake success, prototype-only navigation or fake integrations.
- REQ-DES-05 [§4] Extract required assets and design tokens from the archives.
- REQ-DES-06 [§4] No WebView of the prototype. Native React Native UI.
- REQ-DES-07 [§122] Extract color, type scale, spacing, radius, shadows, icon conventions, surface hierarchy, button variants, cards, modal/sheet patterns, navigation behavior and dark tokens first. Build the shared UI kit next. Every screen uses the kit.
- REQ-DES-08 [§122] Do not copy screenshots arbitrarily. Minimize visual regression risk.
- REQ-DES-09 [§124] Minimum visual change, maximum functional completeness. Any redesign is justified in DESIGN_AUDIT.md.
- REQ-DES-10 [§123] Subtle motion, contextual transitions, useful loading states, meaningful skeletons, confirmation feedback, progressive disclosure. Animation never slows the product.
- REQ-DES-11 [§144] Design coverage audit row per requirement: requirement → reference screen/component → archive → implementation screen → interaction → missing state → notes. Covers Today, Morning Briefing, Flow, Mail Intelligence, Email Detail, AI Reply, Follow-Up, Commitments, Plan, Calendar Intelligence, Meeting Prep, Post Meeting, Life Intelligence, Assistant, Voice, Memory, Capture, Search, Notifications, Widgets, Privacy, Settings, Dark Mode, Onboarding, Paywall, Referral, Public Web, Backoffice.
- REQ-DES-12 [§144] A requirement with no reference screen gets a production screen designed from the requirement.
- REQ-DES-13 [§145] Each screen-map entry has: Screen ID, Route, Entry points, Purpose, Data dependencies, API dependencies, State dependencies, Design reference, Primary CTA, Secondary actions, Loading, Empty, Error, Offline, Permission edge case, Approval requirement, Analytics events, Accessibility notes, Deep links, Tests.

### Architecture / monorepo
- REQ-ARCH-01 [§6] Layout: `apps/{mobile,web,backoffice}` and `packages/{ui,design-tokens,domain,validation,api-client,i18n,config}`.
- REQ-ARCH-02 [§6] Mobile stack: React Native, Expo, Expo Router, TypeScript strict, TanStack Query, Zustand, Reanimated, Gesture Handler, Safe Area Context, Expo Notifications, Expo Calendar, Expo SecureStore, Expo Image Picker, Expo Document Picker, Expo File System, Expo Audio.
- REQ-ARCH-03 [§6] Swift/Kotlin native modules where needed.
- REQ-ARCH-04 [§6] No dependency on Expo Go. Development Build and EAS compatible.
- REQ-ARCH-05 [§6] Web: Next.js App Router, TypeScript, SEO, responsive.
- REQ-ARCH-06 [§6] Backoffice: Next.js App Router, TypeScript, desktop-first, responsive, separate auth/session boundary.
- REQ-ARCH-07 [§6] Backend on Supabase (Postgres, Auth, Storage, Edge Functions, Cron, pgvector, RLS). Add a separate service only if Edge Functions cannot do the job safely and sustainably.
- REQ-ARCH-08 [§6] Current, mutually compatible, production-safe package versions, verified against official docs.
- REQ-ARCH-09 [§7] Types, schemas, domain enums, validation, design tokens and API contracts live in shared packages. No duplicated domain model between mobile and web.
- REQ-ARCH-10 [§7] Frontends have no server secrets.
- REQ-ARCH-11 [§7] The service-role key never reaches a browser bundle.
- REQ-ARCH-12 [§7] AI API keys never reach mobile or web clients.
- REQ-ARCH-13 [§146] Each backend capability contract states: Capability, Auth, Role, Input schema, Output schema, Validation, DB effects, Provider effects, Idempotency, Error codes, Retry, Audit event, Tests.
- REQ-ARCH-14 [§150] A feature's real dependency chain exists before the feature. Examples:
  - Reply: OAuth permission → adapter → draft → approval → send → audit → UI result.
  - Calendar create: integration → write authorization → proposal → approval → provider write → refresh.
  - Meeting Prep: event → people resolution → email retrieval → source ranking → AI summary → UI.

### Navigation / Today
- REQ-NAV-01 [§8] Bottom navigation has exactly four tabs: Bugün, Akış, Plan, Asistan.
- REQ-NAV-02 [§8] Profile/Settings opens from the avatar.
- REQ-TODAY-01 [§8] Today is an editorial, calm, premium layout, not a dense dashboard.
- REQ-TODAY-02 [§8] Greeting "Günaydın, {firstName}".
- REQ-TODAY-03 [§8] Date line in Turkish long format ("23 Eylül 2026") in the user's timezone.
- REQ-TODAY-04 [§8] Headline "Bugün bilmen gereken {N} şey var.", where N is the real item count.
- REQ-TODAY-05 [§8] CTA "Brifingimi Gör" opens the Morning Briefing.
- REQ-TODAY-06 [§8] CTA "Dinle · {n} dk" plays the audio briefing; the duration is real.
- REQ-TODAY-07 [§8] Sections: Priorities, AI insight cards, Meeting, Deadline, Follow-up, Life Intelligence.
- REQ-TODAY-08 [§8] Approval badge with the pending count opens the Approval Center.

### Briefings
- REQ-BRIEF-01 [§9] Morning Briefing is a full-screen narrative.
- REQ-BRIEF-02 [§9] Sections exactly: Bugünün Öncelikleri, Programın, Senden Beklenenler, Senin Beklediklerin, Son Tarihler, Kişisel Gelişmeler.
- REQ-BRIEF-03 [§9] Audio: play, pause, seek, ±15 s, speed.
- REQ-BRIEF-04 [§9] Native on-device TTS fallback.
- REQ-BRIEF-05 [§9] Pluggable external premium TTS adapter (server-side key).
- REQ-BRIEF-06 [§10] Midday is generated and notified only when a meaningful change has occurred. Otherwise it is skipped.
- REQ-BRIEF-07 [§10] Midday copy pattern "Sabahından beri {n} önemli gelişme oldu."
- REQ-BRIEF-08 [§10] No routine or meaningless midday notifications.
- REQ-BRIEF-09 [§11] Evening copy pattern "Bugünden yarına {n} konu kaldı."
- REQ-BRIEF-10 [§11] Evening sections: Tamamlananlar, Yarına Kalanlar, Takip, Yarının ilk etkinliği.
- REQ-BRIEF-11 [§11] "Yarına Hazırım" → confirmation → persisted carry-over of open items to tomorrow.
- REQ-BRIEF-12 [§12] Weekly Review shows analyzed emails, important subjects, meetings, follow-ups, deadlines and estimated time saved.
- REQ-BRIEF-13 [§12] Weekly share card is privacy-safe (no names, subjects or content).
- REQ-BRIEF-14 [§12] Weekly sharing uses the native share sheet.

### Flow
- REQ-FLOW-01 [§13] Flow is a smart attention feed, not an inbox clone.
- REQ-FLOW-02 [§13] Filters: Tümü, Önemli, Mail, Takvim, Takip, Kişisel.
- REQ-FLOW-03 [§13] Card types: Email, Meeting, Deadline, Shipment, Flight, Reservation, Payment, Subscription, Security.
- REQ-FLOW-04 [§13] Every card action performs a real action.

### Mail Intelligence
- REQ-MAIL-01 [§14] Categories: Önemli, Senden Cevap Bekleyen, Senin Cevap Beklediğin, Son Tarih İçeren, Bilgilendirme, Düşük Öncelik.
- REQ-MAIL-02 [§14] AI summary shown first.
- REQ-MAIL-03 [§14] Each classification stores source, confidence, reason and deterministic rule hits separately, and they are separable in the UI and data.

### Email Detail
- REQ-EMAIL-01 [§15] Shows Sender, Subject, Date, AI Summary, Key Points, Source, Original Mail.
- REQ-EMAIL-02 [§15] Actions: Yanıt Hazırla, Görev Oluştur, Takvime Ekle, Hatırlat, Orijinal Maili Aç.
- REQ-EMAIL-03 [§15] Each action is wired to a real provider or domain flow.

### AI Reply
- REQ-REPLY-01 [§16] Tones: Kısa, Profesyonel, Samimi, Detaylı.
- REQ-REPLY-02 [§16] Flow: Generate → Edit → Approval → Send.
- REQ-REPLY-03 [§16] Silent send is impossible on every code path, including AI, voice and the assistant.

### Follow-Up
- REQ-FOLLOW-01 [§17] Two types: user waiting on others, and others waiting on the user.
- REQ-FOLLOW-02 [§17] "Takip mesajı hazırla" opens the Reply flow.
- REQ-FOLLOW-03 [§17] "Yarın hatırlat" opens the reminder flow.
- REQ-FOLLOW-04 [§17] "Kapat" persists the closed status.

### Commitments
- REQ-COMMIT-01 [§18] Detects commitment statements ("Cuma gönderirim.", "Yarın ararım.", "Haftaya dönerim.").
- REQ-COMMIT-02 [§18] Model fields: commitment, person, due date, source, status, confidence.
- REQ-COMMIT-03 [§18] Actions: Tamamlandı, Ertele, Kaynağı Gör.
- REQ-COMMIT-04 [§18] Created only with explicit source support.
- REQ-COMMIT-05 [§18] Ambiguous inference requires user confirmation before creation.

### Plan
- REQ-PLAN-01 [§19] Day and Week views.
- REQ-PLAN-02 [§19] Merges calendar events, tasks and commitments.
- REQ-PLAN-03 [§19] AI schedule suggestion into a free slot, e.g. "Yarın 14:00–16:30 arasında boşsun. Teklif hazırlama görevini buraya yerleştirebilirim."
- REQ-PLAN-04 [§19] Flow: proposed block → user approval → calendar update → updated timeline.
- REQ-PLAN-05 [§19] No calendar modification without approval.

### Calendar Intelligence
- REQ-CAL-01 [§20] Detects conflicts.
- REQ-CAL-02 [§20] Detects back-to-back meetings.
- REQ-CAL-03 [§20] Detects preparation need.
- REQ-CAL-04 [§20] Detects free slots.
- REQ-CAL-05 [§20] Surfaces deadlines.
- REQ-CAL-06 [§20] Uses location only when it is actually available.
- REQ-CAL-07 [§20] Never fabricates travel time.

### Meeting Prep
- REQ-PREP-01 [§21] Shows person, meeting time, purpose, previous communication, recent mails, open loops, user commitments, other-side commitments, relevant files (only if real) and 3 talking points.
- REQ-PREP-02 [§21] "2 Dakikalık Özet".
- REQ-PREP-03 [§21] Tapping a person opens Person Intelligence.
- REQ-PREP-04 [§21] Tapping a mail opens Email Detail.
- REQ-PREP-05 [§21] The meeting link is a real external handoff.

### Post Meeting
- REQ-POST-01 [§22] At event end, prompts "Toplantın bitti. Takip etmen gereken bir şey var mı?"
- REQ-POST-02 [§22] Accepts text or voice input.
- REQ-POST-03 [§22] Input → commitment proposal → approval → save.

### Life Intelligence
- REQ-LIFE-01 [§23] Detects Shipment, Flight, Reservation, Payment, Subscription and Security Event from mail, document or event content.
- REQ-LIFE-02 [§23] Every card is linked to its source.
- REQ-LIFE-03 [§23] Amount and deadline are shown only when the source states them explicitly.

### Assistant
- REQ-ASSIST-01 [§24] Conversational AI interface, not the home screen.
- REQ-ASSIST-02 [§24] Suggested prompts: "Bugün neye odaklanmalıyım?", "Kimlere cevap vermem gerekiyor?", "Yarın yoğun muyum?", "Mehmet ile en son ne konuştuk?", "Bu hafta hangi son tarihlerim var?"
- REQ-ASSIST-03 [§24] Grounded retrieval over the user's own data.
- REQ-ASSIST-04 [§24] Source cards shown with answers.
- REQ-ASSIST-05 [§24] Hallucination control is mandatory.

### Voice
- REQ-VOICE-01 [§25] Handles voice queries: "Bugün ne var?", "Brifingimi oku.", "Mehmet'ten cevap geldi mi?", "Yarın yoğun muyum?"
- REQ-VOICE-02 [§25] Any voice-initiated write requires approval.

### Memory
- REQ-MEM-01 [§26] Semantic search, e.g. "Geçen ay aldığım uçak bileti neydi?", "Mehmet ile en son ne konuşuldu?", "Bu ay hangi ödemeler var?"
- REQ-MEM-02 [§26] pgvector preferred.
- REQ-MEM-03 [§26] Postgres full-text search as the fallback.
- REQ-MEM-04 [§26] Every memory record is linked to its source and bound to the retention policy.

### Universal Capture
- REQ-CAPTURE-01 [§27] Sources: Photo, Screenshot, PDF, File, Link, Text.
- REQ-CAPTURE-02 [§27] Extracts Event, Task, Deadline, Person, Payment, Reservation, Flight, Shipment, Product, Note.
- REQ-CAPTURE-03 [§27] Suggested actions go through approval.

### Share extensions
- REQ-SHARE-01 [§28] iOS native Share Extension accepts text, URL, image and PDF/file.
- REQ-SHARE-02 [§28] Android handles ACTION_SEND and ACTION_SEND_MULTIPLE.
- REQ-SHARE-03 [§28] Share entry uses the common capture domain layer.

### Smart Reminders
- REQ-REM-01 [§29] Presets: 30 dakika önce, 1 saat önce, Bu akşam, Yarın sabah, Uygun zamanda, Kendin seç.
- REQ-REM-02 [§29] "Uygun zamanda" uses calendar context.
- REQ-REM-03 [§29] Reminder creation goes through confirmation or approval.

### VIP / Person Intelligence
- REQ-PERSON-01 [§30] The user can mark people as VIP.
- REQ-PERSON-02 [§30] Person page shows Last contact, Upcoming meetings, Open loops, Recent topics, User owes, They owe, Commitments, Related emails.
- REQ-PERSON-03 [§30] VIP status deterministically raises priority.

### Priority Rules
- REQ-RULES-01 [§31] Dedicated CRUD UI for rules.
- REQ-RULES-02 [§31] Rule types: sender always important, domain always important, VIP always notify, keyword high priority, promotions low priority, mute sender.
- REQ-RULES-03 [§31] Engine order: explicit user rules → learned preference → deterministic metadata/risk signals → AI classification.
- REQ-RULES-04 [§31] Explainability shown for each result where possible.

### AI Personalization
- REQ-PERS-01 [§32] Learned preferences are stored and shown separately from explicit rules.
- REQ-PERS-02 [§32] Displays learned preferences, e.g. "Mehmet yüksek öncelikli.", "Promotional mail genellikle yararlı değil."
- REQ-PERS-03 [§32] The user can edit, disable or delete each learned preference.
- REQ-PERS-04 [§32] "Learn from interactions" toggle, persisted and enforced.

### Approval Center
- REQ-APPR-01 [§33] Statuses: pending, approved, rejected, executing, executed, failed, expired.
- REQ-APPR-02 [§33] Action types: email_send, calendar_create, calendar_update, task_create, reminder_create, commitment_create.
- REQ-APPR-03 [§33] Each item shows what, why, source, exact change, destination/account and proposed side effect.
- REQ-APPR-04 [§33] Buttons: Onayla, Düzenle, Reddet.
- REQ-APPR-05 [§33] Idempotency key is mandatory.
- REQ-APPR-06 [§33] The same action never executes twice.

### Onboarding
- REQ-ONB-01 [§34] Sequence: Welcome → Noise reduction → Proactive → Control/trust → Account → Connect Gmail/Outlook → Connect Calendar → Permissions → Personalization → Briefing schedule → VIP → First Analysis → Aha → Notification Permission → Today.
- REQ-ONB-02 [§34] First analysis covers about the last 72 hours.
- REQ-ONB-03 [§34] Shows mail count, important count, calendar count and follow-up count.
- REQ-ONB-04 [§34] Onboarding can be tested end to end in dev/demo mode without credentials.

### Notification settings
- REQ-NOTIF-01 [§35] Per-category toggles: Morning, Midday, Evening, Critical Emails, Meetings, Deadlines, Follow-Up, Life Intelligence.
- REQ-NOTIF-02 [§35] Quiet Hours.
- REQ-NOTIF-03 [§35] Lock Screen Privacy.
- REQ-NOTIF-04 [§35] Notification detail level setting.

### Android Notification Intelligence
- REQ-ANDNI-01 [§36] Android-only and optional.
- REQ-ANDNI-02 [§36] Implemented as a native Kotlin NotificationListenerService.
- REQ-ANDNI-03 [§36] Requires explicit user enablement.
- REQ-ANDNI-04 [§36] Mode choice: all apps or selected apps.
- REQ-ANDNI-05 [§36] Sensitive authentication apps are excluded by default.
- REQ-ANDNI-06 [§36] iOS never pretends to have a system notification stream.
- REQ-ANDNI-07 [§36] The feature never blocks the iOS core.

### Widgets
- REQ-WIDGET-01 [§37] iOS Small, Medium and Large widgets.
- REQ-WIDGET-02 [§37] iOS Lock Screen widgets where supported.
- REQ-WIDGET-03 [§37] Android 2×2 and 4×2 widgets.
- REQ-WIDGET-04 [§37] Widget data is privacy-safe.
- REQ-WIDGET-05 [§37] Widget deep links open the real screens.

### Theme
- REQ-THEME-01 [§38] Appearance options: System, Light, Dark.
- REQ-THEME-02 [§38] All shared components are theme-aware.
- REQ-THEME-03 [§38] No hardcoded white surfaces in dark theme.
- REQ-THEME-04 [§38] Contrast verified in both themes.

### Localization
- REQ-I18N-01 [§39] Turkish is the default language.
- REQ-I18N-02 [§39] English is fully supported.
- REQ-I18N-03 [§39] Every user-facing string uses an i18n key.
- REQ-I18N-04 [§39] Turkish locale uses the 24-hour clock.
- REQ-I18N-05 [§39] Correct locale date formatting.
- REQ-I18N-06 [§39] Europe/Istanbul timezone awareness.
- REQ-I18N-07 [§39] Timezone is stored separately from the profile.

### Privacy Center
- REQ-PRIV-01 [§40] Areas: Connected Accounts, Permissions, AI Accessible Data, Data Source Controls, Retention, Delete History, Export Data, Delete Account, AI Personalization.
- REQ-PRIV-02 [§40] All privacy copy is true to the implemented architecture.
- REQ-PRIV-03 [§40] Copy: "Veriler aktarım sırasında ve saklanırken şifrelenir." / "Önemli işlemler sen onaylamadan gerçekleştirilmez." / "Verilerin reklam amacıyla satılmaz."
- REQ-PRIV-04 [§40] No "uçtan uca şifreleme" claim unless E2E encryption is actually implemented.

### Retention
- REQ-RET-01 [§41] Default retention is 90 days.
- REQ-RET-02 [§41] Options: 30 days, 90 days, 1 year, until the user deletes.
- REQ-RET-03 [§41] A scheduled cleanup job enforces retention.
- REQ-RET-04 [§41] Account deletion covers database, storage, embeddings, tokens, local cache and linked-provider revoke where possible.
- REQ-RET-05 [§41] Where provider revoke cannot be guaranteed, the limitation is documented.

### Analytics
- REQ-ANLY-01 [§42] Product analytics are privacy-safe.
- REQ-ANLY-02 [§42] Never sent to analytics: raw email body, assistant conversation content, OAuth tokens, full event payloads, secrets.
- REQ-ANLY-03 [§42] Tracked: onboarding completion, briefing open, meeting prep, assistant usage, capture, follow-up, subscription, referral.

### Subscriptions
- REQ-SUB-01 [§43] Subscriptions run through RevenueCat.
- REQ-SUB-02 [§43] Entitlement id `pro`.
- REQ-SUB-03 [§43] Products `da_pro_monthly` and `da_pro_annual`.
- REQ-SUB-04 [§43] UI offers Monthly, Annual, a free trial only if the store product supports it, Restore Purchases and Manage Subscription.
- REQ-SUB-05 [§43] A single central entitlement state.
- REQ-SUB-06 [§43] Store entitlements are stored and shown separately from referral and admin grants.

### Free / Pro
- REQ-PLANS-01 [§44] Free: 1 email account, 1 calendar, Morning Briefing, basic important email, limited AI, basic Today.
- REQ-PLANS-02 [§44] Pro: multiple email accounts, multiple calendars, Midday, Evening, Meeting Prep, Follow-Up, Commitments, Voice Briefing, AI Memory, VIP, advanced planning, Universal Capture, Android Notification Intelligence.
- REQ-PLANS-03 [§44] Critical Pro features are also checked server-side.

### Referral
- REQ-REF-01 [§45] Referral link and code.
- REQ-REF-02 [§45] An eligible referral gives bonus Pro to both parties.
- REQ-REF-03 [§45] Anti-abuse: self-referral prevention, duplicate-account heuristics, suspicious-loop detection, idempotent reward.
- REQ-REF-04 [§45] Referrals are visible in the backoffice.
- REQ-REF-05 [§45] Invites use the native share sheet.

### Backoffice: general, RBAC, security, support
- REQ-BO-GEN-01 [§46] The backoffice is a separate web app, never inside the mobile app.
- REQ-BO-GEN-02 [§46] Desktop-first.
- REQ-BO-GEN-03 [§46] Deployable at admin.{domain}.
- REQ-BO-GEN-04 [§46] Separate authentication, session and RBAC boundary.
- REQ-BO-GEN-05 [§46] Sidebar IA exactly: Overview (Dashboard); Users (Users, Support); Operations (Integrations, Sync & Jobs, Briefings, Notifications); AI (AI Operations, Prompt Management); Business (Subscriptions, Referrals); Product (Feedback, Feature Flags, Announcements); Privacy (Data Requests, Audit Logs); System (System Health, Admin Users, Settings).
- REQ-BO-RBAC-01 [§47] Roles: super_admin, operations, support, finance, ai_ops, analyst, readonly.
- REQ-BO-RBAC-02 [§47] RBAC is enforced server-side.
- REQ-BO-RBAC-03 [§47] Hiding a sidebar item is never treated as authorization.
- REQ-BO-RBAC-04 [§47] Every sensitive mutation re-checks permission on the backend.
- REQ-BO-SEC-01 [§48] Secure cookie/session.
- REQ-BO-SEC-02 [§48] Server-side authorization.
- REQ-BO-SEC-03 [§48] Rate limiting.
- REQ-BO-SEC-04 [§48] Session expiry.
- REQ-BO-SEC-05 [§48] "Logout all sessions".
- REQ-BO-SEC-06 [§48] MFA-ready architecture.
- REQ-BO-SEC-07 [§48] CSRF-safe mutation patterns where relevant.
- REQ-BO-SEC-08 [§48] Audit logging.
- REQ-BO-SEC-09 [§48] Hidden by default: raw email body, assistant conversations, OAuth tokens, passwords, secrets.
- REQ-BO-SUPP-01 [§49] No impersonation / "login as user" by default.
- REQ-BO-SUPP-02 [§49] Privacy-safe support view shows User ID, account status, plan, integration status, last sync, job errors, briefing status, push status, app version, platform.
- REQ-BO-SUPP-03 [§49] Sensitive content reveal requires an authorized role, a mandatory reason and limited duration, and writes an audit log entry plus a reveal event.

### Backoffice: dashboard, users, operations
- REQ-BO-DASH-01 [§50] Metrics: Total, Active, New, Pro, Trials, Connected emails, Connected calendars, AI requests, AI cost, Briefings, Push notifications.
- REQ-BO-DASH-02 [§50] Charts: User growth, Active usage, AI costs, Subscriptions, Sync failures.
- REQ-BO-DASH-03 [§50] Ranges: 24h, 7d, 30d, 90d.
- REQ-BO-USERS-01 [§51] Table columns: User, Email, Plan, Created, Last Active, Platform, Connected Accounts, Last Sync, Status.
- REQ-BO-USERS-02 [§51] Filters: Free, Pro, Trial, Inactive, Sync Error, Connection Error.
- REQ-BO-USERS-03 [§51] Server-side pagination. The full user DB is never loaded client-side.
- REQ-BO-USERS-04 [§51] Detail tabs: Overview, Integrations, Briefings, Usage, Subscription, Referrals, Support, Audit.
- REQ-BO-USERS-05 [§51] Force Sync, Disable Account, Restore, Temporary Pro Grant and Disconnect Integration each require reason + confirmation + audit.
- REQ-BO-INT-01 [§52] Integrations view covers Google, Microsoft and Apple-device.
- REQ-BO-INT-02 [§52] Statuses: healthy, needs reconnect, OAuth error, refresh error, watch/subscription issue, last sync.
- REQ-BO-INT-03 [§52] Raw tokens are never shown.
- REQ-BO-JOBS-01 [§53] Job statuses: Queued, Running, Completed, Retrying, Failed, Dead Letter.
- REQ-BO-JOBS-02 [§53] Job types: Initial Sync, Gmail Sync, Outlook Sync, Calendar Sync, Briefing, Meeting Prep, Retention, Export, Notification, Embedding, Provider Webhook.
- REQ-BO-JOBS-03 [§53] Safe retry mechanism.
- REQ-BO-JOBS-04 [§53] Jobs are idempotent.
- REQ-BO-JOBS-05 [§53] Dead-letter visibility.
- REQ-BO-BRIEF-01 [§54] Covers Morning, Midday, Evening and Weekly briefings.
- REQ-BO-BRIEF-02 [§54] Metrics: scheduled, generated, delivered, failed, skipped, latency, AI cost.
- REQ-BO-NOTIF-01 [§55] Metrics: scheduled, sent, failed, suppressed, deduplicated.
- REQ-BO-NOTIF-02 [§55] User-level debugging that is privacy-safe.
- REQ-BO-NOTIF-03 [§55] Push test action restricted to authorized roles.

### Backoffice: AI
- REQ-BO-AIOPS-01 [§56] Shows requests, input/output tokens where available, estimated cost, latency, error rate.
- REQ-BO-AIOPS-02 [§56] Feature breakdown: Email Classification, Briefing, Assistant, Meeting Prep, Capture, Commitment, Follow-Up, Embedding, Voice.
- REQ-BO-AIOPS-03 [§56] Charts: daily cost, feature cost, model cost, p50 latency, p95 latency.
- REQ-BO-MODEL-01 [§57] Secrets are never shown; only configured / not configured.
- REQ-BO-MODEL-02 [§57] Configurable: classifier model, reasoning model, embedding model, TTS, STT.
- REQ-BO-MODEL-03 [§57] Every config change is audited.
- REQ-BO-MODEL-04 [§57] Model provider abstraction.
- REQ-BO-PROMPT-01 [§58] Versioned prompts: Email Classification, Briefing, Meeting Prep, Commitment, Follow-Up, Capture, Assistant.
- REQ-BO-PROMPT-02 [§58] Prompt statuses: Draft, Active, Archived.
- REQ-BO-PROMPT-03 [§58] Diff view between versions.
- REQ-BO-PROMPT-04 [§58] Activate and Rollback.
- REQ-BO-PROMPT-05 [§58] Every prompt change is audited.
- REQ-BO-PROMPT-06 [§58] Prompt version is linked to AI output telemetry.
- REQ-BO-AIFB-01 [§59] Aggregates positive/negative feedback by feature, model and prompt version.
- REQ-BO-AIFB-02 [§59] Private content hidden by default.

### Backoffice: business
- REQ-BO-SUBS-01 [§60] Shows Active Pro, Trials, Cancelled, Expired, Refunded, MRR, ARR estimate, RevenueCat webhook events, Products, Renewal, Entitlements, Store.
- REQ-BO-SUBS-02 [§60] Store entitlements are clearly separated from admin grants.
- REQ-BO-ENT-01 [§61] Entitlement override is limited to authorized roles.
- REQ-BO-ENT-02 [§61] Temporary Pro durations: 1, 7, 14 or 30 days.
- REQ-BO-ENT-03 [§61] A reason is mandatory.
- REQ-BO-REF-01 [§62] Referral metrics: invites, successful referrals, conversion, bonus days, abuse flags.
- REQ-BO-TICKET-01 [§62] Ticket statuses: Open, In Progress, Waiting User, Resolved, Closed.
- REQ-BO-TICKET-02 [§62] Ticket categories: Account, Integration, Sync, Billing, AI Quality, Notification, Privacy, Other.
- REQ-BO-FEEDBACK-01 [§62] Feedback types: Bug, Feature, General, AI Quality.
- REQ-BO-FEEDBACK-02 [§62] Feedback and tickets carry platform, app version, status and assignment.

### Backoffice: product, privacy, system
- REQ-BO-FLAGS-01 [§63] Flags include midday, evening, voice, meeting prep, capture, Android NI, weekly review, new AI model.
- REQ-BO-FLAGS-02 [§63] Targeting: global, percentage, platform, plan, version.
- REQ-BO-FLAGS-03 [§63] Kill switch.
- REQ-BO-FLAGS-04 [§63] Flag changes are audited.
- REQ-BO-ANN-01 [§64] Announcement fields: title, body, audience, platform, version, start, end.
- REQ-BO-ANN-02 [§64] Preview, Schedule, Cancel.
- REQ-BO-ANN-03 [§64, derived] The mobile client fetches and renders active announcements targeted at it (see C-18).
- REQ-BO-DATAREQ-01 [§65] Tabs: Exports, History Deletion, Account Deletion.
- REQ-BO-DATAREQ-02 [§65] Request statuses are shown.
- REQ-BO-DATAREQ-03 [§65] Failed requests can be retried.
- REQ-BO-DATAREQ-04 [§65] Manual sensitive actions require permission, reason and audit.
- REQ-BO-AUDIT-01 [§66] Log fields: timestamp, admin, role, action, target, reason, result.
- REQ-BO-AUDIT-02 [§66] No function exists to delete audit records.
- REQ-BO-AUDIT-03 [§66] Sensitive-action logs are complete and immutable.
- REQ-BO-HEALTH-01 [§67] Real health checks: API, Database, Supabase, Google OAuth, Microsoft OAuth, Gmail, Microsoft Graph, Push, AI providers, RevenueCat, Cron, Webhooks, Storage.
- REQ-BO-HEALTH-02 [§67] No fake green status.
- REQ-BO-ADMINS-01 [§68] Invite admin, role, status, last login, MFA state, disable, re-enable.
- REQ-BO-ADMINS-02 [§68] The last super_admin cannot be deleted or disabled.
- REQ-BO-CMDK-01 [§69] Command palette opens with Cmd/Ctrl+K.
- REQ-BO-CMDK-02 [§69] Searches user email, user ID, job ID, ticket ID, subscription ID, referral code, integration ID.
- REQ-BO-CMDK-03 [§69] Never searches raw user email content.
- REQ-BO-CMDK-04 [§69] Destructive commands open a confirmation flow instead of executing directly.
- REQ-BO-TABLE-01 [§70] Every large table supports server pagination, sorting, filtering, column visibility, and loading, empty and error states with retry.
- REQ-BO-PRIV-01 [§71] PII is masked (e.g. `yu***@gmail.com`).
- REQ-BO-PRIV-02 [§71] Reveal requires permission, a reason where appropriate, and an audit event.
- REQ-BO-PRIV-03 [§71] Provider tokens, passwords and secrets are never shown.
- REQ-BO-THEME-01 [§72] Light theme by default, with a dark toggle.
- REQ-BO-THEME-02 [§72] Theme preference is persisted per admin.
- REQ-BO-THEME-03 [§72] Charts and tables are theme-aware.

### Backoffice: observability, ops, metrics
- REQ-BO-OBS-01 [§110] Shows app versions, platform, crash correlation where available, old-version usage, sync-error correlation.
- REQ-BO-OBS-02 [§110] Sentry or an equivalent provider behind an adapter.
- REQ-BO-OPS-01 [§118] Correlation IDs span User → Integration → Sync Job → AI/Briefing → Notification.
- REQ-BO-OPS-02 [§118] Logs are structured, PII-minimized and environment-aware.
- REQ-BO-METRIC-01 [§119] Shows AI cost per active user, classification rate, briefing generation success, notification suppression rate, approval conversion, sync success rate, integration reconnect rate, feature usage, trial-to-paid event stream.
- REQ-BO-METRIC-02 [§119] Metrics are computed without collecting personal content.

### Public web / marketing
- REQ-WEB-01 [§73] Routes: `/`, `/pricing`, `/privacy`, `/terms`, `/support`, `/data-deletion`.
- REQ-WEB-02 [§73] Landing sections: Hero, Integrations, How it works, Morning Briefing, Mail Intelligence, Meeting Prep, Smart Planning, AI Memory, Security, Pricing, FAQ, CTA.
- REQ-WEB-03 [§73] Hero "Bugün bilmen gerekenleri, sen sormadan söyler." Supporting line "Dijital Asistan mailini, takvimini ve açık işlerini anlayıp her gün sana kısa bir brifing hazırlar."
- REQ-WEB-04 [§73] Basic SEO, Open Graph tags, sitemap, robots.
- REQ-WEB-05 [§73] Legal pages contain real, consistent content.
- REQ-WEB-06 [§73] Premium, responsive layout.
- REQ-MKT-01 [§74] Assets in the final design language: app store screenshot concepts, feature visuals, social concepts, pricing visuals.
- REQ-MKT-02 [§74] The six messages: "Bugün bilmen gerekenleri, sen sormadan söyler." / "83 mail. Gerçekten önemli olan 4." / "Toplantıya hazırlıksız girme." / "Kim senden cevap bekliyor?" / "Takvimini sadece göstermez. Anlar." / "Dijital hayatına sor."
- REQ-MKT-03 [§74] Marketing copy matches real product capability.

### OAuth / providers
- REQ-OAUTH-01 [§75] Google: Gmail, Google Calendar, Google Tasks.
- REQ-OAUTH-02 [§75] Microsoft: Outlook Mail, Microsoft Calendar, Microsoft To Do.
- REQ-OAUTH-03 [§75] Apple: Apple Calendar and, where possible, Apple Reminders via native EventKit.
- REQ-OAUTH-04 [§75] Android: device calendar.
- REQ-OAUTH-05 [§75] Adapter interface. No provider-specific logic in the domain layer.
- REQ-OAUTH-06 [§76] Least privilege. Only the needed read scopes at first.
- REQ-OAUTH-07 [§76] Write scopes (mail send, calendar write) requested progressively, at the moment of need.
- REQ-OAUTH-08 [§76] Initial Google scopes: openid, email, profile, Gmail read, Calendar read. Microsoft follows the same principle.
- REQ-OAUTH-09 [§76] Refresh tokens are stored in server-side secure storage and never given to the client.
- REQ-OAUTH-10 [§76] Disconnect and revoke supported.
- REQ-OAUTH-11 [§76] An expired connection shows "Bağlantıyı yenile."

### Database
- REQ-DB-01 [§77] Minimum tables: profiles, user_preferences, connected_accounts, oauth_credentials, sync_states, email_threads, email_messages, calendar_events, tasks, commitments, reminders, contacts, vip_people, priority_rules, insights, life_events, briefings, briefing_items, approval_actions, assistant_threads, assistant_messages, memory_chunks, captures, notification_preferences, push_tokens, subscriptions, referrals, referral_credits, ai_feedback, audit_logs, support_tickets, support_notes, feature_flags, feature_flag_overrides, announcements, prompt_versions, data_export_requests.
- REQ-DB-02 [§77] New tables only when needed, with no duplicate schema.
- REQ-DB-03 [§77] Migrations are versioned.
- REQ-DB-04 [§78] Every user-data table is user-scoped, indexed, validated and timestamped.
- REQ-DB-05 [§78] Timestamps are UTC.
- REQ-DB-06 [§78] User timezone is stored separately.
- REQ-DB-07 [§78] Idempotency keys are enforced via a required field, unique constraint or safe dedupe.
- REQ-DB-08 [§78] Unique constraints are used.
- REQ-DB-09 [§78] Soft deletion where needed.
- REQ-DB-10 [§147] Each table spec has: Table, Purpose, Columns, PK, FKs, Unique, Indexes, RLS, Retention, Sensitive fields, Audit implications.

### RLS
- REQ-RLS-01 [§79] RLS is enabled on every user-data table.
- REQ-RLS-02 [§79] Users can read and write only their own data.
- REQ-RLS-03 [§79] Admin operations are protected server-side.
- REQ-RLS-04 [§79] The service role is used only in trusted backend contexts and never sent to a browser.
- REQ-RLS-05 [§79] RLS has automated tests.

### AI pipeline / model abstraction
- REQ-AI-01 [§80] Pipeline stages: ingestion → normalization → deterministic filters/rules → dedupe → lightweight classification → large reasoning model only when necessary → structured output validation → source grounding → persistence → insight.
- REQ-AI-02 [§80] Structured outputs are validated with Zod.
- REQ-AI-03 [§80] LLM free text is never wired directly to a critical domain action.
- REQ-AI-04 [§80] AI-derived deadline, amount, person relation, event and commitment are verified against a source reference.
- REQ-AI-05 [§80] Low-confidence facts are shown with explicit wording, e.g. "Kaynakta kesinleşmiyor."
- REQ-AI-06 [§81] Backend model/provider adapters, at least Anthropic and OpenAI, swappable.
- REQ-AI-07 [§81] Model choice is not hardcoded.
- REQ-AI-08 [§81] Model config and prompt versions are controllable from the backoffice, without exposing secrets.

### AI cost control
- REQ-COST-01 [§82] Caching.
- REQ-COST-02 [§82] Deduplication.
- REQ-COST-03 [§82] Prompt limits.
- REQ-COST-04 [§82] Token limits.
- REQ-COST-05 [§82] Batching where valid.
- REQ-COST-06 [§82] Rate limits.
- REQ-COST-07 [§82] Per-user usage limits.
- REQ-COST-08 [§82] Free-plan limits.
- REQ-COST-09 [§82] Cost telemetry.
- REQ-COST-10 [§82] The same mail is never reprocessed with full reasoning repeatedly.

### Hallucination control
- REQ-HALL-01 [§83] No deadline without a source.
- REQ-HALL-02 [§83] No amount without a source.
- REQ-HALL-03 [§83] No event without a source.
- REQ-HALL-04 [§83] No person relation without a source.
- REQ-HALL-05 [§83] No commitment without a source.
- REQ-HALL-06 [§83] Every important claim carries source ID, source timestamp, provider and confidence.

### Web fetch security (SSRF)
- REQ-SSRF-01 [§84] Block localhost.
- REQ-SSRF-02 [§84] Block private IP ranges.
- REQ-SSRF-03 [§84] Block loopback.
- REQ-SSRF-04 [§84] Block `file://`.
- REQ-SSRF-05 [§84] Reject unsupported schemes.
- REQ-SSRF-06 [§84] Limit redirects.
- REQ-SSRF-07 [§84] Limit response size.
- REQ-SSRF-08 [§84] Enforce a timeout.
- REQ-SSRF-09 [§84] Validate content-type.
- REQ-SSRF-10 [§84] Mitigate DNS rebinding (resolve, pin the IP, re-check on each redirect).

### File security
- REQ-FILE-01 [§85] Upload size limit.
- REQ-FILE-02 [§85] MIME validation.
- REQ-FILE-03 [§85] Extension validation.
- REQ-FILE-04 [§85] Uploaded files are never executed.
- REQ-FILE-05 [§85] Storage is isolated per user.
- REQ-FILE-06 [§85] Access only via signed URLs.
- REQ-FILE-07 [§85] Uploads are cleaned up.
- REQ-FILE-08 [§85] PDF and image parsing runs in a sandboxed worker.

### Notification security
- REQ-NSEC-01 [§86] Sensitive mail details are not shown in pushes by default.
- REQ-NSEC-02 [§86] Detail modes: full detail, title only, generic.
- REQ-NSEC-03 [§86] The detail mode is a user preference.
- REQ-NSEC-04 [§86] Lock-screen privacy control.

### Local security
- REQ-LSEC-01 [§87] Sensitive local data is encrypted.
- REQ-LSEC-02 [§87] OAuth and session tokens are never stored in AsyncStorage.
- REQ-LSEC-03 [§87] Tokens use SecureStore or platform secure storage.
- REQ-LSEC-04 [§87] No unnecessary persistence of raw mail bodies.
- REQ-LSEC-05 [§87] Logout clears sensitive cache and local account data and invalidates the push token where relevant.

### Authentication
- REQ-AUTH-01 [§88] App sign-in with Apple, Google, Microsoft and Email.
- REQ-AUTH-02 [§88] App login is separate from integration auth (e.g. an Apple app account can connect Gmail).
- REQ-AUTH-03 [§88] Uses Supabase Auth.
- REQ-AUTH-04 [§88] Backoffice auth is a separate security boundary.

### Demo / credentials / platform limits
- REQ-DEMO-01 [§89] Development never stops for missing credentials.
- REQ-DEMO-02 [§89] Deterministic demo adapters.
- REQ-DEMO-03 [§89] Demo dataset covers users, emails, calendars, meetings, commitments, briefings, shipments, flights, payments, subscriptions.
- REQ-DEMO-04 [§89] Demo mode is never active in production without explicit configuration.
- REQ-DEMO-05 [§89] No fake success responses in production code.
- REQ-CRED-01 [§90] When a credential is missing, create `.env.example`, the adapter, a config surface, safe error handling and a dev/demo fallback, and continue all credential-free work.
- REQ-CRED-02 [§90] Show a clearly marked "external credential required" state.
- REQ-CRED-03 [§149] Credential matrix columns: Provider, Credential, Why, Environment, Used by, Required for local demo?, Production required?
- REQ-PLAT-01 [§91] No faked capabilities or misleading UI. Implement the closest real native behavior.
- REQ-PLAT-02 [§91] Every limitation is documented in docs/KNOWN_PLATFORM_LIMITATIONS.md.
- REQ-PLAT-03 [§91] iOS never claims Android-style system notification access.

### Accessibility
- REQ-A11Y-01 [§92] Semantic labels and screen-reader labels on mobile, web and backoffice.
- REQ-A11Y-02 [§92] Dynamic text sizing.
- REQ-A11Y-03 [§92] Contrast.
- REQ-A11Y-04 [§92] Hit targets.
- REQ-A11Y-05 [§92] Keyboard navigation where relevant.
- REQ-A11Y-06 [§92] Focus management.
- REQ-A11Y-07 [§92] Accessibility is implemented in the component layer, not as final polish.

### States / offline
- REQ-STATE-01 [§93] Every main screen implements loading, empty, error, offline, retry, reconnect and partial-data states.
- REQ-STATE-02 [§93] Production edge states exist even where the prototype shows only the happy path.
- REQ-OFF-01 [§94] Mobile caches data where appropriate.
- REQ-OFF-02 [§94] Offline, cached Today and Calendar are shown meaningfully.
- REQ-OFF-03 [§94] Offline writes are queued or blocked with a clear state.
- REQ-OFF-04 [§94] The real sync status is shown.
- REQ-OFF-05 [§94] Safe resync when back online.
- REQ-OFF-06 [§94] No duplicate writes after reconnect.

### Search
- REQ-SEARCH-01 [§95] Global search covers emails, people, calendar, tasks, commitments, life events, memories and captures.
- REQ-SEARCH-02 [§95] Access control and source provenance are preserved in results.

### Scheduling / notification decision engine
- REQ-SCHED-01 [§96] Backend scheduling and client local scheduling are separated where appropriate.
- REQ-SCHED-02 [§96] Recurring jobs: morning briefing, midday pulse, evening close, weekly review, retention cleanup, provider sync, webhook reconciliation.
- REQ-SCHED-03 [§96] Jobs are idempotent.
- REQ-SCHED-04 [§96] Jobs use the user's timezone.
- REQ-SCHED-05 [§96] DST transitions are handled correctly.
- REQ-NENG-01 [§132] Before sending, check relevance, urgency, user preference, quiet hours, dedupe, recent frequency and lock-screen sensitivity.
- REQ-NENG-02 [§132] Low-value notifications are suppressed.
- REQ-NENG-03 [§132] Suppression counts are visible as a backoffice metric.

### Provenance / explainability
- REQ-PROV-01 [§97] Insights and derived objects store source_type, source_id, source_provider, source_timestamp and confidence.
- REQ-PROV-02 [§97] "Bu nereden çıktı?" opens the real source.
- REQ-EXPL-01 [§131] Tapping an insight shows its source.
- REQ-EXPL-02 [§131] Tapping an insight shows a short "why important" explanation.
- REQ-EXPL-03 [§131] The original provider screen can be opened where needed.
- REQ-EXPL-04 [§131] No opaque, unexplained AI verdicts.

### Completion policies / quality gate
- REQ-E2EF-01 [§98] Each feature completes the chain UI → state → API/action → backend → DB → provider/AI → approval if required → external side effect → confirmation → refreshed state. Any faked link means not done.
- REQ-DEAD-01 [§99] Every visible button, CTA, setting row, card action, switch or tab changes state, opens a screen or sheet, runs a valid action, confirms, or hands off externally. Otherwise it is not rendered as clickable.
- REQ-NOPH-01 [§100] The production path contains no TODO, FIXME, Coming Soon, Later, Future, Placeholder, fake success, fake provider, empty onPress or empty onClick.
- REQ-NOPH-02 [§100] Demo fixtures sit behind an explicit dev/demo flag.
- REQ-QG-01 [§133] Before acceptance, grep the repo for TODO, FIXME, empty onPress/onClick, fake success, fake provider, coming soon, placeholder, dead navigation, unreachable screens, unhandled async errors, insecure token storage, client-side service role and missing RLS, and clean the production path.

### Tests
- REQ-TEST-01 [§101] Unit tests: priority engine, classification normalization, date parsing, timezone, commitment detection, reminder rules, referral anti-abuse, entitlements, source grounding, RLS helpers.
- REQ-TEST-02 [§101] Integration tests: OAuth, sync, database, AI adapters, approval actions, provider writes, RevenueCat webhooks, notifications.
- REQ-TEST-03 [§101] E2E for critical flows on mobile, backoffice and web.
- REQ-TEST-04 [§102] Mobile E2E: onboarding, auth, Gmail connect, Calendar connect, briefing, important mail, reply, approval, reminder, plan, meeting prep, commitment, assistant, search, capture, paywall, referral, dark mode, privacy, offline/reconnect.
- REQ-TEST-05 [§103] Backoffice E2E with Playwright: admin login, dashboard, user search, user detail, integration view, sync job retry, briefing operation, AI cost, prompt activation, feature flag, support, audit, data request, entitlement grant, logout.
- REQ-TEST-06 [§104] Web QA: landing, pricing, CTA, legal pages, responsive breakpoints, keyboard navigation, basic SEO.

### CI/CD
- REQ-CI-01 [§105] GitHub Actions (or equivalent) pipeline: install → lint → typecheck → unit → integration → web build → backoffice build → Supabase migration validation → E2E where feasible.
- REQ-CI-02 [§105] Mobile EAS build validation.

### Documentation
- REQ-DOCS-01 [§106] README.md.
- REQ-DOCS-02 [§106] docs/: ARCHITECTURE, DATABASE, OAUTH, AI_PIPELINE, SECURITY, PRIVACY, MOBILE, BACKOFFICE, BACKOFFICE_RBAC, DEPLOYMENT, TESTING, AI_PROMPTS, DESIGN_MAPPING, STORE_CHECKLIST, KNOWN_PLATFORM_LIMITATIONS, plus the 11 plan docs.

### Environment / identifiers / deployment
- REQ-ENV-01 [§107] Complete `.env.example` covering Supabase, Google, Microsoft, Anthropic/OpenAI, Embeddings, STT, TTS, RevenueCat, Sentry, Analytics, Push, Encryption, Webhook secrets, App URLs.
- REQ-ENV-02 [§107] No secrets in frontend bundles.
- REQ-ENV-03 [§107] `.env` is never committed.
- REQ-ID-01 [§108] iOS bundle id `com.dijitalasistan.app`.
- REQ-ID-02 [§108] Android package `com.dijitalasistan.app`.
- REQ-ID-03 [§108] URL scheme `dijitalasistan`.
- REQ-ID-04 [§108] All three identifiers are configurable.
- REQ-DEPLOY-01 [§109] Mobile is EAS-ready for iOS and Android.
- REQ-DEPLOY-02 [§109] Web is Vercel-compatible.
- REQ-DEPLOY-03 [§109] Backoffice deploys separately and is admin-subdomain compatible.
- REQ-DEPLOY-04 [§109] Supabase migrations, functions and scheduled jobs are deployable, and secrets are documented.

### Retention loop / store preparation
- REQ-LOOP-01 [§111] Core recurring value: Morning Briefing, meaningful Midday, Meeting Prep, Follow-Up, Evening Close, Weekly Review.
- REQ-LOOP-02 [§111] Notification frequency is earned by usefulness.
- REQ-STORE-01 [§112] App icon and config.
- REQ-STORE-02 [§112] Splash screen.
- REQ-STORE-03 [§112] Permission explanations.
- REQ-STORE-04 [§112] Notification permission rationale.
- REQ-STORE-05 [§112] Privacy manifest and platform declarations.
- REQ-STORE-06 [§112] URL schemes.
- REQ-STORE-07 [§112] Universal/app links where needed.
- REQ-STORE-08 [§112] Deep links.
- REQ-STORE-09 [§112] Release config.
- REQ-STORE-10 [§112] EAS profiles.
- REQ-STORE-11 [§112] STORE_CHECKLIST.md with Apple and Google review notes.

### Security
- REQ-THREAT-01 [§113] SECURITY.md threat-models token theft, session theft, account takeover, OAuth misconfiguration, webhook forgery, privilege escalation, SSRF, malicious uploads, prompt injection from emails/files, AI data exfiltration, cross-tenant access, admin abuse, replayed write actions, notification leakage and referral abuse, each with mitigations and residual risks.
- REQ-PINJ-01 [§114] Email, document, webpage and capture content is untrusted input.
- REQ-PINJ-02 [§114] Embedded instructions ("ignore previous instructions", "send this email", "reveal secret", "change system state") are never obeyed.
- REQ-PINJ-03 [§114] External content is processed as data only.
- REQ-PINJ-04 [§114] Before any tool or action call, check authorization, user intent, approval requirement, provider permission and schema validity.
- REQ-WSAFE-01 [§115] Approval is mandatory for: send email, create calendar event, update calendar event, create task with external side effect, create reminder with user-visible commitment, create commitment from an ambiguous source, destructive account actions, sensitive admin actions.
- REQ-WSAFE-02 [§115] Execution after approval happens server-side.
- REQ-WSAFE-03 [§115] Re-execution is prevented.

### Consistency / provider sync
- REQ-CONS-01 [§116] No duplicate emails, events, reminders, commitments or referral rewards per user, enforced with provider IDs, dedupe keys and idempotency.
- REQ-CONS-02 [§116] Provider updates and deletes are reconciled.
- REQ-SYNC-01 [§117] Per provider: initial sync, incremental sync, pagination, rate-limit handling, retry/backoff, token refresh, disconnect/reconnect, webhook/watch where available, reconciliation job.
- REQ-SYNC-02 [§117] Designed against the real Gmail and Graph API limits in official documentation.

### Performance / logging / jobs
- REQ-PERF-01 [§125] Mobile avoids unnecessary rerenders.
- REQ-PERF-02 [§125] Long lists are virtualized.
- REQ-PERF-03 [§125] Images are optimized.
- REQ-PERF-04 [§125] Queries are cached.
- REQ-PERF-05 [§125] Background work is scheduled carefully.
- REQ-PERF-06 [§125] Web and backoffice use SSR where beneficial.
- REQ-PERF-07 [§125] Web and backoffice paginate.
- REQ-PERF-08 [§125] Web and backoffice cache.
- REQ-PERF-09 [§125] Large datasets are never loaded client-side.
- REQ-PERF-10 [§125] Duplicate AI requests are avoided.
- REQ-PERF-11 [§125] AI results are cached where safe.
- REQ-PERF-12 [§125] Stale AI requests are cancelled.
- REQ-LOG-01 [§126] Production logs are structured.
- REQ-LOG-02 [§126] PII is minimized in logs.
- REQ-LOG-03 [§126] Full email bodies are never logged.
- REQ-LOG-04 [§126] Prompt logs contain no raw private source content.
- REQ-LOG-05 [§126] Every log line carries a correlation ID.
- REQ-LOG-06 [§126] Severities: debug, info, warn, error.
- REQ-JOB-01 [§127] Every cron/job is idempotent.
- REQ-JOB-02 [§127] Jobs are retryable where appropriate.
- REQ-JOB-03 [§127] Jobs are timeout-controlled.
- REQ-JOB-04 [§127] Jobs are observable.
- REQ-JOB-05 [§127] Job failure state is persisted.
- REQ-JOB-06 [§127] Jobs are dead-letterable where appropriate.

### Export / deletion / settings
- REQ-EXPORT-01 [§128] Export runs as an async job.
- REQ-EXPORT-02 [§128] The export is a secure artifact.
- REQ-EXPORT-03 [§128] Access is via an expiring signed URL.
- REQ-EXPORT-04 [§128] A status page shows export progress.
- REQ-EXPORT-05 [§128] Exports are audited.
- REQ-EXPORT-06 [§128] No secrets or tokens in exports.
- REQ-DEL-01 [§129] Deletion requires explicit confirmation.
- REQ-DEL-02 [§129] Deletion states its consequences clearly.
- REQ-DEL-03 [§129] Deletion is a queued job where necessary.
- REQ-DEL-04 [§129] Deletion is audited.
- REQ-DEL-05 [§129] Deletion includes local cleanup.
- REQ-DEL-06 [§129] Deletion revokes provider access where possible.
- REQ-DEL-07 [§129] No fake "deleted" success.
- REQ-SET-01 [§130] Settings include at least Profile, Connected Accounts, Notifications, Privacy, AI Personalization, Priority Rules, Appearance, Language, Subscription, Referral, About, Delete Account.
- REQ-SET-02 [§130] Every setting is bound to real persisted state.

### Data boundary / secrets / release / acceptance
- REQ-DATA-01 [§151] Frontends receive only the data they need.
- REQ-DATA-02 [§151] No unnecessary raw provider data in API responses.
- REQ-DATA-03 [§151] Sensitive provider content is minimized.
- REQ-DATA-04 [§151] Admin APIs return even less data.
- REQ-SECRET-01 [§152] Secrets are never in git.
- REQ-SECRET-02 [§152] Secrets are never in frontend bundles.
- REQ-SECRET-03 [§152] Secrets are never in logs.
- REQ-SECRET-04 [§152] Secrets are never shown in the backoffice UI.
- REQ-SECRET-05 [§152] Secrets are never sent to analytics.
- REQ-SECRET-06 [§152] `.env.example` contains key names only.
- REQ-REL-01 [§153] Before release, verify in a real or sandbox environment: fresh install, sign in, onboarding, connect provider, first sync, first briefing, important insight, approval, provider write, notification, purchase/restore, deletion.
- REQ-ACC-MOB-01 [§135] Mobile has real working implementations of: Authentication, Onboarding, Integration setup, Today, Morning Briefing, Midday, Evening Close, Weekly Review, Flow, Mail Intelligence, Email Detail, AI Reply, Follow-Up, Commitments, Plan, Calendar Intelligence, Meeting Prep, Post Meeting, Life Intelligence, Assistant, Voice, Memory, Search, Universal Capture, Smart Reminders, VIP, Person Intelligence, Priority Rules, AI Personalization, Approval Center, Notifications, Widgets, Dark Mode, Privacy Center, Subscription/Paywall, Referral, Settings.
- REQ-ACC-BO-01 [§136] Backoffice has real working implementations of: Admin auth, RBAC, Dashboard, Users, User detail, Integrations, Sync & Jobs, Briefings, Notifications, AI Operations, AI Costs, Prompt Management, Subscriptions, Entitlements, Referrals, Support, Feedback, Feature Flags, Announcements, Data Requests, Audit Logs, System Health, Admin Users, Global Search, Command Palette, Dark Mode, Privacy controls, Server pagination.
- REQ-ACC-WEB-01 [§137] Public web delivers: responsive landing, pricing, privacy, terms, data deletion, support, app CTA, integrations, security messaging, SEO basics.

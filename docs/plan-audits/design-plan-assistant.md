# Audit: PRIMARY 05 "Plan ve Toplantılar" and 06 "Asistan, Ses, Hafıza, Kişiler, Onay"

## 0. Inventory and scope facts

- **PRIMARY `05 Plan ve Toplantilar.dc.html`** has 8 artboards: 5.1, 5.1D, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7.
  - Data script: `PREP` (6 sections), `DAY` (7 items), `WEEK` (7 days).
  - `renderVals` derives `days` / `daysDark`, `day` / `dayDark` (styling per type), `week` (bar colors), `prep` / `prepDark` (row borders) and `bars` (a 26-bar mini waveform).
- **PRIMARY `06 Asistan Hafiza Kisiler.dc.html`** has 10 artboards: 6.1, 6.1D, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9.
  - Data script: `RESULTS` (3), `VIP` (4 groups, 6 people), `PERSON` (4 sections), `APPR` (3), `RULES` (3 groups, 7 rows), and `wave` (22 bars).
- **Page intro copy, verbatim:**
  - 05: "Plan takvimi göstermez, anlar. Zaman çizelgesi tek sütun; etkinlik, AI görev bloğu (kesik çerçeve) ve yaşam etkinliği (sıcak yüzey) üç ayrı yüzeyle ayrılır; sol renk şeridi kullanılmaz. Toplantı hazırlığı ürünün imza ekranıdır: koyu “3 şey” kartı her zaman ilk görünen öğedir."
  - 06: "Sohbet ikinci katmandır ve hiçbir zaman boş açılmaz: bugünün analiz özeti + 5 önerilen soru. Yanıtlar düz metin değil, kaynaklı zengin kartlardır. Her yazma isteği (mail, etkinlik, hatırlatıcı) ses modunda bile onay kartına düşer."
- **Not in 05/06 (covered in other primary files):**
  - Commitments list (§18) is in `04` artboard **4.8 "Taahhütler · Verdiğin sözler"**.
  - Universal Capture (§27) is in `04` **4.10 "Evrensel Yakalama · Ekran görüntüsü"** and **4.11 "Yakalama · Fatura fotoğrafı + Akıllı hatırlatıcı"**.
  - 05 only covers commitment **creation**, from Post Meeting (5.7).
  - Global Search (§95) has no dedicated primary screen. 6.5 (AI Hafıza) is the only search surface.
- **Supplementary state evidence.** `Dijital Asistan.dc.html` is the interactive prototype. It re-implements Plan, Asistan, Prep, Post, Person, Voice and Sheet, and adds these states:
  - Plan "Planlandı" state: AI block becomes `#EDEDFC` + `1px solid #5B5CE2`; the CTA becomes `#E4F5EA` / `#1E7A47` with a `check` icon.
  - Toast: `#1A1917` pill, 14/500, icon 18 `#A9AAF5`, bottom 104, visible 2.6 s, 300 ms motion.
  - Typing dots in chat.
  - Its stubs are flagged per screen below.
- **08 (Durumlar) provides edge-state copy that applies here.** It is quoted where relevant.
  - `EMPTIES`: "empty/plan", "empty/approvals".
  - `ERRORS`: "error/permission-denied", "error/ai-unavailable", "error/sync-delayed", "error/oauth-expired".
  - `MOTION`: bottom sheet 300/240/250 ms; success ring 500 ms; skeleton shimmer 1.6 s; pull-to-sync shows "Güncel · 09:41" for 1.5 s; haptics are success / light / warning.

---

## 1. PRIMARY screen blocks

### Plan · Gün (Light) / Plan Day view
- **Source:** PRIMARY / 05 / artboard **5.1 "Plan · Gün"**.
- **Purpose:** Tab root for Plan. One-column day timeline that mixes calendar events, AI task blocks, free gaps, life items and deadlines, with a proactive Calendar Intelligence card for scheduling.
- **Layout, top to bottom:**
  - Screen background `#F5F4F0` (neutral/bg). Content padding `14px 20px 0`, vertical gap 16.
  - **Header row:** title "Plan" in Geist 28/34, weight 600, letter-spacing −.02em, `#1A1917`. On the right, a **SegmentedControl**:
    - Track `#E9E7E1`, radius 999, padding 3, 13px/600.
    - Segment height 30, padding 0 14, radius 999.
    - Selected "Gün": `#fff`, text `#1A1917`, shadow `0 1px 3px rgba(27,25,23,.12)`. Unselected "Hafta": text `#6B6860`.
  - **Day strip:** 7 cells, space-between. Each cell is 42×60, radius 14, column layout with gap 2.
    - Weekday 11px/500, opacity .8. Number 17px/600. Dot 4×4, radius 2.
    - Cells from data: Pzt 1 … Paz 7.
    - Today (index 4, "Cum 5"): bg `#1A1917`, text `#fff`, dot `#A9AAF5`.
    - Other cells: `#fff` / `#1A1917`.
    - Dots: past days `#E0DED7`; next day (Cmt) `#5B5CE2`; Paz `transparent`.
  - **AI Insight card "TAKVİM ZEKÂSI":**
    - Background `radial-gradient(140% 100% at 0% 0%, #E4E4FA 0%, #FFFFFF 60%)`, radius 20, padding 16.
    - Shadow `0 1px 2px rgba(27,25,23,.04), 0 6px 20px rgba(27,25,23,.05)`.
    - Kicker: `auto_awesome` (FILL 1, 16px) + 12px/600, letter-spacing .06em, `#5B5CE2`.
    - Headline 16/23 600, −.01em, `text-wrap: pretty` (8px below kicker). Body 14/20 `#6B6860` (4px below).
    - Actions (12px below, gap 8):
      - Primary: height 40, padding 0 16, radius 12, `#5B5CE2` / `#fff`, 14/600, icon `event_available` 18, gap 6.
      - Ghost: height 40, padding 0 14, `#6B6860`, 14/600.
  - **Timeline** (padding-bottom 16). Each row is flex with gap 12, min-height 68.
    - Time gutter: 44px wide, right-aligned, 12/500 `#9B978E`, padding-top 8.
    - Content column: top hairline `1px solid rgba(27,25,23,.07)`, padding 4 0.
    - Block: radius 14, padding 10 14, column with gap 2. Title row 15/600, −.01em, Material icon 16 + text, gap 6. Meta 12px.
    - Styling by `type`:
      - `event`: bg `#fff`, border `1px solid rgba(27,25,23,.06)`, icon `#6B6860`, meta `#9B978E`.
      - `ai`: bg `#F7F7FE`, border `1px dashed #A9AAF5`, icon `#5B5CE2`, meta `#4547C9`.
      - `gap`: bg transparent, border `1px dashed rgba(27,25,23,.15)`, text `#9B978E`, icon `#B8B4AA`.
      - `life`: bg `#FDF6EC`, border hairline, icon `#6B6860`.
      - Planned AI block (from interactive prototype): bg `#EDEDFC`, border `1px solid #5B5CE2`.
  - **Bottom tab bar** (sticky): height 90, padding `8px 8px 28px`, bg `rgba(255,255,255,.92)`, `backdrop-filter: blur(20px)`, top border `rgba(27,25,23,.06)`, labels 11/500.
    - Icons 26px Material Symbols Rounded: `sunny` Bugün, `dynamic_feed` Akış, `calendar_today` Plan, `auto_awesome` Asistan.
    - Active tab `#5B5CE2` with FILL 1; inactive `#9B978E`. The home indicator is frame chrome.
- **Exact copy:**
  - "Plan", "Gün", "Hafta".
  - Day labels "Pzt Sal Çar Per Cum Cmt Paz" with numbers 1–7.
  - "TAKVİM ZEKÂSI", "Yarın 14:00–16:30 arasında 2,5 saat boşluğun var.", "Teklif hazırlama görevini buraya yerleştirebilirim.", "Planla", "Başka zaman".
  - Timeline rows: "09:00 Haftalık ekip — 60 dk · Ofis"; "11:00 Ürün gözden geçirme — 30 dk · Online"; "12:00 2 saat boşluk — Öğle yemeği ve odaklanma için uygun"; "14:30 Mehmet ile müşteri toplantısı — 60 dk · Ofis · Hazırlık hazır"; "16:00 Teklif hazırlama — Önerilen · 45 dk · AI görev bloğu"; "17:00 Başvuru son saati — Girişim programı · Mailden tespit edildi"; "20:30 Akşam yemeği · Karaköy — Rezervasyon · 4 kişi".
  - Caption: "Üç yüzey: etkinlik (beyaz), AI görev bloğu (kesik indigo çerçeve, “Önerilen”), yaşam (sıcak krem). Boşluklar açıkça “2 saat boşluk” olarak etiketlenir; boşluk da bilgidir."
- **Data fields → entities:**
  - Day strip → selected date and a per-day "has items" / "has AI proposal" flag (the dot semantics are undefined; see issues).
  - Calendar Intelligence card → `insights` (type `free_slot` / `schedule_proposal`): window start/end (tomorrow 14:00–16:30), duration "2,5 saat", candidate `tasks` row ("Teklif hazırlama"), rationale, status. It links to an `approval_actions` row (`calendar_create`).
  - Event rows → `calendar_events` (start_at, duration → end_at, title, location "Ofis" / "Online", attendees, provider, prep status "Hazırlık hazır" from a meeting_prep artifact).
  - `ai` row → schedule proposal or task block (proposed start, duration 45 dk, label "Önerilen", status proposed/approved).
  - `gap` row → a free slot computed on the fly (not stored), with a suggestion label.
  - "Başvuru son saati" → deadline (`tasks`, or `life_events` with type deadline) plus source `email_messages` ("Mailden tespit edildi").
  - `life` row → `life_events` type `reservation` (venue Karaköy, party_size 4, source email).
- **Interactions → production behavior:**
  - Segment Gün/Hafta: switch view in place (state only). Persist the last view per viewer (local storage is fine).
  - Day cell tap: load the timeline for that date. Horizontal swipe on the strip moves to the previous/next week. Deep link `plan?date=YYYY-MM-DD`.
  - **"Planla"** must not write directly (§19, §3.8). Open the **Plan Proposal Approval sheet** (restyled from the secondary sheet, see §2).
    - The sheet shows what (title), when (exact start–end, e.g. "Yarın 14:00–16:30", or 45 dk inside the window), target calendar/account, side effects ("Takvimine 1 etkinlik eklenir · Davetli yok · Bildirim gitmez"), and why + source.
    - Buttons: **Onayla / Saati Değiştir / İptal**.
    - On Onayla: `approval_actions` (calendar_create) moves pending → approved → executing. The server-side provider insert uses an idempotency key = proposal id. Then refresh the timeline.
    - The CTA morphs to "Planlandı" (`#E4F5EA` / `#1E7A47`, `check`) and the AI block turns solid. Success haptic plus toast.
    - If no calendar write scope, run progressive OAuth (§76) before executing.
  - **"Başka zaman"**: dismiss or snooze this proposal and ask the engine for the next valid slot. Show alternatives in the same sheet or as the next card. Record `ai_feedback` (negative/neutral). Never show a toast-only fake.
  - Event row tap:
    - Meeting with attendees opens **Meeting Prep** (5.4).
    - Other events open **Event Detail**, which is not designed and is needed. It shows title/time/location, a "Haritada aç" handoff, a meeting link handoff, and "Takvimde aç" (provider deep link).
  - AI row tap: same approval sheet as "Planla" (the proposal id).
  - Gap row tap: sheet with "Odak bloğu öner" / "Görev yerleştir" (creates a proposal → approval).
  - Life row tap: Life Intelligence card detail (04 4.9) with source.
  - Deadline row tap: source email (Email Detail 04 4.4) or task.
  - Pull-to-refresh: provider sync (08: "Aşağı çekme → ince indigo çizgi üstte, tamamlanınca “Güncel · 09:41” 1,5 sn").
  - Tab bar: standard tab navigation.
- **States depicted:** light happy path only. Interactive prototype adds the planned state (`Planlandı`) and a toast.
- **States missing that production needs:**
  - Skeleton timeline (08: "İskelet gerçek kart ölçülerinde").
  - Empty day (08 `empty/plan`: icon `self_improvement`, bg `#EDEDFC`, fg `#4547C9`, "Bugün takvimin oldukça sakin." / "Yarın 09:00 Haftalık ekip ile başlıyorsun. Bugünü odak için kullanabilirsin." / CTA "Odak bloğu öner").
  - Calendar permission denied (08: "Takvim izni verilmedi." / "Toplantı hazırlığı ve çakışma uyarıları takvim erişimi gerektirir. Diğer her şey çalışıyor." / "İzin Ver" / "Neden gerekli?").
  - No calendar connected (CTA "Takvim bağla").
  - OAuth expired ("Bağlantıyı yenile", §76).
  - Sync delayed / stale banner (08 copy).
  - Offline with cached timeline plus "Son güncelleme HH:MM"; writes queued or blocked (§94).
  - Approval pending state on the AI block ("Onay bekliyor"), executing (spinner), failed ("Takvime eklenemedi · Tekrar dene").
  - Proposal expired (the slot has passed).
  - Overlapping events inside the day list (conflict rendering is not shown in Day view).
  - All-day events row.
  - Multi-calendar colour/account indicator.
  - Timezone/DST edge.
  - Free-plan gating for "advanced planning" (§44).
  - Profile/avatar entry (§8).
  - Commitments and tasks on the timeline (§19 "Calendar + tasks + commitments").
- **Prototype-only / fake — do not copy:**
  - Fixture rows and counts.
  - Interactive-prototype `onPlan` sets `planned:true` plus toast "Planlandı · Yarın 14:00–16:30 Teklif hazırlama" with **no approval and no provider write**.
  - `toastLater` "Tamam, başka bir boşluk önereceğim" performs nothing.
  - Status bar, home indicator and phone frame are chrome.
- **Maps to:** §19, §20, §8, §29 (reminders from gaps), §33, §38, §76, §93, §94, §99, §115.

### Plan · Gün · Dark / Plan Day view (Dark)
- **Source:** PRIMARY / 05 / **5.1D "Plan · Gün · Dark"**.
- **Purpose:** Dark-token spec for 5.1.
- **Layout and tokens:**
  - Background `#141311`, text `#F2F0EB`, status time "21:14".
  - Segment track `rgba(255,255,255,.08)`. Selected is **inverted** (`#F2F0EB` bg / `#141311` text). Unselected `#A39F96`.
  - Day cells: `#1F1E1B` + `0 0 0 1px rgba(255,255,255,.06)`. Today `#F2F0EB` / `#141311`, no ring. Dots: past `#3A3936`, today `#5B5CE2`, next `#8586F2`.
  - AI card: `radial-gradient(140% 100% at 0% 0%, rgba(133,134,242,.28) 0%, #1F1E1B 60%)` + ring `rgba(255,255,255,.06)`. Kicker `#A9AAF5`, body `#A39F96`. "Planla" `#8586F2` / `#0F0F2A`; "Başka zaman" `#A39F96`.
  - Timeline:
    - Time gutter `#7A776F`, hairline `rgba(255,255,255,.07)`.
    - `event` `#1F1E1B` + `1px solid rgba(255,255,255,.06)`.
    - `ai` `rgba(133,134,242,.12)` + `1px dashed #8586F2`, icon/meta `#A9AAF5`.
    - `gap` transparent + `1px dashed rgba(255,255,255,.15)`, text `#7A776F`, icon `#5E5B54`.
    - `life` `rgba(240,184,90,.10)`.
    - Titles `#F2F0EB`, meta `#7A776F`, event icon `#A39F96`.
  - Tab bar: `rgba(20,19,17,.92)`, border `rgba(255,255,255,.08)`, inactive `#7A776F`, active `#A9AAF5`. Home indicator `rgba(255,255,255,.4)`.
- **Exact copy:** identical to 5.1. Caption: "Aynı üç yüzey dark tokenlarla: etkinlik #1F1E1B, AI bloğu %12 indigo + kesik #8586F2, yaşam %10 amber. Bugün günü ters çevrilir (#F2F0EB üzerine #141311), segment seçimi de aynı kuralı izler."
- **Data fields and interactions:** same as 5.1.
- **States depicted:** dark theme.
- **States missing:** the dark planned-AI-block style is undefined. Proposed: `rgba(133,134,242,.20)` + `1px solid #8586F2`, derived and to be confirmed. Dark "Planlandı" chip: success-text `#6FCF97` on `rgba(111,207,151,.14)` (proposed from the 01 DARK tokens).
- **Prototype-only:** same as 5.1.
- **Maps to:** §19, §38.

### Plan · Hafta + Takvim Zekâsı / Plan Week view + Calendar Intelligence
- **Source:** PRIMARY / 05 / **5.2 "Plan · Hafta + Takvim Zekâsı"**.
- **Purpose:** Week view framed as a density story, not a grid. Hosts the list of Calendar Intelligence insights: back-to-back, travel/leave-by, prep slot, conflict.
- **Layout, top to bottom:**
  - Header with "Hafta" selected.
  - **Density card:** `#fff`, radius 20, padding 16, standard card shadow.
    - Header row, baseline aligned: kicker "7–13 EYLÜL · YOĞUNLUK" 12/600, letter-spacing .08em, `#9B978E`; right side "18 etkinlik" 12px `#9B978E`.
    - Bars area (14px below header): height 120, 7 columns, gap 8. Each column stacks 2 bars, justified to the end, gap 3, radius 5. Heights in px from `WEEK.b`: Pzt [38,20], Sal [26,14], Çar [54,30], Per [30,10], Cum [22,26], Cmt [16,8], Paz [8,0].
    - Colors:
      - Normal day: top `#D9D6F7` (Toplantı), bottom `#EDEDFC` (Odak).
      - Hot day Çar: `#F3B7AE` / `#E0553F`.
      - Today Cmt: `#5B5CE2` / `#A9AAF5`.
    - Day labels 11/600: normal `#6B6860`; hot `#C7432F`; today `#5B5CE2`.
    - Legend (12px below), gap 14, 11px `#9B978E`, swatches 10×10 radius 3: `#D9D6F7` "Toplantı", `#EDEDFC` "Odak", `#F3B7AE` "Yoğun".
  - Section kicker "TAKVİM ZEKÂSI" (padding 4 4 0).
  - **4 InsightRowCards:** `#fff`, radius 16, padding 14 16, shadow; icon 20 with margin-top 1; title 15/600 −.01em; body 13/19 `#6B6860`; actions are text buttons 13/600, gap 14, 8px above. The last card has margin-bottom 16.
    1. `bolt` `#9A6300`: "Yarın oldukça yoğun." / "09:00 ve 10:00 toplantıların arka arkaya. Arada mola yok; 10:00'ı 10:15'e kaydırabilirim." Actions "10:15'e Kaydır" (`#4547C9`), "Böyle Kalsın" (`#6B6860`).
    2. `directions_car` `#2262BE`: "13:30 doktor randevusu için 12:50'de çıkman gerekebilir." / "Kadıköy → Nişantaşı · 38 dk trafik tahmini · Randevu maili, 28 Ağu". Action "12:40'a Hatırlat".
    3. `self_improvement` `#5B5CE2`: "16:00 toplantısı öncesi 45 dakika boşluğun var." / "Yatırımcı görüşmesi için hazırlık notunu okumaya yeter." Action "Hazırlığı Buraya Koy".
    4. `error` `#C7432F`: "Çarşamba 14:00 müşteri toplantısı ile 14:30 doktor çakışıyor." Action "Seçenekleri Gör".
  - Tab bar.
- **Exact copy:** as above. Caption: "Hafta görünümü grid değil yoğunluk hikâyesi. Zekâ kartları: ikon rengi anlam taşır (amber yoğunluk, mavi ulaşım, indigo fırsat, coral çakışma); her kartın en fazla 2 aksiyonu var."
- **Data fields → entities:**
  - Week range and event count come from an aggregate over `calendar_events`.
  - Per day: `meeting_minutes`, `focus_minutes` (focus = own AI/focus blocks or computed free time; must be defined), `is_overloaded` (threshold), `is_today`.
  - Each insight → `insights` row: type `back_to_back` | `travel_leave_by` | `prep_slot` | `conflict`, severity (colour), title, body, `actions[]` (≤2), source refs (e.g. `email_messages` "Randevu maili, 28 Ağu"), `dismissed_at`, `suppression_key`.
  - Travel insight: origin (Kadıköy), destination (Nişantaşı), ETA 38 dk, leave-by 12:50, reminder time 12:40, source email.
- **Interactions → production behavior:**
  - Bar column / day label tap: switch to Gün for that date.
  - **"10:15'e Kaydır"** → `approval_actions` `calendar_update` (10:00 → 10:15, attendee notification side effect shown).
    - Allowed only if the user is organizer or has modify rights. Google: `event.organizer.self` / `guestsCanModify`; `events.patch` with `sendUpdates` = `all` | `externalOnly` | `none` (https://developers.google.com/calendar/api/v3/reference/events/patch). Microsoft: `PATCH /me/events/{id}` (https://learn.microsoft.com/en-us/graph/api/event-update).
    - Otherwise, degrade to "Yeni saat öner" email draft (email_send approval).
  - **"Böyle Kalsın"**: dismiss the insight with a suppression key (event ids + start times hash) and write `ai_feedback`.
  - **"12:40'a Hatırlat"**: create a reminder (`reminders` + local/push schedule) at 12:40 via server with an idempotency key. The explicit tap with an exact time counts as confirmation (§29); show a success toast with undo.
  - **Travel card is only allowed when it has a real ETA source:**
    - Google Routes API `computeRoutes` with `routingPreference: TRAFFIC_AWARE` (https://developers.google.com/maps/documentation/routes/compute_route_directions), or Apple MapKit `MKDirections.calculateETA` via a native module.
    - A real origin: device location with permission, the user-set home/work address, or the previous event's location.
    - §20: "Seyahat süresi kaynakta yoksa uydurma." Without a provider or origin, hide the ETA or phrase it without minutes.
  - **"Hazırlığı Buraya Koy"**: `calendar_create` approval for a prep block (e.g. 15:15–16:00 "Hazırlık: Yatırımcı görüşmesi"). Alternative: a local reminder "Hazırlık notunu oku" at 15:15. It must link to Meeting Prep for the 16:00 event.
  - **"Seçenekleri Gör"**: push the Conflict screen (5.3) with the sheet open.
  - Insight card body tap: "Bu nereden çıktı?" source sheet (§97, §131).
- **States depicted:** light only.
- **States missing:** dark variant; skeleton; no-insight state (e.g. "Bu hafta dengeli görünüyor."); empty week; partial data (one calendar failed to sync); stale data; permission denied; action in-flight / approved / failed per card; "Pro" gate if advanced planning is Pro (§44).
- **Prototype-only / fake:**
  - "38 dk trafik tahmini" and "Kadıköy" are fabricated unless sourced.
  - The interactive prototype drops all card actions except "Seçenekleri Gör", which only shows toast "Çözüm seçenekleri · Bkz. 05 Plan" (stub navigation).
  - Fixed bar heights.
- **Maps to:** §19, §20, §29, §33, §97, §115, §131.

### Takvim Çakışması + "Nasıl çözelim?" sheet / Calendar Conflict with resolution sheet
- **Source:** PRIMARY / 05 / **5.3 "Takvim Çakışması · Çözüm sayfası açık"**.
- **Purpose:** Explain one conflict and offer ranked resolutions. Each resolution becomes an approval and is never auto-applied.
- **Layout, top to bottom:**
  - Header row: 36px round back button (`#fff`, shadow `0 1px 2px rgba(27,25,23,.08)`, `arrow_back` 20), centered kicker "ÇARŞAMBA · 10 EYLÜL" 12/600 .08em `#9B978E`, 36px spacer.
  - Kicker: `error` 16 + "TAKVİM ÇAKIŞMASI" 12/600 .06em `#C7432F`. Headline (8px below) "Bu iki etkinlik çakışıyor." 26/32 600 −.02em.
  - **Conflict pair** (relative container, gap 8):
    - Card A `#fff`, radius 16, padding 14 16, shadow: time "14:00" 48px wide 14/600; title "Müşteri toplantısı" 15/600; meta "60 dk · Mehmet Yılmaz · Ofis" 12 `#9B978E`; trailing `groups` 18 `#6B6860`.
    - Card B `#FDF6EC` (life surface), border `1px solid rgba(27,25,23,.06)`, **margin-left 24**: "14:30", "Doktor randevusu", "30 dk · Nişantaşı · Randevu maili", `medical_services`.
    - Overlap marker: absolute 16×2 bar `#E0553F` at left, vertical middle.
  - Explanation: 14/21 `#6B6860`.
  - **Scrim** `rgba(27,25,23,.35)`.
  - **Bottom sheet:** `#fff`, radius 28 28 0 0, padding 10 20 44, shadow `0 -10px 40px rgba(27,25,23,.12)`.
    - Grabber 36×5, radius 3, `#E0DED7`, margin-bottom 14.
    - Title 19/600 −.01em. Subtitle 13 `#6B6860`.
    - Option rows: min-height 60, border-top hairline, gap 12; icon 20 in a 24px slot; title 15/500; meta 12; trailing `chevron_right` 18 `#C9C5BC`. The first row's icon is `auto_awesome` `#5B5CE2` and its meta is `#4547C9` 600. The other icons are `#6B6860`, meta `#9B978E`. The last row has no chevron.
- **Exact copy:**
  - "ÇARŞAMBA · 10 EYLÜL", "TAKVİM ÇAKIŞMASI", "Bu iki etkinlik çakışıyor.", "14:00", "Müşteri toplantısı", "60 dk · Mehmet Yılmaz · Ofis", "14:30", "Doktor randevusu", "30 dk · Nişantaşı · Randevu maili".
  - "Toplantı 15:00'te biter; doktora 38 dakika yol var. Doktor randevusunu kaydırmak en az kişiyi etkiler."
  - Sheet: "Nasıl çözelim?" / "Seçtiğin çözüm onayına sunulur, otomatik uygulanmaz."
  - Options:
    1. "Doktoru 15:45'e al" — "Önerilen · Klinikte 15:45 boş görünüyor"
    2. "Toplantıyı 13:00'a öner" — "Mehmet'e öneri maili taslağı hazırlanır"
    3. "Toplantıyı 30 dk kısalt" — "14:00–14:30 · Doktora zamanında yetişirsin"
    4. "Böyle kalsın" — "Bu çakışmayı bir daha gösterme"
  - Caption: "Çakışma görselleştirmesi: ikinci kart sağa kaydırılır ve kısa coral çizgi üst üste binmeyi işaret eder. Çözümler sıralıdır; ilki AI önerisi ve gerekçesi."
- **Data fields → entities:**
  - Conflict (`insights` type `conflict`): `event_a_id`, `event_b_id`, overlap window, travel-gap reasoning, date.
  - `resolution_options[]`: `{kind: move_b | propose_time_email | shorten_a | ignore, recommended: bool, rationale, proposed_times}`.
  - Event B is sourced from an email ("Randevu maili"). It may be a `life_events` appointment rather than a provider calendar event.
- **Interactions → production behavior:**
  - Back: return to the origin (Plan Hafta, Today card, or notification).
  - Sheet drag down or scrim tap: collapse the sheet (the conflict screen stays).
  - Every option first opens an **approval preview** (Ne / Neden / Değişim / Hesap). Nothing is applied on tap.
  - **Option 1 "Doktoru 15:45'e al":**
    - The app **cannot change a third-party clinic booking**.
    - Production option: "Randevuyu değiştirmek için klinikle iletişime geç" as an external handoff (`tel:` if the phone number is in the source email; reply-draft email_send approval if the booking email allows replies).
    - After the user confirms externally, a `calendar_update` of the user's own entry, through approval.
    - The "Klinikte 15:45 boş görünüyor" claim is forbidden unless a source (booking-system email or link) states it (§83).
  - **Option 2 "Toplantıyı 13:00'a öner":**
    - AI draft email to Mehmet proposing 13:00, as an `email_send` approval routed to the AI Reply editor (04 4.5).
    - If the user is the organizer, optionally add a paired `calendar_update` approval after acceptance.
    - Only claim attendee availability if free/busy is accessible: Google `freebusy.query` (https://developers.google.com/calendar/api/v3/reference/freebusy/query) or Graph `getSchedule` (https://learn.microsoft.com/en-us/graph/api/calendar-getschedule).
  - **Option 3 "Toplantıyı 30 dk kısalt":** `calendar_update` approval (end 15:00 → 14:30, with attendee notification). Organizer check required.
  - **Option 4 "Böyle kalsın":** dismiss with a suppression key. Reappears only if either event's time changes. Writes `ai_feedback`.
- **States depicted:** sheet-open state only.
- **States missing:** screen without the sheet (if dismissed); dark variant; option loading (draft generation); approval pending / executed banner on the conflict ("Çözüm onay bekliyor" / "Çözüldü · 13:00'e taşındı"); provider write failed; conflict auto-resolved by an external change ("Bu çakışma artık yok"); permission needed for calendar write (progressive auth); stale data.
- **Prototype-only / fake:**
  - Clinic availability claim.
  - "Doktora zamanında yetişirsin" is logically false: the meeting ends at 14:30, the appointment is at 14:30, and travel is 38 dk.
  - "38 dakika yol" requires a routing source.
  - Interactive prototype only toasts.
- **Maps to:** §20, §19, §33, §83, §115, §131.

### Toplantıya Hazırlan (Light) / Meeting Prep — signature screen
- **Source:** PRIMARY / 05 / **5.4 "Toplantıya Hazırlan · Light · İmza ekran"**.
- **Purpose:** Pre-meeting brief: the person, 3 talking points, and sourced evidence sections. Also used in store screenshots.
- **Layout, top to bottom:**
  - Status bar "14:12". Container padding `6px 20px 130px`, gap 16.
  - **Header:** 36px back button; kicker "TOPLANTIYA HAZIRLAN"; **countdown chip** (height 30, padding 0 10, radius 999, `#FDF2DC` / `#9A6300`, 12/600, `schedule` 15, gap 4) "18 dk".
  - **Person row** (tappable, padding 4 0, gap 14):
    - Avatar 56 circle `#DCE4F5` / `#2B3F73`, "MY" 20/600.
    - Name 24/30 600 −.02em. Meta 14 `#6B6860` (2px below).
    - Trailing `chevron_right` 22 `#B8B4AA`.
  - **TalkingPointsCard:** bg `#1A1917`, text `#fff`, radius 24, padding 20, shadow `0 12px 32px rgba(27,25,23,.18)`.
    - Kicker `#A9AAF5` 12/600 .06em + `auto_awesome` FILL.
    - 3 items (14px below, gap 14). Each has a number circle 26, `rgba(255,255,255,.12)`, 13/600; title 17/600 −.01em; body 14/20 `rgba(255,255,255,.7)`.
  - **Evidence sections** (`PREP`): kicker 12/600 .08em `#9B978E`, padding 0 4 8. **GroupedListCard** `#fff`, radius 18, padding 4 16, shadow.
    - Rows: gap 12, padding 11 0, border-top `1px solid rgba(27,25,23,.06)` except the first.
    - Icon tile 30, radius 10, `#F0EFEB` / `#6B6860`, icon 17. Text 15/21 −.01em pretty. Meta 12 `#9B978E` (2px below).
  - **Sticky footer:** padding 16 20 44, bg `linear-gradient(180deg, rgba(245,244,240,0) 0%, #F5F4F0 45%)`, gap 10.
    - Primary "2 Dakikalık Özeti Oku": flex 1, height 52, radius 16, `#5B5CE2`, 15/600, shadow `0 8px 24px rgba(91,92,226,.28)`.
    - Secondary "Not Al": height 52, padding 0 18, radius 16, `#fff`, shadow `0 1px 2px rgba(27,25,23,.08)`.
- **Exact copy:**
  - "TOPLANTIYA HAZIRLAN", "18 dk", "MY", "Mehmet Yılmaz", "Müşteri toplantısı · 14:30 · 60 dk · Ofis".
  - "KONUŞMAN GEREKEN 3 ŞEY":
    1. "Fiyat" — "Revize teklif 17:00'ye kadar bekleniyor; %8 indirim sınırını netleştir."
    2. "Teslim tarihi" — "Ekim başı için onay istiyor; üretim takvimi 6 Ekim'i gösteriyor."
    3. "Sözleşme" — "Taslak 2 haftadır açık; hukuk yorumu bekliyor."
  - Sections:
    - "TOPLANTININ AMACI": [target] "Eylül teklifinin son hâlini netleştirmek ve Ekim teslimatı için onay almak." · "Takvim davetinden çıkarıldı"
    - "SON GÖRÜŞMENİZ": [history] "1 Eylül · Fiyat aralığı ve teslim süresi konuşuldu. Mehmet revize teklif istedi; sen Cuma göndereceğini söyledin." · "4 gün önce · Görüşme notları"
    - "SON MAİLLER": [mail] "Re: Teklif — “Fiyatı Ekim teslimatına göre güncelleyebilir misiniz?”" · "Mehmet · Dün 18:20"; [mail] "Teklif v2 gönderildi (PDF)" · "Sen · 2 Eyl 10:05"
    - "AÇIK KONULAR": [radio_button_unchecked] "Sözleşme taslağı hukuk yorumu bekliyor" · "14 gün"; [radio_button_unchecked] "Nakliye maliyeti kimde?" · "1 Eylül görüşmesi"
    - "SENDEN BEKLENENLER": [person] "Revize teklif · PDF" · "Bugün 17:00"
    - "SENİN BEKLEDİKLERİN": [schedule_send] "Teklif v2 için geri bildirim" · "3 gündür bekliyor"
  - CTAs "2 Dakikalık Özeti Oku", "Not Al".
  - Caption: "Toplantıdan 20 dk önce bildirim, ekranın ilk katlaması “3 şey” kartıyla biter. Geri kalan bölümler kaynaklı kanıt. Bu ekran mağaza görselinde de kullanılır."
- **Data fields → entities:** a `meeting_preps` artifact, or `briefings` with kind=`meeting_prep`, or `insights`. Fields:
  - `event_id`, `person_id` (resolved attendee), start, duration, location, countdown (computed).
  - `purpose` + source ("Takvim davetinden çıkarıldı" = event description).
  - `last_interaction` {date, summary, source: user note / capture}.
  - `recent_emails[]` → `email_messages` ids.
  - `open_loops[]` {text, age_days, source}.
  - `user_owes[]` → `commitments` where direction = user → them, with due.
  - `they_owe[]` → follow-ups / waiting-on with days waiting.
  - `talking_points[3]` {title, body, `source_refs[]`}.
  - `summary_2min_id`, `generated_at`, `model/prompt_version`, `confidence`.
- **Interactions → production behavior:**
  - Back: pop.
  - Countdown chip: live-updating (minute ticks). After start it reads "Başladı"; after end, route to Post Meeting.
  - Person row: **Person Intelligence** (6.7), per §21.
  - SON MAİLLER row: **Email Detail** (04 4.4), per §21. Needs a pressable affordance (chevron/press state is not depicted).
  - SON GÖRÜŞMENİZ row: open the source note or capture.
  - AÇIK KONULAR row: the source (thread or note), with actions "Taahhüde çevir" or "Çözüldü".
  - SENDEN BEKLENENLER row: AI Reply draft or task. Must not auto-send.
  - SENİN BEKLEDİKLERİN row: Smart Follow-Up (04 4.6), where "Takip mesajı hazırla" becomes an email_send approval.
  - Talking point tap or long-press: "Bu nereden çıktı?" source sheet (§97, §131). Not depicted; required.
  - **"2 Dakikalık Özeti Oku"**: 5.6.
  - **"Not Al"**: note composer bottom sheet (text + voice) bound to `event_id`, stored as a `captures`/notes row that becomes memory. This is not Post Meeting; Post Meeting triggers after the event ends.
  - **Missing CTA — meeting link (§21 "Meeting link gerçek external handoff"):**
    - When `conferenceData` / `hangoutLink` (Google) or `onlineMeeting.joinUrl` (Graph) exists, show a "Toplantıya Katıl" button that opens it with `Linking.openURL`.
    - For a physical location ("Ofis"), offer a maps handoff.
  - Missing "İlgili dosyalar" section when attachments exist (§21, secondary doc): "Teklif v2.pdf" appears only as a 5.6 source chip.
  - Entry points: T−20 min notification (`meetings` category; secondary doc copy "14:30 toplantına 20 dakika kaldı. 3 hazırlık notun var."), Today meeting card "Hazırlan", Plan event tap, widget "sıradaki".
- **States depicted:** light, fully generated.
- **States missing:**
  - Prep generating (skeleton for the 3-şey card plus shimmer; 08 "AI işliyor").
  - Partial (no emails found → hide section or "Bu kişiyle mail geçmişi bulunamadı").
  - Unknown attendee / external attendee without history ("İlk görüşmeniz").
  - Multiple attendees (group meeting: person selector or attendee list).
  - No purpose in invite ("Davet açıklaması yok").
  - AI unavailable (08 copy "Asistan şu an yanıt veremiyor.").
  - Offline cached prep with generated-at time.
  - Low confidence "Kaynakta kesinleşmiyor" (§80).
  - Meeting cancelled or moved banner.
  - Pro gate (Meeting Prep is Pro, §44; 07 7.6 pattern "…Pro'da." + "7 gün ücretsiz dene" / "Şimdi değil").
  - Meeting started / ended variants.
- **Prototype-only / fake:**
  - Static "18 dk".
  - Interactive prototype "2 Dakikalık Özeti Oku" gives toast "Özet okunuyor · 2 dk" (no screen).
  - Interactive prototype "Not Al" pushes Post Meeting (semantic mismatch).
- **Maps to:** §21, §30, §15, §17, §18, §96, §97, §131, §132, §44.

### Toplantıya Hazırlan (Dark) / Meeting Prep (Dark)
- **Source:** PRIMARY / 05 / **5.5 "Toplantıya Hazırlan · Dark"**.
- **Purpose:** Dark spec for 5.4.
- **Tokens:**
  - Background `#141311`. Back button `#1F1E1B` + ring `rgba(255,255,255,.08)`. Kicker `#7A776F`.
  - Countdown chip `rgba(217,139,11,.18)` / `#F0B85A`.
  - Avatar inverted `#2B3F73` / `#DCE4F5`. Meta `#A39F96`. Chevron `#5E5B54`.
  - **3-şey card becomes an indigo gradient:** `linear-gradient(160deg,#2C2C7A 0%,#4A4BC8 100%)`, shadow `0 12px 32px rgba(91,92,226,.25)`, kicker `#D6D6FB`, number circle `rgba(255,255,255,.16)`, body `rgba(255,255,255,.75)`.
  - Section kicker `#7A776F`. Card `#1F1E1B` + ring `rgba(255,255,255,.06)`. Tile `rgba(255,255,255,.08)` / `#A39F96`. Meta `#7A776F`. Hairline `rgba(255,255,255,.06)`.
  - Footer gradient `rgba(20,19,17,0)` → `#141311` at 45%. Primary `#8586F2` / `#0F0F2A` with no shadow. Secondary `#1F1E1B` / `#F2F0EB` + ring `rgba(255,255,255,.08)`.
- **Exact copy:** same as 5.4. Caption: "Dark'ta koyu kart siyah üstünde kaybolacağı için “3 şey” kartı indigo gradyana döner; birincil buton açık indigo, üzerinde koyu metin (kontrast 9:1)."
- **Interactions, fields, missing states:** same as 5.4.
- **Issue:** the claimed "kontrast 9:1" is wrong. `#0F0F2A` on `#8586F2` computes to **5.96:1**. It passes AA but the caption should be corrected.
- **Maps to:** §21, §38, §92.

### 2 Dakikalık Özet · Okuma görünümü / 2-Minute Summary reader
- **Source:** PRIMARY / 05 / **5.6 "2 Dakikalık Özet · Okuma görünümü"**.
- **Purpose:** Editorial narrative recap ("where you left off") before the meeting, with sources and optional audio.
- **Layout, top to bottom:**
  - Background `#FBFAF7` (editorial/paper). Status "14:13". Padding 6 24 40, gap 22.
  - Header: 36px `close` button; kicker "2 DAKİKALIK ÖZET"; 36px `headphones` button (both `#fff` + shadow).
  - Byline: Lora italic 15 `#6B6860`. Title: Lora 30/36 weight 500, −.02em, pretty.
  - 3 paragraphs: Lora 17/28, `<b>` weight 600 for dates.
  - Bottom block (margin-top auto): kicker "KAYNAKLAR", then chips (height 30, padding 0 10, radius 999, `#fff`, 12/500, shadow `0 1px 2px rgba(27,25,23,.06)`, icon 15 `#6B6860`, gap 5; wrap with gap 6).
- **Exact copy:**
  - "2 DAKİKALIK ÖZET", "Mehmet Yılmaz · 14:30", "Nerede kalmıştınız?"
  - P1: "Mehmet ile en son **1 Eylül'de** konuştunuz. Fiyat aralığını ve teslim süresini ele aldınız; Mehmet Ekim başı teslimat için revize teklif istedi, sen Cuma göndereceğini söyledin. Teklif v2'yi **2 Eylül'de** gönderdin; henüz yanıt gelmedi."
  - P2: "Dün akşam gelen mailde fiyatın Ekim teslimatına göre güncellenmesini istedi. Bu, %8 indirim sınırını ve üretim takviminin gösterdiği **6 Ekim** tarihini konuşmanı gerektiriyor."
  - P3: "Sözleşme taslağı iki haftadır hukuk yorumu bekliyor; Mehmet'in bunu sorması muhtemel. Nakliye maliyetinin kimde olacağı ilk görüşmede açık kalmıştı."
  - "KAYNAKLAR": [mail] "3 mail", [call] "1 görüşme notu", [description] "Teklif v2.pdf".
  - Caption: "Okuma görünümü brifingle aynı editoryal sesi kullanır: Lora, kalın tarih vurguları, altta kaynak çipleri. Kulaklık ikonu aynı metni sesli okur."
- **Data fields → entities:**
  - `meeting_prep.summary` {paragraphs[] with emphasized spans (dates), `sources_grouped` [{type: email, count 3, ids[]}, {type: note, count 1}, {type: attachment, name "Teklif v2.pdf", id}], `reading_time_sec` (computed ≈ words ÷ 200 wpm), `generated_at`}.
- **Interactions → production behavior:**
  - Close: back to Prep.
  - **Headphones:** TTS of the same text, reusing the Sesli Brifing player from 03 3.4 (play/pause, speed, progress). Engine options:
    - `expo-speech` `Speech.speak(text,{language:'tr-TR'})` (npm `expo-speech@57.0.3`).
    - Server TTS behind the §81 adapter. External credential.
  - Source chip "3 mail": sheet listing the 3 emails, each opening Email Detail.
  - "1 görüşme notu": note detail.
  - "Teklif v2.pdf": attachment viewer, fetched on demand from the provider or a signed Storage URL.
  - Tapping an emphasized date or claim: optional source highlight (§131).
- **States depicted:** generated, light.
- **States missing:** generating / skeleton; dark (paper → `#141311`/`#1F1E1B`, not specified); audio playing, paused and buffering; TTS voice unavailable for tr-TR; low-confidence wording; stale ("14:02'de hazırlandı · Yenile"); error or AI unavailable; offline (cached text OK, audio may fail).
- **Prototype-only / fake:** static counts; the interactive prototype has no reader, only a toast. The "2 Dakikalık" label must be true: cap the summary length or compute the minutes.
- **Maps to:** §21, §9 (voice briefing reuse), §25, §97, §131, §38.

### Toplantı Sonrası Yakalama · Ses girişi / Post Meeting capture (voice)
- **Source:** PRIMARY / 05 / **5.7 "Toplantı Sonrası Yakalama · Ses girişi"**.
- **Purpose:** After the meeting ends, capture follow-ups by voice (or text) and convert them into commitment proposals. Saved only on "Kaydet".
- **Layout, top to bottom:**
  - Status "15:31". Padding 6 20 44, gap 18.
  - Header: `close` 36 button; kicker "TOPLANTI SONRASI"; spacer.
  - Meta 13 `#6B6860`; H 28/34 600 −.02em; sub 16/23 `#6B6860`.
  - **TranscriptCard:** `#fff`, radius 20, padding 16, shadow. Italic 16/24 transcript. Row (12px below, gap 8) with the mini waveform (26 bars, 3px wide, radius 2; first 18 `#5B5CE2`, rest `#D9D6F7`; heights `6+((i*7)%5)*3` px; container height 20) and caption 12 `#9B978E`.
  - **AI card** (radial glow, as in 5.1), kicker "2 YENİ TAAHHÜT".
    - Items (10px below, gap 10): `#fff`, radius 14, padding 10 12, shadow `0 1px 2px rgba(27,25,23,.06)`.
    - Each item: `handshake` 20 `#5B5CE2`; title 15/600; meta 12 `#9B978E`; trailing `check_circle` FILL 20 `#2FA062`.
  - Footer (margin-top auto, gap 10): "Kaydet" (flex 1, height 52, radius 16, `#5B5CE2`) and a 52×52 `#fff` square with `keyboard` 22.
- **Exact copy:**
  - "TOPLANTI SONRASI", "Mehmet Yılmaz · 14:30–15:30", "Toplantın bitti.", "Takip etmen gereken bir şey var mı?"
  - Transcript: "“Mehmet'e yarın teklif göndereceğim. Sözleşme için hukuktan Perşembe'ye kadar yorum isteyeceğim.”"; caption "0:07 · dinleniyor".
  - "2 YENİ TAAHHÜT": "Mehmet'e teklif gönder" · "Yarın · Mehmet Yılmaz"; "Hukuktan sözleşme yorumu iste" · "Perşembe · Hukuk ekibi".
  - "Kaydet".
  - Caption: "Toplantı bitiminde 1 dakika sonra sessiz bildirim. Konuşma anında taahhüde dönüşür; yeşil onay “tespit edildi” demek, yazma işlemi yalnızca Kaydet ile."
  - Interactive prototype variant copy: kicker "TOPLANTI SONRASI · MEHMET YILMAZ"; "Sesle eklendi · 15:31" (mic icon); "YENİ TAAHHÜT" with chips [event] "Yarın" and [person] "Mehmet Yılmaz" (height 30, radius 999, `#F0EFEB` / `#6B6860`, 12/600); buttons "Kaydet" / "Vazgeç".
- **Data fields → entities:**
  - `calendar_events` (ended event id, 14:30–15:30).
  - Post-meeting note (`captures` source_type `post_meeting_note`, transcript text; the audio should not be persisted by default).
  - Proposed `commitments[]` {text, counterparty (`contacts` id or free-text "Hukuk ekibi"), due_date resolved in Europe/Istanbul ("Yarın" → D+1; "Perşembe" → next Thursday), direction, source_type = post_meeting_note, source_id, event_id, confidence, status `proposed`}.
- **Interactions → production behavior:**
  - Entry: local notification at event end +1 min, sent silently and subject to the §132 decision engine. It deep-links here.
  - Recording:
    - Mic permission prompt on first use. iOS also needs `NSSpeechRecognitionUsageDescription` if a platform recognizer is used.
    - Recording should start on an explicit tap, not auto-start (privacy; the artboard implies an already-listening state).
    - STT options: on-device or platform `expo-speech-recognition@57.1.0` (lang `tr-TR`, `interimResults`, volume events for the 1.2 s silence end-point), or server STT via the adapter (external credential).
  - Waveform: live mic level.
  - Detected item: tap opens an edit sheet (text, kişi picker from `contacts`, date picker with Smart Reminder presets from §29). Tapping the check toggles include/exclude.
  - Low-confidence items are rendered unchecked, with "Emin değilim · onayla" (§18 "belirsiz çıkarımda confirmation iste").
  - **Kaydet:**
    - Creates the selected commitments (`commitment_create`). The explicit user action counts as the approval (§22 proposal → approval → save); record it in `approval_actions` as approved-by-user.
    - Idempotency key = note id + item index.
    - Optional reminders.
    - Success motion (08 "Başarı"), then close.
  - Keyboard button: switch to text input. The same extraction runs on submit or debounced.
  - Close X: discard. Confirm if unsaved ("Kaydedilmemiş notlar silinsin mi?").
  - "Vazgeç" (interactive prototype): same as close.
- **States depicted:** listening and detected simultaneously.
- **States missing:** idle (before recording; "Konuşmak için dokun"); mic permission denied (with "Metinle yaz" fallback); STT unavailable or offline (on-device vs server); processing / extracting; no commitments detected ("Takip edilecek bir şey bulamadım · Not olarak kaydet"); text mode UI; saving; saved; error; ambiguous date; commitment to an unknown person; notification opened after a long delay (event no longer "just ended"); Pro gate (Commitments is Pro, §44); dark.
- **Prototype-only / fake:**
  - Static waveform and detections.
  - Interactive prototype `saveCommit` gives toast "Taahhüt kaydedildi · Yarın hatırlatırım" with no persistence.
  - Secondary PostMeeting shows the same hard-coded "Mehmet'e teklif gönder" card for any typed text (fake extraction), then "Taahhüt Kaydedildi / Yarın hatırlatılacak" fake success.
- **Maps to:** §22, §18, §25, §29, §33, §96, §132, §44, §83.

### Asistan · Giriş (Light) / Assistant home (never-empty chat)
- **Source:** PRIMARY / 06 / **6.1 "Asistan · Giriş (boş sohbet yok)"**.
- **Purpose:** Asistan tab root. Shows today's analysis summary, 5 context-aware suggested questions, recent threads, and a composer with the mic as the primary control.
- **Layout, top to bottom:**
  - Padding 14 20 0, gap 14.
  - Header: "Asistan" 28/34. Pill "Hafıza": height 36, padding 0 12 0 8, radius 999, `#fff`, 12/600 `#6B6860`, `search` 18, shadow `0 1px 2px rgba(27,25,23,.06)`.
  - **Summary banner:** `#fff`, radius 16, padding 12 14, card shadow, gap 10. 34px circle `#EDEDFC` with `auto_awesome` FILL 18 `#5B5CE2`. Text 14/20 with `<b>`.
  - Kicker "ÖNERİLEN" (padding 6 4 0).
  - 5 **SuggestedPromptRows:** height 52, padding 0 16, radius 16, `#fff`, 15/500, shadow `0 1px 2px rgba(27,25,23,.04)`, trailing `arrow_outward` 18 `#B8B4AA`, gap 8. Pressed state from the prototype: `#EDEDFC`.
  - Kicker "SON SOHBETLER". Rows 14px `#6B6860`, padding 8 4, trailing date 12 `#9B978E`.
  - **Composer:** container padding 8 16 8. Pill height 52, radius 999, `#fff`, padding 0 6 0 16, shadow `0 1px 2px rgba(27,25,23,.06), 0 8px 24px rgba(27,25,23,.08)`. Placeholder 15 `#9B978E`. Mic button 40 circle `#5B5CE2`, `mic` 20 `#fff`.
  - Tab bar (Asistan active).
- **Exact copy:**
  - "Asistan", "Hafıza".
  - "Bugün **46 mail**, **4 etkinlik** ve **2 takip** analiz edildi. Ne öğrenmek istersin?"
  - "ÖNERİLEN": "Bugün neye odaklanmalıyım?", "Kimlere cevap vermem gerekiyor?", "Yarın yoğun muyum?", "Bu hafta hangi deadline'lar var?", "Mehmet ile en son ne konuştuk?"
  - "SON SOHBETLER": "Geçen ayki uçak bileti ne kadardı?" · "Dün"; "Bu ay hangi ödemelerim var?" · "2 Eyl".
  - "Dijital hayatına sor…"
  - Caption: "Önerilen sorular günün verisine göre değişir (toplantı varsa “X ile en son ne konuştuk?” çıkar). Giriş çubuğu hap biçiminde; mikrofon birincil."
- **Data fields → entities:**
  - Daily analysis stats (`briefings` / sync run metrics: emails_analyzed 46, events 4, follow_ups 2).
  - `suggested_prompts[]` generated deterministically from today's data (meeting attendee name → "X ile en son ne konuştuk?").
  - `assistant_threads` {title (first question), updated_at}.
- **Interactions → production behavior:**
  - "Hafıza" pill: push **AI Memory search** (6.5).
  - Suggested prompt tap: create a new `assistant_threads` row, send the prompt as the first `assistant_messages`, and push the conversation (6.2) with the tab bar hidden. Stream the answer.
  - Recent chat row: open that thread. Swipe to delete the thread (retention, §41).
  - Composer text: typing must swap the mic for a **send** button (not depicted); Enter/submit sends.
  - Mic: **Voice mode** (6.3). Long-press the mic on Today opens the same mode (6.3 caption).
- **States depicted:** light, data-rich.
- **States missing:** first-run / no data yet ("İlk analiz sürüyor…"); no accounts connected; banner loading (skeleton for counts); AI unavailable (08 "Asistan şu an yanıt veremiyor." / "Brifingin ve önceliklerin hazır; yalnızca yeni soru ve taslaklar birkaç dakika bekleyebilir." / "Tekrar Dene" / "Brifinge Dön"); offline (composer disabled, "Çevrimdışı · sorular bağlantı gelince yanıtlanır" or blocked); free-plan AI quota reached (§44 "limited AI", §82); no recent chats (hide section).
- **Prototype-only / fake:** static counts and history. Interactive prototype `toastMemory` gives "Hafıza araması · Bkz. 06 Asistan" (stub).
- **Maps to:** §24, §25, §26, §8, §44, §82, §93.

### Asistan · Giriş · Dark / Assistant home (Dark)
- **Source:** PRIMARY / 06 / **6.1D**.
- **Tokens:**
  - Background `#141311`, status "21:14".
  - "Hafıza" pill `#1F1E1B` / `#A39F96` + ring `rgba(255,255,255,.08)`.
  - Banner `#1F1E1B` + ring `.06`; icon circle `rgba(133,134,242,.16)` / `#A9AAF5`.
  - Kicker `#7A776F`. Prompt rows `#1F1E1B` + ring `.06`, arrow `#5E5B54`. Recent rows `#A39F96`, dates `#7A776F`.
  - Composer `#1F1E1B` + ring `.08` + `0 8px 24px rgba(0,0,0,.35)`, placeholder `#7A776F`, mic `#8586F2` / `#0F0F2A`.
  - Tab bar dark (active `#A9AAF5`).
- **Exact copy:** same as 6.1. Caption: "Bugün/Akış dark ile aynı tokenlar: yüzey #1F1E1B, hairline %6–8 beyaz, ikincil #A39F96, üçüncül #7A776F. Mikrofon dark primary (#8586F2) üzerinde #0F0F2A."
- **Issue:** the `arrow_outward` in `#5E5B54` on `#1F1E1B` is 2.46:1. It is decorative, but it needs non-color affordance.
- **Maps to:** §24, §38, §92.

### Asistan · Zengin kartlı yanıt / Assistant conversation with rich cards
- **Source:** PRIMARY / 06 / **6.2 "Asistan · Zengin kartlı yanıt"**.
- **Purpose:** Conversation thread. Anatomy: short sentence, then a sourced card, then continuation chips. Drafts end in an approval button, and email is never sent from chat directly.
- **Layout, top to bottom:**
  - Padding 14 20 0, gap 12.
  - Header: "Asistan" + pill "Yeni sohbet" (height 36, padding 0 12, `#fff`, 12/600 `#6B6860`).
  - **User bubble:** right-aligned, max-width 86%, padding 10 14, radius 18, `#5B5CE2` / `#fff`, 15/21.
  - **Assistant bubble:** left-aligned, `#fff`, card shadow.
  - **RichAnswerCard "SENDEN BEKLEYENLER":** `#fff`, radius 16, padding 12 14. Kicker 12/600 .06em `#9B978E`. Rows padding 10 0, border-top hairline, gap 10:
    - Avatar 32, 11/600: AY `#F5E1D6` / `#7A3E1F`; SK `#E3EFE6` / `#1E5A36`.
    - Name 14/600; meta 12 `#9B978E`.
    - Deadline badge 11/700, padding 3 8, radius 999: "17:00" `#FCEDE9` / `#C7432F`; "Yarın" `#FDF2DC` / `#9A6300`.
    - Inline link "Yanıtla" 13/600 `#4547C9`.
  - **Follow-up chips:** height 30, padding 0 10, radius 999, `#fff`, 12/600 `#6B6860`, shadow `0 1px 2px rgba(27,25,23,.06)`, gap 6, wrap.
  - Second user bubble; assistant bubble.
  - **DraftCard:** `#fff`, radius 16, padding 12 14. Kicker `auto_awesome` + "TASLAK · AHMET YILMAZ" `#5B5CE2`. Preview 14/20 `#6B6860` with a 2-line clamp. Buttons (10px below, gap 8, 13/600, height 36, padding 0 12, radius 12): "Göndermeyi Onayla" `#5B5CE2` / `#fff`; "Düzenle" `#EDEDFC` / `#4547C9`.
  - Composer (padding 8 16 44). **No tab bar.**
- **Exact copy:**
  - "Asistan", "Yeni sohbet".
  - User: "Kimlere cevap vermem gerekiyor?"
  - AI: "2 kişi senden cevap bekliyor. Ahmet'inki bugün 17:00'ye kadar; Selin'inki yarın öğlene kadar bekleyebilir."
  - "SENDEN BEKLEYENLER": "Ahmet Yılmaz" · "Revize teklif · Gmail 08:42" · [17:00] · "Yanıtla"; "Selin Kaya" · "Sözleşme 4. madde · Gmail dün" · [Yarın] · "Yanıtla".
  - Chips: "İkisi için de taslak hazırla", "Selin'i yarına ertele".
  - User: "Ahmet'e yanıt taslağı hazırla". AI: "Hazırladım. Profesyonel tonda, 17:00 teslimi teyit ediyor."
  - "TASLAK · AHMET YILMAZ": "Merhaba Ahmet, talebiniz için teşekkürler. Revize fiyat teklifini güncellenmiş teslim tarihiyle birlikte bugün 17:00'den önce…"; "Göndermeyi Onayla", "Düzenle".
  - "Dijital hayatına sor…".
  - Caption: "Yanıt anatomisi: kısa cümle → kaynaklı kart → devam çipleri. Sohbet içinden mail gönderilmez; taslak kartı onay butonuyla biter. Sohbette alt sekme çubuğu gizlenir."
  - Interactive prototype QA card titles and rows (other answer card variants):
    - "BUGÜNÜN 2 ÖNCELİĞİ" (Revize teklif · Ahmet 17:00; Mehmet ile toplantı 14:30).
    - "YARIN · 4 ETKİNLİK" (Haftalık ekip 09:00; Ürün gözden geçirme 10:00; Doktor randevusu 13:30; Yatırımcı görüşmesi 17:00).
    - "SON TARİHLER" (Girişim programı başvurusu Bugün 17:00; Netflix yenileme 9 Eyl; Elektrik faturası · 1.842 TL 10 Eyl).
    - "KAYNAKLAR" (Re: Teklif · Gmail 1 Eyl 18:20; Görüşme notları 1 Eyl 15:00).
- **Data fields → entities:**
  - `assistant_threads` / `assistant_messages` {role, text, `cards[]` (type `waiting_on_you` | `draft` | `sources` | `events` | `deadlines`), `followup_suggestions[]`, `grounding_refs[]`, `model`, `prompt_version`}.
  - Waiting-on-you rows → `email_threads` + a derived "reply needed by" (deadline + source), person → `contacts`.
  - Draft → AI reply draft {thread_id, to, tone "Profesyonel", body} + a pending `approval_actions` row (email_send).
- **Interactions → production behavior:**
  - "Yeni sohbet": start a new thread (clear context).
  - Row tap: Email Detail. Avatar or name: Person Intelligence. "Yanıtla": AI Reply editor (04 4.5) for that thread.
  - Chip "İkisi için de taslak hazırla": sends a follow-up prompt; produces 2 draft cards, each its own pending approval.
  - Chip "Selin'i yarına ertele": snooze that waiting-on-you item until tomorrow 12:00. Internal state only, no external side effect; toast with "Geri al".
  - "Göndermeyi Onayla": approve the email_send approval (server-side send, idempotent). The card morphs through executing, then "Gönderildi" (success) or failed with retry. Mirrors Approval Center.
  - "Düzenle": open the AI Reply editor with the draft.
  - Composer: send text. Mic: voice mode.
  - Long-press a message: copy; feedback 👍/👎 goes to `ai_feedback` (§59). Not depicted; recommended.
  - Hardware back: to Asistan home.
- **States depicted:** conversation with results. Interactive prototype adds typing dots.
- **States missing:** streaming or typing (tokens arriving); "no data" answer ("Maillerinde ve takviminde bununla ilgili bir şey bulamadım." — the secondary fallback wording is reusable, without the fake part); low-confidence "Kaynakta kesinleşmiyor." (§80); error mid-stream with retry; rate-limited or free quota (§82, §44); offline; draft generation in progress; approval states after tap; prompt-injection-safe rendering of email quotes (§114); dark.
- **Prototype-only / fake:**
  - Canned Q&A. Interactive prototype `QA` dictionary.
  - Secondary `aiResponses` matches on the first word, adds a random 1.2–1.8 s delay, and has a canned fallback.
  - The secondary "Yarın yoğun muyum?" copy contains a self-contradiction ("(TK2412, 09:15 — aslında yarın sabah erken!)"). Never copy it.
- **Maps to:** §24, §16, §17, §33, §80, §83, §97, §114, §115.

### Ses Modu · Dinliyor / Voice mode — listening
- **Source:** PRIMARY / 06 / **6.3 "Ses Modu · Dinliyor"**.
- **Purpose:** Full-screen voice interaction with a live transcript.
- **Layout, top to bottom:**
  - Background `linear-gradient(180deg,#15153A 0%,#25266A 70%,#3B3CA8 100%)`. The 01 token gradient/night uses **60%** for the middle stop; normalize. Padding 0 20 44, text `#fff`.
  - Header: kicker "SES MODU" 12/600 .08em, opacity .7; close button 36 `rgba(255,255,255,.14)`.
  - Center column (gap 28): **mic orb** — 120 ring `rgba(255,255,255,.14)`, inset 14 ring `rgba(255,255,255,.18)`, core 80 `#fff`, `mic` 36 `#25266A`.
  - Waveform: 22 bars, 4px wide, radius 2, `rgba(255,255,255,.85)`, heights `10+((i*11)%6)*6`, container height 44.
  - Transcript 22/30 600 −.01em, max-width 300. Status 14 `rgba(255,255,255,.7)`.
  - Bottom chips: height 36, padding 0 14, radius 999, `rgba(255,255,255,.12)`, 13/500, centered wrap, gap 8.
- **Exact copy:** "SES MODU", "“Mehmet'ten cevap geldi mi?”", "Dinliyorum…"; chips "Bugün ne var?", "Brifingimi oku.", "Yarın yoğun muyum?". Caption: "Nefes alan halka + dalga formu. Bugün'den uzun basılı mikrofonla da açılır. Konuşma metni canlı yazılır; sessizlikte 1,2 sn sonra yanıt."
- **Data fields:** live transcript (interim/final), recognition state, mic level.
- **Interactions → production behavior:**
  - Open: from the Asistan mic, the Person page mic, or a long-press on the Today mic. Request mic (and speech) permission on first use.
  - Recognition:
    - Platform: `expo-speech-recognition@57.1.0` `start({lang:'tr-TR', interimResults:true, continuous:false})`. iOS server-based SFSpeechRecognizer has a ~1-minute audio limit; on-device avoids it where supported.
    - Server STT through the §81 adapter is the fallback.
    - End-pointing: 1.2 s silence via volume events or a timer.
  - "Breathing" ring: animate with mic level (Reanimated, `react-native-reanimated@4.7.0`).
  - Chip tap: run that query directly, as if spoken.
  - Close: stop recognition and TTS, release the audio session, return to origin.
  - Barge-in: tapping the orb stops TTS and starts listening.
- **States depicted:** listening with an interim transcript.
- **States missing:**
  - Idle ("Konuşmak için dokun" from secondary).
  - Permission prompt and denied ("Mikrofon izni gerekli" + "Ayarları Aç" / "Metinle sor").
  - Processing ("Anlıyorum…" from secondary).
  - Speaking (TTS) state.
  - Not understood ("Anlayamadım, tekrar söyler misin?").
  - Network or STT unavailable.
  - Audio route (Bluetooth) handling.
  - Call interruption.
  - Reduced motion (§92).
  - Free/Pro gating decision (§44 lists only "Voice Briefing" as Pro).
- **Prototype-only / fake:**
  - Static waveform.
  - Secondary: timers (2 s listening, then 1.5 s processing, then a fixed response); all example commands trigger the same canned flow; random bar animation.
- **Maps to:** §25, §24, §91, §92, §44.

### Ses Modu · Yanıt + yazma onayı / Voice mode — answer + write approval
- **Source:** PRIMARY / 06 / **6.4 "Ses Modu · Yanıt + yazma onayı"**.
- **Purpose:** Spoken answer. When the user asks for a write action, an approval card is always shown and can be confirmed by voice or tap.
- **Layout, top to bottom:**
  - Same gradient and header as 6.3.
  - Content column justified center, gap 16:
    - Echoed user utterance 14 `rgba(255,255,255,.6)`.
    - Answer 22/30 600 pretty.
    - Second user utterance.
    - **ApprovalCard (compact):** `#fff` / `#1A1917`, radius 20, padding 16, shadow `0 12px 32px rgba(0,0,0,.25)`. Kicker `auto_awesome` + "ONAY GEREKİYOR · MAİL GÖNDER" `#5B5CE2`. Title 16/600. Preview 14/20 `#6B6860`.
    - Buttons (12px below, gap 8, 13/600, height 42, radius 12): "Onayla" flex 1 `#5B5CE2` / `#fff`; "Düzenle" `#EDEDFC` / `#4547C9`; "İptal" `#F0EFEB` / `#6B6860`.
    - Hint (10px below) 12 `#9B978E` with `mic` 14.
  - Bottom mic button: 64 circle `#fff`, `mic` 30 `#25266A`.
- **Exact copy:**
  - "“Mehmet'ten cevap geldi mi?”"
  - "Henüz gelmedi. Teklifi 3 gün önce gönderdin. İstersen kısa bir takip mesajı hazırlayıp onayına sunabilirim."
  - "“Evet, hazırla.”"
  - "ONAY GEREKİYOR · MAİL GÖNDER", "Mehmet Yılmaz'a takip mesajı", "“Merhaba Mehmet, 2 Eylül'de ilettiğim teklif hakkında görüşünüzü alabilir miyim? …”"
  - "Onayla", "Düzenle", "İptal", "“Onayla” diyerek de gönderebilirsin."
  - Caption: "Sesle onay mümkündür ama kart her zaman görünür: kullanıcı ne gönderileceğini okur. “İptal” öğrenme sinyali üretmez; “Düzenle” metin moduna geçer."
- **Data fields → entities:**
  - Answer grounded in `email_threads` (last sent 2 Eyl, no reply).
  - Follow-up draft + `approval_actions` {type `email_send`, what, preview, to, **destination account (missing in UI)**, status}.
- **Interactions → production behavior:**
  - TTS reads the answer (`expo-speech` tr-TR, or server TTS).
  - "Onayla" (tap or voice): approve, then server-side send with idempotency. Store `approved_via='voice'` in the approval and `audit_logs`.
  - Voice confirm is accepted only while the card is on screen, with a strict intent grammar ("onayla", "gönder"). If ambiguous, ask again.
  - "Düzenle": leave voice mode and open the AI Reply editor with the draft.
  - "İptal": the approval becomes `rejected` with reason `user_cancel`, and **no** learning signal (unlike "Reddet" in 6.8).
  - Mic button: continue the conversation.
  - After execution: visual confirmation (secondary doc: "Her write action sonrasında visual confirmation"), success haptic.
- **States depicted:** answer + pending approval.
- **States missing:** executing ("Gönderiliyor…"); sent confirmation; send failed (OAuth scope missing, prompting progressive consent §76); voice-confirm misheard; card expired; TTS playing indicator; the destination account line (§33 "destination/account").
- **Prototype-only / fake:** static. The interactive prototype `VOICE` answers are canned strings.
- **Maps to:** §25, §33, §115, §76, §92.

### AI Hafıza · Anlamsal arama / AI Memory semantic search
- **Source:** PRIMARY / 06 / **6.5 "AI Hafıza · Anlamsal arama"**.
- **Purpose:** Natural-language search across user data. Grounded answer first, then source cards, then related questions.
- **Layout, top to bottom:**
  - Padding 6 20 40, gap 14.
  - Row: back 36 + **SearchField** pill (flex 1, height 44, radius 999, `#fff`, shadow `0 1px 2px rgba(27,25,23,.06)`, `search` 18 `#9B978E`, query 15px, `close` 18 `#9B978E`).
  - **FilterChips** (overflow hidden; should scroll horizontally): height 30, padding 0 10, radius 999, 12/600. Selected `#1A1917` / `#fff`; others `#fff` / `#6B6860`.
  - **Answer card** (radial glow): kicker "CEVAP"; body 16/23 with `<b>`; meta 12 `#9B978E` (10px below).
  - Kicker "KAYNAKLAR · 3".
  - 3 **SourceResultCards:** `#fff`, radius 18, padding 14 16. Header: icon tile 28, radius 9, `#F0EFEB`; src 12 `#9B978E` flex; date 12. Title 15/21 500 (8px below). Summary 14/20 `#6B6860` (4px below). Link (8px below) "Orijinali Aç" 13/600 `#4547C9` + `open_in_new` 16.
  - Kicker "BUNLARI DA SORABİLİRSİN". 3 rows: padding 10 14, radius 14, `#fff`, 14px, gap 6.
- **Exact copy:**
  - Query "Mehmet fiyat konusunda en son ne demişti?".
  - Chips "Tümü", "Mail", "Takvim", "Notlar", "Belgeler", "Son 30 gün".
  - "CEVAP": "Mehmet en son **dün 18:20**'de fiyatın **Ekim teslimatına göre güncellenmesini** istedi. 1 Eylül görüşmesinde ise %8'in üzerinde indirimin yönetim onayı gerektirdiğini söylemişti."; "3 kaynaktan · %92 eşleşme".
  - "KAYNAKLAR · 3":
    1. [mail] "Gmail · Mehmet Yılmaz" · "Dün 18:20" · "Re: Teklif" · "“Fiyatı Ekim teslimatına göre güncelleyebilir misiniz? Yönetim toplam tutarı görmek istiyor.”"
    2. [call] "Görüşme notu · Sen" · "1 Eyl 15:00" · "Telefon görüşmesi · 12 dk" · "%8 üzeri indirim için yönetim onayı gerektiğini söyledi. Teslim tarihi Ekim başı olarak konuşuldu."
    3. [description] "Ek · Teklif_v2.pdf" · "2 Eyl 10:05" · "Teklif v2 · Sayfa 3, Fiyatlandırma" · "Birim fiyat 1.240 TL, 500 adet üzeri %6 indirim. Teslim: siparişten 4 hafta sonra."
  - "Orijinali Aç".
  - "BUNLARI DA SORABİLİRSİN": "Geçen ay aldığım uçak bileti ne kadardı?", "Bu ay hangi ödemelerim var?", "Kimlere dönüş yapmam gerekiyor?"
  - Caption: "Cevap kartı önce, kaynaklar altında: kaynak · tarih · AI özeti · orijinali aç. Eşleşme yüzdesi güveni gösterir; %70 altında “emin değilim” dili kullanılır."
- **Data fields → entities:**
  - `memory_chunks` {user_id, source_type (email | note | attachment_page | event | capture | commitment | life_event), source_id, source_provider, source_timestamp, page_no (3), chunk_text, embedding vector, retention_expires_at}.
  - Answer {text with emphasized spans, `citations[]`, `source_count`, `match_score`}.
- **Interactions → production behavior:**
  - Query submit: edge function.
    1. Embed the query (adapter).
    2. pgvector cosine/HNSW search under RLS, with filters (type, date ≥ now − 30d).
    3. PostgreSQL FTS fallback with the built-in `turkish` config (`websearch_to_tsquery('turkish', q)`); handle Turkish dotted/dotless I casing.
    4. Rerank, then grounded LLM answer.
    5. Zod-validated citations; every claim maps to a cited chunk (§80, §83).
    6. Below threshold: "Emin değilim / Kaynakta kesinleşmiyor" wording.
  - Clear (x): empty the query and show recents and suggestions (secondary adds "SON ARAMALAR" / "ÖRNEK ARAMALAR").
  - Filter chip: re-query with the filter. Single-select plus the date chip as a toggle.
  - **"Orijinali Aç":**
    - Email: in-app Email Detail, with a Gmail/Outlook web deep link as a secondary option.
    - Note: note detail.
    - PDF: attachment viewer at page 3 (needs page-level chunk metadata).
  - Suggested question tap: run it as a new query.
  - Back: Asistan.
- **States depicted:** results with a high-confidence answer.
- **States missing:** idle (no query); searching (skeleton answer + cards); no results ("Bununla ilgili bir şey bulamadım" + tips); low-confidence answer ("Emin değilim…" styling); partial (index still building after onboarding: "Geçmiş mailler hâlâ işleniyor · %60"); results older than retention (not shown, with a hint); offline (disabled); error; Pro gate (AI Memory is Pro, §44); dark.
- **Prototype-only / fake:** static results. "%92 eşleşme" is not a meaningful user metric unless calibrated (see issues). "Görüşme notu · Telefon görüşmesi · 12 dk" implies call capture; only user-created notes may exist (no telephony integration).
- **Maps to:** §26, §95, §97, §80, §83, §41, §131, §44.

### Önemli Kişiler · VIP / VIP People list
- **Source:** PRIMARY / 06 / **6.6 "Önemli Kişiler · VIP"**.
- **Purpose:** Manage VIP people by relationship group. VIPs raise priority and tighten wait-time tracking.
- **Layout, top to bottom:**
  - Padding 6 20 40, gap 14.
  - Header: back 36 + pill "Kişi Ekle" (height 36, padding 0 12 0 8, `#5B5CE2` / `#fff`, 12/600, `add` 18).
  - H1 28/34 + sub 14/20 `#6B6860`.
  - Groups: kicker (padding 4 4 8), then GroupedListCard. Rows padding 10 0, gap 12: avatar 38 (12/600); name 15/600 −.01em; meta 12 `#9B978E`; trailing `star` FILL 20 `#5B5CE2`.
  - **InlineSuggestionRow:** padding 8 4, 13/19 `#6B6860`, `psychology` 18 `#5B5CE2`, bold name, CTA "Evet" `#4547C9` 600.
- **Exact copy:**
  - "Kişi Ekle", "Önemli Kişiler", "Bu kişilerden gelenleri her zaman öne alırım ve bekleme sürelerini daha sıkı izlerim."
  - "EŞ · AİLE": ZE "Zeynep Emre" · "Eş · Mesaj ve takvim öncelikli" (`#F5E1D6` / `#7A3E1F`); AN "Annem" · "Aile · Aramaları hatırlat" (`#F0EFEB` / `#6B6860`).
  - "YÖNETİCİ": CT "Can Tekin" · "CEO · Aynı gün yanıt beklenir" (`#DCE4F5` / `#2B3F73`).
  - "MÜŞTERİ": MY "Mehmet Yılmaz" · "Yılmaz Endüstri · 2 açık konu" (`#DCE4F5` / `#2B3F73`); AY "Ahmet Yılmaz" · "Kuzey Lojistik · Revize teklif bekliyor" (`#F5E1D6` / `#7A3E1F`).
  - "ARKADAŞ": BT "Burak Tan" · "Planlar için hafta sonu hatırlat" (`#E3EFE6` / `#1E5A36`).
  - "Öneri: **Selin Kaya** ile son 30 günde 14 kez yazıştın. VIP yapayım mı? Evet".
  - Caption: "Gruplar: eş, aile, yönetici, müşteri, arkadaş. VIP yıldızı yalnızca bu listede ve kişi başlıklarında görünür; kartlarda ekstra renk üretmez, sıralamayı etkiler."
- **Data fields → entities:**
  - `vip_people` {contact_id, group enum (spouse | family | manager | client | friend), user_note/policy (e.g. reply SLA "Aynı gün yanıt beklenir"), created_by user | suggestion}.
  - `contacts` {name, initials, avatar palette (deterministic hash), org}.
  - Derived meta (open loops count, waiting state).
  - VIP suggestion {contact_id, interaction_count_30d: 14}.
- **Interactions → production behavior:**
  - "Kişi Ekle": contact picker sheet (search over `contacts` built from mail/calendar participants; optional device contacts via `expo-contacts` with permission), then group select, then save. The picker screen is not designed.
  - Row tap: Person Intelligence (6.7).
  - Star tap: un-VIP with confirm or undo toast (5 s).
  - Suggestion "Evet": insert the VIP (internal preference, no external side effect) + toast "Selin Kaya VIP'lere eklendi · Geri al". Needs a "Şimdi değil" dismiss (missing) → `ai_feedback`.
  - Long-press row: change group, remove.
  - VIP status must deterministically feed the priority engine (§30, §31).
- **States depicted:** populated.
- **States missing:** empty (secondary: "Henüz VIP kişi yok." / "Önemli kişileri ekleyerek onlardan gelen mesajlara öncelik ver." / "Kişi Ekle"); loading; Pro gate (VIP is Pro, §44); limit reached; dark.
- **Prototype-only / fake:** "Mesaj ve takvim öncelikli" and "Aramaları hatırlat" imply SMS/call-log access, which iOS does not allow (§91). Meta strings must be either user-set policies or computed facts.
- **Maps to:** §30, §31, §32, §91, §44.

### Kişi Zekâsı · Mehmet Yılmaz / Person Intelligence
- **Source:** PRIMARY / 06 / **6.7 "Kişi Zekâsı · Mehmet Yılmaz"**.
- **Purpose:** Relationship summary (not an email thread): last contact, upcoming meeting, open loops, two-way expectations, and a person-scoped memory query.
- **Layout, top to bottom:**
  - Padding 6 20 110, gap 16.
  - Header: back 36 + status chip "VIP · Müşteri" (height 30, padding 0 10, `#EDEDFC` / `#4547C9`, `star` FILL 15).
  - Centered avatar 76 (26px) `#DCE4F5` / `#2B3F73`; name 26/600 −.02em; sub 14 `#6B6860`.
  - **StatTile** grid, 3 columns, gap 8: `#fff`, radius 16, padding 12, shadow `0 1px 2px rgba(27,25,23,.04)`; label 11 `#9B978E`; value 15/600 (the "Açık konu" value is `#9A6300`).
  - Sections: GroupedListCard with icon rows.
  - Sticky composer (padding 12 16 44, gradient `rgba(245,244,240,0)` → `#F5F4F0` at 40%) with placeholder "Mehmet hakkında sor…" and mic 40.
- **Exact copy:**
  - "VIP · Müşteri", "MY", "Mehmet Yılmaz", "Yılmaz Endüstri · Satın alma müdürü".
  - Stats "Son iletişim" / "Dün 18:20"; "Yaklaşan" / "Bugün 14:30"; "Açık konu" / "2".
  - "SON KONUŞULAN KONULAR": [sell] "Fiyat · %8 indirim sınırı" · "1 Eyl · Telefon"; [local_shipping] "Ekim başı teslim" · "1 Eyl · Telefon"; [description] "Sözleşme taslağı" · "22 Ağu · Mail".
  - "SENDEN BEKLEDİKLERİ": [person] "Revize teklif · PDF" · "Bugün 17:00".
  - "SENİN BEKLEDİKLERİN": [schedule_send] "Teklif v2 geri bildirimi" · "3 gün"; [schedule_send] "Sözleşme hukuk yorumu (Mehmet tarafı)" · "14 gün".
  - "SON İLETİŞİM": [mail] "“Fiyatı Ekim teslimatına göre güncelleyebilir misiniz?”" · "Dün 18:20 · Gmail"; [call] "Telefon görüşmesi · 12 dk" · "1 Eyl 15:00"; [event] "Tanışma toplantısı" · "18 Ağu · Ofis".
  - "Mehmet hakkında sor…".
  - Caption: "Kişi sayfası mail dizisi değil ilişki özeti: son iletişim, yaklaşan toplantı, açık konular, iki yönlü beklentiler. Alt giriş kişiye bağlı hafıza aramasıdır."
  - Interactive prototype variant: chip just "VIP"; sub "Müşteri · Yılmaz Endüstri · Son iletişim dün 18:20"; 2-column stats "Yaklaşan toplantı" / "Bugün 14:30" and "Açık konular" / "2 konu" (padding 14, value 16/600).
- **Data fields → entities:**
  - `contacts` {name, org, title (only if sourced, e.g. Google People `organizations[].title` or signature parse with confidence), emails[]}.
  - `vip_people` {group}.
  - Aggregates: last_contact_at (`email_messages` / events / notes), next `calendar_events` with this attendee, open loops count (`insights` / `commitments`).
  - Topics[] {label, date, channel} (AI-extracted with source).
  - They-expect[] (user commitments) and you-wait[] (follow-ups), each with a source.
  - Recent communications[] (email, note, event).
- **Interactions → production behavior:**
  - VIP chip: VIP edit sheet (group, remove).
  - "Yaklaşan" tile: Meeting Prep for that event. "Son iletişim" tile: that email. "Açık konu" tile: scroll to or open the open-loops list. **There is no AÇIK KONULAR section on this page** — needs adding (secondary has one).
  - Topic rows: source.
  - SENDEN BEKLEDİKLERİ: commitment detail, reply, or complete (§18 actions "Tamamlandı / Ertele / Kaynağı Gör").
  - SENİN BEKLEDİKLERİN: Smart Follow-Up, then draft, then approval.
  - SON İLETİŞİM rows: Email Detail, note, or event.
  - Missing "Tüm iletişimi gör" link (related emails, §30).
  - Composer: memory search scoped to `person_id` (6.5 with a person filter). Mic: voice mode with person context.
  - Optional handoffs: mail compose (draft → approval), tel: (if a phone is known).
- **States depicted:** populated.
- **States missing:** loading; sparse person (only 1 email: hide empty sections); unknown title/org; non-VIP variant (a "VIP yap" action); merged or duplicate contacts; Pro gate; dark.
- **Prototype-only / fake:** "Telefon görüşmesi · 12 dk" (no call source exists); "Satın alma müdürü" (not sourceable by default). Secondary "AI'ya sor" input has no handler (dead).
- **Maps to:** §30, §26, §21, §18, §17, §97.

### Onay Merkezi · Onay Bekleyenler / Approval Center
- **Source:** PRIMARY / 06 / **6.8 "Onay Merkezi · Kontrol her zaman kullanıcıda"**.
- **Purpose:** One queue of pending AI write actions, each approved individually (no bulk), plus today's approved history.
- **Layout, top to bottom:**
  - Padding 6 20 40, gap 14.
  - Header: back 36 + text link "Geçmiş" 13/600 `#6B6860`.
  - H1 "Onay Bekleyenler" + sub.
  - **ApprovalCards:** `#fff`, radius 20, padding 16, shadow.
    - Header: icon tile 28, radius 9, `#EDEDFC` / `#4547C9`, icon 17; type 12/600 .06em `#6B6860` flex; time 12 `#9B978E`.
    - What 17/23 600 pretty (10px below).
    - Grid `64px 1fr`, gap 6 10, 13/19 (10px below): labels "Neden", "Değişim" in `#9B978E`.
    - Buttons (14px below, 14/600, height 42, radius 12, gap 8): "Onayla" flex 1 `#5B5CE2`; "Düzenle" `#EDEDFC` / `#4547C9`; "Reddet" `#F0EFEB` / `#6B6860`.
  - Kicker "BUGÜN ONAYLANANLAR · 2". GroupedListCard rows: `check_circle` FILL 22 `#2FA062`, 14px text, time 12 `#9B978E`.
  - **AssuranceFooter:** `verified_user` 18 `#1E7A47` + 13/19 `#6B6860`.
- **Exact copy:**
  - "Geçmiş", "Onay Bekleyenler", "3 işlem onayını bekliyor. Hiçbiri sen onaylamadan yapılmaz."
  - Cards:
    1. [send] "MAİL GÖNDER" · 09:40 · "Mehmet Yılmaz'a takip mesajı gönder" · Neden "Teklif mailine 3 gündür yanıt gelmedi." · Değişim "1 mail gönderilecek · Kısa, profesyonel ton · Ek yok"
    2. [event_repeat] "ETKİNLİK TAŞI" · 12:12 · "Mehmet toplantısını 16:30'a al" · "Mehmet 16:00'yı önerdi; 16:00 dolu, 16:30 boş." · "14:30 → 16:30 · 2 katılımcıya bildirim gider"
    3. [notifications] "HATIRLATICI OLUŞTUR" · 09:52 · "Elektrik faturası · 13 Eylül 10:00" · "Fatura fotoğrafında 15 Eylül son ödeme tarihi bulundu." · "1 hatırlatıcı · Takvimine yazılmaz"
  - "Onayla", "Düzenle", "Reddet".
  - "BUGÜN ONAYLANANLAR · 2": "Ahmet'e yanıt gönderildi" 15:48; "“Başvuru son saati” takvime eklendi" 09:52.
  - "Önemli işlemler sen onaylamadan gerçekleştirilmez. Toplu onay yok; her kart tek tek."
  - Caption: "Kart sözleşmesi: Ne yapılacak · Neden · Ne değişecek. Reddet bir öğrenme sinyalidir (“bu tür önerileri azalt”). Onaylananlar geçmişte 30 gün saklanır."
- **Data fields → entities:** `approval_actions` {id, user_id, type (`email_send` | `calendar_update` | `reminder_create` | …), title/what, why, change_summary, **source ref**, **destination account**, proposed_side_effects, payload (Zod-typed), status (pending | approved | rejected | executing | executed | failed | expired), created_at, approved_at, executed_at, idempotency_key, approved_via (tap | voice), rejection_reason}.
- **Interactions → production behavior:**
  - **Onayla:** status becomes approved, then the server executor runs (edge function) with idempotency (unique key; the same action is never executed twice, §33). The button morphs to "Onaylandı", the badge turns green, and the card moves to history (08 motion: button 200 ms, badge 160 ms, card 320 ms, success haptic).
  - On failure: a failed card with the reason and "Tekrar dene". Retry reuses the idempotency key.
  - **Düzenle:** type-specific editor:
    - email_send → AI Reply editor.
    - calendar_update → time picker with free slots.
    - reminder_create → Smart Reminder sheet.
    - Save updates the payload and keeps the approval pending (not auto-approve).
  - **Reddet:** status rejected + `ai_feedback` ("bu tür önerileri azalt").
  - "Geçmiş": approval history screen (not designed; filterable by status; retention noted).
  - History row tap: result detail (sent email, event).
  - Entry points: Today approval badge, push notification, and inline cards in chat, voice and plan.
- **States depicted:** 3 pending plus today's approved.
- **States missing:** empty (08: `task_alt`, bg `#F0EFEB`, fg `#6B6860`, "Onay bekleyen işlem yok." / "Bir mail göndermek veya takvimi değiştirmek istediğimde önce burada görürsün." / "Geçmişi gör"); executing; executed; failed; expired ("Süresi doldu · 16:00 geçti"); rejected; offline (approve queued or blocked; must not double-execute on reconnect, §94); scope missing (progressive auth); dark; the **source** and **destination/account** rows required by §33.
- **Prototype-only / fake:** future timestamps relative to the status bar (12:12 and 15:48 vs 9:41). Secondary approve/reject only filter the local list after 600 ms, and "Kaydet ve Onayla" approves without applying the edit.
- **Maps to:** §33, §115, §3, §59, §94, §116.

### AI Kişiselleştirme · "Seni nasıl tanıyor?" / AI Personalization
- **Source:** PRIMARY / 06 / **6.9 "AI Kişiselleştirme · “Seni nasıl tanıyor?”"**.
- **Purpose:** Transparent list of what the AI has learned, with evidence, editable and deletable.
- **Layout, top to bottom:**
  - Padding 6 20 40, gap 14. Header: back 36 + spacer.
  - H1 28/34 pretty + sub 14/20.
  - Groups: kicker, then GroupedListCard rows (align center, padding 11 0, gap 12): icon tile 30; text 15/21; meta 12 `#9B978E`; trailing `edit` + `delete` icons 20 `#B8B4AA`, gap 4.
  - **OutlineAddButton** "Kural Ekle": height 48, radius 14, `#fff`, `#4547C9` 14/600, `add` 20, shadow `0 1px 2px rgba(27,25,23,.06)`.
- **Exact copy:**
  - "Dijital Asistan seni nasıl tanıyor?", "Zamanla öğrendiklerim. Her satırı düzenleyebilir veya silebilirsin; sildiğin şeyi bir daha varsaymam."
  - "KİŞİLER": [star] "Mehmet Yılmaz yüksek öncelikli." · "Sen ekledin · VIP · Müşteri"; [trending_down] "Toplu bültenler düşük öncelikli." · "3 kez “önemli değil” dedin".
  - "KONULAR": [sell] "Promosyon mailleri düşük öncelikli." · "12 kez arşivledin, hiç açmadın"; [flight] "Uçuş ve rezervasyonlar Bugün ekranında görünür." · "Onboarding · Seyahat seçildi".
  - "TERCİHLER": [schedule] "Toplantıları 30 dakika önce hatırlatmayı tercih ediyorsun." · "Son 8 hatırlatıcıdan çıkarıldı"; [wb_twilight] "Brifing 08:00, 13:00 ve 19:00." · "Ayarlar"; [record_voice_over] "Yanıt taslaklarında profesyonel ton." · "Son 6 taslaktan 5'i".
  - "Kural Ekle".
  - Caption: "Şeffaf model: her kuralın kaynağı yazar (“3 kez ‘önemli değil’ dedin”). Kurallar üç grupta: kişiler, konular, tercihler. Silme geri alınabilir (5 sn toast)."
- **Data fields → entities:** learned preferences table (e.g. `user_learned_preferences`: {group, statement, target (contact_id/topic/setting key), effect (priority up/down, reminder offset, tone), evidence_text, evidence_count, origin (learned | user | onboarding | settings), enabled, deleted_at (tombstone: "bir daha varsaymam")}). Plus the global toggle `learn_from_interactions`.
- **Interactions → production behavior:**
  - Edit icon: sheet to edit the effect (e.g. priority Yüksek/Normal/Düşük, as in secondary).
  - Delete icon: soft-delete + tombstone + 5 s undo toast.
  - **Missing per §32:** per-row **disable** toggle and the global "**Etkileşimlerimden öğren**" switch (secondary has both).
  - "Kural Ekle": ambiguous. Explicit rules belong to Priority Rules (07 7.9–7.12, "Yeni Kural · Koşul + Sonuç + Önizleme"). Route there, or rename.
- **States depicted:** populated.
- **States missing:** empty (secondary: "AI henüz bir tercih öğrenmedi."); learning disabled state (rows greyed, "Öğrenme kapalı"); undo toast; dark; loading.
- **Prototype-only / fake:** evidence counts are fixtures. Secondary edits are in-memory only.
- **Maps to:** §32, §31, §40, §59.

---

## 2. SECONDARY comparison: what it adds (restyle to primary; flag fakes)

### Plan (secondary) / `screens/plan/PlanScreen.tsx`
- **Adds:**
  - (a) Header "Taahhütler" button (`#F0ECFF` / `#5B21B6`) → `commitments`, plus avatar "Y" → `profile`. Primary Plan has neither; add both (Profile via avatar, §8; Commitments entry, §19).
  - (b) **AI proposal approval sheet** "AI Öneri" (the §19 flow primary lacks):
    - Kicker "✨ ÖNERİLEN ZAMAN BLOĞU", "14:00 – 16:30" (22/800), "Teklif hazırla".
    - Rationale "Yarın bu aralıkta 2,5 saatlik boşluk var. Mehmet Kaya toplantısından önce teklifin hazır olması için ideal zaman."
    - Buttons "Onayla" / "Saati Değiştir" / "İptal".
    - Success "Takvime eklendi" / "Yarın 14:00–16:30 bloğu "Teklif hazırla" görevi olarak eklendi."
  - (c) Inline **conflict banner** on Day: "Takvim Çakışması" / "14:00–15:00 müşteri toplantısı ile 14:30 doktor randevusu çakışıyor." / CTA "Çöz" → calendar-conflict.
  - (d) Event labels "AI ÖNERİSİ" / "TOPLANTI", duration "2sa", platform "Google Meet" / "Zoom".
  - (e) Meeting tap → meeting-prep.
- **Fake / flag:**
  - "Saati Değiştir" is dead (no onClick).
  - "Onayla" gives a fake success after a 1.8 s timeout, with no provider write.
  - The Hafta segment has no content (the view state is unused).
  - Timeline hour slots 08–18 are hard-coded; empty slots are spacer divs.
  - Emoji icons (✨📅⚠️) must become Material Symbols.
  - Names "Mehmet Kaya" / "Can Öztürk": primary "Mehmet Yılmaz" wins.

### Takvim Çakışması (secondary) / `CalendarConflict.tsx`
- **Adds:**
  - Source calendar per event ("Google Calendar", "Apple Calendar") — keep, as a provider/account label.
  - Options "Doktor randevusunu iptal et" ("Randevu sisteminde değişiklik gerekiyor") and **"Beni hatırlat, kendim çözeyim"** ("1 saat sonra hatırlatılır") — the latter is a good, honest option; add it to the primary sheet as a reminder_create.
  - "ÖNERİLEN" badge.
  - Resolved screen "Çözüldü!" / "Müşteri toplantısı 13:00'e alındı." / "Plana Dön".
- **Fake / flag:** "Mehmet'in takviminde de bu saat uygun görünüyor" (no free/busy source). Selecting the recommended option instantly shows "Çözüldü!" with no approval (violates §3.8, §33). The other options are dead (`opt.recommended && …`).

### Toplantıya Hazırlan (secondary) / `MeetingPrep.tsx`
- **Adds:**
  - Meeting platform line "14:30 · Google Meet".
  - "⏱️ 18 dakika kaldı".
  - Person summary card "Son iletişim: 4 gün önce · 3 açık konu" → person-intelligence.
  - "Son E-postalar" tappable ("Aç →") → email-detail.
  - Inline note editor (dashed "Not Al…" → textarea "Toplantı notlarını buraya yaz…").
  - **"Toplantıyı Başlat"** → handoff interstitial "Google Meet açılıyor…" / "Mehmet Kaya ile toplantın başlamak üzere. Hazır olduğunda uygulamaya geç." / "Geri Dön" / "Meet'i Aç ↗".
  - This covers §21 "Meeting link gerçek external handoff". Implement as a direct `Linking.openURL(joinUrl)`; no fake interstitial needed.
- **Fake / flag:** "Meet'i Aç ↗" has no onClick (dead). "2 Dk Özet" navigates to post-meeting (wrong target). The note is not persisted. The talking-point body "Sözleşme maddesi #7" differs from primary.

### Toplantı Sonrası (secondary) / `PostMeeting.tsx`
- **Adds:** a **text-mode** layout: card "Takip edilecek bir konu var mı?" with a textarea (placeholder "“Mehmet'e yarın teklif göndereceğim.”"); Kaydet disabled until there is text; "YENİ TAAHHÜT" preview with "Yarın · Taahhütler listesine eklenecek"; success "Taahhüt Kaydedildi" / "Yarın hatırlatılacak" / "Bugüne Dön".
- **Fake / flag:** the extraction card is hard-coded (shown for any text). Success is not persisted. "Mehmet Kaya · Müşteri Toplantısı · 60 dk".

### Taahhütler (secondary) / `CommitmentTracker.tsx` (Commitments; primary equivalent lives in 04 4.8)
- **Adds:**
  - Header text "AI e-postalarından tespit ettiği {n} açık taahhüt var."
  - Cards with a quoted commitment, a status badge (Bekliyor `#FFF4E0` / `#8C5200`; Tamamlandı `#E8F8EE` / `#1A7A33`; Gecikti `#FFEEED` / `#C0251B` — map to the primary warning/success/critical soft tokens), "KİME", "TARİH", "Kaynak: …".
  - Actions "Tamamlandı" / "Ertele" / "Kaynağı Gör" (§18 exact).
  - **Ertele sheet:** "Yeni bir tarih seç:" with options "Yarın", "2 gün sonra", "Önümüzdeki hafta", "Özel tarih" + date input; "Kaydet"; success "Ertelendi".
- **Fake / flag:** "Özel tarih" option does nothing (dead). Reschedule completes on a 1.4 s timeout (fake). "Kaynağı Gör" always opens the same email-detail. Status is local only. There is no confidence display or "belirsiz → onay" path.
- **Map:** §18, §29.

### Asistan (secondary) / `AssistantScreen.tsx`
- **Adds:**
  - Welcome card "Dijital hayatına sor." / "Mail, takvim ve taahhütlerine dayalı akıllı yanıtlar alırsın."
  - A 6th prompt, **"Ödenmesi gereken bir şey var mı?"**.
  - The master-prompt wording "Bu hafta hangi son tarihlerim var?" — prefer it over primary's "deadline'lar".
  - A composer with a **"+" (Evrensel Ekleme → universal-capture)** button, a separate mic, and a **send** button (disabled until text).
  - Typing indicator (3 dots, `wavePulse`).
  - Asymmetric bubble radii (18 18 6 18 / 18 18 18 6).
  - Voice button in the header.
- **Fake / flag:** canned responses, keyword matching on the first word, random delay, and "hakkında bilgi arıyorum…" fallback text.

### Sesli Asistan (secondary) / `VoiceAssistant.tsx`
- **Adds:**
  - Explicit state machine `idle | listening | processing | responding` with labels "Konuşmak için dokun" / "Dinliyorum…" / "Anlıyorum…" / "Yanıt hazır".
  - Hint "Durdurmak için dokun" / "veya aşağıdan örnek seç".
  - Stop state (red button — restyle to primary; no red).
  - Title "Sesli Asistan".
  - Example commands: "“Yarınki toplantımı 30 dakika ileri al.”" (a write action that must route to approval), "“Mehmet'e cevap vermem gerekiyor mu?”", "“Bugünkü brifingimi oku.”".
- **Fake / flag:** timers stand in for recognition. Every example chip triggers the same canned answer.

### Arama (secondary) / `shared/SearchScreen.tsx` (no primary equivalent)
- **Purpose:** global search (§95).
- **Adds:**
  - Search field "Dijital hayatında ara…" + "İptal".
  - "SON ARAMALAR" (recents: "Mehmet teklif", "Uçak bileti", "Elektrik faturası").
  - "ÖRNEK ARAMALAR" chips ("Geçen ay uçak bileti", "Ekim toplantıları", "Ödemem gerekenler", "Mehmet teklif maili").
  - "{n} SONUÇ" list: type icon, title, summary, SourceTag, date. Results navigate to the entity screen (email-detail / person-intelligence / meeting-prep).
  - Empty "Sonuç bulunamadı" / "“{query}” için bir şey bulunamadı."
- **Restyle:** merge into 6.5. Idle state shows recents and examples. Results show the answer card first (if the query is a question), then typed result groups (Mailler, Kişiler, Takvim, Görevler, Taahhütler, Yaşam, Hafıza, Yakalananlar per §95). Recents are stored locally.
- **Fake / flag:** hard-coded dictionary matching. Result rows with `screen: null` look tappable but do nothing (dead).

### Evrensel Ekleme (secondary) / `shared/UniversalCapture.tsx` (primary equivalent in 04 4.10/4.11)
- **Adds:**
  - Entry from the Asistan composer "+".
  - Title "Dijital Asistan'a Ekle", intro "Fotoğraf, screenshot, PDF, link veya metin yapıştır. AI içerikten etkinlik, görev veya hatırlatıcı çıkarır."
  - Source tiles "Fotoğraf" / "PDF" / "Link"; "VEYA METİN YAPIŞTIIR" (typo in the prototype: "YAPIŞTIIR").
  - CTA "AI ile Analiz Et"; analyzing "İçerik analiz ediliyor…" / "Etkinlik, görev ve son tarih aranıyor".
  - Result "İçerik Tespit Edildi", "✨ AI TESPİT ETTİ", "12 Eylül · 20:00 · Zorlu PSM", "Etkinlik olarak tespit edildi".
  - Actions "Takvime Ekle" / "Görev Oluştur" / "Hatırlatıcı Kur"; "Tekrar Dene".
- **Fake / flag:** tiles inject sample text and a fake 1.8–2 s analysis. The result is fixed regardless of input. All actions navigate to approval-center without creating an approval (fake).

### Onay Bekleyenler (secondary) / `shared/ApprovalCenter.tsx`
- **Adds:**
  - Labelled sections "NE YAPILACAK" / "NEDEN" / "DEĞİŞİKLİK" (the change shown in an inset box, italic).
  - **Edit sheet** "Eylemi Düzenle" ("AI'nın yapacağı eylemi düzenle:", "İptal" / "Kaydet ve Onayla").
  - Empty "Tüm işlemler onaylandı!" / "Bekleyen AI işlemi yok." — use the primary 08 copy instead.
  - Type set `send-email`, `create-event`, `move-event`, `create-task`, `set-reminder`. Map to §33 enums: email_send, calendar_create, calendar_update, task_create, reminder_create (+ commitment_create).
- **Fake / flag:** free-text editing of a structured action is unsafe. Editing must be type-specific and Zod-validated. Approval is local only.

### Kişi Zekâsı (secondary) / `shared/PersonIntelligence.tsx`
- **Adds:** an "AÇIK KONULAR" list with urgency dots (acil `#FF3B30`, normal `#FF9F0A` — restyle to critical `#E0553F` / warning `#E09A1C`), and recent topics with relative ages ("Bugün", "2 gün", "1 hafta").
- **Fake / flag:** the "AI'ya sor" input is dead; data is mock.

### VIP Kişiler / AI Kişiselleştirme (secondary) / `settings/VIPPeople.tsx`, `settings/AIPersonalization.tsx`
- **VIP adds:** a mixed list of all people with inline "VIP Ekle" / "Kaldır" toggles, and the info banner "⭐ VIP kişilerin mesajları her zaman önce gösterilir."
  - Flag: the row onClick navigates **and** the button toggles (event bubbling bug).
- **Personalization adds:** priority badge per item (Yüksek `#C0251B` / `#FFEEED`, Normal, Düşük); **"Devre Dışı / Etkinleştir"** per row; the **"EĞİTİM VERİSİ · Etkileşimlerimden öğren · Daha iyi öneriler için verilerini kullan"** switch; edit sheet "Tercihi Düzenle" → "ÖNCELİK" radio; empty "AI henüz bir tercih öğrenmedi."
  - These fill §32 gaps in primary 6.9.

---

## 3. Cross-cutting production contracts implied by 05/06

- **`approval_actions.type`** values used by these screens:
  - `calendar_create`: Planla, Hazırlığı Buraya Koy, gap → focus block.
  - `calendar_update`: 10:15'e Kaydır, shorten meeting, ETKİNLİK TAŞI.
  - `email_send`: propose-time email, follow-up, draft "Göndermeyi Onayla", voice approval.
  - `reminder_create`: 12:40'a Hatırlat, "Beni hatırlat, kendim çözeyim", HATIRLATICI OLUŞTUR.
  - `commitment_create`: post-meeting Kaydet.
  - `task_create`: capture.
  - UI type labels needed (TR): "MAİL GÖNDER", "ETKİNLİK TAŞI", "HATIRLATICI OLUŞTUR" (shown); "ETKİNLİK EKLE", "GÖREV OLUŞTUR", "TAAHHÜT KAYDET" (proposed, not in design).
- **Internal, no approval but undo toast:** dismiss insight ("Böyle Kalsın"), snooze waiting item ("Selin'i yarına ertele"), VIP add/remove, learned preference delete/disable, commitment complete.
- **External handoffs:** meeting join URL, maps, tel:, provider web deep links ("Orijinali Aç"), attachment viewer.
- **Notifications (§96, §132):** Meeting prep at T−20 min (§21 caption); post-meeting at end +1 min, silent (5.7 caption); leave-by reminder (5.2).
- **Pro gating (§44):** Meeting Prep (5.4–5.6), Commitments (5.7), AI Memory (6.5), VIP (6.6–6.7), advanced planning (5.2 intelligence), Voice Briefing (5.6 audio). Voice mode (6.3–6.4) is unspecified and needs a decision. Use the 07 7.6 contextual gate pattern: blurred content + "7 gün ücretsiz dene" / "Şimdi değil"; "Şimdi değil" suppresses the gate for 7 days.
- **Libraries (npm latest as of 2026-09-23; Expo SDK `expo@57.0.24`):**
  - `expo-speech-recognition@57.1.0` (jamsch) — STT tr-TR.
  - `expo-speech@57.0.3` — TTS.
  - `expo-audio@57.0.5` — waveform/levels, audio playback.
  - `expo-calendar@57.0.4` — Apple/Android device calendars, §75.
  - `expo-haptics@57.0.3`.
  - `@gorhom/bottom-sheet@5.2.14` — sheets.
  - `react-native-reanimated@4.7.0` — orb/waveform/card motion.
  - `@shopify/flash-list@2.3.2` — chat and search lists.
  - `expo-linking@57.0.10` / `expo-web-browser@57.0.3` — handoffs.
  - `expo-router@57.0.22`.
  - `@supabase/supabase-js@2.117.1`.
- **External credentials implied (for the §149 matrix):**
  - Routing ETA: Google Routes API key, or Apple MapKit (native).
  - STT/TTS provider if not platform-native.
  - Embeddings provider (pgvector).
  - LLM provider (Anthropic/OpenAI adapters, §81).
  - Google/Microsoft calendar **write** scopes via progressive consent (§76).

---

## Reusable components observed

| Component | Anatomy / variants | Props implied | Exact styling |
|---|---|---|---|
| **BottomTabBar** | 4 items: Bugün `sunny`, Akış `dynamic_feed`, Plan `calendar_today`, Asistan `auto_awesome`. Hidden inside chat threads and full-screen flows. | `activeTab`, `badge?` | h90, pad 8/8/28, `rgba(255,255,255,.92)` + blur 20, top border `rgba(27,25,23,.06)`, label 11/500, icon 26, active `#5B5CE2` FILL 1, inactive `#9B978E`. Dark: `rgba(20,19,17,.92)`, border `rgba(255,255,255,.08)`, active `#A9AAF5`, inactive `#7A776F`. |
| **LargeTitle** | Tab-root title | `text`, `trailing` | Geist 28/34 600 −.02em `#1A1917` / `#F2F0EB` |
| **SegmentedControl** | 2 segments | `options`, `value`, `onChange` | Track `#E9E7E1` r999 p3; seg h30 px14 13/600; selected `#fff` + `0 1px 3px rgba(27,25,23,.12)`; unselected `#6B6860`. Dark: track `rgba(255,255,255,.08)`, selected `#F2F0EB` / `#141311`, unselected `#A39F96`. |
| **DayStripCell** | weekday, number, dot. States: default / today (inverted) / selected (undefined). | `date`, `isToday`, `isSelected`, `dotKind` | 42×60 r14 gap 2; 11/500 op .8; 17/600; dot 4×4. Light today `#1A1917` / `#fff` dot `#A9AAF5`. Dark default `#1F1E1B` + ring `.06`, today `#F2F0EB` / `#141311`. |
| **AIInsightCard (glow)** | kicker (auto_awesome), headline, body, actions (primary + ghost), or nested items. States: default / planned-success / loading. Used in 5.1, 5.7, 6.5. | `kicker`, `title`, `body`, `actions[]`, `children` | radial-gradient(140% 100% at 0% 0%, `#E4E4FA` 0%, `#FFFFFF` 60%), r20, p16, shadow `0 1px 2px rgba(27,25,23,.04), 0 6px 20px rgba(27,25,23,.05)`; kicker 12/600 .06em `#5B5CE2`; title 16/23 600; body 14/20 `#6B6860`; primary btn h40 px16 r12 `#5B5CE2` 14/600 icon 18; ghost h40 px14 `#6B6860`. Dark: radial `rgba(133,134,242,.28)` → `#1F1E1B`, ring `.06`, kicker `#A9AAF5`, btn `#8586F2` / `#0F0F2A`. Success: `#E4F5EA` / `#1E7A47` + `check`. |
| **TimelineRow / TimelineBlock** | Types: event, ai (proposed / planned), gap, life, deadline | `time`, `type`, `icon`, `title`, `meta`, `status`, `onPress` | Gutter 44 right 12/500 `#9B978E` pt8; hairline `rgba(27,25,23,.07)`; min-h 68; block r14 p10/14; title 15/600; meta 12. Per-type tokens as in the 5.1 / 5.1D blocks. |
| **WeekDensityChart** | Header, stacked bars ×7, day labels, legend | `days[{label, meetingMin, focusMin, hot, today}]`, `rangeLabel`, `count` | Card `#fff` r20 p16; bars area h120 gap 8; bar r5 gap 3; colors `#D9D6F7` / `#EDEDFC`, hot `#F3B7AE` / `#E0553F`, today `#5B5CE2` / `#A9AAF5`; labels 11/600; legend swatch 10 r3. |
| **InsightRowCard** | Semantic icon, title, body, ≤2 text actions | `severity` (density / travel / opportunity / conflict), `actions` | `#fff` r16 p14/16; icon 20: amber `#9A6300`, blue `#2262BE`, indigo `#5B5CE2`, coral `#C7432F`; title 15/600; body 13/19 `#6B6860`; actions 13/600 gap 14, primary `#4547C9`, secondary `#6B6860`. |
| **ConflictPair** | Two event cards, second offset 24 on warm surface, coral 16×2 marker | `a`, `b` | Card r16 p14/16; B bg `#FDF6EC` border `rgba(27,25,23,.06)`; marker `#E0553F` |
| **BottomSheet (option list)** | Grabber, title, subtitle, rows (icon, title, meta, chevron), recommended row | `title`, `subtitle`, `options[{icon, title, meta, recommended}]` | Scrim `rgba(27,25,23,.35)`; `#fff` r28/28/0/0 p10/20/44; shadow `0 -10px 40px rgba(27,25,23,.12)`; grabber 36×5 `#E0DED7`; title 19/600; sub 13 `#6B6860`; rows min-h 60 (52 in the interactive prototype); recommended icon `#5B5CE2`, meta `#4547C9`/600; chevron 18 `#C9C5BC`; motion 300/240/250 ms. |
| **DetailHeader** | 36 circle button + centered kicker + trailing slot | `leading` (back / close), `kicker`, `trailing` | Button `#fff` shadow `0 1px 2px rgba(27,25,23,.08)` icon 20; kicker 12/600 .08em `#9B978E`; dark btn `#1F1E1B` + ring `.08`; on gradient `rgba(255,255,255,.14)`. |
| **StatusPill / CountdownChip** | icon + label | `tone` (warning / brand), `icon`, `label` | h30 px10 r999 12/600 icon 15 gap 4; warning `#FDF2DC` / `#9A6300` (dark `rgba(217,139,11,.18)` / `#F0B85A`); brand `#EDEDFC` / `#4547C9` |
| **Avatar (initials)** | Sizes 32 / 38 / 56 / 76 | `initials`, `palette` (deterministic) | Palettes blue `#DCE4F5` / `#2B3F73`, terracotta `#F5E1D6` / `#7A3E1F`, green `#E3EFE6` / `#1E5A36`, neutral `#F0EFEB` / `#6B6860`; dark blue inverted. Font 11 / 12 / 20 / 26, weight 600. |
| **PersonHeaderRow** | Avatar 56 + name 24/30 + meta + chevron | `person`, `meta`, `onPress` | Gap 14, chevron 22 `#B8B4AA` |
| **TalkingPointsCard** | Kicker + 3 numbered items | `points[{title, body, sources}]` | Light `#1A1917` r24 p20 shadow `0 12px 32px rgba(27,25,23,.18)`, kicker `#A9AAF5`, number 26 `rgba(255,255,255,.12)`, title 17/600, body 14/20 `rgba(255,255,255,.7)`. Dark gradient `160deg #2C2C7A → #4A4BC8`. |
| **SectionKicker** | Uppercase label | `text`, `count?` | 12/600 .08em `#9B978E` (dark `#7A776F`), pad 0 4 8 |
| **GroupedListCard + IconRow** | Icon tile + text + meta; trailing variants: none / star / edit+delete / chevron | `rows[]` | Card `#fff` r18 p4/16 shadow; row p11/0 gap 12, border-top `rgba(27,25,23,.06)` except first; tile 30 r10 `#F0EFEB` / `#6B6860` icon 17; text 15/21 −.01em; meta 12 `#9B978E`. Dark card `#1F1E1B` + ring `.06`, tile `rgba(255,255,255,.08)` / `#A39F96`. |
| **StickyActionFooter** | Primary + secondary, or primary + icon square | `primary`, `secondary?`, `icon?` | Pad 16/20/44; gradient bg→transparent 45%; primary h52 r16 `#5B5CE2` 15/600 shadow `0 8px 24px rgba(91,92,226,.28)`; secondary h52 px18 r16 `#fff` shadow `0 1px 2px rgba(27,25,23,.08)`; icon 52×52 r16. Dark primary `#8586F2` / `#0F0F2A`, secondary `#1F1E1B` + ring. |
| **EditorialReader** | Byline, title, paragraphs with emphasis, sources | `byline`, `title`, `paragraphs`, `sources` | Paper `#FBFAF7`; Lora italic 15 `#6B6860`; Lora 30/36 500; Lora 17/28, `b` 600 |
| **SourceChip** | icon + label | `type`, `label`, `onPress` | h30 px10 r999 `#fff` 12/500 shadow `0 1px 2px rgba(27,25,23,.06)` icon 15 `#6B6860` |
| **TranscriptCard + MiniWaveform** | Italic transcript + level bars + status | `text`, `level`, `elapsed`, `state` | `#fff` r20 p16, italic 16/24; bars 3px r2 active `#5B5CE2` / rest `#D9D6F7`, h 6–18; caption 12 `#9B978E` |
| **DetectedItemRow** | icon + title + meta + include-check | `item`, `selected`, `confidence` | `#fff` r14 p10/12 shadow `0 1px 2px rgba(27,25,23,.06)`; `handshake` 20 `#5B5CE2`; check FILL `#2FA062` |
| **SummaryBanner** | AI circle + rich text | `stats` | `#fff` r16 p12/14; circle 34 `#EDEDFC`, icon 18 `#5B5CE2`; 14/20 |
| **SuggestedPromptRow** | text + `arrow_outward` | `text`, `onPress` | h52 px16 r16 `#fff` 15/500 shadow `0 1px 2px rgba(27,25,23,.04)`; icon 18 `#B8B4AA`; pressed `#EDEDFC`. Dark `#1F1E1B` + ring, icon `#5E5B54`. |
| **ChatComposer (pill)** | input + mic, and send (missing) + optional "+" | `value`, `onSend`, `onMic`, `placeholder` | h52 r999 pad 0/6/0/16 `#fff`, shadow `0 1px 2px rgba(27,25,23,.06), 0 8px 24px rgba(27,25,23,.08)`; placeholder 15 `#9B978E`; mic 40 `#5B5CE2` icon 20 `#fff`. Dark `#1F1E1B` + ring `.08` + `rgba(0,0,0,.35)`, mic `#8586F2` / `#0F0F2A`. |
| **ChatBubble** | user / assistant | `role`, `text`, `streaming` | Max-w 86%, p10/14, r18, 15/21; user `#5B5CE2` / `#fff`; assistant `#fff` + card shadow |
| **RichAnswerCard** | Kicker + rows (avatar / icon, title, meta, badge, inline action) | `kind`, `rows`, `sources` | `#fff` r16 p12/14; kicker 12/600 .06em `#9B978E`; row p10/0 hairline |
| **DeadlineBadge** | critical / warning | `tone`, `label` | 11/700 p3/8 r999; critical `#FCEDE9` / `#C7432F`; warning `#FDF2DC` / `#9A6300` |
| **FollowUpChip** | text chip | `label`, `onPress` | h30 px10 r999 `#fff` 12/600 `#6B6860` shadow `0 1px 2px rgba(27,25,23,.06)` |
| **DraftCard** | Kicker, 2-line preview, approve + edit | `recipient`, `preview`, `approvalId` | Buttons h36 px12 r12 13/600, primary `#5B5CE2`, tonal `#EDEDFC` / `#4547C9` |
| **ApprovalCard** | Full (6.8) / compact (6.4) / inline (chat) | `approval` | See the 6.8 block. Buttons h42 r12: Onayla `#5B5CE2`, Düzenle `#EDEDFC` / `#4547C9`, Reddet/İptal `#F0EFEB` / `#6B6860`. Compact shadow `0 12px 32px rgba(0,0,0,.25)`. |
| **SearchFieldPill** | icon + text + clear | `value`, `onClear` | h44 r999 `#fff` shadow `0 1px 2px rgba(27,25,23,.06)`, icons 18 `#9B978E` |
| **FilterChip** | selected / default | `label`, `selected` | h30 px10 r999 12/600; selected `#1A1917` / `#fff`; default `#fff` / `#6B6860` |
| **SourceResultCard** | Icon tile 28 r9, src, date, title, summary, "Orijinali Aç" | `result` | `#fff` r18 p14/16; title 15/21 500; summary 14/20 `#6B6860`; link 13/600 `#4547C9` + `open_in_new` 16 |
| **StatTile** | label + value | `label`, `value`, `tone?` | `#fff` r16 p12 shadow `0 1px 2px rgba(27,25,23,.04)`; 11 `#9B978E`; 15/600; warning value `#9A6300` |
| **HeaderPillButton** | primary / neutral | `icon?`, `label` | h36 pad 0/12/0/8 r999 12/600; primary `#5B5CE2` / `#fff`; neutral `#fff` / `#6B6860` + shadow `0 1px 2px rgba(27,25,23,.06)` |
| **InlineSuggestionRow** | `psychology` + text + CTA | `text`, `onAccept`, `onDismiss` (missing) | 13/19 `#6B6860`, icon 18 `#5B5CE2`, CTA `#4547C9` 600 |
| **AssuranceFooter** | `verified_user` + text | `text` | Icon 18 `#1E7A47`, 13/19 `#6B6860` |
| **OutlineAddButton** | add + label | `label` | h48 r14 `#fff` `#4547C9` 14/600 icon 20 |
| **VoiceOrb** | Ring, inner ring, core | `level`, `state` | 120 ring `rgba(255,255,255,.14)`, inset 14 `rgba(255,255,255,.18)`, core 80 `#fff`, mic 36 `#25266A`; small 64 / mic 30 |
| **VoiceWaveform (large)** | 22 bars | `levels[]` | 4px r2 `rgba(255,255,255,.85)`, h 10–40, container 44 |
| **VoicePromptChip** | on gradient | `label` | h36 px14 r999 `rgba(255,255,255,.12)` 13/500 `#fff` |
| **GradientNightScreen** | Voice background | — | 180deg `#15153A` 0% → `#25266A` 70% (token says 60%) → `#3B3CA8` 100% |
| **Toast** (interactive prototype) | icon + text (+ Geri al, needed) | `message`, `icon`, `action?` | `#1A1917` r999 p12/18/12/14 14/500, icon 18 `#A9AAF5`, shadow `0 10px 30px rgba(27,25,23,.25)`, 2.6 s |

---

## Open issues / inconsistencies

1. **"Today" date is inconsistent in the fixtures.**
   - 5.1 day strip marks "Cum 5" as today.
   - `WEEK.today` and 07/7.6 say "5 EYLÜL CUMARTESİ". In 2025, 5 Sept is Friday; in 2026 it is Saturday.
   - 5.2 range "7–13 EYLÜL" with Pzt start matches **2026** (7 Sept 2026 is Monday), but 5.3 "ÇARŞAMBA · 10 EYLÜL" matches **2025** (10 Sept 2026 is Thursday).
   - The day strip numbers 1–7 do not match a 7–13 week.
   - Production must compute everything from real dates in Europe/Istanbul (§39). Demo fixtures should use relative dates.
2. **Mehmet meeting time conflicts:** 14:30 in 5.1, 5.4, 5.7, 6.7 vs **14:00** in the 5.2 conflict card and 5.3. The 6.8 "ETKİNLİK TAŞI" uses 14:30 → 16:30, while the interactive prototype has "16:00'ya al" with a different rationale ("takvimin uygun" vs "16:00 dolu, 16:30 boş").
3. **5.3 option 3 copy is logically false:** "14:00–14:30 · Doktora zamanında yetişirsin", but the doctor is at 14:30 with 38 dk travel. Option 1 claims clinic availability ("Klinikte 15:45 boş görünüyor") with no possible source, which violates §83. The app also cannot move a third-party booking.
4. **Travel-time card** (5.2 "Kadıköy → Nişantaşı · 38 dk trafik tahmini") has no defined origin or ETA provider. §20: "Seyahat süresi kaynakta yoksa uydurma." It needs a routing API credential plus a location permission or saved address; otherwise the card must degrade.
5. **"Planla" flow:** primary (and the interactive prototype) show a one-tap direct plan with a success toast. §19 requires proposed block → user approval → calendar update → updated timeline. Use the restyled secondary proposal sheet as the approval step.
6. **Proposal ambiguity:** the card proposes "Yarın 14:00–16:30 (2,5 saat)", while the timeline shows a *today* 16:00 AI block "Teklif hazırlama · 45 dk". It is unclear whether the proposal is the whole window or a 45-dk block inside it. Also, today's "Revize teklif" is due 17:00, so tomorrow's slot would be too late.
7. **Day timeline gap label:** "12:00 2 saat boşluk", but free time spans 11:30–14:30 (3 h) after the 30-dk review. Gap computation and labels must be deterministic.
8. **Plan lacks tasks and commitments** on the timeline (§19 "Calendar + tasks + commitments"), all-day items, overlap rendering, and an Event Detail screen. It also has no Profile avatar (§8) and no "Taahhütler" entry (secondary has both).
9. **Day-strip dot semantics are undefined:** past `#E0DED7`, today `#A9AAF5`, next day `#5B5CE2`, Sunday none. Define them (e.g. "has events" vs "has AI proposal") or drop them.
10. **Week chart semantics are undefined:** "Odak" (focus) minutes vs free time, the hot-day threshold, px/hour scale, and the "18 etkinlik" scope. Legend "Yoğun" = `#F3B7AE`, but the hot day's second bar is `#E0553F` (not in the legend).
11. **Meeting Prep §21 gaps:** no meeting-link external handoff (secondary "Toplantıyı Başlat" covers it, but its "Meet'i Aç" button is dead); no "İlgili dosyalar" section (Teklif v2.pdf appears only in 5.6 sources); no visible source affordance on the talking points; no tap affordance on the mail rows; group meetings not addressed.
12. **Conflicting fixture narrative:**
    - Both Mehmet (5.4, 6.7) and Ahmet (6.2, 07) "expect a revised offer today 17:00".
    - Post-meeting says "Mehmet'e **yarın** teklif göndereceğim" although the prep says it was due today 17:00.
    - Legal review ownership flips: 5.4/5.6 "hukuk yorumu bekliyor" (unspecified), 6.7 "Sözleşme hukuk yorumu (Mehmet tarafı)", 5.7 user asks "hukuktan" (user's side).
    - Demo seed data must be coherent (§89).
13. **Person naming:** primary uses "Mehmet Yılmaz" (Yılmaz Endüstri) and "Ahmet Yılmaz" (Kuzey Lojistik); secondary uses "Mehmet Kaya" and "Ahmet Yılmaz" (Müzik Prodüksiyon Ltd). Primary wins. The shared surname makes a good dedupe test case: never merge contacts by surname.
14. **§24 prompt wording:** primary "Bu hafta hangi deadline'lar var?" vs master "Bu hafta hangi son tarihlerim var?" (Turkish-first; prefer the master wording). Secondary adds "Ödenmesi gereken bir şey var mı?". Primary shows 5 prompts, matching the master list count.
15. **Composer has no send state:** the 6.1/6.2 pill shows only the mic. Add mic → send morphing and, optionally, the secondary "+" capture entry (§27 entry from Asistan).
16. **Voice approval by speech** ("“Onayla” diyerek de gönderebilirsin.") needs safety rules: card visible, strict intent grammar, audit `approved_via`. "İptal" (6.4, no learning signal) vs "Reddet" (6.8, learning signal) semantics must be encoded as distinct `rejection_reason`s.
17. **Approval cards lack the §33-required "source" and "destination/account"** fields. Only pending plus today's approved are shown; executing, failed and expired are not. The "Geçmiş" screen is not designed. "Onaylananlar geçmişte 30 gün saklanır" conflicts with or needs reconciling against the §41 retention default of 90 days and audit-log needs.
18. **Status bar times contradict content:** 6.8 at 9:41 shows "ETKİNLİK TAŞI 12:12" and "Ahmet'e yanıt gönderildi 15:48". 6.8's bill reminder "13 Eylül 10:00 / son ödeme 15 Eylül" vs the interactive prototype and secondary "Elektrik faturası · 1.842 TL · 10 Eyl".
19. **"%92 eşleşme"** (6.5) is not a calibrated confidence (vector similarity ≠ probability). Define the metric (rerank or grounding verifier) or replace it with qualitative wording. The "%70 altında “emin değilim”" rule needs a defined score.
20. **Call data is implied** ("Görüşme notu", "Telefon görüşmesi · 12 dk", "1 Eyl · Telefon", "Aramaları hatırlat") but there is no telephony source (§91). Treat these as user notes only; do not imply call logs on iOS.
21. **"Satın alma müdürü" (job title)** needs a source (People API or signature parsing with confidence); otherwise hide it.
22. **6.9 mixes three concerns:** learned preferences (§32), explicit VIP/rules ("Sen ekledin"), and settings ("Brifing 08:00…" · "Ayarlar"). §32 requires separation from explicit rules. It is missing the per-item disable and the "Etkileşimlerimden öğren" toggle. The "Kural Ekle" target is ambiguous vs Priority Rules 07 7.10.
23. **6.7 shows "Açık konu 2"** but has no Açık Konular list section (secondary has one). The Commitments list (§30 "Commitments") is not shown as its own section.
24. **VIP suggestion** has only "Evet", with no dismiss. VIP list meta ("Mesaj ve takvim öncelikli", "Aramaları hatırlat", "Aynı gün yanıt beklenir") implies per-VIP policies not specified in §30/§31.
25. **Token drift:**
    - Voice gradient middle stop 70% vs token gradient/night 60%.
    - 5.2 icon colors use text tokens (`#9A6300`, `#2262BE`, `#C7432F`) rather than the icon tokens in 01 (`#E09A1C` warning, `#3B82E6` info, `#E0553F` critical).
    - Bottom-sheet row min-height 60 (05) vs 52 (interactive prototype).
    - Suggested-prompt icon `arrow_outward` vs the secondary chevron.
26. **Accessibility (§92) contrast failures** in the primary palette (WCAG 2.x, computed):
    - ink/tertiary `#9B978E` on `#F5F4F0` = **2.65:1**, and on `#fff` = **2.91:1**, used for meta, kickers and the time gutter at 11–12px.
    - Dark tertiary `#7A776F` on `#1F1E1B` = **3.73:1**.
    - Critical badge `#C7432F` on `#FCEDE9` = **4.31:1** at 11px.
    - Chevron `#C9C5BC` on `#fff` = 1.72:1 and `#B8B4AA` = 2.07:1 (decorative only).
    - Candidate fixes: tertiary `#736F67` (4.54:1 on `#F5F4F0`) or `#716D65` (4.68:1); dark tertiary `#8F8B83` (4.91:1 on `#1F1E1B`); critical text `#B53A27` (5.12:1 on `#FCEDE9`). Needs a design sign-off (§124 no-redesign rule: document in DESIGN_AUDIT.md).
    - The 5.5 caption's "kontrast 9:1" is actually **5.96:1**.
27. **Dark mode coverage:** only 5.1D, 5.5 and 6.1D are specified. Dark variants for 5.2, 5.3, 5.6 (paper), 5.7, 6.2 and 6.5–6.9 must be derived from the 01 DARK tokens (`bg #141311`, `surface #1F1E1B`, `surface-2 rgba(255,255,255,.08)`, `text #F2F0EB`, `secondary #A39F96`, `tertiary #7A776F`, `primary #8586F2`, `primary-glow #A9AAF5`, `critical-text #F08B78`, `warning-text #F0B85A`, `success-text #6FCF97`, `on-primary #0F0F2A`). The dark planned-AI-block style is also needed.
28. **Post-meeting privacy:** 5.7 depicts an already-listening mic. Production should require an explicit tap to record. The audio should not be stored by default (transcript only), and retention for transcripts follows §41.
29. **Pro/Free gating** is not shown on any 05/06 artboard, although Meeting Prep, Commitments, AI Memory, VIP, advanced planning and Voice Briefing are Pro (§44). Voice assistant mode gating is undecided.
30. **Missing-screen list** (needed by the interactions above, not designed in primary):
    - Event Detail.
    - Plan Proposal Approval sheet (secondary-derived).
    - Note composer sheet ("Not Al").
    - Commitment edit sheet.
    - Contact picker ("Kişi Ekle").
    - VIP edit sheet.
    - Approval history ("Geçmiş").
    - Type-specific approval edit sheets.
    - Global Search idle state (recents and examples, secondary-derived).
    - Source ("Bu nereden çıktı?") sheet.
    - Attachment viewer.
    - Voice permission-denied, idle and processing states.
31. **Commitments (§18) and Universal Capture (§27) are not in 05/06.** Their primary designs are 04 4.8 and 4.10/4.11. Secondary CommitmentTracker (Ertele sheet, status badges) and UniversalCapture (+ entry from Asistan) supply IA only; all their success/analysis states are fake.

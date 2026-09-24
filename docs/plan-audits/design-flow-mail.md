# Audit: PRIMARY/"04 Akis ve Mail.dc.html", compared with SECONDARY flow/cards/reminder/approval

## Scope and file facts
- File: `PRIMARY/04 Akis ve Mail.dc.html`: 139,833 bytes, 642 lines. The template sits on lines 9–581. The data script (lines 582–639) holds the arrays `T`, `TD`, `FEED`, `CATS`, `FOLLOW`, `WAIT`, `COMMITS`, `LIFE` and `Component.renderVals()`, which returns `feed`, `feedDark`, `mailCats`, `follow`, `waiting`, `commits`, `life`, `spin` and `spinRow`.
- The file has 23 artboards: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12a–d, 4.13a–d and 4.14a–d. Every artboard is a 390×844 phone with frame radius 44 and canvas background `#ECEAE4`.
- The file is static. It has no onClick handlers. The interactive versions of Akış, Mail Detayı, AI Yanıt, the reminder sheet and the approvals list live in `PRIMARY/Dijital Asistan.dc.html`, which I cross-read for behaviour.
- **Swipe spec** lives in `PRIMARY/08 Durumlar Widgetlar Etkilesimler.dc.html` (lines 98–101 and MOTION on line 133).
- **Empty and error copy** for follow-ups, approvals and OAuth is in the same file 08, lines 117–127.
- Page title: **"04 · Akış ve Mail Zekâsı"**.
- Page thesis (verbatim): "Akış bir gelen kutusu değil, dikkat akışıdır: tüm kaynaklardan gelen sinyaller tek kart kalıbında (kaynak · rozet · başlık · AI özeti · aksiyon). Ham mail metni hiçbir listede görünmez; yalnızca mail detayında “Orijinal Mail” altında açılır. Her AI çıkarımının altında kaynak satırı vardır."
  - **Global rule 1:** no raw mail body appears in any list.
  - **Global rule 2:** every AI inference has a source line under it.
- Design calendar is **2025**: Friday 5 September 2025 is "today". Checks: "Per 11 Eyl" is a Thursday, "13 Eylül Cumartesi" is a Saturday and "Pazartesi · 8 Eyl" is a Monday, all in 2025. Production must compute weekdays from real dates (today is 2026-09-23).

## Global tokens used in this file (all match `01 Tasarim Sistemi`)

**Fonts**
- Geist 300–700 for all UI.
- Lora italic only for commitment quotes (4.8).
- Material Symbols Rounded for icons, at opsz 20–48, wght 300–600, FILL 0/1.
- Filled icons use `font-variation-settings:'FILL' 1`: active tab `dynamic_feed`, `auto_awesome`, `check_circle`, `star`, `verified_user`.

**Colors, light**

| Token | Hex |
|---|---|
| bg | `#F5F4F0` |
| surface | `#FFFFFF` |
| surface-2 / icon tile / neutral badge | `#F0EFEB` |
| hairline | `#E9E7E1`, or `rgba(27,25,23,.06)` for borders |
| ink | `#1A1917` |
| secondary | `#6B6860` |
| tertiary | `#9B978E` |
| chevron / disabled ring | `#C9C5BC` |
| brand primary | `#5B5CE2` |
| brand soft | `#EDEDFC` |
| brand text-on-soft / link | `#4547C9` |
| AI highlight row | `#F7F7FE` |
| critical soft / text / icon | `#FCEDE9` / `#C7432F` / `#E0553F` |
| warning soft / text / icon | `#FDF2DC` / `#9A6300` / `#E09A1C` |
| success soft / text / icon | `#E4F5EA` / `#1E7A47` / `#2FA062` |
| info soft / text | `#E7F0FD` / `#2262BE` |
| sheet grabber | `#E0DED7` |
| spinner track | `#D9D6F7` |

**Colors, dark (4.2 plus the 01 DARK table)**
- bg `#141311`, surface `#1F1E1B`, surface-2 `rgba(255,255,255,.08)`.
- Text `#F2F0EB` / `#A39F96` / `#7A776F`.
- primary-glow `#A9AAF5`, card ring `0 0 0 1px rgba(255,255,255,.06)`.
- Dark badges (`TD`): critical `rgba(224,85,63,.18)` / `#F08B78`; warning `rgba(217,139,11,.18)` / `#F0B85A`; neutral `rgba(255,255,255,.08)` / `#A39F96`.

**Badge tone map (`T`)**
- critical `['#FCEDE9','#C7432F']`
- warning `['#FDF2DC','#9A6300']`
- neutral `['#F0EFEB','#6B6860']`
- success `['#E4F5EA','#1E7A47']`
- info `['#E7F0FD','#2262BE']`

**Shadows**
- Card: `0 1px 2px rgba(27,25,23,.04), 0 6px 20px rgba(27,25,23,.05)`
- Small control: `0 1px 2px rgba(27,25,23,.06)`
- Circle nav button: `0 1px 2px rgba(27,25,23,.08)`
- Primary CTA glow: `0 8px 24px rgba(91,92,226,.28)`
- Sheet: `0 -10px 40px rgba(27,25,23,.12)`
- Toast: `0 10px 30px rgba(27,25,23,.25)`
- Segmented selected pill: `0 1px 3px rgba(27,25,23,.12)`

**Radii**
- Icon tiles: 9, 10, 11 and 14.
- Inline buttons 12; buttons 14/16; cards 18/20; sheet top 28; pills 999.

**AI card surface**
- `radial-gradient(140% 100% at 0% 0%, #E4E4FA 0%, #FFFFFF 60%)`, radius 20, padding 16.
- Kicker: `auto_awesome` icon 16 (FILL 1) plus 12/600 +.06em text in `#5B5CE2`.

**Shared chrome**
- Status bar 54h: "9:41" in light, "21:14" in dark. Not needed natively.
- Tab bar: 90h, padding 8/8/28, `rgba(255,255,255,.92)` with blur 20, top border `rgba(27,25,23,.06)`. Icons 26, labels 11/500.
  - Active tab `#5B5CE2` (dark `#A9AAF5`); inactive `#9B978E` (dark `#7A776F`).
  - Tabs: Bugün (`sunny`), Akış (`dynamic_feed`), Plan (`calendar_today`), Asistan (`auto_awesome`).
- Sub-page header: 36px white circle buttons (`arrow_back`, `close`, `search`, `more_horiz`, icon 20). Optional centered kicker 12/600 +.08em `#9B978E` caps. Page padding `6px 20px`.

---

### Akış · Tümü / Flow · All (light)
- **Source:** PRIMARY / 04 / artboard **4.1 "Akış · Tümü"**. Interactive version: `Dijital Asistan.dc.html`, lines 150–180, with FEED on line 699.
- **Purpose:** root tab 2. A unified smart attention feed of signals from every source, one card template, sorted by urgency then time.

**Layout, top to bottom**
1. Title row, padding 0 20:
   - "Akış" at 28/34, weight 600, −.02em.
   - Right: **"Ekle"** pill: 36h, padding 0 12 0 8, radius 999, bg `#fff`, text `#4547C9` 12/600, icon `add_a_photo` 18, small-control shadow.
2. Filter chip row: horizontal scroll, gap 8, padding 0 20.
   - Chip: 34h, padding 0 14, radius 999, 13/600.
   - Selected: `#1A1917` bg, `#fff` text. Unselected: `#fff` bg, `#6B6860` text.
3. Meta line: 13px `#6B6860`.
4. Card list: gap 12, padding 0 20 16. **AttentionCard**:
   - Card: `#fff`, radius 20, padding 14/16/10, card shadow.
   - Row 1, gap 8: icon tile 28×28 radius 9 `#F0EFEB` with `#6B6860` symbol at 17px · source text 12px `#9B978E` (flex 1, ellipsis) · badge 11/700 +.05em, padding 3/8, radius 999, tone colors · time 12px `#9B978E`.
   - Title: margin-top 10, 16/22, weight 600, −.01em, `text-wrap:pretty`.
   - Summary: 14/20 `#6B6860`.
   - Action: text button 14/600 `#4547C9`, padding-top 8. In the prototype it is a 36h button with hover `#EDEDFC`.
5. Tab bar with Akış active.

**Exact copy**
- "Akış", "Ekle"
- Filters: "Tümü", "Önemli", "Mail", "Takvim", "Takip", "Kişisel"
- Meta: "10 konu · 5 önemli · Son analiz 09:40"
- Footnote: "Sıralama: aciliyet → zaman. Renkli rozet yalnızca ACİL, SON TARİH ve GÜVENLİK için; diğer rozetler nötr. Sağa kaydırma: Tamamlandı, sola kaydırma: Ertele / Önemli değil."

**Data: the 10 FEED cards, in order**

| # | icon | src | time | title | sum | action | badge / tone | §13 type |
|---|---|---|---|---|---|---|---|---|
| 1 | mail | Gmail · Ahmet Yılmaz | 08:42 | Revize teklif bugün 17:00'ye kadar bekleniyor | Ahmet, fiyat ve teslim tarihini güncellenmiş PDF olarak istiyor. | Yanıtla | ACİL / critical | Email |
| 2 | event | Google Takvim | 14:30 | Mehmet ile müşteri toplantısı | Son görüşmeniz 4 gün önceydi. Açık 2 konu var. | Hazırlan | BUGÜN / neutral | Meeting |
| 3 | schedule_send | Gmail · Mehmet Yılmaz | 3 gün | Teklif mailine cevap gelmedi | 2 Eylül'de gönderildi. Henüz yanıt yok. | Takip Mesajı Hazırla | TAKİP / neutral | (Follow-up, extra type) |
| 4 | mail | Gmail · Girişim Programı | Dün | Başvuru bugün 17:00'de kapanıyor | Son gün. Form yaklaşık 10 dakika sürüyor. | Takvime Ekle | SON TARİH / warning | Deadline |
| 5 | shield | Google | 07:12 | Google hesabında yeni giriş | Chrome · Windows · İstanbul. Sen değilsen şifreni değiştir. | Kontrol Et | GÜVENLİK / critical | Security |
| 6 | handshake | Taahhüt · Toplantı notu | Yarın | Mehmet'e teklif gönder | “Yarın göndereceğim” dedin. Plan'da 14:00 bloğu önerildi. | Planla | TAAHHÜT / neutral | (Commitment, extra type) |
| 7 | package_2 | Kargo · Trendyol | Bugün | Siparişin bugün geliyor | Teslimat aralığı 14:00–18:00. | Takip Et | KARGO / neutral | Shipment |
| 8 | flight | THY | Yarın 09:15 | TK2412 · İstanbul → Antalya | Online check-in açıldı. 06:45'te evden çıkman gerekebilir. | Check-in | UÇUŞ / neutral | Flight |
| 9 | receipt_long | CK Enerji | 10 Eyl | Elektrik faturası · 1.842 TL | Son ödeme günü 10 Eylül. | Hatırlat | ÖDEME / neutral | Payment |
| 10 | autorenew | Netflix | 9 Eyl | Netflix 9 Eylül'de yenilenecek | Aylık 229,99 TL. Son 30 günde 2 kez izlendi. | İncele | ABONELİK / neutral | Subscription |

The Reservation type appears only in 4.2 and in the prototype FEED: "Rezervasyon · Karaköy Lokantası", "Cmt 20:30", "Akşam yemeği rezervasyonu", "4 kişi. Teyit için 18:00 son saat.", action "Teyit Et", badge REZERVASYON.

**Implied entity `attention_items`:**
- id, kind (email | meeting | deadline | follow_up | commitment | shipment | flight | reservation | payment | subscription | security)
- filter_bucket (mail | calendar | followup | personal), is_important (the prototype's `imp` flag; "5 önemli" = ACİL, BUGÜN, TAKİP, SON TARİH, GÜVENLİK)
- priority_score, urgency_at, badge_code, badge_tone, icon, source_label, display_time, title, ai_summary
- primary_action {type, label, payload}
- state (active | done | snoozed | dismissed), snoozed_until
- provenance: source_type, source_id, source_provider, source_timestamp, confidence, reason_code, reason_text
- feed_meta: total_count, important_count, last_analysis_at ("Son analiz 09:40" comes from the last successful `sync_runs` / analysis job).

**Interactions and the production behaviour each needs**
- Tabs: root navigation.
- **"Ekle"**: open the Universal Capture composer as a full-screen modal (4.14a base state). The prototype shows a fake toast here ("Ekran görüntüsü, PDF veya link ekle · Bkz. 04 Akış"). Do not copy it.
- Filter chips: set the filter. The query is scoped by `filter_bucket`; "Önemli" means `is_important`.
  - Meta counts become filter-scoped ("6 konu · 1 önemli" in 4.2).
  - Persist the last filter per viewer (local convenience only).
  - Prototype logic: `akisFilter==='Tümü' || (Önemli ? f.imp : f.cat===filter)`.
- Card body tap, by kind:
  - email / deadline → **Mail Detayı (4.4)**
  - meeting → Meeting Prep (§21, file 05)
  - follow_up → Takip list (4.6), focused on the item
  - commitment → Taahhütler (4.8), focused
  - security → Security detail sheet (NOT DESIGNED; see missing states)
  - shipment, flight, reservation, payment, subscription → Life item detail (NOT DESIGNED; minimum is the source mail detail with a typed header)
- Card action, by kind:
  - "Yanıtla" → AI Reply (4.5) for that thread. The prototype goes to Mail Detail; pick one and document it.
  - "Hazırlan" → Meeting Prep.
  - "Takip Mesajı Hazırla" → 4.5 in follow-up mode.
  - "Takvime Ekle" → build a `calendar_create` approval and show the approval sheet (4.12d pattern). The prototype instead calls `addApproval` and toasts "Onay Merkezi'ne eklendi". Either is valid, but it must be a real `approval_requests` row.
  - "Kontrol Et" → security sheet with "Bendim" / "Şifreyi Değiştir".
  - "Planla" → task / time-block approval in Plan (`task_create`, plus a `calendar_create` if a block is placed).
  - "Takip Et" (cargo) → external handoff to the carrier tracking URL taken from the source email (domain allowlist, `expo-web-browser`).
  - "Check-in" → handoff to the airline check-in URL from the email, or the airline app.
  - "Hatırlat" → Smart Reminder sheet (4.11).
  - "İncele" → subscription detail plus source.
  - "Teyit Et" → handoff to the confirmation link or `tel:`.
  - Prototype fallback `toast(f.action+' · Kaynak açıldı')` is fake. Do not copy.
- **Swipe right → "Tamamlandı"**: state=done, optimistic update, toast with "Geri al". Full swipe applies automatically.
- **Swipe left → "Ertele"**: opens the Smart Reminder sheet in snooze mode and sets `snoozed_until`.
- **Swipe left → "Önemli değil"**: dismiss and write a learning signal to AI personalization (§32). Optionally open the correction sheet "Bunu nasıl değerlendireyim?", whose options are: Önemli değil / Bunu daha sık göster / Bu kişiyi VIP yap / Bunu takip etme.
- Swipe details: threshold 35%, 1:1 tracking, 260ms spring on release, light haptic at threshold, success haptic on done.
- Pull-to-refresh, from the 08 motion spec: a thin indigo line at the top, then "Güncel · 09:41" for 1.5s. It triggers a sync job.

**States depicted:** populated light (4.1) and populated dark with the Kişisel filter (4.2).

**States missing (production needs):**
- Skeleton loading, using real card dimensions (08: "İskelet gerçek kart ölçülerinde; başlıklar anında, AI içeriği sonra dolar", shimmer 1.6s).
- Empty state per filter:
  - Tümü: 08 copy "Her şey kontrol altında."
  - Takip: "Bekleyen takip yok." / "Gönderdiğin her maile yanıt geldi. Yeni bir gecikme olursa buraya düşer."
  - Takvim when no calendar is connected: needs a "Takvimi Bağla" CTA.
  - Kişisel: needs copy.
- Error banners from 08:
  - OAuth expired: "Gmail bağlantısı yenilenmeli." / "Google oturumu süresi doldu. Yeniden bağlanana kadar yeni mailler analiz edilmez." / "Yeniden Bağlan" · "Sonra"
  - Sync delayed: "Senkronizasyon gecikti." / "Son başarılı analiz 09:40. Yeniden deniyoruz; gösterilenler 12 dakika eski olabilir." / "Şimdi Dene" · "Tamam"
  - AI unavailable: "Asistan şu an yanıt veremiyor."
- Offline: cached feed plus a banner; write actions queued or blocked.
- Partial: provider A synced, provider B failed.
- Stale "Son analiz" timestamp.
- New-items indicator and pagination / infinite scroll.
- Card-level AI failure: fall back to subject plus "Özet hazırlanamadı".
- Per-card "Neden önemli?" explainability.
- Profile avatar entry (§8). The Akış header has none; secondary has a "Y" avatar.
- Large-text and a11y variants.

**Prototype-only, do not copy:**
- Static data.
- The fake capture toast.
- `toast(... 'Kaynak açıldı')` fallbacks.
- The 12px left-offset hover styling is web-only.
- Placeholder hatched boxes.

**Maps to:** §13, §8, §31, §93, §94, §97, §99, §123, §131, §132.

---

### Akış · Kişisel filtresi · Dark / Flow · Personal filter (dark)
- **Source:** PRIMARY / 04 / **4.2 "Akış · Kişisel filtresi · Dark"**, data from `feedDark`.
- **Purpose:** shows the Kişisel (life intelligence) filter and dark-mode tokens for the feed.

**Layout (4.1 structure, dark tokens)**
- Background `#141311`, text `#F2F0EB`.
- "Ekle" pill: bg `#1F1E1B`, text `#A9AAF5`, ring `0 0 0 1px rgba(255,255,255,.08)`.
- Chips: unselected `#1F1E1B` / `#A39F96`; selected **"Kişisel"** `#F2F0EB` / `#141311`.
- Meta line in `#A39F96`.
- Card: `#1F1E1B` with ring `rgba(255,255,255,.06)`; icon tile `rgba(255,255,255,.08)` / `#A39F96`; source and time `#7A776F`; summary `#A39F96`; action `#A9AAF5`.
- Tab bar: `rgba(20,19,17,.92)`, top border `rgba(255,255,255,.08)`, active `#A9AAF5`, inactive `#7A776F`, home indicator `rgba(255,255,255,.4)`.

**Copy**
- "Akış", "6 konu · 1 önemli". There is no "Son analiz" in dark; inconsistent with 4.1.
- Footnote: "Kişisel filtre = yaşam zekâsı: kargo, uçuş, ödeme, abonelik, rezervasyon, güvenlik. Aynı kart kalıbı; yalnızca ikon değişir."

**Data:** the FEED cards with badges GÜVENLİK, KARGO, UÇUŞ, ÖDEME, ABONELİK, plus the reservation card ("restaurant", "Rezervasyon · Karaköy Lokantası", "Cmt 20:30", "Akşam yemeği rezervasyonu", "4 kişi. Teyit için 18:00 son saat.", "Teyit Et", REZERVASYON). Only GÜVENLİK is colored, critical dark.

**Interactions:** same as 4.1. Kişisel maps to `filter_bucket='personal'` = life_events kinds.

**States depicted:** dark, populated.

**Missing:**
- Kişisel empty state: no life signals yet, with an explanation that they are derived from mail.
- Permission / partial state explaining that signals come only from connected mail. Notifications are an Android-only source (§36).

**Fake / do not copy:** none beyond static data.

**Maps to:** §13, §23, §38.

---

### Mail Zekâsı / Mail Intelligence
- **Source:** PRIMARY / 04 / **4.3 "Mail Zekâsı · Gelen kutusu yerine anlama"**.
- **Purpose:** daily mail comprehension overview. It tells a "83 → 6" story, then fixed categories, then the top important mails.

**Layout, top to bottom**
1. Nav row: back circle · kicker **"MAİL ZEKÂSI · BUGÜN"** · search circle.
2. Hero, padding 6 0:
   - "83" at 44/48, weight 600, −.03em, plus "mail geldi" 17px `#6B6860`, baseline aligned.
   - Headline 22/28, weight 600, −.02em: "**6** tanesi dikkat gerektiriyor.", where "6" is `#5B5CE2`.
   - Sub 14/20 `#6B6860`.
3. Stacked bar: 8h, radius 4, gap 2. Segments: 7% `#5B5CE2` (dikkat) / 37% `#C9C7F3` (bilgi) / 53% `#E9E7E1` (düşük).
4. Category grouped-list card: `#fff`, radius 18, padding 4/16, card shadow.
   - Rows: padding 12 0, hairline between rows.
   - 30×30 radius 10 tile. Hot rows: `#EDEDFC` / `#4547C9`; others: `#F0EFEB` / `#6B6860`.
   - Label 15/500, flex.
   - Count 15/600. Hot `#5B5CE2`, else `#6B6860`.
   - `chevron_right` 18 `#C9C5BC`.
5. Kicker **"ÖNEMLİ · 3"**.
6. Three MailSummaryCards:
   - Card: radius 20, padding 14/16/10.
   - Avatar 28 circle with initials 11/600, name 13/600, optional badge, time 12 `#9B978E`.
   - Body 15/21.
   - Action 14/600 `#4547C9`.

**Exact copy**
- "MAİL ZEKÂSI · BUGÜN", "83", "mail geldi", "6 tanesi dikkat gerektiriyor."
- "77'sini senin için okudum; 44'ü düşük öncelikli, 31'i bilgilendirme."
- Categories (CATS):

| Category | Icon | Count | Hot |
|---|---|---|---|
| Önemli | priority_high | 3 | yes |
| Senden cevap bekleyen | person | 2 | yes |
| Senin cevap beklediğin | schedule_send | 1 | no |
| Son tarih içeren | flag | 2 | no |
| Bilgilendirme | info | 31 | no |
| Düşük öncelik | low_priority | 44 | no |

- Cards:
  - "AY" (`#F5E1D6` / `#7A3E1F`) "Ahmet Yılmaz", **ACİL**, "08:42": "Revize fiyat teklifini bugün 17:00'ye kadar PDF olarak istiyor." → **"Yanıt Hazırla"**.
  - "SK" (`#E3EFE6` / `#1E5A36`) "Selin Kaya", no badge, "Dün 15:40": "Sözleşme taslağının 4. maddesi için yorumunu bekliyor; yarın öğlen hukuka gidecek." → "Yanıt Hazırla".
  - "GP" (`#F0EFEB` / `#6B6860`) "Girişim Programı", **SON TARİH** (warning), "Dün": "Başvuru bugün 17:00'de kapanıyor; form yaklaşık 10 dakika." → **"Takvime Ekle"**.
- Footnote: "Büyük sayı yalnızca burada: 83 → 6 hikâyesi. Bant grafiği üç dilim (dikkat / bilgi / düşük). Kategoriler sabit; boş kategori sayısı 0 olur, gizlenmez."

**Data → entities**
- `mail_daily_digest` {date, total_received=83, attention_count=6, read_by_ai=77, low_priority=44, informational=31, band_pct[]}.
- `email_classifications` {message_id, category ∈ important | awaiting_my_reply | awaiting_their_reply | has_deadline | informational | low_priority, priority, reason_code, reason_text, confidence, rule_id (explicit rule), classifier ∈ rule | learned | metadata | ai}. §14 requires source, confidence, reason and deterministic rules to be separable.
- `emails` {sender_name, sender_email, avatar_initials, received_at, subject, ai_one_liner, badge}.

**Interactions**
- Back: pop.
- Search: mail / memory search (§95). The screen is not designed in 04.
- Category rows:
  - "Senden cevap bekleyen" → **Senden Beklenenler (4.7)**.
  - "Senin cevap beklediğin" → **Takip Etmen Gerekenler (4.6)**.
  - The other four → a category mail list screen. This is NOT DESIGNED in primary. Build it from the 4.3 card pattern plus MailSummaryCard.
  - A category with 0 items still shows and opens an empty list.
- Mail card tap → Mail Detayı (4.4).
- "Yanıt Hazırla" → AI Reply (4.5).
- "Takvime Ekle" → `calendar_create` approval sheet.
- Bar: not interactive.

**Entry point:** MISSING in primary Akış. Secondary has a "Mail Özeti" pill in the Flow header. Options: add a restyled header affordance to Akış, or make the "Mail" filter show a digest header row that links here.

**States depicted:** populated only.

**Missing:**
- Loading (the digest is being computed).
- Empty day: "Bugün henüz mail yok".
- Mail not connected: secondary "Mailini bağla." / "Gmail veya Outlook bağlayarak önemli konuları burada görebilirsin."
- OAuth expired.
- Partial (analysis still running: "83'ün 40'ı analiz edildi").
- Multi-account breakdown (Gmail plus Outlook).
- Date or range switcher (the kicker says "BUGÜN").
- Dark.

**Fake:** hard-coded counts. The arithmetic is inconsistent; see Open issues.

**Maps to:** §14, §31, §93, §95, §97, §131.

---

### Mail Detayı / Email Detail
- **Source:** PRIMARY / 04 / **4.4 "Mail Detayı · AI özeti önce"**. Interactive version: `Dijital Asistan.dc.html`, lines 422–462.
- **Purpose:** AI-summary-first view of one mail thread, with suggested actions and the original behind an accordion.

**Layout, top to bottom**
1. Nav: back circle. Right group: **ACİL** badge (padding 4/9) plus a `more_horiz` circle.
2. Sender row, gap 12:
   - Avatar 44 "MY" (`#DCE4F5` / `#2B3F73`, 15/600).
   - Name 16/600 "Mehmet Yılmaz" plus `star` 16 FILL `#5B5CE2` (VIP).
   - Meta 13 `#6B6860`: "Bugün 08:42 · Gmail · Sana".
3. Subject: 22/28, weight 600, −.02em.
4. AI card: kicker "AI ÖZETİ"; summary 17/24 weight 500; kicker "ÖNEMLİ NOKTALAR" 12/600 +.06em `#9B978E`; three bullets with 6×6 `#5B5CE2` dots, 14/20.
5. Kicker "ÖNERİLEN AKSİYONLAR".
6. 2×2 grid, gap 10. Buttons 56h, padding 0 14, radius 16, 14/600, icon 20.
   - Primary: `#5B5CE2` bg, `#fff` text.
   - Others: `#fff` with a `#5B5CE2` icon and small-control shadow.
7. "Orijinal Mail" accordion card, radius 18:
   - Header 52h: `mail` icon 20 `#6B6860` plus "Orijinal Mail" 15/600; `expand_less` 22 `#9B978E` (shown expanded).
   - Body: padding 12/16/16, 14/21, `pre-wrap`, top hairline.
8. Source line: `verified` 16 plus 12px `#9B978E`.

**Exact copy**
- "ACİL", "Mehmet Yılmaz", "Bugün 08:42 · Gmail · Sana", "Re: Eylül teklifi – revize fiyat"
- "AI ÖZETİ", "Mehmet revize fiyat teklifinin bugün 17:00'ye kadar gönderilmesini istiyor."
- "ÖNEMLİ NOKTALAR": "Revize fiyat", "Deadline 17:00", "PDF gönderilecek"
- "ÖNERİLEN AKSİYONLAR": **"Yanıt Hazırla"** (`edit_note`, primary), **"Görev Oluştur"** (`add_task`), **"Takvime Ekle"** (`event`), **"Hatırlat"** (`notifications`)
- "Orijinal Mail" body: "Merhaba Yunus,\n\nGeçen hafta konuştuğumuz teklifi revize edebilir misin? Yönetim bugün saat 17:00'ye kadar güncellenmiş fiyatı PDF olarak görmek istiyor. Teslim tarihini de netleştirsek iyi olur.\n\nTeşekkürler,\nMehmet"
- "Kaynak: Gmail · mehmet.yilmaz@… · Gelen Kutusu · Konu dizisi 4 mail"
- Footnote: "Sıra: kim · konu · AI özeti · aksiyonlar · orijinal. Orijinal mail varsayılan kapalı ama her zaman bir dokunuş uzakta; kaynak satırı en altta sabittir."

**Data → entities**
- `email_messages` {provider=gmail, account_id, provider_message_id, thread_id, from_name, from_email (masked "mehmet.yilmaz@…"), to (= "Sana"), received_at, subject, label/folder ("Gelen Kutusu"), body_text (sanitized), thread_count=4}.
- `email_ai_summaries` {message_id, summary, key_points[], model, prompt_version, confidence, generated_at}.
- `people` {vip=true}.
- `email_classifications` {badge ACİL, reason}.
- Deadline entity {due_at 17:00, source span}.

**Interactions**
- Back: pop.
- **ACİL badge tap** (add this): "Neden önemli?" sheet with reason, rule / confidence, and actions "Önemli değil" / "Bu kişiyi VIP yap" / "Kural oluştur".
- `more_horiz`: overflow sheet. Its contents are undefined; proposed: "Gmail'de Aç" (§15 "Orijinal Maili Aç"), "Neden önemli?", "Önemli değil", "Göndereni VIP yap", "Kural oluştur" (§31), "Konu dizisini gör".
- Sender row / star: Person Intelligence page (§30).
- "Yanıt Hazırla": AI Reply (4.5). Draft generation runs server-side.
- "Görev Oluştur": task sheet prefilled with title, due date from the extracted deadline, and a source link.
  - Internal-only task: create with toast + "Geri al".
  - Task synced to an external provider: `task_create` approval.
  - The sheet is not designed in primary; secondary has one.
- "Takvime Ekle": `calendar_create` approval sheet (4.12d/4.13d row pattern) prefilled with "Revize teklif son saati · Bugün 17:00" and a 30 dk reminder. The prototype used `addApproval` plus a toast.
- "Hatırlat": Smart Reminder sheet (4.11) anchored to 17:00, so "30 dakika önce" = 16:30 and "1 saat önce" = 16:00, as in the prototype.
- "Orijinal Mail" accordion: expands in place (08 motion: height 280ms, chevron rotates in 200ms).
  - Render sanitized content: no remote images by default, no JS, links open externally after confirmation.
  - The body is untrusted input for AI (§114).
- "Konu dizisi 4 mail": thread view (NOT DESIGNED).
- Source line: "Bu nereden çıktı?" opens the provider's original.
  - Gmail web URL pattern: `https://mail.google.com/mail/u/0/#all/<threadId>` or `#search/rfc822msgid:<Message-ID>` (verify).
  - Outlook: Graph `message.webLink`.

**States depicted:** populated, original expanded.

**Missing:**
- Loading (header first, AI summary shimmer).
- AI summary unavailable: show the original expanded by default plus "Özet şu an hazırlanamadı · Tekrar dene".
- Message deleted or moved at the provider.
- OAuth expired.
- Offline (cached summary; actions disabled or queued).
- Attachments list (the PDF implied by "PDF gönderilecek").
- CC/recipients.
- Long thread; HTML-heavy mail.
- Dark.

**Fake / do not copy:**
- Prototype `toastTask` ("Görev Oluştur" was only a toast).
- `toggleOriginal` is fine.
- Hard-coded body.

**Maps to:** §15, §16, §29, §30, §31, §33, §97, §114, §131.

---

### AI Yanıt Taslağı / AI Reply Draft
- **Source:** PRIMARY / 04 / **4.5 "AI Yanıt Taslağı · Onay gerektirir"**. Interactive version: `Dijital Asistan.dc.html`, lines 464–503 (includes the sent state).
- **Purpose:** Generate → Edit → Approval → Send for a reply, with four tones. It never sends silently.

**Layout, top to bottom**
1. Nav: back · kicker **"YANIT TASLAĞI"** (prototype: dynamic `replyKicker`) · 36px spacer.
2. Recipient row, 14px `#6B6860`: "Kime" plus a chip (30h, radius 999, `#fff`, 22px avatar "MY" `#DCE4F5` / `#2B3F73`, name 600). Right: "Re: Eylül teklifi" at 12px.
3. Segmented control:
   - Track: `#E9E7E1`, radius 999, padding 3.
   - Segments: 32h, 13/600. Selected: `#fff` / `#1A1917` with shadow `0 1px 3px rgba(27,25,23,.12)`. Unselected: `#6B6860`.
4. Draft card: `#fff`, radius 20, padding 18, flex 1.
   - Header: kicker "AI TASLAĞI · PROFESYONEL" plus "Düzenlenebilir" 12 `#9B978E`.
   - Body: 15/23, `pre-wrap`, 2px `#5B5CE2` caret.
   - Assist chips: 30h, radius 999, `#F0EFEB` / `#6B6860`, 12/600, icon 15.
5. Reassurance: `verified_user` 18 `#1E7A47` plus 13px.
6. CTA row, gap 10:
   - Primary: flex 1, 52h, radius 16, `#5B5CE2`, glow shadow.
   - Secondary: white, 52h, padding 0 18.

**Exact copy**
- "YANIT TASLAĞI", "Kime", "Mehmet Yılmaz", "Re: Eylül teklifi"
- Tones: "Kısa", **"Profesyonel"** (selected), "Samimi", "Detaylı"
- "AI TASLAĞI · PROFESYONEL", "Düzenlenebilir"
- Draft: "Merhaba Mehmet,\n\nTalebiniz için teşekkürler. Revize fiyat teklifini, güncellenmiş teslim tarihiyle birlikte bugün 17:00'den önce PDF formatında iletiyor olacağım.\n\nSorularınız olursa memnuniyetle yardımcı olurum.\n\nİyi çalışmalar,\nYunus"
- Chips: "Teklif_v3.pdf ekle" (`attach_file`), "Kısalt" (`short_text`)
- "Sen onaylamadan hiçbir mail gönderilmez."
- **"Göndermeyi Onayla"**, "Düzenle"
- Footnote: "Ton seçimi taslağı anında değiştirir (prototipte çalışır). Buton adı “Gönder” değil “Göndermeyi Onayla”: yazma işlemi dili her yerde onay dilidir."
- Prototype sent state:
  - Ring: 96 circle `#E4F5EA`, `check_circle` 48 `#1E7A47`, scale animation.
  - "Gönderildi", then "{replyTo} yanıtını aldı. Cevap gelince Akış'ta göreceksin." → **wrong claim**; see issues.
  - "Bugün'e Dön" (ink button).
  - Toast "Mail gönderildi · Ahmet Yılmaz".
  - Spinner while sending (`sendSpinner`, 900ms fake).

**Data → entities**
- `reply_drafts` {id, source_message_id, thread_id, to[], cc[], subject ("Re: …"), tone ∈ short | professional | friendly | detailed (+ follow_up mode), body, model, prompt_version, generated_at, edited_by_user bool, suggested_attachments[] (must reference existing files), status}.
- `approval_requests` {action_type=email_send, payload_hash, idempotency_key, status: pending → approved → executing → executed | failed}.
- Implicit **commitment**: the draft promises "bugün 17:00'den önce … iletiyor olacağım". This is a `commitment_create` candidate, which the user must confirm.

**Interactions**
- Back: if edited, confirm discard or keep ("Taslak kaydedilsin mi?"; NOT DESIGNED). Persist the draft server-side.
- Recipient chip: recipient editor for To/Cc and reply-all toggle (NOT DESIGNED).
- Tone segment: regenerate via an AI edge function.
  - Shimmer on the card (08 "AI işliyor": shimmer 1.6s, no progress bar).
  - If the user has edited, confirm overwrite.
  - The prototype swaps canned strings. Secondary does not change the text at all (fake).
- Draft body: editable multiline `TextInput`.
- "Teklif_v3.pdf ekle": show only if a matching file really exists (recent PDFs / mail attachments); otherwise open the document picker.
  - Gmail upload send supports up to ~35 MB total (verify at the Gmail API `messages.send` docs; developers.google.com was unreachable from this sandbox).
- "Kısalt": AI rewrite (shorter), then undo.
- **"Göndermeyi Onayla"**: the user's explicit approval.
  - Create `approval_requests(email_send)` with an idempotency key.
  - Server executes Gmail `users.messages.send` with `threadId` plus `In-Reply-To` / `References` headers (Graph `reply` / `createReply` + `send` for Outlook).
  - Button spinner, then a success screen whose copy reports only "gönderildi".
  - Refresh the thread and follow-up state.
  - Record in Onay Merkezi history.
- "Düzenle": focus the editor or open a full-screen editor. As designed it duplicates inline editing; the prototype's `toastEdit` is fake.

**States depicted:** draft ready (primary). Sending spinner and sent success exist in the prototype only.

**Missing:**
- Generating (first draft).
- Regenerate failure.
- AI unavailable (08 copy: "Asistan şu an yanıt veremiyor." / "…yalnızca yeni soru ve taslaklar birkaç dakika bekleyebilir.").
- Send failed (provider error, retry keeping the same idempotency key).
- OAuth expired or send scope missing.
- Offline: block send, show "Çevrimdışı · bağlantı gelince gönderilmeye hazır değil".
- Attachment too large.
- Duplicate-tap guard.
- Undo-send window (optional).
- Dark.

**Fake / do not copy:**
- 900ms fake send.
- "yanıtını aldı" (a delivery/receipt claim).
- Canned tone swaps.
- "Düzenle" toast.
- The suggested non-existent "Teklif_v3.pdf".

**Maps to:** §16, §33, §115, §83, §98, §99, §76, §75, §114.

---

### Takip Etmen Gerekenler / Smart Follow-up (you are waiting on others)
- **Source:** PRIMARY / 04 / **4.6 "Akıllı Takip · Senin cevap beklediklerin"**.
- **Purpose:** sent mails that got no reply, with next actions.

**Layout, top to bottom**
1. Back circle.
2. Title "Takip Etmen Gerekenler" 28/34, sub 14 `#6B6860`.
3. Cards (FOLLOW): `#fff`, radius 20, padding 16.
   - Header: avatar 40 (13/600); name 16/600; topic 13 `#6B6860`; days pill 26h, padding 0 9, 12/600, tone colors.
   - Status 15/21.
   - Source row: `schedule_send` 16 plus 12 `#9B978E`.
   - Buttons 38h, radius 12, 13/600: "Takip Mesajı Hazırla" (`#EDEDFC` / `#4547C9`), "Yarın Hatırlat" (`#F0EFEB` / `#6B6860`), "Kapat" (ghost `#6B6860`, right-aligned).
4. Learning hint: `psychology` 18 `#5B5CE2` plus 13/19 `#6B6860`.

**Exact copy**
- "Takip Etmen Gerekenler", "3 gönderdiğin mail yanıtsız. En eskisi 6 gün."
- Cards:

| Avatar | Name | Topic | Days pill | Status | Source |
|---|---|---|---|---|---|
| MY `#DCE4F5` / `#2B3F73` | Mehmet Yılmaz | Teklif v2 · PDF | "3 gün", amber | "Henüz yanıt gelmedi. Bugün 14:30 toplantıda konuşabilirsin." | "2 Eylül 10:05'te gönderildi · Gmail" |
| HK `#E3EFE6` / `#1E5A36` | Hukuk · Kerem Aksoy | Sözleşme taslağı yorumu | "6 gün", **coral** | "Yanıt yok. İki kez ertelendi; artık telefon etmek daha hızlı olabilir." | "30 Ağustos'ta gönderildi · Gmail" |
| DE `#F5E1D6` / `#7A3E1F` | Deniz Erol | Etkinlik konuşmacı daveti | "2 gün", neutral | "Okundu, yanıt yok. Genelde 3–4 günde döner." | "3 Eylül'de gönderildi · Outlook" |

- Buttons: "Takip Mesajı Hazırla", "Yarın Hatırlat", "Kapat"
- Hint: "Bir kişiyi “Takip etme” dersen, o kişiden bekleyen mailleri bir daha göstermem."
- Footnote: "Bekleme süresi rozeti 3 günden sonra amber, 7 günden sonra coral. “Takip Mesajı Hazırla” → 4.5 ile aynı taslak ekranı, takip tonunda."

**Data → entities**
- `follow_ups` {id, direction='awaiting_them', person_id, thread_id, sent_message_id, sent_at, provider (gmail | outlook), topic, days_waiting, status_text (AI), next_touchpoint (meeting at 14:30 → link to event), snooze_count ("İki kez ertelendi"), typical_reply_latency (computed from history: "Genelde 3–4 günde döner"), state: open | snoozed | closed | resolved_by_reply}.
- `people.follow_up_muted`.

**Interactions**
- Card tap: the sent-mail thread detail.
- "Takip Mesajı Hazırla": 4.5 in follow-up mode.
  - Tone preset: short + professional. The prototype approval says "Kısa, profesyonel ton".
  - Recipient: the original To.
- "Yarın Hatırlat": create a reminder for tomorrow morning.
  - The preset "Yarın sabah" is **08:00** (4.11). The prototype toast said "Yarın 09:00'da hatırlatırım", so pick one.
  - User-initiated: tap = confirmation. Show a toast with "Geri al".
- "Kapat": `state=closed`, toast + undo.
- "Takip etme": mute follow-ups per person. **No visible control exists.** Add it to the swipe-left "Önemli değil" path or a card overflow.
- Auto-resolve when a reply arrives (sync-driven).
- Optional "Ara" (`tel:`) handoff when a phone number is known. The copy suggests calling.
- Swipes as in 08: right = Tamamlandı, left = Ertele / Önemli değil ("Kaydırma yönleri Akış, Bugün ve Takip'te aynıdır").

**States depicted:** populated.

**Missing:**
- Empty, from 08: icon `mark_email_read` on `#E4F5EA` / `#1E7A47`, "Bekleyen takip yok." / "Gönderdiğin her maile yanıt geldi. Yeni bir gecikme olursa buraya düşer." / CTA "Tamam".
- Loading, error, offline, dark.

**Fake / risky:**
- "Okundu" (read status): Gmail/Outlook APIs do not expose recipient read state reliably. Drop it unless a real read receipt exists (§83).

**Maps to:** §17, §29, §30, §32, §83, §93.

---

### Senden Beklenenler / Awaiting Your Reply (others are waiting on you)
- **Source:** PRIMARY / 04 / **4.7 "Senden Beklenenler · Acil / Bugün / Yakında"**.
- **Purpose:** the inverse follow-up list, grouped by urgency.

**Layout**
- Back, then title "Senden Beklenenler" 28/34 and sub.
- Groups (WAIT). Header: 6px dot plus caps label 12/600 +.08em in the group color, padding 4 4 8.
- Cards: radius 18, padding 14/16, row gap 12.
  - Avatar 40.
  - Name 15/600 and wait time 12 `#9B978E` on one justified line.
  - Topic 13 `#6B6860`; expectation 14/20.
  - Footer: deadline 12/600 (group color) left, "Yanıtla" 13/600 `#4547C9` right.

**Exact copy**
- "Senden Beklenenler", "4 kişi cevabını bekliyor."
- **ACİL** (label `#C7432F`, dot `#E0553F`): "AY" `#F5E1D6` / `#7A3E1F` "Ahmet Yılmaz" · "2 saat" · "Re: Eylül teklifi – revize" · "Revize fiyat teklifi, PDF olarak." · "Bugün 17:00" (`#C7432F`).
- **BUGÜN** (`#9A6300`, dot `#E09A1C`):
  - "SK" "Selin Kaya" · "18 saat" · "Sözleşme taslağı · 4. madde" · "Cezai şart maddesi için yorumun." · "Bugün 18:00".
  - "BT" `#DCE4F5` / `#2B3F73` "Burak Tan" · "5 saat" · "Ekip yemeği" · "Cuma akşamı uygun musun?" · "Bugün".
- **YAKINDA** (`#6B6860`, dot `#B8B4AA`): "EA" `#F0EFEB` / `#6B6860` "Elif Arslan" · "1 gün" · "Konferans bileti" · "Katılım teyidi ve fatura bilgisi." · "9 Eylül".
- Action: "Yanıtla"
- Footnote: "Kart: kişi · konu · ne bekleniyor · son tarih · bekleme süresi. Bölüm başlıkları renkli nokta taşır, kartlar nötr kalır."

**Data → entities**
- `follow_ups` {direction='awaiting_me', person_id, thread_id, topic, expectation (AI-extracted ask), due_at (sourced or null), waiting_since, urgency_bucket ∈ urgent | today | soon (derived), state}.

**Interactions**
- Card tap: Mail Detayı.
- "Yanıtla": AI Reply (4.5).
- Swipes as in 08.
- Missing actions: "Yanıt gerekmiyor / Kapat", "Ertele", "Hatırlat". Secondary has 🔔 and "Maili Aç".

**States:** populated.

**Missing:**
- Empty (e.g. "Kimse senden yanıt beklemiyor.", needs copy).
- Groups with 0 items hidden (secondary hides empty groups).
- Loading, error, dark.
- An undated expectation, which must show no deadline.

**Fake:** none. The deadline "Bugün 18:00" for Selin conflicts with 4.3 ("yarın öğlen hukuka gidecek"); the source must specify.

**Maps to:** §17, §14, §83.

---

### Taahhütlerin / Commitments
- **Source:** PRIMARY / 04 / **4.8 "Taahhütler · Verdiğin sözler"**.
- **Purpose:** promises the user made, detected in mail and notes.

**Layout**
- Back, then title "Taahhütlerin" 28/34 and sub 14/20.
- Cards (COMMITS): radius 20, padding 16.
  - Top row: status badge left, date 12 `#9B978E` right.
  - Quote in **Lora italic 16/24 `#1A1917`**, wrapped in “ ”.
  - Label/value rows: label width 52, `#9B978E`, 13px.
    - "Taahhüt": value `#1A1917` weight 500.
    - "Kime": `#1A1917`.
    - "Kaynak": `#6B6860`.
  - Buttons 38h, radius 12: "Tamamlandı" (with `check` 16, `#EDEDFC` / `#4547C9`), "Ertele" (`#F0EFEB` / `#6B6860`), "Kaynağı Gör" (ghost, right).

**Exact copy**
- "Taahhütlerin", "Mail ve notlarında verdiğin sözleri yakaladım. 3 açık, 1 gecikmiş."
- Cards:

| Status (tone) | Date | Quote | Taahhüt | Kime | Kaynak |
|---|---|---|---|---|---|
| **GECİKMİŞ** (critical) | Cuma · 3 Eyl | “Cuma teklif göndereceğim.” | Teklif v3 gönder | Mehmet Yılmaz | Gmail · 1 Eyl 18:40 |
| **BUGÜN** (warning) | Bugün | “Dosyayı yarın yollarım.” | Marka kılavuzu PDF | Deniz Erol | Gmail · Dün 16:02 |
| **AÇIK** (neutral) | Pazartesi · 8 Eyl | “Pazartesi seni arayacağım.” | Telefon görüşmesi | Annem | Mesaj · 4 Eyl |
| **TAMAMLANDI** (success) | 2 Eyl | “Teklifi bu hafta iletiyorum.” | Teklif v2 gönderildi | Mehmet Yılmaz | Gmail · 28 Ağu |

- Buttons: "Tamamlandı", "Ertele", "Kaynağı Gör"
- Footnote: "Söz alıntısı Lora italik: kullanıcının kendi sesi. Durum rozeti: AÇIK (nötr), BUGÜN (amber), GECİKMİŞ (coral), TAMAMLANDI (yeşil)."

**Data → entities**
- `commitments` {id, quote (verbatim source span), commitment_text, person_id / recipient_name, due_at, due_text, source_type (email | meeting_note | message), source_id, source_provider, source_timestamp, source_span_offsets, status ∈ open | due_today | overdue | completed (+ snoozed), confidence, needs_confirmation bool, completed_via (auto from sent mail, as in "Teklif v2 gönderildi", or manual)}. §18 requires commitment, person, due date, source, status and confidence.

**Interactions**
- "Tamamlandı": `status=completed`, success haptic, toast with undo.
- "Ertele": Smart Reminder / date sheet, then update `due_at` or `snoozed_until`.
- "Kaynağı Gör": open the source (mail detail with the quote highlighted, the meeting note, or the message) and allow "open in provider".
- For completed items, hide the actions or show "Geri al". The design shows no action variant for TAMAMLANDI; secondary hides them.

**States:** populated with all four statuses.

**Missing:**
- **Ambiguous-commitment confirmation** (§18: "belirsiz çıkarımda confirmation iste"). Needs a card variant, e.g. "Bu bir söz mü?" · "Evet, takip et" / "Hayır".
- Confidence display.
- Empty, loading, error, dark.
- Filter tabs (Açık / Tamamlanan).
- Manual add.

**Fake / risky:**
- Source "Mesaj" (SMS/WhatsApp) is not an available source on iOS. On Android it needs the notification listener (§36). Confirm scope or drop it.

**Maps to:** §18, §33 (`commitment_create`), §83, §97, §131, §36.

---

### Kişisel · Yaşam Zekâsı / Life Intelligence list
- **Source:** PRIMARY / 04 / **4.9 "Yaşam Zekâsı · 6 kart kalıbı"**.
- **Purpose:** a dedicated list of life signals derived from mail and notifications. It is a pushed screen (it has a back button), separate from the Akış Kişisel filter.

**Layout**
- Back, then title "Kişisel" 28/34 and sub.
- LifeCards: radius 20, padding 16, row gap 14.
  - Tile 44×44, radius 14, icon 22: `#F0EFEB` / `#6B6860` for every category except security, which is `#FCEDE9` / `#C7432F`.
  - Category kicker 11/700 +.08em `#9B978E` and time 12 `#9B978E` on one baseline-justified line.
  - Title 17/23, weight 600, −.01em; sub 14/20 `#6B6860`.
  - Actions, gap 14, 13/600: a1 `#4547C9`, a2 `#6B6860`.

**Exact copy**
- "Kişisel", "Mail ve bildirimlerinden türetilen yaşam sinyalleri."
- Cards:

| Kicker | Time | Title | Sub | a1 | a2 |
|---|---|---|---|---|---|
| KARGO | Bugün | Trendyol siparişin bugün geliyor. | Yurtiçi Kargo · 14:00–18:00 · 2 parça | Takip Et | Kapıya Not Bırak |
| UÇUŞ | Yarın | TK2412 · İstanbul → Antalya | Yarın 09:15 · Kapı B12 · Check-in açık | Check-in | Cüzdana Ekle |
| REZERVASYON | Cumartesi | Karaköy Lokantası · 20:30 | 4 kişi · Teyit için son saat 18:00 | Teyit Et | Yol Tarifi |
| ÖDEME | 10 Eyl | Elektrik faturası · 1.842 TL | CK Enerji · Son gün 10 Eylül · Geçen ay 1.610 TL | Hatırlat | Ödendi |
| ABONELİK | 9 Eyl | Netflix 9 Eylül'de yenilenecek. | 229,99 TL / ay · Son 30 günde 2 kez izlendi | İncele | Bir Daha Gösterme |
| GÜVENLİK | 07:12 | Google hesabında yeni giriş. | Chrome · Windows · İstanbul | Bendim | Şifreyi Değiştir |

- Footnote: "Tek kalıp, altı kategori: ikon karosu kategoriye göre hafif tonlanır (nötr, güvenlik hariç). Uçuşta rota tipografik ok ile; ödemede tutar başlıkta, son gün alt satırda."

**Data → entity `life_events`** {kind, title, provenance (source_message_id, provider, timestamp, confidence), state, typed payload}. Typed payloads:
- shipment: {merchant, carrier, tracking_no, tracking_url, eta_window, item_count}
- flight: {carrier, flight_no, from, to, depart_at, gate, checkin_open, checkin_url, pkpass_attachment_id?}
- reservation: {venue, at, party_size, confirm_deadline, confirm_url, phone, address}
- payment: {payee, amount, currency, due_date, account_ref_masked, previous_amount? (only if sourced)}
- subscription: {service, amount, period, renews_at, manage_url}
- security: {provider, event, device, location, at}

§23 applies: an amount or deadline is shown only when the source says so explicitly.

**Interactions (real behaviour)**
- "Takip Et": open the carrier tracking URL (handoff).
- **"Kapıya Not Bırak": no public carrier API.** Either hand off to the carrier page or remove the button (dead-action risk).
- "Check-in": handoff to the airline URL or app.
- **"Cüzdana Ekle": only if the source mail carries a `.pkpass`** (Apple Wallet via a native module). On Android only if the email has a Google Wallet save link. Otherwise hide it.
- "Teyit Et": handoff to the confirmation URL or `tel:`.
- "Yol Tarifi": maps deep link, `maps://?daddr=` or `https://www.google.com/maps/dir/?api=1&destination=`.
- "Hatırlat": Smart Reminder sheet.
- "Ödendi": mark paid (state only). The app never executes a payment.
- "İncele": subscription detail plus source.
- "Bir Daha Gösterme": suppression rule (§31 mute / §32 learned) with undo.
- "Bendim": resolve.
- "Şifreyi Değiştir": open the **known** provider security URL (`https://myaccount.google.com/security`), never a link from the email (anti-phishing).
- Card tap: life item detail with a source line (NOT DESIGNED).

**States:** populated.

**Missing:**
- Empty, loading, dark.
- Stale (e.g. a flight that already departed); resolved or expired items.
- Detail screen.

**Fake / risky:**
- "Son 30 günde 2 kez izlendi": not derivable from email (§83).
- "Geçen ay 1.610 TL": needs a prior bill source.
- "Mail ve bildirimlerinden": notifications are Android-only.

**Maps to:** §23, §13, §83, §99, §36, §31, §32.

---

### Ekle · Ekran görüntüsü / Universal Capture · Screenshot result
- **Source:** PRIMARY / 04 / **4.10 "Evrensel Yakalama · Ekran görüntüsü"**.
- **Purpose:** capture an image and detect an event.

**Layout**
1. Nav: `close` · kicker "EKLE".
2. Four source tiles, gap 8. Each: flex 1, 64h, radius 16, 12/600, icon 22 `#5B5CE2`.
   - Unselected: `#fff`, label `#6B6860`, small shadow.
   - Selected: `#EDEDFC` / `#4547C9` (here "Ekran görüntüsü").
3. Preview: 200h, radius 20, hatched placeholder `repeating-linear-gradient(135deg,#E9E7E1 0 10px,#F0EFEB 10px 20px)`, label "ekran görüntüsü · konser afişi".
   - Detection box: 2px `#5B5CE2`, radius 8.
   - Tag "TARİH · YER": 10/700 +.06em, `#5B5CE2` on `#EDEDFC`, radius 4.
4. AI card: kicker "ETKİNLİK TESPİT EDİLDİ"; title 20/26 600 "Konser · Zorlu PSM".
   - Fact chips: 30h, radius 999, `#F0EFEB` / `#6B6860`, 12/600, icons 15: `event` "12 Eylül", `schedule` "20:00", `location_on` "Zorlu PSM".
   - Context 13/19 `#6B6860`.
5. Bottom CTAs: "Takvime Ekle" (primary, `event` icon, 52h, radius 16) and "Hatırlat" (white).

**Copy**
- "EKLE", "Fotoğraf", "Ekran görüntüsü", "PDF", "Link"
- "ETKİNLİK TESPİT EDİLDİ", "Konser · Zorlu PSM", "12 Eylül", "20:00", "Zorlu PSM"
- "O akşam takvimin boş. 19:10'da çıkman gerekebilir."
- "Takvime Ekle", "Hatırlat"
- Footnote: "Paylaşım menüsünden de gelir (iOS Share Sheet / Android Intent). Tespit kutusu görüntü üzerinde işaretlenir; çıkarılan alanlar çip olarak düzenlenebilir."

**Data → entities**
- `captures` {id, source_kind ∈ photo | screenshot | pdf | file | link | text, storage_path (private bucket, short TTL), mime, status (uploaded | analyzing | analyzed | failed | cancelled), created_via (in_app | share_extension)}.
- `capture_extractions` {kind=event, title, date, time, place, bbox[] on the image, confidence, derived_hints (calendar free, departure time)}.

**Interactions**
- Tiles:
  - Fotoğraf: camera or library (`expo-image-picker`).
  - Ekran görüntüsü: library filtered to screenshots (iOS `mediaSubtypes: screenshot` via `expo-media-library`; Android has no reliable subtype, use the "Screenshots" album).
  - PDF: 4.12a sheet.
  - Link: 4.13a.
- Fact chips: tap to edit inline (date / time / place pickers).
- **"Takvime Ekle" must go through the approval sheet** (4.13d pattern), not a direct write.
- "Hatırlat": Smart Reminder sheet.
- Close: cancel the capture and delete the upload if unused.
- Share Extension entry (§28): `expo-share-intent@8.0.1` or `expo-share-extension@5.0.6`.

**States:** result only (the analyzing state for images is not shown; 4.12b/4.13b/4.14b define the pattern).

**Missing:**
- Top text field (4.12a defines the Ekle entry as "üstte metin alanı, altta 4 kaynak karosu"; 4.10 omits it).
- Analyzing and "no event found" states.
- Low-confidence state.
- Camera / photos permission denied.
- Upload failed; offline.
- Multiple items detected.
- OCR failed.

**Fake:** placeholder image and static detection. "19:10'da çıkman gerekebilir" needs home location plus a routing API (external credential §90; mark optional or hide).

**Maps to:** §27, §28, §33, §84, §85, §90, §115.

---

### Ekle · Fotoğraf (Fatura) + Akıllı Hatırlatıcı sayfası / Smart Reminder sheet
- **Source:** PRIMARY / 04 / **4.11 "Yakalama · Fatura fotoğrafı + Akıllı hatırlatıcı"**. Prototype `sheetDefs.remind`: `Dijital Asistan.dc.html` line 820.
- **Purpose:** the product's **single reminder component**, opened from anywhere. The background shows an invoice capture result.

**Layout (background)**
- Nav: close · "EKLE · FOTOĞRAF".
- 160h hatched preview "fotoğraf · elektrik faturası".
- AI card: "FATURA TESPİT EDİLDİ", then "Elektrik · CK Enerji" with "1.842 TL" right-aligned (both 20/600), then "Son ödeme **15 Eylül** · Abone no ···· 4821", where the date is bold `#9A6300`.

**Layout (sheet)**
- Scrim `rgba(27,25,23,.35)`.
- Sheet: `#fff`, radius 28 28 0 0, padding 10 20 44, sheet shadow.
- Grabber: 36×5, radius 3, `#E0DED7`, margin-bottom 14.
- Title 19/600 −.01em; sub 13 `#6B6860`.
- Option rows: min-h 52, hairline top, icon 20 `#6B6860` w24, label 15/500, meta 12 `#9B978E`.
- AI row "Uygun zamanda": min-h 60, bg `#F7F7FE`, margin 0 −8, padding 0 8, radius 12, icon `auto_awesome` FILL `#5B5CE2`, meta 12/600 `#4547C9`, trailing `check_circle` 22 FILL `#5B5CE2` (selected).

**Exact copy**
- "Ne zaman hatırlatayım?"
- "Elektrik faturası · Son ödeme 15 Eylül"
- Options:

| Row | Label | Meta / trailing |
|---|---|---|
| 1 | "30 dakika önce" | "—" |
| 2 | "1 saat önce" | "—" |
| 3 | "Bu akşam" | "19:00" |
| 4 | "Yarın sabah" | "08:00" |
| 5 | "Özel zaman" | chevron |
| 6 | "Uygun zamanda" | "Takvimine göre: 13 Eylül Cumartesi 10:00" |

- Footnote: "Akıllı hatırlatıcı sayfası ürünün tek hatırlatıcı bileşenidir; her yerden aynı 6 seçenek. “Uygun zamanda” takvim boşluğuna ve mesai saatine göre seçilir, gerekçesi altında yazar."
- Prototype option metas when anchored to 17:00: 16:30 / 16:00 / 19:00 / 08:00 / "" / "Takvimine göre: 12:10". The prototype's `go` closes and toasts "Hatırlatıcı kuruldu · {m}" (fake).

**Data → entities**
- `reminders` {id, subject_ref (entity_type + id), title, anchor_at (event / due time, nullable), preset ∈ before_30m | before_1h | this_evening | tomorrow_morning | custom | smart, fire_at, tz (Europe/Istanbul), smart_reason ("Takvimine göre…"), channel (push), status (scheduled | fired | cancelled | snoozed), created_via}.
- User preferences: evening time 19:00 (the brifing time, per 4.14c) and morning 08:00.

**Interactions**
- Rows:
  - With an anchor time, "önce" presets compute from it.
  - **With no anchor time (only a due date), disable "30 dakika önce" / "1 saat önce"** (that is what "—" means), or switch them to relative-to-now "… sonra" as in secondary.
  - "Özel zaman": native date/time picker.
  - "Uygun zamanda": server computes a free slot from calendar and working hours and shows the reason.
- Confirmation model: primary has **no confirm button**, so a row tap commits. Secondary has an explicit "Hatırlatıcı Oluştur" button.
  - §29/§115 require confirmation or approval for reminders.
  - Recommendation: row tap = explicit user confirmation for user-initiated reminders. Create the reminder server-side, schedule the push (`expo-notifications@57.0.20` or server push), show a toast with "Geri al", and log it.
  - AI-suggested reminders ("Uygun zamanda" proposed by AI outside a user tap) go through approval.
- Drag to dismiss; velocity snap (08: open 300ms / close 240ms / dim 250ms, light haptic on open).

**States:** sheet open with the AI option selected.

**Missing:**
- Calendar not connected: "Uygun zamanda" needs a fallback, disabled with the reason "Takvim bağlı değil".
- Computing smart slot (loading meta).
- Past-time validation.
- Notification permission denied (§35): banner "Bildirim izni kapalı · Ayarlar".
- Dark.

**Fake:** the prototype toast "Hatırlatıcı kuruldu" with nothing scheduled.

**Maps to:** §29, §96, §132, §115, §35, §20.

---

### Ekle · PDF seç (alt sayfa) / Capture · PDF picker sheet
- **Source:** PRIMARY / 04 / **4.12a "Yakalama · PDF · Seçim"**.
- **Purpose:** the base Ekle entry screen plus the PDF picker sheet.

**Layout (background)**
- Close · "EKLE".
- Text field: min-h 52, padding 14/16, radius 16, `#fff`, placeholder 15 `#9B978E` "Bir not yaz veya yapıştır…".
- Four tiles with PDF selected.

**Layout (sheet, same sheet spec)**
- Title "PDF seç", sub "Son dosyalar · Mail eklerinden ve Dosyalar'dan".
- File rows: min-h 60, tile 36 radius 11.
  - Selected row: bg `#F7F7FE`, PDF tile `#FCEDE9` / `#C7432F`, trailing `check_circle` FILL `#5B5CE2`.
  - Other rows: tile `#F0EFEB` / `#6B6860`, `radio_button_unchecked` `#C9C5BC`.
  - Name 15/500, meta 12 `#9B978E`.
- Link row: `folder_open`, `#4547C9` 600, "Dosyalar'dan seç…".
- CTA "Analiz Et": 52h, radius 16, `#5B5CE2`, margin-top 12.

**Copy**
- "Hizmet_Sozlesmesi_v3.pdf" — "14 sayfa · 1,2 MB · Mehmet Yılmaz · Dün"
- "Teklif_v2.pdf" — "3 sayfa · Sen · 2 Eyl"
- "Fatura_Eylul.pdf" — "1 sayfa · CK Enerji · 1 Eyl"
- "Dosyalar'dan seç…", "Analiz Et"
- Footnote: "Ekle girişi: üstte metin alanı, altta 4 kaynak karosu. PDF karosu seçilince son dosyalar alt sayfası; mail ekleri otomatik listelenir. Analiz yalnızca “Analiz Et” ile başlar."

**Data:** `recent_documents` view = mail attachments {message_id, attachment_id, filename, pages?, size, sender, date} ∪ device-picked files.

**Interactions**
- Row: single-select.
- "Dosyalar'dan seç…": `expo-document-picker@57.0.2` (type `application/pdf`).
- "Analiz Et": upload (or server-side fetch of the attachment by id), then 4.12b. Analysis starts only here.

**States:** populated sheet.

**Missing:**
- No recent PDFs (empty sheet list).
- Attachment listing loading.
- Encrypted or password-protected PDF.
- Too large or too many pages (limit needed; §85 file security: MIME sniffing, size cap).
- Scanned PDF (OCR).
- Dark.

**Fake:** static list. Listing mail attachments needs a Gmail read scope (restricted scope; verification and security assessment).

**Maps to:** §27, §85, §75, §76.

---

### Ekle · PDF · Analiz ediliyor / Capture · PDF analyzing
- **Source:** PRIMARY / 04 / **4.12b**.
- **Purpose:** transparent analysis progress as a findings list, with no progress bar.

**Layout**
- Close · "EKLE · PDF".
- 220h preview "pdf önizleme · Hizmet_Sozlesmesi_v3 · s.3" with a highlight box and tag "TARİH".
- Progress card (radius 20):
  - Kicker: spinner 16 (border 2 `#D9D6F7`, top `#5B5CE2`, rotating .8s) plus "PDF ANALİZ EDİLİYOR…".
  - Steps, 15px, gap 12:
    - Done: `check_circle` FILL `#2FA062` 22.
    - Active: spinner 22.
    - Pending: 22 ring, border 2 `#C9C5BC`, opacity .4.
- Privacy note: `lock` 16 plus 12 `#9B978E`.
- "İptal": text button 48h, 14/600 `#6B6860`.

**Copy**
- "PDF ANALİZ EDİLİYOR…"
- "14 sayfa okundu"
- "3 tarih bulundu" with "s.3, s.9, s.14"
- "Yükümlülükler ve görevler çıkarılıyor…"
- "Takvim uygunluğu kontrol ediliyor"
- "Belge cihazında özetlenir; içerik saklanmaz, yalnızca çıkarılan öğeler."
- "İptal"
- Footnote: "İlk Analiz ekranıyla aynı kalıp: ilerleme çubuğu yok, bulgu listesi. Önizlemede tespit edilen alan işaretlenir. İptal her an mümkün."

**Data:** `capture_analysis_events` stream {step, status, detail, page_refs[]}.

**Interactions**
- Steps must be driven by **real pipeline events** (Realtime channel or polling of the job row), not timers.
- "İptal": cancel the job server-side, delete the uploaded file, return to the entry.

**States:** in progress.

**Missing:**
- Failure per step (e.g. "Metin okunamadı · OCR dene").
- Timeout.
- Offline mid-analysis.
- Partial result ("2 öğe bulundu, takvim kontrolü yapılamadı").

**Fake / risky:**
- **"Belge cihazında özetlenir"** is false if summarization runs in the cloud (Edge Function to an LLM). Copy must match the real architecture (§40 truthfulness), e.g. "Belge güvenli sunucuda işlenir; içerik saklanmaz, yalnızca çıkarılan öğeler."

**Maps to:** §27, §80, §85, §40, §41, §93, §123.

---

### Ekle · PDF · Tespit + öneriler / Capture · PDF results
- **Source:** PRIMARY / 04 / **4.12c**.
- **Purpose:** show the extracted items with page-level provenance; the user selects them and sends them to approval.

**Layout**
1. Close · "EKLE · PDF".
2. File row card: tile `#FCEDE9` / `#C7432F`, name 14/600, meta 12, trailing "Aç" 13/600 `#4547C9`.
3. AI card: kicker "SÖZLEŞME TESPİT EDİLDİ · 3 ÖĞE", title 20/26, sub 14/20.
4. Extracted-items list card (radius 18). Rows:
   - 30 tile radius 10 in the type tone.
   - Type kicker 11/700 +.06em, colored.
   - Title 15/21 weight 500; source meta 12 `#9B978E`.
   - `check_circle` selected.
5. Kicker "ÖNERİLEN AKSİYONLAR" plus tonal chips (38h, radius 12, 13/600, icon 16).
6. Sticky CTA bar: gradient `linear-gradient(180deg, rgba(245,244,240,0) 0%, #F5F4F0 45%)`, padding 16 20 44. Buttons: "3 Öğeyi Onaya Gönder" (primary with glow) and "Düzenle" (white).

**Copy**
- "Hizmet_Sozlesmesi_v3.pdf", "14 sayfa · Mehmet Yılmaz · Dün", "Aç"
- "SÖZLEŞME TESPİT EDİLDİ · 3 ÖĞE", "Hizmet Sözleşmesi · Yılmaz Endüstri", "Taraflar, 12 aylık hizmet, 3 tarih ve 1 yükümlülük bulundu."
- Items:
  - **SON TARİH** (`flag`, `#FDF2DC` / `#9A6300`): "İmza için son gün · 19 Eylül" / "Kaynak: s.14, madde 9.2"
  - **GÖREV** (`add_task`, `#F0EFEB` / `#6B6860`, kicker `#9B978E`): "Hukuktan 4. madde yorumu iste · 12 Eylül'e kadar" / "Kaynak: s.3, cezai şart maddesi"
  - **ETKİNLİK** (`event`, `#E7F0FD` / `#2262BE`): "Sözleşme görüşmesi · 17 Eylül 11:00" / "Kaynak: s.9 · O saat takvimin boş"
- Chips: "Takvime Ekle · 1", "Görev Oluştur · 1", "Hatırlat · 1" (soft indigo); "Mehmet'e bağla" (`person`, neutral)
- "3 Öğeyi Onaya Gönder", "Düzenle"
- Footnote: "Her öğe tipine göre karo rengi (son tarih amber, etkinlik mavi, görev nötr), altında sayfa kaynağı. Öğeler tek tek seçilebilir; CTA sayıyı söyler."

**Data → entities**
- `capture_extractions` {kind ∈ deadline | task | event | person | payment | …, title, date_time, page_ref, clause_ref, span_text, confidence, selected, proposed_action (reminder_create | task_create | calendar_create)}.
- Document classification {doc_type=contract, parties, term=12 ay}.
- Person link candidate (Mehmet → `people`).

**Interactions**
- "Aç": open the PDF in the in-app viewer or a system preview.
- Row checkbox: toggle selection. The CTA count updates ("N Öğeyi Onaya Gönder"). Disable at 0.
- Row tap (not specified): edit title, date and target.
- The action chips' role is ambiguous: they duplicate the per-row selection. Define them as a per-type toggle / quick filter, or remove them.
- "Mehmet'e bağla": link the capture to the person (writes a `people_links` row; reversible).
- "3 Öğeyi Onaya Gönder": open 4.12d.
- "Düzenle": edit mode for all items (NOT DESIGNED).

**States:** results.

**Missing:**
- Zero items found ("Belgede tarih veya görev bulunamadı" + "Hafızaya kaydet").
- Low-confidence item styling.
- Conflict ("O saat dolu").
- Dark.

**Fake / risky:**
- The task's due "12 Eylül'e kadar" and the task itself ("Hukuktan … iste") are AI suggestions, not document facts. They must be labelled as suggestions and carry no fabricated deadline (§83).
- "3 tarih ve 1 yükümlülük" vs 3 rows.

**Maps to:** §27, §33, §83, §97, §30.

---

### Ekle · PDF · Onay (alt sayfa) / Capture · PDF approval sheet
- **Source:** PRIMARY / 04 / **4.12d**.
- **Purpose:** a single approval sheet for a user-initiated capture. Each row follows the Onay Merkezi card contract.

**Layout (sheet spec)**
- Title "Onay · 3 işlem", sub.
- Approval rows:
  - 28 tile radius 9, `#EDEDFC` / `#4547C9`, icon 17.
  - Type kicker 11/700 +.06em `#6B6860`.
  - Title 15/600; meta 12 `#9B978E`. The smart reminder meta is `#4547C9` 600.
  - `check_circle` FILL `#5B5CE2`.
- Buttons, 48h radius 14, 14/600: "Onayla · 3" (primary, flex 1), "Düzenle" (`#EDEDFC` / `#4547C9`), "Vazgeç" (`#F0EFEB` / `#6B6860`).
- Footer: `verified_user` 16 `#1E7A47` plus 12 `#9B978E`.

**Copy**
- "Onay · 3 işlem", "Sen onaylamadan hiçbiri yapılmaz. İstemediğini kaldır."
- Rows:
  - "TAKVİME EKLE": "Sözleşme görüşmesi · 17 Eyl 11:00" / "Google Takvim · 60 dk · 30 dk önce hatırlatma"
  - "GÖREV OLUŞTUR": "Hukuktan 4. madde yorumu iste" / "Plan · 12 Eyl · Önerilen blok: 10 Eyl 14:00"
  - "HATIRLATICI": "İmza son günü · 19 Eyl" / "Uygun zamanda: 18 Eyl 09:10"
- "Onayla · 3", "Düzenle", "Vazgeç", "Onaylananlar Onay Merkezi geçmişine yazılır."
- Footnote: "Kullanıcının kendi başlattığı yakalamada tek onay sayfası; her satır Onay Merkezi kart sözleşmesini taşır (ne · nereye · ne değişecek). AI'ın kendi önerileri ise Onay Merkezi'nde tek tek kalır."

**Data → `approval_requests`** (batch_id = capture_id) {action_type ∈ calendar_create | task_create | reminder_create, what, why, source (capture + page ref), exact_change (payload diff), destination/account (Google Takvim account X / Plan), side_effect (reminder 30 dk, invites), idempotency_key, status, decided_at, executed_at, error}.

**Interactions**
- Row check: deselect (removes it from the batch). The counts in "Onayla · N" update.
- "Onayla · N": server-side batch execution. Each row gets its own idempotency key, statuses go executing → executed or failed, partial failures are reported per row, and the result is written to history.
- "Düzenle": back to 4.12c edit mode, or a per-row typed editor (date/time, calendar account, duration, reminder offset).
- "Vazgeç": close the sheet, nothing written. Optionally keep the extractions as a draft capture.

**States:** pending.

**Missing:**
- Executing (per-row spinner).
- Partial failure ("2/3 tamamlandı · Takvim hatası · Tekrar dene").
- Calendar account picker when there are multiple accounts.
- Conflict warning.
- Offline: block execution.
- Dark.

**Fake:** none, but the row fields are inconsistent with 4.13d (no "Neden" line). Unify to §33 {what, why, source, exact change, destination/account, side effect}.

**Maps to:** §33, §115, §98, §127, §66.

---

### Ekle · Link · Giriş / Capture · Link input
- **Source:** PRIMARY / 04 / **4.13a**.
- **Purpose:** paste or enter a URL, see a preview and recent links, then analyze.

**Layout**
1. Close · "EKLE · LİNK".
2. Tiles with Link selected.
3. URL field: 52h, radius 16, `#fff`, focus ring `0 0 0 2px #5B5CE2`, `link` icon 18 `#9B978E`, 15px text with ellipsis, caret.
4. Chips row (30h): "Panodan yapıştırıldı" (`content_paste`, `#EDEDFC` / `#4547C9`) and "Temizle" (neutral).
5. Preview card: 56 hatched thumbnail radius 14, domain 12 `#9B978E`, title 15/600 with ellipsis, "Bağlantı önizlemesi" 12.
6. Kicker "SON EKLENEN LİNKLER".
7. List card (radius 18): rows min-h 48, icon 18 `#6B6860`, url 14 `#6B6860` with ellipsis, date 12 `#9B978E`.
8. CTA "Analiz Et".

**Copy**
- "biletix.com/etkinlik/konser-zorlu-psm-12-eylul", "Panodan yapıştırıldı", "Temizle"
- "biletix.com", "Konser · Zorlu PSM · 12 Eylül", "Bağlantı önizlemesi"
- "SON EKLENEN LİNKLER": `restaurant` "karakoylokantasi.com/rezervasyon" "2 Eyl"; `article` "medium.com/…/ai-briefing-patterns" "28 Ağu"
- "Analiz Et"
- Footnote: "Panodaki link otomatik önerilir ama kullanıcı onayı olmadan okunmaz (“Panodan yapıştırıldı” çipi). Önizleme kartı yalnızca başlık + alan adı."

**Data:** `captures(source_kind=link, url, normalized_url, og_title, og_image_url, domain)`, plus the recent captures list.

**Interactions**
- Clipboard: detect a URL without reading content (`expo-clipboard@57.0.2` `hasUrlAsync()`; iOS 16+ shows the paste permission prompt on read, so read only after the user taps). "Panodan yapıştırıldı" appears only after an explicit paste.
- "Temizle": clear the field.
- Preview: server-side OG fetch with SSRF guards (§84: block localhost / private / loopback, reject `file://` and unsupported schemes, redirect cap, size cap, timeout, content-type check).
- Recent link row: re-open that capture result.
- "Analiz Et": 4.13b.

**States:** filled.

**Missing:**
- Empty field.
- Invalid URL.
- Unsupported scheme.
- Preview failed (show the domain only).
- Offline.
- Share-extension entry (URL prefilled).
- Dark.

**Fake:** none (placeholder thumbnail).

**Maps to:** §27, §28, §84, §87.

---

### Ekle · Link · Analiz ediliyor / Capture · Link analyzing
- **Source:** PRIMARY / 04 / **4.13b**.

**Layout**
- Close · "EKLE · LİNK".
- Card: 160h og:image placeholder "og:image · konser afişi", then padding 12/16 with domain and title "Konser · Zorlu PSM · 12 Eylül 20:00".
- Progress card, same as 4.12b.
- Lock note.
- "İptal".

**Copy**
- "BAĞLANTI ANALİZ EDİLİYOR…"
- "Sayfa okundu"
- "Tür: etkinlik" with meta "ürün · içerik · rezervasyon değil"
- "Tarih, saat, yer ve fiyat bulundu"
- "Takvim uygunluğu ve yol süresi kontrol ediliyor…"
- "Sayfa yalnızca bir kez okunur; çerez veya oturum paylaşılmaz."
- "İptal"
- Footnote: "Tür sınıflandırması bulgu satırı olarak görünür (etkinlik / ürün / içerik / rezervasyon); yanlışsa sonraki ekranda değiştirilebilir."

**Interactions**
- Real job events drive the steps.
- "İptal" cancels the job.
- The fetch runs server-side with no cookies (matches the copy).

**Missing:**
- Page unreadable: JS-rendered SPA or bot-blocked (biletix-like sites). Needs a fallback, e.g. "Sayfa okunamadı · Metni yapıştır".
- Paywalled page.
- Timeout; redirect loop blocked.
- "Yol süresi" when location permission or a routing key is absent: skip the step.

**Fake:** timers in the prototype pattern.

**Maps to:** §27, §84, §80, §93.

---

### Ekle · Link · Tespit + öneriler / Capture · Link results
- **Source:** PRIMARY / 04 / **4.13c**.

**Layout**
1. Close · "EKLE · LİNK".
2. Type chips (30h): selected "✓ Etkinlik" in ink `#1A1917` / `#fff` with `check` 14; "Ürün", "İçerik", "Rezervasyon" in `#fff` / `#6B6860` with small shadow.
3. AI card: "ETKİNLİK TESPİT EDİLDİ" / "Konser · Zorlu PSM".
   - Chips: "12 Eylül", "20:00", "Zorlu PSM", `confirmation_number` "2 bilet · 1.450 TL".
   - Context 13/19.
   - Source line: `verified` 16 plus 12 `#9B978E`.
4. Kicker "ÖNERİLEN AKSİYONLAR".
5. List card with rows: 30 tile, title 15/21 weight 500, meta 12, `check_circle` or `radio_button_unchecked`.
6. Sticky CTA bar: "2 Öğeyi Onaya Gönder" plus "Düzenle".

**Copy**
- "Etkinlik", "Ürün", "İçerik", "Rezervasyon"
- "O akşam takvimin boş. 19:10'da çıkman gerekebilir. Bilet satışı 8 Eylül 10:00'da açılıyor."
- "Kaynak: biletix.com · okunma 09:41"
- Rows:
  - "Takvime ekle · 12 Eyl 20:00" / "19:10 çıkış hatırlatması dahil" (`event`, `#E7F0FD` / `#2262BE`, checked)
  - "Bilet satışı için hatırlat · 8 Eyl 09:55" / "Satış açılmadan 5 dk önce" (`notifications`, neutral, checked)
  - "Hafızaya kaydet" / "“Zorlu konser” diye sorabilirsin" (`bookmark`, unchecked)
- "2 Öğeyi Onaya Gönder", "Düzenle"
- Footnote: "Tür çipleri (etkinlik · ürün · içerik · rezervasyon) kullanıcıya sınıflandırmayı düzeltme imkânı verir; ürün seçilirse öneriler fiyat takibi ve alışveriş hatırlatıcısına döner."

**Data:** `capture_extractions(kind=event, price, ticket_qty?, sale_opens_at)`, `link_type` ∈ event | product | content | reservation, `read_at`. Memory item `ai_memory` (§26).

**Interactions**
- Type chip: re-run suggestion mapping for the chosen type. Product type means price tracking plus a shopping reminder; **price tracking is a new feature not in the master prompt**, so flag the scope.
- Row toggles.
- "Hafızaya kaydet": writes an AI memory item. It does not need external approval (internal), but it must be visible and deletable in Memory (§26).
- CTA: 4.13d.
- "Düzenle": edit mode.

**Missing:** zero-suggestion state, low confidence, dark.

**Fake / risky:**
- "**2 bilet**" cannot be derived from a public event page (§83).
- "19:10 çıkış" needs location plus routing.

**Maps to:** §27, §26, §33, §83, §139 (scope).

---

### Ekle · Link · Onay / Capture · Link approval sheet
- **Source:** PRIMARY / 04 / **4.13d**.

**Layout:** as 4.12d, plus a **"Neden / Değişim" two-column grid** (56px label column, gap 3/10, 12/17; label `#9B978E`).

**Copy**
- "Onay · 2 işlem", "Takviminde değişiklik yapmadan önce onayın gerekir."
- "TAKVİME EKLE": "Konser · Zorlu PSM · 12 Eyl 20:00"; Neden "Paylaştığın bağlantıda etkinlik bulundu."; Değişim "Google Takvim'e 1 etkinlik · 19:10 çıkış hatırlatması"
- "HATIRLATICI": "Bilet satışı · 8 Eyl 09:55"; Değişim "1 hatırlatıcı · Takvimine yazılmaz"
- "Onayla · 2", "Düzenle", "Vazgeç"
- Footnote: "Onay satırları Onay Merkezi kartlarıyla aynı üç alanı taşır (ne · neden · ne değişecek). Onay sonrası başarı toast'ı ve Bugün'e dönüş."

**Interactions:** same as 4.12d. On success: toast "Onaylandı · N işlem" with "Geri al", then return. The footnote says "Bugün'e dönüş"; it should return to the origin screen.

**Missing:** same as 4.12d.

**Maps to:** §33, §115.

---

### Ekle · Metin · Giriş / Capture · Text input
- **Source:** PRIMARY / 04 / **4.14a**.

**Layout**
1. Close · "EKLE · METİN".
2. Text area: min-h 140, padding 16, radius 20, focus ring 2px `#5B5CE2`, **17/25 Geist**, −.01em, caret 2×20.
3. Chips (30h, `#F0EFEB`): `mic` "Sesle yaz", `content_paste` "Yapıştır", counter "96 karakter".
4. Four tiles, none selected.
5. Hint: `psychology` 18 `#5B5CE2` plus 13/19.
6. CTA "Analiz Et".

**Copy**
- "Perşembe 15:00 Ayşe ile kahve, öncesinde raporu bitir. Çarşamba akşamı bana hatırlat."
- "Sesle yaz", "Yapıştır", "96 karakter"
- "Serbest yaz; tarih, kişi ve görevleri ben ayırırım."
- "Analiz Et"
- Footnote: "Metin girişi Ekle sayfasının en üstündeki alan; odaklanınca büyür (17px, Lora değil, gövde fontu). Mikrofon sesle dikte için, ses modu değil."

**Interactions**
- "Sesle yaz": OS dictation / speech-to-text into the field. This is **not** voice mode (§25). Needs microphone and speech permission.
- "Yapıştır": clipboard read after the tap.
- Counter: live count, not a button. Style it as non-interactive text to avoid looking clickable (§99).
- "Analiz Et": 4.14b. Disabled when empty.

**Missing:** empty/placeholder state (the placeholder exists in 4.12a: "Bir not yaz veya yapıştır…"), max-length, mic permission denied, dark.

**Fake:** "96 karakter" does not match the text, which is 85 characters.

**Maps to:** §27, §25.

---

### Ekle · Metin · Analiz ediliyor / Capture · Text analyzing
- **Source:** PRIMARY / 04 / **4.14b**.

**Layout**
- Close · "EKLE · METİN".
- Read-only text card: 17/27 with inline entity highlights (radius 5, padding 1/4):
  - zaman: `#E7F0FD` / `#2262BE`
  - kişi: `#EDEDFC` / `#4547C9`
  - görev: `#F0EFEB` / `#6B6860`
  - hatırlatıcı: `#FDF2DC` / `#9A6300`
- Legend: 10×10 swatches radius 3, 11px `#9B978E`.
- Progress card.
- "İptal".

**Copy**
- Highlights: "Perşembe 15:00", "Ayşe", "raporu bitir", "Çarşamba akşamı"
- Legend: "zaman", "kişi", "görev", "hatırlatıcı"
- "METİN ANALİZ EDİLİYOR…"
- "2 zaman ifadesi çözüldü" / "Per 11 Eyl · Çar 10 Eyl"
- "Kişi eşleştirildi" / "Ayşe Kara · Kişiler"
- "Görev ve hatırlatıcı ayrılıyor…"
- "İptal"
- Footnote: "Metin yerinde işaretlenir: anlam renkleri sistemdeki soft tonlar (zaman mavi, kişi indigo, görev nötr, hatırlatıcı amber). Belirsiz tarih (“Perşembe”) çözümü bulgu satırında açıkça yazar."

**Data:** entity spans {start, end, type, resolved_value, confidence}. Person match via the app `people` table and/or device contacts (`expo-contacts@57.0.6`, permission). Relative-date resolution uses the user timezone (Europe/Istanbul) and the current date.

**Missing:**
- Ambiguous person (two "Ayşe"): needs a disambiguation picker.
- Contacts permission denied.
- Failure.

**Maps to:** §27, §39 (tr-TR date parsing), §30.

---

### Ekle · Metin · Tespit + öneriler / Capture · Text results
- **Source:** PRIMARY / 04 / **4.14c**.

**Layout**
- Close · "EKLE · METİN".
- Quote card: 14/21 italic Geist `#6B6860` (not Lora), padding 12/16, radius 16.
- AI card: kicker "3 ÖĞE TESPİT EDİLDİ", body 15/21 `#1A1917`.
- Item list: TAKVİM OLAYI (info tone), GÖREV (neutral), HATIRLATICI (warning).
- Chips.
- Sticky "3 Öğeyi Onaya Gönder" plus "Düzenle".

**Copy**
- "Bir takvim olayı, bir görev ve bir hatırlatıcı. Rapor görevini kahveden 1 saat önceye koydum."
- "TAKVİM OLAYI": "Ayşe ile kahve · Per 11 Eyl 15:00" / "60 dk · Ayşe Kara davet edilsin mi? **Evet**" (bold `#4547C9`)
- "GÖREV": "Raporu bitir · Per 11 Eyl 14:00'a kadar" / "Plan'da önerilen blok: Per 10:00–12:00"
- "HATIRLATICI": "Rapor için hatırlat · Çar 10 Eyl 19:00" / "“Akşam” = 19:00 (brifing saatin)"
- Chips: "Takvime Ekle · 1", "Görev Oluştur · 1", "Hatırlat · 1"
- "3 Öğeyi Onaya Gönder", "Düzenle"
- Footnote: "AI'ın yorumları görünür: “akşam = 19:00 (brifing saatin)”, “kahveden 1 saat önce”. Her yorum satır içinde düzeltilebilir; kaynak alıntı üstte italik."

**Interactions**
- "Evet" (invite toggle): an inline boolean. Turning it on adds an attendee, which makes the calendar API send an email invite (Google `sendUpdates=all`). This is an **external side effect** and must appear in the approval row's Değişim.
- Each AI interpretation ("akşam = 19:00", "1 saat önce") is editable inline: tap for a time picker.

**Missing:** unresolvable time, dark.

**Maps to:** §27, §33, §115, §131, §20.

---

### Ekle · Metin · Onay + başarı / Capture · Text success (+ undo toast)
- **Source:** PRIMARY / 04 / **4.14d**.

**Layout**
- Close · "EKLE · METİN".
- Centered success block:
  - 96 circle `#E4F5EA` with `check_circle` 48 FILL `#1E7A47`.
  - Title 26/600.
  - Body 15/22 `#6B6860`.
  - Result chips (30h, white): `event` `#2262BE` "Per 15:00"; `add_task` "Per 14:00"; `notifications` `#9A6300` "Çar 19:00".
  - Ink button "Bugün'e Dön" (48h, radius 14, `#1A1917`).
- Toast pinned at bottom 104: ink pill `#1A1917`, radius 999, padding 12/18/12/14, 14/500, `check` 18 `#A9AAF5`, "Onaylandı · 3 işlem" plus "Geri al" (`#A9AAF5` 600).

**Copy**
- "3 öğe eklendi"
- "Kahve takviminde, rapor Plan'da, hatırlatıcı Çarşamba 19:00'da. Ayşe'ye davet gönderildi."
- "Per 15:00", "Per 14:00", "Çar 19:00"
- "Bugün'e Dön", "Onaylandı · 3 işlem", "Geri al"
- Footnote: "Onay sayfası PDF/Link ile aynıdır (4.12d kalıbı); burada onay sonrası başarı ekranı: yeşil halka, tek cümle özet, nereye yazıldığını gösteren çipler, 5 sn “Geri al” toast'ı."

**Interactions**
- Result chips: deep link to the created objects (calendar event / Plan task / reminder).
- "Bugün'e Dön": return to the origin tab. The copy should adapt, e.g. "Akış'a Dön".
- **"Geri al" (5s):** external side effects (an invite email already sent) cannot be recalled. Two options:
  - (a) Defer server execution until the 5s undo window closes. This is the recommended option: status "scheduled", then executing.
  - (b) Compensating actions: delete the event, which sends a cancellation to Ayşe.
- Show success only after execution is confirmed (§98). The copy "Ayşe'ye davet gönderildi" must be conditional.

**Missing:** partial success, failure, dark.

**Fake:** the prototype success is instant.

**Maps to:** §33, §98, §115, §123, §127.

---

### Kaydırma aksiyonları / Swipe actions (cross-ref, applies to Akış, Bugün and Takip)
- **Source:** PRIMARY / 08 / "KAYDIRMA AKSİYONLARI" (lines 98–101) plus MOTION. Referenced in the 4.1 footnote.

**Visual spec**
- **Right swipe:** track `#2FA062`. A 96px left action with `check_circle` 26 FILL and "Tamamlandı" 11/600 `#fff`. The card is offset with shadow `-8px 0 24px rgba(27,25,23,.1)`.
- **Left swipe:** track `#F0EFEB`. A 168px right action group:
  - "Ertele" (`schedule` 24, `#6B6860`)
  - "Önemli değil" (`remove_circle` 24, on `#E9E7E1`)
  - Card shadow `8px 0 24px rgba(27,25,23,.1)`.

**Copy:** "Sağa: Tamamlandı (yeşil, tam kaydırmada otomatik). Sola: Ertele · Önemli değil (nötr). Eşik %35; eşikte hafif haptic. Kaydırma yönleri Akış, Bugün ve Takip'te aynıdır."

**Spec:** tracking 1:1; release 260ms spring; light haptic at threshold; success haptic on complete.

**Implementation:**
- `react-native-gesture-handler@3.3.0` (ReanimatedSwipeable) + `react-native-reanimated@4.7.0`
- `expo-haptics@57.0.3`
- VoiceOver/TalkBack custom actions with the same three verbs (§92).

**Real behaviour**
- Done: state=done, per-type semantics:
  - follow-up: close
  - commitment: completed
  - deadline: acknowledge
  - security: "Bendim"
- Ertele: reminder sheet in snooze mode.
- Önemli değil: dismiss plus learning signal, optionally the correction sheet.
- Every swipe gets a toast with "Geri al".

**Maps to:** §13, §17, §32, §92, §123.

---

### Onay Merkezi / Approval Center (NOT an artboard in 04; referenced only)
- **Primary refs in 04:**
  - "Onaylananlar Onay Merkezi geçmişine yazılır."
  - "AI'ın kendi önerileri ise Onay Merkezi'nde tek tek kalır."
  - "Onay satırları Onay Merkezi kartlarıyla aynı üç alanı taşır (ne · neden · ne değişecek)."
- The full screen lives in `Dijital Asistan.dc.html` and in 06/07 (out of this audit's file).
- **Prototype data** (lines 770–772, 822):
  - Cards {icon, type ("MAİL GÖNDER" / "ETKİNLİK TAŞI" / "ETKİNLİK OLUŞTUR"), what, why, change, status}.
  - Status pills: BEKLİYOR `#FDF2DC` / `#9A6300`; ONAYLANDI `#E4F5EA` / `#1E7A47`; REDDEDİLDİ `#F0EFEB` / `#6B6860` (card opacity .45).
  - Toasts: "Onaylandı · {what}", "Reddedildi · Öğrendim", "Onay Merkezi'ne eklendi".
  - Edit on email opens the reply screen; otherwise toast "Düzenleme Plan sekmesinde açılır" (fake).
- **Empty (08):** `task_alt` on `#F0EFEB` / `#6B6860`, "Onay bekleyen işlem yok." / "Bir mail göndermek veya takvimi değiştirmek istediğimde önce burada görürsün." / CTA "Geçmişi gör".
- **§33 requirements vs designs:**
  - Statuses: pending | approved | rejected | executing | executed | failed | expired. The designs show only 3.
  - Action types: email_send | calendar_create | calendar_update | task_create | reminder_create | commitment_create.
  - Fields: what, why, source, exact change, destination/account, side effect.
  - Buttons: Onayla / Düzenle / Reddet.
  - Idempotency.
- **Missing states:** executing, executed, failed (retry), expired, and a history tab.
- **Maps to:** §33, §115, §66, §98.

---

### "Neden önemli?" / "Bu nereden çıktı?" explainability
- **Primary 04:** only passive source lines:
  - 4.4 "Kaynak: Gmail · … · Konu dizisi 4 mail"
  - 4.13c "Kaynak: biletix.com · okunma 09:41"
  - 4.12c page refs "Kaynak: s.14, madde 9.2"
  - 4.6 sent-at line
  - 4.8 "Kaynak" row plus "Kaynağı Gör"
  - 4.14c visible AI interpretations
  - The feed card `src` line.
- **There is no tap target, why-sheet or confidence display.**
- **Secondary** `InsightCard.tsx` adds:
  - A "Neden önemli?" ghost link (12/500 `#A0A0B2`) opening a bottom sheet titled "Neden önemli?", with the reason text (e.g. "Bu mailde bugün saat 17:00'ye kadar cevap istendiği için önemli olarak işaretlendi.") and a full-width "Önemli değil" button.
  - 👍 "Doğru" / 👎 "Önemli değil" feedback, with dismissal after 600ms.
- **Primary prototype** "correct" sheet: "Bunu nasıl değerlendireyim?" / "Seçimin gelecekteki öncelikleri etkiler". Options:
  - "Önemli değil" → "Bu tür konuları daha aşağıda göstereceğim."
  - "Bunu daha sık göster"
  - "Bu kişiyi VIP yap"
  - "Bunu takip etme" → "Bu konuyu artık takip etmeyeceğim."
- **Production:** one `WhySheet`, restyled to the primary sheet spec, reachable from long-press or overflow on every AttentionCard, the badge on Mail Detayı, and the source lines. Content:
  - reason_text
  - rule hit (explicit rule name, §31) / learned preference / metadata signal / AI with confidence
  - source row, with "Orijinalini aç" as the provider handoff
  - feedback actions (the correct-sheet options)
- **Maps to:** §131, §14, §31, §32, §97.

---

## SECONDARY additions (Figma Make prototype): what it adds beyond primary 04

### Flow screen (`SECONDARY/src/screens/flow/FlowScreen.tsx`)
**Adds**
- Header "Mail Özeti" pill (`#EEEEFF` / `#5B5CE2`, radius 10), navigating to Mail Intelligence. **Adopt as the missing entry point**, restyled to the primary "Ekle" pill spec.
- Profile avatar button (32 circle, gradient, "Y"), satisfying §8. **Adopt** (primary-styled avatar).
- Card tap routing: email → email-detail, meeting → meeting-prep.
- Staggered fade-in at 40ms. Matches the primary 08 "kartlar 60ms kademe" intent; use 60ms.

**Do not copy**
- Emoji icons, `iconBg` pastel colors, and priority-colored action buttons (primary keeps actions as neutral `#4547C9` text).
- `onClick={(e)=>e.stopPropagation()}` action buttons that do nothing (**dead buttons**).
- "Takip" filter mapped to `type==='deadline'` (wrong).
- Title/time layout.
- "Ödeme Yap" (implies payment).

### Mail Intelligence (`MailIntelligence.tsx`)
**Adds**
- A "KATEGORİLER" kicker.
- Inline category selection that filters an email list below.
- Default "ÖNE ÇIKANLAR" list: avatar 36, sender, subject bold when unread, one-line AI summary; tap goes to detail. **Adopt** the list as the category drill-down screen, primary-styled.
- Unread state (`isRead`).

**Do not copy**
- **Inverted navigation:** "Cevap Bekleyen" goes to smart-followup and "Cevap Beklediğin" goes to waiting-reply. The correct mapping is the opposite.
- Colored count pills.
- Title "Mail Özeti" differs from primary "MAİL ZEKÂSI · BUGÜN". Counts differ (18/56).

### Email Detail (`EmailDetail.tsx`)
**Adds**
- **"Orijinal Maili Aç"** handoff button plus sheet: title "Orijinal Mail", "Gmail'de Açılıyor", "Orijinal mail Gmail uygulamasında açılacak. Devam etmek istiyor musun?", CTAs "Gmail'de Aç ↗" / "İptal". Needed for §15; **adopt** as an overflow item or source-line action with a real deep link. The prototype button only closes the sheet (fake).
- **Görev Oluştur sheet:** title "Görev Oluştur", fields "GÖREV BAŞLIĞI" (prefilled with the subject) and "SON TARİH" (date input), CTA "Görev Oluştur". Success "Görev Oluşturuldu" is fake (1.5s timeout). **Adopt the IA** (title, due date, source link, destination) in primary sheet style.
- Hatırlat opens the SmartReminderSheet with context "{sender} — {subject}".
- "İŞLEMLER" kicker; key points as separate white rows.

**Do not copy**
- "Takvime Ekle" navigating to `plan` (no approval).
- Fake successes.

### AI Draft Reply (`AIDraftReply.tsx`)
**Adds**
- "TON" kicker.
- Editable `textarea` (real editing).
- "AI TARAFINDAN HAZIRLANDI" pill plus "Düzenleyebilirsin".
- "⚠️ AI onayın olmadan mail göndermez".
- **"Son Onay" confirmation sheet:** "Ahmet Yılmaz'a şu mail gönderilecek. Bu işlem geri alınamaz.", a 120-char preview, "Evet, Gönder" / "İptal". This is a double confirmation; primary uses a single "Göndermeyi Onayla". **Recommend a single primary CTA** plus a read-only summary of recipient, subject and attachments in the same view. A second sheet is optional.
- **"Gmail'de Aç"** secondary CTA: hand the draft to Gmail. Real version: Gmail `drafts.create` (compose scope), then open Gmail. This is an alternative Send path worth keeping as "Taslağı Gmail'e aktar".
- Sent overlay "Gönderildi!" / "Ahmet Yılmaz'a iletildi." / "Bugüne Dön".

**Do not copy**
- Tone buttons that do not change the draft.
- The fake Gmail "açılıyor…" dark screen.
- The fake sent overlay.
- Inter font.

### Smart Follow-up (`SmartFollowUp.tsx`)
**Adds**
- "Konu:" prefix; status in a grey inset box.
- Days pill ">5 → red" rule.
- "Hatırlat" opens the full reminder sheet. Primary's "Yarın Hatırlat" is a one-tap preset. Keep primary, with an optional long-press for the full sheet.
- "Kapat" with fade-out.
- **Empty state:** "Hepsi tamam!" / "Takip edilecek konu yok." (primary 08 has better copy: "Bekleyen takip yok.").

**Do not copy**
- Emoji empty state.
- Local-only close.

### Waiting Reply (`WaitingReply.tsx`)
**Adds**
- Per-card **"Maili Aç"** and **🔔 reminder** buttons, with "Yanıtla" as a tonal button.
- "Son: {deadline}" prefix.
- Hides empty groups.
- Hours vs days formatting ("4 sa" / "2 gün").
- YAKINDA tone blue `#E5F2FF` / `#0051A8`. Primary uses neutral; primary wins.

**Adopt:** the reminder and open-mail affordances, as swipe or overflow to keep primary's minimal card.

### Commitments (`SECONDARY/src/screens/plan/CommitmentTracker.tsx`; lives under Plan)
**Adds**
- Header strip "AI e-postalarından tespit ettiği N açık taahhüt var." (dynamic count).
- Status labels "Bekliyor / Tamamlandı / Gecikti".
- "KİME" / "TARİH" columns, with overdue dates in red.
- **Actions hidden for done items.** Adopt.
- **"Ertele" sheet:** "Yeni bir tarih seç:" with "Yarın", "2 gün sonra", "Önümüzdeki hafta", "Özel tarih" (**dead button**), a date input and "Kaydet". Success "Ertelendi" is fake. Recommend the primary SmartReminderSheet or a date sheet instead.
- "Kaynağı Gör" goes to a generic email-detail (wrong; must open the specific source).
- Places Commitments under the Plan IA. Primary puts it in 04 Akış; it is reachable from the TAAHHÜT feed card.

### Cards (`SECONDARY/src/components/cards/*`)
- **InsightCard:** Badge (KRİTİK / YAKLAŞAN / SON TARİH / BİLGİ / TAMAMLANDI, 9–10px), title 15/500, SourceTag, divider, tonal action buttons, "Tamamlandı" as a local dismiss, "Neden önemli?" sheet, 👍/👎 feedback.
  - Adopt: the why-sheet and feedback concept. Restyle to primary: badge vocabulary ACİL / SON TARİH / GÜVENLİK etc.; no emoji; Material Symbols `thumb_up` / `thumb_down`, or route to the correct sheet.
- **LifeCard:** 40 tile tinted with `color+'18'`, title/detail truncated, colored time, single action.
  - Primary LifeCard (two actions, neutral tile) wins. Secondary actions "Ödeme Yap" (implies payment; not allowed), "Uçuş Detayı", "Yönet" (subscription manage handoff; useful), "Detaylar".

### SourceTag (`SECONDARY/src/components/special/SourceTag.tsx`)
- A provider-colored chip: 5px dot plus 11px text; Gmail `#EA4335`, Outlook `#0072C6`, Calendar `#34A853`, Apple `#007AFF`; optional onClick.
- Primary deliberately uses a neutral `#9B978E` text source. **Keep primary visuals** but adopt the **tappable** behaviour (source → WhySheet / original).

### SmartReminderSheet (`SECONDARY/src/components/ui/SmartReminderSheet.tsx`)
**Adds**
- Title "Hatırlatıcı".
- Context box (grey, 13px).
- Kicker "NE ZAMAN HATIRLATAYIM?"
- Options: "30 dakika sonra", "1 saat sonra", "Bu akşam · 19:00", "Yarın sabah · 08:00", "Uygun zamanda", "**Kendin seç**" (§29 wording).
- Selection state plus an explicit **"Hatırlatıcı Oluştur"** CTA, disabled until valid.
- Smart explanation "✨ Takvimindeki boşluklara göre uygun zamanı Dijital Asistan seçer."
- Custom picker "TARİH VE SAAT SEÇ" (date plus time, default 09:00).
- Success "Hatırlatıcı Oluşturuldu" (fake, 1.4s).

**Differences vs primary**
- "sonra" vs "önce" semantics.
- "Kendin seç" vs "Özel zaman".
- Explicit CTA vs row-tap commit.
- Primary shows the computed smart time and reason inline ("Takvimine göre: 13 Eylül Cumartesi 10:00"), which is better.

### ApprovalCenter (`SECONDARY/src/screens/shared/ApprovalCenter.tsx`)
**Adds**
- Title "Onay Bekleyenler"; intro "AI bu işlemleri yapmak istiyor. Onayın olmadan gerçekleştirmeyecek."
- Card sections "NE YAPILACAK" / "NEDEN" / "DEĞİŞİKLİK" (italic inset).
- Buttons "Onayla" (flex 2) / "Düzenle" / "**Reddet**" (`#FFEEED` / `#C0251B`). §33 names "Reddet"; the primary capture sheets use "Vazgeç". Use "Reddet" in Onay Merkezi and "Vazgeç" for the capture batch cancel.
- Edit sheet "Eylemi Düzenle" / "AI'nın yapacağı eylemi düzenle:" (free-text) / "İptal" / "Kaydet ve Onayla".
- Empty "Tüm işlemler onaylandı!" / "Bekleyen AI işlemi yok."
- Types send-email, create-event, move-event, create-task, set-reminder. Map these to the §33 enum and add `commitment_create`.

**Do not copy**
- Free-text editing of an action: replace it with typed editors per action type.
- Local-only approve/reject with timeouts.
- No source or destination fields.

### States (`SECONDARY/src/screens/states/*`) relevant to 04
- Empty:
  - "Her şey kontrol altında." / "Dikkat gerektiren önemli bir mail yok." (Mail Akışı)
  - "Bekleyen takip yok." / "Tüm açık konular kapatıldı."
  - "Mailini bağla." / "Gmail veya Outlook bağlayarak önemli konuları burada görebilirsin."
- Errors:
  - "Bağlantı süresi doldu." (Yeniden Bağlan / Daha Sonra)
  - "Erişim izni reddedildi."
  - "AI şu an meşgul." (Yenile)
  - "İnternet bağlantısı yok." (Tekrar Dene)
  - "Senkronizasyon gecikiyor." (Arka Planda Dene / Tamam)
- Loading: `EmailCardSkeleton` (36 avatar, two lines, pill 52×18, two body lines); stepped analysis text; "Gmail · Son güncelleme: az önce".
- Primary 08 copy wins where both exist. Use secondary only for gaps: offline "İnternet bağlantısı yok." / "Çevrimiçi olduğunda her şey otomatik olarak güncellenir." and "Mailini bağla." (not-connected).

### UniversalCapture (`SECONDARY/src/screens/shared/UniversalCapture.tsx`)
- Adds nothing structurally beyond primary: Fotoğraf / PDF / Link tiles plus textarea "VEYA METİN YAPIŞTIR" plus "AI ile Analiz Et".
- **Entirely fake:** tiles inject sample text and a timer runs analysis; every result action navigates to approval-center without creating anything. Primary 4.10–4.14 supersedes it.

---

## Reusable components observed (primary, for native RN implementation)

| Component | Anatomy / variants | Props implied | Exact styling |
|---|---|---|---|
| **LargeTitleHeader** | Title + optional trailing pill / avatar | `title`, `trailing` | 28/34 w600 −.02em; row padding 0 20 |
| **NavHeader** | Leading circle (back / close), centered kicker, trailing circle(s) or 36 spacer | `leading: back\|close`, `kicker?`, `actions[]` | circle 36, `#fff`, shadow `0 1px 2px rgba(27,25,23,.08)`, icon 20; kicker 12/600 +.08em `#9B978E` caps |
| **PillButton** ("Ekle") | Icon + label | `icon`, `label`, `onPress` | 36h, pad 0 12 0 8, radius 999, `#fff`, `#4547C9` 12/600, icon 18; dark `#1F1E1B` / `#A9AAF5` + ring `rgba(255,255,255,.08)` |
| **FilterChip / FilterChipRow** | Selected / unselected; horizontal scroll | `options[]`, `value`, `onChange` | 34h pad 0 14 radius 999 13/600; sel `#1A1917` / `#fff`; unsel `#fff` / `#6B6860`; dark unsel `#1F1E1B` / `#A39F96`, sel `#F2F0EB` / `#141311`; gap 8 |
| **MetaLine** | Counts + last analysis | `total`, `important`, `lastAnalysisAt` | 13px `#6B6860` ("10 konu · 5 önemli · Son analiz 09:40") |
| **AttentionCard** (feed) | Icon tile · source · badge · time / title / summary / action; swipeable | `kind`, `icon`, `source`, `badge{code,tone}`, `time`, `title`, `summary`, `action{label,onPress}`, `onPress`, `onSwipe`, `onLongPress(why)` | `#fff` radius 20 pad 14/16/10, card shadow; tile 28 r9 `#F0EFEB` / `#6B6860` icon 17; src 12 `#9B978E`; title 16/22 w600 −.01em; sum 14/20 `#6B6860`; action 14/600 `#4547C9`; dark variant per 4.2 |
| **StatusBadge** | tones critical / warning / neutral / success / info; light and dark | `label`, `tone`, `size` | 11/700 +.05em pad 3/8 (header variant 4/9) radius 999; colors per `T` / `TD` |
| **SwipeableRow** | Right Tamamlandı; left Ertele + Önemli değil | `onComplete`, `onSnooze`, `onDismiss` | green `#2FA062` 96px; left group 168px on `#F0EFEB` / `#E9E7E1`; threshold 35%, 260ms spring, haptics |
| **AICard** | Kicker (auto_awesome + LABEL) / title or summary / bullets / chips / context / source line | `kicker`, `title?`, `body?`, `bullets?`, `chips?`, `context?`, `source?` | radial `#E4E4FA` → `#FFFFFF` 60%, radius 20, pad 16, card shadow; kicker 12/600 +.06em `#5B5CE2`; summary 17/24 w500; title 20/26 w600 −.02em; bullet dot 6 `#5B5CE2` |
| **SectionKicker** | Caps label | `text` | 12/600 +.08em `#9B978E`, pad 0 4 or 4 4 0 |
| **GroupedList + CategoryRow** | 30 tile · label · count · chevron | `icon`, `label`, `count`, `hot`, `onPress` | card radius 18 pad 4/16; row pad 12 0 hairline; tile r10 (hot `#EDEDFC` / `#4547C9`); label 15/500; count 15/600 (hot `#5B5CE2`); chevron 18 `#C9C5BC` |
| **StackedBar** | 3 segments | `segments[{pct,color}]` | 8h radius 4 gap 2; `#5B5CE2` / `#C9C7F3` / `#E9E7E1` |
| **HeroStat** | Big number + unit + headline + sub | `value`, `unit`, `headline`, `sub` | 44/48 w600 −.03em; unit 17 `#6B6860`; headline 22/28 w600 with accent number `#5B5CE2` |
| **MailSummaryCard** | Avatar 28 · name · badge? · time / body / action | `person`, `badge?`, `time`, `body`, `action` | radius 20 pad 14/16/10; name 13/600; body 15/21; action 14/600 `#4547C9` |
| **Avatar** | Initials circle; sizes 22 / 28 / 40 / 44 | `initials`, `palette`, `size` | palettes: `#F5E1D6` / `#7A3E1F`, `#E3EFE6` / `#1E5A36`, `#DCE4F5` / `#2B3F73`, `#F0EFEB` / `#6B6860`; text 10 / 11 / 13 / 15 w600 |
| **SenderHeader** | Avatar 44 + name + VIP star + meta | `person`, `vip`, `meta` | name 16/600 −.01em; star 16 FILL `#5B5CE2`; meta 13 `#6B6860` |
| **ActionTileGrid** | 2×2; primary + secondary | `actions[{icon,label,primary}]` | 56h pad 0 14 radius 16 14/600 icon 20; primary `#5B5CE2` / `#fff`; secondary `#fff`, icon `#5B5CE2`, small shadow; gap 10 |
| **Accordion** ("Orijinal Mail") | Header 52h + body | `title`, `icon`, `expanded`, `children` | radius 18; header 15/600; chevron `expand_more` / `expand_less` 22 `#9B978E`; body 14/21 pre-wrap, top hairline; anim 280ms / 200ms |
| **SourceLine** | verified icon + text; tappable | `text`, `onPress(why/original)` | icon 16, 12px `#9B978E`, pad 0 4 |
| **SegmentedControl** | 4 segments | `options`, `value` | track `#E9E7E1` r999 pad 3; seg 32h 13/600; sel `#fff` + shadow `0 1px 3px rgba(27,25,23,.12)` |
| **DraftEditorCard** | Kicker + "Düzenlenebilir" / editable body / assist chips | `tone`, `value`, `onChange`, `chips` | `#fff` r20 pad 18 flex 1; body 15/23; caret `#5B5CE2` |
| **RecipientChip** | Avatar 22 + name | `person` | 30h pad 0 10 0 4 r999 `#fff` small shadow, 600 |
| **AssistChip** | neutral / soft-indigo / ink-selected; optional icon | `icon?`, `label`, `tone`, `selected` | 30h pad 0 10 r999 12/600 icon 15; neutral `#F0EFEB` / `#6B6860`; soft `#EDEDFC` / `#4547C9`; selected `#1A1917` / `#fff`; white + small shadow |
| **TonalButton (sm)** | soft / neutral / ghost | `label`, `icon?`, `tone` | 38h pad 0 12 r12 13/600; soft `#EDEDFC` / `#4547C9`; neutral `#F0EFEB` / `#6B6860`; ghost `#6B6860` |
| **PrimaryButton / SecondaryButton** | lg 52h r16; md 48h r14; ink variant | `label`, `icon?`, `loading`, `disabled` | primary `#5B5CE2` / `#fff` 15/600, shadow `0 8px 24px rgba(91,92,226,.28)`; secondary `#fff` small shadow; ink `#1A1917`; text-only "İptal" 48h 14/600 `#6B6860` |
| **AssuranceNote / HintRow / PrivacyNote** | icon + text | `icon`, `text`, `tone` | assurance `verified_user` 18 `#1E7A47` + 13 `#6B6860`; hint `psychology` 18 `#5B5CE2` + 13/19; privacy `lock` 16 + 12 `#9B978E` |
| **PersonActionCard** (follow-up) | avatar 40 · name / topic · days pill / status / src / 3 buttons | `person`, `topic`, `days`, `status`, `src`, `actions` | r20 pad 16; name 16/600; days pill 26h pad 0 9 12/600 (≥3 d amber, ≥7 d coral) |
| **UrgencyGroup** | Dot + caps title + list | `title`, `color`, `dot`, `items` | dot 6; title 12/600 +.08em; list gap 10 |
| **WaitingCard** | avatar 40 · name · wait / topic / expectation / deadline · action | … | r18 pad 14/16; name 15/600; expect 14/20; deadline 12/600 tone |
| **CommitmentCard** | badge · date / Lora quote / label-value rows / actions | `status`, `date`, `quote`, `what`, `who`, `src`, `confidence` | quote Lora italic 16/24 `#1A1917`; label col 52 `#9B978E` 13 |
| **LifeCard** | 44 tile · kicker · time / title / sub / 2 text actions | `kind`, `tone`, `title`, `sub`, `a1`, `a2` | tile r14 icon 22; kicker 11/700 +.08em; title 17/23 w600; actions 13/600 (`#4547C9` / `#6B6860`), gap 14 |
| **CaptureSourceTiles** | 4 tiles, selected state | `value`, `onSelect` | 64h r16 12/600 icon 22; sel `#EDEDFC` / `#4547C9` |
| **CaptureTextField** | multiline; focus grow; ring | `value`, `placeholder` | idle min-h 52 r16 15px placeholder `#9B978E`; focused min-h 140 r20 17/25, ring `0 0 0 2px #5B5CE2` |
| **UrlField** | icon + text + caret; ring | `value` | 52h r16, ring 2px `#5B5CE2` |
| **MediaPreview + DetectionBox** | image / PDF page with overlay boxes + tags | `uri`, `boxes[{rect,label}]` | box 2px `#5B5CE2` r8 (r6 small); tag 10/700 +.06em `#5B5CE2` on `#EDEDFC` r4 |
| **LinkPreviewCard** | compact (56 thumb) / hero (160 og:image) | `domain`, `title`, `image` | r20; domain 12 `#9B978E`; title 15/600 |
| **AnalysisProgressCard** | spinner kicker + step rows (done / active / pending) | `title`, `steps[{label,meta,status}]` | spinner 16 / 22 border 2 `#D9D6F7` top `#5B5CE2` .8s; done `check_circle` FILL `#2FA062` 22; pending ring 22 `#C9C5BC` @ .4 |
| **ExtractedItemRow** | type tile · kicker · title · source / reason · select | `type`, `title`, `sourceRef`, `note`, `selected` | tile 30 r10; types: deadline `#FDF2DC` / `#9A6300`, event `#E7F0FD` / `#2262BE`, task `#F0EFEB` / `#6B6860`, reminder `#FDF2DC` / `#9A6300`; kicker 11/700 +.06em; title 15/21 w500; select `check_circle` FILL `#5B5CE2` / `radio_button_unchecked` `#C9C5BC` |
| **EntityHighlightText + Legend** | inline spans by entity type | `text`, `spans[]` | span r5 pad 1/4; zaman `#E7F0FD` / `#2262BE`; kişi `#EDEDFC` / `#4547C9`; görev `#F0EFEB` / `#6B6860`; hatırlatıcı `#FDF2DC` / `#9A6300`; legend 10×10 r3, 11px |
| **StickyCTABar** | gradient fade + primary(count) + secondary | `primaryLabel`, `count`, `secondary` | pad 16 20 44; `linear-gradient(180deg,rgba(245,244,240,0) 0%,#F5F4F0 45%)` |
| **BottomSheet** | grabber / title / sub / content / actions | `title`, `subtitle`, `children` | scrim `rgba(27,25,23,.35)`; `#fff` r28 top; pad 10 20 44; grabber 36×5 `#E0DED7`; shadow `0 -10px 40px rgba(27,25,23,.12)`; title 19/600 −.01em; sub 13 `#6B6860`; `@gorhom/bottom-sheet@5.2.14` |
| **OptionRow** (reminder) | icon · label · meta / chevron / check; AI-highlight variant | `icon`, `label`, `meta`, `ai`, `selected`, `disabled` | min-h 52, hairline; icon 20 `#6B6860` w24; label 15/500; meta 12 `#9B978E`; AI: bg `#F7F7FE` r12 min-h 60, meta 12/600 `#4547C9` |
| **FileRow** | PDF tile · name · meta · radio | `file`, `selected` | min-h 60; tile 36 r11 (sel `#FCEDE9` / `#C7432F`) |
| **ApprovalRow** | type tile · kicker · title · meta / Neden-Değişim grid · check | `actionType`, `what`, `why`, `change`, `destination`, `sideEffect`, `selected` | tile 28 r9 `#EDEDFC` / `#4547C9`; kicker 11/700 +.06em `#6B6860`; title 15/600; grid cols 56px / 1fr, 12/17 |
| **SuccessState** | ring + title + sentence + result chips + CTA | `title`, `body`, `chips`, `cta` | ring 96 `#E4F5EA`, `check_circle` 48 FILL `#1E7A47`; title 26/600; body 15/22 `#6B6860` |
| **UndoToast** | icon + message + "Geri al" | `message`, `onUndo`, `duration=5000` | ink `#1A1917` r999 pad 12/18/12/14 14/500; icon + action `#A9AAF5`; shadow `0 10px 30px rgba(27,25,23,.25)`; bottom 104 |
| **TabBar** | 4 tabs | `active` | 90h blur (`expo-blur@57.0.3`); active `#5B5CE2` FILL icon; labels 11/500 |

**Implementation packages** (npm, checked today)
- `expo@57.0.24`
- Icons and fonts: `@material-symbols/svg-400@0.47.5` (SVG, supports filled variants; RN cannot drive variable FILL axes, so ship outlined and filled SVGs), `react-native-svg@15.15.5`, `@expo-google-fonts/geist@0.4.2`, `@expo-google-fonts/lora@0.4.2`
- Lists and gestures: `@shopify/flash-list@2.3.2`, `react-native-gesture-handler@3.3.0`, `react-native-reanimated@4.7.0`, `@gorhom/bottom-sheet@5.2.14`, `expo-haptics@57.0.3`
- Capture inputs: `expo-clipboard@57.0.2`, `expo-document-picker@57.0.2`, `expo-image-picker@57.0.19`, `expo-media-library@57.0.5`, `expo-contacts@57.0.6`, `expo-calendar@57.0.4`
- Handoff and notifications: `expo-web-browser@57.0.3`, `expo-linking@57.0.10`, `expo-notifications@57.0.20`
- Share: `expo-share-intent@8.0.1` / `expo-share-extension@5.0.6`

---

## Open issues / inconsistencies

### Within the file
1. **The same urgent thread has two senders.**
   - 4.1, 4.3 and 4.7: "Ahmet Yılmaz" (AY, `#F5E1D6` / `#7A3E1F`).
   - 4.4 and 4.5: "Mehmet Yılmaz" (MY, `#DCE4F5` / `#2B3F73`, body signed "Mehmet", subject "Re: Eylül teklifi – revize fiyat").
   - The main prototype's Mail Detay uses Ahmet. Mehmet is separately the 14:30 meeting person and the follow-up recipient.
   - Secondary has the same bug (`sender:'Ahmet Yılmaz'`, `aiSummary:'Mehmet, …'`).
   - Fix fixtures: Ahmet = urgent revize request; Mehmet = meeting / follow-up / contract.
2. **Mail Zekâsı arithmetic doesn't add up.**
   - 83 total and "6 tanesi dikkat" vs category counts 3+2+1+2 = **8** (8+31+44 = 83).
   - "77'sini okudum; 44 + 31" = **75**.
   - Bar 7/37/53% corresponds to 6/31/44 (sum 81).
   - Decide whether categories are mutually exclusive (primary category) or multi-label, and derive every number from one query.
3. **"ÖNEMLİ · 3" list** contains a "Senden cevap bekleyen" item (Selin) and a "Son tarih içeren" item (Girişim), so it is not "Önemli".
4. "Senden cevap bekleyen **2**" (4.3) vs "**4** kişi cevabını bekliyor" (4.7).
5. **Follow-up badge rule** ("3 günden sonra amber, 7 günden sonra coral") is violated: Kerem "6 gün" is coral. Secondary uses >5 = red. Pick one threshold set and make it configurable.
6. **Commitment date "Cuma · 3 Eyl"**: 3 Sept 2025 was a Wednesday. If "Cuma" = 5 Sept (today), the status should be BUGÜN, not GECİKMİŞ. The header "3 açık, 1 gecikmiş" is ambiguous (does "açık" include overdue?).
7. The feed TAAHHÜT card ("“Yarın göndereceğim” dedin", source "Toplantı notu", due "Yarın") and the Commitments card ("Cuma teklif göndereceğim", Gmail 1 Eyl, GECİKMİŞ) describe the same Mehmet promise with different quotes, sources and due dates.
8. **Electricity bill due date**: "10 Eylül" (4.1, 4.9) vs "15 Eylül" (4.11 capture). The 4.11 "Uygun zamanda: 13 Eylül Cumartesi 10:00" would be after a 10 Eylül due date.
9. **"96 karakter"** chip vs the actual text length of 85.
10. **"Deadline 17:00"** in key points is English in a Turkish UI. Use "Son tarih 17:00" (§39).
11. The feed card action says **"Yanıtla"** while 4.3/4.4 and §15 say **"Yanıt Hazırla"**. Standardize (recommend "Yanıt Hazırla" wherever it opens a draft).
12. **4.10 CTA "Takvime Ekle"** writes directly, bypassing the "N Öğeyi Onaya Gönder" → approval-sheet pattern used by 4.12c/4.13c/4.14c. 4.10 also lacks the top text field that 4.12a defines as part of the Ekle entry.
13. **Approval row fields differ**: 4.12d shows ne · nereye · meta with no "Neden"; 4.13d shows ne · neden · değişim; the footnotes contradict each other ("ne · nereye · ne değişecek" vs "ne · neden · ne değişecek"). §33 requires what, why, source, exact change, destination/account and side effect: use the union everywhere. 4.12d tiles are all indigo while 4.12c uses type colors.
14. **Reminder presets**:
    - Primary "Özel zaman" vs §29 and secondary "Kendin seç".
    - Primary "30 dakika önce / 1 saat önce" (anchor-relative) vs secondary "… sonra" (now-relative).
    - 4.11 shows "—" for those rows because the bill has no due time; define the disabled or fallback behaviour.
    - "Yarın sabah 08:00" vs the prototype toast "Yarın 09:00'da hatırlatırım".
15. **The reminder sheet has no confirm CTA** (row tap commits), while secondary has "Hatırlatıcı Oluştur". §29 requires confirmation or approval. Treat row tap as explicit user confirmation; AI-initiated reminders go through Onay Merkezi.
16. The **Mail Zekâsı entry point is missing** in primary Akış (secondary has "Mail Özeti"). The category drill-down list and the search destination are not designed.
17. The **Akış header lacks the profile avatar** required by §8 (secondary has it).
18. The 4.2 dark meta line drops "Son analiz …" that 4.1 shows.
19. "Takip etme" is referenced in the 4.6 hint, but no control exists anywhere in 04.
20. The 4.5 **"Düzenle"** button duplicates inline editing (the draft is already "Düzenlenebilir" with a caret). Define it or remove it.
21. The 4.8 **TAMAMLANDI** card shows the same Tamamlandı / Ertele / Kaynağı Gör actions as open items.
22. The 4.12c action chips ("Takvime Ekle · 1", …) duplicate the per-row checkboxes with undefined semantics. "Mehmet'e bağla" is outside the counted items.
23. "3 tarih bulundu" (4.12b) vs "3 tarih ve 1 yükümlülük" vs 3 items, one of which is an AI-invented task.
24. **4.9 "Kişisel" (a pushed screen with a back button) vs the Akış Kişisel filter (4.2)**: two representations of the same data with different card templates. Define which is canonical and where 4.9 is entered from (Bugün Life section "Tümü"?).
25. The 4.14d success CTA "Bugün'e Dön" and the 4.13d footnote "Bugün'e dönüş" should return to the originating screen (e.g. Akış).
26. Only one dark artboard (4.2) exists; every other 04 screen needs dark specs (§38).

### Vs MASTER_PROMPT and truthfulness
27. **§83 hallucination risks shown as facts**:
    - "2 bilet · 1.450 TL" (4.13c)
    - "Teklif_v3.pdf ekle" (the file doesn't exist; only Teklif_v2.pdf)
    - "Son 30 günde 2 kez izlendi" (Netflix usage not in mail)
    - "Okundu, yanıt yok" (recipient read state not available)
    - "Hukuktan … 12 Eylül'e kadar" (unsourced due date)
    - "Geçen ay 1.610 TL" (needs a prior-bill source)
    - Each must carry a source or be removed. Suggestions must be visibly labelled as suggestions.
28. **§90 external dependencies hidden in copy**: "06:45'te evden çıkman gerekebilir", "19:10'da çıkman gerekebilir", "yol süresi". These need location permission plus a routing API key. Hide them when unavailable.
29. **Privacy copy must be true (§40)**: "Belge cihazında özetlenir" is false for a server/LLM pipeline. "Sayfa yalnızca bir kez okunur; çerez veya oturum paylaşılmaz" must be enforced in the fetcher (§84).
30. The AI Reply success copy (prototype) "yanıtını aldı" claims delivery. Only "gönderildi" is verifiable.
31. **"Geri al" after external side effects** (4.14d invite already "gönderildi"): needs a deferred-execution window or compensating actions (§115, §127). The success copy must follow the real executed state (§98).
32. **§33 statuses** executing / executed / failed / expired are not depicted anywhere in 04. The capture batch approval vs the Onay Merkezi single-item approval are two paths that must write the same `approval_requests` rows with idempotency.
33. **§14 explainability**: no reason / confidence / rule display for classifications (ACİL, Önemli). **§131** "Bu nereden çıktı?" is only passive source text. Add a WhySheet (secondary InsightCard pattern plus the primary "correct" sheet).
34. **§15 "Orijinali Maili Aç"** (provider handoff) is missing in primary; only the inline original exists.
35. **§18 commitment confidence and ambiguous-confirmation UI** are missing.
36. **§23 / §36 sources**: "Mail ve bildirimlerinden türetilen", "Mesaj · 4 Eyl". Notification and SMS sources are Android-only (notification listener); iOS copy must not claim them.
37. **§27 source "File"** (non-PDF files) is not represented. Tiles are Fotoğraf / Ekran görüntüsü / PDF / Link plus the text field. Price tracking (4.13c "ürün seçilirse … fiyat takibi") is a feature outside the master prompt scope (§139).
38. **§99 dead-action risks**: "Kapıya Not Bırak" (no carrier API), "Cüzdana Ekle" (only with a pkpass), "Teyit Et" (handoff only), "96 karakter" chip styled like a button, "Düzenle" (undefined).
39. **§93 states** (loading / empty / error / offline / retry / reconnect / partial) are absent from every 04 artboard. Primary 08 provides generic copy (listed per screen above) that must be specialized per screen.
40. **Secondary bugs to avoid**:
    - Inverted Mail Intelligence category routing.
    - Flow "Takip" filter = deadline.
    - No-op action buttons.
    - Fake success timeouts (task, reminder, send, reschedule, approve).
    - Free-text approval editing.
    - "Ödeme Yap".
    - Real-brand fixture "Nusr-Et Beşiktaş".
    - Netflix 149,99 TL vs primary 229,99 TL (primary wins).
41. **Real brands in demo fixtures** (Trendyol, Yurtiçi Kargo, THY, CK Enerji, Netflix, biletix, Zorlu PSM, Karaköy Lokantası, Google): acceptable behind the demo flag (§89). Review before marketing or store screenshots (§74, §112).
42. **Interactive prototype fakes in `Dijital Asistan.dc.html`**: a 900ms fake send; "Hatırlatıcı kuruldu" toasts with nothing scheduled; "Kargo takibi açıldı" / "{action} · Kaynak açıldı" toasts; "Düzenleme Plan sekmesinde açılır"; the capture toast in place of a real composer. None should ship (§4, §100).
43. **Gmail scope implications**: reading bodies and attachments (4.4, 4.12a) needs a restricted Gmail read scope, which means Google verification plus a security assessment. Send (4.5) needs `gmail.send`; "Taslağı Gmail'e aktar" needs compose. Outlook paths need Graph `Mail.Read` / `Mail.Send`. Deep links:
    - Graph `message.webLink` (Outlook).
    - Gmail web URL `#search/rfc822msgid:` (verify).
    - I could not verify either online (developers.google.com and learn.microsoft.com are blocked by the sandbox egress proxy).

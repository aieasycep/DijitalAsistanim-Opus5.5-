# Audit: PRIMARY 07 / 08 / 09 and the matching SECONDARY settings, states and marketing screens

## 0. Scope, sources and shared frame conventions

**Files read in full (template and data script):**
- `PRIMARY/07 Hesap Gizlilik Pro.dc.html`: 12 artboards, 7.1 to 7.12. Data consts: `SETTINGS`, `PRIV`, `READS`, `PLAN`, `RULES`.
- `PRIMARY/08 Durumlar Widgetlar Etkilesimler.dc.html`. Data consts: `EMPTIES`, `ERRORS`, `MOTION`, plus the skeleton factory `sk()` and `spin`.
- `PRIMARY/09 Pazarlama.dc.html`: 6 store screenshots and 3 ads. **It has no data script**; everything is inline.

**Other PRIMARY artboards that cover the topics I was assigned.** I summarized them in §C. Other auditors own them.
- `02 Onboarding` 2.9 Brifing Ayarları
- 2.12 Bildirim İzni Açıklayıcı
- 2.13 Android · Telefon Bildirimleri
- `06` 6.9 AI Kişiselleştirme
- `03` 3.8 “Dijital Haftam” paylaşım kartı 1080×1350
- The Profile and Paywall screens inside `Dijital Asistan.dc.html` (the interactive prototype)

**SECONDARY files read:** all of `src/screens/settings/*` (14 files), `src/screens/states/*` (6), `src/screens/marketing/*` (9), and `src/data/mock.ts` (`weeklyStats`).

**PRIMARY has no design at all for these (verified by grep):**
- Notification Settings detail (§35/§86)
- Connected-account detail ("Yönet")
- Subscription management
- Delete-account flow
- Export status
- Help
- Feedback
- Edit profile
- Landing / marketing website (§73)
- Pricing web visual
- Google Play feature graphic

### Shared frame and tokens used on every 07 phone artboard
These define the RN design tokens. The phone frame itself is not implemented.

**Screen**
- Background `#F5F4F0` (neutral/bg). Artboard frame is 390×844, radius 44. The status bar is 54px (frame only).
- Top bar: a 36×36 circular button, `#FFFFFF`, shadow `0 1px 2px rgba(27,25,23,.08)`, holding a 20px Material Symbols Rounded icon (`close` or `arrow_back`). A 36px spacer sits on the right, or a centered kicker `12/600 .08em #9B978E`.
- Content padding `6px 20px 40px`, vertical gap 16 (18 on some screens).
- Page title (h1): Geist 28/34, weight 600, letter-spacing −.02em. Subtitle: 14/20 `#6B6860`, margin-top 4.

**Grouped list**
- Section kicker: 12px, weight 600, letter-spacing .08em, uppercase, `#9B978E`, padding `0 4px 8px`.
- Card: `#FFFFFF`, radius 18, padding `0 16px`, shadow `0 1px 2px rgba(27,25,23,.04), 0 6px 20px rgba(27,25,23,.05)`.
- Row: min-height 50 (52 or 56 on some screens), gap 12.
  - Leading icon: 20px `#6B6860`, 24px wide.
  - Title: 15/500 `#1A1917`.
  - Value: 13px `#9B978E`.
  - Chevron: `chevron_right` 18px `#C9C5BC`.
  - Divider: `border-top: 1px solid rgba(27,25,23,.06)` on every row except the first (the `wb()` helper).
- Destructive row: icon and text `#C7432F`.

**Controls**
- Toggle: 50×30, radius 15. On `#5B5CE2`, off `#D9D6D0`. Knob 26×26 white with shadow `0 1px 3px rgba(0,0,0,.2)`, left position 2px (off) or 22px (on). A disabled or off rule row uses opacity .55.
- Radio selected: `check_circle`, FILL 1, 22px, `#5B5CE2`. Unselected: `radio_button_unchecked` 22px `#C9C5BC`.

**Buttons**
- Primary: height 52, radius 16, `#5B5CE2`, white 15/600, shadow `0 8px 24px rgba(91,92,226,.28)`.
- Text or ghost: height 44, radius 14, `#6B6860` 14/600.
- Destructive: height 52, radius 16, `#C7432F`.
- Ink: height 52, radius 16, `#1A1917`.
- Sticky bottom CTA container: `padding:16px 20px 44px`, background `linear-gradient(180deg, rgba(245,244,240,0) 0%, #F5F4F0 45%)`.

**Badge / pill:** 11px, weight 700, letter-spacing .05em, padding 3×8, radius 999.
- Critical: `#FCEDE9` on `#C7432F`
- Warning: `#FDF2DC` on `#9A6300`
- Success: `#E4F5EA` on `#1E7A47`
- Neutral: `#F0EFEB` on `#6B6860`
- Brand: `#EDEDFC` on `#4547C9`

**Fonts:** Geist 300–700 for UI; Lora for editorial; `ui-monospace` for links and specs; Material Symbols Rounded (opsz 20–48, wght 300–600, FILL 0–1) for icons.
- RN options: `@expo-google-fonts/geist` 0.4.2, `@expo-google-fonts/lora` 0.4.2, `@expo-google-fonts/geist-mono` 0.4.3.
- Icons: `@material-symbols/svg-400` 0.47.5 (SVG, FILL0 and FILL1 as separate sets). This is more reliable than a variable font in RN, because RN cannot drive the FILL axis.

**Dark tokens** (from `01` `DARK`, needed for every screen below):

| Token | Value |
|---|---|
| bg | `#141311` |
| surface | `#1F1E1B` |
| surface-2 | `rgba(255,255,255,.08)` |
| text | `#F2F0EB` |
| secondary | `#A39F96` |
| tertiary | `#7A776F` |
| primary | `#8586F2` |
| primary-glow | `#A9AAF5` |
| critical-text | `#F08B78` |
| warning-text | `#F0B85A` |
| success-text | `#6FCF97` |
| on-primary | `#0F0F2A` |

- **None of the 07/08/09 phone artboards is drawn in dark mode.** Only the appearance preview tiles use dark colors.

**Fixture data used across the files** (production must replace it with real data):
- User "Yunus Emre", initial "Y".
- Date "5 EYLÜL CUMARTESİ". 5 Sep 2026 is indeed a Saturday.
- Contacts: Ahmet Yılmaz (Kuzey Lojistik), Mehmet Yılmaz (Yılmaz Endüstri), Selin Kaya, Burak Tan, Deniz Erol.

---

## A. PRIMARY 07 · Hesap, Gizlilik, Pro, Davet

The intent line in the file header: “Ayarlar iOS gruplu liste kalıbında ama ürünün kendi yüzeyleriyle. Gizlilik Merkezi bir ayar sayfası değil, ürünün güven vaadinin görünür hâli: ne okunuyor, ne okunmuyor, ne kadar saklanıyor, nasıl silinir. Paywall'da geri sayım, sahte indirim veya gizli “kapat” yok.”

### Profil ve Ayarlar / Profile & Settings hub
- **Source:** PRIMARY / `07 Hesap Gizlilik Pro.dc.html` / artboard 7.1 “Profil ve Ayarlar”. Data: `SETTINGS`.
- **Purpose:** the single hub reached from the avatar on Today (§8). It holds the Approval Center entry, the three settings groups, and sign out.
- **Layout, top to bottom:**
  1. Top bar with a `close` button, so it is presented modally.
  2. Identity row, gap 14:
     - Avatar: 60px circle `#1A1917`, white initial 22/600.
     - Name: 22/600, −.02em.
     - Sub-line (13px `#6B6860`): a PRO pill (`#EDEDFC`/`#4547C9`, 11/600, padding 2×8), then “Deneme · 5 gün kaldı”.
     - Trailing `edit` icon, 22px `#B8B4AA`.
  3. Approval Center card:
     - Ink `#1A1917`, radius 18, padding 14×16, gap 12.
     - `task_alt` 22px in `#A9AAF5`.
     - Title “Onay Merkezi” 15/600 white.
     - Sub-line 12px `rgba(255,255,255,.65)`.
     - `chevron_right` 20px at opacity .6.
  4. Three grouped lists (`ASİSTAN`, `HESAP`, `UYGULAMA`).
  5. “Çıkış Yap”: 48px high, centered, 15/600 `#C7432F`, no background.
  6. Footer: 12px `#9B978E`, centered.
- **Exact copy:**
  - Approval Center: “Onay Merkezi” / “2 işlem onayını bekliyor”
  - `ASİSTAN`:
    - “Brifing” · “08:00 · 13:00 · 19:00” (icon `wb_twilight`)
    - “Bildirimler” · “Sadece önemli” (`notifications`)
    - “Öncelik Kuralları” · “6 kural” (`tune`)
    - “Önemli Kişiler” · “6 kişi” (`star`)
    - “AI Kişiselleştirme” · “7 öğrenme” (`psychology`)
  - `HESAP`:
    - “Abonelik” · “Pro deneme” (`workspace_premium`)
    - “Bağlantılar” · “Gmail · Takvim” (`link`)
    - “Gizlilik ve Güvenlik” (`shield`)
    - “Arkadaşını Davet Et” · “+14 gün” (`person_add`)
  - `UYGULAMA`:
    - “Görünüm” · “Açık” (`contrast`)
    - “Dil” · “Türkçe” (`language`)
    - “Yardım” (`help`)
    - “Geri Bildirim” (`rate_review`)
  - “Çıkış Yap”
  - Footer: “Dijital Asistan 1.0 (240) · Sürüm notları”
  - Caption: “Üç grup: Asistan (davranış), Hesap (bağlantı ve gizlilik), Uygulama. Sağdaki değer sütunu mevcut durumu özetler; kullanıcı açmadan bilir.”
- **Data fields and the entity each implies:**
  - Name → `profiles.display_name`
  - Initial → derived from the name
  - PRO + “Deneme · 5 gün kaldı” → central entitlement: `subscriptions.status` (trial / active / grace / expired), `expires_at`, `source` (store / referral / admin)
  - Pending approvals count → `approval_actions` where `status='pending'`
  - Brifing times → `user_preferences.briefing_schedule` (morning, midday, evening, weekend)
  - Notifications summary → `notification_preferences.mode`
  - Rules count → `priority_rules`, count where `enabled`
  - VIP count → `vip_people` count
  - Learnings count → learned preferences (a separate table from `priority_rules`)
  - Subscription label → entitlement
  - Connections → `connected_accounts` (provider, status)
  - Referral reward → `referral_credits` sum
  - Theme → `user_preferences.theme`
  - Language → `user_preferences.locale`
  - App version and build → `expo-application` (`nativeApplicationVersion`, `nativeBuildVersion`)
- **Interactions and the real behavior each needs:**
  - Close → dismiss the modal.
  - Identity row / edit → Edit Profile screen (missing: name, email read-only from auth, timezone per §39).
  - Onay Merkezi → push Approval Center (§33).
  - Brifing → Briefing Settings (restyle 2.9 / secondary BriefingSettings). Midday and evening are Pro-locked for Free users.
  - Bildirimler → Notification Settings (missing in primary; see §D).
  - Öncelik Kuralları → 7.9.
  - Önemli Kişiler → VIP list (06 6.6).
  - AI Kişiselleştirme → 06 6.9.
  - Abonelik → if the user has the entitlement, a Subscription status screen (missing); otherwise the Paywall 7.5.
  - Bağlantılar → Connected Accounts list (missing as a standalone screen; secondary Integrations has the IA).
  - Gizlilik ve Güvenlik → 7.2.
  - Arkadaşını Davet Et → 7.7.
  - Görünüm → 7.8 (appearance part).
  - Dil → 7.8 (language part).
  - Yardım → Help (secondary IA only).
  - Geri Bildirim → Feedback form (secondary IA) → `support_tickets` / `ai_feedback` (§62).
  - Çıkış Yap → confirm, then:
    - Supabase `auth.signOut()`
    - delete this device's `push_tokens` row
    - clear SecureStore, React Query / MMKV caches and widget App-Group data
    - revoke nothing on the provider side
    - route to the auth screen
  - Sürüm notları → release-notes screen or web URL.
- **States depicted:** default only (trial Pro user, 2 pending approvals).
- **States missing in production:**
  - Free user: no PRO pill, plus an “Pro'ya geç” affordance.
  - Expired or grace-period subscription.
  - Pending count 0 → “Bekleyen işlem yok”.
  - Connection needing re-auth → warning value on Bağlantılar, e.g. “Yeniden bağlan”.
  - Loading placeholders for the value column.
  - Offline, with values served from cache.
  - Sign-out confirmation and in-progress state.
  - Dark mode: the ink card on a `#141311` background needs `#1F1E1B` plus a hairline.
  - Android-only row “Telefon Bildirimleri” (§36).
- **Prototype-only, do not copy:**
  - In the `Dijital Asistan.dc.html` prototype, rows without `go` fire `toast(r.t+' · Bkz. 07 Hesap')`.
  - `toastSignout` fires “Prototipte çıkış devre dışı”.
  - Every row must be wired (§99).
- **Maps to:** §130, §8, §33, §88, §99.

### Profil (prototype variant) / Profile, interactive prototype
- **Source:** PRIMARY / `Dijital Asistan.dc.html` / `isProfile` block. Data: `SETTINGS` (flat list of 12).
- **Differences from 7.1:**
  - Back arrow instead of close.
  - A single ungrouped list in this order: Abonelik, Brifing, Bildirimler, Öncelik Kuralları, Önemli Kişiler, Bağlantılar, AI Kişiselleştirme, Gizlilik ve Güvenlik, Görünüm, Dil, Yardım, Geri Bildirim.
  - “Önemli Kişiler · 4 kişi” (7.1 says 6).
  - “AI Kişiselleştirme” has no value.
  - The pending count is live (`{{ pendingCount }}`).
  - No version footer.
- **Decision:** the 7.1 grouped layout is canonical, since it is the dedicated artboard. Take the “Abonelik → paywall” and “Önemli Kişiler → person” wiring from the prototype.
- **Maps to:** §130.

### Gizlilik Merkezi / Privacy Center
- **Source:** PRIMARY / 07 / artboard 7.2 “Gizlilik Merkezi”. Data: `PRIV`.
- **Purpose:** make the trust promise visible and act as the hub for connected-account scopes, AI data access, retention, export and deletion.
- **Layout:**
  1. Back button.
  2. h1 plus subtitle.
  3. Promise card:
     - Ink `#1A1917`, white text, radius 24, padding 20, gap 12.
     - Three rows at 15/21, each with `verified_user` 20px in `#A9F0C1`. **`#A9F0C1` is not a token.**
     - The first row is bold.
  4. `BAĞLI HESAPLAR · 2` grouped card. Rows are 56px min, each with a 32×32 icon tile at radius 10:
     - Gmail: tile `#FCEDE9`/`#C7432F` with `mail`.
     - Calendar: tile `#E4F5EA`/`#1E7A47` with `calendar_month`.
     - Title 15/500, scope line 12px `#9B978E`, trailing “Yönet” 13/600 `#4547C9`.
  5. `VERİ` grouped card, 6 rows at 52px.
  6. Footer: `lock` 16px, then 12/18 `#9B978E`.
- **Exact copy:**
  - Title: “Gizlilik ve Güvenlik”
  - Subtitle: “Neyi okuduğumu, ne kadar sakladığımı ve nasıl sileceğini burada görürsün.”
  - Promises:
    - “**Verilerin reklamverenlere satılmaz.**”
    - “Önemli işlemler sen onaylamadan gerçekleştirilmez.”
    - “Mail içerikleri model eğitiminde kullanılmaz.”
  - Accounts:
    - “Gmail · yunus@…com” / “Okuma · Taslak oluşturma · Gönderme (onaylı)” / “Yönet”
    - “Google Takvim” / “Okuma · Etkinlik oluşturma/taşıma (onaylı)” / “Yönet”
  - `VERİ` rows:
    - “AI'ın eriştiği veriler” · “5 alan” (`visibility`)
    - “Veri saklama” · “90 gün” (`history`)
    - “AI kişiselleştirme” · “Açık” (`psychology`)
    - “Verilerimi dışa aktar” (`download`)
    - “Analiz geçmişini sil” (`delete_sweep`, coral)
    - “Hesabımı sil” (`person_remove`, coral)
  - Footer: “Uçtan uca TLS · Veriler AB'de (Frankfurt) saklanır · KVKK ve GDPR uyumlu”
  - Caption: “Üç vaat en üstte, koyu kartta. Bağlı hesaplar kapsamı düz Türkçe yazar (“Gönderme (onaylı)”). Tehlikeli işlemler coral metin ama aynı listede; gizlenmez.”
- **Data → entity:**
  - Account list → `connected_accounts` (provider, email masked as “yunus@…com”, `granted_scopes[]`, status). The plain-Turkish scope string is derived from the scopes.
    - Gmail scopes: `gmail.readonly` → “Okuma”, `gmail.compose` → “Taslak oluşturma”, `gmail.send` → “Gönderme (onaylı)”.
    - Calendar scope: `calendar.events` → “Etkinlik oluşturma/taşıma (onaylı)”.
  - “5 alan” → count of `user_preferences.ai_data_access` keys.
  - “90 gün” → `user_preferences.retention_days`.
  - “Açık” → `user_preferences.learn_from_interactions`.
- **Interactions:**
  - Yönet → Connected Account detail (missing). It needs: scopes granted, last sync (`sync_states`), “Yeniden bağlan”, “Bağlantıyı kaldır” with provider token revoke (Google `https://oauth2.googleapis.com/revoke`), and the per-source capability toggles from secondary DataSourceControl.
  - AI'ın eriştiği veriler → 7.3.
  - Veri saklama → 7.4.
  - AI kişiselleştirme → 06 6.9.
  - Verilerimi dışa aktar → create a `data_export_requests` row (async), then an export status screen (missing, §128).
  - Analiz geçmişini sil → 7.4 bottom sheet.
  - Hesabımı sil → account-deletion flow (missing, §129).
- **States depicted:** default only.
- **States missing:**
  - An account in re-auth-required state (coral “Yeniden bağlan”).
  - Zero accounts (“Hesap bağla” CTA).
  - Outlook / Microsoft accounts.
  - An export job in progress or ready.
  - A deletion job queued.
  - An OS Permissions section: notifications, microphone, camera, location, contacts — this is §40 “Permissions” (secondary has an İzinler sheet).
  - Privacy-policy link.
  - Dark variant of the ink card.
- **Prototype-only / claims to fix:**
  - “Uçtan uca TLS” reads as an end-to-end-encryption claim, which §40 forbids. Use “Veriler aktarım sırasında ve saklanırken şifrelenir.”
  - “Veriler AB'de (Frankfurt) saklanır” is true only if the Supabase region is eu-central-1. Make it config-driven.
  - “KVKK ve GDPR uyumlu” is a legal claim and needs legal backing. KVKK cross-border transfer rules apply, since TR user data would be stored in the EU.
  - “Mail içerikleri model eğitiminde kullanılmaz” must match the AI provider's data terms.
- **Maps to:** §40, §41, §75, §76, §128, §129.

### AI'ın Eriştiği Veriler / AI Accessible Data
- **Source:** PRIMARY / 07 / 7.3. Data: `READS`.
- **Purpose:** per-data-class access switches plus a fixed “never” list.
- **Layout:**
  1. Back button, h1, subtitle.
  2. Kicker `OKUR` in `#1E7A47`, then a card of 5 rows at 56px: icon 20 `#6B6860`, title 15/500, meta 12 `#9B978E`, toggle.
  3. Kicker `HİÇBİR ZAMAN OKUMAZ` in `#C7432F`, then a card with padding 4×16 and 4 rows at 48px: `block` 20px `#C7432F`, 15px text, not interactive.
- **Exact copy:**
  - Title: “AI neye erişiyor?”
  - Subtitle: “Bugün itibarıyla. Her satırı kapatabilirsin; kapattığın alanlar analize girmez.”
  - `OKUR` rows:
    - “Mail konu ve gövdeleri” / “Özetlemek için · Kopya tutulmaz” — on
    - “Ekler (PDF, görüntü)” / “Fatura ve teklif tespiti” — on
    - “Takvim etkinlikleri” / “Katılımcılar ve konumlar dahil” — on
    - “Kişiler” / “Yalnızca isim eşleştirme” — on
    - “Konum (yaklaşık)” / “Yol süresi tahmini için” — off
  - Never-list:
    - “Şifreler ve doğrulama kodları”
    - “Banka hesap numaraları ve kart bilgileri”
    - “Sağlık verisi (randevu saati hariç)”
    - “Mesajlaşma içerikleri”
  - Caption: “Okur / Hiçbir zaman okumaz ikiliği yeşil-coral başlıklarla; satırlar nötr. Hassas alan tespiti cihazda yapılır, kırmızı liste sabit ve kapatılamaz.”
- **Data → entity:** `user_preferences.ai_data_access = {mail_body, attachments, calendar, contacts, location_coarse}` as booleans. The AI pipeline (§80) must enforce these server-side before any LLM call.
- **Interactions:**
  - Each toggle → optimistic update of the preference, then the server pipeline filter. Show a consequence sheet when turning off core sources, e.g. mail body off disables summaries and AI reply.
  - Konum on → OS permission request (`expo-location` 57.0.19, foreground, approximate; Android `ACCESS_COARSE_LOCATION`; iOS reduced accuracy). If denied → a permission-denied row state with an “Ayarlar” link (`Linking.openSettings()`).
  - Kişiler → clarify the source: device contacts via `expo-contacts` 57.0.6, or provider contacts. It needs an OS permission when the source is the device.
- **States depicted:** a mix of on and off toggles.
- **States missing:**
  - OS permission denied (location, contacts).
  - Saving / error on toggle failure (revert).
  - Offline (disable the toggles).
  - Dark mode.
- **Prototype-only / claims to fix:**
  - “Hassas alan tespiti cihazda yapılır” conflicts with the architecture: Gmail is fetched and analyzed server-side in Edge Functions. Replace it with server-side redaction before the LLM (OTP patterns, IBAN, cards with a Luhn check, health keywords), and word the list honestly as “analiz etmez / AI'a göndermez / saklamaz”. The service does technically read mail bodies that may contain these items.
  - “Mesajlaşma içerikleri” conflicts with 2.13, which offers WhatsApp/Telegram as a toggle (default off), and with secondary AndroidNotifications (WhatsApp on).
  - “Kopya tutulmaz” conflicts with the §77 schema (`email_messages`, `memory_chunks` with embeddings).
- **Maps to:** §40, §80, §83, §114, §87, §36.

### Veri Saklama / Data Retention (page)
- **Source:** PRIMARY / 07 / 7.4, the background page.
- **Layout:**
  1. Back button, h1 “Veri saklama”, subtitle.
  2. Segmented control: track `#E9E7E1`, radius 999, padding 3, 13/600. Segments are 34px high. The selected one is white with shadow `0 1px 3px rgba(27,25,23,.12)` and text `#1A1917`; the others are `#6B6860`.
  3. Explanation, 13/19 `#6B6860`.
  4. Card with 3 rows at 52px.
- **Exact copy:**
  - Subtitle: “Analiz sonuçları ve özetler ne kadar saklansın?”
  - Segments: “30 gün” / “90 gün” (selected) / “1 yıl”
  - Explanation: “Hafıza araması bu süreyle sınırlıdır. Orijinal mailler zaten kendi hesabında; biz kopya tutmayız.”
  - Rows:
    - “Verilerimi dışa aktar” · “JSON · 2,4 MB”
    - “Analiz geçmişini sil” (coral)
    - “Hesabımı sil” (coral)
- **Data → entity:** `user_preferences.retention_days` (30 / 90 / 365 / null), enforced by a scheduled cleanup job (§41, §96) that deletes `insights`, `briefings`, `briefing_items`, `memory_chunks`, `assistant_messages` and cached email derivatives older than N days. “2,4 MB” is an estimate and should come from the last export job or be omitted.
- **Interactions:**
  - Segment change to a shorter period → confirmation sheet, because older data will be deleted on the next cleanup. Then save.
  - Rows as in 7.2.
- **States missing:**
  - The **4th option, “Ben silene kadar” (until user deletes), required by §41.**
  - Saving.
  - Pro-gating: none required. Secondary gates “Sınırsız (PRO)”; do not copy that.
- **Maps to:** §41, §96, §127.

### Analiz Geçmişini Sil (bottom sheet) / Delete analysis history confirmation
- **Source:** PRIMARY / 07 / 7.4, the overlay.
- **Layout:**
  - Scrim `rgba(27,25,23,.35)`.
  - Sheet: white, radius `28 28 0 0`, padding `10px 24px 44px`, shadow `0 -10px 40px rgba(27,25,23,.12)`.
  - Grabber 36×5, radius 3, `#E0DED7`, margin-bottom 18.
  - Icon tile 52×52, radius 16, `#FCEDE9` with `delete_sweep` 26px `#C7432F`.
  - Title 22/28 600.
  - Body 15/22 `#6B6860`.
  - Summary box: `#F5F4F0`, radius 14, padding 12×14, 13/19.
  - Buttons: “Geçmişi Sil” (52, radius 16, `#C7432F`, white) and “Vazgeç” (44, radius 14, `#6B6860`), gap 8.
- **Exact copy:**
  - Title: “Analiz geçmişi silinsin mi?”
  - Body: “90 günlük özetler, öncelik kararları ve hafıza dizini silinir. Maillerin ve takvimin etkilenmez. Bu işlem geri alınamaz.”
  - Summary: “Silinen: 1.204 özet · 318 öncelik kararı · 42 kural” / “Korunan: bağlantılar, ayarlar, VIP listesi”
  - Caption: “Yıkıcı işlemler: coral birincil buton yalnızca burada; “Vazgeç” aynı boyutta ve hemen altında. Ne silinir / ne korunur açıkça listelenir.”
- **Data → entity:** counts from `insights` / `briefings`, priority decisions (an `insight_priority_log` or an equivalent column), and `memory_chunks`. The “90 günlük” text is bound to `retention_days`.
- **Interactions:**
  - Geçmişi Sil → server job `delete_analysis_history`, which deletes rows and embeddings and writes an `audit_logs` entry. Show in-progress, then a real completion state; never a fake success (§129 spirit).
  - Vazgeç or drag down → dismiss.
- **States missing:** counts loading, job running, job failed with retry, offline (disable the destructive CTA), Reduce-Motion sheet transition.
- **Inconsistency:** “42 kural” is deleted here, but the settings show 6–7 rules and 7 learnings. Clarify what is deleted: learned preferences (probably) versus explicit rules, which should be preserved.
- **Maps to:** §41, §40 (Delete History), §66.

### Paywall · Dijital Asistan PRO
- **Source:** PRIMARY / 07 / 7.5. Data: `PLAN`. Variant: the `isPaywall` block in `Dijital Asistan.dc.html` with the `PRO` feature list.
- **Purpose:** an honest upgrade screen: comparison table, plan picker, trial CTA.
- **Layout:**
  - Background `linear-gradient(180deg, #EDEDFC 0%, #F5F4F0 32%)`.
  - Top bar: `close` (left) and “Satın alımı geri yükle” (13/600 `#6B6860`, right).
  - Kicker: `auto_awesome` (FILL 1) 16px plus “DİJİTAL ASİSTAN PRO” in 12/600 .08em `#5B5CE2`.
  - Title: 30/36 600, −.025em. Sub-line: 14/20 `#6B6860`.
  - Comparison card: white, radius 20. Header grid `1fr 56px 56px` with 11/700 .06em `#9B978E` labels “FREE” and “PRO” (the PRO header in `#5B5CE2`). Rows are 44px min, 14px text. The Free cell is 13px `#9B978E` (a Material `check` glyph when the value is `check`). The PRO cell is always `check_circle` FILL 1, 20px, `#5B5CE2`.
  - Plan radio cards: padding 14×16, radius 16, white.
    - Selected: border 2px `#5B5CE2`; the dot is 20px with `inset 0 0 0 3px #fff`.
    - Unselected: border 2px `rgba(27,25,23,.1)`.
    - “EN AVANTAJLI” pill: `#E4F5EA`/`#1E7A47` 11/700.
  - Bottom stack (`margin-top:auto`): primary CTA, text CTA “Free ile devam et”, and legal text 12/18 `#9B978E` centered.
- **Exact copy:**
  - Title: “Tüm dijital hayatın, tek brifingde.”
  - Sub-line: “Bu hafta 684 mailden 32'sini öne çıkardık; 2 sa 48 dk kazandın.”
  - `PLAN` rows (Free value / Pro value):

    | Feature | Free | Pro |
    |---|---|---|
    | Bağlı mail hesabı | 1 | ✓ |
    | Bağlı takvim | 1 | ✓ |
    | Sabah brifingi | ✓ | ✓ |
    | Öğle ve akşam brifingi | — | ✓ |
    | Toplantı hazırlığı | — | ✓ |
    | Akıllı takip ve taahhütler | — | ✓ |
    | Sesli brifing | — | ✓ |
    | AI hafıza ve VIP kişiler | — | ✓ |
    | Gelişmiş planlama | — | ✓ |
    | AI analiz limiti | 50/gün | ✓ |

  - Plans: “Yıllık” + “EN AVANTAJLI” / “1.490 TL / yıl · ayda 124 TL · %38 tasarruf”; “Aylık” / “199 TL / ay”
  - CTA: “Ücretsiz Dene · 7 gün”
  - Secondary CTA: “Free ile devam et”
  - Legal text: “7 gün sonra 1.490 TL/yıl. Bitmeden 24 saat önce hatırlatırız. İstediğin zaman iptal.”
  - Caption: “Free şeffaf: 1 mail, 1 takvim, sabah brifingi, sınırlı AI. Kapat butonu ilk saniyeden görünür; “Free ile devam et” aynı yüzeyde. Fiyat ve yenileme koşulu CTA'nın altında düz yazı.”
  - Arithmetic check: 199×12 = 2,388; 1,490 / 2,388 = 62.4%, so the saving is 37.6% ≈ %38 ✓. 1,490 / 12 = 124.2 ✓.
  - Prototype variant `PRO` list: “Sınırsız analiz, birden fazla hesap”, “Öğle ve akşam brifingi”, “Toplantı hazırlığı”, “Akıllı takip ve taahhütler”, “Sesli brifing”, “AI hafıza ve VIP kişiler”, “Gelişmiş planlama”. Its legal line: “Deneme bitmeden 24 saat önce hatırlatırız. İstediğin zaman iptal.”
- **Data → entity:**
  - RevenueCat Offering “default” with packages `$rc_annual` → `da_pro_annual` and `$rc_monthly` → `da_pro_monthly`; entitlement `pro` (§43).
  - Prices must come from `package.product.priceString` and `pricePerMonthString`. **Never hardcode “1.490 TL”.** Compute the savings % at runtime.
  - The personalized hero stats come from the weekly aggregates (`briefings` / `insights` stats). Use a static fallback for new users.
- **Interactions** (react-native-purchases 10.10.1; react-native-purchases-ui 10.10.1 is optional, but the custom UI must match primary):
  - Close / “Free ile devam et” → dismiss and log the analytics event `paywall_dismissed{source}`.
  - Plan card → select the package.
  - Main CTA → `Purchases.purchasePackage(pkg)`, then refresh `CustomerInfo`, check `entitlements.active.pro`, sync the server via the RevenueCat webhook to `subscriptions`, and show a real success state.
  - The CTA label is dynamic:
    - Trial phrasing only if the product has an intro or free-trial offer and the user is eligible (iOS `Purchases.checkTrialOrIntroductoryPriceEligibility([...])`; Android: the free phase in `subscriptionOptions`).
    - Otherwise “Pro'ya Geç”.
  - “Satın alımı geri yükle” → `Purchases.restorePurchases()`, with found / not found / error feedback.
  - The “24 saat önce hatırlatırız” promise → schedule a local notification at `trial_end − 24h` (expo-notifications 57.0.20) and a server fallback push/email. If notifications are denied, the copy must not promise a push.
- **States depicted:** yearly selected.
- **States missing:**
  - Offerings loading or failed (retry).
  - Purchase in progress (disable the CTAs).
  - User cancelled (silent).
  - Purchase pending (Ask to Buy / Play pending).
  - Purchase error.
  - Already subscribed (show Manage).
  - Not eligible for trial.
  - Offline.
  - Success.
  - Dark mode.
  - **Links to Terms of Use (EULA) and Privacy Policy. Apple Guideline 3.1.2 requires them on the paywall; they are absent.**
- **Prototype-only, do not copy:**
  - `startTrial` does `back()` plus the toast “7 günlük deneme başladı · 12 Eylül'de hatırlatırım”, i.e. a fake purchase.
  - The hardcoded prices.
- **Maps to:** §43, §44, §42, §99, §112.

### Bağlamsal Pro Kapısı / Contextual Pro gate on Today (Free user)
- **Source:** PRIMARY / 07 / 7.6.
- **Purpose:** an in-context upsell that shows the real value (a count) while hiding the locked content.
- **Layout:**
  1. Status bar at 13:00. Header kicker “5 EYLÜL CUMARTESİ” (12/600 .08em `#9B978E`) plus h1 “İyi günler, Yunus” and a 40px ink avatar.
  2. Gate card: white, radius 28, padding 22.
     - Kicker: `lock` 16px plus “ÖĞLE NABZI · PRO” in 12/600 .06em `#9B978E`.
     - h2 22/28.
     - Body 14/20 `#6B6860`.
     - Two placeholder bars (44px, radius 12, `#F5F4F0`) with `filter: blur(4px)` and opacity .6.
     - Buttons: “7 gün ücretsiz dene” (flex 1, 44px, radius 14, `#5B5CE2`) and “Şimdi değil” (44px, `#F0EFEB` on `#6B6860`).
  3. Kicker row “ÖNCELİKLERİN” / “3 konu”.
  4. Priority card: radius 20.
     - ACİL pill plus “08:42”.
     - h3 17/23.
     - Source line with `mail` 16px: “Gmail · Ahmet Yılmaz · 08:42”.
     - Actions “Yanıtla” (`#4547C9`) and “Hatırlat” (`#6B6860`), 14/600.
  5. Tab bar: height 90, `rgba(255,255,255,.92)`, top border `1px rgba(27,25,23,.06)`, labels 11/500.
     - Tabs: Bugün (`sunny` FILL 1, `#5B5CE2`), Akış (`dynamic_feed`), Plan (`calendar_today`), Asistan (`auto_awesome`).
     - Inactive color `#9B978E`, icon size 26.
- **Exact copy:**
  - Gate h2: “Sabahından beri 2 gelişme oldu.”
  - Gate body: “Öğle nabzı Pro'da. Sabah brifingin her zaman ücretsiz.”
  - Buttons: “7 gün ücretsiz dene”, “Şimdi değil”
  - Priority card: “Ahmet senden bugün 17:00'ye kadar revize teklif bekliyor.”
  - Caption: “Kapı, özelliğin gerçek değerini gösterir (“2 gelişme oldu”) ama içeriği bulanıklaştırır. “Şimdi değil” 7 gün boyunca aynı kartı tekrar göstermez. Ücretsiz özellikler kilitlenmez.”
- **Data → entity:**
  - Server-computed count of new important items since the morning briefing, from deterministic signals. Avoid running the LLM midday pipeline for Free users (§82 cost).
  - `user_preferences.dismissed_gates = {midday_gate: until_ts}`.
- **Interactions:**
  - “7 gün ücretsiz dene” → Paywall with `source='midday_gate'`, then on success reveal the midday pulse (§10).
  - “Şimdi değil” → persist a 7-day suppression server-side (cross-device) and collapse the card with the 300ms scale/fade motion.
  - Yanıtla → AI Reply (§16).
  - Hatırlat → reminder sheet (§29).
- **States missing:** the count is 0 (hide the gate entirely), a user already dismissed within 7 days, dark mode.
- **Prototype-only:** never ship the blurred real content to the client. Render neutral placeholder bars only; `expo-blur` 57.0.3 is not needed.
- **Maps to:** §10, §44, §82, §111.

### Arkadaşını Davet Et / Referral
- **Source:** PRIMARY / 07 / 7.7.
- **Layout:**
  1. Back button.
  2. Hero card:
     - `linear-gradient(160deg, #1E1E4C 0%, #3B3CA8 58%, #7071EA 100%)` (gradient/dawn), radius 28, padding 26×22.
     - Avatar pair: 44px circles with a 3px `#3B3CA8` border. “Y” on white with text `#25266A`, and a `person_add` bubble at `rgba(255,255,255,.25)` overlapped with margin-left −12.
     - h1 28/34 white.
     - Sub-line 14/20 `rgba(255,255,255,.78)`.
  3. Link field: 52px, radius 16, white.
     - Link text: 500 14px monospace.
     - “Kopyala” button: 40px, radius 12, `#EDEDFC`/`#4547C9`, `content_copy` 16.
  4. Primary button “Davet Gönder” with `ios_share` 20.
  5. `DAVETLERİN · 3` card, rows at 56px:
     - Initials avatar 36 (`#E3EFE6`/`#1E5A36` BT; `#F5E1D6`/`#7A3E1F` DE; neutral `mail` icon).
     - Status pills: success `+14 GÜN`, warning `BEKLİYOR`, neutral `GÖNDERİLDİ`.
  6. Footer: 12px `#9B978E`.
- **Exact copy:**
  - Hero title: “Arkadaşını davet et, ikiniz de 14 gün Pro kazanın.”
  - Hero sub-line: “Arkadaşın ilk brifingini aldığında Pro süreniz otomatik uzar.”
  - Link: “dijitalasistan.app/d/yunus-7k2”
  - Buttons: “Kopyala”, “Davet Gönder”
  - Invite rows:
    - “Burak Tan” / “İlk brifingini aldı · 2 Eyl” / “+14 GÜN”
    - “Deniz Erol” / “Kaydoldu, hesap bağlamadı” / “BEKLİYOR”
    - “elif.a@…” / “Davet gönderildi · 4 Eyl” / “GÖNDERİLDİ”
  - Footer: “Toplam kazanılan: 14 gün Pro · Sınır: yılda 6 davet”
  - Caption: “Ödül koşulu açık: “ilk brifingini aldığında”. Durum rozetleri sistemdeki aynı üç ton (yeşil, amber, nötr). Davet linki monospace.”
- **Data → entity:**
  - `referrals` (`code`, `referrer_id`, `referee_id`, status: sent → signed_up → qualified [first briefing delivered] → rewarded / rejected, `created_at`).
  - `referral_credits` (`days=14`, `granted_at`, `source='referral'`), kept separate from the store entitlement (§43).
  - Anti-abuse flags (§45).
- **Interactions:**
  - Kopyala → `expo-clipboard` 57.0.2 `setStringAsync`, a “Bağlantı kopyalandı” toast and a light haptic.
  - Davet Gönder → RN `Share.share({message, url})`, the native share sheet (§45).
  - The link must be a universal link / App Link on the marketing site: route `/d/[code]`, `apple-app-site-association` and `assetlinks.json`, with a store fallback. Attribute installs on Android with the Play Install Referrer API; on iOS provide manual code entry in onboarding (missing screen: “Davet kodun var mı?”).
- **States missing:**
  - Empty (no invites yet).
  - Limit reached.
  - Loading.
  - Offline (copy still works).
  - Reward rejected (abuse).
  - Free user versus Pro user reward semantics (extend versus grant).
- **Prototype-only / issues:**
  - The “elif.a@…” row implies email invites where the app knows the invitee's address. The native share flow cannot know that. Either design a real email-invite flow or show only rows attributed after signup.
  - “yılda 6 davet” should read as a reward cap (“yılda en fazla 6 ödül”); you cannot cap link shares.
- **Maps to:** §45, §62, §42, §73 (link route).

### Görünüm ve Dil / Appearance & Language
- **Source:** PRIMARY / 07 / 7.8. One artboard; production should split it into two screens to match the two settings rows, or anchor to a section.
- **Layout:**
  1. h1 “Görünüm”.
  2. A 3-column grid of preview tiles, each 120px high, radius 16, padding 10.
     - Açık (selected): background `#F5F4F0`, border 2px `#5B5CE2`, bars `#1A1917`/`#fff`.
     - Koyu: background `#141311`, bar `#F2F0EB`, cards `#1F1E1B`.
     - Sistem: `linear-gradient(100deg, #F5F4F0 50%, #141311 50%)`.
     - Labels 13px: 600 when selected, 500 `#6B6860` otherwise.
  3. Card with rows:
     - Metin boyutu (`format_size`) · “Sistem” + chevron
     - Hareketi azalt (`animation`) · toggle off
     - Haptik geri bildirim (`vibration`) · toggle on
  4. h1 “Dil” (margin-top 6).
  5. Card: “Türkçe” with `check_circle` FILL 1 in `#5B5CE2`; “English” and “Deutsch” in `#6B6860`.
  6. Note 13/19.
- **Exact copy:**
  - Tiles: “Açık”, “Koyu”, “Sistem”
  - Rows: “Metin boyutu” / “Sistem”; “Hareketi azalt”; “Haptik geri bildirim”
  - Languages: “Türkçe”, “English”, “Deutsch”
  - Note: “Brifing ve özetler seçtiğin dilde yazılır; maillerin orijinal dili korunur.”
  - Caption: “Görünüm önizlemeleri gerçek yüzey renkleriyle. Erişilebilirlik anahtarları (hareket, haptik) burada; “Hareketi azalt” tüm mikro-etkileşimleri geçişsiz duruma alır.”
- **Data → entity:** `user_preferences.theme` ('system' | 'light' | 'dark'), `text_scale` ('system' | …), `reduce_motion` (bool, ORed with the OS setting), `haptics_enabled`, `locale` ('tr-TR' | 'en-US'), which also sets the AI output language. Keep timezone separate (§39).
- **Interactions:**
  - Theme tile → `Appearance.setColorScheme()` or the app theme provider, persisted locally for the first paint and server-side for sync.
  - Metin boyutu → a picker sheet (Sistem / Küçük / Varsayılan / Büyük) that feeds a font-scale multiplier while honoring `allowFontScaling`; or remove the row and rely on Dynamic Type.
  - Hareketi azalt → global motion flag. Combine it with `AccessibilityInfo.isReduceMotionEnabled()` and Reanimated 4.7.0 `useReducedMotion()`.
  - Haptik → gates all `expo-haptics` 57.0.3 calls.
  - Language row → i18next 26.4.2 / react-i18next 17.0.15 `changeLanguage` at runtime (no restart), then PATCH `locale`. Future briefings are generated in that language.
- **States missing:** the selected state of each theme, Dark-mode rendering of this screen, saving.
- **Issues:**
  - Tile order Açık / Koyu / Sistem with Açık as the default; §38 lists System first. The default should be “Sistem”.
  - “Deutsch” is not in scope (§39 is TR plus EN) and must not appear. Secondary's “Yakında” badges violate §100.
- **Maps to:** §38, §39, §92, §123.

### Öncelik Kuralları · Liste / Priority Rules list
- **Source:** PRIMARY / 07 / 7.9. Data: `RULES`.
- **Layout:**
  - h1 plus subtitle.
  - Groups, each with a kicker and a card. Rows are 60px min with padding 8×0 and gap 12:
    - Icon tile 32×32, radius 10, `#F0EFEB`/`#6B6860`, icon 18.
    - Title 15/20 500, −.01em.
    - Meta 12px `#9B978E`, margin-top 2.
    - Toggle. The whole row is at opacity .55 when off.
  - Footer: `psychology` 18 `#5B5CE2` plus 13/19 text with the bold link “AI Kişiselleştirme” in `#4547C9`.
  - Sticky CTA “Kural Ekle” with `add` 20.
- **Exact copy:**
  - Title: “Öncelik Kuralları”
  - Subtitle: “Senin yazdığın açık kurallar. Her zaman AI'ın kendi öğrendiklerinin önüne geçer.”
  - Group `HER ZAMAN ÖNEMLİ SAY`:
    - “Mehmet Yılmaz'dan gelenler” / “Kişi · 9 mail etkilendi · bu ay”
    - “@yilmazendustri.com adresinden gelenler” / “Domain · 14 mail · bu ay”
    - ““teklif”, “sözleşme”, “fatura” içerenler” / “Anahtar kelime · 22 mail · bu ay”
  - Group `HER ZAMAN BİLDİR`:
    - “VIP kişilerden gelenler” / “6 kişi · Sessiz saatlerde bile”
  - Group `DÜŞÜK ÖNCELİKLİ SAY`:
    - “Promosyon ve bülten mailleri” / “Kategori · 131 mail · bu ay”
  - Group `SESSİZE AL`:
    - “noreply@… göndericileri” / “Gönderici · 48 mail · bu ay” — on
    - “LinkedIn bildirimleri” / “Gönderici · 17 mail · bu ay” — **off**
  - Footer: “AI'ın kendi öğrendiklerini **AI Kişiselleştirme**'de görürsün; burası yalnızca senin kuralların.”
  - CTA: “Kural Ekle”
  - Caption: “Kurallar sonuca göre gruplanır (önemli / bildir / düşük / sessiz). Her satır: koşul tipi ikonu, kural metni, etki sayısı, aç/kapat anahtarı. Satıra dokunuş düzenlemeye gider.”
- **Data → entity:** `priority_rules`
  - `id`, `user_id`
  - `condition_type` ∈ {person, domain, keyword, category, sender}
  - `condition_value` (jsonb: contact_id | domain | keywords[] + `search_body` bool | category | address pattern)
  - `outcome` ∈ {always_important, high, low, always_notify, mute}
  - `exceptions` jsonb
  - `enabled`, `created_at`, `updated_at`, `deleted_at`
  - Match counter per period: a `priority_rule_stats` table or a materialized count.
  - Engine order (§31): explicit rules → learned → deterministic → AI. VIP always-notify interacts with quiet hours (the §132 decision engine).
- **Interactions:**
  - Row tap → 7.11 edit.
  - Toggle → PATCH `enabled` (optimistic, revert on error), then re-rank asynchronously.
  - Footer link → 06 6.9.
  - Kural Ekle → 7.10, presented modally (it has a close button).
- **States missing:**
  - Empty: no rules → an explanation plus “Kural Ekle”.
  - Loading.
  - Error.
  - Offline (read-only).
  - Empty groups hidden. The “Yüksek öncelikli say” group has no rows here.
- **Maps to:** §31, §132, §30.

### Yeni Kural / New Rule (condition + outcome + preview)
- **Source:** PRIMARY / 07 / 7.10.
- **Layout:**
  1. Header: `close` and the centered kicker “YENİ KURAL”.
  2. Section `1 · KOŞUL`:
     - Chip row: 34px, padding 0×12, radius 999, 13/600, icon 16. Unselected chips are white with `#6B6860` and shadow `0 1px 2px rgba(27,25,23,.06)`; selected is ink `#1A1917` with white text.
     - Input: 52px, radius 16, white, focus ring `box-shadow: 0 0 0 2px #5B5CE2`, “@” prefix in `#9B978E`, caret 2×18 `#5B5CE2`.
     - Suggestion chips: 30px, `#F0EFEB`, 12/600.
  3. Section `2 · SONUÇ`: radio card with 5 rows at 52px, each with a leading icon.
  4. Section `ÖNİZLEME · SON 30 GÜN`: card with `radial-gradient(140% 100% at 0% 0%, #E4E4FA 0%, #FFFFFF 60%)`, radius 18, padding 14×16.
     - Kicker `auto_awesome` in `#5B5CE2`.
     - Three rows: sender · subject in `#1A1917`, date in `#6B6860`.
     - Footer 12px `#9B978E`.
  5. Sticky CTA “Kuralı Kaydet”.
- **Exact copy:**
  - Condition chips: “Kişi” (`person`), “Domain” (`alternate_email`, selected), “Anahtar kelime” (`match_word`), “Kategori” (`sell`), “Gönderici” (`outgoing_mail`)
  - Input value: “yilmazendustri.com”
  - Suggestions: “Önerilen: @kuzeylojistik.com”, “@itu.edu.tr”
  - Outcomes: “Her zaman önemli say” (`priority_high`, selected), “Yüksek öncelikli say” (`trending_up`), “Düşük öncelikli say” (`trending_down`), “Her zaman bildir” (`notifications_active`), “Sessize al” (`notifications_off`)
  - Preview kicker: “14 MAİL BU KURALA UYARDI”
  - Preview rows: “Mehmet Yılmaz · Re: Teklif” / “Dün”; “Ayşe Kara · Sevkiyat planı” / “2 Eyl”; “muhasebe@yilmazendustri.com · Fatura” / “28 Ağu”
  - Preview footer: “3'ü bugün zaten önemli sayılıyordu; 11 mail yukarı taşınacak.”
  - CTA: “Kuralı Kaydet”
  - Caption: “İki adım tek ekranda: koşul tipi çipleri + alan, sonuç tek seçim. Önizleme kaydetmeden önce kuralın etkisini gerçek maillerle gösterir; kural yazma işlemi değil, onay istemez.”
- **Data → entity:**
  - Suggestions: the top frequent domains/senders from `email_messages` not already covered by rules.
  - Preview: a server RPC `preview_priority_rule(condition, outcome)` over the last 30 days, returning `match_count`, `sample[3]`, `already_important`, `will_move_up`.
- **Interactions:**
  - Chip → switches the input type: Kişi = contact picker from `contacts` / `vip_people`; Kategori = a list of categories; Anahtar kelime = a chip input.
  - Input → debounced preview refresh.
  - Suggestion chip → fills the input.
  - Outcome radio → single select, and the preview refreshes.
  - Kuralı Kaydet → insert into `priority_rules`, then toast and back to the list. It is not an approval-center item, because it is an internal preference.
- **States missing:**
  - Validation: invalid domain, empty value, duplicate rule.
  - Preview loading (skeleton), preview with 0 matches, preview error.
  - Save error.
  - Keyboard avoidance.
  - Dark mode.
- **Maps to:** §31, §131.

### Kuralı Düzenle / Edit Rule (keyword)
- **Source:** PRIMARY / 07 / 7.11.
- **Layout:**
  1. Header: back button and the kicker “KURALI DÜZENLE”.
  2. Status card: radius 18, `match_word` tile, “Kural aktif” 15/600, meta 12px, toggle on.
  3. `KOŞUL · ANAHTAR KELİME` card:
     - Keyword chips: 34px, padding `0 6px 0 12px`, `#EDEDFC`/`#4547C9`, trailing `close` 16.
     - Dashed “Ekle” chip: `1px dashed #C9C5BC`, `add` 16.
     - Row “Konu ve gövdede ara” with a toggle on.
  4. `SONUÇ` card: “Her zaman önemli say” (selected), “Her zaman bildir”, “Diğer sonuçlar” (`expand_more`, progressive disclosure).
  5. `İSTİSNALAR` card: “Promosyon kategorisi hariç” (`sell`) plus a chevron.
  6. Text button “Kuralı Sil” with `delete` 20, 15/600 `#C7432F`, 48px high.
  7. Sticky CTA **ink** `#1A1917` “Değişiklikleri Kaydet”.
- **Exact copy:** “Kural aktif” / “Oluşturuldu 12 Ağu · 22 mail etkilendi”; chips “teklif”, “sözleşme”, “fatura”, “Ekle”; “Konu ve gövdede ara”; “Diğer sonuçlar”; “Promosyon kategorisi hariç”; “Kuralı Sil”; “Değişiklikleri Kaydet”.
  - Caption: “Düzenleme aynı formun dolu hâli: kelime çipleri kaldırılıp eklenebilir, kural geçici olarak kapatılabilir. Sil yalnızca metin buton, kaydetten uzakta.”
- **Interactions:**
  - Toggle → local draft `enabled`.
  - Chip × → remove the keyword.
  - Ekle → inline text input chip.
  - Konu ve gövdede ara → `search_body`.
  - Diğer sonuçlar → expands the remaining three outcomes.
  - İstisnalar row → Exception editor (**missing screen**; categories, senders).
  - Kuralı Sil → 7.12.
  - Değişiklikleri Kaydet → PATCH, then back. Confirm unsaved changes on back.
- **States missing:** the “Kural kapalı” label when the toggle is off (the label is static “Kural aktif”), dirty/unsaved state, save error, the minimum-one-keyword validation.
- **Inconsistency:** create uses an indigo CTA (7.10); edit uses ink. Decide one rule. A reasonable one: indigo for creation, ink for saving settings.
- **Maps to:** §31.

### Kuralı Sil (modal) + Geri al (toast) / Delete Rule confirm + Undo
- **Source:** PRIMARY / 07 / 7.12.
- **Layout:**
  - Scrim `rgba(27,25,23,.35)`.
  - Centered dialog: white, radius 24, padding 22, shadow `0 20px 50px rgba(27,25,23,.25)`, text centered.
    - Icon tile 48, radius 16, `#FCEDE9` with `delete` 24 `#C7432F`.
    - Title 20/26 600.
    - Body 14/20 `#6B6860`.
    - Buttons: “Kuralı Sil” (48, radius 14, `#C7432F`) and “Vazgeç” (44, radius 12).
  - Toast: ink pill, radius 999, padding `12px 18px 12px 14px`, 14/500 white, `delete` 18 in `#A9AAF5`, action “Geri al” 600 in `#A9AAF5`, placed bottom 52px, shadow `0 10px 30px rgba(27,25,23,.25)`.
- **Exact copy:**
  - Title: “Kural silinsin mi?”
  - Body: ““teklif, sözleşme, fatura” kuralı silinir. Bu kelimeleri içeren mailler yeniden AI'ın kendi önceliğine göre sıralanır.”
  - Buttons: “Kuralı Sil”, “Vazgeç”
  - Toast: “Kural silindi” / “Geri al”
  - Caption: “Silme modal ile onaylanır (geri alınamaz işlem kalıbı); ardından 5 sn “Geri al” toast'ı. Aynı kalıp 7.4'teki veri silme ile tutarlı.”
- **Interactions:**
  - Kuralı Sil → soft delete (`deleted_at`), pop to the list, show the toast for 5s. When a screen reader is on, extend the duration and announce with `AccessibilityInfo.announceForAccessibility`.
  - Geri al → clear `deleted_at`.
  - After the window → hard delete or keep the soft delete, and re-rank.
- **Issue:** “geri alınamaz işlem kalıbı” plus an undo toast is contradictory wording. Also, 7.4 history deletion is stated as irreversible, so there is no undo there; the caption claiming consistency is inaccurate.
- **Maps to:** §31, §123.

---

## B. PRIMARY 08 · Durumlar, Widget'lar, Etkileşimler

The intent line in the file header: “Boş durum bir başarı mesajıdır: “Her şey kontrol altında.” Hatalar okunur ve tek aksiyonludur; AI erişilemezse ürün brifingi yine gösterir (son analiz). Widget'lar Bugün ekranının küçültülmüş versiyonu değil, tek bir cevabın yüzeyidir.”

### Boş Durumlar ×4 / Empty states (Today, Plan, Follow-up, Approvals)
- **Source:** PRIMARY / 08 / section “BOŞ DURUMLAR · POZİTİF, SAKİN”. Data: `EMPTIES`.
- **Layout (per variant):**
  - Tile 300 wide × 340 high, radius 28, `#F5F4F0`, centered, padding 28, gap 12.
  - Icon circle 60 with icon 30.
  - Title 19/600, −.01em.
  - Sub-line 14/20 `#6B6860`.
  - CTA: 38px, padding 0×14, radius 12, white, 13/600 `#4547C9`, shadow `0 1px 2px rgba(27,25,23,.06)`.
- **Variants (exact copy, colors, where each appears):**

  | Where | Icon, colors | Title | Sub-line | CTA |
  |---|---|---|---|---|
  | `empty/today · önemli mail yok` | `done_all`, `#E4F5EA`/`#1E7A47` | “Her şey kontrol altında.” | “Bugün dikkat gerektiren yeni bir konu yok. 46 maili senin için okudum.” | “Akışa göz at” |
  | `empty/plan · toplantı yok` | `self_improvement`, `#EDEDFC`/`#4547C9` | “Bugün takvimin oldukça sakin.” | “Yarın 09:00 Haftalık ekip ile başlıyorsun. Bugünü odak için kullanabilirsin.” | “Odak bloğu öner” |
  | `empty/follow-up · takip yok` | `mark_email_read`, `#E4F5EA`/`#1E7A47` | “Bekleyen takip yok.” | “Gönderdiğin her maile yanıt geldi. Yeni bir gecikme olursa buraya düşer.” | “Tamam” |
  | `empty/approvals · onay yok` | `task_alt`, `#F0EFEB`/`#6B6860` | “Onay bekleyen işlem yok.” | “Bir mail göndermek veya takvimi değiştirmek istediğimde önce burada görürsün.” | “Geçmişi gör” |

- **Data → entity:**
  - “46 maili” → the analyzed-today count from `email_messages` / `sync_states`.
  - “Yarın 09:00 Haftalık ekip” → the next `calendar_events` item. It needs a fallback when nothing is scheduled tomorrow either.
- **Interactions:**
  - Akışa göz at → switch to the Akış tab.
  - Odak bloğu öner → the calendar-intelligence focus-block suggestion, which creates an approval `calendar_create` (§33).
  - Tamam → there is nothing to do on an empty screen. Remove it (a dead action, §99) or make it navigate back.
  - Geçmişi gör → Approval history filter (approved / rejected / executed).
- **States missing (empty variants needed but not drawn):**
  - No connected account at all (secondary: “Mailini bağla.”).
  - No VIP (secondary: “Henüz VIP kişi yok.”).
  - Assistant/memory with no results.
  - Search with no results.
  - Commitments empty.
  - Priority Rules empty.
  - Referral invites empty.
  - AI Personalization empty (secondary: “AI henüz bir tercih öğrenmedi.”).
  - Notifications empty.
  - Dark versions of all of the above.
- **Maps to:** §93, §99.

### Hata Kartları ×4 / Inline error cards
- **Source:** PRIMARY / 08 / “HATA DURUMLARI · OKUNUR, TEK AKSİYON”. Data: `ERRORS`.
- **Layout:**
  - Card: white, radius 18, padding 14×16, standard shadow, gap 12.
  - Icon tile 36, radius 11.
  - Title 15/600.
  - Sub-line 13/19 `#6B6860`.
  - Actions 13/600: primary `#4547C9`, secondary `#6B6860`, gap 14.
- **Variants (exact copy):**

  | Code | Icon, colors | Title | Sub-line | Primary / secondary |
  |---|---|---|---|---|
  | `error/oauth-expired` | `link_off`, `#FCEDE9`/`#C7432F` | “Gmail bağlantısı yenilenmeli.” | “Google oturumu süresi doldu. Yeniden bağlanana kadar yeni mailler analiz edilmez.” | “Yeniden Bağlan” / “Sonra” |
  | `error/permission-denied` | `event_busy`, `#FDF2DC`/`#9A6300` | “Takvim izni verilmedi.” | “Toplantı hazırlığı ve çakışma uyarıları takvim erişimi gerektirir. Diğer her şey çalışıyor.” | “İzin Ver” / “Neden gerekli?” |
  | `error/sync-delayed` | `sync_problem`, warning colors | “Senkronizasyon gecikti.” | “Son başarılı analiz 09:40. Yeniden deniyoruz; gösterilenler 12 dakika eski olabilir.” | “Şimdi Dene” / “Tamam” |
  | `error/ai-unavailable` | `cloud_off`, `#F0EFEB`/`#6B6860` | “Asistan şu an yanıt veremiyor.” | “Brifingin ve önceliklerin hazır; yalnızca yeni soru ve taslaklar birkaç dakika bekleyebilir.” | “Tekrar Dene” / “Brifinge Dön” |

- **Data → entity:**
  - `connected_accounts.status` = `needs_reauth` (from `invalid_grant` on refresh).
  - `sync_states.last_success_at` and lag minutes.
  - AI provider health: the circuit-breaker state from §81/§67.
- **Interactions:**
  - Yeniden Bağlan → OAuth re-consent via `expo-web-browser` 57.0.3 auth session, using PKCE against the server.
  - Sonra → snooze the card (persist until the next session).
  - İzin Ver → re-run OAuth with the calendar scope (provider permission, not OS).
  - Neden gerekli? → an explainer sheet.
  - Şimdi Dene → enqueue a sync job and show the “AI işliyor” motion.
  - Tamam → dismiss.
  - Tekrar Dene → retry the last failed request.
  - Brifinge Dön → navigate to the briefing.
- **States missing:**
  - Outlook / Microsoft token expiry.
  - The user declined the Google consent screen (secondary “Erişim izni reddedildi.”).
  - Provider API quota exhausted.
  - Push-token failure.
  - Purchase errors.
  - Export failed.
  - Rate limit / Free AI limit reached. “50/gün” needs a limit-reached card with a Pro upsell.
  - Partial data: one of two accounts failing.
- **Maps to:** §93, §94, §117, §75.

### Çevrimdışı Bugün / Offline Today (full screen)
- **Source:** PRIMARY / 08 / “error/offline · tam ekran · son analiz görünür kalır”.
- **Layout:**
  - Status bar shows `wifi_off`.
  - Offline banner: margin 8×20, ink `#1A1917`, radius 14, padding 10×14, 13px white. Icon `wifi_off` 18 in `#F08B78`; action “Yenile” 600 in `#A9AAF5`.
  - Content below at opacity .75.
  - Header “5 EYLÜL CUMARTESİ” / “Günaydın, Yunus”.
  - Briefing card: radius 28, padding 22.
    - Kicker `history` 16 plus “BRİFİNG · 07:58 · ÇEVRİMDIŞI” in `#9B978E`.
    - h 26/32.
    - Sub-line 14px.
    - Buttons: ink “Brifingimi Gör” (48, radius 14) and disabled “İndirilmedi” (`download_for_offline`, `#F0EFEB` bg, `#B8B4AA`).
  - Priority card: ACİL 08:42, h3, and the hint “Yanıt taslağı bağlantı gelince hazırlanır.”
- **Exact copy:** “Çevrimdışısın. Son analiz 09:40'tan gösteriliyor.” / “Yenile” / “Bugün bilmen gereken 5 şey var.” / “3 önemli mail · 4 etkinlik · 2 takip” / “Brifingimi Gör” / “İndirilmedi” / “Ahmet senden bugün 17:00'ye kadar revize teklif bekliyor.” / “Yanıt taslağı bağlantı gelince hazırlanır.”
- **Data → entity:**
  - Persisted query cache (React Query persister on MMKV/SQLite) holding the last briefing, priorities and `last_analysis_at`.
  - Audio file availability: `expo-file-system` 57.0.7 cached TTS file.
  - Network state: `@react-native-community/netinfo` 12.0.1 or `expo-network` 57.0.2.
- **Interactions:**
  - Yenile → re-check connectivity and refetch; if still offline, a short “Hâlâ çevrimdışı” message.
  - Brifingimi Gör → the cached briefing.
  - Audio disabled when not downloaded. Enable it if the file is cached.
  - Write actions (reply, remind, approve) → blocked or queued per §94. Queue only idempotent local intents; never auto-send email when coming back online without the approval state.
- **States missing:**
  - The reconnect transition: banner → “Güncel · 09:41” (1.5s) as specified in the MOTION “Senkron” row.
  - First launch while offline with no cache → a full-screen empty/offline state.
  - Offline Plan / Akış / Asistan (Asistan must show “Çevrimdışıyken soru sorulamaz”).
  - Dark mode.
- **Maps to:** §93, §94, §125.

### Yükleniyor · Bugün iskeleti / Loading Today skeleton
- **Source:** PRIMARY / 08 / “loading/today · iskelet, gerçek kart ölçülerinde”, using `sk()` and `spin`.
- **Layout:**
  - Header renders instantly.
  - Briefing card (radius 28, padding 22, gap 12):
    - Kicker: spinner 14px (border 2px `#D9D6F7`, top border `#5B5CE2`, `daspin .8s linear infinite`) plus “BRİFİNG HAZIRLANIYOR…” in `#5B5CE2` 12/600 .06em.
    - Bars: s1 85%×22 r8; s2 55%×22 r8; s3 40%×12 r6.
    - Button placeholders: flex 1 × 48 r14 `#EFEDE7`, and 110×48 r14 `#F5F4F0`.
  - Kicker “ÖNCELİKLERİN”.
  - Two cards (radius 20, padding 14×16, gap 10), each with s6 30%×18 r9, s7 92%×16 r8, s8 50%×12 r6.
  - Shimmer: `linear-gradient(90deg, #EFEDE7 25%, #F7F6F2 50%, #EFEDE7 75%)`, background-size 200% 100%, `dashimmer 1.6s linear infinite` (background-position 200% → −200%).
- **Exact copy:** “BRİFİNG HAZIRLANIYOR…”; caption “Başlık ve tarih anında; yalnızca AI içeriği iskelet. 1,6 sn parıltı, kartlar tek tek 60 ms arayla dolar.”
- **Implementation:** Reanimated 4.7.0 shared value driving a translateX gradient (`expo-linear-gradient` 57.0.2). The stagger fill is a 60ms delay with the `FadeIn` layout animation. Reduce Motion → a static `#EFEDE7` block and a 120ms opacity fade.
- **States missing:** dark skeleton colors (propose surface `#1F1E1B` / highlight `rgba(255,255,255,.08)`), long-running generation (>10s → the text “Brifing hâlâ hazırlanıyor; hazır olunca bildiririz”), skeletons for Akış, Plan, Mail detail, Settings value columns, and the meeting prep list.
- **Maps to:** §93, §123, §125.

### iOS Widget · Small / “sıradaki önemli konu”
- **Source:** PRIMARY / 08 / “small · 158×158 · sıradaki önemli konu”.
- **Layout:**
  - 158×158, radius 22, white, padding 14, shadow `0 8px 24px rgba(27,25,23,.12)`.
  - Top row: `auto_awesome` FILL 1, 16px `#5B5CE2`, and the ACİL pill (10/700 .05em, padding 2×6).
  - Bottom-aligned text: 14/18 600, −.01em.
  - Meta 11px `#9B978E`.
- **Copy:** “ACİL” / “Ahmet 17:00'ye kadar revize teklif bekliyor.” / “Gmail · 08:42”
- **Data:** the top-priority `insight` (title_short, urgency, source, time), written to the App Group.
- **Interaction:** a single `widgetURL` deep link → `dijitalasistan://item/{insightId}` (scheme from §108). Small widgets support only one tap target.
- **States missing:**
  - No priority → “Her şey kontrol altında.”
  - Not signed in / no account → “Hesabını bağla”.
  - Stale data > X hours → timestamp.
  - Privacy mode: when lock-screen privacy is on, generic text such as “1 acil konu”.
  - Dark / tinted / clear rendering modes (iOS 18+ `widgetRenderingMode`; wrap accents in `widgetAccentable()`).
- **Maps to:** §37, §86.

### iOS Widget · Medium / “bugünün 3 önceliği”
- **Source:** PRIMARY / 08 / “medium · 338×158”.
- **Layout:**
  - 338×158, radius 22, padding 14×16.
  - Kicker `auto_awesome` 15px plus “BUGÜN · 3 ÖNCELİK” (11/600 .06em `#5B5CE2`) and the time “07:58” (11px `#9B978E`).
  - Three rows, 13/500, each with a 6px dot and single-line ellipsis: `#E0553F` critical, `#9B978E` neutral, `#E09A1C` warning. Time 11px on the right.
- **Copy:** “Ahmet'e revize teklif · 17:00”, “Mehmet ile müşteri toplantısı · 14:30”, “Başvuru kapanıyor · 17:00”.
- **Interaction:** a `Link` per row → the corresponding deep link.
- **States missing:** fewer than 3 items, none, privacy mode, dark / tinted.
- **Maps to:** §37.

### iOS Widget · Large / “brifing + sonraki toplantı + takip”
- **Source:** PRIMARY / 08 / “large · 338×354”.
- **Layout:**
  - 338×354, radius 22, padding 16, gap 12.
  - Briefing card: `radial-gradient(140% 100% at 100% 0%, #E4E4FA 0%, #FFFFFF 60%)`, radius 16, padding 14.
    - “SABAH BRİFİNGİ”.
    - 19/24 “Bugün bilmen gereken **5** şey var.” (the 5 in `#5B5CE2`).
    - `play_arrow` plus “Dinle · 2 dk” (12/600 `#4547C9`).
  - “SONRAKİ TOPLANTI”: time tile 40, radius 12, `#F5F4F0`, showing “14” over “30”; “Mehmet ile müşteri toplantısı” / “Hazırlık hazır · 3 konu”.
  - “TAKİP”: `schedule_send` tile; “Mehmet · Teklif v2” / “3 gündür yanıt yok” / “Takip Et” (`#4547C9`).
- **Interactions:**
  - Brief card → `dijitalasistan://briefing/morning`.
  - “Dinle” → `…/briefing/morning?autoplay=1`. In-widget playback would need an iOS 17 App Intent (`AudioPlaybackIntent`); opening the app is sufficient.
  - Meeting → `…/meeting/{eventId}/prep`.
  - “Takip Et” → `…/followups/{id}`, which opens the follow-up composer. Per the file note, no write action happens from the widget.
- **States missing:** no meeting today, no follow-ups, briefing not yet generated (“Brifing 08:00'de hazır”), Free user (midday/evening lines hidden), privacy mode.
- **Maps to:** §37, §9, §17, §21.

### iOS Kilit Ekranı widget'ları / Lock Screen (inline, circular, rectangular)
- **Source:** PRIMARY / 08 / “lock screen · circular · rectangular · inline”.
- **Layout:**
  - Mock lock screen 300×354, radius 32, gradient `180deg, #1E1E4C 0%, #3B3CA8 70%, #7071EA 100%`.
  - Date 14/500 at .85; clock 72/76 600, −.04em.
  - Inline pill: 12/500 on `rgba(255,255,255,.14)`, radius 999, padding 4×10, `auto_awesome` 14.
  - Circular: 60px `rgba(255,255,255,.18)`, “ÖNEMLİ” 9/600 plus “5” 20/600.
  - Rectangular: 158×60, radius 18, “SONRAKİ · 14:30” 10/600 / “Mehmet ile toplantı” 13/600 / “Hazırlık hazır” 10px.
- **Copy:** “Cumartesi 5 Eylül”, “9:41”, “5 önemli konu · ilki 17:00”, “ÖNEMLİ 5”, “SONRAKİ · 14:30 / Mehmet ile toplantı / Hazırlık hazır”.
- **Real-platform notes:**
  - WidgetKit families: `accessoryInline`, `accessoryCircular`, `accessoryRectangular` (iOS 16+).
  - The system renders these in vibrant monochrome, so the custom pill backgrounds and colors are not honored.
  - `accessoryInline` sits in the date line above the clock, not below as drawn. It is a single text line plus an optional symbol.
  - Use `.privacySensitive()` on names so they are redacted while locked (§86 lock-screen privacy).
- **States missing:** the generic mode (“Sonraki toplantı · 14:30” without names), no data, signed out.
- **Maps to:** §37, §86.

### Android Widget · 4×2 / “brifing + öncelikler”
- **Source:** PRIMARY / 08 / “4×2 · brifing + öncelikler”.
- **Layout:**
  - 340×170, radius 28, white, padding 16×18.
  - Header: app tile 22, radius 7, `#5B5CE2` with a white `auto_awesome` 14, plus “Dijital Asistan” 12/600 `#5B5CE2`.
  - Play button: 32 circle `#EDEDFC`/`#4547C9` with `play_arrow`.
  - Headline 17/22 600.
  - Chips (30px, radius 999, 12/600): “Ahmet · 17:00” critical, “Mehmet · 14:30” neutral, “+3” neutral.
- **Copy:** “Dijital Asistan”, “Bugün bilmen gereken 5 şey var.”, “Ahmet · 17:00”, “Mehmet · 14:30”, “+3”.
- **Implementation:** `react-native-android-widget` 0.22.1 (`registerWidgetTaskHandler`, `requestWidgetUpdate`, `clickAction` / `clickActionData`) or Kotlin Glance. Sizing: Android 12+ `targetCellWidth=4`, `targetCellHeight=2`, plus `minWidth` / `minHeight` fallbacks.
- **Interactions:** body → Today; play → briefing autoplay; each chip → its item; “+3” → Today.
- **States missing:** empty, signed out, stale, privacy mode, dark (a system night variant).
- **Note (from the file):** “Android'de Material tema rengi yerine ürünün kendi yüzeyleri kullanılır; köşe yarıçapı sistemden gelir.” Use `@android:dimen/system_app_widget_background_radius` on Android 12+.
- **Maps to:** §37.

### Android Widget · 2×2 / “sıradaki”
- **Source:** PRIMARY / 08 / “2×2 · sıradaki”.
- **Layout:** 170×170, radius 28, ink `#1A1917`, padding 16. `auto_awesome` 18 in `#A9AAF5`. Bottom-aligned “SONRAKİ · 14:30” (11/600 .06em `rgba(255,255,255,.6)`), title 15/19 600, sub-line 11px.
- **Copy:** “SONRAKİ · 14:30” / “Mehmet ile müşteri toplantısı” / “3 konu hazır”.
- **Interaction:** → meeting prep deep link.
- **States missing:** no next meeting → fall back to the top priority or “Bugün takvimin sakin”; privacy mode.
- **Caption for both platforms:** “Widget'lar tek cevap verir: sıradaki konu, 3 öncelik ya da brifing girişi. Dokunuş ilgili ekranı açar; yazma işlemi widget'tan yapılmaz.”
- **Maps to:** §37.

**Widget data pipeline** (none of the designs show it; needed for §37):
- The app writes a minimal JSON snapshot to the App Group `group.com.dijitalasistan.app` (iOS) or SharedPreferences / the widget task (Android) after each sync and briefing, then calls `WidgetCenter.shared.reloadAllTimelines()`.
- Build options:
  - iOS target: `@bacons/apple-targets` 5.0.0 with a Swift/SwiftUI extension, or `expo-widgets` 57.0.20. The expo-widgets docs are at https://docs.expo.dev/versions/latest/sdk/widgets/ but docs.expo.dev was blocked from this environment, so its feature set is unverified.
  - `react-native-shared-group-preferences` 1.1.24, or a small Expo module, for the App Group writes.
- iOS refresh is budgeted by WidgetKit; follow Apple's “Keeping a widget up to date” guidance.
- Clear the snapshot on sign-out.
- Store only fields that respect the lock-screen detail level.

### Mikro-etkileşimler · Hareket ve Haptik Sözleşmesi / Motion & haptics contract
- **Source:** PRIMARY / 08 / “MİKRO-ETKİLEŞİMLER · HAREKET VE HAPTİK SÖZLEŞMESİ”. Data: `MOTION`, 12 rows. Column headers: ETKİLEŞİM / TETİK · DAVRANIŞ / HAREKET / HAPTİK.
- **Rows (verbatim; format is name — trigger/behavior — motion spec — haptic):**
  1. Brifing açılışı — “Bugün açılır → hero solgundan belirir, sayı 0→N sayar, kartlar sırayla girer.” — `hero 240ms fade+8px · sayı 360ms · kartlar 60ms kademe, 280ms` — yok
  2. AI işliyor — “Taslak/özet üretilirken buton spinner; kart üstünde kayan parıltı. İlerleme çubuğu yok.” — `shimmer 1.6s linear ∞ · spinner .8s` — yok
  3. Öncelik tamamlandı — “Onay ikonuna dokunuş → ikon yeşile dolar, kart küçülerek solar, alttakiler yukarı kayar, toast.” — `ikon 160ms · kart 300ms scale .96 + fade · liste 300ms` — success
  4. Kaydırma aksiyonları — “Sağ: Tamamlandı; sol: Ertele / Önemli değil. Eşik %35, tam kaydırma otomatik uygular.” — `takip 1:1 · bırakma 260ms spring` — eşikte light
  5. Onay — “Onayla → buton “Onaylandı” olur, rozet yeşile döner, kart geçmişe kayar.” — `buton 200ms · rozet 160ms · kart 320ms` — success
  6. Sesli oynatma — “Play → dalga çubukları canlanır, oynat ikonu pause olur, bölüm satırı vurgulanır.” — `çubuklar .7–1.2s alternate · ikon 120ms` — light
  7. Yükleme — “İskelet gerçek kart ölçülerinde; başlıklar anında, AI içeriği sonra dolar.” — `shimmer 1.6s · doluş 60ms kademe` — yok
  8. Senkron — “Aşağı çekme → ince indigo çizgi üstte, tamamlanınca “Güncel · 09:41” 1,5 sn.” — `çizgi 400ms · mesaj 1.5s` — light
  9. Haptik — “success: tamamla/onayla/gönder · light: seçim, eşik · warning: çakışma, hata · asla dekor için.” — `iOS UIFeedbackGenerator · Android HapticFeedbackConstants` — —
  10. Kart genişleme — “Orijinal Mail” ve uzun özetler yerinde açılır; başlık sabit, içerik alttan uzar.” — `height 280ms · chevron 200ms rotate` — yok
  11. Alt sayfa — “Alttan kayar, arka plan %35 ink; sürükleyerek kapanır, hız eşiği ile snap.” — `açılış 300ms · kapanış 240ms · dim 250ms` — açılışta light
  12. Başarı — “Gönderildi/Planlandı → yeşil halka + ikon büyüyerek gelir, tek satır açıklama, geri dönüş butonu.” — `halka 500ms · ikon 450ms 100ms gecikme` — success
- **Global rules:**
  - Easing: `cubic-bezier(.2,.8,.2,1)` standard, `ease-out` for exits.
  - “Hareketi azalt” → all durations 0; only a 120ms opacity transition remains.
  - “Hiçbir animasyon 600 ms'yi geçmez; kullanıcı beklerken animasyon değil bulgu gösterilir.”
- **RN mapping:**
  - Easing: Reanimated `Easing.bezier(0.2, 0.8, 0.2, 1)`.
  - Haptics (expo-haptics): success → `Haptics.notificationAsync(NotificationFeedbackType.Success)`; light → `impactAsync(ImpactFeedbackStyle.Light)` or `selectionAsync()`; warning → `notificationAsync(NotificationFeedbackType.Warning)`. All gated by `haptics_enabled`.
  - Bottom sheet: `@gorhom/bottom-sheet` or a custom Reanimated sheet with the 35% ink scrim `rgba(27,25,23,.35)`.
  - Pull-to-sync: RN `RefreshControl` cannot draw the thin indigo line. It needs a custom gesture or header, or RefreshControl `tintColor="#5B5CE2"` plus a 2px top progress bar.
- **Maps to:** §123, §92, §125.

### Kaydırma Aksiyonları / Swipe actions demo
- **Source:** PRIMARY / 08 / “KAYDIRMA AKSİYONLARI”.
- **Layout:**
  - Right swipe: a 96px strip, background `#2FA062`, `check_circle` FILL 1 26px white plus “Tamamlandı” 11/600. Card: white, radius 20, shadow `-8px 0 24px rgba(27,25,23,.1)`, TAKİP pill (neutral) “3 gün”, text “Gönderdiğin teklif mailine 3 gündür cevap gelmedi.”
  - Left swipe: 168px, two actions: “Ertele” (`schedule`, on `#F0EFEB`) and “Önemli değil” (`remove_circle`, on `#E9E7E1`). Card: “Bugün” + KİŞİSEL pill, right-aligned “Trendyol siparişin bugün geliyor.”
- **Caption:** “Sağa: Tamamlandı (yeşil, tam kaydırmada otomatik). Sola: Ertele · Önemli değil (nötr). Eşik %35; eşikte hafif haptic. Kaydırma yönleri Akış, Bugün ve Takip'te aynıdır.”
- **Real behavior:**
  - Tamamlandı → PATCH item `status=done`, then the success haptic and an undo toast.
  - Ertele → snooze sheet (Bugün akşam / Yarın sabah / Seç) → `reminders` / `snoozed_until`.
  - Önemli değil → a negative feedback signal into learned preferences (§32), with the toast “Öğrendim · …”.
  - Implementation: `react-native-gesture-handler` 3.3.0 `ReanimatedSwipeable`.
  - Accessibility: expose the same actions via `accessibilityActions` (§92).
- **Maps to:** §13, §17, §32, §123, §92.

### Brifing Açılışı · Kare Kare / Briefing open, frame by frame
- **Source:** PRIMARY / 08 / “BRİFİNG AÇILIŞI · KARE KARE”.
- **Frames:**
  - “0 ms · hero solgun” (opacity .4, translateY 8px)
  - “240 ms · sayı sayar” (shows 3)
  - “520 ms · kartlar 60 ms arayla” (shows 5, with cards entering)
- **Inconsistency:** the MOTION table says the count runs 360ms and the cards 280ms, while the frames imply the cards start at 520ms. Normalize to: hero 0–240, count 240–600, cards starting at ~360 with a 60ms stagger, all ≤600ms.
- **Maps to:** §9, §123.

---

## C. Other PRIMARY artboards referenced for these topics (summarized only; other auditors own them)

- **2.9 Brifing Ayarları** (`02 Onboarding`, “ADIM 3 / 4”).
  - Title “Günün ritmi”; sub-line “Brifingleri ne zaman hazırlayayım? Sonradan değiştirebilirsin.”
  - Rows:
    - “Sabah brifingi” / “Günün tamamı · sesli sürüm” / 08:00
    - “Öğle nabzı” / “Yalnızca değişenler” / 13:00
    - “Akşam kapanışı” / “Yarına kalanlar” / 19:00
    - “Hafta sonu” / “Sadece sabah, 10:00 · Kişisel öncelikli”
  - Hint: “Takvimine göre: genelde 08:15'te telefonu açıyorsun. 08:00 iyi bir seçim.” CTA “Devam”.
  - Caption: “Saat çipine dokunuş yerel saat seçiciyi açar. Öğle ve akşam Pro özelliği; ücretsizde kilit ikonu ile görünür, gizlenmez.”
  - **Reuse this layout, minus the step header and with “Kaydet” instead of “Devam”, as Settings → Brifing** (§130). Use the native picker (`@react-native-community/datetimepicker`, mode time, 24h).
- **2.12 Bildirim İzni Açıklayıcı.**
  - Three sample notifications (“Dijital Asistan”, 14:10 / 08:00 / 11:30): “Toplantına 20 dakika kaldı. Mehmet için 3 konu hazır.” / “Bugün cevaplaman gereken önemli bir mail var.” / “Kargon bugün geliyor. 14:00–18:00 arası.”
  - Title “Sadece önemli olduğunda haber verelim.”; sub-line “Günde ortalama 3 bildirim. Pazarlama bildirimi yok, “bak bana” bildirimi yok.”
  - CTAs “Bildirimleri Aç” / “Daha sonra”.
  - These sample notifications are the primary-styled reference for the missing Notification Settings “örnek” previews (§35).
- **2.13 Android · Telefon Bildirimleri.**
  - Header “SADECE ANDROID” / “Atla”; title “Telefon bildirimlerini de anlayayım mı?”; sub-line “Kargo, banka ve uygulama bildirimlerinden kişisel sinyaller çıkarırım. Mesaj içerikleri asla saklanmaz.”
  - `APPS` data:
    - Kargo uygulamaları — “Trendyol, Hepsiburada, Yurtiçi” — on
    - Banka — “Ödeme ve son tarih bildirimleri” — on
    - Havayolu — “THY, Pegasus · kapı ve rötar” — on
    - Rezervasyon — “Yemek, otel, etkinlik” — off
    - Mesajlaşma — “WhatsApp, Telegram · önerilmez” — off
  - Note “Bildirim erişimi cihazda işlenir. Sohbet uygulamaları varsayılan olarak kapalıdır ve önerilmez.”; CTA “Bildirim Erişimini Aç” / “Android Ayarlar → Bildirim erişimi ekranı açılır.”
  - **There is no post-onboarding settings screen in primary; one is needed** (see §D, secondary AndroidNotifications).
- **6.9 AI Kişiselleştirme.**
  - Title “Dijital Asistan seni nasıl tanıyor?”; sub-line “Zamanla öğrendiklerim. Her satırı düzenleyebilir veya silebilirsin; sildiğin şeyi bir daha varsaymam.”
  - Groups:
    - KİŞİLER: “Mehmet Yılmaz yüksek öncelikli.” (Sen ekledin · VIP · Müşteri); “Toplu bültenler düşük öncelikli.” (3 kez “önemli değil” dedin)
    - KONULAR: “Promosyon mailleri düşük öncelikli.” (12 kez arşivledin, hiç açmadın); “Uçuş ve rezervasyonlar Bugün ekranında görünür.” (Onboarding · Seyahat seçildi)
    - TERCİHLER: “Toplantıları 30 dakika önce hatırlatmayı tercih ediyorsun.” (Son 8 hatırlatıcıdan çıkarıldı); “Brifing 08:00, 13:00 ve 19:00.” (Ayarlar); “Yanıt taslaklarında profesyonel ton.” (Son 6 taslaktan 5'i)
  - Row actions: `edit`, `delete`. Plus an “Kural Ekle” button. Caption: “Silme geri alınabilir (5 sn toast).”
  - **Missing versus §32:** the **“Etkileşimlerimden öğren” toggle** (present in secondary) and a per-row **disable** (§32 requires edit / disable / delete; primary has edit and delete only).
  - “Kural Ekle” here blurs explicit rules and learned preferences, which §32 says must stay separate. It should link to 7.10 instead.
- **3.8 “Dijital Haftam” paylaşım kartı 1080×1350** (`03`): the primary share card, with the “Dijital Haftamı Paylaş” CTA and `ios_share`. This is the §12 privacy-safe share card, so it is not in 09. Render with `react-native-view-shot` 6.0.1 and share with `expo-sharing` 57.0.21.

---

## D. SECONDARY-only screens and coverage (take the IA and function, restyle to primary)

### Bildirim Ayarları / Notification Settings (secondary; primary has only a row value)
- **Source:** SECONDARY / `src/screens/settings/NotificationSettings.tsx`.
- **Content:**
  - Accent row: “Akıllı Filtre” / “Yalnızca gerçekten önemliyse bildir”.
  - `Brifing Bildirimleri`: “Sabah Brifing” / “Her sabah günlük özetiniz”; “Gün Ortası Nabzı” / “Öğle saati güncelleme”; “Akşam Kapanış” / “Günün özeti ve yarına hazırlık”.
  - `Anlık Bildirimler`: “Kritik E-postalar” / “Yüksek öncelikli mesajlar”; “Toplantılar” / “Toplantı hatırlatmaları”; “Son Tarihler” / “Yaklaşan teslim tarihleri”; “Takip Hatırlatmaları” / “Yanıt bekleyen e-postalar”.
  - `Yaşam Zekası`: “Life Intelligence” / “Kargo, uçuş, ödeme takibi”, default off.
  - These cover all 8 categories in §35 exactly.
- **Missing even in secondary; production must add:**
  - **Sessiz Saatler** (start/end, days, with the VIP bypass from 7.9 “Sessiz saatlerde bile”).
  - **Kilit Ekranı Gizliliği**.
  - **Bildirim Detay Seviyesi**, three options (§86), for example: “Tam içerik” (sender + summary) / “Yalnızca başlık” (“Ahmet Yılmaz'dan önemli bir mail”) / “Genel” (“Yeni bir önemli konu var”).
  - The OS permission state row (denied → “Bildirimler kapalı · Ayarlar'da aç” via `Linking.openSettings()`).
  - Per-category Pro locks (midday/evening).
  - A sample-notification preview in the 2.12 style, reflecting the chosen detail level.
- **Entity:** `notification_preferences`
  - `mode` ('smart' | …)
  - `categories` jsonb: `{morning, midday, evening, critical_email, meetings, deadlines, follow_up, life}`
  - `quiet_hours {start, end, days[], vip_bypass}`
  - `detail_level` ('full' | 'title' | 'generic')
  - `lock_screen_private` bool
  - Consumed by the §132 decision engine.
- **Platform:**
  - Android channels, one per category: `setNotificationChannelAsync(id, {importance, lockscreenVisibility: AndroidNotificationVisibility.PRIVATE | SECRET})`.
  - iOS: `interruptionLevel: 'timeSensitive'` for critical and VIP. This needs the `com.apple.developer.usernotifications.time-sensitive` entitlement.
  - iOS cannot know whether the device is locked at send time. Lock-screen privacy is implemented by choosing the payload server-side, and the system “Önizlemeleri Göster” setting is respected. Document this in `KNOWN_PLATFORM_LIMITATIONS.md` (§91).
  - Android 13+ `POST_NOTIFICATIONS` runtime permission.
- **Prototype-only:** local `useState` toggles only.
- **Maps to:** §35, §86, §132, §96.

### Brifing Ayarları (secondary) / Briefing Settings
- **Source:** SECONDARY / `BriefingSettings.tsx`.
- **Adds over 2.9:**
  - Per-slot on/off toggles.
  - Custom ± hour and ±15-minute steppers (replace them with the native time picker).
  - “Hafta sonu brifing” / “Cumartesi ve Pazar dahil et”.
  - “Saat Dilimi” / “Istanbul (GMT+3)”, read-only.
  - “Sessiz Günler” day chips Pzt–Paz. **The copy contradicts itself:** it is titled “Sessiz Günler” but says “Brifing almak istediginiz günleri seçin”.
  - Defaults are 07:30 / 13:00 / 19:00, versus primary's 08:00.
- **Production:** timezone from the device (`expo-localization` `getCalendars()[0].timeZone`), stored separately (§39), DST-safe server scheduling (§96). Remove the Turkish-character stripping (“istediginiz”).
- **Maps to:** §9–§11, §39, §96.

### Veri Kaynağı Kontrolü / Data Source Control
- **Source:** SECONDARY / `DataSourceControl.tsx`.
- **Content:** subtitle “Her kaynak için hangi işlemlere izin verdiğini ayrı ayrı yönet.”
  - Gmail (yunus@gmail.com): “Mailleri oku”, “Ekleri analiz et”, “Son tarihleri tespit et”, “Taslak cevap hazırla”.
  - Google Takvim: “Etkinlikleri oku”, “Program öner”, “Onayınla etkinlik oluştur”.
- **Production:** fold this into the Connected Account detail (reached from 7.2 “Yönet”), next to the granted OAuth scopes. Toggles are capability flags that the server enforces (`connected_accounts.capabilities` jsonb). Turning off a capability does not revoke the OAuth scope; state that explicitly.
- **Maps to:** §40 “Data Source Controls”, §75.

### Entegrasyonlar / Connected Accounts list
- **Source:** SECONDARY / `Integrations.tsx`.
- **Providers:** Gmail, Outlook, Google Takvim, Microsoft Takvim, Apple Takvim, Google Tasks, Microsoft To Do, Apple Reminders, each with a “Bağlı” pill or a “Bağla” button, plus “Kaldır”. Footer: “Tüm bağlantılar OAuth ile güvenli şekilde yapılır. İstediğin zaman kaldırabilirsin.”
- **Production:**
  - Real OAuth per provider.
  - Apple Takvim and Apple Reminders are EventKit on-device (iOS only), not OAuth; state that.
  - “Kaldır” → a confirm sheet, then server token revoke and data purge per retention.
  - Free plan limit: 1 mail + 1 calendar; the second add goes to the paywall (§44).
- **Prototype-only:** `toggle()` flips connected and sets a fake `yunus@example.com`.
- **Maps to:** §75, §76, §44.

### VIP Kişiler (secondary)
- **Source:** SECONDARY / `VIPPeople.tsx`.
- **Content:** banner “⭐ VIP kişilerin mesajları her zaman önce gösterilir.”, the list “VIP LİSTEN (n kişi)”, and “VIP Ekle” / “Kaldır”.
- The primary 06 6.6 VIP artboard wins visually. Take only the add/remove action. **Bug to avoid:** the whole row navigates while the inner button toggles, so the tap targets conflict.
- **Maps to:** §30.

### AI Kişiselleştirme (secondary)
- **Source:** SECONDARY / `AIPersonalization.tsx`.
- **Adds:**
  - Per-item “Düzenle” (a sheet with priority Yüksek / Normal / Düşük) / “Devre Dışı”↔“Etkinleştir” / delete.
  - Empty state “AI henüz bir tercih öğrenmedi.”
  - Section `EĞİTİM VERİSİ` with the toggle “Etkileşimlerimden öğren” / “Daha iyi öneriler için verilerini kullan”.
- **Take:** the disable action and the learn toggle (§32 requires both). Restyle to 6.9.
- **Fix the copy:** “verilerini kullan” must not imply model training. Suggested: “Tepkilerinden öğrenip önceliklendirmeyi uyarlar; model eğitimi yapılmaz.”
- **Maps to:** §32.

### Telefon Bildirimleri (Android settings) / Android Notification Intelligence settings
- **Source:** SECONDARY / `AndroidNotifications.tsx`.
- **Content:**
  - Explainer “Bildirim Zekası” / “İzin verirsen diğer uygulamalardan gelen bildirimleri de Dijital Asistan analiz edebilir. Önemlileri filtreler, gerisini özetler.”
  - Master toggle “Bildirim Erişimi” / “Tüm bildirimler için temel izin”.
  - `ERİŞİM MODU`: “Tüm Bildirimler” / “Seçili Uygulamalar” (§36 requires exactly this choice).
  - App list: WhatsApp, Gmail, LinkedIn, Google Takvim, Slack, Trendyol, Ziraat Bankası, BiTaksi, each with a priority dot.
  - `ÖNCELİK KURALLARI`: “Para transferleri her zaman önemli”, “Toplantı hatırlatmaları ilet”, “Teslimat bildirimleri özetle”, “Sosyal medya bildirimlerini filtrele”.
  - Note “Gizlilik Güvencesi” / “Bildirim içerikleri yalnızca cihazında işlenir. Reklamverenlerle paylaşılmaz. Dilediğin zaman bu erişimi kapatabilirsin.”
  - Footer “Yalnızca Android 12+ cihazlarda geçerlidir.”
- **Production:**
  - A native Kotlin `NotificationListenerService` via an Expo config plugin plus an Expo Module.
  - The master “toggle” cannot grant access. It must deep-link to `Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS`, or on API 30+ `ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS` with the component name, and read the real state via `NotificationManagerCompat.getEnabledListenerPackages()` on resume.
  - The app list comes from packages seen in notifications (`PackageManager`).
  - Exclude authenticator and OTP apps by default (§36).
  - Messaging apps: resolve the conflict with 7.3 “Mesajlaşma içerikleri” (never).
  - Android 15 redacts OTP-containing notifications from untrusted listeners. Document it.
  - Google Play needs a prominent-disclosure screen (2.13 serves) and a Data safety entry.
  - Pro-gated (§44).
- **Wrong in secondary:** “Android 12+” is incorrect; the API exists since API 18. The in-app master toggle and the in-render `useState` inside `.map()` (breaks hook rules) are prototype-only.
- **Maps to:** §36, §44, §91.

### Görünüm (secondary) / Appearance
- **Source:** SECONDARY / `AppearanceSettings.tsx`.
- Order Sistem / Açık / Koyu, with descriptions “Cihaz ayarına göre” / “Her zaman açık” / “Her zaman koyu”, and a live preview.
- **Take:** the System-first order and the descriptions. Visuals are primary 7.8. Secondary's dark palette (`#0F0F1A` / `#1E1E2E`) is rejected; use primary DARK.
- **Maps to:** §38.

### Dil ve Bölge / Language & Region
- **Source:** SECONDARY / `LanguageSettings.tsx`.
- **Adds:** `Bölge Ayarları` with “Tarih Formatı · 31.12.2025” and “Saat Formatı · 24 saat (14:30)”.
- **Take:** the region rows as read-only info, or as pickers bound to the locale (§39: 24h, TR dates).
- **Reject:**
  - “Yakinda” badges for EN/DE/FR/ES (§100). English must be fully supported.
  - “Dil degisikligi uygulamayi yeniden baslatir” (not needed).
  - The ASCII-stripped Turkish (“Ayarlari”, “Fransizca”).
- **Maps to:** §39, §100.

### Gizlilik ve Güvenlik (secondary) + İzinler sheet
- **Source:** SECONDARY / `SecurityPrivacy.tsx`.
- **Adds:**
  - A 4th promise, “🗑️ Verilerini istediğin zaman silebilirsin”.
  - The correct encryption wording “Veriler aktarım sırasında ve saklanırken şifrelenir” (prefer it over primary's “Uçtan uca TLS”).
  - An **İzinler** sheet listing Kamera, Mikrofon, Bildirimler, Takvim, Kişiler with statuses (“İzin Verildi” / “Reddedildi”) and “Sistem Ayarlarına Git ↗”. This is §40 “Permissions”: read real statuses via each Expo module's `getPermissionsAsync()` and open settings with `Linking.openSettings()`.
- **Reject:**
  - Retention options “3 ay / 6 ay / 1 yıl / Sınırsız (PRO)” and “Aboneliğin bittiğinde veriler 30 gün içinde silinir” (unsupported policy).
  - The clear-history copy “AI sohbet geçmişin ve öğrenilen tercihler sıfırlanacak”, which defines different semantics from 7.4.
  - Download via email to `yunus@example.com`.
  - Delete-account copy “Tüm verilerin, bağlı hesapların ve aboneliğin kalıcı olarak silinir.” This is false: store subscriptions are not cancelled by account deletion, and Apple requires telling users how to cancel.
  - The dead “Evet, Hesabımı Sil” button.
  - The `setTimeout` fake confirmations (“Geçmiş Temizlendi”, “İstek Alındı”).
- **Maps to:** §40, §41, §128, §129.

### Yardım / Help
- **Source:** SECONDARY / `HelpScreen.tsx`.
- **IA:**
  - Başlarken: İlk Kurulum, Hesap Bağlama, Brifing Ayarları
  - Özellikler: Sabah Brifing Nedir?, Mail Zekası Nasıl Çalışır?, Taahhüt Takibi
  - Entegrasyonlar: Gmail Bağlama, Takvim Erişimi, Outlook Kurulumu
  - Destek: Hata Bildir → Feedback; Destek ile İletişim → `destek@dijitalasistan.app`
  - Footer “Dijital Asistan v1.0.0 / Tüm haklar saklıdır © 2025”
- **Production:**
  - Articles come from the web `/support` (§73), opened in-app via `expo-web-browser`, or from bundled markdown.
  - Contact → `expo-mail-composer` 57.0.2 or a `support_tickets` form (§62).
  - Add “Hakkında” (About, §130): version, licenses, Terms, Privacy, Data deletion.
- **Reject:** the sheet “Bu konuyla ilgili yardim içerigi hazirlaniyor.” (placeholder, §100) and “© 2025”, which must be dynamic.
- **Maps to:** §130, §62, §73, §100.

### Geri Bildirim / Feedback
- **Source:** SECONDARY / `FeedbackScreen.tsx`.
- **IA:**
  - Type: “Hata Bildirimi” (Bir sorun veya hata buldum), “Özellik İsteği”, “Genel Geri Bildirim”.
  - 5-star rating with labels “Mükemmel!” / “Çok iyi!” / “İyi” / “Geliştirilebilir” / “Kötü”.
  - Message textarea “Görüş ve önerilerinizi buraya yazın...”.
  - Optional email.
  - Submit “Geri Bildirim Gönder” / “Gönderiliyor...”.
  - Success “Teşekkürler!” / “Geri bildiriminiz iletildi…” / “Yeni Geri Bildirim”.
- **Production:**
  - Add the §62 type **“AI Kalitesi”**.
  - Auto-attach platform, app version and OS (`expo-application`, `expo-device`).
  - Insert into `support_tickets` (status Open).
  - Remove the email field (the user is authenticated), or keep it only for signed-out users.
  - Success only after a server 2xx.
- **Reject:** the `setTimeout` fake submit and the bouncing icon.
- **Maps to:** §62, §59.

### Additional empty / error / loading states (secondary)
- **Sources:** SECONDARY / `EmptyStates.tsx`, `ErrorStates.tsx`, `LoadingStates.tsx`.
- **Empty variants to add, restyled to the 08 tile:**
  - “Mailini bağla.” / “Gmail veya Outlook bağlayarak önemli konuları burada görebilirsin.” / CTA “Hesap Bağla”
  - “Henüz VIP kişi yok.” / “Önemli kişileri ekleyerek onlardan gelen mesajlara öncelik ver.” / “Kişi Ekle”
  - The calendar empty state with “Etkinlik Ekle”, which becomes an approval `calendar_create`.
- **Error variants to add:**
  - “Erişim izni reddedildi.” / “Google hesabında izin onaylanmadı. Tekrar denemek için aşağıya dokun.” / “Tekrar Dene” / “İptal” (OAuth consent declined)
  - “İnternet bağlantısı yok.” / “Çevrimiçi olduğunda her şey otomatik olarak güncellenir.”
  - “AI şu an meşgul.”, which is covered by `error/ai-unavailable`.
- **Loading variants to add:**
  - “AI Analiz Yapıyor” with the steps “Mail analizi yapılıyor” → “Takvim kontrol ediliyor” → “Öncelikler belirleniyor” → “Brifing hazırlanıyor”. Use only if the steps reflect real job progress (job status events); otherwise it is fake loading.
  - Sync status bar “Senkronize ediliyor / Gmail · Son güncelleme: az önce”.
  - Mail-card, meeting-card and insight-card skeletons.
  - Full-screen “Güncelleniyor / Yeni içerik aranıyor...”.
- **Reject:** emoji icons, the iOS-system palette (`#FF3B30`, `#34C759`, `#007AFF`, `#8B5CF6`), gradient buttons, and the `handleRetry` fake “✓ Deneniyor...”.
- **Maps to:** §93, §94.

### Bilgi Mimarisi / IA page and User Flows (documentation only)
- **Sources:** SECONDARY / `IAPage.tsx`, `UserFlows.tsx`.
- **Useful IA facts:**
  - Onboarding order: Karşılama → Gürültü → Proaktif → Kontrol → Hesap → Bağla → İzin → Tercihler → Kişisel. → VIP → Analiz → Aha! → Bildirim → Bugün.
  - Shared screens: Arama, Onay Merkezi, Kişi Profili, Evrensel Yakalama.
  - Profile children: Profil, Entegrasyonlar, AI Kişisel., Güvenlik, Veri Kontrolü, VIP Kişiler, Android Bildirim, Paywall, Referral.
- **Flows:**
  - FLOW 1 İlk Kurulum
  - FLOW 2 Önemli Mail → Yanıt (with “Kullanıcı Onayı”)
  - FLOW 3 Toplantı Hazırlığı
  - FLOW 4 Son Tarih → Hatırlatıcı
  - FLOW 5 Asistan Sorgusu
  - FLOW 6 Ücretsiz → Premium (Premium Özellik → Paywall → 7 Gün Trial → Pro Kullanıcı)
- **Rule worth keeping:** “Kritik bildirimler flow'u kesebilir (overlay/modal değil, banner)” → an in-app banner for foreground pushes.
- **Not product screens:** the “Tasarım Sistemi” group in secondary Profile, DesignSystem, IAPage, UserFlows, WidgetShowcase, AndroidFrame, AppStore, SocialAds and Landing entries are prototype-only navigation and must not ship in the app.

### Bildirim Örnekleri / Notification Examples (copy reference)
- **Source:** SECONDARY / `NotificationExamples.tsx`.
- **Copy per type:**
  - Sabah Brifing 07:30: “Günaydın. Bugün bilmen gereken 5 şey var.” / “Ahmet cevap bekliyor · 14:30 toplantın var · Elektrik faturası bugün son gün”
  - Kritik Uyarı 10:14: “Ahmet senden bugün 17:00'ye kadar dönüş bekliyor.” / “Revize fiyat teklifi · Gmail · 3 saattir bekliyor”
  - Toplantı Hatırlatma 14:10: “14:30 toplantına 20 dakika kaldı.” / “Mehmet Kaya · Google Meet · 3 hazırlık notun var”
  - Gün Ortası 13:00: “Sabahından beri 2 önemli gelişme oldu.” / “Mehmet toplantıyı 16:00'ya almak istiyor · Kargo bugün geliyor”
  - Akşam Özeti 19:00: “Bugünden yarına 3 konu kalıyor.” / “Teklif maili · Mehmet takibi · Yarın 10:00 toplantı”
  - Sessiz Özet 11:45: “Trendyol siparişin bugün teslim edilecek.” / “Tahmini teslimat: 14:00–18:00”
- **Principles:** “Sadece gerçekten önemli olduğunda gönder”, “Her bildirimin net bir aksiyonu olsun”, “Gün içinde maksimum 3–5 bildirim”, “Teknik jargon yok, doğal Türkçe”, “Özet ve gruplandırma tercih et”.
- **Production:** these become the push templates for the full detail level. The `title` and `generic` variants must be authored too (§86). The daily cap: primary says “Günde ortalama 3”, secondary says “3–5”. Set the §132 frequency cap to 5/day, excluding VIP and critical.
- **Maps to:** §35, §86, §132.

### Widget Galerisi (secondary)
- **Source:** SECONDARY / `WidgetShowcase.tsx`.
- **Content:**
  - Small: an indigo-gradient “3 öncelikli konu / Sabah brifingini aç →”.
  - Medium: greeting plus 3 stat tiles (Öncelik 3 / Toplantı 4 / Takip 2) plus “⚠ Ahmet Y. teklif yanıtı bekliyor”.
  - Large: “✓ 2s 48dk kazandı”, “KRİTİK · Ahmet Yılmaz teklif yanıtı bekliyor · Gmail · 3 saattir okunmadı”, meeting “Proje Değerlendirme · 10:00 · 45 dk · Google Meet · 18dk”, stats 3/6/84, and “Sabah Brifingini Dinle”.
  - Lock-screen rectangular “3 öncelikli konu · 4 toplantı / Sabah brifingini aç”.
- **Decision:** primary 08 widgets win; they answer one question per widget. Secondary adds nothing required beyond confirming the lock-screen family.
- **Maps to:** §37.

### Landing (web) / Public marketing site (secondary only; primary has none)
- **Source:** SECONDARY / `marketing/Landing.tsx`.
- **IA:**
  - Nav: logo, “Özellikler / Güvenlik / Fiyatlandırma”, CTA “Ücretsiz Başla”.
  - Hero: “Dijital hayatın artık tek yerde.” / “Mail, takvim ve taahhütlerinizi AI ile yönetin. Her sabah 60 saniyelik brifingla güne hazır başlayın.” / “7 Gün Ücretsiz Başla →” / “▶ Demo Gör” / “Kredi kartı gerekmez · iOS ve Android”.
  - Integrations strip “ŞU ANDA BAĞLI HESAPLAR”: Gmail, Outlook, Google Takvim, Apple Takvim, Zoom, Teams.
  - Features (6): Sabah Brifingini, Mail Zekası, Akıllı Plan, Taahhüt Takibi, AI Belleği, Güvenlik.
  - Pricing: Aylık 199 TL / Yıllık 1.490 TL “Aylık 124 TL · %38 indirim”.
  - Final CTA: “Dijital hayatını kontrol altına al.”
- **Production** (Next.js, routes `/`, `/pricing`, `/privacy`, `/terms`, `/support`, `/data-deletion`, `/d/[code]` for referral):
  - Build in primary language: light `#F5F4F0` base, Geist, dawn/night gradients for brand moments, real product components as visuals (reuse the 09 store compositions).
  - Use the §73 hero “Bugün bilmen gerekenleri, sen sormadan söyler.” and supporting line “Dijital Asistan mailini, takvimini ve açık işlerini anlayıp her gün sana kısa bir brifing hazırlar.”
  - Sections per §73: Hero, Integrations, How it works, Morning Briefing, Mail Intelligence, Meeting Prep, Smart Planning, AI Memory, Security, Pricing, FAQ, CTA.
  - SEO, Open Graph, sitemap, robots.
- **Reject:**
  - The dark `#0F0F1A` Inter look.
  - The hero copy.
  - “Şu an ücretsiz erişim açık”.
  - **“Kredi kartı gerekmez”**, which is false for App Store / Play free trials because a payment method is required.
  - “60 saniyelik” (primary says “Dinle · 2 dk”).
  - “Gerisini siler” (the product never deletes mail).
  - Zoom and Teams (not integrations in scope).
  - Dead nav spans and “Demo Gör” navigating into an app screen.
- **Maps to:** §73, §74, §137.

### Paywall (secondary)
- **Source:** SECONDARY / `marketing/Paywall.tsx`.
- **Content:**
  - Hero “Dijital Asistan'ın tamamını aç.” / “7 gün ücretsiz dene, istediğin zaman iptal et.”
  - 9-benefit grid: Sınırsız AI analiz, Akıllı takip ve hatırlatmalar, Meeting Prep, Gün Ortası & Akşam Brifingleri, Sesli brifing, AI hafıza, Çoklu hesap desteği, VIP kişiler, **Android Bildirim Zekası**.
  - Side-by-side plan cards (“~124 TL/ay”, “Her ay yenilenir”).
  - CTAs “7 Gün Ücretsiz Dene” / “Ücretsiz ile devam et”.
  - “İstediğin zaman iptal edebilirsin. Karanlık örüntü yok.”
- **Take:** add Universal Capture and Android Notification Intelligence rows to the primary PLAN table (they are §44 PRO items missing from primary). Both CTAs `navigate('today')` are fake purchases.
- **Maps to:** §43, §44.

### Davet (secondary) / Referral
- **Source:** SECONDARY / `marketing/Referral.tsx`.
- **Content:** “İkiniz de 14 gün Pro kazanın.” / “Arkadaşın uygulamaya kaydolunca her ikiniz de 14 gün ücretsiz Pro kazanırsınız.”; “DAVETİYE LİNKİN” “dijital.asistan/davet/yunus42”; buttons “WhatsApp'tan Paylaş” (`#25D366`) and “Paylaş…”; stats “Gönderilen davet 3 / Kazanılan gün 14”.
- **Conflicts with primary:** the reward condition (signup here vs first briefing in primary; primary wins, since it is more abuse-resistant) and the invalid domain.
- **Take:** nothing extra. A WhatsApp-specific button is unnecessary because the native share sheet covers it.
- **Maps to:** §45.

### Sosyal Medya Görselleri (secondary)
- **Source:** SECONDARY / `marketing/SocialAds.tsx`.
- Three concepts identical to primary's ads 01–03, in a dark Inter style:
  - “BUGÜN GELENLERİN HEPSİ 284 / 6 / 14 → BUGÜN GERÇEKTEN BİLMEN GEREKEN 4 şey var. Gerisini AI halletti.”
  - “Bir maili cevaplamayı unuttuğun oldu mu?” with a “Smart Follow-Up” card.
  - The “Ben artık sabah Gmail açmıyorum.” quote attributed to “— Dijital Asistan kullanıcısı”.
  - Plus “9:16 · Instagram · Reels · TikTok”.
- **Reject:** the style and the dead “PNG İndir / MP4 İndir” buttons.
- **Take:** the channel labels.
- **Maps to:** §74.

### App Store Görselleri (secondary)
- **Source:** SECONDARY / `marketing/AppStoreScreenshots.tsx`.
- **Headlines:**
  - “Bugün bilmen gerekenleri, sen sormadan söyler.”
  - “84 mail içinde yalnızca 3 önemli.”
  - “Toplantıdan önce her şeyi biliyorsun.”
  - “Takip edilmesi gereken hiçbir şeyi kaçırma.”
  - “Sesli asistan. Sade. Hızlı. Akıllı.”
  - “Bu hafta 2 saat 48 dakika kazandın.”
- Plus badges “iPhone 6.7"”, “Türkçe · TR”, and export buttons “PNG 6.7" / 6.1" / 5.5"” (dead).
- **Decision:** primary 09 wins; its headlines match §74. Secondary suggests a **Weekly Review** and a **Voice** screenshot as optional 7th/8th slots (the App Store allows up to 10; Google Play allows up to 8 phone screenshots).
- **Maps to:** §74, §112.

### Haftalık Rapor + share card (secondary)
- **Source:** SECONDARY / `marketing/WeeklyReport.tsx` + `data/mock.ts weeklyStats` (684 / 32 / 8 / 21 / 4 / “2 sa 48 dk” / “Salı” / Mehmet Kaya, Ahmet Yılmaz, Fatma Şahin).
- **Content:** “1–7 Eylül 2025”, “Haftan Nasıl Geçti?”, “TAHMİNİ KAZANDIRILAN ZAMAN”, stat tiles, “EN YOĞUN GÜNÜN”, “EN ÇOK İLETİŞİMDE OLDUĞUN KİŞİLER”, share card “DİJİTAL HAFTAM / Bu hafta 684 mail analiz edildi, 2 sa 48 dk kazandırıldı. / Paylaş”.
- Primary 03 3.7 and 3.8 win.
- **Privacy note:** the share card must not include contact names (secondary's top-contacts are in-app only), per the §12 privacy-safe share card.
- **Maps to:** §12.

---

## E. PRIMARY 09 · Mağaza Ekranları ve Reklamlar

The spec line in the file header: “6 mağaza görseli 1290×2796 (App Store 6.7", Google Play için aynı kompozisyon 1080×1920'ye yeniden çerçevelenir). 3 reklam 9:16, 1080×1920. Tüm görseller ürünün gerçek ekranlarını kullanır; metinler brief'ten birebir.”

**Shared store-screenshot anatomy** (at 1290×2796):
- Text block at left/right 110px, top 180px.
- Kicker: 40px, weight 600, letter-spacing .12em.
- Headline: 112–124px with line height 120–130px, weight 600, letter-spacing −.03 to −.035em.
- Supporting line: 44/58px.
- Device: 980×2000 at left 155, top 980–1060, radius 130, bezel `box-shadow: 0 0 0 18px #1A1917` (store/03 uses `#3A3936`), drop shadow `0 80px 160px rgba(…,.3–.5)`.
- Inner UI: the real 390pt layout scaled 2.513×.
- **Production:**
  - Generate from real app screens: Maestro or Detox screenshots in demo mode (§89), composited via a script. Hand-drawn HTML is not acceptable.
  - App Store Connect accepts 1290×2796 for the 6.9"/6.7" slot.
  - Google Play phone screenshots must be ≤2:1 aspect. 1290×2796 is 2.17:1, so it cannot be reused; the file already plans a 1080×1920 re-frame.
  - English variants are needed (§39).
  - Missing: the Google Play feature graphic (1024×500) and the app icon.

### store/01 · Today
- **Background:** gradient/dawn `160deg #1E1E4C → #3B3CA8 58% → #7071EA`.
- **Kicker:** “DİJİTAL ASİSTAN” (opacity .75). **Headline:** “Bugün bilmen gerekenleri, sen sormadan söyler.”
- **In-device:** Today with “5 EYLÜL CUMARTESİ” / “Günaydın, Yunus”; brief card “BRİFİNG HAZIR · 07:58” / “Bugün bilmen gereken **5** şey var.” / “3 önemli mail · 4 etkinlik · 2 takip” / “Brifingimi Gör” (indigo) / “Dinle · 2 dk”; “ÖNCELİKLERİN”; ACİL card “Ahmet senden bugün 17:00'ye kadar revize teklif bekliyor.” / “Gmail · Ahmet Yılmaz · 08:42”.
- **Maps to:** §74 msg 1, §8.

### store/02 · Mail Intelligence
- **Background:** `#F5F4F0`.
- **Kicker:** “MAİL ZEKÂSI” in `#9B978E`. **Headline:** “83 mail.<br>Önemli olan **4**.” **Supporting line:** “Gerisini senin için okur.”
- **In-device:**
  - “83 mail geldi” (44/48 + 17px); “**4** tanesi dikkat gerektiriyor.”
  - Stacked bar 8px: 5% `#5B5CE2` / 37% `#C9C7F3` / 58% `#E9E7E1`.
  - Card AY (`#F5E1D6`/`#7A3E1F`) Ahmet Yılmaz ACİL “Revize fiyat teklifini bugün 17:00'ye kadar PDF olarak istiyor.”
  - Card SK (`#E3EFE6`/`#1E5A36`) Selin Kaya “Dün” “Sözleşme taslağının 4. maddesi için yorumunu bekliyor.”
- **Note:** §74 says “83 mail. Gerçekten önemli olan 4.” The primary drops “Gerçekten”. Pick one.

### store/03 · Meeting Prep
- **Background:** `#1A1917`.
- **Kicker:** “TOPLANTI HAZIRLIĞI” in `#A9AAF5`. **Headline:** “Toplantıya hazırlıksız girme.” **Supporting line:** “20 dakika önce: konuşman gereken 3 şey.”
- **In-device:**
  - Status bar 14:12; “TOPLANTIYA HAZIRLAN” plus the chip “18 dk” (warning, `schedule`).
  - MY avatar `#DCE4F5`/`#2B3F73`; “Mehmet Yılmaz” / “Müşteri toplantısı · 14:30 · 60 dk”.
  - Ink card “KONUŞMAN GEREKEN 3 ŞEY”:
    1. “Fiyat” — “Revize teklif 17:00'ye kadar bekleniyor.”
    2. “Teslim tarihi” — “Ekim başı için onay istiyor.”
    3. “Sözleşme” — “Taslak 2 haftadır açık.”

### store/04 · Follow-ups
- **Background:** `#EDEDFC`.
- **Kicker:** “SENDEN BEKLENENLER” in `#4547C9`. **Headline:** “Kim senden cevap bekliyor?” **Supporting line:** “Unutulan mail kalmaz.”
- **In-device:**
  - “Senden Beklenenler” / “4 kişi cevabını bekliyor.”
  - Group ACİL (dot `#E0553F`): AY Ahmet Yılmaz “2 saat” “Re: Eylül teklifi – revize” “Revize fiyat teklifi, PDF olarak.” “Bugün 17:00” (`#C7432F`) “Yanıtla”.
  - Group BUGÜN (dot `#E09A1C`, label `#9A6300`): SK Selin Kaya “18 saat” “Sözleşme taslağı · 4. madde” “Cezai şart maddesi için yorumun.”
- **Claim check:** “Unutulan mail kalmaz.” is an absolute claim; soften it or keep it as marketing puffery consciously (§74, “gerçeğe uygun”).

### store/05 · Planning
- **Background:** `#F5F4F0`.
- **Kicker:** “TAKVİM ZEKÂSI”. **Headline:** “Takvimini sadece göstermez. Anlar.”
- **In-device:**
  - “Plan”; AI card (radial gradient) “TAKVİM ZEKÂSI” “Yarın 14:00–16:30 arasında 2,5 saat boşluğun var.” “Teklif hazırlama görevini buraya yerleştirebilirim.” “Planla”.
  - “Yarın oldukça yoğun.” (`bolt` `#9A6300`) “09:00 ve 10:00 toplantıların arka arkaya.”
  - `directions_car` `#2262BE` “13:30 doktor için 12:50'de çıkman gerekebilir.” “38 dk trafik tahmini”.
- **Claim check:** the traffic ETA requires location (off by default in 7.3) and a routing API that the master prompt does not specify. Implement it as an opt-in feature, or remove it from marketing (§74, §141).

### store/06 · Assistant
- **Background:** gradient/night `180deg #15153A → #25266A 60% → #3B3CA8`.
- **Kicker:** “ASİSTAN”. **Headline:** “Dijital hayatına sor.” **Supporting line:** “Mailin, takvimin ve notların tek hafızada.”
- **In-device:**
  - User bubble (`#5B5CE2`, radius 18): “Mehmet ile en son ne konuştuk?”
  - Answer: “1 Eylül'de fiyat ve teslim tarihini konuştunuz. Mehmet Ekim başı teslim için revize teklif istedi; sen Cuma göndereceğini söyledin.”
  - “KAYNAKLAR”: `mail` “Re: Teklif · Gmail · 1 Eyl”; `call` “Görüşme notları · 1 Eyl”.
- **Note:** “Görüşme notları” implies notes captured via Universal Capture or Post-Meeting. That is valid only if the capture exists.
- **Maps to:** §24, §26, §131.

### ad/01 · Gürültü → 4 şey
- 1080×1920, background `#F5F4F0`, padding 120×96.
- Fading lines 88/96 `#B8B4AA` at opacity .55/.7/.85: “284 okunmamış mail” / “6 takvim etkinliği” / “14 görev”.
- 96px indigo circle with `arrow_downward`.
- Card: radius 64, padding 64, radial gradient, shadow `0 30px 90px rgba(91,92,226,.16)`: “BRİFİNG HAZIR” / “Bugün gerçekten bilmen gereken **4** şey var.” (82/92).
- Footer lockup: 88px tile radius 28 `#5B5CE2` with a white `auto_awesome`; “Dijital Asistan” 40/600; tagline “Gürültüyü değil, önemli olanı gör.”

### ad/02 · Akıllı takip
- Background `#1A1917`.
- “Bir maili cevaplamayı unuttuğun oldu mu?” (104/112).
- White card: radius 56, padding 48, `rotate(-1.5deg)`.
  - MY 112px; “Mehmet Yılmaz” / “Teklif · 3 gün önce gönderildi”; chip “3 gün” (warning).
  - “Henüz yanıt gelmedi.”
  - Buttons “Takip Mesajı Hazırla” (indigo) / “Yarın Hatırlat”.
- Body “Gönderdiğin ve cevap gelmeyen her maili takip eder. Sen unutsan da o unutmaz.”
- Footer: white tile; “Dijital Asistan” / “Akıllı Takip · 7 gün ücretsiz”.
- **Note:** “7 gün ücretsiz” must match a real intro offer. Akıllı Takip is Pro.

### ad/03 · Sabah brifingi
- Background gradient/dawn.
- Lora 112/124 quote: ““Ben artık sabah Gmail açmıyorum.”” Attribution “Yunus E. · Kurucu, İstanbul” (36px, .7).
- Card `#F5F4F0`, padding 56/56/48:
  - “SABAH BRİFİNGİ · 08:00” / “Günaydın Yunus” (68/78).
  - Lora 40/60: “Öğlene kadar toplantın bulunmuyor. Saat 14:30'da Mehmet ile müşteri toplantın var. Gelen 46 mail arasında 3 konu dikkat gerektiriyor.”
  - Ink button (112px, radius 32) with `headphones`: “Brifingi Dinle · 2 dk”.
- Footer tagline: “Bugün bilmen gerekenleri, sen sormadan söyler.”
- **Production rules (from the file):** “Reklam kuralları: ürün ekranı her zaman gerçek bileşen; kişisel isimler kurgusal. Sesli/videolu sürümde AD 1 sayılar yukarıdan akarak 4'e “çöker”, AD 3 alıntı daktilo efektiyle yazılır. Alt logo bloğu üçünde sabit.”
- **Critical issue:** ad/03 presents a **fabricated testimonial as a named real person** (“Yunus E. · Kurucu, İstanbul”). This conflicts with the file's own rule “kişisel isimler kurgusal”. It is deceptive under TR advertising regulation and store and ad-network policies. Use a real consented customer quote, or label it “temsili” (illustrative) and remove the role and city. It also uses the Gmail trademark in copy; referential use is OK, but no Google logos.

---

## F. Screens production needs that have no reference in either archive (design in primary language)

1. **Edit Profile:** name, email (read-only), timezone (§39), sign-in providers linked (Apple / Google / Microsoft / Email, §88).
2. **Connected Account detail** (from 7.2 “Yönet”): scopes in plain Turkish, capability toggles (the DataSourceControl IA), last sync, “Yeniden bağlan”, “Bağlantıyı kaldır” (confirm, then revoke).
3. **Add Account chooser:** Gmail, Outlook, Google Calendar, Microsoft Calendar, Apple Calendar (EventKit). A Free user adding a second account hits the paywall.
4. **Notification Settings:** secondary IA plus quiet hours, detail level, lock-screen privacy and OS permission state (§35, §86).
5. **Quiet Hours** sub-sheet, with the VIP bypass.
6. **Subscription status / Manage:**
   - Plan, renewal or expiry date, source (store / referral / admin grant, §43).
   - “Aboneliği Yönet” → RevenueCat `Purchases.showManageSubscriptions()` (or the Apple / Play subscription pages).
   - “Satın alımı geri yükle”.
   - Referral bonus days.
7. **Account Deletion flow** (§129, Apple 5.1.1(v)):
   - Consequences list: what is deleted and what is not (store subscription must be cancelled separately, with a link).
   - Re-auth or typed confirmation (“SİL”).
   - Queued job with a status (“Hesabın silme kuyruğunda · 24 saat içinde tamamlanır”).
   - Provider token revoke; Sign in with Apple revoke via `https://appleid.apple.com/auth/revoke`.
   - Local wipe, then sign-out. No fake “silindi”.
   - A web equivalent at `/data-deletion` (a Google Play requirement).
8. **Data Export status:** requested / preparing / ready (download via an expiring signed URL, Supabase `createSignedUrl`) / expired / failed (§128).
9. **Exception editor** for rules (7.11 İSTİSNALAR).
10. **Text size picker** (7.8), or remove the row.
11. **Referral code entry** in onboarding / Settings (the deferred-link fallback on iOS).
12. **About / Hakkında / Legal:** version, Terms, Privacy, open-source licenses, data deletion link (§130).
13. **Android Notification Intelligence settings** after onboarding: mode (all / selected), app list, exclusions, real access status (§36).
14. **Sign-out confirmation** sheet.
15. **Widget configuration** (optional): iOS 17 `AppIntentConfiguration` to pick “Sıradaki / 3 öncelik / Brifing”.
16. **Free AI limit reached** card (“50/gün” in PLAN) with a Pro upsell.

---

## G. Reusable components observed

| Component | Anatomy | Variants | Implied props | Exact styling |
|---|---|---|---|---|
| `ScreenHeader` | 36px circular icon button (left) · optional centered kicker · 36px spacer | `close` (modal root) / `arrow_back` (pushed); right text action (“Satın alımı geri yükle”) | `leading: 'close'|'back'`, `title?`, `kicker?`, `trailingAction?` | button `#fff`, shadow `0 1px 2px rgba(27,25,23,.08)`, icon 20; kicker `12/600 .08em #9B978E` |
| `PageTitle` | h1 + optional sub-line | with / without subtitle | `title`, `subtitle?` | 28/34 600 −.02em; sub 14/20 `#6B6860` mt 4 |
| `SectionKicker` | uppercase label | neutral / success (`#1E7A47`) / critical (`#C7432F`); with a trailing count (“3 konu”) | `label`, `tone`, `trailing?` | 12/600 .08em, padding `0 4px 8px` |
| `GroupedList` / `ListCard` | white card containing rows with hairlines | padding `0 16px` or `4px 16px` | `children` | radius 18, shadow `0 1px 2px rgba(27,25,23,.04),0 6px 20px rgba(27,25,23,.05)`, row divider `1px rgba(27,25,23,.06)` |
| `SettingsRow` | icon · title · (meta) · value · trailing | nav (chevron) / toggle / radio / check / destructive / link-text (“Yönet”) / static (never-list) / icon-tile (32px radius 10) | `icon`, `iconTile?{bg,fg}`, `title`, `meta?`, `value?`, `trailing: 'chevron'|'toggle'|'radio'|'check'|'text'|'none'`, `destructive?`, `disabled?`, `onPress` | min-height 50/52/56/60; title 15/500; meta 12 `#9B978E`; value 13 `#9B978E`; chevron 18 `#C9C5BC`; icon 20 `#6B6860` w24 |
| `Toggle` | track + knob | on / off / disabled | `value`, `onValueChange`, a11y `role=switch` | 50×30 r15; on `#5B5CE2` / off `#D9D6D0`; knob 26 `#fff` shadow `0 1px 3px rgba(0,0,0,.2)` |
| `SegmentedControl` | pill track with segments | 3 segments (4 needed for retention) | `options[]`, `value`, `onChange` | track `#E9E7E1` r999 p3; seg h34 13/600; selected `#fff` shadow `0 1px 3px rgba(27,25,23,.12)` |
| `Chip` | rounded pill ± icon ± remove | filter (white/shadow) · selected (ink `#1A1917`/white) · token (`#EDEDFC`/`#4547C9` + `close`) · add (dashed `#C9C5BC`) · suggestion (`#F0EFEB`, 30px) · data (Android widget) | `label`, `icon?`, `selected?`, `onRemove?`, `variant` | h34 (suggestion 30) r999 13/600 (12/600 suggestion) |
| `StatusBadge` | uppercase micro pill | critical / warning / success / neutral / brand (PRO) | `tone`, `label` | 11/700 .05em p3×8 r999; colors per §0 |
| `Button` | label ± icon | primary (indigo + glow) / ink / destructive / tonal (`#EDEDFC`/`#4547C9`) / text / neutral (`#F0EFEB`/`#6B6860`) / disabled (`#F0EFEB`/`#B8B4AA`) | `variant`, `size: 52|48|44|40|38`, `icon?`, `loading?` | radius 16 (52), 14 (48/44), 12 (40/38); 15/600 or 14/600 |
| `StickyFooterCTA` | gradient fade container + button | — | `children` | padding `16px 20px 44px`, `linear-gradient(180deg, rgba(245,244,240,0), #F5F4F0 45%)` |
| `BottomSheet` | scrim + sheet + grabber | confirm-destructive (icon tile, title, body, summary box, 2 buttons) | `icon`, `tone`, `title`, `body`, `summary?`, `primary`, `secondary` | scrim `rgba(27,25,23,.35)`; sheet r28 top, p `10 24 44`, shadow `0 -10px 40px rgba(27,25,23,.12)`; grabber 36×5 `#E0DED7`; icon tile 52 r16 |
| `ConfirmDialog` | centered modal | destructive | same as above | r24 p22 shadow `0 20px 50px rgba(27,25,23,.25)`; icon tile 48 r16; title 20/26; buttons 48 / 44 |
| `UndoToast` | ink pill with icon, message, action | with / without action | `icon`, `message`, `actionLabel`, `onAction`, `duration=5000` | `#1A1917` r999 p `12 18 12 14` 14/500; icon + action `#A9AAF5`; bottom 52; shadow `0 10px 30px rgba(27,25,23,.25)` |
| `InkCallout` | dark card, icon + two-line text + chevron | Approval Center entry / privacy promises / offline banner | `icon`, `title`, `subtitle`, `onPress?` | `#1A1917` r18 (r24 promises, r14 banner); icon `#A9AAF5`; sub `rgba(255,255,255,.65)` |
| `EmptyState` | icon circle + title + sub + CTA | per `EMPTIES` | `icon`, `tone`, `title`, `subtitle`, `cta?` | circle 60 (icon 30); title 19/600; sub 14/20; CTA 38 r12 `#fff` `#4547C9` |
| `InlineErrorCard` | icon tile + title + sub + 2 text actions | oauth / permission / sync / ai | `code`, `tone`, `title`, `subtitle`, `primary`, `secondary?` | card r18 p14×16; tile 36 r11; title 15/600; sub 13/19; actions 13/600 |
| `OfflineBanner` | ink bar | offline / reconnecting / synced (“Güncel · 09:41”) | `lastAnalysisAt`, `onRetry` | see §B |
| `Skeleton` | shimmer block | bar / pill / button placeholder | `width`, `height`, `radius` | gradient `#EFEDE7 → #F7F6F2`, 1.6s linear |
| `AISpinner` | 14px ring | — | — | border 2px `#D9D6F7`, top `#5B5CE2`, .8s |
| `PlanComparisonTable` | header row + rows | Free value text / check / dash; Pro check | `rows[{label, free, pro}]` | grid `1fr 56px 56px`; header 11/700 .06em; rows 44 14px |
| `PlanOptionCard` | radio + title + badge + price line | selected / unselected | `package`, `selected`, `badge?` | p14×16 r16, border 2px `#5B5CE2` or `rgba(27,25,23,.1)`; dot 20 with inset white ring |
| `ProGateCard` | lock kicker + value headline + body + placeholder bars + CTA pair | per gated feature | `feature`, `valueText`, `onTrial`, `onDismiss` | r28 p22; bars 44 r12 `#F5F4F0` |
| `ReferralLinkField` | mono link + tonal copy button | — | `url`, `onCopy` | 52 r16 `#fff`; mono 500 14; button 40 r12 |
| `InviteRow` | avatar (initials / icon) + name + status line + badge | success / warning / neutral | `invitee`, `status` | avatar 36 |
| `ThemePreviewTile` | mini-UI preview + label | light / dark / system split | `mode`, `selected` | 120 high r16, border 2px `#5B5CE2` when selected |
| `RulePreviewCard` | AI kicker + sample rows + summary | loading / 0 matches / results | `count`, `samples[]`, `summary` | `radial-gradient(140% 100% at 0% 0%, #E4E4FA 0%, #FFFFFF 60%)` r18 |
| `SwipeableRow` | card over action strip | right = complete (`#2FA062`) / left = snooze + dismiss (`#F0EFEB` / `#E9E7E1`, 168px) | `onComplete`, `onSnooze`, `onDismiss` | threshold 35%, 260ms spring, light haptic at threshold |
| `TabBar` | 4 tabs | active `#5B5CE2` + FILL 1 / inactive `#9B978E` | `tabs`, `active` | h90, `rgba(255,255,255,.92)` + blur, top hairline, labels 11/500, icons 26 |
| `PriorityCard` (compact) | badge + time · h3 · source line · text actions | ACİL / TAKİP / KİŞİSEL | `insight`, `actions[]` | r20 p14×16; h3 17/23 600 −.01em; meta 12 `#9B978E`; actions 14/600 |
| Widgets | iOS S/M/L, lock (inline / circular / rectangular), Android 4×2 / 2×2 | light, ink 2×2 | `snapshot` | see §B |
| `StoreFrame` (marketing tooling) | kicker / headline / supporting line + device | 6 backgrounds | — | see §E |

---

## H. Open issues and inconsistencies

**Within the PRIMARY files**
1. **Counts disagree:**
   - Rules: 7.1 says “6 kural”; 7.9 lists 7 rules (6 on).
   - VIPs: 7.1 says “6 kişi”; the main prototype says “4 kişi”.
   - AI access: 7.2 says “5 alan”; 7.3 has 5 fields with only 4 on.
   - 7.4 deletes “42 kural”, which matches none of these; clarify whether that means learned preferences.
2. **Two different Profile layouts:** 7.1 is grouped and opened with close; `Dijital Asistan.dc.html` is a flat 12-row list opened with back. Adopt 7.1.
3. **Paywall legal copy differs:** 7.5 “7 gün sonra 1.490 TL/yıl. Bitmeden 24 saat önce hatırlatırız. İstediğin zaman iptal.” vs the prototype “Deneme bitmeden 24 saat önce hatırlatırız…”. The prototype toast “12 Eylül'de hatırlatırım” contradicts “24 saat önce” (a trial from 5 Sep ends on 12 Sep, so the reminder falls on 11 Sep).
4. **Save CTA colors:** create-rule uses indigo (7.10), edit-rule uses ink (7.11). Pick one rule.
5. **Undo on an “irreversible” action:** 7.12 calls rule deletion an “irreversible pattern” yet offers “Geri al”. The caption says 7.4 is “consistent”, but 7.4 has no undo.
6. **Static label:** 7.11 “Kural aktif” does not change when the toggle turns off.
7. **Motion timings differ** between the MOTION table and the “BRİFİNG AÇILIŞI” frames (count 360ms vs frame timings of 240 and 520ms).
8. **Tokens outside the system:**
   - `#A9F0C1` (privacy icons) is not a token; use dark success-text `#6FCF97`, or add the token.
   - 08 uses `#F08B78`, which is dark critical-text, on an ink banner in light mode. Acceptable, but document it as “on-ink” tokens.
9. **Lock-screen widget spec is not realizable as drawn:** custom colored pills are not supported, and `accessoryInline` sits above the clock.
10. **Appearance order and default:** Açık / Koyu / Sistem with Açık as default, whereas §38 lists System first. Use Sistem as the default.
11. **Deutsch is listed** as a language; §39 scope is TR plus EN only.
12. **Retention lacks “until user deletes”** (§41).
13. **The privacy footer and 7.3 claims conflict with the master prompt or the architecture:**
    - “Uçtan uca TLS” (§40 forbids E2E-sounding claims).
    - “Hassas alan tespiti cihazda yapılır” (analysis is server-side).
    - “biz kopya tutmayız” / “Kopya tutulmaz” vs the §77 tables `email_messages` and `memory_chunks` (pgvector). Either store only derived data and fetch bodies on demand, or rewrite the copy.
    - “KVKK ve GDPR uyumlu” and “Frankfurt” need legal and config backing.
14. **Messaging content** is “never read” in 7.3, yet 2.13 offers a WhatsApp/Telegram toggle (default off). Decide: hard-exclude, or allow with explicit opt-in and update the 7.3 copy.
15. **The paywall PLAN table is missing** §44 Pro items: Universal Capture, Android Notification Intelligence, “multiple calendars” wording. The PRO checkmark on “AI analiz limiti” is ambiguous (implies “Sınırsız”, which conflicts with §82 cost control; use “Yüksek” or a real number plus fair use). The table has 10 rows while `hint-placeholder-count=8` (irrelevant to production).
16. **The paywall is missing Terms of Use / Privacy links** (Apple 3.1.2), and the trial CTA must be conditional on store eligibility (§43).
17. **The referral “elif.a@…” row** implies an email-invite channel that is not designed. “Sınır: yılda 6 davet” should be a reward cap.
18. **The Pro gate's value count** (“2 gelişme oldu”) needs a cheap server count for Free users. Don't run the paid LLM pipeline (§82).
19. **ad/03 fabricated named testimonial** (“Yunus E. · Kurucu, İstanbul”) must be replaced or labeled. store/05's traffic ETA and store/06's “Görüşme notları” must correspond to real capabilities (§74, §141).
20. **Contrast failures** (§92). Tertiary text `#9B978E` is used for 12–13px meta and kickers:
    - 2.65:1 on `#F5F4F0` and 2.91:1 on `#FFFFFF`, failing WCAG AA 4.5:1.
    - `#726E66` would give 4.61:1 on `#F5F4F0` and 5.07:1 on white. Apply it to text only (minimal visual change, §124); keep `#9B978E` for decorative and disabled uses.
    - Coral `#C7432F` on `#F5F4F0` is 4.47:1 (just under 4.5) for “Çıkış Yap” and “Kuralı Sil” at 15px. On white it passes at 4.92:1.
    - `#6B6860` passes (5.06:1 on `#F5F4F0`). White on `#5B5CE2` passes (5.15:1).
21. **Small hit targets** (§92): suggestion chips (30px), the “Yönet” text link, the “Geri al” toast action and the “Satın alımı geri yükle” text are under 44pt; they need `hitSlop`.
22. **No dark-mode artboards** for 07, 08 or 09. Ink surfaces (the Approval Center card, promise card, offline banner, toast, 2×2 widget) will vanish against `#141311`; they need `#1F1E1B` plus a 1px `rgba(255,255,255,.08)` border in dark mode (§38: no hardcoded surfaces).

**Versus SECONDARY (conflicts where primary or the master prompt wins)**

23. **Referral condition:** secondary rewards on signup, primary on the first briefing. Primary wins.
24. **Retention options:** secondary's 3/6/12/unlimited-Pro is rejected in favor of 30/90/365/until-delete.
25. **Store headline numbers:** secondary “84 mail · 3 önemli” vs primary and §74 “83 · 4”. Primary wins.
26. **Briefing length:** secondary “60 saniyelik brifing” vs primary “Dinle · 2 dk”. Primary wins; make the duration dynamic from the TTS length.
27. **Morning default time:** secondary 07:30 vs primary 08:00. Primary wins.
28. **Secondary palette and type** (Inter, `#0F0F1A`, iOS system colors, emoji icons, gradient buttons) are rejected wholesale.
29. **Secondary's false or unsupported claims** to reject:
    - “Kredi kartı gerekmez”
    - “Gerisini siler”
    - “Şu an ücretsiz erişim açık”
    - “Yalnızca Android 12+ cihazlarda geçerlidir”
    - “aboneliğin kalıcı olarak silinir”
    - Zoom / Teams integrations
    - “Yakında” languages
    - the “Sessiz Günler” copy inversion
30. **Secondary prototype-only mechanics** not to copy:
    - `setTimeout` fake success (feedback, retry, export, clear history)
    - Integrations `toggle()` that fakes a connection
    - paywall CTAs that `navigate('today')`
    - export buttons (PNG/MP4, PNG sizes) with no handler
    - the Help placeholder sheet
    - the Android master toggle standing in for the OS permission
    - hooks inside `.map()`
    - the design-system, marketing and debug entries in the Profile list (“Android Frame (412px)”, “Tasarım Sistemi” group)

**Versus MASTER_PROMPT requirements with no design anywhere**

31. Missing screen designs:
    - §35 Quiet Hours, Lock Screen Privacy and detail levels (§86)
    - §43 Manage Subscription
    - §128 export status
    - §129 account deletion flow
    - §130 About and Edit Profile
    - §36 Android NI settings after onboarding
    - §32 “Learn from interactions” toggle and per-item disable (primary)
    - §40 OS Permissions list (primary)
    - §73 the entire public website plus legal pages
    - §74 pricing visuals and feature visuals beyond the store frames
    - Play feature graphic
    - English store assets

**Library versions checked on npm today** (verify against Expo SDK compatibility at implementation):

| Package | Version |
|---|---|
| expo | 57.0.24 |
| react-native-reanimated | 4.7.0 |
| react-native-gesture-handler | 3.3.0 |
| expo-haptics | 57.0.3 |
| expo-notifications | 57.0.20 |
| expo-localization | 57.0.2 |
| expo-clipboard | 57.0.2 |
| expo-sharing | 57.0.21 |
| expo-file-system | 57.0.7 |
| expo-web-browser | 57.0.3 |
| expo-linking | 57.0.10 |
| expo-application | 57.0.3 |
| expo-mail-composer | 57.0.2 |
| expo-blur | 57.0.3 |
| expo-linear-gradient | 57.0.2 |
| expo-location | 57.0.19 |
| expo-contacts | 57.0.6 |
| expo-network | 57.0.2 |
| expo-store-review | 57.0.3 |
| expo-widgets | 57.0.20 (docs unverified, blocked) |
| @bacons/apple-targets | 5.0.0 |
| react-native-android-widget | 0.22.1 |
| react-native-shared-group-preferences | 1.1.24 |
| react-native-purchases / react-native-purchases-ui | 10.10.1 |
| react-native-view-shot | 6.0.1 |
| @react-native-community/netinfo | 12.0.1 |
| i18next | 26.4.2 |
| react-i18next | 17.0.15 |
| @expo-google-fonts/geist | 0.4.2 |
| @expo-google-fonts/lora | 0.4.2 |
| @expo-google-fonts/geist-mono | 0.4.3 |
| @material-symbols/svg-400 | 0.47.5 |

`docs.expo.dev` and external doc fetches were blocked by the egress proxy, so store and platform limits above are from knowledge and should be re-verified.

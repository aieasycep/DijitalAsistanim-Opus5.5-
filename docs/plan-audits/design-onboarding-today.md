# Audit: PRIMARY "02 Onboarding.dc.html" + "03 Bugun ve Brifingler.dc.html" (and SECONDARY onboarding/today diff)

## 0. File-level facts (both files)

- **Canvas chrome. Do not implement it.** The page background is `#ECEAE4`. Artboard labels use `font:600 10.5px ui-monospace` on `rgba(0,0,0,.08)` radius 5. Each file has a nav row linking the other design files.
- **iOS artboards.** 390×844 with a device radius of 44. Status bar is 54px high, text 15/600, and uses the Material icons `signal_cellular_alt`, `wifi` and `battery_full`. The home indicator is 134×5, radius 3, `rgba(27,25,23,.25)` (`rgba(255,255,255,.4)` on dark or gradient). All of this is device chrome, so production uses `react-native-safe-area-context` insets instead of drawing it.
- **Android artboard (2.13 only).** Radius 32, status bar 46px (14/600, icon order wifi, signal, battery), gesture bar 108×4 radius 2 `rgba(27,25,23,.3)`.
- **Fonts.** Google Fonts `Geist:wght@300..700` (UI), `Lora` roman and italic 400–600 (editorial only), `Material Symbols Rounded` (opsz, wght, FILL, GRAD). The design toggles FILL with `font-variation-settings:'FILL' 1`.
- **Keyframes.** `daspin` (rotate 360) and `dabar` (scaleY .25→1).
- **02 intro text (verbatim).** "Akış: 4 tanıtım → hesap → bağlantılar (her OAuth öncesi izin açıklayıcı) → kişiselleştirme → brifing saatleri → ilk analiz (dramatik an) → bildirim izni → (Android) telefon bildirimleri → Bugün. Tanıtım görselleri çizim değil, ürünün kendi UI parçalarıdır."
  - This list has **no VIP step and no separate permissions step.**
- **03 intro text (verbatim).** "Günün ritmi dört dokunuştur: sabah brifingi (08:00), öğle nabzı (13:00), akşam kapanışı (19:00), haftalık özet (Pazar 18:00). Hepsi aynı hero cümle kalıbını kullanır: "Bugün bilmen gereken N şey var." Sayı yalnızca hero'da renklidir; kartlarda renk yalnızca aciliyet için."
- **Data scripts.**
  - 02: `INTEGRATIONS` (5), `INTERESTS` (8), `APPS` (5). `renderVals` builds `ring`, `spinner`, and maps on/off to colors.
  - 03: `BRIEF` (6 sections). `renderVals` builds `wave` (34 bars) and `brief` / `briefDark`, which differ only by divider color.
- **Token names referenced below come from PRIMARY "01 Tasarim Sistemi"** (`COLORS`, `TYPE`, `RADIUS`, `DARK`):
  - Brand: `brand/primary #5B5CE2`, `brand/primary-pressed #4B4CCB`, `brand/soft #EDEDFC`, `brand/text-on-soft #4547C9`, `brand/dark-glow #A9AAF5`.
  - Critical: `critical #E0553F`, `critical/soft #FCEDE9`, `critical/text #C7432F`.
  - Warning: `warning #E09A1C`, `warning/soft #FDF2DC`, `warning/text #9A6300`.
  - Success: `success #2FA062`, `success/soft #E4F5EA`, `success/text #1E7A47`.
  - Info: `info #3B82E6`, `info/soft #E7F0FD`, `info/text #2262BE`.
  - Neutral and ink: `neutral/bg #F5F4F0`, `surface #FFFFFF`, `surface-2 #F0EFEB`, `hairline #E9E7E1` (rgba 27,25,23,.06), `ink #1A1917`, `ink/secondary #6B6860`, `ink/tertiary #9B978E`, `ink/disabled #B8B4AA`, `editorial/paper #FBFAF7`.
  - Gradients: `gradient/dawn linear-gradient(160deg,#1E1E4C 0%,#3B3CA8 58%,#7071EA 100%)`, `gradient/night linear-gradient(180deg,#15153A 0%,#25266A 60%,#3B3CA8 100%)`, `gradient/dusk linear-gradient(160deg,#2A1E3F 0%,#4A3A8A 55%,#8C6BD6 100%)`.
  - Dark: `bg #141311`, `surface #1F1E1B`, `surface-2 rgba(255,255,255,.08)`, `text #F2F0EB`, `secondary #A39F96`, `tertiary #7A776F`, `primary #8586F2`, `primary-glow #A9AAF5`, `critical-text #F08B78`, `warning-text #F0B85A`, `success-text #6FCF97`, `on-primary #0F0F2A`.
  - Type scale:

    | Token | Spec |
    |---|---|
    | display | 34/40 600 −.025em |
    | h1 | 28/34 600 −.02em |
    | h2 | 22/28 600 |
    | h3 | 17/23 600 −.01em |
    | body | 15/22 400 |
    | secondary | 14/20 #6B6860 |
    | kicker | 12/16 600 +.08em caps #9B978E |
    | badge | 11/14 700 +.05em |
    | editorial | Lora 18/29 |
    | editorial-display | Lora 34–38 500 |

  - Radius scale: 10 icon tile · 12 inline button · 14 button · 16 small card · 20 card · 28 hero/sheet.
  - Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40.
- **Cross-file states and behaviour relevant here (not in 02/03):**
  - PRIMARY `08 Durumlar…` defines:
    - `loading/today` ("iskelet, gerçek kart ölçülerinde").
    - `error/offline` ("tam ekran · son analiz görünür kalır").
    - `empty/today` ("Her şey kontrol altında." / "Bugün dikkat gerektiren yeni bir konu yok. 46 maili senin için okudum." / CTA "Akışa göz at").
    - `error/oauth-expired`, `error/permission-denied`, `error/sync-delayed`, `error/ai-unavailable`.
    - A MOTION spec: brifing açılışı, tamamlandı, kaydırma, sesli oynatma, senkron, haptik.
  - PRIMARY `07` 7.6 defines the Midday Pro gate on the Today hero.
  - PRIMARY `Dijital Asistan.dc.html` (the IA prototype) wires the Today card behaviours. They are quoted per screen below as intended mappings; its toasts and `setTimeout`s are prototype-only.

---

## 1. Onboarding coverage vs MASTER_PROMPT §34 (15 steps)

| # | §34 step | PRIMARY design | Status |
|---|---|---|---|
| 1 | Welcome | 2.1 Tanıtım 1 · Marka | EXISTS |
| 2 | Noise reduction | 2.2 Tanıtım 2 · Gürültüyü azalt | EXISTS |
| 3 | Proactive assistant | 2.3 Tanıtım 3 · Brifing ("Gününü sen sormadan hazırlarız.") | EXISTS (mapped) |
| 4 | Control / trust | 2.4 Tanıtım 4 · Kontrol sende | EXISTS |
| 5 | Account | 2.5 Hesap Oluştur | EXISTS, provider picker only. Missing: e-mail entry, OTP/magic-link sent/verify, sign-in for existing users ("Giriş yap"), auth errors. |
| 6 | Connect Gmail / Outlook | 2.6 list + 2.7 Gmail explainer + 2.7b Outlook explainer | EXISTS. Missing: connecting, cancelled, failed, admin-consent-required, second-account (Free limit) states. |
| 7 | Connect Calendar | 2.6 list + 2.7c Calendar explainer (Google / Apple / Microsoft chips) | EXISTS. Missing: calendar picker ("2 takvim · Kişisel, İş"), Android device calendar, permission denied. |
| 8 | Permissions | No dedicated screen. Covered by the OAuth explainers (2.7/2.7b/2.7c), Apple EventKit via the 2.7c footnote, notifications (2.12), Android listener (2.13). | PARTIAL. No iOS calendar permission-denied screen here (08 has `error/permission-denied`; SECONDARY has a denied sub-state). |
| 9 | Personalization | 2.8 Kişiselleştirme · Çoklu seçim (ADIM 2/4) | EXISTS |
| 10 | Briefing schedule | 2.9 Brifing Ayarları (ADIM 3/4) | EXISTS. Missing: time-picker sheet, Pro-locked row rendering. |
| 11 | VIP | — | **MISSING in PRIMARY.** SECONDARY has `VIPScreen`. PRIMARY `06` has VIP list components ("Önemli Kişiler · VIP", "… ile son 30 günde 14 kez yazıştın. VIP yapayım mı?") to restyle from. "ADIM 4 / 4" is never drawn and is likely the intended VIP slot. |
| 12 | First Analysis | 2.10 İlk Analiz · İşleniyor | EXISTS. Missing: failure, timeout, partial, zero-data states. |
| 13 | Aha Moment | 2.11 İlk Analiz · Hazır | EXISTS. Missing: zero-findings variant. |
| 14 | Notification Permission | 2.12 Bildirim İzni Açıklayıcı (+ 2.13 Android listener, optional) | EXISTS. Missing: denied / blocked-in-settings state, Android <13 variant. |
| 15 | Today | 3.1 (file 03) | EXISTS as steady-state Today. No first-run Today (first-day hero, "ilk brifing" origin, coach mark). |

Other missing pieces:
- **Splash / launch.** SECONDARY `SplashScreen` shows "Dijital Asistan" / "Bugün bilmen gerekenleri, sen sormadan söyler." PRIMARY has none; use the native splash from `expo-splash-screen`.
- **Onboarding resume.** Relaunching mid-onboarding must resume at the persisted step.
- **Onboarding offline.**
- **Demo-mode indicator (§89).**
- **Legal pages opening in an in-app browser.**

---

## 2. Onboarding screens (PRIMARY/02)

### Tanıtım 1 · Marka / Welcome (Brand)
- **Source:** PRIMARY / 02 Onboarding.dc.html / "2.1 Tanıtım 1 · Marka"
- **Purpose:** First launch brand moment and value proposition. Entry to the new-user flow or to sign-in.
- **Layout (top→bottom):**
  - Full-bleed `gradient/dawn` background; text #fff; padding 0 28 44.
  - Centered stack, gap 28:
    - App mark 96×96, radius 30, #fff, shadow `0 20px 50px rgba(0,0,0,.25)`, icon `auto_awesome` 52px #5B5CE2 FILL 1.
    - Wordmark kicker 15/600, letter-spacing .1em, opacity .75.
    - Headline 34/40 600 −.025em, `text-wrap:pretty`.
    - Body 16/24 `rgba(255,255,255,.75)`, max-width 300.
  - Page dots (margin-bottom 22): active 20×6 radius 3 #fff; 3 inactive 6×6 `rgba(255,255,255,.4)`; gap 6.
  - Primary inverse CTA: 52h, radius 16, bg #fff, text #25266A, 15/600.
  - Sign-in line (margin-top 14): 13px `rgba(255,255,255,.7)` with bold #fff link.
- **Exact copy:**
  - "DİJİTAL ASİSTAN"
  - "Bugün bilmen gerekenleri, sen sormadan söyler."
  - "Mailini, takvimini ve yapman gerekenleri tek yerde anlar."
  - CTA "Başlayalım"
  - "Zaten hesabın var mı? **Giriş yap**"
  - Designer note: "Şafak gradyanı = brifingin rengi; onboarding boyunca tek marka anı. Sonraki ekranlar açık zemine döner."
- **Data fields:** none (static, localized).
- **Interactions → production:**
  - "Başlayalım" → next intro page (2.2) in a horizontal pager. Swipe must also page.
  - "Giriş yap" → sign-in sheet reusing the 2.5 provider buttons with "Giriş yap" copy. After Supabase Auth succeeds: if `onboarding_completed_at` is set → Today; else resume the persisted onboarding step.
  - Page dots are indicators only; they may be tappable to jump.
- **States depicted:** default only.
- **States missing:** reduced-motion variant; app-update-required gate; offline (intro works offline, but auth needs network).
- **Prototype-only / fake:** none. The mark is `auto_awesome` from the icon font; production needs the real app icon asset.
- **Maps to MASTER_PROMPT:** §34 (1), §88, §73 (tagline reused), §39.

### Tanıtım 2 · Gürültüyü azalt / Noise reduction
- **Source:** PRIMARY / 02 / "2.2 Tanıtım 2 · Gürültüyü azalt"
- **Purpose:** Explain triage: many mails become three important topics.
- **Layout:**
  - bg `neutral/bg #F5F4F0`; padding 0 28 44.
  - Top-right text button "Atla" 14/600 #6B6860 (margin-top 10).
  - Illustration block, height 300 (absolute layers):
    - (a) Ghost stack of 4 rows, opacity .55, inset 24: each 34h, radius 10, #fff, shadow `0 1px 2px rgba(27,25,23,.06)`, with 16px dot and 8px bar #E9E7E1.
    - (b) Big number "127": 64/64 600 −.04em ink, label "mail" 14 #6B6860.
    - (c) Arrow disc 28 #5B5CE2 with `arrow_downward` 18 #fff.
    - (d) Three priority rows: 40h, radius 12, #fff, shadow `0 1px 2px rgba(27,25,23,.04),0 6px 20px rgba(27,25,23,.06)`. Each has a mini badge (10/700, padding 2 6, radius 999) and a title 13/600.
  - Text block, centered: accent 15/600 #5B5CE2; title 32/38 600 −.025em; body 16/24 #6B6860.
  - Dots: active 20×6 #1A1917; inactive 6×6 #C9C5BC.
  - Ink CTA: 52h radius 16 #1A1917, text #fff.
- **Exact copy:**
  - Badges and rows: "ACİL" (#FCEDE9/#C7432F) "Ahmet revize teklif bekliyor"; "SON TARİH" (#FDF2DC/#9A6300) "Başvuru bugün 17:00"; "TAKİP" (#F0EFEB/#6B6860) "Teklife 3 gündür cevap yok".
  - "127 mail → 3 önemli konu" · "Gürültüyü azalt." · "Gelen her şeyi okur, yalnızca önemli olanı gösterir."
  - CTA "Devam" · "Atla"
  - Note: "Gerçek kart bileşenleriyle anlatım: soluk iskelet yığın → sayı → üç gerçek öncelik kartı. Animasyon: yığın aşağı akıp 3 karta "çöker"."
- **Data fields:** illustrative only. They imply the priority badge taxonomy (urgent / deadline / follow_up).
- **Interactions:**
  - "Devam" → 2.3.
  - "Atla" → skip remaining intros to 2.5 Account.
  - Swipe left/right pages.
  - Collapse animation (Reanimated) respects Reduce Motion.
- **States depicted:** static end frame of the animation.
- **States missing:** Reduce Motion static frame (this one); Dynamic Type overflow (32px title plus 300px illustration on a 667pt-tall device such as iPhone SE).
- **Prototype-only / fake:** the illustration cards must be non-interactive. Render as an image-like view with an accessibility label, not buttons (§99). Names are sample data; mark them as illustrative in localization files.
- **Maps to:** §34 (2), §14, §123.

### Tanıtım 3 · Brifing / Proactive assistant
- **Source:** PRIMARY / 02 / "2.3 Tanıtım 3 · Brifing"
- **Purpose:** Show that a daily briefing is prepared automatically and can be listened to.
- **Layout:**
  - bg #F5F4F0; "Atla" top-right.
  - Tilted card (rotate −2deg), radius 28, shadow `0 20px 50px rgba(27,25,23,.14)`:
    - Top: `gradient/dawn`, padding 22 20 34. Kicker 11/600 .08em opacity .72; title 24/30 600; sub 14 `rgba(255,255,255,.8)`.
    - Body overlaps (margin-top −18), #F5F4F0, radius 22 22 0 0, padding 18 20 20: Lora 15/24 narrative, then ink button 40h radius 12 #1A1917 with `headphones` 18.
  - Text block: accent 15/600 #5B5CE2; title 32/38 600; body 16/24 #6B6860.
  - Dots (3rd active); ink CTA.
- **Exact copy:**
  - "SABAH BRİFİNGİ · 08:00" · "Günaydın Yunus" · "Bugün oldukça sakin bir günün var."
  - "Öğlene kadar toplantın bulunmuyor. Saat 14:30'da Mehmet ile müşteri toplantın var…"
  - "Brifingi Dinle · 2 dk"
  - "Her sabah 08:00" · "Gününü sen sormadan hazırlarız." · "Okumak istemezsen 2 dakikada dinle."
  - "Devam" · "Atla"
  - Note: "Brifing kartı hafif eğik durur; ürünün gerçek bileşeni, çizim değil."
- **Data fields:** illustrative. The card implies the briefing entity (type, scheduled time, greeting, hero line, narrative, audio duration).
- **Interactions:**
  - "Devam" → 2.4.
  - "Atla" → 2.5.
  - The inner "Brifingi Dinle" is **decorative**: no tap, or it must play a real bundled sample audio. Never a dead button.
- **States depicted:** default.
- **States missing:** Reduce Motion (no tilt animation).
- **Prototype-only / fake:** the personal name "Yunus" appears before an account exists. Use a localized sample name or drop the name ("Günaydın"). "Her sabah 08:00" is a default, not the user's setting.
- **Maps to:** §34 (3), §9, §111.

### Tanıtım 4 · Kontrol sende / Control & trust
- **Source:** PRIMARY / 02 / "2.4 Tanıtım 4 · Kontrol sende"
- **Purpose:** Trust message: nothing is sent or changed without approval (Approval Center preview).
- **Layout:**
  - bg #F5F4F0; "Atla".
  - Tilted (1.5deg) approval card: #fff, radius 20, padding 16, shadow `0 20px 50px rgba(27,25,23,.14)`.
    - Header: icon tile 28 radius 9 #EDEDFC/#4547C9 `send` 17; kicker 12/600 .06em #6B6860; status pill 11/700 padding 3 8 #FDF2DC/#9A6300.
    - Title 16/22 600.
    - Grid (56px label column): labels #9B978E 12/18.
    - Buttons 38h radius 12, 13/600: primary flex #5B5CE2; tonal #EDEDFC/#4547C9; neutral #F0EFEB/#6B6860.
  - Text block: accent "Onay Merkezi"; title 32/38; body.
  - Dots (4th active); **primary** CTA #5B5CE2 (brand color on last intro).
- **Exact copy:**
  - "MAİL GÖNDER" · "BEKLİYOR" · "Mehmet Yılmaz'a takip mesajı gönder"
  - "Neden" "Teklife 3 gündür yanıt gelmedi." · "Değişim" "1 mail · Kısa, profesyonel ton"
  - "Onayla" · "Düzenle" · "Reddet"
  - "Onay Merkezi" · "Kontrol her zaman sende." · "Sen onaylamadan mail göndermez, takvimine dokunmaz."
  - CTA "Hesap Oluştur" · "Atla"
  - Note: "Son tanıtım güven mesajıyla biter; CTA marka rengine döner ve hesap oluşturmaya geçer."
- **Data fields (illustrative):** approval_item {action_type=email_send label "MAİL GÖNDER", status=pending "BEKLİYOR", what, why, change (exact change summary)}. This matches §33 (what / why / exact change).
- **Interactions:**
  - "Hesap Oluştur" → 2.5.
  - "Atla" → 2.5 (same destination; consider hiding "Atla" on the last page).
  - The inner Onayla / Düzenle / Reddet are **illustration only**: not focusable as buttons.
- **States depicted:** default.
- **States missing:** none specific.
- **Prototype-only / fake:** the approval buttons inside the illustration must not look actionable to screen readers.
- **Maps to:** §34 (4), §33, §3 (6–8), §115.

### Hesap Oluştur / Create Account
- **Source:** PRIMARY / 02 / "2.5 Hesap Oluştur"
- **Purpose:** App account authentication, kept separate from integrations (§88).
- **Layout:**
  - bg #F5F4F0; padding 0 28 44.
  - Back button: 36 circle #fff, shadow `0 1px 2px rgba(27,25,23,.08)`, `arrow_back` 20.
  - Center block: app tile 56 radius 18 #5B5CE2 with `auto_awesome` 30 #fff FILL1; title 30/36 600 −.025em (margin-top 22); sub 15/22 #6B6860.
  - Button stack (gap 10, 15/600), each 52h radius 16:
    1. Google: bg #1A1917, text #fff, 22px white circle with a "G" placeholder.
    2. Apple: #fff, shadow `0 1px 2px rgba(27,25,23,.08)`, `ios` icon placeholder.
    3. Microsoft: #fff, 2×2 16px logo (#F25022 #7FBA00 #00A4EF #FFB900).
    4. Divider "veya" 12 #9B978E between 1px `rgba(27,25,23,.1)` lines.
    5. E-mail: #fff, text #4547C9, `mail` 20.
  - Footer legal 12/18 #9B978E with bold #6B6860 links.
- **Exact copy:**
  - "Hesabını oluştur" · "Giriş yöntemin, bağlayacağın hesaplardan bağımsızdır."
  - "Google ile devam et" · "Apple ile devam et" · "Microsoft ile devam et" · "veya" · "E-posta ile devam et"
  - "Devam ederek **Kullanım Koşulları** ve **Gizlilik Politikası**'nı kabul edersin. Verilerin reklam amacıyla kullanılmaz."
  - Note: "Platform sırası cihaza göre: iOS'ta Apple ilk, Android'de Google ilk. Sağlayıcı logoları için gerçek marka varlıkları kullanılacak (burada yer tutucu)."
- **Data fields:** auth provider → `auth.users` (Supabase), `profiles` (display_name, locale tr-TR, timezone Europe/Istanbul stored separately per §39), terms_accepted_at / terms_version.
- **Interactions → production:**
  - Apple → native Sign in with Apple (`expo-apple-authentication` 57.0.2, `AppleAuthenticationButton`, HIG-compliant black/white style) → `supabase.auth.signInWithIdToken({provider:'apple'})`. On Android, Apple needs the web OAuth flow; decide whether to show it.
  - Google → native Google Sign-In or `expo-auth-session` (57.0.12) → `signInWithIdToken({provider:'google'})`, using the official Google "G" asset and branding.
  - Microsoft → Supabase `azure` provider via `expo-web-browser` (57.0.3) auth session with PKCE.
  - E-posta → **undrawn**: e-mail input screen → Supabase OTP / magic link → "Kodu gir" / "Mailini kontrol et" → verify.
  - Links → open the public-web Terms / Privacy pages in `WebBrowser.openBrowserAsync`.
  - Back → 2.4.
  - Auth success → 2.6.
- **States depicted:** default only.
- **States missing:** per-button loading spinner (disable the others); user cancelled (silent return); provider error ("Giriş tamamlanamadı. Tekrar dene."); network offline; e-mail invalid / OTP expired / rate-limited; account already exists with another provider (link or merge messaging); iOS vs Android order (the drawn order is Google-first = Android; the iOS artboard with Apple first is not drawn).
- **Prototype-only / fake:** the "G" letter, `ios` Material icon and CSS Microsoft squares are placeholders (the designer says so). App Store Guideline 4.8 requires Sign in with Apple when third-party login is offered; it is present.
- **Maps to:** §34 (5), §88, §76, §39, §112.

### Dijital hayatını bağla / Connect your digital life
- **Source:** PRIMARY / 02 / "2.6 Dijital hayatını bağla" (`INTEGRATIONS` data)
- **Purpose:** Integration hub during onboarding. The minimum is one mail and one calendar.
- **Layout:**
  - bg #F5F4F0; padding 0 20 44.
  - Step header: back circle 36; center kicker "ADIM 1 / 4" 12/600 .08em #9B978E; 36px spacer.
  - Title 30/36 600; sub 15/22 #6B6860.
  - List (gap 10) of IntegrationRow:
    - padding 12 14, radius 18, #fff, shadow `0 1px 2px rgba(27,25,23,.04),0 6px 20px rgba(27,25,23,.05)`.
    - Provider tile 44 radius 14 (`tbg`/`tfg`), icon 22.
    - Name 15/600 −.01em; meta 12 #9B978E.
    - Status pill 34h, padding 0 12, radius 999, 13/600, icon 16. Connected = `#E4F5EA`/`#1E7A47` `check` "Bağlandı". Not connected = `#EDEDFC`/`#4547C9` `add` "Bağla".
  - Bottom (margin-top auto): trust line `verified_user` 18 #1E7A47 + 13 #6B6860; primary CTA 52h radius 16 #5B5CE2.
- **Exact copy:**
  - "Dijital hayatını bağla." · "En az bir mail ve bir takvim yeterli. İstediğin zaman kaldırabilirsin."
  - Rows:
    - Gmail — "yunus@…com · 3 gün analiz edildi" — Bağlandı
    - Outlook — "İş maili · Microsoft 365" — Bağla
    - Google Takvim — "2 takvim · Kişisel, İş" — Bağlandı
    - Microsoft Takvim — "Outlook takvimi" — Bağla
    - Apple Takvim — "iCloud · cihazdan okunur" — Bağla
  - Tile colors: Gmail #FCEDE9/#C7432F; Outlook and Microsoft #E7F0FD/#2262BE; Google Takvim #E4F5EA/#1E7A47; Apple #F0EFEB/#6B6860.
  - "Sen onaylamadan mail göndermeyiz." · CTA "Devam · 2 hesap bağlı"
  - Note: "Durumlar: Bağla (indigo tonal) / Bağlandı (yeşil, ✓). Devam butonu bağlı hesap sayısını söyler. Kart ikonları gerçek sağlayıcı logolarıyla değiştirilecek."
- **Data fields → entities:** `integration_accounts` {provider: google|microsoft|apple_device|android_device, capabilities: mail|calendar, account_email ("yunus@…com", masked), status: connected|not_connected|expired|error, granted_scopes[], selected_calendars[] (count 2: "Kişisel", "İş"), last_sync_at / analysis_window_days (3), tenant_type personal|work}.
- **Interactions → production:**
  - "Bağla" (Gmail) → open the 2.7 sheet. Outlook → 2.7b. Any calendar row → 2.7c with that provider chip preselected.
  - "Bağlandı" pill → account sheet: e-mail, scopes, choose calendars, "Bağlantıyı kaldır" (revoke per §76, with confirmation).
  - Google Takvim meta "2 takvim" → calendar selection sheet (**undrawn**).
  - "Devam · N hesap bağlı" → next step (2.8). Disabled (or copy "Mail ve takvim seç") until the minimum rule is met; the rule itself needs a decision (§7 of Open issues).
  - Back → 2.5, which would sign out; confirm or disallow.
  - Free plan: a second mail account or second calendar → contextual Pro gate (07/7.6 pattern), not a silent failure (§44: Free = 1 mail + 1 calendar).
- **States depicted:** mixed connected / not connected.
- **States missing:** connecting (spinner in the pill); OAuth cancelled; OAuth error; partial scopes granted (Google granular consent lets users untick Gmail); work tenant requires admin consent; `error/oauth-expired` ("Gmail bağlantısı yenilenmeli.", 08); Android row set (Apple Takvim is iOS-only, and Android needs "Cihaz takvimi" via `expo-calendar`, §75); demo-mode badge; offline.
- **Prototype-only / fake:** meta "3 gün analiz edildi" shows before First Analysis (2.10) has run. Production meta should be the account e-mail plus "Bağlandı" or "İlk analiz bekliyor".
- **Maps to:** §34 (6, 7), §75, §76, §44, §89, §90.

### İzin Açıklayıcı · Gmail (OAuth öncesi) / Gmail permission explainer sheet
- **Source:** PRIMARY / 02 / "2.7 İzin Açıklayıcı · Gmail (OAuth öncesi)"
- **Purpose:** Pre-OAuth disclosure: 3 reasons and 3 assurances, then hand-off to Google consent.
- **Layout:**
  - Scrim `rgba(27,25,23,.35)` over the previous screen.
  - Bottom sheet: #fff, radius 28 28 0 0, padding 10 24 44, shadow `0 -10px 40px rgba(27,25,23,.12)`.
  - Grabber 36×5 radius 3 #E0DED7 (margin 0 auto 18).
  - Header row: tile 44 radius 14 #FCEDE9/#C7432F `mail` 22; kicker 12/600 .08em #9B978E; title 20 600 −.02em.
  - ReasonRow ×3 (gap 10): padding 12 14, radius 14, bg #F5F4F0, icon 20 #5B5CE2, text 15.
  - AssuranceBox: bg #E4F5EA, radius 18, padding 16, gap 10, text **#1E5A36** 14/20, icons 20 #1E7A47.
  - Primary CTA 52h radius 16; text button 44h radius 14 #6B6860 14/600; footnote 12 #9B978E centered.
- **Exact copy:**
  - "GMAIL" · "Mail erişimine neden ihtiyacımız var?"
  - Reasons: `priority_high` "Önemli mailleri bulmak" · `person` "Cevap bekleyenleri anlamak" · `flag` "Son tarihleri tespit etmek"
  - Assurances: `verified_user` **"Sen onaylamadan mail göndermeyiz."** · `link_off` "Bağlantını istediğin zaman kaldırabilirsin." · `block` "Verilerin reklam amacıyla kullanılmaz, satılmaz."
  - CTA "Google ile Bağlan" · "Şimdi değil" · "Sonraki adımda Google'ın kendi izin ekranı açılır."
  - Note: "Yerel OAuth'tan hemen önce açılan sayfa: 3 neden + 3 güvence. Aynı kalıp Outlook ve takvimler için; yalnızca ikon ve nedenler değişir."
- **Data fields:** provider=google, requested scopes. Consent-shown events feed analytics (§42) and the audit trail.
- **Interactions → production:**
  - "Google ile Bağlan":
    - Start the OAuth code flow with PKCE via `expo-auth-session` / `expo-web-browser` (ASWebAuthenticationSession / Custom Tabs).
    - Scopes: `openid email profile https://www.googleapis.com/auth/gmail.readonly` (read only, §76). Calendar read is requested in 2.7c (incremental auth, `include_granted_scopes=true`).
    - The code is exchanged **server-side** in a Supabase Edge Function; the refresh token is stored encrypted server-side and never sent to the client (§76).
    - Return to 2.6 with the pill "Bağlandı". If the user unticked Gmail in granular consent → "Mail izni verilmedi" state with retry.
  - "Şimdi değil" → dismiss the sheet back to 2.6.
  - Swipe down or scrim tap → dismiss.
- **States depicted:** default.
- **States missing:** CTA loading while the browser opens; returned-with-error; returned-cancelled; partial scope; Google "unverified app" risk (see Open issues).
- **Prototype-only / fake:** none, but the claim "Verilerin … satılmaz" must match the privacy policy (§40).
- **Maps to:** §34 (6, 8), §75, §76, §40, §113.

### İzin Açıklayıcı · Outlook / Microsoft 365
- **Source:** PRIMARY / 02 / "2.7b İzin Açıklayıcı · Outlook / Microsoft 365"
- **Purpose:** Same pattern for Microsoft Graph mail, with a corporate-policy assurance.
- **Layout:** identical to 2.7, except:
  - Tile #E7F0FD/#2262BE `mail`.
  - Four assurance rows instead of three.
  - CTA includes the 2×2 Microsoft logo, gap 10.
- **Exact copy:**
  - "OUTLOOK · MICROSOFT 365" · "Outlook erişimine neden ihtiyacımız var?"
  - Reasons: `work` "İş maillerinde önemli konuları bulmak" · `forum` "Cevap bekleyen konuşmaları anlamak" · `description` "Teklif, sözleşme ve son tarihleri tespit etmek"
  - Assurances: **"Sen onaylamadan mail göndermeyiz."** · `admin_panel_settings` "Kurumsal hesapta yalnızca sana verilen izinler kullanılır; şirket politikaların geçerli kalır." · `link_off` "Bağlantını istediğin zaman kaldırabilirsin." · `block` "Verilerin reklam amacıyla kullanılmaz, satılmaz."
  - CTA "Microsoft ile Bağlan" · "Şimdi değil" · "Sonraki adımda Microsoft'un kendi izin ekranı açılır."
  - Note: "Gmail kalıbının aynısı; ikon karosu bilgi mavisi, nedenler iş bağlamına göre. Kurumsal hesaplar için ek güvence satırı (yönetici politikaları)."
- **Data fields:** provider=microsoft, tenant_type (personal / work), tenant_id, scopes.
- **Interactions → production:**
  - "Microsoft ile Bağlan" → Microsoft identity platform v2 auth code with PKCE. Scopes `openid profile email offline_access User.Read Mail.Read` (Calendars.Read in the calendar step). Token exchange and storage server-side.
  - "Şimdi değil" → dismiss.
- **States depicted:** default.
- **States missing:** "Yöneticinin onayı gerekiyor" (AADSTS65001 / admin consent required) with guidance; conditional-access block; personal vs work picker.
- **Prototype-only / fake:** none.
- **Maps to:** §34 (6), §75, §76.

### İzin Açıklayıcı · Takvim / Calendar permission explainer (Google / Apple / Microsoft)
- **Source:** PRIMARY / 02 / "2.7c İzin Açıklayıcı · Takvim"
- **Purpose:** One explainer for three calendar providers; the chip selection changes the CTA.
- **Layout:**
  - Same sheet as 2.7; tile #E4F5EA/#1E7A47 `calendar_month`.
  - Provider chips row (margin-top 12, gap 6, 12/600, 30h, radius 999): selected = bg #1A1917, text #fff, `check` 14; unselected = bg #F5F4F0, text #6B6860.
  - 4 ReasonRows (padding 11 14).
  - AssuranceBox with 3 rows; CTA; "Şimdi değil"; footnote.
- **Exact copy:**
  - "TAKVİM" · "Takvim erişimine neden ihtiyacımız var?"
  - Chips: "Google Takvim" (selected) · "Apple Takvim" · "Microsoft Takvim"
  - Reasons: `today` "Günün programını anlamak" · `event_busy` "Toplantı çakışmalarını tespit etmek" · `wb_twilight` "Yaklaşan etkinlikleri brifinge eklemek" · `event_available` "Uygun zaman önermek"
  - Assurances: **"Takviminde değişiklik yapmadan önce senden onay isteriz."** · "Bağlantını istediğin zaman kaldırabilirsin." · "Etkinlik içerikleri reklam amacıyla kullanılmaz."
  - CTA "Google Takvim'i Bağla" · "Şimdi değil" · "Apple Takvim cihazdan okunur; ayrı giriş gerekmez."
  - Note: "Üç sağlayıcı için tek açıklayıcı; seçili sağlayıcı çipi CTA metnini değiştirir. Dört neden ürünün dört takvim yeteneğine birebir karşılık gelir."
- **Data fields:** provider enum (google_calendar | microsoft_calendar | apple_eventkit | android_device_calendar), selected calendars, permission status.
- **Interactions → production:**
  - Chip tap → switch provider and CTA label. Copy is undrawn for Apple ("Apple Takvim'e İzin Ver") and Microsoft ("Microsoft Takvim'i Bağla").
  - Google → incremental OAuth `calendar.readonly` (or `calendar.events.readonly`). Write scope only later, via progressive auth when a calendar approval executes (§76).
  - Microsoft → `Calendars.Read`.
  - Apple → `expo-calendar` (57.0.4) `requestCalendarPermissionsAsync()`. iOS 17+ full access needs `NSCalendarsFullAccessUsageDescription`. Events are read on device and uploaded to the backend for analysis, so the disclosure must say so.
  - Android → device calendar (CalendarContract via `expo-calendar`). The Apple chip is hidden on Android.
  - "Şimdi değil" → dismiss.
- **States depicted:** Google selected.
- **States missing:**
  - Apple and Microsoft chip-selected variants.
  - iOS permission denied: 08 `error/permission-denied` "Takvim izni verilmedi." / "Toplantı hazırlığı ve çakışma uyarıları takvim erişimi gerektirir. Diğer her şey çalışıyor." / "İzin Ver" · "Neden gerekli?". Handle `canAskAgain=false` → `Linking.openSettings()`.
  - Calendar picker after connect.
  - Android device-calendar variant.
- **Prototype-only / fake:** the footnote "ayrı giriş gerekmez" is correct for EventKit, but data leaves the device when synced server-side. Copy must not imply on-device-only processing (§40).
- **Maps to:** §34 (7, 8), §75, §76, §20, §91.

### Kişiselleştirme · Çoklu seçim / Personalization (interests)
- **Source:** PRIMARY / 02 / "2.8 Kişiselleştirme · Çoklu seçim" (`INTERESTS` data)
- **Purpose:** Choose which life areas matter. Drives Life Intelligence visibility on Today.
- **Layout:**
  - Step header "ADIM 2 / 4"; title 30/36; sub 15/22.
  - 2-column grid, gap 10. Tiles 88h, radius 18, padding 14; icon 24 top-left; label 15/600 bottom-left; `check_circle` 20 FILL1 at top-right (12,12).
    - Selected: bg #1A1917, text #fff, icon #A9AAF5, check #fff, no shadow.
    - Unselected: bg #fff, text ink, icon #5B5CE2, check transparent, card shadow.
  - CTA at the bottom (margin-top auto).
- **Exact copy:**
  - "Senin için neler önemli?" · "Birden fazla seçebilirsin. Zamanla kendim de öğrenirim."
  - Tiles: `work` İş ✓ · `family_restroom` Aile ✓ · `account_balance_wallet` Finans · `flight` Seyahat ✓ · `shopping_bag` Alışveriş · `event_available` Randevular ✓ · `flag` Son Tarihler · `select_all` Hepsi
  - CTA "Devam · 4 seçili"
  - Note: "Seçili kart: koyu zemin + dolu onay işareti. "Hepsi" diğerlerini otomatik işaretler. Seçimler yaşam kartlarının Bugün'de görünürlüğünü belirler."
- **Data fields:** `user_preferences.interest_categories[]` ∈ {work, family, finance, travel, shopping, appointments, deadlines}. "Hepsi" = all.
- **Interactions → production:**
  - Tile tap toggles, with a light haptic.
  - "Hepsi" selects all 7. Deselecting one when all are on unselects "Hepsi".
  - CTA count updates live; CTA → 2.9 (persist server-side, idempotent upsert).
  - Back → 2.6.
- **States depicted:** 4 selected.
- **States missing:** 0 selected (disable the CTA, or copy "Atla / Hepsini göster"); save error; Dynamic Type (tile height 88 fixed, labels must wrap).
- **Prototype-only / fake:** "Zamanla kendim de öğrenirim." implies learning. It must be backed by the §32 "Learn from interactions" toggle, which is on by default and disclosed.
- **Maps to:** §34 (9), §32, §23, §8.

### Brifing Ayarları / Briefing schedule ("Günün ritmi")
- **Source:** PRIMARY / 02 / "2.9 Brifing Ayarları"
- **Purpose:** Set the times for Morning, Midday and Evening, plus weekend behaviour.
- **Layout:**
  - Step header "ADIM 3 / 4"; title; sub.
  - 4 SettingRow cards (gap 10): padding 14 16, radius 18, #fff, card shadow; tile 44 radius 14; title 15/600; meta 12 #9B978E.
    - Trailing TimeChip: 36h, padding 0 12, radius 12, bg #F5F4F0, 17/600 −.01em.
    - Weekend row trailing Switch: 50×30 radius 15, on #5B5CE2; knob 26 #fff, shadow `0 1px 3px rgba(0,0,0,.2)`, right 2.
  - Morning tile #EDEDFC/#5B5CE2 `wb_twilight`; the others #F0EFEB/#6B6860 (`wb_sunny`, `bedtime`, `weekend`).
  - AIHint line: `psychology` 18 #5B5CE2 + 13/19 #6B6860.
  - CTA.
- **Exact copy:**
  - "Günün ritmi" · "Brifingleri ne zaman hazırlayayım? Sonradan değiştirebilirsin."
  - "Sabah brifingi" — "Günün tamamı · sesli sürüm" — "08:00"
  - "Öğle nabzı" — "Yalnızca değişenler" — "13:00"
  - "Akşam kapanışı" — "Yarına kalanlar" — "19:00"
  - "Hafta sonu" — "Sadece sabah, 10:00 · Kişisel öncelikli" — switch ON
  - "Takvimine göre: genelde 08:15'te telefonu açıyorsun. 08:00 iyi bir seçim."
  - CTA "Devam"
  - Note: "Saat çipine dokunuş yerel saat seçiciyi açar. Öğle ve akşam Pro özelliği; ücretsizde kilit ikonu ile görünür, gizlenmez."
- **Data fields:** `briefing_schedules` {user_id, type: morning|midday|evening|weekly, local_time "08:00"/"13:00"/"19:00", enabled, days_of_week, timezone (from the profile timezone field, Europe/Istanbul), weekend_mode {enabled, time "10:00", morning_only, personal_first}}. Weekly default "Pazar 18:00" (from 03) is not shown here.
- **Interactions → production:**
  - TimeChip → native time picker (`@react-native-community/datetimepicker` 9.2.1, 24h, locale tr-TR) in a sheet.
  - Weekend switch toggles.
  - Free user: Öğle and Akşam rows show a `lock` icon; tap → contextual Pro gate (07/7.6 or paywall 7.5).
  - CTA → persist, then (re)schedule backend cron jobs in the user's timezone, DST-safe (§96) → next step.
- **States depicted:** Pro-like (all rows unlocked).
- **States missing:** Free/locked rows (**not drawn** despite the note); time-picker sheet; per-briefing enable/disable (only weekend has a switch); weekday selection; timezone display/change; save error.
- **Prototype-only / fake:** the AI hint "genelde 08:15'te telefonu açıyorsun" requires device-usage data the app cannot access (no Screen Time API), and "Takvimine göre" contradicts it. During onboarding there is no history, so this is a **fabricated insight** (§83). Replace it with a calendar-derived hint (e.g. "İlk toplantın genelde 09:00'da; 08:00 iyi bir seçim.") shown only when real data supports it; otherwise hide.
- **Maps to:** §34 (10), §9–§12, §35, §44, §96, §39.

### İlk Analiz · İşleniyor / First Analysis — processing
- **Source:** PRIMARY / 02 / "2.10 İlk Analiz · İşleniyor (dramatik an)" (`ring`, `spinner` in renderVals)
- **Purpose:** Real-time progress of the first 72h analysis with a list of findings.
- **Layout:**
  - `gradient/night` background, text #fff, padding 0 28 44; center stack gap 36.
  - PulsingRing 132×132:
    - Base ring 3px `rgba(255,255,255,.15)`.
    - Spinner arc 3px top #fff, `daspin 1.4s linear infinite`.
    - Inner (inset 14) 2px bottom arc `rgba(255,255,255,.6)`, `daspin 2.2s linear infinite reverse`.
    - Center `auto_awesome` 44 FILL1.
  - Title 26/32 600; sub 14 `rgba(255,255,255,.7)`.
  - Checklist (gap 12, 15px):
    - Done: `check_circle` 22 FILL1 **#A9F0C1**.
    - Active: spinner 22, 2px `rgba(255,255,255,.3)` with top #fff, .9s.
    - Pending: 22px ring, 2px `rgba(255,255,255,.4)`, row opacity .4.
  - Footer 12 `rgba(255,255,255,.6)` centered.
- **Exact copy:**
  - "Dijital hayatın analiz ediliyor…" · "Son 72 saat · Gmail ve Google Takvim"
  - ✓ "127 mail bulundu" · ✓ "8 potansiyel önemli konu" · ✓ "4 etkinlik" · ⟳ "2 takip tespit ediliyor…" · ○ "Öncelikler sıralanıyor"
  - "Genelde 20–40 saniye sürer. Mail içerikleri cihazında özetlenir, hiçbir şey gönderilmez."
  - Note: "Sayılar canlı artar (127 → sayaç), her satır tamamlandığında yeşil ✓ + hafif haptic. Halka nabız atar; ilerleme çubuğu yok, belirsiz bekleme hissi yerine bulgu listesi."
- **Data fields → entities:** `onboarding_analysis_jobs` {id, user_id, window_hours 72, sources [gmail, google_calendar], status, steps[] {key: mails_fetched | candidates | events | followups | ranking, status: pending|running|done|failed, count}, counts {mail 127, potential_important 8, events 4, followups 2}, started_at, finished_at, error_code}.
- **Interactions → production:**
  - No user controls.
  - Subscribe to job progress (Supabase Realtime on the job row, or polling). Counts animate to real values; each step ✓ plus a light haptic.
  - On completion → 2.11.
  - Job runs server-side through the §80 pipeline: ingestion → normalization → rules → dedupe → classification → structured output → grounding → persistence.
  - Must be idempotent: re-entering must not start a second job.
- **States depicted:** mid-progress.
- **States missing:**
  - Slow (> ~60s): "Biraz uzun sürüyor; hazır olunca haber vereyim" with continue-to-Today.
  - Failure with retry.
  - Partial (calendar failed, mail ok).
  - Zero mails / new account.
  - Offline / app backgrounded (resume on foreground).
  - Demo mode (§89).
  - Reduce Motion (static ring).
- **Prototype-only / fake:**
  - Footer claim "Mail içerikleri cihazında özetlenir, hiçbir şey gönderilmez" is **false** for the specified architecture: server-side refresh tokens (§76), the Edge Function AI pipeline (§80), the Anthropic/OpenAI adapters (§81). It must be rewritten to match reality (§40), e.g. "Mail içeriklerin şifreli bağlantıyla işlenir; reklam için kullanılmaz."
  - The live counter must reflect real counts. No scripted timers (SECONDARY uses 1s `setTimeout` steps).
- **Maps to:** §34 (12), §80, §82, §83, §40, §94, §123.

### İlk Analiz · Hazır / Aha moment
- **Source:** PRIMARY / 02 / "2.11 İlk Analiz · Hazır"
- **Purpose:** First value moment: show real findings, then continue to the first briefing.
- **Layout:**
  - `gradient/dawn` background; center stack gap 28.
  - Success disc 88 #fff, shadow `0 20px 50px rgba(0,0,0,.25)`, `check` 44 **#2FA062** FILL1.
  - Kicker 15/600 .1em opacity .75.
  - Title 32/38 600 with the number in **#C9C9FF**.
  - Findings panel: bg `rgba(255,255,255,.1)`, radius 20, padding 6 16. Rows padding 10 0, 14px, separators 1px `rgba(255,255,255,.1)`. Badges 10/700 padding 2 6 radius 999.
  - Inverse CTA: #fff, text #25266A.
- **Exact copy:**
  - "HAZIR." · "Son 72 saatte bilmen gereken **5** şey bulduk."
  - Rows: "ACİL" (#FCEDE9/#C7432F) "Ahmet revize teklif bekliyor · 17:00" · "TOPLANTI" (`rgba(255,255,255,.15)`) "Mehmet ile 14:30 · hazırlık hazır" · "SON TARİH" (#FDF2DC/#9A6300) "Başvuru bugün 17:00" · "+ 2 konu daha" (opacity .7)
  - CTA "Brifingimi Gör"
  - Note: "İlk değer anı: gerçek bulgular hemen görünür, brifing bir dokunuş uzakta. Bildirim izni bundan SONRA istenir; değer görülmeden izin istenmez."
- **Data fields:** top-N `insights` from the job {badge/kind, title, time}, total_count 5, overflow count 2. Implies a first `briefing` generated immediately (type=morning or `onboarding_first`).
- **Interactions → production:**
  - "Brifingimi Gör" → 2.12 notification explainer, then 3.3 Morning Briefing (the first one, generated now regardless of the time of day). The CTA label promises the briefing; the order must be decided (see Open issues).
  - Finding rows: optionally tappable to the source after onboarding. Not drawn as tappable, so keep them non-interactive.
  - "+ 2 konu daha" → non-interactive, or opens the briefing.
- **States depicted:** 5 findings.
- **States missing:**
  - Zero findings: "Son 72 saatte acil bir şey yok. Yeni bir şey olursa haber veririm." (no fake findings).
  - One or two findings (no "+N").
  - Free user: "hazırlık hazır" references Meeting Prep, which is Pro (§44).
- **Prototype-only / fake:** content must be real job output. Sample names only in demo mode.
- **Maps to:** §34 (13), §111, §83, §44.

### Bildirim İzni Açıklayıcı / Notification permission pre-prompt
- **Source:** PRIMARY / 02 / "2.12 Bildirim İzni Açıklayıcı"
- **Purpose:** Explain the notification philosophy before the OS prompt.
- **Layout:**
  - bg #F5F4F0; center.
  - 3 NotificationPreviewCards (gap 10), offset −8px, +8px, −4px: padding 14, radius 20, bg `rgba(255,255,255,.7)`, backdrop blur 20, shadow `0 8px 24px rgba(27,25,23,.08)`.
    - App tile 38 radius 11 #5B5CE2 with `auto_awesome` 22 #fff FILL1.
    - Header "Dijital Asistan" bold 13 plus time #9B978E; body 14/19.
  - Title 30/36 600; sub 15/22 #6B6860.
  - Primary CTA; text button "Daha sonra".
- **Exact copy:**
  - "14:10 · Toplantına 20 dakika kaldı. Mehmet için 3 konu hazır."
  - "08:00 · Bugün cevaplaman gereken önemli bir mail var."
  - "11:30 · Kargon bugün geliyor. 14:00–18:00 arası."
  - "Sadece önemli olduğunda haber verelim." · "Günde ortalama 3 bildirim. Pazarlama bildirimi yok, "bak bana" bildirimi yok."
  - CTA "Bildirimleri Aç" · "Daha sonra"
  - Note: "Üç gerçek bildirim örneği; sistem izni ancak "Bildirimleri Aç"tan sonra istenir. "Daha sonra" ilk brifing ekranında tekrar, sonra bir daha sormaz."
- **Data fields:**
  - `notification_permission_state` {status: undetermined|granted|denied|provisional, asked_at, deferred_count (max 1 re-ask)}.
  - `device_push_tokens` {platform, token, app_version}.
  - Default category prefs (§35).
- **Interactions → production:**
  - "Bildirimleri Aç" → `expo-notifications` (57.0.20) `requestPermissionsAsync({ios:{allowAlert:true, allowBadge:true, allowSound:true}})`. Android 13+ triggers the `POST_NOTIFICATIONS` runtime prompt; on Android ≤12 permission is implicit, so skip this screen or just confirm.
  - On granted → register the push token with the backend → next step (2.13 on Android, else Today or first briefing).
  - If `canAskAgain=false` → CTA becomes "Ayarları Aç" → `Linking.openSettings()`.
  - "Daha sonra" → record the deferral; re-ask once on the first-briefing screen, then never (per note).
- **States depicted:** default.
- **States missing:** denied / blocked (Settings route); provisional (iOS `allowProvisional` option exists; decide whether to use it); already-granted (skip the screen).
- **Prototype-only / fake:**
  - "Günde ortalama 3 bildirim" is a product claim. It must be enforced by the §132 decision engine (daily budget) or reworded.
  - The example "Mehmet için 3 konu hazır" is a Pro feature (Meeting Prep).
- **Maps to:** §34 (14), §35, §86, §96, §132, §3 (15–16).

### Android · Telefon Bildirimleri (isteğe bağlı) / Android Notification Intelligence opt-in
- **Source:** PRIMARY / 02 / "2.13 Android · Telefon Bildirimleri (isteğe bağlı)" (`APPS` data)
- **Purpose:** Optional prominent disclosure before enabling the NotificationListenerService.
- **Layout:**
  - Android frame: radius 32, padding 0 20 28.
  - Header: back circle 36; center kicker "SADECE ANDROID"; right "Atla" 14/600 #6B6860.
  - Title 30/36; sub 15/22 #6B6860.
  - Section kicker "UYGULAMALAR".
  - Grouped white card (radius 18, padding 4 16, card shadow). Rows padding 10 0, divider `rgba(27,25,23,.06)`; tile 36 radius 11 #F0EFEB/#6B6860, icon 20; name 15/600; meta 12 #9B978E; switch 50×30 (on #5B5CE2 knob left 22px; off **#D9D6D0** knob left 2px).
  - AssuranceBox (padding 14 16, radius 16, 13/19 #1E5A36).
  - CTA plus footnote.
- **Exact copy:**
  - "Telefon bildirimlerini de anlayayım mı?" · "Kargo, banka ve uygulama bildirimlerinden kişisel sinyaller çıkarırım. Mesaj içerikleri asla saklanmaz."
  - "UYGULAMALAR":
    - `local_shipping` "Kargo uygulamaları" — "Trendyol, Hepsiburada, Yurtiçi" ON
    - `account_balance` "Banka" — "Ödeme ve son tarih bildirimleri" ON
    - `flight` "Havayolu" — "THY, Pegasus · kapı ve rötar" ON
    - `restaurant` "Rezervasyon" — "Yemek, otel, etkinlik" OFF
    - `chat` "Mesajlaşma" — "WhatsApp, Telegram · önerilmez" OFF
  - "Bildirim erişimi cihazda işlenir. Sohbet uygulamaları varsayılan olarak kapalıdır ve önerilmez."
  - CTA "Bildirim Erişimini Aç" · "Android Ayarlar → Bildirim erişimi ekranı açılır."
  - Note: "…iOS akışı bu adımı hiç görmez; ürün deneyimi bundan bağımsızdır."
- **Data fields:** `android_notification_listener_settings` {enabled, mode: selected_categories | selected_apps, categories {shipping:true, bank:true, airline:true, reservation:false, messaging:false}, package_allowlist[], excluded_sensitive_packages[]}, `listener_permission_granted`.
- **Interactions → production:**
  - Toggles persist locally and server-side.
  - CTA → `expo-intent-launcher` `startActivityAsync(ActivityAction.NOTIFICATION_LISTENER_SETTINGS)` = `"android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"`. On return, check the grant state through the custom Kotlin module (`NotificationListenerService`, §36). Granted → Today; not granted → stay with "İzin verilmedi" info.
  - "Atla" → Today.
  - Back → 2.12.
- **States depicted:** default.
- **States missing:**
  - Permission returned-not-granted.
  - Granted confirmation.
  - Per-app picker ("selected apps", §36; the design only has category toggles).
  - Always-excluded sensitive/2FA/authenticator apps row (§36 requires default exclusion).
  - OTP filtering disclosure for bank notifications.
  - Free vs Pro: §44 lists this as a PRO feature; the onboarding gating is undrawn.
- **Prototype-only / fake:**
  - "cihazda işlenir" and "Mesaj içerikleri asla saklanmaz" are binding claims. Extraction must be on-device (rule/regex parser in Kotlin); only derived signals are uploaded and raw text is never persisted. Otherwise the copy must change.
  - Example brand names (Trendyol, THY…) must map to real package-name lists.
- **Maps to:** §36, §44, §91, §28, §40, §112 (Play User Data policy / prominent disclosure).

---

## 3. Today and briefings (PRIMARY/03)

### Bugün · Light · Sabah / Today (light, morning)
- **Source:** PRIMARY / 03 Bugun ve Brifingler.dc.html / "3.1 Bugün · Light · Sabah"
- **Purpose:** Home tab. Calm editorial summary: hero sentence, prioritized cards (max 2 actions each), approval badge.
- **Layout (top→bottom):**
  - bg #F5F4F0; content padding 14 20 0, gap 18.
  - **Header** (align flex-end, space-between):
    - Left: date kicker 12/600 .08em #9B978E; H1 28/34 600 −.02em.
    - Right (gap 8): **ApprovalChip** (34h, padding 0 12 0 9, radius 999, #fff, text #4547C9 12/600, `task_alt` 18, shadow `0 1px 2px rgba(27,25,23,.06)`) and **Avatar** (40 circle #1A1917, initial #fff 15/600).
  - **BriefingHeroCard:** bg `radial-gradient(140% 100% at 100% 0%, #E4E4FA 0%, #FFFFFF 58%)`, radius 28, padding 22 22 20, shadow `0 1px 2px rgba(27,25,23,.04), 0 12px 32px rgba(91,92,226,.10)`.
    - Kicker #5B5CE2 12/600 .06em with `auto_awesome` 16 FILL1.
    - Title 26/32 600, number #5B5CE2.
    - Context 14/20 #6B6860.
    - Button row (gap 10, margin-top 18): primary flex 48h radius 14 #5B5CE2 15/600; tonal 48h padding 0 16 0 12 radius 14 #EDEDFC/#4547C9 14/600 with `play_arrow` 20 FILL1.
  - **SectionHeader:** "ÖNCELİKLERİN" kicker; right count 12 #9B978E; padding 4 4 0.
  - **PriorityCard** ×5: #fff, radius 20, padding 14 16 10, shadow `0 1px 2px rgba(27,25,23,.04),0 6px 20px rgba(27,25,23,.05)`.
    - Top row: badge 11/700 .05em padding 3 8 radius 999, then time 12 #9B978E; right icons `check_circle` and `more_horiz` 22 #B8B4AA, gap 10.
    - Title 17/23 600 −.01em (margin-top 6).
    - Optional sub 14/20 #6B6860.
    - Source row 12 #9B978E with icon 16 (margin-top 10).
    - Action row: text buttons, gap 14, padding 8 0, 14/600; primary #4547C9, secondary #6B6860. Last card margin-bottom 16.
  - **BottomTabBar** (sticky): 90h, padding 8 8 28, bg `rgba(255,255,255,.92)`, blur 20, top border `rgba(27,25,23,.06)`, 11/500, icon 26. Active #5B5CE2 FILL1; inactive #9B978E.
- **Exact copy:**
  - "5 EYLÜL CUMARTESİ" · "Günaydın, Yunus" · "2 onay" · "Y"
  - "BRİFİNG HAZIR · 07:58" · "Bugün bilmen gereken **5** şey var." · "3 önemli mail · 4 etkinlik · 2 takip"
  - "Brifingimi Gör" · "Dinle · 2 dk"
  - "ÖNCELİKLERİN" · "5 konu"
  - Cards:
    1. "ACİL" (#FCEDE9/#C7432F) "08:42" — "Ahmet senden bugün 17:00'ye kadar revize teklif bekliyor." — `mail` "Gmail · Ahmet Yılmaz · 08:42" — "Yanıtla" / "Hatırlat"
    2. "TOPLANTI" (#F0EFEB/#6B6860) "14:30" — "14:30 Mehmet ile toplantı" — sub "Son görüşmeniz 4 gün önceydi." — `event` "Google Takvim · Müşteri toplantısı · 60 dk" — "Hazırlan"
    3. "SON TARİH" (#FDF2DC/#9A6300) "17:00" — "Başvuru bugün 17:00'de kapanıyor." — `mail` "Gmail · Girişim Programı · Dün 16:10" — "Takvime Ekle"
    4. "TAKİP" (neutral) "3 gün" — "Gönderdiğin teklif mailine 3 gündür cevap gelmedi." — `schedule_send` "Gmail · Mehmet Yılmaz · 2 Eyl" — "Takip Mesajı Hazırla" / "Yarın Hatırlat"
    5. "KİŞİSEL" (neutral) "Bugün" — "Trendyol siparişin bugün geliyor." — `package_2` "Kargo · Yurtiçi · 14:00–18:00" — "Takip Et"
  - Tabs: `sunny` "Bugün" · `dynamic_feed` "Akış" · `calendar_today` "Plan" · `auto_awesome` "Asistan"
  - Note: "Hero tek cümle + insani bağlam satırı; KPI kutusu yok. Kartlar: rozet (yalnızca anlam), başlık, kaynak satırı, en fazla 2 aksiyon. Sağ üstteki onay rozeti bekleyen yazma işlemi varsa görünür."
- **Data fields → entities:**
  - `profiles.display_name` ("Yunus"), local date formatted tr-TR `d MMMM EEEE` uppercased with Turkish casing ("5 EYLÜL CUMARTESİ"; must use `toLocaleUpperCase('tr-TR')` for İ).
  - Greeting by local time: "Günaydın" / "İyi günler" (07/7.6) / "İyi akşamlar" (3.2).
  - `briefings` {type: morning, generated_at 07:58, headline_count 5, summary {important_mail 3, events 4, followups 2}, audio_duration_s ≈120 ("2 dk")}.
  - `approval_requests` count where status=pending (2).
  - `insights` / priority items {id, kind: urgent_mail|meeting|deadline|follow_up|life, badge_label, tone: critical|warning|neutral|info, display_time, title, subtitle?, source {source_type, source_id, source_provider (gmail|google_calendar|carrier), sender_display, source_timestamp}, actions[≤2], status open|done|dismissed|snoozed, rank, confidence, why_important}.
  - `calendar_events` {start 14:30, duration 60, type "Müşteri toplantısı", last_contact_days 4}.
  - `follow_ups` {recipient "Mehmet Yılmaz", sent_at 2 Eyl, days_waiting 3}.
  - `life_items` {type shipment, merchant Trendyol, carrier Yurtiçi, window 14:00–18:00}.
- **Interactions → production** (the IA prototype `Dijital Asistan.dc.html` wiring is quoted as intended behaviour):
  - "2 onay" chip → Approval Center (§33). Hidden when 0.
  - Avatar → Profile & Settings (§8).
  - "Brifingimi Gör" → Morning Briefing 3.3.
  - "Dinle · 2 dk" → Audio Briefing 3.4 and auto-play.
  - Card title / card tap → source detail (mail → Email Detail §15; event → event / Meeting Prep; follow-up → thread; life → life item detail). Prototype: `onOpen → push(p.go)`.
  - `check_circle` → mark done (status=done, optimistic): the icon fills #2FA062, the card scales .96 and fades, the list shifts up, success haptic (08 MOTION "Öncelik tamamlandı": ikon 160ms · kart 300ms · liste 300ms). Toast "Tamamlandı · Bir sonraki konu yukarı taşındı" with **undo**.
  - `more_horiz` → correction sheet (IA prototype `sheetDefs.correct`): title "Bunu nasıl değerlendireyim?", sub "Seçimin gelecekteki öncelikleri etkiler".
    - `remove_circle` "Önemli değil" → "Bu tür konuları daha aşağıda göstereceğim."
    - `trending_up` "Bunu daha sık göster" → "Bu konuyu daha yüksek öncelikle izleyeceğim."
    - `star` "Bu kişiyi VIP yap" → "<Kişi> artık VIP."
    - `visibility_off` "Bunu takip etme" → "Bu konuyu artık takip etmeyeceğim."
    - Result toast "Öğrendim · …".
    - These write `ai_feedback` / `learned_preferences` / `vip_people` (§30–32, §59).
    - **Add** "Neden önemli?" (why_important + source, §131) and "Kaynağı aç".
  - "Yanıtla" → AI Reply draft (§16) → Approval `email_send`.
  - "Hatırlat" → Smart Reminder sheet (IA prototype): "Ne zaman hatırlatayım?" with options "30 dakika önce · 16:30", "1 saat önce · 16:00", "Bu akşam · 19:00", "Yarın sabah · 08:00", "Özel zaman", "Uygun zamanda · Takvimine göre: 12:10". Creates `reminder_create` with confirmation (§29).
  - "Hazırlan" → Meeting Prep (§21; Pro gate for Free).
  - "Takvime Ekle" → creates approval `calendar_create` (IA prototype: type "ETKİNLİK OLUŞTUR", what "“Başvuru son saati” · Bugün 17:00", why "Mailde son tarih tespit edildi.", change "Takvime 1 etkinlik · 30 dk önce hatırlatma"; toast "Onay Merkezi'ne eklendi"). Requires calendar write scope via progressive auth at execution (§76).
  - "Takip Mesajı Hazırla" → follow-up draft (§17) → approval `email_send`.
  - "Yarın Hatırlat" → `reminder_create` for tomorrow at the user's morning time. The prototype toast says "Yarın 09:00'da hatırlatırım" while the morning default is 08:00, so align the two.
  - "Takip Et" (shipment) → open the tracking URL extracted from the source email (external handoff) and subscribe to shipment updates. Hide the action if no URL or tracking number is in the source (§23: only source-backed data). Prototype toast "Kargo takibi açıldı · Teslimatta haber veririm" is prototype-only.
  - Swipe (08 MOTION): right = Tamamlandı; left = Ertele / Önemli değil; 35% threshold; light haptic at the threshold.
  - Pull-to-refresh → incremental provider sync. Thin indigo line at the top, then "Güncel · 09:41" for 1.5s (08).
  - Tabs → the 4 tabs (§8).
- **States depicted:** morning, briefing ready, 2 pending approvals, 5 items.
- **States missing (production):**
  - Skeleton: 08 `loading/today`.
  - Empty: 08 `empty/today` "Her şey kontrol altında." / "Bugün dikkat gerektiren yeni bir konu yok. 46 maili senin için okudum." / "Akışa göz at". The IA prototype variant is "Yeni bir şey olursa haber veririm. Öğle brifingi 13:00'te." — pick one.
  - Hero modes: before morning time ("Brifingin 08:00'de hazır"); generating ("Brifing hazırlanıyor"); midday delta; midday nothing; midday Free gate (07/7.6: "ÖĞLE NABZI · PRO" / "Sabahından beri 2 gelişme oldu." / "Öğle nabzı Pro'da. Sabah brifingin her zaman ücretsiz." / "7 gün ücretsiz dene" / "Şimdi değil"); evening (3.2); after "Yarına Hazırım"; weekend mode; Sunday weekly-ready; first-day after onboarding.
  - Offline: cached Today with "Çevrimdışı · son güncelleme HH:MM" and write actions queued/blocked (§94).
  - Errors: `error/sync-delayed`, `error/oauth-expired` banner, `error/ai-unavailable` (08).
  - Partial data (calendar-only / mail-only).
  - More than 5 items: cap and link to Akış.
  - Card-level: done, undo, pending-approval-created, action loading.
  - Dark morning variant (only dark-evening is drawn).
- **Prototype-only / fake:** prototype toasts for "Takip Et" and "Yarın Hatırlat" with no backend; hard-coded "BRİFİNG HAZIR · 07:58" and summary counts. All must be computed.
- **Maps to:** §8, §13–§23, §29, §30–§33, §59, §93, §94, §97, §99, §131.

### Bugün · Dark (Akşam modu) / Today (dark, evening mode)
- **Source:** PRIMARY / 03 / "3.2 Bugün · Dark"
- **Purpose:** Dark-theme tokens plus the evening hero mode ("Akşam saatlerinde hero otomatik olarak kapanış moduna geçer").
- **Layout:**
  - bg #141311; text #F2F0EB; status time "21:14".
  - Header: kicker #7A776F; H1 "İyi akşamlar, Yunus"; avatar inverted (#F2F0EB bg, #141311 text). **No approval chip.**
  - Hero: bg `radial-gradient(140% 100% at 100% 0%, rgba(133,134,242,.28) 0%, #1F1E1B 60%)`, ring `0 0 0 1px rgba(255,255,255,.06)`.
    - Kicker #A9AAF5; number #A9AAF5; context #A39F96.
    - Primary button #8586F2, text #0F0F2A.
    - Tonal button `rgba(133,134,242,.16)`, text **#C3C4F8** (not in the DARK token list).
  - Section header #7A776F.
  - Cards: #1F1E1B plus the 1px `rgba(255,255,255,.06)` ring. Badges: critical `rgba(224,85,63,.18)`/#F08B78; neutral `rgba(255,255,255,.08)`/#A39F96. Card icons **#5E5B54** (not a token). Actions: primary #A9AAF5, secondary #A39F96.
  - Tab bar: `rgba(20,19,17,.92)`, border `rgba(255,255,255,.08)`, active #A9AAF5, inactive #7A776F. Home indicator `rgba(255,255,255,.4)`.
- **Exact copy:**
  - "5 EYLÜL CUMARTESİ" · "İyi akşamlar, Yunus"
  - "AKŞAM KAPANIŞI HAZIR" · "Bugünden yarına **3** konu kaldı." · "4 tamamlandı · 2 takip · Yarın 09:00 Haftalık ekip"
  - "Kapanışı Gör" · "Dinle · 1 dk"
  - "YARINA KALANLAR" · "3 konu"
  - Cards:
    1. "ACİL" "Yarın 12:00" — "Selin sözleşme taslağı için yorumunu bekliyor." — `mail` "Gmail · Selin Kaya · 15:40" — "Yanıtla" / "Sabah Hatırlat"
    2. "TAAHHÜT" "Yarın" — "Mehmet'e teklif gönder" — "Toplantı sonrası "yarın göndereceğim" dedin." — `handshake` "Toplantı notu · 15:31" — "Planla" / "Ertele"
    3. "KİŞİSEL" "Yarın 09:15" — "TK2412 · İstanbul → Antalya" — "06:45'te evden çıkman gerekebilir. Check-in açık." — `flight` "THY · Rezervasyon maili · 28 Ağu" — "Check-in" / "Alarm Kur"
  - Note: "Dark: sıcak siyah #141311, yüzey #1F1E1B, hairline %6 beyaz. Marka indigosu aydınlatılır (#8586F2); acil coral #F08B78. Akşam saatlerinde hero otomatik olarak kapanış moduna geçer."
- **Data fields:** `briefings` {type evening, counts {completed 4, followups 2, carry_over 3}, tomorrow_first_event {title "Haftalık ekip", start 09:00}, audio ≈60s}; `commitments` {text, source=meeting_note, source_timestamp 15:31, quote, due=tomorrow}; `life_items` flight {flight_no TK2412, from IST, to AYT, departure tomorrow 09:15, checkin_open, leave_by 06:45, source THY mail 28 Ağu}.
- **Interactions → production:**
  - "Kapanışı Gör" → Evening Close 3.6.
  - "Dinle · 1 dk" → Audio Briefing (evening chapters, **undrawn**).
  - "Yanıtla" → AI Reply → approval.
  - "Sabah Hatırlat" → `reminder_create` at the morning briefing time (confirm and undo).
  - "Planla" → propose a time block → approval `calendar_create` (IA prototype on-plan toast: "Planlandı · Yarın 14:00–16:30 Teklif hazırlama").
  - "Ertele" → snooze sheet (presets) → commitment due-date update.
  - "Check-in" → external handoff to the airline check-in URL from the source mail. Hide if not present.
  - "Alarm Kur":
    - Android → `AlarmClock.ACTION_SET_ALARM` intent (Clock app handoff, user confirms).
    - iOS 26+ → AlarmKit (requires a native module and usage string); earlier iOS → fall back to "Hatırlatıcı kur" (local notification).
    - Document in KNOWN_PLATFORM_LIMITATIONS (§91).
  - `check_circle` / `more_horiz` / tabs / avatar → same as 3.1.
- **States depicted:** dark theme and evening hero mode.
- **States missing:** dark morning; dark empty / loading / error; approval chip in dark (colors undefined); evening with 0 carry-over ("Bugün her şeyi kapattın."); Free evening gate (§44: Evening is Pro).
- **Prototype-only / fake:** "06:45'te evden çıkman gerekebilir" requires home location plus travel-time computation, which is not in scope (no location/travel API in MASTER_PROMPT). Show it only if computed from real data (e.g. airline recommended arrival) and phrase it with uncertainty (§83), else drop it.
- **Maps to:** §8, §11, §18, §22, §23, §38, §91.

### Sabah Brifingi · Tam ekran / Morning Briefing (light)
- **Source:** PRIMARY / 03 / "3.3 Sabah Brifingi · Tam ekran" (`BRIEF` data)
- **Purpose:** Full-screen narrative briefing with six fixed sections; every row links to its source.
- **Layout:**
  - **GradientHeader** `gradient/dawn`, padding 0 20 60, text #fff; status "8:02".
    - Nav row: two 36 circles `rgba(255,255,255,.16)` — `arrow_back` (left) and `ios_share` (right).
    - Kicker (margin-top 36) 12/600 .08em opacity .72; H 32/38 600; sub 16/22 `rgba(255,255,255,.8)`.
  - **OverlappingSheet:** margin-top −28, bg #F5F4F0, radius 28 28 0 0, padding 26 20 120, gap 22.
    - Editorial paragraph: Lora 18/29, pretty wrap.
    - 6 sections: kicker (padding 0 4 8), then a **GroupedListCard** (#fff, radius 18, padding 4 16, card shadow). Rows padding 11 0, divider `rgba(27,25,23,.06)`; tile 30 radius 10 #F0EFEB/#6B6860 icon 17; title 15/20 500 −.01em; meta 12 #9B978E; `chevron_right` 18 #C9C5BC.
    - **ProvenanceFooter:** `verified` 16 plus 12 #9B978E.
  - **StickyBottomCTA:** padding 16 20 44, bg `linear-gradient(180deg,rgba(245,244,240,0) 0%,#F5F4F0 45%)`; ink button 52h radius 16 #1A1917, `headphones` 20, shadow `0 8px 24px rgba(27,25,23,.18)`.
- **Exact copy:**
  - "SABAH BRİFİNGİ · 5 EYLÜL" · "Günaydın Yunus" · "Bugün oldukça sakin bir günün var."
  - Lora: "Öğlene kadar toplantın bulunmuyor. Saat 14:30'da Mehmet ile müşteri toplantın var. Toplantı öncesinde dün gelen fiyat teklifine bakman faydalı olabilir. Gelen 46 mail arasında 3 konu dikkat gerektiriyor."
  - Sections (icon / title / meta):
    - **BUGÜNÜN ÖNCELİKLERİ:** `mail` "Ahmet'e revize teklif" / "Acil · 17:00" · `event` "Mehmet ile müşteri toplantısı" / "14:30 · Hazırlık öneriliyor" · `flag` "Başvuru 17:00'de kapanıyor" / "Son tarih"
    - **PROGRAMIN:** `event` "Mehmet ile müşteri toplantısı" / "14:30 · 60 dk · Ofis" · `videocam` "Ürün gözden geçirme" / "16:00 · 30 dk · Online" · `flag` "Başvuru son saati" / "17:00" · `restaurant` "Akşam yemeği rezervasyonu" / "20:30 · Karaköy"
    - **SENDEN CEVAP BEKLEYENLER:** `person` "Ahmet Yılmaz · Revize teklif" / "Bugün 17:00" · `person` "Selin Kaya · Sözleşme taslağı" / "3 saattir bekliyor"
    - **SENİN CEVAP BEKLEDİKLERİN:** `schedule_send` "Mehmet Yılmaz · Teklif" / "3 gündür yanıt yok"
    - **SON TARİHLER:** `flag` "Girişim programı başvurusu" / "Bugün 17:00" · `receipt_long` "Elektrik faturası · 1.842 TL" / "10 Eylül"
    - **KİŞİSEL GELİŞMELER:** `package_2` "Trendyol siparişin bugün geliyor" / "14:00–18:00" · `flight` "TK2412 İstanbul → Antalya" / "Yarın 09:15" · `autorenew` "Netflix yenilenecek" / "9 Eylül"
  - Footer: "46 mail, 1 takvim, 3 gün geçmiş analiz edildi · 07:58"
  - CTA "Brifingi Dinle · 2 dk"
  - Note: "Şafak gradyanı + Lora anlatı: günün tek "editoryal" anı. Altı bölüm sabit sırada; boş bölüm gizlenir. Her satır kaynağına gider."
- **Data fields → entities:** `briefings` {id, type morning, date, greeting_name, hero_line, narrative (AI, grounded), sections[] ordered keys priorities|schedule|awaiting_me|awaiting_them|deadlines|life, each with items[] {icon_kind, title, meta, source_ref {source_type, source_id, provider, timestamp}}, provenance {mail_count 46, calendar_count 1, lookback_days 3, generated_at 07:58}, audio {status, duration_s}}. Amounts ("1.842 TL") and dates only when present in the source (§23, §83).
- **Interactions → production:**
  - Back → Today.
  - `ios_share` → **decision needed**: sharing a personal briefing leaks personal data. Either remove it, or share a user-previewed plain-text summary via the native share sheet (§12 privacy-safe principle).
  - Row tap → source (mail detail, event detail, person page §30, follow-up §17, life item §23).
  - "Brifingi Dinle · 2 dk" → 3.4.
  - Sections with zero items are hidden (per note).
  - Opening → mark `briefing_opened` analytics (§42).
- **States depicted:** full briefing, light.
- **States missing:** briefing generating (skeleton with a Lora-line shimmer); briefing failed (retry, plus show the last briefing); audio not yet ready (CTA disabled with "Ses hazırlanıyor"); offline (cached briefing); stale ("Son güncelleme 07:58 · Yenile"); all-sections-empty ("Bugün sakin"); notification re-ask banner (per the 2.12 note); low-confidence item labelling ("Kaynakta kesinleşmiyor", §80).
- **Prototype-only / fake:** hero line "Bugün oldukça sakin bir günün var." contradicts the content (5 items, 4 events, 1 urgent). It must be derived from data, not a fixed template.
- **Maps to:** §9, §23, §80, §83, §97, §131, §12 (share privacy).

### Sabah Brifingi · Dark / Morning Briefing (dark)
- **Source:** PRIMARY / 03 / "3.3D Sabah Brifingi · Dark" (`briefDark`)
- **Purpose:** Dark tokens for the briefing.
- **Layout:** same as 3.3, except:
  - The dawn header gradient is identical in both modes.
  - Content bg #141311; paragraph #F2F0EB.
  - Section kicker #7A776F.
  - Cards #1F1E1B with the `0 0 0 1px rgba(255,255,255,.06)` ring; dividers `rgba(255,255,255,.06)`.
  - Tile `rgba(255,255,255,.08)`/#A39F96; meta #7A776F; chevron #5E5B54; footer #7A776F.
  - Sticky fade `linear-gradient(180deg,rgba(20,19,17,0) 0%,#141311 45%)`; CTA #8586F2 with text #0F0F2A, shadow `0 8px 24px rgba(91,92,226,.25)`.
- **Exact copy:** identical to 3.3. Note: "Şafak gradyanı her iki modda aynı; içerik yüzeyi #141311, kartlar #1F1E1B + %6 beyaz hairline. Ink CTA yerine dark primary (#8586F2, üzerinde #0F0F2A)."
- **Data fields / Interactions:** same as 3.3.
- **States depicted:** dark.
- **States missing:** same as 3.3, in dark.
- **Prototype-only / fake:** none beyond 3.3.
- **Maps to:** §9, §38.

### Sesli Brifing / Audio Briefing player
- **Source:** PRIMARY / 03 / "3.4 Sesli Brifing" (`wave` in renderVals; chapter timings in the IA prototype `CHAPTERS`)
- **Purpose:** Full-screen player with chapters, ±15s, speed, lock screen and CarPlay parity.
- **Layout:**
  - `gradient/night` background, text #fff, padding 0 20 44; status "8:04".
  - Header: 36 circle `rgba(255,255,255,.14)` `expand_more` (collapse); center kicker 12/600 .08em opacity .7; right SpeedChip (32h, padding 0 12, radius 999, `rgba(255,255,255,.14)`, 13/600).
  - Title block (margin-top 44): 26/32 600; sub 14 `rgba(255,255,255,.7)`.
  - Waveform (margin-top 40): 34 bars, 4px wide, radius 2, gap 5, container height 72. Bar heights `14+((i*13)%7)*8`. Played bars #fff (first 11); rest `rgba(255,255,255,.35)`. The IA prototype animates `dabar` while playing.
  - Progress (margin-top 28): track 4px radius 2, fill 31% #fff; time labels 12 `rgba(255,255,255,.7)`.
  - Controls (margin-top 24, gap 28): replay-15 (icon `replay` 30 with a "15" 10/600 label); play/pause 76 circle #fff with icon #25266A 40 FILL1 (showing `pause` = playing), shadow `0 10px 30px rgba(0,0,0,.25)`; forward-15 (mirrored `replay`, scaleX(−1)).
  - Chapter list (margin-top 36, 14/500): rows padding 11 4, top border `rgba(255,255,255,.1)`; index 22w 12 `rgba(255,255,255,.6)`; title; trailing duration, or `graphic_eq` 16 on the active row. Inactive rows opacity .55.
- **Exact copy:**
  - "SESLİ BRİFİNG" · "1.0x" · "Sabah Brifingi" · "5 Eylül · 2 dk 14 sn · Bugünün öncelikleri" · "0:42" · "2:14"
  - Chapters: "01 Genel bakış 0:18" · "02 Bugünün öncelikleri" (active; 0:32 per the IA prototype) · "03 Programın 0:24" · "04 Cevap bekleyenler 0:21" · "05 Son tarihler 0:17" · "06 Kişisel gelişmeler 0:22" (sum 134s = 2:14 ✓)
  - Note: "Bölümler kısa; dinlerken sekmelere dokunarak atlanır. 15 sn ileri/geri, hız 1.0 → 1.25 → 1.5. Kilit ekranı ve CarPlay için aynı bölüm yapısı kullanılır."
- **Data fields:** `briefing_audio` {briefing_id, status queued|generating|ready|failed, engine premium_tts|native_tts, voice, language tr-TR, duration_s 134, url (Supabase Storage signed URL), chapters[] {index, title, start_s [0, 18, 50, 74, 95, 112], duration_s}, transcript}. `playback_state` {position_s 42, rate 1.0|1.25|1.5}.
- **Interactions → production:**
  - Play/pause → `expo-audio` (57.0.5) `AudioPlayer.play()` / `pause()`.
  - ±15 → `seekTo(position ± 15)`.
  - Scrub on the progress bar → `seekTo`.
  - Speed chip cycles → `setPlaybackRate(1.0 → 1.25 → 1.5)` with pitch correction.
  - Chapter row → `seekTo(chapter.start_s)`.
  - Collapse (`expand_more`) → dismiss to a mini-player (**undrawn**) and keep playing.
  - Lock screen → `player.setActiveForLockScreen(true, {title, artist:'Dijital Asistan', artwork}, {showSeekForward:true, showSeekBackward:true})`. This requires `setAudioModeAsync({interruptionMode:'doNotMix', shouldPlayInBackground:true})`. On Android, lock-screen controls must be active or background playback stops after about 3 minutes (expo-audio doc note).
  - **Native TTS fallback** (§9) via `expo-speech` 57.0.3:
    - No seek API, so ±15 and scrubbing degrade to sentence/chapter granularity.
    - `Speech.pause()` is **not available on Android**; implement as stop plus resume from the last `onBoundary` or sentence index.
    - Input is capped at `Speech.maxSpeechInputLength`, so speak per chapter.
    - Rate is set via the `rate` option per utterance.
  - CarPlay: needs the CarPlay audio entitlement plus CPTemplate native work. Treat as optional or phase-2 and document it (§91).
- **States depicted:** playing at 0:42, chapter 2.
- **States missing:** audio generating ("Ses hazırlanıyor…"); failed → fallback to native voice with notice ("Cihaz sesiyle okunuyor"); offline (cached file vs unavailable); paused state (play icon); ended (replay / "Brifinge dön"); interruption (call) and headphone unplug → pause; mini-player; transcript/highlight for accessibility; Free user (§44: Voice Briefing is **Pro**, but Today shows "Dinle · 2 dk" to all → gate undrawn).
- **Prototype-only / fake:** static waveform heights are decorative. They cannot represent real amplitude unless the backend computes peaks; keep them decorative but tie progress to real position. The IA prototype's `setInterval` fake playback is prototype-only.
- **Maps to:** §9, §25, §44, §91, §92, §123.

### Öğle Nabzı · 13:00 / Midday Pulse
- **Source:** PRIMARY / 03 / "3.5 Öğle Nabzı · 13:00"
- **Purpose:** Delta-only update since the morning. Sent only when something meaningful changed.
- **Layout:**
  - bg #F5F4F0; content padding 14 20 0, gap 16; status "13:00".
  - ModalHeader: close circle 36 #fff with `close`; center kicker "ÖĞLE NABZI".
  - Hero (padding 8 0 4): kicker #5B5CE2 with `auto_awesome`; H 28/34 600 with the accent number.
  - **DeltaCard** ×2: #fff, radius 20, padding 16, card shadow.
    - Card 1: badge "TAKVİM" #E7F0FD/#2262BE plus time; title 17/23; sub 14/20; source row; button pair (primary 40h radius 12 #5B5CE2 14/600 flex; tonal 40h padding 0 14 #EDEDFC/#4547C9).
    - Card 2: text actions.
  - SectionHeader "GÜNÜN GERİ KALANI".
  - **TimelineList** card: radius 18, padding 4 16. Rows padding 11 0: time 44w 13/600 #6B6860; title flex 15/500; trailing status 12/600 (#4547C9 "Hazır", #9A6300 "4 sa kaldı", #9B978E "4 kişi").
  - Bottom ink CTA 52h (padding 16 20 44).
- **Exact copy:**
  - "ÖĞLE NABZI" · "SABAHTAN BERİ" · "Sabahından beri **2** önemli gelişme oldu."
  - Card 1: "TAKVİM" "12:12" — "Mehmet toplantıyı 16:00'ya almak istiyor." — "16:00 Ürün gözden geçirme ile çakışır. 16:30 senin için boş." — `mail` "Gmail · Mehmet Yılmaz · 12:12" — "16:30 Öner" / "Seçenekleri Gör"
  - Card 2: "TAKİP" "3 gün" — "Gönderdiğin teklife henüz cevap gelmedi." — `schedule_send` "Gmail · Mehmet Yılmaz · 2 Eyl" — "Takip Mesajı Hazırla" / "Toplantıda Sor"
  - "GÜNÜN GERİ KALANI": "14:30 Mehmet ile müşteri toplantısı — Hazır" · "17:00 Başvuru son saati — 4 sa kaldı" · "20:30 Akşam yemeği · Karaköy — 4 kişi"
  - CTA "Tamam"
  - Note: "Sadece delta: sabahtan beri değişenler. Gelişme yoksa bildirim gönderilmez; ekran "Her şey planlandığı gibi." tek satırıyla açılır."
- **Data fields:** `briefings` {type midday, delta_count 2, items[] {kind reschedule_request {event_id, requested_start 16:00, conflicts_with {event "Ürün gözden geçirme" 16:00}, suggested_slot 16:30, source mail 12:12}, follow_up}}; `remaining_events` {start, title, status_label computed: prep_ready / time_left "4 sa kaldı" / attendees 4}.
- **Interactions → production:**
  - Close / "Tamam" → dismiss and mark the midday briefing seen.
  - "16:30 Öner" → AI reply draft to Mehmet proposing 16:30 → approval `email_send`. If the user is the organizer, optionally add `calendar_update` as a second approval (§33).
  - "Seçenekleri Gör" → calendar conflict resolution / free-slot suggestions (PRIMARY 05 Plan; §20).
  - "Takip Mesajı Hazırla" → follow-up draft → approval.
  - "Toplantıda Sor" → add a talking point to the 14:30 Meeting Prep (`meeting_prep_notes` create) with a confirm toast and undo.
  - Timeline rows → event detail / Meeting Prep ("Hazır") / deadline source.
  - Push notification deep-links here (§96, §132).
- **States depicted:** 2 deltas.
- **States missing:** no-delta ("Her şey planlandığı gibi." single line; not drawn); Free gate (07/7.6); loading; offline; error; dark variant; a delta that became stale (e.g. already rescheduled).
- **Prototype-only / fake:** none in-file. The "4 sa kaldı" status must be computed live.
- **Maps to:** §10, §17, §20, §21, §33, §44, §96, §132.

### Akşam Kapanışı · 19:00 / Evening Close
- **Source:** PRIMARY / 03 / "3.6 Akşam Kapanışı · 19:00"
- **Purpose:** Close the day: completed, carry-over, follow-ups, tomorrow's first event, "Yarına Hazırım".
- **Layout:**
  - Header `gradient/dusk`, padding 0 20 56, text #fff; status "19:00"; back circle only (no share).
    - Kicker (margin-top 32) opacity .72; H 30/36 600 (number **not** accent-colored); sub 15/22 `rgba(255,255,255,.8)`.
  - Overlapping sheet: margin-top −28, #F5F4F0, radius 28, padding 26 20 120, gap 20.
  - 4 sections, each kicker plus grouped card (radius 18, padding 4 16). **ChecklistRow**s at padding 11 0:
    - Done: `check_circle` 22 FILL1 #2FA062; text 15 #6B6860 with line-through; trailing time 12 #9B978E.
    - Open: `radio_button_unchecked` 22 #C9C5BC; text 15/500; trailing badge or meta.
    - Follow-up: `schedule_send` 22 #6B6860.
  - **NextEventCard:** #1A1917, radius 20, padding 16. Time tile 48 radius 14 `rgba(255,255,255,.1)` showing "09" over "00" (11/600; hour 16); title 16/600; meta 13 `rgba(255,255,255,.65)`; trailing `alarm` 20 opacity .6.
  - Sticky primary CTA with `bedtime` 20, shadow `0 8px 24px rgba(91,92,226,.28)`.
- **Exact copy:**
  - "AKŞAM KAPANIŞI · 5 EYLÜL" · "Bugünden yarına 3 konu kaldı." · "4 konuyu kapattın. Yarın 09:00'da başlıyorsun."
  - "TAMAMLANANLAR · 4": "Ahmet'e revize teklif gönderildi 15:48" · "Mehmet ile müşteri toplantısı 14:30" · "Girişim programı başvurusu 16:20" · "Kargo teslim alındı 16:05"
  - "YARINA KALANLAR · 3": "Selin'e sözleşme yorumu" [badge "12:00" #FCEDE9/#C7432F] · "Mehmet'e teklif gönder" [meta "Taahhüt"] · "Elektrik faturası · 1.842 TL" [meta "10 Eyl"]
  - "TAKİP EDİLECEKLER · 2": "Mehmet · Teklif v2 geri bildirimi — 4. gün" · "Hukuk · Sözleşme yorumu — 15. gün"
  - "YARININ İLK ETKİNLİĞİ": "09 00" "Haftalık ekip" "60 dk · Ofis · 07:50'de çıkman yeterli"
  - CTA "Yarına Hazırım"
  - Note: "Alacakaranlık gradyanı sabahın tersi. "Yarına Hazırım" akşam bildirimlerini sessize alır ve sabah brifingini planlar."
- **Data fields:** `briefings` {type evening, completed[] {title, completed_at, source (sent-mail detection, calendar end, confirmation mail, shipment delivered)}, carry_over[] {entity_ref (insight | commitment | payment), title, due/badge}, follow_ups[] {counterparty, topic, days_waiting}, tomorrow_first_event {title, start, duration, location, leave_by?}}.
- **Interactions → production:**
  - Back → Today.
  - Open-item radio tap → mark done (optimistic, undo).
  - Done row tap → source.
  - Carry-over row tap → source / commitment detail.
  - Follow-up row → follow-up thread / draft.
  - NextEventCard → event detail. `alarm` → Alarm (see 3.2 platform note) or reminder.
  - **"Yarına Hazırım"** (§11: "→ confirmation → carry-over action") → confirmation sheet (**undrawn**):
    - List of the 3 carry-over items with per-item toggles (default on).
    - "Akşam bildirimlerini sabaha kadar sessize al" (quiet until the morning briefing time).
    - Morning briefing time echo "Sabah brifingin 08:00'de hazır olacak".
    - Confirm → server: roll over due dates / create next-day reminders (idempotent), set a quiet window, ensure the morning job is scheduled → success state (08 MOTION "Başarı") → Today hero "night" mode.
- **States depicted:** full evening close, light.
- **States missing:** confirmation sheet; success; already-confirmed state (button → "Yarına hazırsın ✓"); zero carry-over; no tomorrow event; dark variant (3.2 shows only the dark Today hero); loading; offline (confirm queued); Free gate (Evening is Pro, §44).
- **Prototype-only / fake:**
  - "07:50'de çıkman yeterli" needs location and travel time (not in scope). Hide unless real.
  - "Mehmet ile müşteri toplantısı" marked completed only because time passed; the completion semantics for meetings must be defined.
- **Maps to:** §11, §18, §17, §22, §29, §94, §96.

### Haftalık Özet · Editoryal / Weekly Review
- **Source:** PRIMARY / 03 / "3.7 Haftalık Özet · Editoryal"
- **Purpose:** Editorial weekly summary with stats, time saved, next-week outlook, and share.
- **Layout:**
  - bg `editorial/paper #FBFAF7`; status "18:00"; padding 14 24 120, gap 26.
  - ModalHeader: close circle plus center kicker (date range).
  - Title block: Lora italic 16 #6B6860; Lora 38/44 500 −.02em.
  - Lora paragraph 18/29 with **b** at weight 600.
  - **EditorialStatRow** list: top border `rgba(27,25,23,.12)`; rows padding 14 0, bottom border `rgba(27,25,23,.08)`; number Lora 34/36 500, min-width 84 (the "32" in #5B5CE2); label 15 #6B6860.
  - **HighlightCard:** #1A1917, radius 24, padding 22; kicker #A9AAF5; Lora 36/40; note 13/19 `rgba(255,255,255,.65)`.
  - Closing Lora paragraph 17/27.
  - Sticky primary CTA with `ios_share`; fade on #FBFAF7.
- **Exact copy:**
  - "1–7 EYLÜL" · "Haftalık özet" · "Haftan nasıl geçti?"
  - "Bu hafta **684** mail geldi. Bunların yalnızca **32**'si dikkatini gerektirdi; gerisini senin için okudum. Çarşamba en yoğun günündü: 6 toplantı, arada 20 dakika bile boşluk yoktu."
  - Stats: "684 mail analiz edildi" · "32 önemli konu öne çıkarıldı" · "21 toplantı, 14'üne hazırlık notu" · "8 takip, 6'sı cevaplandı" · "4 son tarih, hiçbiri kaçmadı"
  - "KAZANDIĞIN ZAMAN" · "2 saat 48 dakika" · "Okunmayan 652 mail, 14 hazırlık notu ve 6 takip taslağı üzerinden tahmin."
  - "Gelecek hafta: Salı 3 son tarih var, Perşembe öğleden sonra tamamen boş. Teklif hazırlamak için orayı öneriyorum."
  - CTA "Dijital Haftamı Paylaş"
  - Note: "Analytics değil, editoryal: Lora sayılar, satır aralı liste, tek koyu vurgu kartı. Sayfa Pazar 18:00'de hazır olur."
- **Data fields:**
  - `weekly_reviews` {period_start, period_end, mails_analyzed 684, important_count 32, meetings 21, prep_notes 14, followups 8, followups_answered 6, deadlines 4, deadlines_missed 0, busiest_day {weekday, meetings 6, max_gap_min <20}, time_saved_min 168, time_saved_basis {unread_skipped 652, prep_notes 14, followup_drafts 6}, next_week_outlook {deadlines_by_day, free_blocks[]}, narrative, generated_at (Sunday 18:00 local)}.
  - Inference: the numbers match **652 × 10 s + 14 × 3 min + 6 × 3 min ≈ 168.7 min ≈ 2 sa 48 dk**. The coefficients must be a documented, versioned formula (backoffice-visible §119).
- **Interactions → production:**
  - Close → Today.
  - "Dijital Haftamı Paylaş" → share-preview sheet (**undrawn**): choose 4:5 or 9:16 → render 3.8 offscreen → `react-native-view-shot` 6.0.1 `captureRef` (PNG) → native share (`expo-sharing` 57.0.21 `shareAsync`, or RN `Share`). Optionally append a referral link (§45); analytics `weekly_share` (§42).
  - The next-week suggestion should carry an action ("Perşembe'ye teklif bloğu planla" → approval `calendar_create`). Currently none, which is a missed CTA, not a dead one.
  - Entry points: Sunday 18:00 push, Today hero on Sunday, history list (**all undrawn**).
- **States depicted:** full week.
- **States missing:** first week / insufficient data (<7 days since onboarding); generating; failed; offline; dark variant; Free vs Pro (unspecified in §44).
- **Prototype-only / fake:** "hiçbiri kaçmadı" asserts an outcome the system cannot verify. Rephrase to a grounded claim (e.g. "hepsi zamanında öne çıkarıldı"), §83. "gerisini senin için okudum" is fine only if all 684 were processed.
- **Maps to:** §12, §42, §45, §80, §83, §111, §119.

### "Dijital Haftam" paylaşım kartı / Weekly share card (1080×1350)
- **Source:** PRIMARY / 03 / "3.8 "Dijital Haftam" paylaşım kartı · 1080×1350" (rendered at .3333 scale in a 360×450 preview, radius 16)
- **Purpose:** Privacy-safe social share image.
- **Layout:**
  - 1080×1350 `gradient/dawn`, padding 96, text #fff.
  - Logo row: tile 84 radius 26 #fff with `auto_awesome` 48 #5B5CE2 FILL1, plus "Dijital Asistan" 34/600.
  - Bottom-anchored content:
    - Kicker 30/600 .1em opacity .7.
    - Lora 96/104 −.03em headline.
    - Stats row (gap 64): Lora 80/84 numbers; labels 28 opacity .75.
    - Tagline 28 opacity .75 (margin-top 72).
- **Exact copy:**
  - "Dijital Asistan" · "DİJİTAL HAFTAM · 1–7 EYLÜL"
  - "684 maili okumadım.<br>Önemli 32'sini gördüm."
  - "21" toplantı · "8" takip · "2 sa 48 dk" kazandım
  - "Bugün bilmen gerekenleri, sen sormadan söyler."
  - Note: "Kişisel detay yok: isim, kişi, konu başlığı içermez. Sadece toplamlar ve kazanılan zaman. 1080×1350 (4:5) ve 1080×1920 (story) varyantı aynı kalıptan üretilir."
- **Data fields:** aggregates only, from `weekly_reviews`: period, mails_analyzed, important_count, meetings, followups, time_saved. **No PII** (§12, §42).
- **Interactions:** none on the card itself (it is an image). Generated client-side from the template.
- **States depicted:** 4:5 only.
- **States missing:** 9:16 story variant (stated, not drawn); long numbers (e.g. "1.284") overflowing Lora 96; localization (English copy length); fonts must be loaded before capture.
- **Prototype-only / fake:** none.
- **Maps to:** §12, §45, §74 (marketing assets), §42.

---

## 4. Implied but undrawn (needed for production; design in PRIMARY language)

| Item | Why needed | Suggested primary pattern |
|---|---|---|
| Sign-in (returning user) sheet/screen | 2.1 "Giriş yap" | 2.5 layout, title "Tekrar hoş geldin" |
| E-mail auth: address entry, OTP/magic-link sent, verify, errors | 2.5 "E-posta ile devam et" | 2.5 layout plus input field (01 components) |
| Integration account sheet (connected): e-mail, scopes, calendars, disconnect | 2.6 "Bağlandı" pill; §76 revoke | Bottom sheet (2.7 pattern) |
| Calendar picker ("2 takvim · Kişisel, İş") | 2.6 meta | Sheet with a ToggleListCard (2.13 pattern) |
| OAuth outcomes: cancelled, error, partial scope, admin consent | §76, §93 | 08 error card pattern |
| iOS calendar permission denied | §34 (8) | 08 `error/permission-denied` |
| Android device-calendar row / explainer | §75 | 2.7c with a "Cihaz takvimi" chip |
| Time-picker sheet | 2.9 note | Native picker in a bottom sheet |
| Pro-locked briefing rows (Free) | 2.9 note, §44 | `lock` icon plus 07/7.6 gate |
| **VIP onboarding step (ADIM 4/4?)** | §34 (11), §30 | PRIMARY 06 VIP list plus suggestion row "… ile son 30 günde 14 kez yazıştın. VIP yapayım mı?" |
| First analysis failure / timeout / partial / zero | §93 | 2.10 frame plus 08 error copy |
| Aha zero-findings | §83 | 2.11 frame |
| Notification denied / blocked → Settings | §35 | 2.12 frame, CTA "Ayarları Aç" |
| Android listener not granted / granted | §36 | 2.13 |
| Today hero modes (pre-brief, generating, midday, midday-empty, midday-Free, night-after-close, weekend, Sunday weekly, first-day) | 3.2 note, §8, §10 | 3.1 hero component variants |
| Today dark-morning, dark-empty, dark-skeleton | §38 | 3.2 tokens |
| Card sheets: correction, "Neden önemli?", reminder, snooze | §29, §31–32, §131 | 01 sheet; IA prototype `sheetDefs` |
| Toast plus undo | 08 MOTION | IA prototype toast |
| Audio mini-player; audio generating/failed/ended; native-TTS notice | §9 | 3.4 tokens |
| Evening audio variant ("Dinle · 1 dk") | 3.2 | 3.4 with evening chapters |
| "Yarına Hazırım" confirmation plus success | §11 | Bottom sheet plus 08 "Başarı" |
| Weekly share preview (4:5 / 9:16) plus story artwork | §12 | 3.8 |
| Weekly entry point on Today; briefing history | IA gap | Today section / list |
| Global search entry from Today | §95 | Header icon (SECONDARY has one) |
| Offline banner on Today and briefings | §94 | 08 `error/offline` |
| Demo-mode indicator | §89 | Small kicker chip "DEMO" |

---

## 5. SECONDARY vs PRIMARY: what SECONDARY has that PRIMARY lacks (IA/function only; restyle to PRIMARY)

### 5.1 `src/screens/onboarding/OnboardingFlow.tsx` (14 steps)
The step order is `welcome, noise, proactive, control, account, connect, permission, calendar-permission, preferences, personalization, vip, analysis, aha, notification`, then `navigate('today')`.

1. **VIP step** (`VIPScreen`). The only full VIP onboarding IA:
   - Title "Kimlerden gelen şeyleri asla kaçırmak istemezsin?"; sub "VIP kişilerin mesajları her zaman öne çıkar."
   - Multi-select list with initials avatars. Buttons "Atla" and "Devam (n)".
   - The contacts are hardcoded (`Mehmet Kaya`, `Ahmet Yılmaz`, `Fatma Şahin`, `Ayşe Demir`, `Can Öztürk`, `Anne / Baba`, `Yönetici`). **Fake.** Production candidates come from top correspondents in mail metadata plus manual search/add. VIP is Pro (§44), so the gate must be decided.
2. **Minimum-connection gating** in `ConnectScreen`: `hasMinimum` = ≥1 of gmail/outlook AND ≥1 of gcal/mcal/acal. Disabled CTA label "Mail ve takvim seç"; enabled "Devam". Sub "En az 1 mail + 1 takvim bağla." The row toggle simply flips `connected` locally (**fake integration**).
3. **Calendar permission-denied sub-state:**
   - "Takvim erişimi kapalı" / "Dilersen Ayarlar'dan daha sonra açabilirsin. Takvim olmadan da temel özellikler çalışır." / "Ayarları Aç" / "Şimdilik Atla".
   - "Ayarları Aç" calls `alert('Ayarlar açılıyor...')` (**fake**; production uses `Linking.openSettings()`).
4. **Gmail explainer 4th reason:** "Takip edilecek konuları bulmak". Alternative CTA "Güvenli şekilde bağla". Combined assurance "Sen onaylamadan mail göndermeyiz. Veriler reklamverenlerle paylaşılmaz."
5. **Control screen 4th assurance:** "Önemli işlemler onayın olmadan gerçekleşmez." CTA "Anladım".
6. **Preferences:** editable times with defaults morning **07:30** (PRIMARY 08:00, which wins), midday 13:00, evening 19:00. Weekend toggle "Hafta sonu brifing gönder", default **off** (PRIMARY on with 10:00). Title alternative "Günün ne zaman başlıyor?".
7. **Personalization:** "Hepsi" is **exclusive** (clears the others). PRIMARY's note says "Hepsi" auto-checks all, and PRIMARY wins. "Devam" is disabled when 0 selected, which is useful IA.
8. **Analysis** step texts: "Son 72 saat taranıyor…", "E-postalar sınıflandırılıyor…", "Takvim kontrol ediliyor…", "Açık konular aranıyor…", "Neredeyse bitti…". Uses 1s `setTimeout` steps and auto-advances after 1.2s (**fake loading**; do not copy).
9. **Aha** priority taxonomy: KRİTİK / YAKLAŞAN / SON TARİH / BİLGİ, each card with a source line, 5 full cards (including the flight "TK2412 uçuşun yarın 09:15'de."). PRIMARY's taxonomy is ACİL / TOPLANTI / SON TARİH / TAKİP / KİŞİSEL, and PRIMARY wins.
10. **Notification examples** (4): "Bugün bilmen gereken 5 şey var.", "Ahmet senden bugün 17:00'ye kadar dönüş bekliyor.", "14:30 toplantına 20 dakika kaldı.", "Kargon bugün geliyor." Both "Bildirimleri Aç" and "Şimdi Değil" navigate to Today without requesting permission (**fake / dead**).
11. **Segmented 14-step progress bar** (`ProgressBar`, 3px segments #5B5CE2 / #E8E8F0). PRIMARY uses "ADIM n / 4" and wins, but SECONDARY shows that a progress indicator exists across the whole flow.
12. Legal line on Welcome: "Devam ederek Gizlilik Politikası'nı kabul etmiş olursunuz." PRIMARY puts the legal line on Account (2.5), and PRIMARY wins.
13. **Splash** (`SplashScreen.tsx`): 2.2s timer to onboarding (**fake**). Production uses the native splash plus auth-state routing.

### 5.2 `src/screens/today/TodayScreen.tsx`
1. **Search button** in the header → `navigate('search')` (§95). PRIMARY Today has no search entry.
2. **Approval button with numeric badge** (⭐ plus red count). PRIMARY's "2 onay" chip covers this.
3. **"Programın" section:** list of today's meetings with a countdown chip (`minutesLeft` "18dk"), each → Meeting Prep. PRIMARY only has a single TOPLANTI priority card.
4. **"Dijital Hayatın" Life Intelligence carousel** (horizontal cards: cargo, flight, payment, subscription, reservation, security) with a **detail bottom sheet** per type:
   - cargo: "Kargo No…", "Tahmini teslim…", "Son konum…"
   - flight: "Kalkış… Terminal 1", "Koltuk: 14A"
   - reservation: "Rezervasyon No…"
   - subscription: "Plan…", "Kart: ····4821"
   - security: "Şifre değişikliği girişimi"
   - payment → Smart Reminder sheet.

   §8 requires Life Intelligence on Today; PRIMARY only has the KİŞİSEL card. Note: the SECONDARY detail values are **fabricated mock** and must be source-extracted only (§23).
5. **Midday and Evening shortcut buttons:** "Gün Ortası · 13:00 brifing", "Akşam Kapanış · 19:00 özet". PRIMARY relies on the time-based hero, so explicit entry and history are missing.
6. **Weekly report teaser:** "Haftalık Raporun Hazır · 684 mail analiz edildi · 2 sa 48 dk kazandırıldı" → weekly-report.
7. **InsightCard** (`components/cards/InsightCard.tsx`):
   - "Neden önemli?" link → bottom sheet with `whyImportant` text and an "Önemli değil" button (§131).
   - 👍/👎 feedback (§59).
   - "Tamamlandı" action that dismisses (local only).
   - Examples of `whyImportant`: "Bu mailde bugün saat 17:00'ye kadar cevap istendiği için önemli olarak işaretlendi.", "Mail içeriğinde "son başvuru tarihi" ifadesi tespit edildi.", "VIP kişilerden gelen mesaj."
8. **SmartReminderSheet** (`components/ui/SmartReminderSheet.tsx`): "Hatırlatıcı" / "NE ZAMAN HATIRLATAYIM?" with options "30 dakika sonra", "1 saat sonra", "Bu akşam · 19:00", "Yarın sabah · 08:00", "Uygun zamanda" (+ "✨ Takvimindeki boşluklara göre uygun zamanı Dijital Asistan seçer."), "Kendin seç" (+ date and time inputs "TARİH VE SAAT SEÇ"). Confirmation "Hatırlatıcı Oluşturuldu" is a **fake success** via `setTimeout(1400)`.
9. Hero mini-stats including a 4th metric "1 son tarih" (PRIMARY explicitly says no KPI boxes, so do not copy).

### 5.3 `src/screens/today/MorningBriefing.tsx`
1. **Inline audio player** inside the briefing page (speed chip 1/1.25/1.5, tap-to-seek bar, ±15). PRIMARY separates this into 3.4, and PRIMARY wins. SECONDARY's ±15 actually moves ±10% (**fake**) and progress is `setInterval`-driven (**fake**).
2. **Section counts** per section (badge with a number). PRIMARY lists items directly; counts could be added to the kicker (e.g. "SON TARİHLER · 2"), matching the 3.6 kicker pattern.
3. Section naming: "Cevap Bekleyenler", "Senden Beklenenler", "Kişisel Hatırlatmalar". PRIMARY: "SENDEN CEVAP BEKLEYENLER", "SENİN CEVAP BEKLEDİKLERİN", "KİŞİSEL GELİŞMELER". §9: "Senden Beklenenler", "Senin Beklediklerin", "Kişisel Gelişmeler". Align i18n to PRIMARY/§9.

### 5.4 `src/screens/today/MiddayPulse.tsx`
1. Reschedule-request action set: "Kabul Et / Reddet / Müzakere Et" (**dead buttons**; IA shows the accept/decline intent). Follow-up actions "Hatırlat / Yanıt Yaz".
2. Footer microcopy "Sonraki brifing saat 19:00'da" plus "Bugüne Dön". The next-briefing line is useful and PRIMARY lacks it.
3. Time label "Öğleden sonra · 13:15".

### 5.5 `src/screens/today/EveningClose.tsx`
1. **Per-item carry-over control:** "Yarına taşı" → "✓ Taşındı". This directly supports §11 "carry-over action", which PRIMARY lacks at the item level.
2. "YARIN SABAH" block listing multiple morning items ("10:00 Proje kickoff · Can Öztürk", "TK2412 uçuşu · İstanbul → Antalya 09:15").
3. "TAKİP ETMEN GEREKENLER" with person initials and days.
4. CTA "Yarına Hazırım ✓" has **no onClick** (dead). Header title "Günü Kapat". Typo in the section label "YARINALANLAR" (do not copy).

### 5.6 `src/screens/marketing/WeeklyReport.tsx` (routed as `weekly-report`)
1. Stats: "takip hatırlatıldı", "toplantı takip edildi", "deadline yakalandı" (mixed EN/TR; use PRIMARY copy).
2. **"EN YOĞUN GÜNÜN"** card ("14 mail, 5 toplantı, 3 son tarih"). PRIMARY folds this into the narrative ("Çarşamba en yoğun günündü").
3. **"EN ÇOK İLETİŞİMDE OLDUĞUN KİŞİLER"** (top contacts with relative bars). This is in-app only and must never go on the share card.
4. In-page share card preview with "Paylaş" (**dead button**, no handler).
5. Date "1–7 Eylül 2025" (year inconsistent with PRIMARY's 2026 calendar, since 5 Eylül Cumartesi = 2026).

### 5.7 Prototype-only behaviours in SECONDARY to flag (never copy)
- Timers: Splash timer; Analysis step timers.
- Fake success: SmartReminder confirm; `alert('Ayarlar açılıyor...')`.
- Fake integrations: Connect toggles with no OAuth; notification buttons that don't request permission.
- Dead buttons: Midday action buttons, Evening CTA, Weekly "Paylaş".
- Local-only state: InsightCard dismiss / feedback.
- Fake audio: `setInterval` progress.
- Hard-coded mock detail data: cargo numbers, seat 14A, card ····4821.

---

## Reusable components observed

| Component | Anatomy / variants | Props implied | Exact styling |
|---|---|---|---|
| **Button** | primary · ink · inverse (on gradient) · tonal · neutral-tonal · text · dark-primary · dark-tonal. Sizes L 52 / M 48 / S 40 / XS 38. Optional leading icon. | `variant, size, label, icon?, loading?, disabled?, onPress` | primary #5B5CE2 / #fff; ink #1A1917 / #fff; inverse #fff / #25266A; tonal #EDEDFC / #4547C9; neutral #F0EFEB / #6B6860; text: no bg, #6B6860 14/600, 44h, radius 14. dark-primary #8586F2 / #0F0F2A; dark-tonal `rgba(133,134,242,.16)` / #C3C4F8. L 52h radius 16 15/600; M 48h radius 14 (tonal 14/600); S 40h radius 12 14/600; XS 38h radius 12 13/600. Pressed #4B4CCB. Sticky CTA shadows: ink `0 8px 24px rgba(27,25,23,.18)`, primary `0 8px 24px rgba(91,92,226,.28)`. |
| **InlineCardAction** | text-only row actions (max 2) | `primary, secondary?` | 14/600, gap 14, padding 8 0; primary #4547C9 (dark #A9AAF5); secondary #6B6860 (dark #A39F96) |
| **IconButton (circle)** | on light / on gradient | `icon, onPress, a11yLabel` | 36×36 circle; light #fff + `0 1px 2px rgba(27,25,23,.08)`; on gradient `rgba(255,255,255,.16)` (audio `.14`); icon 20 |
| **AuthProviderButton** | google · apple · microsoft · email | `provider, onPress, loading` | 52h radius 16 15/600 gap 10. Google ink; others #fff with shadow; email text #4547C9. Official brand assets required. |
| **LabeledDivider** | "veya" | `label` | 1px `rgba(27,25,23,.1)` lines, label 12 #9B978E, margin 6 0 |
| **PageDots** | light / on-gradient | `count, index` | active 20×6 radius 3 (#1A1917 or #fff); inactive 6×6 (#C9C5BC or `rgba(255,255,255,.4)`); gap 6 |
| **StepHeader** | back + "ADIM n / N" + trailing (spacer or "Atla") | `step, total, onBack, onSkip?` | kicker 12/600 .08em #9B978E; "Atla" 14/600 #6B6860 |
| **IntroPage** | illustration slot + accent + title + body | `accent, title, body, illustration` | accent 15/600 #5B5CE2; title 32/38 600 −.025em; body 16/24 #6B6860; gap 34 |
| **IntegrationRow** | provider tile + name + meta + StatusPill | `provider, name, meta, status` | card padding 12 14 radius 18 #fff, shadow `0 1px 2px rgba(27,25,23,.04),0 6px 20px rgba(27,25,23,.05)`; tile 44 radius 14; name 15/600; meta 12 #9B978E |
| **StatusPill** | Bağla / Bağlandı (+ connecting, error, expired needed) | `status` | 34h radius 999 padding 0 12 13/600, icon 16; connect #EDEDFC / #4547C9 `add`; connected #E4F5EA / #1E7A47 `check` |
| **TrustLine** | icon + text | `text` | `verified_user` 18 #1E7A47; 13 #6B6860 |
| **BottomSheet** | scrim + grabber + content | `open, onClose, title?` | scrim `rgba(27,25,23,.35)`; sheet #fff radius 28 28 0 0, padding 10 24 44, shadow `0 -10px 40px rgba(27,25,23,.12)`; grabber 36×5 radius 3 #E0DED7, margin-bottom 18. Motion (08): open 300ms, close 240ms, dim 250ms, light haptic |
| **PermissionExplainer** | ProviderTile + kicker + title + ReasonRow[] + AssuranceBox + CTA + "Şimdi değil" + footnote (+ ProviderChips) | `provider, reasons[], assurances[], ctaLabel, onConnect, onLater` | title 20/600 −.02em; footnote 12 #9B978E |
| **ProviderTile** | tinted square icon | `icon, tone` | 44 radius 14, icon 22; tones Gmail #FCEDE9/#C7432F, Microsoft #E7F0FD/#2262BE, Calendar #E4F5EA/#1E7A47, Apple #F0EFEB/#6B6860 |
| **ReasonRow** | icon + text | `icon, text` | bg #F5F4F0 radius 14 padding 12 14 (calendar 11 14), icon 20 #5B5CE2, text 15 |
| **AssuranceBox** | rows of icon + text; first row bold | `items[]` | bg #E4F5EA radius 18 padding 16 gap 10; text #1E5A36 14/20; icons #1E7A47 20 |
| **ChoiceChip** | selected / unselected | `label, selected` | 30h radius 999 padding 0 10 12/600; selected #1A1917 / #fff + `check` 14; unselected #F5F4F0 / #6B6860 |
| **SelectableTile** | 2-col grid tile | `icon, label, selected` | 88h radius 18 padding 14; selected #1A1917 / #fff / icon #A9AAF5 / check #fff; unselected #fff + card shadow, icon #5B5CE2; `check_circle` 20 FILL1 at 12,12 |
| **SettingRow** | tile + title + meta + trailing (TimeChip / Switch / lock) | `icon, title, meta, trailing, locked?` | padding 14 16 radius 18 #fff + card shadow; tile 44 radius 14 (#EDEDFC/#5B5CE2 highlight or #F0EFEB/#6B6860) |
| **TimeChip** | | `time, onPress` | 36h radius 12 padding 0 12 bg #F5F4F0 17/600 −.01em |
| **Switch** | on / off | `value` | 50×30 radius 15; on #5B5CE2, off #D9D6D0; knob 26 #fff, shadow `0 1px 3px rgba(0,0,0,.2)`, inset 2 |
| **AIHint** | | `text` | `psychology` 18 #5B5CE2 + 13/19 #6B6860, padding 0 4 |
| **ProgressChecklist** | done · active · pending rows | `steps[] {label, state, count}` | 15px text gap 12; done `check_circle` 22 FILL1 #A9F0C1; active spinner 22 (2px `rgba(255,255,255,.3)`, top #fff, .9s); pending ring 22 2px `rgba(255,255,255,.4)`, row opacity .4 |
| **PulsingRing** | analysis loader | `size=132` | outer 3px `rgba(255,255,255,.15)` + #fff arc 1.4s; inner inset 14, 2px `rgba(255,255,255,.6)` arc 2.2s reverse; center icon 44 FILL1 |
| **FindingsPanel** (on gradient) | badge + text rows + overflow | `items[], more` | bg `rgba(255,255,255,.1)` radius 20 padding 6 16; rows padding 10 0; separators `rgba(255,255,255,.1)`; 14px |
| **NotificationPreview** | mock push | `title, time, body` | padding 14 radius 20, bg `rgba(255,255,255,.7)` blur 20, shadow `0 8px 24px rgba(27,25,23,.08)`; app tile 38 radius 11 #5B5CE2 |
| **ToggleListCard** | grouped rows with switches | `rows[] {icon, name, meta, on}` | card radius 18 padding 4 16; row padding 10 0; tile 36 radius 11 #F0EFEB/#6B6860; divider `rgba(27,25,23,.06)` |
| **Badge** | tones critical · warning · neutral · info · on-gradient; sizes M (11/700 padding 3 8) and S (10/700 padding 2 6); dark variants | `label, tone, size` | radius 999, letter-spacing .05em. Light: critical #FCEDE9/#C7432F; warning #FDF2DC/#9A6300; neutral #F0EFEB/#6B6860; info #E7F0FD/#2262BE; on-gradient `rgba(255,255,255,.15)`/#fff. Dark: critical `rgba(224,85,63,.18)`/#F08B78; neutral `rgba(255,255,255,.08)`/#A39F96 |
| **TodayHeader** | date kicker + greeting + ApprovalChip + Avatar | `date, greeting, name, pendingCount` | kicker 12/600 .08em #9B978E; H1 28/34 600 |
| **ApprovalChip** | hidden at 0 | `count, onPress` | 34h radius 999 padding 0 12 0 9, #fff, #4547C9 12/600, `task_alt` 18, shadow `0 1px 2px rgba(27,25,23,.06)` |
| **Avatar** | initial | `name, image?` | 40 circle; light #1A1917/#fff; dark #F2F0EB/#141311; 15/600 |
| **BriefingHero** | modes morning · midday · evening · pro-gate · empty · generating | `kicker, count, sentence, context, primaryCta, listenCta{duration}` | light `radial-gradient(140% 100% at 100% 0%,#E4E4FA 0%,#FFFFFF 58%)`, radius 28, padding 22 22 20, shadow `0 1px 2px rgba(27,25,23,.04),0 12px 32px rgba(91,92,226,.10)`; dark `radial-gradient(140% 100% at 100% 0%,rgba(133,134,242,.28) 0%,#1F1E1B 60%)` + 1px `rgba(255,255,255,.06)`; kicker 12/600 .06em #5B5CE2 (dark #A9AAF5); sentence 26/32 600 with accent number |
| **SectionHeader** | kicker + count | `title, count?` | 12/600 .08em #9B978E; count 12 #9B978E; padding 4 4 0 |
| **PriorityCard** | badge + time + [done, more] + title + sub? + source + ≤2 actions | `item, onDone, onMore, onOpen, onAction(i)` | #fff radius 20 padding 14 16 10, shadow `0 1px 2px rgba(27,25,23,.04),0 6px 20px rgba(27,25,23,.05)`; icons 22 #B8B4AA (dark #5E5B54); title 17/23 600; sub 14/20 #6B6860; source 12 #9B978E with icon 16. Motion: done 160/300/300ms; swipe 35% threshold |
| **DeltaCard** (Midday) | badge + title + sub + source + ButtonPair or InlineActions | same as PriorityCard | padding 16 radius 20; S buttons 40h radius 12 |
| **BottomTabBar** | 4 tabs | `active` | 90h, padding 8 8 28, bg `rgba(255,255,255,.92)` blur 20, top `rgba(27,25,23,.06)`; icon 26; label 11/500; active #5B5CE2 FILL1 (dark #A9AAF5); inactive #9B978E (dark #7A776F; bar `rgba(20,19,17,.92)`) |
| **GradientHeader + OverlappingSheet** | dawn · dusk (· night) | `gradient, kicker, title, sub, leftAction, rightAction?` | header padding 0 20 60 (dusk 56); kicker margin-top 36 (dusk 32); title 32/38 (dusk 30/36); sheet margin-top −28, radius 28 28 0 0, padding 26 20 120 |
| **EditorialParagraph** | | `text` | Lora 18/29 (weekly close 17/27) |
| **GroupedListCard + ListRow** | icon tile + title + meta + chevron | `rows[]` | card radius 18 padding 4 16; row padding 11 0; tile 30 radius 10 #F0EFEB/#6B6860 icon 17; title 15/20 500; meta 12 #9B978E; chevron 18 #C9C5BC; divider `rgba(27,25,23,.06)` (dark `rgba(255,255,255,.06)`) |
| **ProvenanceFooter** | | `mailCount, calendarCount, days, generatedAt` | `verified` 16 + 12 #9B978E |
| **StickyBottomCTA** | fade container | `children` | padding 16 20 44; `linear-gradient(180deg, rgba(bg,0) 0%, bg 45%)` |
| **AudioPlayer set** | Waveform · ProgressBar · TimeLabels · SkipButton(±15) · PlayPause(76) · SpeedChip · ChapterRow | `player state` | waveform 34×4px bars gap 5 h 72; track 4px radius 2 `rgba(255,255,255,.1x)` fill #fff; play 76 #fff / #25266A icon 40; skip icon 30 + "15" 10/600; chapter row padding 11 4, index 12 `rgba(255,255,255,.6)`, inactive opacity .55, active `graphic_eq` |
| **ModalHeader** | close + centered kicker | `title, onClose` | close circle 36 #fff + shadow |
| **TimelineRow** | time + title + status | `time, title, status, statusTone` | time 44w 13/600 #6B6860; title 15/500; status 12/600 (#4547C9 / #9A6300 / #9B978E) |
| **ChecklistRow** | done · open · follow-up | `state, title, trailing` | icon 22: done #2FA062 FILL1 + line-through #6B6860; open #C9C5BC; follow-up #6B6860 `schedule_send` |
| **NextEventCard** | time tile + title + meta + action icon | `event` | #1A1917 radius 20 padding 16; tile 48 radius 14 `rgba(255,255,255,.1)`; title 16/600; meta 13 `rgba(255,255,255,.65)` |
| **EditorialStatRow** | Lora number + label | `value, label, accent?` | Lora 34/36 500 min-width 84; label 15 #6B6860; borders `.12` top, `.08` rows |
| **HighlightCard** (dark) | kicker + Lora figure + basis note | `kicker, value, note` | #1A1917 radius 24 padding 22; kicker #A9AAF5; Lora 36/40; note 13/19 `rgba(255,255,255,.65)` |
| **ShareCardTemplate** | 4:5 (1080×1350) · 9:16 (1080×1920) | `aggregates` | dawn gradient, padding 96; Lora 96/104 headline; stat numbers Lora 80/84; labels 28 opacity .75 |

---

## Implementation facts relevant to these screens (verified via npm registry, 2026-09-23)

- **Package versions (npm latest):**

  | Package | Version |
  |---|---|
  | `expo` | 57.0.24 |
  | `expo-audio` | 57.0.5 |
  | `expo-speech` | 57.0.3 |
  | `expo-notifications` | 57.0.20 |
  | `expo-apple-authentication` | 57.0.2 |
  | `expo-auth-session` | 57.0.12 |
  | `expo-web-browser` | 57.0.3 |
  | `expo-calendar` | 57.0.4 |
  | `expo-haptics` | 57.0.3 |
  | `expo-sharing` | 57.0.21 |
  | `expo-intent-launcher` | 57.0.1 |
  | `expo-font` | 57.0.4 |
  | `expo-linking` | 57.0.10 |
  | `react-native-view-shot` | 6.0.1 |
  | `@react-native-community/datetimepicker` | 9.2.1 |
  | `react-native-reanimated` | 4.7.0 |
  | `react-native-svg` | 15.15.5 |
  | `react-native-track-player` | 4.1.2 (alternative to expo-audio if CarPlay is pursued) |
  | `@expo-google-fonts/geist` | 0.4.2 |
  | `@expo-google-fonts/lora` | 0.4.2 |
  | `@material-symbols/svg-400` | 0.47.5 |
  | `@material-symbols/font-400` | 0.47.5 |

- **`expo-audio` type definitions:** `seekTo(seconds)`, `setPlaybackRate(rate, pitchCorrectionQuality?)`, `setActiveForLockScreen(active, metadata?, options?)`, `updateLockScreenMetadata`, `clearLockScreenControls`. `AudioLockScreenOptions = {showSeekForward?, showSeekBackward?, isLiveStream?}`. Lock-screen controls require `interruptionMode: 'doNotMix'`. On Android, without lock-screen controls background audio stops after about 3 minutes.
- **`expo-speech`:** `speak`, `stop`, `pause` / `resume` ("not available on Android"), `maxSpeechInputLength`, options `language`, `rate`, `pitch`, `voice`, `onBoundary`. There is no seek.
- **`expo-intent-launcher`:** `ActivityAction.NOTIFICATION_LISTENER_SETTINGS = "android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"`; also `NOTIFICATION_LISTENER_DETAIL_SETTINGS` and `APP_NOTIFICATION_SETTINGS`.
- **`expo-notifications`:** supports `ios.allowProvisional` and `IosAuthorizationStatus.PROVISIONAL (3)`.
- **Icons:**
  - Material Symbols in `@material-symbols/svg-400` 0.47.5 have **no `auto_awesome.svg` or `expand_more.svg`**. The canonical files are `star_shine(.svg / -fill.svg)` and `keyboard_arrow_down`. Every other icon used in 02/03 exists in `rounded/` with `-fill` variants.
  - `@material-symbols/font-400` ships **woff2 only**, which React Native iOS cannot load. React Native also has no style prop for variable-font axes (FILL). Use SVG components with outline/fill pairs.
- **Fonts:** Geist is variable 300–700 in the design. `@expo-google-fonts/geist` provides static weights (use 400/500/600/700).

---

## Open issues / inconsistencies

### Within PRIMARY 02 (onboarding)
1. **VIP step missing** (§34 #11), and **"ADIM 4 / 4" never drawn.** The step counter implies a 4th post-account step. The canvas description omits VIP entirely.
2. **The 2.10 footer claim is false** vs the architecture: "Mail içerikleri cihazında özetlenir, hiçbir şey gönderilmez." The actual design has server-side tokens and AI (§76, §80, §81). This violates §40 (messages must match the real architecture). Must rewrite.
3. **The 2.9 AI hint is fabricated:** "Takvimine göre: genelde 08:15'te telefonu açıyorsun." The app has no device-usage data, "Takvimine göre" is contradictory, and it appears before any history exists (§83, §141).
4. **Data shown before it exists:** 2.6 meta "3 gün analiz edildi" appears before First Analysis; 2.3 shows "Günaydın Yunus" before account creation.
5. **2.11 CTA "Brifingimi Gör" leads to 2.12** (notification explainer) per the flow. Decide: (a) 2.11 → 2.12 → 3.3, with the CTA label kept, or (b) 2.11 → 3.3 with the 2.12 pre-prompt shown as a sheet over the first briefing. The 2.12 note ("Daha sonra ilk brifing ekranında tekrar") supports (a).
6. **Pro gating is undrawn in onboarding for Pro features:**
   - Midday / Evening rows (2.9 note says locked).
   - "hazırlık hazır" Meeting Prep (2.11).
   - The 2.12 example "Mehmet için 3 konu hazır".
   - Android Notification Intelligence (2.13).
   - A second mail/calendar (2.6).
   - VIP (§44 lists VIP as Pro).
7. **Minimum connection rule is ambiguous.** "En az bir mail ve bir takvim yeterli" plus "Şimdi değil" on each explainer, but there is no disabled CTA state. SECONDARY hard-gates (≥1 mail AND ≥1 calendar). Decide: hard gate vs allow ≥1 source (First Analysis must handle mail-only or calendar-only).
8. **2.5 drawn order is Google-first,** which is the Android order. The iOS order (Apple first) is not drawn. Also: is Apple offered on Android (web flow)?
9. **Apple Takvim appears on Android** in the 2.6 list. Android needs "Cihaz takvimi" (§75).
10. **The 2.10 window "Son 72 saat · Gmail ve Google Takvim"** is wrong for the calendar, which needs upcoming events rather than past ones. Define: past 72h mail plus today/next 48h calendar.
11. **Tokens used but not in the 01 token list:**
    - Success text #1E5A36 (assurance box), check #A9F0C1 (2.10), accent number #C9C9FF (2.11), inverse CTA text #25266A (not `ink`).
    - Grabber #E0DED7, dot inactive #C9C5BC, switch off #D9D6D0, dark tonal text #C3C4F8, dark icon #5E5B54, hero radial #E4E4FA.
    - These must be added as named tokens.
12. **Badge size drift:** 10/700 padding 2 6 (onboarding) vs 11/700 padding 3 8 (Today). Define S and M variants.
13. **2.13 vs §36:**
    - §36 requires a choice between "all selected apps / selected apps" and default exclusion of sensitive authentication apps. The design has category toggles only and no auth-app exclusion row.
    - Bank notifications carry OTPs, so a filtering disclosure is needed.
    - "cihazda işlenir" commits to on-device extraction.
14. **2.12 "Günde ortalama 3 bildirim"** needs enforcement (§132 budget) or removal.
15. **Legal compliance risk:** Gmail `gmail.readonly` is a Google **restricted scope**, requiring OAuth verification plus an annual third-party security assessment (CASA) before public launch. Until then the Google "unverified app" screen appears (100-user cap). This must go into the external credential matrix (§149) and launch plan.

### Within PRIMARY 03 (Today and briefings)
16. **Timeline contradiction:** the Today card and briefing include Ahmet's mail at **08:42**, but the briefing was generated at **07:58** ("BRİFİNG HAZIR · 07:58"; footer "· 07:58"). Define: Today priorities are live; the briefing is a snapshot or regenerates. Display "Güncellendi HH:MM" if re-generated.
17. **Weekend inconsistency:** 5 Eylül 2026 is a **Saturday** ("CUMARTESİ"), but the morning briefing is at 07:58 with work meetings. 2.9 sets weekend "Sadece sabah, 10:00 · Kişisel öncelikli", while Midday (13:00) and Evening (19:00) exist on the same Saturday. Evening says "Yarın 09:00 Haftalık ekip" on a **Sunday**.
18. **Evening conflicts:**
    - 3.2 carry-over items (Selin, Mehmet commitment, **TK2412 flight**) differ from 3.6 carry-over (Selin, Mehmet, **Elektrik faturası**), both claiming "3 konu".
    - Tomorrow has both the "Haftalık ekip 09:00 · Ofis · 07:50'de çıkman yeterli" (3.6) and flight TK2412 at 09:15 with "06:45'te evden çıkman gerekebilir" (3.2). Both are physically impossible together.
19. **Weekly period:** "1–7 EYLÜL" with "Pazar 18:00". In 2026, 1 Eylül is Tuesday and 7 Eylül is Monday, so a Sunday 18:00 report cannot include Monday 7th. Use Monday–Sunday ISO weeks (e.g. "31 Ağustos – 6 Eylül"). SECONDARY uses 2025.
20. **Count semantics undefined:**
    - Hero "5 şey" vs context "3 önemli mail · 4 etkinlik · 2 takip" (9 objects).
    - "2 takip" vs one row in "SENİN CEVAP BEKLEDİKLERİN" (and 2.10 "2 takip").
    - "4 etkinlik" vs PROGRAMIN containing a deadline and a restaurant reservation.
    - Define counting rules server-side (§116 consistency).
21. **Hero accent rule broken in 3.6** ("Bugünden yarına 3 konu kaldı." has the number uncolored), while the intro rule and 3.2 color it.
22. **Greeting punctuation:** "Günaydın, Yunus" (Today) vs "Günaydın Yunus" (briefing, intro 2.3). Pick one via i18n.
23. **Briefing hero line** "Bugün oldukça sakin bir günün var." contradicts the content (1 urgent, 1 deadline, 4 events). Generated tone must be data-derived.
24. **Audio chapters (6)** are "Genel bakış, Bugünün öncelikleri, Programın, Cevap bekleyenler, Son tarihler, Kişisel gelişmeler". Visual sections (6) split "Senden cevap bekleyenler" / "Senin cevap bekledikleri" and have no "Genel bakış". Chapter 02's duration is hidden in 03 (0:32 in the IA prototype).
25. **Selin's mail time:** "3 saattir bekliyor" at 08:02 (≈05:00) vs "Gmail · Selin Kaya · 15:40" in 3.2.
26. **Midday "GÜNÜN GERİ KALANI"** omits "16:00 Ürün gözden geçirme", which appears in PROGRAMIN and is referenced by the conflict card itself.
27. **Share on the Morning Briefing** (`ios_share` in 3.3) conflicts with the privacy-safe sharing philosophy (§12 share card has "Kişisel detay yok"). Define what is shared or remove the button.
28. **"Alarm Kur", "Check-in", "Takip Et", "07:50'de / 06:45'te çıkman"** depend on platform or unavailable data (alarms: iOS AlarmKit 26+ only; travel time needs location, not in scope; tracking and check-in URLs must exist in the source). Show only when real (§91, §99, §23).
29. **Reminder preset copy:** IA prototype "Özel zaman" vs §29 "Kendin seç" (SECONDARY uses "Kendin seç"). IA prototype "Yarın Hatırlat" → 09:00 vs morning default 08:00.
30. **Weekly "4 son tarih, hiçbiri kaçmadı"** is an unverifiable outcome claim (§83). The time-saved formula is implicit (≈10 s per skipped mail + 3 min per prep note + 3 min per draft reproduces 2 sa 48 dk). It must be documented and versioned.
31. **Free/Pro on Today:** "Dinle · 2 dk" (Voice Briefing is Pro, §44), "Hazırlan" (Meeting Prep, Pro), "Takip Mesajı Hazırla" (Follow-Up, Pro), Evening hero (Pro). Gates are only designed for Midday (07/7.6). "7 gün ücretsiz dene" is allowed only if the store product actually has a trial (§43).
32. **Today IA gaps vs §8:**
    - No explicit Life Intelligence section (only one KİŞİSEL card; SECONDARY has a carousel).
    - No "AI insight cards" type distinct from priorities.
    - No search entry (§95).
    - No Weekly/Midday/Evening entry or history.
    - No "Neden önemli?" affordance on the card surface (§131). It must live in the `more_horiz` sheet at minimum.
33. **Empty-state copy has two versions:** 08 `empty/today` ("Bugün dikkat gerektiren yeni bir konu yok. 46 maili senin için okudum." / "Akışa göz at") vs the IA prototype ("Yeni bir şey olursa haber veririm. Öğle brifingi 13:00'te."). Choose one; mention of the midday briefing must depend on entitlement.
34. **Dark mode coverage is partial:** only Today-evening and Morning Briefing have dark artboards. Audio (gradient, both modes), Midday, Evening, Weekly, all onboarding light screens, sheets and states lack dark specs. Weekly `editorial/paper #FBFAF7` has no dark token.
35. **The `auto_awesome` icon name** is absent from `@material-symbols/svg-400` 0.47.5 (canonical `star_shine`); `expand_more` maps to `keyboard_arrow_down`. The icon mapping table must alias these.

### vs MASTER_PROMPT (summary)
- **§34:** Steps 11 (VIP) is missing, 8 (Permissions) is partial, and 5 (Account e-mail path) is partial.
- **§11:** "Yarına Hazırım → confirmation → carry-over action" is described only as a note. The confirmation and per-item carry-over UI are undrawn (SECONDARY has per-item "Yarına taşı").
- **§12:** Native share and the story variant are undrawn.
- **§9:** "Native TTS fallback" cannot provide seek/±15 or Android pause, so a degraded-UI spec is required (§91 doc).
- **§93:** loading, empty, error, offline, retry, reconnect and partial states for Today and the briefings exist only in file 08 (Today) or not at all (briefings, midday, evening, weekly, audio, onboarding analysis).
- **§99:** every illustrated button inside intro artboards (2.3 "Brifingi Dinle", 2.4 "Onayla/Düzenle/Reddet") must be non-interactive.
- **§40:** privacy copy in 2.10 and 2.13 must match the real processing location.

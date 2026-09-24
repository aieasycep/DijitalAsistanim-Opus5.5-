# Dijital Asistan — Design Audit (`docs/DESIGN_AUDIT.md`)

> **Status:** Plan Mode deliverable, binding for execution. Produced 2026-09-23.
> **Scope:** the visual system, the shared UI kit contract, a screen-level comparison of both design archives, contradictions and their resolutions, prototype fakes that must not be copied, the deviation log, and the asset/token pipeline.
> **Binding inputs:** MASTER_PROMPT (cited as `M§n`) and the canonical master plan (ADR-01..15, §5 enums/tables, §5b `api` routes, §9 mobile routes, §10 backoffice routes, §11 web routes), together with its §23b reconciliation rulings R-01…R-25 and the R-20 per-artefact precedence.
> **Satisfies:** M§4, M§92, M§93, M§122, M§123, M§124, M§144 (and REQ-DES-01..13).

---

## 1. Sources, conflict rule, method

### 1.1 Notation used in this document

| Notation | Meaning |
|---|---|
| `M§n` | MASTER_PROMPT section *n* (binding for functional behaviour). |
| `P:01` … `P:09` | PRIMARY archive canvases `01 Tasarim Sistemi.dc.html` … `09 Pazarlama.dc.html`. `P:04/4.3` means canvas 04, artboard 4.3. `P:08/empty-today` means the 08 data code `empty/today`. |
| `P:hub/<block>` | PRIMARY `Dijital Asistan.dc.html`, the clickable iOS prototype. Blocks: `isToday`, `isAkis`, `isPlan`/`isDay`/`isWeek`, `isAsistan`, `isBriefing`, `isAudio`, `isPrep`, `isPost`, `isMail`, `isReply`, `isApprovals`, `isProfile`, `isPerson`, `isPaywall`, `sheetDefs.remind`, `sheetDefs.correct`, `voice`, `toast`, tab bar. |
| `S:<path>` | SECONDARY archive (Figma-Make React prototype) file `src/<path>`. |
| `S-doc:PD§n / RD§n / QA§n / PL` | SECONDARY product docs: `dijital-asistan-product-design.md`, `digital-assistant-redesign.md`, `final-qa-cleanup.md`, `plans/hen-z-tasar-m-retme-nce-hidden-stallman.md`. |
| `SREQ-nn`, `C-nn`, `V-nn`, `S-nn`, `P-nn`, `F-nn` | IDs from the secondary-docs audit: adopted secondary requirements, contradictions, visual conflicts, secondary self-conflicts, PRIMARY-vs-MASTER claims, and flagged prototype fakes. |
| `D-nn` | New PRIMARY-internal contradictions found in this audit (§5.5). |
| `DEV-nn` | Deviation / redesign log entries (§7). |
| **observed** | A value that appears on a PRIMARY artboard but is not declared in the `P:01` token arrays. |
| **derived** | A value this audit introduces because PRIMARY has none, or because PRIMARY fails WCAG 2.2 AA or a platform rule. Every derived value is listed in §7 and covered by the contrast test in §8.4. |
| Route names | The Expo Router paths from plan §9, written without the `app/` prefix (for example `(tabs)/today/index` or `mail/[id]/reply`). |

### 1.2 Sources

| Key | File | Content (verified) |
|---|---|---|
| P:01 | `01 Tasarim Sistemi.dc.html` | Data arrays `COLORS` (28 entries incl. 3 gradients), `TYPE` (10), `ICONS` (32 system icons), `SPACE` [4,8,12,16,20,24,32,40], `RADIUS` (6), `DARK` (12). Sections: RENK · TOKENLAR; DARK MODE TOKENLARI; TİPOGRAFİ · GEIST + LORA; BOŞLUK · 4'LÜK IZGARA; KÖŞE YARIÇAPI · GÖLGE; İKONLAR · MATERIAL SYMBOLS ROUNDED · 20/24 · wght 400 · FILL 0 (aktif: FILL 1); BUTONLAR · 5 VARYANT × DURUMLAR; ÇİPLER · ROZETLER; KARTLAR · 6 KALIP; GİRİŞLER · ARAMA · SOHBET; SEGMENTLİ KONTROL · ANAHTAR · ONAY; NAVİGASYON · BAŞLIK KALIPLARI; ALT SAYFA · MODAL; TOAST · SES · İSKELET |
| P:02 | `02 Onboarding.dc.html` | 2.1 Tanıtım 1 · Marka, 2.2 Gürültüyü azalt, 2.3 Brifing, 2.4 Kontrol sende, 2.5 Hesap Oluştur, 2.6 Dijital hayatını bağla, 2.7 İzin Açıklayıcı · Gmail, 2.7b · Outlook / Microsoft 365, 2.7c · Takvim, 2.8 Kişiselleştirme, 2.9 Brifing Ayarları, 2.10 İlk Analiz · İşleniyor, 2.11 İlk Analiz · Hazır, 2.12 Bildirim İzni Açıklayıcı, 2.13 Android · Telefon Bildirimleri |
| P:03 | `03 Bugun ve Brifingler.dc.html` | 3.1 Bugün · Light · Sabah, 3.2 Bugün · Dark, 3.3 Sabah Brifingi · Tam ekran, 3.3D Sabah Brifingi · Dark, 3.4 Sesli Brifing, 3.5 Öğle Nabzı · 13:00, 3.6 Akşam Kapanışı · 19:00, 3.7 Haftalık Özet · Editoryal, 3.8 “Dijital Haftam” paylaşım kartı · 1080×1350 |
| P:04 | `04 Akis ve Mail.dc.html` | 4.1 Akış · Tümü, 4.2 Akış · Kişisel · Dark, 4.3 Mail Zekâsı, 4.4 Mail Detayı, 4.5 AI Yanıt Taslağı, 4.6 Akıllı Takip, 4.7 Senden Beklenenler, 4.8 Taahhütler, 4.9 Yaşam Zekâsı, 4.10 Evrensel Yakalama · Ekran görüntüsü, 4.11 Fatura fotoğrafı + Akıllı hatırlatıcı, 4.12a–d PDF, 4.13a–d Link, 4.14a–d Metin |
| P:05 | `05 Plan ve Toplantilar.dc.html` | 5.1 Plan · Gün, 5.1D Dark, 5.2 Hafta + Takvim Zekâsı, 5.3 Takvim Çakışması, 5.4 Toplantıya Hazırlan · Light, 5.5 · Dark, 5.6 2 Dakikalık Özet, 5.7 Toplantı Sonrası Yakalama |
| P:06 | `06 Asistan Hafiza Kisiler.dc.html` | 6.1 Asistan · Giriş, 6.1D Dark, 6.2 Zengin kartlı yanıt, 6.3 Ses Modu · Dinliyor, 6.4 Ses Modu · Yanıt + yazma onayı, 6.5 AI Hafıza, 6.6 Önemli Kişiler · VIP, 6.7 Kişi Zekâsı, 6.8 Onay Merkezi, 6.9 AI Kişiselleştirme |
| P:07 | `07 Hesap Gizlilik Pro.dc.html` | 7.1 Profil ve Ayarlar, 7.2 Gizlilik Merkezi, 7.3 AI'ın Eriştiği Veriler, 7.4 Veri Saklama + Silme sayfası, 7.5 Paywall · PRO, 7.6 Bağlamsal Pro kapısı, 7.7 Arkadaşını Davet Et, 7.8 Görünüm ve Dil, 7.9 Öncelik Kuralları, 7.10 Yeni Kural, 7.11 Kuralı Düzenle, 7.12 Kuralı Sil + geri al |
| P:08 | `08 Durumlar Widgetlar Etkilesimler.dc.html` | `EMPTIES` (4), `ERRORS` (4) + offline full screen, loading/today skeleton, iOS widgets S/M/L + lock screen, Android widgets 4×2 / 2×2, KAYDIRMA AKSİYONLARI, BRİFİNG AÇILIŞI · KARE KARE, `MOTION` (12 rows) |
| P:09 | `09 Pazarlama.dc.html` | store/01–06 (1290×2796) and ad/01–03 (1080×1920) |
| P:hub | `Dijital Asistan.dc.html` | Design-decision page (VARSAYIMLAR VE KARARLAR, BİLGİ MİMARİSİ) plus the clickable prototype with 14 screens, 2 sheets, voice overlay and toast |
| — | `ios-frame.jsx`, `support.js` | Device chrome and canvas runtime. **Not product.** |
| S | 52 screens under `src/screens/**`, components under `src/components/**`, `src/types.ts`, `src/data/mock.ts`, `src/index.css`, `src/context/*` | IA and coverage reference only. Visual language is rejected (V-01..V-09). |
| S-doc | PD (75 sections), RD, QA, PL | Normalised in the secondary-docs audit: SREQ-01..104, C-01..37 |
| Audits | design-system, design-hub, design-onboarding-today, design-flow-mail, design-plan-assistant, design-account-states-marketing, design-secondary-code, secondary-docs | Merged in this document. Where an audit and this document disagree, this document wins. |

### 1.3 Conflict rule (binding order)

1. **Function:** MASTER wins (M§4 "Fonksiyonel davranış bakımından bu prompt bağlayıcıdır"). Canonical names, enums, tables, `api` routes and screen routes come from the master plan, including its §23b reconciliation rulings (R-01…R-25), which override any wording in this document. Below the plan, R-20 assigns ownership: DATABASE_AND_RLS_PLAN for tables, columns, enums and functions; API_CONTRACTS for endpoint and RPC names and shapes; SCREEN_AND_FLOW_MAP for screen IDs, screen routes and analytics event names; BACKOFFICE_PLAN §4.1 for admin permission strings. §10 of this document only proposes names; where an owner already defines a name, the owner's name is used here.
2. **Truthfulness and policy:** M§40, M§83, M§100 and M§141, together with App Store and Play rules, override any PRIMARY copy or visual that would mislead.
3. **Accessibility:** WCAG 2.2 AA and the platform hit-target rules (44 pt / 48 dp) override PRIMARY colours and sizes. The fix is always the smallest change that passes (M§124), and every fix is logged in §7.
4. **Visual:** PRIMARY wins. Within PRIMARY, the `P:01` declared tokens win over values observed on screens. A dedicated artboard (P:02–P:08) wins over `P:hub` prototype wiring. Artboard-vs-artboard conflicts are resolved in §5.5.
5. **SECONDARY:** used only for IA and function where PRIMARY has no screen. It is always restyled into PRIMARY. Its visuals (Inter, cool neutrals, iOS system colours, purple deadline colour, emoji, gradient buttons) are rejected wholesale.
6. **No reference in either archive:** the production screen is designed from the requirement, in PRIMARY language, using only `packages/ui` components (M§144). This applies to Backoffice, most of the Public Web, Notification Settings extras, and the Subscription, Deletion and Export screens.

### 1.4 Method

1. Every PRIMARY canvas was read (templates plus data scripts), along with every SECONDARY screen and the product docs. The 8 audits were merged, and PRIMARY token arrays were re-verified directly (`COLORS`, `TYPE`, `ICONS`, `SPACE`, `RADIUS`, `DARK` at `P:01` lines 198–243).
2. WCAG 2.x contrast ratios were computed for every text/surface pair, with alpha composited over the real surface. Gradients were sampled at stop positions *t*. Results are in §2.15.
3. Icon names were verified against the rounded set of the npm tarball `@material-symbols/svg-400@0.47.5` (published 2026-09-22 07:06Z, more than 24 h before this audit, so `minimumReleaseAge` is satisfied). It contains 7,854 rounded files, and every icon exists as outline plus `-fill`. **Six design names are missing** and are aliased in §2.12.3.
4. Dates are checked against the real calendar. PRIMARY mixes 2025 (5 Eylül = Friday) and 2026 (5 Eylül = Saturday). Production computes every date relative to now in `user_preferences.timezone` (DEV-18).

---

## 2. Design tokens

### 2.1 Token architecture and naming

- **Single source:** `packages/design-tokens/src/source/*`, built into `generated/tokens.ts` (React Native), `generated/tokens.css` (Tailwind v4 `@theme`) and `generated/tokens.json` (Swift and Kotlin widget codegen). See §8.3.
- **Names:** every PRIMARY token keeps its verbatim slash name (for example `brand/primary` or `ink/tertiary`) as an alias of a typed code key (for example `color.brand.primary`). Components read semantic code keys only. The ESLint rule `da/no-raw-color` bans hex, rgb and hsl literals outside `packages/design-tokens` (§8.5).
- **Schemes:** `light` and `dark`. Theme resolution is `user_preferences.theme ∈ {system, light, dark}` (default `system`, M§38). `system` follows `Appearance`.
- **Provenance labels in the tables below:** **declared** (in `P:01`), **observed** (on a PRIMARY artboard), **derived** (from this audit).

### 2.2 Colour tokens — declared in `P:01` (light and dark)

| Token (verbatim) | Code key | Light | Dark | Dark provenance | Usage rule |
|---|---|---|---|---|---|
| `brand/primary` | `brand.primary` | `#5B5CE2` | `#8586F2` | declared `DARK.primary` | Primary button fill, AI marker icon, selected tab (light), switch on, focus ring (light), user chat bubble, selected radio/check, played progress. "Dekor için asla." |
| `brand/primary-pressed` | `brand.primaryPressed` | `#4B4CCB` | `#9596F5` | **derived** (`#0F0F2A` on it = 7.09) | Pressed primary |
| `brand/soft` | `brand.soft` | `#EDEDFC` | `rgba(133,134,242,.16)` | observed 3.2 / 6.1D | Tonal button bg, ghost pressed bg, hot category tile, approval-type tile, VIP/PRO chip, AI avatar bubble |
| `brand/text-on-soft` | `brand.onSoft` | `#4547C9` | `#C3C4F8` (tonal text) · `#A9AAF5` (links, ghost, card actions) | observed 3.2 | Ghost/text actions, links, text on soft indigo, **AI kicker text on glow surfaces (DEV-03)** |
| `brand/dark-glow` | `brand.glow` | `#A9AAF5` | `#A9AAF5` | declared `DARK.primary-glow` | AI marker on dark and ink surfaces; toast icon and action; dark active tab; dashed border of suggested blocks (light) |
| `critical` | `tone.critical.solid` | `#E0553F` | `#F08B78` | **derived** (reuses critical-text) | Meaningful icons, conflict line, error ring, urgent dot, busy bar |
| `critical/soft` | `tone.critical.soft` | `#FCEDE9` | `rgba(224,85,63,.18)` | observed `TD` (04) | ACİL / GÜVENLİK / GECİKMİŞ badge bg, destructive icon tile, security life tile |
| `critical/text` | `tone.critical.text` | `#C7432F` | `#F08B78` | declared `DARK.critical-text` | **Fill** of destructive buttons (white on it = 4.92). Text on soft or bg uses `critical/text-strong` (DEV-02). |
| `warning` | `tone.warning.solid` | `#E09A1C` | `#F0B85A` | **derived** | Decorative dots next to text (group headers, widget), density/busy fills. Meaningful icons use `warning/text` (DEV-09). |
| `warning/soft` | `tone.warning.soft` | `#FDF2DC` | `rgba(217,139,11,.18)` | observed `TD` | SON TARİH, BEKLİYOR, BUGÜN (lifecycle), 3–6-day wait, countdown chip, reminder highlight |
| `warning/text` | `tone.warning.text` | `#9A6300` | `#F0B85A` | declared `DARK.warning-text` | Badge text, deadline date text, **meaningful warning icons** |
| `success` | `tone.success.solid` | `#2FA062` | `#6FCF97` | **derived** | Done icon (`check_circle` FILL), "detected" check |
| `success/soft` | `tone.success.soft` | `#E4F5EA` | `rgba(47,160,98,.18)` | **derived** | ONAYLANDI, TAMAMLANDI, +14 GÜN, EN AVANTAJLI, assurance box, success halo, Bağlandı pill |
| `success/text` | `tone.success.text` | `#1E7A47` | `#6FCF97` | declared `DARK.success-text` | Badge text, `verified_user`, **swipe-right track (DEV-10)** |
| `info` | `tone.info.solid` | `#3B82E6` | `#8DB8F5` | **derived** | Non-text fills only (charts). PRIMARY icons use `info/text` (D-04). |
| `info/soft` | `tone.info.soft` | `#E7F0FD` | `rgba(59,130,230,.18)` | **derived** | Event tile, time highlight, capture event row |
| `info/text` | `tone.info.text` | `#2262BE` | `#8DB8F5` | **derived** (6.56 on dark soft) | Text and icons in info tone |
| `neutral/bg` | `bg` | `#F5F4F0` | `#141311` | declared | App background (warm) |
| `neutral/surface` | `surface` | `#FFFFFF` | `#1F1E1B` | declared | Cards, sheets, inputs, surface buttons |
| `neutral/surface-2` | `surfaceSunken` | `#F0EFEB` | `rgba(255,255,255,.08)` | declared | Icon tiles, neutral badges, meta chips, neutral-tonal buttons, disabled input |
| `neutral/hairline` | `border.hairline` (stroke) / `surfaceTrack` (solid) | `rgba(27,25,23,.06)` stroke; `#E9E7E1` solid | `rgba(255,255,255,.06)` stroke; `rgba(255,255,255,.08)` solid | observed | Row dividers (stroke). Segmented track and swipe action bg (solid). |
| `ink` | `text.primary` / `surfaceInk` | `#1A1917` | `#F2F0EB` (text); ink *surfaces* become `#1F1E1B` + ring (DEV-14) | declared `DARK.text` | Primary text, ink CTA, ink callout cards, selected filter chip, toast bg, user avatar |
| `ink/secondary` | `text.secondary` | `#6B6860` | `#A39F96` | declared | Secondary text, row icons |
| `ink/tertiary` | `text.tertiary` | `#9B978E` | `#7A776F` | declared | **Decorative / disabled only** (fails AA as text). Informational text uses `ink/tertiary-strong` (DEV-01). |
| `ink/disabled` | `text.disabled` | `#B8B4AA` | `#5E5B54` | observed 3.2 / 5.5 | Disabled text (WCAG-exempt), decorative glyphs |
| `editorial/paper` | `bgEditorial` | `#FBFAF7` | `#141311` | **derived** | Weekly review, 2-minute summary reading view, legal pages (web) |
| `gradient/dawn` | `gradient.dawn` | `linear-gradient(160deg,#1E1E4C 0%,#3B3CA8 58%,#7071EA 100%)` | identical | declared ("her iki modda aynı") | Morning brief header, onboarding brand moment, first-analysis-ready, share card, referral hero, store/ad frames |
| `gradient/night` | `gradient.night` | `linear-gradient(180deg,#15153A 0%,#25266A 60%,#3B3CA8 100%)` | identical | declared | Voice mode, audio player, analysis in progress. The 70% variant in `P:hub`/6.3 is normalised to 60% (D-37). |
| `gradient/dusk` | `gradient.dusk` | `linear-gradient(160deg,#2A1E3F 0%,#4A3A8A 55%,#8C6BD6 100%)` | identical | declared | Evening close header |
| `on-primary` (DARK) | `text.onPrimary` | `#FFFFFF` | `#0F0F2A` | declared | Text and icons on `brand/primary` fill (dark = 5.96, **not** "9:1"; D-13) |

### 2.3 Supplementary tokens (observed and derived)

| Token | Code key | Light | Dark | Provenance / reason |
|---|---|---|---|---|
| `ink/tertiary-strong` | `text.tertiaryStrong` | `#6F6C66` | `#8F8B83` | **derived.** ≥4.52 on every light text surface (bg, surface, paper, surface-2, life, suggested, all soft tones). Dark: ≥4.54 on bg, surface, pressed and life. Used for kickers, meta, timestamps, source lines, placeholders and inactive tab labels. |
| `ink/secondary-on-track` | `text.secondaryOnTrack` | `#67645C` | `#A39F96` | **derived.** `#6B6860` on `#E9E7E1` = 4.4996 (fails). Used for unselected segmented labels and left-swipe action labels. |
| `ink/on-ai-glow` | `text.onAiGlow` | `#65625B` | `#B5B1A8` | **derived.** Secondary and meta text inside `AiCard`/hero glow: 4.86 on `#E4E4FA`; dark 5.02 on glow peak `#3C3B57`. |
| `ink/quaternary` | `icon.chevron` | `#C9C5BC` | `#5E5B54` | observed. **Decorative only** (row chevrons next to text labels; 1.4.11-exempt). |
| `icon/default` | `icon.default` | `#6B6860` | `#A39F96` | observed. Row and tile icons. |
| `icon/idle` | `icon.idle` | `#8F8B83` | `#85827A` | **derived.** Actionable idle icons (card ✓ / ··· / edit / delete): 3.39 on white, 4.34 on dark surface (PRIMARY `#B8B4AA` = 2.07). |
| `icon/ai` | `icon.ai` | `#5B5CE2` | `#A9AAF5` | observed. `auto_awesome`/`star_shine` markers (non-text 4.12 on glow peak ≥ 3). |
| `critical/text-strong` | `tone.critical.textStrong` | `#BE3F2C` | `#F08B78` | **derived.** Text on `critical/soft` = 4.68 and on bg = 4.85 (PRIMARY 4.31 / 4.47). Badges, error helper, destructive row text. |
| `critical/pressed` | `tone.critical.pressed` | `#A83726` | `#F4A393` | observed (P:01 destructive pressed) / **derived** dark |
| `destructive-fill` (dark) | `button.destructive.bg` | `#C7432F` | `#F08B78` with text `#141311` (7.67) | **derived** dark |
| `brand/soft-pressed` | `brand.softPressed` | `#DCDCF8` | `rgba(133,134,242,.24)` | **derived** (P:01 "ton koyulaşır") |
| `brand/suggested-bg` | `plan.ai` | `#F7F7FE` | `rgba(133,134,242,.12)` | observed 5.1 / 5.1D |
| `brand/suggested-border` | `border.suggested` | `#A9AAF5` (1px dashed) | `#8586F2` (1px dashed) | observed |
| `brand/planned` | `plan.aiPlanned` | `#EDEDFC` + 1px solid `#5B5CE2` | `rgba(133,134,242,.20)` + 1px solid `#8586F2` | observed light / **derived** dark |
| `ai-glow/start` | `gradient.aiGlow.from` | `#E4E4FA` | `rgba(133,134,242,.28)` | observed |
| `surface/pressed` | `surfacePressed` | `#F7F6F2` | `#2A2926` | observed / **derived** dark |
| `surface/ink` | `surfaceInk` | `#1A1917` | `#1F1E1B` + `0 0 0 1px rgba(255,255,255,.08)` | **derived** dark (DEV-14) |
| `plan/life` | `plan.life` | `#FDF6EC` | `rgba(240,184,90,.10)` | observed (5.1 / 5.1D) |
| `plan/event` | `plan.event` | `#FFFFFF` + hairline | `#1F1E1B` + `rgba(255,255,255,.06)` | observed |
| `plan/gap` | `border.gapDashed` | `1px dashed rgba(27,25,23,.15)` | `1px dashed rgba(255,255,255,.15)` | observed |
| `plan/week-meeting`, `-focus`, `-busy`, `-busy-strong`, `-today`, `-today-strong` | `plan.week.*` | `#D9D6F7`, `#EDEDFC`, `#F3B7AE`, `#E0553F`, `#5B5CE2`, `#A9AAF5` | `rgba(133,134,242,.35)`, `rgba(133,134,242,.16)`, `rgba(224,85,63,.35)`, `#F08B78`, `#8586F2`, `#A9AAF5` | observed / **derived** dark |
| `mail/band-attention`, `-info`, `-low` | `mail.band.*` | `#5B5CE2`, `#C9C7F3`, `#E9E7E1` | `#8586F2`, `rgba(133,134,242,.35)`, `rgba(255,255,255,.08)` | observed / **derived** dark |
| `success/deep` | `tone.success.deep` | `#1E5A36` | `#6FCF97` | observed (assurance box text 7.21) |
| `success/on-gradient` | `tone.success.onGradient` | `#A9F0C1` | `#A9F0C1` | observed (2.10 checks, 7.2 promise icons; 10.18 on `#25266A`) |
| `accent/count-on-dawn` | `text.countOnDawn` | `#C9C9FF` | same | observed 2.11 (large text only) |
| `kicker/on-indigo` | `text.kickerOnIndigo` | `#D6D6FB` | same | observed 5.5 (8.51 on `#2C2C7A`) |
| `on-gradient/primary` | `text.onGradient` | `#FFFFFF` | same | observed |
| `on-gradient/secondary` | `text.onGradientSecondary` | `rgba(255,255,255,.86)` | same | **derived** (PRIMARY .8; DEV-12) |
| `on-gradient/tertiary` | `text.onGradientTertiary` | `rgba(255,255,255,.72)` | same | observed (kickers; only at *t* ≤ 0.6) |
| `on-gradient/fill-1…7` | `onGradient.fill.{08,10,12,14,16,18,25}` | `rgba(255,255,255,.08/.10/.12/.14/.16/.18/.25)` | same | observed (answer bubble, prompt chips, close/speed pills, icon circles, lock widget, avatar add) |
| `on-gradient/wave-idle` | `onGradient.waveIdle` | `rgba(255,255,255,.35)` | same | observed |
| `control/switch-off` | `control.switchOff` | `#D9D6D0` | `rgba(255,255,255,.16)` | observed / **derived** dark |
| `control/switch-off-border` | `control.switchOffBorder` | 1px inset `#8F8B83` | 1px inset `#85827A` | **derived** (DEV-08, WCAG 1.4.11) |
| `control/radio-off` | `control.radioOff` | `#8F8B83` (2px ring) | `#85827A` | **derived** (DEV-07) |
| `control/grabber` | `control.grabber` | `#E0DED7` | `rgba(255,255,255,.16)` | observed / **derived** |
| `control/spinner-track` | `control.spinnerTrack` | `#D9D6F7` | `rgba(133,134,242,.24)` | observed / **derived** |
| `skeleton/base`, `skeleton/highlight` | `skeleton.*` | `#EFEDE7`, `#F7F6F2` | `rgba(255,255,255,.06)`, `rgba(255,255,255,.10)` | observed / **derived** |
| `overlay/scrim` | `overlay.scrim` | `rgba(27,25,23,.35)` | `rgba(0,0,0,.50)` | observed / **derived** |
| `overlay/tab-bar` | `overlay.tabBar` | `rgba(255,255,255,.92)` + blur 20 (iOS); Android `#FFFFFF` | `rgba(20,19,17,.92)` + blur (iOS); Android `#141311` | observed / **derived** Android (DEV-20) |
| `overlay/glass-card` | `overlay.glassCard` | `rgba(255,255,255,.70)` + blur 20 | `rgba(31,30,27,.80)` | observed (2.12) / **derived** |
| `border/row` | `border.row` | `rgba(27,25,23,.07)` | `rgba(255,255,255,.07)` | observed (timeline rows) |
| `border/strong` | `border.strong` | `rgba(27,25,23,.10)` | `rgba(255,255,255,.10)` | observed ("veya" divider, plan card ring) |
| `border/control` | `border.control` | `rgba(27,25,23,.20)` | `rgba(255,255,255,.20)` | observed (radio border in paywall) |
| `border/focus` | `border.focus` | `#5B5CE2` (2px ring) | `#A9AAF5` | observed / **derived** |
| `border/error` | `border.error` | `#E0553F` (2px ring) | `#F08B78` | observed / **derived** |
| `toast/*` | `toast.{bg,text,icon,iconError,action}` | `#1A1917`, `#FFFFFF`, `#A9AAF5`, `#F08B78`, `#A9AAF5` | `#2A2926` + ring `rgba(255,255,255,.08)`, `#F2F0EB`, `#A9AAF5`, `#F08B78`, `#A9AAF5` | observed / **derived** dark (DEV-13) |
| `home-indicator` | — | not drawn | — | chrome (DEV-19) |
| `avatar/peach`, `/blue`, `/green`, `/neutral`, `/self` | `avatar.*` | `#F5E1D6`/`#7A3E1F` (6.55), `#DCE4F5`/`#2B3F73` (7.98), `#E3EFE6`/`#1E5A36` (6.91), `#F0EFEB`/`#6B6860` (4.84), `#1A1917`/`#FFFFFF` | Inverted (bg = light fg, fg = light bg); self `#F2F0EB`/`#141311` | observed; dark blue inversion observed in 5.5, the others **derived** |
| `provider-tile/*` | `providerTile.*` | Gmail `#FCEDE9`/`#C7432F`, Microsoft `#E7F0FD`/`#2262BE`, Google Calendar `#E4F5EA`/`#1E7A47`, Apple/device `#F0EFEB`/`#6B6860` | dark tone soft/text | observed. **Replaced by official provider logos in production** (the P:02 note says so; D-43). |

### 2.4 Tone map API (`Badge`, `IconTile`, `StatusPill`, `ToneText`)

| Tone | Light [soft, text, icon] | Dark [soft, text, icon] |
|---|---|---|
| `critical` | `#FCEDE9`, `#BE3F2C` (text-strong), `#E0553F` | `rgba(224,85,63,.18)`, `#F08B78`, `#F08B78` |
| `warning` | `#FDF2DC`, `#9A6300`, `#9A6300` (meaningful) / `#E09A1C` (decorative dot) | `rgba(217,139,11,.18)`, `#F0B85A`, `#F0B85A` |
| `success` | `#E4F5EA`, `#1E7A47`, `#2FA062` | `rgba(47,160,98,.18)`, `#6FCF97`, `#6FCF97` |
| `info` | `#E7F0FD`, `#2262BE`, `#2262BE` | `rgba(59,130,230,.18)`, `#8DB8F5`, `#8DB8F5` |
| `neutral` | `#F0EFEB`, `#6B6860`, `#6B6860` | `rgba(255,255,255,.08)`, `#A39F96`, `#A39F96` |
| `primary` | `#EDEDFC`, `#4547C9`, `#5B5CE2` | `rgba(133,134,242,.16)`, `#C3C4F8`, `#A9AAF5` |

Measured contrast of every text-on-soft pair: light ≥ 4.55 (`warning` 4.55, `success` 4.72, `info` 5.14, `neutral` 4.84, `primary` 6.04, `critical` 4.68 with text-strong); dark ≥ 5.0.

### 2.5 Semantic colour rules

1. **"Renk yalnızca anlam taşır."** Surfaces are warm neutrals. Indigo is used only for AI markers, primary actions, the selected tab and links (P:01 Kural 2). The lint rule forbids `brand.*` on decorative elements; a code review checklist item enforces it.
2. **Kural 1 (card category badges):** coloured only for **ACİL** (critical), **SON TARİH** (warning), **GÜVENLİK** (critical) and **ONAYLANDI** (success). All other category badges are neutral: TOPLANTI, TAKİP, KİŞİSEL, TAAHHÜT, KARGO, UÇUŞ, ÖDEME, ABONELİK, REZERVASYON, BUGÜN (feed), TAKVİM (DEV-66), AÇIK, GÖNDERİLDİ, REDDEDİLDİ.
3. **Lifecycle status pills** (allowed tone, documented map; this resolves D-07):

   | Surface | Pill → tone |
   |---|---|
   | Approval | BEKLİYOR → warning · İŞLENİYOR → neutral + 12 px spinner · ONAYLANDI → success · BAŞARISIZ → critical · REDDEDİLDİ / SÜRESİ DOLDU → neutral, card opacity .45 |
   | Commitment | AÇIK → neutral · BUGÜN → warning · GECİKMİŞ → critical · TAMAMLANDI → success |
   | Wait duration | <3 days → neutral · 3–6 days → warning · ≥7 days → critical (thresholds configurable in `packages/domain`) |
   | Referral | +14 GÜN → success · BEKLİYOR → warning · GÖNDERİLDİ → neutral |
   | Account / plan | PRO → primary · EN AVANTAJLI → success · Bağlandı → success · Bağla → primary |
   | Waiting-on-you groups (4.7) | ACİL (dot `#E0553F`, label critical-text-strong) · BUGÜN (dot `#E09A1C`, label `#9A6300`) · BU HAFTA (dot `#B8B4AA`, label `#6B6860`; renamed from "YAKINDA", SREQ-11) |

4. **Colour never carries meaning alone** (SREQ-86). Every coloured badge has text, every dot has an adjacent label, and widget dots carry `accessibilityLabel` text.
5. **Dashed border = "önerilen / henüz gerçek değil".** Allowed only in `SuggestedSurface` (dashed `border.suggested`, label "Önerilen · henüz gerçek değil") and `GapBlock` (dashed `border.gapDashed`, meaning "empty time"). After approval and execution, the block becomes solid (`plan.aiPlanned`). Lint rule `da/no-dashed-border` (§8.5).
6. **The count is coloured only in the hero.** "Bugün bilmen gereken **N** şey var." uses `brand.primary` (dark `brand.glow`) for N. Cards use colour only for urgency.
7. **Category-icon tint rule:** Calendar-intelligence icons use text tones (`bolt` `#9A6300`, `directions_car` `#2262BE`, `self_improvement` `#5B5CE2`, `error` `#C7432F`), as in P:05/5.2. Capture item tiles: deadline and reminder warning, event info, task neutral. Inline highlight spans: time info, person primary, task neutral, reminder warning (radius 5, padding 1×4).
8. **Life tiles are neutral**, except security (critical).

### 2.6 Gradients

| Token | Definition | RN implementation | Text-safe rule |
|---|---|---|---|
| `gradient/dawn` | 160deg `#1E1E4C` 0% → `#3B3CA8` 58% → `#7071EA` 100% | `expo-linear-gradient`. CSS 160deg maps to `start {x:0.33,y:0}`, `end {x:0.67,y:1}` (helper `cssAngleToPoints(160)` in `packages/ui`). | Small text only where *t* ≤ 0.8, at opacity ≥ .86 (4.72 at *t* = .8). Kickers (.72) only where *t* ≤ 0.6 (≥ 5.0). Large text (≥ 24 px, or ≥ 18.66 px at 600) anywhere with opacity 1. |
| `gradient/dawn-fullbleed` (**derived**) | 160deg `#1E1E4C` 0% → `#3B3CA8` 58% → `#5A5BD6` 100% | same | Full-screen dawn backgrounds (2.1, 2.11, `/r/[code]` hero). Bottom-anchored small text is 100% white (5.38 worst case). DEV-12. |
| `gradient/night` | 180deg `#15153A` 0% → `#25266A` 60% → `#3B3CA8` 100% | same | Any text at opacity ≥ .6 up to *t* = .9 (≥ 4.64) |
| `gradient/dusk` | 160deg `#2A1E3F` 0% → `#4A3A8A` 55% → `#8C6BD6` 100% | same | Same rule as dawn (.86 at *t* ≤ .8 = 4.75) |
| `ai-glow-tl` / `ai-glow-tr` | `radial-gradient(140% 100% at 0% 0% \| 100% 0%, #E4E4FA 0%, #FFFFFF 60%)` (hero uses stop 58%) | `react-native-svg` `RadialGradient` (rx 140%, ry 100%, focal at the corner) in the `AiGlowSurface` primitive | Kicker text `brand.onSoft`; secondary text `ink/on-ai-glow` |
| `ai-glow-dark` | `radial-gradient(140% 100% at … , rgba(133,134,242,.28) 0%, #1F1E1B 60%)` + ring `rgba(255,255,255,.06)` | same | Secondary text `#B5B1A8`; kicker `#A9AAF5` (4.99) |
| `prep-card-dark` | 160deg `#2C2C7A` → `#4A4BC8` + `0 12px 32px rgba(91,92,226,.25)` | linear | Body text rgba(255,255,255,.8) (4.93; PRIMARY .75 = 4.54, accepted) |
| `lockscreen-dawn` | 180deg `#1E1E4C` 0% → `#3B3CA8` 70% → `#7071EA` 100% | Widget preview only | — |
| `fade-to-bg` | 180deg `rgba(bg,0)` 0% → `bg` 45% (40% on the person composer, 30% on the Asistan dock) | linear, one per scheme and per `bgEditorial` | — |
| `onboarding-tint` | 180deg `#EDEDFC` 0% → `#F5F4F0` 30–32% | Paywall background; dark `rgba(133,134,242,.12)` → `#141311` 32% (**derived**) | — |
| `theme-preview-system` | 100deg `#F5F4F0` 50% / `#141311` 50% | Two absolutely positioned halves (a hard stop) | — |
| `skeleton-shimmer` | 90deg `#EFEDE7` 25% → `#F7F6F2` 50% → `#EFEDE7` 75%, size 200% | Animated `translateX` of a linear gradient inside `overflow:hidden` | — |

`experimental_backgroundImage` is not used, because its stability is unverified on RN 0.86 (DEV-57).

### 2.7 Typography

**Families**

- **Geist**, UI, weights 400/500/600/700, from `@expo-google-fonts/geist`. React Native maps each weight to a family name (`Geist_400Regular`, `Geist_500Medium`, `Geist_600SemiBold`, `Geist_700Bold`), because Android ignores `fontWeight` on single-file families.
- **Lora**, editorial, weights 400/500/600 plus italic 400, from `@expo-google-fonts/lora`.
- **Monospace**, for the invite link and IDs: platform `Menlo` (iOS) and `monospace` (Android). On web and backoffice, `Geist_Mono` via `next/font/google`.
- **Web:** `next/font/google` with `subsets:['latin','latin-ext']` (covers ğ ş ı İ).
- **Geist on iOS body text too.** The PRIMARY "SF Pro fallback" option is not taken (parity, M§3.13; DEV-17).
- **Android:** `includeFontPadding:false` and `textAlignVertical:'center'` on every Text.

**Scale** (RN `letterSpacing` in pt = em × size; `mfs` = `maxFontSizeMultiplier`)

| Token | Family / weight | Size / line height | Tracking (pt) | mfs | Provenance · usage |
|---|---|---|---|---|---|
| `display` | Geist 600 | 34/40 | −0.85 | 1.3 | declared · marketing-in-app, success titles |
| `titleGradient` | Geist 600 | 32/38 | −0.64 | 1.3 | observed · "Günaydın, Yunus" on dawn, 2.11 title |
| `titleXl` | Geist 600 | 30/36 | −0.75 | 1.3 | observed · onboarding titles, paywall, evening header |
| `h1` | Geist 600 | 28/34 | −0.56 | 1.4 | declared · tab roots, page titles |
| `hero` | Geist 600 | 26/32 | −0.52 | 1.3 | observed · Today hero sentence, audio title, conflict title, success title |
| `titleLg` | Geist 600 | 24/30 | −0.48 | 1.4 | observed · person name (prep) |
| `h2` | Geist 600 | 22/28 | −0.44 | 1.4 | declared · mail subject, destructive sheet title, gate title |
| `titleMd` | Geist 600 | 20/26 | −0.40 | 1.4 | observed · detected-entity title, explainer title, rule dialog |
| `sheetTitle` | Geist 600 | 19/24 | −0.19 | 1.5 | observed · sheet and empty-state titles |
| `h3` | Geist 600 | 17/23 | −0.17 | 1.5 | declared · card titles |
| `emph` | Geist 500 | 17/24 | −0.17 | 1.5 | observed · AI summary lead |
| `h3Sm` | Geist 600 | 16/22 | −0.16 | 1.5 | observed · feed card title, AI card title (16/23) |
| `body` | Geist 400 | 15/22 | 0 | 2.0 | declared |
| `bodySm` | Geist 400 | 15/21 | 0 | 2.0 | observed · snippets, bubbles |
| `rowTitle` | Geist 500 | 15/20 | −0.15 | 2.0 | observed · list rows |
| `labelLg` | Geist 600 | 15/20 | 0 | 1.5 | observed · 52/48 buttons |
| `secondary` | Geist 400 | 14/20 | 0 | 2.0 | declared · colour `text.secondary` |
| `label` | Geist 600 | 14/18 | 0 | 1.5 | observed · 40–44 buttons, card text actions |
| `bodyXs` | Geist 400 | 13/19 | 0 | 2.0 | observed · error body, key/value grid |
| `labelSm` | Geist 600 | 13/16 | 0 | 1.5 | observed · chips, segmented, 36–38 buttons |
| `kicker` | Geist 600 caps | 12/16 | +0.96 | 1.5 | declared · colour `text.tertiaryStrong` |
| `kickerAi` | Geist 600 caps | 12/16 | +0.72 | 1.5 | observed · colour `brand.onSoft` (DEV-03) |
| `labelXs` | Geist 600 | 12/16 | 0 | 1.5 | observed · meta chips, pills |
| `meta` | Geist 400 | 12/16 | 0 | 2.0 | observed · colour `text.tertiaryStrong` |
| `badge` | Geist 700 | 11/14 | +0.55 | 1.4 | declared (micro) |
| `badgeSm` | Geist 700 | 10/12 | +0.50 | 1.4 | observed · onboarding findings, widgets |
| `typeLabel` | Geist 700 caps | 11/14 | +0.66 (life category +0.88) | 1.4 | observed |
| `tabLabel` | Geist 500 | 11/13 | 0 | 1.2 | observed |
| `numericXl` | Geist 600 | 44/48 | −1.32 | 1.3 | observed · "83" Mail Zekâsı |
| `editorial` | Lora 400 | 18/29 | 0 | 2.0 | declared · briefing narrative |
| `editorialReading` | Lora 400 (b = 600) | 17/28 | 0 | 2.0 | observed · 5.6 |
| `editorialQuote` | Lora 400 italic | 16/24 | 0 | 2.0 | observed · commitment quote |
| `editorialKicker` | Lora 400 italic | 15/22 | 0 | 1.6 | observed · "Haftalık özet", byline |
| `editorialTitle` | Lora 500 | 30/36 | −0.60 | 1.3 | observed · 5.6 "Nerede kalmıştınız?" |
| `editorialDisplay` | Lora 500 | 38/44 (34/40 alt) | −0.76 | 1.3 | declared (34–38) |
| `editorialNumber` | Lora 500 | 34/36 | −0.68 | 1.3 | observed · weekly stats |
| `mono` | platform mono 500 | 14/20 | 0 | 1.5 | observed · invite link |

**Rules**

- **Lora scope** (extends P:01, resolving D-08): briefing narrative, reading view, weekly review and share card, commitment quotes, and marketing. Never in controls or lists.
- **Tabular numbers:** `fontVariant:['tabular-nums']` via the `<Text numeric>` prop on times, durations, amounts, counters and countdowns. Web uses `font-variant-numeric: tabular-nums`.
- **Turkish uppercase:** kickers and badges are uppercased in the i18n layer with `toLocaleUpperCase(locale)` (tr → "SAMİMİ", not "SAMIMI"). `textTransform:'uppercase'` is banned on Text by lint (`da/no-text-transform-uppercase`). Web sets `lang="tr"`/`"en"`.
- **Dynamic Type:** `allowFontScaling` is on everywhere and caps are set with `mfs`. Fixed heights in the design become `minHeight`, and rows wrap. The pseudo-locale (+40%) and max Dynamic Type are part of UI QA (SREQ-88, SREQ-90).
- **Web marketing scale** (derived): `webDisplay` 64/68 (≥1200) · 48/52 (768–1199) · 40/44 (<768), 600, −2.5%; `webH2` 40/46 · 32/38 · 28/34; `webLead` 20/30 secondary; `webBody` 17/28; `webKicker` 13/16 600 +8% caps; `webQuote` Lora 28/40; `webLegalBody` 17/28, max 720 px measure.
- **Backoffice density scale** (derived): `boPageTitle` 22/28 600; `boSection` 16/24 600; `boBody` 14/20; `boTable` 13/18 (tabular); `boMeta` 12/16; `boKicker` 11/16 600 +8% caps; `boMono` Geist Mono 12/18.

### 2.8 Spacing and layout

- **Scale:** `space` = {0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 44}. This is a 2-px sub-grid over the declared 4-grid (resolves D-10).
- **Rule (verbatim P:01):** "Ekran kenarı 20 · kart içi 16 · kartlar arası 12 · bölümler arası 18–22 · liste satırı min 50."

| Constant | Value |
|---|---|
| Screen horizontal edge | 20 (onboarding 28; reading view and weekly 24; sheet 20; destructive sheet 24) |
| Content top | root `insets.top + 14`; sub-page `insets.top + 6` (no drawn status bar) |
| Section gaps | Today 18; Plan and Asistan 16; sub-lists 14; brief sections 22; weekly 26 |
| Card padding | 16; compact 14/16/10 (priority, feed); hero 22/22/20; ink cards 20; error and person cards 14/16 |
| Grouped list | container padding 4×16 (or 0×16); row min 50 (settings 52, two-line 56–60), row vertical padding 11 |
| Section header | padding 0/4/8 (kicker); 4/4/0 when it has a count |
| Card action row | margin-top 6, padding 8×0, gap 14; ghost buttons offset −10 to align text |
| Button rows | gap 8–10 |
| Sticky footer | padding 16/20/(`insets.bottom` + 10, min 20); scroll content bottom inset = footer height + 16 |
| Tab bar | height `62 + insets.bottom`; items padding 8/8; icon 26; gap 3 |
| Toast bottom | `tabBarHeight + 14` when the tab bar is visible; otherwise above the sticky footer + 12, or `insets.bottom + 16` |
| Horizontal chip rows | edge padding 20, gap 8 (memory filters gap 6) |
| Hit targets | ≥ 44 × 44 pt iOS, ≥ 48 × 48 dp Android via `hitSlop` / `minHeight` (visual sizes unchanged; DEV-22) |

### 2.9 Radius

| Token | Value | Use |
|---|---|---|
| `xs` | 3 | grabber, progress, dots |
| `text` | 5 | inline entity highlights, bars |
| `tileXs` | 9 | 28-px icon tiles |
| `tile` | 10 | 30-px tiles; ghost 36 buttons (declared "çip ikon karosu") |
| `tileMd` | 11 | 36-px tiles, error tile, brand mark 36 |
| `inline` | 12 | 38–42 buttons, 40 widget tile (declared "satır içi buton") |
| `button` | 14 | 44–48 buttons, 44 life tile, day chip, timeline blocks, info boxes (declared) |
| `buttonLg` / `input` / `cardSm` | 16 | 52 CTAs, inputs, action tiles, small cards (declared "küçük kart") |
| `list` | 18 | grouped lists, person, waiting and error cards, result cards (observed) |
| `card` | 20 | cards (declared) |
| `widgetIos` | 22 | iOS widgets |
| `panel` / `modal` | 24 | ink callouts, modals, prep 3-şey card (observed) |
| `hero` / `sheet` | 28 | hero card, sheet top, gradient-header overlap, Android widgets (declared "hero / sayfa") |
| `pill` | 999 | pills, chips, segmented, badges, composer, search, toast |

### 2.10 Elevation

| Token | Light | Dark |
|---|---|---|
| `shadow.s1` | `0 1px 2px rgba(27,25,23,.06)` (chips, search, pills) | none |
| `shadow.s1Control` | `0 1px 2px rgba(27,25,23,.08)` (icon-button circles, surface buttons) | ring `0 0 0 1px rgba(255,255,255,.08)` |
| `shadow.s1Soft` | `0 1px 2px rgba(27,25,23,.04)` (skeleton cards, prompt rows, stat tiles) | ring `.06` |
| `shadow.card` | `0 1px 2px rgba(27,25,23,.04), 0 6px 20px rgba(27,25,23,.05)` (declared shadow-2) | ring `0 0 0 1px rgba(255,255,255,.06)` |
| `shadow.page` | `0 12px 32px rgba(27,25,23,.14)` (declared shadow-3) | ring `.08` |
| `shadow.heroAi` | `0 1px 2px rgba(27,25,23,.04), 0 12px 32px rgba(91,92,226,.10)` | ring `.06` |
| `shadow.ctaPrimary` | `0 8px 24px rgba(91,92,226,.28)` | `0 8px 24px rgba(91,92,226,.25)` (kept in dark) |
| `shadow.ctaInk` | `0 8px 24px rgba(27,25,23,.18)` | n/a (the ink CTA becomes primary in dark) |
| `shadow.composer` | `0 1px 2px rgba(27,25,23,.06), 0 8px 24px rgba(27,25,23,.08)` | `0 0 0 1px rgba(255,255,255,.08), 0 8px 24px rgba(0,0,0,.35)` (kept) |
| `shadow.segmentThumb` | `0 1px 3px rgba(27,25,23,.12)` | none |
| `shadow.knob` | `0 1px 3px rgba(27,25,23,.20)` (warm ink; PRIMARY pure black, D-15) | same |
| `shadow.toast` | `0 10px 30px rgba(27,25,23,.25)` | ring `.08` |
| `shadow.modal` | `0 20px 50px rgba(27,25,23,.25)` | ring `.08` |
| `shadow.sheet` | `0 -10px 40px rgba(27,25,23,.12)` | none (the scrim separates) |
| `shadow.inkCard` | `0 12px 32px rgba(27,25,23,.18)` | indigo card `0 12px 32px rgba(91,92,226,.25)` |
| `shadow.swipe` | `±8px 0 24px rgba(27,25,23,.10)` | ring `.06` |
| `shadow.play` | `0 10px 30px rgba(0,0,0,.25)` (on night, both schemes) | same |
| `shadow.float` | `0 20px 50px rgba(27,25,23,.14)` (onboarding tilted cards) | ring `.08` |
| Rings | focus `0 0 0 2px border.focus`; error `0 0 0 2px border.error`; selected `0 0 0 2px brand.primary` | as tokens |

**React Native:** use the `boxShadow` style string (New Architecture, RN ≥ 0.76, SDK 57). On Android API < 28, a helper maps it to `elevation` (card → 2, page → 6, sheet → 12) because outset box-shadow is unsupported there. **Dark rule:** no drop shadows except `ctaPrimary`, `composer` and the indigo prep card; hairline rings instead.

### 2.11 Borders, dividers, overlays, glass

- **Dividers:** `border.hairline` between rows, never above the first row. `border.row` (.07) on timeline rows. `.08` on weekly rows. `.12` on the weekly top rule. Dark `.06` (`.10` on gradients).
- **Scrim:** `overlay.scrim`, animated 0 → .35 over 250 ms.
- **Glass:** tab bar on iOS only (`expo-blur` intensity mapped to 20 px). When iOS *Reduce Transparency* is on, and always on Android, the bar is an opaque `surface` (DEV-20). Onboarding glass cards (2.12) use `overlay.glassCard`.
- **Selected ring:** `0 0 0 2px brand.primary`. **Pressed card fill:** `surfacePressed`.

### 2.12 Iconography

#### 2.12.1 Conventions

- **Library:** Material Symbols Rounded, GRAD 0, weight 400 (the codegen source `@material-symbols/svg-400` ships only wght 400).
- **Implementation:** React Native cannot drive variable-font axes, so a codegen step builds React components from outline and `-fill` SVGs (§8.2).
- **FILL rules:**
  - FILL 0 by default.
  - FILL 1 for: the active tab; `auto_awesome`/`star_shine` in kickers, logos and "Uygun zamanda"; `check_circle` for done or selected; `star` (VIP); `play_arrow`/`pause`; the selected radio; `verified_user` in reassurance lines; the plan-card selected dot.
  - PRIMARY's active-tab `wght 500` is not reproducible and is replaced by FILL 1 at wght 400 (DEV-15).
- **Sizes:** 20 (buttons, settings), 17 (inside 28/30 tiles), 22 (card actions, life tile, checks), 18 (chips, header pills), 16 (source line, AI kicker), 26 (tab bar, swipe), 15 (meta chips), 24 (system grid, selection), 30 (empty state, ±15), 36 (voice mic), 40 (play), 44/48/50 (success, analysis ring).
- **Default colours:** tile icons `icon.default`; source line `text.tertiaryStrong`; idle card actions `icon.idle`; chevrons `icon.chevron` (decorative); AI `icon.ai`; semantic icons per §2.5.
- **Accessibility:** icon-only controls always carry `accessibilityRole="button"` and a Turkish `accessibilityLabel` (for example "Geri", "Kapat", "Diğer seçenekler", "Tamamlandı olarak işaretle", "Paylaş", "Ara"). Decorative icons set `accessible={false}` / `importantForAccessibility="no"`.

#### 2.12.2 Full icon list by concept (PRIMARY, verified)

`(sys)` marks the 32 system icons in `P:01 ICONS`. `→` marks a codegen alias (§2.12.3).

| Concept | Icons (name → meaning) |
|---|---|
| Navigation / tabs | `sunny` Bugün (sys) · `dynamic_feed` Akış (sys) · `calendar_today` Plan (sys) · `auto_awesome`→`star_shine` Asistan tab, AI marker, brand mark, "Uygun zamanda", suggested (sys) · `arrow_back` Geri (sys) · `close` dismiss · `chevron_right` İleri / disclosure (sys) · `expand_more`→`keyboard_arrow_down` / `expand_less`→`keyboard_arrow_up` accordion, audio collapse · `more_horiz` Menü (sys) · `arrow_outward` suggested-question row · `arrow_upward` chat send · `arrow_forward` · `arrow_downward` onboarding illustration · `open_in_new` "Orijinali Aç" · `ios_share` share |
| AI, learning, trust | `psychology` Öğrenme / "Öğrendim" (sys) · `memory` AI hafıza (Pro) · `verified` provenance line · `verified_user` Güvence (sys) · `trending_up` "daha sık göster" · `trending_down` learned low-priority · `remove_circle`→`do_not_disturb_on` "Önemli değil" · `visibility_off` "Takip etme" · `visibility` "AI'ın eriştiği veriler" · `record_voice_over` tone preference · `target` meeting purpose · `lock` Pro-locked / security footnote · `block` "reklam amacıyla kullanılmaz" · `admin_panel_settings` corporate policy · `shield` Güvenlik (sys) |
| Priority / mail intelligence | `priority_high` Önemli · `low_priority` Düşük öncelik · `info` Bilgilendirme · `person` Kişi / senden cevap bekleyen (sys) · `schedule_send` Takip / senin cevap beklediğin (sys) · `flag` Son tarih (sys) · `handshake` Taahhüt (sys) · `task_alt` Onay (sys) · `star` VIP (sys) · `mark_email_read` empty follow-up · `done_all` empty Today · `mail` (sys) · `outgoing_mail` rule "Gönderici" · `alternate_email` domain rule · `match_word` keyword rule · `sell` topic, price, promotion · `tune` Öncelik Kuralları |
| Calendar / plan | `event` Etkinlik (sys) · `event_available` Planla · `event_repeat` Taşı (sys) · `event_busy` calendar permission denied · `edit_calendar` Kendin seç · `calendar_month` · `today` · `groups` meeting · `videocam` online meeting · `self_improvement` gap / focus · `bolt` density · `directions_car` travel · `medical_services` appointment · `schedule` time, snooze, countdown · `wb_twilight` evening / brief times · `wb_sunny` "Yarın sabah" · `bedtime` evening close / "Yarına Hazırım" · `weekend` · `alarm` "Alarm Kur" · `history` last contact, retention, offline brief |
| Life intelligence | `package_2` Kargo (sys) · `local_shipping` · `flight` Uçuş (sys) · `restaurant` Rezervasyon (sys) · `receipt_long` Ödeme (sys) · `autorenew` Abonelik (sys) · `confirmation_number` · `account_balance` · `account_balance_wallet` Finans · `shopping_bag` Alışveriş · `work` İş · `family_restroom` Aile · `select_all` Hepsi · `chat` · `forum` |
| Capture / files | `add_a_photo` Yakala (sys) · `photo_camera` · `screenshot`→`screenshot_frame` · `picture_as_pdf` · `link` · `content_paste` · `folder_open` · `article` · `bookmark` "Hafızaya kaydet" · `description` · `attach_file` · `add_task` · `edit_note` Taslak (sys) · `edit` · `short_text` Kısalt · `location_on` · `call` · `contacts` |
| Reminders | `notifications` Hatırlatıcı (sys) · `notifications_active` Her zaman bildir · `notifications_off` Sessize al |
| Voice / audio | `mic` Ses (sys) · `headphones` Dinle (sys) · `play_arrow` · `pause` · `replay` ±15 (forward is the mirrored glyph `scaleX(-1)` plus the "15" label, because there is no 15-s glyph) · `graphic_eq` playing chapter · `keyboard` text mode · `send` Mail gönder |
| Selection / status | `check` · `check_circle` Tamamla (sys) · `radio_button_unchecked` · `add` · `delete` · `delete_sweep` · `person_add` · `person_remove` · `content_copy` · `download` · `download_for_offline` |
| Errors / states | `error` Çakışma (sys) · `link_off` · `wifi_off` · `cloud_off` · `sync_problem` · `sync` · `hourglass_top` · `celebration` |
| Settings / app | `workspace_premium` · `all_inclusive` (paywall row, **not shipped**, DEV-34) · `contrast` Görünüm · `language` Dil · `format_size` · `animation` · `vibration`→`mobile_vibrate` · `help` · `rate_review` · `settings` · `logout` |
| Brand mark | `auto_awesome`→`star_shine` FILL white on `#5B5CE2` rounded square: 36/r11 (glyph 20), 56/r18 (30), 96/r30 white tile with indigo glyph (2.1), widget 22/r7 (14), share card 84/r26 |
| **Never shipped** | `signal_cellular_alt`, `wifi`, `battery_full` (mock status bar); `ios` (Apple-logo stand-in: use the official Sign in with Apple button); motion-table glyphs `swipe`, `unfold_more`, `vertical_align_top` |

**Derived icons for production-only surfaces** (all verified present):

- **Mobile:** `thumb_up`/`thumb_down` (assistant answer feedback), `search` (Today search, DEV-24), `refresh`, `undo`, `mobile` (device calendar row), `key` (auth), `qr_code_2` (web CTA), `dark_mode`/`light_mode`.
- **Backoffice:** `space_dashboard` Dashboard · `group` Users · `support_agent` Support · `hub` Integrations · `sync_alt` Sync & Jobs · `wb_twilight` Briefings · `notifications` Notifications · `smart_toy` AI Operations · `tune` Model config · `terminal` Prompts · `rate_review` AI feedback · `workspace_premium` Subscriptions · `redeem` Referrals · `feedback` Feedback · `toggle_on` Feature Flags · `campaign` Announcements · `policy` Data Requests · `history_edu` Audit Logs · `monitor_heart` System Health · `admin_panel_settings` Admin Users · `settings` · `filter_alt` · `view_column` · `download_2` · `more_vert` · `menu` · `visibility` (reveal PII) · `content_copy` · `logout`.

#### 2.12.3 Codegen aliases (names missing from `svg-400@0.47.5/rounded`)

| Design name | Codegen source | Note |
|---|---|---|
| `auto_awesome` | `star_shine` / `star_shine-fill` | Same sparkle glyph (renamed upstream). The component is exported as both `IconAutoAwesome` and `IconStarShine`. |
| `expand_more` | `keyboard_arrow_down` | Identical chevron |
| `expand_less` | `keyboard_arrow_up` | Identical chevron |
| `remove_circle` | `do_not_disturb_on` | Minus-in-circle glyph |
| `screenshot` | `screenshot_frame` | Closest glyph. Visually approved in the codegen gallery (§8.2). |
| `vibration` | `mobile_vibrate` | Closest glyph |

### 2.13 Motion

- **Easing:** standard `cubic-bezier(.2,.8,.2,1)` (Reanimated `Easing.bezier(0.2,0.8,0.2,1)`); exit `ease-out`; spinners and shimmer linear.
- **Cap (verbatim):** "Hiçbir animasyon 600 ms'yi geçmez; kullanıcı beklerken animasyon değil bulgu gösterilir."
- **Reduce motion (verbatim):** "'Hareketi azalt' açıkken tüm süreler 0, yalnızca opaklık geçişi 120 ms kalır." The flag is `useReducedMotion()` OR `user_preferences.reduce_motion`. With it on: shimmer becomes a static `skeleton.base`, loops (waveforms, pulse, typing) stop at a mid frame, and the onboarding tilt is removed.

| Interaction | Behaviour | Timing | Haptic |
|---|---|---|---|
| Briefing open | hero fades from .4 opacity + translateY 8 → 0; count animates 0 → N; cards enter staggered | hero 0–240 ms; count 240–600 ms; cards start at 360 ms, 60 ms stagger, 280 ms each, all ≤ 600 (normalised, D-30) | none |
| AI processing | button spinner; shimmer over the card; no progress bar | shimmer 1.6 s linear ∞; spinner .8 s | none |
| Priority completed | icon fills `tone.success.solid`; card scale .96 + fade (+translateY −6); list reflows; toast | icon 160; card 300; list 300 | success |
| Swipe actions | right: Tamamlandı; left: Ertele / Önemli değil; threshold 35%; a full swipe auto-applies | tracks 1:1; release 260 ms spring (damping 20, stiffness 220) | light at threshold |
| Approval | button → "Onaylandı"; badge → green; card moves to history | button 200; badge 160; card 320 | success |
| Audio playback | bars animate; play ↔ pause; chapter row highlighted | bars .7–1.2 s alternate (stagger i × 60 ms); icon 120 | light |
| Loading | skeleton at real card size; titles render instantly | shimmer 1.6 s; fill 60 ms stagger | none |
| Sync | pull-to-refresh draws a 2 px indigo line at the top, then shows "Güncel · HH:mm" | line 400; message 1.5 s | light |
| Card expansion | "Orijinal Mail" and long summaries expand in place | height 280; chevron 200 rotate | none |
| Sheet | slides up; 35% ink scrim; drag to close with velocity snap | open 300; close 240; dim 250 | light on open |
| Success | green ring + icon scale .4 → 1; one-line summary; back button | ring 500; icon 450 at 100 ms delay | success |
| Button / card press | scale .97 (button) / .98 (card) + tone darkens | 120 | none |
| Chip / segment / tab colour | background and colour transition | 150 | light (selection) |
| Toast | enters translateY 16 → 0 + opacity; exits | 300 in / 300 out; visible 2.6 s; undo toasts 5 s (10 s with a screen reader) | per event |
| Voice pulse | ring scale .9 → 1.35, opacity .6 → 0 | 1.6 s ease-out ∞ | none |
| Typing dots | 7 px dots in `text.tertiaryStrong`, scaleY bars | .8 s, stagger 150 ms | none |

### 2.14 Haptics

- **Gating:** every call passes through `haptics.ts` in `packages/ui`, which checks `user_preferences.haptics_enabled` (default on, 7.8 "Haptik geri bildirim"). Rule (verbatim): "asla dekor için".
- **`success`** (`Haptics.notificationAsync(Success)`): complete, approve (only after the server confirms `executed`), send confirmed, reminder created, commitment saved.
- **`light`** (`impactAsync(Light)`, or `selectionAsync()` for selection): chip, segment and tab selection; swipe threshold; play/pause; sheet open; pull-to-sync.
- **`warning`** (`notificationAsync(Warning)`): conflict shown, error card shown on user action, validation error.
- **Platform:** iOS uses `UIFeedbackGenerator`; Android uses `HapticFeedbackConstants` through `expo-haptics`.

### 2.15 Contrast analysis (WCAG 2.2)

Thresholds: AA normal text 4.5; large text (≥ 24 px, or ≥ 18.66 px bold) 3.0; non-text UI (1.4.11) 3.0.

| # | Pair (fg / bg) | Ratio | Result | Minimal fix (DEV) |
|---|---|---|---|---|
| 1 | ink `#1A1917` / bg `#F5F4F0` · surface · paper | 15.96 · 17.57 · 16.83 | pass | — |
| 2 | ink/secondary `#6B6860` / surface · bg · surface-2 | 5.56 · 5.06 · 4.84 | pass | — |
| 3 | ink/secondary / segment track `#E9E7E1` | 4.4996 | **fail** | `ink/secondary-on-track` `#67645C` = 4.78 (DEV-05) |
| 4 | **ink/tertiary `#9B978E` / surface · bg · paper** | 2.91 · 2.65 · 2.79 | **fail** | `ink/tertiary-strong` `#6F6C66` = 5.23 · 4.76 · 5.01 (DEV-01) |
| 5 | inactive tab `#9B978E` / glass over bg | 2.89 | **fail** | `#6F6C66` = 5.19 (DEV-11) |
| 6 | idle card icons `#B8B4AA` / white (actionable) | 2.07 | **fail** (1.4.11) | `icon/idle` `#8F8B83` = 3.39 (DEV-06) |
| 7 | radio unchecked `#C9C5BC` / white | 1.72 | **fail** (1.4.11) | `control/radio-off` `#8F8B83` = 3.39 (DEV-07) |
| 8 | chevrons `#C9C5BC` / white | 1.72 | exempt (decorative next to a text label) | keep |
| 9 | switch-off track `#D9D6D0` / white | 1.45 | **fail** (1.4.11) | keep the fill; add a 1 px inset border `#8F8B83` (3.39) (DEV-08) |
| 10 | white / `brand/primary` · primary as text / white | 5.15 · 5.15 | pass | — |
| 11 | primary `#5B5CE2` as 12 px kicker / glow peak `#E4E4FA` | 4.12 | **fail** | kicker text `#4547C9` = 5.60; icon stays `#5B5CE2` (non-text, passes) (DEV-03) |
| 12 | ink/secondary / glow peak | 4.45 | **fail** | `ink/on-ai-glow` `#65625B` = 4.86 (DEV-04) |
| 13 | on-soft `#4547C9` / soft · white · suggested | 6.04 · 7.01 · 6.57 | pass | — |
| 14 | critical/text `#C7432F` / critical/soft · bg | 4.31 · 4.47 | **fail** | `critical/text-strong` `#BE3F2C` = 4.68 · 4.85 (DEV-02) |
| 15 | white / critical/text (destructive button) | 4.92 | pass | keep |
| 16 | warning/text `#9A6300` / warning/soft · bg · white | 4.55 · 4.59 · 5.05 | pass | — |
| 17 | success/text / success/soft · info/text / info/soft | 4.72 · 5.14 | pass | — |
| 18 | warning icon `#E09A1C` / white | 2.38 | **fail** (meaningful icon) | meaningful icons use `#9A6300` = 5.05 (DEV-09); dots next to text are exempt |
| 19 | critical `#E0553F` · success `#2FA062` · info `#3B82E6` icons / white | 3.79 · 3.32 · 3.80 | pass (non-text) | — |
| 20 | white 11 px on swipe track `#2FA062` | 3.32 | **fail** | track `#1E7A47` = 5.34 (DEV-10) |
| 21 | white .8 on dawn at *t* = .8 / *t* = 1 | 4.32 / 3.17 | **fail** | `on-gradient/secondary` .86 = 4.72 at *t* ≤ .8; full-bleed end stop `#5A5BD6` (DEV-12) |
| 22 | white .72 kicker on dawn at *t* = .6 | ≥ 5.0 | pass (only where *t* ≤ .6) | layout rule |
| 23 | white .8 on dusk at *t* = .8 | 4.36 | **fail** | .86 = 4.75 (DEV-12) |
| 24 | white .6–.8 on night, any *t* ≤ .9 | ≥ 4.64 | pass | — |
| 25 | toast: white · `#A9AAF5` · `#F08B78` / `#1A1917` | 17.57 · 8.16 · 7.25 | pass | — |
| 26 | on-primary dark `#0F0F2A` / `#8586F2` | 5.96 (PRIMARY caption claims 9:1) | pass | correct the claim (D-13) |
| 27 | dark text `#F2F0EB` / bg · surface | 16.30 · 14.64 | pass | — |
| 28 | dark secondary `#A39F96` / bg · surface · neutral-soft | 7.04 · 6.32 · 5.00 | pass | — |
| 29 | **dark tertiary `#7A776F` / bg · surface** | 4.15 · 3.73 | **fail** | dark `ink/tertiary-strong` `#8F8B83` = 5.47 · 4.91 (DEV-01) |
| 30 | dark idle icons `#5E5B54` / surface | 2.46 | **fail** (actionable) | `icon/idle` dark `#85827A` = 4.34 |
| 31 | dark secondary / dark glow peak `#3C3B57` | 4.07 | **fail** | `#B5B1A8` = 5.02 (DEV-04) |
| 32 | dark `#A9AAF5` / dark glow peak · surface | 4.99 · 7.74 | pass | — |
| 33 | dark tone texts on dark soft (critical, warning, success, info, primary) | 5.57 · 6.94 · 6.87 · 6.56 · 7.88 | pass | — |
| 34 | dark ink toast `#1A1917` / bg `#141311` (separation) | 1.28 | fails as a surface | `#2A2926` + ring `.08`; text 12.77 (DEV-13) |
| 35 | dark switch-off `rgba(255,255,255,.16)` / surface | 1.66 | **fail** (1.4.11) | 1 px inset border `#85827A` = 4.34 |
| 36 | avatars peach · blue · green · neutral | 6.55 · 7.98 · 6.91 · 4.84 | pass | — |
| 37 | `#1E5A36` / success/soft (assurance) | 7.21 | pass | — |
| 38 | `#A9F0C1` / ink · night | 13.32 · 10.18 | pass | — |
| 39 | `#C9C9FF` count / dawn at *t* = .6 | 5.54 | pass (large text) | — |
| 40 | white .75 / prep indigo `#4A4BC8` | 4.54 | pass (marginal) | use .8 = 4.93 |

**Rule:** the ratios above are regression fixtures. `packages/design-tokens/test/contrast.test.ts` asserts every allowed pairing (§8.4). Changing a token value without updating the pair matrix fails CI.

### 2.16 Dark-mode rules (M§38)

1. **Surfaces:** `bg` `#141311` and `surface` `#1F1E1B`. **Cards use a hairline ring instead of a shadow** (`0 0 0 1px rgba(255,255,255,.06)`; `.08` on controls, the tab bar top and composers).
2. **No hard-coded white.** Every surface comes from tokens. Test `packages/ui/test/dark-no-white.test.tsx` renders every exported component in dark and fails if any `backgroundColor` resolves to `#FFF`, `#FFFFFF` or `white`, except `onGradient` contexts, the play button (white on night) and the paywall radio inner ring.
3. **Inversions** (observed): the selected filter chip, segmented thumb, Today day chip and self avatar invert to `#F2F0EB` bg with `#141311` text. **The ink CTA becomes the dark primary** (`#8586F2` / `#0F0F2A` + glow). The Today "3 şey" / prep talking-points ink card becomes the `prep-card-dark` gradient.
4. **Ink surfaces** (Approval Center featured row, privacy promise card, offline banner, NextEventCard, Android 2×2 widget, toast) use `surfaceInk` dark = `#1F1E1B` + ring `.08`. The toast uses `#2A2926` + ring.
5. **Brand and tones:** indigo is lightened (`#8586F2`, glow `#A9AAF5` for markers, links and the active tab). Coral and amber use their lightened text variants. Soft backgrounds are 18% tints over the surface.
6. **Gradients** dawn, night and dusk are identical in both schemes.
7. **Editorial paper** in dark is `#141311`, with Lora text `#F2F0EB`.
8. **Status bar:** dark icons on light screens; light icons on dark screens and on gradient/immersive screens (briefing header, audio, voice, onboarding 2.1/2.10/2.11). Set per screen via `<StatusBar style>`.
9. **Coverage:** PRIMARY draws dark only for 3.2, 3.3D, 4.2, 5.1D, 5.5 and 6.1D. Every other screen is derived mechanically from the tokens above (DEV-67). The visual QA baseline is the 7 screens from SREQ C-23, but all screens ship in dark.
10. **Widgets:** iOS widgets support dark/tinted/clear rendering modes (iOS 18 `widgetRenderingMode`; accents wrapped in `widgetAccentable()`). Android Glance uses a night `ColorProvider` pair from `tokens.json`.

---

## 3. Component inventory — `packages/ui` (React Native)

### 3.0 Global component contract

- **Props:** components take semantic props (`tone`, `variant`, `size`, `state`), never colours. They read `useTheme()` and never import raw tokens for colour.
- **Pressable base (`PressableScale`):** scale .97 (buttons) / .98 (cards) over 120 ms; the pressed tone darkens via the pressed tokens; no Android ripple (visual parity); `android_disableSound`; `hitSlop` computed from the visual size up to 44/48.
- **Accessibility baseline:**
  - `accessibilityRole` and a label on every interactive element.
  - `accessibilityState` for disabled, selected, checked and busy.
  - `accessibilityActions` for every gesture (swipe, long-press).
  - Toasts and banners announce via `AccessibilityInfo.announceForAccessibility`, plus `accessibilityLiveRegion="polite"` on Android.
  - Sheets and dialogs set `accessibilityViewIsModal` and move focus to the title on open (`AccessibilityInfo.setAccessibilityFocus`). iOS `onAccessibilityEscape` closes them; Android hardware back closes sheets first.
- **Text:** `allowFontScaling` everywhere with per-token `mfs`; `minHeight` instead of `height`.
- **Motion:** every animated component honours reduce motion (§2.13).
- **testID:** `ui.<component>.<variant>` plus an instance suffix supplied by screens (used by Maestro).
- **No dead affordances (M§99, SREQ-85):** anything that looks pressable must be pressable. Illustrations (onboarding 2.2–2.4) render through `IllustrationFrame`, which sets `accessible` with a single description, `pointerEvents="none"` and `importantForAccessibility="no-hide-descendants"`.
- **Dark:** all specs below list light values; dark values follow the token mapping in §2.2–§2.4 and §2.16 unless stated otherwise.

### 3.1 Foundations

| Component | Anatomy / API | Spec | A11y |
|---|---|---|---|
| `Text` | `variant` = any §2.7 token; `tone` = primary/secondary/tertiaryStrong/disabled/link/onPrimary/onGradient…; `numeric`; `caps` (applies the i18n uppercase helper) | Family/weight from the token map; `includeFontPadding:false` | `accessibilityRole="header"` when `heading` is set (h1/h2/sheetTitle) |
| `Icon` | `name` (manifest key incl. aliases), `size`, `fill` (0/1), `tone` | Generated SVG component | `accessible={false}` unless `label` is given |
| `Surface` / `Card` | `elevation` (`card`/`s1`/`s1Soft`/`page`/none), `radius`, `padding`, `pressed` | light: `surface` + shadow; dark: `surface` + ring | a pressable card has `role=button` and a composed label |
| `AiGlowSurface` | `origin` tl/tr, `radius` | radial gradient, §2.6 | — |
| `InkSurface` | ink callout base | light `#1A1917`; dark `#1F1E1B` + ring `.08` | — |
| `GradientSurface` | `gradient` dawn/dawnFullbleed/night/dusk/prepDark | linear, §2.6 | enforces the text-safe tone helper `onGradientText(t)` |
| `Divider` | `variant` hairline/row/strong | 1 px (StyleSheet.hairlineWidth is not used; 1 px exactly) | hidden |
| `IllustrationFrame` | wraps non-interactive product parts (2.2–2.4) | `pointerEvents="none"`, tilt `rotate(±1.5–2deg)`, `shadow.float` (tilt removed under reduce motion) | single description label |

### 3.2 Buttons

**Heights (verbatim P:01):** "52 (sayfa altı CTA), 48 (kart içi), 40–42 (satır içi), 36 (ghost)".
**States (verbatim):** "Pressed: scale .97 + ton koyulaşır, 120 ms. Loading: metin '…' ile devam eder, spinner soldan; buton kilitlenir." Disabled = opacity .4.

| Component / variant | Light default → pressed | Dark | Loading label pattern | Sizes (h / radius / label token) |
|---|---|---|---|---|
| `Button` `primary` | `#5B5CE2` / `#FFF` → `#4B4CCB`; page CTA adds `shadow.ctaPrimary` | `#8586F2` / `#0F0F2A` → `#9596F5` | white spinner 16, "Gönderiliyor…" (i18n `*.loading`) | `lg` 52/16/`labelLg`, `md` 48/14/`labelLg`, `sm` 40/12/`label`, `inline` 42/12/`label`, `xs` 38/12/`labelSm`, `chat` 36/12/`labelSm` |
| `tonal` | `#EDEDFC` / `#4547C9` → `#DCDCF8` | `rgba(133,134,242,.16)` / `#C3C4F8` → `.24` | `#4547C9` spinner, "Hazırlanıyor…" | same |
| `neutralTonal` | `#F0EFEB` / `#6B6860` → `#E9E7E1` | `rgba(255,255,255,.08)` / `#A39F96` | ink spinner | same |
| `ink` | `#1A1917` / `#FFF` → `#000`; page CTA `shadow.ctaInk` | **becomes `primary`** | "Bekle…" | same |
| `surface` | `#FFF` / `#1A1917` + `shadow.s1Control` → `#F0EFEB`, no shadow | `#1F1E1B` / `#F2F0EB` + ring `.08` | ink spinner, "Yükleniyor…" | same |
| `destructive` | `#C7432F` / `#FFF` → `#A83726` | `#F08B78` / `#141311` → `#F4A393` | "Siliniyor…" | `lg`, `md`, `sm` |
| `inverse` (on gradient) | `#FFF` / `#25266A` (13.43) | same | `#25266A` spinner | `lg` |
| `ghost` / `text` | transparent, `#4547C9` (primary) or `#6B6860` (secondary), pressed bg `#EDEDFC` / `#F0EFEB`, padding 0/10, radius 10, `label` 14/600; in cards margin-left −10, gap 14, max 2 per card | `#A9AAF5` / `#A39F96`, pressed tonal dark | — | 36 (hitSlop 4 vertical); text-button 44/14 (`#6B6860` 14/600) under CTAs |
| `IconButton` | 36 circle `#FFF` + `shadow.s1Control`, glyph 20 `text.primary`; on gradient `rgba(255,255,255,.16)` (`.14` on night) | `#1F1E1B` + ring `.08` | — | 36 (hitSlop 4); `mic` 40 `#5B5CE2`/`#FFF`; `send` 40 `#1A1917`/`#FFF` (dark `#F2F0EB`/`#141311`); `play` 76 `#FFF` glyph `#25266A` 40 FILL + `shadow.play`; `skip15` 52 transparent (`replay` 30 + "15" 10/600, mt −6) |
| `CardIconAction` | 36×36 transparent, glyph 22 `icon.idle`; pressed: complete → `#2FA062` on `#E4F5EA`; more → `#6B6860` on `#F0EFEB` | glyph `#85827A` | — | 36 (hitSlop 4) |
| `ActionTile` (Mail 2×2) | 56h, radius 16, padding 0/14, `label` + icon 20; primary tile `#5B5CE2`/`#FFF`; others `#FFF` + icon `#5B5CE2` + `shadow.s1` | primary dark; others `#1F1E1B` + ring, icon `#A9AAF5` | spinner replaces the icon | grid gap 10 |
| `AuthProviderButton` | 52/16 `labelLg`, gap 10. Apple uses `AppleAuthenticationButton` (HIG black/white); Google uses the official "G" mark on white per Google branding; Microsoft uses the official 4-square logo; E-posta is `surface` + `mail` icon, text `#4547C9` | per brand rules; dark via Apple's white style | per-button spinner (other buttons disabled) | order: iOS Apple first; Android Google first |
| `OutlineAddButton` | 48/14 `#FFF`, `#4547C9` 14/600, `add` 20, `shadow.s1` | `#1F1E1B` + ring, `#A9AAF5` | — | — |

**A11y:** `role=button`; the label is the visible text (loading label is announced); disabled uses `accessibilityState.disabled`; loading uses `busy:true` plus disabled.

### 3.3 Badges, pills, chips

**Rule (verbatim):** "Rozet: 11/700, +0.05em, pill, 3×8 dolgu. Filtre çipi: 34 yüksek, seçili = ink zemin. Meta çipi: 30 yüksek, ikon 15."

| Component | Spec (light) | Dark | A11y |
|---|---|---|---|
| `Badge` | `badge` 11/700 +0.55, pill, padding 3×8 (header variant 4×9), tone per §2.4; `size="sm"` 10/700 padding 2×6 (onboarding, widget, 2.2); text uppercase via i18n | tone map dark | read as part of the parent label (not focusable) |
| `StatusPill` | same as `Badge` plus optional leading 12 px spinner (İŞLENİYOR) | — | `accessibilityLabel` includes the status |
| `ConnectPill` (2.6) | 34h, padding 0/12, radius 999, `labelSm`, icon 16. Connect state `#EDEDFC`/`#4547C9` `add` "Bağla"; connected `#E4F5EA`/`#1E7A47` `check` "Bağlandı"; connecting: spinner "Bağlanıyor…"; `needs_reauth` critical-soft `link_off` "Yeniden bağlan"; error critical "Hata" | tone dark | `role=button` |
| `FilterChip` | 34h, padding 0/14, `labelSm`. Selected `#1A1917`/`#FFF`. Unselected: container-relative bg (`surface` on `bg`, `bg` on `surface`), text `#6B6860`. 150 ms transition | selected `#F2F0EB`/`#141311`; unselected `#1F1E1B`/`#A39F96` | `role="radio"` in a `radiogroup` row (tab semantics for view filters); hitSlop 5 |
| `FilterChip` `compact` (memory) | 30h, padding 0/10, `labelXs` | same | same |
| `MetaChip` | 30h, padding 0/10, `labelXs`, icon 15, gap 4, `#F0EFEB`/`#6B6860`; VIP variant `#EDEDFC`/`#4547C9` + `star` FILL; `editable` variant adds a pressed state and opens a picker | tone dark | editable → `role=button` "Tarihi düzenle: 12 Eylül" |
| `CountdownPill` | 30h, padding 0/10, `labelXs`, `schedule` 15, `#FDF2DC`/`#9A6300`; text computed live ("18 dk", 1-min ticks; "Başladı" after start). **Join variant** (DEV-40): `#EDEDFC`/`#4547C9`, `videocam`, "Katıl · 4 dk" | `rgba(217,139,11,.18)`/`#F0B85A` | live value in label; `accessibilityLiveRegion` off (no spam) |
| `HeaderPill` | 34–36h, padding 0/12/0/9, `labelXs`, icon 18, `#FFF` + `shadow.s1`; tint brand (`#4547C9`: "{N} onay", "Ekle") or neutral (`#6B6860`: "Hafıza", "Yeni sohbet"); primary fill (`#5B5CE2`/`#FFF`: "Kişi Ekle") | `#1F1E1B` + ring, `#A9AAF5`/`#A39F96` | `role=button`, label with count ("2 onay bekliyor") |
| `AssistChip` / `SuggestionChip` | 30h, padding 0/10, `labelXs`, icon 15; neutral `#F0EFEB`/`#6B6860`; soft `#EDEDFC`/`#4547C9`; selected ink; white + `shadow.s1` | dark tones | `role=button` |
| `TokenChip` (7.11 keywords) | 34h, padding 0/6/0/12, `#EDEDFC`/`#4547C9`, trailing `close` 16; `add` variant dashed 1 px `#C9C5BC` (the only other dashed use, allowed as an "input-to-be" affordance; lint allow-listed) | tone dark | remove action "“teklif” kelimesini kaldır" |
| `ChoiceChip` (2.7c providers, 4.13c types) | 30h, `labelXs`; selected `#1A1917`/`#FFF` + `check` 14; unselected `#F5F4F0`/`#6B6860` (or white + `shadow.s1` on bg) | inverted | `role=radio` |
| `SourceChip` (KAYNAKLAR) | 30h, padding 0/10, `#FFF`, 12/500, icon 15 `#6B6860`, `shadow.s1` | `#1F1E1B` + ring | opens the source |
| `FollowUpChip` / `VoicePromptChip` | 30h `#FFF` 12/600 `#6B6860` `shadow.s1` / 36h `rgba(255,255,255,.12)` 13/500 white | — | `role=button` |
| `PlanBadge` | "PRO" primary tone padding 2×8, 11/600 | — | — |

### 3.4 Headers and navigation

| Component | Spec | A11y |
|---|---|---|
| `RootHeader` (tab roots) | kicker date ("23 EYLÜL SALI", `kicker`, uppercase, computed) + `h1` greeting/title; trailing slot (HeaderPill[], `IconButton search` (Today, DEV-24), `Avatar` 40 ink → profile); aligned to flex-end; padding 0/20; top `insets.top + 14`. Greeting by local time: 05–11 "Günaydın", 11–18 "İyi günler", 18–05 "İyi akşamlar", with comma ("Günaydın, Yunus", D-22) | h1 is `role=header`; avatar label "Profil ve ayarlar" |
| `DetailHeader` | 36 `IconButton` (back `arrow_back` / close `close` / collapse `keyboard_arrow_down`) + centred `kicker` + trailing slot (badge, CountdownPill, VIP pill, speed pill, text action, or 36 spacer); top `insets.top + 6`; on gradient uses translucent buttons | back label "Geri"; kicker is `role=header` |
| `GradientHeader` + `OverlappingSheet` | header padding 0/20/60 (dusk 56); kicker margin-top 36 (dusk 32) opacity .72; title `titleGradient` (dusk `titleXl`); sub 16/22 `on-gradient/secondary`; sheet margin-top −28, radius 28/28/0/0, bg `bg`, padding 26/20/(footer+16), gap 22 | header title `role=header` |
| `TabBar` (custom; not native Liquid Glass, DEV-20) | height `62 + insets.bottom`, items padding 8/8, 4 equal items; icon 26 + `tabLabel` 11/500, gap 3. Active `#5B5CE2` FILL 1; inactive `#6F6C66` FILL 0 (DEV-11); iOS glass `rgba(255,255,255,.92)` + blur 20 + top hairline `.06`; Android opaque `surface` + hairline. Labels Bugün `sunny`, Akış `dynamic_feed`, Plan `calendar_today`, Asistan `auto_awesome`. Hidden on pushed screens and inside chat. Re-tap on the active tab pops to root and scrolls to top. MiniPlayer docks above | `role="tablist"`/`"tab"`, `selected` state, labels = tab names; optional badge `accessibilityValue` |
| `StepHeader` (onboarding) | back 36 + kicker "ADIM n / 6" + trailing ("Atla" 14/600 `#6B6860` or 36 spacer) (DEV-36) | "Adım 2 / 6" label |
| `PageDots` | active 20×6 radius 3 (`#1A1917` or `#FFF` on gradient), inactive 6×6 (`#C9C5BC` or `rgba(255,255,255,.4)`), gap 6 | `accessibilityRole="adjustable"`, value "Sayfa 2 / 4" |

### 3.5 Lists, section headers, rows

| Component | Spec | A11y |
|---|---|---|
| `SectionHeader` | `kicker` (+ optional trailing count 12 `text.tertiaryStrong`, baseline-aligned) padding 0/4/8 or 4/4/0; variants: `dot` (6 px tone dot, group label in tone text), `tone` (success "OKUR" `#1E7A47`, critical "HİÇBİR ZAMAN OKUMAZ" `#BE3F2C`) | `role=header`; count read ("5 konu") |
| `GroupedList` | `surface`, radius 18, `shadow.card`, padding 4/16 or 0/16; children rows get the hairline divider except the first | — |
| `ListRow` | IconTile 30 radius 10 (`#F0EFEB`/`#6B6860`, glyph 17) or bare icon 20 in a 24 slot; title `rowTitle`; sub `meta` mt 1; trailing chevron 18 (`icon.chevron`) / value 13 `text.tertiaryStrong` / Switch / check / radio / link text ("Yönet" 13/600 `#4547C9`) / Badge; min-height 50 (52 settings, 56 two-line, 60 two-line + trailing); padding 11/0; destructive variant: title and icon `critical/text-strong`, "gizlenmez" | row `role=button` (nav) with label "Brifing, 08:00 · 13:00 · 19:00"; switch rows expose `role=switch` on the whole row |
| `CategoryRow` (4.3) | tile 30 radius 10 (hot `#EDEDFC`/`#4547C9`, else neutral); label 15/500 flex; count 15/600 (hot `#5B5CE2`, else `#6B6860`); chevron | "Önemli, 3 mail" |
| `OptionRow` (sheets) | min-h 52 (60 two-line), top hairline, icon 20 in a 24 slot `#6B6860`, label 15/500, meta 12 `text.tertiaryStrong` right; `ai` variant icon `auto_awesome` FILL `#5B5CE2`, meta 12/600 `#4547C9`; `recommended` bg `#F7F7FE`, radius 12, margin 0/−8, padding 0/8, trailing `check_circle` FILL `#5B5CE2`; `disabled` opacity .4 with reason meta | `role=radio` (single choice) or `button`; disabled reason in the label |
| `ChecklistRow` (3.6) | icon 22: done `check_circle` FILL `#2FA062` + text 15 `#6B6860` line-through + time meta; open `radio_button_unchecked` `control.radioOff` + 15/500; follow-up `schedule_send` `#6B6860` | `role=checkbox` with checked state; action "Tamamlandı olarak işaretle" |
| `TimelineRow` (3.5) | time 44w 13/600 `#6B6860`; title 15/500; status 12/600 in tone | — |
| `KeyValueGrid` | columns `64px 1fr` (52px in commitments, 56px in capture rows), gap 6/10, `bodyXs`; labels `text.tertiaryStrong`, values `text.primary` | read as "Neden: …" |

### 3.6 Cards

| Component | Anatomy | Exact styles (light) | States | A11y |
|---|---|---|---|---|
| `PriorityCard` (Today, 3.1) | Row 1: Badge + time (`meta`); right: `CardIconAction` complete + more (mr −8). Title `h3` (mt 6), optional sub `secondary` (mt 4), `SourceLine` (mt 10), ≤ 2 text actions (mt 6, padding 8/0, gap 14; primary `#4547C9`, secondary `#6B6860`) | `surface`, radius 20, padding 14/16/10, `shadow.card`. **Rule:** "rozet (yalnızca anlam), başlık, kaynak satırı, en fazla 2 aksiyon" | default · pressed (`surfacePressed`, .98) · removing (§2.13) · done (icon success, strikethrough `#6B6860`) · action-loading (text action shows spinner) · error-inline (08 `state/error`) · swiped | whole card `role=button` → source detail; label "ACİL, 08:42. {title}. Kaynak: Gmail, Ahmet Yılmaz, 08:42"; actions: complete, snooze, dismiss, why, more |
| `AttentionCard` (Akış, 4.1) | Row: IconTile 28 radius 9 + source 12 (ellipsis) + Badge + time; title `h3Sm` (mt 10, pretty); summary `secondary` (mt 4); 1 text action (padding-top 8) | radius 20, padding 14/16/10, `shadow.card`; tile `#F0EFEB`/`#6B6860` (security tile critical-soft) | same as PriorityCard; AI summary failure → subject + "Özet hazırlanamadı" | same |
| `AiCard` | kicker (`auto_awesome` FILL 16 + `kickerAi`); title `h3Sm` 16/23; body `secondary` in `ink/on-ai-glow`; actions (mt 12, gap 8): primary `sm` 40 with icon + ghost 40; or chips; or bullets (6 px `#5B5CE2` dots, 14/20); or nested items | `AiGlowSurface` tl, radius 20, padding 16, `shadow.card` | default · accepted ("Planlandı" `#E4F5EA`/`#1E7A47` + `check`) · pending approval ("Onay bekliyor" warning pill) · loading (shimmer) · dismissed (collapse 300 ms) | kicker `role=header` |
| `BriefingHero` | kicker (AI icon + `kickerAi` "BRİFİNG HAZIR · 07:58"); sentence `hero` with coloured count; context `secondary`; buttons row (mt 18, gap 10): primary `md` flex "Brifingimi Gör" + tonal `md` padding 0/16/0/12 `play_arrow` FILL 20 "Dinle · 2 dk" | `AiGlowSurface` tr (stop 58%), radius 28, padding 22/22/20, `shadow.heroAi` | Modes: `morning`, `generating` (kicker spinner "BRİFİNG HAZIRLANIYOR…" + skeleton bars 85%×22, 55%×22, 40%×12 + button placeholders), `preBrief` ("Brifingin 08:00'de hazır"), `midday`, `middayEmpty`, `evening` ("AKŞAM KAPANIŞI HAZIR"), `night` (after "Yarına Hazırım"), `done` (DEV-65), `weekly` (Sunday), `offline` (kicker `history` "BRİFİNG · 07:58 · ÇEVRİMDIŞI"; audio button disabled "İndirilmedi" if not cached), `firstDay` | sentence `role=header`; listen button "Brifingi dinle, 2 dakika" |
| `ProGateCard` (7.6) | kicker `lock` + "ÖĞLE NABZI · PRO" `kicker`; `h2` value sentence; body `secondary`; two neutral placeholder bars 44 radius 12 `#F5F4F0` (never real blurred content); buttons 44/14: primary flex (trial label only when eligible, else "Pro'ya Geç") + neutralTonal "Şimdi değil" | `surface`, radius 28, padding 22 | hidden when count = 0 or dismissed < 7 days | — |
| `LifeCard` (4.9) | tile 44 radius 14 (glyph 22; neutral, security critical) + `typeLabel` kicker (+0.88) + time; title `h3`; sub `secondary`; ≤ 2 actions 13/600 (`#4547C9` / `#6B6860`) gap 14 | radius 20, padding 16, gap 14 | action hidden when its data is not in the source (DEV-64) | card opens `life/[id]` |
| `MailSummaryCard` (4.3) | Avatar 28 + name 13/600 + optional Badge + time; body `bodySm`; action 14/600 | radius 20, padding 14/16/10 | unread (name 600 → title bold, SECONDARY idea; optional) | — |
| `FollowUpCard` (4.6) | Avatar 40 + name 16/600 + topic 13 `#6B6860` + days `StatusPill` (26h, padding 0/9, 12/600, tone by threshold); status 15/21; SourceLine `schedule_send`; buttons 38/12: tonal "Takip Mesajı Hazırla", neutralTonal "Yarın Hatırlat", ghost right "Kapat" | radius 20, padding 16 | resolved-by-reply (collapses with a toast) | swipe actions + label |
| `WaitingCard` (4.7) | Avatar 40 + name 15/600 + wait meta; topic 13; expectation 14/20; footer deadline 12/600 (tone) + "Yanıtla" 13/600 `#4547C9` | radius 18, padding 14/16 | undated → no deadline | — |
| `CommitmentCard` (4.8) | StatusPill + date; quote `editorialQuote` in “ ”; KeyValueGrid (52px: Taahhüt / Kime / Kaynak); buttons 38/12: tonal "✓ Tamamlandı" (`check` 16), neutralTonal "Ertele", ghost right "Kaynağı Gör" | radius 20, padding 16 | TAMAMLANDI: only "Kaynağı Gör" (D-33); `needsConfirmation` variant: kicker "BU BİR SÖZ MÜ?" + buttons "Evet, takip et" / "Hayır" (M§18) | — |
| `CalendarIntelCard` (5.2) | icon 20 (tone text colour, mt 1) + title 15/600 + body 13/19 `#6B6860` + ≤ 2 text actions 13/600 gap 14 | `surface`, radius 16, padding 14/16 | action in-flight / pending approval / failed | — |
| `InkCallout` | icon (`#A9AAF5`) + title 15/600 white + sub 12 `rgba(255,255,255,.65)` + chevron .6 | `surfaceInk`, radius 18, padding 14/16 (promises: radius 24, padding 20, `verified_user` 20 `#A9F0C1`, rows 15/21; offline banner: radius 14, padding 10/14) | — | — |
| `TalkingPointsCard` (5.4) | kicker `#A9AAF5` + `auto_awesome`; 3 items gap 14: number circle 26 `rgba(255,255,255,.12)` 13/600, title 17/600, body 14/20 `rgba(255,255,255,.7)` (dark .8) | light `#1A1917` radius 24 padding 20 `shadow.inkCard`; dark `prep-card-dark` + kicker `#D6D6FB` | loading (skeleton in ink) | each point long-press → "Bu nereden çıktı?" |
| `SourceResultCard` (6.5) | tile 28 radius 9 + source 12 + date; title 15/21 500 (mt 8); quote/summary 14/20 `#6B6860`; link "Orijinali Aç" 13/600 `#4547C9` + `open_in_new` 16 | radius 18, padding 14/16 | — | — |
| `StatTile` | label 11–12 `text.tertiaryStrong` + value 15–16/600 (tone optional) | `surface`, radius 16, padding 12–14, `shadow.s1Soft` | — | pressable when it links |
| `RichAnswerCard` (6.2) | kicker `kicker`; rows padding 10/0, hairline, gap 10: Avatar 32 or icon 18 `#5B5CE2` + title 14/600 + meta 12 + Badge + inline action 13/600 | `surface`, radius 16, padding 12/14 | row loading | each row `role=button` |
| `DraftCard` (6.2, compact) | kicker `auto_awesome` + "TASLAK · {KİŞİ}" `kickerAi`; preview 14/20 2-line clamp; buttons 36/12: primary "Göndermeyi Onayla", tonal "Düzenle" | radius 16, padding 12/14 | executing / sent / failed mirror ApprovalCard | — |
| `ApprovalCard` | see §3.7.1 | | | |
| `ErrorCard` (08) | IconTile 36 radius 11 (tone) + title 15/600 + body `bodyXs` + ≤ 2 text actions 13/600 (primary `#4547C9`, secondary `#6B6860`) | `surface`, radius 18, padding 14/16, gap 12 | variants in §3.9 table | `role=alert` on appear (announce) |
| `EmptyState` (08) | circle 60 tone bg + glyph 30; title `sheetTitle`; body `secondary`; CTA 38/12 `#FFF` `#4547C9` 13/600 `shadow.s1` | centred, padding 28, gap 12 | variants in §3.9 table | title is `role=header` |
| `SuggestedSurface` (dashed "proposed" block) | icon `auto_awesome` 18 + title 15/600 + meta "Önerilen · 45 dk · AI görev bloğu" (`#4547C9`) + optional label "Önerilen · henüz gerçek değil" | `#F7F7FE`, 1 px dashed `#A9AAF5`, radius 14, padding 10/14 → after executed `#EDEDFC` + 1 px solid `#5B5CE2` | proposed · pending approval (warning pill "Onay bekliyor") · executing (spinner) · executed (solid) · failed ("Takvime eklenemedi · Tekrar dene") | label "Önerilen, henüz takvimde değil: …" |
| `GapBlock` | icon `self_improvement` `#B8B4AA` + "2 saat boşluk" + meta | transparent, 1 px dashed `border.gapDashed`, radius 14 | tap → sheet "Odak bloğu öner / Görev yerleştir" | `role=button` |
| `ConflictPair` (5.3) | card A (`surface` radius 16 padding 14/16: time 14/600 48w, title 15/600, meta 12, trailing icon 18) and card B (`plan.life` + hairline, margin-left 24) + absolute 16×2 `#E0553F` overlap marker | — | resolved banner ("Çözüldü · 13:00'e taşındı") / auto-resolved ("Bu çakışma artık yok") | label "Çakışma: 14:00 Müşteri toplantısı ve 14:30 Doktor randevusu" |
| `AnnouncementCard` (Today; R-25; **derived**, no archive reference) | IconTile 28 radius 9 (`campaign` 17) + title `h3Sm` (flex, max 2 lines) + trailing `CardIconAction` `close`; body `secondary` (mt 4, max 3 lines); optional single text action 13/600 `#4547C9` when the announcement has a CTA route | `surface`, radius 20, padding 14/16/12, `shadow.card` (dark: hairline ring); tile neutral for severity `info`, `warning/soft` + `warning/text` for severity `warning`; no gradient and no indigo fill (Kural 2) | default · CTA pressed · dismissing (collapse 300 ms, no undo) · offline (dismiss queued) | container label "Duyuru: {başlık}"; close button "Duyuruyu kapat"; the CTA is a separate button |

### 3.7 Provenance, explainability, approval

| Component | Spec | A11y |
|---|---|---|
| `SourceLine` (`SourceTag`, SREQ-03) | icon 16 (source type) + "Gmail · Ahmet Yılmaz · 08:42" `meta` `text.tertiaryStrong`; variant `verified` ("Kaynak: …"). **Always tappable** → `WhySheet` (default) or `openSource` handler. PRIMARY neutral visual (SECONDARY provider-coloured chip rejected). Device-sourced data appends staleness ("· cihaz eşitlemesi 09:40") | `role=button`, label "Kaynak: Gmail, Ahmet Yılmaz, 08:42. Bu nereden çıktı?" |
| `ProvenanceFooter` | `verified` 16 + "46 mail, 1 takvim, 3 gün geçmiş analiz edildi · 07:58" `meta` | text |
| `ConfidenceText` | PRIMARY has no meter; confidence is textual. "{n} kaynaktan · %{coverage} eşleşme", where *coverage* = the grounding verifier's share of answer claims backed by cited evidence spans (defined in AI_PIPELINE_PLAN). Coverage < 70% switches the answer copy to "Emin değilim" / "Kaynakta kesinleşmiyor." with `info` icon 14 in `#6B6860`. Extraction fields below threshold render the value plus the chip "Emin değilim · onayla" (warning soft) and require confirmation | label includes the confidence phrase |
| `WhySheet` (§3.9 sheet content; SREQ-04, M§131) | title "Neden önemli?"; reason sentence (from stored `reason`); precedence tier row ("Senin kuralın: {kural}" / "Öğrendiğim tercih: …" / "Sinyal: VIP kişi · son tarih içeriyor" / "AI sınıflandırması · güven yüksek"), with `tune`/`psychology`/`bolt`/`auto_awesome` icons; source row + "Orijinalini aç" (provider handoff); feedback options (correction sheet options, §3.9); "Kural oluştur" → `settings/priority-rules/[id]` (new) | modal sheet a11y |
| `AssuranceNote` / `TrustLine` | `verified_user` 18 `#1E7A47` + 13 `#6B6860` ("Sen onaylamadan hiçbir mail gönderilmez.") | text |
| `AIHint` | `psychology` 18 `#5B5CE2` + 13/19 `#6B6860`. **Only data-backed hints** (DEV-52 in §7) | text |
| `PrivacyNote` | `lock` 16 + 12 `text.tertiaryStrong` | text |

#### 3.7.1 `ApprovalCard` (M§33; P:06/6.8, P:hub/isApprovals, P:04/4.12d–4.13d, P:06/6.4)

- **Anatomy:**
  - Header row: IconTile 28 radius 9 `#EDEDFC`/`#4547C9` (glyph 17 by type) + type kicker 12/600 +0.72 `#6B6860` (flex) + time `meta` or StatusPill.
  - "What": `h3` 17/23 600 (mt 10).
  - `KeyValueGrid` 64px (mt 10) with rows **Neden**, **Değişim**, **Kaynak** (tappable → source), **Hesap** (destination account, e.g. "Gmail · yunus@…com" / "Google Takvim · İş"), and **Yan etki** (side effect, e.g. "2 katılımcıya bildirim gider"). The last three are added per M§33 (DEV-29).
  - Buttons (mt 14, gap 8, 42/12, 14/600): **Onayla** primary flex, **Düzenle** tonal, **Reddet** neutralTonal.
- **Container:** `surface`, radius 20, padding 16, `shadow.card`.
- **Type labels (TR, uppercase via i18n):** `email_send` "MAİL GÖNDER" (`send`) · `calendar_create` "ETKİNLİK OLUŞTUR" (`event`) · `calendar_update` "ETKİNLİK TAŞI" (`event_repeat`) · `task_create` "GÖREV OLUŞTUR" (`add_task`) · `reminder_create` "HATIRLATICI OLUŞTUR" (`notifications`) · `commitment_create` "TAAHHÜT KAYDET" (`handshake`).
- **States:** `pending` (BEKLİYOR) · `approved`/`executing` (İŞLENİYOR + buttons disabled, Onayla shows a spinner, "İşleniyor…") · `executed` (button morphs to "Onaylandı" 200 ms, pill ONAYLANDI 160 ms, card moves to history 320 ms, success haptic) · `failed` (BAŞARISIZ critical + reason `bodyXs` + primary "Tekrar dene", which reuses the idempotency key) · `rejected` (REDDEDİLDİ, opacity .45) · `expired` (SÜRESİ DOLDU, opacity .45, "Süresi doldu · 16:00 geçti") · `conflict` (warning ErrorCard inline: "Etkinlik öneriden sonra değişti" → "Yeniden oluştur").
- **Variants:**
  - `full` (Onay Merkezi).
  - `compact` (voice, 6.4): `#FFF` radius 20 padding 16, `shadow` `0 12px 32px rgba(0,0,0,.25)`, kicker "ONAY GEREKİYOR · MAİL GÖNDER", buttons 42/12 Onayla / Düzenle / **İptal**.
  - `inline` (chat, `DraftCard`).
  - `row` (capture batch sheet 4.12d/4.13d): tile + type 11/700 + title 15/600 + meta + check toggle, with the same KeyValueGrid rows.
- **Footer on the screen:** `AssuranceNote` "Önemli işlemler sen onaylamadan gerçekleştirilmez. Toplu onay yok; her kart tek tek." Capture-batch sheet footer: "Onaylananlar Onay Merkezi geçmişine yazılır."
- **Behaviour rules:**
  - Reddet → `approval_status = rejected` plus learning feedback (`rejection_reason = user_reject`).
  - Onayla → `POST /approvals/:id/approve {idempotency_key}`. The tap surface is recorded in `approval_actions.approved_via` (`approval_center` · `inline_sheet` · `voice_card` · `capture_batch` · `in_place`); every value is a tap (R-03).
  - İptal (voice) → rejected with `rejection_reason = user_cancel` and no learning (DB `approval_actions.rejection_reason`). A spoken "onayla" never approves; the compact card shows the hint "Onaylamak için karta dokun." (R-03, DEV-30).
  - "Geri al" (inline sheet and capture batch only): the approve call is held on the device for 5 s behind an `UndoToast` ("Onaylandı · Geri al"). "Geri al" cancels the held call and the card returns to BEKLİYOR. If the app closes during the window, the approval simply stays `pending` in the Approval Center. There is no extra status or transition (R-06); after execution only compensating actions exist (DEV-49).
  - Düzenle → type-specific editor (email → `mail/[id]/reply`; calendar → event editor sheet with free slots; reminder → `reminders/new`; task → task sheet; commitment → commitment edit sheet), producing a new payload version and a new idempotency key while pending (ADR-09).
- **A11y:** card label "Mail gönder: Mehmet Yılmaz'a takip mesajı gönder. Neden: …"; buttons labelled; the status change is announced.

### 3.8 Inputs and controls

| Component | Spec | States | A11y |
|---|---|---|---|
| `TextField` | 52h (minHeight), padding 0/16, radius 16, `surface`, `shadow.s1`, 15 px; placeholder `text.tertiaryStrong`; caret `#5B5CE2` | focus: ring 2 px `border.focus`, no shadow · error: ring `border.error` + helper (mt 6, padding 0/4) `error` 14 + 12 `critical/text-strong` ("Geçerli bir e-posta adresi gir.") · disabled `#F0EFEB`/`#B8B4AA` no shadow · with prefix (e.g. "@" `text.tertiaryStrong`) | label via `accessibilityLabel` or visible label; error announced (`accessibilityHint`) |
| `SearchField` | 44h pill, padding 0/14, `search` 18, clear `close` 18 (hitSlop), `shadow.s1`, 15 px | idle / typing / clearing | `role=search` |
| `UrlField` | 52/16, `link` 18, single line with ellipsis, focus ring | invalid URL (error helper "Geçerli bir bağlantı gir.") | keyboardType url |
| `CaptureTextField` | idle min 52 radius 16 15 px placeholder "Bir not yaz veya yapıştır…"; focused min 140 radius 20 **17/25 Geist** −0.17, ring 2 px; chips below ("Sesle yaz" `mic`, "Yapıştır" `content_paste`, counter as non-pressable text `meta`) | empty (Analiz Et disabled) · max length 4,000 (counter turns warning at 90%) | counter `accessible` text only |
| `ChatComposer` | pill 52 radius 999, padding 0/6/0/16, `surface`, `shadow.composer`, input 15, placeholder "Dijital hayatına sor…" ("{Ad} hakkında sor…" on person); trailing 40 circle: `mic` `#5B5CE2` when empty → `arrow_upward` on ink when text (morph 150 ms); optional leading "+" 36 (capture, SREQ-28) | focus ring 2 px · disabled offline ("Çevrimdışıyken soru sorulamaz") · rate-limited (placeholder "Günlük AI sınırına ulaştın") | send "Gönder", mic "Sesli sor" |
| `TimeChip` (2.9) | 36h, padding 0/12, radius 12, `#F5F4F0`, 17/600 −0.17, tabular; opens the native time picker (24h, tr-TR) | locked (Free) → `lock` 16 + opacity .55 row | "Sabah brifingi saati 08:00, değiştir" |
| `Switch` | 50×30 radius 15; on `#5B5CE2` knob right; off `#D9D6D0` + 1 px inset `#8F8B83` (DEV-08); knob 26 `#FFF` radius 13 `shadow.knob`, inset 2 (left 2 ↔ 22); 150 ms | disabled .4 without knob shadow · the whole ≥ 52 row is the target | `role=switch`, checked state |
| `SegmentedControl` | track `#E9E7E1` pill padding 3; segment 32h (30 compact, 34 retention), `labelSm`; selected `#FFF`/`#1A1917` + `shadow.segmentThumb`; unselected `#67645C` (DEV-05); thumb slides 150 ms | dark: track `.08`, thumb `#F2F0EB`/`#141311`, unselected `#A39F96` | `tablist` for view switches (Gün/Hafta); `radiogroup` for values (tone, retention) |
| `RadioIndicator` / `CheckIndicator` | selected `check_circle` FILL `#5B5CE2` 22–24; empty `radio_button_unchecked` `#8F8B83` (DEV-07); completed `check_circle` FILL `#2FA062` | — | part of row semantics |
| `PlanOptionCard` (7.5) | padding 14/16, radius 16, `surface`, border 2 px `#5B5CE2` (selected) / `rgba(27,25,23,.1)`; radio 20 (2 px border; selected fill `#5B5CE2` + inset 3 px white ring); title 15/600; Badge "EN AVANTAJLI" success; price line 13 `#6B6860` (store `priceString`) | loading (price skeleton) · unavailable | `role=radio` |
| `SelectableTile` (2.8) | 2-col, 88 minHeight, radius 18, padding 14; icon 24 top-left, label 15/600 bottom-left, `check_circle` 20 FILL at 12,12; selected `#1A1917`/`#FFF`, icon `#A9AAF5`; unselected `surface` + `shadow.card`, icon `#5B5CE2` | "Hepsi" selects all; deselecting one clears "Hepsi" | `role=checkbox` |

### 3.9 Overlays, feedback, states

| Component | Spec | A11y |
|---|---|---|
| `Sheet` (global `SheetHost`; route sheets use `presentation:'transparentModal'` rendering the same component, DEV-56) | scrim `overlay.scrim` (tap closes); `surface`, radius 28/28/0/0, padding 10/20/(`insets.bottom` + 16) (destructive 24 sides), `shadow.sheet`; grabber 36×5 radius 3 `control.grabber`, margin-bottom 14–18; title `sheetTitle`, subtitle 13 `#6B6860`; drag to dismiss with velocity snap; detents: content-height up to 90%; keyboard-aware | `accessibilityViewIsModal`, focus to title, escape and hardware back close; background `importantForAccessibility="no-hide-descendants"` |
| `ConfirmDialog` (irreversible, single object: rule delete, disconnect) | centred, width `min(320, screen−48)`, `surface`, radius 24, padding 22, `shadow.modal`, text centred; IconTile 48 radius 16 (critical soft / `delete` 24); title 18–20/600; body 13–14/19–20 `#6B6860`; buttons: destructive 48/14 + text "Vazgeç" 44 (same width) | `role=alertdialog` equivalent; focus to title |
| `DestructiveSheet` (consequence list: history deletion, account deletion step, disconnect-with-data) | Sheet + IconTile 52 radius 16 + `h2` title + body `body` + info box (`#F5F4F0` radius 14 padding 12/14 `bodyXs`: "Silinen: … / Korunan: …") + destructive `lg` + neutral "Vazgeç" `lg` (same size, per caption; D-11) | same |
| `Toast` / `UndoToast` | ink pill (`toast.bg`), radius 999, padding 12/18/12/14, 14/500 `toast.text`, leading icon 18 (`#A9AAF5` neutral/success, `#F08B78` error/offline), optional action (`#A9AAF5` 600, ml 6, hitSlop to 44: "Geri al", "Görüntüle"), `shadow.toast`; bottom offset §2.8; enter/exit per §2.13; queue (one at a time, FIFO, max 3 pending) | announce; with a screen reader the undo toast stays 10 s and is focusable (DEV-64) |
| `OfflineBanner` | InkCallout banner radius 14 padding 10/14 margin 8/20, 13 px white, `wifi_off` 18 `#F08B78`, text "Çevrimdışısın. Son analiz {HH:mm}'dan gösteriliyor.", action "Yenile" `#A9AAF5` 600; content below at opacity .75 | `role=alert` once; "Yenile" button |
| `SyncLine` | 2 px `#5B5CE2` line at the top of the scroll view during pull-to-sync (400 ms); then a centred pill "Güncel · {HH:mm}" (1.5 s). Uses a custom header, because `RefreshControl` cannot draw the line; `RefreshControl` keeps `tintColor #5B5CE2` for the native indicator on Android | announce "Güncellendi" |
| `InAppBanner` (foreground push; S-doc IA rule "Kritik bildirimler flow'u kesebilir (banner)") | top, `surface` radius 18, `shadow.page`, app tile 28 + title 14/600 + body 13 + chevron; auto-hide 4 s; swipe up to dismiss; tap → deep link | announce title |
| `Skeleton` | `skeleton.base`/`highlight` shimmer 1.6 s; bar radius h/2 (22-px title bars radius 8). **Presets:** `TodaySkeleton` (08), `CardSkeleton` (30%×18 r9, 92%×16 r8, 50%×12 r6, radius 20, `shadow.s1Soft`), `FeedSkeleton`, `MailDetailSkeleton` (header instantly, AI card shimmer), `TimelineSkeleton`, `PrepSkeleton` (ink card shimmer), `SettingsValueSkeleton` (value column 60×12), `ChatStreamingSkeleton`. "Başlık ve tarih anında; yalnızca AI içeriği iskelet." | hidden from a11y; the container announces "Yükleniyor" |
| `Spinner` | ring border 2, track `control.spinnerTrack` (or colour + 40% alpha on fills), top in colour, .8 s linear; sizes 14 (kicker), 16 (buttons), 22 (rows) | `busy` state on the parent |
| `AnalysisProgressCard` / `ProcessingChecklist` | kicker Spinner 16 + `kickerAi` ("PDF ANALİZ EDİLİYOR…"); step rows 15 px gap 12: done `check_circle` FILL `#2FA062` 22 (on night `#A9F0C1`), active Spinner 22, pending ring 22 `#8F8B83` at opacity .4; optional page refs meta; **no progress bar**; "İptal" text button 48; steps driven only by real job events | list semantics; step state in labels |
| `PulsingRing` (2.10) | 132: outer 3 px `rgba(255,255,255,.15)` + white arc 1.4 s; inner inset 14, 2 px `rgba(255,255,255,.6)` arc 2.2 s reverse; centre `auto_awesome` 44 FILL | hidden; the title carries meaning |
| `TypingIndicator` | three 7 px dots `text.tertiaryStrong`, .8 s, stagger 150 ms | "Yanıt hazırlanıyor" |
| `SuccessState` | ring 96 `success.soft` (scale .4 → 1, 500 ms) + `check_circle` 48 FILL `#1E7A47` (450 ms, 100 ms delay); title `hero`; body 15/22 `#6B6860`; optional result chips (deep links); CTA ink `md` "{Kaynağa} Dön" | focus to title, announce |

**EmptyState variants** (copy verbatim from P:08 and SECONDARY; M§93):

| Code | Icon / tone | Title | Body | CTA → action |
|---|---|---|---|---|
| `empty/today` | `done_all` success | "Her şey kontrol altında." | "Bugün dikkat gerektiren yeni bir konu yok. {n} maili senin için okudum." | "Akışa göz at" → Akış tab |
| `empty/plan` | `self_improvement` primary | "Bugün takvimin oldukça sakin." | "Yarın {HH:mm} {ilk etkinlik} ile başlıyorsun. Bugünü odak için kullanabilirsin." (second sentence only when tomorrow has an event) | "Odak bloğu öner" → `POST /plan/proposals` → proposal sheet |
| `empty/follow-up` | `mark_email_read` success | "Bekleyen takip yok." | "Gönderdiğin her maile yanıt geldi. Yeni bir gecikme olursa buraya düşer." | **no CTA** (PRIMARY "Tamam" is a dead action; DEV-53) |
| `empty/approvals` | `task_alt` neutral | "Onay bekleyen işlem yok." | "Bir mail göndermek veya takvimi değiştirmek istediğimde önce burada görürsün." | "Geçmişi gör" → history tab |
| `empty/no-account` (S) | `mail` primary | "Mailini bağla." | "Gmail veya Outlook bağlayarak önemli konuları burada görebilirsin." | "Hesap Bağla" → `settings/accounts` |
| `empty/vip` (S) | `star` primary | "Henüz VIP kişi yok." | "Önemli kişileri ekleyerek onlardan gelen mesajlara öncelik ver." | "Kişi Ekle" → contact picker |
| `empty/learned` (S) | `psychology` neutral | "AI henüz bir tercih öğrenmedi." | "Kartlardaki “···” menüsünden verdiğin geri bildirimler burada görünür." | — |
| `empty/filter` (derived) | `dynamic_feed` neutral | "Bu filtrede konu yok." | "Yeni bir şey olursa burada görürsün." | "Tümünü göster" → filter Tümü |
| `empty/search` (derived) | `search` neutral | "Bununla ilgili bir şey bulamadım." | "Farklı kelimelerle dene ya da tarih filtresini kaldır." | — |
| `empty/commitments`, `empty/rules`, `empty/referrals`, `empty/waiting` (derived) | `handshake` / `tune` / `person_add` / `mark_email_read` | "Açık taahhüt yok." / "Henüz kuralın yok." / "Henüz davet göndermedin." / "Kimse senden yanıt beklemiyor." | contextual one-liner | "Kural Ekle" / "Davet Gönder" / — |

**ErrorCard variants:**

| Code | Icon / tone | Title | Body | Actions |
|---|---|---|---|---|
| `error/oauth-expired` | `link_off` critical | "{Sağlayıcı} bağlantısı yenilenmeli." | "{Google\|Microsoft} oturumu süresi doldu. Yeniden bağlanana kadar yeni mailler analiz edilmez." | "Yeniden Bağlan" → `POST /integrations/:provider/start` (re-consent) → `POST /integrations/oauth/complete` after the redirect (R-07) / "Sonra" (snooze until the next session) |
| `error/permission-denied` | `event_busy` warning | "Takvim izni verilmedi." | "Toplantı hazırlığı ve çakışma uyarıları takvim erişimi gerektirir. Diğer her şey çalışıyor." | "İzin Ver" (OS: `Linking.openSettings()` if `canAskAgain=false`; provider: re-consent) / "Neden gerekli?" (explainer sheet) |
| `error/sync-delayed` | `sync_problem` warning | "Senkronizasyon gecikti." | "Son başarılı analiz {HH:mm}. Yeniden deniyoruz; gösterilenler {n} dakika eski olabilir." | "Şimdi Dene" → `POST /integrations/:accountId/sync` / "Tamam" |
| `error/ai-unavailable` | `cloud_off` neutral | "Asistan şu an yanıt veremiyor." | "Brifingin ve önceliklerin hazır; yalnızca yeni soru ve taslaklar birkaç dakika bekleyebilir." | "Tekrar Dene" / "Brifinge Dön" |
| `error/consent-declined` (S) | `block` warning | "Erişim izni reddedildi." | "{Sağlayıcı} hesabında izin onaylanmadı. Tekrar denemek için aşağıya dokun." | "Tekrar Dene" / "İptal" |
| `error/partial-scope` (derived) | `link_off` warning | "Mail izni verilmedi." | "Google izin ekranında mail erişimi seçilmedi. Takvim bağlı ve çalışıyor." | "İzni Tamamla" |
| `error/admin-consent` (derived) | `admin_panel_settings` warning | "Yöneticinin onayı gerekiyor." | "Kurumsal hesabın bu uygulamaya erişim için BT yöneticisinin onayını istiyor." | "Nasıl yapılır?" (web support article) |
| `error/credential-required` (plan §19) | `key` neutral | "Harici kimlik bilgisi gerekli." | "Bu özellik yapılandırma bekliyor." (visible only in demo/dev builds and System Health) | — |
| `error/ai-limit` (derived; Free) | `hourglass_top` neutral | "Günlük AI sınırına ulaştın." | "Sınır yarın {HH:mm}'de yenilenir. Pro ile daha geniş kullanım." | "Pro'yu İncele" → `paywall?source=ai_limit` |
| `error/offline-inline` (S) | `wifi_off` neutral | "İnternet bağlantısı yok." | "Çevrimiçi olduğunda her şey otomatik olarak güncellenir." | "Tekrar Dene" |

### 3.10 Audio and voice

| Component | Spec | A11y |
|---|---|---|
| `MiniPlayer` (P:01) | `#1E1E4C`, radius 16, padding 10/12; play/pause 40 `#FFF` circle glyph `#25266A` 24 FILL; title 13/600 "Sabah Brifingi · {bölüm}"; progress 3 px (track `rgba(255,255,255,.2)`, fill white, linear 500 ms); time 12 `rgba(255,255,255,.7)` tabular "0:42 / 2:14"; close 20 at .7; docks above the TabBar | role button group; progress `adjustable` |
| `FullPlayer` (3.4) | night gradient; DetailHeader (collapse, kicker "SESLİ BRİFİNG" .7, `SpeedPill` 32h radius 999 `rgba(255,255,255,.14)` 13/600 cycling "1.0x" → "1.25x" → "1.5x"); title `hero` (mt 44); meta 14 .7 "{d MMMM} · {m} dk {s} sn · {bölüm}"; `Waveform` (mt 40: 34 bars × 4 w, gap 5, h 72, played `#FFF`, rest `rgba(255,255,255,.35)`, bars animate only while playing; decorative, driven by position not amplitude); `Scrubber` (4 px, radius 2, **draggable seek** with a 44-pt touch band, DEV-52); `TransportControls` (gap 28: skip −15 · play 76 · skip +15); `ChapterList` (mt 36, rows padding 11/4, top border `rgba(255,255,255,.1)`, 14/500, index 22w 12 `.6`, duration 12, inactive opacity .55, active `graphic_eq` 16) | scrubber `role=adjustable`, value "0:42 / 2:14", increment/decrement ±15 s; skip labels "15 saniye geri/ileri"; chapters `role=button` |
| `NativeTtsNotice` | Inline `InkCallout` on night: "Cihaz sesiyle okunuyor · bölüm bölüm ilerler" when the fallback engine is active (seek degrades to chapter granularity; Android has no pause, so stop/resume from the last sentence) | announced |
| `VoiceOrb` | 120 ring `rgba(255,255,255,.14)` + inset 14 ring `.18` + core 80 `#FFF` + `mic` 36 `#25266A`; pulse `dapulse` 1.6 s (level-driven scale when metering is available); small 64 / mic 30 | `role=button` "Dinlemeyi başlat/durdur" |
| `VoiceWaveform` | 22 bars 4 px radius 2 `rgba(255,255,255,.85)`, h 10–40, container 44 | hidden |
| `TranscriptText` / `AnswerBubble` | transcript `hero`-ish 22/30 600 −0.22 max 300; answer bubble `rgba(255,255,255,.1)` radius 18 padding 14/16 15/22 max 320 | live region polite |
| `TranscriptCard` + `MiniWaveform` (5.7) | `surface` radius 20 padding 16, italic 16/24 transcript; 26 bars × 3 px radius 2 (active `#5B5CE2`, rest `#D9D6F7`), h 6–18, container 20; caption 12 "0:07 · dinleniyor" | — |

### 3.11 Plan visuals

| Component | Spec | A11y |
|---|---|---|
| `DayStrip` / `DayChip` | 7 chips space-between; 42×60 radius 14, gap 2; weekday 11/500 .8; number 17/600; dot 4 (meaning defined, D-47: **has events** = neutral dot `#C9C5BC`; **has AI proposal** = `#5B5CE2`; past days `#E0DED7`); today inverted `#1A1917`/`#FFF` + dot `#A9AAF5`; selected (not today) ring 2 px `#5B5CE2`; horizontal swipe changes the week | `role=tab`, label "Cuma 5 Eylül, 4 etkinlik" |
| `TimelineBlockRow` | gutter 44 right 12/500 `text.tertiaryStrong` pt 8; content top border `border.row`, padding 4/0, min 68; blocks per §2.3 (`plan.event`, `SuggestedSurface`, `GapBlock`, `plan.life`, deadline row = `plan.event` + `flag` warning-text icon + meta "Mailden tespit edildi"), commitment row (`handshake`, meta "Taahhüt · Mehmet"), task row (`add_task`); all-day items in a top "TÜM GÜN" row; overlap renders the second block inset 24 with the coral marker; now-line 1 px `#E0553F` with a 6 px dot | each block `role=button` |
| `WeekDensityChart` | `surface` radius 20 padding 16; header kicker "{d}–{d} {AY} · YOĞUNLUK" + "{n} etkinlik"; bars area 120, 7 columns gap 8, 2 stacked bars (meeting minutes, focus minutes = own AI/focus blocks), radius 5, gap 3, scale `px = minutes × 120 / max(480, weekMax)`; colours §2.3 (hot day = meetings ≥ 5 h or back-to-back ≥ 3); labels 11/600 (normal `#6B6860`, hot `#BE3F2C`, today `#5B5CE2`); legend swatches 10 radius 3 ("Toplantı", "Odak", "Yoğun") | chart `accessible` summary "Pazartesi 2 saat toplantı…"; each column `role=button` → Day view |

### 3.12 Capture

| Component | Spec |
|---|---|
| `CaptureSourceTiles` | 4 tiles flex, 64h, radius 16, 12/600, icon 22 `#5B5CE2`; unselected `surface` + `shadow.s1` (label `#6B6860`); selected `#EDEDFC`/`#4547C9`. Tiles: Fotoğraf `photo_camera`, Ekran görüntüsü `screenshot_frame`, **Dosya** `picture_as_pdf` (DEV-47), Link `link` |
| `MediaPreview` + `DetectionBox` | 160–220h radius 20 real image or PDF page; box 2 px `#5B5CE2` radius 8 (6 small); tag 10/700 +0.6 `#5B5CE2` on `#EDEDFC` radius 4 |
| `LinkPreviewCard` | compact (56 thumb radius 14) / hero (160 og:image); domain 12, title 15/600 ellipsis; image absent → domain initial tile |
| `ExtractedItemRow` | tile 30 radius 10 (types: deadline `#FDF2DC`/`#9A6300`, event `#E7F0FD`/`#2262BE`, task neutral, reminder warning, person primary, payment neutral, reservation/flight/shipment neutral, product neutral, note neutral); kicker 11/700 +0.66 in tone text; title 15/21 500; source ref meta ("Kaynak: s.14, madde 9.2"); `AI önerisi` chip for suggestions not stated in the source (DEV-62); select `check_circle` FILL / `radio_button_unchecked` |
| `EntityHighlightText` + legend | spans radius 5 padding 1/4 (zaman info, kişi primary, görev neutral, hatırlatıcı warning); legend swatches 10 radius 3, 11 px |
| `FileRow` | min-h 60, tile 36 radius 11 (selected PDF `#FCEDE9`/`#C7432F`), name 15/500, meta 12, radio |

### 3.13 Account, onboarding and monetisation parts

| Component | Spec |
|---|---|
| `IntegrationRow` | card padding 12/14 radius 18 `shadow.card`; provider **official logo** in a 44 radius 14 tile (bg `surfaceSunken`); name 15/600; meta 12 (masked account e-mail + status: "Bağlandı" / "İlk analiz bekliyor" / "Son eşitleme 09:40"); `ConnectPill` |
| `PermissionExplainer` (sheet) | header tile 44 radius 14 + kicker + title `titleMd`; optional `ChoiceChip` provider row; `ReasonRow` × 3–4 (`#F5F4F0` radius 14 padding 12/14 (calendar 11/14), icon 20 `#5B5CE2`, 15 px); `AssuranceBox` (`#E4F5EA` radius 18 padding 16 gap 10, text `#1E5A36` 14/20, icons `#1E7A47` 20, first row bold); primary `lg` ("Google ile Bağlan" / "Microsoft ile Bağlan" / "Google Takvim'i Bağla" / "Apple Takvim'e İzin Ver" / "Cihaz Takvimine İzin Ver"); text "Şimdi değil"; footnote 12 centred |
| `NotificationPreview` (2.12) | padding 14 radius 20 `overlay.glassCard` + blur, `shadow` `0 8px 24px rgba(27,25,23,.08)`, app tile 38 radius 11 `#5B5CE2` + glyph 22; "Dijital Asistan" 13 bold + time; body 14/19; offsets −8/+8/−4 px (0 with reduce motion). Illustration only |
| `ThemePreviewTile` (7.8) | 120h radius 16 padding 10, border 2 px `#5B5CE2` when selected; light / dark / system split; label 13 (600 selected / 500 `#6B6860`) |
| `PlanComparisonTable` (7.5) | `surface` radius 20; header grid `1fr 56px 56px`, 11/700 +0.66 ("FREE" `text.tertiaryStrong`, "PRO" `#5B5CE2`); rows 44 min, 14 px; Free cell 13 `text.tertiaryStrong` (value text or `check`); Pro cell `check` `#5B5CE2` or value text |
| `ReferralLinkField` | 52/16 `surface`; mono 14/500 link (ellipsis middle); tonal 40/12 "Kopyala" `content_copy` 16 |
| `InviteRow` | Avatar 36 (initials, or `mail` icon for an unmatched invite) + name 15/600 + status 12 + StatusPill |
| `RulePreviewCard` (7.10) | `AiGlowSurface` radius 18 padding 14/16; kicker "{N} MAİL BU KURALA UYARDI"; 3 sample rows (sender · subject `#1A1917`, date `#6B6860`); footer 12 "{a}'ü bugün zaten önemli sayılıyordu; {b} mail yukarı taşınacak."; states loading (skeleton), 0 matches ("Son 30 günde bu kurala uyan mail yok."), error |
| `SwipeableRow` | ReanimatedSwipeable (gesture-handler); right action 96 px track `#1E7A47` (DEV-10) + `check_circle` FILL 26 + "Tamamlandı" 11/600 white; left group 168 px: "Ertele" (`schedule` 24, bg `#F0EFEB`) + "Önemli değil" (`do_not_disturb_on` 24, bg `#E9E7E1`), labels 11/600 `#67645C`; card shadow `shadow.swipe`; threshold 35%; full swipe auto-applies; per-type semantics (follow-up close, commitment complete, deadline acknowledge, security "Bendim"); `accessibilityActions` = same three verbs; a visible equivalent always exists (card ✓ / ··· menu) |
| `Avatar` | sizes 22 (10 px) · 28 (11/600) · 32 (11/600) · 36 (12/600) · 38 (12/600) · 40 (13/600; self 15/600 ink) · 44 (15/600) · 56 (20/600) · 60 (22/600) · 76 (26/600); palette by deterministic hash of `contact_id` over [peach, blue, green, neutral]; image variant (circle crop) when a photo exists; overlap pair 44 + 3 px border in the parent bg, ml −12 | label = person name |

### 3.14 Editorial and sharing

| Component | Spec |
|---|---|
| `EditorialParagraph` | Lora `editorial` 18/29 (reading 17/28; weekly closing 17/27); bold spans Lora 600; `text-wrap: pretty` equivalent via `textBreakStrategy="highQuality"` (Android) |
| `EditorialStatRow` | Lora 34/36 500 number (min-width 84; the highlighted number `#5B5CE2`) + label 15 `#6B6860`; top rule `.12`, row rules `.08`, padding 14/0 |
| `HighlightCard` | ink radius 24 padding 22; kicker `#A9AAF5`; Lora 36/40 figure; note 13/19 `rgba(255,255,255,.65)` |
| `ShareCardTemplate` | 1080×1350 (4:5) and 1080×1920 (9:16) rendered offscreen with `react-native-view-shot`; dawn gradient padding 96; logo row (tile 84 radius 26 + "Dijital Asistan" 34/600); kicker 30/600 +10% .7; Lora 96/104 −3% headline; stats Lora 80/84 + labels 28 .75; tagline 28 .75. **Aggregates only, no names** (M§12). Long numbers use `Intl.NumberFormat('tr-TR')`, and the headline auto-shrinks to 80 px if it would wrap more than 3 lines. Fonts must be loaded before capture. |

---

## 4. Screen-level comparison of both archives (M§144)

**Column key:** **Req** = requirement (M§); **Ref** = reference screen/component; **Src** = archive · file · artboard; **Route** = plan §9 route (or target); **Interaction** = real behaviour (plan §5b `api` routes); **Missing** = states absent from both archives, beyond the M§93 set; **Notes** = implementation notes.

**§93 set** = loading (skeleton) · empty · error · offline (cached + OfflineBanner, writes queued/blocked) · retry · reconnect (`error/oauth-expired`) · partial (one source failed). It applies to every screen, and "§93 set" in a row means none of these is drawn.

### 4.1 Today

| Req | Ref | Src | Route | Interaction | Missing | Notes |
|---|---|---|---|---|---|---|
| M§8 header: date, greeting, approval badge, avatar | `RootHeader` + `HeaderPill` "{N} onay" + `Avatar` | P:03/3.1; P:hub/isToday; S:today/TodayScreen.tsx (search icon, ⭐ badge) | `(tabs)/today/index` | pill → `approvals/index` (hidden at 0; count = pending `approval_actions` from `GET /me/bootstrap` `counts.pending_approvals` and `today_overview` (RPC-04), refetched on push, app foreground and after every approval mutation; Supabase Realtime is not used, R-19); avatar → `settings/index`; search → `search` (DEV-24) | dark approval pill (derived); count loading | date computed in the user tz (DEV-18); greeting per §3.4 |
| M§8, M§9 hero + CTAs "Brifingimi Gör" / "Dinle · N dk" | `BriefingHero` | P:03/3.1, 3.2 (evening); P:07/7.6 (midday gate); P:08/loading-today, offline | same | "Brifingimi Gör" → `briefing/[id]` (latest of morning/midday/evening by local time); "Dinle" → `briefing/[id]/listen?autoplay=1` (`POST /briefings/:id/audio` when no asset) | preBrief, generating > 10 s ("Brifing hâlâ hazırlanıyor; hazır olunca bildiririz"), failed + retry, done (DEV-65), weekend, weekly-ready, first-day, Free gates for Dinle and Evening | duration from the TTS asset ("Dinle · {m} dk"); context line built from counts, zero groups omitted (SREQ-01); hero "N" = open priority count (count rules in packages/domain; D-32) |
| M§8 priorities (meeting, deadline, follow-up) | `PriorityCard` list + `SectionHeader` "ÖNCELİKLERİN · {n} konu" | P:03/3.1; P:hub PRIOS; S:cards/InsightCard.tsx | same | card → source detail by `source_type` (mail → `mail/[id]`; event → `meeting/[eventId]/prep` or `event/[id]`; follow-up → `followups`; life → `life/[id]`); ✓ → `set_insight_status` RPC done + UndoToast; ··· → correction sheet; swipe per `SwipeableRow`; actions: Yanıtla → `mail/[id]/reply`; Hatırlat → `reminders/new?sourceType&sourceId`; Hazırlan → prep (Pro gate); Takvime Ekle → `POST /approvals` (calendar_create) + inline approval sheet; Takip Mesajı Hazırla → `POST /followups/:threadId/draft` → reply modal; Yarın Hatırlat → `POST /reminders` preset tomorrow_morning; Takip Et → tracking URL handoff (only when in the source) | > 5 items (cap 5, then "Tümünü Akış'ta gör"), action-loading, action-failed | Life Intelligence (M§8) appears as ranked KİŞİSEL cards plus a single `ListRow` "Dijital hayatın · {n} gelişme" → `flow/index?filter=personal` (no carousel; calm layout) |
| M§8 AI insight cards | `AiCard` (at most one, between hero and priorities) | P:05/5.1 pattern (reused) | same | schedule_suggestion → `plan/proposal/[id]`; conflict → `plan/conflict/[id]` | — | extension logged DEV-68 |
| M§93, M§94 | EmptyState `empty/today`; `TodaySkeleton`; OfflineBanner + offline hero; ErrorCards | P:08 | same | "Akışa göz at" → Akış | partial (mail OK / calendar failed) as an ErrorCard at the top; stale timestamp in the hero kicker | the empty-state line about midday appears only for entitled users with midday on (D-48) |
| M§131, M§32 | correction sheet + `WhySheet` | P:hub/sheetDefs.correct; S:cards/InsightCard.tsx | sheet | options: "Önemli değil" (`do_not_disturb_on`), "Bunu daha sık göster" (`trending_up`), "Bu kişiyi VIP yap" (`star`; only with a resolved person, labelled "{Ad} kişisini VIP yap"; "VIP'den çıkar" if already VIP), "Bunu takip etme" (`visibility_off`), plus "Neden önemli?" and "Kural oluştur" → writes `ai_feedback` / `learned_preferences` / `vip_people`, then re-ranks or hides with undo; toast "Öğrendim · …" | learning disabled → toast "Kaydedildi · Öğrenme kapalı" | — |
| M§64, R-25 announcements | `AnnouncementCard` (at most one visible, directly below `RootHeader` and above `BriefingHero`) | no archive reference → PRIMARY card language (§3.6) | same | data from `GET /me/bootstrap` `announcements[]` (targeting by audience, platform, app version and time window is evaluated server-side; dismissed ones are excluded); CTA → `cta_route` (allow-listed `dijitalasistan://` route only); `close` → `dismiss_announcement` RPC (RPC-14; `announcement_dismissals` insert, on conflict do nothing) → collapse; the next active announcement (newest `starts_at` first) appears on the next bootstrap refresh | offline (cached card; dismiss queued and replayed on reconnect), severity `warning`, ended while open (hidden on refetch) | title/body come from `title_tr`/`title_en` and `body_tr`/`body_en` by locale; never a modal and never on other tabs; not counted in the hero N or the priorities |

### 4.2 Morning Briefing, Midday, Evening, Weekly, Audio

| Req | Ref | Src | Route | Interaction | Missing | Notes |
|---|---|---|---|---|---|---|
| M§9 six sections | `GradientHeader` dawn + `EditorialParagraph` + 6 × `GroupedList` + `ProvenanceFooter` + sticky ink CTA | P:03/3.3, 3.3D; P:hub/isBriefing; S:today/MorningBriefing.tsx | `briefing/[id]` | rows → source (§4.1 mapping); CTA "Brifingi Dinle · {m} dk" → `briefing/[id]/listen` | generating (Lora-line shimmer), failed + last briefing, stale "Son güncelleme 07:58 · Yenile", all-empty ("Bugün sakin"), low-confidence rows ("Kaynakta kesinleşmiyor"), audio not ready (CTA disabled "Ses hazırlanıyor") | section labels exactly M§9: "BUGÜNÜN ÖNCELİKLERİ, PROGRAMIN, SENDEN BEKLENENLER, SENİN BEKLEDİKLERİN, SON TARİHLER, KİŞİSEL GELİŞMELER" (C-02); empty section hidden; `ios_share` removed (DEV-53); hero line generated (D-21) |
| M§9 audio | `FullPlayer`, `MiniPlayer` | P:03/3.4; P:01 audio; P:hub/isAudio; S:MorningBriefing.tsx (inline player: fake) | `briefing/[id]/listen` (modal) | `expo-audio` play/pause/seek/±15/rate; lock-screen controls; chapters from `POST /briefings/:id/audio` | generating, buffering, network error, ended ("Baştan dinle" / "Brifinge dön"), interruption, native-TTS notice, Pro gate | collapse → MiniPlayer keeps playing |
| M§10 midday delta | `DetailHeader` close + hero + DeltaCards (`PriorityCard` pattern with `sm` button pair) + `TimelineRow` list + ink CTA "Tamam" | P:03/3.5; P:07/7.6 gate; S:today/MiddayPulse.tsx | `briefing/[id]` (kind midday) | "16:30 Öner" → reply draft → `email_send` approval (+ `calendar_update` if organizer); "Seçenekleri Gör" → `plan/conflict/[id]`; "Takip Mesajı Hazırla" → draft; "Toplantıda Sor" → `POST /meetings/:eventId/notes` (talking-point add) + undo | no-delta: no midday briefing is produced (`briefings.status = skipped`, `skip_reason='no_meaningful_delta'`, R-05) and the Today hero switches to `middayEmpty` ("Sabahından beri önemli bir değişiklik yok." / P:03 "Her şey planlandığı gibi."); stale delta, Free gate | the TAKVİM badge renders neutral (DEV-66); footer line "Sonraki brifing {HH:mm}'de" (S); midday and evening text is composed deterministically (T0), with an optional one-sentence T1 polish behind `ai.feature.briefing_polish` and never a T2 call (R-05) |
| M§11 evening | `GradientHeader` dusk + `ChecklistRow` sections + `InkCallout` NextEventCard + sticky primary `bedtime` "Yarına Hazırım" | P:03/3.6, 3.2; S:today/EveningClose.tsx | `briefing/[id]` (kind evening) | open item → done + undo; per-item "Yarına taşı" (S) → re-date; "Yarına Hazırım" → confirmation sheet (derived: carry-over list with toggles, "Akşam bildirimlerini sabaha kadar sessize al", "Sabah brifingin {HH:mm}'de hazır olacak") → `POST /briefings/:id/evening-ready` → SuccessState → Today night hero; `alarm` → Android `AlarmClock.ACTION_SET_ALARM` / iOS reminder fallback | confirmation, success, already-confirmed ("Yarına hazırsın ✓"), zero carry-over ("Bugün her şeyi kapattın."), no tomorrow event, Free gate, dark | sections per M§11 (C-03): TAMAMLANANLAR / YARINA KALANLAR / TAKİP / YARININ İLK ETKİNLİĞİ; the number in the header is uncoloured on the gradient (as designed) |
| M§12 weekly + share | editorial paper + `EditorialStatRow` + `HighlightCard` + sticky "Dijital Haftamı Paylaş" | P:03/3.7, 3.8; S:marketing/WeeklyReport.tsx | `weekly/[id]`, `weekly/[id]/share` | share → preview sheet (4:5 / 9:16) → `GET /weekly/:id/share-card` data → `ShareCardTemplate` → `expo-sharing`; next-week suggestion action → `POST /plan/proposals` | first week (insufficient data), generating, failed, dark, 9:16 variant | "KAZANDIĞIN ZAMAN" labelled "tahmini" with a versioned formula; "hiçbiri kaçmadı" → "hepsi zamanında öne çıkarıldı" (DEV-62); entry: Sunday push + Today weekly hero |

### 4.3 Flow, Mail Intelligence, Email Detail, AI Reply

| Req | Ref | Src | Route | Interaction | Missing | Notes |
|---|---|---|---|---|---|---|
| M§13 feed + filters + 9 types | `RootHeader` ("Akış" + HeaderPill "Ekle"), `FilterChip` row, meta line, `AttentionCard`s, `MailDigestRow` (DEV-26) | P:04/4.1, 4.2; P:hub/isAkis; S:flow/FlowScreen.tsx | `(tabs)/flow/index?filter=` | filters Tümü/Önemli/Mail/Takvim/Takip/Kişisel (server query; last filter remembered locally); "Ekle" → `capture`; card/action routing per P:04/4.1 audit (real handoffs only); swipe | per-filter empty, pagination (FlashList), new-items pill "Yeni {n} konu", card AI failure, security detail sheet (`life/[id]` with kind security: "Bendim" / "Şifreyi Değiştir" → **known** provider security URL) | "Takip" = follow-ups (S bug rejected); 9 MASTER types (C-04) + follow_up/commitment neutral variants; meta line "{n} konu · {m} önemli · Son analiz {HH:mm}" in both schemes (D-45) |
| M§14 categories + explainability | `HeroStat` "83 mail geldi / **6** tanesi dikkat gerektiriyor.", `StackedBar`, `GroupedList` of `CategoryRow`, "ÖNEMLİ · n" `MailSummaryCard`s | P:04/4.3; S:flow/MailIntelligence.tsx; P:09/store-02 | `mail/index` (+ `mail/category/[category]` proposed §10) | Senden cevap bekleyen → `waiting`; Senin cevap beklediğin → `followups` (S wiring inverted, rejected); other 4 → category list; card → `mail/[id]` | loading (digest), empty day, not connected (`empty/no-account`), partial analysis ("83'ün 40'ı analiz edildi"), multi-account breakdown, dark | categories mutually exclusive by primary category; "dikkat" = important + awaiting_my_reply + has_deadline (deduped); all numbers from one query (D-32); labels per plan `mail_category` UI names (C-05) |
| M§15 detail + actions | Sender row, subject `h2`, `AiCard` (AI ÖZETİ + ÖNEMLİ NOKTALAR), kicker "ÖNERİLEN AKSİYONLAR", `ActionTile` 2×2, "Orijinal Mail" `Accordion`, `SourceLine` | P:04/4.4; P:hub/isMail; S:flow/EmailDetail.tsx | `mail/[id]` | Yanıt Hazırla → `mail/[id]/reply`; Görev Oluştur → task sheet (S IA: GÖREV BAŞLIĞI, SON TARİH, hedef: Google Tasks / Microsoft To Do / Apple Anımsatıcılar (iOS) / uygulama içi) → `POST /approvals` task_create (external) or confirm (in-app); Takvime Ekle → `POST /approvals` calendar_create; Hatırlat → `reminders/new`; Original → `GET /mail/:messageId/original` (sanitised, not stored) expand 280 ms; `more_horiz` → overflow sheet ("Gmail'de Aç" / "Outlook'ta Aç" handoff, "Neden önemli?", "Önemli değil", "Göndereni VIP yap", "Kural oluştur", "Konu dizisini gör") | summary generating/failed (original expanded + "Özet şu an hazırlanamadı · Tekrar dene"), deleted at provider, attachments list, long thread, prompt-injection-flagged banner ("Bu mailde olağandışı talimatlar var; yalnızca özetlendi"), dark | ACİL badge tappable → WhySheet; "Deadline" → "Son tarih" (D-24); the sender is Ahmet in the fixture canon (D-17) |
| M§16 reply generate → edit → approval → send | `DetailHeader` kicker "YANIT TASLAĞI"/"TAKİP MESAJI", `RecipientChip`, `SegmentedControl` (Kısa/Profesyonel/Samimi/Detaylı), `DraftEditorCard` (editable TextInput), AssistChips, `AssuranceNote`, sticky primary "Göndermeyi Onayla" + surface "Düzenle" | P:04/4.5; P:hub/isReply (+ sent); P:06/6.2 DraftCard; S:flow/AIDraftReply.tsx | `mail/[id]/reply` (modal) | `POST /mail/:messageId/reply-drafts {tone}` (streamed; shimmer); tone change → `POST /reply-drafts/:id/regenerate` (confirm overwrite when edited); edits → `PATCH /reply-drafts/:id` (autosave); "Göndermeyi Onayla" → `POST /reply-drafts/:id/submit` → `email_send` approval → `POST /approvals/:id/approve` in place → İŞLENİYOR → SuccessState "Gönderildi" / "Yanıtın gönderildi. Cevap gelince Akış'ta göreceksin." (DEV-62) → "{Kaynağa} Dön"; "Düzenle" focuses the editor; "Kısalt" → regenerate(shorter) + undo | generating, regenerate failed, AI unavailable, send failed + retry, scope missing ("Gönderim izni gerekli" → `POST /integrations/:accountId/upgrade`), offline (send blocked), attachment too large, dark | attachment chips only for real files (D-63); recipient/CC/subject editable row (derived); no "Gmail'de Aç" draft export (no `gmail.compose`, ADR-07; SREQ-16 option (a) rejected); a single confirm (the S double "Son Onay" sheet rejected) with a read-only summary line "Kime · Konu · Ek" above the CTA |

### 4.4 Follow-Up, Commitments

| Req | Ref | Src | Route | Interaction | Missing | Notes |
|---|---|---|---|---|---|---|
| M§17 they-owe list | `FollowUpCard`s + `AIHint` | P:04/4.6; P:08/empty-follow-up; S:flow/SmartFollowUp.tsx | `followups` | "Takip Mesajı Hazırla" → `POST /followups/:threadId/draft` → reply modal (follow-up mode, tone Kısa+Profesyonel); "Yarın Hatırlat" → reminder at the user's morning time (C-28) + UndoToast; "Kapat" → close + undo; "Takip etme" per person via the ··· menu (D-45) | loading, error, dark | "Okundu" read status removed (D-59); wait badge 3/7 thresholds (D-06); auto-resolve on reply |
| M§17 user-owes list | `SectionHeader dot` groups ACİL / BUGÜN / BU HAFTA + `WaitingCard` | P:04/4.7; S:flow/WaitingReply.tsx; P:09/store-04 | `waiting` | card → `mail/[id]`; "Yanıtla" → reply modal; ··· → "Maili Aç", "Hatırlat" (`reminders/new`), "Yanıt gerekmiyor" (close) | empty (`empty/waiting`), undated, loading, dark | empty groups hidden; "YAKINDA" → "BU HAFTA" (SREQ-11) |
| M§18 commitments | `CommitmentCard` list, segmented "Açık / Tamamlanan" (derived) | P:04/4.8; P:05/5.7 (creation); S:plan/CommitmentTracker.tsx | `commitments`, `commitments/[id]` | Tamamlandı → status done + undo; Ertele → `reminders/new?mode=snooze` (S presets: Yarın / 2 gün sonra / Önümüzdeki hafta / Kendin seç) → due update; Kaynağı Gör → the exact source (mail/note/capture) with the quote highlighted | needs-confirmation variant (M§18), confidence, manual add ("Taahhüt ekle" sheet), empty, dark | entries: Akış TAAHHÜT card, person page, Plan day rows + "Açık taahhütler · n ›" row (DEV-27); the "Mesaj" source appears only via Android NI structured signals |

### 4.5 Plan, Calendar Intelligence, Meeting Prep, Post Meeting

| Req | Ref | Src | Route | Interaction | Missing | Notes |
|---|---|---|---|---|---|---|
| M§19 day/week + calendar/tasks/commitments + proposals | `RootHeader` "Plan" + `SegmentedControl` Gün/Hafta; `DayStrip`; `AiCard` "TAKVİM ZEKÂSI"; `TimelineBlockRow`s | P:05/5.1, 5.1D; P:hub/isPlan/isDay; S:plan/PlanScreen.tsx | `(tabs)/plan/index?view=&date=` | "Planla" → `POST /plan/proposals` → `plan/proposal/[id]` sheet (S IA: "ÖNERİLEN ZAMAN BLOĞU", time, title, rationale, Hesap, Yan etki "Takvimine 1 etkinlik eklenir · Davetli yok"; buttons Onayla / Saati Değiştir (picker limited to `GET /plan/free-slots`) / İptal) → `calendar_create` approval → executed → timeline refetch (solid block, "Planlandı" chip); "Başka zaman" → dismiss + `ai_feedback` + next proposal; event → prep or `event/[id]`; gap → focus/task sheet; life → `life/[id]`; deadline → `mail/[id]` | skeleton, empty (`empty/plan`), no calendar ("Takvim bağla"), permission denied, oauth-expired, pending/executing/failed AI block, expired proposal, now-line, all-day row, multi-calendar account label, Pro gate (advanced planning), dark planned block (derived) | dates computed (DEV-18); the proposal describes a block inside the free window (D-47) |
| M§20 conflicts, back-to-back, prep need, free slots, deadlines, location | `WeekDensityChart` + kicker "TAKVİM ZEKÂSI" + `CalendarIntelCard`s; `ConflictPair` + option sheet | P:05/5.2, 5.3; P:hub/isWeek; S:plan/CalendarConflict.tsx | `(tabs)/plan/index?view=week`; `plan/conflict/[id]` | "10:15'e Kaydır" → `POST /approvals` calendar_update (organizer only; otherwise "Yeni saat öner" draft); "Böyle Kalsın" → suppression + feedback; "Hazırlığı Buraya Koy" → calendar_create; "Seçenekleri Gör" → conflict screen; options: `POST /plan/conflicts/:insightId/options` / `…/resolve` → approval preview (Ne / Neden / Değişim / Hesap / Yan etki) | no-insight ("Bu hafta dengeli görünüyor."), empty week, partial, travel card hidden without a source, per-option loading, resolution pending/executed banners, dark | travel ETA only when the source provides it (plan §20; D-58); option 1 rewritten "Doktor randevusunu kaydırmak için klinikle iletişime geç" (`tel:`/mail draft handoff) + own calendar update; option added "Beni hatırlat, kendim çözeyim" (reminder_create) (DEV-46) |
| M§21 meeting prep | `DetailHeader` (+ `CountdownPill` / join variant), person row (Avatar 56 + `titleLg`), `TalkingPointsCard`, evidence `GroupedList`s, sticky primary "2 Dakikalık Özeti Oku" + surface "Not Al" | P:05/5.4, 5.5; P:hub/isPrep; S:plan/MeetingPrep.tsx; P:09/store-03 | `meeting/[eventId]/prep` | prep is precomputed at T-60 only for external or VIP meetings; otherwise "Hazırlan" generates it on tap through `POST /meetings/:eventId/prep` (generate/refresh); the prep notification fires T-30…T-15 per user preference (R-23); person → `person/[id]`; SON MAİLLER → `mail/[id]`; open loops → source / "Taahhüde çevir"; SENİN BEKLEDİKLERİN → `followups`; talking point long-press → source sheet; "Katıl" chip (T−10 … end, when a join URL exists) → `Linking.openURL` (allowlisted conferencing domains); location meta → maps handoff; "Not Al" → note sheet → `POST /meetings/:eventId/notes` | generating, no history ("İlk görüşmeniz"), unknown/external attendee, group meeting (attendee selector), no purpose, AI unavailable, offline cached with generated-at, cancelled/moved banner, started/ended (→ post), Pro gate, "İLGİLİ DOSYALAR" section (DEV-41) | copy "SENDEN BEKLENENLER / SENİN BEKLEDİKLERİN" kept; fixture: Mehmet talking points (D-18) |
| M§21 2-minute summary | editorial reader | P:05/5.6 | `meeting/[eventId]/summary` | headphones → TTS player (reuses `FullPlayer`); source chips → lists/details | generating, dark paper (`#141311`), TTS unavailable, stale | the "2 Dakikalık" label must be true: capped length or computed minutes |
| M§22 post meeting | header close + meta + `h1` "Toplantın bitti." + `TranscriptCard` + `AiCard` "{n} YENİ TAAHHÜT" with `DetectedItemRow`s + footer "Kaydet" + keyboard square | P:05/5.7; P:hub/isPost; S:plan/PostMeeting.tsx | `meeting/[eventId]/post` | entry: silent notification at event end + 1 min; explicit tap to record (`expo-speech-recognition` tr-TR; server STT fallback `POST /assistant/transcribe`); keyboard → text mode; `POST /meetings/:eventId/post` → proposals; item tap → edit sheet; Kaydet → `commitment_create` approvals approved in place (C-06), idempotency note id + index | idle ("Konuşmak için dokun"), mic denied ("Metinle yaz"), processing, none detected ("Takip edilecek bir şey bulamadım · Not olarak kaydet"), low confidence (unchecked "Emin değilim · onayla"), saving, error | audio not persisted by default |

### 4.6 Life Intelligence

| Req | Ref | Src | Route | Interaction | Missing | Notes |
|---|---|---|---|---|---|---|
| M§23 six types, source-linked, amounts only if stated | `LifeCard` (detail header), `AttentionCard` (feed), detail sheet with typed fields + `SourceLine` + "Orijinali Aç" | P:04/4.9, 4.2; S:cards/LifeCard.tsx, TodayScreen life sheet | `life/[id]` (sheet); list via `flow/index?filter=personal` | per 4.9 actions with real behaviour: Takip Et / Check-in / Teyit Et → allowlisted URL from the source; Yol Tarifi → maps; Hatırlat → `reminders/new`; Ödendi → state; İncele → subscription detail; Bir Daha Gösterme → mute rule + undo; Bendim → resolve; Şifreyi Değiştir → **known** provider URL | empty (derived from mail; Android adds notification signals), stale/expired (departed flight), resolved, dark | "Kapıya Not Bırak" removed; "Cüzdana Ekle" only with `.pkpass`/Google Wallet link (DEV-64); fields without a `source_span` show "Kaynakta kesinleşmiyor." (C-15); 4.9 is not a separate list route (D-36) |

### 4.7 Assistant, Voice, Memory, Search

| Req | Ref | Src | Route | Interaction | Missing | Notes |
|---|---|---|---|---|---|---|
| M§24 never-empty, suggested prompts, grounded source cards | `RootHeader` ("Asistan" + HeaderPill "Hafıza"), `SummaryBanner`, `SuggestedPromptRow` × 5, "SON SOHBETLER" rows, `ChatComposer` | P:06/6.1, 6.1D; P:hub/isAsistan; S:assistant/AssistantScreen.tsx | `(tabs)/assistant/index` | prompt → push `chat/new?prompt=` (root stack, tabs hidden; SCREEN_MAP_3 M-ASST-02), which calls `POST /assistant/threads` on the first send and then replaces `new` with the thread id; recent row → thread; swipe delete; "Hafıza" → `memory`; mic → `voice`; "+" → `capture` | first-run ("İlk analiz sürüyor…"), no accounts, AI unavailable, AI limit, offline | prompts per M§24 wording ("Bu hafta hangi son tarihlerim var?", D-24) plus a 6th "Ödenmesi gereken bir şey var mı?" (SREQ-27) on payment days only |
| M§24 conversation | `ChatBubble`s, `RichAnswerCard`, follow-up chips, `DraftCard`, `ConfidenceText` | P:06/6.2; P:hub chat | `chat/[threadId]` (root stack; tab bar hidden) | `POST /assistant/threads/:id/messages` (SSE stream, citations). The model has read-only retrieval tools only; write intents are detected server-side by `AssistantIntentV1` (T0 grammar → T1) and returned in the stream as a pending approval card built through the same code path as `POST /approvals` (R-04); rows → entities; feedback 👍/👎 → `ai_feedback` | streaming, stop generating, no-answer ("Maillerinde ve takviminde bununla ilgili bir şey bulamadım."), low-confidence, error mid-stream + retry, rate-limit | — |
| M§25 voice + write approval | `VoiceOrb`, `VoiceWaveform`, transcript, answer, compact `ApprovalCard`, `VoicePromptChip`s | P:06/6.3, 6.4; P:hub/voice; S:assistant/VoiceAssistant.tsx | `voice` (fullScreenModal) | permission → STT → assistant → TTS; write intent → proposal → compact card; **approval by tap only**: a spoken "onayla" never approves, and the tap is recorded as `approved_via = voice_card` (C-07, DEV-30, R-03); Düzenle → leaves voice → editor; İptal → reject without learning | idle, permission denied ("Mikrofon izni gerekli" + "Ayarları Aç" / "Metinle sor"), processing ("Anlıyorum…"), speaking, not understood, STT unavailable, interruption, executing/sent/failed on the card | hint line becomes "Onaylamak için karta dokun." |
| M§26 semantic memory | `SearchField` + compact `FilterChip`s + `AiCard` "CEVAP" + `SourceResultCard`s + suggested questions | P:06/6.5 | `memory?q=` | `GET /search?q=&types=` answer mode; "Orijinali Aç" → in-app detail, provider link secondary | idle (recents + examples from S), searching, no results, low confidence, index building ("Geçmiş mailler hâlâ işleniyor · %60"), out-of-retention hint, Pro gate | "%92 eşleşme" defined as evidence coverage (§3.7) |
| M§95 global search | **no PRIMARY screen** → built in 6.5 language: `SearchField` + "SON ARAMALAR" (local) + "ÖRNEK ARAMALAR" chips + typed result groups (Mailler, Kişiler, Takvim, Görevler, Taahhütler, Yaşam, Hafıza, Yakalananlar) using `SourceResultCard` compact rows; a question-shaped query shows "Hafızaya sor ›" first | S:shared/SearchScreen.tsx (IA) | `search` | `GET /search?q=&types=`; routing per SREQ-41 | all states as memory | Turkish-aware matching (S `ucus` bug rejected); entry from the Today header (DEV-24) |

### 4.8 Capture (and Share)

| Req | Ref | Src | Route | Interaction | Missing | Notes |
|---|---|---|---|---|---|---|
| M§27 sources: photo, screenshot, file/PDF, link, text | `DetailHeader` close "EKLE"; `CaptureTextField` on top; `CaptureSourceTiles`; PDF/file picker sheet (`FileRow`) | P:04/4.10, 4.11, 4.12a, 4.13a, 4.14a; S:shared/UniversalCapture.tsx | `capture` (modal) | Fotoğraf → `expo-image-picker` (camera permission only for camera); Ekran görüntüsü → library (iOS screenshot subtype); Dosya → sheet "Dosya seç" (mail attachments + "Dosyalar'dan seç…" `expo-document-picker`); Link → URL field (clipboard only after tap); "Analiz Et" → `POST /captures/upload-url` + upload / `POST /captures` → `POST /captures/:id/analyze` | permission denied, upload failed, too large/encrypted, offline, share-extension entry (prefilled) | the tile row gains "Dosya" (DEV-47) |
| M§27 extraction → suggestions | `AnalysisProgressCard` (real job events) + preview/highlights; results: `AiCard` + `ExtractedItemRow`s + sticky "N Öğeyi Onaya Gönder" | P:04/4.12b–c, 4.13b–c, 4.14b–c, 4.10, 4.11 | `capture/[id]` | İptal → cancel job + delete upload; type chips (4.13c) remap suggestions (Ürün → only "Hafızaya kaydet" and "Hatırlat"; no price tracking, DEV-48); "Hafızaya kaydet" → memory write (visible, deletable) | zero items ("Belgede tarih veya görev bulunamadı" + "Hafızaya kaydet"), OCR failed, unreadable page ("Sayfa okunamadı · Metni yapıştır"), timeout, partial, ambiguous person picker, low confidence | AI-suggested items carry the chip "AI önerisi" (DEV-62); 4.10 direct "Takvime Ekle" goes through the approval sheet (D-34) |
| M§27, M§33 approval + success | capture batch approval `Sheet` with `ApprovalCard row`s (union fields) + "Onayla · N" / "Düzenle" / "Vazgeç"; `SuccessState` + result chips + UndoToast | P:04/4.12d, 4.13d, 4.14d | sheet on `capture/[id]` | `POST /captures/:id/actions` → approvals (batch id = capture) → approve each (own idempotency key) → per-row executing/executed/failed; each approve tap is recorded as `approved_via = capture_batch`; "Geri al" works only within the 5 s client-side window before the approve calls are sent (the approvals stay `pending`; no extra status or transition, R-06); after execution, a compensating action (DEV-49) | partial failure ("2/3 tamamlandı · Takvim hatası · Tekrar dene"), account picker, conflict warning, offline blocked | the success CTA returns to the origin ("Akış'a Dön") (D-35) |
| M§28 share extensions | no design → uses the `capture/[id]` analyzing screen directly, prefilled | — | iOS share extension / Android `ACTION_SEND` via `expo-share-intent` → `capture` | same pipeline | extension memory (≈120 MB) error ("Dosya çok büyük; uygulamada aç") | — |

### 4.9 Notifications

| Req | Ref | Src | Route | Interaction | Missing | Notes |
|---|---|---|---|---|---|---|
| M§34 step 14 pre-prompt | `NotificationPreview` × 3 + `titleXl` + CTA "Bildirimleri Aç" / "Daha sonra" | P:02/2.12; S:OnboardingFlow.tsx (fake) | `(onboarding)/notifications` | `requestPermissionsAsync` (Android 13+ `POST_NOTIFICATIONS`) → `POST /devices/register`; denied/blocked → "Ayarları Aç"; "Daha sonra" → re-ask once on the first briefing screen | denied, provisional (not used), already granted (skip) | the PRIMARY line "Günde ortalama 3 bildirim" is replaced by "Sadece önemli olduğunda haber veririz."; the decision engine caps non-critical pushes at `notification_preferences.daily_cap` (default 5) (R-14, P-02); Android channels are created at first launch, before this prompt (R-12); previews use title-only-safe copy |
| M§35 notification settings (8 categories, quiet hours, lock-screen privacy, detail level) | **SECONDARY IA restyled** (PRIMARY has only the 7.1 row value): hero `ListRow` switch "Akıllı Filtre · Yalnızca gerçekten önemliyse bildir" (SREQ-60); `SectionHeader` "BRİFİNG BİLDİRİMLERİ" (Sabah / Öğle nabzı (Pro lock) / Akşam kapanışı (Pro lock)); "ANLIK" (Kritik mailler / Toplantılar / Son tarihler / Takip hatırlatmaları / Onay bekleyenler); "YAŞAM ZEKÂSI" (Kargo, uçuş, ödeme); "SESSİZ SAATLER" row → sheet (master switch, default on; start/end TimeChips, default 22:30–07:30 in the user tz; days; switch "VIP'ler sessiz saatlerde de bildirsin" = `notification_preferences.vip_bypass_quiet`, default on, with the per-VIP override `vip_people.bypass_quiet_hours` on the VIP edit sheet; caption "Sessiz saatlerde yalnızca kendi kurduğun hatırlatıcılar ve (açıksa) VIP kişilerden gelen kritik mailler bildirilir."); "KİLİT EKRANI" (detail level radio: "Tam içerik" / "Yalnızca başlık" (default) / "Genel", with a live `NotificationPreview` of the chosen level); OS status row ("Bildirimler kapalı · Ayarlar'da aç") | S:settings/NotificationSettings.tsx; S:marketing/NotificationExamples.tsx | `settings/notifications` | writes `notification_preferences` (PostgREST under RLS); consumed by the decision engine | loading, save error (revert), OS denied | detail modes default `title_only` (ADR-10, C-14); Android channels (R-12): `briefings` (morning/midday/evening/weekly), `critical_email`, `meetings`, `deadlines`, `follow_up`, `life_intel`, `approvals`, `reminders`, `account`, `phone_digest` (Android NI only), Turkish names localised, all `lockscreenVisibility = PRIVATE`; quiet hours per R-13 (the VIP bypass is deduped and capped at 3 per quiet window; admin test pushes never bypass); iOS time-sensitive only for critical/VIP |
| M§86 push copy per mode | copy catalogue: full / title_only / generic (e.g. critical: "Ahmet senden bugün 17:00'ye kadar dönüş bekliyor." / "Bugün cevaplaman gereken önemli bir mail var." / "Yeni bir önemli konu var.") | S:NotificationExamples.tsx; P:02/2.12 | server-rendered | deep links per the plan §9 router | approval / account category copy (derived: "Onayını bekleyen 1 işlem var." / "Gmail bağlantısı yenilenmeli.") | the morning ☀️ emoji is allowed in push text only (V-06) |
| foreground | `InAppBanner` | S IA rule | global host | tap → deep link | — | — |

### 4.10 Widgets

| Req | Ref | Src | Target | Interaction | Missing | Notes |
|---|---|---|---|---|---|---|
| M§37 iOS S/M/L + lock | Small 158×158 r22 "sıradaki önemli konu"; Medium 338×158 "BUGÜN · 3 ÖNCELİK"; Large 338×354 brief + next meeting + follow-up; lock inline/circular/rectangular | P:08 widgets; S:marketing/WidgetShowcase.tsx (rejected) | `targets/widget` (SwiftUI WidgetKit via `@bacons/apple-targets`) | `widgetURL` / `Link` deep links (`dijitalasistan://…` to real routes); **no writes** | empty ("Her şey kontrol altında."), signed out ("Hesabını bağla"), stale timestamp, privacy (generic mode: counts only; `.privacySensitive()` on names), brief not ready ("Brifing 08:00'de hazır"), Free (no midday/evening lines), dark/tinted/clear | lock-screen widgets rendered vibrant monochrome by the system (custom pills not honoured; inline sits above the clock, D-44); Geist bundled in the extension |
| M§37 Android 2×2 / 4×2 | 4×2 340×170 r28 white (header tile, play 32 tonal, headline 17/22, chips); 2×2 170×170 ink "SONRAKİ · 14:30" | P:08 | `modules/da-widgets` (Jetpack Glance) | click actions → deep links | same as iOS + system night mode | corner radius from `@android:dimen/system_app_widget_background_radius`; Glance uses the system font (DEV-17); "Android'de Material tema rengi yerine ürünün kendi yüzeyleri" kept |

### 4.11 Privacy

| Req | Ref | Src | Route | Interaction | Missing | Notes |
|---|---|---|---|---|---|---|
| M§40 hub | h1 "Gizlilik ve Güvenlik" + promise `InkCallout` + "BAĞLI HESAPLAR · n" (IntegrationRow compact + "Yönet") + "VERİ" list + `PrivacyNote` | P:07/7.2; S:settings/SecurityPrivacy.tsx | `settings/privacy` | rows → `privacy/permissions`, `privacy/data-sources`, `privacy/retention`, `privacy/history`, `privacy/export`, `privacy/delete-account`, `personalization`, `accounts/[id]` | re-auth row, zero accounts, export/deletion status rows, Outlook rows, dark ink card | promises verbatim M§40 (C-31): "Verilerin reklam amacıyla satılmaz." / "Önemli işlemler sen onaylamadan gerçekleştirilmez." / "Mail içeriklerin yapay zekâ modellerini eğitmek için kullanılmaz."; footer "Veriler aktarım sırasında ve saklanırken şifrelenir." + region only when configured (P-01, DEV-33); scope strings derived from granted scopes (no "Taslak oluşturma", D-42) |
| M§40 permissions | derived screen in 7.2 style: "UYGULAMA İZİNLERİ" rows (Bildirimler, Takvim (cihaz), Mikrofon, Kamera/Fotoğraflar, Kişiler, Android "Bildirim erişimi") with live status value + "Sistem Ayarlarına Git"; "HESAP İZİNLERİ" per account with plain-TR scopes | S İzinler sheet (IA) | `settings/privacy/permissions` | `getPermissionsAsync()` per module; `Linking.openSettings()` | — | — |
| M§40 AI accessible data + data source controls | "OKUR" toggles + "HİÇBİR ZAMAN OKUMAZ" fixed list; per-account data-source toggles (`connected_accounts.data_source_toggles`) in the account detail | P:07/7.3; S:settings/DataSourceControl.tsx | `settings/privacy/data-sources`, `settings/accounts/[id]` | `PATCH /integrations/:accountId/data-sources`; consequence sheet when turning off core sources | OS denied (location/contacts), saving/revert, offline | copy fixes: "Hassas alan tespiti cihazda yapılır" → "Hassas alanlar (doğrulama kodları, kart ve hesap numaraları) AI'a gönderilmeden önce ayıklanır."; "Kopya tutulmaz" → "Mail içeriğinin tamamı saklanmaz; yalnızca özetler, kısa alıntılar ve analiz sonuçları saklama süren boyunca tutulur." (R-15, ADR-05, DEV-33); "Mesajlaşma içerikleri" kept as never |
| M§41 retention | h1 "Veri saklama" + `SegmentedControl` "30 gün / 90 gün / 1 yıl / Silene kadar" + list | P:07/7.4 | `settings/privacy/retention` | shortening → confirmation sheet; write `user_preferences` retention | saving | the 4th option is added (DEV-32) |
| M§40 delete history | `DestructiveSheet` (7.4 overlay) | P:07/7.4 | `settings/privacy/history` | explicit confirmation with the consequence list ("Silinen / Korunan" counts from the history-deletion preview contract in API_CONTRACTS, R-24) → re-auth (the same recent-auth contract as account deletion, R-16) → `POST /privacy/delete-history` → job status ("Siliniyor…" → done) | counts loading, running, failed + retry, offline | body copy from the configured retention; "42 kural" → learned preferences only; explicit rules preserved (D-12) |
| M§128 export | derived status screen: requested / preparing (Spinner) / ready ("İndir" signed URL 24 h) / expired / failed | — | `settings/privacy/export` | `POST /privacy/export`; poll status | all | — |
| M§129 delete account | derived multi-step: consequences list (deleted vs not: store subscription must be cancelled separately + "Aboneliği Yönet" link) → re-auth → type "SİL" → queued status ("Hesabın silme kuyruğunda") | S (IA, fake rejected) | `settings/privacy/delete-account` | `POST /privacy/delete-account`; SIWA revoke server-side; local wipe → sign-out | all | never a fake "silindi" |

### 4.12 Settings (incl. Person/VIP, Priority Rules, Personalization, Appearance, Language, Android NI)

| Req | Ref | Src | Route | Interaction | Missing | Notes |
|---|---|---|---|---|---|---|
| M§130 hub | identity row (Avatar 60 + name 22/600 + PRO pill + status) + Onay Merkezi `InkCallout` + groups ASİSTAN / HESAP / UYGULAMA + "Çıkış Yap" + version footer | P:07/7.1 (canonical); P:hub/isProfile (flat, rejected layout); S:settings/ProfileScreen.tsx | `settings/index` | rows → `briefings`, `notifications`, `priority-rules`, `vip`, `personalization`, `subscription`, `accounts`, `privacy`, `referral`, `appearance`, `language`, `help`, `feedback`, `about`, `android-notifications` (Android only), `profile` (identity row); sign-out → confirmation sheet → `signOut({scope:'local'})` + `POST /devices/unregister` + encrypted cache wipe + RevenueCat `logOut` (ADR-06) | Free state (no PRO pill + "Pro'ya geç" row), expired/grace, 0 pending ("Bekleyen işlem yok"), re-auth warning value, value skeletons, sign-out in progress | added rows per C-18 (DEV-54); the values column is live |
| M§9–11 briefing settings | 2.9 layout without the step header + per-slot switches + weekday chips "Brifing günleri" + timezone row (IANA, auto from `expo-localization`, override) + "Kaydet" | P:02/2.9; S:settings/BriefingSettings.tsx | `settings/briefings` | writes schedule; backend reschedules jobs | Free locked rows (drawn now), save error | the "08:15" AI hint removed (DEV-52); defaults 08:00 / 13:00 / 19:00 / Pazar 18:00 (S-09) |
| M§30 VIP + person | `DetailHeader` + HeaderPill primary "Kişi Ekle" + grouped VIP list (relationship groups) + `InlineSuggestionRow` ("Evet" / "Şimdi değil"); person page (6.7) | P:06/6.6, 6.7; P:hub/isPerson; S:VIPPeople.tsx, PersonIntelligence.tsx | `vip`, `person/[id]` | add → contact picker sheet (derived; no device contacts by default, SREQ-37); star → un-VIP + undo; VIP chip → edit sheet; composer "{Ad} hakkında sor…" → `chat/new?contactId=` (person-scoped thread, SCREEN_MAP_3 M-ASST-02) | empty (`empty/vip`), sparse person, non-VIP ("VIP yap"), merged contacts, Pro gate, dark | AÇIK KONULAR section + "Tüm iletişimi gör" added (DEV-42); call-log items render only as user notes (D-61) |
| M§31 priority rules CRUD | 7.9 list; 7.10 new (condition chips + input + outcome radios + `RulePreviewCard`); 7.11 edit; 7.12 ConfirmDialog + UndoToast | P:07/7.9–7.12; S:settings/PriorityRules.tsx (superseded) | `settings/priority-rules`, `settings/priority-rules/[id]` (`new` as the id for create) | PostgREST CRUD `priority_rules`; preview RPC; exceptions editor sheet (derived) | empty, validation (invalid domain, empty, duplicate), preview loading/0/error, save error, dirty-state confirm, dark | save CTA colours as designed (create primary, edit ink) (D-29); "Kural aktif" label reflects the toggle ("Kural kapalı") |
| M§32 AI personalization | 6.9 grouped list + per-row **switch** (disable) + edit/delete + global switch "Etkileşimlerimden öğren" (SREQ-76) + "Kural Ekle" → priority rules new | P:06/6.9; S:settings/AIPersonalization.tsx | `settings/personalization` | edit sheet (priority Yüksek / Normal / Düşük), delete soft + 5 s undo | empty (`empty/learned`), learning off (rows greyed "Öğrenme kapalı"), dark | explicit items ("Sen ekledin · VIP") link out to VIP/rules (M§32 separation) |
| M§38, M§92 appearance | 7.8 appearance part: `ThemePreviewTile` × 3 ordered **Sistem / Açık / Koyu** (default Sistem) + rows Metin boyutu, Hareketi azalt, Haptik geri bildirim | P:07/7.8; S:AppearanceSettings.tsx | `settings/appearance` | theme → provider + persisted; text size sheet (Sistem / Küçük / Büyük / Çok büyük → `user_preferences.text_scale` `system` / `sm` / `lg` / `xl` = multiplier 1.0 / 0.9 / 1.15 / 1.3 over the OS scale; the total is clamped by `maxFontSizeMultiplier` 2.0; SCREEN_MAP_4 M-SET-61); reduce motion / haptics → prefs | saving | DEV-35, DEV-43 |
| M§39 language | 7.8 language part: "Türkçe" / "English" radios + note + read-only region rows (24 saat, tarih biçimi) | P:07/7.8; S:LanguageSettings.tsx | `settings/language` | `use-intl` locale switch at runtime + `PATCH` locale | — | "Deutsch" removed; no "Yakında" (D-44) |
| M§36 Android NI | 2.13 layout as settings: master status row (real state; "Bildirim Erişimini Aç" → `ACTION_NOTIFICATION_LISTENER_SETTINGS`), mode "Tüm uygulamalar / Seçili uygulamalar", category/app list (from packages seen), locked "Her zaman hariç" section (authenticators, password managers, e-Devlet, banking OTP senders, messaging apps), rule toggles, privacy note | P:02/2.13; S:settings/AndroidNotifications.tsx | `settings/android-notifications`, `(onboarding)/android-notifications` | Kotlin module state on resume; `POST /android-notifications/signals` from device | not granted / granted, Pro gate | hidden on iOS; messaging hard-excluded (D-46); copy (R-15, verbatim) "Bildirim içerikleri cihazında işlenir; yalnızca çıkarılan bilgiler (ör. kargo durumu, tutar, tarih) hesabına kaydedilir. Doğrulama kodları ve güvenlik uygulamaları her zaman hariç tutulur." |
| Help / Feedback / About / Profile | derived in 7.1 language: Help sections (Başlarken, Özellikler, Entegrasyonlar, Gizlilik, Destek) → articles open web `/support#…` in `expo-web-browser`; Feedback types Hata / Özellik isteği / Genel / **AI kalitesi** + 1–5 rating + message + diagnostics consent; About (version/build from `expo-application`, Kullanım Koşulları, Gizlilik, Açık kaynak lisansları, Veri silme); Profile edit (name, read-only e-mail, timezone, linked sign-in methods) | S:HelpScreen.tsx, FeedbackScreen.tsx | `settings/help`, `settings/feedback`, `settings/about`, `settings/profile` | `POST /feedback`, `POST /support/tickets` | success only after 2xx | placeholder "hazırlanıyor" sheets rejected |

### 4.13 Dark mode (M§38)

| Req | Ref | Src | Route | Notes |
|---|---|---|---|---|
| System / Light / Dark; all components theme-aware; no hard-coded white; contrast checked | `P:01 DARK` + observed dark artboards | P:01; P:03/3.2, 3.3D; P:04/4.2; P:05/5.1D, 5.5; P:06/6.1D (S ThemeContext palette rejected, V-07) | every route | Tokens §2.2–§2.4 and rules §2.16; derived dark specs for all other screens (DEV-67); CI tests §8.4 |

### 4.14 Onboarding (M§34)

| Step (M§34) | Ref | Src | Route | Interaction | Missing | Notes |
|---|---|---|---|---|---|---|
| 1–4 intros | 2.1 dawn full-bleed brand; 2.2–2.4 IntroPage + `IllustrationFrame` + PageDots + ink/primary CTA + "Atla" | P:02/2.1–2.4; S:OnboardingFlow.tsx | `(onboarding)/welcome`, `noise`, `proactive`, `control` | horizontal pager; "Atla" → account; "Giriş yap" → `(auth)/sign-in` | reduce-motion static frames, SE-height layout (illustration scales to 240) | illustrated buttons are inert; 2.3 greeting without a name (DEV-37) |
| 5 account | 2.5 `AuthProviderButton`s + "veya" + e-mail + legal line | P:02/2.5 | `(auth)/sign-in`, `(auth)/email-otp` | native SIWA / Google native / Microsoft PKCE / e-mail OTP (6-digit screen in 2.5 language: `TextField` + code boxes 6 × 48×56 radius 14, resend timer) | per-button loading, cancelled (silent), provider error, OTP expired/rate-limited, account-exists-with-other-provider | "Davet kodum var" text link → code sheet (`POST /referrals/apply` after sign-up) |
| 6–7 connect mail / calendar | 2.6 layout split into two steps; explainer sheets 2.7 / 2.7b / 2.7c | P:02/2.6–2.7c; S (gating IA) | `(onboarding)/connect-mail`, `connect-calendar` | `POST /integrations/:provider/start` → `openAuthSessionAsync` → the `oauth` callback redirects to the app with a one-time `completion_code` → the app calls `POST /integrations/oauth/complete {completion_code, device_nonce}` with its JWT; the account is bound only when `oauth_states.user_id = auth.uid()` and the device nonce hash matches (R-07) → ConnectPill "Bağlandı"; Apple/device calendar via OS prompt → `POST /integrations/device-calendar/snapshot`; CTA "Devam · N hesap bağlı" enabled with ≥ 1 source; "Şimdilik geç" (C-17) | connecting, cancelled, error, partial scope, admin consent, Free second-account gate, denied (S calendar-denied restyled), calendar picker sheet, demo badge | the Apple row is iOS-only; Android shows "Cihaz takvimi" (C-35); official logos |
| 8 permissions review | derived: granted scopes per account (plain TR), capability toggles, calendar/OS state, denied handoff | C-01 | `(onboarding)/permissions` | `PATCH /integrations/:accountId/data-sources` | — | 2.6 list style |
| 9 personalization | 2.8 `SelectableTile` grid | P:02/2.8 | `(onboarding)/personalization` | persist `interest_categories` | 0 selected → CTA "Hepsini göster" | "Hepsi" selects all (PRIMARY) |
| 10 briefing schedule | 2.9 | P:02/2.9 | `(onboarding)/briefing-schedule` | time pickers; Free lock rows → contextual gate | locked rows (drawn now) | AI hint removed |
| 11 VIP | derived from 6.6 + 2.8 selected-card style: suggestions from the first metadata pass (top correspondents), search box, "Atla" / "Devam (n)" | S:OnboardingFlow VIP (IA); P:06/6.6 | `(onboarding)/vip` | upsert `vip_people` | no suggestions yet (search only), Pro gate (VIP is Pro: a Free user sees the step with a "Pro'da" note and can skip) | — |
| 12 first analysis | 2.10 night + `PulsingRing` + checklist | P:02/2.10 | `(onboarding)/analysis` | `POST /onboarding/first-analysis` → poll `GET …/:jobId` every 1–2 s while running (no Realtime, R-19); real counts from `jobs.progress` | slow > 60 s ("Hazır olunca haber vereyim" → continue), failure + retry, partial, zero data, backgrounded resume | footer copy fix (DEV-33); window: mail 72 h back + calendar 48 h ahead (D-45) |
| 13 aha | 2.11 dawn full-bleed + findings panel | P:02/2.11 | `(onboarding)/ready` | CTA → notifications step → first briefing (order a, D-49) | zero findings ("Son 72 saatte acil bir şey yok."), 1–2 findings | "hazırlık hazır" line only for entitled users |
| 14 notifications | 2.12 | P:02/2.12 | `(onboarding)/notifications` | §4.9 | §4.9 | — |
| Android extra | 2.13 | P:02/2.13 | `(onboarding)/android-notifications` | §4.12 | not granted/granted | Android only; skippable |
| 15 Today | 3.1 first-day variant | P:03/3.1 | `(tabs)/today/index` | — | first-day hero ("İlk brifingin hazır") | resume at the persisted step on relaunch |

### 4.15 Paywall, Referral

| Req | Ref | Src | Route | Interaction | Missing | Notes |
|---|---|---|---|---|---|---|
| M§43–44 paywall | 7.5: onboarding-tint bg, close + "Satın alımı geri yükle", kicker, `titleXl`, sub (weekly stats or static fallback), `PlanComparisonTable`, `PlanOptionCard` × 2, CTA, "Free ile devam et", legal lines | P:07/7.5; P:hub/isPaywall; S:marketing/Paywall.tsx | `paywall?source=` (modal) | RevenueCat offerings; `purchasePackage` → `POST /purchases/sync` → entitlement refresh → success → dismiss; restore → found/none/error; "Aboneliği Yönet" when already Pro | offerings loading/failed, purchasing, cancelled, pending (Ask to Buy), error, already Pro, not trial-eligible ("Pro'ya Geç"), offline, dark | prices from `priceString`; savings computed; trial copy only if eligible (C-09); Terms/EULA + Privacy links added; rows add "Evrensel yakalama", "Android bildirim zekâsı" (Android), "AI analiz limiti" (Free "50/gün", Pro "Adil kullanım"; never "Sınırsız") (DEV-34, R-02) |
| M§44 contextual gate | `ProGateCard` | P:07/7.6 | inline on gated surfaces (Today midday, prep, voice briefing, VIP, memory, capture, commitments, follow-up) | trial/upgrade → `paywall?source={feature}`; "Şimdi değil" → suppression for `app_settings` `pro_gate.snooze_days` (7) days, stored in `user_preferences.dismissed_gates`; analytics `pro_gate_viewed{feature}` / `pro_gate_dismissed{feature}` | count 0 → hidden | the gate count comes from deterministic signals (no LLM for Free, §82) |
| Subscription status | derived 7.1 language: plan, source (Mağaza / Davet / Destek), renewal/expiry, referral bonus days, "Aboneliği Yönet" (`showManageSubscriptions`), "Satın alımı geri yükle" | S F-03 (IA) | `settings/subscription` | `GET /me/entitlements` | grace/billing issue, expired | — |
| M§45 referral | 7.7: dawn hero card, `ReferralLinkField`, primary "Davet Gönder" (`ios_share`), "DAVETLERİN · n" `InviteRow`s, footer | P:07/7.7; S:marketing/Referral.tsx | `settings/referral` | copy → `expo-clipboard` + toast "Bağlantı kopyalandı"; share → RN `Share` with `https://<web>/r/{code}`; `GET /referrals/me` | empty, reward cap reached, rejected (abuse) row, loading, offline (copy still works) | URL path `/r/[code]` (plan) replaces the design's `/d/` (D-41); cap wording "Yılda en fazla {n} ödül", with n from `plan_limits` key `referral_rewards_per_year` (6); rows only for attributed sign-ups (no e-mail invite rows) |

### 4.16 Approval Center (cross-cutting, M§33)

| Req | Ref | Src | Route | Interaction | Missing | Notes |
|---|---|---|---|---|---|---|
| Statuses, 6 types, what/why/source/change/account/side effect, Onayla/Düzenle/Reddet, idempotency | `DetailHeader` + text action "Geçmiş" + h1 "Onay Bekleyenler" + sub + `ApprovalCard` full + "BUGÜN ONAYLANANLAR · n" list + `AssuranceNote` | P:06/6.8; P:hub/isApprovals; S:shared/ApprovalCenter.tsx | `approvals/index` (tabs Bekleyen / Geçmiş), `approvals/[id]` | lists via `list_approvals` (RPC-10: pending tab `{pending}`, history tab the other statuses); `PATCH /approvals/:id`, `POST /approvals/:id/approve {idempotency_key}` (`approved_via = approval_center`), `/reject`; status polled while `executing` (R-19); history filters by status | executing, executed, failed, expired, conflict, offline (approve blocked with "Bağlantı gelince onaylayabilirsin"), empty (`empty/approvals`) | history retention label from config (P-04); the inline approval sheet is used from other screens (SREQ-43) |

### 4.17 Smart Reminders (cross-cutting, M§29)

| Req | Ref | Src | Route | Interaction | Missing | Notes |
|---|---|---|---|---|---|---|
| 6 presets, "Uygun zamanda" calendar-aware, confirmation | `Sheet` "Ne zaman hatırlatayım?" + context subtitle + `OptionRow` × 6 + sticky confirm | P:04/4.11; P:hub/sheetDefs.remind; S:ui/SmartReminderSheet.tsx | `reminders/new?sourceType=&sourceId=&mode=` | `POST /reminders/resolve-time` per preset (absolute time + reason) → selection → "Hatırlatıcıyı Kur · {zaman}" → `POST /reminders` → toast with undo; external destination → approval | no anchor (the two "önce" rows disabled, reason "Saat bilgisi yok"), past time, no calendar (smart disabled "Takvim bağlı değil"), computing smart slot, notification denied banner, existing reminder (edit/cancel), offline | labels: 30 dakika önce · 1 saat önce · Bu akşam · Yarın sabah · Uygun zamanda · **Kendin seç** (V-09, S-04 order); "Bu akşam" = the evening briefing time; "Yarın sabah" = the morning time (D-26) |

### 4.18 Public Web (M§73–74) — design in PRIMARY language (no PRIMARY web artboards)

**References:** P:09 store frames (compositions and copy), `P:hub` hero copy, `S:marketing/Landing.tsx` (IA only; dark Inter visuals and false claims rejected).

**Global rules**

- **Tokens:** `tokens.css` via `@theme`. Colour scheme: system (`prefers-color-scheme`) plus a footer toggle stored in `localStorage` (convenience only).
- **Grid:** 12 columns; max width 1200 (legal pages 720); gutters 24 desktop / 20 mobile. Breakpoints: <768 / 768–1199 / ≥1200.
- **Section rhythm:** 96 px desktop / 64 px mobile. Backgrounds alternate `bg` and `bgEditorial`.
- **Focus:** 2 px `border.focus` ring with 2 px offset.
- **Motion:** 300 ms reveal-on-scroll (opacity + 8 px), none under `prefers-reduced-motion`.
- **Images:** real app screenshots from demo mode only (§8.6); device frames drawn in CSS (radius 48, 12 px `#1A1917` bezel, `shadow.page`).

| Route | Section / screen | Design spec | Interaction | States |
|---|---|---|---|---|
| `/` | Nav | Sticky 64 h, `surface` at 92% + backdrop blur; brand mark 36/r11 + "Dijital Asistan" 17/600; links Özellikler · Güvenlik · Fiyatlandırma · SSS (14/500 `text.secondary`, active `text.primary`); CTA primary `sm` "Uygulamayı İndir" (anchors to CTA; desktop shows QR) | keyboard nav, skip link | mobile menu sheet |
| `/` | Hero | `gradient/dawn-fullbleed` band; left: kicker "DİJİTAL ASİSTAN" (13/600 .75), `webDisplay` white "Bugün bilmen gerekenleri, sen sormadan söyler.", lead 20/30 `on-gradient/secondary` "Dijital Asistan mailini, takvimini ve açık işlerini anlayıp her gün sana kısa bir brifing hazırlar.", official App Store / Google Play badges + desktop QR (`qr_code_2` framing); right: device with Today (3.1) | badges → store URLs | — |
| `/` | Integrations | `bg`; kicker "ENTEGRASYONLAR"; official logos Gmail, Outlook, Google Takvim, Microsoft Takvim, Apple Takvim (iOS), Google Tasks, Microsoft To Do, Apple Anımsatıcılar; note 13 "Tüm markalar sahiplerine aittir; resmi ortaklık anlamına gelmez." | — | — |
| `/` | How it works | 3 step cards (`Card` radius 20, `shadow.card`): "Bağla" (`link`), "Anla" (`auto_awesome`), "Sana söyle" (`sunny`) with one sentence each | — | — |
| `/` | Morning Briefing · Mail Intelligence · Meeting Prep · Smart Planning · AI Memory | Alternating 2-column feature rows: text (`webKicker`, `webH2`, `webLead`, 3 bullets with `check` `#1E7A47`) + device with store frames 01/02/03/05/06. Headlines per M§74: "83 mail. Gerçekten önemli olan 4.", "Toplantıya hazırlıksız girme.", "Takvimini sadece göstermez. Anlar.", "Dijital hayatına sor." | — | Smart Planning visual uses back-to-back + prep-slot insights (no travel ETA, D-58) |
| `/` | Security | `InkCallout`-style panel (radius 24) with the M§40 promises + "Önemli işlemler sen onaylamadan gerçekleştirilmez." + link to `/privacy` | — | — |
| `/` + `/pricing` | Pricing | Two plan cards (Free / Pro) + web `PlanComparisonTable`; prices as "Mağaza fiyatı · {range}" with a note that the store price is authoritative; no trial claim unless configured; no "Kredi kartı gerekmez" (C-27) | CTA → store badges | — |
| `/` | FAQ | Accordion (`Accordion` web: header 56, 17/600, chevron rotate 200 ms, body 16/26), content single-sourced from `packages/i18n` (shared with `/support`) | `aria-expanded` | — |
| `/` | Final CTA | dawn band, "Gürültüyü değil, önemli olanı gör." + badges + QR | — | — |
| `/privacy`, `/terms` | Legal reading layout | `bgEditorial`, 720 max, `webLegalBody`, h2 24/30, sticky TOC ≥1200, last-updated date, TR/EN | anchor links | — |
| `/support` | FAQ + contact form | fields: e-posta, kategori (plan `ticket_category`), mesaj; `TextField` web 48 h radius 14 | `public-api` PUB-01 `POST /support` → success only after 2xx; rate-limit error message | validation, sending, error |
| `/data-deletion` | Stepper (e-posta → OTP → onay → durum) | 3-step progress kicker "ADIM n / 3"; destructive primary "Silme Talebi Oluştur"; status copy "Talebin alındı; {n} gün içinde tamamlanır." | `public-api` PUB-02 `POST /data-deletion/start` (sends the e-mail OTP) → PUB-03 `POST /data-deletion/verify` (6-digit code; creates the account deletion request); responses never reveal whether an account exists | OTP invalid/expired |
| `/r/[code]` | Referral landing | dawn-fullbleed hero: "Arkadaşın seni Dijital Asistan'a davet etti." + "İlk brifingini aldığında ikiniz de 14 gün Pro kazanırsınız." (only when the programme is active) + badges + "Kodu kopyala" (mono) | deep link / store fallback | invalid code ("Bu davet bağlantısı geçerli değil.") |
| `/oauth/done` | Universal-link fallback | centred card: `check_circle` success 48 + "Bağlantı tamamlandı." + "Uygulamaya dönebilirsin." + primary "Uygulamayı Aç" | opens `dijitalasistan://integrations/callback?completion_code=…`; the app then calls `POST /integrations/oauth/complete` (the web page never binds the account itself, R-07) | error variant with the reason |
| — | 404 · OG images | 404: `EmptyState` web variant "Bu sayfa bulunamadı." + home link. OG 1200×630 via Next `ImageResponse`: dawn + headline + brand mark | — | — |

### 4.19 Backoffice (M§46–72) — design in PRIMARY language (no reference in either archive)

**Visual system (derived):**

- **Scheme:** light default; dark via a toggle persisted in `admin_preferences` (M§72). Same `tokens.css`.
- **Surfaces:** page `bg`; panels and tables `surface`; hairlines per tokens. Indigo only for primary actions, selection, focus and links.
- **Typography:** backoffice density scale (§2.7). Tabular numbers everywhere. IDs in `boMono`.
- **Layout:**
  - Sidebar 248 px (collapsible to 64 icon-only), `surface`, right hairline.
  - Groups exactly per M§46 (kicker `boKicker`: OVERVIEW / USERS / OPERATIONS / AI / BUSINESS / PRODUCT / PRIVACY / SYSTEM).
  - Item 36 h, radius 10, icon 20 + 14/500. Active: `brand.soft` bg + `brand.onSoft` text (no side stripe).
  - Top bar 56 h: breadcrumb + global search trigger ("Ara… ⌘K") + theme toggle + admin menu (MFA status, "Tüm oturumları kapat", Çıkış).
  - Content padding 24/32, fluid up to 1600.
- **KPI tiles (dashboard only):** the "KPI kutusu yok" rule is scoped to consumer Today (deviation DEV-69). `StatTile` backoffice variant: radius 16, padding 16, label `boMeta`, value 24/30 600 tabular, delta chip (success/critical text, `trending_up`/`trending_down`).
- **Status badges** (lifecycle map, colour = operational meaning):

  | Enum | Mapping |
  |---|---|
  | `job_status` | queued neutral · running info · completed success · retrying warning · failed critical · dead_letter critical (with `error` icon) |
  | `account_status` | connecting/syncing info · healthy success · partial / needs_reauth / admin_consent_required warning · error critical · disconnected neutral |
  | `approval_status` | same as the mobile map |
  | `briefing_status` | scheduled neutral · generating info · ready/delivered success · skipped neutral · failed critical |
  | `notification_decision` | scheduled neutral · sent success · suppressed/deduplicated neutral · failed critical |
  | `ticket_status` | open info · in_progress info · waiting_user warning · resolved success · closed neutral |
  | `prompt_status` | draft neutral · active success · archived neutral |
  | `admin_role` | neutral with the role name |

- **DataTable (TanStack Table v9):**
  - Header row 36, `boKicker` in `text.tertiaryStrong`, sticky, sort `arrow_upward`/`arrow_downward` 14.
  - Rows 44 (compact 36), `boTable`, hover `surfacePressed`, selected `brand.soft`; row actions via `more_vert` menu.
  - Toolbar: `SearchField` 36 h + filter chips (`FilterChip` compact) + "Sütunlar" (`view_column`) + export where permitted.
  - Server pagination footer ("1–50 / 1.284", page size 25/50/100).
  - Loading: 8 skeleton rows. Empty/error/retry: `EmptyState` and `ErrorCard` web variants.
- **Forms:** inputs 40 h radius 12. Labels 13/600 above. Helper 12. Errors use `critical/text-strong`.
- **Sensitive mutations:** `ConfirmDialog` web (width 440) with a required "Gerekçe" textarea (min 10 characters); a destructive action requires typing the object identifier. Every confirmation shows "Bu işlem denetim kaydına yazılır."
- **PII masking:** masked value in `boMono` (`yu***@gmail.com`) + `visibility` reveal button (permission-gated; the reveal is audited; a 30 s auto-re-mask with a countdown ring).
- **Command palette (⌘/Ctrl K):** modal 640 w, radius 24, `shadow.modal`; input 48 h; results grouped (Kullanıcılar, Sayfalar, Eylemler); arrow-key navigation; destructive actions route to their confirmation flows.
- **Charts (Recharts):** gridlines `border.hairline`; axis text `boMeta` `text.tertiaryStrong`; tooltip `surface` + `shadow.s1` radius 12. Categorical series max 5, ordered `#5B5CE2`, `#2262BE`, `#1E7A47`, `#9A6300`, `#6B6860` (dark: `#8586F2`, `#8DB8F5`, `#6FCF97`, `#F0B85A`, `#A39F96`); sequential single-hue indigo ramp (`#EDEDFC` → `#4547C9`); error series always `#E0553F`. Every chart has a data-table toggle for accessibility.
- **Auth pages:** `/login`, `/mfa` centred card 400 w, radius 24, `shadow.card` on `bg`; brand mark 36/r11 + "Dijital Asistan · Yönetim". `/login` = e-posta field → 6-digit e-mail one-time code in 6 × 48×56 code boxes (first factor; no password field, no magic link, R-08); `/mfa` = mandatory TOTP in the same 6 × 48×56 code boxes (enrolment shows the QR and the manual key); the `aal2` gate explains "İki adımlı doğrulama zorunludur."
- **Idle timeout warning:** `InAppBanner` web "Oturumun {n} dakika içinde kapanacak" + "Devam et".

**Page templates:** List (toolbar + DataTable) · Detail (header with identity, status badges and action bar; tabs per plan §10 `/users/[id]/{overview,integrations,briefings,usage,subscription,referrals,support,audit}`; right-rail metadata 320 w) · Dashboard (KPI grid 4 columns, charts 2 columns, alert list) · Editor (prompt editor: monospaced 13/20 code area, version list rail, diff view, "Etkinleştir" with confirmation).

---

## 5. Contradictions and resolutions

### 5.1 Secondary docs vs MASTER (functional; MASTER binding) — honoured as resolved in the secondary-docs audit

| ID | Topic | Resolution (binding) |
|---|---|---|
| C-01 | Onboarding order | MASTER order; explainer right before each OAuth/OS prompt; step 8 is a permissions review screen |
| C-02 | Briefing sections | M§9 labels exactly |
| C-03 | Evening sections | M§11 (Tamamlananlar / Yarına Kalanlar / Takip / Yarının ilk etkinliği) |
| C-04 | Flow card types | M§13's 9 types (Flight added; bill → Payment) |
| C-05 | Mail category label | "Düşük Öncelik" (no "Gereksiz") |
| C-06 | Post-meeting save | "Kaydet" = explicit approval; `commitment_create` approval row approved in place; low confidence → mandatory confirmation |
| C-07 | Voice write actions | Approval card + tap; no speech-only approval |
| C-08 | Reminder creation | Confirm step with the resolved time; external destinations via approval |
| C-09 | Trial and prices | Store-driven prices; trial only if eligible; Restore + Manage |
| C-10 | "Sınırsız AI analiz" | Removed; Pro shows "Adil kullanım", Free shows "AI analiz limiti 50/gün" (R-02) |
| C-11 | Android NI scope | Default locked denylist even in all-apps mode |
| C-12 | Android NI processing claim | True under ADR-12 (on-device extraction); copy made precise (§4.12) |
| C-13 | Training toggle | None; static no-training statement |
| C-14 | Push content | Default title-only/generic; names only in full mode |
| C-15 | Life amounts | Only when grounded, else "Kaynakta kesinleşmiyor." |
| C-16 | Approval vocabulary | Plan enum only |
| C-17 | Onboarding gate | ≥ 1 source; skippable to partial mode |
| C-18 | Settings list | Union of PD§55 and M§130 |
| C-19 | Notification settings | 8 categories + Quiet Hours + Lock Screen Privacy + detail level |
| C-20 | Priority rules | Union + MASTER precedence |
| C-21 | Midday cadence | Evaluate at 13:00; generate only on delta; "skipped" otherwise |
| C-22 | Localization | Full English now |
| C-23 | Dark scope | All screens |
| C-24 | Web login | No "Giriş"; `/data-deletion` form |
| C-25 | Widgets | Union incl. Android 2×2 / 4×2 |
| C-26 | Landing FAQ | Added |
| C-27 | Marketing truthfulness | No "Kredi kartı gerekmez"; trial only if the offer exists |
| C-28 | Follow-up labels | "Yarın hatırlat" / "Kapat" |
| C-29 | Email detail meta | M§15 fields |
| C-30 | Audio seek | Seek bar added |
| C-31 | Privacy highlight copy | M§40 verbatim |
| C-32 | Capture extraction types | M§27's 10 types |
| C-33 | Capture sources | + File + share sheet |
| C-34 | First flow end | Aha → Notification → Today |
| C-35 | Integrations by platform | Apple rows iOS only; "Cihaz takvimi" on Android |
| C-36 | Conflict resolution | No fabricated availability; free/busy only when accessible |
| C-37 | Approval navigation | Inline approval sheet; the Approval Center is the persistent queue |

### 5.2 Secondary vs PRIMARY (visual; PRIMARY wins)

| ID | Resolution |
|---|---|
| V-01 | Geist (not Inter) |
| V-02 | Warm neutrals |
| V-03 | PRIMARY status colours (no iOS system colours) |
| V-04 | Kural 1 badges |
| V-05 | PRIMARY brand steps and gradients (no gradient buttons, no glassmorphism hero) |
| V-06 | Material Symbols Rounded; no emoji UI icons |
| V-07 | PRIMARY DARK tokens |
| V-08 | PRIMARY radius and elevation |
| V-09 | Label **"Kendin seç"** (MASTER copy) with PRIMARY visuals |

### 5.3 Secondary self-contradictions

| ID | Resolution |
|---|---|
| S-01 | ≥ 1 source; partial mode |
| S-02 | Bucket renamed "BU HAFTA" |
| S-03 | One deterministic demo dataset for all marketing figures; in-app numbers computed |
| S-04 | Preset order per M§29 |
| S-05 | Global theme |
| S-06 | English now |
| S-07 | Generate → Edit → Approval → Send → confirmation of the executed send |
| S-08 | M§9 labels |
| S-09 | Defaults 08:00 / 13:00 / 19:00; weekly Sunday 18:00 |
| S-10 | PRIMARY visuals |
| S-11 | Weekly, Paywall and Referral are product screens; widgets are native targets; store and social assets live in `design/` and `apps/web` |

### 5.4 PRIMARY claims vs MASTER

| ID | Resolution |
|---|---|
| P-01 | Privacy footer rewritten; region only when configured; subprocessors disclosed on `/privacy` |
| P-02 | Non-critical daily cap enforced by the decision engine through `notification_preferences.daily_cap` (default 5). The copy "Günde ortalama 3 bildirim" is removed and replaced by "Sadece önemli olduğunda haber veririz." (R-14) |
| P-03 | Trial reminder scheduled from RevenueCat expiration, or the line is hidden |
| P-04 | Retention copy built from config |
| P-05 | No-training claim kept, documented against provider terms |
| P-06 | Referral reward cap = `plan_limits` key `referral_rewards_per_year` (6), enforced by `private.reward_referral`; the copy "Yılda en fazla {n} ödül" reads the configured value |

### 5.5 New contradictions found between PRIMARY files (D-nn)

| ID | Conflict | Resolution |
|---|---|---|
| D-01 | Tab bar 84 (P:01) vs 90 (screens); glass .9 vs .92 | Height `62 + insets.bottom`; glass .92 |
| D-02 | Sheet radius 24 vs 28; option rows 44/14 px vs 52/15 px | 28; 52 (60 two-line) |
| D-03 | Filter chip unselected `#F5F4F0` vs `#FFF` | Container-relative (§3.3) |
| D-04 | `info` `#3B82E6` declared "Ulaşım ikonu" but icons use `#2262BE` | Icons use `info/text`; `info` only for non-text fills |
| D-05 | Calendar-intel icons use text tones vs icon tokens | Text tones for meaningful icons (contrast) |
| D-06 | Wait badge rule (≥ 7 coral) vs "6 gün" coral | Rule wins; thresholds 3/7 configurable |
| D-07 | Kural 1 vs lifecycle colours (BEKLİYOR, BUGÜN, GECİKMİŞ, TAMAMLANDI, TAKVİM, PRO) | Kural 1 governs category badges; lifecycle map §2.5; TAKVİM neutral |
| D-08 | Lora scope rule vs usage | Extended scope (§2.7) |
| D-09 | Radius scale lacks 18/24 | Added |
| D-10 | 4-grid stated vs 2-grid used | 2-px sub-grid tokens |
| D-11 | Destructive: "Modal yalnızca geri alınamaz işlemler" vs 7.4 sheet; "Vazgeç" 44 vs "aynı boyutta" | ConfirmDialog for single-object; DestructiveSheet for consequence lists; "Vazgeç" same size in sheets |
| D-12 | 7.12 "geri alınamaz" dialog + undo toast; 7.4 caption claims consistency | Rule deletion = soft delete + 5 s undo (dialog copy without "geri alınamaz"); history deletion is irreversible with no undo |
| D-13 | 5.5 caption "kontrast 9:1" | Actual 5.96:1 (AA pass); caption not reproduced |
| D-14 | Active tab wght 500 (hub) vs 400 (01) | FILL 1 at wght 400 |
| D-15 | Switch knob shadow pure black | Warm ink `rgba(27,25,23,.2)` |
| D-16 | Calendar year: hub/03/06/07 = 2026 ("5 EYLÜL CUMARTESİ") vs 04/05 strip = 2025 ("Cum 5", "Per 11 Eyl") vs 5.2 "7–13 EYLÜL" (2026) vs 5.3 "ÇARŞAMBA · 10 EYLÜL" (2025) | All dates computed from now in the user tz; demo fixtures relative (DEV-18) |
| D-17 | Urgent "revize teklif" sender: Ahmet (hub, 4.1, 4.3, 4.7) vs Mehmet (4.4, 4.5) | Fixture canon: **Ahmet Yılmaz (Kuzey Lojistik)** requests the revized offer by 17:00 today |
| D-18 | Prep/Person attribute the 17:00 revize teklif to Mehmet | Canon: **Mehmet Yılmaz (Yılmaz Endüstri)** has the 14:30 meeting; topics: "Teklif v2" feedback pending 3 days, Ekim teslim, contract awaiting legal review |
| D-19 | Mehmet "no reply for 3 days" vs "emailed yesterday 18:20" | Canon: Mehmet's last inbound (yesterday 18:20) asks about the delivery date on a different thread; the "Teklif v2" thread has no reply. Surfaces derive from one dataset |
| D-20 | 3.2 vs 3.6 carry-over items differ | Computed |
| D-21 | Briefing "Bugün oldukça sakin" vs content | Generated from data |
| D-22 | "Günaydın, Yunus" vs "Günaydın Yunus" | Comma everywhere |
| D-23 | Section naming drift across briefing, prep and assistant | Briefing = M§9 labels; prep/person keep "SENDEN BEKLENENLER / SENİN BEKLEDİKLERİN" |
| D-24 | "deadline'lar", "Deadline 17:00" | "son tarih" |
| D-25 | "Özel zaman" vs "Kendin seç" | "Kendin seç" |
| D-26 | "Yarın Hatırlat" 09:00 (hub) vs morning default 08:00 | User's morning briefing time |
| D-27 | "Onay Merkezi" vs "Onay Bekleyenler" | Entry label "Onay Merkezi"; pending-tab h1 "Onay Bekleyenler"; history h1 "Onay Geçmişi" |
| D-28 | Profile: 7.1 grouped (close) vs hub flat (back) | 7.1 layout, presented as a push from the avatar (back button) |
| D-29 | Save CTA indigo (7.10) vs ink (7.11) | As designed: create = primary, save edits = ink (zero change, codified) |
| D-30 | MOTION table vs "BRİFİNG AÇILIŞI" frames | Normalised timing (§2.13) |
| D-31 | Midday "GÜNÜN GERİ KALANI" omits 16:00 | Computed |
| D-32 | Mail Zekâsı arithmetic (8 vs 6; 77 vs 75; bars sum 81) | Mutually exclusive primary categories; one query |
| D-33 | TAMAMLANDI commitment shows the open-item actions | Only "Kaynağı Gör" |
| D-34 | 4.10 direct "Takvime Ekle" vs the approval pattern | Approval sheet |
| D-35 | 4.12d vs 4.13d approval row fields; "Bugün'e Dön" targets | Union of M§33 fields; return to origin |
| D-36 | 4.9 pushed "Kişisel" list vs 4.2 Kişisel filter | Flow filter is the list (AttentionCard); LifeCard is the detail header and Today; no 4.9 route |
| D-37 | Voice gradient 70% vs `gradient/night` 60% | Token (60%) |
| D-38 | Sheet row 60 (05) vs 52 | 52 single-line, 60 two-line |
| D-39 | Suggested-question trailing icon | `arrow_outward` (PRIMARY) |
| D-40 | Trial offered to a user already in trial (hub) | State-driven paywall |
| D-41 | Referral link `/d/{code}` | Plan route `/r/[code]` |
| D-42 | 7.2 scope string "Taslak oluşturma" (gmail.compose) | No compose scope (ADR-07); strings derived from granted scopes |
| D-43 | Provider tiles use semantic colours as brand stand-ins | Official logos |
| D-44 | Lock-screen widget spec unrealizable as drawn | System vibrant rendering; inline above the clock |
| D-45 | 2.10 window "Son 72 saat · Gmail ve Google Takvim" | Mail 72 h back + calendar 48 h ahead |
| D-46 | 7.3 "Mesajlaşma içerikleri" never vs 2.13 messaging toggle | Messaging hard-excluded; shown as a locked row |
| D-47 | Day-strip dot semantics undefined; 5.1 proposal window vs 45-min block | Dots defined (§3.11); the proposal is a block inside the window |
| D-48 | Two Today empty copies (08 vs hub) | 08 copy + conditional next-briefing line |
| D-49 | 2.11 CTA "Brifingimi Gör" leads to 2.12 | 2.11 → 2.12 → first briefing |
| D-50 | "ADIM n / 4" vs actual post-account steps | "ADIM n / 6" (DEV-36) |

---

## 6. Prototype-only behaviours NOT to copy

| # | Source | Prototype behaviour | Real behaviour |
|---|---|---|---|
| 1 | `P:hub/approveSend` | `setTimeout(900)` → "Gönderildi" | `email_send` approval → server execution → provider accepted → SuccessState; failure path |
| 2 | `P:hub/ask()` | Canned `QA` answers after 1 s typing dots; suggestions vanish; composer dead | Streaming grounded assistant with citations; send button; persistent threads |
| 3 | `P:hub/voicePrompts` | Canned `VOICE` answers after 900 ms | STT → assistant → TTS; approval card for writes |
| 4 | `P:hub/togglePlay` | `setInterval` playhead, hard-coded 134 s and chapter starts, decorative waveform | `expo-audio` with real duration and chapters from the audio asset; waveform decorative but position-driven |
| 5 | `P:hub` all data arrays (PRIOS, FEED, BRIEF, PREP, PERSON, DAY, WEEK, QA, VOICE, SETTINGS, PRO) | Hard-coded; lost on reload | Supabase queries + persisted cache; demo fixtures only behind `DEMO_MODE` |
| 6 | `P:hub` nav | Tab tap wipes the stack; "Bugün'e Dön" clears the stack without switching tab | Per-tab stacks; explicit navigation to the origin root |
| 7 | `P:hub/addApproval` | `id:'a'+Date.now()` duplicates | `POST /approvals` with an idempotency key (source + action + payload hash) |
| 8 | `P:hub/isPlan` "Planla" | Instantly "Planlandı" + toast; restyles the unrelated 17:00 row | Proposal sheet → approval → provider write → refetch |
| 9 | `P:hub/sheetDefs.remind` | Presets hard-wired to 17:00 / "12:10"; toast "Hatırlatıcı kuruldu" | `resolve-time` + confirm + `POST /reminders` |
| 10 | `P:hub/sheetDefs.correct` | VIP name via `source.split(' · ')[1]`; no re-rank | `person_id` on the insight; feedback write + re-rank |
| 11 | `P:hub/isToday` | p3 title opens Ahmet's mail; p4/p5 titles dead; complete without persistence or undo | Entity-typed routing; status RPC + undo |
| 12 | `P:hub/isReply` | "Düzenlenebilir" draft not editable; "Düzenle" toast | TextInput editor |
| 13 | `P:hub` toast stand-ins | "Ekran görüntüsü, PDF veya link ekle · Bkz. 04 Akış", "Hafıza araması · Bkz. 06 Asistan", "Çözüm seçenekleri · Bkz. 05 Plan", "Tamam, başka bir boşluk önereceğim", "Özet okunuyor · 2 dk", "Taslak düzenleme modunda", "Düzenleme Plan sekmesinde açılır", "Prototipte çıkış devre dışı", "{Row} · Bkz. 07 Hesap", "Kargo takibi açıldı · Teslimatta haber veririm", "{action} · Kaynak açıldı", "Yarın 09:00'da hatırlatırım", "7 günlük deneme başladı · 12 Eylül'de hatırlatırım" | Real screens, sheets and handoffs (§4); toasts only after a persisted change |
| 14 | `P:hub/isPaywall` `startTrial` | Pops + toast; no purchase | RevenueCat purchase flow |
| 15 | `P:hub/isProfile` | "{name} Emre" surname; "Önemli Kişiler" opens Mehmet | Profile data; `vip` list |
| 16 | `P:hub/isPrep` | "2 Dakikalık Özeti Oku" toast; "Not Al" → post-meeting | `meeting/[eventId]/summary`; notes sheet; post-meeting at event end |
| 17 | `P:hub/isWeek` | "Seçenekleri Gör" toast | `plan/conflict/[id]` |
| 18 | `P:hub/isApprovals` | Local status flips only; no executing/failed/expired | State machine via `api` |
| 19 | `P:hub/isAsistan` | "Hafıza" toast | `memory` |
| 20 | `P:hub` kicker | `toUpperCase()` → "SAMIMI" | `toLocaleUpperCase(locale)` |
| 21 | `P:02/2.10`, `S:onboarding/OnboardingFlow.tsx` | Scripted counters and 1 s step timers | Job progress by polling `GET /onboarding/first-analysis/:jobId` every 1–2 s (`jobs.progress`; no Realtime, R-19) |
| 22 | `P:02/2.9` | "genelde 08:15'te telefonu açıyorsun" | Data-backed hint or none |
| 23 | P:02–P:09 fixed dates, "07:58", "18 dk", "0:42" | Frozen display strings | Locale/tz formatting; live countdowns |
| 24 | P:04/P:05/P:06 fabricated data (travel ETA "38 dk", "06:45/19:10'da çıkman", Netflix "2 kez izlendi", "Geçen ay 1.610 TL", "Okundu", "Telefon görüşmesi · 12 dk", "Satın alma müdürü", "Klinikte 15:45 boş", "Mehmet 16:00'yı önerdi", "2 bilet · 1.450 TL", "Teklif_v3.pdf") | Shown as facts | Rendered only with a `source_ref`; otherwise hidden |
| 25 | `S:screens/SplashScreen.tsx` | 2,200 ms timer to onboarding on every launch | Native splash + auth/onboarding-state routing |
| 26 | `S:context/NavigationContext.tsx` | Single stack; `params` never passed (every detail shows `mock[0]`) | Expo Router with typed params |
| 27 | `S:components/ui/SmartReminderSheet.tsx` | "Hatırlatıcı Oluşturuldu" after `setTimeout(1400)` | `POST /reminders` |
| 28 | `S:components/cards/InsightCard.tsx` | Local dismiss; 👎 dismiss after 600 ms | Status RPC + `ai_feedback` |
| 29 | `S:screens/today/TodayScreen.tsx` | ⭐ badge hard-coded 3; "Takvime Ekle"/"Görüntüle" dead; life sheet contradictory mock data; "Ödeme Yap" | Live count; approvals; grounded life fields; no payment action |
| 30 | `S:screens/today/MorningBriefing.tsx` | Fake `setInterval` audio; ±15 moves ±10% | Real audio; 15 s seek |
| 31 | `S:screens/today/MiddayPulse.tsx`, `EveningClose.tsx`, `marketing/WeeklyReport.tsx` | Dead buttons (Kabul Et/Reddet/Müzakere Et, "Yarına Hazırım ✓", "Paylaş"); local "Taşındı" | §4.2 real actions |
| 32 | `S:screens/flow/FlowScreen.tsx` | All card actions `stopPropagation` (dead); "Takip" = deadline | Real actions; follow-up filter |
| 33 | `S:screens/flow/MailIntelligence.tsx` | Reply categories wired backwards; counts hard-coded | Correct mapping; computed counts |
| 34 | `S:screens/flow/EmailDetail.tsx` | Fake "Görev Oluşturuldu" (1.5 s); "Takvime Ekle" → Plan tab; "Gmail'de Aç" only closes | Approvals; real provider handoff |
| 35 | `S:screens/flow/AIDraftReply.tsx` | Tone chips don't change text; fake "Gönderildi!" overlay; fake "Gmail açılıyor…" screen; recipient hard-coded | Regeneration; real send; no draft export |
| 36 | `S:screens/flow/SmartFollowUp.tsx`, `WaitingReply.tsx` | Local close; no ids passed | Persisted state; params |
| 37 | `S:screens/plan/PlanScreen.tsx` | "Onayla" fake "Takvime eklendi" (1.8 s); "Saati Değiştir" dead; Hafta view empty; date strip dead | Approval flow; free-slot picker; week view |
| 38 | `S:screens/plan/CalendarConflict.tsx` | "Çözüldü!" direct change without approval; 2 options dead; free/busy claim | Approval per option; no fabricated availability |
| 39 | `S:screens/plan/MeetingPrep.tsx` | "2 Dk Özet" → post-meeting; fake "Google Meet açılıyor…" with dead "Meet'i Aç" | Summary route; direct `Linking.openURL` |
| 40 | `S:screens/plan/PostMeeting.tsx` | Same hard-coded extraction for any text; fake success | Real extraction + approvals |
| 41 | `S:screens/plan/CommitmentTracker.tsx` | "Özel tarih" no-op; fake "Ertelendi"; generic "Kaynağı Gör" | Reminder sheet; exact source |
| 42 | `S:screens/assistant/AssistantScreen.tsx`, `VoiceAssistant.tsx` | Keyword-matched canned replies with random delay; timers for recognition; `Math.random` in render | Real pipelines |
| 43 | `S:screens/shared/ApprovalCenter.tsx` | Approve/reject remove locally after 600 ms; free-text action editing; "Kaydet ve Onayla" | State machine; typed editors |
| 44 | `S:screens/shared/SearchScreen.tsx`, `PersonIntelligence.tsx` | Hard-coded key map (ASCII keys); result rows with `screen:null`; dead "AI'ya sor" | Real search; person-scoped thread |
| 45 | `S:screens/shared/UniversalCapture.tsx` | Tiles inject sample text; fixed result; actions navigate to approvals without creating any | Pickers + pipeline + approvals |
| 46 | `S:screens/settings/Integrations.tsx` | Instant fake connect/disconnect with `yunus@example.com` | OAuth + revoke |
| 47 | `S:screens/settings/SecurityPrivacy.tsx` | Hard-coded permission statuses; fake "Sistem Ayarları açılıyor…"; fake "Geçmiş Temizlendi"/"İstek Alındı"; dead "Evet, Hesabımı Sil"; unsupported retention options | Real statuses/settings handoff; jobs |
| 48 | `S:screens/settings/*` (Notification, Briefing, AIPersonalization, DataSourceControl, VIPPeople, PriorityRules, Appearance, Language) | Local `useState` only; hooks inside `.map()` (AndroidNotifications); "Yakında" languages; ASCII Turkish | Persisted preferences; valid hooks; full EN; proper Turkish |
| 49 | `S:screens/settings/HelpScreen.tsx`, `FeedbackScreen.tsx` | Placeholder article sheet; fake submit | Real content; `POST /feedback` |
| 50 | `S:screens/marketing/Paywall.tsx`, `Referral.tsx` | CTAs `navigate('today')`; all referral buttons dead | RevenueCat; clipboard/share |
| 51 | `S:screens/marketing/{AppStoreScreenshots,SocialAds,Landing,AndroidFrame,WidgetShowcase,NotificationExamples}.tsx`, `S:screens/states/{DesignSystem,IAPage,UserFlows,EmptyStates,ErrorStates,LoadingStates}.tsx`; `ProfileScreen` "Tasarım Sistemi" / "Diğer" groups (F-02) | Prototype-only navigation; dead export buttons; fake retry | Not shipped. The notification catalogue becomes server templates; states become `packages/ui`; the landing IA goes to `apps/web` |
| 52 | F-03..F-13 (secondary-docs) | Paywall for Pro users; Android row on iOS; simulated handoff screens; fake export/delete; fake trial success; fake counters; local "Bağlandı"; local timeline insert; flow diagrams; hard-coded prices; false claims | Resolved per the audit (§5) |

---

## 7. Deviation / redesign log (M§124: minimum visual change, maximum functional completeness)

| ID | Where | PRIMARY | Production | Reason |
|---|---|---|---|---|
| DEV-01 | All informational tertiary text (kickers, meta, timestamps, placeholders) | `ink/tertiary` `#9B978E` / dark `#7A776F` | `ink/tertiary-strong` `#6F6C66` / `#8F8B83`; the original is kept for decorative/disabled use | WCAG 1.4.3 (2.65–2.91 / 3.73–4.15). Hierarchy is kept by size and weight. |
| DEV-02 | Critical text on soft/bg | `#C7432F` | `critical/text-strong` `#BE3F2C` (fills unchanged) | 4.31 / 4.47 → 4.68 / 4.85 |
| DEV-03 | AI kickers on glow | `#5B5CE2` text | `#4547C9` text (icon unchanged) | 4.12 → 5.60 |
| DEV-04 | Secondary text on AI glow | `#6B6860` / `#A39F96` | `#65625B` / `#B5B1A8` | 4.45 / 4.07 → 4.86 / 5.02 |
| DEV-05 | Segmented unselected, swipe-left labels | `#6B6860` on `#E9E7E1` | `#67645C` | 4.4996 → 4.78 |
| DEV-06 | Card ✓ / ··· / edit / delete idle icons | `#B8B4AA` / `#5E5B54` | `#8F8B83` / `#85827A` | WCAG 1.4.11 |
| DEV-07 | Unchecked radio/checkbox | `#C9C5BC` | `#8F8B83` ring | 1.4.11 |
| DEV-08 | Switch off state | `#D9D6D0` fill | + 1 px inset `#8F8B83` (dark `#85827A`) | 1.4.11 |
| DEV-09 | Meaningful warning icons | `#E09A1C` | `#9A6300` (already used in 5.2) | 2.38 → 5.05 |
| DEV-10 | Swipe-right track | `#2FA062` | `#1E7A47` | White 11 px label 3.32 → 5.34 |
| DEV-11 | Inactive tab | `#9B978E` | `#6F6C66` | 2.89 → 5.19 |
| DEV-12 | Text on dawn/dusk | .8 opacity anywhere; full-bleed dawn ends `#7071EA` | .86 opacity at *t* ≤ .8; full-bleed variant ends `#5A5BD6`; bottom small text 100% white | 3.17–4.36 → ≥ 4.72 |
| DEV-13 | Dark toast | ink `#1A1917` | `#2A2926` + ring | Separation 1.28 |
| DEV-14 | Ink surfaces in dark | `#1A1917` | `#1F1E1B` + ring `.08` | Would vanish on `#141311` |
| DEV-15 | Icon axes | Variable font FILL/wght; active wght 500 | SVG components (outline/fill), wght 400 | RN cannot drive font axes; `svg-400` only |
| DEV-16 | Icon names | `auto_awesome`, `expand_more/less`, `remove_circle`, `screenshot`, `vibration` | Aliases (§2.12.3) | Missing in `svg-400@0.47.5` |
| DEV-17 | Fonts | "iOS'ta gövde SF Pro'ya düşebilir"; widgets Geist | Geist on all mobile text; Android Glance widgets use the system sans | Parity (M§3.13); Glance cannot use custom fonts |
| DEV-18 | Dates and times | Frozen "5 Eylül" (2025 and 2026 mixed), fixed times | Computed relative to now in `user_preferences.timezone`; the demo seed is relative | Correctness (M§39) |
| DEV-19 | Device chrome | Drawn status bar, dynamic island, home indicator (P:01 frame, `ios-frame.jsx`); Android 2.13 frame | Not drawn. `react-native-safe-area-context` insets. Android edge-to-edge (target API 35+): transparent status and navigation bars; `expo-status-bar` style per screen (§2.16 item 8); 3-button navigation gets the system contrast scrim. Android back: sheets and dialogs close first, then modals, then the stack pops. On a non-Bugün tab root, back goes to Bugün (`backBehavior:'firstRoute'`); on the Bugün root it exits. Predictive back is enabled via config, and custom sheets register `BackHandler`. | Platform rules (SREQ-91) |
| DEV-20 | Tab bar | Glass `rgba(255,255,255,.92)` + blur on every platform | Custom tab bar. iOS: `expo-blur`. Android, and iOS with Reduce Transparency on: opaque `surface` + top hairline. Native iOS 26 Liquid Glass tabs are not used. | Android blur cost and legibility; iOS accessibility setting; no redesign |
| DEV-21 | Toast position | Fixed 104 px from the bottom | `tabBarHeight + 14`, or above the sticky footer | Dynamic safe areas |
| DEV-22 | Hit targets | 30–36 px controls | Visual size unchanged; `hitSlop` / `minHeight` to 44 pt / 48 dp | M§92 |
| DEV-23 | Fixed heights | 34–52 fixed | `minHeight`; text wraps | Dynamic Type |
| DEV-24 | Today header | Approval pill + avatar only | Adds a 36 `IconButton` `search` to the left of the pill → `search` | M§95 needs a global entry. SECONDARY TodayScreen has one. |
| DEV-25 | Profile access from other tabs | Avatar only on Today | Kept as designed (no avatar on Akış/Plan/Asistan) | Minimum change; M§8 is satisfied through Today |
| DEV-26 | Mail Intelligence entry | None in Akış | `MailDigestRow` (grouped-row card: `mail` tile + "Mail Zekâsı · Bugün {n} mail, {m}'si dikkat gerektiriyor" + chevron) at the top of Akış when the filter is Tümü or Mail | M§14 reachability; the SECONDARY "Mail Özeti" pill idea, restyled |
| DEV-27 | Commitments on Plan | Not shown | Commitment and task rows on the day timeline, plus a row "Açık taahhütler · {n}" → `commitments` | M§19 "Calendar + tasks + commitments"; SREQ-18 |
| DEV-28 | Approval statuses | 3 statuses | 7 statuses (§3.7.1): new pills İŞLENİYOR, BAŞARISIZ, SÜRESİ DOLDU | M§33 |
| DEV-29 | Approval card fields | Neden / Değişim | + Kaynak, Hesap, Yan etki rows | M§33 |
| DEV-30 | Voice approval | "“Onayla” diyerek de gönderebilirsin." | Tap-only approval; hint "Onaylamak için karta dokun." | C-07 (misrecognition risk) |
| DEV-31 | Reminder sheet | Tapping a row commits immediately; label "Özel zaman" | Tapping a row selects it; a sticky primary button "Hatırlatıcıyı Kur · {zaman}" confirms; label "Kendin seç"; the "önce" rows are disabled when there is no anchor time | M§29 confirmation; V-09 |
| DEV-32 | Retention | 3 segments | 4 segments ("Silene kadar" added) | M§41 |
| DEV-33 | Privacy copy | "Mail içerikleri cihazında özetlenir, hiçbir şey gönderilmez." (2.10); "Belge cihazında özetlenir" (4.12b); "Hassas alan tespiti cihazda yapılır", "Kopya tutulmaz" (7.3); "Uçtan uca TLS · … Frankfurt · KVKK ve GDPR uyumlu" (7.2) | 2.10 (in progress): "Genelde 20–40 saniye sürer. Mail içeriğinin tamamı saklanmaz; yalnızca özetler, kısa alıntılar ve analiz sonuçları saklama süren boyunca tutulur." 2.11 (ready) footer: "Son 72 saat analiz edildi. Mail içeriğinin tamamı saklanmaz." (both R-15 canonical). 4.12b: "Belge güvenli sunucumuzda analiz edilir; dosya ve çıkarılan öğeler yalnızca saklama süren boyunca tutulur." 7.3 per §4.11. 7.2 footer: "Veriler aktarım sırasında ve saklanırken şifrelenir." + the region only when configured. | M§40, M§141; ADR-05 (no raw bodies stored) |
| DEV-34 | Paywall | Hard-coded TL prices; "Ücretsiz Dene · 7 gün" always; ✓ for the AI limit; no legal links; missing Pro rows | Store prices; trial only if eligible; "AI analiz limiti" row (Free "50/gün", Pro "Adil kullanım"; R-02); rows added (Evrensel yakalama; Android bildirim zekâsı on Android only); Kullanım Koşulları, Gizlilik and "Aboneliği Yönet" links | M§43/44; App Store 3.1.2; C-09/C-10 |
| DEV-35 | Appearance | Açık / Koyu / Sistem, default Açık; "Deutsch" listed | Sistem / Açık / Koyu, default Sistem; Deutsch removed; the text-size row works (multiplier sheet) | M§38, M§39, M§99 |
| DEV-36 | Onboarding steps | 2.6 combined; "ADIM n / 4"; no VIP or permissions step | `connect-mail` and `connect-calendar` both use the 2.6 layout; a permissions review step and a VIP step are added; counter "ADIM n / 6" | M§34; plan §9 routes; C-01 |
| DEV-37 | 2.3 intro | "Günaydın Yunus" shown before an account exists | "Günaydın" (no name) | Truthfulness |
| DEV-38 | Store and ads | ad/03 testimonial with a real-sounding name ("Yunus E. · Kurucu, İstanbul"); store/05 traffic ETA; §74 "Gerçekten" dropped | ad/03 uses brand voice with no attribution; store/05 shows back-to-back and prep-slot insights; store/02 headline per M§74 "83 mail. Gerçekten önemli olan 4." | TR advertising rules; M§74, §141 |
| DEV-39 | Email detail | No "Orijinal Maili Aç" handoff | Provider handoff in the `more_horiz` sheet and on source-line tap (layout unchanged) | M§15 |
| DEV-40 | Meeting prep | No join link | `CountdownPill` switches to the join variant "Katıl · {n} dk" from T−10 when a join URL exists; the location meta opens maps | M§21 |
| DEV-41 | Meeting prep | No files section | "İLGİLİ DOSYALAR" GroupedList, shown only when attachments exist | M§21 |
| DEV-42 | Person | No open-loops list | "AÇIK KONULAR" section + "Tüm iletişimi gör" row | M§30 |
| DEV-43 | AI personalization | Edit/delete only | + per-row disable switch; global "Etkileşimlerimden öğren"; "Kural Ekle" routes to Priority Rules | M§32 |
| DEV-44 | VIP suggestion | "Evet" only | + "Şimdi değil" | M§99, user control |
| DEV-45 | Plan "Planla" | Instant | Proposal sheet → approval | M§19 |
| DEV-46 | Conflict options | "Doktoru 15:45'e al — Klinikte 15:45 boş görünüyor" | "Randevuyu kaydırmak için klinikle iletişime geç" (handoff) + own-calendar update; "Beni hatırlat, kendim çözeyim" added | M§20, M§83 |
| DEV-47 | Capture tiles | "PDF" tile | "Dosya" tile (same icon); sheet "Dosya seç" accepts PDF, images and text | M§27 "File" |
| DEV-48 | Link type "Ürün" | Price tracking | Save to memory + reminder only | Scope (M§139) |
| DEV-49 | Capture undo | "Geri al" after an invite was already sent | 5 s client-side undo before the approve call is sent (the approval stays `pending`; no new status or transition, R-06); after execution, a compensating action with honest copy (reminder → `POST /reminders/:id/cancel`; commitment → `set_commitment_status` `cancelled`); invites or mail already sent cannot be recalled, and the approval sheet says so before approval | M§115, M§98 |
| DEV-50 | Weekly share | 4:5 only | Preview sheet with 4:5 and 9:16 | P:03 note; M§12 |
| DEV-51 | Evening | Note-only "Yarına Hazırım" | Confirmation sheet + per-item "Yarına taşı" + success | M§11 |
| DEV-52 | Audio | Static progress; no mini-player on screens | Draggable scrubber; MiniPlayer docked above the tab bar | M§9 seek |
| DEV-53 | Dead affordances | Briefing `ios_share`; `empty/follow-up` "Tamam"; the "96 karakter" chip styled as a button | Removed or rendered as plain text | M§99; privacy |
| DEV-54 | Settings hub | 13 rows | + "Hakkında", "Hesabımı sil" (coral, HESAP group), "Telefon Bildirimleri" (Android), "Profil" via the identity row | M§130; C-18 |
| DEV-55 | Ink CTA in dark | — | Becomes dark primary (observed rule applied everywhere) | §2.16 |
| DEV-56 | Sheets | CSS sheets | One `Sheet` component in `SheetHost`; route sheets as `transparentModal` routes rendering the same component | Consistency; deep links |
| DEV-57 | Gradients in RN | CSS | `expo-linear-gradient` + `react-native-svg` radial; `experimental_backgroundImage` not used | Stability |
| DEV-58 | Travel time | ETA cards and "çıkman gerekebilir" copy | Hidden unless the source provides it (plan §20) | M§20 |
| DEV-59 | Read receipts | "Okundu, yanıt yok" | Removed | Not available from providers |
| DEV-60 | Unsourced facts | Netflix usage, previous bill, "Satın alma müdürü" | Shown only with a `source_ref` | M§83 |
| DEV-61 | Call data | "Telefon görüşmesi · 12 dk", "Aramaları hatırlat" | Only user-created notes ("Görüşme notu · Sen") | No telephony source (iOS) |
| DEV-62 | AI suggestions and claims | Presented as facts ("hiçbiri kaçmadı", "yanıtını aldı", unsourced task deadlines) | "AI önerisi" chip; grounded rewording ("hepsi zamanında öne çıkarıldı", "Yanıtın gönderildi.") | M§83 |
| DEV-63 | Attachments in drafts | "Teklif_v3.pdf ekle" | Only existing files; otherwise the document picker | M§83 |
| DEV-64 | Life actions | "Kapıya Not Bırak", "Cüzdana Ekle" always shown | The first is removed; the second only with a `.pkpass` or Google Wallet link | M§99 |
| DEV-65 | Today hero with 0 items | "Bugün bilmen gereken 0 şey var." | Done variant: kicker "BRİFİNG · {HH:mm}", "Bugünün önemli konularını kapattın." + the next briefing line | Copy quality |
| DEV-66 | TAKVİM badge (3.5) | Info tone | Neutral | Kural 1 |
| DEV-67 | Dark mode coverage | 6 artboards | All screens, derived from tokens | M§38 |
| DEV-68 | Today AI insight card | Not on Today | At most one `AiCard` between the hero and priorities | M§8 |
| DEV-69 | Backoffice and Web | No references | Designed in the PRIMARY language (§4.18, §4.19); KPI tiles allowed only in the backoffice | M§144 |

---

## 8. Asset extraction plan and `packages/design-tokens`

### 8.1 Design reference handling

- Execution step 0 extracts both ZIPs into `design/reference/primary` and `design/reference/secondary`. These are git-ignored.
- `design/README.md` records the file list and SHA-256 of each ZIP, plus a pointer to this document.
- Nothing from the prototypes is imported at runtime.

### 8.2 Icons

1. **Manifest:** `packages/ui/icons/manifest.ts` is the single list of icon keys (§2.12.2, plus derived icons, plus aliases). Each key records the source name, the alias (if any) and whether a fill variant is needed.
2. **Codegen:** `packages/ui/scripts/generate-icons.ts` (run with `pnpm --filter ui icons`) reads `node_modules/@material-symbols/svg-400/rounded/{name}.svg` and `{name}-fill.svg`, runs SVGO, and emits:
   - `packages/ui/src/icons/generated/*.tsx` (react-native-svg components with props `size`, `fill`, `color`);
   - `packages/design-tokens/generated/icons-web/*.tsx` (React DOM SVG, for web and backoffice; proposed in §10);
   - `design/assets/icons/gallery.html`, a visual review gallery used to approve the aliases (for example `screenshot_frame`).
   The generated files are committed. CI regenerates them and fails if they differ.
3. **iOS widget:** the same SVGs are converted to PDF vector assets (template rendering) in `apps/mobile/targets/widget/Assets.xcassets`, covering `star_shine(-fill)`, `play_arrow-fill`, `schedule_send`, `event`, `groups`, `mail`, `flag`, `package_2`, `check_circle-fill` and `done_all`. The script is `scripts/icons-to-pdf.ts`, which uses the `svg2pdf` path through Playwright Chromium printing, already available in the container.
4. **Android Glance:** VectorDrawable XML is generated by the same script (SVG path to `<vector>` conversion) into `apps/mobile/modules/da-widgets/android/src/main/res/drawable/`.
5. **Licence:** Material Symbols is Apache-2.0. The notice is added to `settings/about` licences and to the web footer licences page.

### 8.3 Tokens pipeline

- **Source:** `packages/design-tokens/src/source/`:
  - `palette.ts` (raw hexes);
  - `color.ts` (semantic light and dark, per §2.2–§2.4, each value carrying `provenance: 'declared'|'observed'|'derived'`);
  - `aliases.ts` (verbatim slash names mapped to code keys);
  - `typography.ts`, `space.ts`, `radius.ts`, `elevation.ts`, `gradient.ts`, `motion.ts`, `haptics.ts`, `layout.ts`, `z.ts`, `opacity.ts`;
  - `contrast-pairs.ts` (§8.4).
- **Build:** `scripts/build.ts` (run with `pnpm --filter design-tokens build`, executed via `tsx`) emits:
  - `generated/tokens.ts`: typed `as const` objects plus a `Theme` type used by `useTheme()`, and helpers `cssAngleToPoints()` and `shadow()`, which produces a platform style: the `boxShadow` string, or an `elevation` fallback on Android API < 28.
  - `generated/tokens.css`: `:root` custom properties (`--da-*`), a `[data-theme="dark"]` block, `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){…}}`, and `@theme inline` mapping to Tailwind names (`--color-bg`, `--color-surface`, `--color-ink`, `--color-ink-2`, `--color-ink-3` = tertiary-strong, `--color-primary`, `--color-primary-soft`, `--color-on-soft`, `--color-critical-*`, …, `--font-sans`, `--font-serif`, `--font-mono`, `--radius-*`, `--shadow-*`, `--ease-standard`, `--duration-*`).
  - `generated/tokens.json`: a flat map consumed by `scripts/gen-native-tokens.ts`, which writes `apps/mobile/targets/widget/Tokens.swift` and `apps/mobile/modules/da-widgets/android/.../Tokens.kt` (light/dark `ColorProvider` pairs).
- **Consumers:**
  - Mobile: `ThemeProvider` in `packages/ui` resolves System/Light/Dark and exposes `useTheme()` and `useMotion()` (reduce-motion aware).
  - Web and backoffice: import `tokens.css` in the root layout.

### 8.4 Contrast unit test (vitest)

- **Fixture:** `packages/design-tokens/src/contrast-pairs.ts` declares every allowed text/icon placement. Each entry has the form `{ id, scheme, fg, bg, over?, gradient?: {name, t}, kind: 'text'|'large'|'nontext', min }`. Alpha colours are composited over `over` (default `bg`); gradient backgrounds are sampled at `t`.
- **Test file:** `packages/design-tokens/test/contrast.test.ts` asserts:
  1. every pair reaches its `min` (4.5 / 3.0 / 3.0);
  2. every `text.*` key is tested against every surface it is allowed on (the usage matrix in `src/usage-matrix.ts`);
  3. `ink/tertiary` (the non-strong value) never appears in the text usage matrix;
  4. no dark surface token equals `#FFFFFF`;
  5. the §2.15 fixture ratios are reproduced within ±0.01, so a regression guards any token change.
- **Related tests:**
  - `packages/ui/test/dark-no-white.test.tsx` (jest-expo) renders every component in dark (§2.16).
  - `packages/ui/test/a11y-props.test.tsx` asserts that every interactive component exposes a role and a label, and a `hitSlop` or size of at least 44.

### 8.5 Lint rules (`packages/config/eslint`)

| Rule | Behaviour |
|---|---|
| `da/no-raw-color` | Forbids hex/rgb(a)/hsl literals in `apps/**` and `packages/ui/src/**`, except `generated/` |
| `da/no-dashed-border` | `borderStyle: 'dashed'` is allowed only in `SuggestedSurface`, `GapBlock` and the `TokenChip` add variant |
| `da/no-text-transform-uppercase` | Uppercase must go through the i18n helper |
| `da/no-hardcoded-strings` | User-facing JSX text must come from i18n (plan ADR-14) |
| Quality-gate grep | Bans every pattern of plan §23b R-17 in product code and copy: the English task-marker, filler and deferral tokens listed there, plus `yakında`, `çok yakında`, `sonraki sürüm`, `ileride eklenecek` (SREQ-92). "later"/"sonra" are not banned. "sınırsız"/"unlimited" are flagged only in positive claims; negated fair-use text is allow-listed in `quality-gate.allow` |

### 8.6 Fonts, brand, store, widget previews

- **Fonts:**
  - Mobile: `@expo-google-fonts/geist` (400/500/600/700) and `@expo-google-fonts/lora` (400/500/600/400 italic), loaded with the `expo-font` config plugin (embedded at build time, so there is no flash).
  - iOS widget: Geist 400/600 TTF copied into the extension, registered through the extension Info.plist `UIAppFonts`.
  - Web and backoffice: `next/font/google` for Geist, Lora and Geist_Mono with `subsets:['latin','latin-ext']` and `display:'swap'`.
- **App icon (direction):**
  - Base: 1024×1024, full-bleed `#5B5CE2`, centred white `star_shine` FILL glyph at 56% width, no text, no transparency (iOS).
  - iOS 18 dark variant: glyph `#A9AAF5` on a transparent/dark background. Tinted variant: monochrome glyph.
  - Android adaptive icon: background `#5B5CE2`; foreground glyph inside the 66 dp safe zone; monochrome layer = glyph (themed icons).
  - Android notification small icon: a white alpha-only glyph at 24 dp, with `expo-notifications` `color: '#5B5CE2'`.
  - Sources: `design/assets/brand/icon.svg`, rendered to PNG by `scripts/render-brand.ts` using Playwright.
- **Splash:** `expo-splash-screen` with `backgroundColor #F5F4F0`, dark `#141311`, and the brand tile image (indigo rounded square, radius 18/56, white glyph) at `imageWidth` 96. On first launch the JS layer cross-fades to the 2.1 dawn welcome; returning users go straight to Today (no timer, SREQ-58).
- **Provider logos:** **Manual external step.** Download the official brand assets from the Google Brand Resource Center, Microsoft Trademark & Brand Guidelines, Apple (Sign in with Apple button generated by the OS) and the App Store / Google Play badge kits. Store them in `design/assets/providers/` with the licence notes, and use them unmodified.
- **Illustrations:** there are no bitmap illustrations. The onboarding "illustrations" are live `packages/ui` components inside `IllustrationFrame` (P:02 rule "Tanıtım görselleri çizim değil, ürünün kendi UI parçalarıdır").
- **Store screenshots and ads:**
  1. Maestro flows capture screens in demo mode (`DEMO_MODE=true`, relative-dated canon seed) on the iPhone 6.9" simulator (1320×2868) and a 1080×2400 Android emulator.
  2. `design/marketing/compose.ts` (Playwright HTML templates reproducing the P:09 anatomy: text block left/right 110, top 180; kicker 40/600 +12%; headline 112–124; device 980×2000 at radius 130) outputs:
     - App Store 1320×2868 and 1290×2796;
     - Play 1080×1920 (a re-frame, because Play requires an aspect ratio ≤ 2:1);
     - Play feature graphic 1024×500;
     - 3 ads at 1080×1920;
     - TR and EN variants.
  3. The copy follows M§74 and the DEV-38 fixes.
  Store uploads are a **Manual external step**.
- **Widget previews:**
  - iOS gallery: `placeholder(in:)` and `getSnapshot` return canon sample content with fictional names (the PRIMARY names are fictional).
  - Android: `previewLayout` (API 31+) plus a `previewImage` PNG captured from the emulator in demo mode, via `scripts/widget-previews.sh` run in CI on an emulator job.
- **OG and favicons:** web OG images via Next `ImageResponse` (dawn gradient + headline). Favicons are generated from `icon.svg`. The backoffice favicon is the same glyph on `#1A1917`.

---

## 9. Demo fixture canon (for `seed/` and marketing assets)

- All timestamps are computed relative to the device's current time.
- Names are fictional (P:09 rule "kişisel isimler kurgusal").
- The canon is one dataset from which every surface is derived, which removes D-16 through D-20 and D-31/D-32.
- **User:** Yunus (tz `Europe/Istanbul`).
- **People:**
  - **Ahmet Yılmaz** (Kuzey Lojistik): urgent, needs the "revize teklif" by 17:00 today (ACİL).
  - **Mehmet Yılmaz** (Yılmaz Endüstri, VIP · Müşteri): meeting today 14:30, 60 dk; "Teklif v2" sent 3 days ago with no reply; asked about Ekim teslim yesterday 18:20; contract awaiting legal review.
  - **Selin Kaya:** waiting for the user's contract comment by tomorrow 12:00.
  - Also: Burak Tan, Deniz Erol, Elif Arslan.
- **Life items:** a Trendyol parcel today; flight TK2412 **in 3 days** (no clash with tomorrow's meetings); electricity bill "1.842 TL · son ödeme" 5 days out (amount only in the source mail); Netflix renewal in 4 days; a Karaköy reservation on Saturday.
- **Counting:** the hero N, the category counts and the digest counts are all computed from this dataset by the `packages/domain` counting rules.

---

## 10. Proposed additions to the canonical registry

| Addition | Type | Justification |
|---|---|---|
| `app/chat/[threadId]` (root stack; `threadId='new'` = unsaved thread; params `prompt`, `contactId`, `origin`) | Mobile route (accepted; screen spec owner SCREEN_MAP_3 M-ASST-02, A-01) | Conversation view with the tab bar hidden (P:06/6.2 "Sohbette alt sekme çubuğu gizlenir"), deep links to threads, and person-scoped threads opened from `person/[id]`, `voice` and `memory` without switching tabs |
| `app/mail/category/[category]` | Mobile route | Mail Intelligence drill-down for Önemli / Son Tarih İçeren / Bilgilendirme / Düşük Öncelik (P:04/4.3 rows need a destination; M§99) |
| `user_preferences` columns already canonical in DATABASE_AND_RLS_PLAN: `theme ('system'\|'light'\|'dark')` default `system`, `reduce_motion`, `haptics_enabled`, `dismissed_gates jsonb`, `interest_categories text[]`, `learn_from_interactions`, `ai_data_access jsonb`, `briefing_weekdays smallint[]` (this document's earlier name `briefing_days` is not used). **New column:** `text_scale text not null default 'system' check (text_scale in ('system','sm','lg','xl'))`, user-editable under RLS through a column grant | Columns | Appearance (7.8; SCREEN_MAP_4 M-SET-60/61 text-size sheet, multipliers 1.0 / 0.9 / 1.15 / 1.3), Pro gate suppression (7.6), personalization (2.8, 6.9), AI data access (7.3), briefing days (SREQ-61) |
| `connected_accounts.data_source_toggles jsonb` (already canonical in DATABASE_AND_RLS_PLAN; keys `mail_read`, `attachments_analyze`, `deadline_detect`, `draft_replies`, `calendar_read`, `schedule_suggest`, `calendar_write_with_approval`, `tasks_read`) | Column | Data Source Controls per account (SREQ-68), written only through `PATCH /integrations/:accountId/data-sources`; granted scopes stay in `capabilities_granted` |
| Enum `vip_relationship`: `spouse \| family \| manager \| key_client \| friend \| other`; column `vip_people.relationship` default `other` (already canonical in DATABASE_AND_RLS_PLAN) | Enum + column | 6.6 groups (EŞ · AİLE / YÖNETİCİ / MÜŞTERİ / ARKADAŞ); SREQ-37 |
| `approval_actions.rejection_reason` (`user_reject \| user_cancel`; already canonical in DATABASE_AND_RLS_PLAN) | Column | Distinguishes "Reddet" (learning signal, 6.8) from voice "İptal" (no learning, 6.4). Expiry is the status `expired` set by `private.expire_approvals()`, not a rejection reason |
| `approval_actions.approved_via` values `approval_center \| inline_sheet \| voice_card \| capture_batch \| in_place` (R-03), recorded together with the existing `origin` column (12 DB values) | Column values | Where the approval tap happened (audit and analytics); every value is a tap; supports the C-06/C-08 approved-in-place rules. No separate `approval_surface` column and no undo-timing column: the undo window is client-side (R-06) |
| `source_type` value `android_notification` (already canonical: the 16-value `source_type` enum in DATABASE_AND_RLS_PLAN §2) | Enum value | SREQ-03; Android NI structured signals as provenance |
| Reminder preset values `before_30m \| before_1h \| this_evening \| tomorrow_morning \| smart \| custom` (already canonical in API_CONTRACTS API-REM-01 `ResolveTimeBody` and the `reminder_create` payload) | Enum (validation) | SmartReminderSheet ↔ `POST /reminders/resolve-time` contract |
| `packages/design-tokens/generated/icons-web` export and `generated/tokens.json` | Package outputs | Web and backoffice icons from the same Material Symbols codegen; Swift and Kotlin widget tokens |
| Workspace package scope `@da/*` (`@da/config`, `@da/design-tokens`, `@da/ui`, `@da/domain`, `@da/validation`, `@da/api-client`, `@da/i18n`, `@da/mobile`, `@da/web`, `@da/backoffice`) | Naming (accepted in the registry) | Import specifiers used in this document |
| ESLint rules `da/no-raw-color`, `da/no-dashed-border`, `da/no-text-transform-uppercase` | Tooling | Enforce §2.5 and §2.7 rules |
| Analytics events (canonical catalogue names, R-20/R-21): `pro_gate_viewed{feature}`, `pro_gate_dismissed{feature}`; swipes as `flow_swipe{direction, action, card_type}` (Akış, SCREEN_MAP_2) and `priority_complete{kind, via}` / `priority_snoozed{preset}` / `priority_feedback{kind, feedback}` (Bugün, SCREEN_MAP_1); `why_important_opened{decision_tier, confidence_bucket}` (SCREEN_MAP_1); `theme_changed{mode}` (SCREEN_MAP_4); `widget_tapped{family}` | Analytics allow-list | Content-free UI events implied by the design surfaces (ADR-13). The earlier names `pro_gate_view`, `pro_gate_dismiss`, `swipe_action`, `why_sheet_open`, `theme_change` and `widget_open` are not used |
| Widget kinds: iOS `DANextWidget` (small), `DAPrioritiesWidget` (medium), `DABriefingWidget` (large), `DAAccessoryInline`, `DAAccessoryCircular`, `DAAccessoryRectangular`; Android `NextWidget` (2×2), `BriefingWidget` (4×2) | Native target names | Stable names for the `WidgetSnapshot` producers and deep links |
| System settings in `app_settings` (accepted in DATABASE_AND_RLS_PLAN): `followup.wait_thresholds_days = [3,7]`, `pro_gate.snooze_days = 7`. The non-critical push cap is the per-user column `notification_preferences.daily_cap` (default 5), not a config key. The referral cap is the `plan_limits` key `referral_rewards_per_year` (6) | Config | D-06, PRIMARY 7.6, P-02 / R-14, P-06 |

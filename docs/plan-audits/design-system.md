## Sources and scope

- **Main source:** `PRIMARY/01 Tasarim Sistemi.dc.html`. I read all of it: the template, the `COLORS`, `TYPE`, `ICONS`, `SPACE`, `RADIUS` and `DARK` arrays, and the helpers in `renderVals` (spinner, skeleton).
- **Cross-checked against** all other PRIMARY `*.dc.html` files (templates plus data scripts: `T`, `TD`, `TONES`, `FEED`, `LIFE`, `WAIT`, `COMMITS`, `APPR`, `MOTION`, `EMPTIES`, `ERRORS`), `ios-frame.jsx`, and the grep counts of hex, rgba, shadow, gradient, radius, gap and font usage across all 10 dc files.
- **Icon names:** every icon name was checked against Google's `MaterialSymbolsRounded[FILL,GRAD,opsz,wght].codepoints`. All 150+ names used exist in the font.
- **Files written:** one, `scratchpad/ms_rounded.codepoints`, a downloaded reference list. Nothing else was written.
- **Secondary archive tokens:** `src/index.css` uses Inter, cool neutrals (#0F0F1A, #F8F8FC), iOS system colours (#34C759, #FF3B30, #007AFF) and a purple "deadline" colour (#8B5CF6). All of this **conflicts with primary; primary wins**. In primary, deadline is amber.
- **Canvas background:** #ECEAE4 is the design-doc page background only. It is not a product token.

---

## Color tokens

### 1a. Declared tokens (`COLORS` array, names verbatim) with dark values

The **dark column** comes from these sources:
- **[D]** explicit in the `DARK` array.
- **[O]** observed on a dark artboard: 3.2 Bugün Dark, 3.3D Brifing Dark, 4.2 Akış Dark, 5.1D Plan Dark, 5.5 Prep Dark, 6.1/6.2 Asistan Dark, `TD` map in 04.
- **[P]** proposed by me. Not in the design; must be marked "derived" in DESIGN_AUDIT.md.

| Token (verbatim) | Light | Dark | Meaning / usage rule |
|---|---|---|---|
| `brand/primary` | #5B5CE2 | #8586F2 [D `primary`] | Primary button, AI marker (auto_awesome), selected tab (light), switch-on, focus ring, user chat bubble, selected radio/check, progress "played". "Dekor için asla" (never decorative). In dark it is the primary *button fill* only. |
| `brand/primary-pressed` | #4B4CCB | #9596F5 [P] (0F0F2A on it = 7.09:1) | Pressed primary. |
| `brand/soft` | #EDEDFC | rgba(133,134,242,.16) [O 3.2 "Dinle" tonal, 6.1 AI avatar] | Tonal button bg, ghost-button pressed bg, "hot" category tile, approval-type tile, VIP/PRO chip, AI avatar bubble. |
| (tonal pressed, not in COLORS) | #DCDCF8 | rgba(133,134,242,.24) [P] | Tonal button pressed. |
| `brand/text-on-soft` | #4547C9 | Tonal text #C3C4F8 [O 3.2]; ghost/link text #A9AAF5 [O] | Ghost buttons, links, card actions ("Yanıtla"), text on soft indigo, "Uygun zamanda" meta. |
| `brand/dark-glow` | #A9AAF5 | #A9AAF5 [D `primary-glow`] | AI marker on dark surfaces: toast icons, "Geri al" action, dark widget glyph. Light: dashed border of suggested blocks, "today" week bar. Dark: active tab, AI kickers, card actions, links. |
| `critical` | #E0553F | Icon use #F08B78 [P]; soft base rgba(224,85,63,…) | Icons, conflict line, input error ring, urgent dot, "busy" bar. |
| `critical/soft` | #FCEDE9 | rgba(224,85,63,.18) [O `TD`] | ACİL / GÜVENLİK / GECİKMİŞ badge bg, destructive icon tile (modal/sheet), security life tile, PDF file tile. |
| `critical/text` | #C7432F | #F08B78 [D `critical-text`] | Badge text, **destructive button fill** (light), destructive row text and icon, error helper, "6 gün" wait. |
| (destructive pressed, not in COLORS) | #A83726 | [P] #F4A393 | Pressed destructive. |
| `warning` | #E09A1C | Soft base rgba(217,139,11,…) [O `TD`; note: #D98B0B ≠ #E09A1C] | Icons (density, waiting), deadline dot in widget and group header. |
| `warning/soft` | #FDF2DC | rgba(217,139,11,.18) [O `TD`, 5.5 "18 dk" chip] | SON TARİH, BEKLİYOR, BUGÜN (commitment/waiting), 3–6-day wait badge, header context chip, reminder text highlight, deadline item tile. |
| `warning/text` | #9A6300 | #F0B85A [D `warning-text`] | Badge text, deadline date text ("15 Eylül"), calendar-intel `bolt` icon (05 uses the text colour for the icon). |
| `success` | #2FA062 | #6FCF97 [P, reuse `success-text`] | Done icon (check_circle FILL), swipe-right "Tamamlandı" bg, "detected" check. |
| `success/soft` | #E4F5EA | rgba(47,160,98,.18) [P] → #223528 over surface | ONAYLANDI, TAMAMLANDI, "+14 GÜN", "EN AVANTAJLI", reassurance box bg, success halo, "Bağlandı" pill, "Planlandı" button. |
| `success/text` | #1E7A47 | #6FCF97 [D `success-text`] | Badge text, `verified_user` reassurance icon. |
| (success deep, not in COLORS) | #1E5A36 | — | Reassurance-box body text (2.13), green avatar fg. |
| (success on gradient) | #A9F0C1 | same | Check icons on night gradient (2.10); `verified_user` on the ink privacy card (7.2). |
| `info` | #3B82E6 | [P] #8DB8F5 | Documented as "Ulaşım ikonu", **but only appears in the swatch**. 05 uses #2262BE for `directions_car`. Treat as unused or flag it. |
| `info/soft` | #E7F0FD | rgba(59,130,230,.18) [P] → #243040 | TAKVİM badge, event capture tile, date/time text highlight, Outlook/Microsoft integration tile. |
| `info/text` | #2262BE | #8DB8F5 [P] (6.56:1 on info-soft-dark) | Badge text, event icon, transport icon. |
| `neutral/bg` | #F5F4F0 | #141311 [D `bg`] | App background (warm). |
| `neutral/surface` | #FFFFFF | #1F1E1B [D `surface`] | Cards, sheets, inputs, surface buttons, icon-button circles. |
| `neutral/surface-2` | #F0EFEB | rgba(255,255,255,.08) [D `surface-2`] | Icon tiles, neutral badges, meta chips, neutral-tonal buttons ("Yarın Hatırlat", "Reddet", "İptal", "Şimdi değil"), surface-button pressed, disabled input. |
| `neutral/hairline` | #E9E7E1 (solid); stroke rgba(27,25,23,.06) | Stroke rgba(255,255,255,.06) (cards/rows); .08 (tab bar top, control rings); .07 (timeline) | Dividers. The solid form is the segmented track and the swipe secondary-action bg. |
| `ink` | #1A1917 | #F2F0EB [D `text`] | Primary text, ink CTA, dark "3 şey" card, privacy promises card, selected filter chip, toast bg, user avatar, "today" day chip. |
| `ink/secondary` | #6B6860 | #A39F96 [D `secondary`] | Secondary text, secondary ghost actions, row icons. |
| `ink/tertiary` | #9B978E | #7A776F [D `tertiary`] | Kickers, meta/source lines, timestamps, placeholders, inactive tab. **Fails AA, see §8.** |
| `ink/disabled` | #B8B4AA | #5E5B54 [O 3.2/3.3D/5.5 card check/more, chevrons] | Idle card action icons (check_circle/more_horiz), disabled text. |
| (quaternary, not in COLORS) | #C9C5BC | #5E5B54 [O] | Chevrons, unchecked radio, dashed sample borders. |
| `editorial/paper` | #FBFAF7 | [P] #141311 (no dark artboard) | Weekly summary and reading view (2-min summary). |
| on-primary | #FFFFFF | #0F0F2A [D `on-primary`] | Text/icon on the primary fill. The 05 note claims "kontrast 9:1"; the **actual ratio is 5.96:1**. |
| `gradient/dawn` | linear-gradient(160deg,#1E1E4C 0%,#3B3CA8 58%,#7071EA 100%) | identical ("Şafak gradyanı her iki modda aynı") | Morning brief header, brand moment, onboarding intro, first-analysis-ready, share card, referral hero, ad/store frames. |
| `gradient/night` | linear-gradient(180deg,#15153A 0%,#25266A 60%,#3B3CA8 100%) | identical | Voice, audio brief, analysis-in-progress. A 70% variant (#25266A 70%) is used for voice mode and audio in the prototype. |
| `gradient/dusk` | linear-gradient(160deg,#2A1E3F 0%,#4A3A8A 55%,#8C6BD6 100%) | identical | Evening close header (3.6). |

### 1b. Dark token array verbatim (`DARK`)

`bg #141311 · surface #1F1E1B · surface-2 rgba(255,255,255,.08) · text #F2F0EB · secondary #A39F96 · tertiary #7A776F · primary #8586F2 · primary-glow #A9AAF5 · critical-text #F08B78 · warning-text #F0B85A · success-text #6FCF97 · on-primary #0F0F2A`

Dark mappings observed on artboards but not declared:

| Element | Light | Dark |
|---|---|---|
| Card | Shadow | No shadow; `box-shadow:0 0 0 1px rgba(255,255,255,.06)` ("gölge yerine %6 beyaz hairline") |
| Tab bar | rgba(255,255,255,.92) + blur 20, top border rgba(27,25,23,.06); active #5B5CE2 | rgba(20,19,17,.92), border rgba(255,255,255,.08); active #A9AAF5, inactive #7A776F |
| Filter chip, unselected | #fff / #6B6860 | #1F1E1B / #A39F96 |
| Filter chip, selected | #1A1917 / #fff | **Inverted:** #F2F0EB bg / #141311 text |
| Segmented control | Track #E9E7E1; thumb #fff + shadow | Track rgba(255,255,255,.08); thumb #F2F0EB / #141311, no shadow; unselected #A39F96 |
| Today day chip | #1A1917 / #fff, dot #A9AAF5 | #F2F0EB / #141311, dot #5B5CE2 |
| Other day chips | #fff; past dots #E0DED7, future dot #5B5CE2 | #1F1E1B + ring .06; past dots #3A3936, future dot #8586F2 |
| Icon-button circle | #fff + shadow .08 | #1F1E1B + `0 0 0 1px rgba(255,255,255,.08)` |
| User avatar | #1A1917 / #fff | #F2F0EB / #141311 |
| Person avatar (blue pair, only one shown) | #DCE4F5 / #2B3F73 | Inverted: bg #2B3F73, fg #DCE4F5 |
| Primary CTA | Ink CTA #1A1917 | Replaced by #8586F2 / #0F0F2A, glow `0 8px 24px rgba(91,92,226,.25)` ("Ink CTA yerine dark primary") |
| Secondary CTA | Surface button | #1F1E1B / #F2F0EB + ring .08 |
| "3 şey" card | #1A1917 | linear-gradient(160deg,#2C2C7A 0%,#4A4BC8 100%), shadow `0 12px 32px rgba(91,92,226,.25)`, kicker #D6D6FB |
| AI insight card | Light radial | radial-gradient(140% 100% at 100% 0% or 0% 0%, rgba(133,134,242,.28) 0%, #1F1E1B 60%) |
| Hero count highlight | #5B5CE2 | #A9AAF5 |
| Plan AI block | #F7F7FE + `1px dashed #A9AAF5` | rgba(133,134,242,.12) + `1px dashed #8586F2`; icon/meta #A9AAF5 |
| Life block | #FDF6EC | rgba(240,184,90,.10) |
| Gap block | `1px dashed rgba(27,25,23,.15)` | `1px dashed rgba(255,255,255,.15)` |
| Chat composer | Light composer | #1F1E1B + `0 0 0 1px rgba(255,255,255,.08),0 8px 24px rgba(0,0,0,.35)`; placeholder #7A776F; mic 40 circle #8586F2 / #0F0F2A |
| Sticky CTA fade | linear-gradient(180deg,rgba(245,244,240,0) 0%,#F5F4F0 45%) | linear-gradient(180deg,rgba(20,19,17,0) 0%,#141311 45%) |
| Home indicator | rgba(27,25,23,.25) | rgba(255,255,255,.4) (the OS draws this in the real app) |

**Dark states the design never shows (need [P] decisions):**
- Sheet: surface #1F1E1B, grabber rgba(255,255,255,.16).
- Modal: #1F1E1B plus ring .08.
- Scrim: rgba(0,0,0,.5).
- Toast: an ink pill on #141311 is only 1.28:1 against the background. Use #2A2926 + ring .08, or invert to #F2F0EB/#141311.
- Switch-off track: rgba(255,255,255,.16).
- Text input: #1F1E1B + ring .08.
- Skeleton: rgba(255,255,255,.06)→.10.
- Editorial/paper.
- `info` and `success` soft tones.
- Pressed states.

### 1c. Tone maps used in code (use them as-is for the badge/tone API)

- 04 `T` / prototype `TONES`, as [bg, fg]:
  - critical ['#FCEDE9','#C7432F']
  - warning ['#FDF2DC','#9A6300']
  - neutral ['#F0EFEB','#6B6860']
  - success ['#E4F5EA','#1E7A47']
  - info ['#E7F0FD','#2262BE']
  - primary ['#EDEDFC','#4547C9'] (prototype only)
- 04 `TD` (dark):
  - critical ['rgba(224,85,63,.18)','#F08B78']
  - warning ['rgba(217,139,11,.18)','#F0B85A']
  - neutral ['rgba(255,255,255,.08)','#A39F96']
  - Missing and must be added: success, info, primary.

### 1d. Category and status colour map (from data + notes)

| Domain | Rule |
|---|---|
| Badges on cards | Coloured only when they carry state. ACİL (critical), SON TARİH (warning), GÜVENLİK (critical), ONAYLANDI (success) per Kural 1. Screens also colour BEKLİYOR, BUGÜN (commitment/waiting group) and 3–6 d waits amber; GECİKMİŞ and ≥7 d waits coral; TAMAMLANDI and "+14 GÜN" green; TAKVİM info; PRO primary. **Neutral:** TAKİP, TOPLANTI, KİŞİSEL, TAAHHÜT, KARGO, UÇUŞ, ÖDEME, ABONELİK, REZERVASYON, BUGÜN (feed), AÇIK, GÖNDERİLDİ, REDDEDİLDİ (the whole card also drops to opacity .45). |
| Mail source (feed tile) | Neutral tile #F0EFEB / #6B6860, glyph `mail`. |
| Calendar | TAKVİM badge info; event capture tile info; timeline event surface #fff + hairline; `groups` / `videocam` icons in #6B6860. |
| Follow-up | TAKİP badge neutral. Wait-duration badge: <3 d neutral, ≥3 d amber, ≥7 d coral ("Bekleme süresi rozeti 3 günden sonra amber, 7 günden sonra coral"). **Conflict:** data shows "6 gün" in coral. |
| Waiting groups (4.7) | Header dot + text: ACİL dot #E0553F / text #C7432F; BUGÜN #E09A1C / #9A6300; YAKINDA #B8B4AA / #6B6860. Cards stay neutral. |
| Commitments | AÇIK neutral · BUGÜN amber · GECİKMİŞ coral · TAMAMLANDI green. |
| Approvals | BEKLİYOR amber · ONAYLANDI green · REDDEDİLDİ neutral (op .45). |
| Personal / life types | KARGO `package_2`, UÇUŞ `flight`, REZERVASYON `restaurant`, ÖDEME `receipt_long`, ABONELİK `autorenew`: tile neutral. GÜVENLİK `shield`: tile critical ("nötr, güvenlik hariç"). Plan life surface #FDF6EC ("sıcak krem"). |
| Calendar-intel icon colour | "amber yoğunluk (`bolt` #9A6300), mavi ulaşım (`directions_car` #2262BE), indigo fırsat (`self_improvement` #5B5CE2), coral çakışma (`error` #C7432F)". |
| Capture item tiles | Son tarih amber, etkinlik info, görev neutral. Text highlights: time = info soft/text, person = brand soft/#4547C9, task = neutral, reminder = warning soft/text (radius 5, pad 1×4). |
| Mail intel categories | "hot" (Önemli, Senden cevap bekleyen): tile #EDEDFC / #4547C9, count #5B5CE2. Others neutral. Distribution band: attention #5B5CE2 / info #C9C7F3 / low #E9E7E1 (8h, r4, gap 2). |
| Week density bars | Meeting #D9D6F7 · focus #EDEDFC · busy #F3B7AE + #E0553F · today #5B5CE2 + #A9AAF5. Day label: today #5B5CE2, hot #C7432F, else #6B6860. |
| Widget priority dots | Urgent #E0553F, meeting #9B978E, deadline #E09A1C. These carry colour-only meaning, so they need an a11y label. |
| Integrations (2.6, 7.2) | Gmail tile #FCEDE9 / #C7432F, Outlook and MS #E7F0FD / #2262BE, Google Takvim #E4F5EA / #1E7A47, Apple #F0EFEB. **This uses semantic colours as brand stand-ins and breaks "renk yalnızca anlam taşır".** The note says to replace them with real provider logos. |

### 1e. Avatar palette (not declared; used consistently)

| Pair | bg / fg | Contrast | Seen on |
|---|---|---|---|
| peach | #F5E1D6 / #7A3E1F | 6.55 | AY, DE, ZE |
| blue | #DCE4F5 / #2B3F73 | 7.98 | MY, CT, BT |
| green | #E3EFE6 / #1E5A36 | 6.91 | SK, HK, BT |
| neutral | #F0EFEB / #6B6860 | 4.84 | EA, GP, AN |
| user | #1A1917 / #fff | — | Single initial |

Assign the pair by a deterministic hash of the contact ID. Dark: invert (bg = fg-dark, fg = bg-light).

### 1f. Borders, dividers, overlays, scrims

- **Dividers:**
  - `1px solid rgba(27,25,23,.06)` between rows, never above the first row.
  - `.07` on timeline row tops and catalogue lines.
  - `.08` on table header bottoms and weekly rows.
  - `.12` on the weekly top rule.
  - Dark: `rgba(255,255,255,.06)`; `.10` on gradients.
- **Swatch outline:** 1px rgba(27,25,23,.06) (doc only).
- **Control ring (paywall unselected plan):** `2px solid rgba(27,25,23,.1)`; radio border rgba(27,25,23,.2).
- **Scrim:** `rgba(27,25,23,.35)` for sheets and modals ("Arka plan %35 ink"). Dim animates 0 → .35.
- **Glass:** tab bar `rgba(255,255,255,.92)` (the prototype uses .9) + `backdrop-filter: blur(20px)`. Onboarding floating cards rgba(255,255,255,.7) + blur(20px).
- **On-gradient fills:**
  - rgba(255,255,255,.08) / .1 (answer bubble, list container)
  - .12 (prompt chips)
  - .14 (close/speed pills, lock widget)
  - .16 (icon circles, numbered dots)
  - .18 (lock widgets, progress track)
  - .25 (referral add-avatar)
  - .35 (unplayed wave, voice pulse)
- **On-gradient text:** rgba(255,255,255,.6 / .7 / .72 / .75 / .78 / .8 / .85).
- **Skeleton:** base #EFEDE7, highlight #F7F6F2.
- **Sheet grabber:** #E0DED7, 36×5 r3.
- **Pressed card fill:** #F7F6F2.
- **Selected ring:** `0 0 0 2px #5B5CE2`.

### 1g. Dashed "proposed / not yet real" convention

The rule: "kesik çerçeve yalnızca 'önerilen / henüz gerçek değil' anlamına gelir".

- **Pattern:** `background:#F7F7FE; border:1px dashed #A9AAF5; color:#4547C9`, with an `auto_awesome` 18 glyph and the label "Önerilen · henüz gerçek değil".
- **Where it appears:**
  - AI task block in Plan (meta "Önerilen · 45 dk · AI görev bloğu").
  - After acceptance it becomes `#EDEDFC` + `1px solid #5B5CE2`: solid means real.
  - Gap blocks use neutral dashed `rgba(27,25,23,.15)` to mean "empty time".
- **Dark:** rgba(133,134,242,.12) + `1px dashed #8586F2`.
- **Enforce in code:** a dashed border is allowed only on `SuggestedSurface` and `GapBlock`. Lint against other uses.

### 1h. Other one-off colours (keep as named constants)

| Value | Use |
|---|---|
| #C9C9FF | Count highlight on dawn gradient (2.11) |
| #D6D6FB | Kicker on indigo card (dark) |
| #C3C4F8 | Dark tonal text |
| #FDF6EC | Life surface |
| #F3B7AE | Busy bar |
| #3A3936 | Dark past-day dot; marketing device bezel |
| #2C2C7A / #4A4BC8 | Dark "3 şey" gradient |
| #F25022 / #7FBA00 / #00A4EF / #FFB900 | Microsoft logo placeholder. Replace with the official asset. |

---

## Typography

### Families

- **Load string:** `Geist:wght@300..700`, `Lora:ital,wght@0,400..600;1,400..600`, `Material Symbols Rounded:opsz,wght,FILL,GRAD@20..48,300..600,0..1,0`.
- **Body stack:** `Geist,-apple-system,"SF Pro Text",system-ui,sans-serif`, with `-webkit-font-smoothing:antialiased`.
- **Rules, verbatim:**
  - "iOS'ta gövde metinleri için sistem fontuna (SF Pro) düşülebilir; Geist yalnızca başlıklarda korunur."
  - "Lora sadece brifing anlatısı, haftalık özet ve taahhüt alıntılarında."
  - "Sayılar için tabular-nums (saat, tutar)."
  - Prototype note: "Gövde min. 15px, dokunma alanı min. 44px."
  - 4.14 note: text input "odaklanınca büyür (17px, Lora değil, gövde fontu)".
- **Lora drift:** Lora is also used in the 5.6 reading view ("2 Dakikalık Özet": "Okuma görünümü brifingle aynı editoryal sesi kullanır"), the 2.3 onboarding brief teaser (15/24), the 3.8 share card, the weekly numbers, and marketing. Extend the rule to "brifing anlatısı, okuma görünümü, haftalık özet/paylaşım, taahhüt alıntıları, pazarlama".
- **tabular-nums:** declared but applied nowhere in the screens. Apply it in code to times, durations, amounts and counters: RN `fontVariant:['tabular-nums']`, web `font-variant-numeric: tabular-nums`.
- **Weights in use:** Geist 400/500/600/700; 700 only for 11px badges and type labels. Lora 400, 500, 600 (bold emphasis `<b style="font-weight:600">`) and italic 400. Geist 300 is loaded but unused.
- **Turkish:** load the `latin-ext` subset (ğ, ş, ı, İ are Latin Extended-A) for Geist and Lora on web (`next/font/google` `subsets:['latin','latin-ext']`).
- **Uppercase:** the design writes uppercase literally ("ÖNCELİKLERİN", "5 EYLÜL CUMARTESİ"; token sample 'Öncelİklerİn'). In RN, `textTransform:'uppercase'` is not reliably Turkish-aware, so uppercase in the i18n layer with `toLocaleUpperCase('tr-TR')`. On web, set `lang="tr"`.
- **Material Symbols Rounded axes:** section title "20/24 · wght 400 · FILL 0 (aktif: FILL 1)". The active tab in the prototype also uses `'FILL' 1,'wght' 500`; inactive uses `'FILL' 0,'wght' 400`. GRAD is fixed at 0.

### Declared scale (`TYPE`, verbatim) plus RN letterSpacing in points

| Token | Family | size / lh | weight | tracking | RN letterSpacing | Colour | Sample / use |
|---|---|---|---|---|---|---|---|
| `display` | Geist | 34/40 | 600 | −2.5% | −0.85 | ink | "Bugün bilmen gereken 5 şey var." (in-app, the hero actually uses 26/32) |
| `h1` | Geist | 28/34 | 600 | −2% | −0.56 | ink | Root titles: "Günaydın, Yunus", "Akış", "Plan" (40 uses) |
| `h2` | Geist | 22/28 | 600 | −2% | −0.44 | ink | "Toplantıya Hazırlan", mail subject, destructive sheet title, gate title |
| `h3` | Geist | 17/23 | 600 | −1% | −0.17 | ink | Card titles (priority, life, approval) |
| `body` | Geist | 15/22 | 400 | 0 | 0 | ink | Paragraphs, sheet body |
| `secondary` | Geist | 14/20 | 400 | 0 | 0 | #6B6860 | Card sub / summary |
| `caption / kicker` | Geist | 12/16 | 600 | +8% caps | 0.96 | #9B978E | "5 EYLÜL CUMARTESİ", section headers |
| `micro / badge` | Geist | 11/14 | 700 | +5% | 0.55 | tone | Badges "ACİL" |
| `editorial` | Lora | 18/29 | 400 | 0 | 0 | ink | Brief narrative |
| `editorial-display` | Lora | 34–38/40 | 500 | −2% | −0.68…−0.76 | ink | "Haftan nasıl geçti?" (38/44 in 3.7) |

### Observed styles to add as tokens (all Geist unless noted)

| Proposed token | Spec | Where |
|---|---|---|
| `hero` | 26/32 600 −2% (−0.52) | Today brief hero, evening hero (dark), audio title, conflict title, success "3 öğe eklendi" |
| `title-xl` | 30/36 600 −2.5% (−0.75) | Onboarding step titles, paywall, account, Android step; 30/36 600 −2% on the evening close gradient |
| `title-gradient` | 32/38 600 −2% / −2.5% | "Günaydın Yunus" on dawn, "Son 72 saatte… 5 şey" |
| `title-lg` | 24/30 600 −2% | Person name (meeting prep) |
| `title-md` | 20/26 600 −2% | Detected entity title (capture) |
| `sheet-title` | 19 600 −1% (lh ≈24) | Sheet titles, empty-state titles |
| `h3-sm` | 16/22 600 −1% | Feed card title; 16/23 on the AI insight title |
| `emph` | 17/24 500 −1% | AI summary lead (mail detail) |
| `row-title` | 15/20 500 −1% | Grouped list rows; 15/21 500 in settings/sheet rows |
| `row-title-strong` | 15 600 −1% | Integration and approval sheet rows |
| `body-sm` | 15/21 400 | Mail card snippet, chat bubbles, follow-up status |
| `body-xs` | 13/19 400 | Error body, approval key/value, reassurance lines |
| `label-lg` | 15 600 | 52/48 buttons |
| `label` | 14 600 | Inline/ghost buttons, card actions, 40–44 buttons |
| `label-sm` | 13 600 | Filter chips, segmented, 38 buttons, empty CTA, card actions in life/person |
| `label-xs` | 12 600 | Meta chips, approval pill, header context chip |
| `meta` | 12/16 400 #9B978E | Source line, timestamps, row sub (629 uses of 12px) |
| `kicker-ai` | 12 600 +6% caps (0.72) #5B5CE2 | "BRİFİNG HAZIR · 07:58", "AI ÖZETİ", "TAKVİM ZEKÂSI" |
| `type-label` | 11 700 +6% (+8% on life cat) caps | Capture/approval row types, life category |
| `tab-label` | 11 500 | Tab bar |
| `numeric-xl` | 44/48 600 −3% | Mail intel "83" |
| `editorial-reading` | Lora 17/28 | 5.6 reading view |
| `editorial-quote` | Lora italic 16/24 ink | Commitment quote |
| `editorial-kicker` | Lora italic 15–16 #6B6860 | "Haftalık özet", "Mehmet Yılmaz · 14:30" |
| `editorial-number` | Lora 34/36 500 −2% | Weekly stats (the indigo one is #5B5CE2) |
| `mono` | ui-monospace 14/500 | Invite link |
| Widget / lock | 72/76 600 −4% | Lock-screen clock mock. Not a product token; the OS renders it. |
| Marketing (1290 canvas) | 112–124/120–130 600 −3%…−3.5%; ads 104/112, 82/92; quote Lora 112/124 | Store/ad frames only |

- **Dynamic Type:** fixed heights in the design (34/36/48/52) must become `minHeight`.
- **Font scaling:** allow scaling everywhere, with `maxFontSizeMultiplier ≈1.3` on `hero`/`title-*`/tab labels and no cap on body.
- **RN weight mapping:** with custom fonts, map weight to a family name (Android ignores `fontWeight` on single-file families):
  - `Geist_400Regular / _500Medium / _600SemiBold / _700Bold`
  - `Lora_400Regular / _500Medium / _600SemiBold / _400Regular_Italic`
  - Packages: `@expo-google-fonts/geist@0.4.2`, `@expo-google-fonts/lora@0.4.2`. Web: `next/font/google` or `geist@1.7.2`.
- **Font choice on iOS:** use Geist on iOS as well rather than falling back to SF Pro, for iOS/Android/web parity (principle 13). If the SF Pro fallback is chosen, keep it behind a token (`font.body.ios`).

---

## Spacing, radius, elevation

### Spacing

- **Declared (`SPACE`):** 4, 8, 12, 16, 20, 24, 32, 40 ("4'LÜK IZGARA").
- **Rule (verbatim):** "Ekran kenarı 20 · kart içi 16 · kartlar arası 12 · bölümler arası 18–22 · liste satırı min 50."
- **Observed usage** (gap counts): 8 (289), 12 (209), 10 (186), 4 (174), 6 (133), 14 (90), 3 (49), 16 (44), 28, 18, 5, 2, 24, 20, 22, 26. In practice this is a **2-px sub-grid**. Add 2, 6, 10, 14, 18, 22, 26, 28, 36, 44 to the token set.

| Layout constant | Value |
|---|---|
| Screen edge | 20 (onboarding 28; reading view and weekly 24; sheet side 20, destructive sheet 24) |
| Content top after status bar | 14 (root), 6 (sub-page) |
| Root section gap | 18 (Today), 16 (Plan/Asistan), 14 (sub-lists), 22 (brief sections), 26 (weekly) |
| Card padding | 16; compact 14 16 (priority/feed 14 16 10); hero 22 22 20; dark cards 20; error/person 14 16 |
| Grouped list container | Pad 4 16 or 0 16; rows 11 0 (min 50), 52 settings, 56 two-line, 60 two-line + trailing |
| Section header | Pad 0 4 8 (kicker) or 4 4 0 (with count) |
| Card action row | mt 6, pad 8 0, gap 14; ghost buttons use margin-left −10 to align labels |
| Buttons row | Gap 8–10 |
| Sticky bottom CTA container | Pad 16 20 44 (dark and light) with fade gradient; content bottom padding 120–130 |
| Tab bar | 90 tall incl. pad 8 8 28. Prototype content pad-bottom 112. Toast sits at bottom 104. |
| Horizontal chip rows | Overflow scroll, edge pad 20, gap 8 (memory search: gap 6) |

### Radius

- **Declared (`RADIUS`):** 10 çip ikon karosu · 12 satır içi buton · 14 buton · 16 küçük kart · 20 kart · 28 hero / sayfa.
- **Observed extras** (add as tokens):

| Radius | Where |
|---|---|
| 999 | 199 uses: pills, chips, segmented, badges, composer, search, toast |
| 50% | Avatars, icon buttons, mic |
| 18 | 69 uses: grouped list containers, person/waiting/error cards, source result cards, integration rows |
| 24 | Dark "3 şey" / privacy cards, system panels, modal, audio-prep cards |
| 22 | iOS widgets |
| 28 | Android widgets, sheet top `28px 28px 0 0` (system sample shows 24), hero brief card, gradient-header overlap sheet |
| 9 | 28-px icon tiles |
| 11 | 36-px icon tiles, error tile, brand mark 36 |
| 10 | 30-px tiles |
| 16 | Inputs, 52 CTAs, action tiles, plan option cards, reading source list |
| 14 | 48 buttons, 44 life tile, calendar time tile, day chip 42×60, timeline blocks, toast-less offline banner, info boxes |
| 12 | 40–42 buttons, 38 card buttons, 40 widget tile |
| 10 | Ghost 36 buttons |
| 5 | Text highlights |
| 3–4 | Progress, dots, grabber (r3), bars (r2) |

- **Device frames (not product):** iOS artboard 44, IOSDevice 48, Android 32.

### Elevation (every shadow found)

| Token | Value | Use |
|---|---|---|
| `shadow-1` (declared) | `0 1px 2px rgba(27,25,23,.06)` | Chips, search, pills, surface buttons in rows, source chips (66 uses) |
| `shadow-1-control` | `0 1px 2px rgba(27,25,23,.08)` | Icon-button circles, surface buttons, social buttons (70 uses) |
| `shadow-1-soft` | `0 1px 2px rgba(27,25,23,.04)` | Skeleton cards, suggestion rows, state cards (26 uses) |
| `shadow-2 · kart` (declared) | `0 1px 2px rgba(27,25,23,.04), 0 6px 20px rgba(27,25,23,.05)` | All cards (146 uses); an .06 variant appears on onboarding mini cards |
| `shadow-3 · sayfa` (declared) | `0 12px 32px rgba(27,25,23,.14)` | Page-level lift (1 use). Similar: `0 12px 32px rgba(27,25,23,.18)` on the ink "3 şey" card |
| `shadow-hero-ai` | `0 1px 2px rgba(27,25,23,.04), 0 12px 32px rgba(91,92,226,.10)` | Today brief hero |
| `shadow-cta-primary` | `0 8px 24px rgba(91,92,226,.28)` (dark `.25`) | 52 page CTA (primary) |
| `shadow-cta-ink` | `0 8px 24px rgba(27,25,23,.18)` | Ink CTA ("Brifingi Dinle") |
| `shadow-composer` | `0 1px 2px rgba(27,25,23,.06), 0 8px 24px rgba(27,25,23,.08)` | Chat composer; dark `0 0 0 1px rgba(255,255,255,.08),0 8px 24px rgba(0,0,0,.35)` |
| `shadow-segment-thumb` | `0 1px 3px rgba(27,25,23,.12)` | Segmented selected |
| `shadow-switch-knob` | `0 1px 3px rgba(0,0,0,.2)` | Switch knob (pure black; consider warm ink) |
| `shadow-toast` | `0 10px 30px rgba(27,25,23,.25)` | Toast |
| `shadow-modal` | `0 20px 50px rgba(27,25,23,.25)` | Alert modal |
| `shadow-sheet` | `0 -10px 40px rgba(27,25,23,.12)` | Bottom sheet |
| `shadow-widget` | `0 8px 24px rgba(27,25,23,.12)` (dark widget `.2`) | Widgets (mock) |
| `shadow-swipe` | `±8px 0 24px rgba(27,25,23,.1)` | Card while swiped |
| `shadow-play` | `0 10px 30px rgba(0,0,0,.25)` | 76 play button; 88 success circle `0 20px 50px rgba(0,0,0,.25)` |
| `shadow-float-onboarding` | `0 20px 50px rgba(27,25,23,.14)` (tilted cards), `0 8px 24px rgba(27,25,23,.08)` (glass cards) | Onboarding illustrations |
| Rings | `0 0 0 2px #5B5CE2` (focus/selected), `0 0 0 2px #E0553F` (error), `0 0 0 1px rgba(255,255,255,.06/.08)` (dark cards/controls) | |
| Device frames (doc only) | `0 0 0 1px rgba(27,25,23,.08),0 20px 50px rgba(27,25,23,.10)`; dark `…(.2)…(.2)`; IOSDevice `0 40px 80px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.12)` | Not product |

- **Dark rule:** no drop shadows; use hairline rings. Exceptions: the CTA indigo glow and the composer shadow.
- **RN:** RN 0.76+ supports the CSS `boxShadow` string, including multiple shadows, on the New Architecture (latest is RN 0.87.1 / Expo 57.0.24; verify against the pinned version). Otherwise fall back to `shadowColor/Offset/Opacity/Radius` on iOS and `elevation` on Android, which cannot reproduce two-layer warm shadows.

### Gradients

| Gradient | Value |
|---|---|
| dawn / night / dusk | See §1a |
| ai-glow-tl | `radial-gradient(140% 100% at 0% 0%, #E4E4FA 0%, #FFFFFF 60%)` (17 uses: insight cards) |
| ai-glow-tr | `radial-gradient(140% 100% at 100% 0%, #E4E4FA 0%, #FFFFFF 58%)` (hero; the widget uses 60%) |
| ai-glow dark | `radial-gradient(140% 100% at {0|100}% 0%, rgba(133,134,242,.28) 0%, #1F1E1B 60%)` |
| prep-card-dark | `linear-gradient(160deg,#2C2C7A 0%,#4A4BC8 100%)` |
| lockscreen-dawn | `linear-gradient(180deg,#1E1E4C 0%,#3B3CA8 70%,#7071EA 100%)` |
| fade-to-bg | `linear-gradient(180deg,rgba(245,244,240,0) 0%,#F5F4F0 45%)` (plus 40% / 30% variants); dark `rgba(20,19,17,0)→#141311 45%`; paper `rgba(251,250,247,0)→#FBFAF7 45%` |
| onboarding tint | `linear-gradient(180deg,#EDEDFC 0%,#F5F4F0 30–32%)` |
| skeleton | `linear-gradient(90deg,#EFEDE7 25%,#F7F6F2 50%,#EFEDE7 75%)`, size 200% 100% |
| image placeholder (prototype only) | `repeating-linear-gradient(135deg,#E9E7E1 0 10px,#F0EFEB 10px 20px)` |
| theme preview "Sistem" | `linear-gradient(100deg,#F5F4F0 50%,#141311 50%)` |

- **RN:** `expo-linear-gradient@57.0.2` for linear gradients. For radial gradients use `react-native-svg@15.15.5` `RadialGradient`, or RN `experimental_backgroundImage` if it is stable in the pinned version (verify).

---

## Iconography

- **Library:** Material Symbols Rounded.
- **Conventions:**
  - Default glyph 20 (buttons, settings) or 24 (system grid, selection).
  - wght 400, FILL 0.
  - FILL 1 for active/selected/AI marker: tab active, `auto_awesome` in kickers and logos, `check_circle` done/selected, `star` VIP, `play_arrow`/`pause`, `radio` selected.
  - 126 `FILL 1` usages.
- **Size frequency:** 20 (201), 17 (115; 28/30 tiles and status bar), 22 (97; card actions, life tile, checks), 18 (94), 16 (88; source line, AI kicker), 26 (47; tab bar, swipe), 15 (32; meta chips), 24, 30 (empty state, audio ±15), 14, 40 (play), 44/48/50 (success, ring), 36 (voice mic), 52/56 (marketing).
- **Icon colour defaults:** in tiles #6B6860; source line #9B978E; idle card actions #B8B4AA; chevrons #C9C5BC; AI #5B5CE2 (dark #A9AAF5); semantic icons per §1d.
- **RN implementation:**
  - RN core has no reliable `fontVariationSettings`, so the FILL/wght axes cannot be driven from a variable font.
  - Option 1: `@material-symbols/svg-400@0.47.5` (includes `rounded/<name>.svg` and `rounded/<name>-fill.svg`) with `react-native-svg`, plus a codegen'd subset of the ~150 names below.
  - Option 2: two static subset fonts (Rounded FILL0 wght400; Rounded FILL1 wght400/500).
  - `@expo-google-fonts/material-symbols-rounded@0.4.60` ships static weights (FILL axis unverified).
  - Web: the Google Fonts variable font with `font-variation-settings`.
  - iOS/Android widgets: export SVG/PDF assets.
  - Every icon-only control needs an `accessibilityLabel`.

**Every Material Symbol used in PRIMARY, grouped by concept.** "(sys)" means the name is in the system `ICONS` list with its label.

- **Navigation / tabs:**
  - `sunny` Bugün tab (sys)
  - `dynamic_feed` Akış tab (sys)
  - `calendar_today` Plan tab (sys)
  - `auto_awesome` Asistan tab + AI marker + brand mark + "Uygun zamanda" + suggested (sys "AI işareti")
  - `arrow_back` Geri (sys)
  - `close` dismiss (modal pages, voice, mini-player, clear search)
  - `chevron_right` İleri / row disclosure (sys)
  - `expand_more` / `expand_less` collapse "Orijinal Mail", audio minimise, dropdown
  - `more_horiz` Menü / correction sheet (sys)
  - `arrow_outward` suggested-question row
  - `arrow_upward` chat send
  - `arrow_forward` doc-catalogue link only
  - `arrow_downward` onboarding illustration and marketing
  - `open_in_new` "Orijinali Aç"
  - `ios_share` share (brief, referral)
- **AI, learning, trust:**
  - `psychology` Öğrenme / "Öğrendim" toast / AI personalization (sys)
  - `memory` Pro: AI hafıza
  - `verified` provenance line ("46 mail … analiz edildi", "Kaynak: …")
  - `verified_user` Güvence / reassurance (sys)
  - `trending_up` "daha sık göster"
  - `trending_down` learned low-priority rule
  - `remove_circle` "Önemli değil"
  - `visibility_off` "Takip etme" / "Böyle kalsın" / Pro "sessiz"
  - `visibility` "AI'ın eriştiği veriler"
  - `record_voice_over` tone preference
  - `target` meeting purpose
  - `lock` Pro-locked / security footnote
  - `block` "reklam amacıyla kullanılmaz"
  - `admin_panel_settings` enterprise policy line
  - `shield` Güvenlik (sys)
- **Priority / mail intel:**
  - `priority_high` Önemli
  - `low_priority` Düşük öncelik
  - `info` Bilgilendirme
  - `person` Kişi / senden cevap bekleyen (sys)
  - `schedule_send` Takip / senin cevap beklediğin (sys)
  - `flag` Son tarih (sys)
  - `handshake` Taahhüt (sys)
  - `task_alt` Onay / approvals pill (sys)
  - `star` VIP (sys)
  - `mark_email_read` empty follow-up
  - `done_all` empty today
  - `mail` Mail (sys)
  - `outgoing_mail` rule condition "Gönderici"
  - `alternate_email` domain rule
  - `match_word` keyword rule
  - `sell` topic / price / promotion
  - `tune` Öncelik Kuralları
- **Calendar / plan:**
  - `event` Etkinlik (sys)
  - `event_available` Planla / Randevular
  - `event_repeat` Taşı (sys)
  - `event_busy` calendar permission denied
  - `edit_calendar` Özel zaman
  - `calendar_month` calendar data / integration
  - `today` "Günün programını anlamak"
  - `groups` meeting
  - `videocam` online meeting
  - `self_improvement` boşluk / odak / fırsat
  - `bolt` yoğunluk
  - `directions_car` ulaşım
  - `medical_services` doctor
  - `schedule` time / snooze options / context chip "18 dk"
  - `wb_twilight` evening / brief times
  - `wb_sunny` "Yarın sabah"
  - `bedtime` evening close / "Yarına Hazırım"
  - `weekend` weekend brief
  - `alarm` "Alarm Kur"
  - `history` son görüşme / veri saklama / offline brief
- **Life intelligence:**
  - `package_2` Kargo (sys)
  - `local_shipping` kargo apps / delivery
  - `flight` Uçuş (sys)
  - `restaurant` Rezervasyon (sys)
  - `receipt_long` Ödeme (sys)
  - `autorenew` Abonelik (sys)
  - `confirmation_number` tickets
  - `account_balance` bank
  - `account_balance_wallet` Finans
  - `shopping_bag` Alışveriş
  - `work` İş
  - `family_restroom` Aile
  - `select_all` Hepsi
  - `chat` messaging apps
  - `forum` "cevap bekleyen konuşmalar"
- **Capture / files:**
  - `add_a_photo` Yakala / Ekle (sys)
  - `photo_camera` Fotoğraf
  - `screenshot` Ekran görüntüsü
  - `picture_as_pdf` PDF
  - `link` Link / Bağlantılar
  - `content_paste` panodan yapıştır
  - `folder_open` Dosyalar'dan seç
  - `article` link content type
  - `bookmark` "Hafızaya kaydet"
  - `description` document / PDF source
  - `attach_file` attachment
  - `add_task` Görev oluştur
  - `edit_note` Taslak / Yanıt Hazırla (sys)
  - `edit` edit
  - `short_text` Kısalt
  - `location_on` location
  - `call` call note
  - `contacts` contacts data
- **Reminders / notifications:**
  - `notifications` Hatırlatıcı (sys)
  - `notifications_active` "Her zaman bildir"
  - `notifications_off` sessize al
- **Voice / audio:**
  - `mic` Ses (sys)
  - `headphones` Dinle (sys)
  - `play_arrow`
  - `pause`
  - `replay` ±15 s; forward = mirrored `scaleX(-1)`. The set has `replay_5/10/30` and `forward_5/10/30`, **no 15**.
  - `graphic_eq` playing chapter / audio
  - `keyboard` switch to typing
  - `send` Mail gönder approval
- **Selection / status:**
  - `check` success toast / Bağlandı
  - `check_circle` Tamamla (sys)
  - `radio_button_unchecked` empty / open item
  - `add` add rule / person
  - `delete`
  - `delete_sweep` analiz geçmişini sil
  - `person_add` invite
  - `person_remove` hesabı sil
  - `content_copy` copy link
  - `download` export
  - `download_for_offline` offline audio
- **Errors / states:**
  - `error` Çakışma / error (sys)
  - `link_off` OAuth expired / disconnect
  - `wifi_off` offline
  - `cloud_off` AI unavailable
  - `sync_problem` sync delayed
  - `sync` pull-to-refresh
  - `hourglass_top` loading
  - `celebration` success
- **Settings / app:**
  - `workspace_premium` Pro / subscription
  - `all_inclusive` unlimited
  - `contrast` Görünüm
  - `language` Dil
  - `format_size` Metin boyutu
  - `animation` Hareketi azalt
  - `vibration` Haptik
  - `help` Yardım
  - `rate_review` Geri bildirim
  - `settings` / `logout` (prototype toasts only)
- **Motion-spec labels (08 table only):** `swipe`, `unfold_more`, `vertical_align_top`.
- **Do not ship:**
  - `signal_cellular_alt`, `wifi`, `battery_full` are the mock status bar.
  - `ios` is a stand-in for the Apple logo; use the official Sign in with Apple button.
- **Brand mark:**
  - `auto_awesome` FILL 1 white on a #5B5CE2 rounded square: 36/r11 (glyph 20), 56/r18 (glyph 30), widget 22/r7 (glyph 14).
  - Share card: 84/r26 white with an indigo glyph.

---

## Motion

- **Keyframes (verbatim):**
  - `@keyframes daspin{to{transform:rotate(360deg)}}`
  - `@keyframes dashimmer{from{background-position:200% 0}to{background-position:-200% 0}}`
  - `@keyframes dabar{from{transform:scaleY(.25)}to{transform:scaleY(1)}}`
  - `@keyframes dapulse{0%{transform:scale(.9);opacity:.6}100%{transform:scale(1.35);opacity:0}}`
- **Easing:** "Eğri: standart `cubic-bezier(.2,.8,.2,1)`, çıkış `ease-out`." Spinners and shimmer are linear.
- **Reduced motion:** "'Hareketi azalt' açıkken tüm süreler 0, yalnızca opaklık geçişi 120 ms kalır."
- **Cap:** "Hiçbir animasyon 600 ms'yi geçmez; kullanıcı beklerken animasyon değil bulgu gösterilir."
- **Spinner:**
  - 16 px (buttons) / 14 (kicker) / 22 (processing rows), border 2px.
  - Track = colour + `66` alpha (40%) or #D9D6F7 on light surfaces; top = colour.
  - `daspin .8s linear infinite`. Onboarding row .9s on rgba(255,255,255,.3)/#fff.
  - Analysis ring 132 px: outer `3px` rgba(255,255,255,.15) + top #fff 1.4s; inner inset 14 `2px` bottom rgba(255,255,255,.6) 2.2s reverse; centre `auto_awesome` 44 FILL.
- **Skeleton:**
  - `dashimmer 1.6s linear infinite` on `linear-gradient(90deg,#EFEDE7 25%,#F7F6F2 50%,#EFEDE7 75%)`, size 200%.
  - Bar radius = h/2 (or 8 for 22-px title bars).
  - "gerçek kart ölçülerinde"; "Başlık ve tarih anında; yalnızca AI içeriği iskelet. 1,6 sn parıltı, kartlar tek tek 60 ms arayla dolar."
- **Audio / voice:**
  - Wave bars `dabar {0.7–1.18}s {i×0.06}s ease-in-out infinite alternate`, paused when not playing.
  - Voice pulse `dapulse 1.6s ease-out infinite`.
  - Typing dots 7 px #9B978E `dabar .8s {i×0.15}s alternate`.
  - Audio progress `width .5s linear`.
  - "sessizlikte 1,2 sn sonra yanıt".

**Interaction contract (`MOTION` array, verbatim spec):**

| Interaction | Trigger / behaviour | Motion | Haptic |
|---|---|---|---|
| Brifing açılışı | Hero fades in from faint, count 0→N, cards enter in sequence | hero 240ms fade+8px · count 360ms · cards 60ms stagger, 280ms (frames: 0 ms faint → 240 ms counting → 520 ms cards) | none |
| AI işliyor | Button spinner; shimmer over the card; no progress bar | shimmer 1.6s linear ∞ · spinner .8s | none |
| Öncelik tamamlandı | Icon fills green, card shrinks and fades, list reflows, toast | icon 160ms · card 300ms scale .96 + fade · list 300ms. Prototype uses `scale(.96) translateY(-6px)`, opacity .3s, removal at 330 ms. | success |
| Kaydırma aksiyonları | Right: Tamamlandı; left: Ertele / Önemli değil. Threshold 35%; full swipe applies automatically | tracks 1:1 · release 260ms spring | light at threshold |
| Onay | Button → "Onaylandı", badge turns green, card moves to history | button 200ms · badge 160ms · card 320ms | success |
| Sesli oynatma | Bars animate, play → pause, chapter row highlighted | bars .7–1.2s alternate · icon 120ms | light |
| Yükleme | Skeleton at real card size | shimmer 1.6s · fill 60ms stagger | none |
| Senkron | Pull to refresh → thin indigo line at top; "Güncel · 09:41" for 1.5 s | line 400ms · message 1.5s | light |
| Haptik | success: tamamla/onayla/gönder · light: seçim, eşik · warning: çakışma, hata · "asla dekor için" | iOS UIFeedbackGenerator · Android HapticFeedbackConstants | — |
| Kart genişleme | "Orijinal Mail" and long summaries expand in place | height 280ms · chevron 200ms rotate | none |
| Alt sayfa | Slides up, 35% ink scrim; drag to close, velocity snap | open 300ms · close 240ms · dim 250ms | light on open |
| Başarı | Green ring + icon scale in, one-line summary, back button | ring 500ms · icon 450ms, 100ms delay (prototype: scale .4→1, `cubic-bezier(.2,.8,.2,1)`) | success |

**Other timings:**

| Element | Timing |
|---|---|
| Button / card press | scale .97 (button) / .98 (card), 120 ms |
| Filter chip / segment background | 150 ms |
| Tab colour | 150 ms |
| Plan button bg | 200 ms |
| Toast | Enters translateY 16px → 0 + opacity, 300 ms `cubic-bezier(.2,.8,.2,1)`; visible 2.6 s, then out 300 ms. Undo toasts 5 s. |
| Sheet | translateY 100% → 0, 300 ms cubic; scrim .25 s; close removes at 300 ms |
| Onboarding | Count-up (127 → counter), each processing row ✓ + light haptic; "yığın aşağı akıp 3 karta 'çöker'" |
| Ads | "AD 1 sayılar yukarıdan akarak 4'e çöker, AD 3 alıntı daktilo efektiyle" |

**RN mapping:**
- Reanimated `4.7.0`: `withTiming(v,{duration,easing:Easing.bezier(0.2,0.8,0.2,1)})`, `withSpring` for swipe release, `useReducedMotion()` combined with a user "Hareketi azalt" setting (7.8).
- Gesture Handler `3.3.0` for swipe and sheet drag.
- `expo-haptics@57.0.3`: `notificationAsync(Success|Warning)`, `impactAsync(Light)` / `selectionAsync()`, gated by the "Haptik geri bildirim" setting.
- Shimmer: animated `translateX` on an `expo-linear-gradient` inside an `overflow:hidden` bar.

---

## Components

Global accessibility notes apply to every component below:
- Hit targets must be ≥44 pt (iOS) / 48 dp (Android). Anything smaller needs `hitSlop` or `minHeight`.
- Fixed heights become `minHeight` for Dynamic Type.
- Every icon-only control gets `accessibilityRole` + `accessibilityLabel`.

### Buttons ("BUTONLAR · 5 VARYANT × DURUMLAR")

- **Heights (verbatim):** "52 (sayfa altı CTA), 48 (kart içi), 40–42 (satır içi), 36 (ghost)".
- **Radii:** 52→16, 48→14, 40–42→12, 36→10. Also 56/r16 action tiles (4.4), 44/r14 secondary text button under CTAs, 38/r12 card tonal actions (13/600), 36/r12 chat draft buttons.
- **Label size:** 15/600 at 52/48; 14/600 at 40–44; 13/600 at 36–38.
- **States (verbatim):** "Pressed: scale .97 + ton koyulaşır, 120 ms. Loading: metin '…' ile devam eder, spinner soldan; buton kilitlenir." Disabled = opacity .4.

| Variant | Default | Pressed | Loading label (sample) | Dark |
|---|---|---|---|---|
| primary | #5B5CE2 / #fff "Brifingimi Gör" | #4B4CCB | "Gönderiliyor…" (white spinner) | #8586F2 / #0F0F2A |
| tonal | #EDEDFC / #4547C9 "Düzenle" | #DCDCF8 | "Hazırlanıyor…" (#4547C9 spinner) | rgba(133,134,242,.16) / #C3C4F8 |
| dark (ink) | #1A1917 / #fff "Tamam" | #000 | "Bekle…" | Replace with primary |
| surface | #fff / #1A1917 + `0 1px 2px rgba(27,25,23,.08)` "Not Al" | #F0EFEB, no shadow | "Yükleniyor…" (ink spinner) | #1F1E1B / #F2F0EB + ring .08 |
| destructive | #C7432F / #fff "Geçmişi Sil" | #A83726 | "Siliniyor…" | [P] #F08B78 bg / #141311 text, or keep coral |

- **Neutral tonal** (used, not in the system page): #F0EFEB / #6B6860 ("Yarın Hatırlat", "Reddet", "İptal", "Vazgeç", "Şimdi değil").
- **Page CTA glows:** primary `0 8px 24px rgba(91,92,226,.28)`, ink `…rgba(27,25,23,.18)`.
- **Ghost / text:**
  - 36h, pad 0 10, r10, 14/600, #4547C9; pressed bg #EDEDFC.
  - Secondary ghost #6B6860, pressed bg #F0EFEB.
  - Disabled .4. In cards: gap 14, max 2 actions ("en fazla 2 aksiyon").
  - **36 h < 44**: add `hitSlop {top:4,bottom:4}`.
- **Icon buttons:**
  - Back/close/share: 36 circle #fff + control shadow, glyph 20.
    - On gradient: rgba(255,255,255,.16) (.14 on night).
    - Dark: #1F1E1B + ring.
    - **36 < 44**: hitSlop 4.
  - Mic 40 circle #5B5CE2; send 40 circle #1A1917 `arrow_upward`.
  - Card inline check/more: 36×36 transparent, glyph 22 #B8B4AA. Prototype hover: done → #2FA062 on #E4F5EA; more → #6B6860 on #F0EFEB.
  - Play 76; ±15: 52 box (glyph 30 + "15" 10/600, mt −6).
- **Social sign-in** (2.5): 52/r16 15/600.
  - Google = ink bg + white "G" circle placeholder; Apple = surface + `ios` glyph; Microsoft = surface + 4-square; Email = surface, text #4547C9 + `mail`.
  - "veya" divider: 12 #9B978E between 1px rgba(27,25,23,.1) lines.
  - Order: "iOS'ta Apple ilk, Android'de Google ilk". Replace all logos with official brand buttons.

### Chips and badges ("ÇİPLER · ROZETLER")

- **Rule (verbatim):** "Rozet: 11/700, +0.05em, pill, 3×8 dolgu. Filtre çipi: 34 yüksek, seçili = ink zemin. Meta çipi: 30 yüksek, ikon 15."
- **Filter chip:**
  - 34h, pad 0 14, pill, 13/600.
  - Unselected: bg contrasting with its container (#F5F4F0 on white; #fff on the app bg), text #6B6860.
  - Selected: #1A1917 / #fff (dark: inverted #F2F0EB / #141311). Disabled .4. bg transition 150 ms.
  - Filters: Tümü · Önemli · Mail · Takvim · Takip · Kişisel.
  - Memory-search variant: 30h, pad 0 10, 12px (Tümü · Mail · Takvim · Notlar · Belgeler · Son 30 gün).
  - **34 < 44**: hitSlop 5; role radio/tab.
- **Meta chip:**
  - 30h, pad 0 10, pill, 12/600, icon 15, gap 4, #F0EFEB / #6B6860 ("Yarın").
  - VIP variant #EDEDFC / #4547C9 + `star` FILL.
  - Warning context chip #FDF2DC / #9A6300 + `schedule` ("18 dk").
  - Editable extracted-field chips (capture: "12 Eylül", "20:00", "Zorlu PSM").
  - Source chips (KAYNAKLAR): 30h #fff, 12/500, icon 15 #6B6860, shadow-1.
  - Destination chips on success (icons tinted by type).
- **Badge:**
  - 11/700 +.05em, pill, pad 3×8. Mail-detail header: 4×9. Widget and onboarding: 10px, pad 2×6.
  - Tones from §1c. Text-only meaning (OK for colour-blindness because the text carries the meaning).
- **Header pills:**
  - Approval pill 34h, pad 0 12 0 9, #fff, #4547C9 12/600, `task_alt` 18, shadow-1: "2 onay". Shown only when pending writes exist.
  - "Ekle" 36h, pad 0 12 0 8.
  - "Yeni sohbet" 36h #fff #6B6860 12/600.
  - Speed pill on gradient 32h "1.0x".
- **Wait / deadline pills:** 26h, pad 0 9, 12/600 (follow-up days); deadline 11/700 pill ("17:00" critical, "Yarın" warning).
- **Type labels (no pill):** 11/700 +.06–.08em caps in tone text colour.

### Segmented control, switch, selection ("SEGMENTLİ KONTROL · ANAHTAR · ONAY")

- **Segmented:**
  - Track #E9E7E1, pill, pad 3. Segments 32h (30 in Plan header, 34 in retention), 13/600, flex.
  - Selected #fff / #1A1917 + `0 1px 3px rgba(27,25,23,.12)`; unselected #6B6860. bg 150 ms.
  - Uses: Gün/Hafta; tone Kısa/Profesyonel/Samimi/Detaylı; retention 30 gün/90 gün/1 yıl.
  - Dark: see §1b. **Height <44**: container ≥38 + hitSlop; role `tablist` / `radiogroup`.
- **Switch:**
  - 50×30, r15. On #5B5CE2 (knob right), off #D9D6D0 (knob left).
  - Knob 26 #fff r13 + `0 1px 3px rgba(0,0,0,.2)`, inset 2 (left 2 ↔ 22). Disabled .4 without knob shadow.
  - Always inside a ≥52 row; make the whole row the target.
  - **Off track #D9D6D0 on #fff = 1.45:1**, which fails WCAG 1.4.11 (3:1). Mitigate with a knob border or darker track (#969490 = 3.03:1), or use the platform `Switch` with tokens.
  - `accessibilityRole="switch"`.
- **Selection indicators:**
  - `check_circle` FILL #5B5CE2 = selected; `radio_button_unchecked` #C9C5BC = empty (**1.72:1**, fails 3:1); `check_circle` FILL #2FA062 = completed; 24 (22 in rows).
  - Paywall radio: 20 circle, 2px #5B5CE2, fill #5B5CE2 + `inset 0 0 0 3px #fff`; unselected border rgba(27,25,23,.2).
  - Plan card: `2px solid #5B5CE2` vs rgba(27,25,23,.1), r16, pad 14 16. "EN AVANTAJLI" success badge.
  - Onboarding interest grid: selected card #1A1917 / #fff, icon #A9AAF5 + white check; unselected #fff card shadow, icon #5B5CE2.

### Cards ("KARTLAR · 6 KALIP" plus the in-screen patterns)

- **Base:** #fff, r20, shadow-2, no border ("Kartlar gölgeli, çerçevesiz").
- **card/priority:**
  - Pad 14 16 10.
  - Header: badge + time (12 #9B978E); right: check_circle + more_horiz 22 #B8B4AA (36×36 buttons, mr −8).
  - Title h3 17/23 (mt 6); optional sub 14/20 #6B6860 (mt 4).
  - Source line (mt 10): icon 16 + "Gmail · Ahmet Yılmaz · 08:42" 12 #9B978E.
  - Actions (mt 6, pad 8 0, gap 14): 14/600 #4547C9, then #6B6860.
  - Rule: "rozet (yalnızca anlam), başlık, kaynak satırı, en fazla 2 aksiyon".
- **card/feed (Akış):**
  - Pad 14 16 10. Header: 28 r9 tile #F0EFEB / #6B6860 (glyph 17) + source 12 #9B978E ellipsis + badge + time.
  - Title 16/22/600 (mt 10); summary 14/20 (mt 4); one action 14/600 #4547C9.
  - Rule: "tek kart kalıbında (kaynak · rozet · başlık · AI özeti · aksiyon)"; raw mail text never appears in lists.
- **card/mail:** avatar 28 + name 13/600 + time; body 15/21; action "Yanıt Hazırla".
- **card/calendar:**
  - Pad 14 16, gap 14.
  - Time tile 48 r14 #F5F4F0 (hour 16 ink; minutes 11/600 #6B6860, lh 1.1).
  - Title 16/600; meta 13 #6B6860 "60 dk · Ofis · Son görüşme 4 gün önce".
  - Trailing tonal pill 34h "Hazırlan".
- **card/ai-insight:**
  - ai-glow-tl, r20, pad 16.
  - Kicker: `auto_awesome` FILL 16 + 12/600 +.06em #5B5CE2 "TAKVİM ZEKÂSI".
  - Title 16/23/600; body 14/20.
  - Actions (mt 12, gap 8): primary 40h r12 pad 0 16 "Planla" (+`event_available` 18) and ghost 40h "Başka zaman".
  - After accept: success-soft "✓ Planlandı".
- **Today hero:**
  - ai-glow-tr, r28, pad 22 22 20, shadow-hero-ai.
  - Kicker "BRİFİNG HAZIR · 07:58".
  - Hero 26/32: "Bugün bilmen gereken **5** şey var." (count #5B5CE2).
  - Context 14/20 "3 önemli mail · 4 etkinlik · 2 takip".
  - Buttons (mt 18, gap 10): primary flex 48 "Brifingimi Gör" + tonal 48 "▶ Dinle · 2 dk" (play_arrow FILL 20).
  - Evening dark variant: "AKŞAM KAPANIŞI HAZIR", "Bugünden yarına 3 konu kaldı.", "Kapanışı Gör".
  - Rule: "KPI kutusu yok"; "Sayı yalnızca hero'da renklidir".
- **card/life:**
  - Pad 16, gap 14. Tile 44 r14 (glyph 22).
  - Category 11/700 +.08em #9B978E + time 12.
  - Title 17/23; sub 14/20; actions 13/600, gap 14 ("Check-in" / "Cüzdana Ekle").
- **card/person:**
  - r18, pad 14 16. Avatar 40; name 15/600 + `star` FILL 15 #5B5CE2; "3 gün"; topic 13; body 14/20.
  - Footer: "3 gündür bekliyor" 12/600 #9A6300 + "Takip Et" 13/600 #4547C9.
- **Card states:**
  - `state/pressed`: bg #F7F6F2, scale .98, 120 ms.
  - `state/loading`: skeleton bars.
  - `state/error`: `error` 20 #C7432F + "Bu kart yüklenemedi. **Tekrar dene**" (#4547C9).
  - `state/selected`: ring `0 0 0 2px #5B5CE2` + check_circle FILL.
  - `state/suggested`: dashed (see §1g).
  - `state/done`: `check_circle` FILL #2FA062, text #6B6860 line-through.
- **Approval card (6.8):**
  - r20, pad 16.
  - Header: 28 r9 tile #EDEDFC / #4547C9 (glyph 17) + type 12/600 +.06em #6B6860 ("MAİL GÖNDER" / "ETKİNLİK TAŞI" / "HATIRLATICI OLUŞTUR") + time.
  - What 17/23/600.
  - Grid `64px 1fr` 13/19: "Neden" / "Değişim" (labels #9B978E).
  - Buttons (mt 14, gap 8): "Onayla" primary flex 42 r12 · "Düzenle" tonal · "Reddet" neutral tonal.
  - Footer: `verified_user` #1E7A47 "Önemli işlemler sen onaylamadan gerçekleştirilmez. Toplu onay yok; her kart tek tek."
  - Contract: "Ne yapılacak · Neden · Ne değişecek"; "Reddet bir öğrenme sinyalidir"; approved items kept 30 days.
  - Voice variant: kicker "ONAY GEREKİYOR · MAİL GÖNDER", Onayla / Düzenle / İptal, hint "“Onayla” diyerek de gönderebilirsin."
  - Capture batch approval sheet: rows with type label + check_circle, "Onayla · 3 / Düzenle / Vazgeç" 48h. Allowed only for user-initiated capture.
- **AI reply draft (4.5):**
  - Recipient chip 30h (avatar 22) + subject 12.
  - Tone segmented.
  - Draft card r20 pad 18: kicker "AI TASLAĞI · PROFESYONEL" + "Düzenlenebilir"; text 15/23 pre-wrap; caret 2×18 #5B5CE2; tool chips "Teklif_v3.pdf ekle", "Kısalt".
  - Reassurance: `verified_user` #1E7A47 "Sen onaylamadan hiçbir mail gönderilmez."
  - CTA 52 "Göndermeyi Onayla" + surface "Düzenle". Rule: never "Gönder".
- **Chat draft card:** r16, pad 12 14, 2-line clamp 14/20, buttons 36h.
- **Commitment card:**
  - Status badge + date.
  - Lora italic 16/24 “quote”.
  - Key/value 13 (label width 52 #9B978E: Taahhüt / Kime / Kaynak).
  - Buttons 38/r12: "✓ Tamamlandı" tonal · "Ertele" neutral · "Kaynağı Gör" ghost right.
- **Follow-up card:**
  - Avatar 40, name 16/600, topic 13, days pill; status 15/21; source line `schedule_send`.
  - Buttons 38/r12: "Takip Mesajı Hazırla" tonal · "Yarın Hatırlat" neutral · "Kapat" ghost.
- **Calendar-intel card:** r16, pad 14 16, bare 20 icon tinted by meaning, title 15/600, body 13/19, actions 13/600, max 2.
- **Timeline block (Plan):**
  - Row min 68; time column 44 right-aligned 12/500 #9B978E, pt 8; row top 1px rgba(27,25,23,.07).
  - Block r14, pad 10 14; title 15/600 with icon 16; meta 12. Surfaces per §1d/§1g.
  - "sol renk şeridi kullanılmaz".
  - Conflict: 2nd card ml 24 + 16×2 #E0553F line.
- **Day strip:** 42×60 r14; weekday 11/500 .8; number 17/600; 4 px dot.
- **Dark "3 şey" card:** see §1b. Numbered 26 circles rgba(255,255,255,.16) 13/600; item 17/600 + 14/20 rgba(255,255,255,.75).
- **Privacy promises card:** #1A1917 r24 pad 20, `verified_user` #A9F0C1 + 15/21 lines.
- **Memory answer / source result:**
  - Answer: ai-glow card, kicker "CEVAP", 16/23 with bold spans, footer "3 kaynaktan · %92 eşleşme".
  - Result: r18; tile 28 + source + date; title 15/500; quote 14/20; "Orijinali Aç" 13/600 + `open_in_new` 16.
- **Suggested-question row:** 52h r16 #fff 15/500, trailing `arrow_outward` 18 #B8B4AA, hover #EDEDFC.
- **Plain question pill:** pad 10 14, r14, #fff, shadow-1-soft.

### Lists, section headers, top bars, tab bar

- **Grouped list:**
  - Kicker 12/600 +8% #9B978E (pad 0 4 8); container #fff r18 shadow-2 pad 4 16.
  - Row: tile 30 r10 #F0EFEB / #6B6860 (glyph 17), or a bare icon 20 in a 24 box; title 15/20/500; sub 12 #9B978E mt 1; trailing chevron 18 #C9C5BC / value 13 #9B978E / switch.
  - Dividers per §1f. Destructive rows: text and icon #C7432F ("gizlenmez").
  - Settings groups: ASİSTAN / HESAP / UYGULAMA.
- **Section header:** "ÖNCELİKLERİN" + "5 konu" (both 12, tertiary; baseline), pad 4 4 0. Waiting groups add a 6 px coloured dot.
- **Root top bar:**
  - Date kicker "5 EYLÜL CUMARTESİ" + h1 greeting; right: approval pill + 40 ink avatar (initial 15/600) → Profile.
  - Tab roots: h1 title + trailing control.
  - Rule: "Kök ekranlar büyük başlık (28) + tarih kicker; alt sayfalar geri dairesi + ortalanmış kicker + sağda bağlam çipi."
  - Modal-style pages use `close`.
  - Gradient headers: kicker opacity .72, title 32/38, sub 16/22 rgba(255,255,255,.8); content sheet overlaps −28 with top radius 28.
- **Tab bar:**
  - 90h (system sample 84), pad 8 8 28; glass + top hairline (§1f).
  - 4 equal items: icon 26, label 11/500, gap 3. Active #5B5CE2 FILL 1 (wght 500); inactive #9B978E FILL 0.
  - Labels: Bugün `sunny` · Akış `dynamic_feed` · Plan `calendar_today` · Asistan `auto_awesome`.
  - "Sekme sayısı 4'te sabit". Hidden on pushed screens and inside a chat conversation. The mini-player docks above it.
  - Inactive #9B978E = 2.89:1 (fails). Use a custom tab bar (the design), not iOS 26 native Liquid Glass tabs; that would be a redesign (§124).
  - Use `expo-blur` for the backdrop and safe-area insets instead of the 28 px pad.

### Inputs ("GİRİŞLER · ARAMA · SOHBET")

- **Text field:**
  - 52h, pad 0 16, r16, #fff, shadow-1, 15px; placeholder #9B978E.
  - Focus: `0 0 0 2px #5B5CE2`, no shadow, caret #5B5CE2 2×18.
  - Error: `0 0 0 2px #E0553F` + helper (mt 6, pad 0 4) `error` 14 + 12px #C7432F "Geçerli bir e-posta adresi gir."
  - Disabled: #F0EFEB / #B8B4AA, no shadow.
  - Rule: "Odak: 2px indigo halka, gölge yok. Hata: coral halka + altta ikonlu mesaj."
- **Search:** 44h pill, pad 0 14, `search` 18 #9B978E, "Hafızada ara…", clear `close` 18.
- **Chat composer:**
  - 52h pill, pad 0 6 0 16, shadow-composer, "Dijital hayatına sor…" (person page: "Mehmet hakkında sor…").
  - Trailing 40 circle: mic #5B5CE2 when empty → `arrow_upward` on #1A1917 once typing ("Sohbet girişi yazı başladığında mikrofon → gönder (ink) olur").
  - Focus ring 2px. Sticky with fade.
- **Capture note:** min 52, pad 14 16, r16, "Bir not yaz veya yapıştır…", grows to 17px on focus. Mic = dictation, not voice mode. Clipboard chip "Panodan yapıştırıldı" + "Temizle"; the clipboard is never read without consent.
- **Invite link:** 52/r16, mono 14/500 + tonal "Kopyala" 40/r12 (`content_copy`).

### Sheets and modals ("ALT SAYFA · MODAL")

- **Rule (verbatim):** "Alt sayfa: seçim listeleri, düzeltme menüsü, hatırlatıcı. Modal yalnızca geri alınamaz işlemler için (bağlantı kaldırma, silme). Arka plan %35 ink."
- **Bottom sheet:**
  - #fff, top radius 28 (system sample 24), pad 10 20 44, shadow-sheet; grabber 36×5 #E0DED7 (mb 14–18).
  - Title 19/600 −1%; subtitle 13 #6B6860.
  - Option rows min 52 (60 two-line), top hairline, icon 20 in a 24 box, 15/500, meta 12 right.
  - AI row: `auto_awesome` #5B5CE2, meta #4547C9 600. Recommended row: bg #F7F7FE, r12, margin 0 −8, pad 0 8, trailing check_circle.
  - Motion per §5. Needs `accessibilityViewIsModal` and focus trap.
- **Reminder sheet** ("ürünün tek hatırlatıcı bileşeni", 6 fixed options): 30 dakika önce · 1 saat önce · Bu akşam 19:00 (`wb_twilight`) · Yarın sabah 08:00 (`wb_sunny`) · Özel zaman (`edit_calendar`) · Uygun zamanda (`auto_awesome`, "Takvimine göre: …" with the reason shown).
- **Correction sheet:** "Bunu nasıl değerlendireyim?" / "Seçimin gelecekteki öncelikleri etkiler". Options: Önemli değil (`remove_circle`) · Bunu daha sık göster (`trending_up`) · Bu kişiyi VIP yap (`star`) · Bunu takip etme (`visibility_off`) → toast "Öğrendim · …".
- **Conflict sheet:** "Nasıl çözelim?" / "Seçtiğin çözüm onayına sunulur, otomatik uygulanmaz." First option is the AI recommendation with a reason.
- **Alert modal:**
  - Centred, 250w, #fff, r24, pad 22, shadow-modal, text centred.
  - Icon tile 48 r16 #FCEDE9 / #C7432F (glyph 24); title 18/600; body 13/19 #6B6860.
  - Buttons: destructive 44/r14 "Kaldır" + ghost 40 "Vazgeç".
  - Example: "Gmail bağlantısı kaldırılsın mı?" / "Analizler durur; geçmiş özetler 30 gün saklanır."
- **Destructive sheet (7.4):**
  - Tile 52 r16; title 22/28; body 15/22.
  - Info box #F5F4F0 r14 "Silinen: … / Korunan: …".
  - Coral 52 "Geçmişi Sil" + 44 "Vazgeç".
  - **Inconsistent** with the "modal only" rule. Decide one pattern.

### Toast and offline banner ("TOAST · SES · İSKELET")

- **Toast:**
  - Ink pill, pad 12 18 12 14, 14/500 #fff; icon 18 (#A9AAF5 neutral/success; #F08B78 error/offline); optional action #A9AAF5 600 ml 6 ("Geri al"); shadow-toast.
  - Bottom 104 (above tab bar), 16 side inset, centred.
  - Rule: "Toast: ink pill, alttan 16px kayar, 2,6 sn; ikonu anlam taşır (indigo nötr, coral hata)."
  - Samples: "Hatırlatıcı kuruldu · Yarın 09:10", "Öğrendim · Ahmet Yılmaz artık VIP. Geri al", "Çevrimdışı · Son analiz 09:40". Undo toasts last 5 s.
  - Announce via `AccessibilityInfo.announceForAccessibility`.
- **Offline banner:** r14, pad 10 14, ink bg, 13px, `wifi_off` #F08B78, "Çevrimdışısın. Son analiz 09:40'tan gösteriliyor." + "Yenile" #A9AAF5. Content below at opacity .75.

### Audio

- **Mini player:**
  - #1E1E4C r16 pad 10 12; play/pause 40 #fff circle, glyph #25266A 24 FILL.
  - Title 13/600 "Sabah Brifingi · Öncelikler"; progress 3h, track rgba(255,255,255,.2), fill #fff; time 12 rgba(255,255,255,.7) "0:42 / 2:14"; close 20 .7.
  - Docks above the tab bar.
- **Full player (3.4):**
  - Night gradient; header `expand_more` + "SESLİ BRİFİNG" + speed pill; title 26/32; meta 14 .7.
  - Wave: 34 bars ×4 w, gap 5, h 72 (played #fff / rest .35).
  - Progress 4h; ±15 + 76 play; chapters (01 Genel bakış 0:18 … 06 Kişisel gelişmeler 0:22), 14/500 rows, inactive .55, playing row shows `graphic_eq`.
  - Speeds 1.0 → 1.25 → 1.5. Same chapter structure for lock screen and CarPlay.
- **Voice mode:**
  - 120 container, pulse ring, 80 white mic circle (glyph 36 #25266A).
  - 22-bar wave rgba(255,255,255,.85); transcript 22/30/600; answer bubble rgba(255,255,255,.1) r18; prompt chips 36h rgba(255,255,255,.12).
- **Inline recording (5.7):** 26 bars ×3 w, #5B5CE2 / #D9D6F7, "0:07 · dinleniyor".

### Confidence and provenance

- **No visual confidence meter exists.** Confidence is textual only: "3 kaynaktan · %92 eşleşme"; rule: "Eşleşme yüzdesi güveni gösterir; %70 altında 'emin değilim' dili kullanılır."
- **Provenance line** (mandatory under every AI inference): source-type icon 16 + "Kaynak · kişi · saat" 12 #9B978E.
  - Mail detail footer: `verified` "Kaynak: Gmail · mehmet.yilmaz@… · Gelen Kutusu · Konu dizisi 4 mail".
  - Brief footer: `verified` "46 mail, 1 takvim, 3 gün geçmiş analiz edildi · 07:58".
  - Capture items: "Kaynak: s.14, madde 9.2".
  - Rules: "3 kez 'önemli değil' dedin".
- **"Orijinal Mail" expander:** r18 card; 52h header (`mail` 20 #6B6860 + 15/600 + chevron 22 #9B978E); body 14/21 pre-wrap under a hairline. Collapsed by default.

### Empty / error / loading blocks (08)

- **Empty state:**
  - Centred; 60 circle tone bg + glyph 30; title 19/600; sub 14/20 #6B6860; CTA 38/r12 #fff #4547C9 13/600 shadow-1.
  - Variants (exact):

| Icon | Tone | Title | Body | CTA |
|---|---|---|---|---|
| `done_all` | success | "Her şey kontrol altında." | "Bugün dikkat gerektiren yeni bir konu yok. 46 maili senin için okudum." | "Akışa göz at" |
| `self_improvement` | brand | "Bugün takvimin oldukça sakin." | "Yarın 09:00 Haftalık ekip ile başlıyorsun. Bugünü odak için kullanabilirsin." | "Odak bloğu öner" |
| `mark_email_read` | success | "Bekleyen takip yok." | "Gönderdiğin her maile yanıt geldi. Yeni bir gecikme olursa buraya düşer." | "Tamam" |
| `task_alt` | neutral | "Onay bekleyen işlem yok." | "Bir mail göndermek veya takvimi değiştirmek istediğimde önce burada görürsün." | "Geçmişi gör" |

- **Error card:**
  - r18, pad 14 16; tile 36 r11 tone (glyph 20); title 15/600; body 13/19; actions 13/600 (primary #4547C9, secondary #6B6860).
  - Variants:

| Code | Icon | Tone | Title | Body | Actions |
|---|---|---|---|---|---|
| `error/oauth-expired` | `link_off` | critical | "Gmail bağlantısı yenilenmeli." | "Google oturumu süresi doldu. Yeniden bağlanana kadar yeni mailler analiz edilmez." | "Yeniden Bağlan" / "Sonra" |
| `error/permission-denied` | `event_busy` | warning | "Takvim izni verilmedi." | "Toplantı hazırlığı ve çakışma uyarıları takvim erişimi gerektirir. Diğer her şey çalışıyor." | "İzin Ver" / "Neden gerekli?" |
| `error/sync-delayed` | `sync_problem` | warning | "Senkronizasyon gecikti." | "Son başarılı analiz 09:40. Yeniden deniyoruz; gösterilenler 12 dakika eski olabilir." | "Şimdi Dene" / "Tamam" |
| `error/ai-unavailable` | `cloud_off` | neutral | "Asistan şu an yanıt veremiyor." | "Brifingin ve önceliklerin hazır; yalnızca yeni soru ve taslaklar birkaç dakika bekleyebilir." | "Tekrar Dene" / "Brifinge Dön" |

- **Loading (Today):**
  - Header instantly; hero card with kicker spinner "BRİFİNG HAZIRLANIYOR…".
  - Skeleton bars: 85%×22 r8, 55%×22 r8, 40%×12; button placeholders flex×48 r14 #EFEDE7 + 110×48 #F5F4F0.
  - Priority skeleton cards (r20, shadow-1-soft): 30%×18 r9, 92%×16, 50%×12.
- **Processing list** (onboarding, capture): done row = `check_circle` FILL (#A9F0C1 on gradient); current = 22 spinner; pending = 22 empty ring 2px, opacity .4. No progress bar. Cancel is always possible.

### Avatars

Circle sizes and initial sizes:

| Size | Initials | Where |
|---|---|---|
| 22 | 10px | Recipient chip |
| 28 | 11/600 | Cards |
| 32 | 11/600 | Chat, list |
| 36 | 12/600 | Invite rows |
| 40 | 13/600 | Person / follow-up |
| 40 | 15/600 | User avatar, ink |
| 44 | 15/600 | Mail detail |
| 56 | 20/600 | Meeting prep header |

Palette per §1e. Overlapping pair: 44 with 3px border in the gradient colour, ml −12.

### Widgets (08; real implementation must be native WidgetKit / Glance)

| Widget | Size | Radius | Content |
|---|---|---|---|
| iOS small | 158×158 | r22 | pad 14, shadow-widget |
| iOS medium | 338×158 | r22 | 3 priorities with 6 px dots |
| iOS large | 338×354 | r22 | Brief tile (ai-glow-tr r16) + next meeting + follow-up |
| iOS lock screen | circular 60; rectangular 158×60 r18 | — | rgba(255,255,255,.18); inline chip rgba(255,255,255,.14) |
| Android 4×2 | 340×170 | r28 | Header: brand mark 22/r7 + "Dijital Asistan" + play 32 tonal |
| Android 2×2 | 170×170 | r28 | Ink #1A1917, glyph #A9AAF5 |

Rules:
- "Widget'lar tek cevap verir … yazma işlemi widget'tan yapılmaz."
- "Android'de Material tema rengi yerine ürünün kendi yüzeyleri kullanılır; köşe yarıçapı sistemden gelir."

### Swipe actions

- **Right-swipe background:** #2FA062 with `check_circle` FILL 26 + "Tamamlandı" 11/600 white (white on #2FA062 = 3.32:1, fails for 11px text).
- **Left-swipe background:** #F0EFEB with two 84 px actions: "Ertele" (`schedule`) and "Önemli değil" (`remove_circle`, bg #E9E7E1), 24 px glyph, 11/600 #6B6860.
- The card slides over them with a ±8 px swipe shadow.
- Same directions in Akış, Bugün, Takip.
- Provide `accessibilityActions` equivalents (swipe is not discoverable by screen readers).

### Device frame / safe-area conventions (`ios-frame.jsx` and artboards)

- **`IOSDevice` (prototype only):**
  - 402×874, r48, bg #F2F2F7 / #000.
  - Dynamic island 126×37, r24, at top 11.
  - Status bar pad 21 24 19; time SF 17/590 (#000 / #fff), glyph row gap 7.
  - Home indicator 139×5, r100, bottom 8, in a 34 px zone; rgba(0,0,0,.25) / rgba(255,255,255,.7).
  - Prototype content pad 70 20 112.
  - `IOSNavBar`, `IOSGlassPill` (Liquid Glass: blur 12 saturate 180%, tint rgba(255,255,255,.5)), `IOSList` (r26, 52 rows, 17/−0.43) and `IOSKeyboard` are **unused by the product**. Do not adopt Liquid Glass nav; the product has its own back circle and tab bar.
- **Artboards:**
  - 390×844, r44; status bar 54 h (time 15/600; pad 0 30 8, or 0 10/0 2 inside padded frames).
  - Home indicator 134×5 r3, bottom 8.
  - Android: r32, status bar 46 (14/600, icons wifi, signal, battery), gesture bar 108×4 r2 rgba(27,25,23,.3).
- **Implementation:** never draw status bar or home indicator. Use `react-native-safe-area-context@5.10.0` insets: top = inset.top + 14 (root) / + 6 (sub); tab bar height = 62 + inset.bottom; sticky CTA pad-bottom = max(inset.bottom, 16) + 8.

---

## Design principles & rules stated in the file

**From 01 (verbatim):**
- "Token adları geliştirme için birebir kullanılabilir. Renk yalnızca anlam taşır; yüzeyler sıcak nötr, marka indigosu AI işaretleri ve birincil aksiyonda. Kartlar gölgeli, çerçevesiz; kesik çerçeve yalnızca “önerilen / henüz gerçek değil” anlamına gelir."
- "**Kural 1** · Kartlarda renkli rozet yalnızca ACİL (coral), SON TARİH (amber), GÜVENLİK (coral), ONAYLANDI (yeşil)."
- "**Kural 2** · Indigo: AI işaretleri (auto_awesome), birincil buton, seçili sekme, bağlantı. Dekor için asla."
- "**Kural 3** · Metin/zemin kontrastı ≥ 4.5:1; soft zeminlerdeki metinler koyu varyantı kullanır (critical-text vb.)."
- "iOS'ta gövde metinleri için sistem fontuna (SF Pro) düşülebilir; Geist yalnızca başlıklarda korunur. Lora sadece brifing anlatısı, haftalık özet ve taahhüt alıntılarında. Sayılar için tabular-nums (saat, tutar)."
- "Ekran kenarı 20 · kart içi 16 · kartlar arası 12 · bölümler arası 18–22 · liste satırı min 50."
- Section titles: "İKONLAR · MATERIAL SYMBOLS ROUNDED · 20/24 · wght 400 · FILL 0 (aktif: FILL 1)", "BOŞLUK · 4'LÜK IZGARA", "KARTLAR · 6 KALIP".
- "Yükseklikler: 52 (sayfa altı CTA), 48 (kart içi), 40–42 (satır içi), 36 (ghost). Pressed: scale .97 + ton koyulaşır, 120 ms. Loading: metin “…” ile devam eder, spinner soldan; buton kilitlenir."
- "Rozet: 11/700, +0.05em, pill, 3×8 dolgu. Filtre çipi: 34 yüksek, seçili = ink zemin. Meta çipi: 30 yüksek, ikon 15."
- "Odak: 2px indigo halka, gölge yok. Hata: coral halka + altta ikonlu mesaj. Sohbet girişi yazı başladığında mikrofon → gönder (ink) olur."
- "Sekme: aktif = dolu ikon + indigo, pasif = çizgi ikon + tertiary. Kök ekranlar büyük başlık (28) + tarih kicker; alt sayfalar geri dairesi + ortalanmış kicker + sağda bağlam çipi."
- "Toast: ink pill, alttan 16px kayar, 2,6 sn; ikonu anlam taşır (indigo nötr, coral hata). Mini oynatıcı sekme çubuğunun üstüne yapışır. İskelet: parıltı 1,6 sn, gerçek kart ölçülerinde."
- "Alt sayfa: seçim listeleri, düzeltme menüsü, hatırlatıcı. Modal yalnızca geri alınamaz işlemler için (bağlantı kaldırma, silme). Arka plan %35 ink."
- "Dark yüzeyler sıcak siyah; gölge yerine %6 beyaz hairline. Indigo aydınlatılır (#8586F2), birincil buton üzerinde koyu metin. Coral/amber aydınlatılmış metin varyantlarıyla (#F08B78, #F0B85A)."
- State labels: "Kart basılı · scale .98, 120 ms", "Önerilen · henüz gerçek değil".

**From the prototype index ("VARSAYIMLAR VE KARARLAR"):**
- "AI hiçbir yazma işlemini onaysız yapmaz… Onay Merkezi'nden geçer."
- "Her AI çıkarımının altında kaynak satırı vardır (Gmail · kişi · saat). Orijinal içerik her zaman bir dokunuş uzakta."
- "Renk yalnızca anlam taşır: coral = acil, amber = son tarih, yeşil = tamamlandı, mavi = bilgi. Marka indigosu sadece AI işaretleri ve birincil aksiyon için."
- "her kartın “···” menüsünde Önemli değil · Daha sık göster · VIP yap · Takip etme. Her düzeltme “Öğrendim” geri bildirimi verir."
- "Tipografi: Geist (SF Pro karakterinde; iOS'ta gövde SF Pro'ya düşer) + Lora yalnızca brifing anlatısı ve haftalık özet için. Gövde min. 15px, dokunma alanı min. 44px."
- "Light mode ana mod. Dark mode temsilî ekranlar 03 ve 05 sayfalarında."
- "Sekme sayısı 4'te sabit; yeni yetenekler yeni sekme değil, ilgili sekmenin içinde bir kart olarak açılır."

**Screen-level rules affecting the system (verbatim, abridged to the design-relevant ones):**
- 03:
  - "Hepsi aynı hero cümle kalıbını kullanır: “Bugün bilmen gereken N şey var.” Sayı yalnızca hero'da renklidir; kartlarda renk yalnızca aciliyet için."
  - "Hero tek cümle + insani bağlam satırı; KPI kutusu yok. Kartlar: rozet (yalnızca anlam), başlık, kaynak satırı, en fazla 2 aksiyon."
  - "Şafak gradyanı + Lora anlatı: günün tek “editoryal” anı. Altı bölüm sabit sırada; boş bölüm gizlenir."
  - "Analytics değil, editoryal: Lora sayılar, satır aralı liste, tek koyu vurgu kartı."
  - "Kişisel detay yok: isim, kişi, konu başlığı içermez." (share card)
- 04:
  - "Ham mail metni hiçbir listede görünmez…"
  - "Renkli rozet yalnızca ACİL, SON TARİH ve GÜVENLİK için; diğer rozetler nötr."
  - "Buton adı “Gönder” değil “Göndermeyi Onayla”: yazma işlemi dili her yerde onay dilidir."
  - "Bölüm başlıkları renkli nokta taşır, kartlar nötr kalır."
  - "Söz alıntısı Lora italik: kullanıcının kendi sesi."
  - "ikon karosu kategoriye göre hafif tonlanır (nötr, güvenlik hariç)"
  - "ilerleme çubuğu yok, bulgu listesi"
  - "anlam renkleri sistemdeki soft tonlar (zaman mavi, kişi indigo, görev nötr, hatırlatıcı amber)"
  - "5 sn “Geri al” toast'ı"
- 05:
  - "etkinlik, AI görev bloğu (kesik çerçeve) ve yaşam etkinliği (sıcak yüzey) üç ayrı yüzeyle ayrılır; sol renk şeridi kullanılmaz."
  - "koyu “3 şey” kartı her zaman ilk görünen öğedir."
  - "Boşluklar açıkça “2 saat boşluk” olarak etiketlenir; boşluk da bilgidir."
  - "Bugün günü ters çevrilir (#F2F0EB üzerine #141311), segment seçimi de aynı kuralı izler."
  - "yeşil onay “tespit edildi” demek, yazma işlemi yalnızca Kaydet ile."
- 06:
  - "Sohbet … hiçbir zaman boş açılmaz: bugünün analiz özeti + 5 önerilen soru. Yanıtlar düz metin değil, kaynaklı zengin kartlardır."
  - "Giriş çubuğu hap biçiminde; mikrofon birincil."
  - "Sohbette alt sekme çubuğu gizlenir."
  - "VIP yıldızı yalnızca bu listede ve kişi başlıklarında görünür; kartlarda ekstra renk üretmez"
  - "Toplu onay yok; her kart tek tek."
  - "Silme geri alınabilir (5 sn toast)."
- 07:
  - "Ayarlar iOS gruplu liste kalıbında ama ürünün kendi yüzeyleriyle."
  - "Paywall'da geri sayım, sahte indirim veya gizli “kapat” yok."
  - "Tehlikeli işlemler coral metin ama aynı listede; gizlenmez."
  - "coral birincil buton yalnızca burada; “Vazgeç” aynı boyutta ve hemen altında."
  - "Ücretsiz özellikler kilitlenmez." (locked features are visible with a lock icon, not hidden)
  - "“Hareketi azalt” tüm mikro-etkileşimleri geçişsiz duruma alır."
  - "Davet linki monospace."
- 08:
  - "Boş durum bir başarı mesajıdır… Hatalar okunur ve tek aksiyonludur; AI erişilemezse ürün brifingi yine gösterir (son analiz)."
  - Motion and haptic rules in §5.
- 02:
  - "Tanıtım görselleri çizim değil, ürünün kendi UI parçalarıdır."
  - "Şafak gradyanı = brifingin rengi; onboarding boyunca tek marka anı."
  - "Bağla (indigo tonal) / Bağlandı (yeşil, ✓)."
  - "değer görülmeden izin istenmez."
- 09: "ürün ekranı her zaman gerçek bileşen; kişisel isimler kurgusal."

**Inconsistencies to resolve in DESIGN_AUDIT.md:**

| Topic | Conflict |
|---|---|
| Tab bar | 84 vs 90 tall; glass .9 vs .92 |
| Sheet | Radius 24 vs 28; option row 44/14px vs 52/15px |
| Filter chip unselected | #F5F4F0 vs #fff (container-relative) |
| `info` token | #3B82E6 is unused; icons use #2262BE |
| Calendar-intel amber icon | Uses #9A6300 (text), not `warning` |
| Follow-up wait badge | "≥7 d coral" rule vs data "6 gün" coral |
| Kural 1 | Stricter than the actual lifecycle colours (BEKLİYOR, BUGÜN, GECİKMİŞ, TAMAMLANDI, TAKVİM, PRO) |
| Lora scope | Rule narrower than usage |
| Radius scale | Missing 18 and 24 |
| Spacing | 4-grid stated; 2-grid used |
| Destructive confirm | Modal vs sheet (7.4); "Vazgeç" 40 vs "aynı boyutta" |
| 7.12 | "geri alınamaz" modal followed by an undo toast |
| Dark contrast claim | "kontrast 9:1" is actually 5.96:1 |
| Tab-active weight | wght 500 only in the prototype |
| Switch knob shadow | Pure black, not warm ink |

---

## Proposed design-token package shape

```ts
// packages/design-tokens/src/index.ts  (source of truth → emits RN theme, CSS vars, JSON for WidgetKit/Glance)
export const palette = {
  warm: { 0:'#FFFFFF', 25:'#FBFAF7', 50:'#F7F6F2', 75:'#F5F4F0', 100:'#F0EFEB', 125:'#EFEDE7',
          200:'#E9E7E1', 250:'#E0DED7', 300:'#D9D6D0', 400:'#C9C5BC', 500:'#B8B4AA', 600:'#9B978E',
          650:'#7A776F', 700:'#6B6860', 750:'#5E5B54', 800:'#3A3936', 850:'#1F1E1B', 900:'#1A1917', 950:'#141311', 960:'#F2F0EB', 970:'#A39F96' },
  indigo:{ 25:'#F7F7FE', 50:'#EDEDFC', 75:'#E4E4FA', 100:'#DCDCF8', 150:'#D9D6F7', 200:'#C9C7F3', 250:'#C3C4F8', 300:'#A9AAF5',
           400:'#8586F2', 450:'#7071EA', 500:'#5B5CE2', 550:'#4B4CCB', 600:'#4547C9', 650:'#4A4BC8', 700:'#3B3CA8',
           800:'#2C2C7A', 850:'#25266A', 900:'#1E1E4C', 950:'#15153A', ink:'#0F0F2A', onGrad:'#C9C9FF', kickerOnIndigo:'#D6D6FB' },
  coral: { soft:'#FCEDE9', base:'#E0553F', text:'#C7432F', pressed:'#A83726', light:'#F08B78', busy:'#F3B7AE' },
  amber: { soft:'#FDF2DC', base:'#E09A1C', darkBase:'#D98B0B', text:'#9A6300', light:'#F0B85A', lifeSurface:'#FDF6EC' },
  green: { soft:'#E4F5EA', base:'#2FA062', text:'#1E7A47', deep:'#1E5A36', light:'#6FCF97', onGrad:'#A9F0C1' },
  blue:  { soft:'#E7F0FD', base:'#3B82E6', text:'#2262BE', light:'#8DB8F5' /* derived */ },
  avatar:{ peach:['#F5E1D6','#7A3E1F'], blue:['#DCE4F5','#2B3F73'], green:['#E3EFE6','#1E5A36'], neutral:['#F0EFEB','#6B6860'] },
} as const;

type Scheme = 'light'|'dark';
export const color = {
  light: {
    bg:'#F5F4F0', bgEditorial:'#FBFAF7', surface:'#FFFFFF', surfaceSunken:'#F0EFEB' /*neutral/surface-2*/,
    surfacePressed:'#F7F6F2', surfaceInverse:'#1A1917',
    text:{ primary:'#1A1917', secondary:'#6B6860', tertiary:'#9B978E' /*AA fail → see below*/, disabled:'#B8B4AA',
           quaternary:'#C9C5BC', inverse:'#FFFFFF', link:'#4547C9', onPrimary:'#FFFFFF' },
    brand:{ primary:'#5B5CE2', primaryPressed:'#4B4CCB', soft:'#EDEDFC', softPressed:'#DCDCF8', onSoft:'#4547C9',
            glow:'#A9AAF5', aiGlowStart:'#E4E4FA', suggestedBg:'#F7F7FE', suggestedBorder:'#A9AAF5' },
    tone:{ // [soft bg, text, icon/solid]
      critical:{ soft:'#FCEDE9', text:'#C7432F', solid:'#E0553F', pressed:'#A83726' },
      warning: { soft:'#FDF2DC', text:'#9A6300', solid:'#E09A1C' },
      success: { soft:'#E4F5EA', text:'#1E7A47', solid:'#2FA062' },
      info:    { soft:'#E7F0FD', text:'#2262BE', solid:'#3B82E6' },
      neutral: { soft:'#F0EFEB', text:'#6B6860', solid:'#9B978E' },
      primary: { soft:'#EDEDFC', text:'#4547C9', solid:'#5B5CE2' } },
    border:{ hairline:'rgba(27,25,23,0.06)', row:'rgba(27,25,23,0.07)', strong:'rgba(27,25,23,0.10)',
             control:'rgba(27,25,23,0.20)', gapDashed:'rgba(27,25,23,0.15)', segmentTrack:'#E9E7E1',
             focus:'#5B5CE2', error:'#E0553F' },
    overlay:{ scrim:'rgba(27,25,23,0.35)', tabBar:'rgba(255,255,255,0.92)', homeIndicator:'rgba(27,25,23,0.25)' },
    control:{ switchOn:'#5B5CE2', switchOff:'#D9D6D0', knob:'#FFFFFF', grabber:'#E0DED7',
              skeletonBase:'#EFEDE7', skeletonHighlight:'#F7F6F2', spinnerTrack:'#D9D6F7' },
    plan:{ event:'#FFFFFF', ai:'#F7F7FE', aiPlanned:'#EDEDFC', life:'#FDF6EC',
           weekMeeting:'#D9D6F7', weekFocus:'#EDEDFC', weekBusy:'#F3B7AE', mailBandInfo:'#C9C7F3' },
    toast:{ bg:'#1A1917', text:'#FFFFFF', icon:'#A9AAF5', iconError:'#F08B78', action:'#A9AAF5' },
  },
  dark: {
    bg:'#141311', bgEditorial:'#141311' /*P*/, surface:'#1F1E1B', surfaceSunken:'rgba(255,255,255,0.08)',
    surfacePressed:'#2A2926' /*P*/, surfaceInverse:'#F2F0EB',
    text:{ primary:'#F2F0EB', secondary:'#A39F96', tertiary:'#7A776F', disabled:'#5E5B54', quaternary:'#5E5B54',
           inverse:'#141311', link:'#A9AAF5', onPrimary:'#0F0F2A' },
    brand:{ primary:'#8586F2', primaryPressed:'#9596F5' /*P*/, soft:'rgba(133,134,242,0.16)', softPressed:'rgba(133,134,242,0.24)' /*P*/,
            onSoft:'#C3C4F8', glow:'#A9AAF5', aiGlowStart:'rgba(133,134,242,0.28)', suggestedBg:'rgba(133,134,242,0.12)', suggestedBorder:'#8586F2' },
    tone:{ critical:{ soft:'rgba(224,85,63,0.18)', text:'#F08B78', solid:'#F08B78' },
           warning: { soft:'rgba(217,139,11,0.18)', text:'#F0B85A', solid:'#F0B85A' },
           success: { soft:'rgba(47,160,98,0.18)' /*P*/, text:'#6FCF97', solid:'#6FCF97' },
           info:    { soft:'rgba(59,130,230,0.18)' /*P*/, text:'#8DB8F5' /*P*/, solid:'#8DB8F5' },
           neutral: { soft:'rgba(255,255,255,0.08)', text:'#A39F96', solid:'#7A776F' },
           primary: { soft:'rgba(133,134,242,0.16)', text:'#C3C4F8', solid:'#8586F2' } },
    border:{ hairline:'rgba(255,255,255,0.06)', row:'rgba(255,255,255,0.07)', strong:'rgba(255,255,255,0.08)',
             control:'rgba(255,255,255,0.08)', gapDashed:'rgba(255,255,255,0.15)', segmentTrack:'rgba(255,255,255,0.08)',
             focus:'#A9AAF5', error:'#F08B78' },
    overlay:{ scrim:'rgba(0,0,0,0.5)' /*P*/, tabBar:'rgba(20,19,17,0.92)', homeIndicator:'rgba(255,255,255,0.4)' },
    control:{ switchOn:'#8586F2', switchOff:'rgba(255,255,255,0.16)' /*P*/, knob:'#F2F0EB', grabber:'rgba(255,255,255,0.16)' /*P*/,
              skeletonBase:'rgba(255,255,255,0.06)' /*P*/, skeletonHighlight:'rgba(255,255,255,0.10)' /*P*/, spinnerTrack:'rgba(133,134,242,0.24)' },
    plan:{ event:'#1F1E1B', ai:'rgba(133,134,242,0.12)', aiPlanned:'rgba(133,134,242,0.20)' /*P*/, life:'rgba(240,184,90,0.10)',
           weekMeeting:'rgba(133,134,242,0.35)' /*P*/, weekFocus:'rgba(133,134,242,0.16)' /*P*/, weekBusy:'rgba(224,85,63,0.35)' /*P*/, mailBandInfo:'rgba(133,134,242,0.35)' /*P*/ },
    toast:{ bg:'#2A2926' /*P, + ring*/, text:'#F2F0EB', icon:'#A9AAF5', iconError:'#F08B78', action:'#A9AAF5' },
  },
} satisfies Record<Scheme, unknown>;

export const gradient = {
  dawn:{ angle:160, stops:[['#1E1E4C',0],['#3B3CA8',.58],['#7071EA',1]] },
  night:{ angle:180, stops:[['#15153A',0],['#25266A',.6],['#3B3CA8',1]] }, nightDeep:{ angle:180, stops:[['#15153A',0],['#25266A',.7],['#3B3CA8',1]] },
  dusk:{ angle:160, stops:[['#2A1E3F',0],['#4A3A8A',.55],['#8C6BD6',1]] },
  prepCardDark:{ angle:160, stops:[['#2C2C7A',0],['#4A4BC8',1]] },
  aiGlow:{ light:{ from:'#E4E4FA', to:'#FFFFFF', stop:.6 }, dark:{ from:'rgba(133,134,242,0.28)', to:'#1F1E1B', stop:.6 }, shape:'radial 140% 100%' },
} as const;

export const font = {
  sans:{ 400:'Geist_400Regular', 500:'Geist_500Medium', 600:'Geist_600SemiBold', 700:'Geist_700Bold' },
  serif:{ 400:'Lora_400Regular', 500:'Lora_500Medium', 600:'Lora_600SemiBold', italic400:'Lora_400Regular_Italic' },
  mono:'ui-monospace', icon:'MaterialSymbolsRounded',
} as const;
// size, lineHeight, weight, letterSpacing (pt = em × size), family, textTransform-by-i18n
export const typography = {
  display:[34,40,600,-0.85,'sans'], hero:[26,32,600,-0.52,'sans'], titleXl:[30,36,600,-0.75,'sans'],
  titleGradient:[32,38,600,-0.64,'sans'], h1:[28,34,600,-0.56,'sans'], titleLg:[24,30,600,-0.48,'sans'],
  h2:[22,28,600,-0.44,'sans'], titleMd:[20,26,600,-0.40,'sans'], sheetTitle:[19,24,600,-0.19,'sans'],
  h3:[17,23,600,-0.17,'sans'], h3Sm:[16,22,600,-0.16,'sans'], emph:[17,24,500,-0.17,'sans'],
  body:[15,22,400,0,'sans'], bodySm:[15,21,400,0,'sans'], rowTitle:[15,20,500,-0.15,'sans'],
  secondary:[14,20,400,0,'sans'], bodyXs:[13,19,400,0,'sans'],
  labelLg:[15,20,600,0,'sans'], label:[14,18,600,0,'sans'], labelSm:[13,16,600,0,'sans'], labelXs:[12,16,600,0,'sans'],
  kicker:[12,16,600,0.96,'sans'], kickerAi:[12,16,600,0.72,'sans'], meta:[12,16,400,0,'sans'],
  badge:[11,14,700,0.55,'sans'], typeLabel:[11,14,700,0.66,'sans'], tabLabel:[11,13,500,0,'sans'],
  numericXl:[44,48,600,-1.32,'sans'],
  editorial:[18,29,400,0,'serif'], editorialReading:[17,28,400,0,'serif'], editorialQuote:[16,24,400,0,'serif.italic'],
  editorialDisplay:[38,44,500,-0.76,'serif'], editorialNumber:[34,36,500,-0.68,'serif'], mono:[14,20,500,0,'mono'],
} as const;  // + numeric: fontVariant ['tabular-nums'] helper for time/amount/counters

export const space = { 0:0, 0.5:2, 1:4, 1.5:6, 2:8, 2.5:10, 3:12, 3.5:14, 4:16, 4.5:18, 5:20, 5.5:22, 6:24, 6.5:26, 7:28, 8:32, 9:36, 10:40, 11:44 } as const;
export const layout = { screenX:20, onboardingX:28, readingX:24, cardPad:16, cardPadCompact:[14,16,10], heroPad:[22,22,20],
  cardGap:12, sectionGap:{ sm:16, md:18, lg:22 }, rowMin:50, rowSettings:52, rowTwoLine:60, tabBarContent:62,
  topPadRoot:14, topPadSub:6, stickyCtaPad:[16,20,16] /* + safe-area bottom */, toastBottomOffset:104 } as const;
export const size = { buttonLg:52, button:48, buttonInline:40, buttonInlineApproval:42, buttonCard:38, ghost:36,
  iconButton:36, fab:40, chipFilter:34, chipMeta:30, segment:32, switchW:50, switchH:30, knob:26,
  input:52, search:44, composer:52, avatar:{ xs:22, sm:28, md:32, lg:40, xl:44, xxl:56 },
  tile:{ xs:28, sm:30, md:36, lg:44, xl:48 }, hitMin:{ ios:44, android:48 } } as const;
export const radius = { hairline:2, xs:3, text:5, tileXs:9, tile:10, tileMd:11, inline:12, button:14, buttonLg:16,
  input:16, cardSm:16, list:18, card:20, widgetIos:22, panel:24, hero:28, sheet:28, modal:24, pill:999 } as const;

export const shadow = { // CSS box-shadow strings (RN ≥0.76 new-arch `boxShadow`, web as-is); dark: rings instead
  light:{ s1:'0 1px 2px rgba(27,25,23,0.06)', s1Control:'0 1px 2px rgba(27,25,23,0.08)', s1Soft:'0 1px 2px rgba(27,25,23,0.04)',
    card:'0 1px 2px rgba(27,25,23,0.04), 0 6px 20px rgba(27,25,23,0.05)', page:'0 12px 32px rgba(27,25,23,0.14)',
    heroAi:'0 1px 2px rgba(27,25,23,0.04), 0 12px 32px rgba(91,92,226,0.10)', ctaPrimary:'0 8px 24px rgba(91,92,226,0.28)',
    ctaInk:'0 8px 24px rgba(27,25,23,0.18)', composer:'0 1px 2px rgba(27,25,23,0.06), 0 8px 24px rgba(27,25,23,0.08)',
    segmentThumb:'0 1px 3px rgba(27,25,23,0.12)', knob:'0 1px 3px rgba(0,0,0,0.2)', toast:'0 10px 30px rgba(27,25,23,0.25)',
    modal:'0 20px 50px rgba(27,25,23,0.25)', sheet:'0 -10px 40px rgba(27,25,23,0.12)', inkCard:'0 12px 32px rgba(27,25,23,0.18)',
    focus:'0 0 0 2px #5B5CE2', error:'0 0 0 2px #E0553F', selected:'0 0 0 2px #5B5CE2' },
  dark:{ card:'0 0 0 1px rgba(255,255,255,0.06)', control:'0 0 0 1px rgba(255,255,255,0.08)',
    ctaPrimary:'0 8px 24px rgba(91,92,226,0.25)', composer:'0 0 0 1px rgba(255,255,255,0.08), 0 8px 24px rgba(0,0,0,0.35)',
    indigoCard:'0 12px 32px rgba(91,92,226,0.25)', focus:'0 0 0 2px #A9AAF5', error:'0 0 0 2px #F08B78' },
} as const;

export const motion = {
  easing:{ standard:[0.2,0.8,0.2,1], exit:'ease-out', linear:'linear' },
  duration:{ press:120, reducedOpacity:120, chip:150, iconFill:160, badge:160, button:200, chevron:200,
    hero:240, sheetClose:240, dim:250, swipeRelease:260, cardEnter:280, expand:280, sheetOpen:300, toast:300,
    cardExit:300, listReflow:300, cardToHistory:320, countUp:360, sync:400, successIcon:450, successRing:500, max:600 },
  delay:{ stagger:60, successIcon:100 }, loop:{ shimmer:1600, spinner:800, pulse:1600, typing:800, bars:[700,1200] },
  hold:{ toast:2600, undoToast:5000, syncMessage:1500, voiceSilence:1200 },
  translate:{ heroY:8, toastY:16 }, scale:{ buttonPressed:0.97, cardPressed:0.98, cardComplete:0.96 },
  swipeThreshold:0.35,
  haptic:{ success:['complete','approve','send'], light:['select','threshold','play','sheetOpen','sync'], warning:['conflict','error'] },
} as const;
export const opacity = { disabled:0.4, rejected:0.45, inactiveChapter:0.55, offlineContent:0.75 } as const;
export const z = { tabBar:5, scrim:20, sheet:21, immersive:30, toast:40 } as const;
```

**Web output (Tailwind v4 CSS variables)** is generated from the object above into `packages/design-tokens/dist/tokens.css`:

```css
@import "tailwindcss";
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));
:root{ --da-bg:#F5F4F0; --da-surface:#FFFFFF; --da-surface-sunken:#F0EFEB; --da-text:#1A1917; --da-text-2:#6B6860; --da-text-3:#9B978E;
  --da-primary:#5B5CE2; --da-primary-soft:#EDEDFC; --da-on-soft:#4547C9; --da-glow:#A9AAF5; --da-hairline:rgba(27,25,23,.06);
  --da-critical-soft:#FCEDE9; --da-critical-text:#C7432F; /* …all semantic keys… */
  --da-shadow-card:0 1px 2px rgba(27,25,23,.04),0 6px 20px rgba(27,25,23,.05); }
[data-theme="dark"]{ --da-bg:#141311; --da-surface:#1F1E1B; --da-surface-sunken:rgba(255,255,255,.08); --da-text:#F2F0EB; --da-text-2:#A39F96;
  --da-text-3:#7A776F; --da-primary:#8586F2; --da-primary-soft:rgba(133,134,242,.16); --da-on-soft:#C3C4F8; --da-hairline:rgba(255,255,255,.06);
  --da-critical-soft:rgba(224,85,63,.18); --da-critical-text:#F08B78; --da-shadow-card:0 0 0 1px rgba(255,255,255,.06); }
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){ /* same as dark block */ } }
@theme inline{ --color-bg:var(--da-bg); --color-surface:var(--da-surface); --color-ink:var(--da-text); --color-ink-2:var(--da-text-2);
  --color-primary:var(--da-primary); --color-primary-soft:var(--da-primary-soft); /* … */
  --font-sans:var(--font-geist),-apple-system,system-ui,sans-serif; --font-serif:var(--font-lora),Georgia,serif;
  --radius-card:20px; --radius-hero:28px; --radius-list:18px; --shadow-card:var(--da-shadow-card);
  --ease-standard:cubic-bezier(.2,.8,.2,1); }
```

- **Consumers:**
  - Mobile: `ThemeProvider` (System / Açık / Koyu setting per 7.8, persisted) returns `color[scheme]`. Components read semantic keys only; lint bans raw hex outside `design-tokens`.
  - Widgets: JSON export for Swift/Kotlin.
  - Backoffice: reuse neutrals and brand. The design has no backoffice artboards, so a denser scale (13–14 body) is a proposal.
- **Aliases:** keep the design's slash names as aliases (`'brand/primary'`, `'critical/soft'`, `'ink/tertiary'`, …) for traceability.

**WCAG contrast (computed; AA normal text needs ≥4.5:1, large/bold ≥18.66px needs 3:1, non-text UI 1.4.11 needs 3:1):**

| Pair (fg / bg) | Light ratio | Status | Pair (dark) | Dark ratio | Status |
|---|---|---|---|---|---|
| ink #1A1917 / bg #F5F4F0 | 15.96 | ✓ | text #F2F0EB / #141311 | 16.30 | ✓ |
| ink / surface #FFF | 17.57 | ✓ | text / surface #1F1E1B | 14.64 | ✓ |
| ink / paper #FBFAF7 | 16.83 | ✓ | secondary #A39F96 / #141311 | 7.04 | ✓ |
| secondary #6B6860 / #FFF | 5.56 | ✓ | secondary / #1F1E1B | 6.32 | ✓ |
| secondary / #F5F4F0 | 5.06 | ✓ | secondary / neutral-soft (#31302D) | 5.00 | ✓ |
| secondary / #F0EFEB (neutral badge) | 4.84 | ✓ | **tertiary #7A776F / #141311** | **4.15** | ✗ |
| secondary / #E9E7E1 (segmented) | 4.50 | borderline | **tertiary / #1F1E1B** (meta, placeholder) | **3.73** | ✗ |
| **tertiary #9B978E / #FFF** | **2.91** | ✗ | **disabled #5E5B54 / #1F1E1B** | 2.46 | ✗ (exempt only if truly disabled; used for active icons) |
| **tertiary / #F5F4F0** (kickers, meta, timestamps, inactive tab 2.89) | **2.65** | ✗ | on-primary #0F0F2A / #8586F2 | 5.96 | ✓ (design claims 9:1) |
| **disabled #B8B4AA / #FFF** (idle card check/more icons) | 2.07 | ✗ (they are active controls) | #8586F2 text / #1F1E1B | 5.31 | ✓ |
| **quaternary #C9C5BC / #FFF** (chevron, empty radio) | 1.72 | ✗ non-text | glow #A9AAF5 / #1F1E1B | 7.74 | ✓ |
| #fff / primary #5B5CE2 | 5.15 | ✓ | #F08B78 / critical-soft-dark (#422821) | 5.57 | ✓ |
| primary as text / #FFF | 5.15 | ✓ | #F0B85A / warning-soft-dark (#372910) | 7.87 | ✓ |
| **primary / #E4E4FA** (AI kicker at glow peak) | 4.12 | ✗ (12px) | #6FCF97 / #1F1E1B | 8.77 | ✓ |
| **primary / #EDEDFC** | 4.45 | ✗ | #C3C4F8 / tonal-dark | 7.88 | ✓ |
| on-soft #4547C9 / #EDEDFC | 6.04 | ✓ | #A39F96 / AI glow peak #3C3B57 | 4.07 | ✗ |
| on-soft / #FFF | 7.01 | ✓ | #A9AAF5 / AI glow peak | 4.99 | ✓ |
| **critical-text #C7432F / #FCEDE9** (ACİL badge) | **4.31** | ✗ | #DCE4F5 / #2B3F73 (avatar) | 7.98 | ✓ |
| **critical-text / #F5F4F0** (error helper) | 4.47 | ✗ | #fff / #4A4BC8 | 6.71 | ✓ |
| #fff / critical-text (destructive button) | 4.92 | ✓ | rgba(255,255,255,.75) / #4A4BC8 | 4.54 | borderline |
| warning-text #9A6300 / #FDF2DC | 4.55 | borderline | dark toast #1A1917 vs bg #141311 | 1.28 | ✗ separation |
| success-text #1E7A47 / #E4F5EA | 4.72 | ✓ | hairline .06 vs bg | 1.15 | decorative |
| info-text #2262BE / #E7F0FD | 5.14 | ✓ | | | |
| avatars peach / blue / green | 6.55 / 7.98 / 6.91 | ✓ | | | |
| #fff / #1A1917 (toast) | 17.57 | ✓ | | | |
| #A9AAF5 / #1A1917 | 8.16 | ✓ | | | |
| #F08B78 / #1A1917 | 7.25 | ✓ | | | |
| **#fff / dawn end #7071EA** | 4.01 | ✗ for small text | | | |
| **rgba(255,255,255,.8) / #7071EA** | 3.17 | ✗ | | | |
| **#fff / #2FA062** (swipe label 11px) | 3.32 | ✗ | | | |
| **icons: warning #E09A1C / #FFF** | 2.38 | ✗ non-text | | | |
| **icons: critical #E0553F / #FFF** (error ring) | 3.79 | ✓ non-text | | | |
| **icons: success #2FA062 / #FFF** | 3.32 | ✓ non-text | | | |
| **icons: info #3B82E6 / #FFF** | 3.80 | ✓ non-text | | | |
| **switch-off #D9D6D0 / #FFF** | 1.45 | ✗ 1.4.11 | | | |

Recommended fixes (the smallest visual change, per §124 "NO REDESIGN"; log each in DESIGN_AUDIT.md):

| Issue | Fix |
|---|---|
| `ink/tertiary` text | #6F6C66 (4.76 on bg, 5.23 on white). Hierarchy then relies on size/weight; alternatively darken secondary to #5E5B54 (6.15). Keep #9B978E only for non-text decoration. |
| Dark tertiary | #87857D (4.51 on surface, 5.02 on bg) or #8E8A81. |
| `critical/text` | #C2412E (4.51 on soft, 4.67 on bg). |
| AI kicker on glow | Use `brand/text-on-soft` #4547C9 (5.6 on #E4E4FA) for kicker text; keep the #5B5CE2 icon. |
| Idle card icons (active controls) | #918D85 or darker (≥3:1). |
| Chevron / radio | #908D87 (3.31). |
| Switch-off track | #969490, or add a 1 px ring. |
| Warning icons | #C68819, or use `warning/text`. |
| Small text on dawn end | Keep small text on the #1E1E4C / #3B3CA8 region or ≥18.66px bold. |
| Swipe label | Use #1E7A47 as the swipe background (5.34 on white). |
| Dark toast | #2A2926 + ring .08 (text 12.77). |
| Dark AI-card secondary | #B5B1A8. |
| Colour-only widget dots | Add labels. |

---

## Appendix: prototype-only behaviour and copy to flag (never copy)

**Fake async:**
- `approveSend` uses `setTimeout(900)`; real sending must go approval → provider send → audit.
- `ask()` returns canned `QA` answers after a 1000 ms fake typing delay; voice prompts return canned answers after 900 ms.
- Audio playback is simulated with `setInterval`, and the waveform is deterministic, not from real audio.
- `startTrial` only shows a toast; there is no in-app purchase.
- "Kargo takibi açıldı…" is a toast only.

**Dead actions (toast placeholders):**
- `feedAct` default: `f.action+' · Kaynak açıldı'`.
- "Prototipte çıkış devre dışı" (logout).
- Settings rows → "… · Bkz. 07 Hesap".
- "Düzenleme Plan sekmesinde açılır".
- "Ekran görüntüsü, PDF veya link ekle · Bkz. 04 Akış".
- "Hafıza araması · Bkz. 06 Asistan".
- "Çözüm seçenekleri · Bkz. 05 Plan".
- "Özet okunuyor · 2 dk".

**Mock chrome:**
- Drawn status bars and home indicators.
- Striped image placeholders.
- Placeholder provider logos (the "G" circle, the `ios` glyph, the Microsoft squares).
- Semantic colours standing in for Gmail and Google brand colours.

**Copy claims that must match the real architecture (flag for privacy and legal review):**
- "Mail içerikleri cihazında özetlenir, hiçbir şey gönderilmez." (2.10)
- "Belge cihazında özetlenir; içerik saklanmaz"
- "Hassas alan tespiti cihazda yapılır"
- "Bildirim erişimi cihazda işlenir"
- "Veriler AB'de (Frankfurt) saklanır · KVKK ve GDPR uyumlu"
- "Mail içerikleri model eğitiminde kullanılmaz"
- "Orijinal mailler … biz kopya tutmayız"
- "Uçtan uca TLS"
- "Genelde 20–40 saniye sürer"

**Numbers and prices that are sample data:**
- Prices: 1.490 TL/yıl, 199 TL/ay, "%38 tasarruf".
- Referral: "yılda 6 davet", "+14 gün".
- Free limit: "50/gün" AI.
- All user and contact data (Yunus, Ahmet, Mehmet…).

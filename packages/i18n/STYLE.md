# @da/i18n — copy and catalog style guide

Binding for every user-facing string in the mobile app, the web site and the backoffice. Turkish (`tr`) is the source language and the default locale; English (`en`) is complete and written as natural English, not as a word-for-word translation.

## 1. Voice and tone (SREQ-87)

The product voice is **sakin, net, zeki, kısa, yardımcı** — calm, clear, smart, short, helpful — and it is never patronising.

| Do                                                               | Don't                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| "Takvimine eklendi."                                             | "İşleminiz başarıyla gerçekleştirilmiştir."            |
| "Önemli mailler"                                                 | "Elektronik posta analizi"                             |
| "Senkronizasyon gecikti." + one action                           | Stack traces, HTTP codes, "Beklenmeyen bir hata (500)" |
| "Her şey kontrol altında." (an empty state is a success message) | "Hiç veri bulunamadı!"                                 |

- Address the user with **sen** (informal): "Mailini bağla.", "İstediğin zaman kaldırabilirsin." Never _siz_.
- The assistant speaks in the **first person singular** about its own work ("46 maili senin için okudum.", "Hazır olunca haber veririm."); the company speaks in the **first person plural** about policy ("Sen onaylamadan mail göndermeyiz.", "Sadece önemli olduğunda haber veririz.").
- Short sentences. One idea per sentence. Full sentences end with a period; labels, chips, kickers and buttons do not.
- Buttons: Turkish uses the design's title case ("Brifingimi Gör", "Yeniden Bağlan", "Tekrar Dene"); English uses sentence case ("See my briefing", "Reconnect", "Try again").
- No exclamation marks, no emoji, no hype. Numbers are digits ("3 önemli konu"), times are 24-hour ("17:00").
- Errors are readable and carry exactly one action (SREQ-80). Say what happened and what still works: "Toplantı hazırlığı ve çakışma uyarıları takvim erişimi gerektirir. Diğer her şey çalışıyor."
- Never invent a count. If a number is zero or unknown, drop the sentence instead of writing "0".
- Every card answers "Peki şimdi ne yapacağım?" with at least one action label (SREQ-89).

## 2. Truthfulness (M§40, M§100, M§141, R-15, R-17)

Copy states only what the architecture really does:

- **Encryption:** "Veriler aktarım sırasında ve saklanırken şifrelenir." Data is processed on our servers, so there is no claim that only the user's device can decrypt it (no E2E claim anywhere, in either language).
- **Approval:** "Önemli işlemler sen onaylamadan gerçekleştirilmez." Every write (mail, calendar, task, reminder, commitment) is shown first and approved with a tap. Voice never approves: the voice screen says "Onaylamak için karta dokun." (R-03).
- **Advertising and training:** "Verilerin reklam amacıyla satılmaz." / "Mail içeriklerin yapay zekâ modellerini eğitmek için kullanılmaz."
- **Storage (R-15, verbatim):** "Mail içeriğinin tamamı saklanmaz; yalnızca özetler, kısa alıntılar ve analiz sonuçları saklama süren boyunca tutulur." First Analysis footer and the Android notification disclosure are in `privacy.storage.*` and are used as-is.
- **Retention:** 30 gün / 90 gün (default) / 1 yıl / Silene kadar.
- **Notifications (R-14):** "Sadece önemli olduğunda haber veririz." No frequency promises beyond the configured daily cap.
- **Pro:** the AI allowance is "Adil kullanım" / "Fair use". Pro is never described as “sınırsız” / “unlimited” in a positive claim; the quality gate rejects it.
- **Prices and trials:** prices come from the store; trial wording appears only when the store offer exists and the user is eligible. No card-free trial claims.
- **AI output:** ungrounded dates, amounts and relations are shown as "Kaynakta kesinleşmiyor."; low-confidence rows start with "Emin değilim".
- **Missing credentials / kill switches:** say so ("Harici kimlik bilgisi gerekli", "Bu özellik şu anda kullanılamıyor.") — never fake success.
- **Push privacy (C-14):** names, subjects and amounts appear only at the `full` detail level; `generic` is always "Dijital Asistan" / "Yeni bir güncellemen var."

Shared statements live under exactly one key and screens reference that key instead of copying the text: `privacy.promises.*`, `privacy.storage.*`, `notifications.promise`, `common.app.tagline`, `common.provenance.notConfirmed`.

## 3. Key naming

`<namespace>.<screen_or_area>.<element>` — for example `today.hero.morningReady.title`, `settings.accounts.disconnect.confirm`.

- One JSON file per namespace per locale: `messages/<locale>/<namespace>.json`. The namespaces are listed in `src/namespaces.ts`.
- Segments are `camelCase`. A segment that mirrors a canonical enum value or API code keeps that value exactly (snake_case): `mail.categories.awaiting_my_reply`, `approvals.statuses.executing`, `reminder.presets.tomorrow_morning`, `errors.ai_unavailable`.
- Canonical families:
  - API errors: `errors.<code_lower>` (the envelope's `message_key`); field errors: `errors.field.<zod_issue_code>`.
  - Push: `push.<category>.<template>.<full|title_only|generic>.<title|body>`; Android channels: `push.channels.<channel_id>.name|description`.
  - Global states: `states.<loading|empty|offline|error|partial|permission|limit|entitlement|unavailable|notFound>.*` (M-STATE-01…12).
  - FAQ: `faq.items.<key>.q|a`, metadata in `src/faq.ts`.
- Leaves are strings. A key is either a message or a group, never both.
- tr and en always have the same keys. Add both in the same change.

## 4. ICU MessageFormat

- Arguments are named for their meaning (`{count}`, `{time}`, `{service}`), and tr and en use the same names.
- Plurals: English needs them — `{count, plural, one {# email} other {# emails}}`. Turkish nouns stay singular after a number ("3 mail"), so Turkish usually writes `{count} mail`.
- Variants: `{kind, select, calendar {…} other {…}}`; every select has an `other` branch.
- Rich text: `<privacy>Gizlilik Politikası</privacy>`, rendered with `t.rich` / `t.markup`; tr and en use the same tag names.
- Dates, times, amounts and durations are passed **preformatted** from `src/formats.ts` (`{time}` = "09:40"), not as ICU `{d, date}` arguments, so output is identical on Hermes, Node and browsers.
- Apostrophes: Turkish copy uses the ASCII `'` ("Ahmet'e", "Bugün'e Dön"). In ICU an apostrophe directly before `{ } # < > | '` starts a quoted literal and swallows text, so never write `'` immediately before those characters. Quotations use “ ”.
- Use "…" (U+2026), never three dots. No leading, trailing or double spaces.

## 5. Turkish case suffixes (`src/tr-suffix.ts`)

A message can never inflect an argument (`{time}'de` is broken ICU and wrong for most values). Instead the Turkish message uses a case-variant argument and the caller passes values through `withTrCases`:

```ts
// tr: "Bugün {time_loc} kapanıyor."   en: "Closes today at {time}."
t('push.deadline.due_soon.full.body', withTrCases({ time: '17:00' })); // → "Bugün 17:00'de kapanıyor."
```

| Case                    | Suffix on the argument | Example                          |
| ----------------------- | ---------------------- | -------------------------------- |
| dative (-e)             | `_dat`                 | Ahmet'e, Ayşe'ye, 6'ya, 17:00'ye |
| accusative (-i)         | `_acc`                 | Ahmet'i, 77'yi                   |
| locative (-de)          | `_loc`                 | 09:40'ta, 13:00'te, Gmail'de     |
| ablative (-den)         | `_abl`                 | 09:40'tan, 10:00'dan, Selin'den  |
| genitive (-in)          | `_gen`                 | AI'ın, Ayşe'nin                  |
| instrumental (-le)      | `_ins`                 | Ahmet'le, Ayşe'yle               |
| 3rd-person possessive   | `_poss`                | 77'si                            |
| possessive + accusative | `_possacc`             | 77'sini                          |
| plural                  | `_pl`                  | Ahmet'ler                        |

- English messages use the base name (`{time}`); `check-catalogs` treats `time_loc` and `time` as the same argument and rejects case variants in English.
- Harmony follows how the value is **read aloud**: numbers by their last spoken word (1 bir → 1'e, 9 dokuz → 9'a, 40 kırk → 40'a, 60 altmış → 60'a, 100 yüz → 100'e, 1000 bin → 1000'e); times by their minutes (09:40 "kırk" → 09:40'tan) or by the hour on the full hour (10:00 "on" → 10:00'dan); acronyms by the TDK letter name of the last letter (THY'ye, PDF'den, ABD'ye) unless they are read as words (NATO'ya); brand names through a pronunciation table (Google'a, Microsoft'ta, Outlook'ta, Gmail'de). Pass `{ reading: '…' }` for anything else.
- Proper nouns, numbers, times and acronyms take an apostrophe and never soften in writing (Zeynep'e, Tarık'ın). Common nouns use `{ apostrophe: false }` and soften p ç t k → b c d ğ before a vowel (kitaba, ağacı, rengi); override with `soften`.
- `readNumberTr(1842)` → "bin sekiz yüz kırk iki" (also used for text-to-speech).

## 6. Casing

Kickers and badges are stored in natural case ("Son tarih", "Bugünün Öncelikleri") and upper-cased at render time with `toUpper(text, locale)` → "SON TARİH". Never use `textTransform: 'uppercase'` or CSS `text-transform` for Turkish, which turns "i" into "I". `foldForSearch` gives accent- and case-insensitive matching for local search.

## 7. Formats and time

- 24-hour clock in both languages; dates `d MMMM yyyy` ("5 Eylül 2026", "5 September 2026").
- Every date helper takes the IANA zone as a parameter; the default is `Europe/Istanbul`, and screens pass `user_preferences.timezone`.
- Currency: `Intl.NumberFormat('tr-TR', {style:'currency', currency:'TRY'})` → "₺1.842,00"; English uses `en-US` → "TRY 1,842.00".
- Relative time uses date-fns `formatDistance` / `formatRelative` with the `tr` and `enGB` locale data ("3 gün önce", "Dün 15:40"). `Intl.RelativeTimeFormat` is not used because Hermes lacks it.

## 8. Pseudo-locale

`pseudoLocalizeMessages(loadMessages('tr'))` accents every text run, lengthens it by at least 40 % and brackets the message (`[Ôñáýļá~~~]`), leaving ICU arguments, plural branches and tags untouched. Use it to find truncation and hard-coded strings; containers must not clip it.

## 9. Gates

- `node scripts/check-catalogs.ts` (also run by `pnpm test`): identical key sets, every message parses and formats with intl-messageformat, identical arguments and tags in tr and en, the banned-marker list from `scripts/quality-gate/banned-markers.txt` (work markers, unfinished-feature promises in Turkish and English, E2E-encryption and card-free-trial claims), positive fair-use claims, ICU quote traps, whitespace, push detail levels and push privacy, FAQ metadata, and the verbatim strings the plan requires.
- `pnpm quality-gate` at the repository root scans source and copy for the same markers.
- Typed keys: apps add `import type {} from '@da/i18n/use-intl';` once; an unknown key is then a compile error in `useTranslations` / `getTranslations`.

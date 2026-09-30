# Design references

Two design archives were supplied with the product brief. They are **not committed**: extract them locally
into `design/reference/` (git-ignored) with

```bash
unzip -q <path>/Dijital_Asistan_tasar_m_sistemi_son.zip -d design/reference/primary
unzip -q <path>/Dijital_Asistan_m_21.zip -d design/reference/secondary
node scripts/design/extract-tokens.ts && node scripts/design/extract-icons.ts && node scripts/design/extract-copy.ts
```

What _is_ committed is what the product consumes:

| Path                         | Produced by                        | Consumed by                                                                            |
| ---------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------- |
| `tokens/primary-tokens.json` | `scripts/design/extract-tokens.ts` | `packages/design-tokens` (source of truth for colours, type, spacing, radius)          |
| `icons/used-icons.txt`       | `scripts/design/extract-icons.ts`  | `packages/ui` icon codegen manifest                                                    |
| `copy/primary-copy.tsv`      | `scripts/design/extract-copy.ts`   | seeding the `tr` i18n catalogs (reference only; runtime copy lives in `packages/i18n`) |

## Precedence

1. **Visual language** — the PRIMARY archive (`Dijital Asistan tasarım sistemi son.zip`: `01 Tasarım Sistemi` … `09 Pazarlama`
   and the clickable hub `Dijital Asistan.dc.html`) wins every visual conflict.
2. **Missing screens / coverage** — the SECONDARY archive (`Dijital Asistanım`, a Figma-Make React prototype) supplies
   information architecture and function for screens PRIMARY does not draw (notification settings, briefing settings,
   help, feedback, per-account data source controls, …). Those screens are rebuilt in the PRIMARY language.
3. **Functional behaviour** — the product brief (master prompt) is binding; where a prototype and the brief disagree,
   the brief wins. Deviations from PRIMARY are logged with their reason in `docs/DESIGN_AUDIT.md`.

The product is native React Native UI. The prototypes are never embedded (no WebView).

## Never copied from the prototypes

Both archives simulate behaviour. None of the following is carried into the product (full inventory with file
references: `docs/DESIGN_AUDIT.md` → prototype-only behaviours):

- canned assistant answers, keyword-matched replies and fixed voice answers;
- timer-driven "analysis" progress, fake loading and fake audio progress;
- fake send / "Gönderildi" / "Çözüldü!" success states and instant fake connect/disconnect;
- approvals, settings, reminders and tasks that live only in local component state;
- direct calendar changes without approval, and moving another person's meeting;
- hard-coded counts, dates frozen at "5 Eylül", and demo names outside demo mode;
- dead buttons (empty handlers), `alert()` handoffs and fake external-app screens (Gmail / Meet);
- the swapped Mail Intelligence wiring and the ±10 % "15 s" seek bug;
- Inter font, emoji icons, the purple deadline colour, the accent-colour picker and "Yakında" languages.

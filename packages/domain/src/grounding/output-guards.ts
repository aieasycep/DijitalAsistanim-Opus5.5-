/**
 * Prompt-injection and exfiltration guards (M§114, M§115; AI_PIPELINE_PLAN §6.5, §9).
 *
 * - `prescanInjection` flags untrusted input (instruction-like text, hidden content, base64 blobs);
 *   a flagged source never yields proposed actions or automated follow-ups.
 * - `guardOutputText` validates every model text field after zod: it rejects instruction echoes,
 *   the deploy canary and UUID-like identifiers (cross-user guard), drops URLs / e-mail addresses /
 *   phone numbers not present verbatim in the referenced sources (URLs must be https), and strips
 *   markdown/HTML.
 * - `guardRefs` keeps only request aliases; `guardFreeText` removes sentences whose numbers or
 *   proper nouns are not grounded.
 */
import { foldTR, normalizeTR } from '../extract/normalize-tr.ts';

const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /ignore (?:all |the )?(?:previous|prior|above) (?:instructions|prompts?)/iu,
  /ignore all instructions/iu,
  /onceki (?:tum )?talimatlari (?:yok say|gormezden gel|unut)/iu,
  /sistem (?:mesaji|talimati|istemi)/iu,
  /you are now/iu,
  /(?:^|\n)\s*(?:assistant|system|user)\s*:/iu,
  /<\/?system>/iu,
  /system prompt/iu,
  /talimatlarim/iu,
  /yapay zek[aâ]\s*(?:asistan)?[ıi]?,?\s*(?:sunu|bunu) yap/iu,
  /bu (?:maili|e-?postayi) okuyan (?:asistan|yapay zeka)/iu,
  /(?:tum|butun) (?:mailleri|e-?postalari) .{0,40}(?:ilet|gonder|yonlendir)/iu,
];

const ZERO_WIDTH_RUN = /[\u200B-\u200D\u2060\uFEFF]{3,}/u;
const BASE64_BLOB = /[A-Za-z0-9+/]{200,}={0,2}/;
const HIDDEN_HTML = /(?:display\s*:\s*none|font-size\s*:\s*0|visibility\s*:\s*hidden)/iu;
const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;
const URL_RE = /\b(?:https?|ftp|javascript|data|file):\/?\/?[^\s<>"')\]]+/giu;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu;
const PHONE_RE =
  /(?<![\d])(?:\+?90[\s-]?)?0?\(?5\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?![\d])|(?<![\d])(?:\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s-]\d{3}[\s-]\d{4}(?![\d])/gu;

export type InjectionSignal =
  'instruction_like' | 'hidden_html' | 'zero_width_run' | 'base64_blob' | 'mixed_script_domain';

export interface InjectionScan {
  readonly suspected: boolean;
  readonly signals: readonly InjectionSignal[];
}

/** A domain label mixing Latin with Cyrillic/Greek letters (homoglyph lure). */
function hasMixedScriptDomain(text: string): boolean {
  for (const m of text.matchAll(/[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu)) {
    for (const label of m[0].split('.')) {
      const latin = /\p{Script=Latin}/u.test(label);
      const other = /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(label);
      if (latin && other) return true;
    }
  }
  return false;
}

/** Heuristic pre-scan of untrusted content (mail body, capture text, link text). */
export function prescanInjection(raw: string): InjectionScan {
  const folded = foldTR(normalizeTR(raw));
  const signals: InjectionSignal[] = [];
  if (INSTRUCTION_PATTERNS.some((re) => re.test(folded))) signals.push('instruction_like');
  if (HIDDEN_HTML.test(raw)) signals.push('hidden_html');
  if (ZERO_WIDTH_RUN.test(raw)) signals.push('zero_width_run');
  if (BASE64_BLOB.test(raw)) signals.push('base64_blob');
  if (hasMixedScriptDomain(raw)) signals.push('mixed_script_domain');
  return { suspected: signals.length > 0, signals };
}

export interface OutputGuardContext {
  /** Texts of the sources the output may cite (alias map values, participants, trusted context). */
  readonly sources: readonly string[];
  /** Per-deploy canary string from the system prompt. */
  readonly canary?: string;
  /** Maximum characters after cleaning (e.g. summary_tr 200). */
  readonly maxLength?: number;
  /** The cited source was flagged by the pre-scan: nothing contactable is echoed from it. */
  readonly injectionSuspected?: boolean;
}

export type OutputRejection = 'canary' | 'instruction_echo' | 'identifier_leak';

export interface GuardedText {
  /** False when the whole output must be rejected (retry / fallback + `ai_ops` alert). */
  readonly ok: boolean;
  readonly rejection: OutputRejection | null;
  /** Cleaned value (only meaningful when `ok`). */
  readonly value: string;
  readonly droppedUrls: readonly string[];
  readonly droppedEmails: readonly string[];
  readonly droppedPhones: readonly string[];
}

function stripMarkup(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function presentIn(value: string, sources: readonly string[], suspected: boolean): boolean {
  if (suspected) return false;
  const v = value.toLowerCase();
  return sources.some((s) => s.toLowerCase().includes(v));
}

/** Validates one model text field (§9 item 13). */
export function guardOutputText(value: string, ctx: OutputGuardContext): GuardedText {
  const folded = foldTR(normalizeTR(value));
  const reject = (rejection: OutputRejection): GuardedText => ({
    ok: false,
    rejection,
    value: '',
    droppedUrls: [],
    droppedEmails: [],
    droppedPhones: [],
  });
  if (ctx.canary && value.includes(ctx.canary)) return reject('canary');
  if (INSTRUCTION_PATTERNS.some((re) => re.test(folded))) return reject('instruction_echo');
  if (UUID_LIKE.test(value)) return reject('identifier_leak');

  const suspected = ctx.injectionSuspected === true;
  const droppedUrls: string[] = [];
  const droppedEmails: string[] = [];
  const droppedPhones: string[] = [];
  let out = value.replace(URL_RE, (url) => {
    const clean = url.replace(/[.,;:!?]+$/, '');
    if (clean.startsWith('https://') && presentIn(clean, ctx.sources, suspected)) return url;
    droppedUrls.push(clean);
    return '';
  });
  out = out.replace(EMAIL_RE, (email) => {
    if (presentIn(email, ctx.sources, suspected)) return email;
    droppedEmails.push(email);
    return '';
  });
  out = out.replace(PHONE_RE, (phone) => {
    const digits = phone.replace(/\D/g, '');
    if (!suspected && ctx.sources.some((s) => s.replace(/\D/g, '').includes(digits))) return phone;
    droppedPhones.push(phone);
    return '';
  });
  out = stripMarkup(out);
  if (ctx.maxLength !== undefined && out.length > ctx.maxLength)
    out = out.slice(0, ctx.maxLength).trim();
  return { ok: true, rejection: null, value: out, droppedUrls, droppedEmails, droppedPhones };
}

/** Keeps only request aliases (the cross-user guard: ids are never exposed to the model). */
export function guardRefs(refs: readonly string[], aliases: ReadonlySet<string>): string[] {
  return refs.filter((r) => aliases.has(r));
}

/**
 * Proposed actions survive only for clean sources: an injection-suspected source yields none
 * (the CI adversarial eval requires zero approvals from injection mails).
 */
export function guardProposals<T>(proposals: readonly T[], scan: InjectionScan): T[] {
  return scan.suspected ? [] : [...proposals];
}

const MONTHS_WEEKDAYS =
  /(?<!\p{L})(?:ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik|pazartesi|sali|carsamba|persembe|cuma|cumartesi|pazar)(?!\p{L})/gu;

export interface FreeTextGuardResult {
  readonly kept: readonly string[];
  readonly removed: number;
  /** Share of claim sentences (with numbers/dates/names) that survived. */
  readonly coverage: number;
  /** Sentences kept but suffixed with the unverified marker (assistant mode). */
  readonly flagged: readonly number[];
}

/**
 * §6.5 free-text guard: numbers, times, dates, amounts and capitalised non-initial words in each
 * sentence must occur in the sources (after normalisation); otherwise the sentence is removed —
 * or, in assistant mode when other verified content remains, kept and flagged
 * ("(kaynakta kesinleşmiyor)", i18n `explain.unverified.inline`).
 */
export function guardFreeText(
  text: string,
  sources: readonly string[],
  opts: { readonly assistantMode?: boolean; readonly trustedNames?: readonly string[] } = {},
): FreeTextGuardResult {
  const hay = foldTR(normalizeTR([...sources, ...(opts.trustedNames ?? [])].join('\n')));
  const sentences = text
    .split(/(?<=[.!?])\s+(?=\p{Lu}|\d)/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const kept: string[] = [];
  const flagged: number[] = [];
  let claims = 0;
  let supported = 0;
  for (const s of sentences) {
    const folded = foldTR(normalizeTR(s));
    const facts = [
      ...(folded.match(/\d+(?:[:.,]\d+)*/g) ?? []),
      ...(folded.match(MONTHS_WEEKDAYS) ?? []),
    ];
    const words = s.split(/\s+/).slice(1);
    const properNouns = words
      .map((w) => w.replace(/[^\p{L}'-]/gu, '').replace(/'.*$/u, ''))
      .filter((w) => /^\p{Lu}\p{Ll}+/u.test(w))
      .map((w) => foldTR(normalizeTR(w)));
    const all = [...facts, ...properNouns];
    if (all.length === 0) {
      kept.push(s);
      continue;
    }
    claims++;
    const unsupported = all.filter((f) => !hay.includes(f));
    if (unsupported.length === 0) {
      supported++;
      kept.push(s);
    } else if (opts.assistantMode && unsupported.length < all.length) {
      flagged.push(kept.length);
      kept.push(s);
    }
  }
  return {
    kept,
    removed: sentences.length - kept.length,
    coverage: claims === 0 ? 1 : supported / claims,
    flagged,
  };
}

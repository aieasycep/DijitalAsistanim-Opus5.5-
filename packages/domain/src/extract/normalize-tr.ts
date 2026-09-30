/**
 * Turkish text normalisation shared by every deterministic extractor and by the grounding verifier
 * (AI_PIPELINE_PLAN §6.2). JavaScript `\b` is ASCII-only, so extractors use the Unicode letter
 * boundaries exported here together with the `u` flag.
 */

/** Negative look-behind: the match must not be preceded by a letter. */
export const LB = '(?<!\\p{L})';
/** Negative look-ahead: the match must not be followed by a letter. */
export const RB = '(?!\\p{L})';

/**
 * Turkish-aware lower-casing that does not depend on the runtime's ICU data (Hermes, Deno and Node
 * behave the same): `I → ı`, `İ → i`, then the default lower-casing.
 */
export function trLower(s: string): string {
  return s.replace(/I/g, 'ı').replace(/İ/g, 'i').toLowerCase();
}

/** Turkish-aware upper-casing (`i → İ`, `ı → I`). */
export function trUpper(s: string): string {
  return s.replace(/i/g, 'İ').replace(/ı/g, 'I').toUpperCase();
}

const FOLD: Readonly<Record<string, string>> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  â: 'a',
  à: 'a',
  î: 'i',
  ì: 'i',
  û: 'u',
  ù: 'u',
};

/**
 * ASCII folding of Turkish letters ("çarşamba" → "carsamba"). It is a 1:1 character mapping, so
 * offsets in the folded copy equal offsets in the input. Expects lower-case input.
 */
export function foldTR(s: string): string {
  let out = '';
  for (const ch of s) out += FOLD[ch] ?? ch;
  return out;
}

/** Result of {@link normTR}: the normalised text plus offset maps back into the original string. */
export interface NormalizedText {
  readonly text: string;
  /** `start[i]` = index in the original string where normalised char `i` came from. */
  readonly start: readonly number[];
  /** `end[i]` = exclusive end index in the original string of the cluster that produced char `i`. */
  readonly end: readonly number[];
}

const INVISIBLE = /[\u200B-\u200D\uFEFF\u00AD\u2060]/u;
const SPACE_LIKE = /[\s\u00A0\u202F\u2007\u2009\u200A]/u;
const COMBINING = /\p{M}/u;

function mapPunctuation(s: string): string {
  return s
    .replace(/[\u201C\u201D\u201E\u00AB\u00BB]/g, '"')
    .replace(/[\u2018\u2019\u201A\u2032`]/g, "'")
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...');
}

/**
 * Normalises text for matching (AI_PIPELINE_PLAN §6.2): NFKC per character cluster, removal of
 * zero-width characters and soft hyphens, NBSP → space, typographic quotes/dashes → ASCII,
 * Turkish lower-casing, whitespace collapsing and trimming. Offsets into the original string are
 * kept for evidence spans.
 */
export function normTR(input: string): NormalizedText {
  // 1. split into clusters (base + combining marks) so NFKC composes "I" + U+0307 into "İ".
  const clusters: { text: string; from: number; to: number }[] = [];
  let i = 0;
  while (i < input.length) {
    const cp = input.codePointAt(i) ?? 0;
    const width = cp > 0xffff ? 2 : 1;
    let j = i + width;
    while (j < input.length) {
      const next = input.codePointAt(j) ?? 0;
      const ch = String.fromCodePoint(next);
      if (!COMBINING.test(ch)) break;
      j += next > 0xffff ? 2 : 1;
    }
    clusters.push({ text: input.slice(i, j), from: i, to: j });
    i = j;
  }

  const chars: string[] = [];
  const start: number[] = [];
  const end: number[] = [];
  let pendingSpace = false;
  for (const c of clusters) {
    if (INVISIBLE.test(c.text)) continue;
    const mapped = trLower(mapPunctuation(c.text.normalize('NFKC')));
    for (const ch of mapped) {
      if (INVISIBLE.test(ch) || COMBINING.test(ch)) {
        const last = chars.length - 1;
        if (COMBINING.test(ch) && last >= 0) {
          // keep marks that NFKC cannot compose attached to the previous char
          chars[last] = `${chars[last] ?? ''}${ch}`;
        }
        continue;
      }
      if (SPACE_LIKE.test(ch)) {
        if (chars.length > 0) pendingSpace = true;
        continue;
      }
      if (pendingSpace) {
        chars.push(' ');
        start.push(c.from);
        end.push(c.from);
        pendingSpace = false;
      }
      chars.push(ch);
      start.push(c.from);
      end.push(c.to);
    }
  }
  // chars may contain multi-code-unit entries (surrogates, attached marks); flatten while keeping maps
  let text = '';
  const s2: number[] = [];
  const e2: number[] = [];
  chars.forEach((ch, k) => {
    text += ch;
    // one map entry per UTF-16 code unit
    const units = ch.length;
    s2.push(...new Array<number>(units).fill(start[k] ?? 0));
    e2.push(...new Array<number>(units).fill(end[k] ?? 0));
  });
  return { text, start: s2, end: e2 };
}

/** Convenience: only the normalised string. */
export function normalizeTR(input: string): string {
  return normTR(input).text;
}

/** Maps a `[from, to)` span of the normalised text back to the original string. */
export function originalSpan(n: NormalizedText, from: number, to: number): [number, number] {
  if (to <= from) {
    const at = n.start[from] ?? n.end[n.end.length - 1] ?? 0;
    return [at, at];
  }
  return [n.start[from] ?? 0, n.end[to - 1] ?? 0];
}

/** Normalised + folded comparison key (used for names, merchants, carriers). */
export function matchKeyTR(input: string): string {
  return foldTR(normalizeTR(input));
}

/** Splits normalised text into word tokens (letters and digits; punctuation dropped). */
export function tokensTR(normalized: string): string[] {
  return normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Escapes a literal for use inside a RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

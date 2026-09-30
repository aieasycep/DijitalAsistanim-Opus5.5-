/**
 * Pseudo-locale for truncation and hard-coded-string QA (ADR-14, SREQ-88): every translatable
 * text run is accented and lengthened by at least 40 %, and the whole message is bracketed so a
 * cut-off end is visible. ICU syntax is untouched: arguments, plural/select branches, `#`, tags and
 * quoted literals keep their exact source text, because only the source ranges of literal
 * elements (located by the ICU parser) are rewritten.
 */
import {
  isLiteralElement,
  isPluralElement,
  isSelectElement,
  isTagElement,
  parse,
  type MessageFormatElement,
} from '@formatjs/icu-messageformat-parser';

/** Minimum growth of every text run. */
export const PSEUDO_EXPANSION = 0.4;

const PAD = '~';
const OPEN = '[';
const CLOSE = ']';

const ACCENTED: Readonly<Record<string, string>> = {
  a: 'á',
  b: 'ƀ',
  c: 'ċ',
  d: 'ď',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'î',
  j: 'ĵ',
  k: 'ķ',
  l: 'ļ',
  m: 'ṁ',
  n: 'ñ',
  o: 'ô',
  p: 'ṗ',
  q: 'ʠ',
  r: 'ŕ',
  s: 'ŝ',
  t: 'ŧ',
  u: 'û',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  B: 'Ɓ',
  C: 'Ċ',
  D: 'Ď',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Î',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ļ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ô',
  P: 'Ṗ',
  Q: 'Ǫ',
  R: 'Ŕ',
  S: 'Ŝ',
  T: 'Ŧ',
  U: 'Û',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

export interface PseudoOptions {
  /** Growth factor for each text run; defaults to `PSEUDO_EXPANSION` (0.4). */
  expansion?: number;
  /** Wrap the message in `[…]`; defaults to true. */
  brackets?: boolean;
}

interface LiteralSpan {
  start: number;
  end: number;
  value: string;
}

function collectLiteralSpans(
  elements: readonly MessageFormatElement[],
  spans: LiteralSpan[],
): void {
  for (const element of elements) {
    if (isLiteralElement(element)) {
      if (element.location) {
        spans.push({
          start: element.location.start.offset,
          end: element.location.end.offset,
          value: element.value,
        });
      }
    } else if (isPluralElement(element) || isSelectElement(element)) {
      for (const option of Object.values(element.options)) collectLiteralSpans(option.value, spans);
    } else if (isTagElement(element)) {
      collectLiteralSpans(element.children, spans);
    }
  }
}

function accent(raw: string): string {
  let out = '';
  for (const ch of raw) out += ACCENTED[ch] ?? ch;
  return out;
}

/**
 * Rewrites one literal's source text: accents plus padding (≥ `expansion` × the literal's length)
 * placed before trailing whitespace. Whitespace-only runs between arguments stay as they are.
 */
function expandRaw(raw: string, value: string, expansion: number): string {
  if (value.trim() === '') return raw;
  const padding = PAD.repeat(Math.ceil(value.length * expansion));
  const trailing = /\s*$/.exec(raw)?.[0].length ?? 0;
  const body = raw.slice(0, raw.length - trailing);
  return `${accent(body)}${padding}${raw.slice(raw.length - trailing)}`;
}

/** Pseudo-localizes one ICU message. Throws if the message is not valid ICU. */
export function pseudoLocalize(message: string, options: PseudoOptions = {}): string {
  const { expansion = PSEUDO_EXPANSION, brackets = true } = options;
  const spans: LiteralSpan[] = [];
  collectLiteralSpans(parse(message, { captureLocation: true }), spans);
  spans.sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = 0;
  for (const span of spans) {
    out += message.slice(cursor, span.start);
    out += expandRaw(message.slice(span.start, span.end), span.value, expansion);
    cursor = span.end;
  }
  out += message.slice(cursor);
  return brackets ? `${OPEN}${out}${CLOSE}` : out;
}

type Catalog = string | { readonly [key: string]: Catalog };

/** Pseudo-localizes every message of a catalog (e.g. `loadMessages('tr')`), keeping its shape. */
export function pseudoLocalizeMessages<T extends Catalog>(messages: T, options?: PseudoOptions): T {
  if (typeof messages === 'string') return pseudoLocalize(messages, options) as T;
  const out: Record<string, Catalog> = {};
  for (const [key, value] of Object.entries(messages))
    out[key] = pseudoLocalizeMessages(value, options);
  return out as T;
}

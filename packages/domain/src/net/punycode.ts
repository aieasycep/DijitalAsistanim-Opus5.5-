/**
 * Punycode (RFC 3492) and host-level IDNA helpers, pure TypeScript. Used for IDN display and for
 * comparing hosts shown in link text with the real link target (url-safety.ts), and for turning
 * Unicode hostnames into the ASCII form checked by the SSRF policy (fetch-policy.ts).
 *
 * Host mapping is a pragmatic subset of UTS #46: NFC, lower-casing, and the ideographic full
 * stops (U+3002, U+FF0E, U+FF61) treated as dots. A Unicode label may contain only letters, marks,
 * digits and hyphens (no controls, symbols or emoji). `xn--` labels must decode to such a label and
 * re-encode to the same ASCII, which blocks non-canonical punycode.
 */

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const MAX_INT = 0x7fffffff;
const ACE_PREFIX = 'xn--';

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) / 2) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
}

function digitToChar(digit: number): string {
  // 0..25 → a..z, 26..35 → 0..9
  return String.fromCharCode(digit < 26 ? digit + 97 : digit + 22);
}

function charToDigit(code: number): number {
  if (code >= 48 && code <= 57) return code - 22;
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97;
  return BASE;
}

function threshold(k: number, bias: number): number {
  if (k <= bias) return T_MIN;
  if (k >= bias + T_MAX) return T_MAX;
  return k - bias;
}

/** Encodes a Unicode string to punycode (without the `xn--` prefix). Throws on overflow. */
export function punycodeEncode(input: string): string {
  const codePoints = Array.from(input, (ch) => ch.codePointAt(0) ?? 0);
  let output = codePoints
    .filter((cp) => cp < 0x80)
    .map((cp) => String.fromCharCode(cp))
    .join('');
  const basicLength = output.length;
  let handled = basicLength;
  if (basicLength > 0) output += '-';
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  while (handled < codePoints.length) {
    let m = MAX_INT;
    for (const cp of codePoints) if (cp >= n && cp < m) m = cp;
    if (m - n > Math.floor((MAX_INT - delta) / (handled + 1))) throw new RangeError('overflow');
    delta += (m - n) * (handled + 1);
    n = m;
    for (const cp of codePoints) {
      if (cp < n) {
        delta++;
        if (delta > MAX_INT) throw new RangeError('overflow');
      }
      if (cp === n) {
        let q = delta;
        for (let k = BASE; ; k += BASE) {
          const t = threshold(k, bias);
          if (q < t) break;
          output += digitToChar(t + ((q - t) % (BASE - t)));
          q = Math.floor((q - t) / (BASE - t));
        }
        output += digitToChar(q);
        bias = adapt(delta, handled + 1, handled === basicLength);
        delta = 0;
        handled++;
      }
    }
    delta++;
    n++;
  }
  return output;
}

/** Decodes punycode (without the `xn--` prefix). Throws on malformed input. */
export function punycodeDecode(input: string): string {
  const output: number[] = [];
  const delimiter = input.lastIndexOf('-');
  const basicEnd = delimiter < 0 ? 0 : delimiter;
  for (let j = 0; j < basicEnd; j++) {
    const code = input.charCodeAt(j);
    if (code >= 0x80) throw new RangeError('not-basic');
    output.push(code);
  }
  let n = INITIAL_N;
  let i = 0;
  let bias = INITIAL_BIAS;
  for (let index = delimiter < 0 ? 0 : delimiter + 1; index < input.length;) {
    const oldI = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) throw new RangeError('invalid-input');
      const digit = charToDigit(input.charCodeAt(index++));
      if (digit >= BASE) throw new RangeError('invalid-input');
      if (digit > Math.floor((MAX_INT - i) / w)) throw new RangeError('overflow');
      i += digit * w;
      const t = threshold(k, bias);
      if (digit < t) break;
      if (w > Math.floor(MAX_INT / (BASE - t))) throw new RangeError('overflow');
      w *= BASE - t;
    }
    const length = output.length + 1;
    bias = adapt(i - oldI, length, oldI === 0);
    if (Math.floor(i / length) > MAX_INT - n) throw new RangeError('overflow');
    n += Math.floor(i / length);
    i %= length;
    if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) throw new RangeError('invalid-code-point');
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

/** UTS #46-style pre-mapping used before splitting a host into labels. */
export function mapHostInput(host: string): string {
  return host
    .normalize('NFC')
    .replace(/[。．｡]/g, '.')
    .toLowerCase();
}

const ASCII_LABEL = /^[a-z0-9-]*$/;
const UNICODE_LABEL = /^[\p{L}\p{M}\p{N}-]+$/u;

/**
 * Converts a host to its ASCII (A-label) form. Returns null when a label cannot be encoded or an
 * `xn--` label is not canonical punycode. IP literals and plain ASCII hosts pass through lower-cased.
 */
export function toAsciiHost(host: string): string | null {
  const mapped = mapHostInput(host);
  const labels = mapped.split('.');
  const out: string[] = [];
  for (const label of labels) {
    if (ASCII_LABEL.test(label)) {
      if (label.startsWith(ACE_PREFIX) && decodeLabel(label) === null) return null;
      out.push(label);
      continue;
    }
    if (!UNICODE_LABEL.test(label)) return null;
    try {
      out.push(ACE_PREFIX + punycodeEncode(label));
    } catch {
      return null;
    }
  }
  return out.join('.');
}

/** Decodes one `xn--` label, or null when it is malformed or non-canonical. */
export function decodeLabel(label: string): string | null {
  if (!label.startsWith(ACE_PREFIX)) return label;
  const body = label.slice(ACE_PREFIX.length);
  if (body === '') return null;
  try {
    const decoded = punycodeDecode(body);
    // An `xn--` label must carry at least one non-ASCII code point and be a valid Unicode label.
    if (Array.from(decoded).every((ch) => (ch.codePointAt(0) ?? 0) < 0x80)) return null;
    if (!UNICODE_LABEL.test(decoded)) return null;
    const reencoded = punycodeEncode(mapHostInput(decoded));
    return reencoded === body ? decoded : null;
  } catch {
    return null;
  }
}

/** Converts an ASCII host to Unicode (U-labels), or null when any `xn--` label is invalid. */
export function toUnicodeHost(asciiHost: string): string | null {
  const labels = asciiHost.toLowerCase().split('.');
  const out: string[] = [];
  for (const label of labels) {
    const decoded = decodeLabel(label);
    if (decoded === null) return null;
    out.push(decoded);
  }
  return out.join('.');
}

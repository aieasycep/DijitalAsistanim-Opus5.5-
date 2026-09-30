/**
 * "…at the end of the text" helpers for the Turkish suffix reader (`tr-suffix.ts`; internal, not
 * re-exported). They replace `/\d[\d.,]*$/`, `/[\p{L}\p{N}]+$/u` and `/[^\p{L}\p{N}]+$/u`: an
 * unanchored `X+$` retries every start of a long run of X that does not reach the end, O(n²) on
 * values such as 50 000 × "0" followed by a letter (CodeQL js/polynomial-redos). Walking back from
 * the end once finds the same (maximal) trailing run.
 */
const WORD_CODE_POINT = /^[\p{L}\p{N}]$/u;

function isWordCodePoint(codePoint: string): boolean {
  return WORD_CODE_POINT.test(codePoint);
}

/** Start of the maximal trailing run of code points for which `inRun` holds. */
function trailingRunStart(text: string, inRun: (codePoint: string) => boolean): number {
  let end = text.length;
  while (end > 0) {
    let start = end - 1;
    const unit = text.charCodeAt(start);
    if (unit >= 0xdc00 && unit <= 0xdfff && start > 0) {
      const lead = text.charCodeAt(start - 1);
      if (lead >= 0xd800 && lead <= 0xdbff) start -= 1;
    }
    if (!inRun(text.slice(start, end))) break;
    end = start;
  }
  return end;
}

/** `/[\p{L}\p{N}]+$/u.exec(text)?.[0]`: the last word, or `null` when the text ends otherwise. */
export function wordAtEnd(text: string): string | null {
  const start = trailingRunStart(text, isWordCodePoint);
  return start === text.length ? null : text.slice(start);
}

/** `text.replace(/[^\p{L}\p{N}]+$/u, '')`. */
export function withoutTrailingNonWord(text: string): string {
  return text.slice(
    0,
    trailingRunStart(text, (c) => !isWordCodePoint(c)),
  );
}

function isAsciiDigit(unit: number): boolean {
  return unit >= 0x30 && unit <= 0x39;
}

/** `/\d[\d.,]*$/.exec(text)?.[0]`: the trailing number with its separators, from its first digit. */
export function numberAtEnd(text: string): string | null {
  let start = text.length;
  while (start > 0) {
    const unit = text.charCodeAt(start - 1);
    if (!isAsciiDigit(unit) && unit !== 0x2e && unit !== 0x2c) break;
    start -= 1;
  }
  while (start < text.length && !isAsciiDigit(text.charCodeAt(start))) start += 1;
  return start === text.length ? null : text.slice(start);
}

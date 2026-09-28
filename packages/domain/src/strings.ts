/**
 * Linear-time trimming of a character set. A `/[…]+$/` replace retries the run at every start
 * position, so a long run of those characters that does not reach the end of the input costs
 * O(n²) (CodeQL js/polynomial-redos); these helpers walk the string once from its end (or start).
 * The sets are BMP characters, so code-unit comparison is exact.
 */

/** `value` without the trailing characters that occur in `chars`. */
export function trimEndChars(value: string, chars: string): string {
  let end = value.length;
  while (end > 0 && chars.includes(value.charAt(end - 1))) end -= 1;
  return value.slice(0, end);
}

/** `value` without the leading characters that occur in `chars`. */
export function trimStartChars(value: string, chars: string): string {
  let start = 0;
  while (start < value.length && chars.includes(value.charAt(start))) start += 1;
  return value.slice(start);
}

/**
 * Sentence splitting for the input-aware fixture synthesiser (AI_PIPELINE_PLAN §15.5). A `.`, `!`,
 * `?` or line break ends a sentence, except inside a Turkish amount found by the domain parser
 * (`parseAmountsTR`: "1.842,00 TL", "₺12.500") and between two digits ("25.09.2026"), so quotes keep
 * the full amount or date instead of the part after the thousands separator.
 */
import { parseAmountsTR } from '@da/domain';

export interface Sentence {
  readonly text: string;
  /** Offset of `text` in the source (quotes stay exact substrings). */
  readonly start: number;
}

const BOUNDARY = new Set(['.', '!', '?', '\n']);
const TERMINAL = new Set(['.', '!', '?']);
const DIGIT = /\d/;

export function sentences(text: string): Sentence[] {
  const guarded = new Set<number>();
  for (const amount of parseAmountsTR(text)) {
    for (let i = amount.span[0]; i < amount.span[1]; i++) guarded.add(i);
  }
  const out: Sentence[] = [];
  const push = (from: number, to: number) => {
    const raw = text.slice(from, to);
    const trimmed = raw.trim();
    if (trimmed.length >= 3)
      out.push({ text: trimmed, start: from + raw.length - raw.trimStart().length });
  };
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (!BOUNDARY.has(ch) || guarded.has(i)) continue;
    if (ch === '.' && DIGIT.test(text.charAt(i - 1)) && DIGIT.test(text.charAt(i + 1))) continue;
    let end = i + 1;
    if (ch !== '\n') while (end < text.length && TERMINAL.has(text.charAt(end))) end++;
    push(start, ch === '\n' ? i : end);
    start = end;
    i = end - 1;
  }
  push(start, text.length);
  return out;
}

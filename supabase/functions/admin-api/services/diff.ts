/**
 * Unified line diff for prompt versions (API_CONTRACTS ADM-09 `GET /ai/prompts/:key/diff`):
 * `---`/`+++` headers, `@@ -a,b +c,d @@` hunks with three context lines. The longest common
 * subsequence is computed over lines (prompt templates are at most a few thousand lines).
 */

interface Op {
  readonly kind: ' ' | '-' | '+';
  readonly text: string;
  /** 0-based line index in the old / new text where this op sits. */
  readonly a: number;
  readonly b: number;
}

function lcsOps(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  // lengths[i][j] = LCS length of a[i..] and b[j..]
  const lengths: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = lengths[i] as Uint32Array;
    const next = lengths[i + 1] as Uint32Array;
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: ' ', text: a[i] ?? '', a: i, b: j });
      i++;
      j++;
    } else if ((lengths[i + 1]?.[j] ?? 0) >= (lengths[i]?.[j + 1] ?? 0)) {
      ops.push({ kind: '-', text: a[i] ?? '', a: i, b: j });
      i++;
    } else {
      ops.push({ kind: '+', text: b[j] ?? '', a: i, b: j });
      j++;
    }
  }
  for (; i < n; i++) ops.push({ kind: '-', text: a[i] ?? '', a: i, b: j });
  for (; j < m; j++) ops.push({ kind: '+', text: b[j] ?? '', a: i, b: j });
  return ops;
}

function splitLines(text: string): string[] {
  return text === '' ? [] : text.replace(/\r\n/g, '\n').split('\n');
}

/** Unified diff of two texts; an empty string when they are equal. */
export function unifiedDiff(
  from: string,
  to: string,
  fromLabel: string,
  toLabel: string,
  context = 3,
): string {
  const ops = lcsOps(splitLines(from), splitLines(to));
  const changes = ops.flatMap((op, index) => (op.kind === ' ' ? [] : [index]));
  if (changes.length === 0) return '';
  // Group changes whose unchanged gap is at most 2 × context into one hunk.
  const groups: [number, number][] = [];
  for (const index of changes) {
    const last = groups[groups.length - 1];
    if (last !== undefined && index - last[1] - 1 <= context * 2) last[1] = index;
    else groups.push([index, index]);
  }
  const lines = [`--- ${fromLabel}`, `+++ ${toLabel}`];
  for (const [firstChange, lastChange] of groups) {
    const hunk = ops.slice(
      Math.max(0, firstChange - context),
      Math.min(ops.length, lastChange + context + 1),
    );
    const head = hunk[0] as Op;
    const oldCount = hunk.filter((op) => op.kind !== '+').length;
    const newCount = hunk.filter((op) => op.kind !== '-').length;
    lines.push(
      `@@ -${head.a + (oldCount === 0 ? 0 : 1)},${oldCount} +${head.b + (newCount === 0 ? 0 : 1)},${newCount} @@`,
    );
    for (const op of hunk) lines.push(`${op.kind}${op.text}`);
  }
  return lines.join('\n');
}

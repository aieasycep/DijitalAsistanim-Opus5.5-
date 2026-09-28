/**
 * Markup removal for model text (`guardOutputText`), as linear scans. Regex replaces such as
 * `/<[^>]*>/g` rescan to the next `>` from every `<` (O(n²) on "<<<<…") and, being a single pass,
 * can reassemble what they removed (`<scr<script>ipt>`, CodeQL
 * js/incomplete-multi-character-sanitization). Internal to `grounding` (not re-exported).
 */

/** A character after `<` that makes the HTML tokenizer open a tag, end tag, comment or PI. */
const TAG_OPEN_NEXT = /[A-Za-z!/?]/;

/**
 * `<…>` tags removed with the semantics of `replace(/<[^>]*>/g, '')`, as one linear scan (a tag
 * runs from a `<` to the next `>`, so nesting such as `<scr<script>ipt>` leaves `ipt>`).
 */
export function removeTags(s: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const lt = s.indexOf('<', i);
    if (lt === -1) break;
    const gt = s.indexOf('>', lt + 1);
    if (gt === -1) break;
    out += s.slice(i, lt);
    i = gt + 1;
  }
  return out + s.slice(i);
}

/**
 * Drops every `<` that would open a tag, end tag, comment or processing instruction in the
 * result (`<script`, `</`, `<!`, `<?`, also through runs such as `<<a`); a plain `<` ("5 < 10")
 * stays. Scans right to left so the character after each kept `<` is final.
 */
export function dropTagOpeners(s: string): string {
  const kept: string[] = [];
  let next = '';
  for (let j = s.length - 1; j >= 0; j -= 1) {
    const c = s.charAt(j);
    if (c === '<' && TAG_OPEN_NEXT.test(next)) continue;
    kept.push(c);
    next = c;
  }
  return kept.reverse().join('');
}

/**
 * Markdown links `[text](target)` → `text`, with the semantics of
 * `replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')` in one pass: that regex rescans to the next `]` or `)`
 * from every `[`, O(n²) on "[[[[…" or "[a]([a](…" without a closing `)`.
 */
export function unlinkMarkdown(s: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const open = s.indexOf('[', i);
    if (open === -1) break;
    const close = s.indexOf(']', open + 1);
    if (close === -1) break;
    if (s.charAt(close + 1) !== '(') {
      // Every `[` before `close` reaches the same `]`: none of them starts a link.
      out += s.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    const end = s.indexOf(')', close + 2);
    if (end === -1) break;
    out += s.slice(i, open) + s.slice(open + 1, close);
    i = end + 1;
  }
  return out + s.slice(i);
}

/**
 * Plain text for display: tags, markdown links and markers removed. The last step leaves no `<`
 * that could open a tag, however the earlier removals joined the text (`<[script](x)` → `script`).
 */
export function stripMarkup(s: string): string {
  const text = unlinkMarkdown(removeTags(s))
    .replace(/[*_`#>~]+/g, '')
    .replace(/\s+/g, ' ');
  return dropTagOpeners(text).trim();
}

/**
 * "Orijinal Mail" (M-MAIL-03) as plain text plus its links. The server already sanitises the body
 * (`supabase/functions/_shared/security/html-sanitize.ts`: allow-listed tags only, scripts and
 * styles dropped, text entity-escaped, links rewritten to `da-link:` with the target in
 * `data-href`); the app never renders it as HTML, only as text, and opens links through the
 * phishing-safe link sheet.
 *
 * This is a one-pass tokenizer, not regex removal of tags: every `<` that opens a tag is consumed
 * as markup up to its `>` (an unterminated tag at the end is dropped), so nested payloads such as
 * `<scr<script>ipt>` never reassemble into text that looks like a tag (a `<` left in the text
 * never opens one either); the contents of `script`, `style` and similar elements are skipped;
 * entities are decoded once, after tokenizing. Linear in the length of the body.
 */

export interface OriginalLink {
  readonly href: string;
  readonly text: string;
}

export interface OriginalText {
  readonly text: string;
  readonly links: readonly OriginalLink[];
}

/** A character after `<` that makes it markup (tag, end tag, comment, doctype, PI). */
const TAG_START = /[A-Za-z/!?]/;
const TAG_NAME = /^\/?([A-Za-z][A-Za-z0-9-]*)/;
const ATTRIBUTE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
/** `<br>` and the ends of these blocks become line breaks. */
const BREAK_BEFORE = new Set(['br']);
const BREAK_AFTER = new Set(['p', 'pre', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
/** Elements whose content is never text (the server removes them; this is defence in depth). */
const SKIP_CONTENT: ReadonlyMap<string, RegExp> = new Map(
  [
    'script',
    'style',
    'template',
    'noscript',
    'iframe',
    'object',
    'svg',
    'math',
    'head',
    'title',
    'textarea',
  ].map((name) => [name, new RegExp(`</${name}(?![A-Za-z0-9-])`, 'gi')]),
);
const ENTITIES: Readonly<Record<string, string>> = {
  nbsp: ' ',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  amp: '&',
};

/** Decodes the entities the sanitiser emits, each exactly once (`&amp;lt;` → `&lt;`). */
export function decodeEntities(text: string): string {
  return text.replace(/&(nbsp|lt|gt|quot|#39|amp);/g, (whole, name: string) => {
    return ENTITIES[name] ?? whole;
  });
}

/**
 * Drops each `<` that the text around removed markup turned into a tag opener (`<` + `<script>…`
 * + `/x` → `</x`). Runs before entity decoding, so an escaped `&lt;b&gt;` in the mail stays text;
 * right to left, so the character after each kept `<` is final.
 */
function dropTagOpeners(text: string): string {
  const kept: string[] = [];
  let next = '';
  for (let j = text.length - 1; j >= 0; j -= 1) {
    const c = text.charAt(j);
    if (c === '<' && TAG_START.test(next)) continue;
    kept.push(c);
    next = c;
  }
  return kept.reverse().join('');
}

/** The link target of an `<a …>` tag: `data-href` (the sanitiser's real target), else `href`. */
function hrefOf(tag: string): string {
  let href = '';
  let dataHref = '';
  for (const m of tag.matchAll(ATTRIBUTE)) {
    const name = (m[1] ?? '').toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    if (name === 'href') href = value;
    else if (name === 'data-href') dataHref = value;
  }
  return decodeEntities(dataHref !== '' ? dataHref : href).trim();
}

/** Index after the end tag matched by `endTag` at or after `from`, or the end of the body. */
function afterEndTag(content: string, endTag: RegExp, from: number): number {
  endTag.lastIndex = from;
  const found = endTag.exec(content);
  if (found === null) return content.length;
  const gt = content.indexOf('>', found.index);
  return gt === -1 ? content.length : gt + 1;
}

/** Sanitised HTML → readable text plus its links (rendered separately, never auto-linked). */
export function originalToText(format: 'html_sanitized' | 'text', content: string): OriginalText {
  if (format === 'text') return { text: content, links: [] };
  const parts: string[] = [];
  const links: OriginalLink[] = [];
  let link: { href: string; parts: string[] } | null = null;
  const text = (value: string): void => {
    parts.push(value);
    link?.parts.push(value);
  };
  const closeLink = (): void => {
    if (link === null) return;
    const label = decodeEntities(dropTagOpeners(link.parts.join(''))).trim();
    if (link.href !== '') links.push({ href: link.href, text: label === '' ? link.href : label });
    link = null;
  };

  let i = 0;
  while (i < content.length) {
    const lt = content.indexOf('<', i);
    if (lt === -1) {
      text(content.slice(i));
      break;
    }
    if (!TAG_START.test(content.charAt(lt + 1))) {
      text(content.slice(i, lt + 1));
      i = lt + 1;
      continue;
    }
    text(content.slice(i, lt));
    if (content.startsWith('<!--', lt)) {
      const end = content.indexOf('-->', lt + 4);
      i = end === -1 ? content.length : end + 3;
      continue;
    }
    const gt = content.indexOf('>', lt + 1);
    if (gt === -1) break;
    const tag = content.slice(lt + 1, gt);
    i = gt + 1;
    const name = TAG_NAME.exec(tag)?.[1]?.toLowerCase();
    if (name === undefined) continue;
    if (tag.startsWith('/')) {
      if (BREAK_AFTER.has(name)) parts.push('\n');
      if (name === 'a') closeLink();
    } else if (name === 'a') {
      closeLink();
      link = { href: hrefOf(tag.slice(1)), parts: [] };
    } else {
      const endTag = SKIP_CONTENT.get(name);
      if (endTag === undefined) {
        if (BREAK_BEFORE.has(name)) parts.push('\n');
      } else if (!tag.endsWith('/')) {
        i = afterEndTag(content, endTag, i);
      }
    }
  }
  return {
    text: decodeEntities(dropTagOpeners(parts.join('')))
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    links,
  };
}

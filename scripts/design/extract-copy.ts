/**
 * Collects visible Turkish UI strings per PRIMARY canvas (template text nodes and data-script string
 * literals) into design/copy/primary-copy.tsv. The TSV seeds the i18n catalogs; it is reference data,
 * not runtime copy.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, dataScript, primaryCanvases, readCanvas, template } from './lib.ts';

const TR_LETTER = /[A-Za-zÇĞİÖŞÜçğıöşü]/;
const ICON_LIKE = /^[a-z0-9_]+$/;

const ENTITIES: Readonly<Record<string, string>> = { nbsp: ' ', amp: '&', lt: '<', gt: '>' };

/**
 * `&nbsp;` `&amp;` `&lt;` `&gt;` decoded in a single pass: each entity is read once, so `&amp;lt;`
 * becomes `&lt;` (chained replaces decoded `&amp;` first and then the `&lt;` it produced).
 */
export function decodeEntities(s: string): string {
  return s.replace(/&(nbsp|amp|lt|gt);/g, (whole, name: string) => ENTITIES[name] ?? whole);
}

function clean(s: string): string {
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

const STYLE_OPEN = '<style';
const STYLE_CLOSE = '</style>';

/** One pass: each `<style` through the next `</style>` removed; an unclosed one runs to the end. */
function removeStyleBlocksOnce(html: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const open = html.indexOf(STYLE_OPEN, i);
    if (open === -1) return out + html.slice(i);
    out += html.slice(i, open);
    const close = html.indexOf(STYLE_CLOSE, open + STYLE_OPEN.length);
    if (close === -1) return out;
    i = close + STYLE_CLOSE.length;
  }
}

/**
 * The template without style blocks. Removal repeats until nothing changes, so a block that the
 * removal itself assembles (`<sty<style></style>le>…</style>`) goes too and no `<style` is left.
 */
export function withoutStyleBlocks(html: string): string {
  let text = html;
  for (;;) {
    const next = removeStyleBlocksOnce(text);
    if (next === text) return text;
    text = next;
  }
}

export function extractCopy(): [string, string, string][] {
  const rows: [string, string, string][] = [];
  const seen = new Set<string>();
  for (const file of primaryCanvases()) {
    const html = readCanvas(file);
    const tpl = withoutStyleBlocks(template(html));
    for (const m of tpl.matchAll(/>([^<>{}]+)</g)) {
      const text = clean(m[1] ?? '');
      if (text.length < 2 || !TR_LETTER.test(text) || ICON_LIKE.test(text)) continue;
      const key = `${file}\u0000${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push([file, 'template', text]);
    }
    for (const m of dataScript(html).matchAll(/(['"])((?:(?!\1)[^\\\n]|\\.){2,})\1/g)) {
      const text = clean((m[2] ?? '').replace(/\\(['"])/g, '$1'));
      if (!/\s/.test(text) || !TR_LETTER.test(text) || /[{};=]|px|rgba|#[0-9A-Fa-f]{3}/.test(text))
        continue;
      const key = `${file}\u0000${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push([file, 'data', text]);
    }
  }
  return rows;
}

if (import.meta.main) {
  const rows = extractCopy();
  const out = join(ROOT, 'design', 'copy', 'primary-copy.tsv');
  writeFileSync(out, ['canvas\tsource\ttext', ...rows.map((r) => r.join('\t'))].join('\n') + '\n');
  console.info(`wrote ${rows.length} strings to ${out}`);
}

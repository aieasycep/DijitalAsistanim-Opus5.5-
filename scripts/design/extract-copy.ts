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

function clean(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractCopy(): [string, string, string][] {
  const rows: [string, string, string][] = [];
  const seen = new Set<string>();
  for (const file of primaryCanvases()) {
    const html = readCanvas(file);
    const tpl = template(html).replace(/<style[\s\S]*?<\/style>/g, '');
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

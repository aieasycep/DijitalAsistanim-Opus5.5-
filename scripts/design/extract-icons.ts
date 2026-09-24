/** Collects every Material Symbols name used by the PRIMARY canvases into design/icons/used-icons.txt. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, constLiteral, dataScript, primaryCanvases, readCanvas } from './lib.ts';

const STATIC_SPAN = /Material Symbols Rounded[^>]*>([a-z0-9_]+)</g;
const ICON_KEY = /\b(?:icon|ic|i)\s*:\s*['"]([a-z0-9_]+)['"]/g;

export function extractIcons(): string[] {
  const names = new Set<string>();
  for (const file of primaryCanvases()) {
    const html = readCanvas(file);
    for (const m of html.matchAll(STATIC_SPAN)) if (m[1]) names.add(m[1]);
    for (const m of dataScript(html).matchAll(ICON_KEY)) if (m[1]) names.add(m[1]);
  }
  const system = dataScript(readCanvas('01 Tasarim Sistemi.dc.html'));
  for (const [name] of constLiteral(system, 'ICONS') as [string, string][]) names.add(name);
  return [...names].filter((n) => /^[a-z][a-z0-9_]*$/.test(n)).sort();
}

if (import.meta.main) {
  const icons = extractIcons();
  const out = join(ROOT, 'design', 'icons', 'used-icons.txt');
  writeFileSync(out, icons.join('\n') + '\n');
  console.info(`wrote ${icons.length} icon names to ${out}`);
}

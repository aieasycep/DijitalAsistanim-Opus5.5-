import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PRIMARY_DIR = join(ROOT, 'design', 'reference', 'primary');

export function primaryCanvases(): string[] {
  return readdirSync(PRIMARY_DIR)
    .filter((f) => f.endsWith('.dc.html'))
    .sort();
}

export function readCanvas(name: string): string {
  return readFileSync(join(PRIMARY_DIR, name), 'utf8');
}

/** The data script at the end of a design canvas (`<script type="text/x-dc" data-dc-script>`). */
export function dataScript(html: string): string {
  const m = /<script type="text\/x-dc" data-dc-script>([\s\S]*?)<\/script>/.exec(html);
  return m?.[1] ?? '';
}

/** The template between <x-dc> and </x-dc>. */
export function template(html: string): string {
  const start = html.indexOf('<x-dc>');
  const end = html.lastIndexOf('</x-dc>');
  return start >= 0 && end > start ? html.slice(start + 6, end) : '';
}

/**
 * Evaluates a top-level `const NAME=[...]` literal from a design data script in an empty VM
 * context. The canvases are trusted design inputs from the repository owner.
 */
export function constLiteral(script: string, name: string): unknown {
  const start = script.indexOf(`const ${name}=`);
  if (start < 0) throw new Error(`const ${name} not found`);
  const i = script.indexOf('[', start);
  let depth = 0;
  let quote: string | null = null;
  for (let j = i; j < script.length; j++) {
    const ch = script[j];
    if (quote) {
      if (ch === '\\') j++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        const literal = script.slice(i, j + 1);
        return vm.runInNewContext(`(${literal})`, vm.createContext({}), {
          timeout: 1000,
        }) as unknown;
      }
    }
  }
  throw new Error(`unterminated literal for ${name}`);
}

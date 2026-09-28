/**
 * The gate's shared lists: `banned-markers.txt` (markers + unfinished-feature copy + banned claims;
 * also read by `packages/i18n/scripts/check-catalogs.ts` and `apps/web/e2e/helpers.ts`),
 * `retired-names.txt` (QG-27) and `quality-gate.allow`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

function regexList(file: string): RegExp[] {
  return readFileSync(join(GATE_DIR, file), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
    .map((l) => new RegExp(l, 'iu'));
}

let banned: RegExp[] | null = null;
let retired: RegExp[] | null = null;

export function bannedList(): RegExp[] {
  banned ??= regexList('banned-markers.txt');
  return banned;
}

export function retiredList(): RegExp[] {
  retired ??= regexList('retired-names.txt');
  return retired;
}

interface AllowEntry {
  readonly path: string;
  readonly line: string;
}

let allowEntries: AllowEntry[] | null = null;

/**
 * `quality-gate.allow`: `<path-substring> | <line-substring> | <justification>`. New entries are
 * accepted only for negated fair-use copy (QG-06b, §5.4); every entry needs a justification.
 */
export function allowList(): AllowEntry[] {
  allowEntries ??= readFileSync(join(GATE_DIR, 'quality-gate.allow'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'))
    .map((l) => {
      const [path = '', line = '', why = ''] = l.split('|').map((s) => s.trim());
      if (why === '') throw new Error(`quality-gate.allow entry without justification: ${l}`);
      return { path, line };
    });
  return allowEntries;
}

export function allowed(file: string, raw: string): boolean {
  return allowList().some((a) => file.includes(a.path) && raw.includes(a.line));
}

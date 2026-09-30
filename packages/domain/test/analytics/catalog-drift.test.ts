/**
 * Drift guard for the analytics allow-list (R-21): every event named in SCREEN_AND_FLOW_MAP
 * ("Analytics events" fields, the Part 4 §15 and A-35 allow-list tables, the web event table) and
 * in API_CONTRACTS §17.1 must be in `ANALYTICS_EVENTS` (or be a documented alias), and every
 * catalogue event must still be documented. Documented names that contain a retired canonical name
 * (QG-27, `scripts/quality-gate/retired-names.txt`) cannot appear in code; the catalogue carries
 * them under the replacement names listed in `QG27_REPLACEMENTS`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ANALYTICS_EVENT_ALIASES, ANALYTICS_EVENTS } from '../../src/analytics/events.ts';

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../../${rel}`, import.meta.url)), 'utf8');
}

function doc(name: string): string[] {
  return repoFile(`docs/${name}`).split('\n');
}

const RETIRED: readonly RegExp[] = repoFile('scripts/quality-gate/retired-names.txt')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l !== '' && !l.startsWith('#'))
  .map((l) => new RegExp(l));
const isRetired = (n: string): boolean => RETIRED.some((re) => re.test(n));

/** Catalogue names that replace screen-map names blocked by QG-27 (M-ANI-01 access CTA). */
const QG27_REPLACEMENTS: readonly string[] = ['android_ni_access_opened'];

/** Backticked tokens in analytics fields that are prop names or values, not events. */
const NON_EVENT_TOKENS = new Set([
  'toggle',
  'data_source_toggles',
  'mode',
  'state_id',
  'had_store_subscription',
  'login_method',
  'kind',
  'preset',
  'tone',
  'origin',
]);

const EVENT_SPAN = /^([a-z][a-z0-9_]{2,63})\s*(\{(.*)\})?\s*$/s;

function analyticsFields(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i] ?? '';
    const s = line.trim();
    const isField =
      line.includes('**Analytics events') ||
      s.startsWith('| Analytics events') ||
      s.startsWith('| Analytics |');
    if (!isField) {
      i += 1;
      continue;
    }
    if (s.startsWith('|')) {
      out.push(line);
      i += 1;
      continue;
    }
    const buf = [line];
    let j = i + 1;
    while (j < lines.length) {
      const t = (lines[j] ?? '').trim();
      if (
        t.startsWith('- **') ||
        /^\*\*[A-Z]/.test(t) ||
        t.startsWith('#') ||
        t === '---' ||
        t.startsWith('|')
      )
        break;
      buf.push(lines[j] ?? '');
      j += 1;
    }
    out.push(buf.join('\n'));
    i = j;
  }
  for (const marker of [
    '## 15. Analytics events of this part',
    '**A-35 analytics allow-list',
    '**Payload** (`WebEventInput`)',
  ]) {
    const k = lines.findIndex((l) => l.startsWith(marker));
    if (k < 0) continue;
    for (let j = k + 1; j < lines.length; j += 1) {
      const l = lines[j] ?? '';
      if (l.trim() !== '' && l.startsWith('#')) break;
      if (l.startsWith('| ')) out.push(l);
      if (l.startsWith('**Merges') || l.startsWith('No event carries')) break;
    }
  }
  return out;
}

function cells(row: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let tick = false;
  for (const ch of row.trim()) {
    if (ch === '`') tick = !tick;
    if (ch === '|' && !tick) {
      cols.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cols.push(cur);
  return cols;
}

function screenMapEvents(): Set<string> {
  const names = new Set<string>();
  for (const text of analyticsFields(doc('SCREEN_AND_FLOW_MAP.md'))) {
    const web = /^\|\s*`(web_[a-z_]+)`\s*\|/.exec(text.trim());
    if (web?.[1]) {
      names.add(web[1]);
      continue;
    }
    let scan = text;
    if (text.trim().startsWith('|')) scan = (cells(text)[2] ?? '').replace(/\([^()]*\)/g, '');
    for (const m of scan.matchAll(/`([^`]+)`/g)) {
      const name = EVENT_SPAN.exec((m[1] ?? '').trim().replaceAll('\\|', '|'))?.[1];
      if (name) names.add(name);
    }
  }
  return names;
}

function backendEvents(): Set<string> {
  const names = new Set<string>();
  let inside = false;
  for (const line of doc('API_CONTRACTS.md')) {
    if (line.startsWith('### 17.1 Backend analytics events')) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    if (line.startsWith('---')) break;
    if (!line.startsWith('| `')) continue;
    const first = line.trim().replace(/^\|/, '').split('|')[0] ?? '';
    for (const m of first.matchAll(/`([a-z_]+)`/g)) if (m[1]) names.add(m[1]);
  }
  return names;
}

const documented = new Set([...screenMapEvents(), ...backendEvents()]);
const isCatalogued = (n: string): boolean =>
  Object.prototype.hasOwnProperty.call(ANALYTICS_EVENTS, n) ||
  Object.prototype.hasOwnProperty.call(ANALYTICS_EVENT_ALIASES, n);
const isIgnorable = (n: string): boolean =>
  NON_EVENT_TOKENS.has(n) || n.startsWith('web_analytics');

describe('analytics catalogue drift (R-21)', () => {
  it('extracts the documented events', () => {
    expect(documented.size).toBeGreaterThanOrEqual(390);
    expect(backendEvents().size).toBeGreaterThanOrEqual(10);
  });

  it('every documented event is catalogued or aliased', () => {
    const missing = [...documented]
      .filter((n) => !isCatalogued(n) && !isIgnorable(n) && !isRetired(n))
      .sort();
    expect(missing).toEqual([]);
  });

  it('every catalogued event is still documented', () => {
    const stale = Object.keys(ANALYTICS_EVENTS)
      .filter((n) => !documented.has(n) && !QG27_REPLACEMENTS.includes(n))
      .sort();
    expect(stale).toEqual([]);
  });

  it('QG-27: no catalogue name is retired; each blocked documented name has a replacement', () => {
    expect(Object.keys(ANALYTICS_EVENTS).filter(isRetired)).toEqual([]);
    expect(Object.keys(ANALYTICS_EVENT_ALIASES).filter(isRetired)).toEqual([]);
    const blocked = [...documented].filter(isRetired);
    expect(blocked).toHaveLength(QG27_REPLACEMENTS.length);
    for (const n of QG27_REPLACEMENTS)
      expect(Object.prototype.hasOwnProperty.call(ANALYTICS_EVENTS, n), n).toBe(true);
  });

  it('every alias is a name used in the plans (screen map, API, DB, security)', () => {
    const plans = [
      'SCREEN_AND_FLOW_MAP.md',
      'API_CONTRACTS.md',
      'DATABASE_AND_RLS_PLAN.md',
      'SECURITY_AND_PRIVACY_PLAN.md',
    ]
      .map((n) => doc(n).join('\n'))
      .join('\n');
    for (const alias of Object.keys(ANALYTICS_EVENT_ALIASES)) {
      expect(new RegExp(`\`${alias}(?:\\s*\\{[^}\`]*\\})?\``).test(plans), alias).toBe(true);
    }
  });
});

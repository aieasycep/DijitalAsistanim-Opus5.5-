import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { REQUIRED_VERBATIM, checkCatalogs } from '../scripts/check-catalogs.ts';
import { LOCALES, NAMESPACES, loadMessages, loadNamespaces, lookupMessage } from '../src/index.ts';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const BANNED = fileURLToPath(
  new URL('../../../scripts/quality-gate/banned-markers.txt', import.meta.url),
);

function keysOf(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    keysOf(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

describe('catalogs', () => {
  it('pass every check-catalogs rule', () => {
    const report = checkCatalogs();
    expect(report.findings).toEqual([]);
    expect(Object.keys(report.counts)).toEqual([...NAMESPACES]);
    for (const namespace of NAMESPACES)
      expect(report.counts[namespace], namespace).toBeGreaterThan(0);
  });

  it('tr and en have identical key sets', () => {
    const tr = keysOf(loadMessages('tr')).sort();
    const en = keysOf(loadMessages('en')).sort();
    expect(en).toEqual(tr);
    expect(tr.length).toBeGreaterThan(2000);
  });

  it('contain every verbatim string the plan requires', () => {
    const tr = loadMessages('tr');
    for (const [key, value] of Object.entries(REQUIRED_VERBATIM))
      expect(lookupMessage(tr, key), key).toBe(value);
  });

  it('has an errors.<code_lower> message for every API error code', () => {
    const codes = [
      'AUTH_REQUIRED',
      'FORBIDDEN',
      'ENTITLEMENT_REQUIRED',
      'EXTERNAL_CREDENTIAL_REQUIRED',
      'PROVIDER_REAUTH_REQUIRED',
      'PROVIDER_SCOPE_MISSING',
      'RATE_LIMITED',
      'QUOTA_EXCEEDED',
      'VALIDATION_FAILED',
      'APPROVAL_STATE_CONFLICT',
      'IDEMPOTENCY_REPLAY',
      'NOT_FOUND',
      'AI_UNAVAILABLE',
      'OFFLINE_BLOCKED',
      'INTERNAL',
    ];
    for (const locale of LOCALES) {
      const messages = loadMessages(locale);
      for (const code of codes) {
        expect(
          lookupMessage(messages, `errors.${code.toLowerCase()}`),
          `${locale} ${code}`,
        ).toMatch(/\S/);
      }
    }
  });

  it('loads a subset of namespaces', () => {
    const subset = loadNamespaces('en', ['common', 'states']);
    expect(Object.keys(subset)).toEqual(['common', 'states']);
    expect(subset.common.actions.approve).toBe('Approve');
  });

  it('lookupMessage returns undefined for objects and unknown keys', () => {
    const tr = loadMessages('tr');
    expect(lookupMessage(tr, 'common.actions')).toBeUndefined();
    expect(lookupMessage(tr, 'common.nope.missing')).toBeUndefined();
    expect(lookupMessage(tr, 'toString')).toBeUndefined();
  });
});

describe('check-catalogs detects problems', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function withMutatedEnglish(mutate: (common: Record<string, Record<string, string>>) => void) {
    dir = mkdtempSync(join(tmpdir(), 'da-i18n-'));
    cpSync(join(PACKAGE_DIR, 'messages'), join(dir, 'messages'), { recursive: true });
    const file = join(dir, 'messages', 'en', 'common.json');
    const common = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, string>>;
    mutate(common);
    writeFileSync(file, JSON.stringify(common));
    return checkCatalogs({ packageDir: dir, bannedMarkersFile: BANNED }).findings.map(
      (f) => f.rule,
    );
  }

  it('reports parity, argument, syntax, quote, marker and claim problems', () => {
    const rules = withMutatedEnglish((common) => {
      const actions = common.actions ?? {};
      const toast = common.toast ?? {};
      delete actions.reject;
      actions.approve = 'Approve {thing}';
      actions.edit = "Don'{t}";
      actions.undo = 'Undo {broken';
      toast.saved = ['Un', 'limited saves'].join('');
      toast.sent = ['Arrives', 'coming', 'soon'].join(' ');
      toast.copied = 'Copied {time_loc}';
    });
    expect(rules).toEqual(
      expect.arrayContaining([
        'parity',
        'placeholders',
        'icu-quote',
        'icu-syntax',
        'fair-use-claim',
        'banned-marker',
        'en-case-variant',
      ]),
    );
  });

  it('is clean on an unmodified copy', () => {
    expect(withMutatedEnglish(() => undefined)).toEqual([]);
  });
});

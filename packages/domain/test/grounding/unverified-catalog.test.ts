/**
 * Drift guard for the "Kaynakta kesinleşmiyor." family (AI_PIPELINE_PLAN §6.6, TEST_PLAN IT-AI-03):
 * every key `unverifiedMessage` can return must exist in the tr and en `explain` catalogs of
 * `@da/i18n`, so a dropped field never renders a missing key.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type FieldKind, unverifiedMessage } from '../../src/grounding/verify.ts';

const LOCALES = ['tr', 'en'] as const;
const KINDS: readonly FieldKind[] = ['date', 'amount', 'flight', 'pnr', 'tracking', 'text'];
/** Field names from the verifier call sites plus one per `unverifiedMessage` branch. */
const FIELDS: readonly string[] = [
  'due_at',
  'due',
  'deadline',
  'start_date',
  'end_date',
  'fire_at',
  'amount',
  'total_amount',
  'start_time',
  'end_time',
  'counterparty',
  'person',
  'contact',
  'venue',
  'location',
  'flight_no',
  'what',
  'title',
];
const EXPECTED_KEYS = [
  'explain.unverified.amount',
  'explain.unverified.due_at',
  'explain.unverified.generic',
  'explain.unverified.person',
  'explain.unverified.time',
];

function catalog(locale: string, namespace: string): unknown {
  const path = fileURLToPath(
    new URL(`../../../i18n/messages/${locale}/${namespace}.json`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, 'utf8'));
}

function lookup(locale: string, key: string): unknown {
  const [namespace = '', ...path] = key.split('.');
  return path.reduce<unknown>(
    (node, segment) =>
      typeof node === 'object' && node !== null && Object.hasOwn(node, segment)
        ? (node as Record<string, unknown>)[segment]
        : undefined,
    catalog(locale, namespace),
  );
}

const returnedKeys = [
  ...new Set(KINDS.flatMap((kind) => FIELDS.map((field) => unverifiedMessage(field, kind).key))),
].sort();

describe('unverifiedMessage catalog keys', () => {
  it('reaches every branch of unverifiedMessage', () => {
    expect(returnedKeys).toEqual(EXPECTED_KEYS);
  });

  it.each(LOCALES)('every returned key is a message in the %s catalog', (locale) => {
    for (const key of returnedKeys) {
      const message = lookup(locale, key);
      expect(typeof message, `${locale} ${key}`).toBe('string');
      expect(message, `${locale} ${key}`).toMatch(/\S/);
    }
  });

  it('keeps the product copy for the generic case', () => {
    expect(lookup('tr', 'explain.unverified.generic')).toBe('Kaynakta kesinleşmiyor.');
  });
});

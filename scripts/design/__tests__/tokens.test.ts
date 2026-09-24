import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../lib.ts';

interface Tokens {
  colors: Record<string, { value: string; on: string }>;
  dark: Record<string, string>;
  typography: Record<string, { fontSize: string; lineHeight: string; fontWeight: number }>;
  space: number[];
  radius: Record<string, number>;
}

const tokens = JSON.parse(
  readFileSync(join(ROOT, 'design', 'tokens', 'primary-tokens.json'), 'utf8'),
) as Tokens;

test('light colours match the design system (MASTER_PLAN §2)', () => {
  const expected: Record<string, string> = {
    'brand/primary': '#5B5CE2',
    'brand/primary-pressed': '#4B4CCB',
    'brand/soft': '#EDEDFC',
    'brand/text-on-soft': '#4547C9',
    critical: '#E0553F',
    'critical/text': '#C7432F',
    'warning/text': '#9A6300',
    'success/text': '#1E7A47',
    'neutral/bg': '#F5F4F0',
    'neutral/surface-2': '#F0EFEB',
    ink: '#1A1917',
    'ink/secondary': '#6B6860',
    'ink/tertiary': '#9B978E',
    'editorial/paper': '#FBFAF7',
  };
  for (const [name, hex] of Object.entries(expected))
    assert.equal(tokens.colors[name]?.value, hex, name);
  // info text is the design's `on` colour of info/soft (no separate COLORS row).
  assert.equal(tokens.colors['info/soft']?.on, '#2262BE');
});

test('dark palette matches', () => {
  assert.equal(tokens.dark.bg, '#141311');
  assert.equal(tokens.dark.surface, '#1F1E1B');
  assert.equal(tokens.dark.text, '#F2F0EB');
  assert.equal(tokens.dark.primary, '#8586F2');
  assert.equal(tokens.dark['on-primary'], '#0F0F2A');
});

test('type scale and spacing', () => {
  assert.equal(tokens.typography.display?.fontSize, '34px');
  assert.equal(tokens.typography.h1?.lineHeight, '34px');
  assert.equal(tokens.typography.body?.fontWeight, 400);
  assert.deepEqual(tokens.space, [4, 8, 12, 16, 20, 24, 32, 40]);
  assert.equal(Object.values(tokens.radius).includes(28), true);
});

test('icon list is non-empty and includes the tab icons', () => {
  const icons = readFileSync(join(ROOT, 'design', 'icons', 'used-icons.txt'), 'utf8')
    .trim()
    .split('\n');
  for (const tab of ['sunny', 'dynamic_feed', 'calendar_today', 'auto_awesome'])
    assert.ok(icons.includes(tab), tab);
  assert.ok(icons.length > 100);
});

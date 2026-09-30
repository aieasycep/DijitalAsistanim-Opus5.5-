import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BACKOFFICE_ICONS, render } from '../gen-icons';

const DATA = fileURLToPath(new URL('../../../../packages/ui/icons.data.json', import.meta.url));
const GENERATED = fileURLToPath(new URL('../../src/generated/icons.ts', import.meta.url));

describe('backoffice icon codegen', () => {
  it('committed glyphs match packages/ui/icons.data.json', () => {
    const data = JSON.parse(readFileSync(DATA, 'utf8')) as Parameters<typeof render>[0];
    expect(readFileSync(GENERATED, 'utf8')).toBe(render(data));
  });

  it('covers the DESIGN_AUDIT §2.12.2 backoffice navigation icons', () => {
    for (const name of [
      'space_dashboard',
      'group',
      'support_agent',
      'hub',
      'sync_alt',
      'history_edu',
      'monitor_heart',
    ]) {
      expect(BACKOFFICE_ICONS).toContain(name);
    }
  });

  it('fails loudly when a glyph is missing upstream', () => {
    expect(() => render({ version: 'x', icons: {} })).toThrow(/missing/);
  });
});

import { describe, expect, it } from 'vitest';
import {
  APPROVAL_STATUS_VALUES,
  DB_ENUMS,
  NOTIFICATION_DETAIL_VALUES,
  PROVIDER_VALUES,
} from '../src/enums.ts';

describe('canonical enums', () => {
  it('every enum is non-empty and has unique snake_case values', () => {
    for (const [name, values] of Object.entries(DB_ENUMS)) {
      expect(values.length, name).toBeGreaterThan(0);
      expect(new Set(values).size, name).toBe(values.length);
      for (const v of values) expect(v, `${name}.${v}`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('matches the spine state machine and privacy defaults', () => {
    expect(APPROVAL_STATUS_VALUES).toEqual([
      'pending',
      'approved',
      'rejected',
      'executing',
      'executed',
      'failed',
      'expired',
    ]);
    expect(NOTIFICATION_DETAIL_VALUES).toEqual(['full', 'title_only', 'generic']);
    expect(PROVIDER_VALUES).toContain('demo');
  });
});

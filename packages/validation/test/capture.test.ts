import { describe, expect, it } from 'vitest';
import { CaptureActionsBody } from '../src/api/capture.ts';

describe('CaptureActionsBody (API-CAP-04)', () => {
  it('accepts an item without a destination (the action type default applies)', () => {
    const parsed = CaptureActionsBody.parse({
      items: [{ item_id: 'e1', action_type: 'calendar_create' }],
    });
    expect(parsed.items[0]?.destination).toBeUndefined();
    expect(parsed.save_to_memory).toBe(false);
  });

  it('still carries an explicit destination through for per-type parsing', () => {
    const destination = { kind: 'in_app' };
    const parsed = CaptureActionsBody.parse({
      items: [{ item_id: 't1', action_type: 'task_create', destination }],
    });
    expect(parsed.items[0]?.destination).toEqual(destination);
  });

  it('rejects an empty request', () => {
    expect(CaptureActionsBody.safeParse({ items: [] }).success).toBe(false);
  });
});

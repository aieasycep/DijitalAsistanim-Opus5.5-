/**
 * Entity routing of insights and sources (SCREEN_AND_FLOW_MAP route table; "Bu nereden çıktı?" →
 * "Orijinalini aç"): every entity type opens its own detail route, unknown entities fall back to
 * the plan, and sources without a detail screen return null.
 */
import { describe, expect, it } from 'vitest';

import { routeForInsight, routeForSource } from '../src/deeplinks.ts';

const ID = '00000000-0000-4000-8000-000000000042';
const INSIGHT_ID = '00000000-0000-4000-8000-000000000001';

describe('routeForInsight: reply_needed / deadline route by entity type', () => {
  it.each([
    ['email_thread', `/mail/${ID}`],
    ['email_message', `/mail/${ID}`],
    ['calendar_event', `/event/${ID}`],
    ['life_event', `/life/${ID}`],
    ['commitment', `/commitments/${ID}`],
    ['capture', `/capture/${ID}`],
    ['approval_action', `/approvals/${ID}`],
    ['contact', `/person/${ID}`],
    ['briefing', `/briefing/${ID}`],
    ['unknown_entity', '/plan'],
  ])('%s → %s', (entityType, route) => {
    for (const kind of ['reply_needed', 'deadline'] as const) {
      expect(
        routeForInsight({ id: INSIGHT_ID, kind, entity_type: entityType, entity_id: ID }),
      ).toBe(route);
    }
  });
});

describe('routeForSource', () => {
  it.each([
    ['email_message', `/mail/${ID}`],
    ['email_thread', `/mail/${ID}`],
    ['calendar_event', `/event/${ID}`],
    ['device_calendar_event', `/event/${ID}`],
    ['capture', `/capture/${ID}`],
    ['commitment', `/commitments/${ID}`],
    ['life_event', `/life/${ID}`],
    ['contact', `/person/${ID}`],
    ['briefing', `/briefing/${ID}`],
  ] as const)('%s opens %s', (sourceType, route) => {
    expect(routeForSource(sourceType, ID)).toBe(route);
  });

  it.each([
    'meeting_note',
    'post_meeting_note',
    'task',
    'android_notification',
    'assistant_message',
    'user_input',
    'ai_feedback',
  ] as const)('%s has no detail screen', (sourceType) => {
    expect(routeForSource(sourceType, ID)).toBeNull();
  });

  it('rejects a source id that is not a UUID', () => {
    expect(routeForSource('email_message', '../settings')).toBeNull();
  });
});

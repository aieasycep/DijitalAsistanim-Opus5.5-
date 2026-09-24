import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_EVENT_ALIASES,
  ANALYTICS_EVENTS,
  type AnalyticsEventName,
  type AnalyticsPropSpec,
  type AnalyticsProps,
} from '../../src/analytics/events.ts';
import {
  ANALYTICS_EVENT_NAME_RE,
  BANNED_PROP_NAMES,
  isAnalyticsEventName,
  isValidPropValue,
  resolveAnalyticsEventName,
  validateAnalyticsEvent,
} from '../../src/analytics/validate.ts';

const names = Object.keys(ANALYTICS_EVENTS) as AnalyticsEventName[];

describe('catalogue rules (SECURITY_AND_PRIVACY_PLAN §4.9)', () => {
  it('has the full screen-map + backend catalogue', () => {
    expect(names.length).toBeGreaterThanOrEqual(390);
  });

  it('every name matches the analytics_events.event_name check', () => {
    for (const n of names) expect(n, n).toMatch(ANALYTICS_EVENT_NAME_RE);
  });

  it('no prop name is a content field', () => {
    for (const n of names) {
      for (const p of Object.keys(ANALYTICS_EVENTS[n].props)) {
        expect(BANNED_PROP_NAMES, `${n}.${p}`).not.toContain(p);
      }
    }
  });

  it('every string prop is a closed vocabulary (no free-text type exists)', () => {
    for (const n of names) {
      const props: Readonly<Record<string, AnalyticsPropSpec>> = ANALYTICS_EVENTS[n].props;
      for (const [p, spec] of Object.entries(props)) {
        expect(
          ['enum', 'boolean', 'int', 'screen_id', 'route_pattern', 'catalog_key'],
          `${n}.${p}`,
        ).toContain(spec.type);
        if (spec.type === 'enum') {
          expect(spec.values.length, `${n}.${p}`).toBeGreaterThan(0);
          for (const v of spec.values) expect(v.length, `${n}.${p}=${v}`).toBeLessThanOrEqual(64);
          expect(new Set(spec.values).size).toBe(spec.values.length);
        }
        if (spec.type === 'int') expect(spec.min).toBeLessThanOrEqual(spec.max);
      }
    }
  });

  it('keeps the backoffice metric input names verbatim', () => {
    for (const n of [
      'app_opened',
      'briefing_opened',
      'briefing_audio_played',
      'notification_opened',
      'approval_decided',
      'capture_created',
      'capture_action_proposed',
      'reply_draft_created',
      'follow_up_draft_created',
      'reminder_created',
      'follow_up_actioned',
      'pro_gate_viewed',
      'insight_feedback',
      'assistant_query_sent',
      'search_performed',
      'voice_session_started',
      'meeting_prep_opened',
      'onboarding_completed',
      'purchase_completed',
      'referral_shared',
    ]) {
      expect(isAnalyticsEventName(n), n).toBe(true);
    }
  });

  it('marks server-emitted backend events', () => {
    expect(ANALYTICS_EVENTS.device_registered.source).toBe('server');
    expect(ANALYTICS_EVENTS.subscription_started.source).toBe('server');
    expect(ANALYTICS_EVENTS.reminder_created.source).toBe('both');
    expect(ANALYTICS_EVENTS.web_page_view.source).toBe('web');
    expect(ANALYTICS_EVENTS.app_opened.source).toBe('client');
  });

  it('aliases point to catalogue events', () => {
    for (const [alias, target] of Object.entries(ANALYTICS_EVENT_ALIASES)) {
      expect(isAnalyticsEventName(alias)).toBe(false);
      expect(isAnalyticsEventName(target)).toBe(true);
    }
    expect(resolveAnalyticsEventName('pro_gate_cta')).toBe('pro_gate_cta_tapped');
    expect(resolveAnalyticsEventName('briefing_open')).toBe('briefing_opened');
  });

  it('documented props keep their literal values', () => {
    expect(ANALYTICS_EVENTS.app_opened.props.source.values).toEqual([
      'cold',
      'warm',
      'push',
      'widget',
      'deeplink',
    ]);
    expect(ANALYTICS_EVENTS.briefing_audio_played.props.completion_bucket).toMatchObject({
      values: [0, 25, 50, 75, 100],
    });
    expect(ANALYTICS_EVENTS.search_performed.props.results_bucket.values).toEqual([
      '0',
      '1_5',
      '6_20',
      'gt20',
    ]);
    expect(ANALYTICS_EVENTS.web_cta_click.props.cta.values).toContain('open_in_app');
  });

  it('typed props compile to enum unions', () => {
    const p: AnalyticsProps<'tab_selected'> = { tab: 'plan', reselect: true, screen: 'M-GL-03' };
    expect(validateAnalyticsEvent('tab_selected', p)).toMatchObject({ ok: true, dropped: [] });
  });
});

describe('validateAnalyticsEvent (UT-ANL-01)', () => {
  it('unknown events are dropped', () => {
    expect(validateAnalyticsEvent('made_up_event', {})).toEqual({
      ok: false,
      reason: 'unknown_event',
    });
    expect(validateAnalyticsEvent('Bad-Name', {})).toEqual({ ok: false, reason: 'invalid_name' });
  });

  it('valid props pass; unknown and non-enum props are dropped', () => {
    const r = validateAnalyticsEvent('app_opened', {
      source: 'push',
      screen: 'M-GL-01',
      is_pro: false,
      extra: 'x',
    });
    expect(r).toEqual({
      ok: true,
      event: 'app_opened',
      props: { source: 'push', screen: 'M-GL-01', is_pro: false },
      dropped: ['extra'],
    });
    const bad = validateAnalyticsEvent('app_opened', { source: 'Mehmet Yılmaz' });
    expect(bad.ok && bad.dropped).toEqual(['source']);
  });

  it('no free text: emails, URLs, subjects never pass', () => {
    const r = validateAnalyticsEvent('flow_card_open', {
      card_type: 'mehmet@yilmazendustri.com.tr',
    });
    expect(r.ok && r.props).toEqual({});
    const u = validateAnalyticsEvent('deep_link_opened', {
      route_pattern: 'https://evil.example.com',
      source: 'link',
    });
    expect(u.ok && u.props).toEqual({ source: 'link' });
  });

  it('checks ints, bounds, int enums, booleans, screen ids, route patterns and catalog keys', () => {
    expect(isValidPropValue({ type: 'int', min: 0, max: 10 }, 11)).toBe(false);
    expect(isValidPropValue({ type: 'int', min: 0, max: 10 }, 2.5)).toBe(false);
    expect(isValidPropValue({ type: 'int', min: 0, max: 100, values: [0, 25] }, 25)).toBe(true);
    expect(isValidPropValue({ type: 'int', min: 0, max: 100, values: [0, 25] }, 30)).toBe(false);
    expect(isValidPropValue({ type: 'boolean' }, 'true')).toBe(false);
    expect(isValidPropValue({ type: 'screen_id' }, 'M-SET-01')).toBe(true);
    expect(isValidPropValue({ type: 'screen_id' }, 'Settings screen')).toBe(false);
    expect(isValidPropValue({ type: 'route_pattern' }, '/mail/:id')).toBe(true);
    expect(isValidPropValue({ type: 'route_pattern' }, 'unknown')).toBe(true);
    expect(
      isValidPropValue({ type: 'route_pattern' }, '/mail/5b3a1c9e-2f4d-4a8b-9c7e-1d2f3a4b5c6d'),
    ).toBe(false);
    expect(isValidPropValue({ type: 'catalog_key', catalog: 'faq' }, 'privacy_data_storage')).toBe(
      true,
    );
    expect(isValidPropValue({ type: 'catalog_key', catalog: 'faq' }, 'what is this?')).toBe(false);
  });

  it('resolves aliases when validating', () => {
    expect(validateAnalyticsEvent('pro_gate_cta', { feature: 'vip' })).toMatchObject({
      ok: true,
      event: 'pro_gate_cta_tapped',
    });
  });

  it('props stay within 2 KB', () => {
    const r = validateAnalyticsEvent('briefing_schedule_saved', {
      morning: '08:00',
      midday: '13:00',
      evening: '19:00',
    });
    expect(r.ok).toBe(true);
  });
});

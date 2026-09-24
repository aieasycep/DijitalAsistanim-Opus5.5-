import { describe, expect, it } from 'vitest';
import { isAllowedWebEvent, WEB_EVENT_PROPS } from '../src/lib/web-events/schema.ts';

const BASE = { page: 'home', locale: 'tr', device_class: 'desktop', theme: 'light' } as const;

describe('web analytics allow-list (Part 5 §0.11, PUB-06)', () => {
  it('accepts the documented events with enum props', () => {
    expect(isAllowedWebEvent({ ...BASE, event: 'web_page_view', props: {} })).toBe(true);
    expect(
      isAllowedWebEvent({
        ...BASE,
        event: 'web_cta_click',
        props: { cta: 'app_store', placement: 'hero' },
      }),
    ).toBe(true);
    expect(
      isAllowedWebEvent({
        ...BASE,
        event: 'web_faq_toggle',
        props: { faq_id: 'trial', open: true },
      }),
    ).toBe(true);
    expect(
      isAllowedWebEvent({
        ...BASE,
        event: 'web_get_redirect',
        props: { target: 'web', src: 'web' },
      }),
    ).toBe(true);
  });

  it('rejects free text, identifiers and unknown fields', () => {
    expect(isAllowedWebEvent({ ...BASE, event: 'web_page_view', props: { email: 'a@b.co' } })).toBe(
      false,
    );
    expect(
      isAllowedWebEvent({
        ...BASE,
        event: 'web_cta_click',
        props: { cta: 'app_store', placement: 'hero', code: 'X' },
      }),
    ).toBe(false);
    expect(
      isAllowedWebEvent({
        ...BASE,
        event: 'web_cta_click',
        props: { cta: 'anything', placement: 'hero' },
      }),
    ).toBe(false);
    expect(isAllowedWebEvent({ ...BASE, event: 'web_page_view', props: {}, user_id: 'u' })).toBe(
      false,
    );
    expect(
      isAllowedWebEvent({ ...BASE, event: 'web_page_view', props: {}, url: 'https://x/?q=1' }),
    ).toBe(false);
    expect(isAllowedWebEvent({ ...BASE, event: 'web_unknown', props: {} })).toBe(false);
    expect(isAllowedWebEvent({ ...BASE, locale: 'de', event: 'web_page_view', props: {} })).toBe(
      false,
    );
  });

  it('never allows a free-form string prop', () => {
    for (const [event, schema] of Object.entries(WEB_EVENT_PROPS)) {
      const shape = (
        schema as unknown as { shape: Record<string, { type?: string; def?: { type?: string } }> }
      ).shape;
      for (const [key, field] of Object.entries(shape)) {
        expect(field.def?.type, `${event}.${key}`).not.toBe('string');
      }
    }
  });
});

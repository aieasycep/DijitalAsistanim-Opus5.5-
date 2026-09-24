/**
 * Analytics allow-list enforcement (SECURITY_AND_PRIVACY_PLAN §4.9; API-ANL-01; UT-ANL-01).
 * Unknown events are dropped; unknown props and values outside their closed vocabulary are dropped
 * and counted. Strings that look like e-mail addresses or URLs are dropped even if a catalog allowed
 * them (defence in depth). The event name must match the `analytics_events.event_name` check.
 */
import {
  ANALYTICS_COMMON_PROPS,
  ANALYTICS_EVENT_ALIASES,
  ANALYTICS_EVENTS,
  ANALYTICS_ROUTE_PATTERNS,
  type AnalyticsEventName,
  type AnalyticsPropSpec,
} from './events.ts';

export const ANALYTICS_EVENT_NAME_RE = /^[a-z][a-z0-9_]{2,63}$/;
/** Screen IDs: `M-SET-01`, `M-ON-05V`, `M-STATE-02`, `W-LEGAL-01`, `B-USR-02`. */
export const SCREEN_ID_RE = /^[MWB]-[A-Z0-9]{2,12}(?:-[A-Z0-9]{1,6}){0,3}$/;
/** Fixed catalog keys (FAQ keys, suggested prompt keys): lower snake case, no spaces. */
export const CATALOG_KEY_RE = /^[a-z][a-z0-9_]{1,47}$/;
/** `analytics_events.props` limit (`pg_column_size(props) ≤ 2048`). */
export const MAX_PROPS_BYTES = 2048;

/** Prop names that can never appear in the catalogue (content, identifiers, contact data). */
export const BANNED_PROP_NAMES: readonly string[] = [
  'email',
  'name',
  'subject',
  'body',
  'text',
  'query',
  'prompt',
  'answer',
  'url',
  'link_url',
  'title',
  'content',
  'message',
  'phone',
  'address',
  'token',
  'secret',
  'password',
  'amount',
  'file_name',
  'filename',
  'lat',
  'lng',
  'ip',
  'user_id',
  'entity_id',
  'id',
];

const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL_LIKE = /(?:https?:|www\.|:\/\/)/i;

export type AnalyticsPropValue = string | number | boolean;

export function isAnalyticsEventName(name: string): name is AnalyticsEventName {
  return Object.prototype.hasOwnProperty.call(ANALYTICS_EVENTS, name);
}

/** Canonical event name for a catalogue name or a documented alias. */
export function resolveAnalyticsEventName(name: string): AnalyticsEventName | null {
  if (isAnalyticsEventName(name)) return name;
  return ANALYTICS_EVENT_ALIASES[name] ?? null;
}

/** Whether one value satisfies its prop spec. */
export function isValidPropValue(
  spec: AnalyticsPropSpec,
  value: unknown,
): value is AnalyticsPropValue {
  if (typeof value === 'string' && (EMAIL_LIKE.test(value) || URL_LIKE.test(value))) return false;
  switch (spec.type) {
    case 'enum':
      return typeof value === 'string' && value.length <= 64 && spec.values.includes(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'int':
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= spec.min &&
        value <= spec.max &&
        (spec.values === undefined || spec.values.includes(value))
      );
    case 'screen_id':
      return typeof value === 'string' && SCREEN_ID_RE.test(value);
    case 'route_pattern':
      return typeof value === 'string' && ANALYTICS_ROUTE_PATTERNS.includes(value);
    case 'catalog_key':
      return typeof value === 'string' && CATALOG_KEY_RE.test(value);
  }
}

export type AnalyticsValidation =
  | {
      readonly ok: true;
      readonly event: AnalyticsEventName;
      readonly props: Readonly<Record<string, AnalyticsPropValue>>;
      /** Prop names dropped (unknown or invalid) — counted, never stored. */
      readonly dropped: readonly string[];
    }
  | { readonly ok: false; readonly reason: 'invalid_name' | 'unknown_event' | 'props_too_large' };

function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

/** Validates and sanitises one event before `POST /analytics/events` persists it. */
export function validateAnalyticsEvent(
  name: string,
  props: Readonly<Record<string, unknown>> = {},
): AnalyticsValidation {
  if (!ANALYTICS_EVENT_NAME_RE.test(name)) return { ok: false, reason: 'invalid_name' };
  const event = resolveAnalyticsEventName(name);
  if (!event) return { ok: false, reason: 'unknown_event' };
  const specs: Readonly<Record<string, AnalyticsPropSpec>> = {
    ...ANALYTICS_COMMON_PROPS,
    ...ANALYTICS_EVENTS[event].props,
  };
  const clean: Record<string, AnalyticsPropValue> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    const spec = specs[key];
    if (spec && isValidPropValue(spec, value)) clean[key] = value;
    else dropped.push(key);
  }
  if (utf8Length(JSON.stringify(clean)) > MAX_PROPS_BYTES)
    return { ok: false, reason: 'props_too_large' };
  return { ok: true, event, props: clean, dropped };
}

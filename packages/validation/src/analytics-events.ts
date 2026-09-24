import { z } from 'zod';
import { IsoDateTime } from './api/common.ts';

/*
 * Analytics validation (docs/SECURITY_AND_PRIVACY_PLAN.md §4.9, plan R-21, API-ANL-01, PUB-06).
 * The event catalogue itself lives in `@da/domain` (`analytics/events.ts`); this module is generic:
 * `createAnalyticsValidator(catalogue)` takes `event name → props schema` and enforces the rules
 * every entry must satisfy.
 */

/** `analytics_events.event_name` check: snake_case, 3–64 chars. */
export const ANALYTICS_EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
export const AnalyticsEventNameFormat = z.string().regex(ANALYTICS_EVENT_NAME_PATTERN);
export const ANALYTICS_PROP_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
/** Screen IDs such as `M-TD-01`, `M-ASST-02`, `W-HOME-01` (SCREEN_AND_FLOW_MAP). */
export const SCREEN_ID_PATTERN = /^[A-Z]{1,2}-[A-Z0-9]{2,8}-\d{2}[a-z]?$/;
export const ScreenId = z.string().regex(SCREEN_ID_PATTERN);

export const ANALYTICS_LIMITS = {
  enum_value_chars: 64,
  props_bytes: 2048,
  batch_events: 100,
  batch_bytes: 64 * 1024,
  /** Integer props must be clamped (explicit bounds) within this magnitude. */
  integer_magnitude: 1_000_000_000,
} as const;

/** Prop names that can only carry content, identifiers or secrets (banned outright). */
export const BANNED_PROP_NAMES: ReadonlySet<string> = new Set([
  'email',
  'e_mail',
  'subject',
  'body',
  'content',
  'text',
  'message',
  'note',
  'notes',
  'title',
  'name',
  'first_name',
  'last_name',
  'full_name',
  'display_name',
  'username',
  'sender',
  'recipient',
  'recipients',
  'query',
  'q',
  'search_term',
  'prompt',
  'answer',
  'response',
  'reply',
  'comment',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'secret',
  'password',
  'api_key',
  'url',
  'link',
  'href',
  'uri',
  'file_name',
  'filename',
  'file_path',
  'path',
  'amount',
  'price',
  'iban',
  'card_number',
  'phone',
  'phone_number',
  'tel',
  'address',
  'lat',
  'lng',
  'lon',
  'latitude',
  'longitude',
  'coordinates',
  'location',
  'ip',
  'ip_address',
  'user_agent',
  'device_id',
  'idfa',
  'aaid',
  'gaid',
  'advertising_id',
  'user_id',
  'contact_id',
  'provider_message_id',
  'provider_event_id',
  'thread_id',
  'message_id',
]);

/** Name suffixes that mark content, secrets or identifiers (`sender_email`, `file_url`…). */
export const BANNED_PROP_SUFFIXES: readonly string[] = [
  '_email',
  '_subject',
  '_body',
  '_content',
  '_text',
  '_message',
  '_title',
  '_name',
  '_query',
  '_prompt',
  '_answer',
  '_token',
  '_secret',
  '_password',
  '_url',
  '_link',
  '_uri',
  '_path',
  '_amount',
  '_price',
  '_iban',
  '_phone',
  '_address',
  '_ip',
];

const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL_LIKE = /\b(?:https?:\/\/|www\.)|^[a-z][a-z0-9+.-]*:\/\//i;

/** `true` for strings that look like an email address or a URL (dropped server-side, §4.9). */
export function looksLikeContact(value: string): boolean {
  return EMAIL_LIKE.test(value) || URL_LIKE.test(value);
}

export function isBannedPropName(name: string): boolean {
  return (
    BANNED_PROP_NAMES.has(name) || BANNED_PROP_SUFFIXES.some((suffix) => name.endsWith(suffix))
  );
}

/** UTF-8 byte length without runtime globals (Deno and Node agree). */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

export type AnalyticsPropsSchema = z.ZodObject;
export type AnalyticsCatalogue = Readonly<Record<string, AnalyticsPropsSchema>>;

export interface CatalogueViolation {
  readonly event: string;
  readonly prop?: string;
  readonly rule:
    | 'event_name_format'
    | 'prop_name_format'
    | 'banned_prop_name'
    | 'free_text'
    | 'enum_value_too_long'
    | 'enum_value_contact'
    | 'unclamped_integer'
    | 'unsupported_type';
}

type JsonNode = Record<string, unknown>;

function checkPropNode(node: JsonNode, report: (rule: CatalogueViolation['rule']) => void): void {
  const branches = (node.anyOf ?? node.oneOf) as JsonNode[] | undefined;
  if (Array.isArray(branches)) {
    branches
      .filter((b) => b.type !== 'null')
      .forEach((b) => {
        checkPropNode(b, report);
      });
    return;
  }
  const types = Array.isArray(node.type)
    ? (node.type as string[])
    : [node.type as string | undefined];
  const type = types.find((t) => t !== 'null');
  const values =
    (node.enum as unknown[] | undefined) ?? ('const' in node ? [node.const] : undefined);
  if (values !== undefined) {
    for (const value of values) {
      if (typeof value === 'string') {
        if (value.length > ANALYTICS_LIMITS.enum_value_chars) report('enum_value_too_long');
        if (looksLikeContact(value)) report('enum_value_contact');
      } else if (typeof value === 'number' && !Number.isInteger(value)) {
        report('unsupported_type');
      }
    }
    return;
  }
  switch (type) {
    case 'boolean':
      return;
    case 'integer': {
      const min = node.minimum as number | undefined;
      const max = node.maximum as number | undefined;
      const limit = ANALYTICS_LIMITS.integer_magnitude;
      if (min === undefined || max === undefined || min < -limit || max > limit)
        report('unclamped_integer');
      return;
    }
    case 'string':
      if (node.pattern !== SCREEN_ID_PATTERN.source) report('free_text');
      return;
    default:
      report('unsupported_type');
  }
}

/**
 * Audits a catalogue against the §4.9 rules: snake_case event and prop names, no banned prop names,
 * and prop types limited to closed string enums (≤64 chars), booleans, clamped integers, integer
 * enums and screen IDs. Returns every violation.
 */
export function auditAnalyticsCatalogue(catalogue: AnalyticsCatalogue): CatalogueViolation[] {
  const violations: CatalogueViolation[] = [];
  for (const [event, schema] of Object.entries(catalogue)) {
    if (!ANALYTICS_EVENT_NAME_PATTERN.test(event))
      violations.push({ event, rule: 'event_name_format' });
    const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonNode;
    const properties = (json.properties as Record<string, JsonNode> | undefined) ?? {};
    for (const [prop, node] of Object.entries(properties)) {
      if (!ANALYTICS_PROP_NAME_PATTERN.test(prop))
        violations.push({ event, prop, rule: 'prop_name_format' });
      if (isBannedPropName(prop)) violations.push({ event, prop, rule: 'banned_prop_name' });
      checkPropNode(node, (rule) => violations.push({ event, prop, rule }));
    }
  }
  return violations;
}

export type AnalyticsDropReason =
  'invalid_envelope' | 'unknown_event' | 'invalid_props' | 'contact_value' | 'props_too_large';

export type AnalyticsValidation =
  | { readonly ok: true; readonly event: AnalyticsEvent }
  | { readonly ok: false; readonly reason: AnalyticsDropReason };

/** One validated event (API-ANL-01 item shape). */
export interface AnalyticsEvent {
  readonly name: string;
  readonly ts: string;
  readonly screen?: string;
  readonly props: Readonly<Record<string, string | number | boolean | null>>;
}

export interface AnalyticsBatchResult {
  readonly accepted: AnalyticsEvent[];
  readonly dropped: number;
  readonly reasons: Readonly<Partial<Record<AnalyticsDropReason | 'batch_too_large', number>>>;
}

/** The event envelope before per-event props validation (API-ANL-01). */
export const AnalyticsEventEnvelope = z.strictObject({
  name: AnalyticsEventNameFormat,
  ts: IsoDateTime,
  screen: z
    .string()
    .max(64)
    .regex(/^[A-Za-z0-9_.:-]+$/)
    .optional(),
  props: z
    .record(z.string(), z.union([z.string().max(64), z.number(), z.boolean(), z.null()]))
    .optional(),
});

export interface AnalyticsValidator<C extends AnalyticsCatalogue> {
  readonly names: readonly (keyof C & string)[];
  /** `z.enum` of the catalogue's event names. */
  readonly eventName: z.ZodType<keyof C & string>;
  /** Validates the props of one catalogue event (strict: unknown props fail). */
  validateProps(name: string, props: unknown): z.ZodSafeParseResult<Record<string, unknown>>;
  validate(event: unknown): AnalyticsValidation;
  validateBatch(events: readonly unknown[]): AnalyticsBatchResult;
}

/**
 * Builds the allow-list validator for a catalogue (`event name → props schema`). Throws when the
 * catalogue itself breaks a §4.9 rule, so a bad catalogue can never ship.
 */
export function createAnalyticsValidator<C extends AnalyticsCatalogue>(
  catalogue: C,
): AnalyticsValidator<C> {
  const violations = auditAnalyticsCatalogue(catalogue);
  if (violations.length > 0) {
    const summary = violations
      .map((v) => `${v.event}${v.prop ? `.${v.prop}` : ''}: ${v.rule}`)
      .join('; ');
    throw new Error(`analytics catalogue violates the privacy rules: ${summary}`);
  }
  const names = Object.keys(catalogue) as (keyof C & string)[];
  if (names.length === 0) throw new Error('analytics catalogue is empty');
  const strict = new Map<string, z.ZodType<Record<string, unknown>>>(
    Object.entries(catalogue).map(([name, schema]) => [name, schema.strict()]),
  );
  const eventName = z.enum(names as [keyof C & string, ...(keyof C & string)[]]);

  const validateProps = (name: string, props: unknown) => {
    const schema = strict.get(name);
    if (schema === undefined) {
      const error = new z.ZodError([
        { code: 'custom', path: [], message: 'unknown_event', input: name },
      ]);
      return { success: false, error } as z.ZodSafeParseResult<Record<string, unknown>>;
    }
    return schema.safeParse(props ?? {});
  };

  const validate = (input: unknown): AnalyticsValidation => {
    const envelope = AnalyticsEventEnvelope.safeParse(input);
    if (!envelope.success) return { ok: false, reason: 'invalid_envelope' };
    const { name, ts, screen, props = {} } = envelope.data;
    if (!strict.has(name)) return { ok: false, reason: 'unknown_event' };
    if (Object.values(props).some((v) => typeof v === 'string' && looksLikeContact(v))) {
      return { ok: false, reason: 'contact_value' };
    }
    if (utf8ByteLength(JSON.stringify(props)) > ANALYTICS_LIMITS.props_bytes) {
      return { ok: false, reason: 'props_too_large' };
    }
    const parsed = validateProps(name, props);
    if (!parsed.success) return { ok: false, reason: 'invalid_props' };
    const event: AnalyticsEvent = {
      name,
      ts,
      ...(screen === undefined ? {} : { screen }),
      props: parsed.data as AnalyticsEvent['props'],
    };
    return { ok: true, event };
  };

  const validateBatch = (events: readonly unknown[]): AnalyticsBatchResult => {
    const reasons: Partial<Record<AnalyticsDropReason | 'batch_too_large', number>> = {};
    const count = (reason: AnalyticsDropReason | 'batch_too_large', n = 1) => {
      reasons[reason] = (reasons[reason] ?? 0) + n;
    };
    if (
      events.length > ANALYTICS_LIMITS.batch_events ||
      utf8ByteLength(JSON.stringify(events)) > ANALYTICS_LIMITS.batch_bytes
    ) {
      count('batch_too_large', events.length);
      return { accepted: [], dropped: events.length, reasons };
    }
    const accepted: AnalyticsEvent[] = [];
    for (const input of events) {
      const result = validate(input);
      if (result.ok) accepted.push(result.event);
      else count(result.reason);
    }
    return { accepted, dropped: events.length - accepted.length, reasons };
  };

  return { names, eventName, validateProps, validate, validateBatch };
}

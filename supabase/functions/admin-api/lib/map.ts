/**
 * Mapping helpers between `admin_api` JSON and the `@da/validation` admin contracts.
 *
 * `conform(schema, value)` projects a value onto a contract schema: object keys the schema does not
 * declare are dropped (strict contract rows stay strict even when SQL returns extra columns), and a
 * `null` for a field that is optional but not nullable is omitted. Nothing is invented: a missing
 * required field stays missing and the response check reports it.
 */
import type { z } from 'zod';

interface ZodDef {
  readonly type: string;
  readonly shape?: Record<string, z.ZodType>;
  readonly element?: z.ZodType;
  readonly innerType?: z.ZodType;
  readonly in?: z.ZodType;
  readonly options?: readonly z.ZodType[];
  readonly valueType?: z.ZodType;
}

function defOf(schema: z.ZodType): ZodDef {
  return (schema as unknown as { _zod: { def: ZodDef } })._zod.def;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** `true` for `x.optional()` (and defaults) whose inner schema does not accept `null`. */
function dropsNull(schema: z.ZodType): boolean {
  const def = defOf(schema);
  if (def.type !== 'optional' && def.type !== 'default') return false;
  return !schema.safeParse(null).success;
}

export function conform(schema: z.ZodType, value: unknown): unknown {
  const def = defOf(schema);
  switch (def.type) {
    case 'object': {
      if (!isRecord(value) || def.shape === undefined) return value;
      const out: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(def.shape)) {
        if (!(key in value)) continue;
        const v = value[key];
        if (v === undefined || (v === null && dropsNull(field))) continue;
        out[key] = conform(field, v);
      }
      return out;
    }
    case 'array':
      return Array.isArray(value) && def.element !== undefined
        ? value.map((v) => conform(def.element as z.ZodType, v))
        : value;
    case 'record': {
      if (!isRecord(value) || def.valueType === undefined) return value;
      const out: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(value)) out[key] = conform(def.valueType, v);
      return out;
    }
    case 'optional':
    case 'nullable':
    case 'default':
    case 'readonly':
    case 'catch':
    case 'nonoptional':
      return value === null || value === undefined || def.innerType === undefined
        ? value
        : conform(def.innerType, value);
    case 'pipe':
      return def.in === undefined ? value : conform(def.in, value);
    case 'union': {
      for (const option of def.options ?? []) {
        const candidate = conform(option, value);
        if (option.safeParse(candidate).success) return candidate;
      }
      return value;
    }
    default:
      return value;
  }
}

/** The `data` member schema of a `{data, meta}` response envelope. */
export function dataSchemaOf(response: z.ZodType): z.ZodType | null {
  const def = defOf(response);
  return def.type === 'object' ? (def.shape?.data ?? null) : null;
}

// ── Scalar helpers ────────────────────────────────────────────────────────────

export type Json = Record<string, unknown>;

export function obj(value: unknown): Json {
  return isRecord(value) ? value : {};
}

export function arr(value: unknown): Json[] {
  return Array.isArray(value) ? value.map((v) => obj(v)) : [];
}

export function str(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

export function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value);
  return null;
}

/** A count: non-negative integer, `0` when absent. */
export function count(value: unknown): number {
  const n = num(value);
  return n === null ? 0 : Math.max(0, Math.round(n));
}

/** An optional integer (latency percentiles): rounded, `null` when absent. */
export function intOrNull(value: unknown): number | null {
  const n = num(value);
  return n === null ? null : Math.max(0, Math.round(n));
}

/**
 * A 0–1 ratio for contract fields that are not nullable: SQL returns `null` when the denominator
 * is 0 (BACKOFFICE_PLAN §7.1), which the contract renders as `0`.
 */
export function ratio(value: unknown): number {
  const n = num(value);
  if (n === null) return 0;
  return Math.min(1, Math.max(0, n));
}

/** A money amount rounded to 6 decimals, `0` when absent. */
export function usd(value: unknown): number {
  const n = num(value);
  return n === null ? 0 : Math.max(0, Math.round(n * 1e6) / 1e6);
}

/** `{a: 1, b: null, c: 'x'}` → `{a: 1}`: the numeric members of an object. */
export function numericMembers(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, v] of Object.entries(obj(value))) {
    const n = num(v);
    if (n !== null) out[key] = n;
  }
  return out;
}

/** `referrals.risk_score` is stored 0–100; the contract carries 0–1. */
export function riskScore(value: unknown): number | null {
  const n = num(value);
  if (n === null) return null;
  return Math.min(1, Math.max(0, n > 1 ? n / 100 : n));
}

/** RevenueCat environments are upper case in the contracts; the subscription mirror stores lower case. */
export function upperEnvironment(value: unknown): 'SANDBOX' | 'PRODUCTION' | null {
  const s = str(value)?.toUpperCase();
  return s === 'SANDBOX' || s === 'PRODUCTION' ? s : null;
}

/**
 * Push tokens reach the contract as `ExponentPushToken[…yz]` (at most two characters on each side
 * of the ellipsis, API_CONTRACTS ADM-02); SQL masks to the last four characters.
 */
export function pushTokenMasked(value: unknown): string | null {
  const s = str(value);
  if (s === null) return null;
  const m = /^Expo(?:nent)?PushToken\[[^\]…]*…([A-Za-z0-9_-]*)\]$/.exec(s);
  if (m === null) return null;
  return `ExponentPushToken[…${(m[1] ?? '').slice(-2)}]`;
}

// ── Audit row ids (bigint identity ↔ the contract's uuid form) ────────────────

const AUDIT_ID_PREFIX = '00000000-0000-4000-8000-';

/**
 * `audit_logs.id` is a bigint identity; the ADM-17 contracts type row ids as UUIDs. The id is
 * carried losslessly in a fixed-prefix RFC 4122 form: `00000000-0000-4000-8000-<12 hex digits>`.
 */
export function auditIdToUuid(id: unknown): string | null {
  const n = typeof id === 'string' ? Number(id) : id;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0 || n > 0xffffffffffff) return null;
  return `${AUDIT_ID_PREFIX}${n.toString(16).padStart(12, '0')}`;
}

export function uuidToAuditId(uuid: string): number | null {
  const lower = uuid.toLowerCase();
  if (!lower.startsWith(AUDIT_ID_PREFIX)) return null;
  const hex = lower.slice(AUDIT_ID_PREFIX.length);
  if (!/^[0-9a-f]{12}$/.test(hex)) return null;
  return Number.parseInt(hex, 16);
}

/** A display label for a masked actor/user object of `private.audit_row_json`. */
export function actorLabel(actorType: unknown, actor: unknown): string {
  const a = obj(actor);
  const label = str(a.display_name) ?? str(a.email_masked) ?? str(a.display_name_masked);
  if (label !== null && label !== '') return label;
  if (a.deleted === true) return `deleted:${str(a.subject_hash_prefix) ?? ''}`;
  const id = str(a.id);
  if (id !== null) return id;
  return str(actorType) ?? 'system';
}

/** `{id}` while the user exists, `deleted:<subject hash prefix>` after deletion. */
export function userRef(value: unknown): string {
  const ref = obj(value);
  const id = str(ref.id);
  if (id !== null && ref.deleted !== true) return id;
  const prefix = str(ref.subject_hash_prefix);
  return prefix === null ? 'deleted' : `deleted:${prefix}`;
}

// ── App routes ↔ announcement deep links ──────────────────────────────────────

const DEEPLINK_SCHEME = 'dijitalasistan://';

/** `/flow/today` → `dijitalasistan://flow/today` (the `announcements.cta_deeplink` form). */
export function routeToDeeplink(route: string): string {
  return `${DEEPLINK_SCHEME}${route.replace(/^\/+/, '')}`;
}

export function deeplinkToRoute(value: unknown): string | null {
  const s = str(value);
  if (s === null) return null;
  return s.startsWith(DEEPLINK_SCHEME) ? `/${s.slice(DEEPLINK_SCHEME.length)}` : s;
}

// ── Sort and page arguments of the admin list functions ───────────────────────

/** `?sort=created_at&order=desc` → `-created_at` (the `admin_api` list convention). */
export function sortArg(
  sort: string | undefined,
  order: 'asc' | 'desc',
  aliases: Readonly<Record<string, string>> = {},
): string | null {
  if (sort === undefined) return null;
  const column = aliases[sort] ?? sort;
  return order === 'desc' ? `-${column}` : column;
}

/** Collects `filter[key]` query members into the `p_filter` object. */
export function filterArg(query: Json, keys: Readonly<Record<string, string>>): Json {
  const out: Json = {};
  for (const [contractKey, sqlKey] of Object.entries(keys)) {
    const v = query[`filter[${contractKey}]`];
    if (v !== undefined && v !== null) out[sqlKey] = v;
  }
  return out;
}

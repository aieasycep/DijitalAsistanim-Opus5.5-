/**
 * Mobile route tree (MASTER_PLAN §9, SCREEN_AND_FLOW_MAP M-GL-07/08): route builders, the deep-link
 * allow-list, a strict parser and the mappings from notifications / insights / sources to routes.
 * Scheme `dijitalasistan://`; universal links `https://<web-domain>/app/...`. Deep links only
 * navigate; they never execute actions.
 */
import type {
  InsightKind,
  MailCategory,
  NotificationCategory,
  Provider,
  SourceType,
} from './enums.ts';
import { isUuid } from './ids.ts';

export const DEEP_LINK_SCHEME = 'dijitalasistan';
export const DEEP_LINK_PREFIX = `${DEEP_LINK_SCHEME}://`;
/** Path prefix of universal/app links on the web domain. */
export const UNIVERSAL_LINK_PREFIX = '/app';

type ParamKind = 'uuid' | 'mail_category' | 'referral_code';

interface RouteDef {
  readonly pattern: string;
  readonly query?: readonly string[];
  /** Only resolvable in demo builds (`EXPO_PUBLIC_DEMO_MODE=true`). */
  readonly demoOnly?: boolean;
}

/** Query keys accepted on every route (analytics source suffix `?src=push|widget|web&w=<family>`). */
export const GLOBAL_QUERY_KEYS = ['src', 'w'] as const;

const PARAM_KINDS: Readonly<Record<string, ParamKind>> = {
  id: 'uuid',
  eventId: 'uuid',
  approvalId: 'uuid',
  insightId: 'uuid',
  contactId: 'uuid',
  threadId: 'uuid',
  category: 'mail_category',
  code: 'referral_code',
};

const OAUTH_QUERY = ['provider', 'result', 'completion_code', 'error_code', 'admin_consent_url'];

/** The allow-list (M-GL-07). Static segments are matched before parameters. */
export const ROUTE_DEFS: readonly RouteDef[] = [
  { pattern: '/today' },
  { pattern: '/flow', query: ['filter'] },
  { pattern: '/plan', query: ['view', 'date'] },
  { pattern: '/assistant' },
  { pattern: '/briefings' },
  { pattern: '/briefing/:id' },
  { pattern: '/briefing/:id/listen', query: ['autoplay'] },
  { pattern: '/weekly/:id' },
  { pattern: '/weekly/:id/share' },
  { pattern: '/mail', query: ['date', 'account'] },
  { pattern: '/mail/category/:category', query: ['date', 'account'] },
  { pattern: '/mail/:id' },
  { pattern: '/mail/:id/reply', query: ['mode', 'draftId', 'tone'] },
  { pattern: '/waiting', query: ['focus'] },
  { pattern: '/followups', query: ['focus'] },
  { pattern: '/commitments', query: ['direction'] },
  { pattern: '/commitments/:id' },
  { pattern: '/life/:id' },
  { pattern: '/event/:id' },
  { pattern: '/meeting/:eventId/prep' },
  { pattern: '/meeting/:eventId/summary' },
  { pattern: '/meeting/:eventId/post' },
  { pattern: '/plan/proposal/:approvalId' },
  { pattern: '/plan/conflict/:insightId' },
  { pattern: '/person/:contactId' },
  { pattern: '/vip' },
  { pattern: '/search', query: ['types'] },
  { pattern: '/memory' },
  { pattern: '/voice' },
  { pattern: '/capture', query: ['kind', 'entry'] },
  { pattern: '/capture/:id' },
  { pattern: '/chat/new', query: ['prompt', 'contactId', 'origin'] },
  { pattern: '/chat/:threadId' },
  { pattern: '/approvals' },
  { pattern: '/approvals/:id' },
  {
    pattern: '/reminders/new',
    query: ['targetType', 'targetId', 'anchorAt', 'title', 'preset', 'mode'],
  },
  { pattern: '/settings' },
  { pattern: '/settings/profile' },
  { pattern: '/settings/accounts', query: ['add'] },
  { pattern: '/settings/accounts/:id', query: ['oauth'] },
  { pattern: '/settings/notifications', query: ['sheet'] },
  { pattern: '/settings/briefings' },
  { pattern: '/settings/privacy' },
  { pattern: '/settings/privacy/permissions' },
  { pattern: '/settings/privacy/data-sources' },
  { pattern: '/settings/privacy/retention' },
  { pattern: '/settings/privacy/history' },
  { pattern: '/settings/privacy/export' },
  { pattern: '/settings/privacy/delete-account' },
  { pattern: '/settings/personalization' },
  { pattern: '/settings/priority-rules' },
  { pattern: '/settings/priority-rules/new', query: ['type', 'value'] },
  { pattern: '/settings/priority-rules/:id' },
  { pattern: '/settings/appearance' },
  { pattern: '/settings/language' },
  { pattern: '/settings/subscription' },
  { pattern: '/settings/referral', query: ['code'] },
  { pattern: '/settings/android-notifications' },
  { pattern: '/settings/help', query: ['faq', 'contact', 'ticket'] },
  { pattern: '/settings/feedback', query: ['type', 'screen'] },
  { pattern: '/settings/about' },
  { pattern: '/paywall', query: ['source'] },
  { pattern: '/integrations/callback', query: OAUTH_QUERY },
  { pattern: '/oauth/done', query: OAUTH_QUERY },
  { pattern: '/auth/callback', query: ['code'] },
  { pattern: '/r/:code' },
  { pattern: '/demo/setup', query: ['scenario', 'clock', 'locale', 'theme'], demoOnly: true },
];

/** Every allow-listed route pattern (also the closed list for analytics `route_pattern`). */
export const ROUTE_PATTERNS: readonly string[] = ROUTE_DEFS.map((r) => r.pattern);

const MAIL_DRILLDOWN: readonly MailCategory[] = [
  'important',
  'has_deadline',
  'informational',
  'low_priority',
];
const REFERRAL_CODE_RE = /^[2-9A-HJKMNP-Z]{7,8}$/;

function paramValid(kind: ParamKind, value: string): boolean {
  switch (kind) {
    case 'uuid':
      return isUuid(value);
    case 'mail_category':
      return (MAIL_DRILLDOWN as readonly string[]).includes(value);
    case 'referral_code':
      return REFERRAL_CODE_RE.test(value);
  }
}

export interface MatchedRoute {
  readonly pattern: string;
  /** Normalised path without query. */
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  /** Only allow-listed query keys are kept. */
  readonly query: Readonly<Record<string, string>>;
}

export type DeepLinkRejection =
  'malformed' | 'scheme_not_allowed' | 'host_not_allowed' | 'not_allowed' | 'invalid_param';

export type DeepLinkParseResult =
  | { readonly ok: true; readonly route: MatchedRoute }
  | { readonly ok: false; readonly reason: DeepLinkRejection };

function splitSegments(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

/** Matches a path (no query) against the allow-list. */
export function matchRoute(
  path: string,
  opts: { readonly allowDemo?: boolean } = {},
): { route: RouteDef; params: Record<string, string> } | 'invalid_param' | null {
  const segs = splitSegments(path);
  let paramFailure = false;
  const candidates = ROUTE_DEFS.filter((r) => !r.demoOnly || opts.allowDemo === true);
  // Two passes: fully static patterns first so `/chat/new` wins over `/chat/:threadId`.
  for (const staticOnly of [true, false]) {
    for (const def of candidates) {
      const pat = splitSegments(def.pattern);
      if (pat.length !== segs.length) continue;
      const hasParam = pat.some((p) => p.startsWith(':'));
      if (staticOnly === hasParam) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < pat.length; i++) {
        const p = pat[i] ?? '';
        const s = segs[i] ?? '';
        if (p.startsWith(':')) {
          const name = p.slice(1);
          const kind = PARAM_KINDS[name] ?? 'uuid';
          let decoded: string;
          try {
            decoded = decodeURIComponent(s);
          } catch {
            ok = false;
            break;
          }
          if (!paramValid(kind, decoded)) {
            ok = false;
            paramFailure = true;
            break;
          }
          params[name] = decoded;
        } else if (p !== s) {
          ok = false;
          break;
        }
      }
      if (ok) return { route: def, params };
    }
  }
  return paramFailure ? 'invalid_param' : null;
}

function parseQuery(query: string, allowed: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (query.length === 0) return out;
  for (const part of query.split('&')) {
    if (part.length === 0) continue;
    const eq = part.indexOf('=');
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawValue = eq === -1 ? '' : part.slice(eq + 1);
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      value = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    } catch {
      continue;
    }
    if (allowed.includes(key) || (GLOBAL_QUERY_KEYS as readonly string[]).includes(key)) {
      out[key] = value;
    }
  }
  return out;
}

export interface ParseDeepLinkOptions {
  /** Web origin for universal links, e.g. `https://dijitalasistan.app`. */
  readonly webOrigin?: string;
  readonly allowDemo?: boolean;
}

/**
 * Normalises and allow-lists an incoming URL: `dijitalasistan://…`, an app path `/…`, or a
 * universal link `https://<web-domain>/app/…` (plus `/r/{code}` and `/oauth/done`). Unknown
 * schemes (`javascript:`, `http:`), foreign hosts and unknown paths are rejected.
 */
export function parseDeepLink(url: string, opts: ParseDeepLinkOptions = {}): DeepLinkParseResult {
  const trimmed = url.trim();
  if (trimmed.length === 0 || trimmed.length > 2048 || /[\s\\]/.test(trimmed)) {
    return { ok: false, reason: 'malformed' };
  }
  let rest: string;
  if (trimmed.toLowerCase().startsWith(DEEP_LINK_PREFIX)) {
    rest = `/${trimmed.slice(DEEP_LINK_PREFIX.length)}`;
  } else if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    rest = trimmed;
  } else if (/^https:\/\//i.test(trimmed)) {
    if (!opts.webOrigin) return { ok: false, reason: 'host_not_allowed' };
    const origin = opts.webOrigin.replace(/\/+$/, '').toLowerCase();
    const lower = trimmed.toLowerCase();
    if (!(lower === origin || lower.startsWith(`${origin}/`))) {
      return { ok: false, reason: 'host_not_allowed' };
    }
    const afterOrigin = trimmed.slice(origin.length) || '/';
    if (afterOrigin.startsWith(`${UNIVERSAL_LINK_PREFIX}/`)) {
      rest = afterOrigin.slice(UNIVERSAL_LINK_PREFIX.length);
    } else if (/^\/(r\/|oauth\/done)/.test(afterOrigin)) {
      rest = afterOrigin;
    } else {
      return { ok: false, reason: 'not_allowed' };
    }
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return { ok: false, reason: 'scheme_not_allowed' };
  } else {
    return { ok: false, reason: 'malformed' };
  }
  const hashIdx = rest.indexOf('#');
  if (hashIdx !== -1) rest = rest.slice(0, hashIdx);
  const qIdx = rest.indexOf('?');
  const pathPart = qIdx === -1 ? rest : rest.slice(0, qIdx);
  const queryPart = qIdx === -1 ? '' : rest.slice(qIdx + 1);
  if (pathPart.split('/').some((s) => s === '..' || s === '.')) {
    return { ok: false, reason: 'malformed' };
  }
  const matched = matchRoute(
    pathPart,
    opts.allowDemo === undefined ? {} : { allowDemo: opts.allowDemo },
  );
  if (matched === 'invalid_param') return { ok: false, reason: 'invalid_param' };
  if (!matched) return { ok: false, reason: 'not_allowed' };
  const path = `/${splitSegments(pathPart).join('/')}`;
  return {
    ok: true,
    route: {
      pattern: matched.route.pattern,
      path,
      params: matched.params,
      query: parseQuery(queryPart, matched.route.query ?? []),
    },
  };
}

/** The allow-listed pattern of a path (ids → `:id`), for analytics `route_pattern`. */
export function routePatternOf(path: string): string | null {
  const q = path.indexOf('?');
  const m = matchRoute(q === -1 ? path : path.slice(0, q), { allowDemo: true });
  return m && m !== 'invalid_param' ? m.route.pattern : null;
}

function withQuery(path: string, query?: Readonly<Record<string, string | undefined>>): string {
  if (!query) return path;
  const parts = Object.entries(query)
    .filter((e): e is [string, string] => e[1] !== undefined && e[1] !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length > 0 ? `${path}?${parts.join('&')}` : path;
}

function uuidParam(id: string): string {
  if (!isUuid(id)) throw new RangeError(`route parameter is not a uuid: ${id}`);
  return id;
}

/** Route builders for the §9 tree (app paths, no scheme). */
export const routes = {
  today: () => '/today',
  flow: (filter?: 'all' | 'important' | 'mail' | 'calendar' | 'followup' | 'personal') =>
    withQuery('/flow', { filter }),
  plan: (query?: { view?: 'day' | 'week'; date?: string }) => withQuery('/plan', query),
  assistant: () => '/assistant',
  briefings: () => '/briefings',
  briefing: (id: string) => `/briefing/${uuidParam(id)}`,
  briefingListen: (id: string) => `/briefing/${uuidParam(id)}/listen`,
  weekly: (id: string) => `/weekly/${uuidParam(id)}`,
  weeklyShare: (id: string) => `/weekly/${uuidParam(id)}/share`,
  mail: () => '/mail',
  mailCategory: (category: 'important' | 'has_deadline' | 'informational' | 'low_priority') =>
    `/mail/category/${category}`,
  mailDetail: (id: string) => `/mail/${uuidParam(id)}`,
  mailReply: (id: string, query?: { mode?: 'reply' | 'follow_up'; draftId?: string }) =>
    withQuery(`/mail/${uuidParam(id)}/reply`, query),
  waiting: (focus?: string) => withQuery('/waiting', { focus }),
  followups: (focus?: string) => withQuery('/followups', { focus }),
  commitments: () => '/commitments',
  commitment: (id: string) => `/commitments/${uuidParam(id)}`,
  life: (id: string) => `/life/${uuidParam(id)}`,
  event: (id: string) => `/event/${uuidParam(id)}`,
  meetingPrep: (eventId: string) => `/meeting/${uuidParam(eventId)}/prep`,
  meetingSummary: (eventId: string) => `/meeting/${uuidParam(eventId)}/summary`,
  meetingPost: (eventId: string) => `/meeting/${uuidParam(eventId)}/post`,
  planProposal: (approvalId: string) => `/plan/proposal/${uuidParam(approvalId)}`,
  planConflict: (insightId: string) => `/plan/conflict/${uuidParam(insightId)}`,
  person: (contactId: string) => `/person/${uuidParam(contactId)}`,
  vip: () => '/vip',
  search: () => '/search',
  memory: () => '/memory',
  voice: () => '/voice',
  capture: () => '/capture',
  captureDetail: (id: string) => `/capture/${uuidParam(id)}`,
  chatNew: (query?: { prompt?: string; contactId?: string; origin?: string }) =>
    withQuery('/chat/new', query),
  chat: (threadId: string) => `/chat/${uuidParam(threadId)}`,
  approvals: () => '/approvals',
  approval: (id: string) => `/approvals/${uuidParam(id)}`,
  reminderNew: (query?: {
    targetType?: string;
    targetId?: string;
    anchorAt?: string;
    title?: string;
    preset?: string;
    mode?: 'remind' | 'snooze';
  }) => withQuery('/reminders/new', query),
  settings: () => '/settings',
  settingsAccounts: () => '/settings/accounts',
  settingsAccount: (id: string) => `/settings/accounts/${uuidParam(id)}`,
  settingsNotifications: () => '/settings/notifications',
  settingsPriorityRule: (id: string) => `/settings/priority-rules/${uuidParam(id)}`,
  paywall: (source?: string) => withQuery('/paywall', { source }),
} as const;

/** `dijitalasistan://mail/…` for an app path. */
export function toDeepLink(path: string): string {
  return `${DEEP_LINK_PREFIX}${path.replace(/^\/+/, '')}`;
}

/** `https://<web-domain>/app/…` universal link for an app path. */
export function toUniversalLink(path: string, webOrigin: string): string {
  return `${webOrigin.replace(/\/+$/, '')}${UNIVERSAL_LINK_PREFIX}/${path.replace(/^\/+/, '')}`;
}

/** Push type used for device-local smart reminders (not a notification_category). */
export type PushType = NotificationCategory | 'reminder';

/**
 * Route for a push tap when `deeplink` is missing or fails the allow-list (M-GL-08 table).
 * The weekly push uses category `evening`; `briefing/[id]` redirects to `weekly/[id]` by kind.
 */
export function routeForNotification(type: PushType, entityId: string | null): string {
  if (!entityId || !isUuid(entityId)) return routes.today();
  switch (type) {
    case 'morning':
    case 'midday':
    case 'evening':
      return routes.briefing(entityId);
    case 'critical_email':
    case 'deadline':
    case 'follow_up':
      return routes.mailDetail(entityId);
    case 'meeting':
      return routes.meetingPrep(entityId);
    case 'life_intel':
      return routes.life(entityId);
    case 'approval':
      return routes.approval(entityId);
    case 'account':
      return routes.settingsAccount(entityId);
    case 'reminder':
      return routes.today();
  }
}

export interface InsightRouteInput {
  readonly id: string;
  readonly kind: InsightKind;
  readonly entity_type: string;
  readonly entity_id: string;
}

/** Where tapping an insight card goes (Today / Flow). */
export function routeForInsight(insight: InsightRouteInput): string {
  const e = insight.entity_id;
  switch (insight.kind) {
    case 'follow_up':
      return routes.followups(insight.id);
    case 'conflict':
      return routes.planConflict(insight.id);
    case 'approval_pending':
      return routes.approval(e);
    case 'schedule_suggestion':
      return insight.entity_type === 'approval_action' ? routes.planProposal(e) : routes.plan();
    case 'meeting':
      return routes.meetingPrep(e);
    case 'commitment':
      return insight.entity_type === 'commitment' ? routes.commitment(e) : routes.commitments();
    case 'life_event':
    case 'security':
      return insight.entity_type === 'life_event' ? routes.life(e) : routes.today();
    case 'digest':
      return insight.entity_type === 'briefing' ? routes.briefing(e) : routes.today();
    case 'reply_needed':
    case 'deadline':
      break;
  }
  switch (insight.entity_type) {
    case 'email_thread':
    case 'email_message':
      return routes.mailDetail(e);
    case 'calendar_event':
      return routes.event(e);
    case 'life_event':
      return routes.life(e);
    case 'commitment':
      return routes.commitment(e);
    case 'capture':
      return routes.captureDetail(e);
    case 'approval_action':
      return routes.approval(e);
    case 'contact':
      return routes.person(e);
    case 'briefing':
      return routes.briefing(e);
    default:
      return routes.plan();
  }
}

/** `deepLinkForInsight()`: the `dijitalasistan://` link of an insight. */
export function deepLinkForInsight(insight: InsightRouteInput): string {
  return toDeepLink(routeForInsight(insight));
}

/** The in-app route that opens a source ("Bu nereden çıktı?" → "Orijinalini aç"). */
export function routeForSource(sourceType: SourceType, sourceId: string): string | null {
  if (!isUuid(sourceId)) return null;
  switch (sourceType) {
    case 'email_message':
    case 'email_thread':
      return routes.mailDetail(sourceId);
    case 'calendar_event':
    case 'device_calendar_event':
      return routes.event(sourceId);
    case 'capture':
      return routes.captureDetail(sourceId);
    case 'commitment':
      return routes.commitment(sourceId);
    case 'life_event':
      return routes.life(sourceId);
    case 'contact':
      return routes.person(sourceId);
    case 'briefing':
      return routes.briefing(sourceId);
    case 'meeting_note':
    case 'post_meeting_note':
    case 'task':
    case 'android_notification':
    case 'assistant_message':
    case 'user_input':
    case 'ai_feedback':
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// OAuth callback (R-07; UT-LINK-01)
// ---------------------------------------------------------------------------------------------

export type OAuthCallbackResult =
  'pending_confirmation' | 'denied' | 'error' | 'expired_state' | 'admin_consent_required';

export interface OAuthCallback {
  readonly provider: Extract<Provider, 'google' | 'microsoft' | 'demo'>;
  readonly result: OAuthCallbackResult;
  readonly completionCode: string | null;
  readonly errorCode: string | null;
  readonly adminConsentUrl: string | null;
}

const OAUTH_RESULTS: readonly OAuthCallbackResult[] = [
  'pending_confirmation',
  'denied',
  'error',
  'expired_state',
  'admin_consent_required',
];
const BASE64URL_RE = /^[A-Za-z0-9_-]{16,256}$/;

/**
 * Validates `/integrations/callback` (or `/oauth/done`) query params. A completion code is only
 * accepted with `pending_confirmation` and never marks an account connected by itself: the app
 * must call `POST /integrations/oauth/complete` (R-07).
 */
export function parseOAuthCallback(query: Readonly<Record<string, string>>): OAuthCallback | null {
  const provider = query.provider;
  if (provider !== 'google' && provider !== 'microsoft' && provider !== 'demo') return null;
  const result = query.result as OAuthCallbackResult | undefined;
  if (!result || !OAUTH_RESULTS.includes(result)) return null;
  const code = query.completion_code ?? null;
  if (result === 'pending_confirmation') {
    if (code === null || !BASE64URL_RE.test(code)) return null;
  } else if (code !== null) {
    return null;
  }
  const consent = query.admin_consent_url ?? null;
  if (
    consent !== null &&
    (result !== 'admin_consent_required' || !consent.startsWith('https://'))
  ) {
    return null;
  }
  const errorCode = query.error_code ?? null;
  if (errorCode !== null && !/^[A-Z][A-Z0-9_]{1,63}$/.test(errorCode)) return null;
  return { provider, result, completionCode: code, errorCode, adminConsentUrl: consent };
}

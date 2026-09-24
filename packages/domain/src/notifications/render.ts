/**
 * Server-side push rendering per detail mode (M§86, C-14, INTEGRATION_PLAN §9.5). Returns i18n
 * keys of the `push` namespace plus ICU params — never hard-coded copy:
 *
 *   full / title_only → `push.<template>.<mode>.title|body`
 *   generic           → `push.generic.title|body` (no params at all)
 *
 * Names and subjects (sensitive params) are passed only in `full`; counts and times (public params)
 * in `full` and `title_only`; `generic` carries nothing, so it can never contain a name or subject.
 * The payload is exactly `{type, entity_id, deeplink}`.
 */
import type { NotificationCategory, NotificationDetail } from '../enums.ts';
import type { PushData } from '../entities/intelligence.ts';
import type { MessageParams, MessageRef, MessageResolver } from '../entities/message.ts';
import { parseDeepLink, routeForNotification, toDeepLink } from '../deeplinks.ts';
import { isUuid } from '../ids.ts';
import type { PushKind } from './channels.ts';

/** Template = category, plus the weekly-review variant of `evening` and smart reminders. */
export type PushTemplate = NotificationCategory | 'weekly' | 'reminder';

/** Sensitive parameter caps (subject ≤40, action summary ≤60, INTEGRATION_PLAN §9.5). */
export const SENSITIVE_PARAM_LIMITS: Readonly<Record<string, number>> = {
  subject: 40,
  title: 40,
  meeting: 40,
  summary: 60,
  sender: 60,
  person: 60,
  action: 80,
  text: 120,
};

/** Hard caps of the ledger columns (`title_rendered` ≤120, `body_rendered` ≤240). */
export const TITLE_MAX = 120;
export const BODY_MAX = 240;

export interface RenderInput {
  readonly template: PushTemplate;
  readonly mode: NotificationDetail;
  /** Counts, times, minutes — allowed in `full` and `title_only`. */
  readonly publicParams?: MessageParams;
  /** Names, subjects, titles — `full` only. */
  readonly sensitiveParams?: Readonly<Record<string, string>>;
  readonly entityId: string | null;
  /** Requested deep link; must pass the M-GL-07 allow-list or the type route is used. */
  readonly deeplink?: string | null;
  readonly webOrigin?: string;
}

export interface RenderedPush {
  readonly title: MessageRef;
  readonly body: MessageRef;
  readonly data: PushData;
}

const ELLIPSIS = '…';

export function truncateParam(value: string, max: number): string {
  const chars = Array.from(value.trim());
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}${ELLIPSIS}`;
}

/** The push kind (payload `type`) of a template. */
export function pushTypeOf(template: PushTemplate): PushKind {
  return template === 'weekly' ? 'evening' : template;
}

/**
 * The payload: exactly `{type, entity_id, deeplink}`. The deep link must be allow-listed;
 * otherwise it is derived from `type` + `entity_id` (M-GL-08).
 */
export function pushData(
  template: PushTemplate,
  entityId: string | null,
  deeplink?: string | null,
  webOrigin?: string,
): PushData {
  const type = pushTypeOf(template);
  const id = entityId && isUuid(entityId) ? entityId : null;
  let link: string;
  const parsed = deeplink
    ? parseDeepLink(deeplink, webOrigin === undefined ? {} : { webOrigin })
    : null;
  if (parsed?.ok) link = toDeepLink(parsed.route.path);
  else if (template === 'weekly' && id) link = toDeepLink(`/weekly/${id}`);
  else link = toDeepLink(routeForNotification(type, id));
  return { type, entity_id: id, deeplink: link };
}

/** `render()`: title/body message references for one detail mode, plus the payload. */
export function render(input: RenderInput): RenderedPush {
  const data = pushData(input.template, input.entityId, input.deeplink, input.webOrigin);
  if (input.mode === 'generic') {
    return {
      title: { key: 'push.generic.title', params: {} },
      body: { key: 'push.generic.body', params: {} },
      data,
    };
  }
  const params: Record<string, string | number> = { ...(input.publicParams ?? {}) };
  if (input.mode === 'full') {
    for (const [k, v] of Object.entries(input.sensitiveParams ?? {})) {
      params[k] = truncateParam(v, SENSITIVE_PARAM_LIMITS[k] ?? 60);
    }
  }
  const prefix = `push.${input.template}.${input.mode}`;
  return {
    title: { key: `${prefix}.title`, params },
    body: { key: `${prefix}.body`, params },
    data,
  };
}

export interface RenderedText {
  readonly title: string;
  readonly body: string;
  readonly data: PushData;
}

/** Resolves a rendered push with the server's catalog lookup and applies the column caps. */
export function renderText(input: RenderInput, resolve: MessageResolver): RenderedText {
  const r = render(input);
  return {
    title: truncateParam(resolve(r.title.key, r.title.params), TITLE_MAX),
    body: truncateParam(resolve(r.body.key, r.body.params), BODY_MAX),
    data: r.data,
  };
}

/** Every catalog key `render()` can produce (checked against `packages/i18n` push namespace). */
export function pushMessageKeys(): string[] {
  const templates: PushTemplate[] = [
    'morning',
    'midday',
    'evening',
    'weekly',
    'critical_email',
    'meeting',
    'deadline',
    'follow_up',
    'life_intel',
    'approval',
    'account',
    'reminder',
  ];
  const keys = ['push.generic.title', 'push.generic.body'];
  for (const t of templates) {
    for (const mode of ['full', 'title_only'] as const) {
      keys.push(`push.${t}.${mode}.title`, `push.${t}.${mode}.body`);
    }
  }
  return keys;
}

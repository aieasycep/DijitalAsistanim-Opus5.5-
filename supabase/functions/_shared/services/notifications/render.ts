/**
 * Server-side push rendering (M§86, C-14, INTEGRATION_PLAN §9.5; default detail `title_only`). The
 * domain `render()` decides which parameters a detail mode may carry (sensitive names and subjects
 * only in `full`, nothing in `generic`) and the payload `{type, entity_id, deeplink}`; the text comes
 * from the `push.<template>.<variant>.<mode>` catalog entry in the user's locale, capped to the
 * ledger columns (title ≤ 120, body ≤ 240).
 */
import {
  androidChannelFor,
  BODY_MAX,
  expoPriorityFor,
  interruptionLevelFor,
  type InterruptionLevel,
  type NotificationDetail,
  type PushData,
  pushTypeOf,
  relevanceScoreFor,
  render,
  TITLE_MAX,
  truncateParam,
  ttlSecondsFor,
} from '@da/domain';
import { type ServerLocale, translate } from '../../i18n/catalog.ts';
import type { NotificationSpec } from './model.ts';

export interface RenderedNotification {
  readonly title: string;
  readonly body: string;
  readonly data: PushData;
}

/** Test pushes prefix the title in `full` and `title_only` (SCREEN_AND_FLOW_MAP §12.3 #8). */
function withTestPrefix(locale: ServerLocale, title: string): string {
  return translate(locale, 'push.test.titlePrefix', { title });
}

export function renderNotification(
  spec: NotificationSpec,
  mode: NotificationDetail,
  locale: ServerLocale,
): RenderedNotification {
  const rendered = render({
    template: spec.template,
    mode,
    publicParams: spec.paramsPublic,
    sensitiveParams: spec.paramsSensitive,
    entityId: spec.entityId,
    deeplink: spec.deeplink,
  });
  const keyFor = (key: string): string =>
    mode === 'generic'
      ? `push.${spec.template}.${spec.variant}.generic.${key.endsWith('.title') ? 'title' : 'body'}`
      : key.replace(
          `push.${spec.template}.${mode}.`,
          `push.${spec.template}.${spec.variant}.${mode}.`,
        );
  let title = translate(locale, keyFor(rendered.title.key), rendered.title.params);
  const body = translate(locale, keyFor(rendered.body.key), rendered.body.params);
  if (spec.userTest && mode !== 'generic') title = withTestPrefix(locale, title);
  return {
    title: truncateParam(title, TITLE_MAX),
    body: truncateParam(body, BODY_MAX),
    data: rendered.data,
  };
}

/** Android channel, iOS interruption level, priority, TTL and relevance of a spec (R-12, §9.4). */
export function deliveryOf(spec: NotificationSpec): {
  channelId: string;
  interruption: InterruptionLevel;
  priority: 'high' | 'normal';
  ttl: number;
  relevanceScore: number;
  kind: ReturnType<typeof pushTypeOf>;
} {
  const kind = spec.kind === 'user_reminder' ? 'reminder' : pushTypeOf(spec.template);
  const interruption =
    spec.interruption ??
    interruptionLevelFor({
      kind,
      minutesToStart: spec.minutesToStart,
      approvalExpiringSoon: spec.approvalExpiringSoon,
    });
  return {
    channelId: androidChannelFor(kind, { fromAndroidNotificationSignal: spec.fromAndroidSignal }),
    interruption,
    priority: expoPriorityFor(kind, interruption),
    ttl: ttlSecondsFor(kind),
    relevanceScore: relevanceScoreFor(kind, spec.urgency),
    kind,
  };
}

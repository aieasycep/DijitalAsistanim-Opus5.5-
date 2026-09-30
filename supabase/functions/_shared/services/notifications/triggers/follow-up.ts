/**
 * Follow-up nudge (Pro · `follow_up`; scheduler_tick step 11): "{kişi} · {konu}" / "{d} gündür yanıt
 * yok. Takip mesajı hazırlayayım mı?" in `full`; "Takip zamanı" / "Yanıt beklediğin bir konuşma var."
 * below it. The per-category cap (2 per rolling 24 h) applies in the decision engine.
 */
import { DAY_MS, deepLinkForInsight, localDate, nudgeKey } from '@da/domain';
import { baseSpec } from '../create.ts';
import { skip, type TriggerContext, type TriggerOutcome } from './types.ts';

export const FOLLOW_UP_VALID_MS = 12 * 3_600_000;

export async function followUpTrigger(ctx: TriggerContext): Promise<TriggerOutcome> {
  const insightId = ctx.payload.insight_id;
  if (insightId === undefined) return skip('missing_insight');
  const insight = await ctx.repo.insight(ctx.userId, insightId);
  if (insight === null || insight.status !== 'open' || insight.kind !== 'follow_up')
    return skip('not_open');
  const since = new Date(insight.event_at ?? insight.created_at);
  const days = Math.max(1, Math.floor((ctx.now.getTime() - since.getTime()) / DAY_MS));
  return {
    kind: 'spec',
    spec: baseSpec({
      category: 'follow_up',
      dedupeKey: nudgeKey(insight.id, localDate(ctx.now, ctx.timeZone)),
      template: 'follow_up',
      variant: 'no_reply',
      urgency: insight.urgency === 'urgent' ? 'urgent' : 'today',
      entityType: insight.entity_type,
      entityId: insight.entity_id,
      deeplink: deepLinkForInsight(insight),
      paramsPublic: { days },
      paramsSensitive: {
        subject: insight.title,
        ...(insight.person === null ? {} : { person: insight.person }),
      },
      validUntil: new Date(ctx.now.getTime() + FOLLOW_UP_VALID_MS),
      entitled: ctx.isPro,
    }),
  };
}

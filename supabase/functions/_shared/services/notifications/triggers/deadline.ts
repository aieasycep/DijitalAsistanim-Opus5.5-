/**
 * Deadline nudge (API_CONTRACTS §11.3; scheduler_tick step 11 in the user's local 09:00–09:15
 * window for open `deadline` insights due before the end of the day): "Son tarih: {başlık}" /
 * "Bugün {HH:mm}'de kapanıyor." in `full`; "Yaklaşan son tarih" below it. Stale at the due time.
 */
import { deepLinkForInsight, formatTime, localDate, nudgeKey } from '@da/domain';
import { withTrCases } from '@da/i18n/tr-suffix';
import { baseSpec } from '../create.ts';
import { skip, type TriggerContext, type TriggerOutcome } from './types.ts';

export async function deadlineTrigger(ctx: TriggerContext): Promise<TriggerOutcome> {
  const insightId = ctx.payload.insight_id;
  if (insightId === undefined) return skip('missing_insight');
  const insight = await ctx.repo.insight(ctx.userId, insightId);
  if (insight === null || insight.status !== 'open' || insight.kind !== 'deadline')
    return skip('not_open');
  if (insight.due_at === null) return skip('no_due_date');
  const due = new Date(insight.due_at);
  if (due.getTime() <= ctx.now.getTime()) return skip('past_due');
  const time = formatTime(due, ctx.timeZone);
  return {
    kind: 'spec',
    spec: baseSpec({
      category: 'deadline',
      dedupeKey: nudgeKey(insight.id, localDate(ctx.now, ctx.timeZone)),
      template: 'deadline',
      variant: 'due_soon',
      urgency: insight.urgency === 'urgent' ? 'urgent' : 'today',
      entityType: insight.entity_type,
      entityId: insight.entity_id,
      deeplink: deepLinkForInsight(insight),
      paramsPublic: withTrCases({ time }),
      paramsSensitive: { title: insight.title },
      validUntil: due,
    }),
  };
}

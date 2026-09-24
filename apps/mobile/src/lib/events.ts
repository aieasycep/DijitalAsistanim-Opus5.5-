/**
 * Analytics emission point (R-21, SECURITY_AND_PRIVACY_PLAN §4.9). Screens call `track()` with a
 * catalogue event from `@da/domain` `ANALYTICS_EVENTS`; the props are validated and sanitised by
 * `validateAnalyticsEvent` (unknown events are dropped, content-like values never pass). Delivery
 * is the batcher of T-8.28 (`POST /analytics/events`, opt-out, MMKV queue), which registers itself
 * with `setAnalyticsSink`; until then validated events are kept in a bounded in-memory buffer that
 * the sink drains when it registers.
 */
import {
  validateAnalyticsEvent,
  type AnalyticsEventName,
  type AnalyticsPropValue,
} from '@da/domain/analytics/index';

export interface TrackedEvent {
  readonly event: AnalyticsEventName;
  readonly props: Readonly<Record<string, AnalyticsPropValue>>;
  readonly occurredAt: string;
}

export type AnalyticsSink = (event: TrackedEvent) => void;

const BUFFER_LIMIT = 100;
let sink: AnalyticsSink | null = null;
const buffer: TrackedEvent[] = [];

/** Registers the delivery sink (T-8.28) and drains the events recorded before it existed. */
export function setAnalyticsSink(next: AnalyticsSink | null): void {
  sink = next;
  if (next === null) return;
  for (const event of buffer.splice(0)) next(event);
}

/** Emits one catalogue event; returns false when validation dropped it. */
export function track(
  name: AnalyticsEventName,
  props: Readonly<Record<string, unknown>> = {},
  now: Date = new Date(),
): boolean {
  const result = validateAnalyticsEvent(name, props);
  if (!result.ok) return false;
  const event: TrackedEvent = {
    event: result.event,
    props: result.props,
    occurredAt: now.toISOString(),
  };
  if (sink !== null) sink(event);
  else {
    buffer.push(event);
    if (buffer.length > BUFFER_LIMIT) buffer.shift();
  }
  return true;
}

/** Test seam: the buffered events. */
export function bufferedEventsForTests(): readonly TrackedEvent[] {
  return buffer;
}

export function resetAnalyticsForTests(): void {
  sink = null;
  buffer.length = 0;
}

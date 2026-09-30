/**
 * Flow data (M-FLOW-01): RPC-05 `flow_feed(p_filter, p_cursor, p_limit)` pages (the header counts
 * come from the same response's `meta`, RPC-20 `flow_meta`), RPC-08 `mail_intelligence` for the
 * digest row, and the pull-to-refresh sync of healthy accounts (`POST /integrations/:accountId/
 * sync`, rate limited server-side: 429 counts as done). Feed rows are parsed with zod; unknown
 * card types are dropped rather than rendered wrongly.
 */
import { qk } from '@da/api-client';
import { callRoute, type ApiClientProviderProps } from '@da/api-client/react';
import { FLOW_CARD_TYPE_VALUES, URGENCY_VALUES, type FlowCardType } from '@da/domain';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { callRpc } from '../../lib/data/rpc';

export const FLOW_FILTERS = [
  'all',
  'important',
  'mail',
  'calendar',
  'followup',
  'personal',
] as const;
export type FlowFilter = (typeof FLOW_FILTERS)[number];

export function isFlowFilter(value: unknown): value is FlowFilter {
  return typeof value === 'string' && (FLOW_FILTERS as readonly string[]).includes(value);
}

const CARD_TYPES = new Set<string>(FLOW_CARD_TYPE_VALUES);

export const FlowSource = z.object({
  source_type: z.string(),
  source_id: z.string().nullable(),
  provider: z.string().nullable(),
  source_timestamp: z.string().nullable(),
});

export const FlowItem = z.object({
  id: z.string(),
  card_type: z.string(),
  kind: z.string(),
  urgency: z.enum(URGENCY_VALUES),
  title: z.string(),
  body: z.string().nullable(),
  why_important: z.string().nullable().optional(),
  decision_tier: z.string().nullable().optional(),
  reason_code: z.string().nullable().optional(),
  entity_type: z.string().nullable(),
  entity_id: z.string().nullable(),
  due_at: z.string().nullable(),
  event_at: z.string().nullable(),
  created_at: z.string(),
  user_corrected: z.boolean().optional(),
  source: FlowSource,
});
export type FlowItemRow = z.infer<typeof FlowItem> & { readonly card_type: FlowCardType };

export const FlowMeta = z.object({
  total: z.number(),
  important: z.number(),
  last_analysis_at: z.string().nullable(),
  accounts: z.array(
    z.object({
      id: z.string(),
      provider: z.string(),
      status: z.string(),
      last_success_at: z.string().nullable(),
    }),
  ),
});
export type FlowMetaData = z.infer<typeof FlowMeta>;

const FlowPage = z.object({
  items: z.array(FlowItem),
  next_cursor: z.string().nullable(),
  meta: FlowMeta,
});

export interface FlowPageData {
  readonly items: readonly FlowItemRow[];
  readonly next_cursor: string | null;
  readonly meta: FlowMetaData;
}

export const FLOW_PAGE_SIZE = 30;

export async function fetchFlowPage(
  filter: FlowFilter,
  cursor: string | null,
): Promise<FlowPageData> {
  const raw = await callRpc('flow_feed', {
    p_filter: filter,
    p_limit: FLOW_PAGE_SIZE,
    ...(cursor === null ? {} : { p_cursor: cursor }),
  });
  const page = FlowPage.parse(raw);
  return {
    ...page,
    items: page.items.filter((item): item is FlowItemRow => CARD_TYPES.has(item.card_type)),
  };
}

/** `['flow', filter]`: persisted, 60 s stale, refetched on focus and every 5 min (§M-FLOW-01). */
export function flowFeedOptions(filter: FlowFilter) {
  return infiniteQueryOptions({
    queryKey: qk.flow.feed(filter),
    queryFn: ({ pageParam }) => fetchFlowPage(filter, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    meta: { persist: true },
  });
}

const MailDigest = z.object({
  total: z.number(),
  attention: z.number(),
  counts: z.record(z.string(), z.number()),
});
export type MailDigestData = z.infer<typeof MailDigest>;

/** The Flow digest row: today's totals from RPC-08 (no rows needed). */
export function mailDigestOptions(localDate: string) {
  return queryOptions({
    queryKey: qk.mail.intel(localDate, 'digest'),
    queryFn: async () =>
      MailDigest.parse(await callRpc('mail_intelligence', { p_local_date: localDate, p_limit: 1 })),
    staleTime: 60_000,
    meta: { persist: true },
  });
}

type Client = ApiClientProviderProps['client'];

/**
 * Pull-to-refresh: one sync per healthy or partial account; a 429 (rate limit, 1/60 s per
 * account) counts as done. Returns whether every call answered.
 */
export async function syncAccounts(
  client: Client,
  accounts: readonly { readonly id: string; readonly status: string }[],
): Promise<boolean> {
  const targets = accounts.filter((a) => a.status === 'healthy' || a.status === 'partial');
  const results = await Promise.allSettled(
    targets.map((a) =>
      callRoute(client, 'POST /integrations/:accountId/sync', {
        params: { accountId: a.id },
        body: {},
      }),
    ),
  );
  return results.every(
    (r) =>
      r.status === 'fulfilled' ||
      (r.reason as { code?: string } | undefined)?.code === 'RATE_LIMITED',
  );
}

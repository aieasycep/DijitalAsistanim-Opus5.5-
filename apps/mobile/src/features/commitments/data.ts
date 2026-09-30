/**
 * Commitments (M-COMMIT-01/02, M§18): open and snoozed promises by direction (due date first),
 * done ones from the last 30 days, and the ambiguous `commitment_create` proposals awaiting a
 * "Bu bir söz mü?" confirmation. The display status is derived in the user's zone.
 */
import { qk } from '@da/api-client';
import { localDate, type CommitmentDirection } from '@da/domain';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { getSupabase } from '../../lib/auth/supabase';
import { now } from '../../lib/clock';
import { unwrap, unwrapMaybe } from '../../lib/data/rpc';

export type DisplayStatus = 'overdue' | 'today' | 'open' | 'snoozed' | 'done' | 'cancelled';

const Evidence = z.array(z.looseObject({ quote: z.string().optional() }));

export interface CommitmentItem {
  readonly id: string;
  readonly direction: CommitmentDirection;
  readonly status: 'open' | 'done' | 'snoozed' | 'cancelled';
  readonly text: string;
  readonly quote: string | null;
  readonly counterparty: string | null;
  readonly contactId: string | null;
  readonly dueAt: string | null;
  readonly dueDateOnly: boolean;
  readonly snoozedUntil: string | null;
  readonly completedAt: string | null;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceProvider: string | null;
  readonly sourceTimestamp: string;
  readonly confidence: number;
  readonly corrected: boolean;
}

const COLUMNS =
  'id,direction,status,text,evidence,counterparty_name,contact_id,due_at,due_is_date_only,snoozed_until,completed_at,source_type,source_id,source_provider,source_timestamp,confidence,user_overrides,contact:contacts(display_name)';

interface Row {
  readonly id: string;
  readonly direction: CommitmentDirection;
  readonly status: CommitmentItem['status'];
  readonly text: string;
  readonly evidence: unknown;
  readonly counterparty_name: string | null;
  readonly contact_id: string | null;
  readonly due_at: string | null;
  readonly due_is_date_only: boolean;
  readonly snoozed_until: string | null;
  readonly completed_at: string | null;
  readonly source_type: string;
  readonly source_id: string;
  readonly source_provider: string | null;
  readonly source_timestamp: string;
  readonly confidence: number;
  readonly user_overrides: unknown;
  readonly contact: { readonly display_name: string } | null;
}

function toItem(row: Row): CommitmentItem {
  const evidence = Evidence.safeParse(row.evidence);
  const overrides = z.record(z.string(), z.unknown()).safeParse(row.user_overrides);
  const textOverride = z
    .looseObject({ value: z.string() })
    .safeParse(overrides.success ? overrides.data.text : undefined);
  return {
    id: row.id,
    direction: row.direction,
    status: row.status,
    text: textOverride.success ? textOverride.data.value : row.text,
    quote:
      (evidence.success ? evidence.data.find((e) => e.quote !== undefined)?.quote : undefined) ??
      null,
    counterparty: row.contact?.display_name ?? row.counterparty_name,
    contactId: row.contact_id,
    dueAt: row.due_at,
    dueDateOnly: row.due_is_date_only,
    snoozedUntil: row.snoozed_until,
    completedAt: row.completed_at,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceProvider: row.source_provider,
    sourceTimestamp: row.source_timestamp,
    confidence: row.confidence,
    corrected: overrides.success && Object.keys(overrides.data).length > 0,
  };
}

/** GECİKMİŞ / BUGÜN / AÇIK / ERTELENDİ / TAMAMLANDI in the user's zone. */
export function displayStatus(
  item: CommitmentItem,
  timeZone: string,
  at: Date = now(),
): DisplayStatus {
  if (item.status === 'done') return 'done';
  if (item.status === 'cancelled') return 'cancelled';
  if (item.status === 'snoozed') return 'snoozed';
  if (item.dueAt === null) return 'open';
  if (localDate(item.dueAt, timeZone) === localDate(at, timeZone)) {
    return item.dueDateOnly || Date.parse(item.dueAt) >= at.getTime() ? 'today' : 'overdue';
  }
  return Date.parse(item.dueAt) < at.getTime() ? 'overdue' : 'open';
}

export interface CommitmentLists {
  readonly active: readonly CommitmentItem[];
  readonly done: readonly CommitmentItem[];
}

export function commitmentsOptions(direction: CommitmentDirection, enabled: boolean) {
  return queryOptions({
    queryKey: qk.commitments.list(direction),
    queryFn: async (): Promise<CommitmentLists> => {
      const supabase = getSupabase();
      const since = new Date(now().getTime() - 30 * 86_400_000).toISOString();
      const [active, done] = await Promise.all([
        supabase
          .from('commitments')
          .select(COLUMNS)
          .eq('direction', direction)
          .in('status', ['open', 'snoozed'])
          .order('due_at', { ascending: true, nullsFirst: false })
          .limit(100),
        supabase
          .from('commitments')
          .select(COLUMNS)
          .eq('direction', direction)
          .eq('status', 'done')
          .gte('completed_at', since)
          .order('completed_at', { ascending: false })
          .limit(50),
      ]);
      return {
        active: (unwrap(active) as unknown as Row[]).map(toItem),
        done: (unwrap(done) as unknown as Row[]).map(toItem),
      };
    },
    staleTime: 60_000,
    meta: { persist: true },
    enabled,
  });
}

export function commitmentOptions(id: string, enabled: boolean) {
  return queryOptions({
    queryKey: qk.commitments.detail(id),
    queryFn: async () => {
      const supabase = getSupabase();
      const row = unwrap(await supabase.from('commitments').select(COLUMNS).eq('id', id).single());
      const reminders = unwrapMaybe(
        await supabase
          .from('reminders')
          .select('id,title,remind_at,notification_id')
          .eq('target_type', 'commitment')
          .eq('target_id', id)
          .eq('status', 'scheduled')
          .order('remind_at', { ascending: true }),
      );
      return { item: toItem(row), reminders: reminders ?? [] };
    },
    staleTime: 60_000,
    meta: { persist: true },
    enabled,
  });
}

const ProposalPayload = z.looseObject({
  text: z.string(),
  direction: z.enum(['user_owes', 'they_owe']),
  counterparty: z
    .looseObject({ name: z.string().optional(), email: z.string().optional() })
    .optional(),
  due_at: z.string().nullable().optional(),
  evidence: z.looseObject({ quote: z.string() }).optional(),
});

export interface CommitmentProposal {
  readonly id: string;
  readonly text: string;
  readonly quote: string | null;
  readonly direction: CommitmentDirection;
  readonly counterparty: string | null;
  readonly dueAt: string | null;
  readonly payloadVersion: number;
  readonly idempotencyKey: string;
  readonly sourceType: string;
  readonly sourceId: string;
}

/** Pending ambiguous proposals ("ONAY BEKLEYEN"). */
export function proposalsOptions(enabled: boolean) {
  return queryOptions({
    queryKey: qk.commitments.proposals(),
    queryFn: async (): Promise<CommitmentProposal[]> => {
      const rows = unwrap(
        await getSupabase()
          .from('approval_actions')
          .select('id,payload,payload_version,idempotency_key,source_type,source_id,what')
          .eq('action_type', 'commitment_create')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(20),
      );
      return rows.flatMap((row) => {
        const payload = ProposalPayload.safeParse(row.payload);
        if (!payload.success) return [];
        return [
          {
            id: row.id,
            text: payload.data.text,
            quote: payload.data.evidence?.quote ?? null,
            direction: payload.data.direction,
            counterparty:
              payload.data.counterparty?.name ?? payload.data.counterparty?.email ?? null,
            dueAt: payload.data.due_at ?? null,
            payloadVersion: row.payload_version,
            idempotencyKey: row.idempotency_key,
            sourceType: row.source_type,
            sourceId: row.source_id,
          },
        ];
      });
    },
    staleTime: 60_000,
    meta: { persist: true },
    enabled,
  });
}

/** The exact source screen of a commitment ("Kaynağı Gör"), when it exists in this build. */
export function sourceRoute(item: Pick<CommitmentItem, 'sourceType' | 'sourceId'>): string | null {
  switch (item.sourceType) {
    case 'email_message':
      return `/mail/${item.sourceId}`;
    case 'capture':
      return `/capture/${item.sourceId}`;
    case 'calendar_event':
      return `/event/${item.sourceId}`;
    default:
      return null;
  }
}

/**
 * Mail data (M-MAIL-01…03): RPC-08 `mail_intelligence` (one call for every count — categories are
 * mutually exclusive and sum to the day's total), the category drill-down paged day by day over
 * the last 7 days, and the Email Detail read model over `email_messages` / `email_threads` /
 * `reply_drafts` with explicit column lists (derived fields only; the raw body is never read
 * here — "Orijinal Mail" is `GET /mail/:messageId/original`, memory only).
 */
import { qk } from '@da/api-client';
import { addDaysToLocalDate, MAIL_CATEGORY_VALUES, type MailCategory } from '@da/domain';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { z } from 'zod';

import { getSupabase } from '../../lib/auth/supabase';
import { callRpc, unwrap, unwrapMaybe } from '../../lib/data/rpc';

export const MAIL_CATEGORIES = MAIL_CATEGORY_VALUES;

export function isMailCategory(value: unknown): value is MailCategory {
  return typeof value === 'string' && (MAIL_CATEGORY_VALUES as readonly string[]).includes(value);
}

/** The drill-down categories (the two reply categories route to Waiting / Follow-ups). */
export const DRILL_CATEGORIES: readonly MailCategory[] = [
  'important',
  'has_deadline',
  'informational',
  'low_priority',
];

const Participant = z.looseObject({
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
});

export const MailRow = z.object({
  thread_id: z.string(),
  connected_account_id: z.string(),
  provider: z.string(),
  subject: z.string().nullable(),
  participants: z.unknown(),
  message_count: z.number(),
  last_message_at: z.string(),
  has_unread: z.boolean(),
  category: z.string().nullable(),
  urgency: z.string().nullable(),
  reply_state: z.string().nullable(),
  ai_summary: z.string().nullable(),
  deadline_at: z.string().nullable(),
});
export type MailRowData = z.infer<typeof MailRow>;

const MailIntel = z.object({
  local_date: z.string(),
  total: z.number(),
  attention: z.number(),
  counts: z.record(z.string(), z.number()),
  rows: z.array(MailRow),
  next_cursor: z.string().nullable(),
});
export type MailIntelData = z.infer<typeof MailIntel>;

/** The sender of a thread row: the first named non-self participant, else the address. */
export function senderOf(row: Pick<MailRowData, 'participants' | 'subject'>): string {
  const parsed = z.array(Participant).safeParse(row.participants);
  if (!parsed.success) return row.subject ?? '';
  const from = parsed.data.find((p) => p.role === 'from') ?? parsed.data[0];
  return from?.name ?? from?.email ?? row.subject ?? '';
}

/** First sentence of the AI summary ("ai_one_liner"), never the raw body. */
export function oneLiner(summary: string | null): string | null {
  if (summary === null || summary.trim() === '') return null;
  const match = /^(.+?[.!?])(\s|$)/.exec(summary.trim());
  return match?.[1] ?? summary.trim();
}

/** `['mail','intel',date,account]`: the digest with the top important threads (persisted). */
export function mailIntelOptions(localDate: string, account: string) {
  return queryOptions({
    queryKey: qk.mail.intel(localDate, account),
    queryFn: async () =>
      MailIntel.parse(
        await callRpc('mail_intelligence', {
          p_local_date: localDate,
          p_category: 'important',
          p_limit: 5,
          ...(account === 'all' ? {} : { p_account_id: account }),
        }),
      ),
    staleTime: 60_000,
    meta: { persist: true },
  });
}

export const CATEGORY_DAYS = 7;

interface CategoryCursor {
  readonly date: string;
  readonly cursor: string | null;
  readonly day: number;
}

export interface CategoryPage {
  readonly date: string;
  readonly rows: readonly MailRowData[];
  readonly next: CategoryCursor | null;
}

/** M-MAIL-02: one category, newest first, day by day for the last 7 days. */
export function mailCategoryOptions(category: MailCategory, account: string, today: string) {
  const initialPageParam: CategoryCursor = { date: today, cursor: null, day: 0 };
  return infiniteQueryOptions({
    queryKey: qk.mail.category(category, account),
    queryFn: async ({ pageParam }): Promise<CategoryPage> => {
      const data = MailIntel.parse(
        await callRpc('mail_intelligence', {
          p_local_date: pageParam.date,
          p_category: category,
          p_limit: 30,
          ...(pageParam.cursor === null ? {} : { p_cursor: pageParam.cursor }),
          ...(account === 'all' ? {} : { p_account_id: account }),
        }),
      );
      const next: CategoryCursor | null =
        data.next_cursor !== null
          ? { date: pageParam.date, cursor: data.next_cursor, day: pageParam.day }
          : pageParam.day + 1 < CATEGORY_DAYS
            ? { date: addDaysToLocalDate(pageParam.date, -1), cursor: null, day: pageParam.day + 1 }
            : null;
      return { date: pageParam.date, rows: data.rows, next };
    },
    initialPageParam,
    getNextPageParam: (last) => last.next,
    staleTime: 60_000,
    meta: { persist: true },
  });
}

/** The newest message of a thread (inbound first): the id `mail/[id]` opens. */
export async function latestMessageId(threadId: string): Promise<string | null> {
  const rows = unwrap(
    await getSupabase()
      .from('email_messages')
      .select('id,direction')
      .eq('thread_id', threadId)
      .order('received_at', { ascending: false })
      .limit(10),
  );
  return (rows.find((r) => r.direction === 'inbound') ?? rows[0])?.id ?? null;
}

export async function threadIdOfMessage(messageId: string): Promise<string | null> {
  const row = unwrapMaybe(
    await getSupabase()
      .from('email_messages')
      .select('thread_id')
      .eq('id', messageId)
      .maybeSingle(),
  );
  return row?.thread_id ?? null;
}

const MESSAGE_COLUMNS =
  'id,thread_id,connected_account_id,provider,direction,from_name,from_email,to_emails,cc_emails,received_at,subject,ai_summary,key_points,ai_status,classification,classification_tier,classification_reason,classification_confidence,has_attachments,attachment_meta,injection_suspected,web_link';

const KeyPoint = z.looseObject({ text: z.string(), kind: z.string().optional() });
const AttachmentMeta = z.looseObject({
  name: z.string(),
  mime: z.string().optional(),
  size: z.number().optional(),
});

export interface EmailDetail {
  readonly message: {
    readonly id: string;
    readonly threadId: string;
    readonly accountId: string;
    readonly provider: string;
    readonly fromName: string | null;
    readonly fromEmail: string;
    readonly to: readonly string[];
    readonly cc: readonly string[];
    readonly receivedAt: string;
    readonly subject: string | null;
    readonly summary: string | null;
    readonly keyPoints: readonly { readonly text: string; readonly kind?: string }[];
    readonly aiStatus: string;
    readonly category: MailCategory | null;
    readonly tier: string | null;
    readonly reason: string | null;
    readonly confidence: number | null;
    readonly attachments: readonly { readonly name: string; readonly size?: number }[];
    readonly injectionSuspected: boolean;
    readonly webLink: string | null;
  };
  readonly thread: {
    readonly providerThreadId: string | null;
    readonly webLink: string | null;
    readonly deadlineAt: string | null;
    readonly urgency: string | null;
  } | null;
  readonly siblings: readonly {
    readonly id: string;
    readonly fromName: string | null;
    readonly fromEmail: string;
    readonly receivedAt: string;
    readonly subject: string | null;
    readonly summary: string | null;
  }[];
  readonly draftId: string | null;
  readonly contactId: string | null;
}

export async function fetchEmailDetail(id: string): Promise<EmailDetail> {
  const supabase = getSupabase();
  const m = unwrap(
    await supabase.from('email_messages').select(MESSAGE_COLUMNS).eq('id', id).single(),
  );
  const [thread, siblings, draft, contact] = await Promise.all([
    supabase
      .from('email_threads')
      .select('provider_thread_id,web_link,deadline_at,urgency')
      .eq('id', m.thread_id)
      .maybeSingle(),
    supabase
      .from('email_messages')
      .select('id,from_name,from_email,received_at,subject,ai_summary')
      .eq('thread_id', m.thread_id)
      .order('received_at', { ascending: true })
      .limit(20),
    supabase
      .from('reply_drafts')
      .select('id')
      .eq('message_id', id)
      .eq('status', 'draft')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('contacts')
      .select('id')
      .contains('emails', [m.from_email.toLowerCase()])
      .limit(1)
      .maybeSingle(),
  ]);
  const t = unwrapMaybe(thread);
  const keyPoints = z.array(KeyPoint).safeParse(m.key_points);
  const attachments = z.array(AttachmentMeta).safeParse(m.attachment_meta);
  return {
    message: {
      id: m.id,
      threadId: m.thread_id,
      accountId: m.connected_account_id,
      provider: m.provider,
      fromName: m.from_name,
      fromEmail: m.from_email,
      to: m.to_emails,
      cc: m.cc_emails,
      receivedAt: m.received_at,
      subject: m.subject,
      summary: m.ai_summary,
      keyPoints: keyPoints.success ? keyPoints.data : [],
      aiStatus: m.ai_status,
      category: isMailCategory(m.classification) ? m.classification : null,
      tier: m.classification_tier,
      reason: m.classification_reason,
      confidence: m.classification_confidence,
      attachments: attachments.success ? attachments.data : [],
      injectionSuspected: m.injection_suspected,
      webLink: m.web_link,
    },
    thread:
      t === null
        ? null
        : {
            providerThreadId: t.provider_thread_id,
            webLink: t.web_link,
            deadlineAt: t.deadline_at,
            urgency: t.urgency,
          },
    siblings: (unwrapMaybe(siblings) ?? [])
      .filter((s) => s.id !== id)
      .map((s) => ({
        id: s.id,
        fromName: s.from_name,
        fromEmail: s.from_email,
        receivedAt: s.received_at,
        subject: s.subject,
        summary: oneLiner(s.ai_summary),
      })),
    draftId: unwrapMaybe(draft)?.id ?? null,
    contactId: unwrapMaybe(contact)?.id ?? null,
  };
}

/** `['mail','message',id]`: derived fields only (persisted). */
export function emailDetailOptions(id: string) {
  return queryOptions({
    queryKey: qk.mail.message(id),
    queryFn: () => fetchEmailDetail(id),
    staleTime: 60_000,
    meta: { persist: true },
  });
}

/**
 * Service-client implementation of the pipeline stores (`store.ts`). Every query is filtered by the
 * job's verified `user_id`; writes go to the documented columns only (no body column exists).
 * User state (insight/commitment/life-event status and `user_overrides`) is never overwritten by
 * a recompute: upserts carry content and provenance columns only.
 */
import type { BriefingKind, LearnedPreference, PriorityRule } from '@da/domain';
import { isoWeekdayOf, localDate } from '@da/domain';
import type { DbClient } from '../../db/clients.ts';
import { DB_FN, rpc } from '../../db/functions.ts';
import { mapDbError } from '../../errors.ts';
import type { LifeEventInsert } from '../life/classify.ts';
import type {
  BriefingStore,
  ContactRef,
  InsightSnapshot,
  InsightStore,
  MailStore,
  MemoryItem,
  MemorySource,
  MemoryStore,
  SenderHistory,
  StatsStore,
  VipSet,
  WeeklyCounts,
} from './store.ts';
import type {
  AccountRow,
  ApprovalRow,
  BriefingItemRow,
  BriefingRow,
  CalendarEventRow,
  CommitmentRow,
  InsightRow,
  LifeEventRow,
  MailMessageRow,
  MailThreadRow,
  MemoryChunkRow,
  TaskRow,
} from './types.ts';
import { commitmentChunkText, lifeChunkText, threadChunkText } from '../memory/chunk.ts';

type Row = Record<string, unknown>;

function check<T>(result: {
  data: T | null;
  error: { code?: string; message?: string } | null;
}): T {
  if (result.error !== null) throw mapDbError(result.error);
  return result.data as T;
}

export const MESSAGE_COLUMNS =
  'id,user_id,connected_account_id,thread_id,provider,provider_message_id,direction,from_email,from_name,to_emails,cc_emails,subject,snippet,sent_at,received_at,labels,list_unsubscribe,auto_submitted,precedence_bulk,dkim_pass,spf_pass,ai_status,classification,classification_tier,classification_reason,classification_rule_id,classification_confidence,key_points,ai_summary,analyzed_at,has_attachments,injection_suspected,life_signal,content_hash,expires_at';
export const THREAD_COLUMNS =
  'id,user_id,connected_account_id,provider,subject,participants,message_count,last_message_at,category,category_tier,category_reason,category_rule_id,category_confidence,urgency,reply_state,ai_summary,key_points,deadline_at,deadline_evidence,rolling_summary,last_processed_message_id,follow_up_state,awaiting_since,expects_reply_message_id,is_muted,analysis_hash,analyzed_at,prompt_version_id,topic_label,expires_at';
const EVENT_COLUMNS =
  'id,provider,title,start_at,end_at,all_day,status,location,is_online,organizer_self,can_modify,attendees,attendee_count,description_excerpt,updated_at';
const PROVENANCE = 'source_type,source_id,source_provider,source_timestamp,confidence,evidence';
const INSIGHT_COLUMNS = `id,kind,status,dedupe_key,urgency,title,body,entity_type,entity_id,due_at,event_at,rank_score,reason_code,created_at,suppression_key,flow_card_type,done_at,${PROVENANCE}`;
const BRIEFING_COLUMNS =
  'id,user_id,kind,local_date,time_zone,scheduled_for,status,generated_at,version,origin,idempotency_key,counts,weekly_stats,evening_ready_at,provenance,job_id';
const ITEM_COLUMNS = `id,user_id,briefing_id,section,position,insight_id,entity_type,entity_id,title,meta,badge,carried_over_to,${PROVENANCE}`;

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));

function normalizeMessage(r: Row): MailMessageRow {
  return {
    ...(r as unknown as MailMessageRow),
    classification_confidence:
      r.classification_confidence === null ? null : num(r.classification_confidence),
  };
}

function normalizeThread(r: Row): MailThreadRow {
  return {
    ...(r as unknown as MailThreadRow),
    category_confidence: r.category_confidence === null ? null : num(r.category_confidence),
  };
}

function withConfidence<T>(r: Row): T {
  return { ...r, confidence: num(r.confidence) } as T;
}

// ── Mail ─────────────────────────────────────────────────────────────────────

export function supabaseMailStore(db: DbClient): MailStore {
  return {
    async account(accountId) {
      const data = check(
        await db
          .from('connected_accounts')
          .select('id,user_id,provider,account_email,status,data_source_toggles')
          .eq('id', accountId)
          .maybeSingle(),
      );
      return (data as AccountRow | null) ?? null;
    },
    async messages(ids) {
      if (ids.length === 0) return [];
      const data = check(
        await db
          .from('email_messages')
          .select(MESSAGE_COLUMNS)
          .in('id', [...ids]),
      );
      return ((data ?? []) as Row[]).map(normalizeMessage);
    },
    async threads(ids) {
      if (ids.length === 0) return [];
      const data = check(
        await db
          .from('email_threads')
          .select(THREAD_COLUMNS)
          .in('id', [...ids]),
      );
      return ((data ?? []) as Row[]).map(normalizeThread);
    },
    async threadMessages(threadId, limit) {
      const data = check(
        await db
          .from('email_messages')
          .select(MESSAGE_COLUMNS)
          .eq('thread_id', threadId)
          .is('provider_deleted_at', null)
          .order('received_at', { ascending: false })
          .limit(limit),
      );
      return ((data ?? []) as Row[]).map(normalizeMessage).reverse();
    },
    async ownAddresses(userId) {
      const data = check(
        await db
          .from('connected_accounts')
          .select('account_email')
          .eq('user_id', userId)
          .is('disconnected_at', null),
      );
      return ((data ?? []) as { account_email: string | null }[])
        .map((r) => r.account_email?.toLowerCase() ?? '')
        .filter((e) => e !== '');
    },
    async rules(userId) {
      const data = check(
        await db
          .from('priority_rules')
          .select('*')
          .eq('user_id', userId)
          .eq('enabled', true)
          .is('deleted_at', null)
          .order('sort_order'),
      );
      return (data ?? []) as PriorityRule[];
    },
    async learned(userId) {
      const data = check(await db.from('learned_preferences').select('*').eq('user_id', userId));
      return (data ?? []) as LearnedPreference[];
    },
    async vip(userId) {
      return await loadVip(db, userId);
    },
    async senderHistory(userId, emails, since): Promise<SenderHistory> {
      if (emails.length === 0) return { known: new Set(), repliedBefore: new Set() };
      const data = check(
        await db
          .from('contacts')
          .select('primary_email,emails,last_inbound_at,last_outbound_at')
          .eq('user_id', userId)
          .overlaps('emails', [...emails]),
      );
      const known = new Set<string>();
      const replied = new Set<string>();
      for (const c of (data ?? []) as Row[]) {
        const addresses = [c.primary_email, ...((c.emails as string[]) ?? [])]
          .filter((e): e is string => typeof e === 'string')
          .map((e) => e.toLowerCase());
        const outbound = typeof c.last_outbound_at === 'string';
        const inboundRecent =
          typeof c.last_inbound_at === 'string' && Date.parse(c.last_inbound_at) >= since.getTime();
        for (const a of addresses) {
          if (outbound) replied.add(a);
          if (outbound && inboundRecent) known.add(a);
        }
      }
      return { known, repliedBefore: replied };
    },
    async updateMessage(id, patch) {
      check(await db.from('email_messages').update(patch).eq('id', id));
    },
    async updateThread(id, patch) {
      check(await db.from('email_threads').update(patch).eq('id', id));
    },
    async upsertContacts(userId, people) {
      if (people.length === 0) return {};
      return await rpc<Record<string, string>>(db, DB_FN.upsertContactsFromPeople, {
        p_user: userId,
        p_people: people,
      });
    },
    async linkContacts(userId, threadIds, eventIds) {
      await rpc<number>(db, DB_FN.linkContactRefs, {
        p_user: userId,
        p_thread_ids: [...threadIds],
        p_event_ids: [...eventIds],
      });
    },
    async refreshContactStats(userId, contactIds) {
      await rpc<number>(db, DB_FN.refreshContactStats, {
        p_user: userId,
        p_contact_ids: contactIds === null ? null : [...contactIds],
      });
    },
    async contactsByEmail(userId, emails) {
      if (emails.length === 0) return [];
      const data = check(
        await db
          .from('contacts')
          .select('id,display_name,emails')
          .eq('user_id', userId)
          .is('merged_into_id', null)
          .overlaps(
            'emails',
            emails.map((e) => e.toLowerCase()),
          ),
      );
      return (data ?? []) as ContactRef[];
    },
    async upsertLifeEvents(rows: readonly LifeEventInsert[]) {
      if (rows.length === 0) return [];
      const data = check(
        await db
          .from('life_events')
          .upsert([...rows], { onConflict: 'user_id,dedupe_key' })
          .select('id,dedupe_key'),
      );
      return (data ?? []) as { id: string; dedupe_key: string }[];
    },
    async upsertCommitments(rows) {
      if (rows.length === 0) return [];
      const data = check(
        await db
          .from('commitments')
          .upsert([...rows], { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true })
          .select('id,dedupe_key'),
      );
      return (data ?? []) as { id: string; dedupe_key: string }[];
    },
    async insertApprovals(rows) {
      let inserted = 0;
      for (const row of rows) {
        const pending = check(
          await db
            .from('approval_actions')
            .select('id')
            .eq('user_id', row.user_id)
            .eq('origin', row.origin)
            .eq('action_type', row.action_type)
            .eq('origin_ref_id', row.origin_ref_id ?? '')
            .eq('status', 'pending')
            .limit(1),
        );
        if (((pending ?? []) as Row[]).length > 0) continue;
        const data = check(
          await db
            .from('approval_actions')
            .upsert([row], { onConflict: 'idempotency_key', ignoreDuplicates: true })
            .select('id'),
        );
        inserted += ((data ?? []) as Row[]).length;
      }
      return inserted;
    },
    async events(userId, from, to) {
      const data = check(
        await db
          .from('calendar_events')
          .select(EVENT_COLUMNS)
          .eq('user_id', userId)
          .is('provider_deleted_at', null)
          .lt('start_at', to.toISOString())
          .gt('end_at', from.toISOString())
          .order('start_at'),
      );
      return (data ?? []) as CalendarEventRow[];
    },
    async upsertInsights(rows) {
      return await upsertInsightRows(db, rows);
    },
  };
}

async function loadVip(db: DbClient, userId: string): Promise<VipSet> {
  const data = check(
    await db
      .from('vip_people')
      .select('contact_id,always_notify,contacts(primary_email,emails)')
      .eq('user_id', userId),
  );
  const contactIds: string[] = [];
  const emails: string[] = [];
  const notifyOff: string[] = [];
  for (const v of (data ?? []) as Row[]) {
    const contact = (v.contacts ?? {}) as Row;
    contactIds.push(String(v.contact_id));
    const addresses = [contact.primary_email, ...((contact.emails as string[] | null) ?? [])]
      .filter((e): e is string => typeof e === 'string')
      .map((e) => e.toLowerCase());
    emails.push(...addresses);
    if (v.always_notify === false) notifyOff.push(String(v.contact_id));
  }
  return { contactIds, emails: [...new Set(emails)], notifyOff };
}

async function upsertInsightRows(db: DbClient, rows: readonly Row[] | readonly object[]) {
  if (rows.length === 0) return [];
  const data = check(
    await db
      .from('insights')
      .upsert([...(rows as Row[])], { onConflict: 'user_id,dedupe_key' })
      .select('id,dedupe_key'),
  );
  return (data ?? []) as { id: string; dedupe_key: string }[];
}

// ── Insights ─────────────────────────────────────────────────────────────────

export function supabaseInsightStore(db: DbClient): InsightStore {
  return {
    async snapshot(userId, now): Promise<InsightSnapshot> {
      const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
      const [threads, commitments, life, events, tasks, approvals, insights, own, vip, prefs] =
        await Promise.all([
          db
            .from('email_threads')
            .select(THREAD_COLUMNS)
            .eq('user_id', userId)
            .gte('last_message_at', since)
            .or('reply_state.neq.none,deadline_at.not.is.null')
            // Threads deleted or archived at the provider leave the Flow (INTEGRATION_PLAN §3.13):
            // their open insights are expired by the rebuild.
            .gt('message_count', 0)
            .overlaps('labels', ['INBOX', 'SENT'])
            .order('last_message_at', { ascending: false })
            .limit(300),
          db
            .from('commitments')
            .select(
              `id,contact_id,counterparty_name,direction,text,due_at,due_is_date_only,status,completed_at,${PROVENANCE}`,
            )
            .eq('user_id', userId)
            .or(`status.eq.open,completed_at.gte.${since}`)
            .limit(300),
          db
            .from('life_events')
            .select(
              `id,type,title,status,event_at,due_at,payload,amount,currency,tracking_url,suppressed,resolved_at,updated_at,${PROVENANCE}`,
            )
            .eq('user_id', userId)
            .eq('status', 'open')
            .eq('suppressed', false)
            .limit(300),
          db
            .from('calendar_events')
            .select(EVENT_COLUMNS)
            .eq('user_id', userId)
            .is('provider_deleted_at', null)
            .gt('end_at', new Date(now.getTime() - 86_400_000).toISOString())
            .lt('start_at', new Date(now.getTime() + 8 * 86_400_000).toISOString())
            .order('start_at')
            .limit(500),
          db
            .from('tasks')
            .select(
              'id,title,due_date,due_at,status,completed_at,connected_account_id,provider,source_type,source_id,created_at',
            )
            .eq('user_id', userId)
            .or(`status.eq.open,completed_at.gte.${since}`)
            .limit(300),
          db
            .from('approval_actions')
            .select('id,action_type,status,what,approval_expires_at,executed_at,created_at')
            .eq('user_id', userId)
            .eq('status', 'pending')
            .limit(100),
          db
            .from('insights')
            .select(INSIGHT_COLUMNS)
            .eq('user_id', userId)
            .gte('updated_at', since)
            .limit(1000),
          supabaseMailStore(db).ownAddresses(userId),
          loadVip(db, userId),
          db
            .from('learned_preferences')
            .select('target_type,target_ref,effect,enabled,deleted_at')
            .eq('user_id', userId),
        ]);
      const threadRows = (check(threads) as Row[]).map(normalizeThread);
      const replyThreads = threadRows
        .filter((t) => t.reply_state === 'awaiting_my_reply')
        .map((t) => t.id);
      const latest: MailMessageRow[] = [];
      if (replyThreads.length > 0) {
        const msgs = check(
          await db
            .from('email_messages')
            .select(MESSAGE_COLUMNS)
            .in('thread_id', replyThreads)
            .eq('direction', 'inbound')
            .order('received_at', { ascending: false })
            .limit(replyThreads.length * 5),
        );
        const seen = new Set<string>();
        for (const m of ((msgs ?? []) as Row[]).map(normalizeMessage)) {
          if (seen.has(m.thread_id)) continue;
          seen.add(m.thread_id);
          latest.push(m);
        }
      }
      const muted: string[] = [];
      const mutedContactIds: string[] = [];
      for (const p of (check(prefs) ?? []) as Row[]) {
        const effect = (p.effect ?? {}) as Row;
        if (effect.follow_up !== 'mute' || p.enabled === false || p.deleted_at !== null) continue;
        if (p.target_type === 'sender') muted.push(String(p.target_ref).toLowerCase());
        if (p.target_type === 'contact') mutedContactIds.push(String(p.target_ref));
      }
      if (mutedContactIds.length > 0) {
        const contacts = check(
          await db.from('contacts').select('emails').in('id', mutedContactIds),
        );
        for (const c of (contacts ?? []) as Row[])
          muted.push(...((c.emails as string[]) ?? []).map((e) => e.toLowerCase()));
      }
      const domains = [...new Set(own.map((a) => a.split('@')[1] ?? '').filter((d) => d !== ''))];
      return {
        threads: threadRows,
        latestInbound: latest,
        commitments: (check(commitments) as Row[]).map((r) => withConfidence<CommitmentRow>(r)),
        lifeEvents: (check(life) as Row[]).map((r) => withConfidence<LifeEventRow>(r)),
        events: check(events) as CalendarEventRow[],
        tasks: check(tasks) as TaskRow[],
        approvals: check(approvals) as ApprovalRow[],
        insights: (check(insights) as Row[]).map((r) => ({
          ...withConfidence<InsightRow>(r),
          rank_score: num(r.rank_score),
        })),
        vip,
        ownAddresses: own,
        ownDomains: domains,
        mutedContacts: [...new Set(muted)],
      };
    },
    upsertInsights: (rows) => upsertInsightRows(db, rows),
    async expireInsights(userId, ids) {
      if (ids.length === 0) return;
      check(
        await db
          .from('insights')
          .update({ status: 'expired' })
          .eq('user_id', userId)
          .in('id', [...ids])
          .in('status', ['open', 'snoozed']),
      );
    },
    async updateThreads(patches) {
      for (const p of patches) check(await db.from('email_threads').update(p.patch).eq('id', p.id));
    },
  };
}

// ── Briefings ────────────────────────────────────────────────────────────────

export interface BriefingJobStore extends BriefingStore {
  /** Weekly briefings awaiting a batch narrative, by their generating job ids. */
  byJobIds(jobIds: readonly string[]): Promise<BriefingRow[]>;
  recordBatch(row: {
    batch_id: string;
    feature: string;
    request_count: number;
    correlation_id: string | null;
  }): Promise<void>;
  updateBatch(batchId: string, patch: Record<string, unknown>): Promise<void>;
}

export function supabaseBriefingStore(db: DbClient): BriefingJobStore {
  const one = async (
    q: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>,
  ) => (check(await q) as BriefingRow | null) ?? null;
  return {
    byId: (id) => one(db.from('briefings').select(BRIEFING_COLUMNS).eq('id', id).maybeSingle()),
    forDate: (userId, kind: BriefingKind, day) =>
      one(
        db
          .from('briefings')
          .select(BRIEFING_COLUMNS)
          .eq('user_id', userId)
          .eq('kind', kind)
          .eq('local_date', day)
          .maybeSingle(),
      ),
    async ensure(row) {
      check(
        await db
          .from('briefings')
          .upsert([row], { onConflict: 'user_id,kind,local_date', ignoreDuplicates: true }),
      );
      const found = await one(
        db
          .from('briefings')
          .select(BRIEFING_COLUMNS)
          .eq('user_id', row.user_id)
          .eq('kind', row.kind)
          .eq('local_date', row.local_date)
          .maybeSingle(),
      );
      if (found === null) throw new Error('briefing_ensure_failed');
      return found;
    },
    async update(id, patch) {
      check(await db.from('briefings').update(patch).eq('id', id));
    },
    async replaceItems(briefingId, rows) {
      check(
        await db
          .from('briefing_items')
          .delete()
          .eq('briefing_id', briefingId)
          .is('carried_over_to', null),
      );
      if (rows.length > 0) check(await db.from('briefing_items').insert([...rows]));
    },
    async items(briefingId) {
      const data = check(
        await db
          .from('briefing_items')
          .select(ITEM_COLUMNS)
          .eq('briefing_id', briefingId)
          .order('section')
          .order('position'),
      );
      return ((data ?? []) as Row[]).map((r) => withConfidence<BriefingItemRow>(r));
    },
    async carriedTo(userId, day) {
      const data = check(
        await db
          .from('briefing_items')
          .select(ITEM_COLUMNS)
          .eq('user_id', userId)
          .eq('carried_over_to', day)
          .is('done_at', null)
          .order('position'),
      );
      return ((data ?? []) as Row[]).map((r) => withConfidence<BriefingItemRow>(r));
    },
    async byJobIds(jobIds) {
      if (jobIds.length === 0) return [];
      const data = check(
        await db
          .from('briefings')
          .select(BRIEFING_COLUMNS)
          .in('job_id', [...jobIds]),
      );
      return (data ?? []) as BriefingRow[];
    },
    async recordBatch(row) {
      check(
        await db.from('ai_batches').insert({
          provider: 'anthropic',
          batch_id: row.batch_id,
          feature: row.feature,
          status: 'submitted',
          request_count: row.request_count,
          submitted_at: new Date().toISOString(),
          correlation_id: row.correlation_id,
        }),
      );
    },
    async updateBatch(batchId, patch) {
      check(
        await db
          .from('ai_batches')
          .update(patch)
          .eq('provider', 'anthropic')
          .eq('batch_id', batchId),
      );
    },
  };
}

// ── Stats ────────────────────────────────────────────────────────────────────

async function count(
  q: PromiseLike<{ count: number | null; error: { code?: string; message?: string } | null }>,
) {
  const r = await q;
  if (r.error !== null) throw mapDbError(r.error);
  return r.count ?? 0;
}

const ATTENTION = ['important', 'awaiting_my_reply', 'has_deadline'];

export function supabaseStatsStore(db: DbClient): StatsStore {
  return {
    async mailCounts(userId, from, to) {
      const range = (q: ReturnType<ReturnType<DbClient['from']>['select']>) =>
        q
          .eq('user_id', userId)
          .gte('received_at', from.toISOString())
          .lt('received_at', to.toISOString());
      const [total, attention, calendars] = await Promise.all([
        count(
          range(db.from('email_messages').select('id', { count: 'exact', head: true })).eq(
            'direction',
            'inbound',
          ),
        ),
        count(
          range(db.from('email_messages').select('id', { count: 'exact', head: true }))
            .eq('direction', 'inbound')
            .in('classification', ATTENTION),
        ),
        count(
          db
            .from('calendar_events')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .gte('start_at', from.toISOString())
            .lt('start_at', to.toISOString()),
        ),
      ]);
      return { total, attention, calendars };
    },
    async weekly(userId, from, to, timeZone): Promise<WeeklyCounts> {
      const f = from.toISOString();
      const t = to.toISOString();
      const [
        mails,
        important,
        prepNotes,
        opened,
        followups,
        answered,
        deadlines,
        drafts,
        eventsRes,
        deadlineRows,
      ] = await Promise.all([
        count(
          db
            .from('email_messages')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('direction', 'inbound')
            .in('ai_status', ['classified', 't0_final'])
            .gte('received_at', f)
            .lt('received_at', t),
        ),
        count(
          db
            .from('email_messages')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .in('classification', ATTENTION)
            .gte('received_at', f)
            .lt('received_at', t),
        ),
        count(
          db
            .from('meeting_preps')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .gte('generated_at', f)
            .lt('generated_at', t),
        ),
        count(
          db
            .from('analytics_events')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('event_name', 'meeting_prep_opened')
            .gte('occurred_at', f)
            .lt('occurred_at', t),
        ),
        count(
          db
            .from('email_threads')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .gte('awaiting_since', f)
            .lt('awaiting_since', t),
        ),
        count(
          db
            .from('email_threads')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .gte('awaiting_since', f)
            .lt('awaiting_since', t)
            .eq('follow_up_state', 'resolved'),
        ),
        count(
          db
            .from('insights')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('kind', 'deadline')
            .gte('due_at', f)
            .lt('due_at', t),
        ),
        count(
          db
            .from('reply_drafts')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('status', 'sent')
            .gte('updated_at', f)
            .lt('updated_at', t),
        ),
        db
          .from('calendar_events')
          .select('start_at,end_at,status,all_day,attendee_count,is_online')
          .eq('user_id', userId)
          .is('provider_deleted_at', null)
          .gte('start_at', f)
          .lt('start_at', t),
        db
          .from('insights')
          .select('created_at,due_at')
          .eq('user_id', userId)
          .eq('kind', 'deadline')
          .gte('due_at', f)
          .lt('due_at', t),
      ]);
      const events = ((check(eventsRes) ?? []) as Row[]).filter(
        (e) =>
          e.status !== 'cancelled' &&
          e.all_day !== true &&
          (num(e.attendee_count) > 1 || e.is_online === true),
      );
      const byWeekday: Record<number, number> = {};
      const byDay = new Map<string, { start: number; end: number }[]>();
      for (const e of events) {
        const day = localDate(String(e.start_at), timeZone);
        const wd = isoWeekdayOf(day);
        byWeekday[wd] = (byWeekday[wd] ?? 0) + 1;
        const list = byDay.get(day) ?? [];
        list.push({ start: Date.parse(String(e.start_at)), end: Date.parse(String(e.end_at)) });
        byDay.set(day, list);
      }
      let busiest: WeeklyCounts['busiest'] = null;
      for (const [day, list] of byDay) {
        if (busiest !== null && list.length <= busiest.meetings) continue;
        const sorted = list.sort((a, b) => a.start - b.start);
        let gap = 0;
        for (let i = 1; i < sorted.length; i++) {
          gap = Math.max(gap, Math.round((sorted[i]!.start - sorted[i - 1]!.end) / 60_000));
        }
        busiest = {
          weekday: isoWeekdayOf(day),
          meetings: list.length,
          maxGapMin: Math.max(0, gap),
        };
      }
      const inTime = ((check(deadlineRows) ?? []) as Row[]).filter(
        (d) => Date.parse(String(d.created_at)) < Date.parse(String(d.due_at)),
      ).length;
      return {
        mailsAnalyzed: mails,
        importantCount: important,
        meetings: events.length,
        prepNotes,
        prepNotesOpened: Math.min(opened, prepNotes),
        followups,
        followupsAnswered: answered,
        deadlines,
        deadlinesSurfacedInTime: Math.min(inTime, deadlines),
        draftsSent: drafts,
        meetingsByWeekday: byWeekday,
        busiest,
      };
    },
    async freshness(userId) {
      const data = check(
        await db
          .from('connected_accounts')
          .select('provider,status,last_successful_sync_at')
          .eq('user_id', userId)
          .is('disconnected_at', null),
      );
      return {
        accounts: ((data ?? []) as Row[]).map((a) => ({
          provider: a.provider,
          status: a.status,
          last_sync_at: a.last_successful_sync_at ?? null,
        })),
      };
    },
  };
}

// ── Memory ───────────────────────────────────────────────────────────────────

export function supabaseMemoryStore(db: DbClient): MemoryStore {
  return {
    async sources(userId, items: readonly MemoryItem[]) {
      const ids = (kind: MemoryItem['kind']) =>
        items.filter((i) => i.kind === kind).map((i) => i.id);
      const out: MemorySource[] = [];
      const threadIds = ids('email_summary');
      if (threadIds.length > 0) {
        const threads = (
          (check(
            await db
              .from('email_threads')
              .select(THREAD_COLUMNS)
              .eq('user_id', userId)
              .in('id', threadIds),
          ) ?? []) as Row[]
        ).map(normalizeThread);
        for (const t of threads) {
          const summary = t.rolling_summary ?? t.ai_summary;
          const points = (t.key_points as { text?: string }[])
            .map((k) => k.text ?? '')
            .filter((k) => k !== '');
          if (summary === null && points.length === 0) continue;
          out.push({
            userId,
            chunkKind: 'thread_summary',
            sourceType: 'email_thread',
            sourceId: t.id,
            sourceProvider: t.provider,
            sourceTimestamp: t.last_message_at,
            occurredAt: t.last_message_at,
            confidence: t.category_confidence ?? 0.8,
            evidence: (t.deadline_evidence ?? []).slice(0, 5),
            contactIds: t.participants.flatMap((p) => (p.contact_id ? [p.contact_id] : [])),
            content: threadChunkText({
              subject: t.subject,
              people: t.participants.map((p) => p.name ?? p.email).slice(0, 6),
              date: localDate(t.last_message_at, 'UTC'),
              summary,
              keyPoints: points,
              topic: t.topic_label,
            }),
            expiresAt: t.expires_at,
          });
        }
      }
      const lifeIds = ids('life_event');
      if (lifeIds.length > 0) {
        const rows = (check(
          await db
            .from('life_events')
            .select(
              `id,type,title,event_at,due_at,payload,amount,currency,expires_at,${PROVENANCE}`,
            )
            .eq('user_id', userId)
            .in('id', lifeIds),
        ) ?? []) as Row[];
        for (const r of rows) {
          out.push({
            userId,
            chunkKind: 'life_event',
            sourceType: 'life_event',
            sourceId: String(r.id),
            sourceProvider: (r.source_provider as MemorySource['sourceProvider']) ?? null,
            sourceTimestamp: String(r.source_timestamp),
            occurredAt: String(r.event_at ?? r.due_at ?? r.source_timestamp),
            confidence: num(r.confidence),
            evidence: ((r.evidence as MemorySource['evidence']) ?? []).slice(0, 5),
            contactIds: [],
            content: lifeChunkText({
              title: String(r.title),
              type: String(r.type),
              when: (r.event_at ?? r.due_at ?? null) as string | null,
              amount:
                r.amount === null ? null : `${String(r.amount)} ${String(r.currency ?? '')}`.trim(),
              fields: (r.payload ?? {}) as Row,
            }),
            expiresAt: (r.expires_at as string | null) ?? null,
          });
        }
      }
      const commitmentIds = ids('commitment');
      if (commitmentIds.length > 0) {
        const rows = (check(
          await db
            .from('commitments')
            .select(
              `id,contact_id,counterparty_name,direction,text,due_at,created_at,expires_at,${PROVENANCE}`,
            )
            .eq('user_id', userId)
            .in('id', commitmentIds),
        ) ?? []) as Row[];
        for (const r of rows) {
          out.push({
            userId,
            chunkKind: 'commitment',
            sourceType: 'commitment',
            sourceId: String(r.id),
            sourceProvider: null,
            sourceTimestamp: String(r.source_timestamp),
            occurredAt: String(r.created_at),
            confidence: num(r.confidence),
            evidence: ((r.evidence as MemorySource['evidence']) ?? []).slice(0, 5),
            contactIds: r.contact_id === null ? [] : [String(r.contact_id)],
            content: commitmentChunkText({
              direction: r.direction as 'user_owes' | 'they_owe',
              text: String(r.text),
              counterparty: (r.counterparty_name as string | null) ?? null,
              due: (r.due_at as string | null) ?? null,
            }),
            expiresAt: (r.expires_at as string | null) ?? null,
          });
        }
      }
      const captureIds = ids('capture');
      if (captureIds.length > 0) {
        const rows = (check(
          await db
            .from('captures')
            .select('id,extracted,created_at,expires_at,status')
            .eq('user_id', userId)
            .in('id', captureIds)
            .neq('status', 'discarded'),
        ) ?? []) as Row[];
        for (const r of rows) {
          const items = ((r.extracted as Row[]) ?? []).map((x) =>
            Object.entries(x)
              .filter(([, v]) => typeof v === 'string' && v !== '')
              .map(([k, v]) => `${k}: ${String(v)}`)
              .slice(0, 6)
              .join(' · '),
          );
          if (items.length === 0) continue;
          out.push({
            userId,
            chunkKind: 'capture_extract',
            sourceType: 'capture',
            sourceId: String(r.id),
            sourceProvider: null,
            sourceTimestamp: String(r.created_at),
            occurredAt: String(r.created_at),
            confidence: 0.85,
            evidence: [],
            contactIds: [],
            content: items.join('\n'),
            expiresAt: (r.expires_at as string | null) ?? null,
          });
        }
      }
      const noteIds = ids('meeting_note');
      if (noteIds.length > 0) {
        const rows = (check(
          await db
            .from('meeting_notes')
            .select('id,calendar_event_id,kind,body,created_at,expires_at')
            .eq('user_id', userId)
            .in('id', noteIds),
        ) ?? []) as Row[];
        for (const r of rows) {
          out.push({
            userId,
            chunkKind: 'meeting_note',
            sourceType: r.kind === 'post_meeting' ? 'post_meeting_note' : 'meeting_note',
            sourceId: String(r.id),
            sourceProvider: null,
            sourceTimestamp: String(r.created_at),
            occurredAt: String(r.created_at),
            confidence: 1,
            evidence: [],
            contactIds: [],
            content: String(r.body),
            expiresAt: (r.expires_at as string | null) ?? null,
          });
        }
      }
      const factIds = ids('assistant_fact');
      if (factIds.length > 0) {
        const rows = (check(
          await db
            .from('assistant_messages')
            .select('id,role,content,created_at,expires_at')
            .eq('user_id', userId)
            .eq('role', 'user')
            .in('id', factIds),
        ) ?? []) as Row[];
        for (const r of rows) {
          out.push({
            userId,
            chunkKind: 'person_fact',
            sourceType: 'assistant_message',
            sourceId: String(r.id),
            sourceProvider: null,
            sourceTimestamp: String(r.created_at),
            occurredAt: String(r.created_at),
            confidence: 1,
            evidence: [],
            contactIds: [],
            content: String(r.content),
            expiresAt: (r.expires_at as string | null) ?? null,
          });
        }
      }
      const personIds = ids('person_profile');
      if (personIds.length > 0) {
        const rows = (check(
          await db
            .from('contacts')
            .select('id,display_name,organization,title,primary_email,last_contact_at,updated_at')
            .eq('user_id', userId)
            .in('id', personIds),
        ) ?? []) as Row[];
        for (const r of rows) {
          const topics = (check(
            await db
              .from('email_threads')
              .select('topic_label')
              .eq('user_id', userId)
              .not('topic_label', 'is', null)
              .contains('participants', [{ contact_id: String(r.id) }])
              .order('last_message_at', { ascending: false })
              .limit(5),
          ) ?? []) as Row[];
          out.push({
            userId,
            chunkKind: 'person_fact',
            sourceType: 'contact',
            sourceId: String(r.id),
            sourceProvider: null,
            sourceTimestamp: String(r.updated_at),
            occurredAt: String(r.last_contact_at ?? r.updated_at),
            confidence: 1,
            evidence: [],
            contactIds: [String(r.id)],
            content: [
              String(r.display_name),
              r.organization === null ? '' : `Kurum: ${String(r.organization)}`,
              r.title === null ? '' : `Unvan: ${String(r.title)}`,
              topics.length === 0
                ? ''
                : `Konular: ${topics.map((x) => String(x.topic_label)).join(', ')}`,
            ]
              .filter((s) => s !== '')
              .join('\n'),
            expiresAt: null,
          });
        }
      }
      return out;
    },
    async upsertChunks(rows) {
      if (rows.length === 0) return [];
      // `memory_chunks` carries ⟨PROV⟩ only (DATABASE_AND_RLS_PLAN §memory_chunks): the verified
      // evidence stays with the in-memory chunk and is not a column.
      const payload = rows.map(({ evidence: _evidence, ...r }) => ({
        ...r,
        content_hash: `\\x${r.content_hash}`,
      }));
      const data = check(
        await db
          .from('memory_chunks')
          .upsert(payload, {
            onConflict: 'user_id,source_type,source_id,chunk_kind,content_hash',
            ignoreDuplicates: true,
          })
          .select('id,user_id,content,embedding_model'),
      );
      // A changed source replaces its previous chunk (same source and kind, other content).
      for (const r of rows) {
        check(
          await db
            .from('memory_chunks')
            .delete()
            .eq('user_id', r.user_id)
            .eq('source_type', r.source_type)
            .eq('source_id', r.source_id)
            .eq('chunk_kind', r.chunk_kind)
            .neq('content_hash', `\\x${r.content_hash}`),
        );
      }
      return (data ?? []) as MemoryChunkRow[];
    },
    async pendingChunks(userId, ids, limit) {
      let q = db
        .from('memory_chunks')
        .select('id,user_id,content,embedding_model')
        .eq('user_id', userId)
        .is('embedding_model', null)
        .limit(limit);
      if (ids !== null) q = q.in('id', [...ids]);
      return (check(await q) ?? []) as MemoryChunkRow[];
    },
    async writeEmbeddings(rows) {
      const at = new Date().toISOString();
      for (const r of rows) {
        check(
          await db
            .from('memory_chunks')
            .update({
              embedding: `[${r.embedding.join(',')}]`,
              embedding_model: r.model,
              embedded_at: at,
            })
            .eq('id', r.id),
        );
      }
    },
  };
}

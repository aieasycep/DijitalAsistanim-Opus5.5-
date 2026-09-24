/**
 * `AssistStore` over the service client (T-5.09…T-5.15). Every query filters by the verified user
 * id; bytea columns travel as PostgREST hex (`\x…`).
 */
import type { DbClient } from '../../db/clients.ts';
import { DB_FN, rpc } from '../../db/functions.ts';
import { mapDbError } from '../../errors.ts';
import { MESSAGE_COLUMNS, THREAD_COLUMNS } from '../intel/supabase-store.ts';
import type {
  BriefingItemRow,
  CommitmentRow,
  MailMessageRow,
  MailThreadRow,
} from '../intel/types.ts';
import type {
  AccountSource,
  AssistantMessageRow,
  AssistantThreadRow,
  AssistStore,
  BriefingAudioRow,
  CaptureRow,
  ContactMatch,
  FirstAnalysisCounts,
  JobView,
  MeetingContact,
  MeetingEventRow,
  MeetingNoteRow,
  MeetingPrepRow,
  PlanInsightRow,
  ReplyDraftRow,
} from './store.ts';

type Row = Record<string, unknown>;

function check<T>(result: { data: T; error: { code?: string; message?: string } | null }): T {
  if (result.error !== null) throw mapDbError(result.error);
  return result.data;
}

const hexOut = (v: unknown): string | null =>
  typeof v === 'string' && v.startsWith('\\x') ? v.slice(2) : null;
const hexIn = (v: string | null): string | null => (v === null ? null : `\\x${v}`);

const DRAFT_COLUMNS =
  'id,user_id,thread_id,message_id,connected_account_id,kind,tone,to_emails,cc_emails,subject,body,version,status,generated_by,approval_action_id,ai_request_id,prompt_version_id,attachments,source_type,source_id,source_provider,source_timestamp,confidence,language,warnings,facts_used,content_key,created_at,updated_at';
const EVENT_COLUMNS =
  'id,user_id,connected_account_id,calendar_id,provider,title,start_at,end_at,all_day,status,location,is_online,organizer_self,organizer_email,can_modify,attendees,attendee_count,description_excerpt,conference_url,updated_at';
const PREP_COLUMNS =
  'id,user_id,calendar_event_id,status,purpose,purpose_evidence,primary_contact_id,last_interaction,recent_email_ids,open_loops,user_commitment_ids,their_commitment_ids,relevant_files,talking_points,summary_2min,reading_time_sec,sources,input_hash,generated_at,prompt_version_id,ai_request_id,updated_at';
const NOTE_COLUMNS = 'id,user_id,calendar_event_id,kind,body,input,client_note_id,created_at';
const THREAD_ROW_COLUMNS = 'id,user_id,scope,scope_ref_id,client_thread_id,created_at';
const MESSAGE_ROW_COLUMNS =
  'id,user_id,thread_id,role,content,cards,citations,proposed_approval_ids,followup_suggestions,status,grounded,input_channel,client_message_id,finish_reason,prompt_version_id,ai_request_id,created_at';
const CAPTURE_COLUMNS =
  'id,user_id,kind,status,storage_path,mime_type,size_bytes,sha256,original_filename,source_url,final_url,text_content,page_count,extracted,extracted_types,primary_type,share_origin,progress,file_deleted_at,idempotency_key,error_code,analyzed_at,link_preview,created_at,expires_at';
const JOB_COLUMNS =
  'id,type,status,user_id,idempotency_key,progress,result,created_at,last_error_code';
const BRIEFING_AUDIO_COLUMNS =
  'id,user_id,kind,status,version,local_date,hero_line,narrative,sections,audio_status,audio_storage_path,audio_duration_s,audio_chapters';
const COMMITMENT_COLUMNS =
  'id,contact_id,counterparty_name,direction,text,due_at,due_is_date_only,status,completed_at,source_type,source_id,source_provider,source_timestamp,confidence,evidence';

function draftRow(r: Row): ReplyDraftRow {
  return {
    ...(r as unknown as ReplyDraftRow),
    confidence: Number(r.confidence ?? 0),
    attachments: Array.isArray(r.attachments)
      ? (r.attachments as ReplyDraftRow['attachments'])
      : [],
  };
}

function prepRow(r: Row): MeetingPrepRow {
  const { input_hash, ...rest } = r;
  return { ...(rest as unknown as MeetingPrepRow), source_hash: hexOut(input_hash) };
}

function captureRow(r: Row): CaptureRow {
  return {
    ...(r as unknown as CaptureRow),
    sha256: hexOut(r.sha256),
    extracted: Array.isArray(r.extracted) ? (r.extracted as CaptureRow['extracted']) : [],
    progress: (r.progress ?? {}) as Record<string, unknown>,
  };
}

function orEmails(column: string, emails: readonly string[]): string {
  return emails.map((e) => `${column}.cs.{"${e.replace(/["{},]/g, '')}"}`).join(',');
}

export function supabaseAssistStore(db: DbClient): AssistStore {
  return {
    // ── Reply drafts ───────────────────────────────────────────────────────
    async replyDraft(userId, id) {
      const data = check(
        await db
          .from('reply_drafts')
          .select(DRAFT_COLUMNS)
          .eq('id', id)
          .eq('user_id', userId)
          .maybeSingle(),
      );
      return data === null ? null : draftRow(data as Row);
    },
    async insertReplyDraft(row) {
      const data = check(
        await db
          .from('reply_drafts')
          .insert({ ...row, version: 1, status: 'draft' })
          .select(DRAFT_COLUMNS)
          .single(),
      );
      return draftRow(data as Row);
    },
    async updateReplyDraft(userId, id, expectedVersion, patch) {
      const data = check(
        await db
          .from('reply_drafts')
          .update({ ...patch, version: expectedVersion + 1 })
          .eq('id', id)
          .eq('user_id', userId)
          .eq('version', expectedVersion)
          .select(DRAFT_COLUMNS)
          .maybeSingle(),
      );
      return data === null ? null : draftRow(data as Row);
    },
    async reusableDraft(userId, contentKey, since) {
      const data = check(
        await db
          .from('reply_drafts')
          .select(DRAFT_COLUMNS)
          .eq('user_id', userId)
          .eq('content_key', contentKey)
          .eq('status', 'draft')
          .gte('created_at', since.toISOString())
          .order('created_at', { ascending: false })
          .limit(1),
      );
      const first = (data ?? [])[0];
      return first === undefined ? null : draftRow(first as Row);
    },
    async messageWebLink(userId, messageId) {
      const data = check(
        await db
          .from('email_messages')
          .select('web_link')
          .eq('id', messageId)
          .eq('user_id', userId)
          .maybeSingle(),
      );
      const link = (data as { web_link?: unknown } | null)?.web_link;
      return typeof link === 'string' && link.startsWith('https://') ? link : null;
    },

    // ── Meetings ───────────────────────────────────────────────────────────
    async meetingEvent(userId, eventId) {
      const data = check(
        await db
          .from('calendar_events')
          .select(EVENT_COLUMNS)
          .eq('id', eventId)
          .eq('user_id', userId)
          .is('provider_deleted_at', null)
          .maybeSingle(),
      );
      return (data as MeetingEventRow | null) ?? null;
    },
    async meetingPrep(userId, eventId) {
      const data = check(
        await db
          .from('meeting_preps')
          .select(PREP_COLUMNS)
          .eq('user_id', userId)
          .eq('calendar_event_id', eventId)
          .maybeSingle(),
      );
      return data === null ? null : prepRow(data as Row);
    },
    async meetingPrepById(userId, prepId) {
      const data = check(
        await db
          .from('meeting_preps')
          .select(PREP_COLUMNS)
          .eq('user_id', userId)
          .eq('id', prepId)
          .maybeSingle(),
      );
      return data === null ? null : prepRow(data as Row);
    },
    async upsertMeetingPrep(row) {
      const { source_hash, ...rest } = row;
      const data = check(
        await db
          .from('meeting_preps')
          .upsert(
            {
              ...rest,
              input_hash: hexIn(source_hash),
              source_type: 'calendar_event',
              source_id: row.calendar_event_id,
            },
            { onConflict: 'user_id,calendar_event_id' },
          )
          .select(PREP_COLUMNS)
          .single(),
      );
      return prepRow(data as Row);
    },
    async meetingNoteByClient(userId, clientNoteId) {
      const data = check(
        await db
          .from('meeting_notes')
          .select(NOTE_COLUMNS)
          .eq('user_id', userId)
          .eq('client_note_id', clientNoteId)
          .maybeSingle(),
      );
      return (data as MeetingNoteRow | null) ?? null;
    },
    async insertMeetingNote(row) {
      const data = check(await db.from('meeting_notes').insert(row).select(NOTE_COLUMNS).single());
      return data as MeetingNoteRow;
    },
    async meetingNotes(userId, eventId) {
      const data = check(
        await db
          .from('meeting_notes')
          .select(NOTE_COLUMNS)
          .eq('user_id', userId)
          .eq('calendar_event_id', eventId)
          .order('created_at', { ascending: false })
          .limit(5),
      );
      return (data ?? []) as MeetingNoteRow[];
    },
    async contactsForEmails(userId, emails) {
      if (emails.length === 0) return [];
      const data = check(
        await db
          .from('contacts')
          .select('id,display_name,emails,organization')
          .eq('user_id', userId)
          .is('merged_into_id', null)
          .overlaps(
            'emails',
            emails.map((e) => e.toLowerCase()),
          )
          .limit(20),
      );
      return ((data ?? []) as Row[]).map((c) => ({
        ...(c as unknown as MeetingContact),
        role_text: null,
      }));
    },
    async mailsWith(userId, emails, since, limit) {
      if (emails.length === 0) return [];
      const lower = emails.map((e) => e.toLowerCase());
      const filter = [
        `from_email.in.(${lower.map((e) => `"${e}"`).join(',')})`,
        orEmails('to_emails', lower),
      ].join(',');
      const data = check(
        await db
          .from('email_messages')
          .select(MESSAGE_COLUMNS)
          .eq('user_id', userId)
          .is('provider_deleted_at', null)
          .gte('received_at', since.toISOString())
          .or(filter)
          .order('received_at', { ascending: false })
          .limit(limit),
      );
      return (data ?? []) as unknown as MailMessageRow[];
    },
    async awaitingThreadsWith(userId, emails) {
      if (emails.length === 0) return [];
      const lower = new Set(emails.map((e) => e.toLowerCase()));
      const data = check(
        await db
          .from('email_threads')
          .select(THREAD_COLUMNS)
          .eq('user_id', userId)
          .neq('reply_state', 'none')
          .order('last_message_at', { ascending: false })
          .limit(100),
      );
      return ((data ?? []) as unknown as MailThreadRow[]).filter((t) =>
        t.participants.some((p) => lower.has(p.email.toLowerCase())),
      );
    },
    async openCommitmentsWith(userId, contactIds, names) {
      if (contactIds.length === 0 && names.length === 0) return [];
      const ors = [
        ...(contactIds.length === 0 ? [] : [`contact_id.in.(${contactIds.join(',')})`]),
        ...names
          .map((n) => n.replace(/[,()%*"]/g, '').trim())
          .filter((n) => n.length >= 2)
          .map((n) => `counterparty_name.ilike.${n}%`),
      ];
      if (ors.length === 0) return [];
      const data = check(
        await db
          .from('commitments')
          .select(COMMITMENT_COLUMNS)
          .eq('user_id', userId)
          .in('status', ['open', 'snoozed'])
          .or(ors.join(','))
          .order('due_at', { ascending: true, nullsFirst: false })
          .limit(20),
      );
      return ((data ?? []) as Row[]).map((c) => ({
        ...(c as unknown as CommitmentRow),
        confidence: Number(c.confidence ?? 0),
      }));
    },

    // ── Assistant ──────────────────────────────────────────────────────────
    async assistantThread(userId, id) {
      const data = check(
        await db
          .from('assistant_threads')
          .select(THREAD_ROW_COLUMNS)
          .eq('id', id)
          .eq('user_id', userId)
          .is('archived_at', null)
          .maybeSingle(),
      );
      return (data as AssistantThreadRow | null) ?? null;
    },
    async assistantThreadByClient(userId, clientId) {
      const data = check(
        await db
          .from('assistant_threads')
          .select(THREAD_ROW_COLUMNS)
          .eq('user_id', userId)
          .eq('client_thread_id', clientId)
          .maybeSingle(),
      );
      return (data as AssistantThreadRow | null) ?? null;
    },
    async insertAssistantThread(row) {
      const data = check(
        await db.from('assistant_threads').insert(row).select(THREAD_ROW_COLUMNS).single(),
      );
      return data as AssistantThreadRow;
    },
    async assistantMessageByClient(threadId, clientMessageId) {
      const data = check(
        await db
          .from('assistant_messages')
          .select(MESSAGE_ROW_COLUMNS)
          .eq('thread_id', threadId)
          .eq('client_message_id', clientMessageId)
          .eq('role', 'assistant')
          .maybeSingle(),
      );
      return (data as AssistantMessageRow | null) ?? null;
    },
    async insertAssistantMessage(row) {
      const data = check(
        await db.from('assistant_messages').insert(row).select(MESSAGE_ROW_COLUMNS).single(),
      );
      return data as AssistantMessageRow;
    },
    async updateAssistantMessage(id, patch) {
      check(await db.from('assistant_messages').update(patch).eq('id', id));
    },
    async assistantHistory(threadId, limit) {
      const data = check(
        await db
          .from('assistant_messages')
          .select(MESSAGE_ROW_COLUMNS)
          .eq('thread_id', threadId)
          .eq('status', 'complete')
          .order('created_at', { ascending: false })
          .limit(limit),
      );
      return ((data ?? []) as AssistantMessageRow[]).reverse();
    },
    async streamingMessage(userId, since) {
      const data = check(
        await db
          .from('assistant_messages')
          .select(MESSAGE_ROW_COLUMNS)
          .eq('user_id', userId)
          .eq('status', 'streaming')
          .gte('created_at', since.toISOString())
          .limit(1),
      );
      return ((data ?? []) as AssistantMessageRow[])[0] ?? null;
    },
    async touchAssistantThread(threadId, at) {
      const current = check(
        await db.from('assistant_threads').select('message_count').eq('id', threadId).maybeSingle(),
      ) as { message_count?: number } | null;
      check(
        await db
          .from('assistant_threads')
          .update({
            last_message_at: at.toISOString(),
            message_count: (current?.message_count ?? 0) + 2,
          })
          .eq('id', threadId),
      );
    },
    async contactsNamed(userId, names) {
      const clean = names
        .map((n) => n.replace(/[,()%*"]/g, '').trim())
        .filter((n) => n.length >= 2);
      if (clean.length === 0) return [];
      const data = check(
        await db
          .from('contacts')
          .select('id,display_name,primary_email,organization')
          .eq('user_id', userId)
          .is('merged_into_id', null)
          .or(clean.map((n) => `display_name.ilike.${n}%`).join(','))
          .limit(6),
      );
      return (data ?? []) as ContactMatch[];
    },
    async approvalIdsByBatch(userId, batchId) {
      const data = check(
        await db
          .from('approval_actions')
          .select('id')
          .eq('user_id', userId)
          .eq('batch_id', batchId)
          .order('created_at'),
      );
      return ((data ?? []) as { id: string }[]).map((r) => r.id);
    },
    async contact(userId, id) {
      const data = check(
        await db
          .from('contacts')
          .select('id,display_name,primary_email,organization')
          .eq('user_id', userId)
          .eq('id', id)
          .maybeSingle(),
      );
      return (data as ContactMatch | null) ?? null;
    },

    // ── Captures ───────────────────────────────────────────────────────────
    async capture(userId, id) {
      const data = check(
        await db
          .from('captures')
          .select(CAPTURE_COLUMNS)
          .eq('id', id)
          .eq('user_id', userId)
          .maybeSingle(),
      );
      return data === null ? null : captureRow(data as Row);
    },
    async captureByClient(userId, clientId) {
      const data = check(
        await db
          .from('captures')
          .select(CAPTURE_COLUMNS)
          .eq('user_id', userId)
          .eq('idempotency_key', clientId)
          .maybeSingle(),
      );
      return data === null ? null : captureRow(data as Row);
    },
    async insertCapture(row) {
      const data = check(
        await db
          .from('captures')
          .insert({ ...row, sha256: hexIn(row.sha256) })
          .select(CAPTURE_COLUMNS)
          .single(),
      );
      return captureRow(data as Row);
    },
    async updateCapture(userId, id, patch) {
      const data = check(
        await db
          .from('captures')
          .update(patch)
          .eq('id', id)
          .eq('user_id', userId)
          .select(CAPTURE_COLUMNS)
          .maybeSingle(),
      );
      return data === null ? null : captureRow(data as Row);
    },
    async discardCapture(userId, id) {
      const out = await rpc<{ capture: Row; storage_path: string | null }>(
        db,
        DB_FN.discardCapture,
        { p_user: userId, p_capture_id: id },
      );
      return { capture: captureRow(out.capture), storagePath: out.storage_path ?? null };
    },
    async capturesWithStaleFiles(userId, before) {
      const data = check(
        await db
          .from('captures')
          .select(CAPTURE_COLUMNS)
          .eq('user_id', userId)
          .is('file_deleted_at', null)
          .not('storage_path', 'is', null)
          .not('analyzed_at', 'is', null)
          .lt('analyzed_at', before.toISOString())
          .limit(50),
      );
      return ((data ?? []) as Row[]).map(captureRow);
    },

    // ── Planning ───────────────────────────────────────────────────────────
    async accountSources(userId) {
      const data = check(
        await db
          .from('connected_accounts')
          .select('id,provider,status,last_sync_at,capabilities_granted,data_source_toggles')
          .eq('user_id', userId)
          .neq('status', 'disconnected'),
      );
      return (data ?? []) as AccountSource[];
    },
    async timedTasks(userId, from, to) {
      const data = check(
        await db
          .from('tasks')
          .select('due_at')
          .eq('user_id', userId)
          .eq('status', 'open')
          .gte('due_at', from.toISOString())
          .lt('due_at', to.toISOString())
          .limit(200),
      );
      // A timed task blocks 30 minutes ending at its due time.
      return ((data ?? []) as { due_at: string }[]).map((t) => ({
        start: new Date(Date.parse(t.due_at) - 30 * 60_000).toISOString(),
        end: t.due_at,
      }));
    },
    async quietHours(userId) {
      const data = check(
        await db
          .from('notification_preferences')
          .select('quiet_hours_enabled,quiet_start,quiet_end')
          .eq('user_id', userId)
          .maybeSingle(),
      ) as { quiet_hours_enabled: boolean; quiet_start: string; quiet_end: string } | null;
      return data === null
        ? null
        : {
            enabled: data.quiet_hours_enabled,
            start: data.quiet_start.slice(0, 5),
            end: data.quiet_end.slice(0, 5),
          };
    },
    async writableCalendar(userId, calendarId) {
      let id = calendarId;
      if (id === null) {
        const prefs = check(
          await db
            .from('user_preferences')
            .select('default_write_calendar_id')
            .eq('user_id', userId)
            .maybeSingle(),
        ) as { default_write_calendar_id: string | null } | null;
        id = prefs?.default_write_calendar_id ?? null;
      }
      let query = db
        .from('calendars')
        .select(
          'id,connected_account_id,provider,can_write,connected_accounts(data_source_toggles,status)',
        )
        .eq('user_id', userId)
        .eq('can_write', true);
      query = id === null ? query.eq('selected', true) : query.eq('id', id);
      const data = check(await query.limit(1));
      const row = ((data ?? []) as Row[])[0];
      if (row === undefined) return null;
      const account = (row.connected_accounts ?? {}) as {
        data_source_toggles?: Record<string, boolean>;
      };
      return {
        id: row.id as string,
        connected_account_id: row.connected_account_id as string,
        provider: row.provider as WritableProvider,
        can_write: row.can_write === true,
        toggles: account.data_source_toggles ?? {},
      };
    },
    async planItem(userId, item) {
      const table = {
        task: 'tasks',
        commitment: 'commitments',
        insight: 'insights',
        email_message: 'email_messages',
      }[item.type];
      const columns = {
        task: 'title,due_at',
        commitment: 'text,due_at',
        insight: 'title,due_at,kind',
        email_message: 'subject',
      }[item.type];
      const data = check(
        await db.from(table).select(columns).eq('id', item.id).eq('user_id', userId).maybeSingle(),
      ) as Row | null;
      if (data === null) return null;
      const title = String(data.title ?? data.text ?? data.subject ?? '');
      return {
        title,
        due_at: typeof data.due_at === 'string' ? data.due_at : null,
        personal: data.kind === 'life_event',
      };
    },
    async planInsight(userId, id) {
      const data = check(
        await db
          .from('insights')
          .select(
            'id,user_id,kind,status,title,entity_type,entity_id,dedupe_key,suppression_key,evidence,payload,source_type,source_id,source_provider,source_timestamp',
          )
          .eq('id', id)
          .eq('user_id', userId)
          .maybeSingle(),
      );
      return (data as PlanInsightRow | null) ?? null;
    },
    async setInsightPayload(userId, id, payload) {
      check(await db.from('insights').update({ payload }).eq('id', id).eq('user_id', userId));
    },
    async linkInsightApproval(userId, id, approvalId) {
      check(
        await db
          .from('insights')
          .update({
            entity_type: 'approval_action',
            entity_id: approvalId,
            payload: { approval_id: approvalId },
          })
          .eq('id', id)
          .eq('user_id', userId),
      );
    },
    async dismissInsight(userId, id, suppressionKey) {
      check(
        await db
          .from('insights')
          .update({
            status: 'dismissed',
            dismissed_at: new Date().toISOString(),
            suppression_key: suppressionKey,
          })
          .eq('id', id)
          .eq('user_id', userId),
      );
    },
    async sourcePhones(userId, sourceType, sourceId) {
      if (sourceType !== 'email_message' && sourceType !== 'email_thread') return [];
      const column = sourceType === 'email_message' ? 'id' : 'thread_id';
      const data = check(
        await db
          .from('email_messages')
          .select('snippet,ai_summary')
          .eq('user_id', userId)
          .eq(column, sourceId)
          .limit(10),
      );
      const text = ((data ?? []) as Row[])
        .map((r) => `${r.snippet ?? ''} ${r.ai_summary ?? ''}`)
        .join(' ');
      return [...new Set(text.match(/\+?\d[\d\s().-]{8,}\d/g) ?? [])].slice(0, 2);
    },

    // ── First Analysis ─────────────────────────────────────────────────────
    async job(id) {
      const data = check(await db.from('jobs').select(JOB_COLUMNS).eq('id', id).maybeSingle());
      return (data as JobView | null) ?? null;
    },
    async jobByKey(key) {
      const data = check(
        await db.from('jobs').select(JOB_COLUMNS).eq('idempotency_key', key).maybeSingle(),
      );
      return (data as JobView | null) ?? null;
    },
    async jobsByKeyPrefix(prefix) {
      const data = check(
        await db
          .from('jobs')
          .select(JOB_COLUMNS)
          .like('idempotency_key', `${prefix.replace(/[%_]/g, '')}%`)
          .order('created_at', { ascending: false })
          .limit(50),
      );
      return (data ?? []) as JobView[];
    },
    async firstAnalysisCounts(userId, since, now) {
      const raw = await rpc<Record<string, unknown>>(db, DB_FN.firstAnalysisCounts, {
        p_user: userId,
        p_since: since.toISOString(),
        p_now: now.toISOString(),
      });
      const n = (k: keyof FirstAnalysisCounts) => Number(raw?.[k] ?? 0);
      return {
        mails_found: n('mails_found'),
        classified: n('classified'),
        potential_important: n('potential_important'),
        upcoming_events: n('upcoming_events'),
        possible_followups: n('possible_followups'),
      };
    },
    async topInsights(userId, limit) {
      const result = await db
        .from('insights')
        .select('id,kind,title,due_at,event_at', { count: 'exact' })
        .eq('user_id', userId)
        .eq('status', 'open')
        .order('rank_score', { ascending: false })
        .limit(limit);
      if (result.error !== null) throw mapDbError(result.error);
      return {
        items: (result.data ?? []) as {
          id: string;
          kind: PlanInsightRow['kind'];
          title: string;
          due_at: string | null;
          event_at: string | null;
        }[],
        total: result.count ?? 0,
      };
    },
    async setOnboardingStep(userId, step) {
      check(await db.from('profiles').update({ onboarding_step: step }).eq('user_id', userId));
    },

    // ── Briefing audio ─────────────────────────────────────────────────────
    async briefingAudio(userId, id) {
      const data = check(
        await db
          .from('briefings')
          .select(BRIEFING_AUDIO_COLUMNS)
          .eq('id', id)
          .eq('user_id', userId)
          .maybeSingle(),
      );
      return (data as BriefingAudioRow | null) ?? null;
    },
    async briefingItems(userId, briefingId) {
      const data = check(
        await db
          .from('briefing_items')
          .select(
            'id,user_id,briefing_id,section,position,insight_id,entity_type,entity_id,title,meta,badge,carried_over_to,source_type,source_id,source_provider,source_timestamp,confidence,evidence',
          )
          .eq('user_id', userId)
          .eq('briefing_id', briefingId)
          .order('position'),
      );
      return (data ?? []) as BriefingItemRow[];
    },
    async updateBriefingAudio(id, patch) {
      check(await db.from('briefings').update(patch).eq('id', id));
    },
  };
}

type WritableProvider = AccountSource['provider'];

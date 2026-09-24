/**
 * Supabase implementation of `ApprovalsRepo`. It receives the service client from the function's
 * wiring module and scopes every query by the verified user id. SQL errors of the approval state
 * machine are translated: `ILLEGAL_TRANSITION` / `IDEMPOTENCY_MISMATCH` → `APPROVAL_STATE_CONFLICT`,
 * `DEVICE_*_MISMATCH` → `FORBIDDEN`, `APPROVAL_PENDING_DUPLICATE:<id>` → `DuplicatePendingError`.
 */
import type { AiFeature, Capability, SourceType } from '@da/domain';
import { fromByteaHex, fromHex, toByteaHex, toHex } from '../../crypto/encoding.ts';
import type { DbClient } from '../../db/clients.ts';
import { DB_FN, rpc, rpcRaw } from '../../db/functions.ts';
import { AppError, mapDbError } from '../../errors.ts';
import {
  type AccountInfo,
  type ApprovalRow,
  type ApprovalsRepo,
  type CalendarEventInfo,
  type CalendarInfo,
  DuplicatePendingError,
  type InstallationInfo,
} from './model.ts';

export const APPROVAL_COLUMNS =
  'id,user_id,action_type,status,payload,payload_version,what,why,change_summary,side_effects,' +
  'destination_account_id,destination_label,idempotency_key,provider_idempotency_ref,origin,origin_ref_id,' +
  'requires_scope,approved_via,exact_change,batch_id,executor,device_installation_id,approval_expires_at,' +
  'approved_at,rejected_at,rejection_reason,executing_at,executed_at,failed_at,attempt_count,last_error_code,' +
  'last_error_message,result,source_type,source_id,source_provider,source_timestamp,confidence,created_at';

/** Maps a row (table select or composite RPC result) to `ApprovalRow`. */
export function toApprovalRow(raw: Record<string, unknown>): ApprovalRow {
  return {
    ...(raw as unknown as ApprovalRow),
    confidence: Number(raw.confidence ?? 0),
    side_effects: Array.isArray(raw.side_effects)
      ? (raw.side_effects as ApprovalRow['side_effects'])
      : [],
  };
}

type DbError = { code?: string; message?: string };

/** Translates approval state-machine SQL errors. */
export function approvalDbError(error: DbError): AppError | DuplicatePendingError {
  const message = error.message ?? '';
  const duplicate = /APPROVAL_PENDING_DUPLICATE:([0-9a-f-]{36})/i.exec(message);
  if (duplicate?.[1] !== undefined) return new DuplicatePendingError(duplicate[1]);
  const illegal = /(ILLEGAL_TRANSITION|IDEMPOTENCY_MISMATCH)/.exec(message);
  if (illegal?.[1] !== undefined) {
    return new AppError('APPROVAL_STATE_CONFLICT', {
      details: { reason: illegal[1].toLowerCase() },
      cause: error,
    });
  }
  if (/DEVICE_(TOKEN|INSTALLATION)_MISMATCH/.test(message)) {
    return new AppError('FORBIDDEN', {
      details: { reason: 'installation_mismatch' },
      cause: error,
    });
  }
  return mapDbError(error);
}

async function approvalRpc(
  client: DbClient,
  target: (typeof DB_FN)[keyof typeof DB_FN],
  args: Record<string, unknown>,
): Promise<ApprovalRow> {
  const { data, error } = await rpcRaw<Record<string, unknown>>(client, target, args);
  if (error !== null) throw approvalDbError(error);
  if (data === null) throw new AppError('NOT_FOUND');
  return toApprovalRow(data);
}

const FEATURE_BY_ORIGIN: Readonly<Partial<Record<ApprovalRow['origin'], AiFeature>>> = {
  reply_draft: 'reply_draft',
  follow_up: 'follow_up_draft',
  assistant: 'assistant_intent',
  voice: 'assistant_intent',
  capture: 'capture_extract',
  post_meeting: 'post_meeting_parse',
  email_detail: 'email_deep_extract',
  life_event: 'life_intel_extract',
  commitment_detection: 'commitment_extract',
};

const OWNED_TABLE: Readonly<Record<SourceType, string | null>> = {
  email_message: 'email_messages',
  email_thread: 'email_threads',
  calendar_event: 'calendar_events',
  device_calendar_event: 'calendar_events',
  task: 'tasks',
  capture: 'captures',
  meeting_note: 'meeting_notes',
  post_meeting_note: 'meeting_notes',
  android_notification: 'android_notification_signals',
  assistant_message: 'assistant_messages',
  user_input: null,
  commitment: 'commitments',
  life_event: 'life_events',
  contact: 'contacts',
  briefing: 'briefings',
  ai_feedback: 'ai_feedback',
};

function hhmm(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : fallback;
}

export function supabaseApprovalsRepo(system: DbClient): ApprovalsRepo {
  const one = async <T>(
    query: PromiseLike<{ data: unknown; error: DbError | null }>,
  ): Promise<T | null> => {
    const { data, error } = await query;
    if (error !== null) throw mapDbError(error);
    return (data ?? null) as T | null;
  };

  return {
    async get(userId, id) {
      const row = await one<Record<string, unknown>>(
        system
          .from('approval_actions')
          .select(APPROVAL_COLUMNS)
          .eq('user_id', userId)
          .eq('id', id)
          .maybeSingle(),
      );
      return row === null ? null : toApprovalRow(row);
    },
    create(userId, row, actor) {
      return approvalRpc(system, DB_FN.createApproval, {
        p_user: userId,
        p_row: row,
        p_actor: actor,
      });
    },
    transition(input) {
      return approvalRpc(system, DB_FN.transitionApproval, {
        p_id: input.id,
        p_to: input.to,
        p_actor: input.actor,
        p_actor_id: input.actorId,
        p_idempotency_key: input.idempotencyKey,
        p_reason: input.reason ?? null,
        p_result: input.result ?? null,
        p_error_code: input.errorCode ?? null,
        p_error_message: input.errorMessage ?? null,
        p_via: input.via ?? null,
        p_device_token_hash:
          input.deviceTokenHashHex === undefined || input.deviceTokenHashHex === null
            ? null
            : toByteaHex(fromHex(input.deviceTokenHashHex)),
      });
    },
    async edit(input) {
      const edited = await approvalRpc(system, DB_FN.editApprovalPayload, {
        p_id: input.id,
        p_user: input.userId,
        p_payload: input.payload,
        p_payload_hash: toByteaHex(fromHex(input.payloadHashHex)),
        p_change_summary: input.changeSummary,
        p_exact_change: input.exactChange,
      });
      const updated = await one<Record<string, unknown>>(
        system
          .from('approval_actions')
          .update({
            what: input.what,
            side_effects: input.sideEffects,
            destination_label: input.destinationLabel,
            approval_expires_at: input.approvalExpiresAt,
            requires_scope: input.requiresScope,
          })
          .eq('id', edited.id)
          .eq('user_id', input.userId)
          .eq('payload_version', edited.payload_version)
          .select(APPROVAL_COLUMNS)
          .maybeSingle(),
      );
      return updated === null ? edited : toApprovalRow(updated);
    },
    startDeviceExecution(id, userId, installationRowId, tokenHashHex) {
      return approvalRpc(system, DB_FN.startDeviceExecution, {
        p_id: id,
        p_user: userId,
        p_installation: installationRowId,
        p_token_hash: toByteaHex(fromHex(tokenHashHex)),
      });
    },
    async setRequiresScope(userId, id, capability) {
      const { error } = await system
        .from('approval_actions')
        .update({ requires_scope: capability })
        .eq('id', id)
        .eq('user_id', userId);
      if (error !== null) throw mapDbError(error);
    },
    async deviceTokenHash(userId, id) {
      const row = await one<{ device_token_hash: string | null }>(
        system
          .from('approval_actions')
          .select('device_token_hash')
          .eq('id', id)
          .eq('user_id', userId)
          .maybeSingle(),
      );
      return row?.device_token_hash ? toHex(fromByteaHex(row.device_token_hash)) : null;
    },
    job(key) {
      return one(system.from('jobs').select('id,status').eq('idempotency_key', key).maybeSingle());
    },
    async userContext(userId) {
      const [prefs, notif, profile, entitlement] = await Promise.all([
        one<Record<string, unknown>>(
          system
            .from('user_preferences')
            .select('timezone,learn_from_interactions')
            .eq('user_id', userId)
            .maybeSingle(),
        ),
        one<Record<string, unknown>>(
          system
            .from('notification_preferences')
            .select('quiet_hours_enabled,quiet_start,quiet_end,quiet_days')
            .eq('user_id', userId)
            .maybeSingle(),
        ),
        one<{ locale: string | null }>(
          system.from('profiles').select('locale').eq('user_id', userId).maybeSingle(),
        ),
        rpc<{ is_active: boolean }[] | null>(system, DB_FN.effectiveEntitlement, {
          p_user_id: userId,
        }),
      ]);
      return {
        timeZone: typeof prefs?.timezone === 'string' ? prefs.timezone : 'Europe/Istanbul',
        locale: profile?.locale?.toLowerCase().startsWith('en') ? 'en' : 'tr',
        isPro: Array.isArray(entitlement) && entitlement[0]?.is_active === true,
        learnFromInteractions: prefs?.learn_from_interactions !== false,
        quietHours: {
          enabled: notif?.quiet_hours_enabled !== false,
          start: hhmm(notif?.quiet_start, '22:30'),
          end: hhmm(notif?.quiet_end, '07:30'),
          days: Array.isArray(notif?.quiet_days)
            ? (notif.quiet_days as number[])
            : [1, 2, 3, 4, 5, 6, 7],
        },
      };
    },
    async planFeature(userId, key) {
      const value = await rpc<unknown>(system, DB_FN.planLimitValue, {
        p_user: userId,
        p_key: key,
      });
      return value === true;
    },
    account(userId, accountId) {
      return one<AccountInfo>(
        system
          .from('connected_accounts')
          .select(
            'id,provider,account_email,display_label,status,capabilities_granted,data_source_toggles',
          )
          .eq('id', accountId)
          .eq('user_id', userId)
          .maybeSingle(),
      );
    },
    async accountCan(accountId, capability: Capability) {
      return (
        (await rpc<boolean>(system, DB_FN.accountCan, {
          p_account: accountId,
          p_cap: capability,
        })) === true
      );
    },
    calendar(userId, calendarId) {
      return one<CalendarInfo>(
        system
          .from('calendars')
          .select('id,connected_account_id,provider,provider_calendar_id,name,can_write')
          .eq('id', calendarId)
          .eq('user_id', userId)
          .maybeSingle(),
      );
    },
    calendarEvent(userId, eventId) {
      return one<CalendarEventInfo>(
        system
          .from('calendar_events')
          .select(
            'id,connected_account_id,calendar_id,provider,provider_event_id,etag,title,location,start_at,end_at,' +
              'all_day,start_date,end_date,time_zone,status,organizer_self,attendee_count,provider_deleted_at',
          )
          .eq('id', eventId)
          .eq('user_id', userId)
          .maybeSingle(),
      );
    },
    installationByClientId(userId, installationId) {
      return one<InstallationInfo>(
        system
          .from('app_installations')
          .select('id,installation_id,platform')
          .eq('installation_id', installationId)
          .eq('user_id', userId)
          .is('signed_out_at', null)
          .maybeSingle(),
      );
    },
    installationById(userId, rowId) {
      return one<InstallationInfo>(
        system
          .from('app_installations')
          .select('id,installation_id,platform')
          .eq('id', rowId)
          .eq('user_id', userId)
          .maybeSingle(),
      );
    },
    async owns(userId, type, id) {
      const table = OWNED_TABLE[type];
      if (table === null) return true;
      const row = await one<{ id: string }>(
        system.from(table).select('id').eq('id', id).eq('user_id', userId).maybeSingle(),
      );
      return row !== null;
    },
    async sourceText(userId, type, id) {
      const parts: string[] = [];
      const push = (value: unknown) => {
        if (typeof value === 'string' && value.trim() !== '') parts.push(value);
        else if (Array.isArray(value)) value.forEach(push);
        else if (typeof value === 'object' && value !== null) Object.values(value).forEach(push);
      };
      switch (type) {
        case 'email_message': {
          push(
            await one(
              system
                .from('email_messages')
                .select('subject,snippet,ai_summary,key_points')
                .eq('id', id)
                .eq('user_id', userId)
                .maybeSingle(),
            ),
          );
          break;
        }
        case 'email_thread': {
          push(
            await one(
              system
                .from('email_threads')
                .select('subject,ai_summary,key_points,deadline_evidence')
                .eq('id', id)
                .eq('user_id', userId)
                .maybeSingle(),
            ),
          );
          push(
            await one(
              system
                .from('email_messages')
                .select('snippet,ai_summary')
                .eq('thread_id', id)
                .eq('user_id', userId)
                .limit(20),
            ),
          );
          break;
        }
        case 'meeting_note':
        case 'post_meeting_note':
          push(
            await one(
              system
                .from('meeting_notes')
                .select('body')
                .eq('id', id)
                .eq('user_id', userId)
                .maybeSingle(),
            ),
          );
          break;
        case 'assistant_message':
          push(
            await one(
              system
                .from('assistant_messages')
                .select('content')
                .eq('id', id)
                .eq('user_id', userId)
                .maybeSingle(),
            ),
          );
          break;
        case 'capture':
          push(
            await one(
              system
                .from('captures')
                .select('text_content,extracted')
                .eq('id', id)
                .eq('user_id', userId)
                .maybeSingle(),
            ),
          );
          break;
        default:
          return null;
      }
      for (const table of ['insights', 'commitments'] as const) {
        push(
          await one(
            system
              .from(table)
              .select('evidence')
              .eq('user_id', userId)
              .eq('source_id', id)
              .limit(20),
          ),
        );
      }
      return parts.length === 0 ? null : parts.join('\n');
    },
    async syncReplyDraft(userId, draftId, draft) {
      const current = await one<{ version: number }>(
        system
          .from('reply_drafts')
          .select('version')
          .eq('id', draftId)
          .eq('user_id', userId)
          .maybeSingle(),
      );
      if (current === null)
        throw new AppError('NOT_FOUND', { details: { resource: 'reply_draft' } });
      const { error } = await system
        .from('reply_drafts')
        .update({
          subject: draft.subject.slice(0, 300),
          body: draft.body.slice(0, 10000),
          to_emails: draft.to,
          cc_emails: draft.cc,
          version: current.version + 1,
          generated_by: 'user_edit',
        })
        .eq('id', draftId)
        .eq('user_id', userId);
      if (error !== null) throw mapDbError(error);
    },
    async replyDraftStatus(userId, draftId, status) {
      const { error } = await system
        .from('reply_drafts')
        .update({ status })
        .eq('id', draftId)
        .eq('user_id', userId);
      if (error !== null) throw mapDbError(error);
    },
    async recordRejectionFeedback({ userId, approval, note, statement }) {
      const feature = FEATURE_BY_ORIGIN[approval.origin];
      if (feature !== undefined) {
        const { error } = await system.from('ai_feedback').upsert(
          {
            user_id: userId,
            feature,
            target_type: 'approval_action',
            target_id: approval.id,
            rating: -1,
            reason_code:
              approval.action_type === 'commitment_create' ? 'not_a_commitment' : 'not_important',
            comment: note,
            detail: { action_type: approval.action_type, origin: approval.origin },
          },
          { onConflict: 'user_id,feature,target_type,target_id', ignoreDuplicates: true },
        );
        if (error !== null) throw mapDbError(error);
      }
      await rpc<string | null>(system, DB_FN.upsertLearnedPreference, {
        p_user: userId,
        p_target_type: 'topic',
        p_target_ref: `approval:${approval.action_type}`,
        p_group_key: 'topics',
        p_effect: { demote_proposals: approval.action_type },
        p_evidence_delta: 1,
        p_statement: statement,
      });
    },
  };
}

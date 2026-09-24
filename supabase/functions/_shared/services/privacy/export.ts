/**
 * User data export (API-PRV-01/04, JOB-21; SECURITY_AND_PRIVACY_PLAN §4.6; IMPLEMENTATION_PLAN
 * T-11.01; M§128).
 *
 * The archive is a ZIP written with fflate in store mode (`ZipPassThrough`, low CPU): one JSON file
 * per entity, read page by page with the service client and an explicit column allow-list filtered
 * by the verified owner, plus `manifest.json` (export id, UTC time, the user's time zone, schema
 * version, per-file row count and sha256). Never exported: `oauth_credentials`, `oauth_states`,
 * ciphertext, token or credential hashes, anti-abuse signals, embeddings, cursors and job payloads.
 * A second, defensive pass drops any key that looks like a secret and redacts token-shaped values.
 *
 * The job (key `export:{request_id}`) is resumable: once the archive is uploaded its path, size and
 * digest are stored on the request while it is still `processing`, so a retried attempt only
 * finalises. `ready` sets `expires_at = ready_at + 24 h`; the retention run deletes the object and
 * marks the request `expired`.
 */
import { Zip, ZipPassThrough } from 'fflate';
import { formatShortDate, formatTime, toDeepLink } from '@da/domain';
import { withTrCases } from '@da/i18n/tr-suffix';
import { sha256Hex } from '../../crypto/hmac.ts';
import { JobError, type JobContext, type JobResult } from '../../jobs/types.ts';
import { isAppError } from '../../errors.ts';
import type { AuditWriter } from '../audit.ts';
import { notificationBuildJob } from '../notifications/create.ts';
import type { ExportRequestRow, ExportSource, PrivacyRepo } from './repo.ts';
import type { ObjectStore } from './storage.ts';

export const EXPORT_SCHEMA_VERSION = 1;
export const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;
export const EXPORT_PAGE_SIZE = 1000;
export const EXPORT_BUCKET = 'exports';

type Section =
  | 'profile'
  | 'preferences'
  | 'integrations_meta'
  | 'email_metadata'
  | 'insights'
  | 'briefings'
  | 'commitments'
  | 'reminders'
  | 'tasks'
  | 'calendar_events'
  | 'assistant'
  | 'captures'
  | 'memory'
  | 'ai_feedback'
  | 'approvals'
  | 'notifications'
  | 'subscriptions'
  | 'referrals';

export interface ExportFile {
  readonly name: string;
  readonly section: Section;
  readonly source: ExportSource;
}

const own = (table: string, columns: string, order = 'id'): ExportSource => ({
  table,
  columns,
  owner: 'user_id',
  order,
});

/** Every file of the archive, its section (API-PRV-01 `include`) and its column allow-list. */
export const EXPORT_FILES: readonly ExportFile[] = [
  {
    name: 'profile.json',
    section: 'profile',
    source: own(
      'profiles',
      'display_name,avatar_path,locale,state,onboarding_step,onboarding_completed_at,terms_accepted_at,terms_version,last_active_at,created_at,updated_at',
      'user_id',
    ),
  },
  {
    name: 'export_requests.json',
    section: 'profile',
    source: own(
      'data_export_requests',
      'id,status,requested_via,include,ready_at,expires_at,downloaded_at,created_at',
    ),
  },
  {
    name: 'deletion_requests.json',
    section: 'profile',
    source: own('data_deletion_requests', 'id,kind,status,origin,scope,completed_at,created_at'),
  },
  {
    name: 'support_tickets.json',
    section: 'profile',
    source: own(
      'support_tickets',
      'id,public_ref,category,status,subject,message,platform,created_at,updated_at',
    ),
  },
  {
    name: 'audit_events.json',
    section: 'profile',
    source: {
      table: 'audit_logs',
      columns: 'occurred_at,actor_type,action,target_type,result',
      owner: 'audit',
      order: 'id',
    },
  },
  {
    name: 'analytics_events.json',
    section: 'profile',
    source: own('analytics_events', 'event_name,props,platform,app_version,occurred_at'),
  },
  {
    name: 'preferences.json',
    section: 'preferences',
    source: own(
      'user_preferences',
      'timezone,theme,reduce_motion,haptics_enabled,retention_policy,learn_from_interactions,ai_data_access,interest_categories,morning_enabled,morning_time,midday_enabled,midday_time,evening_enabled,evening_time,weekly_enabled,weekly_dow,weekly_time,briefing_weekdays,weekend_morning_time,weekend_morning_only,working_hours_start,working_hours_end,timezone_mode,weekend_personal_first,work_days,default_reply_tone,follow_up_after_days,analytics_opt_out,screen_protection,created_at,updated_at',
      'user_id',
    ),
  },
  {
    name: 'notification_preferences.json',
    section: 'preferences',
    source: own(
      'notification_preferences',
      'smart_filter,morning,midday,evening,critical_email,meeting,deadline,follow_up,life_intel,approval,account,quiet_hours_enabled,quiet_start,quiet_end,quiet_days,vip_bypass_quiet,detail_level,lock_screen_private,daily_cap,meeting_prep_lead_min,created_at,updated_at',
      'user_id',
    ),
  },
  {
    name: 'priority_rules.json',
    section: 'preferences',
    source: own(
      'priority_rules',
      'id,condition_type,condition_value,outcome,search_body,exceptions,applies_to,enabled,sort_order,deleted_at,created_at,updated_at',
    ),
  },
  {
    name: 'vip_people.json',
    section: 'preferences',
    source: own(
      'vip_people',
      'id,contact_id,relationship,always_notify,bypass_quiet_hours,note,origin,created_at',
    ),
  },
  {
    name: 'learned_preferences.json',
    section: 'preferences',
    source: own(
      'learned_preferences',
      'id,group_key,statement,target_type,effect,priority_override,evidence_count,evidence_summary,origin,enabled,deleted_at,created_at,updated_at',
    ),
  },
  {
    name: 'connected_accounts.json',
    section: 'integrations_meta',
    source: own(
      'connected_accounts',
      'id,provider,account_email,display_label,tenant_type,status,granted_scopes,capabilities_granted,data_source_toggles,analysis_window_days,connected_at,last_sync_at,disconnected_at,revocation_mode,created_at',
    ),
  },
  {
    name: 'calendars.json',
    section: 'integrations_meta',
    source: own(
      'calendars',
      'id,connected_account_id,provider,name,time_zone,is_primary,selected,can_write,created_at',
    ),
  },
  {
    name: 'email_threads.json',
    section: 'email_metadata',
    source: own(
      'email_threads',
      'id,connected_account_id,provider,subject,participants,message_count,last_message_at,has_unread,category,urgency,reply_state,ai_summary,key_points,deadline_at,deadline_evidence,labels,web_link,is_muted,follow_up_state,topic_label,created_at',
    ),
  },
  {
    name: 'emails.json',
    section: 'email_metadata',
    source: own(
      'email_messages',
      'id,connected_account_id,thread_id,provider,direction,from_email,from_name,to_emails,cc_emails,subject,snippet,sent_at,received_at,is_read,importance,labels,has_attachments,attachment_meta,classification,classification_reason,ai_summary,key_points,web_link,created_at',
    ),
  },
  {
    name: 'insights.json',
    section: 'insights',
    source: own(
      'insights',
      'id,kind,urgency,status,title,body,why_important,reason_code,entity_type,entity_id,due_at,event_at,snoozed_until,done_at,dismissed_at,source_type,source_id,source_provider,source_timestamp,confidence,evidence,created_at',
    ),
  },
  {
    name: 'life_events.json',
    section: 'insights',
    source: own(
      'life_events',
      'id,type,title,status,event_at,due_at,payload,amount,currency,tracking_url,source_type,source_id,source_provider,source_timestamp,confidence,evidence,created_at',
    ),
  },
  {
    name: 'briefings.json',
    section: 'briefings',
    source: own(
      'briefings',
      'id,kind,local_date,time_zone,scheduled_for,status,skipped_reason,generated_at,delivered_at,opened_at,headline,hero_line,narrative,sections,counts,provenance,weekly_stats,created_at',
    ),
  },
  {
    name: 'briefing_items.json',
    section: 'briefings',
    source: own(
      'briefing_items',
      'id,briefing_id,section,position,insight_id,entity_type,entity_id,title,meta,badge,done_at,source_type,source_id,source_timestamp,created_at',
    ),
  },
  {
    name: 'commitments.json',
    section: 'commitments',
    source: own(
      'commitments',
      'id,contact_id,counterparty_name,direction,text,due_at,status,snoozed_until,completed_at,cancelled_at,origin,source_type,source_id,source_provider,source_timestamp,confidence,evidence,user_overrides,created_at',
    ),
  },
  {
    name: 'reminders.json',
    section: 'reminders',
    source: own(
      'reminders',
      'id,title,note,remind_at,preset,destination,origin,channel,status,target_type,target_id,delivered_at,cancelled_at,source_type,source_id,created_at',
    ),
  },
  {
    name: 'tasks.json',
    section: 'tasks',
    source: own(
      'tasks',
      'id,connected_account_id,provider,title,notes_excerpt,due_date,due_at,status,completed_at,origin,source_type,source_id,created_at',
    ),
  },
  {
    name: 'calendar_events.json',
    section: 'calendar_events',
    source: own(
      'calendar_events',
      'id,connected_account_id,calendar_id,provider,title,description_excerpt,location,is_online,conference_url,start_at,end_at,all_day,time_zone,status,organizer_email,attendees,origin,created_at',
    ),
  },
  {
    name: 'meeting_notes.json',
    section: 'calendar_events',
    source: own('meeting_notes', 'id,calendar_event_id,kind,body,input,created_at'),
  },
  {
    name: 'meeting_preps.json',
    section: 'calendar_events',
    source: own(
      'meeting_preps',
      'id,calendar_event_id,status,purpose,last_interaction,open_loops,talking_points,summary_2min,sources,generated_at,created_at',
    ),
  },
  {
    name: 'assistant_threads.json',
    section: 'assistant',
    source: own(
      'assistant_threads',
      'id,title,scope,last_message_at,message_count,archived_at,created_at',
    ),
  },
  {
    name: 'assistant_messages.json',
    section: 'assistant',
    source: own(
      'assistant_messages',
      'id,thread_id,role,content,cards,citations,status,input_channel,created_at',
    ),
  },
  {
    name: 'captures.json',
    section: 'captures',
    source: own(
      'captures',
      'id,kind,status,mime_type,size_bytes,original_filename,source_url,page_count,extracted,extracted_types,primary_type,share_origin,analyzed_at,created_at',
    ),
  },
  {
    name: 'android_notification_signals.json',
    section: 'captures',
    source: own(
      'android_notification_signals',
      'id,package_name,app_label,category,amount,currency,due_date,tracking_status,flight_no,gate,posted_at,created_at',
    ),
  },
  {
    name: 'memory.json',
    section: 'memory',
    source: own(
      'memory_chunks',
      'id,source_type,source_id,source_provider,source_timestamp,chunk_kind,content,occurred_at,created_at',
    ),
  },
  {
    name: 'contacts.json',
    section: 'memory',
    source: own(
      'contacts',
      'id,display_name,primary_email,emails,organization,title,first_seen_at,last_contact_at,origin,created_at',
    ),
  },
  {
    name: 'ai_feedback.json',
    section: 'ai_feedback',
    source: own(
      'ai_feedback',
      'id,feature,target_type,target_id,rating,reason_code,comment,created_at',
    ),
  },
  {
    name: 'ai_usage.json',
    section: 'ai_feedback',
    source: own('ai_usage_daily', 'local_date,feature,requests,units_used', 'local_date,feature'),
  },
  {
    name: 'approvals.json',
    section: 'approvals',
    source: own(
      'approval_actions',
      'id,action_type,status,payload,what,why,change_summary,destination_label,origin,approved_via,approved_at,rejected_at,executed_at,failed_at,result,source_type,source_id,created_at',
    ),
  },
  {
    name: 'reply_drafts.json',
    section: 'approvals',
    source: own(
      'reply_drafts',
      'id,thread_id,kind,tone,to_emails,cc_emails,subject,body,version,status,created_at',
    ),
  },
  {
    name: 'notifications.json',
    section: 'notifications',
    source: own(
      'notifications',
      'id,category,decision,suppression_reason,detail_mode,entity_type,entity_id,scheduled_for,sent_at,opened_at,created_at',
    ),
  },
  {
    name: 'subscription.json',
    section: 'subscriptions',
    source: own(
      'subscriptions',
      'entitlement,is_active,status,store,product_id,period_type,purchased_at,expires_at,will_renew,created_at',
      'entitlement',
    ),
  },
  {
    name: 'entitlement_grants.json',
    section: 'subscriptions',
    source: own(
      'entitlement_grants',
      'id,entitlement,source,starts_at,ends_at,duration_days,revoked_at,created_at',
    ),
  },
  {
    name: 'referral_codes.json',
    section: 'referrals',
    source: own('referral_codes', 'code,disabled_at,created_at', 'code'),
  },
  {
    name: 'referrals.json',
    section: 'referrals',
    source: {
      table: 'referrals',
      columns:
        'id,referrer_id,referee_id,status,applied_at,qualified_at,rewarded_at,rejected_at,created_at',
      owner: 'referrals',
      order: 'id',
    },
  },
  {
    name: 'referral_credits.json',
    section: 'referrals',
    source: own('referral_credits', 'id,side,days,created_at'),
  },
];

// ── Defensive sanitising ─────────────────────────────────────────────────────

/** Key names that never belong in an export, whatever table or JSON column they come from. */
export const FORBIDDEN_KEY =
  /token|secret|cipher|password|passwd|hash|embedding|pepper|credential|cursor|^iv$|^aad|api_?key|authorization/i;

/** Token-shaped values (OAuth, Supabase, OpenAI/Anthropic, RevenueCat, PEM, JWT, Expo push). */
export const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bya29\.[A-Za-z0-9_-]{10,}/,
  /\b1\/\/[A-Za-z0-9_-]{20,}/,
  /sb_secret_/,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/,
  /\bsk_[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /Expo(?:nent)?PushToken\[/,
];

export const REDACTED = '[redacted]';

/** Drops secret-looking keys and redacts token-shaped strings, recursively. */
export function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return SECRET_VALUE_PATTERNS.some((p) => p.test(value)) ? REDACTED : value;
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEY.test(key)) continue;
      out[key] = sanitizeValue(v);
    }
    return out;
  }
  return value;
}

/** Referral rows: the counterpart is masked, only the caller's side is kept. */
function shapeRow(file: ExportFile, row: unknown, userId: string): unknown {
  if (file.source.owner !== 'referrals' || typeof row !== 'object' || row === null) return row;
  const { referrer_id, referee_id: _referee, ...rest } = row as Record<string, unknown>;
  return { ...rest, side: referrer_id === userId ? 'referrer' : 'referee' };
}

// ── Archive ──────────────────────────────────────────────────────────────────

export interface ManifestFile {
  readonly name: string;
  readonly rows: number;
  readonly sha256: string;
}

export interface ExportArchive {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly files: readonly ManifestFile[];
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function filesFor(include: readonly string[] | null): ExportFile[] {
  if (include === null || include.length === 0) return [...EXPORT_FILES];
  const wanted = new Set(include);
  return EXPORT_FILES.filter((f) => wanted.has(f.section));
}

/**
 * Streams every included entity into a store-mode ZIP: rows are read and encoded page by page and
 * pushed into the archive as they arrive; the manifest is written last.
 */
export async function buildExportArchive(input: {
  readonly repo: PrivacyRepo;
  readonly requestId: string;
  readonly userId: string;
  readonly include: readonly string[] | null;
  readonly timezone: string;
  readonly now: Date;
  readonly signal?: AbortSignal;
  readonly onFile?: (done: number, total: number) => Promise<void>;
}): Promise<ExportArchive> {
  const encoder = new TextEncoder();
  const out: Uint8Array[] = [];
  let failure: unknown = null;
  let finished = false;
  const zip = new Zip((error, chunk, final) => {
    if (error !== null) failure = error;
    else out.push(chunk);
    if (final) finished = true;
  });
  const files = filesFor(input.include);
  const manifest: ManifestFile[] = [];
  let index = 0;
  for (const file of files) {
    input.signal?.throwIfAborted();
    const entry = new ZipPassThrough(file.name);
    zip.add(entry);
    const parts: Uint8Array[] = [];
    let rows = 0;
    const push = (bytes: Uint8Array) => {
      parts.push(bytes);
      entry.push(bytes, false);
    };
    push(encoder.encode('['));
    for (let offset = 0; ; offset += EXPORT_PAGE_SIZE) {
      const page = await input.repo.readRows(file.source, input.userId, offset, EXPORT_PAGE_SIZE);
      for (const row of page) {
        const clean = sanitizeValue(shapeRow(file, row, input.userId));
        push(encoder.encode(`${rows === 0 ? '\n' : ',\n'}${JSON.stringify(clean)}`));
        rows++;
      }
      if (page.length < EXPORT_PAGE_SIZE) break;
    }
    push(encoder.encode(rows === 0 ? ']\n' : '\n]\n'));
    entry.push(new Uint8Array(0), true);
    manifest.push({ name: file.name, rows, sha256: await sha256Hex(concat(parts)) });
    index++;
    await input.onFile?.(index, files.length);
  }
  const manifestEntry = new ZipPassThrough('manifest.json');
  zip.add(manifestEntry);
  manifestEntry.push(
    encoder.encode(
      `${JSON.stringify(
        {
          export_id: input.requestId,
          generated_at: input.now.toISOString(),
          time_zone: input.timezone,
          schema_version: EXPORT_SCHEMA_VERSION,
          files: manifest,
        },
        null,
        2,
      )}\n`,
    ),
    true,
  );
  zip.end();
  if (failure !== null) throw failure;
  if (!finished) throw new JobError('EXPORT_ARCHIVE_INCOMPLETE', true);
  const bytes = concat(out);
  return { bytes, sha256: await sha256Hex(bytes), files: manifest };
}

// ── JOB-21 ───────────────────────────────────────────────────────────────────

export interface ExportJobDeps {
  readonly repo: PrivacyRepo;
  readonly store: ObjectStore;
  readonly audit: AuditWriter;
}

export interface ExportJobPayload {
  readonly data_export_request_id?: string | undefined;
  /** Admin retry / regenerate (`admin_api.data_request_retry`, `export_regenerate`). */
  readonly request_id?: string | undefined;
  readonly user_id?: string | undefined;
}

export function exportPath(userId: string, requestId: string): string {
  return `${userId}/${requestId}.zip`;
}

function lang(locale: string | null): 'tr' | 'en' {
  return locale !== null && locale.toLowerCase().startsWith('en') ? 'en' : 'tr';
}

async function notifyExport(
  deps: ExportJobDeps,
  ctx: JobContext<ExportJobPayload>,
  row: ExportRequestRow,
  outcome: 'ready' | 'failed',
  expiresAt: Date | null,
): Promise<void> {
  const params: Record<string, string> = {};
  if (outcome === 'ready' && expiresAt !== null) {
    const { locale, timezone } = await deps.repo.userLocale(row.user_id);
    const zone = timezone ?? 'Europe/Istanbul';
    Object.assign(
      params,
      withTrCases(
        {
          date: formatShortDate(expiresAt, zone, lang(locale)),
          time: formatTime(expiresAt, zone),
        },
        ['time'],
      ),
    );
  }
  await ctx.enqueue(
    notificationBuildJob(row.user_id, {
      category: 'account',
      dedupe_key: `${outcome === 'ready' ? 'export_ready' : 'export_failed'}:${row.id}`,
      entity: null,
      deeplink: toDeepLink('/settings/privacy/export'),
      template_key: outcome === 'ready' ? 'account.export_ready' : 'account.export_failed',
      params_public: params,
      params_sensitive: {},
      urgency: 'normal',
      time_sensitive: false,
      vip: false,
    }),
  );
}

async function markFailed(
  deps: ExportJobDeps,
  ctx: JobContext<ExportJobPayload>,
  row: ExportRequestRow,
  code: string,
): Promise<void> {
  await deps.repo.updateExport(row.id, row.user_id, { status: 'failed', error_code: code });
  await deps.audit.append({
    actorType: 'system',
    actorId: null,
    action: 'system.privacy.export_failed',
    targetType: 'data_export_request',
    targetId: row.id,
    targetUserId: row.user_id,
    result: 'failure',
    details: { error_code: code },
    correlationId: ctx.correlationId,
  });
  await notifyExport(deps, ctx, row, 'failed', null);
}

export async function runExportJob(
  deps: ExportJobDeps,
  ctx: JobContext<ExportJobPayload>,
): Promise<JobResult> {
  const requestId = ctx.payload.data_export_request_id ?? ctx.payload.request_id;
  if (requestId === undefined) throw new JobError('POISON_PAYLOAD', false);
  const row = await deps.repo.getExport(requestId);
  if (row === null) return { skipped: 'request_gone' };
  if (ctx.payload.user_id !== undefined && ctx.payload.user_id !== row.user_id) {
    throw new JobError('FORBIDDEN', false, null, 'user_mismatch');
  }
  if (row.status !== 'requested' && row.status !== 'processing') {
    return { skipped: `status_${row.status}` };
  }
  const path = exportPath(row.user_id, row.id);
  try {
    if (row.status === 'requested') {
      await deps.repo.updateExport(row.id, row.user_id, {
        status: 'processing',
        job_id: ctx.job.id,
      });
    }
    let size = row.file_size_bytes;
    let digest = row.sha256;
    let resumed = true;
    if (row.storage_path !== path || size === null || digest === null) {
      resumed = false;
      const { timezone } = await deps.repo.userLocale(row.user_id);
      const archive = await buildExportArchive({
        repo: deps.repo,
        requestId: row.id,
        userId: row.user_id,
        include: row.include,
        timezone: timezone ?? 'Europe/Istanbul',
        now: ctx.now(),
        signal: ctx.signal,
        onFile: (done, total) => ctx.progress({ files_done: done, files_total: total }),
      });
      await deps.store.upload(
        EXPORT_BUCKET,
        path,
        new Blob([archive.bytes], { type: 'application/zip' }),
        'application/zip',
      );
      size = archive.bytes.byteLength;
      digest = archive.sha256;
      // Checkpoint: a retried attempt only finalises.
      await deps.repo.updateExport(row.id, row.user_id, {
        storage_path: path,
        file_size_bytes: size,
        sha256: digest,
      });
      await ctx.progress({ uploaded: true, files_total: archive.files.length });
    }
    const readyAt = ctx.now();
    const expiresAt = new Date(readyAt.getTime() + EXPORT_TTL_MS);
    await deps.repo.updateExport(row.id, row.user_id, {
      status: 'ready',
      ready_at: readyAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      error_code: null,
    });
    await deps.audit.append({
      actorType: 'system',
      actorId: null,
      action: 'system.privacy.export_completed',
      targetType: 'data_export_request',
      targetId: row.id,
      targetUserId: row.user_id,
      result: 'success',
      details: { file_size_bytes: size, resumed },
      correlationId: ctx.correlationId,
    });
    await notifyExport(deps, ctx, row, 'ready', expiresAt);
    return { status: 'ready', file_size_bytes: size, resumed };
  } catch (error) {
    const retryable =
      error instanceof JobError ? error.retryable : isAppError(error) ? error.retryable : true;
    const lastAttempt = ctx.job.attempts >= ctx.job.max_attempts;
    if (!retryable || lastAttempt) {
      const code =
        error instanceof JobError ? error.code : isAppError(error) ? error.code : 'EXPORT_FAILED';
      await markFailed(deps, ctx, row, code);
    }
    throw error;
  }
}

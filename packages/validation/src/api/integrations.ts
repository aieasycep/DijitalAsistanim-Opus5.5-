import { z } from 'zod';
import {
  AccountSummary,
  Base64Url32,
  Capability,
  DataSourceToggles,
  Email,
  IsoDateTime,
  JobRef,
  Sha256Hex,
  Uuid,
} from './common.ts';
import { Success } from './envelope.ts';

export const AccountIdParams = z.strictObject({ accountId: Uuid });

// API-INT-01 · POST /integrations/:provider/start
export const IntegrationStartParams = z.strictObject({
  provider: z.enum(['google', 'microsoft', 'demo']),
});
export const IntegrationStartBody = z.strictObject({
  capabilities: z
    .array(z.enum(['mail_read', 'calendar_read', 'tasks_read']))
    .min(1)
    .max(3),
  account_id: Uuid.optional(),
  login_hint: Email.optional(),
  device_nonce_hash: Sha256Hex,
});
export const IntegrationStartResponse = Success(
  z.object({
    state_id: Uuid,
    auth_url: z.url(),
    state_expires_at: IsoDateTime,
    callback_url: z.literal('dijitalasistan://integrations/callback'),
    requested_scopes: z.array(z.string()),
  }),
);

// API-INT-02 · POST /integrations/:accountId/upgrade
export const IntegrationUpgradeBody = z.strictObject({
  capability: z.enum([
    'mail_send',
    'calendar_write',
    'tasks_write',
    'calendar_read',
    'tasks_read',
    'mail_read',
  ]),
  resume: z.strictObject({ approval_id: Uuid }).optional(),
  device_nonce_hash: Sha256Hex,
});
export const IntegrationUpgradeResponse = Success(
  z.discriminatedUnion('already_granted', [
    z.object({ already_granted: z.literal(true) }),
    z.object({
      already_granted: z.literal(false),
      state_id: Uuid,
      auth_url: z.url(),
      state_expires_at: IsoDateTime,
      missing_scopes: z.array(z.string()),
    }),
  ]),
);

// API-INT-03 · POST /integrations/:accountId/disconnect
export const DisconnectBody = z.strictObject({
  confirm: z.literal(true),
  purge_content: z.boolean().default(false),
});
export const DisconnectResponse = Success(
  z.object({
    account: AccountSummary,
    revocation: z.enum(['provider_revoked', 'local_only', 'revoke_failed']),
    manual_revoke_url: z.url().nullable(),
    purge_job: JobRef,
  }),
);

// API-INT-04 · POST /integrations/:accountId/sync
export const SyncBody = z.strictObject({
  resources: z
    .array(z.enum(['mail', 'calendar', 'tasks']))
    .min(1)
    .max(3)
    .optional(),
});
export const SyncResponse = Success(
  z.object({ jobs: z.array(JobRef), next_allowed_at: IsoDateTime }),
);

// API-INT-05 · PATCH /integrations/:accountId/data-sources
export const DataSourcesPatch = z.strictObject({
  data_sources: DataSourceToggles.partial().optional(),
  calendars: z
    .array(z.strictObject({ calendar_id: Uuid, selected: z.boolean() }))
    .max(100)
    .optional(),
  default_write_calendar_id: Uuid.nullable().optional(),
  expected_updated_at: IsoDateTime,
});
export const DataSourceConsequence = z.enum([
  'ingestion_paused',
  'summaries_disabled',
  'drafts_disabled',
  'calendar_events_hidden',
  'sync_started',
]);
export const DataSourcesResponse = Success(
  z.object({
    account: AccountSummary,
    calendars: z.array(
      z.object({
        id: Uuid,
        name: z.string(),
        selected: z.boolean(),
        can_write: z.boolean(),
        is_default_write: z.boolean(),
        color: z.string().nullable(),
      }),
    ),
    consequences: z.array(DataSourceConsequence),
  }),
);

// API-INT-06 · POST /integrations/device-calendar/snapshot
const MAX_SNAPSHOT_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;
export const DeviceCalendar = z.strictObject({
  device_calendar_hash: Sha256Hex,
  title: z.string().max(120),
  source_title: z.string().max(60),
  color: z.string().max(9).nullable(),
  allows_modifications: z.boolean(),
  selected: z.boolean(),
});
export const DeviceCalendarEvent = z.strictObject({
  event_key_hash: Sha256Hex,
  device_calendar_hash: Sha256Hex,
  title: z.string().max(300),
  start_at: IsoDateTime,
  end_at: IsoDateTime,
  all_day: z.boolean(),
  location: z.string().max(300).nullable(),
  attendee_count: z.int().min(0).max(500),
  organizer_is_self: z.boolean().nullable(),
  meeting_url: z.url().nullable(),
  status: z.enum(['confirmed', 'tentative', 'cancelled']),
  last_modified_at: IsoDateTime.nullable(),
});
export const DeviceReminder = z.strictObject({
  reminder_key_hash: Sha256Hex,
  list_hash: Sha256Hex,
  title: z.string().max(300),
  due_at: IsoDateTime.nullable(),
  completed: z.boolean(),
});
export const DeviceSnapshotBody = z
  .strictObject({
    snapshot_id: Uuid,
    provider: z.enum(['apple_device', 'android_device']),
    installation_id: Uuid,
    window: z.strictObject({ start: IsoDateTime, end: IsoDateTime }),
    snapshot_at: IsoDateTime,
    content_hash: Sha256Hex,
    calendars: z.array(DeviceCalendar).max(50),
    events: z.array(DeviceCalendarEvent).max(3000),
    reminders: z.array(DeviceReminder).max(1000).optional(),
  })
  .superRefine((body, ctx) => {
    const start = Date.parse(body.window.start);
    const end = Date.parse(body.window.end);
    if (!(end > start)) {
      ctx.addIssue({ code: 'custom', path: ['window', 'end'], message: 'end_before_start' });
    } else if (end - start > MAX_SNAPSHOT_WINDOW_MS) {
      ctx.addIssue({ code: 'custom', path: ['window'], message: 'window_too_long' });
    }
    body.events.forEach((event, index) => {
      const eventStart = Date.parse(event.start_at);
      const eventEnd = Date.parse(event.end_at);
      if (eventEnd < eventStart) {
        ctx.addIssue({
          code: 'custom',
          path: ['events', index, 'end_at'],
          message: 'end_before_start',
        });
      }
      if (eventEnd < start || eventStart > end) {
        ctx.addIssue({ code: 'custom', path: ['events', index], message: 'outside_window' });
      }
    });
    if (body.provider === 'android_device' && body.reminders !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['reminders'], message: 'reminders_ios_only' });
    }
  });
export const DeviceSnapshotResponse = Success(
  z.object({ job: JobRef, connected_account_id: Uuid }),
);

// API-INT-07 · POST /integrations/oauth/complete (R-07)
export const OAuthCompleteBody = z.strictObject({
  completion_code: Base64Url32,
  device_nonce: Base64Url32,
});
export const OAuthCompleteResult = z.enum([
  'success',
  'partial',
  'account_mismatch',
  'already_linked',
  'plan_limit',
]);
export const OAuthCompleteResponse = Success(
  z.object({
    result: OAuthCompleteResult,
    account: AccountSummary.nullable(),
    granted: z.array(Capability),
    missing: z.array(Capability),
    resume: z.object({ approval_id: Uuid }).nullable(),
    jobs: z.array(JobRef),
  }),
);

// OAUTH-01..04 callback inputs and the app deep link they redirect to (§9).
export const GoogleCallbackQuery = z.object({
  state: Base64Url32,
  code: z.string().max(2048).optional(),
  scope: z.string().max(4096).optional(),
  error: z.string().max(64).optional(),
  error_description: z.string().max(512).optional(),
  authuser: z.string().optional(),
  hd: z.string().optional(),
  prompt: z.string().optional(),
});
export const MicrosoftCallbackQuery = z.object({
  state: Base64Url32,
  code: z.string().max(2048).optional(),
  error: z.string().max(128).optional(),
  error_description: z.string().max(1024).optional(),
  session_state: z.string().max(256).optional(),
});
export const DemoCallbackQuery = z.strictObject({
  state: Base64Url32,
  code: z.string().regex(/^demo_[A-Za-z0-9_-]{8,64}$/),
});
export const OAuthCallbackResult = z.enum([
  'pending_confirmation',
  'denied',
  'error',
  'expired_state',
  'admin_consent_required',
]);
export const OAuthCallbackErrorCode = z.enum([
  'token_exchange_failed',
  'id_token_invalid',
  'no_refresh_token',
  'external_credential_required',
  'provider_unavailable',
  'scope_missing',
  'admin_consent_required',
]);
/** Query of `dijitalasistan://integrations/callback` (the redirect never carries tokens). */
export const OAuthCallbackDeepLinkQuery = z
  .strictObject({
    result: OAuthCallbackResult,
    provider: z.enum(['google', 'microsoft', 'demo']),
    state_id: Uuid,
    completion_code: Base64Url32.optional(),
    error_code: OAuthCallbackErrorCode.optional(),
  })
  .superRefine((query, ctx) => {
    const pending = query.result === 'pending_confirmation';
    if (pending && query.completion_code === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['completion_code'],
        message: 'completion_code_required',
      });
    }
    if (!pending && query.completion_code !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['completion_code'],
        message: 'completion_code_unexpected',
      });
    }
  });

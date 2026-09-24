import { z } from 'zod';
import {
  APPROVAL_ACTION_TYPE_VALUES,
  APPROVAL_VIA_VALUES,
  COMMITMENT_DIRECTION_VALUES,
  type ApprovalActionType as ApprovalActionTypeValue,
} from '@da/domain';
import { ERROR_CODE_VALUES } from '../errors.ts';
import {
  ApprovalActionType,
  ApprovalStatus,
  Base64Url32,
  Email,
  EvidenceInput,
  hasDefinedValue,
  IanaTimeZone,
  IsoDateTime,
  JobRef,
  Language,
  LocalDate,
  Provider,
  RecipientInput,
  ReminderPreset,
  ScopeUpgrade,
  Sha256Hex,
  SourceRef,
  SourceRefInput,
  SourceType,
  Uuid,
} from './common.ts';
import { Success } from './envelope.ts';

/*
 * Approval payloads (docs/API_CONTRACTS.md §5.1), the ApprovalView card contract (§5.2) and the
 * approval routes API-APR-01..05 (§8.6). Payloads are strict: they are validated on proposal, on edit
 * (merged, then re-parsed) and before execution.
 */

// ── Payload building blocks ──────────────────────────────────────────────────
export const EventTime = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('timed'),
      start: IsoDateTime,
      end: IsoDateTime,
      time_zone: IanaTimeZone,
    }),
    z.strictObject({ kind: z.literal('all_day'), start_date: LocalDate, end_date: LocalDate }),
  ])
  .superRefine((time, ctx) => {
    const ordered =
      time.kind === 'timed'
        ? Date.parse(time.end) > Date.parse(time.start)
        : time.end_date > time.start_date;
    if (!ordered) {
      ctx.addIssue({
        code: 'custom',
        path: [time.kind === 'timed' ? 'end' : 'end_date'],
        message: 'end_before_start',
      });
    }
  });
export type EventTime = z.infer<typeof EventTime>;

export const ProviderCalTarget = z.strictObject({
  kind: z.literal('provider'),
  connected_account_id: Uuid,
  calendar_id: Uuid,
});
export const DeviceCalTarget = z.strictObject({
  kind: z.literal('device'),
  provider: z.enum(['apple_device', 'android_device']),
  installation_id: Uuid,
  device_calendar_hash: Sha256Hex,
});
export const CalendarTarget = z.discriminatedUnion('kind', [ProviderCalTarget, DeviceCalTarget]);

export const ReplyAttachmentRef = z.strictObject({
  storage_path: z.string().max(300),
  name: z.string().max(255),
  mime: z.string().max(100),
  size_bytes: z.int().min(1),
});
/** Total attachment ceiling per draft (Graph `/reply` inline-attachment limit, API-MAIL-08). */
export const MAX_REPLY_ATTACHMENTS_BYTES = 3 * 1024 * 1024;

// ── Payloads per approval_action_type ────────────────────────────────────────
export const EmailSendPayload = z
  .strictObject({
    action_type: z.literal('email_send'),
    connected_account_id: Uuid,
    provider: z.enum(['google', 'microsoft']),
    mode: z.enum(['reply', 'follow_up']),
    reply_draft_id: Uuid,
    thread: z.strictObject({ email_thread_id: Uuid, reply_to_message_id: Uuid }),
    to: z.array(RecipientInput).min(1).max(50),
    cc: z.array(RecipientInput).max(50),
    subject: z.string().min(1).max(998),
    body_text: z.string().min(1).max(20000),
    language: Language,
    attachments: z.array(ReplyAttachmentRef).max(5).default([]),
  })
  .superRefine((payload, ctx) => {
    const total = payload.attachments.reduce((sum, a) => sum + a.size_bytes, 0);
    if (total > MAX_REPLY_ATTACHMENTS_BYTES) {
      ctx.addIssue({ code: 'custom', path: ['attachments'], message: 'attachments_too_large' });
    }
  });

export const CalendarCreatePayload = z.strictObject({
  action_type: z.literal('calendar_create'),
  target: CalendarTarget,
  title: z.string().min(1).max(300),
  description: z.string().max(8000).optional(),
  location: z.string().max(500).optional(),
  time: EventTime,
  attendees: z
    .array(z.strictObject({ email: Email, optional: z.boolean().default(false) }))
    .max(50)
    .default([]),
  reminders_minutes: z.array(z.int().min(0).max(40320)).max(5).default([]),
  origin_task_ref: z
    .strictObject({
      type: z.enum(['task', 'commitment', 'insight', 'capture_item']),
      id: z.string().max(80),
    })
    .optional(),
});

export const CalendarUpdateChanges = z
  .strictObject({
    time: EventTime.optional(),
    title: z.string().min(1).max(300).optional(),
    location: z.string().max(500).optional(),
    description: z.string().max(8000).optional(),
  })
  .refine(hasDefinedValue, 'no_changes');
export const CalendarUpdatePayload = z.strictObject({
  action_type: z.literal('calendar_update'),
  target: CalendarTarget,
  calendar_event_id: Uuid,
  changes: CalendarUpdateChanges,
});

export const TaskTarget = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('provider'),
    connected_account_id: Uuid,
    task_list_id: z.string().max(256),
  }),
  z.strictObject({
    kind: z.literal('device'),
    provider: z.literal('apple_device'),
    installation_id: Uuid,
    reminder_list_hash: Sha256Hex,
  }),
  z.strictObject({ kind: z.literal('in_app') }),
]);
export const TaskDue = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('date'), date: LocalDate }),
  z.strictObject({ kind: z.literal('date_time'), at: IsoDateTime, time_zone: IanaTimeZone }),
]);
export const TaskCreatePayload = z.strictObject({
  action_type: z.literal('task_create'),
  target: TaskTarget,
  title: z.string().min(1).max(1024),
  notes: z.string().max(7900).optional(),
  due: TaskDue.optional(),
  importance: z.enum(['low', 'normal', 'high']).optional(),
  related_person: z.strictObject({ contact_id: Uuid }).optional(),
});

export const ReminderDestination = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('in_app'), channel: z.enum(['push', 'local']) }),
  z.strictObject({
    kind: z.literal('device'),
    provider: z.literal('apple_device'),
    installation_id: Uuid,
    reminder_list_hash: Sha256Hex,
  }),
]);
export const ReminderCreatePayload = z
  .strictObject({
    action_type: z.literal('reminder_create'),
    destination: ReminderDestination,
    title: z.string().min(1).max(200),
    preset: ReminderPreset,
    fire_at: IsoDateTime,
    anchor_at: IsoDateTime.optional(),
    time_zone: IanaTimeZone,
    reason_text: z.string().max(200).optional(),
    subject: z.strictObject({ type: SourceType, id: Uuid }).optional(),
  })
  .superRefine((payload, ctx) => {
    if (
      payload.anchor_at !== undefined &&
      Date.parse(payload.fire_at) > Date.parse(payload.anchor_at)
    ) {
      ctx.addIssue({ code: 'custom', path: ['fire_at'], message: 'after_anchor' });
    }
  });

export const CommitmentCreatePayload = z
  .strictObject({
    action_type: z.literal('commitment_create'),
    text: z.string().min(1).max(500),
    direction: z.enum(COMMITMENT_DIRECTION_VALUES),
    counterparty: z
      .strictObject({
        contact_id: Uuid.optional(),
        name: z.string().max(200).optional(),
        email: Email.optional(),
      })
      .refine(
        (c) => c.contact_id !== undefined || c.name !== undefined || c.email !== undefined,
        'counterparty_required',
      ),
    due_at: IsoDateTime.nullable(),
    due_text: z.string().max(100).optional(),
    due_precision: z.enum(['datetime', 'date', 'none']),
    source: SourceRefInput,
    evidence: EvidenceInput,
    confidence: z.number().min(0).max(1),
  })
  .superRefine((payload, ctx) => {
    if (payload.due_precision === 'none' && payload.due_at !== null) {
      ctx.addIssue({ code: 'custom', path: ['due_at'], message: 'due_without_precision' });
    }
    if (payload.due_precision !== 'none' && payload.due_at === null) {
      ctx.addIssue({ code: 'custom', path: ['due_at'], message: 'due_required' });
    }
  });

export const ApprovalPayload = z.discriminatedUnion('action_type', [
  EmailSendPayload,
  CalendarCreatePayload,
  CalendarUpdatePayload,
  TaskCreatePayload,
  ReminderCreatePayload,
  CommitmentCreatePayload,
]);
export type ApprovalPayload = z.infer<typeof ApprovalPayload>;
export type ApprovalPayloadInput = z.input<typeof ApprovalPayload>;

/** Payload schema per action type, e.g. for editing (merge, then re-parse with the full schema). */
export const APPROVAL_PAYLOAD_SCHEMAS = {
  email_send: EmailSendPayload,
  calendar_create: CalendarCreatePayload,
  calendar_update: CalendarUpdatePayload,
  task_create: TaskCreatePayload,
  reminder_create: ReminderCreatePayload,
  commitment_create: CommitmentCreatePayload,
} as const satisfies Record<ApprovalActionTypeValue, z.ZodType>;

// ── The card contract: exact change, destination and side effects ────────────
export const ApprovalOrigin = z.enum([
  'reply_draft',
  'assistant',
  'voice',
  'capture',
  'plan_proposal',
  'conflict_resolution',
  'post_meeting',
  'email_detail',
  'life_event',
  'follow_up',
  'reminder_sheet',
  'commitment_detection',
  'insight',
  'manual',
]);
/** R-03: every value is a tap; a spoken "onayla" never approves. */
export const ApprovedVia = z.enum(APPROVAL_VIA_VALUES);
export const ExactChangeKind = z.enum(['send', 'create', 'update']);
export const TargetKind = z.enum(['provider', 'device', 'in_app']);
export const SideEffectCode = z.enum([
  'email_sent_to',
  'attendees_notified',
  'invites_sent',
  'push_reminder',
  'provider_task_created',
  'device_write',
  'internal_record',
]);
export type SideEffectCode = z.infer<typeof SideEffectCode>;

export const ExactChange = z.object({
  kind: ExactChangeKind,
  fields: z
    .array(
      z.object({ field: z.string(), before: z.string().nullable(), after: z.string().nullable() }),
    )
    .max(20),
});
export const ApprovalDestination = z.object({
  target_kind: TargetKind,
  provider: z.union([Provider, z.literal('in_app')]),
  account_label: z.string().nullable(),
  container_label: z.string().nullable(),
});
export const SideEffect = z.object({ code: SideEffectCode, text: z.string().max(200) });

/** The exact-change kind every action type must render. */
export const EXACT_CHANGE_KIND_BY_ACTION: Readonly<
  Record<ApprovalActionTypeValue, z.infer<typeof ExactChangeKind>>
> = {
  email_send: 'send',
  calendar_create: 'create',
  calendar_update: 'update',
  task_create: 'create',
  reminder_create: 'create',
  commitment_create: 'create',
};

/** The side-effect codes an action type may declare. */
export const SIDE_EFFECTS_BY_ACTION: Readonly<
  Record<ApprovalActionTypeValue, readonly SideEffectCode[]>
> = {
  email_send: ['email_sent_to', 'internal_record'],
  calendar_create: ['invites_sent', 'attendees_notified', 'device_write', 'internal_record'],
  calendar_update: ['attendees_notified', 'invites_sent', 'device_write', 'internal_record'],
  task_create: ['provider_task_created', 'device_write', 'internal_record'],
  reminder_create: ['push_reminder', 'device_write', 'internal_record'],
  commitment_create: ['internal_record'],
};

/** The destination kinds each action type can target (§5.1 payload targets). */
export const TARGET_KINDS_BY_ACTION: Readonly<
  Record<ApprovalActionTypeValue, readonly z.infer<typeof TargetKind>[]>
> = {
  email_send: ['provider'],
  calendar_create: ['provider', 'device'],
  calendar_update: ['provider', 'device'],
  task_create: ['provider', 'device', 'in_app'],
  reminder_create: ['in_app', 'device'],
  commitment_create: ['in_app'],
};

/** Destination kind of a payload: provider, device or in-app. */
export function approvalTargetKind(payload: ApprovalPayload): z.infer<typeof TargetKind> {
  switch (payload.action_type) {
    case 'email_send':
      return 'provider';
    case 'calendar_create':
    case 'calendar_update':
    case 'task_create':
      return payload.target.kind;
    case 'reminder_create':
      return payload.destination.kind;
    case 'commitment_create':
      return 'in_app';
  }
}

function checkCardConsistency(
  view: {
    action_type: ApprovalActionTypeValue;
    exact_change: { kind: string };
    destination: { target_kind: string; provider: string };
    side_effects: readonly { code: SideEffectCode }[];
    executor?: string;
    device_installation_id?: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (view.exact_change.kind !== EXACT_CHANGE_KIND_BY_ACTION[view.action_type]) {
    ctx.addIssue({ code: 'custom', path: ['exact_change', 'kind'], message: 'kind_mismatch' });
  }
  const allowed = SIDE_EFFECTS_BY_ACTION[view.action_type];
  view.side_effects.forEach((effect, index) => {
    if (!allowed.includes(effect.code)) {
      ctx.addIssue({
        code: 'custom',
        path: ['side_effects', index, 'code'],
        message: 'side_effect_not_allowed',
      });
    }
  });
  if (
    view.action_type === 'email_send' &&
    !view.side_effects.some((e) => e.code === 'email_sent_to')
  ) {
    ctx.addIssue({ code: 'custom', path: ['side_effects'], message: 'email_sent_to_required' });
  }
  const targetKinds: readonly string[] = TARGET_KINDS_BY_ACTION[view.action_type];
  if (!targetKinds.includes(view.destination.target_kind)) {
    ctx.addIssue({
      code: 'custom',
      path: ['destination', 'target_kind'],
      message: 'target_not_allowed',
    });
  }
  const isDevice = view.destination.target_kind === 'device';
  if (isDevice && !view.side_effects.some((e) => e.code === 'device_write')) {
    ctx.addIssue({ code: 'custom', path: ['side_effects'], message: 'device_write_required' });
  }
  if ((view.destination.target_kind === 'in_app') !== (view.destination.provider === 'in_app')) {
    ctx.addIssue({
      code: 'custom',
      path: ['destination', 'provider'],
      message: 'provider_mismatch',
    });
  }
  if (view.executor !== undefined) {
    if ((view.executor === 'device') !== isDevice) {
      ctx.addIssue({ code: 'custom', path: ['executor'], message: 'executor_mismatch' });
    }
    if (view.executor === 'device' && !view.device_installation_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['device_installation_id'],
        message: 'installation_required',
      });
    }
  }
}

/**
 * The server-computed change set of a proposal, per action type: the validated payload plus the exact
 * change, destination and side effects shown on the approval card (M§33).
 */
function changeSet<T extends ApprovalActionTypeValue, P extends z.ZodType>(
  actionType: T,
  payload: P,
) {
  return z
    .object({
      action_type: z.literal(actionType),
      payload,
      exact_change: ExactChange,
      destination: ApprovalDestination,
      side_effects: z.array(SideEffect).max(10),
    })
    .superRefine((set, ctx) => {
      checkCardConsistency(set, ctx);
    });
}
export const ApprovalChangeSet = z.discriminatedUnion('action_type', [
  changeSet('email_send', EmailSendPayload),
  changeSet('calendar_create', CalendarCreatePayload),
  changeSet('calendar_update', CalendarUpdatePayload),
  changeSet('task_create', TaskCreatePayload),
  changeSet('reminder_create', ReminderCreatePayload),
  changeSet('commitment_create', CommitmentCreatePayload),
]);
export type ApprovalChangeSet = z.infer<typeof ApprovalChangeSet>;

/** Approval failure codes: the API error codes plus the device-execution codes of §6.7. */
export const ApprovalFailureCode = z.enum([
  ...ERROR_CODE_VALUES,
  'DEVICE_RESULT_MISSING',
  'DEVICE_WRITE_FAILED',
]);

export const ApprovalView = z
  .object({
    id: Uuid,
    action_type: ApprovalActionType,
    status: ApprovalStatus,
    payload_version: z.int().min(1),
    idempotency_key: z.string(),
    type_label_key: z.string(),
    what: z.object({ title: z.string().max(200), summary: z.string().max(400) }),
    why: z.object({ text: z.string().max(300), reason_code: z.string() }),
    source: SourceRef.nullable(),
    exact_change: ExactChange,
    destination: ApprovalDestination,
    side_effects: z.array(SideEffect),
    scope_status: z.object({
      state: z.enum(['granted', 'upgrade_required', 'reauth_required', 'not_applicable']),
      upgrade: ScopeUpgrade.optional(),
    }),
    requires_confirmation: z.boolean(),
    pro_required: z.boolean(),
    origin: ApprovalOrigin,
    origin_ref_id: Uuid.nullable(),
    executor: z.enum(['server', 'device']),
    device_installation_id: Uuid.nullable(),
    batch_id: Uuid.nullable(),
    created_at: IsoDateTime,
    approval_expires_at: IsoDateTime,
    approved_at: IsoDateTime.nullable(),
    rejected_at: IsoDateTime.nullable(),
    approved_via: ApprovedVia.nullable(),
    executed_at: IsoDateTime.nullable(),
    result: z.object({ web_link: z.url().nullable(), summary: z.string().max(200) }).nullable(),
    failure: z
      .object({ code: ApprovalFailureCode, message: z.string(), retryable: z.boolean() })
      .nullable(),
  })
  .superRefine((view, ctx) => {
    checkCardConsistency(view, ctx);
  });
export type ApprovalView = z.infer<typeof ApprovalView>;

export const ApprovalIdParams = z.strictObject({ id: Uuid });

// API-APR-01 · POST /approvals
export const ApprovalProposeBody = z.strictObject({
  payload: ApprovalPayload.refine(
    (p) => p.action_type !== 'email_send',
    'email_send_via_reply_drafts',
  ),
  origin: ApprovalOrigin,
  origin_ref_id: Uuid.nullable(),
  source: SourceRefInput.optional(),
  batch_id: Uuid.optional(),
});
export const ApprovalViewResponse = Success(ApprovalView);

// API-APR-02 · PATCH /approvals/:id
export const ApprovalEditBody = z.strictObject({
  expected_payload_version: z.int().min(1),
  payload_patch: z.record(z.string(), z.unknown()),
});

const EMAIL_SEND_EDITABLE = new Set(['body_text', 'subject', 'to', 'cc']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return out;
}

/**
 * API-APR-02 edit semantics: merges `payload_patch` into the current payload and re-parses it with the
 * type's full schema. `action_type` and `target.kind` / `destination.kind` are immutable; `email_send`
 * edits may only touch `body_text`, `subject`, `to` and `cc`.
 */
export function applyApprovalPayloadPatch(
  current: ApprovalPayload,
  patch: Record<string, unknown>,
): z.ZodSafeParseResult<ApprovalPayload> {
  const issues: z.core.$ZodIssue[] = [];
  const immutable = (path: (string | number)[], message: string) =>
    issues.push({ code: 'custom', path, message, input: patch });
  if ('action_type' in patch && patch.action_type !== current.action_type) {
    immutable(['action_type'], 'immutable');
  }
  if (current.action_type === 'email_send') {
    for (const key of Object.keys(patch)) {
      if (!EMAIL_SEND_EDITABLE.has(key) && key !== 'action_type') immutable([key], 'not_editable');
    }
  }
  for (const key of ['target', 'destination'] as const) {
    const value = patch[key];
    const base = (current as Record<string, unknown>)[key];
    if (
      isPlainObject(value) &&
      isPlainObject(base) &&
      'kind' in value &&
      value.kind !== base.kind
    ) {
      immutable([key, 'kind'], 'immutable');
    }
  }
  if (issues.length > 0) {
    return { success: false, error: new z.ZodError(issues) as z.ZodError<ApprovalPayload> };
  }
  const schema: z.ZodType<ApprovalPayload> = APPROVAL_PAYLOAD_SCHEMAS[current.action_type];
  return schema.safeParse(deepMerge(current, patch));
}

// API-APR-03 · POST /approvals/:id/approve
export const ApprovalApproveBody = z.strictObject({
  idempotency_key: z.string().max(80),
  payload_version: z.int().min(1),
  approved_via: ApprovedVia,
});
export const ApprovalExecution = z
  .object({
    mode: z.enum(['server', 'device']),
    device_token: Base64Url32.nullable(),
    instructions: ApprovalPayload.nullable(),
  })
  .superRefine((execution, ctx) => {
    // Server targets never carry a token; a device target approved on another installation
    // (§6.7) has neither a token nor instructions until the destination claims it.
    const hasToken = execution.device_token !== null;
    if (execution.mode === 'server' && hasToken) {
      ctx.addIssue({
        code: 'custom',
        path: ['device_token'],
        message: 'device_token_mode_mismatch',
      });
    }
    if (hasToken !== (execution.instructions !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['instructions'],
        message: 'instructions_mode_mismatch',
      });
    }
  });
export const ApprovalApproveResponse = Success(
  z
    .object({ approval: ApprovalView, job: JobRef.nullable(), execution: ApprovalExecution })
    .superRefine((data, ctx) => {
      // A device approval approved on another installation has no token until its claim (§6.7).
      if (data.execution.mode !== data.approval.executor) {
        ctx.addIssue({ code: 'custom', path: ['execution', 'mode'], message: 'executor_mismatch' });
      }
    }),
);

// API-APR-04 · POST /approvals/:id/reject
export const ApprovalRejectBody = z.strictObject({
  reason: z.enum(['user_reject', 'user_cancel']),
  learn: z.boolean().default(false),
  note: z.string().max(300).optional(),
});

// API-APR-05 · POST /approvals/:id/device-execution (R-18)
export const DeviceExecutionBody = z.discriminatedUnion('phase', [
  z.strictObject({ phase: z.literal('claim'), installation_id: Uuid }),
  z
    .strictObject({
      phase: z.literal('result'),
      installation_id: Uuid,
      device_token: Base64Url32,
      status: z.enum(['executed', 'failed']),
      already_existed: z.boolean().default(false),
      device_ref_hash: Sha256Hex.optional(),
      error_code: z
        .enum([
          'permission_denied',
          'calendar_read_only',
          'not_found',
          'cancelled_by_user',
          'unknown',
        ])
        .optional(),
    })
    .superRefine((body, ctx) => {
      if (body.status === 'failed' && body.error_code === undefined) {
        ctx.addIssue({ code: 'custom', path: ['error_code'], message: 'error_code_required' });
      }
      if (body.status === 'executed' && body.error_code !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['error_code'], message: 'error_code_unexpected' });
      }
    }),
]);
export const DeviceClaimData = z.object({
  approval: ApprovalView,
  device_token: Base64Url32,
  instructions: ApprovalPayload,
});
export const DeviceExecutionResponse = Success(z.union([DeviceClaimData, ApprovalView]));

/** Every action type in canonical order (re-exported for iteration in callers and tests). */
export const APPROVAL_ACTION_TYPES = APPROVAL_ACTION_TYPE_VALUES;

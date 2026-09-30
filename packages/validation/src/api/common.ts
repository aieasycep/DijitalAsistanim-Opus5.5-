import { z } from 'zod';
import {
  ACCOUNT_STATUS_VALUES,
  APPROVAL_ACTION_TYPE_VALUES,
  APPROVAL_STATUS_VALUES,
  CAPABILITY_VALUES,
  CAPTURE_KIND_VALUES,
  CAPTURE_STATUS_VALUES,
  DECISION_TIER_VALUES,
  EXTRACTED_ENTITY_TYPE_VALUES,
  GRANT_SOURCE_VALUES,
  JOB_STATUS_VALUES,
  PROVIDER_VALUES,
  REMINDER_STATUS_VALUES,
  SOURCE_TYPE_VALUES,
} from '@da/domain';
import { ErrorCode } from '../errors.ts';

/*
 * Shared API schemas (docs/API_CONTRACTS.md §5 and §5.3). Request bodies are strict (unknown keys are
 * rejected, §1 `http/validate.ts`); response objects are non-strict so additive fields never break
 * clients (§2.3).
 */

// ── Primitives ───────────────────────────────────────────────────────────────
export const Uuid = z.uuid();
export const IsoDateTime = z.iso.datetime({ offset: true });
export const LocalDate = z.iso.date();
/** Postgres `time` rendered as `HH:MM` or `HH:MM:SS` (24 h), interpreted in the user's timezone. */
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/);

export function isValidIanaZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone.length > 0;
  } catch {
    return false;
  }
}
export const IanaTimeZone = z.string().max(64).refine(isValidIanaZone, 'invalid_timezone');
export const Locale = z.enum(['tr-TR', 'en-US']);
export const Language = z.enum(['tr', 'en']);
export const Cursor = z
  .string()
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);
export const Email = z.email().max(254);
export const Money = z.object({
  value: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
/** Lower-case hex SHA-256. */
export const Sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);
/** 32 random bytes as unpadded base64url (43 chars): OAuth state, device nonce, completion code. */
export const Base64Url32 = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const SemVer = z.string().regex(/^\d+\.\d+\.\d+$/);
/** App route used for in-app navigation, e.g. `/mail/<uuid>` (never an external URL). */
export const AppRoute = z
  .string()
  .max(200)
  .regex(/^\/[A-Za-z0-9/_\-[\].?=&%]*$/);
/** Custom-scheme or app deep link, e.g. `dijitalasistan://briefing/<id>`. */
export const DeepLink = z
  .string()
  .max(300)
  .regex(/^[a-z][a-z0-9+.-]*:\/\/[A-Za-z0-9/_\-[\].?=&%]*$/);
export const HttpsUrl = z.url({ protocol: /^https$/ });
export const Tone = z.enum(['short', 'professional', 'friendly', 'detailed']);
export const Platform = z.enum(['ios', 'android']);
export const Plan = z.enum(['free', 'pro']);

// ── Canonical enums (plan §5, via @da/domain) ────────────────────────────────
export const Provider = z.enum(PROVIDER_VALUES);
export const Capability = z.enum(CAPABILITY_VALUES);
export const AccountStatus = z.enum(ACCOUNT_STATUS_VALUES);
export const ApprovalActionType = z.enum(APPROVAL_ACTION_TYPE_VALUES);
export const ApprovalStatus = z.enum(APPROVAL_STATUS_VALUES);
export const SourceType = z.enum(SOURCE_TYPE_VALUES);
export const JobStatus = z.enum(JOB_STATUS_VALUES);
export const DecisionTier = z.enum(DECISION_TIER_VALUES);
export const ExtractedEntityType = z.enum(EXTRACTED_ENTITY_TYPE_VALUES);
export const CaptureKind = z.enum(CAPTURE_KIND_VALUES);
export const CaptureStatus = z.enum(CAPTURE_STATUS_VALUES);
export const ReminderStatus = z.enum(REMINDER_STATUS_VALUES);
export const GrantSource = z.enum(GRANT_SOURCE_VALUES);

// ── Provenance ───────────────────────────────────────────────────────────────
export const SourceProvider = z.union([Provider, z.literal('in_app')]);
export const SourceRef = z.object({
  source_type: SourceType,
  source_id: Uuid.nullable(),
  source_provider: SourceProvider,
  source_timestamp: IsoDateTime,
  label: z.string().max(120).optional(),
  open_route: z.string().max(200).optional(),
});
export type SourceRef = z.infer<typeof SourceRef>;
/** Strict copy of `SourceRef` for request bodies. */
export const SourceRefInput = z.strictObject(SourceRef.shape);

export const Evidence = z.object({
  quote: z.string().max(300),
  source: SourceRef,
  offsets: z.object({ start: z.int().min(0), end: z.int().min(0) }).optional(),
  page: z.int().min(1).optional(),
});
export type Evidence = z.infer<typeof Evidence>;
export const EvidenceInput = z.strictObject({
  quote: z.string().max(300),
  source: SourceRefInput,
  offsets: z.strictObject({ start: z.int().min(0), end: z.int().min(0) }).optional(),
  page: z.int().min(1).optional(),
});

export const Provenance = z.object({
  source_type: SourceType,
  source_id: Uuid.nullable(),
  source_provider: SourceProvider,
  source_timestamp: IsoDateTime,
  confidence: z.number().min(0).max(1),
  evidence: z.array(Evidence).max(5),
});
export type Provenance = z.infer<typeof Provenance>;

export const DecisionExplain = z.object({
  decision_tier: DecisionTier,
  reason_text: z.string().max(300),
  rule_id: Uuid.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
});

export const JobRef = z.object({ job_id: Uuid, status: JobStatus, poll_after_ms: z.int() });
export type JobRef = z.infer<typeof JobRef>;

// ── Accounts, entitlement, usage ─────────────────────────────────────────────
/** `connected_accounts.data_source_toggles` (§4.5). */
export const DataSourceToggles = z.strictObject({
  mail_read: z.boolean(),
  attachments_analyze: z.boolean(),
  deadline_detect: z.boolean(),
  draft_replies: z.boolean(),
  calendar_read: z.boolean(),
  schedule_suggest: z.boolean(),
  calendar_write_with_approval: z.boolean(),
  tasks_read: z.boolean(),
});
export type DataSourceToggles = z.infer<typeof DataSourceToggles>;

export const AccountSummary = z.object({
  id: Uuid,
  provider: Provider,
  account_email: Email.nullable(),
  display_name: z.string().nullable(),
  status: AccountStatus,
  capabilities_granted: z.array(Capability),
  data_sources: DataSourceToggles,
  paused_by_plan: z.boolean(),
  last_sync_at: IsoDateTime.nullable(),
  last_error_code: z.string().nullable(),
  manual_revoke_url: z.url().nullable(),
});
export type AccountSummary = z.infer<typeof AccountSummary>;

export const EntitlementState = z.object({
  is_active: z.boolean(),
  source: z.enum(['store', 'grant', 'none']),
  active_until: IsoDateTime.nullable(),
  store: z.object({
    active: z.boolean(),
    product_id: z.string().nullable(),
    store: z.enum(['app_store', 'play_store', 'test_store', 'promotional']).nullable(),
    period_type: z.enum(['normal', 'trial', 'intro']).nullable(),
    will_renew: z.boolean(),
    expires_at: IsoDateTime.nullable(),
    billing_issue: z.boolean(),
    management_url: z.url().nullable(),
  }),
  grants: z.array(
    z.object({ id: Uuid, source: GrantSource, starts_at: IsoDateTime, ends_at: IsoDateTime }),
  ),
});
export type EntitlementState = z.infer<typeof EntitlementState>;

export const UsageSummary = z.object({
  plan: Plan,
  resets_at: IsoDateTime,
  limits: z.record(z.string(), z.object({ limit: z.int(), used: z.int(), remaining: z.int() })),
  ai_budget: z.object({
    state: z.enum(['ok', 'soft_limited', 'exhausted']),
    level: z.enum(['L0', 'L1', 'L2', 'L3']),
  }),
  ai_units: z.object({
    limit: z.int().nullable(),
    used: z.int(),
    remaining: z.int().nullable(),
  }),
});
export type UsageSummary = z.infer<typeof UsageSummary>;

/** `meta.usage` on quota-bearing routes (§4.2). */
export const UsageDelta = z.object({
  limit_key: z.string(),
  limit: z.int().nullable(),
  used: z.int(),
  remaining: z.int().nullable(),
  resets_at: IsoDateTime,
});

/** Progressive scope upgrade descriptor (§7); `details.upgrade` of `PROVIDER_SCOPE_MISSING`. */
export const ScopeUpgrade = z.object({
  account_id: Uuid,
  provider: z.enum(['google', 'microsoft']),
  capability: Capability,
  missing_scopes: z.array(z.string()),
  explainer_key: z.string(),
  upgrade: z.object({
    method: z.literal('POST'),
    path: z.string(),
    body: z.object({
      capability: Capability,
      resume: z.object({ approval_id: Uuid }).optional(),
    }),
  }),
});
export type ScopeUpgrade = z.infer<typeof ScopeUpgrade>;

// ── §5.3 shared resources ────────────────────────────────────────────────────
export const Recipient = z.object({ email: Email, name: z.string().max(200).optional() });
export const RecipientInput = z.strictObject({
  email: Email,
  name: z.string().max(200).optional(),
});

export const ReplyDraftAttachment = z.object({
  storage_path: z.string(),
  name: z.string(),
  mime: z.string(),
  size_bytes: z.int(),
});
export const ReplyDraft = z.object({
  id: Uuid,
  kind: z.enum(['reply', 'follow_up']),
  email_message_id: Uuid,
  email_thread_id: Uuid,
  connected_account_id: Uuid,
  tone: Tone,
  subject: z.string(),
  to: z.array(Recipient),
  cc: z.array(Recipient),
  body_text: z.string(),
  language: Language,
  version: z.int(),
  status: z.enum(['draft', 'submitted', 'sent', 'discarded', 'failed']),
  attachments: z.array(ReplyDraftAttachment).max(5),
  grounding: z.object({ facts_used: z.array(SourceRef).max(10) }),
  warnings: z.array(
    z.enum(['contains_commitment', 'recipients_changed', 'low_confidence_context']),
  ),
  approval_id: Uuid.nullable(),
  web_link: z.url().nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export type ReplyDraft = z.infer<typeof ReplyDraft>;

export const ReminderPreset = z.enum([
  'before_30m',
  'before_1h',
  'this_evening',
  'tomorrow_morning',
  'smart',
  'custom',
]);
export const EntityRef = z.object({ type: SourceType, id: Uuid });
export const EntityRefInput = z.strictObject({ type: SourceType, id: Uuid });

export const Reminder = z.object({
  id: Uuid,
  title: z.string(),
  preset: z.string(),
  fire_at: IsoDateTime,
  time_zone: IanaTimeZone,
  channel: z.enum(['push', 'local']),
  status: ReminderStatus,
  reason_text: z.string().nullable(),
  subject: EntityRef.nullable(),
  created_at: IsoDateTime,
});
export type Reminder = z.infer<typeof Reminder>;

export const CaptureItem = z.object({
  item_id: z.string().max(40),
  type: ExtractedEntityType,
  title: z.string().max(300),
  fields: z.record(z.string(), z.unknown()),
  evidence: z.array(Evidence).max(5),
  confidence: z.number(),
  proposed_action: ApprovalActionType.nullable(),
  selected: z.boolean(),
  unresolved: z.array(z.string()).default([]),
});
export const Capture = z.object({
  id: Uuid,
  kind: CaptureKind,
  status: CaptureStatus,
  primary_type: ExtractedEntityType.nullable(),
  items: z.array(CaptureItem),
  link_preview: z.object({ title: z.string().max(300).nullable(), domain: z.string() }).nullable(),
  error_code: ErrorCode.nullable(),
  created_at: IsoDateTime,
});
export type Capture = z.infer<typeof Capture>;

export const SearchResultType = z.enum([
  'email',
  'person',
  'event',
  'task',
  'commitment',
  'life_event',
  'memory',
  'capture',
]);
export const SearchResult = z.object({
  type: SearchResultType,
  id: Uuid,
  title: z.string().max(200),
  snippet: z.string().max(300),
  source: SourceRef,
  score: z.number(),
  route: z.string(),
});
export type SearchResult = z.infer<typeof SearchResult>;

/** A signed Storage upload target (captures, reply attachments). */
export const SignedUpload = z.object({
  signed_url: z.url(),
  token: z.string(),
  path: z.string(),
  expires_at: IsoDateTime,
});

/** `true` when at least one property of a (patch) object is set; used by "no_changes" refinements. */
export function hasDefinedValue(value: object): boolean {
  return Object.values(value as Record<string, unknown>).some((v) => v !== undefined);
}

/** Empty strict body (`z.strictObject({})`). */
export const EmptyBody = z.strictObject({});

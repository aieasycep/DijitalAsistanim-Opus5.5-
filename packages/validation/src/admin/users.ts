import { z } from 'zod';
import {
  ACCOUNT_STATUS_VALUES,
  BRIEFING_KIND_VALUES,
  BRIEFING_STATUS_VALUES,
  CAPABILITY_VALUES,
  GRANT_SOURCE_VALUES,
  JOB_STATUS_VALUES,
  JOB_TYPE_VALUES,
  NOTIFICATION_DECISION_VALUES,
  PLATFORM_VALUES,
  PROVIDER_VALUES,
  REFERRAL_SIDE_VALUES,
  REFERRAL_STATUS_VALUES,
  SUPPORT_ACCESS_SCOPE_VALUES,
  TICKET_CATEGORY_VALUES,
  TICKET_STATUS_VALUES,
  USER_STATE_VALUES,
} from '@da/domain';
import { DataSourceToggles, Email, IsoDateTime, LocalDate, Uuid } from '../api/common.ts';
import {
  EmailMasked,
  PagedSuccess,
  Reason,
  SensitiveBody,
  Success,
  adminListQuery,
} from './common.ts';

/* ADM-02 · Users and user actions (§12.3). Reads return masked PII; tab reads never audit. */

export const UserPlanFilter = z.enum(['free', 'pro', 'trial']);
export const UsersListQuery = adminListQuery({
  sort: ['created_at', 'last_active_at', 'last_sync_at'],
  filters: {
    plan: UserPlanFilter,
    state: z.enum(['inactive', 'sync_error', 'connection_error', 'disabled']),
  },
});
export const UserRow = z.object({
  id: Uuid,
  email_masked: EmailMasked,
  plan: UserPlanFilter,
  created_at: IsoDateTime,
  last_active_at: IsoDateTime.nullable(),
  platform: z.enum(PLATFORM_VALUES).nullable(),
  connected_accounts: z.int().min(0),
  last_sync_at: IsoDateTime.nullable(),
  status: z.enum(USER_STATE_VALUES),
});
export const UsersListResponse = PagedSuccess(UserRow);

export const UserOverviewResponse = Success(
  z.object({
    user_id: Uuid,
    account_status: z.enum(USER_STATE_VALUES),
    plan: UserPlanFilter,
    integrations: z.array(
      z.object({
        provider: z.enum(PROVIDER_VALUES),
        status: z.enum(ACCOUNT_STATUS_VALUES),
        last_sync_at: IsoDateTime.nullable(),
        last_error_code: z.string().nullable(),
        watch_expires_at: IsoDateTime.nullable(),
      }),
    ),
    job_errors: z.array(z.string()).max(20),
    briefing_status: z
      .array(
        z.object({
          local_date: LocalDate,
          kind: z.enum(BRIEFING_KIND_VALUES),
          status: z.enum(BRIEFING_STATUS_VALUES),
        }),
      )
      .max(7),
    push_status: z.object({
      tokens_enabled: z.int().min(0),
      last_receipt_error: z.string().nullable(),
    }),
    app_version: z.string().nullable(),
    platform: z.enum(PLATFORM_VALUES).nullable(),
  }),
);

/** No token or ciphertext column exists in this row (schema snapshot test). */
export const UserIntegrationEntry = z.strictObject({
  account_id: Uuid,
  provider: z.enum(PROVIDER_VALUES),
  email_masked: EmailMasked.nullable(),
  capabilities_granted: z.array(z.enum(CAPABILITY_VALUES)),
  status: z.enum(ACCOUNT_STATUS_VALUES),
  error_class: z.string().nullable(),
  resources: z.array(
    z.strictObject({
      resource: z.enum(['mail', 'calendar', 'tasks']),
      last_success_at: IsoDateTime.nullable(),
      last_error_code: z.string().nullable(),
      consecutive_failures: z.int().min(0),
      watch_expires_at: IsoDateTime.nullable(),
      watch_status: z.string().nullable(),
    }),
  ),
  data_sources: DataSourceToggles,
  recent_jobs: z
    .array(
      z.strictObject({
        id: Uuid,
        type: z.enum(JOB_TYPE_VALUES),
        status: z.enum(JOB_STATUS_VALUES),
        last_error_code: z.string().nullable(),
        created_at: IsoDateTime,
      }),
    )
    .max(5),
});
export const UserIntegrationsResponse = Success(z.array(UserIntegrationEntry).max(10));

export const UserBriefingsQuery = adminListQuery({
  sort: ['local_date', 'scheduled_for'],
  filters: {
    kind: z.enum(BRIEFING_KIND_VALUES),
    status: z.enum(BRIEFING_STATUS_VALUES),
    from: LocalDate,
    to: LocalDate,
  },
  q: false,
});
/** Never narrative, sections or item text (strict row). */
export const UserBriefingRow = z.strictObject({
  id: Uuid,
  kind: z.enum(BRIEFING_KIND_VALUES),
  local_date: LocalDate,
  status: z.enum(BRIEFING_STATUS_VALUES),
  scheduled_for: IsoDateTime.nullable(),
  generated_at: IsoDateTime.nullable(),
  delivered_at: IsoDateTime.nullable(),
  latency_ms: z.int().min(0).nullable(),
  item_count: z.int().min(0),
  ai_cost_usd: z.number().min(0),
  notification_decision: z.enum(NOTIFICATION_DECISION_VALUES).nullable(),
  skip_reason: z.string().nullable(),
  error_code: z.string().nullable(),
});
export const UserBriefingsResponse = PagedSuccess(UserBriefingRow);

export const UserUsageQuery = z.strictObject({
  range: z.enum(['7d', '30d', '90d']).default('30d'),
});
/** Counts only (M§42, M§119). */
export const UserUsageResponse = Success(
  z.strictObject({
    ai: z.strictObject({
      days: z.array(
        z.strictObject({
          date: LocalDate,
          feature: z.string(),
          requests: z.int().min(0),
          input_tokens: z.int().min(0),
          output_tokens: z.int().min(0),
          cost_usd: z.number().min(0),
          units: z.int().min(0),
        }),
      ),
      daily_budget_units: z.int().min(0).nullable(),
      budget_hit_days: z.int().min(0),
    }),
    feature_usage: z.strictObject({
      briefing_opened: z.int().min(0),
      assistant_query_sent: z.int().min(0),
      capture_created: z.int().min(0),
      meeting_prep_opened: z.int().min(0),
      follow_up_actioned: z.int().min(0),
      search_performed: z.int().min(0),
      approval_decided: z.int().min(0),
    }),
    approvals: z.strictObject({
      created: z.int().min(0),
      approved: z.int().min(0),
      executed: z.int().min(0),
    }),
    reminders_created: z.int().min(0),
    captures: z.strictObject({ count: z.int().min(0), bytes: z.int().min(0) }),
    content_volumes: z.strictObject({
      email_threads: z.int().min(0),
      calendar_events: z.int().min(0),
      insights: z.int().min(0),
      memory_chunks: z.int().min(0),
    }),
    notifications_by_decision: z.partialRecord(
      z.enum(NOTIFICATION_DECISION_VALUES),
      z.int().min(0),
    ),
  }),
);

export const GrantState = z.enum(['active', 'scheduled', 'ended', 'revoked']);
export const UserSubscriptionQuery = z.strictObject({
  grants_page: z.coerce.number().int().min(1).default(1),
  events_page: z.coerce.number().int().min(1).default(1),
});
export const SanitizedBillingEventRow = z.object({
  event_id: z.string(),
  type: z.string(),
  environment: z.enum(['SANDBOX', 'PRODUCTION']),
  received_at: IsoDateTime,
  processed: z.boolean(),
});
/** Price and billing-event keys are absent (not null) without their permissions. */
export const UserSubscriptionResponse = Success(
  z.object({
    store: z
      .object({
        store: z.string().nullable(),
        product_id: z.string().nullable(),
        period_type: z.string().nullable(),
        is_active: z.boolean(),
        will_renew: z.boolean(),
        expires_at: IsoDateTime.nullable(),
        billing_issue_detected_at: IsoDateTime.nullable(),
        environment: z.enum(['SANDBOX', 'PRODUCTION']).nullable(),
        synced_at: IsoDateTime.nullable(),
        last_event_id: z.string().nullable(),
        original_transaction_id: z
          .string()
          .regex(/^…\w{4}$/)
          .nullable(),
        price_usd: z.number().optional(),
      })
      .nullable(),
    grants: z.array(
      z.object({
        id: Uuid,
        source: z.enum(GRANT_SOURCE_VALUES),
        duration_days: z.int().min(1),
        starts_at: IsoDateTime,
        ends_at: IsoDateTime,
        state: GrantState,
        granted_by: z.string().nullable(),
        reason: z.string().nullable(),
        revoked_at: IsoDateTime.nullable(),
      }),
    ),
    effective: z.object({
      entitlement: z.enum(['pro', 'free']),
      source: z.string().nullable(),
      until: IsoDateTime.nullable(),
    }),
    billing_events: z.array(SanitizedBillingEventRow).max(20).optional(),
  }),
);

export const UserReferralsQuery = adminListQuery({
  sort: ['created_at'],
  filters: { status: z.enum(REFERRAL_STATUS_VALUES) },
  q: false,
});
/** Hashed anti-abuse signals are never returned; only their labels. */
export const UserReferralsResponse = Success(
  z.object({
    code: z.string().nullable(),
    as_referrer: z.array(
      z.strictObject({
        id: Uuid,
        referee_masked: z.string(),
        status: z.enum(REFERRAL_STATUS_VALUES),
        risk_score: z.number().min(0).max(1).nullable(),
        signal_labels: z.array(z.string()),
        created_at: IsoDateTime,
        qualified_at: IsoDateTime.nullable(),
        rewarded_at: IsoDateTime.nullable(),
      }),
    ),
    as_referee: z
      .object({ id: Uuid, referrer_masked: z.string(), status: z.enum(REFERRAL_STATUS_VALUES) })
      .nullable(),
    credits: z.array(
      z.object({
        referral_id: Uuid,
        side: z.enum(REFERRAL_SIDE_VALUES),
        grant_id: Uuid.nullable(),
        days: z.int().min(0),
      }),
    ),
    yearly_rewards: z.object({ used: z.int().min(0), max: z.int().min(0) }),
  }),
);

export const UserSupportQuery = adminListQuery({
  sort: ['created_at'],
  filters: { status: z.enum(TICKET_STATUS_VALUES) },
  q: false,
});
export const UserSupportResponse = Success(
  z.object({
    tickets: z.array(
      z.object({
        id: Uuid,
        reference: z.string(),
        category: z.enum(TICKET_CATEGORY_VALUES),
        status: z.enum(TICKET_STATUS_VALUES),
        subject: z.string(),
        assignee: z.string().nullable(),
        created_at: IsoDateTime,
      }),
    ),
    access_grants: z.array(
      z.object({
        id: Uuid,
        admin: z.object({ id: Uuid, display_name: z.string().nullable() }),
        scopes: z.array(z.enum(SUPPORT_ACCESS_SCOPE_VALUES)),
        reason: z.string(),
        starts_at: IsoDateTime,
        expires_at: IsoDateTime,
        revoked_at: IsoDateTime.nullable(),
        reveal_count: z.int().min(0),
        active: z.boolean(),
      }),
    ),
  }),
);

export const UserDevicesResponse = Success(
  z.array(
    z.strictObject({
      installation_id: Uuid,
      platform: z.enum(PLATFORM_VALUES),
      app_version: z.string(),
      build_number: z.string(),
      os_version: z.string().nullable(),
      push_enabled: z.boolean(),
      token_masked: z
        .string()
        .regex(/^ExponentPushToken\[[A-Za-z0-9_-]{0,2}…[A-Za-z0-9_-]{0,2}\]$/)
        .nullable(),
      last_seen_at: IsoDateTime,
      last_receipt_status: z.string().nullable(),
      last_receipt_error: z.string().nullable(),
    }),
  ),
);

// Mutations
export const UserRevealBody = z.strictObject({
  field: z.literal('email'),
  reason: Reason,
  confirm: z.literal(true),
});
export const UserForceSyncBody = z.strictObject({
  reason: Reason,
  confirm: z.literal(true),
  resources: z
    .array(z.enum(['mail', 'calendar', 'tasks']))
    .min(1)
    .max(3)
    .optional(),
});
export const UserForceSyncResponse = Success(
  z.object({ jobs: z.array(z.object({ job_id: Uuid, type: z.enum(JOB_TYPE_VALUES) })) }),
);
export const UserDisableBody = SensitiveBody;
export const UserRestoreBody = SensitiveBody;
export const UserStateResponse = Success(
  z.object({ user_id: Uuid, account_status: z.enum(USER_STATE_VALUES) }),
);

/** `entitlements.grant`: 1/7/14/30 days, any source; `entitlements.grant_limited`: 1/7 days, `support` only. */
export const EntitlementGrantBody = z.strictObject({
  duration_days: z.union([z.literal(1), z.literal(7), z.literal(14), z.literal(30)]),
  source: z.enum(['admin', 'support', 'compensation']),
  reason: Reason,
  confirm: z.literal(true),
});
export const LIMITED_GRANT_RULE = { durations: [1, 7], source: 'support' } as const;
/** `true` when a grant body is allowed for a holder of only `entitlements.grant_limited`. */
export function isLimitedGrantAllowed(body: z.infer<typeof EntitlementGrantBody>): boolean {
  return (
    (LIMITED_GRANT_RULE.durations as readonly number[]).includes(body.duration_days) &&
    body.source === LIMITED_GRANT_RULE.source
  );
}
export const EntitlementGrantResponse = Success(
  z.object({
    id: Uuid,
    user_id: Uuid,
    source: z.enum(GRANT_SOURCE_VALUES),
    duration_days: z.int().min(1),
    starts_at: IsoDateTime,
    ends_at: IsoDateTime,
    state: GrantState,
  }),
);
export const GrantParams = z.strictObject({ id: Uuid, grantId: Uuid });
export const GrantRevokeBody = SensitiveBody;

export const UserIntegrationParams = z.strictObject({ id: Uuid, accountId: Uuid });
export const AdminDisconnectBody = z.strictObject({
  reason: Reason,
  confirm: z.literal(true),
  purge_content: z.boolean(),
});
export const AdminDisconnectResponse = Success(
  z.object({
    account_id: Uuid,
    status: z.enum(ACCOUNT_STATUS_VALUES),
    revocation: z.enum(['provider_revoked', 'local_only', 'revoke_failed']),
  }),
);

export const UserLookupBody = z.strictObject({ email: Email });
export const UserLookupResponse = Success(z.object({ user_id: Uuid }));
export const UserInternalBody = z.strictObject({ internal: z.boolean(), reason: Reason });
export const UserInternalResponse = Success(z.object({ user_id: Uuid, internal: z.boolean() }));

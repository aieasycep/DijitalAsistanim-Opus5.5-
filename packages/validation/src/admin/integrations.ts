import { z } from 'zod';
import {
  ACCOUNT_STATUS_VALUES,
  JOB_STATUS_VALUES,
  JOB_TYPE_VALUES,
  PROVIDER_VALUES,
} from '@da/domain';
import { IsoDateTime, Uuid } from '../api/common.ts';
import {
  EmailMasked,
  MetricsRange,
  PagedSuccess,
  SensitiveBody,
  Success,
  adminListQuery,
} from './common.ts';

/* ADM-04 · Integrations (§12.3). No token or ciphertext field exists in any schema here. */

export const AccountParams = z.strictObject({ accountId: Uuid });
export const IntegrationsListQuery = adminListQuery({
  sort: ['last_sync_at', 'status', 'provider'],
  filters: {
    provider: z.enum(['google', 'microsoft', 'apple_device', 'android_device']),
    status: z.enum(ACCOUNT_STATUS_VALUES),
    issue: z.enum(['needs_reconnect', 'oauth_error', 'refresh_error', 'watch_issue']),
  },
});
export const IntegrationRow = z.strictObject({
  account_id: Uuid,
  user_id: Uuid,
  provider: z.enum(PROVIDER_VALUES),
  email_masked: EmailMasked.nullable(),
  status: z.enum(ACCOUNT_STATUS_VALUES),
  last_sync_at: IsoDateTime.nullable(),
  last_error_code: z.string().nullable(),
  watch_expires_at: IsoDateTime.nullable(),
  key_version: z.int().min(1).nullable(),
});
export const IntegrationsListResponse = PagedSuccess(IntegrationRow);

export const IntegrationsSummaryQuery = z.strictObject({ range: MetricsRange.default('7d') });
export const IntegrationsSummaryResponse = Success(
  z.strictObject({
    by_provider_status: z.array(
      z.strictObject({
        provider: z.enum(PROVIDER_VALUES),
        status: z.enum(ACCOUNT_STATUS_VALUES),
        count: z.int().min(0),
      }),
    ),
    reconnect_rate: z.number().min(0).max(1),
    watches_expiring_24h: z.int().min(0),
    watch_renewals_failed_24h: z.int().min(0),
    oldest_healthy_last_sync_at: IsoDateTime.nullable(),
  }),
);

export const IntegrationDetailResponse = Success(
  z.strictObject({
    account: IntegrationRow,
    granted_scopes: z.array(z.string()),
    sync_states: z.array(
      z.strictObject({
        resource: z.string(),
        status: z.string(),
        last_success_at: IsoDateTime.nullable(),
        last_error_code: z.string().nullable(),
        watch_expires_at: IsoDateTime.nullable(),
      }),
    ),
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
      .max(20),
    webhook_stats: z.strictObject({
      received_24h: z.int().min(0),
      unmatched_24h: z.int().min(0),
      last_received_at: IsoDateTime.nullable(),
    }),
  }),
);
export const IntegrationForceSyncBody = SensitiveBody;
export const IntegrationRenewWatchBody = SensitiveBody;
export const IntegrationJobsResponse = Success(
  z.object({ jobs: z.array(z.object({ job_id: Uuid, type: z.enum(JOB_TYPE_VALUES) })) }),
);

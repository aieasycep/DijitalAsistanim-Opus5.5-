/**
 * Provider error → job outcome and `connected_accounts.status` (INTEGRATION_PLAN §3.9; API_CONTRACTS
 * JOB-01 terminal failures): reauth / scope / admin-consent / credential failures are terminal,
 * throttling and outages retry, and the account status follows the domain policy.
 */
import { assertEquals, assertRejects } from '@std/assert';
import { type ProviderErrorCode, ProviderError } from '@da/domain';
import { JobError } from '../../jobs/types.ts';
import { integrationHarness } from '../../testing/integrations.ts';
import { USER_A } from '../../testing/jwt.ts';
import { failJob, type SyncRun } from './sync-common.ts';

const TABLE: readonly [ProviderErrorCode, string, boolean, string][] = [
  ['auth_invalid_grant', 'PROVIDER_REAUTH_REQUIRED', false, 'needs_reauth'],
  ['auth_token_rejected', 'PROVIDER_REAUTH_REQUIRED', false, 'needs_reauth'],
  ['scope_missing', 'PROVIDER_SCOPE_MISSING', false, 'partial'],
  ['consent_admin_required', 'PROVIDER_ADMIN_CONSENT_REQUIRED', false, 'admin_consent_required'],
  ['external_credential_required', 'EXTERNAL_CREDENTIAL_REQUIRED', false, 'error'],
  ['mailbox_unavailable', 'PROVIDER_REJECTED', false, 'partial'],
  ['rate_limited', 'PROVIDER_RATE_LIMITED', true, 'healthy'],
  ['quota_exhausted_daily', 'PROVIDER_RATE_LIMITED', true, 'healthy'],
  ['provider_unavailable', 'PROVIDER_UNAVAILABLE', true, 'healthy'],
];

Deno.test('provider failures map to job outcomes and account status', async () => {
  for (const [code, jobCode, retryable, status] of TABLE) {
    const h = await integrationHarness();
    const account = h.store.addAccount({ user_id: USER_A, provider: 'google', status: 'healthy' });
    const run: SyncRun = {
      rt: h.runtime,
      owner: 'job:test',
      correlationId: 'c',
      log: h.runtime.log,
      deadline: Date.now() + 1000,
    };
    const err = await assertRejects(
      () =>
        failJob(
          run,
          account,
          new ProviderError(code, 400, code === 'rate_limited' ? 30_000 : null, null),
        ),
      JobError,
    );
    assertEquals([err.code, err.retryable], [jobCode, retryable], code);
    const after = h.store.accounts.get(account.id);
    assertEquals(after?.status, status === 'healthy' ? 'healthy' : status, code);
    if (code === 'rate_limited') assertEquals(err.retryAfterSeconds, 30);
    if (status === 'needs_reauth')
      assertEquals(
        h.audit.filter((a) => a.action === 'system.integration.reauth_required').length,
        1,
      );
  }
});

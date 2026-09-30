/**
 * Account reconnect notification (INTEGRATION_PLAN §3.9; TEST_PLAN IT-OAUTH-08): the job the DB
 * trigger `trg_connected_accounts_status_notify` enqueues when an account moves to `needs_reauth` or
 * `admin_consent_required` (payload `{category:'account', kind:'account_reauth',
 * connected_account_id, status}`, key `account_reauth:{account}:{utc_date}`). The account is re-read:
 * a reconnected or removed account sends nothing. Template `push.account.reauth_needed` ("Gmail
 * bağlantısı yenilenmeli."); the dedupe key is the job key, so one notification per account and day.
 */
import { toDeepLink } from '@da/domain';
import { baseSpec } from '../create.ts';
import { skip, type TriggerContext, type TriggerOutcome } from './types.ts';

const SERVICE: Readonly<Record<string, string>> = {
  google: 'Gmail',
  microsoft: 'Outlook',
};

export async function accountReauthTrigger(
  ctx: TriggerContext,
  accountId: string | undefined,
): Promise<TriggerOutcome> {
  if (accountId === undefined || ctx.repo.connectedAccount === undefined)
    return skip('account_unknown');
  const account = await ctx.repo.connectedAccount(ctx.userId, accountId);
  if (account === null) return skip('account_gone');
  if (account.status !== 'needs_reauth' && account.status !== 'admin_consent_required')
    return skip('account_recovered');
  const provider =
    account.provider === 'demo' ? (account.demo_flavor ?? 'google') : account.provider;
  const service = SERVICE[provider];
  if (service === undefined) return skip('account_unknown');
  return {
    kind: 'spec',
    spec: baseSpec({
      category: 'account',
      dedupeKey: ctx.jobKey,
      template: 'account',
      variant: 'reauth_needed',
      urgency: 'today',
      entityType: 'connected_account',
      entityId: accountId,
      deeplink: toDeepLink(`/settings/accounts/${accountId}`),
      paramsPublic: { service, kind: 'mail' },
    }),
  };
}

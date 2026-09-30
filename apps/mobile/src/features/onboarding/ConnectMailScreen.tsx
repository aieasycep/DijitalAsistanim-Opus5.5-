/**
 * M-ON-06 connect mail ("Dijital hayatını bağla", step 1 · MAİL): Gmail and Outlook (plus the demo
 * provider in demo environments) through the explainer → OAuth → client-bound completion flow
 * (R-07). Rows follow the real `connected_accounts` status; Free users get the `multi_account`
 * gate for a second mail account (D-30). "Devam" needs one connected mail account; "Şimdilik geç"
 * is always offered (C-17). The back circle offers a deliberate sign-out (M-ON-06S).
 */
import type { Provider } from '@da/domain/enums';
import { useBootstrap } from '@da/api-client/react';
import { Button, ErrorCard, TrustLine } from '@da/ui';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslations } from 'use-intl';

import { unavailableReason } from '../../lib/bootstrap';
import { sheets } from '../../providers/SheetHost';
import { isPro, openProGate } from '../pro-gate/ProGate';
import { mailAccounts, useAccounts, type AccountRow } from '../integrations/accounts';
import { INTEGRATION_ACCOUNT_SHEET } from '../integrations/sheets/AccountSheet';
import { ADMIN_CONSENT_SHEET } from '../integrations/sheets/AdminConsentSheet';
import { INTEGRATION_EXPLAINER_SHEET } from '../integrations/sheets/ExplainerSheet';
import type { OnboardingPill } from '../integrations/status';
import { ConnectRow } from './ConnectRow';
import { OnboardingFrame } from './OnboardingFrame';
import { SIGN_OUT_CONFIRM_SHEET } from './SignOutConfirm';
import { enterStep, routeOf, skipStep } from './steps';
import { ListSkeleton } from '../common/ListSkeleton';

type MailProvider = 'google' | 'microsoft' | 'demo';

export function mailRowAccount(
  accounts: readonly AccountRow[],
  provider: Provider,
): AccountRow | undefined {
  return (
    accounts.find((a) => a.provider === provider && a.capabilities_granted.includes('mail_read')) ??
    accounts.find(
      (a) =>
        a.provider === provider &&
        (a.status === 'connecting' || a.status === 'admin_consent_required'),
    )
  );
}

export function ConnectMailScreen() {
  const t = useTranslations('onboarding');
  const common = useTranslations('common');
  const router = useRouter();
  const bootstrap = useBootstrap();
  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data?.accounts ?? [];
  const connected = mailAccounts(accountsQuery.data).filter(
    (a) => a.status !== 'connecting' && a.status !== 'error',
  );

  useEffect(() => {
    enterStep('connect_mail');
  }, []);

  const providers: readonly MailProvider[] =
    bootstrap.data?.demo_mode === true ? ['google', 'microsoft', 'demo'] : ['google', 'microsoft'];

  const onAction = (
    provider: MailProvider,
    account: AccountRow | undefined,
    pill: OnboardingPill,
  ) => {
    switch (pill) {
      case 'connected':
        if (account !== undefined)
          sheets.open(INTEGRATION_ACCOUNT_SHEET, { accountId: account.id });
        return;
      case 'adminConsent':
        sheets.open(ADMIN_CONSENT_SHEET, { url: null });
        return;
      case 'connect':
        if (!isPro() && connected.length >= 1) {
          openProGate('multi_account');
          return;
        }
        break;
      default:
        break;
    }
    sheets.open(INTEGRATION_EXPLAINER_SHEET, {
      kind: 'mail',
      provider,
      returnTo: 'onboarding',
      accounts,
      ...(account !== undefined && (pill === 'reauth' || pill === 'retry')
        ? { reconnect: account }
        : {}),
    });
  };

  const count = connected.length;
  return (
    <OnboardingFrame
      kicker={t('steps.mail')}
      title={t('connect.title')}
      subtitle={t('connect.body')}
      onBack={() => {
        sheets.open(SIGN_OUT_CONFIRM_SHEET, undefined);
      }}
      testID="onboarding.connectMail"
      footer={
        <>
          <Button
            label={count > 0 ? t('connect.cta', { count }) : t('connect.ctaNone')}
            fullWidth
            disabled={count === 0}
            onPress={() => {
              router.push(routeOf('connect_calendar'));
            }}
            testID="connectMail.continue"
          />
          <Button
            label={common('actions.skipForNow')}
            variant="text"
            fullWidth
            onPress={() => {
              skipStep('connect_mail');
              router.push(routeOf('connect_calendar'));
            }}
            testID="connectMail.skip"
          />
        </>
      }
    >
      {accountsQuery.isPending ? (
        <ListSkeleton rows={2} accessibilityLabel={common('a11y.loading')} />
      ) : accountsQuery.isError && accountsQuery.data === undefined ? (
        <ErrorCard
          icon="cloud_off"
          tone="neutral"
          title={t('connect.loadFailed')}
          primaryAction={{
            label: common('actions.retry'),
            onPress: () => {
              void accountsQuery.refetch();
            },
          }}
          testID="connectMail.error"
        />
      ) : (
        providers.map((provider) => {
          const account = mailRowAccount(accounts, provider);
          const name = common(
            `providers.${provider === 'google' ? 'gmail' : provider === 'microsoft' ? 'outlook' : 'demo'}`,
          );
          return (
            <ConnectRow
              key={provider}
              provider={provider}
              name={name}
              status={account?.status ?? null}
              {...(account?.account_email === null || account === undefined
                ? {}
                : { meta: t('connect.meta', { email: account.account_email }) })}
              notConfigured={
                provider !== 'demo' &&
                unavailableReason(bootstrap.data, `integrations.${provider}`) !== null
              }
              onAction={(pill) => {
                onAction(provider, account, pill);
              }}
              testID={`connectMail.row.${provider}`}
            />
          );
        })
      )}
      <TrustLine text={t('connect.trust')} />
    </OnboardingFrame>
  );
}

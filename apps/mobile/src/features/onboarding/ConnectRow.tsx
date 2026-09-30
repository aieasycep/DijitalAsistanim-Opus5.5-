/**
 * One provider row of the onboarding connect steps (P/02 2.6 IntegrationRow): the pill follows
 * `connected_accounts.status` (M-ON-06 table), the meta line never claims analysis before it ran
 * (D-07), and the whole row is one accessible element whose activation runs the row's action.
 */
import type { AccountStatus, Provider } from '@da/domain/enums';
import { IntegrationRow } from '@da/ui';
import { useTranslations } from 'use-intl';

import {
  ProviderLogo,
  connectStateOf,
  onboardingPillOf,
  type OnboardingPill,
} from '../integrations/status';

export interface ConnectRowProps {
  readonly provider: Provider;
  readonly name: string;
  readonly status: AccountStatus | null;
  readonly meta?: string;
  /** `service_status` says this provider has no credentials in this environment. */
  readonly notConfigured?: boolean;
  readonly busy?: boolean;
  readonly onAction: (pill: OnboardingPill) => void;
  readonly testID: string;
}

export function ConnectRow({
  provider,
  name,
  status,
  meta,
  notConfigured = false,
  busy = false,
  onAction,
  testID,
}: ConnectRowProps) {
  const t = useTranslations('onboarding.connect');
  const pill: OnboardingPill = busy ? 'connecting' : onboardingPillOf(status);
  const label = t(`pills.${pill}`);
  if (notConfigured && pill === 'connect') {
    return (
      <IntegrationRow
        logo={<ProviderLogo provider={provider} />}
        name={name}
        meta={t('notConfigured')}
        state="connect"
        stateLabel={label}
        disabled
        disabledReason={t('notConfigured')}
        testID={testID}
      />
    );
  }
  return (
    <IntegrationRow
      logo={<ProviderLogo provider={provider} />}
      name={name}
      {...(meta === undefined ? {} : { meta })}
      state={connectStateOf(pill)}
      stateLabel={label}
      {...(pill === 'connecting'
        ? {}
        : {
            onConnectPress: () => {
              onAction(pill);
            },
            onPress: () => {
              onAction(pill);
            },
          })}
      testID={testID}
    />
  );
}

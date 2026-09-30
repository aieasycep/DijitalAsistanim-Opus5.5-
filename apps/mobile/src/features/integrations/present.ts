/**
 * Shows the result of a connect / upgrade flow (M-ON-06 "Error", M-SET-11 "Error"): toasts, the
 * `multi_account` Pro gate (402 / `plan_limit`), the admin-consent sheet, and the
 * `integration_connect_result` analytics event. A cancel or a denial is silent in onboarding.
 */
import { isApiError } from '@da/api-client';
import type { Provider } from '@da/domain/enums';

import { translator } from '../../i18n/translate';
import { track } from '../../lib/events';
import { entitlementFeatureOf } from '../../lib/postgrest';
import { sheets } from '../../providers/SheetHost';
import { showToast } from '../../providers/ToastHost';
import { openProGate } from '../pro-gate/ProGate';
import { ADMIN_CONSENT_SHEET } from './sheets/AdminConsentSheet';
import type { ConnectOutcome } from './connect';
import type { ReadCapability, ReturnTo } from './pending';
import { providerNameKey } from './status';

export interface OutcomeContext {
  readonly provider: Provider;
  readonly capability: ReadCapability;
  readonly returnTo: ReturnTo;
}

type ResultEvent =
  | 'success'
  | 'cancelled'
  | 'error'
  | 'partial'
  | 'admin_consent_required'
  | 'not_configured'
  | 'pro_required';

function isExternalCredential(outcome: ConnectOutcome): boolean {
  if (outcome.kind === 'failed') return outcome.code === 'EXTERNAL_CREDENTIAL_REQUIRED';
  return (
    outcome.kind === 'start_failed' &&
    isApiError(outcome.error) &&
    outcome.error.code === 'EXTERNAL_CREDENTIAL_REQUIRED'
  );
}

/** Presents the outcome; returns the analytics result it recorded. */
export function presentConnectOutcome(outcome: ConnectOutcome, ctx: OutcomeContext): ResultEvent {
  const t = translator();
  const capabilityGroup = ctx.capability === 'calendar_read' ? 'calendar' : 'mail';
  const service = t(`common.providers.${providerNameKey(ctx.provider, capabilityGroup)}`);
  const onboarding = ctx.returnTo === 'onboarding';
  let result: ResultEvent;
  switch (outcome.kind) {
    case 'completed':
      switch (outcome.result) {
        case 'success':
          result = 'success';
          break;
        case 'partial':
          result = 'partial';
          showToast({
            message:
              ctx.capability === 'mail_read'
                ? t('onboarding.connect.toasts.partialMail')
                : t('onboarding.connect.toasts.partial'),
          });
          break;
        case 'account_mismatch':
          result = 'error';
          showToast({ message: t('onboarding.connect.toasts.mismatch'), kind: 'error' });
          break;
        case 'already_linked':
          result = 'error';
          showToast({ message: t('onboarding.connect.toasts.alreadyLinked'), kind: 'error' });
          break;
        case 'plan_limit':
          result = 'pro_required';
          openProGate('multi_account');
          break;
      }
      break;
    case 'already_granted':
      result = 'success';
      break;
    case 'cancelled':
      result = 'cancelled';
      break;
    case 'denied':
      result = 'cancelled';
      if (!onboarding) {
        showToast({ message: t('states.error.oauthExpired.declined.title'), kind: 'error' });
      }
      break;
    case 'admin_consent_required':
      result = 'admin_consent_required';
      sheets.open(ADMIN_CONSENT_SHEET, { url: outcome.adminConsentUrl });
      break;
    case 'failed':
      if (isExternalCredential(outcome)) {
        result = 'not_configured';
        showToast({ message: t('onboarding.connect.toasts.notConfigured'), kind: 'error' });
      } else if (outcome.code === 'CONDITIONAL_ACCESS') {
        result = 'error';
        showToast({ message: t('onboarding.connect.toasts.conditionalAccess'), kind: 'error' });
      } else {
        result = 'error';
        showToast({
          message:
            outcome.reason === 'expired_state'
              ? t('onboarding.connect.toasts.expired')
              : t('onboarding.connect.toasts.failed', { service }),
          kind: 'error',
        });
      }
      break;
    case 'rejected':
    case 'no_pending':
      result = 'error';
      showToast({ message: t('onboarding.connect.toasts.rejected'), kind: 'error' });
      break;
    case 'start_failed': {
      const feature = entitlementFeatureOf(outcome.error);
      if (feature !== null) {
        result = 'pro_required';
        openProGate('multi_account');
      } else if (isExternalCredential(outcome)) {
        result = 'not_configured';
        showToast({ message: t('onboarding.connect.toasts.notConfigured'), kind: 'error' });
      } else if (isApiError(outcome.error) && outcome.error.code === 'OFFLINE_BLOCKED') {
        result = 'error';
        showToast({ message: t('states.offline.blockedToast'), kind: 'offline' });
      } else {
        result = 'error';
        showToast({ message: t('onboarding.connect.toasts.failed', { service }), kind: 'error' });
      }
      break;
    }
  }
  track('integration_connect_result', {
    provider: ctx.provider,
    capability: ctx.capability,
    result,
  });
  return result;
}

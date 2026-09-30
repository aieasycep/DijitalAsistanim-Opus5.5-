/**
 * Provider names, logos and the `account_status` → UI mapping (SCREEN_AND_FLOW_MAP M-ON-06 pill
 * table and Part 4 §2 status table). Status is always carried by text and icon, never colour alone.
 */
import type { AccountStatus, Provider } from '@da/domain/enums';
import { Icon, useTheme, type ConnectState, type StatusTone } from '@da/ui';
import type { ReactNode } from 'react';

import { AppleMark, GoogleMark, MicrosoftMark } from '../auth/ProviderLogos';

export type ProviderRowKey =
  | 'gmail'
  | 'outlook'
  | 'googleCalendar'
  | 'outlookCalendar'
  | 'appleCalendar'
  | 'deviceCalendar'
  | 'googleTasks'
  | 'microsoftTodo';

/** `common.providers.*` key for a provider + capability pair. */
export function providerNameKey(
  provider: Provider,
  capability: 'mail' | 'calendar' | 'tasks' = 'mail',
): ProviderRowKey | 'google' | 'microsoft' | 'demo' {
  switch (provider) {
    case 'google':
      return capability === 'calendar'
        ? 'googleCalendar'
        : capability === 'tasks'
          ? 'googleTasks'
          : 'gmail';
    case 'microsoft':
      return capability === 'calendar'
        ? 'outlookCalendar'
        : capability === 'tasks'
          ? 'microsoftTodo'
          : 'outlook';
    case 'apple_device':
      return 'appleCalendar';
    case 'android_device':
      return 'deviceCalendar';
    case 'demo':
      return 'demo';
  }
}

/** The identity provider shown in error copy ("Google oturumu…", "Microsoft oturumu…"). */
export function identityProviderKey(provider: Provider): 'google' | 'microsoft' | 'apple' | 'demo' {
  if (provider === 'microsoft') return 'microsoft';
  if (provider === 'apple_device') return 'apple';
  if (provider === 'demo') return 'demo';
  return 'google';
}

export function ProviderLogo({ provider }: { readonly provider: Provider }): ReactNode {
  const theme = useTheme();
  switch (provider) {
    case 'google':
      return <GoogleMark />;
    case 'microsoft':
      return <MicrosoftMark />;
    case 'apple_device':
      return <AppleMark />;
    case 'android_device':
      return <Icon name="calendar_today" size={20} color={theme.color.icon.default} />;
    case 'demo':
      return <Icon name="auto_awesome" size={20} color={theme.color.brand.primary} />;
  }
}

/** Onboarding pill (M-ON-06): `null` status = not connected. */
export type OnboardingPill =
  'connect' | 'connecting' | 'connected' | 'partial' | 'reauth' | 'adminConsent' | 'retry';

export function onboardingPillOf(status: AccountStatus | null): OnboardingPill {
  switch (status) {
    case null:
    case 'disconnected':
      return 'connect';
    case 'connecting':
      return 'connecting';
    case 'healthy':
    case 'syncing':
      return 'connected';
    case 'partial':
      return 'partial';
    case 'needs_reauth':
      return 'reauth';
    case 'admin_consent_required':
      return 'adminConsent';
    case 'error':
      return 'retry';
  }
}

export function connectStateOf(pill: OnboardingPill): ConnectState {
  switch (pill) {
    case 'connect':
      return 'connect';
    case 'connecting':
      return 'connecting';
    case 'connected':
      return 'connected';
    case 'partial':
    case 'reauth':
      return 'needsReauth';
    case 'adminConsent':
    case 'retry':
      return 'error';
  }
}

/** Settings status pill tone (Part 4 §2). */
export function statusToneOf(status: AccountStatus): StatusTone {
  switch (status) {
    case 'healthy':
      return 'success';
    case 'partial':
    case 'admin_consent_required':
      return 'warning';
    case 'needs_reauth':
    case 'error':
      return 'critical';
    default:
      return 'neutral';
  }
}

/** Accounts that are being connected or synced are polled (R-19). */
export function isSettling(status: AccountStatus): boolean {
  return status === 'connecting' || status === 'syncing';
}

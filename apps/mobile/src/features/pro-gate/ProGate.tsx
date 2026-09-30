/**
 * Contextual Pro gate (M-GL-13, P/07 7.6) as used by onboarding, Today, briefings and accounts:
 * an inline `ProGateCard` or the `pro_gate` host sheet. "Pro'yu Gör" opens the paywall
 * (`/paywall?source=<feature>`, T-8.22) when that screen exists in this build; "Şimdi değil"
 * suppresses the gate for 7 days through `user_preferences.dismissed_gates` (server-side,
 * cross-device). Locked content is never fetched for Free users; the server stays authoritative
 * (402 `ENTITLEMENT_REQUIRED`).
 */
import type { ANALYTICS_PRO_FEATURES } from '@da/domain/analytics/vocab';
import { BottomSheet, ProGateCard } from '@da/ui';
import { router } from 'expo-router';
import { useTranslations } from 'use-intl';

import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { cachedBootstrap, patchBootstrapCache, updateUserPreferences } from '../../lib/postgrest';
import { now } from '../../lib/clock';
import { registerSheet, sheets, type SheetRenderProps } from '../../providers/SheetHost';

export type GateFeature = (typeof ANALYTICS_PRO_FEATURES)[number];

export const PRO_GATE_SHEET = 'pro_gate';
const PAYWALL_ROUTE = '/paywall';
const SUPPRESS_MS = 7 * 24 * 60 * 60 * 1000;

type FeatureLabel =
  | 'middayEvening'
  | 'audioBriefing'
  | 'memoryVip'
  | 'androidNi'
  | 'multipleAccounts'
  | 'meetingPrep'
  | 'followUps'
  | 'planning'
  | 'capture';

function labelOf(feature: GateFeature): FeatureLabel {
  switch (feature) {
    case 'midday':
    case 'evening':
      return 'middayEvening';
    case 'voice_briefing':
      return 'audioBriefing';
    case 'vip':
    case 'ai_memory':
      return 'memoryVip';
    case 'android_ni':
      return 'androidNi';
    case 'meeting_prep':
      return 'meetingPrep';
    case 'followups':
    case 'commitments':
      return 'followUps';
    case 'advanced_planning':
      return 'planning';
    case 'capture':
      return 'capture';
    default:
      return 'multipleAccounts';
  }
}

/** Whether the user chose "Şimdi değil" for this gate in the last 7 days. */
export function isGateDismissed(feature: GateFeature, at: Date = now()): boolean {
  const stamp = cachedBootstrap()?.preferences.dismissed_gates[feature];
  if (stamp === undefined) return false;
  const time = Date.parse(stamp);
  return Number.isFinite(time) && at.getTime() - time < SUPPRESS_MS;
}

/** "Şimdi değil": records the dismissal (optimistic; queued failures are ignored). */
export function dismissGate(feature: GateFeature): void {
  const stamp = now().toISOString();
  track('pro_gate_dismissed', { feature, gate: feature });
  const gates = { ...(cachedBootstrap()?.preferences.dismissed_gates ?? {}), [feature]: stamp };
  patchBootstrapCache((data) => ({
    ...data,
    preferences: { ...data.preferences, dismissed_gates: gates },
  }));
  void updateUserPreferences({ dismissed_gates: gates }).catch(() => undefined);
}

function openPaywall(feature: GateFeature, surface: 'sheet' | 'inline' | 'card'): void {
  track('pro_gate_cta_tapped', { feature, trial: false, surface });
  router.push(`${PAYWALL_ROUTE}?source=${feature}`);
}

export interface ContextualGateProps {
  readonly feature: GateFeature;
  readonly title?: string;
  readonly body?: string;
  /** Called after "Şimdi değil" (the caller hides the card). */
  readonly onDismiss?: () => void;
  readonly testID?: string;
}

/** The inline 7.6 gate card. */
export function ContextualGate({ feature, title, body, onDismiss, testID }: ContextualGateProps) {
  const t = useTranslations();
  const paywall = isScreenAvailable(PAYWALL_ROUTE);
  const dismiss = {
    label: t('paywall.gate.dismiss'),
    onPress: () => {
      dismissGate(feature);
      onDismiss?.();
    },
  };
  return (
    <ProGateCard
      kicker={t(`paywall.features.${labelOf(feature)}`)}
      title={title ?? t('paywall.gate.title')}
      body={body ?? t('paywall.gate.morningFree')}
      primaryAction={
        paywall
          ? {
              label: t('common.actions.seePro'),
              onPress: () => {
                openPaywall(feature, 'inline');
              },
            }
          : dismiss
      }
      {...(paywall ? { dismissAction: dismiss } : {})}
      testID={testID ?? `gate.${feature}`}
    />
  );
}

interface GateSheetParams {
  readonly feature: GateFeature;
}

function ProGateSheet({ params, visible, onDismiss, onHidden }: SheetRenderProps<GateSheetParams>) {
  const t = useTranslations();
  const paywall = isScreenAvailable(PAYWALL_ROUTE);
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      accessibilityLabel={t('paywall.gate.title')}
      testID="sheet.proGate"
    >
      <ProGateCard
        kicker={t(`paywall.features.${labelOf(params.feature)}`)}
        title={t('paywall.gate.title')}
        body={t('paywall.gate.morningFree')}
        primaryAction={
          paywall
            ? {
                label: t('common.actions.seePro'),
                onPress: () => {
                  onDismiss();
                  openPaywall(params.feature, 'sheet');
                },
              }
            : {
                label: t('paywall.gate.dismiss'),
                onPress: () => {
                  dismissGate(params.feature);
                  onDismiss();
                },
              }
        }
        {...(paywall
          ? {
              dismissAction: {
                label: t('paywall.gate.dismiss'),
                onPress: () => {
                  dismissGate(params.feature);
                  onDismiss();
                },
              },
            }
          : {})}
        testID={`gate.sheet.${params.feature}`}
      />
    </BottomSheet>
  );
}

registerSheet<GateSheetParams>(PRO_GATE_SHEET, (props) => <ProGateSheet {...props} />, {
  analyticsKey: 'pro_gate',
});

/** Opens the gate sheet for a feature (a 402 or a locked control). */
export function openProGate(feature: GateFeature): void {
  track('pro_gate_viewed', { feature, surface: 'sheet', gate: feature, context: 'sheet' });
  sheets.open(PRO_GATE_SHEET, { feature } satisfies GateSheetParams);
}

/** Whether the user has Pro right now (bootstrap entitlement; the server re-checks). */
export function isPro(): boolean {
  return cachedBootstrap()?.entitlement.is_active ?? false;
}

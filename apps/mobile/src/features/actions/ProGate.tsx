/**
 * Contextual Pro gate (M-GL-13 / M-GATE-01 pattern) for the Follow-up, Commitments, Meeting,
 * Post-meeting and advanced-planning surfaces. The card carries a real value sentence (a
 * deterministic count when the server supplies one), never blurred content. "Pro'yu Gör" opens
 * the paywall route once it exists in this build (T-8.22); "Şimdi değil" stores the 7-day
 * dismissal in `user_preferences.dismissed_gates` (own row, column grant) and collapses the card.
 * The server stays authoritative: every Pro route still answers 402 `ENTITLEMENT_REQUIRED`.
 */
import { qk, type Json } from '@da/api-client';
import { ProGateCard, useToast } from '@da/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';

import { getSupabase } from '../../lib/auth/supabase';
import { now } from '../../lib/clock';
import { useSessionContext } from '../../lib/data/session';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';

export type GateFeature =
  'followups' | 'commitments' | 'meeting_prep' | 'advanced_planning' | 'vip';

const GATE_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const PAYWALL = '/paywall';

/** Whether the user dismissed this gate less than 7 days ago. */
export function useGateDismissed(feature: GateFeature): boolean {
  const { data } = useSessionContext();
  const until = (data?.preferences.dismissed_gates as Record<string, unknown> | undefined)?.[
    feature
  ];
  return typeof until === 'string' && Date.parse(until) > now().getTime();
}

/** Opens the paywall for a feature (when the route exists); returns whether it navigated. */
export function useOpenPaywall(): (feature: GateFeature) => void {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations('states.unavailable');
  return (feature) => {
    track('pro_gate_cta_tapped', { feature, trial: false, surface: 'card' });
    if (isScreenAvailable(PAYWALL)) {
      router.push(`${PAYWALL}?source=${feature}` as Href);
      return;
    }
    toast.show({ message: t('featureDisabled') });
  };
}

export interface ProGateProps {
  readonly feature: GateFeature;
  readonly kicker: string;
  readonly title: string;
  readonly body?: string;
  /** Called after "Şimdi değil" (e.g. leave a full-screen gate). */
  readonly onDismissed?: () => void;
  readonly surface?: 'card' | 'screen' | 'inline';
  readonly testID?: string;
}

export function ProGate({
  feature,
  kicker,
  title,
  body,
  onDismissed,
  surface = 'card',
  testID,
}: ProGateProps) {
  const t = useTranslations('states');
  const session = useSessionContext();
  const queryClient = useQueryClient();
  const openPaywall = useOpenPaywall();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    track('pro_gate_viewed', { feature, surface });
  }, [feature, surface]);

  if (hidden) return null;

  const dismiss = () => {
    track('pro_gate_dismissed', { feature });
    setHidden(true);
    onDismissed?.();
    const userId = session.data?.profile.id;
    if (userId === undefined) return;
    const current = (session.data?.preferences.dismissed_gates ?? {}) as Record<string, Json>;
    const next: Record<string, Json> = {
      ...current,
      [feature]: new Date(now().getTime() + GATE_DAYS_MS).toISOString(),
    };
    void (async () => {
      await getSupabase()
        .from('user_preferences')
        .update({ dismissed_gates: next })
        .eq('user_id', userId);
      await queryClient.invalidateQueries({ queryKey: qk.me.bootstrap() });
    })();
  };

  return (
    <ProGateCard
      kicker={kicker}
      title={title}
      {...(body === undefined ? {} : { body })}
      primaryAction={{
        label: t('entitlement.cta'),
        onPress: () => {
          openPaywall(feature);
        },
      }}
      dismissAction={{ label: t('limit.notNow'), onPress: dismiss }}
      testID={testID ?? `m2.proGate.${feature}`}
    />
  );
}

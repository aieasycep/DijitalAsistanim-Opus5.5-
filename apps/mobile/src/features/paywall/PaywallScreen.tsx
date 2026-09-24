/**
 * M-PAY-01 paywall (`/paywall?source=&feature=&mode=change`, modal): an honest upgrade screen in the
 * PRIMARY style — the Free/Pro comparison (AI limit "50/gün" for Free, "Adil kullanım" for Pro),
 * the store packages with their localized `priceString` and the computed annual savings, a trial CTA only when the store reports an eligible free phase, Restore, Terms and
 * Privacy, and a close button from the first frame. A purchase is confirmed only when the `pro`
 * entitlement is active, then `POST /purchases/sync` and `GET /me/entitlements` (server
 * authoritative) are awaited; without RevenueCat keys the screen says so (external credential).
 */
import { qk } from '@da/api-client';
import { entitlementsQueryOptions, useBootstrap } from '@da/api-client/react';
import {
  Button,
  ExternalCredentialRequired,
  IconButton,
  PlanComparisonTable,
  PlanOptionCard,
  SkeletonBlock,
  SuccessState,
  Text,
  useTheme,
} from '@da/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

import { getApiClient } from '../../lib/bootstrap';
import { track } from '../../lib/events';
import {
  PURCHASES_ERROR_CODE,
  getCurrentOffering,
  hasProEntitlement,
  isPurchasesConfigured,
  purchase,
  purchaseErrorCode,
  restore,
  syncPurchases,
  trialDaysFor,
  type PurchasesPackage,
} from '../../lib/purchases';
import { useOnline } from '../../lib/query/online-manager';
import { showToast } from '../../providers/ToastHost';
import { openWebPage } from '../settings/links';
import { annualSavings, ctaVariant, paywallSourceOf, purchaseFailureCode } from './paywallCopy';

type PackageKind = 'annual' | 'monthly';
type PurchaseState = 'idle' | 'purchasing' | 'pending' | 'success' | 'activating';
export const ENTITLEMENT_POLL_MS = 1_000;
export const ENTITLEMENT_POLL_MAX = 10;

function packageOf(
  offering: Awaited<ReturnType<typeof getCurrentOffering>>,
  kind: PackageKind,
): PurchasesPackage | null {
  if (offering === null) return null;
  return kind === 'annual' ? offering.annual : offering.monthly;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function PaywallScreen() {
  const t = useTranslations();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useOnline();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ source?: string; feature?: string; mode?: string }>();
  const source = paywallSourceOf(params.source ?? params.feature);
  const mode = params.mode === 'change' ? 'change' : null;
  const bootstrap = useBootstrap();
  const configured = isPurchasesConfigured();
  const offering = useQuery({
    queryKey: qk.purchases.offerings(),
    queryFn: getCurrentOffering,
    enabled: configured,
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const [selected, setSelected] = useState<PackageKind>('annual');
  const [state, setState] = useState<PurchaseState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const annual = packageOf(offering.data ?? null, 'annual');
  const monthly = packageOf(offering.data ?? null, 'monthly');
  const chosen = selected === 'annual' ? (annual ?? monthly) : (monthly ?? annual);
  const trial = useQuery({
    queryKey: [...qk.purchases.all, 'trial', chosen?.product.identifier ?? ''] as const,
    queryFn: () => (chosen === null ? Promise.resolve(null) : trialDaysFor(chosen)),
    enabled: chosen !== null && mode === null,
    staleTime: 10 * 60_000,
  });
  const trialDays = trial.data ?? null;
  const pro = bootstrap.data?.entitlement.is_active === true;

  useEffect(() => {
    if (pro && mode === null && state === 'idle') router.replace('/settings/subscription');
  }, [pro, mode, state, router]);

  const viewed = offering.isSuccess || !configured;
  useEffect(() => {
    if (viewed) track('paywall_viewed', { source, trial_eligible: trialDays !== null });
    // Once per visit, when the offer is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewed]);

  const close = () => {
    if (state === 'purchasing') return;
    if (state !== 'success') track('paywall_dismissed', { source });
    if (router.canGoBack()) router.back();
    else router.replace('/today');
  };

  const confirmServer = async (): Promise<boolean> => {
    await syncPurchases('purchase').catch(() => undefined);
    for (let attempt = 0; attempt < ENTITLEMENT_POLL_MAX; attempt += 1) {
      try {
        const result = await queryClient.query({
          ...entitlementsQueryOptions(getApiClient()),
          staleTime: 0,
        });
        if (result.entitlement.is_active) {
          void queryClient.invalidateQueries({ queryKey: qk.me.bootstrap() });
          return true;
        }
      } catch {
        // Keep polling within the window.
      }
      await wait(ENTITLEMENT_POLL_MS);
    }
    return false;
  };

  const buy = () => {
    if (chosen === null) return;
    const kind: PackageKind = chosen === annual ? 'annual' : 'monthly';
    const withTrial = trialDays !== null;
    setMessage(null);
    setState('purchasing');
    track('purchase_started', { package: kind, trial: withTrial });
    void purchase(chosen)
      .then(async (info) => {
        if (!hasProEntitlement(info)) {
          setState('idle');
          setMessage(t('paywall.pendingActivation'));
          return;
        }
        track('purchase_completed', { package: kind, trial: withTrial });
        const active = await confirmServer();
        setState(active ? 'success' : 'activating');
      })
      .catch((error: unknown) => {
        const code = purchaseErrorCode(error);
        if (code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
          track('purchase_cancelled', { package: kind });
          setState('idle');
          return;
        }
        if (code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) {
          track('purchase_pending');
          setState('pending');
          setMessage(t('paywall.paymentPending'));
          return;
        }
        track('purchase_failed', { code: purchaseFailureCode(code) });
        setState('idle');
        setMessage(
          code === PURCHASES_ERROR_CODE.PRODUCT_ALREADY_PURCHASED_ERROR
            ? t('paywall.alreadyPurchased')
            : code === PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR
              ? t('paywall.restricted')
              : t('paywall.storeUnreachable'),
        );
      });
  };

  const doRestore = () => {
    track('restore_started');
    setMessage(null);
    void restore()
      .then(async (info) => {
        const found = hasProEntitlement(info);
        track('restore_completed', { found });
        if (!found) {
          showToast({ message: t('subscription.nothingToRestore') });
          return;
        }
        await syncPurchases('restore').catch(() => undefined);
        showToast({ message: t('subscription.restored'), kind: 'success' });
      })
      .catch(() => {
        showToast({ message: t('paywall.storeUnreachable'), kind: 'error' });
      });
  };

  const aiLimit = bootstrap.data?.usage.limits.ai_daily_budget_units?.limit ?? 50;
  const rows = [
    { key: 'mail', label: t('paywall.features.mailAccounts'), free: '1', pro: true },
    { key: 'cal', label: t('paywall.features.calendars'), free: '1', pro: true },
    { key: 'morning', label: t('paywall.features.morningBriefing'), free: true, pro: true },
    { key: 'midday', label: t('paywall.features.middayEvening'), free: false, pro: true },
    { key: 'prep', label: t('paywall.features.meetingPrep'), free: false, pro: true },
    { key: 'follow', label: t('paywall.features.followUps'), free: false, pro: true },
    { key: 'audio', label: t('paywall.features.audioBriefing'), free: false, pro: true },
    { key: 'memory', label: t('paywall.features.memoryVip'), free: false, pro: true },
    { key: 'planning', label: t('paywall.features.planning'), free: false, pro: true },
    { key: 'capture', label: t('paywall.features.capture'), free: false, pro: true },
    ...(Platform.OS === 'android'
      ? [{ key: 'ni', label: t('paywall.features.androidNi'), free: false, pro: true }]
      : []),
    {
      key: 'ai',
      label: t('paywall.features.aiLimit'),
      free: t('paywall.values.perDay', { count: aiLimit }),
      pro: t('paywall.values.fairUse'),
    },
  ].map((row) => ({
    ...row,
    accessibilityLabel: t('paywall.rowA11y', {
      label: row.label,
      free:
        typeof row.free === 'string'
          ? row.free
          : row.free
            ? t('paywall.values.included')
            : t('paywall.values.notIncluded'),
      pro: typeof row.pro === 'string' ? row.pro : t('paywall.values.included'),
    }),
  }));

  const savings =
    annual !== null && monthly !== null ? annualSavings(annual.product, monthly.product) : null;
  const cta = ctaVariant(mode, trialDays);
  const busy = state === 'purchasing';
  const storeName =
    Platform.OS === 'android' ? t('common.providers.googlePlay') : t('common.providers.appStore');
  const price =
    chosen === null
      ? ''
      : chosen === annual
        ? t('paywall.pricePerYear', { price: chosen.product.priceString })
        : t('paywall.pricePerMonth', { price: chosen.product.priceString });

  if (state === 'success' || state === 'activating') {
    return (
      <View
        style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top + 24 }]}
        testID="screen.paywall"
      >
        <SuccessState
          title={t('paywall.successTitle')}
          body={state === 'success' ? t('paywall.successBody') : t('paywall.activating')}
          action={{ label: t('common.actions.continue'), onPress: close }}
          testID="paywall.success"
        />
      </View>
    );
  }

  return (
    <View
      style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}
      testID="screen.paywall"
    >
      <View style={[styles.topBar, { paddingHorizontal: theme.layout.screenX }]}>
        <IconButton
          icon="close"
          accessibilityLabel={t('paywall.close')}
          onPress={close}
          disabled={busy}
          testID="paywall.close"
        />
        {configured ? (
          <Button
            label={t('paywall.restore')}
            variant="text"
            size="sm"
            disabled={busy || !online}
            onPress={doRestore}
            testID="paywall.restore"
          />
        ) : null}
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: theme.layout.screenX, paddingBottom: insets.bottom + 24 },
        ]}
      >
        <Text variant="kicker" tone="brand">
          {t('paywall.kicker')}
        </Text>
        <Text variant="h1" heading>
          {t('paywall.headline')}
        </Text>
        <Text variant="body" tone="secondary">
          {t('paywall.subline')}
        </Text>
        <PlanComparisonTable
          freeLabel={t('common.plans.free')}
          proLabel={t('common.plans.pro')}
          rows={rows}
          testID="paywall.table"
        />

        {!configured ? (
          <ExternalCredentialRequired
            message={t('states.unavailable.credential.purchases')}
            testID="paywall.notConfigured"
          />
        ) : offering.isPending ? (
          <View style={styles.cards} accessibilityLabel={t('common.a11y.loading')}>
            <SkeletonBlock width="100%" height={72} radius={16} />
            <SkeletonBlock width="100%" height={72} radius={16} />
          </View>
        ) : annual === null && monthly === null ? (
          <View style={styles.cards} testID="paywall.empty">
            <Text variant="body" tone="secondary">
              {t('paywall.offeringsUnavailable')}
            </Text>
            <Button
              label={t('common.actions.retry')}
              variant="tonal"
              onPress={() => {
                void offering.refetch();
              }}
              testID="paywall.retry"
            />
          </View>
        ) : (
          <View style={styles.cards} accessibilityRole="radiogroup">
            {annual === null ? null : (
              <PlanOptionCard
                title={t('paywall.periods.annual')}
                badge={t('paywall.bestValue')}
                priceLine={[
                  t('paywall.pricePerYear', { price: annual.product.priceString }),
                  ...(annual.product.pricePerMonthString === null
                    ? []
                    : [
                        t('paywall.monthlyEquivalent', {
                          price: annual.product.pricePerMonthString,
                        }),
                      ]),
                  ...(savings === null ? [] : [t('paywall.savings', { percent: savings })]),
                ].join(' · ')}
                selected={chosen === annual}
                onPress={() => {
                  setSelected('annual');
                  track('paywall_package_selected', { package: 'annual' });
                }}
                testID="paywall.plan.annual"
              />
            )}
            {monthly === null ? null : (
              <PlanOptionCard
                title={t('paywall.periods.monthly')}
                priceLine={t('paywall.pricePerMonth', { price: monthly.product.priceString })}
                selected={chosen === monthly}
                onPress={() => {
                  setSelected('monthly');
                  track('paywall_package_selected', { package: 'monthly' });
                }}
                testID="paywall.plan.monthly"
              />
            )}
          </View>
        )}

        {message === null ? null : (
          <Text
            variant="bodySm"
            tone="warning"
            accessibilityLiveRegion="polite"
            testID="paywall.message"
          >
            {message}
          </Text>
        )}
        {configured && chosen !== null ? (
          <Button
            label={
              cta.kind === 'trial'
                ? t('paywall.trialCta', { days: cta.days })
                : cta.kind === 'change'
                  ? t('paywall.changeCta')
                  : t('paywall.cta')
            }
            fullWidth
            size="lg"
            loading={busy}
            disabled={!online || state === 'pending'}
            onPress={buy}
            testID="paywall.cta"
          />
        ) : null}
        {online ? null : (
          <Text variant="meta" tone="tertiaryStrong" align="center" testID="paywall.offline">
            {t('paywall.offline')}
          </Text>
        )}
        {mode === 'change' ? null : (
          <Button
            label={t('paywall.continueFree')}
            variant="text"
            disabled={busy}
            onPress={close}
            testID="paywall.free"
          />
        )}
        {chosen === null ? null : (
          <Text variant="meta" tone="tertiaryStrong" align="center" testID="paywall.legal">
            {cta.kind === 'trial'
              ? t('paywall.legalTrial', { days: cta.days, price })
              : t('paywall.legalRenew', { price, store: storeName })}
          </Text>
        )}
        <View style={styles.links}>
          <Button
            label={t('paywall.terms')}
            variant="text"
            size="xs"
            onPress={() => {
              void openWebPage('/terms');
            }}
            testID="paywall.terms"
          />
          <Button
            label={t('paywall.privacy')}
            variant="text"
            size="xs"
            onPress={() => {
              void openWebPage('/privacy');
            }}
            testID="paywall.privacy"
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  content: { gap: 14, paddingTop: 8 },
  cards: { gap: 10 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
});

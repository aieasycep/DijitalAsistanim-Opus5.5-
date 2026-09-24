/**
 * M-SET-01 "Profil ve Ayarlar" (`/settings`, the modal root of the settings stack): identity with
 * the real plan line, the Onay Merkezi ink card, and the ASİSTAN / HESAP / UYGULAMA groups whose
 * value column shows the live state (bootstrap, OS notification permission, own-row counts).
 * Every row navigates; a row whose screen belongs to a later task is shown as a static value row
 * instead of a dead control (R-24). "Çıkış Yap" opens M-SET-02.
 */
import { useBootstrap } from '@da/api-client/react';
import {
  Avatar,
  BottomSheet,
  Button,
  ErrorCard,
  IconButton,
  InkCallout,
  ListRow,
  SettingsValueSkeleton,
  StatusPill,
  Text,
  useTheme,
} from '@da/ui';
import type { BootstrapData } from '@da/validation/api/bootstrap';
import * as StoreReview from 'expo-store-review';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { logout } from '../../lib/auth/logout';
import { now } from '../../lib/clock';
import { isScreenAvailable } from '../../lib/deeplinks';
import { appVersion, buildNumber, pushPermission, type PushPermission } from '../../lib/device';
import { track } from '../../lib/events';
import { useUiPrefs } from '../../lib/ui-prefs';
import { isPro, openProGate } from '../pro-gate/ProGate';
import { daysUntil, heroKindOf, latestGrant, periodOf } from '../subscription/state';
import { useSettingsCounts } from './data';
import { usePendingSettings } from './save';
import { SettingsGroup, SettingsPage } from './ui';

type SettingsRow =
  | 'profile'
  | 'approvals'
  | 'briefings'
  | 'notifications'
  | 'priority_rules'
  | 'vip'
  | 'personalization'
  | 'android_notifications'
  | 'subscription'
  | 'accounts'
  | 'privacy'
  | 'referral'
  | 'delete_account'
  | 'appearance'
  | 'language'
  | 'help'
  | 'feedback'
  | 'about'
  | 'sign_out'
  | 'upgrade';

const FROM_VALUES = ['today', 'flow', 'plan', 'assistant', 'deeplink', 'notification'] as const;
type From = (typeof FROM_VALUES)[number];

function fromOf(value: string | undefined): From {
  return FROM_VALUES.find((v) => v === value) ?? 'deeplink';
}

/** "08:00 · 13:00 · 19:00"; disabled slots omitted, Free shows the morning time only. */
export function briefingValue(prefs: BootstrapData['preferences'], pro: boolean): string {
  const slots: string[] = [];
  if (prefs.morning_enabled) slots.push(prefs.morning_time);
  if (pro && prefs.midday_enabled) slots.push(prefs.midday_time);
  if (pro && prefs.evening_enabled) slots.push(prefs.evening_time);
  return slots.join(' · ');
}

export function SignOutSheet({
  visible,
  onDismiss,
}: {
  readonly visible: boolean;
  readonly onDismiss: () => void;
}) {
  const t = useTranslations();
  const pending = usePendingSettings();
  const [busy, setBusy] = useState(false);
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      dismissible={!busy}
      title={t('settings.signOut.title')}
      testID="sheet.signOut"
      footer={
        <View style={styles.sheetButtons}>
          <Button
            label={t('common.actions.signOut')}
            variant="ink"
            fullWidth
            loading={busy}
            onPress={() => {
              setBusy(true);
              void logout({ scope: 'local', context: 'settings' }).finally(() => {
                setBusy(false);
              });
            }}
            testID="signOut.confirm"
          />
          <Button
            label={t('common.actions.nevermind')}
            variant="text"
            fullWidth
            disabled={busy}
            onPress={onDismiss}
            testID="signOut.cancel"
          />
        </View>
      }
    >
      <Text variant="body" tone="secondary">
        {t('settings.signOut.body')}
      </Text>
      {pending ? (
        <Text variant="bodySm" tone="warning" testID="signOut.unsent">
          {t('settings.signOut.unsentSettings')}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

export function HubScreen() {
  const t = useTranslations();
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const bootstrap = useBootstrap();
  const counts = useSettingsCounts();
  const prefs = useUiPrefs();
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const data = bootstrap.data;
  const pro = data?.entitlement.is_active ?? isPro();
  const from = fromOf(params.from);

  useEffect(() => {
    track('settings_opened', { from });
  }, [from]);

  useEffect(() => {
    let alive = true;
    void pushPermission().then((value) => {
      if (alive) setPermission(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  const open = (row: SettingsRow, href: string) => {
    track('settings_row_tapped', { row });
    router.push(href);
  };

  const value = (text: string | undefined) =>
    text === undefined
      ? {
          kind: 'custom' as const,
          node: <SettingsValueSkeleton accessibilityLabel={t('common.a11y.loading')} />,
        }
      : { kind: 'value' as const, text, chevron: true };

  // ── identity line ──────────────────────────────────────────────────────────────────────
  const identity = (() => {
    if (data === undefined) return null;
    const entitlement = data.entitlement;
    switch (heroKindOf(entitlement)) {
      case 'billing_issue':
        return (
          <StatusPill label={t('settings.hub.identity.billingIssue')} tone="warning" size="md" />
        );
      case 'trial':
        return (
          <Text variant="secondary" tone="secondary">
            {t('settings.hub.identity.trial', {
              days: daysUntil(entitlement.store.expires_at, now()),
            })}
          </Text>
        );
      case 'active':
        return (
          <Text variant="secondary" tone="secondary">
            {periodOf(entitlement.store.product_id) === 'monthly'
              ? t('settings.hub.identity.proMonthly')
              : t('settings.hub.identity.proAnnual')}
          </Text>
        );
      case 'grant': {
        const grant = latestGrant(entitlement);
        const date = grant === null ? '' : grant.ends_at.slice(0, 10);
        return (
          <Text variant="secondary" tone="secondary">
            {grant?.source.startsWith('referral') === true
              ? t('settings.hub.identity.proGrant', { date })
              : t('settings.hub.identity.proGrantOther', {
                  source: t(`subscription.grantSources.${grant?.source ?? 'admin'}`),
                  date,
                })}
          </Text>
        );
      }
      case 'free':
        return (
          <View style={styles.freeLine}>
            <Text variant="secondary" tone="secondary">
              {t('settings.hub.identity.free')}
            </Text>
            {isScreenAvailable('/paywall') ? (
              <Button
                label={t('settings.hub.identity.upgrade')}
                variant="text"
                size="xs"
                onPress={() => {
                  open('upgrade', '/paywall?source=hub_upgrade');
                }}
                testID="hub.upgrade"
              />
            ) : null}
          </View>
        );
    }
  })();

  // ── values ─────────────────────────────────────────────────────────────────────────────
  const notificationsValue = (() => {
    if (data === undefined || permission === null) return undefined;
    if (permission === 'denied') return t('settings.hub.rows.notificationsOff');
    return data.notification_preferences.smart_filter
      ? t('settings.hub.rows.notificationsImportantOnly')
      : t('settings.hub.rows.notificationsOn');
  })();
  const accountsValue = (() => {
    if (data === undefined) return undefined;
    const accounts = data.accounts;
    if (accounts.length === 0) return t('settings.hub.rows.connectionsNone');
    if (accounts.some((a) => a.status === 'needs_reauth' || a.status === 'error')) {
      return t('settings.hub.rows.connectionsReconnect');
    }
    if (accounts.some((a) => a.status === 'partial')) {
      return t('settings.hub.rows.connectionsMissingScope');
    }
    return t('settings.hub.rows.connectionsCount', { count: accounts.length });
  })();
  const subscriptionValue = (() => {
    if (data === undefined) return undefined;
    const kind = heroKindOf(data.entitlement);
    if (kind === 'free') return t('settings.hub.rows.planFree');
    if (kind === 'trial') return t('settings.hub.rows.planTrial');
    return t('settings.hub.rows.planPro');
  })();
  const pendingApprovals = data?.counts.pending_approvals ?? 0;
  const approvalsRoute = isScreenAvailable('/approvals');
  const vipOpens = !pro;
  const storeUrl = StoreReview.storeUrl();

  return (
    <SettingsPage
      title={t('settings.hub.title')}
      leading="close"
      onLeadingPress={() => {
        if (router.canGoBack()) router.back();
        else router.replace('/today');
      }}
      refreshing={bootstrap.isRefetching}
      onRefresh={() => {
        void bootstrap.refetch();
        void counts.refetch();
      }}
      testID="screen.settings"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('settings.hub.identityA11y', {
          name: data?.profile.display_name ?? data?.profile.email ?? '',
        })}
        onPress={() => {
          open('profile', '/settings/profile');
        }}
        style={styles.identity}
        testID="hub.identity"
      >
        <Avatar
          name={data?.profile.display_name ?? data?.profile.email ?? t('settings.profile.title')}
          size={60}
          self
          decorative
        />
        <View style={styles.identityText}>
          <Text variant="titleMd" weight={600} numberOfLines={1}>
            {data?.profile.display_name ?? data?.profile.email ?? ''}
          </Text>
          {identity}
        </View>
        <IconButton
          icon="edit"
          variant="plain"
          accessibilityLabel={t('settings.profile.title')}
          onPress={() => {
            open('profile', '/settings/profile');
          }}
        />
      </Pressable>

      {data === undefined && bootstrap.isError ? (
        <ErrorCard
          icon="cloud_off"
          tone="neutral"
          title={t('states.error.refreshFailed')}
          primaryAction={{
            label: t('common.actions.retry'),
            onPress: () => {
              void bootstrap.refetch();
            },
          }}
          testID="hub.error"
        />
      ) : null}

      <InkCallout
        icon="task_alt"
        title={t('settings.hub.approvalCard.title')}
        subtitle={
          pendingApprovals === 0
            ? t('settings.hub.approvalCard.none')
            : t('settings.hub.approvalCard.pending', { count: pendingApprovals })
        }
        {...(approvalsRoute
          ? {
              onPress: () => {
                open('approvals', '/approvals');
              },
            }
          : {})}
        testID="hub.approvals"
      />

      <SettingsGroup title={t('settings.hub.groups.assistant')}>
        <ListRow
          icon="wb_twilight"
          title={t('settings.hub.rows.briefings')}
          trailing={value(data === undefined ? undefined : briefingValue(data.preferences, pro))}
          onPress={() => {
            open('briefings', '/settings/briefings');
          }}
          testID="hub.row.briefings"
        />
        <ListRow
          icon="notifications"
          title={t('settings.hub.rows.notifications')}
          trailing={value(notificationsValue)}
          onPress={() => {
            open('notifications', '/settings/notifications');
          }}
          testID="hub.row.notifications"
        />
        <ListRow
          icon="tune"
          title={t('settings.hub.rows.priorityRules')}
          trailing={value(
            counts.data === undefined
              ? undefined
              : t('common.units.rules', { count: counts.data.rules }),
          )}
          onPress={() => {
            open('priority_rules', '/settings/priority-rules');
          }}
          testID="hub.row.rules"
        />
        {vipOpens ? (
          <ListRow
            icon="star"
            title={t('settings.hub.rows.vip')}
            trailing={{ kind: 'value', text: t('common.badges.pro'), chevron: true }}
            onPress={() => {
              track('settings_row_tapped', { row: 'vip' });
              openProGate('vip');
            }}
            accessibilityLabel={t('settings.hub.lockedA11y', { title: t('settings.hub.rows.vip') })}
            testID="hub.row.vip"
          />
        ) : (
          <ListRow
            icon="star"
            title={t('settings.hub.rows.vip')}
            trailing={
              counts.data === undefined
                ? value(undefined)
                : { kind: 'value', text: t('common.units.people', { count: counts.data.vip }) }
            }
            testID="hub.row.vip"
          />
        )}
        <ListRow
          icon="psychology"
          title={t('settings.hub.rows.personalization')}
          trailing={value(
            data === undefined || counts.data === undefined
              ? undefined
              : data.preferences.learn_from_interactions
                ? t('settings.hub.rows.personalizationCount', { count: counts.data.learned })
                : t('settings.hub.rows.learningOff'),
          )}
          onPress={() => {
            open('personalization', '/settings/personalization');
          }}
          testID="hub.row.personalization"
        />
        {Platform.OS === 'android' ? (
          <ListRow
            icon="notifications_active"
            title={t('settings.hub.rows.phoneNotifications')}
            trailing={pro ? { kind: 'chevron' } : { kind: 'value', text: t('common.badges.pro') }}
            onPress={() => {
              track('settings_row_tapped', { row: 'android_notifications' });
              if (pro) router.push('/settings/android-notifications');
              else openProGate('android_ni');
            }}
            testID="hub.row.androidNi"
          />
        ) : null}
      </SettingsGroup>

      <SettingsGroup title={t('settings.hub.groups.account')}>
        <ListRow
          icon="workspace_premium"
          title={t('settings.hub.rows.subscription')}
          trailing={value(subscriptionValue)}
          onPress={() => {
            open('subscription', '/settings/subscription');
          }}
          testID="hub.row.subscription"
        />
        <ListRow
          icon="link"
          title={t('settings.hub.rows.connections')}
          trailing={value(accountsValue)}
          onPress={() => {
            open('accounts', '/settings/accounts');
          }}
          testID="hub.row.accounts"
        />
        <ListRow
          icon="shield"
          title={t('settings.hub.rows.privacy')}
          trailing={{ kind: 'chevron' }}
          onPress={() => {
            open('privacy', '/settings/privacy');
          }}
          testID="hub.row.privacy"
        />
        <ListRow
          icon="person_add"
          title={t('settings.hub.rows.referral')}
          trailing={{
            kind: 'value',
            text: t('settings.hub.rows.referralMeta', {
              days: data?.config.referral_reward_days ?? 14,
            }),
            chevron: true,
          }}
          onPress={() => {
            open('referral', '/settings/referral');
          }}
          testID="hub.row.referral"
        />
        <ListRow
          icon="person_remove"
          title={t('settings.hub.rows.deleteAccount')}
          destructive
          accessibilityLabel={t('settings.hub.dangerA11y', {
            title: t('settings.hub.rows.deleteAccount'),
          })}
          onPress={() => {
            open('delete_account', '/settings/privacy/delete-account');
          }}
          testID="hub.row.deleteAccount"
        />
      </SettingsGroup>

      <SettingsGroup title={t('settings.hub.groups.app')}>
        <ListRow
          icon="contrast"
          title={t('settings.hub.rows.appearance')}
          trailing={value(t(`settings.appearance.${prefs.theme}`))}
          onPress={() => {
            open('appearance', '/settings/appearance');
          }}
          testID="hub.row.appearance"
        />
        <ListRow
          icon="language"
          title={t('settings.hub.rows.language')}
          trailing={value(
            data === undefined
              ? undefined
              : data.locale === 'en-US'
                ? t('settings.language.english')
                : t('settings.language.turkish'),
          )}
          onPress={() => {
            open('language', '/settings/language');
          }}
          testID="hub.row.language"
        />
        <ListRow
          icon="help"
          title={t('settings.hub.rows.help')}
          trailing={{ kind: 'chevron' }}
          onPress={() => {
            open('help', '/settings/help');
          }}
          testID="hub.row.help"
        />
        <ListRow
          icon="rate_review"
          title={t('settings.hub.rows.feedback')}
          trailing={{ kind: 'chevron' }}
          onPress={() => {
            open('feedback', '/settings/feedback');
          }}
          testID="hub.row.feedback"
        />
        <ListRow
          icon="info"
          title={t('settings.hub.rows.about')}
          trailing={{ kind: 'chevron' }}
          onPress={() => {
            open('about', '/settings/about');
          }}
          testID="hub.row.about"
        />
      </SettingsGroup>

      <SettingsGroup>
        <ListRow
          icon="logout"
          title={t('settings.hub.signOut')}
          destructive
          onPress={() => {
            track('settings_row_tapped', { row: 'sign_out' });
            setSignOutOpen(true);
          }}
          testID="hub.signOut"
        />
      </SettingsGroup>

      <View style={styles.footer}>
        <Text
          variant="meta"
          tone="tertiaryStrong"
          align="center"
          accessibilityLabel={t('settings.about.versionA11y', {
            version: appVersion(),
            build: buildNumber(),
          })}
        >
          {t('settings.hub.version', { version: appVersion(), build: buildNumber() })}
        </Text>
        {storeUrl === null ? null : (
          <Button
            label={t('settings.about.releaseNotes')}
            variant="text"
            size="xs"
            onPress={() => {
              void Linking.openURL(storeUrl);
            }}
            testID="hub.releaseNotes"
          />
        )}
      </View>
      <View style={{ height: theme.space[2] }} />
      <SignOutSheet
        visible={signOutOpen}
        onDismiss={() => {
          setSignOutOpen(false);
        }}
      />
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
  identityText: { flex: 1, gap: 4 },
  freeLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footer: { alignItems: 'center', gap: 4, marginTop: 12 },
  sheetButtons: { gap: 8 },
});

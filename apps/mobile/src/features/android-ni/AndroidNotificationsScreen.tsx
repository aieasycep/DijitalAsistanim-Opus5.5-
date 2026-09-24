/**
 * M-ANI-01 "Telefon bildirimleri" (`/settings/android-notifications`, Android only; iOS redirects
 * to the hub, F-04 / REQ-ANDNI-06). Explicit opt-in behind the M-ANI-02 prominent disclosure, the
 * live system grant (re-checked on focus, foreground and `onGrantChanged`), the analysis switch,
 * "Seçili uygulamalar" / "Tüm uygulamalar", category presets and manual picks (M-ANI-03), the
 * locked denylist (M-ANI-04), the recent extracted signals with single and "Tümünü sil" deletes,
 * the R-15 assurance copy and the system-access handoff. Every change is mirrored to the server
 * through `POST /devices/register {android_ni}` (API-DEV-01). Pro only (M-GATE-02 `android_ni`).
 */
import {
  AssuranceBox,
  Button,
  ConfirmDialog,
  EmptyState,
  EntitlementGate,
  ErrorCard,
  ExternalCredentialRequired,
  IconButton,
  ListRow,
  PermissionCard,
  SkeletonBlock,
  StatusPill,
  Text,
} from '@da/ui';
import { Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { useFormatter, useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { track } from '../../lib/events';
import { showToast } from '../../providers/ToastHost';
import { ContextualGate, isPro, openProGate } from '../pro-gate/ProGate';
import { SettingsGroup, SettingsPage } from '../settings/ui';
import {
  acceptDisclosure,
  applyChoice,
  disclosureAcceptedAt,
  readChoice,
  recordReturn,
  returnsWithoutGrant,
  type NiChoice,
} from './choice';
import {
  countLast24h,
  deleteAllSignals,
  deleteSignal,
  SIGNAL_LIST_LIMIT,
  useAniSignals,
  type AniSignalRow,
} from './data';
import { reportAniState, syncBackgroundUpload } from './lifecycle';
import { niCall } from './native';
import { NiCategoryRows } from './NiChoiceList';
import type { NiPresetKey } from './presets';
import { AppPickerSheet, DenylistSheet, DisclosureSheet } from './sheets';
import { openedState, useAniStatus, type AniStatus } from './status';
import { flushAniSignals } from './upload';

type Sheet = 'disclosure' | 'picker' | 'denylist' | 'deleteAll' | null;

export function AndroidNotificationsScreen() {
  if (Platform.OS !== 'android') return <Redirect href="/settings" />;
  return <AndroidNotificationsSettings />;
}

/** Opens the system notification-access screen; false when no settings intent resolved. */
function openSystemAccess(): boolean {
  return niCall(false, (ni) => ni.openSettings());
}

function AndroidNotificationsSettings() {
  const t = useTranslations();
  const { status, refresh } = useAniStatus();
  const [choice, setChoice] = useState<NiChoice>(readChoice);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [returns, setReturns] = useState(returnsWithoutGrant);
  const awaitingGrant = useRef(false);
  const opened = useRef(false);
  const signals = useAniSignals(status !== null && status.kind !== 'unsupported');

  // `android_ni_opened` once the first status is known.
  useEffect(() => {
    if (status === null || opened.current) return;
    opened.current = true;
    const state = openedState(status.kind);
    if (state !== null) track('android_ni_opened', { state });
  }, [status]);

  // Back from the system screen: record the result; a fresh grant switches the analysis on.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !awaitingGrant.current) return;
      awaitingGrant.current = false;
      const granted = niCall(false, (ni) => ni.isGranted());
      track('android_ni_granted', { granted });
      setReturns(recordReturn(granted));
      if (granted && isPro()) {
        applyChoice(choice);
        niCall(undefined, (ni) => {
          ni.setEnabled(true);
        });
        track('android_ni_enabled', { enabled: true });
        showToast({ message: t('android_ni.screen.grantedToast'), kind: 'success' });
        void syncBackgroundUpload(true);
      }
      refresh();
      void reportAniState();
    });
    return () => {
      sub.remove();
    };
  }, [choice, refresh, t]);

  const update = (next: NiChoice) => {
    setChoice(next);
    applyChoice(next);
    void reportAniState();
    refresh();
  };

  const openAccess = () => {
    if (status?.kind === 'not_entitled' || status?.kind === 'lapsed') {
      openProGate('android_ni');
      return;
    }
    if (disclosureAcceptedAt() === null) {
      track('android_ni_disclosure_viewed');
      setSheet('disclosure');
      return;
    }
    track('android_ni_access_opened');
    awaitingGrant.current = true;
    if (!openSystemAccess()) {
      awaitingGrant.current = false;
      showToast({ message: t('android_ni.screen.settingsFailed'), kind: 'error' });
    }
  };

  const setEnabled = (enabled: boolean) => {
    if (status === null) return;
    if (status.kind === 'not_entitled' || status.kind === 'lapsed') {
      openProGate('android_ni');
      return;
    }
    if (!status.granted) return;
    if (enabled) applyChoice(choice);
    niCall(undefined, (ni) => {
      ni.setEnabled(enabled);
    });
    track('android_ni_enabled', { enabled });
    refresh();
    void syncBackgroundUpload(enabled);
    void reportAniState();
    if (enabled) void flushAniSignals();
  };

  if (status === null) {
    return (
      <SettingsPage
        title={t('android_ni.screen.title')}
        subtitle={t('android_ni.screen.subtitle')}
        testID="screen.settings.androidNi"
      >
        <View accessibilityLabel={t('android_ni.screen.statusLoading')} testID="ani.loading">
          <SkeletonBlock height={72} radius={18} />
        </View>
      </SettingsPage>
    );
  }

  if (status.kind === 'unsupported' || status.kind === 'feature_off') {
    return (
      <SettingsPage
        title={t('android_ni.screen.title')}
        subtitle={t('android_ni.screen.subtitle')}
        testID="screen.settings.androidNi"
      >
        {status.kind === 'unsupported' ? (
          <ErrorCard
            icon="notifications_off"
            tone="neutral"
            title={t('android_ni.screen.unsupported')}
            testID="ani.unsupported"
          />
        ) : (
          <ExternalCredentialRequired
            reason="disabled"
            message={t('states.unavailable.featureDisabled')}
            testID="ani.featureOff"
          />
        )}
      </SettingsPage>
    );
  }

  const entitled = status.kind !== 'not_entitled' && status.kind !== 'lapsed';
  const rows = signals.data?.rows ?? [];

  return (
    <SettingsPage
      title={t('android_ni.screen.title')}
      subtitle={t('android_ni.screen.subtitle')}
      testID="screen.settings.androidNi"
      refreshing={signals.isRefetching}
      onRefresh={() => {
        refresh();
        void signals.refetch();
      }}
    >
      <StatusCard status={status} count={countLast24h(rows, now())} onOpenAccess={openAccess} />

      {status.kind === 'not_entitled' ? (
        <ContextualGate feature="android_ni" body={t('android_ni.pro')} testID="ani.gate" />
      ) : null}

      {entitled && status.granted ? (
        <SettingsGroup testID="ani.toggleGroup">
          <ListRow
            title={t('android_ni.screen.toggle')}
            trailing={{ kind: 'switch', value: status.enabled }}
            onPress={() => {
              setEnabled(!status.enabled);
            }}
            testID="ani.toggle"
          />
        </SettingsGroup>
      ) : null}

      {entitled ? (
        <>
          <SettingsGroup title={t('android_ni.screen.modeSection')} testID="ani.mode">
            <ListRow
              title={t('android_ni.modes.selected')}
              trailing={{ kind: 'radio', selected: choice.mode === 'selected' }}
              onPress={() => {
                if (choice.mode === 'selected') return;
                track('android_ni_mode_changed', { mode: 'selected' });
                update({ ...choice, mode: 'selected' });
              }}
              testID="ani.mode.selected"
            />
            <ListRow
              title={t('android_ni.modes.all')}
              subtitle={t('android_ni.screen.modeAllMeta')}
              trailing={{ kind: 'radio', selected: choice.mode === 'all' }}
              onPress={() => {
                if (choice.mode === 'all') return;
                track('android_ni_mode_changed', { mode: 'all' });
                update({ ...choice, mode: 'all' });
              }}
              testID="ani.mode.all"
            />
          </SettingsGroup>

          {choice.mode === 'selected' ? (
            <SettingsGroup title={t('android_ni.screen.categoriesSection')} testID="ani.categories">
              <NiCategoryRows
                categories={choice.categories}
                onToggle={(key: NiPresetKey, value: boolean) => {
                  update({ ...choice, categories: { ...choice.categories, [key]: value } });
                }}
                testID="ani"
              />
              <ListRow
                icon="apps"
                title={t('android_ni.screen.pickApps')}
                subtitle={t('android_ni.screen.pickAppsMeta', { count: choice.manual.length })}
                trailing={{ kind: 'chevron' }}
                onPress={() => {
                  setSheet('picker');
                }}
                testID="ani.pickApps"
              />
            </SettingsGroup>
          ) : null}
        </>
      ) : null}

      <SettingsGroup testID="ani.lockedGroup">
        <ListRow
          icon="lock"
          title={t('android_ni.screen.lockedRow')}
          accessibilityLabel={t('android_ni.screen.lockedA11y')}
          trailing={{ kind: 'chevron' }}
          onPress={() => {
            track('android_ni_denylist_viewed');
            setSheet('denylist');
          }}
          testID="ani.locked"
        />
      </SettingsGroup>

      <SignalList
        rows={rows}
        loading={signals.isPending}
        partial={signals.data?.partial === true}
        onDeleteAll={() => {
          setSheet('deleteAll');
        }}
      />

      <AssuranceBox
        rows={[{ key: 'device', icon: 'phonelink', text: t('privacy.storage.androidNi') }]}
        testID="ani.assurance"
      />

      {returns >= 2 && !status.granted ? (
        <Text variant="secondary" tone="secondary" testID="ani.restrictedHelp">
          {t('android_ni.screen.restrictedHelp')}
        </Text>
      ) : null}

      {status.granted ? (
        <Button
          label={t('android_ni.screen.removeAccess')}
          variant="text"
          fullWidth
          onPress={() => {
            track('android_ni_access_opened');
            if (!openSystemAccess()) {
              showToast({ message: t('android_ni.screen.settingsFailed'), kind: 'error' });
            }
          }}
          testID="ani.removeAccess"
        />
      ) : null}

      <DisclosureSheet
        visible={sheet === 'disclosure'}
        categories={choice.categories}
        onToggle={(key, value) => {
          update({ ...choice, categories: { ...choice.categories, [key]: value } });
        }}
        onAccept={() => {
          acceptDisclosure(now());
          track('android_ni_disclosure_accepted');
          setSheet(null);
          applyChoice(choice);
          track('android_ni_access_opened');
          awaitingGrant.current = true;
          if (!openSystemAccess()) {
            awaitingGrant.current = false;
            showToast({ message: t('android_ni.screen.settingsFailed'), kind: 'error' });
          }
        }}
        onDismiss={() => {
          setSheet(null);
        }}
      />
      <AppPickerSheet
        visible={sheet === 'picker'}
        categories={choice.categories}
        manual={choice.manual}
        onApply={(manual) => {
          setSheet(null);
          update({ ...choice, manual });
        }}
        onDismiss={() => {
          setSheet(null);
        }}
      />
      <DenylistSheet
        visible={sheet === 'denylist'}
        onDismiss={() => {
          setSheet(null);
        }}
      />
      <ConfirmDialog
        visible={sheet === 'deleteAll'}
        icon="delete"
        title={t('android_ni.screen.deleteAllTitle')}
        body={t('android_ni.screen.deleteAllBody')}
        confirm={{
          label: t('common.actions.delete'),
          onPress: () => {
            setSheet(null);
            track('android_ni_signals_deleted', { scope: 'all' });
            void deleteAllSignals(now()).then(() => {
              showToast({ message: t('android_ni.deleteAllDone'), kind: 'success' });
            });
          },
        }}
        cancel={{
          label: t('common.actions.nevermind'),
          onPress: () => {
            setSheet(null);
          },
        }}
        testID="ani.deleteAllDialog"
      />
    </SettingsPage>
  );
}

function StatusCard({
  status,
  count,
  onOpenAccess,
}: {
  readonly status: AniStatus;
  readonly count: number;
  readonly onOpenAccess: () => void;
}) {
  const t = useTranslations();
  switch (status.kind) {
    case 'lapsed':
      return (
        <EntitlementGate
          variant="lapse"
          kicker={t('paywall.features.androidNi')}
          title={t('android_ni.screen.lapsedTitle')}
          body={t('android_ni.screen.lapsedBody')}
          primaryAction={{
            label: t('common.actions.seePro'),
            onPress: () => {
              openProGate('android_ni');
            },
          }}
          testID="ani.status.lapsed"
        />
      );
    case 'not_granted':
    case 'not_entitled':
      return (
        <PermissionCard
          icon="notifications_off"
          title={t('android_ni.screen.notGrantedTitle')}
          body={t('android_ni.screen.notGrantedBody')}
          primaryAction={{ label: t('android_ni.grantCta'), onPress: onOpenAccess }}
          announceOnMount={false}
          testID="ani.status.notGranted"
        />
      );
    default: {
      const enabled = status.kind === 'enabled';
      const title = enabled
        ? t('android_ni.screen.enabledTitle', { count })
        : t('android_ni.screen.pausedTitle');
      return (
        <View accessibilityLiveRegion="polite" testID={`ani.status.${status.kind}`}>
          <SettingsGroup>
            <ListRow
              icon="notifications_active"
              title={title}
              trailing={{
                kind: 'custom',
                node: (
                  <StatusPill
                    label={enabled ? t('android_ni.status.on') : t('android_ni.status.off')}
                    tone={enabled ? 'success' : 'neutral'}
                  />
                ),
              }}
              accessibilityLabel={title}
            />
          </SettingsGroup>
        </View>
      );
    }
  }
}

function SignalList({
  rows,
  loading,
  partial,
  onDeleteAll,
}: {
  readonly rows: readonly AniSignalRow[];
  readonly loading: boolean;
  readonly partial: boolean;
  readonly onDeleteAll: () => void;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const shown = rows.slice(0, SIGNAL_LIST_LIMIT);

  const detailOf = (row: AniSignalRow): string => {
    const parts: string[] = [];
    if (row.trackingStatus !== null) parts.push(t(`android_ni.tracking.${row.trackingStatus}`));
    if (row.flightNo !== null) parts.push(row.flightNo);
    if (row.gate !== null) parts.push(t('android_ni.detail.gate', { gate: row.gate }));
    if (row.amount !== null) {
      const value = Number(row.amount.value);
      if (Number.isFinite(value)) {
        parts.push(format.number(value, { style: 'currency', currency: row.amount.currency }));
      }
    }
    if (row.dueDate !== null) {
      parts.push(
        t('android_ni.detail.due', {
          date: format.dateTime(new Date(`${row.dueDate}T12:00:00Z`), {
            day: 'numeric',
            month: 'short',
          }),
        }),
      );
    }
    const posted = new Date(row.postedAt);
    const today = now().toDateString() === posted.toDateString();
    parts.push(
      today
        ? format.dateTime(posted, { hour: '2-digit', minute: '2-digit' })
        : format.dateTime(posted, { day: 'numeric', month: 'short' }),
    );
    return parts.join(' · ');
  };

  return (
    <View style={styles.signals}>
      <SettingsGroup title={t('android_ni.screen.signalsSection')} testID="ani.signals">
        {loading ? (
          <ListRow title={t('android_ni.screen.statusLoading')} testID="ani.signals.loading" />
        ) : shown.length === 0 ? (
          <EmptyState
            icon="notifications"
            title={t('android_ni.screen.signalsEmpty')}
            testID="ani.signals.empty"
          />
        ) : (
          shown.map((row) => {
            const title = t('android_ni.screen.signalTitle', {
              app: row.appLabel,
              category: t(`android_ni.category.${row.category}`),
            });
            return (
              <ListRow
                key={row.hash}
                title={title}
                subtitle={detailOf(row)}
                trailing={{
                  kind: 'custom',
                  node: (
                    <IconButton
                      icon="delete"
                      variant="plain"
                      accessibilityLabel={t('android_ni.screen.deleteSignalA11y', {
                        app: row.appLabel,
                      })}
                      onPress={() => {
                        track('android_ni_signals_deleted', { scope: 'one' });
                        void deleteSignal(row.hash).then(() => {
                          showToast({
                            message: t('android_ni.screen.signalDeleted'),
                            kind: 'success',
                          });
                        });
                      }}
                      testID={`ani.signal.delete.${row.hash}`}
                    />
                  ),
                }}
                testID={`ani.signal.${row.hash}`}
              />
            );
          })
        )}
      </SettingsGroup>
      {partial ? (
        <Text variant="secondary" tone="tertiaryStrong" testID="ani.signals.partial">
          {t('android_ni.screen.signalsPartial')}
        </Text>
      ) : null}
      {shown.length > 0 ? (
        <Button
          label={t('android_ni.deleteAll')}
          variant="ghost"
          onPress={onDeleteAll}
          testID="ani.deleteAll"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  signals: { gap: 8 },
});

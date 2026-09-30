/**
 * Disconnect with honest consequences (M-SET-13; also the M-ON-06A removal during onboarding):
 * `POST /integrations/:accountId/disconnect {confirm, purge_content}`. Google access is revoked by
 * the server; Microsoft access cannot be revoked per app (`local_only`), so the toast offers the
 * manual page; `revoke_failed` offers Google's connections page. Purging needs a recent sign-in
 * (`401 REAUTH_REQUIRED`, R-16); the inline error then says so and the user may keep the
 * analyses until retention instead.
 */
import { isApiError, qk } from '@da/api-client';
import type { Provider } from '@da/domain/enums';
import { BottomSheet, Button, InlineErrorCard, ListRow, Text } from '@da/ui';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { getApiClient } from '../../../lib/bootstrap';
import { track } from '../../../lib/events';
import { cachedBootstrap } from '../../../lib/postgrest';
import { useOnline } from '../../../lib/query/online-manager';
import { registerSheet, type SheetRenderProps } from '../../../providers/SheetHost';
import { showToast } from '../../../providers/ToastHost';
import { openSystemSettings } from '../device-calendar';
import { providerNameKey } from '../status';

export const DISCONNECT_SHEET = 'integration_disconnect';
const GOOGLE_CONNECTIONS_URL = 'https://myaccount.google.com/connections';

export interface DisconnectParams {
  readonly accountId: string;
  readonly provider: Provider;
  readonly mail: boolean;
  readonly context: 'onboarding' | 'settings';
}

function revocationEvent(value: string): 'revoked' | 'manual_required' | 'failed' {
  if (value === 'provider_revoked') return 'revoked';
  if (value === 'local_only') return 'manual_required';
  return 'failed';
}

function DisconnectSheet({
  params,
  visible,
  onDismiss,
  onHidden,
}: SheetRenderProps<DisconnectParams>) {
  const t = useTranslations('settings.accounts.disconnect');
  const common = useTranslations('common');
  const retention = useTranslations('privacy.retention.options');
  const errors = useTranslations('errors');
  const offline = useTranslations('states.offline');
  const online = useOnline();
  const queryClient = useQueryClient();
  const device = params.provider === 'apple_device' || params.provider === 'android_device';
  const [purge, setPurge] = useState(!device);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const service = common(
    `providers.${providerNameKey(params.provider, params.mail ? 'mail' : 'calendar')}`,
  );
  const identity =
    params.provider === 'microsoft' ? common('providers.microsoft') : common('providers.google');
  const policy = cachedBootstrap()?.preferences.retention_policy ?? 'd90';

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await getApiClient().call('POST /integrations/:accountId/disconnect', {
        params: { accountId: params.accountId },
        body: { confirm: true, purge_content: purge },
      });
      const { revocation, manual_revoke_url: manualUrl } = response.data;
      track('integration_disconnect_confirmed', {
        provider: params.provider,
        context: params.context,
      });
      track('account_disconnected', {
        provider: params.provider,
        purge_content: purge,
        revocation: device ? 'not_applicable' : revocationEvent(revocation),
        purge_derived: purge,
      });
      void queryClient.invalidateQueries({ queryKey: qk.integrations.all });
      void queryClient.invalidateQueries({ queryKey: qk.me.bootstrap() });
      void queryClient.invalidateQueries({ queryKey: qk.today.all });
      onDismiss();
      if (revocation === 'local_only' && manualUrl !== null) {
        showToast({
          message: t('done', { service }),
          action: {
            label: t('removeAtMicrosoft'),
            onPress: () => {
              void Linking.openURL(manualUrl);
            },
          },
        });
      } else if (revocation === 'revoke_failed' && !device) {
        showToast({
          message: t('revokeFailed'),
          kind: 'error',
          action: {
            label: t('removeAtGoogle'),
            onPress: () => {
              void Linking.openURL(GOOGLE_CONNECTIONS_URL);
            },
          },
        });
      } else {
        showToast({ message: t('done', { service }), kind: 'success' });
      }
      if (params.context === 'settings' && router.canGoBack()) router.back();
    } catch (caught) {
      if (isApiError(caught) && caught.code === 'REAUTH_REQUIRED')
        setError(errors('reauth_required'));
      else setError(t('failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      variant="destructive"
      title={t('title', { service })}
      subtitle={
        device
          ? t('bodyDevice')
          : params.mail
            ? t('body', { provider: identity, service })
            : t('bodyCalendar', { provider: identity, service })
      }
      dismissible={!busy}
      testID="sheet.disconnect"
      footer={
        <View style={styles.footer}>
          {error === null ? null : (
            <InlineErrorCard icon="error" tone="critical" title={error} testID="disconnect.error" />
          )}
          <Button
            label={t('confirm')}
            variant="destructive"
            fullWidth
            loading={busy}
            disabled={!online}
            onPress={() => {
              void confirm();
            }}
            testID="disconnect.confirm"
          />
          <Button
            label={common('actions.nevermind')}
            variant="text"
            fullWidth
            onPress={onDismiss}
            testID="disconnect.cancel"
          />
        </View>
      }
    >
      <View style={styles.body}>
        {device ? (
          <ListRow
            title={common('actions.openSettings')}
            icon="settings"
            trailing={{ kind: 'chevron' }}
            onPress={openSystemSettings}
          />
        ) : (
          <ListRow
            title={t('purgeNow')}
            {...(purge ? {} : { subtitle: t('purgeLater', { retention: retention(policy) }) })}
            trailing={{ kind: 'check', checked: purge }}
            onPress={() => {
              setPurge((value) => !value);
            }}
            accessibilityLabel={t('purgeNow')}
            testID="disconnect.purge"
          />
        )}
        {params.provider === 'microsoft' ? (
          <Text variant="secondary" tone="secondary">
            {t('microsoftNote')}
          </Text>
        ) : null}
        {!online ? (
          <Text variant="secondary" tone="tertiaryStrong">
            {offline('blockedReason')}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}

registerSheet<DisconnectParams>(DISCONNECT_SHEET, (props) => <DisconnectSheet {...props} />);

const styles = StyleSheet.create({ footer: { gap: 8 }, body: { gap: 12 } });

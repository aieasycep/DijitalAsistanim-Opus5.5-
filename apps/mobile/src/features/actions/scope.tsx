/**
 * M-REPLY-02 · progressive write-scope upgrade (ADR-07, API-INT-02, R-07), generic for
 * `mail_send | calendar_write | tasks_write`. "İzin Ver" → `POST /integrations/:accountId/upgrade`
 * (device-bound nonce hash) → the provider consent in an auth session → the callback's completion
 * code is finished with `POST /integrations/oauth/complete {completion_code, device_nonce}` → on
 * success the pending continuation (submit / approve with the same key) resumes exactly once.
 * Denied or partial grants never approve anything; the draft or approval stays as it is.
 */
import { qk } from '@da/api-client';
import { apiMutationOptions, callRoute, useApiClient } from '@da/api-client/react';
import { parseOAuthCallback } from '@da/domain';
import { BottomSheet, Button, HintRow, Text, useToast } from '@da/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

import { getClientEnv } from '../../lib/env';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { base64Url } from '../../lib/storage';
import { registerSheet, sheets, type SheetRenderProps } from '../../providers/SheetHost';
import { mountSheet } from './mount';

export type WriteCapability = 'mail_send' | 'calendar_write' | 'tasks_write';

export interface ScopeParams {
  readonly accountId: string;
  readonly provider: 'google' | 'microsoft';
  readonly capability: WriteCapability;
  readonly approvalId?: string;
  /** The approve / submit call to resume after a successful grant (called once). */
  readonly onGranted: () => void;
}

type Outcome = 'granted' | 'denied' | 'cancelled' | 'error' | 'admin';

function queryOf(url: string): Record<string, string> {
  const q = url.indexOf('?');
  const out: Record<string, string> = {};
  if (q === -1) return out;
  for (const pair of url
    .slice(q + 1)
    .split('#')[0]
    ?.split('&') ?? []) {
    const [key, value = ''] = pair.split('=');
    if (key !== undefined && key !== '') out[decodeURIComponent(key)] = decodeURIComponent(value);
  }
  return out;
}

function ScopeSheet({ params, visible, onDismiss, onHidden }: SheetRenderProps<ScopeParams>) {
  const t = useTranslations('reply.scope');
  const toast = useToast();
  const client = useApiClient();
  const online = useOnline();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<'idle' | 'browser' | 'verifying'>('idle');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const upgrade = useMutation(apiMutationOptions(client, 'POST /integrations/:accountId/upgrade'));
  const service = params.provider === 'google' ? t('google') : t('microsoft');
  const app = params.provider === 'google' ? t('gmail') : t('outlook');

  const finish = (result: Outcome) => {
    track('scope_upgrade_result', {
      capability: params.capability,
      result:
        result === 'granted'
          ? 'granted'
          : result === 'cancelled'
            ? 'cancelled'
            : result === 'error'
              ? 'error'
              : 'denied',
    });
    if (params.capability === 'mail_send') {
      track('send_scope_upgrade_result', {
        result:
          result === 'granted'
            ? 'granted'
            : result === 'cancelled'
              ? 'cancelled'
              : result === 'error'
                ? 'error'
                : 'denied',
      });
    }
    setPhase('idle');
    if (result === 'granted') {
      void queryClient.invalidateQueries({ queryKey: qk.me.bootstrap() });
      onDismiss();
      params.onGranted();
      return;
    }
    if (result === 'cancelled') {
      onDismiss();
      return;
    }
    setOutcome(result);
  };

  const start = async () => {
    if (params.capability === 'mail_send') {
      track('send_scope_upgrade_start', { provider: params.provider });
    }
    setOutcome(null);
    setPhase('browser');
    try {
      const nonce = base64Url(Crypto.getRandomBytes(32));
      const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
      const started = await upgrade.mutateAsync({
        input: {
          params: { accountId: params.accountId },
          body: {
            capability: params.capability,
            ...(params.approvalId === undefined
              ? {}
              : { resume: { approval_id: params.approvalId } }),
            device_nonce_hash: hash,
          },
        },
      });
      if (started.already_granted) {
        finish('granted');
        return;
      }
      const redirect = `${getClientEnv().EXPO_PUBLIC_APP_SCHEME}://integrations/callback`;
      const session = await WebBrowser.openAuthSessionAsync(started.auth_url, redirect);
      if (session.type !== 'success') {
        finish('cancelled');
        return;
      }
      const callback = parseOAuthCallback(queryOf(session.url));
      if (callback?.result === 'admin_consent_required') {
        finish('admin');
        return;
      }
      if (callback?.result !== 'pending_confirmation' || callback.completionCode === null) {
        finish(callback?.result === 'denied' ? 'denied' : 'error');
        return;
      }
      setPhase('verifying');
      const completed = await callRoute(client, 'POST /integrations/oauth/complete', {
        body: { completion_code: callback.completionCode, device_nonce: nonce },
      });
      finish(
        completed.result === 'success' && completed.granted.includes(params.capability)
          ? 'granted'
          : 'denied',
      );
    } catch {
      toast.show({ message: t('failed'), kind: 'error' });
      finish('error');
    }
  };

  const busy = phase !== 'idle';
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      title={t(`${params.capability}.title`)}
      dismissible={!busy}
      footer={
        <View style={{ gap: 8 }}>
          <Button
            label={t('allow')}
            onPress={() => {
              void start();
            }}
            loading={busy}
            loadingLabel={phase === 'verifying' ? t('verifying') : t('waiting')}
            disabled={!online}
            fullWidth
            accessibilityHint={t('hint', { service })}
            testID="m2.scope.allow"
          />
          <Button label={t('later')} variant="text" onPress={onDismiss} fullWidth />
        </View>
      }
      testID="m2.scope"
    >
      <Text variant="secondary" tone="secondary">
        {t(`${params.capability}.body`, { service, app })}
      </Text>
      {online ? null : <HintRow text={t('offline')} />}
      {outcome === null ? null : (
        <Text variant="bodyXs" tone="critical" accessibilityRole="alert" testID="m2.scope.outcome">
          {outcome === 'admin' ? t('adminConsent') : t(`denied.${params.capability}`)}
        </Text>
      )}
    </BottomSheet>
  );
}

registerSheet('m2.scope', mountSheet(ScopeSheet), { analyticsKey: 'account' });

export function openScopeUpgrade(params: ScopeParams): void {
  track('scope_upgrade_view', { capability: params.capability, provider: params.provider });
  sheets.open('m2.scope', params);
}

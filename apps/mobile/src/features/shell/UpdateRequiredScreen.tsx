/**
 * M-GL-12 Update required (`app/update-required.tsx`, full-screen modal, no back gesture). Reached
 * from the entry resolver (`bootstrap.config.upgrade_required`) or any `426
 * CLIENT_UPGRADE_REQUIRED`. Intentionally blocking: the only action opens the store listing —
 * Google Play by this build's package name on Android; on iOS the App Store id is not a client
 * setting yet (bootstrap `store_urls` is a proposed addition), so the web support page opens, as the
 * spec's fallback prescribes.
 */
import { qk } from '@da/api-client';
import { ErrorState, useBackHandler } from '@da/ui';
import type { BootstrapData } from '@da/validation/api/bootstrap';
import { useQueryClient } from '@tanstack/react-query';
import * as Application from 'expo-application';
import * as WebBrowser from 'expo-web-browser';
import { useEffect } from 'react';
import { Linking, Platform } from 'react-native';
import { useTranslations } from 'use-intl';

import { appVersion } from '../../lib/device';
import { webPage } from '../../lib/env';
import { track } from '../../lib/events';

/** `1.2.3` → 10203 (analytics ints). */
export function versionNumber(version: string): number {
  const [major = 0, minor = 0, patch = 0] = version
    .split('.')
    .map((p) => Number.parseInt(p, 10))
    .map((n) => (Number.isFinite(n) ? Math.min(Math.max(n, 0), 99) : 0));
  return major * 10_000 + minor * 100 + patch;
}

export function storeUrl(os: string = Platform.OS): string | null {
  if (os === 'android' && Application.applicationId !== null) {
    return `https://play.google.com/store/apps/details?id=${Application.applicationId}`;
  }
  return null;
}

export async function openStore(): Promise<void> {
  const url = storeUrl();
  if (url !== null) {
    try {
      await Linking.openURL(url);
      return;
    } catch {
      // Fall through to the support page.
    }
  }
  await WebBrowser.openBrowserAsync(webPage('/support'));
}

export function UpdateRequiredScreen() {
  const t = useTranslations('states.error.updateRequired');
  const queryClient = useQueryClient();
  const bootstrap = queryClient.getQueryData<BootstrapData>(qk.me.bootstrap());
  const min =
    bootstrap?.config.min_supported_version[Platform.OS === 'android' ? 'android' : 'ios'];

  useBackHandler(true, () => true);
  useEffect(() => {
    track('update_required_shown', {
      current: versionNumber(appVersion()),
      ...(min === undefined ? {} : { min: versionNumber(min) }),
    });
  }, [min]);

  return (
    <ErrorState
      icon="system_update"
      title={t('title')}
      body={t('body')}
      retryAction={{
        label: t('cta'),
        onPress: () => {
          void openStore();
        },
      }}
      testID="update-required"
    />
  );
}

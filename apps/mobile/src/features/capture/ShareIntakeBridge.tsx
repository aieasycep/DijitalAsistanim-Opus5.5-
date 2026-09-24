/**
 * M-CAP-04 share intake (`expo-share-intent`: the iOS share extension "Dijital Asistan'a Ekle" and
 * Android ACTION_SEND / SEND_MULTIPLE): the payload is staged into the app cache and validated
 * (`modules/da-share` — ≤5 items, image ≤15 MB, PDF ≤20 MB, text ≤20,000 characters), stored as
 * the capture draft with `share_origin` (`ios_share` / `android_send`), and the native intent is
 * reset. Then the same capture flow opens (`/capture?entry=share`): signed-in users go straight
 * there (Free users see the Pro gate with the payload kept); signed-out users resume it after
 * sign-in through the pending link. Analysis still needs an explicit "Analiz Et".
 */
import { useShareIntent, type ShareIntent } from 'expo-share-intent';
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import {
  clampSharedText,
  clearStagedShare,
  stageSharedFiles,
} from '../../../modules/da-share/src/stage';
import { LOGOUT_HOOKS, registerLogoutCleanup } from '../../lib/auth/logout';
import { savePendingLink } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { clearDraft, setDraft, type DraftFile } from './draft';

export const SHARE_ROUTE = '/capture?entry=share';

registerLogoutCleanup(LOGOUT_HOOKS.shareStaging, async () => {
  clearDraft();
  await clearStagedShare().catch(() => undefined);
});

/** Bit mask of the payload kinds (`share_intake.kinds_mask`): text 1, url 2, image 4, pdf 8. */
export function kindsMask(intent: ShareIntent): number {
  let mask = 0;
  if ((intent.text ?? '') !== '') mask |= 1;
  if ((intent.webUrl ?? '') !== '') mask |= 2;
  for (const file of intent.files ?? []) {
    if (file.mimeType.startsWith('image/')) mask |= 4;
    else if (file.mimeType === 'application/pdf') mask |= 8;
  }
  return mask;
}

/** Stages a share into the capture draft; returns false when nothing usable arrived. */
export async function intakeShare(intent: ShareIntent): Promise<boolean> {
  const inputs = (intent.files ?? []).map((file) => ({
    path: file.path,
    mimeType: file.mimeType,
    fileName: file.fileName,
    size: file.size,
  }));
  const staged = await stageSharedFiles(inputs);
  const text = clampSharedText(intent.text);
  const url = intent.webUrl ?? '';
  const files: DraftFile[] = staged.files.map((file) => ({
    uri: file.uri,
    mime: file.mime,
    name: file.name,
    size: file.size,
    kind: file.kind === 'pdf' ? 'pdf' : 'photo',
  }));
  track('share_intake', {
    item_count: inputs.length + (text === '' ? 0 : 1) + (url === '' ? 0 : 1),
    kinds_mask: kindsMask(intent),
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  if (files.length === 0 && text === '' && url === '') return false;
  setDraft({
    text: url !== '' && text === url ? '' : text,
    url,
    files,
    shareOrigin: Platform.OS === 'ios' ? 'ios_share' : 'android_send',
    linkCaptureId: null,
    shareNotice: staged.truncated
      ? 'truncated'
      : staged.rejected.some((r) => r.reason === 'too_large')
        ? 'too_large'
        : staged.rejected.length > 0
          ? 'unsupported'
          : null,
  });
  return true;
}

export function ShareIntakeBridge({ signedIn }: { readonly signedIn: boolean }) {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({
    resetOnBackground: false,
  });
  const handling = useRef(false);

  useEffect(() => {
    if (!hasShareIntent || handling.current) return;
    handling.current = true;
    void intakeShare(shareIntent)
      .then((usable) => {
        resetShareIntent();
        if (!usable) {
          if (signedIn) router.push('/capture?entry=share&unsupported=1');
          return;
        }
        track('capture_start', { kind: 'share', entry: 'share' });
        if (signedIn) router.push(SHARE_ROUTE);
        else savePendingLink(SHARE_ROUTE);
      })
      .finally(() => {
        handling.current = false;
      });
  }, [hasShareIntent, shareIntent, resetShareIntent, signedIn]);

  return null;
}

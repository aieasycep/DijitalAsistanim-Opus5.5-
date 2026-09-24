/**
 * M-ON-06S sign-out confirm (sheet(host) `sign_out_confirm`): the deliberate way out of the
 * post-auth flow from the first step's back circle. "Çıkış Yap" runs the full logout (device
 * unregister, cache wipe, local sign-out; works offline) and the auth change routes to sign-in.
 */
import { ConfirmDialog } from '@da/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

import { logout } from '../../lib/auth/logout';
import { registerSheet, type SheetRenderProps } from '../../providers/SheetHost';
import { resetOnboardingState } from './store';

export const SIGN_OUT_CONFIRM_SHEET = 'sign_out_confirm';

function SignOutConfirm({ visible, onDismiss, onHidden }: SheetRenderProps<undefined>) {
  const t = useTranslations('onboarding.signOut');
  const actions = useTranslations('common.actions');
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmDialog
      visible={visible}
      icon="logout"
      title={t('title')}
      body={t('body')}
      confirm={{
        label: actions('signOut'),
        loading: busy,
        onPress: () => {
          setBusy(true);
          void logout({ context: 'onboarding' }).finally(() => {
            setBusy(false);
            resetOnboardingState();
            onDismiss();
            onHidden();
            router.replace('/sign-in?mode=signin');
          });
        },
      }}
      cancel={{
        label: actions('nevermind'),
        onPress: () => {
          onDismiss();
          onHidden();
        },
      }}
      testID="sheet.signOutConfirm"
    />
  );
}

registerSheet<undefined>(SIGN_OUT_CONFIRM_SHEET, (props) => <SignOutConfirm {...props} />);

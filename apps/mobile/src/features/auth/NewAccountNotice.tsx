/**
 * M-ON-05N new-account notice (sheet(host) `new_account_notice`): shown after a sign-in-mode login
 * that created a brand-new profile, so a returning user who picked another method (e.g. an Apple
 * private-relay address) does not silently start over. "Devam Et" continues into onboarding;
 * "Farklı yöntemle dene" signs out locally (works offline) and returns to sign-in.
 */
import { BottomSheet, Button } from '@da/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { getSupabase } from '../../lib/auth/supabase';
import { track } from '../../lib/events';
import { registerSheet, type SheetRenderProps } from '../../providers/SheetHost';

export const NEW_ACCOUNT_NOTICE_SHEET = 'new_account_notice';

function NewAccountNotice({ visible, onDismiss, onHidden }: SheetRenderProps<undefined>) {
  const t = useTranslations('auth.newAccount');
  const [switching, setSwitching] = useState(false);
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      title={t('title')}
      subtitle={t('body')}
      dismissible={!switching}
      testID="sheet.newAccountNotice"
      footer={
        <View style={styles.footer}>
          <Button
            label={t('cta')}
            fullWidth
            disabled={switching}
            onPress={() => {
              track('auth_new_account_notice', { choice: 'continue' });
              onDismiss();
              router.replace('/');
            }}
            testID="newAccount.continue"
          />
          <Button
            label={t('other')}
            variant="text"
            fullWidth
            loading={switching}
            onPress={() => {
              track('auth_new_account_notice', { choice: 'switch' });
              setSwitching(true);
              void getSupabase()
                .auth.signOut({ scope: 'local' })
                .finally(() => {
                  setSwitching(false);
                  onDismiss();
                  router.replace('/sign-in?mode=signin');
                });
            }}
            testID="newAccount.switch"
          />
        </View>
      }
    />
  );
}

registerSheet<undefined>(NEW_ACCOUNT_NOTICE_SHEET, (props) => <NewAccountNotice {...props} />);

const styles = StyleSheet.create({ footer: { gap: 8 } });

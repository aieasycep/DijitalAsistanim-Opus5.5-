/**
 * M-ON-06M admin consent required (sheet(host) `admin_consent`): a work tenant blocks the app until
 * an IT admin consents. The consent URL from the callback (`admin_consent_url`) is handed over
 * with the OS share sheet; without a URL the sheet explains the situation and closes.
 */
import { BottomSheet, Button, ErrorCard } from '@da/ui';
import { Share, StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../../lib/events';
import { registerSheet, type SheetRenderProps } from '../../../providers/SheetHost';

export const ADMIN_CONSENT_SHEET = 'admin_consent';

export interface AdminConsentParams {
  readonly url: string | null;
}

function AdminConsentSheet({
  params,
  visible,
  onDismiss,
  onHidden,
}: SheetRenderProps<AdminConsentParams>) {
  const t = useTranslations('onboarding.adminConsent');
  const actions = useTranslations('common.actions');
  const url = params.url;
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      accessibilityLabel={t('title')}
      testID="sheet.adminConsent"
      footer={
        <View style={styles.footer}>
          {url === null ? null : (
            <Button
              label={t('cta')}
              fullWidth
              onPress={() => {
                track('integration_admin_consent_shared');
                void Share.share({ message: url }).catch(() => undefined);
              }}
              testID="adminConsent.share"
            />
          )}
          <Button label={actions('close')} variant="text" fullWidth onPress={onDismiss} />
        </View>
      }
    >
      <ErrorCard
        icon="admin_panel_settings"
        tone="warning"
        title={t('title')}
        body={t('body')}
        testID="adminConsent.card"
      />
    </BottomSheet>
  );
}

registerSheet<AdminConsentParams>(ADMIN_CONSENT_SHEET, (props) => <AdminConsentSheet {...props} />);

const styles = StyleSheet.create({ footer: { gap: 8 } });

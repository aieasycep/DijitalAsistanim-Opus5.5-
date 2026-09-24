/**
 * M-ON-11A add a VIP by e-mail (sheet(host) `vip_add`): no device Contacts permission (SREQ-37).
 * RPC-23 `upsert_manual_contact(p_email, p_display_name)` returns the owner's existing or new
 * contact; the person then appears selected on the VIP step.
 */
import { BottomSheet, Button, TextField } from '@da/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { rpc } from '../../lib/postgrest';
import { registerSheet, type SheetRenderProps } from '../../providers/SheetHost';

export const VIP_ADD_SHEET = 'vip_add';

export interface ManualVip {
  readonly contactId: string;
  readonly email: string;
  readonly name: string | null;
}

export interface VipAddParams {
  readonly existing: readonly string[];
  readonly onAdded: (vip: ManualVip) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function VipAddSheet({ params, visible, onDismiss, onHidden }: SheetRenderProps<VipAddParams>) {
  const t = useTranslations('onboarding.vip.add');
  const common = useTranslations('common');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const normalized = email.trim().toLowerCase();
  const valid = EMAIL_RE.test(normalized);

  const add = async () => {
    if (!valid) {
      setError(t('invalid'));
      return;
    }
    if (params.existing.map((e) => e.toLowerCase()).includes(normalized)) {
      setError(t('duplicate'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const displayName = name.trim();
      const contactId = await rpc('upsert_manual_contact', {
        p_email: normalized,
        ...(displayName === '' ? {} : { p_display_name: displayName }),
      });
      track('vip_manual_added');
      params.onAdded({
        contactId,
        email: normalized,
        name: displayName === '' ? null : displayName,
      });
      onDismiss();
    } catch {
      setError(common('toast.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      title={t('title')}
      dismissible={!busy}
      testID="sheet.vipAdd"
      footer={
        <Button
          label={t('cta')}
          fullWidth
          loading={busy}
          disabled={!valid}
          onPress={() => {
            void add();
          }}
          testID="vipAdd.submit"
        />
      }
    >
      <View style={styles.fields}>
        <TextField
          label={t('emailHint')}
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            setError(null);
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          {...(error === null ? {} : { error })}
          testID="vipAdd.email"
        />
        <TextField label={t('nameHint')} value={name} onChangeText={setName} testID="vipAdd.name" />
      </View>
    </BottomSheet>
  );
}

registerSheet<VipAddParams>(VIP_ADD_SHEET, (props) => <VipAddSheet {...props} />);

const styles = StyleSheet.create({ fields: { gap: 12 } });

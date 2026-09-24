/**
 * M-VIP-02 Kişi Ekle (contact picker: recent correspondents or a new address through RPC-23, never
 * the device contacts) and M-VIP-03 VIP Ayarı (relationship group, "Her zaman bildir" and the
 * per-VIP quiet-hours bypass "Sessiz saatlerde bile", R-13 — effective only with the global
 * `notification_preferences.vip_bypass_quiet` and Pro; removable with undo).
 */
import { VIP_RELATIONSHIP_VALUES, type VipRelationship } from '@da/domain';
import {
  Avatar,
  BottomSheet,
  Button,
  ChipWrap,
  ChoiceChip,
  GroupedList,
  ListRow,
  ProGateCard,
  SearchField,
  Text,
  TextAction,
  TextField,
  useTheme,
} from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { qk } from '@da/api-client';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { cachedBootstrap } from '../../lib/postgrest';
import { useOnline } from '../../lib/query/online-manager';
import { showToast } from '../../providers/ToastHost';
import { ListSkeleton } from '../common/ListSkeleton';
import { isPro, openProGate } from '../pro-gate/ProGate';
import {
  fetchContacts,
  isEmail,
  isVipLimit,
  removeVip,
  saveVip,
  upsertManualContact,
  type ContactRow,
  type VipSettings,
} from './data';

export interface VipTarget {
  readonly contactId: string;
  readonly name: string;
  /** The existing VIP row (edit mode). */
  readonly vipId: string | null;
  readonly settings?: VipSettings;
  readonly origin?: 'user' | 'suggestion';
}

export function VipEditSheet({
  target,
  onClose,
  onRemoved,
}: {
  readonly target: VipTarget | null;
  readonly onClose: () => void;
  readonly onRemoved?: (target: VipTarget) => void;
}) {
  const t = useTranslations('person.vipEdit');
  const rel = useTranslations('person.relationships');
  const common = useTranslations('common');
  const router = useRouter();
  const online = useOnline();
  const [settings, setSettings] = useState<VipSettings>(
    target?.settings ?? { relationship: 'other', alwaysNotify: true, bypassQuietHours: true },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'failed' | 'limit' | null>(null);
  const [key, setKey] = useState(target?.contactId);
  if (target?.contactId !== key) {
    setKey(target?.contactId);
    setSettings(
      target?.settings ?? { relationship: 'other', alwaysNotify: true, bypassQuietHours: true },
    );
    setError(null);
  }
  const globalBypass = cachedBootstrap()?.notification_preferences.vip_bypass_quiet ?? true;
  const pro = isPro();

  const save = async () => {
    if (target === null) return;
    setSaving(true);
    setError(null);
    const queued = !online;
    try {
      const pending = saveVip(target.contactId, settings, target.origin ?? 'user', target.vipId);
      if (queued) {
        showToast({ message: t('queued'), kind: 'offline' });
        onClose();
        void pending.catch(() => undefined);
        return;
      }
      await pending;
      if (target.vipId === null) {
        track('vip_added', { origin: target.origin === 'suggestion' ? 'suggestion' : 'manual' });
      } else {
        const before = target.settings;
        if (before?.relationship !== settings.relationship)
          track('vip_updated', { field: 'relationship' });
        if (before?.alwaysNotify !== settings.alwaysNotify)
          track('vip_updated', { field: 'always_notify' });
        if (before?.bypassQuietHours !== settings.bypassQuietHours) {
          track('vip_updated', { field: 'bypass_quiet_hours' });
        }
      }
      showToast({ message: common('toast.saved'), kind: 'success' });
      onClose();
    } catch (failure) {
      if (isVipLimit(failure)) setError('limit');
      else setError('failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    const vipId = target?.vipId ?? null;
    if (target === null || vipId === null) return;
    onClose();
    void removeVip(vipId, target.contactId)
      .then(() => {
        track('vip_removed');
        onRemoved?.(target);
      })
      .catch(() => {
        showToast({ message: common('toast.saveFailed'), kind: 'error' });
      });
  };

  return (
    <BottomSheet
      visible={target !== null}
      onDismiss={onClose}
      title={target?.name ?? ''}
      subtitle={t('subtitle')}
      testID="sheet.vipEdit"
      footer={
        <View style={styles.footer}>
          <Button
            label={common('actions.save')}
            onPress={() => {
              void save();
            }}
            loading={saving}
            fullWidth
            testID="vipEdit.save"
          />
          {target?.vipId !== null && target !== null ? (
            <Button
              label={t('remove')}
              icon="person_remove"
              variant="destructive"
              onPress={remove}
              fullWidth
              testID="vipEdit.remove"
            />
          ) : null}
        </View>
      }
    >
      <View style={styles.body}>
        <Text variant="kicker" tone="tertiaryStrong">
          {t('relationship')}
        </Text>
        <ChipWrap>
          {VIP_RELATIONSHIP_VALUES.map((value: VipRelationship) => (
            <ChoiceChip
              key={value}
              label={rel(value)}
              selected={settings.relationship === value}
              accessibilityRole="radio"
              onPress={() => {
                setSettings({ ...settings, relationship: value });
              }}
              testID={`vipEdit.rel.${value}`}
            />
          ))}
        </ChipWrap>
        <ListRow
          title={t('alwaysNotify')}
          subtitle={t('alwaysNotifyMeta')}
          trailing={{ kind: 'switch', value: settings.alwaysNotify }}
          density="twoLineTrailing"
          onPress={() => {
            setSettings({ ...settings, alwaysNotify: !settings.alwaysNotify });
          }}
          testID="vipEdit.alwaysNotify"
        />
        <ListRow
          title={t('bypassQuiet')}
          subtitle={globalBypass ? t('bypassQuietMeta') : t('bypassQuietOff')}
          trailing={{ kind: 'switch', value: settings.bypassQuietHours && globalBypass }}
          density="twoLineTrailing"
          disabled={!globalBypass}
          {...(globalBypass ? {} : { disabledReason: t('bypassQuietOff') })}
          onPress={() => {
            setSettings({ ...settings, bypassQuietHours: !settings.bypassQuietHours });
          }}
          testID="vipEdit.bypassQuiet"
        />
        {!globalBypass && isScreenAvailable('/settings/notifications') ? (
          <TextAction
            label={t('openNotificationSettings')}
            compact
            onPress={() => {
              onClose();
              router.push('/settings/notifications');
            }}
          />
        ) : null}
        {!pro ? (
          <Text variant="meta" tone="tertiaryStrong" testID="vipEdit.proHint">
            {t('proHint')}
          </Text>
        ) : null}
        {error === 'failed' ? (
          <Text variant="bodyXs" tone="critical" accessibilityRole="alert">
            {common('toast.saveFailed')}
          </Text>
        ) : null}
        {error === 'limit' ? (
          <ProGateCard
            kicker={t('limitKicker')}
            title={t('limitTitle')}
            body={t('limitBody')}
            primaryAction={{
              label: common('actions.seePro'),
              onPress: () => {
                onClose();
                openProGate('vip');
              },
            }}
            testID="vipEdit.limit"
          />
        ) : null}
      </View>
    </BottomSheet>
  );
}

export function ContactPickerSheet({
  visible,
  excluded,
  onClose,
  onPick,
}: {
  readonly visible: boolean;
  readonly excluded: readonly string[];
  readonly onClose: () => void;
  readonly onPick: (contact: ContactRow) => void;
}) {
  const t = useTranslations('person.picker');
  const common = useTranslations('common');
  const theme = useTheme();
  const online = useOnline();
  const [term, setTerm] = useState('');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const contacts = useQuery({
    queryKey: qk.vip.picker(term.trim()),
    queryFn: () => fetchContacts(term),
    enabled: visible,
  });
  const rows = (contacts.data ?? []).filter((c) => !excluded.includes(c.id));
  const email = term.trim();
  const manual =
    isEmail(email) && !rows.some((c) => c.email?.toLowerCase() === email.toLowerCase());

  const addManual = async () => {
    if (!isEmail(email)) {
      setInvalid(true);
      return;
    }
    if (!online) {
      showToast({ message: common('toast.saveFailed'), kind: 'offline' });
      return;
    }
    setAdding(true);
    try {
      const id = await upsertManualContact(email, name);
      track('vip_picker_manual_email_used');
      onPick({
        id,
        name: name.trim() === '' ? (email.split('@')[0] ?? email) : name.trim(),
        email,
        organization: null,
      });
    } catch {
      showToast({ message: common('toast.saveFailed'), kind: 'error' });
    } finally {
      setAdding(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onClose}
      title={t('title')}
      testID="sheet.contactPicker"
    >
      <View style={styles.body}>
        <SearchField
          value={term}
          onChangeText={(value) => {
            setTerm(value);
            setInvalid(false);
          }}
          placeholder={t('hint')}
          accessibilityLabel={t('hint')}
          clearLabel={common('actions.remove')}
          testID="picker.search"
        />
        {manual ? (
          <View style={[styles.manual, { borderColor: theme.color.surfaceTrack }]}>
            <ListRow
              title={t('addEmail', { email })}
              icon="person_add"
              onPress={() => {
                void addManual();
              }}
              testID="picker.manual"
            />
            <TextField
              label={t('nameOptional')}
              value={name}
              onChangeText={setName}
              testID="picker.manualName"
            />
            {adding ? <Text variant="meta">{common('a11y.loading')}</Text> : null}
          </View>
        ) : null}
        {invalid ? (
          <Text variant="bodyXs" tone="critical" accessibilityRole="alert">
            {t('invalidEmail')}
          </Text>
        ) : null}
        {contacts.isPending ? (
          <ListSkeleton rows={4} accessibilityLabel={common('a11y.loading')} />
        ) : rows.length === 0 && !manual ? (
          <View style={styles.body} testID="picker.empty">
            <Text variant="h3">{term.trim() === '' ? t('emptyTitle') : t('noMatch')}</Text>
            <Text variant="secondary">{t('emptyBody')}</Text>
          </View>
        ) : (
          <>
            {term.trim() === '' ? (
              <Text variant="kicker" tone="tertiaryStrong">
                {t('recent')}
              </Text>
            ) : null}
            <GroupedList>
              {rows.slice(0, term.trim() === '' ? 10 : 30).map((contact) => (
                <ListRow
                  key={contact.id}
                  title={contact.name}
                  {...(contact.email === null ? {} : { subtitle: contact.email })}
                  trailing={{
                    kind: 'custom',
                    node: <Avatar name={contact.name} id={contact.id} size={38} decorative />,
                  }}
                  onPress={() => {
                    onPick(contact);
                  }}
                  testID={`picker.contact.${contact.id}`}
                />
              ))}
            </GroupedList>
          </>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 10 },
  footer: { gap: 8 },
  manual: { gap: 8, borderWidth: 1, borderRadius: 16, padding: 8 },
});

/**
 * M-REPLY-03 "Alıcılar" (recipient editor sheet): To and Cc chips with remove, an address field
 * with inline validation ("Geçerli bir e-posta adresi yaz.") and contact suggestions from mail
 * history only (PostgREST `contacts`, never device contacts; SREQ-37). "Kaydet" hands the lists
 * back to the reply screen, which sends `PATCH /reply-drafts/:id {to, cc, expected_version}` and
 * refreshes the Gönderim özeti; at least one To recipient is required. Nothing is sent from here.
 */
import { BottomSheet, Button, ChipWrap, ListRow, Text, TextField, TokenChip } from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { registerSheet, sheets, type SheetRenderProps } from '../../providers/SheetHost';
import { mountSheet } from '../actions/mount';
import { fetchContacts, isEmail } from '../person/data';

export const RECIPIENTS_SHEET = 'reply.recipients';

export interface RecipientValue {
  readonly email: string;
  readonly name?: string;
}

export interface RecipientsSheetParams {
  readonly to: readonly RecipientValue[];
  readonly cc: readonly RecipientValue[];
  /** Resolves when the PATCH finished; `false` keeps the sheet open (the screen shows why). */
  readonly onSave: (lists: {
    readonly to: readonly RecipientValue[];
    readonly cc: readonly RecipientValue[];
  }) => Promise<boolean>;
}

type Field = 'to' | 'cc';

function same(a: RecipientValue, b: RecipientValue): boolean {
  return a.email.trim().toLowerCase() === b.email.trim().toLowerCase();
}

function RecipientsSheet({
  params,
  visible,
  onDismiss,
  onHidden,
}: SheetRenderProps<RecipientsSheetParams>) {
  const t = useTranslations('reply.recipients');
  const common = useTranslations('common');
  const [lists, setLists] = useState<Record<Field, readonly RecipientValue[]>>({
    to: params.to,
    cc: params.cc,
  });
  const [field, setField] = useState<Field>('to');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const term = input.trim();
  const suggestions = useQuery({
    queryKey: ['contacts', 'recipient-suggestions', term],
    queryFn: () => fetchContacts(term),
    enabled: visible && term.length >= 2,
    staleTime: 60_000,
  });

  const add = (value: RecipientValue) => {
    if (!isEmail(value.email)) {
      setError(t('invalid'));
      return;
    }
    const email = value.email.trim();
    setLists((current) => {
      if ([...current.to, ...current.cc].some((r) => same(r, value))) return current;
      return {
        ...current,
        [field]: [...current[field], { email, ...(value.name ? { name: value.name } : {}) }],
      };
    });
    setInput('');
    setError(null);
  };

  const remove = (list: Field, value: RecipientValue) => {
    setLists((current) => ({ ...current, [list]: current[list].filter((r) => !same(r, value)) }));
  };

  const save = async () => {
    if (lists.to.length === 0) {
      setError(t('toRequired'));
      return;
    }
    const removed = [...params.to, ...params.cc].filter(
      (r) => ![...lists.to, ...lists.cc].some((n) => same(n, r)),
    ).length;
    const added = [...lists.to, ...lists.cc].filter(
      (r) => ![...params.to, ...params.cc].some((o) => same(o, r)),
    ).length;
    setSaving(true);
    const ok = await params.onSave(lists).catch(() => false);
    setSaving(false);
    if (!ok) return;
    track('reply_recipients_edit', { added, removed, reply_all: lists.cc.length > 0 });
    onDismiss();
  };

  const chips = (list: Field) => (
    <ChipWrap>
      {lists[list].map((r) => (
        <TokenChip
          key={r.email}
          label={r.name ?? r.email}
          onRemove={() => {
            remove(list, r);
          }}
          removeLabel={t('removeA11y', { name: r.name ?? r.email })}
          testID={`recipients.${list}.${r.email}`}
        />
      ))}
    </ChipWrap>
  );

  const matches = (suggestions.data ?? [])
    .filter((c) => c.email !== null)
    .filter((c) => ![...lists.to, ...lists.cc].some((r) => same(r, { email: c.email ?? '' })))
    .slice(0, 8);

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      title={t('title')}
      dismissible={!saving}
      footer={
        <View style={styles.buttons}>
          <Button
            label={common('actions.save')}
            onPress={() => {
              void save();
            }}
            loading={saving}
            disabled={lists.to.length === 0}
            flex
            testID="recipients.save"
          />
          <Button
            label={common('actions.nevermind')}
            variant="neutralTonal"
            onPress={onDismiss}
            disabled={saving}
            testID="recipients.cancel"
          />
        </View>
      }
      testID="sheet.recipients"
    >
      <View style={styles.body}>
        <Text variant="labelSm" tone="secondary" heading>
          {t('to')}
        </Text>
        {chips('to')}
        <Text variant="labelSm" tone="secondary" heading>
          {t('cc')}
        </Text>
        {chips('cc')}
        <View style={styles.buttons}>
          <Button
            label={t('addTo')}
            variant={field === 'to' ? 'tonal' : 'neutralTonal'}
            size="sm"
            onPress={() => {
              setField('to');
            }}
            accessibilityState={{ selected: field === 'to' }}
            testID="recipients.field.to"
          />
          <Button
            label={t('addCc')}
            variant={field === 'cc' ? 'tonal' : 'neutralTonal'}
            size="sm"
            onPress={() => {
              setField('cc');
            }}
            accessibilityState={{ selected: field === 'cc' }}
            testID="recipients.field.cc"
          />
        </View>
        <TextField
          value={input}
          onChangeText={(text) => {
            setInput(text);
            if (error !== null) setError(null);
          }}
          label={t('address')}
          placeholder={t('addressHint')}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => {
            add({ email: input });
          }}
          {...(error === null ? {} : { error })}
          testID="recipients.input"
        />
        {term !== '' ? (
          <ListRow
            icon="person_add"
            title={t('addAddress', { email: term })}
            onPress={() => {
              add({ email: input });
            }}
            testID="recipients.add"
          />
        ) : null}
        {matches.map((c) => (
          <ListRow
            key={c.id}
            icon="person"
            title={c.name}
            subtitle={c.email ?? ''}
            onPress={() => {
              add({ email: c.email ?? '', name: c.name });
            }}
            testID={`recipients.suggestion.${c.id}`}
          />
        ))}
        {term.length >= 2 && suggestions.isSuccess && matches.length === 0 ? (
          <Text variant="meta" tone="tertiaryStrong">
            {t('noSuggestions')}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}

registerSheet(RECIPIENTS_SHEET, mountSheet(RecipientsSheet));

export function openRecipientsSheet(params: RecipientsSheetParams): void {
  sheets.open(RECIPIENTS_SHEET, params);
}

const styles = StyleSheet.create({
  body: { gap: 10 },
  buttons: { flexDirection: 'row', gap: 8 },
});

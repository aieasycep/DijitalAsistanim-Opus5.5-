/**
 * M-SET-71 "Destek ile iletişime geç" (sheet on Help, `?contact=<ticket_category>`): creates a real
 * `support_tickets` row through `POST /support/tickets` [IK]. The draft (with the Idempotency-Key
 * created when the sheet first opens) is kept in encrypted MMKV until a 201 arrives, so a retry can
 * never create a duplicate ticket. Submission is blocked offline; success shows only after 201.
 */
import { qk, isApiError } from '@da/api-client';
import { supportTicketMutationOptions } from '@da/api-client/react';
import type { TicketCategory } from '@da/domain';
import {
  BottomSheet,
  Button,
  CaptureTextField,
  ChoiceChip,
  ListRow,
  SuccessState,
  Text,
  TextField,
} from '@da/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { getApiClient } from '../../lib/bootstrap';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { encryptedStorage, isEncryptedStorageOpen } from '../../lib/storage';
import { showToast } from '../../providers/ToastHost';
import { maskEmail } from './links';

export const TICKET_CATEGORIES: readonly TicketCategory[] = [
  'account',
  'integration',
  'sync',
  'billing',
  'ai_quality',
  'notification',
  'privacy',
  'other',
];
export const MESSAGE_MIN = 20;
export const MESSAGE_MAX = 2000;
const DRAFT_KEY = 'support.draft';
const APPLE_RELAY = '@privaterelay.appleid.com';
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface SupportDraft {
  readonly category: TicketCategory | null;
  readonly subject: string;
  readonly message: string;
  readonly contactEmail: string;
  readonly diagnostics: boolean;
  readonly idempotencyKey: string;
}

export function loadDraft(): SupportDraft | null {
  if (!isEncryptedStorageOpen()) return null;
  const raw = encryptedStorage().prefs.getString(DRAFT_KEY);
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw) as SupportDraft;
  } catch {
    return null;
  }
}

function saveDraft(draft: SupportDraft | null): void {
  if (!isEncryptedStorageOpen()) return;
  if (draft === null) encryptedStorage().prefs.remove(DRAFT_KEY);
  else encryptedStorage().prefs.set(DRAFT_KEY, JSON.stringify(draft));
}

export interface ContactSheetProps {
  readonly visible: boolean;
  readonly onDismiss: () => void;
  readonly initialCategory?: TicketCategory | null;
  readonly signInEmail: string | null;
  readonly from: 'help' | 'settings' | 'state' | 'deeplink';
  /** Expands a Help answer (the billing hint's "Nasıl?"). */
  readonly onOpenFaq: (key: string) => void;
}

export function ContactSheet({
  visible,
  onDismiss,
  initialCategory,
  signInEmail,
  onOpenFaq,
}: ContactSheetProps) {
  const t = useTranslations();
  const router = useRouter();
  const online = useOnline();
  const queryClient = useQueryClient();
  const mutation = useMutation(supportTicketMutationOptions(getApiClient()));
  const [draft, setDraft] = useState<SupportDraft>(() => {
    const stored = loadDraft();
    const base: SupportDraft = stored ?? {
      category: null,
      subject: '',
      message: '',
      contactEmail: signInEmail ?? '',
      diagnostics: true,
      idempotencyKey: Crypto.randomUUID(),
    };
    return initialCategory === null || initialCategory === undefined
      ? base
      : { ...base, category: initialCategory };
  });
  const [errors, setErrors] = useState<{ topic?: string; message?: string; email?: string }>({});
  const [showWhat, setShowWhat] = useState(false);
  const [done, setDone] = useState<{ reference: string; email: string } | null>(null);

  const update = (patch: Partial<SupportDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    saveDraft(next);
  };

  const categoryLabel = (category: TicketCategory) => t(`settings.contact.categories.${category}`);
  const subject =
    draft.subject !== '' || draft.category === null
      ? draft.subject
      : t('settings.contact.subjectDefault', { category: categoryLabel(draft.category) });

  const close = () => {
    if (mutation.isPending) return;
    if (done === null && (draft.message !== '' || draft.subject !== '')) {
      showToast({ message: t('settings.contact.draftSaved') });
    }
    onDismiss();
  };

  const submit = () => {
    const nextErrors: typeof errors = {};
    if (draft.category === null) nextErrors.topic = t('settings.contact.validation.topic');
    if (draft.message.trim().length < MESSAGE_MIN) {
      nextErrors.message = t('settings.contact.validation.messageMin', { min: MESSAGE_MIN });
    }
    const email = draft.contactEmail.trim();
    if (email !== '' && !EMAIL.test(email)) {
      nextErrors.email = t('settings.contact.validation.email');
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || draft.category === null) return;
    const category = draft.category;
    mutation.mutate(
      {
        body: {
          category,
          subject: subject.trim().slice(0, 120),
          message: draft.message.trim(),
          include_diagnostics: draft.diagnostics,
          ...(email === '' ? {} : { contact_email: email }),
        },
        idempotencyKey: draft.idempotencyKey,
      },
      {
        onSuccess: (result) => {
          track('support_ticket_submitted', { category, diagnostics: draft.diagnostics });
          saveDraft(null);
          void queryClient.invalidateQueries({ queryKey: qk.support.tickets() });
          setDone({
            reference: result.reference,
            email: maskEmail(email === '' ? (signInEmail ?? '') : email),
          });
        },
        onError: (error) => {
          const code = isApiError(error) ? error.code : 'NETWORK_ERROR';
          track('support_ticket_failed', { code });
          if (isApiError(error) && error.code === 'RATE_LIMITED') {
            showToast({ message: t('settings.contact.rateLimited'), kind: 'error' });
          } else if (isApiError(error) && error.code === 'VALIDATION_FAILED') {
            setErrors({
              message: t('settings.contact.validation.messageMin', { min: MESSAGE_MIN }),
            });
          } else {
            showToast({ message: t('settings.contact.failed'), kind: 'error' });
          }
        },
      },
    );
  };

  if (done !== null) {
    return (
      <BottomSheet visible={visible} onDismiss={onDismiss} testID="sheet.contact">
        <SuccessState
          title={t('settings.contact.successTitle')}
          body={t('settings.contact.successBody', { reference: done.reference, email: done.email })}
          action={{ label: t('common.actions.ok'), onPress: onDismiss }}
          testID="contact.success"
        />
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      visible={visible}
      onDismiss={close}
      dismissible={!mutation.isPending}
      title={t('settings.contact.title')}
      testID="sheet.contact"
      footer={
        <View style={styles.buttons}>
          <Button
            label={t('settings.contact.send')}
            loading={mutation.isPending}
            loadingLabel={t('settings.contact.sending')}
            disabled={!online}
            {...(online ? {} : { accessibilityHint: t('states.offline.blockedReason') })}
            fullWidth
            onPress={submit}
            testID="contact.send"
          />
          {online ? null : (
            <Text variant="meta" tone="tertiaryStrong" align="center" testID="contact.offline">
              {t('states.offline.blockedReason')}
            </Text>
          )}
        </View>
      }
    >
      <Text variant="kicker" tone="secondary">
        {t('settings.contact.topic')}
      </Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {TICKET_CATEGORIES.map((category) => (
          <ChoiceChip
            key={category}
            label={categoryLabel(category)}
            selected={draft.category === category}
            onPress={() => {
              update({ category });
            }}
            testID={`contact.category.${category}`}
          />
        ))}
      </View>
      {errors.topic === undefined ? null : (
        <Text variant="bodySm" tone="critical" testID="contact.topicError">
          {errors.topic}
        </Text>
      )}
      {draft.category === 'privacy' ? (
        <ListRow
          title={t('settings.contact.privacyHint')}
          trailing={{ kind: 'link', text: t('privacy.center.deleteAccount') }}
          onPress={() => {
            onDismiss();
            router.push('/settings/privacy/delete-account');
          }}
          testID="contact.privacyHint"
        />
      ) : null}
      {draft.category === 'billing' ? (
        <ListRow
          title={t('settings.contact.billingHint')}
          trailing={{ kind: 'link', text: t('settings.contact.billingHow') }}
          onPress={() => {
            onDismiss();
            onOpenFaq('refund');
          }}
          testID="contact.billingHint"
        />
      ) : null}
      <TextField
        label={t('settings.contact.subject')}
        value={subject}
        maxLength={120}
        onChangeText={(text) => {
          update({ subject: text });
        }}
        testID="contact.subject"
      />
      <Text variant="label">{t('settings.contact.message')}</Text>
      <CaptureTextField
        accessibilityLabel={t('settings.contact.message')}
        placeholder={t('settings.contact.messageHint')}
        value={draft.message}
        maxLength={MESSAGE_MAX}
        onChangeText={(text) => {
          update({ message: text });
        }}
        counterText={t('settings.contact.counter', {
          count: draft.message.length,
          max: MESSAGE_MAX,
        })}
        testID="contact.message"
      />
      <Text variant="meta" tone="tertiaryStrong">
        {t('settings.contact.noSecrets')}
      </Text>
      {errors.message === undefined ? null : (
        <Text
          variant="bodySm"
          tone="critical"
          accessibilityLiveRegion="assertive"
          testID="contact.messageError"
        >
          {errors.message}
        </Text>
      )}
      <TextField
        label={t('settings.contact.replyTo')}
        value={draft.contactEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        onChangeText={(text) => {
          update({ contactEmail: text });
        }}
        {...(draft.contactEmail.endsWith(APPLE_RELAY)
          ? { helper: t('settings.contact.appleRelay') }
          : {})}
        {...(errors.email === undefined ? {} : { error: errors.email })}
        testID="contact.email"
      />
      <ListRow
        title={t('settings.contact.diagnostics')}
        trailing={{ kind: 'switch', value: draft.diagnostics }}
        onPress={() => {
          update({ diagnostics: !draft.diagnostics });
        }}
        testID="contact.diagnostics"
      />
      <Button
        label={t('settings.contact.diagnosticsWhat')}
        variant="text"
        size="sm"
        onPress={() => {
          setShowWhat(!showWhat);
        }}
        testID="contact.diagnosticsWhat"
      />
      {showWhat ? (
        <Text variant="bodySm" tone="secondary">
          {t('settings.contact.diagnosticsBody')}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  buttons: { gap: 6 },
});

/**
 * M-MEET-02 · Not Al: a user-authored meeting note bound to the event (text or on-device
 * dictation) → `POST /meetings/:eventId/notes` (idempotent on `client_note_id`, so "Tekrar Dene"
 * never duplicates). No approval: an internal note with no external side effect. The draft stays
 * in the sheet, is kept in the encrypted cache when the app backgrounds and is restored on reopen;
 * closing with text asks "Not silinsin mi?" first.
 */
import { qk } from '@da/api-client';
import { apiMutationOptions, useApiClient } from '@da/api-client/react';
import {
  BottomSheet,
  Button,
  CaptureTextField,
  HintRow,
  IconButton,
  Text,
  TranscriptCard,
  useToast,
} from '@da/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { registerSheet, sheets, type SheetRenderProps } from '../../providers/SheetHost';
import { mountSheet } from '../actions/mount';
import { useOfflineGuard } from '../actions/ui';
import { readDraft, useDictation, writeDraft } from './dictation';

export interface NoteSheetParams {
  readonly eventId: string;
  /** "{Müşteri toplantısı} · {14:30}" */
  readonly subtitle: string;
  readonly origin: 'prep' | 'event';
}

const MAX_NOTE = 10_000;

export function noteDraftKey(eventId: string): string {
  return `draft.meeting_note.${eventId}`;
}

function NoteSheet({ params, visible, onDismiss, onHidden }: SheetRenderProps<NoteSheetParams>) {
  const t = useTranslations('meeting.note');
  const tc = useTranslations('common');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const toast = useToast();
  const blocked = useOfflineGuard();
  const draftKey = noteDraftKey(params.eventId);
  const [text, setText] = useState(() => readDraft(draftKey));
  const [clientNoteId] = useState(() => Crypto.randomUUID());
  const [usedVoice, setUsedVoice] = useState(false);
  const [confidence, setConfidence] = useState<number | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const save = useMutation(apiMutationOptions(client, 'POST /meetings/:eventId/notes'));
  const dictation = useDictation((spoken, score) => {
    setUsedVoice(true);
    setConfidence(score);
    setText((current) => (current.trim() === '' ? spoken : `${current.trimEnd()} ${spoken}`));
  });

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') writeDraft(draftKey, text);
    });
    return () => {
      sub.remove();
    };
  }, [draftKey, text]);

  const close = () => {
    dictation.stop();
    onDismiss();
  };

  const submit = () => {
    const body = text.trim();
    if (body === '' || blocked('capture')) return;
    dictation.stop();
    save.mutate(
      {
        input: {
          params: { eventId: params.eventId },
          body: {
            client_note_id: clientNoteId,
            body,
            source: usedVoice ? 'voice' : 'text',
            ...(usedVoice && confidence !== undefined ? { transcript_confidence: confidence } : {}),
          },
        },
      },
      {
        onSuccess: () => {
          writeDraft(draftKey, '');
          track('meeting_note_saved', {
            input_mode: usedVoice ? 'voice' : 'text',
            origin: params.origin,
          });
          void queryClient.invalidateQueries({ queryKey: qk.meetings.notes(params.eventId) });
          toast.show({ message: t('saved'), kind: 'success' });
          onDismiss();
        },
      },
    );
  };

  const listening = dictation.state === 'listening' || dictation.state === 'requesting';
  return (
    <BottomSheet
      visible={visible}
      onDismiss={() => {
        if (text.trim() === '') close();
        else setConfirming(true);
      }}
      onHidden={onHidden}
      title={t('title')}
      subtitle={params.subtitle}
      testID="meeting.note"
      footer={
        confirming ? (
          <View style={{ gap: 8 }}>
            <Text variant="rowTitle" heading>
              {t('discardTitle')}
            </Text>
            <Button
              label={tc('actions.delete')}
              variant="destructive"
              onPress={() => {
                writeDraft(draftKey, '');
                close();
              }}
              fullWidth
              testID="meeting.note.discard"
            />
            <Button
              label={tc('actions.nevermind')}
              variant="text"
              onPress={() => {
                setConfirming(false);
              }}
              fullWidth
            />
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <Button
              label={tc('actions.save')}
              onPress={submit}
              disabled={text.trim() === ''}
              loading={save.isPending}
              fullWidth
              testID="meeting.note.save"
            />
            <Button
              label={tc('actions.nevermind')}
              variant="text"
              onPress={() => {
                if (text.trim() === '') close();
                else setConfirming(true);
              }}
              fullWidth
              testID="meeting.note.cancel"
            />
          </View>
        )
      }
    >
      <View style={{ gap: 12 }}>
        <CaptureTextField
          value={text}
          onChangeText={setText}
          accessibilityLabel={t('inputLabel')}
          placeholder={t('inputHint')}
          maxLength={MAX_NOTE}
          testID="meeting.note.input"
          {...(dictation.available
            ? {
                chips: (
                  <IconButton
                    icon={dictation.state === 'denied' ? 'mic_off' : listening ? 'stop' : 'mic'}
                    variant="mic"
                    filled={listening}
                    accessibilityLabel={listening ? t('dictateStop') : t('dictateStart')}
                    onPress={dictation.toggle}
                    disabled={dictation.state === 'denied'}
                    testID="meeting.note.mic"
                  />
                ),
              }
            : {})}
        />
        {listening && dictation.partial !== '' ? (
          <TranscriptCard transcript={dictation.partial} caption={t('listening')} recording />
        ) : null}
        {dictation.state === 'denied' ? (
          <View style={{ gap: 6 }}>
            <HintRow text={t('micDenied')} />
            <Button
              label={tc('actions.openSettings')}
              variant="text"
              onPress={() => {
                void Linking.openSettings();
              }}
            />
          </View>
        ) : dictation.state === 'error' ? (
          <HintRow text={t('sttFailed')} />
        ) : null}
        {save.isError ? (
          <View style={{ gap: 6 }} testID="meeting.note.error">
            <Text variant="secondary" tone="critical">
              {t('saveFailed')}
            </Text>
            <Button label={tc('actions.retry')} variant="text" onPress={submit} />
          </View>
        ) : null}
      </View>
    </BottomSheet>
  );
}

registerSheet('m2.note', mountSheet(NoteSheet));

export function openNoteSheet(params: NoteSheetParams): void {
  sheets.open('m2.note', params);
}

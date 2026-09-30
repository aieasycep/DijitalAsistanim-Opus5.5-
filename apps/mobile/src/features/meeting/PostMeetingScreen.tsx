/**
 * M-MEET-04 · Toplantı Sonrası and M-MEET-05 · Taahhüdü Düzenle. "Toplantın bitti. Takip etmen
 * gereken bir şey var mı?" Text or dictation (recording never starts on its own) →
 * `POST /meetings/:eventId/post` (idempotent on `client_post_id`) → grounded `commitment_create`
 * proposals. "Kaydet" is the explicit approval (C-06): each selected row is approved in place
 * (`approved_via='in_place'`, R-03), each unselected row is rejected (`user_reject`, not a learning
 * signal). Low-confidence rows and undated ones start unselected. Discarding rejects every proposal
 * (`user_cancel`) and deletes the note. Offline, the transcript is kept (encrypted cache) until
 * extraction is possible.
 */
import { isApiError, qk } from '@da/api-client';
import { apiMutationOptions, useApiClient } from '@da/api-client/react';
import { addDaysToLocalDate, endOfLocalDay, isoWeekStart, isoWeekdayOf } from '@da/domain';
import {
  AiWorkingKicker,
  BottomSheet,
  Button,
  CaptureTextField,
  ChipWrap,
  ChoiceChip,
  EmptyState,
  ErrorCard,
  HintRow,
  Icon,
  IconButton,
  PressableScale,
  SegmentedControl,
  SkeletonBlock,
  SuccessState,
  Text,
  TextField,
  TranscriptCard,
  useTheme,
  useToast,
} from '@da/ui';
import type { ApprovalView } from '@da/validation/api/approvals';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { getSupabase } from '../../lib/auth/supabase';
import { now } from '../../lib/clock';
import { useFormats, useSessionContext, type Formats } from '../../lib/data/session';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { ProGate } from '../actions/ProGate';
import { DetailScreen, useBack, useOfflineGuard } from '../actions/ui';
import { eventOptions, hoursSinceEndBucket } from './data';
import { readDraft, useDictation, writeDraft } from './dictation';

export interface Proposal {
  readonly view: ApprovalView;
  readonly text: string;
  readonly counterparty: string;
  readonly dueAt: string | null;
  readonly dueText: string | null;
  readonly direction: 'user_owes' | 'they_owe';
  readonly confidence: number;
  readonly quote: string;
  readonly edited: boolean;
}

type RowState = 'idle' | 'saving' | 'saved' | 'failed';
type Phase = 'input' | 'extracting' | 'proposals' | 'saved' | 'none_found';
type Origin = 'push' | 'prep' | 'event' | 'deeplink';
const ORIGINS: readonly Origin[] = ['push', 'prep', 'event', 'deeplink'];

export const LOW_CONFIDENCE = 0.7;

/** Selected by default: confident and dated (an undated or unsure row needs an explicit choice). */
export function defaultSelected(p: Pick<Proposal, 'confidence' | 'dueAt' | 'dueText'>): boolean {
  return p.confidence >= LOW_CONFIDENCE && !(p.dueAt === null && p.dueText !== null);
}

export function postDraftKey(eventId: string): string {
  return `draft.post_meeting.${eventId}`;
}

function countBucket(n: number): '0' | '1' | '2-3' | '4+' {
  if (n === 0) return '0';
  if (n === 1) return '1';
  return n <= 3 ? '2-3' : '4+';
}

type DuePreset = 'today' | 'tomorrow' | 'week' | 'none';

export function presetDue(
  preset: DuePreset,
  formats: Pick<Formats, 'today' | 'timeZone'>,
): string | null {
  const today = formats.today();
  const day =
    preset === 'today'
      ? today
      : preset === 'tomorrow'
        ? addDaysToLocalDate(today, 1)
        : preset === 'week'
          ? addDaysToLocalDate(isoWeekStart(today), isoWeekdayOf(today) <= 5 ? 4 : 6)
          : null;
  return day === null ? null : endOfLocalDay(day, formats.timeZone).toISOString();
}

// ── M-MEET-05 · Taahhüdü Düzenle ────────────────────────────────────────────────────────────

function EditSheet({
  proposal,
  onClose,
  onSaved,
}: {
  readonly proposal: Proposal | null;
  readonly onClose: () => void;
  readonly onSaved: (next: Proposal) => void;
}) {
  const t = useTranslations('meeting.edit');
  const tc = useTranslations('common');
  const client = useApiClient();
  const formats = useFormats();
  const blocked = useOfflineGuard();
  const edit = useMutation(apiMutationOptions(client, 'PATCH /approvals/:id'));
  const [text, setText] = useState(proposal?.text ?? '');
  const [direction, setDirection] = useState(proposal?.direction ?? 'user_owes');
  const [preset, setPreset] = useState<DuePreset | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (proposal === null) return null;
  const save = () => {
    const trimmed = text.trim();
    if (trimmed === '') {
      setError(t('textRequired'));
      return;
    }
    if (blocked('approve')) return;
    const patch: Record<string, unknown> = {};
    let changed = 0;
    if (trimmed !== proposal.text) {
      patch.text = trimmed;
      changed += 1;
    }
    if (direction !== proposal.direction) {
      patch.direction = direction;
      changed += 1;
    }
    const dueAt = preset === null ? proposal.dueAt : presetDue(preset, formats);
    if (preset !== null) {
      patch.due_at = dueAt;
      patch.due_precision = dueAt === null ? 'none' : 'date';
      changed += 1;
    }
    if (changed === 0) {
      onClose();
      return;
    }
    edit.mutate(
      {
        input: {
          params: { id: proposal.view.id },
          body: { expected_payload_version: proposal.view.payload_version, payload_patch: patch },
        },
      },
      {
        onSuccess: (view) => {
          track('commitment_proposal_edited', { fields_changed_count: changed });
          onSaved({
            ...proposal,
            view,
            text: trimmed,
            direction,
            dueAt,
            dueText: preset === null ? proposal.dueText : null,
            edited: true,
          });
        },
      },
    );
  };
  const presets: readonly { key: DuePreset; label: string }[] = [
    { key: 'today', label: tc('time.today') },
    { key: 'tomorrow', label: tc('time.tomorrow') },
    { key: 'week', label: t('thisWeek') },
    { key: 'none', label: t('noDate') },
  ];
  return (
    <BottomSheet
      visible
      onDismiss={onClose}
      presentation="inline"
      title={t('title')}
      testID="post.edit"
      footer={
        <View style={{ gap: 8 }}>
          <Button
            label={tc('actions.save')}
            onPress={save}
            loading={edit.isPending}
            fullWidth
            testID="post.edit.save"
          />
          <Button label={tc('actions.nevermind')} variant="text" onPress={onClose} fullWidth />
        </View>
      }
    >
      <View style={{ gap: 14 }}>
        <TextField
          label={t('text')}
          value={text}
          onChangeText={(next) => {
            setText(next);
            setError(null);
          }}
          maxLength={120}
          {...(error === null ? {} : { error })}
          testID="post.edit.text"
        />
        <View style={{ gap: 6 }}>
          <Text variant="label" tone="secondary">
            {t('who')}
          </Text>
          <SegmentedControl
            options={[
              { key: 'user_owes', label: t('me') },
              {
                key: 'they_owe',
                label: proposal.counterparty === '' ? t('them') : proposal.counterparty,
              },
            ]}
            selectedKey={direction}
            onChange={(key) => {
              setDirection(key === 'they_owe' ? 'they_owe' : 'user_owes');
            }}
            semantics="radio"
            accessibilityLabel={t('who')}
            testID="post.edit.direction"
          />
        </View>
        <View style={{ gap: 6 }}>
          <Text variant="label" tone="secondary">
            {t('due')}
          </Text>
          <ChipWrap>
            {presets.map((p) => (
              <ChoiceChip
                key={p.key}
                label={p.label}
                selected={preset === p.key}
                onPress={() => {
                  setPreset(p.key);
                }}
              />
            ))}
          </ChipWrap>
        </View>
        {edit.isError ? (
          <Text variant="secondary" tone="critical">
            {isApiError(edit.error) && edit.error.code === 'APPROVAL_STATE_CONFLICT'
              ? t('conflict')
              : t('saveFailed')}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}

// ── Proposal row ───────────────────────────────────────────────────────────────────────────

function ProposalRow({
  proposal,
  selected,
  state,
  onToggle,
  onEdit,
}: {
  readonly proposal: Proposal;
  readonly selected: boolean;
  readonly state: RowState;
  readonly onToggle: () => void;
  readonly onEdit: () => void;
}) {
  const t = useTranslations('meeting.postScreen');
  const tc = useTranslations('common');
  const theme = useTheme();
  const formats = useFormats();
  const due =
    proposal.dueAt !== null
      ? formats.relativeDay(proposal.dueAt) === 'today'
        ? tc('time.today')
        : formats.relativeDay(proposal.dueAt) === 'tomorrow'
          ? tc('time.tomorrow')
          : formats.dayMonth(proposal.dueAt)
      : proposal.dueText !== null
        ? t('dateUnclear')
        : null;
  const who =
    proposal.direction === 'user_owes' ? t('youDo') : t('theyDo', { name: proposal.counterparty });
  const meta = [due, proposal.counterparty === '' ? null : proposal.counterparty, who].filter(
    (p): p is string => p !== null && p !== '',
  );
  if (proposal.confidence < LOW_CONFIDENCE) meta.push(t('unsure'));
  const label = t('rowA11y', { text: proposal.text, meta: meta.join(', ') });
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 }}
      testID={`post.proposal.${proposal.view.id}`}
    >
      <Icon name="handshake" size={20} color={theme.color.brand.primary} />
      <PressableScale
        feedback="card"
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={t('editHint')}
        style={{ flex: 1, gap: 2 }}
        testID={`post.proposal.${proposal.view.id}.edit`}
      >
        <Text variant="rowTitle">{proposal.text}</Text>
        <Text variant="meta" tone={state === 'failed' ? 'critical' : 'secondary'}>
          {state === 'failed' ? t('rowFailed') : meta.join(' · ')}
        </Text>
      </PressableScale>
      {state === 'saving' ? (
        <AiWorkingKicker label={t('saving')} />
      ) : state === 'saved' ? (
        <Icon name="check_circle" filled size={24} color={theme.color.tone.success.solid} />
      ) : (
        <PressableScale
          feedback="button"
          onPress={onToggle}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected }}
          accessibilityLabel={t('includeA11y', { text: proposal.text })}
          visualSize={{ width: 24, height: 24 }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          testID={`post.proposal.${proposal.view.id}.toggle`}
        >
          <Icon
            name={selected ? 'check_circle' : 'radio_button_unchecked'}
            filled={selected}
            size={24}
            color={selected ? theme.color.tone.success.solid : theme.color.text.tertiaryStrong}
          />
        </PressableScale>
      )}
    </View>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────────────────────

export function PostMeetingScreen() {
  const t = useTranslations('meeting.postScreen');
  const tc = useTranslations('common');
  const router = useRouter();
  const toast = useToast();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const formats = useFormats();
  const session = useSessionContext();
  const online = useOnline();
  const blocked = useOfflineGuard();
  const params = useLocalSearchParams<{ eventId: string; origin?: string }>();
  const eventId = params.eventId;
  const origin: Origin = ORIGINS.find((o) => o === params.origin) ?? 'deeplink';
  const back = useBack('/today');
  const draftKey = postDraftKey(eventId);
  const event = useQuery(eventOptions(eventId));
  const extract = useMutation(apiMutationOptions(client, 'POST /meetings/:eventId/post'));
  const approve = useMutation(apiMutationOptions(client, 'POST /approvals/:id/approve'));
  const reject = useMutation(apiMutationOptions(client, 'POST /approvals/:id/reject'));

  const [text, setText] = useState(() => readDraft(draftKey));
  const [typing, setTyping] = useState(false);
  const [usedVoice, setUsedVoice] = useState(false);
  const [attempt, setAttempt] = useState<{ text: string; id: string } | null>(null);
  const [phase, setPhase] = useState<Phase>('input');
  const [noteId, setNoteId] = useState<string | null>(null);
  const [proposals, setProposals] = useState<readonly Proposal[]>([]);
  const [selected, setSelected] = useState<Readonly<Record<string, boolean>>>({});
  const [rows, setRows] = useState<Readonly<Record<string, RowState>>>({});
  const [editing, setEditing] = useState<Proposal | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);

  const dictation = useDictation((spoken) => {
    setUsedVoice(true);
    setText((current) => (current.trim() === '' ? spoken : `${current.trimEnd()} ${spoken}`));
  });
  const micUnavailable = !dictation.available || dictation.state === 'denied';

  const endIso = event.data?.endAt;
  const hasEnd = endIso !== undefined;
  useEffect(() => {
    if (endIso === undefined) return;
    track('post_meeting_opened', {
      origin,
      hours_since_end_bucket: hoursSinceEndBucket(Date.parse(endIso), now().getTime()),
    });
    // Once per visit, when the meeting end is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEnd]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && phase === 'input') writeDraft(draftKey, text);
    });
    return () => {
      sub.remove();
    };
  }, [draftKey, text, phase]);

  const runExtraction = () => {
    const body = text.trim();
    if (body === '') return;
    dictation.stop();
    if (!online) {
      writeDraft(draftKey, body);
      toast.show({ message: t('offlineExtract'), kind: 'offline' });
      return;
    }
    const id = attempt !== null && attempt.text === body ? attempt.id : Crypto.randomUUID();
    setAttempt({ text: body, id });
    setPhase('extracting');
    track('post_meeting_input', { mode: usedVoice ? 'voice' : 'text', engine: 'on_device' });
    extract.mutate(
      {
        input: {
          params: { eventId },
          body: { client_post_id: id, text: body, source: usedVoice ? 'voice' : 'text' },
        },
      },
      {
        onSuccess: (result) => {
          writeDraft(draftKey, '');
          setNoteId(result.note_id);
          const list: Proposal[] = result.proposals.map((p) => ({
            view: p.approval,
            text: p.text,
            counterparty: p.counterparty_label,
            dueAt: p.due_at,
            dueText: p.due_text,
            direction: p.direction,
            confidence: p.confidence,
            quote: p.quote,
            edited: false,
          }));
          track('post_meeting_extracted', {
            count_bucket: countBucket(list.length),
            low_confidence_count: list.filter((p) => p.confidence < LOW_CONFIDENCE).length,
          });
          setProposals(list);
          setSelected(Object.fromEntries(list.map((p) => [p.view.id, defaultSelected(p)])));
          setRows({});
          setPhase(result.none_found || list.length === 0 ? 'none_found' : 'proposals');
        },
        onError: () => {
          setPhase('input');
        },
      },
    );
  };

  const deleteNote = async () => {
    if (noteId === null) return;
    await getSupabase().from('meeting_notes').delete().eq('id', noteId);
    void queryClient.invalidateQueries({ queryKey: qk.meetings.notes(eventId) });
  };

  const save = async () => {
    if (blocked('approve')) return;
    setSaving(true);
    const results: Record<string, RowState> = { ...rows };
    let ok = 0;
    for (const proposal of proposals) {
      const id = proposal.view.id;
      if (results[id] === 'saved') {
        ok += 1;
        continue;
      }
      if (selected[id] !== true) continue;
      results[id] = 'saving';
      setRows({ ...results });
      try {
        await approve.mutateAsync({
          input: {
            params: { id },
            body: {
              idempotency_key: proposal.view.idempotency_key,
              payload_version: proposal.view.payload_version,
              approved_via: 'in_place',
            },
          },
        });
        ok += 1;
        results[id] = 'saved';
      } catch {
        results[id] = 'failed';
      }
      setRows({ ...results });
    }
    const failed = proposals.some(
      (p) => selected[p.view.id] === true && results[p.view.id] !== 'saved',
    );
    if (!failed) {
      await Promise.allSettled(
        proposals
          .filter((p) => selected[p.view.id] !== true)
          .map((p) =>
            reject.mutateAsync({
              input: { params: { id: p.view.id }, body: { reason: 'user_reject', learn: false } },
            }),
          ),
      );
      track('post_meeting_commitments_saved', {
        count: ok,
        edited_count: proposals.filter((p) => p.edited && selected[p.view.id] === true).length,
      });
      void queryClient.invalidateQueries({ queryKey: qk.commitments.all });
      void queryClient.invalidateQueries({ queryKey: qk.approvals.all });
      setSavedCount(ok);
      setPhase('saved');
    }
    setSaving(false);
  };

  const discard = async () => {
    setConfirmDiscard(false);
    dictation.stop();
    track('post_meeting_discarded');
    if (proposals.length > 0 || noteId !== null) {
      await Promise.allSettled(
        proposals
          .filter((p) => rows[p.view.id] !== 'saved')
          .map((p) =>
            reject.mutateAsync({
              input: { params: { id: p.view.id }, body: { reason: 'user_cancel', learn: false } },
            }),
          ),
      );
      await deleteNote().catch(() => undefined);
    }
    writeDraft(draftKey, '');
    back();
  };

  const close = () => {
    if (phase === 'proposals') setConfirmDiscard(true);
    else {
      dictation.stop();
      if (phase === 'input') writeDraft(draftKey, text);
      back();
    }
  };

  const title = event.data?.title ?? '';
  const others = (event.data?.attendees ?? []).filter((a) => a.is_self !== true);
  const person = others[0]?.name ?? others[0]?.email ?? title;
  const range = event.data === undefined ? '' : formats.range(event.data.startAt, event.data.endAt);
  const staleDay =
    endIso !== undefined && now().getTime() - Date.parse(endIso) > 24 * 3_600_000
      ? formats.relativeDay(endIso) === 'yesterday'
        ? tc('time.yesterday')
        : formats.dayMonth(endIso)
      : null;
  const meta = [person, staleDay === null ? range : `${staleDay} ${range}`]
    .filter((p) => p !== '')
    .join(' · ');
  const selectedCount = proposals.filter(
    (p) => selected[p.view.id] === true && rows[p.view.id] !== 'saved',
  ).length;
  const listening = dictation.state === 'listening' || dictation.state === 'requesting';

  if (!session.isPro) {
    return (
      <DetailScreen leading="close" kicker={t('kicker')} onLeadingPress={back} testID="post.screen">
        <ProGate
          feature="commitments"
          kicker={t('gateKicker')}
          title={t('gateTitle')}
          body={t('gateBody')}
          surface="card"
        />
      </DetailScreen>
    );
  }

  if (phase === 'saved') {
    return (
      <DetailScreen leading="close" kicker={t('kicker')} onLeadingPress={back} testID="post.screen">
        <SuccessState
          title={t('savedTitle', { count: savedCount })}
          body={t('savedBody')}
          action={{
            label: t('seeCommitments'),
            onPress: () => {
              router.replace('/commitments');
            },
          }}
          testID="post.saved"
        />
        <Button
          label={tc('actions.backToToday')}
          variant="text"
          onPress={() => {
            router.replace('/today');
          }}
          fullWidth
        />
      </DetailScreen>
    );
  }

  return (
    <DetailScreen
      leading="close"
      kicker={t('kicker')}
      onLeadingPress={close}
      footer={
        confirmDiscard ? (
          <View style={{ gap: 8 }} testID="post.discardConfirm">
            <Text variant="rowTitle">{t('discardTitle')}</Text>
            <Text variant="secondary" tone="secondary">
              {t('discardBody')}
            </Text>
            <Button
              label={tc('actions.delete')}
              variant="destructive"
              onPress={() => {
                void discard();
              }}
              fullWidth
              testID="post.discard"
            />
            <Button
              label={tc('actions.nevermind')}
              variant="text"
              onPress={() => {
                setConfirmDiscard(false);
              }}
              fullWidth
            />
          </View>
        ) : phase === 'proposals' ? (
          <Button
            label={tc('actions.save')}
            onPress={() => {
              void save();
            }}
            disabled={selectedCount === 0 && !proposals.some((p) => rows[p.view.id] === 'saved')}
            accessibilityHint={selectedCount === 0 ? t('selectOne') : undefined}
            loading={saving}
            fullWidth
            testID="post.save"
          />
        ) : phase === 'input' ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              label={t('extract')}
              onPress={runExtraction}
              disabled={text.trim() === ''}
              flex
              testID="post.extract"
            />
            {micUnavailable ? null : (
              <IconButton
                icon={typing ? 'mic' : 'keyboard'}
                accessibilityLabel={typing ? t('voiceMode') : t('textMode')}
                onPress={() => {
                  dictation.stop();
                  setTyping((v) => !v);
                }}
                testID="post.modeToggle"
              />
            )}
          </View>
        ) : undefined
      }
      testID="post.screen"
    >
      <View style={{ gap: 4 }}>
        {meta === '' ? null : (
          <Text variant="meta" tone="secondary">
            {meta}
          </Text>
        )}
        <Text variant="h1" heading>
          {t('headline')}
        </Text>
        <Text variant="secondary" tone="secondary">
          {t('sub')}
        </Text>
      </View>

      {phase === 'input' ? (
        <View style={{ gap: 12 }}>
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
          ) : null}
          {typing || micUnavailable || text !== '' ? (
            <CaptureTextField
              value={text}
              onChangeText={setText}
              accessibilityLabel={t('inputLabel')}
              placeholder={t('inputHint')}
              maxLength={5000}
              testID="post.input"
            />
          ) : null}
          {micUnavailable || typing ? null : (
            <View style={{ alignItems: 'center', gap: 8 }}>
              {listening ? (
                <TranscriptCard
                  transcript={dictation.partial === '' ? t('listening') : dictation.partial}
                  caption={t('listening')}
                  recording
                />
              ) : null}
              <IconButton
                icon={listening ? 'stop' : 'mic'}
                variant="mic"
                filled
                accessibilityLabel={listening ? t('stopRecording') : t('startRecording')}
                onPress={dictation.toggle}
                testID="post.mic"
              />
              <Text variant="secondary" tone="secondary">
                {listening ? t('tapToStop') : t('tapToTalk')}
              </Text>
            </View>
          )}
          {dictation.state === 'error' ? <HintRow text={t('sttFailed')} /> : null}
          {text !== '' && !typing && !micUnavailable && !listening ? (
            <Button
              label={t('recordAgain')}
              variant="text"
              onPress={() => {
                setText('');
                setUsedVoice(false);
                dictation.start();
              }}
              testID="post.recordAgain"
            />
          ) : null}
          {extract.isError ? (
            isApiError(extract.error) && extract.error.code === 'QUOTA_EXCEEDED' ? (
              <ErrorCard
                icon="hourglass_top"
                tone="warning"
                title={t('aiLimit')}
                testID="post.limit"
              />
            ) : (
              <ErrorCard
                icon="error"
                tone="critical"
                title={t('extractFailed')}
                primaryAction={{ label: tc('actions.retry'), onPress: runExtraction }}
                testID="post.extractFailed"
              />
            )
          ) : null}
          {!online && text.trim() !== '' ? <HintRow text={t('offlineExtract')} /> : null}
        </View>
      ) : phase === 'extracting' ? (
        <View style={{ gap: 10 }} testID="post.extracting">
          <AiWorkingKicker label={t('extracting')} />
          <SkeletonBlock height={56} />
          <SkeletonBlock height={56} />
        </View>
      ) : phase === 'none_found' ? (
        <View style={{ gap: 8 }}>
          <EmptyState
            icon="task_alt"
            tone="neutral"
            title={t('noneTitle')}
            body={t('noneBody')}
            action={{ label: tc('actions.ok'), onPress: back }}
            testID="post.none"
          />
          <Button
            label={t('deleteNote')}
            variant="text"
            onPress={() => {
              void deleteNote().finally(back);
            }}
            fullWidth
            testID="post.deleteNote"
          />
        </View>
      ) : (
        <View style={{ gap: 6 }} testID="post.proposals">
          <Text variant="kickerAi" tone="brand">
            {t('newCount', { count: proposals.length })}
          </Text>
          {proposals.map((proposal) => (
            <ProposalRow
              key={proposal.view.id}
              proposal={proposal}
              selected={selected[proposal.view.id] === true}
              state={rows[proposal.view.id] ?? 'idle'}
              onToggle={() => {
                setSelected((s) => ({ ...s, [proposal.view.id]: s[proposal.view.id] !== true }));
              }}
              onEdit={() => {
                if (rows[proposal.view.id] !== 'saved') setEditing(proposal);
              }}
            />
          ))}
        </View>
      )}
      {editing === null ? null : (
        <EditSheet
          key={`${editing.view.id}-${String(editing.view.payload_version)}`}
          proposal={editing}
          onClose={() => {
            setEditing(null);
          }}
          onSaved={(next) => {
            setProposals((list) => list.map((p) => (p.view.id === next.view.id ? next : p)));
            setSelected((s) => ({ ...s, [next.view.id]: true }));
            setEditing(null);
          }}
        />
      )}
    </DetailScreen>
  );
}

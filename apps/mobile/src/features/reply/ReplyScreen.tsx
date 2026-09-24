/**
 * M-REPLY-01 · AI Yanıt Taslağı: Generate → Edit → Approval → Send (M§16) in four tones. The only
 * send path is an `email_send` approval the user approves with a tap (R-03): "Göndermeyi Onayla"
 * approves exactly the Gönderim özeti on screen — flush the edits, check the `mail_send`
 * capability (progressive upgrade sheet), `POST /reply-drafts/:id/submit`, and when the submitted
 * draft still matches what was shown, `POST /approvals/:id/approve {approved_via:'in_place'}` with
 * the approval's key; otherwise the inline approval sheet shows the difference and nothing is
 * approved without a second tap. Then the approval is polled and "Gönderildi" appears only after
 * `executed`. Offline: editing autosaves, generation and sending are blocked, never auto-sent.
 */
import { isApiError, qk } from '@da/api-client';
import { apiMutationOptions, useApiClient } from '@da/api-client/react';
import { formatFileSize } from '@da/i18n';
import {
  AiUnavailableCard,
  AiWorkingKicker,
  AssistChip,
  AssuranceNote,
  Button,
  ChipWrap,
  DraftEditorCard,
  ErrorCard,
  HintRow,
  IconButton,
  KeyValueGrid,
  LimitCard,
  MailDetailSkeleton,
  RecipientChip,
  SegmentedControl,
  SuccessState,
  Text,
  useTheme,
  useToast,
} from '@da/ui';
import type { ApprovalView } from '@da/validation/api/approvals';
import type { ReplyDraft } from '@da/validation/api/common';
import { MAX_REPLY_ATTACHMENTS_BYTES } from '@da/validation/api/approvals';
import { useMutation } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

import { useSessionContext } from '../../lib/data/session';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { mailProviderUrl, openWithOs } from '../actions/handoff';
import { openScopeUpgrade } from '../actions/scope';
import { openMenu } from '../actions/sheets';
import { DetailScreen, useBack, useOfflineGuard } from '../actions/ui';
import { openApprovalSheet } from '../approvals/InlineApprovalSheet';
import { useApprovalRunner } from '../approvals/runner';
import { threadIdOfMessage } from '../mail/data';
import { fetchApprovalForEdit, fetchDraft } from './data';

export const TONES = ['short', 'professional', 'friendly', 'detailed'] as const;
export type Tone = (typeof TONES)[number];

function isTone(value: unknown): value is Tone {
  return typeof value === 'string' && (TONES as readonly string[]).includes(value);
}

const AUTOSAVE_MS = 800;
const ATTACHMENT_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'text/plain',
] as const;

type Phase = 'generating' | 'ready' | 'error' | 'budget' | 'submitting' | 'sent';

function recipientsLabel(list: ReplyDraft['to']): string {
  return list.map((r) => r.name ?? r.email).join(', ');
}

function maskAccount(email: string | null): string {
  if (email === null) return '';
  const [user = '', domain = ''] = email.split('@');
  return domain === '' ? email : `${user.slice(0, 2)}***@${domain}`;
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Status after approve: polls the approval; success only from `executed`. */
function SendStatus({
  approval,
  recipient,
  origin,
}: {
  readonly approval: ApprovalView;
  readonly recipient: string;
  readonly origin: string;
}) {
  const t = useTranslations('reply.screen');
  const tr = useTranslations();
  const tc = useTranslations('common.actions');
  const router = useRouter();
  const runner = useApprovalRunner(approval, {
    via: 'in_place',
    undo: false,
    invalidate: [qk.mail.all, qk.flow.all, qk.followups.all, qk.waiting.all],
  });
  const back = () => {
    if (origin === 'today') router.replace('/today');
    else if (origin === 'flow') router.replace('/flow');
    else router.back();
  };
  if (runner.phase === 'executed') {
    return (
      <SuccessState
        title={t('sent')}
        body={t('sentBody', { name: recipient })}
        action={{
          label:
            origin === 'today'
              ? tc('backToToday')
              : origin === 'flow'
                ? t('backToFlow')
                : t('backToMail'),
          onPress: back,
        }}
        testID="reply.sent"
      />
    );
  }
  if (runner.phase === 'failed' && runner.failure !== null) {
    const failure = runner.failure;
    return (
      <ErrorCard
        icon="error"
        tone="critical"
        title={t('failed')}
        body={tr(failure.messageKey as never)}
        {...(failure.retryable
          ? { primaryAction: { label: tc('retry'), onPress: runner.retry } }
          : {})}
        testID="reply.failed"
      />
    );
  }
  return (
    <View style={{ gap: 8 }} accessibilityLiveRegion="polite" testID="reply.sending">
      <AiWorkingKicker label={t('sending')} />
      {runner.slow ? <HintRow text={t('slow')} /> : null}
    </View>
  );
}

export function ReplyScreen() {
  const theme = useTheme();
  const t = useTranslations('reply');
  const tc = useTranslations('common');
  const ts = useTranslations('states');
  const toast = useToast();
  const client = useApiClient();
  const online = useOnline();
  const session = useSessionContext();
  const blocked = useOfflineGuard();
  const params = useLocalSearchParams<{
    id: string;
    tone?: string;
    mode?: string;
    draftId?: string;
    approvalId?: string;
    origin?: string;
  }>();
  const messageId = params.id;
  const mode = params.mode === 'follow_up' ? 'follow_up' : 'reply';
  const origin = params.origin ?? 'mail';
  const back = useBack(`/mail/${messageId}`);

  const [phase, setPhase] = useState<Phase>('generating');
  const [draft, setDraft] = useState<ReplyDraft | null>(null);
  const [body, setBody] = useState('');
  const [edited, setEdited] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [editApproval, setEditApproval] = useState<{
    id: string;
    status: string;
    version: number;
  } | null>(null);
  const [sent, setSent] = useState<ApprovalView | null>(null);
  const [attaching, setAttaching] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<Promise<unknown> | null>(null);
  const intent = useRef<string | null>(null);

  const create = useMutation(apiMutationOptions(client, 'POST /mail/:messageId/reply-drafts'));
  const followUp = useMutation(apiMutationOptions(client, 'POST /followups/:threadId/draft'));
  const regenerate = useMutation(apiMutationOptions(client, 'POST /reply-drafts/:id/regenerate'));
  const patch = useMutation(apiMutationOptions(client, 'PATCH /reply-drafts/:id'));
  const submit = useMutation(apiMutationOptions(client, 'POST /reply-drafts/:id/submit'));
  const approve = useMutation(apiMutationOptions(client, 'POST /approvals/:id/approve'));
  const editApprovalMutation = useMutation(apiMutationOptions(client, 'PATCH /approvals/:id'));
  const attach = useMutation(
    apiMutationOptions(client, 'POST /reply-drafts/:id/attachments/upload-url'),
  );

  const adopt = (next: ReplyDraft) => {
    setDraft(next);
    setBody(next.body_text);
    setPhase('ready');
  };

  const failGeneration = (error: unknown) => {
    const code = isApiError(error) ? error.code : null;
    track(mode === 'follow_up' ? 'follow_up_draft_created' : 'reply_draft_created', {
      tone: isTone(params.tone) ? params.tone : 'professional',
      result: code === 'QUOTA_EXCEEDED' ? 'budget_exhausted' : !online ? 'offline' : 'error',
    });
    setPhase(code === 'QUOTA_EXCEEDED' ? 'budget' : 'error');
  };

  const generate = async () => {
    intent.current ??= Crypto.randomUUID();
    const key = intent.current;
    try {
      if (params.approvalId !== undefined) {
        const approval = await fetchApprovalForEdit(params.approvalId);
        setEditApproval({
          id: approval.id,
          status: approval.status,
          version: approval.payloadVersion,
        });
        if (approval.draftId === null) throw new Error('draft_missing');
        adopt(await fetchDraft(approval.draftId));
        return;
      }
      if (params.draftId !== undefined) {
        adopt(await fetchDraft(params.draftId));
        return;
      }
      const tone = isTone(params.tone)
        ? params.tone
        : mode === 'follow_up'
          ? 'short'
          : 'professional';
      if (mode === 'follow_up') {
        const threadId = await threadIdOfMessage(messageId);
        if (threadId === null) throw new Error('thread_missing');
        const next = await followUp.mutateAsync({
          input: { params: { threadId }, body: { tone } },
          idempotencyKey: key,
        });
        track('follow_up_draft_created', { tone, result: 'ok' });
        adopt(next);
        return;
      }
      const next = await create.mutateAsync({
        input: { params: { messageId }, body: { tone } },
        idempotencyKey: key,
      });
      track('reply_draft_created', { tone, result: 'ok' });
      adopt(next);
    } catch (error) {
      failGeneration(error);
    }
  };

  useEffect(() => {
    // Starts right after the first paint; state changes happen in the async flow, never in the effect body.
    const start = setTimeout(() => {
      void generate();
    }, 0);
    return () => {
      clearTimeout(start);
      if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    };
    // Generate once per screen instance (the idempotency key makes a replay safe).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = (text: string, current: ReplyDraft): Promise<unknown> => {
    const promise = patch
      .mutateAsync({
        input: {
          params: { id: current.id },
          body: { body_text: text, expected_version: current.version },
        },
      })
      .then((next) => {
        setDraft(next);
        return next;
      })
      .catch((error: unknown) => {
        if (isApiError(error) && error.code === 'STATE_CONFLICT') setConflict(true);
        else toast.show({ message: t('screen.saveFailed'), kind: 'error' });
        throw error;
      });
    pendingSave.current = promise;
    return promise;
  };

  const onChangeBody = (text: string) => {
    setBody(text);
    if (!edited) track('reply_draft_edit');
    setEdited(true);
    if (draft === null || text.trim() === '') return;
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    const current = draft;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void save(text, current).catch(() => undefined);
    }, AUTOSAVE_MS);
  };

  /** Writes pending edits before a submit; returns the latest draft. */
  const flush = async (): Promise<ReplyDraft | null> => {
    if (draft === null) return null;
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      return (await save(body, draft)) as ReplyDraft;
    }
    if (pendingSave.current !== null) await pendingSave.current.catch(() => undefined);
    if (body !== draft.body_text && body.trim() !== '')
      return (await save(body, draft)) as ReplyDraft;
    return draft;
  };

  const runRegenerate = (input: { tone?: Tone; instructions?: string }, undoText?: string) => {
    if (draft === null || blocked('reply')) return;
    const previous = { body, tone: draft.tone };
    setRegenerating(true);
    regenerate.mutate(
      {
        input: {
          params: { id: draft.id },
          body: { ...input, expected_version: draft.version },
        },
      },
      {
        onSuccess: (next) => {
          adopt(next);
          setEdited(false);
          if (undoText !== undefined) {
            toast.show({
              message: undoText,
              kind: 'success',
              action: {
                label: tc('actions.undo'),
                onPress: () => {
                  setBody(previous.body);
                  setEdited(true);
                  void save(previous.body, next).catch(() => undefined);
                },
              },
            });
          }
        },
        onError: (error) => {
          if (isApiError(error) && error.code === 'QUOTA_EXCEEDED') setPhase('budget');
          else toast.show({ message: t('screen.regenerateFailed'), kind: 'error' });
        },
        onSettled: () => {
          setRegenerating(false);
        },
      },
    );
  };

  const changeTone = (key: string) => {
    if (!isTone(key) || draft === null || key === draft.tone) return;
    track('reply_tone_change', { tone: key });
    if (!edited) {
      runRegenerate({ tone: key });
      return;
    }
    openMenu({
      title: t('screen.toneOverwrite', { tone: t(`tones.${key}`) }),
      options: [
        {
          key: 'rewrite',
          label: t('regenerate'),
          icon: 'auto_awesome',
          onPress: () => {
            track('reply_tone_overwrite', { confirmed: true });
            runRegenerate({ tone: key }, t('screen.toneApplied'));
          },
        },
        {
          key: 'cancel',
          label: tc('actions.nevermind'),
          icon: 'close',
          onPress: () => {
            track('reply_tone_overwrite', { confirmed: false });
          },
        },
      ],
    });
  };

  const account = session.accounts.find((a) => a.id === draft?.connected_account_id);
  const provider = account?.provider === 'microsoft' ? 'microsoft' : 'google';
  const hasSendScope = (account?.capabilities_granted ?? []).includes('mail_send');

  const approveSubmitted = (approval: ApprovalView) => {
    approve.mutate(
      {
        input: {
          params: { id: approval.id },
          body: {
            idempotency_key: approval.idempotency_key,
            payload_version: approval.payload_version,
            approved_via: 'in_place',
          },
        },
        idempotencyKey: approval.idempotency_key,
      },
      {
        onSuccess: (data) => {
          track('approval_decided', {
            action_type: 'email_send',
            type: 'email_send',
            decision: 'approved',
            via: 'in_place',
            origin: data.approval.origin,
          });
          setSent(data.approval);
          setPhase('sent');
        },
        onError: (error) => {
          setPhase('ready');
          if (
            isApiError(error) &&
            error.code === 'PROVIDER_SCOPE_MISSING' &&
            account !== undefined
          ) {
            openScopeUpgrade({
              accountId: account.id,
              provider,
              capability: 'mail_send',
              approvalId: approval.id,
              onGranted: () => {
                setPhase('submitting');
                approveSubmitted(approval);
              },
            });
            return;
          }
          toast.show({ message: t('screen.sendFailed'), kind: 'error' });
        },
      },
    );
  };

  const confirmSend = async () => {
    if (draft === null || blocked('approve')) return;
    if (!hasSendScope && account !== undefined) {
      openScopeUpgrade({
        accountId: account.id,
        provider,
        capability: 'mail_send',
        onGranted: () => {
          void confirmSend();
        },
      });
      return;
    }
    setPhase('submitting');
    track('reply_submit', { mode });
    try {
      const latest = (await flush()) ?? draft;
      if (editApproval !== null && editApproval.status === 'pending') {
        const edited = await editApprovalMutation.mutateAsync({
          input: {
            params: { id: editApproval.id },
            body: {
              expected_payload_version: editApproval.version,
              payload_patch: { body_text: latest.body_text, subject: latest.subject },
            },
          },
        });
        approveSubmitted(edited);
        return;
      }
      const submitted = await submit.mutateAsync({
        input: { params: { id: latest.id }, body: { expected_version: latest.version } },
      });
      const same =
        submitted.draft.body_text === latest.body_text &&
        submitted.draft.subject === latest.subject &&
        recipientsLabel(submitted.draft.to) === recipientsLabel(latest.to) &&
        recipientsLabel(submitted.draft.cc) === recipientsLabel(latest.cc) &&
        !submitted.draft.warnings.includes('recipients_changed');
      if (!same) {
        setPhase('ready');
        openApprovalSheet({
          approval: submitted.approval,
          origin: 'reply',
          invalidate: [qk.mail.all],
        });
        return;
      }
      approveSubmitted(submitted.approval);
    } catch (error) {
      setPhase('ready');
      if (isApiError(error) && error.code === 'PAYLOAD_TOO_LARGE') {
        toast.show({ message: t('screen.attachmentsTooLarge'), kind: 'error' });
      } else if (isApiError(error) && error.code === 'STATE_CONFLICT') {
        setConflict(true);
      } else {
        toast.show({ message: t('screen.sendFailed'), kind: 'error' });
      }
    }
  };

  const reloadDraft = async () => {
    if (draft === null) return;
    setConflict(false);
    adopt(await fetchDraft(draft.id));
    setEdited(false);
  };

  const addAttachment = async () => {
    if (draft === null || blocked('reply')) return;
    const picked = await DocumentPicker.getDocumentAsync({
      type: [...ATTACHMENT_MIMES],
      copyToCacheDirectory: true,
      multiple: false,
    });
    const file = picked.canceled ? undefined : picked.assets[0];
    if (file === undefined) return;
    const mime = file.mimeType ?? '';
    const used = draft.attachments.reduce((sum, a) => sum + a.size_bytes, 0);
    const size = file.size ?? 0;
    if (!(ATTACHMENT_MIMES as readonly string[]).includes(mime) || size <= 0) {
      toast.show({ message: t('screen.attachmentType'), kind: 'error' });
      return;
    }
    if (used + size > MAX_REPLY_ATTACHMENTS_BYTES) {
      toast.show({ message: t('screen.attachmentsTooLarge'), kind: 'error' });
      return;
    }
    setAttaching(true);
    try {
      const bytes = new Uint8Array(await (await fetch(file.uri)).arrayBuffer());
      const sha256 = hex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
      const result = await attach.mutateAsync({
        input: {
          params: { id: draft.id },
          body: {
            client_attachment_id: Crypto.randomUUID(),
            file_name: file.name,
            mime: mime as (typeof ATTACHMENT_MIMES)[number],
            size_bytes: size,
            sha256,
          },
        },
      });
      const upload = await fetch(result.upload.signed_url, {
        method: 'PUT',
        headers: { 'content-type': mime },
        body: bytes,
      });
      if (!upload.ok) throw new Error('upload_failed');
      track('reply_assist', { kind: 'attach' });
      setDraft(result.draft);
    } catch {
      toast.show({ message: t('screen.attachFailed'), kind: 'error' });
    } finally {
      setAttaching(false);
    }
  };

  const more = () => {
    const handoff =
      draft === null
        ? null
        : mailProviderUrl({
            provider,
            webLink: draft.web_link,
            accountEmail: account?.account_email ?? null,
            providerThreadId: null,
          });
    openMenu({
      options: [
        ...(handoff === null
          ? []
          : [
              {
                key: 'handoff',
                label: provider === 'microsoft' ? t('screen.openOutlook') : t('screen.openGmail'),
                icon: 'open_in_new' as const,
                onPress: () => {
                  void openWithOs(handoff);
                },
              },
            ]),
      ],
    });
  };

  const close = () => {
    if (phase === 'submitting') return;
    if (draft === null || phase === 'sent' || !edited) {
      back();
      return;
    }
    openMenu({
      title: t('screen.keepTitle'),
      options: [
        {
          key: 'keep',
          label: t('screen.keep'),
          icon: 'check',
          onPress: () => {
            track('reply_draft_close', { kept: true });
            void flush()
              .then(() => {
                toast.show({ message: tc('toast.draftSaved') });
                back();
              })
              .catch(() => {
                toast.show({ message: t('screen.saveFailed'), kind: 'error' });
              });
          },
        },
        { key: 'edit', label: t('screen.keepEditing'), icon: 'edit', onPress: () => undefined },
      ],
    });
  };

  const aiUnavailable = session.data?.service_status.unavailable_features.some(
    (f) => f.feature === 'reply_drafts',
  );
  const kicker = mode === 'follow_up' ? t('screen.kickerFollowUp') : t('screen.kicker');
  const recipient = draft === null ? '' : recipientsLabel(draft.to);

  let content;
  if (phase === 'sent' && sent !== null) {
    content = <SendStatus approval={sent} recipient={recipient} origin={origin} />;
  } else if (phase === 'budget') {
    content = (
      <LimitCard
        title={ts('limit.ai.title')}
        body={session.isPro ? ts('limit.ai.tomorrow') : t('screen.budgetBody')}
        testID="reply.budget"
      />
    );
  } else if (
    phase === 'error' ||
    (aiUnavailable === true && draft === null && phase !== 'generating')
  ) {
    content = (
      <AiUnavailableCard
        title={ts('error.aiUnavailable.title')}
        body={ts('error.aiUnavailable.body')}
        primaryAction={{
          label: ts('error.aiUnavailable.cta'),
          onPress: () => {
            setPhase('generating');
            void generate();
          },
          disabled: !online,
        }}
        testID="reply.error"
      />
    );
  } else if (draft === null) {
    content = <MailDetailSkeleton accessibilityLabel={t('generating')} testID="reply.generating" />;
  } else {
    const summary = [
      {
        key: 'from',
        label: t('screen.summary.from'),
        value: `${maskAccount(account?.account_email ?? null)} · ${provider === 'microsoft' ? tc('providers.outlook') : tc('providers.gmail')}`,
      },
      { key: 'to', label: t('screen.summary.to'), value: recipientsLabel(draft.to) },
      ...(draft.cc.length === 0
        ? []
        : [{ key: 'cc', label: t('screen.summary.cc'), value: recipientsLabel(draft.cc) }]),
      { key: 'subject', label: t('screen.summary.subject'), value: draft.subject },
      {
        key: 'attachments',
        label: t('screen.summary.attachments'),
        value:
          draft.attachments.length === 0
            ? t('screen.summary.none')
            : draft.attachments
                .map((a) => `${a.name} (${formatFileSize(a.size_bytes, session.locale)})`)
                .join(', '),
      },
      { key: 'effect', label: t('screen.summary.effect'), value: t('screen.summary.effectValue') },
    ];
    const busy = phase === 'submitting';
    content = (
      <View style={{ gap: 16 }}>
        <View style={{ gap: 6 }}>
          <Text variant="labelSm" tone="secondary">
            {t('screen.to')}
          </Text>
          <ChipWrap>
            {draft.to.map((r) => (
              <RecipientChip key={r.email} name={r.name ?? r.email} id={r.email} />
            ))}
          </ChipWrap>
          <Text variant="meta" tone="tertiaryStrong">
            {draft.subject}
          </Text>
        </View>
        <SegmentedControl
          options={TONES.map((tone) => ({ key: tone, label: t(`tones.${tone}`) }))}
          selectedKey={draft.tone}
          onChange={changeTone}
          semantics="radio"
          disabled={regenerating || busy || !online}
          accessibilityLabel={t('screen.toneA11y')}
          testID="reply.tones"
        />
        {conflict ? (
          <ErrorCard
            icon="sync_problem"
            tone="warning"
            title={t('screen.conflict')}
            primaryAction={{
              label: t('screen.reload'),
              onPress: () => {
                void reloadDraft();
              },
            }}
            testID="reply.conflict"
          />
        ) : null}
        <DraftEditorCard
          kicker={t('screen.editorKicker', { tone: t(`tones.${draft.tone}`) })}
          editableHint={t('screen.editable')}
          value={body}
          onChangeText={onChangeBody}
          accessibilityLabel={t('screen.editorA11y')}
          editable={!busy}
          loading={regenerating}
          tools={
            <ChipWrap>
              <AssistChip
                label={t('screen.shorten')}
                icon="short_text"
                onPress={() => {
                  track('reply_assist', { kind: 'shorten' });
                  runRegenerate(
                    { instructions: t('screen.shortenInstruction') },
                    t('screen.shortened'),
                  );
                }}
                disabled={regenerating || !online}
              />
              <AssistChip
                label={t('screen.addFile')}
                icon="attach_file"
                onPress={() => {
                  void addAttachment();
                }}
                disabled={attaching || !online}
              />
            </ChipWrap>
          }
          testID="reply.editor"
        />
        {body.trim() === '' ? <HintRow text={t('screen.emptyDraft')} /> : null}
        {provider === 'microsoft' ? <HintRow text={t('screen.outlookLimit')} /> : null}
        <View
          accessible
          accessibilityLabel={summary.map((s) => `${s.label}: ${s.value}`).join('. ')}
        >
          <Text variant="labelSm" tone="secondary" style={{ marginBottom: 6 }}>
            {t('screen.summary.title')}
          </Text>
          <KeyValueGrid items={summary} testID="reply.summary" />
        </View>
        <AssuranceNote text={t('screen.assurance')} />
        {online ? null : <HintRow text={t('screen.offline')} />}
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          <Button
            label={t('approveSend')}
            onPress={() => {
              void confirmSend();
            }}
            loading={busy}
            loadingLabel={t('screen.sendingLabel')}
            disabled={!online || body.trim() === '' || regenerating}
            flex
            accessibilityHint={t('screen.ctaHint')}
            testID="reply.approve"
          />
        </View>
      </View>
    );
  }

  return (
    <DetailScreen
      kicker={kicker}
      leading="close"
      onLeadingPress={close}
      trailing={
        draft === null ? undefined : (
          <IconButton
            icon="more_horiz"
            accessibilityLabel={tc('a11y.moreOptions')}
            onPress={more}
          />
        )
      }
      testID="reply.screen"
    >
      {content}
    </DetailScreen>
  );
}

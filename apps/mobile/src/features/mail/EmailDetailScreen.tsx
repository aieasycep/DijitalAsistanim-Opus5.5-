/**
 * M-MAIL-03 · Mail Detayı — AI summary first (M§15): sender, subject, date, AI summary and key
 * points, the four actions (Yanıt Hazırla / Görev Oluştur / Takvime Ekle / Hatırlat, each wired to
 * a real flow), attachments, the thread, and "Orijinal Mail" fetched on demand from
 * `GET /mail/:messageId/original` (sanitised by the server, memory-only query, never written to
 * the persisted cache or logged). Links inside the original go through the phishing-safe link
 * sheet. "···" holds the provider handoff ("Gmail'de / Outlook'ta Aç"), corrections and the
 * sender's VIP toggle (M-MAIL-04: Pro; Free → paywall; an offline change is queued, T-8.23). The
 * original's text offers "Kopyala" on long-press.
 */
import { isApiError, qk } from '@da/api-client';
import { callRoute, mailOriginalQueryOptions, useApiClient } from '@da/api-client/react';
import { formatFileSize } from '@da/i18n';
import {
  Accordion,
  ActionTile,
  ActionTileGrid,
  AiCard,
  Badge,
  Button,
  GroupedList,
  HintRow,
  IconButton,
  ListRow,
  MailDetailSkeleton,
  PressableScale,
  SectionHeader,
  SenderHeader,
  SourceLine,
  Spinner,
  Text,
  useTheme,
  useToast,
} from '@da/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { useFormats, useSessionContext } from '../../lib/data/session';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { mailProviderUrl, openWithOs } from '../actions/handoff';
import { useOpenPaywall } from '../actions/ProGate';
import { deadlineBlock, useProposals } from '../actions/proposals';
import { runOrQueue } from '../../lib/offline/mutations';
import { CopyableText } from '../actions/CopyableText';
import { vipListQueryOptions, type VipRow } from '../person/data';
import { openLink, openMenu, openReminder, openSource } from '../actions/sheets';
import { DetailScreen, QueryFailure, useBack, useOfflineGuard } from '../actions/ui';
import { openApprovalSheet } from '../approvals/InlineApprovalSheet';
import { emailDetailOptions, type EmailDetail } from './data';

/** "ahmet@example.com" → "a***@example.com" (source lines never show full foreign addresses). */
export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  if (domain === '') return email;
  return `${user.slice(0, 1)}***@${domain}`;
}

export interface OriginalLink {
  readonly href: string;
  readonly text: string;
}

/** Sanitised HTML → readable text plus its links (rendered separately, never auto-linked). */
export function originalToText(
  format: 'html_sanitized' | 'text',
  content: string,
): { readonly text: string; readonly links: readonly OriginalLink[] } {
  if (format === 'text') return { text: content, links: [] };
  const links: OriginalLink[] = [];
  const anchor = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (let match = anchor.exec(content); match !== null; match = anchor.exec(content)) {
    const href = match[1] ?? '';
    const text = (match[2] ?? '').replace(/<[^>]+>/g, '').trim();
    if (href !== '') links.push({ href, text: text === '' ? href : text });
  }
  const text = content
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, links };
}

type AiStatusBucket = 'pending' | 't0_final' | 'classified' | 'skipped' | 'failed';

function aiBucket(status: string): AiStatusBucket {
  if (status === 'failed') return 'failed';
  if (status === 't0_final') return 't0_final';
  if (status === 'classified') return 'classified';
  if (status.startsWith('skipped')) return 'skipped';
  return 'pending';
}

function OriginalMail({
  detail,
  expanded,
}: {
  readonly detail: EmailDetail;
  readonly expanded: boolean;
}) {
  const t = useTranslations('mail');
  const ts = useTranslations('states');
  const tc = useTranslations('common');
  const client = useApiClient();
  const online = useOnline();
  const router = useRouter();
  const query = useQuery({
    ...mailOriginalQueryOptions(client, detail.message.id),
    enabled: expanded && online,
  });
  const result = query.isSuccess ? 'ok' : query.isError ? 'error' : null;
  useEffect(() => {
    if (!expanded) return;
    if (!online) track('email_original_expand', { result: 'offline' });
    else if (result !== null) {
      const gone = isApiError(query.error) && query.error.code === 'SOURCE_GONE';
      track('email_original_expand', { result: gone ? 'gone' : result });
    }
  }, [expanded, online, result, query.error]);

  if (!online && query.data === undefined) {
    return <HintRow text={t('screen.original.offline')} />;
  }
  if (query.isPending) {
    return (
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Spinner size={14} />
        <Text variant="secondary" tone="secondary">
          {t('detail.loadingOriginal')}
        </Text>
      </View>
    );
  }
  if (query.isError) {
    const code = isApiError(query.error) ? query.error.code : null;
    if (code === 'SOURCE_GONE') {
      return (
        <Text variant="secondary" tone="secondary">
          {t('screen.original.gone', {
            provider:
              detail.message.provider === 'microsoft'
                ? tc('providers.outlook')
                : tc('providers.gmail'),
          })}
        </Text>
      );
    }
    if (code === 'DATA_SOURCE_DISABLED') {
      return (
        <View style={{ gap: 8 }}>
          <Text variant="secondary" tone="secondary">
            {t('screen.original.disabled')}
          </Text>
          {isScreenAvailable('/settings/privacy/data-sources') ? (
            <Button
              label={t('screen.settings')}
              variant="tonal"
              size="sm"
              onPress={() => {
                router.push('/settings/privacy/data-sources');
              }}
            />
          ) : null}
        </View>
      );
    }
    if (code === 'PROVIDER_REAUTH_REQUIRED') {
      return (
        <Text variant="secondary" tone="secondary">
          {ts('error.oauthExpired.title', {
            service:
              detail.message.provider === 'microsoft'
                ? tc('providers.outlook')
                : tc('providers.gmail'),
          })}
        </Text>
      );
    }
    return (
      <View style={{ gap: 8 }}>
        <Text variant="secondary" tone="secondary">
          {t('screen.original.failed')}
        </Text>
        <Button
          label={tc('actions.retry')}
          variant="tonal"
          size="sm"
          onPress={() => {
            void query.refetch();
          }}
        />
      </View>
    );
  }
  const body = originalToText(query.data.body.format, query.data.body.content);
  return (
    <View style={{ gap: 10 }} testID="email.original.body">
      <CopyableText text={body.text} variant="bodySm" testID="email.original.text" />
      {query.data.body.truncated ? (
        <Text variant="meta" tone="tertiaryStrong">
          {t('screen.original.truncated')}
        </Text>
      ) : null}
      {body.links.length === 0 ? null : (
        <View style={{ gap: 6 }}>
          <SectionHeader title={t('screen.original.links')} />
          {body.links.map((link, index) => (
            <Text
              key={`${link.href}-${String(index)}`}
              variant="bodySm"
              tone="link"
              accessibilityRole="link"
              accessibilityHint={t('screen.original.externalLink')}
              style={{ textDecorationLine: 'underline' }}
              onPress={() => {
                openLink({ href: link.href, anchorText: link.text, context: 'email' });
              }}
              testID="email.original.link"
            >
              {link.text}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

export function EmailDetailScreen() {
  const theme = useTheme();
  const t = useTranslations('mail');
  const tc = useTranslations('common');
  const router = useRouter();
  const toast = useToast();
  const client = useApiClient();
  const formats = useFormats();
  const session = useSessionContext();
  const blocked = useOfflineGuard();
  const openPaywall = useOpenPaywall();
  const back = useBack('/flow');
  const proposals = useProposals('email_detail');
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useQuery(emailDetailOptions(id));
  const queryClient = useQueryClient();
  const contactId = query.data?.contactId ?? null;
  // The sender's VIP state (M-MAIL-04), read from the cache when the menu opens.
  useQuery({ ...vipListQueryOptions(), enabled: contactId !== null });
  const senderIsVip = (): boolean =>
    contactId !== null &&
    (queryClient.getQueryData<readonly VipRow[]>(vipListQueryOptions().queryKey) ?? []).some(
      (v) => v.contactId === contactId,
    );
  const [originalOpen, setOriginalOpen] = useState(false);
  const [threadOpen, setThreadOpen] = useState(false);
  const detail = query.data;

  const bucket = detail === undefined ? null : aiBucket(detail.message.aiStatus);
  const category = detail?.message.category ?? null;
  const hasDraft = detail?.draftId !== null && detail !== undefined;
  useEffect(() => {
    if (bucket === null) return;
    track('email_detail_view', {
      ...(category === null ? {} : { category }),
      ai_status: bucket,
      has_draft: hasDraft,
    });
  }, [bucket, category, hasDraft]);

  if (detail === undefined) {
    return (
      <DetailScreen onLeadingPress={back} testID="email.screen">
        {query.isError ? (
          <QueryFailure
            screen={t('screen.detailTitle')}
            error={query.error}
            onRetry={() => {
              void query.refetch();
            }}
            notFound={{ backLabel: t('screen.backToFlow'), onBack: back }}
            testID="email"
          />
        ) : (
          <MailDetailSkeleton accessibilityLabel={tc('a11y.loading')} testID="email.loading" />
        )}
      </DetailScreen>
    );
  }

  const { message, thread } = detail;
  const account = session.accounts.find((a) => a.id === message.accountId);
  const providerName =
    message.provider === 'microsoft' ? tc('providers.outlook') : tc('providers.gmail');
  const recipients = message.to.length + message.cc.length;
  const whenLabel =
    formats.relativeDay(message.receivedAt) === 'today'
      ? `${tc('time.today')} ${formats.time(message.receivedAt)}`
      : `${formats.dayMonth(message.receivedAt)} ${formats.time(message.receivedAt)}`;
  const deadline = thread?.deadlineAt ?? null;
  const badge =
    thread?.urgency === 'urgent'
      ? { label: tc('badges.urgent'), category: 'urgent' as const }
      : deadline !== null
        ? { label: tc('badges.deadline'), category: 'deadline' as const }
        : null;
  const source = {
    source_type: 'email_message' as const,
    source_id: message.id,
    source_provider: (message.provider === 'microsoft'
      ? 'microsoft'
      : message.provider === 'demo'
        ? 'demo'
        : 'google') as 'google',
    source_timestamp: message.receivedAt,
  };
  const handoff = mailProviderUrl({
    provider: message.provider,
    webLink: thread?.webLink ?? message.webLink,
    accountEmail: account?.account_email ?? null,
    providerThreadId: thread?.providerThreadId ?? null,
  });

  const reply = () => {
    track('email_action', { action: 'reply' });
    if (blocked('reply')) return;
    const tone = 'professional';
    router.push(
      detail.draftId === null
        ? `/mail/${message.id}/reply?tone=${tone}&mode=reply&origin=mail`
        : `/mail/${message.id}/reply?draftId=${detail.draftId}&origin=mail`,
    );
  };

  const task = () => {
    track('email_action', { action: 'task' });
    proposals.proposeTask({
      title: message.subject ?? message.summary ?? providerName,
      dueAt: deadline,
      origin: 'email_detail',
      originRefId: message.id,
      source,
      invalidate: [qk.mail.message(message.id)],
    });
  };

  const calendar = async () => {
    track('email_action', { action: 'calendar' });
    if (deadline !== null) {
      const block = deadlineBlock(deadline, now().getTime());
      await proposals.proposeEvent({
        title: message.subject ?? providerName,
        start: block.start,
        end: block.end,
        origin: 'email_detail',
        originRef: null,
        originRefId: message.id,
        source,
        invalidate: [qk.mail.message(message.id)],
      });
      return;
    }
    // No grounded time: the deterministic slot finder proposes a real free slot (Pro).
    if (!session.isPro) {
      openPaywall('advanced_planning');
      return;
    }
    if (blocked('approve')) return;
    try {
      const from = now().getTime() + 15 * 60_000;
      const proposal = await callRoute(client, 'POST /plan/proposals', {
        body: {
          item: { type: 'email_message', id: message.id },
          title: (message.subject ?? providerName).slice(0, 300),
          duration_minutes: 30,
          window: {
            from: new Date(from).toISOString(),
            to: new Date(from + 7 * 86_400_000).toISOString(),
          },
        },
      });
      openApprovalSheet({
        approval: proposal.approval,
        origin: 'email_detail',
        invalidate: [qk.mail.message(message.id), qk.plan.all],
      });
    } catch (error) {
      toast.show({
        message:
          isApiError(error) && error.code === 'STATE_CONFLICT'
            ? t('screen.noSlot')
            : t('screen.proposalFailed'),
        kind: 'error',
      });
    }
  };

  const remind = () => {
    track('email_action', { action: 'remind' });
    openReminder({
      title: message.subject ?? providerName,
      origin: 'email_detail',
      anchorAt: deadline,
      subject: { type: 'email_message', id: message.id },
    });
  };

  const toggleVip = (sender: string) => {
    if (contactId === null) return;
    if (!session.isPro) {
      openPaywall('vip');
      return;
    }
    const on = !senderIsVip();
    track('vip_toggle', { on });
    const key = vipListQueryOptions().queryKey;
    const previous = queryClient.getQueryData<readonly VipRow[]>(key);
    queryClient.setQueryData<readonly VipRow[]>(key, (rows = []) =>
      on
        ? [
            {
              id: `pending:${contactId}`,
              contactId,
              name: sender,
              email: message.fromEmail,
              organization: null,
              relationship: 'other',
              alwaysNotify: true,
              bypassQuietHours: true,
              origin: 'user',
              createdAt: new Date().toISOString(),
            },
            ...rows,
          ]
        : rows.filter((v) => v.contactId !== contactId),
    );
    void runOrQueue('vip_set', { contactId, on }).then((result) => {
      if (result.status === 'failed') {
        queryClient.setQueryData(key, previous);
        toast.show({ message: tc('toast.saveFailed'), kind: 'error' });
        return;
      }
      toast.show(
        result.status === 'queued'
          ? { message: t('screen.vipQueued'), kind: 'offline' }
          : on
            ? { message: tc('toast.vipAdded', { name: sender }), kind: 'success', icon: 'star' }
            : { message: t('screen.vipRemoved'), kind: 'success' },
      );
    });
  };

  const more = () => {
    const sender = message.fromName ?? message.fromEmail;
    const isVip = senderIsVip();
    openMenu({
      options: [
        ...(handoff === null
          ? []
          : [
              {
                key: 'handoff',
                label:
                  message.provider === 'microsoft'
                    ? t('screen.openOutlook')
                    : t('screen.openGmail'),
                icon: 'open_in_new' as const,
                onPress: () => {
                  track('email_provider_handoff', {
                    provider: message.provider === 'microsoft' ? 'microsoft' : 'google',
                  });
                  void openWithOs(handoff).then((ok) => {
                    if (!ok) toast.show({ message: t('link.failed'), kind: 'error' });
                  });
                },
              },
            ]),
        {
          key: 'why',
          label: tc('actions.viewSource'),
          icon: 'info' as const,
          onPress: () => {
            openSource({
              targetType: 'email_message',
              targetId: message.id,
              origin: 'email_detail',
            });
          },
        },
        ...(detail.contactId !== null && isScreenAvailable(`/person/${detail.contactId}`)
          ? [
              {
                key: 'person',
                label: t('screen.viewSender'),
                icon: 'person' as const,
                onPress: () => {
                  router.push(`/person/${detail.contactId ?? ''}` as Href);
                },
              },
            ]
          : []),
        ...(contactId === null
          ? []
          : [
              {
                key: 'vip',
                label: isVip ? t('screen.removeVip') : t('screen.makeVip'),
                icon: isVip ? ('person_remove' as const) : ('star' as const),
                onPress: () => {
                  toggleVip(sender);
                },
              },
            ]),
        ...(isScreenAvailable('/settings/priority-rules/new')
          ? [
              {
                key: 'rule',
                label: t('screen.createRule'),
                icon: 'tune' as const,
                onPress: () => {
                  track('rule_create_start', { origin: 'mail' });
                  router.push(
                    `/settings/priority-rules/new?type=sender_important&value=${encodeURIComponent(message.fromEmail)}` as Href,
                  );
                },
              },
            ]
          : []),
      ],
    });
  };

  const status = message.aiStatus;
  const analyzing =
    status === 'pending_t0' || status === 'queued_realtime' || status === 'queued_batch';
  const ruleSkipped = status === 't0_final' && message.tier === 'explicit_rule';

  return (
    <DetailScreen
      onLeadingPress={back}
      onRefresh={() => query.refetch()}
      updatedAt={query.dataUpdatedAt}
      trailing={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {badge === null ? null : (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t('screen.badgeA11y', { badge: badge.label })}
              onPress={() => {
                openSource({
                  targetType: 'email_message',
                  targetId: message.id,
                  origin: 'email_detail',
                });
              }}
              visualSize={{ width: 64, height: 24 }}
              testID="email.badge"
            >
              <Badge label={badge.label} category={badge.category} size="header" />
            </PressableScale>
          )}
          <IconButton
            icon="more_horiz"
            accessibilityLabel={tc('a11y.moreOptions')}
            onPress={more}
            testID="email.more"
          />
        </View>
      }
      testID="email.screen"
    >
      <SenderHeader
        name={message.fromName ?? message.fromEmail}
        id={detail.contactId ?? message.fromEmail}
        meta={[
          whenLabel,
          providerName,
          recipients <= 1 ? t('screen.toYou') : t('screen.toYouAnd', { count: recipients - 1 }),
        ].join(' · ')}
      />
      <Text variant="h2" heading testID="email.subject">
        {message.subject ?? t('screen.noSubject')}
      </Text>

      {message.injectionSuspected ? <HintRow text={t('screen.injection')} /> : null}
      {ruleSkipped ? (
        <HintRow text={t('screen.ruleSkipped')} />
      ) : status === 'skipped_budget' ? (
        <View style={{ gap: 8 }}>
          <HintRow text={t('screen.budgetSkipped')} />
          {session.isPro ? null : (
            <Button
              label={tc('actions.seePro')}
              variant="tonal"
              size="sm"
              onPress={() => {
                openPaywall('advanced_planning');
              }}
            />
          )}
        </View>
      ) : status === 'skipped_source_control' ? (
        <HintRow text={t('screen.sourceSkipped')} />
      ) : status === 'failed' ? (
        <AiCard
          kicker={t('detail.summary')}
          title={t('screen.summaryFailed')}
          testID="email.ai.failed"
        />
      ) : analyzing ? (
        <AiCard
          kicker={t('screen.analyzing')}
          title={message.subject ?? t('screen.noSubject')}
          state="loading"
          testID="email.ai.loading"
        />
      ) : message.summary === null ? null : (
        <AiCard
          kicker={t('detail.summary')}
          title={message.summary}
          {...(message.keyPoints.length === 0 || message.injectionSuspected
            ? {}
            : { bullets: message.keyPoints.map((k) => k.text) })}
          testID="email.ai"
        />
      )}

      <View style={{ gap: 8 }}>
        <SectionHeader title={t('screen.actions')} />
        <ActionTileGrid>
          <ActionTile
            label={detail.draftId === null ? tc('actions.prepareReply') : t('screen.continueDraft')}
            icon="send"
            primary
            onPress={reply}
            testID="email.tile.reply"
          />
          <ActionTile
            label={t('detail.createTask')}
            icon="add_task"
            onPress={task}
            loading={proposals.pending}
            testID="email.tile.task"
          />
          <ActionTile
            label={tc('actions.addToCalendar')}
            icon="event"
            onPress={() => {
              void calendar();
            }}
            testID="email.tile.calendar"
          />
          <ActionTile
            label={tc('actions.remind')}
            icon="notifications"
            onPress={remind}
            testID="email.tile.remind"
          />
        </ActionTileGrid>
      </View>

      {message.attachments.length === 0 ? null : (
        <View style={{ gap: 8 }}>
          <SectionHeader
            title={t('screen.attachments')}
            count={String(message.attachments.length)}
          />
          <GroupedList>
            {message.attachments.map((a, index) => (
              <ListRow
                key={`${a.name}-${String(index)}`}
                title={a.name}
                {...(a.size === undefined
                  ? {}
                  : { subtitle: formatFileSize(a.size, formats.locale) })}
                icon="attach_file"
              />
            ))}
          </GroupedList>
        </View>
      )}

      {detail.siblings.length === 0 ? null : (
        <Accordion
          title={t('screen.thread', { count: detail.siblings.length + 1 })}
          icon="forum"
          expanded={threadOpen}
          onToggle={() => {
            setThreadOpen((open) => !open);
          }}
          testID="email.thread"
        >
          <GroupedList>
            {detail.siblings.map((s) => (
              <ListRow
                key={s.id}
                title={s.fromName ?? s.fromEmail}
                subtitle={`${formats.dayMonth(s.receivedAt)} ${formats.time(s.receivedAt)} · ${s.summary ?? s.subject ?? ''}`}
                trailing={{ kind: 'chevron' }}
                density="twoLine"
                onPress={() => {
                  track('email_thread_open');
                  router.push(`/mail/${s.id}` as Href);
                }}
              />
            ))}
          </GroupedList>
        </Accordion>
      )}

      <Accordion
        title={t('detail.original')}
        icon="mail"
        expanded={originalOpen || status === 'failed'}
        onToggle={() => {
          setOriginalOpen((open) => !open);
        }}
        testID="email.original"
      >
        <OriginalMail detail={detail} expanded={originalOpen || status === 'failed'} />
      </Accordion>

      <SourceLine
        icon="verified"
        variant="verified"
        parts={[
          t('screen.sourcePrefix', { provider: providerName }),
          maskEmail(message.fromEmail),
          t('screen.thread', { count: detail.siblings.length + 1 }),
        ]}
        onPress={() => {
          openSource({ targetType: 'email_message', targetId: message.id, origin: 'email_detail' });
        }}
        accessibilityHint={tc('actions.viewSource')}
        style={{ marginTop: theme.space[2] }}
      />
    </DetailScreen>
  );
}

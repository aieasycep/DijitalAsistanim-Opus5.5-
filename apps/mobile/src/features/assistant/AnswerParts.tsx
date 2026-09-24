/**
 * The parts of a grounded answer (M-ASST-02 anatomy, SREQ-29): source rows built from `citation`
 * events ("KAYNAKLAR"), rich cards from `card` events (lists, event, mail, person, life), pending
 * approval cards from `action_proposal` (M-ASST-03) and follow-up chips. Rows open the real screen
 * of the source when it exists in this build (R-24); otherwise they are shown as plain text.
 */
import { formatRelativeDay, toUpper } from '@da/i18n';
import {
  ChipWrap,
  FollowUpChip,
  RichAnswerCard,
  Text,
  type IconName,
  type RichAnswerRow,
} from '@da/ui';
import type { AssistantRichCardV1 } from '@da/validation/ai/assistant';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { track } from '../../lib/events';
import { routeForDeepLink, routeForSource } from '../today/sources';
import { useLang, userTimeZone } from '../common/DateTimeFields';
import { ApprovalItem } from '../approvals/ApprovalItem';
import type { ApprovedVia } from '../approvals/api';
import type { ApprovalModel } from '../approvals/model';
import type { Citation } from './data';

const SOURCE_ICONS: Readonly<Record<string, IconName>> = {
  email_message: 'mail',
  email_thread: 'mail',
  calendar_event: 'event',
  device_calendar_event: 'event',
  commitment: 'handshake',
  life_event: 'flight',
  capture: 'description',
  meeting_note: 'edit_note',
  contact: 'person',
  task: 'task_alt',
};

const SOURCE_TYPES = new Set([
  'email_message',
  'email_thread',
  'calendar_event',
  'device_calendar_event',
  'task',
  'capture',
  'meeting_note',
  'post_meeting_note',
  'android_notification',
  'assistant_message',
  'user_input',
  'commitment',
  'life_event',
  'contact',
]);

function citationRoute(citation: Citation): string | null {
  if (citation.route !== null) {
    const direct = routeForDeepLink(citation.route);
    if (direct !== null) return direct;
  }
  if (citation.sourceType === 'contact' && citation.sourceId !== null) {
    return routeForDeepLink(`/person/${citation.sourceId}`);
  }
  return routeForSource(citation.sourceType, citation.sourceId);
}

interface PlainRow {
  readonly key: string;
  readonly title: string;
  readonly meta?: string;
}

function Rows({
  kicker,
  rows,
  plain,
  testID,
}: {
  readonly kicker: string;
  readonly rows: readonly RichAnswerRow[];
  readonly plain: readonly PlainRow[];
  readonly testID: string;
}) {
  if (rows.length === 0 && plain.length === 0) return null;
  return (
    <View style={styles.block} testID={testID}>
      {rows.length > 0 ? <RichAnswerCard kicker={kicker} rows={rows} /> : null}
      {rows.length === 0 && plain.length > 0 ? (
        <Text variant="kicker" tone="tertiaryStrong">
          {kicker}
        </Text>
      ) : null}
      {plain.map((row) => (
        <Text key={row.key} variant="bodyXs" tone="secondary">
          {row.meta === undefined ? row.title : `${row.title} · ${row.meta}`}
        </Text>
      ))}
    </View>
  );
}

export interface AnswerPartsProps {
  readonly citations: readonly Citation[];
  readonly cards: readonly AssistantRichCardV1[];
  readonly approvals: readonly ApprovalModel[];
  readonly followups?: readonly string[];
  readonly onFollowup?: (text: string) => void;
  readonly via: ApprovedVia;
  readonly variant?: 'full' | 'compact';
  readonly rejectReason?: 'user_reject' | 'user_cancel';
  readonly approvalHint?: string;
  readonly onEditApproval?: (model: ApprovalModel) => void;
  readonly testID?: string;
}

export function AnswerParts({
  citations,
  cards,
  approvals,
  followups = [],
  onFollowup,
  via,
  variant = 'full',
  rejectReason = 'user_reject',
  approvalHint,
  onEditApproval,
  testID = 'answer',
}: AnswerPartsProps) {
  const t = useTranslations('assistant');
  const common = useTranslations('common');
  const router = useRouter();
  const lang = useLang();
  const tz = userTimeZone();
  const when = (iso: string | null) =>
    iso === null
      ? undefined
      : formatRelativeDay(iso, { locale: lang, now: now().getTime(), timeZone: tz });

  const sourceRows: RichAnswerRow[] = [];
  const sourcePlain: PlainRow[] = [];
  for (const citation of citations) {
    const route = citationRoute(citation);
    const meta = [
      SOURCE_TYPES.has(citation.sourceType)
        ? common(`sourceTypes.${citation.sourceType as 'email_message'}`)
        : '',
      when(citation.timestamp) ?? '',
    ]
      .filter((p) => p !== '')
      .join(' · ');
    if (route === null) {
      sourcePlain.push({ key: `c${String(citation.index)}`, title: citation.title, meta });
      continue;
    }
    sourceRows.push({
      key: `c${String(citation.index)}`,
      title: citation.title,
      meta,
      icon: SOURCE_ICONS[citation.sourceType] ?? 'article',
      onPress: () => {
        track('assistant_source_opened', { source_type: citation.sourceType });
        router.push(route);
      },
    });
  }

  const cardBlocks = cards.map((card, index) => {
    const key = `card-${String(index)}`;
    const open = (route: string) => {
      const target = routeForDeepLink(route);
      return target === null
        ? null
        : () => {
            router.push(target);
          };
    };
    if (card.type === 'list') {
      const rows: RichAnswerRow[] = [];
      const plain: PlainRow[] = [];
      for (const item of card.data.items) {
        const onPress = open(item.route);
        const row = {
          key: `${key}-${item.entity_id}`,
          title: item.title,
          ...(item.meta === null ? {} : { meta: item.meta }),
        };
        if (onPress === null) plain.push(row);
        else
          rows.push({
            ...row,
            ...(item.badge === null ? {} : { badge: { label: item.badge } }),
            ...(card.data.kind === 'person_choice'
              ? { person: { name: item.title, id: item.entity_id } }
              : { icon: 'chevron_right' }),
            onPress,
          });
      }
      return (
        <Rows
          key={key}
          kicker={toUpper(card.data.title, lang)}
          rows={rows}
          plain={plain}
          testID={`${testID}.card.${String(index)}`}
        />
      );
    }
    const onPress = open(card.route);
    const single: PlainRow =
      card.type === 'event'
        ? { key, title: card.data.title, meta: card.data.time_label }
        : card.type === 'mail'
          ? {
              key,
              title: card.data.subject,
              meta: `${card.data.sender_label} · ${card.data.time_label}`,
            }
          : card.type === 'person'
            ? {
                key,
                title: card.data.name,
                ...(card.data.last_contact_label === null
                  ? {}
                  : { meta: card.data.last_contact_label }),
              }
            : {
                key,
                title: card.data.key_fact,
                ...(card.data.time_label === null ? {} : { meta: card.data.time_label }),
              };
    const kicker =
      card.type === 'event'
        ? t('cards.event')
        : card.type === 'mail'
          ? t('cards.mail')
          : card.type === 'person'
            ? t('cards.person')
            : t('cards.life');
    return (
      <Rows
        key={key}
        kicker={toUpper(kicker, lang)}
        rows={
          onPress === null
            ? []
            : [
                {
                  ...single,
                  ...(card.type === 'person'
                    ? { person: { name: card.data.name, id: card.data.contact_id } }
                    : {
                        icon:
                          card.type === 'event'
                            ? 'event'
                            : card.type === 'mail'
                              ? 'mail'
                              : 'flight',
                      }),
                  onPress,
                },
              ]
        }
        plain={onPress === null ? [single] : []}
        testID={`${testID}.card.${String(index)}`}
      />
    );
  });

  return (
    <View style={styles.root}>
      <Rows
        kicker={toUpper(t('thread.sources'), lang)}
        rows={sourceRows}
        plain={sourcePlain}
        testID={`${testID}.sources`}
      />
      {cardBlocks}
      {approvals.map((model) => (
        <ApprovalItem
          key={model.id}
          model={model}
          via={via}
          variant={variant}
          rejectReason={rejectReason}
          detailsLink
          {...(approvalHint === undefined ? {} : { hint: approvalHint })}
          {...(onEditApproval === undefined ? {} : { onEdit: onEditApproval })}
          testID={`${testID}.approval.${model.id}`}
        />
      ))}
      {followups.length > 0 && onFollowup !== undefined ? (
        <ChipWrap>
          {followups.map((text) => (
            <FollowUpChip
              key={text}
              label={text}
              onPress={() => {
                onFollowup(text);
              }}
            />
          ))}
        </ChipWrap>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  block: { gap: 6 },
});

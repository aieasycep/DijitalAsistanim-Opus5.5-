/**
 * M-MEET-01 · Toplantıya Hazırlan: the person, time and a live countdown, the purpose, previous
 * communication, recent mails, open loops, both sides' commitments, real files only, up to 3
 * sourced talking points and the "2 Dakikalık Özet". The prep comes from
 * `POST /meetings/:eventId/prep` (R-23: a precomputed prep answers at once; otherwise it is
 * generated on open and polled every 2 s up to 60 s, then shown as failed with "Tekrar Dene").
 * Every row opens its real source; the meeting link is an allow-listed external handoff. Pro
 * (402 → gate); the header and person row render from the calendar event meanwhile.
 */
import { isApiError, qk } from '@da/api-client';
import { apiMutationOptions, meetingPrepQueryOptions, useApiClient } from '@da/api-client/react';
import {
  Avatar,
  Button,
  CountdownPill,
  ErrorCard,
  GroupedList,
  HintRow,
  IconButton,
  ListRow,
  NotFoundState,
  PressableScale,
  SectionKicker,
  SkeletonBlock,
  TalkingPointsCard,
  Text,
  useTheme,
  useToast,
} from '@da/ui';
import type { MeetingPrepView } from '@da/validation/api/meetings';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { useFormats, useSessionContext } from '../../lib/data/session';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { isJoinableMeetingUrl, openWithOs } from '../actions/handoff';
import { ProGate } from '../actions/ProGate';
import { openMenu } from '../actions/sheets';
import { DetailScreen, QueryFailure, useBack, useOfflineGuard } from '../actions/ui';
import {
  eventOptions,
  minutesToStartBucket,
  notesOptions,
  prepSourcePath,
  PREP_POLL_MS,
  PREP_SLOW_MS,
  PREP_TIMEOUT_MS,
  type CalendarEventDetail,
  type PrepSourceRef,
} from './data';
import { openNoteSheet } from './NoteSheet';
import { useNow } from './useNow';

type PrepOrigin =
  'push' | 'today' | 'flow' | 'plan' | 'person' | 'widget' | 'assistant' | 'deeplink';
const PREP_ORIGINS: readonly PrepOrigin[] = [
  'push',
  'today',
  'flow',
  'plan',
  'person',
  'widget',
  'assistant',
  'deeplink',
];
type Section =
  | 'purpose'
  | 'last_interaction'
  | 'emails'
  | 'open_loops'
  | 'commitments'
  | 'files'
  | 'talking_points';

export function conferenceProvider(url: string): 'meet' | 'teams' | 'zoom' {
  const host = new URL(url).hostname.toLowerCase();
  if (host === 'meet.google.com') return 'meet';
  if (host.startsWith('teams.')) return 'teams';
  return 'zoom';
}

function Block({
  title,
  children,
  testID,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  return (
    <View style={{ gap: 8 }} {...(testID === undefined ? {} : { testID })}>
      <SectionKicker title={title} />
      {children}
    </View>
  );
}

function PersonRow({
  event,
  prep,
}: {
  readonly event: CalendarEventDetail | undefined;
  readonly prep: MeetingPrepView | undefined;
}) {
  const t = useTranslations('meeting.prepScreen');
  const theme = useTheme();
  const router = useRouter();
  const formats = useFormats();
  const others = (event?.attendees ?? []).filter((a) => a.is_self !== true);
  const person = prep?.people[0];
  const name =
    person?.name ?? others[0]?.name ?? others[0]?.email ?? event?.title ?? prep?.event.title ?? '';
  const start = prep?.event.start ?? event?.startAt;
  const end = prep?.event.end ?? event?.endAt;
  const extra = Math.max(0, (prep?.people.length ?? others.length) - 1);
  const meta = [
    event?.title ?? prep?.event.title ?? null,
    start === undefined ? null : formats.time(start),
    start === undefined || end === undefined
      ? null
      : formats.duration(Math.round((Date.parse(end) - Date.parse(start)) / 60_000)),
    prep?.event.location ?? event?.location ?? null,
  ].filter((p): p is string => p !== null && p !== '');
  const contactId = person?.contact_id ?? others[0]?.contact_id ?? null;
  const path = contactId === null ? null : `/person/${contactId}`;
  const pressable = path !== null && isScreenAvailable(path);
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <Avatar name={name} {...(contactId === null ? {} : { id: contactId })} size={56} decorative />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="titleMd" heading numberOfLines={2}>
          {extra > 0 ? t('personAndOthers', { name, count: extra }) : name}
        </Text>
        <Text variant="secondary" tone="secondary" numberOfLines={2}>
          {meta.join(' · ')}
        </Text>
        {person?.role_text === null || person?.role_text === undefined ? null : (
          <Text variant="meta" tone="secondary">
            {person.role_text}
          </Text>
        )}
      </View>
    </View>
  );
  if (!pressable) return <View testID="prep.person">{body}</View>;
  return (
    <PressableScale
      feedback="card"
      onPress={() => {
        router.push(path);
      }}
      accessibilityRole="button"
      accessibilityLabel={name}
      style={{ padding: 4, borderRadius: theme.radius.button }}
      testID="prep.person"
    >
      {body}
    </PressableScale>
  );
}

export function MeetingPrepScreen() {
  const t = useTranslations('meeting.prepScreen');
  const tc = useTranslations('common');
  const router = useRouter();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const toast = useToast();
  const formats = useFormats();
  const session = useSessionContext();
  const online = useOnline();
  const blocked = useOfflineGuard();
  const params = useLocalSearchParams<{ eventId: string; origin?: string; src?: string }>();
  const eventId = params.eventId;
  const origin: PrepOrigin =
    PREP_ORIGINS.find((o) => o === (params.origin ?? params.src)) ?? 'deeplink';
  const back = useBack('/plan');
  const tick = useNow();
  const [openedAt, setOpenedAt] = useState(() => now().getTime());
  const event = useQuery(eventOptions(eventId));
  const notes = useQuery({ ...notesOptions(eventId), enabled: session.isPro });
  const prep = useQuery({
    ...meetingPrepQueryOptions(client, eventId),
    enabled: session.isPro,
    refetchInterval: (query) =>
      query.state.data?.prep.status === 'generating' &&
      query.state.dataUpdatedAt - openedAt < PREP_TIMEOUT_MS
        ? PREP_POLL_MS
        : false,
  });
  const refresh = useMutation(apiMutationOptions(client, 'POST /meetings/:eventId/prep'));
  const view = prep.data?.prep;
  const elapsed = prep.dataUpdatedAt - openedAt;
  const generating = view?.status === 'generating';
  const timedOut = generating && elapsed >= PREP_TIMEOUT_MS;
  const failed = view?.status === 'failed' || timedOut;
  const ready = view?.status === 'ready';

  const startIso = view?.event.start ?? event.data?.startAt;
  const endIso = view?.event.end ?? event.data?.endAt;
  const startMs = startIso === undefined ? null : Date.parse(startIso);
  const endMs = endIso === undefined ? null : Date.parse(endIso);
  const ended = endMs !== null && tick >= endMs;
  const cancelled = event.data?.status === 'cancelled';

  const known = startMs !== null && endMs !== null;
  useEffect(() => {
    if (!known) return;
    track('meeting_prep_opened', {
      origin,
      minutes_to_start_bucket: minutesToStartBucket(startMs, endMs, now().getTime()),
    });
    // Once per screen visit, when the meeting time is first known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [known]);

  const regenerate = () => {
    if (blocked('assistant')) return;
    refresh.mutate(
      { input: { params: { eventId }, body: { refresh: true } } },
      {
        onSuccess: (result) => {
          track('meeting_prep_refreshed');
          setOpenedAt(now().getTime());
          queryClient.setQueryData(qk.meetings.prep(eventId), result);
        },
        onError: (error) => {
          toast.show({
            message:
              isApiError(error) && error.code === 'RATE_LIMITED'
                ? t('refreshLimited')
                : t('refreshFailed'),
            kind: 'error',
          });
        },
      },
    );
  };

  const openSourceRef = (section: Section, ref: PrepSourceRef) => {
    const path = prepSourcePath(ref, isScreenAvailable);
    if (path === null) return;
    track('meeting_prep_source_opened', { section });
    router.push(path);
  };

  const joinUrl = view?.event.join_url ?? event.data?.conferenceUrl ?? null;
  const title = view?.event.title ?? event.data?.title ?? '';
  const noteSubtitle = [title, startIso === undefined ? null : formats.time(startIso)]
    .filter((p): p is string => p !== null && p !== '')
    .join(' · ');
  const takeNote = () => {
    openNoteSheet({ eventId, subtitle: noteSubtitle, origin: 'prep' });
  };

  if (event.isError && isApiError(event.error) && event.error.code === 'NOT_FOUND') {
    return (
      <DetailScreen onLeadingPress={back} testID="prep.screen">
        <NotFoundState
          variant="entity"
          title={t('eventGone')}
          backAction={{ label: tc('actions.goBack'), onPress: back }}
          testID="prep.notFound"
        />
      </DetailScreen>
    );
  }

  const points = (view?.talking_points ?? []).map((p, i) => ({ key: String(i), title: p.text }));
  const emailsCount = view?.recent_emails.length ?? 0;
  const notesCount = notes.data?.length ?? 0;

  return (
    <DetailScreen
      kicker={t('kicker')}
      onLeadingPress={back}
      onRefresh={() => Promise.all([event.refetch(), prep.refetch(), notes.refetch()])}
      updatedAt={prep.dataUpdatedAt}
      trailing={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {startMs === null ? null : (
            <View accessibilityLiveRegion="polite">
              <CountdownPill
                startsAt={startMs}
                format={(minutes) => t('countdown', { minutes })}
                startedLabel={ended ? t('ended') : t('started')}
                testID="prep.countdown"
              />
            </View>
          )}
          <IconButton
            icon="more_horiz"
            variant="plain"
            accessibilityLabel={tc('a11y.moreOptions')}
            onPress={() => {
              openMenu({
                options: [
                  {
                    key: 'details',
                    label: t('eventDetails'),
                    icon: 'event',
                    onPress: () => {
                      router.push(`/event/${eventId}?origin=deeplink` as Href);
                    },
                  },
                ],
              });
            }}
            testID="prep.more"
          />
        </View>
      }
      {...(session.isPro
        ? {
            footer: (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {ended && !cancelled ? (
                  <Button
                    label={t('postMeeting')}
                    onPress={() => {
                      router.push(`/meeting/${eventId}/post?origin=prep` as Href);
                    }}
                    flex
                    testID="prep.post"
                  />
                ) : (
                  <Button
                    label={t('readSummary')}
                    icon="headphones"
                    onPress={() => {
                      router.push(`/meeting/${eventId}/summary` as Href);
                    }}
                    disabled={!ready}
                    flex
                    testID="prep.summary"
                  />
                )}
                <Button
                  label={t('takeNote')}
                  variant="tonal"
                  onPress={takeNote}
                  testID="prep.note"
                />
              </View>
            ),
          }
        : {})}
      testID="prep.screen"
    >
      <PersonRow event={event.data} prep={view} />
      {isJoinableMeetingUrl(joinUrl) && !ended && !cancelled ? (
        <Button
          label={t(`join.${conferenceProvider(joinUrl)}`)}
          icon="videocam"
          variant="tonal"
          onPress={() => {
            track('external_handoff', { target: 'meeting_link' });
            void openWithOs(joinUrl);
          }}
          accessibilityHint={t('opensOutside')}
          fullWidth
          testID="prep.join"
        />
      ) : null}
      {cancelled ? (
        <ErrorCard
          icon="event_busy"
          tone="warning"
          title={t('cancelled')}
          primaryAction={{
            label: t('backToPlan'),
            onPress: () => {
              router.replace('/plan');
            },
          }}
          testID="prep.cancelled"
        />
      ) : null}

      {!session.isPro ? (
        <ProGate
          feature="meeting_prep"
          kicker={t('gateKicker')}
          title={t('gateTitle')}
          body={t('gateBody')}
          surface="card"
        />
      ) : prep.isError ? (
        isApiError(prep.error) && prep.error.code === 'ENTITLEMENT_REQUIRED' ? (
          <ProGate
            feature="meeting_prep"
            kicker={t('gateKicker')}
            title={t('gateTitle')}
            body={t('gateBody')}
            surface="card"
          />
        ) : isApiError(prep.error) && prep.error.code === 'QUOTA_EXCEEDED' ? (
          <ErrorCard icon="hourglass_top" tone="warning" title={t('aiLimit')} testID="prep.limit" />
        ) : (
          <QueryFailure
            screen={t('kicker')}
            error={prep.error}
            onRetry={() => {
              void prep.refetch();
            }}
            testID="prep"
          />
        )
      ) : failed ? (
        <ErrorCard
          icon="error"
          tone="critical"
          title={t('failedTitle')}
          body={t('failedBody')}
          primaryAction={{
            label: tc('actions.retry'),
            onPress: regenerate,
            loading: refresh.isPending,
          }}
          testID="prep.failed"
        />
      ) : view === undefined || generating ? (
        <View style={{ gap: 14 }} testID="prep.generating">
          <TalkingPointsCard kicker={t('generating')} points={[]} loading />
          {generating && elapsed > PREP_SLOW_MS ? <HintRow text={t('slow')} /> : null}
          {!online && view === undefined ? <HintRow text={t('offlineNoPrep')} /> : null}
          <SkeletonBlock height={72} />
          <SkeletonBlock height={72} />
          <SkeletonBlock height={72} />
        </View>
      ) : (
        <PrepBody
          view={view}
          notes={notes.data ?? []}
          points={points}
          onSource={openSourceRef}
          onNote={takeNote}
        />
      )}

      {session.isPro && ready ? (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
          testID="prep.provenance"
        >
          <Text variant="meta" tone="secondary" style={{ flex: 1 }}>
            {view.generated_at === null
              ? t('provenanceShort', { emails: emailsCount, notes: notesCount })
              : t('provenance', {
                  emails: emailsCount,
                  notes: notesCount,
                  time: formats.time(view.generated_at),
                })}
          </Text>
          <Button
            label={tc('actions.refresh')}
            variant="text"
            size="ghost"
            onPress={regenerate}
            loading={refresh.isPending}
            testID="prep.refresh"
          />
        </View>
      ) : null}
    </DetailScreen>
  );
}

function PrepBody({
  view,
  notes,
  points,
  onSource,
  onNote,
}: {
  readonly view: MeetingPrepView;
  readonly notes: readonly {
    readonly id: string;
    readonly body: string;
    readonly createdAt: string;
  }[];
  readonly points: readonly { readonly key: string; readonly title: string }[];
  readonly onSource: (section: Section, ref: PrepSourceRef) => void;
  readonly onNote: () => void;
}) {
  const t = useTranslations('meeting.prepScreen');
  const router = useRouter();
  const formats = useFormats();
  const openPointSources = (key: string) => {
    const point = view.talking_points[Number(key)];
    if (point === undefined) return;
    openMenu({
      title: t('pointSources'),
      options: point.sources.map((source, i) => ({
        key: String(i),
        label: source.label ?? formats.dayMonth(source.source_timestamp),
        icon:
          source.source_type === 'email_message'
            ? 'mail'
            : source.source_type === 'calendar_event'
              ? 'event'
              : 'description',
        disabled: prepSourcePath(source, isScreenAvailable) === null,
        onPress: () => {
          onSource('talking_points', source);
        },
      })),
    });
  };
  const hint = t('opensSource');
  return (
    <View style={{ gap: 16 }}>
      {points.length === 0 ? (
        <View style={{ gap: 8 }} testID="prep.noPoints">
          <Text variant="secondary" tone="secondary">
            {t('noPoints')}
          </Text>
          <Button label={t('addNotes')} variant="tonal" onPress={onNote} />
        </View>
      ) : (
        <TalkingPointsCard
          kicker={t('pointsKicker', { count: points.length })}
          points={points}
          onPointLongPress={openPointSources}
          pointLongPressLabel={t('pointSources')}
          testID="prep.points"
        />
      )}

      <Block title={t('sections.purpose')}>
        <GroupedList>
          <ListRow
            icon="flag"
            title={view.purpose?.text ?? t('noPurpose')}
            subtitle={t('fromInvite')}
            density="twoLine"
            {...(view.purpose === null ||
            prepSourcePath(view.purpose.provenance, isScreenAvailable) === null
              ? {}
              : {
                  onPress: () => {
                    if (view.purpose !== null) onSource('purpose', view.purpose.provenance);
                  },
                  accessibilityHint: hint,
                })}
            testID="prep.purpose"
          />
        </GroupedList>
      </Block>

      <Block title={t('sections.lastInteraction')}>
        {view.previous_communication.length === 0 ? (
          <Text variant="secondary" tone="secondary">
            {t('firstMeeting')}
          </Text>
        ) : (
          <GroupedList>
            {view.previous_communication.map((item, i) => (
              <ListRow
                key={`${item.source.source_type}-${String(i)}`}
                icon="history"
                title={item.text}
                subtitle={formats.dayMonth(item.source.source_timestamp)}
                density="twoLine"
                {...(prepSourcePath(item.source, isScreenAvailable) === null
                  ? {}
                  : {
                      onPress: () => {
                        onSource('last_interaction', item.source);
                      },
                      trailing: { kind: 'chevron' as const },
                      accessibilityHint: hint,
                    })}
              />
            ))}
          </GroupedList>
        )}
      </Block>

      <Block title={t('sections.emails')}>
        {view.recent_emails.length === 0 ? (
          <Text variant="secondary" tone="secondary">
            {t('noEmails')}
          </Text>
        ) : (
          <GroupedList testID="prep.emails">
            {view.recent_emails.map((mail) => (
              <ListRow
                key={mail.email_message_id}
                icon="mail"
                title={mail.subject}
                subtitle={`${formats.dayMonth(mail.date)} · ${mail.summary}`}
                density="twoLine"
                trailing={{ kind: 'chevron' }}
                onPress={() => {
                  track('meeting_prep_source_opened', { section: 'emails' });
                  router.push(`/mail/${mail.email_message_id}` as Href);
                }}
                accessibilityHint={hint}
                testID={`prep.email.${mail.email_message_id}`}
              />
            ))}
          </GroupedList>
        )}
      </Block>

      {view.open_loops.length === 0 ? null : (
        <Block title={t('sections.openLoops')}>
          <GroupedList>
            {view.open_loops.map((loop, i) => (
              <ListRow
                key={`loop-${String(i)}`}
                icon="forum"
                title={loop.text}
                subtitle={formats.dayMonth(loop.source.source_timestamp)}
                density="twoLine"
                {...(prepSourcePath(loop.source, isScreenAvailable) === null
                  ? {}
                  : {
                      onPress: () => {
                        onSource('open_loops', loop.source);
                      },
                      trailing: { kind: 'chevron' as const },
                      accessibilityHint: hint,
                    })}
              />
            ))}
          </GroupedList>
        </Block>
      )}

      {[
        { key: 'user', title: t('sections.userOwes'), items: view.user_commitments },
        { key: 'other', title: t('sections.theyOwe'), items: view.other_commitments },
      ].map((group) =>
        group.items.length === 0 ? null : (
          <Block key={group.key} title={group.title} testID={`prep.commitments.${group.key}`}>
            <GroupedList>
              {group.items.map((item) => (
                <ListRow
                  key={item.commitment_id}
                  icon="handshake"
                  title={item.text}
                  {...(item.due_at === null
                    ? {}
                    : { subtitle: t('due', { date: formats.dayMonth(item.due_at) }) })}
                  density="twoLine"
                  trailing={{ kind: 'chevron' }}
                  onPress={() => {
                    track('meeting_prep_source_opened', { section: 'commitments' });
                    router.push(`/commitments/${item.commitment_id}` as Href);
                  }}
                  accessibilityHint={hint}
                />
              ))}
            </GroupedList>
          </Block>
        ),
      )}

      {view.relevant_files.length === 0 ? null : (
        <Block title={t('sections.files')}>
          <GroupedList>
            {view.relevant_files.map((file) => (
              <ListRow
                key={file.attachment_ref}
                icon="attach_file"
                title={file.name}
                subtitle={t('fileInMail')}
                trailing={{ kind: 'chevron' }}
                onPress={() => {
                  track('meeting_prep_source_opened', { section: 'files' });
                  router.push(`/mail/${file.email_message_id}` as Href);
                }}
                accessibilityHint={hint}
              />
            ))}
          </GroupedList>
        </Block>
      )}

      {notes.length === 0 ? null : (
        <Block title={t('sections.notes')}>
          <GroupedList>
            {notes.map((note) => (
              <ListRow
                key={note.id}
                icon="edit_note"
                title={note.body}
                subtitle={formats.dayMonth(note.createdAt)}
                density="twoLine"
              />
            ))}
          </GroupedList>
        </Block>
      )}
    </View>
  );
}

/**
 * M-PLAN-09 · Etkinlik Detayı: an honest view of one calendar event with real handoffs (join,
 * maps, the provider calendar) and an approval-gated time change: "Saati Değiştir" (organiser or
 * `can_modify`, provider calendars) lists real free slots and proposes a `calendar_update`
 * (`POST /approvals`, previewed in the approval sheet), never a direct calendar write. Meetings
 * lead to "Toplantıya Hazırlan" (Pro; Free sees the gate), other events to "Hatırlat".
 */
import { isApiError, qk } from '@da/api-client';
import { apiMutationOptions, useApiClient } from '@da/api-client/react';
import {
  Button,
  GroupedList,
  IconButton,
  ListRow,
  NotFoundState,
  PressableScale,
  SectionKicker,
  SkeletonBlock,
  BottomSheet,
  Text,
  useToast,
  type IconName,
} from '@da/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

import { useFormats, useSessionContext } from '../../lib/data/session';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import {
  calendarDayUrl,
  isJoinableMeetingUrl,
  mapsUrl,
  openInBrowser,
  openWithOs,
} from '../actions/handoff';
import { CopyableText } from '../actions/CopyableText';
import { ProGate } from '../actions/ProGate';
import { openMenu, openReminder } from '../actions/sheets';
import { DetailScreen, QueryFailure, useBack, useOfflineGuard } from '../actions/ui';
import { openApprovalSheet } from '../approvals/InlineApprovalSheet';
import { conferenceProvider } from '../meeting/MeetingPrepScreen';
import { eventOptions, isMeeting, notesOptions, type AttendeeData } from '../meeting/data';
import { openNoteSheet } from '../meeting/NoteSheet';
import { useNow } from '../meeting/useNow';
import { FreeSlotList } from './FreeSlotList';

type Origin = 'plan_day' | 'plan_week' | 'today' | 'flow' | 'search' | 'person' | 'deeplink';
const ORIGINS: readonly Origin[] = [
  'plan_day',
  'plan_week',
  'today',
  'flow',
  'search',
  'person',
  'deeplink',
];

function responseOf(a: AttendeeData): {
  icon: IconName;
  key: 'accepted' | 'declined' | 'tentative' | 'none';
} {
  switch (a.response) {
    case 'accepted':
      return { icon: 'check_circle', key: 'accepted' };
    case 'declined':
      return { icon: 'cancel', key: 'declined' };
    case 'tentative':
      return { icon: 'help', key: 'tentative' };
    default:
      return { icon: 'help', key: 'none' };
  }
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <SectionKicker title={title} />
      {children}
    </View>
  );
}

export function EventDetailScreen() {
  const t = useTranslations('plan.eventScreen');
  const tc = useTranslations('common');
  const router = useRouter();
  const toast = useToast();
  const client = useApiClient();
  const formats = useFormats();
  const session = useSessionContext();
  const blocked = useOfflineGuard();
  const params = useLocalSearchParams<{ id: string; origin?: string }>();
  const id = params.id;
  const origin: Origin = ORIGINS.find((o) => o === params.origin) ?? 'deeplink';
  const back = useBack('/plan');
  const tick = useNow();
  const query = useQuery(eventOptions(id));
  const notes = useQuery(notesOptions(id));
  const propose = useMutation(apiMutationOptions(client, 'POST /approvals'));
  const [changing, setChanging] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const event = query.data;
  const meeting = event !== undefined && isMeeting(event);
  const loaded = event !== undefined;

  useEffect(() => {
    if (!loaded) return;
    track('event_detail_opened', { origin, is_meeting: meeting });
    // Once per visit, when the event is first known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  if (event === undefined) {
    return (
      <DetailScreen onLeadingPress={back} testID="event.screen">
        {query.isError ? (
          isApiError(query.error) && query.error.code === 'NOT_FOUND' ? (
            <NotFoundState
              variant="entity"
              title={t('gone')}
              backAction={{ label: tc('actions.goBack'), onPress: back }}
              testID="event.notFound"
            />
          ) : (
            <QueryFailure
              screen={t('screen')}
              error={query.error}
              onRetry={() => {
                void query.refetch();
              }}
              testID="event"
            />
          )
        ) : (
          <View style={{ gap: 10 }} testID="event.loading">
            <SkeletonBlock height={30} width="70%" />
            <SkeletonBlock height={18} width="40%" />
            <SkeletonBlock height={96} />
            <SkeletonBlock height={96} />
          </View>
        )}
      </DetailScreen>
    );
  }

  const startMs = Date.parse(event.startAt);
  const endMs = Date.parse(event.endAt);
  const ended = tick >= endMs;
  const started = tick >= startMs && !ended;
  const minutes = Math.round((endMs - startMs) / 60_000);
  const canChange =
    (event.organizerSelf || event.canModify) &&
    !event.allDay &&
    !ended &&
    (event.provider === 'google' || event.provider === 'microsoft');
  const day = formats.localDate(event.startAt);
  const calendarUrl = calendarDayUrl(event.provider, event.startAt, day);
  const providerLabel =
    event.provider === 'google'
      ? tc('providers.googleCalendar')
      : event.provider === 'microsoft'
        ? tc('providers.outlookCalendar')
        : event.provider === 'apple_device'
          ? tc('providers.appleCalendar')
          : event.provider === 'android_device'
            ? tc('providers.deviceCalendar')
            : tc('providers.demo');
  const title = event.title ?? t('untitled');
  const noteSubtitle = `${title} · ${formats.time(event.startAt)}`;
  const approvalPath = event.daApprovalId === null ? null : `/approvals/${event.daApprovalId}`;

  const changeTime = (slot: { start: string; end: string }) => {
    if (blocked('approve')) return;
    propose.mutate(
      {
        input: {
          body: {
            payload: {
              action_type: 'calendar_update',
              target: {
                kind: 'provider',
                connected_account_id: event.accountId,
                calendar_id: event.calendarId,
              },
              calendar_event_id: event.id,
              changes: {
                time: {
                  kind: 'timed',
                  start: slot.start,
                  end: slot.end,
                  time_zone: formats.timeZone,
                },
              },
            },
            origin: 'plan_proposal',
            origin_ref_id: null,
          },
        },
      },
      {
        onSuccess: (approval) => {
          setChanging(false);
          openApprovalSheet({
            approval,
            origin: 'plan',
            invalidate: [qk.events.detail(event.id), qk.plan.all],
          });
        },
        onError: (error) => {
          toast.show({
            message:
              isApiError(error) && error.code === 'ENTITLEMENT_REQUIRED'
                ? t('changeNeedsPro')
                : t('changeFailed'),
            kind: 'error',
          });
        },
      },
    );
  };

  const statusLabel = ended ? t('ended') : started ? t('started') : null;
  const menu = [
    ...(canChange
      ? [
          {
            key: 'change',
            label: t('changeTime'),
            icon: 'edit_calendar' as IconName,
            onPress: () => {
              track('event_time_change_started');
              setChanging(true);
            },
          },
        ]
      : []),
    ...(calendarUrl === null
      ? []
      : [
          {
            key: 'calendar',
            label: t('openInCalendar'),
            icon: 'open_in_new' as IconName,
            onPress: () => {
              track('external_handoff', { target: 'provider_calendar' });
              void (calendarUrl.startsWith('https:')
                ? openInBrowser(calendarUrl)
                : openWithOs(calendarUrl));
            },
          },
        ]),
  ];

  return (
    <DetailScreen
      kicker={formats.weekdayDate(event.startAt)}
      onLeadingPress={back}
      onRefresh={() => Promise.all([query.refetch(), notes.refetch()])}
      updatedAt={query.dataUpdatedAt}
      {...(menu.length === 0
        ? {}
        : {
            trailing: (
              <IconButton
                icon="more_horiz"
                variant="plain"
                accessibilityLabel={tc('a11y.moreOptions')}
                onPress={() => {
                  openMenu({ options: menu });
                }}
                testID="event.more"
              />
            ),
          })}
      footer={
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {meeting && session.isPro && !ended ? (
            <Button
              label={t('prepare')}
              onPress={() => {
                router.push(`/meeting/${event.id}/prep?origin=plan` as Href);
              }}
              flex
              testID="event.prepare"
            />
          ) : meeting && session.isPro && ended ? (
            <Button
              label={t('postMeeting')}
              onPress={() => {
                router.push(`/meeting/${event.id}/post?origin=event` as Href);
              }}
              flex
              testID="event.post"
            />
          ) : (
            <Button
              label={tc('actions.remind')}
              onPress={() => {
                openReminder({
                  title,
                  origin: 'plan',
                  anchorAt: event.startAt,
                  subject: { type: 'calendar_event', id: event.id },
                });
              }}
              flex
              testID="event.remind"
            />
          )}
          {calendarUrl === null ? null : (
            <Button
              label={t('openInCalendar')}
              variant="tonal"
              onPress={() => {
                track('external_handoff', { target: 'provider_calendar' });
                void (calendarUrl.startsWith('https:')
                  ? openInBrowser(calendarUrl)
                  : openWithOs(calendarUrl));
              }}
              accessibilityHint={t('opensOutside')}
              testID="event.openCalendar"
            />
          )}
        </View>
      }
      testID="event.screen"
    >
      <View style={{ gap: 4 }}>
        <Text variant="h1" heading testID="event.title">
          {title}
        </Text>
        <Text variant="secondary" tone="secondary" numeric>
          {event.allDay
            ? t('allDay')
            : `${formats.range(event.startAt, event.endAt)} · ${formats.duration(minutes)}`}
          {statusLabel === null ? '' : ` · ${statusLabel}`}
        </Text>
        {event.status === 'cancelled' ? (
          <Text variant="secondary" tone="critical">
            {t('cancelled')}
          </Text>
        ) : null}
      </View>

      {event.location === null || event.location.trim() === '' ? null : (
        <Section title={t('location')}>
          <GroupedList>
            <ListRow
              icon="location_on"
              title={event.location}
              trailing={{ kind: 'link', text: t('openMaps') }}
              onPress={() => {
                track('external_handoff', { target: 'maps' });
                void openWithOs(mapsUrl(event.location ?? ''));
              }}
              accessibilityHint={t('opensOutside')}
              testID="event.maps"
            />
          </GroupedList>
        </Section>
      )}

      {isJoinableMeetingUrl(event.conferenceUrl) && !ended ? (
        <Section title={t('link')}>
          <Button
            label={t(`join.${conferenceProvider(event.conferenceUrl)}`)}
            icon="videocam"
            variant="tonal"
            onPress={() => {
              track('external_handoff', { target: 'meeting_link' });
              if (event.conferenceUrl !== null) void openWithOs(event.conferenceUrl);
            }}
            accessibilityHint={t('opensOutside')}
            fullWidth
            testID="event.join"
          />
        </Section>
      ) : null}

      {event.attendees.length === 0 ? null : (
        <Section title={t('attendees', { count: event.attendees.length })}>
          <GroupedList testID="event.attendees">
            {event.attendees.map((a, i) => {
              const response = responseOf(a);
              const name = a.name ?? a.email ?? t('unknownAttendee');
              const path =
                a.contact_id === null || a.contact_id === undefined
                  ? null
                  : `/person/${a.contact_id}`;
              const openable = path !== null && isScreenAvailable(path);
              return (
                <ListRow
                  key={`${a.email ?? name}-${String(i)}`}
                  icon={response.icon}
                  title={a.is_self === true ? t('you', { name }) : name}
                  subtitle={t(`response.${response.key}`)}
                  {...(openable
                    ? {
                        trailing: { kind: 'chevron' as const },
                        onPress: () => {
                          router.push(path);
                        },
                      }
                    : {})}
                />
              );
            })}
          </GroupedList>
        </Section>
      )}

      {event.description === null || event.description.trim() === '' ? null : (
        <Section title={t('description')}>
          <CopyableText
            text={event.description}
            {...(expanded ? {} : { numberOfLines: 4 })}
            testID="event.description"
          />
          {event.description.length > 180 ? (
            <Button
              label={expanded ? t('showLess') : t('showMore')}
              variant="text"
              size="ghost"
              onPress={() => {
                setExpanded((v) => !v);
              }}
            />
          ) : null}
        </Section>
      )}

      {(notes.data ?? []).length === 0 && !(meeting && session.isPro) ? null : (
        <Section title={t('notes')}>
          {(notes.data ?? []).length === 0 ? null : (
            <GroupedList>
              {(notes.data ?? []).map((note) => (
                <PressableScale
                  key={note.id}
                  feedback="none"
                  onPress={() => {
                    setOpenNote((current) => (current === note.id ? null : note.id));
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: openNote === note.id }}
                  style={{ paddingVertical: 12, gap: 2 }}
                >
                  <Text variant="body" {...(openNote === note.id ? {} : { numberOfLines: 2 })}>
                    {note.body}
                  </Text>
                  <Text variant="meta" tone="secondary">
                    {formats.dayMonth(note.createdAt)}
                  </Text>
                </PressableScale>
              ))}
            </GroupedList>
          )}
          {session.isPro ? (
            <Button
              label={t('takeNote')}
              icon="edit_note"
              variant="tonal"
              onPress={() => {
                openNoteSheet({ eventId: event.id, subtitle: noteSubtitle, origin: 'event' });
              }}
              testID="event.note"
            />
          ) : null}
        </Section>
      )}

      {meeting && !session.isPro ? (
        <ProGate
          feature="meeting_prep"
          kicker={t('gateKicker')}
          title={t('gateTitle')}
          body={t('gateBody')}
          surface="card"
        />
      ) : null}

      <View style={{ gap: 4 }} testID="event.provenance">
        <Text variant="meta" tone="secondary">
          {[
            t('source', { provider: providerLabel }),
            event.calendarName,
            event.syncedAt === null
              ? null
              : tc('provenance.lastSynced', { time: formats.time(event.syncedAt) }),
          ]
            .filter((p): p is string => p !== null && p !== '')
            .join(' · ')}
        </Text>
        {approvalPath === null ? null : isScreenAvailable(approvalPath) ? (
          <Button
            label={t('addedByDa')}
            variant="text"
            size="ghost"
            onPress={() => {
              router.push(approvalPath);
            }}
          />
        ) : (
          <Text variant="meta" tone="secondary">
            {t('addedByDa')}
          </Text>
        )}
      </View>

      {changing ? (
        <BottomSheet
          visible
          presentation="inline"
          onDismiss={() => {
            setChanging(false);
          }}
          testID="event.changeTime"
        >
          <FreeSlotList
            durationMinutes={minutes}
            originalStart={event.startAt}
            origin="proposal"
            busy={propose.isPending}
            onPick={changeTime}
            onCancel={() => {
              setChanging(false);
            }}
          />
        </BottomSheet>
      ) : null}
    </DetailScreen>
  );
}

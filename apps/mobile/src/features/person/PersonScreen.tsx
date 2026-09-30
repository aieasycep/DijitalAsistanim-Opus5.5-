/**
 * M-PERS-01 Kişi Zekâsı (`/person/{contactId}`): a relationship summary built from RPC-03
 * `person_intelligence` — last contact, upcoming meetings, open loops, recent topics, what they
 * wait from you and what you wait from them, related mails — and a person-scoped question box
 * ("{Ad} hakkında sor…" → a person-scoped chat thread, SREQ-38). Free users get the basic sections
 * and one contextual gate in place of the `locked_sections`. The VIP chip opens the VIP settings.
 * Only mail, meeting and note channels exist (no telephony).
 */
import { formatRelativeDay, toUpper } from '@da/i18n';
import {
  Avatar,
  ChatComposer,
  DetailHeader,
  ErrorCard,
  GroupedList,
  ListRow,
  MetaChip,
  NotFoundState,
  OfflineBanner,
  SectionHeader,
  StatTile,
  Text,
  TextAction,
  useTheme,
} from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { isScreenAvailable } from '../../lib/deeplinks';
import { track } from '../../lib/events';
import { rpc } from '../../lib/postgrest';
import { useOnline } from '../../lib/query/online-manager';
import { showToast } from '../../providers/ToastHost';
import { ListSkeleton } from '../common/ListSkeleton';
import { useLang, userTimeZone } from '../common/DateTimeFields';
import { ContextualGate } from '../pro-gate/ProGate';
import { routeForSource } from '../today/sources';
import { personQueryOptions, vipListQueryOptions } from './data';
import { VipEditSheet, type VipTarget } from './VipSheets';

const ORIGINS = [
  'prep',
  'mail',
  'event',
  'vip',
  'search',
  'assistant',
  'memory',
  'deeplink',
] as const;

export function PersonScreen() {
  const params = useLocalSearchParams<{ id: string; origin?: string }>();
  const id = params.id;
  const t = useTranslations('person');
  const common = useTranslations('common');
  const states = useTranslations('states');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useOnline();
  const lang = useLang();
  const tz = userTimeZone();
  const query = useQuery(personQueryOptions(id));
  const vips = useQuery(vipListQueryOptions());
  const [text, setText] = useState('');
  const [edit, setEdit] = useState<VipTarget | null>(null);
  const opened = useRef(false);
  const person = query.data;

  useEffect(() => {
    if (opened.current || person === undefined || person === null) return;
    opened.current = true;
    const origin = (ORIGINS as readonly (string | undefined)[]).includes(params.origin)
      ? params.origin
      : 'deeplink';
    track('person_opened', { origin, is_vip: person.isVip });
  }, [person, params.origin]);

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/today');
  };
  const when = (iso: string | null) =>
    iso === null
      ? '—'
      : formatRelativeDay(iso, { locale: lang, now: now().getTime(), timeZone: tz });

  if (person === null) {
    return (
      <View style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}>
        <NotFoundState
          variant="entity"
          title={t('notFound')}
          body={states('notFound.entity.body')}
          backAction={{ label: common('actions.goBack'), onPress: back }}
          testID="person.notFound"
        />
      </View>
    );
  }

  const vipRow = (vips.data ?? []).find((v) => v.contactId === id);
  const openVip = () => {
    if (person === undefined) return;
    setEdit({
      contactId: person.contact.id,
      name: person.contact.name,
      vipId: vipRow?.id ?? null,
      ...(vipRow === undefined
        ? {}
        : {
            settings: {
              relationship: vipRow.relationship,
              alwaysNotify: vipRow.alwaysNotify,
              bypassQuietHours: vipRow.bypassQuietHours,
            },
          }),
    });
  };
  const ask = () => {
    const value = text.trim();
    if (value === '' || !online || person === undefined) return;
    setText('');
    track('person_ask_submitted', { input_mode: 'text' });
    router.push(
      `/chat/new?contactId=${person.contact.id}&prompt=${encodeURIComponent(value)}&origin=person`,
    );
  };

  let body;
  if (person === undefined) {
    body = query.isError ? (
      <ErrorCard
        icon="error"
        tone="neutral"
        title={states('error.action.title')}
        primaryAction={{
          label: common('actions.retry'),
          onPress: () => {
            void query.refetch();
          },
        }}
        testID="person.error"
      />
    ) : (
      <ListSkeleton rows={5} accessibilityLabel={common('a11y.loading')} />
    );
  } else {
    const locked = person.locked.length > 0;
    const sub =
      [person.contact.organization, person.contact.title]
        .filter((p): p is string => p !== null)
        .join(' · ') ||
      (person.contact.email?.split('@')[1] ?? '');
    const next = person.meetings[0];
    const meetingRoute = (eventId: string) => routeForSource('calendar_event', eventId);
    body = (
      <>
        <View style={styles.identity}>
          <Avatar name={person.contact.name} id={person.contact.id} size={76} decorative />
          <Text variant="hero" align="center" heading>
            {person.contact.name}
          </Text>
          {sub === '' ? null : (
            <Text variant="secondary" align="center">
              {sub}
            </Text>
          )}
        </View>
        <View style={styles.tiles}>
          <View style={styles.tile}>
            <StatTile label={t('stats.lastContact')} value={when(person.lastContactAt)} />
          </View>
          <View style={styles.tile}>
            <StatTile
              label={t('stats.upcoming')}
              value={next === undefined ? '—' : when(next.startAt)}
              {...(next !== undefined && meetingRoute(next.id) !== null
                ? {
                    onPress: () => {
                      track('person_section_opened', { section: 'meetings' });
                      router.push(meetingRoute(next.id) ?? '/plan');
                    },
                  }
                : {})}
            />
          </View>
          <View style={styles.tile}>
            <StatTile
              label={t('stats.openLoops')}
              value={locked ? '—' : String(person.openLoops.length)}
              {...(!locked && person.openLoops.length > 0 ? { tone: 'warning' as const } : {})}
            />
          </View>
        </View>
        {person.meetings.length > 0 ? (
          <View style={styles.section} testID="person.meetings">
            <SectionHeader title={toUpper(t('sections.meetings'), lang)} />
            <GroupedList>
              {person.meetings.map((meeting) => {
                const route = meetingRoute(meeting.id);
                return (
                  <ListRow
                    key={meeting.id}
                    title={meeting.title}
                    subtitle={when(meeting.startAt)}
                    icon="event"
                    {...(route === null
                      ? {}
                      : {
                          trailing: { kind: 'chevron' as const },
                          onPress: () => {
                            router.push(route);
                          },
                        })}
                  />
                );
              })}
            </GroupedList>
          </View>
        ) : null}
        {locked ? (
          <ContextualGate
            feature="commitments"
            title={t('gate.title')}
            body={t('gate.body')}
            testID="person.gate"
          />
        ) : (
          <>
            {person.openLoops.length > 0 ? (
              <View style={styles.section} testID="person.openLoops">
                <SectionHeader title={toUpper(t('sections.openItems'), lang)} />
                <GroupedList>
                  {person.openLoops.map((loop) => (
                    <ListRow
                      key={loop.insightId}
                      title={loop.title}
                      {...(loop.dueAt === null ? {} : { subtitle: when(loop.dueAt) })}
                      icon="priority_high"
                      trailing={{ kind: 'link', text: t('resolve') }}
                      onPress={() => {
                        void rpc('set_insight_status', {
                          p_insight_id: loop.insightId,
                          p_status: 'done',
                        })
                          .then(() => {
                            void query.refetch();
                            showToast({
                              message: common('toast.completed'),
                              kind: 'success',
                              action: {
                                label: common('actions.undo'),
                                onPress: () => {
                                  void rpc('set_insight_status', {
                                    p_insight_id: loop.insightId,
                                    p_status: 'open',
                                  }).then(() => query.refetch());
                                },
                              },
                            });
                          })
                          .catch(() => {
                            showToast({ message: common('toast.saveFailed'), kind: 'error' });
                          });
                      }}
                      accessibilityHint={t('resolveHint')}
                    />
                  ))}
                </GroupedList>
              </View>
            ) : null}
            {person.userOwes.length > 0 ? (
              <View style={styles.section} testID="person.userOwes">
                <SectionHeader title={toUpper(t('sections.userOwes'), lang)} />
                <GroupedList>
                  {person.userOwes.map((item) => {
                    const route = routeForSource('commitment', item.id);
                    return (
                      <ListRow
                        key={item.id}
                        title={item.text}
                        {...(item.dueAt === null ? {} : { subtitle: when(item.dueAt) })}
                        icon="handshake"
                        {...(route === null
                          ? {}
                          : {
                              trailing: { kind: 'chevron' as const },
                              onPress: () => {
                                track('person_section_opened', { section: 'commitments' });
                                router.push(route);
                              },
                            })}
                      />
                    );
                  })}
                </GroupedList>
              </View>
            ) : null}
            {person.theyOwe.length > 0 ? (
              <View style={styles.section} testID="person.theyOwe">
                <SectionHeader title={toUpper(t('sections.theyOwe'), lang)} />
                <GroupedList>
                  {person.theyOwe.map((item) => {
                    const route = routeForSource('commitment', item.id);
                    return (
                      <ListRow
                        key={item.id}
                        title={item.text}
                        {...(item.dueAt === null ? {} : { subtitle: when(item.dueAt) })}
                        icon="hourglass_top"
                        {...(route === null
                          ? {}
                          : {
                              trailing: { kind: 'chevron' as const },
                              onPress: () => {
                                router.push(route);
                              },
                            })}
                      />
                    );
                  })}
                </GroupedList>
              </View>
            ) : null}
          </>
        )}
        {person.topics.length > 0 ? (
          <View style={styles.section} testID="person.topics">
            <SectionHeader title={toUpper(t('sections.topics'), lang)} />
            <GroupedList>
              {person.topics.map((topic) => (
                <ListRow key={topic} title={topic} icon="forum" iconStyle="bare" />
              ))}
            </GroupedList>
          </View>
        ) : null}
        {person.emails.length > 0 ? (
          <View style={styles.section} testID="person.emails">
            <SectionHeader title={toUpper(t('sections.recentMail'), lang)} />
            <GroupedList>
              {person.emails.slice(0, 3).map((mail) => (
                <ListRow
                  key={mail.threadId}
                  title={mail.subject}
                  subtitle={[mail.summary ?? '', when(mail.at)].filter((p) => p !== '').join(' · ')}
                  icon="mail"
                  density="twoLine"
                />
              ))}
            </GroupedList>
            {isScreenAvailable('/search') ? (
              <TextAction
                label={t('allMail', { count: person.emails.length })}
                onPress={() => {
                  track('person_section_opened', { section: 'emails' });
                  router.push(`/search?types=email&contactId=${person.contact.id}`);
                }}
                testID="person.allMail"
              />
            ) : null}
          </View>
        ) : null}
      </>
    );
  }

  return (
    <View
      style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}
      testID="screen.person"
    >
      <DetailHeader
        leading="back"
        onLeadingPress={back}
        leadingAccessibilityLabel={common('actions.back')}
        {...(person === undefined
          ? {}
          : {
              trailing: (
                <MetaChip
                  label={
                    person.isVip && person.relationship !== null
                      ? t('vipChip', { group: t(`relationships.${person.relationship}`) })
                      : t('makeVip')
                  }
                  icon="star"
                  iconFilled={person.isVip}
                  variant="vip"
                  onPress={openVip}
                  accessibilityRole="button"
                  testID="person.vipChip"
                />
              ),
            })}
      />
      {!online ? (
        <View style={{ paddingHorizontal: theme.layout.screenX }}>
          <OfflineBanner
            message={states('offline.noCache.title')}
            refreshLabel={states('offline.refresh')}
            onRefresh={() => {
              void query.refetch();
            }}
          />
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.layout.screenX }]}
      >
        {body}
      </ScrollView>
      {person === undefined ? null : (
        <View
          style={[
            styles.composer,
            { paddingHorizontal: theme.layout.screenX, paddingBottom: insets.bottom + 8 },
          ]}
        >
          <ChatComposer
            value={text}
            onChangeText={setText}
            onSend={ask}
            onMic={() => {
              track('person_ask_submitted', { input_mode: 'voice' });
              router.push(`/voice?origin=assistant&contactId=${person.contact.id}`);
            }}
            placeholder={t('askHint', {
              name: person.contact.name.split(' ')[0] ?? person.contact.name,
            })}
            accessibilityLabel={t('askHint', { name: person.contact.name })}
            sendLabel={common('actions.send')}
            micLabel={common('a11y.microphone')}
            disabled={!online}
            {...(!online ? { disabledReason: states('offline.assistant') } : {})}
            testID="person.composer"
          />
        </View>
      )}
      <VipEditSheet
        target={edit}
        onClose={() => {
          setEdit(null);
          void query.refetch();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: 16, paddingBottom: 40 },
  identity: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  tiles: { flexDirection: 'row', gap: 8 },
  tile: { flex: 1 },
  section: { gap: 8 },
  composer: { paddingTop: 8 },
});

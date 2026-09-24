/**
 * M-SET-70 "Yardım" (`/settings/help?faq=&contact=&ticket=`): the bundled FAQ catalogue shared with
 * the web `/support` page (works offline), searched locally with Turkish case folding, grouped by
 * category with the featured items first; answers that describe a setting end with "Ayara git"
 * when that screen exists. The DESTEK card opens a real ticket (M-SET-71), the bug report
 * (M-SET-72), the web support page and `mailto:`; TALEPLERİM lists the user's own tickets.
 */
import { qk } from '@da/api-client';
import { useBootstrap } from '@da/api-client/react';
import type { TicketCategory, TicketStatus } from '@da/domain';
import {
  FAQ_CATEGORIES,
  faqItemsFor,
  foldForSearch,
  type FaqCategory,
  type FaqItem,
  type FaqKey,
} from '@da/i18n';
import {
  Accordion,
  BottomSheet,
  Button,
  EmptyState,
  FilterChip,
  ListRow,
  SearchField,
  SkeletonBlock,
  StatusPill,
  Text,
} from '@da/ui';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useFormatter, useTranslations } from 'use-intl';

import { getSupabase } from '../../lib/auth/supabase';
import { now } from '../../lib/clock';
import { isScreenAvailable } from '../../lib/deeplinks';
import { appVersion, buildNumber } from '../../lib/device';
import { track } from '../../lib/events';
import { toDataError } from '../../lib/postgrest';
import { useUiPrefs } from '../../lib/ui-prefs';
import { deviceLocale } from '../../i18n/I18nProvider';
import { ContactSheet, TICKET_CATEGORIES } from './ContactSheet';
import { SUPPORT_EMAIL, maskEmail, openMail, openWebPage } from './links';
import { Caption, SettingsGroup, SettingsPage } from './ui';

export interface TicketRow {
  readonly id: string;
  readonly public_ref: string;
  readonly category: TicketCategory;
  readonly status: TicketStatus;
  readonly subject: string;
  readonly created_at: string;
  readonly updated_at: string;
}

async function fetchTickets(): Promise<readonly TicketRow[]> {
  const { data, error } = (await getSupabase()
    .from('support_tickets')
    .select('id, public_ref, category, status, subject, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(20)) as unknown as {
    data: TicketRow[] | null;
    error: { message?: string; code?: string } | null;
  };
  if (error !== null) throw toDataError(error);
  return data ?? [];
}

export function ticketsQueryOptions() {
  return queryOptions({
    queryKey: qk.support.tickets(),
    queryFn: fetchTickets,
    staleTime: 5 * 60_000,
    meta: { persist: true },
  });
}

function countBucket(n: number): '0' | '1' | '2-5' | '6-20' | '20+' {
  if (n === 0) return '0';
  if (n === 1) return '1';
  if (n <= 5) return '2-5';
  if (n <= 20) return '6-20';
  return '20+';
}

function resultsBucket(n: number): '0' | '1_5' | '6_20' | 'gt20' {
  if (n === 0) return '0';
  if (n <= 5) return '1_5';
  if (n <= 20) return '6_20';
  return 'gt20';
}

function isFaqKey(items: readonly FaqItem[], key: string | undefined): key is FaqKey {
  return key !== undefined && items.some((item) => item.key === key);
}

export function HelpScreen() {
  const t = useTranslations();
  const format = useFormatter();
  const router = useRouter();
  const params = useLocalSearchParams<{ faq?: string; contact?: string; ticket?: string }>();
  const bootstrap = useBootstrap();
  const prefs = useUiPrefs();
  const locale = prefs.locale ?? deviceLocale();
  const tickets = useQuery(ticketsQueryOptions());
  const items = faqItemsFor(Platform.OS === 'android' ? 'android' : 'ios');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FaqCategory | null>(null);
  const [expanded, setExpanded] = useState<readonly string[]>(
    isFaqKey(items, params.faq) ? [params.faq] : [],
  );
  const contactCategory = TICKET_CATEGORIES.find((c) => c === params.contact) ?? null;
  const [contactOpen, setContactOpen] = useState(params.contact !== undefined);
  const [ticketId, setTicketId] = useState<string | null>(params.ticket ?? null);

  useEffect(() => {
    track('help_opened', {
      from: params.faq !== undefined || params.contact !== undefined ? 'deeplink' : 'settings',
    });
    if (params.contact !== undefined) track('support_contact_opened', { from: 'deeplink' });
    // Tracked once per screen visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ticketCount = tickets.data?.length;
  useEffect(() => {
    if (ticketCount !== undefined) {
      track('support_tickets_viewed', { count_bucket: countBucket(ticketCount) });
    }
  }, [ticketCount]);

  const data = bootstrap.data;
  const limit = (key: string, fallback: number) => data?.usage.limits[key]?.limit ?? fallback;
  const values = {
    mail: limit('max_mail_accounts', 1),
    cal: limit('max_calendars', 1),
    n: data?.usage.ai_units.limit ?? limit('ai_daily_budget_units', 50),
    days: data?.config.referral_reward_days ?? 14,
    cap: data?.config.referral_max_rewards_per_year ?? 6,
    window: 7,
  };
  const question = (item: FaqItem) => t(`faq.items.${item.key as FaqKey}.q`);
  const answerText = (item: FaqItem) =>
    t.markup(`faq.items.${item.key as FaqKey}.a`, {
      ...values,
      privacy: (chunks) => chunks,
      adminConsent: (chunks) => chunks,
    });

  const folded = foldForSearch(query, locale);
  const matches = items.filter((item) => {
    if (category !== null && item.category !== category) return false;
    if (folded === '') return true;
    return (
      foldForSearch(question(item), locale).includes(folded) ||
      foldForSearch(answerText(item), locale).includes(folded)
    );
  });

  useEffect(() => {
    if (folded === '') return;
    const timer = setTimeout(() => {
      track('help_search_used', { results_bucket: resultsBucket(matches.length) });
    }, 800);
    return () => {
      clearTimeout(timer);
    };
  }, [folded, matches.length]);

  const toggle = (item: FaqItem) => {
    const open = expanded.includes(item.key);
    if (!open) track('help_faq_expanded', { key: item.key });
    setExpanded(open ? expanded.filter((k) => k !== item.key) : [...expanded, item.key]);
  };

  const faqRow = (item: FaqItem, prefix: string) => {
    const route = item.appRoute;
    const reachable = route !== undefined && isScreenAvailable(route);
    return (
      <Accordion
        key={`${prefix}.${item.key}`}
        title={question(item)}
        expanded={expanded.includes(item.key)}
        onToggle={() => {
          toggle(item);
        }}
        testID={`help.faq.${prefix}.${item.key}`}
      >
        <Text variant="bodySm" tone="secondary">
          {answerText(item)}
        </Text>
        {reachable ? (
          <Button
            label={t('faq.goToSetting')}
            variant="text"
            size="sm"
            onPress={() => {
              track('help_faq_action', { key: item.key });
              router.push(route);
            }}
            testID={`help.faq.${item.key}.go`}
          />
        ) : null}
      </Accordion>
    );
  };

  const searching = folded !== '' || category !== null;
  const featured = items.filter((item) => item.featured);
  const selectedTicket = tickets.data?.find((ticket) => ticket.id === ticketId) ?? null;
  const signInEmail = data?.profile.email ?? null;

  return (
    <SettingsPage
      title={t('settings.help.title')}
      subtitle={t('settings.help.subtitle')}
      refreshing={tickets.isRefetching}
      onRefresh={() => {
        void tickets.refetch();
      }}
      testID="screen.settings.help"
    >
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder={t('faq.searchHint')}
        accessibilityLabel={t('faq.searchHint')}
        testID="help.search"
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        accessibilityRole="tablist"
      >
        <FilterChip
          label={t('common.actions.all')}
          selected={category === null}
          role="tab"
          onPress={() => {
            setCategory(null);
          }}
          testID="help.category.all"
        />
        {FAQ_CATEGORIES.map((key) => (
          <FilterChip
            key={key}
            label={t(`faq.categories.${key}`)}
            selected={category === key}
            role="tab"
            onPress={() => {
              setCategory(category === key ? null : key);
            }}
            testID={`help.category.${key}`}
          />
        ))}
      </ScrollView>

      {searching ? (
        matches.length === 0 ? (
          <EmptyState
            icon="search_off"
            tone="neutral"
            title={t('faq.noResults.title')}
            body={t('faq.noResults.body')}
            action={{
              label: t('settings.help.contact'),
              onPress: () => {
                track('support_contact_opened', { from: 'help' });
                setContactOpen(true);
              },
            }}
            testID="help.noResults"
          />
        ) : (
          <SettingsGroup testID="help.results">
            {matches.map((item) => faqRow(item, 'result'))}
          </SettingsGroup>
        )
      ) : (
        <>
          <SettingsGroup title={t('faq.featured')} testID="help.featured">
            {featured.map((item) => faqRow(item, 'featured'))}
          </SettingsGroup>
          {FAQ_CATEGORIES.map((key) => {
            const list = items.filter((item) => item.category === key && !item.featured);
            if (list.length === 0) return null;
            return (
              <SettingsGroup key={key} title={t(`faq.categories.${key}`)}>
                {list.map((item) => faqRow(item, key))}
              </SettingsGroup>
            );
          })}
        </>
      )}

      <SettingsGroup title={t('settings.help.supportSection')}>
        <ListRow
          icon="support_agent"
          title={t('settings.help.contact')}
          subtitle={t('settings.help.contactMeta')}
          trailing={{ kind: 'chevron' }}
          onPress={() => {
            track('support_contact_opened', { from: 'help' });
            setContactOpen(true);
          }}
          testID="help.contact"
        />
        <ListRow
          icon="feedback"
          title={t('settings.help.reportBug')}
          trailing={{ kind: 'chevron' }}
          onPress={() => {
            router.push('/settings/feedback?type=bug');
          }}
          testID="help.reportBug"
        />
        <ListRow
          icon="open_in_new"
          title={t('settings.help.webSupport')}
          trailing={{ kind: 'chevron' }}
          accessibilityHint={t('common.a11y.opensInBrowser')}
          onPress={() => {
            void openWebPage('/support');
          }}
          testID="help.web"
        />
        <ListRow
          icon="mail"
          title={t('settings.help.emailUs')}
          subtitle={SUPPORT_EMAIL}
          trailing={{ kind: 'chevron' }}
          onPress={() => {
            void openMail(SUPPORT_EMAIL);
          }}
          testID="help.email"
        />
      </SettingsGroup>

      {tickets.data === undefined ? (
        tickets.isPending ? (
          <View style={styles.skeleton} accessibilityLabel={t('common.a11y.loading')}>
            <SkeletonBlock width="100%" height={44} radius={12} />
            <SkeletonBlock width="100%" height={44} radius={12} />
          </View>
        ) : (
          <ListRow
            title={t('settings.help.ticketsFailed')}
            trailing={{ kind: 'link', text: t('common.actions.retry') }}
            onPress={() => {
              void tickets.refetch();
            }}
            testID="help.ticketsError"
          />
        )
      ) : tickets.data.length === 0 ? null : (
        <SettingsGroup title={t('settings.help.myTickets')} testID="help.tickets">
          {tickets.data.map((ticket) => (
            <ListRow
              key={ticket.id}
              title={ticket.public_ref}
              subtitle={t('settings.help.ticketMeta', {
                category: t(`settings.contact.categories.${ticket.category}`),
                date: format.dateTime(new Date(ticket.created_at), {
                  day: 'numeric',
                  month: 'short',
                }),
              })}
              trailing={{
                kind: 'custom',
                node: (
                  <StatusPill
                    label={t(`settings.help.ticketStatus.${ticket.status}`)}
                    tone="neutral"
                  />
                ),
              }}
              onPress={() => {
                setTicketId(ticket.id);
              }}
              testID={`help.ticket.${ticket.id}`}
            />
          ))}
        </SettingsGroup>
      )}

      <Caption>
        {t('settings.help.footer', {
          version: appVersion(),
          build: buildNumber(),
          year: now().getFullYear(),
        })}
      </Caption>

      {contactOpen ? (
        <ContactSheet
          visible
          from="help"
          initialCategory={contactCategory}
          signInEmail={signInEmail}
          onOpenFaq={(key) => {
            setCategory(null);
            setQuery('');
            setExpanded([...expanded, key]);
          }}
          onDismiss={() => {
            setContactOpen(false);
          }}
        />
      ) : null}
      <BottomSheet
        visible={selectedTicket !== null}
        onDismiss={() => {
          setTicketId(null);
        }}
        title={selectedTicket?.public_ref ?? ''}
        testID="sheet.ticket"
      >
        {selectedTicket === null ? null : (
          <>
            <Text variant="rowTitle">{selectedTicket.subject}</Text>
            <Text variant="bodySm" tone="secondary">
              {[
                t(`settings.contact.categories.${selectedTicket.category}`),
                t(`settings.help.ticketStatus.${selectedTicket.status}`),
              ].join(' · ')}
            </Text>
            <Text variant="bodySm" tone="secondary">
              {t('settings.help.ticketDates', {
                created: format.dateTime(new Date(selectedTicket.created_at), {
                  dateStyle: 'medium',
                }),
                updated: format.dateTime(new Date(selectedTicket.updated_at), {
                  dateStyle: 'medium',
                }),
              })}
            </Text>
            {signInEmail === null ? null : (
              <Caption>{t('settings.help.ticketNote', { email: maskEmail(signInEmail) })}</Caption>
            )}
          </>
        )}
      </BottomSheet>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  chips: { gap: 8, paddingVertical: 4 },
  skeleton: { gap: 8 },
});

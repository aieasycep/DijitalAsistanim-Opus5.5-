/**
 * M-SET-50 "Öncelik Kuralları" (`/settings/priority-rules`) and M-SET-54 (precedence sheet): the
 * user's explicit rules grouped by outcome, each with its 30-day match count (`match_count_30d`) and
 * an enable switch (optimistic PATCH; a DB trigger re-triages). HER ZAMAN BİLDİR starts with the VIP
 * row derived from `vip_people` (VIP is not a rule condition). Rows open the editor; "Kural Ekle"
 * creates one. Rule writes need no approval (internal preference).
 */
import { qk } from '@da/api-client';
import { useBootstrap } from '@da/api-client/react';
import type { RuleOutcome } from '@da/domain';
import { BottomSheet, Button, EmptyState, ErrorCard, ListRow, Switch, Text } from '@da/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { getSupabase } from '../../lib/auth/supabase';
import { track } from '../../lib/events';
import { showToast } from '../../providers/ToastHost';
import { ListSkeleton } from '../common/ListSkeleton';
import { isPro, openProGate } from '../pro-gate/ProGate';
import { useSettingsCounts } from '../settings/data';
import { SettingsGroup, SettingsPage } from '../settings/ui';
import { OUTCOME_GROUPS, patchRule, rulesQueryOptions, type RuleRow } from './rules';
import { useRuleSummary } from './summary';

/** Display names of the contacts referenced by person rules. */
export function useContactNames(ids: readonly string[]) {
  return useQuery({
    queryKey: [...qk.rules.all, 'contacts', [...ids].sort()] as const,
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data } = (await getSupabase()
        .from('contacts')
        .select('id, display_name')
        .in('id', [...ids])) as unknown as {
        data: { id: string; display_name: string }[] | null;
      };
      return Object.fromEntries((data ?? []).map((c) => [c.id, c.display_name]));
    },
  });
}

export function PrecedenceSheet({
  visible,
  onDismiss,
}: {
  readonly visible: boolean;
  readonly onDismiss: () => void;
}) {
  const t = useTranslations();
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title={t('settings.rulesScreen.precedence.title')}
      testID="sheet.precedence"
      footer={<Button label={t('common.actions.ok')} variant="ink" fullWidth onPress={onDismiss} />}
    >
      <View accessibilityRole="list" style={styles.list}>
        {(['rules', 'learned', 'signals', 'ai'] as const).map((key, index) => {
          const line = `${String(index + 1)}. ${t(`settings.rulesScreen.precedence.${key}`)}`;
          return (
            <Text key={key} variant="body">
              {line}
            </Text>
          );
        })}
      </View>
      <Text variant="bodySm" tone="secondary">
        {t('settings.rulesScreen.precedence.specificity')}
      </Text>
    </BottomSheet>
  );
}

export function PriorityRulesScreen() {
  const t = useTranslations();
  const router = useRouter();
  const queryClient = useQueryClient();
  const bootstrap = useBootstrap();
  const rules = useQuery(rulesQueryOptions());
  const counts = useSettingsCounts();
  const summary = useRuleSummary();
  const [precedence, setPrecedence] = useState(false);
  const list = rules.data ?? [];
  const personIds = list
    .filter((r) => r.condition_type === 'person')
    .map((r) =>
      typeof r.condition_value.contact_id === 'string' ? r.condition_value.contact_id : '',
    )
    .filter((id) => id !== '');
  const names = useContactNames(personIds);
  const pro = bootstrap.data?.entitlement.is_active ?? isPro();
  const vipCount = counts.data?.vip ?? 0;
  const vipBypass = bootstrap.data?.notification_preferences.vip_bypass_quiet ?? true;

  const loaded = rules.data !== undefined;
  const total = list.length;
  useEffect(() => {
    if (loaded) track('priority_rules_opened', { count: total });
    // Once per visit, when the list is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const toggle = (rule: RuleRow) => {
    const enabled = !rule.enabled;
    track('priority_rule_toggled', {
      condition_type: rule.condition_type,
      outcome: rule.outcome,
      enabled,
    });
    const before = queryClient.getQueryData<readonly RuleRow[]>(qk.rules.list());
    queryClient.setQueryData<readonly RuleRow[]>(qk.rules.list(), (rows) =>
      rows?.map((r) => (r.id === rule.id ? { ...r, enabled } : r)),
    );
    void patchRule(rule.id, { enabled })
      .then(() => queryClient.invalidateQueries({ queryKey: qk.settings.counts() }))
      .catch(() => {
        if (before !== undefined) queryClient.setQueryData(qk.rules.list(), before);
        showToast({ message: t('states.error.saveFailed'), kind: 'error' });
      });
  };

  const metaOf = (rule: RuleRow) => {
    const type = t(`settings.priorityRules.conditions.${rule.condition_type}`);
    const count =
      rule.condition_type === 'android_app'
        ? t('settings.rulesScreen.appCount', { count: rule.match_count_30d })
        : t('settings.priorityRules.matchCount', { count: rule.match_count_30d });
    return `${type} · ${count}`;
  };

  const vipRow = (
    <ListRow
      key="vip"
      icon="star"
      title={t('settings.priorityRules.vipRow')}
      subtitle={
        vipBypass
          ? t('settings.rulesScreen.vipMetaQuiet', { count: vipCount })
          : t('common.units.people', { count: vipCount })
      }
      {...(pro
        ? {}
        : {
            trailing: { kind: 'value' as const, text: t('common.badges.pro') },
            onPress: () => {
              openProGate('vip');
            },
          })}
      testID="rules.vip"
    />
  );

  const groupOf = (outcome: RuleOutcome) => {
    const items = list.filter((rule) => rule.outcome === outcome);
    const showVip = outcome === 'always_notify' && vipCount > 0;
    if (items.length === 0 && !showVip) return null;
    return (
      <SettingsGroup
        key={outcome}
        title={t(`settings.rulesScreen.groups.${outcome}`)}
        testID={`rules.group.${outcome}`}
      >
        {showVip ? vipRow : null}
        {items.map((rule) => {
          const title = summary(
            rule,
            typeof rule.condition_value.contact_id === 'string'
              ? names.data?.[rule.condition_value.contact_id]
              : undefined,
          );
          return (
            <View key={rule.id} style={{ opacity: rule.enabled ? 1 : 0.55 }}>
              <ListRow
                title={title}
                subtitle={metaOf(rule)}
                trailing={{
                  kind: 'custom',
                  node: (
                    <Switch
                      value={rule.enabled}
                      accessibilityLabel={title}
                      onValueChange={() => {
                        toggle(rule);
                      }}
                      testID={`rules.toggle.${rule.id}`}
                    />
                  ),
                }}
                accessibilityLabel={t('settings.rulesScreen.rowA11y', {
                  type: t(`settings.priorityRules.conditions.${rule.condition_type}`),
                  title,
                  outcome: t(`settings.priorityRules.outcomes.${rule.outcome}`),
                  count: rule.match_count_30d,
                  state: rule.enabled ? t('privacy.center.on') : t('privacy.center.off'),
                })}
                onPress={() => {
                  router.push(`/settings/priority-rules/${rule.id}`);
                }}
                testID={`rules.row.${rule.id}`}
              />
            </View>
          );
        })}
      </SettingsGroup>
    );
  };

  let body;
  if (rules.isPending) {
    body = <ListSkeleton rows={4} accessibilityLabel={t('common.a11y.loading')} />;
  } else if (rules.isError && rules.data === undefined) {
    body = (
      <ErrorCard
        icon="cloud_off"
        tone="neutral"
        title={t('states.error.loadFailed.title', { screen: t('settings.priorityRules.title') })}
        body={t('states.error.loadFailed.body')}
        primaryAction={{
          label: t('common.actions.retry'),
          onPress: () => {
            void rules.refetch();
          },
        }}
        testID="rules.error"
      />
    );
  } else if (list.length === 0 && vipCount === 0) {
    body = (
      <EmptyState
        icon="tune"
        tone="neutral"
        title={t('settings.rulesScreen.emptyTitle')}
        body={t('settings.rulesScreen.emptyBody')}
        action={{
          label: t('settings.rulesScreen.add'),
          onPress: () => {
            router.push('/settings/priority-rules/new');
          },
        }}
        testID="rules.empty"
      />
    );
  } else {
    body = OUTCOME_GROUPS.map(groupOf);
  }

  return (
    <SettingsPage
      title={t('settings.priorityRules.title')}
      subtitle={t('settings.rulesScreen.subtitle')}
      refreshing={rules.isRefetching}
      onRefresh={() => {
        void rules.refetch();
      }}
      testID="screen.settings.rules"
      footer={
        <Button
          label={t('settings.rulesScreen.add')}
          icon="add"
          fullWidth
          onPress={() => {
            router.push('/settings/priority-rules/new');
          }}
          testID="rules.add"
        />
      }
    >
      <Button
        label={t('settings.priorityRules.precedenceTitle')}
        variant="text"
        size="sm"
        icon="info"
        onPress={() => {
          track('rules_precedence_viewed');
          setPrecedence(true);
        }}
        testID="rules.precedence"
      />
      {body}
      <ListRow
        icon="psychology"
        title={t('settings.rulesScreen.footer')}
        trailing={{ kind: 'link', text: t('settings.hub.rows.personalization') }}
        onPress={() => {
          router.push('/settings/personalization');
        }}
        testID="rules.personalization"
      />
      <PrecedenceSheet
        visible={precedence}
        onDismiss={() => {
          setPrecedence(false);
        }}
      />
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  list: { gap: 6 },
});

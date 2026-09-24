/**
 * M-SET-45 "AI Kişiselleştirme" (`/settings/personalization`) and M-SET-46 (edit sheet): the
 * `learned_preferences` with their evidence, grouped KİŞİLER / KONULAR / TERCİHLER. Each row can be
 * switched off, edited (priority preferences only: `priority_override`) or deleted (soft delete, a
 * tombstone the learner respects, with a 5 s undo); "Etkileşimlerimden öğren" writes
 * `user_preferences.learn_from_interactions`. Only these columns are ever written; no model
 * training toggle exists because no training happens.
 */
import { qk } from '@da/api-client';
import { useBootstrap } from '@da/api-client/react';
import {
  BottomSheet,
  Button,
  EmptyState,
  ErrorCard,
  IconButton,
  ListRow,
  Switch,
  Text,
  useTheme,
} from '@da/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { track } from '../../lib/events';
import { showToast } from '../../providers/ToastHost';
import { ListSkeleton } from '../common/ListSkeleton';
import { saveUserPreferences } from '../settings/save';
import { Caption, SettingsGroup, SettingsPage } from '../settings/ui';
import { learnedQueryOptions, patchLearned, type LearnedRow } from './rules';

type Group = LearnedRow['group_key'];
type Priority = 'high' | 'normal' | 'low';
const SECTIONS: readonly (readonly [
  key: 'people' | 'topics' | 'preferences',
  groups: readonly Group[],
])[] = [
  ['people', ['people']],
  ['topics', ['topics', 'categories']],
  ['preferences', ['timing', 'tone']],
];
const PRIORITIES: readonly Priority[] = ['high', 'normal', 'low'];

export function PersonalizationScreen() {
  const t = useTranslations();
  const theme = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const bootstrap = useBootstrap();
  const learned = useQuery(learnedQueryOptions());
  const [editing, setEditing] = useState<LearnedRow | null>(null);
  const [priority, setPriority] = useState<Priority>('normal');
  const [saving, setSaving] = useState(false);
  const learning = bootstrap.data?.preferences.learn_from_interactions ?? true;

  const setRows = (update: (rows: readonly LearnedRow[]) => readonly LearnedRow[]) => {
    queryClient.setQueryData<readonly LearnedRow[]>(qk.learned.list(), (rows) =>
      rows === undefined ? rows : update(rows),
    );
  };
  const refreshCounts = () => {
    void queryClient.invalidateQueries({ queryKey: qk.settings.counts() });
  };

  const mutate = async (
    row: LearnedRow,
    values: Parameters<typeof patchLearned>[1],
    optimistic: (rows: readonly LearnedRow[]) => readonly LearnedRow[],
  ): Promise<boolean> => {
    const before = queryClient.getQueryData<readonly LearnedRow[]>(qk.learned.list());
    setRows(optimistic);
    try {
      await patchLearned(row.id, values);
      refreshCounts();
      return true;
    } catch {
      if (before !== undefined) queryClient.setQueryData(qk.learned.list(), before);
      showToast({ message: t('states.error.saveFailed'), kind: 'error' });
      return false;
    }
  };

  const toggle = (row: LearnedRow) => {
    const enabled = !row.enabled;
    if (!enabled) track('learned_pref_disabled', { group: row.group_key, kind: row.group_key });
    void mutate(row, { enabled }, (rows) =>
      rows.map((r) => (r.id === row.id ? { ...r, enabled } : r)),
    );
  };

  const remove = (row: LearnedRow) => {
    track('learned_pref_deleted', { group: row.group_key, kind: row.group_key });
    void mutate(row, { deleted_at: now().toISOString() }, (rows) =>
      rows.filter((r) => r.id !== row.id),
    ).then((ok) => {
      if (!ok) return;
      showToast({
        message: t('settings.personalizationScreen.deleted'),
        action: {
          label: t('common.actions.undo'),
          onPress: () => {
            track('learned_pref_restored', { group: row.group_key, kind: row.group_key });
            void mutate(row, { deleted_at: null }, (rows) => [row, ...rows]);
          },
        },
      });
    });
  };

  const openEdit = (row: LearnedRow) => {
    setPriority(row.priority_override ?? row.effect.priority ?? 'normal');
    setEditing(row);
  };

  const rows = learned.data ?? [];
  let body;
  if (learned.isPending) {
    body = <ListSkeleton rows={3} accessibilityLabel={t('common.a11y.loading')} />;
  } else if (learned.isError && learned.data === undefined) {
    body = (
      <ErrorCard
        icon="cloud_off"
        tone="neutral"
        title={t('states.error.loadFailed.title', { screen: t('settings.personalization.title') })}
        body={t('states.error.loadFailed.body')}
        primaryAction={{
          label: t('common.actions.retry'),
          onPress: () => {
            void learned.refetch();
          },
        }}
        testID="personalization.error"
      />
    );
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon="psychology"
        tone="neutral"
        title={t('settings.personalizationScreen.emptyTitle')}
        body={t('settings.personalizationScreen.emptyBody')}
        testID="personalization.empty"
      />
    );
  } else {
    body = SECTIONS.map(([section, groups]) => {
      const list = rows.filter((row) => groups.includes(row.group_key));
      if (list.length === 0) return null;
      return (
        <SettingsGroup
          key={section}
          title={t(`settings.personalizationScreen.sections.${section}`)}
          testID={`personalization.${section}`}
        >
          {list.map((row) => {
            const editable = row.effect.priority !== undefined;
            return (
              <View
                key={row.id}
                style={[styles.row, { opacity: row.enabled ? 1 : 0.55 }]}
                accessible
                accessibilityLabel={`${row.statement}${row.evidence_summary === null ? '' : `, ${row.evidence_summary}`}`}
                accessibilityActions={[
                  ...(editable ? [{ name: 'edit', label: t('common.actions.edit') }] : []),
                  { name: 'delete', label: t('common.actions.delete') },
                  {
                    name: 'toggle',
                    label: row.enabled ? t('common.actions.turnOff') : t('common.actions.turnOn'),
                  },
                ]}
                onAccessibilityAction={(event) => {
                  const name = event.nativeEvent.actionName;
                  if (name === 'edit') openEdit(row);
                  else if (name === 'delete') remove(row);
                  else toggle(row);
                }}
                testID={`personalization.row.${row.id}`}
              >
                <View style={styles.text}>
                  <Text variant="rowTitle">{row.statement}</Text>
                  {row.evidence_summary === null ? null : (
                    <Text variant="meta" tone="tertiaryStrong">
                      {row.evidence_summary}
                    </Text>
                  )}
                </View>
                {editable ? (
                  <IconButton
                    icon="edit"
                    variant="plain"
                    accessibilityLabel={t('common.actions.edit')}
                    onPress={() => {
                      openEdit(row);
                    }}
                    testID={`personalization.edit.${row.id}`}
                  />
                ) : null}
                <IconButton
                  icon="delete"
                  variant="plain"
                  accessibilityLabel={t('common.actions.delete')}
                  onPress={() => {
                    remove(row);
                  }}
                  testID={`personalization.delete.${row.id}`}
                />
                <Switch
                  value={row.enabled}
                  accessibilityLabel={row.statement}
                  onValueChange={() => {
                    toggle(row);
                  }}
                  testID={`personalization.toggle.${row.id}`}
                />
              </View>
            );
          })}
        </SettingsGroup>
      );
    });
  }

  return (
    <SettingsPage
      title={t('settings.personalizationScreen.title')}
      subtitle={t('settings.personalizationScreen.subtitle')}
      refreshing={learned.isRefetching}
      onRefresh={() => {
        void learned.refetch();
      }}
      testID="screen.settings.personalization"
    >
      <SettingsGroup>
        <ListRow
          icon="psychology"
          title={t('settings.personalization.learnToggle')}
          subtitle={t('settings.personalizationScreen.learnMeta')}
          trailing={{ kind: 'switch', value: learning }}
          onPress={() => {
            track('learning_toggled', { enabled: !learning });
            void saveUserPreferences({ learn_from_interactions: !learning });
          }}
          testID="personalization.learn"
        />
      </SettingsGroup>
      {learning ? null : <Caption>{t('settings.personalizationScreen.learningOff')}</Caption>}
      {body}
      <Button
        label={t('settings.personalization.writeRule')}
        variant="text"
        size="sm"
        onPress={() => {
          router.push('/settings/priority-rules');
        }}
        testID="personalization.rules"
      />
      <View style={{ height: theme.space[2] }} />

      <BottomSheet
        visible={editing !== null}
        onDismiss={() => {
          setEditing(null);
        }}
        dismissible={!saving}
        title={t('settings.personalizationScreen.editTitle')}
        testID="sheet.learnedEdit"
        footer={
          <View style={styles.buttons}>
            <Button
              label={t('common.actions.save')}
              variant="ink"
              fullWidth
              loading={saving}
              onPress={() => {
                const row = editing;
                if (row === null) return;
                setSaving(true);
                track('learned_pref_edited', {
                  group: row.group_key,
                  priority,
                  kind: row.group_key,
                });
                void mutate(row, { priority_override: priority }, (list) =>
                  list.map((r) => (r.id === row.id ? { ...r, priority_override: priority } : r)),
                ).then((ok) => {
                  setSaving(false);
                  if (ok) setEditing(null);
                });
              }}
              testID="learnedEdit.save"
            />
            <Button
              label={t('common.actions.nevermind')}
              variant="text"
              fullWidth
              disabled={saving}
              onPress={() => {
                setEditing(null);
              }}
            />
          </View>
        }
      >
        {editing === null ? null : (
          <>
            <Text variant="body">{editing.statement}</Text>
            <View accessibilityRole="radiogroup">
              {PRIORITIES.map((value) => (
                <ListRow
                  key={value}
                  title={t(`settings.personalization.priority.${value}`)}
                  trailing={{ kind: 'radio', selected: priority === value }}
                  onPress={() => {
                    setPriority(value);
                  }}
                  testID={`learnedEdit.${value}`}
                />
              ))}
            </View>
          </>
        )}
      </BottomSheet>
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  text: { flex: 1, gap: 2 },
  buttons: { gap: 8 },
});

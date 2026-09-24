/**
 * Sheets of the Android NI settings screen: M-ANI-02 prominent disclosure (affirmative consent
 * before the system settings handoff), M-ANI-03 app picker (manual picks for "Seçili uygulamalar"
 * and per-app importance through `android_app` priority rules) and M-ANI-04 always-excluded list.
 */
import { foldForSearch } from '@da/i18n';
import { qk } from '@da/api-client';
import type { RuleOutcome } from '@da/domain';
import {
  BottomSheet,
  Button,
  GroupedList,
  ListRow,
  SearchField,
  SectionHeader,
  SegmentedControl,
  Text,
} from '@da/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { now } from '../../lib/clock';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { showToast } from '../../providers/ToastHost';
import { EMPTY_DRAFT, patchRule, rulesQueryOptions, saveRule } from '../rules/rules';
import { niCall, type NiCandidateApp } from './native';
import { NiChoiceList } from './NiChoiceList';
import { LOCKED_GROUPS, NI_PRESETS, type NiCategoryChoice, type NiPresetKey } from './presets';

// ── M-ANI-02 ──────────────────────────────────────────────────────────────────────────────────

export interface DisclosureSheetProps {
  readonly visible: boolean;
  readonly categories: NiCategoryChoice;
  readonly onToggle: (key: NiPresetKey, value: boolean) => void;
  readonly onAccept: () => void;
  readonly onDismiss: () => void;
}

export function DisclosureSheet({
  visible,
  categories,
  onToggle,
  onAccept,
  onDismiss,
}: DisclosureSheetProps) {
  const t = useTranslations();
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title={t('onboarding.androidNotifications.title')}
      subtitle={t('onboarding.androidNotifications.body')}
      testID="sheet.aniDisclosure"
      footer={
        <View style={styles.footer}>
          <Button
            label={t('android_ni.grantCta')}
            fullWidth
            onPress={onAccept}
            testID="aniDisclosure.accept"
          />
          <Text variant="secondary" tone="tertiaryStrong" align="center">
            {t('android_ni.disclosureSheet.footnote')}
          </Text>
          <Button
            label={t('common.actions.nevermind')}
            variant="text"
            fullWidth
            onPress={onDismiss}
            testID="aniDisclosure.cancel"
          />
        </View>
      }
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.gap}>
        <Text variant="kicker" tone="secondary">
          {t('onboarding.androidNotifications.kicker')}
        </Text>
        <NiChoiceList
          categories={categories}
          onToggle={onToggle}
          showCategories
          testID="aniDisclosure"
        />
      </ScrollView>
    </BottomSheet>
  );
}

// ── M-ANI-04 ──────────────────────────────────────────────────────────────────────────────────

export function DenylistSheet({
  visible,
  onDismiss,
}: {
  readonly visible: boolean;
  readonly onDismiss: () => void;
}) {
  const t = useTranslations();
  const installed = useMemo(
    () => (visible ? niCall([], (ni) => ni.listCandidateApps()).filter((a) => a.locked) : []),
    [visible],
  );
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title={t('android_ni.denylist.title')}
      testID="sheet.aniDenylist"
      footer={
        <Button
          label={t('common.actions.ok')}
          fullWidth
          onPress={onDismiss}
          testID="aniDenylist.done"
        />
      }
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.gap}>
        {LOCKED_GROUPS.map((group) => {
          const labels =
            group === 'own_app'
              ? [t('android_ni.denylist.ownApp')]
              : installed.filter((a) => a.lockedGroup === group).map((a) => a.label);
          return (
            <View key={group} style={styles.group} testID={`aniDenylist.group.${group}`}>
              <Text variant="h3" heading>
                {t(`android_ni.denylist.groups.${group}`)}
              </Text>
              {labels.length === 0 ? null : (
                <Text variant="secondary" tone="secondary">
                  {labels.join(', ')}
                </Text>
              )}
            </View>
          );
        })}
        <Text variant="secondary" tone="tertiaryStrong">
          {t('android_ni.denylist.note')}
        </Text>
      </ScrollView>
    </BottomSheet>
  );
}

// ── M-ANI-03 ──────────────────────────────────────────────────────────────────────────────────

type Importance = 'important' | 'normal' | 'ignore';

const OUTCOME: Readonly<Record<Exclude<Importance, 'normal'>, RuleOutcome>> = {
  important: 'always_important',
  ignore: 'mute',
};

export interface AppPickerSheetProps {
  readonly visible: boolean;
  readonly categories: NiCategoryChoice;
  readonly manual: readonly string[];
  readonly onApply: (manual: readonly string[]) => void;
  readonly onDismiss: () => void;
}

export function AppPickerSheet(props: AppPickerSheetProps) {
  const t = useTranslations();
  return (
    <BottomSheet
      visible={props.visible}
      onDismiss={props.onDismiss}
      title={t('android_ni.picker.title')}
      testID="sheet.aniPicker"
    >
      {props.visible ? <AppPicker {...props} /> : null}
    </BottomSheet>
  );
}

function AppPicker({ categories, manual, onApply }: AppPickerSheetProps) {
  const t = useTranslations();
  const online = useOnline();
  const queryClient = useQueryClient();
  const rules = useQuery(rulesQueryOptions());
  const apps = useMemo(() => niCall([], (ni) => ni.listCandidateApps()), []);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(manual));
  const [importance, setImportance] = useState<Readonly<Record<string, Importance>>>({});

  const presetOf = (pkg: string) =>
    NI_PRESETS.find((p) => categories[p.key] && p.packages.includes(pkg));
  const ruleOf = (pkg: string) =>
    (rules.data ?? []).find(
      (r) => r.condition_type === 'android_app' && r.condition_value.package === pkg,
    );
  const importanceOf = (pkg: string): Importance => {
    const local = importance[pkg];
    if (local !== undefined) return local;
    const rule = ruleOf(pkg);
    if (rule === undefined) return 'normal';
    return rule.outcome === 'mute' ? 'ignore' : 'important';
  };

  const folded = foldForSearch(query.trim());
  const visible = apps.filter(
    (a) =>
      folded === '' ||
      foldForSearch(a.label).includes(folded) ||
      a.package.toLowerCase().includes(folded),
  );
  const senders = visible.filter((a) => a.seenCount > 0).sort((a, b) => b.seenCount - a.seenCount);
  const others = visible
    .filter((a) => a.seenCount === 0)
    .sort((a, b) => a.label.localeCompare(b.label, 'tr'));

  const changeImportance = async (app: NiCandidateApp, next: Importance) => {
    const previous = importanceOf(app.package);
    if (previous === next) return;
    setImportance((current) => ({ ...current, [app.package]: next }));
    const rule = ruleOf(app.package);
    try {
      if (next === 'normal') {
        if (rule !== undefined) await patchRule(rule.id, { deleted_at: now().toISOString() });
      } else if (rule !== undefined) {
        await patchRule(rule.id, { outcome: OUTCOME[next] });
      } else {
        await saveRule(null, {
          ...EMPTY_DRAFT,
          condition: 'android_app',
          appPackage: app.package,
          outcome: OUTCOME[next],
        });
        track('priority_rule_created', { condition_type: 'android_app', outcome: OUTCOME[next] });
      }
      void queryClient.invalidateQueries({ queryKey: qk.rules.all });
    } catch {
      setImportance((current) => ({ ...current, [app.package]: previous }));
      showToast({ message: t('android_ni.picker.ruleFailed'), kind: 'error' });
    }
  };

  const row = (app: NiCandidateApp) => {
    const preset = presetOf(app.package);
    const checked = picked.has(app.package) || preset !== undefined;
    const subtitle = app.locked
      ? t('android_ni.picker.locked')
      : preset !== undefined
        ? t('android_ni.picker.viaCategory', {
            category: t(`onboarding.androidNotifications.groups.${preset.key}.title`),
          })
        : app.seenCount > 0
          ? t('android_ni.picker.seenMeta', { count: app.seenCount })
          : undefined;
    return (
      <View key={app.package}>
        <ListRow
          icon="apps"
          title={app.label}
          {...(subtitle === undefined ? {} : { subtitle })}
          trailing={{ kind: 'check', checked: checked && !app.locked }}
          disabled={app.locked || preset !== undefined}
          onPress={() => {
            setPicked((current) => {
              const next = new Set(current);
              if (next.has(app.package)) next.delete(app.package);
              else next.add(app.package);
              return next;
            });
          }}
          testID={`aniPicker.app.${app.package}`}
        />
        {checked && !app.locked ? (
          <View style={styles.importance}>
            <SegmentedControl
              options={[
                { key: 'important', label: t('android_ni.picker.importance.important') },
                { key: 'normal', label: t('android_ni.picker.importance.normal') },
                { key: 'ignore', label: t('android_ni.picker.importance.ignore') },
              ]}
              selectedKey={importanceOf(app.package)}
              semantics="radio"
              size={30}
              disabled={!online}
              onChange={(key) => {
                const next: Importance =
                  key === 'important' ? 'important' : key === 'ignore' ? 'ignore' : 'normal';
                void changeImportance(app, next);
              }}
              accessibilityLabel={t('android_ni.picker.tuneA11y', { app: app.label })}
              testID={`aniPicker.importance.${app.package}`}
            />
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.picker}>
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder={t('android_ni.picker.search')}
        accessibilityLabel={t('android_ni.picker.search')}
        testID="aniPicker.search"
      />
      {online ? null : (
        <Text variant="secondary" tone="tertiaryStrong">
          {t('android_ni.picker.offlineImportance')}
        </Text>
      )}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.gap}>
        {apps.length === 0 ? (
          <Text variant="body" tone="secondary" testID="aniPicker.noApps">
            {t('android_ni.picker.noApps')}
          </Text>
        ) : visible.length === 0 ? (
          <Text variant="body" tone="secondary" testID="aniPicker.empty">
            {t('android_ni.picker.empty')}
          </Text>
        ) : null}
        {senders.length === 0 ? null : (
          <>
            <SectionHeader title={t('android_ni.picker.senders')} />
            <GroupedList>{senders.map(row)}</GroupedList>
          </>
        )}
        {others.length === 0 ? null : (
          <>
            <SectionHeader title={t('android_ni.picker.others')} />
            <GroupedList>{others.map(row)}</GroupedList>
          </>
        )}
      </ScrollView>
      <Button
        label={t('common.actions.ok')}
        fullWidth
        onPress={() => {
          const next = [...picked].filter(
            (pkg) => !apps.some((a) => a.package === pkg && a.locked),
          );
          track('android_ni_apps_selected', { count: next.length });
          onApply(next);
        }}
        testID="aniPicker.done"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { gap: 8 },
  scroll: { flexShrink: 1 },
  gap: { gap: 12, paddingBottom: 8 },
  group: { gap: 4 },
  picker: { gap: 12, flexShrink: 1 },
  importance: { paddingHorizontal: 16, paddingBottom: 12 },
});

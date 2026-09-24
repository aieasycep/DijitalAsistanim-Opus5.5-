/**
 * The 2.13 content shared by the onboarding step (M-ON-14A), the prominent disclosure (M-ANI-02)
 * and the settings screen (M-ANI-01): the category presets as switches, the locked messaging row
 * ("her zaman hariç", not toggleable), the locked security row (opens the always-excluded sheet)
 * and the R-15 assurance box.
 */
import { AssuranceBox, GroupedList, ListRow, SectionHeader } from '@da/ui';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { NI_PRESETS, type NiCategoryChoice, type NiPresetKey } from './presets';

export interface NiChoiceListProps {
  readonly categories: NiCategoryChoice;
  readonly onToggle: (key: NiPresetKey, value: boolean) => void;
  /** Hidden in "Tüm uygulamalar" (every app except the denylist is read). */
  readonly showCategories: boolean;
  /** The security row opens M-ANI-04; without it the row is static text. */
  readonly onLockedPress?: () => void;
  readonly testID: string;
}

export function NiCategoryRows({
  categories,
  onToggle,
  testID,
}: Pick<NiChoiceListProps, 'categories' | 'onToggle' | 'testID'>) {
  const t = useTranslations('onboarding.androidNotifications');
  return (
    <>
      {NI_PRESETS.map((preset) => (
        <ListRow
          key={preset.key}
          title={t(`groups.${preset.key}.title`)}
          subtitle={t(`groups.${preset.key}.meta`)}
          trailing={{ kind: 'switch', value: categories[preset.key] }}
          onPress={() => {
            const value = !categories[preset.key];
            onToggle(preset.key, value);
            track('android_ni_category_toggled', { category: preset.event, enabled: value });
          }}
          testID={`${testID}.category.${preset.key}`}
        />
      ))}
    </>
  );
}

export function NiChoiceList({
  categories,
  onToggle,
  showCategories,
  onLockedPress,
  testID,
}: NiChoiceListProps) {
  const t = useTranslations();
  return (
    <View style={styles.root}>
      {showCategories ? (
        <>
          <SectionHeader title={t('android_ni.apps')} />
          <GroupedList testID={`${testID}.categories`}>
            <NiCategoryRows categories={categories} onToggle={onToggle} testID={testID} />
          </GroupedList>
        </>
      ) : null}
      <GroupedList testID={`${testID}.locked`}>
        <ListRow
          icon="lock"
          title={t('android_ni.disclosureSheet.messagingTitle')}
          subtitle={t('android_ni.disclosureSheet.messagingMeta')}
          accessibilityLabel={t('android_ni.disclosureSheet.messagingA11y')}
          testID={`${testID}.messaging`}
        />
        <ListRow
          icon="lock"
          title={t('onboarding.androidNotifications.lockedTitle')}
          subtitle={t('onboarding.androidNotifications.lockedMeta')}
          accessibilityLabel={t('onboarding.androidNotifications.lockedA11y')}
          {...(onLockedPress === undefined
            ? {}
            : { onPress: onLockedPress, trailing: { kind: 'chevron' as const } })}
          testID={`${testID}.security`}
        />
      </GroupedList>
      <AssuranceBox
        rows={[
          { key: 'device', icon: 'phonelink', text: t('privacy.storage.androidNi') },
          { key: 'chat', icon: 'shield', text: t('android_ni.disclosureSheet.chatNote') },
        ]}
        testID={`${testID}.assurance`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12 },
});

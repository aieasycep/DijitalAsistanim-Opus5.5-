/**
 * M-TD-02 correction "···" sheet (sheet(host) `insight_correction`): "Bunu nasıl
 * değerlendireyim?" — each option commits immediately through RPC-21 `apply_insight_feedback`
 * with a "Geri al" toast (RPC-22). "Bu kişiyi VIP yap" is shown only when the card has a person
 * and is locked (gate `vip`) on Free; the server rejects it without Pro. The reason line opens the
 * explain sheet; "Kaynağı aç" appears only when the source screen exists.
 */
import { BottomSheet, InlineErrorCard, OptionRow, TextAction } from '@da/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { cachedBootstrap } from '../../../lib/postgrest';
import { registerSheet, sheets, type SheetRenderProps } from '../../../providers/SheetHost';
import { isPro, openProGate } from '../../pro-gate/ProGate';
import { applyFeedback, type FeedbackKind } from '../actions';
import type { TodayPriority } from '../data';
import { routeForSource } from '../sources';
import { INSIGHT_WHY_SHEET } from './WhySheet';

export const INSIGHT_CORRECTION_SHEET = 'insight_correction';

export interface CorrectionParams {
  readonly item: TodayPriority;
  readonly localDate: string;
}

function CorrectionSheet({
  params,
  visible,
  onDismiss,
  onHidden,
}: SheetRenderProps<CorrectionParams>) {
  const t = useTranslations('correction');
  const today = useTranslations('today.correction');
  const common = useTranslations('common');
  const [busy, setBusy] = useState<FeedbackKind | null>(null);
  const [failed, setFailed] = useState(false);
  const learning = cachedBootstrap()?.preferences.learn_from_interactions ?? true;
  const pro = isPro();
  const item = params.item;
  // The VIP option needs a resolved person (M-TD-02 "Empty"): only contact-linked insights.
  const person = item.entity_type === 'contact';
  const source = routeForSource(item.source?.source_type, item.source?.source_id);

  const choose = async (kind: FeedbackKind) => {
    if (kind === 'make_vip' && !pro) {
      openProGate('vip');
      return;
    }
    setBusy(kind);
    setFailed(false);
    const ok = await applyFeedback(item, params.localDate, kind, learning);
    setBusy(null);
    if (ok) onDismiss();
    else setFailed(true);
  };

  const options: {
    key: FeedbackKind;
    icon: 'remove_circle' | 'trending_up' | 'star' | 'visibility_off';
    label: string;
  }[] = [
    { key: 'not_important', icon: 'remove_circle', label: t('options.not_important') },
    { key: 'show_more', icon: 'trending_up', label: t('options.show_more') },
    ...(person
      ? [{ key: 'make_vip' as const, icon: 'star' as const, label: t('options.make_vip') }]
      : []),
    { key: 'stop_tracking', icon: 'visibility_off', label: t('options.stop_tracking') },
  ];

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      title={t('title')}
      subtitle={t('subtitle')}
      dismissible={busy === null}
      testID="sheet.correction"
    >
      <View style={styles.body}>
        {item.why_important === null ? null : (
          <TextAction
            label={today('reason', { reason: item.why_important })}
            emphasis="secondary"
            onPress={() => {
              sheets.open(INSIGHT_WHY_SHEET, { targetType: 'insight', targetId: item.id });
            }}
            testID="correction.reason"
          />
        )}
        {options.map((option) => (
          <OptionRow
            key={option.key}
            label={option.label}
            icon={option.key === 'make_vip' && !pro ? 'lock' : option.icon}
            role="button"
            {...(option.key === 'make_vip' && !pro ? { meta: common('a11y.proFeature') } : {})}
            disabled={busy !== null && busy !== option.key}
            onPress={() => {
              void choose(option.key);
            }}
            testID={`correction.${option.key}`}
          />
        ))}
        {!learning ? <InlineErrorCard icon="info" tone="neutral" title={t('learningOff')} /> : null}
        {failed ? (
          <InlineErrorCard
            icon="error"
            tone="critical"
            title={common('toast.saveFailed')}
            testID="correction.error"
          />
        ) : null}
        {source === null ? null : (
          <TextAction
            label={common('actions.openSource')}
            onPress={() => {
              onDismiss();
              router.push(source);
            }}
            testID="correction.source"
          />
        )}
      </View>
    </BottomSheet>
  );
}

registerSheet<CorrectionParams>(
  INSIGHT_CORRECTION_SHEET,
  (props) => <CorrectionSheet {...props} />,
  {
    analyticsKey: 'correction',
  },
);

const styles = StyleSheet.create({ body: { gap: 6 } });

/**
 * Irreversible confirmations (DESIGN_AUDIT §3.9). P:01 (verbatim): "Modal yalnızca geri alınamaz
 * işlemler için (bağlantı kaldırma, silme)."
 * - `ConfirmDialog`: centred card, width min(320, screen − 48), r24, padding 22, `shadow.modal`;
 *   IconTile 48 critical; title + body centred; destructive 48 button and a same-width "Vazgeç".
 *   Focus moves to the title; back / escape cancel.
 * - `DestructiveSheet`: a `BottomSheet` with IconTile 52, `h2` title, body, the "Silinen / Korunan"
 *   info box, a destructive `lg` CTA and a neutral "Vazgeç" of the same size (D-11).
 */
import { useEffect, useRef, type JSX } from 'react';
import { Modal, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import type { IconName } from '../icons/generated/index.ts';
import { IconTile } from '../primitives/IconTile.tsx';
import { Text } from '../primitives/Text.tsx';
import { focusAccessibility } from '../theme/a11y.ts';
import { useHaptic, useMotion } from '../theme/preferences.tsx';
import { useTheme } from '../theme/ThemeProvider.tsx';
import { Button } from '../components/buttons/Button.tsx';
import { BottomSheet } from './BottomSheet.tsx';

interface DialogAction {
  readonly label: string;
  readonly onPress: () => void;
  readonly loading?: boolean;
  readonly loadingLabel?: string;
}

export interface ConfirmDialogProps {
  readonly visible: boolean;
  readonly title: string;
  readonly body?: string;
  readonly icon?: IconName;
  /** "Kaldır" / "Sil" */
  readonly confirm: DialogAction;
  /** "Vazgeç" (also the back/escape/scrim action). */
  readonly cancel: DialogAction;
  readonly testID?: string;
}

export function ConfirmDialog({
  visible,
  title,
  body,
  icon = 'delete',
  confirm,
  cancel,
  testID,
}: ConfirmDialogProps): JSX.Element {
  const theme = useTheme();
  const motionControl = useMotion();
  const haptic = useHaptic();
  const window = useWindowDimensions();
  const titleRef = useRef<View>(null);
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (!visible) return;
    haptic('warning');
    opacity.set(0);
    opacity.set(motionControl.fade(1, theme.motion.duration.dim));
    focusAccessibility(titleRef);
  }, [visible, haptic, motionControl, opacity, theme.motion.duration.dim]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const busy = confirm.loading === true;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => {
        if (!busy) cancel.onPress();
      }}
    >
      <Animated.View
        testID={testID ?? 'ui.confirmDialog'}
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: theme.color.overlay.scrim,
            alignItems: 'center',
            justifyContent: 'center',
          },
          fade,
        ]}
      >
        <View
          accessibilityViewIsModal
          onAccessibilityEscape={() => {
            if (!busy) cancel.onPress();
          }}
          style={[
            {
              width: Math.min(320, window.width - 48),
              backgroundColor: theme.color.surface,
              borderRadius: theme.radius.modal,
              padding: 22,
              alignItems: 'center',
              gap: 10,
            },
            theme.elevation('modal'),
          ]}
        >
          <IconTile icon={icon} size={48} tone="critical" />
          <View ref={titleRef} accessible accessibilityRole="header">
            <Text variant="titleMd" align="center">
              {title}
            </Text>
          </View>
          {body === undefined ? null : (
            <Text variant="bodyXs" tone="secondary" align="center">
              {body}
            </Text>
          )}
          <View style={{ alignSelf: 'stretch', gap: 6, marginTop: 8 }}>
            <Button
              label={confirm.label}
              onPress={confirm.onPress}
              loading={confirm.loading}
              loadingLabel={confirm.loadingLabel}
              variant="destructive"
              size="md"
              fullWidth
              testID="ui.confirmDialog.confirm"
            />
            <Button
              label={cancel.label}
              onPress={cancel.onPress}
              variant="text"
              fullWidth
              disabled={busy}
              testID="ui.confirmDialog.cancel"
            />
          </View>
        </View>
      </Animated.View>
    </Modal>
  );
}

export interface DestructiveSheetProps {
  readonly visible: boolean;
  readonly icon?: IconName;
  readonly title: string;
  readonly body?: string;
  /** "Silinen: … / Korunan: …" */
  readonly consequences?: readonly string[];
  /** "Geçmişi Sil" */
  readonly confirm: DialogAction;
  /** "Vazgeç" */
  readonly cancel: DialogAction;
  readonly onHidden?: () => void;
  readonly testID?: string;
}

export function DestructiveSheet({
  visible,
  icon = 'delete_sweep',
  title,
  body,
  consequences,
  confirm,
  cancel,
  onHidden,
  testID,
}: DestructiveSheetProps): JSX.Element {
  const theme = useTheme();
  const busy = confirm.loading === true;
  return (
    <BottomSheet
      visible={visible}
      onDismiss={cancel.onPress}
      onHidden={onHidden}
      variant="destructive"
      dismissible={!busy}
      accessibilityLabel={title}
      testID={testID ?? 'ui.destructiveSheet'}
      footer={
        <>
          <Button
            label={confirm.label}
            onPress={confirm.onPress}
            loading={confirm.loading}
            loadingLabel={confirm.loadingLabel}
            variant="destructive"
            size="lg"
            fullWidth
            testID="ui.destructiveSheet.confirm"
          />
          <Button
            label={cancel.label}
            onPress={cancel.onPress}
            variant="neutralTonal"
            size="lg"
            fullWidth
            disabled={busy}
            testID="ui.destructiveSheet.cancel"
          />
        </>
      }
    >
      <View style={{ gap: 12 }}>
        <IconTile icon={icon} size={52} tone="critical" />
        <View accessible accessibilityRole="header">
          <Text variant="h2">{title}</Text>
        </View>
        {body === undefined ? null : <Text variant="body">{body}</Text>}
        {consequences === undefined || consequences.length === 0 ? null : (
          <View
            style={{
              backgroundColor: theme.color.bg,
              borderRadius: theme.radius.button,
              paddingVertical: 12,
              paddingHorizontal: 14,
              gap: 4,
            }}
          >
            {consequences.map((line) => (
              <Text key={line} variant="bodyXs">
                {line}
              </Text>
            ))}
          </View>
        )}
      </View>
    </BottomSheet>
  );
}

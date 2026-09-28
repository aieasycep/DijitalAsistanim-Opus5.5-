/**
 * The paste affordance of the capture composer (KNOWN_PLATFORM_LIMITATIONS KPL-23). iOS 16+ reads
 * the pasteboard without its "Allow Paste" prompt only through the system paste control, so there
 * the composer shows `ClipboardPasteButton` (`UIPasteControl`: system label and icon, text only);
 * elsewhere the "Yapıştır" chip reads the clipboard after the tap (Android 12+ shows its own
 * "pasted from your clipboard" toast). The clipboard is never read on its own.
 */
import { AssistChip, useTheme } from '@da/ui';
import * as Clipboard from 'expo-clipboard';
import { Platform, StyleSheet, View } from 'react-native';

export function usesSystemPasteControl(): boolean {
  return Platform.OS === 'ios' && Clipboard.isPasteButtonAvailable;
}

export function PasteControl({
  label,
  onText,
  testID,
}: {
  /** "Yapıştır" (the system control uses the iOS label). */
  readonly label: string;
  /** Receives the pasted text (may be empty). */
  readonly onText: (text: string) => void;
  readonly testID: string;
}) {
  const theme = useTheme();
  if (usesSystemPasteControl()) {
    return (
      <View style={styles.system} testID={`${testID}.system`}>
        <Clipboard.ClipboardPasteButton
          acceptedContentTypes={['plain-text']}
          displayMode="iconAndLabel"
          cornerStyle="capsule"
          backgroundColor={theme.tone.neutral.soft}
          foregroundColor={theme.tone.neutral.text}
          style={styles.systemButton}
          onPress={(data) => {
            onText(data.type === 'text' ? data.text : '');
          }}
        />
      </View>
    );
  }
  return (
    <AssistChip
      label={label}
      icon="content_paste"
      onPress={() => {
        void Clipboard.getStringAsync()
          .catch(() => '')
          .then(onText);
      }}
      testID={testID}
    />
  );
}

const styles = StyleSheet.create({
  system: { minHeight: 44, justifyContent: 'center' },
  // UIPasteControl needs an explicit size; 30 high like the kit's assist chips.
  systemButton: { height: 30, width: 112 },
});

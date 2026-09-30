/**
 * Plain text with the "Kopyala" long-press (SCREEN_AND_FLOW_MAP Part 2 §0 "plain text, no
 * auto-linking; long-press offers Kopyala"): a long press opens the action menu with "Kopyala",
 * which writes the text to the clipboard (`expo-clipboard`) and confirms with "Kopyalandı". Screen
 * readers get the same action as an accessibility action.
 */
import { Text, useToast, type TextProps } from '@da/ui';
import * as Clipboard from 'expo-clipboard';
import { Pressable } from 'react-native';
import { useTranslations } from 'use-intl';

import { openMenu } from './sheets';

export interface CopyableTextProps {
  readonly text: string;
  readonly variant?: TextProps['variant'];
  readonly numberOfLines?: number;
  readonly testID?: string;
}

export function CopyableText({ text, variant = 'body', numberOfLines, testID }: CopyableTextProps) {
  const tc = useTranslations('common');
  const toast = useToast();
  const copy = () => {
    void Clipboard.setStringAsync(text)
      .then(() => {
        toast.show({ message: tc('toast.copied'), kind: 'success' });
      })
      .catch(() => undefined);
  };
  return (
    <Pressable
      onLongPress={() => {
        openMenu({
          options: [
            { key: 'copy', label: tc('actions.copy'), icon: 'content_copy', onPress: copy },
          ],
        });
      }}
      accessibilityActions={[{ name: 'copy', label: tc('actions.copy') }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'copy') copy();
      }}
      {...(testID === undefined ? {} : { testID: `${testID}.copyable` })}
    >
      <Text
        variant={variant}
        {...(numberOfLines === undefined ? {} : { numberOfLines })}
        {...(testID === undefined ? {} : { testID })}
      >
        {text}
      </Text>
    </Pressable>
  );
}

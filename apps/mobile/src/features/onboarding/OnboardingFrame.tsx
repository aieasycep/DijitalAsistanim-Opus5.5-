/**
 * Shared layout of the post-auth onboarding steps (P/02 2.6–2.13): the step header ("ADIM n / 4 ·
 * …", back circle, optional "Atla"), the title and subtitle, the scrolling body and a sticky CTA
 * area that never covers content. Safe-area aware; Dynamic Type grows the content, not the chrome.
 */
import { StepHeader, StickyCTABar, Text, useTheme } from '@da/ui';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

export interface OnboardingFrameProps {
  readonly kicker?: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly onBack?: () => void;
  readonly skip?: { readonly label: string; readonly onPress: () => void };
  readonly footer?: ReactNode;
  readonly children?: ReactNode;
  readonly testID?: string;
}

export function OnboardingFrame({
  kicker,
  title,
  subtitle,
  onBack,
  skip,
  footer,
  children,
  testID,
}: OnboardingFrameProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const actions = useTranslations('common.actions');
  return (
    <View
      style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}
      testID={testID}
    >
      {kicker === undefined ? null : (
        <StepHeader
          kicker={kicker}
          {...(onBack === undefined ? {} : { onBack, backAccessibilityLabel: actions('back') })}
          {...(skip === undefined ? {} : { skip })}
        />
      )}
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.layout.screenX }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text variant="h1" heading>
          {title}
        </Text>
        {subtitle === undefined ? null : (
          <Text variant="body" tone="secondary" style={styles.subtitle}>
            {subtitle}
          </Text>
        )}
        <View style={styles.body}>{children}</View>
      </ScrollView>
      {footer === undefined ? null : (
        <StickyCTABar style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
          <View style={styles.footer}>{footer}</View>
        </StickyCTABar>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingTop: 12, paddingBottom: 32 },
  subtitle: { marginTop: 8 },
  body: { marginTop: 20, gap: 12 },
  footer: { gap: 8 },
});

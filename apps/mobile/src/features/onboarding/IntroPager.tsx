/**
 * M-ON-01…04 intro pages (`(onboarding)/welcome?page=n`; `noise`, `proactive` and `control`
 * redirect here): brand, noise reduction, proactive briefing and control. A horizontal paging list
 * synced with `?page` and `useOnboardingStore.introIndex`; the dots are an adjustable control
 * ("Tanıtım, sayfa n / 4"). Illustrations are single, non-interactive accessibility elements with
 * the illustrative example copy of the catalog (S-03). Works offline; no data is loaded.
 */
import { toUpper } from '@da/i18n';
import {
  Badge,
  Button,
  GradientSurface,
  IllustrationFrame,
  KeyValueGrid,
  PageDots,
  PressableScale,
  Surface,
  Text,
  useTheme,
} from '@da/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale, useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { updateOnboardingState } from './store';

const PAGES = ['welcome', 'noise', 'proactive', 'control'] as const;
type Page = (typeof PAGES)[number];

/** Illustrative figures of the noise page (catalog-marked example copy, S-03). */
const EXAMPLE_EMAILS = 127;
const EXAMPLE_ITEMS = 3;
const EXAMPLE_TIME = '08:00';
const EXAMPLE_MINUTES = 2;

function pageFromParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < PAGES.length ? n : 0;
}

function NoiseIllustration() {
  const t = useTranslations('onboarding.noise');
  const theme = useTheme();
  return (
    <IllustrationFrame
      accessibilityLabel={t('a11y', { emails: EXAMPLE_EMAILS, items: EXAMPLE_ITEMS })}
      style={styles.illustration}
    >
      <Text variant="display" numeric align="center">
        {t('summary', { emails: EXAMPLE_EMAILS, items: EXAMPLE_ITEMS })}
      </Text>
      <View style={{ gap: theme.space[2], marginTop: 16 }}>
        <Surface elevation="card" radius="card" padding={12}>
          <Badge label={t('examples.urgentBadge')} category="urgent" size="sm" />
          <Text variant="body">{t('examples.urgent')}</Text>
        </Surface>
        <Surface elevation="card" radius="card" padding={12}>
          <Badge label={t('examples.deadlineBadge')} category="deadline" size="sm" />
          <Text variant="body">{t('examples.deadline')}</Text>
        </Surface>
        <Surface elevation="card" radius="card" padding={12}>
          <Badge label={t('examples.followUpBadge')} category="neutral" size="sm" />
          <Text variant="body">{t('examples.followUp')}</Text>
        </Surface>
      </View>
    </IllustrationFrame>
  );
}

function ProactiveIllustration() {
  const t = useTranslations('onboarding.proactive');
  return (
    <IllustrationFrame accessibilityLabel={t('a11y')} tilt={-2} style={styles.illustration}>
      <Surface elevation="card" radius="hero" padding={18}>
        <Text variant="kicker" tone="accent">
          {t('kicker', { time: EXAMPLE_TIME })}
        </Text>
        <Text variant="h2" style={styles.gap}>
          {t('greeting')}
        </Text>
        <Text variant="editorial" style={styles.gap}>
          {t('sampleHeadline')}
        </Text>
        <Text variant="secondary" tone="secondary" style={styles.gap}>
          {t('sampleBody')}
        </Text>
        <Text variant="kicker" tone="accent" style={styles.gap}>
          {t('listen', { minutes: EXAMPLE_MINUTES })}
        </Text>
      </Surface>
    </IllustrationFrame>
  );
}

function ControlIllustration() {
  const t = useTranslations('onboarding.control');
  const types = useTranslations('approvals');
  return (
    <IllustrationFrame accessibilityLabel={t('a11y')} tilt={1.5} style={styles.illustration}>
      <Surface elevation="card" radius="hero" padding={18}>
        <View style={styles.row}>
          <Badge label={types('types.email_send')} category="neutral" size="sm" />
          <Badge label={types('statuses.pending')} category="neutral" size="sm" />
        </View>
        <Text variant="h3" style={styles.gap}>
          {t('sampleAction')}
        </Text>
        <KeyValueGrid
          style={styles.gap}
          items={[
            { key: 'why', label: t('whyLabel'), value: t('whySample') },
            { key: 'change', label: t('changeLabel'), value: t('changeSample') },
          ]}
        />
      </Surface>
    </IllustrationFrame>
  );
}

function PageBody({ page }: { readonly page: Page }) {
  const t = useTranslations('onboarding');
  const app = useTranslations('common.app');
  const locale = useLocale();
  switch (page) {
    case 'welcome':
      return (
        <View style={styles.pageText}>
          <Text variant="kicker" tone="onGradientSecondary">
            {toUpper(t('welcome.kicker'), locale === 'en' ? 'en' : 'tr')}
          </Text>
          <Text variant="display" tone="onGradient" heading>
            {app('tagline')}
          </Text>
          <Text variant="body" tone="onGradientSecondary">
            {t('welcome.body')}
          </Text>
        </View>
      );
    case 'noise':
      return (
        <View style={styles.pageText}>
          <NoiseIllustration />
          <Text variant="h1" heading>
            {t('noise.title')}
          </Text>
          <Text variant="body" tone="secondary">
            {t('noise.body')}
          </Text>
        </View>
      );
    case 'proactive':
      return (
        <View style={styles.pageText}>
          <ProactiveIllustration />
          <Text variant="kicker" tone="tertiaryStrong">
            {t('proactive.schedule', { time: EXAMPLE_TIME })}
          </Text>
          <Text variant="h1" heading>
            {t('proactive.title')}
          </Text>
          <Text variant="body" tone="secondary">
            {t('proactive.body', { minutes: EXAMPLE_MINUTES })}
          </Text>
        </View>
      );
    case 'control':
      return (
        <View style={styles.pageText}>
          <ControlIllustration />
          <Text variant="h1" heading>
            {t('control.title')}
          </Text>
          <Text variant="body" tone="secondary">
            {t('control.body')}
          </Text>
        </View>
      );
  }
}

export function IntroPager() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const params = useLocalSearchParams<{ page?: string }>();
  const t = useTranslations('onboarding');
  const actions = useTranslations('common.actions');
  const [index, setIndex] = useState(() => pageFromParam(params.page));
  const listRef = useRef<FlatList<Page>>(null);

  useEffect(() => {
    const page = PAGES[index] ?? 'welcome';
    updateOnboardingState({ introIndex: index });
    track('onboarding_step_viewed', { step: page });
  }, [index]);

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(PAGES.length - 1, next));
    setIndex(clamped);
    listRef.current?.scrollToIndex({ index: clamped, animated: true });
  };

  const signUp = (skipFrom?: Page) => {
    if (skipFrom !== undefined) track('onboarding_skipped', { step: skipFrom });
    router.push('/sign-in?mode=signup');
  };

  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(width, 1));
    if (next !== index) setIndex(Math.max(0, Math.min(PAGES.length - 1, next)));
  };

  const page = PAGES[index] ?? 'welcome';
  const onGradient = page === 'welcome';
  const content = (
    <View
      style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }]}
    >
      <View style={styles.topBar}>
        {page === 'noise' || page === 'proactive' ? (
          <Button
            label={actions('skip')}
            variant="ghost"
            size="ghost"
            onPress={() => {
              signUp(page);
            }}
            testID="intro.skip"
          />
        ) : null}
      </View>
      <FlatList
        ref={listRef}
        data={PAGES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={index}
        getItemLayout={(_data, i) => ({ length: width, offset: width * i, index: i })}
        keyExtractor={(item) => item}
        onMomentumScrollEnd={onScrollEnd}
        renderItem={({ item }) => (
          <View style={[styles.page, { width, paddingHorizontal: theme.layout.screenX }]}>
            <PageBody page={item} />
          </View>
        )}
        testID="intro.pager"
      />
      <View style={[styles.footer, { paddingHorizontal: theme.layout.screenX }]}>
        <PageDots
          count={PAGES.length}
          index={index}
          onChange={goTo}
          onGradient={onGradient}
          valueText={t('introA11y', { current: index + 1, total: PAGES.length })}
          accessibilityLabel={t('introA11y', { current: index + 1, total: PAGES.length })}
          testID="intro.dots"
        />
        {page === 'welcome' ? (
          <>
            <Button
              label={t('welcome.cta')}
              variant="inverse"
              fullWidth
              onPress={() => {
                goTo(1);
              }}
              testID="intro.start"
            />
            <PressableScale
              accessibilityRole="link"
              accessibilityLabel={t('welcome.signInA11y')}
              onPress={() => {
                track('onboarding_signin_link_tapped');
                router.push('/sign-in?mode=signin');
              }}
              testID="intro.signIn"
            >
              <Text variant="secondary" tone="onGradientSecondary" align="center">
                {t.rich('welcome.signIn', {
                  signIn: (chunks) => (
                    <Text variant="secondary" tone="onGradient" weight={600}>
                      {chunks}
                    </Text>
                  ),
                })}
              </Text>
            </PressableScale>
          </>
        ) : page === 'control' ? (
          <Button
            label={t('control.cta')}
            fullWidth
            onPress={() => {
              signUp();
            }}
            testID="intro.createAccount"
          />
        ) : (
          <Button
            label={actions('continue')}
            variant="ink"
            fullWidth
            onPress={() => {
              goTo(index + 1);
            }}
            testID="intro.next"
          />
        )}
      </View>
    </View>
  );

  if (!onGradient) {
    return <View style={[styles.fill, { backgroundColor: theme.color.bg }]}>{content}</View>;
  }
  return (
    <GradientSurface gradient="dawnFullbleed" radius="none" style={styles.fill}>
      {content}
    </GradientSurface>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  root: { flex: 1 },
  topBar: {
    minHeight: 44,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
  },
  page: { flex: 1, justifyContent: 'center' },
  pageText: { gap: 12 },
  illustration: { marginBottom: 16 },
  gap: { marginTop: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  footer: { gap: 12, paddingTop: 12 },
});

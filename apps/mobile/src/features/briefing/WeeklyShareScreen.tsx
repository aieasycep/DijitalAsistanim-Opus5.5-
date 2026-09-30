/**
 * M-BR-06 weekly share (`weekly/[id]/share`, modal): a privacy-safe image of aggregates only
 * (`GET /weekly/:id/share-card` has no names, people, subjects or content by construction). The
 * card is rendered from the kit template (4:5 or 9:16), captured with react-native-view-shot at
 * 1080 px wide and handed to the OS share sheet (expo-sharing). The invite link (`GET
 * /referrals/me`) can be appended as text where the OS share sheet carries text with a file (iOS);
 * the image never changes. A cached card payload lets the share work offline.
 */
import { referralMeQueryOptions, shareCardQueryOptions, useApiClient } from '@da/api-client/react';
import { toUpper, withTrCases } from '@da/i18n';
import {
  Button,
  DetailHeader,
  ErrorCard,
  ListRow,
  GroupedList,
  PrivacyNote,
  SegmentedControl,
  ShareCardTemplate,
  SkeletonBlock,
  StickyCTABar,
  useTheme,
} from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet, View, useWindowDimensions } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocale, useTranslations } from 'use-intl';

import { formatDuration } from '@da/i18n';
import { track } from '../../lib/events';
import { showToast } from '../../providers/ToastHost';

type Format = '4:5' | '9:16';

export function WeeklyShareScreen() {
  const t = useTranslations('briefing.share');
  const common = useTranslations('common');
  const locale = useLocale();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const api = useApiClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const card = useQuery(shareCardQueryOptions(api, id));
  const [format, setFormat] = useState<Format>('4:5');
  const [invite, setInvite] = useState(false);
  const canInvite = Platform.OS === 'ios';
  const referral = useQuery({ ...referralMeQueryOptions(api), enabled: canInvite && invite });
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<View>(null);
  const lang = locale === 'en' ? 'en' : 'tr';

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace(`/weekly/${id}`);
  };

  const share = async () => {
    const data = card.data;
    if (data === undefined) return;
    setBusy(true);
    try {
      const uri = await captureRef(cardRef, {
        format: 'png',
        quality: 1,
        width: 1080,
        height: format === '4:5' ? 1350 : 1920,
      });
      const link = invite ? referral.data?.share_url : undefined;
      if (link !== undefined) {
        await Share.share({ url: uri, message: `${data.share_text} ${link}` });
      } else {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          UTI: 'public.png',
          dialogTitle: t('title'),
        });
      }
      track('weekly_share_completed', { format, with_invite: link !== undefined });
    } catch {
      showToast({ message: t('failed'), kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const data = card.data;
  const scale = Math.min(1, (width - theme.layout.screenX * 2) / 1080);
  const height = format === '4:5' ? 1350 : 1920;
  let preview;
  if (data === undefined) {
    preview = card.isError ? (
      <ErrorCard
        icon="cloud_off"
        tone="neutral"
        title={t('loadFailed')}
        primaryAction={{
          label: common('actions.retry'),
          onPress: () => {
            void card.refetch();
          },
        }}
        testID="share.error"
      />
    ) : (
      <SkeletonBlock height={1350 * scale} radius={24} testID="share.loading" />
    );
  } else {
    const values = withTrCases({
      mails: data.metrics.analyzed_emails,
      important: data.metrics.important_subjects,
    });
    const headline = t('headline', values);
    const summary = t('a11y', {
      week: data.week_label,
      mails: data.metrics.analyzed_emails,
      important: data.metrics.important_subjects,
      meetings: data.metrics.meetings,
      followups: data.metrics.followups_closed,
      saved: formatDuration(data.metrics.estimated_time_saved_minutes, lang),
    });
    preview = (
      <View
        style={{
          width: 1080 * scale,
          height: height * scale,
          overflow: 'hidden',
          alignSelf: 'center',
        }}
        accessible
        accessibilityRole="image"
        accessibilityLabel={summary}
        testID="share.preview"
      >
        <View
          style={{
            width: 1080,
            height,
            transform: [
              { translateX: -540 * (1 - scale) },
              { translateY: -(height / 2) * (1 - scale) },
              { scale },
            ],
          }}
        >
          <View
            ref={cardRef}
            collapsable={false}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            <ShareCardTemplate
              format={format}
              brandName={common('app.name')}
              kicker={toUpper(t('kicker', { week: data.week_label }), lang)}
              headline={headline}
              stats={[
                {
                  key: 'meetings',
                  value: String(data.metrics.meetings),
                  label: t('stats.meetings'),
                },
                {
                  key: 'followups',
                  value: String(data.metrics.followups_closed),
                  label: t('stats.followups'),
                },
                {
                  key: 'saved',
                  value: formatDuration(data.metrics.estimated_time_saved_minutes, lang),
                  label: t('stats.saved'),
                },
              ]}
              tagline={common('app.tagline')}
              testID="share.card"
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}
      testID="screen.weeklyShare"
    >
      <DetailHeader
        leading="close"
        onLeadingPress={close}
        leadingAccessibilityLabel={common('actions.close')}
        kicker={t('title')}
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.layout.screenX }]}
      >
        <SegmentedControl
          options={[
            { key: '4:5', label: t('post') },
            { key: '9:16', label: t('story') },
          ]}
          selectedKey={format}
          semantics="radio"
          onChange={(key) => {
            const next: Format = key === '9:16' ? '9:16' : '4:5';
            setFormat(next);
            track('weekly_share_format_changed', { format: next });
          }}
          accessibilityLabel={t('formatA11y')}
          testID="share.format"
        />
        {preview}
        {canInvite ? (
          <GroupedList>
            <ListRow
              title={t('invite')}
              trailing={{ kind: 'switch', value: invite }}
              onPress={() => {
                setInvite((v) => !v);
              }}
              testID="share.invite"
            />
          </GroupedList>
        ) : null}
        <PrivacyNote text={t('privacy')} testID="share.privacy" />
      </ScrollView>
      <StickyCTABar
        style={{
          paddingBottom: Math.max(insets.bottom, 12),
          paddingHorizontal: theme.layout.screenX,
        }}
      >
        <Button
          label={common('actions.share')}
          icon="ios_share"
          fullWidth
          loading={busy}
          disabled={data === undefined}
          onPress={() => {
            void share();
          }}
          testID="share.submit"
        />
      </StickyCTABar>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: 16, paddingBottom: 32 },
});

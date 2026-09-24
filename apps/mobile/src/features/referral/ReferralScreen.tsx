/**
 * M-REF-01 "Arkadaşını Davet Et" (`/settings/referral?code=`) and M-REF-02 (code-entry sheet): the
 * user's own code and `/r/{code}` link from `GET /referrals/me` (copy, native share), the real
 * referral statuses with masked labels, rewards and the yearly cap; a new user (≤ 7 days, not yet
 * referred) can enter a code (`POST /referrals/apply`), prefilled from a deep link or a pending
 * install-referrer code. Copy and share work offline from the cached link; applying is blocked.
 */
import { referralMeQueryOptions, useBootstrap } from '@da/api-client/react';
import { REFERRAL_CODE_PATTERN } from '@da/validation/api/business';
import {
  BottomSheet,
  Button,
  EmptyState,
  ErrorCard,
  InviteRow,
  ListRow,
  ReferralLinkField,
  SkeletonBlock,
  Text,
  TextField,
  type StatusTone,
} from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Share, StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { getApiClient } from '../../lib/bootstrap';
import { now } from '../../lib/clock';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { showToast } from '../../providers/ToastHost';
import { Caption, SettingsGroup, SettingsPage } from '../settings/ui';
import {
  applyReferralCode,
  takePendingReferral,
  type ApplyResult,
  type ReferralSource,
} from './pending';

type Status = 'pending' | 'flagged' | 'qualified' | 'rewarded' | 'rejected';
const PILL: Readonly<Record<Status, StatusTone>> = {
  pending: 'warning',
  flagged: 'warning',
  qualified: 'neutral',
  rewarded: 'success',
  rejected: 'neutral',
};
export const APPLY_WINDOW_DAYS = 7;

export function CodeSheet({
  initialCode,
  source,
  onDismiss,
}: {
  readonly initialCode: string;
  readonly source: ReferralSource;
  readonly onDismiss: () => void;
}) {
  const t = useTranslations();
  const online = useOnline();
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => Crypto.randomUUID());
  const valid = REFERRAL_CODE_PATTERN.test(code);

  const messageOf = (result: ApplyResult) => {
    switch (result) {
      case 'invalid':
        return t('referral.errors.invalid');
      case 'self':
        return t('referral.errors.self');
      case 'window_closed':
        return t('referral.errors.windowClosed');
      case 'already_applied':
        return t('referral.errors.alreadyApplied');
      case 'rate_limited':
        return t('states.error.rateLimited');
      default:
        return t('referral.errors.failed');
    }
  };

  return (
    <BottomSheet
      visible
      onDismiss={onDismiss}
      dismissible={!busy}
      title={t('referral.codeSheet.title')}
      testID="sheet.referralCode"
      footer={
        <View style={styles.buttons}>
          <Button
            label={t('referral.codeSheet.cta')}
            fullWidth
            loading={busy}
            disabled={!valid || !online}
            onPress={() => {
              setBusy(true);
              setError(undefined);
              void applyReferralCode(code, source, key).then((result) => {
                setBusy(false);
                if (result === 'applied') {
                  showToast({ message: t('referral.codeSheet.success'), kind: 'success' });
                  onDismiss();
                } else setError(messageOf(result));
              });
            }}
            testID="referralCode.apply"
          />
          <Button
            label={t('common.actions.nevermind')}
            variant="text"
            fullWidth
            onPress={onDismiss}
          />
        </View>
      }
    >
      <TextField
        label={t('referral.codeHint')}
        value={code}
        maxLength={10}
        autoCapitalize="characters"
        autoCorrect={false}
        textContentType="none"
        onChangeText={(text) => {
          setCode(text.toUpperCase().replace(/[^0-9A-Z]/g, ''));
          setError(undefined);
        }}
        {...(error === undefined ? {} : { error })}
        testID="referralCode.input"
      />
      <Text variant="bodySm" tone="secondary">
        {t('referral.codeSheet.body', { days: APPLY_WINDOW_DAYS })}
      </Text>
      {online ? null : (
        <Text variant="bodySm" tone="tertiaryStrong">
          {t('states.offline.blockedReason')}
        </Text>
      )}
    </BottomSheet>
  );
}

export function ReferralScreen() {
  const t = useTranslations();
  const params = useLocalSearchParams<{ code?: string }>();
  const bootstrap = useBootstrap();
  const query = useQuery(referralMeQueryOptions(getApiClient()));
  const data = query.data;
  const [sheet, setSheet] = useState<{ code: string; source: ReferralSource } | null>(() => {
    const code = params.code?.toUpperCase();
    if (code !== undefined && REFERRAL_CODE_PATTERN.test(code)) {
      return { code, source: 'deep_link' };
    }
    return null;
  });

  useEffect(() => {
    track('referral_viewed');
  }, []);

  const created = bootstrap.data?.profile.created_at;
  const youngAccount =
    created !== undefined && now().getTime() - Date.parse(created) < APPLY_WINDOW_DAYS * 86_400_000;
  const canEnterCode = data?.referred_by === null && youngAccount;

  // A code from `/r/{code}` or the install referrer opens the sheet prefilled (M-REF-02).
  const [pending] = useState(takePendingReferral);
  const [pendingHandled, setPendingHandled] = useState(false);
  const shown = sheet ?? (canEnterCode && pending !== null && !pendingHandled ? pending : null);

  const copy = () => {
    if (data === undefined) return;
    void Clipboard.setStringAsync(data.share_url).then(() => {
      track('referral_link_copied');
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      showToast({ message: t('referral.copied') });
    });
  };

  const share = () => {
    if (data === undefined) return;
    const message = t('referral.shareMessage', { days: data.reward_days, url: data.share_url });
    void Share.share(Platform.OS === 'ios' ? { message, url: data.share_url } : { message })
      .then((result) => {
        track('referral_shared', { completed: result.action === Share.sharedAction });
      })
      .catch(() => undefined);
  };

  const statusMeta = (status: Status) => t(`referral.statusMeta.${status}`);

  let body;
  if (data === undefined) {
    body = query.isPending ? (
      <View style={styles.skeleton} accessibilityLabel={t('common.a11y.loading')}>
        <SkeletonBlock width="100%" height={52} radius={14} />
        <SkeletonBlock width="100%" height={44} radius={12} />
      </View>
    ) : (
      <ErrorCard
        icon="cloud_off"
        tone="neutral"
        title={t('states.error.loadFailed.title', { screen: t('referral.title') })}
        body={t('states.error.loadFailed.body')}
        primaryAction={{
          label: t('common.actions.retry'),
          onPress: () => {
            void query.refetch();
          },
        }}
        testID="referral.error"
      />
    );
  } else {
    body = (
      <>
        <ReferralLinkField
          link={data.share_url.replace(/^https:\/\//, '')}
          copyLabel={t('common.actions.copy')}
          onCopy={copy}
          accessibilityLabel={t('referral.linkA11y', { code: data.code.split('').join(' ') })}
          testID="referral.link"
        />
        <Button
          label={t('referral.send')}
          icon="ios_share"
          fullWidth
          onPress={share}
          testID="referral.share"
        />
        {data.referred_by === null ? null : (
          <View style={styles.referee} testID="referral.referee">
            <Text variant="rowTitle">{t('referral.referee.title')}</Text>
            <Text variant="bodySm" tone="secondary">
              {t('referral.referee.reward', { days: data.reward_days })}
            </Text>
          </View>
        )}
        {canEnterCode ? (
          <SettingsGroup>
            <ListRow
              icon="redeem"
              title={t('referral.enterCode')}
              trailing={{ kind: 'chevron' }}
              onPress={() => {
                setSheet({ code: '', source: 'manual' });
              }}
              testID="referral.enterCode"
            />
          </SettingsGroup>
        ) : null}
        {data.referrals.length === 0 ? (
          <EmptyState
            icon="person_add"
            tone="neutral"
            title={t('referral.emptyTitle')}
            body={t('referral.emptyBody')}
            testID="referral.empty"
          />
        ) : (
          <SettingsGroup
            title={`${t('referral.invitesSection')} · ${String(data.referrals.length)}`}
            testID="referral.invites"
          >
            {data.referrals.map((referral) => (
              <InviteRow
                key={referral.id}
                name={referral.label}
                status={statusMeta(referral.status)}
                pill={{
                  label: t(`referral.badges.${referral.status}`, { days: data.reward_days }),
                  tone: PILL[referral.status],
                }}
                testID={`referral.invite.${referral.id}`}
              />
            ))}
          </SettingsGroup>
        )}
        <Caption testID="referral.footer">
          {data.remaining_this_year === 0
            ? t('referral.capReached')
            : t('referral.footer', { days: data.earned_days_total, cap: data.cap_per_year })}
        </Caption>
      </>
    );
  }

  return (
    <SettingsPage
      title={t('referral.title')}
      subtitle={`${t('referral.headline', { days: data?.reward_days ?? bootstrap.data?.config.referral_reward_days ?? 14 })} ${t('referral.body')}`}
      refreshing={query.isRefetching}
      onRefresh={() => {
        void query.refetch();
      }}
      testID="screen.settings.referral"
    >
      {body}
      {shown === null ? null : (
        <CodeSheet
          initialCode={shown.code}
          source={shown.source}
          onDismiss={() => {
            setSheet(null);
            setPendingHandled(true);
          }}
        />
      )}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  buttons: { gap: 8 },
  skeleton: { gap: 10 },
  referee: { gap: 4, paddingVertical: 8 },
});

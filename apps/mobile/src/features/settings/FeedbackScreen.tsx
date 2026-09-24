/**
 * M-SET-72 "Geri bildirim" (`/settings/feedback?type=&screen=`): Bug / Özellik / Genel / AI
 * Kalitesi with an optional rating, sent with `POST /feedback` [IK]. Success shows only after 201;
 * offline the submit is queued with its key ("Bağlantı gelince gönderilecek.") and replayed on
 * reconnect. The store-review card is always shown, independent of the rating (no review gating).
 */
import { isApiError } from '@da/api-client';
import { feedbackMutationOptions } from '@da/api-client/react';
import type { FeedbackType } from '@da/domain';
import {
  Button,
  CaptureTextField,
  ChoiceChip,
  IconButton,
  ListRow,
  SuccessState,
  Text,
} from '@da/ui';
import { useMutation } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { getApiClient } from '../../lib/bootstrap';
import { track } from '../../lib/events';
import { isOffline } from '../../lib/query/online-manager';
import { showToast } from '../../providers/ToastHost';
import { requestStoreReview } from './links';
import { queueFeedback, type FeedbackBody } from './outbox';
import { Caption, SettingsGroup, SettingsPage } from './ui';

const TYPES: readonly FeedbackType[] = ['bug', 'feature', 'general', 'ai_quality'];
const AREAS = [
  ['briefing', 'M-BR-01'],
  ['mailSummary', 'M-MAIL-03'],
  ['replyDraft', 'M-REPLY-01'],
  ['assistant', 'M-ASST-02'],
  ['meetingPrep', 'M-MEET-01'],
  ['capture', 'M-CAP-06'],
  ['other', null],
] as const;
type Area = (typeof AREAS)[number][0];
const RATINGS = [1, 2, 3, 4, 5] as const;
export const FEEDBACK_MAX = 4000;
const SCREEN_ID = /^M-[A-Z]{2,6}-\d{2}[A-Z]?$/;

function typeOf(value: string | undefined): FeedbackType {
  return TYPES.find((t) => t === value) ?? 'general';
}

export function FeedbackScreen() {
  const t = useTranslations();
  const params = useLocalSearchParams<{ type?: string; screen?: string }>();
  const mutation = useMutation(feedbackMutationOptions(getApiClient()));
  const [type, setType] = useState<FeedbackType>(typeOf(params.type));
  const [area, setArea] = useState<Area | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [diagnostics, setDiagnostics] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [state, setState] = useState<'form' | 'sent' | 'queued'>('form');
  const [key, setKey] = useState(() => Crypto.randomUUID());
  const screenParam =
    params.screen !== undefined && SCREEN_ID.test(params.screen) ? params.screen : undefined;

  useEffect(() => {
    track('feedback_opened', { from: params.type === undefined ? 'settings' : 'deeplink' });
    // Tracked once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => {
    setState('form');
    setMessage('');
    setRating(null);
    setArea(null);
    setError(undefined);
    setKey(Crypto.randomUUID());
  };

  const screenOf = (): string | undefined => {
    if (type !== 'ai_quality') return screenParam;
    const id = AREAS.find(([name]) => name === area)?.[1] ?? null;
    return id ?? screenParam;
  };

  const submit = () => {
    const text = message.trim();
    if (text === '') {
      setError(t('settings.feedback.empty'));
      return;
    }
    setError(undefined);
    const screen = screenOf();
    const body: FeedbackBody = {
      type,
      message: text,
      include_diagnostics: diagnostics,
      ...(rating === null ? {} : { rating }),
      ...(screen === undefined ? {} : { screen }),
    };
    if (isOffline()) {
      queueFeedback(body, key);
      setState('queued');
      return;
    }
    const send = (payload: FeedbackBody, retried: boolean) => {
      mutation.mutate(
        { body: payload, idempotencyKey: key },
        {
          onSuccess: () => {
            track('feedback_submitted', {
              type,
              ...(rating === null ? {} : { rating }),
              queued: false,
              diagnostics,
            });
            setState('sent');
          },
          onError: (failure) => {
            if (
              !retried &&
              isApiError(failure) &&
              failure.code === 'VALIDATION_FAILED' &&
              payload.screen !== undefined
            ) {
              // A screen outside the server allow-list is dropped and the request retried once.
              const { screen: _dropped, ...rest } = payload;
              send(rest, true);
              return;
            }
            const code = isApiError(failure) ? failure.code : 'NETWORK_ERROR';
            track('feedback_failed', { code });
            showToast({
              message:
                code === 'RATE_LIMITED'
                  ? t('settings.feedback.rateLimited')
                  : t('settings.feedback.failed'),
              kind: 'error',
            });
          },
        },
      );
    };
    send(body, false);
  };

  const reviewCard = (
    <SettingsGroup>
      <ListRow
        icon="star"
        title={t('settings.feedback.storeReview')}
        trailing={{ kind: 'link', text: t('settings.feedback.storeReviewCta') }}
        onPress={() => {
          void requestStoreReview();
        }}
        testID="feedback.review"
      />
    </SettingsGroup>
  );

  if (state !== 'form') {
    return (
      <SettingsPage title={t('settings.feedback.title')} testID="screen.settings.feedback">
        {state === 'sent' ? (
          <SuccessState
            title={t('settings.feedback.successTitle')}
            body={t('settings.feedback.successBody')}
            action={{ label: t('settings.feedback.newFeedback'), onPress: reset }}
            testID="feedback.success"
          />
        ) : (
          <View accessibilityLiveRegion="polite" testID="feedback.queued">
            <Text variant="h3">{t('settings.feedback.queued')}</Text>
            <Button label={t('settings.feedback.newFeedback')} variant="text" onPress={reset} />
          </View>
        )}
        {reviewCard}
      </SettingsPage>
    );
  }

  return (
    <SettingsPage
      title={t('settings.feedback.title')}
      subtitle={t('settings.feedback.subtitle')}
      testID="screen.settings.feedback"
      footer={
        <Button
          label={t('common.actions.send')}
          fullWidth
          loading={mutation.isPending}
          onPress={submit}
          testID="feedback.send"
        />
      }
    >
      <View style={styles.chips} accessibilityRole="radiogroup">
        {TYPES.map((value) => (
          <ChoiceChip
            key={value}
            label={t(`settings.feedback.types.${value}`)}
            selected={type === value}
            onPress={() => {
              setType(value);
            }}
            testID={`feedback.type.${value}`}
          />
        ))}
      </View>
      {type === 'ai_quality' ? (
        <>
          <Text variant="kicker" tone="secondary">
            {t('settings.feedback.area')}
          </Text>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {AREAS.map(([name]) => (
              <ChoiceChip
                key={name}
                label={t(`settings.feedback.areas.${name}`)}
                selected={area === name}
                onPress={() => {
                  setArea(name);
                }}
                testID={`feedback.area.${name}`}
              />
            ))}
          </View>
        </>
      ) : null}
      <Text variant="kicker" tone="secondary">
        {t('settings.feedback.rating')}
      </Text>
      <View style={styles.stars} accessibilityRole="radiogroup">
        {RATINGS.map((value) => (
          <IconButton
            key={value}
            icon="star"
            filled={rating !== null && value <= rating}
            variant="plain"
            accessibilityLabel={t('settings.feedback.ratingA11y', {
              value,
              label: t(`settings.feedback.ratings.r${value}`),
            })}
            onPress={() => {
              setRating(rating === value ? null : value);
            }}
            testID={`feedback.star.${String(value)}`}
          />
        ))}
      </View>
      <Text variant="label">{t('settings.contact.message')}</Text>
      <CaptureTextField
        accessibilityLabel={t('settings.contact.message')}
        placeholder={t(`settings.feedback.hints.${type}`)}
        value={message}
        maxLength={FEEDBACK_MAX}
        onChangeText={(text) => {
          setMessage(text);
          if (error !== undefined) setError(undefined);
        }}
        counterText={t('settings.contact.counter', { count: message.length, max: FEEDBACK_MAX })}
        testID="feedback.message"
      />
      <Text variant="meta" tone="tertiaryStrong">
        {t('settings.contact.noSecrets')}
      </Text>
      {error === undefined ? null : (
        <Text
          variant="bodySm"
          tone="critical"
          accessibilityLiveRegion="assertive"
          testID="feedback.error"
        >
          {error}
        </Text>
      )}
      {type === 'ai_quality' ? <Caption>{t('settings.feedback.aiNote')}</Caption> : null}
      <SettingsGroup>
        <ListRow
          title={t('settings.feedback.diagnostics')}
          subtitle={t('settings.feedback.diagnosticsMeta')}
          trailing={{ kind: 'switch', value: diagnostics }}
          onPress={() => {
            setDiagnostics(!diagnostics);
          }}
          testID="feedback.diagnostics"
        />
      </SettingsGroup>
      {reviewCard}
    </SettingsPage>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stars: { flexDirection: 'row', gap: 4 },
});

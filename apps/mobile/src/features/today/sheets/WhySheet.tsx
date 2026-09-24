/**
 * M-TD-03 "Neden önemli?" / M-SRC-01 "Bu nereden çıktı?" (sheet(host) `insight_why`): RPC-16
 * `get_explanation(target_type, target_id)` — the reason, the decision tier in words, low
 * confidence language (< 0.70), verified evidence quotes (never fabricated: the box is omitted when
 * none is stored) and the real source with "Kaynağı aç" (in-app route when it exists, otherwise the
 * provider's web link). `['insights', id, 'why']`, 5 min, not persisted.
 */
import { qk } from '@da/api-client';
import {
  BottomSheet,
  InlineErrorCard,
  Surface,
  Text,
  WhySheetContent,
  type DecisionTierKind,
} from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { useFormatter, useTranslations } from 'use-intl';

import { track } from '../../../lib/events';
import { rpc } from '../../../lib/postgrest';
import { useOnline } from '../../../lib/query/online-manager';
import { registerSheet, type SheetRenderProps } from '../../../providers/SheetHost';
import { routeForDeepLink } from '../sources';
import { ListSkeleton } from '../../common/ListSkeleton';

export const INSIGHT_WHY_SHEET = 'insight_why';

export interface WhyParams {
  readonly targetType: 'insight' | 'briefing_item';
  readonly targetId: string;
}

interface ExplainSource {
  readonly source_type: string | null;
  readonly provider: string | null;
  readonly display: string | null;
  readonly account_label?: string | null;
  readonly source_timestamp: string | null;
  readonly evidence?: readonly { readonly quote?: string }[] | null;
  readonly in_app_deeplink?: string | null;
  readonly provider_web_link?: string | null;
}

export interface Explanation {
  readonly reason_text: string | null;
  readonly decision_tier: DecisionTierKind | null;
  readonly rule: { readonly id: string } | null;
  readonly learned_preference: { readonly id: string; readonly statement: string } | null;
  readonly confidence: number | null;
  readonly sources: readonly ExplainSource[];
}

export const LOW_CONFIDENCE = 0.7;

async function fetchExplanation(params: WhyParams): Promise<Explanation | null> {
  const data = await rpc('get_explanation', {
    p_target_type: params.targetType,
    p_target_id: params.targetId,
  });
  if (data === null || typeof data !== 'object') return null;
  const value = data as Partial<Explanation>;
  return {
    reason_text: value.reason_text ?? null,
    decision_tier: value.decision_tier ?? null,
    rule: value.rule ?? null,
    learned_preference: value.learned_preference ?? null,
    confidence: typeof value.confidence === 'number' ? value.confidence : null,
    sources: Array.isArray(value.sources) ? value.sources : [],
  };
}

function WhySheet({ params, visible, onDismiss, onHidden }: SheetRenderProps<WhyParams>) {
  const t = useTranslations('explain');
  const today = useTranslations('today.why');
  const common = useTranslations('common');
  const format = useFormatter();
  const online = useOnline();
  const query = useQuery({
    queryKey: qk.insights.why(params.targetId),
    queryFn: () => fetchExplanation(params),
    staleTime: 5 * 60_000,
  });
  const data = query.data;
  const tracked = useRef(false);

  useEffect(() => {
    if (data === undefined || data === null || tracked.current) return;
    tracked.current = true;
    track('why_important_opened', {
      decision_tier: data.decision_tier ?? 'ai_classification',
      confidence_bucket: (data.confidence ?? 1) < LOW_CONFIDENCE ? '<0.7' : '>=0.7',
    });
  }, [data]);

  let body;
  if (query.isPending) {
    body = <ListSkeleton rows={3} accessibilityLabel={common('a11y.loading')} />;
  } else if (query.isError || data === undefined) {
    body = (
      <InlineErrorCard
        icon="error"
        tone="neutral"
        title={online ? today('loadFailed') : today('offline')}
        primaryAction={{
          label: common('actions.retry'),
          onPress: () => {
            void query.refetch();
          },
        }}
        testID="why.error"
      />
    );
  } else if (data === null) {
    body = (
      <Text variant="body" tone="secondary">
        {today('unavailable')}
      </Text>
    );
  } else {
    const source = data.sources[0];
    const route = routeForDeepLink(source?.in_app_deeplink);
    const web = source?.provider_web_link ?? null;
    const tier: DecisionTierKind = data.decision_tier ?? 'ai_classification';
    const tierText =
      tier === 'learned_preference' && data.learned_preference !== null
        ? today('tierLearned', { statement: data.learned_preference.statement })
        : t(`tiers.${tier}`);
    const evidence = (source?.evidence ?? [])
      .map((e) => e.quote)
      .filter((q): q is string => typeof q === 'string' && q !== '');
    const stamp = source?.source_timestamp ?? null;
    const parts = [
      source?.account_label ?? source?.provider ?? '',
      source?.display ?? '',
      stamp === null
        ? ''
        : format.dateTime(new Date(stamp), { hour: '2-digit', minute: '2-digit' }),
    ].filter((p) => p !== '');
    body = (
      <WhySheetContent
        title={t('whyImportant')}
        reason={data.reason_text ?? today('noReason')}
        tier={{ kind: tier, text: tierText }}
        {...(source === undefined || (route === null && web === null)
          ? {}
          : {
              source: {
                icon: 'mail',
                parts,
                openLabel: t('source.open'),
                onOpen: () => {
                  track('why_source_opened', {
                    source_type: source.source_type ?? 'email_message',
                  });
                  onDismiss();
                  if (route !== null) router.push(route);
                  else if (web !== null) void WebBrowser.openBrowserAsync(web);
                },
              },
            })}
        testID="why.content"
      >
        {(data.confidence ?? 1) < LOW_CONFIDENCE ? (
          <Text variant="secondary" tone="warning">
            {today('lowConfidence')}
          </Text>
        ) : null}
        {evidence.length === 0 ? null : (
          <Surface background="sunken" radius="button" padding={12} style={styles.evidence}>
            {evidence.map((quote) => (
              <Text key={quote} variant="bodySm" accessibilityLabel={today('quoteA11y', { quote })}>
                {quote}
              </Text>
            ))}
          </Surface>
        )}
      </WhySheetContent>
    );
  }

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      accessibilityLabel={t('whyImportant')}
      testID="sheet.why"
    >
      {body}
    </BottomSheet>
  );
}

registerSheet<WhyParams>(INSIGHT_WHY_SHEET, (props) => <WhySheet {...props} />, {
  analyticsKey: 'why',
});

const styles = StyleSheet.create({ evidence: { gap: 8 } });

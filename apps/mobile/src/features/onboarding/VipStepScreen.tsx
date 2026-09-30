/**
 * M-ON-11 VIP (step 4 / 4): the people whose messages always rise to the top. Pro users get RPC-13
 * `vip_suggestions()` (first 8; polled every 5 s for up to 30 s while the first sync may still be
 * running) and can add people by e-mail (M-ON-11A); "Devam (n)" inserts `vip_people` rows
 * `{contact_id, relationship:'other', origin:'onboarding'}` (bounded by `vip_max`). Free users never
 * call the Pro-only RPC (D-28): they see the inline gate and "Atla ve devam et".
 */
import { qk } from '@da/api-client';
import { useBootstrap } from '@da/api-client/react';
import { Button, EmptyState, GroupedList, HeaderPill, ListRow, TextAction } from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { getSupabase } from '../../lib/auth/supabase';
import { track } from '../../lib/events';
import { rpc, toDataError } from '../../lib/postgrest';
import { sheets } from '../../providers/SheetHost';
import { showToast } from '../../providers/ToastHost';
import { ContextualGate, isPro } from '../pro-gate/ProGate';
import { OnboardingFrame } from './OnboardingFrame';
import { enterStep, nextStep, routeOf, skipStep, stepContext } from './steps';
import { VIP_ADD_SHEET, type ManualVip } from './VipAddSheet';
import { ListSkeleton } from '../common/ListSkeleton';

export interface VipSuggestion {
  readonly contact_id: string;
  readonly display_name: string;
  readonly primary_email: string | null;
  readonly organization: string | null;
  readonly exchanges_30d: number;
}

const SHOWN = 8;
const POLL_MS = 5_000;
const POLL_WINDOW_MS = 30_000;

async function fetchSuggestions(): Promise<readonly VipSuggestion[]> {
  const data = await rpc('vip_suggestions', {});
  return Array.isArray(data) ? (data as unknown as VipSuggestion[]).slice(0, SHOWN) : [];
}

export function VipStepScreen() {
  const t = useTranslations('onboarding.vip');
  const onb = useTranslations('onboarding');
  const common = useTranslations('common');
  const router = useRouter();
  const bootstrap = useBootstrap();
  const pro = isPro();
  const [openedAt] = useState(() => Date.now());
  const suggestions = useQuery({
    queryKey: qk.contacts.vipSuggestions(),
    queryFn: fetchSuggestions,
    enabled: pro,
    staleTime: 60_000,
    refetchInterval: (query) =>
      (query.state.data?.length ?? 0) === 0 && Date.now() - openedAt < POLL_WINDOW_MS
        ? POLL_MS
        : false,
  });
  const [manual, setManual] = useState<readonly ManualVip[]>([]);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    enterStep('vip');
  }, []);

  const goNext = () => {
    const next = nextStep('vip', stepContext(true));
    router.push(next === 'done' ? '/today' : routeOf(next));
  };

  const skip = () => {
    skipStep('vip');
    goNext();
  };

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    );
  };

  const save = async () => {
    const userId = bootstrap.data?.profile.id;
    if (userId === undefined || selected.length === 0) return;
    setSaving(true);
    const { error } = (await getSupabase()
      .from('vip_people')
      .insert(
        selected.map((contact_id) => ({
          user_id: userId,
          contact_id,
          relationship: 'other' as const,
          origin: 'onboarding',
        })),
      )) as { error: { message?: string; code?: string } | null };
    setSaving(false);
    if (error !== null) {
      const failure = toDataError(error);
      showToast({
        message:
          failure.code === 'PLAN_LIMIT' || failure.message.includes('vip_max')
            ? t('full')
            : common('toast.saveFailed'),
        kind: 'error',
      });
      return;
    }
    const manualIds = manual.map((m) => m.contactId);
    track('vip_selected', {
      count: selected.length,
      from_suggestions: selected.filter((id) => !manualIds.includes(id)).length,
      manual: selected.filter((id) => manualIds.includes(id)).length,
    });
    goNext();
  };

  const openAdd = () => {
    sheets.open(VIP_ADD_SHEET, {
      existing: [
        ...(suggestions.data ?? []).map((s) => s.primary_email ?? ''),
        ...manual.map((m) => m.email),
      ],
      onAdded: (vip: ManualVip) => {
        setManual((current) => [...current, vip]);
        setSelected((current) => [...current, vip.contactId]);
      },
    });
  };

  if (!pro) {
    return (
      <OnboardingFrame
        kicker={onb('steps.vip')}
        title={t('title')}
        subtitle={t('body')}
        onBack={() => {
          router.back();
        }}
        testID="onboarding.vip"
        footer={<Button label={t('skipContinue')} fullWidth onPress={skip} testID="vip.skip" />}
      >
        <ContextualGate feature="vip" />
      </OnboardingFrame>
    );
  }

  const rows = [
    ...manual.map((m) => ({
      id: m.contactId,
      name: m.name ?? m.email,
      meta: m.email,
    })),
    ...(suggestions.data ?? []).map((s) => ({
      id: s.contact_id,
      name: s.display_name,
      meta: t('rowMeta', { count: s.exchanges_30d }),
    })),
  ];

  let body;
  if (suggestions.isPending && manual.length === 0) {
    body = <ListSkeleton rows={5} accessibilityLabel={common('a11y.loading')} />;
  } else if (rows.length === 0) {
    body = (
      <>
        <EmptyState
          icon="person_add"
          tone="neutral"
          title={t('emptyTitle')}
          body={t('emptyBody')}
          action={{ label: t('addPerson'), onPress: openAdd }}
          testID="vip.empty"
        />
        {suggestions.isError ? (
          <TextAction
            label={common('actions.retry')}
            onPress={() => {
              void suggestions.refetch();
            }}
            testID="vip.retry"
          />
        ) : null}
      </>
    );
  } else {
    body = (
      <GroupedList testID="vip.list">
        {rows.map((row) => {
          const on = selected.includes(row.id);
          return (
            <ListRow
              key={row.id}
              title={row.name}
              subtitle={row.meta}
              trailing={{ kind: 'check', checked: on }}
              onPress={() => {
                toggle(row.id);
              }}
              accessibilityLabel={t(on ? 'rowA11yOn' : 'rowA11yOff', {
                name: row.name,
                meta: row.meta,
              })}
              testID={`vip.row.${row.id}`}
            />
          );
        })}
      </GroupedList>
    );
  }

  return (
    <OnboardingFrame
      kicker={onb('steps.vip')}
      title={t('title')}
      subtitle={t('body')}
      onBack={() => {
        router.back();
      }}
      skip={{ label: common('actions.skip'), onPress: skip }}
      testID="onboarding.vip"
      footer={
        <Button
          label={t('cta', { count: selected.length })}
          fullWidth
          loading={saving}
          disabled={selected.length === 0}
          onPress={() => {
            void save();
          }}
          testID="vip.continue"
        />
      }
    >
      <View style={styles.addRow}>
        <HeaderPill label={t('addPerson')} icon="person_add" onPress={openAdd} testID="vip.add" />
      </View>
      {body}
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  addRow: { flexDirection: 'row', justifyContent: 'flex-end' },
});

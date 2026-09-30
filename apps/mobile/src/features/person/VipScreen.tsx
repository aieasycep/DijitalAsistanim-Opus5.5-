/**
 * M-VIP-01 Önemli Kişiler (`/vip` inside the app): VIPs by relationship group (they raise priority
 * deterministically and tighten wait tracking, M§30/M§31), an honest suggestion from real
 * communication frequency (RPC-13, Pro), "Kişi Ekle" (M-VIP-02) and per-VIP settings (M-VIP-03).
 * Removing a VIP (star) is undoable for 5 s (re-insert with the same settings). Free keeps a usable
 * list up to `vip_max` under the "VIP önceliği Pro'da" banner; writes wait for the connection
 * offline (internal, idempotent).
 */
import { hold } from '@da/design-tokens';
import type { VipRelationship } from '@da/domain';
import {
  Avatar,
  DetailHeader,
  EmptyState,
  ErrorCard,
  GroupedList,
  HeaderPill,
  IconButton,
  ListRow,
  OfflineBanner,
  SectionHeader,
  Surface,
  Text,
  TextAction,
  useTheme,
} from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

import { qk } from '@da/api-client';
import { getSupabase } from '../../lib/auth/supabase';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { showToast } from '../../providers/ToastHost';
import { ListSkeleton } from '../common/ListSkeleton';
import { ContextualGate, isPro } from '../pro-gate/ProGate';
import { countBucket } from '../approvals/model';
import {
  fetchVipSuggestions,
  invalidatePeople,
  isVipLimit,
  removeVip,
  saveVip,
  vipListQueryOptions,
  type VipRow,
} from './data';
import { ContactPickerSheet, VipEditSheet, type VipTarget } from './VipSheets';

const GROUPS: readonly { key: string; members: readonly VipRelationship[] }[] = [
  { key: 'family', members: ['spouse', 'family'] },
  { key: 'manager', members: ['manager'] },
  { key: 'key_client', members: ['key_client'] },
  { key: 'friend', members: ['friend'] },
  { key: 'other', members: ['other'] },
];

type GroupKey = 'family' | 'manager' | 'key_client' | 'friend' | 'other';

export function VipScreen() {
  const t = useTranslations('person.vipList');
  const rel = useTranslations('person.relationships');
  const common = useTranslations('common');
  const states = useTranslations('states');
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const online = useOnline();
  const pro = isPro();
  const list = useQuery(vipListQueryOptions());
  const suggestions = useQuery({
    queryKey: qk.vip.suggestions(),
    queryFn: fetchVipSuggestions,
    enabled: pro && online,
  });
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const [picker, setPicker] = useState(false);
  const [edit, setEdit] = useState<VipTarget | null>(null);
  const viewed = useRef(false);
  const shownSuggestion = useRef<string | null>(null);
  const rows = list.data ?? [];
  const suggestion = (suggestions.data ?? []).find((s) => !dismissed.includes(s.contactId));

  useEffect(() => {
    if (viewed.current || list.data === undefined) return;
    viewed.current = true;
    track('vip_list_viewed', { count_bucket: countBucket(list.data.length) });
  }, [list.data]);
  useEffect(() => {
    if (suggestion === undefined || shownSuggestion.current === suggestion.contactId) return;
    shownSuggestion.current = suggestion.contactId;
    track('vip_suggestion_shown');
  }, [suggestion]);

  const removeWithUndo = (row: VipRow) => {
    void removeVip(row.id, row.contactId)
      .then(() => {
        track('vip_removed');
        showToast({
          message: t('removed', { name: row.name }),
          kind: 'success',
          durationMs: hold.undoToast,
          action: {
            label: common('actions.undo'),
            onPress: () => {
              void saveVip(row.contactId, {
                relationship: row.relationship,
                alwaysNotify: row.alwaysNotify,
                bypassQuietHours: row.bypassQuietHours,
              }).catch(() => {
                showToast({ message: common('toast.saveFailed'), kind: 'error' });
              });
            },
          },
        });
      })
      .catch(() => {
        showToast({ message: common('toast.saveFailed'), kind: 'error' });
      });
    if (!online) showToast({ message: states('offline.queued'), kind: 'offline' });
  };

  const acceptSuggestion = () => {
    if (suggestion === undefined) return;
    const target: VipTarget = {
      contactId: suggestion.contactId,
      name: suggestion.name,
      vipId: null,
      origin: 'suggestion',
    };
    void saveVip(
      suggestion.contactId,
      { relationship: 'other', alwaysNotify: true, bypassQuietHours: true },
      'suggestion',
    )
      .then(async () => {
        track('vip_added', { origin: 'suggestion' });
        showToast({ message: t('added', { name: suggestion.name }), kind: 'success' });
        const fresh = await list.refetch();
        const created = fresh.data?.find((r) => r.contactId === suggestion.contactId);
        setEdit({
          ...target,
          vipId: created?.id ?? null,
          settings: { relationship: 'other', alwaysNotify: true, bypassQuietHours: true },
        });
      })
      .catch((error: unknown) => {
        if (isVipLimit(error)) setEdit(target);
        else showToast({ message: common('toast.saveFailed'), kind: 'error' });
      });
  };

  const dismissSuggestion = () => {
    if (suggestion === undefined) return;
    setDismissed([...dismissed, suggestion.contactId]);
    track('vip_suggestion_dismissed');
    void getSupabase()
      .from('ai_feedback')
      .insert({
        target_type: 'contact',
        target_id: suggestion.contactId,
        rating: -1,
        reason_code: 'other',
      } as never)
      .then(() => {
        invalidatePeople();
      });
  };

  let body;
  if (list.isPending) {
    body = <ListSkeleton rows={4} accessibilityLabel={common('a11y.loading')} />;
  } else if (list.isError && list.data === undefined) {
    body = (
      <ErrorCard
        icon="error"
        tone="neutral"
        title={t('loadFailed')}
        primaryAction={{
          label: common('actions.retry'),
          onPress: () => {
            void list.refetch();
          },
        }}
        testID="vip.error"
      />
    );
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon="star"
        tone="primary"
        title={states('empty.noVip.title')}
        body={states('empty.noVip.body')}
        action={{
          label: states('empty.noVip.cta'),
          onPress: () => {
            track('vip_picker_opened');
            setPicker(true);
          },
        }}
        testID="vip.empty"
      />
    );
  } else {
    body = GROUPS.map((group) => {
      const members = rows.filter((r) => group.members.includes(r.relationship));
      if (members.length === 0) return null;
      return (
        <View key={group.key} style={styles.section} testID={`vip.group.${group.key}`}>
          <SectionHeader title={t(`groups.${group.key as GroupKey}`)} />
          <GroupedList>
            {members.map((row) => {
              const meta = [
                row.organization ?? rel(row.relationship),
                row.alwaysNotify ? t('alwaysNotifyMeta') : null,
              ]
                .filter((p): p is string => p !== null)
                .join(' · ');
              return (
                <ListRow
                  key={row.id}
                  title={row.name}
                  subtitle={meta}
                  density="twoLineTrailing"
                  trailing={{
                    kind: 'custom',
                    node: (
                      <IconButton
                        icon="star"
                        filled
                        variant="plain"
                        accessibilityLabel={t('starA11y', { name: row.name })}
                        onPress={() => {
                          removeWithUndo(row);
                        }}
                        testID={`vip.star.${row.id}`}
                      />
                    ),
                  }}
                  onPress={() => {
                    router.push(`/person/${row.contactId}?origin=vip`);
                  }}
                  accessibilityHint={t('rowHint')}
                  testID={`vip.row.${row.id}`}
                />
              );
            })}
          </GroupedList>
          {members.map((row) => (
            <TextAction
              key={`edit-${row.id}`}
              label={t('changeGroup', { name: row.name })}
              compact
              onPress={() => {
                setEdit({
                  contactId: row.contactId,
                  name: row.name,
                  vipId: row.id,
                  settings: {
                    relationship: row.relationship,
                    alwaysNotify: row.alwaysNotify,
                    bypassQuietHours: row.bypassQuietHours,
                  },
                });
              }}
              testID={`vip.edit.${row.id}`}
            />
          ))}
        </View>
      );
    });
  }

  return (
    <View
      style={[styles.root, { backgroundColor: theme.color.bg, paddingTop: insets.top }]}
      testID="screen.vip"
    >
      <DetailHeader
        leading="back"
        onLeadingPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace('/today');
        }}
        leadingAccessibilityLabel={common('actions.back')}
        trailing={
          <HeaderPill
            label={t('add')}
            icon="add"
            tint="brand"
            onPress={() => {
              track('vip_picker_opened');
              setPicker(true);
            }}
            testID="vip.add"
          />
        }
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingHorizontal: theme.layout.screenX }]}
      >
        <Text variant="h1" heading>
          {t('title')}
        </Text>
        <Text variant="secondary">{t('subtitle')}</Text>
        {!online ? (
          <OfflineBanner
            message={states('offline.queued')}
            refreshLabel={states('offline.refresh')}
            onRefresh={() => {
              void list.refetch();
            }}
          />
        ) : null}
        {!pro ? (
          <ContextualGate
            feature="vip"
            title={t('gateTitle')}
            body={t('gateBody')}
            testID="vip.gate"
          />
        ) : null}
        {suggestion !== undefined ? (
          <Surface
            background="sunken"
            radius="card"
            padding={14}
            style={styles.suggestion}
            testID="vip.suggestion"
          >
            <View style={styles.suggestionRow}>
              <Avatar name={suggestion.name} id={suggestion.contactId} size={32} decorative />
              <Text variant="bodySm" style={styles.flex}>
                {t('suggestion', { name: suggestion.name, count: suggestion.exchanges })}
              </Text>
            </View>
            <View style={styles.suggestionActions}>
              <TextAction label={t('yes')} onPress={acceptSuggestion} testID="vip.suggestion.yes" />
              <TextAction
                label={common('actions.notNow')}
                emphasis="secondary"
                onPress={dismissSuggestion}
                testID="vip.suggestion.dismiss"
              />
            </View>
          </Surface>
        ) : null}
        {body}
      </ScrollView>
      <ContactPickerSheet
        visible={picker}
        excluded={rows.map((r) => r.contactId)}
        onClose={() => {
          setPicker(false);
        }}
        onPick={(contact) => {
          setPicker(false);
          setEdit({ contactId: contact.id, name: contact.name, vipId: null });
        }}
      />
      <VipEditSheet
        target={edit}
        onClose={() => {
          setEdit(null);
        }}
        onRemoved={(target) => {
          const row = rows.find((r) => r.contactId === target.contactId);
          if (row !== undefined) {
            showToast({ message: t('removed', { name: row.name }), kind: 'success' });
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { gap: 14, paddingBottom: 40 },
  section: { gap: 8 },
  suggestion: { gap: 10 },
  suggestionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  suggestionActions: { flexDirection: 'row', gap: 16 },
  flex: { flex: 1 },
});

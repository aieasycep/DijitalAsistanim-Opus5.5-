/**
 * M-SET-51 rule editor (`/settings/priority-rules/[id]`, `new` = create, prefill
 * `?type=&value=`), M-SET-52 exceptions sheet and M-SET-53 delete dialog + 5 s undo. The condition
 * (person / domain / keyword / category / sender), the outcome and a debounced live preview over
 * the last 30 days (RPC-11, security invoker: own mail only). Saving inserts or PATCHes
 * `priority_rules` under RLS (blocked offline, the preview needs the network); a duplicate rule is
 * reported; leaving with unsaved changes asks first. The "Uygulama" (`android_app`) condition is
 * offered on Android when notification access is granted and the user has Pro (T-8.26, M-SET-51
 * permission edge case); its input is a picker over the NI module's candidate apps.
 */
import { qk } from '@da/api-client';
import type { RuleCondition, RuleOutcome } from '@da/domain';
import {
  BottomSheet,
  Button,
  ChoiceChip,
  ConfirmDialog,
  ListRow,
  NotFoundState,
  RulePreviewCard,
  SearchField,
  Switch,
  Text,
  TextField,
  TokenChip,
  useBackHandler,
} from '@da/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useFormatter, useTranslations } from 'use-intl';

import { getSupabase } from '../../lib/auth/supabase';
import { now } from '../../lib/clock';
import { track } from '../../lib/events';
import { DataError } from '../../lib/postgrest';
import { useOnline } from '../../lib/query/online-manager';
import { showToast } from '../../providers/ToastHost';
import { isNiSupported, niCall, type NiCandidateApp } from '../android-ni/native';
import { ListSkeleton } from '../common/ListSkeleton';
import { isPro } from '../pro-gate/ProGate';
import { goBack } from '../settings/ui';
import { SettingsGroup, SettingsPage } from '../settings/ui';
import {
  EMPTY_DRAFT,
  KEYWORDS_MAX,
  OUTCOMES,
  RULE_CATEGORIES,
  draftOf,
  fetchPreview,
  normalizeDomain,
  patchRule,
  previewBucket,
  previewKey,
  rulesQueryOptions,
  saveRule,
  validateDraft,
  type RuleDraft,
  type RuleRow,
} from './rules';
import { useRuleSummary } from './summary';

/** Conditions offered everywhere; `android_app` is added by `editorConditions()`. */
const EDITOR_CONDITIONS: readonly RuleCondition[] = [
  'person',
  'domain',
  'keyword',
  'category',
  'sender',
];

/** "Uygulama" needs Android, Pro and a granted notification listener (T-8.26). */
function editorConditions(): readonly RuleCondition[] {
  const niApps =
    Platform.OS === 'android' &&
    isPro() &&
    isNiSupported() &&
    niCall(false, (ni) => ni.isGranted());
  return niApps ? [...EDITOR_CONDITIONS, 'android_app'] : EDITOR_CONDITIONS;
}

/** Apps the rule can name: the NI module's candidates minus the locked denylist. */
function ruleApps(): readonly NiCandidateApp[] {
  return niCall([], (ni) => ni.listCandidateApps())
    .filter((app) => !app.locked)
    .sort((a, b) => a.label.localeCompare(b.label, 'tr'));
}
const CONDITION_ICON = {
  person: 'person',
  domain: 'alternate_email',
  keyword: 'match_word',
  category: 'sell',
  sender: 'outgoing_mail',
  android_app: 'apps',
} as const;

interface ContactRow {
  readonly id: string;
  readonly display_name: string;
  readonly primary_email: string | null;
  readonly message_count_30d: number;
}

function useContacts() {
  return useQuery({
    queryKey: qk.rules.suggestions(),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = (await getSupabase()
        .from('contacts')
        .select('id, display_name, primary_email, message_count_30d')
        .order('message_count_30d', { ascending: false })
        .limit(50)) as unknown as { data: ContactRow[] | null };
      return data ?? [];
    },
  });
}

/** Top sender domains among own contacts that no existing domain rule covers. */
export function suggestedDomains(
  contacts: readonly ContactRow[],
  rules: readonly RuleRow[],
  limit = 3,
): readonly string[] {
  const covered = new Set(
    rules
      .filter((r) => r.condition_type === 'domain')
      .map((r) => (typeof r.condition_value.domain === 'string' ? r.condition_value.domain : '')),
  );
  const score = new Map<string, number>();
  for (const contact of contacts) {
    const domain = contact.primary_email?.split('@')[1]?.toLowerCase();
    if (domain === undefined || covered.has(domain)) continue;
    score.set(domain, (score.get(domain) ?? 0) + contact.message_count_30d);
  }
  return [...score.entries()]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([domain]) => domain);
}

function prefillOf(type: string | undefined, value: string | undefined): RuleDraft {
  const condition = editorConditions().find((c) => c === type);
  if (condition === undefined) return EMPTY_DRAFT;
  const v = value ?? '';
  switch (condition) {
    case 'domain':
      return { ...EMPTY_DRAFT, condition, domain: normalizeDomain(v) };
    case 'sender':
      return { ...EMPTY_DRAFT, condition, sender: v };
    case 'keyword':
      return { ...EMPTY_DRAFT, condition, keywords: v === '' ? [] : [v] };
    case 'android_app':
      return { ...EMPTY_DRAFT, condition, appPackage: v === '' ? null : v };
    default:
      return { ...EMPTY_DRAFT, condition };
  }
}

function ExceptionsSheet({
  draft,
  onDone,
  onDismiss,
}: {
  readonly draft: RuleDraft;
  readonly onDone: (exceptions: RuleDraft['exceptions']) => void;
  readonly onDismiss: () => void;
}) {
  const t = useTranslations();
  const [items, setItems] = useState(draft.exceptions);
  const [sender, setSender] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const categories = items.flatMap((e) =>
    e.condition_type === 'category' && 'category' in e.condition_value
      ? [e.condition_value.category]
      : [],
  );
  const senders = items.flatMap((e) =>
    e.condition_type === 'sender' && 'address' in e.condition_value
      ? [e.condition_value.address]
      : [],
  );
  return (
    <BottomSheet
      visible
      onDismiss={onDismiss}
      title={t('settings.rulesScreen.exceptions.title')}
      testID="sheet.exceptions"
      footer={
        <Button
          label={t('common.actions.ok')}
          variant="ink"
          fullWidth
          onPress={() => {
            track('rule_exceptions_changed', { count: items.length });
            onDone(items);
          }}
          testID="exceptions.done"
        />
      }
    >
      <Text variant="kicker" tone="secondary">
        {t('settings.rulesScreen.exceptions.categories')}
      </Text>
      {RULE_CATEGORIES.map((category) => {
        const checked = categories.includes(category);
        return (
          <ListRow
            key={category}
            title={t(`settings.rulesScreen.categories.${category}`)}
            trailing={{ kind: 'check', checked }}
            onPress={() => {
              setItems(
                checked
                  ? items.filter(
                      (e) =>
                        !(
                          e.condition_type === 'category' &&
                          'category' in e.condition_value &&
                          e.condition_value.category === category
                        ),
                    )
                  : [...items, { condition_type: 'category', condition_value: { category } }],
              );
            }}
            testID={`exceptions.category.${category}`}
          />
        );
      })}
      <Text variant="kicker" tone="secondary">
        {t('settings.rulesScreen.exceptions.senders')}
      </Text>
      <View style={styles.tokens}>
        {senders.length === 0 ? (
          <Text variant="bodySm" tone="secondary">
            {t('settings.rulesScreen.exceptions.none')}
          </Text>
        ) : (
          senders.map((address) => (
            <TokenChip
              key={address}
              label={address}
              removeLabel={t('common.actions.remove')}
              onRemove={() => {
                setItems(
                  items.filter(
                    (e) =>
                      !(
                        e.condition_type === 'sender' &&
                        'address' in e.condition_value &&
                        e.condition_value.address === address
                      ),
                  ),
                );
              }}
            />
          ))
        )}
      </View>
      <TextField
        label={t('settings.rulesScreen.exceptions.senderLabel')}
        value={sender}
        autoCapitalize="none"
        keyboardType="email-address"
        onChangeText={(text) => {
          setSender(text);
          setError(undefined);
        }}
        {...(error === undefined ? {} : { error })}
        testID="exceptions.sender"
      />
      <Button
        label={t('common.actions.add')}
        variant="tonal"
        size="sm"
        onPress={() => {
          const address = sender.trim().toLowerCase();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
            setError(t('settings.rulesScreen.exceptions.invalidEmail'));
            return;
          }
          setItems([...items, { condition_type: 'sender', condition_value: { address } }]);
          setSender('');
        }}
        testID="exceptions.add"
      />
    </BottomSheet>
  );
}

function ContactPicker({
  onPick,
  onDismiss,
}: {
  readonly onPick: (contact: ContactRow) => void;
  readonly onDismiss: () => void;
}) {
  const t = useTranslations();
  const contacts = useContacts();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase('tr-TR');
  const list = (contacts.data ?? []).filter(
    (c) =>
      needle === '' ||
      c.display_name.toLocaleLowerCase('tr-TR').includes(needle) ||
      (c.primary_email ?? '').includes(needle),
  );
  return (
    <BottomSheet
      visible
      onDismiss={onDismiss}
      title={t('settings.rulesScreen.pickContact')}
      testID="sheet.contactPicker"
    >
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder={t('common.actions.search')}
        accessibilityLabel={t('common.actions.search')}
        testID="contactPicker.search"
      />
      {contacts.isPending ? (
        <ListSkeleton rows={3} accessibilityLabel={t('common.a11y.loading')} />
      ) : list.length === 0 ? (
        <Text variant="body" tone="secondary" testID="contactPicker.empty">
          {t('settings.rulesScreen.noContacts')}
        </Text>
      ) : (
        list.slice(0, 20).map((contact) => (
          <ListRow
            key={contact.id}
            title={contact.display_name}
            {...(contact.primary_email === null ? {} : { subtitle: contact.primary_email })}
            onPress={() => {
              onPick(contact);
            }}
            testID={`contactPicker.${contact.id}`}
          />
        ))
      )}
    </BottomSheet>
  );
}

function RuleEditor({
  rule,
  initial,
}: {
  readonly rule: RuleRow | null;
  readonly initial: RuleDraft;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const router = useRouter();
  const navigation = useNavigation();
  const online = useOnline();
  const queryClient = useQueryClient();
  const rules = useQuery(rulesQueryOptions());
  const contacts = useContacts();
  const summary = useRuleSummary();
  const [draft, setDraft] = useState<RuleDraft>(initial);
  const [keyword, setKeyword] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<'exceptions' | 'contact' | 'app' | null>(null);
  const [apps] = useState(ruleApps);
  const conditions = (() => {
    const offered = editorConditions();
    return offered.includes(draft.condition) ? offered : [...offered, draft.condition];
  })();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [leaveDialog, setLeaveDialog] = useState(false);
  const [showAllOutcomes, setShowAllOutcomes] = useState(rule === null);
  const [debounced, setDebounced] = useState<RuleDraft>(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const allowLeave = useRef(false);
  const leave = () => {
    allowLeave.current = true;
    goBack(router);
  };
  const valid = validateDraft(draft) === null;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(draft);
    }, 400);
    return () => {
      clearTimeout(timer);
    };
  }, [draft]);

  const previewValid = validateDraft(debounced) === null;
  const preview = useQuery({
    queryKey: qk.rules.preview(previewKey(debounced)),
    queryFn: () => fetchPreview(debounced),
    enabled: online && previewValid,
    staleTime: 60_000,
    retry: false,
  });
  const previewCount = preview.data?.match_count;
  useEffect(() => {
    if (previewCount !== undefined)
      track('rule_preview_loaded', { bucket: previewBucket(previewCount) });
  }, [previewCount]);

  // Leaving with unsaved changes asks first (header back, Android back, swipe).
  useEffect(() => {
    return navigation.addListener('beforeRemove', (event) => {
      if (!dirty || allowLeave.current) return;
      event.preventDefault();
      setLeaveDialog(true);
    });
  }, [navigation, dirty]);
  useBackHandler(leaveDialog, () => {
    setLeaveDialog(false);
    return true;
  });

  const update = (patch: Partial<RuleDraft>) => {
    setDraft({ ...draft, ...patch });
    setError(undefined);
  };

  const errorText = (code: NonNullable<ReturnType<typeof validateDraft>>) => {
    switch (code) {
      case 'domain':
        return t('settings.rulesScreen.errors.domain');
      case 'keywords':
        return t('settings.rulesScreen.errors.keywords');
      case 'sender':
        return t('settings.rulesScreen.errors.sender');
      case 'category':
        return t('settings.rulesScreen.errors.category');
      case 'person':
        return t('settings.rulesScreen.errors.person');
      case 'app':
        return t('settings.rulesScreen.errors.category');
    }
  };

  const save = () => {
    const problem = validateDraft(draft);
    if (problem !== null) {
      setError(errorText(problem));
      return;
    }
    setSaving(true);
    void saveRule(rule?.id ?? null, draft)
      .then(() => {
        track(rule === null ? 'priority_rule_created' : 'priority_rule_updated', {
          condition_type: draft.condition,
          outcome: draft.outcome,
        });
        void queryClient.invalidateQueries({ queryKey: qk.rules.all });
        void queryClient.invalidateQueries({ queryKey: qk.settings.counts() });
        showToast({ message: t('settings.rulesScreen.saved'), kind: 'success' });
        leave();
      })
      .catch((failure: unknown) => {
        setSaving(false);
        if (failure instanceof DataError && failure.code === 'DUPLICATE') {
          setError(t('settings.rulesScreen.errors.duplicate'));
        } else {
          showToast({ message: t('states.error.saveFailed'), kind: 'error' });
        }
      });
  };

  const remove = () => {
    if (rule === null) return;
    setConfirmDelete(false);
    track('priority_rule_deleted', { condition_type: rule.condition_type });
    void patchRule(rule.id, { deleted_at: now().toISOString() })
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: qk.rules.all });
        void queryClient.invalidateQueries({ queryKey: qk.settings.counts() });
        showToast({
          message: t('settings.priorityRules.deleted'),
          action: {
            label: t('common.actions.undo'),
            onPress: () => {
              track('priority_rule_restored');
              void patchRule(rule.id, { deleted_at: null }).then(() =>
                queryClient.invalidateQueries({ queryKey: qk.rules.all }),
              );
            },
          },
        });
        leave();
      })
      .catch(() => {
        showToast({ message: t('states.error.saveFailed'), kind: 'error' });
      });
  };

  const suggestions =
    draft.condition === 'domain' && draft.domain === ''
      ? suggestedDomains(contacts.data ?? [], rules.data ?? [])
      : [];

  const input = (() => {
    switch (draft.condition) {
      case 'domain':
        return (
          <>
            <TextField
              label={t('settings.priorityRules.conditions.domain')}
              prefix="@"
              value={draft.domain}
              placeholder={t('settings.rulesScreen.domainHint')}
              autoCapitalize="none"
              keyboardType="url"
              onChangeText={(text) => {
                update({ domain: text });
              }}
              {...(error === undefined ? {} : { error })}
              testID="rule.domain"
            />
            {suggestions.length === 0 ? null : (
              <View style={styles.tokens}>
                {suggestions.map((domain) => (
                  <ChoiceChip
                    key={domain}
                    label={t('settings.rulesScreen.suggested', { domain })}
                    selected={false}
                    onPress={() => {
                      update({ domain });
                    }}
                    testID={`rule.suggestion.${domain}`}
                  />
                ))}
              </View>
            )}
          </>
        );
      case 'sender':
        return (
          <TextField
            label={t('settings.priorityRules.conditions.sender')}
            value={draft.sender}
            placeholder={t('settings.rulesScreen.senderHint')}
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={(text) => {
              update({ sender: text });
            }}
            {...(error === undefined ? {} : { error })}
            testID="rule.sender"
          />
        );
      case 'keyword':
        return (
          <>
            <View style={styles.tokens}>
              {draft.keywords.map((word) => (
                <TokenChip
                  key={word}
                  label={word}
                  removeLabel={t('common.actions.remove')}
                  onRemove={() => {
                    update({ keywords: draft.keywords.filter((k) => k !== word) });
                  }}
                />
              ))}
            </View>
            <TextField
              label={t('settings.priorityRules.conditions.keyword')}
              value={keyword}
              onChangeText={setKeyword}
              returnKeyType="done"
              onSubmitEditing={() => {
                const word = keyword.trim();
                if (
                  word === '' ||
                  draft.keywords.includes(word) ||
                  draft.keywords.length >= KEYWORDS_MAX
                )
                  return;
                update({ keywords: [...draft.keywords, word] });
                setKeyword('');
              }}
              {...(error === undefined ? {} : { error })}
              testID="rule.keyword"
            />
            <Button
              label={t('common.actions.add')}
              variant="tonal"
              size="sm"
              disabled={keyword.trim() === '' || draft.keywords.length >= KEYWORDS_MAX}
              onPress={() => {
                const word = keyword.trim();
                if (word === '' || draft.keywords.includes(word)) return;
                update({ keywords: [...draft.keywords, word] });
                setKeyword('');
              }}
              testID="rule.keyword.add"
            />
            <ListRow
              title={t('settings.rulesScreen.searchBody')}
              trailing={{ kind: 'switch', value: draft.searchBody }}
              onPress={() => {
                update({ searchBody: !draft.searchBody });
              }}
              testID="rule.searchBody"
            />
          </>
        );
      case 'category':
        return (
          <SettingsGroup>
            {RULE_CATEGORIES.map((category) => (
              <ListRow
                key={category}
                title={t(`settings.rulesScreen.categories.${category}`)}
                trailing={{ kind: 'radio', selected: draft.category === category }}
                onPress={() => {
                  update({ category });
                }}
                testID={`rule.category.${category}`}
              />
            ))}
          </SettingsGroup>
        );
      case 'person':
        return (
          <ListRow
            icon="person"
            title={draft.contactLabel ?? t('settings.rulesScreen.pickContact')}
            trailing={{ kind: 'chevron' }}
            onPress={() => {
              setSheet('contact');
            }}
            testID="rule.person"
          />
        );
      case 'android_app':
        return (
          <ListRow
            icon="apps"
            title={
              apps.find((app) => app.package === draft.appPackage)?.label ??
              draft.appPackage ??
              t('android_ni.picker.title')
            }
            trailing={{ kind: 'chevron' }}
            onPress={() => {
              setSheet('app');
            }}
            testID="rule.app"
          />
        );
    }
  })();

  const outcomes: readonly RuleOutcome[] = showAllOutcomes ? OUTCOMES : [draft.outcome];

  return (
    <SettingsPage
      title={
        rule === null
          ? t('settings.rulesScreen.newTitle')
          : summary(rule, draft.contactLabel ?? undefined)
      }
      kicker={
        rule === null ? t('settings.rulesScreen.newKicker') : t('settings.rulesScreen.editKicker')
      }
      leading={rule === null ? 'close' : 'back'}
      testID="screen.settings.ruleEditor"
      footer={
        <Button
          label={
            rule === null
              ? t('settings.priorityRules.create')
              : t('settings.priorityRules.saveChanges')
          }
          variant={rule === null ? 'primary' : 'ink'}
          fullWidth
          loading={saving}
          disabled={!online || !valid}
          {...(online ? {} : { accessibilityHint: t('states.offline.blockedReason') })}
          onPress={save}
          testID="rule.save"
        />
      }
    >
      {rule === null ? null : (
        <SettingsGroup>
          <ListRow
            title={
              draft.enabled
                ? t('settings.priorityRules.active')
                : t('settings.priorityRules.inactive')
            }
            subtitle={t('settings.rulesScreen.statusMeta', {
              date: format.dateTime(new Date(rule.created_at), { dateStyle: 'medium' }),
              count: rule.match_count_30d,
            })}
            trailing={{
              kind: 'custom',
              node: (
                <Switch
                  value={draft.enabled}
                  accessibilityLabel={t('settings.priorityRules.active')}
                  onValueChange={(enabled) => {
                    update({ enabled });
                  }}
                  testID="rule.enabled"
                />
              ),
            }}
            testID="rule.status"
          />
        </SettingsGroup>
      )}

      <Text variant="kicker" tone="secondary">
        {t('settings.rulesScreen.conditionSection')}
      </Text>
      <View style={styles.tokens} accessibilityRole="radiogroup">
        {conditions.map((condition) => (
          <ChoiceChip
            key={condition}
            icon={CONDITION_ICON[condition]}
            label={t(`settings.priorityRules.conditions.${condition}`)}
            selected={draft.condition === condition}
            onPress={() => {
              update({ condition });
            }}
            testID={`rule.condition.${condition}`}
          />
        ))}
      </View>
      {input}
      {error !== undefined &&
      draft.condition !== 'domain' &&
      draft.condition !== 'sender' &&
      draft.condition !== 'keyword' ? (
        <Text variant="bodySm" tone="critical" testID="rule.error">
          {error}
        </Text>
      ) : null}

      <SettingsGroup title={t('settings.rulesScreen.outcomeSection')}>
        {outcomes.map((outcome) => (
          <ListRow
            key={outcome}
            title={t(`settings.rulesScreen.outcomes.${outcome}`)}
            trailing={{ kind: 'radio', selected: draft.outcome === outcome }}
            onPress={() => {
              update({ outcome });
            }}
            testID={`rule.outcome.${outcome}`}
          />
        ))}
      </SettingsGroup>
      {showAllOutcomes ? null : (
        <Button
          label={t('settings.rulesScreen.otherOutcomes')}
          variant="text"
          size="sm"
          onPress={() => {
            setShowAllOutcomes(true);
          }}
          testID="rule.moreOutcomes"
        />
      )}

      <View accessibilityLiveRegion="polite">
        <RulePreviewCard
          kicker={
            previewCount === undefined
              ? t('settings.rulesScreen.previewKicker')
              : t('settings.rulesScreen.previewCount', { count: previewCount })
          }
          samples={(preview.data?.sample ?? []).map((s, index) => ({
            key: `${String(index)}.${s.date}`,
            text: s.subject === null ? s.sender_label : `${s.sender_label} · ${s.subject}`,
            date: format.dateTime(new Date(s.date), { day: 'numeric', month: 'short' }),
          }))}
          {...(preview.data === undefined || preview.data.match_count === 0
            ? {}
            : {
                footer: t('settings.rulesScreen.previewFooter', {
                  important: preview.data.already_important,
                  up: preview.data.will_move_up,
                }),
              })}
          emptyText={
            !online
              ? t('settings.rulesScreen.previewOffline')
              : previewValid
                ? t('settings.rulesScreen.previewEmpty')
                : t('settings.rulesScreen.previewHint')
          }
          loading={online && previewValid && preview.isFetching && preview.data === undefined}
          {...(preview.isError ? { error: t('settings.rulesScreen.previewError') } : {})}
          testID="rule.preview"
        />
      </View>

      {rule === null ? null : (
        <SettingsGroup>
          <ListRow
            title={t('settings.rulesScreen.exceptions.title')}
            trailing={{
              kind: 'value',
              text:
                draft.exceptions.length === 0
                  ? t('settings.rulesScreen.exceptions.none')
                  : String(draft.exceptions.length),
              chevron: true,
            }}
            onPress={() => {
              setSheet('exceptions');
            }}
            testID="rule.exceptions"
          />
          <ListRow
            title={t('settings.rulesScreen.delete')}
            destructive
            onPress={() => {
              setConfirmDelete(true);
            }}
            testID="rule.delete"
          />
        </SettingsGroup>
      )}

      {sheet === 'exceptions' ? (
        <ExceptionsSheet
          draft={draft}
          onDismiss={() => {
            setSheet(null);
          }}
          onDone={(exceptions) => {
            update({ exceptions });
            setSheet(null);
          }}
        />
      ) : null}
      {sheet === 'app' ? (
        <BottomSheet
          visible
          onDismiss={() => {
            setSheet(null);
          }}
          title={t('android_ni.picker.title')}
          testID="sheet.ruleAppPicker"
        >
          {apps.length === 0 ? (
            <Text variant="body" tone="secondary" testID="ruleAppPicker.empty">
              {t('android_ni.picker.noApps')}
            </Text>
          ) : (
            apps.slice(0, 50).map((app) => (
              <ListRow
                key={app.package}
                icon="apps"
                title={app.label}
                trailing={{ kind: 'radio', selected: draft.appPackage === app.package }}
                onPress={() => {
                  update({ appPackage: app.package });
                  setSheet(null);
                }}
                testID={`ruleAppPicker.${app.package}`}
              />
            ))
          )}
        </BottomSheet>
      ) : null}
      {sheet === 'contact' ? (
        <ContactPicker
          onDismiss={() => {
            setSheet(null);
          }}
          onPick={(contact) => {
            update({ contactId: contact.id, contactLabel: contact.display_name });
            setSheet(null);
          }}
        />
      ) : null}
      {rule === null ? null : (
        <ConfirmDialog
          visible={confirmDelete}
          icon="delete"
          title={t('settings.priorityRules.deleteTitle')}
          body={t('settings.rulesScreen.deleteBody', { summary: summary(rule) })}
          confirm={{ label: t('settings.rulesScreen.delete'), onPress: remove }}
          cancel={{
            label: t('common.actions.nevermind'),
            onPress: () => {
              setConfirmDelete(false);
            },
          }}
          testID="rule.deleteDialog"
        />
      )}
      <ConfirmDialog
        visible={leaveDialog}
        title={t('settings.rulesScreen.leaveTitle')}
        confirm={{
          label: t('settings.rulesScreen.leaveDiscard'),
          onPress: () => {
            setLeaveDialog(false);
            leave();
          },
        }}
        cancel={{
          label: t('settings.rulesScreen.leaveKeep'),
          onPress: () => {
            setLeaveDialog(false);
          },
        }}
        testID="rule.leaveDialog"
      />
    </SettingsPage>
  );
}

export function RuleEditorScreen() {
  const t = useTranslations();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; type?: string; value?: string }>();
  const rules = useQuery(rulesQueryOptions());
  const creating = params.id === 'new';
  if (creating) {
    return <RuleEditor rule={null} initial={prefillOf(params.type, params.value)} />;
  }
  const rule = rules.data?.find((r) => r.id === params.id);
  if (rule === undefined) {
    if (rules.isPending) {
      return (
        <SettingsPage title={t('settings.priorityRules.title')} testID="screen.settings.ruleEditor">
          <ListSkeleton rows={4} accessibilityLabel={t('common.a11y.loading')} />
        </SettingsPage>
      );
    }
    return (
      <SettingsPage title={t('settings.priorityRules.title')} testID="screen.settings.ruleEditor">
        <NotFoundState
          variant="entity"
          title={t('settings.rulesScreen.notFound')}
          backAction={{
            label: t('common.actions.goBack'),
            onPress: () => {
              goBack(router);
            },
          }}
          testID="rule.notFound"
        />
      </SettingsPage>
    );
  }
  return <RuleEditor key={rule.id} rule={rule} initial={draftOf(rule)} />;
}

const styles = StyleSheet.create({
  tokens: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});

/**
 * Priority rules and learned preferences under RLS (T-8.21, M§31–32): PostgREST reads with explicit
 * columns, owner writes (`priority_rules` insert/PATCH incl. the soft delete, `learned_preferences`
 * PATCH of `enabled`, `priority_override`, `deleted_at` only), the editor draft ↔ `condition_value`
 * mapping of `private.valid_rule_condition` / the `@da/domain` engine, validation, and the live
 * preview through RPC-11 `preview_priority_rule`.
 */
import { qk } from '@da/api-client';
import type { RuleCondition, RuleOutcome } from '@da/domain';
import type { PriorityRule, RuleException } from '@da/domain/entities/intelligence';
import { queryOptions } from '@tanstack/react-query';

import { getSupabase } from '../../lib/auth/supabase';
import { cachedBootstrap, DataError, rpc, toDataError } from '../../lib/postgrest';

export const CONDITIONS: readonly RuleCondition[] = [
  'person',
  'domain',
  'keyword',
  'category',
  'sender',
  'android_app',
];
export const OUTCOMES: readonly RuleOutcome[] = [
  'always_important',
  'high',
  'low',
  'always_notify',
  'mute',
];
/** `mail_category` values except `important`, plus `promotions` (M-SET-51 vocabulary). */
export const RULE_CATEGORIES = [
  'promotions',
  'informational',
  'low_priority',
  'has_deadline',
  'awaiting_my_reply',
  'awaiting_their_reply',
] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];
export const KEYWORDS_MAX = 10;

export interface RuleRow {
  readonly id: string;
  readonly condition_type: RuleCondition;
  readonly condition_value: Readonly<Record<string, unknown>>;
  readonly outcome: RuleOutcome;
  readonly applies_to: 'mail' | 'android_notification' | 'all';
  readonly enabled: boolean;
  readonly search_body: boolean;
  readonly exceptions: readonly RuleException[];
  readonly match_count_30d: number;
  readonly last_matched_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface LearnedRow {
  readonly id: string;
  readonly group_key: 'people' | 'topics' | 'timing' | 'tone' | 'categories';
  readonly statement: string;
  readonly target_type: string;
  readonly effect: { readonly priority?: 'high' | 'normal' | 'low' };
  readonly priority_override: 'high' | 'normal' | 'low' | null;
  readonly evidence_summary: string | null;
  readonly enabled: boolean;
}

const RULE_COLUMNS =
  'id, condition_type, condition_value, outcome, applies_to, enabled, search_body, exceptions, match_count_30d, last_matched_at, created_at, updated_at';
const LEARNED_COLUMNS =
  'id, group_key, statement, target_type, effect, priority_override, evidence_summary, enabled';

interface Rows<T> {
  readonly data: T[] | null;
  readonly error: { readonly message?: string; readonly code?: string } | null;
}

export async function fetchRules(): Promise<readonly RuleRow[]> {
  const { data, error } = (await getSupabase()
    .from('priority_rules')
    .select(RULE_COLUMNS)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })) as unknown as Rows<RuleRow>;
  if (error !== null) throw toDataError(error);
  return data ?? [];
}

export function rulesQueryOptions() {
  return queryOptions({
    queryKey: qk.rules.list(),
    queryFn: fetchRules,
    staleTime: 60_000,
    meta: { persist: true },
  });
}

export async function fetchLearned(): Promise<readonly LearnedRow[]> {
  const { data, error } = (await getSupabase()
    .from('learned_preferences')
    .select(LEARNED_COLUMNS)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })) as unknown as Rows<LearnedRow>;
  if (error !== null) throw toDataError(error);
  return data ?? [];
}

export function learnedQueryOptions() {
  return queryOptions({
    queryKey: qk.learned.list(),
    queryFn: fetchLearned,
    staleTime: 60_000,
    meta: { persist: true },
  });
}

async function patch(
  table: 'priority_rules' | 'learned_preferences',
  id: string,
  values: Readonly<Record<string, unknown>>,
): Promise<void> {
  const { error } = (await getSupabase()
    .from(table)
    .update(values as never)
    .eq('id', id)) as unknown as { error: { message?: string; code?: string } | null };
  if (error !== null) throw toDataError(error);
}

export function patchRule(id: string, values: Readonly<Record<string, unknown>>): Promise<void> {
  return patch('priority_rules', id, values);
}

/** Only `enabled`, `priority_override` and `deleted_at` are user-updatable (column grants). */
export function patchLearned(
  id: string,
  values: Partial<
    Pick<LearnedRow, 'enabled' | 'priority_override'> & { deleted_at: string | null }
  >,
): Promise<void> {
  return patch('learned_preferences', id, values);
}

// ── Editor draft ─────────────────────────────────────────────────────────────────────────────

export interface RuleDraft {
  readonly condition: RuleCondition;
  readonly domain: string;
  readonly sender: string;
  readonly keywords: readonly string[];
  readonly searchBody: boolean;
  readonly category: RuleCategory | null;
  readonly contactId: string | null;
  readonly contactLabel: string | null;
  readonly appPackage: string | null;
  readonly outcome: RuleOutcome;
  readonly enabled: boolean;
  readonly exceptions: readonly RuleException[];
}

export const EMPTY_DRAFT: RuleDraft = {
  condition: 'domain',
  domain: '',
  sender: '',
  keywords: [],
  searchBody: false,
  category: null,
  contactId: null,
  contactLabel: null,
  appPackage: null,
  outcome: 'always_important',
  enabled: true,
  exceptions: [],
};

const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SENDER_PATTERN = /^[a-z0-9._%+-]+@\*$/;

export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, '');
}

export type DraftError = 'domain' | 'keywords' | 'sender' | 'category' | 'person' | 'app';

export function validateDraft(draft: RuleDraft): DraftError | null {
  switch (draft.condition) {
    case 'domain':
      return DOMAIN.test(normalizeDomain(draft.domain)) ? null : 'domain';
    case 'keyword':
      return draft.keywords.length === 0 || draft.keywords.length > KEYWORDS_MAX
        ? 'keywords'
        : null;
    case 'sender': {
      const value = draft.sender.trim().toLowerCase();
      return EMAIL.test(value) || SENDER_PATTERN.test(value) ? null : 'sender';
    }
    case 'category':
      return draft.category === null ? 'category' : null;
    case 'person':
      return draft.contactId === null ? 'person' : null;
    case 'android_app':
      return draft.appPackage === null ? 'app' : null;
  }
}

/** The `condition_value` jsonb of a valid draft. */
export function conditionValueOf(draft: RuleDraft): Readonly<Record<string, unknown>> {
  switch (draft.condition) {
    case 'domain':
      return { domain: normalizeDomain(draft.domain) };
    case 'keyword':
      return { keywords: draft.keywords.map((k) => k.trim()).filter((k) => k !== '') };
    case 'sender':
      return { address: draft.sender.trim().toLowerCase() };
    case 'category':
      return { category: draft.category ?? '' };
    case 'person':
      return { contact_id: draft.contactId ?? '' };
    case 'android_app':
      return { package: draft.appPackage ?? '' };
  }
}

export function draftOf(rule: RuleRow): RuleDraft {
  const v = rule.condition_value;
  const str = (key: string) => (typeof v[key] === 'string' ? v[key] : '');
  return {
    ...EMPTY_DRAFT,
    condition: rule.condition_type,
    domain: str('domain'),
    sender: str('address'),
    keywords: Array.isArray(v.keywords)
      ? v.keywords.filter((k): k is string => typeof k === 'string')
      : [],
    searchBody: rule.search_body,
    category: RULE_CATEGORIES.find((c) => c === v.category) ?? null,
    contactId: typeof v.contact_id === 'string' ? v.contact_id : null,
    appPackage: typeof v.package === 'string' ? v.package : null,
    outcome: rule.outcome,
    enabled: rule.enabled,
    exceptions: rule.exceptions,
  };
}

/** The engine view of a draft (used by the preview tests and the precedence check). */
export function ruleFromDraft(
  draft: RuleDraft,
  ids: { readonly id: string; readonly userId: string; readonly now: string },
): PriorityRule {
  return {
    id: ids.id,
    user_id: ids.userId,
    created_at: ids.now,
    updated_at: ids.now,
    condition_type: draft.condition,
    condition_value: conditionValueOf(draft) as PriorityRule['condition_value'],
    outcome: draft.outcome,
    search_body: draft.searchBody,
    exceptions: draft.exceptions,
    applies_to: draft.condition === 'android_app' ? 'android_notification' : 'mail',
    enabled: draft.enabled,
    sort_order: 0,
    deleted_at: null,
  };
}

/** Insert (create) or PATCH (edit); a duplicate rule raises `DataError('DUPLICATE')`. */
export async function saveRule(id: string | null, draft: RuleDraft): Promise<void> {
  const values = {
    condition_type: draft.condition,
    condition_value: conditionValueOf(draft),
    outcome: draft.outcome,
    search_body: draft.condition === 'keyword' && draft.searchBody,
    exceptions: draft.exceptions,
    applies_to: draft.condition === 'android_app' ? 'android_notification' : 'mail',
    enabled: draft.enabled,
  };
  const supabase = getSupabase();
  const userId = cachedBootstrap()?.profile.id;
  if (userId === undefined) throw new DataError('AUTH_REQUIRED', null);
  const query =
    id === null
      ? supabase.from('priority_rules').insert({ ...values, user_id: userId } as never)
      : supabase
          .from('priority_rules')
          .update(values as never)
          .eq('id', id);
  const { error } = (await query) as unknown as {
    error: { message?: string; code?: string } | null;
  };
  if (error === null) return;
  if (error.code === '23505' || /duplicate key/i.test(error.message ?? '')) {
    throw new DataError('DUPLICATE', null);
  }
  throw toDataError(error);
}

// ── Preview (RPC-11) ─────────────────────────────────────────────────────────────────────────

export interface RulePreview {
  readonly match_count: number;
  readonly sample: readonly {
    readonly sender_label: string;
    readonly subject: string | null;
    readonly date: string;
  }[];
  readonly already_important: number;
  readonly will_move_up: number;
}

export async function fetchPreview(draft: RuleDraft): Promise<RulePreview> {
  const raw = (await rpc('preview_priority_rule', {
    p_condition_type: draft.condition,
    p_condition_value: conditionValueOf(draft) as never,
    p_outcome: draft.outcome,
  })) as Partial<RulePreview> | null;
  return {
    match_count: raw?.match_count ?? 0,
    sample: raw?.sample ?? [],
    already_important: raw?.already_important ?? 0,
    will_move_up: raw?.will_move_up ?? 0,
  };
}

export function previewKey(draft: RuleDraft): string {
  return JSON.stringify([draft.condition, conditionValueOf(draft), draft.outcome]);
}

export function previewBucket(n: number): '0' | '1-5' | '6-20' | '21-100' | '100+' {
  if (n === 0) return '0';
  if (n <= 5) return '1-5';
  if (n <= 20) return '6-20';
  if (n <= 100) return '21-100';
  return '100+';
}

/** The outcome group of the list (7.9 groups). */
export const OUTCOME_GROUPS: readonly RuleOutcome[] = [
  'always_important',
  'high',
  'low',
  'always_notify',
  'mute',
];

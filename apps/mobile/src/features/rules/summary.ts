/**
 * Human-readable rule summaries for the list (7.9), the editor and the delete dialog, from
 * `condition_type` + `condition_value` (never free text from elsewhere).
 */
import { useTranslations } from 'use-intl';

import type { RuleRow } from './rules';

export function useRuleSummary() {
  const t = useTranslations();
  return (rule: Pick<RuleRow, 'condition_type' | 'condition_value'>, contactName?: string) => {
    const v = rule.condition_value;
    const str = (key: string) => (typeof v[key] === 'string' ? v[key] : '');
    switch (rule.condition_type) {
      case 'person':
        return t('settings.rulesScreen.summary.person', {
          name: contactName ?? t('settings.priorityRules.conditions.person'),
        });
      case 'domain':
        return t('settings.rulesScreen.summary.domain', { domain: str('domain') });
      case 'sender':
        return t('settings.rulesScreen.summary.sender', { address: str('address') });
      case 'keyword': {
        const words = Array.isArray(v.keywords)
          ? v.keywords.filter((k): k is string => typeof k === 'string')
          : [];
        return t('settings.rulesScreen.summary.keyword', {
          words: words.map((w) => `“${w}”`).join(', '),
        });
      }
      case 'category': {
        const category = str('category');
        const known = [
          'promotions',
          'informational',
          'low_priority',
          'has_deadline',
          'awaiting_my_reply',
          'awaiting_their_reply',
        ] as const;
        const key = known.find((k) => k === category);
        return key === undefined ? category : t(`settings.rulesScreen.categories.${key}`);
      }
      case 'android_app':
        return t('settings.rulesScreen.summary.app', { app: str('package') });
    }
  };
}

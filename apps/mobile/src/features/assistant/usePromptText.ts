/** The visible text of a suggested prompt (`assistant.prompts.*`). */
import { useTranslations } from 'use-intl';

import type { PromptKey, SuggestedPrompt } from './prompts';

export const PROMPT_KEYS: readonly PromptKey[] = [
  'focus',
  'replies',
  'tomorrow_busy',
  'last_talked',
  'deadlines_this_week',
  'payments_due',
];

export function isPromptKey(value: unknown): value is PromptKey {
  return (PROMPT_KEYS as readonly unknown[]).includes(value);
}

export function usePromptText() {
  const t = useTranslations('assistant.prompts');
  return (prompt: SuggestedPrompt): string => {
    switch (prompt.key) {
      case 'focus':
        return t('focus');
      case 'replies':
        return t('replies');
      case 'tomorrow_busy':
        return t('tomorrowBusy');
      case 'last_talked':
        return t('lastTalked', { name: prompt.name ?? '' });
      case 'deadlines_this_week':
        return t('deadlinesThisWeek');
      case 'payments_due':
        return t('paymentsDue');
    }
  };
}

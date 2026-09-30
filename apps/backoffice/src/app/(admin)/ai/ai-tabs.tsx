import { useTranslations } from 'next-intl';

import { TabNav } from '@/components/module-kit';

/** AI Operasyonları tabs (BACKOFFICE_PLAN §5.2): Genel, İstekler, Modeller. */
export function AiTabs({ active }: { active: 'overview' | 'requests' | 'models' }) {
  const t = useTranslations('backoffice.ai.tabs');
  return (
    <TabNav
      label={t('label')}
      active={active}
      items={[
        { key: 'overview', href: '/ai', label: t('overview') },
        { key: 'requests', href: '/ai?tab=requests', label: t('requests') },
        { key: 'models', href: '/ai/models', label: t('models') },
      ]}
    />
  );
}

/** Prompt Yönetimi tabs (§5.2): Promptlar, AI Geri Bildirimi. */
export function PromptTabs({ active }: { active: 'prompts' | 'feedback' }) {
  const t = useTranslations('backoffice.prompts.tabs');
  return (
    <TabNav
      label={t('label')}
      active={active}
      items={[
        { key: 'prompts', href: '/ai/prompts', label: t('prompts') },
        { key: 'feedback', href: '/ai/feedback', label: t('feedback') },
      ]}
    />
  );
}

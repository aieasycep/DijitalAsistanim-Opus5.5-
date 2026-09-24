'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useCan } from '@/components/admin-provider';
import { cn } from '@/lib/cn';

/** The eight user tabs (§6.3), shown by the module permission each one needs (cosmetic). */
export const USER_TABS = [
  { key: 'overview', permission: 'users.read' },
  { key: 'integrations', permission: 'integrations.read' },
  { key: 'briefings', permission: 'briefings.read' },
  { key: 'usage', permission: 'users.read' },
  { key: 'subscription', permission: 'subscriptions.read' },
  { key: 'referrals', permission: 'referrals.read' },
  { key: 'support', permission: 'support.read' },
  { key: 'audit', permission: 'audit.read' },
] as const;

export function UserTabs({ userId }: { userId: string }) {
  const t = useTranslations('backoffice.userDetail.tabs');
  const pathname = usePathname();
  const can = useCan();
  const active = pathname.split('/')[3] ?? 'overview';
  return (
    <nav aria-label={t('label')} className="overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border-hairline">
        {USER_TABS.filter((tab) => can(tab.permission)).map((tab) => {
          const current = tab.key === active;
          return (
            <li key={tab.key}>
              <Link
                href={`/users/${userId}/${tab.key}`}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  '-mb-px flex min-h-10 items-center border-b-2 px-3 text-bo-body font-semibold outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
                  current
                    ? 'border-primary text-on-soft'
                    : 'border-transparent text-ink-2 hover:text-ink',
                )}
              >
                {t(tab.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

import { Icon } from '@/components/icon';

/** Sign-in screens: one centred card, desktop-first but usable at phone width (16 px gutters). */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('backoffice');
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center bg-bg px-4 py-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <p className="flex items-center justify-center gap-2 text-bo-section text-ink">
          <span className="flex size-9 items-center justify-center rounded-[11px] bg-primary text-text-on-primary">
            <Icon name="shield" filled size={20} />
          </span>
          {t('app.name')}
        </p>
        <div className="rounded-card bg-surface p-6 shadow-card sm:p-8">{children}</div>
      </div>
    </main>
  );
}

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Icon } from '@/components/icon';
import { buttonVariants } from '@/components/ui/button';

export default async function NotFound() {
  const t = await getTranslations('backoffice');
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center p-4">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <Icon name="search_off" size={32} className="text-ink-3" />
        <h1 className="text-bo-page-title text-ink">{t('states.pageNotFound')}</h1>
        <Link href="/dashboard" className={buttonVariants({ variant: 'secondary' })}>
          {t('states.backToDashboard')}
        </Link>
      </div>
    </main>
  );
}

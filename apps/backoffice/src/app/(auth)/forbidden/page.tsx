import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Icon } from '@/components/icon';
import { buttonVariants } from '@/components/ui/button';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.auth.forbidden');
  return { title: t('title') };
}

/** `/forbidden` (BACKOFFICE_PLAN §2.2, §4.5): "Bu bölümü görüntüleme yetkin yok." */
export default async function ForbiddenPage() {
  const t = await getTranslations('backoffice.auth.forbidden');
  return (
    <section
      className="flex flex-col items-center gap-4 text-center"
      aria-labelledby="forbidden-title"
    >
      <Icon name="lock" size={32} className="text-ink-3" />
      <h1 id="forbidden-title" className="text-bo-page-title text-ink">
        {t('title')}
      </h1>
      <p className="text-bo-body text-ink-2">{t('text')}</p>
      <Link href="/dashboard" className={buttonVariants({ variant: 'secondary' })}>
        {t('back')}
      </Link>
    </section>
  );
}

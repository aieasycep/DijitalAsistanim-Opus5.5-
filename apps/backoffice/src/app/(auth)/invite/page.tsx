import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { InviteForm } from './invite-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.auth.invite');
  return { title: t('title') };
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * `/invite?token=…` (BACKOFFICE_PLAN §3.5): renders only a [Daveti kabul et] button, so email link
 * scanners and prefetchers can never consume the invitation. The token is redeemed by the button's
 * server action; the link itself never signs anyone in.
 */
export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, t] = await Promise.all([searchParams, getTranslations('backoffice.auth.invite')]);
  const token = typeof params.token === 'string' && TOKEN.test(params.token) ? params.token : null;
  return (
    <section className="flex flex-col gap-5" aria-labelledby="invite-title">
      <div className="flex flex-col gap-1">
        <h1 id="invite-title" className="text-bo-page-title text-ink">
          {t('title')}
        </h1>
        {token === null ? null : <p className="text-bo-body text-ink-2">{t('text')}</p>}
      </div>
      {token === null ? (
        <p
          role="alert"
          className="rounded-tile bg-tone-warning-soft p-3 text-bo-body text-tone-warning-text"
        >
          {t('invalid')}
        </p>
      ) : (
        <InviteForm token={token} />
      )}
    </section>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition, type SubmitEvent } from 'react';

import { lookupUserAction } from '@/actions/users';
import { useMessage } from '@/components/admin-provider';
import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * "E-postayla bul" (§5.5): the exact address goes to `POST /users/lookup` in the body; on a match
 * the admin lands on the user's overview. The address is never written to the URL or history.
 */
export function EmailLookup() {
  const t = useTranslations('backoffice.users.lookup');
  const message = useMessage();
  const router = useRouter();
  const id = useId();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await lookupUserAction(email);
      if (result.ok) {
        setEmail('');
        router.push(`/users/${result.data.user_id}/overview`);
        return;
      }
      setError(
        result.error.code === 'NOT_FOUND'
          ? t('notFound')
          : message(result.error.messageKey, {
              ...result.error.values,
              correlationId: result.error.correlationId ?? '—',
            }),
      );
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2" aria-label={t('label')}>
      <label htmlFor={id} className="sr-only">
        {t('label')}
      </label>
      <Input
        id={id}
        type="email"
        value={email}
        autoComplete="off"
        spellCheck={false}
        placeholder={t('hint')}
        className="h-8 w-64"
        aria-invalid={error !== null}
        onChange={(event) => {
          setEmail(event.target.value);
        }}
      />
      <Button type="submit" variant="secondary" size="sm" disabled={pending} aria-busy={pending}>
        <Icon name="search" size={16} />
        {t('submit')}
      </Button>
      {error === null ? null : (
        <p role="alert" className="basis-full text-bo-meta text-tone-critical-text">
          {error}
        </p>
      )}
    </form>
  );
}

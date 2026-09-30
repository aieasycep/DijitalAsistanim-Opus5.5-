'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type SubmitEvent } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UUID_PATTERN } from '@/lib/ids';

/**
 * "Test bildirimi" (§6.8, `push.test`): takes a user id and opens that user's page with the push
 * test dialog (`?action=push-test`), where the user's devices and quiet-hours note are shown.
 */
export function PushTestLauncher() {
  const t = useTranslations('backoffice.notifications.pushTest');
  const router = useRouter();
  const id = useId();
  const [userId, setUserId] = useState('');
  const [invalid, setInvalid] = useState(false);
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = userId.trim();
    if (!UUID_PATTERN.test(value)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    router.push(`/users/${value.toLowerCase()}/overview?action=push-test`);
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {t('label')}
      </label>
      <Input
        id={id}
        value={userId}
        placeholder={t('hint')}
        aria-invalid={invalid}
        className="h-8 w-72 font-mono"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setUserId(event.target.value);
        }}
      />
      <Button type="submit" variant="secondary" size="sm">
        <Icon name="notifications" size={16} />
        {t('open')}
      </Button>
      {invalid ? (
        <span role="alert" className="basis-full text-bo-meta text-tone-critical-text">
          {t('invalid')}
        </span>
      ) : null}
    </form>
  );
}

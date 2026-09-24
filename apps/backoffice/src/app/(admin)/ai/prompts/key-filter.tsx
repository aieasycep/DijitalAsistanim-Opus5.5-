'use client';

import { useTranslations } from 'next-intl';
import { parseAsString, useQueryState } from 'nuqs';
import { useId, useState, useTransition, type SubmitEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** "Anahtar ara" (§6.11): filters the key list by name (`?q=`, never content). */
export function KeyFilter({ value }: { value: string }) {
  const t = useTranslations('backoffice.prompts');
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [pending, startTransition] = useTransition();
  const [, setQ] = useQueryState(
    'q',
    parseAsString.withOptions({ shallow: false, startTransition }),
  );
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void setQ(draft.trim() === '' ? null : draft.trim());
  }
  return (
    <form role="search" onSubmit={submit} className="flex items-center gap-2" aria-busy={pending}>
      <label htmlFor={id} className="sr-only">
        {t('searchKey')}
      </label>
      <Input
        id={id}
        type="search"
        value={draft}
        placeholder={t('searchKey')}
        className="h-8 w-56"
        onChange={(event) => {
          setDraft(event.target.value);
        }}
      />
      <Button type="submit" variant="secondary" size="sm">
        {t('search')}
      </Button>
    </form>
  );
}

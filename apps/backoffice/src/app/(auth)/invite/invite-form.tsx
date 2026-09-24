'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';

import { acceptInviteAction } from '@/actions/auth';
import { Button } from '@/components/ui/button';
import { FormStatus, INITIAL_AUTH_STATE } from '../form-status';

export function InviteForm({ token }: { token: string }) {
  const t = useTranslations('backoffice.auth.invite');
  const [state, action, pending] = useActionState(acceptInviteAction, INITIAL_AUTH_STATE);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <FormStatus state={state} id="invite-status" />
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {t('accept')}
      </Button>
    </form>
  );
}

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useId, useState } from 'react';

import { requestCodeAction, resendCodeAction, verifyCodeAction } from '@/actions/auth';
import { Button } from '@/components/ui/button';
import { FieldMessage, Input, Label } from '@/components/ui/input';
import { FormStatus, INITIAL_AUTH_STATE } from '../form-status';

/** Step 1: the work email (autocomplete, generic answer whatever the account state). */
export function EmailForm({ next }: { next: string }) {
  const t = useTranslations('backoffice.auth');
  const ids = useId();
  const [state, action, pending] = useActionState(requestCodeAction, INITIAL_AUTH_STATE);
  const statusId = `${ids}-status`;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-email`}>{t('email')}</Label>
        <Input
          id={`${ids}-email`}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          placeholder={t('emailHint')}
          aria-describedby={state.status === 'idle' ? undefined : statusId}
          aria-invalid={state.status === 'error'}
        />
      </div>
      <FormStatus state={state} id={statusId} />
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {t('sendCode')}
      </Button>
    </form>
  );
}

function useSecondsUntil(target: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return Math.max(0, Math.ceil((target - now) / 1000));
}

/** Step 2: the 6-digit email code, with "Kodu tekrar gönder" after 60 s. */
export function CodeForm({ maskedEmail, resendAt }: { maskedEmail: string; resendAt: number }) {
  const t = useTranslations('backoffice.auth');
  const ids = useId();
  const [state, action, pending] = useActionState(verifyCodeAction, INITIAL_AUTH_STATE);
  const [resendState, resend, resending] = useActionState(resendCodeAction, INITIAL_AUTH_STATE);
  const wait = useSecondsUntil(resendAt);
  const statusId = `${ids}-status`;
  const helpId = `${ids}-help`;
  return (
    <div className="flex flex-col gap-4">
      <p
        role="status"
        className="rounded-tile bg-tone-success-soft p-3 text-bo-body text-tone-success-text"
      >
        {t('codeSent')}
      </p>
      <form action={action} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-code`}>{t('code')}</Label>
          <Input
            id={`${ids}-code`}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            className="font-mono text-bo-section tracking-[0.4em]"
            aria-describedby={state.status === 'idle' ? helpId : `${statusId} ${helpId}`}
            aria-invalid={state.status === 'error'}
          />
          <FieldMessage id={helpId}>{t('codeHelp', { email: maskedEmail })}</FieldMessage>
        </div>
        <FormStatus state={state} id={statusId} />
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {t('verify')}
        </Button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <form action={resend}>
          <Button type="submit" variant="link" size="sm" disabled={wait > 0 || resending}>
            {t('resend')}
          </Button>
        </form>
        <Link href="/login" className="text-bo-body font-semibold text-text-link hover:underline">
          {t('changeEmail')}
        </Link>
      </div>
      {wait > 0 ? (
        <FieldMessage aria-live="polite">{t('resendIn', { seconds: wait })}</FieldMessage>
      ) : null}
      <FormStatus state={resendState} id={`${ids}-resend`} />
    </div>
  );
}

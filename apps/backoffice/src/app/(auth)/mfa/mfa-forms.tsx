'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useActionState, useEffect, useId, useState } from 'react';

import {
  redeemRecoveryCodeAction,
  retryRecoveryCodesAction,
  verifyMfaAction,
  type AuthFormState,
} from '@/actions/auth';
import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldMessage, Input, Label } from '@/components/ui/input';
import { FormStatus, INITIAL_AUTH_STATE } from '../form-status';

export type MfaFlowProps =
  | {
      mode: 'enroll';
      factorId: string;
      qrCode: string;
      secret: string;
      next: string;
      recovered: boolean;
    }
  | { mode: 'challenge'; factorId: string; next: string }
  | { mode: 'complete'; next: string }
  | { mode: 'unavailable'; next: string };

function CodeField({
  id,
  label,
  describedBy,
  invalid,
}: {
  id: string;
  label: string;
  describedBy?: string;
  invalid: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        className="font-mono text-bo-section tracking-[0.4em]"
        aria-describedby={describedBy}
        aria-invalid={invalid}
      />
    </div>
  );
}

function Heading({ title, text }: { title: string; text?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-bo-page-title text-ink">{title}</h1>
      {text === undefined ? null : <p className="text-bo-body text-ink-2">{text}</p>}
    </div>
  );
}

/** Shown once after enrolment or when no unused codes remain (§3.4). */
export function RecoveryCodes({ codes, next }: { codes: readonly string[]; next: string }) {
  const t = useTranslations('backoffice.auth.codes');
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const checkboxId = useId();
  const text = codes.join('\n');

  return (
    <section className="flex flex-col gap-4">
      <Heading title={t('title')} text={t('text')} />
      <ol
        aria-label={t('listLabel')}
        className="grid grid-cols-2 gap-2 rounded-tile bg-surface-sunken p-4 font-mono text-bo-mono text-ink"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
            });
          }}
        >
          <Icon name={copied ? 'check' : 'content_copy'} size={16} />
          {t('copy')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([`${text}\n`], { type: 'text/plain' }));
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = 'dijital-asistan-kurtarma-kodlari.txt';
            anchor.click();
            URL.revokeObjectURL(url);
          }}
        >
          <Icon name="download" size={16} />
          {t('download')}
        </Button>
      </div>
      {copied ? (
        <p role="status" className="text-bo-meta text-tone-success-text">
          {t('copied')}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Checkbox
          id={checkboxId}
          checked={saved}
          onCheckedChange={(value) => {
            setSaved(value === true);
          }}
        />
        <Label htmlFor={checkboxId} className="font-normal">
          {t('saved')}
        </Label>
      </div>
      <Button
        disabled={!saved}
        onClick={() => {
          router.push(next);
        }}
      >
        {t('continue')}
      </Button>
    </section>
  );
}

function RecoveryRedeem({ next, onBack }: { next: string; onBack: () => void }) {
  const t = useTranslations('backoffice.auth');
  const ids = useId();
  const [state, redeem, redeeming] = useActionState(redeemRecoveryCodeAction, INITIAL_AUTH_STATE);
  return (
    <form action={redeem} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Heading title={t('recovery.title')} text={t('recovery.help')} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-recovery`}>{t('recovery.label')}</Label>
        <Input
          id={`${ids}-recovery`}
          name="code"
          autoComplete="off"
          spellCheck={false}
          required
          className="font-mono uppercase"
          aria-describedby={state.status === 'idle' ? undefined : `${ids}-status`}
          aria-invalid={state.status === 'error'}
        />
      </div>
      <FormStatus state={state} id={`${ids}-status`} />
      <Button type="submit" disabled={redeeming} aria-busy={redeeming}>
        {t('recovery.submit')}
      </Button>
      <Button variant="link" size="sm" onClick={onBack}>
        {t('recovery.back')}
      </Button>
    </form>
  );
}

function CodesRetry({ state, next }: { state: AuthFormState; next: string }) {
  const t = useTranslations('backoffice.auth.codes');
  const [retryState, retry, retrying] = useActionState(
    retryRecoveryCodesAction,
    INITIAL_AUTH_STATE,
  );
  if (retryState.status === 'codes')
    return <RecoveryCodes codes={retryState.codes} next={retryState.next} />;
  return (
    <form action={retry} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <FormStatus state={retryState.status === 'idle' ? state : retryState} id="codes-status" />
      <Button type="submit" disabled={retrying} aria-busy={retrying}>
        {t('retry')}
      </Button>
    </form>
  );
}

/**
 * The whole `/mfa` step as one component (enrol, challenge, recovery, recovery codes), so the
 * action state survives the server re-render that follows the aal2 session change.
 */
export function MfaFlow(props: MfaFlowProps) {
  const t = useTranslations('backoffice.auth');
  const router = useRouter();
  const ids = useId();
  const [recovery, setRecovery] = useState(false);
  const [state, action, pending] = useActionState(verifyMfaAction, INITIAL_AUTH_STATE);
  const complete = props.mode === 'complete' && state.status !== 'codes';

  useEffect(() => {
    if (complete) router.replace(props.next);
  }, [complete, props.next, router]);

  if (state.status === 'codes') return <RecoveryCodes codes={state.codes} next={state.next} />;
  if (state.status === 'error' && state.messageKey === 'auth.codes.failed') {
    return <CodesRetry state={state} next={props.next} />;
  }
  if (props.mode === 'unavailable') {
    return (
      <p role="alert" className="text-bo-body text-tone-critical-text">
        {t('unavailable')}
      </p>
    );
  }
  if (props.mode === 'complete') {
    return <Heading title={t('mfaTitle')} />;
  }
  if (props.mode === 'challenge' && recovery) {
    return (
      <RecoveryRedeem
        next={props.next}
        onBack={() => {
          setRecovery(false);
        }}
      />
    );
  }

  const statusId = `${ids}-status`;
  return (
    <section className="flex flex-col gap-5">
      {props.mode === 'enroll' ? (
        <Heading title={t('mfaEnrollTitle')} text={t('mfaEnrollHint')} />
      ) : (
        <Heading title={t('mfaTitle')} text={t('mfaHelp')} />
      )}
      {props.mode === 'enroll' && props.recovered ? (
        <p
          role="status"
          className="rounded-tile bg-tone-info-soft p-3 text-bo-body text-tone-info-text"
        >
          {t('recovery.used')}
        </p>
      ) : null}
      <form action={action} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="factorId" value={props.factorId} />
        <input type="hidden" name="mode" value={props.mode} />
        <input type="hidden" name="next" value={props.next} />
        {props.mode === 'enroll' ? (
          <>
            <div className="flex flex-col items-center gap-2 rounded-tile bg-control-knob p-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- Supabase returns the QR as an inline SVG data URI */}
              <img src={props.qrCode} alt={t('mfaQrAlt')} width={180} height={180} />
            </div>
            <FieldMessage className="break-all">
              {t('mfaManual', { secret: props.secret })}
            </FieldMessage>
          </>
        ) : null}
        <CodeField
          id={`${ids}-code`}
          label={t('mfaCode')}
          describedBy={state.status === 'error' ? statusId : undefined}
          invalid={state.status === 'error'}
        />
        <FormStatus state={state} id={statusId} />
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {t('verify')}
        </Button>
        {props.mode === 'challenge' ? (
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              setRecovery(true);
            }}
          >
            {t('mfaLost')}
          </Button>
        ) : null}
      </form>
    </section>
  );
}

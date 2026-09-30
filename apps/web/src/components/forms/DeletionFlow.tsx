'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactNode, type SubmitEvent } from 'react';
import { ACCOUNT_DELETION_SUMMARY_ROWS } from '@/content/deletion-scope.ts';
import { Link } from '@/i18n/navigation.ts';
import { maskEmail } from '@/lib/mask-email.ts';
import { callPublicApi } from '@/lib/public-api/client.ts';
import {
  DELETION_CONFIRMATION_WORD,
  DeletionStartAcceptedSchema,
  DeletionStatusSchema,
  DeletionVerifyAcceptedSchema,
  Email,
  type DeletionVerifyAccepted,
} from '@/lib/public-api/schemas.ts';
import { EXTERNAL_LINKS } from '@/lib/site.ts';
import { sendWebEvent } from '@/lib/web-events/send.ts';
import type { WebEventProps } from '@/lib/web-events/schema.ts';
import { IconCheckCircle, IconError, IconLock, IconWifiOff } from '../icons/generated/index.ts';
import { BotCheck } from './BotCheck.tsx';
import { useHydrated } from './useHydrated.ts';
import { useOnline } from './useOnline.ts';

type Step = 'email' | 'sending' | 'code' | 'submitting' | 'locked' | 'done';
type FlowError =
  | {
      readonly key:
        | 'emailInvalid'
        | 'startNetwork'
        | 'otpInvalid'
        | 'verifyNetwork'
        | 'serviceUnavailable'
        | 'codeFormat';
    }
  | { readonly key: 'rateLimited'; readonly minutes: number };

const RESEND_SECONDS = 60;

function confirmationMatches(locale: string, typed: string): boolean {
  const value = typed.trim();
  if (locale === 'tr') {
    const upper = value.toLocaleUpperCase('tr-TR');
    return upper === 'SİL' || upper === 'SIL';
  }
  return value.toUpperCase() === 'DELETE';
}

/**
 * W-CMP-18 · web account deletion (W-DEL-01 §6.2): email → 6-digit code sent server-side
 * (PUB-02, identical answer for every address) → consequences + typed confirmation → PUB-03 →
 * honest "received" state with the reference. The email and code live only in React state; no
 * cookie, storage or auth session is created, and nothing claims "deleted" before the job ends.
 */
export function DeletionFlow({
  turnstileSiteKey,
  nonce,
}: {
  turnstileSiteKey: string | undefined;
  nonce: string | undefined;
}): ReactNode {
  const t = useTranslations('webPages.deletion');
  const statuses = useTranslations('web.deletion.statuses');
  const common = useTranslations('webPages.common');
  const locale = useLocale();
  const online = useOnline();
  const hydrated = useHydrated();
  const base = useId();
  const word = locale === 'tr' ? DELETION_CONFIRMATION_WORD.tr : DELETION_CONFIRMATION_WORD.en;

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<FlowError | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [receipt, setReceipt] = useState<(DeletionVerifyAccepted & { masked: string }) | null>(
    null,
  );
  const [status, setStatus] = useState<
    { kind: 'idle' | 'checking' | 'unavailable' } | { kind: 'shown'; label: string }
  >({
    kind: 'idle',
  });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [announce, setAnnounce] = useState('');
  const canDelete = /^\d{6}$/.test(code) && confirmationMatches(locale, confirmation);

  const track = (stepName: WebEventProps<'web_deletion_step'>['step']): void => {
    sendWebEvent('web_deletion_step', { page: 'data_deletion', locale }, { step: stepName });
  };

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = window.setTimeout(() => {
      setResendIn((s) => s - 1);
    }, 1000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [resendIn]);

  // Each step change moves focus to the new step's heading once it is rendered.
  const [focusRequest, setFocusRequest] = useState(0);
  useEffect(() => {
    if (focusRequest > 0) headingRef.current?.focus();
  }, [focusRequest]);

  const moveTo = (next: Step, message: string): void => {
    setStep(next);
    setAnnounce(message);
    setFocusRequest((n) => n + 1);
  };

  const sendCode = async (): Promise<void> => {
    const trimmed = email.trim();
    if (!Email.safeParse(trimmed).success) {
      setError({ key: 'emailInvalid' });
      return;
    }
    setError(null);
    setStep('sending');
    track('email_submitted');
    const result = await callPublicApi('/data-deletion/start', DeletionStartAcceptedSchema, {
      body: {
        email: trimmed,
        locale,
        website: '',
        ...(captchaToken === null ? {} : { captcha_token: captchaToken }),
      },
    });
    if (result.ok) {
      track('code_sent');
      setResendIn(RESEND_SECONDS);
      moveTo('code', t('flow.codeInfo'));
      return;
    }
    setStep((current) => (current === 'sending' ? 'email' : current));
    setCaptchaReset((n) => n + 1);
    if (result.kind === 'http' && result.status === 422) {
      setError({ key: 'emailInvalid' });
    } else if (result.kind === 'http' && result.status === 429) {
      track('rate_limited');
      setError({
        key: 'rateLimited',
        minutes: Math.max(1, Math.ceil((result.retryAfterSeconds ?? 3600) / 60)),
      });
    } else if (result.kind === 'network') {
      track('error');
      setError({ key: 'startNetwork' });
    } else {
      track('error');
      setError({ key: 'serviceUnavailable' });
    }
  };

  const onEmailSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (step !== 'email' || !online) return;
    void sendCode();
  };

  const onResend = (): void => {
    if (resendIn > 0 || !online) return;
    setCode('');
    setStep('email');
    void sendCode();
  };

  const verify = async (): Promise<void> => {
    if (!/^\d{6}$/.test(code)) {
      setError({ key: 'codeFormat' });
      return;
    }
    setError(null);
    setStep('submitting');
    track('request_submitted');
    const trimmed = email.trim();
    const result = await callPublicApi('/data-deletion/verify', DeletionVerifyAcceptedSchema, {
      body: { email: trimmed, code, kind: 'account', confirmation: word, locale },
    });
    if (result.ok) {
      track('request_created');
      setReceipt({ ...result.data, masked: maskEmail(trimmed) });
      setEmail('');
      setCode('');
      setConfirmation('');
      moveTo('done', t('flow.doneTitle'));
      return;
    }
    if (result.kind === 'http' && result.code === 'OTP_LOCKED') {
      track('otp_locked');
      setEmail('');
      setCode('');
      moveTo('locked', t('flow.lockedTitle'));
      return;
    }
    setStep('code');
    if (result.kind === 'http' && result.code === 'OTP_INVALID') {
      track('otp_invalid');
      setError({ key: 'otpInvalid' });
    } else if (result.kind === 'http' && result.status === 429) {
      track('rate_limited');
      setError({
        key: 'rateLimited',
        minutes: Math.max(1, Math.ceil((result.retryAfterSeconds ?? 3600) / 60)),
      });
    } else if (result.kind === 'network') {
      track('error');
      setError({ key: 'verifyNetwork' });
    } else {
      track('error');
      setError({ key: 'serviceUnavailable' });
    }
  };

  const onCodeSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (step !== 'code' || !online || !canDelete) return;
    void verify();
  };

  const backToEmail = (): void => {
    setEmail('');
    setCode('');
    setConfirmation('');
    setError(null);
    setResendIn(0);
    moveTo('email', t('flow.emailLabel'));
  };

  const checkStatus = async (): Promise<void> => {
    if (receipt === null) return;
    setStatus({ kind: 'checking' });
    const result = await callPublicApi(
      `/data-deletion/${encodeURIComponent(receipt.request_id)}/status?token=${encodeURIComponent(receipt.status_token)}`,
      DeletionStatusSchema,
    );
    if (result.ok) {
      setStatus({ kind: 'shown', label: statuses(result.data.status) });
    } else {
      setStatus({ kind: 'unavailable' });
    }
  };

  const errorText =
    error === null
      ? null
      : error.key === 'rateLimited'
        ? t('flow.errors.rateLimited', { minutes: error.minutes })
        : t(`flow.errors.${error.key}`);
  const errorId = `${base}-error`;
  const busy = step === 'sending' || step === 'submitting';

  const errorBox =
    errorText === null ? null : (
      <p
        id={errorId}
        role="alert"
        className="mt-4 flex items-start gap-2 rounded-card-sm bg-tone-critical-soft px-3 py-2 text-secondary text-tone-critical-text-strong"
      >
        <IconError size={18} className="mt-0.5 shrink-0" />
        {errorText}
      </p>
    );

  const inputClass =
    'mt-2 block w-full rounded-input border border-border-control bg-surface px-4 py-3 text-body text-ink';
  const primaryButton =
    'inline-flex min-h-12 items-center justify-center rounded-button bg-primary px-6 text-label-lg text-text-on-primary hover:bg-brand-primary-pressed disabled:opacity-(--da-opacity-disabled)';
  const linkButton =
    'inline-flex min-h-11 items-center text-label text-text-link underline underline-offset-4 disabled:text-ink-3 disabled:no-underline';

  return (
    <div
      className="mx-auto max-w-[560px] rounded-card bg-surface p-6 shadow-card md:p-8"
      data-step={step}
    >
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      {online ? null : (
        <p
          role="status"
          className="mb-5 flex items-center gap-2 rounded-card-sm bg-tone-warning-soft px-3 py-2 text-secondary text-tone-warning-text"
        >
          <IconWifiOff size={18} />
          {common('offline')}
        </p>
      )}

      {step === 'email' || step === 'sending' ? (
        <form method="post" noValidate onSubmit={onEmailSubmit}>
          <h3 ref={headingRef} tabIndex={-1} className="sr-only">
            {t('flow.emailLabel')}
          </h3>
          <label htmlFor={`${base}-email`} className="text-label text-ink">
            {t('flow.emailLabel')}
          </label>
          <p id={`${base}-email-help`} className="mt-1 text-secondary text-ink-2">
            {t('flow.emailHelp')}
          </p>
          <input
            id={`${base}-email`}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            disabled={busy}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            aria-invalid={error?.key === 'emailInvalid' ? true : undefined}
            aria-describedby={
              errorText === null ? `${base}-email-help` : `${base}-email-help ${errorId}`
            }
            className={inputClass}
          />
          {errorBox}
          {turnstileSiteKey === undefined ? null : (
            <div className="mt-4">
              <BotCheck
                siteKey={turnstileSiteKey}
                locale={locale}
                nonce={nonce}
                resetSignal={captchaReset}
                onToken={setCaptchaToken}
              />
            </div>
          )}
          <button
            type="submit"
            disabled={!hydrated || busy || !online}
            className={`${primaryButton} mt-6`}
          >
            {step === 'sending' ? t('flow.sending') : t('flow.sendCode')}
          </button>
        </form>
      ) : null}

      {step === 'code' || step === 'submitting' ? (
        <form method="post" noValidate onSubmit={onCodeSubmit}>
          <p className="rounded-card-sm bg-tone-info-soft px-3 py-2 text-secondary text-tone-info-text">
            {t('flow.codeInfo')}
          </p>
          <label htmlFor={`${base}-code`} className="mt-5 block text-label text-ink">
            {t('flow.codeLabel')}
          </label>
          <input
            id={`${base}-code`}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            disabled={busy}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, '').slice(0, 6));
            }}
            aria-invalid={
              error?.key === 'otpInvalid' || error?.key === 'codeFormat' ? true : undefined
            }
            aria-describedby={errorText === null ? undefined : errorId}
            className={`${inputClass} tabular tracking-[0.3em]`}
          />

          <h3
            ref={headingRef}
            tabIndex={-1}
            className="mt-6 text-title-md text-tone-critical-text focus-visible:outline-none"
          >
            {t('flow.consequencesTitle')}
          </h3>
          <ul className="mt-3 list-disc pl-5 text-secondary text-ink-2">
            {ACCOUNT_DELETION_SUMMARY_ROWS.map((row) => (
              <li key={row}>{t(`scope.rows.${row}`)}</li>
            ))}
          </ul>
          <ul className="mt-4 flex flex-col gap-2 text-secondary text-ink">
            <li>
              {t('flow.subscriptionReminder')}{' '}
              <a
                href={EXTERNAL_LINKS.appStoreSubscriptions}
                className="text-text-link underline underline-offset-2"
              >
                {t('also.appStore')}
              </a>{' '}
              ·{' '}
              <a
                href={EXTERNAL_LINKS.playSubscriptions}
                className="text-text-link underline underline-offset-2"
              >
                {t('also.play')}
              </a>
            </li>
            <li>
              {t('flow.microsoftReminder')}{' '}
              <a
                href={EXTERNAL_LINKS.microsoftPersonalConsent}
                className="text-text-link underline underline-offset-2"
              >
                {t('also.microsoftPersonal')}
              </a>{' '}
              ·{' '}
              <a
                href={EXTERNAL_LINKS.microsoftWorkApps}
                className="text-text-link underline underline-offset-2"
              >
                {t('also.microsoftWork')}
              </a>
            </li>
          </ul>

          <label htmlFor={`${base}-confirm`} className="mt-6 block text-label text-ink">
            {t('flow.confirmLabel', { word })}
          </label>
          <input
            id={`${base}-confirm`}
            name="confirmation"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={confirmation}
            disabled={busy}
            onChange={(event) => {
              setConfirmation(event.target.value);
            }}
            className={inputClass}
          />
          {errorBox}
          <button
            type="submit"
            disabled={!hydrated || !canDelete || busy || !online}
            className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-button bg-button-destructive-bg px-6 text-label-lg text-button-destructive-text hover:bg-button-destructive-pressed disabled:opacity-(--da-opacity-disabled) md:w-auto"
          >
            {step === 'submitting' ? t('flow.submitting') : t('flow.submit')}
          </button>
          <div className="mt-5 flex flex-col items-start gap-1">
            <button
              type="button"
              onClick={onResend}
              disabled={resendIn > 0 || busy || !online}
              className={linkButton}
            >
              {t('flow.resend')}
            </button>
            {resendIn > 0 ? (
              <p className="tabular text-meta text-ink-3" aria-live="off">
                {t('flow.resendIn', { seconds: resendIn })}
              </p>
            ) : null}
            <button type="button" onClick={backToEmail} disabled={busy} className={linkButton}>
              {t('flow.changeEmail')}
            </button>
            <button type="button" onClick={backToEmail} disabled={busy} className={linkButton}>
              {t('flow.cancel')}
            </button>
          </div>
        </form>
      ) : null}

      {step === 'locked' ? (
        <div>
          <h3
            ref={headingRef}
            tabIndex={-1}
            className="flex items-center gap-2 text-title-md focus-visible:outline-none"
          >
            <IconLock size={22} className="text-tone-warning-icon" />
            {t('flow.lockedTitle')}
          </h3>
          <p className="mt-3 text-body text-ink-2">{t('flow.lockedBody')}</p>
          <p className="mt-5 flex flex-col gap-1">
            <a href="#uygulamadan" className={linkButton}>
              {t('flow.lockedInApp')}
            </a>
            <Link
              href={{ pathname: '/support', query: { category: 'privacy' }, hash: 'contact' }}
              className={linkButton}
            >
              {t('flow.lockedSupport')}
            </Link>
          </p>
        </div>
      ) : null}

      {step === 'done' && receipt !== null ? (
        <div>
          <h3
            ref={headingRef}
            tabIndex={-1}
            className="flex items-center gap-2 text-title-md focus-visible:outline-none"
          >
            <IconCheckCircle filled size={24} className="text-tone-success-icon" />
            {t('flow.doneTitle')}
          </h3>
          <p className="tabular mt-3 text-label-lg" data-testid="deletion-reference">
            {t('flow.reference', { reference: receipt.reference })}
          </p>
          <p className="mt-3 text-body text-ink-2">
            {t('flow.doneBody', { email: receipt.masked })}
          </p>
          {receipt.subscription_notice.active ? (
            <div
              role="note"
              className="mt-5 rounded-card-sm bg-tone-warning-soft px-4 py-3 text-secondary text-tone-warning-text"
              data-testid="subscription-warning"
            >
              <p>{t('flow.subscriptionActive')}</p>
              <p className="mt-2 flex flex-wrap gap-x-3">
                <a
                  href={EXTERNAL_LINKS.appStoreSubscriptions}
                  className="underline underline-offset-2"
                >
                  {t('also.appStore')}
                </a>
                <a href={EXTERNAL_LINKS.playSubscriptions} className="underline underline-offset-2">
                  {t('also.play')}
                </a>
              </p>
            </div>
          ) : null}
          <div className="mt-5" aria-live="polite">
            <button
              type="button"
              onClick={() => {
                void checkStatus();
              }}
              disabled={status.kind === 'checking' || !online}
              className="inline-flex min-h-11 items-center rounded-button border border-border-strong px-4 text-label hover:bg-surface-pressed disabled:opacity-(--da-opacity-disabled)"
            >
              {status.kind === 'checking' ? t('flow.statusChecking') : t('flow.statusCheck')}
            </button>
            {status.kind === 'shown' ? (
              <p className="mt-2 text-secondary text-ink">
                {t('flow.statusLine', { status: status.label })}
              </p>
            ) : null}
            {status.kind === 'unavailable' ? (
              <p className="mt-2 text-secondary text-ink-2">{t('flow.statusUnavailable')}</p>
            ) : null}
          </div>
          <p className="mt-5 text-secondary text-ink-2">{t('flow.leave')}</p>
        </div>
      ) : null}
    </div>
  );
}

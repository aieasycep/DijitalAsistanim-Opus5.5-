'use client';

import { TICKET_CATEGORY_VALUES, type TicketCategory } from '@da/domain/enums';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type ReactNode, type SubmitEvent } from 'react';
import { Link } from '@/i18n/navigation.ts';
import { maskEmail } from '@/lib/mask-email.ts';
import { callPublicApi } from '@/lib/public-api/client.ts';
import {
  SupportAcceptedSchema,
  SupportBodySchema,
  type SupportBody,
} from '@/lib/public-api/schemas.ts';
import { sendWebEvent } from '@/lib/web-events/send.ts';
import { IconCheckCircle, IconError, IconWifiOff } from '../icons/generated/index.ts';
import { BotCheck } from './BotCheck.tsx';
import { useHydrated } from './useHydrated.ts';
import { useOnline } from './useOnline.ts';

type Field = 'email' | 'name' | 'category' | 'message';
type FieldErrorKey =
  'emailRequired' | 'emailInvalid' | 'topicRequired' | 'messageMin' | 'messageMax' | 'nameMax';
type FormError = 'captchaFailed' | 'rateLimited' | 'network' | 'serverError';

const FIELDS: readonly Field[] = ['email', 'name', 'category', 'message'];
const MESSAGE_MAX = 5000;

function isCategory(value: string): value is TicketCategory {
  return (TICKET_CATEGORY_VALUES as readonly string[]).includes(value);
}

/**
 * W-CMP-17 · contact form → `public-api` `POST /support` (PUB-01). Client-side validation uses
 * the same strict schema as the server; the server's `field_errors` map to the same inline copy.
 * A success panel appears only after the server's 202. Values are kept on every error, and a
 * network failure offers a retry of the same payload (the server de-duplicates it).
 */
export function SupportForm({
  initialCategory,
  turnstileSiteKey,
  nonce,
}: {
  initialCategory: TicketCategory | null;
  turnstileSiteKey: string | undefined;
  nonce: string | undefined;
}): ReactNode {
  const t = useTranslations('webPages.support.form');
  const shared = useTranslations('web.support.form');
  const common = useTranslations('webPages.common');
  const locale = useLocale();
  const online = useOnline();
  const hydrated = useHydrated();
  const base = useId();
  const id = (field: string): string => `${base}-${field}`;

  const [values, setValues] = useState({
    email: '',
    name: '',
    category: initialCategory ?? '',
    message: '',
    website: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, FieldErrorKey>>>({});
  const [formError, setFormError] = useState<FormError | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<{ reference: string; masked: string } | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const lastPayload = useRef<SupportBody | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  const messageLength = values.message.trim().length;

  // The success panel replaces the form; move focus to its heading once it is rendered.
  useEffect(() => {
    if (done !== null) successRef.current?.focus();
  }, [done]);

  const validate = (): Partial<Record<Field, FieldErrorKey>> => {
    const errors: Partial<Record<Field, FieldErrorKey>> = {};
    const email = values.email.trim();
    if (email === '') errors.email = 'emailRequired';
    else if (!SupportBodySchema.shape.email.safeParse(email).success) errors.email = 'emailInvalid';
    if (values.name.trim().length > 120) errors.name = 'nameMax';
    if (!isCategory(values.category)) errors.category = 'topicRequired';
    if (messageLength < 10) errors.message = 'messageMin';
    else if (messageLength > MESSAGE_MAX) errors.message = 'messageMax';
    return errors;
  };

  const focusSummary = (): void => {
    window.setTimeout(() => summaryRef.current?.focus(), 0);
  };

  const submit = async (payload: SupportBody): Promise<void> => {
    setPending(true);
    setFormError(null);
    const result = await callPublicApi('/support', SupportAcceptedSchema, { body: payload });
    setPending(false);
    if (result.ok) {
      sendWebEvent(
        'web_support_submit',
        { page: 'support', locale },
        { category: payload.category, result: 'ok' },
      );
      setDone({ reference: result.data.reference, masked: maskEmail(payload.email) });
      return;
    }
    if (result.kind === 'network') {
      sendWebEvent(
        'web_support_submit',
        { page: 'support', locale },
        { category: payload.category, result: 'error' },
      );
      setFormError('network');
      focusSummary();
      return;
    }
    if (result.kind === 'http' && result.code === 'VALIDATION_FAILED') {
      const mapped: Partial<Record<Field, FieldErrorKey>> = {};
      let captcha = false;
      for (const error of result.fieldErrors) {
        const path = error.path.split('.')[0];
        if (path === 'email') mapped.email = 'emailInvalid';
        else if (path === 'name') mapped.name = 'nameMax';
        else if (path === 'category') mapped.category = 'topicRequired';
        else if (path === 'message')
          mapped.message = error.code === 'too_big' ? 'messageMax' : 'messageMin';
        else if (path === 'captcha_token') captcha = true;
      }
      sendWebEvent(
        'web_support_submit',
        { page: 'support', locale },
        { category: payload.category, result: 'invalid' },
      );
      setFieldErrors(mapped);
      if (captcha) {
        setFormError('captchaFailed');
        setCaptchaReset((n) => n + 1);
      }
      focusSummary();
      return;
    }
    if (result.kind === 'http' && result.status === 429) {
      sendWebEvent(
        'web_support_submit',
        { page: 'support', locale },
        { category: payload.category, result: 'rate_limited' },
      );
      setFormError('rateLimited');
      focusSummary();
      return;
    }
    sendWebEvent(
      'web_support_submit',
      { page: 'support', locale },
      { category: payload.category, result: 'error' },
    );
    setFormError('serverError');
    focusSummary();
  };

  const onSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (pending) return;
    const errors = validate();
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0 || !isCategory(values.category)) {
      focusSummary();
      return;
    }
    const name = values.name.trim();
    const payload: SupportBody = {
      email: values.email.trim(),
      category: values.category,
      message: values.message.trim(),
      locale,
      website: values.website,
      ...(name === '' ? {} : { name }),
      ...(captchaToken === null ? {} : { captcha_token: captchaToken }),
    };
    lastPayload.current = payload;
    void submit(payload);
  };

  const reset = (): void => {
    setValues({ email: '', name: '', category: '', message: '', website: '' });
    setFieldErrors({});
    setFormError(null);
    setDone(null);
    setCaptchaReset((n) => n + 1);
  };

  if (done !== null) {
    return (
      <div aria-live="polite" className="rounded-card bg-surface p-6 shadow-card md:p-8">
        <h3
          ref={successRef}
          tabIndex={-1}
          className="flex items-center gap-2 text-title-md focus-visible:outline-none"
        >
          <IconCheckCircle filled size={24} className="text-tone-success-icon" />
          {shared('successTitle')}
        </h3>
        <p className="mt-3 text-body text-ink-2" data-testid="support-success">
          {shared('successBody', { reference: done.reference, maskedEmail: done.masked })}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex min-h-11 items-center rounded-button border border-border-strong px-4 text-label hover:bg-surface-pressed"
        >
          {shared('another')}
        </button>
      </div>
    );
  }

  const errorEntries = FIELDS.flatMap((field) => {
    const key = fieldErrors[field];
    return key === undefined ? [] : [{ field, key }];
  });
  const hasErrors = errorEntries.length > 0 || formError !== null;
  const inputClass = (field: Field): string =>
    `mt-2 block w-full rounded-input border bg-surface px-4 py-3 text-body text-ink ${
      fieldErrors[field] === undefined ? 'border-border-control' : 'border-border-error'
    }`;
  const describedBy = (field: Field, help?: string): string | undefined => {
    const ids = [help, fieldErrors[field] === undefined ? undefined : id(`${field}-error`)].filter(
      (value): value is string => value !== undefined,
    );
    return ids.length === 0 ? undefined : ids.join(' ');
  };
  const errorText = (field: Field): ReactNode => {
    const key = fieldErrors[field];
    return key === undefined ? null : (
      <p
        id={id(`${field}-error`)}
        className="mt-2 flex items-center gap-1.5 text-secondary text-tone-critical-text"
      >
        <IconError size={16} />
        {t(`errors.${key}`)}
      </p>
    );
  };

  return (
    <form
      method="post"
      noValidate
      onSubmit={onSubmit}
      className="rounded-card bg-surface p-6 shadow-card md:p-8"
      aria-busy={pending}
    >
      {online ? null : (
        <p
          role="status"
          className="mb-5 flex items-center gap-2 rounded-card-sm bg-tone-warning-soft px-3 py-2 text-secondary text-tone-warning-text"
        >
          <IconWifiOff size={18} />
          {common('offline')}
        </p>
      )}
      <div
        ref={summaryRef}
        tabIndex={-1}
        role={hasErrors ? 'alert' : undefined}
        className="focus-visible:outline-none"
      >
        {hasErrors ? (
          <div className="mb-6 rounded-card-sm border border-border-error bg-tone-critical-soft px-4 py-3 text-secondary text-tone-critical-text-strong">
            {errorEntries.length > 0 ? (
              <>
                <p className="text-label">{t('errorSummary')}</p>
                <ul className="mt-2 list-disc pl-5">
                  {errorEntries.map(({ field, key }) => (
                    <li key={field}>
                      <a href={`#${id(field)}`} className="underline underline-offset-2">
                        {t(`errors.${key}`)}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {formError === null ? null : (
              <p className={errorEntries.length > 0 ? 'mt-2' : undefined}>
                {formError === 'captchaFailed'
                  ? shared('captchaFailed')
                  : formError === 'serverError'
                    ? shared('serverError')
                    : t(`errors.${formError}`)}
              </p>
            )}
            {formError === 'network' ? (
              <button
                type="button"
                onClick={() => {
                  if (lastPayload.current !== null) void submit(lastPayload.current);
                }}
                className="mt-3 inline-flex min-h-11 items-center rounded-button bg-surface px-4 text-label text-ink"
              >
                {t('retry')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div>
          <label htmlFor={id('email')} className="text-label text-ink">
            {shared('email')}
          </label>
          <p id={id('email-help')} className="mt-1 text-secondary text-ink-2">
            {shared('emailHelp')}
          </p>
          <input
            id={id('email')}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={values.email}
            onChange={(event) => {
              setValues({ ...values, email: event.target.value });
            }}
            aria-invalid={fieldErrors.email === undefined ? undefined : true}
            aria-describedby={describedBy('email', id('email-help'))}
            className={inputClass('email')}
          />
          {errorText('email')}
        </div>
        <div>
          <label htmlFor={id('name')} className="text-label text-ink">
            {shared('name')}
          </label>
          <input
            id={id('name')}
            name="name"
            type="text"
            autoComplete="name"
            value={values.name}
            onChange={(event) => {
              setValues({ ...values, name: event.target.value });
            }}
            aria-invalid={fieldErrors.name === undefined ? undefined : true}
            aria-describedby={describedBy('name')}
            className={`${inputClass('name')} xl:mt-[calc(0.5rem+1.25rem+0.25rem)]`}
          />
          {errorText('name')}
        </div>
      </div>

      <div className="mt-5">
        <label htmlFor={id('category')} className="text-label text-ink">
          {shared('topic')}
        </label>
        <select
          id={id('category')}
          name="category"
          value={values.category}
          onChange={(event) => {
            setValues({ ...values, category: event.target.value });
          }}
          aria-invalid={fieldErrors.category === undefined ? undefined : true}
          aria-describedby={describedBy('category')}
          className={inputClass('category')}
        >
          <option value="">{t('topicChoose')}</option>
          {TICKET_CATEGORY_VALUES.map((category) => (
            <option key={category} value={category}>
              {t(`topics.${category}`)}
            </option>
          ))}
        </select>
        {errorText('category')}
        {values.category === 'privacy' ? (
          <p
            className="mt-3 rounded-card-sm bg-tone-info-soft px-3 py-2 text-secondary text-tone-info-text"
            data-testid="privacy-hint"
          >
            {shared.rich('privacyHint', {
              deletion: (chunks) => (
                <Link href="/data-deletion" className="underline underline-offset-2">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        ) : null}
      </div>

      <div className="mt-5">
        <label htmlFor={id('message')} className="text-label text-ink">
          {shared('message')}
        </label>
        <p id={id('message-help')} className="mt-1 text-secondary text-ink-2">
          {shared('messageHelp')}
        </p>
        <textarea
          id={id('message')}
          name="message"
          rows={7}
          value={values.message}
          onChange={(event) => {
            setValues({ ...values, message: event.target.value });
          }}
          aria-invalid={fieldErrors.message === undefined ? undefined : true}
          aria-describedby={describedBy('message', `${id('message-help')} ${id('message-count')}`)}
          className={inputClass('message')}
        />
        <p
          id={id('message-count')}
          aria-live="off"
          className="tabular mt-1 text-right text-meta text-ink-3"
        >
          {t('counter', { count: messageLength })}
        </p>
        <p aria-live="polite" className="sr-only">
          {messageLength > MESSAGE_MAX ? t('counterOver') : ''}
        </p>
        {errorText('message')}
      </div>

      {/* Honeypot (PUB-01 `website`): hidden from people and assistive tech; bots fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={id('website')}>{t('honeypot')}</label>
        <input
          id={id('website')}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={values.website}
          onChange={(event) => {
            setValues({ ...values, website: event.target.value });
          }}
        />
      </div>

      {turnstileSiteKey === undefined ? null : (
        <div className="mt-5">
          <BotCheck
            siteKey={turnstileSiteKey}
            locale={locale}
            nonce={nonce}
            resetSignal={captchaReset}
            onToken={setCaptchaToken}
          />
        </div>
      )}

      <p className="mt-5 text-secondary text-ink-2">
        {shared.rich('notice', {
          privacy: (chunks) => (
            <Link href="/privacy" className="text-text-link underline underline-offset-4">
              {chunks}
            </Link>
          ),
        })}
      </p>

      <button
        type="submit"
        disabled={!hydrated || pending || !online}
        className="mt-6 inline-flex min-h-12 items-center justify-center rounded-button bg-primary px-6 text-label-lg text-text-on-primary hover:bg-brand-primary-pressed disabled:opacity-(--da-opacity-disabled)"
      >
        {pending ? shared('submitting') : shared('submit')}
      </button>
    </form>
  );
}

import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { isLoginReason, type LoginReason } from '@/lib/error-copy';
import { maskEmail } from '@/lib/mask';
import { RESEND_COOLDOWN_S, readLoginStep } from '@/server/auth-flow';
import { safeNextPath } from '@/server/request-meta';
import { CodeForm, EmailForm } from './login-forms';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.auth');
  return { title: t('title') };
}

const REASON_KEYS = {
  idle: 'idle',
  expired: 'expired',
  revoked: 'revoked',
  logged_out: 'loggedOut',
  not_admin: 'notAdmin',
  mfa_failed: 'mfaFailed',
} as const satisfies Record<LoginReason, string>;

/**
 * `/login` (BACKOFFICE_PLAN §3.2, §6.0): step `email` → 6-digit code sent (generic copy) → step
 * `code`. The email lives in the sealed login-step cookie, never in the URL. `?reason=` shows why a
 * session ended (idle, 12 h cap, revoked, signed out, not an admin).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, t] = await Promise.all([searchParams, getTranslations('backoffice.auth')]);
  const reason = isLoginReason(params.reason) ? params.reason : null;
  const next = safeNextPath(typeof params.next === 'string' ? params.next : null);
  const codeStep = params.step === 'code';
  const step = codeStep ? await readLoginStep() : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-bo-page-title text-ink">{t('title')}</h1>
        {step === null ? <p className="text-bo-body text-ink-2">{t('subtitle')}</p> : null}
      </div>
      {reason === null ? null : (
        <p
          role="status"
          className="rounded-tile bg-tone-info-soft p-3 text-bo-body text-tone-info-text"
        >
          {t(`reasons.${REASON_KEYS[reason]}`)}
        </p>
      )}
      {codeStep && step === null ? (
        <p
          role="alert"
          className="rounded-tile bg-tone-warning-soft p-3 text-bo-body text-tone-warning-text"
        >
          {t('stepExpired')}
        </p>
      ) : null}
      {step === null ? (
        <EmailForm next={next} />
      ) : (
        <CodeForm
          maskedEmail={maskEmail(step.email)}
          resendAt={step.sentAt + RESEND_COOLDOWN_S * 1000}
        />
      )}
    </div>
  );
}

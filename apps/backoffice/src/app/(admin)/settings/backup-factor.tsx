'use client';

import { MAX_ADMIN_MFA_FACTORS } from '@da/validation/admin/session';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, useTransition } from 'react';

import {
  confirmBackupFactorAction,
  startBackupFactorAction,
  type BackupEnrolment,
} from '@/actions/mfa-factors';
import { ActionButton } from '@/components/action-dialog';
import { useMessage } from '@/components/admin-provider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldMessage, Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useFormatters } from '@/lib/use-formatters';

export interface MfaFactorItem {
  readonly id: string;
  readonly name: string | null;
  readonly createdAt: string;
}

/**
 * Settings › Güvenlik › "Yedek cihaz ekle" (BACKOFFICE_PLAN §3.3): the verified TOTP factors, a
 * second one enrolled with a QR code (at most two), and removal with step-up while another factor
 * remains. Every change is audited server-side (`admin.mfa_factor_added` / `_removed`).
 */
export function BackupFactorControls({ factors }: { factors: readonly MfaFactorItem[] }) {
  const t = useTranslations('backoffice.settings.security.backup');
  const f = useFormatters();
  const toast = useToast();
  const message = useMessage();
  const router = useRouter();
  const codeId = useId();
  const [enrolment, setEnrolment] = useState<BackupEnrolment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const canAdd = factors.length < MAX_ADMIN_MFA_FACTORS;

  const start = () => {
    setError(null);
    setCode('');
    startTransition(async () => {
      const result = await startBackupFactorAction();
      if (result.ok) setEnrolment(result.data);
      else toast.show(message(result.error.messageKey, result.error.values), 'error');
    });
  };
  const confirm = () => {
    if (enrolment === null) return;
    if (!/^\d{6}$/.test(code)) {
      setError(t('codeFormat'));
      return;
    }
    startTransition(async () => {
      const result = await confirmBackupFactorAction({ factorId: enrolment.factorId, code });
      if (!result.ok) {
        setError(message(result.error.messageKey, result.error.values));
        return;
      }
      setEnrolment(null);
      toast.show(t('added'));
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3" data-testid="mfa-factors">
      <div className="flex flex-col gap-1">
        <p className="text-bo-body font-semibold text-ink">{t('title')}</p>
        <p className="text-bo-meta text-ink-3">{t('hint')}</p>
      </div>
      <ul className="flex flex-col divide-y divide-border-row">
        {factors.map((factor, index) => (
          <li key={factor.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="flex flex-col">
              <span className="text-bo-body text-ink">
                {factor.name ?? t('unnamed', { index: index + 1 })}
              </span>
              <span className="text-bo-meta text-ink-3">
                {t('since', { date: f.dateTime(factor.createdAt) })}
              </span>
            </span>
            <ActionButton
              route="DELETE /me/mfa-factors/:factorId"
              params={{ factorId: factor.id }}
              label={t('remove')}
              variant="ghost"
              disabled={factors.length < 2}
              disabledReason={t('lastFactor')}
              title={t('removeTitle')}
              effects={t('removeEffects')}
              confirmLabel={t('remove')}
              successMessage={t('removed')}
              testId={`mfa-factor-remove-${String(index)}`}
            />
          </li>
        ))}
      </ul>
      {canAdd ? (
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={start}
            data-testid="mfa-factor-add"
          >
            {t('add')}
          </Button>
        </div>
      ) : (
        <p className="text-bo-meta text-ink-3">{t('limit', { max: MAX_ADMIN_MFA_FACTORS })}</p>
      )}
      <Dialog
        open={enrolment !== null}
        onOpenChange={(open) => {
          if (!open) setEnrolment(null);
        }}
      >
        {enrolment === null ? null : (
          <DialogContent>
            <DialogTitle>{t('enrolTitle')}</DialogTitle>
            <DialogDescription>{t('enrolHint')}</DialogDescription>
            <div className="flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- Supabase returns the QR as an inline SVG data URI */}
              <img src={enrolment.qrCode} alt={t('qrAlt')} width={180} height={180} />
              <p className="text-bo-meta text-ink-2 break-all">
                {t('manual', { secret: enrolment.secret })}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={codeId}>{t('code')}</Label>
              <Input
                id={codeId}
                value={code}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                aria-invalid={error !== null}
                onChange={(event) => {
                  setCode(event.target.value.replace(/\D/g, ''));
                }}
              />
              {error === null ? null : <FieldMessage tone="error">{error}</FieldMessage>}
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  setEnrolment(null);
                }}
              >
                {t('cancel')}
              </Button>
              <Button disabled={pending} onClick={confirm} data-testid="mfa-factor-confirm">
                {t('verify')}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

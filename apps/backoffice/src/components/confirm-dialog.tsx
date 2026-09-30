'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState, useTransition, type SubmitEvent, type ReactNode } from 'react';

import { useAdmin, useMessage } from '@/components/admin-provider';
import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldMessage, Input, Label, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { uuidv7 } from '@/lib/ids';

/*
 * ConfirmDialog, levels 2 and 3 (BACKOFFICE_PLAN §5.4):
 * - title = the verb, "Ne olacak" = the exact effects, **Gerekçe** (10–500 chars) where the route
 *   requires a reason, primary button = the verb, [Vazgeç];
 * - L3 adds a typed confirmation ("Onaylamak için {token} yaz") and, on step-up routes, the
 *   "Doğrulama kodu" field when the session's step-up is older than 10 minutes or the server asks;
 * - the `Idempotency-Key` is created when the dialog opens and reused for every retry in it;
 * - success is shown only when the server says ok (no timer-based fake success).
 * Radix traps focus while open and returns it to the trigger on close.
 */

export interface ConfirmEnvelope {
  readonly reason?: string;
  readonly confirm: true;
  readonly idempotencyKey: string;
  readonly stepUpCode?: string;
}

export interface ConfirmFailure {
  readonly messageKey: string;
  readonly values: Readonly<Record<string, string | number>>;
  readonly correlationId?: string;
  readonly stepUpRequired?: boolean;
}

export type ConfirmResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ConfirmFailure };

export interface ConfirmDialogProps<T> {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly effects?: ReactNode;
  readonly confirmLabel: string;
  readonly tone?: 'default' | 'destructive';
  /** From the route's body contract (the server enforces it again). */
  readonly requiresReason?: boolean;
  /** L3: the text to type, e.g. the last 6 characters of the target id or `DEVRE DIŞI`. */
  readonly typedToken?: string;
  /** Route marked SU in BACKOFFICE_PLAN §12. */
  readonly requiresStepUp?: boolean;
  readonly onConfirm: (envelope: ConfirmEnvelope) => Promise<ConfirmResult<T>>;
  readonly onSuccess?: (data: T) => void;
  /** Toast after success; `null` for none (e.g. the action navigates away). */
  readonly successMessage?: string | null | ((data: T) => string | null);
  /** Route-specific inputs (durations, scopes, targeting…), rendered above the reason field. */
  readonly fields?: ReactNode;
  /** Client-side check of `fields` before anything is sent; returns the error copy or `null`. */
  readonly validate?: () => string | null;
  /** Wider dialog for editors and diffs. */
  readonly wide?: boolean;
}

export const REASON_MIN = 10;
export const REASON_MAX = 500;

export function ConfirmDialog<T>(props: ConfirmDialogProps<T>) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? (
        <DialogContent className={props.wide === true ? 'max-w-3xl' : undefined}>
          <ConfirmForm {...props} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function stepUpIsStale(validUntil: string | null | undefined): boolean {
  if (validUntil === null || validUntil === undefined) return true;
  return Date.parse(validUntil) <= Date.now();
}

function ConfirmForm<T>({
  onOpenChange,
  title,
  effects,
  confirmLabel,
  tone = 'default',
  requiresReason = false,
  typedToken,
  requiresStepUp = false,
  onConfirm,
  onSuccess,
  successMessage,
  fields,
  validate: validateFields,
}: ConfirmDialogProps<T>) {
  const t = useTranslations('backoffice.confirm');
  const message = useMessage();
  const toast = useToast();
  const admin = useAdmin();
  const ids = useId();
  const [idempotencyKey] = useState(() => uuidv7());
  const [showStepUp, setShowStepUp] = useState(
    () => requiresStepUp && stepUpIsStale(admin?.session.stepUpValidUntil),
  );
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [stepUpCode, setStepUpCode] = useState('');
  const [errors, setErrors] = useState<{ reason?: string; typed?: string; stepUp?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const typedRef = useRef<HTMLInputElement>(null);
  const stepUpRef = useRef<HTMLInputElement>(null);

  const trimmedLength = reason.trim().length;

  function validate(): boolean {
    const next: typeof errors = {};
    if (requiresReason && trimmedLength < REASON_MIN) next.reason = t('reasonTooShort');
    else if (requiresReason && trimmedLength > REASON_MAX) next.reason = t('reasonTooLong');
    if (typedToken !== undefined && typed.trim() !== typedToken) next.typed = t('typedMismatch');
    if (showStepUp && !/^\d{6}$/.test(stepUpCode)) next.stepUp = t('stepUpInvalid');
    setErrors(next);
    if (next.reason !== undefined) reasonRef.current?.focus();
    else if (next.typed !== undefined) typedRef.current?.focus();
    else if (next.stepUp !== undefined) stepUpRef.current?.focus();
    return Object.keys(next).length === 0;
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);
    const fieldError = validateFields?.() ?? null;
    if (fieldError !== null) {
      setServerError(fieldError);
      return;
    }
    if (!validate()) return;
    const envelope: ConfirmEnvelope = {
      confirm: true,
      idempotencyKey,
      ...(requiresReason ? { reason: reason.trim() } : {}),
      ...(showStepUp ? { stepUpCode } : {}),
    };
    startTransition(async () => {
      const result = await onConfirm(envelope);
      if (result.ok) {
        onOpenChange(false);
        const toastText =
          typeof successMessage === 'function' ? successMessage(result.data) : successMessage;
        if (toastText !== null) toast.show(toastText ?? t('saved'));
        onSuccess?.(result.data);
        return;
      }
      if (result.error.stepUpRequired === true) {
        setShowStepUp(true);
        setStepUpCode('');
      }
      setServerError(
        message(result.error.messageKey, {
          ...result.error.values,
          correlationId: result.error.correlationId ?? '—',
        }),
      );
    });
  }

  const reasonHelpId = `${ids}-reason-help`;
  const reasonErrorId = `${ids}-reason-error`;
  const typedErrorId = `${ids}-typed-error`;
  const stepUpHelpId = `${ids}-stepup-help`;

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div className="grid gap-2">
        <DialogTitle>{title}</DialogTitle>
        {effects === undefined ? (
          <DialogDescription className="sr-only">{title}</DialogDescription>
        ) : (
          <div className="grid gap-1 rounded-tile bg-surface-sunken p-3">
            <p className="text-bo-kicker text-ink-3 uppercase">{t('whatHappens')}</p>
            <DialogDescription asChild>
              <div className="text-bo-body text-ink">{effects}</div>
            </DialogDescription>
          </div>
        )}
      </div>

      {fields === undefined ? null : <div className="grid gap-3">{fields}</div>}

      {requiresReason ? (
        <div className="grid gap-1.5">
          <Label htmlFor={`${ids}-reason`}>{t('reason')}</Label>
          <Textarea
            id={`${ids}-reason`}
            ref={reasonRef}
            name="reason"
            value={reason}
            required
            minLength={REASON_MIN}
            maxLength={REASON_MAX}
            aria-invalid={errors.reason !== undefined}
            aria-describedby={
              errors.reason === undefined ? reasonHelpId : `${reasonErrorId} ${reasonHelpId}`
            }
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
          <div className="flex items-start justify-between gap-3">
            <FieldMessage id={reasonHelpId}>{t('reasonHelp')}</FieldMessage>
            <FieldMessage aria-hidden="true" className="tabular-nums">
              {t('reasonCount', { count: trimmedLength })}
            </FieldMessage>
          </div>
          {errors.reason === undefined ? null : (
            <FieldMessage id={reasonErrorId} tone="error">
              {errors.reason}
            </FieldMessage>
          )}
        </div>
      ) : null}

      {typedToken === undefined ? null : (
        <div className="grid gap-1.5">
          <Label htmlFor={`${ids}-typed`}>
            {t.rich('typed', {
              token: typedToken,
              strong: (chunks) => <strong className="font-mono">{chunks}</strong>,
            })}
          </Label>
          <Input
            id={`${ids}-typed`}
            ref={typedRef}
            name="typed"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            aria-invalid={errors.typed !== undefined}
            aria-describedby={errors.typed === undefined ? undefined : typedErrorId}
            onChange={(e) => {
              setTyped(e.target.value);
            }}
          />
          {errors.typed === undefined ? null : (
            <FieldMessage id={typedErrorId} tone="error">
              {errors.typed}
            </FieldMessage>
          )}
        </div>
      )}

      {showStepUp ? (
        <div className="grid gap-1.5">
          <Label htmlFor={`${ids}-stepup`}>{t('stepUp')}</Label>
          <Input
            id={`${ids}-stepup`}
            ref={stepUpRef}
            name="stepUpCode"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={stepUpCode}
            aria-invalid={errors.stepUp !== undefined}
            aria-describedby={stepUpHelpId}
            className="font-mono tracking-[0.3em]"
            onChange={(e) => {
              setStepUpCode(e.target.value.replace(/\D/g, '').slice(0, 6));
            }}
          />
          <FieldMessage id={stepUpHelpId} tone={errors.stepUp === undefined ? 'help' : 'error'}>
            {errors.stepUp ?? t('stepUpHelp')}
          </FieldMessage>
        </div>
      ) : null}

      {serverError === null ? null : (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-tile bg-tone-critical-soft p-3 text-bo-body text-tone-critical-text-strong"
        >
          <Icon name="error" size={16} className="mt-0.5" />
          <span>{serverError}</span>
        </p>
      )}

      <DialogFooter>
        <Button
          variant="secondary"
          onClick={() => {
            onOpenChange(false);
          }}
          disabled={pending}
        >
          {t('cancel')}
        </Button>
        <Button
          type="submit"
          variant={tone === 'destructive' ? 'destructive' : 'primary'}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? t('pending') : confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

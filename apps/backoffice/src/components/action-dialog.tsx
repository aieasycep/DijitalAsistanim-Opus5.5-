'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useState, useTransition, type ReactNode } from 'react';

import { mutateAction } from '@/actions/mutate';
import { useMessage } from '@/components/admin-provider';
import { ConfirmDialog, type ConfirmResult } from '@/components/confirm-dialog';
import { useRouteMeta } from '@/components/route-meta';
import { Button, type ButtonProps } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { uuidv7 } from '@/lib/ids';
import type { ModuleMutationKey, RouteData } from '@/server/admin-contracts';

/*
 * Module actions (BACKOFFICE_PLAN §5.4): every control that changes state maps to one allow-listed
 * admin-api mutation through `mutateAction`.
 * - `ActionDialog` / `ActionButton`: L2 and L3. The reason field and the step-up code appear exactly
 *   where the route's registry contract asks for them (`useRouteMeta`); L3 adds a typed token. The
 *   Idempotency-Key is created when the dialog opens; success refreshes the page's server data.
 * - `useInlineMutation`: L1 (status, assignment, preferences): no dialog, a pending state and a
 *   "Kaydedildi." toast after the server confirms.
 */

export interface ActionDialogProps<K extends ModuleMutationKey> {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly route: K;
  readonly params?: Readonly<Record<string, string>>;
  /** Route-specific body (without reason / confirm); a function is read at submit time. */
  readonly body?: Readonly<Record<string, unknown>> | (() => Readonly<Record<string, unknown>>);
  readonly title: string;
  readonly effects?: ReactNode;
  readonly fields?: ReactNode;
  readonly validate?: () => string | null;
  readonly confirmLabel: string;
  readonly tone?: 'default' | 'destructive';
  readonly typedToken?: string;
  readonly successMessage?: string | null | ((data: RouteData<K>) => string | null);
  readonly onSuccess?: (data: RouteData<K>) => void;
  readonly wide?: boolean;
}

export function ActionDialog<K extends ModuleMutationKey>({
  route,
  params,
  body,
  onSuccess,
  ...props
}: ActionDialogProps<K>) {
  const meta = useRouteMeta(route);
  const router = useRouter();
  const pathname = usePathname();
  return (
    <ConfirmDialog<RouteData<K>>
      {...props}
      requiresReason={meta.requiresReason}
      requiresStepUp={meta.requiresStepUp}
      onConfirm={async (envelope): Promise<ConfirmResult<RouteData<K>>> => {
        const resolved = typeof body === 'function' ? body() : body;
        const result = await mutateAction<K>(
          {
            route,
            ...(params === undefined ? {} : { params }),
            ...(resolved === undefined ? {} : { body: resolved }),
            revalidate: pathname,
          },
          envelope,
        );
        return result;
      }}
      onSuccess={(data) => {
        router.refresh();
        onSuccess?.(data);
      }}
    />
  );
}

/** A trigger button plus its dialog; `fields` may depend on local state owned by the caller. */
export function ActionButton<K extends ModuleMutationKey>({
  label,
  icon,
  variant = 'secondary',
  size = 'sm',
  disabled = false,
  disabledReason,
  onOpen,
  testId,
  ...dialog
}: Omit<ActionDialogProps<K>, 'open' | 'onOpenChange'> & {
  label: ReactNode;
  icon?: ReactNode;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  disabled?: boolean;
  /** Why a permitted action is unavailable in this state (§4.5): shown as the button's title. */
  disabledReason?: string;
  onOpen?: () => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const button = (
    <Button
      variant={variant}
      size={size}
      disabled={disabled}
      data-testid={testId}
      onClick={() => {
        onOpen?.();
        setOpen(true);
      }}
    >
      {icon}
      {label}
      {disabled && disabledReason !== undefined ? (
        <span className="sr-only">{disabledReason}</span>
      ) : null}
    </Button>
  );
  return (
    <>
      {disabled && disabledReason !== undefined ? (
        <span title={disabledReason} className="inline-flex">
          {button}
        </span>
      ) : (
        button
      )}
      <ActionDialog<K> {...dialog} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** L1 mutations without a dialog (§5.4): pending state, then "Kaydedildi." or the error copy. */
export function useInlineMutation(): {
  run: <K extends ModuleMutationKey>(
    route: K,
    params: Readonly<Record<string, string>>,
    body: Readonly<Record<string, unknown>>,
    options?: { successMessage?: string; onSuccess?: (data: RouteData<K>) => void },
  ) => void;
  pending: boolean;
} {
  const t = useTranslations('backoffice.confirm');
  const toast = useToast();
  const message = useMessage();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const run = useCallback(
    <K extends ModuleMutationKey>(
      route: K,
      params: Readonly<Record<string, string>>,
      body: Readonly<Record<string, unknown>>,
      options: { successMessage?: string; onSuccess?: (data: RouteData<K>) => void } = {},
    ) => {
      startTransition(async () => {
        const result = await mutateAction<K>(
          { route, params, body, revalidate: pathname },
          { idempotencyKey: uuidv7() },
        );
        if (result.ok) {
          toast.show(options.successMessage ?? t('saved'));
          options.onSuccess?.(result.data);
          router.refresh();
          return;
        }
        toast.show(
          message(result.error.messageKey, {
            ...result.error.values,
            correlationId: result.error.correlationId ?? '—',
          }),
          'error',
        );
      });
    },
    [message, pathname, router, t, toast],
  );
  return { run, pending };
}

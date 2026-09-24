import 'server-only';

import { Reason } from '@da/validation/admin/common';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { serverEnv } from '@/env';
import { errorCopy, sessionRedirect, type FailureLike } from '@/lib/error-copy';
import { UUID_PATTERN, uuidv7 } from '@/lib/ids';
import { adminApi, type AdminApiInput, type AdminApiResult } from './admin-api';
import {
  routeRequiresConfirm,
  routeRequiresReason,
  routeRequiresStepUp,
  type RouteData,
  type TypedMutationKey,
} from './admin-contracts';
import { checkSameOrigin, type OriginCheck } from './csrf';
import { serverSupabase } from './supabase';

/*
 * `adminAction` wrapper for every backoffice mutation (BACKOFFICE_PLAN §2.3 "Mutation path"):
 * (a) `Origin` must equal ADMIN_ORIGIN — a missing Origin is a 403, because Next 16 only warns;
 * (b) `Sec-Fetch-Site` must be `same-origin` when present;
 * (c) the dialog envelope is validated; a reason (10–500 chars) and `confirm: true` are required
 *     exactly where the route's body contract in `@da/validation` declares them;
 * (d) admin-api is called with the dialog's `Idempotency-Key` (generated here when absent), a fresh
 *     correlation id and, for step-up routes, a TOTP re-check first;
 * (e) failures map to the §2.5 copy, session failures redirect to /login or /mfa;
 * (f) the affected route is revalidated on success.
 */

export interface ActionFailure {
  readonly code: string;
  /** Key under `backoffice.*`, e.g. `errors.forbidden`, `confirm.stepUpInvalid`. */
  readonly messageKey: string;
  readonly values: Readonly<Record<string, string | number>>;
  readonly status: number;
  readonly correlationId?: string;
  readonly fieldErrors?: readonly { readonly path: string; readonly code: string }[];
  /** The dialog must show the "Doğrulama kodu" field and resubmit with `stepUpCode`. */
  readonly stepUpRequired?: boolean;
}

export type ActionResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ActionFailure };

/** What a confirm dialog sends with every mutation. */
export const MutationEnvelope = z.strictObject({
  reason: z.string().max(2000).optional(),
  confirm: z.boolean().optional(),
  idempotencyKey: z.string().regex(UUID_PATTERN).optional(),
  stepUpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
export type MutationEnvelope = z.infer<typeof MutationEnvelope>;

export function failure(
  code: string,
  messageKey: string,
  status: number,
  extra: Partial<Omit<ActionFailure, 'code' | 'messageKey' | 'status'>> = {},
): { ok: false; error: ActionFailure } {
  return { ok: false, error: { code, messageKey, status, values: {}, ...extra } };
}

/** Maps an admin-api failure to the dialog copy (session failures are handled by the caller). */
export function toActionFailure(
  error: FailureLike & { fieldErrors?: readonly { path: string; code: string }[] },
): ActionFailure {
  const copy = errorCopy(error);
  return {
    code: error.code,
    messageKey: `errors.${copy.key}`,
    values: copy.values,
    status: error.status,
    correlationId: error.correlationId,
    ...(error.fieldErrors === undefined
      ? {}
      : { fieldErrors: error.fieldErrors.map((f) => ({ path: f.path, code: f.code })) }),
    ...(copy.key === 'stepUpRequired' ? { stepUpRequired: true } : {}),
  };
}

/** Same-origin check for the current server action request (CTL-3.8 `assertSameOrigin()`). */
export async function currentOriginCheck(): Promise<OriginCheck> {
  return checkSameOrigin(await headers(), serverEnv().ADMIN_ORIGIN);
}

export interface MutationDeps {
  checkOrigin(): Promise<OriginCheck>;
  call<K extends TypedMutationKey>(
    key: K,
    input: AdminApiInput,
    options: { idempotencyKey: string },
  ): Promise<AdminApiResult<K>>;
  /** Re-verifies the admin's TOTP and records the step-up (`POST /session/step-up`). */
  stepUp(code: string): Promise<{ ok: true } | { ok: false; error: ActionFailure }>;
  redirect(path: string): never;
  revalidate(path: string): void;
}

export interface MutationSpec<K extends TypedMutationKey> {
  readonly route: K;
  readonly params?: Readonly<Record<string, string>>;
  /** Route-specific body fields; `reason` / `confirm` come from the envelope. */
  readonly body?: Readonly<Record<string, unknown>>;
  readonly envelope: unknown;
  readonly revalidate?: string;
}

/** Runs one admin mutation through checks (a)–(f). */
export async function runAdminMutation<K extends TypedMutationKey>(
  spec: MutationSpec<K>,
  deps: MutationDeps = defaultMutationDeps,
): Promise<ActionResult<RouteData<K>>> {
  const origin = await deps.checkOrigin();
  if (!origin.ok)
    return failure('CSRF_ORIGIN', 'errors.csrf', 403, { values: { reason: origin.reason } });

  const envelope = MutationEnvelope.safeParse(spec.envelope ?? {});
  if (!envelope.success) return failure('VALIDATION_FAILED', 'errors.validation', 422);

  const body: Record<string, unknown> = { ...(spec.body ?? {}) };
  if (routeRequiresReason(spec.route)) {
    const reason = Reason.safeParse(envelope.data.reason ?? '');
    if (!reason.success) {
      return failure('REASON_REQUIRED', 'errors.reasonRequired', 422, {
        fieldErrors: [{ path: 'reason', code: 'too_small' }],
      });
    }
    body.reason = reason.data;
  }
  if (routeRequiresConfirm(spec.route)) {
    if (envelope.data.confirm !== true)
      return failure('VALIDATION_FAILED', 'errors.validation', 422);
    body.confirm = true;
  }

  if (routeRequiresStepUp(spec.route) && envelope.data.stepUpCode !== undefined) {
    const stepUp = await deps.stepUp(envelope.data.stepUpCode);
    if (!stepUp.ok) return stepUp;
  }

  const idempotencyKey = envelope.data.idempotencyKey ?? uuidv7();
  const result = await deps.call(
    spec.route,
    { ...(spec.params === undefined ? {} : { params: spec.params }), body },
    { idempotencyKey },
  );
  if (!result.ok) {
    const to = sessionRedirect(result.error);
    if (to !== null) deps.redirect(to);
    return { ok: false, error: toActionFailure(result.error) };
  }
  if (spec.revalidate !== undefined) deps.revalidate(spec.revalidate);
  return { ok: true, data: result.data };
}

/** Verifies a TOTP code for step-up, then `POST /session/step-up` (BACKOFFICE_PLAN §3.3). */
export async function verifyStepUp(
  code: string,
): Promise<{ ok: true } | { ok: false; error: ActionFailure }> {
  const supabase = await serverSupabase();
  const factors = await supabase.auth.mfa.listFactors();
  const factor = factors.data?.totp[0];
  if (factor === undefined)
    return failure('STEP_UP_FAILED', 'confirm.stepUpInvalid', 403, { stepUpRequired: true });
  const verified = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (verified.error !== null) {
    return failure('STEP_UP_FAILED', 'confirm.stepUpInvalid', 403, { stepUpRequired: true });
  }
  const recorded = await adminApi('POST /session/step-up', { body: {} });
  if (!recorded.ok) {
    const to = sessionRedirect(recorded.error);
    if (to !== null) redirect(to);
    return { ok: false, error: toActionFailure(recorded.error) };
  }
  return { ok: true };
}

export const defaultMutationDeps: MutationDeps = {
  checkOrigin: currentOriginCheck,
  call: (key, input, options) => adminApi(key, input, options),
  stepUp: verifyStepUp,
  redirect: (path) => redirect(path),
  revalidate: (path) => {
    revalidatePath(path);
  },
};

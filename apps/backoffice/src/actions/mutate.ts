'use server';

import { z } from 'zod';

import { failure, runAdminMutation, type ActionResult } from '@/server/action';
import {
  MODULE_MUTATION_ROUTES,
  type ModuleMutationKey,
  type RouteData,
} from '@/server/admin-contracts';

/*
 * The one server action behind every module control (BACKOFFICE_PLAN §2.3 "Mutation path",
 * T-10.05…T-10.14): the client names an allow-listed admin-api mutation, its path params and its
 * route-specific body; `runAdminMutation` then checks Origin and Sec-Fetch-Site, takes the reason and
 * `confirm` only from the dialog envelope (never from the body), runs the step-up when a code is
 * given, calls admin-api with the dialog's Idempotency-Key (the route's zod contract validates the
 * merged body before anything is sent), maps errors and revalidates the page. admin-api and SQL
 * decide the permission; hiding a control in the UI is cosmetic only.
 */

const ParamName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/);
const MutateRequest = z.strictObject({
  route: z.enum(MODULE_MUTATION_ROUTES),
  params: z.record(ParamName, z.string().min(1).max(200)).optional(),
  body: z.record(z.string().max(64), z.unknown()).optional(),
  /** The admin page to re-render after success (an in-app path, never a URL). */
  revalidate: z
    .string()
    .max(200)
    .regex(/^\/[A-Za-z0-9/_\-.[\]]*$/)
    .optional(),
});

export interface MutateRequest<K extends ModuleMutationKey = ModuleMutationKey> {
  readonly route: K;
  readonly params?: Readonly<Record<string, string>>;
  readonly body?: Readonly<Record<string, unknown>>;
  readonly revalidate?: string;
}

export async function mutateAction<K extends ModuleMutationKey>(
  request: MutateRequest<K>,
  envelope: unknown,
): Promise<ActionResult<RouteData<K>>> {
  const parsed = MutateRequest.safeParse(request);
  if (!parsed.success) return failure('VALIDATION_FAILED', 'errors.validation', 422);
  const { route, params, body, revalidate } = parsed.data;
  const rest: Record<string, unknown> = { ...(body ?? {}) };
  delete rest.reason;
  delete rest.confirm;
  const result = await runAdminMutation({
    route,
    ...(params === undefined ? {} : { params }),
    body: rest,
    envelope,
    ...(revalidate === undefined ? {} : { revalidate }),
  });
  return result as ActionResult<RouteData<K>>;
}

'use server';

import { z } from 'zod';

import { failure, runAdminMutation, type ActionResult } from '@/server/action';

/*
 * Exact email lookup (BACKOFFICE_PLAN §5.5, §6.2): `POST /users/lookup` keeps the address in the
 * request body, never in a URL; admin-api matches `lower(email)`, returns only the user id and
 * audits `user.lookup_by_email` with an HMAC of the address. The caller navigates to the user.
 */
export async function lookupUserAction(email: unknown): Promise<ActionResult<{ user_id: string }>> {
  const parsed = z
    .email()
    .max(254)
    .safeParse(typeof email === 'string' ? email.trim() : email);
  if (!parsed.success) return failure('VALIDATION_FAILED', 'users.lookup.invalid', 422);
  return runAdminMutation({
    route: 'POST /users/lookup',
    body: { email: parsed.data.toLowerCase() },
    envelope: {},
  });
}

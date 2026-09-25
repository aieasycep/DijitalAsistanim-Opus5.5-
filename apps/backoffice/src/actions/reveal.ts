'use server';

import { UserRevealField } from '@da/validation/admin/users';
import { z } from 'zod';

import { failure, runAdminMutation, type ActionResult } from '@/server/action';
import { REVEAL_ROUTES } from '@/server/admin-contracts';

const RevealRequest = z.strictObject({
  route: z.enum(REVEAL_ROUTES),
  id: z.uuid(),
  /**
   * Only `POST /users/:id/reveal` takes a field (BACKOFFICE_PLAN §5.5): `email`, `display_name`,
   * `integration_email:{account_id}` or `ticket_contact_email:{ticket_id}`.
   */
  field: UserRevealField.optional(),
});

export type RevealRequest = z.infer<typeof RevealRequest>;

/**
 * Reveals one masked value for 60 s (BACKOFFICE_PLAN §5.5): permission, reason and audit are enforced
 * by admin-api and SQL; the value is returned to the dialog only, never logged, cached or put in a URL.
 */
export async function revealAction(
  request: RevealRequest,
  envelope: unknown,
): Promise<ActionResult<{ value: string; expires_in_s: 60 }>> {
  const parsed = RevealRequest.safeParse(request);
  if (!parsed.success) return failure('VALIDATION_FAILED', 'errors.validation', 422);
  const { route, id, field } = parsed.data;
  return runAdminMutation({
    route,
    params: { id },
    body: route === 'POST /users/:id/reveal' ? { field: field ?? 'email' } : {},
    envelope,
  });
}

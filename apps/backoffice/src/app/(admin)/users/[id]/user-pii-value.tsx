'use client';

import { revealAction } from '@/actions/reveal';
import { MaskedValue } from '@/components/masked-value';

/**
 * One SQL-masked PII value of a user with its audited reveal (BACKOFFICE_PLAN §5.5): an integration
 * mailbox (`integration_email:{account_id}`) or a ticket contact (`ticket_contact_email:{ticket_id}`)
 * through `POST /users/:id/reveal` (`users.pii.reveal`, reason, 60 s, audit `user.pii_revealed`).
 */
export function UserPiiValue({
  userId,
  field,
  masked,
  label,
}: {
  userId: string;
  field: `integration_email:${string}` | `ticket_contact_email:${string}`;
  masked: string;
  label: string;
}) {
  return (
    <MaskedValue
      masked={masked}
      label={label}
      reveal={{
        permission: 'users.pii.reveal',
        reveal: (envelope) =>
          revealAction({ route: 'POST /users/:id/reveal', id: userId, field }, envelope),
      }}
    />
  );
}

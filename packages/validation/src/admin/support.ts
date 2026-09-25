import { z } from 'zod';
import {
  SUPPORT_ACCESS_SCOPE_VALUES,
  TICKET_CATEGORY_VALUES,
  TICKET_STATUS_VALUES,
} from '@da/domain';
import { hasDefinedValue, IsoDateTime, Uuid } from '../api/common.ts';
import {
  EmailMasked,
  PagedSuccess,
  Reason,
  ReasonBody,
  RevealData,
  Success,
  adminListQuery,
} from './common.ts';

/* ADM-03 · Support and Support Access (§12.3, R-09). No impersonation route exists anywhere. */

export const SupportAccessScope = z.enum(SUPPORT_ACCESS_SCOPE_VALUES);
export const TicketsListQuery = adminListQuery({
  sort: ['created_at', 'status'],
  filters: {
    status: z.enum(TICKET_STATUS_VALUES),
    category: z.enum(TICKET_CATEGORY_VALUES),
    assignee: Uuid,
    source: z.enum(['app', 'web']),
  },
});
export const TicketRow = z.object({
  id: Uuid,
  reference: z.string(),
  category: z.enum(TICKET_CATEGORY_VALUES),
  status: z.enum(TICKET_STATUS_VALUES),
  subject: z.string(),
  platform: z.enum(['ios', 'android', 'web']).nullable(),
  app_version: z.string().nullable(),
  assignee: z.string().nullable(),
  created_at: IsoDateTime,
  contact_email_masked: EmailMasked.nullable(),
  /** The matched app user (full uuid, not PII by itself, §5.5); `null` for an unmatched web form. */
  user_id: Uuid.nullable(),
});
export const TicketsListResponse = PagedSuccess(TicketRow);
export const TicketDetailResponse = Success(
  TicketRow.extend({
    message: z.string(),
    diagnostics: z.record(z.string(), z.unknown()).nullable(),
    notes: z.array(
      z.object({
        id: Uuid,
        kind: z.enum(['internal', 'reply', 'inbound_email']),
        body: z.string(),
        author: z.string().nullable(),
        created_at: IsoDateTime,
      }),
    ),
  }),
);
export const TicketPatchBody = z
  .strictObject({
    status: z.enum(TICKET_STATUS_VALUES).optional(),
    assignee_admin_id: Uuid.nullable().optional(),
    category: z.enum(TICKET_CATEGORY_VALUES).optional(),
  })
  .refine(hasDefinedValue, 'no_changes');
export const TicketResponse = Success(TicketRow);
export const TicketNoteBody = z.strictObject({ body: z.string().trim().min(1).max(5000) });
export const TicketNoteResponse = Success(z.object({ note_id: Uuid, created_at: IsoDateTime }));
export const TicketReplyResponse = Success(
  z.object({ note_id: Uuid, email_job_id: Uuid, created_at: IsoDateTime }),
);

export const SupportAccessGrantBody = z
  .strictObject({
    user_id: Uuid,
    scopes: z.array(SupportAccessScope).min(1).max(SUPPORT_ACCESS_SCOPE_VALUES.length),
    reason: Reason,
    duration_minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
    ticket_id: Uuid.optional(),
  })
  .refine((b) => new Set(b.scopes).size === b.scopes.length, 'duplicate_scope');
export const SupportAccessGrant = z.object({
  id: Uuid,
  user_id: Uuid,
  scopes: z.array(SupportAccessScope),
  reason: z.string(),
  starts_at: IsoDateTime,
  expires_at: IsoDateTime,
  revoked_at: IsoDateTime.nullable(),
  reveal_count: z.int().min(0),
});
export const SupportAccessGrantResponse = Success(SupportAccessGrant);
export const SupportAccessRevokeBody = ReasonBody;
export const SupportContentParams = z.strictObject({ id: Uuid, scope: SupportAccessScope });
export const SupportContentQuery = z.strictObject({
  entity_type: z.string().regex(/^[a-z_]{3,40}$/),
  entity_id: Uuid,
});
/** Never tokens, secrets, passwords, provider-fetched original mail, attachments or files (R-09). */
export const SupportContentResponse = Success(RevealData);

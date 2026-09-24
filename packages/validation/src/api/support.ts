import { z } from 'zod';
import { FEEDBACK_TYPE_VALUES, TICKET_CATEGORY_VALUES, TICKET_STATUS_VALUES } from '@da/domain';
import { Email, Uuid } from './common.ts';
import { Success } from './envelope.ts';

export const TicketCategory = z.enum(TICKET_CATEGORY_VALUES);
export const TicketStatus = z.enum(TICKET_STATUS_VALUES);
/** Public ticket reference, e.g. `DA-7K3M9Q` or `DA-2026-000123`. */
export const TicketReference = z.string().regex(/^DA-[A-Z0-9-]{4,20}$/);

// API-SUP-01 · POST /support/tickets
export const SupportTicketBody = z.strictObject({
  category: TicketCategory,
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(10).max(5000),
  include_diagnostics: z.boolean().default(true),
  contact_email: Email.optional(),
});
export const SupportTicketResponse = Success(
  z.object({ id: Uuid, reference: TicketReference, status: TicketStatus }),
);

// API-SUP-02 · POST /feedback
export const FeedbackBody = z
  .strictObject({
    type: z.enum(FEEDBACK_TYPE_VALUES),
    rating: z.int().min(1).max(5).optional(),
    message: z.string().trim().max(5000).optional(),
    screen: z.string().max(64).optional(),
    include_diagnostics: z.boolean().default(false),
  })
  .refine((b) => b.rating !== undefined || (b.message !== undefined && b.message !== ''), {
    message: 'message_or_rating_required',
    path: ['message'],
  });
export const FeedbackResponse = Success(z.object({ id: Uuid }));

/** Content-free diagnostics attached to app tickets (API-SUP-01). */
export const SupportDiagnostics = z.strictObject({
  app_version: z.string().max(32),
  platform: z.enum(['ios', 'android']),
  os_version: z.string().max(32),
  connected_accounts: z
    .array(
      z.strictObject({
        provider: z.string().max(32),
        status: z.string().max(32),
        last_sync_at: z.string().nullable(),
      }),
    )
    .max(20),
  job_error_codes: z.array(z.string().max(64)).max(5),
  push_enabled: z.boolean(),
  entitlement_active: z.boolean(),
});

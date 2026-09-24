import { z } from 'zod';
import { ITEM_STATUS_VALUES } from '@da/domain';
import { ApprovalView } from './approvals.ts';
import { Capability, IsoDateTime, Provider, ReplyDraft, Tone, Uuid } from './common.ts';
import { Success } from './envelope.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

function ordered(from: string, to: string): boolean {
  return Date.parse(to) > Date.parse(from);
}

// API-PLAN-01 · GET /plan/free-slots
const QueryBoolean = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');
export const FreeSlotsQuery = z
  .strictObject({
    from: IsoDateTime,
    to: IsoDateTime,
    min_minutes: z.coerce.number().int().min(15).max(480).default(30),
    within_working_hours: QueryBoolean.default(true),
  })
  .refine((q) => ordered(q.from, q.to), { message: 'to_before_from', path: ['to'] })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= 14 * DAY_MS, {
    message: 'range_too_long',
    path: ['to'],
  });
export const FreeSlotsResponse = Success(
  z.object({
    slots: z.array(z.object({ start: IsoDateTime, end: IsoDateTime, minutes: z.int() })),
    sources_considered: z.array(
      z.object({
        account_id: Uuid,
        provider: Provider,
        last_sync_at: IsoDateTime.nullable(),
        stale: z.boolean(),
      }),
    ),
  }),
);

// API-PLAN-02 · POST /plan/proposals
export const PlanProposalBody = z
  .strictObject({
    item: z
      .strictObject({
        type: z.enum(['task', 'commitment', 'insight', 'email_message']),
        id: Uuid,
      })
      .optional(),
    title: z.string().min(1).max(300).optional(),
    duration_minutes: z.int().min(15).max(480),
    window: z.strictObject({ from: IsoDateTime, to: IsoDateTime }),
    prefer: z.enum(['morning', 'afternoon', 'any']).default('any'),
    target_calendar_id: Uuid.optional(),
  })
  .refine((b) => b.item !== undefined || b.title !== undefined, 'item_or_title')
  .refine((b) => ordered(b.window.from, b.window.to), {
    message: 'to_before_from',
    path: ['window', 'to'],
  })
  .refine((b) => Date.parse(b.window.to) - Date.parse(b.window.from) <= 14 * DAY_MS, {
    message: 'window_too_long',
    path: ['window'],
  });
const Slot = z.object({ start: IsoDateTime, end: IsoDateTime });
export const PlanProposalResponse = Success(
  z.object({
    insight_id: Uuid,
    slot: Slot,
    alternatives: z.array(Slot).max(3),
    rationale_text: z.string().max(300),
    approval: ApprovalView,
  }),
);

// API-PLAN-03 · POST /plan/conflicts/:insightId/options
export const ConflictParams = z.strictObject({ insightId: Uuid });
export const ConflictOptionKind = z.enum([
  'move_event',
  'shorten_event',
  'propose_new_time_email',
  'remind_me',
  'contact_external',
  'ignore',
]);
export const ConflictOptionsBody = z.strictObject({});
export const ConflictOptionsResponse = Success(
  z.object({
    conflict: z.object({
      insight_id: Uuid,
      events: z
        .array(
          z.object({
            id: Uuid,
            title: z.string(),
            start: IsoDateTime,
            end: IsoDateTime,
            is_organizer: z.boolean(),
            attendee_count: z.int(),
          }),
        )
        .length(2),
    }),
    options: z
      .array(
        z.object({
          option_id: z.string(),
          kind: ConflictOptionKind,
          title: z.string(),
          description: z.string(),
          feasibility: z.object({
            organizer: z.boolean(),
            attendee_availability: z.enum(['free', 'busy', 'unknown']),
          }),
          side_effects: z.array(z.string()),
          requires_capability: Capability.nullable(),
          pro_required: z.boolean(),
        }),
      )
      .max(6),
  }),
);

// API-PLAN-04 · POST /plan/conflicts/:insightId/resolve
export const ConflictResolveBody = z.strictObject({
  option_id: z.string().max(40),
  params: z
    .strictObject({
      new_start: IsoDateTime.optional(),
      new_end: IsoDateTime.optional(),
      tone: Tone.optional(),
    })
    .refine(
      (p) =>
        p.new_start === undefined || p.new_end === undefined || ordered(p.new_start, p.new_end),
      { message: 'end_before_start', path: ['new_end'] },
    )
    .optional(),
});
export const ConflictResolveResponse = Success(
  z.object({
    approval: ApprovalView.nullable(),
    reply_draft: ReplyDraft.nullable(),
    reminder_options_route: z.string().nullable(),
    insight_status: z.enum(ITEM_STATUS_VALUES),
  }),
);

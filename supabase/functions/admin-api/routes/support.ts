/**
 * ADM-03 support tickets and Support Access (API_CONTRACTS §12.3; BACKOFFICE_PLAN §6.4, §9; R-09;
 * T-10.07). Replies go out through the email adapter as a `transactional_email` job (JOB-31)
 * created in the same transaction as the reply note (`admin_api.ticket_reply`); the email
 * credential is checked first (`503 EXTERNAL_CREDENTIAL_REQUIRED`, nothing stored). Support
 * Access grants are time-boxed (15/30/60 min) and scoped; every content view goes through
 * `support_access_authorize`, which counts and audits it. No impersonation route exists.
 */
import { admin as A } from '@da/validation';
import type { z } from 'zod';
import { listArgs, paged, qValue } from '../lib/list.ts';
import { count, type Json, obj, str } from '../lib/map.ts';
import { poke, requireEmailCredential } from '../lib/ops.ts';
import { defineRoutes, type RouteCtx } from '../lib/route.ts';

function ticketRow(t: Json) {
  return {
    id: t.id,
    reference: t.reference,
    category: t.category,
    status: t.status,
    subject: t.subject,
    platform: str(t.platform),
    app_version: str(t.app_version),
    assignee: str(t.assignee),
    created_at: t.created_at,
    contact_email_masked: str(t.contact_email_masked),
    user_id: str(t.user_id),
  };
}

/** `support_notes.kind` → the ADM-03 note kind (system notes render as internal ones). */
const NOTE_KINDS: Readonly<Record<string, 'internal' | 'reply' | 'inbound_email'>> = {
  internal: 'internal',
  system: 'internal',
  outbound_reply: 'reply',
  inbound_reply: 'inbound_email',
};

async function ticketDetail(ctx: RouteCtx) {
  const t = obj(await ctx.db.call('ticket_detail', { p_id: String(ctx.params.id) }));
  const diagnostics: Record<string, string> = {};
  for (const key of ['origin', 'platform', 'app_version'] as const) {
    const v = str(t[key]);
    if (v !== null) diagnostics[key] = v;
  }
  return {
    data: {
      ...ticketRow(t),
      message: str(t.message) ?? '',
      diagnostics: Object.keys(diagnostics).length === 0 ? null : diagnostics,
      notes: (Array.isArray(t.notes) ? (t.notes as Json[]) : []).map((n) => ({
        id: n.id,
        kind: NOTE_KINDS[str(n.kind) ?? ''] ?? 'internal',
        body: str(n.body) ?? '',
        author: str(n.author),
        created_at: n.created_at,
      })),
    },
  };
}

async function patchTicket(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.TicketPatchBody>;
  const out = obj(
    await ctx.db.call('ticket_patch', {
      p_id: String(ctx.params.id),
      p_status: body.status ?? null,
      p_category: body.category ?? null,
      p_assignee: body.assignee_admin_id ?? null,
      p_unassign: body.assignee_admin_id === null,
    }),
  );
  return { data: ticketRow(out) };
}

async function addNote(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.TicketNoteBody>;
  const out = obj(
    await ctx.db.call('ticket_add_note', { p_id: String(ctx.params.id), p_body: body.body }),
  );
  return { data: { note_id: out.note_id, created_at: out.created_at }, status: 201 as const };
}

async function reply(ctx: RouteCtx) {
  requireEmailCredential(ctx.rt);
  const body = ctx.body as z.infer<typeof A.TicketNoteBody>;
  const locale = ctx.c.get('locale') === 'en-US' ? 'en' : 'tr';
  const out = obj(
    await ctx.db.call('ticket_reply', {
      p_id: String(ctx.params.id),
      p_body: body.body,
      p_locale: locale,
    }),
  );
  await poke(ctx.rt, ctx.log, 'admin_support_reply');
  return {
    data: { note_id: out.note_id, email_job_id: out.email_job_id, created_at: out.created_at },
    status: 202 as const,
  };
}

function grantResponse(g: Json, fallback: Json) {
  return {
    id: g.id ?? fallback.id,
    user_id: g.user_id ?? fallback.user_id,
    scopes: Array.isArray(g.scope)
      ? g.scope
      : Array.isArray(fallback.scopes)
        ? fallback.scopes
        : [],
    reason: str(g.reason) ?? str(fallback.reason) ?? '',
    starts_at: g.starts_at ?? fallback.starts_at,
    expires_at: g.expires_at ?? fallback.expires_at,
    revoked_at: str(g.revoked_at) ?? str(fallback.revoked_at),
    reveal_count: count(g.reveal_count ?? fallback.reveal_count),
  };
}

async function openGrant(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.SupportAccessGrantBody>;
  const g = obj(
    await ctx.db.call('support_access_grant', {
      p_user: body.user_id,
      p_scope: body.scopes,
      p_reason: body.reason,
      p_minutes: body.duration_minutes,
      p_ticket: body.ticket_id ?? null,
    }),
  );
  return {
    data: grantResponse(g, {
      user_id: body.user_id,
      reason: body.reason,
      revoked_at: null,
      reveal_count: 0,
    }),
    status: 201 as const,
  };
}

/** Revoke, then read the grant back from the user's support view (same permission family). */
async function revokeGrant(ctx: RouteCtx) {
  const body = ctx.body as z.infer<typeof A.SupportAccessRevokeBody>;
  const grantId = String(ctx.params.id).toLowerCase();
  const out = obj(
    await ctx.db.call('support_access_revoke', { p_grant: grantId, p_reason: body.reason }),
  );
  const { data, error } = await ctx.rt.system
    .from('support_access_grants')
    .select('id,user_id,scope,reason,starts_at,expires_at,revoked_at,reveal_count')
    .eq('id', grantId)
    .maybeSingle();
  const row = error === null && data !== null ? (data as Json) : {};
  return {
    data: grantResponse(row, { id: grantId, revoked_at: out.revoked_at, reveal_count: 0 }),
  };
}

/** One scoped value under an active grant; the stored derived fields only (R-09), audited. */
async function content(ctx: RouteCtx) {
  const query = ctx.query as z.infer<typeof A.SupportContentQuery>;
  const out = obj(
    await ctx.db.call('support_access_authorize', {
      p_grant: String(ctx.params.id),
      p_scope: String(ctx.params.scope),
      p_resource_type: query.entity_type,
      p_resource_id: query.entity_id,
      p_reason: `support access view: ${String(ctx.params.scope)} ${query.entity_type}`,
    }),
  );
  const value = out.value;
  return {
    data: {
      value: typeof value === 'string' ? value : JSON.stringify(value ?? null),
      expires_in_s: 60,
    },
  };
}

export const supportRoutes = defineRoutes({
  'GET /support/tickets': {
    rate: 'R',
    async handle(ctx) {
      const q = qValue(ctx.query);
      const out = await ctx.db.call(
        'tickets_list',
        listArgs(ctx.query, {
          filters: {
            status: 'status',
            category: 'category',
            assignee: 'assignee',
            source: 'source',
          },
          extraFilter: q === undefined ? {} : { q: q.toUpperCase() },
        }),
      );
      return paged(ctx.query, out, ticketRow);
    },
  },
  'GET /support/tickets/:id': { rate: 'R', handle: ticketDetail },
  'PATCH /support/tickets/:id': { rate: 'M', handle: patchTicket },
  'POST /support/tickets/:id/notes': { rate: 'M', handle: addNote },
  'POST /support/tickets/:id/reply': { rate: 'M', handle: reply },
  'POST /support-access/grants': { rate: 'X', handle: openGrant },
  'POST /support-access/grants/:id/revoke': { rate: 'M', handle: revokeGrant },
  'GET /support-access/grants/:id/content/:scope': { rate: 'X', handle: content },
});

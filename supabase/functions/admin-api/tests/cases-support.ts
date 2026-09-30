/** ADM-03 support tickets and Support Access: SQL-shaped outputs and mapped responses. */
import { assert, assertEquals } from '@std/assert';
import { ADMIN_ID } from './harness.ts';
import {
  argsOf,
  type Cases,
  data,
  LATER,
  pokes,
  REASON,
  rows,
  sqlPage,
  TS,
  uuid,
} from './case-helpers.ts';

/** `private.admin_ticket_row` (bridge migration). */
const sqlTicket = (extra: Record<string, unknown> = {}) => ({
  id: uuid(82),
  reference: 'DA-7K3M9Q',
  category: 'sync',
  status: 'open',
  priority: 'normal',
  subject: 'Senkron sorunu',
  platform: 'ios',
  app_version: '1.0.0',
  origin: 'app',
  assignee: null,
  created_at: TS,
  updated_at: TS,
  contact_email_masked: 'yu***@gmail.com',
  user_id: uuid(2),
  ...extra,
});

export const SUPPORT_CASES: Cases = {
  'GET /support/tickets': {
    request: { query: { 'filter[source]': 'web', q: 'da-7k3m9q' } },
    sql: { tickets_list: () => sqlPage([sqlTicket()]) },
    expect(h, body) {
      assertEquals(argsOf(h, 'tickets_list')?.p_filter, { source: 'web', q: 'DA-7K3M9Q' });
      const row = rows(body)[0] ?? {};
      assertEquals(row.user_id, uuid(2), 'the matched user links to the user detail');
      assert(!('priority' in row));
      assertEquals(row.reference, 'DA-7K3M9Q');
    },
  },
  'GET /support/tickets/:id': {
    sql: {
      ticket_detail: () => ({
        ...sqlTicket(),
        user: { id: uuid(2), email_masked: 'yu***@gmail.com', display_name_masked: 'Y***' },
        message: 'Mailler gelmiyor.',
        first_response_at: null,
        resolved_at: null,
        closed_at: null,
        notes: [
          {
            id: uuid(104),
            kind: 'internal',
            author_admin_id: uuid(100),
            author: 'Ops',
            body: 'İnceleniyor',
            created_at: TS,
          },
          {
            id: uuid(105),
            kind: 'outbound_reply',
            author_admin_id: uuid(100),
            author: 'Ops',
            body: 'Merhaba',
            created_at: LATER,
          },
          {
            id: uuid(106),
            kind: 'inbound_reply',
            author_admin_id: null,
            author: null,
            body: 'Teşekkürler',
            created_at: LATER,
          },
          {
            id: uuid(107),
            kind: 'system',
            author_admin_id: null,
            author: null,
            body: 'Kapatıldı',
            created_at: LATER,
          },
        ],
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'ticket_detail'), { p_id: uuid(1) });
      const d = data(body);
      assertEquals(d.diagnostics, { origin: 'app', platform: 'ios', app_version: '1.0.0' });
      const notes = d.notes as Record<string, unknown>[];
      assertEquals(
        notes.map((n) => n.kind),
        ['internal', 'reply', 'inbound_email', 'internal'],
      );
      assertEquals(notes[2]?.author, null, 'author-less inbound notes render');
      assert(!('user' in d));
    },
  },
  'PATCH /support/tickets/:id': {
    sql: { ticket_patch: () => sqlTicket({ status: 'in_progress', assignee: ADMIN_ID }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'ticket_patch'), {
        p_id: uuid(1),
        p_status: 'in_progress',
        p_category: null,
        p_assignee: null,
        p_unassign: false,
      });
      assertEquals(data(body).status, 'in_progress');
    },
  },
  'POST /support/tickets/:id/notes': {
    sql: { ticket_add_note: () => ({ note_id: uuid(104), created_at: TS }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'ticket_add_note'), {
        p_id: uuid(1),
        p_body: 'Kullanıcıya dönüş yapıldı.',
      });
      assertEquals(data(body), { note_id: uuid(104), created_at: TS });
    },
  },
  'POST /support/tickets/:id/reply': {
    sql: { ticket_reply: () => ({ note_id: uuid(104), email_job_id: uuid(70), created_at: TS }) },
    expect(h, body) {
      assertEquals(argsOf(h, 'ticket_reply'), {
        p_id: uuid(1),
        p_body: 'Merhaba, sorun giderildi.',
        p_locale: 'tr',
      });
      assertEquals(pokes(h), ['admin_support_reply']);
      assertEquals(data(body).email_job_id, uuid(70));
    },
  },
  'POST /support-access/grants': {
    sql: {
      support_access_grant: () => ({
        id: uuid(102),
        scope: ['email_metadata', 'insights'],
        starts_at: TS,
        expires_at: '2026-09-24T08:30:00Z',
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'support_access_grant'), {
        p_user: uuid(2),
        p_scope: ['email_metadata', 'insights'],
        p_reason: REASON,
        p_minutes: 30,
        p_ticket: null,
      });
      assertEquals(data(body), {
        id: uuid(102),
        user_id: uuid(2),
        scopes: ['email_metadata', 'insights'],
        reason: REASON,
        starts_at: TS,
        expires_at: '2026-09-24T08:30:00Z',
        revoked_at: null,
        reveal_count: 0,
      });
    },
  },
  'POST /support-access/grants/:id/revoke': {
    sql: { support_access_revoke: () => ({ id: uuid(102), revoked_at: LATER }) },
    tables: {
      support_access_grants: () => [
        {
          id: uuid(102),
          user_id: uuid(2),
          scope: ['email_metadata'],
          reason: REASON,
          starts_at: TS,
          expires_at: LATER,
          revoked_at: LATER,
          reveal_count: 2,
        },
      ],
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'support_access_revoke'), { p_grant: uuid(102), p_reason: REASON });
      assertEquals(data(body).reveal_count, 2);
      assertEquals(data(body).scopes, ['email_metadata']);
    },
  },
  'GET /support-access/grants/:id/content/:scope': {
    sql: {
      support_access_authorize: () => ({
        value: { subject: 'Fiyat güncellemesi', participants: ['a***@x.com'], snippet: 'Merhaba' },
        expires_in_s: 60,
      }),
    },
    expect(h, body) {
      assertEquals(argsOf(h, 'support_access_authorize'), {
        p_grant: uuid(102),
        p_scope: 'email_metadata',
        p_resource_type: 'email_message',
        p_resource_id: uuid(90),
        p_reason: 'support access view: email_metadata email_message',
      });
      const value = JSON.parse(String(data(body).value)) as Record<string, unknown>;
      assertEquals(value.subject, 'Fiyat güncellemesi');
    },
  },
};

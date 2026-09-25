/**
 * Microsoft emulators (TEST_PLAN §6.1): `/ms-login` (authorize, token with `client_assertion`
 * verification — the RS256/PS256 signature against the test certificate key and the `x5t#S256`
 * header against `MICROSOFT_CERT_THUMBPRINT_S256`; refresh-token rotation; AADSTS errors) and
 * `/graph/v1.0` (me, mail folder deltas with `@odata.nextLink` → `@odata.deltaLink`, message reads,
 * `reply` / `sendMail` with the extended-property marker, Sent Items search, calendars,
 * `calendarView` and its delta, events with `transactionId` de-duplication, subscriptions, To Do
 * lists / tasks / delta, `$batch`). `POST /__graph` seeds and mutates the state.
 */
import type { Context, Hono } from 'hono';
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';
import {
  b64url,
  bearerOf,
  fixture,
  formOf,
  jsonOf,
  type MockEnv,
  type MockState,
  randomId,
} from './core.ts';

type Folder = 'inbox' | 'sentitems';
interface Item {
  seq: number;
  removed: boolean;
  data: Record<string, unknown>;
}

interface GraphState {
  identity: { oid: string; tid: string; mail: string; displayName: string };
  adminConsentRequired: boolean;
  codes: Map<string, { scope: string; redirectUri: string; nonce: string | null }>;
  refresh: Map<string, { scope: string; valid: boolean }>;
  seq: number;
  messages: Record<Folder, Map<string, Item>>;
  events: Map<string, Item>;
  subscriptions: Map<string, Record<string, unknown>>;
  msTasks: Map<string, Item>;
  pageSize: number;
  assertions: { alg: string; x5tS256: string | null; aud: unknown; iss: unknown; valid: boolean }[];
}

const TODO_LIST = 'AAMkAGI2TodoDefault';
const CALENDAR = 'AAMkAGI2CalDefault';

function freshState(): GraphState {
  return {
    identity: {
      oid: '00000000-0000-0000-66f3-3332eca7ea81',
      tid: '72f988bf-86f1-41af-91ab-2d7cd011db47',
      mail: 'yunus.demir@kuzeylojistik.example',
      displayName: 'Yunus Demir',
    },
    adminConsentRequired: false,
    codes: new Map(),
    refresh: new Map(),
    seq: 0,
    messages: { inbox: new Map(), sentitems: new Map() },
    events: new Map(),
    subscriptions: new Map(),
    msTasks: new Map(),
    pageSize: 50,
    assertions: [],
  };
}

function unsignedJwt(claims: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'mock-aad' }))}.${b64url(JSON.stringify(claims))}.${b64url('sig')}`;
}

export function mountMicrosoft(app: Hono<MockEnv>, state: MockState): void {
  let s = freshState();
  state.onReset(() => {
    s = freshState();
  });
  const clientId = Deno.env.get('MICROSOFT_CLIENT_ID') ?? '';
  const thumbprint = Deno.env.get('MICROSOFT_CERT_THUMBPRINT_S256') ?? '';
  const publicPem = Deno.env.get('MOCK_MS_CERT_PUBLIC_KEY') ?? '';
  const base = () => `${Deno.env.get('DA_IT_MOCK_URL') ?? 'http://127.0.0.1:8788'}/graph/v1.0`;
  const nextSeq = () => ++s.seq;

  app.post('/__graph', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const op = body.op;
    if (op === 'identity') s.identity = { ...s.identity, ...(body.identity as object) };
    else if (op === 'admin_consent_required') s.adminConsentRequired = body.value === true;
    else if (op === 'page_size') s.pageSize = Number(body.value);
    else if (op === 'messages') {
      const folder = (body.folder as Folder | undefined) ?? 'inbox';
      const list = [
        ...((body.fixtures as string[] | undefined) ?? []).flatMap(
          (n) => fixture<{ value: Record<string, unknown>[] }>(n).value ?? [],
        ),
        ...((body.messages as Record<string, unknown>[] | undefined) ?? []),
      ];
      // Fixture convenience: `__minus_<n>m__` date placeholders are resolved relative to now.
      const resolved = JSON.parse(
        JSON.stringify(list).replace(/"__minus_(\d+)m__"/g, (_, minutes: string) =>
          JSON.stringify(new Date(Date.now() - Number(minutes) * 60_000).toISOString()),
        ),
      ) as Record<string, unknown>[];
      for (const m of resolved)
        s.messages[folder].set(String(m.id), { seq: nextSeq(), removed: false, data: m });
    } else if (op === 'remove_message') {
      const item = s.messages[(body.folder as Folder | undefined) ?? 'inbox'].get(String(body.id));
      if (item !== undefined) {
        item.removed = true;
        item.seq = nextSeq();
      }
    } else if (op === 'events') {
      for (const e of (body.events as Record<string, unknown>[] | undefined) ?? [])
        s.events.set(String(e.id ?? randomId('AAMkEvt')), {
          seq: nextSeq(),
          removed: false,
          data: { ...e },
        });
    } else if (op === 'ms_tasks') {
      for (const t of (body.tasks as Record<string, unknown>[] | undefined) ?? [])
        s.msTasks.set(String(t.id ?? randomId('AAMkTask')), {
          seq: nextSeq(),
          removed: false,
          data: { ...t },
        });
    } else if (op === 'invalidate_refresh') {
      for (const entry of s.refresh.values()) entry.valid = false;
    } else if (op === 'state') {
      return c.json({
        assertions: s.assertions,
        refresh: [...s.refresh.keys()],
        subscriptions: [...s.subscriptions.values()],
        events: [...s.events.values()].map((i) => i.data),
        sent: [...s.messages.sentitems.values()].map((i) => i.data),
        ms_tasks: [...s.msTasks.values()].map((i) => i.data),
      });
    } else return c.json({ error: `unknown op ${String(op)}` }, 400);
    return c.json({ ok: true });
  });

  // ── identity platform ─────────────────────────────────────────────────────────────────────
  app.get('/ms-login/:tenant/oauth2/v2.0/authorize', (c) => {
    const q = c.req.query();
    if (q.client_id !== clientId) return c.text('AADSTS700016: Application not found', 400);
    const code = `0.AX${randomId()}`;
    s.codes.set(code, {
      scope: q.scope ?? '',
      redirectUri: q.redirect_uri ?? '',
      nonce: q.nonce ?? null,
    });
    const redirect = new URL(q.redirect_uri ?? '');
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', q.state ?? '');
    return c.redirect(redirect.toString(), 302);
  });

  app.post('/ms-login/:tenant/oauth2/v2.0/token', async (c) => {
    const form = formOf(c);
    const assertion = form.get('client_assertion') ?? '';
    const endpoint = new URL(c.req.url);
    let valid = false;
    let header: Record<string, unknown> = {};
    let claims: Record<string, unknown> = {};
    try {
      header = decodeProtectedHeader(assertion) as Record<string, unknown>;
      const alg = String(header.alg ?? 'RS256');
      const key = await importSPKI(publicPem, alg);
      const verified = await jwtVerify(assertion, key, { algorithms: ['RS256', 'PS256'] });
      claims = verified.payload as Record<string, unknown>;
      valid =
        header['x5t#S256'] === thumbprint &&
        claims.iss === clientId &&
        claims.sub === clientId &&
        String(claims.aud).endsWith(endpoint.pathname);
    } catch {
      valid = false;
    }
    s.assertions.push({
      alg: String(header.alg ?? ''),
      x5tS256: (header['x5t#S256'] as string | undefined) ?? null,
      aud: claims.aud,
      iss: claims.iss,
      valid,
    });
    if (!valid || form.get('client_id') !== clientId) {
      return c.json(
        {
          error: 'invalid_client',
          error_description: 'AADSTS700027: Client assertion failed signature validation.',
          error_codes: [700027],
        },
        401,
      );
    }
    if (s.adminConsentRequired) return c.json(fixture('graph/aadsts65001.json'), 400);
    const rotate = (scope: string) => {
      const refreshToken = `M.C5${randomId()}${randomId()}`;
      s.refresh.set(refreshToken, { scope, valid: true });
      return refreshToken;
    };
    const tokens = (scope: string, nonce: string | null) => ({
      token_type: 'Bearer',
      scope,
      expires_in: 3599,
      ext_expires_in: 3599,
      access_token: `EwB${randomId()}`,
      refresh_token: rotate(scope),
      id_token: unsignedJwt({
        aud: clientId,
        iss: `https://login.microsoftonline.com/${s.identity.tid}/v2.0`,
        oid: s.identity.oid,
        tid: s.identity.tid,
        preferred_username: s.identity.mail,
        name: s.identity.displayName,
        ...(nonce === null ? {} : { nonce }),
      }),
    });
    if (form.get('grant_type') === 'authorization_code') {
      const entry = s.codes.get(form.get('code') ?? '');
      s.codes.delete(form.get('code') ?? '');
      if (entry === undefined)
        return c.json(
          {
            error: 'invalid_grant',
            error_description: 'AADSTS70000: code is invalid',
            error_codes: [70000],
          },
          400,
        );
      return c.json(tokens(entry.scope, entry.nonce));
    }
    if (form.get('grant_type') === 'refresh_token') {
      const entry = s.refresh.get(form.get('refresh_token') ?? '');
      if (entry === undefined || !entry.valid) {
        return c.json(
          {
            error: 'invalid_grant',
            error_description:
              'AADSTS70008: The provided authorization code or refresh token has expired.',
            error_codes: [70008],
          },
          400,
        );
      }
      entry.valid = false;
      return c.json(tokens(entry.scope, null));
    }
    return c.json({ error: 'unsupported_grant_type' }, 400);
  });

  // ── Graph ─────────────────────────────────────────────────────────────────────────────────
  const g = '/graph/v1.0';
  // $batch of GETs, answered by this same app (`$` is not a literal in Hono patterns).
  const batch = async (c: Context<MockEnv>) => {
    const body = jsonOf<{
      requests?: { id: string; method: string; url: string; headers?: Record<string, string> }[];
    }>(c);
    const responses = [];
    for (const r of body.requests ?? []) {
      const res = await app.request(`${base()}${r.url.startsWith('/') ? r.url : `/${r.url}`}`, {
        method: r.method,
        headers: { ...(r.headers ?? {}), Authorization: c.req.header('authorization') ?? '' },
      });
      const text = await res.text();
      responses.push({ id: r.id, status: res.status, body: text === '' ? null : JSON.parse(text) });
    }
    return c.json({ responses });
  };
  app.use(`${g}/*`, async (c, next) => {
    if (bearerOf(c) === null) {
      return c.json(
        { error: { code: 'InvalidAuthenticationToken', message: 'Access token is empty.' } },
        401,
      );
    }
    const path = decodeURIComponent(new URL(c.req.url).pathname);
    if (c.req.method === 'POST' && path === `${g}/$batch`) return await batch(c);
    // OData key syntax `mailFolders('sentitems')` is not a Hono path segment.
    const keyed = /^\/graph\/v1\.0\/me\/mailFolders\('([a-z]+)'\)\/messages$/.exec(path);
    if (c.req.method === 'GET' && keyed?.[1] !== undefined) return folderMessages(c, keyed[1]);
    await next();
  });
  app.get(`${g}/me`, (c) =>
    c.json({
      id: s.identity.oid,
      mail: s.identity.mail,
      userPrincipalName: s.identity.mail,
      displayName: s.identity.displayName,
    }),
  );
  app.get(`${g}/me/mailboxSettings/timeZone`, (c) => c.json({ value: 'Turkey Standard Time' }));

  const deltaPage = (
    c: Context<MockEnv>,
    items: Map<string, Item>,
    path: string,
    view: (item: Item) => Record<string, unknown>,
  ) => {
    const url = new URL(c.req.url);
    const deltaToken = url.searchParams.get('$deltatoken');
    const skip = Number(url.searchParams.get('$skiptoken') ?? 0);
    const since = deltaToken === null ? -1 : Number(deltaToken);
    const changed = [...items.values()]
      .filter((i) => i.seq > since && (since >= 0 || !i.removed))
      .sort((a, b) => a.seq - b.seq);
    const page = changed.slice(skip, skip + s.pageSize);
    const more = skip + s.pageSize < changed.length;
    const carry = new URLSearchParams(url.searchParams);
    carry.delete('$skiptoken');
    carry.delete('$deltatoken');
    const link = (key: string, value: string) => {
      const p = new URLSearchParams(carry);
      if (deltaToken !== null && key === '$skiptoken') p.set('$deltatoken', deltaToken);
      p.set(key, value);
      // Graph links carry literal `$` query names (`$skiptoken`, `$deltatoken`).
      return `${base()}${path}?${p.toString().replace(/%24/g, '$')}`;
    };
    return c.json({
      '@odata.context': `${base()}/$metadata#Collection`,
      value: page.map((i) =>
        i.removed ? { id: i.data.id, '@removed': { reason: 'deleted' } } : view(i),
      ),
      ...(more
        ? { '@odata.nextLink': link('$skiptoken', String(skip + s.pageSize)) }
        : { '@odata.deltaLink': link('$deltatoken', String(s.seq)) }),
    });
  };

  app.get(`${g}/me/mailFolders/:folder/messages/delta`, (c) => {
    const folder = c.req.param('folder') as Folder;
    return deltaPage(
      c,
      s.messages[folder] ?? new Map(),
      `/me/mailFolders/${folder}/messages/delta`,
      (i) => i.data,
    );
  });
  app.get(`${g}/me/mailFolders/:folder/messages`, (c) => folderMessages(c, c.req.param('folder')));
  function folderMessages(c: Context<MockEnv>, raw: string) {
    const folder: Folder = /sent/i.test(raw) ? 'sentitems' : 'inbox';
    const filter = c.req.query('$filter') ?? '';
    let list = [...s.messages[folder].values()].filter((i) => !i.removed).map((i) => i.data);
    const marker = /ep\/value eq '([^']+)'/.exec(filter)?.[1];
    if (marker !== undefined) {
      list = list.filter((m) =>
        ((m.singleValueExtendedProperties as { value?: string }[] | undefined) ?? []).some(
          (p) => p.value === marker,
        ),
      );
    }
    return c.json({
      '@odata.count': list.length,
      value: list.slice(0, Number(c.req.query('$top') ?? 50)),
    });
  }
  app.get(`${g}/me/messages/:id`, (c) => {
    const id = c.req.param('id');
    const item = s.messages.inbox.get(id) ?? s.messages.sentitems.get(id);
    if (item === undefined || item.removed)
      return c.json(
        {
          error: {
            code: 'ErrorItemNotFound',
            message: 'The specified object was not found in the store.',
          },
        },
        404,
      );
    return c.json({ ...item.data, attachments: [] });
  });
  const storeSent = (message: Record<string, unknown>, conversationId: string | null) => {
    const id = randomId('AAMkSent');
    s.messages.sentitems.set(id, {
      seq: nextSeq(),
      removed: false,
      data: {
        id,
        conversationId: conversationId ?? randomId('AAQkConv'),
        sentDateTime: new Date().toISOString(),
        webLink: `https://outlook.office365.com/owa/?ItemID=${id}`,
        ...message,
      },
    });
  };
  app.post(`${g}/me/messages/:id/reply`, (c) => {
    const original = s.messages.inbox.get(c.req.param('id'));
    if (original === undefined)
      return c.json({ error: { code: 'ErrorItemNotFound', message: 'Not found.' } }, 404);
    const body = jsonOf<{ message?: Record<string, unknown>; comment?: string }>(c);
    storeSent(
      {
        subject: `RE: ${String(original.data.subject ?? '')}`,
        bodyPreview: body.comment ?? '',
        ...(body.message ?? {}),
      },
      (original.data.conversationId as string | undefined) ?? null,
    );
    return c.body(null, 202);
  });
  app.post(`${g}/me/sendMail`, (c) => {
    const body = jsonOf<{ message?: Record<string, unknown> }>(c);
    storeSent(body.message ?? {}, null);
    return c.body(null, 202);
  });

  // Calendars and events.
  app.get(`${g}/me/calendars`, (c) =>
    c.json({
      value: [
        {
          id: CALENDAR,
          name: 'Takvim',
          hexColor: '#0078d4',
          canEdit: true,
          isDefaultCalendar: true,
          owner: { name: s.identity.displayName, address: s.identity.mail },
        },
      ],
    }),
  );
  app.get(`${g}/me/calendars/:cal/calendarView/delta`, (c) =>
    deltaPage(c, s.events, `/me/calendars/${c.req.param('cal')}/calendarView/delta`, (i) => i.data),
  );
  app.get(`${g}/me/calendars/:cal/calendarView`, (c) =>
    c.json({ value: [...s.events.values()].filter((i) => !i.removed).map((i) => i.data) }),
  );
  app.post(`${g}/me/calendars/:cal/events`, (c) => {
    const body = jsonOf<Record<string, unknown>>(c);
    const tx = body.transactionId;
    if (typeof tx === 'string') {
      const existing = [...s.events.values()].find((i) => i.data.transactionId === tx);
      if (existing !== undefined) return c.json(existing.data, 201);
    }
    const id = randomId('AAMkEvt');
    const data = {
      ...body,
      id,
      webLink: `https://outlook.office365.com/owa/?itemid=${id}`,
      isCancelled: false,
    };
    s.events.set(id, { seq: nextSeq(), removed: false, data });
    return c.json(data, 201);
  });
  app.get(`${g}/me/events/:id`, (c) => {
    const item = s.events.get(c.req.param('id'));
    if (item === undefined || item.removed)
      return c.json({ error: { code: 'ErrorItemNotFound', message: 'Not found.' } }, 404);
    return c.json(item.data);
  });
  app.patch(`${g}/me/events/:id`, (c) => {
    const item = s.events.get(c.req.param('id'));
    if (item === undefined)
      return c.json({ error: { code: 'ErrorItemNotFound', message: 'Not found.' } }, 404);
    Object.assign(item.data, jsonOf(c));
    item.seq = nextSeq();
    return c.json(item.data);
  });

  // Subscriptions.
  app.post(`${g}/subscriptions`, (c) => {
    const body = jsonOf<Record<string, unknown>>(c);
    const id = crypto.randomUUID();
    const sub = { id, ...body, applicationId: clientId, creatorId: s.identity.oid };
    s.subscriptions.set(id, sub);
    return c.json(sub, 201);
  });
  app.get(`${g}/subscriptions`, (c) => c.json({ value: [...s.subscriptions.values()] }));
  app.patch(`${g}/subscriptions/:id`, (c) => {
    const sub = s.subscriptions.get(c.req.param('id'));
    if (sub === undefined)
      return c.json(
        { error: { code: 'ResourceNotFound', message: 'The object was not found.' } },
        404,
      );
    Object.assign(sub, jsonOf(c));
    return c.json(sub);
  });
  app.post(`${g}/subscriptions/:id/reauthorize`, (c) => c.body(null, 200));
  app.delete(`${g}/subscriptions/:id`, (c) => {
    if (!s.subscriptions.delete(c.req.param('id')))
      return c.json(
        { error: { code: 'ResourceNotFound', message: 'The object was not found.' } },
        404,
      );
    return c.body(null, 204);
  });

  // To Do.
  app.get(`${g}/me/todo/lists`, (c) =>
    c.json({
      value: [
        { id: TODO_LIST, displayName: 'Görevler', wellknownListName: 'defaultList', isOwner: true },
      ],
    }),
  );
  app.get(`${g}/me/todo/lists/:list/tasks/delta`, (c) =>
    deltaPage(c, s.msTasks, `/me/todo/lists/${c.req.param('list')}/tasks/delta`, (i) => i.data),
  );
  app.get(`${g}/me/todo/lists/:list/tasks`, (c) =>
    c.json({ value: [...s.msTasks.values()].filter((i) => !i.removed).map((i) => i.data) }),
  );
  app.post(`${g}/me/todo/lists/:list/tasks`, (c) => {
    const body = jsonOf<Record<string, unknown>>(c);
    const id = randomId('AAMkTask');
    const data = { ...body, id, status: 'notStarted', createdDateTime: new Date().toISOString() };
    s.msTasks.set(id, { seq: nextSeq(), removed: false, data });
    return c.json(data, 201);
  });
}

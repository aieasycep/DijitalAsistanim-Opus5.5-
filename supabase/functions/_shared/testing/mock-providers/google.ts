/**
 * Google emulators (TEST_PLAN §6.1): `/google-oauth` (authorize, token, revoke, OIDC JWKS, a
 * Pub/Sub push-token minter), and the Google APIs at their real paths under one base, because the
 * adapters share `GOOGLE_API_BASE_URL`: `/gmail/v1` (Gmail), `/calendar/v3` (the `/gcal` family),
 * `/tasks/v1` (the `/gtasks` family). State is one mailbox, calendar set and task set per server;
 * `POST /__reset` empties it and `POST /__google` seeds or mutates it.
 */
import type { Hono } from 'hono';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  b64url,
  bearerOf,
  fixture,
  formOf,
  fromB64url,
  googleError,
  jsonOf,
  type MockEnv,
  type MockState,
  randomId,
  sha256b64url,
} from './core.ts';

export interface GmailHeader {
  name: string;
  value: string;
}
export interface GmailPart {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: GmailHeader[];
  body: { size: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet?: string;
  historyId?: string;
  internalDate: string;
  sizeEstimate?: number;
  payload: GmailPart;
}
interface HistoryRecord {
  id: string;
  messagesAdded?: { message: { id: string; threadId: string; labelIds: string[] } }[];
  messagesDeleted?: { message: { id: string; threadId: string; labelIds: string[] } }[];
  labelsAdded?: {
    message: { id: string; threadId: string; labelIds: string[] };
    labelIds: string[];
  }[];
  labelsRemoved?: {
    message: { id: string; threadId: string; labelIds: string[] };
    labelIds: string[];
  }[];
}
interface GEvent {
  id: string;
  status: string;
  etag: string;
  updated: string;
  seq: number;
  [key: string]: unknown;
}

interface GoogleState {
  identity: { sub: string; email: string; name: string };
  /** When set, the granted scope string of the next consents (partial grants). */
  grantOverride: string | null;
  grants: Map<string, Set<string>>;
  codes: Map<
    string,
    {
      clientId: string;
      redirectUri: string;
      scope: string;
      challenge: string;
      nonce: string | null;
    }
  >;
  refresh: Map<string, { scope: string; revoked: boolean }>;
  access: Set<string>;
  mailbox: {
    messages: Map<string, GmailMessage>;
    history: HistoryRecord[];
    historyId: number;
    historyFloor: number;
    historyPageSize: number;
    listPageSize: number;
    watchExpirationMs: number | null;
  };
  calendars: {
    id: string;
    summary: string;
    primary?: boolean;
    accessRole: string;
    timeZone: string;
  }[];
  events: Map<string, Map<string, GEvent>>;
  eventSeq: number;
  channels: Map<string, { resourceId: string; calendarId: string; token: string | null }>;
  taskLists: { id: string; title: string; updated: string }[];
  tasks: Map<string, Map<string, Record<string, unknown>>>;
}

function freshState(): GoogleState {
  return {
    identity: {
      sub: '108234567890123456789',
      email: 'yunus.demir@example.com',
      name: 'Yunus Demir',
    },
    grantOverride: null,
    grants: new Map(),
    codes: new Map(),
    refresh: new Map(),
    access: new Set(),
    mailbox: {
      messages: new Map(),
      history: [],
      historyId: 100000,
      historyFloor: 0,
      historyPageSize: 100,
      listPageSize: 500,
      watchExpirationMs: null,
    },
    calendars: [
      {
        id: 'primary',
        summary: 'Yunus Demir',
        primary: true,
        accessRole: 'owner',
        timeZone: 'Europe/Istanbul',
      },
    ],
    events: new Map([['primary', new Map()]]),
    eventSeq: 0,
    channels: new Map(),
    taskLists: [
      {
        id: 'MDk4NjE1NzM0NTY3ODkwMTIzNDU6MDow',
        title: 'Görevlerim',
        updated: new Date().toISOString(),
      },
    ],
    tasks: new Map([['MDk4NjE1NzM0NTY3ODkwMTIzNDU6MDow', new Map()]]),
  };
}

function headerOf(message: GmailMessage, name: string): string | null {
  const found = (message.payload.headers ?? []).find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? null;
}

function stub(message: GmailMessage) {
  return { id: message.id, threadId: message.threadId, labelIds: [...message.labelIds] };
}

/** Minimal RFC 5322 parse of a `messages.send` raw payload (headers + text body). */
function parseRaw(raw: string): { headers: GmailHeader[]; body: string } {
  const text = new TextDecoder().decode(fromB64url(raw));
  const split = text.search(/\r?\n\r?\n/);
  const head = split < 0 ? text : text.slice(0, split);
  const body = split < 0 ? '' : text.slice(split).replace(/^\r?\n\r?\n/, '');
  const headers: GmailHeader[] = [];
  for (const line of head.split(/\r?\n/)) {
    if (/^\s/.test(line) && headers.length > 0) {
      const last = headers[headers.length - 1];
      if (last !== undefined) last.value += ` ${line.trim()}`;
      continue;
    }
    const idx = line.indexOf(':');
    if (idx > 0) headers.push({ name: line.slice(0, idx), value: line.slice(idx + 1).trim() });
  }
  return { headers, body };
}

function metadataView(message: GmailMessage, wanted: readonly string[]): GmailMessage {
  const allow = new Set(wanted.map((h) => h.toLowerCase()));
  return {
    ...stub(message),
    snippet: message.snippet ?? '',
    historyId: message.historyId ?? '0',
    internalDate: message.internalDate,
    sizeEstimate: message.sizeEstimate ?? 0,
    payload: {
      mimeType: message.payload.mimeType,
      headers: (message.payload.headers ?? []).filter(
        (h) => allow.size === 0 || allow.has(h.name.toLowerCase()),
      ),
      body: { size: 0 },
    },
  } as GmailMessage;
}

export async function mountGoogle(app: Hono<MockEnv>, state: MockState): Promise<void> {
  let g = freshState();
  state.onReset(() => {
    g = freshState();
  });
  const keys = await generateKeyPair('RS256', { extractable: true });
  const kid = 'mock-google-1';
  const jwk = { ...(await exportJWK(keys.publicKey)), kid, alg: 'RS256', use: 'sig' };
  const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET') ?? '';
  const now = () => Date.now();

  const nextHistory = () => String(++g.mailbox.historyId);
  const pushHistory = (record: Omit<HistoryRecord, 'id'>) => {
    const id = nextHistory();
    g.mailbox.history.push({ id, ...record });
    return id;
  };
  const addMessage = (message: GmailMessage, recordHistory: boolean) => {
    const copy = structuredClone(message) as GmailMessage & { internal_offset_minutes?: number };
    // Fixture convenience: `internal_offset_minutes` places the message relative to now.
    if (typeof copy.internal_offset_minutes === 'number') {
      copy.internalDate = String(now() + copy.internal_offset_minutes * 60_000);
      delete copy.internal_offset_minutes;
    }
    if (recordHistory) {
      copy.historyId = pushHistory({ messagesAdded: [{ message: stub(copy) }] });
    } else {
      copy.historyId = String(g.mailbox.historyId);
    }
    g.mailbox.messages.set(copy.id, copy);
    return copy;
  };
  const authorized = (token: string | null) =>
    token !== null && (g.access.has(token) || token.startsWith('ya29.mock-'));

  // ── control: seed / mutate ────────────────────────────────────────────────────────────────
  app.post('/__google', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const op = body.op;
    if (op === 'identity') g.identity = { ...g.identity, ...(body.identity as object) };
    else if (op === 'grant') g.grantOverride = (body.scope as string | null) ?? null;
    else if (op === 'mailbox') {
      const names = (body.fixtures as string[] | undefined) ?? [];
      const messages = [
        ...names.flatMap((n) => fixture<GmailMessage[] | GmailMessage>(n)),
        ...((body.messages as GmailMessage[] | undefined) ?? []),
      ].flat();
      for (const m of messages) addMessage(m, body.history === true);
    } else if (op === 'delete_message') {
      const m = g.mailbox.messages.get(String(body.id));
      if (m !== undefined) {
        g.mailbox.messages.delete(m.id);
        pushHistory({ messagesDeleted: [{ message: stub(m) }] });
      }
    } else if (op === 'remove_label') {
      const m = g.mailbox.messages.get(String(body.id));
      if (m !== undefined) {
        m.labelIds = m.labelIds.filter((l) => l !== body.label);
        pushHistory({ labelsRemoved: [{ message: stub(m), labelIds: [String(body.label)] }] });
      }
    } else if (op === 'history_floor') g.mailbox.historyFloor = Number(body.value);
    else if (op === 'page_size') {
      if (body.history !== undefined) g.mailbox.historyPageSize = Number(body.history);
      if (body.list !== undefined) g.mailbox.listPageSize = Number(body.list);
    } else if (op === 'watch_expiration') g.mailbox.watchExpirationMs = Number(body.value);
    else if (op === 'events') {
      const cal = String(body.calendar ?? 'primary');
      const map = g.events.get(cal) ?? new Map<string, GEvent>();
      g.events.set(cal, map);
      for (const e of (body.events as Record<string, unknown>[] | undefined) ?? []) {
        const seq = ++g.eventSeq;
        const id = String(e.id ?? randomId('evt'));
        map.set(id, {
          status: 'confirmed',
          ...e,
          id,
          etag: `"${3000000000000000 + seq}"`,
          updated: new Date(now()).toISOString(),
          seq,
        } as GEvent);
      }
    } else if (op === 'cancel_event') {
      const ev = g.events.get(String(body.calendar ?? 'primary'))?.get(String(body.id));
      if (ev !== undefined) {
        ev.status = 'cancelled';
        ev.seq = ++g.eventSeq;
        ev.updated = new Date(now()).toISOString();
      }
    } else if (op === 'tasks') {
      const list = String(body.list ?? g.taskLists[0]?.id);
      const map = g.tasks.get(list) ?? new Map();
      g.tasks.set(list, map);
      for (const t of (body.tasks as Record<string, unknown>[] | undefined) ?? []) {
        const id = String(t.id ?? randomId('task'));
        map.set(id, {
          kind: 'tasks#task',
          status: 'needsAction',
          updated: new Date(now()).toISOString(),
          ...t,
          id,
        });
      }
    } else if (op === 'pubsub_token') {
      const token = await new SignJWT({
        email: String(body.email),
        email_verified: true,
      })
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuer('https://accounts.google.com')
        .setAudience(String(body.audience))
        .setSubject('113355779911224466880')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(keys.privateKey);
      return c.json({ token });
    } else if (op === 'state') {
      return c.json({
        messages: [...g.mailbox.messages.values()],
        history_id: g.mailbox.historyId,
        events: Object.fromEntries([...g.events].map(([k, v]) => [k, [...v.values()]])),
        tasks: Object.fromEntries([...g.tasks].map(([k, v]) => [k, [...v.values()]])),
        channels: [...g.channels.entries()],
        refresh: [...g.refresh.entries()],
      });
    } else return c.json({ error: `unknown op ${String(op)}` }, 400);
    return c.json({ ok: true });
  });

  // ── OAuth ─────────────────────────────────────────────────────────────────────────────────
  app.get('/google-oauth/oauth2/v3/certs', (c) => c.json({ keys: [jwk] }));

  app.get('/google-oauth/o/oauth2/v2/auth', (c) => {
    const q = c.req.query();
    if (q.client_id !== clientId) return c.json({ error: 'invalid_client' }, 400);
    const redirect = new URL(q.redirect_uri ?? '');
    const requested = new Set((q.scope ?? '').split(' ').filter((s) => s !== ''));
    const prior = g.grants.get(g.identity.sub) ?? new Set<string>();
    const granted = new Set(
      g.grantOverride === null ? requested : g.grantOverride.split(' ').filter((s) => s !== ''),
    );
    if (q.include_granted_scopes === 'true') for (const s of prior) granted.add(s);
    const scope = [...granted].join(' ');
    const code = `4/0A${randomId()}`;
    g.codes.set(code, {
      clientId: q.client_id ?? '',
      redirectUri: q.redirect_uri ?? '',
      scope,
      challenge: q.code_challenge ?? '',
      nonce: q.nonce ?? null,
    });
    redirect.searchParams.set('state', q.state ?? '');
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('scope', scope);
    return c.redirect(redirect.toString(), 302);
  });

  app.post('/google-oauth/token', async (c) => {
    const form = formOf(c);
    if (form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret) {
      return c.json(
        { error: 'invalid_client', error_description: 'The OAuth client was not found.' },
        401,
      );
    }
    // `ya29.mock-` tokens stay valid across `/__reset`, like real tokens across a test step.
    const accessToken = `ya29.mock-${randomId()}`;
    g.access.add(accessToken);
    if (form.get('grant_type') === 'authorization_code') {
      const entry = g.codes.get(form.get('code') ?? '');
      g.codes.delete(form.get('code') ?? '');
      if (entry === undefined || entry.redirectUri !== form.get('redirect_uri')) {
        return c.json({ error: 'invalid_grant', error_description: 'Malformed auth code.' }, 400);
      }
      if ((await sha256b64url(form.get('code_verifier') ?? '')) !== entry.challenge) {
        return c.json({ error: 'invalid_grant', error_description: 'Invalid code verifier.' }, 400);
      }
      const refreshToken = `1//0g${randomId()}${randomId()}`;
      g.refresh.set(refreshToken, { scope: entry.scope, revoked: false });
      g.grants.set(g.identity.sub, new Set(entry.scope.split(' ')));
      const idToken = await new SignJWT({
        email: g.identity.email,
        email_verified: true,
        name: g.identity.name,
        ...(entry.nonce === null ? {} : { nonce: entry.nonce }),
      })
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuer('https://accounts.google.com')
        .setAudience(clientId)
        .setSubject(g.identity.sub)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(keys.privateKey);
      return c.json({
        access_token: accessToken,
        expires_in: 3599,
        refresh_token: refreshToken,
        scope: entry.scope,
        token_type: 'Bearer',
        id_token: idToken,
      });
    }
    if (form.get('grant_type') === 'refresh_token') {
      const token = form.get('refresh_token') ?? '';
      const known = g.refresh.get(token);
      if (known?.revoked === true || (known === undefined && !token.startsWith('1//'))) {
        return c.json(
          { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
          400,
        );
      }
      return c.json({
        access_token: accessToken,
        expires_in: 3599,
        scope: known?.scope ?? '',
        token_type: 'Bearer',
      });
    }
    return c.json({ error: 'unsupported_grant_type' }, 400);
  });

  app.post('/google-oauth/revoke', (c) => {
    const token = formOf(c).get('token') ?? new URL(c.req.url).searchParams.get('token') ?? '';
    const known = g.refresh.get(token);
    if (known !== undefined) known.revoked = true;
    return c.body(null, 200);
  });

  // ── Gmail ─────────────────────────────────────────────────────────────────────────────────
  const gmail = '/gmail/v1/users/me';
  app.use(`${gmail}/*`, async (c, next) => {
    if (!authorized(bearerOf(c)))
      return c.json(googleError(401, 'authError', 'Invalid Credentials'), 401);
    await next();
  });
  app.get(`${gmail}/profile`, (c) =>
    c.json({
      emailAddress: g.identity.email,
      messagesTotal: g.mailbox.messages.size,
      threadsTotal: new Set([...g.mailbox.messages.values()].map((m) => m.threadId)).size,
      historyId: String(g.mailbox.historyId),
    }),
  );
  app.get(`${gmail}/messages`, (c) => {
    const q = c.req.query('q') ?? '';
    let list = [...g.mailbox.messages.values()];
    const rfc = /rfc822msgid:(\S+)/.exec(q);
    if (rfc?.[1] !== undefined) {
      const wanted = rfc[1].replace(/[<>]/g, '');
      list = list.filter((m) => (headerOf(m, 'Message-ID') ?? '').replace(/[<>]/g, '') === wanted);
    } else {
      // The search operators the adapters use: in:inbox | in:sent, after:, before:, subject:"…".
      const label = /in:sent/.test(q) ? 'SENT' : /in:inbox/.test(q) ? 'INBOX' : null;
      list = list.filter((m) =>
        label === null
          ? m.labelIds.includes('INBOX') || m.labelIds.includes('SENT')
          : m.labelIds.includes(label),
      );
      const after = /after:(\d+)/.exec(q)?.[1];
      if (after !== undefined)
        list = list.filter((m) => Number(m.internalDate) >= Number(after) * 1000);
      const before = /before:(\d+)/.exec(q)?.[1];
      if (before !== undefined)
        list = list.filter((m) => Number(m.internalDate) < Number(before) * 1000);
      const subject = /subject:"([^"]*)"/.exec(q)?.[1];
      if (subject !== undefined)
        list = list.filter((m) => (headerOf(m, 'Subject') ?? '').includes(subject));
      if (/-category:promotions/.test(q))
        list = list.filter((m) => !m.labelIds.includes('CATEGORY_PROMOTIONS'));
    }
    list.sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
    const size = Math.min(Number(c.req.query('maxResults') ?? 100), g.mailbox.listPageSize);
    const offset = Number(c.req.query('pageToken') ?? 0);
    const page = list.slice(offset, offset + size);
    const next = offset + size < list.length ? String(offset + size) : undefined;
    return c.json({
      ...(page.length === 0
        ? {}
        : { messages: page.map((m) => ({ id: m.id, threadId: m.threadId })) }),
      ...(next === undefined ? {} : { nextPageToken: next }),
      resultSizeEstimate: list.length,
    });
  });
  app.get(`${gmail}/messages/:id/attachments/:aid`, (c) =>
    c.json({ size: 5, data: b64url('%PDF-') }),
  );
  app.get(`${gmail}/messages/:id`, (c) => {
    const message = g.mailbox.messages.get(c.req.param('id'));
    if (message === undefined)
      return c.json(googleError(404, 'notFound', 'Requested entity was not found.'), 404);
    const format = c.req.query('format') ?? 'full';
    if (format === 'metadata')
      return c.json(metadataView(message, c.req.queries('metadataHeaders') ?? []));
    return c.json(message);
  });
  app.get(`${gmail}/history`, (c) => {
    const start = Number(c.req.query('startHistoryId') ?? 0);
    if (start < g.mailbox.historyFloor) return c.json(fixture('gmail/history_404.json'), 404);
    const records = g.mailbox.history.filter((h) => Number(h.id) > start);
    const offset = Number(c.req.query('pageToken') ?? 0);
    const size = g.mailbox.historyPageSize;
    const page = records.slice(offset, offset + size);
    const next = offset + size < records.length ? String(offset + size) : undefined;
    return c.json({
      ...(page.length === 0 ? {} : { history: page }),
      ...(next === undefined ? {} : { nextPageToken: next }),
      historyId: String(g.mailbox.historyId),
    });
  });
  app.post(`${gmail}/watch`, (c) => {
    const body = jsonOf<{ topicName?: string }>(c);
    if (body.topicName !== Deno.env.get('GOOGLE_PUBSUB_TOPIC'))
      return c.json(googleError(400, 'invalidArgument', 'Invalid topicName'), 400);
    return c.json({
      historyId: String(g.mailbox.historyId),
      expiration: String(g.mailbox.watchExpirationMs ?? now() + 7 * 86_400_000),
    });
  });
  app.post(`${gmail}/stop`, (c) => c.body(null, 204));
  app.post(`${gmail}/messages/send`, (c) => {
    const body = jsonOf<{ raw?: string; threadId?: string }>(c);
    const parsed = parseRaw(body.raw ?? '');
    const id = randomId('18f');
    const message = addMessage(
      {
        id,
        threadId: body.threadId ?? id,
        labelIds: ['SENT'],
        snippet: parsed.body.slice(0, 100),
        internalDate: String(now()),
        sizeEstimate: parsed.body.length,
        payload: {
          partId: '',
          mimeType: 'text/plain',
          filename: '',
          headers: parsed.headers,
          body: { size: parsed.body.length, data: b64url(parsed.body) },
        },
      },
      true,
    );
    return c.json({ id: message.id, threadId: message.threadId, labelIds: message.labelIds });
  });

  // ── Calendar v3 ───────────────────────────────────────────────────────────────────────────
  const cal = '/calendar/v3';
  app.use(`${cal}/*`, async (c, next) => {
    if (!authorized(bearerOf(c)))
      return c.json(googleError(401, 'authError', 'Invalid Credentials'), 401);
    await next();
  });
  app.get(`${cal}/users/me/calendarList`, (c) =>
    c.json({
      kind: 'calendar#calendarList',
      items: g.calendars.map((x) => ({ kind: 'calendar#calendarListEntry', ...x })),
    }),
  );
  app.get(`${cal}/users/me/settings/timezone`, (c) =>
    c.json({ kind: 'calendar#setting', id: 'timezone', value: 'Europe/Istanbul' }),
  );
  const eventView = (e: GEvent) => {
    const { seq: _seq, ...rest } = e;
    return { kind: 'calendar#event', ...rest };
  };
  app.get(`${cal}/calendars/:cal/events`, (c) => {
    const map = g.events.get(c.req.param('cal')) ?? new Map<string, GEvent>();
    const syncToken = c.req.query('syncToken');
    let list = [...map.values()];
    if (syncToken !== undefined) {
      const since = Number(syncToken.replace(/^sync-/, ''));
      list = list.filter((e) => e.seq > since);
    } else {
      list = list.filter((e) => e.status !== 'cancelled');
      const marker = c.req.query('privateExtendedProperty');
      if (marker !== undefined) {
        const [key, value] = marker.split('=');
        list = list.filter(
          (e) =>
            ((e.extendedProperties as { private?: Record<string, string> } | undefined)?.private ??
              {})[key ?? ''] === value,
        );
      }
    }
    return c.json({
      kind: 'calendar#events',
      timeZone: 'Europe/Istanbul',
      items: list.map(eventView),
      nextSyncToken: `sync-${g.eventSeq}`,
    });
  });
  app.post(`${cal}/calendars/:cal/events/watch`, (c) => {
    const body = jsonOf<{ id?: string; token?: string }>(c);
    const resourceId = randomId('res');
    g.channels.set(String(body.id), {
      resourceId,
      calendarId: c.req.param('cal'),
      token: body.token ?? null,
    });
    return c.json({
      kind: 'api#channel',
      id: body.id,
      resourceId,
      resourceUri: `https://www.googleapis.com/calendar/v3/calendars/${c.req.param('cal')}/events`,
      token: body.token,
      expiration: String(now() + 7 * 86_400_000),
    });
  });
  app.get(`${cal}/calendars/:cal/events/:id`, (c) => {
    const e = g.events.get(c.req.param('cal'))?.get(c.req.param('id'));
    if (e === undefined) return c.json(googleError(404, 'notFound', 'Not Found'), 404);
    return c.json(eventView(e));
  });
  app.post(`${cal}/calendars/:cal/events`, (c) => {
    const body = jsonOf<Record<string, unknown>>(c);
    const map = g.events.get(c.req.param('cal')) ?? new Map<string, GEvent>();
    g.events.set(c.req.param('cal'), map);
    const id = String(body.id ?? randomId('evt'));
    if (map.has(id)) return c.json(fixture('gcal/insert_409_duplicate.json'), 409);
    const seq = ++g.eventSeq;
    const event: GEvent = {
      status: 'confirmed',
      ...body,
      id,
      etag: `"${3000000000000000 + seq}"`,
      updated: new Date(now()).toISOString(),
      htmlLink: `https://www.google.com/calendar/event?eid=${b64url(id)}`,
      seq,
    };
    map.set(id, event);
    return c.json(eventView(event));
  });
  app.patch(`${cal}/calendars/:cal/events/:id`, (c) => {
    const e = g.events.get(c.req.param('cal'))?.get(c.req.param('id'));
    if (e === undefined) return c.json(googleError(404, 'notFound', 'Not Found'), 404);
    const ifMatch = c.req.header('if-match');
    if (ifMatch !== undefined && ifMatch !== e.etag)
      return c.json(fixture('gcal/patch_412_etag.json'), 412);
    Object.assign(e, jsonOf(c));
    e.seq = ++g.eventSeq;
    e.etag = `"${3000000000000000 + e.seq}"`;
    e.updated = new Date(now()).toISOString();
    return c.json(eventView(e));
  });
  app.post(`${cal}/channels/stop`, (c) => {
    const body = jsonOf<{ id?: string }>(c);
    if (!g.channels.delete(String(body.id)))
      return c.json(googleError(404, 'notFound', 'Channel not found'), 404);
    return c.body(null, 204);
  });

  // ── Tasks v1 ──────────────────────────────────────────────────────────────────────────────
  const tasks = '/tasks/v1';
  app.use(`${tasks}/*`, async (c, next) => {
    if (!authorized(bearerOf(c)))
      return c.json(googleError(401, 'authError', 'Invalid Credentials'), 401);
    await next();
  });
  app.get(`${tasks}/users/@me/lists`, (c) =>
    c.json({
      kind: 'tasks#taskLists',
      items: g.taskLists.map((l) => ({ kind: 'tasks#taskList', ...l })),
    }),
  );
  app.get(`${tasks}/lists/:list/tasks`, (c) => {
    const map = g.tasks.get(c.req.param('list')) ?? new Map();
    const updatedMin = c.req.query('updatedMin');
    const items = [...map.values()].filter(
      (t) => updatedMin === undefined || Date.parse(String(t.updated)) >= Date.parse(updatedMin),
    );
    return c.json({ kind: 'tasks#tasks', items });
  });
  app.post(`${tasks}/lists/:list/tasks`, (c) => {
    const body = jsonOf<Record<string, unknown>>(c);
    const map = g.tasks.get(c.req.param('list')) ?? new Map();
    g.tasks.set(c.req.param('list'), map);
    const id = randomId('task');
    const task = {
      kind: 'tasks#task',
      status: 'needsAction',
      ...body,
      id,
      updated: new Date(now()).toISOString(),
      webViewLink: `https://tasks.google.com/task/${id}`,
    };
    map.set(id, task);
    return c.json(task);
  });
}

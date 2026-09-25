/**
 * Tier C+ API gateway (TEST_PLAN §15): the stand-in for Kong in front of the local PostgREST, so the
 * Edge Function code talks to `SUPABASE_URL` exactly as on the real stack.
 *
 * - `/rest/v1/*` → PostgREST (prefix stripped; method, headers and body forwarded);
 * - `GET /auth/v1/user` → the GoTrue `getUser` contract for HS256 tokens (supabase-js `getClaims`
 *   uses it for symmetric keys): the signature and expiry are verified with the local JWT secret;
 * - `GET /auth/v1/.well-known/jwks.json` → an empty key set (symmetric signing);
 * - `POST /functions/v1/*` → 202 (worker pokes; the suites drive the worker themselves);
 * - anything else (the rest of GoTrue, Storage) → 501, which is why suites tagged `needs:gotrue` /
 *   `needs:storage` run only in tier A.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { verifyHs256 } from './lib.ts';

export interface Gateway {
  readonly url: string;
  close(): Promise<void>;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'content-encoding',
  'host',
  'upgrade',
]);

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

async function proxy(req: IncomingMessage, res: ServerResponse, target: string): Promise<void> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || HOP_BY_HOP.has(key.toLowerCase())) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
  const upstream = await fetch(target, {
    method: req.method ?? 'GET',
    headers,
    ...(body === undefined || body.length === 0 ? {} : { body }),
  });
  const out: Record<string, string> = {};
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out[key] = value;
  });
  const buffer = Buffer.from(await upstream.arrayBuffer());
  out['content-length'] = String(buffer.length);
  res.writeHead(upstream.status, out);
  res.end(buffer);
}

export function startGateway(options: {
  readonly port: number;
  readonly postgrestUrl: string;
  readonly jwtSecret: string;
}): Promise<Gateway> {
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://gateway.local');
    const path = url.pathname;
    if (path.startsWith('/rest/v1/') || path === '/rest/v1') {
      const rest = path.slice('/rest/v1'.length) || '/';
      await proxy(req, res, `${options.postgrestUrl}${rest}${url.search}`);
      return;
    }
    if (path === '/auth/v1/user' && req.method === 'GET') {
      const token = bearer(req);
      const claims = token === null ? null : verifyHs256(token, options.jwtSecret);
      if (claims === null || typeof claims.sub !== 'string') {
        sendJson(res, 403, { code: 403, error_code: 'bad_jwt', msg: 'invalid JWT' });
        return;
      }
      sendJson(res, 200, {
        id: claims.sub,
        aud: claims.aud ?? 'authenticated',
        role: claims.role ?? 'authenticated',
        email: claims.email ?? null,
        app_metadata: claims.app_metadata ?? {},
        user_metadata: claims.user_metadata ?? {},
        is_anonymous: claims.is_anonymous === true,
        created_at: new Date(0).toISOString(),
      });
      return;
    }
    if (path === '/auth/v1/.well-known/jwks.json') {
      sendJson(res, 200, { keys: [] });
      return;
    }
    if (path.startsWith('/functions/v1/') && req.method === 'POST') {
      await readBody(req);
      sendJson(res, 202, { accepted: true });
      return;
    }
    sendJson(res, 501, { error: 'not_available_in_tier_c', path });
  };
  const server: Server = createServer((req, res) => {
    handler(req, res).catch((error: unknown) => {
      sendJson(res, 502, { error: 'gateway_error', message: String(error) });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${options.port}`,
        close: () =>
          new Promise((done) => {
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}

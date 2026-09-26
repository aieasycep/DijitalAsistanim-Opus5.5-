/**
 * Maestro E2E harness (TEST_PLAN §9.1; T-8.30 / T-12.02). A loopback HTTP server the Maestro host
 * reaches through `apps/mobile/.maestro/scripts/harness.js` (`runScript`); the secret key never
 * reaches the app. CI only: it refuses to start unless `APP_ENV ∈ {e2e, development}` and the Supabase host
 * is loopback. `E2E_TARGET=staging` exposes `/seed`, `/otp` and `/state` only.
 *
 *   POST /seed {userKey, scenario}   reset + seed one user → {user, ids, expect, t}
 *   POST /otp {email}                the newest 6-digit code from the local Auth mail sink
 *   POST /tick {p_now}               select private.scheduler_tick(p_now)
 *   POST /drain {types?}             poke `worker` until the listed job types are empty
 *   POST /revenuecat/activate        {userKey, product} → the user's auth id (the RevenueCat app user
 *                                    id) to the mock's `/revenuecat/__activate`: REST v2 "active"
 *   POST /android/share-pdf          adb push + ACTION_SEND of the synthetic PDF (E2E-S-08)
 *   GET  /state?user=&probe=         read-only probes from `probes.ts`
 *
 * Seeding: the canon users are the demo dataset's (`pnpm db:seed:demo`, idempotent: re-running
 * resets their content for the anchor day); other keys get a confirmed Auth user through the GoTrue
 * Admin API. Scenarios other than `canon` / `canon_send_granted` need `e2e.seed_user` from
 * `supabase/seed/e2e/functions.sql` (TEST_PLAN §12.2); without it `/seed` answers 501 so the flow
 * fails visibly instead of running against the wrong data.
 *
 * Env: SUPABASE_URL, SUPABASE_SECRET_KEY, DA_E2E_DB_URL (psql), CRON_SECRET, DA_FIXED_NOW,
 * E2E_RUN_ID, INBUCKET_URL (default http://127.0.0.1:54324), HARNESS_PORT (default 8790),
 * REVENUECAT_MOCK_URL (the mock provider server's `/revenuecat`, loopback or a private address such
 * as the Docker bridge gateway; default http://127.0.0.1:8788/revenuecat), ANDROID_SERIAL (adb).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROBES, type ProbeName } from './probes.ts';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_ANCHOR = '2026-09-22T05:45:00Z';
export const E2E_DOMAIN = 'e2e.dijitalasistan.test';

type Env = Readonly<Record<string, string | undefined>>;

const LOOPBACK: readonly string[] = ['127.0.0.1', 'localhost', '::1', '[::1]'];

/** Loopback or a private IPv4 address (e.g. the Docker bridge gateway): never beyond the runner. */
function isRunnerLocal(host: string): boolean {
  if (LOOPBACK.includes(host)) return true;
  const octets = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (octets === null) return false;
  const [a, b] = [Number(octets[1]), Number(octets[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Refuses anything but a local / CI stack on loopback (TEST_PLAN §9.1; APP_ENV per @da/validation). */
export function assertSafeEnv(env: Env): { staging: boolean } {
  const staging = env.E2E_TARGET === 'staging';
  if (staging) return { staging };
  if (env.APP_ENV !== 'e2e' && env.APP_ENV !== 'development') {
    throw new Error('harness: APP_ENV must be e2e or development');
  }
  const host = new URL(env.SUPABASE_URL ?? 'http://invalid').hostname;
  if (!LOOPBACK.includes(host)) {
    throw new Error('harness: SUPABASE_URL must be a loopback address');
  }
  if ((env.SUPABASE_SECRET_KEY ?? '') === '')
    throw new Error('harness: SUPABASE_SECRET_KEY is required');
  const mock = env.REVENUECAT_MOCK_URL;
  if (mock !== undefined && !(URL.canParse(mock) && isRunnerLocal(new URL(mock).hostname))) {
    throw new Error('harness: REVENUECAT_MOCK_URL must be a loopback or private address');
  }
  return { staging };
}

/** The mock store's activation call; the RevenueCat app user id is the auth user id. */
export function activationRequest(
  env: Env,
  appUserId: string,
  product: string,
): { url: string; body: string } {
  const mock = (env.REVENUECAT_MOCK_URL ?? 'http://127.0.0.1:8788/revenuecat').replace(/\/+$/, '');
  return { url: `${mock}/__activate`, body: JSON.stringify({ app_user_id: appUserId, product }) };
}

/** md5('da-demo:' || entity || ':' || slug)::uuid — the demo dataset's deterministic ids. */
export function demoId(entity: string, slug: string): string {
  const hex = createHash('md5').update(`da-demo:${entity}:${slug}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The ids flows use in deep links and probes (TEST_PLAN §9 `${output.ids.*}`). */
export function canonIds(): Record<string, string> {
  return {
    messageAhmet: demoId('message', 'revize-teklif'),
    messageMehmet: demoId('message', 're-teklif'),
    messageSecurity: demoId('message', 'google-security'),
    messageBill: demoId('message', 'elektrik-faturasi'),
    threadAhmet: demoId('thread', 'revize-teklif'),
    meetingEvent: demoId('event', 'musteri-toplantisi'),
    briefingMorning: demoId('briefing', 'morning-today'),
    weekly: demoId('briefing', 'weekly-last'),
    draftAhmet: demoId('reply_draft', 'ahmet'),
    approvalReply: demoId('approval', 'reply-ahmet'),
    approvalCalendar: demoId('approval', 'teklif-hazirlama'),
    contactAhmet: demoId('contact', 'ahmet'),
    contactMehmet: demoId('contact', 'mehmet'),
    contactSelin: demoId('contact', 'selin'),
  };
}

const CANON_USERS: Readonly<Record<string, string>> = {
  u_pro: 'demo@dijitalasistan.app',
  u_free: 'demo-free@dijitalasistan.app',
};
const PER_RUN_KEYS = new Set(['u_new', 'u_delete']);

/** TEST_PLAN §12.3: the address of a user key (`new+<runId>`, `free`, …). */
export function emailFor(userKey: string, runId: string): string {
  const canon = CANON_USERS[userKey];
  if (canon !== undefined) return canon;
  const name = userKey.replace(/^u_/, '').replace(/_/g, '');
  return PER_RUN_KEYS.has(userKey) ? `${name}+${runId}@${E2E_DOMAIN}` : `${name}@${E2E_DOMAIN}`;
}

/** Local HH:mm in Europe/Istanbul. */
function istanbulTime(date: Date): string {
  return new Intl.DateTimeFormat('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Istanbul',
  }).format(date);
}

/**
 * Expected strings for the anchor (TEST_PLAN §9 `${output.expect.*}`): the reminder preset times
 * for Ahmet's 17:00 deadline come from `@da/domain`, so flows never hard-code the clock.
 */
export async function canonExpect(anchorIso: string): Promise<Record<string, string>> {
  const { resolveAllPresets } = await import('../../packages/domain/src/index.ts');
  const now = new Date(anchorIso);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(now);
  const deadline = new Date(`${day}T17:00:00+03:00`);
  const presets: Record<string, string> = {};
  for (const r of resolveAllPresets({ now, timeZone: 'Europe/Istanbul', anchorAt: deadline })) {
    if (r.fireAt !== null) presets[r.preset] = istanbulTime(r.fireAt);
  }
  return {
    anchorTime: istanbulTime(now),
    deadlineTime: istanbulTime(deadline),
    ...Object.fromEntries(Object.entries(presets).map(([k, v]) => [`preset_${k}`, v])),
  };
}

/** The Turkish catalog as a nested object (`${output.t.<ns>.<key>}` in flows). */
export function trCatalog(): Record<string, unknown> {
  const dir = join(ROOT, 'packages', 'i18n', 'messages', 'tr');
  const out: Record<string, unknown> = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    out[file.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown;
  }
  return out;
}

// ── Stack access ─────────────────────────────────────────────────────────────────────────────

/** Runs SQL through stdin so `:'p1'`… interpolate as quoted literals (psql skips that for `-c`). */
function psql(env: Env, sql: string, params: readonly string[] = []): string {
  const url = env.DA_E2E_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  const args = [url, '-v', 'ON_ERROR_STOP=1', '-q', '-At', '-f', '-'];
  params.forEach((value, index) => args.push('-v', `p${String(index + 1)}=${value}`));
  return execFileSync('psql', args, { encoding: 'utf8', input: `${sql};\n` }).trim();
}

async function admin(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const key = env.SUPABASE_SECRET_KEY ?? '';
  return fetch(`${env.SUPABASE_URL ?? ''}${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

/** The auth user id of an address, or '' when there is no such user. */
function userIdFor(env: Env, email: string): string {
  return psql(env, "select id from auth.users where lower(email) = lower(:'p1')", [email]);
}

async function ensureUser(env: Env, email: string): Promise<string> {
  const found = userIdFor(env, email);
  if (found !== '') return found;
  const res = await admin(env, '/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      email_confirm: true,
      user_metadata: { timezone: 'Europe/Istanbul' },
    }),
  });
  if (!res.ok) throw new Error(`harness: createUser ${String(res.status)}`);
  return ((await res.json()) as { id: string }).id;
}

async function seed(env: Env, body: { userKey?: string; scenario?: string }, staging: boolean) {
  const userKey = body.userKey ?? 'u_pro';
  const scenario = body.scenario ?? 'canon';
  const runId = env.E2E_RUN_ID ?? 'local';
  const email = emailFor(userKey, runId);
  const anchor = env.DA_FIXED_NOW ?? DEFAULT_ANCHOR;
  if (staging) {
    // The staging E2E project carries the demo canon already (real clock); nothing is reset.
    if (CANON_USERS[userKey] === undefined) {
      return { status: 501, body: { error: 'scenario_unavailable', scenario } };
    }
    return {
      status: 200,
      body: {
        user: { key: userKey, email, id: null },
        ids: canonIds(),
        expect: await canonExpect(new Date().toISOString()),
        t: trCatalog(),
      },
    };
  }
  if (
    CANON_USERS[userKey] !== undefined &&
    (scenario === 'canon' || scenario === 'canon_send_granted')
  ) {
    execFileSync('bash', [join(ROOT, 'scripts', 'db', 'seed-demo.sh')], {
      env: { ...process.env, DEMO_MODE: 'true', DEMO_DB_URL: env.DA_E2E_DB_URL ?? '' },
      stdio: 'inherit',
    });
  }
  const id = await ensureUser(env, email);
  if (!(CANON_USERS[userKey] !== undefined && scenario.startsWith('canon'))) {
    const functions = join(ROOT, 'supabase', 'seed', 'e2e', 'functions.sql');
    if (!existsSync(functions) && scenario !== 'none') {
      return { status: 501, body: { error: 'scenario_unavailable', scenario } };
    }
    if (existsSync(functions)) {
      psql(env, readFileSync(functions, 'utf8'));
      psql(env, "select e2e.seed_user(:'p1'::uuid, :'p2', :'p3'::timestamptz)", [
        id,
        scenario,
        anchor,
      ]);
    }
  }
  return {
    status: 200,
    body: {
      user: { key: userKey, email, id },
      ids: canonIds(),
      expect: await canonExpect(anchor),
      t: trCatalog(),
    },
  };
}

/** Mailpit (`/api/v1/messages`) or Inbucket (`/api/v1/mailbox/<name>`), probed in that order. */
async function otp(env: Env, email: string, staging: boolean): Promise<string> {
  if (staging) {
    const res = await admin(env, '/auth/v1/admin/generate_link', {
      method: 'POST',
      body: JSON.stringify({ type: 'magiclink', email }),
    });
    const link = (await res.json()) as { properties?: { email_otp?: string }; email_otp?: string };
    return link.properties?.email_otp ?? link.email_otp ?? '';
  }
  const base = env.INBUCKET_URL ?? 'http://127.0.0.1:54324';
  const code = (text: string) => /\b(\d{6})\b/.exec(text)?.[1] ?? '';
  const mailpit = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
  if (mailpit.ok) {
    const list = (await mailpit.json()) as { messages?: { ID: string }[] };
    const first = list.messages?.[0];
    if (first !== undefined) {
      const message = (await (await fetch(`${base}/api/v1/message/${first.ID}`)).json()) as {
        Text?: string;
      };
      return code(message.Text ?? '');
    }
  }
  const box = email.split('@')[0] ?? email;
  const inbucket = await fetch(`${base}/api/v1/mailbox/${encodeURIComponent(box)}`);
  if (!inbucket.ok) return '';
  const headers = (await inbucket.json()) as { id: string }[];
  const last = headers.at(-1);
  if (last === undefined) return '';
  const message = (await (
    await fetch(`${base}/api/v1/mailbox/${encodeURIComponent(box)}/${last.id}`)
  ).json()) as {
    body?: { text?: string };
  };
  return code(message.body?.text ?? '');
}

async function drain(env: Env, types: readonly string[]): Promise<number> {
  const inList = types.map((t) => `'${t.replace(/[^a-z0-9_]/g, '')}'`).join(',');
  const pending = () =>
    Number(
      psql(
        env,
        `select count(*) from public.jobs where status in ('queued','running','retrying')${
          types.length > 0 ? ` and type in (${inList})` : ''
        }`,
      ) || '0',
    );
  for (let round = 0; round < 60; round += 1) {
    if (pending() === 0) return round;
    await fetch(`${env.SUPABASE_URL ?? ''}/functions/v1/worker`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.CRON_SECRET ?? ''}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('harness: drain timed out');
}

function state(env: Env, userEmail: string, probe: string) {
  const [name, arg = ''] = probe.split(':');
  if (name === undefined || !Object.hasOwn(PROBES, name)) {
    return { status: 400, body: { error: 'unknown_probe', probe } };
  }
  const query = PROBES[name as ProbeName];
  const raw = psql(env, query, [userEmail, arg]);
  return { status: 200, body: raw === '' ? {} : (JSON.parse(raw) as unknown) };
}

// ── Server ───────────────────────────────────────────────────────────────────────────────────

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

interface Reply {
  readonly status: number;
  readonly body: unknown;
}

async function handle(
  env: Env,
  staging: boolean,
  route: string,
  url: URL,
  body: Record<string, unknown>,
): Promise<Reply> {
  switch (route) {
    case 'POST /seed':
      return seed(
        env,
        { userKey: text(body.userKey) || 'u_pro', scenario: text(body.scenario) || 'canon' },
        staging,
      );
    case 'POST /otp':
      return { status: 200, body: { code: await otp(env, text(body.email), staging) } };
    case 'POST /tick':
      return {
        status: 200,
        body: {
          result: psql(env, "select private.scheduler_tick(:'p1'::timestamptz)", [
            text(body.p_now),
          ]),
        },
      };
    case 'POST /drain': {
      const types = Array.isArray(body.types) ? body.types.map(text).filter((t) => t !== '') : [];
      return { status: 200, body: { rounds: await drain(env, types) } };
    }
    case 'POST /revenuecat/activate': {
      const userKey = text(body.userKey);
      const product = text(body.product);
      if (userKey === '' || product === '')
        return { status: 400, body: { error: 'userKey_and_product_required' } };
      const appUserId = userIdFor(env, emailFor(userKey, env.E2E_RUN_ID ?? 'local'));
      if (appUserId === '') return { status: 404, body: { error: 'unknown_user', userKey } };
      const call = activationRequest(env, appUserId, product);
      const r = await fetch(call.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: call.body,
      });
      await r.body?.cancel();
      return { status: r.status, body: { ok: r.ok, app_user_id: appUserId } };
    }
    case 'POST /android/share-pdf': {
      const pdf = resolve(ROOT, 'apps', 'mobile', '.maestro', 'assets', 'Hizmet_Sozlesmesi_v3.pdf');
      const target = '/sdcard/Download/Hizmet_Sozlesmesi_v3.pdf';
      const serial = env.ANDROID_SERIAL === undefined ? [] : ['-s', env.ANDROID_SERIAL];
      execFileSync('adb', [...serial, 'push', pdf, target]);
      execFileSync('adb', [
        ...serial,
        'shell',
        `am start -a android.intent.action.SEND -t application/pdf --eu android.intent.extra.STREAM file://${target}`,
      ]);
      return { status: 200, body: { ok: true } };
    }
    case 'GET /state':
      return state(
        env,
        emailFor(url.searchParams.get('user') ?? '', env.E2E_RUN_ID ?? 'local'),
        url.searchParams.get('probe') ?? '',
      );
    default:
      return { status: 404, body: { error: 'not_found' } };
  }
}

const STAGING_ROUTES: ReadonlySet<string> = new Set(['POST /seed', 'POST /otp', 'GET /state']);

export function startHarness(env: Env = process.env) {
  const { staging } = assertSafeEnv(env);
  const port = Number(env.HARNESS_PORT ?? '8790');
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const route = `${req.method ?? 'GET'} ${url.pathname}`;
    const reply = async (): Promise<Reply> => {
      if (staging && !STAGING_ROUTES.has(route))
        return { status: 404, body: { error: 'staging_mode' } };
      const body = req.method === 'POST' ? await readJson(req) : {};
      return handle(env, staging, route, url, body);
    };
    reply().then(
      (out) => {
        send(res, out.status, out.body);
      },
      (error: unknown) => {
        send(res, 500, { error: error instanceof Error ? error.message : 'harness_error' });
      },
    );
  });
  server.listen(port, '127.0.0.1');
  return server;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startHarness();
  console.info(`harness: listening on 127.0.0.1:${process.env.HARNESS_PORT ?? '8790'}`);
}

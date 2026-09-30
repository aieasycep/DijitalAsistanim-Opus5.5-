/**
 * Tier-A end users through the real Auth server of the local stack (TEST_PLAN §6).
 *
 * Tier C+ has no Auth server: `mod.ts` writes `auth.users` / `auth.sessions` and mints HS256 tokens
 * with the run-scoped secret, and the node gateway implements the `getUser` contract. The real stack
 * issues its own tokens (the local CLI stack signs them with its asymmetric key; `getClaims` checks
 * them against the JWKS, `getUser` also needs the user and the session behind `session_id`), so
 * tier A creates every user with the Auth admin API (service / secret key), signs in with the
 * password grant and re-issues tokens with the refresh-token grant:
 *
 * - `jwt` carries a stale `amr` (the session's AMR claim is back-dated before a refresh): the tier-C
 *   default of "no recent sign-in", so `recent_auth` routes answer `REAUTH_REQUIRED`;
 * - `token({amr})` moves the claim to the newest requested timestamp and refreshes; any other custom
 *   claim cannot come from a real Auth server and throws.
 *
 * A failed Auth call throws with the step, the HTTP status and the error body (JWT-shaped values and
 * API keys redacted); keys, passwords and tokens are never printed.
 */

type Sql = (text: string, params?: unknown[]) => Promise<unknown[]>;

export interface AuthUser {
  readonly id: string;
  readonly sessionId: string;
  readonly jwt: string;
  token(extra?: Record<string, unknown>): Promise<string>;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
}

/** 30 days before now: older than every `recent_auth` window. */
const staleAt = () => Math.floor(Date.now() / 1000) - 30 * 86_400;

function need(key: string): string {
  const value = Deno.env.get(key);
  if (value === undefined || value === '')
    throw new Error(`${key} is not set: run the suites through scripts/integration/run.ts`);
  return value;
}

const authUrl = (path: string) => `${need('SUPABASE_URL').replace(/\/+$/, '')}/auth/v1${path}`;

function redact(text: string): string {
  return text
    .replace(/eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '<jwt>')
    .replace(/\bsb_(secret|publishable)_[A-Za-z0-9_-]+/g, 'sb_$1_<redacted>');
}

async function failure(step: string, res: Response): Promise<Error> {
  const body = redact(await res.text().catch(() => '')).slice(0, 600);
  return new Error(`tier-A Auth ${step} failed: HTTP ${res.status} ${body}`);
}

/**
 * One Auth request; a 429 is retried with back-off. `supabase/config.toml` keeps the production
 * limits (`token_refresh` 150 and `sign_in_sign_ups` 30 per 5 minutes per IP), and a full tier-A run
 * makes about two `/token` calls per user (password grant, then the stale-AMR refresh), so the later
 * users can meet the refill rate: waiting up to about two minutes only slows the run down.
 */
async function authFetch(path: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(authUrl(path), init);
    if (res.status !== 429 || attempt >= 24) return res;
    await res.body?.cancel();
    const after = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(after) && after > 0 ? after * 1000 : 500 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, Math.min(wait, 5_000)));
  }
}

function payload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1] ?? '';
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as Record<string, unknown>;
}

function header(jwt: string): Record<string, unknown> {
  return payload(`.${jwt.split('.')[0] ?? ''}`);
}

/**
 * Admin credentials, in order: the legacy service-role JWT (apikey + bearer), then the `sb_secret_`
 * key alone (the API gateway turns it into a service-role bearer). The first one Auth accepts is kept.
 */
function adminCandidates(): { label: string; headers: Record<string, string> }[] {
  const out: { label: string; headers: Record<string, string> }[] = [];
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (service !== '')
    out.push({
      label: 'service_role key',
      headers: { apikey: service, Authorization: `Bearer ${service}` },
    });
  const secret = Deno.env.get('DA_IT_SECRET_KEY') ?? '';
  if (secret !== '') out.push({ label: 'secret key', headers: { apikey: secret } });
  if (out.length === 0)
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set: run the suites through run.ts');
  return out;
}

let adminChoice: number | null = null;

async function adminCreateUser(body: Record<string, unknown>): Promise<{ id: string }> {
  const candidates = adminCandidates();
  const order = adminChoice === null ? candidates.map((_, i) => i) : [adminChoice];
  const errors: string[] = [];
  for (const i of order) {
    const candidate = candidates[i];
    if (candidate === undefined) continue;
    const res = await authFetch('/admin/users', {
      method: 'POST',
      headers: { ...candidate.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      adminChoice = i;
      const user = (await res.json()) as { id?: string; user?: { id?: string } };
      const id = user.id ?? user.user?.id;
      if (typeof id !== 'string') throw new Error('tier-A Auth admin create returned no user id');
      return { id };
    }
    const error = await failure(
      `admin create user (POST /auth/v1/admin/users, ${candidate.label})`,
      res,
    );
    if (res.status !== 401 && res.status !== 403) throw error;
    errors.push(error.message);
  }
  throw new Error(errors.join('\n'));
}

async function grant(
  type: 'password' | 'refresh_token',
  body: Record<string, string>,
): Promise<{ access: string; refresh: string }> {
  const anon = need('SUPABASE_ANON_KEY');
  const res = await authFetch(`/token?grant_type=${type}`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await failure(`${type} grant (POST /auth/v1/token)`, res);
  const out = (await res.json()) as TokenResponse;
  if (typeof out.access_token !== 'string' || typeof out.refresh_token !== 'string')
    throw new Error(`tier-A Auth ${type} grant returned no access / refresh token`);
  return { access: out.access_token, refresh: out.refresh_token };
}

let checked = false;

/** Once per run: Auth itself accepts the issued token (`getUser`) and it carries a session. */
async function checkOnce(jwt: string): Promise<void> {
  if (checked) return;
  const res = await fetch(authUrl('/user'), {
    headers: { apikey: need('SUPABASE_ANON_KEY'), Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw await failure('user check (GET /auth/v1/user with the issued token)', res);
  await res.body?.cancel();
  const h = header(jwt);
  const kid = h.kid === undefined ? '' : `, kid ${String(h.kid)}`;
  Deno.stderr.writeSync(
    new TextEncoder().encode(
      `tier-A Auth: admin-API users, password-grant sessions (alg ${String(h.alg)}${kid})\n`,
    ),
  );
  checked = true;
}

function latestAmr(amr: unknown): number | null {
  if (!Array.isArray(amr)) return null;
  const ts = amr
    .map((a) => (a as { timestamp?: unknown }).timestamp)
    .filter((t): t is number => typeof t === 'number');
  return ts.length === 0 ? null : Math.max(...ts);
}

/** A confirmed Auth user (admin API) with a real session and access tokens (see the module doc). */
export async function createAuthUser(
  sql: Sql,
  options: { email: string; timezone: string },
): Promise<AuthUser> {
  const password = `It-${crypto.randomUUID()}-Aa1!`;
  const { id } = await adminCreateUser({
    email: options.email,
    password,
    email_confirm: true,
    user_metadata: { timezone: options.timezone },
    app_metadata: { provider: 'apple', providers: ['apple'] },
  });
  const signIn = await grant('password', { email: options.email, password });
  await checkOnce(signIn.access);
  const sessionId = payload(signIn.access).session_id;
  if (typeof sessionId !== 'string')
    throw new Error('tier-A Auth password grant issued a token without session_id');
  let refresh = signIn.refresh;
  let queue: Promise<unknown> = Promise.resolve();

  /** Moves the session's AMR claim to `at` (unix seconds) and refreshes: `amr[0].timestamp = at`. */
  const issue = (at: number): Promise<string> => {
    const next = queue.then(async () => {
      const rows = await sql(
        `update auth.mfa_amr_claims set created_at = to_timestamp($2), updated_at = to_timestamp($2)
         where session_id = $1::uuid returning id`,
        [sessionId, at],
      );
      if (rows.length === 0)
        throw new Error(`tier-A Auth: no auth.mfa_amr_claims row for the new session`);
      const out = await grant('refresh_token', { refresh_token: refresh });
      refresh = out.refresh;
      const amr = latestAmr(payload(out.access).amr);
      if (amr === null || Math.abs(amr - at) > 1)
        throw new Error(
          `tier-A Auth: the refreshed token's amr timestamp (${String(amr)}) does not follow auth.mfa_amr_claims (${at})`,
        );
      return out.access;
    });
    queue = next.catch(() => undefined);
    return next;
  };

  const jwt = await issue(staleAt());
  return {
    id,
    sessionId,
    jwt,
    token(extra = {}) {
      const custom = Object.keys(extra).filter((k) => k !== 'amr' && k !== 'email');
      if (custom.length > 0)
        return Promise.reject(
          new Error(
            `tier A uses real Auth tokens: the custom claims ${custom.join(', ')} cannot be issued`,
          ),
        );
      return issue(latestAmr(extra.amr) ?? staleAt());
    },
  };
}

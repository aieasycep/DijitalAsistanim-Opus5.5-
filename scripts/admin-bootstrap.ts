/**
 * First super_admin bootstrap (BACKOFFICE_PLAN §3.11). **Manual external step**: the owner runs it
 * once, from a local shell or a protected CI job, with the Supabase secret key of the target
 * project. The backoffice never holds that key and never runs this script.
 *
 *   pnpm admin:bootstrap --email owner@company.com --name "Ad Soyad"
 *
 * Environment: SUPABASE_URL, SUPABASE_SECRET_KEY, ADMIN_ORIGIN; ADMIN_ALLOWED_EMAIL_DOMAINS
 * (optional, comma separated) restricts the email domain like `POST /admins/invite` does.
 *
 * It refuses to run while an active super_admin exists. Otherwise it creates the dedicated admin
 * identity (`app_metadata.da_kind = 'admin'`, R-08) and the `admin_users` row (`super_admin`,
 * `invited`, `invite_token_hash = SHA-256(token)`, 72 h), audits `admin.bootstrap` with
 * `actor_type = 'system'`, and prints the one-time `${ADMIN_ORIGIN}/invite?token=…` link. Re-running
 * before the invite is accepted replaces the link (the old one stops working). The secret key is
 * never printed; errors carry codes and key names only.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class BootstrapError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'BootstrapError';
    this.code = code;
  }
}

export interface BootstrapArgs {
  readonly email: string;
  readonly name: string;
}

export interface BootstrapEnv {
  readonly supabaseUrl: string;
  readonly secretKey: string;
  readonly adminOrigin: string;
  readonly allowedDomains: readonly string[];
}

export interface BootstrapDeps {
  readonly fetch: typeof fetch;
  readonly now: () => Date;
  /** 32 random bytes, base64url (43 chars, the `InviteRedeemBody` token shape). */
  readonly inviteToken: () => string;
  readonly uuid: () => string;
}

export interface BootstrapResult {
  readonly userId: string;
  readonly inviteUrl: string;
  readonly expiresAt: string;
  readonly reissued: boolean;
}

export const USAGE = 'Usage: pnpm admin:bootstrap --email <owner@company> --name "<Ad Soyad>"';

export function parseBootstrapArgs(argv: readonly string[]): BootstrapArgs {
  let values: { email?: string; name?: string };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: { email: { type: 'string' }, name: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new BootstrapError('usage', USAGE);
  }
  const email = values.email?.trim().toLowerCase() ?? '';
  const name = values.name?.trim() ?? '';
  if (!EMAIL.test(email))
    throw new BootstrapError('usage', `--email must be an email address. ${USAGE}`);
  if (name.length < 1 || name.length > 80) {
    throw new BootstrapError('usage', `--name must be 1–80 characters. ${USAGE}`);
  }
  return { email, name };
}

export function readBootstrapEnv(env: Readonly<Record<string, string | undefined>>): BootstrapEnv {
  const missing = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'ADMIN_ORIGIN'].filter(
    (key) => (env[key] ?? '').trim() === '',
  );
  if (missing.length > 0)
    throw new BootstrapError('env_missing', `Missing environment: ${missing.join(', ')}`);
  const supabaseUrl = (env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const adminOrigin = (env.ADMIN_ORIGIN ?? '').trim();
  const invalid: string[] = [];
  if (!URL.canParse(supabaseUrl)) invalid.push('SUPABASE_URL');
  if (!URL.canParse(adminOrigin)) invalid.push('ADMIN_ORIGIN');
  if (invalid.length > 0)
    throw new BootstrapError('env_invalid', `Invalid environment: ${invalid.join(', ')}`);
  return {
    supabaseUrl,
    secretKey: (env.SUPABASE_SECRET_KEY ?? '').trim(),
    adminOrigin: new URL(adminOrigin).origin,
    allowedDomains: (env.ADMIN_ALLOWED_EMAIL_DOMAINS ?? '')
      .split(',')
      .map((domain) => domain.trim().toLowerCase())
      .filter((domain) => domain !== ''),
  };
}

export function inviteTokenHash(token: string): string {
  return `\\x${createHash('sha256').update(token, 'utf8').digest('hex')}`;
}

interface Row {
  user_id: string;
  role: string;
  status: string;
}

function fail(step: string, status: number, json: unknown): never {
  const detail =
    json !== null && typeof json === 'object'
      ? ['code', 'error_code', 'message', 'msg']
          .map((key) => (json as Record<string, unknown>)[key])
          .filter((value): value is string => typeof value === 'string')
          .join(' · ')
      : '';
  throw new BootstrapError(
    step,
    `${step} failed (HTTP ${String(status)})${detail === '' ? '' : `: ${detail}`}`,
  );
}

function client(env: BootstrapEnv, deps: BootstrapDeps) {
  const headers = {
    apikey: env.secretKey,
    authorization: `Bearer ${env.secretKey}`,
    'content-type': 'application/json',
  };
  async function request(
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) {
    let response: Response;
    try {
      response = await deps.fetch(`${env.supabaseUrl}${path}`, {
        method,
        headers: { ...headers, ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
      });
    } catch {
      throw new BootstrapError(
        'network',
        `Supabase is unreachable (${method} ${path.split('?')[0] ?? path})`,
      );
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text === '' ? null : JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, ok: response.ok, json };
  }
  return request;
}

/** Runs the bootstrap against Supabase Auth (admin API) and PostgREST with the secret key. */
export async function bootstrap(
  args: BootstrapArgs,
  env: BootstrapEnv,
  deps: BootstrapDeps,
): Promise<BootstrapResult> {
  const domain = args.email.split('@')[1] ?? '';
  if (env.allowedDomains.length > 0 && !env.allowedDomains.includes(domain)) {
    throw new BootstrapError(
      'domain_not_allowed',
      'The email domain is not in ADMIN_ALLOWED_EMAIL_DOMAINS.',
    );
  }
  const request = client(env, deps);

  const active = await request(
    'GET',
    '/rest/v1/admin_users?select=user_id&role=eq.super_admin&status=eq.active&limit=1',
  );
  if (!active.ok || !Array.isArray(active.json))
    fail('check_super_admin', active.status, active.json);
  if (active.json.length > 0) {
    throw new BootstrapError(
      'active_super_admin_exists',
      'An active super_admin already exists: invite further admins from the backoffice (Adminler).',
    );
  }

  const token = deps.inviteToken();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new BootstrapError('token', 'Invite token has the wrong shape.');
  const expiresAt = new Date(deps.now().getTime() + INVITE_TTL_MS).toISOString();
  const invite = { invite_token_hash: inviteTokenHash(token), invite_expires_at: expiresAt };

  const existing = await request(
    'GET',
    `/rest/v1/admin_users?select=user_id,role,status&email=eq.${encodeURIComponent(args.email)}&limit=1`,
  );
  if (!existing.ok || !Array.isArray(existing.json))
    fail('check_email', existing.status, existing.json);
  const row = existing.json[0] as Row | undefined;

  let userId: string;
  let reissued = false;
  if (row !== undefined) {
    if (row.role !== 'super_admin' || row.status !== 'invited') {
      throw new BootstrapError(
        'admin_exists',
        'An admin with this email already exists and is not a pending super_admin.',
      );
    }
    const patched = await request(
      'PATCH',
      `/rest/v1/admin_users?user_id=eq.${encodeURIComponent(row.user_id)}&status=eq.invited`,
      { ...invite, invite_redeemed_at: null, display_name: args.name },
      { prefer: 'return=minimal' },
    );
    if (!patched.ok) fail('reissue_invite', patched.status, patched.json);
    userId = row.user_id;
    reissued = true;
  } else {
    const created = await request('POST', '/auth/v1/admin/users', {
      email: args.email,
      email_confirm: true,
      app_metadata: { da_kind: 'admin' },
      user_metadata: { display_name: args.name },
    });
    const id = (created.json as { id?: unknown } | null)?.id;
    if (!created.ok || typeof id !== 'string') {
      if (created.status === 422) {
        throw new BootstrapError(
          'email_in_use',
          'This email already has an account; use a dedicated admin address (R-08).',
        );
      }
      fail('create_identity', created.status, created.json);
    }
    userId = id;
    const inserted = await request(
      'POST',
      '/rest/v1/admin_users',
      {
        user_id: userId,
        role: 'super_admin',
        status: 'invited',
        display_name: args.name,
        email: args.email,
        ...invite,
      },
      { prefer: 'return=minimal' },
    );
    if (!inserted.ok) {
      await request('DELETE', `/auth/v1/admin/users/${encodeURIComponent(userId)}`);
      fail('insert_admin_user', inserted.status, inserted.json);
    }
  }

  const audited = await request('POST', '/rest/v1/rpc/audit_log_append', {
    p_actor_type: 'system',
    p_actor_id: null,
    p_actor_role: null,
    p_action: 'admin.bootstrap',
    p_target_type: 'admin_user',
    p_target_id: userId,
    p_target_user_id: null,
    p_reason: null,
    p_result: 'success',
    p_details: { role: 'super_admin', reissued, invite_expires_at: expiresAt },
    p_correlation_id: deps.uuid(),
  });
  if (!audited.ok) fail('audit', audited.status, audited.json);

  const inviteUrl = new URL('/invite', env.adminOrigin);
  inviteUrl.searchParams.set('token', token);
  return { userId, inviteUrl: inviteUrl.toString(), expiresAt, reissued };
}

async function main(): Promise<void> {
  try {
    const args = parseBootstrapArgs(process.argv.slice(2));
    const env = readBootstrapEnv(process.env);
    const result = await bootstrap(args, env, {
      fetch,
      now: () => new Date(),
      inviteToken: () => randomBytes(32).toString('base64url'),
      uuid: randomUUID,
    });
    console.info(
      [
        result.reissued
          ? 'super_admin invite re-issued (the previous link no longer works).'
          : 'super_admin invited.',
        `Invite link (one-time, expires ${result.expiresAt}):`,
        result.inviteUrl,
        'Open it in a browser, sign in with the email code, then enrol TOTP.',
      ].join('\n'),
    );
  } catch (error) {
    const message = error instanceof BootstrapError ? error.message : 'Unexpected error.';
    console.error(`admin:bootstrap: ${message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

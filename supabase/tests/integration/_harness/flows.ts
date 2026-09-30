/**
 * Multi-step flows shared by the suites: the full OAuth connect (API-INT-01 start → provider consent
 * on the mock → `oauth` callback → API-INT-07 completion) for Google, Microsoft and demo, and small
 * readers over the resulting rows.
 */
import { assert, assertEquals } from '@std/assert';
import { call, json, MOCK_URL, one, q, SUPABASE_URL, type TestUser } from './mod.ts';

export function b64urlRandom(bytes = 32): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  );
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface StartedFlow {
  readonly authUrl: string;
  readonly stateId: string;
  readonly deviceNonce: string;
  readonly data: Record<string, unknown>;
}

/** API-INT-01 (or API-INT-02 with `upgradeOf`). */
export async function startFlow(
  user: TestUser,
  provider: 'google' | 'microsoft' | 'demo',
  capabilities: string[],
  options: { upgradeOf?: string; overrides?: Record<string, string | undefined> } = {},
): Promise<StartedFlow> {
  const deviceNonce = b64urlRandom();
  const path =
    options.upgradeOf === undefined
      ? `/integrations/${provider}/start`
      : `/integrations/${options.upgradeOf}/upgrade`;
  const body =
    options.upgradeOf === undefined
      ? { capabilities, device_nonce_hash: await sha256Hex(deviceNonce) }
      : { capability: capabilities[0], device_nonce_hash: await sha256Hex(deviceNonce) };
  const res = await call('api', 'POST', path, {
    jwt: user.jwt,
    key: crypto.randomUUID(),
    body,
    ...(options.overrides === undefined ? {} : { overrides: options.overrides }),
  });
  const out = await json<{ data: Record<string, unknown> }>(res);
  assertEquals(res.status, 200, JSON.stringify(out));
  return {
    authUrl: String(out.data.auth_url),
    stateId: String(out.data.state_id),
    deviceNonce,
    data: out.data,
  };
}

/** Follows the consent redirect of the mock provider; returns the callback path + query. */
export async function consent(authUrl: string): Promise<string> {
  assert(authUrl.startsWith(MOCK_URL()), `auth URL on the mock: ${authUrl}`);
  const res = await fetch(authUrl, { redirect: 'manual' });
  await res.body?.cancel();
  assertEquals(res.status, 302, `consent redirect for ${authUrl}`);
  const location = res.headers.get('location') ?? '';
  const prefix = `${SUPABASE_URL()}/functions/v1/oauth`;
  assert(location.startsWith(prefix), `callback on the oauth function: ${location}`);
  return location.slice(prefix.length);
}

/** `GET /oauth/<provider>/callback?...` → the app deep link (302). */
export async function callback(
  pathAndQuery: string,
  overrides?: Record<string, string | undefined>,
): Promise<URL> {
  const res = await call(
    'oauth',
    'GET',
    pathAndQuery,
    overrides === undefined ? {} : { overrides },
  );
  await res.body?.cancel();
  assertEquals(res.status, 302, `callback ${pathAndQuery}`);
  return new URL(res.headers.get('location') ?? '');
}

export async function complete(
  user: TestUser,
  completionCode: string,
  deviceNonce: string,
  overrides?: Record<string, string | undefined>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await call('api', 'POST', '/integrations/oauth/complete', {
    jwt: user.jwt,
    key: crypto.randomUUID(),
    body: { completion_code: completionCode, device_nonce: deviceNonce },
    ...(overrides === undefined ? {} : { overrides }),
  });
  return { status: res.status, body: await json(res) };
}

export interface Connected {
  readonly accountId: string;
  readonly completion: Record<string, unknown>;
}

/** The whole connect flow; returns the finalised account id. */
export async function connect(
  user: TestUser,
  provider: 'google' | 'microsoft',
  capabilities: string[] = ['mail_read'],
): Promise<Connected> {
  // API-INT-01 starts with read capabilities; write capabilities are progressive upgrades (API-INT-02).
  const reads = capabilities.filter((c) => c.endsWith('_read'));
  const writes = capabilities.filter((c) => !c.endsWith('_read'));
  const first = await connectOnce(user, provider, reads.length > 0 ? reads : ['mail_read']);
  for (const capability of writes) {
    const flow = await startFlow(user, provider, [capability], { upgradeOf: first.accountId });
    const link = await callback(await consent(flow.authUrl));
    const done = await complete(
      user,
      link.searchParams.get('completion_code') ?? '',
      flow.deviceNonce,
    );
    assertEquals(done.status, 200, JSON.stringify(done.body));
  }
  return first;
}

async function connectOnce(
  user: TestUser,
  provider: 'google' | 'microsoft',
  capabilities: string[],
): Promise<Connected> {
  const flow = await startFlow(user, provider, capabilities);
  const link = await callback(await consent(flow.authUrl));
  const code = link.searchParams.get('completion_code');
  assert(code !== null, `completion code in ${link}`);
  const done = await complete(user, code, flow.deviceNonce);
  assertEquals(done.status, 200, JSON.stringify(done.body));
  const data = done.body.data as Record<string, unknown>;
  const account = data.account as Record<string, unknown>;
  return { accountId: String(account.id), completion: data };
}

export async function account(id: string): Promise<Record<string, unknown>> {
  return await one(`select * from public.connected_accounts where id = $1`, [id]);
}

export async function jobsOf(
  where: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>[]> {
  return await q(`select * from public.jobs where ${where} order by created_at`, params);
}

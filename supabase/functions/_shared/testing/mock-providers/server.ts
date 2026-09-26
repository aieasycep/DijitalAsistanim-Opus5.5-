/**
 * Mock provider server for the integration tier (TEST_PLAN §6.1; IMPLEMENTATION_PLAN T-12.01): one
 * Hono app on `127.0.0.1:8788` emulating the provider contracts the adapters call, reached through
 * the base-URL overrides that exist only outside preview/production (`GOOGLE_OAUTH_BASE_URL`,
 * `GOOGLE_API_BASE_URL`, `MS_LOGIN_BASE_URL`, `MS_GRAPH_BASE_URL`, `APPLE_ID_BASE_URL`,
 * `REVENUECAT_API_BASE_URL`, `EXPO_PUSH_BASE_URL`, `VOYAGE_API_BASE_URL`).
 *
 * Path families: `/google-oauth`, `/gmail`, `/calendar` (gcal), `/tasks` (gtasks), `/ms-login`,
 * `/graph`, `/apple`, `/revenuecat`, `/expo`, `/voyage`. Control endpoints: `POST /__script`,
 * `GET /__requests`, `POST /__reset`, plus per-provider seed/inspect endpoints (`/__google`,
 * `/__graph`, `/__apple`, `/__revenuecat`, `/revenuecat/__activate`, `/__expo`). Responses are
 * built from the fixtures under `../fixtures/<provider>/` (hand-authored from the public API
 * references; canon names only).
 *
 * Run: deno run --allow-net=127.0.0.1 --allow-env --allow-read server.ts  (started by
 * `scripts/integration/run.ts`; `scripts/e2e/start-stack.sh` binds it to the Docker bridge gateway
 * so the edge runtime container reaches it as `host.docker.internal`). `MOCK_PROVIDERS_HOSTNAME`
 * (default 127.0.0.1) must be loopback or a private IPv4 address: the server never listens beyond
 * the host. Never deployed: it lives under `_shared/testing/`.
 */
import { Hono } from 'hono';
import { type MockEnv, MockState, mountCore } from './core.ts';
import { mountGoogle } from './google.ts';
import { mountMicrosoft } from './microsoft.ts';
import { mountServices } from './services.ts';

export async function createMockProviders(): Promise<{ app: Hono<MockEnv>; state: MockState }> {
  const app = new Hono<MockEnv>();
  const state = new MockState();
  mountCore(app, state);
  await mountGoogle(app, state);
  mountMicrosoft(app, state);
  mountServices(app, state);
  app.notFound((c) =>
    c.json(
      { error: 'mock_route_not_found', method: c.req.method, path: new URL(c.req.url).pathname },
      404,
    ),
  );
  return { app, state };
}

/**
 * The listen address: loopback (127/8, ::1, localhost) or a private IPv4 address (10/8, 172.16/12,
 * 192.168/16, e.g. the Docker bridge gateway). Wildcards, public addresses and other names throw.
 */
export function mockHostname(raw: string | undefined): string {
  const host = (raw ?? '').trim() || '127.0.0.1';
  if (host === 'localhost' || host === '::1') return host;
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)?.slice(1).map(Number);
  if (octets !== undefined && octets.every((o) => o <= 255)) {
    const [a, b] = octets as [number, number, number, number];
    if (a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))
      return host;
  }
  throw new Error(`MOCK_PROVIDERS_HOSTNAME must be loopback or private IPv4, got ${host}`);
}

if (import.meta.main) {
  const { app } = await createMockProviders();
  const hostname = mockHostname(Deno.env.get('MOCK_PROVIDERS_HOSTNAME'));
  const port = Number(Deno.env.get('MOCK_PROVIDERS_PORT') ?? 8788);
  Deno.serve({ hostname, port, onListen: () => {} }, app.fetch);
}

/**
 * Mock provider server for the integration tier (TEST_PLAN §6.1; IMPLEMENTATION_PLAN T-12.01): one
 * Hono app on `127.0.0.1:8788` emulating the provider contracts the adapters call, reached through
 * the base-URL overrides that exist only outside preview/production (`GOOGLE_OAUTH_BASE_URL`,
 * `GOOGLE_API_BASE_URL`, `MS_LOGIN_BASE_URL`, `MS_GRAPH_BASE_URL`, `APPLE_ID_BASE_URL`,
 * `REVENUECAT_API_BASE_URL`, `EXPO_PUSH_BASE_URL`, `VOYAGE_API_BASE_URL`, `ANTHROPIC_API_BASE_URL`,
 * `OPENAI_API_BASE_URL`).
 *
 * Path families: `/google-oauth`, `/gmail`, `/calendar` (gcal), `/tasks` (gtasks), `/ms-login`,
 * `/graph`, `/apple`, `/revenuecat`, `/expo`, `/voyage`, `/anthropic`, `/openai`. Control endpoints: `POST /__script`,
 * `GET /__requests`, `POST /__reset`, plus per-provider seed/inspect endpoints (`/__google`,
 * `/__graph`, `/__apple`, `/__revenuecat`, `/__expo`). Responses are built from the fixtures under
 * `../fixtures/<provider>/` (hand-authored from the public API references; canon names only).
 *
 * Run: deno run --allow-net=127.0.0.1 --allow-env --allow-read server.ts  (started by
 * `scripts/integration/run.ts`). Never deployed: it lives under `_shared/testing/`.
 */
import { Hono } from 'hono';
import { mountAi } from './ai.ts';
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
  mountAi(app, state);
  app.notFound((c) =>
    c.json(
      { error: 'mock_route_not_found', method: c.req.method, path: new URL(c.req.url).pathname },
      404,
    ),
  );
  return { app, state };
}

if (import.meta.main) {
  const { app } = await createMockProviders();
  const port = Number(Deno.env.get('MOCK_PROVIDERS_PORT') ?? 8788);
  Deno.serve({ hostname: '127.0.0.1', port, onListen: () => {} }, app.fetch);
}

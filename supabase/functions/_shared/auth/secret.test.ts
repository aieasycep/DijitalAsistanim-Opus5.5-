import { assertEquals } from '@std/assert';
import { createApp } from '../http/app.ts';
import { sendData } from '../http/respond.ts';
import { createLogger, memorySink } from '../logging/logger.ts';
import { requireSecret } from './secret.ts';

function app(secret: string | undefined) {
  const a = createApp({
    fn: 'worker',
    logger: createLogger({ fn: 'worker', sink: memorySink().sink }),
  });
  a.post('/run', requireSecret({ name: 'automations', secret }), (c) => sendData(c, { ok: true }));
  return a;
}

const SECRET = crypto.randomUUID();

Deno.test('secret auth accepts the automations key in apikey or Authorization', async () => {
  const a = app(SECRET);
  const viaApikey = await a.request('/worker/run', { method: 'POST', headers: { apikey: SECRET } });
  assertEquals(viaApikey.status, 200);
  await viaApikey.body?.cancel();
  const viaBearer = await a.request('/worker/run', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  assertEquals(viaBearer.status, 200);
  await viaBearer.body?.cancel();
});

Deno.test('secret auth refuses missing, wrong and prefix-matching keys', async () => {
  const a = app(SECRET);
  const variants: Record<string, string>[] = [
    {},
    { apikey: 'wrong' },
    { apikey: SECRET.slice(0, -1) },
    { apikey: `${SECRET}x` },
  ];
  for (const headers of variants) {
    const res = await a.request('/worker/run', { method: 'POST', headers });
    assertEquals(res.status, 401);
    assertEquals((await res.json()).error.details.reason, 'secret_required');
  }
});

Deno.test('without a configured secret every request is refused', async () => {
  const a = app(undefined);
  const res = await a.request('/worker/run', { method: 'POST', headers: { apikey: '' } });
  assertEquals(res.status, 401);
  await res.body?.cancel();
});

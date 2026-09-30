/**
 * PUB-01 `POST /support` and PUB-08 `POST /support/inbound-email` (TEST_PLAN EF-PUB-01, CT-05).
 */
import { assert, assertEquals, assertMatch } from '@std/assert';
import { publicRoutes } from '@da/validation';
import { toBase64 } from '../_shared/crypto/encoding.ts';
import { publicHarness, send, WEB_ORIGIN } from './testing.ts';

const TICKET = {
  email: 'deniz@example.com',
  name: 'Deniz',
  category: 'billing',
  message: 'Aboneliğim uygulamada görünmüyor.',
  locale: 'tr',
  website: '',
};

Deno.test('PUB-01 creates an open web ticket with the localised category as subject', async () => {
  const h = await publicHarness();
  const res = await send(h, 'POST', '/support', { body: TICKET, headers: { Origin: WEB_ORIGIN } });
  assertEquals(res.status, 202);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), WEB_ORIGIN);
  const body = await res.json();
  assert(publicRoutes['POST /support'].response.safeParse(body).success);
  assertEquals(h.repo.tickets.length, 1);
  const ticket = h.repo.tickets[0];
  assertEquals(ticket?.subject, 'Faturalandırma');
  assertEquals(ticket?.name, 'Deniz');
  assertEquals(ticket?.reference, body.data.reference);
  const en = await send(h, 'POST', '/support', {
    body: { ...TICKET, locale: 'en', email: 'other@example.com', category: 'privacy' },
  });
  assertEquals(en.status, 202);
  await en.body?.cancel();
  assertEquals(h.repo.tickets[1]?.subject, 'Privacy');
});

Deno.test('PUB-01 honeypot: a filled website gets a silent 202 and nothing is stored', async () => {
  const h = await publicHarness();
  const res = await send(h, 'POST', '/support', { body: { ...TICKET, website: 'https://spam' } });
  assertEquals(res.status, 202);
  const reference = (await res.json()).data.reference as string;
  assertMatch(reference, /^DA-2026-0\d{6}$/);
  assertEquals(h.repo.tickets.length, 0);
  assertEquals(h.limits.keys.size, 0);
});

Deno.test('PUB-01 returns the same reference for a double submit within 10 minutes', async () => {
  const h = await publicHarness();
  const first = (await (await send(h, 'POST', '/support', { body: TICKET })).json()).data.reference;
  const second = (
    await (
      await send(h, 'POST', '/support', { body: { ...TICKET, email: 'DENIZ@example.com' } })
    ).json()
  ).data.reference;
  assertEquals(first, second);
  assertEquals(h.repo.tickets.length, 1);
});

Deno.test('PUB-01 validates the strict body and rate limits by IP and e-mail hash', async () => {
  const h = await publicHarness();
  const short = await send(h, 'POST', '/support', { body: { ...TICKET, message: 'kısa' } });
  assertEquals(short.status, 422);
  const error = (await short.json()).error;
  assertEquals(error.code, 'VALIDATION_FAILED');
  assertEquals(error.field_errors[0].path, 'message');
  const unknown = await send(h, 'POST', '/support', { body: { ...TICKET, extra: true } });
  assertEquals(unknown.status, 422);
  await unknown.body?.cancel();

  for (let i = 0; i < 3; i++) {
    const ok = await send(h, 'POST', '/support', {
      body: { ...TICKET, message: `${TICKET.message} ${i}` },
    });
    assertEquals(ok.status, 202);
    await ok.body?.cancel();
  }
  const emailLimited = await send(h, 'POST', '/support', {
    body: { ...TICKET, message: `${TICKET.message} 4` },
  });
  assertEquals(emailLimited.status, 429);
  assert(emailLimited.headers.get('Retry-After') !== null);
  assertEquals((await emailLimited.json()).error.code, 'RATE_LIMITED');

  const h2 = await publicHarness();
  for (let i = 0; i < 5; i++) {
    const ok = await send(h2, 'POST', '/support', {
      body: { ...TICKET, email: `u${i}@example.com` },
    });
    assertEquals(ok.status, 202);
    await ok.body?.cancel();
  }
  const ipLimited = await send(h2, 'POST', '/support', {
    body: { ...TICKET, email: 'u9@example.com' },
  });
  assertEquals(ipLimited.status, 429);
  await ipLimited.body?.cancel();
  const otherIp = await send(h2, 'POST', '/support', {
    body: { ...TICKET, email: 'u9@example.com' },
    headers: { 'X-Forwarded-For': '198.51.100.20' },
  });
  assertEquals(otherIp.status, 202);
  await otherIp.body?.cancel();
  assert(
    ![...h2.limits.keys.keys()].some((k) => k.includes('203.0.113.7')),
    'raw IPs never become keys',
  );
});

Deno.test('PUB-01 verifies Turnstile only when it is configured', async () => {
  const tokens: (string | undefined)[] = [];
  const h = await publicHarness({
    captcha: {
      verify(token) {
        tokens.push(token);
        return Promise.resolve(token === 'good');
      },
    },
  });
  const missing = await send(h, 'POST', '/support', { body: TICKET });
  assertEquals(missing.status, 422);
  assertEquals((await missing.json()).error.field_errors[0].path, 'captcha_token');
  const ok = await send(h, 'POST', '/support', { body: { ...TICKET, captcha_token: 'good' } });
  assertEquals(ok.status, 202);
  await ok.body?.cancel();
  assertEquals(tokens, [undefined, 'good']);
});

const BASIC = 'postmark:inbound-secret-1234';
const auth = (value: string) => ({
  Authorization: `Basic ${toBase64(new TextEncoder().encode(value))}`,
});

async function ticketWaiting(h: Awaited<ReturnType<typeof publicHarness>>): Promise<string> {
  const reference = (await (await send(h, 'POST', '/support', { body: TICKET })).json()).data
    .reference as string;
  const ticket = h.repo.tickets.find((t) => t.reference === reference);
  if (ticket !== undefined) ticket.status = 'waiting_user';
  return reference;
}

Deno.test('PUB-08 needs the configured HTTP Basic credential', async () => {
  const unconfigured = await publicHarness();
  const off = await send(unconfigured, 'POST', '/support/inbound-email', {
    body: {},
    headers: auth(BASIC),
  });
  assertEquals(off.status, 503);
  assertEquals((await off.json()).error.code, 'EXTERNAL_CREDENTIAL_REQUIRED');
  const h = await publicHarness({ inboundBasicAuth: BASIC });
  for (const headers of [
    {},
    auth('postmark:wrong-secret-9999'),
    { Authorization: `Bearer ${BASIC}` },
  ]) {
    const res = await send(h, 'POST', '/support/inbound-email', { body: {}, headers });
    assertEquals(res.status, 401);
    assertEquals((await res.json()).error.code, 'WEBHOOK_SIGNATURE_INVALID');
  }
});

Deno.test('PUB-08 stores a reply from the contact e-mail once and reopens the ticket', async () => {
  const h = await publicHarness({ inboundBasicAuth: BASIC });
  const reference = await ticketWaiting(h);
  const mail = {
    from: 'Deniz <Deniz@Example.com>',
    to: `support+${reference}@mail.dijitalasistan.example`,
    subject: 'Re: talebin',
    text: 'Hâlâ görünmüyor.\n\nOn Mon, 21 Sep 2026 Destek wrote:\n> Merhaba',
    message_id: '<reply-1@mail.example>',
    in_reply_to: null,
  };
  const res = await send(h, 'POST', '/support/inbound-email', { body: mail, headers: auth(BASIC) });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  assertEquals(
    h.repo.notes.map((n) => n.body),
    ['Hâlâ görünmüyor.'],
  );
  assertEquals(h.repo.tickets[0]?.status, 'open');
  const replay = await send(h, 'POST', '/support/inbound-email', {
    body: mail,
    headers: auth(BASIC),
  });
  assertEquals(replay.status, 200);
  await replay.body?.cancel();
  assertEquals(h.repo.notes.length, 1);

  const intruder = await send(h, 'POST', '/support/inbound-email', {
    body: { ...mail, from: 'mallory@example.com', message_id: '<reply-2@mail.example>' },
    headers: auth(BASIC),
  });
  assertEquals(intruder.status, 200);
  await intruder.body?.cancel();
  assertEquals(h.repo.notes.length, 1, 'a different sender is ignored');

  const viaHeader = await send(h, 'POST', '/support/inbound-email', {
    body: {
      ...mail,
      to: 'destek@mail.dijitalasistan.example',
      in_reply_to: `<${reference}.outbound@mail.dijitalasistan.example>`,
      message_id: '<reply-3@mail.example>',
      text: 'Ek bilgi.',
    },
    headers: auth(BASIC),
  });
  assertEquals(viaHeader.status, 200);
  await viaHeader.body?.cancel();
  assertEquals(h.repo.notes.length, 2, 'In-Reply-To resolves the ticket too');
});

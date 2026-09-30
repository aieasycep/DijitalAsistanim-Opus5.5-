import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  APPLE_AUDIENCE,
  InputError,
  MAX_DAYS,
  applyToSupabase,
  githubEnvLines,
  mintClientSecret,
  parseArgs,
  readSiwaConfig,
  run,
  verifyClientSecret,
} from '../siwa-client-secret.ts';

/*
 * SIWA web client-secret rotation (KPL-49, STORE_CHECKLIST, INTEGRATION_PLAN §6.2): ES256 claims and
 * signature, the 180-day ceiling, input validation that never echoes values, the Management API
 * calls of `--apply`, the masked GitHub environment export and the report that never contains the
 * token or the private key.
 */

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const ENV = {
  APPLE_TEAM_ID: 'TEAM123456',
  APPLE_SIWA_KEY_ID: 'KEY1234567',
  APPLE_SIWA_PRIVATE_KEY: PEM,
  APPLE_SIWA_SERVICES_ID: 'app.dijitalasistan.web',
};
const NOW = new Date('2026-09-28T10:00:00Z');

function urlOf(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function capture() {
  const lines: string[] = [];
  const files = new Map<string, string>();
  return {
    lines,
    files,
    io: {
      log: (line: string) => lines.push(line),
      append: (file: string, text: string) => files.set(file, (files.get(file) ?? '') + text),
    },
  };
}

describe('siwa-client-secret', () => {
  it('mints an ES256 JWT with the Apple claims that verifies with the key', () => {
    const minted = mintClientSecret(readSiwaConfig(ENV), { now: NOW });
    const [header, payload, signature] = minted.token.split('.');
    assert.deepEqual(decode(header ?? ''), { alg: 'ES256', kid: 'KEY1234567' });
    const claims = decode(payload ?? '');
    assert.equal(claims.iss, 'TEAM123456');
    assert.equal(claims.sub, 'app.dijitalasistan.web');
    assert.equal(claims.aud, APPLE_AUDIENCE);
    assert.equal(claims.iat, NOW.getTime() / 1000);
    assert.equal(claims.exp, NOW.getTime() / 1000 + MAX_DAYS * 86_400);
    assert.equal(Buffer.from(signature ?? '', 'base64url').length, 64, 'raw r||s signature');
    assert.equal(minted.notAfter, '2027-03-27');
    assert.deepEqual(verifyClientSecret(minted.token, privateKey), minted.claims);
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    assert.equal(verifyClientSecret(minted.token, other), null);
    assert.equal(verifyClientSecret(`${minted.token}x`, privateKey), null);
  });

  it('keeps exp within 180 days (Apple allows at most six months)', () => {
    const config = readSiwaConfig(ENV);
    const short = mintClientSecret(config, { now: NOW, days: 30 });
    assert.equal(short.claims.exp - short.claims.iat, 30 * 86_400);
    for (const days of [0, 181, 365, 1.5]) {
      assert.throws(() => mintClientSecret(config, { now: NOW, days }), InputError);
    }
  });

  it('accepts a PEM with literal \\n escapes (a one-line CI secret)', () => {
    const oneLine = { ...ENV, APPLE_SIWA_PRIVATE_KEY: PEM.trim().replace(/\n/g, '\\n') };
    const minted = mintClientSecret(readSiwaConfig(oneLine), { now: NOW });
    assert.notEqual(verifyClientSecret(minted.token, privateKey), null);
  });

  it('names missing and invalid inputs without echoing any value', () => {
    assert.throws(
      () => readSiwaConfig({ APPLE_TEAM_ID: 'TEAM123456' }),
      /External credential required: APPLE_SIWA_KEY_ID, APPLE_SIWA_PRIVATE_KEY, APPLE_SIWA_SERVICES_ID/,
    );
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    try {
      readSiwaConfig({
        ...ENV,
        APPLE_TEAM_ID: 'lower-case',
        APPLE_SIWA_PRIVATE_KEY: rsa,
        APPLE_SIWA_SERVICES_ID: 'bad id!',
      });
      assert.fail('expected an InputError');
    } catch (error) {
      assert.ok(error instanceof InputError);
      assert.match(
        error.message,
        /APPLE_TEAM_ID .*APPLE_SIWA_SERVICES_ID .*APPLE_SIWA_PRIVATE_KEY/,
      );
      assert.ok(!error.message.includes('lower-case'));
      assert.ok(!error.message.includes('PRIVATE KEY-----'));
    }
    assert.throws(
      () => readSiwaConfig({ ...ENV, APPLE_SIWA_PRIVATE_KEY: 'not a key' }),
      InputError,
    );
  });

  it('--apply PATCHes the Apple provider secret, then stores the expiry as an Edge secret', async () => {
    const minted = mintClientSecret(readSiwaConfig(ENV), { now: NOW });
    const calls: { url: string; method: string; auth: string | null; body: unknown }[] = [];
    const fake: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: urlOf(input),
        method: init?.method ?? 'GET',
        auth: headers.get('authorization'),
        body: JSON.parse(typeof init?.body === 'string' ? init.body : 'null') as unknown,
      });
      return Promise.resolve(new Response('{}', { status: 200 }));
    };
    await applyToSupabase({
      accessToken: 'sbp_token',
      projectRef: 'abcdefghijklmnopqrst',
      minted,
      fetch: fake,
    });
    assert.deepEqual(calls, [
      {
        url: 'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/config/auth',
        method: 'PATCH',
        auth: 'Bearer sbp_token',
        body: { external_apple_secret: minted.token },
      },
      {
        url: 'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/secrets',
        method: 'POST',
        auth: 'Bearer sbp_token',
        body: [{ name: 'APPLE_SIWA_WEB_SECRET_NOT_AFTER', value: '2027-03-27' }],
      },
    ]);
    const failing: typeof fetch = () =>
      Promise.resolve(new Response(`{"echo":"${minted.token}"}`, { status: 401 }));
    await assert.rejects(
      applyToSupabase({
        accessToken: 't',
        projectRef: 'abcdefghijklmnopqrst',
        minted,
        fetch: failing,
      }),
      (error: Error) => error.message === 'Supabase Auth Apple provider update failed: HTTP 401',
    );
    await assert.rejects(
      applyToSupabase({ accessToken: 't', projectRef: 'Bad/Ref', minted, fetch: fake }),
      InputError,
    );
  });

  it('the dry run reports public claims only and sends nothing', async () => {
    const out = capture();
    let called = false;
    const code = await run([], ENV, {
      ...out.io,
      fetch: () => {
        called = true;
        return Promise.resolve(new Response('{}'));
      },
    });
    assert.equal(code, 0);
    assert.equal(called, false);
    const text = out.lines.join('\n');
    assert.match(text, /iss=TEAM123456 sub=app\.dijitalasistan\.web/);
    assert.match(text, /dry run/);
    assert.ok(!text.includes('eyJ'), 'the token is never printed');
    assert.ok(!text.includes('PRIVATE KEY'), 'the key is never printed');
  });

  it('--apply without the Management API token is an external-credential error (exit 2)', async () => {
    const out = capture();
    assert.equal(await run(['--apply'], ENV, out.io), 2);
    assert.match(
      out.lines.join('\n'),
      /External credential required: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF/,
    );
    const none = capture();
    assert.equal(await run([], {}, none.io), 2);
  });

  it('--apply updates the project; --github-env masks and exports; --github-output has no secret', async () => {
    const out = capture();
    const urls: string[] = [];
    const code = await run(
      ['--apply', '--days', '150', '--github-env', 'env.txt', '--github-output', 'out.txt'],
      { ...ENV, SUPABASE_ACCESS_TOKEN: 'sbp_x', SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst' },
      {
        ...out.io,
        fetch: (input) => {
          urls.push(urlOf(input));
          return Promise.resolve(new Response('{}'));
        },
      },
    );
    assert.equal(code, 0);
    assert.equal(urls.length, 2);
    const exported = out.files.get('env.txt') ?? '';
    const token = /^SUPABASE_AUTH_EXTERNAL_APPLE_SECRET=(\S+)$/m.exec(exported)?.[1] ?? '';
    assert.match(token, /^eyJ/);
    assert.match(exported, /^APPLE_SIWA_WEB_SECRET_NOT_AFTER=\d{4}-\d{2}-\d{2}$/m);
    // The only line carrying the token is the runner's mask command (never shown in the log).
    const withToken = out.lines.filter((line) => line.includes(token));
    assert.deepEqual(withToken, [`::add-mask::${token}`]);
    assert.match(out.files.get('out.txt') ?? '', /^not_after=\d{4}-\d{2}-\d{2}\n$/);
    assert.deepEqual(
      githubEnvLines(mintClientSecret(readSiwaConfig(ENV), { now: NOW })).mask.slice(0, 16),
      '::add-mask::eyJh',
    );
  });

  it('parses its arguments strictly', () => {
    assert.deepEqual(parseArgs([]), {
      days: 180,
      apply: false,
      githubEnv: null,
      githubOutput: null,
    });
    assert.throws(() => parseArgs(['--days']), InputError);
    assert.throws(() => parseArgs(['--force']), InputError);
  });

  it('an API failure exits 1 with the status only', async () => {
    const out = capture();
    const code = await run(
      ['--apply'],
      { ...ENV, SUPABASE_ACCESS_TOKEN: 'sbp_x', SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst' },
      { ...out.io, fetch: () => Promise.resolve(new Response('{}', { status: 500 })) },
    );
    assert.equal(code, 1);
    assert.match(out.lines.at(-1) ?? '', /HTTP 500/);
  });
});

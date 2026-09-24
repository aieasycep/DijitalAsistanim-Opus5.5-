import { assert, assertEquals, assertRejects } from '@std/assert';
import { type DnsResolver, safeFetch, SsrfError, USER_AGENT } from './ssrf-fetch.ts';
import { forbiddenFetch, stubFetch } from '../testing/fetch.ts';

const PUBLIC_V4 = '93.184.215.14';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function resolverFor(table: Record<string, { A?: string[]; AAAA?: string[] }>): DnsResolver {
  return (host, type) => Promise.resolve(table[host]?.[type] ?? []);
}

const publicResolver = resolverFor({
  'example.com': { A: [PUBLIC_V4] },
  'cdn.example.org': { A: ['151.101.1.1'] },
});

async function blocked(url: string, resolver: DnsResolver = publicResolver): Promise<SsrfError> {
  return await assertRejects(
    () => safeFetch(url, { resolver, fetch: forbiddenFetch() }),
    SsrfError,
  );
}

Deno.test(
  'IP literals in private, loopback, link-local, ULA and unspecified ranges are blocked before any request',
  async () => {
    for (const url of [
      'https://127.0.0.1/',
      'https://10.0.0.1/',
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/',
      'https://[fd00::1]/',
      'https://0.0.0.0/',
      'https://2130706433/',
      'https://0x7f.0.0.1/',
      'https://0177.0.0.1/',
      'https://[::ffff:127.0.0.1]/',
      'https://192.168.1.10/',
      'https://172.16.0.1/',
      'https://100.64.0.1/',
    ]) {
      const error = await blocked(url);
      assertEquals(error.code, 'blocked_address', url);
      assertEquals(error.apiCode, 'SSRF_BLOCKED');
    }
  },
);

Deno.test(
  'non-https schemes are refused: http is never upgraded, file and gopher never fetched',
  async () => {
    for (const url of [
      'http://example.com/',
      'file:///etc/passwd',
      'gopher://example.com:70/',
      'ftp://example.com/',
    ]) {
      const error = await blocked(url);
      assertEquals(error.code, 'insecure_scheme', url);
      assertEquals(error.apiCode, 'SSRF_BLOCKED');
    }
  },
);

Deno.test('credentials, non-443 ports, internal names and our own hosts are refused', async () => {
  assertEquals((await blocked('https://user:pass@example.com/')).code, 'invalid_url');
  assertEquals((await blocked('https://example.com:8443/')).code, 'invalid_url');
  assertEquals((await blocked('https://localhost/')).code, 'blocked_address');
  assertEquals((await blocked('https://metadata.google.internal/')).code, 'blocked_address');
  const self = await assertRejects(
    () =>
      safeFetch('https://abc.supabase.co/functions/v1/api', {
        selfHosts: ['abc.supabase.co'],
        resolver: publicResolver,
        fetch: forbiddenFetch(),
      }),
    SsrfError,
  );
  assertEquals(self.code, 'blocked_address');
});

Deno.test(
  'DNS answers are vetted: private-only is blocked, mixed private/public is blocked, none is unresolvable',
  async () => {
    const resolver = resolverFor({
      'intranet.example.com': { A: ['10.1.2.3'] },
      'mixed.example.com': { A: [PUBLIC_V4], AAAA: ['fd00::5'] },
      'rebind.example.com': { AAAA: ['::1'] },
    });
    assertEquals(
      (await blocked('https://intranet.example.com/', resolver)).code,
      'blocked_address',
    );
    assertEquals((await blocked('https://mixed.example.com/', resolver)).code, 'dns_mixed_private');
    assertEquals((await blocked('https://rebind.example.com/', resolver)).code, 'blocked_address');
    const none = await blocked('https://nowhere.example.com/', resolver);
    assertEquals(none.code, 'unresolvable');
    assertEquals(none.apiCode, 'FETCH_FAILED');
  },
);

Deno.test('a redirect to a private address is re-validated and blocked', async () => {
  const stub = stubFetch(
    () =>
      new Response(null, { status: 302, headers: { Location: 'https://169.254.169.254/latest/' } }),
  );
  const error = await assertRejects(
    () => safeFetch('https://example.com/start', { resolver: publicResolver, fetch: stub.fetch }),
    SsrfError,
  );
  assertEquals(error.code, 'blocked_address');
  assertEquals(stub.calls.length, 1);

  const toHttp = stubFetch(
    () => new Response(null, { status: 301, headers: { Location: 'http://example.com/' } }),
  );
  const insecure = await assertRejects(
    () => safeFetch('https://example.com/start', { resolver: publicResolver, fetch: toHttp.fetch }),
    SsrfError,
  );
  assertEquals(insecure.code, 'insecure_scheme');
});

Deno.test('redirects are followed manually up to 3 hops', async () => {
  let hop = 0;
  const stub = stubFetch(() => {
    hop++;
    return hop <= 3
      ? new Response(null, { status: 302, headers: { Location: `/hop-${hop}` } })
      : new Response('<p>ok</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  });
  const result = await safeFetch('https://example.com/', {
    resolver: publicResolver,
    fetch: stub.fetch,
  });
  assertEquals(result.finalUrl, 'https://example.com/hop-3');
  assertEquals(result.redirects.length, 3);
  assertEquals(result.text, '<p>ok</p>');

  const loop = stubFetch(
    () => new Response(null, { status: 302, headers: { Location: '/again' } }),
  );
  const error = await assertRejects(
    () => safeFetch('https://example.com/', { resolver: publicResolver, fetch: loop.fetch }),
    SsrfError,
  );
  assertEquals(error.code, 'too_many_redirects');
  assertEquals(loop.calls.length, 4);
});

Deno.test(
  'requests carry no cookies or Authorization, the bot User-Agent and manual redirects',
  async () => {
    let init: RequestInit | undefined;
    const fetchImpl = ((_url: string, requestInit?: RequestInit) => {
      init = requestInit;
      return Promise.resolve(new Response('hello', { headers: { 'Content-Type': 'text/plain' } }));
    }) as typeof fetch;
    const result = await safeFetch('https://example.com/a.txt', {
      resolver: publicResolver,
      fetch: fetchImpl,
    });
    assertEquals(result.text, 'hello');
    const headers = new Headers(init?.headers);
    assertEquals(headers.get('User-Agent'), USER_AGENT);
    assertEquals(headers.get('Cookie'), null);
    assertEquals(headers.get('Authorization'), null);
    assertEquals(headers.get('Accept-Encoding'), 'identity');
    assertEquals(init?.redirect, 'manual');
    assertEquals(init?.credentials, 'omit');
  },
);

Deno.test('bodies over the cap are refused, by Content-Length and while streaming', async () => {
  const declared = stubFetch(
    () =>
      new Response('x', { headers: { 'Content-Type': 'text/plain', 'Content-Length': '999999' } }),
  );
  assertEquals(
    (
      await assertRejects(
        () =>
          safeFetch('https://example.com/', {
            maxBytes: 1024,
            resolver: publicResolver,
            fetch: declared.fetch,
          }),
        SsrfError,
      )
    ).code,
    'too_large',
  );
  const streamed = stubFetch(() => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(new Uint8Array(512));
        controller.close();
      },
    });
    return new Response(body, { headers: { 'Content-Type': 'text/plain' } });
  });
  const error = await assertRejects(
    () =>
      safeFetch('https://example.com/', {
        maxBytes: 1024,
        resolver: publicResolver,
        fetch: streamed.fetch,
      }),
    SsrfError,
  );
  assertEquals(error.code, 'too_large');
  assertEquals(error.apiCode, 'FETCH_FAILED');
});

Deno.test(
  'content types outside the allow-list, compressed bodies and bad magic numbers are refused',
  async () => {
    const zip = stubFetch(
      () =>
        new Response(new Uint8Array([0x50, 0x4b, 3, 4]), {
          headers: { 'Content-Type': 'application/zip' },
        }),
    );
    assertEquals(
      (
        await assertRejects(
          () => safeFetch('https://example.com/', { resolver: publicResolver, fetch: zip.fetch }),
          SsrfError,
        )
      ).code,
      'unsupported_type',
    );
    const gz = stubFetch(
      () =>
        new Response('x', { headers: { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' } }),
    );
    assertEquals(
      (
        await assertRejects(
          () => safeFetch('https://example.com/', { resolver: publicResolver, fetch: gz.fetch }),
          SsrfError,
        )
      ).code,
      'encoded_response',
    );
    const fakePdf = stubFetch(
      () =>
        new Response('<html>not a pdf</html>', { headers: { 'Content-Type': 'application/pdf' } }),
    );
    assertEquals(
      (
        await assertRejects(
          () =>
            safeFetch('https://example.com/doc.pdf', {
              resolver: publicResolver,
              fetch: fakePdf.fetch,
            }),
          SsrfError,
        )
      ).code,
      'magic_mismatch',
    );
    const png = stubFetch(() => new Response(PNG, { headers: { 'Content-Type': 'image/png' } }));
    const ok = await safeFetch('https://cdn.example.org/og.png', {
      accept: ['image/png'],
      resolver: publicResolver,
      fetch: png.fetch,
    });
    assertEquals(ok.contentType, 'image/png');
    assertEquals(ok.text, null);
    const narrowed = stubFetch(
      () => new Response('<p>x</p>', { headers: { 'Content-Type': 'text/html' } }),
    );
    assertEquals(
      (
        await assertRejects(
          () =>
            safeFetch('https://example.com/', {
              accept: ['image/png'],
              resolver: publicResolver,
              fetch: narrowed.fetch,
            }),
          SsrfError,
        )
      ).code,
      'unsupported_type',
    );
  },
);

Deno.test('upstream errors and timeouts map to FETCH_FAILED codes', async () => {
  const notFound = stubFetch(() => new Response('gone', { status: 404 }));
  const error = await assertRejects(
    () => safeFetch('https://example.com/', { resolver: publicResolver, fetch: notFound.fetch }),
    SsrfError,
  );
  assertEquals(error.code, 'upstream_error');
  assertEquals(error.detail.status, 404);

  const slow = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError')),
      );
    })) as typeof fetch;
  const timeout = await assertRejects(
    () =>
      safeFetch('https://example.com/', { timeoutMs: 20, resolver: publicResolver, fetch: slow }),
    SsrfError,
  );
  assertEquals(timeout.code, 'timeout');
  assert(timeout.apiCode === 'FETCH_FAILED');
});

/**
 * THR-07 SSRF (SECURITY_AND_PRIVACY_PLAN §2 THR-07, CTL-3.10; M§84; TEST_PLAN TST-EF-08,
 * TST-PK-01). Exercised through the link-capture code that ships: the API pre-check
 * (`assertLinkAllowed`, API-CAP-02), the preview (`linkPreview`) and the JOB-27 page read
 * (`readPage` inside `runCaptureAnalysis`). Every blocked target is refused before a connection is
 * made to it — decimal/octal/hex IPv4 forms, IPv6 loopback/ULA/link-local, IPv4-mapped, NAT64 and
 * 6to4 embeddings, cloud metadata, DNS answers mixing public and private addresses, and redirects
 * to any of those. Residual risk: DNS rebinding between the vetting lookup and the runtime's own
 * connect lookup (documented in docs/SECURITY.md).
 */
import { assert, assertEquals, assertRejects } from '@std/assert';
import { AppError } from '../../_shared/errors.ts';
import type { DnsResolver } from '../../_shared/security/ssrf-fetch.ts';
import {
  assertLinkAllowed,
  linkPreview,
  readPage,
  SsrfError,
} from '../../_shared/services/capture/link.ts';
import { stubFetch } from '../../_shared/testing/fetch.ts';
import { jobContext } from '../../_shared/testing/intel.ts';
import { runCaptureAnalysis } from '../../worker/handlers/capture_analysis.ts';
import { assistApi, captureRow } from './helpers.ts';

const PUBLIC = '93.184.215.14';
const HTML = `<html><head><title>Sayfa</title></head><body><article>${'Kamuya açık metin. '.repeat(40)}</article></body></html>`;

/** Literal hosts the fetcher must refuse without resolving or connecting. */
const LITERAL_BLOCKS = [
  'https://127.0.0.1/',
  'https://2130706433/', // decimal 127.0.0.1
  'https://0x7f000001/', // hex
  'https://017700000001/', // octal
  'https://127.1/', // short form
  'https://0/',
  'https://10.1.2.3/',
  'https://172.31.255.255/',
  'https://192.168.0.1/',
  'https://100.64.0.1/', // CGNAT
  'https://169.254.169.254/latest/meta-data/iam/', // AWS/GCP metadata
  'https://[::1]/',
  'https://[::]/',
  'https://[fd00:ec2::254]/', // AWS IPv6 metadata
  'https://[fc00::1]/',
  'https://[fe80::1]/',
  'https://[::ffff:127.0.0.1]/', // IPv4-mapped
  'https://[::ffff:a9fe:a9fe]/', // IPv4-mapped metadata, hex form
  'https://[64:ff9b::a9fe:a9fe]/', // NAT64 metadata
  'https://[2002:7f00:1::]/', // 6to4 of 127.0.0.1
  'https://[ff02::1]/',
  'http://example.com/', // cleartext
  'https://example.com:8443/', // non-443 port
  'https://user:pass@example.com/', // credentials in the URL
  'file:///etc/passwd',
  'gopher://127.0.0.1:6379/_FLUSHALL',
  'data:text/html,<script>alert(1)</script>',
];

/** Hostnames whose DNS answer contains at least one blocked address. */
const RESOLVED_BLOCKS: Record<string, { A?: string[]; AAAA?: string[] }> = {
  'rebind.example': { A: ['127.0.0.1'] },
  'mixed.example': { A: [PUBLIC, '10.0.0.5'] },
  'meta.example': { A: ['169.254.169.254'] },
  'v6only.example': { AAAA: ['::1'] },
  'mapped.example': { AAAA: ['::ffff:192.168.1.1'] },
  'ula.example': { A: [PUBLIC], AAAA: ['fd12:3456::1'] },
};

function resolverFor(extra: Record<string, { A?: string[]; AAAA?: string[] }> = {}): DnsResolver {
  const table: Record<string, { A?: string[]; AAAA?: string[] }> = {
    'public.example': { A: [PUBLIC] },
    ...RESOLVED_BLOCKS,
    ...extra,
  };
  return (host, type) => Promise.resolve(table[host]?.[type] ?? []);
}

Deno.test('THR-07: the API pre-check refuses every blocked literal before a capture exists', () => {
  for (const url of LITERAL_BLOCKS) {
    let error: unknown = null;
    try {
      assertLinkAllowed(url);
    } catch (e) {
      error = e;
    }
    assert(error instanceof AppError, url);
    assertEquals(error.code, 'SSRF_BLOCKED', url);
  }
  assertEquals(assertLinkAllowed('https://public.example/a?b=c').hostname, 'public.example');
});

Deno.test(
  'THR-07: the page reader never connects to a blocked literal or a host resolving to a blocked address',
  async () => {
    const stub = stubFetch(() => new Response(HTML, { headers: { 'Content-Type': 'text/html' } }));
    const resolver = resolverFor();
    for (const url of [
      ...LITERAL_BLOCKS,
      ...Object.keys(RESOLVED_BLOCKS).map((h) => `https://${h}/path`),
    ]) {
      const error = await assertRejects(
        () => readPage(url, { fetch: stub.fetch, resolver }),
        SsrfError,
      );
      assertEquals(error.apiCode, 'SSRF_BLOCKED', url);
      assertEquals(await linkPreview(url, { fetch: stub.fetch, resolver }), null, url);
    }
    // A name without any address is refused too (no fallback connect by name).
    await assertRejects(
      () => readPage('https://unresolvable.example/', { fetch: stub.fetch, resolver }),
      SsrfError,
    );
    assertEquals(stub.calls.length, 0, 'no connection was ever attempted');
    const ok = await readPage('https://public.example/a', { fetch: stub.fetch, resolver });
    assert(ok.text.includes('Kamuya açık metin.'));
    assertEquals(stub.calls.length, 1);
  },
);

Deno.test(
  'THR-07: every redirect hop is re-validated — redirects to private literals, private names, http or a 4th hop are refused',
  async () => {
    const resolver = resolverFor({ 'hop.example': { A: [PUBLIC] } });
    for (const location of [
      'https://169.254.169.254/latest/meta-data/',
      'https://[::ffff:7f00:1]/admin',
      'https://2130706433/',
      'https://rebind.example/internal',
      'http://public.example/',
      '//10.0.0.1/relative-scheme',
    ]) {
      const stub = stubFetch((call) =>
        new URL(call.url).hostname === 'public.example'
          ? new Response(null, { status: 302, headers: { Location: location } })
          : new Response(HTML, { headers: { 'Content-Type': 'text/html' } }),
      );
      const error = await assertRejects(
        () => readPage('https://public.example/start', { fetch: stub.fetch, resolver }),
        SsrfError,
      );
      assertEquals(error.apiCode, 'SSRF_BLOCKED', location);
      assertEquals(stub.calls.length, 1, `only the public hop was fetched (${location})`);
    }
    // A chain of more than three redirects is cut off.
    let hops = 0;
    const loop = stubFetch(() => {
      hops++;
      return new Response(null, {
        status: 301,
        headers: { Location: `https://hop.example/${hops}` },
      });
    });
    const error = await assertRejects(
      () => readPage('https://hop.example/0', { fetch: loop.fetch, resolver }),
      SsrfError,
    );
    assertEquals(error.code, 'too_many_redirects');
    assertEquals(loop.calls.length, 4);
    // Requests carry no credentials and ask for identity encoding only.
    for (const call of loop.calls) {
      assertEquals(call.headers.get('Authorization'), null);
      assertEquals(call.headers.get('Cookie'), null);
      assertEquals(call.headers.get('Accept-Encoding'), 'identity');
    }
  },
);

Deno.test(
  'THR-07: JOB-27 marks a link capture to the metadata service SSRF_BLOCKED without any fetch or model call',
  async () => {
    const { fx } = await assistApi();
    const stub = stubFetch(() => new Response(HTML, { headers: { 'Content-Type': 'text/html' } }));
    const resolver = resolverFor({ 'innocent.example': { A: ['169.254.169.254'] } });
    for (const url of ['https://innocent.example/share', 'https://[fd00:ec2::254]/latest']) {
      const capture = captureRow({ kind: 'link', source_url: url });
      fx.store.captures.push(capture);
      const out = await runCaptureAnalysis(
        { ...fx.jobs, fetch: stub.fetch, resolver },
        jobContext({ capture_id: capture.id }, { type: 'capture_analysis' }),
      );
      assertEquals([out.status, out.error_code], ['failed', 'SSRF_BLOCKED'], url);
    }
    assertEquals(stub.calls.length, 0);
    assertEquals(fx.ai.calls, [], 'nothing reached the model');
  },
);

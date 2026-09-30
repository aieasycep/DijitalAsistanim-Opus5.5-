import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseServerEnv } from '../src/env/schema.ts';
import {
  appleAppSiteAssociation,
  assetLinks,
  jsonResponse,
  microsoftIdentityAssociation,
  securityTxt,
} from '../src/lib/well-known.ts';

const FINGERPRINT = Array.from({ length: 32 }, (_, index) =>
  index.toString(16).padStart(2, '0').toUpperCase(),
).join(':');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('well-known builders (W-SYS-01/02)', () => {
  it('AASA lists the env-driven app ID and the universal link paths', () => {
    const result = appleAppSiteAssociation(parseServerEnv({ APPLE_TEAM_ID: 'ABCDE12345' }));
    expect(result.ok).toBe(true);
    const body = (
      result as {
        body: { applinks: { details: { appIDs: string[]; components: { '/': string }[] }[] } };
      }
    ).body;
    expect(body.applinks.details[0]?.appIDs).toEqual(['ABCDE12345.com.dijitalasistan.app']);
    expect(body.applinks.details[0]?.components.map((component) => component['/'])).toEqual([
      '/app/*',
      '/r/*',
      '/oauth/done',
    ]);
  });

  it('assetlinks carries the package and every fingerprint', () => {
    const result = assetLinks(parseServerEnv({ ANDROID_SHA256_CERT_FINGERPRINTS: FINGERPRINT }));
    expect(result).toEqual({
      ok: true,
      body: [
        {
          relation: ['delegate_permission/common.handle_all_urls'],
          target: {
            namespace: 'android_app',
            package_name: 'com.dijitalasistan.app',
            sha256_cert_fingerprints: [FINGERPRINT],
          },
        },
      ],
    });
  });

  it('never invents identifiers: missing env is reported, not faked', () => {
    const env = parseServerEnv({});
    expect(appleAppSiteAssociation(env)).toEqual({ ok: false, missing: ['APPLE_TEAM_ID'] });
    expect(assetLinks(env)).toEqual({ ok: false, missing: ['ANDROID_SHA256_CERT_FINGERPRINTS'] });
    expect(microsoftIdentityAssociation(env)).toEqual({
      ok: false,
      missing: ['MICROSOFT_CLIENT_ID'],
    });
  });

  it('jsonResponse: 200 JSON, or 404 with a log line', async () => {
    const ok = jsonResponse({ ok: true, body: { a: 1 } }, 'x');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('application/json');
    expect(await ok.json()).toEqual({ a: 1 });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const missing = jsonResponse(
      { ok: false, missing: ['APPLE_TEAM_ID'] },
      'apple-app-site-association',
    );
    expect(missing.status).toBe(404);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('APPLE_TEAM_ID'));
  });

  it('security.txt expires a year ahead and names the security contact', () => {
    const text = securityTxt('https://dijitalasistan.app', new Date('2026-09-24T00:00:00Z'));
    expect(text).toContain('Contact: mailto:guvenlik@dijitalasistan.app');
    expect(text).toContain('Expires: 2027-09-24T00:00:00.000Z');
    expect(text).toContain('Canonical: https://dijitalasistan.app/.well-known/security.txt');
  });
});

describe('well-known route handlers', () => {
  it('serve JSON when the env is set', async () => {
    vi.stubEnv('APPLE_TEAM_ID', 'ABCDE12345');
    vi.stubEnv('ANDROID_SHA256_CERT_FINGERPRINTS', FINGERPRINT);
    vi.stubEnv('MICROSOFT_CLIENT_ID', '11111111-2222-4333-8444-555555555555');
    const aasa = await import('../src/app/well-known/apple-app-site-association/route.ts');
    const assets = await import('../src/app/well-known/assetlinks.json/route.ts');
    const microsoft =
      await import('../src/app/well-known/microsoft-identity-association.json/route.ts');
    expect(aasa.GET().status).toBe(200);
    expect(assets.GET().status).toBe(200);
    const body = (await microsoft.GET().json()) as {
      associatedApplications: { applicationId: string }[];
    };
    expect(body.associatedApplications[0]?.applicationId).toBe(
      '11111111-2222-4333-8444-555555555555',
    );
  });

  it('answer 404 and log when the env is unset', async () => {
    vi.stubEnv('APPLE_TEAM_ID', '');
    vi.stubEnv('ANDROID_SHA256_CERT_FINGERPRINTS', '');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const aasa = await import('../src/app/well-known/apple-app-site-association/route.ts');
    const assets = await import('../src/app/well-known/assetlinks.json/route.ts');
    expect(aasa.GET().status).toBe(404);
    expect(assets.GET().status).toBe(404);
    expect(log).toHaveBeenCalledTimes(2);
  });
});

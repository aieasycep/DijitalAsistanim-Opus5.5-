import { expect, test } from '@playwright/test';
import { E2E_ENV, WEB_ORIGIN } from './stub/constants.ts';

/**
 * WEB-E2E-09. The values come from the E2E build environment (fixture Team ID and fingerprint);
 * production values are an external credential (Apple Team ID, Play signing certificate).
 */
test.describe('well-known files (WEB-E2E-09)', () => {
  test('apple-app-site-association: 200 JSON, no redirect, env-driven app ID and paths', async ({
    request,
  }) => {
    const response = await request.get(`${WEB_ORIGIN}/.well-known/apple-app-site-association`, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    const body = (await response.json()) as {
      applinks: { details: { appIDs: string[]; components: { '/': string }[] }[] };
      webcredentials?: { apps: string[] };
    };
    const detail = body.applinks.details[0];
    expect(detail?.appIDs).toContain(`${E2E_ENV.APPLE_TEAM_ID}.com.dijitalasistan.app`);
    expect(detail?.components.map((component) => component['/'])).toEqual([
      '/app/*',
      '/r/*',
      '/oauth/done',
    ]);
  });

  test('assetlinks.json: package and SHA-256 fingerprints from env', async ({ request }) => {
    const response = await request.get(`${WEB_ORIGIN}/.well-known/assetlinks.json`, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    const body = (await response.json()) as {
      relation: string[];
      target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
    }[];
    expect(body[0]?.relation).toContain('delegate_permission/common.handle_all_urls');
    expect(body[0]?.target.package_name).toBe('com.dijitalasistan.app');
    expect(body[0]?.target.sha256_cert_fingerprints).toEqual([
      E2E_ENV.ANDROID_SHA256_CERT_FINGERPRINTS,
    ]);
  });

  test('microsoft-identity-association.json names the configured client ID', async ({
    request,
  }) => {
    const response = await request.get(
      `${WEB_ORIGIN}/.well-known/microsoft-identity-association.json`,
    );
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { associatedApplications: { applicationId: string }[] };
    expect(body.associatedApplications[0]?.applicationId).toBe(E2E_ENV.MICROSOFT_CLIENT_ID);
  });

  test('security.txt lists the security contact and an expiry', async ({ request }) => {
    const response = await request.get(`${WEB_ORIGIN}/.well-known/security.txt`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/plain');
    const text = await response.text();
    expect(text).toContain('Contact: mailto:guvenlik@dijitalasistan.app');
    expect(text).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T/mu);
  });

  test('unknown well-known files are 404', async ({ request }) => {
    const response = await request.get(`${WEB_ORIGIN}/.well-known/change-password`);
    expect(response.status()).toBe(404);
  });
});

import type { ServerEnv } from '../env/schema.ts';
import { SECURITY_EMAIL, UNIVERSAL_LINK_COMPONENTS } from './site.ts';

/**
 * Bodies of the `/.well-known/*` files (SCREEN_AND_FLOW_MAP Part 5 W-SYS-01/02/06/08). Values come
 * only from the environment: when an identifier is missing the file does not exist (the handler
 * answers 404 and logs why) — the site never publishes an invented team ID or fingerprint.
 */

export type WellKnownResult =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly missing: readonly string[] };

export function appleAppSiteAssociation(env: ServerEnv): WellKnownResult {
  if (env.APPLE_TEAM_ID === undefined) return { ok: false, missing: ['APPLE_TEAM_ID'] };
  return {
    ok: true,
    body: {
      applinks: {
        details: [
          {
            appIDs: [`${env.APPLE_TEAM_ID}.${env.IOS_BUNDLE_IDENTIFIER}`],
            components: UNIVERSAL_LINK_COMPONENTS.map((path) =>
              path === '/oauth/done'
                ? { '/': path, comment: 'integration OAuth fallback' }
                : { '/': path },
            ),
          },
        ],
      },
    },
  };
}

export function assetLinks(env: ServerEnv): WellKnownResult {
  const fingerprints = env.ANDROID_SHA256_CERT_FINGERPRINTS;
  if (fingerprints === undefined)
    return { ok: false, missing: ['ANDROID_SHA256_CERT_FINGERPRINTS'] };
  return {
    ok: true,
    body: [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: env.ANDROID_PACKAGE,
          sha256_cert_fingerprints: fingerprints,
        },
      },
    ],
  };
}

export function microsoftIdentityAssociation(env: ServerEnv): WellKnownResult {
  if (env.MICROSOFT_CLIENT_ID === undefined) return { ok: false, missing: ['MICROSOFT_CLIENT_ID'] };
  return {
    ok: true,
    body: { associatedApplications: [{ applicationId: env.MICROSOFT_CLIENT_ID }] },
  };
}

/** RFC 9116 security.txt; `Expires` is one year after `now` (the build or request time). */
export function securityTxt(siteUrl: string, now: Date): string {
  const expires = new Date(now.getTime() + 365 * 86_400_000);
  return [
    `Contact: mailto:${SECURITY_EMAIL}`,
    `Expires: ${expires.toISOString()}`,
    'Preferred-Languages: tr, en',
    `Canonical: ${siteUrl}/.well-known/security.txt`,
    `Policy: ${siteUrl}/support#faq-security-report`,
    '',
  ].join('\n');
}

export function jsonResponse(result: WellKnownResult, file: string): Response {
  if (!result.ok) {
    console.error(
      `[well-known] ${file} is not served: missing ${result.missing.join(', ')} (External credential required)`,
    );
    return new Response('Not Found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }
  return new Response(JSON.stringify(result.body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600',
    },
  });
}

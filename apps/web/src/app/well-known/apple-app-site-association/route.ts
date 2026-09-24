import { serverEnv } from '@/env/server.ts';
import { appleAppSiteAssociation, jsonResponse } from '@/lib/well-known.ts';

/**
 * W-SYS-01 · `/.well-known/apple-app-site-association` (served through a rewrite, never a
 * redirect). Built from `APPLE_TEAM_ID` + `IOS_BUNDLE_IDENTIFIER`; without a team ID it is a 404.
 */
export function GET(): Response {
  return jsonResponse(appleAppSiteAssociation(serverEnv()), 'apple-app-site-association');
}

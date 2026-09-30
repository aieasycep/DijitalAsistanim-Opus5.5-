import { serverEnv } from '@/env/server.ts';
import { jsonResponse, microsoftIdentityAssociation } from '@/lib/well-known.ts';

/**
 * W-SYS-08 · Microsoft Entra publisher-domain verification file, built from the public
 * `MICROSOFT_CLIENT_ID`; without it the file does not exist (404).
 */
export function GET(): Response {
  return jsonResponse(
    microsoftIdentityAssociation(serverEnv()),
    'microsoft-identity-association.json',
  );
}

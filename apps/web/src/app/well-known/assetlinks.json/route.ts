import { serverEnv } from '@/env/server.ts';
import { assetLinks, jsonResponse } from '@/lib/well-known.ts';

/**
 * W-SYS-02 · `/.well-known/assetlinks.json` for Android App Links. Built from `ANDROID_PACKAGE` and
 * `ANDROID_SHA256_CERT_FINGERPRINTS`; without fingerprints it is a 404.
 */
export function GET(): Response {
  return jsonResponse(assetLinks(serverEnv()), 'assetlinks.json');
}

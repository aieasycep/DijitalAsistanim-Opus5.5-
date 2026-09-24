/**
 * Which sign-in providers this Supabase project has enabled, read before sign-in from the public
 * GoTrue settings endpoint (`GET /auth/v1/settings`, publishable key). It decides the
 * "Harici kimlik bilgisi gerekli" rows (M-ON-05: a provider that is not configured is shown as a
 * disabled row, never as a button that fails) and whether Android offers Apple through the web flow
 * (D-04 `apple_web_oauth_enabled`: the Supabase Apple provider is on). When the settings cannot be
 * read (offline, network) every provider is assumed available and real errors surface on tap.
 */
import type { ExpoClientEnv } from '@da/validation/env';
import { z } from 'zod';

import { getClientEnv } from '../env';
import { googleClientConfig } from './google';

const AuthSettings = z.object({
  external: z
    .object({
      apple: z.boolean().optional(),
      google: z.boolean().optional(),
      azure: z.boolean().optional(),
      email: z.boolean().optional(),
    })
    .partial(),
});

export interface ProviderAvailability {
  readonly apple: boolean;
  readonly google: boolean;
  readonly microsoft: boolean;
  readonly email: boolean;
}

export const ASSUME_AVAILABLE: ProviderAvailability = {
  apple: true,
  google: true,
  microsoft: true,
  email: true,
};

export async function fetchProviderAvailability(
  env: Pick<
    ExpoClientEnv,
    | 'EXPO_PUBLIC_SUPABASE_URL'
    | 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
    | 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'
    | 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'
  > = getClientEnv(),
  fetchImpl: typeof fetch = fetch,
  os?: string,
): Promise<ProviderAvailability> {
  const googleClient = googleClientConfig(env, os) !== null;
  try {
    const response = await fetchImpl(
      `${env.EXPO_PUBLIC_SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/settings`,
      { headers: { apikey: env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY } },
    );
    if (!response.ok) return { ...ASSUME_AVAILABLE, google: googleClient };
    const parsed = AuthSettings.safeParse(await response.json());
    if (!parsed.success) return { ...ASSUME_AVAILABLE, google: googleClient };
    const external = parsed.data.external;
    return {
      apple: external.apple !== false,
      google: googleClient && external.google !== false,
      microsoft: external.azure !== false,
      email: external.email !== false,
    };
  } catch {
    return { ...ASSUME_AVAILABLE, google: googleClient };
  }
}

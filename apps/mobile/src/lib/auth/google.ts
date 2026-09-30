/**
 * Google sign-in (ADR-06, INTEGRATION_PLAN §8.2): `@react-native-google-signin/google-signin`
 * (Original API) → `supabase.auth.signInWithIdToken({provider:'google'})`. Scopes stay at
 * openid/email/profile (`scopes: []`); mail and calendar access are separate integrations. The
 * client IDs are external credentials (INTEGRATION_PLAN §15): the SDK is configured only when
 * `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (and on iOS `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`) is present;
 * otherwise the button shows the `external_credential_required` state instead of failing.
 */
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import type { ExpoClientEnv } from '@da/validation/env';
import { Platform } from 'react-native';

import { getClientEnv } from '../env';
import { authFailureOf, failed, succeeded, type AuthResult } from './result';
import { getSupabase, type AppSupabaseClient } from './supabase';

export interface GoogleClientConfig {
  readonly webClientId: string;
  readonly iosClientId?: string;
}

/** The client IDs this platform needs, or null when they are not configured. */
export function googleClientConfig(
  env: Pick<ExpoClientEnv, 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID' | 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'>,
  os: string = Platform.OS,
): GoogleClientConfig | null {
  const webClientId = env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  if (webClientId === undefined) return null;
  if (os !== 'ios') return { webClientId };
  const iosClientId = env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  return iosClientId === undefined ? null : { webClientId, iosClientId };
}

export function isGoogleConfigured(): boolean {
  return googleClientConfig(getClientEnv()) !== null;
}

let configuredFor: string | null = null;

export interface GoogleSignInDeps {
  readonly supabase?: AppSupabaseClient;
  readonly config?: GoogleClientConfig | null;
}

export async function signInWithGoogle(deps: GoogleSignInDeps = {}): Promise<AuthResult> {
  const config = deps.config === undefined ? googleClientConfig(getClientEnv()) : deps.config;
  if (config === null) return failed('not_configured');
  const signature = `${config.webClientId}|${config.iosClientId ?? ''}`;
  if (configuredFor !== signature) {
    GoogleSignin.configure({
      webClientId: config.webClientId,
      ...(config.iosClientId === undefined ? {} : { iosClientId: config.iosClientId }),
      scopes: [],
    });
    configuredFor = signature;
  }
  let idToken: string | null;
  try {
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return failed('cancelled');
    idToken = response.data.idToken;
  } catch (error) {
    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED || error.code === statusCodes.IN_PROGRESS) {
        return failed('cancelled');
      }
      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return failed('play_services');
    }
    return failed('provider');
  }
  if (idToken === null) return failed('provider');
  try {
    const supabase = deps.supabase ?? getSupabase();
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });
    if (error !== null) return failed(authFailureOf(error));
    return succeeded(data.user);
  } catch (error) {
    return failed(authFailureOf(error));
  }
}

export function resetGoogleForTests(): void {
  configuredFor = null;
}

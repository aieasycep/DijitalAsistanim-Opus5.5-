/**
 * RevenueCat (`react-native-purchases` 10.10.1, INTEGRATION_PLAN §10, SCREEN_AND_FLOW_MAP §7):
 * - configured lazily, after a Supabase session exists, with `appUserID = user.id`; the platform
 *   public SDK key in production, the Test Store key in development and demo builds when present
 *   (`clientEnv.expo` refuses a Test Store key in production). Without a key the paywall shows
 *   the "harici kimlik bilgisi gerekli" state (External credential required: RevenueCat public
 *   SDK keys, store products and App Store Connect / Play Console agreements).
 * - `Purchases.logIn(userId)` after every sign-in (`registerPostSignInHook`) and
 *   `Purchases.logOut()` before the session is removed (`registerLogoutCleanup`).
 * - every customer-info update is mirrored to the server with `POST /purchases/sync`, which stays
 *   authoritative (`GET /me/entitlements`, `effective_entitlement()`).
 */
import { qk } from '@da/api-client';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import Purchases, {
  INTRO_ELIGIBILITY_STATUS,
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases';

import { LOGOUT_HOOKS, registerLogoutCleanup } from './auth/logout';
import { registerPostSignInHook } from './auth/post-sign-in';
import { getSupabase } from './auth/supabase';
import { getApiClient } from './bootstrap';
import { getClientEnv } from './env';
import { getQueryClient } from './query/client';

export { PURCHASES_ERROR_CODE };
export type { PurchasesOffering, PurchasesPackage };

let keyOverride: string | null | undefined;

/** The RevenueCat public SDK key of this build, or null (external credential required). */
export function revenueCatKey(): string | null {
  if (keyOverride !== undefined) return keyOverride;
  const env = getClientEnv();
  const test = env.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY;
  const devOrDemo = env.EXPO_PUBLIC_APP_ENV !== 'production';
  if (devOrDemo && test !== undefined && test !== '') return test;
  const key =
    Platform.OS === 'android'
      ? env.EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY
      : env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY;
  return key === undefined || key === '' ? null : key;
}

export function isPurchasesConfigured(): boolean {
  return revenueCatKey() !== null;
}

let configuredFor: string | null = null;
let listening = false;

async function currentUserId(): Promise<string | null> {
  try {
    return (await getSupabase().auth.getSession()).data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

/** `POST /purchases/sync`, then the entitlement queries are refreshed. */
export async function syncPurchases(reason: 'purchase' | 'restore' | 'app_open'): Promise<void> {
  const userId = configuredFor ?? (await currentUserId());
  if (userId === null) return;
  try {
    await getApiClient().call(
      'POST /purchases/sync',
      { body: { reason, rc_app_user_id: userId } },
      { idempotencyKey: Crypto.randomUUID() },
    );
  } finally {
    const queryClient = getQueryClient();
    void queryClient.invalidateQueries({ queryKey: qk.me.entitlements() });
    void queryClient.invalidateQueries({ queryKey: qk.me.bootstrap() });
  }
}

/** Configures (once) or logs in the given user; false when no SDK key exists. */
export async function ensurePurchases(userId?: string): Promise<boolean> {
  const key = revenueCatKey();
  if (key === null) return false;
  const id = userId ?? (await currentUserId());
  if (id === null) return false;
  if (configuredFor === null) {
    Purchases.configure({ apiKey: key, appUserID: id });
    configuredFor = id;
  } else if (configuredFor !== id) {
    await Purchases.logIn(id);
    configuredFor = id;
  }
  if (!listening) {
    listening = true;
    Purchases.addCustomerInfoUpdateListener(() => {
      void syncPurchases('purchase').catch(() => undefined);
    });
  }
  return true;
}

export async function getCurrentOffering(): Promise<PurchasesOffering | null> {
  if (!(await ensurePurchases())) return null;
  return (await Purchases.getOfferings()).current;
}

/** Trial days of a package when the store reports this user as eligible, else null. */
export async function trialDaysFor(pkg: PurchasesPackage): Promise<number | null> {
  const product = pkg.product;
  if (Platform.OS === 'android') {
    const phase = product.defaultOption?.freePhase ?? null;
    if (phase === null) return null;
    const unit: string = phase.billingPeriod.unit;
    const value = phase.billingPeriod.value;
    return unit === 'DAY'
      ? value
      : unit === 'WEEK'
        ? value * 7
        : unit === 'MONTH'
          ? value * 30
          : null;
  }
  const intro = product.introPrice;
  if (intro?.price !== 0) return null;
  try {
    const eligibility = await Purchases.checkTrialOrIntroductoryPriceEligibility([
      product.identifier,
    ]);
    if (
      eligibility[product.identifier]?.status !==
      INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE
    ) {
      return null;
    }
  } catch {
    return null;
  }
  const n = intro.periodNumberOfUnits;
  switch (intro.periodUnit) {
    case 'DAY':
      return n;
    case 'WEEK':
      return n * 7;
    case 'MONTH':
      return n * 30;
    default:
      return null;
  }
}

export function hasProEntitlement(info: CustomerInfo): boolean {
  return info.entitlements.active.pro !== undefined;
}

export async function purchase(pkg: PurchasesPackage): Promise<CustomerInfo> {
  return (await Purchases.purchasePackage(pkg)).customerInfo;
}

export async function restore(): Promise<CustomerInfo> {
  await ensurePurchases();
  return Purchases.restorePurchases();
}

export async function showManageSubscriptions(): Promise<void> {
  await ensurePurchases();
  await Purchases.showManageSubscriptions();
}

export async function canMakePayments(): Promise<boolean> {
  try {
    return await Purchases.canMakePayments();
  } catch {
    return true;
  }
}

/** A `PurchasesError` code, or null for other failures. */
export function purchaseErrorCode(error: unknown): PURCHASES_ERROR_CODE | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = error.code;
  return Object.values(PURCHASES_ERROR_CODE).includes(code as PURCHASES_ERROR_CODE)
    ? (code as PURCHASES_ERROR_CODE)
    : null;
}

/** RevenueCat logs out an anonymous user with an error; that is not a failure here. */
export async function logOutPurchases(): Promise<void> {
  if (configuredFor === null) return;
  try {
    await Purchases.logOut();
  } catch {
    // Anonymous or already logged out.
  }
  configuredFor = null;
}

export function resetPurchasesForTests(key?: string | null): void {
  configuredFor = null;
  listening = false;
  keyOverride = key;
}

registerPostSignInHook('revenuecat.log_in', async (ctx) => {
  await ensurePurchases(ctx.userId);
});
registerLogoutCleanup(LOGOUT_HOOKS.revenueCat, logOutPurchases, 'before_sign_out');

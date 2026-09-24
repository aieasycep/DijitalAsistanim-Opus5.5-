/**
 * Paywall copy decisions (M-PAY-01, C-09/C-10, Apple 3.1.2): the annual savings computed from the
 * store prices (never hard-coded), the CTA variant (trial only when the store reports an eligible
 * free phase), and the analytics mappings of sources and purchase errors.
 */
import { PAYWALL_SOURCES } from '@da/domain/analytics/vocab';

import { PURCHASES_ERROR_CODE } from '../../lib/purchases';

export type PaywallSource = (typeof PAYWALL_SOURCES)[number];

const SOURCES: readonly PaywallSource[] = PAYWALL_SOURCES;

/** The analytics `source` of the `source` param (`gate_<id>` and screen names normalised). */
export function paywallSourceOf(value: string | undefined): PaywallSource {
  if (value === undefined) return 'deeplink';
  const normalised = value
    .replace(/^gate_/, '')
    .replace(/^subscription_screen$/, 'subscription')
    .replace(/^briefing_settings$/, 'settings')
    .replace(/^deep_link$/, 'deeplink');
  return SOURCES.find((s) => s === normalised) ?? 'deeplink';
}

/**
 * Annual savings in whole percent: round((1 − annual / (monthly × 12)) × 100). Shown only when ≥ 1
 * and both prices are in the same currency.
 */
export function annualSavings(
  annual: { readonly price: number; readonly currencyCode: string },
  monthly: { readonly price: number; readonly currencyCode: string },
): number | null {
  if (annual.currencyCode !== monthly.currencyCode || monthly.price <= 0) return null;
  const percent = Math.round((1 - annual.price / (monthly.price * 12)) * 100);
  return percent >= 1 ? percent : null;
}

export type CtaVariant =
  | { readonly kind: 'trial'; readonly days: number }
  | { readonly kind: 'upgrade' }
  | { readonly kind: 'change' };

export function ctaVariant(mode: 'change' | null, trialDays: number | null): CtaVariant {
  if (mode === 'change') return { kind: 'change' };
  if (trialDays !== null && trialDays > 0) return { kind: 'trial', days: trialDays };
  return { kind: 'upgrade' };
}

/** `purchase_failed.code` for a RevenueCat error code. */
export function purchaseFailureCode(
  code: PURCHASES_ERROR_CODE | null,
):
  | 'PURCHASE_NOT_ALLOWED'
  | 'PRODUCT_NOT_AVAILABLE'
  | 'PAYMENT_PENDING'
  | 'STORE_PROBLEM'
  | 'NETWORK_ERROR'
  | 'UNKNOWN' {
  switch (code) {
    case PURCHASES_ERROR_CODE.PURCHASE_NOT_ALLOWED_ERROR:
      return 'PURCHASE_NOT_ALLOWED';
    case PURCHASES_ERROR_CODE.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR:
      return 'PRODUCT_NOT_AVAILABLE';
    case PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR:
      return 'PAYMENT_PENDING';
    case PURCHASES_ERROR_CODE.STORE_PROBLEM_ERROR:
      return 'STORE_PROBLEM';
    case PURCHASES_ERROR_CODE.NETWORK_ERROR:
      return 'NETWORK_ERROR';
    default:
      return 'UNKNOWN';
  }
}

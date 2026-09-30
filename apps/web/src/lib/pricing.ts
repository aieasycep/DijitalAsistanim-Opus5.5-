import type { Locale } from '@da/i18n';
import type { PricingDisplay, PublicPlans } from './public-api/schemas.ts';

/**
 * Store-authoritative price display (SCREEN_AND_FLOW_MAP Part 5 §2.2). The site never states a
 * price that finance has not verified in the last 90 days, and never mentions a trial unless the
 * store has an intro offer configured.
 */

export const PRICE_MAX_AGE_DAYS = 90;

export interface Range {
  readonly min: number;
  readonly max: number;
}

export interface PricingView {
  readonly monthly: Range;
  readonly annual: Range;
  readonly annualPerMonth: Range;
  /** Whole-percent annual savings; null when below 1 % or not computable. */
  readonly savings: Range | null;
  readonly asOf: string;
  readonly introOfferDays: number | null;
}

const DAY_MS = 86_400_000;

function range(values: readonly number[]): Range | null {
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

export function isPricingFresh(pricing: PricingDisplay, now: Date): boolean {
  const asOf = Date.parse(`${pricing.as_of}T00:00:00Z`);
  if (Number.isNaN(asOf)) return false;
  const age = (now.getTime() - asOf) / DAY_MS;
  return age >= 0 && age <= PRICE_MAX_AGE_DAYS;
}

/** `null` means "show no price": missing, unverified, stale or incomplete. */
export function pricingView(pricing: PricingDisplay | null, now: Date): PricingView | null {
  if (pricing === null || !pricing.verified || !isPricingFresh(pricing, now)) return null;
  const stores = ['app_store', 'play'] as const;
  const monthly = range(
    stores.map((s) => pricing.monthly[s]).filter((v): v is number => v !== null),
  );
  const annual = range(stores.map((s) => pricing.annual[s]).filter((v): v is number => v !== null));
  if (monthly === null || annual === null) return null;
  const perStoreSavings = stores.flatMap((s) => {
    const m = pricing.monthly[s];
    const a = pricing.annual[s];
    if (m === null || a === null) return [];
    return [Math.round((1 - a / (m * 12)) * 100)];
  });
  const savingsRange = range(perStoreSavings);
  const savings = savingsRange !== null && savingsRange.min >= 1 ? savingsRange : null;
  return {
    monthly,
    annual,
    annualPerMonth: { min: annual.min / 12, max: annual.max / 12 },
    savings,
    asOf: pricing.as_of,
    introOfferDays: pricing.intro_offer?.days ?? null,
  };
}

/** TRY amounts: "₺199" / "₺1.490" (tr), "TRY 199" (en); cents only when present. */
export function formatTry(value: number, locale: Locale): string {
  const rounded = Math.round(value * 100) / 100;
  const whole = Number.isInteger(rounded);
  return new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-US', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rounded);
}

export function formatTryRange(value: Range, locale: Locale): string {
  return value.min === value.max
    ? formatTry(value.min, locale)
    : `${formatTry(value.min, locale)}–${formatTry(value.max, locale)}`;
}

export function formatPercentRange(value: Range): string {
  return value.min === value.max ? String(value.min) : `${String(value.min)}–${String(value.max)}`;
}

/** Free-plan numbers for ICU arguments, or null when `/plans` is unavailable. */
export interface FreeLimits {
  readonly mail: number;
  readonly cal: number;
  readonly n: number;
}

export function freeLimits(plans: PublicPlans | null): FreeLimits | null {
  if (plans === null) return null;
  return {
    mail: plans.free.mail_accounts,
    cal: plans.free.calendars,
    n: plans.free.ai_analyses_per_day,
  };
}

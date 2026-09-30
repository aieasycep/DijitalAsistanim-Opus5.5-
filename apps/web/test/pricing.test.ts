import { describe, expect, it } from 'vitest';
import {
  formatPercentRange,
  formatTry,
  formatTryRange,
  freeLimits,
  pricingView,
} from '../src/lib/pricing.ts';
import type { PricingDisplay, PublicPlans } from '../src/lib/public-api/schemas.ts';

const NOW = new Date('2026-09-24T12:00:00Z');
const PRICING: PricingDisplay = {
  storefront: 'TR',
  currency: 'TRY',
  as_of: '2026-09-14',
  verified: true,
  monthly: { app_store: 199, play: 209 },
  annual: { app_store: 1490, play: 1490 },
  intro_offer: null,
};

describe('pricing view (W-PRICE-01, C-10)', () => {
  it('derives ranges and savings from store prices', () => {
    const view = pricingView(PRICING, NOW);
    expect(view?.monthly).toEqual({ min: 199, max: 209 });
    expect(view?.annual).toEqual({ min: 1490, max: 1490 });
    expect(view?.savings).toEqual({ min: 38, max: 41 });
    expect(view?.introOfferDays).toBeNull();
  });

  it('shows no price when unverified, stale or incomplete', () => {
    expect(pricingView(null, NOW)).toBeNull();
    expect(pricingView({ ...PRICING, verified: false }, NOW)).toBeNull();
    expect(pricingView({ ...PRICING, as_of: '2026-06-01' }, NOW)).toBeNull();
    expect(pricingView({ ...PRICING, monthly: { app_store: null, play: null } }, NOW)).toBeNull();
  });

  it('mentions a trial only when the store defines one', () => {
    expect(
      pricingView({ ...PRICING, intro_offer: { days: 7, stores: ['app_store'] } }, NOW)
        ?.introOfferDays,
    ).toBe(7);
  });

  it('formats TRY per locale', () => {
    expect(formatTry(1490, 'tr')).toBe('₺1.490');
    expect(formatTry(124.17, 'tr')).toBe('₺124,17');
    expect(formatTry(1490, 'en')).toBe('TRY\u00a01,490');
    expect(formatTryRange({ min: 199, max: 209 }, 'tr')).toBe('₺199–₺209');
    expect(formatTryRange({ min: 199, max: 199 }, 'tr')).toBe('₺199');
    expect(formatPercentRange({ min: 38, max: 41 })).toBe('38–41');
  });

  it('passes the free-plan numbers through from /plans', () => {
    const plans: PublicPlans = {
      free: { mail_accounts: 1, calendars: 1, ai_analyses_per_day: 50 },
      pro: { mail_accounts: 'multiple', calendars: 'multiple', ai_policy: 'fair_use' },
      pricing: PRICING,
      updated_at: '2026-09-14T00:00:00Z',
    };
    expect(freeLimits(plans)).toEqual({ mail: 1, cal: 1, n: 50 });
    expect(freeLimits(null)).toBeNull();
  });
});

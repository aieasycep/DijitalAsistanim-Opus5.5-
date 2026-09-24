/**
 * T-8.22 paywall, subscription, Pro gates and referral: UT-ENT-13 (`paywallCopy.ts` savings and
 * trial rules), UT-MB-10 (no hard-coded "TL", trial CTA only when eligible, close / restore /
 * Terms / Privacy present), the purchase flow that waits for the server entitlement, the
 * subscription hero, referral share / copy / code entry, the pending referral and install-referrer
 * handling, and the RevenueCat log-in / log-out hooks.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Clipboard from 'expo-clipboard';
import { fireEvent, screen, waitFor } from 'expo-router/testing-library';
import { Share } from 'react-native';
import Purchases from 'react-native-purchases';

import {
  annualSavings,
  ctaVariant,
  paywallSourceOf,
  purchaseFailureCode,
} from '../src/features/paywall/paywallCopy';
import { applyPendingReferral, codeFromReferrer } from '../src/features/referral/pending';
import { logout } from '../src/lib/auth/logout';
import { runPostSignIn } from '../src/lib/auth/post-sign-in';
import { savePendingReferralCode, takePendingReferralCode } from '../src/lib/deeplinks';
import { PURCHASES_ERROR_CODE, resetPurchasesForTests } from '../src/lib/purchases';
import { installApi, json, resetAppState } from './helpers/app';
import { bootstrap, errorBody, ok, uuid } from './helpers/fixtures';
import { events, openApp, PRO_ENTITLEMENT } from './helpers/journeys';

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageTag: 'tr-TR' }]),
  getCalendars: jest.fn(() => [{ timeZone: 'Europe/Istanbul' }]),
}));

// The RevenueCat double's static methods are asserted as jest mocks (never called unbound).
/* eslint-disable @typescript-eslint/unbound-method */
const purchases = jest.mocked(Purchases);

beforeEach(async () => {
  await resetAppState();
  resetPurchasesForTests(null);
  jest.clearAllMocks();
});

function product(id: string, price: number, priceString: string, intro: unknown = null) {
  return {
    identifier: id,
    price,
    priceString,
    currencyCode: 'TRY',
    pricePerMonthString: id.includes('annual') ? '₺124,17' : priceString,
    introPrice: intro,
    defaultOption: null,
  };
}

function offering(introOnAnnual: unknown = null) {
  return {
    current: {
      identifier: 'default',
      annual: {
        identifier: '$rc_annual',
        product: product('da_pro_annual', 1490, '₺1.490,00', introOnAnnual),
      },
      monthly: { identifier: '$rc_monthly', product: product('da_pro_monthly', 199, '₺199,00') },
      availablePackages: [],
    },
    all: {},
  };
}

const ENTITLEMENTS_FREE = { entitlement: bootstrap().entitlement, usage: bootstrap().usage };
const ENTITLEMENTS_PRO = {
  entitlement: {
    ...PRO_ENTITLEMENT,
    store: {
      ...PRO_ENTITLEMENT.store,
      active: true,
      store: 'test_store',
      product_id: 'da_pro_annual',
      period_type: 'normal',
      will_renew: true,
      expires_at: '2027-09-24T08:00:00Z',
    },
  },
  usage: { ...bootstrap().usage, plan: 'pro' },
};

describe('UT-ENT-13 paywall copy', () => {
  it('computes the annual savings from store prices only', () => {
    expect(
      annualSavings({ price: 1490, currencyCode: 'TRY' }, { price: 199, currencyCode: 'TRY' }),
    ).toBe(38);
    expect(
      annualSavings({ price: 1490, currencyCode: 'TRY' }, { price: 199, currencyCode: 'USD' }),
    ).toBeNull();
    expect(
      annualSavings({ price: 2400, currencyCode: 'TRY' }, { price: 199, currencyCode: 'TRY' }),
    ).toBeNull();
  });

  it('offers the trial only when the store reports an eligible free phase', () => {
    expect(ctaVariant(null, 7)).toEqual({ kind: 'trial', days: 7 });
    expect(ctaVariant(null, null)).toEqual({ kind: 'upgrade' });
    expect(ctaVariant('change', 7)).toEqual({ kind: 'change' });
  });

  it('normalises sources and purchase errors for analytics', () => {
    expect(paywallSourceOf('gate_midday')).toBe('midday');
    expect(paywallSourceOf('subscription_screen')).toBe('subscription');
    expect(paywallSourceOf('whatever')).toBe('deeplink');
    expect(purchaseFailureCode(PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR)).toBe('PAYMENT_PENDING');
    expect(purchaseFailureCode(null)).toBe('UNKNOWN');
  });

  it('has no hard-coded TL price literal in the app sources (UT-MB-10)', () => {
    const root = join(__dirname, '..', 'src');
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        return statSync(full).isDirectory() ? walk(full) : /\.tsx?$/.test(name) ? [full] : [];
      });
    for (const file of walk(root)) {
      expect([file, /['"`][^'"`]*(\bTL\b|₺)[^'"`]*['"`]/.test(readFileSync(file, 'utf8'))]).toEqual(
        [file, false],
      );
    }
  });
});

describe('M-PAY-01 paywall (UT-MB-10)', () => {
  it('says purchases are not configured without RevenueCat keys, with close and legal links', async () => {
    await openApp({ path: '/paywall?source=hub_upgrade' });
    expect(
      await screen.findByText(
        'Satın alma bu ortamda yapılandırılmamış (harici kimlik bilgisi gerekli).',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('paywall.close')).toBeTruthy();
    expect(screen.getByTestId('paywall.terms')).toBeTruthy();
    expect(screen.getByTestId('paywall.privacy')).toBeTruthy();
    expect(screen.getByText('Adil kullanım')).toBeTruthy();
    expect(screen.getByText('50/gün')).toBeTruthy();
    expect(events('paywall_viewed').at(-1)?.props).toMatchObject({ source: 'hub_upgrade' });
  });

  it('shows store prices, savings and the trial CTA only when eligible', async () => {
    resetPurchasesForTests('test_store_key');
    purchases.getOfferings.mockResolvedValue(
      offering({
        price: 0,
        priceString: '₺0',
        cycles: 1,
        period: 'P1W',
        periodUnit: 'DAY',
        periodNumberOfUnits: 7,
      }) as never,
    );
    purchases.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({
      da_pro_annual: { status: 2, description: 'eligible' },
    });
    await openApp({ path: '/paywall?source=gate_midday' });
    expect(await screen.findByText('7 gün ücretsiz dene')).toBeTruthy();
    expect(screen.getAllByText(/₺1\.490,00 \/ yıl/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('paywall.legal')).toHaveTextContent(/7 gün sonra/);
    expect(screen.getByText(/%38 tasarruf/)).toBeTruthy();
    expect(screen.getByTestId('paywall.restore')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('paywall.plan.monthly'));
    expect(await screen.findByText("Pro'ya Geç")).toBeTruthy();
    expect(events('paywall_package_selected').at(-1)?.props).toMatchObject({ package: 'monthly' });
  });

  it('confirms a purchase only after the server reports the entitlement', async () => {
    resetPurchasesForTests('test_store_key');
    purchases.getOfferings.mockResolvedValue(offering() as never);
    purchases.purchasePackage.mockResolvedValue({
      customerInfo: { entitlements: { active: { pro: {} }, all: {} } },
    } as never);
    const { api } = await openApp({
      path: '/paywall?source=hub_upgrade',
      routes: {
        'POST /purchases/sync': () =>
          json(200, ok({ entitlement: ENTITLEMENTS_PRO.entitlement, stale: false })),
        'GET /me/entitlements': () => json(200, ok(ENTITLEMENTS_PRO)),
      },
    });
    await fireEvent.press(await screen.findByTestId('paywall.cta'));
    expect(await screen.findByTestId('paywall.success')).toBeTruthy();
    expect(api.calls.find((c) => c.url.endsWith('/purchases/sync'))?.body).toEqual({
      reason: 'purchase',
      rc_app_user_id: uuid(1),
    });
    expect(events('purchase_completed').at(-1)?.props).toMatchObject({
      package: 'annual',
      trial: false,
    });
  });

  it('returns silently when the user cancels', async () => {
    resetPurchasesForTests('test_store_key');
    purchases.getOfferings.mockResolvedValue(offering() as never);
    purchases.purchasePackage.mockRejectedValue({ code: '1', message: 'cancelled' });
    await openApp({ path: '/paywall' });
    await fireEvent.press(await screen.findByTestId('paywall.cta'));
    await waitFor(() => {
      expect(events('purchase_cancelled')).toHaveLength(1);
    });
    expect(screen.queryByTestId('paywall.message')).toBeNull();
    expect(screen.queryByTestId('paywall.success')).toBeNull();
  });
});

describe('M-SUB-01 subscription', () => {
  it('shows the Free hero with the upgrade path', async () => {
    const { router } = await openApp({
      path: '/settings/subscription',
      routes: { 'GET /me/entitlements': () => json(200, ok(ENTITLEMENTS_FREE)) },
    });
    expect(await screen.findByTestId('subscription.hero.free')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('subscription.upgrade'));
    await waitFor(() => {
      expect(router.getPathname()).toBe('/paywall');
    });
    expect(events('subscription_opened').at(-1)?.props).toMatchObject({ state: 'free' });
  });

  it('shows the store subscription and opens store management', async () => {
    resetPurchasesForTests('test_store_key');
    await openApp({
      path: '/settings/subscription',
      routes: { 'GET /me/entitlements': () => json(200, ok(ENTITLEMENTS_PRO)) },
    });
    expect(await screen.findByTestId('subscription.hero.active')).toBeTruthy();
    expect(screen.getByText('Pro · Yıllık')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('subscription.manage'));
    await waitFor(() => {
      expect(purchases.showManageSubscriptions).toHaveBeenCalled();
    });
  });
});

const REFERRAL_ME = {
  code: 'K7M2P9Q',
  share_url: 'https://dijitalasistan.app/r/K7M2P9Q',
  reward_days: 14,
  cap_per_year: 6,
  remaining_this_year: 5,
  earned_days_total: 14,
  referrals: [
    { id: uuid(701), label: 'B***', status: 'rewarded', created_at: '2026-09-10T08:00:00Z' },
    { id: uuid(702), label: 'C***', status: 'pending', created_at: '2026-09-20T08:00:00Z' },
  ],
  referred_by: null,
};

describe('M-REF-01 / M-REF-02 referral', () => {
  it('copies and shares the real link and lists the referral statuses', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    await openApp({
      path: '/settings/referral',
      routes: { 'GET /referrals/me': () => json(200, ok(REFERRAL_ME)) },
    });
    expect(await screen.findByText('dijitalasistan.app/r/K7M2P9Q')).toBeTruthy();
    expect(screen.getByText('B***')).toBeTruthy();
    expect(screen.getByText('+14 GÜN')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('referral.share'));
    await waitFor(() => {
      expect(share).toHaveBeenCalled();
    });
    expect((share.mock.calls[0]?.[0] as { message: string }).message).toContain(
      'https://dijitalasistan.app/r/K7M2P9Q',
    );
    expect(events('referral_shared').at(-1)?.props).toMatchObject({ completed: true });
    await fireEvent.press(screen.getByText('Kopyala'));
    await waitFor(() => {
      expect(jest.mocked(Clipboard.setStringAsync)).toHaveBeenCalledWith(REFERRAL_ME.share_url);
    });
  });

  it('applies a deep-linked code and reports server rejections', async () => {
    const created = new Date(Date.now() - 2 * 86_400_000).toISOString();
    let attempt = 0;
    const { api } = await openApp({
      path: '/settings/referral?code=K7M2P9Q',
      data: bootstrap({ profile: { ...bootstrap().profile, created_at: created } }),
      routes: {
        'GET /referrals/me': () => json(200, ok(REFERRAL_ME)),
        'POST /referrals/apply': () => {
          attempt += 1;
          return attempt === 1
            ? json(422, errorBody('REFERRAL_SELF'))
            : json(
                201,
                ok({
                  referral_id: uuid(703),
                  status: 'pending',
                  reward_days: 14,
                  qualification: {
                    onboarding_completed: true,
                    account_connected: true,
                    first_briefing_delivered: false,
                    eligible_after: '2026-09-26T08:00:00Z',
                  },
                }),
              );
        },
      },
    });
    expect(await screen.findByTestId('sheet.referralCode')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('referralCode.apply'));
    expect(await screen.findByText('Kendi davet kodunu kullanamazsın.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('referralCode.apply'));
    await waitFor(() => {
      expect(attempt).toBe(2);
    });
    expect(api.calls.find((c) => c.url.endsWith('/referrals/apply'))?.body).toMatchObject({
      code: 'K7M2P9Q',
      source: 'deep_link',
    });
    expect(events('referral_code_applied').map((e) => e.props.result)).toEqual(['self', 'applied']);
  });
});

describe('pending referral codes', () => {
  it('reads the Play Install Referrer code', () => {
    expect(codeFromReferrer('utm_source=google-play&code=k7m2p9q')).toBe('K7M2P9Q');
    expect(codeFromReferrer('utm_source=google-play&utm_medium=organic')).toBeNull();
    expect(codeFromReferrer('code=0OIL1')).toBeNull();
  });

  it('applies a pending code after sign-in and keeps it after a transient failure', async () => {
    const { calls } = installApi({
      'POST /referrals/apply': () => json(503, errorBody('SERVICE_UNAVAILABLE')),
    });
    savePendingReferralCode('K7M2P9Q');
    expect(await applyPendingReferral()).toBe('error');
    expect(calls[0]?.body).toMatchObject({ code: 'K7M2P9Q', source: 'deep_link' });
    expect(takePendingReferralCode()).toBe('K7M2P9Q');
  });
});

describe('RevenueCat hooks', () => {
  it('logs in after sign-in and logs out before the session is removed (UT-MB-03)', async () => {
    resetPurchasesForTests('test_store_key');
    const { client } = installApi({
      'POST /devices/register': () =>
        json(
          200,
          ok({
            installation_id: uuid(99),
            push_enabled: false,
            rebound_from_other_user: false,
            timezone_applied: false,
          }),
        ),
      'GET /me/bootstrap': () => json(200, ok(bootstrap())),
      'POST /devices/unregister': () => json(200, ok({ disabled_tokens: 1 })),
    });
    await runPostSignIn(
      { userId: uuid(1), method: 'apple', mode: 'signin', isNewUser: false },
      { api: client, installationId: () => uuid(99) },
    );
    expect(purchases.configure).toHaveBeenCalledWith({
      apiKey: 'test_store_key',
      appUserID: uuid(1),
    });
    await logout(
      {},
      {
        api: client,
        installationId: () => uuid(99),
        wipeStorage: () => Promise.resolve(),
        unregisterPush: () => Promise.resolve(),
        cancelLocalNotifications: () => Promise.resolve(),
        isOffline: () => false,
        supabase: {
          auth: { signOut: () => Promise.resolve({ error: null }) },
        } as never,
      },
    );
    expect(purchases.logOut).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment happy-dom
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  PricingPlans,
  type PricingPlansLabels,
} from '../../src/components/pricing/PricingPlans.tsx';
import { renderWithIntl } from './render.tsx';

const LABELS: PricingPlansLabels = {
  legend: 'Ödeme dönemi',
  monthly: 'Aylık',
  annual: 'Yıllık',
  bestValue: 'EN AVANTAJLI',
  freeTitle: 'Ücretsiz',
  freePrice: '₺0',
  freeSub: 'Süre sınırı yok',
  freeCta: 'Ücretsiz Başla',
  proTitle: 'Pro',
  proCta: "Uygulamada Pro'ya geç",
  priceUnavailable: 'Güncel Pro fiyatını uygulamada görürsün.',
  trialLine: null,
  regionNote: 'Fiyatlar Türkiye mağaza fiyatlarıdır.',
};

const PRICES = {
  monthly: '₺199–₺209 / ay',
  annual: '₺1.490 / yıl',
  annualBreakdown: 'ayda yaklaşık ₺124,17 · %38–41 tasarruf',
  showBestValue: true,
  storeNote: 'Mağaza fiyatı · KDV dahil · 14 Eylül 2026 itibarıyla',
};

describe('PricingPlans (W-PRICE-01)', () => {
  it('defaults to annual and switches to monthly through the radio group', () => {
    renderWithIntl(<PricingPlans labels={LABELS} prices={PRICES} getUrl="/get?src=pricing" />);
    expect(screen.getByRole('radio', { name: /Yıllık/u })).toHaveProperty('checked', true);
    expect(screen.getByText('₺1.490 / yıl')).toBeTruthy();
    expect(screen.getByText(PRICES.annualBreakdown)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Aylık' }));
    expect(screen.getByText('₺199–₺209 / ay')).toBeTruthy();
    expect(screen.queryByText(PRICES.annualBreakdown)).toBeNull();
    // The price sits in a polite live region so the change is announced.
    expect(screen.getByText('₺199–₺209 / ay').closest('[aria-live="polite"]')).not.toBeNull();
  });

  it('without verified prices it says so instead of guessing, and hides the toggle', () => {
    renderWithIntl(<PricingPlans labels={LABELS} prices={null} getUrl="/get?src=pricing" />);
    expect(screen.getByText(LABELS.priceUnavailable)).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByText(LABELS.regionNote)).toBeNull();
  });

  it('shows the trial line only when given one', () => {
    renderWithIntl(
      <PricingPlans
        labels={{ ...LABELS, trialLine: '7 günlük deneme tanımlı.' }}
        prices={PRICES}
        getUrl="/get?src=pricing"
      />,
    );
    expect(screen.getByText('7 günlük deneme tanımlı.')).toBeTruthy();
  });

  it('both CTAs route through /get', () => {
    renderWithIntl(<PricingPlans labels={LABELS} prices={PRICES} getUrl="/get?src=pricing" />);
    for (const name of ['Ücretsiz Başla', "Uygulamada Pro'ya geç"]) {
      expect(screen.getByRole('link', { name }).getAttribute('href')).toBe('/get?src=pricing');
    }
  });
});

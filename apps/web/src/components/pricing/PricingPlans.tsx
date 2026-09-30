'use client';

import { useLocale } from 'next-intl';
import { useId, useState, type MouseEvent, type ReactNode } from 'react';
import { sendWebEvent } from '@/lib/web-events/send.ts';

export interface PlanPrices {
  readonly monthly: string;
  readonly annual: string;
  readonly annualBreakdown: string | null;
  readonly showBestValue: boolean;
  readonly storeNote: string;
}

export interface PricingPlansLabels {
  readonly legend: string;
  readonly monthly: string;
  readonly annual: string;
  readonly bestValue: string;
  readonly freeTitle: string;
  readonly freePrice: string;
  readonly freeSub: string;
  readonly freeCta: string;
  readonly proTitle: string;
  readonly proCta: string;
  readonly priceUnavailable: string;
  readonly trialLine: string | null;
  readonly regionNote: string;
}

type Period = 'monthly' | 'annual';

/**
 * W-PRICE-01 P2: plan cards with the billing-period toggle (a native radio group: arrow keys
 * work) and a polite live region, so a period change is announced. Prices are store prices
 * formatted on the server; with no verified price the Pro card says so instead of guessing.
 */
export function PricingPlans({
  labels,
  prices,
  getUrl,
}: {
  labels: PricingPlansLabels;
  prices: PlanPrices | null;
  getUrl: string;
}): ReactNode {
  const locale = useLocale();
  const [period, setPeriod] = useState<Period>('annual');
  const groupName = useId();

  const choose = (next: Period): void => {
    setPeriod(next);
    sendWebEvent('web_pricing_period', { page: 'pricing', locale }, { period: next });
  };

  const goPro = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (window.innerWidth < 768) return;
    const band = document.getElementById('download');
    if (band === null) return;
    event.preventDefault();
    band.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    document.getElementById('download-title')?.focus({ preventScroll: true });
  };

  return (
    <div id="plans">
      {prices === null ? null : (
        <fieldset className="mb-8 inline-flex flex-wrap items-center gap-2 rounded-pill bg-surface-sunken p-1">
          <legend className="sr-only">{labels.legend}</legend>
          {(['monthly', 'annual'] as const).map((value) => (
            <label
              key={value}
              className="relative inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-pill px-4 text-label has-checked:bg-surface has-checked:shadow-segment-thumb has-focus-visible:outline-2 has-focus-visible:outline-border-focus"
            >
              <input
                type="radio"
                name={groupName}
                value={value}
                checked={period === value}
                onChange={() => {
                  choose(value);
                }}
                className="sr-only"
              />
              {value === 'monthly' ? labels.monthly : labels.annual}
              {value === 'annual' && prices.showBestValue ? (
                <span className="rounded-pill bg-brand-soft px-2 py-0.5 text-badge text-brand-on-soft">
                  {labels.bestValue}
                </span>
              ) : null}
            </label>
          ))}
        </fieldset>
      )}
      <div className="grid max-w-[1000px] gap-6 md:grid-cols-2">
        <article
          aria-labelledby="plan-free"
          className="flex flex-col rounded-hero bg-surface p-6 shadow-card md:p-8"
        >
          <h2 id="plan-free" className="text-title-lg">
            {labels.freeTitle}
          </h2>
          <p className="tabular mt-3 text-numeric-xl">{labels.freePrice}</p>
          <p className="text-secondary text-ink-2">{labels.freeSub}</p>
          <a
            href={getUrl}
            data-ev="web_cta_click"
            data-cta="get_started"
            data-placement="pricing"
            className="mt-auto inline-flex min-h-12 items-center justify-center rounded-button border border-border-strong bg-surface px-5 pt-0 text-label-lg text-ink hover:bg-surface-pressed md:mt-8"
          >
            {labels.freeCta}
          </a>
        </article>
        <article
          aria-labelledby="plan-pro"
          className="flex flex-col rounded-hero border-2 border-border-selected bg-surface p-6 shadow-card md:p-8"
        >
          <h2 id="plan-pro" className="text-title-lg">
            {labels.proTitle}
          </h2>
          <div aria-live="polite" className="mt-3 min-h-20">
            {prices === null ? (
              <p className="text-body text-ink-2">{labels.priceUnavailable}</p>
            ) : (
              <>
                <p className="tabular text-title-xl">
                  {period === 'monthly' ? prices.monthly : prices.annual}
                </p>
                {period === 'annual' && prices.annualBreakdown !== null ? (
                  <p className="tabular text-secondary text-ink-2">{prices.annualBreakdown}</p>
                ) : null}
                <p className="mt-1 text-meta text-ink-3">{prices.storeNote}</p>
              </>
            )}
          </div>
          {labels.trialLine === null ? null : (
            <p className="mt-4 text-secondary text-ink-2">{labels.trialLine}</p>
          )}
          <a
            href={getUrl}
            onClick={goPro}
            data-ev="web_cta_click"
            data-cta="get_started"
            data-placement="pricing"
            className="mt-8 inline-flex min-h-12 items-center justify-center rounded-button bg-primary px-5 text-label-lg text-text-on-primary shadow-cta-primary hover:bg-brand-primary-pressed"
          >
            {labels.proCta}
          </a>
        </article>
      </div>
      {prices === null ? null : (
        <p className="mt-6 max-w-3xl text-secondary text-ink-2">{labels.regionNote}</p>
      )}
    </div>
  );
}

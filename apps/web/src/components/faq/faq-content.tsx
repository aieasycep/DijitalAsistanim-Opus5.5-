import { FAQ_ITEMS, type FaqItem } from '@da/i18n';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { REFERRAL_TERMS } from '@/content/referral.ts';
import { Link } from '@/i18n/navigation.ts';
import { faqAnchorId } from '@/lib/faq-keys.ts';
import type { FreeLimits } from '@/lib/pricing.ts';
import { microsoftAdminConsentUrl } from '@/lib/site.ts';

/**
 * Resolves `@da/i18n` `faq.*` items (the single FAQ source shared with the app's Help screen,
 * SREQ-70) into rendered question/answer pairs. ICU values come from `GET /plans` (PUB-05) and the
 * referral terms. An answer that needs plan numbers is left out while `/plans` is unavailable,
 * rather than printing a number the site cannot confirm.
 */
export interface RenderedFaq {
  readonly key: string;
  readonly anchor: string;
  readonly category: FaqItem['category'];
  readonly q: string;
  readonly a: ReactNode;
  /** Plain-text answer for JSON-LD. */
  readonly aText: string;
}

type Tag = (chunks: ReactNode) => ReactNode;
type MarkupTag = (chunks: string) => string;

/** The FAQ keys are data (`FAQ_ITEMS`), so they are looked up by string; `test/faq.test.ts`
 * proves every key and argument exists in both locales. */
interface FaqTranslator {
  (key: string, values?: Record<string, number>): string;
  rich(key: string, values: Record<string, number | Tag>): ReactNode;
  markup(key: string, values: Record<string, number | MarkupTag>): string;
}

const linkClass = 'text-text-link underline underline-offset-4';

export async function renderFaqItems(options: {
  readonly keys?: readonly string[];
  readonly limits: FreeLimits | null;
  readonly microsoftClientId: string | undefined;
}): Promise<RenderedFaq[]> {
  const t = (await getTranslations('faq.items')) as unknown as FaqTranslator;
  const all = FAQ_ITEMS as readonly FaqItem[];
  const ordered =
    options.keys === undefined
      ? all
      : options.keys.flatMap((key) => all.filter((item) => item.key === key));
  const values: Record<string, number> = {
    window: REFERRAL_TERMS.applyWindowDays,
    days: REFERRAL_TERMS.rewardDays,
    cap: REFERRAL_TERMS.maxRewardsPerYear,
    ...(options.limits === null
      ? {}
      : { mail: options.limits.mail, cal: options.limits.cal, n: options.limits.n }),
  };
  const clientId = options.microsoftClientId;

  const rendered: RenderedFaq[] = [];
  for (const item of ordered) {
    const needsPlans = (item.params ?? []).some((param) => ['mail', 'cal', 'n'].includes(param));
    if (needsPlans && options.limits === null) continue;
    const a = t.rich(`${item.key}.a`, {
      ...values,
      privacy: (chunks) => (
        <Link href="/privacy" className={linkClass}>
          {chunks}
        </Link>
      ),
      adminConsent: (chunks) =>
        clientId === undefined ? (
          chunks
        ) : (
          <a href={microsoftAdminConsentUrl(clientId)} className={linkClass}>
            {chunks}
          </a>
        ),
    });
    const aText = t.markup(`${item.key}.a`, {
      ...values,
      privacy: (chunks) => chunks,
      adminConsent: (chunks) => chunks,
    });
    rendered.push({
      key: item.key,
      anchor: faqAnchorId(item.key),
      category: item.category,
      q: t(`${item.key}.q`),
      a,
      aText,
    });
  }
  return rendered;
}

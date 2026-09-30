import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation.ts';
import type { OAuthDoneModel, OAuthVariant } from '@/lib/oauth-done.ts';
import {
  androidIntentUrl,
  appDeepLink,
  playStoreUrl,
  type StoreConfig,
} from '@/lib/store-links.ts';
import type { Locale } from '@/i18n/locales.ts';
import { TrackView } from '../analytics/TrackView.tsx';
import {
  IconAdminPanelSettings,
  IconBlock,
  IconError,
  IconPhonelink,
  IconTimerOff,
} from '../icons/generated/index.ts';
import { cx } from '../ui/cx.ts';

const CALLBACK_PATH = 'integrations/callback';

const TILE: Readonly<Record<OAuthVariant, { Icon: typeof IconError; tone: string }>> = {
  pending: { Icon: IconPhonelink, tone: 'bg-tone-info-soft text-tone-info-icon' },
  denied: { Icon: IconBlock, tone: 'bg-tone-neutral-soft text-tone-neutral-icon' },
  mismatch: { Icon: IconError, tone: 'bg-tone-critical-soft text-tone-critical-icon' },
  scope: { Icon: IconError, tone: 'bg-tone-critical-soft text-tone-critical-icon' },
  error: { Icon: IconError, tone: 'bg-tone-critical-soft text-tone-critical-icon' },
  expired: { Icon: IconTimerOff, tone: 'bg-tone-neutral-soft text-tone-neutral-icon' },
  admin: { Icon: IconAdminPanelSettings, tone: 'bg-tone-warning-soft text-tone-warning-icon' },
};

/**
 * W-OAUTH-01: the true state after a provider callback. Nothing is connected until the app that
 * started the flow completes it with its own session (plan R-07), so the page never says
 * "connected", never shows the completion code, and builds the "return to app" link only from the
 * allow-listed parameters.
 */
export async function OAuthDoneView({
  model,
  platform,
  locale,
  store,
}: {
  model: OAuthDoneModel;
  platform: 'ios' | 'android' | 'other';
  locale: Locale;
  store: StoreConfig;
}): Promise<ReactNode> {
  const t = await getTranslations('webPages.oauthDone');
  const { Icon, tone } = TILE[model.variant];
  const provider = model.provider === null ? '' : t(`providers.${model.provider}`);
  const href =
    platform === 'ios'
      ? appDeepLink(CALLBACK_PATH, model.callbackQuery)
      : platform === 'android'
        ? androidIntentUrl(
            CALLBACK_PATH,
            model.callbackQuery,
            store.androidPackage,
            playStoreUrl(store, locale, { kind: 'campaign', placement: 'oauth_done' }),
          )
        : null;

  return (
    <div className="rounded-card bg-surface p-6 shadow-card md:p-8" data-variant={model.variant}>
      <TrackView
        event="web_oauth_done_view"
        page="oauth_done"
        props={{ provider: model.provider ?? 'unknown', result: model.resultForAnalytics }}
      />
      <span
        aria-hidden="true"
        className={cx('inline-flex size-13 items-center justify-center rounded-card-sm', tone)}
      >
        <Icon size={28} />
      </span>
      <h1
        id="oauth-title"
        tabIndex={-1}
        className="mt-5 text-web-h2 text-balance focus-visible:outline-none"
      >
        {t(`${model.variant}.title`)}
      </h1>
      <p className="mt-3 text-body text-ink-2">
        {model.variant === 'pending' ? t('pending.body', { provider }) : t(`${model.variant}.body`)}
      </p>
      {model.variant === 'admin' ? (
        <p className="mt-4">
          <Link
            href="/support#faq-admin-consent"
            className="inline-flex min-h-11 items-center text-label text-text-link underline underline-offset-4"
          >
            {t('admin.link')}
          </Link>
        </p>
      ) : null}
      {href === null ? (
        <p
          className="mt-6 rounded-card-sm bg-surface-sunken px-4 py-3 text-secondary text-ink-2"
          data-testid="oauth-desktop"
        >
          {t('desktop')}
        </p>
      ) : (
        <a
          href={href}
          data-ev="web_cta_click"
          data-cta="open_in_app"
          data-placement="oauth_done"
          className="mt-6 inline-flex min-h-12 w-full items-center justify-center rounded-button bg-primary px-5 text-label-lg text-text-on-primary md:w-auto"
        >
          {t('returnToApp')}
        </a>
      )}
    </div>
  );
}

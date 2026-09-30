/** @vitest-environment jsdom */
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AdminError from '@/app/(admin)/error';
import RootError from '@/app/error';
import {
  SentryBrowser,
  reportBoundaryError,
  resetBrowserSentryForTests,
  startBrowserSentry,
} from '@/components/sentry-browser';
import { renderWithProviders } from '@/test/render';

/*
 * Browser Sentry and the error boundaries (BACKOFFICE_PLAN §2.2, §5.3): without a DSN no SDK code is
 * loaded and the boundaries report nothing; with one, the SDK starts once with the scrubber and a
 * boundary reports its error with the correlation id it shows (`error.digest`).
 */

vi.mock('next/navigation', () => import('@/test/next-stubs'));

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  setTag: vi.fn(),
  captureException: vi.fn(),
  imported: 0,
}));
vi.mock('@sentry/nextjs', () => {
  sentry.imported += 1;
  return { init: sentry.init, setTag: sentry.setTag, captureException: sentry.captureException };
});

const CONFIG = { dsn: 'https://browserkey@o123.ingest.de.sentry.io/4508', environment: 'preview' };

function boom(digest?: string): Error & { digest?: string } {
  return Object.assign(new Error('render failed'), digest === undefined ? {} : { digest });
}

beforeEach(() => {
  resetBrowserSentryForTests();
  sentry.init.mockReset();
  sentry.setTag.mockReset();
  sentry.captureException.mockReset();
});

describe('SentryBrowser', () => {
  it('without a DSN loads no SDK and the boundaries report nothing', async () => {
    const before = sentry.imported;
    render(<SentryBrowser config={null} />);
    expect(await startBrowserSentry(null)).toBe(false);
    expect(await reportBoundaryError(boom('d1'), 'root')).toBe(false);
    renderWithProviders(<RootError error={boom('d2')} retry={() => undefined} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.imported).toBe(before);
  });

  it('with a DSN starts once with the scrubber, and each boundary reports with its correlation id', async () => {
    render(<SentryBrowser config={CONFIG} />);
    await waitFor(() => {
      expect(sentry.init).toHaveBeenCalledTimes(1);
    });
    expect(await startBrowserSentry(CONFIG)).toBe(true);
    expect(await startBrowserSentry(null)).toBe(true);
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.init.mock.calls[0]?.[0]).toMatchObject({
      dsn: CONFIG.dsn,
      environment: 'preview',
      sendDefaultPii: false,
      replaysSessionSampleRate: 0,
    });
    expect(sentry.setTag).toHaveBeenCalledWith('runtime', 'browser');

    const rootError = boom('corr-root');
    renderWithProviders(<RootError error={rootError} retry={() => undefined} />);
    await waitFor(() => {
      expect(sentry.captureException).toHaveBeenCalledWith(rootError, {
        tags: { boundary: 'root', correlation_id: 'corr-root' },
      });
    });
    const adminError = boom();
    renderWithProviders(<AdminError error={adminError} retry={() => undefined} />);
    await waitFor(() => {
      expect(sentry.captureException).toHaveBeenCalledWith(adminError, {
        tags: { boundary: 'admin', correlation_id: 'none' },
      });
    });
  });
});

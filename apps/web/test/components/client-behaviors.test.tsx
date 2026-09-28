// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteBehaviors } from '../../src/components/analytics/SiteBehaviors.tsx';
import { QrDialog } from '../../src/components/download/QrDialog.tsx';
import { FaqDeepLink } from '../../src/components/faq/FaqDeepLink.tsx';
import { BotCheck } from '../../src/components/forms/BotCheck.tsx';
import { LocaleSwitch } from '../../src/components/layout/LocaleSwitch.tsx';
import { MobileMenu } from '../../src/components/layout/MobileMenu.tsx';
import { TocSpy } from '../../src/components/legal/TocSpy.tsx';
import { CodeCard } from '../../src/components/links/CodeCard.tsx';
import { deviceClass, sendWebEvent, trackingAllowed } from '../../src/lib/web-events/send.ts';
import { renderWithIntl } from './render.tsx';

/*
 * Client behaviour of the site (Part 5 §0.11 analytics, W-CMP components): content-free PUB-06
 * events from `data-ev` attributes (never with GPC / DNT), FAQ deep links, TOC highlighting, the
 * Turnstile widget lifecycle, copy-to-clipboard with a selection fallback, dialogs and the locale
 * switch that keeps the in-page anchor.
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = 'true';
});

vi.mock('@/i18n/navigation.ts', () => import('../stubs/i18n-navigation.tsx'));
vi.mock('next/script', () => ({
  default: ({ onReady }: { onReady?: () => void }) => {
    // The Turnstile script is "loaded" as soon as it mounts.
    queueMicrotask(() => onReady?.());
    return null;
  },
}));

interface Sent {
  event: string;
  page: string;
  locale: string;
  props: Record<string, unknown>;
}
let fetchMock: ReturnType<typeof vi.fn>;
const sent = (): Sent[] =>
  fetchMock.mock.calls.map((call) => JSON.parse((call[1] as { body: string }).body) as Sent);

class ObserverStub {
  static instances: ObserverStub[] = [];
  readonly observed: Element[] = [];
  constructor(readonly callback: IntersectionObserverCallback) {
    ObserverStub.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  disconnect() {
    this.observed.length = 0;
  }
  fire(entries: Partial<IntersectionObserverEntry>[]) {
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));
  vi.stubGlobal('fetch', fetchMock);
  ObserverStub.instances = [];
  vi.stubGlobal('IntersectionObserver', ObserverStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.location.hash = '';
});

describe('PUB-06 web events', () => {
  it('honours GPC and Do Not Track and classifies the viewport', () => {
    expect(trackingAllowed({})).toBe(true);
    expect(trackingAllowed({ globalPrivacyControl: true })).toBe(false);
    expect(trackingAllowed({ doNotTrack: '1' })).toBe(false);
    expect(trackingAllowed(undefined)).toBe(false);
    expect(deviceClass(375)).toBe('mobile');
    expect(deviceClass(900)).toBe('tablet');
    expect(deviceClass(1440)).toBe('desktop');
  });

  it('posts an allow-listed event without credentials and drops unknown props', () => {
    sendWebEvent('web_page_view', { page: 'home', locale: 'tr' }, {});
    sendWebEvent('web_nav_click', { page: 'home', locale: 'tr' }, {
      target: 'unknown',
    } as never);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://project.supabase.co/functions/v1/public-api/web-events');
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', keepalive: true });
    expect((init.headers as Record<string, string>).apikey).toBe('sb_publishable_test');
    expect(sent()[0]).toMatchObject({ event: 'web_page_view', page: 'home', props: {} });
  });
});

describe('SiteBehaviors', () => {
  function mountSite() {
    return renderWithIntl(
      <>
        <SiteBehaviors />
        <main data-page="home">
          <a
            href="https://apps.apple.com"
            data-ev="web_cta_click"
            data-cta="app_store"
            data-placement="hero"
          >
            App Store
          </a>
          <a href="#security" data-ev="web_nav_click" data-target="security">
            Güvenlik
          </a>
          <button type="button" data-ev="web_locale_switch" data-to="en">
            EN
          </button>
          <button type="button" data-ev="web_qr_shown" data-placement="final">
            QR
          </button>
          <button type="button" data-ev="web_cta_click" data-cta="nope" data-placement="hero">
            ignored
          </button>
          <section id="security">
            <h2>Güvenlik</h2>
          </section>
          <details data-faq="what_is">
            <summary>Nedir?</summary>
          </details>
          <details data-faq="not_a_key">
            <summary>?</summary>
          </details>
          <div data-qr-placement="hero">qr</div>
        </main>
      </>,
    );
  }

  it('sends a page view, then one event per allow-listed click', () => {
    mountSite();
    fireEvent.click(screen.getByText('App Store'));
    fireEvent.click(screen.getByText('Güvenlik', { selector: 'a' }));
    fireEvent.click(screen.getByText('EN'));
    fireEvent.click(screen.getByText('QR'));
    fireEvent.click(screen.getByText('ignored'));
    expect(sent().map((e) => [e.event, e.props])).toEqual([
      ['web_page_view', {}],
      ['web_cta_click', { cta: 'app_store', placement: 'hero' }],
      ['web_nav_click', { target: 'security' }],
      ['web_locale_switch', { to: 'en' }],
      ['web_qr_shown', { placement: 'final' }],
    ]);
    expect(sent().every((e) => e.page === 'home' && e.locale === 'tr')).toBe(true);
  });

  it('reports FAQ toggles for known keys only', () => {
    const { container } = mountSite();
    const [known, unknown] = container.querySelectorAll('details');
    if (!known || !unknown) throw new Error('fixture');
    known.open = true;
    known.dispatchEvent(new Event('toggle'));
    unknown.dispatchEvent(new Event('toggle'));
    const toggles = sent().filter((e) => e.event === 'web_faq_toggle');
    expect(toggles.length).toBeGreaterThan(0);
    expect(toggles.every((e) => e.props.faq_id === 'what_is' && e.props.open === true)).toBe(true);
  });

  it('reports a visible QR code once per placement', () => {
    mountSite();
    const observer = ObserverStub.instances.at(-1);
    const target = observer?.observed[0] as HTMLElement;
    Object.defineProperty(target, 'offsetParent', { value: document.body, configurable: true });
    observer?.fire([{ isIntersecting: true, target }]);
    observer?.fire([{ isIntersecting: true, target }]);
    observer?.fire([{ isIntersecting: false, target }]);
    expect(sent().filter((e) => e.event === 'web_qr_shown')).toHaveLength(1);
  });

  it('moves focus to the section heading after an in-page hash change', () => {
    mountSite();
    window.location.hash = '#security';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    const heading = screen.getByRole('heading', { name: 'Güvenlik' });
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });
});

describe('FaqDeepLink', () => {
  it('opens and focuses the FAQ answer named by the hash, now and on hash changes', () => {
    render(
      <>
        <FaqDeepLink />
        <details>
          <summary id="billing">Fatura</summary>
        </details>
        <details>
          <summary id="trial">Deneme</summary>
        </details>
      </>,
    );
    window.location.hash = '#trial';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    const trial = screen.getByText('Deneme').closest('details');
    expect(trial?.open).toBe(true);
    expect(document.activeElement?.textContent).toBe('Deneme');
    window.location.hash = '#missing';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(screen.getByText('Fatura').closest('details')?.open).toBe(false);
  });
});

describe('TocSpy', () => {
  it('marks the first visible section as current', () => {
    render(
      <>
        <TocSpy ids={['a', 'b']} />
        <a data-toc="a" href="#a">
          A
        </a>
        <a data-toc="b" href="#b">
          B
        </a>
        <section id="a" />
        <section id="b" />
      </>,
    );
    const observer = ObserverStub.instances.at(-1);
    expect(observer?.observed.map((e) => e.id)).toEqual(['a', 'b']);
    const [a, b] = observer?.observed ?? [];
    observer?.fire([
      { isIntersecting: true, target: b, boundingClientRect: { top: 300 } as DOMRect },
      { isIntersecting: true, target: a, boundingClientRect: { top: 100 } as DOMRect },
    ]);
    expect(screen.getByText('A').getAttribute('aria-current')).toBe('true');
    observer?.fire([
      { isIntersecting: true, target: b, boundingClientRect: { top: 10 } as DOMRect },
    ]);
    expect(screen.getByText('A').getAttribute('aria-current')).toBeNull();
    expect(screen.getByText('B').getAttribute('aria-current')).toBe('true');
  });
});

describe('BotCheck (Turnstile, interaction-only)', () => {
  it('renders the widget once loaded, forwards tokens, resets on signal and removes on unmount', async () => {
    const api = {
      render: vi.fn(() => 'widget-1'),
      reset: vi.fn(),
      remove: vi.fn(),
    };
    window.turnstile = api;
    const onToken = vi.fn();
    function Host() {
      const [signal, setSignal] = useState(0);
      return (
        <>
          <BotCheck siteKey="0x4AAA" locale="tr" nonce="n" resetSignal={signal} onToken={onToken} />
          <button
            type="button"
            onClick={() => {
              setSignal((n) => n + 1);
            }}
          >
            reset
          </button>
        </>
      );
    }
    const view = render(<Host />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.render).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        sitekey: '0x4AAA',
        appearance: 'interaction-only',
        language: 'tr',
      }),
    );
    const options = (
      api.render.mock.calls[0] as unknown as [unknown, Record<string, (t?: string) => void>]
    )[1];
    options.callback?.('tok');
    options['expired-callback']?.();
    options['error-callback']?.();
    expect(onToken.mock.calls).toEqual([['tok'], [null], [null]]);
    fireEvent.click(screen.getByText('reset'));
    expect(api.reset).toHaveBeenCalledWith('widget-1');
    view.unmount();
    expect(api.remove).toHaveBeenCalledWith('widget-1');
    delete window.turnstile;
  });
});

describe('CodeCard (W-REF-01)', () => {
  const labels = { title: 'Kod', copy: 'Kopyala', copied: 'Kopyalandı', selected: 'Seçildi' };

  it('copies the code and clears the confirmation after 3 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<CodeCard code="7K2M4QX" labels={labels} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Kopyala/ }));
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith('7K2M4QX');
    expect(screen.getByRole('status').textContent).toBe('Kopyalandı');
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('selects the code when the clipboard is refused', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
      configurable: true,
    });
    render(<CodeCard code="7K2M4QX" labels={labels} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Kopyala/ }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('status').textContent).toBe('Seçildi');
    expect(window.getSelection()?.toString()).toBe('7K2M4QX');
  });
});

describe('dialogs and the locale switch', () => {
  it('QrDialog opens and closes the modal', () => {
    const showModal = vi.fn();
    const close = vi.fn();
    HTMLDialogElement.prototype.showModal = showModal;
    HTMLDialogElement.prototype.close = close;
    render(
      <QrDialog placement="hero" labels={{ button: 'QR göster', title: 'QR', close: 'Kapat' }}>
        <p>kod</p>
      </QrDialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'QR göster' }));
    fireEvent.click(screen.getByRole('button', { name: 'Kapat', hidden: true }));
    expect(showModal).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('MobileMenu opens with the first link focused and closes on a link tap', () => {
    const showModal = vi.fn();
    const close = vi.fn();
    HTMLDialogElement.prototype.showModal = showModal;
    HTMLDialogElement.prototype.close = close;
    renderWithIntl(
      <MobileMenu
        items={[
          { href: '/#features', label: 'Özellikler', target: 'features', alsoInHeaderFromMd: true },
          { href: '/pricing', label: 'Fiyatlar', target: 'pricing', alsoInHeaderFromMd: false },
        ]}
        labels={{
          menu: 'Menü',
          close: 'Kapat',
          nav: 'Site',
          localeLabel: 'EN',
          localeAria: 'English',
        }}
        cta={{ href: '/#download', label: 'İndir' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Menü' }));
    expect(showModal).toHaveBeenCalledOnce();
    expect(document.activeElement?.textContent).toBe('Özellikler');
    fireEvent.click(screen.getByText('Fiyatlar'));
    expect(close).toHaveBeenCalled();
  });

  it('LocaleSwitch targets the other locale and keeps the current hash', () => {
    renderWithIntl(<LocaleSwitch label="EN" ariaLabel="English" />);
    const link = screen.getByRole('link', { name: 'English' });
    expect(link.getAttribute('href')).toBe('/en');
    expect(link.getAttribute('data-to')).toBe('en');
    window.location.hash = '#faq';
    fireEvent.click(link);
    expect((link as HTMLAnchorElement).hash).toBe('#faq');
  });
});

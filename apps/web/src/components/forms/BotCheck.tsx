'use client';

import Script from 'next/script';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TURNSTILE_ORIGIN } from '@/lib/csp.ts';

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance: 'interaction-only';
      language: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Cloudflare Turnstile (W-CMP-23), rendered only when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set and
 * only on `/support` and `/data-deletion`. The token is sent as `captcha_token`; `public-api`
 * verifies it with `TURNSTILE_SECRET_KEY`. Without a site key the honeypot and rate limits still
 * apply and no request goes to Cloudflare.
 */
export function BotCheck({
  siteKey,
  locale,
  nonce,
  resetSignal,
  onToken,
}: {
  siteKey: string;
  locale: string;
  nonce: string | undefined;
  resetSignal: number;
  onToken: (token: string | null) => void;
}): ReactNode {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!ready || container.current === null || window.turnstile === undefined) return undefined;
    const api = window.turnstile;
    widget.current = api.render(container.current, {
      sitekey: siteKey,
      appearance: 'interaction-only',
      language: locale,
      callback: (token) => {
        onTokenRef.current(token);
      },
      'expired-callback': () => {
        onTokenRef.current(null);
      },
      'error-callback': () => {
        onTokenRef.current(null);
      },
    });
    return () => {
      if (widget.current !== null) api.remove(widget.current);
      widget.current = null;
    };
  }, [ready, siteKey, locale]);

  useEffect(() => {
    if (resetSignal > 0 && widget.current !== null) {
      window.turnstile?.reset(widget.current);
      onTokenRef.current(null);
    }
  }, [resetSignal]);

  return (
    <>
      <Script
        src={`${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`}
        strategy="afterInteractive"
        nonce={nonce}
        onReady={() => {
          setReady(true);
        }}
      />
      <div ref={container} className="min-h-0" />
    </>
  );
}

/**
 * `oauth` (`/functions/v1/oauth`; API_CONTRACTS OAUTH-01…OAUTH-04; R-07; T-4.01, T-4.10).
 *
 * - `GET /google/callback`, `GET /microsoft/callback`, `GET /demo/callback`: the provider leg of the
 *   flow → 302 to `OAUTH_RESULT_REDIRECT_URI?result=…&provider=…&state_id=…[&completion_code=…]
 *   [&error_code=…]`. The redirect never carries tokens, e-mail addresses or scopes. A missing or
 *   unknown `state` → 400 localized HTML ("Bağlantı tamamlanamadı" + a button back to the app).
 * - `GET /demo/authorize` (demo mode only, else 404): the implicit demo consent → 302 to the demo
 *   callback with a code bound to the flow's PKCE challenge.
 * Every response is `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
 */
import type { Hono } from 'hono';
import trStates from '@da/i18n/messages/tr/states.json' with { type: 'json' };
import enStates from '@da/i18n/messages/en/states.json' with { type: 'json' };
import trWeb from '@da/i18n/messages/tr/web.json' with { type: 'json' };
import enWeb from '@da/i18n/messages/en/web.json' with { type: 'json' };
import { sha256 } from '../_shared/crypto/hmac.ts';
import { AppError } from '../_shared/errors.ts';
import { createApp } from '../_shared/http/app.ts';
import type { AppContext, AppEnv } from '../_shared/http/context.ts';
import type { Logger } from '../_shared/logging/logger.ts';
import type { Sentry } from '../_shared/observability/sentry.ts';
import {
  DemoOAuth,
  demoCapabilitiesFromScope,
  demoFlavorFromScopes,
} from '../_shared/providers/demo/auth.ts';
import {
  type CallbackOutcome,
  type FlowProvider,
  handleCallback,
} from '../_shared/services/integrations/connect.ts';
import type { IntegrationRuntime } from '../_shared/services/integrations/runtime.ts';

export interface OAuthAppDeps {
  readonly runtime: IntegrationRuntime;
  /** Demo mode allowed (`DEMO_MODE`, and `ALLOW_DEMO_IN_PRODUCTION` in production). */
  readonly demoEnabled: boolean;
  readonly log: Logger;
  readonly sentry?: Sentry;
}

const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The 400 page for a missing / unknown state (localized, no script, no external resources). */
export function invalidStatePage(locale: 'tr-TR' | 'en-US', appUrl: string): Response {
  const states = locale === 'en-US' ? enStates : trStates;
  const web = locale === 'en-US' ? enWeb : trWeb;
  const lang = locale === 'en-US' ? 'en' : 'tr';
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(states.error.oauthFailed.title)}</title><style>body{font-family:system-ui,sans-serif;margin:0;padding:48px 24px;background:#f7f5f0;color:#1d1d1b;text-align:center}main{max-width:420px;margin:0 auto}h1{font-size:22px}p{font-size:16px;line-height:1.5}a{display:inline-block;margin-top:16px;padding:12px 20px;border-radius:12px;background:#1d1d1b;color:#fff;text-decoration:none}</style></head><body><main><h1>${escapeHtml(states.error.oauthFailed.title)}</h1><p>${escapeHtml(states.error.oauthFailed.body)}</p><a href="${escapeHtml(appUrl)}">${escapeHtml(web.oauthDone.openApp)}</a></main></body></html>`;
  return new Response(html, {
    status: 400,
    headers: {
      ...NO_STORE,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { ...NO_STORE, Location: location } });
}

function appHome(returnTo: string): string {
  try {
    const url = new URL(returnTo);
    return url.protocol.startsWith('http') ? returnTo : `${url.protocol}//`;
  } catch {
    return 'dijitalasistan://';
  }
}

export function createOAuthApp(deps: OAuthAppDeps): Hono<AppEnv> {
  const app = createApp({
    fn: 'oauth',
    logger: deps.log,
    ...(deps.sentry === undefined ? {} : { sentry: deps.sentry }),
  });
  const rt = deps.runtime;

  const callback = (provider: FlowProvider) => async (c: AppContext) => {
    c.set('routeKey', `GET /${provider}/callback`);
    if (provider === 'demo' && !deps.demoEnabled) throw new AppError('NOT_FOUND');
    const q = c.req.query();
    const outcome: CallbackOutcome = await handleCallback(
      rt,
      provider,
      {
        ...(q.state === undefined ? {} : { state: q.state }),
        ...(q.code === undefined ? {} : { code: q.code.slice(0, 2048) }),
        ...(q.error === undefined ? {} : { error: q.error.slice(0, 128) }),
        ...(q.error_description === undefined
          ? {}
          : { error_description: q.error_description.slice(0, 1024) }),
      },
      c.get('correlationId'),
    );
    if (outcome.kind === 'invalid_state') {
      c.get('log').warn('oauth_invalid_state', { provider });
      return invalidStatePage(c.get('locale'), appHome(rt.config.returnTo));
    }
    c.get('log').info('oauth_callback', {
      provider,
      result: outcome.result,
      error_code: outcome.errorCode,
    });
    return redirect(outcome.location);
  };

  app.get('/google/callback', callback('google'));
  app.get('/microsoft/callback', callback('microsoft'));
  app.get('/demo/callback', callback('demo'));

  app.get('/demo/authorize', async (c) => {
    c.set('routeKey', 'GET /demo/authorize');
    if (!deps.demoEnabled) throw new AppError('NOT_FOUND');
    const state = c.req.query('state');
    const challenge = c.req.query('code_challenge');
    if (
      state === undefined ||
      !/^[A-Za-z0-9_-]{43}$/.test(state) ||
      challenge === undefined ||
      !/^[A-Za-z0-9_-]{43}$/.test(challenge)
    ) {
      return invalidStatePage(c.get('locale'), appHome(rt.config.returnTo));
    }
    const row = await rt.store.findStateByHash(await sha256(state));
    if (row === null || row.provider !== 'demo')
      return invalidStatePage(c.get('locale'), appHome(rt.config.returnTo));
    const oauth = rt.providers.resolve('demo').oauth;
    if (!(oauth instanceof DemoOAuth))
      throw new AppError('FEATURE_DISABLED', { details: { reason: 'demo_adapter' } });
    const code = await oauth.issueCode({
      codeChallenge: challenge,
      // The implicit demo consent grants every scope the flow requested.
      capabilities: demoCapabilitiesFromScope(row.requested_scopes.join(' ')),
      flavor: demoFlavorFromScopes(row.requested_scopes),
      userId: row.user_id,
    });
    const target = new URL(rt.config.redirectUris.demo);
    target.searchParams.set('state', state);
    target.searchParams.set('code', code);
    return redirect(target.toString());
  });

  return app;
}

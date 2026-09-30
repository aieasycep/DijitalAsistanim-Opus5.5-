import { describe, expect, it } from 'vitest';
import { normalizeAppLinkPath } from '../src/lib/app-link.ts';
import { resolveLinkLocale } from '../src/i18n/locales.ts';
import { maskEmail } from '../src/lib/mask-email.ts';
import { oauthDoneModel } from '../src/lib/oauth-done.ts';

const CODE = 'Qm9vdHN0cmFwLWNvbXBsZXRpb24tY29kZS0wMTIzNDU';
const STATE = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('/oauth/done model (W-OAUTH-01, R-07)', () => {
  it('pending needs a provider and a well-formed completion code', () => {
    const model = oauthDoneModel({
      provider: 'google',
      result: 'pending_confirmation',
      completion_code: CODE,
      state_id: STATE,
    });
    expect(model.variant).toBe('pending');
    expect(model.callbackQuery.toString()).toBe(
      `provider=google&result=pending_confirmation&completion_code=${CODE}&state_id=${STATE}`,
    );
    expect(
      oauthDoneModel({
        provider: 'google',
        result: 'pending_confirmation',
        completion_code: 'short',
      }).variant,
    ).toBe('error');
    expect(oauthDoneModel({ result: 'pending_confirmation', completion_code: CODE }).variant).toBe(
      'error',
    );
  });

  it('forwards only allow-listed parameters', () => {
    const model = oauthDoneModel({
      provider: 'microsoft',
      result: 'denied',
      code: 'provider-code',
      state: 'raw-state',
      access_token: 'secret',
      error_description: '<b>x</b>',
      completion_code: CODE,
    });
    expect([...model.callbackQuery.keys()]).toEqual(['provider', 'result']);
    expect(model.callbackQuery.toString()).not.toContain('secret');
  });

  it('maps results and error codes to variants', () => {
    expect(oauthDoneModel({ result: 'denied', error_code: 'scope_missing' }).variant).toBe('scope');
    expect(oauthDoneModel({ result: 'error', error_code: 'account_mismatch' }).variant).toBe(
      'mismatch',
    );
    expect(oauthDoneModel({ result: 'expired_state' }).variant).toBe('expired');
    expect(oauthDoneModel({ result: 'admin_consent_required' }).variant).toBe('admin');
    expect(oauthDoneModel({ result: 'success' }).variant).toBe('error');
    expect(oauthDoneModel({}).resultForAnalytics).toBe('unknown');
    expect(
      oauthDoneModel({ result: 'error', error_code: 'DROP TABLE' }).callbackQuery.has('error_code'),
    ).toBe(false);
  });

  it('reads the first value of repeated parameters', () => {
    expect(oauthDoneModel({ provider: ['google', 'microsoft'], result: ['denied'] }).provider).toBe(
      'google',
    );
  });
});

describe('app link paths (W-APP-01)', () => {
  it('keeps known app routes and drops everything else', () => {
    expect(normalizeAppLinkPath(['today'])).toBe('today');
    expect(normalizeAppLinkPath(['mail', '3f2c9a44-0000-4000-8000-000000000001'])).toBe(
      'mail/3f2c9a44-0000-4000-8000-000000000001',
    );
    expect(normalizeAppLinkPath(['integrations', 'callback'])).toBe('integrations/callback');
    expect(normalizeAppLinkPath(['unknown', 'x'])).toBe('');
    expect(normalizeAppLinkPath(['<script>'])).toBe('');
    expect(normalizeAppLinkPath(undefined)).toBe('');
  });
});

describe('link locale', () => {
  it('prefers ?lang, then the top Accept-Language (tr* → tr, else en), then Turkish', () => {
    expect(resolveLinkLocale('en', 'tr-TR')).toBe('en');
    expect(resolveLinkLocale(null, 'en-US,en;q=0.9')).toBe('en');
    expect(resolveLinkLocale(null, 'tr-TR,en;q=0.5')).toBe('tr');
    expect(resolveLinkLocale(null, 'en;q=0.4,tr;q=0.8')).toBe('tr');
    expect(resolveLinkLocale(null, 'de-DE,tr;q=0.8')).toBe('en');
    expect(resolveLinkLocale('xx', null)).toBe('tr');
    expect(resolveLinkLocale(null, '')).toBe('tr');
  });
});

describe('email masking', () => {
  it('never echoes the full address', () => {
    const masked = maskEmail('yunus.emre@example.com');
    expect(masked).not.toBe('yunus.emre@example.com');
    expect(masked).toContain('@');
    expect(masked.startsWith('y')).toBe(true);
  });
});

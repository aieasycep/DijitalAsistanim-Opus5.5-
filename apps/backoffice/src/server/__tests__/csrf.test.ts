import { describe, expect, it } from 'vitest';

import { checkFetchSite, checkSameOrigin } from '../csrf';

const ADMIN = 'https://admin.dijitalasistan.app';

function headers(values: Record<string, string>) {
  return new Headers(values);
}

describe('checkSameOrigin (BACKOFFICE_PLAN §3.10)', () => {
  it('rejects a request without Origin', () => {
    expect(checkSameOrigin(headers({}), ADMIN)).toEqual({ ok: false, reason: 'origin_missing' });
    expect(checkSameOrigin(headers({ origin: 'null' }), ADMIN)).toEqual({
      ok: false,
      reason: 'origin_missing',
    });
  });

  it('rejects a foreign or malformed Origin', () => {
    expect(checkSameOrigin(headers({ origin: 'https://evil.example' }), ADMIN)).toEqual({
      ok: false,
      reason: 'origin_mismatch',
    });
    expect(checkSameOrigin(headers({ origin: 'http://admin.dijitalasistan.app' }), ADMIN)).toEqual({
      ok: false,
      reason: 'origin_mismatch',
    });
    expect(checkSameOrigin(headers({ origin: 'not a url' }), ADMIN)).toEqual({
      ok: false,
      reason: 'origin_mismatch',
    });
  });

  it('rejects Sec-Fetch-Site other than same-origin even with the right Origin', () => {
    expect(
      checkSameOrigin(headers({ origin: ADMIN, 'sec-fetch-site': 'cross-site' }), ADMIN),
    ).toEqual({
      ok: false,
      reason: 'cross_site',
    });
    expect(
      checkSameOrigin(headers({ origin: ADMIN, 'sec-fetch-site': 'same-site' }), ADMIN),
    ).toEqual({
      ok: false,
      reason: 'cross_site',
    });
  });

  it('accepts the admin origin', () => {
    expect(checkSameOrigin(headers({ origin: ADMIN }), ADMIN)).toEqual({ ok: true });
    expect(
      checkSameOrigin(headers({ origin: ADMIN, 'sec-fetch-site': 'same-origin' }), `${ADMIN}/`),
    ).toEqual({
      ok: true,
    });
  });

  it('GET route handlers only refuse cross-site fetches', () => {
    expect(checkFetchSite(headers({}))).toEqual({ ok: true });
    expect(checkFetchSite(headers({ 'sec-fetch-site': 'none' }))).toEqual({ ok: true });
    expect(checkFetchSite(headers({ 'sec-fetch-site': 'cross-site' }))).toEqual({
      ok: false,
      reason: 'cross_site',
    });
  });
});

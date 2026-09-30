import { describe, expect, it } from 'vitest';

import { appSettingValueValid } from '@da/validation/admin/system';
import { googleVerificationNotice } from '@/lib/health';

/*
 * GAP-1 backoffice pieces: the Google OAuth verification notice on System Health (KPL-32) and the
 * Settings validation of the new `app_settings` keys (the referral reward kill switch, the Google
 * verification status and the disaster-recovery embeddings).
 */
describe('System Health: Google OAuth verification notice (KPL-32)', () => {
  it('maps the google_oauth detail codes to a notice', () => {
    expect(googleVerificationNotice('google_unverified')).toBe('google_unverified');
    expect(googleVerificationNotice('google_unverified_cap_near')).toBe(
      'google_unverified_cap_near',
    );
    expect(googleVerificationNotice('google_unverified_cap_reached')).toBe(
      'google_unverified_cap_reached',
    );
  });

  it('shows nothing for a verified app or another detail', () => {
    expect(googleVerificationNotice(null)).toBeNull();
    expect(googleVerificationNotice(undefined)).toBeNull();
    expect(googleVerificationNotice('discovery_failed')).toBeNull();
  });
});

describe('Settings: the GAP-1 keys are editable with their value shapes', () => {
  it('referral.rewards_enabled and google.oauth_verified take booleans only', () => {
    expect(appSettingValueValid('referral.rewards_enabled', false)).toBe(true);
    expect(appSettingValueValid('referral.rewards_enabled', 'off')).toBe(false);
    expect(appSettingValueValid('google.oauth_verified', true)).toBe(true);
    expect(appSettingValueValid('google.oauth_verified', 1)).toBe(false);
  });

  it('ai.embedding_dr needs the full 1024-d OpenAI target', () => {
    const value = {
      reembed: true,
      search: false,
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1024,
    };
    expect(appSettingValueValid('ai.embedding_dr', value)).toBe(true);
    expect(appSettingValueValid('ai.embedding_dr', { ...value, dimensions: 1536 })).toBe(false);
    expect(appSettingValueValid('ai.embedding_dr', { ...value, provider: 'voyage' })).toBe(false);
    expect(appSettingValueValid('ai.embedding_dr', { reembed: true })).toBe(false);
  });
});

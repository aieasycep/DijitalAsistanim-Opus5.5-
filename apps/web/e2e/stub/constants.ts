import { referralCheckChar } from '@da/domain/referrals/code';

/** Ports chosen to avoid the default 3000 used by other apps running in the same container. */
export const WEB_PORT = Number(process.env.WEB_E2E_PORT ?? 3107);
export const STUB_PORT = Number(process.env.STUB_E2E_PORT ?? 4107);
export const WEB_ORIGIN = `http://127.0.0.1:${String(WEB_PORT)}`;
export const STUB_ORIGIN = `http://127.0.0.1:${String(STUB_PORT)}`;

/** Codes with a correct check character (packages/domain referral code rules). */
export const STUB_VALID_REFERRAL = `7K2M4Q${referralCheckChar('7K2M4Q')}`;
export const STUB_UNKNOWN_REFERRAL = `ABCDEF${referralCheckChar('ABCDEF')}`;
export const STUB_UNAVAILABLE_REFERRAL = `HJKMNP${referralCheckChar('HJKMNP')}`;

/** Build-time environment of the E2E build: a production, indexable configuration. */
export const E2E_ENV = {
  APP_ENV: 'production',
  SITE_INDEXABLE: 'true',
  NEXT_PUBLIC_SITE_URL: WEB_ORIGIN,
  NEXT_PUBLIC_SUPABASE_URL: STUB_ORIGIN,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e',
  API_PUBLIC_BASE_URL: STUB_ORIGIN,
  NEXT_PUBLIC_ANALYTICS_ENABLED: 'true',
  APPLE_TEAM_ID: 'ABCDE12345',
  IOS_BUNDLE_IDENTIFIER: 'com.dijitalasistan.app',
  ANDROID_PACKAGE: 'com.dijitalasistan.app',
  ANDROID_SHA256_CERT_FINGERPRINTS:
    '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5',
  MICROSOFT_CLIENT_ID: '11111111-2222-4333-8444-555555555555',
  IOS_APP_STORE_ID: '1234567890',
  APP_STORE_PROVIDER_TOKEN: '118000',
  DATA_REGION_LABEL: 'eu-central-1',
  BACKUP_RETENTION_DAYS: '7',
  EMAIL_PROVIDER: 'resend',
  COMPANY_LEGAL_NAME: 'Örnek Yazılım A.Ş.',
  COMPANY_ADDRESS: 'Örnek Mah. Test Sok. No: 1, 34000 İstanbul',
  COMPANY_MERSIS_NO: '0123456789000015',
  COMPANY_KEP_ADDRESS: 'ornek@hs01.kep.tr',
  NEXT_TELEMETRY_DISABLED: '1',
} as const;

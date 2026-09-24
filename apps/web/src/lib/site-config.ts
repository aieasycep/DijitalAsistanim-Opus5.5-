import 'server-only';
import { companyInfo, type CompanyInfo } from '../content/company.ts';
import { REFERRAL_TERMS } from '../content/referral.ts';
import type { LegalContext } from '../content/legal/types.ts';
import { clientEnv } from '../env/client.ts';
import { missingLaunchKeys } from '../env/schema.ts';
import { serverEnv } from '../env/server.ts';
import type { StoreConfig } from './store-links.ts';

/**
 * Everything a server component needs from the environment, in one read. No secret exists here:
 * the web holds only public identifiers.
 */
export interface SiteConfig {
  readonly siteUrl: string;
  readonly indexable: boolean;
  readonly production: boolean;
  readonly store: StoreConfig;
  readonly company: CompanyInfo;
  readonly dataRegionLabel: string | undefined;
  readonly microsoftClientId: string | undefined;
  readonly turnstileSiteKey: string | undefined;
  /** Launch configuration still missing (shown as a notice outside production only). */
  readonly devMissing: readonly string[];
  readonly legal: LegalContext;
}

export function siteConfig(): SiteConfig {
  const env = serverEnv();
  const company = companyInfo(env);
  const production = env.APP_ENV === 'production';
  return {
    siteUrl: clientEnv.NEXT_PUBLIC_SITE_URL,
    indexable: env.indexable,
    production,
    store: {
      iosAppStoreId: env.IOS_APP_STORE_ID,
      appStoreProviderToken: env.APP_STORE_PROVIDER_TOKEN,
      androidPackage: env.ANDROID_PACKAGE,
    },
    company,
    dataRegionLabel: env.DATA_REGION_LABEL,
    microsoftClientId: env.MICROSOFT_CLIENT_ID,
    turnstileSiteKey: clientEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    devMissing: production ? [] : missingLaunchKeys(process.env),
    legal: {
      company,
      backupDays: env.BACKUP_RETENTION_DAYS,
      dataRegionLabel: env.DATA_REGION_LABEL,
      turnstileEnabled: clientEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY !== undefined,
      referral: REFERRAL_TERMS,
    },
  };
}

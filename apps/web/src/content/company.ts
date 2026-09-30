import type { ServerEnv } from '../env/schema.ts';
import { BRAND_NAME, SECURITY_EMAIL, SUPPORT_EMAIL } from '../lib/site.ts';

/**
 * The data controller's identity for the legal pages, footer and JSON-LD (Part 5 §3.2
 * `#veri-sorumlusu`). Values come from the owner's records through the environment (Manual
 * external step); nothing is invented. Outside production, missing values are listed in a
 * visible "Harici kimlik bilgisi gerekli" notice; an indexable production build requires them.
 */
export interface CompanyInfo {
  /** The registered legal name, or undefined when not configured. */
  readonly legalName: string | undefined;
  /** Name for "© {year} {name}": the legal name when configured, otherwise the brand. */
  readonly displayName: string;
  readonly address: string | undefined;
  readonly mersisNo: string | undefined;
  readonly kepAddress: string | undefined;
  readonly euRepresentative: string | undefined;
  readonly privacyEmail: string;
  readonly supportEmail: string;
  readonly securityEmail: string;
  /** Env keys that are not configured yet. */
  readonly missing: readonly string[];
}

export function companyInfo(env: ServerEnv): CompanyInfo {
  const missing = (
    [
      ['COMPANY_LEGAL_NAME', env.COMPANY_LEGAL_NAME],
      ['COMPANY_ADDRESS', env.COMPANY_ADDRESS],
      ['COMPANY_MERSIS_NO', env.COMPANY_MERSIS_NO],
      ['COMPANY_KEP_ADDRESS', env.COMPANY_KEP_ADDRESS],
    ] as const
  )
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);
  return {
    legalName: env.COMPANY_LEGAL_NAME,
    displayName: env.COMPANY_LEGAL_NAME ?? BRAND_NAME,
    address: env.COMPANY_ADDRESS,
    mersisNo: env.COMPANY_MERSIS_NO,
    kepAddress: env.COMPANY_KEP_ADDRESS,
    euRepresentative: env.EU_REPRESENTATIVE,
    privacyEmail: env.PRIVACY_CONTACT_EMAIL,
    supportEmail: SUPPORT_EMAIL,
    securityEmail: SECURITY_EMAIL,
    missing,
  };
}

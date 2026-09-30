import type { Locale } from '@da/i18n';
import { privacyEn } from './privacy.en.ts';
import { privacyTr } from './privacy.tr.ts';
import { termsEn } from './terms.en.ts';
import { termsTr } from './terms.tr.ts';
import type { LegalContext, LegalDocument } from './types.ts';

export type LegalDocumentId = LegalDocument['id'];

const BUILDERS: Readonly<
  Record<LegalDocumentId, Readonly<Record<Locale, (ctx: LegalContext) => LegalDocument>>>
> = {
  privacy: { tr: privacyTr, en: privacyEn },
  terms: { tr: termsTr, en: termsEn },
};

export function legalDocument(
  id: LegalDocumentId,
  locale: Locale,
  ctx: LegalContext,
): LegalDocument {
  return BUILDERS[id][locale](ctx);
}

export * from './types.ts';

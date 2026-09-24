import { describe, expect, it } from 'vitest';
import enWebPages from '../messages/en/webPages.json';
import trWebPages from '../messages/tr/webPages.json';
import { companyInfo } from '../src/content/company.ts';
import {
  ACCOUNT_DELETION_SUMMARY_ROWS,
  DELETION_OUTCOMES,
  DELETION_SCOPE,
} from '../src/content/deletion-scope.ts';
import {
  legalDocument,
  type Block,
  type Inline,
  type LegalContext,
  type LegalDocument,
} from '../src/content/legal/index.ts';
import { LEGAL_EFFECTIVE_DATE, LEGAL_VERSION } from '../src/content/meta.ts';
import { REFERRAL_TERMS } from '../src/content/referral.ts';
import { RETENTION_SCHEDULE } from '../src/content/retention.ts';
import { AI_SUBPROCESSOR_IDS, buildSubprocessors } from '../src/content/subprocessors.ts';
import { parseServerEnv } from '../src/env/schema.ts';

const CONTEXT: LegalContext = {
  company: companyInfo(
    parseServerEnv({
      COMPANY_LEGAL_NAME: 'Örnek Yazılım A.Ş.',
      COMPANY_ADDRESS: 'İstanbul',
      COMPANY_MERSIS_NO: '0123456789000015',
      COMPANY_KEP_ADDRESS: 'ornek@hs01.kep.tr',
    }),
  ),
  backupDays: 7,
  dataRegionLabel: 'eu-central-1',
  turnstileEnabled: false,
  referral: REFERRAL_TERMS,
};

const LIMITED_USE = {
  tr: 'Dijital Asistan’ın Google API’lerinden aldığı bilgileri kullanması ve başka bir uygulamaya aktarması, Sınırlı Kullanım şartları dahil Google API Hizmetleri Kullanıcı Verileri Politikası’na uygun olacaktır.',
  en: 'Dijital Asistan’s use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.',
} as const;

function inlineText(inline: readonly Inline[]): string {
  return inline
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part.t === 'mail') return part.address;
      return part.text;
    })
    .join('');
}

/** Structural fingerprint of a block (type, list lengths, table shape, callout id). */
function shape(block: Block): string {
  switch (block.type) {
    case 'ul':
      return `ul:${String(block.items.length)}`;
    case 'table':
      return `table:${String(block.head.length)}x${String(block.rows.length)}`;
    case 'callout':
      return `callout:${block.id ?? ''}`;
    case 'dl':
      return `dl:${String(block.items.length)}`;
    default:
      return block.type;
  }
}

function documentText(document: LegalDocument): string {
  return document.sections
    .flatMap((section) =>
      section.blocks.map((block) => {
        if (block.type === 'p' || block.type === 'callout') return inlineText(block.content);
        if (block.type === 'ul') return block.items.map(inlineText).join('\n');
        if (block.type === 'h3') return block.text;
        return '';
      }),
    )
    .join('\n');
}

describe('legal documents (W-LEGAL-01/02, R-26)', () => {
  for (const id of ['privacy', 'terms'] as const) {
    it(`${id}: Turkish and English have the same sections and block structure`, () => {
      const tr = legalDocument(id, 'tr', CONTEXT);
      const en = legalDocument(id, 'en', CONTEXT);
      expect(en.sections.map((section) => section.id)).toEqual(
        tr.sections.map((section) => section.id),
      );
      for (const [index, section] of tr.sections.entries()) {
        expect(en.sections[index]?.blocks.map(shape), section.id).toEqual(
          section.blocks.map(shape),
        );
      }
      expect(tr.version).toBe(LEGAL_VERSION);
      expect(en.effectiveDate).toBe(LEGAL_EFFECTIVE_DATE);
      expect(new Set(tr.sections.map((section) => section.id)).size).toBe(tr.sections.length);
    });
  }

  it('privacy states the Google Limited Use sentence verbatim', () => {
    for (const locale of ['tr', 'en'] as const) {
      const document = legalDocument('privacy', locale, CONTEXT);
      const google = document.sections.find((section) => section.id === 'google');
      const callout = google?.blocks.find(
        (block) => block.type === 'callout' && block.id === 'google-limited-use',
      );
      expect(callout?.type === 'callout' ? inlineText(callout.content) : '').toContain(
        LIMITED_USE[locale],
      );
    }
  });

  it('privacy covers the sections the app deep-links to', () => {
    const ids = legalDocument('privacy', 'tr', CONTEXT).sections.map((section) => section.id);
    for (const id of [
      'yapay-zeka',
      'google',
      'alt-isleyiciler',
      'saklama',
      'silme',
      'haklarin',
      'iletisim',
    ]) {
      expect(ids).toContain(id);
    }
    const blocks = legalDocument('privacy', 'tr', CONTEXT).sections.flatMap(
      (section) => section.blocks,
    );
    expect(blocks.some((block) => block.type === 'retentionTable')).toBe(true);
    expect(blocks.some((block) => block.type === 'subprocessorTable')).toBe(true);
  });

  it('makes no end-to-end, "compliant" or training claims', () => {
    for (const id of ['privacy', 'terms'] as const) {
      for (const locale of ['tr', 'en'] as const) {
        const text = documentText(legalDocument(id, locale, CONTEXT));
        expect(text, `${id}/${locale}`).not.toMatch(
          /u\u00e7tan uca|end-to-end|GDPR compliant|KVKK ve GDPR uyumlu|s\u0131n\u0131rs\u0131z|unlimi[t]ed/iu,
        );
      }
    }
    expect(documentText(legalDocument('privacy', 'tr', CONTEXT))).toContain(
      'Verilerin reklam amacıyla satılmaz.',
    );
  });

  it('names the configured company; a missing value is flagged, never invented', () => {
    expect(documentText(legalDocument('terms', 'tr', CONTEXT))).toContain('Örnek Yazılım A.Ş.');
    const bare = companyInfo(parseServerEnv({}));
    expect(bare.legalName).toBeUndefined();
    expect(bare.missing).toEqual([
      'COMPANY_LEGAL_NAME',
      'COMPANY_ADDRESS',
      'COMPANY_MERSIS_NO',
      'COMPANY_KEP_ADDRESS',
    ]);
    const text = documentText(legalDocument('privacy', 'tr', { ...CONTEXT, company: bare }));
    expect(text).not.toContain('Örnek');
  });
});

describe('legal tables have copy in both locales', () => {
  it('retention schedule rows', () => {
    for (const row of RETENTION_SCHEDULE) {
      expect(trWebPages.legal.retention.rows[row.id], row.id).toBeTruthy();
      expect(enWebPages.legal.retention.rows[row.id], row.id).toBeTruthy();
    }
  });

  it('sub-processor rows, including the AI providers', () => {
    const rows = buildSubprocessors({ turnstileEnabled: true, emailProvider: 'resend' });
    for (const id of AI_SUBPROCESSOR_IDS) expect(rows.map((row) => row.id)).toContain(id);
    for (const row of rows) {
      expect(trWebPages.legal.subprocessors.rows[row.id].name, row.id).toBeTruthy();
      expect(enWebPages.legal.subprocessors.rows[row.id].purpose, row.id).toBeTruthy();
      expect(trWebPages.legal.subprocessors.conditions[row.condition], row.condition).toBeTruthy();
    }
    expect(rows.find((row) => row.id === 'email')?.providerName).toBe('Resend');
    expect(
      buildSubprocessors({ turnstileEnabled: false }).some((row) => row.id === 'turnstile'),
    ).toBe(false);
    expect(
      buildSubprocessors({ turnstileEnabled: false, dataRegionLabel: 'eu-central-1' })[0]?.location,
    ).toEqual({
      kind: 'key',
      key: 'euFrankfurt',
    });
  });

  it('deletion scope rows and outcomes', () => {
    for (const row of DELETION_SCOPE) {
      expect(trWebPages.deletion.scope.rows[row.id], row.id).toBeTruthy();
      expect(enWebPages.deletion.scope.rows[row.id], row.id).toBeTruthy();
    }
    for (const outcome of DELETION_OUTCOMES) {
      expect(trWebPages.deletion.scope.outcomes[outcome], outcome).toBeTruthy();
      expect(enWebPages.deletion.scope.outcomes[outcome], outcome).toBeTruthy();
    }
    // The pre-confirmation summary lists only data an account deletion actually removes.
    expect(ACCOUNT_DELETION_SUMMARY_ROWS).not.toContain('mailbox');
    expect(ACCOUNT_DELETION_SUMMARY_ROWS).not.toContain('sentItems');
    expect(ACCOUNT_DELETION_SUMMARY_ROWS).toContain('connections');
  });
});

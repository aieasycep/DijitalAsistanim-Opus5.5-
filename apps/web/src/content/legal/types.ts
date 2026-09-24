import type { CompanyInfo } from '../company.ts';

/**
 * Typed legal documents (SCREEN_AND_FLOW_MAP Part 5 §3.1, registry R-26). Long-form legal text
 * is kept as structured documents instead of ICU messages so tables, lists and links stay
 * reviewable by counsel; section ids are identical in every locale because the app deep-links to
 * them (`test/legal.test.ts` enforces parity).
 */

export type SitePath = '/' | '/pricing' | '/privacy' | '/terms' | '/support' | '/data-deletion';

export type Inline =
  | string
  | { readonly t: 'strong'; readonly text: string }
  | { readonly t: 'link'; readonly href: string; readonly text: string }
  | { readonly t: 'mail'; readonly address: string }
  | { readonly t: 'page'; readonly to: SitePath; readonly hash?: string; readonly text: string };

export type Block =
  | { readonly type: 'p'; readonly content: readonly Inline[] }
  | { readonly type: 'ul'; readonly items: readonly (readonly Inline[])[] }
  | { readonly type: 'h3'; readonly text: string }
  | {
      readonly type: 'table';
      readonly caption: string;
      readonly head: readonly string[];
      readonly rows: readonly (readonly (readonly Inline[])[])[];
    }
  | { readonly type: 'callout'; readonly id?: string; readonly content: readonly Inline[] }
  | {
      readonly type: 'dl';
      readonly items: readonly { readonly term: string; readonly desc: readonly Inline[] }[];
    }
  | { readonly type: 'retentionTable' }
  | { readonly type: 'subprocessorTable' };

export interface LegalSection {
  readonly id: string;
  readonly heading: string;
  readonly blocks: readonly Block[];
}

export interface LegalDocument {
  readonly id: 'privacy' | 'terms';
  readonly title: string;
  readonly version: string;
  readonly effectiveDate: string;
  readonly sections: readonly LegalSection[];
}

export interface LegalContext {
  readonly company: CompanyInfo;
  readonly backupDays: number | undefined;
  readonly dataRegionLabel: string | undefined;
  readonly turnstileEnabled: boolean;
  readonly referral: {
    readonly rewardDays: number;
    readonly applyWindowDays: number;
    readonly minAccountAgeHours: number;
    readonly maxRewardsPerYear: number;
  };
}

/** Tagged template for inline content: `md\`Metin ${link(url, 'bağlantı')} devamı.\``. */
export function md(strings: TemplateStringsArray, ...values: Inline[]): Inline[] {
  const out: Inline[] = [];
  strings.forEach((text, index) => {
    if (text !== '') out.push(text);
    const value = values[index];
    if (value !== undefined) out.push(value);
  });
  return out;
}

export const strong = (text: string): Inline => ({ t: 'strong', text });
export const link = (href: string, text: string): Inline => ({ t: 'link', href, text });
export const mail = (address: string): Inline => ({ t: 'mail', address });
export const page = (to: SitePath, text: string, hash?: string): Inline =>
  hash === undefined ? { t: 'page', to, text } : { t: 'page', to, text, hash };

export const p = (content: readonly Inline[] | string): Block => ({
  type: 'p',
  content: typeof content === 'string' ? [content] : content,
});
export const ul = (...items: readonly (readonly Inline[] | string)[]): Block => ({
  type: 'ul',
  items: items.map((item) => (typeof item === 'string' ? [item] : item)),
});

/** Plain text of inline content (search, tests, JSON-LD). */
export function inlineText(content: readonly Inline[]): string {
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part.t === 'mail') return part.address;
      return part.text;
    })
    .join('');
}

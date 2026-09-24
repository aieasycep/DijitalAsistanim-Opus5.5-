/**
 * Transactional email templates (JOB-31): the text lives in `packages/i18n`
 * (`backoffice_email` namespace, tr + en); this module picks the keys per template, fills the ICU
 * arguments and renders a plain-text and an escaped HTML body. Values are escaped for HTML and
 * never interpreted as markup.
 */
import tr from '@da/i18n/messages/tr/backoffice_email.json' with { type: 'json' };
import en from '@da/i18n/messages/en/backoffice_email.json' with { type: 'json' };

export type EmailLocale = 'tr' | 'en';
export const EMAIL_TEMPLATE_KEYS = [
  'admin_invite',
  'support_reply',
  'admin_security_recovery_used',
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

type Catalog = typeof tr;
const CATALOGS: Readonly<Record<EmailLocale, Catalog>> = { tr, en: en as Catalog };

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** Replaces `{name}` arguments (simple ICU arguments only). */
export function fill(message: string, args: Readonly<Record<string, string>>): string {
  return message.replace(/\{([a-z_][a-z0-9_]*)\}/gi, (whole, name: string) => args[name] ?? whole);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toHtml(paragraphs: readonly string[]): string {
  const body = paragraphs.map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('\n');
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5">${body}</body></html>`;
}

function render(subject: string, paragraphs: readonly string[]): RenderedEmail {
  return { subject, text: paragraphs.join('\n\n'), html: toHtml(paragraphs) };
}

export function renderAdminInvite(
  locale: EmailLocale,
  args: { name: string; url: string },
): RenderedEmail {
  const c = CATALOGS[locale].invite;
  return render(c.subject, [
    fill(c.greeting, { name: args.name }),
    c.body,
    fill(c.action, { url: args.url }),
    c.expiry,
    c.notYou,
    CATALOGS[locale].signature,
  ]);
}

export function renderSupportReply(
  locale: EmailLocale,
  args: { reference: string; body: string },
): RenderedEmail {
  const c = CATALOGS[locale].supportReply;
  return render(fill(c.subject, { reference: args.reference }), [
    args.body,
    fill(c.footer, { reference: args.reference }),
    CATALOGS[locale].signature,
  ]);
}

export function renderSecurityRecovery(locale: EmailLocale, args: { time: string }): RenderedEmail {
  const c = CATALOGS[locale].securityRecovery;
  return render(c.subject, [
    fill(c.body, { time: args.time }),
    c.action,
    CATALOGS[locale].signature,
  ]);
}

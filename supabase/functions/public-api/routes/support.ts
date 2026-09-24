/**
 * PUB-01 `POST /support` and PUB-08 `POST /support/inbound-email` (API_CONTRACTS §13;
 * IMPLEMENTATION_PLAN T-9.04; BACKOFFICE_PLAN §6.4).
 *
 * PUB-01: honeypot first (a filled `website` gets a silent 202 with a reference-shaped value that
 * matches no ticket, and nothing is stored) → schema → Turnstile when configured → IP-hash 5/h and
 * e-mail-hash 3/h → `support_tickets` (`origin='web'`, `platform='web'`, never linked to a user by
 * e-mail; the subject is the localised category). The same e-mail and message within 10 minutes
 * returns the same reference.
 *
 * PUB-08: HTTP Basic `EMAIL_INBOUND_BASIC_AUTH` (constant time) → provider limit 600/h → the ticket
 * from the reply address (`support+{reference}@…` / `destek+t_{reference}@…`) or `In-Reply-To` →
 * an `inbound_reply` note when the sender is the ticket's contact e-mail (quoted history and
 * attachments dropped, ≤ 5,000 characters), `waiting_user → open`. Replays and mismatches store
 * nothing and still answer `200 {ok:true}`.
 */
import type { Hono } from 'hono';
import { publicApi, publicRoutes } from '@da/validation';
import trSettings from '@da/i18n/messages/tr/settings.json' with { type: 'json' };
import enSettings from '@da/i18n/messages/en/settings.json' with { type: 'json' };
import { fromBase64, utf8 } from '../../_shared/crypto/encoding.ts';
import { secretsEqual, sha256 } from '../../_shared/crypto/hmac.ts';
import { AppError, fieldError } from '../../_shared/errors.ts';
import type { AppEnv } from '../../_shared/http/context.ts';
import { sendData } from '../../_shared/http/respond.ts';
import {
  mountRoute,
  parseJsonBody,
  rawBody,
  validateRequest,
  validBody,
} from '../../_shared/http/validate.ts';
import type { PublicApiServices } from '../deps.ts';
import { emailSubject, enforcePublicLimit, ipSubject } from '../limits.ts';

/** The honeypot answer: `DA-YYYY-0dddddd` never equals a real `DA-YYYY-######` reference. */
export function decoyReference(now: Date): string {
  const digits = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => String(b % 10)).join(
    '',
  );
  return `DA-${now.getUTCFullYear()}-0${digits}`;
}

export function honeypotFilled(raw: unknown): boolean {
  const website = (raw as { website?: unknown } | null)?.website;
  return typeof website === 'string' && website !== '';
}

function categoryLabel(
  category: keyof typeof trSettings.contact.categories,
  locale: 'tr' | 'en',
): string {
  return (locale === 'en' ? enSettings : trSettings).contact.categories[category];
}

/** The mailbox of a `Name <address>` header value. */
export function senderAddress(from: string): string | null {
  const bracket = /<([^<>\s]+@[^<>\s]+)>/.exec(from)?.[1];
  const address = (bracket ?? from).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : null;
}

/** The ticket reference from the reply address or the `In-Reply-To` message id. */
export function inboundReference(to: string, inReplyTo: string | null | undefined): string | null {
  const plus = publicApi.supportReferenceFromAddress(to);
  if (plus !== null) return plus;
  const destek = /destek\+t_(DA-[A-Z0-9-]{4,20})@/i.exec(to)?.[1];
  if (destek !== undefined) return destek.toUpperCase();
  const replied = /(DA-\d{4}-\d{6})/i.exec(inReplyTo ?? '')?.[1];
  return replied === undefined ? null : replied.toUpperCase();
}

/** Drops quoted history ("> …" lines and everything after an "On … wrote:" / "… yazdı:" line). */
export function stripQuotedReply(text: string): string {
  const kept: string[] = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (/^(On .+ wrote:|.+ tarihinde .+ yazdı:|-----Original Message-----)\s*$/i.test(line.trim()))
      break;
    if (line.trimStart().startsWith('>')) continue;
    kept.push(line);
  }
  return kept.join('\n').trim().slice(0, 5000);
}

function basicCredentials(header: string | undefined): string | null {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header?.trim() ?? '');
  if (match?.[1] === undefined) return null;
  try {
    return utf8.decode(fromBase64(match[1]));
  } catch {
    return null;
  }
}

export function registerSupportRoutes(app: Hono<AppEnv>, services: PublicApiServices): void {
  const support = publicRoutes['POST /support'];
  mountRoute(
    app,
    support,
    parseJsonBody(support),
    async (c, next) => {
      if (honeypotFilled(rawBody(c))) {
        return sendData(c, { reference: decoyReference(services.now()) }, 202);
      }
      await next();
    },
    validateRequest(support),
    async (c) => {
      const body = validBody(c, publicApi.PublicSupportBody);
      if (services.captcha !== null && !(await services.captcha.verify(body.captcha_token))) {
        throw fieldError('captcha_token', 'captcha_failed');
      }
      await enforcePublicLimit(c, services, 'support_ip', await ipSubject(c, services.pepper));
      await enforcePublicLimit(
        c,
        services,
        'support_email',
        await emailSubject(services.pepper, body.email),
      );
      const ticket = await services.repo.supportTicket({
        email: body.email,
        name: body.name === undefined || body.name === '' ? null : body.name,
        category: body.category,
        subject: categoryLabel(body.category, body.locale),
        message: body.message,
      });
      return sendData(c, { reference: ticket.reference }, 202);
    },
  );

  const inbound = publicRoutes['POST /support/inbound-email'];
  mountRoute(
    app,
    inbound,
    async (c, next) => {
      const expected = services.inboundBasicAuth?.trim() ?? '';
      if (expected === '') {
        throw new AppError('EXTERNAL_CREDENTIAL_REQUIRED', {
          details: {
            feature: 'support_inbound_email',
            credential_keys: ['EMAIL_INBOUND_BASIC_AUTH'],
          },
        });
      }
      const presented = basicCredentials(c.req.header('Authorization')) ?? '';
      if (!(await secretsEqual(presented, expected)))
        throw new AppError('WEBHOOK_SIGNATURE_INVALID');
      await enforcePublicLimit(c, services, 'inbound_provider', 'provider');
      await next();
    },
    parseJsonBody(inbound),
    validateRequest(inbound),
    async (c) => {
      const body = validBody(c, publicApi.InboundEmailBody);
      const reference = inboundReference(body.to, body.in_reply_to);
      const sender = senderAddress(body.from);
      const text = stripQuotedReply(body.text);
      if (reference !== null && sender !== null && text !== '') {
        const result = await services.repo.inboundNote({
          messageId: body.message_id,
          reference,
          sender,
          body: text,
          digest: await sha256(JSON.stringify(rawBody(c))),
        });
        c.get('log').info('support_inbound', {
          stored: result.stored,
          reason: result.reason ?? null,
        });
      } else {
        c.get('log').info('support_inbound', { stored: false, reason: 'unresolved' });
      }
      return c.json({ ok: true }, 200);
    },
  );
}

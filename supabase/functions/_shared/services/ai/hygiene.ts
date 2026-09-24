/**
 * Token hygiene and PII redaction before any model call (AI_PIPELINE_PLAN §6.9.8, §8.6). Pure
 * functions over a transient body: nothing here is persisted or logged.
 *
 * - `visibleText` strips quoted history, signatures, KVKK/legal disclaimers, unsubscribe footers and
 *   tracking URLs, then caps the text (head + tail) at a token budget (≈3.2 chars per token).
 * - `redactPii` replaces IBANs (mod-97), card numbers (Luhn), TCKN (checksum), OTP / verification
 *   codes and passwords with fixed markers ("HİÇBİR ZAMAN OKUMAZ").
 * - `isHealthSender` marks senders whose bodies never reach a model.
 */
import { stripQuotedHistory } from '@da/domain';
import { sanitizeHtml } from '../../security/html-sanitize.ts';

export const CHARS_PER_TOKEN = 3.2;
export const TRIAGE_BODY_TOKENS = 1_200;
export const DEEP_EXTRACT_BODY_TOKENS = 4_000;
export const THREAD_MESSAGE_TOKENS = 700;

const SIGNATURE_START =
  /^(?:--\s*|saygılarımla[,.]?|iyi çalışmalar[,.]?|teşekkürler[,.]?|best regards[,.]?|kind regards[,.]?|regards[,.]?)$/iu;
const DISCLAIMER =
  /(bu e-?posta ve ekleri|gizlidir|yalnızca alıcıya|6698 sayılı|kvkk|kişisel verilerin korunması|disclaimer|confidential)/iu;
const FOOTER =
  /(abonelikten çık|aboneliğinizi iptal|unsubscribe|bu e-?postayı tarayıcıda görüntüle|view in browser|e-?posta tercihleriniz)/iu;
const TRACKING_URL =
  /https?:\/\/[^\s<>"]*(?:utm_[a-z]+=|click\.|trk\.|track(?:ing)?\.|mailchi\.mp|list-manage\.com|sendgrid\.net\/ls\/click)[^\s<>"]*/giu;
const ZERO_WIDTH = /[​-‍⁠﻿­]+/gu;

/** Plain text of an HTML body (hidden elements dropped). */
export function htmlToText(html: string): string {
  return sanitizeHtml(html, { maxTextChars: 200_000 }).text;
}

function stripSignature(lines: string[]): string[] {
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 12); i--) {
    const line = (lines[i] ?? '').trim();
    if (SIGNATURE_START.test(line)) {
      const tail = lines.slice(i + 1).filter((l) => l.trim() !== '');
      if (tail.length <= 6 && tail.every((l) => l.trim().length <= 60)) return lines.slice(0, i);
    }
  }
  return lines;
}

/** Head + tail cap on a character budget derived from the token budget. */
export function capTokens(text: string, tokens: number): string {
  const max = Math.floor(tokens * CHARS_PER_TOKEN);
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.75);
  const tail = max - head;
  return `${text.slice(0, head).trimEnd()}\n…\n${text.slice(text.length - tail).trimStart()}`;
}

export interface BodyInput {
  readonly text: string;
  readonly html?: string | null;
}

/** Visible, de-noised body text capped at `tokens`. */
export function visibleText(body: BodyInput, tokens: number = TRIAGE_BODY_TOKENS): string {
  const raw = body.text.trim() !== '' ? body.text : htmlToText(body.html ?? '');
  const withoutQuotes = stripQuotedHistory(raw.replace(ZERO_WIDTH, ''));
  const paragraphs = withoutQuotes
    .split(/\n\s*\n/)
    .filter((p) => !DISCLAIMER.test(p) && !FOOTER.test(p));
  const lines = stripSignature(paragraphs.join('\n\n').split(/\r?\n/));
  const text = lines
    .join('\n')
    .replace(TRACKING_URL, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return capTokens(text, tokens);
}

// ── Redaction ────────────────────────────────────────────────────────────────

function ibanValid(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^TR\d{24}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function tcknValid(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const d = [...value].map(Number);
  const odd = (d[0] ?? 0) + (d[2] ?? 0) + (d[4] ?? 0) + (d[6] ?? 0) + (d[8] ?? 0);
  const even = (d[1] ?? 0) + (d[3] ?? 0) + (d[5] ?? 0) + (d[7] ?? 0);
  const d10 = (((odd * 7 - even) % 10) + 10) % 10;
  const d11 = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10;
  return d10 === d[9] && d11 === d[10];
}

export interface RedactionResult {
  readonly text: string;
  readonly count: number;
}

/** Replaces sensitive values with markers; `count` goes to telemetry (never the values). */
export function redactPii(input: string): RedactionResult {
  let count = 0;
  let text = input.replace(/TR\d{2}(?:\s?\d{4}){5}\s?\d{2}/giu, (m) => {
    if (!ibanValid(m)) return m;
    count++;
    return '[IBAN]';
  });
  text = text.replace(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/gu, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19 || !luhnValid(digits)) return m;
    count++;
    return `[KART ••••${digits.slice(-4)}]`;
  });
  text = text.replace(/(?<!\d)[1-9]\d{10}(?!\d)/gu, (m) => {
    if (!tcknValid(m)) return m;
    count++;
    return '[TCKN]';
  });
  text = text.replace(
    /((?:doğrulama|onay|güvenlik|tek\s*kullanımlık)\s*(?:kodu|şifresi)?\s*[:：]?\s*)\d{4,8}(?!\d)/giu,
    (_m, prefix: string) => {
      count++;
      return `${prefix}[KOD]`;
    },
  );
  text = text.replace(
    /((?:kod|code|otp|şifre)\D{0,40}?)(?<!\d)\d{4,8}(?!\d)/giu,
    (_m, prefix: string) => {
      count++;
      return `${prefix}[KOD]`;
    },
  );
  text = text.replace(/((?:şifre(?:niz)?|parola(?:nız)?|password)\s*[:：]\s*)\S+/giu, (_m, p: string) => {
    count++;
    return `${p}[ŞİFRE]`;
  });
  return { text, count };
}

const HEALTH_DOMAINS = ['mhrs.gov.tr', 'enabiz.gov.tr', 'saglik.gov.tr', 'e-nabiz.gov.tr'];
const HEALTH_HINT = /(hastane|hospital|klinik|clinic|saglik|medical|tip merkezi)/iu;

/** Health senders: the body never reaches a model (T0 only). */
export function isHealthSender(fromEmail: string): boolean {
  const domain = fromEmail.slice(fromEmail.lastIndexOf('@') + 1).toLowerCase();
  return (
    HEALTH_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`)) ||
    HEALTH_HINT.test(domain)
  );
}

/** Normalised, redacted, capped text for a model. */
export function modelText(body: BodyInput, tokens: number): RedactionResult {
  return redactPii(visibleText(body, tokens));
}

/**
 * Gmail MIME contract (INTEGRATION_PLAN §3.12 "Gmail MIME contract"; API_CONTRACTS §6.4):
 * - `buildReplyMime`: the approved reply as RFC 5322 with `From` (the connected mailbox), `To`/`Cc`
 *   exactly as approved, the approved `Subject` (RFC 2047 when non-ASCII), `In-Reply-To`,
 *   `References` (≤ 20 kept + the original Message-ID), the marker `Message-ID`, `Date`,
 *   `multipart/alternative` with base64 `text/plain` and an escaped `text/html` rendition; header
 *   values are stripped of CR/LF (no header injection); the result is base64url for
 *   `messages.send {raw, threadId}`;
 * - `parseGmailPayload`: `format=full` payload → `TransientMailBody` (text, html, attachments),
 *   decoded per part charset and capped at `maxBytes`. Never persisted, never logged.
 */
import type { MailAddress, OutboundReply, TransientMailBody } from '@da/domain';
import { fromBase64Url, toBase64, toBase64Url, utf8 } from '../../crypto/encoding.ts';
import { htmlToText } from '../common.ts';

const NON_ASCII = /[^\x20-\x7e]/;

function clean(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** RFC 2047 `=?UTF-8?B?…?=` when needed. */
export function encodeHeaderWord(value: string): string {
  const v = clean(value);
  return NON_ASCII.test(v) ? `=?UTF-8?B?${toBase64(utf8.encode(v))}?=` : v;
}

function formatAddress(address: MailAddress): string {
  const email = clean(address.address);
  if (address.name === null || address.name.trim() === '') return email;
  const name = clean(address.name);
  return NON_ASCII.test(name)
    ? `${encodeHeaderWord(name)} <${email}>`
    : `"${name.replace(/["\\]/g, '')}" <${email}>`;
}

function wrap76(base64: string): string {
  return base64.replace(/(.{76})/g, '$1\r\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function angle(id: string): string {
  const v = clean(id);
  return v.startsWith('<') ? v : `<${v}>`;
}

export interface MimeOptions {
  readonly date: Date;
  readonly boundary?: string;
}

/** The raw RFC 5322 message (CRLF line endings). */
export function buildReplyMime(reply: OutboundReply, options: MimeOptions): string {
  const boundary = options.boundary ?? `da-${crypto.randomUUID()}`;
  const references = [...reply.originalReferences.slice(-20)];
  if (reply.originalRfc822MessageId !== null) references.push(reply.originalRfc822MessageId);
  const headers = [
    `From: ${formatAddress(reply.from)}`,
    `To: ${reply.to.map(formatAddress).join(', ')}`,
    ...(reply.cc.length > 0 ? [`Cc: ${reply.cc.map(formatAddress).join(', ')}`] : []),
    `Subject: ${encodeHeaderWord(reply.subject)}`,
    `Message-ID: ${angle(reply.marker.rfc822MessageId)}`,
    ...(reply.originalRfc822MessageId === null
      ? []
      : [`In-Reply-To: ${angle(reply.originalRfc822MessageId)}`]),
    ...(references.length === 0 ? [] : [`References: ${references.map(angle).join(' ')}`]),
    `Date: ${options.date.toUTCString().replace('GMT', '+0000')}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const html = `<div dir="auto">${escapeHtml(reply.bodyText).replace(/\r?\n/g, '<br>')}</div>`;
  const part = (type: string, content: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset=UTF-8`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(toBase64(utf8.encode(content))),
    ].join('\r\n');
  return [
    ...headers,
    '',
    part('text/plain', reply.bodyText),
    part('text/html', html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/** base64url of the raw message (`messages.send` `raw`). */
export function encodeRaw(mime: string): string {
  return toBase64Url(utf8.encode(mime));
}

export interface GmailPart {
  readonly partId?: string;
  readonly mimeType?: string;
  readonly filename?: string;
  readonly headers?: readonly { name: string; value: string }[];
  readonly body?: {
    readonly data?: string;
    readonly size?: number;
    readonly attachmentId?: string;
  };
  readonly parts?: readonly GmailPart[];
}

function header(part: GmailPart, name: string): string | null {
  const lower = name.toLowerCase();
  return part.headers?.find((h) => h.name.toLowerCase() === lower)?.value ?? null;
}

function charsetOf(part: GmailPart): string {
  const match = /charset="?([^";\s]+)"?/i.exec(header(part, 'Content-Type') ?? '');
  return (match?.[1] ?? 'utf-8').toLowerCase();
}

function decodePart(part: GmailPart): string {
  const data = part.body?.data;
  if (data === undefined || data === '') return '';
  const bytes = fromBase64Url(data);
  try {
    return new TextDecoder(charsetOf(part)).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function capBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = utf8.encode(text);
  if (bytes.byteLength <= maxBytes) return { text, truncated: false };
  return {
    text: new TextDecoder().decode(bytes.slice(0, maxBytes)).replace(/\uFFFD+$/, ''),
    truncated: true,
  };
}

/** Walks a `format=full` payload into the transient body model. */
export function parseGmailPayload(
  payload: GmailPart | undefined,
  maxBytes: number,
): TransientMailBody {
  const texts: string[] = [];
  const htmls: string[] = [];
  const attachments: TransientMailBody['attachments'][number][] = [];
  const walk = (part: GmailPart) => {
    const type = (part.mimeType ?? '').toLowerCase();
    const disposition = (header(part, 'Content-Disposition') ?? '').toLowerCase();
    const isAttachment =
      (part.filename !== undefined && part.filename !== '') || disposition.startsWith('attachment');
    if (isAttachment && part.body?.attachmentId !== undefined) {
      attachments.push({
        providerAttachmentId: part.body.attachmentId,
        filename: (part.filename ?? '').slice(0, 255),
        mimeType: type === '' ? 'application/octet-stream' : type,
        sizeBytes: part.body.size ?? 0,
        inline: disposition.startsWith('inline') || header(part, 'Content-ID') !== null,
      });
      return;
    }
    if (type === 'text/plain' && !isAttachment) texts.push(decodePart(part));
    else if (type === 'text/html' && !isAttachment) htmls.push(decodePart(part));
    for (const child of part.parts ?? []) walk(child);
  };
  if (payload !== undefined) walk(payload);
  const html = htmls.length === 0 ? null : capBytes(htmls.join('\n'), maxBytes);
  const rawText = texts.length > 0 ? texts.join('\n') : html === null ? '' : htmlToText(html.text);
  const text = capBytes(rawText, Math.min(maxBytes, 200 * 1024));
  return {
    text: text.text,
    html: html?.text ?? null,
    truncated: text.truncated || (html?.truncated ?? false),
    attachments: attachments.slice(0, 50),
  };
}

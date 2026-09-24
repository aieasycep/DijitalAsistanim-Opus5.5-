/**
 * Upload validation (M§85, SECURITY_AND_PRIVACY_PLAN CTL-3.11, API_CONTRACTS §2.10,
 * IMPLEMENTATION_PLAN T-3.05): declared MIME, extension, size and the sniffed magic bytes must all
 * agree. Accepted: PDF (`%PDF-`), JPEG (`FF D8 FF`), PNG, HEIC/HEIF (`ftyp` brands), WebP
 * (`RIFF….WEBP`) and UTF-8 text. Executables, archives (ZIP containers such as docx/xlsx), SVG and
 * everything else are rejected. Errors map to `UPLOAD_INVALID` / `PAYLOAD_TOO_LARGE`.
 */

export type UploadMime =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/heic'
  | 'image/heif'
  | 'text/plain';

export type SniffedMime =
  UploadMime | 'application/zip' | 'application/x-executable' | 'image/svg+xml' | 'unknown';

export const UPLOAD_RULES: Readonly<
  Record<UploadMime, { extensions: readonly string[]; maxBytes: number }>
> = {
  'application/pdf': { extensions: ['pdf'], maxBytes: 20 * 1024 * 1024 },
  'image/jpeg': { extensions: ['jpg', 'jpeg'], maxBytes: 15 * 1024 * 1024 },
  'image/png': { extensions: ['png'], maxBytes: 15 * 1024 * 1024 },
  'image/webp': { extensions: ['webp'], maxBytes: 15 * 1024 * 1024 },
  'image/heic': { extensions: ['heic'], maxBytes: 15 * 1024 * 1024 },
  'image/heif': { extensions: ['heif', 'heic'], maxBytes: 15 * 1024 * 1024 },
  'text/plain': { extensions: ['txt'], maxBytes: 1024 * 1024 },
};

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.byteLength < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, Math.min(to, bytes.byteLength)));
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis']);
const HEIF_BRANDS = new Set(['mif1', 'msf1', 'heif']);

/** Identifies a file from its leading bytes. */
export function sniffMime(bytes: Uint8Array): SniffedMime {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && ascii(bytes, 8, 12) === 'WEBP')
    return 'image/webp';
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12).toLowerCase();
    if (HEIC_BRANDS.has(brand)) return 'image/heic';
    if (HEIF_BRANDS.has(brand)) return 'image/heif';
    return 'unknown';
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    return 'application/zip';
  }
  if (
    startsWith(bytes, [0x4d, 0x5a]) || // PE / DOS
    startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46]) || // ELF
    startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe]) || // Mach-O 64
    startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe]) || // Mach-O fat / Java class
    startsWith(bytes, [0x23, 0x21]) // shebang script
  ) {
    return 'application/x-executable';
  }
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, 512))
    .trimStart()
    .toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')))
    return 'image/svg+xml';
  if (isUtf8Text(bytes)) return 'text/plain';
  return 'unknown';
}

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0) return false;
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export type UploadRejection =
  | 'mime_not_allowed'
  | 'extension_mismatch'
  | 'magic_mismatch'
  | 'too_large'
  | 'empty'
  | 'archive'
  | 'executable'
  | 'svg';

export type UploadCheck =
  | { ok: true; mime: UploadMime; extension: string }
  | { ok: false; reason: UploadRejection; limitBytes?: number };

export interface UploadDescriptor {
  readonly declaredMime: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  /** Leading bytes (at least 16) or the whole file. */
  readonly head?: Uint8Array;
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

function isUploadMime(value: string): value is UploadMime {
  return Object.prototype.hasOwnProperty.call(UPLOAD_RULES, value);
}

/** Validates a declared upload (before the signed URL) and, with `head`, the stored bytes. */
export function validateUpload(
  input: UploadDescriptor,
  allowed?: readonly UploadMime[],
): UploadCheck {
  const mime = input.declaredMime.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!isUploadMime(mime) || (allowed !== undefined && !allowed.includes(mime))) {
    return { ok: false, reason: 'mime_not_allowed' };
  }
  const rule = UPLOAD_RULES[mime];
  const extension = extensionOf(input.fileName);
  if (!rule.extensions.includes(extension)) return { ok: false, reason: 'extension_mismatch' };
  if (input.sizeBytes <= 0) return { ok: false, reason: 'empty' };
  if (input.sizeBytes > rule.maxBytes)
    return { ok: false, reason: 'too_large', limitBytes: rule.maxBytes };
  if (input.head !== undefined) {
    const sniffed = sniffMime(input.head);
    if (sniffed === 'application/zip') return { ok: false, reason: 'archive' };
    if (sniffed === 'application/x-executable') return { ok: false, reason: 'executable' };
    if (sniffed === 'image/svg+xml') return { ok: false, reason: 'svg' };
    const matches = sniffed === mime || (mime === 'image/heif' && sniffed === 'image/heic');
    if (!matches) return { ok: false, reason: 'magic_mismatch' };
  }
  return { ok: true, mime, extension };
}

/** PDF extra checks (CTL-3.11): encrypted PDFs and files without `%%EOF` are refused. */
export function inspectPdf(
  bytes: Uint8Array,
  maxPages = 50,
):
  | { ok: true; pages: number }
  | { ok: false; reason: 'encrypted' | 'truncated' | 'too_many_pages' } {
  const text = new TextDecoder('latin1').decode(bytes);
  if (/\/Encrypt\b/.test(text)) return { ok: false, reason: 'encrypted' };
  if (!text.slice(-2048).includes('%%EOF')) return { ok: false, reason: 'truncated' };
  const pages = (text.match(/\/Type\s*\/Page(?!s)\b/g) ?? []).length;
  if (pages > maxPages) return { ok: false, reason: 'too_many_pages' };
  return { ok: true, pages };
}

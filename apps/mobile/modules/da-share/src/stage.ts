/**
 * Share staging (T-8.17, M-CAP-04): shared files arrive as short-lived references (Android
 * `content://` grants, iOS App Group container paths). They are copied into the app cache
 * (`<cache>/share/`) at once and validated against the capture limits (≤5 items; images ≤15 MB,
 * PDF ≤20 MB; text ≤20,000 characters). Files are passed by URI, never as base64 in memory (the
 * iOS extension memory limit). `clearStagedShare()` removes everything (discard, sign-out).
 */
import * as FileSystem from 'expo-file-system/legacy';

export const SHARE_LIMITS = {
  maxItems: 5,
  imageBytes: 15 * 1024 * 1024,
  pdfBytes: 20 * 1024 * 1024,
  textChars: 20_000,
} as const;

export interface SharedFileInput {
  readonly path: string;
  readonly mimeType: string;
  readonly fileName: string;
  readonly size: number | null;
}

export interface StagedFile {
  readonly uri: string;
  readonly mime: string;
  readonly name: string;
  readonly size: number;
  readonly kind: 'photo' | 'pdf';
}

export type StageRejection = 'unsupported' | 'too_large';

export interface StageResult {
  readonly files: readonly StagedFile[];
  readonly rejected: readonly { readonly name: string; readonly reason: StageRejection }[];
  /** More than 5 items arrived; only the first 5 were kept. */
  readonly truncated: boolean;
}

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']);

export function stagingDirectory(): string {
  return `${FileSystem.cacheDirectory ?? 'file:///cache/'}share/`;
}

function safeName(name: string, index: number): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);
  return `${String(index)}-${cleaned === '' ? 'file' : cleaned}`;
}

function kindOf(mime: string): StagedFile['kind'] | null {
  if (mime === 'application/pdf') return 'pdf';
  return IMAGE_MIME.has(mime) ? 'photo' : null;
}

function withScheme(path: string): string {
  return /^[a-z]+:\/\//i.test(path) ? path : `file://${path}`;
}

/** Copies and validates shared files; nothing is uploaded here. */
export async function stageSharedFiles(inputs: readonly SharedFileInput[]): Promise<StageResult> {
  const dir = stagingDirectory();
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
  const truncated = inputs.length > SHARE_LIMITS.maxItems;
  const files: StagedFile[] = [];
  const rejected: { name: string; reason: StageRejection }[] = [];
  for (const [index, input] of inputs.slice(0, SHARE_LIMITS.maxItems).entries()) {
    const mime = input.mimeType.toLowerCase();
    const kind = kindOf(mime);
    if (kind === null) {
      rejected.push({ name: input.fileName, reason: 'unsupported' });
      continue;
    }
    const target = `${dir}${safeName(input.fileName, index)}`;
    await FileSystem.copyAsync({ from: withScheme(input.path), to: target });
    const info = await FileSystem.getInfoAsync(target);
    const size = info.exists && typeof info.size === 'number' ? info.size : (input.size ?? 0);
    const limit = kind === 'pdf' ? SHARE_LIMITS.pdfBytes : SHARE_LIMITS.imageBytes;
    if (size > limit) {
      await FileSystem.deleteAsync(target, { idempotent: true });
      rejected.push({ name: input.fileName, reason: 'too_large' });
      continue;
    }
    files.push({ uri: target, mime, name: input.fileName, size, kind });
  }
  return { files, rejected, truncated };
}

/** Deletes every staged file (close/discard of a share, sign-out). */
export async function clearStagedShare(): Promise<void> {
  await FileSystem.deleteAsync(stagingDirectory(), { idempotent: true });
}

/** Text shares are capped at 20,000 characters (API `CAPTURE_LIMITS.text_chars`). */
export function clampSharedText(text: string | null | undefined): string {
  return (text ?? '').slice(0, SHARE_LIMITS.textChars);
}

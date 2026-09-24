/**
 * Capture writes (API-CAP-01…05, M-CAP-01/03/04/06): text, link and share captures through
 * `POST /captures`; files through `POST /captures/upload-url` → a PUT of the local file to the
 * signed Storage URL (real byte progress) → `POST /captures/:id/analyze`. Analysis starts only on
 * "Analiz Et". The results screen sends selected items with `POST /captures/:id/actions` (pending
 * approvals for the batch sheet) and "İptal" / discard is `POST /captures/:id/discard`.
 */
import { isApiError, qk, type ApiClient } from '@da/api-client';
import {
  captureActionsMutationOptions,
  captureAnalyzeMutationOptions,
  captureCreateMutationOptions,
  captureDiscardMutationOptions,
  captureUploadUrlMutationOptions,
} from '@da/api-client/react';
import type { Capture } from '@da/validation/api/common';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

import { getApiClient } from '../../lib/bootstrap';
import { getQueryClient } from '../../lib/query/client';
import { runMutation } from '../../lib/query/run-mutation';
import type { DraftFile, ShareOrigin } from './draft';

export const CAPTURE_MIME = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
  'application/pdf',
] as const;
export type CaptureMimeType = (typeof CAPTURE_MIME)[number];

export const IMAGE_LIMIT = 15 * 1024 * 1024;
export const PDF_LIMIT = 20 * 1024 * 1024;

export type LinkProblem = 'invalid' | 'scheme' | 'blocked' | 'preview_failed';

/** Client-side URL check: https only, never auto-upgraded (R-11). */
export function checkUrl(value: string): LinkProblem | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return 'invalid';
  }
  if (url.protocol !== 'https:') return 'scheme';
  if (url.hostname === '' || !url.hostname.includes('.')) return 'invalid';
  return null;
}

export function isCaptureMime(mime: string): mime is CaptureMimeType {
  return (CAPTURE_MIME as readonly string[]).includes(mime);
}

export type FileProblem = 'too_large' | 'unsupported';

export function checkFile(file: Pick<DraftFile, 'mime' | 'size'>): FileProblem | null {
  if (!isCaptureMime(file.mime)) return 'unsupported';
  const limit = file.mime === 'application/pdf' ? PDF_LIMIT : IMAGE_LIMIT;
  return file.size > limit ? 'too_large' : null;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256File(uri: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, base64ToBytes(base64));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A link capture for the preview (`POST /captures {kind:'link'}`). */
export async function createLinkCapture(
  url: string,
  shareOrigin: ShareOrigin,
  api: ApiClient = getApiClient(),
): Promise<Capture> {
  return runMutation(captureCreateMutationOptions(api), {
    body: {
      client_capture_id: Crypto.randomUUID(),
      share_origin: shareOrigin,
      source: { kind: 'link', url: url.trim(), preview: true },
    },
  });
}

/** The link error of a failed preview. */
export function linkProblemOf(error: unknown): LinkProblem {
  if (!isApiError(error)) return 'preview_failed';
  const reason = typeof error.details.reason === 'string' ? error.details.reason : '';
  if (/ssrf|blocked|private|forbidden/i.test(reason) || error.code === 'FORBIDDEN')
    return 'blocked';
  if (error.code === 'VALIDATION_FAILED') return 'invalid';
  return 'preview_failed';
}

export async function createTextCapture(
  text: string,
  shareOrigin: ShareOrigin,
  api: ApiClient = getApiClient(),
): Promise<Capture> {
  return runMutation(captureCreateMutationOptions(api), {
    body: {
      client_capture_id: Crypto.randomUUID(),
      share_origin: shareOrigin,
      source: { kind: 'text', text: text.trim() },
    },
  });
}

/** A shared text/url bundle (`kind:'share'`). */
export async function createShareCapture(
  text: string,
  url: string,
  shareOrigin: ShareOrigin,
  api: ApiClient = getApiClient(),
): Promise<Capture> {
  return runMutation(captureCreateMutationOptions(api), {
    body: {
      client_capture_id: Crypto.randomUUID(),
      share_origin: shareOrigin,
      source: {
        kind: 'share',
        ...(text.trim() === '' ? {} : { text: text.trim() }),
        ...(url.trim() === '' ? {} : { url: url.trim() }),
      },
    },
  });
}

/** Uploads one file and returns its capture id; `onProgress` gets real byte fractions. */
export async function uploadFile(
  file: DraftFile,
  shareOrigin: ShareOrigin,
  onProgress: (fraction: number) => void,
  api: ApiClient = getApiClient(),
): Promise<string> {
  if (!isCaptureMime(file.mime)) throw new Error('unsupported');
  const kind = file.mime === 'application/pdf' ? 'pdf' : file.kind === 'pdf' ? 'file' : file.kind;
  const target = await runMutation(captureUploadUrlMutationOptions(api), {
    body: {
      client_capture_id: Crypto.randomUUID(),
      kind,
      mime: file.mime,
      size_bytes: Math.max(1, file.size),
      sha256: await sha256File(file.uri),
      share_origin: shareOrigin,
    },
  });
  const task = FileSystem.createUploadTask(
    target.upload.signed_url,
    file.uri,
    {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: target.upload.headers,
    },
    (progress) => {
      if (progress.totalBytesExpectedToSend > 0) {
        onProgress(progress.totalBytesSent / progress.totalBytesExpectedToSend);
      }
    },
  );
  const result = await task.uploadAsync();
  if (result === undefined || result === null || result.status < 200 || result.status >= 300) {
    throw new Error('upload_failed');
  }
  onProgress(1);
  return target.capture_id;
}

export async function analyzeCapture(
  captureId: string,
  hintType?: Capture['primary_type'],
  api: ApiClient = getApiClient(),
): Promise<void> {
  await runMutation(captureAnalyzeMutationOptions(api), {
    input: {
      params: { id: captureId },
      body: hintType === undefined || hintType === null ? {} : { hint_type: hintType },
    },
    idempotencyKey: Crypto.randomUUID(),
  });
  void getQueryClient().invalidateQueries({ queryKey: qk.captures.detail(captureId) });
}

export async function discardCapture(captureId: string, api: ApiClient = getApiClient()) {
  await runMutation(captureDiscardMutationOptions(api), {
    input: { params: { id: captureId }, body: {} },
    idempotencyKey: Crypto.randomUUID(),
  });
  void getQueryClient().invalidateQueries({ queryKey: qk.captures.all });
}

export type CaptureActionType =
  'calendar_create' | 'task_create' | 'reminder_create' | 'commitment_create';

export async function proposeCaptureActions(
  captureId: string,
  items: readonly {
    readonly itemId: string;
    readonly action: CaptureActionType;
    readonly overrides?: Readonly<Record<string, unknown>>;
  }[],
  saveToMemory: boolean,
  api: ApiClient = getApiClient(),
) {
  return runMutation(captureActionsMutationOptions(api), {
    input: {
      params: { id: captureId },
      body: {
        items: items.map((item) => ({
          item_id: item.itemId,
          action_type: item.action,
          ...(item.overrides === undefined ? {} : { overrides: { ...item.overrides } }),
        })),
        save_to_memory: saveToMemory,
      },
    },
    idempotencyKey: Crypto.randomUUID(),
  });
}

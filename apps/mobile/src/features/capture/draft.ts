/**
 * The capture draft (`useCaptureDraftStore`, M-CAP-01/04): text (≤5,000 characters in the composer,
 * 20,000 for shares), a link, and up to 5 picked or shared files (local URIs only), kept in the
 * encrypted MMKV prefs store so "Sakla" and an app restart keep it, and a share waiting for
 * sign-in or Pro survives. Nothing here talks to the network.
 */
import { useSyncExternalStore } from 'react';

import { encryptedStorage, isEncryptedStorageOpen } from '../../lib/storage';

export type DraftFileKind = 'photo' | 'screenshot' | 'pdf' | 'file';

export interface DraftFile {
  readonly uri: string;
  readonly mime: string;
  readonly name: string;
  readonly size: number;
  readonly kind: DraftFileKind;
}

export type ShareOrigin = 'in_app' | 'ios_share' | 'android_send' | 'assistant' | 'today';

export interface CaptureDraft {
  readonly text: string;
  readonly url: string;
  readonly files: readonly DraftFile[];
  readonly shareOrigin: ShareOrigin;
  /** The link capture created for the preview (analyzed on "Analiz Et"). */
  readonly linkCaptureId: string | null;
  readonly shareNotice: 'truncated' | 'unsupported' | 'too_large' | null;
}

export const EMPTY_DRAFT: CaptureDraft = {
  text: '',
  url: '',
  files: [],
  shareOrigin: 'in_app',
  linkCaptureId: null,
  shareNotice: null,
};

export const MAX_FILES = 5;
export const MAX_TEXT = 5_000;
const KEY = 'capture.draft';

let memory: CaptureDraft = EMPTY_DRAFT;
let loaded = false;
const listeners = new Set<() => void>();

function load(): CaptureDraft {
  if (loaded) return memory;
  loaded = true;
  if (!isEncryptedStorageOpen()) return memory;
  const raw = encryptedStorage().prefs.getString(KEY);
  if (raw === undefined) return memory;
  try {
    memory = { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<CaptureDraft>) };
  } catch {
    memory = EMPTY_DRAFT;
  }
  return memory;
}

export function getDraft(): CaptureDraft {
  return load();
}

export function setDraft(next: CaptureDraft | ((current: CaptureDraft) => CaptureDraft)): void {
  memory = typeof next === 'function' ? next(load()) : next;
  if (isEncryptedStorageOpen()) {
    const prefs = encryptedStorage().prefs;
    if (isDraftEmpty(memory) && memory.shareOrigin === 'in_app') prefs.remove(KEY);
    else prefs.set(KEY, JSON.stringify(memory));
  }
  for (const listener of listeners) listener();
}

export function clearDraft(): void {
  setDraft(EMPTY_DRAFT);
}

export function isDraftEmpty(draft: CaptureDraft): boolean {
  return draft.text.trim() === '' && draft.url.trim() === '' && draft.files.length === 0;
}

export function isSharedDraft(draft: CaptureDraft): boolean {
  return draft.shareOrigin === 'ios_share' || draft.shareOrigin === 'android_send';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCaptureDraft(): CaptureDraft {
  return useSyncExternalStore(subscribe, getDraft, getDraft);
}

export function resetDraftForTests(): void {
  memory = EMPTY_DRAFT;
  loaded = false;
  for (const listener of listeners) listener();
}

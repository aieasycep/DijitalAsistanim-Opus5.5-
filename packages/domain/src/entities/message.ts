/**
 * Localisable message references. Domain code never hard-codes user-facing copy; it returns an
 * i18n key from `packages/i18n` plus ICU parameters, and the caller (app or Edge Function) resolves
 * it with its catalog.
 */

export type MessageParamValue = string | number;
export type MessageParams = Readonly<Record<string, MessageParamValue>>;

export interface MessageRef {
  /** Dotted catalog key, e.g. `push.critical_email.title_only.title`. */
  readonly key: string;
  readonly params: MessageParams;
}

/** Resolves a catalog key with ICU params to text (server passes its `tr`/`en` catalog lookup). */
export type MessageResolver = (key: string, params: MessageParams) => string;

export function messageRef(key: string, params: MessageParams = {}): MessageRef {
  return { key, params };
}

export function resolveMessage(ref: MessageRef, resolve: MessageResolver): string {
  return resolve(ref.key, ref.params);
}

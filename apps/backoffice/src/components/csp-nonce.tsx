'use client';

import { setNonce } from 'get-nonce';

/**
 * Hands the request's CSP nonce to `get-nonce`, which Radix's scroll lock (react-remove-scroll /
 * react-style-singleton) uses for the `<style>` element it injects when a dialog opens. Without it
 * the nonce CSP (`style-src 'self' 'nonce-…'`) blocks that element (CTL-3.18: zero violations).
 */
export function CspNonce({ nonce }: { nonce: string | null }) {
  if (nonce !== null && nonce !== '') setNonce(nonce);
  return null;
}

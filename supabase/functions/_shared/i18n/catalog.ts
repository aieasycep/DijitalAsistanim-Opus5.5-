/**
 * Server-side catalog lookup for the namespaces the Edge Functions render (`push`, `approvals`,
 * `reminder`, `widgets`, `common`; API_CONTRACTS §2.13). The JSON files are the same ICU catalogs the apps
 * use (`packages/i18n/messages/<locale>/<ns>.json`); keys are `<namespace>.<dotted path>`.
 * Asynchronous output uses `profiles.locale`, synchronous responses the request locale.
 */
import trPush from '@da/i18n/messages/tr/push.json' with { type: 'json' };
import enPush from '@da/i18n/messages/en/push.json' with { type: 'json' };
import trApprovals from '@da/i18n/messages/tr/approvals.json' with { type: 'json' };
import enApprovals from '@da/i18n/messages/en/approvals.json' with { type: 'json' };
import trReminder from '@da/i18n/messages/tr/reminder.json' with { type: 'json' };
import enReminder from '@da/i18n/messages/en/reminder.json' with { type: 'json' };
import trWidgets from '@da/i18n/messages/tr/widgets.json' with { type: 'json' };
import enWidgets from '@da/i18n/messages/en/widgets.json' with { type: 'json' };
import trCommon from '@da/i18n/messages/tr/common.json' with { type: 'json' };
import enCommon from '@da/i18n/messages/en/common.json' with { type: 'json' };
import type { MessageParams } from '@da/domain';
import { formatIcu, type IcuLocale } from './icu.ts';

export type ServerLocale = IcuLocale;

type Tree = { readonly [key: string]: unknown };

const CATALOGS: Readonly<Record<ServerLocale, Readonly<Record<string, Tree>>>> = {
  tr: {
    push: trPush,
    approvals: trApprovals,
    reminder: trReminder,
    widgets: trWidgets,
    common: trCommon,
  },
  en: {
    push: enPush,
    approvals: enApprovals,
    reminder: enReminder,
    widgets: enWidgets,
    common: enCommon,
  },
};

/** `tr-TR` / `tr` → `tr`; `en-US` / `en` → `en`; anything else → `tr` (the default locale). */
export function serverLocale(value: string | null | undefined): ServerLocale {
  return typeof value === 'string' && value.toLowerCase().startsWith('en') ? 'en' : 'tr';
}

/** The raw ICU message of a key, or `undefined` when the catalog has no string there. */
export function lookupMessage(locale: ServerLocale, key: string): string | undefined {
  const [namespace, ...path] = key.split('.');
  let node: unknown = namespace === undefined ? undefined : CATALOGS[locale][namespace];
  for (const part of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Tree)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export function hasMessage(key: string): boolean {
  return lookupMessage('tr', key) !== undefined && lookupMessage('en', key) !== undefined;
}

export class MissingMessageError extends Error {
  constructor(readonly key: string) {
    super(`missing_message:${key}`);
    this.name = 'MissingMessageError';
  }
}

/** Formats a catalog message; a missing key is a programming error and throws. */
export function translate(locale: ServerLocale, key: string, params: MessageParams = {}): string {
  const message = lookupMessage(locale, key);
  if (message === undefined) throw new MissingMessageError(key);
  return formatIcu(message, params, locale);
}

/** A `MessageResolver` bound to one locale (for domain `renderText`-style helpers). */
export function resolverFor(locale: ServerLocale): (key: string, params: MessageParams) => string {
  return (key, params) => translate(locale, key, params);
}

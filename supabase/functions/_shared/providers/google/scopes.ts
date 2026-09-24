/**
 * Google capability ↔ scope registry (INTEGRATION_PLAN §2.11; API_CONTRACTS §7). Least privilege:
 * read scopes at connect, write scopes only at the first approved write (progressive upgrade).
 * Never requested: gmail.compose, gmail.modify, gmail.metadata, https://mail.google.com/.
 */
import type { Capability } from '@da/domain';

const G = 'https://www.googleapis.com/auth/';

/** Added to every authorization request so the callback receives a verifiable id_token. */
export const GOOGLE_IDENTITY_SCOPES: readonly string[] = ['openid', 'email', 'profile'];

export const GOOGLE_CAPABILITY_SCOPES: Readonly<Record<Capability, readonly string[]>> = {
  mail_read: [`${G}gmail.readonly`],
  mail_send: [`${G}gmail.send`],
  calendar_read: [
    `${G}calendar.events.readonly`,
    `${G}calendar.calendarlist.readonly`,
    `${G}calendar.settings.readonly`,
  ],
  calendar_write: [`${G}calendar.events.owned`],
  tasks_read: [`${G}tasks.readonly`],
  tasks_write: [`${G}tasks`],
};

/** Broader grants that also satisfy a capability (a user may hold them from an earlier consent). */
const ALTERNATIVES: Partial<Readonly<Record<Capability, readonly (readonly string[])[]>>> = {
  calendar_read: [[`${G}calendar.readonly`], [`${G}calendar`]],
  calendar_write: [[`${G}calendar.events`], [`${G}calendar`]],
  tasks_read: [[`${G}tasks`]],
};

const ORDER: readonly Capability[] = [
  'mail_read',
  'mail_send',
  'calendar_read',
  'calendar_write',
  'tasks_read',
  'tasks_write',
];

export function googleScopesFor(
  capabilities: readonly Capability[],
  opts: { includeIdentity: boolean },
): string[] {
  const out = new Set<string>(opts.includeIdentity ? GOOGLE_IDENTITY_SCOPES : []);
  for (const capability of ORDER) {
    if (capabilities.includes(capability)) {
      for (const scope of GOOGLE_CAPABILITY_SCOPES[capability]) out.add(scope);
    }
  }
  return [...out];
}

/** A capability counts only when every one of its scopes appears in the granted scope string. */
export function googleCapabilitiesFromScope(grantedScope: string): Capability[] {
  const granted = new Set(grantedScope.split(/\s+/).filter((s) => s !== ''));
  return ORDER.filter((capability) => {
    const sets = [GOOGLE_CAPABILITY_SCOPES[capability], ...(ALTERNATIVES[capability] ?? [])];
    return sets.some((set) => set.every((scope) => granted.has(scope)));
  });
}

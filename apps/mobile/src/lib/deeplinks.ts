/**
 * Deep-link router (M-GL-07) and the screen registry. Every incoming URL — this build's scheme
 * (`dijitalasistan[-dev|-preview|-e2e]://…`), a universal/app link (`https://<web>/app/…`,
 * `/oauth/done`, `/r/{code}`), a notification `deeplink` or an in-app path — is normalised and
 * checked against the `@da/domain` allow-list (`ROUTE_DEFS`), which also validates ids. Links only
 * navigate; they never execute actions.
 *
 * `SCREEN_ROUTES` lists the URL patterns that have a screen in this build. It is data, kept equal
 * to the files under `app/` by `test/route-registry.test.ts`; later tasks add their patterns when
 * they add screens. Controls that would lead to a pattern without a screen are not rendered
 * (R-24), and guards fall back to an existing route.
 */
import {
  DEEP_LINK_SCHEME,
  parseDeepLink,
  routePatternOf,
  type DeepLinkRejection,
} from '@da/domain/deeplinks';

import { getClientEnv, isDemoBuild, webOrigin } from './env';
import { encryptedStorage, isEncryptedStorageOpen } from './storage';

/**
 * URL patterns with a screen in this build (`[param]` files as `:param`). Group segments such as
 * `(tabs)` and `(auth)` do not appear in URLs.
 */
export const SCREEN_ROUTES: readonly string[] = [
  '/',
  '/today',
  '/flow',
  '/plan',
  '/assistant',
  '/sign-in',
  '/email-otp',
  '/update-required',
  '/auth/callback',
  '/integrations/callback',
  '/demo/setup',
];

/** Screens compiled only into demo builds (`metro.config.js` drops their files otherwise). */
export const DEMO_ONLY_ROUTES: readonly string[] = ['/demo/setup'];

/** Where rejected links land: an unmatched path renders `app/+not-found.tsx`. */
export const NOT_FOUND_HREF = '/+not-found';

const ROOT_LINK = new RegExp(`^(?:${DEEP_LINK_SCHEME}:\\/\\/\\/?|\\/)(?:[?#].*)?$`, 'i');

function segments(path: string): string[] {
  return path.split('/').filter((s) => s !== '');
}

function stripQuery(path: string): string {
  const q = path.search(/[?#]/);
  return q === -1 ? path : path.slice(0, q);
}

/** Whether a URL pattern matches a concrete path (`:param` matches one segment). */
export function patternMatches(pattern: string, path: string): boolean {
  const p = segments(pattern);
  const s = segments(stripQuery(path));
  if (p.length !== s.length) return false;
  return p.every((seg, i) => seg.startsWith(':') || seg === s[i]);
}

/** Whether `path` (or a pattern such as `/settings/accounts/:id`) has a screen in this build. */
export function isScreenAvailable(path: string, demo: boolean = isDemoBuild()): boolean {
  return SCREEN_ROUTES.some(
    (pattern) => patternMatches(pattern, path) && (demo || !DEMO_ONLY_ROUTES.includes(pattern)),
  );
}

export type IncomingLink =
  | { readonly kind: 'route'; readonly href: string; readonly pattern: string }
  | { readonly kind: 'referral'; readonly code: string; readonly href: '/' }
  | { readonly kind: 'rejected'; readonly reason: DeepLinkRejection; readonly href: string }
  /** Dev-client launch URLs are left to Expo. */
  | { readonly kind: 'passthrough'; readonly href: string };

export interface ResolveLinkOptions {
  /** This build's scheme (`EXPO_PUBLIC_APP_SCHEME` with its variant suffix). */
  readonly scheme: string;
  readonly webOrigin: string;
  readonly allowDemo: boolean;
}

export function defaultLinkOptions(): ResolveLinkOptions {
  const env = getClientEnv();
  return {
    scheme: env.EXPO_PUBLIC_APP_SCHEME,
    webOrigin: webOrigin(env),
    allowDemo: isDemoBuild(env),
  };
}

function withQuery(path: string, query: Readonly<Record<string, string>>): string {
  const entries = Object.entries(query);
  if (entries.length === 0) return path;
  const search = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${path}?${search}`;
}

/** Normalises and allow-lists one incoming URL or path. */
export function resolveIncomingLink(url: string, options: ResolveLinkOptions): IncomingLink {
  const trimmed = url.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\/expo-development-client/i.test(trimmed)) {
    return { kind: 'passthrough', href: trimmed };
  }
  // Variant builds use `dijitalasistan-dev://` etc.; the allow-list is written for the base scheme.
  const ownPrefix = `${options.scheme}://`;
  const normalised = trimmed.toLowerCase().startsWith(ownPrefix)
    ? `${DEEP_LINK_SCHEME}://${trimmed.slice(ownPrefix.length)}`
    : trimmed;
  // The app root (`dijitalasistan://`, `/`, a query-only launch URL) opens the entry resolver.
  if (ROOT_LINK.test(normalised)) return { kind: 'route', href: '/', pattern: '/' };
  const parsed = parseDeepLink(normalised, {
    webOrigin: options.webOrigin,
    allowDemo: options.allowDemo,
  });
  if (!parsed.ok) return { kind: 'rejected', reason: parsed.reason, href: NOT_FOUND_HREF };
  const { route } = parsed;
  if (route.pattern === '/r/:code') {
    return { kind: 'referral', code: route.params.code ?? '', href: '/' };
  }
  // `/oauth/done` is the web fallback of the integration callback (M-GL-07 rule 3).
  const path = route.pattern === '/oauth/done' ? '/integrations/callback' : route.path;
  return { kind: 'route', href: withQuery(path, route.query), pattern: route.pattern };
}

/** The analytics `route_pattern` of a path (`unknown` outside the allow-list). */
export function analyticsRoutePattern(path: string): string {
  return routePatternOf(stripQuery(path)) ?? 'unknown';
}

// ── Pending link and referral code (replayed after the guards let the user in) ──────────────

const PENDING_LINK_KEY = 'links.pending';
const PENDING_REFERRAL_KEY = 'referral.pending_code';
const memory = new Map<string, string>();

function persist(key: string, value: string | null): void {
  if (value === null) memory.delete(key);
  else memory.set(key, value);
  if (!isEncryptedStorageOpen()) return;
  const prefs = encryptedStorage().prefs;
  if (value === null) prefs.remove(key);
  else prefs.set(key, value);
}

function take(key: string): string | null {
  const stored = isEncryptedStorageOpen() ? encryptedStorage().prefs.getString(key) : undefined;
  const value = memory.get(key) ?? stored ?? null;
  persist(key, null);
  return value;
}

export function resetPendingLinksForTests(): void {
  memory.clear();
}

/** Stores a guard-blocked link (M-GL-07 rule 6); the entry resolver replays it. */
export function savePendingLink(href: string): void {
  persist(PENDING_LINK_KEY, href);
}

export function takePendingLink(): string | null {
  return take(PENDING_LINK_KEY);
}

/** `/r/{code}` before sign-in; applied after sign-in with `POST /referrals/apply` (T-8.22). */
export function savePendingReferralCode(code: string): void {
  persist(PENDING_REFERRAL_KEY, code);
}

export function takePendingReferralCode(): string | null {
  return take(PENDING_REFERRAL_KEY);
}

/** Moves values captured before the encrypted store opened (cold-start links) into it. */
export function flushPendingLinks(): void {
  for (const [key, value] of memory) persist(key, value);
}

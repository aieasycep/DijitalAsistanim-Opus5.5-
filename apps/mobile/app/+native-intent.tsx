/**
 * M-GL-07 deep-link router: every URL the OS hands to the app (scheme, universal/app link, OAuth
 * return, referral) is normalised and allow-listed before Expo Router sees it (`resolveIncomingLink`).
 * - rejected (unknown path, foreign host, bad id, other scheme) → `+not-found`;
 * - `/r/{code}` → the code is kept for `POST /referrals/apply` after sign-in, then `/`;
 * - a route the current guards do not allow yet (signed out, onboarding, session still restoring
 *   on a cold start) → stored and replayed by the entry resolver, then `/`;
 * - otherwise the normalised path (`/oauth/done` → `/integrations/callback`).
 */
import {
  defaultLinkOptions,
  resolveIncomingLink,
  savePendingLink,
  savePendingReferralCode,
} from '../src/lib/deeplinks';
import { widgetOpenFromHref } from '../src/features/widgets/analytics';
import { track } from '../src/lib/events';
import { accessForPattern, guardSnapshot } from '../src/lib/router-guards';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  let link;
  try {
    link = resolveIncomingLink(path, defaultLinkOptions());
  } catch {
    return '/';
  }
  switch (link.kind) {
    case 'passthrough':
      return link.href;
    case 'rejected':
      track('deep_link_opened', { route_pattern: 'unknown', source: 'link', guarded: false });
      return link.href;
    case 'referral':
      savePendingReferralCode(link.code);
      track('deep_link_opened', { route_pattern: '/r/:code', source: 'link', guarded: false });
      return link.href;
    case 'route': {
      const guarded = accessForPattern(link.pattern) === 'app' && !guardSnapshot().app;
      // Widget taps carry `?src=widget&w=<family>` (T-8.25, §11.5).
      const widget = widgetOpenFromHref(link.href, link.pattern);
      track('deep_link_opened', {
        route_pattern: link.pattern,
        source: widget === null ? 'link' : 'widget',
        guarded,
      });
      if (widget !== null) track('widget_opened', widget);
      if (guarded) {
        savePendingLink(link.href);
        return '/';
      }
      return link.href;
    }
  }
}

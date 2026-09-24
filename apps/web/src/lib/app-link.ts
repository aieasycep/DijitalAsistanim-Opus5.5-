/**
 * `/app/[[...path]]` fallback (SCREEN_AND_FLOW_MAP Part 5 W-APP-01). The path is used only to build
 * the "open in app" intent and the QR URL, after validation against the app's deep-link route
 * list; unknown paths map to the app root. The path is never displayed (it may contain entity IDs)
 * and query strings are dropped, except for the OAuth callback, which forwards only the
 * allow-listed parameters of `oauthDoneModel`.
 */

const SEGMENT = /^[a-z0-9\-[\]]{1,80}$/;

/**
 * First segments of routes the mobile app registers (SCREEN_AND_FLOW_MAP §9 route tree). A path
 * whose first segment is not here opens the app root instead.
 */
export const APP_LINK_ROOTS = [
  'today',
  'flow',
  'plan',
  'assistant',
  'briefing',
  'weekly',
  'mail',
  'waiting',
  'followups',
  'commitments',
  'life',
  'event',
  'meeting',
  'person',
  'vip',
  'search',
  'memory',
  'capture',
  'approvals',
  'reminders',
  'settings',
  'paywall',
  'integrations',
] as const;

export const OAUTH_CALLBACK_PATH = 'integrations/callback';

export function normalizeAppLinkPath(segments: readonly string[] | undefined): string {
  if (segments === undefined || segments.length === 0 || segments.length > 6) return '';
  const lowered = segments.map((segment) => {
    try {
      return decodeURIComponent(segment).toLowerCase();
    } catch {
      return '';
    }
  });
  if (!lowered.every((segment) => SEGMENT.test(segment))) return '';
  const [root] = lowered;
  if (root === undefined || !(APP_LINK_ROOTS as readonly string[]).includes(root)) return '';
  const path = lowered.join('/');
  return path.length <= 200 ? path : '';
}

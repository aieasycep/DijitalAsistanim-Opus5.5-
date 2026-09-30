import 'server-only';

/**
 * The time a server render compares timestamps against (probe staleness, model retirement, relative
 * "son kontrol" times). A server component renders once per request, so the value is stable for
 * that render.
 */
export function requestTime(): number {
  return Date.now();
}

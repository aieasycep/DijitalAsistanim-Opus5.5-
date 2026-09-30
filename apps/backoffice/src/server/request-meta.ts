import type { HeaderSource } from './csrf';

/** The client IP as forwarded by Vercel (`x-forwarded-for` first hop), or `unknown`. */
export function clientIp(headers: HeaderSource): string {
  const forwarded = headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first !== undefined && first !== '') return first;
  const real = headers.get('x-real-ip')?.trim();
  return real !== undefined && real !== '' ? real : 'unknown';
}

/** The browser user agent, truncated to the 300 characters `admin_sessions.user_agent` keeps. */
export function userAgent(headers: HeaderSource): string {
  return (headers.get('user-agent') ?? '').slice(0, 300);
}

/**
 * A relative in-app path that is safe to redirect to after sign-in (no scheme, no protocol-relative
 * `//host`, no backslashes); anything else becomes `/dashboard`.
 */
export function safeNextPath(value: string | null | undefined): string {
  if (value === null || value === undefined) return '/dashboard';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/dashboard';
  if (/^\/(login|mfa|invite)(\/|\?|$)/.test(value)) return '/dashboard';
  try {
    const parsed = new URL(value, 'https://admin.invalid');
    if (parsed.origin !== 'https://admin.invalid') return '/dashboard';
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '/dashboard';
  }
}

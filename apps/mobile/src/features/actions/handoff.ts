/**
 * External handoffs (SCREEN_AND_FLOW_MAP Part 3 §0.5, Part 2 M-MAIL-04/05, M-LIFE-01). Only
 * grounded, allow-listed targets leave the app: `https:` pages open in the in-app browser
 * (`expo-web-browser`), `tel:` / `mailto:` / maps go to the OS. URLs are never parsed out of free
 * text here; callers pass the stored provider field (conference URL, web link, tracking URL).
 */
import { isConferencingUrl, parseLink } from '@da/domain';
import * as WebBrowser from 'expo-web-browser';
import { Linking, Platform } from 'react-native';

/** Provider calendar pages ("Takvimde Aç"). */
export const CALENDAR_WEB_HOSTS = [
  'calendar.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com',
] as const;

/** Mail provider pages ("Gmail'de / Outlook'ta Aç"). */
export const MAIL_WEB_HOSTS = [
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com',
] as const;

/** Files ("İlgili dosyalar"). */
export const FILE_HOSTS = [
  'drive.google.com',
  'docs.google.com',
  '*.sharepoint.com',
  'onedrive.live.com',
  '1drv.ms',
] as const;

/** Provider task apps ("Sağlayıcıda Aç"). */
export const TASK_HOSTS = ['tasks.google.com', 'to-do.office.com', 'to-do.live.com'] as const;

/** `https:` URL whose host is on the list (`*.` entries allow one or more sub-labels). */
export function isAllowedHttps(url: string | null | undefined, hosts: readonly string[]): boolean {
  if (url === null || url === undefined || url === '') return false;
  const parsed = parseLink(url);
  if (parsed?.scheme !== 'https:' || parsed.host === null || parsed.hasCredentials) return false;
  const host = parsed.host;
  return hosts.some((allowed) =>
    allowed.startsWith('*.') ? host.endsWith(allowed.slice(1)) : host === allowed,
  );
}

/** Any well-formed `https:` URL without credentials (server-verified tracking links). */
export function isHttpsUrl(url: string | null | undefined): url is string {
  if (url === null || url === undefined || url === '') return false;
  const parsed = parseLink(url);
  return parsed?.scheme === 'https:' && parsed.host !== null && !parsed.hasCredentials;
}

/** Allow-listed conferencing links only (Meet, Teams, Zoom). */
export function isJoinableMeetingUrl(url: string | null | undefined): url is string {
  return url !== null && url !== undefined && url !== '' && isConferencingUrl(url);
}

/** Opens an `https:` page in the in-app browser; false when the URL is not openable. */
export async function openInBrowser(url: string): Promise<boolean> {
  if (!isHttpsUrl(url)) return false;
  try {
    await WebBrowser.openBrowserAsync(url);
    return true;
  } catch {
    return false;
  }
}

/** Hands a URL to the OS (apps, dialer, maps); false when nothing can open it. */
export async function openWithOs(url: string): Promise<boolean> {
  try {
    if (!(await Linking.canOpenURL(url))) return false;
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/** E.164-ish dial string from a grounded phone number, or null. */
export function telUrl(phone: string | null | undefined): string | null {
  if (phone === null || phone === undefined) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  if (!/^\+?\d{7,15}$/.test(digits)) return null;
  return `tel:${digits}`;
}

/** "Haritada Aç" / "Yol Tarifi": Apple Maps on iOS, a `geo:` intent on Android. */
export function mapsUrl(query: string): string {
  const q = encodeURIComponent(query.trim());
  return Platform.OS === 'ios' ? `https://maps.apple.com/?q=${q}` : `geo:0,0?q=${q}`;
}

/**
 * "Gmail'de Aç": the thread in the account's Gmail (unofficial pattern, M-MAIL-04), falling back
 * to the account inbox when the thread id is unknown.
 */
export function gmailUrl(accountEmail: string | null, providerThreadId: string | null): string {
  const authuser = accountEmail === null ? '' : `?authuser=${encodeURIComponent(accountEmail)}`;
  const base = `https://mail.google.com/mail/${authuser}`;
  return providerThreadId === null ? base : `${base}#all/${encodeURIComponent(providerThreadId)}`;
}

/** The provider handoff for one message: Graph `webLink` for Outlook, the Gmail URL otherwise. */
export function mailProviderUrl(input: {
  readonly provider: string;
  readonly webLink: string | null;
  readonly accountEmail: string | null;
  readonly providerThreadId: string | null;
}): string | null {
  if (input.provider === 'microsoft') {
    return isAllowedHttps(input.webLink, MAIL_WEB_HOSTS) ? input.webLink : null;
  }
  if (input.provider === 'google') return gmailUrl(input.accountEmail, input.providerThreadId);
  return null;
}

/** Seconds between the Unix epoch and the Core Data reference date (2001-01-01, iOS `calshow:`). */
const APPLE_REFERENCE_EPOCH_S = 978_307_200;

/**
 * "Takvimde Aç": the provider calendar on the event's day (the event rows store no provider web
 * link). Google / Outlook web day views, the iOS Calendar app (`calshow:`) or the Android calendar
 * (`content://com.android.calendar/time/`); null when there is no calendar to open (demo).
 */
export function calendarDayUrl(
  provider: string,
  startIso: string,
  localDate: string,
): string | null {
  const [y, m, d] = localDate.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return null;
  const ms = Date.parse(startIso);
  switch (provider) {
    case 'google':
      return `https://calendar.google.com/calendar/r/day/${String(y)}/${String(m)}/${String(d)}`;
    case 'microsoft':
      return `https://outlook.office.com/calendar/view/day/${String(y)}/${String(m)}/${String(d)}`;
    case 'apple_device':
      return Platform.OS === 'ios'
        ? `calshow:${String(Math.floor(ms / 1000) - APPLE_REFERENCE_EPOCH_S)}`
        : null;
    case 'android_device':
      return Platform.OS === 'android' ? `content://com.android.calendar/time/${String(ms)}` : null;
    default:
      return null;
  }
}

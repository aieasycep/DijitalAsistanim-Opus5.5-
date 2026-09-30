/**
 * IANA time zones for the M-SET-25 picker: `Intl.supportedValuesOf('timeZone')` where the engine has
 * it, otherwise a bundled list of common zones (Hermes builds without the full ICU list). Labels
 * are the city part of the id with its current GMT offset.
 */
export const FALLBACK_ZONES: readonly string[] = [
  'Europe/Istanbul',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Vienna',
  'Europe/Zurich',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Athens',
  'Europe/Bucharest',
  'Europe/Sofia',
  'Europe/Kyiv',
  'Europe/Moscow',
  'Asia/Nicosia',
  'Asia/Baku',
  'Asia/Tbilisi',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Qatar',
  'Asia/Tehran',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Almaty',
  'Asia/Tashkent',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'America/Sao_Paulo',
  'America/Mexico_City',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'UTC',
];

export function allZones(): readonly string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
  try {
    const list = intl.supportedValuesOf?.('timeZone');
    if (Array.isArray(list) && list.length > 0) return list;
  } catch {
    // Fall through to the bundled list.
  }
  return FALLBACK_ZONES;
}

export function cityOf(zone: string): string {
  return (zone.split('/').at(-1) ?? zone).replace(/_/g, ' ');
}

/** "GMT+03:00" for a zone at `at` (empty when the engine cannot format the zone). */
export function gmtOffset(zone: string, at: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
    const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    const utc = Date.UTC(
      at.getUTCFullYear(),
      at.getUTCMonth(),
      at.getUTCDate(),
      at.getUTCHours(),
      at.getUTCMinutes(),
    );
    const minutes = Math.round((local - utc) / 60_000);
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    return `GMT${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export function zoneLabel(zone: string, at: Date): string {
  const offset = gmtOffset(zone, at);
  return offset === '' ? cityOf(zone) : `${cityOf(zone)} (${offset})`;
}

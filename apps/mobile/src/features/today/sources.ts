/**
 * Source routes of cards and briefing rows (Annex M-TD-01-B last column, M§131): the in-app detail
 * screen of the source when that screen exists in this build (R-24), otherwise nothing — the
 * explain sheet ("Bu nereden çıktı?") is then the card's way to its source.
 */
import { isScreenAvailable } from '../../lib/deeplinks';

export function routeForSource(
  sourceType: string | null | undefined,
  sourceId: string | null | undefined,
): string | null {
  if (sourceId === null || sourceId === undefined || sourceId === '') return null;
  let route: string | null;
  switch (sourceType) {
    case 'email_message':
    case 'email_thread':
      route = `/mail/${sourceId}`;
      break;
    case 'calendar_event':
    case 'device_calendar_event':
      route = `/event/${sourceId}`;
      break;
    case 'commitment':
      route = `/commitments/${sourceId}`;
      break;
    case 'life_event':
      route = `/life/${sourceId}`;
      break;
    case 'capture':
      route = `/capture/${sourceId}`;
      break;
    default:
      route = null;
  }
  return route !== null && isScreenAvailable(route) ? route : null;
}

/** An entity route (`entity_type`/`entity_id` of an insight or briefing item). */
export function routeForEntity(
  entityType: string | null | undefined,
  entityId: string | null | undefined,
): string | null {
  switch (entityType) {
    case 'email_thread':
    case 'email_message':
      return routeForSource('email_message', entityId);
    case 'calendar_event':
      return routeForSource('calendar_event', entityId);
    case 'commitment':
      return routeForSource('commitment', entityId);
    case 'life_event':
      return routeForSource('life_event', entityId);
    default:
      return null;
  }
}

/** `dijitalasistan://mail/<id>` → `/mail/<id>` when that screen exists. */
export function routeForDeepLink(link: string | null | undefined): string | null {
  if (link === null || link === undefined) return null;
  const match = /^[a-z][a-z0-9+.-]*:\/\/(.+)$/.exec(link);
  const path = match === null ? link : `/${match[1] ?? ''}`;
  return path.startsWith('/') && isScreenAvailable(path) ? path : null;
}

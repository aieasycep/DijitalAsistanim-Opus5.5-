/**
 * Result routing (SREQ-41, M-SRCH-01 / M-MEM-01): the server `route` when it has a screen in this
 * build, otherwise the detail screen of the result type or of its source. Null when no screen
 * exists yet (the row is then shown without an action, R-24).
 */
import type { SearchResult } from '@da/validation/api/common';

import { isScreenAvailable } from '../../lib/deeplinks';
import { routeForDeepLink, routeForSource } from '../today/sources';

function available(route: string): string | null {
  return isScreenAvailable(route) ? route : null;
}

export function resultRoute(result: SearchResult): string | null {
  const direct = routeForDeepLink(result.route);
  if (direct !== null) return direct;
  switch (result.type) {
    case 'email':
      return routeForSource('email_message', result.id);
    case 'person':
      return available(`/person/${result.id}`);
    case 'event':
      return routeForSource('calendar_event', result.id);
    case 'task':
      return available('/plan');
    case 'commitment':
      return routeForSource('commitment', result.id);
    case 'life_event':
      return routeForSource('life_event', result.id);
    case 'capture':
      return available(`/capture/${result.id}`);
    case 'memory':
      return (
        routeForDeepLink(result.source.open_route) ??
        routeForSource(result.source.source_type, result.source.source_id)
      );
  }
}

export function rankBucket(rank: number): '1' | '2-3' | '4-10' | '>10' {
  if (rank <= 1) return '1';
  if (rank <= 3) return '2-3';
  return rank <= 10 ? '4-10' : '>10';
}

export function resultsBucket(count: number): '0' | '1_5' | '6_20' | 'gt20' {
  if (count === 0) return '0';
  if (count <= 5) return '1_5';
  return count <= 20 ? '6_20' : 'gt20';
}

const QUESTION_WORDS = ['ne', 'kim', 'nerede', 'ne zaman', 'hangi', 'kaç', 'nasıl', 'neden'];

/** Whether a query reads like a question (ends in "?" or starts with a question word). */
export function looksLikeQuestion(query: string): boolean {
  const value = query.trim().toLocaleLowerCase('tr-TR');
  if (value.endsWith('?')) return true;
  return QUESTION_WORDS.some((word) => value === word || value.startsWith(`${word} `));
}

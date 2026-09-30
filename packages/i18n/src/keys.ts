/**
 * Key builders for catalogs that are addressed by canonical codes rather than by screens.
 * - API errors: `errors.<code_lower>` (API_CONTRACTS §2.6, the envelope's `message_key`).
 * - Push templates: `push.<category>.<template>.<level>.<title|body>` (SCREEN_AND_FLOW_MAP §12.4).
 */

export const NOTIFICATION_DETAIL_LEVELS = ['full', 'title_only', 'generic'] as const;
export type NotificationDetailLevel = (typeof NOTIFICATION_DETAIL_LEVELS)[number];

/** `errorMessageKey('AI_UNAVAILABLE')` → `'errors.ai_unavailable'`. */
export function errorMessageKey<Code extends string>(code: Code): `errors.${Lowercase<Code>}` {
  return `errors.${code.toLowerCase() as Lowercase<Code>}`;
}

/** `pushMessageKey('morning', 'ready', 'title_only', 'body')` → `'push.morning.ready.title_only.body'`. */
export function pushMessageKey<
  Category extends string,
  Template extends string,
  Level extends NotificationDetailLevel,
  Part extends 'title' | 'body',
>(
  category: Category,
  template: Template,
  level: Level,
  part: Part,
): `push.${Category}.${Template}.${Level}.${Part}` {
  return `push.${category}.${template}.${level}.${part}`;
}

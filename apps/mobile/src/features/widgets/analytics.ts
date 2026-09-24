/**
 * `widget_opened {family, target}` (SCREEN_AND_FLOW_MAP §11.5, M-GL-07): every widget URL carries
 * `?src=widget&w=<family>`; the deep-link router reads it after the allow-list accepted the link.
 */
export const WIDGET_FAMILIES = [
  'small',
  'medium',
  'large',
  'inline',
  'circular',
  'rectangular',
  'android_2x2',
  'android_4x2',
] as const;
export type WidgetFamily = (typeof WIDGET_FAMILIES)[number];
export type WidgetTarget =
  'today' | 'briefing' | 'meeting' | 'flow' | 'approvals' | 'capture' | 'assistant';

const TARGET_PREFIXES: readonly (readonly [string, WidgetTarget])[] = [
  ['/briefing', 'briefing'],
  ['/meeting/', 'meeting'],
  ['/event/', 'meeting'],
  ['/plan/conflict/', 'meeting'],
  ['/plan/proposal/', 'approvals'],
  ['/approvals', 'approvals'],
  ['/mail', 'flow'],
  ['/followups', 'flow'],
  ['/waiting', 'flow'],
  ['/commitments', 'flow'],
  ['/life/', 'flow'],
  ['/flow', 'flow'],
  ['/capture', 'capture'],
  ['/assistant', 'assistant'],
  ['/chat/', 'assistant'],
];

/** The analytics target of an allow-listed route pattern (`today` for everything else). */
export function widgetTarget(pattern: string): WidgetTarget {
  return TARGET_PREFIXES.find(([prefix]) => pattern.startsWith(prefix))?.[1] ?? 'today';
}

function queryOf(href: string): Map<string, string> {
  const query = new Map<string, string>();
  const search = href.split('#')[0]?.split('?')[1] ?? '';
  for (const pair of search.split('&')) {
    const [key, value = ''] = pair.split('=');
    if (key === undefined || key === '') continue;
    try {
      query.set(decodeURIComponent(key), decodeURIComponent(value));
    } catch {
      // A malformed pair is ignored.
    }
  }
  return query;
}

/** `{family, target}` when the link came from a widget, else null. */
export function widgetOpenFromHref(
  href: string,
  pattern: string,
): { family: WidgetFamily; target: WidgetTarget } | null {
  const query = queryOf(href);
  if (query.get('src') !== 'widget') return null;
  const family = WIDGET_FAMILIES.find((f) => f === query.get('w'));
  if (family === undefined) return null;
  return { family, target: widgetTarget(pattern) };
}

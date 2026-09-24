import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/*
 * `cn()` as in shadcn, taught the design-token font sizes (`text-bo-*`, `text-h*`, …) so
 * tailwind-merge does not mistake them for colours and drop `text-ink-*` classes.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'bo-page-title',
            'bo-section',
            'bo-body',
            'bo-table',
            'bo-meta',
            'bo-kicker',
            'bo-mono',
            'h1',
            'h2',
            'h3',
            'badge',
            'kicker',
            'label',
            'label-sm',
            'meta',
            'secondary',
          ],
        },
      ],
      'border-color': [
        {
          border: [
            'border-hairline',
            'border-row',
            'border-strong',
            'border-control',
            'border-focus',
            'border-error',
            'border-selected',
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

import type { ReactNode } from 'react';

/**
 * PRIMARY brand-soft `PRO` pill (W-CMP-11): text "PRO" plus a visually hidden "Pro özelliği"
 * so screen readers announce what the pill means.
 */
export function ProTag({ text, label }: { text: string; label: string }): ReactNode {
  return (
    <span className="inline-flex items-center rounded-pill bg-brand-soft px-2 py-0.5 text-badge text-brand-on-soft">
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

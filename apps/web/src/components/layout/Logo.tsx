import type { ReactNode } from 'react';
import { BRAND_NAME } from '@/lib/site.ts';
import { IconAutoAwesome } from '../icons/generated/index.ts';

/** Logo lockup: 32 px indigo tile (radius 10) with the white `auto_awesome` FILL 1 + wordmark. */
export function LogoMark({ size = 32 }: { size?: number }): ReactNode {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-tile bg-primary text-text-on-primary"
      style={{ width: size, height: size }}
    >
      <IconAutoAwesome filled size={Math.round(size * 0.6)} />
    </span>
  );
}

export function LogoLockup(): ReactNode {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      <span className="text-h3 text-ink">{BRAND_NAME}</span>
    </span>
  );
}

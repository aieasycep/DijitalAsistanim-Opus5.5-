import type { SVGProps } from 'react';

import { ICONS, type IconName } from '@/generated/icons';
import { cn } from '@/lib/cn';

export type { IconName };

/**
 * Material Symbols Rounded glyph as DOM SVG (DESIGN_AUDIT §2.12; 20 px in navigation, 16 px
 * inline). Decorative by default (`aria-hidden`); pass `label` for a meaningful standalone icon.
 * Colour is `currentColor`, so the surrounding text token decides it.
 */
export function Icon({
  name,
  filled = false,
  size = 20,
  label,
  className,
  ...rest
}: Omit<SVGProps<SVGSVGElement>, 'name'> & {
  name: IconName;
  filled?: boolean;
  size?: number;
  label?: string;
}) {
  const glyph: { viewBox: string; regular: string; fill?: string } = ICONS[name];
  const path = filled && glyph.fill !== undefined ? glyph.fill : glyph.regular;
  return (
    <svg
      width={size}
      height={size}
      viewBox={glyph.viewBox}
      className={cn('shrink-0 fill-current', className)}
      focusable="false"
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
      {...rest}
    >
      <path d={path} />
    </svg>
  );
}

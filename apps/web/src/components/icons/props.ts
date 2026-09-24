import type { SVGProps } from 'react';

/**
 * Props shared by the generated icon components. Icons are decorative by default
 * (`aria-hidden`); pass `label` when the icon alone carries meaning.
 */
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'fill'> {
  /** Size in CSS pixels (width and height). Defaults to 20. */
  size?: number;
  /** FILL 1 variant (active state, AI marker). */
  filled?: boolean;
  /** Accessible name; when set the icon is exposed as an image. */
  label?: string;
}

export function svgProps({
  size = 20,
  label,
  ...rest
}: Omit<IconProps, 'filled'>): SVGProps<SVGSVGElement> {
  const a11y: SVGProps<SVGSVGElement> =
    label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label };
  return {
    xmlns: 'http://www.w3.org/2000/svg',
    width: size,
    height: size,
    fill: 'currentColor',
    focusable: 'false',
    ...a11y,
    ...rest,
  };
}

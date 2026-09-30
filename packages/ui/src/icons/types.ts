import type { JSX } from 'react';
import type { ColorValue } from 'react-native';
import type { SvgProps } from 'react-native-svg';

/** Props of a generated glyph component (`IconSunny`, …). Prefer `<Icon name=… />`. */
export interface IconGlyphProps extends Omit<
  SvgProps,
  'width' | 'height' | 'viewBox' | 'color' | 'fill'
> {
  /** Rendered width and height in points. */
  readonly size: number;
  readonly color: ColorValue;
  /** FILL 1 variant of the Material Symbol (FILL 0 when false). */
  readonly filled?: boolean;
}

export type IconGlyph = (props: IconGlyphProps) => JSX.Element;

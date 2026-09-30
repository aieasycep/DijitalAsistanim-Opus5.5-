/**
 * Named button shorthands used by the screen maps (SCREEN_AND_FLOW_MAP Part 2 §0.3):
 * `PrimaryButton`, `TonalButton`, `SecondaryButton` (neutral tonal) and `PillButton`
 * (the header pill). They are `Button` / `HeaderPill` with the variant fixed.
 */
import type { JSX } from 'react';
import { HeaderPill, type HeaderPillProps } from './ActionButtons.tsx';
import { Button, type ButtonProps } from './Button.tsx';

export type VariantButtonProps = Omit<ButtonProps, 'variant'>;

export function PrimaryButton(props: VariantButtonProps): JSX.Element {
  return <Button {...props} variant="primary" />;
}

export function TonalButton(props: VariantButtonProps): JSX.Element {
  return <Button {...props} variant="tonal" />;
}

export function SecondaryButton(props: VariantButtonProps): JSX.Element {
  return <Button {...props} variant="neutralTonal" />;
}

export function PillButton(props: HeaderPillProps): JSX.Element {
  return <HeaderPill {...props} />;
}

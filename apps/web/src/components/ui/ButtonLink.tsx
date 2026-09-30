import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'onDark' | 'quiet';

/** Button-styled link classes (44 px minimum target, token colours only). */
export function buttonClasses(variant: ButtonVariant, className?: string): string {
  const base =
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-button px-5 py-2.5 text-label-lg transition-colors duration-(--da-duration-button) ease-standard';
  const variants: Readonly<Record<ButtonVariant, string>> = {
    primary: 'bg-primary text-text-on-primary hover:bg-brand-primary-pressed shadow-cta-primary',
    secondary: 'bg-surface text-ink border border-border-strong hover:bg-surface-pressed',
    onDark: 'bg-on-gradient-fill16 text-text-on-gradient hover:bg-on-gradient-fill25',
    quiet: 'text-text-link hover:underline underline-offset-4',
  };
  return cx(base, variants[variant], className);
}

/** An external or non-localized link styled as a button. */
export function ButtonAnchor({
  variant = 'primary',
  className,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant }): ReactNode {
  return (
    <a className={buttonClasses(variant, className)} {...rest}>
      {children}
    </a>
  );
}

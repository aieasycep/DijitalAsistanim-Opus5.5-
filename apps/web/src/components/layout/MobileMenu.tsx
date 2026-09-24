'use client';

import { useRef, type ReactNode } from 'react';
import { Link } from '@/i18n/navigation.ts';
import { IconClose, IconMenu } from '../icons/generated/index.ts';
import { LocaleSwitch } from './LocaleSwitch.tsx';

export interface MenuItem {
  readonly href: string;
  readonly label: string;
  readonly target: string;
  /** Hidden in the menu when the header already shows it at this width (768–1199). */
  readonly alsoInHeaderFromMd: boolean;
}

/**
 * Header menu below 1200 px (W-CMP-02): a native modal `<dialog>` — it traps focus, closes on
 * `Esc`, and returns focus to the menu button. The first link receives focus when it opens.
 */
export function MobileMenu({
  items,
  labels,
  cta,
}: {
  items: readonly MenuItem[];
  labels: {
    readonly menu: string;
    readonly close: string;
    readonly nav: string;
    readonly localeLabel: string;
    readonly localeAria: string;
  };
  cta: { readonly href: string; readonly label: string };
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const firstLink = useRef<HTMLAnchorElement>(null);

  const open = (): void => {
    dialog.current?.showModal();
    firstLink.current?.focus();
  };
  const close = (): void => {
    dialog.current?.close();
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        className="inline-flex size-11 items-center justify-center rounded-button text-ink hover:bg-surface-sunken xl:hidden"
      >
        <IconMenu size={24} />
        <span className="sr-only">{labels.menu}</span>
      </button>
      <dialog
        ref={dialog}
        aria-label={labels.menu}
        className="m-0 h-dvh w-full max-w-none bg-bg p-0 text-ink backdrop:bg-overlay-scrim md:ml-auto md:w-96"
      >
        <div className="flex h-full flex-col px-5 pt-3 pb-8">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={close}
              className="inline-flex size-11 items-center justify-center rounded-button hover:bg-surface-sunken"
            >
              <IconClose size={24} />
              <span className="sr-only">{labels.close}</span>
            </button>
          </div>
          <nav aria-label={labels.nav} className="mt-4">
            <ul className="flex flex-col gap-1">
              {items.map((item, index) => (
                <li key={item.target} className={item.alsoInHeaderFromMd ? 'md:hidden' : undefined}>
                  <Link
                    ref={index === 0 ? firstLink : undefined}
                    href={item.href}
                    onClick={close}
                    data-ev="web_nav_click"
                    data-target={item.target}
                    className="flex min-h-12 items-center rounded-button px-3 text-title-md hover:bg-surface-sunken"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="mt-auto flex flex-col gap-3">
            <a
              href={cta.href}
              data-ev="web_cta_click"
              data-cta="get_started"
              data-placement="menu"
              className="inline-flex min-h-12 items-center justify-center rounded-button bg-primary px-5 text-label-lg text-text-on-primary"
            >
              {cta.label}
            </a>
            <LocaleSwitch
              label={labels.localeLabel}
              ariaLabel={labels.localeAria}
              className="inline-flex min-h-11 items-center justify-center rounded-button border border-border-strong px-4 text-label"
            />
          </div>
        </div>
      </dialog>
    </>
  );
}

'use client';

import { useId, useRef, type ReactNode } from 'react';
import { IconClose, IconQrCode2 } from '../icons/generated/index.ts';

/**
 * "QR ile indir" (768–1199 px, W-CMP-08): a native modal `<dialog>` that traps focus, closes on
 * `Esc` and returns focus to this button.
 */
export function QrDialog({
  placement,
  labels,
  children,
}: {
  placement: string;
  labels: { readonly button: string; readonly title: string; readonly close: string };
  children: ReactNode;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        aria-haspopup="dialog"
        data-ev="web_qr_shown"
        data-placement={placement}
        className="inline-flex min-h-12 items-center gap-2 rounded-button border border-border-strong bg-surface px-4 text-label-lg text-ink hover:bg-surface-pressed"
      >
        <IconQrCode2 size={22} />
        {labels.button}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto rounded-modal bg-surface p-0 text-ink shadow-modal"
      >
        <div className="flex flex-col items-center gap-4 p-6">
          <div className="flex w-full items-start justify-between gap-4">
            <h2 id={titleId} className="text-title-md">
              {labels.title}
            </h2>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="-mt-2 -mr-2 inline-flex size-11 items-center justify-center rounded-button hover:bg-surface-sunken"
            >
              <IconClose size={22} />
              <span className="sr-only">{labels.close}</span>
            </button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}

'use client';

import { useRef, useState, type ReactNode } from 'react';
import { IconCheck, IconContentCopy } from '../icons/generated/index.ts';

/**
 * Referral code with a copy button (W-CMP-19). The code is also exposed character by character to
 * screen readers; the result of copying is announced through `role="status"`.
 */
export function CodeCard({
  code,
  labels,
}: {
  code: string;
  labels: {
    readonly title: string;
    readonly copy: string;
    readonly copied: string;
    readonly selected: string;
  };
}): ReactNode {
  const codeRef = useRef<HTMLSpanElement>(null);
  const [toast, setToast] = useState<string | null>(null);

  const selectCode = (): void => {
    const node = codeRef.current;
    const selection = window.getSelection();
    if (node === null || selection === null) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setToast(labels.copied);
    } catch {
      selectCode();
      setToast(labels.selected);
    }
    window.setTimeout(() => {
      setToast(null);
    }, 3000);
  };

  return (
    <div className="rounded-card bg-surface p-5 shadow-card">
      <p className="text-label text-ink-2">{labels.title}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
        <span
          ref={codeRef}
          aria-label={code.split('').join(' ')}
          className="font-mono text-[28px] leading-9 font-semibold tracking-[0.12em] text-ink"
          data-testid="referral-code"
        >
          {code}
        </span>
        <button
          type="button"
          onClick={() => {
            void copy();
          }}
          className="inline-flex min-h-11 items-center gap-2 rounded-button border border-border-strong px-4 text-label hover:bg-surface-pressed"
        >
          {toast === labels.copied ? <IconCheck size={18} /> : <IconContentCopy size={18} />}
          {labels.copy}
        </button>
      </div>
      <p role="status" className="mt-3 min-h-6 text-secondary text-ink-2">
        {toast === null ? null : (
          <span className="inline-flex rounded-pill bg-toast-bg px-3 py-1 text-toast-text">
            {toast}
          </span>
        )}
      </p>
    </div>
  );
}

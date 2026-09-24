import type { ReactNode } from 'react';
import { qrSvg } from '@/lib/qr.ts';
import { cx } from '../ui/cx.ts';
import { QrDialog } from './QrDialog.tsx';

/** The QR image itself: server-rendered SVG, ink on white, 168 px (W-CMP-08). */
export function QrImage({
  url,
  alt,
  size = 168,
}: {
  url: string;
  alt: string;
  size?: number;
}): ReactNode {
  const qr = qrSvg(url);
  return (
    // Dark modules on a light field in both colour schemes, so every camera can read it.
    <span className="inline-flex rounded-card-sm bg-control-knob p-2 text-surface-ink">
      <svg
        role="img"
        aria-label={alt}
        width={size}
        height={size}
        viewBox={`0 0 ${String(qr.size)} ${String(qr.size)}`}
        shapeRendering="crispEdges"
        data-qr-url={url}
      >
        <path d={qr.path} fill="currentColor" />
      </svg>
    </span>
  );
}

export function QrCard({
  url,
  alt,
  title,
  sub,
  placement,
  className,
}: {
  url: string;
  alt: string;
  title: string;
  sub: string;
  placement: string;
  className?: string;
}): ReactNode {
  return (
    <div
      data-qr-placement={placement}
      className={cx(
        'flex items-center gap-4 rounded-card bg-surface p-4 text-ink shadow-card',
        className,
      )}
    >
      <QrImage url={url} alt={alt} size={120} />
      <div className="max-w-44">
        <p className="text-label-lg">{title}</p>
        <p className="mt-1 text-secondary text-ink-2">{sub}</p>
      </div>
    </div>
  );
}

/**
 * Desktop download affordance (W-CMP-08): inline QR card at ≥1200 px, a "QR ile indir" dialog at
 * 768–1199 px (inline again without JavaScript), nothing below 768 px where the store buttons
 * are enough.
 */
export function QrDownload({
  url,
  placement,
  labels,
}: {
  url: string;
  placement: string;
  labels: {
    readonly title: string;
    readonly sub: string;
    readonly alt: string;
    readonly button: string;
    readonly close: string;
  };
}): ReactNode {
  const card = (className: string) => (
    <QrCard
      url={url}
      alt={labels.alt}
      title={labels.title}
      sub={labels.sub}
      placement={placement}
      className={className}
    />
  );
  return (
    <>
      {card('hidden xl:flex')}
      <div className="hidden md:block xl:hidden" data-qr-js-only="">
        <QrDialog
          placement={placement}
          labels={{ button: labels.button, title: labels.title, close: labels.close }}
        >
          <QrImage url={url} alt={labels.alt} />
          <p className="max-w-60 text-center text-secondary text-ink-2">{labels.sub}</p>
        </QrDialog>
      </div>
      <noscript>{card('hidden md:flex xl:hidden')}</noscript>
    </>
  );
}

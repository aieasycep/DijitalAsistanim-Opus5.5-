import 'server-only';
import QRCode from 'qrcode';

/**
 * QR code as an SVG path (server-side only; the `qrcode` library never reaches the browser).
 * Error correction M, quiet zone of 2 modules (Part 5 W-CMP-08). The SVG uses `currentColor`, so
 * colours come from design tokens in CSS.
 */
export interface QrSvg {
  readonly size: number;
  readonly path: string;
}

export function qrSvg(text: string, margin = 2): QrSvg {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const { size, data } = qr.modules;
  const parts: string[] = [];
  for (let row = 0; row < size; row++) {
    let col = 0;
    while (col < size) {
      if (data[row * size + col] !== 0) {
        let run = 1;
        while (col + run < size && data[row * size + col + run] !== 0) run++;
        parts.push(
          `M${String(col + margin)} ${String(row + margin)}h${String(run)}v1h-${String(run)}z`,
        );
        col += run;
      } else {
        col++;
      }
    }
  }
  return { size: size + margin * 2, path: parts.join('') };
}

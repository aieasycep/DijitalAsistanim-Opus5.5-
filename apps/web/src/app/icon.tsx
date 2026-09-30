import type { ImageResponse } from 'next/og';
import { renderAppIcon } from '@/lib/app-icon.tsx';

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

/** W-SYS-07 · favicon and manifest icon, drawn from the app icon master. */
export default function Icon(): ImageResponse {
  return renderAppIcon(512);
}

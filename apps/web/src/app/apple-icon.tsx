import type { ImageResponse } from 'next/og';
import { renderAppIcon } from '@/lib/app-icon.tsx';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** W-SYS-07 · apple-touch-icon. */
export default function AppleIcon(): ImageResponse {
  return renderAppIcon(180);
}

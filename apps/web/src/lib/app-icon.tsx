import 'server-only';
import { color, gradient, gradientToCss } from '@da/design-tokens';
import { ImageResponse } from 'next/og';
import { IMAGE_ICON_PATHS } from '@/components/icons/generated/paths.ts';

/**
 * The app icon master (Part 5 MA-ICON-01): `gradient/dawn` with a centred white `auto_awesome`
 * FILL 1 glyph at 54 % of the canvas. Used for the favicon, apple-touch-icon and manifest.
 */
export function renderAppIcon(size: number): ImageResponse {
  const glyph = Math.round(size * 0.54);
  const star = IMAGE_ICON_PATHS.auto_awesome;
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundImage: gradientToCss(gradient.dawn),
      }}
    >
      <svg width={glyph} height={glyph} viewBox={star.viewBox}>
        <path d={star.fill} fill={color.light.text.onGradient} />
      </svg>
    </div>,
    { width: size, height: size },
  );
}

import type { ImageResponse } from 'next/og';
import { ogImageMetadata, renderOgImage, type OgParams } from '@/lib/og.tsx';

/** W-SYS-05 · Open Graph image of the privacy policy. */
export function generateImageMetadata(props: OgParams): ReturnType<typeof ogImageMetadata> {
  return ogImageMetadata('privacy', props);
}

export default async function Image({ params }: OgParams): Promise<ImageResponse> {
  const { locale } = await params;
  return renderOgImage('privacy', locale === 'en' ? 'en' : 'tr');
}

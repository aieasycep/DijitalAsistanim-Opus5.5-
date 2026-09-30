import type { ImageResponse } from 'next/og';
import { ogImageMetadata, renderOgImage, type OgParams } from '@/lib/og.tsx';

/** W-SYS-05 · Open Graph image of the home page. */
export function generateImageMetadata(props: OgParams): ReturnType<typeof ogImageMetadata> {
  return ogImageMetadata('home', props);
}

export default async function Image({ params }: OgParams): Promise<ImageResponse> {
  const { locale } = await params;
  return renderOgImage('home', locale === 'en' ? 'en' : 'tr');
}

import type { ImageResponse } from 'next/og';
import { ogImageMetadata, renderOgImage, type OgParams } from '@/lib/og.tsx';

/** W-SYS-05 · Open Graph image of the support page. */
export function generateImageMetadata(props: OgParams): ReturnType<typeof ogImageMetadata> {
  return ogImageMetadata('support', props);
}

export default async function Image({ params }: OgParams): Promise<ImageResponse> {
  const { locale } = await params;
  return renderOgImage('support', locale === 'en' ? 'en' : 'tr');
}

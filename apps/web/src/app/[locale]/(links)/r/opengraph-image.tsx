import type { ImageResponse } from 'next/og';
import { ogImageMetadata, renderOgImage, type OgParams } from '@/lib/og.tsx';

/** W-SYS-05 · Generic referral card (the invite code is never in the image). */
export function generateImageMetadata(props: OgParams): ReturnType<typeof ogImageMetadata> {
  return ogImageMetadata('referral', props);
}

export default async function Image({ params }: OgParams): Promise<ImageResponse> {
  const { locale } = await params;
  return renderOgImage('referral', locale === 'en' ? 'en' : 'tr');
}

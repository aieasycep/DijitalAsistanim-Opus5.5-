'use client';

import { useLocale } from 'next-intl';
import { useEffect } from 'react';
import type { WebEventName, WebEventProps, WebPage } from '@/lib/web-events/schema.ts';
import { sendWebEvent } from '@/lib/web-events/send.ts';

/** Sends one page-specific, content-free event when the page is shown (PUB-06). */
export function TrackView<E extends WebEventName>({
  event,
  page,
  props,
}: {
  event: E;
  page: WebPage;
  props: WebEventProps<E>;
}): null {
  const locale = useLocale();
  const serialized = JSON.stringify(props);
  useEffect(() => {
    sendWebEvent(event, { page, locale }, JSON.parse(serialized) as WebEventProps<E>);
  }, [event, page, locale, serialized]);
  return null;
}

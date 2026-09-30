import type { ReactNode } from 'react';
import { serializeJsonLd } from '@/lib/json-ld.ts';

/** Structured data block (W-CMP-21). A data block, never executed, so CSP does not apply. */
export function JsonLd({
  data,
}: {
  data: Record<string, unknown> | Record<string, unknown>[];
}): ReactNode {
  return (
    <script
      type="application/ld+json"
      // Serialized from our own typed builders; `<` is escaped so the block cannot be closed.
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}

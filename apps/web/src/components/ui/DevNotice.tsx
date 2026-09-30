import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { IconInfo } from '../icons/generated/index.ts';

/**
 * "Harici kimlik bilgisi gerekli: …" (Part 5 W-HOME-01 error states). Shown only outside
 * production, naming the env keys a public launch still needs; production never renders it.
 */
export async function DevNotice({
  keys,
  production,
}: {
  keys: readonly string[];
  production: boolean;
}): Promise<ReactNode> {
  if (production || keys.length === 0) return null;
  const t = await getTranslations('webPages.common');
  return (
    <p
      role="note"
      className="mt-4 flex items-start gap-2 rounded-card-sm bg-tone-warning-soft px-3 py-2 text-secondary text-tone-warning-text"
    >
      <IconInfo size={18} className="mt-0.5 shrink-0" />
      <span>{t('devNotice', { keys: keys.join(', ') })}</span>
    </p>
  );
}

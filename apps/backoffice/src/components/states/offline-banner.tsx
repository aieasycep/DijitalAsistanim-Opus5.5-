'use client';

import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';

import { Icon } from '@/components/icon';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** "Bağlantı yok. Veriler güncel olmayabilir." while the browser is offline (§5.6). */
export function OfflineBanner() {
  const t = useTranslations('backoffice.states');
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  if (online) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 bg-tone-warning-soft px-4 py-2 text-bo-body text-tone-warning-text"
    >
      <Icon name="wifi_off" size={16} />
      {t('offline')}
    </div>
  );
}

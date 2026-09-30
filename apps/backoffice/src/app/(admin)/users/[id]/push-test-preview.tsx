'use client';

import type { AdminTestPushPreviewResponse } from '@da/validation/admin/briefings';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { z } from 'zod';

type Preview = z.infer<typeof AdminTestPushPreviewResponse>['data'];

/**
 * The push-test dialog's quiet-hours preview (BACKOFFICE_PLAN §6.8, R-13): the user's local time
 * and, inside their quiet hours, "Test bildirimi sessiz saatler bittiğinde ({HH:mm}) gönderilecek."
 * Read through `/api/admin/notifications/test-push/preview` when the dialog opens and whenever the
 * chosen device changes. A test push never bypasses quiet hours; this only says what will happen.
 */
export function PushTestPreview({
  userId,
  installationId,
}: {
  userId: string;
  installationId: string | null;
}) {
  const t = useTranslations('backoffice.userDetail.actions.pushTest');
  const search = new URLSearchParams({ user_id: userId });
  if (installationId !== null) search.set('installation_id', installationId);
  const key = search.toString();
  // The result is keyed by the request, so a device change shows "loading" until its answer.
  const [result, setResult] = useState<
    | { key: string; kind: 'ready'; preview: Preview }
    | { key: string; kind: 'failed' }
    | { key: ''; kind: 'loading' }
  >({ key: '', kind: 'loading' });
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/notifications/test-push/preview?${key}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`preview_${String(response.status)}`);
        const preview = (await response.json()) as Preview;
        if (!cancelled) setResult({ key, kind: 'ready', preview });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, kind: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);
  const state = result.key === key ? result : { kind: 'loading' as const };

  if (state.kind === 'loading') {
    return (
      <p className="text-bo-meta text-ink-3" aria-busy="true">
        {t('previewLoading')}
      </p>
    );
  }
  if (state.kind === 'failed') {
    return <p className="text-bo-meta text-ink-2">{t('previewFailed')}</p>;
  }
  const { preview } = state;
  return (
    <p
      role="status"
      data-testid="push-test-preview"
      className={
        preview.in_quiet_hours
          ? 'rounded-tile bg-tone-warning-soft px-3 py-2 text-bo-body text-tone-warning-text'
          : 'text-bo-body text-ink-2'
      }
    >
      {preview.in_quiet_hours
        ? t('quietHours', {
            time: preview.local_time,
            end: preview.quiet_hours_end_local ?? '—',
          })
        : t('localTime', { time: preview.local_time, zone: preview.timezone })}
    </p>
  );
}

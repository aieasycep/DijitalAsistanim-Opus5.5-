'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * Standard error state (BACKOFFICE_PLAN §5.3 "Error", §5.6): icon, "Veriler yüklenemedi.", the error
 * code, "Hata kimliği: {id}" with a copy button, and [Tekrar dene].
 */
export function ErrorState({
  title,
  code,
  correlationId,
  onRetry,
  refreshOnRetry = false,
  compact = false,
  className,
}: {
  title?: string;
  code?: string | undefined;
  correlationId?: string | undefined;
  onRetry?: () => void;
  /** [Tekrar dene] re-renders the server component (`router.refresh()`), for server-rendered errors. */
  refreshOnRetry?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations('backoffice.states');
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [copied, setCopied] = useState(false);
  const retry =
    onRetry ??
    (refreshOnRetry
      ? () => {
          startRefresh(() => {
            router.refresh();
          });
        }
      : undefined);

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      role="alert"
      data-slot="error-state"
      className={cn(
        'flex flex-col items-center justify-center gap-2 text-center',
        compact ? 'py-4' : 'py-12',
        className,
      )}
    >
      <Icon name="error" size={compact ? 20 : 28} className="text-tone-critical-icon" />
      <p className="text-bo-body font-semibold text-ink">{title ?? t('error')}</p>
      {code === undefined ? null : <p className="font-mono text-bo-mono text-ink-3">{code}</p>}
      {correlationId === undefined ? null : (
        <p className="flex items-center gap-1 text-bo-meta text-ink-3">
          <span>{t('errorId', { correlationId })}</span>
          <Button
            variant="ghost"
            size="iconSm"
            aria-label={t('copyErrorId')}
            onClick={() => {
              void copyId(correlationId);
            }}
          >
            <Icon name={copied ? 'check' : 'content_copy'} size={16} />
          </Button>
          {copied ? (
            <span role="status" className="sr-only">
              {t('copied')}
            </span>
          ) : null}
        </p>
      )}
      {retry === undefined ? null : (
        <Button
          variant="secondary"
          size="sm"
          onClick={retry}
          disabled={refreshing}
          aria-busy={refreshing}
        >
          <Icon name="refresh" size={16} />
          {t('retry')}
        </Button>
      )}
    </div>
  );
}

'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import type { ConfirmEnvelope, ConfirmResult } from '@/components/confirm-dialog';
import { Icon } from '@/components/icon';
import { RevealButton, type RevealPayload } from '@/components/reveal-button';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/*
 * MaskedValue (BACKOFFICE_PLAN §5.5): shows the SQL-masked value (`yu***@gmail.com`); with a reveal
 * configured and the permission held, [Göster] → reason dialog → the real value for its TTL (60 s),
 * then it is dropped from memory and the mask returns.
 */

export interface RevealConfig {
  readonly permission: string;
  readonly reveal: (envelope: ConfirmEnvelope) => Promise<ConfirmResult<RevealPayload>>;
}

export function MaskedValue({
  masked,
  label,
  reveal,
  mono = false,
  className,
}: {
  masked: string;
  /** What the value is ("E-posta"), for accessible names. */
  label: string;
  reveal?: RevealConfig;
  mono?: boolean;
  className?: string;
}) {
  const t = useTranslations('backoffice.pii');
  const [revealed, setRevealed] = useState<{ value: string; until: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (revealed === null) return;
    const tick = setInterval(() => {
      const current = Date.now();
      if (current >= revealed.until) {
        setRevealed(null);
      }
      setNow(current);
    }, 1000);
    return () => {
      clearInterval(tick);
    };
  }, [revealed]);

  const secondsLeft = revealed === null ? 0 : Math.max(0, Math.ceil((revealed.until - now) / 1000));

  return (
    <span data-slot="masked-value" className={cn('inline-flex items-center gap-1', className)}>
      <span
        className={cn('text-bo-table text-ink', mono && 'font-mono')}
        aria-label={revealed === null ? `${label}: ${t('masked')}` : undefined}
      >
        {revealed === null ? masked : revealed.value}
      </span>
      {revealed === null ? (
        reveal === undefined ? null : (
          <RevealButton
            permission={reveal.permission}
            label={label}
            reveal={reveal.reveal}
            onRevealed={(payload) => {
              const at = Date.now();
              setNow(at);
              setRevealed({ value: payload.value, until: at + payload.expires_in_s * 1000 });
            }}
          />
        )
      ) : (
        <>
          <span className="text-bo-meta text-ink-3 tabular-nums" role="status">
            {t('revealedFor', { seconds: secondsLeft })}
          </span>
          <Button
            variant="ghost"
            size="iconSm"
            aria-label={t('hide')}
            onClick={() => {
              setRevealed(null);
            }}
          >
            <Icon name="visibility_off" size={16} />
          </Button>
        </>
      )}
    </span>
  );
}

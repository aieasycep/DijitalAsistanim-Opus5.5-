'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useCan } from '@/components/admin-provider';
import {
  ConfirmDialog,
  type ConfirmEnvelope,
  type ConfirmResult,
} from '@/components/confirm-dialog';
import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';

/*
 * RevealButton (BACKOFFICE_PLAN §5.5): rendered only when the admin holds the reveal permission
 * (cosmetic; admin-api and SQL enforce it), opens an L2 dialog that requires a reason, and hands the
 * revealed value to its parent. The value is kept in memory only: never in a URL, a log, a cache or
 * the palette's recent items.
 */

export interface RevealPayload {
  readonly value: string;
  readonly expires_in_s: number;
}

export function RevealButton({
  permission,
  label,
  reveal,
  onRevealed,
}: {
  /** e.g. `users.pii.reveal`, `ai_feedback.reveal`. */
  permission: string;
  /** What is revealed, for the accessible name ("E-posta"). */
  label: string;
  /** Calls the reveal server action with the dialog envelope. */
  reveal: (envelope: ConfirmEnvelope) => Promise<ConfirmResult<RevealPayload>>;
  onRevealed: (payload: RevealPayload) => void;
}) {
  const t = useTranslations('backoffice.pii');
  const can = useCan();
  const [open, setOpen] = useState(false);
  if (!can(permission)) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="iconSm"
        aria-label={t('revealLabel', { label })}
        onClick={() => {
          setOpen(true);
        }}
      >
        <Icon name="visibility" size={16} />
      </Button>
      <ConfirmDialog<RevealPayload>
        open={open}
        onOpenChange={setOpen}
        title={t('revealTitle')}
        effects={t('revealEffect')}
        confirmLabel={t('reveal')}
        requiresReason
        successMessage={null}
        onConfirm={reveal}
        onSuccess={onRevealed}
      />
    </>
  );
}

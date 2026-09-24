'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { revealAction } from '@/actions/reveal';
import { Icon } from '@/components/icon';
import { MaskedValue } from '@/components/masked-value';
import { Button } from '@/components/ui/button';

/**
 * Header identity (§6.3): the full user id with a copy button and the account email, hidden until
 * an audited reveal (`POST /users/:id/reveal {field:'email'}`, `users.pii.reveal`, reason, 60 s).
 */
export function UserIdentity({ userId }: { userId: string }) {
  const t = useTranslations('backoffice.userDetail');
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-bo-body text-ink-2">
      <span className="flex items-center gap-1">
        <span className="text-bo-meta text-ink-3">{t('userId')}</span>
        <span className="font-mono text-bo-mono text-ink" data-testid="user-id">
          {userId}
        </span>
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={t('copyId')}
          onClick={() => {
            void navigator.clipboard.writeText(userId).then(
              () => {
                setCopied(true);
              },
              () => {
                setCopied(false);
              },
            );
          }}
        >
          <Icon name={copied ? 'check' : 'content_copy'} size={16} />
        </Button>
        {copied ? (
          <span role="status" className="sr-only">
            {t('idCopied')}
          </span>
        ) : null}
      </span>
      <span className="flex items-center gap-1">
        <span className="text-bo-meta text-ink-3">{t('email')}</span>
        <MaskedValue
          masked={t('emailHidden')}
          label={t('email')}
          reveal={{
            permission: 'users.pii.reveal',
            reveal: (envelope) =>
              revealAction(
                { route: 'POST /users/:id/reveal', id: userId, field: 'email' },
                envelope,
              ),
          }}
        />
      </span>
    </div>
  );
}

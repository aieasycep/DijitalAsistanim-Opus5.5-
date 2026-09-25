'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { revealAction } from '@/actions/reveal';
import { Icon } from '@/components/icon';
import { MaskedValue } from '@/components/masked-value';
import { Button } from '@/components/ui/button';

/**
 * Header identity (§6.3, §5.5): the full user id with a copy button, the SQL-masked display name
 * (`Y*** K.`) and account email (`yu***@gmail.com`), each revealed only through its own audited
 * reveal (`POST /users/:id/reveal {field:'display_name'|'email'}`, `users.pii.reveal`, reason, 60 s).
 */
export function UserIdentity({
  userId,
  emailMasked,
  nameMasked,
}: {
  userId: string;
  emailMasked: string | null;
  nameMasked: string | null;
}) {
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
      {nameMasked === null ? null : (
        <span className="flex items-center gap-1" data-testid="user-name">
          <span className="text-bo-meta text-ink-3">{t('name')}</span>
          <MaskedValue
            masked={nameMasked}
            label={t('name')}
            reveal={{
              permission: 'users.pii.reveal',
              reveal: (envelope) =>
                revealAction(
                  { route: 'POST /users/:id/reveal', id: userId, field: 'display_name' },
                  envelope,
                ),
            }}
          />
        </span>
      )}
      <span className="flex items-center gap-1" data-testid="user-email">
        <span className="text-bo-meta text-ink-3">{t('email')}</span>
        <MaskedValue
          masked={emailMasked ?? t('emailHidden')}
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

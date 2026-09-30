'use client';

import type { UserSupportResponse } from '@da/validation/admin/users';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import type { z } from 'zod';

import { ActionButton } from '@/components/action-dialog';
import { SelectField, TextField } from '@/components/form-fields';
import { Icon } from '@/components/icon';
import { useEnumLabel } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { formatCountdown } from '@/lib/format';
import { UUID_PATTERN } from '@/lib/ids';

type Grant = z.infer<typeof UserSupportResponse>['data']['access_grants'][number];
type Scope = Grant['scopes'][number];

/** The entity each Support Access scope reads (BACKOFFICE_PLAN §9). */
export const SCOPE_ENTITY: Readonly<Record<Scope, string>> = {
  pii: 'user',
  email_metadata: 'email_thread',
  insights: 'insight',
  notifications: 'notification',
  captures: 'capture',
  assistant_transcript: 'assistant_thread',
  ai_feedback: 'ai_feedback',
};

/*
 * Support Access banner (BACKOFFICE_PLAN §9, R-09): "Destek erişimi aktif · {mm:ss} kaldı ·
 * Kapsam: …" with [Erişimi sonlandır], shown only for this admin's active grant. Content is read one
 * entity at a time through `GET /support-access/grants/:id/content/:scope` (each view audited as
 * `support_access.content_viewed` and counted); the value is held in memory for 60 s and disappears
 * when the grant expires. Tokens, passwords, original mail bodies and files are never reachable.
 */
export function SupportAccessBanner({ userId, grant }: { userId: string; grant: Grant }) {
  const t = useTranslations('backoffice.supportAccess');
  const label = useEnumLabel();
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [scope, setScope] = useState<Scope>(grant.scopes[0] ?? 'pii');
  const [entityId, setEntityId] = useState(userId);
  const [content, setContent] = useState<{ value: string; until: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const expiresAt = Date.parse(grant.expires_at);
  const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));

  useEffect(() => {
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      setContent((value) => (value !== null && current >= value.until ? null : value));
      if (current >= expiresAt) {
        clearInterval(timer);
        setContent(null);
        router.refresh();
      }
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [expiresAt, router]);

  function view() {
    setError(null);
    if (!UUID_PATTERN.test(entityId.trim())) {
      setError(t('entityInvalid'));
      return;
    }
    const query = new URLSearchParams({
      entity_type: SCOPE_ENTITY[scope],
      entity_id: entityId.trim(),
    });
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/admin/support-access/grants/${grant.id}/content/${scope}?${query.toString()}`,
          { cache: 'no-store', headers: { accept: 'application/json' } },
        );
        if (!response.ok) {
          setError(response.status === 403 ? t('viewForbidden') : t('viewFailed'));
          return;
        }
        const body = (await response.json()) as { value: string; expires_in_s: number };
        setContent({ value: body.value, until: Date.now() + body.expires_in_s * 1000 });
      } catch {
        setError(t('viewFailed'));
      }
    });
  }

  if (remaining === 0) return null;
  return (
    <section
      aria-label={t('bannerLabel')}
      className="flex flex-col gap-3 rounded-card-sm border border-tone-warning-solid bg-tone-warning-soft p-4"
      data-testid="support-access-banner"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-2 text-bo-body text-tone-warning-text">
          <Icon name="shield" size={16} />
          <span className="font-semibold">{t('active')}</span>
          <span className="tabular-nums" role="timer">
            {t('remaining', { time: formatCountdown(remaining) })}
          </span>
          <span>
            {t('scopes', { scopes: grant.scopes.map((s) => label('supportScope', s)).join(', ') })}
          </span>
        </p>
        <ActionButton
          route="POST /support-access/grants/:id/revoke"
          params={{ id: grant.id }}
          label={t('revoke')}
          title={t('revokeTitle')}
          effects={t('revokeEffects')}
          confirmLabel={t('revoke')}
          successMessage={t('revoked')}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-tile bg-surface p-3">
        <SelectField
          label={t('scope')}
          value={scope}
          onChange={(next) => {
            setScope(next);
            setContent(null);
            if (next === 'pii') setEntityId(userId);
          }}
          options={grant.scopes.map((value) => ({ value, label: label('supportScope', value) }))}
        />
        <TextField
          label={t('entity', { type: SCOPE_ENTITY[scope] })}
          value={entityId}
          onChange={setEntityId}
          mono
          className="min-w-72"
          error={error}
        />
        <Button variant="secondary" onClick={view} disabled={pending} aria-busy={pending}>
          <Icon name="visibility" size={16} />
          {t('view')}
        </Button>
      </div>
      {content === null ? null : (
        <div
          className="grid gap-1 rounded-tile bg-surface p-3"
          data-testid="support-access-content"
        >
          <p className="text-bo-meta text-ink-3">
            {t('contentVisible', { seconds: Math.max(0, Math.ceil((content.until - now) / 1000)) })}
          </p>
          <pre className="font-mono text-bo-mono break-words whitespace-pre-wrap text-ink">
            {content.value}
          </pre>
        </div>
      )}
    </section>
  );
}

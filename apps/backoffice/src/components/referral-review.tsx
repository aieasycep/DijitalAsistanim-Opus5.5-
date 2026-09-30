'use client';

import { useTranslations } from 'next-intl';

import { ActionButton } from '@/components/action-dialog';
import { useCan } from '@/components/admin-provider';

/*
 * Referral review (BACKOFFICE_PLAN §6.15; plan §16): a flagged referral can be approved (→ qualified,
 * credits stay idempotent) and a flagged or pending one rejected; both L2 with a reason.
 */
export function ReferralReview({ referralId, status }: { referralId: string; status: string }) {
  const t = useTranslations('backoffice.referrals.review');
  const can = useCan();
  if (!can('referrals.review')) return null;
  const canApprove = status === 'flagged';
  const canReject = status === 'flagged' || status === 'pending';
  if (!canApprove && !canReject) return null;
  return (
    <>
      {canApprove ? (
        <ActionButton
          route="POST /referrals/:id/approve"
          params={{ id: referralId }}
          label={t('approve')}
          variant="ghost"
          title={t('approveTitle')}
          effects={t('approveEffects')}
          confirmLabel={t('approve')}
          successMessage={t('approved')}
          testId={`approve-${referralId}`}
        />
      ) : null}
      {canReject ? (
        <ActionButton
          route="POST /referrals/:id/reject"
          params={{ id: referralId }}
          label={t('reject')}
          variant="ghost"
          tone="destructive"
          title={t('rejectTitle')}
          effects={t('rejectEffects')}
          confirmLabel={t('reject')}
          successMessage={t('rejected')}
          testId={`reject-${referralId}`}
        />
      ) : null}
    </>
  );
}

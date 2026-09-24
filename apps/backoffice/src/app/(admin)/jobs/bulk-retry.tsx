'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { ActionButton } from '@/components/action-dialog';
import { RadioField, SelectField, TextField } from '@/components/form-fields';
import { useEnumLabel } from '@/components/status-badge';
import { BULK_RETRY_TYPED_THRESHOLD } from '@/lib/job-policy';
import { JOB_TYPES_ORDERED } from './config';

/*
 * Bulk retry (BACKOFFICE_PLAN §6.6; `POST /jobs/retry-bulk`): one job type, failed or dead-letter
 * status and a time window, capped at `max` jobs (≤ 500). Up to 10 jobs it is L2; above 10 it is L3
 * with the typed token "TEKRAR DENE".
 */
export function BulkRetryButton() {
  const t = useTranslations('backoffice.jobs.bulk');
  const label = useEnumLabel();
  const [type, setType] = useState<string>('gmail_sync');
  const [status, setStatus] = useState<'dead_letter' | 'failed'>('dead_letter');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [max, setMax] = useState('10');
  const maxNumber = Number(max);
  return (
    <ActionButton
      route="POST /jobs/retry-bulk"
      label={t('button')}
      body={() => ({
        filter: {
          type,
          status,
          from: from === '' ? '' : new Date(from).toISOString(),
          to: to === '' ? '' : new Date(to).toISOString(),
        },
        max: maxNumber,
      })}
      title={t('title')}
      effects={t('effects')}
      {...(maxNumber > BULK_RETRY_TYPED_THRESHOLD ? { typedToken: t('token') } : {})}
      wide
      fields={
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label={t('type')}
            value={type}
            onChange={setType}
            options={JOB_TYPES_ORDERED.map((value) => ({ value, label: label('jobType', value) }))}
          />
          <RadioField
            legend={t('status')}
            value={status}
            onChange={setStatus}
            options={(['dead_letter', 'failed'] as const).map((value) => ({
              value,
              label: label('jobStatus', value),
            }))}
          />
          <TextField label={t('from')} type="datetime-local" value={from} onChange={setFrom} />
          <TextField label={t('to')} type="datetime-local" value={to} onChange={setTo} />
          <TextField
            label={t('max')}
            type="number"
            min={1}
            max={500}
            value={max}
            onChange={setMax}
            help={t('maxHelp')}
          />
        </div>
      }
      validate={() => {
        if (from === '' || to === '') return t('windowRequired');
        if (Date.parse(to) <= Date.parse(from)) return t('windowOrder');
        if (!Number.isInteger(maxNumber) || maxNumber < 1 || maxNumber > 500)
          return t('maxInvalid');
        return null;
      }}
      confirmLabel={t('confirm')}
      successMessage={(data) => t('done', { count: data.retried })}
    />
  );
}

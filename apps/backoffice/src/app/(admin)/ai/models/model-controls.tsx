'use client';

import {
  isForbiddenModel,
  modelConfigViolations,
  type ModelConfigRow,
} from '@da/validation/admin/ai';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { z } from 'zod';

import { ActionButton, ActionDialog } from '@/components/action-dialog';
import { useCan } from '@/components/admin-provider';
import { CheckboxField, RadioField, SelectField, TextField } from '@/components/form-fields';
import { useEnumLabel } from '@/components/status-badge';
import { Button } from '@/components/ui/button';

type Row = z.infer<typeof ModelConfigRow>;
type Profile = 'balanced' | 'lean';
const PROVIDERS = ['anthropic', 'openai', 'voyage', 'fixture', 'native'] as const;
const BATCH = ['realtime', 'micro_batch', 'message_batches'] as const;
const CACHE = ['none', '5m', '1h'] as const;

/*
 * Model config controls (BACKOFFICE_PLAN §6.10): the per-plan routing profile switch (L2), the
 * per-row editor (L2 with a before → after diff) and the fixture probe. The editor refuses, before
 * anything is sent, forbidden model families (R-02) and non-1024-d embedding models (R-01) with
 * the same `@da/validation` helpers admin-api runs; the eval gate is decided by admin-api.
 */

export function RoutingProfileControl({ free, pro }: { free: Profile; pro: Profile }) {
  const t = useTranslations('backoffice.models');
  const can = useCan();
  const [target, setTarget] = useState<{ plan: 'free' | 'pro'; profile: Profile } | null>(null);
  const writable = can('ai.models.write');
  return (
    <div className="flex flex-col gap-3">
      {(['free', 'pro'] as const).map((plan) => {
        const current = plan === 'free' ? free : pro;
        return (
          <div key={plan} className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-bo-body font-semibold text-ink">{t(`plans.${plan}`)}</span>
            <div
              role="group"
              aria-label={t('profileFor', { plan: t(`plans.${plan}`) })}
              className="inline-flex rounded-tile bg-surface-sunken p-1"
            >
              {(['balanced', 'lean'] as const).map((profile) => (
                <Button
                  key={profile}
                  variant={profile === current ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={profile === current}
                  disabled={!writable || profile === current}
                  data-testid={`profile-${plan}-${profile}`}
                  onClick={() => {
                    setTarget({ plan, profile });
                  }}
                >
                  {t(`profiles.${profile}`)}
                </Button>
              ))}
            </div>
          </div>
        );
      })}
      <p className="text-bo-meta text-ink-3">{t('profileCost')}</p>
      <ActionDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        route="PATCH /ai/routing-profile"
        body={() => ({ plan: target?.plan ?? 'pro', profile: target?.profile ?? 'balanced' })}
        title={t('switchTitle')}
        effects={
          target === null
            ? undefined
            : t('switchEffects', {
                plan: t(`plans.${target.plan}`),
                from: t(`profiles.${target.plan === 'free' ? free : pro}`),
                to: t(`profiles.${target.profile}`),
              })
        }
        confirmLabel={t('switch')}
        successMessage={(data) =>
          t('switched', { plan: t(`plans.${data.plan}`), profile: t(`profiles.${data.after}`) })
        }
      />
    </div>
  );
}

export function ModelRowActions({ row }: { row: Row }) {
  const t = useTranslations('backoffice.models');
  const label = useEnumLabel();
  const can = useCan();
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>(row.primary_target.provider);
  const [model, setModel] = useState(row.primary_target.model);
  const [enabled, setEnabled] = useState<'on'[]>(row.enabled ? ['on'] : []);
  const [batch, setBatch] = useState<(typeof BATCH)[number]>(row.batch_policy);
  const [cache, setCache] = useState<(typeof CACHE)[number]>(row.cache_ttl ?? 'none');
  const [maxInput, setMaxInput] = useState(String(row.max_input_tokens));
  if (!can('ai.models.write')) return null;

  const patch = () => {
    const changedTarget =
      provider !== row.primary_target.provider || model.trim() !== row.primary_target.model;
    return {
      ...(changedTarget
        ? {
            primary_target: {
              provider,
              model: model.trim(),
              ...(row.primary_target.effort === undefined
                ? {}
                : { effort: row.primary_target.effort }),
              ...(row.primary_target.max_output_tokens === undefined
                ? {}
                : { max_output_tokens: row.primary_target.max_output_tokens }),
            },
          }
        : {}),
      enabled: enabled.length > 0,
      batch_policy: batch,
      cache_ttl: cache === 'none' ? null : cache,
      max_input_tokens: Number(maxInput),
      expected_version: row.version,
    };
  };

  const validate = () => {
    const next = model.trim();
    if (next === '') return t('modelRequired');
    if (isForbiddenModel(next)) return t('forbiddenModel');
    const tokens = Number(maxInput);
    if (!Number.isInteger(tokens) || tokens < 256 || tokens > 200_000) return t('maxInputInvalid');
    const violations = modelConfigViolations(
      row.feature,
      {
        primary_target: { provider, model: next },
        expected_version: row.version,
        reason: 'x'.repeat(10),
        confirm: true,
      },
      false,
    );
    if (violations.includes('embedding_dimensions')) return t('embedding1024');
    if (violations.includes('model_forbidden')) return t('forbiddenModel');
    return null;
  };

  const before = `${row.primary_target.provider}/${row.primary_target.model}`;
  const after = `${provider}/${model.trim()}`;

  return (
    <div className="inline-flex gap-1">
      <ActionButton
        route="PATCH /ai/models/:profile/:feature"
        params={{ profile: row.profile, feature: row.feature }}
        body={patch}
        label={t('edit')}
        variant="ghost"
        title={t('editTitle', {
          feature: label('aiFeature', row.feature),
          profile: t(`profiles.${row.profile}`),
        })}
        effects={
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-bo-mono">
            <dt className="text-ink-3">{t('before')}</dt>
            <dd>{before}</dd>
            <dt className="text-ink-3">{t('after')}</dt>
            <dd className={before === after ? undefined : 'font-semibold text-on-soft'}>{after}</dd>
          </dl>
        }
        wide
        fields={
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              label={t('provider')}
              value={provider}
              onChange={setProvider}
              options={PROVIDERS.map((value) => ({ value, label: label('modelProvider', value) }))}
            />
            <TextField
              label={t('model')}
              value={model}
              onChange={setModel}
              mono
              help={row.feature.startsWith('embedding') ? t('embeddingHelp') : undefined}
            />
            <SelectField
              label={t('columns.batch')}
              value={batch}
              onChange={setBatch}
              options={BATCH.map((value) => ({ value, label: label('batchPolicy', value) }))}
            />
            <RadioField
              legend={t('columns.cache')}
              value={cache}
              onChange={setCache}
              options={CACHE.map((value) => ({
                value,
                label: value === 'none' ? t('noCache') : value,
              }))}
            />
            <TextField
              label={t('columns.maxInput')}
              type="number"
              min={256}
              max={200000}
              value={maxInput}
              onChange={setMaxInput}
            />
            <CheckboxField
              legend={t('columns.enabled')}
              options={[{ value: 'on', label: t('enabledLabel') }]}
              values={enabled}
              onChange={setEnabled}
            />
          </div>
        }
        validate={validate}
        confirmLabel={t('save')}
        successMessage={t('saved')}
        testId={`edit-${row.profile}-${row.feature}`}
      />
      <ActionButton
        route="POST /ai/models/:profile/:feature/test"
        params={{ profile: row.profile, feature: row.feature }}
        body={{ fixture_set: 'golden' }}
        label={t('test')}
        variant="ghost"
        title={t('testTitle')}
        effects={t('testEffects')}
        confirmLabel={t('test')}
        successMessage={(data) =>
          t('testResult', {
            latency: data.latency_ms,
            schema: data.schema_pass ? t('schemaPass') : t('schemaFail'),
          })
        }
      />
    </div>
  );
}

'use client';

import type { FlagDetailResponse } from '@da/validation/admin/product';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type SubmitEvent } from 'react';
import type { z } from 'zod';

import { ActionButton } from '@/components/action-dialog';
import { useCan } from '@/components/admin-provider';
import { CheckboxField, RadioField, SelectField, TextField } from '@/components/form-fields';
import { useEnumLabel } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { canWriteFlagKey, isAiFlag, targetingSummary } from '@/lib/flags';
import { UUID_PATTERN } from '@/lib/ids';

type Flag = z.infer<typeof FlagDetailResponse>['data'];
type Platform = 'ios' | 'android';
type Plan = 'free' | 'pro';
const SEMVER = /^\d+\.\d+\.\d+$/;
const KEY = /^(feature|ai|voice)\.[a-z0-9_.]{1,70}$/;

/*
 * Flag controls (BACKOFFICE_PLAN §6.17): create (L2, created off), targeting edit (L2 with a before
 * → after summary), kill switch (L3, typed flag key: "Bu özellik tüm kullanıcılar için hemen kapanır;
 * sunucu tarafındaki işlemler de durdurulur."), re-enable (L2), archive (L2, never for kill-switch
 * keys), user overrides (L2) and the evaluation preview.
 */

interface Targeting {
  rollout: string;
  platforms: Platform[];
  plans: Plan[];
  min: string;
  max: string;
}

function useTargeting(initial: Targeting) {
  const [state, setState] = useState(initial);
  return {
    state,
    set: (patch: Partial<Targeting>) => {
      setState((s) => ({ ...s, ...patch }));
    },
  };
}

function validateTargeting(
  state: Targeting,
  t: (key: 'rolloutInvalid' | 'versionInvalid') => string,
): string | null {
  const rollout = Number(state.rollout);
  if (!Number.isInteger(rollout) || rollout < 0 || rollout > 100) return t('rolloutInvalid');
  if (
    (state.min !== '' && !SEMVER.test(state.min)) ||
    (state.max !== '' && !SEMVER.test(state.max))
  ) {
    return t('versionInvalid');
  }
  return null;
}

function TargetingFields({ state, set }: ReturnType<typeof useTargeting>) {
  const t = useTranslations('backoffice.flags.editor');
  const label = useEnumLabel();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TextField
        label={t('rollout')}
        type="number"
        min={0}
        max={100}
        value={state.rollout}
        onChange={(rollout) => {
          set({ rollout });
        }}
        help={t('rolloutHelp')}
      />
      <CheckboxField
        legend={t('platforms')}
        options={(['ios', 'android'] as const).map((value) => ({
          value,
          label: label('platform', value),
        }))}
        values={state.platforms}
        onChange={(platforms) => {
          set({ platforms });
        }}
        help={t('allWhenEmpty')}
      />
      <CheckboxField
        legend={t('plans')}
        options={(['free', 'pro'] as const).map((value) => ({
          value,
          label: label('plan', value),
        }))}
        values={state.plans}
        onChange={(plans) => {
          set({ plans });
        }}
        help={t('allWhenEmpty')}
      />
      <div className="grid gap-3">
        <TextField
          label={t('minVersion')}
          value={state.min}
          onChange={(min) => {
            set({ min });
          }}
          mono
        />
        <TextField
          label={t('maxVersion')}
          value={state.max}
          onChange={(max) => {
            set({ max });
          }}
          mono
        />
      </div>
    </div>
  );
}

function targetingBody(state: Targeting) {
  return {
    rollout_percent: Number(state.rollout),
    platforms: state.platforms,
    plans: state.plans,
    min_version: state.min === '' ? null : state.min,
    max_version: state.max === '' ? null : state.max,
  };
}

export function NewFlagButton() {
  const t = useTranslations('backoffice.flags');
  const can = useCan();
  const router = useRouter();
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const targeting = useTargeting({ rollout: '0', platforms: [], plans: [], min: '', max: '' });
  if (!can('flags.write') && !can('flags.write_ai')) return null;
  return (
    <ActionButton
      route="POST /flags"
      label={t('create')}
      variant="primary"
      size="md"
      body={() => ({
        key: key.trim(),
        description: description.trim(),
        enabled: false,
        ...targetingBody(targeting.state),
      })}
      title={t('createTitle')}
      effects={t('createEffects')}
      wide
      fields={
        <>
          <TextField
            label={t('editor.key')}
            value={key}
            onChange={setKey}
            mono
            help={t('editor.keyHelp')}
          />
          <TextField
            label={t('editor.description')}
            value={description}
            onChange={setDescription}
            maxLength={500}
          />
          <TargetingFields {...targeting} />
        </>
      }
      validate={() => {
        const next = key.trim();
        if (!KEY.test(next)) return t('editor.keyInvalid');
        if (!canWriteFlagKey(can, next)) return t('editor.aiOnly');
        if (description.trim() === '') return t('editor.descriptionRequired');
        return validateTargeting(targeting.state, (k) => t(`editor.${k}`));
      }}
      confirmLabel={t('create')}
      successMessage={t('created')}
      onSuccess={(data) => {
        router.push(`/flags?flag=${encodeURIComponent(data.key)}`);
      }}
      testId="flag-create"
    />
  );
}

export function FlagActions({ flag }: { flag: Flag }) {
  const t = useTranslations('backoffice.flags');
  const can = useCan();
  const targeting = useTargeting({
    rollout: String(flag.rollout_percent),
    platforms: [...flag.platforms],
    plans: [...flag.plans],
    min: flag.min_version ?? '',
    max: flag.max_version ?? '',
  });
  if (!canWriteFlagKey(can, flag.key)) {
    return isAiFlag(flag.key) || can('flags.write_ai') ? (
      <p className="text-bo-meta text-ink-3">{t('readOnly')}</p>
    ) : null;
  }
  const archived = flag.archived_at !== null;
  const before = targetingSummary(flag);
  const after = (() => {
    const body = targetingBody(targeting.state);
    return targetingSummary(body);
  })();
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton
        route="PATCH /flags/:key"
        params={{ key: flag.key }}
        body={() => targetingBody(targeting.state)}
        label={t('editTargeting')}
        disabled={archived}
        disabledReason={t('archivedHint')}
        title={t('editTitle', { key: flag.key })}
        effects={
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-bo-mono">
            <dt className="text-ink-3">{t('before')}</dt>
            <dd>{before}</dd>
            <dt className="text-ink-3">{t('after')}</dt>
            <dd className={before === after ? undefined : 'font-semibold text-on-soft'}>{after}</dd>
          </dl>
        }
        wide
        fields={<TargetingFields {...targeting} />}
        validate={() => validateTargeting(targeting.state, (k) => t(`editor.${k}`))}
        confirmLabel={t('save')}
        successMessage={t('saved')}
        testId="flag-edit"
      />
      {flag.enabled ? (
        <ActionButton
          route="POST /flags/:key/kill"
          params={{ key: flag.key }}
          label={t('kill')}
          variant="destructive"
          tone="destructive"
          typedToken={flag.key}
          title={t('killTitle', { key: flag.key })}
          effects={t('killEffects')}
          confirmLabel={t('kill')}
          successMessage={t('killed')}
          testId="flag-kill"
        />
      ) : (
        <ActionButton
          route="PATCH /flags/:key"
          params={{ key: flag.key }}
          body={{ enabled: true }}
          label={t('enable')}
          disabled={archived}
          disabledReason={t('archivedHint')}
          title={t('enableTitle', { key: flag.key })}
          effects={t('enableEffects')}
          confirmLabel={t('enable')}
          successMessage={t('enabled')}
          testId="flag-enable"
        />
      )}
      {flag.is_kill_switch || archived ? null : (
        <ActionButton
          route="POST /flags/:key/archive"
          params={{ key: flag.key }}
          label={t('archive')}
          variant="ghost"
          title={t('archiveTitle', { key: flag.key })}
          effects={t('archiveEffects')}
          confirmLabel={t('archive')}
          successMessage={t('archivedDone')}
        />
      )}
    </div>
  );
}

export function OverrideControls({
  flagKey,
  overrides,
}: {
  flagKey: string;
  overrides: Flag['overrides'];
}) {
  const t = useTranslations('backoffice.flags');
  const can = useCan();
  const [userId, setUserId] = useState('');
  const [value, setValue] = useState<'on' | 'off'>('on');
  const writable = canWriteFlagKey(can, flagKey);
  return (
    <div className="flex flex-col gap-2">
      {overrides.length === 0 ? (
        <p className="text-bo-body text-ink-2">{t('noOverrides')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {overrides.map((override) => (
            <li
              key={override.user_id}
              className="flex flex-wrap items-center justify-between gap-2 text-bo-table"
            >
              <span className="flex items-center gap-2">
                <span className="font-mono text-ink">
                  {override.email_masked ?? override.user_id.slice(0, 8)}
                </span>
                <span className="text-ink-2">{override.enabled ? t('on') : t('off')}</span>
              </span>
              {writable ? (
                <ActionButton
                  route="DELETE /flags/:key/overrides/:userId"
                  params={{ key: flagKey, userId: override.user_id }}
                  label={t('removeOverride')}
                  variant="ghost"
                  title={t('removeOverrideTitle')}
                  effects={t('removeOverrideEffects')}
                  confirmLabel={t('removeOverride')}
                  successMessage={t('overrideRemoved')}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {writable ? (
        <ActionButton
          route="POST /flags/:key/overrides"
          params={{ key: flagKey }}
          body={() => ({ user_id: userId.trim().toLowerCase(), enabled: value === 'on' })}
          label={t('addOverride')}
          title={t('addOverrideTitle')}
          effects={t('addOverrideEffects')}
          fields={
            <>
              <TextField label={t('overrideUser')} value={userId} onChange={setUserId} mono />
              <RadioField
                legend={t('overrideValue')}
                value={value}
                onChange={setValue}
                options={[
                  { value: 'on', label: t('on') },
                  { value: 'off', label: t('off') },
                ]}
              />
            </>
          }
          validate={() => (UUID_PATTERN.test(userId.trim()) ? null : t('overrideUserInvalid'))}
          confirmLabel={t('addOverride')}
          successMessage={t('overrideAdded')}
        />
      ) : null}
    </div>
  );
}

/** Evaluation preview (`GET /flags/:key/evaluate`) for one user, platform and app version. */
export function EvaluateForm({ flagKey }: { flagKey: string }) {
  const t = useTranslations('backoffice.flags');
  const label = useEnumLabel();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [userId, setUserId] = useState(search.get('eval_user') ?? '');
  const [platform, setPlatform] = useState<string>(search.get('eval_platform') ?? 'any');
  const [version, setVersion] = useState(search.get('eval_version') ?? '');
  const [error, setError] = useState<string | null>(null);
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!UUID_PATTERN.test(userId.trim())) {
      setError(t('overrideUserInvalid'));
      return;
    }
    if (version !== '' && !SEMVER.test(version)) {
      setError(t('editor.versionInvalid'));
      return;
    }
    setError(null);
    const params = new URLSearchParams({ flag: flagKey, eval_user: userId.trim().toLowerCase() });
    if (platform !== 'any') params.set('eval_platform', platform);
    if (version !== '') params.set('eval_version', version);
    router.push(`${pathname}?${params.toString()}`);
  }
  return (
    <form onSubmit={submit} className="grid gap-2 sm:grid-cols-2">
      <TextField
        label={t('overrideUser')}
        value={userId}
        onChange={setUserId}
        mono
        error={error}
        className="sm:col-span-2"
      />
      <SelectField
        label={t('editor.platforms')}
        value={platform}
        onChange={setPlatform}
        options={[
          { value: 'any', label: t('anyPlatform') },
          { value: 'ios', label: label('platform', 'ios') },
          { value: 'android', label: label('platform', 'android') },
        ]}
      />
      <TextField label={t('evalVersion')} value={version} onChange={setVersion} mono />
      <div>
        <Button type="submit" variant="secondary" data-testid="flag-evaluate">
          {t('evaluateButton')}
        </Button>
      </div>
    </form>
  );
}

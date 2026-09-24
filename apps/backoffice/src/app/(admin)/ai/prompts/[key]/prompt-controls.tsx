'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, type SubmitEvent } from 'react';

import { ActionButton } from '@/components/action-dialog';
import { useCan } from '@/components/admin-provider';
import { SelectField, TextAreaField } from '@/components/form-fields';
import { Button } from '@/components/ui/button';
import { promptVariables } from '@/lib/prompt-lint';

/*
 * Prompt version actions (BACKOFFICE_PLAN §6.11): "Yeni taslak" copies this version into a new
 * draft, drafts can be edited, tested on the synthetic golden set, activated (L2; admin-api checks
 * the passing eval report, variables and size) or archived; an archived version can be rolled back
 * to (L2). The variable helper lists the `{{…}}` placeholders the templates use.
 */

export function PromptVersionActions({
  promptKey,
  version,
  status,
  activeVersion,
  templateSystem,
  templateUser,
  outputSchema,
  notes,
}: {
  promptKey: string;
  version: number;
  status: 'draft' | 'active' | 'archived';
  activeVersion: number | null;
  templateSystem: string;
  templateUser: string;
  outputSchema: string;
  notes: string | null;
}) {
  const t = useTranslations('backoffice.prompts.actions');
  const can = useCan();
  const router = useRouter();
  const [system, setSystem] = useState(templateSystem);
  const [user, setUser] = useState(templateUser);
  const [draftNotes, setDraftNotes] = useState(notes ?? '');
  const params = { key: promptKey, v: String(version) };
  const variables = promptVariables(`${system}\n${user}`);
  const editor = (
    <>
      <TextAreaField
        label={t('system')}
        value={system}
        onChange={setSystem}
        rows={8}
        mono
        maxLength={60000}
      />
      <TextAreaField
        label={t('user')}
        value={user}
        onChange={setUser}
        rows={6}
        mono
        maxLength={60000}
      />
      <p className="text-bo-meta text-ink-3">
        {variables.length === 0 ? t('noVariables') : t('variables', { list: variables.join(', ') })}
      </p>
      <TextAreaField
        label={t('notes')}
        value={draftNotes}
        onChange={setDraftNotes}
        rows={2}
        maxLength={2000}
      />
    </>
  );
  const validate = () =>
    system.trim() === '' || user.trim() === '' ? t('templatesRequired') : null;
  return (
    <div className="flex flex-wrap gap-2">
      {can('prompts.write') ? (
        <ActionButton
          route="POST /ai/prompts/:key/versions"
          params={{ key: promptKey }}
          body={() => ({
            template_system: system,
            template_user: user,
            output_schema: outputSchema,
            ...(draftNotes.trim() === '' ? {} : { notes: draftNotes.trim() }),
          })}
          label={t('newDraft')}
          title={t('newDraftTitle', { v: version })}
          effects={t('newDraftEffects')}
          fields={editor}
          validate={validate}
          wide
          confirmLabel={t('createDraft')}
          successMessage={(data) => t('draftCreated', { v: data.version })}
          onSuccess={(data) => {
            router.push(`/ai/prompts/${promptKey}?version=${String(data.version)}`);
          }}
          testId="prompt-new-draft"
        />
      ) : null}
      {can('prompts.write') && status === 'draft' ? (
        <ActionButton
          route="PATCH /ai/prompts/:key/versions/:v"
          params={params}
          body={() => ({
            template_system: system,
            template_user: user,
            notes: draftNotes.trim(),
          })}
          label={t('edit')}
          title={t('editTitle', { v: version })}
          fields={editor}
          validate={validate}
          wide
          confirmLabel={t('save')}
          successMessage={t('saved')}
          testId="prompt-edit"
        />
      ) : null}
      {can('prompts.write') ? (
        <ActionButton
          route="POST /ai/prompts/:key/versions/:v/test"
          params={params}
          body={{ fixture_set: 'golden' }}
          label={t('test')}
          title={t('testTitle')}
          effects={t('testEffects')}
          confirmLabel={t('test')}
          successMessage={(data) =>
            t('testResult', {
              cases: data.cases,
              schema: Math.round(data.schema_pass_rate * 100),
              grounding: Math.round(data.grounding_pass_rate * 100),
            })
          }
        />
      ) : null}
      {can('prompts.activate') && status === 'draft' ? (
        <ActionButton
          route="POST /ai/prompts/:key/versions/:v/activate"
          params={params}
          label={t('activate')}
          variant="primary"
          title={t('activateTitle', { v: version })}
          effects={
            activeVersion === null
              ? t('activateEffectsFirst')
              : t('activateEffects', { from: activeVersion, to: version })
          }
          confirmLabel={t('activate')}
          successMessage={t('activated', { v: version })}
          testId="prompt-activate"
        />
      ) : null}
      {can('prompts.activate') && status === 'archived' ? (
        <ActionButton
          route="POST /ai/prompts/:key/rollback"
          params={{ key: promptKey }}
          body={{ to_version: version }}
          label={t('rollback')}
          title={t('rollbackTitle', { v: version })}
          effects={
            activeVersion === null
              ? t('rollbackEffectsFirst', { v: version })
              : t('rollbackEffects', { from: activeVersion, to: version })
          }
          confirmLabel={t('rollback')}
          successMessage={t('rolledBack', { v: version })}
          testId="prompt-rollback"
        />
      ) : null}
      {can('prompts.activate') && status === 'draft' ? (
        <ActionButton
          route="POST /ai/prompts/:key/versions/:v/archive"
          params={params}
          label={t('archive')}
          variant="ghost"
          title={t('archiveTitle', { v: version })}
          effects={t('archiveEffects')}
          confirmLabel={t('archive')}
          successMessage={t('archived')}
        />
      ) : null}
    </div>
  );
}

/** "Karşılaştır": two versions → `?compare=a..b` (the unified diff from admin-api). */
export function CompareForm({
  promptKey,
  versions,
}: {
  promptKey: string;
  versions: readonly number[];
}) {
  const t = useTranslations('backoffice.prompts');
  const router = useRouter();
  const [from, setFrom] = useState(String(versions[1] ?? versions[0] ?? 1));
  const [to, setTo] = useState(String(versions[0] ?? 1));
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (from === to) return;
    router.push(`/ai/prompts/${promptKey}?compare=${from}..${to}`);
  }
  const options = versions.map((v) => ({ value: String(v), label: t('version', { v }) }));
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <SelectField label={t('compareFrom')} value={from} onChange={setFrom} options={options} />
      <SelectField label={t('compareTo')} value={to} onChange={setTo} options={options} />
      <Button type="submit" variant="secondary" disabled={from === to} data-testid="prompt-compare">
        {t('compare')}
      </Button>
    </form>
  );
}

/**
 * M-APPR-05 typed approval editors (never free text, SREQ-44): the proposed change is edited field
 * by field and validated with the `@da/validation` payload schema before it is sent.
 * - `edit` → `PATCH /approvals/:id {expected_payload_version, payload_patch}` (API-APR-02): a new
 *   payload version and key; the approval stays pending ("Düzenlendi").
 * - `repropose` (a failed approval) → `POST /approvals` with the edited payload (API-APR-01); the
 *   failed approval stays failed and the new one opens in the inline sheet.
 * A 409 version conflict reloads the approval with "Bu onay güncellendi; son hâlini incele."
 */
import { APPROVAL_PAYLOAD_SCHEMAS, type ApprovalPayload } from '@da/validation/api/approvals';
import {
  BottomSheet,
  Button,
  ChipWrap,
  ChoiceChip,
  InlineErrorCard,
  SegmentedControl,
  TextField,
  Text,
} from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { track } from '../../lib/events';
import { getSupabase } from '../../lib/auth/supabase';
import { toDataError } from '../../lib/postgrest';
import { useOnline } from '../../lib/query/online-manager';
import { registerSheet, type SheetRenderProps } from '../../providers/SheetHost';
import { showToast } from '../../providers/ToastHost';
import { ListSkeleton } from '../common/ListSkeleton';
import { DateTimeFields, userTimeZone } from '../common/DateTimeFields';
import { edit, fetchApproval, invalidateApprovals, propose, type ProposeBody } from './api';
import { handleDecisionError } from './decide';
import { APPROVAL_EDITOR_SHEET, type ApprovalEditorParams } from './editor-key';
import { openApprovalSheet } from './ApprovalSheet';
import type { ApprovalModel } from './model';

const DURATIONS = [15, 30, 45, 60, 90] as const;
const MINUTE = 60_000;

interface Loaded {
  readonly model: ApprovalModel;
  readonly payload: ApprovalPayload;
}

async function loadForEdit(id: string): Promise<Loaded | null> {
  const model = await fetchApproval(id);
  if (model === null) return null;
  const { data, error } = (await getSupabase()
    .from('approval_actions')
    .select('payload')
    .eq('id', id)
    .maybeSingle()) as {
    data: { payload?: unknown } | null;
    error: { message?: string; code?: string } | null;
  };
  if (error !== null) throw toDataError(error);
  const schema = APPROVAL_PAYLOAD_SCHEMAS[model.actionType];
  const parsed = schema.safeParse(data?.payload);
  return parsed.success ? { model, payload: parsed.data } : null;
}

interface Draft {
  title: string;
  location: string;
  notes: string;
  start: Date;
  durationMin: number;
  direction: 'user_owes' | 'they_owe';
  hasDue: boolean;
}

function draftOf(payload: ApprovalPayload, fallback: Date): Draft {
  const base: Draft = {
    title: '',
    location: '',
    notes: '',
    start: fallback,
    durationMin: 30,
    direction: 'user_owes',
    hasDue: true,
  };
  switch (payload.action_type) {
    case 'calendar_create': {
      const time = payload.time;
      const start =
        time.kind === 'timed' ? new Date(time.start) : new Date(`${time.start_date}T09:00:00`);
      const end =
        time.kind === 'timed' ? new Date(time.end) : new Date(start.getTime() + 30 * MINUTE);
      return {
        ...base,
        title: payload.title,
        location: payload.location ?? '',
        start,
        durationMin: Math.max(15, Math.round((end.getTime() - start.getTime()) / MINUTE)),
      };
    }
    case 'calendar_update': {
      const time = payload.changes.time;
      if (time?.kind === 'timed') {
        const start = new Date(time.start);
        return {
          ...base,
          start,
          durationMin: Math.max(15, Math.round((Date.parse(time.end) - start.getTime()) / MINUTE)),
        };
      }
      return base;
    }
    case 'task_create':
      return {
        ...base,
        title: payload.title,
        notes: payload.notes ?? '',
        hasDue: payload.due !== undefined,
        start:
          payload.due === undefined
            ? fallback
            : payload.due.kind === 'date'
              ? new Date(`${payload.due.date}T09:00:00`)
              : new Date(payload.due.at),
      };
    case 'reminder_create':
      return { ...base, title: payload.title, start: new Date(payload.fire_at) };
    case 'commitment_create':
      return {
        ...base,
        title: payload.text,
        direction: payload.direction,
        hasDue: payload.due_at !== null,
        start: payload.due_at === null ? fallback : new Date(payload.due_at),
      };
    case 'email_send':
      return base;
  }
}

function localDateOf(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** The payload patch for a draft (only the fields the type's editor owns). */
export function patchOf(
  payload: ApprovalPayload,
  draft: Draft,
  tz: string,
): Record<string, unknown> {
  const end = new Date(draft.start.getTime() + draft.durationMin * MINUTE);
  switch (payload.action_type) {
    case 'calendar_create':
      return {
        title: draft.title.trim(),
        ...(draft.location.trim() === '' ? {} : { location: draft.location.trim() }),
        time: {
          kind: 'timed',
          start: draft.start.toISOString(),
          end: end.toISOString(),
          time_zone: tz,
        },
      };
    case 'calendar_update':
      return {
        changes: {
          time: {
            kind: 'timed',
            start: draft.start.toISOString(),
            end: end.toISOString(),
            time_zone: tz,
          },
        },
      };
    case 'task_create':
      return {
        title: draft.title.trim(),
        ...(draft.notes.trim() === '' ? {} : { notes: draft.notes.trim() }),
        ...(draft.hasDue
          ? {
              due:
                payload.due?.kind === 'date_time'
                  ? { kind: 'date_time', at: draft.start.toISOString(), time_zone: tz }
                  : { kind: 'date', date: localDateOf(draft.start, tz) },
            }
          : {}),
      };
    case 'reminder_create':
      return { title: draft.title.trim(), fire_at: draft.start.toISOString() };
    case 'commitment_create':
      return {
        text: draft.title.trim(),
        direction: draft.direction,
        due_at: draft.hasDue ? draft.start.toISOString() : null,
        due_precision: draft.hasDue ? 'date' : 'none',
      };
    case 'email_send':
      return {};
  }
}

function mergedPayload(payload: ApprovalPayload, patch: Record<string, unknown>) {
  const schema = APPROVAL_PAYLOAD_SCHEMAS[payload.action_type];
  const merged: Record<string, unknown> = { ...payload, ...patch };
  if (payload.action_type === 'calendar_update' && 'changes' in patch) {
    merged.changes = { ...payload.changes, ...(patch.changes as Record<string, unknown>) };
  }
  if (payload.action_type === 'task_create' && !('due' in patch)) delete merged.due;
  return schema.safeParse(merged);
}

function Editor({
  loaded,
  mode,
  onClose,
}: {
  readonly loaded: Loaded;
  readonly mode: ApprovalEditorParams['mode'];
  readonly onClose: () => void;
}) {
  const t = useTranslations('approvals.editor');
  const common = useTranslations('common');
  const online = useOnline();
  const tz = userTimeZone();
  const { model, payload } = loaded;
  const [draft, setDraft] = useState<Draft>(() => draftOf(payload, new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (next: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...next }));
    setError(null);
  };
  const type = payload.action_type;
  const needsTitle = type !== 'calendar_update';

  const save = async () => {
    if (!online) return;
    const patch = patchOf(payload, draft, tz);
    const parsed = mergedPayload(payload, patch);
    if (!parsed.success || (needsTitle && draft.title.trim() === '')) {
      setError(t('invalid'));
      return;
    }
    setSaving(true);
    const fields = Object.keys(patch).length;
    if (mode === 'edit') {
      const result = await edit(model, patch);
      setSaving(false);
      if (!result.ok) {
        if (result.error.kind === 'conflict') setError(t('conflict'));
        else handleDecisionError(model.id, result.error);
        return;
      }
      track('approval_edit', { action_type: type, fields_changed_count: fields });
      showToast({ message: t('saved'), kind: 'success' });
      onClose();
      return;
    }
    const body = {
      payload: parsed.data,
      origin: model.origin,
      origin_ref_id: null,
    } as unknown as ProposeBody;
    const result = await propose(body);
    setSaving(false);
    if (!result.ok) {
      handleDecisionError(model.id, result.error);
      return;
    }
    track('approval_repropose', { action_type: type });
    track('approval_new_proposal', { action_type: type, origin: model.origin });
    invalidateApprovals();
    onClose();
    openApprovalSheet({ approvals: [result.model], mode: 'single', origin: model.origin });
  };

  return (
    <View style={styles.form} testID={`approvalEditor.${type}`}>
      {needsTitle ? (
        <TextField
          label={type === 'commitment_create' ? t('commitment') : t('title')}
          value={draft.title}
          onChangeText={(title) => {
            set({ title });
          }}
          testID="approvalEditor.title"
        />
      ) : null}
      {type === 'commitment_create' ? (
        <SegmentedControl
          options={[
            { key: 'user_owes', label: t('directionMine') },
            { key: 'they_owe', label: t('directionTheirs') },
          ]}
          selectedKey={draft.direction}
          onChange={(key) => {
            set({ direction: key === 'they_owe' ? 'they_owe' : 'user_owes' });
          }}
          accessibilityLabel={t('direction')}
          testID="approvalEditor.direction"
        />
      ) : null}
      {type === 'task_create' || type === 'commitment_create' ? (
        <ChipWrap>
          <ChoiceChip
            label={t('noDue')}
            selected={!draft.hasDue}
            onPress={() => {
              set({ hasDue: !draft.hasDue });
            }}
            testID="approvalEditor.noDue"
          />
        </ChipWrap>
      ) : null}
      {(type !== 'task_create' && type !== 'commitment_create') || draft.hasDue ? (
        <DateTimeFields
          value={draft.start}
          onChange={(start) => {
            set({ start });
          }}
          dateOnly={
            type === 'commitment_create' ||
            (payload.action_type === 'task_create' && payload.due?.kind !== 'date_time')
          }
          testID="approvalEditor.when"
        />
      ) : null}
      {type === 'calendar_create' || type === 'calendar_update' ? (
        <View style={styles.group}>
          <Text variant="labelSm" tone="secondary">
            {t('duration')}
          </Text>
          <ChipWrap>
            {DURATIONS.map((minutes) => (
              <ChoiceChip
                key={minutes}
                label={common('time.minutesShort', { count: minutes })}
                selected={draft.durationMin === minutes}
                onPress={() => {
                  set({ durationMin: minutes });
                }}
                testID={`approvalEditor.duration.${String(minutes)}`}
              />
            ))}
          </ChipWrap>
        </View>
      ) : null}
      {type === 'calendar_create' ? (
        <TextField
          label={t('location')}
          value={draft.location}
          onChangeText={(location) => {
            set({ location });
          }}
          testID="approvalEditor.location"
        />
      ) : null}
      {type === 'task_create' ? (
        <TextField
          label={t('notes')}
          value={draft.notes}
          onChangeText={(notes) => {
            set({ notes });
          }}
          testID="approvalEditor.notes"
        />
      ) : null}
      {error === null ? null : (
        <Text
          variant="bodyXs"
          tone="critical"
          accessibilityRole="alert"
          testID="approvalEditor.error"
        >
          {error}
        </Text>
      )}
      {!online ? (
        <Text variant="meta" tone="warning">
          {t('offline')}
        </Text>
      ) : null}
      <View style={styles.buttons}>
        <Button
          label={mode === 'edit' ? common('actions.save') : common('actions.continue')}
          onPress={() => {
            void save();
          }}
          loading={saving}
          disabled={!online}
          flex
          testID="approvalEditor.save"
        />
        <Button
          label={common('actions.nevermind')}
          variant="neutralTonal"
          onPress={onClose}
          testID="approvalEditor.cancel"
        />
      </View>
    </View>
  );
}

function ApprovalEditorSheet({
  params,
  visible,
  onDismiss,
  onHidden,
}: SheetRenderProps<ApprovalEditorParams>) {
  const t = useTranslations('approvals.editor');
  const common = useTranslations('common');
  const query = useQuery({
    queryKey: ['approvals', params.approvalId, 'editor'],
    queryFn: () => loadForEdit(params.approvalId),
    staleTime: 0,
  });
  let body;
  if (query.isPending) body = <ListSkeleton rows={3} accessibilityLabel={common('a11y.loading')} />;
  else if (query.isError || query.data === null) {
    body = (
      <InlineErrorCard
        icon="error"
        tone="neutral"
        title={t('loadFailed')}
        primaryAction={{
          label: common('actions.retry'),
          onPress: () => {
            void query.refetch();
          },
        }}
        testID="approvalEditor.loadError"
      />
    );
  } else {
    body = <Editor loaded={query.data} mode={params.mode} onClose={onDismiss} />;
  }
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      title={params.mode === 'edit' ? t('sheetTitle') : t('reproposeTitle')}
      testID="sheet.approvalEditor"
    >
      {body}
    </BottomSheet>
  );
}

registerSheet<ApprovalEditorParams>(APPROVAL_EDITOR_SHEET, (props) => (
  <ApprovalEditorSheet {...props} />
));

const styles = StyleSheet.create({
  form: { gap: 14 },
  group: { gap: 8 },
  buttons: { flexDirection: 'row', gap: 8 },
});

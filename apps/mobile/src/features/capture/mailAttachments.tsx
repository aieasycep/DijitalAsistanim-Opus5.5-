/**
 * Mail attachments as capture sources (M-CAP-03 "PDF veya dosya seç", M-MAIL-03 "Eki Ekle'ye
 * gönder"; DESIGN_MAPPING DEV-41, DEV-47):
 * - the sheet lists the latest mails with stored attachment metadata (`email_messages`
 *   `attachment_meta`, read through PostgREST as the user under RLS), flattened to the files the
 *   capture pipeline accepts (PDF or image within the size caps; Outlook item and reference
 *   attachments are never offered);
 * - rows appear only when the `attachments` Data Source Control is on and only for accounts whose
 *   "Ekleri analiz et" toggle is on (SREQ-68);
 * - "Analiz Et" sends the file's fresh API-MAIL-09 ref to `POST /captures` (the server fetches it
 *   from the provider; nothing is downloaded to the device), analyzes it and opens `capture/{id}`.
 * Pro; Free gets the gate, offline the blocked toast.
 */
import { isApiError, qk } from '@da/api-client';
import { useBootstrap } from '@da/api-client/react';
import { formatFileSize } from '@da/i18n';
import { BottomSheet, Button, FileRow, GroupedList, ListRow, Text } from '@da/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';
import { z } from 'zod';

import { getSupabase } from '../../lib/auth/supabase';
import { unwrap } from '../../lib/data/rpc';
import { useFormats } from '../../lib/data/session';
import { track } from '../../lib/events';
import { useOnline } from '../../lib/query/online-manager';
import { registerSheet, sheets, type SheetRenderProps } from '../../providers/SheetHost';
import { showToast } from '../../providers/ToastHost';
import { mountSheet } from '../actions/mount';
import { ListSkeleton } from '../common/ListSkeleton';
import { useAccounts } from '../integrations/accounts';
import { isPro, openProGate } from '../pro-gate/ProGate';
import { AttachmentGoneError, captureMailAttachment, checkFile } from './flows';

/** How many recent mails with attachments the sheet reads (SCREEN_AND_FLOW_MAP M-CAP-03). */
export const RECENT_ATTACHMENT_MAILS = 20;
const MAX_ROWS = 20;

const EXTENSION_MIME: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  heif: 'image/heif',
  webp: 'image/webp',
};

const StoredAttachment = z.looseObject({
  name: z.string(),
  mime: z.string().optional(),
  size: z.number().optional(),
  kind: z.string().optional(),
});

export interface AttachmentRow {
  readonly id: string;
  readonly connected_account_id: string;
  readonly from_name: string | null;
  readonly from_email: string | null;
  readonly received_at: string;
  readonly attachment_meta: unknown;
}

export interface AttachmentCandidate {
  readonly key: string;
  readonly messageId: string;
  /** Position in the mail's stored `attachment_meta` (the API-MAIL-09 listing keeps the order). */
  readonly index: number;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly sender: string | null;
  readonly receivedAt: string;
}

/** The capture MIME of an attachment: its own, or its extension's when the type is generic. */
export function attachmentMime(name: string, mime: string | undefined): string {
  const base = (mime ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (base !== '' && base !== 'application/octet-stream' && base !== 'binary/octet-stream') {
    return base;
  }
  const ext = /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase();
  return (ext === undefined ? undefined : EXTENSION_MIME[ext]) ?? 'application/octet-stream';
}

/** One capture candidate, or null when the pipeline would refuse it (type, size, not a file). */
export function candidateOf(
  row: Pick<AttachmentRow, 'id' | 'from_name' | 'from_email' | 'received_at'>,
  index: number,
  raw: unknown,
): AttachmentCandidate | null {
  const parsed = StoredAttachment.safeParse(raw);
  if (!parsed.success) return null;
  const a = parsed.data;
  if (a.kind !== undefined && a.kind !== 'file') return null;
  const mime = attachmentMime(a.name, a.mime);
  const size = a.size ?? 0;
  if (checkFile({ mime, size }) !== null) return null;
  return {
    key: `${row.id}:${String(index)}`,
    messageId: row.id,
    index,
    name: a.name,
    mime,
    size,
    sender: row.from_name ?? row.from_email,
    receivedAt: row.received_at,
  };
}

/** Recent mails → importable files, newest mail first, at most 20. */
export function attachmentCandidates(rows: readonly AttachmentRow[]): AttachmentCandidate[] {
  const out: AttachmentCandidate[] = [];
  for (const row of rows) {
    const list = Array.isArray(row.attachment_meta) ? (row.attachment_meta as unknown[]) : [];
    for (const [index, raw] of list.entries()) {
      const candidate = candidateOf(row, index, raw);
      if (candidate !== null) out.push(candidate);
    }
  }
  return out.slice(0, MAX_ROWS);
}

/** Accounts whose attachments may go to capture, or null while unknown. */
export function useAttachmentAccounts(): ReadonlySet<string> | null {
  const bootstrap = useBootstrap();
  const accounts = useAccounts();
  if (bootstrap.data === undefined || accounts.data === undefined) return null;
  if (!bootstrap.data.preferences.ai_data_access.attachments) return new Set();
  return new Set(
    accounts.data.accounts
      .filter(
        (a) =>
          a.status !== 'disconnected' &&
          a.data_source_toggles.mail_read &&
          a.data_source_toggles.attachments_analyze,
      )
      .map((a) => a.id),
  );
}

async function fetchAttachmentRows(accountIds: readonly string[]): Promise<AttachmentRow[]> {
  if (accountIds.length === 0) return [];
  const rows = unwrap(
    await getSupabase()
      .from('email_messages')
      .select('id,connected_account_id,from_name,from_email,received_at,attachment_meta')
      .eq('has_attachments', true)
      .is('provider_deleted_at', null)
      .in('connected_account_id', [...accountIds])
      .order('received_at', { ascending: false })
      .limit(RECENT_ATTACHMENT_MAILS),
  );
  return rows;
}

/** The sheet's candidates; disabled (and empty) while the sheet is closed or the user is Free. */
export function useAttachmentCandidates(enabled: boolean) {
  const allowed = useAttachmentAccounts();
  const ids = allowed === null ? [] : [...allowed].sort();
  const query = useQuery({
    queryKey: [...qk.captures.attachments(), ids.join(',')],
    queryFn: () => fetchAttachmentRows(ids),
    select: attachmentCandidates,
    enabled: enabled && allowed !== null && ids.length > 0,
    staleTime: 60_000,
  });
  return { allowed, ids, query };
}

export type AttachmentOrigin = 'composer' | 'mail';

/** "Analiz Et" for one attachment: import → analyze → `capture/{id}`. */
export function useCaptureAttachment(origin: AttachmentOrigin) {
  const t = useTranslations('capture');
  const router = useRouter();
  const online = useOnline();
  const [pending, setPending] = useState<string | null>(null);
  const run = async (candidate: AttachmentCandidate): Promise<boolean> => {
    if (!isPro()) {
      openProGate('capture');
      return false;
    }
    if (!online || pending !== null) return false;
    setPending(candidate.key);
    track('capture_file_pick', {
      origin: 'mail_attachment',
      kind: candidate.mime === 'application/pdf' ? 'pdf' : 'image',
    });
    try {
      const id = await captureMailAttachment(candidate);
      track('capture_created', {
        kind: candidate.mime === 'application/pdf' ? 'pdf' : 'file',
        via: 'in_app',
        file_count: 1,
      });
      if (origin === 'composer') router.replace(`/capture/${id}` as Href);
      else router.push(`/capture/${id}` as Href);
      return true;
    } catch (error) {
      showToast({ message: t(attachmentErrorKey(error), { limit: '20 MB' }), kind: 'error' });
      return false;
    } finally {
      setPending(null);
    }
  };
  return { run, pending, online };
}

export type AttachmentErrorKey =
  | 'errors.attachmentGone'
  | 'errors.attachmentsOff'
  | 'errors.reconnect'
  | 'errors.tooLarge'
  | 'errors.unsupported'
  | 'errors.uploadFailed';

/** The `capture` message of a failed import (`errors.tooLarge` takes `{limit}`). */
export function attachmentErrorKey(error: unknown): AttachmentErrorKey {
  if (error instanceof AttachmentGoneError) return 'errors.attachmentGone';
  if (!isApiError(error)) return 'errors.uploadFailed';
  switch (error.code) {
    case 'SOURCE_GONE':
    case 'NOT_FOUND':
      return 'errors.attachmentGone';
    case 'DATA_SOURCE_DISABLED':
      return 'errors.attachmentsOff';
    case 'PROVIDER_REAUTH_REQUIRED':
      return 'errors.reconnect';
    case 'PAYLOAD_TOO_LARGE':
      return 'errors.tooLarge';
    case 'UNSUPPORTED_MEDIA_TYPE':
      return 'errors.unsupported';
    default:
      return 'errors.uploadFailed';
  }
}

function useMeta() {
  const t = useTranslations('capture');
  const formats = useFormats();
  return (c: AttachmentCandidate) =>
    t('files.mailMeta', {
      size: formatFileSize(c.size, formats.locale),
      sender: c.sender ?? '',
      date: formats.dayMonth(c.receivedAt),
    });
}

/**
 * The mail attachment rows of the file sheet (single selection). Renders nothing when attachments
 * may not be used; a skeleton while loading; the empty line when no recent mail has a file.
 */
export function MailAttachmentRows({
  enabled,
  selectedKey,
  onSelect,
}: {
  readonly enabled: boolean;
  readonly selectedKey: string | null;
  readonly onSelect: (candidate: AttachmentCandidate) => void;
}) {
  const t = useTranslations('capture');
  const meta = useMeta();
  const { allowed, ids, query } = useAttachmentCandidates(enabled);
  if (allowed === null || ids.length === 0) return null;
  if (query.isPending) {
    return (
      <ListSkeleton
        rows={3}
        accessibilityLabel={t('files.mailLoading')}
        testID="capture.files.mailLoading"
      />
    );
  }
  const candidates = query.data ?? [];
  if (candidates.length === 0) {
    return (
      <Text variant="secondary" tone="tertiaryStrong" testID="capture.files.mailEmpty">
        {t('files.mailEmpty')}
      </Text>
    );
  }
  return (
    <View style={{ gap: 4 }} testID="capture.files.mail">
      {candidates.map((c) => (
        <FileRow
          key={c.key}
          name={c.name}
          meta={meta(c)}
          icon={c.mime === 'application/pdf' ? 'picture_as_pdf' : 'attach_file'}
          selected={selectedKey === c.key}
          onPress={() => {
            onSelect(c);
          }}
          testID={`capture.files.mail.${c.key}`}
        />
      ))}
    </View>
  );
}

interface MailAttachmentSheetParams {
  readonly candidate: AttachmentCandidate;
}

function MailAttachmentSheet({
  params,
  visible,
  onDismiss,
  onHidden,
}: SheetRenderProps<MailAttachmentSheetParams>) {
  const t = useTranslations('capture');
  const common = useTranslations('common');
  const meta = useMeta();
  const capture = useCaptureAttachment('mail');
  const busy = capture.pending !== null;
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onHidden={onHidden}
      title={t('mailSheet.title')}
      dismissible={!busy}
      footer={
        <View style={{ gap: 8 }}>
          {capture.online ? null : (
            <Text variant="meta" tone="warning" testID="capture.mailSheet.offline">
              {t('offline')}
            </Text>
          )}
          <Button
            label={t('analyze')}
            onPress={() => {
              void capture.run(params.candidate).then((done) => {
                if (done) onDismiss();
              });
            }}
            loading={busy}
            disabled={!capture.online}
            fullWidth
            testID="capture.mailSheet.analyze"
          />
          <Button
            label={common('actions.nevermind')}
            variant="text"
            onPress={onDismiss}
            fullWidth
          />
        </View>
      }
      testID="capture.mailSheet"
    >
      <GroupedList>
        <ListRow
          title={params.candidate.name}
          subtitle={meta(params.candidate)}
          icon={params.candidate.mime === 'application/pdf' ? 'picture_as_pdf' : 'attach_file'}
          testID="capture.mailSheet.file"
        />
      </GroupedList>
      <Text variant="secondary" tone="secondary">
        {t('mailSheet.body', { name: params.candidate.name })}
      </Text>
    </BottomSheet>
  );
}

registerSheet('capture.mailAttachment', mountSheet(MailAttachmentSheet));

/** M-MAIL-03 "Eki Ekle'ye gönder": the confirm sheet with "Analiz Et" (Pro; Free → the gate). */
export function openMailAttachmentCapture(candidate: AttachmentCandidate): void {
  if (!isPro()) {
    openProGate('capture');
    return;
  }
  sheets.open('capture.mailAttachment', { candidate } satisfies MailAttachmentSheetParams);
}

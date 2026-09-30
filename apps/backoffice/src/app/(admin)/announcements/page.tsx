import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';

import { firstValue, loadTableState, toAdminListQuery } from '@/components/data-table/url-state';
import { Panel, ReadError, withParam } from '@/components/module-kit';
import { PageHeader } from '@/components/page-header';
import { LoadingState } from '@/components/states/loading-state';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { UUID_PATTERN } from '@/lib/ids';
import { toTableData } from '@/lib/read-result';
import { readAdmin } from '@/server/read';
import { loadAdminContext } from '@/server/session';
import { AnnouncementEditor } from './announcement-editor';
import { AnnouncementsTable } from './announcements-table';

/*
 * Duyurular (BACKOFFICE_PLAN §6.18; M§64; R-25; T-10.12): bilingual announcements (tr + en required)
 * with audience, platforms, version range, an allow-listed in-app CTA route and a start/end window
 * of at most 30 days. `?new=1` / `?id=<id>` opens the editor with the phone preview (tr/en ×
 * light/dark) and, for saved drafts, the app's own preview and the audience estimate; schedule and
 * cancel are L2 with a reason. Plain text only.
 */

const FILTERS = ['status'] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('backoffice.announcements');
  return { title: t('title') };
}

export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [t, params, context] = await Promise.all([
    getTranslations('backoffice.announcements'),
    searchParams,
    loadAdminContext(),
  ]);
  const state = loadTableState(params, FILTERS);
  const id = typeof params.id === 'string' && UUID_PATTERN.test(params.id) ? params.id : null;
  const creating = params.new === '1' && id === null;
  const writable = context.permissions.includes('announcements.write');
  const result = await readAdmin('GET /announcements', {
    query: toAdminListQuery(state, {
      sortable: ['starts_at'],
      filterKeys: FILTERS,
      transform: { status: firstValue },
    }),
  });
  const closeHref = withParam('/announcements', params, { id: null, new: null });
  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          writable && !creating ? (
            <Link
              href={withParam('/announcements', params, { new: '1', id: null })}
              className={buttonVariants({ size: 'md' })}
            >
              {t('new')}
            </Link>
          ) : undefined
        }
      />
      {creating && writable ? (
        <Panel
          title={t('newTitle')}
          className="border border-dashed border-border-strong"
          testId="announcement-editor"
        >
          <AnnouncementEditor closeHref={closeHref} />
        </Panel>
      ) : null}
      {id === null ? null : (
        <Suspense key={id} fallback={<LoadingState rows={8} />}>
          <ExistingAnnouncement id={id} closeHref={closeHref} writable={writable} />
        </Suspense>
      )}
      <AnnouncementsTable data={toTableData(result)} {...(id === null ? {} : { selectedId: id })} />
    </>
  );
}

async function ExistingAnnouncement({
  id,
  closeHref,
  writable,
}: {
  id: string;
  closeHref: string;
  writable: boolean;
}) {
  const t = await getTranslations('backoffice.announcements');
  const detail = await readAdmin('GET /announcements/:id', { params: { id } });
  if (!detail.ok) {
    return (
      <Card>
        <ReadError error={detail.error} backHref="/announcements" />
      </Card>
    );
  }
  const a = detail.data;
  const editable = a.status === 'draft' || a.status === 'scheduled';
  // The app's own card model and the reach, computed by admin-api for this saved announcement.
  const [previewTr, previewEn, estimate] = await Promise.all([
    readAdmin('POST /announcements/:id/preview', {
      params: { id },
      body: { locale: 'tr', platform: a.platforms[0] ?? 'ios' },
    }),
    readAdmin('POST /announcements/:id/preview', {
      params: { id },
      body: { locale: 'en', platform: a.platforms[0] ?? 'ios' },
    }),
    readAdmin('POST /announcements/audience-estimate', {
      body: {
        audience: a.audience,
        platforms: a.platforms,
        ...(a.min_version === null ? {} : { min_version: a.min_version }),
        ...(a.max_version === null ? {} : { max_version: a.max_version }),
      },
    }),
  ]);
  return (
    <Panel
      title={a.title_tr}
      testId="announcement-editor"
      className={
        a.status === 'draft' || a.status === 'scheduled'
          ? 'border border-dashed border-border-strong'
          : undefined
      }
    >
      <AnnouncementEditor
        closeHref={closeHref}
        existing={{
          id: a.id,
          status: a.status,
          title_tr: a.title_tr,
          title_en: a.title_en,
          body_tr: a.body_tr,
          body_en: a.body_en,
          audience: a.audience,
          platforms: a.platforms,
          min_version: a.min_version,
          max_version: a.max_version,
          cta_route: a.cta_route,
          starts_at: a.starts_at,
          ends_at: a.ends_at,
          dismissal_count: a.dismissal_count,
          created_by: a.created_by,
        }}
        readOnly={!writable || !editable}
        appPreview={
          previewTr.ok && previewEn.ok
            ? {
                tr: { title: previewTr.data.title, body: previewTr.data.body },
                en: { title: previewEn.data.title, body: previewEn.data.body },
              }
            : null
        }
        estimate={estimate.ok ? estimate.data.estimated_users : null}
      />
      {previewTr.ok && previewEn.ok ? null : (
        <p className="text-bo-meta text-ink-3">{t('appPreviewFailed')}</p>
      )}
    </Panel>
  );
}

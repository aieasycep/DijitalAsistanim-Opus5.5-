'use client';

import { routePatternOf } from '@da/domain/deeplinks';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { ActionButton, useInlineMutation } from '@/components/action-dialog';
import { CheckboxField, RadioField, TextAreaField, TextField } from '@/components/form-fields';
import { StatusBadge, useEnumLabel } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { themeVars } from '@/lib/theme-vars';
import { useFormatters } from '@/lib/use-formatters';

/*
 * Announcement editor (BACKOFFICE_PLAN §6.18; M§64): both locales are required (title ≤ 80, body ≤
 * 280), the audience and at least one platform, an optional version range, an optional CTA that must
 * be an allow-listed app route, and a window of at most 30 days. The phone frames show the Today
 * card in tr and en, light and dark, from the form. Saving a draft is L1; schedule and cancel are L2.
 */

type Status = 'draft' | 'scheduled' | 'live' | 'ended' | 'cancelled';
type Audience = 'all' | 'free' | 'pro';
type Platform = 'ios' | 'android';
const SEMVER = /^\d+\.\d+\.\d+$/;
const MAX_WINDOW_MS = 30 * 86_400_000;

export interface ExistingAnnouncement {
  readonly id: string;
  readonly status: Status;
  readonly title_tr: string;
  readonly title_en: string;
  readonly body_tr: string;
  readonly body_en: string;
  readonly audience: Audience;
  readonly platforms: readonly Platform[];
  readonly min_version: string | null;
  readonly max_version: string | null;
  readonly cta_route: string | null;
  readonly starts_at: string;
  readonly ends_at: string | null;
  readonly dismissal_count: number;
  readonly created_by: string | null;
}

/** `datetime-local` value (local time) ↔ ISO instant. */
function toLocalInput(iso: string | null): string {
  if (iso === null) return '';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function AnnouncementEditor({
  existing,
  closeHref,
  readOnly = false,
  appPreview = null,
  estimate = null,
}: {
  existing?: ExistingAnnouncement;
  closeHref: string;
  readOnly?: boolean;
  appPreview?: { tr: { title: string; body: string }; en: { title: string; body: string } } | null;
  estimate?: number | null;
}) {
  const t = useTranslations('backoffice.announcements');
  const label = useEnumLabel();
  const f = useFormatters();
  const router = useRouter();
  const { run, pending } = useInlineMutation();
  const [form, setForm] = useState(() => ({
    title_tr: existing?.title_tr ?? '',
    title_en: existing?.title_en ?? '',
    body_tr: existing?.body_tr ?? '',
    body_en: existing?.body_en ?? '',
    audience: existing?.audience ?? 'all',
    platforms: [...(existing?.platforms ?? (['ios', 'android'] as Platform[]))],
    min_version: existing?.min_version ?? '',
    max_version: existing?.max_version ?? '',
    cta_route: existing?.cta_route ?? '',
    starts_at: toLocalInput(existing?.starts_at ?? null),
    ends_at: toLocalInput(existing?.ends_at ?? null),
  }));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  function validate(): string | null {
    if ([form.title_tr, form.title_en, form.body_tr, form.body_en].some((v) => v.trim() === ''))
      return t('errors.bothLocales');
    if (form.title_tr.length > 80 || form.title_en.length > 80) return t('errors.titleLength');
    if (form.body_tr.length > 280 || form.body_en.length > 280) return t('errors.bodyLength');
    if (form.platforms.length === 0) return t('errors.platform');
    if (
      (form.min_version !== '' && !SEMVER.test(form.min_version)) ||
      (form.max_version !== '' && !SEMVER.test(form.max_version))
    ) {
      return t('errors.version');
    }
    if (form.cta_route !== '' && routePatternOf(form.cta_route) === null) return t('errors.cta');
    if (form.starts_at === '') return t('errors.start');
    if (form.ends_at !== '') {
      const start = Date.parse(form.starts_at);
      const end = Date.parse(form.ends_at);
      if (end <= start) return t('errors.endBeforeStart');
      if (end - start > MAX_WINDOW_MS) return t('errors.window');
    }
    return null;
  }

  function body(): Record<string, unknown> {
    return {
      title_tr: form.title_tr.trim(),
      title_en: form.title_en.trim(),
      body_tr: form.body_tr.trim(),
      body_en: form.body_en.trim(),
      audience: form.audience,
      platforms: form.platforms,
      ...(form.min_version === '' ? {} : { min_version: form.min_version }),
      ...(form.max_version === '' ? {} : { max_version: form.max_version }),
      ...(form.cta_route === '' ? {} : { cta_route: form.cta_route }),
      starts_at: new Date(form.starts_at).toISOString(),
      ...(form.ends_at === '' ? {} : { ends_at: new Date(form.ends_at).toISOString() }),
    };
  }

  function save() {
    const problem = validate();
    setError(problem);
    if (problem !== null) return;
    if (existing === undefined) {
      run('POST /announcements', {}, body(), {
        successMessage: t('draftSaved'),
        onSuccess: (data) => {
          router.push(`/announcements?id=${data.id}`);
        },
      });
    } else {
      run('PATCH /announcements/:id', { id: existing.id }, body(), {
        successMessage: t('draftSaved'),
      });
    }
  }

  const disabled = readOnly || pending;
  return (
    <div className="flex flex-col gap-4">
      {existing === undefined ? null : (
        <p className="flex flex-wrap items-center gap-2 text-bo-meta text-ink-3">
          <StatusBadge group="announcementStatus" value={existing.status} />
          <span>{t('dismissals', { count: existing.dismissal_count })}</span>
          <span>{existing.created_by ?? '—'}</span>
          {estimate === null ? null : (
            <span data-testid="audience-estimate">{t('estimate', { count: estimate })}</span>
          )}
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[3fr_2fr]">
        <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
          <TextField
            label={t('fields.titleTr')}
            value={form.title_tr}
            onChange={(v) => {
              set({ title_tr: v });
            }}
            maxLength={80}
          />
          <TextField
            label={t('fields.titleEn')}
            value={form.title_en}
            onChange={(v) => {
              set({ title_en: v });
            }}
            maxLength={80}
          />
          <TextAreaField
            label={t('fields.bodyTr')}
            value={form.body_tr}
            onChange={(v) => {
              set({ body_tr: v });
            }}
            maxLength={280}
            rows={3}
          />
          <TextAreaField
            label={t('fields.bodyEn')}
            value={form.body_en}
            onChange={(v) => {
              set({ body_en: v });
            }}
            maxLength={280}
            rows={3}
          />
          <RadioField
            legend={t('fields.audience')}
            value={form.audience}
            onChange={(v) => {
              set({ audience: v });
            }}
            options={(['all', 'free', 'pro'] as const).map((value) => ({
              value,
              label: label('audience', value),
            }))}
          />
          <CheckboxField
            legend={t('fields.platforms')}
            values={form.platforms}
            onChange={(v) => {
              set({ platforms: v });
            }}
            options={(['ios', 'android'] as const).map((value) => ({
              value,
              label: label('platform', value),
            }))}
          />
          <TextField
            label={t('fields.minVersion')}
            value={form.min_version}
            onChange={(v) => {
              set({ min_version: v });
            }}
            mono
          />
          <TextField
            label={t('fields.maxVersion')}
            value={form.max_version}
            onChange={(v) => {
              set({ max_version: v });
            }}
            mono
          />
          <TextField
            label={t('fields.cta')}
            value={form.cta_route}
            onChange={(v) => {
              set({ cta_route: v });
            }}
            mono
            help={t('fields.ctaHelp')}
            className="sm:col-span-2"
          />
          <TextField
            label={t('fields.startsAt')}
            type="datetime-local"
            value={form.starts_at}
            onChange={(v) => {
              set({ starts_at: v });
            }}
          />
          <TextField
            label={t('fields.endsAt')}
            type="datetime-local"
            value={form.ends_at}
            onChange={(v) => {
              set({ ends_at: v });
            }}
            help={t('fields.endsHelp')}
          />
        </fieldset>
        <div className="flex flex-col gap-3" aria-label={t('preview')}>
          <p className="text-bo-kicker text-ink-3 uppercase">{t('preview')}</p>
          <div className="grid grid-cols-2 gap-3">
            {(['light', 'dark'] as const).map((scheme) =>
              (['tr', 'en'] as const).map((locale) => (
                <PhoneCard
                  key={`${scheme}-${locale}`}
                  scheme={scheme}
                  caption={t('previewCaption', {
                    locale: locale.toUpperCase(),
                    theme: t(`themes.${scheme}`),
                  })}
                  title={locale === 'tr' ? form.title_tr : form.title_en}
                  body={locale === 'tr' ? form.body_tr : form.body_en}
                  cta={form.cta_route === '' ? null : t(`ctaLabel.${locale}`)}
                />
              )),
            )}
          </div>
          {appPreview === null ? null : (
            <div
              className="grid gap-1 rounded-tile bg-surface-sunken p-3 text-bo-meta"
              data-testid="app-preview"
            >
              <p className="font-semibold text-ink">{t('appPreview')}</p>
              <p className="text-ink">{appPreview.tr.title}</p>
              <p className="text-ink-2">{appPreview.tr.body}</p>
              <p className="text-ink">{appPreview.en.title}</p>
              <p className="text-ink-2">{appPreview.en.body}</p>
            </div>
          )}
        </div>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-bo-body text-tone-critical-text">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {readOnly ? null : (
          <Button
            onClick={save}
            disabled={pending}
            aria-busy={pending}
            data-testid="announcement-save"
          >
            {t('saveDraft')}
          </Button>
        )}
        {existing?.status === 'draft' && !readOnly ? (
          <ActionButton
            route="POST /announcements/:id/schedule"
            params={{ id: existing.id }}
            label={t('schedule')}
            size="md"
            title={t('scheduleTitle')}
            effects={
              <div className="grid gap-1">
                <p>
                  {t('scheduleEffects', {
                    start: f.dateTime(existing.starts_at),
                    end: f.dateTime(existing.ends_at),
                  })}
                </p>
                {estimate === null ? null : <p>{t('estimate', { count: estimate })}</p>}
              </div>
            }
            confirmLabel={t('schedule')}
            successMessage={t('scheduled')}
            testId="announcement-schedule"
          />
        ) : null}
        {existing !== undefined &&
        (existing.status === 'scheduled' || existing.status === 'live') &&
        !readOnly ? (
          <ActionButton
            route="POST /announcements/:id/cancel"
            params={{ id: existing.id }}
            label={t('cancel')}
            size="md"
            variant="destructive"
            tone="destructive"
            title={t('cancelTitle')}
            effects={t('cancelEffects')}
            confirmLabel={t('cancel')}
            successMessage={t('cancelled')}
            testId="announcement-cancel"
          />
        ) : null}
        <Link
          href={closeHref}
          className="text-bo-body font-semibold text-text-link hover:underline"
        >
          {t('close')}
        </Link>
      </div>
    </div>
  );
}

/** The mobile Today announcement card in a 390 px-wide frame, in the given scheme. */
function PhoneCard({
  scheme,
  caption,
  title,
  body,
  cta,
}: {
  scheme: 'light' | 'dark';
  caption: string;
  title: string;
  body: string;
  cta: string | null;
}) {
  return (
    <figure className="m-0 flex flex-col gap-1">
      <div
        data-theme={scheme}
        style={themeVars(scheme)}
        className="rounded-card bg-bg p-3 text-ink"
      >
        <div className="flex flex-col gap-1 rounded-card-sm bg-surface p-3 shadow-card">
          <p className="text-bo-body font-semibold break-words text-ink">{title}</p>
          <p className="text-bo-meta break-words text-ink-2">{body}</p>
          {cta === null ? null : <p className="text-bo-meta font-semibold text-text-link">{cta}</p>}
        </div>
      </div>
      <figcaption className="text-bo-meta text-ink-3">{caption}</figcaption>
    </figure>
  );
}

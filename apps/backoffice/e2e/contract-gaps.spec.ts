import { expect, test } from '@playwright/test';

import { MFA_CODE } from './fixtures';
import { confirmDialog, mockAudit, mockCalls, signInAs } from './helpers';
import { uid } from './mock-data';

/*
 * The backoffice contract gaps (BACKOFFICE_PLAN §3.3, §5.5, §6.1, §6.3, §6.4, §6.6, §6.8, §6.10,
 * §6.12, §6.17, §6.22): dashboard platform filter and rollup staleness, the masked identity with
 * per-field reveals, ticket user links, the AI feedback comment badge and model costs, crash data
 * "not configured", the push-test quiet-hours preview, bulk retry of selected jobs and the live
 * view, the kill-switch re-enable and the backup MFA device.
 */

const USER_ID = '0190f5e0-1111-7000-8000-00000000abcd';
/** The mock user inside quiet hours (`mock-admin.ts` QUIET_USER_ID). */
const QUIET_USER_ID = uid('1111', 2);
const REASON = 'Destek talebi DA-10240 kapsamında kontrol';

test.describe('contract gaps', () => {
  test('dashboard: platform filter scopes the user KPIs and the stale rollup is announced', async ({
    page,
    request,
  }) => {
    await signInAs(page, request, 'operations');
    await expect(page.getByTestId('rollup-stale')).toContainText('Son güncelleme');
    await expect(page.getByTestId('kpi-total_users')).toContainText('12.480');
    await page
      .getByRole('navigation', { name: 'Platform' })
      .getByRole('link', { name: 'iOS' })
      .click();
    await expect(page).toHaveURL(/platform=ios/);
    await expect(page.getByTestId('kpi-total_users')).toContainText('7.738');
    const call = (await mockCalls(request)).filter((c) => c.path === '/dashboard/metrics').at(-1);
    expect(call?.query.platform).toBe('ios');
  });

  test('user header: masked name and email, the name revealed with an audited reason', async ({
    page,
    request,
  }) => {
    await signInAs(page, request, 'support');
    await page.goto(`/users/${USER_ID}/overview`);
    await expect(page.getByTestId('user-name')).toContainText('Y*** D.');
    await expect(page.getByTestId('user-email')).toContainText('yu***@gmail.com');
    await page.getByRole('button', { name: 'Ad değerini göster' }).click();
    await confirmDialog(page, 'Bilgiyi göster', { reason: REASON });
    await expect(page.getByText('Yusuf Demir').first()).toBeVisible();
    const call = (await mockCalls(request)).find((c) => c.path === `/users/${USER_ID}/reveal`);
    expect(call?.body).toMatchObject({ field: 'display_name', reason: REASON });
    expect((await mockAudit(request)).at(-1)).toMatchObject({
      action: 'user.pii_revealed',
      reason: REASON,
    });
  });

  test('support tickets link the matched user; AI feedback hides comments', async ({
    page,
    request,
  }) => {
    await signInAs(page, request, 'super_admin');
    await page.goto('/support');
    const link = page.locator('[data-testid^="ticket-user-"]').first();
    await expect(link).toHaveAttribute('href', /\/users\/[0-9a-f-]{36}\/overview$/);
    await page.goto('/ai/feedback');
    await expect(page.getByText('Yorum var · gizli').first()).toBeVisible();
    await expect(page.getByText('Yorum yok').first()).toBeVisible();
  });

  test('AI models: per-profile cost of a typical Pro user and the voice providers', async ({
    page,
    request,
  }) => {
    await signInAs(page, request, 'ai_ops');
    await page.goto('/ai/models');
    const costs = page.getByTestId('profile-costs').first();
    await expect(costs).toContainText('$2,24');
    await expect(costs).toContainText('$1,02');
    const providers = page.getByTestId('provider-credentials').first();
    await expect(providers).toContainText('STT (ses → metin)');
    await expect(providers).toContainText('TTS (metin → ses)');
  });

  test('app versions: crash columns say Sentry is not configured, no numbers', async ({
    page,
    request,
  }) => {
    await signInAs(page, request, 'operations');
    await page.goto('/health?tab=versions');
    await expect(page.getByTestId('crash-reporting').first()).toContainText(
      'Sentry yapılandırılmadı — Harici kimlik bilgisi gerekli',
    );
    await expect(page.getByTestId('app-versions').first()).toContainText('Çökmesiz oturum');
  });

  test('push test: the dialog shows the quiet-hours deferral before sending', async ({
    page,
    request,
  }) => {
    await signInAs(page, request, 'operations');
    await page.goto(`/users/${QUIET_USER_ID}/overview`);
    await page.getByTestId('user-actions').click();
    await page.getByRole('menuitem', { name: 'Test bildirimi gönder…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Test bildirimi gönder' });
    await expect(dialog.getByTestId('push-test-preview')).toContainText(
      'Kullanıcının yerel saati 23:40, sessiz saatler içinde. Test bildirimi sessiz saatler bittiğinde (08:00) gönderilecek.',
    );
    await confirmDialog(page, 'Test bildirimi gönder', { reason: REASON });
    await expect(page.getByText(/Kullanıcı sessiz saatlerde/).first()).toBeVisible();
    const preview = (await mockCalls(request)).find(
      (c) => c.path === '/notifications/test-push/preview',
    );
    expect(preview?.query.user_id).toBe(QUIET_USER_ID);
  });

  test('jobs: retry the selected failed jobs; the live view polls in the background', async ({
    page,
    request,
  }) => {
    await signInAs(page, request, 'operations');
    await page.goto('/jobs?f.status=failed');
    await page.getByRole('checkbox', { name: 'Bu sayfadaki işleri seç' }).check();
    const bar = page.getByTestId('jobs-selection');
    await expect(bar).toContainText('seçildi');
    await page.getByTestId('jobs-retry-selected').click();
    await confirmDialog(page, /işi tekrar dene$/, { reason: REASON });
    await expect(page.getByText(/iş kuyruğa alındı, \d+ iş atlandı\./).first()).toBeVisible();
    const call = (await mockCalls(request)).find((c) => c.path === '/jobs/retry-bulk');
    expect(Array.isArray((call?.body as { job_ids?: unknown }).job_ids)).toBe(true);
    expect((await mockAudit(request)).at(-1)).toMatchObject({ action: 'job.bulk_retried' });

    const before = (await mockCalls(request)).filter((c) => c.path === '/jobs').length;
    await page.getByTestId('jobs-live').click();
    await expect(page.getByTestId('jobs-live-status')).toContainText('10 saniyede');
    await expect
      .poll(async () => (await mockCalls(request)).filter((c) => c.path === '/jobs').length)
      .toBeGreaterThan(before);
    const polled = (await mockCalls(request)).filter((c) => c.path === '/jobs').at(-1);
    expect(polled?.headers['x-da-activity']).toBe('background');
  });

  test('flags: a killed flag is re-enabled with a reason (kill switch off)', async ({
    page,
    request,
  }) => {
    await signInAs(page, request, 'operations');
    await page.goto('/flags?flag=feature.voice');
    await page.getByTestId('flag-kill').click();
    await confirmDialog(page, 'feature.voice acil kapatılsın mı?', {
      reason: 'Sesli brifingde çökme artışı gözlendi',
      typed: 'feature.voice',
    });
    await page.getByTestId('flag-enable').first().click();
    await confirmDialog(page, 'feature.voice yeniden açılsın mı?', {
      reason: 'Düzeltme yayınlandı, çökme oranı normale döndü',
    });
    await expect(page.getByText('Bayrak açıldı.').first()).toBeVisible();
    const kills = (await mockCalls(request)).filter((c) => c.path === '/flags/feature.voice/kill');
    expect(kills.map((c) => (c.body as { on?: boolean }).on)).toEqual([true, false]);
    expect((await mockAudit(request)).at(-1)).toMatchObject({ action: 'flag.kill_switch_off' });
  });

  test('settings: a backup authenticator is added with a QR code and audited', async ({
    page,
    request,
  }) => {
    await signInAs(page, request, 'operations');
    await page.goto('/settings?tab=security');
    const add = page.getByRole('button', { name: 'Yedek cihaz ekle' });
    await expect(page.getByRole('button', { name: /Kaldır/ }).first()).toBeDisabled();
    await add.click();
    const dialog = page.getByRole('dialog', { name: 'Yedek cihaz ekle' });
    await expect(dialog.getByText(/Kodu elle gir:/)).toBeVisible();
    await dialog.getByLabel('Doğrulama kodu').fill(MFA_CODE);
    await page.getByTestId('mfa-factor-confirm').click();
    await expect(page.getByText('Yedek cihaz eklendi.').first()).toBeVisible();
    await expect(add).toHaveCount(0);
    expect((await mockAudit(request)).at(-1)).toMatchObject({ action: 'admin.mfa_factor_added' });
  });
});

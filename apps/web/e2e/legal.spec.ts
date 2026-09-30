import { expect, test, type Page } from '@playwright/test';
import { bannedClaims, visibleText } from './helpers.ts';

const LIMITED_USE_TR =
  'Dijital Asistan’ın Google API’lerinden aldığı bilgileri kullanması ve başka bir uygulamaya aktarması, Sınırlı Kullanım şartları dahil Google API Hizmetleri Kullanıcı Verileri Politikası’na uygun olacaktır.';
const LIMITED_USE_EN =
  'Dijital Asistan’s use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.';

async function sectionIds(page: Page): Promise<string[]> {
  return page
    .locator('main article section[id]')
    .evaluateAll((sections) => sections.map((section) => section.id));
}

test.describe('legal pages (WEB-E2E-04)', () => {
  test('/privacy states the Google Limited Use sentence verbatim (TR + EN)', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.locator('#google-limited-use')).toContainText(LIMITED_USE_TR);
    await page.goto('/en/privacy');
    await expect(page.locator('#google-limited-use')).toContainText(LIMITED_USE_EN);
  });

  test('/privacy lists the AI sub-processors and the retention schedule', async ({ page }) => {
    await page.goto('/privacy');
    const subprocessors = page.getByTestId('subprocessor-table');
    await expect(subprocessors).toBeVisible();
    for (const name of ['Anthropic', 'OpenAI', 'Voyage AI', 'Supabase']) {
      await expect(subprocessors).toContainText(name);
    }
    await expect(page.getByTestId('retention-table')).toBeVisible();
    await expect(page.locator('main')).toContainText('Verilerin reklam amacıyla satılmaz.');
    await expect(page.locator('main')).toContainText('Örnek Yazılım A.Ş.');
  });

  test('privacy and terms carry none of the banned claims', async ({ page }) => {
    const bans = bannedClaims();
    for (const path of ['/privacy', '/en/privacy', '/terms', '/en/terms']) {
      await page.goto(path);
      const text = await visibleText(page);
      for (const ban of bans) expect(text, `${path} ${String(ban)}`).not.toMatch(ban);
    }
  });

  test('/terms renders with a version and effective date', async ({ page }) => {
    await page.goto('/terms');
    await expect(page.getByTestId('legal-version')).toContainText(
      /Yürürlük tarihi: \d{1,2} \S+ \d{4}/u,
    );
    await page.goto('/en/terms');
    await expect(page.getByTestId('legal-version')).toContainText(/Effective \d{1,2} \S+ \d{4}/u);
  });

  for (const doc of ['privacy', 'terms']) {
    test(`/${doc} and /en/${doc} are in parity (same section ids)`, async ({ page }) => {
      await page.goto(`/${doc}`);
      const tr = await sectionIds(page);
      await page.goto(`/en/${doc}`);
      const en = await sectionIds(page);
      expect(tr.length).toBeGreaterThan(10);
      expect(en).toEqual(tr);
    });
  }

  test('TOC links move to the section; "Başa dön" returns to the top', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/privacy');
    const toc = page.getByRole('navigation', { name: 'İçindekiler' }).first();
    await toc
      .getByRole('link', { name: /Google/ })
      .first()
      .click();
    await expect(page).toHaveURL(/#google$/);
    await expect(page.locator('#google-h')).toBeInViewport();
    await expect(page.locator('#google-h')).toBeFocused();
    await page.getByRole('link', { name: 'Başa dön' }).last().click();
    await expect(page).toHaveURL(/#top$/);
    await expect(page.locator('h1')).toBeInViewport();
  });

  test('privacy links to the data deletion page and the privacy mailbox', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.locator('main a[href="/data-deletion"]').first()).toBeVisible();
    await expect(page.locator('main a[href^="mailto:gizlilik@"]').first()).toBeVisible();
    const external = page.locator('main a[href^="https://"]');
    const count = await external.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const target = await external.nth(index).getAttribute('target');
      if (target === '_blank') {
        await expect(external.nth(index)).toHaveAttribute('rel', /noopener/);
      }
    }
  });

  test('terms link to pricing, privacy, data deletion and the store subscription pages', async ({
    page,
  }) => {
    await page.goto('/terms');
    const main = page.locator('main');
    await expect(main.locator('a[href="/pricing"]').first()).toBeAttached();
    await expect(main.locator('a[href^="/privacy"]').first()).toBeAttached();
    await expect(main.locator('a[href="/data-deletion"]').first()).toBeAttached();
    await expect(
      main.locator('a[href^="https://apps.apple.com/account/subscriptions"]').first(),
    ).toBeAttached();
    await expect(
      main.locator('a[href^="https://play.google.com/store/account/subscriptions"]').first(),
    ).toBeAttached();
  });
});

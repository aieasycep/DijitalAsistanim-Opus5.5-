import { expect, test } from '@playwright/test';
import { stubState, visibleText } from './helpers.ts';

/** M§44 comparison rows, in order (Part 5 W-PRICE-01 P3). */
const COMPARISON = [
  ['Bağlı mail hesabı', '1', 'Birden fazla'],
  ['Bağlı takvim', '1', 'Birden fazla'],
  ['Sabah brifingi', 'Dahil', 'Dahil'],
  ['Bugün ekranı ve Akış', 'Dahil', 'Dahil'],
  ['Mail zekâsı ve önemli mailler', 'Dahil', 'Dahil'],
  ['AI yanıt taslakları (4 ton, onaylı gönderim)', 'Dahil', 'Dahil'],
  ['Onay Merkezi ve akıllı hatırlatıcılar', 'Dahil', 'Dahil'],
  ["Asistan'a sor (kaynaklı yanıtlar)", 'Dahil', 'Dahil'],
  ['Öğle ve akşam brifingi', 'Dahil değil', 'Dahil'],
  ['Toplantı hazırlığı', 'Dahil değil', 'Dahil'],
  ['Akıllı takip ve taahhütler', 'Dahil değil', 'Dahil'],
  ['Sesli brifing', 'Dahil değil', 'Dahil'],
  ['AI hafıza ve VIP kişiler', 'Dahil değil', 'Dahil'],
  ['Gelişmiş planlama', 'Dahil değil', 'Dahil'],
  ['Evrensel yakalama (fotoğraf, PDF, bağlantı, paylaş menüsü)', 'Dahil değil', 'Dahil'],
  ['Telefon bildirimleri zekâsı (yalnızca Android)', 'Dahil değil', 'Dahil'],
  ['AI analiz limiti', '50/gün', 'Yüksek (adil kullanım)'],
];

test.describe('pricing (WEB-E2E-03)', () => {
  test('the Free vs Pro table matches M§44 row by row', async ({ page }) => {
    await page.goto('/pricing');
    const rows = page.locator('table tbody tr');
    await expect(rows).toHaveCount(COMPARISON.length);
    const cells = await rows.evaluateAll((trs) =>
      trs.map((tr) =>
        Array.from(tr.querySelectorAll('th, td')).map((cell) =>
          cell.textContent.replace(/\s+/g, ' ').trim(),
        ),
      ),
    );
    expect(cells).toEqual(COMPARISON);
  });

  test('prices come from the store config with a "mağaza fiyatı" note; the period toggle switches them', async ({
    page,
  }) => {
    await page.goto('/pricing');
    const pro = page.locator('article[aria-labelledby="plan-pro"]');
    await expect(pro).toContainText('₺1.490 / yıl');
    await expect(pro).toContainText('Mağaza fiyatı · KDV dahil');
    await expect(pro).toContainText('tasarruf');
    const annual = page.getByRole('radio', { name: /Yıllık/ });
    await expect(annual).toBeChecked();
    await page.getByText('Aylık', { exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Aylık' })).toBeChecked();
    await expect(pro).toContainText('₺199–₺209 / ay');
    await expect(pro).not.toContainText('tasarruf');
    // Arrow keys move within the native radio group.
    await page.getByRole('radio', { name: 'Aylık' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(annual).toBeChecked();
    await expect(pro).toContainText('₺1.490 / yıl');
    await expect
      .poll(async () =>
        (await stubState()).events.some(
          (event) => (event as { event?: string }).event === 'web_pricing_period',
        ),
      )
      .toBe(true);
  });

  test('no "Sınırsız"; Pro is "adil kullanım"', async ({ page }) => {
    for (const path of ['/pricing', '/en/pricing']) {
      await page.goto(path);
      const text = await visibleText(page);
      expect(text).not.toMatch(/s\u0131n\u0131rs\u0131z|unlimited/iu);
    }
    await page.goto('/pricing');
    await expect(page.locator('table')).toContainText('adil kullanım');
  });

  test('no trial line when the store has no intro offer', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.locator('#plans')).not.toContainText('ücretsiz deneme');
  });

  test('CTAs route through /get; the Pro CTA scrolls to the download band on desktop', async ({
    page,
  }) => {
    await page.goto('/pricing');
    await expect(page.locator('#plans a[data-cta="get_started"]').first()).toHaveAttribute(
      'href',
      '/get?src=pricing',
    );
    await page.getByRole('link', { name: "Uygulamada Pro'ya geç" }).click();
    await expect(page.locator('#download-title')).toBeFocused();
    await expect(page).toHaveURL(/\/pricing$/);
  });

  test('billing FAQ is shared with /support and toggles', async ({ page }) => {
    await page.goto('/pricing');
    const questions = await page.locator('main details summary').allInnerTexts();
    expect(questions.length).toBeGreaterThanOrEqual(5);
    const first = page.locator('main details').first();
    await first.locator('summary').click();
    await expect(first).toHaveAttribute('open', '');
    await page.goto('/support');
    const supportQuestions = await page.locator('main details summary').allInnerTexts();
    for (const question of questions) expect(supportQuestions).toContain(question);
  });

  test('English pricing uses English copy and the same figures', async ({ page }) => {
    await page.goto('/en/pricing');
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('article[aria-labelledby="plan-pro"]')).toContainText('TRY');
    await expect(page.locator('table')).toContainText('fair use');
  });
});

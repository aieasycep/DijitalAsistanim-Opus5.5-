import { expect, test } from '@playwright/test';
import { bannedClaims, LOCALIZED_PAGES, visibleText } from './helpers.ts';
import { STUB_VALID_REFERRAL } from './stub/constants.ts';

/** QG-06 / C-10 / C-27 / R-15: no page makes a claim the product cannot back. */
test.describe('truthful copy (QG-06)', () => {
  test('no banned claim or work marker on any page (TR + EN)', async ({ page }) => {
    test.setTimeout(90_000);
    const bans = bannedClaims();
    const failures: string[] = [];
    for (const path of [
      ...LOCALIZED_PAGES,
      `/r/${STUB_VALID_REFERRAL}`,
      '/app/today',
      '/does-not-exist',
    ]) {
      await page.goto(path);
      const text = await visibleText(page);
      for (const ban of bans) {
        const match = ban.exec(text);
        if (match !== null) failures.push(`${path}: ${String(ban)} → "${match[0]}"`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('no testimonials, ratings or download counts', async ({ page }) => {
    for (const path of ['/', '/en']) {
      await page.goto(path);
      await expect(page.locator('blockquote')).toHaveCount(0);
      const text = await visibleText(page);
      expect(text).not.toMatch(
        /★|\b\d+(\.\d+)?\s*\/\s*5\b|\d[\d.,]*\+?\s*(indirme|downloads|kullanıcı|users)\b/iu,
      );
    }
  });

  test('the integration list names only supported providers', async ({ page }) => {
    await page.goto('/');
    const chips = await page.locator('#integrations li').allInnerTexts();
    const supported =
      /Gmail|Google Takvim|Google Tasks|Outlook|Microsoft To Do|Apple|Android|iPhone|Microsoft 365|Outlook Takvim|Takvim/u;
    for (const chip of chips) expect(chip, chip).toMatch(supported);
  });
});

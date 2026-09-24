import { expect, test, type Page } from '@playwright/test';

async function focusedDescription(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    if (element === null) return '';
    return `${element.tagName.toLowerCase()}:${(element.getAttribute('aria-label') ?? element.textContent).trim()}`;
  });
}

test.describe('keyboard navigation (WEB-E2E-11)', () => {
  test('the skip link is the first tab stop and moves focus to main', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'İçeriğe geç' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toBeFocused();
  });

  test('tab order runs header nav → header CTA → hero CTAs', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const stops: string[] = [];
    for (let index = 0; index < 14; index += 1) {
      await page.keyboard.press('Tab');
      stops.push(await focusedDescription(page));
    }
    const index = (needle: string): number => stops.findIndex((stop) => stop.includes(needle));
    expect(index('İçeriğe geç')).toBe(0);
    expect(index('Nasıl çalışır')).toBeGreaterThan(index('İçeriğe geç'));
    expect(index('Güvenlik')).toBeGreaterThan(index('Nasıl çalışır'));
    expect(index('Ücretsiz Başla')).toBeGreaterThan(index('Güvenlik'));
    expect(index("App Store'dan indir")).toBeGreaterThan(index('Ücretsiz Başla'));
  });

  test('focus is visible (outline) on links and buttons', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const focused = document.activeElement;
      if (focused === null) return { style: 'none', width: 0 };
      const style = getComputedStyle(focused);
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
    });
    expect(outline.style).not.toBe('none');
    expect(outline.width).toBeGreaterThanOrEqual(2);
  });

  test('the mobile menu closes on Esc and returns focus to its toggle', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const toggle = page.locator('header').getByRole('button', { name: 'Menü' });
    await toggle.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Fiyatlar' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(toggle).toBeFocused();
  });

  test('a mobile menu link closes the menu and lands on the section', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.locator('header').getByRole('button', { name: 'Menü' }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'SSS' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page).toHaveURL(/#faq$/u);
    await expect(page.locator('#faq-title')).toBeFocused();
  });

  test('the QR dialog keeps focus inside while open', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto('/');
    await page
      .locator('[data-section="hero"]')
      .getByRole('button', { name: 'QR ile indir' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Telefonunla tara' });
    await expect(dialog).toBeVisible();
    for (let index = 0; index < 4; index += 1) {
      await page.keyboard.press('Tab');
      // The rest of the page is inert: focus stays in the dialog (or briefly leaves to the
      // browser UI, where `activeElement` is the body), never on page content behind it.
      const outside = await dialog.evaluate(
        (node) =>
          document.activeElement !== document.body && !node.contains(document.activeElement),
      );
      expect(outside).toBe(false);
    }
  });
});

/**
 * Synthetic capture assets for the Maestro flows (TEST_PLAN §12.1 "Capture assets"): fictional
 * documents only, rendered with headless Chromium into `apps/mobile/.maestro/assets/`:
 *   - fatura-ck-enerji.png      bill: "CK Enerji", "1.842,00 TL", "Son ödeme"
 *   - ucus-tk2412.png           flight screenshot: TK2412 İstanbul → Antalya
 *   - Hizmet_Sozlesmesi_v3.pdf  14 pages, "İmza için son gün" on page 14 §9.2 (share intent)
 *
 * Usage: node scripts/e2e/gen-assets.ts
 * Chromium: `CHROME_PATH`, else the Playwright build under /opt/pw-browsers, else `chromium`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ASSETS = join(ROOT, 'apps', 'mobile', '.maestro', 'assets');

const PAGE = `font-family: 'DejaVu Sans', Arial, sans-serif; margin: 0; background: #ffffff; color: #1d1b16;`;

export const BILL_HTML = `<!doctype html><html lang="tr"><meta charset="utf-8"><body style="${PAGE} width: 720px; height: 1280px;">
<div style="padding: 64px 56px;">
  <div style="font-size: 44px; font-weight: 700; color: #0b5cad;">CK Enerji</div>
  <div style="font-size: 22px; margin-top: 8px;">Elektrik Faturası · Örnek belge</div>
  <div style="margin-top: 64px; font-size: 24px;">Abone: Yunus Örnek</div>
  <div style="font-size: 24px; margin-top: 8px;">Tesisat no: 0000000000</div>
  <div style="margin-top: 72px; font-size: 26px;">Ödenecek tutar</div>
  <div style="font-size: 72px; font-weight: 700; margin-top: 8px;">1.842,00 TL</div>
  <div style="margin-top: 48px; font-size: 30px;">Son ödeme: 27.09.2026</div>
  <div style="margin-top: 120px; font-size: 18px; color: #6b665c;">Bu belge test amaçlı ve kurgusaldır.</div>
</div></body></html>`;

export const FLIGHT_HTML = `<!doctype html><html lang="tr"><meta charset="utf-8"><body style="${PAGE} width: 720px; height: 1280px;">
<div style="padding: 64px 56px;">
  <div style="font-size: 36px; font-weight: 700;">Uçuş bilgisi</div>
  <div style="font-size: 64px; font-weight: 700; margin-top: 48px;">TK2412</div>
  <div style="font-size: 34px; margin-top: 16px;">İstanbul (IST) → Antalya (AYT)</div>
  <div style="font-size: 28px; margin-top: 32px;">25 Eylül 2026 · 09:40</div>
  <div style="font-size: 28px; margin-top: 8px;">PNR: ABC123 · Koltuk 12A</div>
  <div style="margin-top: 120px; font-size: 18px; color: #6b665c;">Bu ekran görüntüsü test amaçlı ve kurgusaldır.</div>
</div></body></html>`;

export function contractHtml(): string {
  const pages = Array.from({ length: 14 }, (_, i) => {
    const n = i + 1;
    const body =
      n === 14
        ? '<h2>§9.2 İmza</h2><p>İmza için son gün: 30 Eylül 2026.</p>'
        : `<h2>Madde ${String(n)}</h2><p>Bu sayfa kurgusal bir hizmet sözleşmesinin ${String(n)}. sayfasıdır.</p>`;
    return `<section style="page-break-after: ${n === 14 ? 'auto' : 'always'}; padding: 48px;">
<h1 style="font-size: 20px;">Hizmet Sözleşmesi v3 · Sayfa ${String(n)} / 14</h1>${body}</section>`;
  }).join('\n');
  return `<!doctype html><html lang="tr"><meta charset="utf-8"><body style="${PAGE}">${pages}</body></html>`;
}

function chromium(): string {
  const env = process.env.CHROME_PATH;
  if (env !== undefined && existsSync(env)) return env;
  const base = '/opt/pw-browsers';
  if (existsSync(base)) {
    for (const dir of readdirSync(base)
      .filter((d) => d.startsWith('chromium-'))
      .sort()
      .reverse()) {
      const path = join(base, dir, 'chrome-linux', 'chrome');
      if (existsSync(path)) return path;
    }
  }
  return 'chromium';
}

const FLAGS = ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars'];

function render(html: string, out: string, mode: 'png' | 'pdf'): void {
  const work = mkdtempSync(join(tmpdir(), 'da-e2e-assets-'));
  try {
    const page = join(work, 'page.html');
    writeFileSync(page, html);
    const target =
      mode === 'png'
        ? [`--screenshot=${out}`, '--window-size=720,1280']
        : [`--print-to-pdf=${out}`, '--no-pdf-header-footer'];
    execFileSync(chromium(), [...FLAGS, ...target, pathToFileURL(page).href], { stdio: 'ignore' });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(ASSETS, { recursive: true });
  render(BILL_HTML, join(ASSETS, 'fatura-ck-enerji.png'), 'png');
  render(FLIGHT_HTML, join(ASSETS, 'ucus-tk2412.png'), 'png');
  render(contractHtml(), join(ASSETS, 'Hizmet_Sozlesmesi_v3.pdf'), 'pdf');
  console.info(`gen-assets: wrote 3 files to ${ASSETS}`);
}

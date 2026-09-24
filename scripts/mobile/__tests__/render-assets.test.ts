import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASSET_SPECS,
  ROOT,
  buildSvg,
  crop,
  decodePng,
  encodePng,
  inspectPng,
} from '../render-assets.ts';

const assets = join(ROOT, 'apps', 'mobile', 'assets');

test('committed SVG sources equal the generator output (tokens + brand glyph)', () => {
  for (const spec of ASSET_SPECS) {
    const committed = readFileSync(join(assets, 'src', `${spec.name}.svg`), 'utf8');
    assert.equal(
      committed,
      buildSvg(spec),
      `${spec.name}.svg drifted; run pnpm --filter @da/mobile assets`,
    );
  }
});

test('committed PNGs have their size, opacity and white-on-transparent rules', () => {
  for (const spec of ASSET_SPECS) {
    const png = decodePng(readFileSync(join(assets, `${spec.name}.png`)));
    assert.deepEqual(inspectPng(spec, png), [], spec.name);
  }
  const icon = decodePng(readFileSync(join(assets, 'icon.png')));
  assert.equal(icon.channels, 3, 'the store icon has no alpha channel');
});

test('the PNG codec round-trips and crops', () => {
  const png = decodePng(readFileSync(join(assets, 'notification-icon.png')));
  assert.deepEqual(decodePng(encodePng(png)), png);
  const corner = crop(png, 8, 4);
  assert.equal(corner.width, 8);
  assert.deepEqual(corner.pixels.slice(0, 4), png.pixels.slice(0, 4));
  assert.throws(() => crop(png, 200, 4), /smaller than/);
});

test('a non-white pixel fails the notification icon rule', () => {
  const spec = ASSET_SPECS.find((s) => s.name === 'notification-icon');
  assert.ok(spec);
  const png = decodePng(readFileSync(join(assets, 'notification-icon.png')));
  const tinted = { ...png, pixels: png.pixels.map((v, i) => (i % 4 === 0 ? 0 : v)) };
  assert.match(inspectPng(spec, tinted).join(), /non-white pixel/);
});

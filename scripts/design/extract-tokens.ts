/** Extracts COLORS, DARK, TYPE, SPACE and RADIUS from PRIMARY "01 Tasarim Sistemi" into design/tokens. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, constLiteral, dataScript, readCanvas } from './lib.ts';

interface ColorRow {
  name: string;
  hex: string;
  on: string;
  use: string;
}
interface DarkRow {
  name: string;
  hex: string;
}
interface TypeRow {
  token: string;
  size: string;
  lh: string;
  w: number;
  ls: string;
  ff: string;
  tt: string;
  spec: string;
}

export function extractTokens(): Record<string, unknown> {
  const script = dataScript(readCanvas('01 Tasarim Sistemi.dc.html'));
  const colors = constLiteral(script, 'COLORS') as ColorRow[];
  const dark = constLiteral(script, 'DARK') as DarkRow[];
  const type = constLiteral(script, 'TYPE') as TypeRow[];
  const space = constLiteral(script, 'SPACE') as number[];
  const radius = constLiteral(script, 'RADIUS') as [string, string][];
  return {
    source: 'design/reference/primary/01 Tasarim Sistemi.dc.html',
    colors: Object.fromEntries(colors.map((c) => [c.name, { value: c.hex, on: c.on, use: c.use }])),
    dark: Object.fromEntries(dark.map((d) => [d.name, d.hex])),
    typography: Object.fromEntries(
      type.map((t) => [
        t.token,
        {
          fontFamily: t.ff,
          fontSize: t.size,
          lineHeight: t.lh,
          fontWeight: t.w,
          letterSpacing: t.ls,
          textTransform: t.tt,
          spec: t.spec,
        },
      ]),
    ),
    space,
    radius: Object.fromEntries(radius.map(([px, use]) => [use, Number(px)])),
  };
}

if (import.meta.main) {
  const out = join(ROOT, 'design', 'tokens', 'primary-tokens.json');
  writeFileSync(out, JSON.stringify(extractTokens(), null, 2) + '\n');
  console.info(`wrote ${out}`);
}

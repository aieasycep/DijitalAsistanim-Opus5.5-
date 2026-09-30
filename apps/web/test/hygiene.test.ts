import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(APP, 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'generated' ? [] : sources(full);
    return /\.(ts|tsx)$/u.test(name) ? [full] : [];
  });
}

const FILES = sources(SRC).map((file) => ({
  file: relative(APP, file),
  text: readFileSync(file, 'utf8'),
}));
const CLIENT = FILES.filter(({ text }) => /^'use client';/mu.test(text));

describe('source hygiene', () => {
  it('the generated icon components match packages/ui/icons.data.json', () => {
    const result = spawnSync(process.execPath, ['scripts/gen-icons.ts', '--check'], {
      cwd: APP,
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('zod is imported through src/lib/zod.ts (jitless, CSP without eval)', () => {
    const direct = FILES.filter(
      ({ file, text }) => file !== 'src/lib/zod.ts' && text.includes("from 'zod'"),
    );
    expect(direct.map(({ file }) => file)).toEqual([]);
  });

  it('client components do not pull the whole @da/i18n catalog into the bundle', () => {
    // Type-only imports are erased; a value import of the root would bundle every catalog.
    const offenders = CLIENT.filter(({ text }) =>
      /^import (?!type\b)[^;]*from '@da\/i18n';/mu.test(text),
    );
    expect(offenders.map(({ file }) => file)).toEqual([]);
  });

  it('client code reads no server environment variable', () => {
    for (const { file, text } of CLIENT) {
      expect(text, file).not.toMatch(/process\.env\.(?!NEXT_PUBLIC_)/u);
      expect(text, file).not.toMatch(/env\/server|site-config|server-only/u);
    }
  });

  it('no raw colour literals outside the design tokens', () => {
    const offenders = FILES.filter(({ text }) => /#[0-9a-fA-F]{6}\b|rgba?\(/u.test(text)).map(
      ({ file }) => file,
    );
    expect(offenders).toEqual([]);
  });

  it('no third-party tracker or CDN is referenced', () => {
    for (const { file, text } of FILES) {
      expect(text, file).not.toMatch(
        /googletagmanager|google-analytics|gtag\(|facebook\.net|hotjar|segment\.(io|com)|mixpanel|cdn\.jsdelivr|unpkg\.com/iu,
      );
    }
  });
});

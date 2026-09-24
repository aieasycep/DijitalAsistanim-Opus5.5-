/**
 * "No token is written to AsyncStorage" (T-8.05 acceptance; SECURITY_AND_PRIVACY_PLAN grep gate).
 * The ESLint rule (`no-restricted-imports` in `@da/config/eslint/react-native.mjs`) blocks the
 * import; this test also fails on any mention in app code or a dependency on the package, and on
 * Supabase auth configured without the LargeSecureStore adapter.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from '@jest/globals';

const APP_ROOT = join(__dirname, '..');

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* sources(full);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) yield full;
  }
}

const APP_SOURCES = [...sources(join(APP_ROOT, 'app')), ...sources(join(APP_ROOT, 'src'))];

describe('no AsyncStorage for auth or anything else', () => {
  it('app code never imports or calls AsyncStorage (or localStorage)', () => {
    const offenders = APP_SOURCES.filter((file) =>
      /@react-native-async-storage|\bAsyncStorage\s*\.|\blocalStorage\s*\./.test(
        readFileSync(file, 'utf8'),
      ),
    ).map((file) => relative(APP_ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('the app does not depend on the AsyncStorage package', () => {
    const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names.filter((n) => n.startsWith('@react-native-async-storage'))).toEqual([]);
  });

  it('the Supabase client stores its session only through LargeSecureStore', () => {
    const supabase = readFileSync(join(APP_ROOT, 'src/lib/auth/supabase.ts'), 'utf8');
    expect(supabase).toMatch(/storage: largeSecureStore/);
    const clients = APP_SOURCES.filter((file) =>
      /createSupabaseClient|createClient\(/.test(readFileSync(file, 'utf8')),
    ).map((file) => relative(APP_ROOT, file));
    expect(clients).toEqual(['src/lib/auth/supabase.ts']);
  });

  it('the query cache persists to encrypted MMKV, not AsyncStorage', () => {
    const persister = readFileSync(join(APP_ROOT, 'src/lib/query/persister.ts'), 'utf8');
    expect(persister).toMatch(/mmkvAsyncStorage\(store\)/);
  });
});

/**
 * Checks enforced by other tools, verified present here:
 * QG-18 unhandled async errors — `@typescript-eslint/no-floating-promises` and `no-misused-promises`
 * at error in the shared base preset that every workspace and the root config extend, and every
 * Hono app built by the shared `createApp` (which registers `onError`) ·
 * QG-19 privileged client import — `scripts/functions/check-guards.ts` (run here, and wired into
 * `pnpm functions:lint`).
 */
import { join } from 'node:path';
import { scanFunctions } from '../../functions/check-guards.ts';
import { type Check, type Context, type Finding, eslintRuleProblem, missing } from '../lib.ts';

const BASE = 'packages/config/eslint/base.mjs';
const PRESET_CALL = /\b(base|reactNative|next|denoSafe)\(\s*\{/;

const ASYNC_RULES = [
  '@typescript-eslint/no-floating-promises',
  '@typescript-eslint/no-misused-promises',
] as const;

function asyncRules(ctx: Context): Finding[] {
  const out: Finding[] = [];
  if (ctx.exists('packages/config')) {
    for (const rule of ASYNC_RULES) {
      const problem = eslintRuleProblem(ctx.read(BASE), rule, true);
      if (problem !== null) out.push(missing('QG-18', BASE, problem));
    }
    const configs = ctx
      .files()
      .filter((f) => /^(eslint\.config\.mjs|(apps|packages)\/[^/]+\/eslint\.config\.mjs)$/.test(f));
    for (const config of configs) {
      const source = ctx.read(config);
      if (config !== 'packages/config/eslint.config.mjs' && !PRESET_CALL.test(source))
        out.push(missing('QG-18', config, 'does not extend the shared base preset'));
      for (const rule of ASYNC_RULES) {
        const problem = eslintRuleProblem(source, rule, false);
        if (problem !== null) out.push(missing('QG-18', config, problem));
      }
    }
  }
  // Hono: only the shared factory constructs apps, and it registers the error wrapper.
  for (const f of ctx.select(['supabase/functions/'], /\.ts$/)) {
    if (f.endsWith('.test.ts') || f.includes('/_shared/testing/')) continue;
    const src = ctx.read(f);
    if (/new Hono\b/.test(src) && !src.includes('.onError('))
      out.push(missing('QG-18', f, 'Hono app without onError (use _shared/http/app.ts createApp)'));
  }
  return out;
}

function guards(ctx: Context): Finding[] {
  if (!ctx.exists('supabase/functions')) return [];
  const out: Finding[] = scanFunctions(join(ctx.root, 'supabase/functions'))
    .filter((f) => f.rule === 'service-client-import')
    .map((f) => ({
      id: 'QG-19',
      file: `supabase/functions/${f.file}`,
      line: f.line,
      match: f.text,
    }));
  const tasks = ctx.read('scripts/functions/deno-tasks.ts');
  if (ctx.exists('scripts/functions') && !tasks.includes('scanFunctions('))
    out.push(
      missing(
        'QG-19',
        'scripts/functions/deno-tasks.ts',
        'functions:lint does not run check-guards',
      ),
    );
  return out;
}

export const enforcement: Check = {
  ids: ['QG-18', 'QG-19'],
  title: 'Async-error lint rules, Hono error wrapper, service-client allow-list',
  run(ctx: Context): Finding[] {
    return [...asyncRules(ctx), ...guards(ctx)];
  },
};

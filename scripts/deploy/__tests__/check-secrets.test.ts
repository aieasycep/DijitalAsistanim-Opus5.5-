import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  DEPLOY_JOB_KEYS,
  bootKeys,
  buildPlan,
  credentialGroups,
  report,
  secretNames,
} from '../check-secrets.ts';

const repo = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8');
const sources = {
  envSource: repo('packages/validation/src/env.ts'),
  credSource: repo('supabase/functions/_shared/env.ts'),
  example: repo('.env.example'),
  activeTokenVersion: 1,
};

describe('check-secrets (T-12.03)', () => {
  it('derives the boot keys from serverEnvShape (non-optional, no default)', () => {
    const keys = bootKeys(sources.envSource);
    assert.ok(keys.includes('HASH_PEPPER'));
    assert.ok(keys.includes('SUPABASE_URL'));
    assert.ok(!keys.includes('CRON_SECRET'), 'optional keys are not boot keys');
    assert.ok(!keys.includes('DEMO_MODE'), 'defaulted keys are not boot keys');
  });

  it('classifies every CREDENTIALS group and finds every name in .env.example', () => {
    const plan = buildPlan(sources);
    assert.deepEqual(plan.errors, []);
    assert.ok(credentialGroups(sources.credSource).size > 10);
  });

  it('flags an unclassified credential group and a name missing from .env.example', () => {
    const credSource = sources.credSource.replace(
      'export const CREDENTIALS = {',
      "export const CREDENTIALS = {\n  brand_new: { required: ['BRAND_NEW_KEY'] },",
    );
    const plan = buildPlan({ ...sources, credSource });
    assert.ok(plan.errors.some((e) => e.includes('"brand_new" is not classified')));
  });

  it('skips platform-injected SUPABASE_* names and never needs values', () => {
    const plan = buildPlan(sources);
    assert.ok(plan.requirements.every((r) => !r.name.startsWith('SUPABASE_')));
    const everything = new Set(plan.requirements.map((r) => r.name));
    const jobEnv = Object.fromEntries(DEPLOY_JOB_KEYS.map((k) => [k, 'set']));
    const result = report(plan, everything, jobEnv);
    assert.deepEqual(result.missing, { boot: [], production: [], optional: [] });
    assert.deepEqual(result.missingDeployJob, []);
    assert.ok(!result.text.includes('set\n'), 'no values in the report');
  });

  it('reports missing names by tier and extra names set on the project', () => {
    const plan = buildPlan(sources);
    const present = secretNames(
      JSON.stringify([
        { name: 'HASH_PEPPER', value: 'digest' },
        { name: 'OLD_UNUSED', value: 'digest' },
      ]),
    );
    const result = report(plan, present, {});
    assert.ok(result.missing.boot.includes('TOKEN_ENC_KEY_V1'));
    assert.ok(result.missing.production.includes('ANTHROPIC_API_KEY'));
    assert.ok(result.missing.optional.includes('SENTRY_DSN'));
    assert.deepEqual(result.extra, ['OLD_UNUSED']);
    assert.equal(result.missingDeployJob.length, DEPLOY_JOB_KEYS.length);
    assert.ok(!result.text.includes('digest'));
  });

  it('rejects a secrets list that is not an array', () => {
    assert.throws(() => secretNames('{"name":"X"}'), /expected a JSON array/);
  });
});

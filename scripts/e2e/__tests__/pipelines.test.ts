/**
 * The mobile E2E pipelines (T-12.02) cannot run in the container (no emulator, EAS is external),
 * so their structure is checked statically: YAML parses, triggers, pinned tool versions, the
 * android-emulator-runner inputs it documents, and EAS profiles that exist in eas.json.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

import { ROOT } from '../harness-server.ts';

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

const read = (rel: string) =>
  parse(readFileSync(join(ROOT, rel), 'utf8')) as Record<string, unknown>;

/** reactivecircus/android-emulator-runner@v2 inputs (its action.yml). */
const EMULATOR_RUNNER_INPUTS = new Set([
  'api-level',
  'target',
  'arch',
  'profile',
  'cores',
  'ram-size',
  'heap-size',
  'sdcard-path-or-size',
  'disk-size',
  'avd-name',
  'force-avd-creation',
  'emulator-boot-timeout',
  'emulator-port',
  'emulator-options',
  'disable-animations',
  'disable-spellchecker',
  'disable-linux-hw-accel',
  'enable-hw-keyboard',
  'emulator-build',
  'working-directory',
  'ndk',
  'cmake',
  'channel',
  'script',
  'pre-emulator-launch-script',
]);

test('mobile-e2e.yml: PR, manual and nightly only; emulator API 35 x86_64 google_apis tr-TR; Maestro 2.10.0', () => {
  const wf = read('.github/workflows/mobile-e2e.yml');
  const on = wf.on as Record<string, unknown>;
  assert.deepEqual(Object.keys(on).sort(), ['pull_request', 'schedule', 'workflow_dispatch']);
  assert.equal((wf.env as Record<string, string>).MAESTRO_VERSION, '2.10.0');
  const job = (wf.jobs as Record<string, { 'runs-on': string; steps: Record<string, unknown>[] }>)[
    'e2e-mobile-android'
  ];
  assert.ok(job);
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  const runner = job.steps.find((s) =>
    str(s.uses).startsWith('reactivecircus/android-emulator-runner@'),
  );
  assert.ok(runner);
  const inputs = runner.with as Record<string, unknown>;
  for (const key of Object.keys(inputs)) assert.ok(EMULATOR_RUNNER_INPUTS.has(key), key);
  assert.equal(inputs['api-level'], 35);
  assert.equal(inputs.arch, 'x86_64');
  assert.equal(inputs.target, 'google_apis');
  assert.match(String(inputs['emulator-options']), /-change-locale tr-TR/);
  const runs = job.steps.map((s) => str(s.run)).join('\n');
  assert.match(runs, /expo prebuild --platform android/);
  assert.match(runs, /assembleRelease/);
  assert.match(runs, /start-stack\.sh/);
  const upload = job.steps.find((s) => str(s.uses).startsWith('actions/upload-artifact@'));
  assert.equal(upload?.if, 'always()');
  const script = readFileSync(join(ROOT, 'scripts/e2e/run-maestro-android.sh'), 'utf8');
  assert.match(script, /--include-tags android/);
  assert.match(script, /--shard-split/);
  assert.match(script, /--format junit/);
  assert.match(script, /logcat/);
});

test('EAS workflows build the existing profiles and run Maestro 2.10.0 per platform tag', () => {
  const profiles = Object.keys(
    (JSON.parse(readFileSync(join(ROOT, 'apps/mobile/eas.json'), 'utf8')) as { build: object })
      .build,
  );
  for (const [file, tag] of [
    ['apps/mobile/.eas/workflows/build-preview.yml', null],
    ['apps/mobile/.eas/workflows/e2e-ios.yml', 'ios'],
    ['apps/mobile/.eas/workflows/e2e-android.yml', 'android'],
  ] as const) {
    const wf = read(file);
    const jobs = wf.jobs as Record<
      string,
      {
        type?: string;
        params?: { profile?: string };
        steps?: { uses?: string; with?: Record<string, unknown> }[];
      }
    >;
    for (const job of Object.values(jobs)) {
      if (job.type === 'build') assert.ok(profiles.includes(job.params?.profile ?? ''), file);
    }
    if (tag !== null) {
      const maestro = Object.values(jobs)
        .flatMap((j) => j.steps ?? [])
        .find((s) => s.uses === 'eas/maestro_test');
      assert.ok(maestro, file);
      const inputs = maestro.with ?? {};
      assert.equal(inputs.include_tags, tag, file);
      assert.equal(inputs.maestro_version, '2.10.0', file);
      assert.ok(
        Object.values(jobs).some((j) => j.params?.profile === 'e2e'),
        file,
      );
    }
  }
});

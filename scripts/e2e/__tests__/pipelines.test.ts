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

test('start-stack.sh serves the RevenueCat mock to the edge runtime and the harness (E2E-M-06/M-16)', () => {
  const script = readFileSync(join(ROOT, 'scripts/e2e/start-stack.sh'), 'utf8');
  const mockDir = join(ROOT, 'supabase/functions/_shared/testing/mock-providers');
  const server = readFileSync(join(mockDir, 'server.ts'), 'utf8');
  const services = readFileSync(join(mockDir, 'services.ts'), 'utf8');

  // The mock: deno from node_modules/.bin (the binary the shim resolves, so $! is the server), a
  // run-scoped key, a runner-local address, its pid in $OUT.
  assert.match(
    script,
    /^DENO_BIN="\$\(.*node_modules\/\.bin\/deno eval 'console\.log\(Deno\.execPath\(\)\)'\)"$/m,
  );
  const deno = script.indexOf('"$DENO_BIN" run');
  assert.ok(deno > script.indexOf('DENO_BIN='), 'the mock starts with the resolved deno binary');
  const launch = script.slice(script.lastIndexOf('nohup', deno), script.indexOf(' &\n', deno));
  for (const part of [
    '--allow-net=',
    '--allow-env',
    '--allow-read',
    '--config supabase/functions/deno.json',
    'supabase/functions/_shared/testing/mock-providers/server.ts',
    'REVENUECAT_API_V2_SECRET_KEY="$RC_SECRET_VALUE"',
    'MOCK_PROVIDERS_HOSTNAME="$MOCK_PROVIDERS_HOSTNAME"',
    'MOCK_PROVIDERS_PORT="$MOCK_PORT"',
  ]) {
    assert.ok(launch.includes(part), part);
  }
  assert.match(script, /^RC_SECRET_VALUE="sk_\$\(openssl rand -hex \d+\)"$/m);
  assert.match(server, /Deno\.env\.get\('MOCK_PROVIDERS_HOSTNAME'\)/);
  assert.match(script, /docker network inspect bridge/);
  assert.doesNotMatch(script, /0\.0\.0\.0/);
  const pid = script.indexOf('echo $! >"$OUT/mock-providers.pid"');
  assert.ok(pid > deno, 'the mock pid is written to $OUT');
  const functions = script.indexOf('nohup pnpm exec supabase functions serve');
  assert.ok(pid < functions, 'the mock starts before functions');

  // The functions reach it as host.docker.internal with test-only RevenueCat values.
  const heredoc = /cat >"\$ENV_FILE" <<EOF\n([\s\S]*?)\nEOF\n/.exec(script)?.[1] ?? '';
  const fnEnv = new Map(
    heredoc
      .split('\n')
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
  assert.equal(fnEnv.get('APP_ENV'), 'e2e');
  assert.match(fnEnv.get('REVENUECAT_PROJECT_ID') ?? '', /^\w+$/);
  assert.equal(fnEnv.get('REVENUECAT_API_V2_SECRET_KEY'), '$RC_SECRET_VALUE');
  assert.equal(
    fnEnv.get('REVENUECAT_API_BASE_URL'),
    'http://host.docker.internal:$MOCK_PORT/revenuecat/v2',
  );
  assert.match(script, /^MOCK_PORT=8788$/m);
  assert.ok(services.includes("'/revenuecat/v2/projects/:project'"));

  // The harness activates through the mock's /revenuecat/__activate on the same address.
  const harness = script.indexOf('nohup node scripts/e2e/harness-server.ts');
  const exported = script.slice(script.lastIndexOf('export ', harness), harness);
  assert.ok(exported.includes('REVENUECAT_MOCK_URL="$MOCK_URL/revenuecat"'));
  assert.match(script, /^MOCK_URL="http:\/\/\$MOCK_PROVIDERS_HOSTNAME:\$MOCK_PORT"$/m);
  assert.ok(services.includes("app.post('/revenuecat/__activate'"));
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

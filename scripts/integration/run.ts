/**
 * Integration test runner (TEST_PLAN §6, §13, §15; IMPLEMENTATION_PLAN T-12.01).
 *
 * Tier C+ (`--tier c`, the container; `pnpm test:integration:c`):
 *   1. rebuilds the tier-C database (`scripts/db/tier-c.sh --no-tests`; `DA_TEST_DB`, libpq `PG*`);
 *   2. sets run-scoped passwords on `authenticator` and a `da_it` superuser (direct SQL of the suites);
 *   3. starts PostgREST v12.2.3 (downloaded once into the git-ignored `.cache/integration/`) over
 *      the schemas `public,admin_api` with a run-scoped HS256 JWT secret, behind the node gateway of
 *      `gateway.ts` (`/rest/v1`, the GoTrue `getUser` contract, worker pokes);
 *   4. skips the suites tagged `needs:gotrue` / `needs:storage`.
 * Tier A (`--tier a`, CI; `pnpm test:integration`): `supabase db reset` on the running local stack
 * (`supabase start -x studio,imgproxy`), then every suite against its API (Kong on 54321).
 *
 * Both tiers start the mock provider server (`supabase/functions/_shared/testing/mock-providers`)
 * on 127.0.0.1:8788 and run `deno test --allow-net=127.0.0.1 --allow-env --allow-read` over
 * `supabase/tests/integration/`. Every secret is generated here per run; nothing real is used and
 * nothing is written outside `.cache/integration/` (logs: `.cache/integration/logs/`).
 *
 * Usage: node scripts/integration/run.ts [--tier a|c] [--filter <pattern>] [--reuse-db]
 *        [--no-reset] [suite files…]
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync, createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGateway, type Gateway } from './gateway.ts';
import {
  formatSummary,
  parseArgs,
  parseStatusEnv,
  randomKey32,
  randomSecret,
  roleKey,
  summarizeDenoOutput,
} from './lib.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(ROOT, '.cache', 'integration');
const LOGS = join(CACHE, 'logs');
const DENO = existsSync(join(ROOT, 'node_modules', '.bin', 'deno'))
  ? join(ROOT, 'node_modules', '.bin', 'deno')
  : 'deno';
const DENO_CONFIG = join(ROOT, 'supabase', 'functions', 'deno.json');
const MOCK_SERVER = join(
  ROOT,
  'supabase',
  'functions',
  '_shared',
  'testing',
  'mock-providers',
  'server.ts',
);
const SUITES_DIR = join(ROOT, 'supabase', 'tests', 'integration');
const POSTGREST_VERSION = 'v12.2.3';
const POSTGREST_URL = `https://github.com/PostgREST/postgrest/releases/download/${POSTGREST_VERSION}/postgrest-${POSTGREST_VERSION}-linux-static-x64.tar.xz`;
const MOCK_PORT = 8788;
const POSTGREST_PORT = Number(process.env.DA_IT_POSTGREST_PORT ?? 54330);
const GATEWAY_PORT = Number(process.env.DA_IT_GATEWAY_PORT ?? 54331);

const children: ChildProcess[] = [];
let gateway: Gateway | null = null;

function log(message: string): void {
  process.stderr.write(`==> ${message}\n`);
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  const result = spawnSync(cmd, args, { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`${cmd} ${args.join(' ')} exited with ${String(result.status)}`);
  }
  return result.stdout;
}

async function waitFor(url: string, label: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      await res.arrayBuffer();
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label} did not become ready at ${url}`);
}

async function isUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    await res.arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

function background(name: string, cmd: string, args: string[], env: NodeJS.ProcessEnv): void {
  mkdirSync(LOGS, { recursive: true });
  const out = createWriteStream(join(LOGS, `${name}.log`));
  // Own process group, so a shell shim (node_modules/.bin/deno) and its child are stopped together.
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  children.push(child);
}

function ensurePostgrest(): string {
  const dir = join(CACHE, `postgrest-${POSTGREST_VERSION}`);
  const bin = join(dir, 'postgrest');
  if (existsSync(bin)) return bin;
  mkdirSync(dir, { recursive: true });
  log(`downloading PostgREST ${POSTGREST_VERSION}`);
  const archive = join(dir, 'postgrest.tar.xz');
  run('curl', ['-fsSL', '--retry', '3', '-o', archive, POSTGREST_URL]);
  run('tar', ['-xJf', archive, '-C', dir]);
  return bin;
}

/** psql as a superuser through the tier-C helpers of `scripts/db/lib.sh`. */
function superSql(sql: string): void {
  run('bash', [
    '-c',
    `set -euo pipefail; source "${join(ROOT, 'scripts', 'db', 'lib.sh')}"; da_pg_resolve; da_psql -c "$1"`,
    'da-it',
    sql,
  ]);
}

/** Keys shared by the suites, the mock server and the apps under test (run-scoped test values). */
function baseEnv(supabaseUrl: string, mockUrl: string): Record<string, string> {
  const ms = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const msPublicDer = ms.publicKey.export({ type: 'spki', format: 'der' });
  const apple = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const fn = (path: string) => `${supabaseUrl}/functions/v1/${path}`;
  return {
    APP_ENV: 'development',
    DEMO_MODE: 'false',
    SUPABASE_URL: supabaseUrl,
    HASH_PEPPER: randomSecret(32),
    AI_HASH_PEPPER: randomSecret(32),
    TOKEN_ENC_KEY_V1: randomKey32(),
    TOKEN_ENC_ACTIVE_VERSION: '1',
    CRON_SECRET: randomSecret(24),
    WEBHOOK_HMAC_SECRET: randomSecret(32),
    ADMIN_BFF_SECRET: randomSecret(32),
    ADMIN_GATEWAY_SECRET: randomSecret(32),
    RECOVERY_CODE_PEPPER: randomSecret(32),
    PII_LOOKUP_PEPPER: randomSecret(32),
    AUDIT_SUBJECT_PEPPER: randomSecret(32),
    AI_FIXTURE_PROVIDER_ENABLED: 'true',
    MAIL_MESSAGE_ID_DOMAIN: 'mail.dijitalasistan.app',
    // Google (test client; the mock verifies the same values).
    GOOGLE_CLOUD_PROJECT_ID: 'da-integration-test',
    GOOGLE_OAUTH_CLIENT_ID: '123456789012-integrationtest.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: randomSecret(24),
    GOOGLE_OAUTH_REDIRECT_URI: fn('oauth/google/callback'),
    GOOGLE_PUBSUB_TOPIC: 'projects/da-integration-test/topics/gmail-push',
    GOOGLE_PUBSUB_PUSH_AUDIENCE: fn('webhooks-google/gmail'),
    GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT: 'pubsub-push@da-integration-test.iam.gserviceaccount.com',
    GOOGLE_CALENDAR_WEBHOOK_URL: fn('webhooks-google/calendar'),
    GOOGLE_OAUTH_BASE_URL: `${mockUrl}/google-oauth`,
    GOOGLE_API_BASE_URL: mockUrl,
    // Microsoft (test certificate: the thumbprint is the SHA-256 of the test key's SPKI DER).
    MICROSOFT_CLIENT_ID: randomUUID(),
    MICROSOFT_CERT_PRIVATE_KEY: ms.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    MICROSOFT_CERT_THUMBPRINT_S256: createHash('sha256').update(msPublicDer).digest('base64url'),
    MICROSOFT_OAUTH_REDIRECT_URI: fn('oauth/microsoft/callback'),
    MICROSOFT_GRAPH_NOTIFICATION_URL: fn('webhooks-microsoft/notifications'),
    MICROSOFT_GRAPH_LIFECYCLE_URL: fn('webhooks-microsoft/lifecycle'),
    MS_LOGIN_BASE_URL: `${mockUrl}/ms-login`,
    MS_GRAPH_BASE_URL: `${mockUrl}/graph/v1.0`,
    MOCK_MS_CERT_PUBLIC_KEY: ms.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    // Sign in with Apple.
    APPLE_TEAM_ID: 'DATEAM0001',
    APPLE_SIWA_KEY_ID: 'DAKEY00001',
    APPLE_SIWA_PRIVATE_KEY: apple.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    APPLE_SIWA_NATIVE_CLIENT_ID: 'app.dijitalasistan.ios',
    APPLE_ID_BASE_URL: `${mockUrl}/apple`,
    // RevenueCat.
    REVENUECAT_PROJECT_ID: 'projintegration',
    REVENUECAT_API_V2_SECRET_KEY: `sk_${randomSecret(18)}`,
    REVENUECAT_WEBHOOK_AUTH: randomSecret(32),
    REVENUECAT_API_BASE_URL: `${mockUrl}/revenuecat/v2`,
    // Expo push (enhanced security) and embeddings.
    EXPO_ACCESS_TOKEN: randomSecret(24),
    EXPO_PUSH_BASE_URL: `${mockUrl}/expo`,
    VOYAGE_API_KEY: `pa-${randomSecret(18)}`,
    VOYAGE_API_BASE_URL: `${mockUrl}/voyage/v1`,
    DA_IT_MOCK_URL: mockUrl,
  };
}

function cleanup(): void {
  for (const child of children) {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
  void gateway?.close();
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(LOGS, { recursive: true });
  const mockUrl = `http://127.0.0.1:${MOCK_PORT}`;
  const jwtSecret = args.tier === 'c' ? randomSecret(40) : '';
  let supabaseUrl: string;
  let dbUrl: string;
  let secret = jwtSecret;
  let anonKey: string;
  let serviceKey: string;

  if (args.tier === 'c') {
    if (!args.reuseDb) {
      log('building the tier-C database');
      run('bash', [join(ROOT, 'scripts', 'db', 'tier-c.sh'), '--no-tests']);
    }
    const dbName = process.env.DA_TEST_DB ?? 'da_test';
    const port = process.env.PGPORT ?? '5432';
    const authPass = randomSecret(18);
    const itPass = randomSecret(18);
    superSql(
      `alter role authenticator with login password '${authPass}';` +
        `do $$ begin create role da_it login superuser; exception when duplicate_object then null; end $$;` +
        `alter role da_it with login superuser password '${itPass}';`,
    );
    dbUrl = `postgres://da_it:${itPass}@127.0.0.1:${port}/${dbName}`;
    const bin = ensurePostgrest();
    log(`starting PostgREST ${POSTGREST_VERSION} on ${POSTGREST_PORT}`);
    background('postgrest', bin, [], {
      ...process.env,
      PGRST_DB_URI: `postgres://authenticator:${authPass}@127.0.0.1:${port}/${dbName}`,
      PGRST_DB_SCHEMAS: 'public,admin_api',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_DB_EXTRA_SEARCH_PATH: 'public,extensions',
      PGRST_DB_MAX_ROWS: '1000',
      PGRST_DB_POOL: '20',
      PGRST_JWT_SECRET: jwtSecret,
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_SERVER_PORT: String(POSTGREST_PORT),
      PGRST_LOG_LEVEL: 'warn',
    });
    await waitFor(`http://127.0.0.1:${POSTGREST_PORT}/`, 'PostgREST');
    gateway = await startGateway({
      port: GATEWAY_PORT,
      postgrestUrl: `http://127.0.0.1:${POSTGREST_PORT}`,
      jwtSecret,
    });
    supabaseUrl = gateway.url;
    anonKey = roleKey('anon', jwtSecret, `${supabaseUrl}/auth/v1`);
    serviceKey = roleKey('service_role', jwtSecret, `${supabaseUrl}/auth/v1`);
  } else {
    const cli = join(ROOT, 'node_modules', '.bin', 'supabase');
    if (!args.noReset) {
      log('supabase db reset');
      run(cli, ['db', 'reset']);
    }
    const status = parseStatusEnv(run(cli, ['status', '-o', 'env']));
    supabaseUrl = status.get('API_URL') ?? 'http://127.0.0.1:54321';
    dbUrl = status.get('DB_URL') ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    secret = status.get('JWT_SECRET') ?? '';
    anonKey = status.get('ANON_KEY') ?? '';
    serviceKey = status.get('SERVICE_ROLE_KEY') ?? '';
    if (secret === '' || anonKey === '' || serviceKey === '')
      throw new Error('supabase status did not report JWT_SECRET / ANON_KEY / SERVICE_ROLE_KEY');
  }

  const env = baseEnv(supabaseUrl, mockUrl);
  const shared: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    DA_IT_TIER: args.tier,
    DA_IT_DB_URL: dbUrl,
    DA_IT_JWT_SECRET: secret,
    DA_IT_SKIP_TAGS: args.tier === 'c' ? 'needs:gotrue,needs:storage' : '',
    DENO_NO_UPDATE_CHECK: '1',
    NO_COLOR: '1',
  };
  if (await isUp(`${mockUrl}/__health`))
    throw new Error(`port ${MOCK_PORT} is already serving (a stale mock provider server?)`);
  log(`starting the mock provider server on ${mockUrl}`);
  background(
    'mock-providers',
    DENO,
    [
      'run',
      '--allow-net=127.0.0.1',
      '--allow-env',
      '--allow-read',
      '--config',
      DENO_CONFIG,
      MOCK_SERVER,
    ],
    shared,
  );
  await waitFor(`${mockUrl}/__health`, 'mock provider server');

  const testArgs = [
    'test',
    '--allow-net=127.0.0.1',
    '--allow-env',
    '--allow-read',
    '--no-prompt',
    '--config',
    DENO_CONFIG,
    ...(args.filter === null ? [] : ['--filter', args.filter]),
    ...(args.suites.length > 0 ? args.suites : [relative(ROOT, SUITES_DIR)]),
  ];
  log(`deno ${testArgs.join(' ')}`);
  const logFile = createWriteStream(join(LOGS, 'integration.log'));
  const child = spawn(DENO, testArgs, {
    cwd: ROOT,
    env: shared,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const tee = (chunk: Buffer, stream: NodeJS.WriteStream) => {
    const text = chunk.toString('utf8');
    output += text;
    logFile.write(text);
    stream.write(text);
  };
  child.stdout.on('data', (chunk: Buffer) => {
    tee(chunk, process.stdout);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    tee(chunk, process.stderr);
  });
  const code: number = await new Promise((resolve) => {
    child.on('close', (c) => {
      resolve(c ?? 1);
    });
  });
  const summary = formatSummary(summarizeDenoOutput(output));
  writeFileSync(join(LOGS, 'summary.txt'), `${summary}\n`);
  process.stdout.write(`\nintegration tier ${args.tier.toUpperCase()} summary\n${summary}\n`);
  return code;
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

main()
  .then((code) => {
    cleanup();
    process.exit(code);
  })
  .catch((error: unknown) => {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    cleanup();
    process.exit(1);
  });

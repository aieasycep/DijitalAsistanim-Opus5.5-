/**
 * Secret handling (SECURITY_AND_PRIVACY_PLAN §4, M§7):
 * QG-08 secrets in logs and `console.log` in production paths ·
 * QG-09 service-role / secret names in client-reachable app code (the bundle half is
 * `pnpm scan:bundles`, verified here as SG-1) ·
 * QG-12 insecure token storage in the mobile app ·
 * SG-1 the bundle scan and env split run in the CI `security` job.
 */
import { type Check, type Context, type Finding, grepLines, isTestPath, missing } from '../lib.ts';

const LOG_SECRET =
  /console\.(log|info|debug|warn|error)\([^)]*(token|secret|password|authorization|cookie|api[_-]?key|refresh|sb_secret)/i;
const CONSOLE_LOG = /\bconsole\.log\(/;

const SECRET_NAME =
  /service_role|sb_secret_|SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|TOKEN_ENC_KEY|REVENUECAT_API_V2_SECRET_KEY|WEBHOOK_HMAC_SECRET|ADMIN_SESSION_SECRET/;
/** App code that can reach a client bundle (§5.2 scope `apps/**`; server-only modules excluded). */
const CLIENT_CODE = /^apps\/(mobile\/(app|src)|(web|backoffice)\/src)\//;

const ASYNC_STORAGE_SECRET =
  /AsyncStorage\.(setItem|getItem|multiSet)\([^)]*(token|session|auth|refresh)/i;
const ASYNC_STORAGE_IMPORT = '@react-native-async-storage/async-storage';

/** Code shipped or run in production (tests, e2e, dev scripts and tooling configs excluded). */
function productionCode(ctx: Context, prefixes: readonly string[]): string[] {
  return ctx
    .select(prefixes, /\.(ts|tsx|js|jsx|mjs)$/)
    .filter(
      (f) =>
        !isTestPath(f) &&
        !/(^|\/)scripts\//.test(f) &&
        !/(^|\/)[\w.-]+\.config\.[cm]?[jt]s$/.test(f) &&
        !f.startsWith('packages/config/'),
    );
}

function serverOnly(ctx: Context, file: string): boolean {
  return file.includes('/server/') || /^import ['"]server-only['"]/m.test(ctx.read(file));
}

/** Repository-level wiring (checked when the root is a workspace: `package.json` present). */
function ciWiring(ctx: Context): Finding[] {
  const out: Finding[] = [];
  if (!ctx.exists('package.json')) return out;
  const pkg = ctx.read('package.json');
  const script = /"scan:bundles":\s*"([^"]*)"/.exec(pkg)?.[1] ?? '';
  if (!script.includes('check-env-split.ts') || !script.includes('scan-bundles.ts'))
    out.push(
      missing(
        'SG-1',
        'package.json',
        'scan:bundles must run check-env-split.ts and scan-bundles.ts',
      ),
    );
  const ci = ctx.read('.github/workflows/ci.yml');
  const security = /\n {2}security:\n([\s\S]*?)(?=\n {2}[\w-]+:\n|$)/.exec(ci)?.[1] ?? '';
  if (!/run:\s*pnpm scan:bundles/.test(security))
    out.push(
      missing(
        'SG-1',
        '.github/workflows/ci.yml',
        'the security job does not run pnpm scan:bundles',
      ),
    );
  return out;
}

export const secrets: Check = {
  ids: ['QG-08', 'QG-09', 'QG-12', 'SG-1'],
  title: 'Secrets in logs, secret names in client code, token storage, bundle scan wiring',
  run(ctx: Context): Finding[] {
    const prod = productionCode(ctx, ['apps/', 'packages/', 'supabase/functions/']);
    const mobile = ctx.select(['apps/mobile/'], /\.(ts|tsx)$/).filter((f) => !isTestPath(f));
    return [
      ...grepLines(ctx, prod, 'QG-08', (l) => LOG_SECRET.test(l) || CONSOLE_LOG.test(l)),
      ...grepLines(
        ctx,
        prod.filter((f) => CLIENT_CODE.test(f) && !serverOnly(ctx, f)),
        'QG-09',
        (l) => SECRET_NAME.test(l),
      ),
      ...grepLines(
        ctx,
        mobile,
        'QG-12',
        (l, f) =>
          ASYNC_STORAGE_SECRET.test(l) ||
          (/^apps\/mobile\/src\/lib\/(auth|storage)\//.test(f) && l.includes(ASYNC_STORAGE_IMPORT)),
      ),
      ...ciWiring(ctx),
    ];
  },
};

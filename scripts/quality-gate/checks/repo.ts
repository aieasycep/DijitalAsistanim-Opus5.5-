/**
 * Repository and supply-chain hygiene:
 * QG-20 `.env` hygiene (no tracked `.env*` but `.env.example`; its values empty) ·
 * SG-2 `.gitignore` coverage of credential files, and gitleaks (`pnpm secret-scan`) over the full
 * history in the CI `security` job · QG-22 ad / tracking SDK denylist over `pnpm-lock.yaml` ·
 * QG-23 every GitHub Action pinned to a full commit SHA with a `# vX.Y.Z` comment.
 */
import { type Check, type Context, type Finding, clip, missing } from '../lib.ts';

const GITIGNORE_REQUIRED: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /^\.env\*$|^\.env\.\*$/m, label: '.env*' },
  { pattern: /^!\.env\.example$/m, label: '!.env.example' },
  { pattern: /^\*\.p8$/m, label: '*.p8' },
  { pattern: /^\*\.pem$/m, label: '*.pem' },
  { pattern: /^google-services\.json$/m, label: 'google-services.json' },
  { pattern: /^GoogleService-Info\.plist$/m, label: 'GoogleService-Info.plist' },
];

const DENYLIST =
  /^\s{2}'?\/?(@react-native-firebase\/analytics|react-native-fbsdk[\w-]*|@amplitude\/[\w-]+|appsflyer[\w-]*|@adjust[\w-]*\/[\w-]+|adjust-web-sdk|react-native-adjust|react-native-appsflyer)@/;

const USES = /^\s*-?\s*uses:\s*([^\s#]+)\s*(#.*)?$/;
const PINNED = /^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/;
const VERSION_COMMENT = /^#\s*v\d+\.\d+\.\d+\s*$/;

function envHygiene(ctx: Context): Finding[] {
  const out: Finding[] = [];
  for (const f of ctx.tracked()) {
    const name = f.split('/').at(-1) ?? '';
    if (f.startsWith('scripts/quality-gate/')) continue;
    if (name.startsWith('.env') && name !== '.env.example')
      out.push(missing('QG-20', f, 'tracked env file (only .env.example may be committed)'));
    if (name === '.env.example') {
      ctx
        .read(f)
        .split('\n')
        .forEach((line, i) => {
          const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
          const value = (m?.[2] ?? '').replace(/\s+#.*$/, '').trim();
          if (m !== null && value !== '' && value !== '""' && value !== "''")
            out.push({ id: 'QG-20', file: f, line: i + 1, match: `${m[1] ?? ''} has a value` });
        });
    }
  }
  return out;
}

/** Repository-level wiring (checked when the root is a workspace: `package.json` present). */
function secretScan(ctx: Context): Finding[] {
  const out: Finding[] = [];
  if (!ctx.exists('package.json')) return out;
  const ignore = ctx.read('.gitignore');
  for (const req of GITIGNORE_REQUIRED)
    if (!req.pattern.test(ignore)) out.push(missing('SG-2', '.gitignore', `missing ${req.label}`));
  const pkg = ctx.read('package.json');
  if (!/"secret-scan":\s*"node scripts\/security\/secret-scan\.ts/.test(pkg))
    out.push(
      missing('SG-2', 'package.json', 'no secret-scan script (gitleaks over the full history)'),
    );
  const ci = ctx.read('.github/workflows/ci.yml');
  const security = /\n {2}security:\n([\s\S]*?)(?=\n {2}[\w-]+:\n|$)/.exec(ci)?.[1] ?? '';
  if (!/run:\s*pnpm secret-scan/.test(security) || !/fetch-depth:\s*0/.test(security))
    out.push(
      missing(
        'SG-2',
        '.github/workflows/ci.yml',
        'the security job does not run pnpm secret-scan over the full history',
      ),
    );
  return out;
}

function lockfile(ctx: Context): Finding[] {
  const out: Finding[] = [];
  ctx
    .read('pnpm-lock.yaml')
    .split('\n')
    .forEach((line, i) => {
      if (DENYLIST.test(line))
        out.push({ id: 'QG-22', file: 'pnpm-lock.yaml', line: i + 1, match: clip(line) });
    });
  return out;
}

function actions(ctx: Context): Finding[] {
  const out: Finding[] = [];
  for (const f of ctx.select(['.github/workflows/', '.github/actions/'], /\.ya?ml$/)) {
    ctx
      .read(f)
      .split('\n')
      .forEach((line, i) => {
        const m = USES.exec(line);
        if (m === null) return;
        const ref = m[1] ?? '';
        if (ref.startsWith('./') || ref.startsWith('docker://')) return;
        if (!PINNED.test(ref) || !VERSION_COMMENT.test(m[2] ?? ''))
          out.push({ id: 'QG-23', file: f, line: i + 1, match: clip(line) });
      });
  }
  return out;
}

export const repo: Check = {
  ids: ['QG-20', 'SG-2', 'QG-22', 'QG-23'],
  title: 'Env hygiene, credential ignores and gitleaks wiring, SDK denylist, pinned actions',
  run(ctx: Context): Finding[] {
    return [...envHygiene(ctx), ...secretScan(ctx), ...lockfile(ctx), ...actions(ctx)];
  },
};

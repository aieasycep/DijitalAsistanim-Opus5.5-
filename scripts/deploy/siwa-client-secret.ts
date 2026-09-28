/**
 * Sign in with Apple web-flow client secret (KPL-49, STORE_CHECKLIST; INTEGRATION_PLAN §6.2 "Web
 * secret rotation"). Android and web sign in with Apple through Supabase Auth's OAuth flow, whose
 * client secret is an ES256 JWT that Apple accepts for at most six months. This script mints it
 * from the SIWA key and, with `--apply`, stores it on the hosted project through the Supabase
 * Management API:
 *
 * - claims: `iss` = `APPLE_TEAM_ID`, `sub` = `APPLE_SIWA_SERVICES_ID`, `aud` =
 *   `https://appleid.apple.com`, `iat` = now, `exp` = now + `--days` (default and maximum 180);
 *   header `alg` ES256, `kid` = `APPLE_SIWA_KEY_ID`; signed with `APPLE_SIWA_PRIVATE_KEY` (the
 *   `.p8` PKCS#8 PEM, literal `\n` escapes accepted);
 * - the signature is verified with the key's public half before anything is sent;
 * - `--apply` (needs `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`):
 *   `PATCH /v1/projects/{ref}/config/auth {external_apple_secret}`, then the Edge secret
 *   `APPLE_SIWA_WEB_SECRET_NOT_AFTER` (`POST /v1/projects/{ref}/secrets`) so System Health shows
 *   the new expiry;
 * - `--github-env <file>` (the deploy job): masks the token (`::add-mask::`) and appends
 *   `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET` and `APPLE_SIWA_WEB_SECRET_NOT_AFTER` for the later
 *   `supabase config push`, which would otherwise restore a stale stored secret;
 * - `--github-output <file>`: appends `not_after=<date>` (no secret).
 *
 * Without `--apply` / `--github-env` it is a dry run. It never prints the private key or the
 * token: the report is the public claims only. A missing input is an "External credential
 * required" error listing the variable names.
 *
 * Usage: node scripts/deploy/siwa-client-secret.ts [--days N] [--apply] [--github-env FILE]
 *                                                  [--github-output FILE]
 * Exit codes: 0 ok, 1 an API call failed, 2 missing or invalid input.
 */
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const APPLE_AUDIENCE = 'https://appleid.apple.com';
/** Apple rejects a client secret whose `exp` is more than 15 777 000 s (≈ 182.6 days) ahead. */
export const MAX_DAYS = 180;
export const MANAGEMENT_API = 'https://api.supabase.com';
const DAY_S = 86_400;

export const SIWA_KEYS = [
  'APPLE_TEAM_ID',
  'APPLE_SIWA_KEY_ID',
  'APPLE_SIWA_PRIVATE_KEY',
  'APPLE_SIWA_SERVICES_ID',
] as const;
export const APPLY_KEYS = ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF'] as const;

/** Missing or invalid input (exit 2); the message names variables and rules, never values. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

export interface SiwaConfig {
  readonly teamId: string;
  readonly keyId: string;
  readonly servicesId: string;
  readonly privateKey: KeyObject;
}

type Env = Readonly<Record<string, string | undefined>>;

function value(env: Env, key: string): string {
  return (env[key] ?? '').trim();
}

/** Names of the given keys that are unset or blank. */
export function missingKeys(env: Env, keys: readonly string[]): string[] {
  return keys.filter((key) => value(env, key) === '');
}

/** Reads and validates the SIWA inputs; errors name variables and rules, never values. */
export function readSiwaConfig(env: Env): SiwaConfig {
  const missing = missingKeys(env, SIWA_KEYS);
  if (missing.length > 0) {
    throw new InputError(`External credential required: ${missing.join(', ')}`);
  }
  const invalid: string[] = [];
  const teamId = value(env, 'APPLE_TEAM_ID');
  const keyId = value(env, 'APPLE_SIWA_KEY_ID');
  const servicesId = value(env, 'APPLE_SIWA_SERVICES_ID');
  if (!/^[A-Z0-9]{10}$/.test(teamId)) invalid.push('APPLE_TEAM_ID (10 characters, A-Z 0-9)');
  if (!/^[A-Z0-9]{10}$/.test(keyId)) invalid.push('APPLE_SIWA_KEY_ID (10 characters, A-Z 0-9)');
  if (!/^[A-Za-z0-9.-]+$/.test(servicesId))
    invalid.push('APPLE_SIWA_SERVICES_ID (a Services ID such as app.example.web)');
  let privateKey: KeyObject | null = null;
  try {
    privateKey = createPrivateKey(value(env, 'APPLE_SIWA_PRIVATE_KEY').replace(/\\n/g, '\n'));
    const details = privateKey.asymmetricKeyDetails;
    if (privateKey.asymmetricKeyType !== 'ec' || details?.namedCurve !== 'prime256v1') {
      privateKey = null;
    }
  } catch {
    privateKey = null;
  }
  if (privateKey === null) invalid.push('APPLE_SIWA_PRIVATE_KEY (a P-256 .p8 PEM)');
  if (invalid.length > 0 || privateKey === null) {
    throw new InputError(`Invalid input: ${invalid.join('; ')}`);
  }
  return { teamId, keyId, servicesId, privateKey };
}

export interface ClientSecretClaims {
  readonly iss: string;
  readonly sub: string;
  readonly aud: string;
  readonly iat: number;
  readonly exp: number;
}

export interface MintedSecret {
  readonly token: string;
  readonly header: { readonly alg: 'ES256'; readonly kid: string };
  readonly claims: ClientSecretClaims;
  /** `exp` as a date (`APPLE_SIWA_WEB_SECRET_NOT_AFTER`, ISO `YYYY-MM-DD`). */
  readonly notAfter: string;
}

const b64url = (data: Buffer | string): string => Buffer.from(data).toString('base64url');

/** Mints the ES256 client secret; `days` is 1…180. */
export function mintClientSecret(
  config: SiwaConfig,
  options: { readonly now?: Date; readonly days?: number } = {},
): MintedSecret {
  const days = options.days ?? MAX_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new InputError(`Invalid input: --days must be an integer from 1 to ${MAX_DAYS}`);
  }
  const iat = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const header = { alg: 'ES256', kid: config.keyId } as const;
  const claims: ClientSecretClaims = {
    iss: config.teamId,
    iat,
    exp: iat + days * DAY_S,
    aud: APPLE_AUDIENCE,
    sub: config.servicesId,
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = sign('sha256', Buffer.from(input), {
    key: config.privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return {
    token: `${input}.${b64url(signature)}`,
    header,
    claims,
    notAfter: new Date(claims.exp * 1000).toISOString().slice(0, 10),
  };
}

/** Verifies an ES256 JWT with the public key; returns the claims or null. */
export function verifyClientSecret(token: string, key: KeyObject): ClientSecretClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  const ok = verify(
    'sha256',
    Buffer.from(`${header}.${payload}`),
    { key: createPublicKey(key), dsaEncoding: 'ieee-p1363' },
    Buffer.from(signature, 'base64url'),
  );
  if (!ok) return null;
  try {
    const parsed = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as {
      alg?: unknown;
    };
    if (parsed.alg !== 'ES256') return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ClientSecretClaims;
  } catch {
    return null;
  }
}

/** The public report (no token, no key). */
export function describe(minted: MintedSecret): string[] {
  const days = Math.round((minted.claims.exp - minted.claims.iat) / DAY_S);
  return [
    `alg=${minted.header.alg} kid=${minted.header.kid}`,
    `iss=${minted.claims.iss} sub=${minted.claims.sub} aud=${minted.claims.aud}`,
    `iat=${new Date(minted.claims.iat * 1000).toISOString()}`,
    `exp=${new Date(minted.claims.exp * 1000).toISOString()} (${String(days)} days; not_after=${minted.notAfter})`,
  ];
}

export interface ApplyInput {
  readonly accessToken: string;
  readonly projectRef: string;
  readonly minted: MintedSecret;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
}

async function call(
  input: ApplyInput,
  method: string,
  path: string,
  body: unknown,
  what: string,
): Promise<void> {
  const run = input.fetch ?? fetch;
  const response = await run(`${input.baseUrl ?? MANAGEMENT_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    // The status alone: an error body could echo the request.
    throw new Error(`${what} failed: HTTP ${String(response.status)}`);
  }
}

/** Stores the secret on the Apple provider and the expiry as an Edge secret. */
export async function applyToSupabase(input: ApplyInput): Promise<void> {
  if (!/^[a-z0-9]{20}$/.test(input.projectRef)) {
    throw new InputError('Invalid input: SUPABASE_PROJECT_REF (20 lowercase letters or digits)');
  }
  const ref = encodeURIComponent(input.projectRef);
  await call(
    input,
    'PATCH',
    `/v1/projects/${ref}/config/auth`,
    { external_apple_secret: input.minted.token },
    'Supabase Auth Apple provider update',
  );
  await call(
    input,
    'POST',
    `/v1/projects/${ref}/secrets`,
    [{ name: 'APPLE_SIWA_WEB_SECRET_NOT_AFTER', value: input.minted.notAfter }],
    'Edge secret APPLE_SIWA_WEB_SECRET_NOT_AFTER update',
  );
}

/** GitHub Actions environment lines; the token is masked first (the command line is not logged). */
export function githubEnvLines(minted: MintedSecret): { mask: string; env: string } {
  return {
    mask: `::add-mask::${minted.token}`,
    env: `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET=${minted.token}\nAPPLE_SIWA_WEB_SECRET_NOT_AFTER=${minted.notAfter}\n`,
  };
}

export interface CliOptions {
  readonly days: number;
  readonly apply: boolean;
  readonly githubEnv: string | null;
  readonly githubOutput: string | null;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const out = { days: MAX_DAYS, apply: false, githubEnv: null, githubOutput: null } as {
    days: number;
    apply: boolean;
    githubEnv: string | null;
    githubOutput: string | null;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--'))
        throw new InputError(`Invalid input: ${arg} needs a value`);
      return v;
    };
    if (arg === '--apply') out.apply = true;
    else if (arg === '--days') out.days = Number(next());
    else if (arg === '--github-env') out.githubEnv = next();
    else if (arg === '--github-output') out.githubOutput = next();
    else throw new InputError(`Invalid input: unknown argument ${String(arg)}`);
  }
  return out;
}

export async function run(
  argv: readonly string[],
  env: Env,
  io: {
    readonly log: (line: string) => void;
    readonly append: (file: string, text: string) => void;
    readonly fetch?: typeof fetch;
  },
): Promise<number> {
  try {
    const options = parseArgs(argv);
    const config = readSiwaConfig(env);
    const missingApply = options.apply ? missingKeys(env, APPLY_KEYS) : [];
    if (missingApply.length > 0) {
      throw new InputError(`External credential required: ${missingApply.join(', ')}`);
    }
    const minted = mintClientSecret(config, { days: options.days });
    if (verifyClientSecret(minted.token, config.privateKey) === null) {
      throw new Error('the minted client secret does not verify with the key');
    }
    for (const line of describe(minted)) io.log(line);
    if (options.githubOutput !== null)
      io.append(options.githubOutput, `not_after=${minted.notAfter}\n`);
    if (options.githubEnv !== null) {
      const lines = githubEnvLines(minted);
      io.log(lines.mask);
      io.append(options.githubEnv, lines.env);
      io.log('SUPABASE_AUTH_EXTERNAL_APPLE_SECRET exported to the job environment (masked)');
    }
    if (options.apply) {
      await applyToSupabase({
        accessToken: value(env, 'SUPABASE_ACCESS_TOKEN'),
        projectRef: value(env, 'SUPABASE_PROJECT_REF'),
        minted,
        ...(io.fetch === undefined ? {} : { fetch: io.fetch }),
      });
      io.log(
        `Supabase Auth Apple provider secret updated; APPLE_SIWA_WEB_SECRET_NOT_AFTER=${minted.notAfter}`,
      );
    } else if (options.githubEnv === null) {
      io.log('dry run: nothing was sent (pass --apply to update the hosted project)');
    }
    return 0;
  } catch (error) {
    io.log(`error: ${error instanceof Error ? error.message : String(error)}`);
    return error instanceof InputError ? 2 : 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await run(process.argv.slice(2), process.env, {
    log: (line) => {
      console.info(line);
    },
    append: (file, text) => {
      appendFileSync(file, text);
    },
  });
}

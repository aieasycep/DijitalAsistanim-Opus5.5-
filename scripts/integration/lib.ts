/**
 * Pure helpers of the integration runner (TEST_PLAN §6, §15; IMPLEMENTATION_PLAN T-12.01): test
 * secret generation, HS256 JWT minting for the local PostgREST / Supabase stack, `supabase status`
 * parsing and the per-suite summary of a `deno test` run. No I/O here, so the unit tests cover it.
 */
import { createHmac, randomBytes } from 'node:crypto';

export type Tier = 'a' | 'c';

export interface RunnerArgs {
  readonly tier: Tier;
  /** `deno test --filter` pattern. */
  readonly filter: string | null;
  /** Keep the tier-C database from the previous run (skip `tier-c.sh`). */
  readonly reuseDb: boolean;
  /** Skip `supabase db reset` (tier A). */
  readonly noReset: boolean;
  /** Suite files (relative to the repo root); empty = every suite. */
  readonly suites: readonly string[];
}

export function parseArgs(argv: readonly string[]): RunnerArgs {
  let tier: Tier = 'a';
  let filter: string | null = null;
  let reuseDb = false;
  let noReset = false;
  const suites: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tier') {
      const value = argv[++i];
      if (value !== 'a' && value !== 'c') throw new Error(`--tier expects a or c, got ${value}`);
      tier = value;
    } else if (arg === '--filter') {
      filter = argv[++i] ?? null;
    } else if (arg === '--reuse-db') {
      reuseDb = true;
    } else if (arg === '--no-reset') {
      noReset = true;
    } else if (arg !== undefined && !arg.startsWith('--')) {
      suites.push(arg);
    } else if (arg !== undefined) {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { tier, filter, reuseDb, noReset, suites };
}

/** URL-safe random secret (`bytes` of entropy). */
export function randomSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** 32 random bytes as standard base64 (the `TOKEN_ENC_KEY_V{n}` format). */
export function randomKey32(): string {
  return randomBytes(32).toString('base64');
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** HS256 JWT (the local Supabase / PostgREST signing scheme). */
export function mintHs256(claims: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${b64url(signature)}`;
}

/** Verifies an HS256 JWT; returns its claims or null (bad signature, malformed or expired). */
export function verifyHs256(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];
  const expected = b64url(createHmac('sha256', secret).update(`${header}.${payload}`).digest());
  if (expected.length !== signature.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const head = JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as {
      alg?: string;
    };
    if (head.alg !== 'HS256') return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (typeof claims.exp === 'number' && claims.exp < nowSeconds) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Long-lived API-role keys (`anon`, `service_role`) signed with the local JWT secret. */
export function roleKey(role: 'anon' | 'service_role', secret: string, issuer: string): string {
  const iat = Math.floor(Date.now() / 1000);
  return mintHs256({ iss: issuer, role, iat, exp: iat + 6 * 3600 }, secret);
}

/** `supabase status -o env` output → key/value map (quotes stripped). */
export function parseStatusEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match?.[1] === undefined) continue;
    out.set(match[1], (match[2] ?? '').replace(/^"(.*)"$/, '$1'));
  }
  return out;
}

export interface SuiteCounts {
  passed: number;
  failed: number;
  ignored: number;
}

/**
 * Per-suite counts from the default `deno test` reporter: `running N tests from ./x.test.ts`, then
 * one `<name> ... ok | FAILED | ignored` line per test (steps are indented and not counted).
 */
export function summarizeDenoOutput(output: string): Map<string, SuiteCounts> {
  const suites = new Map<string, SuiteCounts>();
  let current: SuiteCounts | null = null;
  // ANSI colour codes (ESC [ … m) are stripped before matching.
  const clean = output.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
  for (const line of clean.split('\n')) {
    const header = /^running \d+ tests? from (\S+)/.exec(line);
    if (header?.[1] !== undefined) {
      current = { passed: 0, failed: 0, ignored: 0 };
      suites.set(header[1].replace(/^\.\//, ''), current);
      continue;
    }
    if (current === null || /^\s/.test(line)) continue;
    const result = / \.\.\. (ok|FAILED|ignored)\b/.exec(line);
    if (result?.[1] === 'ok') current.passed++;
    else if (result?.[1] === 'FAILED') current.failed++;
    else if (result?.[1] === 'ignored') current.ignored++;
  }
  return suites;
}

export function formatSummary(suites: Map<string, SuiteCounts>): string {
  const rows = [...suites.entries()].sort(([a], [b]) => a.localeCompare(b));
  const width = Math.max(10, ...rows.map(([name]) => name.length));
  const lines = [`${'suite'.padEnd(width)}  passed  skipped  failed`];
  const total: SuiteCounts = { passed: 0, failed: 0, ignored: 0 };
  for (const [name, c] of rows) {
    total.passed += c.passed;
    total.failed += c.failed;
    total.ignored += c.ignored;
    lines.push(
      `${name.padEnd(width)}  ${String(c.passed).padStart(6)}  ${String(c.ignored).padStart(7)}  ${String(c.failed).padStart(6)}`,
    );
  }
  lines.push(
    `${'total'.padEnd(width)}  ${String(total.passed).padStart(6)}  ${String(total.ignored).padStart(7)}  ${String(total.failed).padStart(6)}`,
  );
  return lines.join('\n');
}

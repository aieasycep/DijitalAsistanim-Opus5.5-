/**
 * Enum parity (IMPLEMENTATION_PLAN T-2.25, MASTER_PLAN R-20): the Postgres enums of schema
 * `public` in a migrated database must equal `DB_ENUMS` of packages/domain/src/enums.ts, name
 * for name and value for value, in declaration order. Exits 1 on any difference.
 *
 * Database: DA_PARITY_DB_URL (any libpq URL, e.g. the local stack), otherwise the tier-C test
 * database through scripts/db/psql.sh (run `pnpm db:test:c` or `bash scripts/db/tier-c.sh
 * --no-tests` first).
 *
 * Usage: node scripts/db/enum-parity.ts
 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DB_ENUMS } from '../../packages/domain/src/enums.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const QUERY = `select coalesce(json_object_agg(x.typname, x.labels order by x.typname), '{}')
  from (select t.typname, json_agg(e.enumlabel order by e.enumsortorder) as labels
        from pg_catalog.pg_type t join pg_catalog.pg_enum e on e.enumtypid = t.oid
        where t.typnamespace = 'public'::regnamespace
        group by t.typname) as x`;

function databaseEnums(): Record<string, string[]> {
  const url = process.env.DA_PARITY_DB_URL;
  const output = url
    ? execFileSync('psql', [url, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', QUERY], {
        encoding: 'utf8',
      })
    : execFileSync(
        'bash',
        [join(ROOT, 'scripts/db/psql.sh'), '-At', '-v', 'ON_ERROR_STOP=1', '-c', QUERY],
        {
          encoding: 'utf8',
        },
      );
  return JSON.parse(output.trim()) as Record<string, string[]>;
}

export function compareEnums(
  db: Record<string, readonly string[]>,
  domain: Record<string, readonly string[]>,
): string[] {
  const problems: string[] = [];
  for (const name of Object.keys(domain).sort()) {
    const expected = domain[name] ?? [];
    const actual = db[name];
    if (!actual) {
      problems.push(`enum ${name}: in @da/domain DB_ENUMS but missing in the database`);
      continue;
    }
    if (expected.join('|') !== actual.join('|')) {
      problems.push(
        `enum ${name}: database [${actual.join(', ')}] ≠ domain [${expected.join(', ')}]`,
      );
    }
  }
  for (const name of Object.keys(db).sort()) {
    if (!(name in domain))
      problems.push(`enum ${name}: in the database but missing in @da/domain DB_ENUMS`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = compareEnums(databaseEnums(), DB_ENUMS);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    console.error(`enum parity failed: ${problems.length} difference(s)`);
    process.exit(1);
  }
  console.info(
    `enum parity ok: ${Object.keys(DB_ENUMS).length} enums match packages/domain/src/enums.ts`,
  );
}

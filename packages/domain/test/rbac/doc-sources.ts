/**
 * Test-only helpers that read the binding plan documents and the SQL migrations, so parity tests
 * compare the TypeScript sources with what the documents and the database actually say.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

export function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * The text of a Markdown section: from the first heading line matching `heading` up to the next
 * heading of the same or a higher level.
 */
export function markdownSection(markdown: string, heading: RegExp): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => /^#{1,6} /.test(line) && heading.test(line));
  if (start < 0) throw new Error(`section not found: ${heading.source}`);
  const level = /^(#+)/.exec(lines[start] ?? '')?.[1]?.length ?? 1;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const match = /^(#+) /.exec(lines[i] ?? '');
    if (match?.[1] !== undefined && match[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** Rows (cells trimmed) of the first Markdown table whose header row satisfies `isHeader`. */
export function markdownTable(section: string, isHeader: (cells: string[]) => boolean): string[][] {
  const lines = section.split('\n');
  const split = (line: string): string[] =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
  const headerIndex = lines.findIndex(
    (line) => line.trim().startsWith('|') && isHeader(split(line)),
  );
  if (headerIndex < 0) throw new Error('table header not found');
  const rows: string[][] = [split(lines[headerIndex] ?? '')];
  for (let i = headerIndex + 2; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!line.trim().startsWith('|')) break;
    rows.push(split(line));
  }
  return rows;
}

/** Admin migration files (`supabase/migrations/*admin*.sql`), sorted by name. */
export function adminMigrationFiles(): string[] {
  const dir = join(REPO_ROOT, 'supabase', 'migrations');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.includes('admin') && name.endsWith('.sql'))
    .sort()
    .map((name) => join('supabase', 'migrations', name));
}

/**
 * Generates `assets/licenses.json` for the "Açık kaynak lisansları" sheet (M-SET-74) from
 * `pnpm licenses list --prod --json --filter @da/mobile`, plus the bundled fonts and icon set.
 * Entries are `{name, version, license, repository}` sorted by name; the full license text is
 * reachable through each package's repository link. Run with `pnpm --filter @da/mobile licenses`
 * (also from the EAS post-install hook) and commit the result.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'assets', 'licenses.json');

const CURATED = [
  {
    name: 'Geist',
    version: '1.x',
    license: 'OFL-1.1',
    repository: 'https://github.com/vercel/geist-font',
    kind: 'font',
  },
  {
    name: 'Lora',
    version: '3.x',
    license: 'OFL-1.1',
    repository: 'https://github.com/cyrealtype/Lora-Cyrillic',
    kind: 'font',
  },
  {
    name: 'Material Symbols',
    version: '0.47.5',
    license: 'Apache-2.0',
    repository: 'https://github.com/google/material-design-icons',
    kind: 'icons',
  },
];

const raw = execFileSync(
  'pnpm',
  ['licenses', 'list', '--prod', '--json', '--filter', '@da/mobile'],
  {
    cwd: join(HERE, '..'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  },
);
const byLicense = JSON.parse(raw);
const packages = [];
for (const [license, list] of Object.entries(byLicense)) {
  for (const pkg of list) {
    if (pkg.name.startsWith('@da/')) continue;
    const version = [...pkg.versions].sort().at(-1) ?? '';
    packages.push({
      name: pkg.name,
      version,
      license,
      ...(typeof pkg.homepage === 'string' && pkg.homepage.startsWith('https://')
        ? { repository: pkg.homepage }
        : {}),
      kind: 'package',
    });
  }
}
packages.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(OUT, `${JSON.stringify([...CURATED, ...packages], null, 1)}\n`);
console.info(`licenses.json: ${String(packages.length)} packages`);

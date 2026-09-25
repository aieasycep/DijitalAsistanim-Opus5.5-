/**
 * Static check of the Maestro suite (IMPLEMENTATION_PLAN T-8.30; TEST_PLAN §0.2, §0.3, §1, §9).
 * The flows cannot run in the container (no emulator / simulator), so this proves what can be
 * proven without a device:
 *
 * - every YAML file under `apps/mobile/.maestro` parses; flows and subflows are a config document
 *   (`appId: com.dijitalasistan.app`) followed by a command list;
 * - only the Maestro 2.10 commands TEST_PLAN §1 lists are used (nested `runFlow.commands` too);
 * - every `id:` selector names a `testID` that exists in `apps/mobile/{app,src}` (template
 *   testIDs such as `approvals.card.${model.id}` match any key; `${…}` in a flow is a key);
 * - `${output.t.<ns>.<key>}` copy exists in the Turkish catalog and needs no ICU arguments; literal
 *   text is Turkish catalog copy (ICU arguments match anything) or demo-canon data from the seed;
 * - `runFlow` / `runScript` / `addMedia` files resolve; flows carry their folder tag and a
 *   platform tag, and `setAirplaneMode` flows are Android-only;
 * - every E2E-M, E2E-A…J, E2E-S and TST-E2E-M ID in TEST_PLAN §9 has its flow file, whose `name`
 *   starts with the ID.
 *
 * Usage: node scripts/mobile/maestro-lint.ts   (exit 1 with one line per problem)
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAllDocuments } from 'yaml';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The `e2e` build variant (INTEGRATION_PLAN §0.5 identifiers: `.e2e` suffix, scheme `-e2e`). */
export const APP_ID = 'com.dijitalasistan.app.e2e';

/** TEST_PLAN §1 "Maestro flows use only documented commands". */
export const ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  'launchApp',
  'openLink',
  'tapOn',
  'inputText',
  'eraseText',
  'assertVisible',
  'assertNotVisible',
  'scrollUntilVisible',
  'swipe',
  'back',
  'hideKeyboard',
  'extendedWaitUntil',
  'waitForAnimationToEnd',
  'runFlow',
  'runScript',
  'takeScreenshot',
  'addMedia',
  'setAirplaneMode',
  'setDarkMode',
  'assertDarkMode',
  'assertLightMode',
]);

const FOLDER_TAG: Readonly<Record<string, string>> = {
  m102: 'm102',
  acceptance: 'acceptance',
  screens: 'screens',
  security: 'security',
};

export interface Problem {
  readonly file: string;
  readonly message: string;
}

// ── testIDs in the app ───────────────────────────────────────────────────────────────────────

function walkFiles(dir: string, accept: (path: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walkFiles(path, accept, out);
    else if (accept(path)) out.push(path);
  }
  return out;
}

const TESTID_PATTERNS = [
  /testID=\{?\s*(["'`])((?:(?!\1).)+)\1/g,
  /testID\s*\?\?\s*(["'`])((?:(?!\1).)+)\1/g,
  /\btestID:\s*(["'`])((?:(?!\1).)+)\1/g,
];

/** Literal and template testIDs of the given source files (`${…}` kept as written). */
export function extractTestIds(source: string): string[] {
  const found = new Set<string>();
  for (const pattern of TESTID_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const value = match[2];
      if (value !== undefined && value.trim() !== '') found.add(value);
    }
  }
  return [...found];
}

export function collectAppTestIds(root: string = ROOT): string[] {
  const app = join(root, 'apps', 'mobile');
  const files = [join(app, 'app'), join(app, 'src')].flatMap((dir) =>
    walkFiles(dir, (p) => /\.(tsx|ts)$/.test(p) && !/\.test\.tsx?$/.test(p)),
  );
  const ids = new Set<string>();
  for (const file of files)
    for (const id of extractTestIds(readFileSync(file, 'utf8'))) ids.add(id);
  return [...ids].sort();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A source testID (possibly a template) as an anchored regular expression. */
export function testIdRegExp(id: string): RegExp {
  const parts = id.split(/\$\{[^}]*\}/);
  return new RegExp(`^${parts.map(escapeRegExp).join('[^\\s]+')}$`);
}

/** True when the flow selector id (with `${…}` Maestro variables) names an app testID. */
export function matchesTestId(selector: string, ids: readonly string[]): boolean {
  const sample = selector.replace(/\$\{[^}]*\}/g, 'k0');
  return ids.some((id) => (id.includes('${') ? testIdRegExp(id).test(sample) : id === sample));
}

// ── Catalog copy ─────────────────────────────────────────────────────────────────────────────

type Catalog = Readonly<Record<string, string>>;

export function loadTrCatalog(root: string = ROOT): Catalog {
  const dir = join(root, 'packages', 'i18n', 'messages', 'tr');
  const flat: Record<string, string> = {};
  const walk = (node: unknown, prefix: string) => {
    if (typeof node === 'string') {
      flat[prefix] = node;
      return;
    }
    if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node))
        walk(value, prefix ? `${prefix}.${key}` : key);
    }
  };
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    walk(JSON.parse(readFileSync(join(dir, file), 'utf8')), file.replace(/\.json$/, ''));
  }
  return flat;
}

/** ICU message → regular expression in which every argument matches any text. */
export function icuRegExp(message: string): RegExp {
  let source = message;
  // Innermost `{…}` groups first (plural / select branches nest).
  for (let guard = 0; guard < 20 && /\{[^{}]*\}/.test(source); guard += 1) {
    source = source.replace(/\{[^{}]*\}/g, '\u0000');
  }
  return new RegExp(`^${source.split('\u0000').map(escapeRegExp).join('.+')}$`, 's');
}

/** Letters and digits outside the ICU arguments. */
function literalLength(message: string): number {
  return icuRegExp(message)
    .source.replace(/\.\+/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '').length;
}

const T_REF = /^\$\{output\.t\.([A-Za-z0-9_.-]+)\}$/;
const REGEX_HINT = /\.\*|\\d|\\s|\[[^\]]*\]|\(\?|\|/;

export interface TextContext {
  readonly catalog: Catalog;
  readonly catalogValues: readonly string[];
  readonly catalogPatterns: readonly RegExp[];
  readonly seedText: string;
}

export function textContext(root: string = ROOT): TextContext {
  const catalog = loadTrCatalog(root);
  const values = Object.values(catalog);
  const seedDir = join(root, 'supabase', 'seed', 'demo');
  const seedText = existsSync(seedDir)
    ? readdirSync(seedDir)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => readFileSync(join(seedDir, f), 'utf8'))
        .join('\n')
        .replace(/''/g, "'") // SQL-escaped quotes read as the data they store
    : '';
  return {
    catalog,
    catalogValues: values,
    // Messages that are mostly arguments ("{name}", "{count} · {when}") would match any text.
    catalogPatterns: values.filter((v) => v.includes('{') && literalLength(v) >= 6).map(icuRegExp),
    seedText,
  };
}

/** Problem text for one text selector, or null when it is known copy or data. */
export function checkText(text: string, ctx: TextContext): string | null {
  const ref = T_REF.exec(text);
  if (ref !== null) {
    const key = ref[1] ?? '';
    const value = ctx.catalog[key];
    if (value === undefined) return `unknown catalog key output.t.${key}`;
    if (value.includes('{')) return `output.t.${key} needs ICU arguments; assert it with a pattern`;
    return null;
  }
  if (text.includes('${output.')) return null; // harness-computed (ids, expect, otp)
  if (REGEX_HINT.test(text)) return null; // an explicit pattern
  if (ctx.catalogValues.some((v) => v === text || v.includes(text))) return null;
  if (ctx.catalogPatterns.some((p) => p.test(text))) return null;
  if (ctx.seedText.includes(text)) return null;
  return `text "${text}" is neither Turkish catalog copy nor demo-canon data`;
}

// ── Flow files ───────────────────────────────────────────────────────────────────────────────

const SELECTOR_COMMANDS = new Set(['tapOn', 'assertVisible', 'assertNotVisible']);

interface Visit {
  readonly file: string;
  readonly ids: readonly string[];
  readonly text: TextContext;
  readonly problems: Problem[];
  readonly commands: Set<string>;
}

function report(visit: Visit, message: string): void {
  visit.problems.push({ file: visit.file, message });
}

function checkSelector(selector: unknown, where: string, visit: Visit): void {
  if (typeof selector === 'string') {
    const problem = checkText(selector, visit.text);
    if (problem !== null) report(visit, `${where}: ${problem}`);
    return;
  }
  if (selector === null || typeof selector !== 'object') return;
  const record = selector as Record<string, unknown>;
  if (typeof record.id === 'string' && !matchesTestId(record.id, visit.ids)) {
    report(visit, `${where}: id "${record.id}" is not a testID in apps/mobile/{app,src}`);
  }
  if (typeof record.text === 'string') {
    const problem = checkText(record.text, visit.text);
    if (problem !== null) report(visit, `${where}: ${problem}`);
  }
  for (const nested of ['below', 'above', 'leftOf', 'rightOf', 'containsChild', 'childOf']) {
    if (nested in record) checkSelector(record[nested], `${where}.${nested}`, visit);
  }
}

function checkFileRef(value: unknown, where: string, visit: Visit): void {
  if (typeof value !== 'string') return;
  if (value.includes('${')) return;
  if (!existsSync(resolve(dirname(visit.file), value))) {
    report(visit, `${where}: file ${value} does not exist`);
  }
}

function checkCommands(list: unknown, where: string, visit: Visit): void {
  if (!Array.isArray(list)) {
    report(visit, `${where}: expected a list of commands`);
    return;
  }
  list.forEach((item: unknown, index) => {
    const at = `${where}[${String(index)}]`;
    if (typeof item === 'string') {
      if (!ALLOWED_COMMANDS.has(item)) report(visit, `${at}: command "${item}" is not allowed`);
      visit.commands.add(item);
      return;
    }
    if (item === null || typeof item !== 'object' || Object.keys(item).length !== 1) {
      report(visit, `${at}: a command is a string or a single-key map`);
      return;
    }
    const [name, args] = Object.entries(item as Record<string, unknown>)[0] ?? ['', null];
    visit.commands.add(name);
    if (!ALLOWED_COMMANDS.has(name)) {
      report(visit, `${at}: command "${name}" is not allowed (TEST_PLAN §1)`);
      return;
    }
    const record =
      args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {};
    if (SELECTOR_COMMANDS.has(name)) checkSelector(args, `${at}.${name}`, visit);
    if (name === 'scrollUntilVisible') checkSelector(record.element, `${at}.${name}`, visit);
    if (name === 'extendedWaitUntil') {
      checkSelector(record.visible, `${at}.${name}.visible`, visit);
      checkSelector(record.notVisible, `${at}.${name}.notVisible`, visit);
    }
    if (name === 'runFlow') {
      if (typeof args === 'string') checkFileRef(args, `${at}.runFlow`, visit);
      checkFileRef(record.file, `${at}.runFlow.file`, visit);
      if ('commands' in record) checkCommands(record.commands, `${at}.runFlow.commands`, visit);
    }
    if (name === 'runScript') {
      checkFileRef(typeof args === 'string' ? args : record.file, `${at}.runScript`, visit);
    }
    if (name === 'addMedia') {
      const media = Array.isArray(args) ? args : [];
      media.forEach((m, i) => {
        checkFileRef(m, `${at}.addMedia[${String(i)}]`, visit);
      });
    }
  });
}

export interface FlowInfo {
  readonly file: string;
  readonly name: string | null;
  readonly tags: readonly string[];
  readonly commands: ReadonlySet<string>;
}

/** Lints one flow or subflow file; returns its header info (null when it did not parse). */
export function lintFlow(
  file: string,
  source: string,
  ids: readonly string[],
  text: TextContext,
  problems: Problem[],
): FlowInfo | null {
  const docs = parseAllDocuments(source);
  const list = Array.isArray(docs) ? docs : [docs];
  const errors = list.flatMap((d) => d.errors);
  if (errors.length > 0) {
    problems.push({ file, message: `YAML: ${errors[0]?.message ?? 'parse error'}` });
    return null;
  }
  const values = list.map((d) => d.toJS() as unknown);
  if (values.length !== 2) {
    problems.push({ file, message: 'a flow is a config document, "---" and a command list' });
    return null;
  }
  const header = (values[0] ?? {}) as Record<string, unknown>;
  const visit: Visit = { file, ids, text, problems, commands: new Set() };
  if (header.appId !== APP_ID) report(visit, `appId must be ${APP_ID}`);
  if ('onFlowStart' in header) checkCommands(header.onFlowStart, 'onFlowStart', visit);
  if ('onFlowComplete' in header) checkCommands(header.onFlowComplete, 'onFlowComplete', visit);
  checkCommands(values[1], 'commands', visit);
  const tags = Array.isArray(header.tags) ? header.tags.map(String) : [];
  return {
    file,
    name: typeof header.name === 'string' ? header.name : null,
    tags,
    commands: visit.commands,
  };
}

// ── TEST_PLAN inventory ──────────────────────────────────────────────────────────────────────

export interface RequiredFlow {
  readonly id: string;
  /** Relative to `apps/mobile/.maestro`. */
  readonly path: string;
}

export function requiredFlows(testPlan: string): RequiredFlow[] {
  const out: RequiredFlow[] = [];
  for (const m of testPlan.matchAll(/^\*\*(E2E-M-\d{2}) · [^*]+\*\* — `(flows\/m102\/[^`]+)`/gm)) {
    out.push({ id: m[1] ?? '', path: m[2] ?? '' });
  }
  const rows: [RegExp, string][] = [
    [/^\| (E2E-[A-J]) \| `([^`]+\.yaml)`/gm, 'flows/acceptance'],
    [/^\| (E2E-S-\d{2}) \| `([^`]+\.yaml)`/gm, 'flows/screens'],
    [/^\| (TST-E2E-M-\d{2}) \| `([^`]+\.yaml)`/gm, 'flows/security'],
  ];
  for (const [pattern, folder] of rows) {
    for (const m of testPlan.matchAll(pattern))
      out.push({ id: m[1] ?? '', path: `${folder}/${m[2] ?? ''}` });
  }
  return out;
}

// ── Runner ───────────────────────────────────────────────────────────────────────────────────

export function lintMaestro(root: string = ROOT): Problem[] {
  const maestro = join(root, 'apps', 'mobile', '.maestro');
  const problems: Problem[] = [];
  if (!existsSync(maestro)) return [{ file: maestro, message: 'the Maestro root is missing' }];
  const ids = collectAppTestIds(root);
  const text = textContext(root);
  const yamlFiles = walkFiles(maestro, (p) => /\.ya?ml$/.test(p));

  const config = join(maestro, 'config.yaml');
  if (!existsSync(config)) problems.push({ file: config, message: 'config.yaml is missing' });

  const flows = new Map<string, FlowInfo>();
  for (const file of yamlFiles) {
    const rel = relative(maestro, file);
    const source = readFileSync(file, 'utf8');
    if (!rel.startsWith('flows/') && !rel.startsWith('subflows/')) {
      const docs = parseAllDocuments(source);
      const list = Array.isArray(docs) ? docs : [docs];
      const error = list.flatMap((d) => d.errors)[0];
      if (error !== undefined) problems.push({ file, message: `YAML: ${error.message}` });
      continue;
    }
    const info = lintFlow(file, source, ids, text, problems);
    if (info === null || !rel.startsWith('flows/')) continue;
    flows.set(rel, info);
    const folder = rel.split('/')[1] ?? '';
    const folderTag = FOLDER_TAG[folder];
    if (folderTag === undefined) {
      problems.push({ file, message: `unknown flow folder ${folder}` });
    } else if (!info.tags.includes(folderTag)) {
      problems.push({ file, message: `missing the "${folderTag}" tag` });
    }
    if (!info.tags.includes('android') && !info.tags.includes('ios')) {
      problems.push({ file, message: 'missing a platform tag (android / ios)' });
    }
    if (info.commands.has('setAirplaneMode') && info.tags.includes('ios')) {
      problems.push({ file, message: 'setAirplaneMode is Android-only; drop the ios tag' });
    }
  }

  const plan = readFileSync(join(root, 'docs', 'TEST_PLAN.md'), 'utf8');
  for (const required of requiredFlows(plan)) {
    const info = flows.get(required.path);
    if (info === undefined) {
      problems.push({
        file: join(maestro, required.path),
        message: `${required.id} has no flow file`,
      });
    } else if (info.name?.startsWith(required.id) !== true) {
      problems.push({ file: info.file, message: `name must start with ${required.id}` });
    }
  }
  return problems;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = lintMaestro();
  for (const p of problems) console.error(`${relative(ROOT, p.file)}: ${p.message}`);
  if (problems.length > 0) {
    console.error(`maestro-lint: ${String(problems.length)} problem(s)`);
    process.exit(1);
  }
  console.info('maestro-lint: clean');
}

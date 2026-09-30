/**
 * Catalog gate for @da/i18n (T-1.04 acceptance). Run with `node scripts/check-catalogs.ts`.
 *
 * - `messages/<locale>/<namespace>.json` exists for exactly the namespaces in `src/namespaces.ts`;
 * - tr and en have identical key sets, every leaf is a non-empty string, key segments are
 *   identifiers;
 * - every message parses and formats with intl-messageformat (the catalog version use-intl uses);
 * - ICU arguments and rich-text tags match between tr and en (Turkish case variants such as
 *   `time_loc` count as `time`; English never uses them);
 * - no banned markers (repo `scripts/quality-gate/banned-markers.txt`), no positive "unlimited"
 *   claims (R-17), no apostrophe that would start an ICU quote, no stray whitespace or "...";
 * - push templates have all three detail levels, `generic` is the single neutral text and
 *   `title_only` / `generic` carry no personal values (C-14);
 * - FAQ metadata (`src/faq.ts`) and the `faq` catalog agree;
 * - the verbatim strings required by the plan are present under their keys.
 *
 * Exits 1 when anything is found. Only erasable TypeScript is used (Node type stripping).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isArgumentElement,
  isDateElement,
  isNumberElement,
  isPluralElement,
  isSelectElement,
  isTagElement,
  isTimeElement,
  parse,
  type MessageFormatElement,
} from '@formatjs/icu-messageformat-parser';
import { IntlMessageFormat } from 'intl-messageformat';

import { FAQ_ITEMS } from '../src/faq.ts';
import { INTL_LOCALE, LOCALES, type Locale } from '../src/locales.ts';
import { NAMESPACES } from '../src/namespaces.ts';
import { TR_CASE_ARG_PATTERN, baseArgumentName } from '../src/tr-suffix.ts';

export interface CatalogFinding {
  rule: string;
  locale?: Locale;
  key?: string;
  message: string;
}

export interface CatalogReport {
  findings: CatalogFinding[];
  /** Keys per namespace (identical in every locale when the report is clean). */
  counts: Record<string, number>;
  total: number;
}

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_SEGMENT = /^[a-z][A-Za-z0-9_]*$/;
const PUSH_KEY = /^push\.([a-z_]+)\.([a-z_]+)\.(full|title_only|generic)\.(title|body)$/;
const PUSH_LEVELS = ['full', 'title_only', 'generic'] as const;
/** Values that never identify a person or reveal content; allowed below `full` (C-14). */
const NON_PERSONAL_ARGS = new Set([
  'count',
  'minutes',
  'hours',
  'days',
  'kind',
  'state',
  'side',
  'service',
  'plan',
  'store',
  'date',
  'time',
  'reference',
  'status',
]);
const GENERIC_PUSH: Readonly<Record<Locale, { title: string; body: string }>> = {
  tr: { title: 'Dijital Asistan', body: 'Yeni bir güncellemen var.' },
  en: { title: 'Dijital Asistan', body: 'You have a new update.' },
};
/** R-17 fair-use words (spelled with classes so the repo quality gate does not flag this line). */
const FAIR_USE_WORDS = /\b(s[ı]nırsız|unlim[i]ted)\b/iu;
const FAIR_USE_NEGATION = /(değil|olmayan|yok|never|not|no\s|isn't|aren't|asla|hiçbir)/iu;
/** An apostrophe followed by one of these starts an ICU quote and swallows the text. */
const ICU_QUOTE_TRAP = /'[{}#<>|']/;

/** Exact strings the plan requires (T-1.04, M§9/§11/§13/§14/§24/§29/§40, R-03/R-14/R-15). */
export const REQUIRED_VERBATIM: Readonly<Record<string, string>> = {
  'common.app.tagline': 'Bugün bilmen gerekenleri, sen sormadan söyler.',
  'common.actions.viewBriefing': 'Brifingimi Gör',
  'common.actions.listenFor': 'Dinle · {minutes} dk',
  'common.provenance.notConfirmed': 'Kaynakta kesinleşmiyor.',
  'states.unavailable.credential.rowMeta': 'Harici kimlik bilgisi gerekli',
  'settings.accounts.status.needs_reauth': 'Bağlantıyı yenile.',
  'privacy.promises.encrypted': 'Veriler aktarım sırasında ve saklanırken şifrelenir.',
  'privacy.promises.approval': 'Önemli işlemler sen onaylamadan gerçekleştirilmez.',
  'privacy.promises.ads': 'Verilerin reklam amacıyla satılmaz.',
  'privacy.storage.canonical':
    'Mail içeriğinin tamamı saklanmaz; yalnızca özetler, kısa alıntılar ve analiz sonuçları saklama süren boyunca tutulur.',
  'privacy.storage.firstAnalysisFooter':
    'Son 72 saat analiz edildi. Mail içeriğinin tamamı saklanmaz.',
  'privacy.storage.androidNi':
    'Bildirim içerikleri cihazında işlenir; yalnızca çıkarılan bilgiler (ör. kargo durumu, tutar, tarih) hesabına kaydedilir. Doğrulama kodları ve güvenlik uygulamaları her zaman hariç tutulur.',
  'notifications.promise': 'Sadece önemli olduğunda haber veririz.',
  'voice.tapToApprove': 'Onaylamak için karta dokun.',
  'common.tabs.today': 'Bugün',
  'common.tabs.flow': 'Akış',
  'common.tabs.plan': 'Plan',
  'common.tabs.assistant': 'Asistan',
  'briefing.sections.priorities': 'Bugünün Öncelikleri',
  'briefing.sections.schedule': 'Programın',
  'briefing.sections.awaiting_me': 'Senden Beklenenler',
  'briefing.sections.awaiting_them': 'Senin Beklediklerin',
  'briefing.sections.deadlines': 'Son Tarihler',
  'briefing.sections.life': 'Kişisel Gelişmeler',
  'briefing.sections.completed': 'Tamamlananlar',
  'briefing.sections.carry_over': 'Yarına Kalanlar',
  'briefing.sections.follow_up': 'Takip',
  'briefing.sections.tomorrow_first': 'Yarının ilk etkinliği',
  'flow.filters.all': 'Tümü',
  'flow.filters.important': 'Önemli',
  'flow.filters.mail': 'Mail',
  'flow.filters.calendar': 'Takvim',
  'flow.filters.followup': 'Takip',
  'flow.filters.personal': 'Kişisel',
  'mail.categories.important': 'Önemli',
  'mail.categories.awaiting_my_reply': 'Senden Cevap Bekleyen',
  'mail.categories.awaiting_their_reply': 'Senin Cevap Beklediğin',
  'mail.categories.has_deadline': 'Son Tarih İçeren',
  'mail.categories.informational': 'Bilgilendirme',
  'mail.categories.low_priority': 'Düşük Öncelik',
  'reply.tones.short': 'Kısa',
  'reply.tones.professional': 'Profesyonel',
  'reply.tones.friendly': 'Samimi',
  'reply.tones.detailed': 'Detaylı',
  'reminder.presets.before_30m': '30 dakika önce',
  'reminder.presets.before_1h': '1 saat önce',
  'reminder.presets.this_evening': 'Bu akşam',
  'reminder.presets.tomorrow_morning': 'Yarın sabah',
  'reminder.presets.smart': 'Uygun zamanda',
  'reminder.presets.custom': 'Kendin seç',
  'assistant.prompts.focus': 'Bugün neye odaklanmalıyım?',
  'assistant.prompts.replies': 'Kimlere cevap vermem gerekiyor?',
  'assistant.prompts.tomorrowBusy': 'Yarın yoğun muyum?',
  'assistant.prompts.deadlinesThisWeek': 'Bu hafta hangi son tarihlerim var?',
  'assistant.prompts.paymentsDue': 'Ödenmesi gereken bir şey var mı?',
  'common.actions.approve': 'Onayla',
  'common.actions.edit': 'Düzenle',
  'common.actions.reject': 'Reddet',
  'common.actions.undo': 'Geri al',
};

type Catalog = Record<string, unknown>;

function flatten(
  node: unknown,
  prefix: string,
  out: Map<string, string>,
  findings: CatalogFinding[],
  locale: Locale,
): void {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    findings.push({
      rule: 'structure',
      locale,
      key: prefix,
      message: 'expected an object of messages',
    });
    return;
  }
  const entries = Object.entries(node);
  if (entries.length === 0)
    findings.push({ rule: 'structure', locale, key: prefix, message: 'empty object' });
  for (const [segment, value] of entries) {
    const key = `${prefix}.${segment}`;
    if (!KEY_SEGMENT.test(segment)) {
      findings.push({
        rule: 'key-name',
        locale,
        key,
        message: `segment "${segment}" is not an identifier`,
      });
    }
    if (typeof value === 'string') {
      out.set(key, value);
    } else {
      flatten(value, key, out, findings, locale);
    }
  }
}

/** Arguments and tags used by a message (recursively through plural/select/tag bodies). */
export function collectArguments(elements: readonly MessageFormatElement[]): {
  args: Set<string>;
  tags: Set<string>;
} {
  const args = new Set<string>();
  const tags = new Set<string>();
  const walk = (list: readonly MessageFormatElement[]): void => {
    for (const el of list) {
      if (isArgumentElement(el) || isNumberElement(el) || isDateElement(el) || isTimeElement(el)) {
        args.add(el.value);
      } else if (isPluralElement(el) || isSelectElement(el)) {
        args.add(el.value);
        for (const option of Object.values(el.options)) walk(option.value);
      } else if (isTagElement(el)) {
        tags.add(el.value);
        walk(el.children);
      }
    }
  };
  walk(elements);
  return { args, tags };
}

/** Sample values that exercise every argument of a message. */
function sampleValues(elements: readonly MessageFormatElement[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const walk = (list: readonly MessageFormatElement[]): void => {
    for (const el of list) {
      if (isPluralElement(el) || isNumberElement(el)) values[el.value] = 3;
      else if (isDateElement(el) || isTimeElement(el))
        values[el.value] = new Date(Date.UTC(2026, 8, 5, 6, 40));
      else if (isSelectElement(el)) values[el.value] = 'other';
      else if (isArgumentElement(el)) values[el.value] = 'x';
      if (isPluralElement(el) || isSelectElement(el)) {
        for (const option of Object.values(el.options)) walk(option.value);
      } else if (isTagElement(el)) {
        values[el.value] = (chunks: unknown[]) => chunks.join('');
        walk(el.children);
      }
    }
  };
  walk(elements);
  return values;
}

function loadBannedPatterns(file: string): RegExp[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => new RegExp(line, 'iu'));
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}

function describe(set: ReadonlySet<string>): string {
  return `{${[...set].sort().join(', ')}}`;
}

function checkMessage(
  locale: Locale,
  key: string,
  message: string,
  banned: readonly RegExp[],
  findings: CatalogFinding[],
): MessageFormatElement[] | undefined {
  const report = (rule: string, text: string): void => {
    findings.push({ rule, locale, key, message: text });
  };
  if (message.trim() === '') report('empty', 'message is empty');
  if (message !== message.trim()) report('whitespace', 'leading or trailing whitespace');
  if (/ {2}|\t|\n/.test(message)) report('whitespace', 'double space, tab or newline');
  if (message.includes('...')) report('ellipsis', 'use "…" instead of "..."');
  if (ICU_QUOTE_TRAP.test(message))
    report('icu-quote', `apostrophe starts an ICU quote: ${message}`);
  const bannedHit = banned.find((re) => re.test(message));
  if (bannedHit) report('banned-marker', `matches /${bannedHit.source}/`);
  if (FAIR_USE_WORDS.test(message) && !FAIR_USE_NEGATION.test(message))
    report('fair-use-claim', 'positive claim; only negated fair-use copy is allowed (R-17)');

  let ast: MessageFormatElement[];
  try {
    ast = parse(message);
  } catch (error) {
    report('icu-syntax', error instanceof Error ? error.message : String(error));
    return undefined;
  }
  try {
    const formatter = new IntlMessageFormat(message, INTL_LOCALE[locale]);
    formatter.format(sampleValues(ast));
  } catch (error) {
    report('intl-messageformat', error instanceof Error ? error.message : String(error));
  }
  if (locale === 'en') {
    for (const arg of collectArguments(ast).args) {
      if (TR_CASE_ARG_PATTERN.test(arg))
        report('en-case-variant', `English must use {${baseArgumentName(arg)}}, not {${arg}}`);
    }
  }
  return ast;
}

function checkPush(
  locale: Locale,
  flat: ReadonlyMap<string, string>,
  asts: ReadonlyMap<string, MessageFormatElement[]>,
  findings: CatalogFinding[],
): void {
  const templates = new Set<string>();
  for (const [key, message] of flat) {
    const match = PUSH_KEY.exec(key);
    if (!match) continue;
    const [, category, template, level, part] = match;
    templates.add(`${String(category)}.${String(template)}`);
    const ast = asts.get(key);
    const args = ast ? collectArguments(ast).args : new Set<string>();
    if (level === 'generic') {
      const expected = GENERIC_PUSH[locale][part === 'title' ? 'title' : 'body'];
      if (message !== expected) {
        findings.push({
          rule: 'push-generic',
          locale,
          key,
          message: `generic must read "${expected}"`,
        });
      }
    } else if (level === 'title_only') {
      for (const arg of args) {
        if (!NON_PERSONAL_ARGS.has(baseArgumentName(arg))) {
          findings.push({
            rule: 'push-privacy',
            locale,
            key,
            message: `{${arg}} may reveal names or content (C-14)`,
          });
        }
      }
    }
  }
  for (const template of templates) {
    for (const level of PUSH_LEVELS) {
      for (const part of ['title', 'body']) {
        const key = `push.${template}.${level}.${part}`;
        if (!flat.has(key))
          findings.push({ rule: 'push-levels', locale, key, message: 'missing detail level' });
      }
    }
  }
}

function checkFaq(
  locale: Locale,
  flat: ReadonlyMap<string, string>,
  asts: ReadonlyMap<string, MessageFormatElement[]>,
  findings: CatalogFinding[],
): void {
  const declared = new Set<string>(FAQ_ITEMS.map((item) => item.key));
  for (const key of flat.keys()) {
    const match = /^faq\.items\.([a-z_]+)\.(q|a)$/.exec(key);
    if (match?.[1] !== undefined && !declared.has(match[1])) {
      findings.push({ rule: 'faq', locale, key, message: 'not declared in src/faq.ts' });
    }
  }
  for (const item of FAQ_ITEMS) {
    for (const part of ['q', 'a']) {
      if (!flat.has(`faq.items.${item.key}.${part}`)) {
        findings.push({
          rule: 'faq',
          locale,
          key: `faq.items.${item.key}.${part}`,
          message: 'missing',
        });
      }
    }
    const answer = asts.get(`faq.items.${item.key}.a`);
    if (!answer) continue;
    const { args, tags } = collectArguments(answer);
    const params = new Set<string>('params' in item ? item.params : []);
    const tagNames = new Set<string>('tags' in item ? item.tags : []);
    if (!sameSet(args, params)) {
      findings.push({
        rule: 'faq',
        locale,
        key: `faq.items.${item.key}.a`,
        message: `params ${describe(args)} ≠ declared ${describe(params)}`,
      });
    }
    if (!sameSet(tags, tagNames)) {
      findings.push({
        rule: 'faq',
        locale,
        key: `faq.items.${item.key}.a`,
        message: `tags ${describe(tags)} ≠ declared ${describe(tagNames)}`,
      });
    }
  }
  const featured = FAQ_ITEMS.filter((item) => item.featured).length;
  if (featured !== 8)
    findings.push({
      rule: 'faq',
      locale,
      message: `exactly 8 featured items expected, found ${featured}`,
    });
}

export interface CheckOptions {
  /** Directory containing `messages/`; defaults to this package. */
  packageDir?: string;
  /** Banned-marker list; defaults to the repository's quality-gate list. */
  bannedMarkersFile?: string;
}

export function checkCatalogs({
  packageDir = PACKAGE_DIR,
  bannedMarkersFile = join(
    PACKAGE_DIR,
    '..',
    '..',
    'scripts',
    'quality-gate',
    'banned-markers.txt',
  ),
}: CheckOptions = {}): CatalogReport {
  const findings: CatalogFinding[] = [];
  const messagesDir = join(packageDir, 'messages');
  const banned = loadBannedPatterns(bannedMarkersFile);
  if (banned.length === 0)
    findings.push({ rule: 'setup', message: `no banned markers loaded from ${bannedMarkersFile}` });

  const localeDirs = readdirSync(messagesDir).filter((name) =>
    statSync(join(messagesDir, name)).isDirectory(),
  );
  for (const dir of localeDirs) {
    if (!(LOCALES as readonly string[]).includes(dir))
      findings.push({ rule: 'files', message: `unexpected locale directory messages/${dir}` });
  }

  const flats = new Map<Locale, Map<string, string>>();
  const asts = new Map<Locale, Map<string, MessageFormatElement[]>>();
  const counts: Record<string, number> = {};

  for (const locale of LOCALES) {
    const flat = new Map<string, string>();
    const parsed = new Map<string, MessageFormatElement[]>();
    flats.set(locale, flat);
    asts.set(locale, parsed);
    const dir = join(messagesDir, locale);
    const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.json')) : [];
    for (const file of files) {
      const namespace = file.replace(/\.json$/, '');
      if (!(NAMESPACES as readonly string[]).includes(namespace)) {
        findings.push({
          rule: 'files',
          locale,
          message: `unexpected file messages/${locale}/${file}`,
        });
      }
    }
    for (const namespace of NAMESPACES) {
      const file = join(dir, `${namespace}.json`);
      if (!existsSync(file)) {
        findings.push({
          rule: 'files',
          locale,
          message: `missing messages/${locale}/${namespace}.json`,
        });
        continue;
      }
      let data: Catalog;
      try {
        data = JSON.parse(readFileSync(file, 'utf8')) as Catalog;
      } catch (error) {
        findings.push({
          rule: 'json',
          locale,
          key: namespace,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      const before = flat.size;
      flatten(data, namespace, flat, findings, locale);
      if (locale === 'tr') counts[namespace] = flat.size - before;
    }
    for (const [key, message] of flat) {
      const ast = checkMessage(locale, key, message, banned, findings);
      if (ast) parsed.set(key, ast);
    }
    checkPush(locale, flat, parsed, findings);
    checkFaq(locale, flat, parsed, findings);
  }

  const tr = flats.get('tr') ?? new Map<string, string>();
  const en = flats.get('en') ?? new Map<string, string>();
  for (const key of tr.keys())
    if (!en.has(key))
      findings.push({ rule: 'parity', locale: 'en', key, message: 'missing in en' });
  for (const key of en.keys())
    if (!tr.has(key))
      findings.push({ rule: 'parity', locale: 'tr', key, message: 'missing in tr' });

  const trAsts = asts.get('tr') ?? new Map<string, MessageFormatElement[]>();
  const enAsts = asts.get('en') ?? new Map<string, MessageFormatElement[]>();
  for (const [key, trAst] of trAsts) {
    const enAst = enAsts.get(key);
    if (!enAst) continue;
    const trUse = collectArguments(trAst);
    const enUse = collectArguments(enAst);
    const trArgs = new Set([...trUse.args].map(baseArgumentName));
    if (!sameSet(trArgs, enUse.args)) {
      findings.push({
        rule: 'placeholders',
        key,
        message: `tr ${describe(trArgs)} ≠ en ${describe(enUse.args)}`,
      });
    }
    if (!sameSet(trUse.tags, enUse.tags)) {
      findings.push({
        rule: 'tags',
        key,
        message: `tr ${describe(trUse.tags)} ≠ en ${describe(enUse.tags)}`,
      });
    }
  }

  for (const [key, expected] of Object.entries(REQUIRED_VERBATIM)) {
    const actual = tr.get(key);
    if (actual !== expected) {
      findings.push({
        rule: 'verbatim',
        locale: 'tr',
        key,
        message: `expected "${expected}", found ${actual === undefined ? 'nothing' : `"${actual}"`}`,
      });
    }
  }

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return { findings, counts, total };
}

function main(): void {
  const { findings, counts, total } = checkCatalogs();
  for (const f of findings) {
    const where = [f.locale, f.key].filter(Boolean).join(' ');
    console.error(`[${f.rule}] ${where}${where === '' ? '' : ': '}${f.message}`);
  }
  if (findings.length > 0) {
    console.error(`\ncheck-catalogs: ${findings.length} finding(s).`);
    process.exit(1);
  }
  const width = Math.max(...Object.keys(counts).map((name) => name.length));
  for (const [namespace, n] of Object.entries(counts))
    console.info(`${namespace.padEnd(width)}  ${n}`);
  console.info(
    `check-catalogs: clean · ${LOCALES.join('/')} · ${Object.keys(counts).length} namespaces · ${total} keys per locale`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

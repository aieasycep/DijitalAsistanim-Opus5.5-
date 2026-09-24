/**
 * Turkish case suffixes for names, numbers, times, acronyms and brand names.
 *
 * ICU MessageFormat cannot inflect a value, and an apostrophe followed by `{` starts an ICU quote,
 * so a template like `{time}'{de}` is impossible. Instead the caller passes pre-inflected values:
 * the Turkish message uses `{time_loc}` ("17:00'de") while English uses `{time}` ("17:00").
 * `withTrCases(values)` adds every `_dat/_acc/_loc/_abl/_gen/_ins/_poss/_possacc/_pl` variant.
 *
 * Rules implemented (TDK):
 * - Vowel harmony on how the value is **read aloud**: numbers by their last spoken word
 *   (1 bir → 1'e, 6 altı → 6'ya, 40 kırk → 40'a, 100 yüz → 100'e), times by their minutes
 *   (09:40 "kırk" → 09:40'tan) or by the hour on the full hour (10:00 "on" → 10:00'dan), acronyms
 *   read letter by letter by the last letter's name (THY "ye" → THY'ye), brand names by a
 *   pronunciation table (Google "gugıl" → Google'a).
 * - Buffer consonants after a final vowel: y (dative, accusative, instrumental), n (genitive),
 *   s (3rd-person possessive).
 * - Consonant assimilation: d → t after a voiceless consonant (f s t k ç ş h p): Ahmet'te, 5'ten.
 * - Proper nouns, numbers, times and acronyms are separated with an apostrophe and never soften in
 *   writing (Ahmet'e, Zeynep'i, Tarık'ın). Common nouns attach directly and soften p ç t k → b c d ğ
 *   before a vowel (kitap → kitaba, renk → rengi) when `apostrophe: false`.
 */

export const TR_CASES = [
  'dative',
  'accusative',
  'locative',
  'ablative',
  'genitive',
  'instrumental',
  'possessive',
  'possessiveAccusative',
  'plural',
] as const;
export type TrCase = (typeof TR_CASES)[number];

/** Argument-name suffix per case, used by `withTrCases` and by the catalog argument check. */
export const TR_CASE_ARG_SUFFIX = {
  dative: 'dat',
  accusative: 'acc',
  locative: 'loc',
  ablative: 'abl',
  genitive: 'gen',
  instrumental: 'ins',
  possessive: 'poss',
  possessiveAccusative: 'possacc',
  plural: 'pl',
} as const satisfies Readonly<Record<TrCase, string>>;

/** Matches an ICU argument name that carries a Turkish case variant, e.g. `time_loc`. */
export const TR_CASE_ARG_PATTERN = /_(dat|acc|loc|abl|gen|ins|poss|possacc|pl)$/;

/** Strips a Turkish case marker from an argument name: `time_loc` → `time`. */
export function baseArgumentName(name: string): string {
  return name.replace(TR_CASE_ARG_PATTERN, '');
}

export interface TrSuffixOptions {
  /**
   * `true` (default) for proper nouns, numbers, times, acronyms and brand names: the suffix is
   * separated with an apostrophe and the stem never softens. `false` for common nouns.
   */
  apostrophe?: boolean;
  /** The apostrophe character; defaults to the ASCII `'` used across the catalogs. */
  apostropheChar?: string;
  /** How the value is read aloud when spelling and pronunciation disagree, e.g. `'gugıl'`. */
  reading?: string;
  /** Common nouns only: force (`true`) or suppress (`false`) final-consonant softening. */
  soften?: boolean;
}

const VOWELS = 'aeıioöuü';
const BACK_VOWELS = 'aıou';
const VOICELESS = 'fstkçşhp';

const UNITS = ['sıfır', 'bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz'];
const TENS = ['', 'on', 'yirmi', 'otuz', 'kırk', 'elli', 'altmış', 'yetmiş', 'seksen', 'doksan'];
const SCALES = ['', 'bin', 'milyon', 'milyar', 'trilyon', 'katrilyon', 'kentilyon'];

/** Letter names (TDK) for acronyms read letter by letter. */
const LETTER_NAMES: Readonly<Record<string, string>> = {
  a: 'a',
  b: 'be',
  c: 'ce',
  ç: 'çe',
  d: 'de',
  e: 'e',
  f: 'fe',
  g: 'ge',
  ğ: 'yumuşak ge',
  h: 'he',
  ı: 'ı',
  i: 'i',
  j: 'je',
  k: 'ke',
  l: 'le',
  m: 'me',
  n: 'ne',
  o: 'o',
  ö: 'ö',
  p: 'pe',
  q: 'kü',
  r: 're',
  s: 'se',
  ş: 'şe',
  t: 'te',
  u: 'u',
  ü: 'ü',
  v: 've',
  w: 'çift ve',
  x: 'iks',
  y: 'ye',
  z: 'ze',
};

/**
 * Pronunciations for names whose spelling misleads vowel harmony (mostly English brand names).
 * Keys are the last word of the value, lower-cased.
 */
const PRONUNCIATIONS: Readonly<Record<string, string>> = {
  ai: 'eyay',
  apple: 'epıl',
  calendar: 'kelındır',
  do: 'du',
  drive: 'drayv',
  facebook: 'feysbuk',
  gmail: 'cimeyl',
  google: 'gugıl',
  hotmail: 'hatmeyl',
  icloud: 'aykılaud',
  ios: 'ayos',
  ipad: 'aypet',
  iphone: 'ayfon',
  meet: 'mit',
  microsoft: 'maykrosoft',
  office: 'ofis',
  onedrive: 'vandrayv',
  outlook: 'autluk',
  slack: 'slek',
  spotify: 'spotifay',
  teams: 'tims',
  twitter: 'tivitır',
  whatsapp: 'vatsap',
  youtube: 'yutub',
  zoom: 'zum',
};

/** Words whose suffixes take front vowels despite a final back vowel (palatal l, Arabic loans). */
const FRONT_HARMONY = new Set([
  'alkol',
  'bilal',
  'celal',
  'cemal',
  'dikkat',
  'festival',
  'gol',
  'hal',
  'harf',
  'hayal',
  'hilal',
  'ideal',
  'kabul',
  'kalp',
  'kemal',
  'kontrol',
  'meal',
  'nihal',
  'petrol',
  'protokol',
  'rol',
  'saat',
  'sembol',
]);

/** Polysyllabic common nouns that keep their final consonant before a vowel. */
const NO_SOFTENING = new Set([
  'ahlak',
  'devlet',
  'dikkat',
  'evrak',
  'hukuk',
  'millet',
  'saat',
  'sanat',
  'sepet',
  'ticaret',
]);

const SOFTENING: Readonly<Record<string, string>> = { p: 'b', ç: 'c', t: 'd', k: 'ğ' };

/** Back vowel → its front counterpart, for FRONT_HARMONY words. */
const FRONTED: Readonly<Record<string, string>> = { a: 'e', ı: 'i', o: 'ö', u: 'ü' };

function trLower(text: string): string {
  return text.replaceAll('I', 'ı').replaceAll('İ', 'i').toLowerCase();
}

function readHundreds(group: number): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(group / 100);
  const tens = Math.floor((group % 100) / 10);
  const units = group % 10;
  if (hundreds > 0) {
    if (hundreds > 1) words.push(UNITS[hundreds] ?? '');
    words.push('yüz');
  }
  if (tens > 0) words.push(TENS[tens] ?? '');
  if (units > 0) words.push(UNITS[units] ?? '');
  return words;
}

function readIntegerDigits(digits: string): string {
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  if (/^0+$/.test(trimmed)) return UNITS[0] ?? 'sıfır';
  const groups: number[] = [];
  for (let end = trimmed.length; end > 0; end -= 3) {
    groups.unshift(Number(trimmed.slice(Math.max(0, end - 3), end)));
  }
  const words: string[] = [];
  groups.forEach((group, index) => {
    if (group === 0) return;
    const scale = groups.length - 1 - index;
    if (scale === 1 && group === 1) {
      words.push('bin');
      return;
    }
    words.push(...readHundreds(group));
    const scaleWord = SCALES[scale];
    if (scaleWord === undefined) throw new RangeError(`Number too large to read: ${digits}`);
    if (scaleWord !== '') words.push(scaleWord);
  });
  return words.join(' ');
}

function readFractionDigits(digits: string): string {
  const leadingZeros = /^0*/.exec(digits)?.[0].length ?? 0;
  const zeros = Array.from({ length: Math.min(leadingZeros, digits.length) }, () => 'sıfır');
  const rest = digits.slice(leadingZeros);
  return [...zeros, ...(rest === '' ? [] : [readIntegerDigits(rest)])].join(' ');
}

/**
 * Reads a number aloud in Turkish: 1842 → "bin sekiz yüz kırk iki", 3.5 → "üç virgül beş".
 * Used to pick suffixes and by the text-to-speech layer.
 */
export function readNumberTr(value: number | bigint): string {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RangeError(`Cannot read a non-finite number: ${String(value)}`);
  }
  const negative = value < 0;
  const text = (negative ? -value : value).toString();
  if (/e/i.test(text)) throw new RangeError(`Cannot read a number in exponent form: ${text}`);
  const [integerPart = '0', fractionPart] = text.split('.');
  const reading =
    fractionPart === undefined
      ? readIntegerDigits(integerPart)
      : `${readIntegerDigits(integerPart)} virgül ${readFractionDigits(fractionPart)}`;
  return negative ? `eksi ${reading}` : reading;
}

/** Reads a Turkish-formatted numeric string ("1.842", "3,5", "2026") aloud. */
function readFormattedNumber(token: string): string {
  const commaIndex = token.lastIndexOf(',');
  if (commaIndex === -1) return readIntegerDigits(token.replaceAll('.', ''));
  const integerDigits = token.slice(0, commaIndex).replaceAll('.', '') || '0';
  return `${readIntegerDigits(integerDigits)} virgül ${readFractionDigits(token.slice(commaIndex + 1))}`;
}

const TIME_AT_END = /(?:^|[^\d.,:])(\d{1,2})([:.])(\d{2})$/;
const NUMBER_AT_END = /\d[\d.,]*$/;
const WORD_AT_END = /[\p{L}\p{N}]+$/u;
const UPPER_ACRONYM = /^[A-ZÇĞİIÖŞÜQWX]{2,}$/u;
const TRAILING_NON_WORD = /[^\p{L}\p{N}]+$/u;

interface Reading {
  /** Lower-case Turkish reading of the final sound group. */
  text: string;
  /** Suffix vowels are front even if the last vowel is back (FRONT_HARMONY). */
  front: boolean;
}

function readAcronym(token: string): string | undefined {
  const hasVowel = /[AEIİOÖUÜ]/u.test(token);
  if (hasVowel && token.length > 3) return undefined; // NATO, ODTÜ, UNESCO are read as words
  const last = trLower(token.slice(-1));
  return LETTER_NAMES[last];
}

function readingOf(value: string, options: TrSuffixOptions): Reading {
  if (options.reading !== undefined) return { text: trLower(options.reading), front: false };
  const text = value.trim().replace(TRAILING_NON_WORD, '');

  const time = TIME_AT_END.exec(text);
  if (time) {
    const [, hour = '0', separator, minutes = '00'] = time;
    const plausible = separator === ':' || (Number(hour) <= 23 && Number(minutes) <= 59);
    if (plausible) {
      return {
        text: minutes === '00' ? readIntegerDigits(hour) : readIntegerDigits(minutes),
        front: false,
      };
    }
  }

  const number = NUMBER_AT_END.exec(text);
  if (number) return { text: readFormattedNumber(number[0]), front: false };

  const word = WORD_AT_END.exec(text)?.[0] ?? text;
  const lower = trLower(word);
  const pronunciation = PRONUNCIATIONS[word.toLowerCase()] ?? PRONUNCIATIONS[lower];
  if (pronunciation !== undefined) return { text: pronunciation, front: false };
  if (UPPER_ACRONYM.test(word)) {
    const spelled = readAcronym(word);
    if (spelled !== undefined) return { text: spelled, front: false };
  }
  return { text: lower, front: FRONT_HARMONY.has(lower) };
}

interface Sounds {
  lastVowel: string;
  endsWithVowel: boolean;
  voiceless: boolean;
}

function soundsOf(reading: Reading): Sounds {
  const normalised = reading.text
    .replaceAll('â', 'a')
    .replaceAll('î', 'i')
    .replaceAll('û', 'u')
    .replaceAll('x', 'ks')
    .replaceAll('q', 'k')
    .replaceAll('w', 'v')
    .replace(/[^a-zçğıöşü]/g, '');
  const last = normalised.slice(-1);
  const vowel = /[aeıioöuü](?=[^aeıioöuü]*$)/.exec(normalised)?.[0] ?? 'e';
  const lastVowel = reading.front ? (FRONTED[vowel] ?? vowel) : vowel;
  return {
    lastVowel,
    endsWithVowel: last !== '' && VOWELS.includes(last),
    voiceless: last !== '' && VOICELESS.includes(last),
  };
}

function twoWay(vowel: string): string {
  return BACK_VOWELS.includes(vowel) ? 'a' : 'e';
}

function fourWay(vowel: string): string {
  switch (vowel) {
    case 'a':
    case 'ı':
      return 'ı';
    case 'o':
    case 'u':
      return 'u';
    case 'ö':
    case 'ü':
      return 'ü';
    default:
      return 'i';
  }
}

function suffixFor(sounds: Sounds, grammaticalCase: TrCase): string {
  const a = twoWay(sounds.lastVowel);
  const i = fourWay(sounds.lastVowel);
  const d = sounds.voiceless ? 't' : 'd';
  const v = sounds.endsWithVowel;
  switch (grammaticalCase) {
    case 'dative':
      return v ? `y${a}` : a;
    case 'accusative':
      return v ? `y${i}` : i;
    case 'locative':
      return `${d}${a}`;
    case 'ablative':
      return `${d}${a}n`;
    case 'genitive':
      return v ? `n${i}n` : `${i}n`;
    case 'instrumental':
      return v ? `yl${a}` : `l${a}`;
    case 'possessive':
      return v ? `s${i}` : i;
    case 'possessiveAccusative':
      return v ? `s${i}n${i}` : `${i}n${i}`;
    case 'plural':
      return `l${a}r`;
  }
}

/** The bare suffix for a value, without apostrophe: `trCaseSuffix('Ayşe', 'dative')` → `'ye'`. */
export function trCaseSuffix(
  value: string | number | bigint,
  grammaticalCase: TrCase,
  options: TrSuffixOptions = {},
): string {
  return suffixFor(soundsOf(readingOf(String(value), options)), grammaticalCase);
}

function softenedStem(word: string, suffix: string, options: TrSuffixOptions): string {
  const startsWithVowel = VOWELS.includes(suffix.charAt(0));
  if (!startsWithVowel || options.soften === false) return word;
  const last = word.slice(-1);
  const replacement = SOFTENING[last];
  if (replacement === undefined) return word;
  const lastWord = trLower(WORD_AT_END.exec(word)?.[0] ?? word);
  const syllables = lastWord.match(/[aeıioöuü]/g)?.length ?? 0;
  // Polysyllabic words soften (kitap → kitaba); "nk" always becomes "ng" (renk → rengi).
  const auto = (syllables >= 2 || lastWord.endsWith('nk')) && !NO_SOFTENING.has(lastWord);
  if (options.soften !== true && !auto) return word;
  const nk = last === 'k' && word.slice(-2, -1) === 'n';
  return `${word.slice(0, -1)}${nk ? 'g' : replacement}`;
}

/**
 * Inflects a value: `trSuffix('Ahmet', 'dative')` → "Ahmet'e", `trSuffix('09:40', 'ablative')` →
 * "09:40'tan", `trSuffix('kitap', 'dative', { apostrophe: false })` → "kitaba".
 */
export function trSuffix(
  value: string | number | bigint,
  grammaticalCase: TrCase,
  options: TrSuffixOptions = {},
): string {
  const text = String(value).trim();
  const suffix = trCaseSuffix(text, grammaticalCase, options);
  if (options.apostrophe ?? true) return `${text}${options.apostropheChar ?? "'"}${suffix}`;
  return `${softenedStem(text, suffix, options)}${suffix}`;
}

/** Numbers: `trNumberSuffix(77, 'possessiveAccusative')` → "77'sini", `trNumberSuffix(6, 'dative')` → "6'ya". */
export function trNumberSuffix(
  value: number | bigint | string,
  grammaticalCase: TrCase,
  options: Omit<TrSuffixOptions, 'apostrophe' | 'soften'> = {},
): string {
  return trSuffix(value, grammaticalCase, { ...options, apostrophe: true });
}

/** Every case of a value, keyed by case name. */
export function trSuffixForms(
  value: string | number | bigint,
  options: TrSuffixOptions = {},
): Record<TrCase, string> {
  const forms = {} as Record<TrCase, string>;
  for (const grammaticalCase of TR_CASES)
    forms[grammaticalCase] = trSuffix(value, grammaticalCase, options);
  return forms;
}

type MessageValue = string | number | bigint | boolean | Date | null | undefined;

/** Argument-name suffixes, e.g. `loc` in `time_loc`. */
export type TrCaseArgSuffix = (typeof TR_CASE_ARG_SUFFIX)[TrCase];

/** Keys of `T` whose values can be inflected (strings and numbers). */
export type InflectableKeys<T> = {
  [K in keyof T & string]: T[K] extends string | number | bigint ? K : never;
}[keyof T & string];

/** `T` plus a string for every case variant of each inflectable key in `K`. */
export type WithTrCases<T, K extends keyof T & string = keyof T & string> = T &
  Record<`${K & InflectableKeys<T>}_${TrCaseArgSuffix}`, string>;

/**
 * Adds Turkish case variants for ICU values: `{ time: '17:00' }` → `{ time: '17:00',
 * time_dat: "17:00'ye", time_loc: "17:00'de", … }`. English messages ignore the extra values.
 * Pass `keys` to inflect only some values. Strings and numbers are inflected; an empty string
 * yields empty variants; booleans, dates and nullish values are left alone.
 */
export function withTrCases<
  T extends Record<string, MessageValue>,
  K extends keyof T & string = keyof T & string,
>(values: T, keys?: readonly K[]): WithTrCases<T, K> {
  const result: Record<string, MessageValue> = { ...values };
  for (const key of keys ?? Object.keys(values)) {
    const value = values[key];
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint')
      continue;
    const empty = String(value).trim() === '';
    for (const grammaticalCase of TR_CASES) {
      result[`${key}_${TR_CASE_ARG_SUFFIX[grammaticalCase]}`] = empty
        ? ''
        : trSuffix(value, grammaticalCase);
    }
  }
  return result as WithTrCases<T, K>;
}

/**
 * IATA flight numbers (AI_PIPELINE_PLAN §6.9.5): the airline designator must be in the bundled
 * allow-list and a flight context word must occur within ±60 characters. Airports are validated
 * against a bundled IATA list.
 */
import { foldTR, normalizeTR } from './normalize-tr.ts';

/** Airline designators accepted (Turkish carriers first, then majors serving Turkey). */
export const AIRLINE_DESIGNATORS: readonly string[] = [
  'TK',
  'PC',
  'VF',
  'XQ',
  'LH',
  'BA',
  'AF',
  'KL',
  'EK',
  'QR',
  'EY',
  'AZ',
  'IB',
  'LX',
  'OS',
  'SN',
  'LO',
  'SK',
  'AY',
  'TP',
  'A3',
  'W6',
  'FR',
  'U2',
  'EW',
  'DY',
  'VY',
  'HV',
  'DL',
  'UA',
  'AA',
  'AC',
  'SQ',
  'CX',
  'JL',
  'NH',
  'KE',
  'OZ',
  'ET',
  'MS',
  'SV',
  'RJ',
  'GF',
  'KU',
  'WY',
  'J2',
  'PS',
  'FZ',
  'G9',
  'KC',
  'HY',
  'BT',
  'OU',
  'JU',
  'RO',
  'FB',
];

/** Airports (IATA) validated in routes; Turkish airports first. */
export const AIRPORT_CODES: readonly string[] = [
  'IST',
  'SAW',
  'ESB',
  'ADB',
  'AYT',
  'DLM',
  'BJV',
  'TZX',
  'ADA',
  'GZT',
  'ASR',
  'DIY',
  'ERZ',
  'VAN',
  'SZF',
  'KYA',
  'MLX',
  'EZS',
  'GZP',
  'NAV',
  'HTY',
  'BAL',
  'LHR',
  'LGW',
  'CDG',
  'ORY',
  'FRA',
  'MUC',
  'BER',
  'DUS',
  'HAM',
  'CGN',
  'STR',
  'AMS',
  'BRU',
  'ZRH',
  'VIE',
  'FCO',
  'MXP',
  'MAD',
  'BCN',
  'LIS',
  'ATH',
  'CPH',
  'ARN',
  'OSL',
  'HEL',
  'WAW',
  'PRG',
  'BUD',
  'OTP',
  'SOF',
  'DXB',
  'DOH',
  'AUH',
  'JED',
  'RUH',
  'CAI',
  'TLV',
  'AMM',
  'BAH',
  'KWI',
  'GYD',
  'TBS',
  'ALA',
  'TAS',
  'JFK',
  'EWR',
  'ORD',
  'IAD',
  'LAX',
  'SFO',
  'YYZ',
  'NRT',
  'HND',
  'ICN',
  'SIN',
  'HKG',
  'PEK',
  'PVG',
  'DEL',
  'BOM',
];

const CONTEXT =
  /(?:ucus|sefer|kalkis|varis|binis|kapi|check-in|check in|bilet|rezervasyon|pnr|flight|departure|boarding|gate|havalimani|terminal)/u;

const FLIGHT_RE =
  /(?<![A-Z0-9])(?<al>[A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(?<no>\d{1,4})(?<sfx>[A-Z])?(?![A-Z0-9])/g;

export interface FlightMatch {
  /** Canonical form without spaces, e.g. `TK2412`. */
  readonly flightNo: string;
  readonly airline: string;
  readonly number: string;
  readonly span: readonly [number, number];
}

export function isKnownAirline(designator: string): boolean {
  return AIRLINE_DESIGNATORS.includes(designator);
}

export function isKnownAirport(code: string): boolean {
  return AIRPORT_CODES.includes(code);
}

/** Flight numbers with an allow-listed airline and a flight context word nearby. */
export function findFlightNumbers(text: string): FlightMatch[] {
  const out: FlightMatch[] = [];
  for (const m of text.matchAll(FLIGHT_RE)) {
    const al = m.groups?.al ?? '';
    const no = m.groups?.no ?? '';
    if (!isKnownAirline(al)) continue;
    const window = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
    if (!CONTEXT.test(foldTR(normalizeTR(window)))) continue;
    const flightNo = `${al}${no}${m.groups?.sfx ?? ''}`;
    if (out.some((f) => f.flightNo === flightNo)) continue;
    out.push({ flightNo, airline: al, number: no, span: [m.index, m.index + m[0].length] });
  }
  return out;
}

/** Airport codes in order of appearance (validated against {@link AIRPORT_CODES}). */
export function findAirports(text: string): string[] {
  return [...text.matchAll(/(?<![A-Z])([A-Z]{3})(?![A-Z])/g)]
    .map((m) => m[1] ?? '')
    .filter(isKnownAirport);
}

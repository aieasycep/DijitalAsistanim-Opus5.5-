/**
 * Turkish commitment detection (M§18, M§22; AI_PIPELINE_PLAN §6.9.6; TEST_PLAN §2.6). A promise
 * verb in first person ("gönderirim", "ararım", "dönerim", "iletirim", "hallederim",
 * "göndereceğim") near a date expression is a commitment candidate. Certainty is `firm`, `hedged`
 * ("belki", "sanırım", "-ebilirim") or `negated` ("göndermeyeceğim"; dropped). Hedged or
 * date-ambiguous commitments need confirmation (a `commitment_create` approval), never a silent
 * create. The direction follows the author: the user's own text → `user_owes`, a received mail →
 * `they_owe`.
 */
import type { CommitmentDirection } from '../enums.ts';
import { foldTR, normTR, originalSpan } from '../extract/normalize-tr.ts';
import {
  calibrateConfidence,
  COMMITMENT_DIRECT_CREATE_MIN,
  type SenderType,
} from '../grounding/calibrate.ts';
import type { Instant } from '../time/zone.ts';
import { type CommitmentDue, resolveCommitmentDue } from './due.ts';

export type CommitmentCertainty = 'firm' | 'hedged' | 'negated';

/** Who wrote the text the commitment was found in. */
export type CommitmentSourceKind = 'sent_mail' | 'received_mail' | 'user_note';

export interface CommitmentDetectOptions {
  readonly sourceKind: CommitmentSourceKind;
  /** Message `Date` (sent/received) or note time — the due-date anchor. */
  readonly anchor: Instant;
  readonly timeZone: string;
  /** Sender display name for received mail (the counterparty who owes). */
  readonly counterpartyName?: string | null;
  readonly senderType?: SenderType;
  /** Require a date expression within 60 chars (the LLM pre-signal rule; default true). */
  readonly requireDate?: boolean;
}

export interface CommitmentCandidate {
  readonly direction: CommitmentDirection;
  readonly certainty: CommitmentCertainty;
  /** The promise verb as written ("gönderirim"). */
  readonly trigger: string;
  /** The sentence (≤500 chars) — `commitments.text` before the user edits it. */
  readonly text: string;
  /** Verified evidence quote (≤300 chars) from the original text. */
  readonly quote: string;
  readonly span: readonly [number, number];
  readonly due: CommitmentDue | null;
  readonly counterpartyName: string | null;
  readonly confidence: number;
  /** Hedged, ambiguous due date or low confidence → ask the user ("Bu bir söz mü?"). */
  readonly needsConfirmation: boolean;
}

/** First-person (singular and plural) future / promissory aorist endings on folded text. */
const PROMISE =
  /(?<!\p{L})(\p{L}{2,}?(?:ecegim|acagim|ecegiz|acagiz|irim|urum|arim|erim|iriz|uruz|ariz|eriz))(?!\p{L})/gu;
const NEGATED_FUTURE = /(?:meyecegim|mayacagim|meyecegiz|mayacagiz)$/u;
const NEGATED_AORIST = /(?<!\p{L})(\p{L}{2,}(?:mem|mam|meyiz|mayiz))(?!\p{L})/gu;
const NOT_NEGATIONS = new Set(['tamam', 'hamam', 'imam', 'madam', 'hem', 'kem']);
/** Politeness / wishes that look like promises ("teşekkür ederim", "iyi günler dilerim"). */
const STOPLIST =
  /(?<!\p{L})(?:(?:tesekkur|rica|ozur|tebrik|iyi calismalar|iyi gunler|kolay gelsin)\p{L}*(?:\s+\p{L}+)?|umar\p{L}*|sanir\p{L}*|diler\p{L}*|sevinir\p{L}*|memnun olur\p{L}*|bilirim|dusunurum|gorusuruz)(?!\p{L})/gu;
const HEDGE =
  /(?<!\p{L})(?:belki|sanirim|galiba|bakariz|musait olursam|umarim|insallah bakarim|\p{L}+(?:ebilirim|abilirim|ebiliriz|abiliriz))(?!\p{L})/u;
const QUOTE_HEADER =
  /^(?:>|-{2,}\s*(?:original message|orijinal ileti|özgün ileti)|on .+ wrote:|.+ tarihinde .+ şunu yazdı:|kimden:|from:)/iu;

/** Removes quoted history (UT-COM-10): `>` lines and everything after a reply header. */
export function stripQuotedHistory(text: string): string {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (QUOTE_HEADER.test(t)) {
      if (t.startsWith('>')) continue;
      break;
    }
    out.push(line);
  }
  return out.join('\n');
}

interface Sentence {
  readonly text: string;
  readonly start: number;
}

function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  // Digit-aware split: a period followed by a digit ("25.09", "17.00") does not end a sentence.
  let buf = '';
  let bufStart = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? '';
    if (buf === '') bufStart = i;
    buf += ch;
    const next = text[i + 1] ?? '';
    const ends = ch === '\n' || ((ch === '.' || ch === '!' || ch === '?') && !/\d/.test(next));
    if (ends) {
      if (buf.trim()) out.push({ text: buf, start: bufStart });
      buf = '';
    }
  }
  if (buf.trim()) out.push({ text: buf, start: bufStart });
  return out;
}

function maskStoplist(folded: string): string {
  return folded.replace(STOPLIST, (m) => ' '.repeat(m.length));
}

/**
 * Commitment candidates in a text. Quoted history is ignored; each sentence yields at most one
 * candidate (the first promise verb near a date expression).
 */
export function detectCommitments(
  text: string,
  opts: CommitmentDetectOptions,
): CommitmentCandidate[] {
  const visible = stripQuotedHistory(text);
  const out: CommitmentCandidate[] = [];
  const requireDate = opts.requireDate ?? true;
  const direction: CommitmentDirection =
    opts.sourceKind === 'received_mail' ? 'they_owe' : 'user_owes';

  for (const s of sentences(visible)) {
    const norm = normTR(s.text);
    const folded = foldTR(norm.text);
    const masked = maskStoplist(folded);
    const promise = [...masked.matchAll(PROMISE)][0];
    const negAorist = [...masked.matchAll(NEGATED_AORIST)].find(
      (m) => !NOT_NEGATIONS.has(m[1] ?? ''),
    );
    const verb = promise ?? negAorist;
    if (!verb) continue;
    const verbText = verb[1] ?? '';
    const negated =
      NEGATED_FUTURE.test(verbText) || (promise === undefined && negAorist !== undefined);
    const hedged = HEDGE.test(folded);
    const certainty: CommitmentCertainty = negated ? 'negated' : hedged ? 'hedged' : 'firm';

    const [vs, ve] = originalSpan(norm, verb.index, verb.index + verbText.length);
    const due = resolveCommitmentDue(s.text, {
      anchor: opts.anchor,
      timeZone: opts.timeZone,
      near: vs,
    });
    if (due && Math.min(Math.abs(due.span[0] - ve), Math.abs(vs - due.span[1])) > 60) continue;
    if (!due && requireDate) continue;

    const trimmed = s.text.trim();
    const from = Math.min(vs, due?.span[0] ?? vs);
    const to = Math.max(ve, due?.span[1] ?? ve);
    const quote = s.text.slice(from, to).slice(0, 300);
    const confidence = calibrateConfidence({
      match: 'exact',
      parseAgrees: due !== null || !requireDate,
      precision: due?.precision ?? null,
      ambiguous: due?.ambiguous ?? false,
      certainty: certainty === 'hedged' ? 'hedged' : 'explicit',
      senderType: opts.senderType ?? 'unknown',
      explicitMarker: due?.by ?? false,
    });
    out.push({
      direction,
      certainty,
      trigger: s.text.slice(vs, ve),
      text: trimmed.slice(0, 500),
      quote,
      span: [s.start + from, s.start + to],
      due,
      counterpartyName: direction === 'they_owe' ? (opts.counterpartyName ?? null) : null,
      confidence,
      needsConfirmation:
        certainty !== 'firm' ||
        (due?.ambiguous ?? false) ||
        confidence < COMMITMENT_DIRECT_CREATE_MIN,
    });
  }
  return out;
}

/** Only actionable candidates: negated ones are dropped (counted as `grounding_dropped`). */
export function actionableCommitments(
  candidates: readonly CommitmentCandidate[],
): CommitmentCandidate[] {
  return candidates.filter((c) => c.certainty !== 'negated');
}

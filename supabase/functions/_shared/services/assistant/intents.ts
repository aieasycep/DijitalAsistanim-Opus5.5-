/**
 * Assistant intents (IMPLEMENTATION_PLAN T-5.11; AI_PIPELINE_PLAN §11.2; R-04). A deterministic
 * T0 grammar over the folded Turkish text answers the suggested prompts and detects write intents;
 * only when it misses does T1 `AssistantIntentV1` label the message (quotes must come from the
 * user's own words). Intents are labels only: the model never proposes or executes anything — code
 * turns a write intent into a pending approval, and approval stays a tap (R-03).
 */
import { foldTR, normalizeTR } from '@da/domain';
import {
  type AssistantIntent,
  AssistantIntentV1,
  refineAssistantIntentV1,
  WRITE_INTENTS,
} from '@da/validation';
import { callModel, type PipelineContext, trustedHeader } from '../ai/pipeline.ts';
import { parseSearchQuery } from '../memory/query-parse.ts';

export interface DetectedIntent {
  readonly intent: AssistantIntent;
  /** Capitalised name hints from the user's words ("Mehmet"). */
  readonly people: readonly string[];
  /** Date range named in the message ("yarın", "bu hafta", "geçen ay"), if any. */
  readonly from: Date | null;
  readonly to: Date | null;
  readonly topic: string | null;
  readonly tier: 't0' | 't1';
}

/**
 * A request ending: the bare imperative or its polite forms ("ekler misin", "yazsana",
 * "hatırlatır mısın"), then the end of a word. "Yanıt yazdım mı?" or "Hatırlatıcılarım neler?"
 * are questions, not write intents (R-04).
 */
const ASK = String.raw`(?:[aiu]?r m[iu]s[iu]n\w*|sana|abilir m[iu]s[iu]n)?(?:\s|$)`;
const ask = (pattern: string) => new RegExp(pattern.replaceAll('<ASK>', ASK), 'u');

const G: readonly (readonly [AssistantIntent, RegExp])[] = [
  ['smalltalk', /^(merhaba|selam|gunaydin|iyi aksamlar|tesekkur\w*|sagol\w*|eyvallah)[\s!.]*$/u],
  ['play_briefing', /brifing\w*\s+(oku|dinle|oynat|ac|baslat)/u],
  [
    'draft_follow_up',
    ask(String.raw`takip (mesaj|mail|e-?posta)\w*\s+(yaz|hazirla|olustur|gonder)<ASK>`),
  ],
  [
    'draft_reply',
    ask(String.raw`(taslak|yanit|cevap)\w*\s+(hazirla|yaz|olustur)<ASK>|(yanit|cevap) taslag`),
  ],
  [
    'move_event',
    ask(String.raw`(toplanti|etkinlik|gorusme)\w*\s+.*((ileri|geri) al|ertele|kaydir)<ASK>`),
  ],
  [
    'create_event',
    ask(
      String.raw`takvim\w*\s+ekle<ASK>|(toplanti|etkinlik|gorusme|randevu)\w*\s+(ekle|ayarla|olustur|planla|koy)<ASK>`,
    ),
  ],
  [
    'create_reminder',
    ask(String.raw`(^|\s)hatirlat<ASK>|hatirlat(ma|ici)\w*\s+(kur|ekle|olustur)<ASK>`),
  ],
  ['snooze_item', ask(String.raw`(yarina|haftaya|sonraya)\s+ertele<ASK>`)],
  [
    'reply_status_person',
    /(cevap|yanit|donus)\w*\s+(geldi mi|verdi mi|dondu mu)|(cevap|yanit)\s+vermem\s+gerekiyor\s+mu/u,
  ],
  [
    'who_needs_reply',
    /kimlere\s+(cevap|donus|yanit)|kim(ler)?\s+(benden\s+)?(cevap|yanit)\s+bekliyor/u,
  ],
  ['focus_today', /bugun\s+(neye\s+odaklan|ne(ler)?\s+var|nelere\s+bak|onceliklerim)/u],
  ['am_i_busy', /yogun\s+mu(y|s)?\w*|programim\s+nasil|bos\s+(vaktim|zamanim)\s+var\s+mi/u],
  ['deadlines_period', /son\s+tarih|deadline/u],
  ['payments_period', /odeme\w*|odenmesi\s+gereken|fatura\w*/u],
  ['travel_lookup', /(ucak|ucus|bilet|otel|rezervasyon)\w*/u],
  [
    'last_talk_with_person',
    /ile\s+en\s+son\s+ne\s+konus|hakkinda\s+(ne|neler)|en\s+son\s+ne\s+(dedi|yazdi)/u,
  ],
];

function fold(text: string): string {
  return foldTR(normalizeTR(text))
    .toLowerCase()
    .replace(/[?!.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The T0 grammar; null when no pattern matches (then T1 labels the message). */
export function matchGrammar(text: string, now: Date, timeZone: string): DetectedIntent | null {
  const q = fold(text);
  const hit = G.find(([, re]) => re.test(q));
  if (hit === undefined) return null;
  const parsed = parseSearchQuery(text, now, timeZone);
  return {
    intent: hit[0],
    people: parsed.personHints,
    from: parsed.from,
    to: parsed.to,
    topic: parsed.text.trim() === '' ? null : parsed.text.trim().slice(0, 120),
    tier: 't0',
  };
}

export function isWriteIntent(intent: AssistantIntent): boolean {
  return WRITE_INTENTS.includes(intent);
}

export type IntentOutcome =
  | { readonly kind: 'ok'; readonly intent: DetectedIntent }
  | { readonly kind: 't0'; readonly reason: string };

/** T0 grammar first, then T1 `AssistantIntentV1` over the user's own message (`q1`). */
export async function detectIntent(
  pipeline: PipelineContext,
  input: { readonly text: string; readonly now: Date; readonly history: readonly string[] },
): Promise<IntentOutcome> {
  const tz = pipeline.user.timeZone;
  const t0 = matchGrammar(input.text, input.now, tz);
  if (t0 !== null) return { kind: 'ok', intent: t0 };
  const result = await callModel(pipeline, {
    feature: 'assistant_intent',
    schema: AssistantIntentV1,
    schemaName: 'AssistantIntentV1',
    context: [
      ...trustedHeader(pipeline.user, input.now),
      ...input.history.slice(-2).map((h, i) => `Önceki mesaj ${i + 1}: ${h.slice(0, 200)}`),
    ],
    docs: [{ ref: 'q1', kind: 'transcript', text: input.text }],
    units: 1,
    cacheContent: `assistant_intent\n${fold(input.text)}`,
  });
  if (result.kind !== 'ai') return { kind: 't0', reason: result.reason };
  const refined = refineAssistantIntentV1(result.data, { aliases: [], userMessage: input.text });
  if (!refined.ok) return { kind: 't0', reason: 'refine_failed' };
  const data = refined.data;
  const period =
    data.period_quote === null ? null : parseSearchQuery(data.period_quote, input.now, tz);
  const people = [
    ...(data.person_quote === null ? [] : [data.person_quote.replace(/['’].*$/, '').trim()]),
    ...parseSearchQuery(input.text, input.now, tz).personHints,
  ].filter((p, i, all) => p !== '' && all.indexOf(p) === i);
  return {
    kind: 'ok',
    intent: {
      intent: data.confidence === 'low' && isWriteIntent(data.intent) ? 'memory_qa' : data.intent,
      people,
      from: period?.from ?? null,
      to: period?.to ?? null,
      topic: data.topic_quote,
      tier: 't1',
    },
  };
}

import { z } from 'zod';
import { LIFE_EVENT_TYPE_VALUES } from '@da/domain';
import {
  Confidence,
  Evidence,
  Ref,
  Refiner,
  cleanText,
  type BaseRefineContext,
  type RefineResult,
} from './common.ts';

// ── §4.3.14 AssistantIntentV1 · prompt `assistant_intent` ────────────────────
export const AssistantIntent = z.enum([
  'focus_today',
  'who_needs_reply',
  'am_i_busy',
  'last_talk_with_person',
  'deadlines_period',
  'payments_period',
  'travel_lookup',
  'play_briefing',
  'reply_status_person',
  'draft_reply',
  'draft_follow_up',
  'create_reminder',
  'create_event',
  'move_event',
  'snooze_item',
  'memory_qa',
  'smalltalk',
  'unsupported',
]);
export type AssistantIntent = z.infer<typeof AssistantIntent>;
export const AssistantIntentV1 = z.strictObject({
  intent: AssistantIntent,
  person_quote: z.string().nullable(),
  period_quote: z.string().nullable(),
  topic_quote: z.string().nullable(),
  target_ref: Ref.nullable(),
  confidence: Confidence,
});
export type AssistantIntentV1 = z.infer<typeof AssistantIntentV1>;

/** Intents that become a server-built approval proposal (R-04); every other intent is read-only. */
export const WRITE_INTENTS: readonly AssistantIntent[] = [
  'draft_reply',
  'draft_follow_up',
  'create_reminder',
  'create_event',
  'move_event',
];

export const ASSISTANT_INTENT_LIMITS = { quote_chars: 120 } as const;

export interface AssistantIntentRefineContext extends BaseRefineContext {
  /** The user's own message: every `*_quote` must be a substring of it (case-insensitive). */
  readonly userMessage: string;
}

/** Quotes must come from the user's own message; an unknown `target_ref` becomes null. */
export function refineAssistantIntentV1(
  parsed: AssistantIntentV1,
  ctx: AssistantIntentRefineContext,
): RefineResult<AssistantIntentV1> {
  const r = new Refiner(ctx.aliases);
  const message = cleanText(ctx.userMessage).toLocaleLowerCase('tr-TR');
  const quote = (value: string | null, path: string): string | null => {
    if (value === null) return null;
    const text = cleanText(value);
    if (
      text === '' ||
      text.length > ASSISTANT_INTENT_LIMITS.quote_chars ||
      !message.includes(text.toLocaleLowerCase('tr-TR'))
    ) {
      r.drop(path, 'not_allowed');
      return null;
    }
    return text;
  };
  const target =
    parsed.target_ref !== null && r.ref(parsed.target_ref, 'target_ref') ? parsed.target_ref : null;
  return r.result({
    intent: parsed.intent,
    person_quote: quote(parsed.person_quote, 'person_quote'),
    period_quote: quote(parsed.period_quote, 'period_quote'),
    topic_quote: quote(parsed.topic_quote, 'topic_quote'),
    target_ref: target,
    confidence: parsed.confidence,
  });
}

// ── §4.3.15 AssistantGroundedJsonV1 · non-Anthropic fallback ─────────────────
export const AssistantGroundedJsonV1 = z.strictObject({
  sentences: z.array(z.strictObject({ text_tr: z.string(), quotes: z.array(Evidence) })),
  unknown: z.boolean(),
  injection_suspected: z.boolean(),
});
export type AssistantGroundedJsonV1 = z.infer<typeof AssistantGroundedJsonV1>;

/** Every sentence keeps only well-formed quotes on `r1..r6`; uncited sentences are dropped. */
export function refineAssistantGroundedJsonV1(
  parsed: AssistantGroundedJsonV1,
  ctx: BaseRefineContext,
): RefineResult<AssistantGroundedJsonV1> {
  const r = new Refiner(ctx.aliases);
  const sentences = parsed.sentences
    .map((sentence, i) => ({
      text_tr: cleanText(sentence.text_tr),
      quotes: sentence.quotes.filter(
        (q, j) => /^r\d$/.test(q.ref) && r.evidence(q, `sentences.${i}.quotes.${j}`),
      ),
    }))
    .filter((sentence, i) => {
      if (sentence.text_tr === '' || sentence.quotes.length === 0) {
        r.drop(`sentences.${i}`, 'empty');
        return false;
      }
      return true;
    });
  return r.result({
    sentences,
    unknown: parsed.unknown || sentences.length === 0,
    injection_suspected: parsed.injection_suspected,
  });
}

// ── Rich cards (`card` SSE events and `AssistantAnswerV1.rich_cards`) ───────
export const AssistantListKind = z.enum([
  'waiting_on_you',
  'events',
  'deadlines',
  'payments',
  'person_choice',
  'done_internal',
]);
export const RichCardBadge = z.enum([
  'ACİL',
  'SON TARİH',
  'TOPLANTI',
  'TAKİP',
  'KİŞİSEL',
  'GÜVENLİK',
]);
export const AssistantListItem = z.strictObject({
  entity_type: z.string(),
  entity_id: z.string(),
  title: z.string(),
  meta: z.string().nullable(),
  badge: RichCardBadge.nullable(),
  route: z.string(),
});
/**
 * The typed card union. On the wire (API-AST-02) a card is `{type, data, route}`: `list` carries
 * `data.kind`; `event` is a single calendar event; `mail`, `person` and `life` map one to one.
 * `sources` are `citation` events and drafts are `action_proposal` events, never cards.
 */
export const AssistantRichCardV1 = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('list'),
    route: z.string(),
    data: z.strictObject({
      kind: AssistantListKind,
      title: z.string(),
      items: z.array(AssistantListItem),
      undo_token: z.string().nullable(),
    }),
  }),
  z.strictObject({
    type: z.literal('event'),
    route: z.string(),
    data: z.strictObject({
      event_id: z.string(),
      title: z.string(),
      start_at: z.string(),
      end_at: z.string(),
      time_label: z.string(),
      location: z.string().nullable(),
      prep_available: z.boolean(),
    }),
  }),
  z.strictObject({
    type: z.literal('mail'),
    route: z.string(),
    data: z.strictObject({
      email_message_id: z.string(),
      sender_label: z.string(),
      subject: z.string(),
      time_label: z.string(),
      provider: z.enum(['google', 'microsoft', 'demo']),
    }),
  }),
  z.strictObject({
    type: z.literal('person'),
    route: z.string(),
    data: z.strictObject({
      contact_id: z.string(),
      name: z.string(),
      org: z.string().nullable(),
      last_contact_label: z.string().nullable(),
      is_vip: z.boolean(),
    }),
  }),
  z.strictObject({
    type: z.literal('life'),
    route: z.string(),
    data: z.strictObject({
      life_event_id: z.string(),
      life_event_type: z.enum(LIFE_EVENT_TYPE_VALUES),
      key_fact: z.string(),
      time_label: z.string().nullable(),
    }),
  }),
]);
export type AssistantRichCardV1 = z.infer<typeof AssistantRichCardV1>;

// ── §4.3.16 AssistantAnswerV1 · server view model (SSE + assistant_messages) ─
export const SourceCard = z.strictObject({
  result_index: z.number(),
  source_type: z.string(),
  icon: z.string(),
  src_label: z.string(),
  date_label: z.string(),
  title: z.string(),
  summary: z.string(),
  deeplink: z.string(),
  page_no: z.number().nullable(),
});
export const AssistantAnswerV1 = z.strictObject({
  message_id: z.string(),
  route: z.enum(['template', 'grounded_qa', 'proposal']),
  blocks: z.array(
    z.strictObject({
      text: z.string(),
      verified: z.boolean(),
      citations: z.array(z.strictObject({ result_index: z.number(), cited_text: z.string() })),
    }),
  ),
  source_cards: z.array(SourceCard),
  rich_cards: z.array(AssistantRichCardV1),
  proposed_actions: z.array(z.strictObject({ approval_id: z.string(), action_type: z.string() })),
  coverage: z.number().nullable(),
  confidence_label: z.enum(['high', 'medium', 'low']).nullable(),
  unknown: z.boolean(),
  followup_suggestions: z.array(z.string()),
});
export type AssistantAnswerV1 = z.infer<typeof AssistantAnswerV1>;

export const ASSISTANT_ANSWER_LIMITS = { followup_suggestions: 3, suggestion_chars: 120 } as const;

/**
 * Citations must point at a source card; unverified grounded-QA blocks are removed; coverage stays in
 * [0, 1]; no blocks left means `unknown=true`.
 */
export function refineAssistantAnswerV1(
  parsed: AssistantAnswerV1,
): RefineResult<AssistantAnswerV1> {
  const r = new Refiner([]);
  const indexes = new Set(parsed.source_cards.map((card) => card.result_index));
  if (indexes.size !== parsed.source_cards.length) r.fail('duplicate_source_index');
  const blocks = parsed.blocks
    .map((block, i) => ({
      ...block,
      citations: block.citations.filter((c, j) => {
        if (indexes.has(c.result_index)) return true;
        r.drop(`blocks.${i}.citations.${j}`, 'bad_ref');
        return false;
      }),
    }))
    .filter((block, i) => {
      if (parsed.route === 'grounded_qa' && !block.verified) {
        r.drop(`blocks.${i}`, 'not_allowed');
        return false;
      }
      return block.text.trim() !== '';
    });
  if (parsed.coverage !== null && !(parsed.coverage >= 0 && parsed.coverage <= 1))
    r.fail('coverage_out_of_range');
  const suggestions = r
    .cap(
      parsed.followup_suggestions,
      ASSISTANT_ANSWER_LIMITS.followup_suggestions,
      'followup_suggestions',
    )
    .map((s, i) =>
      r.text(s, ASSISTANT_ANSWER_LIMITS.suggestion_chars, `followup_suggestions.${i}`),
    );
  return r.result({
    ...parsed,
    blocks,
    unknown: parsed.unknown || blocks.length === 0,
    followup_suggestions: suggestions,
  });
}

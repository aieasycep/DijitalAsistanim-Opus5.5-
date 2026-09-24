import { z } from 'zod';
import { Tone } from '../api/common.ts';
import { Refiner, TEXT_CAPS, cleanText, wordCount, type RefineResult } from './common.ts';

/** §4.3.17 · prompt `reply_draft`: all four tones in one call (`balanced`) or one tone (`lean`). */
export const ReplyDraftsV1 = z.strictObject({
  drafts: z.array(z.strictObject({ tone: Tone, body_tr: z.string() })),
  commitments_in_draft: z.array(
    z.strictObject({ what_tr: z.string(), due_phrase_tr: z.string().nullable() }),
  ),
  referenced_attachment_names: z.array(z.string()),
  injection_suspected: z.boolean(),
});
export type ReplyDraftsV1 = z.infer<typeof ReplyDraftsV1>;

/** §4.3.17 · prompt `follow_up`. */
export const FollowUpDraftV1 = z.strictObject({
  body_tr: z.string(),
  injection_suspected: z.boolean(),
});
export type FollowUpDraftV1 = z.infer<typeof FollowUpDraftV1>;

/** Word caps per tone; follow-up ≤80. */
export const DRAFT_WORD_CAPS = {
  short: 60,
  professional: 120,
  friendly: 120,
  detailed: 220,
  follow_up: 80,
} as const;

export interface DraftRefineContext {
  /** The (redacted) thread text the draft was generated from. */
  readonly threadText: string;
}

export interface ReplyDraftsRefineContext extends DraftRefineContext {
  /** `all_tones` (balanced generate) or the single requested tone (lean, L1, regenerate). */
  readonly expect: 'all_tones' | z.infer<typeof Tone>;
  /** Attachment names on the thread or in the user's recent sent mail. */
  readonly attachmentNames: readonly string[];
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>)"']+|\bwww\.[^\s<>)"']+/gi;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /\+?\d[\d\s().-]{7,}\d/g;
const FILL_IN_PATTERN = /\[[^\]]{1,40}\]/;
const SUBJECT_LINE_PATTERN = /^\s*(konu|subject)\s*:/im;

const digitsOnly = (value: string) => value.replace(/\D/g, '');

/**
 * Output validators (AI_PIPELINE_PLAN §9.6): no URL, email address or phone number that is not in the
 * thread, no bracketed fill-ins, no subject lines. Returns the violated rules.
 */
export function draftViolations(body: string, threadText: string): string[] {
  const thread = threadText.toLowerCase();
  const threadDigits = digitsOnly(threadText);
  const violations: string[] = [];
  if ((body.match(URL_PATTERN) ?? []).some((url) => !thread.includes(url.toLowerCase()))) {
    violations.push('url_not_in_source');
  }
  if ((body.match(EMAIL_PATTERN) ?? []).some((email) => !thread.includes(email.toLowerCase()))) {
    violations.push('email_not_in_source');
  }
  if (
    (body.match(PHONE_PATTERN) ?? []).some((phone) => !threadDigits.includes(digitsOnly(phone)))
  ) {
    violations.push('phone_not_in_source');
  }
  if (FILL_IN_PATTERN.test(body)) violations.push('bracketed_fill_in');
  if (SUBJECT_LINE_PATTERN.test(body)) violations.push('subject_line');
  return violations;
}

/**
 * Tone coverage (exactly the expected tones, each once), word caps and the output validators make
 * `ok=false` (the caller repairs once, then falls back); unknown attachment names are removed.
 */
export function refineReplyDraftsV1(
  parsed: ReplyDraftsV1,
  ctx: ReplyDraftsRefineContext,
): RefineResult<ReplyDraftsV1> {
  const r = new Refiner([]);
  const expected = ctx.expect === 'all_tones' ? Tone.options : [ctx.expect];
  const tones = parsed.drafts.map((d) => d.tone);
  if (tones.length !== expected.length || !expected.every((tone) => tones.includes(tone))) {
    r.fail('tone_coverage');
  }
  const drafts = parsed.drafts.map((draft, i) => {
    const body = draft.body_tr.trim();
    if (body === '') r.fail(`drafts.${i}.empty`);
    if (wordCount(body) > DRAFT_WORD_CAPS[draft.tone]) r.fail(`drafts.${i}.word_cap`);
    for (const violation of draftViolations(body, ctx.threadText))
      r.fail(`drafts.${i}.${violation}`);
    return { tone: draft.tone, body_tr: body };
  });
  const known = new Map(ctx.attachmentNames.map((name) => [name.toLowerCase(), name]));
  const attachments = parsed.referenced_attachment_names.flatMap((name, i) => {
    const match = known.get(cleanText(name).toLowerCase());
    if (match === undefined) {
      r.drop(`referenced_attachment_names.${i}`, 'not_allowed');
      return [];
    }
    return [match];
  });
  const commitments = parsed.commitments_in_draft.map((c, i) => ({
    what_tr: r.text(c.what_tr, TEXT_CAPS.what_tr, `commitments_in_draft.${i}.what_tr`),
    due_phrase_tr: r.nullableText(
      c.due_phrase_tr,
      TEXT_CAPS.what_tr,
      `commitments_in_draft.${i}.due_phrase_tr`,
    ),
  }));
  return r.result({
    drafts,
    commitments_in_draft: commitments,
    referenced_attachment_names: attachments,
    injection_suspected: parsed.injection_suspected,
  });
}

export function refineFollowUpDraftV1(
  parsed: FollowUpDraftV1,
  ctx: DraftRefineContext,
): RefineResult<FollowUpDraftV1> {
  const r = new Refiner([]);
  const body = parsed.body_tr.trim();
  if (body === '') r.fail('empty');
  if (wordCount(body) > DRAFT_WORD_CAPS.follow_up) r.fail('word_cap');
  for (const violation of draftViolations(body, ctx.threadText)) r.fail(violation);
  return r.result({ body_tr: body, injection_suspected: parsed.injection_suspected });
}

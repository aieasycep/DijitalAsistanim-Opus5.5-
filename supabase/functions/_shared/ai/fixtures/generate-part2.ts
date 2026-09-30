/**
 * Input-aware fixture outputs of the part-2 prompt keys (IMPLEMENTATION_PLAN T-5.09…T-5.15;
 * AI_PIPELINE_PLAN §15.5): `post_meeting`, `meeting_prep`, `reply_draft`, `follow_up`, `capture`
 * (text / page / PDF pages) and `assistant_intent`. Like the part-1 generators they only quote
 * the prompt's own documents verbatim and use the Turkish T0 extractors, so the grounding
 * verifier treats them exactly like model answers. Demo mode and the tests run on them.
 */
import { detectCommitments, parseAmountsTR, parseDatesTR, prescanInjection } from '@da/domain';
import { parseUntrusted } from '../prompts/assemble.ts';
import type { GenerateStructuredParams } from '../types.ts';
import { sentences } from './sentences.ts';

type Params = GenerateStructuredParams<unknown>;
type Doc = { ref: string; kind: string; text: string };

const ANCHOR = new Date('2026-01-01T09:00:00.000Z');
const TZ = 'Europe/Istanbul';
const TONES = ['short', 'professional', 'friendly', 'detailed'] as const;

const cap = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n)).trim();

function docs(params: Params): Doc[] {
  return parseUntrusted(params.prompt.untrusted);
}

function sentencesOf(text: string): string[] {
  return sentences(text).map((s) => s.text);
}

function contextValue(params: Params, label: string): string | null {
  const line = (params.prompt.userContext ?? '')
    .split('\n')
    .find((l) => l.startsWith(`${label}: `));
  return line === undefined ? null : line.slice(label.length + 2).trim();
}

/** Capitalised name before an apostrophe or "ile" ("Mehmet'e", "Ayşe ile"). */
function nameIn(text: string): string | null {
  const m = /(?<!\p{L})(\p{Lu}\p{Ll}{1,30})(?=['’]\p{L}|\s+ile\b)/u.exec(text);
  return m?.[1] ?? null;
}

function injected(all: readonly Doc[]): boolean {
  return all.some((d) => prescanInjection(d.text).suspected);
}

export const PART2_GENERATORS: Readonly<Record<string, (params: Params) => unknown>> = {
  PostMeetingCommitmentV1(params) {
    const note = docs(params).find((d) => d.ref === 'n1');
    if (note === undefined) return undefined;
    const items = detectCommitments(note.text, {
      sourceKind: 'sent_mail',
      anchor: ANCHOR,
      timeZone: TZ,
      requireDate: false,
    })
      .filter((c) => c.certainty !== 'negated')
      .slice(0, 6)
      .map((c) => {
        const sentence = sentencesOf(note.text).find((s) => s.includes(c.quote.trim())) ?? c.quote;
        const quote = cap(sentence, 200);
        const date = parseDatesTR(quote, { anchor: ANCHOR, timeZone: TZ })[0];
        return {
          owner: 'user' as const,
          what_tr: cap(c.text, 80),
          counterparty_quote: nameIn(quote),
          due_quote: date === undefined ? null : quote.slice(date.span[0], date.span[1]),
          evidence: { ref: 'n1', quote },
          certainty: c.certainty === 'hedged' ? ('hedged' as const) : ('explicit' as const),
        };
      });
    return {
      items,
      note_summary_tr: null,
      injection_suspected: prescanInjection(note.text).suspected,
    };
  },
  MeetingPrepV1(params) {
    const all = docs(params);
    const first = (d: Doc) => cap(sentencesOf(d.text)[0] ?? d.text, 200);
    const purposeDoc = all.find((d) => d.ref === 'e1') ?? all.find((d) => d.ref.startsWith('m'));
    const pointDocs = all.filter((d) => d.ref !== 'e1').slice(0, 3);
    const points = (pointDocs.length > 0 ? pointDocs : all.slice(0, 1)).map((d) => {
      const quote = first(d);
      return {
        title_tr: cap(quote.split(/\s+/).slice(0, 3).join(' '), 24),
        body_tr: cap(quote, 140),
        refs: [d.ref],
        evidence: { ref: d.ref, quote },
      };
    });
    const mail = all.find((d) => d.ref.startsWith('m'));
    return {
      purpose:
        purposeDoc === undefined
          ? { text_tr: '', basis: 'inferred', evidence: null }
          : {
              text_tr: first(purposeDoc),
              basis: purposeDoc.ref === 'e1' ? 'invite_description' : 'email',
              evidence: { ref: purposeDoc.ref, quote: first(purposeDoc) },
            },
      talking_points: points,
      last_interaction:
        mail === undefined
          ? null
          : {
              text_tr: first(mail),
              refs: [mail.ref],
              evidence: { ref: mail.ref, quote: first(mail) },
            },
      open_loops: [],
      summary_2min:
        points.length === 0
          ? []
          : [
              {
                text_tr: points.map((p) => p.body_tr).join(' '),
                refs: points.flatMap((p) => p.refs),
              },
            ],
      injection_suspected: injected(all),
      confidence: purposeDoc?.ref === 'e1' ? 'high' : 'medium',
    };
  },
  ReplyDraftsV1(params) {
    const all = docs(params);
    const tones = (contextValue(params, 'Tonlar') ?? TONES.join(', '))
      .split(',')
      .map((t) => t.trim())
      .filter((t): t is (typeof TONES)[number] => (TONES as readonly string[]).includes(t));
    const name = contextValue(params, 'Alıcı');
    const hello = name === null ? 'Merhaba,' : `Merhaba ${name},`;
    const bodies: Record<(typeof TONES)[number], string> = {
      short: `${hello} mesajın için teşekkürler, konuya bakıp dönüş yapacağım.`,
      professional: `${hello} mesajınız için teşekkür ederim. Konuyu inceleyip en kısa sürede size dönüş yapacağım.`,
      friendly: `${hello} yazdığın için çok teşekkürler! Hemen bakıp sana haber vereceğim.`,
      detailed: `${hello} mesajınız için teşekkür ederim. Talebinizi dikkatle inceliyorum ve gerekli kontrolleri tamamladıktan sonra ayrıntılı bir dönüş yapacağım. Ek bir bilgiye ihtiyaç duyarsam ayrıca yazacağım.`,
    };
    return {
      drafts: tones.map((tone) => ({ tone, body_tr: bodies[tone] })),
      commitments_in_draft: [],
      referenced_attachment_names: [],
      injection_suspected: injected(all),
    };
  },
  FollowUpDraftV1(params) {
    const all = docs(params);
    const name = contextValue(params, 'Alıcı');
    return {
      body_tr: `${name === null ? 'Merhaba,' : `Merhaba ${name},`} önceki mesajımla ilgili dönüşünü bekliyorum. Uygun olduğunda paylaşabilirsen sevinirim.`,
      injection_suspected: injected(all),
    };
  },
  CaptureExtractV1(params) {
    const all = docs(params);
    const items: unknown[] = [];
    for (const d of all) {
      for (const sentence of sentencesOf(d.text)) {
        if (items.length >= 12) break;
        const quote = cap(sentence, 200);
        const date = parseDatesTR(quote, { anchor: ANCHOR, timeZone: TZ })[0];
        const amount = parseAmountsTR(quote)[0];
        if (amount !== undefined) {
          items.push({
            kind: 'payment',
            payee_quote: null,
            amount_quote: quote.slice(amount.span[0], amount.span[1]),
            due_quote: date === undefined ? null : quote.slice(date.span[0], date.span[1]),
            reference_quote: null,
            evidence: { ref: d.ref, quote },
          });
        } else if (date !== undefined && date.by) {
          items.push({
            kind: 'deadline',
            what_tr:
              cap(quote.replace(quote.slice(date.span[0], date.span[1]), '').trim(), 80) || quote,
            when_quote: quote.slice(date.span[0], date.span[1]),
            section_quote: null,
            evidence: { ref: d.ref, quote },
          });
        } else if (date !== undefined) {
          items.push({
            kind: 'event',
            title_tr:
              cap(quote.replace(quote.slice(date.span[0], date.span[1]), '').trim(), 80) || quote,
            date_quote: quote.slice(date.span[0], date.span[1]),
            time_quote: null,
            end_quote: null,
            place_quote: null,
            section_quote: null,
            evidence: { ref: d.ref, quote },
          });
        }
      }
    }
    const first = sentencesOf(all[0]?.text ?? '')[0] ?? '';
    return {
      doc_type: items.some((i) => (i as { kind: string }).kind === 'event') ? 'event' : 'note',
      link_type: all.some((d) => d.ref === 'w1') ? 'content' : null,
      title_tr: cap(first, 120),
      summary_tr: null,
      transcript: [],
      items,
      injection_suspected: injected(all),
      confidence: items.length > 0 ? 'high' : 'low',
    };
  },
  AssistantIntentV1(params) {
    const q = docs(params).find((d) => d.ref === 'q1');
    if (q === undefined) return undefined;
    const person =
      nameIn(q.text) ??
      /(?<!\p{L})(\p{Lu}\p{Ll}{1,30})(?!\p{L})/u.exec(q.text.slice(1))?.[1] ??
      null;
    return {
      intent: 'memory_qa',
      person_quote: person !== null && q.text.includes(person) ? person : null,
      period_quote: null,
      topic_quote: null,
      target_ref: null,
      confidence: 'medium',
    };
  },
};

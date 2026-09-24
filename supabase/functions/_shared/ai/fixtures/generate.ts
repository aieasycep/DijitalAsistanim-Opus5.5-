/**
 * Input-aware fixture outputs (AI_PIPELINE_PLAN §15.5; T-5.16): when a structured fixture file has
 * no `by_input` entry for a prompt, the fixture provider derives a deterministic, schema-valid
 * answer from the prompt's own untrusted documents with the Turkish T0 extractors. Every quote is
 * a verbatim substring of its document, so the grounding verifier treats fixture answers exactly
 * like model answers; nothing is invented. This is the "fixture baseline" of the eval sets and
 * what demo mode and the tests run on without provider credentials.
 */
import {
  detectCommitments,
  detectExpectsReply,
  findTrackingNumbers,
  foldTR,
  normalizeTR,
  parseAmountsTR,
  parseDatesTR,
  prescanInjection,
} from '@da/domain';
import type { GenerateStructuredParams } from '../types.ts';
import { parseUntrusted } from '../prompts/assemble.ts';

type Doc = { ref: string; kind: string; text: string };

const ANCHOR = new Date('2026-01-01T09:00:00.000Z');
const TZ = 'Europe/Istanbul';

/** Sentences with their offsets (quotes are exact substrings). */
export function sentences(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  const re = /[^.!?\n]+[.!?]*/g;
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    if (trimmed.length >= 3) out.push({ text: trimmed, start: (m.index ?? 0) + lead });
  }
  return out;
}

const cap = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n));
const fold = (s: string) => foldTR(normalizeTR(s));

function quoteOf(sentence: string): string {
  return cap(sentence, 200).trim();
}

const REQUEST =
  /(\?|rica ederim|iletir misiniz|iletebilir misiniz|gonderebilir misiniz|gonderir misiniz|paylasabilir misiniz|donus yapabilir|donusunuzu bekliyorum|onaylar misiniz|teyit eder misiniz|bilgi verebilir misiniz|yanitlar misiniz|musait misiniz|uygun musunuz|haber verir misiniz)/u;
const BULK =
  /(abonelikten cik|bulten|kampanya|indirim|firsat|kupon|newsletter|unsubscribe|sadece bugune ozel|kacirma|%\s?\d+|puan kazan|yeni koleksiyon)/u;
const URGENT = /(?<!\p{L})(acil|ivedi|hemen)(?!\p{L})/u;
const FYI = /(bilginize|bilgi icin|bilgilendirme|fyi|duyuru)/u;
const IMPORTANT_TOPIC = /(sozlesme|teklif|fatura|odeme|toplanti|sunum|rapor|butce|proje|imza)/u;
const SCHEDULE =
  /(toplanti|gorusme|randevu).{0,60}(ertele|iptal|kaydir|baska bir (gun|saat)|uygun musun|musait misiniz|saat degis)/u;
const LIFE: readonly [
  RegExp,
  'shipment' | 'flight' | 'reservation' | 'payment' | 'subscription',
][] = [
  [/(kargo|siparisiniz|teslim edildi|dagitima cikti|gonderi takip)/u, 'shipment'],
  [/(ucus|boarding|check-?in|pnr|bilet no|biniş|binis karti)/u, 'flight'],
  [/(rezervasyon)/u, 'reservation'],
  [/(son odeme|fatura tutari|faturaniz|ekstre|odeme tarihi)/u, 'payment'],
  [/(aboneliginiz|yenilenecek|yenilendi|deneme sureniz)/u, 'subscription'],
];

function docsOf(params: GenerateStructuredParams<unknown>): Doc[] {
  return parseUntrusted(params.prompt.untrusted);
}

function deadlineClaims(doc: Doc) {
  const found = parseDatesTR(doc.text, { anchor: ANCHOR, timeZone: TZ }).filter((d) => d.by);
  return found.slice(0, 3).flatMap((d) => {
    const when = doc.text.slice(d.span[0], d.span[1]);
    const sentence = sentences(doc.text).find(
      (s) => s.start <= d.span[0] && s.start + s.text.length >= d.span[1],
    );
    if (sentence === undefined || when.trim().length < 3) return [];
    return [
      {
        what_tr: cap(sentence.text.replace(/\s+/g, ' '), 80),
        when_quote: when,
        evidence: { ref: doc.ref, quote: quoteOf(sentence.text) },
        certainty: 'explicit' as const,
      },
    ];
  });
}

function triageItem(doc: Doc, context: string) {
  const f = fold(doc.text);
  const all = sentences(doc.text);
  const body = all.slice(1);
  const ask = all.find((s) => REQUEST.test(fold(s.text)));
  const bulk = BULK.test(f);
  const deadlines = bulk ? [] : deadlineClaims(doc);
  const life = LIFE.find(([re]) => re.test(f));
  const lifeSentence = life === undefined ? undefined : all.find((s) => life[0].test(fold(s.text)));
  const scheduleSentence = all.find((s) => SCHEDULE.test(fold(s.text)));
  const promise = detectCommitments(doc.text, {
    sourceKind: 'received_mail',
    anchor: ANCHOR,
    timeZone: TZ,
  }).find((c) => c.certainty === 'firm');
  const meta = context.split('\n').find((l) => l.startsWith(`${doc.ref}:`)) ?? '';
  const vip = /vip evet/.test(meta);
  const needsReply = !bulk && ask !== undefined;
  const important =
    !bulk &&
    (needsReply ||
      deadlines.length > 0 ||
      vip ||
      (IMPORTANT_TOPIC.test(f) && !FYI.test(f) && life === undefined));
  const category = bulk
    ? 'low_priority'
    : needsReply
      ? 'awaiting_my_reply'
      : deadlines.length > 0
        ? 'has_deadline'
        : important
          ? 'important'
          : 'informational';
  const today = deadlines.some((d) => /bugun|bu aksam|bu ogleden/u.test(fold(d.when_quote)));
  const urgency = bulk
    ? 'low'
    : URGENT.test(f)
      ? 'urgent'
      : today
        ? 'today'
        : needsReply
          ? 'today'
          : 'normal';
  const reason = bulk
    ? 'promotion'
    : needsReply
      ? 'direct_request'
      : deadlines.length > 0
        ? 'deadline_mentioned'
        : scheduleSentence !== undefined
          ? 'meeting_change'
          : life !== undefined
            ? life[1] === 'shipment'
              ? 'delivery'
              : life[1] === 'flight'
                ? 'travel'
                : 'transactional'
            : FYI.test(f)
              ? 'fyi_cc'
              : important
                ? 'known_sender'
                : 'other';
  const REASON_TR: Record<string, string> = {
    promotion: 'Tanıtım içerikli toplu gönderim.',
    direct_request: 'Senden doğrudan bir yanıt isteniyor.',
    deadline_mentioned: 'Mailde bir son tarih geçiyor.',
    meeting_change: 'Bir toplantı değişikliği isteniyor.',
    delivery: 'Kargo bildirimi.',
    travel: 'Seyahat bildirimi.',
    transactional: 'İşlem bildirimi.',
    fyi_cc: 'Bilgilendirme amaçlı.',
    known_sender: 'İş açısından önemli bir konu.',
    other: 'Bilgilendirme amaçlı.',
  };
  const first = body[0] ?? all[0];
  return {
    ref: doc.ref,
    category,
    important,
    urgency,
    needs_reply: needsReply,
    reply_ask_tr: ask === undefined || !needsReply ? null : cap(ask.text, 140),
    reply_evidence:
      ask === undefined || !needsReply ? null : { ref: doc.ref, quote: quoteOf(ask.text) },
    reason_code: reason,
    reason_tr: REASON_TR[reason] ?? 'Bilgilendirme amaçlı.',
    summary_tr: first === undefined ? null : cap(first.text, 180),
    key_points_tr: important ? body.slice(0, 2).map((s) => cap(s.text, 80)) : [],
    deadlines,
    life_signal: life?.[1] ?? 'none',
    life_evidence:
      lifeSentence === undefined ? null : { ref: doc.ref, quote: quoteOf(lifeSentence.text) },
    schedule_request:
      scheduleSentence === undefined
        ? null
        : {
            kind: /iptal/u.test(fold(scheduleSentence.text)) ? 'cancel' : 'reschedule',
            requested_time_quote: null,
            evidence: { ref: doc.ref, quote: quoteOf(scheduleSentence.text) },
          },
    counterparty_commitment:
      promise === undefined ? null : { ref: doc.ref, quote: promise.quote.slice(0, 200) },
    needs_deep_extract: important && doc.text.length > 600,
    thread_note_tr: null,
    injection_suspected: prescanInjection(doc.text).suspected,
    confidence: bulk || needsReply || deadlines.length > 0 ? 'high' : 'medium',
  };
}

function ownRefs(context: string): Set<string> {
  const own = new Set<string>();
  for (const line of context.split('\n')) {
    const m = /^([a-z]{1,3}\d{1,3}): (Senin gönderdiğin mail|Senin mesajın)/u.exec(line);
    if (m?.[1] !== undefined) own.add(m[1]);
  }
  return own;
}

function commitmentClaims(doc: Doc, own: boolean) {
  return detectCommitments(doc.text, {
    sourceKind: own ? 'sent_mail' : 'received_mail',
    anchor: ANCHOR,
    timeZone: TZ,
  })
    .filter((c) => c.certainty !== 'negated')
    .slice(0, 4)
    .map((c) => {
      const quote = c.quote.slice(0, 200);
      const date = parseDatesTR(quote, { anchor: ANCHOR, timeZone: TZ })[0];
      return {
        owner: own ? ('user' as const) : ('counterparty' as const),
        counterparty_quote: null,
        what_tr: cap(c.text, 80),
        due_quote: date === undefined ? null : quote.slice(date.span[0], date.span[1]),
        evidence: { ref: doc.ref, quote },
        certainty: c.certainty === 'hedged' ? ('hedged' as const) : ('explicit' as const),
      };
    });
}

const GENERATORS: Readonly<Record<string, (params: GenerateStructuredParams<unknown>) => unknown>> =
  {
    EmailTriageV1(params) {
      const context = params.prompt.userContext ?? '';
      return {
        items: docsOf(params)
          .filter((d) => d.ref.startsWith('m'))
          .map((d) => triageItem(d, context)),
      };
    },
    ThreadSummaryV1(params) {
      const docs = docsOf(params).filter((d) => d.ref.startsWith('m'));
      const own = ownRefs(params.prompt.userContext ?? '');
      const newest = docs[docs.length - 1];
      const firstOf = (d: Doc) => sentences(d.text)[0];
      const keyPoints = docs.flatMap((d) => {
        const s = firstOf(d);
        return s === undefined
          ? []
          : [{ text_tr: cap(s.text, 200), evidence: { ref: d.ref, quote: quoteOf(s.text) } }];
      });
      const questions = docs.flatMap((d) =>
        sentences(d.text)
          .filter((s) => s.text.includes('?'))
          .map((s) => ({
            text_tr: cap(s.text, 200),
            owner: own.has(d.ref) ? ('counterparty' as const) : ('user' as const),
            evidence: { ref: d.ref, quote: quoteOf(s.text) },
          })),
      );
      const decisions = docs.flatMap((d) =>
        sentences(d.text)
          .filter((s) => /(karar|onaylandi|anlastik|kesinlesti)/u.test(fold(s.text)))
          .map((s) => ({
            text_tr: cap(s.text, 200),
            evidence: { ref: d.ref, quote: quoteOf(s.text) },
          })),
      );
      const lead = newest === undefined ? undefined : firstOf(newest);
      const last = questions[questions.length - 1];
      return {
        summary_tr: lead === undefined ? 'Yazışma özeti.' : cap(lead.text, 300),
        key_points: keyPoints.slice(0, 5),
        decisions: decisions.slice(0, 3),
        open_questions: questions.slice(0, 3),
        latest_ask: last === undefined ? null : { text_tr: last.text_tr, evidence: last.evidence },
        injection_suspected: docs.some((d) => prescanInjection(d.text).suspected),
        confidence: 'high',
      };
    },
    EmailDeepExtractV1(params) {
      const doc = docsOf(params).find((d) => d.ref === 'm1') ?? {
        ref: 'm1',
        kind: 'email',
        text: '',
      };
      const own = ownRefs(params.prompt.userContext ?? '').has('m1');
      const all = sentences(doc.text);
      const asks = all.filter((s) => REQUEST.test(fold(s.text)));
      const amounts = parseAmountsTR(doc.text)
        .filter((a) => doc.text.includes(a.text))
        .slice(0, 5)
        .flatMap((a) => {
          const s = all.find((x) => x.text.includes(a.text));
          return s === undefined
            ? []
            : [
                {
                  label_tr: 'Tutar',
                  amount_quote: a.text,
                  evidence: { ref: 'm1', quote: quoteOf(s.text) },
                },
              ];
        });
      const schedule = all.filter((s) => SCHEDULE.test(fold(s.text))).slice(0, 3);
      return {
        ref: 'm1',
        summary_tr: cap(all[1]?.text ?? all[0]?.text ?? '', 200),
        key_points: all.slice(1, 4).map((s) => ({
          text_tr: cap(s.text, 200),
          evidence: { ref: 'm1', quote: quoteOf(s.text) },
        })),
        deadlines: deadlineClaims(doc),
        schedule_requests: schedule.map((s) => ({
          kind: /iptal/u.test(fold(s.text)) ? ('cancel' as const) : ('reschedule' as const),
          requested_time_quote: null,
          evidence: { ref: 'm1', quote: quoteOf(s.text) },
        })),
        tasks_for_user: own
          ? []
          : asks.slice(0, 5).map((s) => {
              const date = parseDatesTR(s.text, { anchor: ANCHOR, timeZone: TZ })[0];
              return {
                what_tr: cap(s.text, 80),
                due_quote: date === undefined ? null : s.text.slice(date.span[0], date.span[1]),
                evidence: { ref: 'm1', quote: quoteOf(s.text) },
              };
            }),
        amounts,
        commitments: commitmentClaims(doc, own),
        people: [],
        injection_suspected: prescanInjection(doc.text).suspected,
        confidence: 'high',
      };
    },
    CommitmentExtractV1(params) {
      const own = ownRefs(params.prompt.userContext ?? '');
      return {
        items: docsOf(params)
          .filter((d) => d.ref.startsWith('m'))
          .map((d) => {
            const mine = own.has(d.ref);
            const expects = mine && detectExpectsReply(d.text) === 'yes';
            const q = sentences(d.text).find((s) => s.text.includes('?'));
            return {
              ref: d.ref,
              commitments: commitmentClaims(d, mine),
              expects_reply: expects,
              expects_reply_evidence:
                expects && q !== undefined ? { ref: d.ref, quote: quoteOf(q.text) } : null,
              injection_suspected: prescanInjection(d.text).suspected,
            };
          }),
      };
    },
    LifeIntelV1(params) {
      return {
        items: docsOf(params)
          .filter((d) => d.ref.startsWith('m'))
          .map((d) => {
            const tracking = findTrackingNumbers(d.text)[0];
            const s =
              tracking === undefined
                ? undefined
                : sentences(d.text).find((x) => x.text.includes(tracking.value));
            const events =
              tracking === undefined || s === undefined
                ? []
                : [
                    {
                      kind: 'shipment' as const,
                      merchant_quote: null,
                      carrier_quote: null,
                      tracking_quote: tracking.value,
                      status: /teslim edildi/u.test(fold(d.text))
                        ? ('delivered' as const)
                        : ('in_transit' as const),
                      eta_quote: null,
                      item_count_quote: null,
                      evidence: { ref: d.ref, quote: quoteOf(s.text) },
                    },
                  ];
            return { ref: d.ref, events, injection_suspected: prescanInjection(d.text).suspected };
          }),
      };
    },
    BriefingMorningV1(params) {
      const docs = docsOf(params);
      const items = docs
        .filter((d) => d.ref.startsWith('i'))
        .map((d) => {
          try {
            return { ref: d.ref, ...(JSON.parse(d.text) as { section: string; title: string }) };
          } catch {
            return { ref: d.ref, section: 'priorities', title: '' };
          }
        });
      const priorities = items.filter((i) => i.section === 'priorities');
      const narrative = priorities.slice(0, 3).map((i, n) => ({
        text_tr: `${n === 0 ? 'Günün ilk önceliği' : 'Sonra'}: ${i.title}.`,
        refs: [i.ref],
      }));
      const sections = [...new Set(items.map((i) => i.section))];
      return {
        narrative:
          narrative.length > 0
            ? narrative
            : [
                {
                  text_tr: 'Bugün sakin bir gün görünüyor.',
                  refs: items.slice(0, 1).map((i) => i.ref),
                },
              ],
        overview_spoken_tr: 'Günaydın. Günün öne çıkanları hazır.',
        overview_refs: [],
        section_spoken: sections.map((section) => {
          const first = items.find((i) => i.section === section)!;
          return { section, text_tr: first.title, refs: [first.ref] };
        }),
        priority_reasons: priorities
          .slice(0, 3)
          .map((i) => ({ ref: i.ref, why_tr: 'Bugün ilgilenmen gereken bir konu.' })),
      };
    },
    BriefingPolishV1(params) {
      return {
        items: docsOf(params).map((d) => {
          try {
            const v = JSON.parse(d.text) as { title?: string; sub?: string | null };
            return { ref: d.ref, title_tr: v.title ?? '', sub_tr: v.sub ?? null };
          } catch {
            return { ref: d.ref, title_tr: '', sub_tr: null };
          }
        }),
      };
    },
    WeeklyReviewV1(params) {
      const docs = docsOf(params);
      const by = (ref: string) => docs.find((d) => d.ref === ref);
      const s1 = by('s1');
      const s2 = by('s2');
      const s3 = by('s3');
      const e1 = by('e1');
      const f1 = by('f1');
      const s7 = by('s7');
      return {
        narrative: [
          ...(s1 === undefined ? [] : [{ text_tr: `Bu hafta ${s1.text}.`, refs: ['s1'] }]),
          ...(s2 === undefined || s3 === undefined
            ? []
            : [{ text_tr: `${s2.text} ve ${s3.text} vardı.`, refs: ['s2', 's3'] }]),
        ],
        busiest_day:
          s7 === undefined
            ? null
            : { text_tr: `Haftanın en yoğun günü: ${s7.text}.`, refs: ['s7'] },
        next_week:
          e1 === undefined
            ? { text_tr: 'Önümüzdeki hafta takvimin sakin görünüyor.', refs: [] }
            : { text_tr: `Önümüzdeki hafta ilk etkinliğin: ${e1.text}.`, refs: ['e1'] },
        suggestion:
          f1 === undefined
            ? { kind: 'none', slot_ref: null, text_tr: null }
            : {
                kind: 'focus_block',
                slot_ref: 'f1',
                text_tr: `${f1.text}; odaklanmak için iyi bir zaman.`,
              },
      };
    },
  };

/** A generated output for the schema, or undefined when no generator exists. */
export function generateFixture(params: GenerateStructuredParams<unknown>): unknown {
  const generator = GENERATORS[params.schemaName];
  if (generator === undefined || params.prompt.untrusted === undefined) return undefined;
  return generator(params);
}

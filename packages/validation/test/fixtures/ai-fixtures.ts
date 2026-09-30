import type { AiSchemaName } from '../../src/ai/index.ts';
import { withPath } from './samples.ts';

const ev = (ref: string, quote: string) => ({ ref, quote });

export const emailTriage = {
  items: [
    {
      ref: 'm1',
      category: 'awaiting_my_reply',
      important: true,
      urgency: 'today',
      needs_reply: true,
      reply_ask_tr: 'Revize fiyat teklifi, PDF olarak.',
      reply_evidence: ev('m1', 'revize teklifi PDF olarak iletebilir misiniz'),
      reason_code: 'direct_request',
      reason_tr: 'Bugün 17:00’ye kadar cevap istendiği için önemli.',
      summary_tr: 'Mehmet Bey revize teklif istiyor.',
      key_points_tr: ['Teklif PDF olarak istendi'],
      deadlines: [
        {
          what_tr: 'Revize teklif',
          when_quote: 'bugün 17:00',
          evidence: ev('m1', 'bugün 17:00’ye kadar'),
          certainty: 'explicit',
        },
      ],
      life_signal: 'none',
      life_evidence: null,
      schedule_request: null,
      counterparty_commitment: null,
      needs_deep_extract: false,
      thread_note_tr: null,
      injection_suspected: false,
      confidence: 'high',
    },
  ],
};

export const threadSummary = {
  summary_tr: 'Mehmet Bey Ekim teslimatı için fiyatın güncellenmesini istiyor.',
  key_points: [
    {
      text_tr: 'Fiyat güncellemesi istendi',
      evidence: ev('m2', 'fiyatı Ekim teslimatına göre güncelleyebilir'),
    },
  ],
  decisions: [],
  open_questions: [
    {
      text_tr: 'Teslim tarihi kesin mi?',
      owner: 'counterparty',
      evidence: ev('m2', 'teslim tarihi netleşince'),
    },
  ],
  latest_ask: { text_tr: 'Güncel fiyat', evidence: ev('m2', 'güncel fiyatı paylaşır mısınız') },
  injection_suspected: false,
  confidence: 'medium',
};

export const commitmentExtract = {
  items: [
    {
      ref: 'm1',
      commitments: [
        {
          owner: 'user',
          counterparty_quote: 'Mehmet Bey',
          what_tr: 'Teklifi gönder',
          due_quote: 'yarın',
          evidence: ev('m1', 'teklifi yarın göndereceğim'),
          certainty: 'explicit',
        },
      ],
      expects_reply: true,
      expects_reply_evidence: ev('m1', 'dönüşünüzü bekliyorum'),
      injection_suspected: false,
    },
  ],
};

export const emailDeepExtract = {
  ref: 'm1',
  summary_tr: 'Sözleşme yenilemesi ve ödeme tarihi.',
  key_points: [{ text_tr: 'Sözleşme yenileniyor', evidence: ev('m1', 'sözleşme yenilemesi') }],
  deadlines: [],
  schedule_requests: [
    {
      kind: 'reschedule',
      requested_time_quote: '16:00',
      evidence: ev('m1', 'toplantıyı 16:00’ya alalım'),
    },
  ],
  tasks_for_user: [
    {
      what_tr: 'İmzalı kopyayı gönder',
      due_quote: null,
      evidence: ev('m1', 'imzalı kopyayı gönderin'),
    },
  ],
  amounts: [
    {
      label_tr: 'Yıllık bedel',
      amount_quote: '₺18.420,00',
      evidence: ev('m1', 'yıllık bedel ₺18.420,00'),
    },
  ],
  commitments: [],
  people: [
    {
      name_quote: 'Selin Kaya',
      role_tr: 'Satın alma',
      evidence: ev('m1', 'Selin Kaya (Satın alma)'),
    },
  ],
  injection_suspected: false,
  confidence: 'high',
};

export const lifeIntel = {
  items: [
    {
      ref: 'm1',
      events: [
        {
          kind: 'shipment',
          merchant_quote: 'Trendyol',
          carrier_quote: 'Yurtiçi Kargo',
          tracking_quote: '123456789012',
          status: 'out_for_delivery',
          eta_quote: 'bugün',
          item_count_quote: null,
          evidence: ev('m1', 'siparişiniz bugün dağıtımda'),
        },
        {
          kind: 'flight',
          flight_no_quote: 'TK2154',
          from_quote: 'İstanbul',
          to_quote: 'İzmir',
          depart_quote: '25 Eylül 09:40',
          arrive_quote: null,
          gate_quote: null,
          pnr_quote: 'ABC123',
          checkin_status: 'open',
          evidence: ev('m1', 'TK2154 İstanbul - İzmir'),
        },
      ],
      injection_suspected: false,
    },
  ],
};

export const briefingMorning = {
  narrative: [
    { text_tr: 'Bugün 3 önceliğin var; ilki 17:00’deki teklif.', refs: ['i1', 's1'] },
    { text_tr: 'Öğleden sonra takvimin sakin.', refs: ['s2'] },
  ],
  overview_spoken_tr: 'Günaydın, bugün 3 önceliğin var.',
  overview_refs: ['s1'],
  section_spoken: [
    { section: 'priorities', text_tr: 'İlk öncelik 17:00’deki teklif.', refs: ['i1'] },
  ],
  priority_reasons: [{ ref: 'i1', why_tr: 'Bugün 17:00’ye kadar istendi.' }],
};

export const briefingPolish = {
  items: [{ ref: 'i1', title_tr: 'Mehmet 16:00’ya kaydırmak istiyor', sub_tr: null }],
};

export const middayPulse = {
  kind: 'midday',
  local_date: '2026-09-24',
  delta_count: 1,
  headline_key: 'midday.delta',
  deltas: [
    {
      ref: 'i1',
      type: 'reschedule_request',
      insight_id: 'ins-1',
      badge: 'TAKVİM',
      display_time: '11:05',
      title_tr: 'Mehmet toplantıyı 16:00’ya almak istiyor',
      sub_tr: null,
      source_label: 'Gmail · 11:05',
      actions: ['open'],
    },
  ],
  remaining_today: [
    {
      time: '16:00',
      title_tr: 'Ürün gözden geçirme',
      status_label: 'Onay bekliyor',
      entity_type: 'calendar_event',
      entity_id: 'evt-1',
    },
  ],
  morning_briefing_id: 'brf-1',
};

export const eveningClose = {
  kind: 'evening',
  local_date: '2026-09-24',
  completed: [
    {
      title_tr: 'Teklif gönderildi',
      completed_at_local: '16:10',
      entity_type: 'task',
      entity_id: 't1',
    },
  ],
  carry_over: [],
  follow_ups: [{ title_tr: 'Selin’den dönüş', day_label_tr: '2 gündür', thread_id: 'th1' }],
  tomorrow_first_event: {
    event_id: 'e1',
    start_local: '09:30',
    title_tr: 'Haftalık',
    meta_tr: 'Ofis',
    leave_by_local: null,
  },
  counts: { completed: 1, carry_over: 0 },
};

export const weeklyReview = {
  narrative: [{ text_tr: 'Bu hafta 9 toplantın vardı.', refs: ['s1'] }],
  busiest_day: { text_tr: 'En yoğun gün Perşembe.', refs: ['s2'] },
  next_week: { text_tr: 'Önümüzdeki hafta daha sakin.', refs: ['s3'] },
  suggestion: { kind: 'focus_block', slot_ref: 'f1', text_tr: 'Perşembe’ye teklif bloğu planla.' },
};

export const weeklyStats = {
  period_start: '2026-09-15',
  period_end: '2026-09-21',
  mails_analyzed: 214,
  important_count: 17,
  meetings: 9,
  prep_notes: 3,
  followups: 5,
  followups_answered: 4,
  deadlines: 3,
  deadlines_surfaced_in_time: 3,
  busiest_day: { weekday: 4, meetings: 4, max_gap_min: 30 },
  time_saved_min: 95,
  time_saved_basis: {
    formula_version: 'timeSaved@v1',
    filtered_mails: 180,
    prep_notes_opened: 3,
    drafts_sent: 2,
  },
};

export const meetingPrep = {
  purpose: {
    text_tr: 'Fiyat revizyonunu konuşmak.',
    basis: 'email',
    evidence: ev('m1', 'fiyat revizyonunu görüşelim'),
  },
  talking_points: [
    {
      title_tr: 'Ekim fiyatı',
      body_tr: 'Güncel fiyatı teyit et.',
      refs: ['m1'],
      evidence: ev('m1', 'Ekim teslimatına göre fiyat'),
    },
    {
      title_tr: 'Teslim tarihi',
      body_tr: 'Kesin tarihi sor.',
      refs: ['m1'],
      evidence: ev('m1', 'teslim tarihi netleşince'),
    },
  ],
  last_interaction: {
    text_tr: 'Dün fiyat istedi.',
    refs: ['m1'],
    evidence: ev('m1', 'güncel fiyatı paylaşır mısınız'),
  },
  open_loops: [],
  summary_2min: [
    { text_tr: 'Mehmet Bey Ekim teslimatı için güncel fiyat bekliyor.', refs: ['m1'] },
  ],
  injection_suspected: false,
  confidence: 'high',
};

export const postMeeting = {
  items: [
    {
      owner: 'user',
      what_tr: 'Teklif gönder',
      counterparty_quote: 'Mehmet',
      due_quote: 'yarın',
      evidence: ev('n1', 'Mehmet’e yarın teklif göndereceğim'),
      certainty: 'explicit',
    },
  ],
  note_summary_tr: 'Teklif yarın gönderilecek.',
  injection_suspected: false,
};

export const captureExtract = {
  doc_type: 'event',
  link_type: null,
  title_tr: 'Lansman toplantısı',
  summary_tr: 'Ürün lansmanı daveti.',
  transcript: [{ ref: 'img1', line: 'Lansman · 2 Ekim 14:00 · Levent' }],
  items: [
    {
      kind: 'event',
      title_tr: 'Lansman',
      date_quote: '2 Ekim',
      time_quote: '14:00',
      end_quote: null,
      place_quote: 'Levent',
      section_quote: null,
      evidence: ev('img1', 'Lansman · 2 Ekim 14:00'),
    },
    { kind: 'note', text_tr: 'Kıyafet: rahat', evidence: null },
  ],
  injection_suspected: false,
  confidence: 'medium',
};

export const assistantIntent = {
  intent: 'last_talk_with_person',
  person_quote: 'Mehmet',
  period_quote: null,
  topic_quote: null,
  target_ref: null,
  confidence: 'high',
};

export const assistantGrounded = {
  sentences: [
    {
      text_tr: 'Mehmet dün fiyat güncellemesi istedi.',
      quotes: [ev('r1', 'fiyatı güncelleyebilir misiniz')],
    },
  ],
  unknown: false,
  injection_suspected: false,
};

export const assistantAnswer = {
  message_id: 'msg-1',
  route: 'grounded_qa',
  blocks: [
    {
      text: 'Mehmet dün fiyat güncellemesi istedi.',
      verified: true,
      citations: [{ result_index: 0, cited_text: 'fiyat' }],
    },
  ],
  source_cards: [
    {
      result_index: 0,
      source_type: 'email_message',
      icon: 'mail',
      src_label: 'Gmail · Mehmet Yılmaz',
      date_label: 'Dün 18:20',
      title: 'Fiyat güncellemesi',
      summary: 'Ekim teslimatı',
      deeplink: '/mail/1',
      page_no: null,
    },
  ],
  rich_cards: [
    {
      type: 'list',
      route: '/mail',
      data: {
        kind: 'waiting_on_you',
        title: 'Senden bekleyenler',
        items: [
          {
            entity_type: 'email_message',
            entity_id: 'm1',
            title: 'Mehmet Yılmaz',
            meta: 'Dün 18:20',
            badge: 'SON TARİH',
            route: '/mail/1',
          },
        ],
        undo_token: null,
      },
    },
  ],
  proposed_actions: [],
  coverage: 1,
  confidence_label: 'high',
  unknown: false,
  followup_suggestions: ['Teklif ne zaman?'],
};

export const replyDrafts = {
  drafts: [
    { tone: 'short', body_tr: 'Merhaba Mehmet Bey, teklifi yarın iletiyorum.' },
    {
      tone: 'professional',
      body_tr: 'Merhaba Mehmet Bey, revize teklifi yarın 17:00’ye kadar iletiyorum.',
    },
    { tone: 'friendly', body_tr: 'Merhaba Mehmet, teklif yarın sende olur.' },
    {
      tone: 'detailed',
      body_tr: 'Merhaba Mehmet Bey, Ekim teslimatına göre güncellenmiş teklifi yarın iletiyorum.',
    },
  ],
  commitments_in_draft: [{ what_tr: 'Teklifi gönder', due_phrase_tr: 'yarın' }],
  referenced_attachment_names: ['Teklif_v2.pdf'],
  injection_suspected: false,
};

export const followUpDraft = {
  body_tr: 'Merhaba Selin, teklifle ilgili dönüşünü bekliyorum.',
  injection_suspected: false,
};

export const aiFixtures: Record<
  AiSchemaName,
  { valid: unknown; invalid: { why: string; value: unknown }[] }
> = {
  EmailTriageV1: {
    valid: emailTriage,
    invalid: [
      {
        why: 'awaiting_their_reply is not a model label',
        value: withPath(emailTriage, 'items.0.category', 'awaiting_their_reply'),
      },
      {
        why: 'missing required property (nullable, not optional)',
        value: withPath(emailTriage, 'items.0.summary_tr', undefined),
      },
      { why: 'extra property', value: withPath(emailTriage, 'items.0.email', 'a@b.co') },
    ],
  },
  ThreadSummaryV1: {
    valid: threadSummary,
    invalid: [
      { why: 'unknown owner', value: withPath(threadSummary, 'open_questions.0.owner', 'other') },
      {
        why: 'evidence without quote',
        value: withPath(threadSummary, 'key_points.0.evidence', { ref: 'm2' }),
      },
    ],
  },
  CommitmentExtractV1: {
    valid: commitmentExtract,
    invalid: [
      {
        why: 'unknown certainty',
        value: withPath(commitmentExtract, 'items.0.commitments.0.certainty', 'maybe'),
      },
    ],
  },
  EmailDeepExtractV1: {
    valid: emailDeepExtract,
    invalid: [
      {
        why: 'unknown schedule kind',
        value: withPath(emailDeepExtract, 'schedule_requests.0.kind', 'postpone'),
      },
      {
        why: 'resolved amount numbers are code-only',
        value: withPath(emailDeepExtract, 'amounts.0.amount', 18420),
      },
    ],
  },
  LifeIntelV1: {
    valid: lifeIntel,
    invalid: [
      {
        why: 'security is T0-only',
        value: withPath(lifeIntel, 'items.0.events.0.kind', 'security'),
      },
      {
        why: 'shipment fields on a flight',
        value: withPath(lifeIntel, 'items.0.events.1.status', 'delivered'),
      },
    ],
  },
  BriefingMorningV1: {
    valid: briefingMorning,
    invalid: [
      {
        why: 'unknown section',
        value: withPath(briefingMorning, 'section_spoken.0.section', 'weather'),
      },
    ],
  },
  BriefingPolishV1: {
    valid: briefingPolish,
    invalid: [
      { why: 'sub must be present (nullable)', value: { items: [{ ref: 'i1', title_tr: 't' }] } },
    ],
  },
  MiddayPulseV1: {
    valid: middayPulse,
    invalid: [{ why: 'unknown badge', value: withPath(middayPulse, 'deltas.0.badge', 'GÜVENLİK') }],
  },
  EveningCloseV1: {
    valid: eveningClose,
    invalid: [{ why: 'kind is evening', value: withPath(eveningClose, 'kind', 'midday') }],
  },
  WeeklyReviewV1: {
    valid: weeklyReview,
    invalid: [
      {
        why: 'unknown suggestion kind',
        value: withPath(weeklyReview, 'suggestion.kind', 'vacation'),
      },
    ],
  },
  WeeklyStatsV1: {
    valid: weeklyStats,
    invalid: [{ why: 'counts are numbers', value: withPath(weeklyStats, 'meetings', 'nine') }],
  },
  MeetingPrepV1: {
    valid: meetingPrep,
    invalid: [
      { why: 'unknown purpose basis', value: withPath(meetingPrep, 'purpose.basis', 'guess') },
    ],
  },
  PostMeetingCommitmentV1: {
    valid: postMeeting,
    invalid: [{ why: 'unknown owner', value: withPath(postMeeting, 'items.0.owner', 'manager') }],
  },
  CaptureExtractV1: {
    valid: captureExtract,
    invalid: [
      { why: 'unknown item kind', value: withPath(captureExtract, 'items.0.kind', 'meeting') },
      { why: 'unknown doc type', value: withPath(captureExtract, 'doc_type', 'spreadsheet') },
    ],
  },
  AssistantIntentV1: {
    valid: assistantIntent,
    invalid: [
      {
        why: 'there is no send intent (R-04)',
        value: withPath(assistantIntent, 'intent', 'send_email'),
      },
    ],
  },
  AssistantGroundedJsonV1: {
    valid: assistantGrounded,
    invalid: [
      {
        why: 'quotes must be evidence objects',
        value: withPath(assistantGrounded, 'sentences.0.quotes', ['fiyat']),
      },
    ],
  },
  AssistantAnswerV1: {
    valid: assistantAnswer,
    invalid: [
      { why: 'unknown route', value: withPath(assistantAnswer, 'route', 'tool_call') },
      {
        why: 'unknown rich card type',
        value: withPath(assistantAnswer, 'rich_cards.0.type', 'sources'),
      },
    ],
  },
  ReplyDraftsV1: {
    valid: replyDrafts,
    invalid: [{ why: 'unknown tone', value: withPath(replyDrafts, 'drafts.0.tone', 'angry') }],
  },
  FollowUpDraftV1: {
    valid: followUpDraft,
    invalid: [
      {
        why: 'subject is not part of the output',
        value: { ...followUpDraft, subject: 'Re: Teklif' },
      },
    ],
  },
};

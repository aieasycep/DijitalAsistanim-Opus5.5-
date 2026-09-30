import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_SSE_EVENT_NAMES,
  AssistantSseEvent,
  assistantStreamViolations,
  parseAssistantSseFrame,
} from '../src/api/assistant.ts';
import { approvalView, sourceRef, uuid } from './fixtures/samples.ts';

const frames = {
  meta: {
    thread_id: uuid(75),
    user_message_id: uuid(76),
    assistant_message_id: uuid(80),
    correlation_id: 'corr-12345678',
  },
  status: { stage: 'retrieving' },
  delta: { text: 'Mehmet en son dün fiyat güncellemesi istedi. ' },
  citation: {
    index: 0,
    source: sourceRef,
    title: 'Fiyat güncellemesi',
    snippet: 'Fiyatı Ekim teslimatına göre güncelleyebilir misiniz?',
  },
  card: {
    type: 'list',
    route: '/mail',
    data: {
      kind: 'waiting_on_you',
      title: 'Senden bekleyenler',
      items: [
        {
          entity_type: 'email_message',
          entity_id: uuid(90),
          title: 'Mehmet Yılmaz',
          meta: 'Dün 18:20',
          badge: 'SON TARİH',
          route: `/mail/${uuid(90)}`,
        },
      ],
      undo_token: null,
    },
  },
  action_proposal: { approval: approvalView },
  done: {
    assistant_message_id: uuid(80),
    finish_reason: 'stop',
    grounded: true,
    usage: { remaining_messages: 184 },
  },
  error: {
    code: 'AI_UNAVAILABLE',
    message: 'Asistan şu an yanıt veremiyor.',
    message_key: 'errors.ai_unavailable',
    retryable: true,
    correlation_id: 'corr-12345678',
  },
} as const;

describe('assistant SSE events (API-AST-02)', () => {
  it('names exactly meta|status|delta|citation|card|action_proposal|done|error', () => {
    expect([...ASSISTANT_SSE_EVENT_NAMES]).toEqual([
      'meta',
      'status',
      'delta',
      'citation',
      'card',
      'action_proposal',
      'done',
      'error',
    ]);
  });

  it.each(ASSISTANT_SSE_EVENT_NAMES)('parses a %s frame', (name) => {
    const result = parseAssistantSseFrame(name, JSON.stringify(frames[name]));
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });

  it.each([
    ['an unknown event name', 'final', frames.done],
    ['a delta above 512 chars', 'delta', { text: 'x'.repeat(513) }],
    [
      'a citation snippet above 200 chars',
      'citation',
      { ...frames.citation, snippet: 'x'.repeat(201) },
    ],
    ['an unknown status stage', 'status', { stage: 'thinking' }],
    [
      'a card with an unknown type (sources are citations)',
      'card',
      { ...frames.card, type: 'sources' },
    ],
    ['an action proposal without an approval view', 'action_proposal', { payload: {} }],
    ['an unknown finish reason', 'done', { ...frames.done, finish_reason: 'tool_use' }],
    ['an error with an unknown code', 'error', { ...frames.error, code: 'BOOM' }],
  ])('rejects %s', (_name, event, data) => {
    expect(parseAssistantSseFrame(event, JSON.stringify(data)).success).toBe(false);
  });

  it('rejects a frame whose data is not JSON', () => {
    expect(parseAssistantSseFrame('delta', '{not json').success).toBe(false);
  });

  it('accepts the optional calibrated confidence on done', () => {
    expect(
      AssistantSseEvent.safeParse({ event: 'done', data: { ...frames.done, confidence_pct: 92 } })
        .success,
    ).toBe(true);
    expect(
      AssistantSseEvent.safeParse({ event: 'done', data: { ...frames.done, confidence_pct: 120 } })
        .success,
    ).toBe(false);
  });
});

describe('assistant stream ordering', () => {
  const ev = (name: keyof typeof frames) =>
    AssistantSseEvent.parse({ event: name, data: frames[name] });

  it('accepts meta → status → delta → citation → card → action_proposal → done', () => {
    expect(
      assistantStreamViolations([
        ev('meta'),
        ev('status'),
        ev('delta'),
        ev('citation'),
        ev('card'),
        ev('action_proposal'),
        ev('done'),
      ]),
    ).toEqual([]);
    expect(assistantStreamViolations([ev('meta'), ev('status'), ev('error')])).toEqual([]);
  });

  it.each([
    ['an empty stream', [], 'empty_stream'],
    ['meta not first', ['status', 'meta', 'done'], 'meta_not_first'],
    ['no terminal event', ['meta', 'delta'], 'no_terminal_event'],
    ['events after done', ['meta', 'done', 'delta'], 'events_after_terminal'],
    ['two meta events', ['meta', 'meta', 'done'], 'duplicate_meta'],
  ] as const)('flags %s', (_name, names, rule) => {
    expect(assistantStreamViolations(names.map((n) => ev(n)))).toContain(rule);
  });
});

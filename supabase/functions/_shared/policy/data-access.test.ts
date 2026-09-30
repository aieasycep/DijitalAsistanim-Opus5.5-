/**
 * The shared AI Accessible Data guard (SECURITY_AND_PRIVACY_PLAN §4.4): parsing, the five
 * classes, tagged prompt parts through `callModel`, memory chunk classes and retrieval filtering.
 */
import { assert, assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import { z } from 'zod';
import { isAppError } from '../errors.ts';
import { callModel } from '../services/ai/pipeline.ts';
import { fixtureServices } from '../testing/intel.ts';
import { USER_A } from '../testing/jwt.ts';
import {
  admit,
  admitContext,
  admitRetrieved,
  assertDataAllowed,
  chunkAllowed,
  chunkDataClasses,
  DATA_CLASSES,
  DEFAULT_AI_DATA_ACCESS,
  dataAllowed,
  disabledClasses,
  parseAiDataAccess,
  tagged,
} from './data-access.ts';

const ALL_OFF = {
  mailBody: false,
  attachments: false,
  calendar: false,
  contacts: false,
  locationCoarse: false,
};

Deno.test('parseAiDataAccess: the DB default (four on, location off) and explicit values', () => {
  assertEquals(parseAiDataAccess(null), DEFAULT_AI_DATA_ACCESS);
  assertEquals(parseAiDataAccess({}), DEFAULT_AI_DATA_ACCESS);
  assertEquals(
    parseAiDataAccess({
      mail_body: false,
      attachments: false,
      calendar: false,
      contacts: false,
      location_coarse: true,
    }),
    { ...ALL_OFF, locationCoarse: true },
  );
  // Only an explicit `true` opens the location class; anything else keeps it closed.
  assertEquals(parseAiDataAccess({ location_coarse: 'yes' }).locationCoarse, false);
});

Deno.test('dataAllowed covers exactly the five ai_data_access keys', () => {
  assertEquals(DATA_CLASSES, [
    'mail_body',
    'attachments',
    'calendar',
    'contacts',
    'location_coarse',
  ]);
  for (const cls of DATA_CLASSES) {
    assertEquals(dataAllowed(ALL_OFF, cls), false, cls);
    assertEquals(
      dataAllowed(
        { mailBody: true, attachments: true, calendar: true, contacts: true, locationCoarse: true },
        cls,
      ),
      true,
      cls,
    );
  }
  assertEquals(disabledClasses(DEFAULT_AI_DATA_ACCESS), ['location_coarse']);
});

Deno.test('assertDataAllowed answers DATA_SOURCE_DISABLED with the toggle name', () => {
  assertDataAllowed(DEFAULT_AI_DATA_ACCESS, 'calendar');
  const error = assertThrows(() => assertDataAllowed(ALL_OFF, 'attachments'));
  assert(isAppError(error));
  assertEquals(error.code, 'DATA_SOURCE_DISABLED');
  assertEquals(error.details, { toggle: 'ai_data_access.attachments' });
});

Deno.test('admit / admitContext drop the parts of disabled classes and keep untagged ones', () => {
  const parts = [
    { id: 1 },
    { id: 2, requires: ['calendar' as const] },
    { id: 3, requires: ['contacts' as const, 'calendar' as const] },
    { id: 4, requires: ['location_coarse' as const] },
  ];
  assertEquals(
    admit({ ...DEFAULT_AI_DATA_ACCESS, contacts: false }, parts).map((p) => p.id),
    [1, 2],
  );
  assertEquals(
    admitContext({ ...DEFAULT_AI_DATA_ACCESS, calendar: false }, [
      'Bugün',
      tagged('Katılımcılar: Mehmet', 'calendar'),
      tagged('Konum: Kadıköy', 'location_coarse'),
    ]),
    ['Bugün'],
  );
});

Deno.test('memory chunk classes: summaries, events, person facts and captures', () => {
  assertEquals(chunkDataClasses({ chunk_kind: 'thread_summary', source_type: 'email_thread' }), [
    'mail_body',
  ]);
  assertEquals(chunkDataClasses({ chunk_kind: 'event', source_type: 'calendar_event' }), [
    'calendar',
  ]);
  assertEquals(chunkDataClasses({ chunk_kind: 'person_fact', source_type: 'contact' }), [
    'contacts',
  ]);
  assertEquals(chunkDataClasses({ chunk_kind: 'capture_extract', source_type: 'capture' }), [
    'attachments',
  ]);
  assertEquals(chunkDataClasses({ chunk_kind: 'life_event', source_type: 'life_event' }), []);
  assertEquals(
    chunkAllowed(
      { ...DEFAULT_AI_DATA_ACCESS, calendar: false },
      {
        chunk_kind: 'meeting_note',
        source_type: 'meeting_note',
      },
    ),
    true,
  );
});

Deno.test('admitRetrieved: rows of disabled classes are dropped or lose their snippet', () => {
  const row = (type: string, sourceType: string) => ({
    type,
    title: `${type} title`,
    snippet: `${type} snippet`,
    source: { source_type: sourceType },
  });
  const rows = [
    row('person', 'contact'),
    row('capture', 'capture'),
    row('email', 'email_thread'),
    row('event', 'calendar_event'),
    row('memory', 'contact'),
    row('memory', 'device_calendar_event'),
    row('memory', 'email_message'),
    row('memory', 'capture'),
    row('memory', 'meeting_note'),
    row('commitment', 'email_message'),
  ];
  assertEquals(admitRetrieved(DEFAULT_AI_DATA_ACCESS, rows), rows);
  const out = admitRetrieved(ALL_OFF, rows);
  assertEquals(
    out.map((r) => `${r.type}:${r.source.source_type}:${r.snippet}`),
    [
      'email:email_thread:',
      'event:calendar_event:',
      'memory:meeting_note:memory snippet',
      'commitment:email_message:commitment snippet',
    ],
  );
});

Deno.test(
  'callModel: tagged context lines and documents of a disabled class never reach the provider',
  async () => {
    const run = async (locationCoarse: boolean, calendar: boolean) => {
      const ai = fixtureServices({
        user: { dataAccess: { ...DEFAULT_AI_DATA_ACCESS, locationCoarse, calendar } },
      });
      const user = await ai.services.users.load(USER_A);
      const result = await callModel(
        { runtime: ai.services.runtime, user, correlationId: crypto.randomUUID() },
        {
          feature: 'email_triage',
          schema: z.object({ items: z.array(z.unknown()) }),
          schemaName: 'EmailTriageV1',
          context: ['Bugün: Perşembe', tagged('Yaklaşık konum: Kadıköy', 'location_coarse')],
          docs: [
            { ref: 'm1', kind: 'email', text: 'Merhaba, teklif ekte.' },
            {
              ref: 'e1',
              kind: 'event',
              text: 'Katılımcılar: Mehmet Yılmaz',
              requires: ['calendar'],
            },
          ],
          units: 1,
          cacheContent: 'dsc-test',
        },
      );
      return { ai, result, text: ai.prompts.map((p) => p.text).join('\n') };
    };
    const guarded = await run(false, false);
    assertStringIncludes(guarded.text, 'teklif ekte');
    assert(!guarded.text.includes('Kadıköy'), 'location_coarse reached the prompt');
    assert(!guarded.text.includes('Mehmet'), 'calendar detail reached the prompt');
    const open = await run(true, true);
    assertStringIncludes(open.text, 'Kadıköy');
    assertStringIncludes(open.text, 'Mehmet Yılmaz');
  },
);

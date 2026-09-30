/**
 * THR-14 Notification leakage (SECURITY_AND_PRIVACY_PLAN §2 THR-14, CTL-3.12; M§86, C-14, R-05;
 * TEST_PLAN TST-EF-12, TST-PK-03). Through JOB-18 (`processNotification`) and the Expo client over a
 * stubbed push endpoint:
 * - the payload is exactly `{type, entity_id, deeplink}`, and the deep link is always an app route
 *   (an injected web or foreign link falls back to the type route);
 * - `title_only` (the default) and `generic` never carry a sender, subject, title, person, venue or
 *   amount — neither on the wire nor in the ledger's rendered text; iOS with lock-screen privacy
 *   caps `full` to `title_only`;
 * - over the whole server catalog (tr + en), no `title_only` / `generic` string can render a
 *   sensitive parameter.
 */
import { assert, assertEquals, assertFalse } from '@std/assert';
import { routes, toDeepLink } from '@da/domain';
import trPush from '../../../../packages/i18n/messages/tr/push.json' with { type: 'json' };
import enPush from '../../../../packages/i18n/messages/en/push.json' with { type: 'json' };
import { NotificationJobPayload } from '../../_shared/services/notifications/create.ts';
import {
  createExpoPushClient,
  type ExpoMessage,
} from '../../_shared/services/notifications/expo-push.ts';
import type { NotificationSpec } from '../../_shared/services/notifications/model.ts';
import { processNotification } from '../../_shared/services/notifications/pipeline.ts';
import { renderNotification } from '../../_shared/services/notifications/render.ts';
import type { TriggerRepo } from '../../_shared/services/notifications/triggers/types.ts';
import { jsonResponse, stubFetch } from '../../_shared/testing/fetch.ts';
import { USER_A } from '../../_shared/testing/jwt.ts';
import { jobContext, memoryNotifications, memoryQueue } from '../../_shared/testing/workflows.ts';

const DAY = new Date('2026-09-23T09:00:00.000Z'); // 12:00 Europe/Istanbul, outside quiet hours
const ENTITY = '99999999-9999-4999-8999-999999999999';
const SECRETS = {
  sender: 'Ahmet Yılmaz',
  subject: 'Gizli birleşme teklifi',
  expectedAction: 'Bugün 17:00’ye kadar Ahmet’e dön',
  vipName: 'Zeynep Kaya',
  meeting: 'Kuzey Lojistik ihale görüşmesi',
  title: 'Vergi beyannamesi',
  person: 'Selin Demir',
  issuer: 'Garanti BBVA',
  amount: '12.450,00 TL',
  service: 'Netflix Premium',
  venue: 'Mikla Restoran',
  summary: 'Şifre sıfırlama isteği',
  seller: 'Trendyol Elite',
  flight: 'TK1971',
  text: 'Doktor randevusu',
  highlights: 'Ahmet Yılmaz birleşme teklifi',
  ruleName: 'Patron kuralı',
  eventA: 'Gizli toplantı A',
  eventB: 'Gizli toplantı B',
  commitment: 'Raporu Selin’e gönder',
};

const EMPTY_TRIGGERS: TriggerRepo = {
  event: () => Promise.resolve(null),
  meetingPrep: () => Promise.resolve(null),
  reminder: () => Promise.resolve(null),
  setReminderStatus: () => Promise.resolve(),
  insight: () => Promise.resolve(null),
  approval: () => Promise.resolve(null),
  briefing: () => Promise.resolve(null),
  markBriefingDelivered: () => Promise.resolve(),
  subscription: () => Promise.resolve(null),
};

function pipeline(detail: 'title_only' | 'generic' | 'full', platforms: ('ios' | 'android')[]) {
  const now = () => DAY;
  const queue = memoryQueue(now);
  const n = memoryNotifications(now);
  n.states.set(USER_A, { prefs: { detail_level: detail, life_intel: true } });
  for (const platform of platforms) n.addTarget(USER_A, { platform });
  const sent: ExpoMessage[] = [];
  const stub = stubFetch(async (call) => {
    let text = call.body ?? '[]';
    if (call.headers.get('Content-Encoding') === 'gzip') {
      const stream = new Blob([call.rawBody as Uint8Array])
        .stream()
        .pipeThrough(new DecompressionStream('gzip'));
      text = await new Response(stream).text();
    }
    const messages = JSON.parse(text) as ExpoMessage[];
    sent.push(...messages);
    return jsonResponse({ data: messages.map((_, i) => ({ status: 'ok', id: `tk-${i}` })) });
  });
  const deps = {
    repo: n.repo,
    triggers: EMPTY_TRIGGERS,
    expo: createExpoPushClient({ accessToken: 'expo-token', fetch: stub.fetch }),
  };
  const run = (build: Record<string, unknown>) =>
    processNotification(
      deps,
      jobContext({
        type: 'notification',
        key: `test:${crypto.randomUUID()}`,
        payload: NotificationJobPayload.parse({ user_id: USER_A, build }),
        queue,
        now,
        userId: USER_A,
      }),
    );
  return { n, sent, run };
}

const BUILDS: {
  template: string;
  category: string;
  entity: string;
  sensitive: Record<string, string>;
}[] = [
  {
    template: 'critical_email.reply_needed',
    category: 'critical_email',
    entity: 'email_thread',
    sensitive: {
      sender: SECRETS.sender,
      subject: SECRETS.subject,
      expectedAction: SECRETS.expectedAction,
    },
  },
  {
    template: 'critical_email.vip',
    category: 'critical_email',
    entity: 'email_thread',
    sensitive: { vipName: SECRETS.vipName, subject: SECRETS.subject },
  },
  {
    template: 'meeting.upcoming',
    category: 'meeting',
    entity: 'calendar_event',
    sensitive: { meeting: SECRETS.meeting },
  },
  {
    template: 'meeting.conflict',
    category: 'meeting',
    entity: 'calendar_event',
    sensitive: { eventA: SECRETS.eventA, eventB: SECRETS.eventB },
  },
  {
    template: 'deadline.due_soon',
    category: 'deadline',
    entity: 'email_thread',
    sensitive: { title: SECRETS.title },
  },
  {
    template: 'follow_up.no_reply',
    category: 'follow_up',
    entity: 'email_thread',
    sensitive: { person: SECRETS.person, subject: SECRETS.subject },
  },
  {
    template: 'life_intel.payment',
    category: 'life_intel',
    entity: 'life_event',
    sensitive: { issuer: SECRETS.issuer, amount: SECRETS.amount },
  },
  {
    template: 'life_intel.subscription',
    category: 'life_intel',
    entity: 'life_event',
    sensitive: { service: SECRETS.service, amount: SECRETS.amount },
  },
  {
    template: 'life_intel.reservation',
    category: 'life_intel',
    entity: 'life_event',
    sensitive: { venue: SECRETS.venue },
  },
  {
    template: 'life_intel.security',
    category: 'life_intel',
    entity: 'life_event',
    sensitive: { service: SECRETS.service, summary: SECRETS.summary },
  },
  {
    template: 'approval.pending',
    category: 'approval',
    entity: 'email_thread',
    sensitive: { summary: SECRETS.summary },
  },
];

function assertNoSecret(text: string, where: string) {
  for (const value of Object.values(SECRETS)) {
    assertFalse(text.includes(value), `${where} leaked "${value}"`);
  }
  assertFalse(/\d{1,3}(?:\.\d{3})*,\d{2}\s*(?:TL|₺)/.test(text), `${where} leaked an amount`);
}

Deno.test(
  'THR-14: title_only and generic pushes carry no names, subjects or amounts — on the wire or in the ledger',
  async () => {
    for (const detail of ['title_only', 'generic'] as const) {
      for (const b of BUILDS) {
        // A fresh ledger per push, so frequency caps never hide one from the check.
        const p = pipeline(detail, ['ios', 'android']);
        const out = await p.run({
          category: b.category,
          dedupe_key: `${b.template}:${detail}`,
          entity: { type: b.entity, id: ENTITY },
          deeplink: toDeepLink(routes.mailDetail(ENTITY)),
          template_key: b.template,
          params_public: {
            count: 2,
            minutes: 15,
            days: 3,
            date: '25 Eylül',
            time: '14:00',
            timeA: '10:00',
            timeB: '10:30',
            day: 'Yarın',
          },
          params_sensitive: b.sensitive,
          urgency: 'urgent',
        });
        assertEquals(out?.decision, 'sent', `${detail} ${b.template}`);
        assertEquals(p.sent.length, 2);
        for (const message of p.sent) {
          assertNoSecret(`${JSON.stringify(message)}`, `${detail} ${b.template} push`);
          assertEquals(Object.keys(message.data).sort(), ['deeplink', 'entity_id', 'type']);
          assert(new TextEncoder().encode(JSON.stringify(message.data)).length < 1024);
        }
        for (const row of p.n.rows.values()) {
          assertNoSecret(
            `${row.title_rendered ?? ''} ${row.body_rendered ?? ''}`,
            `${detail} ${b.template} ledger`,
          );
        }
      }
    }
  },
);

Deno.test('THR-14: iOS with lock-screen privacy caps full to title_only', async () => {
  const p = pipeline('full', ['ios']);
  await p.run({
    category: 'critical_email',
    dedupe_key: 'critical:ios',
    entity: { type: 'email_thread', id: ENTITY },
    deeplink: toDeepLink(routes.mailDetail(ENTITY)),
    template_key: 'critical_email.reply_needed',
    params_sensitive: {
      sender: SECRETS.sender,
      subject: SECRETS.subject,
      expectedAction: SECRETS.expectedAction,
    },
    urgency: 'urgent',
  });
  assertEquals(p.sent.length, 1);
  assertNoSecret(JSON.stringify(p.sent[0]), 'iOS lock screen');
});

Deno.test('THR-14: an injected web or foreign deep link never reaches the payload', async () => {
  const p = pipeline('title_only', ['android']);
  for (const deeplink of [
    'https://evil.example/login',
    'javascript:alert(1)',
    'dijitalasistan://../../settings/delete-account',
    'intent://evil#Intent;scheme=https;end',
  ]) {
    await p.run({
      category: 'critical_email',
      dedupe_key: `link:${deeplink}`,
      entity: { type: 'email_thread', id: ENTITY },
      deeplink,
      template_key: 'critical_email.reply_needed',
      urgency: 'urgent',
    });
  }
  assertEquals(p.sent.length, 4);
  for (const message of p.sent) {
    assert(message.data.deeplink.startsWith('dijitalasistan://'), message.data.deeplink);
    assertFalse(/evil|javascript|intent|\.\./.test(message.data.deeplink), message.data.deeplink);
  }
});

Deno.test(
  'THR-14: no title_only or generic string in the tr/en catalog can render a sensitive parameter',
  () => {
    const catalogs = { tr: trPush, en: enPush } as const;
    let rendered = 0;
    let fullWithCanary = 0;
    for (const [locale, catalog] of Object.entries(catalogs)) {
      for (const [template, variants] of Object.entries(catalog as Record<string, unknown>)) {
        if (
          template === 'test' ||
          template === 'channels' ||
          template === 'ios' ||
          template === 'foreground'
        )
          continue;
        for (const [variant, modes] of Object.entries(variants as Record<string, unknown>)) {
          const full = (modes as Record<string, { title: string; body: string }>).full;
          if (full === undefined) continue;
          // Every ICU argument of the full text gets a canary, passed as a sensitive parameter.
          const names = [...`${full.title} ${full.body}`.matchAll(/\{(\w+)/g)].map(
            (m) => m[1] ?? '',
          );
          const sensitive = Object.fromEntries(names.map((n) => [n, `CANARY_${n}_X`]));
          for (const mode of ['full', 'title_only', 'generic'] as const) {
            const spec = {
              template,
              variant,
              entityId: ENTITY,
              deeplink: null,
              paramsPublic: {
                count: 1,
                minutes: 5,
                days: 2,
                hours: 3,
                plan: 'Pro',
                store: 'App Store',
                kind: 'mail',
                side: 'referee',
                service: 'Google',
                date: '1 Ekim',
                time_dat: '10:00’a',
                reference: 'DA-000001',
                status: 'yanıtlandı',
              },
              paramsSensitive: sensitive,
              userTest: false,
            } as unknown as NotificationSpec;
            const out = renderNotification(spec, mode, locale as 'tr' | 'en');
            if (mode === 'full') {
              // Control: the canaries do render where they are allowed.
              if (`${out.title} ${out.body}`.includes('CANARY_')) fullWithCanary++;
              continue;
            }
            assertFalse(
              `${out.title} ${out.body}`.includes('CANARY_'),
              `${locale} ${template}.${variant}.${mode}`,
            );
            assertEquals(Object.keys(out.data).sort(), ['deeplink', 'entity_id', 'type']);
            rendered++;
          }
        }
      }
    }
    assert(rendered > 100, `only ${rendered} catalog entries rendered`);
    assert(fullWithCanary > 30, 'the canary check is live: full mode renders them');
  },
);

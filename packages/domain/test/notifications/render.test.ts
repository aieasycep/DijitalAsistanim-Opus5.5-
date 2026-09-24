import { describe, expect, it } from 'vitest';
import { NOTIFICATION_CATEGORY_VALUES } from '../../src/enums.ts';
import type { MessageParams } from '../../src/entities/message.ts';
import {
  ANDROID_CHANNELS,
  androidChannelFor,
  expoPriorityFor,
  interruptionLevelFor,
  relevanceScoreFor,
  ttlSecondsFor,
} from '../../src/notifications/channels.ts';
import {
  pushData,
  pushMessageKeys,
  type PushTemplate,
  render,
  renderText,
  truncateParam,
} from '../../src/notifications/render.ts';

const ID = '5b3a1c9e-2f4d-4a8b-9c7e-1d2f3a4b5c6d';

/** A catalog stand-in: interpolates `{param}` into a fixed Turkish template per key. */
const CATALOG: Record<string, string> = {
  'push.generic.title': 'Dijital Asistan',
  'push.generic.body': 'Yeni bir güncellemen var.',
  'push.critical_email.full.title': '{sender} · {subject}',
  'push.critical_email.full.body': '{action}',
  'push.critical_email.title_only.title': 'Önemli e-posta',
  'push.critical_email.title_only.body': 'Bugün cevaplaman gereken önemli bir mail var.',
  'push.meeting.title_only.body': 'Toplantına {minutes} dakika kaldı.',
};
const resolve = (key: string, params: MessageParams): string =>
  (CATALOG[key] ?? key).replace(/\{(\w+)\}/g, (_m, p: string) => String(params[p] ?? ''));

describe('render() per detail mode (C-14)', () => {
  const input = {
    template: 'critical_email' as const,
    publicParams: { time: '17:00' },
    sensitiveParams: {
      sender: 'Ahmet Yılmaz',
      subject: 'Revize teklif',
      action: "Bugün 17:00'ye kadar yanıt bekliyor.",
    },
    entityId: ID,
  };

  it('UT-NTF-10: full carries names and subjects', () => {
    const t = renderText({ ...input, mode: 'full' }, resolve);
    expect(t.title).toBe('Ahmet Yılmaz · Revize teklif');
    expect(t.body).toBe("Bugün 17:00'ye kadar yanıt bekliyor.");
  });

  it('UT-NTF-11: title_only has no personal data', () => {
    const r = render({ ...input, mode: 'title_only' });
    expect(r.title).toEqual({
      key: 'push.critical_email.title_only.title',
      params: { time: '17:00' },
    });
    const t = renderText({ ...input, mode: 'title_only' }, resolve);
    expect(t.title).toBe('Önemli e-posta');
    expect(t.body).toBe('Bugün cevaplaman gereken önemli bir mail var.');
  });

  it('UT-NTF-12: generic is fixed copy with no params', () => {
    const r = render({ ...input, mode: 'generic' });
    expect(r.title).toEqual({ key: 'push.generic.title', params: {} });
    expect(r.body).toEqual({ key: 'push.generic.body', params: {} });
    const t = renderText({ ...input, mode: 'generic' }, resolve);
    expect([t.title, t.body]).toEqual(['Dijital Asistan', 'Yeni bir güncellemen var.']);
  });

  it('UT-NTF-13 (property): title_only and generic never contain a sensitive value', () => {
    const templates: PushTemplate[] = [...NOTIFICATION_CATEGORY_VALUES, 'weekly', 'reminder'];
    const secrets = [
      'Mehmet Yılmaz',
      'Sözleşme madde 4',
      'mehmet@yilmazendustri.com.tr',
      '1.842,50 TL',
    ];
    // a hostile resolver that would print every param it is given
    const leaky = (key: string, params: MessageParams): string =>
      `${key} ${JSON.stringify(params)}`;
    for (const template of templates) {
      for (const mode of ['title_only', 'generic'] as const) {
        const t = renderText(
          {
            template,
            mode,
            publicParams: { count: 3 },
            sensitiveParams: {
              person: secrets[0] ?? '',
              subject: secrets[1] ?? '',
              sender: secrets[2] ?? '',
              text: secrets[3] ?? '',
            },
            entityId: ID,
          },
          leaky,
        );
        for (const s of secrets) {
          expect(t.title).not.toContain(s);
          expect(t.body).not.toContain(s);
        }
        expect(Object.keys(t.data).sort()).toEqual(['deeplink', 'entity_id', 'type']);
        expect(JSON.stringify(t.data).length).toBeLessThan(1024);
      }
    }
  });

  it('truncates sensitive params (subject ≤40) and the ledger columns', () => {
    const long = 'x'.repeat(80);
    const r = render({
      template: 'critical_email',
      mode: 'full',
      sensitiveParams: { subject: long },
      entityId: ID,
    });
    expect(String(r.title.params.subject)).toHaveLength(40);
    expect(truncateParam('abc', 5)).toBe('abc');
    const t = renderText(
      {
        template: 'critical_email',
        mode: 'full',
        sensitiveParams: { action: 'y'.repeat(500) },
        entityId: ID,
      },
      () => 'z'.repeat(500),
    );
    expect(Array.from(t.title)).toHaveLength(120);
    expect(Array.from(t.body)).toHaveLength(240);
  });

  it('public params appear in title_only (counts, minutes)', () => {
    const t = renderText(
      { template: 'meeting', mode: 'title_only', publicParams: { minutes: 10 }, entityId: ID },
      resolve,
    );
    expect(t.body).toBe('Toplantına 10 dakika kaldı.');
  });

  it('lists every key render() can produce', () => {
    const keys = pushMessageKeys();
    expect(keys).toContain('push.generic.title');
    expect(keys).toContain('push.weekly.full.body');
    expect(keys).toContain('push.reminder.title_only.title');
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(2 + 12 * 4);
  });
});

describe('payload {type, entity_id, deeplink}', () => {
  it('keeps an allow-listed deep link', () => {
    expect(pushData('critical_email', ID, `dijitalasistan://mail/${ID}`)).toEqual({
      type: 'critical_email',
      entity_id: ID,
      deeplink: `dijitalasistan://mail/${ID}`,
    });
  });

  it('replaces a disallowed deep link with the type route (M-GL-08)', () => {
    expect(pushData('meeting', ID, 'javascript:alert(1)').deeplink).toBe(
      `dijitalasistan://meeting/${ID}/prep`,
    );
    expect(pushData('approval', ID, 'https://evil.example.com/x').deeplink).toBe(
      `dijitalasistan://approvals/${ID}`,
    );
  });

  it('weekly uses type evening and the weekly route', () => {
    expect(pushData('weekly', ID)).toEqual({
      type: 'evening',
      entity_id: ID,
      deeplink: `dijitalasistan://weekly/${ID}`,
    });
  });

  it('a missing or invalid entity id falls back to Today', () => {
    expect(pushData('account', 'not-a-uuid')).toEqual({
      type: 'account',
      entity_id: null,
      deeplink: 'dijitalasistan://today',
    });
  });

  it('accepts universal links on the configured origin', () => {
    const d = pushData(
      'life_intel',
      ID,
      `https://dijitalasistan.app/app/life/${ID}`,
      'https://dijitalasistan.app',
    );
    expect(d.deeplink).toBe(`dijitalasistan://life/${ID}`);
  });
});

describe('channels and interruption levels (R-12, UT-NTF-14)', () => {
  it('exactly the R-12 channel ids, all PRIVATE', () => {
    expect(ANDROID_CHANNELS.map((c) => c.id)).toEqual([
      'briefings',
      'critical_email',
      'meetings',
      'deadlines',
      'follow_up',
      'life_intel',
      'approvals',
      'reminders',
      'account',
      'phone_digest',
    ]);
    for (const c of ANDROID_CHANNELS) {
      expect(c.lockscreenVisibility).toBe('private');
      expect(c.nameKey).toBe(`notifications.channel.${c.id}`);
    }
    expect(ANDROID_CHANNELS.find((c) => c.id === 'critical_email')?.importance).toBe('high');
  });

  it.each([
    ['morning', 'briefings'],
    ['midday', 'briefings'],
    ['evening', 'briefings'],
    ['critical_email', 'critical_email'],
    ['meeting', 'meetings'],
    ['deadline', 'deadlines'],
    ['follow_up', 'follow_up'],
    ['life_intel', 'life_intel'],
    ['approval', 'approvals'],
    ['account', 'account'],
    ['reminder', 'reminders'],
  ] as const)('%s → %s', (kind, channel) => {
    expect(androidChannelFor(kind)).toBe(channel);
  });

  it('Android NI digests use phone_digest', () => {
    expect(androidChannelFor('life_intel', { fromAndroidNotificationSignal: true })).toBe(
      'phone_digest',
    );
  });

  it('time_sensitive only for meeting ≤10 min, expiring approval and user reminders', () => {
    expect(interruptionLevelFor({ kind: 'meeting', minutesToStart: 10 })).toBe('time_sensitive');
    expect(interruptionLevelFor({ kind: 'meeting', minutesToStart: 25 })).toBe('active');
    expect(interruptionLevelFor({ kind: 'approval', approvalExpiringSoon: true })).toBe(
      'time_sensitive',
    );
    expect(interruptionLevelFor({ kind: 'approval' })).toBe('active');
    expect(interruptionLevelFor({ kind: 'reminder' })).toBe('time_sensitive');
    expect(interruptionLevelFor({ kind: 'morning' })).toBe('active');
    expect(interruptionLevelFor({ kind: 'critical_email' })).toBe('active');
    expect(interruptionLevelFor({ kind: 'midday' })).toBe('passive');
    expect(interruptionLevelFor({ kind: 'evening' })).toBe('passive');
    expect(interruptionLevelFor({ kind: 'life_intel' })).toBe('passive');
    expect(interruptionLevelFor({ kind: 'life_intel', flightChange: true })).toBe('active');
    expect(interruptionLevelFor({ kind: 'follow_up' })).toBe('passive');
    expect(interruptionLevelFor({ kind: 'deadline' })).toBe('active');
    expect(interruptionLevelFor({ kind: 'account' })).toBe('active');
  });

  it('priority, relevance and ttl', () => {
    expect(expoPriorityFor('meeting', 'active')).toBe('high');
    expect(expoPriorityFor('follow_up', 'passive')).toBe('normal');
    expect(expoPriorityFor('approval', 'time_sensitive')).toBe('high');
    expect(relevanceScoreFor('critical_email', 'urgent')).toBe(0.9);
    expect(relevanceScoreFor('critical_email', 'today')).toBe(0.7);
    expect(relevanceScoreFor('midday', 'normal')).toBe(0.3);
    expect(ttlSecondsFor('meeting')).toBe(1800);
    expect(ttlSecondsFor('morning')).toBe(21600);
    expect(ttlSecondsFor('approval')).toBe(86400);
  });
});

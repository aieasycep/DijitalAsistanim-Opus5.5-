/**
 * Life-intel source mails of the demo mailbox (INTEGRATION_PLAN §13.3): the Trendyol shipment (day 0,
 * 14:00–18:00 window), THY TK2412 İstanbul→Antalya (day +1 09:15), the electricity bill
 * "Elektrik faturası 1.842 TL" (due day +5), the Netflix renewal (day +7), a restaurant reservation
 * (day +2 20:00) and the "Google hesabında yeni giriş." security alert (DKIM/SPF pass). The life events
 * themselves are derived by the pipeline from these mails; nothing here is seeded as a life event.
 */
import type { DemoMailTemplate } from './mails.ts';
import { PEOPLE } from './people.ts';

const P = PEOPLE;

export const LIFE_MAILS: readonly DemoMailTemplate[] = [
  {
    id: 'trendyol-kargo',
    day: 0,
    at: '07:05',
    from: P.trendyol,
    to: ['self'],
    subject: 'Siparişin kargoya verildi',
    snippet:
      'Siparişin bugün 14:00–18:00 arasında teslim edilecek. Kargo takip numarası: 7312345678 (Yurtiçi Kargo).',
    threadKey: 'trendyol-kargo',
    category: 'updates',
    auth: { dkim: 'pass', spf: 'pass', dmarc: 'pass', domain: 'trendyol.com' },
  },
  {
    id: 'thy-tk2412',
    day: -1,
    at: '20:00',
    from: P.thy,
    to: ['self'],
    subject: 'Uçuş bilgileriniz: TK2412 İstanbul → Antalya',
    snippet: (d) =>
      `TK2412 sefer sayılı uçuşunuz ${d.day(1)} 09:15’te İstanbul Havalimanı’ndan Antalya’ya kalkacak. PNR: KZL24A.`,
    threadKey: 'thy-tk2412',
    category: 'updates',
    auth: { dkim: 'pass', spf: 'pass', dmarc: 'pass', domain: 'thy.com' },
  },
  {
    id: 'elektrik-faturasi',
    day: -1,
    at: '10:30',
    from: P.elektrik,
    to: ['self'],
    subject: 'Elektrik faturası 1.842 TL',
    snippet: (d) => `Eylül dönemi elektrik faturanız 1.842,00 TL. Son ödeme tarihi: ${d.day(5)}.`,
    threadKey: 'elektrik-faturasi',
    category: 'updates',
    auth: { dkim: 'pass', spf: 'pass', dmarc: 'pass', domain: 'ckbogazici.com.tr' },
  },
  {
    id: 'netflix-yenileme',
    day: -2,
    at: '12:00',
    from: P.netflix,
    to: ['self'],
    subject: 'Üyeliğin yenilenecek',
    snippet: (d) =>
      `Netflix Standart üyeliğin ${d.day(7)} tarihinde 229,99 TL ile otomatik olarak yenilenecek.`,
    threadKey: 'netflix-yenileme',
    category: 'updates',
    listUnsubscribe: true,
    auth: { dkim: 'pass', spf: 'pass', dmarc: 'pass', domain: 'netflix.com' },
  },
  {
    id: 'restoran-rezervasyon',
    day: -1,
    at: '18:20',
    from: P.restoran,
    to: ['self'],
    subject: 'Rezervasyonunuz onaylandı',
    snippet: (d) =>
      `${d.dayWithWeekday(2)} 20:00 için 2 kişilik rezervasyonunuz onaylandı. Mikla, Beyoğlu.`,
    threadKey: 'restoran-rezervasyon',
    category: 'primary',
  },
  {
    id: 'google-guvenlik',
    day: 0,
    at: '06:50',
    from: P.google,
    to: ['self'],
    subject: 'Google hesabında yeni giriş.',
    snippet:
      'Hesabına yeni bir Windows cihazından giriş yapıldı. Bu sen değilsen hesabını hemen güvenceye al.',
    threadKey: 'google-guvenlik',
    category: 'updates',
    unread: true,
    auth: { dkim: 'pass', spf: 'pass', dmarc: 'pass', domain: 'accounts.google.com' },
  },
];

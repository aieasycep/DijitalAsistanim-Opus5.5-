/**
 * Demo mailbox templates (INTEGRATION_PLAN §13.3): 127 messages over the last 72 hours — 3 important,
 * 2 awaiting my reply, 2 awaiting their reply (sent), 2 with a deadline, 20 informational and 98
 * low-priority newsletters and promotions — plus the life-intel sources of `life.ts` and two
 * time-released messages that arrive later on day 0 (the midday delta). Times are local wall-clock
 * times relative to the anchor day; text depends only on the anchor day, so a day's output is stable.
 */
import { DEMO_SELF, type DemoFlavor, type DemoPerson, PEOPLE } from './people.ts';
import { LIFE_MAILS } from './life.ts';

export interface DemoDates {
  /** "29 Eylül" for an anchor-day offset. */
  readonly day: (offset: number) => string;
  /** "29 Eylül Pazartesi". */
  readonly dayWithWeekday: (offset: number) => string;
}

export interface DemoMailTemplate {
  readonly id: string;
  /** Anchor-day offset (≤ 0; day 0 messages after "now" are time-released). */
  readonly day: number;
  /** Local `HH:mm`. */
  readonly at: string;
  readonly from: DemoPerson | 'self';
  readonly to: readonly (DemoPerson | 'self')[];
  readonly cc?: readonly DemoPerson[];
  readonly subject: string | ((d: DemoDates) => string);
  readonly snippet: string | ((d: DemoDates) => string);
  readonly body?: string | ((d: DemoDates) => string);
  readonly threadKey: string;
  readonly category: 'primary' | 'promotions' | 'social' | 'updates' | 'forums';
  readonly listUnsubscribe?: boolean;
  readonly auth?: {
    dkim: 'pass' | 'fail';
    spf: 'pass' | 'fail';
    dmarc: 'pass' | 'fail';
    domain: string;
  };
  readonly unread?: boolean;
  readonly starred?: boolean;
  readonly importance?: 'high' | 'normal' | 'low';
  /** In-Reply-To of the thread's previous template (threading). */
  readonly replyToTemplate?: string;
}

const P = PEOPLE;

const CORE: readonly DemoMailTemplate[] = [
  // Important (3)
  {
    id: 'revize-teklif',
    day: 0,
    at: '08:42',
    from: P.ahmet,
    to: ['self'],
    subject: 'Revize teklif',
    snippet:
      'Merhaba Yunus, Kuzey Lojistik için revize teklifi bugün 17:00’ye kadar iletebilir misin? Yönetim kurulu yarın sabah karar verecek.',
    body:
      'Merhaba Yunus,\n\nKuzey Lojistik için revize teklifi bugün 17:00’ye kadar iletebilir misin? Yönetim kurulu yarın sabah ' +
      'karar verecek. Özellikle depolama kaleminde güncel fiyatı görmemiz gerekiyor.\n\nTeşekkürler,\nAhmet Yılmaz\nKuzey Lojistik',
    threadKey: 'revize-teklif',
    category: 'primary',
    unread: true,
    importance: 'high',
  },
  {
    id: 'selin-sozlesme',
    day: -1,
    at: '16:10',
    from: P.selin,
    to: ['self'],
    subject: 'Sözleşme taslağı hakkında',
    snippet:
      'Sözleşmenin 4. maddesindeki ödeme vadesi konusunda bir sorum var. Taslağın son halini Cuma’ya kadar gönderirim.',
    threadKey: 'selin-sozlesme',
    category: 'primary',
    unread: true,
  },
  {
    id: 'basvuru-son-gun',
    day: 0,
    at: '07:30',
    from: P.kariyer,
    to: ['self'],
    subject: 'Başvuru bugün 17:00’de kapanıyor',
    snippet:
      'Genç Yetenek Programı başvuruları bugün saat 17:00’de kapanıyor. Formu tamamlamak için son gün.',
    threadKey: 'basvuru',
    category: 'primary',
    unread: true,
  },
  // Awaiting my reply (2)
  {
    id: 'mehmet-toplanti-saati',
    day: -1,
    at: '11:20',
    from: P.mehmet,
    to: ['self'],
    subject: 'Toplantı saati',
    snippet:
      'Bugünkü müşteri toplantısını 14:30’da yapabilir miyiz? Senin için uygunsa teyit eder misin?',
    threadKey: 'mehmet-toplanti',
    category: 'primary',
  },
  {
    id: 'ayse-fatura-onayi',
    day: -2,
    at: '15:05',
    from: P.ayse,
    to: ['self'],
    subject: 'Fatura onayı bekleniyor',
    snippet: 'Eylül dönemi hizmet faturasını ekte gönderdim. Onaylarsan muhasebeye iletiyorum.',
    threadKey: 'ayse-fatura',
    category: 'primary',
  },
  // Awaiting their reply (2, sent)
  {
    id: 'teklif-v2',
    day: -3,
    at: '10:00',
    from: 'self',
    to: [P.mehmet],
    subject: 'Teklif v2',
    snippet:
      'Mehmet Bey merhaba, güncellenmiş teklifimizi (v2) ekte bulabilirsiniz. Değerlendirmenizi bekliyorum.',
    threadKey: 'teklif-v2',
    category: 'primary',
  },
  {
    id: 'sunum-dosyasi',
    day: -2,
    at: '17:30',
    from: 'self',
    to: [P.can],
    subject: 'Sunum dosyası',
    snippet:
      'Can, çeyrek sunumunun taslağını gönderdim. Yorumlarını Perşembe’ye kadar iletebilir misin?',
    threadKey: 'sunum',
    category: 'primary',
  },
  // Deadlines (2)
  {
    id: 'proje-raporu',
    day: -1,
    at: '09:15',
    from: P.can,
    to: ['self'],
    subject: (d) => `Proje raporu ${d.dayWithWeekday(2)} teslim`,
    snippet: (d) =>
      `Kuzey Lojistik proje raporunun son teslim tarihi ${d.day(2)}. Bölüm 3’ü senden bekliyoruz.`,
    threadKey: 'proje-raporu',
    category: 'primary',
  },
  {
    id: 'vergi-beyannamesi',
    day: -2,
    at: '13:00',
    from: P.muhasebe,
    to: ['self'],
    subject: 'KDV beyannamesi hatırlatması',
    snippet: (d) =>
      `KDV beyannamesi için belgelerin en geç ${d.day(3)} tarihine kadar muhasebeye ulaşması gerekiyor.`,
    threadKey: 'kdv',
    category: 'updates',
  },
  // Time-released later on day 0 (midday delta)
  {
    id: 'teslimat-plani',
    day: 0,
    at: '11:05',
    from: P.ahmet,
    to: ['self'],
    cc: [P.can],
    subject: 'Teslimat planı güncellemesi',
    snippet:
      'Antalya deposu için teslimat planını güncelledik; perşembe sevkiyatı sabah 08:00’e alındı.',
    threadKey: 'teslimat-plani',
    category: 'primary',
    unread: true,
  },
  {
    id: 'toplanti-oncesi-not',
    day: 0,
    at: '12:20',
    from: P.mehmet,
    to: ['self'],
    subject: 'Toplantı öncesi kısa not',
    snippet:
      'Toplantıda bütçe kalemlerini de konuşalım; güncel tabloyu toplantıdan önce paylaşabilir misin?',
    threadKey: 'mehmet-toplanti',
    category: 'primary',
    unread: true,
    replyToTemplate: 'mehmet-toplanti-saati',
  },
];

const INFO_SUBJECTS: readonly [string, string][] = [
  ['Haftalık ekip notları', 'Bu haftanın notlarını paylaşıyorum; öne çıkan konu depo otomasyonu.'],
  ['Ofis duyurusu', 'Cuma günü ofis 18:00’de kapanacak; toplantı odaları rezervasyona açık.'],
  ['Yeni proje kanalı', 'Antalya projesi için ayrı bir çalışma alanı açtık, dosyalar orada.'],
  ['Müşteri geri bildirimi', 'Geçen haftaki teslimat için müşteri memnuniyet puanı 4,7 oldu.'],
  ['Eğitim takvimi', 'Ekim ayı iç eğitim takvimi yayınlandı; kayıtlar açık.'],
  ['Toplantı özeti', 'Dünkü planlama toplantısının özetini ekte bulabilirsin.'],
  ['Sistem bakımı', 'Pazar gecesi 02:00–04:00 arasında planlı bakım yapılacak.'],
  ['Yeni ekip arkadaşı', 'Operasyon ekibimize Deniz katıldı, hoş geldin diyelim.'],
  ['Satış raporu', 'Eylül satış raporu hazır; bölgesel kırılım ikinci sayfada.'],
  ['Tedarikçi listesi', 'Güncel tedarikçi listesini paylaşıyorum, iki yeni firma eklendi.'],
];

const INFO_SENDERS: readonly DemoPerson[] = [P.can, P.ayse, P.ahmet, P.mehmet];

const BULK_BRANDS: readonly {
  name: string;
  email: string;
  category: DemoMailTemplate['category'];
}[] = [
  { name: 'Hepsiburada', email: 'kampanya@hepsiburada.com', category: 'promotions' },
  { name: 'Migros', email: 'bulten@migros.com.tr', category: 'promotions' },
  { name: 'LinkedIn', email: 'messages-noreply@linkedin.com', category: 'social' },
  { name: 'Medium Günlük', email: 'noreply@medium.com', category: 'updates' },
  { name: 'Spotify', email: 'no-reply@spotify.com', category: 'promotions' },
  { name: 'Getir', email: 'kampanya@getir.com', category: 'promotions' },
  { name: 'Instagram', email: 'no-reply@mail.instagram.com', category: 'social' },
  { name: 'Teknoloji Bülteni', email: 'bulten@webrazzi.com', category: 'updates' },
  { name: 'Yemeksepeti', email: 'kampanya@yemeksepeti.com', category: 'promotions' },
  { name: 'Kitapyurdu', email: 'bulten@kitapyurdu.com', category: 'promotions' },
  { name: 'GitHub', email: 'noreply@github.com', category: 'updates' },
  { name: 'Pegasus', email: 'kampanya@flypgs.com', category: 'promotions' },
  { name: 'Forum Topluluğu', email: 'digest@forum.example.org', category: 'forums' },
  { name: 'Boyner', email: 'bulten@boyner.com.tr', category: 'promotions' },
];

const BULK_SUBJECTS: readonly [string, string][] = [
  ['Hafta sonuna özel indirimler', 'Seçili ürünlerde %30’a varan indirim seni bekliyor.'],
  ['Bu haftanın öne çıkanları', 'Kaçırmaman gereken içerikleri senin için derledik.'],
  ['Yeni bağlantı önerileri', 'Tanıyor olabileceğin 5 kişi var.'],
  ['Sepetinde ürün kaldı', 'Beğendiğin ürünler tükenmeden siparişini tamamla.'],
  ['Kişisel çalma listen hazır', 'Bu haftanın keşif listesi güncellendi.'],
  ['Günün fırsatı', 'Sadece bugün geçerli fırsatları incele.'],
  ['Aylık bülten', 'Sektörden son gelişmeler ve öne çıkan yazılar.'],
];

function informational(): DemoMailTemplate[] {
  const out: DemoMailTemplate[] = [];
  for (let i = 0; i < 20; i++) {
    const [subject, snippet] = INFO_SUBJECTS[i % INFO_SUBJECTS.length] as [string, string];
    const minutes = 8 * 60 + ((i * 97) % (10 * 60));
    out.push({
      id: `bilgi-${String(i + 1).padStart(2, '0')}`,
      day: -(i % 3),
      at: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
      from: INFO_SENDERS[i % INFO_SENDERS.length] as DemoPerson,
      to: ['self'],
      subject:
        i < INFO_SUBJECTS.length
          ? subject
          : `${subject} (${Math.floor(i / INFO_SUBJECTS.length) + 1})`,
      snippet,
      threadKey: `bilgi-${i + 1}`,
      category: 'primary',
    });
  }
  return out;
}

function lowPriority(): DemoMailTemplate[] {
  const out: DemoMailTemplate[] = [];
  for (let i = 0; i < 98; i++) {
    const brand = BULK_BRANDS[i % BULK_BRANDS.length] as (typeof BULK_BRANDS)[number];
    const [subject, snippet] = BULK_SUBJECTS[(i * 3) % BULK_SUBJECTS.length] as [string, string];
    const minutes = 6 * 60 + ((i * 53) % (16 * 60));
    out.push({
      id: `toplu-${String(i + 1).padStart(3, '0')}`,
      day: -(i % 3),
      at: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
      from: {
        key: `brand-${i % BULK_BRANDS.length}`,
        name: brand.name,
        email: brand.email,
        organization: brand.name,
      },
      to: ['self'],
      subject: `${brand.name}: ${subject}`,
      snippet,
      threadKey: `toplu-${i + 1}`,
      category: brand.category,
      listUnsubscribe: true,
      unread: i % 4 !== 0,
    });
  }
  return out;
}

export const MAIL_TEMPLATES: readonly DemoMailTemplate[] = [
  ...CORE,
  ...informational(),
  ...lowPriority(),
  ...LIFE_MAILS,
];

export function selfOf(flavor: DemoFlavor): DemoPerson {
  return DEMO_SELF[flavor];
}

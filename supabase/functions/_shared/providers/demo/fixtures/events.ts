/**
 * Demo calendars and meetings (INTEGRATION_PLAN §13.3). Google flavour: "Kişisel" (primary) and "İş";
 * Microsoft flavour: "Outlook takvimi". Meetings: day 0 14:30 "Mehmet ile müşteri toplantısı"
 * (Yılmaz Endüstri, a Meet/Teams link), day 0 16:00 "Ürün gözden geçirme", day +1 14:00–15:00
 * "Müşteri toplantısı" overlapping 14:30 "Doktor randevusu" (the conflict scenario), and the weekly
 * Monday 09:00 "Haftalık ekip" occurrences.
 */
import type { DemoFlavor, DemoPerson } from './people.ts';
import { PEOPLE } from './people.ts';

export interface DemoCalendarTemplate {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly primary: boolean;
}

export const DEMO_CALENDARS: Readonly<Record<DemoFlavor, readonly DemoCalendarTemplate[]>> = {
  google: [
    { id: 'demo-cal-kisisel', name: 'Kişisel', color: '#3F7D5B', primary: true },
    { id: 'demo-cal-is', name: 'İş', color: '#2E5AAC', primary: false },
  ],
  microsoft: [{ id: 'demo-cal-outlook', name: 'Outlook takvimi', color: '#0F6CBD', primary: true }],
};

export interface DemoEventTemplate {
  readonly id: string;
  /** Anchor-day offset. */
  readonly day: number;
  readonly start: string;
  readonly end: string;
  readonly title: string;
  readonly location?: string;
  readonly attendees: readonly DemoPerson[];
  /** 'work' → İş (Google) / Outlook takvimi; 'personal' → Kişisel / Outlook takvimi. */
  readonly calendar: 'work' | 'personal';
  readonly conference?: boolean;
  readonly description?: string;
}

const P = PEOPLE;

export const EVENT_TEMPLATES: readonly DemoEventTemplate[] = [
  {
    id: 'mehmet-musteri',
    day: 0,
    start: '14:30',
    end: '15:30',
    title: 'Mehmet ile müşteri toplantısı',
    location: 'Yılmaz Endüstri Genel Merkez',
    attendees: [P.mehmet, P.ayse],
    calendar: 'work',
    conference: true,
    description:
      'Revize teklif ve 2026 bütçe kalemleri. Güncel fiyat tablosu toplantıdan önce paylaşılacak.',
  },
  {
    id: 'urun-gozden-gecirme',
    day: 0,
    start: '16:00',
    end: '16:45',
    title: 'Ürün gözden geçirme',
    attendees: [P.can],
    calendar: 'work',
  },
  {
    id: 'musteri-toplantisi',
    day: 1,
    start: '14:00',
    end: '15:00',
    title: 'Müşteri toplantısı',
    location: 'Kuzey Lojistik, Maslak',
    attendees: [P.ahmet],
    calendar: 'work',
  },
  {
    id: 'doktor-randevusu',
    day: 1,
    start: '14:30',
    end: '15:15',
    title: 'Doktor randevusu',
    location: 'Acıbadem Maslak',
    attendees: [],
    calendar: 'personal',
  },
];

/** The recurring Monday 09:00–09:30 "Haftalık ekip" (occurrences within the window). */
export const WEEKLY_TEAM: Omit<DemoEventTemplate, 'day'> = {
  id: 'haftalik-ekip',
  start: '09:00',
  end: '09:30',
  title: 'Haftalık ekip',
  attendees: [P.can, P.ayse],
  calendar: 'work',
  conference: true,
};

export function calendarFor(flavor: DemoFlavor, kind: 'work' | 'personal'): string {
  if (flavor === 'microsoft') return 'demo-cal-outlook';
  return kind === 'work' ? 'demo-cal-is' : 'demo-cal-kisisel';
}

export function conferenceUrlFor(flavor: DemoFlavor, templateId: string): string {
  const code = [...templateId]
    .reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)
    .toString(36)
    .padStart(6, 'a');
  return flavor === 'microsoft'
    ? `https://teams.microsoft.com/l/meetup-join/demo-${code}`
    : `https://meet.google.com/${code.slice(0, 3)}-${code.slice(3, 6)}-dmo`;
}

/**
 * Demo people (INTEGRATION_PLAN §13.3; PRIMARY names). Addresses match the demo seed
 * (`supabase/seed/demo/10_demo_dataset.sql`) so seeded and synced demo data describe the same people.
 */
export interface DemoPerson {
  readonly key: string;
  readonly name: string;
  readonly email: string;
  readonly organization: string | null;
}

export const PEOPLE = {
  ahmet: {
    key: 'ahmet',
    name: 'Ahmet Yılmaz',
    email: 'ahmet@kuzeylojistik.com',
    organization: 'Kuzey Lojistik',
  },
  mehmet: {
    key: 'mehmet',
    name: 'Mehmet Yılmaz',
    email: 'mehmet@yilmazendustri.com',
    organization: 'Yılmaz Endüstri',
  },
  selin: { key: 'selin', name: 'Selin Kaya', email: 'selin.kaya@gmail.com', organization: null },
  ayse: {
    key: 'ayse',
    name: 'Ayşe Demir',
    email: 'ayse.demir@yilmazendustri.com',
    organization: 'Yılmaz Endüstri',
  },
  can: {
    key: 'can',
    name: 'Can Öztürk',
    email: 'can.ozturk@kuzeylojistik.com',
    organization: 'Kuzey Lojistik',
  },
  muhasebe: {
    key: 'muhasebe',
    name: 'Yılmaz Endüstri Muhasebe',
    email: 'muhasebe@yilmazendustri.com',
    organization: 'Yılmaz Endüstri',
  },
  kariyer: {
    key: 'kariyer',
    name: 'Genç Yetenek Programı',
    email: 'basvuru@gencyetenek.org.tr',
    organization: null,
  },
  trendyol: {
    key: 'trendyol',
    name: 'Trendyol',
    email: 'bildirim@trendyol.com',
    organization: 'Trendyol',
  },
  thy: {
    key: 'thy',
    name: 'Türk Hava Yolları',
    email: 'noreply@thy.com',
    organization: 'Türk Hava Yolları',
  },
  elektrik: {
    key: 'elektrik',
    name: 'CK Boğaziçi Elektrik',
    email: 'e-fatura@ckbogazici.com.tr',
    organization: 'CK Boğaziçi Elektrik',
  },
  netflix: {
    key: 'netflix',
    name: 'Netflix',
    email: 'info@account.netflix.com',
    organization: 'Netflix',
  },
  google: {
    key: 'google',
    name: 'Google',
    email: 'no-reply@accounts.google.com',
    organization: 'Google',
  },
  restoran: {
    key: 'restoran',
    name: 'Mikla Restoran',
    email: 'rezervasyon@miklarestoran.com',
    organization: 'Mikla',
  },
} as const satisfies Record<string, DemoPerson>;

export type DemoPersonKey = keyof typeof PEOPLE;

export type DemoFlavor = 'google' | 'microsoft';

/** The demo user's own mailbox per flavour (displayed "Gmail (Demo)" / "Outlook (Demo)"). */
export const DEMO_SELF: Readonly<Record<DemoFlavor, DemoPerson>> = {
  google: { key: 'self', name: 'Yunus', email: 'yunus@gmail.com', organization: null },
  microsoft: { key: 'self', name: 'Yunus', email: 'yunus@outlook.com', organization: null },
};

/**
 * Demo task lists (INTEGRATION_PLAN §13.3): Google Tasks "Görevlerim" with 3 tasks (one due day 0)
 * and To Do "Görevler" with 2.
 */
import type { DemoFlavor } from './people.ts';

export interface DemoTaskTemplate {
  readonly id: string;
  readonly title: string;
  readonly notes?: string;
  /** Anchor-day offset of the due date; absent = no due date. */
  readonly dueDay?: number;
  readonly completedDay?: number;
}

export const DEMO_TASK_LISTS: Readonly<
  Record<
    DemoFlavor,
    { readonly id: string; readonly name: string; readonly tasks: readonly DemoTaskTemplate[] }
  >
> = {
  google: {
    id: 'demo-list-gorevlerim',
    name: 'Görevlerim',
    tasks: [
      { id: 'teklif-v2-gonder', title: 'Teklif v2’yi Mehmet’e gönder', dueDay: 0 },
      { id: 'elektrik-ode', title: 'Elektrik faturasını öde', notes: '1.842,00 TL', dueDay: 5 },
      { id: 'sunum-guncelle', title: 'Çeyrek sunumunu güncelle' },
    ],
  },
  microsoft: {
    id: 'demo-list-gorevler',
    name: 'Görevler',
    tasks: [
      { id: 'sozlesme-incele', title: 'Sözleşme taslağını incele', dueDay: 2 },
      { id: 'toplanti-notlari', title: 'Ekip toplantısı notlarını paylaş', completedDay: -1 },
    ],
  },
};

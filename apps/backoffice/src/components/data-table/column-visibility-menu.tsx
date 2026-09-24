'use client';

import { useTranslations } from 'next-intl';

import { Icon } from '@/components/icon';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface VisibilityColumn {
  readonly id: string;
  readonly label: string;
  readonly visible: boolean;
  readonly canHide: boolean;
  readonly toggle: (visible: boolean) => void;
}

/** "Sütunlar" menu; required (id/primary) columns stay visible and are shown disabled (§5.3). */
export function ColumnVisibilityMenu({ columns }: { columns: readonly VisibilityColumn[] }) {
  const t = useTranslations('backoffice.table');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm">
          <Icon name="view_column" size={16} />
          {t('columns')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={column.visible}
            disabled={!column.canHide}
            title={column.canHide ? undefined : t('requiredColumn')}
            onSelect={(event) => {
              event.preventDefault();
            }}
            onCheckedChange={(checked) => {
              column.toggle(checked);
            }}
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

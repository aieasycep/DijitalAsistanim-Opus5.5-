import type { Messages } from '@da/i18n/use-intl';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/card';
import { statusTone } from '@/lib/status-tone';

/*
 * Enum labels and status badges (BACKOFFICE_PLAN §5.1 "Badges are coloured only for semantic
 * states"): the label comes from `backoffice.enums.<group>.<value>`; the tone from `statusTone`.
 * Shared by server components and client islands.
 */

export type EnumGroup = keyof Messages['backoffice']['enums'];

/** Enum values that are not valid message keys (`SANDBOX`, `1`, `-1`) are normalised first. */
export function enumKey(value: string): string {
  if (value === '1') return 'positive';
  if (value === '-1') return 'negative';
  return value.toLowerCase();
}

export function useEnumLabel(): (group: EnumGroup, value: string | null | undefined) => string {
  const t = useTranslations('backoffice.enums');
  return (group, value) => {
    if (value === null || value === undefined) return '—';
    const key = `${group}.${enumKey(value)}` as Parameters<typeof t>[0];
    return t.has(key) ? t(key) : value;
  };
}

export function EnumLabel({
  group,
  value,
}: {
  group: EnumGroup;
  value: string | null | undefined;
}) {
  const label = useEnumLabel();
  return <>{label(group, value)}</>;
}

export function StatusBadge({
  group,
  value,
  className,
}: {
  group: EnumGroup;
  value: string | null | undefined;
  className?: string;
}) {
  const label = useEnumLabel();
  if (value === null || value === undefined) return <span className="text-ink-3">—</span>;
  return (
    <Badge tone={statusTone(value)} className={className} data-status={value}>
      {label(group, value)}
    </Badge>
  );
}

/**
 * `DaWidgets` JS interface (T-8.25, SCREEN_AND_FLOW_MAP §11.1). Every write is zod-validated
 * against `WidgetSnapshotV1` (strict objects, detail-level rules, 8 KB budget) before it reaches
 * the App Group (iOS `da.widget.snapshot.v1`) or SharedPreferences (Android `da_widget` /
 * `snapshot_v1`), so nothing outside the schema — a mail body, a signed URL — can be stored.
 */
import { WidgetSnapshotV1 } from '@da/validation/widget-snapshot';

import { nativeWidgets, type WidgetInventory } from './native';

export type { WidgetInventory } from './native';

export function isWidgetBridgeAvailable(): boolean {
  return nativeWidgets() !== null;
}

/** Validates and stores a snapshot, then redraws the widgets; returns what was written. */
export async function setSnapshot(snapshot: unknown, scheme: string): Promise<WidgetSnapshotV1> {
  const valid = WidgetSnapshotV1.parse(snapshot);
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) throw new Error('invalid_scheme');
  await nativeWidgets()?.setSnapshot(JSON.stringify(valid), scheme);
  return valid;
}

/** The stored snapshot, or null when none (or an invalid one) is stored. */
export async function getSnapshot(): Promise<WidgetSnapshotV1 | null> {
  const raw = (await nativeWidgets()?.getSnapshot()) ?? null;
  if (raw === null) return null;
  try {
    const parsed = WidgetSnapshotV1.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function reloadWidgets(): Promise<void> {
  await nativeWidgets()?.reload();
}

export async function getInventory(): Promise<WidgetInventory | null> {
  return (await nativeWidgets()?.getInventory()) ?? null;
}

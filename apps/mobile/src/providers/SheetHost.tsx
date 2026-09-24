/**
 * Sheet host (M-GL-06): transient sheets opened by key (`sheet(host)` in the screen map) through a
 * small stack store. Features register a renderer per key with `registerSheet`; the renderer draws
 * the `@da/ui` `BottomSheet` / `ConfirmDialog` with the `visible`, `onDismiss` and `onHidden`
 * props it receives, so motion, focus, Android back and the scrim stay in the kit. Several sheets
 * can stack; closing hides the top one and removes it after its exit animation.
 */
import type { SHEET_KEYS } from '@da/domain/analytics/vocab';
import { Fragment, useSyncExternalStore, type ReactNode } from 'react';

import { track } from '../lib/events';

type AnalyticsSheetKey = (typeof SHEET_KEYS)[number];

export interface SheetRenderProps<P> {
  readonly params: P;
  readonly visible: boolean;
  /** Dismiss request (scrim, drag, back, or an action). */
  readonly onDismiss: () => void;
  /** Called by the sheet after its exit animation. */
  readonly onHidden: () => void;
}

interface Registration {
  readonly render: (props: SheetRenderProps<unknown>) => ReactNode;
  readonly analyticsKey?: AnalyticsSheetKey;
}

interface Entry {
  readonly id: string;
  readonly key: string;
  readonly params: unknown;
  readonly visible: boolean;
}

const registry = new Map<string, Registration>();
let stack: readonly Entry[] = [];
let sequence = 0;
const listeners = new Set<() => void>();

function publish(next: readonly Entry[]): void {
  stack = next;
  for (const listener of listeners) listener();
}

/** Registers the renderer of a sheet key (a feature module does this at import time). */
export function registerSheet<P>(
  key: string,
  render: (props: SheetRenderProps<P>) => ReactNode,
  options: { readonly analyticsKey?: AnalyticsSheetKey } = {},
): () => void {
  registry.set(key, {
    render: render as (props: SheetRenderProps<unknown>) => ReactNode,
    ...(options.analyticsKey === undefined ? {} : { analyticsKey: options.analyticsKey }),
  });
  return () => {
    registry.delete(key);
  };
}

export const sheets = {
  /** Opens a registered sheet on top of the stack; returns its id. */
  open(key: string, params: unknown): string {
    const registration = registry.get(key);
    if (registration === undefined) throw new Error(`[SheetHost] no sheet registered as ${key}`);
    sequence += 1;
    const id = `sheet-${String(sequence)}`;
    publish([...stack, { id, key, params, visible: true }]);
    if (registration.analyticsKey !== undefined) {
      track('sheet_opened', { key: registration.analyticsKey });
    }
    return id;
  },
  /** Hides a sheet (the top one by default); it unmounts after its exit animation. */
  close(id?: string): void {
    const target = id ?? stack.filter((e) => e.visible).at(-1)?.id;
    if (target === undefined) return;
    publish(stack.map((e) => (e.id === target ? { ...e, visible: false } : e)));
  },
  closeAll(): void {
    publish(stack.map((e) => ({ ...e, visible: false })));
  },
  /** The open sheet keys, bottom to top. */
  openKeys(): string[] {
    return stack.filter((e) => e.visible).map((e) => e.key);
  },
};

function remove(id: string): void {
  publish(stack.filter((e) => e.id !== id));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getStack(): readonly Entry[] {
  return stack;
}

export function SheetHost(): ReactNode {
  const entries = useSyncExternalStore(subscribe, getStack, getStack);
  return entries.map((entry) => {
    const registration = registry.get(entry.key);
    if (registration === undefined) return null;
    return (
      <Fragment key={entry.id}>
        {registration.render({
          params: entry.params,
          visible: entry.visible,
          onDismiss: () => {
            sheets.close(entry.id);
          },
          onHidden: () => {
            remove(entry.id);
          },
        })}
      </Fragment>
    );
  });
}

export function resetSheetsForTests(): void {
  publish([]);
}

/**
 * The `DaWidgets` native module (iOS `ios/DaWidgetsModule.swift`, Android
 * `expo.modules.dawidgets.DaWidgetsModule`). `null` where it is not linked (Expo Go, unit tests
 * without the double in `test/setup/native-mocks.ts`).
 */
import { requireOptionalNativeModule } from 'expo';

/** `widget_inventory`: bit flags of installed iOS families / Android sizes. */
export interface WidgetInventory {
  readonly ios_families: number;
  readonly android_kinds: number;
}

export interface DaWidgetsNativeModule {
  /** Stores the snapshot JSON and this build's URL scheme, then redraws every widget. */
  setSnapshot(json: string, scheme: string): Promise<void>;
  getSnapshot(): Promise<string | null>;
  reload(): Promise<void>;
  getInventory(): Promise<WidgetInventory>;
}

export function nativeWidgets(): DaWidgetsNativeModule | null {
  return requireOptionalNativeModule<DaWidgetsNativeModule>('DaWidgets');
}

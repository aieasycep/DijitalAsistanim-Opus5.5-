/**
 * JS side of the local `notification-intelligence` module (T-8.26, SCREEN_AND_FLOW_MAP §9). On
 * Android it wraps the Kotlin module; on iOS, in Expo Go and in tests there is no native module and
 * every call reports the feature as unavailable, so callers never need a platform check of their
 * own beyond `isSupported()`.
 */
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type NiMode = 'selected' | 'all';

export type NiCategory = 'cargo' | 'bank_payment' | 'flight' | 'reservation' | 'other';

export type NiTrackingStatus =
  'created' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception';

export type NiLockedGroup =
  | 'authenticator'
  | 'password_manager'
  | 'e_devlet'
  | 'messaging'
  | 'google_play_services'
  | 'own_app';

/** A structured signal exactly as the extractor produced it (API-ANI-01 field names). */
export interface NiSignal {
  readonly signal_hash: string;
  readonly package: string;
  readonly app_label: string;
  readonly category: NiCategory;
  readonly amount?: { readonly value: string; readonly currency: string };
  readonly due_date?: string;
  readonly tracking_status?: NiTrackingStatus;
  readonly flight_no?: string;
  readonly gate?: string;
  readonly posted_at: string;
}

export interface NiRecentSignal extends NiSignal {
  readonly uploaded: boolean;
}

export interface NiState {
  readonly granted: boolean;
  readonly enabled: boolean;
  readonly mode: NiMode;
  readonly allowedPackages: readonly string[];
}

export interface NiCandidateApp {
  readonly package: string;
  readonly label: string;
  readonly seenCount: number;
  readonly lastSeenAt: string | null;
  readonly locked: boolean;
  readonly lockedGroup: NiLockedGroup | null;
}

export interface NiSubscription {
  remove(): void;
}

/** The native surface (Kotlin `NotificationIntelligenceModule`). */
export interface NotificationIntelligenceNative {
  isAvailable(): boolean;
  isGranted(): boolean;
  openSettings(): boolean;
  getState(): NiState;
  setEnabled(enabled: boolean): void;
  setMode(mode: NiMode): void;
  setAllowedPackages(packages: readonly string[]): void;
  listCandidateApps(): readonly NiCandidateApp[];
  getPendingSignals(limit: number): readonly NiSignal[];
  getRecentSignals(limit: number): readonly NiRecentSignal[];
  markUploaded(hashes: readonly string[]): void;
  deleteSignal(hash: string): void;
  clearBuffer(): void;
  disable(): void;
  reset(): void;
  addListener(event: 'onGrantChanged', listener: (e: { granted: boolean }) => void): NiSubscription;
  addListener(event: 'onSignalsChanged', listener: () => void): NiSubscription;
}

/** The Android module, or null (iOS, Expo Go, unit tests). */
export function loadNotificationIntelligence(): NotificationIntelligenceNative | null {
  if (Platform.OS !== 'android') return null;
  return requireOptionalNativeModule<NotificationIntelligenceNative>('NotificationIntelligence');
}

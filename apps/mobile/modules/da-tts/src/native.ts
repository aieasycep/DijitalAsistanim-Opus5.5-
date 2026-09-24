/**
 * The `DaTts` native module (iOS `ios/DaTtsModule.swift`, Android
 * `expo.modules.datts.DaTtsModule`). `null` where it is not linked (Expo Go, older builds, unit
 * tests unless a test installs the double).
 */
import { requireOptionalNativeModule } from 'expo';

export interface NativeVoice {
  readonly identifier: string;
  readonly name: string;
  /** BCP 47 (`tr-TR`). */
  readonly language: string;
  readonly quality: 'default' | 'enhanced' | 'premium';
  readonly networkRequired: boolean;
}

export interface SynthesisOptions {
  readonly voice: string | null;
  readonly language: string;
  /** `file://` target in the cache directory. */
  readonly uri: string;
}

export interface DaTtsNativeModule {
  /** Android `TextToSpeech.getMaxSpeechInputLength()`; absent on iOS (no limit). */
  readonly maxInputLength?: number;
  getVoices(): Promise<NativeVoice[]>;
  synthesizeToFile(
    text: string,
    options: SynthesisOptions,
  ): Promise<{ uri: string; durationMs: number }>;
}

export function nativeTts(): DaTtsNativeModule | null {
  return requireOptionalNativeModule<DaTtsNativeModule>('DaTts');
}

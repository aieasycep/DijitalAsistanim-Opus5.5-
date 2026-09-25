/**
 * Native module doubles for Jest (setupFiles). Each keeps the real module's contract so the code
 * under test runs unchanged: SecureStore is an in-memory keychain that records the accessibility
 * option, expo-crypto uses Node's crypto, MMKV uses its own built-in test implementation
 * (`createMockMMKV`), and the libraries that ship Jest mocks (NetInfo, keyboard-controller,
 * gesture-handler) use them.
 */
import { jest } from '@jest/globals';
import type * as NodeCrypto from 'node:crypto';
import type * as React from 'react';
import type * as ReactNative from 'react-native';
// The kit's gestures and sheets.
import 'react-native-gesture-handler/jestSetup';

jest.mock('react-native-keyboard-controller', () =>
  jest.requireActual('react-native-keyboard-controller/jest'),
);

jest.mock('@react-native-community/netinfo', () =>
  jest.requireActual('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

/**
 * MMKV's own in-memory test instance, plus what the storage tests assert: the encryption each
 * instance was opened with and every re-key (`encrypt`). `__instances` maps ids to the latest one.
 */
jest.mock('react-native-mmkv', () => {
  const { createMockMMKV } = jest.requireActual<{
    createMockMMKV: (config?: { id: string }) => Record<string, unknown>;
  }>('react-native-mmkv/lib/createMMKV/createMockMMKV');
  const instances = new Map<string, Record<string, unknown>>();
  return {
    __instances: instances,
    createMMKV: jest.fn(
      (
        config: { id: string; encryptionKey?: string; encryptionType?: string } = {
          id: 'mmkv.default',
        },
      ) => {
        const base = createMockMMKV(config);
        const instance = Object.assign(base, {
          __encryptionKey: config.encryptionKey ?? null,
          __encryptionType: config.encryptionType ?? null,
          encrypt(key: string, type?: string) {
            instance.__encryptionKey = key;
            instance.__encryptionType = type ?? 'AES-128';
          },
        });
        instances.set(config.id, instance);
        return instance;
      },
    ),
  };
});

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  const accessibility = new Map<string, unknown>();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    __store: store,
    __accessibility: accessibility,
    getItemAsync: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItemAsync: jest.fn(
      (key: string, value: string, options?: { keychainAccessible?: unknown }) => {
        store.set(key, value);
        accessibility.set(key, options?.keychainAccessible);
        return Promise.resolve();
      },
    ),
    deleteItemAsync: jest.fn((key: string) => {
      store.delete(key);
      accessibility.delete(key);
      return Promise.resolve();
    }),
  };
});

jest.mock('expo-crypto', () => {
  const nodeCrypto = jest.requireActual<typeof NodeCrypto>('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    getRandomBytes: jest.fn((count: number) => new Uint8Array(nodeCrypto.randomBytes(count))),
    randomUUID: jest.fn(() => nodeCrypto.randomUUID()),
    digestStringAsync: jest.fn((_algorithm: string, data: string) =>
      Promise.resolve(nodeCrypto.createHash('sha256').update(data).digest('hex')),
    ),
    // T-8.17 capture uploads hash the file bytes.
    digest: jest.fn((_algorithm: string, data: Uint8Array) => {
      const hash = nodeCrypto.createHash('sha256').update(data).digest();
      return Promise.resolve(hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength));
    }),
  };
});

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.0.0',
  nativeBuildVersion: '42',
  applicationId: 'com.dijitalasistan.app.dev',
}));

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(() => Promise.resolve({ type: 'opened' })),
  openAuthSessionAsync: jest.fn(() => Promise.resolve({ type: 'cancel' })),
}));

jest.mock('expo-haptics', () => ({
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
  ImpactFeedbackStyle: { Light: 'light' },
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-notifications', () => ({
  IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3 },
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'undetermined' })),
  unregisterForNotificationsAsync: jest.fn(() => Promise.resolve()),
  cancelAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve()),
  // T-8.06 notification step
  AndroidImportance: { HIGH: 4, DEFAULT: 3, LOW: 2 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  // T-8.18 device-local reminder notifications (until T-8.24 owns them).
  SchedulableTriggerInputTypes: { DATE: 'date' },
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('reminder')),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: 'ExponentPushToken[test]' })),
  // T-8.24 notification layer: categories, handlers, listeners and the scheduled list.
  setNotificationCategoryAsync: jest.fn(() => Promise.resolve(null)),
  setNotificationHandler: jest.fn(),
  getLastNotificationResponse: jest.fn(() => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  getAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve([])),
  dismissNotificationAsync: jest.fn(() => Promise.resolve()),
}));

// T-8.28: Sentry is initialised only with a DSN (unset in tests); the SDK surface is a double.
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  wrap: <T>(component: T): T => component,
  setTags: jest.fn(),
  setTag: jest.fn(),
  captureException: jest.fn(() => 'event-id'),
  appLoaded: jest.fn(),
  startInactiveSpan: jest.fn(() => ({ end: jest.fn() })),
}));

jest.mock('expo-apple-authentication', () => {
  const { View } = jest.requireActual<typeof ReactNative>('react-native');
  const { createElement } = jest.requireActual<typeof React>('react');
  return {
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    AppleAuthenticationButtonType: { SIGN_IN: 0, CONTINUE: 1 },
    AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
    signInAsync: jest.fn(),
    formatFullName: jest.fn((name: { givenName?: string | null; familyName?: string | null }) =>
      [name.givenName, name.familyName].filter(Boolean).join(' '),
    ),
    AppleAuthenticationButton: (props: { onPress: () => void }) =>
      createElement(View, {
        accessible: true,
        accessibilityRole: 'button',
        accessibilityLabel: 'Apple',
        onTouchEnd: props.onPress,
        testID: 'apple-native-button',
      }),
  };
});

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(() => Promise.resolve(true)),
    signIn: jest.fn(),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
    SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
  },
  isErrorWithCode: (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error,
  isSuccessResponse: (response: { type: string }) => response.type === 'success',
}));

// ── T-8.07 / T-8.09 native doubles ─────────────────────────────────────────────────────────

jest.mock('expo-calendar/legacy', () => ({
  EntityTypes: { EVENT: 'event', REMINDER: 'reminder' },
  CalendarType: { LOCAL: 'local', SUBSCRIBED: 'subscribed', BIRTHDAYS: 'birthdays' },
  EventStatus: { CONFIRMED: 'confirmed', TENTATIVE: 'tentative', CANCELED: 'canceled' },
  getCalendarPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'undetermined', canAskAgain: true, granted: false }),
  ),
  requestCalendarPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted', canAskAgain: true, granted: true }),
  ),
  getCalendarsAsync: jest.fn(() => Promise.resolve([])),
  getEventsAsync: jest.fn(() => Promise.resolve([])),
  // T-8.18 device executor (EventKit / CalendarContract / Apple Reminders).
  getRemindersPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'undetermined', canAskAgain: true, granted: false }),
  ),
  requestRemindersPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted', canAskAgain: true, granted: true }),
  ),
  createEventAsync: jest.fn(() => Promise.resolve('device-event-1')),
  createReminderAsync: jest.fn(() => Promise.resolve('device-reminder-1')),
  getRemindersAsync: jest.fn(() => Promise.resolve([])),
}));

jest.mock('expo-audio', () => {
  const player = {
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(() => Promise.resolve()),
    setPlaybackRate: jest.fn(),
    setActiveForLockScreen: jest.fn(),
    updateLockScreenMetadata: jest.fn(),
    remove: jest.fn(),
  };
  const status = {
    currentTime: 0,
    duration: 0,
    playing: false,
    isLoaded: true,
    didJustFinish: false,
  };
  // T-8.27 synthesized chapter files play as a playlist.
  const playlist = {
    play: jest.fn(),
    pause: jest.fn(),
    skipTo: jest.fn(),
    seekTo: jest.fn(() => Promise.resolve()),
    playbackRate: 1,
  };
  const playlistStatus = {
    currentIndex: 0,
    trackCount: 0,
    currentTime: 0,
    duration: 0,
    playing: false,
    isLoaded: true,
    didJustFinish: false,
  };
  return {
    __player: player,
    __status: status,
    __playlist: playlist,
    __playlistStatus: playlistStatus,
    useAudioPlaylist: jest.fn(() => playlist),
    useAudioPlaylistStatus: jest.fn(() => ({ ...playlistStatus })),
    setAudioModeAsync: jest.fn(() => Promise.resolve()),
    useAudioPlayer: jest.fn(() => player),
    useAudioPlayerStatus: jest.fn(() => ({ ...status })),
    // T-8.15 voice server-STT fallback recorder.
    RecordingPresets: { HIGH_QUALITY: {} },
    requestRecordingPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
    useAudioRecorder: jest.fn(() => ({
      prepareToRecordAsync: jest.fn(() => Promise.resolve()),
      record: jest.fn(),
      stop: jest.fn(() => Promise.resolve()),
      uri: 'file:///cache/voice.m4a',
    })),
  };
});

// Flow list (T-8.10): FlashList v2 needs native layout; tests render the same props through FlatList.
jest.mock('@shopify/flash-list', () => ({
  ...jest.requireActual<Record<string, unknown>>('@shopify/flash-list'),
  FlashList: jest.requireActual<{ FlatList: unknown }>('react-native').FlatList,
}));

// Meeting summary (T-8.14): device text-to-speech.
jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  stop: jest.fn(() => Promise.resolve()),
  pause: jest.fn(() => Promise.resolve()),
  resume: jest.fn(() => Promise.resolve()),
  isSpeakingAsync: jest.fn(() => Promise.resolve(false)),
  getAvailableVoicesAsync: jest.fn(() =>
    Promise.resolve([{ identifier: 'tr', name: 'Yelda', quality: 'Default', language: 'tr-TR' }]),
  ),
}));

// Meeting notes / post-meeting dictation (T-8.14): on-device speech recognition.
// Reply attachments (T-8.11): the system document picker.
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: null })),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  getInfoAsync: jest.fn(() => Promise.resolve({ exists: false })),
  makeDirectoryAsync: jest.fn(() => Promise.resolve()),
  downloadAsync: jest.fn((_url: string, target: string) =>
    Promise.resolve({ uri: target, status: 200 }),
  ),
  deleteAsync: jest.fn(() => Promise.resolve()),
  // T-8.15 transcribe upload, T-8.17 capture uploads and share staging.
  FileSystemUploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
  readAsStringAsync: jest.fn(() => Promise.resolve('aGVsbG8=')),
  copyAsync: jest.fn(() => Promise.resolve()),
  // T-8.27 synthesized-audio manifest and cache pruning.
  writeAsStringAsync: jest.fn(() => Promise.resolve()),
  readDirectoryAsync: jest.fn(() => Promise.resolve([])),
  uploadAsync: jest.fn(() =>
    Promise.resolve({ status: 200, body: '{}', headers: {}, mimeType: 'application/json' }),
  ),
  createUploadTask: jest.fn(
    (
      _url: string,
      _uri: string,
      _options: unknown,
      callback?: (p: { totalBytesSent: number; totalBytesExpectedToSend: number }) => void,
    ) => ({
      uploadAsync: jest.fn(() => {
        callback?.({ totalBytesSent: 5, totalBytesExpectedToSend: 5 });
        return Promise.resolve({ status: 200, body: '', headers: {}, mimeType: null });
      }),
    }),
  ),
}));

jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn(() => Promise.resolve('file:///cache/share.png')),
}));

// T-8.19…T-8.22: clipboard, store review and RevenueCat doubles (tests override per case).
jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('expo-store-review', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(false)),
  requestReview: jest.fn(() => Promise.resolve()),
  storeUrl: jest.fn(() => null),
  hasAction: jest.fn(() => Promise.resolve(false)),
}));

jest.mock('react-native-purchases', () => {
  const PURCHASES_ERROR_CODE = {
    PURCHASE_CANCELLED_ERROR: '1',
    STORE_PROBLEM_ERROR: '2',
    PURCHASE_NOT_ALLOWED_ERROR: '3',
    PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR: '5',
    PRODUCT_ALREADY_PURCHASED_ERROR: '6',
    NETWORK_ERROR: '10',
    PAYMENT_PENDING_ERROR: '20',
  };
  const Purchases = {
    configure: jest.fn(),
    logIn: jest.fn(() => Promise.resolve({ customerInfo: {}, created: false })),
    logOut: jest.fn(() => Promise.resolve({})),
    addCustomerInfoUpdateListener: jest.fn(),
    getOfferings: jest.fn(() => Promise.resolve({ current: null, all: {} })),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(() => Promise.resolve({ entitlements: { active: {}, all: {} } })),
    showManageSubscriptions: jest.fn(() => Promise.resolve()),
    checkTrialOrIntroductoryPriceEligibility: jest.fn(() => Promise.resolve({})),
    canMakePayments: jest.fn(() => Promise.resolve(true)),
  };
  return {
    __esModule: true,
    default: Purchases,
    PURCHASES_ERROR_CODE,
    INTRO_ELIGIBILITY_STATUS: {
      INTRO_ELIGIBILITY_STATUS_UNKNOWN: 0,
      INTRO_ELIGIBILITY_STATUS_INELIGIBLE: 1,
      INTRO_ELIGIBILITY_STATUS_ELIGIBLE: 2,
    },
  };
});
// ── T-8.15…T-8.18 native doubles ───────────────────────────────────────────────────────────

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: jest.fn(() => true),
    supportsOnDeviceRecognition: jest.fn(() => true),
    requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, status: 'granted' })),
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
  },
  useSpeechRecognitionEvent: jest.fn(),
}));

jest.mock('expo-share-intent', () => {
  const state = {
    hasShareIntent: false,
    shareIntent: { text: null, webUrl: null, files: null, type: null },
  };
  return {
    __state: state,
    useShareIntent: jest.fn(() => ({
      isReady: true,
      hasShareIntent: state.hasShareIntent,
      shareIntent: state.shareIntent,
      resetShareIntent: jest.fn(() => {
        state.hasShareIntent = false;
      }),
      error: null,
    })),
  };
});

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(() =>
    Promise.resolve({ granted: true, status: 'granted' }),
  ),
  launchCameraAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: null })),
  launchImageLibraryAsync: jest.fn(() => Promise.resolve({ canceled: true, assets: null })),
}));

// T-8.25 `da-widgets`: an in-memory App Group / SharedPreferences store (`__module.__store`).
// Not linked by default, so other suites see no widget calls; widget tests install it with
// `nativeWidgets.mockReturnValue(__module)`.
jest.mock('../../modules/da-widgets/src/native', () => {
  const store: { snapshot: string | null; scheme: string | null } = {
    snapshot: null,
    scheme: null,
  };
  const double = {
    __store: store,
    setSnapshot: jest.fn((json: string, scheme: string) => {
      store.snapshot = json;
      store.scheme = scheme;
      return Promise.resolve();
    }),
    getSnapshot: jest.fn(() => Promise.resolve(store.snapshot)),
    reload: jest.fn(() => Promise.resolve()),
    getInventory: jest.fn(() => Promise.resolve({ ios_families: 0, android_kinds: 0 })),
  };
  return { __module: double, nativeWidgets: jest.fn(() => null) };
});

// T-8.25 `da-background-refresh`: the OS background task (defined at import, registered on sign-in).
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('expo-background-task', () => ({
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  getStatusAsync: jest.fn(() => Promise.resolve(2)),
  registerTaskAsync: jest.fn(() => Promise.resolve()),
  unregisterTaskAsync: jest.fn(() => Promise.resolve()),
}));

// T-8.27 `da-tts`: not linked by default (the player falls back to expo-speech); tests install
// a double with `nativeTts.mockReturnValue(...)`.
jest.mock('../../modules/da-tts/src/native', () => ({ nativeTts: jest.fn(() => null) }));

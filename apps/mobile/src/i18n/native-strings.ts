/**
 * Native permission strings (INTEGRATION_PLAN §12.8, M§112). They live outside the ICU catalogs
 * because the OS shows them before any JavaScript runs: `app.config.ts` writes the Turkish set into
 * `Info.plist` (Turkish is the development region) and passes the English set through `locales`,
 * which prebuild turns into `en.lproj/InfoPlist.strings`. Android has no usage strings; its runtime
 * prompts are preceded by an in-app rationale sheet with the same wording.
 */

export type NativeLocale = 'tr' | 'en';

/** `Info.plist` usage-description keys the app declares; nothing else is requested (§12.8). */
export interface IosPermissionStrings {
  readonly NSCalendarsFullAccessUsageDescription: string;
  readonly NSCalendarsUsageDescription: string;
  readonly NSRemindersFullAccessUsageDescription: string;
  readonly NSRemindersUsageDescription: string;
  readonly NSMicrophoneUsageDescription: string;
  readonly NSSpeechRecognitionUsageDescription: string;
  readonly NSCameraUsageDescription: string;
  readonly NSPhotoLibraryUsageDescription: string;
  readonly NSFaceIDUsageDescription: string;
}

const CALENDAR_TR =
  'Takvimindeki etkinlikleri günlük brifinge, toplantı hazırlığına ve çakışma uyarılarına eklemek için. Etkinlik bilgilerin analiz için hesabına eşitlenir; değişiklikler yalnızca senin onayınla yapılır.';
const CALENDAR_EN =
  'To add your calendar events to your daily briefing, meeting prep and conflict alerts. Event details sync to your account for analysis; changes are made only with your approval.';
const REMINDERS_TR =
  "Apple Anımsatıcılar'daki görevlerini brifinge eklemek ve onayınla yeni anımsatıcı oluşturmak için.";
const REMINDERS_EN =
  'To include your Apple Reminders in your briefing and create reminders you approve.';

export const IOS_PERMISSION_STRINGS: Readonly<Record<NativeLocale, IosPermissionStrings>> = {
  tr: {
    NSCalendarsFullAccessUsageDescription: CALENDAR_TR,
    NSCalendarsUsageDescription: CALENDAR_TR,
    NSRemindersFullAccessUsageDescription: REMINDERS_TR,
    NSRemindersUsageDescription: REMINDERS_TR,
    NSMicrophoneUsageDescription: 'Asistana sesle soru sorabilmen ve toplantı notu alabilmen için.',
    NSSpeechRecognitionUsageDescription:
      'Söylediklerini yazıya çevirmek için. Mümkün olduğunda bu işlem cihazında yapılır.',
    NSCameraUsageDescription:
      "Fatura, bilet veya belgeyi fotoğraflayıp Dijital Asistan'a ekleyebilmen için.",
    NSPhotoLibraryUsageDescription:
      'Seçtiğin ekran görüntüsü ve fotoğrafları analiz için ekleyebilmen için. Yalnızca seçtiklerine erişilir.',
    NSFaceIDUsageDescription: 'Hesap silme gibi hassas işlemleri onaylaman için.',
  },
  en: {
    NSCalendarsFullAccessUsageDescription: CALENDAR_EN,
    NSCalendarsUsageDescription: CALENDAR_EN,
    NSRemindersFullAccessUsageDescription: REMINDERS_EN,
    NSRemindersUsageDescription: REMINDERS_EN,
    NSMicrophoneUsageDescription: 'So you can ask the assistant by voice and take meeting notes.',
    NSSpeechRecognitionUsageDescription:
      'To turn your speech into text, on your device whenever possible.',
    NSCameraUsageDescription:
      'To photograph a bill, ticket or document and add it to Dijital Asistan.',
    NSPhotoLibraryUsageDescription:
      'To add screenshots and photos you choose for analysis. Only the items you pick are accessed.',
    NSFaceIDUsageDescription: 'To confirm sensitive actions such as deleting your account.',
  },
};

/**
 * `Info.plist` usage keys the app must never carry (§12.8 "Not requested at all"): location (travel
 * time comes only from the source), contacts (SREQ-37), ATT tracking, and photo-library writes.
 * `scripts/mobile/prebuild-smoke.sh` asserts the prebuilt `Info.plist` has none of them.
 */
export const IOS_NEVER_REQUESTED_KEYS = [
  'NSLocationWhenInUseUsageDescription',
  'NSLocationAlwaysAndWhenInUseUsageDescription',
  'NSLocationAlwaysUsageDescription',
  'NSContactsUsageDescription',
  'NSUserTrackingUsageDescription',
  'NSPhotoLibraryAddUsageDescription',
] as const;

/** The Android runtime permissions preceded by an in-app rationale sheet (§12.8). */
export type AndroidRationalePermission =
  | 'READ_CALENDAR'
  | 'WRITE_CALENDAR'
  | 'RECORD_AUDIO'
  | 'CAMERA'
  | 'POST_NOTIFICATIONS'
  | 'SCHEDULE_EXACT_ALARM';

/**
 * Android has no usage strings in the manifest; the rationale shown before each runtime prompt uses
 * the §12.8 wording (the calendar, microphone and camera rows reuse the iOS text).
 */
export const ANDROID_PERMISSION_RATIONALES: Readonly<
  Record<NativeLocale, Readonly<Record<AndroidRationalePermission, string>>>
> = {
  tr: {
    READ_CALENDAR: CALENDAR_TR,
    WRITE_CALENDAR: 'Onayladığın etkinliği cihaz takvimine yazabilmem için yazma izni gerekiyor.',
    RECORD_AUDIO: IOS_PERMISSION_STRINGS.tr.NSMicrophoneUsageDescription,
    CAMERA: IOS_PERMISSION_STRINGS.tr.NSCameraUsageDescription,
    POST_NOTIFICATIONS:
      'Sadece önemli olduğunda haber veririz. Günde birkaç bildirimle sınırlı tutarız. Pazarlama bildirimi yok.',
    SCHEDULE_EXACT_ALARM:
      "Hatırlatıcıların tam zamanında gelmesi için 'Alarm ve hatırlatıcılar' iznine ihtiyaç var.",
  },
  en: {
    READ_CALENDAR: CALENDAR_EN,
    WRITE_CALENDAR: 'Write access lets me add events you approve to your device calendar.',
    RECORD_AUDIO: IOS_PERMISSION_STRINGS.en.NSMicrophoneUsageDescription,
    CAMERA: IOS_PERMISSION_STRINGS.en.NSCameraUsageDescription,
    POST_NOTIFICATIONS:
      'We only notify you when it matters. We keep it to a few a day. No marketing notifications.',
    SCHEDULE_EXACT_ALARM:
      "Exact timing for your reminders needs the 'Alarms & reminders' permission.",
  },
};

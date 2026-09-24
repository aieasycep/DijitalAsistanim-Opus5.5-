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

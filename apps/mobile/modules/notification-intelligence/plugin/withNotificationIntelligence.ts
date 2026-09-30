/**
 * `notification-intelligence` config plugin (T-8.26, ADR-12). Adds to the app's AndroidManifest:
 * - the `DaNotificationListenerService`, protected by `BIND_NOTIFICATION_LISTENER_SERVICE` (only
 *   the system can bind it, after the user grants notification access in the system settings),
 *   with `default_filter_types = conversations|alerting` (SCREEN_AND_FLOW_MAP §9);
 * - a `<queries>` entry for launcher activities, so the app picker can list installed apps
 *   without `QUERY_ALL_PACKAGES` (which stays in the blocked permission list).
 * iOS gets nothing: the feature does not exist there.
 */
import type * as ConfigPlugins from 'expo/config-plugins';
import type { ConfigPlugin } from 'expo/config-plugins';

/** Passed in by `app.config.ts` (see `withDaShare.ts` for why the helpers are injected). */
export type NotificationIntelligenceMods = Pick<typeof ConfigPlugins, 'withAndroidManifest'>;

export const NI_SERVICE = 'expo.modules.notificationintelligence.DaNotificationListenerService';
export const NI_BIND_PERMISSION = 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE';
const LISTENER_ACTION = 'android.service.notification.NotificationListenerService';
const FILTER_TYPES = 'android.service.notification.default_filter_types';

type Manifest = ConfigPlugins.AndroidConfig.Manifest.AndroidManifest;
type Application = NonNullable<Manifest['manifest']['application']>[number];
type ServiceEntry = NonNullable<Application['service']>[number];
/** The typings omit `android:label` and `<meta-data>` on services; the manifest accepts both. */
type Service = Omit<ServiceEntry, '$'> & {
  $: ServiceEntry['$'] & { 'android:label': string };
  'meta-data': { $: { 'android:name': string; 'android:value': string } }[];
};
type Query = Manifest['manifest']['queries'][number];

function listenerService(): Service {
  return {
    $: {
      'android:name': NI_SERVICE,
      'android:label': '@string/app_name',
      'android:exported': 'true',
      'android:permission': NI_BIND_PERMISSION,
    },
    'intent-filter': [{ action: [{ $: { 'android:name': LISTENER_ACTION } }] }],
    'meta-data': [
      { $: { 'android:name': FILTER_TYPES, 'android:value': 'conversations|alerting' } },
    ],
  };
}

function launcherQuery(): Query {
  return {
    intent: [
      {
        action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
        category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }],
      },
    ],
  };
}

function hasLauncherQuery(queries: readonly Query[]): boolean {
  return queries.some((query) =>
    (query.intent ?? []).some(
      (intent) =>
        (intent.action ?? []).some((a) => a.$['android:name'] === 'android.intent.action.MAIN') &&
        (intent.category ?? []).some(
          (c) => c.$['android:name'] === 'android.intent.category.LAUNCHER',
        ),
    ),
  );
}

/** Applies the listener service and the launcher query to a parsed manifest (idempotent). */
export function applyNotificationIntelligence(manifest: Manifest): Manifest {
  const app = manifest.manifest.application?.[0];
  if (app === undefined) throw new Error('[notification-intelligence] no <application> element');
  const services = (app.service ?? []).filter((s) => s.$['android:name'] !== NI_SERVICE);
  app.service = [...services, listenerService()];
  // Typed as required, but a parsed manifest without <queries> has none.
  const queries = (manifest.manifest.queries as Query[] | undefined) ?? [];
  manifest.manifest.queries = hasLauncherQuery(queries) ? queries : [...queries, launcherQuery()];
  return manifest;
}

export function createWithNotificationIntelligence(
  mods: NotificationIntelligenceMods,
): ConfigPlugin {
  return (config) =>
    mods.withAndroidManifest(config, (mod) => {
      mod.modResults = applyNotificationIntelligence(mod.modResults);
      return mod;
    });
}

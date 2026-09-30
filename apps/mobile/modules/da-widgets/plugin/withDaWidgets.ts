/**
 * `da-widgets` config plugin (T-8.25, SCREEN_AND_FLOW_MAP §11.1, INTEGRATION_PLAN §12.2/§12.3).
 * `@bacons/apple-targets` generates the WidgetKit extension from `targets/widget`; this plugin
 * wires the rest:
 * - iOS: `DAAppGroup` in the app's Info.plist, so the `DaWidgets` module and the extension (which
 *   reads its containing app's Info.plist) share one App Group per variant;
 * - Android: the two Glance receivers in the app manifest (the widget picker only lists receivers
 *   the merged manifest declares), each with its `appwidget-provider` metadata. They are not
 *   exported: only the system's `APPWIDGET_UPDATE` broadcast reaches them.
 */
import type * as ConfigPlugins from 'expo/config-plugins';
import type { ConfigPlugin } from 'expo/config-plugins';

/** The config-plugin helpers, passed in by `app.config.ts` (see `withDaShare`). */
export type DaWidgetsMods = Pick<
  typeof ConfigPlugins,
  'AndroidConfig' | 'withAndroidManifest' | 'withInfoPlist'
>;

export interface DaWidgetsOptions {
  /** The variant's App Group (`group.<bundleId>` + suffix). */
  readonly appGroup: string;
}

export const APP_GROUP_PLIST_KEY = 'DAAppGroup';
const PACKAGE = 'expo.modules.dawidgets';

/** The Glance receivers (M-WGT-07 2×2, M-WGT-08 4×2). */
export const WIDGET_RECEIVERS = [
  {
    name: `${PACKAGE}.DaNextWidgetReceiver`,
    label: '@string/da_widget_next_name',
    provider: '@xml/da_next_widget_info',
  },
  {
    name: `${PACKAGE}.DaTodayWidgetReceiver`,
    label: '@string/da_widget_today_name',
    provider: '@xml/da_today_widget_info',
  },
] as const;

interface ManifestReceiver {
  $: Record<string, string>;
  'intent-filter'?: { action?: { $: Record<string, string> }[] }[];
  'meta-data'?: { $: Record<string, string> }[];
}

export function createWithDaWidgets(mods: DaWidgetsMods): ConfigPlugin<DaWidgetsOptions> {
  const { AndroidConfig, withAndroidManifest, withInfoPlist } = mods;
  return (config, options) => {
    if (!/^group\.[A-Za-z0-9.-]+$/.test(options.appGroup)) {
      throw new Error(`[da-widgets] invalid App Group: ${options.appGroup}`);
    }
    let next = withInfoPlist(config, (mod) => {
      mod.modResults[APP_GROUP_PLIST_KEY] = options.appGroup;
      return mod;
    });
    next = withAndroidManifest(next, (mod) => {
      const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
      const existing = (application.receiver ?? []) as ManifestReceiver[];
      const ours = new Set<string>(WIDGET_RECEIVERS.map((r) => r.name));
      const receivers: ManifestReceiver[] = WIDGET_RECEIVERS.map((receiver) => ({
        $: {
          'android:name': receiver.name,
          'android:exported': 'false',
          'android:label': receiver.label,
        },
        'intent-filter': [
          { action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.appwidget.provider',
              'android:resource': receiver.provider,
            },
          },
        ],
      }));
      application.receiver = [
        ...existing.filter((r) => !ours.has(r.$['android:name'] ?? '')),
        ...receivers,
      ] as typeof application.receiver;
      return mod;
    });
    return next;
  };
}

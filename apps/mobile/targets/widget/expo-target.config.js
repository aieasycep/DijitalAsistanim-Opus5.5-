/**
 * WidgetKit extension (T-8.25; SCREEN_AND_FLOW_MAP §11, INTEGRATION_PLAN §12.2): `DATodayWidget`
 * (kind `da.today`: small, medium, large) and `DALockWidget` (kind `da.lock`: the lock-screen
 * accessories). The extension has no network access and no tokens; it renders the privacy-filtered
 * `WidgetSnapshotV1` the app writes to the shared App Group (`da.widget.snapshot.v1`). The App Group
 * is the app's own (mirrored from `ios.entitlements`), so every variant reads its own container.
 */
const tokens = require('@da/design-tokens/native.json').colors;

const APP_GROUPS = 'com.apple.security.application-groups';

/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  displayName: 'Dijital Asistan',
  deploymentTarget: '16.4',
  frameworks: ['SwiftUI', 'WidgetKit'],
  colors: {
    $accent: tokens['brand.primary'],
    $widgetBackground: tokens.surface,
  },
  entitlements: {
    [APP_GROUPS]:
      (config.ios && config.ios.entitlements && config.ios.entitlements[APP_GROUPS]) || [],
  },
});

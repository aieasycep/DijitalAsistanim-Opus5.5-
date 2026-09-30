// @ts-check
/**
 * Demo-only routes (R-21, SCREEN_AND_FLOW_MAP §0.8): `app/demo/**` is compiled only into builds
 * with `EXPO_PUBLIC_DEMO_MODE=true`. Metro's `blockList` removes the files from the file map, so
 * Expo Router's `require.context` never sees them and the route does not exist in other bundles.
 */
const path = require('node:path');

const escape = (/** @type {string} */ value) => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Same truthy values as the env schema's `BoolFlag`. */
function isDemoMode(/** @type {Record<string, string | undefined>} */ env) {
  const value = (env.EXPO_PUBLIC_DEMO_MODE ?? '').trim();
  return value === 'true' || value === '1';
}

/** The blockList entries for the demo routes (none in demo builds). */
function demoRouteBlockList(
  /** @type {Record<string, string | undefined>} */ env,
  /** @type {string} */ projectRoot,
) {
  if (isDemoMode(env)) return [];
  return [new RegExp(`^${escape(path.join(projectRoot, 'app', 'demo'))}(/.*)?$`)];
}

module.exports = { demoRouteBlockList, isDemoMode };

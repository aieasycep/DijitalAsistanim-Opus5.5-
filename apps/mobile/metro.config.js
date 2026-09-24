// @ts-check
/**
 * Metro for the pnpm monorepo (ADR-01, isolated linker).
 * - `watchFolders` is the repository root, so workspace packages (`@da/*`, symlinked to
 *   `packages/*`) and the virtual store (`node_modules/.pnpm`) are inside the file map; Metro
 *   0.84 follows pnpm's symlinks natively.
 * - `nodeModulesPaths` lets any file (including the realpath of a workspace package) resolve the
 *   app's direct dependencies first and the root store second; hierarchical lookup stays on,
 *   because pnpm puts each package's own dependencies next to it inside `.pnpm`.
 * - Package `exports` are honoured, which the `@da/*` subpath exports need.
 * - Agent worktrees, other apps' build output and native projects never enter the file map.
 * - `getSentryExpoConfig` (T-8.28) is Expo's default config plus Sentry's serializer, which writes
 *   debug ids into the bundle and its source maps; the maps are uploaded by CI only (ADR-39).
 */
const path = require('node:path');
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const { demoRouteBlockList } = require('./demo-routes');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const escape = (/** @type {string} */ value) => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const under = (/** @type {string} */ ...segments) =>
  new RegExp(`^${escape(path.join(workspaceRoot, ...segments))}(/.*)?$`);

const config = getSentryExpoConfig(projectRoot);
const defaultBlockList = config.resolver.blockList ?? [];

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.join(projectRoot, 'node_modules'),
  path.join(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enablePackageExports = true;
config.resolver.blockList = [
  ...(Array.isArray(defaultBlockList) ? defaultBlockList : [defaultBlockList]),
  under('.claude'),
  under('.git'),
  under('.turbo'),
  under('apps', 'mobile', 'ios'),
  under('apps', 'mobile', 'android'),
  under('apps', 'mobile', '.expo-export'),
  /\/\.next\/.*/,
  // `app/demo/**` exists only in demo builds (EXPO_PUBLIC_DEMO_MODE=true).
  ...demoRouteBlockList(process.env, projectRoot),
];

module.exports = config;

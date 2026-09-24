## Recommended version matrix

Every version below was checked with `npm view` or by streaming the published tarball on 2026-09-23. Where Expo SDK 57 pins a version, that pin wins over npm `latest`. The pins come from `expo@57.0.24/bundledNativeModules.json` and the `expo-template-default@57.0.26` manifest.

### A. Toolchain / repo root
| Package | Version | Workspace | Reason |
|---|---|---|---|
| Node.js | **24.21.0 LTS** in CI, EAS and Vercel (`.nvmrc` = `24`); `engines.node: ">=22.13.0"` | root | RN 0.86.3 engines: `^20.19.4 \|\| ^22.13.0 \|\| ^24.3.0 \|\| >=25`. pnpm 11 needs ≥22.13. vitest 4 accepts ^20/^22/≥24. supabase-js 2.117.1 needs `>=22.0.0` and dropped Node 20 in 2.110.0 (Node 20 went EOL on 2026-04-30). next@16.3.6 needs `>=20.9.0`. The container's 22.22.2 meets every one of these. |
| pnpm | **11.27.1** (`"packageManager": "pnpm@11.27.1"`) | root | pnpm 11 is still maintained (11.27.1 shipped 2026-09-20). pnpm 12 is a Rust rewrite, stable only since 2026-08-26, and has had 6 minors in 4 weeks (12.6.0 came out 09-22). Neither Turbo lockfile parsing nor EAS has been checked against 12. The config model is identical, so 12.x can be dropped in after a verification spike. |
| turbo | **2.11.3** (fallback 2.11.2) | root | Latest. It is less than 24 h old, which matters because of `minimumReleaseAge` (see Risks). |
| typescript | **~6.0.3** everywhere | catalog default | See Compatibility §2. It is the same pin the Expo SDK 57 template uses. |
| eslint | **9.39.5** (`maintenance` tag) | root / packages/config | See §7. Version 10 is blocked by eslint-config-next and eslint-plugin-react. |
| @eslint/js | 9.39.5 | packages/config | Matches the ESLint major. |
| typescript-eslint | **8.70.1** | packages/config | Peer is `typescript >=4.8.4 <6.1.0` and `eslint ^8.57\|\|^9\|\|^10`. |
| eslint-config-expo | ~57.0.2 (import `eslint-config-expo/flat`) | apps/mobile | Official flat config. |
| eslint-config-next | 16.3.6 (flat) | apps/web, apps/backoffice | `next lint` is removed in Next 16, so the ESLint CLI is called directly. |
| eslint-plugin-react-hooks | 7.1.1 | packages/config | Includes the React Compiler rules. |
| globals | 17.12.0 | packages/config | — |
| prettier | **3.9.9** | root | Stable formatter. oxfmt 0.70.0 is still pre-1.0, and the Figma prototype's `oxfmt ^0.2.0` must not be copied. |
| prettier-plugin-tailwindcss | 0.8.1 | apps/web, apps/backoffice | — |
| vitest | **4.1.11** plus `@vitest/coverage-v8` 4.1.11 | packages/*, web, backoffice, api-client | 5.0.x came out on 2026-09-03 and is only 3 weeks old. 4.1.11 is the mature line. Its peers are `vite ^6\|\|^7\|\|^8` and `@types/node ^20\|\|^22\|\|>=24`. |
| vite | 8.3.0 | dev (vitest peer) | — |
| jsdom / happy-dom | 30.1.1 / 20.14.5 | web/backoffice component tests | Pick one; happy-dom is faster. |
| @playwright/test | **1.63.0** | apps/web, apps/backoffice | Bundles Chromium CfT 153.0.8010.12 (revision 1243); the container workaround is in Container facts. |
| @types/node | 24.13.6 | root | Matches Node 24. |
| supabase (CLI) | **2.117.0** | root devDependency | Now a Node shim that loads `@supabase/cli-linux-x64` and similar platform packages as optionalDependencies. They come from registry.npmjs.org, so no GitHub download is needed. |
| deno | **2.1.4** (npm package; binary from `@deno/linux-x64-glibc`) | supabase/ tooling | Matches the Supabase edge-runtime `deno` crate `version = "2.1.4"`. dl.deno.land is blocked. |
| squawk-cli | 2.65.0 (optional) | supabase/ | Migration linter that works without Docker. |
| @supabase/postgres-meta | **0.99.0** (dev) | supabase/ | Same pg-meta version as the CLI image. Used for the Docker-free `PG_META_GENERATE_TYPES=typescript` fallback. |
| @electric-sql/pglite + `-pgvector` + `-pgtap` | 0.5.8 / 0.0.9 / 0.0.9 | supabase/tests (optional tier D) | In-process Postgres (WASM, v17 family) with pgvector and pgTAP. |

### B. Shared runtime (default pnpm catalog)
| Package | Version | Used by | Reason |
|---|---|---|---|
| react / react-dom | **19.2.3 exactly**, one version for the whole workspace | mobile (react only), web, backoffice, packages/ui | RN 0.86.3's Fabric renderer is built against `reconcilerVersion: "19.2.3"`, and Expo pins it. Next 16.3.6 peers `^19.0.0`, and App Router runs its own vendored React. Keeping one version avoids duplicate-React bugs through shared peers. |
| @types/react / @types/react-dom | ~19.2.18 / ~19.2.7 | all TSX workspaces | Expo template uses `~19.2.2`. Do **not** move to 19.3.x types, which belong to SDK 58. |
| zod | **4.6.5** | domain, validation, api-client, web, backoffice, Deno (`npm:zod@4.6.5`) | `@hookform/resolvers` and `@anthropic-ai/sdk` both peer `zod ^3.25\|\|^4`. |
| date-fns / @date-fns/tz | 4.4.0 / 1.5.0 | domain | Europe/Istanbul, 24-hour clock (master prompt §39). |
| @supabase/supabase-js | **2.117.1** (published 2026-09-23 09:35Z) | api-client, mobile, web, backoffice | Expo already ships a URL polyfill (`whatwg-url-minimum` is an expo dependency), so no `react-native-url-polyfill` is needed. |
| @tanstack/react-query | 5.103.2 | mobile, backoffice, api-client (peer) | Peer `react ^18\|\|^19`. |
| zustand | 5.0.15 | mobile, backoffice | — |
| react-hook-form / @hookform/resolvers | 7.88.0 / 5.9.1 | mobile, backoffice, web forms | — |
| next-intl / use-intl | **4.14.6 / 4.14.6** | web and backoffice (next-intl); mobile (use-intl) | One ICU message format and one `useTranslations` API for the tr default and en catalogs in packages/i18n (see §8). |

### C. apps/mobile (named catalog `expo`; pins exactly as `bundledNativeModules`)
| Package | Version | Note |
|---|---|---|
| expo | ~57.0.24 | `sdk-57` = `latest`. SDK 58 is in `next` (58.0.0-preview.5). |
| react-native | **0.86.3** | **Not** 0.87.1: SDK 57 is built on 0.86. |
| expo-router | ~57.0.22 | Peers: `react-native-screens ^4.26.0`, `safe-area-context >=5.4.0`. `react-server-dom-webpack` is an optional peer and is not installed (see Risks). |
| react-native-reanimated / react-native-worklets | **4.5.1 / 0.10.1** | **Not** 4.7.0, which needs worklets 0.13.x. 4.5.1 peers `react-native 0.83 - 0.86`. |
| react-native-gesture-handler | **~2.32.0** | **Not** 3.3.0. v3 has a new API and arrives with SDK 58 (~3.2.1). |
| react-native-screens / react-native-safe-area-context | ~4.26.0 / ~5.7.0 | **Not** 5.10.0. |
| react-native-svg | 15.15.4 | Needed for the icon pipeline (§8). |
| react-native-keyboard-controller | 1.21.9 | — |
| @shopify/flash-list | 2.0.2 (Expo pin; 2.3.2 is JS-only and bumpable via `expo.install.exclude`) | — |
| @react-native-community/netinfo | 12.0.1 | Wired to TanStack `onlineManager`. |
| expo-notifications, calendar, secure-store, audio, speech | ~57.0.20, ~57.0.4, ~57.0.4, ~57.0.5, ~57.0.3 | Master prompt §6. |
| expo-image-picker, document-picker, file-system, sharing | ~57.0.19, ~57.0.2, ~57.0.7, ~57.0.21 | — |
| expo-dev-client, expo-updates | ~57.0.19, ~57.0.23 | runtimeVersion policy `fingerprint` (@expo/fingerprint 0.20.13). |
| expo-background-task, expo-task-manager | ~57.0.19, ~57.0.19 | — |
| expo-apple-authentication, web-browser, linking | ~57.0.2, ~57.0.3, ~57.0.10 | `expo-auth-session` is not needed (see §8). |
| expo-localization, crypto, local-authentication, haptics, image, font | ~57.0.2, ~57.0.3, ~57.0.3, ~57.0.3, ~57.0.5, ~57.0.4 | — |
| expo-splash-screen, system-ui, status-bar, constants, device, application, build-properties | ~57.0.9, ~57.0.4, ~57.0.1, ~57.0.19, ~57.0.2, ~57.0.3, ~57.0.21 | — |
| react-native-mmkv + react-native-nitro-modules | **4.3.2 + 0.37.1** | v4 supports `encryptionType: 'AES-256'` with a 32-byte key. |
| react-native-purchases | **10.10.1** | Peer `react-native >=0.73`. **Omit `react-native-purchases-ui`** (see §8). |
| @sentry/react-native | **8.27.0**, added to `expo.install.exclude` | Expo's table still says ~7.11.0, but Sentry closed "Support Expo SDK 57" (getsentry#6384). v8 brings Cocoa v9, CLI v3 and AGP plugin v6. |
| @react-native-google-signin/google-signin | 16.1.5 | Peer `expo >=52.0.40`. Free "Original" API, giving an idToken for `supabase.auth.signInWithIdToken`. |
| expo-share-intent | **8.0.1** | Its compatibility table says "SDK 57 → 8.0+". Peers `expo ^57`. |
| @bacons/apple-targets | **5.0.0** | iOS widget extension target. Peer `expo >=52`; needs CocoaPods 1.16.2 and Xcode 16+. |
| expo-speech-recognition | 57.1.0 | On-device STT, tr-TR. |
| @expo-google-fonts/geist, @expo-google-fonts/lora | 0.4.2, 0.4.2 | Static TTFs: Geist 100–900 with italics, Lora 400–700 with italics. |
| @material-symbols/svg-400 (+ svg-300/500/600 if needed) | 0.47.5 (dev, codegen input) | Rounded plus `-fill.svg` variants (see §8). |
| @tanstack/react-query-persist-client + @tanstack/query-async-storage-persister | 5.103.2 | `query-sync-storage-persister` is `@deprecated`. |
| jest-expo / jest | ~57.0.5 / **29.7.0** | jest-expo 57 pulls in `babel-jest ^29` and `react-test-renderer 19.2.3`. |
| @testing-library/react-native + test-renderer | 14.0.1 + 1.3.0 | RNTL 14 peers `test-renderer ^1.0.0`, `react >=19`, `react-native >=0.78`. |
| @react-native/jest-preset | 0.86.3 | Peer of jest-expo and react-native. |
| eas-cli | 24.7.0 (via `npx`; `eas.json` `cli.version ">= 24.7.0"`) | engines `^20.18.3 \|\| >=22`. |
| **Not installed** | react-native-web, react-dom (mobile ships iOS/Android only), react-server-dom-webpack, NativeWind, Unistyles, Tamagui, expo-widgets, react-native-purchases-ui, @react-native-async-storage for secrets, Detox, expo-auth-session | See the compatibility findings. |

### D. apps/web (marketing)
| Package | Version | Note |
|---|---|---|
| next | **16.3.6** | Turbopack is the default; `proxy.ts` replaces middleware; `reactCompiler: true`; `cacheComponents: true` suits a static-heavy site. |
| babel-plugin-react-compiler | 1.0.0 | — |
| tailwindcss / @tailwindcss/postcss | 4.3.3 / 4.3.3 | `@theme` CSS variables are generated from packages/design-tokens. |
| next-intl | 4.14.6 | tr default, en. |
| @sentry/nextjs | 10.75.2 | Peer `next ^16.0.0-0`. |
| @supabase/ssr | 0.12.7 | Only if the web app needs authenticated pages such as referral landing or account deletion. Peer `supabase-js ^2.114.0`. |
| clsx / tailwind-merge / class-variance-authority | 2.1.1 / 3.7.0 / 0.7.1 | — |
| @t3-oss/env-nextjs | 0.13.11 | Env schema that keeps server secrets out of client bundles (master prompt §107). |
| server-only | 0.0.1 | — |
| Fonts | `next/font/google` for Geist and Lora | fonts.googleapis.com is reachable from the container. |

### E. apps/backoffice
Everything from D, plus:

| Package | Version | Note |
|---|---|---|
| shadcn (CLI, run with `pnpm dlx shadcn@4.21.0`; not a runtime dependency) | 4.21.0 | Supports Tailwind v4 and React 19. The shadcn Data Table docs moved to TanStack Table v9 in Aug 2026. |
| radix-ui | 1.6.7 | Peer react ^19. |
| @tanstack/react-table | **9.2.4** | v9 stable since 2026-08-04. v8 code does not run on v9: the API is `useTable({features})`; `useLegacyTable` is a temporary shim. |
| @tanstack/react-virtual | 3.14.13 | — |
| recharts | 3.10.1 | — |
| cmdk / sonner / next-themes / nuqs / react-day-picker / tw-animate-css | 1.1.1 / 2.0.8 / 0.4.6 / 2.10.1 / 10.0.1 / 1.4.0 | Command palette (§69), toasts, dark mode (§72), URL table state. |
| @supabase/ssr | 0.12.7 | Separate cookie name and domain (`admin.` subdomain); AAL2/MFA checked server-side. |

### F. packages/*
| Package | Dependencies | Rule |
|---|---|---|
| design-tokens | none (build script emits `tokens.ts` + `tokens.css`) | Single source for RN StyleSheet and the Tailwind `@theme`. |
| domain | zod, date-fns, @date-fns/tz | Pure ESM TypeScript with no Node, RN or DOM APIs. Relative imports use **explicit `.ts` extensions** (`allowImportingTsExtensions`, `noEmit`) so Deno can import it through an import map. |
| validation | zod | Same Deno-safe rule. |
| api-client | @supabase/supabase-js; peer @tanstack/react-query | Generated `database.types.ts`. |
| i18n | ICU JSON catalogs (tr, en) plus a typed `AppConfig` augmentation | No React dependency. |
| ui | peers: react 19.2.3, react-native 0.86.3, react-native-svg, reanimated | **RN only**. Web has no shared React UI package, which avoids dual-React peer resolution under isolated pnpm. |
| config | tsconfig bases (`expo/tsconfig.base` is already `moduleResolution: bundler`, `module: preserve`), ESLint flat configs, Prettier config | — |

### G. supabase/functions (Deno 2.1-compatible; one `deno.json` per function)
`npm:@supabase/supabase-js@2.117.1` (or `jsr:@supabase/supabase-js@2.117.1`) · `jsr:@hono/hono@4.13.8` (or `npm:hono@4.13.8`) with `basePath('/<fn>')` · `npm:zod@4.6.5` · `npm:@anthropic-ai/sdk@0.128.0` (peer zod ^3.25\|\|^4; `client.messages.parse` + `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`) · `npm:openai@7.23.0` (second adapter, §81) · `npm:jose@6.2.12` · `jsr:@std/assert@1.0.19` · `jsr:@std/testing@1.0.20`.

Default model IDs belong in the DB-backed model config (§57), not in code. Seed them with `claude-opus-5` for high-quality summaries and briefings and `claude-haiku-4-5` for cheap classification. Prompt caching and structured outputs go through `output_config.format`; the older `output_format` parameter is deprecated.

### H. Native (not npm)
| Item | Value | Source |
|---|---|---|
| iOS deployment target | **16.4** | Expo bare template Podfile and `ExpoModulesCore.podspec` platforms `:ios => '16.4'`. |
| Swift | 6.0 | `ExpoModulesCore` `swift_version`. |
| Android compileSdk / targetSdk / minSdk | 36 / 36 / 24 | RN 0.86.3 `gradle/libs.versions.toml`. |
| AGP / Kotlin / NDK / build-tools | 8.12.0 / 2.1.20 / 27.1.12297006 / 36.0.0 | Same file. |
| Hermes | V1 on by default (`expo.useHermesV1`), New Architecture on (`newArchEnabled=true`), `edgeToEdgeEnabled=true` | Expo bare template `gradle.properties` and Podfile. |
| androidx.glance:glance-appwidget | 1.1.1 stable (recalled, not confirmed); expo-widgets 57 uses `1.2.0-rc01` | Needs checking at implementation; Google Maven is unreachable from the container. |
| Postgres (hosted and CLI) | 17 (`major_version = 17`, image `supabase/postgres:17.6.1.167`) | Supabase CLI `config.toml` template and Dockerfile. |
| Maestro CLI | **2.10.0** | maestro `gradle.properties` `VERSION_NAME=2.10.0`; needs Java 17+. |

### pnpm-workspace.yaml (the load-bearing parts)
```yaml
packages: ['apps/*', 'packages/*']
# nodeLinker: isolated (pnpm default; supported since Expo SDK 54). Fallback: hoisted
catalog:
  react: 19.2.3
  react-dom: 19.2.3
  typescript: ~6.0.3
  zod: 4.6.5
  '@supabase/supabase-js': 2.117.1
  '@tanstack/react-query': 5.103.2
catalogs:
  expo:
    expo: ~57.0.24
    react-native: 0.86.3
    react-native-reanimated: 4.5.1
    react-native-worklets: 0.10.1
    react-native-gesture-handler: ~2.32.0
    # ... (all bundledNativeModules pins)
overrides:
  react: 19.2.3
  react-dom: 19.2.3
  react-native: 0.86.3
allowBuilds:        # pnpm ≥11: strictDepBuilds=true by default
  esbuild: true
  unrs-resolver: true
  deno: true
  '@sentry/cli': true
  core-js: false
  msw: false
minimumReleaseAge: 1440   # pnpm 11 default; see Risks
```

---

## Compatibility findings

### 1. React / React Native / React DOM
- **Expo SDK 57 pins** `react 19.2.3`, `react-dom 19.2.3`, `react-native 0.86.3`, `react-native-web ~0.21.0` and `react-server-dom-webpack ~19.2.4`. Source: bundledNativeModules in the expo@57.0.24 tarball.
- The Expo changelog confirms "SDK 57 is React Native 0.86, with React unchanged at 19.2". SDK 57.0.0 shipped on 2026-06-30. <https://expo.dev/changelog/sdk-57>, <https://x.com/expo/status/2072074192951136678>
- RN 0.86.3 `ReactFabric-dev.js` hard-codes `reconcilerVersion: "19.2.3"`. The RN 0.86.3 peer is `react ^19.2.3`. Expo's monorepo guide adds: "Duplicate React Native versions in a single monorepo are not supported. Duplicate React versions in a single app will cause runtime errors." <https://raw.githubusercontent.com/expo/expo/sdk-57/docs/pages/guides/monorepos.mdx>
- **Next 16.3.6** peers `react ^18.2.0 || 19.0.0-rc-de68d2f4-20241204 || ^19.0.0`, so 19.2.3 fits. App Router uses Next's built-in React canary, so the installed `react` mostly affects types and third-party peers.
- **Policy:** one React version (19.2.3) across the workspace via the default catalog, with `overrides` for react, react-dom and react-native. Do not use 19.3.0: it ships with SDK 58 (template `react 19.3.0`, RN `0.88.0-rc.1`, `@types/react ~19.3.0`, RNGH ~3.2.1).
- **Security note:** CVE-2026-23864 (fixed in 19.2.4) and CVE-2026-23870 (fixed in 19.2.6) affect **`react-server-dom-*`**, not `react` or `react-dom`. Mobile stays safe by not installing `react-server-dom-webpack` (it is an optional peer in both expo-router and jest-expo). Web and backoffice are covered by Next's vendored copy, so keep Next on the newest 16.3.x patch. <https://github.com/react/react/security/advisories/GHSA-83fc-fqcc-2hmg>, <https://advisories.gitlab.com/npm/react-server-dom-parcel/CVE-2026-23870/>, <https://vercel.com/changelog/next-js-may-2026-security-release>

### 2. TypeScript: pin 6.0.3; do not use 7.0.2 as `typescript`
- The `typescript@7.0.2` tarball exposes `exports["."] = "./lib/version.cjs"` (just `version` and `versionMajorMinor`) plus `./unstable/{sync,async,ast,…}` and a Go binary through `@typescript/typescript-<platform>` optional deps. **There is no `ts.createProgram` JavaScript API.**
- The TS 7 announcement says the programmatic API is expected in 7.1. It recommends `@typescript/typescript6` (latest 6.0.2, bin `tsc6`) for side-by-side use: `"typescript": "npm:@typescript/typescript6@^6.0.2", "@typescript/native": "npm:typescript@^7.0.2"`. <https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/>, <https://www.infoq.com/news/2026/08/typescript-7-released/>, <https://nx.dev/docs/kb/typescript-7>
- typescript-eslint 8.70.1 peers `typescript ">=4.8.4 <6.1.0"`, so **TS 7 breaks linting** and the ceiling is 6.0.x.
- Expo SDK 57 template devDependencies are `typescript ~6.0.3` and `@types/react ~19.2.2`. SDK 58 preview stays on `~6.0.3`.
- Next 16.3.6 type-checks with the project's own `tsc` CLI by default (`experimental.useTypeScriptCli: true`) and documents a "Using TypeScript 7" path. It is not blocked, but gains nothing because linting is. <https://raw.githubusercontent.com/vercel/next.js/v16.3.6/docs/01-app/03-api-reference/05-config/02-typescript.mdx>
- Metro and Babel strip types and never use `tsc`. Vitest transforms with esbuild/oxc. Deno 2.1.4 has its own embedded TypeScript, so shared code must avoid syntax newer than what Deno 2.1 understands.
- **Decision:** `typescript ~6.0.3` in the catalog. Optionally add `"@typescript/native": "npm:typescript@7.0.2"` at the root for a fast CI-only `tsc -b` job later. TS 7 turns TS 6 deprecations into errors; Expo's tsconfig base already uses `moduleResolution: bundler` and `module: preserve`, so it is ready.

### 3. React Native styling: plain `StyleSheet` plus typed token hooks
| Option | Current state (npm, 2026-09-23) | Verdict |
|---|---|---|
| NativeWind | `latest` 4.2.7, which only supports Tailwind v3. v5 exists only as `5.0.0-rc.0` (2026-09-13), with peers `tailwindcss >4.1.11` and `react-native-css 3.1.0-rc.0` | Rejected: a release candidate is not production-safe. |
| Unistyles | 3.3.0 stable (2026-07-10). Peers `react-native >=0.76`, `react-native-nitro-modules`, `react-native-edge-to-edge`, reanimated | Viable, but adds a C++ Nitro module and a Babel plugin that every SDK upgrade must re-verify. |
| Tamagui | 2.7.7 (3.0 in beta) | Rejected: a heavy compiler and design-system opinions conflict with the no-redesign rule (§124). |
| **StyleSheet + `packages/design-tokens`** | Nothing to install | **Chosen.** The primary design canvas (`*.dc.html`) is written in inline styles, which map 1:1 onto `StyleSheet.create`. A `useTheme()` hook with per-scheme `makeStyles` memoization covers dark mode (§38). The React Compiler (on by default in the SDK 57 template: `experiments.reactCompiler: true`) removes the manual memoization. There is no native dependency to break on Reanimated 4 or RN 0.86 upgrades. |

### 4. Widgets, share extension, NotificationListenerService
- **expo-widgets 57.0.20 is not recommended.**
  - Its docs frontmatter says `platforms: ['ios']`.
  - Android support exists only behind an undocumented `enableAndroid` plugin flag (`plugin/build/withWidgets.js`, default `false`) and uses `androidx.glance:glance-appwidget:1.2.0-rc01`.
  - Widget code runs in "an isolated runtime and can only use `@expo/ui/swift-ui` components, with no React hooks, app state, or asynchronous work".
  - There is a monorepo Metro resolution bug where the widget bundle cannot resolve hoisted packages (expo#49750 and #49752, reported on 57.0.16).
  - It does support deep links: `widgetURL` from @expo/ui, and `start(props, url)` for Live Activities.
  - <https://raw.githubusercontent.com/expo/expo/sdk-57/docs/pages/versions/unversioned/sdk/widgets.mdx>, <https://github.com/expo/expo/issues/49750>
- **iOS: @bacons/apple-targets 5.0.0 plus a hand-written SwiftUI WidgetKit extension** under `apps/mobile/targets/widget/`.
  - `expo-target.config.js` sets `type: "widget"`, the App Group `group.com.dijitalasistan.app`, and `deploymentTarget: "16.4"`.
  - Families: `systemSmall`, `systemMedium`, `systemLarge`, `accessoryCircular`, `accessoryRectangular` and `accessoryInline` (Lock Screen).
  - Use `containerBackground` behind `#available(iOS 17, *)` and `widgetURL`/`Link` for deep links to `dijitalasistan://…`.
  - The plugin mirrors `ios.entitlements['com.apple.security.application-groups']` and writes generated entitlements to `ios/.targets/`. It also supports a `_shared` directory. Requirements: "CocoaPods 1.16.2 (ruby 3.2.0), Xcode 16 (macOS 15 Sequoia), and Expo SDK +53".
- **Android: native Kotlin Glance `GlanceAppWidget`** in a local Expo module (`apps/mobile/modules/da-widgets`).
  - A config plugin adds the `<receiver>` and the `appwidget-provider` XML for 2×2 and 4×2 (`targetCellWidth/Height` on API 31+, `minWidth/minHeight` fallback). Clicks use `actionStartActivity` with a deep-link Intent.
  - Fallback: `react-native-android-widget` 0.22.1 (peer `expo >=54`). It renders JSX to RemoteViews through a headless JS task, which costs a JS runtime per update.
- **Shared widget data contract:** the main app writes a privacy-safe `WidgetSnapshot` JSON, validated by a zod schema in packages/domain and containing no mail bodies, through the local module `da-widgets`.
  - iOS writes to App Group `UserDefaults(suiteName:)` and calls `WidgetCenter.shared.reloadTimelines(ofKind:)`.
  - Android writes to `SharedPreferences` or DataStore and calls `GlanceAppWidget.updateAll()`.
- **Share extension: expo-share-intent 8.0.1.** Its table says "SDK 57 → 8.0+"; peers `expo ^57`, `expo-linking >=57.0.1`, `expo-constants >=57.0.3`.
  - iOS `iosActivationRules`: `NSExtensionActivationSupportsText: true`, `…WebURLWithMaxCount: 1`, `…WebPageWithMaxCount: 1`, `…ImageWithMaxCount: N`, `…FileWithMaxCount: N` (PDF and files).
  - Android: `androidIntentFilters: ["text/*","image/*","application/pdf"]` covers ACTION_SEND, and `androidMultiIntentFilters: ["image/*","*/*"]` covers ACTION_SEND_MULTIPLE (§28).
  - It **redirects into the main app** and does not support a custom iOS view, which fits "Capture flow common domain layer". If an in-extension UI is ever needed, set `disableIOS: true` and build the extension with apple-targets.
  - Set `iosAppGroupIdentifier` to the same group.
- **NotificationListenerService: confirmed approach.** Create a local Expo module with `npx create-expo-module@latest --local` at `apps/mobile/modules/notification-intelligence`, written in Kotlin against expo-modules-core ~57.0.18.
  - The module's `AndroidManifest.xml` (merged automatically) declares `<service android:name=".DaNotificationListener" android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE" android:exported="false">` with intent-filter action `android.service.notification.NotificationListenerService`. Add `meta-data android.service.notification.default_filter_types="conversations|alerting"`.
  - Check whether access is granted with `NotificationManagerCompat.getEnabledListenerPackages(ctx)`. Deep-link to `Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS`, or on API 30+ to `ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS` with the component-name extra.
  - Filter by package allow/deny list inside the service. Default-deny authenticator apps: `com.google.android.apps.authenticator2`, `com.azure.authenticator`, `com.authy.authy`, `com.twofasapp`, `org.fedorahosted.freeotp`, `com.okta.android.auth`, `com.lastpass.authenticator`.
  - Buffer to local encrypted storage and emit module events while the JS app is alive.
  - On iOS the module is a no-op stub returning `isSupported: false` (§36, §91).

### 5. Mobile E2E and unit tests
- **Maestro 2.10.0 is recommended over Detox 20.51.4.**
  - Maestro's YAML flows are black-box, and 2.9.0 added `setDarkMode`, `toggleDarkMode`, `assertDarkMode` and `assertLightMode`, which cover the §102 dark-mode case.
  - Expo documents Maestro on EAS Workflows (the job type is marked alpha) and Maestro Cloud. <https://docs.expo.dev/eas/workflows/examples/e2e-tests/>, <https://raw.githubusercontent.com/mobile-dev-inc/maestro/main/CHANGELOG.md>
  - Run flows against an `e2e` or `preview` EAS profile: a Release build with an embedded bundle, pointed at a seeded Supabase. Dev-client builds work via `openLink` to `exp+dijitalasistan://expo-development-client/?url=…` but are flakier.
  - Android runs on GitHub Actions ubuntu with KVM and `reactivecircus/android-emulator-runner`. iOS runs on EAS Workflows or a macOS runner.
  - Detox needs a native test harness, a config plugin and gray-box synchronization, and it would still leave iOS/Android parity to hand-tune.
- **Unit tests:** jest-expo ~57.0.5 with jest 29.7.0, RNTL 14.0.1 and test-renderer 1.3.0 cover apps/mobile and packages/ui. Vitest 4.1.11 covers the pure TypeScript packages (domain, validation, i18n, api-client), web and backoffice. **Do not run React Native components under vitest**: RN's Flow sources and jest preset mocks (`@react-native/jest-preset 0.86.3`) are Jest-only.

### 6. Supabase local development
- **CLI 2.117.0 stack** (from `apps/cli-go/pkg/config/templates/Dockerfile`): `supabase/postgres:17.6.1.167`, `supabase/edge-runtime:v1.74.3`, `supabase/gotrue:v2.196.0`, `postgrest/postgrest:v16.2`, `supabase/postgres-meta:v0.99.0`, `supabase/storage-api:v1.72.1`, `supabase/realtime:v2.130.0`, `supabase/pg_prove:3.36`, `supabase/migra`, `supabase/pgadmin-schema-diff`.
- `config.toml` template: `[db] major_version = 17`; `[edge_runtime] policy = "per_worker"`, `inspector_port = 8083`, `deno_version = 2`.
- `supabase start`, `db reset`, `test db`, `db diff`, `gen types --local` and `functions serve` **all need Docker**.
- Edge runtime: `supabase/edge-runtime` main has `deno/Cargo.toml` `version = "2.1.4"` and `deno_core 0.324.0`. Latest runtime release is v1.76.2 (2026-09-02); the CLI pins v1.74.3.
- `npm:` and `jsr:` specifiers are supported. Use a per-function `deno.json`. Imports outside `supabase/` work with `functions deploy --use-api`, which also needs no Docker. <https://github.com/orgs/supabase/discussions/33613>
- **Fallback tiers** (container state is in Container facts):
  - **A (CI, authoritative):** GitHub Actions ubuntu with `supabase/setup-cli`, then `supabase start`, `supabase db reset`, `supabase test db` (pgTAP) and `supabase db lint`. This is the Postgres 17 source of truth.
  - **B (container, best effort):** start `dockerd` manually (the binary is present and we run as root) and try the full stack. Unverified; image pulls may be blocked.
  - **C (container, guaranteed):** the local PG16 cluster (`16/main`, port 5432, currently down) plus `apt-get install postgresql-16-pgvector postgresql-16-pgtap libtap-parser-sourcehandler-pgtap-perl postgresql-16-cron`, which gives pgvector 0.6.0-1, pgTAP 1.3.2-2, pg_prove 3.36-2 and pg_cron 1.6.2-1 from archive.ubuntu.com (reachable). Load a `supabase/tests/shim/000_supabase_compat.sql` **before** migrations:
    - roles `anon`, `authenticated`, `service_role BYPASSRLS`, `authenticator`;
    - schemas `auth`, `storage`, `extensions`, `net`, `vault`;
    - a minimal `auth.users(id uuid pk, email text, raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz)`;
    - `auth.uid()`, `auth.role()` and `auth.jwt()` reading `current_setting('request.jwt.claims', true)::jsonb`, the same way PostgREST and GoTrue do;
    - `storage.buckets`, `storage.objects` and `storage.foldername()`;
    - a no-op `net.http_post()`.
    - Tests impersonate users with `set local role authenticated; set local request.jwt.claims = '{"sub":"…","role":"authenticated"}'` and run through `pg_prove`.
  - **D (in-process, optional):** PGlite 0.5.8 with `@electric-sql/pglite-pgvector` 0.0.9 and `-pgtap` 0.0.9 inside vitest, for pure SQL-function tests. It has no pg_cron or pg_net and allows a single connection.
  - **Type generation without Docker:** `PG_META_DB_URL=postgres://… PG_META_GENERATE_TYPES=typescript PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public node node_modules/@supabase/postgres-meta/dist/server/server.js > packages/api-client/src/database.types.ts`. This uses the same pg-meta 0.99.0 as the CLI.
  - **Edge Functions without Docker:** `deno@2.1.4` from npm for `deno check`, `deno lint` and `deno test --allow-env --allow-net` on handlers. `functions serve` is unavailable.
- **Portability constraints for migrations:**
  - pgvector: stay within the 0.6.0 feature set. `vector(1536)` and HNSW are fine (since 0.5). Avoid `halfvec`, `sparsevec` and bit ops (0.7+) and `hnsw.iterative_scan` (0.8+).
  - PG16 vs PG17: avoid PG17-only syntax such as `JSON_TABLE`, `MERGE … RETURNING` and `transaction_timeout`.
  - Guard `create extension if not exists` for `pg_net`, `pg_cron` and `vector` in `extensions`.

### 7. Monorepo tooling
- **pnpm ≥11 behavior:**
  - `.npmrc` holds auth and registry settings only; everything else lives in `pnpm-workspace.yaml`.
  - `allowBuilds` replaces `onlyBuiltDependencies` and related settings, and `strictDepBuilds: true` is the default.
  - `minimumReleaseAge` defaults to **1440 minutes** and `blockExoticSubdeps` to true.
  - pnpm 12 removes `--resolution-only` (use `pnpm peers check`), canonicalizes lockfiles for cyclic graphs, and reports unknown settings.
  - <https://pnpm.io/blog/releases/11.0>, <https://pnpm.io/blog/whats-different-in-pnpm-12>, <https://www.infoq.com/news/2026/09/pnpm-12-rust/>
- **Isolated `node_modules`** is supported by Expo since SDK 54 and is pnpm's default. The documented fallback is `nodeLinker: hoisted`. Expo auto-configures Metro for monorepos, so do not hand-set `watchFolders` or `nodeModulesPaths`.
- **Catalogs and Expo:** `npx expo install --fix` rewrites `catalog:expo` references into literal versions. Therefore never run `--fix` in CI. Gate with `pnpm --filter mobile exec expo install --check` (read-only) and `expo-doctor`, and bump versions only by editing the catalog. Deliberate deviations such as `@sentry/react-native` go in `package.json` → `expo.install.exclude`.
- **Turbo 2.11.3 tasks:** `lint`, `typecheck` (`tsc --noEmit`, TS 6), `test` (vitest or jest), `build` (next build ×2), `db:test` (tier A or C), `functions:test` (deno), `mobile:check` (`expo install --check` plus `expo export --platform ios,android` as a JS-bundle smoke test), `e2e:web`, `e2e:backoffice`.
- **ESLint 9.39.5, not 10.11.0:**
  - eslint-config-next 16.3.6 depends on `eslint-plugin-react ^7.37.0` (peer `^3…^9.7`), `eslint-plugin-import ^2.32.0` (peer `…^9`) and `eslint-plugin-jsx-a11y ^6.10.0` (peer `…^9`).
  - eslint-config-expo 57.0.2 depends on the same react and import plugins.
  - `@next/eslint-plugin-next` calls `context.getFilename()`, which ESLint 10 removed, so it crashes at runtime. <https://github.com/jsx-eslint/eslint-plugin-react/issues/3977>
  - The catch: ESLint 9 security maintenance ended on 2026-08-06. That is acceptable for a dev-only tool. Open a follow-up task to move to ESLint 10 once eslint-config-next supports it; the alternative today is a custom config with `@eslint-react/eslint-plugin` 5.20.5, `eslint-plugin-import-x` 4.17.1 and `@next/eslint-plugin-next`.
- **Formatter:** Prettier 3.9.9. Biome 2.5.14 lacks Expo and Next rule parity, and oxfmt 0.70.0 is pre-1.0.

### 8. Other libraries
- **RevenueCat:** `react-native-purchases` 10.10.1 only. Build a **custom paywall** from `Purchases.getOfferings()` and `purchasePackage()` in the primary visual language, because the RevenueCat dashboard paywalls in `react-native-purchases-ui` would break the no-redesign rule (§124). Use `Purchases.restorePurchases()` and `Purchases.showManageSubscriptions()` for §43. Entitlement `pro`, products `da_pro_monthly` and `da_pro_annual`. Server state comes from RevenueCat webhooks into an Edge Function; api.revenuecat.com is not reachable from the container.
- **Sentry:** `@sentry/react-native` 8.27.0 with the `@sentry/react-native/expo` config plugin (v8 supports `useNativeInit`) and `getSentryExpoConfig` for Metro. `@sentry/nextjs` 10.75.2. Both bring `@sentry/cli` 3.8.0 as npm optional deps. Source-map upload must run in CI because sentry.io is blocked here.
- **Secure storage (§87):**
  - Supabase auth storage adapter: `expo-secure-store` with `keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`. No size-limit warning is present in 57.0.4.
  - Sensitive caches: MMKV v4 `createMMKV({ id, encryptionKey: <32-byte random from expo-crypto, stored in SecureStore>, encryptionType: 'AES-256' })`.
  - TanStack persistence: `createAsyncStoragePersister` over MMKV with `dehydrateOptions.shouldDehydrateQuery` restricted to queries tagged `meta.persist`, so raw mail bodies are never persisted.
  - `expo-sqlite` ~57.0.3 supports `useSQLCipher: true` in its config plugin (also `enableFTS`, `withSQLiteVecExtension`, `useLibSQL`). Adopt it only if a relational offline store is needed; v1 can run on MMKV alone.
- **Auth (§88):**
  - Apple: `expo-apple-authentication` → `signInWithIdToken({provider:'apple', token, nonce})`.
  - Google: `@react-native-google-signin/google-signin` 16.1.5 → `signInWithIdToken({provider:'google'})`.
  - Microsoft: `signInWithOAuth({provider:'azure', options:{skipBrowserRedirect:true, redirectTo:'dijitalasistan://auth/callback'}})`, then `expo-web-browser.openAuthSessionAsync`, then `exchangeCodeForSession` with the PKCE flow.
  - Provider integrations (Gmail, Graph, Tasks) use a server-side authorization-code flow through Edge Functions with progressive scopes; refresh tokens never reach the client (§76). `expo-auth-session` is not needed.
- **Voice (§25):** `expo-speech-recognition` 57.1.0 for on-device tr-TR speech-to-text, `expo-speech` for TTS, and `expo-audio` to record for server STT when the device lacks it.
- **Background:** `expo-background-task` uses WorkManager and BGTaskScheduler, with a 15-minute minimum and system discretion on iOS. Use it for widget snapshot refresh; time-critical updates go through push.
- **Next 16 specifics:**
  - `proxy.ts` replaces `middleware.ts` and its runtime is fixed to `nodejs` ("The `edge` runtime is NOT supported in `proxy`").
  - `next lint` is removed.
  - Turbopack is the default, and a custom `webpack` config fails the build.
  - `revalidateTag(tag, profile)` now takes two arguments; `updateTag` is new and Server Actions-only.
  - Synchronous `params`, `cookies()` and `headers()` are removed.
  - Minimums: Node 20.9 and TypeScript 5.1.
  - Server-action CSRF defense compares the `Origin` host against `x-forwarded-host`/`host`, but **"A request that carries no `Origin` header at all is allowed through with a warning rather than rejected."** The backoffice must therefore add its own check: reject server actions that lack an `Origin` in `proxy.ts` or an action wrapper, and use `SameSite=Strict` admin cookies.
  - `cacheComponents` defaults to `false`: turn it on for web, keep it off for backoffice at first.
  - <https://raw.githubusercontent.com/vercel/next.js/v16.3.6/docs/01-app/02-guides/upgrading/version-16.mdx>, <https://raw.githubusercontent.com/vercel/next.js/v16.3.6/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.mdx>
- **i18n:**
  - ICU catalogs in packages/i18n, consumed by next-intl 4.14.6 (peer `next ^16`) and use-intl 4.14.6 on mobile. use-intl depends on `intl-messageformat ^11.1.0` and peers `react ^19`.
  - Hermes does not implement `Intl.RelativeTimeFormat` or `Intl.ListFormat` (recalled, not checked). Use date-fns `formatDistance` with the `tr` locale, or add `@formatjs/intl-relativetimeformat`.
  - Alternative: i18next 26.4.2 with react-i18next 17.0.15 (peer `typescript ^5||^6||^7`) and `i18next-icu` 2.4.4, at the cost of a second API.
- **Fonts and icons in the primary design:**
  - The design uses `Geist:wght@300..700`, `Lora:ital,wght@0,400..600;1,400..600` and `Material Symbols Rounded:opsz,wght,FILL,GRAD@20..48,300..600,0..1,0`. It sets `font-variation-settings:'FILL' 1` in 126–128 places. React Native cannot drive variable-font axes, and `@expo-google-fonts/material-symbols-rounded` 0.4.60 ships only static FILL=0 weights.
  - So: generate typed `react-native-svg` components from `@material-symbols/svg-400/rounded/{name}.svg` and `{name}-fill.svg` (7,854 icons per style; include only the icons actually used) into packages/ui.
  - Web uses the same SVGs as inline React components. Fonts come from `@expo-google-fonts/geist` and `@expo-google-fonts/lora` via the expo-font config plugin (mobile) and from `next/font/google` (web).
- **Hono:** 4.13.8 on npm and `jsr:@hono/hono`, served with `Deno.serve(app.fetch)`.
- **expo-updates / EAS:** eas-cli 24.7.0, `appVersionSource: remote`, `runtimeVersion: {policy: "fingerprint"}`. With both apple-targets and expo-share-intent, check `extra.eas.build.experimental.ios.appExtensions` for the widget and share targets so credentials are generated for each bundle ID.

---

## Risks & mitigations
| Risk | Mitigation |
|---|---|
| Installing npm-`latest` native modules (RN 0.87.1, reanimated 4.7.0, RNGH 3.3.0, safe-area 5.10.0) breaks SDK 57 native builds. | Named catalog `expo` pinned to bundledNativeModules; a CI gate on `expo install --check`; `overrides` for react-native. |
| pnpm ≥11 `minimumReleaseAge=1440` blocks pins published less than 24 h ago: supabase-js 2.117.1 (09-23 09:35Z), next 16.3.6 (09-22 16:19Z), @sentry/nextjs 10.75.2 (09-22), turbo 2.11.3 (09-22 20:40Z). | Install after the window passes, or temporarily use `minimumReleaseAgeExclude` for those names. Fallbacks: next 16.3.5, turbo 2.11.2, supabase-js 2.117.0. |
| Duplicate React through shared packages under isolated pnpm. | One React (19.2.3) plus `overrides`; packages/ui is RN-only; domain, validation and i18n have no React; `pnpm why --depth=10 react react-native` in CI. |
| TypeScript 7 temptation, since it is `latest`. | Pin `~6.0.3`. Reassess at TS 7.1 (programmatic API) together with a typescript-eslint release that allows `>=7`. |
| ESLint 9 is past its maintenance window (2026-08-06). | Dev-only exposure. Follow-up task to move to ESLint 10 when eslint-config-next and eslint-plugin-react support it; the custom-config fallback is described in §7. |
| Hermes V1 is on by default in SDK 57, with a known +25–30% Android memory increase alongside Reanimated (per the SDK 57 notes cited in Sentry's SDK 57 support issue). | Measure against the §125 performance budget. Opt out with `expo.useHermesV1: false` in Podfile properties or `gradle.properties` if it regresses. |
| SDK 58 (RN 0.88, React 19.3, RNGH 3.x, reanimated 4.6/worklets 0.12) is in preview now. | Stay on SDK 57 for v1. Plan the upgrade (RNGH v3 API migration) as a separate milestone; do not mix pins. |
| pnpm 12 (Rust) is not yet verified with EAS and Turbo lockfile parsing. | Stay on pnpm 11.27.1. Do a spike later: `turbo run build --dry=json`, an EAS build, and `pnpm install --frozen-lockfile` under 12.x. |
| expo-share-intent and @bacons/apple-targets both edit the pbxproj and entitlements. | One App Group (`group.com.dijitalasistan.app`) set in `ios.entitlements`; run a `expo prebuild --clean` smoke check in CI; separate extension bundle IDs (`.ShareExtension`, `.widget`). |
| Android NotificationListener: Play policy review, Android 13+ "restricted settings" for sideloaded APKs, and Android 15 redaction of OTP content for untrusted listeners. | Explicit opt-in screen (§36) with prominent disclosure; default-deny authenticator apps; handle redacted content; Play Data Safety declaration. The feature stays isolated in its own module and does not block iOS. |
| DB test fidelity when the container runs PG16, pgvector 0.6 and a shim instead of Supabase PG17. | Tier A (CI with `supabase start`) is the source of truth. Local-only features stay within the 0.6/PG16 subset. The shim mirrors GoTrue's `request.jwt.claims` contract. |
| Supabase type generation needs Docker. | `@supabase/postgres-meta` 0.99.0 in `PG_META_GENERATE_TYPES` mode against the local DB; CI regenerates and diffs the output. |
| Edge Functions share code with packages/* while running Deno 2.1.4. | Deno-safe rule for domain and validation (explicit `.ts` imports, no Node APIs); per-function `deno.json` import map to `../../../packages/domain/src/index.ts`; deploy with `--use-api`; `deno check` in CI with Deno 2.1.4. |
| Playwright 1.63 expects Chromium revision 1243, which is missing here, and cdn.playwright.dev is blocked. | Download Chrome for Testing 153.0.8010.12 from storage.googleapis.com (reachable) and point `launchOptions.executablePath` at it via env, or temporarily use the preinstalled Chromium 141 at `/opt/pw-browsers/chromium`. |
| TanStack Table v9 has a large API change and most online examples are v8. | Use the v9 API from the start (`useTable({features})`); avoid `useLegacyTable`; follow the shadcn v9 data-table examples. |
| A Sentry v8 major against Expo's ~7.11 pin could fail `expo install --check`. | `expo.install.exclude: ["@sentry/react-native"]`, plus an EAS build smoke test. |
| An expo-widgets Android mode could be switched on by accident. | Do not install expo-widgets at all; widgets are native (Swift and Kotlin) through the local module. |

---

## Container facts
- **OS and runtimes:**
  - Ubuntu 24.04.4 LTS, running as root (uid 0), 4 vCPU, 15 GB RAM, about 30 GB free on `/`.
  - Default Node **v22.22.2** at `/opt/node22`; v20.20.2 at `/opt/node20`; `/opt/node21` and nvm are also present. npm 10.9.7.
  - Global **pnpm 10.33.0**, corepack 0.34.6. A `packageManager` field makes it fetch the pinned pnpm from registry.npmjs.org, which is reachable and exempt from the proxy.
  - Java: OpenJDK 21.0.10. Also present: bun (`/root/.bun/bin/bun`), Go, Rust, Python 3.11.15, git 2.43.0. **No `gh` CLI.**
- **Docker:** client 29.3.1 with buildx 0.31.1 and compose 5.1.1. **The daemon is not running** (`/var/run/docker.sock` does not exist). `dockerd`, `containerd` and `runc` binaries exist at `/usr/bin`; cgroup v1. Registry reachability: `auth.docker.io` token endpoint returns 200, `registry-1.docker.io/v2/` returns 401 (reachable), `public.ecr.aws/v2/` returns 401 (reachable), `ghcr.io/v2/` returns 405. `production.cloudflare.docker.com` returns 403 at its root, so blob pulls are uncertain.
- **Postgres:** PostgreSQL 16 server binaries are in `/usr/lib/postgresql/16/bin` (`postgres`, `initdb`, `pg_ctl`, `pg_dump`, `pg_prove` absent). Cluster `16/main` on port 5432 exists and is **down**. There are 204 files in `/usr/share/postgresql/16/extension` (pgcrypto, uuid-ossp, pg_trgm, citext, ltree, hstore, btree_gin/gist, unaccent, pg_stat_statements and others). **No pgvector, no pgTAP.** apt candidates via archive.ubuntu.com (reachable): `postgresql-16-pgvector 0.6.0-1`, `postgresql-16-pgtap 1.3.2-2`, `libtap-parser-sourcehandler-pgtap-perl 3.36-2` (pg_prove), `postgresql-16-cron 1.6.2-1`, `postgresql-16-hypopg 1.4.0-2`. **`pg_net` is not available from apt.**
- **Deno:** not installed, and dl.deno.land is blocked. Use the npm `deno` package (versions 2.1.4 through 2.9.6; `lts` 2.2.15), whose binary comes from `@deno/linux-x64-glibc` optional deps.
- **Supabase CLI:** not installed. The npm `supabase@2.117.0` binary comes from `@supabase/cli-linux-x64` and installs from the npm registry. `api.supabase.com` is blocked, so remote link, deploy and type generation from this container are impossible; `jsr.io` is reachable.
- **Playwright:** global CLI 1.56.1. `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` contains `chromium-1194` (Chromium **141.0.7390.37**), `chromium_headless_shell-1194` and `ffmpeg-1011`. ChromeDriver 147.0.7727.24. Browser system libraries (libnss3, libgbm, libatk, libasound, libxkbcommon) are present. cdn.playwright.dev and the playwright azureedge/prss hosts are **blocked**. `storage.googleapis.com/chrome-for-testing-public/153.0.8010.12/linux64/{chrome,chrome-headless-shell}-linux64.zip` returns **206 (reachable)**.
- **Mobile build tooling:** no Android SDK, emulator or adb. `dl.google.com` is **blocked** (the Google Maven artifact host), so Gradle Android builds are impossible here; `maven.google.com` itself returned 200 on its index page only. Maven Central is reachable. iOS builds are impossible (Linux). `api.expo.dev` is **blocked**, so no EAS builds, updates or submits from here. The only in-container mobile checks are TypeScript, jest-expo, `expo install --check`, `expo export` bundle smoke tests and `expo prebuild` plugin validation.
- **Blocked hosts** (proxy 403): unpkg.com, expo.dev, docs.expo.dev, pnpm.io, supabase.com, nextjs.org, devblogs.microsoft.com, github.com API (the repo is not attached), sentry.io, downloads.sentry-cdn.com, api.revenuecat.com, graph.microsoft.com, api.openai.com, exp.host, vercel.com, esm.sh, deno.land, get.maestro.mobile.dev, googlechromelabs.github.io.
- **Reachable hosts:** registry.npmjs.org, jsr.io, raw.githubusercontent.com, github.com release downloads (206), www.googleapis.com, fonts.googleapis.com, fonts.gstatic.com, storage.googleapis.com, archive.ubuntu.com, repo1.maven.org, api.anthropic.com (not proxied).
- **Prototype note (secondary archive):** its `package.json` has react ^19, react-router-dom ^7.18.3, vite ^8.0.5, `@tailwindcss/vite` ^4, `oxfmt ^0.2.0` and `typescript ^5.7`. It is a web-only Vite single-page app; none of its runtime dependencies carry over to the React Native app.

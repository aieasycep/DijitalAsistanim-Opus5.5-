// Writes the widget extension / Glance sources derived from @da/i18n and @da/design-tokens
// (T-8.25). Usage: pnpm --filter @da/mobile widgets:generate
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeWidgetNative } from '../modules/da-widgets/plugin/generate-native.ts';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const path of writeWidgetNative(appRoot)) console.info(`widgets:generate  ${path}`);

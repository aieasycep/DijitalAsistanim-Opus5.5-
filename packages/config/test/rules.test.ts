import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import noEmptyHandler from '../eslint/rules/no-empty-handler.mjs';
import noRawColor from '../eslint/rules/no-raw-color.mjs';
import noServiceClient from '../eslint/rules/no-service-client-in-user-routes.mjs';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run('no-empty-handler', noEmptyHandler, {
  valid: [
    { code: '<Button onPress={() => save()} />' },
    { code: '<Button onPress={handlePress} />' },
    { code: '<View accessibilityLabel="x" />' },
  ],
  invalid: [
    { code: '<Button onPress={() => {}} />', errors: [{ messageId: 'empty' }] },
    { code: '<a onClick={function () {}} />', errors: [{ messageId: 'empty' }] },
    { code: '<Button onPress={() => undefined} />', errors: [{ messageId: 'empty' }] },
    { code: '<Button onLongPress={() => null} />', errors: [{ messageId: 'empty' }] },
    { code: '<Button onPress={noop} />', errors: [{ messageId: 'empty' }] },
  ],
});

tester.run('no-raw-color', noRawColor, {
  valid: [
    { code: 'const c = theme.color.brand.primary;', filename: '/repo/apps/mobile/src/a.ts' },
    { code: 'const c = "#5B5CE2";', filename: '/repo/packages/design-tokens/src/palette.ts' },
    { code: 'const id = "#section-2";', filename: '/repo/apps/web/src/a.ts' },
    {
      code: 'const c = "#fff";',
      filename: '/repo/apps/web/src/app/icon.tsx',
      options: [{ allowPaths: ['src/app/icon'] }],
    },
  ],
  invalid: [
    {
      code: 'const c = "#5B5CE2";',
      filename: '/repo/apps/mobile/src/a.ts',
      errors: [{ messageId: 'raw' }],
    },
    {
      code: 'const s = { color: "rgba(0,0,0,.5)" };',
      filename: '/repo/packages/ui/src/a.ts',
      errors: [{ messageId: 'raw' }],
    },
    {
      code: 'const s = `border: 1px solid #E9E7E1`;',
      filename: '/repo/apps/web/src/a.ts',
      errors: [{ messageId: 'raw' }],
    },
  ],
});

tester.run('no-service-client-in-user-routes', noServiceClient, {
  valid: [
    {
      code: 'import { userClient } from "../../_shared/db/user.ts";',
      filename: '/repo/supabase/functions/api/routes/me.ts',
    },
    {
      code: 'import { serviceClient } from "../_shared/db/service.ts";',
      filename: '/repo/supabase/functions/worker/index.ts',
    },
    {
      code: 'import { serviceClient } from "../../_shared/db/service.ts";',
      filename: '/repo/supabase/functions/api/routes/devices.ts',
      options: [{ allow: ['api/routes/devices.ts'] }],
    },
  ],
  invalid: [
    {
      code: 'import { serviceClient } from "../../_shared/db/service.ts";',
      filename: '/repo/supabase/functions/api/routes/me.ts',
      errors: [{ messageId: 'banned' }],
    },
    {
      code: 'import * as svc from "../../_shared/db/service.ts";',
      filename: '/repo/supabase/functions/api/routes/mail.ts',
      errors: [{ messageId: 'banned' }],
    },
  ],
});

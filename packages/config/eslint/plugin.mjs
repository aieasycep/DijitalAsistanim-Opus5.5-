import noEmptyHandler from './rules/no-empty-handler.mjs';
import noRawColor from './rules/no-raw-color.mjs';
import noServiceClientInUserRoutes from './rules/no-service-client-in-user-routes.mjs';

/** Local ESLint plugin with the Dijital Asistan custom rules (namespace `da`). */
export const daPlugin = {
  meta: { name: '@da/eslint-plugin', version: '0.0.0' },
  rules: {
    'no-empty-handler': noEmptyHandler,
    'no-raw-color': noRawColor,
    'no-service-client-in-user-routes': noServiceClientInUserRoutes,
  },
};

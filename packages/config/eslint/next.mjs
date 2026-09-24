import { base } from './base.mjs';

/**
 * Next.js apps (apps/web, apps/backoffice). The app passes the `eslint-config-next` flat config it
 * imports itself (that package needs `next` as a peer, which only the apps have).
 * `serverOnlyDirs` are the only places allowed to import the Supabase JS client or read server
 * secrets — the browser bundle must never contain them.
 */
export function next({
  tsconfigRootDir,
  nextConfigs = [],
  serverOnlyDirs = ['src/server/**'],
} = {}) {
  return [
    ...base({ tsconfigRootDir }),
    ...nextConfigs,
    {
      files: ['**/*.{ts,tsx}'],
      rules: {
        'da/no-empty-handler': 'error',
        'da/no-raw-color': ['error', { allowPaths: ['src/app/opengraph-image', 'src/app/icon'] }],
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: '@supabase/supabase-js',
                message: 'Supabase clients live only in server-only modules (src/server/**).',
              },
            ],
          },
        ],
      },
    },
    {
      files: serverOnlyDirs,
      rules: { 'no-restricted-imports': 'off' },
    },
  ];
}

export default next;

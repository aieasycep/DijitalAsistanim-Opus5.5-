import { base } from './base.mjs';

/**
 * For packages imported unchanged by Supabase Edge Functions (Deno 2.1): packages/domain and
 * packages/validation. Only zod, date-fns and @date-fns/tz may be imported, relative imports
 * must carry the `.ts` extension, and no Node/DOM runtime globals may be used.
 */
export function denoSafe({ tsconfigRootDir } = {}) {
  return [
    ...base({ tsconfigRootDir }),
    {
      files: ['src/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                regex: '^(?!\\.{1,2}/|zod$|zod/|date-fns$|date-fns/|@date-fns/tz$).*',
                message: 'Deno-safe packages may import only zod, date-fns and @date-fns/tz.',
              },
              {
                regex: '^\\.{1,2}/(?!.*\\.ts$).*',
                message: 'Relative imports must include the .ts extension (Deno resolution).',
              },
            ],
          },
        ],
        'no-restricted-globals': [
          'error',
          { name: 'window', message: 'No DOM globals in Deno-safe packages.' },
          { name: 'document', message: 'No DOM globals in Deno-safe packages.' },
          { name: 'process', message: 'No Node globals in Deno-safe packages.' },
          { name: 'Buffer', message: 'No Node globals in Deno-safe packages.' },
          { name: 'require', message: 'ESM only.' },
        ],
      },
    },
  ];
}

export default denoSafe;

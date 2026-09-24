/** Shared Prettier configuration for every workspace. */
export default {
  printWidth: 100,
  singleQuote: true,
  trailingComma: 'all',
  semi: true,
  arrowParens: 'always',
  endOfLine: 'lf',
  overrides: [
    { files: ['*.json', '*.jsonc'], options: { trailingComma: 'none' } },
    { files: ['*.md'], options: { proseWrap: 'preserve' } },
  ],
};

import { flattenColors, type ColorSchemeName } from '@da/design-tokens';

/**
 * The `--da-*` colour variables of one scheme, as an inline style object (the same names and values
 * `tokens.css` declares). Lets a preview render in light or dark whatever the admin's theme is,
 * without any colour literal in the app.
 */
export function themeVars(scheme: ColorSchemeName): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [path, value] of flattenColors(scheme)) {
    const name = path
      .replaceAll('.', '-')
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase();
    vars[`--da-${name}`] = value;
  }
  return vars;
}

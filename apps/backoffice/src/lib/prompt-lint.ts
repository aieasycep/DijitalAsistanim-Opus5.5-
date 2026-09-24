/**
 * The `{{variable}}` placeholders a prompt template uses, unique and in order of first use
 * (BACKOFFICE_PLAN §6.11 "variable-chip helper"). admin-api's activation gate checks them against
 * the key's registry; the editor only lists them.
 */
export function promptVariables(template: string): string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g)) {
    const name = match[1];
    if (name !== undefined) seen.add(name);
  }
  return [...seen];
}

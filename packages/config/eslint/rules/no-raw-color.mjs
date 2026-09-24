/**
 * Flags raw colour literals (hex, rgb[a], hsl[a]) outside the design-token package.
 * All colours must come from `@da/design-tokens` so light/dark themes stay consistent
 * (master prompt §38, §122). Options: { allowPaths: string[] } (substring match on the filename).
 */
const COLOR =
  /(^|[^\w&])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgba?|hsla?)\(\s*\d/;
const DEFAULT_ALLOW = ['packages/design-tokens/'];

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow raw colour literals outside @da/design-tokens' },
    messages: { raw: 'Raw colour "{{value}}" — use a token from @da/design-tokens instead.' },
    schema: [
      {
        type: 'object',
        properties: { allowPaths: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const filename = (context.filename ?? context.getFilename()).replaceAll('\\', '/');
    const allow = [...DEFAULT_ALLOW, ...((context.options[0] ?? {}).allowPaths ?? [])];
    if (allow.some((p) => filename.includes(p))) return {};
    function check(node, text) {
      if (typeof text !== 'string') return;
      const m = COLOR.exec(text);
      if (m) context.report({ node, messageId: 'raw', data: { value: m[0].trim() } });
    }
    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked);
      },
    };
  },
};

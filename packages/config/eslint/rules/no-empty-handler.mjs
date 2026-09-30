/**
 * Flags JSX event handlers (`on[A-Z]…`) that do nothing: `() => {}`, `() => undefined`,
 * `() => null`, `function () {}` or a bare `noop`. A visible control must either perform a
 * real action or not be rendered as interactive (master prompt §99 / §100).
 */
const HANDLER = /^on[A-Z]/;
const NOOP_NAMES = new Set(['noop', 'NOOP', 'noOp']);

function isEmptyFunction(node) {
  if (node.type !== 'ArrowFunctionExpression' && node.type !== 'FunctionExpression') return false;
  const body = node.body;
  if (body.type === 'BlockStatement') return body.body.length === 0;
  if (body.type === 'Identifier' && body.name === 'undefined') return true;
  if (body.type === 'Literal' && body.value === null) return true;
  if (body.type === 'UnaryExpression' && body.operator === 'void') return true;
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow no-op event handlers on JSX elements' },
    messages: {
      empty:
        'Handler "{{name}}" does nothing. Wire it to a real action, or do not render the element as interactive.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || !HANDLER.test(node.name.name)) return;
        const value = node.value;
        if (!value || value.type !== 'JSXExpressionContainer') return;
        const expr = value.expression;
        if (isEmptyFunction(expr) || (expr.type === 'Identifier' && NOOP_NAMES.has(expr.name))) {
          context.report({ node, messageId: 'empty', data: { name: node.name.name } });
        }
      },
    };
  },
};

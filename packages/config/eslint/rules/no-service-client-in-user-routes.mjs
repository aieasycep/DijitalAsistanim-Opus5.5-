/**
 * The secret-key Supabase client bypasses RLS. User-facing `api` routes must query with the
 * caller's JWT; only allow-listed route files may import the service client
 * (master prompt §79, §151; SECURITY_AND_PRIVACY_PLAN).
 * Options: { allow: string[] } — filename substrings that may import it.
 */
const ROUTES = '/supabase/functions/api/routes/';
const SERVICE_SPECIFIERS = new Set(['serviceClient', 'createServiceClient']);
const SERVICE_MODULE = /_shared\/db\/service(\.ts)?$/;

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow the service (secret-key) client in user-facing api routes' },
    messages: {
      banned:
        'User-facing api routes must use the caller-scoped client. Add this file to the allow list only with a security review.',
    },
    schema: [
      {
        type: 'object',
        properties: { allow: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const filename = (context.filename ?? context.getFilename()).replaceAll('\\', '/');
    if (!filename.includes(ROUTES)) return {};
    const allow = (context.options[0] ?? {}).allow ?? [];
    if (allow.some((p) => filename.includes(p))) return {};
    return {
      ImportDeclaration(node) {
        const fromService = SERVICE_MODULE.test(String(node.source.value));
        const named = node.specifiers.some(
          (s) =>
            s.type === 'ImportSpecifier' &&
            SERVICE_SPECIFIERS.has(s.imported.name ?? s.imported.value),
        );
        if (fromService || named) context.report({ node, messageId: 'banned' });
      },
    };
  },
};

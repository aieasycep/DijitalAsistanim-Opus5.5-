/**
 * UI honesty checks (M§99, M§133):
 * QG-05 empty handlers (grep + `da/no-empty-handler` at error in the React presets) ·
 * QG-07 fake success / fake async · QG-14 hard-coded prices ·
 * QG-15 hard-coded user-facing strings (`react/jsx-no-literals` at error for every UI workspace, plus
 * literal accessibility / title / input-hint props, which the ESLint rule ignores).
 */
import {
  CODE_EXT,
  type Check,
  type Context,
  type Finding,
  eslintRuleProblem,
  grepLines,
  grepSource,
  isTestPath,
  missing,
} from '../lib.ts';

const UI_SCOPES = ['apps/', 'packages/ui/'];

const EMPTY_HANDLER =
  /on(Press|Click|LongPress|Submit|Change|ValueChange)\s*=\s*\{\s*(\(\s*\)\s*=>\s*(\{\s*\}|null|undefined|void\s+0)|noop|\(\)\s*=>\s*console\.)\s*\}/;

/** §5.2 pattern, extended to arrow / function callbacks (`setTimeout(() => setSuccess(true))`). */
const FAKE_TIMER =
  /setTimeout\(\s*(?:\(\s*\)\s*=>|function\s*\(\s*\))?[^)]{0,200}\b(set(Success|Done|Sent|Connected|Status)|toast\.success|navigate)\b/g;
const FAKE_RESOLVE = /Promise\.resolve\(\s*\{\s*(ok|success)\s*:\s*true/g;

const PRICE = /\b\d{1,3}(\.\d{3})*(,\d{2})?\s?(TL|₺)(?![\p{L}\p{N}_])|₺\s?\d/u;

/** Literal copy in props that `react/jsx-no-literals` (ignoreProps) does not see. */
const LITERAL_PROP =
  /\b(accessibilityLabel|accessibilityHint|aria-label|aria-description|placeholder|title|alt)=["'][^"'{}]*\p{L}{2,}[^"'{}]*["']/u;

/** UI workspaces and the shared React preset each must consume. */
const RN = 'packages/config/eslint/react-native.mjs';
const NEXT = 'packages/config/eslint/next.mjs';
const UI_WORKSPACES: readonly { dir: string; call: RegExp; preset: string }[] = [
  { dir: 'apps/mobile', call: /\breactNative\(/, preset: RN },
  { dir: 'packages/ui', call: /\breactNative\(/, preset: RN },
  { dir: 'apps/web', call: /\bnext\(/, preset: NEXT },
  { dir: 'apps/backoffice', call: /\bnext\(/, preset: NEXT },
];

function uiSources(ctx: Context): string[] {
  return ctx.select(UI_SCOPES, /\.(tsx|jsx|ts)$/).filter((f) => !isTestPath(f));
}

/** The rule must be `error` in the preset or in the workspace config, and never off for product code. */
function ruleEnforced(ctx: Context, id: string, rule: string): Finding[] {
  const out: Finding[] = [];
  for (const ws of UI_WORKSPACES) {
    const config = `${ws.dir}/eslint.config.mjs`;
    if (!ctx.exists(`${ws.dir}/package.json`)) continue;
    const source = ctx.read(config);
    if (!ws.call.test(source)) {
      out.push(missing(id, config, `does not use the shared preset ${ws.preset}`));
      continue;
    }
    const own = eslintRuleProblem(source, rule, false);
    if (own !== null) out.push(missing(id, config, own));
    const inPreset = eslintRuleProblem(ctx.read(ws.preset), rule, true) === null;
    const inOwn = eslintRuleProblem(source, rule, true) === null;
    if (!inPreset && !inOwn)
      out.push(missing(id, config, `${rule} is not configured at error level`));
  }
  return out;
}

export const ui: Check = {
  ids: ['QG-05', 'QG-07', 'QG-14', 'QG-15'],
  title: 'Empty handlers, fake success, hard-coded prices and strings',
  run(ctx: Context): Finding[] {
    const sources = uiSources(ctx);
    const appSources = sources.filter((f) => f.startsWith('apps/'));
    const out: Finding[] = [
      ...grepLines(ctx, sources, 'QG-05', (l) => EMPTY_HANDLER.test(l)),
      ...ruleEnforced(ctx, 'QG-05', 'da/no-empty-handler'),
      ...grepSource(ctx, appSources, 'QG-07', FAKE_TIMER),
      ...grepSource(
        ctx,
        appSources.filter((f) => !/\/(mocks?|stubs?)\//.test(f)),
        'QG-07',
        FAKE_RESOLVE,
      ),
      ...grepLines(
        ctx,
        sources.filter((f) => /^apps\/mobile\/(app|src)\/|^apps\/web\/(src\/)?app\//.test(f)),
        'QG-14',
        (l) => PRICE.test(l),
      ),
      ...grepLines(
        ctx,
        sources.filter((f) => f.endsWith('.tsx') && CODE_EXT.test(f)),
        'QG-15',
        (l) => !/^\s*(\*|\/\/|\/\*)/.test(l) && LITERAL_PROP.test(l),
      ),
      ...ruleEnforced(ctx, 'QG-15', 'react/jsx-no-literals'),
    ];
    return out;
  },
};

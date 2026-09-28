/**
 * Unfinished-feature copy and product claims (M§40, M§141, R-17):
 * QG-02 stub copy in code · QG-03 / QG-04 banned copy in the EN / TR catalogs · QG-06 banned claims ·
 * QG-06b positive "unlimited" claims · QG-24 prototype fakes in the mobile app.
 * The shared `banned-markers.txt` copy lines apply to every scanned file (wider than §5.2's scopes).
 */
import { type Check, type Context, type Finding, clip } from '../lib.ts';
import { allowed, bannedList } from './lists.ts';

const SCOPES = ['apps/', 'packages/', 'supabase/', 'scripts/', '.github/'];
const MARKER_SOURCES = /^\\b(TODO|FIXME|XXX|TBD)\\b$/;

/** JSX/TS prop names, CSS selectors and platform API names that contain the word but are not copy. */
const NON_COPY_PLACEHOLDER =
  /\bplaceholder(TextColor)?\s*[=:?]|::placeholder|\bplaceholder:[a-z-]|\bfunc\s+placeholder\(/g;

const STUB_CODE =
  /(lorem\s+ipsum|coming\s+soon|not\s+implemented|placeholder\s*(text|data|content)?|dummy\s+data)/iu;
const CATALOG_EN =
  /\b(coming\s+soon|not\s+implemented|placeholder|lorem\s+ipsum|TBD|future\s+(release|version|update))\b/iu;
const CATALOG_TR =
  /(yak[ıIiİ]nda|[çc]ok\s+yak[ıIiİ]nda|sonraki\s+s[üu]r[üu]m|ileride\s+eklenecek|gelecek\s+s[üu]r[üu]mde)/iu;
const CLAIMS =
  /(u[çc]tan\s+uca\s+[şs]ifrel|end[-\s]to[-\s]end\s+encrypt|kredi\s+kart[ıi]\s+gerekmez|no\s+credit\s+card|KVKK\s+ve\s+GDPR\s+uyumlu|reklamverenlere\s+sat|cihaz[ıi]nda\s+[öo]zetlenir)/iu;
/** R-15 copy: allowed only under the Android Notification Intelligence keys. */
const ON_DEVICE_ONLY = /yaln[ıi]zca\s+cihaz[ıi]nda\s+i[şs]lenir/iu;
const ANDROID_NI = /android_ni|androidNi|AndroidNi/;

/** "sınırsız"/"unlimited" are allowed only when negated (fair-use copy). */
const UNLIMITED = /\b(sınırsız|unlimited)\b/iu;
const NEGATION = /(değil|olmayan|yok|never|not|no\s|isn't|aren't|asla|hiçbir)/iu;

const PROTOTYPE =
  /Android Frame|Tasarım Sistemi|Widget Showcase|App Store Görseller|yunus@example\.com|14 gün kaldı|Çözüldü!/u;

function isCatalog(file: string): boolean {
  return (
    (file.startsWith('packages/i18n/') && file.endsWith('.json')) ||
    file.startsWith('apps/web/src/content/')
  );
}

const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|kt|kts|swift)$/;
/** §5.2 QG-02 scope for the stub-copy pattern (string literals and JSX text). */
const STUB_SCOPE = /^apps\/[^/]+\/(app|src)\/|^packages\/ui\/src\//;
const STRING = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
const COMMENT = /\/\/(.*)$|\/\*(.*?)(\*\/|$)|^\s*\*(.*)$/;
const JSX_TEXT = />([^<>{}]*\p{L}[^<>{}]*)</gu;

/** The copy-bearing parts of a code line: string literals and JSX text (and, separately, comments). */
function codeParts(line: string): { copy: string; comment: string } {
  const copy = [
    ...[...line.matchAll(STRING)].map((m) => m[1] ?? m[2] ?? m[3] ?? ''),
    ...[...line.matchAll(JSX_TEXT)].map((m) => m[1] ?? ''),
  ].join(' \u0000 ');
  const c = COMMENT.exec(line);
  return { copy, comment: c === null ? '' : (c[1] ?? c[2] ?? c[4] ?? '') };
}

const PLACEHOLDER_WORD = /^\\bplaceholder\\b$/;

export const copy: Check = {
  ids: ['QG-02', 'QG-03', 'QG-04', 'QG-06', 'QG-06b', 'QG-24'],
  title: 'Stub copy, banned copy and claims, unlimited claims, prototype fakes',
  run(ctx: Context): Finding[] {
    const shared = bannedList().filter((re) => !MARKER_SOURCES.test(re.source));
    // In code, "placeholder" is banned in copy only (comments describe props, CSS and templates).
    const sharedComment = shared.filter((re) => !PLACEHOLDER_WORD.test(re.source));
    const out: Finding[] = [];
    for (const file of ctx.select(SCOPES)) {
      const catalog = isCatalog(file);
      const code = CODE.test(file);
      const stubScope = code && STUB_SCOPE.test(file);
      ctx
        .read(file)
        .split('\n')
        .forEach((raw, i) => {
          if (allowed(file, raw)) return;
          const line = raw.replace(NON_COPY_PLACEHOLDER, '');
          const push = (id: string): void => {
            out.push({ id, file, line: i + 1, match: clip(raw) });
          };
          const onDeviceOnly = ON_DEVICE_ONLY.test(line) && !ANDROID_NI.test(file + line);
          let stub: boolean;
          if (code) {
            const parts = codeParts(line);
            stub =
              shared.some((re) => re.test(parts.copy)) ||
              sharedComment.some((re) => re.test(parts.comment)) ||
              (stubScope && STUB_CODE.test(parts.copy));
          } else stub = shared.some((re) => re.test(line));
          if (CLAIMS.test(line) || (catalog && onDeviceOnly)) push('QG-06');
          else if (catalog && CATALOG_TR.test(line)) push('QG-04');
          else if (catalog && (CATALOG_EN.test(line) || stub)) push('QG-03');
          else if (!catalog && stub) push('QG-02');
          else if (UNLIMITED.test(line) && !NEGATION.test(line)) push('QG-06b');
          else if (file.startsWith('apps/mobile/') && PROTOTYPE.test(raw)) push('QG-24');
        });
    }
    return out;
  },
};

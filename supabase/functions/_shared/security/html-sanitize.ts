/**
 * HTML sanitiser for "Orijinal Mail" and captured pages (SECURITY_AND_PRIVACY_PLAN CTL-3.10 §11,
 * IMPLEMENTATION_PLAN T-3.05). Built on `htmlparser2` with an allow-list:
 * - only structural and text tags survive; `script`, `style`, `iframe`, `object`, forms, `svg`,
 *   `math`, comments and hidden elements (`hidden`, `display:none`, `visibility:hidden`,
 *   `font-size:0`) are removed with their content;
 * - every attribute is dropped except `href` (rewritten) and `alt`/`title`/`colspan`/`rowspan`;
 * - images are never loaded by default: `img` becomes its `alt` text (remote images removed); with
 *   `allowRemoteImages` (API-MAIL-01 `remote_images=allowed`) an `https:` image keeps its `src` and
 *   `alt` only (`cid:`, `data:` and non-https sources are always dropped);
 * - links keep only `https:` / `mailto:` targets and are rewritten to `da-link:` placeholders with
 *   the target in `data-href`, which the app opens through `LinkConfirmSheet`;
 * - zero-width and bidi control characters are stripped from text.
 */
import { Parser } from 'htmlparser2';
import { isAllowedLinkScheme } from '@da/domain';

const ALLOWED_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'caption',
  'code',
  'dd',
  'del',
  'div',
  'dl',
  'dt',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'li',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
]);
const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'noscript',
  'template',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'option',
  'head',
  'title',
  'meta',
  'link',
  'base',
  'video',
  'audio',
  'source',
  'track',
  'canvas',
  'map',
  'picture',
]);
const VOID_TAGS = new Set([
  'br',
  'hr',
  'img',
  'input',
  'meta',
  'link',
  'source',
  'track',
  'wbr',
  'area',
  'base',
  'col',
  'embed',
  'param',
]);
const KEEP_ATTRS = new Set(['alt', 'title', 'colspan', 'rowspan']);
/** Tags that separate words in the plain-text projection. */
const BLOCK_TAGS = new Set([
  'blockquote',
  'br',
  'caption',
  'dd',
  'div',
  'dl',
  'dt',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
const HIDDEN_STYLE =
  /(display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?![.\d])|opacity\s*:\s*0(?![.\d]))/i;

export interface SanitizedHtml {
  readonly html: string;
  /** Visible text (for previews and AI input), whitespace-collapsed. */
  readonly text: string;
  readonly links: readonly { index: number; href: string }[];
  readonly removedImages: number;
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

export interface SanitizeOptions {
  readonly maxTextChars?: number;
  /** Keep `https:` image sources (the user chose to load remote images). */
  readonly allowRemoteImages?: boolean;
}

type Frame = { readonly tag: string; readonly kind: 'drop' | 'hidden' | 'emit' | 'skip' };

export function sanitizeHtml(input: string, options: SanitizeOptions = {}): SanitizedHtml {
  const out: string[] = [];
  const text: string[] = [];
  const links: { index: number; href: string }[] = [];
  const stack: Frame[] = [];
  let dropDepth = 0;
  let hiddenDepth = 0;
  let removedImages = 0;
  const maxText = options.maxTextChars ?? 50_000;
  let textLength = 0;

  const push = (tag: string, kind: Frame['kind']) => {
    if (VOID_TAGS.has(tag)) return;
    if (kind === 'drop') dropDepth++;
    if (kind === 'hidden') hiddenDepth++;
    stack.push({ tag, kind });
  };

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        const tag = name.toLowerCase();
        if (dropDepth > 0 || DROP_WITH_CONTENT.has(tag)) return push(tag, 'drop');
        const hidden =
          'hidden' in attrs ||
          HIDDEN_STYLE.test(attrs.style ?? '') ||
          attrs['aria-hidden'] === 'true';
        if (hiddenDepth > 0 || hidden) return push(tag, 'hidden');
        if (tag === 'img') {
          const src = (attrs.src ?? '').trim();
          if (options.allowRemoteImages === true && /^https:\/\/[^\s"'<>]+$/i.test(src)) {
            const alt = (attrs.alt ?? '').replace(INVISIBLE, '').trim();
            out.push(
              `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" referrerpolicy="no-referrer">`,
            );
            return;
          }
          removedImages++;
          const alt = (attrs.alt ?? '').replace(INVISIBLE, '').trim();
          if (alt !== '') {
            out.push(escapeText(alt));
            text.push(` ${alt} `);
          }
          return;
        }
        if (BLOCK_TAGS.has(tag)) text.push(' ');
        if (!ALLOWED_TAGS.has(tag)) return push(tag, 'skip');
        const kept: string[] = [];
        for (const [key, value] of Object.entries(attrs)) {
          const attr = key.toLowerCase();
          if (KEEP_ATTRS.has(attr))
            kept.push(` ${attr}="${escapeAttr(value.replace(INVISIBLE, ''))}"`);
        }
        if (tag === 'a') {
          const href = (attrs.href ?? '').trim();
          if (href !== '' && isAllowedLinkScheme(href)) {
            const index = links.length;
            links.push({ index, href });
            kept.push(
              ` href="da-link:${index}" data-href="${escapeAttr(href)}" rel="noopener noreferrer nofollow"`,
            );
          }
        }
        out.push(`<${tag}${kept.join('')}>`);
        push(tag, 'emit');
      },
      ontext(data) {
        if (dropDepth > 0 || hiddenDepth > 0) return;
        const clean = data.replace(INVISIBLE, '');
        if (clean === '') return;
        out.push(escapeText(clean));
        if (textLength < maxText) {
          text.push(clean);
          textLength += clean.length;
        }
      },
      onclosetag(name) {
        const tag = name.toLowerCase();
        if (VOID_TAGS.has(tag)) return;
        if (BLOCK_TAGS.has(tag) && dropDepth === 0 && hiddenDepth === 0) text.push(' ');
        let idx = -1;
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i]?.tag === tag) {
            idx = i;
            break;
          }
        }
        if (idx < 0) return;
        while (stack.length > idx) {
          const top = stack.pop();
          if (top === undefined) break;
          if (top.kind === 'drop') dropDepth--;
          else if (top.kind === 'hidden') hiddenDepth--;
          else if (top.kind === 'emit') out.push(`</${top.tag}>`);
        }
      },
    },
    {
      decodeEntities: true,
      lowerCaseTags: true,
      lowerCaseAttributeNames: true,
      recognizeSelfClosing: true,
    },
  );
  parser.write(input);
  parser.end();
  while (stack.length > 0) {
    const top = stack.pop();
    if (top?.kind === 'emit') out.push(`</${top.tag}>`);
  }
  return {
    html: out.join(''),
    text: text.join('').replace(/\s+/g, ' ').trim().slice(0, maxText),
    links,
    removedImages,
  };
}

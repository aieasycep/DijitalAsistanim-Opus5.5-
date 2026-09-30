/**
 * Kit-wide contracts:
 * 1. Every exported component has a fixture and renders in light and dark.
 * 2. Dark renders never use a hard-coded white surface (DESIGN_AUDIT §2.16 rule 2), except the
 *    allowed on-gradient contexts (play button, voice orb core, inverse CTA, mini player).
 * 3. Light and dark renders resolve different surface tokens (theme-aware).
 * 4. Every interactive host exposes an accessibility role and a label (or text).
 * 5. No component source contains a hex / rgb / hsl literal (the `da/no-raw-color` lint rule
 *    enforces it too).
 */
import { color } from '@da/design-tokens';
import { describe, expect, it } from '@jest/globals';
import { screen } from '@testing-library/react-native';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { TestInstance } from 'test-renderer';
import * as ui from '../src/index.ts';
import { iconComponents } from '../src/index.ts';
import { fixtures } from './fixtures.tsx';
import { allHosts, colorsIn, renderUi, styleOf } from './helpers.tsx';

const generatedIcons = new Set<unknown>(Object.values(iconComponents));

const exportedComponents = Object.entries(ui)
  .filter(([name, value]) => /^[A-Z][a-zA-Z]+$/.test(name) && typeof value === 'function')
  .filter(([, value]) => !generatedIcons.has(value))
  .map(([name]) => name)
  .sort();

describe('fixture coverage', () => {
  it('has a fixture for every exported component', () => {
    const missing = exportedComponents.filter((name) => !(name in fixtures));
    expect(missing).toEqual([]);
  });

  it('has no fixtures for names that are not exported', () => {
    const extra = Object.keys(fixtures).filter((name) => !exportedComponents.includes(name));
    expect(extra).toEqual([]);
  });

  it('covers a substantial kit', () => {
    expect(exportedComponents.length).toBeGreaterThan(150);
  });
});

const WHITE = new Set(['#FFFFFF', '#FFF', 'WHITE', 'RGB(255, 255, 255)', 'RGBA(255, 255, 255, 1)']);

/** testIDs whose subtree may legitimately paint white in dark (on-gradient contexts). */
const WHITE_ALLOWED_TEST_IDS = [
  'ui.iconButton.play',
  'ui.transportControls.play',
  'ui.miniPlayer',
  'ui.voiceOrb',
  'ui.button.inverse',
  'ui.fullPlayer',
  // Night-gradient-only visuals (played waveform bars, scrubber fill).
  'ui.waveform',
  'ui.scrubber',
];

function insideAllowed(host: TestInstance): boolean {
  let node: TestInstance | null = host;
  while (node !== null) {
    const id: unknown = node.props.testID;
    if (typeof id === 'string' && WHITE_ALLOWED_TEST_IDS.some((allowed) => id.startsWith(allowed)))
      return true;
    node = node.parent;
  }
  return false;
}

function whiteBackgrounds(root: TestInstance): string[] {
  const out: string[] = [];
  for (const host of allHosts(root)) {
    const bg = styleOf(host).backgroundColor;
    if (typeof bg === 'string' && WHITE.has(bg.trim().toUpperCase()) && !insideAllowed(host)) {
      out.push(describeHost(host));
    }
  }
  return out;
}

function describeHost(host: TestInstance): string {
  const id: unknown = host.props.testID;
  return `${host.type}#${typeof id === 'string' ? id : ''}`;
}

function interactiveWithoutA11y(root: TestInstance): string[] {
  const out: string[] = [];
  for (const host of allHosts(root)) {
    const interactive =
      typeof host.props.onClick === 'function' ||
      typeof host.props.onResponderRelease === 'function';
    if (!interactive) continue;
    if (host.type === 'RCTScrollView' || host.type === 'ScrollView') continue;
    const role: unknown = host.props.accessibilityRole ?? host.props.role;
    const label: unknown = host.props.accessibilityLabel;
    const hasText = allHosts(host).some(
      (h) => h.type === 'Text' && h.children.some((c) => typeof c === 'string' && c.trim() !== ''),
    );
    const hidden =
      host.props.importantForAccessibility === 'no-hide-descendants' ||
      host.props.accessible === false;
    if (hidden) continue;
    if (role === undefined || (label === undefined && !hasText)) {
      out.push(describeHost(host));
    }
  }
  return out;
}

describe.each(['light', 'dark'] as const)('every component in %s', (scheme) => {
  it.each(Object.keys(fixtures))('%s renders theme-aware and accessible', async (name) => {
    const fixture = fixtures[name];
    if (fixture === undefined) throw new Error(`No fixture for ${name}`);
    await renderUi(fixture(), { scheme });
    const root = screen.root;
    expect(root).toBeTruthy();
    if (root === null) return;
    expect(interactiveWithoutA11y(root)).toEqual([]);
    if (scheme === 'dark') expect(whiteBackgrounds(root)).toEqual([]);
  });
});

describe('light vs dark tokens', () => {
  it.each(['Card', 'Surface', 'ErrorCard', 'GroupedList', 'PriorityCard'])(
    '%s paints the scheme surface',
    async (name) => {
      const fixture = fixtures[name];
      if (fixture === undefined) throw new Error(name);
      await renderUi(fixture(), { scheme: 'light' });
      const light = screen.root === null ? [] : colorsIn(screen.root);
      expect(light).toContain(color.light.surface);
      expect(light).not.toContain(color.dark.surface);
      await renderUi(fixture(), { scheme: 'dark' });
      const dark = screen.root === null ? [] : colorsIn(screen.root);
      expect(dark).toContain(color.dark.surface);
      expect(dark).not.toContain(color.light.surface);
    },
  );
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'generated') continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe('no raw colours', () => {
  const COLOR =
    /(^|[^\w&])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgba?|hsla?)\(\s*\d/;
  const files = sourceFiles(join(__dirname, '..', 'src'));

  it('scans the kit sources', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(files.map((f) => [f.slice(f.indexOf('src')), f]))(
    '%s has no hex/rgb/hsl literal',
    (_label, file) => {
      const hits = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => COLOR.test(line));
      expect(hits).toEqual([]);
    },
  );
});

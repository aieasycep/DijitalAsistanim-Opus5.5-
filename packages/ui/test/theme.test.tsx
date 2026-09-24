import { color, fontFamily, shadowToCss, shadow, typography } from '@da/design-tokens';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { AccessibilityInfo, Platform, Text as RNText, StyleSheet } from 'react-native';
import {
  hapticKindFor,
  hitSlopFor,
  makeStyles,
  minTouchTarget,
  motionControl,
  REQUIRED_FONT_FAMILIES,
  REQUIRED_FONTS,
  resolveScheme,
  Text,
  textStyleFor,
  themes,
  ThemeProvider,
  UiPreferencesProvider,
  useHaptic,
  useMotion,
  useTheme,
  useThemePreference,
  useUiPreferences,
  useUiStrings,
  type HapticKind,
} from '../src/index.ts';
import { renderUi, styleOf } from './helpers.tsx';

const require = createRequire(__filename);

function SchemeProbe(): React.JSX.Element {
  const theme = useTheme();
  return <RNText testID="probe">{`${theme.scheme}:${theme.color.surface}`}</RNText>;
}

describe('ThemeProvider', () => {
  it('resolves system, light and dark preferences', () => {
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', 'light')).toBe('light');
    expect(resolveScheme('system', null)).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
    expect(resolveScheme('light', 'dark')).toBe('light');
  });

  it('follows the system scheme and lets an explicit preference override it', async () => {
    await render(
      <ThemeProvider preference="system" systemScheme="dark">
        <SchemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent(`dark:${color.dark.surface}`);
    await render(
      <ThemeProvider preference="light" systemScheme="dark">
        <SchemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent(`light:${color.light.surface}`);
  });

  it('reads the OS appearance when no override is given (jest: light)', async () => {
    await render(
      <ThemeProvider>
        <SchemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent(`light:${color.light.surface}`);
  });

  it('defaults to the light theme outside a provider', async () => {
    await render(<SchemeProbe />);
    expect(screen.getByTestId('probe')).toHaveTextContent(/^light:/);
  });

  it('exposes the preference setter to the Appearance screen', async () => {
    const onChange = jest.fn();
    function Control(): React.JSX.Element {
      const { preference, scheme, setPreference } = useThemePreference();
      return (
        <RNText testID="ctl" onPress={() => setPreference?.('dark')}>
          {`${preference}/${scheme}`}
        </RNText>
      );
    }
    await render(
      <ThemeProvider preference="system" onPreferenceChange={onChange} systemScheme="light">
        <Control />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('ctl')).toHaveTextContent('system/light');
    await fireEvent.press(screen.getByTestId('ctl'));
    expect(onChange).toHaveBeenCalledWith('dark');
  });
});

describe('theme objects', () => {
  it('uses drop shadows in light and the 6% hairline ring in dark', () => {
    expect(themes.light.elevation('card')).toEqual({ boxShadow: shadowToCss(shadow.light.card) });
    const ring = themes.dark.elevation('card');
    expect(ring).toEqual({ boxShadow: shadowToCss(shadow.dark.card) });
    expect(ring.boxShadow).toMatch(/^0 0 0 1px /);
    expect(themes.dark.elevation('sheet')).toEqual({});
  });

  it('maps the tone API with critical text-strong', () => {
    expect(themes.light.tone.critical.text).toBe(color.light.tone.critical.textStrong);
    expect(themes.dark.tone.primary.soft).toBe(color.dark.tone.primary.soft);
  });
});

describe('makeStyles', () => {
  const useStyles = makeStyles((theme) => ({
    box: { backgroundColor: theme.color.surface, padding: theme.space[4] },
  }));
  function Box(): React.JSX.Element {
    const styles = useStyles();
    return (
      <RNText testID="box" style={styles.box}>
        {'x'}
      </RNText>
    );
  }

  it('builds one sheet per scheme and reuses it', async () => {
    const seen: unknown[] = [];
    function Capture(): React.JSX.Element {
      seen.push(useStyles());
      return <RNText>{'c'}</RNText>;
    }
    await renderUi(
      <>
        <Capture />
        <Capture />
      </>,
    );
    expect(seen[0]).toBe(seen[1]);
    await renderUi(<Box />, { scheme: 'dark' });
    expect(styleOf(screen.getByTestId('box')).backgroundColor).toBe(color.dark.surface);
    await renderUi(<Box />, { scheme: 'light' });
    expect(styleOf(screen.getByTestId('box')).backgroundColor).toBe(color.light.surface);
  });
});

describe('fonts contract', () => {
  function exportsOf(pkg: string): string {
    const entry = require.resolve(pkg);
    return readFileSync(entry.replace(/index\.js$/, 'index.d.ts'), 'utf8');
  }

  it('lists every family the type scale can resolve to', () => {
    for (const token of Object.values(typography)) {
      if (token.family === 'mono') continue;
      expect(REQUIRED_FONT_FAMILIES).toContain(textStyleFor(token).fontFamily);
    }
    expect(REQUIRED_FONT_FAMILIES).toContain(fontFamily.serif['400italic']);
  });

  it('maps each required family to an export of its @expo-google-fonts package', () => {
    for (const [family, pkg] of Object.entries(REQUIRED_FONTS)) {
      expect(exportsOf(pkg)).toContain(`export const ${family}: number;`);
    }
  });

  it('uses per-weight families, tracking in points and tabular numerals', () => {
    const kicker = textStyleFor(typography.kicker);
    expect(kicker.fontFamily).toBe('Geist_600SemiBold');
    expect(kicker.letterSpacing).toBeCloseTo(0.96);
    expect(textStyleFor(typography.numericXl).fontVariant).toEqual(['tabular-nums']);
    expect(textStyleFor(typography.editorialQuote)).toMatchObject({
      fontFamily: 'Lora_400Regular_Italic',
      fontStyle: 'italic',
    });
    expect(textStyleFor(typography.body).fontWeight).toBeUndefined();
  });

  it('removes Android font padding', () => {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    try {
      expect(textStyleFor(typography.body)).toMatchObject({
        includeFontPadding: false,
        textAlignVertical: 'center',
      });
    } finally {
      Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
    }
  });
});

describe('Text', () => {
  it('applies Dynamic Type caps and the token style', async () => {
    await renderUi(<Text variant="h1">Başlık</Text>);
    const text = screen.getByText('Başlık');
    expect(text).toHaveProp('allowFontScaling', true);
    expect(text).toHaveProp('maxFontSizeMultiplier', typography.h1.maxScale);
    expect(styleOf(text)).toMatchObject({
      fontSize: 28,
      lineHeight: 34,
      color: color.light.text.primary,
    });
  });

  it('upper-cases kickers with Turkish rules and never uses textTransform', async () => {
    await renderUi(<Text variant="kicker">samimi · işlem</Text>);
    const text = screen.getByText('SAMİMİ · İŞLEM');
    expect(styleOf(text).textTransform).toBeUndefined();
    await renderUi(<Text variant="kicker">simple items</Text>, { locale: 'en' });
    expect(screen.getByText('SIMPLE ITEMS')).toBeOnTheScreen();
  });

  it('marks headings for screen readers', async () => {
    await renderUi(
      <Text heading variant="h2">
        Neden önemli?
      </Text>,
    );
    expect(screen.getByRole('header', { name: 'Neden önemli?' })).toBeOnTheScreen();
  });

  it('resolves tones per scheme', async () => {
    await renderUi(<Text tone="tertiaryStrong">meta</Text>, { scheme: 'dark' });
    expect(styleOf(screen.getByText('meta')).color).toBe(color.dark.text.tertiaryStrong);
    await renderUi(<Text tone="critical">hata</Text>);
    expect(styleOf(screen.getByText('hata')).color).toBe(color.light.tone.critical.textStrong);
  });

  it('supports numeric, strike-through and alignment', async () => {
    await renderUi(
      <Text numeric strike align="center">
        08:42
      </Text>,
    );
    expect(styleOf(screen.getByText('08:42'))).toMatchObject({
      fontVariant: ['tabular-nums'],
      textDecorationLine: 'line-through',
      textAlign: 'center',
    });
  });
});

describe('hit targets', () => {
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  });

  it('grows controls to 44 pt on iOS and 48 dp on Android', () => {
    expect(minTouchTarget()).toBe(44);
    expect(hitSlopFor(36, 36)).toEqual({ top: 4, bottom: 4, left: 4, right: 4 });
    expect(hitSlopFor(50, 52)).toBeUndefined();
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    expect(minTouchTarget()).toBe(48);
    expect(hitSlopFor(36, 36)).toEqual({ top: 6, bottom: 6, left: 6, right: 6 });
  });
});

describe('haptics', () => {
  it('maps product events to kinds', () => {
    expect(hapticKindFor('complete')).toBe('success');
    expect(hapticKindFor('select')).toBe('selection');
    expect(hapticKindFor('conflict')).toBe('warning');
    expect(hapticKindFor('sheetOpen')).toBe('light');
  });

  function Trigger({
    event,
  }: {
    readonly event: Parameters<ReturnType<typeof useHaptic>>[0];
  }): React.JSX.Element {
    const haptic = useHaptic();
    return (
      <RNText
        testID="t"
        onPress={() => {
          haptic(event);
        }}
      >
        {'t'}
      </RNText>
    );
  }

  it('calls the injected implementation and honours the setting', async () => {
    const onHaptic = jest.fn<(kind: HapticKind) => void>();
    await renderUi(<Trigger event="approveExecuted" />, { onHaptic });
    await fireEvent.press(screen.getByTestId('t'));
    expect(onHaptic).toHaveBeenCalledWith('success');
    onHaptic.mockClear();
    await renderUi(<Trigger event="select" />, { onHaptic, hapticsEnabled: false });
    await fireEvent.press(screen.getByTestId('t'));
    expect(onHaptic).not.toHaveBeenCalled();
  });

  it('swallows a throwing implementation', async () => {
    await renderUi(<Trigger event="light" />, {
      onHaptic: () => {
        throw new Error('native module missing');
      },
    });
    await fireEvent.press(screen.getByTestId('t'));
    expect(screen.getByTestId('t')).toBeOnTheScreen();
  });
});

describe('motion', () => {
  it('zeroes movement and keeps a 120 ms fade under reduce motion', () => {
    const on = motionControl(false);
    const reduced = motionControl(true);
    expect(on.duration(300)).toBe(300);
    expect(on.duration(900)).toBe(600);
    expect(reduced.duration(300)).toBe(0);
    expect(reduced.fadeDuration(300)).toBe(120);
    expect(reduced.loops).toBe(false);
    expect(reduced.animate(1, 300)).toBe(1);
    expect(reduced.timing(300).duration).toBe(0);
  });

  it('combines the OS setting with the user setting', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    function Probe(): React.JSX.Element {
      const { reduceMotion } = useMotion();
      return <RNText testID="rm">{String(reduceMotion)}</RNText>;
    }
    await render(
      <UiPreferencesProvider screenReaderEnabled={false} reduceTransparency={false}>
        <Probe />
      </UiPreferencesProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('rm')).toHaveTextContent('true');
    await render(
      <UiPreferencesProvider
        followSystemReduceMotion={false}
        screenReaderEnabled={false}
        reduceTransparency={false}
      >
        <Probe />
      </UiPreferencesProvider>,
    );
    expect(screen.getByTestId('rm')).toHaveTextContent('false');
    await render(
      <UiPreferencesProvider
        reduceMotion
        followSystemReduceMotion={false}
        screenReaderEnabled={false}
        reduceTransparency={false}
      >
        <Probe />
      </UiPreferencesProvider>,
    );
    expect(screen.getByTestId('rm')).toHaveTextContent('true');
    spy.mockResolvedValue(false);
  });

  it('reads the screen reader state from AccessibilityInfo', async () => {
    const spy = jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    function Probe(): React.JSX.Element {
      const { screenReaderEnabled } = useUiPreferences();
      return <RNText testID="sr">{String(screenReaderEnabled)}</RNText>;
    }
    await render(
      <UiPreferencesProvider>
        <Probe />
      </UiPreferencesProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('sr')).toHaveTextContent('true');
    spy.mockResolvedValue(false);
  });
});

describe('strings', () => {
  it('serves the common namespace of the active locale', async () => {
    function Probe(): React.JSX.Element {
      const strings = useUiStrings();
      return <RNText testID="s">{strings.actions.back}</RNText>;
    }
    await renderUi(<Probe />);
    expect(screen.getByTestId('s')).toHaveTextContent('Geri');
    await renderUi(<Probe />, { locale: 'en' });
    expect(screen.getByTestId('s')).toHaveTextContent('Back');
  });
});

describe('StyleSheet usage', () => {
  it('keeps theme objects stable', () => {
    expect(themes.light).toBe(themes.light);
    expect(StyleSheet.flatten([themes.light.elevation('s1')])).toHaveProperty('boxShadow');
  });
});

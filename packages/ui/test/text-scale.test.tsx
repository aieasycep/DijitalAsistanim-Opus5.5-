/**
 * M-SET-61 text-size multiplier: `Text` scales the token by the app multiplier and lowers its
 * Dynamic Type cap so the total (multiplier × OS scale) stays within the token's `maxScale` (≤ 2).
 */
import { typography } from '@da/design-tokens';
import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { MAX_TOTAL_FONT_SCALE, Text, UiPreferencesProvider, scaledType } from '../src/index.ts';
import { styleOf } from './helpers.tsx';

function renderScaled(textScale: number | undefined, variant: 'body' | 'tabLabel' = 'body') {
  return render(
    <UiPreferencesProvider
      followSystemReduceMotion={false}
      screenReaderEnabled={false}
      reduceTransparency={false}
      {...(textScale === undefined ? {} : { textScale })}
    >
      <Text variant={variant} testID="sample">
        Bugün bilmen gereken 5 şey var.
      </Text>
    </UiPreferencesProvider>,
  );
}

describe('text scale', () => {
  it('keeps the token size and cap without a multiplier', async () => {
    await renderScaled(undefined);
    const text = screen.getByTestId('sample');
    expect(styleOf(text).fontSize).toBe(typography.body.size);
    expect(text.props.maxFontSizeMultiplier).toBe(typography.body.maxScale);
    expect(text.props.allowFontScaling).toBe(true);
  });

  it('multiplies size and line height and caps the total at the token maximum', async () => {
    await renderScaled(1.3);
    const text = screen.getByTestId('sample');
    const style = styleOf(text);
    expect(style.fontSize).toBeCloseTo(typography.body.size * 1.3);
    expect(style.lineHeight).toBeCloseTo(typography.body.lineHeight * 1.3);
    const cap = text.props.maxFontSizeMultiplier as number;
    expect(1.3 * cap).toBeCloseTo(Math.min(typography.body.maxScale, MAX_TOTAL_FONT_SCALE));
  });

  it('never lets a small-cap token exceed its maximum', async () => {
    await renderScaled(1.3, 'tabLabel');
    const text = screen.getByTestId('sample');
    expect(styleOf(text).fontSize).toBeCloseTo(
      typography.tabLabel.size * typography.tabLabel.maxScale,
    );
    expect(text.props.maxFontSizeMultiplier).toBe(1);
  });

  it('lets a smaller multiplier keep the whole Dynamic Type range', () => {
    const { factor, maxFontSizeMultiplier } = scaledType(2, 0.9);
    expect(factor).toBe(0.9);
    expect(factor * maxFontSizeMultiplier).toBeCloseTo(2);
  });
});

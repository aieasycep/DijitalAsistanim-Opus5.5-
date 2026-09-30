import { color, size } from '@da/design-tokens';
import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import { Icon, IconAutoAwesome, IconStarShine, ICON_NAMES, iconComponents } from '../src/index.ts';

const ink = color.light.text.primary;

describe('<Icon />', () => {
  it('announces a labelled icon as an image with its accessibility label', async () => {
    await render(<Icon name="sunny" color={ink} accessibilityLabel="Bugün" />);
    const icon = screen.getByLabelText('Bugün');
    expect(icon).toBeOnTheScreen();
    expect(icon).toHaveProp('accessibilityLabel', 'Bugün');
    expect(icon).toHaveProp('accessibilityRole', 'image');
    expect(screen.getByRole('image', { name: 'Bugün' })).toBe(icon);
  });

  it('hides a decorative icon (no label) from assistive technology', async () => {
    await render(<Icon name="mail" color={ink} testID="decorative" />);
    expect(screen.queryByTestId('decorative')).toBeNull();
    const icon = screen.getByTestId('decorative', { includeHiddenElements: true });
    expect(icon).toHaveProp('accessibilityElementsHidden', true);
    expect(icon).toHaveProp('importantForAccessibility', 'no-hide-descendants');
    expect(icon).toHaveProp('accessible', false);
    expect(screen.queryByRole('image', { includeHiddenElements: true })).toBeNull();
  });

  it('treats an empty label as decorative', async () => {
    await render(<Icon name="close" color={ink} accessibilityLabel="" testID="empty" />);
    expect(screen.queryByTestId('empty')).toBeNull();
  });

  it('defaults to the 20 pt token size and honours an explicit size', async () => {
    await render(<Icon name="flag" color={ink} accessibilityLabel="Son tarih" />);
    expect(screen.getByLabelText('Son tarih')).toHaveProp('width', size.icon.default);
    await render(<Icon name="flag" color={ink} size={26} accessibilityLabel="Son tarih" />);
    expect(screen.getByLabelText('Son tarih')).toHaveProp('height', 26);
  });

  it('renders different paths for the outline and FILL 1 variants', async () => {
    await render(<Icon name="check_circle" color={ink} testID="outline" />);
    const outline = JSON.stringify(screen.toJSON());
    await render(<Icon name="check_circle" color={ink} filled testID="outline" />);
    const filled = JSON.stringify(screen.toJSON());
    expect(filled).not.toBe(outline);
  });
});

describe('icon registry', () => {
  it('maps every name to a component', () => {
    for (const name of ICON_NAMES) expect(typeof iconComponents[name]).toBe('function');
  });

  it('exports the upstream name of aliased icons (auto_awesome → star_shine)', () => {
    expect(IconStarShine).toBe(IconAutoAwesome);
    expect(iconComponents.auto_awesome).toBe(IconAutoAwesome);
  });
});

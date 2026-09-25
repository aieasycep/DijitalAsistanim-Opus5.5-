/**
 * T-8.29 acceptance "The accessibility test suite passes for every route": every pattern in
 * `SCREEN_ROUTES` is opened in the real app (router, guards, providers, the recorded API client and
 * the PostgREST double with empty data) in the dark theme, and the rendered screen is checked:
 * - every pressable has an accessibility role and a label (or visible text);
 * - declared hit targets reach 44 pt with the kit's `hitSlop` / `minHeight`;
 * - the screen marks at least one heading (`accessibilityRole="header"`);
 * - no text opts out of Dynamic Type outside the kit's fixed-size share card;
 * - images are labelled or hidden from assistive technology;
 * - nothing paints white or a light-only colour token (tokens are the only colour source).
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen } from 'expo-router/testing-library';

import { DEMO_ONLY_ROUTES, SCREEN_ROUTES } from '../../src/lib/deeplinks';
import { resetAppState } from '../helpers/app';
import { a11yReport, lightColoursInDark, openRoute } from './harness';

// A dark-mode user: the OS is dark too (the launch screen mirrors the native splash, which only
// follows the OS appearance).
jest.mock('../../src/lib/useSchemeName', () => ({ useSchemeName: () => 'dark' }));

const ROUTES = SCREEN_ROUTES.filter((pattern) => !DEMO_ONLY_ROUTES.includes(pattern));

beforeEach(async () => {
  await resetAppState();
});

describe('every screen route (T-8.29)', () => {
  it('covers every route with a screen', () => {
    expect(ROUTES.length).toBe(SCREEN_ROUTES.length - DEMO_ONLY_ROUTES.length);
    expect(ROUTES.length).toBeGreaterThan(75);
  });

  it.each(ROUTES)('%s is accessible and dark-safe', async (pattern) => {
    await openRoute(pattern);
    const root = screen.root;
    expect(root).toBeTruthy();
    if (root === null) return;
    const report = a11yReport(root);
    expect({ pattern, unlabeled: report.unlabeled }).toEqual({ pattern, unlabeled: [] });
    expect({ pattern, smallTargets: report.smallTargets }).toEqual({ pattern, smallTargets: [] });
    expect({ pattern, fixed: report.fixedFontScaling }).toEqual({ pattern, fixed: [] });
    expect({ pattern, images: report.unlabeledImages }).toEqual({ pattern, images: [] });
    expect({ pattern, hasHeader: report.headers > 0 }).toEqual({ pattern, hasHeader: true });
    expect({ pattern, light: lightColoursInDark(root) }).toEqual({ pattern, light: [] });
  });
});

# @da/ui

The React Native UI kit of Dijital Asistan (mobile only; peers `react` 19.2.3, `react-native`
0.86.3, `react-native-svg` 15.15.4). It holds the package skeleton and the Material Symbols icon
code generation (WBS task T-1.03); the step-8 mobile tasks of `docs/IMPLEMENTATION_PLAN.md` add the
UI components.

## Icons

```tsx
import { color } from '@da/design-tokens';
import { Icon } from '@da/ui';

const theme = color.light; // the resolved scheme (ThemeProvider in the mobile app)

<Icon name="sunny" filled size={26} color={theme.tabBar.active} accessibilityLabel="Bugün" />;
<Icon name="chevron_right" color={theme.icon.chevron} />; // decorative: hidden from a11y
```

- `name` is the typed `IconName` union of every manifest icon.
- `filled` selects the FILL 1 variant (active tab, AI marker in kickers, done `check_circle`, VIP
  `star`, play/pause, selected radio — DESIGN_AUDIT §2.12.1).
- `size` defaults to 20 pt (`size.icon.default`).
- `color` is required: pass a semantic colour for the current scheme.
- With `accessibilityLabel` the icon is announced as an image; without one it is decorative
  (`accessible={false}`, `accessibilityElementsHidden`, `importantForAccessibility="no-hide-descendants"`).
  Icon-only controls put their label on the pressable instead.

### Manifest and code generation

`icons.manifest.json` is the single list of shipped icons:

| Group         | Source                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------- |
| `design`      | `design/icons/used-icons.txt` (PRIMARY canvases) minus `excluded`                        |
| `screenMap`   | Icons named in `docs/SCREEN_AND_FLOW_MAP.md` that the canvases do not use                |
| `designAudit` | Production-only icons listed in `docs/DESIGN_AUDIT.md` §2.12.2 (mobile, web, backoffice) |

- **`aliases`** map a design name that `@material-symbols/svg-400@0.47.5` does not contain to an
  equivalent glyph, with the reason: `auto_awesome` → `star_shine`, `expand_more` →
  `keyboard_arrow_down`, `expand_less` → `keyboard_arrow_up`, `remove_circle` →
  `do_not_disturb_on`, `screenshot` → `screenshot_frame`, `vibration` → `mobile_vibrate` (all from
  DESIGN_AUDIT §2.12.3), plus `phonelink` → `devices` and `system_update` → `mobile_arrow_down`
  (named in the screen map, renamed upstream). The generated registry also exports the upstream
  component names (`IconStarShine` is `IconAutoAwesome`).
- **`excluded`** lists extracted names that never ship, with the reason: `ios` (the official Sign in
  with Apple button replaces it) and the motion-table label glyphs `swipe`, `unfold_more`,
  `vertical_align_top`.

`pnpm --filter @da/ui icons` (also run by `pnpm generate`) executes `node scripts/gen-icons.ts`,
which resolves every name to `rounded/{source}.svg` and `rounded/{source}-fill.svg` and fails with
the full list of unresolved names if any is missing, if the SVG is not a single path, or if the
manifest no longer accounts for every name in `design/icons/used-icons.txt`. It writes:

- `src/icons/generated/<Name>.tsx` — one react-native-svg component per manifest icon;
- `src/icons/generated/index.ts` — `ICON_NAMES`, `IconName`, `iconComponents`;
- `icons.data.json` — framework-neutral data (below).

Only manifest icons are emitted; stale files are removed. The output is sorted and deterministic,
and it is committed (CI fails on drift).

### `icons.data.json` (web and backoffice)

The Next.js apps do not exist yet, so the DOM icon components are not generated here. Instead the
generator writes one data file that the web and backoffice icon generators consume later (they emit
`<svg>` components using `currentColor`, `aria-hidden` unless a label is passed):

```json
{
  "package": "@material-symbols/svg-400",
  "version": "0.47.5",
  "style": "rounded",
  "license": "Apache-2.0",
  "icons": {
    "sunny": { "source": "sunny", "viewBox": "0 -960 960 960", "regular": "M…Z", "fill": "M…Z" }
  }
}
```

`regular` is the FILL 0 path data and `fill` the FILL 1 path data of the same `viewBox`. It is
exported as `@da/ui/icons.data.json`. Material Symbols is Apache-2.0; the notice belongs on the
in-app licences screen and the web licences page.

## Tests

`pnpm --filter @da/ui test` runs Jest with `@react-native/jest-preset`, React Native Testing
Library 14 and `test-renderer` against the real react-native-svg host components: the
accessibility label is applied (`getByRole('image', { name })`), unlabelled icons are hidden,
the size default and FILL variant work, every manifest name resolves, the emitted component count
equals the manifest size, and two generator runs are byte-identical to the committed output.

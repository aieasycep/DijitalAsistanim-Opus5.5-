/**
 * @da/ui — the React Native UI kit of Dijital Asistan (mobile only; web and backoffice use their
 * own DOM components fed by `icons.data.json` and `@da/design-tokens/tokens.css`).
 *
 * Plain StyleSheet + typed `useTheme()` tokens (ADR-03), React Compiler-safe, accessibility built
 * into the primitives, Reanimated 4 motion that honours reduce motion, injected haptics.
 */
export * from './icons/index.ts';

// Theme foundation
export * from './theme/theme.ts';
export * from './theme/ThemeProvider.tsx';
export * from './theme/makeStyles.ts';
export * from './theme/fonts.ts';
export * from './theme/haptics.ts';
export * from './theme/preferences.tsx';
export * from './theme/a11y.ts';
export * from './theme/DaUiProvider.tsx';

// Primitives
export * from './primitives/Text.tsx';
export * from './primitives/PressableScale.tsx';
export * from './primitives/Surface.tsx';
export * from './primitives/GradientFill.tsx';
export * from './primitives/IconTile.tsx';
export * from './primitives/Spinner.tsx';
export * from './primitives/Skeleton.tsx';
export * from './primitives/useLoop.ts';
export * from './primitives/useSelectionBackground.ts';
export * from './primitives/useExitAnimation.ts';

// Components
export * from './components/buttons/Button.tsx';
export * from './components/buttons/IconButton.tsx';
export * from './components/buttons/ActionButtons.tsx';
export * from './components/buttons/Aliases.tsx';
export * from './components/badges/Badge.tsx';
export * from './components/chips/Chips.tsx';
export * from './components/chips/CountdownPill.tsx';
export * from './components/avatar/Avatar.tsx';
export * from './components/navigation/Headers.tsx';
export * from './components/navigation/TabBar.tsx';
export * from './components/lists/Lists.tsx';
export * from './components/lists/SwipeableRow.tsx';
export * from './components/inputs/Controls.tsx';
export * from './components/inputs/TextInputs.tsx';
export * from './components/inputs/Selection.tsx';
export * from './components/provenance/Provenance.tsx';
export * from './components/cards/shared.tsx';
export * from './components/cards/FeedCards.tsx';
export * from './components/cards/AiCards.tsx';
export * from './components/cards/PeopleCards.tsx';
export * from './components/cards/PlanCards.tsx';
export * from './components/cards/ApprovalCard.tsx';
export * from './components/cards/SenderHeader.tsx';
export * from './components/audio/Audio.tsx';
export * from './components/audio/Voice.tsx';
export * from './components/plan/Plan.tsx';
export * from './components/capture/Capture.tsx';
export * from './components/account/Account.tsx';
export * from './components/editorial/Editorial.tsx';

// Overlays
export * from './overlays/BottomSheet.tsx';
export * from './overlays/Dialogs.tsx';
export * from './overlays/Toast.tsx';
export * from './overlays/InAppBanner.tsx';
export * from './overlays/useBackHandler.ts';

// Global states (M-STATE-01…12)
export * from './states/ErrorCard.tsx';
export * from './states/StateCards.tsx';
export * from './states/StateBlocks.tsx';
export * from './states/Loading.tsx';

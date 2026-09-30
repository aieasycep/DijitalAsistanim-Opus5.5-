/**
 * `makeStyles(theme => ({…}))` returns a `useStyles()` hook whose StyleSheet is built once per
 * colour scheme, when the module loads, and then shared by every instance. Nothing is created or
 * mutated during render, which keeps it React Compiler-safe; switching the scheme swaps between
 * the two prebuilt sheets.
 */
import { StyleSheet } from 'react-native';
import { useTheme } from './ThemeProvider.tsx';
import { themes, type Theme } from './theme.ts';

type NamedStyles<T> = StyleSheet.NamedStyles<T>;

export function makeStyles<T extends NamedStyles<T>>(factory: (theme: Theme) => T): () => T {
  const byScheme = {
    light: StyleSheet.create(factory(themes.light)),
    dark: StyleSheet.create(factory(themes.dark)),
  } as const;
  return function useStyles(): T {
    return byScheme[useTheme().scheme];
  };
}

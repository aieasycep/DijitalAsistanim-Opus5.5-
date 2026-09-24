/**
 * Official third-party sign-in marks (P/02 note: "Brand marks use official assets"). Google's "G"
 * and Microsoft's four squares must keep the vendors' exact colours (their brand guidelines forbid
 * recolouring), so this file is the one place outside `@da/design-tokens` allowed to hold raw
 * colours (`apps/mobile/eslint.config.mjs`). The Apple mark is monochrome and follows the theme's
 * text colour; on iOS the native `AppleAuthenticationButton` draws Apple's own mark instead.
 * The marks are decorative: every button carries its visible label.
 */
import { useTheme } from '@da/ui';
import Svg, { Path } from 'react-native-svg';

const SIZE = 20;

export function GoogleMark() {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 48 48" accessible={false}>
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

export function MicrosoftMark() {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 21 21" accessible={false}>
      <Path fill="#F25022" d="M1 1h9v9H1z" />
      <Path fill="#7FBA00" d="M11 1h9v9h-9z" />
      <Path fill="#00A4EF" d="M1 11h9v9H1z" />
      <Path fill="#FFB900" d="M11 11h9v9h-9z" />
    </Svg>
  );
}

export function AppleMark() {
  const theme = useTheme();
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24" accessible={false}>
      <Path
        fill={theme.color.text.primary}
        d="M16.37 1.43c0 1.14-.42 2.2-1.13 3.03-.85.99-1.99 1.56-3.1 1.47-.14-1.1.41-2.26 1.1-3.03.78-.87 2.07-1.52 3.13-1.47zM20.5 17.3c-.55 1.27-.81 1.84-1.52 2.96-.99 1.56-2.39 3.5-4.12 3.51-1.54.02-1.94-1-4.03-.99-2.09.01-2.53 1.01-4.07.99-1.73-.02-3.05-1.77-4.04-3.33C-.05 16.07-.34 11.02 1.4 8.35c1.24-1.9 3.19-3.01 5.03-3.01 1.87 0 3.05 1.03 4.59 1.03 1.5 0 2.42-1.03 4.58-1.03 1.64 0 3.38.89 4.61 2.43-4.05 2.22-3.39 8.01.29 9.53z"
      />
    </Svg>
  );
}

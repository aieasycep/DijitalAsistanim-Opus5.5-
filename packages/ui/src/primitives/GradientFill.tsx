/**
 * Absolute gradient fill drawn with react-native-svg (DESIGN_AUDIT §2.6). Linear gradients keep
 * the CSS angle for the measured aspect ratio (`cssAngleToPoints`); radial gradients reproduce
 * `radial-gradient(140% 100% at <corner>, …)` for the AI glow. `experimental_backgroundImage` is
 * not used (DEV-57).
 */
import {
  cssAngleToPoints,
  type GradientToken,
  type LinearGradientToken,
  type RadialGradientToken,
} from '@da/design-tokens';
import { useId, useState, type JSX } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { hiddenFromA11y } from '../theme/a11y.ts';

export interface GradientFillProps {
  readonly gradient: GradientToken;
  /** Corner radius of the fill (matches the container). */
  readonly radius?: number;
  readonly testID?: string;
}

function svgId(raw: string): string {
  return `g${raw.replace(/[^a-zA-Z0-9]/g, '')}`;
}

function pct(n: number): string {
  return `${String(Math.round(n * 10000) / 100)}%`;
}

/**
 * Stops are rendered inline (react-native-svg reads `<Stop>` props from the gradient's direct
 * children, so they cannot be wrapped in a component).
 */
function stops(token: LinearGradientToken | RadialGradientToken): JSX.Element[] {
  return token.stops.map((s) => (
    <Stop key={`${s.color}-${String(s.at)}`} offset={s.at} stopColor={s.color} />
  ));
}

export function GradientFill({ gradient, radius = 0, testID }: GradientFillProps): JSX.Element {
  const id = svgId(useId());
  const [box, setBox] = useState({ width: 1, height: 1 });
  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0 && (width !== box.width || height !== box.height)) {
      setBox({ width, height });
    }
  };
  let definition: JSX.Element;
  if (gradient.kind === 'linear') {
    const points = cssAngleToPoints(gradient.angle, box.width, box.height);
    definition = (
      <LinearGradient
        id={id}
        x1={points.start.x}
        y1={points.start.y}
        x2={points.end.x}
        y2={points.end.y}
      >
        {stops(gradient)}
      </LinearGradient>
    );
  } else {
    definition = (
      <RadialGradient
        id={id}
        cx={pct(gradient.center.x)}
        cy={pct(gradient.center.y)}
        fx={pct(gradient.center.x)}
        fy={pct(gradient.center.y)}
        rx={pct(gradient.radius.x)}
        ry={pct(gradient.radius.y)}
      >
        {stops(gradient)}
      </RadialGradient>
    );
  }
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={onLayout}
      testID={testID}
      {...hiddenFromA11y}
    >
      <Svg width="100%" height="100%">
        <Defs>{definition}</Defs>
        <Rect width="100%" height="100%" rx={radius} ry={radius} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

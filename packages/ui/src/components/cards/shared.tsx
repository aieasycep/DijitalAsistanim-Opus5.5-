/**
 * Shared card plumbing: the action model (≤ 2 visible text actions per card — "en fazla 2
 * aksiyon"), and the screen-reader custom actions that mirror every card control and gesture, so
 * a card that is one accessible element still exposes complete / snooze / dismiss / why / more and
 * its text actions (DESIGN_AUDIT §3.0, §3.6).
 */
import type { JSX } from 'react';
import type { AccessibilityActionEvent, AccessibilityActionInfo } from 'react-native';
import type { IconName } from '../../icons/generated/index.ts';
import { CardActions, TextAction } from '../buttons/ActionButtons.tsx';

export interface CardAction {
  readonly key: string;
  readonly label: string;
  readonly onPress: () => void;
  readonly emphasis?: 'primary' | 'secondary';
  readonly icon?: IconName;
  readonly loading?: boolean;
  readonly loadingLabel?: string;
  readonly disabled?: boolean;
}

/** A screen-reader-only action (gesture equivalents such as swipe verbs). */
export interface A11yAction {
  readonly key: string;
  readonly label: string;
  readonly onPress: () => void;
}

export interface CardA11y {
  readonly accessibilityActions: AccessibilityActionInfo[] | undefined;
  readonly onAccessibilityAction: ((event: AccessibilityActionEvent) => void) | undefined;
}

/** Builds `accessibilityActions` + handler from visible actions and extra gesture verbs. */
export function cardA11y(actions: readonly (CardAction | A11yAction)[]): CardA11y {
  const usable = actions.filter((a) => !('disabled' in a && a.disabled === true));
  if (usable.length === 0) {
    return { accessibilityActions: undefined, onAccessibilityAction: undefined };
  }
  return {
    accessibilityActions: usable.map((a) => ({ name: a.key, label: a.label })),
    onAccessibilityAction: (event) => {
      const hit = usable.find((a) => a.key === event.nativeEvent.actionName);
      hit?.onPress();
    },
  };
}

export interface CardTextActionsProps {
  readonly actions: readonly CardAction[] | undefined;
  /** 13/600 (life, calendar-intel, error cards) instead of 14/600. */
  readonly compact?: boolean;
  /** Only one action is allowed (feed cards). */
  readonly max?: 1 | 2;
}

/** Renders at most two text actions, the first in brand colour unless stated. */
export function CardTextActions({
  actions,
  compact = false,
  max = 2,
}: CardTextActionsProps): JSX.Element | null {
  if (actions === undefined || actions.length === 0) return null;
  return (
    <CardActions>
      {actions.slice(0, max).map((action, i) => (
        <TextAction
          key={action.key}
          label={action.label}
          onPress={action.onPress}
          emphasis={action.emphasis ?? (i === 0 ? 'primary' : 'secondary')}
          icon={action.icon}
          loading={action.loading}
          loadingLabel={action.loadingLabel}
          disabled={action.disabled}
          compact={compact}
          testID={`ui.cardAction.${action.key}`}
        />
      ))}
    </CardActions>
  );
}

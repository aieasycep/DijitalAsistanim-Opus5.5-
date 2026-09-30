/**
 * Toasts (DESIGN_AUDIT §3.9). P:01 (verbatim): "Toast: ink pill, alttan 16px kayar, 2,6 sn; ikonu
 * anlam taşır (indigo nötr, coral hata)."
 * - `Toast`: ink pill (`toast.bg`), r999, padding 12/18/12/14, 14/500; leading icon 18 (glow for
 *   neutral/success, coral for error/offline); optional action in glow 600 with a 44 pt target.
 * - `ToastViewport`: shows one toast — enters translateY 16 → 0 + fade (300 ms), stays 2.6 s
 *   (undo toasts 5 s; 10 s and focusable with a screen reader), exits in 300 ms; announces it.
 * - `ToastProvider` / `useToast()`: FIFO queue, one at a time, at most 3 pending (oldest dropped).
 *   `UndoToast` semantics = a toast with an action ("Geri al").
 */
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../icons/Icon.tsx';
import type { IconName } from '../icons/generated/index.ts';
import { PressableScale } from '../primitives/PressableScale.tsx';
import { Text } from '../primitives/Text.tsx';
import { announce } from '../theme/a11y.ts';
import { useMotion, useUiPreferences } from '../theme/preferences.tsx';
import { useTheme } from '../theme/ThemeProvider.tsx';

export type ToastKind = 'neutral' | 'success' | 'error' | 'offline';

export interface ToastData {
  readonly id: string;
  readonly message: string;
  readonly kind?: ToastKind;
  /** Overrides the kind's icon. */
  readonly icon?: IconName;
  /** "Geri al" / "Görüntüle". A toast with an action is an undo toast (5 s). */
  readonly action?: { readonly label: string; readonly onPress: () => void };
  /** Explicit visible time (ms); defaults per kind and screen-reader state. */
  readonly durationMs?: number;
}

const KIND_ICON: Record<ToastKind, IconName> = {
  neutral: 'info',
  success: 'check_circle',
  error: 'error',
  offline: 'wifi_off',
};

export interface ToastProps {
  readonly toast: ToastData;
  readonly onActionPress?: () => void;
  readonly testID?: string;
}

/** The presentational ink pill. */
export function Toast({ toast, onActionPress, testID }: ToastProps): JSX.Element {
  const theme = useTheme();
  const c = theme.color.toast;
  const kind = toast.kind ?? 'neutral';
  const iconColor = kind === 'error' || kind === 'offline' ? c.iconError : c.icon;
  return (
    <View
      testID={testID ?? `ui.toast.${kind}`}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'center',
          maxWidth: '100%',
          borderRadius: theme.radius.pill,
          paddingTop: 12,
          paddingRight: 18,
          paddingBottom: 12,
          paddingLeft: 14,
          gap: theme.space[2],
          backgroundColor: c.bg,
        },
        theme.elevation('toast'),
      ]}
    >
      <Icon
        name={toast.icon ?? KIND_ICON[kind]}
        filled={kind === 'success'}
        size={18}
        color={iconColor}
      />
      <Text variant="secondary" weight={500} tone="toast" style={{ flexShrink: 1 }}>
        {toast.message}
      </Text>
      {toast.action === undefined ? null : (
        <PressableScale
          testID="ui.toast.action"
          accessibilityLabel={toast.action.label}
          onPress={onActionPress ?? toast.action.onPress}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}
          style={{ marginLeft: 6 }}
        >
          <Text variant="label" tone="toastAction">
            {toast.action.label}
          </Text>
        </PressableScale>
      )}
    </View>
  );
}

export interface UndoToastProps {
  readonly id?: string;
  /** "Onaylandı · 3 işlem", "Öğrendim · Ahmet Yılmaz artık VIP." */
  readonly message: string;
  /** "Geri al" */
  readonly undoLabel: string;
  readonly onUndo: () => void;
  readonly kind?: ToastKind;
  readonly testID?: string;
}

/** The undo toast pill (a toast whose action is "Geri al"; 5 s, 10 s with a screen reader). */
export function UndoToast({
  id = 'undo',
  message,
  undoLabel,
  onUndo,
  kind = 'success',
  testID,
}: UndoToastProps): JSX.Element {
  return (
    <Toast
      testID={testID ?? 'ui.undoToast'}
      toast={{ id, message, kind, action: { label: undoLabel, onPress: onUndo } }}
    />
  );
}

export interface ToastViewportProps {
  /** The toast to show (null = nothing). A new `id` replaces the current one. */
  readonly toast: ToastData | null;
  /** Called when the toast has fully left (after its exit animation). */
  readonly onDismissed: (id: string) => void;
  /** Distance from the bottom edge: tab bar + 14, above a sticky footer + 12, or insets + 16. */
  readonly bottomOffset?: number;
}

export function ToastViewport({
  toast,
  onDismissed,
  bottomOffset,
}: ToastViewportProps): JSX.Element | null {
  const theme = useTheme();
  const motionControl = useMotion();
  const { screenReaderEnabled } = useUiPreferences();
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);
  const dismissedRef = useRef(onDismissed);
  const [closing, setClosing] = useState<string | null>(null);
  useEffect(() => {
    dismissedRef.current = onDismissed;
  }, [onDismissed]);
  const id = toast?.id;
  const hasAction = toast?.action !== undefined;
  const message = toast?.message;
  const explicit = toast?.durationMs;
  useEffect(() => {
    if (id === undefined) return undefined;
    progress.set(0);
    progress.set(motionControl.fade(1, theme.motion.duration.toastIn));
    if (message !== undefined) announce(message);
    const hold =
      explicit ??
      (hasAction
        ? screenReaderEnabled
          ? theme.motion.hold.undoToastScreenReader
          : theme.motion.hold.undoToast
        : theme.motion.hold.toast);
    const timer = setTimeout(() => {
      setClosing(id);
    }, hold);
    return () => {
      clearTimeout(timer);
    };
  }, [
    id,
    hasAction,
    message,
    explicit,
    screenReaderEnabled,
    motionControl,
    progress,
    theme.motion,
  ]);
  useEffect(() => {
    if (closing === null) return undefined;
    progress.set(motionControl.fade(0, theme.motion.duration.toastOut, 'exit'));
    const timer = setTimeout(() => {
      setClosing(null);
      dismissedRef.current(closing);
    }, motionControl.fadeDuration(theme.motion.duration.toastOut));
    return () => {
      clearTimeout(timer);
    };
  }, [closing, motionControl, progress, theme.motion]);
  const reduce = motionControl.reduceMotion;
  const distance = theme.motion.distance.toastY;
  const animated = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: reduce ? [] : [{ translateY: (1 - progress.get()) * distance }],
  }));
  if (toast === null) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end', zIndex: theme.zIndex.toast }]}
    >
      <Animated.View
        accessibilityLiveRegion="polite"
        style={[
          {
            marginHorizontal: 16,
            marginBottom: bottomOffset ?? insets.bottom + 16,
          },
          animated,
        ]}
      >
        <Toast
          toast={toast}
          onActionPress={
            toast.action === undefined
              ? undefined
              : () => {
                  toast.action?.onPress();
                  setClosing(toast.id);
                }
          }
        />
      </Animated.View>
    </View>
  );
}

export interface ToastController {
  /** Queues a toast; returns its id. */
  readonly show: (toast: Omit<ToastData, 'id'> & { readonly id?: string }) => string;
  /** Removes a toast (current or pending) without its action. */
  readonly dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastController | null>(null);

export const MAX_PENDING_TOASTS = 3;

interface QueueState {
  readonly current: ToastData | null;
  readonly pending: readonly ToastData[];
}

export interface ToastProviderProps {
  readonly children: ReactNode;
  /** See `ToastViewport.bottomOffset`. */
  readonly bottomOffset?: number;
}

let sequence = 0;
function nextId(): string {
  sequence += 1;
  return `toast-${String(sequence)}`;
}

export function ToastProvider({ children, bottomOffset }: ToastProviderProps): JSX.Element {
  const [queue, setQueue] = useState<QueueState>({ current: null, pending: [] });
  const show = useCallback<ToastController['show']>((toast) => {
    const id = toast.id ?? nextId();
    const data: ToastData = { ...toast, id };
    setQueue((q) => {
      if (q.current === null) return { current: data, pending: q.pending };
      const pending = [...q.pending, data];
      return {
        current: q.current,
        pending: pending.length > MAX_PENDING_TOASTS ? pending.slice(-MAX_PENDING_TOASTS) : pending,
      };
    });
    return id;
  }, []);
  const dismiss = useCallback((id: string) => {
    setQueue((q) => {
      if (q.current?.id === id) {
        const [next = null, ...rest] = q.pending;
        return { current: next, pending: rest };
      }
      return { current: q.current, pending: q.pending.filter((t) => t.id !== id) };
    });
  }, []);
  const controller = useMemo<ToastController>(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <ToastContext value={controller}>
      {children}
      <ToastViewport toast={queue.current} onDismissed={dismiss} bottomOffset={bottomOffset} />
    </ToastContext>
  );
}

/** The toast queue of the nearest `ToastProvider`. */
export function useToast(): ToastController {
  const controller = use(ToastContext);
  if (controller === null) throw new Error('useToast() must be used inside <ToastProvider>.');
  return controller;
}

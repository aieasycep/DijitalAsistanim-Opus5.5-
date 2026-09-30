import { color } from '@da/design-tokens';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { AccessibilityInfo, BackHandler, Text as RNText } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import {
  BottomSheet,
  ConfirmDialog,
  DestructiveSheet,
  InAppBanner,
  MAX_PENDING_TOASTS,
  ToastViewport,
  UndoToast,
  useToast,
  type HapticKind,
  type ToastController,
} from '../src/index.ts';
import { allHosts, Providers, renderUi, styleOf } from './helpers.tsx';

beforeEach(() => {
  // Worklets schedule JS callbacks with queueMicrotask; keep it real under fake timers.
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe('BottomSheet', () => {
  it('opens as a modal with title, scrim and a light haptic; focuses the title', async () => {
    const onHaptic = jest.fn<(kind: HapticKind) => void>();
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
    await renderUi(
      <BottomSheet visible onDismiss={jest.fn()} title="Hatırlatıcı" subtitle="Ne zaman?">
        <RNText>İçerik</RNText>
      </BottomSheet>,
      { onHaptic },
    );
    expect(screen.getByRole('header', { name: 'Hatırlatıcı' })).toBeOnTheScreen();
    expect(onHaptic).toHaveBeenCalledWith('light');
    await advance(310);
    expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus');
    expect(
      styleOf(screen.getByTestId('ui.bottomSheet.scrim', { includeHiddenElements: true }))
        .backgroundColor,
    ).toBe(color.light.overlay.scrim);
  });

  it('dismisses from the scrim, the escape gesture and the Android back (Modal)', async () => {
    const onDismiss = jest.fn();
    await renderUi(
      <BottomSheet visible onDismiss={onDismiss} title="Seçenekler">
        <RNText>İçerik</RNText>
      </BottomSheet>,
    );
    await fireEvent.press(
      screen.getByTestId('ui.bottomSheet.scrim', { includeHiddenElements: true }),
    );
    const hosts = screen.root === null ? [] : allHosts(screen.root);
    const modal = hosts.find((n) => typeof n.props.onRequestClose === 'function');
    (modal?.props.onRequestClose as () => void)();
    const sheet = hosts.find((n) => n.props.accessibilityViewIsModal === true);
    (sheet?.props.onAccessibilityEscape as () => void)();
    expect(onDismiss).toHaveBeenCalledTimes(3);
  });

  it('ignores dismissal while not dismissible', async () => {
    const onDismiss = jest.fn();
    await renderUi(
      <BottomSheet visible onDismiss={onDismiss} title="Siliniyor" dismissible={false}>
        <RNText>İçerik</RNText>
      </BottomSheet>,
    );
    await fireEvent.press(
      screen.getByTestId('ui.bottomSheet.scrim', { includeHiddenElements: true }),
    );
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('handles the hardware back itself in inline presentation', async () => {
    const onDismiss = jest.fn();
    let handler: ((event: never) => boolean | null | undefined) | undefined;
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, h) => {
      handler = h;
      return { remove: jest.fn() };
    });
    await renderUi(
      <BottomSheet visible onDismiss={onDismiss} title="Rota" presentation="inline">
        <RNText>İçerik</RNText>
      </BottomSheet>,
    );
    expect(handler?.(undefined as never)).toBe(true);
    expect(onDismiss).toHaveBeenCalled();
  });

  it('drags to dismiss past 35% and unmounts after the close animation', async () => {
    const onDismiss = jest.fn();
    const onHidden = jest.fn();
    const view = await renderUi(
      <BottomSheet
        visible
        onDismiss={onDismiss}
        onHidden={onHidden}
        title="Sürükle"
        presentation="inline"
      >
        <RNText>İçerik</RNText>
      </BottomSheet>,
    );
    await act(async () => {
      fireGestureHandler(getByGestureTestId('ui.bottomSheet.pan'), [
        { state: State.BEGAN, translationY: 0, velocityY: 0 },
        { state: State.ACTIVE, translationY: 200, velocityY: 1500 },
        { state: State.END, translationY: 400, velocityY: 1500 },
      ]);
      await Promise.resolve();
    });
    expect(onDismiss).toHaveBeenCalled();
    await view.rerender(
      <Providers>
        <BottomSheet
          visible={false}
          onDismiss={onDismiss}
          onHidden={onHidden}
          title="Sürükle"
          presentation="inline"
        >
          <RNText>İçerik</RNText>
        </BottomSheet>
      </Providers>,
    );
    expect(screen.getByText('İçerik')).toBeOnTheScreen();
    await advance(250);
    expect(screen.queryByText('İçerik')).toBeNull();
    expect(onHidden).toHaveBeenCalled();
  });

  it('keeps small drags open', async () => {
    const onDismiss = jest.fn();
    await renderUi(
      <BottomSheet visible onDismiss={onDismiss} title="Sürükle" presentation="inline">
        <RNText>İçerik</RNText>
      </BottomSheet>,
    );
    await act(async () => {
      fireGestureHandler(getByGestureTestId('ui.bottomSheet.pan'), [
        { state: State.BEGAN, translationY: 0, velocityY: 0 },
        { state: State.ACTIVE, translationY: 20, velocityY: 50 },
        { state: State.END, translationY: 30, velocityY: 50 },
      ]);
      await Promise.resolve();
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('dialogs', () => {
  it('confirms or cancels and blocks cancel while confirming', async () => {
    const confirm = jest.fn();
    const cancel = jest.fn();
    await renderUi(
      <ConfirmDialog
        visible
        title="Gmail bağlantısı kaldırılsın mı?"
        confirm={{ label: 'Kaldır', onPress: confirm }}
        cancel={{ label: 'Vazgeç', onPress: cancel }}
      />,
    );
    expect(
      screen.getByRole('header', { name: 'Gmail bağlantısı kaldırılsın mı?' }),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Kaldır' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Vazgeç' }));
    expect(confirm).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
    await renderUi(
      <ConfirmDialog
        visible
        title="Siliniyor"
        confirm={{ label: 'Sil', loadingLabel: 'Siliniyor…', onPress: confirm, loading: true }}
        cancel={{ label: 'Vazgeç', onPress: cancel }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Vazgeç' })).toBeDisabled();
  });

  it('lists consequences in the destructive sheet with same-size buttons', async () => {
    const confirm = jest.fn();
    await renderUi(
      <DestructiveSheet
        visible
        title="Geçmişi sil"
        consequences={['Silinen: özetler', 'Korunan: hesaplar']}
        confirm={{ label: 'Geçmişi Sil', onPress: confirm }}
        cancel={{ label: 'Vazgeç', onPress: jest.fn() }}
      />,
    );
    expect(screen.getByText('Silinen: özetler')).toBeOnTheScreen();
    const destructive = screen.getByRole('button', { name: 'Geçmişi Sil' });
    const cancel = screen.getByRole('button', { name: 'Vazgeç' });
    expect(styleOf(destructive).minHeight).toBe(styleOf(cancel).minHeight);
    expect(styleOf(destructive).backgroundColor).toBe(color.light.button.destructive.bg);
    await fireEvent.press(destructive);
    expect(confirm).toHaveBeenCalled();
  });
});

describe('toasts', () => {
  let controller: ToastController | undefined;
  function Capture(): React.JSX.Element {
    controller = useToast();
    return <RNText>app</RNText>;
  }

  it('shows, announces and hides a toast after 2.6 s', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await renderUi(<Capture />, { withToasts: true });
    await act(() => {
      controller?.show({ message: 'Hatırlatıcı kuruldu · Yarın 09:10', kind: 'success' });
    });
    expect(screen.getByText('Hatırlatıcı kuruldu · Yarın 09:10')).toBeOnTheScreen();
    expect(announce).toHaveBeenCalledWith('Hatırlatıcı kuruldu · Yarın 09:10');
    await advance(2600);
    await advance(310);
    expect(screen.queryByText('Hatırlatıcı kuruldu · Yarın 09:10')).toBeNull();
  });

  it('keeps undo toasts 5 s (10 s with a screen reader) and runs the action', async () => {
    const onUndo = jest.fn();
    await renderUi(<Capture />, { withToasts: true });
    await act(() => {
      controller?.show({
        message: 'Onaylandı · 1 işlem',
        action: { label: 'Geri al', onPress: onUndo },
      });
    });
    await advance(4000);
    expect(screen.getByText('Onaylandı · 1 işlem')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Geri al' }));
    expect(onUndo).toHaveBeenCalled();
    await advance(310);
    expect(screen.queryByText('Onaylandı · 1 işlem')).toBeNull();

    await renderUi(<Capture />, { withToasts: true, screenReaderEnabled: true });
    await act(() => {
      controller?.show({ message: 'Öğrendim', action: { label: 'Geri al', onPress: onUndo } });
    });
    await advance(9000);
    expect(screen.getByText('Öğrendim')).toBeOnTheScreen();
    await advance(1000);
    await advance(310);
    expect(screen.queryByText('Öğrendim')).toBeNull();
  });

  it('queues FIFO with at most three pending', async () => {
    await renderUi(<Capture />, { withToasts: true });
    await act(() => {
      for (const n of ['1', '2', '3', '4', '5']) controller?.show({ message: `toast ${n}` });
    });
    expect(MAX_PENDING_TOASTS).toBe(3);
    expect(screen.getByText('toast 1')).toBeOnTheScreen();
    await advance(2600);
    await advance(310);
    expect(screen.getByText('toast 3')).toBeOnTheScreen();
  });

  it('dismisses a pending toast by id', async () => {
    await renderUi(<Capture />, { withToasts: true });
    let second = '';
    await act(() => {
      controller?.show({ message: 'first' });
      second = controller?.show({ message: 'second' }) ?? '';
      controller?.dismiss(second);
    });
    await advance(2600);
    await advance(310);
    expect(screen.queryByText('second')).toBeNull();
  });

  it('throws outside the provider', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(renderUi(<Capture />)).rejects.toThrow(
      'useToast() must be used inside <ToastProvider>.',
    );
    spy.mockRestore();
  });

  it('renders the controlled viewport and the undo pill', async () => {
    const onDismissed = jest.fn();
    const onUndo = jest.fn();
    await renderUi(
      <>
        <ToastViewport
          toast={{ id: 'a', message: 'Çevrimdışı · Son analiz 09:40', kind: 'offline' }}
          onDismissed={onDismissed}
          bottomOffset={96}
        />
        <UndoToast message="Öğrendim · Ahmet artık VIP." undoLabel="Geri al" onUndo={onUndo} />
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Geri al' }));
    expect(onUndo).toHaveBeenCalled();
    await advance(2600);
    await advance(310);
    expect(onDismissed).toHaveBeenCalledWith('a');
  });
});

describe('InAppBanner', () => {
  it('announces, opens on tap and auto-hides after 4 s', async () => {
    const onPress = jest.fn();
    const onDismiss = jest.fn();
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await renderUi(
      <InAppBanner
        banner={{ id: 'n1', title: 'Ahmet Yılmaz', body: 'Revize teklif' }}
        onPress={onPress}
        onDismiss={onDismiss}
      />,
    );
    expect(announce).toHaveBeenCalledWith('Ahmet Yılmaz');
    await fireEvent.press(screen.getByRole('button', { name: 'Ahmet Yılmaz. Revize teklif' }));
    expect(onPress).toHaveBeenCalledWith('n1');
    await advance(4000);
    expect(onDismiss).toHaveBeenCalledWith('n1');
  });

  it('dismisses on swipe up', async () => {
    const onDismiss = jest.fn();
    await renderUi(
      <InAppBanner
        banner={{ id: 'n2', title: 'Bildirim' }}
        onPress={jest.fn()}
        onDismiss={onDismiss}
      />,
    );
    await act(async () => {
      fireGestureHandler(getByGestureTestId('ui.inAppBanner.pan'), [
        { state: State.BEGAN, translationY: 0, velocityY: 0 },
        { state: State.ACTIVE, translationY: -20, velocityY: -900 },
        { state: State.END, translationY: -60, velocityY: -900 },
      ]);
      await Promise.resolve();
    });
    expect(onDismiss).toHaveBeenCalledWith('n2');
  });
});

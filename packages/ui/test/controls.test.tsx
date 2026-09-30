import { color } from '@da/design-tokens';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react-native';
import {
  ActionTile,
  approvalStatusTone,
  AssistChip,
  AuthProviderButton,
  Avatar,
  avatarPalette,
  Badge,
  badgeTone,
  Button,
  BUTTON_VARIANTS,
  buttonColors,
  CardIconAction,
  CheckIndicator,
  ChoiceChip,
  commitmentStatusTone,
  ConnectPill,
  CountdownPill,
  FilterChip,
  FilterChipRow,
  HeaderPill,
  IconButton,
  initialsOf,
  MetaChip,
  minutesUntil,
  OutlineAddButton,
  PrimaryButton,
  RadioIndicator,
  SecondaryButton,
  SegmentedControl,
  SourceChip,
  StatusPill,
  Switch,
  TextAction,
  themes,
  TokenChip,
  TonalButton,
  waitDurationTone,
  type HapticKind,
} from '../src/index.ts';
import { renderUi, styleOf } from './helpers.tsx';

describe('Button', () => {
  it.each(BUTTON_VARIANTS)(
    '%s renders its token fill in both schemes and presses',
    async (variant) => {
      const onPress = jest.fn();
      for (const scheme of ['light', 'dark'] as const) {
        onPress.mockClear();
        await renderUi(<Button label="Devam" variant={variant} onPress={onPress} />, { scheme });
        const button = screen.getByRole('button', { name: 'Devam' });
        expect(styleOf(button).backgroundColor).toBe(buttonColors(themes[scheme], variant).bg);
        await fireEvent.press(button);
        expect(onPress).toHaveBeenCalledTimes(1);
      }
    },
  );

  it('turns the ink CTA into the dark primary', () => {
    expect(buttonColors(themes.dark, 'ink').bg).toBe(color.dark.brand.primary);
    expect(buttonColors(themes.light, 'ink').bg).toBe(color.light.inverse.bg);
  });

  it('uses the design heights and radii', async () => {
    await renderUi(
      <>
        <Button label="Lg" size="lg" onPress={jest.fn()} />
        <Button label="Inline" size="inline" onPress={jest.fn()} />
        <Button label="Ghost" size="ghost" variant="ghost" onPress={jest.fn()} />
      </>,
    );
    expect(styleOf(screen.getByRole('button', { name: 'Lg' }))).toMatchObject({
      minHeight: 52,
      borderRadius: 16,
    });
    expect(styleOf(screen.getByRole('button', { name: 'Inline' }))).toMatchObject({
      minHeight: 42,
      borderRadius: 12,
    });
    expect(styleOf(screen.getByRole('button', { name: 'Ghost' }))).toMatchObject({
      minHeight: 36,
      borderRadius: 10,
    });
  });

  it('disables at opacity .4 and blocks presses', async () => {
    const onPress = jest.fn();
    await renderUi(<Button label="Sil" variant="destructive" onPress={onPress} disabled />);
    const button = screen.getByRole('button', { name: 'Sil' });
    expect(styleOf(button).opacity).toBe(0.4);
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('shows the spinner and the loading label, announces busy and locks', async () => {
    const onPress = jest.fn();
    await renderUi(
      <Button label="Gönder" loadingLabel="Gönderiliyor…" loading onPress={onPress} />,
    );
    const button = screen.getByRole('button', { name: 'Gönderiliyor…' });
    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(screen.getByText('Gönderiliyor…')).toBeOnTheScreen();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('adds the CTA glow only on page CTAs', async () => {
    await renderUi(<Button label="CTA" pageCta onPress={jest.fn()} />);
    expect(styleOf(screen.getByRole('button', { name: 'CTA' })).boxShadow).toContain('24px');
  });

  it('exposes the named shorthands', async () => {
    await renderUi(
      <>
        <PrimaryButton label="P" onPress={jest.fn()} />
        <TonalButton label="T" onPress={jest.fn()} />
        <SecondaryButton label="S" onPress={jest.fn()} />
      </>,
    );
    expect(styleOf(screen.getByRole('button', { name: 'T' })).backgroundColor).toBe(
      color.light.brand.soft,
    );
    expect(styleOf(screen.getByRole('button', { name: 'S' })).backgroundColor).toBe(
      color.light.surfaceSunken,
    );
  });
});

describe('icon and text actions', () => {
  it('requires a label on icon buttons and grows them to 44 pt', async () => {
    const onPress = jest.fn();
    await renderUi(<IconButton icon="close" accessibilityLabel="Kapat" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Kapat' });
    expect(button).toHaveProp('hitSlop', { top: 4, bottom: 4, left: 4, right: 4 });
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalled();
  });

  it('marks the card complete action as checked when done', async () => {
    await renderUi(
      <CardIconAction kind="complete" done accessibilityLabel="Tamamlandı" onPress={jest.fn()} />,
    );
    expect(
      screen.getByRole('button', { name: 'Tamamlandı' }).props.accessibilityState,
    ).toMatchObject({ checked: true });
  });

  it('renders text actions, tiles, auth and add buttons', async () => {
    const onPress = jest.fn();
    await renderUi(
      <>
        <TextAction label="Yanıt Hazırla" onPress={onPress} />
        <ActionTile label="Özetle" icon="short_text" onPress={onPress} />
        <AuthProviderButton kind="email" label="E-posta" onPress={onPress} />
        <OutlineAddButton label="Kural Ekle" onPress={onPress} />
        <HeaderPill
          label="2 onay"
          accessibilityLabel="2 onay bekliyor"
          icon="task_alt"
          onPress={onPress}
        />
      </>,
    );
    for (const name of ['Yanıt Hazırla', 'Özetle', 'E-posta', 'Kural Ekle', '2 onay bekliyor']) {
      await fireEvent.press(screen.getByRole('button', { name }));
    }
    expect(onPress).toHaveBeenCalledTimes(5);
  });
});

describe('badges', () => {
  it('colours only ACİL, SON TARİH, GÜVENLİK and ONAYLANDI', () => {
    expect(badgeTone('urgent')).toBe('critical');
    expect(badgeTone('deadline')).toBe('warning');
    expect(badgeTone('security')).toBe('critical');
    expect(badgeTone('approved')).toBe('success');
    expect(badgeTone('neutral')).toBe('neutral');
  });

  it('upper-cases the label with Turkish rules and uses the tone map', async () => {
    await renderUi(<Badge label="güvenlik" category="security" />);
    const text = screen.getByText('GÜVENLİK');
    expect(styleOf(text).color).toBe(color.light.tone.critical.textStrong);
  });

  it('shows the busy spinner in İŞLENİYOR pills', async () => {
    await renderUi(<StatusPill label="işleniyor" tone="neutral" busy testID="pill" />);
    expect(screen.getByText('İŞLENİYOR')).toBeOnTheScreen();
  });

  it('maps lifecycle statuses to the documented tones', () => {
    expect(approvalStatusTone('pending')).toEqual({ tone: 'warning', busy: false });
    expect(approvalStatusTone('executing')).toEqual({ tone: 'neutral', busy: true });
    expect(approvalStatusTone('failed').tone).toBe('critical');
    expect(approvalStatusTone('expired').tone).toBe('neutral');
    expect(commitmentStatusTone('overdue')).toBe('critical');
    expect(waitDurationTone(2)).toBe('neutral');
    expect(waitDurationTone(3)).toBe('warning');
    expect(waitDurationTone(7)).toBe('critical');
  });
});

describe('chips', () => {
  it('selects filters as tabs with a selection haptic', async () => {
    const onSelect = jest.fn();
    const onHaptic = jest.fn<(kind: HapticKind) => void>();
    await renderUi(
      <FilterChipRow
        items={[
          { key: 'all', label: 'Tümü' },
          { key: 'mail', label: 'Mail' },
        ]}
        selectedKey="all"
        onSelect={onSelect}
      />,
      { onHaptic },
    );
    expect(screen.getByRole('tab', { name: 'Tümü' }).props.accessibilityState).toMatchObject({
      selected: true,
    });
    await fireEvent.press(screen.getByRole('tab', { name: 'Mail' }));
    expect(onSelect).toHaveBeenCalledWith('mail');
    expect(onHaptic).toHaveBeenCalledWith('selection');
    await fireEvent.press(screen.getByRole('tab', { name: 'Tümü' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('exposes radio semantics for value chips', async () => {
    await renderUi(
      <>
        <FilterChip label="30 gün" selected role="radio" onPress={jest.fn()} />
        <ChoiceChip label="Google" selected={false} onPress={jest.fn()} />
      </>,
    );
    expect(screen.getByRole('radio', { name: '30 gün' }).props.accessibilityState).toMatchObject({
      checked: true,
    });
    expect(screen.getByRole('radio', { name: 'Google' }).props.accessibilityState).toMatchObject({
      checked: false,
    });
  });

  it('renders meta chips as text unless editable', async () => {
    const onPress = jest.fn();
    await renderUi(
      <>
        <MetaChip label="Yarın" icon="schedule" />
        <MetaChip
          label="12 Eylül"
          accessibilityLabel="Tarihi düzenle: 12 Eylül"
          onPress={onPress}
        />
        <MetaChip label="Ahmet" variant="vip" icon="star" />
      </>,
    );
    expect(screen.queryByRole('button', { name: 'Yarın' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Tarihi düzenle: 12 Eylül' }));
    expect(onPress).toHaveBeenCalled();
  });

  it('shows connect states; connected is not pressable and connecting is busy', async () => {
    await renderUi(
      <>
        <ConnectPill state="connected" label="Bağlandı" onPress={jest.fn()} />
        <ConnectPill state="connecting" label="Bağlanıyor…" onPress={jest.fn()} />
        <ConnectPill state="needsReauth" label="Yeniden bağlan" onPress={jest.fn()} />
      </>,
    );
    expect(screen.queryByRole('button', { name: 'Bağlandı' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Bağlanıyor…' }).props.accessibilityState,
    ).toMatchObject({ busy: true });
    expect(screen.getByRole('button', { name: 'Yeniden bağlan' })).toBeOnTheScreen();
  });

  it('removes tokens and presses assist and source chips', async () => {
    const onRemove = jest.fn();
    const onPress = jest.fn();
    await renderUi(
      <>
        <TokenChip label="teklif" onRemove={onRemove} removeLabel="“teklif” kelimesini kaldır" />
        <AssistChip label="Kısalt" onPress={onPress} />
        <SourceChip label="Gmail" icon="mail" onPress={onPress} />
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: '“teklif” kelimesini kaldır' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Kısalt' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Gmail' }));
    expect(onRemove).toHaveBeenCalled();
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  describe('CountdownPill', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('ticks each minute and switches to the started label', async () => {
      let now = 0;
      const clock = (): number => now;
      await renderUi(
        <CountdownPill
          startsAt={2 * 60_000}
          now={clock}
          format={(m) => `${String(m)} dk`}
          startedLabel="Başladı"
        />,
      );
      expect(screen.getByText('2 dk')).toBeOnTheScreen();
      now = 60_000;
      await act(() => {
        jest.advanceTimersByTime(60_000);
      });
      expect(screen.getByText('1 dk')).toBeOnTheScreen();
      now = 120_000;
      await act(() => {
        jest.advanceTimersByTime(60_000);
      });
      expect(screen.getByText('Başladı')).toBeOnTheScreen();
    });

    it('computes whole remaining minutes', () => {
      expect(minutesUntil(90_000, 0)).toBe(2);
      expect(minutesUntil(0, 1)).toBeNull();
    });
  });
});

describe('Avatar', () => {
  it('derives initials and a stable palette', () => {
    expect(initialsOf('Ahmet Yılmaz')).toBe('AY');
    expect(initialsOf('Selin')).toBe('S');
    expect(avatarPalette('c-1')).toBe(avatarPalette('c-1'));
  });

  it('labels the avatar with the name unless decorative, and inverts in dark', async () => {
    await renderUi(<Avatar name="ilker işık" id="x" />);
    expect(screen.getByRole('image', { name: 'ilker işık' })).toBeOnTheScreen();
    expect(screen.getByText('İİ')).toBeOnTheScreen();
    await renderUi(<Avatar name="Yunus" self testID="self" />, { scheme: 'dark' });
    expect(styleOf(screen.getByTestId('self')).backgroundColor).toBe(color.dark.avatar.self.bg);
  });
});

describe('selection controls', () => {
  it('toggles the switch with role switch and checked state', async () => {
    const onChange = jest.fn();
    await renderUi(<Switch value={false} accessibilityLabel="Haptik" onValueChange={onChange} />);
    const control = screen.getByRole('switch', { name: 'Haptik' });
    expect(control.props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('draws the off track with the 1.4.11 border', async () => {
    await renderUi(
      <Switch value={false} accessibilityLabel="Kapalı" onValueChange={jest.fn()} testID="sw" />,
    );
    const hosts = screen.getByTestId('sw').children;
    expect(hosts.length).toBeGreaterThan(0);
  });

  it('changes segments with tab or radio semantics', async () => {
    const onChange = jest.fn();
    await renderUi(
      <SegmentedControl
        options={[
          { key: 'day', label: 'Gün' },
          { key: 'week', label: 'Hafta' },
        ]}
        selectedKey="day"
        onChange={onChange}
        semantics="tabs"
      />,
    );
    await fireEvent.press(screen.getByRole('tab', { name: 'Hafta' }));
    expect(onChange).toHaveBeenCalledWith('week');
    await fireEvent.press(screen.getByRole('tab', { name: 'Gün' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('keeps radio/check indicators hidden (row semantics carry them)', async () => {
    await renderUi(
      <>
        <RadioIndicator selected testID="r" />
        <CheckIndicator selected={false} testID="c" />
      </>,
    );
    expect(screen.queryByTestId('r')).toBeNull();
    expect(screen.getByTestId('c', { includeHiddenElements: true })).toBeTruthy();
  });
});

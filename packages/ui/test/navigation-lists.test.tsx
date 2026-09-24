import { color } from '@da/design-tokens';
import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import {
  CategoryRow,
  ChecklistRow,
  DetailHeader,
  GradientHeader,
  GroupedList,
  KeyValueGrid,
  ListRow,
  OptionRow,
  PageDots,
  PriorityCard,
  RootHeader,
  SectionHeader,
  StepHeader,
  SwipeableRow,
  swipeA11yActions,
  TabBar,
  TimelineRow,
  type HapticKind,
} from '../src/index.ts';
import { renderUi, styleOf } from './helpers.tsx';

const TABS = [
  { key: 'today', label: 'Bugün', icon: 'sunny' as const },
  { key: 'flow', label: 'Akış', icon: 'dynamic_feed' as const },
  { key: 'plan', label: 'Plan', icon: 'calendar_today' as const },
  { key: 'assistant', label: 'Asistan', icon: 'auto_awesome' as const },
];

describe('headers', () => {
  it('renders the root header with an h1 and the profile avatar', async () => {
    const onAvatar = jest.fn();
    await renderUi(
      <RootHeader
        kicker="23 eylül salı"
        title="Günaydın, Yunus"
        avatar={{ name: 'Yunus', onPress: onAvatar, accessibilityLabel: 'Profil ve ayarlar' }}
      />,
    );
    expect(screen.getByRole('header', { name: 'Günaydın, Yunus' })).toBeOnTheScreen();
    expect(screen.getByText('23 EYLÜL SALI')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Profil ve ayarlar' }));
    expect(onAvatar).toHaveBeenCalled();
  });

  it('defaults the back label from the i18n common namespace', async () => {
    const onBack = jest.fn();
    await renderUi(<DetailHeader kicker="mail" onLeadingPress={onBack} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Geri' }));
    expect(onBack).toHaveBeenCalled();
    expect(screen.getByRole('header', { name: 'MAİL' })).toBeOnTheScreen();
    await renderUi(<DetailHeader leading="close" onLeadingPress={onBack} />, { locale: 'en' });
    expect(screen.getByRole('button', { name: 'Close' })).toBeOnTheScreen();
  });

  it('renders gradient headers and onboarding step headers', async () => {
    const onSkip = jest.fn();
    await renderUi(
      <>
        <GradientHeader gradient="dusk" kicker="akşam kapanışı" title="İyi akşamlar" />
        <StepHeader
          kicker="adım 1 / 4"
          kickerAccessibilityLabel="Adım 1 / 4"
          onBack={jest.fn()}
          skip={{ label: 'Atla', onPress: onSkip }}
        />
      </>,
    );
    expect(screen.getByRole('header', { name: 'İyi akşamlar' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Adım 1 / 4')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Atla' }));
    expect(onSkip).toHaveBeenCalled();
  });

  it('makes page dots adjustable', async () => {
    const onChange = jest.fn();
    await renderUi(
      <PageDots count={4} index={1} valueText="Sayfa 2 / 4" onChange={onChange} testID="dots" />,
    );
    const dots = screen.getByRole('adjustable');
    expect(dots).toHaveProp('accessibilityValue', { text: 'Sayfa 2 / 4' });
    await fireEvent(dots, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    await fireEvent(dots, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onChange.mock.calls).toEqual([[2], [0]]);
  });
});

describe('TabBar', () => {
  it('exposes a tablist with the selected tab and filled active icon', async () => {
    const onTabPress = jest.fn();
    const onReselect = jest.fn();
    const onHaptic = jest.fn<(kind: HapticKind) => void>();
    await renderUi(
      <TabBar items={TABS} activeKey="today" onTabPress={onTabPress} onReselect={onReselect} />,
      { onHaptic },
    );
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: 'Bugün' }).props.accessibilityState).toMatchObject({
      selected: true,
    });
    await fireEvent.press(screen.getByRole('tab', { name: 'Plan' }));
    expect(onTabPress).toHaveBeenCalledWith('plan');
    expect(onHaptic).toHaveBeenCalledWith('selection');
    await fireEvent.press(screen.getByRole('tab', { name: 'Bugün' }));
    expect(onReselect).toHaveBeenCalledWith('today');
  });

  it('is translucent on iOS and opaque with Reduce Transparency', async () => {
    await renderUi(<TabBar items={TABS} activeKey="flow" onTabPress={jest.fn()} />);
    expect(styleOf(screen.getByTestId('ui.tabBar')).backgroundColor).toBe(
      color.light.overlay.tabBar,
    );
    await renderUi(<TabBar items={TABS} activeKey="flow" onTabPress={jest.fn()} />, {
      reduceTransparency: true,
    });
    expect(styleOf(screen.getByTestId('ui.tabBar')).backgroundColor).toBe(
      color.light.overlay.tabBarOpaque,
    );
    expect(styleOf(screen.getByTestId('ui.tabBar')).minHeight).toBe(62 + 34);
  });
});

describe('lists', () => {
  it('draws section headers as headers with counts', async () => {
    await renderUi(
      <SectionHeader title="Önceliklerin" count="5 konu" countAccessibilityLabel="5 konu" />,
    );
    expect(screen.getByRole('header', { name: 'ÖNCELİKLERİN' })).toBeOnTheScreen();
    expect(screen.getByLabelText('5 konu')).toBeOnTheScreen();
  });

  it('puts hairlines only between grouped rows', async () => {
    await renderUi(
      <GroupedList testID="g">
        <ListRow title="A" />
        <ListRow title="B" />
        <ListRow title="C" />
      </GroupedList>,
    );
    const group = screen.getByTestId('g');
    const dividers = group.children.filter(
      (c) => typeof c !== 'string' && c.props.accessibilityElementsHidden === true,
    );
    expect(dividers).toHaveLength(2);
  });

  it('makes switch rows a whole-row switch', async () => {
    const onPress = jest.fn();
    await renderUi(
      <ListRow
        title="Haptik geri bildirim"
        trailing={{ kind: 'switch', value: true }}
        onPress={onPress}
      />,
    );
    const row = screen.getByRole('switch', { name: 'Haptik geri bildirim' });
    expect(row.props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalled();
  });

  it('composes navigation row labels and blocks disabled rows with a reason', async () => {
    const onPress = jest.fn();
    await renderUi(
      <>
        <ListRow
          title="Brifing"
          subtitle="08:00 · 13:00 · 19:00"
          trailing={{ kind: 'chevron' }}
          onPress={onPress}
        />
        <ListRow
          title="Outlook"
          disabled
          disabledReason="Harici kimlik bilgisi gerekli"
          trailing={{ kind: 'chevron' }}
          onPress={onPress}
        />
        <ListRow title="Hesabı sil" destructive icon="delete" onPress={onPress} />
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Brifing, 08:00 · 13:00 · 19:00' }));
    const disabled = screen.getByRole('button', { name: 'Outlook, Harici kimlik bilgisi gerekli' });
    expect(disabled).toBeDisabled();
    await fireEvent.press(disabled);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(styleOf(screen.getByText('Hesabı sil')).color).toBe(
      color.light.tone.critical.textStrong,
    );
  });

  it('renders category, option, checklist and timeline rows', async () => {
    const onPress = jest.fn();
    const onToggle = jest.fn();
    await renderUi(
      <>
        <CategoryRow label="Önemli" count="3" icon="priority_high" onPress={onPress} />
        <OptionRow label="Yarın sabah" meta="08:00" role="radio" selected onPress={onPress} />
        <OptionRow label="Harici" disabled disabledReason="Bağlantı yok" onPress={onPress} />
        <ChecklistRow
          label="Teklifi gönder"
          state="open"
          onToggle={onToggle}
          toggleActionLabel="Tamamlandı olarak işaretle"
        />
        <ChecklistRow label="Toplantı notu" state="done" meta="11:20" onToggle={onToggle} />
        <TimelineRow time="09:00" title="Ekip" />
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Önemli, 3' }));
    expect(
      screen.getByRole('radio', { name: 'Yarın sabah, 08:00' }).props.accessibilityState,
    ).toMatchObject({ checked: true });
    expect(screen.getByRole('button', { name: 'Harici, Bağlantı yok' })).toBeDisabled();
    const open = screen.getByRole('checkbox', { name: 'Teklifi gönder' });
    expect(open.props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent(open, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('checkbox', { name: 'Toplantı notu' }).props.accessibilityState,
    ).toMatchObject({ checked: true });
    expect(styleOf(screen.getByText('Toplantı notu')).textDecorationLine).toBe('line-through');
  });

  it('reads key/value rows and links the tappable ones', async () => {
    const onSource = jest.fn();
    await renderUi(
      <KeyValueGrid
        items={[
          { key: 'why', label: 'Neden', value: '3 gündür yanıt yok' },
          { key: 'source', label: 'Kaynak', value: 'Gmail', onPress: onSource },
        ]}
      />,
    );
    expect(screen.getByLabelText('Neden: 3 gündür yanıt yok')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('link', { name: 'Kaynak: Gmail' }));
    expect(onSource).toHaveBeenCalled();
  });
});

describe('SwipeableRow', () => {
  const verbs = () => ({
    right: { key: 'complete', label: 'Tamamlandı', onAction: jest.fn() },
    left: [
      { key: 'snooze', label: 'Ertele', onAction: jest.fn() },
      { key: 'dismiss', label: 'Önemli değil', onAction: jest.fn() },
    ],
  });

  it('builds the screen-reader verbs in order', () => {
    const v = verbs();
    expect(swipeA11yActions(v.right, v.left).map((a) => a.key)).toEqual([
      'complete',
      'snooze',
      'dismiss',
    ]);
  });

  it('hands every swipe verb to the card as an accessibilityAction', async () => {
    const v = verbs();
    await renderUi(
      <SwipeableRow right={v.right} left={v.left}>
        {(a11yActions) => (
          <PriorityCard
            title="Teklif"
            onPress={jest.fn()}
            a11yActions={a11yActions}
            onComplete={v.right.onAction}
            completeLabel="Tamamlandı"
            onMore={jest.fn()}
            moreLabel="Diğer seçenekler"
            accessibilityLabel="Teklif kartı"
          />
        )}
      </SwipeableRow>,
    );
    const card = screen.getByRole('button', { name: 'Teklif kartı' });
    const names = (card.props.accessibilityActions as { name: string }[]).map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(['complete', 'snooze', 'dismiss', 'more']));
    await fireEvent(card, 'accessibilityAction', { nativeEvent: { actionName: 'snooze' } });
    await fireEvent(card, 'accessibilityAction', { nativeEvent: { actionName: 'dismiss' } });
    expect(v.left[0]?.onAction).toHaveBeenCalled();
    expect(v.left[1]?.onAction).toHaveBeenCalled();
  });

  it('wraps plain children in an accessible container carrying the verbs', async () => {
    const v = verbs();
    await renderUi(
      <SwipeableRow right={v.right} left={v.left} accessibilityLabel="Takip kartı">
        <RNText>Takip</RNText>
      </SwipeableRow>,
    );
    const container = screen.getByLabelText('Takip kartı');
    await fireEvent(container, 'accessibilityAction', { nativeEvent: { actionName: 'complete' } });
    expect(v.right.onAction).toHaveBeenCalled();
  });

  it('applies the right action past 35% with a threshold haptic', async () => {
    const v = verbs();
    const onHaptic = jest.fn<(kind: HapticKind) => void>();
    await renderUi(
      <SwipeableRow right={v.right} left={v.left} accessibilityLabel="Kart" testID="row">
        <RNText>Kart</RNText>
      </SwipeableRow>,
      { onHaptic },
    );
    await fireEvent(screen.getByTestId('row'), 'layout', {
      nativeEvent: { layout: { width: 350, height: 100, x: 0, y: 0 } },
    });
    await act(async () => {
      fireGestureHandler(getByGestureTestId('row.pan'), [
        { state: State.BEGAN, translationX: 0 },
        { state: State.ACTIVE, translationX: 60 },
        { translationX: 160 },
        { state: State.END, translationX: 160 },
      ]);
      await Promise.resolve();
    });
    expect(v.right.onAction).toHaveBeenCalledTimes(1);
    expect(onHaptic).toHaveBeenCalledWith('light');
  });

  it('springs back below the threshold and opens the left group on a partial swipe', async () => {
    const v = verbs();
    await renderUi(
      <SwipeableRow right={v.right} left={v.left} accessibilityLabel="Kart" testID="row">
        <RNText>Kart</RNText>
      </SwipeableRow>,
    );
    await fireEvent(screen.getByTestId('row'), 'layout', {
      nativeEvent: { layout: { width: 350, height: 100, x: 0, y: 0 } },
    });
    await act(async () => {
      fireGestureHandler(getByGestureTestId('row.pan'), [
        { state: State.BEGAN, translationX: 0 },
        { state: State.ACTIVE, translationX: -40 },
        { state: State.END, translationX: -100 },
      ]);
      await Promise.resolve();
    });
    expect(v.left[0]?.onAction).not.toHaveBeenCalled();
    expect(v.right.onAction).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Ertele' }));
    expect(v.left[0]?.onAction).toHaveBeenCalledTimes(1);
  });

  it('applies the first left action on a full left swipe', async () => {
    const v = verbs();
    await renderUi(
      <SwipeableRow right={v.right} left={v.left} accessibilityLabel="Kart" testID="row">
        <RNText>Kart</RNText>
      </SwipeableRow>,
    );
    await fireEvent(screen.getByTestId('row'), 'layout', {
      nativeEvent: { layout: { width: 350, height: 100, x: 0, y: 0 } },
    });
    await act(async () => {
      fireGestureHandler(getByGestureTestId('row.pan'), [
        { state: State.BEGAN, translationX: 0 },
        { state: State.ACTIVE, translationX: -80 },
        { state: State.END, translationX: -260 },
      ]);
      await Promise.resolve();
    });
    expect(v.left[0]?.onAction).toHaveBeenCalledTimes(1);
  });
});

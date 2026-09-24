import { color, shadow, shadowToCss } from '@da/design-tokens';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import {
  Accordion,
  AnalysisProgressCard,
  CaptureSourceTiles,
  CaptureTextField,
  ChapterList,
  ChatComposer,
  ConfidenceChip,
  ConfidenceText,
  DayChip,
  EditorialParagraph,
  EditorialStatRow,
  EntityHighlightText,
  ExtractedItemRow,
  FeedbackActions,
  FileRow,
  IntegrationRow,
  LinkPreviewCard,
  MiniPlayer,
  PermissionExplainer,
  PlanComparisonTable,
  PlanOptionCard,
  ReferralLinkField,
  RulePreviewCard,
  Scrubber,
  SearchField,
  SelectableTile,
  ShareCardTemplate,
  SourceLine,
  TextField,
  ThemePreviewTile,
  TimeChip,
  TimelineBlock,
  TimelineBlockRow,
  TransportControls,
  TypingIndicator,
  VoiceOrb,
  Waveform,
  waveformHeights,
  WeekDensityChart,
  WhySheetContent,
  type HapticKind,
} from '../src/index.ts';
import { renderUi, styleOf } from './helpers.tsx';

describe('text inputs', () => {
  it('shows the focus ring, then the error ring with an announced helper', async () => {
    const onChange = jest.fn();
    await renderUi(
      <TextField
        value=""
        onChangeText={onChange}
        label="E-posta"
        placeholder="ad@ornek.com"
        testID="tf"
      />,
    );
    const input = screen.getByLabelText('E-posta');
    expect(input).toHaveProp('placeholderTextColor', color.light.text.tertiaryStrong);
    await fireEvent(input, 'focus');
    const box = screen.getByTestId('tf').parent;
    expect(box === null ? undefined : styleOf(box).boxShadow).toBe(
      shadowToCss(shadow.light.focusRing),
    );
    await fireEvent.changeText(input, 'yunus@');
    expect(onChange).toHaveBeenCalledWith('yunus@');
    await renderUi(
      <TextField
        value="x"
        onChangeText={onChange}
        label="E-posta"
        error="Geçerli bir e-posta adresi gir."
        testID="tf2"
      />,
    );
    const errored = screen.getByLabelText('E-posta');
    expect(errored).toHaveProp('accessibilityHint', 'Geçerli bir e-posta adresi gir.');
    expect(screen.getByText('Geçerli bir e-posta adresi gir.')).toBeOnTheScreen();
    const errorBox = screen.getByTestId('tf2').parent;
    expect(errorBox === null ? undefined : styleOf(errorBox).boxShadow).toBe(
      shadowToCss(shadow.light.errorRing),
    );
  });

  it('disables the field without the shadow', async () => {
    await renderUi(
      <TextField value="" onChangeText={jest.fn()} accessibilityLabel="Ad" disabled />,
    );
    expect(screen.getByLabelText('Ad')).toHaveProp('editable', false);
  });

  it('clears the search field', async () => {
    const onChange = jest.fn();
    await renderUi(
      <SearchField value="teklif" onChangeText={onChange} accessibilityLabel="Hafızada ara" />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Kapat' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('turns the capture counter to warning at 90%', async () => {
    await renderUi(
      <CaptureTextField
        value={'a'.repeat(95)}
        maxLength={100}
        onChangeText={jest.fn()}
        accessibilityLabel="Not"
        counterText="95 / 100"
      />,
    );
    expect(styleOf(screen.getByText('95 / 100')).color).toBe(color.light.tone.warning.text);
  });

  it('morphs mic → send and blocks sending offline', async () => {
    const onSend = jest.fn();
    const onMic = jest.fn();
    await renderUi(
      <ChatComposer
        value=""
        onChangeText={jest.fn()}
        onSend={onSend}
        onMic={onMic}
        accessibilityLabel="Soru"
        sendLabel="Gönder"
        micLabel="Sesli sor"
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Sesli sor' }));
    expect(onMic).toHaveBeenCalled();
    await renderUi(
      <ChatComposer
        value="Yarın ne var?"
        onChangeText={jest.fn()}
        onSend={onSend}
        onMic={onMic}
        accessibilityLabel="Soru"
        sendLabel="Gönder"
        micLabel="Sesli sor"
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Gönder' }));
    expect(onSend).toHaveBeenCalledTimes(1);
    await renderUi(
      <ChatComposer
        value="x"
        onChangeText={jest.fn()}
        onSend={onSend}
        accessibilityLabel="Soru"
        sendLabel="Gönder"
        disabled
        disabledReason="Çevrimdışıyken soru sorulamaz."
      />,
    );
    expect(screen.getByLabelText('Soru')).toHaveProp(
      'accessibilityHint',
      'Çevrimdışıyken soru sorulamaz.',
    );
    expect(screen.getByRole('button', { name: 'Gönder' })).toBeDisabled();
  });
});

describe('selection surfaces', () => {
  it('labels the time chip and the locked state', async () => {
    const onPress = jest.fn();
    await renderUi(
      <TimeChip
        value="08:00"
        locked
        onPress={onPress}
        accessibilityLabel="Sabah brifingi saati 08:00, değiştir"
      />,
    );
    const chip = screen.getByRole('button', { name: 'Sabah brifingi saati 08:00, değiştir' });
    expect(styleOf(chip).opacity).toBe(0.55);
    await fireEvent.press(chip);
    expect(onPress).toHaveBeenCalled();
  });

  it('selects plan options, tiles and theme previews with radio/checkbox semantics', async () => {
    const onPress = jest.fn();
    await renderUi(
      <>
        <PlanOptionCard
          title="Yıllık"
          priceLine="₺499,99"
          badge="En avantajlı"
          selected
          onPress={onPress}
        />
        <PlanOptionCard title="Aylık" loading selected={false} onPress={onPress} />
        <SelectableTile label="İş" icon="work" selected={false} onPress={onPress} />
        <ThemePreviewTile label="Koyu" mode="dark" selected onPress={onPress} />
      </>,
    );
    expect(
      screen.getByRole('radio', { name: 'Yıllık, En avantajlı, ₺499,99' }).props.accessibilityState,
    ).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByRole('checkbox', { name: 'İş' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Koyu' }));
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('expands the accordion in place', async () => {
    const onToggle = jest.fn();
    await renderUi(
      <Accordion title="Orijinal Mail" expanded={false} onToggle={onToggle}>
        <RNText>Gövde</RNText>
      </Accordion>,
    );
    expect(screen.queryByText('Gövde')).toBeNull();
    const header = screen.getByRole('button', { name: 'Orijinal Mail' });
    expect(header.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(header);
    expect(onToggle).toHaveBeenCalled();
  });
});

describe('provenance', () => {
  it('keeps the source line tappable with its hint', async () => {
    const onPress = jest.fn();
    await renderUi(
      <SourceLine
        icon="mail"
        parts={['Gmail', 'Ahmet Yılmaz', '08:42']}
        onPress={onPress}
        accessibilityHint="Bu nereden çıktı?"
      />,
    );
    const line = screen.getByRole('button', { name: 'Gmail, Ahmet Yılmaz, 08:42' });
    expect(line).toHaveProp('accessibilityHint', 'Bu nereden çıktı?');
    expect(screen.getByText('Gmail · Ahmet Yılmaz · 08:42')).toBeOnTheScreen();
    await fireEvent.press(line);
    expect(onPress).toHaveBeenCalled();
  });

  it('switches to the "Emin değilim" wording below 70% coverage', async () => {
    await renderUi(
      <>
        <ConfidenceText
          coverage={0.92}
          label="3 kaynaktan · %92 eşleşme"
          uncertainLabel="Emin değilim"
        />
        <ConfidenceText
          coverage={0.6}
          label="1 kaynaktan · %60 eşleşme"
          uncertainLabel="Emin değilim"
        />
      </>,
    );
    expect(screen.getByTestId('ui.confidenceText.confident')).toBeOnTheScreen();
    expect(screen.getByLabelText('Emin değilim, 1 kaynaktan · %60 eşleşme')).toBeOnTheScreen();
  });

  it('requires a tap to confirm uncertain values and records feedback', async () => {
    const onConfirm = jest.fn();
    const onPositive = jest.fn();
    await renderUi(
      <>
        <ConfidenceChip label="Emin değilim · onayla" onConfirm={onConfirm} />
        <FeedbackActions
          positiveLabel="Doğru"
          negativeLabel="Önemli değil"
          value="negative"
          onPositive={onPositive}
          onNegative={jest.fn()}
        />
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Emin değilim · onayla' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Doğru' }));
    expect(onConfirm).toHaveBeenCalled();
    expect(onPositive).toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Önemli değil' }).props.accessibilityState,
    ).toMatchObject({ selected: true });
  });

  it('explains why with the precedence tier, source and corrections', async () => {
    const onOpen = jest.fn();
    const onLower = jest.fn();
    await renderUi(
      <WhySheetContent
        title="Neden önemli?"
        reason="VIP ve son tarih."
        tier={{ kind: 'learned_preference', text: 'Öğrendiğim tercih: Kuzey Lojistik' }}
        source={{ icon: 'mail', parts: ['Gmail', '08:42'], openLabel: 'Orijinalini aç', onOpen }}
        options={[{ key: 'lower', label: 'Önemli değil', onPress: onLower }]}
      />,
    );
    expect(screen.getByRole('header', { name: 'Neden önemli?' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Orijinalini aç' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Önemli değil' }));
    expect(onOpen).toHaveBeenCalled();
    expect(onLower).toHaveBeenCalled();
  });
});

describe('audio', () => {
  it('plays and pauses from the mini player with a light haptic', async () => {
    const onPlayPause = jest.fn();
    const onHaptic = jest.fn<(kind: HapticKind) => void>();
    await renderUi(
      <MiniPlayer
        title="Sabah Brifingi"
        timeText="0:42 / 2:14"
        progress={0.3}
        playing
        onPlayPause={onPlayPause}
        onClose={jest.fn()}
        onExpand={jest.fn()}
        playLabel="Oynat"
        pauseLabel="Duraklat"
        closeLabel="Kapat"
        expandLabel="Oynatıcıyı aç"
      />,
      { onHaptic },
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Duraklat' }));
    expect(onPlayPause).toHaveBeenCalled();
    expect(onHaptic).toHaveBeenCalledWith('light');
    expect(
      screen.getByRole('button', { name: 'Oynatıcıyı aç: Sabah Brifingi, 0:42 / 2:14' }),
    ).toBeOnTheScreen();
  });

  it('seeks ±15 s through the adjustable scrubber and clamps', async () => {
    const onSeek = jest.fn();
    await renderUi(
      <Scrubber
        positionS={10}
        durationS={134}
        onSeek={onSeek}
        valueText="0:10 / 2:14"
        accessibilityLabel="Konum"
      />,
    );
    const scrubber = screen.getByRole('adjustable', { name: 'Konum' });
    expect(scrubber).toHaveProp('accessibilityValue', { text: '0:10 / 2:14' });
    await fireEvent(scrubber, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    await fireEvent(scrubber, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onSeek.mock.calls).toEqual([[25], [0]]);
  });

  it('seeks by dragging the scrubber', async () => {
    const onSeek = jest.fn();
    await renderUi(
      <Scrubber
        positionS={0}
        durationS={100}
        onSeek={onSeek}
        valueText="0:00 / 1:40"
        accessibilityLabel="Konum"
      />,
    );
    await fireEvent(screen.getByRole('adjustable', { name: 'Konum' }), 'layout', {
      nativeEvent: { layout: { width: 200, height: 44, x: 0, y: 0 } },
    });
    await act(async () => {
      fireGestureHandler(getByGestureTestId('ui.scrubber.pan'), [
        { state: State.BEGAN, x: 0 },
        { state: State.ACTIVE, x: 100 },
        { state: State.END, x: 100 },
      ]);
      await Promise.resolve();
    });
    expect(onSeek).toHaveBeenCalledWith(50);
  });

  it('labels transport controls and chapters', async () => {
    const onSkipBack = jest.fn();
    const onSelect = jest.fn();
    await renderUi(
      <>
        <TransportControls
          playing={false}
          onPlayPause={jest.fn()}
          onSkipBack={onSkipBack}
          onSkipForward={jest.fn()}
          playLabel="Oynat"
          pauseLabel="Duraklat"
          skipBackLabel="15 saniye geri"
          skipForwardLabel="15 saniye ileri"
          skipCaption="15"
        />
        <ChapterList
          chapters={[
            { key: 'a', index: '01', title: 'Genel bakış', duration: '0:18' },
            { key: 'b', index: '02', title: 'Öncelikler', duration: '0:40' },
          ]}
          activeKey="a"
          playingLabel="oynatılıyor"
          onSelect={onSelect}
        />
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: '15 saniye geri' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Öncelikler, 0:40' }));
    expect(onSkipBack).toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith('b');
    expect(
      screen.getByRole('button', { name: 'Genel bakış, 0:18, oynatılıyor' }).props
        .accessibilityState,
    ).toMatchObject({ selected: true });
  });

  it('keeps the waveform decorative and deterministic', async () => {
    expect(waveformHeights(5)).toEqual(waveformHeights(5));
    await renderUi(<Waveform progress={0.5} playing={false} bars={4} testID="w" />);
    expect(screen.queryByTestId('w')).toBeNull();
  });

  describe('loops', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('pulses the voice orb only while listening and not under reduce motion', async () => {
      const onPress = jest.fn();
      await renderUi(
        <VoiceOrb listening onPress={onPress} accessibilityLabel="Dinlemeyi durdur" />,
      );
      await act(() => {
        jest.advanceTimersByTime(400);
      });
      const orb = screen.getByRole('button', { name: 'Dinlemeyi durdur' });
      expect(orb.props.accessibilityState).toMatchObject({ selected: true });
      await fireEvent.press(orb);
      expect(onPress).toHaveBeenCalled();
      await renderUi(<TypingIndicator accessibilityLabel="Yanıt hazırlanıyor" />, {
        reduceMotion: true,
      });
      expect(screen.getByLabelText('Yanıt hazırlanıyor').props.accessibilityState).toMatchObject({
        busy: true,
      });
    });
  });
});

describe('plan visuals', () => {
  it('marks today and selection on day chips', async () => {
    const onPress = jest.fn();
    await renderUi(
      <DayChip
        weekday="Cum"
        day="5"
        today
        onPress={onPress}
        accessibilityLabel="Cuma 5 Eylül, 4 etkinlik"
        dot="events"
      />,
    );
    const chip = screen.getByRole('tab', { name: 'Cuma 5 Eylül, 4 etkinlik' });
    expect(styleOf(chip).backgroundColor).toBe(color.light.inverse.bg);
    await fireEvent.press(chip);
    expect(onPress).toHaveBeenCalled();
  });

  it('opens timeline blocks and draws the now-line', async () => {
    const onPress = jest.fn();
    await renderUi(
      <TimelineBlockRow time="10:00" nowAt={0.5}>
        <TimelineBlock
          kind="deadline"
          title="Teklif"
          meta="Mailden tespit edildi"
          onPress={onPress}
        />
      </TimelineBlockRow>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Teklif, Mailden tespit edildi' }));
    expect(onPress).toHaveBeenCalled();
  });

  it('opens a day from the density chart', async () => {
    const onDay = jest.fn();
    await renderUi(
      <WeekDensityChart
        kicker="1–7 eylül · yoğunluk"
        days={[
          {
            key: 'mon',
            label: 'Pzt',
            meetingMinutes: 300,
            focusMinutes: 60,
            hot: true,
            accessibilityLabel: 'Pazartesi 5 saat toplantı',
          },
        ]}
        onDayPress={onDay}
        legend={{ meeting: 'Toplantı', focus: 'Odak', busy: 'Yoğun' }}
        accessibilityLabel="Haftalık yoğunluk"
      />,
    );
    expect(screen.getByRole('header', { name: 'Haftalık yoğunluk' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Pazartesi 5 saat toplantı' }));
    expect(onDay).toHaveBeenCalledWith('mon');
    expect(styleOf(screen.getByText('Pzt')).color).toBe(color.light.tone.critical.textStrong);
  });
});

describe('capture', () => {
  it('selects sources, entities and files', async () => {
    const onSelect = jest.fn();
    const onToggle = jest.fn();
    await renderUi(
      <>
        <CaptureSourceTiles
          sources={[
            { key: 'photo', label: 'Fotoğraf', icon: 'photo_camera' },
            { key: 'file', label: 'Dosya', icon: 'picture_as_pdf' },
          ]}
          selectedKey="photo"
          onSelect={onSelect}
        />
        <ExtractedItemRow
          type="event"
          typeLabel="Etkinlik"
          title="Konser"
          suggestionLabel="AI önerisi"
          selected={false}
          onToggle={onToggle}
        />
        <FileRow name="Sözleşme.pdf" selected onPress={onToggle} />
      </>,
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'Dosya' }));
    expect(onSelect).toHaveBeenCalledWith('file');
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Etkinlik, Konser, AI önerisi' }));
    expect(onToggle).toHaveBeenCalled();
    expect(
      screen.getByRole('radio', { name: 'Sözleşme.pdf' }).props.accessibilityState,
    ).toMatchObject({ checked: true });
  });

  it('reads processing steps with their state and never shows a progress bar', async () => {
    const onCancel = jest.fn();
    await renderUi(
      <AnalysisProgressCard
        kicker="PDF analiz ediliyor…"
        steps={[
          { key: 'a', label: 'Metin okunuyor', state: 'done' },
          { key: 'b', label: 'Tarihler', state: 'active' },
        ]}
        stateLabels={{ done: 'tamamlandı', active: 'sürüyor', pending: 'bekliyor' }}
        cancel={{ label: 'İptal', onPress: onCancel }}
      />,
    );
    expect(screen.getByLabelText('Metin okunuyor, tamamlandı')).toBeOnTheScreen();
    expect(screen.queryByRole('progressbar')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'İptal' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('highlights entities and previews links', async () => {
    const onPress = jest.fn();
    await renderUi(
      <>
        <EntityHighlightText
          segments={[
            { key: 'a', text: 'Yarın ' },
            { key: 'b', text: '14:00', kind: 'time' },
          ]}
        />
        <LinkPreviewCard domain="ornek.com" title="Konser" onPress={onPress} />
      </>,
    );
    expect(styleOf(screen.getByText('14:00')).backgroundColor).toBe(color.light.tone.info.soft);
    await fireEvent.press(screen.getByRole('button', { name: 'ornek.com, Konser' }));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('account and monetisation', () => {
  it('connects integrations and explains permissions', async () => {
    const onConnect = jest.fn();
    const onPrimary = jest.fn();
    await renderUi(
      <>
        <IntegrationRow
          logo={<RNText>G</RNText>}
          name="Gmail"
          state="connect"
          stateLabel="Bağla"
          onConnectPress={onConnect}
        />
        <IntegrationRow
          logo={<RNText>M</RNText>}
          name="Outlook"
          state="connect"
          stateLabel="Bağla"
          disabled
          disabledReason="Harici kimlik bilgisi gerekli"
          onConnectPress={onConnect}
        />
        <PermissionExplainer
          icon="mail"
          title="Gmail'ini bağla"
          reasons={[{ key: 'a', icon: 'priority_high', text: 'Önemli mailler' }]}
          primaryAction={{ label: 'Google ile Bağlan', onPress: onPrimary }}
        />
      </>,
    );
    const [enabled, disabled] = screen.getAllByRole('button', { name: 'Bağla' });
    if (enabled === undefined || disabled === undefined) throw new Error('connect pills missing');
    await fireEvent.press(enabled);
    await fireEvent.press(disabled);
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Harici kimlik bilgisi gerekli')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Google ile Bağlan' }));
    expect(onPrimary).toHaveBeenCalled();
    // The grouped row mirrors its connect pill as a screen-reader action.
    const row = screen.getByLabelText('Gmail, Bağla');
    await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'connect' } });
    expect(onConnect).toHaveBeenCalledTimes(2);
  });

  it('reads comparison rows, copies the referral link and previews rules', async () => {
    const onCopy = jest.fn();
    await renderUi(
      <>
        <PlanComparisonTable
          freeLabel="Free"
          proLabel="Pro"
          rows={[
            {
              key: 'a',
              label: 'Öğle nabzı',
              free: false,
              pro: true,
              accessibilityLabel: 'Öğle nabzı: yalnızca Pro',
            },
          ]}
        />
        <ReferralLinkField
          link="https://dijitalasistan.app/r/AB12CD"
          copyLabel="Kopyala"
          onCopy={onCopy}
        />
        <RulePreviewCard
          kicker="0 mail bu kurala uydu"
          samples={[]}
          emptyText="Son 30 günde bu kurala uyan mail yok."
        />
      </>,
    );
    expect(screen.getByLabelText('Öğle nabzı: yalnızca Pro')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Kopyala' }));
    expect(onCopy).toHaveBeenCalled();
    expect(screen.getByText('Son 30 günde bu kurala uyan mail yok.')).toBeOnTheScreen();
  });
});

describe('editorial', () => {
  it('uses Lora with bold spans and highlighted stats', async () => {
    await renderUi(
      <>
        <EditorialParagraph
          spans={[
            { key: 'a', text: 'Bugün ' },
            { key: 'b', text: 'üç konu', bold: true },
          ]}
        />
        <EditorialStatRow value="46" label="mail okundu" highlighted first />
      </>,
    );
    expect(styleOf(screen.getByText('üç konu')).fontFamily).toBe('Lora_600SemiBold');
    expect(styleOf(screen.getByText('46')).color).toBe(color.light.text.accent);
  });

  it('renders the share card at store size without font scaling', async () => {
    await renderUi(
      <ShareCardTemplate
        format="9:16"
        brandName="Dijital Asistan"
        kicker="haftam"
        headline="214 mail"
        stats={[]}
        tagline="Tagline"
      />,
    );
    expect(styleOf(screen.getByTestId('ui.shareCardTemplate.9:16'))).toMatchObject({
      width: 1080,
      height: 1920,
    });
    expect(screen.getByText('214 mail')).toHaveProp('allowFontScaling', false);
  });
});

import { color } from '@da/design-tokens';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import {
  AiCard,
  AnnouncementCard,
  ApprovalCard,
  ApprovalRow,
  AttentionCard,
  BriefingHero,
  CalendarIntelCard,
  CommitmentCard,
  ConflictPair,
  DraftCard,
  DraftEditorCard,
  FollowUpCard,
  GapBlock,
  HeroStat,
  InkCallout,
  LifeCard,
  MailSummaryCard,
  PriorityCard,
  ProGateCard,
  RichAnswerCard,
  SenderHeader,
  SourceResultCard,
  StatTile,
  SuggestedSurface,
  TalkingPointsCard,
  WaitingCard,
  type ApprovalCardProps,
  type HapticKind,
} from '../src/index.ts';
import { Providers, renderUi, styleOf } from './helpers.tsx';

const actionNames = (el: { props: Record<string, unknown> }): string[] =>
  ((el.props.accessibilityActions ?? []) as { name: string }[]).map((a) => a.name);

describe('PriorityCard', () => {
  const props = () => ({
    title: 'Revize teklif bugün bekleniyor',
    badge: { label: 'Acil', category: 'urgent' as const },
    time: '08:42',
    source: {
      icon: 'mail' as const,
      parts: ['Gmail', 'Ahmet Yılmaz', '08:42'],
      onPress: jest.fn(),
      accessibilityHint: 'Bu nereden çıktı?',
    },
    actions: [
      { key: 'reply', label: 'Yanıt Hazırla', onPress: jest.fn() },
      { key: 'snooze', label: 'Ertele', onPress: jest.fn() },
      { key: 'third', label: 'Üçüncü', onPress: jest.fn() },
    ],
    onPress: jest.fn(),
    onComplete: jest.fn(),
    completeLabel: 'Tamamlandı olarak işaretle',
    onMore: jest.fn(),
    moreLabel: 'Diğer seçenekler',
  });

  it('is one button with a composed label and exposes every control as an action', async () => {
    const p = props();
    await renderUi(<PriorityCard {...p} />);
    const card = screen.getByRole('button', { name: /^Acil, 08:42\. Revize teklif/ });
    expect(actionNames(card)).toEqual(['complete', 'more', 'source', 'reply', 'snooze']);
    await fireEvent(card, 'accessibilityAction', { nativeEvent: { actionName: 'complete' } });
    await fireEvent(card, 'accessibilityAction', { nativeEvent: { actionName: 'reply' } });
    expect(p.onComplete).toHaveBeenCalled();
    expect(p.actions[0]?.onPress).toHaveBeenCalled();
    await fireEvent.press(card);
    expect(p.onPress).toHaveBeenCalled();
  });

  it('renders at most two text actions (design rule)', async () => {
    await renderUi(<PriorityCard {...props()} />);
    expect(screen.getByText('Yanıt Hazırla')).toBeOnTheScreen();
    expect(screen.getByText('Ertele')).toBeOnTheScreen();
    expect(screen.queryByText('Üçüncü')).toBeNull();
  });

  it('shows the done state with a success check and strikethrough', async () => {
    await renderUi(<PriorityCard {...props()} done />);
    expect(styleOf(screen.getByText('Revize teklif bugün bekleniyor')).textDecorationLine).toBe(
      'line-through',
    );
  });

  it('replaces the actions with the inline error and retry', async () => {
    const onRetry = jest.fn();
    await renderUi(
      <PriorityCard
        {...props()}
        error={{ message: 'Bu kart yüklenemedi.', retryLabel: 'Tekrar dene', onRetry }}
      />,
    );
    expect(screen.queryByText('Yanıt Hazırla')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(onRetry).toHaveBeenCalled();
  });

  describe('exit', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('calls onExited after the 300 ms exit (120 ms under reduce motion)', async () => {
      const onExited = jest.fn();
      await renderUi(<PriorityCard {...props()} exiting onExited={onExited} />);
      await act(() => {
        jest.advanceTimersByTime(299);
      });
      expect(onExited).not.toHaveBeenCalled();
      await act(() => {
        jest.advanceTimersByTime(2);
      });
      expect(onExited).toHaveBeenCalledTimes(1);
      const reduced = jest.fn();
      await renderUi(<PriorityCard {...props()} exiting onExited={reduced} />, {
        reduceMotion: true,
      });
      await act(() => {
        jest.advanceTimersByTime(121);
      });
      expect(reduced).toHaveBeenCalledTimes(1);
    });
  });
});

describe('feed cards', () => {
  it('shows the unavailable-summary fallback on attention cards', async () => {
    await renderUi(
      <AttentionCard
        title="Sözleşme"
        summaryUnavailable="Özet hazırlanamadı"
        sourceName="Gmail · Selin"
        sourceIcon="mail"
        tileTone="critical"
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText('Özet hazırlanamadı')).toBeOnTheScreen();
  });

  it('opens the "···" menu of waiting and follow-up cards', async () => {
    const onWaiting = jest.fn();
    const onFollowUp = jest.fn();
    await renderUi(
      <>
        <WaitingCard
          personName="Ahmet Yılmaz"
          waitMeta="2 sa"
          topic="Teklif"
          onPress={jest.fn()}
          onMore={onWaiting}
          moreLabel="Bekleyen seçenekleri"
        />
        <FollowUpCard
          personName="Selin Kaya"
          topic="Sözleşme"
          waitLabel="3 gün"
          waitTone="warning"
          status="Yanıt gelmedi."
          draftAction={{ label: 'Takip Mesajı Hazırla', onPress: jest.fn() }}
          onMore={onFollowUp}
          moreLabel="Takip seçenekleri"
        />
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Bekleyen seçenekleri' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Takip seçenekleri' }));
    expect(onWaiting).toHaveBeenCalledTimes(1);
    expect(onFollowUp).toHaveBeenCalledTimes(1);
  });

  it('opens the "···" menu of mail summary cards', async () => {
    const onMore = jest.fn();
    await renderUi(
      <MailSummaryCard
        senderName="Ahmet Yılmaz"
        summary="Teklif istiyor."
        onPress={jest.fn()}
        onMore={onMore}
        moreLabel="Diğer seçenekler"
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Diğer seçenekler' }));
    expect(onMore).toHaveBeenCalledTimes(1);
  });

  it('shows the visible "···" twin of the swipe verbs on attention cards', async () => {
    const onMore = jest.fn();
    await renderUi(
      <AttentionCard
        title="Teklif"
        summary="Revize teklif bekliyor."
        sourceName="Gmail"
        sourceIcon="mail"
        onPress={jest.fn()}
        onMore={onMore}
        moreLabel="Diğer seçenekler"
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Diğer seçenekler' }));
    expect(onMore).toHaveBeenCalledTimes(1);
    const card = screen.getByTestId('ui.attentionCard');
    expect(card.props.accessibilityActions).toEqual(
      expect.arrayContaining([{ name: 'more', label: 'Diğer seçenekler' }]),
    );
  });

  it('renders mail summaries, life cards and announcements with their actions', async () => {
    const onDismiss = jest.fn();
    const onLife = jest.fn();
    await renderUi(
      <>
        <MailSummaryCard
          senderName="Ahmet Yılmaz"
          summary="Teklif istiyor."
          time="08:42"
          unread
          onPress={jest.fn()}
        />
        <LifeCard
          icon="shield"
          typeLabel="güvenlik"
          title="Yeni giriş"
          security
          onPress={onLife}
          actions={[{ key: 'me', label: 'Bendim', onPress: jest.fn() }]}
        />
        <AnnouncementCard
          title="Yeni sürüm"
          onDismiss={onDismiss}
          dismissLabel="Duyuruyu kapat"
          accessibilityLabel="Duyuru: Yeni sürüm"
        />
      </>,
    );
    expect(screen.getByText('GÜVENLİK')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: /GÜVENLİK|güvenlik/ }));
    expect(onLife).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Duyuruyu kapat' }));
    expect(onDismiss).toHaveBeenCalled();
    expect(screen.getByLabelText('Duyuru: Yeni sürüm')).toBeOnTheScreen();
  });
});

describe('AI cards', () => {
  it('renders the AI kicker as header and runs its actions', async () => {
    const onPlan = jest.fn();
    await renderUi(
      <AiCard
        kicker="takvim zekâsı"
        title="Salı boş"
        primaryAction={{ label: 'Planla', icon: 'event_available', onPress: onPlan }}
        bullets={['Bir', 'İki']}
      />,
    );
    expect(screen.getByRole('header', { name: 'TAKVİM ZEKÂSI' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Planla' }));
    expect(onPlan).toHaveBeenCalled();
  });

  it('shows accepted / pending pills and a busy skeleton while loading', async () => {
    await renderUi(
      <AiCard kicker="AI" title="Öneri" state="pendingApproval" stateLabel="Onay bekliyor" />,
    );
    expect(screen.getByText('Onay bekliyor')).toBeOnTheScreen();
    await renderUi(<AiCard kicker="AI" title="Öneri" state="loading" />);
    expect(screen.getByLabelText('Yükleniyor').props.accessibilityState).toMatchObject({
      busy: true,
    });
  });

  it('colours only the hero count and swaps modes', async () => {
    const onListen = jest.fn();
    await renderUi(
      <BriefingHero
        kicker="Brifing hazır · 07:58"
        sentence={{ before: 'Bugün bilmen gereken ', count: '5', after: ' şey var.' }}
        primaryAction={{ label: 'Brifingimi Gör', onPress: jest.fn() }}
        listenAction={{
          label: 'Dinle · 2 dk',
          onPress: onListen,
          accessibilityLabel: 'Brifingi dinle, 2 dakika',
        }}
      />,
    );
    expect(
      screen.getByRole('header', { name: 'Bugün bilmen gereken 5 şey var.' }),
    ).toBeOnTheScreen();
    expect(styleOf(screen.getByText('5')).color).toBe(color.light.text.accent);
    await fireEvent.press(screen.getByRole('button', { name: 'Brifingi dinle, 2 dakika' }));
    expect(onListen).toHaveBeenCalled();
    await renderUi(
      <BriefingHero mode="generating" kicker="Brifing hazırlanıyor…" sentence={{ before: '' }} />,
    );
    expect(screen.getByLabelText('Yükleniyor')).toBeOnTheScreen();
    await renderUi(
      <BriefingHero
        mode="offline"
        kicker="Brifing · 07:58 · Çevrimdışı"
        sentence={{ before: 'Dünkü brifing' }}
        listenAction={{ label: 'İndirilmedi', onPress: jest.fn(), disabled: true }}
      />,
    );
    expect(screen.getByRole('button', { name: 'İndirilmedi' })).toBeDisabled();
  });

  it('renders the Pro gate with neutral bars only', async () => {
    const onPro = jest.fn();
    const onDismiss = jest.fn();
    await renderUi(
      <ProGateCard
        kicker="öğle nabzı · pro"
        title="3 yeni konu"
        primaryAction={{ label: "Pro'yu Gör", onPress: onPro }}
        dismissAction={{ label: 'Şimdi değil', onPress: onDismiss }}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: "Pro'yu Gör" }));
    await fireEvent.press(screen.getByRole('button', { name: 'Şimdi değil' }));
    expect(onPro).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it('switches the talking points card to the prep gradient in dark and exposes long-press', async () => {
    const onLong = jest.fn();
    await renderUi(
      <TalkingPointsCard
        kicker="3 şey"
        points={[{ key: 'a', title: 'Teklif' }]}
        onPointLongPress={onLong}
        pointLongPressLabel="Bu nereden çıktı?"
      />,
    );
    expect(styleOf(screen.getByTestId('ui.talkingPointsCard')).backgroundColor).toBe(
      color.light.surfaceInk,
    );
    const point = screen.getByRole('button', { name: 'Teklif' });
    await fireEvent(point, 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } });
    expect(onLong).toHaveBeenCalledWith('a');
    await renderUi(<TalkingPointsCard kicker="3 şey" points={[{ key: 'a', title: 'Teklif' }]} />, {
      scheme: 'dark',
    });
    expect(styleOf(screen.getByTestId('ui.talkingPointsCard')).backgroundColor).toBeUndefined();
  });

  it('runs rich answer rows, drafts, editor and result cards', async () => {
    const onRow = jest.fn();
    const onApprove = jest.fn();
    const onText = jest.fn();
    const onOpen = jest.fn();
    await renderUi(
      <>
        <RichAnswerCard
          kicker="Kişiler"
          rows={[{ key: 'm', title: 'Mehmet', meta: 'Yılmaz Endüstri', onPress: onRow }]}
        />
        <DraftCard
          kicker="Taslak"
          preview="Merhaba"
          approveAction={{ label: 'Göndermeyi Onayla', onPress: onApprove }}
          editAction={{ label: 'Düzenle', onPress: jest.fn() }}
        />
        <DraftEditorCard
          kicker="AI taslağı"
          value="Merhaba"
          onChangeText={onText}
          accessibilityLabel="Yanıt taslağı"
        />
        <SourceResultCard
          sourceIcon="mail"
          sourceName="Gmail"
          title="Sözleşme"
          openLabel="Orijinali Aç"
          onOpen={onOpen}
        />
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Mehmet, Yılmaz Endüstri' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Göndermeyi Onayla' }));
    await fireEvent.changeText(screen.getByLabelText('Yanıt taslağı'), 'Merhaba Mehmet Bey');
    await fireEvent.press(screen.getByRole('button', { name: 'Orijinali Aç' }));
    expect(onRow).toHaveBeenCalled();
    expect(onApprove).toHaveBeenCalled();
    expect(onText).toHaveBeenCalledWith('Merhaba Mehmet Bey');
    expect(onOpen).toHaveBeenCalled();
  });

  it('locks the draft card once submitted', async () => {
    await renderUi(
      <DraftCard
        kicker="Taslak"
        preview="Merhaba"
        approveAction={{ label: 'Göndermeyi Onayla', onPress: jest.fn() }}
        editAction={{ label: 'Düzenle', onPress: jest.fn() }}
        status={{ label: 'Gönderiliyor', tone: 'neutral', busy: true }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Göndermeyi Onayla' })).toBeNull();
  });
});

describe('people cards', () => {
  it('runs follow-up buttons and exposes them as actions', async () => {
    const draft = jest.fn();
    await renderUi(
      <FollowUpCard
        personName="Mehmet"
        topic="Sözleşme"
        waitLabel="3 gün"
        waitTone="warning"
        status="Yanıt yok."
        draftAction={{ label: 'Takip Mesajı Hazırla', onPress: draft }}
        closeAction={{ label: 'Kapat', onPress: jest.fn() }}
        onPress={jest.fn()}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Takip Mesajı Hazırla' }));
    expect(draft).toHaveBeenCalled();
    const card = screen.getByRole('button', { name: /^Mehmet\. Sözleşme/ });
    expect(actionNames(card)).toEqual(['draft', 'close']);
  });

  it('renders waiting and VIP person cards', async () => {
    await renderUi(
      <>
        <WaitingCard
          personName="Ahmet"
          waitMeta="2 gün"
          topic="Teklif"
          deadline={{ label: 'Bugün 17:00', tone: 'critical' }}
          action={{ label: 'Yanıtla', onPress: jest.fn() }}
        />
        <WaitingCard personName="Selin" waitMeta="3 gün" topic="Madde 4" vip vipLabel="VIP" />
      </>,
    );
    expect(styleOf(screen.getByText('Bugün 17:00')).color).toBe(
      color.light.tone.critical.textStrong,
    );
    expect(screen.getByTestId('ui.personActionCard')).toBeOnTheScreen();
  });

  it('quotes commitments and shows only "Kaynağı Gör" when done', async () => {
    await renderUi(
      <CommitmentCard
        status={{ label: 'Tamamlandı', tone: 'success' }}
        quote="Cuma gönderirim"
        details={[{ key: 'w', label: 'Kime', value: 'Mehmet' }]}
        completeAction={{ label: 'Tamamlandı', onPress: jest.fn() }}
        sourceAction={{ label: 'Kaynağı Gör', onPress: jest.fn() }}
        done
      />,
    );
    expect(screen.getByText('“Cuma gönderirim”')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Tamamlandı' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Kaynağı Gör' })).toBeOnTheScreen();
  });

  it('asks "Bu bir söz mü?" in the confirmation variant', async () => {
    const yes = jest.fn();
    await renderUi(
      <CommitmentCard
        status={{ label: 'Açık', tone: 'neutral' }}
        quote="Bakarım"
        details={[]}
        sourceAction={{ label: 'Kaynağı Gör', onPress: jest.fn() }}
        confirmation={{
          kicker: 'bu bir söz mü?',
          confirm: { label: 'Evet, takip et', onPress: yes },
          reject: { label: 'Hayır', onPress: jest.fn() },
        }}
      />,
    );
    expect(screen.getByRole('header', { name: 'BU BİR SÖZ MÜ?' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Evet, takip et' }));
    expect(yes).toHaveBeenCalled();
    const card = screen.getByLabelText('Açık. Bakarım');
    expect(actionNames(card)).toEqual(['confirm', 'reject', 'source']);
    await fireEvent(card, 'accessibilityAction', { nativeEvent: { actionName: 'confirm' } });
    expect(yes).toHaveBeenCalledTimes(2);
  });
});

describe('plan and info cards', () => {
  it('draws the suggested block dashed until executed', async () => {
    await renderUi(
      <SuggestedSurface
        title="Odak"
        accessibilityLabel="Önerilen, henüz takvimde değil: Odak"
        testID="s1"
      />,
    );
    expect(styleOf(screen.getByTestId('s1'))).toMatchObject({
      borderStyle: 'dashed',
      borderColor: color.light.border.suggested,
      backgroundColor: color.light.plan.ai,
    });
    await renderUi(
      <SuggestedSurface title="Odak" state="executed" accessibilityLabel="Odak" testID="s2" />,
    );
    expect(styleOf(screen.getByTestId('s2'))).toMatchObject({
      borderStyle: 'solid',
      borderColor: color.light.border.planned,
      backgroundColor: color.light.plan.aiPlanned,
    });
  });

  it('retries a failed suggestion', async () => {
    const onRetry = jest.fn();
    await renderUi(
      <SuggestedSurface
        title="Odak"
        state="failed"
        failure={{ message: 'Takvime eklenemedi', retryLabel: 'Tekrar dene', onRetry }}
        accessibilityLabel="Odak"
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('opens gap blocks, conflicts, callouts and intel actions', async () => {
    const onPress = jest.fn();
    await renderUi(
      <>
        <GapBlock label="2 saat boşluk" onPress={onPress} />
        <ConflictPair
          first={{ time: '14:00', title: 'A' }}
          second={{ time: '14:30', title: 'B' }}
          accessibilityLabel="Çakışma: A ve B"
          onPress={onPress}
        />
        <InkCallout title="Onay Merkezi" subtitle="2 işlem" onPress={onPress} />
        <CalendarIntelCard
          icon="bolt"
          iconTone="warning"
          title="Yoğun"
          actions={[{ key: 'x', label: 'Odak ekle', onPress }]}
        />
        <StatTile label="Okunan" value="46" onPress={onPress} />
        <HeroStat value="83" label="mail" />
      </>,
    );
    for (const name of [
      '2 saat boşluk',
      'Çakışma: A ve B',
      'Onay Merkezi, 2 işlem',
      'Odak ekle',
      'Okunan: 46',
    ]) {
      await fireEvent.press(screen.getByRole('button', { name }));
    }
    expect(onPress).toHaveBeenCalledTimes(5);
    expect(screen.getByLabelText('83 mail')).toBeOnTheScreen();
  });

  it('renders the sender header as one element', async () => {
    await renderUi(<SenderHeader name="Mehmet" meta="mehmet@… · 08:42" vip vipLabel="VIP" />);
    expect(screen.getByLabelText('Mehmet, VIP, mehmet@… · 08:42')).toBeOnTheScreen();
  });
});

describe('ApprovalCard', () => {
  const base = (): ApprovalCardProps => ({
    actionType: 'email_send',
    typeLabel: 'mail gönder',
    status: 'pending',
    statusLabel: 'Bekliyor',
    time: '09:12',
    title: "Mehmet'e takip mesajı",
    details: [
      { key: 'why', label: 'Neden', value: '3 gündür yanıt yok' },
      { key: 'change', label: 'Değişim', value: '1 mail gönderilecek' },
      { key: 'source', label: 'Kaynak', value: 'Gmail', onPress: jest.fn() },
      { key: 'account', label: 'Hesap', value: 'Gmail · yu***@gmail.com' },
      { key: 'side', label: 'Yan etki', value: 'Geri alınamaz' },
    ],
    approve: {
      label: 'Onayla',
      onPress: jest.fn(),
      busyLabel: 'Gönderiliyor…',
      doneLabel: 'Onaylandı',
    },
    edit: { label: 'Düzenle', onPress: jest.fn() },
    reject: { label: 'Reddet', onPress: jest.fn() },
  });

  it('shows what, why, change, source, account and side effect with three actions', async () => {
    const p = base();
    await renderUi(<ApprovalCard {...p} />);
    expect(
      screen.getByLabelText(
        "mail gönder: Mehmet'e takip mesajı. Neden: 3 gündür yanıt yok. Bekliyor",
      ),
    ).toBeOnTheScreen();
    for (const label of [
      'Neden: 3 gündür yanıt yok',
      'Değişim: 1 mail gönderilecek',
      'Hesap: Gmail · yu***@gmail.com',
      'Yan etki: Geri alınamaz',
    ]) {
      expect(screen.getByLabelText(label)).toBeOnTheScreen();
    }
    await fireEvent.press(screen.getByRole('link', { name: 'Kaynak: Gmail' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Onayla' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Reddet' }));
    expect(p.approve.onPress).toHaveBeenCalled();
    expect(p.reject?.onPress).toHaveBeenCalled();
  });

  it('locks while executing and announces status changes; success haptic only on executed', async () => {
    const onHaptic = jest.fn<(kind: HapticKind) => void>();
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    const p = base();
    const view = await renderUi(<ApprovalCard {...p} />, { onHaptic });
    await view.rerender(
      <Providers onHaptic={onHaptic}>
        <ApprovalCard {...p} status="executing" statusLabel="İşleniyor" />
      </Providers>,
    );
    expect(
      screen.getByRole('button', { name: 'Gönderiliyor…' }).props.accessibilityState,
    ).toMatchObject({ busy: true, disabled: true });
    expect(screen.getByRole('button', { name: 'Düzenle' })).toBeDisabled();
    expect(announce).toHaveBeenCalledWith('İşleniyor');
    expect(onHaptic).not.toHaveBeenCalledWith('success');
    await view.rerender(
      <Providers onHaptic={onHaptic}>
        <ApprovalCard {...p} status="executed" statusLabel="Onaylandı" />
      </Providers>,
    );
    expect(onHaptic).toHaveBeenCalledWith('success');
    expect(announce).toHaveBeenCalledWith('Onaylandı');
    expect(screen.queryByRole('button', { name: 'Onayla' })).toBeNull();
    announce.mockClear();
  });

  it('offers retry on failure and fades rejected / expired cards', async () => {
    const retry = jest.fn();
    await renderUi(
      <ApprovalCard
        {...base()}
        status="failed"
        statusLabel="Başarısız"
        failure={{
          reason: "Gmail'e ulaşılamadı.",
          retry: { label: 'Tekrar dene', onPress: retry },
        }}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(retry).toHaveBeenCalled();
    await renderUi(
      <ApprovalCard
        {...base()}
        status="expired"
        statusLabel="Süresi doldu"
        expiredNote="Süresi doldu · 16:00 geçti"
        testID="exp"
      />,
    );
    expect(screen.getByText('Süresi doldu · 16:00 geçti')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Onayla' })).toBeNull();
  });

  it('shows the tap-to-approve hint on the compact voice card', async () => {
    await renderUi(
      <ApprovalCard
        {...base()}
        variant="compact"
        reject={{ label: 'İptal', onPress: jest.fn() }}
        hint="Onaylamak için karta dokun."
      />,
    );
    expect(screen.getByText('Onaylamak için karta dokun.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'İptal' })).toBeOnTheScreen();
  });

  it('toggles capture batch rows', async () => {
    const onToggle = jest.fn();
    await renderUi(
      <ApprovalRow
        actionType="calendar_create"
        typeLabel="etkinlik ekle"
        title="Konser"
        selected
        onToggle={onToggle}
      />,
    );
    const row = screen.getByRole('checkbox', { name: 'etkinlik ekle: Konser' });
    expect(row.props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(row);
    expect(onToggle).toHaveBeenCalled();
  });
});

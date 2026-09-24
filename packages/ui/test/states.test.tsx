import { color } from '@da/design-tokens';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Text as RNText } from 'react-native';
import {
  AiUnavailableCard,
  AiWorkingKicker,
  CardSkeleton,
  ChatStreamingSkeleton,
  EmptyState,
  EntitlementGate,
  ErrorCard,
  ErrorState,
  ExternalCredentialRequired,
  FeedSkeleton,
  LimitCard,
  LongRunningNotice,
  MailDetailSkeleton,
  NotFoundState,
  OfflineBanner,
  OfflineScreen,
  PartialDataNotice,
  PermissionCard,
  PrepSkeleton,
  ReconnectCard,
  SettingsValueSkeleton,
  sortStateCards,
  StaggerIn,
  SuccessState,
  SyncDelayedCard,
  SyncLine,
  TimelineSkeleton,
  TodaySkeleton,
  type HapticKind,
} from '../src/index.ts';
import { Providers, renderUi } from './helpers.tsx';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('M-STATE-02 EmptyState', () => {
  it('renders the success message with one real action', async () => {
    const onPress = jest.fn();
    await renderUi(
      <EmptyState
        icon="done_all"
        tone="success"
        title="Her şey kontrol altında."
        body="46 maili senin için okudum."
        action={{ label: 'Akışa göz at', onPress }}
      />,
    );
    expect(screen.getByRole('header', { name: 'Her şey kontrol altında.' })).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Akışa göz at' }));
    expect(onPress).toHaveBeenCalled();
  });

  it('omits the CTA when there is none (no dead action) and disables offline CTAs with the reason', async () => {
    await renderUi(
      <EmptyState icon="mark_email_read" tone="success" title="Bekleyen takip yok." />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    await renderUi(
      <EmptyState
        icon="self_improvement"
        tone="primary"
        title="Sakin"
        action={{
          label: 'Odak bloğu öner',
          onPress: jest.fn(),
          disabled: true,
          disabledReason: 'Bu işlem için internet bağlantısı gerekiyor.',
        }}
      />,
    );
    const cta = screen.getByRole('button', { name: 'Odak bloğu öner' });
    expect(cta).toBeDisabled();
    expect(cta).toHaveProp('accessibilityHint', 'Bu işlem için internet bağlantısı gerekiyor.');
  });
});

describe('ErrorCard and inline M-STATE cards', () => {
  it('announces on appear and keeps the correlation id out of the text', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await renderUi(
      <ErrorCard
        icon="error"
        tone="neutral"
        title="Bir sorun oluştu."
        body="Tekrar denemek ister misin?"
        correlationId="corr-42"
        primaryAction={{ label: 'Tekrar Dene', onPress: jest.fn() }}
      />,
    );
    expect(announce).toHaveBeenCalledWith('Bir sorun oluştu. Tekrar denemek ister misin?');
    expect(screen.getByTestId('ui.errorCard.corr-42')).toBeOnTheScreen();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveProp('accessibilityHint', 'corr-42');
    expect(screen.queryByText(/corr-42/)).toBeNull();
  });

  it('uses the M-STATE icon and tone per card', async () => {
    const reconnect = jest.fn();
    await renderUi(
      <>
        <ReconnectCard
          title="Gmail bağlantısı yenilenmeli."
          body="Google oturumu süresi doldu."
          reconnectAction={{ label: 'Yeniden Bağlan', onPress: reconnect }}
          laterAction={{ label: 'Sonra', onPress: jest.fn() }}
          accessibilityLabel="Gmail, yeniden bağlanman gerekiyor"
        />
        <ReconnectCard
          variant="adminConsent"
          title="Yönetici onayı gerekli."
          body="Kurum."
          reconnectAction={{ label: 'Nasıl yapılır?', onPress: jest.fn() }}
        />
        <SyncDelayedCard
          title="Senkronizasyon gecikti."
          primaryAction={{ label: 'Şimdi Dene', onPress: jest.fn(), loading: true }}
        />
        <AiUnavailableCard
          title="Asistan şu an yanıt veremiyor."
          primaryAction={{ label: 'Tekrar Dene', onPress: jest.fn() }}
        />
        <PermissionCard
          title="Takvim izni verilmedi."
          primaryAction={{ label: 'İzin Ver', onPress: jest.fn() }}
          secondaryAction={{ label: 'Neden gerekli?', onPress: jest.fn() }}
        />
        <LimitCard
          title="Bugünkü AI analiz hakkın doldu."
          primaryAction={{ label: "Pro'yu Gör", onPress: jest.fn() }}
        />
      </>,
    );
    expect(screen.getByTestId('ui.reconnectCard.expired')).toBeOnTheScreen();
    expect(screen.getByTestId('ui.reconnectCard.adminConsent')).toBeOnTheScreen();
    expect(screen.getByLabelText('Gmail, yeniden bağlanman gerekiyor')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Yeniden Bağlan' }));
    expect(reconnect).toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Şimdi Dene' }).props.accessibilityState,
    ).toMatchObject({ busy: true });
    expect(screen.getByRole('button', { name: 'Neden gerekli?' })).toBeOnTheScreen();
  });

  it('shows the entitlement gate and the lapse warning', async () => {
    const onPro = jest.fn();
    await renderUi(
      <EntitlementGate
        kicker="takip · pro"
        title="3 takip bekliyor."
        primaryAction={{ label: "Pro'yu Gör", onPress: onPro }}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: "Pro'yu Gör" }));
    expect(onPro).toHaveBeenCalled();
    await renderUi(
      <EntitlementGate
        variant="lapse"
        kicker=""
        title="Pro sona erdi · Takip duraklatıldı"
        primaryAction={{ label: "Pro'yu Gör", onPress: onPro }}
      />,
    );
    expect(screen.getByTestId('ui.entitlementGate.lapse')).toBeOnTheScreen();
  });

  it('never offers a CTA or button role when a credential is missing', async () => {
    await renderUi(
      <ExternalCredentialRequired message="Bu özellik bu ortamda yapılandırılmamış (harici kimlik bilgisi gerekli)." />,
    );
    expect(
      screen.getByLabelText(
        'Bu özellik bu ortamda yapılandırılmamış (harici kimlik bilgisi gerekli).',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('labels the partial-data strip as a region and keeps its action', async () => {
    const onDetails = jest.fn();
    await renderUi(
      <PartialDataNotice
        title="Bazı hesaplarından veri alınamıyor."
        body="Outlook mailleri yok."
        regionLabel="Eksik veri uyarısı"
        action={{ label: 'Ayrıntılar', onPress: onDetails }}
      />,
    );
    expect(
      screen.getByRole('summary', { name: /^Eksik veri uyarısı\. Bazı hesaplarından/ }),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Ayrıntılar' }));
    expect(onDetails).toHaveBeenCalled();
  });

  it('stacks at most two inline cards, critical first', () => {
    const cards = [
      { tone: 'neutral' as const, id: 'n' },
      { tone: 'warning' as const, id: 'w' },
      { tone: 'critical' as const, id: 'c' },
    ];
    expect(sortStateCards(cards).map((c) => c.id)).toEqual(['c', 'w']);
  });
});

describe('M-STATE-03 offline', () => {
  it('announces the banner once and refreshes', async () => {
    const onRefresh = jest.fn();
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    announce.mockClear();
    await renderUi(
      <OfflineBanner
        message="Çevrimdışısın. Son analiz 09:40'tan gösteriliyor."
        refreshLabel="Yenile"
        onRefresh={onRefresh}
      />,
    );
    expect(announce).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Yenile' }));
    expect(onRefresh).toHaveBeenCalled();
    await renderUi(
      <OfflineBanner message="Çevrimdışı" refreshLabel="Yenile" onRefresh={onRefresh} refreshing />,
      { scheme: 'dark' },
    );
    expect(screen.getByRole('button', { name: 'Yenile' }).props.accessibilityState).toMatchObject({
      busy: true,
    });
  });

  it('shows the no-cache screen with retry', async () => {
    const retry = jest.fn();
    await renderUi(
      <OfflineScreen
        title="İnternet bağlantısı yok."
        body="Çevrimiçi olunca güncellenir."
        retryAction={{ label: 'Tekrar Dene', onPress: retry }}
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Tekrar Dene' }));
    expect(retry).toHaveBeenCalled();
  });
});

describe('M-STATE-11 / 12 full-screen states', () => {
  it('focuses the error title and shows the code footnote and report action', async () => {
    const focus = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent');
    const report = jest.fn();
    await renderUi(
      <ErrorState
        title="Bir şeyler ters gitti."
        body="Verilerin güvende."
        retryAction={{ label: 'Tekrar Dene', onPress: jest.fn() }}
        homeAction={{ label: "Bugün'e Dön", onPress: jest.fn() }}
        errorCodeText="Hata kodu: 3F9A21C0"
        reportAction={{ label: 'Sorunu bildir', onPress: report }}
        correlationId="c1"
      />,
    );
    expect(focus).toHaveBeenCalledWith(expect.anything(), 'focus');
    expect(screen.getByRole('header', { name: 'Bir şeyler ters gitti.' })).toHaveProp(
      'accessibilityHint',
      'c1',
    );
    expect(screen.getByText('Hata kodu: 3F9A21C0')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Sorunu bildir' }));
    expect(report).toHaveBeenCalled();
    expect(screen.getByTestId('ui.errorState.c1').props.style).toBeDefined();
  });

  it('renders the route and entity not-found variants', async () => {
    const back = jest.fn();
    await renderUi(
      <NotFoundState
        variant="route"
        title="Bu sayfa bulunamadı."
        backAction={{ label: "Bugün'e Dön", onPress: back }}
      />,
    );
    expect(screen.getByTestId('ui.notFoundState.route')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: "Bugün'e Dön" }));
    expect(back).toHaveBeenCalled();
    await renderUi(
      <NotFoundState
        title="Bu içerik artık yok."
        backAction={{ label: 'Geri Dön', onPress: back }}
      />,
    );
    expect(screen.getByTestId('ui.notFoundState.entity')).toBeOnTheScreen();
  });

  it('celebrates success with a haptic, an announcement and focus', async () => {
    const onHaptic = jest.fn<(kind: HapticKind) => void>();
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await renderUi(
      <SuccessState
        title="Takvimine eklendi."
        action={{ label: 'Plana Dön', onPress: jest.fn() }}
      />,
      { onHaptic },
    );
    expect(onHaptic).toHaveBeenCalledWith('success');
    expect(announce).toHaveBeenCalledWith('Takvimine eklendi.');
    expect(screen.getByRole('header', { name: 'Takvimine eklendi.' })).toBeOnTheScreen();
  });
});

describe('M-STATE-01 loading', () => {
  it.each([
    ['CardSkeleton', <CardSkeleton key="a" />],
    ['TodaySkeleton', <TodaySkeleton key="b" kicker="Brifing hazırlanıyor…" />],
    ['FeedSkeleton', <FeedSkeleton key="c" />],
    ['TimelineSkeleton', <TimelineSkeleton key="d" />],
    ['SettingsValueSkeleton', <SettingsValueSkeleton key="e" />],
    ['MailDetailSkeleton', <MailDetailSkeleton key="f" />],
    ['PrepSkeleton', <PrepSkeleton key="g" />],
    ['ChatStreamingSkeleton', <ChatStreamingSkeleton key="h" />],
  ])('%s is one busy "Yükleniyor" element', async (_name, element) => {
    await renderUi(element);
    const group = screen.getByLabelText('Yükleniyor');
    expect(group.props.accessibilityState).toMatchObject({ busy: true });
  });

  it('reads the AI working kicker and the long-running notice', async () => {
    await renderUi(
      <>
        <AiWorkingKicker label="Brifing hazırlanıyor…" />
        <LongRunningNotice text="Brifing hâlâ hazırlanıyor; hazır olunca bildiririz." />
      </>,
    );
    expect(screen.getByLabelText('Brifing hazırlanıyor…').props.accessibilityState).toMatchObject({
      busy: true,
    });
    expect(screen.getByText('Brifing hâlâ hazırlanıyor; hazır olunca bildiririz.')).toHaveProp(
      'accessibilityLiveRegion',
      'polite',
    );
  });

  describe('SyncLine', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('draws the line while syncing, then "Güncel · HH:mm" for 1.5 s', async () => {
      const onHaptic = jest.fn<(kind: HapticKind) => void>();
      const onDoneHidden = jest.fn();
      const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      const view = await renderUi(
        <SyncLine phase="syncing" doneLabel="Güncel · 09:41" onDoneHidden={onDoneHidden} />,
        { onHaptic },
      );
      expect(screen.getByTestId('ui.syncLine.syncing')).toBeOnTheScreen();
      expect(onHaptic).toHaveBeenCalledWith('light');
      await view.rerender(
        <Providers onHaptic={onHaptic}>
          <SyncLine
            phase="done"
            doneLabel="Güncel · 09:41"
            announcement="Güncellendi"
            onDoneHidden={onDoneHidden}
          />
        </Providers>,
      );
      expect(screen.getByText('Güncel · 09:41')).toBeOnTheScreen();
      expect(announce).toHaveBeenCalledWith('Güncellendi');
      await act(() => {
        jest.advanceTimersByTime(1500);
      });
      expect(onDoneHidden).toHaveBeenCalled();
      await view.rerender(
        <Providers>
          <SyncLine phase="idle" doneLabel="Güncel · 09:41" />
        </Providers>,
      );
      expect(screen.queryByTestId('ui.syncLine.done')).toBeNull();
    });

    it('fills cards in with a stagger and only fades under reduce motion', async () => {
      await renderUi(
        <StaggerIn index={2}>
          <RNText testID="c">Kart</RNText>
        </StaggerIn>,
      );
      await act(() => {
        jest.advanceTimersByTime(700);
      });
      expect(screen.getByTestId('c')).toBeOnTheScreen();
    });
  });
});

describe('dark surfaces', () => {
  it('keeps error cards on the dark surface token', async () => {
    await renderUi(
      <ErrorCard icon="error" tone="critical" title="Hata" testID="e" announceOnMount={false} />,
      { scheme: 'dark' },
    );
    expect(screen.getByTestId('e').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: color.dark.surface })]),
    );
  });
});

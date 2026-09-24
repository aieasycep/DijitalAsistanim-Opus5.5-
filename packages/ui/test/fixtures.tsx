/**
 * One representative element per exported component. `contract.test.tsx` renders every entry in
 * both schemes (render smoke, dark "no hard-coded white", interactive-accessibility contract) and
 * fails when an exported component has no fixture.
 */
import { jest } from '@jest/globals';
import type { ReactElement } from 'react';
import { Text as RNText, View } from 'react-native';
import * as ui from '../src/index.ts';

const fn = (): jest.Mock<() => void> => jest.fn<() => void>();
const IMAGE = { uri: 'https://example.invalid/capture.png' };

export const fixtures: Record<string, () => ReactElement> = {
  // Providers
  ThemeProvider: () => (
    <ui.ThemeProvider preference="dark">
      <ui.Text>Tema</ui.Text>
    </ui.ThemeProvider>
  ),
  UiPreferencesProvider: () => (
    <ui.UiPreferencesProvider locale="en" screenReaderEnabled={false} reduceTransparency={false}>
      <ui.Text>Tercihler</ui.Text>
    </ui.UiPreferencesProvider>
  ),
  DaUiProvider: () => (
    <ui.DaUiProvider themePreference="light" screenReaderEnabled={false} reduceTransparency={false}>
      <ui.Text>Kit</ui.Text>
    </ui.DaUiProvider>
  ),
  ToastProvider: () => (
    <ui.ToastProvider>
      <ui.Text>Toast</ui.Text>
    </ui.ToastProvider>
  ),

  // Primitives
  Icon: () => <ui.Icon name="sunny" color="currentColor" accessibilityLabel="Bugün" />,
  Text: () => <ui.Text variant="kicker">önceliklerin</ui.Text>,
  PressableScale: () => (
    <ui.PressableScale accessibilityLabel="Bas" onPress={fn()}>
      <ui.Text>Bas</ui.Text>
    </ui.PressableScale>
  ),
  Surface: () => (
    <ui.Surface padding={16}>
      <ui.Text>Yüzey</ui.Text>
    </ui.Surface>
  ),
  Card: () => (
    <ui.Card onPress={fn()} accessibilityLabel="Kart">
      <ui.Text>Kart</ui.Text>
    </ui.Card>
  ),
  AiGlowSurface: () => (
    <ui.AiGlowSurface>
      <ui.Text>AI</ui.Text>
    </ui.AiGlowSurface>
  ),
  InkSurface: () => (
    <ui.InkSurface>
      <ui.Text tone="onInk">Mürekkep</ui.Text>
    </ui.InkSurface>
  ),
  GradientSurface: () => (
    <ui.GradientSurface gradient="dawn" padding={20}>
      <ui.Text tone="onGradient">Şafak</ui.Text>
    </ui.GradientSurface>
  ),
  GradientFill: () => (
    <View style={{ width: 100, height: 40 }}>
      <ui.GradientFill gradient={ui.themes.light.fixedGradients.night} />
    </View>
  ),
  Divider: () => <ui.Divider />,
  IllustrationFrame: () => (
    <ui.IllustrationFrame accessibilityLabel="Örnek bildirimler" tilt={2}>
      <ui.Text>Görsel</ui.Text>
    </ui.IllustrationFrame>
  ),
  IconTile: () => <ui.IconTile icon="mail" size={36} tone="critical" />,
  Spinner: () => <ui.Spinner size={22} />,
  SkeletonBlock: () => <ui.SkeletonBlock width="60%" height={16} testID="sk" />,
  SkeletonGroup: () => (
    <ui.SkeletonGroup>
      <ui.SkeletonBlock height={12} />
    </ui.SkeletonGroup>
  ),

  // Buttons
  Button: () => <ui.Button label="Brifingimi Gör" onPress={fn()} />,
  PrimaryButton: () => <ui.PrimaryButton label="Onayla" onPress={fn()} />,
  TonalButton: () => <ui.TonalButton label="Düzenle" onPress={fn()} />,
  SecondaryButton: () => <ui.SecondaryButton label="Reddet" onPress={fn()} />,
  PillButton: () => (
    <ui.PillButton label="Kişi Ekle" icon="person_add" tint="primary" onPress={fn()} />
  ),
  IconButton: () => <ui.IconButton icon="arrow_back" accessibilityLabel="Geri" onPress={fn()} />,
  CardIconAction: () => (
    <ui.CardIconAction
      kind="complete"
      accessibilityLabel="Tamamlandı olarak işaretle"
      onPress={fn()}
    />
  ),
  TextAction: () => <ui.TextAction label="Yanıt Hazırla" onPress={fn()} />,
  CardActions: () => (
    <ui.CardActions>
      <ui.TextAction label="Yanıt Hazırla" onPress={fn()} />
    </ui.CardActions>
  ),
  ActionTile: () => <ui.ActionTile label="Yanıtla" icon="send" onPress={fn()} primary />,
  ActionTileGrid: () => (
    <ui.ActionTileGrid>
      <ui.ActionTile label="Yanıtla" icon="send" onPress={fn()} />
    </ui.ActionTileGrid>
  ),
  AuthProviderButton: () => (
    <ui.AuthProviderButton kind="email" label="E-posta ile devam et" onPress={fn()} />
  ),
  OutlineAddButton: () => <ui.OutlineAddButton label="Kural Ekle" onPress={fn()} />,
  HeaderPill: () => <ui.HeaderPill label="2 onay" icon="task_alt" onPress={fn()} />,

  // Badges & chips
  Badge: () => <ui.Badge label="acil" category="urgent" />,
  StatusPill: () => <ui.StatusPill label="İşleniyor" tone="neutral" busy />,
  PlanBadge: () => <ui.PlanBadge label="Pro" />,
  FilterChip: () => <ui.FilterChip label="Tümü" selected onPress={fn()} />,
  FilterChipRow: () => (
    <ui.FilterChipRow
      items={[
        { key: 'tumu', label: 'Tümü' },
        { key: 'onemli', label: 'Önemli' },
      ]}
      selectedKey="tumu"
      onSelect={fn()}
    />
  ),
  MetaChip: () => <ui.MetaChip label="Yarın" icon="schedule" onPress={fn()} />,
  ConnectPill: () => <ui.ConnectPill state="connect" label="Bağla" onPress={fn()} />,
  AssistChip: () => <ui.AssistChip label="Kısalt" icon="short_text" onPress={fn()} />,
  SuggestionChip: () => <ui.SuggestionChip label="Bugün ne var?" onPress={fn()} />,
  TokenChip: () => (
    <ui.TokenChip label="teklif" onRemove={fn()} removeLabel="teklif kelimesini kaldır" />
  ),
  ChoiceChip: () => <ui.ChoiceChip label="Google" selected onPress={fn()} />,
  SourceChip: () => <ui.SourceChip label="Gmail" icon="mail" onPress={fn()} />,
  FollowUpChip: () => <ui.FollowUpChip label="Başka ne var?" onPress={fn()} />,
  VoicePromptChip: () => <ui.VoicePromptChip label="Bugün ne var?" onPress={fn()} />,
  RecipientChip: () => <ui.RecipientChip name="Mehmet Yılmaz" detail="Re: Sözleşme" />,
  ChipWrap: () => (
    <ui.ChipWrap>
      <ui.MetaChip label="12 Eylül" />
    </ui.ChipWrap>
  ),
  CountdownPill: () => (
    <ui.CountdownPill
      startsAt={Date.now() + 18 * 60_000}
      format={(m) => `${String(m)} dk`}
      startedLabel="Başladı"
    />
  ),
  Avatar: () => <ui.Avatar name="Ahmet Yılmaz" id="c1" size={40} />,
  AvatarPair: () => (
    <ui.AvatarPair first={{ name: 'Ahmet Yılmaz' }} second={{ name: 'Selin Kaya' }} />
  ),

  // Navigation
  RootHeader: () => (
    <ui.RootHeader
      kicker="23 eylül salı"
      title="Günaydın, Yunus"
      avatar={{ name: 'Yunus', onPress: fn(), accessibilityLabel: 'Profil ve ayarlar' }}
    />
  ),
  LargeTitleHeader: () => <ui.LargeTitleHeader kicker="23 eylül salı" title="Akış" />,
  DetailHeader: () => <ui.DetailHeader kicker="mail" onLeadingPress={fn()} />,
  NavHeader: () => <ui.NavHeader kicker="mail" leading="close" onLeadingPress={fn()} />,
  GradientHeader: () => (
    <ui.GradientHeader kicker="sabah brifingi" title="Günaydın" subtitle="5 konu" />
  ),
  OverlappingSheet: () => (
    <ui.OverlappingSheet>
      <ui.Text>İçerik</ui.Text>
    </ui.OverlappingSheet>
  ),
  StepHeader: () => (
    <ui.StepHeader kicker="adım 1 / 4" onBack={fn()} skip={{ label: 'Atla', onPress: fn() }} />
  ),
  PageDots: () => <ui.PageDots count={4} index={1} valueText="Sayfa 2 / 4" onChange={fn()} />,
  TabBar: () => (
    <ui.TabBar
      items={[
        { key: 'today', label: 'Bugün', icon: 'sunny' },
        { key: 'flow', label: 'Akış', icon: 'dynamic_feed' },
      ]}
      activeKey="today"
      onTabPress={fn()}
    />
  ),

  // Lists
  SectionHeader: () => <ui.SectionHeader title="Önceliklerin" count="5 konu" />,
  SectionKicker: () => <ui.SectionKicker title="Acil" variant="dot" tone="critical" />,
  GroupedList: () => (
    <ui.GroupedList>
      <ui.ListRow
        title="Bildirimler"
        icon="notifications"
        trailing={{ kind: 'chevron' }}
        onPress={fn()}
      />
      <ui.ListRow title="Haptik" trailing={{ kind: 'switch', value: true }} onPress={fn()} />
    </ui.GroupedList>
  ),
  ListRow: () => (
    <ui.ListRow
      title="Brifing"
      subtitle="08:00 · 13:00"
      trailing={{ kind: 'value', text: '3', chevron: true }}
      onPress={fn()}
    />
  ),
  CategoryRow: () => (
    <ui.CategoryRow label="Önemli" count="3" icon="priority_high" hot onPress={fn()} />
  ),
  OptionRow: () => (
    <ui.OptionRow label="Uygun zamanda" ai meta="16:30" role="radio" selected onPress={fn()} />
  ),
  ChecklistRow: () => (
    <ui.ChecklistRow
      label="Teklifi gönder"
      state="open"
      onToggle={fn()}
      toggleActionLabel="Tamamlandı olarak işaretle"
    />
  ),
  TimelineRow: () => (
    <ui.TimelineRow time="09:00" title="Ekip toplantısı" status="Bitti" statusTone="success" />
  ),
  KeyValueGrid: () => (
    <ui.KeyValueGrid
      items={[
        { key: 'why', label: 'Neden', value: 'Ahmet cevap bekliyor' },
        { key: 'source', label: 'Kaynak', value: 'Gmail', onPress: fn() },
      ]}
    />
  ),
  SwipeableRow: () => (
    <ui.SwipeableRow
      right={{ key: 'complete', label: 'Tamamlandı', onAction: fn() }}
      left={[{ key: 'snooze', label: 'Ertele', onAction: fn() }]}
      accessibilityLabel="Kart"
    >
      <ui.Card>
        <ui.Text>Kart</ui.Text>
      </ui.Card>
    </ui.SwipeableRow>
  ),

  // Inputs
  SwitchTrack: () => <ui.SwitchTrack value />,
  Switch: () => <ui.Switch value accessibilityLabel="Haptik" onValueChange={fn()} />,
  SegmentedControl: () => (
    <ui.SegmentedControl
      options={[
        { key: 'day', label: 'Gün' },
        { key: 'week', label: 'Hafta' },
      ]}
      selectedKey="day"
      onChange={fn()}
      semantics="tabs"
    />
  ),
  RadioIndicator: () => <ui.RadioIndicator selected />,
  CheckIndicator: () => <ui.CheckIndicator selected variant="done" />,
  TextField: () => (
    <ui.TextField value="" onChangeText={fn()} label="E-posta" placeholder="ad@ornek.com" />
  ),
  UrlField: () => <ui.UrlField value="" onChangeText={fn()} accessibilityLabel="Bağlantı" />,
  SearchField: () => <ui.SearchField value="teklif" onChangeText={fn()} accessibilityLabel="Ara" />,
  CaptureTextField: () => (
    <ui.CaptureTextField
      value=""
      onChangeText={fn()}
      accessibilityLabel="Not"
      counterText="0 / 4.000"
    />
  ),
  ChatComposer: () => (
    <ui.ChatComposer
      value=""
      onChangeText={fn()}
      onSend={fn()}
      onMic={fn()}
      accessibilityLabel="Soru"
      sendLabel="Gönder"
      micLabel="Sesli sor"
    />
  ),
  ChatInput: () => (
    <ui.ChatInput
      value="Merhaba"
      onChangeText={fn()}
      onSend={fn()}
      accessibilityLabel="Soru"
      sendLabel="Gönder"
    />
  ),
  TimeChip: () => (
    <ui.TimeChip
      value="08:00"
      onPress={fn()}
      accessibilityLabel="Sabah brifingi saati 08:00, değiştir"
    />
  ),
  PlanOptionCard: () => (
    <ui.PlanOptionCard
      title="Yıllık"
      priceLine="₺499,99 / yıl"
      badge="En avantajlı"
      selected
      onPress={fn()}
    />
  ),
  SelectableTile: () => <ui.SelectableTile label="İş" icon="work" selected onPress={fn()} />,
  ThemePreviewTile: () => (
    <ui.ThemePreviewTile label="Sistem" mode="system" selected onPress={fn()} />
  ),
  Accordion: () => (
    <ui.Accordion title="Orijinal Mail" icon="mail" expanded onToggle={fn()}>
      <ui.Text>Gövde</ui.Text>
    </ui.Accordion>
  ),
  StickyCTABar: () => (
    <ui.StickyCTABar>
      <ui.Button label="Göndermeyi Onayla" onPress={fn()} size="lg" fullWidth />
    </ui.StickyCTABar>
  ),

  // Provenance
  SourceLine: () => (
    <ui.SourceLine
      icon="mail"
      parts={['Gmail', 'Ahmet Yılmaz', '08:42']}
      onPress={fn()}
      accessibilityHint="Bu nereden çıktı?"
    />
  ),
  SourceTag: () => <ui.SourceTag icon="event" parts={['Takvim', '09:00']} onPress={fn()} />,
  MetaLine: () => <ui.MetaLine parts={['60 dk', 'Ofis']} icon="schedule" />,
  ProvenanceFooter: () => <ui.ProvenanceFooter text="46 mail, 1 takvim analiz edildi · 07:58" />,
  ConfidenceText: () => (
    <ui.ConfidenceText
      coverage={0.92}
      label="3 kaynaktan · %92 eşleşme"
      uncertainLabel="Emin değilim"
    />
  ),
  ConfidenceChip: () => <ui.ConfidenceChip label="Emin değilim · onayla" onConfirm={fn()} />,
  AssuranceNote: () => <ui.AssuranceNote text="Sen onaylamadan hiçbir mail gönderilmez." />,
  TrustLine: () => <ui.TrustLine text="Sen onaylamadan hiçbir mail gönderilmez." />,
  AIHint: () => <ui.AIHint text="Salı günleri toplantıların yoğun." />,
  HintRow: () => <ui.HintRow text="Salı günleri toplantıların yoğun." />,
  PrivacyNote: () => <ui.PrivacyNote text="Mail içeriğinin tamamı saklanmaz." />,
  FeedbackActions: () => (
    <ui.FeedbackActions
      positiveLabel="Doğru"
      negativeLabel="Önemli değil"
      value={null}
      onPositive={fn()}
      onNegative={fn()}
    />
  ),
  WhySheetContent: () => (
    <ui.WhySheetContent
      title="Neden önemli?"
      reason="Ahmet Yılmaz VIP ve son tarih içeriyor."
      tier={{ kind: 'deterministic_signal', text: 'Sinyal: VIP kişi · son tarih içeriyor' }}
      source={{
        icon: 'mail',
        parts: ['Gmail', '08:42'],
        openLabel: 'Orijinalini aç',
        onOpen: fn(),
      }}
      options={[{ key: 'lower', label: 'Önemli değil', icon: 'remove_circle', onPress: fn() }]}
      ruleAction={{ label: 'Kural oluştur', onPress: fn() }}
    />
  ),
  ExplainSheetContent: () => (
    <ui.ExplainSheetContent
      title="Neden önemli?"
      reason="Kuralın eşleşti."
      tier={{ kind: 'explicit_rule', text: 'Senin kuralın: Kuzey Lojistik' }}
    />
  ),

  // Cards
  CardTextActions: () => (
    <ui.CardTextActions actions={[{ key: 'reply', label: 'Yanıt Hazırla', onPress: fn() }]} />
  ),
  InlineCardError: () => (
    <ui.InlineCardError message="Bu kart yüklenemedi." retryLabel="Tekrar dene" onRetry={fn()} />
  ),
  PriorityCard: () => (
    <ui.PriorityCard
      title="Revize teklif bugün bekleniyor"
      badge={{ label: 'Acil', category: 'urgent' }}
      time="08:42"
      source={{ icon: 'mail', parts: ['Gmail', 'Ahmet Yılmaz', '08:42'], onPress: fn() }}
      actions={[{ key: 'reply', label: 'Yanıt Hazırla', onPress: fn() }]}
      onPress={fn()}
      onComplete={fn()}
      completeLabel="Tamamlandı"
      onMore={fn()}
      moreLabel="Diğer seçenekler"
    />
  ),
  AttentionCard: () => (
    <ui.AttentionCard
      title="Sözleşme maddesi"
      summary="Selin madde 4'ü sordu."
      sourceName="Gmail · Selin Kaya"
      sourceIcon="mail"
      badge={{ label: 'Son tarih', category: 'deadline' }}
      action={{ key: 'reply', label: 'Yanıt Hazırla', onPress: fn() }}
      onPress={fn()}
    />
  ),
  MailSummaryCard: () => (
    <ui.MailSummaryCard
      senderName="Ahmet Yılmaz"
      time="08:42"
      summary="Revize teklifi bugün istiyor."
      onPress={fn()}
    />
  ),
  AnnouncementCard: () => (
    <ui.AnnouncementCard
      title="Yeni: Akşam kapanışı"
      body="Günü kapat."
      onDismiss={fn()}
      dismissLabel="Duyuruyu kapat"
    />
  ),
  LifeCard: () => (
    <ui.LifeCard
      icon="package_2"
      typeLabel="Kargo"
      time="09:10"
      title="Paketin yolda"
      subtitle="Yarın teslim"
      onPress={fn()}
    />
  ),
  AiKicker: () => <ui.AiKicker label="Takvim zekâsı" />,
  AiCard: () => (
    <ui.AiCard
      kicker="Takvim zekâsı"
      title="Salı öğleden sonra boş"
      body="2 saatlik odak bloğu önerebilirim."
      primaryAction={{ label: 'Planla', icon: 'event_available', onPress: fn() }}
      secondaryAction={{ label: 'Başka zaman', onPress: fn() }}
    />
  ),
  AICard: () => <ui.AICard kicker="AI" title="Öneri" state="accepted" stateLabel="Planlandı" />,
  BriefingHero: () => (
    <ui.BriefingHero
      kicker="Brifing hazır · 07:58"
      sentence={{ before: 'Bugün bilmen gereken ', count: '5', after: ' şey var.' }}
      context="3 önemli mail · 4 etkinlik"
      primaryAction={{ label: 'Brifingimi Gör', onPress: fn() }}
      listenAction={{ label: 'Dinle · 2 dk', onPress: fn() }}
    />
  ),
  ProGateCard: () => (
    <ui.ProGateCard
      kicker="Öğle nabzı · Pro"
      title="Sabahtan beri 3 yeni konu var."
      primaryAction={{ label: "Pro'yu Gör", onPress: fn() }}
      dismissAction={{ label: 'Şimdi değil', onPress: fn() }}
    />
  ),
  TalkingPointsCard: () => (
    <ui.TalkingPointsCard
      kicker="3 şey"
      points={[{ key: 'a', title: 'Teklif', body: 'Revize fiyat' }]}
      onPointLongPress={fn()}
      pointLongPressLabel="Bu nereden çıktı?"
    />
  ),
  RichAnswerCard: () => (
    <ui.RichAnswerCard
      kicker="Kişiler"
      rows={[
        {
          key: 'm',
          title: 'Mehmet Yılmaz',
          meta: 'Yılmaz Endüstri',
          person: { name: 'Mehmet Yılmaz' },
          onPress: fn(),
        },
      ]}
    />
  ),
  DraftCard: () => (
    <ui.DraftCard
      kicker="Taslak · Mehmet"
      preview="Merhaba Mehmet Bey,"
      approveAction={{ label: 'Göndermeyi Onayla', onPress: fn() }}
      editAction={{ label: 'Düzenle', onPress: fn() }}
    />
  ),
  DraftEditorCard: () => (
    <ui.DraftEditorCard
      kicker="AI taslağı · Profesyonel"
      value="Merhaba"
      onChangeText={fn()}
      accessibilityLabel="Yanıt taslağı"
    />
  ),
  SourceResultCard: () => (
    <ui.SourceResultCard
      sourceIcon="mail"
      sourceName="Gmail"
      date="12 Eyl"
      title="Sözleşme"
      excerpt="Madde 4"
      openLabel="Orijinali Aç"
      onOpen={fn()}
    />
  ),
  FollowUpCard: () => (
    <ui.FollowUpCard
      personName="Mehmet Yılmaz"
      topic="Sözleşme"
      waitLabel="3 gün"
      waitTone="warning"
      status="Teklifine 3 gündür yanıt gelmedi."
      draftAction={{ label: 'Takip Mesajı Hazırla', onPress: fn() }}
      remindAction={{ label: 'Yarın Hatırlat', onPress: fn() }}
      closeAction={{ label: 'Kapat', onPress: fn() }}
    />
  ),
  WaitingCard: () => (
    <ui.WaitingCard
      personName="Ahmet Yılmaz"
      waitMeta="2 gündür bekliyor"
      topic="Teklif"
      deadline={{ label: 'Bugün 17:00', tone: 'critical' }}
      action={{ label: 'Yanıtla', onPress: fn() }}
    />
  ),
  PersonActionCard: () => (
    <ui.PersonActionCard
      personName="Selin Kaya"
      waitMeta="3 gün"
      topic="Madde 4"
      vip
      vipLabel="VIP"
    />
  ),
  CommitmentCard: () => (
    <ui.CommitmentCard
      status={{ label: 'Bugün', tone: 'warning' }}
      date="Bugün"
      quote="Cuma'ya kadar gönderirim"
      details={[{ key: 'what', label: 'Taahhüt', value: 'Teklif' }]}
      completeAction={{ label: 'Tamamlandı', onPress: fn() }}
      snoozeAction={{ label: 'Ertele', onPress: fn() }}
      sourceAction={{ label: 'Kaynağı Gör', onPress: fn() }}
    />
  ),
  CalendarIntelCard: () => (
    <ui.CalendarIntelCard
      icon="bolt"
      iconTone="warning"
      title="Yoğun gün"
      body="6 saat toplantı"
      actions={[{ key: 'plan', label: 'Odak ekle', onPress: fn() }]}
    />
  ),
  InkCallout: () => (
    <ui.InkCallout title="Onay Merkezi" subtitle="2 işlem" icon="task_alt" onPress={fn()} />
  ),
  StatTile: () => <ui.StatTile label="Okunan" value="46" />,
  HeroStat: () => <ui.HeroStat value="83" label="mail okundu" />,
  SuggestedSurface: () => (
    <ui.SuggestedSurface
      title="Odak bloğu"
      meta="Önerilen · 45 dk"
      proposedLabel="Önerilen · henüz gerçek değil"
      accessibilityLabel="Önerilen, henüz takvimde değil: Odak bloğu"
      onPress={fn()}
    />
  ),
  GapBlock: () => <ui.GapBlock label="2 saat boşluk" onPress={fn()} />,
  ConflictPair: () => (
    <ui.ConflictPair
      first={{ time: '14:00', title: 'Müşteri' }}
      second={{ time: '14:30', title: 'Doktor' }}
      accessibilityLabel="Çakışma"
      onPress={fn()}
    />
  ),
  ApprovalCard: () => (
    <ui.ApprovalCard
      actionType="email_send"
      typeLabel="Mail gönder"
      status="pending"
      statusLabel="Bekliyor"
      time="09:12"
      title="Mehmet'e takip mesajı"
      details={[{ key: 'why', label: 'Neden', value: '3 gündür yanıt yok' }]}
      approve={{ label: 'Onayla', onPress: fn(), busyLabel: 'Gönderiliyor…' }}
      edit={{ label: 'Düzenle', onPress: fn() }}
      reject={{ label: 'Reddet', onPress: fn() }}
    />
  ),
  ApprovalRow: () => (
    <ui.ApprovalRow
      actionType="calendar_create"
      typeLabel="Etkinlik ekle"
      title="Konser"
      selected
      onToggle={fn()}
    />
  ),
  SenderHeader: () => (
    <ui.SenderHeader
      name="Mehmet Yılmaz"
      meta="mehmet@… · 08:42"
      vip
      vipLabel="VIP"
      badge={{ label: 'Acil', category: 'urgent' }}
    />
  ),

  // Audio & voice
  MiniPlayer: () => (
    <ui.MiniPlayer
      title="Sabah Brifingi · Öncelikler"
      timeText="0:42 / 2:14"
      progress={0.3}
      playing={false}
      onPlayPause={fn()}
      onClose={fn()}
      onExpand={fn()}
      playLabel="Oynat"
      pauseLabel="Duraklat"
      closeLabel="Kapat"
      expandLabel="Oynatıcıyı aç"
    />
  ),
  SpeedPill: () => (
    <ui.SpeedPill label="1.0x" onPress={fn()} accessibilityLabel="Oynatma hızı 1.0x" />
  ),
  Waveform: () => <ui.Waveform progress={0.4} playing={false} bars={8} />,
  Scrubber: () => (
    <ui.Scrubber
      positionS={42}
      durationS={134}
      onSeek={fn()}
      valueText="0:42 / 2:14"
      accessibilityLabel="Konum"
    />
  ),
  TransportControls: () => (
    <ui.TransportControls
      playing={false}
      onPlayPause={fn()}
      onSkipBack={fn()}
      onSkipForward={fn()}
      playLabel="Oynat"
      pauseLabel="Duraklat"
      skipBackLabel="15 saniye geri"
      skipForwardLabel="15 saniye ileri"
      skipCaption="15"
    />
  ),
  AudioControls: () => (
    <ui.AudioControls
      playing
      onPlayPause={fn()}
      onSkipBack={fn()}
      onSkipForward={fn()}
      playLabel="Oynat"
      pauseLabel="Duraklat"
      skipBackLabel="15 saniye geri"
      skipForwardLabel="15 saniye ileri"
      skipCaption="15"
    />
  ),
  ChapterList: () => (
    <ui.ChapterList
      chapters={[{ key: 'a', index: '01', title: 'Genel bakış', duration: '0:18' }]}
      activeKey="a"
      onSelect={fn()}
    />
  ),
  NativeTtsNotice: () => <ui.NativeTtsNotice text="Cihaz sesiyle okunuyor · bölüm bölüm ilerler" />,
  FullPlayer: () => (
    <ui.FullPlayer
      kicker="Sesli brifing"
      title="Sabah Brifingi"
      meta="23 Eylül · 2 dk"
      onCollapse={fn()}
      collapseLabel="Küçült"
      speed={{ label: '1.0x', onPress: fn(), accessibilityLabel: 'Hız' }}
      progress={0.2}
      playing={false}
      scrubber={{
        positionS: 10,
        durationS: 100,
        onSeek: fn(),
        valueText: '0:10 / 1:40',
        accessibilityLabel: 'Konum',
      }}
      transport={{
        playing: false,
        onPlayPause: fn(),
        onSkipBack: fn(),
        onSkipForward: fn(),
        playLabel: 'Oynat',
        pauseLabel: 'Duraklat',
        skipBackLabel: 'Geri',
        skipForwardLabel: 'İleri',
        skipCaption: '15',
      }}
      chapters={{
        chapters: [{ key: 'a', index: '01', title: 'Genel bakış', duration: '0:18' }],
        onSelect: fn(),
      }}
    />
  ),
  VoiceOrb: () => <ui.VoiceOrb listening onPress={fn()} accessibilityLabel="Dinlemeyi durdur" />,
  VoiceWaveform: () => <ui.VoiceWaveform active={false} />,
  MiniWaveform: () => <ui.MiniWaveform active={false} />,
  TranscriptText: () => <ui.TranscriptText text="Yarın ilk toplantım ne?" />,
  AnswerBubble: () => <ui.AnswerBubble>Yarın 09:00 ekip toplantısı.</ui.AnswerBubble>,
  TranscriptCard: () => (
    <ui.TranscriptCard transcript="Mehmet'e cuma dönüş yapacağım" caption="0:07 · dinleniyor" />
  ),
  PulsingRing: () => <ui.PulsingRing />,
  TypingIndicator: () => <ui.TypingIndicator accessibilityLabel="Yanıt hazırlanıyor" />,

  // Plan
  DayChip: () => (
    <ui.DayChip
      weekday="Cum"
      day="5"
      today
      dot="events"
      onPress={fn()}
      accessibilityLabel="Cuma 5 Eylül, 4 etkinlik"
    />
  ),
  DayStrip: () => (
    <ui.DayStrip>
      <ui.DayChip weekday="Cum" day="5" onPress={fn()} accessibilityLabel="Cuma 5 Eylül" />
    </ui.DayStrip>
  ),
  TimelineBlock: () => (
    <ui.TimelineBlock title="Ekip toplantısı" meta="10:00–11:00" onPress={fn()} />
  ),
  TimelineBlockRow: () => (
    <ui.TimelineBlockRow time="10:00" nowAt={0.5}>
      <ui.TimelineBlock
        kind="deadline"
        title="Teklif"
        meta="Mailden tespit edildi"
        onPress={fn()}
      />
    </ui.TimelineBlockRow>
  ),
  StackedBar: () => <ui.StackedBar meetingPx={40} focusPx={20} />,
  WeekDensityChart: () => (
    <ui.WeekDensityChart
      kicker="1–7 Eylül · Yoğunluk"
      days={[
        {
          key: 'mon',
          label: 'Pzt',
          meetingMinutes: 120,
          focusMinutes: 60,
          accessibilityLabel: 'Pazartesi 2 saat toplantı',
        },
      ]}
      onDayPress={fn()}
      legend={{ meeting: 'Toplantı', focus: 'Odak', busy: 'Yoğun' }}
      accessibilityLabel="Haftalık yoğunluk"
    />
  ),

  // Capture
  CaptureSourceTiles: () => (
    <ui.CaptureSourceTiles
      sources={[{ key: 'photo', label: 'Fotoğraf', icon: 'photo_camera' }]}
      selectedKey="photo"
      onSelect={fn()}
    />
  ),
  DetectionBox: () => (
    <View style={{ width: 100, height: 100 }}>
      <ui.DetectionBox x={0.1} y={0.2} width={0.5} height={0.2} tag="tarih" />
    </View>
  ),
  MediaPreview: () => <ui.MediaPreview source={IMAGE} accessibilityLabel="Fatura fotoğrafı" />,
  LinkPreviewCard: () => <ui.LinkPreviewCard domain="ornek.com" title="Etkinlik" onPress={fn()} />,
  ExtractedItemRow: () => (
    <ui.ExtractedItemRow
      type="deadline"
      typeLabel="Son tarih"
      title="12 Eylül"
      selected
      onToggle={fn()}
    />
  ),
  EntityHighlightText: () => (
    <ui.EntityHighlightText
      segments={[
        { key: 'a', text: 'Yarın ' },
        { key: 'b', text: '14:00', kind: 'time' },
      ]}
    />
  ),
  EntityLegend: () => (
    <ui.EntityLegend
      labels={{ time: 'Zaman', person: 'Kişi', task: 'Görev', reminder: 'Hatırlatıcı' }}
    />
  ),
  FileRow: () => <ui.FileRow name="Sözleşme.pdf" meta="2 MB" selected onPress={fn()} />,
  AnalysisProgressCard: () => (
    <ui.AnalysisProgressCard
      kicker="PDF analiz ediliyor…"
      steps={[
        { key: 'a', label: 'Metin okunuyor', state: 'done' },
        { key: 'b', label: 'Tarihler', state: 'active' },
        { key: 'c', label: 'Kişiler', state: 'pending' },
      ]}
      stateLabels={{ done: 'tamamlandı', active: 'sürüyor', pending: 'bekliyor' }}
      cancel={{ label: 'İptal', onPress: fn() }}
    />
  ),
  ProcessingChecklist: () => (
    <ui.ProcessingChecklist
      kicker="Analiz"
      steps={[{ key: 'a', label: 'Mail', state: 'done' }]}
      stateLabels={{ done: 'tamam', active: 'sürüyor', pending: 'bekliyor' }}
      onGradient
    />
  ),

  // Account & onboarding
  IntegrationRow: () => (
    <ui.IntegrationRow
      logo={<RNText>G</RNText>}
      name="Gmail"
      meta="yu***@gmail.com"
      state="connected"
      stateLabel="Bağlandı"
      onPress={fn()}
    />
  ),
  ReasonRow: () => <ui.ReasonRow icon="event" text="Toplantılarını hazırlarım." />,
  AssuranceBox: () => (
    <ui.AssuranceBox
      rows={[{ key: 'a', icon: 'verified_user', text: 'Sen onaylamadan hiçbir şey yapılmaz.' }]}
    />
  ),
  PermissionExplainer: () => (
    <ui.PermissionExplainer
      icon="mail"
      kicker="Mail"
      title="Gmail'ini bağla"
      providers={[{ key: 'google', label: 'Google' }]}
      selectedProvider="google"
      onSelectProvider={fn()}
      reasons={[{ key: 'a', icon: 'priority_high', text: 'Önemli mailleri öne çıkarırım.' }]}
      primaryAction={{ label: 'Google ile Bağlan', onPress: fn() }}
      secondaryAction={{ label: 'Şimdi değil', onPress: fn() }}
      footnote="İzinleri istediğin zaman kaldırabilirsin."
    />
  ),
  NotificationPreview: () => (
    <ui.NotificationPreview
      items={[{ key: 'a', appName: 'Dijital Asistan', time: 'şimdi', body: 'Brifingin hazır.' }]}
      accessibilityLabel="Örnek bildirim"
    />
  ),
  PlanComparisonTable: () => (
    <ui.PlanComparisonTable
      freeLabel="Free"
      proLabel="Pro"
      rows={[
        {
          key: 'a',
          label: 'Öğle nabzı',
          free: false,
          pro: true,
          accessibilityLabel: 'Öğle nabzı: Pro',
        },
      ]}
    />
  ),
  ReferralLinkField: () => (
    <ui.ReferralLinkField
      link="https://dijitalasistan.app/r/AB12CD"
      copyLabel="Kopyala"
      onCopy={fn()}
    />
  ),
  InviteRow: () => (
    <ui.InviteRow name="Selin Kaya" status="Katıldı" pill={{ label: '+14 gün', tone: 'success' }} />
  ),
  RulePreviewCard: () => (
    <ui.RulePreviewCard
      kicker="3 mail bu kurala uydu"
      samples={[{ key: 'a', text: 'Kuzey Lojistik · Teklif', date: '12 Eyl' }]}
      footer="1 mail yukarı taşınacak."
    />
  ),

  // Editorial
  EditorialParagraph: () => (
    <ui.EditorialParagraph
      spans={[
        { key: 'a', text: 'Bugün ' },
        { key: 'b', text: 'üç önemli', bold: true },
        { key: 'c', text: ' konu var.' },
      ]}
    />
  ),
  EditorialStatRow: () => <ui.EditorialStatRow value="46" label="mail okundu" highlighted first />,
  HighlightCard: () => <ui.HighlightCard kicker="Haftanın" figure="12 sa" note="toplantı" />,
  ShareCardTemplate: () => (
    <ui.ShareCardTemplate
      format="4:5"
      brandName="Dijital Asistan"
      kicker="Haftam"
      headline="Bu hafta 214 mail okundu."
      stats={[{ key: 'a', value: '214', label: 'mail' }]}
      tagline="Bugün bilmen gerekenleri söyler."
    />
  ),

  // Overlays
  BottomSheet: () => (
    <ui.BottomSheet visible onDismiss={fn()} title="Hatırlatıcı" presentation="inline">
      <ui.Text>İçerik</ui.Text>
    </ui.BottomSheet>
  ),
  Sheet: () => (
    <ui.Sheet visible onDismiss={fn()} title="Seçenekler">
      <ui.Text>İçerik</ui.Text>
    </ui.Sheet>
  ),
  ConfirmDialog: () => (
    <ui.ConfirmDialog
      visible
      title="Gmail bağlantısı kaldırılsın mı?"
      body="Analizler durur."
      confirm={{ label: 'Kaldır', onPress: fn() }}
      cancel={{ label: 'Vazgeç', onPress: fn() }}
    />
  ),
  DestructiveSheet: () => (
    <ui.DestructiveSheet
      visible
      title="Geçmişi sil"
      consequences={['Silinen: özetler', 'Korunan: hesaplar']}
      confirm={{ label: 'Geçmişi Sil', onPress: fn() }}
      cancel={{ label: 'Vazgeç', onPress: fn() }}
    />
  ),
  Toast: () => <ui.Toast toast={{ id: 't', message: 'Hatırlatıcı kuruldu', kind: 'success' }} />,
  UndoToast: () => (
    <ui.UndoToast message="Öğrendim · Ahmet artık VIP." undoLabel="Geri al" onUndo={fn()} />
  ),
  ToastViewport: () => (
    <ui.ToastViewport toast={{ id: 't', message: 'Kaydedildi' }} onDismissed={fn()} />
  ),
  InAppBanner: () => (
    <ui.InAppBanner
      banner={{ id: 'b', title: 'Ahmet Yılmaz', body: 'Revize teklif' }}
      onPress={fn()}
      onDismiss={fn()}
    />
  ),

  // States
  ErrorCard: () => (
    <ui.ErrorCard
      icon="error"
      tone="neutral"
      title="Bir sorun oluştu."
      body="Tekrar denemek ister misin?"
      primaryAction={{ label: 'Tekrar Dene', onPress: fn() }}
    />
  ),
  InlineErrorCard: () => (
    <ui.InlineErrorCard icon="cloud_off" tone="neutral" title="Asistan şu an yanıt veremiyor." />
  ),
  OfflineBanner: () => (
    <ui.OfflineBanner
      message="Çevrimdışısın. Son analiz 09:40'tan gösteriliyor."
      refreshLabel="Yenile"
      onRefresh={fn()}
    />
  ),
  ReconnectCard: () => (
    <ui.ReconnectCard
      title="Gmail bağlantısı yenilenmeli."
      body="Google oturumu süresi doldu."
      reconnectAction={{ label: 'Yeniden Bağlan', onPress: fn() }}
      laterAction={{ label: 'Sonra', onPress: fn() }}
    />
  ),
  SyncDelayedCard: () => (
    <ui.SyncDelayedCard
      title="Senkronizasyon gecikti."
      primaryAction={{ label: 'Şimdi Dene', onPress: fn() }}
    />
  ),
  AiUnavailableCard: () => (
    <ui.AiUnavailableCard
      title="Asistan şu an yanıt veremiyor."
      primaryAction={{ label: 'Tekrar Dene', onPress: fn() }}
    />
  ),
  PermissionCard: () => (
    <ui.PermissionCard
      title="Takvim izni verilmedi."
      primaryAction={{ label: 'İzin Ver', onPress: fn() }}
    />
  ),
  LimitCard: () => (
    <ui.LimitCard
      title="Bugünkü AI analiz hakkın doldu."
      primaryAction={{ label: "Pro'yu Gör", onPress: fn() }}
    />
  ),
  EntitlementGate: () => (
    <ui.EntitlementGate
      kicker="Takip · Pro"
      title="3 takip bekliyor."
      primaryAction={{ label: "Pro'yu Gör", onPress: fn() }}
    />
  ),
  ExternalCredentialRequired: () => (
    <ui.ExternalCredentialRequired message="Bu özellik bu ortamda yapılandırılmamış (harici kimlik bilgisi gerekli)." />
  ),
  UnavailableCard: () => (
    <ui.UnavailableCard message="Bu özellik şu anda kullanılamıyor." reason="disabled" />
  ),
  PartialDataNotice: () => (
    <ui.PartialDataNotice
      title="Bazı hesaplarından veri alınamıyor."
      regionLabel="Eksik veri uyarısı"
      action={{ label: 'Ayrıntılar', onPress: fn() }}
    />
  ),
  PartialDataStrip: () => (
    <ui.PartialDataStrip title="Takvim analizi kapalı." regionLabel="Eksik veri uyarısı" />
  ),
  EmptyState: () => (
    <ui.EmptyState
      icon="done_all"
      tone="success"
      title="Her şey kontrol altında."
      action={{ label: 'Akışa göz at', onPress: fn() }}
    />
  ),
  ErrorState: () => (
    <ui.ErrorState
      title="Bir şeyler ters gitti."
      retryAction={{ label: 'Tekrar Dene', onPress: fn() }}
      errorCodeText="Hata kodu: 3F9A21C0"
    />
  ),
  OfflineScreen: () => (
    <ui.OfflineScreen
      title="İnternet bağlantısı yok."
      retryAction={{ label: 'Tekrar Dene', onPress: fn() }}
    />
  ),
  NotFoundState: () => (
    <ui.NotFoundState
      title="Bu içerik artık yok."
      backAction={{ label: 'Geri Dön', onPress: fn() }}
    />
  ),
  SuccessState: () => (
    <ui.SuccessState title="Takvimine eklendi." action={{ label: 'Plana Dön', onPress: fn() }} />
  ),
  AiWorkingKicker: () => <ui.AiWorkingKicker label="Brifing hazırlanıyor…" />,
  AISpinner: () => <ui.AISpinner label="Hazırlanıyor…" />,
  AiWorkingInline: () => <ui.AiWorkingInline label="Hazırlanıyor…" />,
  LongRunningNotice: () => <ui.LongRunningNotice text="Brifing hâlâ hazırlanıyor." />,
  SyncLine: () => <ui.SyncLine phase="done" doneLabel="Güncel · 09:41" />,
  StaggerIn: () => (
    <ui.StaggerIn index={1}>
      <ui.Text>Kart</ui.Text>
    </ui.StaggerIn>
  ),
  CardSkeleton: () => <ui.CardSkeleton />,
  TodaySkeleton: () => <ui.TodaySkeleton kicker="Brifing hazırlanıyor…" cards={1} />,
  FeedSkeleton: () => <ui.FeedSkeleton rows={1} />,
  TimelineSkeleton: () => <ui.TimelineSkeleton rows={1} />,
  SettingsValueSkeleton: () => <ui.SettingsValueSkeleton />,
  MailDetailSkeleton: () => <ui.MailDetailSkeleton />,
  PrepSkeleton: () => <ui.PrepSkeleton />,
  ChatStreamingSkeleton: () => <ui.ChatStreamingSkeleton />,
};

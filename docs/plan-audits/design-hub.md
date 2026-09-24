## Information architecture

**File facts**
- `Dijital Asistan.dc.html`: 115,391 bytes, 860 lines. It has two parts:
  - A desktop documentation page. Background `#ECEAE4`, max-width 1320px, padding `40px 32px 80px`, `flex-wrap:wrap-reverse`, 48px gap.
  - One clickable iOS prototype inside `<x-import component-from-global-scope="IOSDevice" from="./ios-frame.jsx" dark="{{ immersive }}" hint-size="402px,874px">`. The caption under the phone reads: "Çalışan prototip · iOS 26 çerçevesi · 402×874. Ekran: **{screenLabel}**".
- The data script declares two editor props:
  - `userName` (text, default `"Yunus"`).
  - `startScreen` (enum `today|akis|plan|asistan|briefing|audio|prep|mail|reply|approvals|profile|person|paywall`, default `today`). `post` exists as a screen but is not in the enum.
- Navigation model (`state.tab` plus the `state.stack[]` array):
  - `push(k)` appends a screen. `back()` pops one and also resets `showOriginal`.
  - Tapping a tab runs `setState({tab, stack:[]})`, which wipes the whole stack.
  - The tab bar shows only when the stack is empty (`showNav: s.stack.length===0`). Every pushed screen is therefore full-screen with no tab bar.
  - The status bar turns light (`immersive`) for `briefing`, `audio` and the `voice` overlay.
- Screen labels (`labels` map): today→"Bugün", akis→"Akış", plan→"Plan", asistan→"Asistan", briefing→"Sabah Brifingi", audio→"Sesli Brifing", prep→"Toplantı Hazırlığı", post→"Toplantı Sonrası", mail→"Mail Detayı", reply→"AI Yanıt Taslağı", approvals→"Onay Merkezi", profile→"Profil & Ayarlar", person→"Kişi Zekâsı", paywall→"Pro".
- Overlays that are not screens: `sheet` (kinds `remind` and `correct`, z-index 20/21), `voice` (full-screen, z 30), `toast` (z 40), tab bar (z 5).

**Navigation tree as depicted.** [push] = full-screen push, tab bar hidden. [modal] = dismiss with close or collapse. [sheet] = bottom sheet. [overlay] = full-screen layer above everything. [toast] = no navigation.

```
App (RN/Expo, iOS + Android) — 4 fixed tabs; "Sekme sayısı 4'te sabit; yeni yetenekler yeni sekme değil, ilgili sekmenin içinde bir kart olarak açılır."
├─ TAB Bugün (icon sunny) — DEFAULT
│  ├─ Header: kicker "5 EYLÜL CUMARTESİ" · H1 "Günaydın, {ad}"
│  │  ├─ pill "{N} onay" (only if pending>0) → [push] Onay Merkezi
│  │  └─ avatar (initial) → [push] Profil & Ayarlar
│  ├─ Brifing hero card
│  │  ├─ "Brifingimi Gör" → [push, immersive] Sabah Brifingi
│  │  │   ├─ back (arrow_back) → pop
│  │  │   └─ sticky "Brifingi Dinle · 2 dk" → [modal, collapse ▼] Sesli Brifing
│  │  └─ "Dinle · 2 dk" → [modal] Sesli Brifing
│  ├─ ÖNCELİKLERİN (priority cards, 5)
│  │  ├─ each: ✓ → complete (card animates out) · ··· → [sheet] Düzeltme ("Bunu nasıl değerlendireyim?")
│  │  ├─ p1 ACİL Ahmet: title → [push] Mail Detayı · "Yanıtla" → [push] AI Yanıt (Ahmet) · "Hatırlat" → [sheet] Hatırlatıcı
│  │  ├─ p2 TOPLANTI Mehmet: title / "Hazırlan" → [push] Toplantıya Hazırlan
│  │  │   ├─ person row → [push] Kişi Zekâsı → composer mic → [overlay] Ses Modu
│  │  │   ├─ "2 Dakikalık Özeti Oku" → [toast]  (real: 05/5.6 reading view)
│  │  │   └─ "Not Al" → [push] Toplantı Sonrası → "Kaydet" (pop + toast) / "Vazgeç" (pop)
│  │  ├─ p3 SON TARİH: "Takvime Ekle" → creates approval ETKİNLİK OLUŞTUR + toast; title → Mail Detayı (BUG: always Ahmet's mail)
│  │  ├─ p4 TAKİP: "Takip Mesajı Hazırla" → [push] AI Yanıt (Mehmet, "TAKİP MESAJI") · "Yarın Hatırlat" → [toast]
│  │  └─ p5 KİŞİSEL kargo: "Takip Et" → [toast]
│  └─ all cards done → empty state "Her şey kontrol altında."
├─ TAB Akış (dynamic_feed)
│  ├─ pill "Ekle" (add_a_photo) → [toast] (real: Evrensel Yakalama, 04/4.10–4.14)
│  ├─ filter chips Tümü | Önemli | Mail | Takvim | Takip | Kişisel (local filter)
│  └─ feed card action →
│       Mail→[push] Mail Detayı · Takvim→[push] Toplantıya Hazırlan · Takip→[push] AI Yanıt (Mehmet)
│       Başvuru "Takvime Ekle"→approval · Elektrik "Hatırlat"→[sheet] Hatırlatıcı · others→[toast] "{action} · Kaynak açıldı"
├─ TAB Plan (calendar_today)
│  ├─ segmented Gün | Hafta
│  ├─ 7-day strip (not interactive)
│  ├─ TAKVİM ZEKÂSI card: "Planla" → state "Planlandı" + toast · "Başka zaman" → [toast]
│  ├─ Gün → agenda timeline (rows not interactive)
│  └─ Hafta → density chart + 3 insight cards; "Seçenekleri Gör" → [toast] (real: 05/5.3 conflict sheet)
├─ TAB Asistan (auto_awesome)
│  ├─ pill "Hafıza" (search) → [toast] (real: 06/6.5 memory search)
│  ├─ empty state: context card + ÖNERİLEN questions → inline Q&A with rich card
│  └─ composer "Dijital hayatına sor…" (typing does nothing) + mic → [overlay] Ses Modu
├─ STACK-ONLY SCREENS (no tab bar)
│  ├─ Onay Merkezi (H1 "Onay Bekleyenler") ← header pill, Profil row
│  │   └─ card: Onayla · Düzenle (email → [push] AI Yanıt Mehmet; else [toast]) · Reddet
│  ├─ Profil & Ayarlar ← avatar
│  │   ├─ dark row "Onay Merkezi" → [push] Onay Merkezi
│  │   ├─ Abonelik → [push] Pro (paywall, close ×)
│  │   ├─ Önemli Kişiler → [push] Kişi Zekâsı (Mehmet)  ← prototype shortcut; real: VIP list 06/6.6
│  │   ├─ Brifing, Bildirimler, Öncelik Kuralları, Bağlantılar, AI Kişiselleştirme, Gizlilik ve Güvenlik,
│  │   │  Görünüm, Dil, Yardım, Geri Bildirim → [toast] "{row} · Bkz. 07 Hesap"
│  │   └─ "Çıkış Yap" → [toast] "Prototipte çıkış devre dışı"
│  ├─ Mail Detayı → "Yanıt Hazırla" [push] AI Yanıt · "Görev Oluştur" approval · "Takvime Ekle" approval · "Hatırlat" [sheet] · "Orijinal Mail" accordion
│  ├─ AI Yanıt Taslağı → "Göndermeyi Onayla" → "Gönderiliyor…" → "Gönderildi" → "Bugün'e Dön" (clears stack; does NOT switch tab)
│  ├─ Toplantıya Hazırlan · Toplantı Sonrası · Kişi Zekâsı · Sabah Brifingi
├─ MODALS: Sesli Brifing (expand_more), Pro paywall (close), Ses Modu (overlay, close)
├─ SHEETS: Hatırlatıcı ("Ne zaman hatırlatayım?"), Düzeltme ("Bunu nasıl değerlendireyim?")
└─ GLOBAL: Toast (bottom 104px, 2.6 s)
```

**What the hub's IA panel says ("BİLGİ MİMARİSİ") — this is the intended placement of features across tabs**
- **Bugün**: "Brifing hero · Öncelikler · Sabah / öğle / akşam brifingi · Sesli brifing · Toplantı hazırlığı · Mail detayı · AI yanıt"
- **Akış**: "Tüm kaynaklar tek dikkat akışı · Filtreler · Mail zekâsı · Takip · Senden beklenenler · Taahhütler · Yaşam kartları · Evrensel yakalama"
- **Plan**: "Gün / hafta · Takvim zekâsı · Çakışma çözümü · AI görev blokları · Toplantı sonrası yakalama"
- **Asistan**: "Önerilen sorular · Zengin kartlı sohbet · Ses modu · Hafıza araması · Kişi zekâsı"
- Footer: "Sağ üst avatar → Profil: Onay Merkezi, Ayarlar, Bağlantılar, Gizlilik, Abonelik. Sekme sayısı 4'te sabit; yeni yetenekler yeni sekme değil, ilgili sekmenin içinde bir kart olarak açılır."
- Not placed in any tab: Haftalık özet (weekly review), global search (#95), widgets and notifications entry points, Referral ("Davet"), Priority Rules.

**Recommended production presentation semantics** (Expo Router: a root Stack holding a `(tabs)` group plus detail routes, per-tab stacks kept)

| Destination | Prototype | Production recommendation |
|---|---|---|
| Sabah/Öğle/Akşam Brifingi | push, immersive, back arrow | Stack push, hide tab bar, light status bar over the gradient hero |
| Sesli Brifing | stack push with collapse icon `expand_more` | `fullScreenModal` / modal with swipe-down. Keep playing in background; lock-screen controls. A mini-player is missing (decision needed). |
| Ses Modu | overlay z30, close × | `fullScreenModal` (transparent). Needs mic and speech-recognition permission gates. |
| Pro paywall | push with close × | `modal` (iOS pageSheet / Android full-screen) |
| Onay Merkezi | push | Stack push; deep-link target from notifications |
| Profil & Ayarlar | push from avatar | Stack push (or modal). Settings sub-screens push inside it. |
| Mail Detayı, AI Yanıt, Toplantı Hazırlığı, Toplantı Sonrası, Kişi Zekâsı | push | Stack push. AI Yanıt could be a modal because it is a compose flow; must confirm before discarding edits. |
| Hatırlatıcı, Düzeltme | bottom sheet with scrim, tap scrim to close | `@gorhom/bottom-sheet` (or native sheet), drag-to-dismiss, accessible |
| Toast | custom | Global toast host above the tab bar with optional "Geri al" action |

**Destinations worth a deep link** (all need auth guard, Pro-entitlement guard and a fallback when the entity is missing)
- `dijitalasistan://today`
- `…/briefing/{briefingId}` (morning, midday or evening) and `…/briefing/{briefingId}/audio`
- `…/flow?filter=onemli|mail|takvim|takip|kisisel`
- `…/plan?view=day|week&date=YYYY-MM-DD` and `…/plan/suggestion/{id}`
- `…/assistant`, `…/assistant/voice`, `…/assistant/memory?q=`
- `…/mail/{messageId}` and `…/mail/{messageId}/reply?tone=kisa|profesyonel|samimi|detayli`
- `…/followups/{id}/draft`
- `…/meetings/{eventId}/prep`, `…/meetings/{eventId}/summary`, `…/meetings/{eventId}/post`
- `…/people/{personId}`
- `…/approvals`, `…/approvals/{approvalId}`
- `…/settings[/section]`, `…/paywall?source=`
- `…/reminders/new?sourceType=&sourceId=`

Notification targets:

| Notification | Opens |
|---|---|
| Morning, midday, evening briefing | briefing |
| Meeting prep at T-15…T-30 (prototype shows an "18 dk" pill) | prep |
| Event end | post-meeting |
| Pending approval | `approvals/{id}` |
| Deadline | source mail |
| Follow-up due | draft |

Widgets open today, briefing audio or prep (#37).

**Analytics hooks the flows imply (#42; content-free)**: `briefing_open`, `briefing_audio_play`, `priority_complete`, `priority_feedback{kind}`, `reply_draft_open{tone}`, `reply_tone_change`, `approval_created{type}`, `approval_decided{decision}`, `reminder_created{preset}`, `meeting_prep_open`, `post_meeting_commitment_saved`, `assistant_prompt{suggested:boolean}`, `voice_open`, `flow_filter{filter}`, `plan_view{day|week}`, `plan_suggestion_{accept|dismiss}`, `paywall_view{source}`, `trial_start{plan}`.

## User flows

- **F1 · Morning briefing (read)**
  1. Bugün hero shows "BRİFİNG HAZIR · 07:58" and "Bugün bilmen gereken 5 şey var."
  2. "Brifingimi Gör" pushes Sabah Brifingi: gradient hero with "Günaydın Yunus" and "Bugün oldukça sakin bir günün var.", then the Lora narrative, then 6 section cards.
  3. Back returns to Bugün.
- **F2 · Morning briefing (listen)**
  1. Either Bugün "Dinle · 2 dk" or the Brifing sticky button "Brifingi Dinle · 2 dk" opens Sesli Brifing (initial position 0:42 of 2:14, chapter "Bugünün öncelikleri", paused).
  2. The play button toggles a fake 1 s interval.
  3. ⟲15 / 15⟳ seek; the speed pill cycles 1.0x → 1.25x → 1.5x → 1.0x; tapping a chapter row seeks to its start. Chapter starts in seconds: 0, 18, 50, 74, 95, 112. The active chapter is at opacity 1, the rest at .55.
  4. At 134 s it resets to 0 and pauses.
  5. `expand_more` pops.
- **F3 · Reply to Ahmet from Today (in-place approval)**
  1. p1 "Yanıtla" opens AI Yanıt: kicker "YANIT TASLAĞI", recipient chip "AY Ahmet Yılmaz", tone default "Profesyonel".
  2. Tone segments (Kısa/Profesyonel/Samimi/Detaylı) swap the draft text.
  3. "Göndermeyi Onayla" shows spinner and "Gönderiliyor…" for 900 ms.
  4. Success screen: "Gönderildi" / "Ahmet Yılmaz yanıtını aldı. Cevap gelince Akış'ta göreceksin."
  5. "Bugün'e Dön" clears the stack, removes p1 from priorities, and toasts "Mail gönderildi · Ahmet Yılmaz".
  6. Variant path: p1 title (or Akış Ahmet card "Yanıtla") → Mail Detayı → "Yanıt Hazırla" → same flow.
- **F4 · Follow-up to Mehmet**
  1. Entry: p4 "Takip Mesajı Hazırla", Akış Takip card "Takip Mesajı Hazırla", or Onay Merkezi a1 "Düzenle".
  2. AI Yanıt opens with kicker "TAKİP MESAJI", chip "MY Mehmet Yılmaz".
  3. Approve, then success.
  4. "Bugün'e Dön" removes p4 and also sets approval a1 to `approved`: one intent, two surfaces, resolved together.
  5. p4 "Yarın Hatırlat" only toasts "Yarın 09:00'da hatırlatırım".
- **F5 · Meeting prep → person → voice**
  1. p2 "Hazırlan", p2 title, or Akış "Hazırlan" opens Toplantıya Hazırlan: countdown pill "18 dk", person row, dark "KONUŞMAN GEREKEN 3 ŞEY", 6 sections.
  2. Tapping the person row opens Kişi Zekâsı; its composer mic opens Ses Modu.
  3. "2 Dakikalık Özeti Oku" only toasts "Özet okunuyor · 2 dk".
- **F6 · Post-meeting commitment capture**
  1. Prep "Not Al" opens Toplantı Sonrası: "Toplantın bitti." with a pre-filled voice quote and an AI card "YENİ TAAHHÜT · Mehmet'e teklif gönder" (chips "Yarın", "Mehmet Yılmaz").
  2. "Kaydet" pops and toasts "Taahhüt kaydedildi · Yarın hatırlatırım". "Vazgeç" pops.
  3. In production this is triggered at event end (a notification), not from prep.
- **F7 · Smart reminder**
  1. Entry: p1 "Hatırlat", Mail Detayı "Hatırlat", or Akış Elektrik "Hatırlat".
  2. Sheet "Ne zaman hatırlatayım?" (subtitle is the context title) with 6 presets.
  3. Choosing one closes the sheet and toasts "Hatırlatıcı kuruldu · {time}".
- **F8 · Correction / feedback**
  1. "···" on any Today card opens "Bunu nasıl değerlendireyim?" / "Seçimin gelecekteki öncelikleri etkiler".
  2. Four options, each toasting "Öğrendim · …".
  3. The card is NOT re-ranked or removed in the prototype.
- **F9 · Complete a priority**
  1. ✓ fades the card (opacity 0, `scale(.96) translateY(-6px)`, .3 s) and removes it after 330 ms.
  2. Toast "Tamamlandı · Bir sonraki konu yukarı taşındı". The hero count and "{n} konu" decrement.
  3. When 0 remain, the empty state "Her şey kontrol altında." appears.
- **F10 · Queue an approval**
  1. Four entry points: p3 "Takvime Ekle", Akış Başvuru "Takvime Ekle", Mail "Görev Oluştur", Mail "Takvime Ekle".
  2. A new pending approval is prepended; toast "Onay Merkezi'ne eklendi".
  3. The header pill count increments. Repeated taps create duplicates (no dedupe).
- **F11 · Approval Center**
  1. Header pill "2 onay" or Profil "Onay Merkezi" opens "Onay Bekleyenler".
  2. Onayla sets status ONAYLANDI and toasts "Onaylandı · {what}".
  3. Reddet sets REDDEDİLDİ (card opacity .45) and toasts "Reddedildi · Öğrendim".
  4. Düzenle: for the email type it pushes AI Yanıt (Mehmet); otherwise it toasts "Düzenleme Plan sekmesinde açılır".
  5. No executing, executed, failed or expired states.
- **F12 · Flow filtering**: chip tap re-filters local data. Summary line counts: Tümü "10 konu · 5 önemli", Önemli "5 konu · 5 önemli", Mail "2 konu · 2 önemli", Takvim "1 konu · 1 önemli", Takip "1 konu · 1 önemli", Kişisel "6 konu · 1 önemli".
- **F13 · Plan suggestion**
  1. "Planla" turns into "Planlandı" (green) and toasts "Planlandı · Yarın 14:00–16:30 Teklif hazırlama". It also restyles the 17:00 AI item in the Day list (a wrong linkage). No approval step.
  2. "Başka zaman" toasts "Tamam, başka bir boşluk önereceğim".
  3. Gün/Hafta switch; the Hafta view shows the conflict card "Seçenekleri Gör", which only toasts.
- **F14 · Assistant Q&A**
  1. Tapping a suggested question adds a user bubble and a typing indicator for 1000 ms, then the AI bubble and a rich card.
  2. Suggestions disappear once chat is non-empty. The composer text is non-functional, so after the first Q&A the user is stuck: no further suggestions and no send.
- **F15 · Voice mode**
  1. Mic (Asistan or Kişi composer) opens Ses Modu "Dinliyorum…" with pulse and wave.
  2. A prompt chip replaces the text with “{prompt}” and shows the canned answer after 900 ms.
  3. × closes.
- **F16 · Profile / Settings / Paywall**
  1. Avatar opens Profil. "Abonelik" opens Pro.
  2. Plan radio: Yıllık (default) or Aylık.
  3. "Ücretsiz Dene · 7 gün" pops and toasts "7 günlük deneme başladı · 12 Eylül'de hatırlatırım". "Free ile devam et" and × pop.
- **F17 · Capture**: Akış "Ekle" toasts "Ekran görüntüsü, PDF veya link ekle · Bkz. 04 Akış". The real flow is in 04 (4.10–4.14d).
- **Not shown in this file**: onboarding (02), midday/evening/weekly review (03), mail intelligence list, commitments list, life-card details, conflict resolution, memory search, VIP list, privacy, priority rules, widgets, error/empty/loading states (08).

## Screen inventory

### Prototip ve IA Hub Sayfası / Prototype & IA hub page (documentation, not an app screen)
- **Source:** PRIMARY / Dijital Asistan.dc.html / left column (lines 21–83)
- **Purpose:** Product thesis, design decisions, IA, how to try the prototype, links to the 9 catalog pages. Several bullets are binding product rules.
- **Layout top→bottom:**
  - Page bg `#ECEAE4`; body font Geist, `-apple-system`, "SF Pro Text"; text `#1A1917`; links `#4547C9` (hover `#5B5CE2` + underline).
  - Logo tile 36×36, r11, `#5B5CE2`, white `auto_awesome` 20px FILL 1.
  - Kicker 13px/600/.08em `#6B6860`.
  - H1 40/46, 600, −.025em. Lead 17/26 `#6B6860`.
  - Four white cards: r20, padding 22 24, shadow `0 1px 2px rgba(27,25,23,.04),0 6px 20px rgba(27,25,23,.05)`, card kicker 12/600/.08em `#9B978E`, list 14/22.
  - IA tiles `#F5F4F0`, r14, p14, grid `repeat(auto-fit,minmax(160px,1fr))`, gap 12; icon 18 `#5B5CE2`; title 600 14; body 13/19 `#6B6860`.
  - Catalog rows: padding 11 0, 1px `rgba(27,25,23,.07)` divider, `arrow_forward` 18 `#9B978E`.
  - Phone column sticky top 24.
- **Exact visible copy:**
  - Kicker: "DİJİTAL ASİSTAN · ÜRÜN TASARIMI V1"
  - H1: "Bugün bilmen gerekenleri, sen sormadan söyler."
  - Lead: "iOS + Android için proaktif kişisel komuta merkezi. Sağdaki telefon çalışan bir prototip: sekmeler, kartlar, brifing, ses, toplantı hazırlığı, yanıt taslağı ve onay akışı gerçek durumlarla çalışır. Tüm ekran kataloğu aşağıdaki 9 sayfada."
  - **VARSAYIMLAR VE KARARLAR:**
    1. "Ana ekran Bugün: “Şimdi neyi bilmeliyim?” sorusunun cevabı. Sohbet ikinci katman (Asistan sekmesi)."
    2. "Örnek kullanıcı Yunus; iş ve kişisel hayat tek akışta. Kargo, uçuş, ödeme, abonelik ve güvenlik sinyalleri mail içeriğinden türetilir; ek entegrasyon gerekmez."
    3. "AI hiçbir yazma işlemini onaysız yapmaz. Mail gönderme, etkinlik oluşturma/taşıma, hatırlatıcı ve görev ekleme Onay Merkezi'nden geçer."
    4. "Her AI çıkarımının altında kaynak satırı vardır (Gmail · kişi · saat). Orijinal içerik her zaman bir dokunuş uzakta."
    5. "Renk yalnızca anlam taşır: coral = acil, amber = son tarih, yeşil = tamamlandı, mavi = bilgi. Marka indigosu sadece AI işaretleri ve birincil aksiyon için."
    6. "Kullanıcı düzeltebilir: her kartın “···” menüsünde Önemli değil · Daha sık göster · VIP yap · Takip etme. Her düzeltme “Öğrendim” geri bildirimi verir."
    7. "Tipografi: Geist (SF Pro karakterinde; iOS'ta gövde SF Pro'ya düşer) + Lora yalnızca brifing anlatısı ve haftalık özet için. Gövde min. 15px, dokunma alanı min. 44px."
    8. "Light mode ana mod. Dark mode temsilî ekranlar 03 ve 05 sayfalarında."
  - **PROTOTİPTE DENE:**
    - "Brifingimi Gör → tam ekran brifing → Brifingi Dinle → sesli oynatıcı (oynat, 15 sn, hız)."
    - "Ahmet kartında Yanıtla → ton seçimi taslağı değiştirir → Göndermeyi Onayla → başarı → kart Bugün'den düşer."
    - "Mehmet kartında Hazırlan → Toplantı hazırlığı; isme dokun → Kişi zekâsı."
    - "Hatırlat → akıllı hatırlatıcı sayfası. Kartın onayı → tamamlandı animasyonu. “···” → düzeltme menüsü."
    - "Başlıkta onay rozeti → Onay Merkezi (onayla / düzenle / reddet). “Takvime Ekle” yeni bir onay üretir."
    - "Akış filtreleri, Plan'da Gün/Hafta ve Planla, Asistan'da önerilen sorular ve mikrofon → ses modu."
  - "EKRAN KATALOĞU · 9 SAYFA" (see Cross-file index).
- **Data fields:** none (documentation).
- **Interactions:** catalog links go to the 01–09 files. In production: none. Reuse the slogan as the marketing web hero (#73) and the store/marketing copy (#74).
- **States depicted / missing:** not applicable.
- **Prototype-only elements:** the whole page is a design-doc artifact.
- **Maps to MASTER_PROMPT:** #2, #3, #4, #8, #23, #33, #38, #92, #115, #122

### Bugün (varsayılan) / Today (default)
- **Source:** PRIMARY / Dijital Asistan.dc.html / phone, `isToday` (lines 89–149), data `PRIOS`
- **Purpose:** Answer "Şimdi neyi bilmeliyim?": the briefing entry plus a ranked, source-linked priority list.
- **Layout top→bottom:**
  - Screen bg `#F5F4F0`. Scroll padding 70 20 112 (clears the 90px tab bar). Vertical gap 18.
  - **Header** (flex, align-end, space-between):
    - Kicker "5 EYLÜL CUMARTESİ" 12/600/.08em `#9B978E`.
    - H1 "Günaydın, {name}" 28/34, 600, −.02em, margin-top 4.
    - Right, gap 8: approvals pill (h34, padding 0 12 0 9, r999, bg `#fff`, fg `#4547C9`, 600 12, `task_alt` 18, shadow `0 1px 2px rgba(27,25,23,.06)`, text "{N} onay"); avatar button 40×40 circle `#1A1917`, white initial 600 15.
  - **Hero card:**
    - bg `radial-gradient(140% 100% at 100% 0%,#E4E4FA 0%,#FFFFFF 58%)`, r28, padding 22 22 20, shadow `0 1px 2px rgba(27,25,23,.04),0 12px 32px rgba(91,92,226,.10)`.
    - Kicker `auto_awesome` 16 FILL 1 + "BRİFİNG HAZIR · 07:58", `#5B5CE2` 12/600/.06em.
    - Headline 26/32, 600, −.02em: "Bugün bilmen gereken **5** şey var." (number coloured `#5B5CE2`).
    - Sub 14/20 `#6B6860` "3 önemli mail · 4 etkinlik · 2 takip".
    - Button row, gap 10, margin-top 18: primary "Brifingimi Gör" (flex 1, h48, r14, `#5B5CE2`, white 600 15, pressed `scale(.97)`); soft "Dinle · 2 dk" (h48, padding 0 16 0 12, r14, bg `#EDEDFC`, fg `#4547C9`, 600 14, `play_arrow` 20 FILL 1).
  - **Section header** (padding 4 4 0): "ÖNCELİKLERİN" (kicker style) and "{n} konu" 12 `#9B978E`.
  - **Priority card** ×5:
    - bg `#fff`, r20, padding 14 16 10, card shadow.
    - Row 1: tone badge (11/700/.05em, padding 3 8, r999) + time 12 `#9B978E`. Right side (margin-right −8): ✓ button 36×36 circle, icon `check_circle` 22 `#B8B4AA`, hover fg `#2FA062` bg `#E4F5EA`; ··· button `more_horiz` 22, hover bg `#F0EFEB` fg `#6B6860`.
    - Title 17/23, 600, −.01em, tappable.
    - Optional sub 14/20 `#6B6860`.
    - Source row 12 `#9B978E` with 16px icon.
    - Text actions (margin-left −10, gap 2): h36, padding 0 10, r10, 600 14. Primary `#4547C9` (hover bg `#EDEDFC`); secondary `#6B6860` (hover `#F0EFEB`).
- **Exact visible copy (PRIOS):**

| id | badge / tone | time | title | sub | source | actions |
|---|---|---|---|---|---|---|
| p1 | "ACİL" critical | "08:42" | "Ahmet senden bugün 17:00'ye kadar revize teklif bekliyor." | — | icon `mail` "Gmail · Ahmet Yılmaz · 08:42" | "Yanıtla", "Hatırlat" |
| p2 | "TOPLANTI" neutral | "14:30" | "14:30 Mehmet ile toplantı" | "Son görüşmeniz 4 gün önceydi." | `event` "Google Takvim · Müşteri toplantısı · 60 dk" | "Hazırlan" |
| p3 | "SON TARİH" warning | "17:00" | "Başvuru bugün 17:00'de kapanıyor." | — | `mail` "Gmail · Girişim Programı · Dün 16:10" | "Takvime Ekle" |
| p4 | "TAKİP" neutral | "3 gün" | "Gönderdiğin teklif mailine 3 gündür cevap gelmedi." | — | `schedule_send` "Gmail · Mehmet Yılmaz · 2 Eyl" | "Takip Mesajı Hazırla", "Yarın Hatırlat" |
| p5 | "KİŞİSEL" neutral | "Bugün" | "Trendyol siparişin bugün geliyor." | — | `package_2` "Kargo · Yurtiçi · 14:00–18:00" | "Takip Et" |

- **Data fields → entities:**
  - date → user timezone (Europe/Istanbul).
  - greeting name → `profiles.display_name`.
  - "BRİFİNG HAZIR · 07:58" → `briefings{type:'morning', generated_at, status:'ready'}`.
  - count 5 → `today_insights` where `status='open'`.
  - "3 önemli mail · 4 etkinlik · 2 takip" → `briefing.stats{important_emails, events, followups}`.
  - Priority card → `insights{id, kind: email_action|meeting|deadline|followup|life_shipment, severity: critical|warning|neutral|info, badge_label, display_time, title, subtitle, source_type, source_id, source_provider, source_timestamp, source_label, confidence, primary_action, secondary_action, status: open|done|dismissed|snoozed, rank}`.
  - Pending approvals count → `approvals` where `status='pending'`.
- **Interactions → real behavior:**
  - "{N} onay" → push Onay Merkezi. Count comes live from `approvals` (Realtime); the pill is hidden at 0.
  - Avatar → push Profil & Ayarlar.
  - "Brifingimi Gör" → push `briefing/{todayMorningId}`, or the latest of morning/midday/evening depending on local time.
  - "Dinle · 2 dk" → audio modal. Duration comes from the TTS asset. If no audio exists, generate it (premium TTS adapter or native TTS fallback, #9) and show a preparing state.
  - ✓ → PATCH `insight.status='done'` (optimistic), undo toast "Geri al", feedback signal; the next card animates up.
  - ··· → Düzeltme sheet (writes learned preference / VIP / mute; see that sheet).
  - Title tap → entity detail by `source_type`: email → Mail Detayı; event → Toplantıya Hazırlan; deadline → source mail; follow-up → sent-mail thread or follow-up draft; shipment → life-card detail or source mail. Never a hard-coded screen.
  - p1 "Yanıtla" → AI Yanıt (generate draft for the thread). "Hatırlat" → reminder sheet with times computed from the item's due time.
  - p2 "Hazırlan" → prep for `eventId`.
  - p3 "Takvime Ekle" → create `approval{type:'calendar_create'}` (idempotency key = source message + type + payload hash); toast "Onay Merkezi'ne eklendi" with "Görüntüle".
  - p4 "Takip Mesajı Hazırla" → follow-up draft (AI Yanıt in follow-up mode). "Yarın Hatırlat" → `reminder_create` for tomorrow 09:00 (explicit user choice, logged as approved-in-place) and snooze the insight until then.
  - p5 "Takip Et" → external handoff to the carrier tracking URL extracted from the source mail (no carrier API, per hub rule), else open the source mail.
- **States depicted:** default, card-removing animation, approvals pill shown/hidden (logic), all-done (separate block).
- **States missing:**
  - Skeleton (08: "loading/today · iskelet, gerçek kart ölçülerinde").
  - First sync in progress after onboarding.
  - Briefing not ready yet (before the scheduled time) and briefing generation failed.
  - No accounts connected; provider re-auth needed (revoked token).
  - Offline with cached data (08: "Çevrimdışısın. Son analiz 09:40'tan gösteriliyor.").
  - Partial data (mail OK, calendar failed); stale-data timestamp.
  - Action in-flight/failed on a card; undo after complete.
  - Midday/evening hero variants (03/3.5, 3.6); time-of-day greeting (Günaydın / İyi günler / İyi akşamlar).
  - Free-tier gating of Pro actions (Hazırlan, Takip, Dinle); dark mode (03/3.2).
  - Pull-to-refresh; Dynamic Type overflow.
- **Prototype-only / fake:**
  - Hard-coded date and "07:58", static sub-counts.
  - p3 title opens Ahmet's mail (`go:'mail'`).
  - p4/p5 title taps are dead (no `go`).
  - p5 toast "Kargo takibi açıldı · Teslimatta haber veririm" (no tracking exists).
  - Complete has no undo and no persistence.
  - Approvals live only in local state.
- **Maps to MASTER_PROMPT:** #8, #9, #17, #23, #29, #31, #32, #33, #93, #94, #97, #99, #131

### Bugün · Hepsi tamam (boş durum) / Today · All done (empty)
- **Source:** PRIMARY / Dijital Asistan.dc.html / `allDone` (lines 141–147)
- **Purpose:** Calm, positive completion state once every priority is handled.
- **Layout:** centered, padding 36 20, gap 10. Circle 56 bg `#E4F5EA` with `done_all` 30 `#1E7A47`. Title 18/600/−.01em. Body 14/20 `#6B6860`. The hero stays above, showing "Bugün bilmen gereken 0 şey var." with the static sub-line; ÖNCELİKLERİN shows "0 konu".
- **Exact copy:** "Her şey kontrol altında." / "Yeni bir şey olursa haber veririm. Öğle brifingi 13:00'te."
- **Data:** next briefing time → `user_settings.briefing_schedule.midday` (13:00).
- **Interactions:** none. Production: optional "Akış'a göz at" and a link to the next briefing.
- **States missing:**
  - The hero copy must switch to a done variant; "0 şey var" reads badly.
  - Free users have no midday briefing (#44), so the "Öğle brifingi 13:00'te" line must be conditional on plan and schedule.
- **Prototype-only:** reachable only by completing all 5 cards locally.
- **Maps to MASTER_PROMPT:** #8, #10, #93

### Akış / Flow (smart attention feed)
- **Source:** PRIMARY / Dijital Asistan.dc.html / `isAkis` (lines 151–179), data `FEED`, `FILTERS`
- **Purpose:** All sources in one attention feed; not an inbox copy.
- **Layout top→bottom:**
  - Scroll padding 70 0 112, gap 14.
  - Header (padding 0 20): H1 "Akış" 28/34, 600, −.02em; pill "Ekle" (h36, padding 0 12 0 8, r999, `#fff`, fg `#4547C9`, 600 12, `add_a_photo` 18).
  - Horizontal chip scroller (padding 0 20 4, gap 8, scrollbar hidden). Chip h34, padding 0 14, r999, 600 13. Active bg `#1A1917` fg `#fff`; inactive bg `#fff` fg `#6B6860`; .15 s bg transition.
  - Summary 13 `#6B6860`.
  - Card list (padding 0 20, gap 12). Card `#fff`, r20, padding 14 16 10, card shadow.
    - Row: icon tile 28×28 r9 `#F0EFEB`/`#6B6860` icon 17; source 12 `#9B978E` (ellipsis); tone badge; time 12 `#9B978E`.
    - Title 16/22, 600, −.01em. Summary 14/20 `#6B6860`.
    - One text action `#4547C9` h36.
- **Exact copy:**
  - Filters: "Tümü", "Önemli", "Mail", "Takvim", "Takip", "Kişisel".
  - Summary template: "{n} konu · {m} önemli".
  - Cards (cat / imp / icon / src / time / title / sum / action / badge):
    1. Mail/1/`mail`/"Gmail · Ahmet Yılmaz"/"08:42"/"Revize teklif bugün 17:00'ye kadar bekleniyor"/"Ahmet, fiyat ve teslim tarihini güncellenmiş PDF olarak istiyor."/"Yanıtla"/"ACİL" (critical)
    2. Takvim/1/`event`/"Google Takvim"/"14:30"/"Mehmet ile müşteri toplantısı"/"Son görüşmeniz 4 gün önceydi. Açık 2 konu var."/"Hazırlan"/"BUGÜN"
    3. Takip/1/`schedule_send`/"Gmail · Mehmet Yılmaz"/"3 gün"/"Teklif mailine cevap gelmedi"/"2 Eylül'de gönderildi. Henüz yanıt yok."/"Takip Mesajı Hazırla"/"TAKİP"
    4. Mail/1/`mail`/"Gmail · Girişim Programı"/"Dün"/"Başvuru bugün 17:00'de kapanıyor"/"Son gün. Form yaklaşık 10 dakika sürüyor."/"Takvime Ekle"/"SON TARİH" (warning)
    5. Kişisel/1/`shield`/"Google"/"07:12"/"Google hesabında yeni giriş"/"Chrome · Windows · İstanbul. Sen değilsen şifreni değiştir."/"Kontrol Et"/"GÜVENLİK" (critical)
    6. Kişisel/0/`package_2`/"Kargo · Trendyol"/"Bugün"/"Siparişin bugün geliyor"/"Teslimat aralığı 14:00–18:00."/"Takip Et"/"KARGO"
    7. Kişisel/0/`flight`/"THY"/"Yarın 09:15"/"TK2412 · İstanbul → Antalya"/"Online check-in açıldı. 06:45'te evden çıkman gerekebilir."/"Check-in"/"UÇUŞ"
    8. Kişisel/0/`receipt_long`/"CK Enerji"/"10 Eyl"/"Elektrik faturası · 1.842 TL"/"Son ödeme günü 10 Eylül."/"Hatırlat"/"ÖDEME"
    9. Kişisel/0/`autorenew`/"Netflix"/"9 Eyl"/"Netflix 9 Eylül'de yenilenecek"/"Aylık 229,99 TL. Son 30 günde 2 kez izlendi."/"İncele"/"ABONELİK"
    10. Kişisel/0/`restaurant`/"Rezervasyon · Karaköy Lokantası"/"Cmt 20:30"/"Akşam yemeği rezervasyonu"/"4 kişi. Teyit için 18:00 son saat."/"Teyit Et"/"REZERVASYON"
- **Data → entities:** `feed_items{category: mail|calendar|followup|personal, is_important, kind: email|meeting|followup|deadline|security|shipment|flight|payment|subscription|reservation, icon, source_label, display_time, title, summary, primary_action, severity, badge, source_*}`. Life cards → `life_events{type, merchant/carrier/airline, amount, currency, due_at, window_start/end, flight_no, route, party_size, confirm_by, source_message_id, confidence}`.
- **Interactions → real behavior:**
  - "Ekle" → Universal Capture sheet (photo, screenshot, PDF, file, link, text; 04/4.10–4.14) → extraction → suggestions → approval (#27).
  - Filter chip → server/query filter; keep in URL param; per-filter empty state.
  - Card tap (dead in prototype) → entity detail/source.
  - "Yanıtla" → Mail Detayı or draft. "Hazırlan" → prep. "Takip Mesajı Hazırla" → follow-up draft. "Takvime Ekle" → `calendar_create` approval. "Hatırlat" → reminder sheet with due-date-relative presets (10 Eyl, not 16:30).
  - "Kontrol Et" → open the source security email and/or external handoff to the provider's security page; never auto-act.
  - "Takip Et" / "Check-in" → external URL extracted from the source mail (tracking or airline check-in link); if no link, open the source mail.
  - "İncele" → subscription life-card detail (amount/renewal only if stated in source, #23).
  - "Teyit Et" → external handoff (link or phone from the mail). If it drafts a reply, route it through AI Yanıt and approval.
  - Also missing: long-press/swipe actions (08 "KAYDIRMA AKSİYONLARI") and the ··· correction menu, which exists only on Today.
- **States depicted:** 6 filter states; all non-empty.
- **States missing:** skeleton; empty filter ("Bu filtrede konu yok"); pagination/infinite scroll; pull-to-refresh with sync status; offline cached; provider error per source; card action failure; dark (04/4.2); Pro gate for Life Intelligence extras if gated.
- **Prototype-only / fake:** fallback toast "{action} · Kaynak açıldı" (icon `open_in_new`) for Kontrol Et / Takip Et / Check-in / İncele / Teyit Et; "Ekle" toast; the Elektrik reminder sheet shows 17:00-relative times; "Son 30 günde 2 kez izlendi" is not derivable from mail.
- **Maps to MASTER_PROMPT:** #13, #14, #17, #23, #27, #28, #29, #33, #93, #97, #99, #131

### Plan · Gün / Plan · Day
- **Source:** PRIMARY / Dijital Asistan.dc.html / `isPlan` + `isDay` (lines 181–224), data `DAY`, `days`
- **Purpose:** Day agenda merging events, free gaps, AI-detected deadlines and life events, plus an AI scheduling suggestion.
- **Layout top→bottom:**
  - Scroll padding 70 20 112, gap 16.
  - Header: H1 "Plan" and a segmented control (track `#E9E7E1`, r999, padding 3; segment h30, padding 0 14, 600 13; active bg `#fff` fg `#1A1917` shadow `0 1px 3px rgba(27,25,23,.12)`; inactive transparent `#6B6860`).
  - 7-day strip (space-between). Chip 42×60 r14, weekday 11/500 opacity .8, date 17/600, 4×4 dot. Selected/today (index 4 "Cum 5") bg `#1A1917` fg `#fff`, dot `#A9AAF5`. Past days dot `#E0DED7`; Cmt dot `#5B5CE2`; Paz none.
  - **TAKVİM ZEKÂSI card:** bg `radial-gradient(140% 100% at 0% 0%,#E4E4FA 0%,#FFFFFF 60%)`, r20, p16, card shadow. Kicker `auto_awesome` "TAKVİM ZEKÂSI" `#5B5CE2` 12/600/.06em. Title 16/23 600. Body 14/20 `#6B6860`. Buttons: "Planla" (h40, padding 0 16, r12, `#5B5CE2`/`#fff`, icon `event_available` 18); after tap "Planlandı" bg `#E4F5EA` fg `#1E7A47` icon `check`. "Başka zaman" is a transparent text button `#6B6860`.
  - **Agenda rows:** min-height 68. Time column 44px, right-aligned 12/500 `#9B978E`, pt 8. Content has border-top 1px `rgba(27,25,23,.07)`, padding 4 0. Block r14, padding 10 14, title 600 15/−.01em with 16px icon, meta 12. Block variants:

| variant | background | border | icon | meta | title |
|---|---|---|---|---|---|
| event | `#fff` | 1px solid `rgba(27,25,23,.06)` | `#6B6860` | `#9B978E` | default |
| gap | transparent | 1px dashed `rgba(27,25,23,.15)` | `#B8B4AA` | — | fg `#9B978E` |
| ai | `#F7F7FE` (planned: `#EDEDFC`) | 1px dashed `#A9AAF5` (planned: 1px solid `#5B5CE2`) | `#5B5CE2` | `#4547C9` | default |
| life | `#FDF6EC` | 1px solid `rgba(27,25,23,.06)` | — | — | default |

- **Exact copy:**
  - Card: "Yarın 14:00–16:30 arasında 2,5 saat boşluğun var." / "Teklif hazırlama görevini buraya yerleştirebilirim." / "Planla" | "Planlandı" / "Başka zaman".
  - Segments "Gün" / "Hafta". Weekdays "Pzt Sal Çar Per Cum Cmt Paz", dates 1–7.
  - Rows:
    - 09:00 "Haftalık ekip" "60 dk · Ofis" (`event`)
    - 11:00 "Ürün gözden geçirme" "30 dk · Online" (`videocam`)
    - 12:00 "2 saat boşluk" "Öğle yemeği ve odaklanma için uygun" (`self_improvement`, gap)
    - 14:30 "Mehmet ile müşteri toplantısı" "60 dk · Ofis · Hazırlık hazır" (`groups`)
    - 16:00 "Ürün gözden geçirme" "30 dk · Online" (`videocam`)
    - 17:00 "Başvuru son saati" "Girişim programı · AI tespit etti" (`flag`, ai)
    - 20:30 "Akşam yemeği · Karaköy" "Rezervasyon · 4 kişi" (`restaurant`, life)
- **Data → entities:**
  - `calendar_events{id, title, start, end, duration, location_type: office|online, location, attendees, prep_status}`
  - `free_slots{start, end, label}` (computed)
  - `deadlines{source:ai, source_message_id, due_at}`
  - `life_events{type:reservation, party_size}`
  - `schedule_suggestions{id, slot_start, slot_end, task_ref, rationale, status: proposed|accepted|dismissed}`
- **Interactions → real behavior:**
  - Gün/Hafta → view switch (persist per user).
  - Day chip (dead) → select date and load that day; add week paging/swipe.
  - Row tap (dead) → event → prep or event detail with external "Takvimde Aç"; deadline → source mail; life → life card; gap → offer to schedule a task.
  - "Planla" → approval sheet or card (what "Teklif hazırlama" · Yarın 14:00–16:30, target calendar/account, reminders) → on approve, server executes `calendar_create` idempotently → timeline refresh showing the new block (#19 "Proposed block → User approval → Calendar update → Updated timeline").
  - "Başka zaman" → dismiss the suggestion with feedback and request the next slot suggestion (or hide if none).
- **States depicted:** Day; planned vs unplanned styling.
- **States missing:**
  - Loading, empty day ("Bugün takviminde etkinlik yok"), calendar not connected, calendar sync error, offline cached.
  - Current-time "now" line; overlapping events (the prototype is a list, not a time grid).
  - All-day events; multiple calendars (colour/source); Pro gate for advanced planning; dark (05/5.1D).
- **Prototype-only / fake:** "Planla" completes without approval and without a calendar write; it restyles the unrelated 17:00 deadline row; the days strip is static; the toast "Planlandı · Yarın 14:00–16:30 Teklif hazırlama" fakes success; "Başka zaman" toast.
- **Maps to MASTER_PROMPT:** #19, #20, #23, #33, #93, #94, #98, #115

### Plan · Hafta / Plan · Week (density + calendar intelligence)
- **Source:** PRIMARY / Dijital Asistan.dc.html / `isWeek` (lines 226–247), data `WEEK`
- **Purpose:** Weekly load overview and proactive calendar insights (busy day, travel time, conflict).
- **Layout:**
  - The TAKVİM ZEKÂSI card from the Day view stays above.
  - Density card: `#fff`, r20, p16. Kicker "7–13 EYLÜL · YOĞUNLUK". Chart height 120, gap 8; per day two stacked bars (r5, gap 3, height in px). Labels 11/600.

| bar role | normal | hot day (Çar) | today (Cmt) |
|---|---|---|---|
| upper bar | `#D9D6F7` | `#F3B7AE` | `#5B5CE2` |
| lower bar | `#EDEDFC` | `#E0553F` | `#A9AAF5` |
| label colour | `#6B6860` | `#C7432F` | `#5B5CE2` |

  - Values (upper/lower px): Pzt 38/20, Sal 26/14, Çar 54/30, Per 30/10, Cum 22/26, Cmt 16/8, Paz 8/0.
  - Three insight cards: `#fff`, r16, padding 14 16, gap 12; icon 20; title 15/600; body 13/19 `#6B6860`.
- **Exact copy:**
  - `bolt` (`#9A6300`): "Yarın oldukça yoğun." / "09:00 ve 10:00 toplantıların arka arkaya. Arada mola yok."
  - `directions_car` (`#2262BE`): "13:30 doktor randevusu için 12:50'de çıkman gerekebilir." / "Kadıköy → Nişantaşı · 38 dk trafik tahmini"
  - `error` (`#C7432F`): "Çarşamba 14:00 müşteri toplantısı ile 14:30 doktor çakışıyor." + text button "Seçenekleri Gör"
- **Data → entities:** `week_load{date, meeting_minutes?, task_minutes?}` (the two series are unlabelled); `calendar_insights{kind: back_to_back|travel_time|conflict|free_slot|prep_needed, severity, event_ids[], title, body, source, travel_minutes?, origin?, destination?}`.
- **Interactions → real behavior:**
  - "Seçenekleri Gör" → conflict-resolution sheet (05/5.3). Each option (move, decline, shorten) creates a `calendar_update` approval.
  - Bar tap (dead) → jump to Day view for that date.
  - Insight tap → affected events.
- **States depicted:** Week.
- **States missing:** chart legend and accessibility labels (VoiceOver summary per day); empty week; loading; calendar not connected; location permission denied / no routing provider → hide the travel card; dark.
- **Prototype-only / fake:** "38 dk trafik tahmini" and "12:50'de çıkman gerekebilir" need a routing API plus home/current location. The master rule "Seyahat süresi kaynakta yoksa uydurma" (#20) and the hub's "ek entegrasyon gerekmez" both forbid inventing it. "Seçenekleri Gör" is a toast only.
- **Maps to MASTER_PROMPT:** #19, #20, #33, #92, #115

### Asistan · Giriş (boş sohbet) / Assistant · Entry (empty chat)
- **Source:** PRIMARY / Dijital Asistan.dc.html / `isAsistan` + `chatEmpty` (lines 251–268, 286–291), data `QA`
- **Purpose:** Second-layer conversational interface; starts from grounded context and suggested prompts, never a blank chat.
- **Layout:**
  - Scroll padding 70 20 24, gap 14.
  - Header: H1 "Asistan" and pill "Hafıza" (h36, `#fff`, fg `#6B6860` neutral, `search` 18).
  - Context card: `#fff`, r16, padding 12 14. Avatar 34 circle `#EDEDFC` with `auto_awesome` 18 `#5B5CE2` FILL. Text 14/20 with bold counts.
  - Kicker "ÖNERİLEN" (padding 6 4 0).
  - Suggestion buttons: h52, padding 0 16, r16, `#fff`, 500 15 `#1A1917`, trailing `arrow_outward` 18 `#B8B4AA`, shadow `0 1px 2px rgba(27,25,23,.04)`, hover `#EDEDFC`, gap 8.
  - Composer dock (padding 8 16 112, gradient `linear-gradient(180deg,rgba(245,244,240,0),#F5F4F0 30%)`): pill h52, r999, `#fff`, padding 0 6 0 16, shadow `0 1px 2px rgba(27,25,23,.06),0 8px 24px rgba(27,25,23,.08)`; input 400 15; mic 40 circle `#5B5CE2` `mic` 20 white.
- **Exact copy:**
  - "Bugün **46 mail**, **4 etkinlik** ve **2 takip** analiz edildi. Ne öğrenmek istersin?"
  - "ÖNERİLEN": "Bugün neye odaklanmalıyım?", "Kimlere cevap vermem gerekiyor?", "Yarın yoğun muyum?", "Bu hafta hangi deadline'lar var?", "Mehmet ile en son ne konuştuk?"
  - Placeholder "Dijital hayatına sor…"
- **Data → entities:** `daily_stats{emails_analyzed:46, events:4, followups:2}`; `suggested_prompts` (static or personalized list).
- **Interactions → real behavior:**
  - "Hafıza" → push AI Hafıza search (06/6.5; pgvector semantic search with FTS fallback, #26).
  - Suggestion → send as a user message to the grounded assistant Edge Function (retrieval, then answer with citations).
  - Composer → a send button appears when text is non-empty; submit; keyboard avoidance.
  - Mic → Ses Modu (permission gate first).
- **States depicted:** empty.
- **States missing:** loading stats; no data yet / not connected; offline (disable send, show cached history); rate/cost limit reached (Free "limited AI", #44); conversation history / new chat; dark (06/6.1D).
- **Prototype-only / fake:** the composer does nothing; "Hafıza" is a toast; stats are static.
- **Maps to MASTER_PROMPT:** #24, #25, #26, #44, #82, #83, #93

### Asistan · Zengin kartlı yanıt / Assistant · Conversation with rich card
- **Source:** PRIMARY / Dijital Asistan.dc.html / `chat` + `typing` (lines 269–284), `ask()`
- **Purpose:** Grounded answer with a structured card.
- **Layout:**
  - Bubbles: max-width 86%, padding 10 14, r18, 15/21. User bubble right-aligned, `#5B5CE2` bg, white text, no shadow. AI bubble left-aligned, `#fff`, `#1A1917`, card shadow.
  - Rich card: full width, `#fff`, r16, padding 12 14. Title 12/600/.06em `#9B978E`. Rows padding 8 0, border-top 1px `rgba(27,25,23,.06)`, icon 18 `#5B5CE2`, text 14, meta 12 `#9B978E`.
  - Typing indicator: three 7px dots `#9B978E`, `dabar` .8 s staggered .15 s.
- **Exact copy (QA):**
  - "Bugün neye odaklanmalıyım?" → "En kritik konu Ahmet'in 17:00'ye kadar beklediği revize teklif. Sonrasında 14:30 Mehmet toplantısı için 3 konuya hazırlanman yeterli." Card "BUGÜNÜN 2 ÖNCELİĞİ": `mail` "Revize teklif · Ahmet" "17:00"; `event` "Mehmet ile toplantı" "14:30".
  - "Kimlere cevap vermem gerekiyor?" → "2 kişi senden cevap bekliyor." Card "SENDEN BEKLEYENLER": `person` "Ahmet Yılmaz · Revize teklif" "Bugün 17:00"; `person` "Selin Kaya · Sözleşme taslağı" "3 saat".
  - "Yarın yoğun muyum?" → "Yarın oldukça yoğun: 09:00 ve 10:00 toplantıların arka arkaya. 14:00–16:30 arası boş; teklif hazırlamak için uygun." Card "YARIN · 4 ETKİNLİK": `event` "Haftalık ekip" "09:00"; `event` "Ürün gözden geçirme" "10:00"; `medical_services` "Doktor randevusu" "13:30"; `event` "Yatırımcı görüşmesi" "17:00".
  - "Bu hafta hangi deadline'lar var?" → "Bu hafta 3 son tarih var. İkisi ödeme, biri başvuru." Card "SON TARİHLER": `flag` "Girişim programı başvurusu" "Bugün 17:00"; `autorenew` "Netflix yenileme" "9 Eyl"; `receipt_long` "Elektrik faturası · 1.842 TL" "10 Eyl".
  - "Mehmet ile en son ne konuştuk?" → "1 Eylül'de fiyat ve teslim tarihini konuştunuz. Mehmet, Ekim başı teslim için revize teklif istedi; sen Cuma göndereceğini söyledin." Card "KAYNAKLAR": `mail` "Re: Teklif · Gmail" "1 Eyl 18:20"; `call` "Görüşme notları" "1 Eyl 15:00".
- **Data → entities:** `assistant_messages{role, text, cards[], citations[{source_type, source_id, provider, timestamp}]}`; card rows → entity refs.
- **Interactions → real behavior:**
  - Card rows are dead in the prototype. They must open the referenced entity (mail, event, person, life item). "KAYNAKLAR" rows open the source (#131).
  - Offer follow-up actions (e.g., "Yanıt hazırla") that route into approval.
  - Long-press to copy.
  - Feedback on the answer (👍/👎 → `ai_feedback`, #59).
- **States depicted:** typing (1000 ms), answered.
- **States missing:** streaming; error / retry; "Kaynaklarda bulamadım" (no-answer, anti-hallucination, #83); partial sources; offline queued; cost-limit reached; stop generating.
- **Prototype-only / fake:** canned answers after a fixed 1 s delay; suggestions vanish after the first answer and the composer is dead (dead end); only one answer shows sources.
- **Maps to MASTER_PROMPT:** #24, #26, #59, #83, #97, #131

### Sabah Brifingi / Morning Briefing (full screen)
- **Source:** PRIMARY / Dijital Asistan.dc.html / `isBriefing` (lines 294–322), data `BRIEF`
- **Purpose:** Full-screen narrative briefing with structured sections.
- **Layout:**
  - Hero: `linear-gradient(160deg,#1E1E4C 0%,#3B3CA8 58%,#7071EA 100%)`, padding 96 20 60, white.
    - Back button absolute top 60 / left 16, 36 circle `rgba(255,255,255,.16)`, `arrow_back` 20.
    - Kicker 12/600/.08em opacity .72.
    - Title 32/38, 600, −.02em.
    - Sub 16/22 `rgba(255,255,255,.8)`.
  - Body sheet: margin-top −28, bg `#F5F4F0`, r28 28 0 0, padding 26 20 130, gap 22.
    - Narrative paragraph in **Lora** 18/29 `#1A1917`.
    - Sections: kicker (padding 0 4 8) then card `#fff`, r18, padding 4 16, card shadow. Rows gap 12, padding 11 0, border-top between rows; icon tile 30×30 r10 `#F0EFEB`/`#6B6860` icon 17; title 500 15/20 −.01em; meta 12 `#9B978E`.
  - Sticky bottom container: padding 16 20 44, gradient `linear-gradient(180deg,rgba(245,244,240,0) 0%,#F5F4F0 45%)`. Dark button (w100%, h52, r16, `#1A1917`, white 600 15, `headphones` 20, shadow `0 8px 24px rgba(27,25,23,.18)`).
- **Exact copy:**
  - "SABAH BRİFİNGİ · 5 EYLÜL" / "Günaydın {name}" (no comma) / "Bugün oldukça sakin bir günün var."
  - Narrative: "Öğlene kadar toplantın bulunmuyor. Saat 14:30'da Mehmet ile müşteri toplantın var. Toplantı öncesinde dün gelen fiyat teklifine bakman faydalı olabilir. Gelen 46 mail arasında 3 konu dikkat gerektiriyor."
  - BUGÜNÜN ÖNCELİKLERİ: `mail` "Ahmet'e revize teklif" "Acil · 17:00"; `event` "Mehmet ile müşteri toplantısı" "14:30 · Hazırlık öneriliyor"; `flag` "Başvuru 17:00'de kapanıyor" "Son tarih"
  - PROGRAMIN: `event` "Mehmet ile müşteri toplantısı" "14:30 · 60 dk · Ofis"; `videocam` "Ürün gözden geçirme" "16:00 · 30 dk · Online"; `flag` "Başvuru son saati" "17:00"; `restaurant` "Akşam yemeği rezervasyonu" "20:30 · Karaköy"
  - SENDEN CEVAP BEKLEYENLER: `person` "Ahmet Yılmaz · Revize teklif" "Bugün 17:00"; `person` "Selin Kaya · Sözleşme taslağı" "3 saattir bekliyor"
  - SENİN CEVAP BEKLEDİKLERİN: `schedule_send` "Mehmet Yılmaz · Teklif" "3 gündür yanıt yok"
  - SON TARİHLER: `flag` "Girişim programı başvurusu" "Bugün 17:00"; `receipt_long` "Elektrik faturası · 1.842 TL" "10 Eylül"
  - KİŞİSEL GELİŞMELER: `package_2` "Trendyol siparişin bugün geliyor" "14:00–18:00"; `flight` "TK2412 İstanbul → Antalya" "Yarın 09:15"; `autorenew` "Netflix yenilenecek" "9 Eylül"
  - CTA "Brifingi Dinle · 2 dk"
- **Data → entities:** `briefings{id, type:'morning', date, headline, mood_line, narrative_md, sections[{key: priorities|schedule|awaiting_user|awaiting_others|deadlines|personal, items[{entity_type, entity_id, title, meta, icon}]}], audio{url, duration_s:134, chapters[]}, generated_at, model_version}`.
- **Interactions → real behavior:**
  - Back → pop.
  - "Brifingi Dinle" → audio modal.
  - Section rows (dead) → entity detail/source (#131).
  - Add share, feedback ("Bu brifing faydalı mıydı?") and a "Kaynaklar" disclosure for the narrative.
- **States depicted:** default (light body, dark hero).
- **States missing:**
  - Generating ("Brifingin hazırlanıyor"), failed with retry, stale, empty sections (hide or "Bugün yok").
  - Partial (calendar missing), offline cached.
  - Midday/evening/weekly variants (03); dark body (03/3.3D).
  - Free vs Pro (the audio CTA is gated by "Sesli brifing" Pro); Dynamic Type for Lora.
- **Prototype-only / fake:** the entire content is static; "2 dk" is hard-coded.
- **Maps to MASTER_PROMPT:** #9, #10, #11, #12, #44, #80, #83, #96, #131

### Sesli Brifing / Audio Briefing player
- **Source:** PRIMARY / Dijital Asistan.dc.html / `isAudio` (lines 324–351), data `CHAPTERS`, `togglePlay`
- **Purpose:** Listen to the briefing with chapters.
- **Layout:**
  - Full-screen `linear-gradient(180deg,#15153A 0%,#25266A 60%,#3B3CA8 100%)`, padding 60 20 48, white text.
  - Top row: collapse button (36 circle `rgba(255,255,255,.14)`, `expand_more`); kicker "SESLİ BRİFİNG" opacity .7; speed pill (h32, padding 0 12, r999, `rgba(255,255,255,.14)`, 600 13).
  - Title 26/32, 600 (margin-top 44). Meta 14 `rgba(255,255,255,.7)`.
  - Waveform (margin-top 40): 34 bars 4px wide, gap 5, container height 72, heights 14 + ((i·13) mod 7)·8, animation `dabar` (scaleY .25→1), played bars `#fff`, unplayed `rgba(255,255,255,.35)`.
  - Progress track 4px r2 `rgba(255,255,255,.18)`, fill `#fff` (width .5 s linear). Times 12 `rgba(255,255,255,.7)`.
  - Transport (gap 28): back-15 (52 circle transparent, `replay` 30 + "15" 10/600); play/pause 76 white circle, icon `#25266A` 40 FILL 1, shadow `0 10px 30px rgba(0,0,0,.25)`, pressed scale .95; fwd-15 (mirrored `replay`).
  - Chapter list (margin-top 36): rows padding 11 4, border-top 1px `rgba(255,255,255,.1)`, 500 14; number 22px wide 12 `rgba(255,255,255,.6)`; duration 12; inactive opacity .55.
- **Exact copy:** "SESLİ BRİFİNG", "1.0x" | "1.25x" | "1.5x", "Sabah Brifingi", "5 Eylül · 2 dk 14 sn · {chapterName}", elapsed "0:42" / "2:14". Chapters: "01 Genel bakış 0:18", "02 Bugünün öncelikleri 0:32", "03 Programın 0:24", "04 Cevap bekleyenler 0:21", "05 Son tarihler 0:17", "06 Kişisel gelişmeler 0:22" (sum 134 s).
- **Data → entities:** `briefing_audio{briefing_id, url(storage), duration_s, voice, provider: native|premium, chapters[{title, start_s, duration_s}]}`; `playback_state` (local).
- **Interactions → real behavior:**
  - Play/pause → real audio (expo-audio or react-native-track-player) with background audio and lock-screen/Control Center/Android media notification controls.
  - ±15 s seek; speed 1.0/1.25/1.5 (consider 0.75 and 2.0).
  - Chapter tap → seek to `start_s`; scrubbing the progress bar (missing).
  - Collapse → dismiss, keep playing, show a mini-player (missing).
  - Native TTS fallback via `expo-speech` does not produce a seekable file; chapters and seek need a pre-rendered file or a chunked-per-chapter approach (#9).
- **States depicted:** paused (initial), playing, chapter highlight.
- **States missing:** generating audio / buffering; network error; TTS unavailable; end-of-briefing; audio interrupted (call); Pro gate (#44 Voice Briefing is Pro); VoiceOver labels for icon-only controls; "15" must be read as "15 saniye geri/ileri".
- **Prototype-only / fake:** `setInterval` 1 s fake timer; hard-coded 134 s and chapter starts `[0,18,50,74,95,112]`; initial position 42; decorative waveform (not audio-derived).
- **Maps to MASTER_PROMPT:** #9, #25, #44, #92, #123

### Toplantıya Hazırlan / Meeting Prep (signature screen)
- **Source:** PRIMARY / Dijital Asistan.dc.html / `isPrep` (lines 353–393), data `PREP`
- **Purpose:** Everything needed before a meeting in one place.
- **Layout:**
  - Scroll padding 60 20 130, gap 16.
  - Top bar: back (36 circle `#fff`, shadow `0 1px 2px rgba(27,25,23,.08)`); kicker "TOPLANTIYA HAZIRLAN"; countdown pill (h30, padding 0 10, r999, `#FDF2DC`/`#9A6300`, 12/600, `schedule` 15).
  - Person button row: avatar 56 `#DCE4F5`/`#2B3F73` "MY" 20/600; name 24/30, 600, −.02em; meta 14 `#6B6860`; `chevron_right` 22 `#B8B4AA`.
  - Dark talking-points card: `#1A1917`, white, r24, p20, shadow `0 12px 32px rgba(27,25,23,.18)`. Kicker `#A9AAF5` + `auto_awesome`. Items gap 14; number circle 26 `rgba(255,255,255,.12)` 13/600; title 17/600; body 14/20 `rgba(255,255,255,.7)`.
  - Six section cards (same pattern as briefing, rows align flex-start, text 15/21).
  - Sticky bottom (gradient fade): primary "2 Dakikalık Özeti Oku" (flex 1, h52, r16, `#5B5CE2`, shadow `0 8px 24px rgba(91,92,226,.28)`); secondary "Not Al" (h52, padding 0 18, r16, `#fff`, shadow `0 1px 2px rgba(27,25,23,.08)`).
- **Exact copy:**
  - "TOPLANTIYA HAZIRLAN", "18 dk", "Mehmet Yılmaz", "Müşteri toplantısı · 14:30 · 60 dk", "KONUŞMAN GEREKEN 3 ŞEY"
  - "1 Fiyat — Revize teklif 17:00'ye kadar bekleniyor; %8 indirim sınırını netleştir."
  - "2 Teslim tarihi — Ekim başı için onay istiyor; üretim takvimi 6 Ekim'i gösteriyor."
  - "3 Sözleşme — Taslak 2 haftadır açık; hukuk yorumu bekliyor."
  - TOPLANTININ AMACI: `target` "Eylül teklifinin son hâlini netleştirmek ve Ekim teslimatı için onay almak." / "Takvim davetinden çıkarıldı"
  - SON GÖRÜŞMENİZ: `history` "1 Eylül · Fiyat aralığı ve teslim süresi konuşuldu. Mehmet revize teklif istedi; sen Cuma göndereceğini söyledin." / "4 gün önce · Görüşme notları"
  - SON MAİLLER: `mail` "Re: Teklif — “Fiyatı Ekim teslimatına göre güncelleyebilir misiniz?”" / "Mehmet · Dün 18:20"; `mail` "Teklif v2 gönderildi (PDF)" / "Sen · 2 Eyl 10:05"
  - AÇIK KONULAR: `radio_button_unchecked` "Sözleşme taslağı hukuk yorumu bekliyor" / "14 gün"; "Nakliye maliyeti kimde?" / "1 Eylül görüşmesi"
  - SENDEN BEKLENENLER: `person` "Revize teklif · PDF" / "Bugün 17:00"
  - SENİN BEKLEDİKLERİN: `schedule_send` "Teklif v2 için geri bildirim" / "3 gündür bekliyor"
  - CTAs "2 Dakikalık Özeti Oku", "Not Al"
- **Data → entities:** `meeting_prep{event_id, person_id, minutes_until, purpose{text, source:'calendar_invite'}, last_interaction{date, summary, source:'notes'}, recent_emails[{message_id, subject, snippet, from, at}], open_loops[{text, age_days, source}], user_owes[], they_owe[], talking_points[3]{title, body, source_refs[]}, relevant_files[], generated_at}`.
- **Interactions → real behavior:**
  - Back → pop. Person row → Kişi Zekâsı (#21).
  - Mail rows (dead) → Mail Detayı (#21). Open-loop / commitment rows → commitment detail (Tamamlandı / Ertele / Kaynağı Gör, #18).
  - "2 Dakikalık Özeti Oku" → push the 2-minute summary reading view (05/5.6), optionally with TTS.
  - "Not Al" → pre-meeting note capture (text/voice) attached to the event. The post-meeting prompt should be triggered by event end.
  - Missing but required: "Toplantıya Katıl" meeting-link external handoff (#21), location/maps handoff, attendee list, relevant files.
- **States depicted:** default light (dark exists in 05/5.5).
- **States missing:** generating prep, insufficient history ("İlk görüşmeniz"), no linked person, event cancelled/moved, meeting started/ended (switch to post-meeting), offline, Pro gate (#44 Meeting Prep is Pro), error.
- **Prototype-only / fake:** "18 dk" static; the "2 Dakikalık Özeti Oku" toast (`headphones` icon suggests audio while the label says read); "Not Al" jumps to the post-meeting screen.
- **Maps to MASTER_PROMPT:** #18, #21, #22, #30, #44, #83, #97, #131

### Toplantı Sonrası / Post-Meeting capture
- **Source:** PRIMARY / Dijital Asistan.dc.html / `isPost` (lines 395–420)
- **Purpose:** After the meeting, capture follow-ups and turn a spoken statement into a commitment.
- **Layout:**
  - Padding 60 20 40, gap 18. Back button.
  - Kicker "TOPLANTI SONRASI · MEHMET YILMAZ"; H 28/34, 600; sub 16/23 `#6B6860`.
  - Quote card: `#fff`, r20, p16; italic 15/22; meta 12 `#9B978E` with `mic` 16.
  - AI card: gradient `radial-gradient(140% 100% at 0% 0%,#E4E4FA 0%,#FFFFFF 60%)`, r20, p16; kicker "YENİ TAAHHÜT"; title 18/600; chips (h30, padding 0 10, r999, `#F0EFEB`/`#6B6860`, 12/600, icon 15).
  - Bottom buttons (margin-top auto): "Kaydet" primary flex 1 h52 r16; "Vazgeç" white.
- **Exact copy:** "TOPLANTI SONRASI · MEHMET YILMAZ", "Toplantın bitti.", "Takip etmen gereken bir şey var mı?", "“Mehmet'e yarın teklif göndereceğim.”", "Sesle eklendi · 15:31", "YENİ TAAHHÜT", "Mehmet'e teklif gönder", chips "Yarın" (`event`), "Mehmet Yılmaz" (`person`), "Kaydet", "Vazgeç".
- **Data → entities:** `post_meeting_notes{event_id, input_type: voice|text, transcript, created_at}`; `commitments{id, text, person_id, due_date, source_type:'post_meeting_note', source_id, status:'open', confidence, created_by: user|ai}`.
- **Interactions → real behavior:**
  - Entry via local notification at event end (#22) → text field + mic (STT).
  - AI proposes a commitment; chips are editable (date picker, person picker).
  - "Kaydet" → user-confirmed `commitment_create` (explicit confirmation; stored with approval audit) plus a reminder due tomorrow; toast.
  - "Vazgeç" → discard (confirm if text entered).
  - Multiple proposals if several statements.
- **States depicted:** a single proposal, pre-filled.
- **States missing:** input stage (recording / transcribing, 05/5.7); no commitment detected ("Kaydedilecek bir taahhüt bulamadım"); ambiguous (confirmation required, #18); mic permission denied; save error; offline queue.
- **Prototype-only / fake:** pre-filled transcript; reached via "Not Al"; the toast "Taahhüt kaydedildi · Yarın hatırlatırım" without persistence.
- **Maps to MASTER_PROMPT:** #18, #22, #25, #29, #33, #115

### Mail Detayı / Email Detail
- **Source:** PRIMARY / Dijital Asistan.dc.html / `isMail` (lines 422–462)
- **Purpose:** AI summary first, actions, then the original message and its source.
- **Layout:**
  - Padding 60 20 40, gap 16.
  - Top: back + severity badge "ACİL" (padding 4 9, `#FCEDE9`/`#C7432F`, 11/700/.05em).
  - Sender row: avatar 44 `#F5E1D6`/`#7A3E1F` "AY" 15/600; name 16/600; meta 13 `#6B6860`.
  - Subject 22/28, 600, −.02em.
  - AI summary card (radial gradient, r20, p16): kicker "AI ÖZETİ"; summary 17/24/500; sub-kicker "ÖNEMLİ NOKTALAR"; bullets with 6px dots `#5B5CE2`, 14/20.
  - 2×2 action grid (gap 10), tiles h56, r16, padding 0 14, 600 14, icon 20. Tile 1 is primary (`#5B5CE2`, white); the others are white with brand icon and shadow `0 1px 2px rgba(27,25,23,.06)`.
  - Accordion card (r18, overflow hidden): header h52 with `mail` 20 `#6B6860` + label + `expand_more|expand_less` 22 `#9B978E`; body 14/21 pre-wrap, top border.
  - Source line 12 `#9B978E` with `verified` 16.
- **Exact copy:**
  - "ACİL", "Ahmet Yılmaz", "Bugün 08:42 · Gmail", "Re: Eylül teklifi – revize", "AI ÖZETİ"
  - "Ahmet revize fiyat teklifinin bugün 17:00'ye kadar gönderilmesini istiyor."
  - "ÖNEMLİ NOKTALAR": "Revize fiyat", "Deadline 17:00", "PDF gönderilecek"
  - Actions: "Yanıt Hazırla" (`edit_note`), "Görev Oluştur" (`add_task`), "Takvime Ekle" (`event`), "Hatırlat" (`notifications`)
  - "Orijinal Mail"; body: "Merhaba Yunus,\n\nGeçen hafta konuştuğumuz teklifi revize edebilir misin? Yönetim bugün saat 17:00'ye kadar güncellenmiş fiyatı PDF olarak görmek istiyor. Teslim tarihini de netleştirsek iyi olur.\n\nTeşekkürler,\nAhmet"
  - "Kaynak: Gmail · ahmet.yilmaz@… · Gelen Kutusu"
- **Data → entities:** `emails{id, provider_message_id, thread_id, account_id, from_name, from_email, subject, received_at, labels/folder, body_text(sanitized), attachments[]}`; `email_analysis{email_id, summary, key_points[], category (#14), importance, severity, due_at, confidence, reasons[], model_version}`.
- **Interactions → real behavior:**
  - "Yanıt Hazırla" → AI Yanıt for the thread.
  - "Görev Oluştur" → `task_create` approval (prototype: "Revize teklifi hazırla · Bugün 16:00'ya kadar", change "Plan'a 1 görev bloğu · 45 dk").
  - "Takvime Ekle" → `calendar_create` approval ("“Revize teklif teslimi” · Bugün 17:00", "Takvime 1 etkinlik · 30 dk önce hatırlatma"), deduped.
  - "Hatırlat" → reminder sheet.
  - "Orijinal Mail" → expand the sanitized body (no remote images or trackers; render as text or safe HTML).
  - Required but missing: "Orijinal Maili Aç" → external handoff to the Gmail/Outlook web or app deep link (#15).
  - Why-important explainer (#131: reason, confidence, rule that fired, e.g. "VIP kişi · son tarih içeriyor").
  - Sender → Kişi Zekâsı; attachments list; archive/mark-read are not in scope unless approved.
- **States depicted:** original collapsed/expanded.
- **States missing:** loading; summary generating/failed (show the original); message deleted at provider; attachment-only mail; long thread; offline cached; prompt-injection-flagged content (#114); a low-confidence badge.
- **Prototype-only / fake:** a single hard-coded mail regardless of entry (p3 "Başvuru" also opens it); "Görev Oluştur" is wired to `toastTask` but actually creates an approval; duplicate approvals on repeated taps.
- **Maps to MASTER_PROMPT:** #14, #15, #16, #29, #33, #83, #97, #114, #115, #116, #131

### AI Yanıt Taslağı · Taslak / AI Reply Draft (Ahmet: "YANIT TASLAĞI"; Mehmet: "TAKİP MESAJI")
- **Source:** PRIMARY / Dijital Asistan.dc.html / `isReply` + `notSent` (lines 464–491), data `REPLY_AHMET`, `REPLY_MEHMET`, `TONE_LIST`
- **Purpose:** Generate → edit → approve → send. Never a silent send.
- **Layout:**
  - Padding 60 20 40, gap 16.
  - Top bar: back / kicker / 36px spacer.
  - "Kime" row 14 `#6B6860` with recipient chip (h30, padding 0 10 0 4, r999, `#fff`, 600, shadow `.06`; avatar 22 with 10px initials).
  - Full-width 4-segment tone control (track `#E9E7E1`, padding 3; segments flex 1, h32, 600 13; active `#fff` / `#1A1917` / shadow `0 1px 3px rgba(27,25,23,.12)`).
  - Draft card: `#fff`, r20, p18. Header: kicker "AI TASLAĞI · {TONE}" `#5B5CE2` + "Düzenlenebilir" 12 `#9B978E`. Body 15/23 pre-wrap.
  - Trust line: `verified_user` 18 `#1E7A47` + 13 `#6B6860`.
  - Bottom: primary "Göndermeyi Onayla" (flex 1, h52, r16, brand shadow, spinner + label) and "Düzenle" (white).
- **Exact copy:**
  - Kickers "YANIT TASLAĞI" / "TAKİP MESAJI"; "Kime"; chip "AY Ahmet Yılmaz" (`#F5E1D6`/`#7A3E1F`) or "MY Mehmet Yılmaz" (`#DCE4F5`/`#2B3F73`).
  - Tones "Kısa", "Profesyonel" (default), "Samimi", "Detaylı".
  - "AI TASLAĞI · PROFESYONEL", "Düzenlenebilir", "Sen onaylamadan hiçbir mail gönderilmez.", "Göndermeyi Onayla" → "Gönderiliyor…", "Düzenle".
  - Drafts to Ahmet:
    - Kısa: "Merhaba Ahmet,\n\nRevize teklifi bugün 17:00'den önce PDF olarak göndereceğim.\n\nİyi çalışmalar,\nYunus"
    - Profesyonel: "Merhaba Ahmet,\n\nTalebiniz için teşekkürler. Revize fiyat teklifini, güncellenmiş teslim tarihiyle birlikte bugün 17:00'den önce PDF formatında iletiyor olacağım.\n\nSorularınız olursa memnuniyetle yardımcı olurum.\n\nİyi çalışmalar,\nYunus"
    - Samimi: "Selam Ahmet,\n\nMesajın için teşekkürler! Revize teklifi bugün 17:00'den önce PDF olarak yolluyorum, merak etme.\n\nGörüşmek üzere,\nYunus"
    - Detaylı: "Merhaba Ahmet,\n\nRevize teklife ilişkin talebinizi aldım. Fiyat kalemlerini güncelledim, teslim tarihini Ekim başı olarak netleştirdim ve sözleşme taslağına atıf ekledim. Belgeyi bugün 17:00'den önce PDF olarak göndereceğim.\n\nEk bir kalem veya değişiklik isterseniz lütfen belirtin.\n\nİyi çalışmalar,\nYunus"
  - Drafts to Mehmet:
    - Kısa: "Merhaba Mehmet,\n\n2 Eylül'de ilettiğim teklif hakkında görüşünüzü alabilir miyim?\n\nİyi çalışmalar,\nYunus"
    - Profesyonel: "Merhaba Mehmet,\n\n2 Eylül'de ilettiğim teklifle ilgili değerlendirmenizi öğrenmek isterim. Sorularınız varsa bugünkü görüşmemizde ele alabiliriz.\n\nİyi çalışmalar,\nYunus"
    - Samimi: "Selam Mehmet,\n\nGeçen hafta yolladığım teklife bakma fırsatın oldu mu? Bugün görüştüğümüzde üzerinden geçebiliriz.\n\nGörüşmek üzere,\nYunus"
    - Detaylı: "Merhaba Mehmet,\n\n2 Eylül'de ilettiğim teklifte fiyat, teslim tarihi ve sözleşme koşullarını özetlemiştim. Değerlendirmenizi ve varsa revize taleplerinizi bugünkü 14:30 görüşmemiz öncesinde alabilirsem toplantıyı daha verimli kullanabiliriz.\n\nİyi çalışmalar,\nYunus"
- **Data → entities:** `drafts{id, user_id, kind: reply|followup, thread_id, in_reply_to_message_id, to[], cc[], subject, body, tone, model_version, source_refs[], status: draft|pending_approval|approved|sending|sent|failed}`; `approvals{type:'email_send', payload{draft_id, account_id, to, subject, body_hash}, idempotency_key}`.
- **Interactions → real behavior:**
  - Tone segment → regenerate the draft for that tone (server, streaming), keeping user edits only if confirmed; cache per tone.
  - The draft body must be an editable TextInput. "Düzenle" focuses the editor; the prototype only toasts "Taslak düzenleme modunda".
  - "Göndermeyi Onayla" → the approval record becomes approved in place → server executes `email_send` via Gmail API `users.messages.send` or Graph `sendMail` with the thread headers, idempotency key, status executing → executed/failed → success screen only after the provider accepts.
  - Back with unsaved edits → keep the draft (autosave) and confirm discard.
  - Also missing: recipient edit, CC, subject line, attachment (the mail asks for a PDF: "PDF gönderilecek").
- **States depicted:** draft per tone; sending (spinner + "Gönderiliyor…").
- **States missing:** generating/streaming; generation failed; offline (block send, keep draft); send failed with retry; token/scope missing ("Gönderim izni gerekli" → re-auth with `gmail.send` / `Mail.Send`); duplicate-send guard; Pro/Free AI limit; editing state; dark.
- **Prototype-only / fake:** a 900 ms fake send; canned drafts. The "Detaylı" Ahmet draft asserts work the user may not have done ("Fiyat kalemlerini güncelledim… sözleşme taslağına atıf ekledim"); production prompts must not invent completed actions (#83).
- **Maps to MASTER_PROMPT:** #16, #17, #33, #83, #94, #98, #115, #116

### AI Yanıt · Gönderildi / AI Reply · Sent (success)
- **Source:** PRIMARY / Dijital Asistan.dc.html / `isReply` + `sent` (lines 492–502), `finishSend`
- **Purpose:** Confirm execution and close the loop.
- **Layout:** centered, padding 40, gap 14. 96px circle `#E4F5EA` scaling .4→1 (.5 s `cubic-bezier(.2,.8,.2,1)`); `check_circle` 48 `#1E7A47` FILL (delay .1 s). Title 26/600. Body 15/22 `#6B6860`. Button h48, padding 0 22, r14, `#1A1917`, white 600 15.
- **Exact copy:** "Gönderildi" / "{Ahmet Yılmaz|Mehmet Yılmaz} yanıtını aldı. Cevap gelince Akış'ta göreceksin." / "Bugün'e Dön". Toast after: "Mail gönderildi · Ahmet Yılmaz" (`send`).
- **Data:** `approvals.status='executed'`, `executed_at`, `provider_message_id`; the linked insight becomes `done`; the follow-up tracker is created (await reply).
- **Interactions → real behavior:** "Bugün'e Dön" → switch to the Today tab and pop to root (the prototype only clears the stack and leaves the current tab); refresh Today; start a "waiting for reply" follow-up watch on the thread.
- **States missing:** "Gönderim sıraya alındı" (queued/offline); failed with retry; partially failed.
- **Prototype-only / fake:** success is shown without a provider. "yanıtını aldı" claims delivery; production should say "Yanıtın gönderildi."
- **Maps to MASTER_PROMPT:** #16, #17, #33, #98, #115

### Onay Merkezi ("Onay Bekleyenler") / Approval Center
- **Source:** PRIMARY / Dijital Asistan.dc.html / `isApprovals` (lines 505–538), initial `state.approvals`, `addApproval`
- **Purpose:** Single queue for every AI-proposed write action.
- **Layout:**
  - Padding 60 20 40, gap 14. Back + spacer.
  - H1 "Onay Bekleyenler" 28/34. Summary 14 `#6B6860`.
  - Card: `#fff`, r20, p16, card shadow.
    - Row: icon tile 28 r9 `#EDEDFC`/`#4547C9` icon 17; type 12/600/.06em `#6B6860` flex 1; status pill 11/700.
    - "what" 17/23, 600.
    - Key/value grid `64px 1fr`, gap 6 10, 13/19: labels `#9B978E`, values `#1A1917`.
    - Buttons (gap 8, h42, r12, 600 14): "Onayla" flex 1 `#5B5CE2`/`#fff`; "Düzenle" `#EDEDFC`/`#4547C9`; "Reddet" `#F0EFEB`/`#6B6860`.
  - Footer trust line `verified_user` `#1E7A47`, 13/19.
- **Exact copy:**
  - Summary: "{n} işlem onayını bekliyor · Hiçbiri sen onaylamadan yapılmaz" or "Bekleyen işlem yok".
  - Status pills: "BEKLİYOR" (`#FDF2DC`/`#9A6300`), "ONAYLANDI" (`#E4F5EA`/`#1E7A47`), "REDDEDİLDİ" (`#F0EFEB`/`#6B6860`, card opacity .45).
  - Labels "Neden", "Değişim". Footer "Önemli işlemler sen onaylamadan gerçekleştirilmez."
  - Seed a1: `send` "MAİL GÖNDER" / "Mehmet Yılmaz'a takip mesajı gönder" / Neden "Teklif mailine 3 gündür yanıt gelmedi." / Değişim "1 mail gönderilecek · Kısa, profesyonel ton".
  - Seed a2: `event_repeat` "ETKİNLİK TAŞI" / "Mehmet toplantısını 16:00'ya al" / "Mehmet 16:00'yı önerdi; takvimin uygun." / "14:30 → 16:00 · Katılımcılara bildirim gider".
  - Generated: `event` "ETKİNLİK OLUŞTUR" ("“Başvuru son saati” · Bugün 17:00" or "“Revize teklif teslimi” · Bugün 17:00", "Mailde son tarih tespit edildi.", "Takvime 1 etkinlik · 30 dk önce hatırlatma"); `add_task` "GÖREV EKLE" ("Revize teklifi hazırla · Bugün 16:00'ya kadar", "Ahmet'in maili 17:00 son tarihini içeriyor.", "Plan'a 1 görev bloğu · 45 dk").
- **Data → entities:** `approvals{id, user_id, action_type: email_send|calendar_create|calendar_update|task_create|reminder_create|commitment_create, title(what), reason(why), change_summary, payload jsonb, source_type/source_id/source_provider, destination_account_id, side_effects(e.g. "Katılımcılara bildirim gider"), status: pending|approved|rejected|executing|executed|failed|expired, idempotency_key UNIQUE, created_at, decided_at, executed_at, error}`.
- **Interactions → real behavior:**
  - "Onayla" → server executes idempotently and shows executing → executed or failed with retry. Where the side effect notifies others (a2), a confirmation line is needed.
  - "Düzenle" → type-specific editor: email → draft editor; calendar → event editor sheet (time, title, calendar); task → task editor. No redirect to the Plan tab.
  - "Reddet" → rejected + `ai_feedback` ("Öğrendim").
  - Card tap → source ("Kaynağı Gör").
  - Also needed: filter pending/history, swipe actions, bulk approve (maybe), expiry countdown (e.g., the calendar move expires when the event starts).
- **States depicted:** pending, approved, rejected; the summary empty string.
- **States missing:** executing, executed, failed, expired (#33); a real empty state; loading; offline (approve queued vs blocked, #94); conflict (event changed since the proposal); rendering of source and destination account (#33 requires "source" and "destination/account"; the prototype shows neither).
- **Prototype-only / fake:** approve/reject only flip local status; the non-email "Düzenle" toast "Düzenleme Plan sekmesinde açılır"; a2's "Mehmet 16:00'yı önerdi" has no source; `id:'a'+Date.now()` duplicates are allowed.
- **Maps to MASTER_PROMPT:** #3, #33, #94, #97, #115, #116, #127

### Profil & Ayarlar / Profile & Settings
- **Source:** PRIMARY / Dijital Asistan.dc.html / `isProfile` (lines 540–563), data `SETTINGS`
- **Purpose:** Account hub reached from the avatar: approvals, subscription, settings.
- **Layout:**
  - Padding 60 20 40, gap 16. Back.
  - Identity row: avatar 60 `#1A1917` white 22/600; name 22/600/−.02em; meta 13 `#6B6860` with "PRO" pill (padding 2 8, r999, `#EDEDFC`/`#4547C9`, 11/600).
  - Featured dark row: `#1A1917`, r18, padding 14 16; `task_alt` 22 `#A9AAF5`; title 15/600; sub 12 `rgba(255,255,255,.65)`; chevron opacity .6.
  - Settings group: `#fff`, r18, padding 0 16, card shadow. Rows min-h 50, gap 12, border-top from row 2; icon 20 `#6B6860` in a 24px slot; title 500 15; value 13 `#9B978E`; `chevron_right` 18 `#C9C5BC`.
  - "Çıkış Yap": h48, transparent, `#C7432F` 600 15.
- **Exact copy:**
  - "{name} Emre" (i.e., "Yunus Emre"), "PRO", "Deneme · 5 gün kaldı", "Onay Merkezi", "{n} işlem onayını bekliyor".
  - Rows (icon · title · value): `workspace_premium` Abonelik · "Pro deneme"; `wb_twilight` Brifing · "08:00 · 13:00 · 19:00"; `notifications` Bildirimler · "Sadece önemli"; `tune` Öncelik Kuralları · "6 kural"; `star` Önemli Kişiler · "4 kişi"; `link` Bağlantılar · "Gmail · Takvim"; `psychology` AI Kişiselleştirme; `shield` Gizlilik ve Güvenlik; `contrast` Görünüm · "Açık"; `language` Dil · "Türkçe"; `help` Yardım; `rate_review` Geri Bildirim.
  - "Çıkış Yap".
- **Data → entities:** `profiles{first_name, last_name, avatar}`; `entitlements{pro, source: store|referral|admin, period_type: trial|normal, expires_at}` (RevenueCat); `user_settings{briefing_times{morning, midday, evening}, notification_level, appearance: system|light|dark, locale: tr|en}`; counts: `priority_rules`, `vip_contacts`, `connected_accounts`.
- **Interactions → real behavior:**
  - Onay Merkezi → push.
  - Abonelik → Manage Subscription screen: entitlement status, plan, renewal, "Satın Alımları Geri Yükle", store management deep link. The paywall appears only if not entitled.
  - Brifing → briefing schedule settings (02/2.9 pattern). Bildirimler → notification settings (#35).
  - Öncelik Kuralları → rules CRUD (07/7.9–7.12). Önemli Kişiler → VIP list (06/6.6), not a person page.
  - Bağlantılar → connected accounts (connect/reconnect/disconnect, #75).
  - AI Kişiselleştirme → 06/6.9. Gizlilik ve Güvenlik → Privacy Center (07/7.2–7.4). Görünüm/Dil → 07/7.8 (Sistem/Açık/Koyu; Türkçe/English).
  - Yardım → help center (web/in-app). Geri Bildirim → feedback form → backoffice (#62).
  - "Çıkış Yap" → confirm dialog → sign out: clear secure storage and local cache, unregister the push token.
  - Missing rows vs #130: Profil düzenle, Arkadaşını Davet Et (07/7.7), Hakkında/sürüm, Hesabı Sil (via privacy).
- **States depicted:** trial user with 2 pending.
- **States missing:** Free user (no PRO pill; upsell row), expired trial, billing issue/grace period, provider disconnected warning on "Bağlantılar", loading, 0 pending (featured row copy "Bekleyen işlem yok").
- **Prototype-only / fake:** hard-coded surname "Emre"; 10 of 12 rows toast "{row} · Bkz. 07 Hesap"; sign-out toast "Prototipte çıkış devre dışı"; "Önemli Kişiler" opens Mehmet's page.
- **Maps to MASTER_PROMPT:** #30, #31, #32, #35, #38, #39, #40, #43, #45, #62, #75, #88, #129, #130

### Kişi Zekâsı / Person Intelligence (Mehmet Yılmaz)
- **Source:** PRIMARY / Dijital Asistan.dc.html / `isPerson` (lines 565–600), data `PERSON`
- **Purpose:** Relationship context: what is open, who owes what, and recent contact.
- **Layout:**
  - Padding 60 20 110, gap 16.
  - Top: back + VIP pill (h30, `#EDEDFC`/`#4547C9`, `star` FILL 15).
  - Centered identity: avatar 76 `#DCE4F5`/`#2B3F73` "MY" 26/600; name 26/600; meta 14 `#6B6860`.
  - Two stat tiles (grid 1fr 1fr, gap 10; `#fff`, r16, p14, lighter shadow `0 1px 2px rgba(27,25,23,.04)`; label 12 `#9B978E`; value 16/600).
  - Four section cards.
  - Pinned bottom composer (padding 12 16 44, gradient) with placeholder "Mehmet hakkında sor…" and mic.
- **Exact copy:**
  - "VIP", "Mehmet Yılmaz", "Müşteri · Yılmaz Endüstri · Son iletişim dün 18:20".
  - Tiles: "Yaklaşan toplantı" / "Bugün 14:30"; "Açık konular" / "2 konu".
  - SON KONUŞULAN KONULAR: `sell` "Fiyat · %8 indirim sınırı" "1 Eyl"; `local_shipping` "Ekim başı teslim" "1 Eyl"; `description` "Sözleşme taslağı" "22 Ağu"
  - SENDEN BEKLEDİKLERİ: `person` "Revize teklif · PDF" "Bugün 17:00"
  - SENİN BEKLEDİKLERİN: `schedule_send` "Teklif v2 geri bildirimi" "3 gün"; "Sözleşme hukuk yorumu" "14 gün"
  - SON İLETİŞİM: `mail` "“Fiyatı Ekim teslimatına göre güncelleyebilir misiniz?”" "Dün 18:20 · Gmail"; `call` "Telefon görüşmesi · 12 dk" "1 Eyl 15:00"
- **Data → entities:** `people{id, display_name, emails[], org, role_label:'Müşteri', is_vip, last_contact_at}`; `person_topics`, `commitments` (owed_by user/them), `interactions{type: email|call|meeting, at, summary, source}`; `upcoming_events`.
- **Interactions → real behavior:**
  - VIP pill must be a toggle (add/remove VIP; deterministic priority, #30).
  - Stat tiles → next meeting prep / open loops list.
  - Rows (dead) → mail detail, commitment detail, event.
  - Composer → Assistant scoped to `person_id` (retrieval filtered). Mic → voice scoped to the person.
  - Also needed: contact actions (mail compose → approval) and "Kişiyi düzenle / birleştir" for identity resolution.
- **States depicted:** VIP person with rich history.
- **States missing:** loading; sparse data ("Henüz yeterli geçmiş yok"); non-VIP; merged/duplicate contacts; call data unavailable (no call-log integration on iOS; see issues); offline.
- **Prototype-only / fake:** "Telefon görüşmesi · 12 dk" implies a call-log source that does not exist for iOS; the VIP badge is not interactive; the mic opens the generic voice mode.
- **Maps to MASTER_PROMPT:** #18, #24, #26, #30, #91, #97, #131

### Pro (Paywall) / Pro paywall
- **Source:** PRIMARY / Dijital Asistan.dc.html / `isPaywall` (lines 602–627), data `PRO`
- **Purpose:** Upgrade or start a trial.
- **Layout:**
  - Background `linear-gradient(180deg,#EDEDFC 0%,#F5F4F0 30%)`, padding 60 20 40, gap 16.
  - Close button (36 circle white, `close`).
  - Kicker "DİJİTAL ASİSTAN PRO" `#5B5CE2` 12/600/.08em. Headline 30/36, 600, −.02em.
  - Feature card: `#fff`, r20, padding 6 16; rows padding 10 0, 15px, icon 20 `#5B5CE2`.
  - Plan radio cards: padding 14 16, r16, `#fff`, border 2px (`#5B5CE2` selected / `rgba(27,25,23,.1)`). Radio 20 circle with 2px border, inset 3px white, fill `#5B5CE2` when selected. Title 15/600; badge "EN AVANTAJLI" (`#E4F5EA`/`#1E7A47` 11/700); price 13 `#6B6860`.
  - Bottom: primary CTA h52 r16 brand shadow; text button h44 `#6B6860` 600 14; footnote 12 `#9B978E` centered.
- **Exact copy:**
  - "DİJİTAL ASİSTAN PRO", "Tüm dijital hayatın, tek brifingde."
  - Features: `all_inclusive` "Sınırsız analiz, birden fazla hesap"; `wb_twilight` "Öğle ve akşam brifingi"; `groups` "Toplantı hazırlığı"; `schedule_send` "Akıllı takip ve taahhütler"; `headphones` "Sesli brifing"; `memory` "AI hafıza ve VIP kişiler"; `calendar_month` "Gelişmiş planlama".
  - "Yıllık" + "EN AVANTAJLI" / "1.490 TL / yıl · ayda 124 TL"; "Aylık" / "199 TL / ay".
  - "Ücretsiz Dene · 7 gün", "Free ile devam et", "Deneme bitmeden 24 saat önce hatırlatırız. İstediğin zaman iptal."
- **Data → entities:** RevenueCat offerings (`da_pro_annual`, `da_pro_monthly`), localized `priceString`, intro-offer eligibility, entitlement `pro`; `paywall_impressions{source}`.
- **Interactions → real behavior:**
  - Plan radio → select package. CTA → `Purchases.purchasePackage` → pending/success/cancelled/failed → refresh entitlement → dismiss.
  - CTA label must depend on trial eligibility ("Ücretsiz Dene · 7 gün" vs "Pro'ya Geç").
  - "Free ile devam et" / × → dismiss.
  - Required: "Satın Alımları Geri Yükle", Kullanım Koşulları + Gizlilik Politikası links, and an auto-renew disclosure (App Store 3.1.2 / Play policy).
  - "24 saat önce hatırlatırız" requires a scheduled notification tied to the real trial end (from the RevenueCat webhook).
- **States depicted:** yearly vs monthly selected.
- **States missing:** loading offerings; offerings unavailable/error; purchase in progress; cancelled; failed; already Pro/trialing (this user is already in trial yet is offered a trial); restore success/none; ineligible for trial; region pricing.
- **Prototype-only / fake:** the "startTrial" pop and toast "7 günlük deneme başladı · 12 Eylül'de hatırlatırım" (no purchase); hard-coded TL prices; "Sınırsız analiz" conflicts with AI cost controls (#82). The list omits Pro items from #44 (Universal Capture, Android Notification Intelligence, multiple calendars).
- **Maps to MASTER_PROMPT:** #43, #44, #82, #112

### Hatırlatıcı Sayfası (bottom sheet) / Smart Reminder sheet
- **Source:** PRIMARY / Dijital Asistan.dc.html / `sheet` = `remind` (lines 639–655, `sheetDefs.remind`)
- **Purpose:** One-tap reminder presets, including an AI "good time".
- **Layout:**
  - Scrim `rgba(27,25,23,.35)` (fade .25 s, tap closes).
  - Sheet: `#fff`, r28 28 0 0, padding 10 20 44, shadow `0 -10px 40px rgba(27,25,23,.12)`, slide `translateY(100%→0)` .3 s `cubic-bezier(.2,.8,.2,1)`.
  - Grabber 36×5 r3 `#E0DED7`, margin-bottom 14. Title 19/600/−.01em. Sub 13 `#6B6860`.
  - Option rows min-h 52, border-top `rgba(27,25,23,.06)`, icon 20 (24 slot), label 500 15, meta 12. The AI row has icon `#5B5CE2` and meta `#4547C9` 600.
- **Exact copy:**
  - Title "Ne zaman hatırlatayım?"; sub = context ("Ahmet · Revize teklif" from mail detail, or the card title).
  - Options: `schedule` "30 dakika önce" · "16:30"; `schedule` "1 saat önce" · "16:00"; `wb_twilight` "Bu akşam" · "19:00"; `wb_sunny` "Yarın sabah" · "08:00"; `edit_calendar` "Özel zaman"; `auto_awesome` "Uygun zamanda" · "Takvimine göre: 12:10".
  - Toast "Hatırlatıcı kuruldu · {time|Özel zaman}".
- **Data → entities:** `reminders{id, source_type, source_id, remind_at, preset: before_30m|before_1h|tonight|tomorrow_morning|custom|smart, smart_rationale, status: scheduled|sent|cancelled, notification_id}`.
- **Interactions → real behavior:**
  - Presets computed from the item's due time and the user's settings ("Bu akşam" = evening briefing time; "Yarın sabah" = morning time). Hide "önce" presets when there is no due time or it is in the past.
  - "Özel zaman" → native date-time picker (the master names it "Kendin seç", #29).
  - "Uygun zamanda" → calendar free-slot computation with a rationale line.
  - Selecting → the user-initiated reminder is treated as confirmed (audit as approval `approved_in_place`), with server plus local notification scheduling (#96) and a toast with "Geri al".
- **States missing:** notification permission denied (inline "Bildirimlere izin ver"); past due; existing reminder (edit/cancel); smart slot unavailable; offline (schedule locally, sync later).
- **Prototype-only / fake:** times are always 17:00-relative (also for the 10 Eylül bill); no picker; no persistence.
- **Maps to MASTER_PROMPT:** #29, #33, #96, #115, #132

### Düzeltme Menüsü (bottom sheet) / Priority correction sheet ("···")
- **Source:** PRIMARY / Dijital Asistan.dc.html / `sheet` = `correct` (`sheetDefs.correct`)
- **Purpose:** Let the user correct AI importance; the system learns.
- **Layout:** same sheet anatomy; all icons `#6B6860`; no meta.
- **Exact copy:**
  - "Bunu nasıl değerlendireyim?" / "Seçimin gelecekteki öncelikleri etkiler".
  - Options → toast:
    - `remove_circle` "Önemli değil" → "Öğrendim · Bu tür konuları daha aşağıda göstereceğim."
    - `trending_up` "Bunu daha sık göster" → "Öğrendim · Bu konuyu daha yüksek öncelikle izleyeceğim."
    - `star` "Bu kişiyi VIP yap" → "Öğrendim · {kişi} artık VIP."
    - `visibility_off` "Bunu takip etme" → "Öğrendim · Bu konuyu artık takip etmeyeceğim."
  - All toasts use the `psychology` icon.
- **Data → entities:** `ai_feedback{insight_id, kind: not_important|show_more|make_vip|stop_tracking, created_at}` → `learned_preferences` (#32; editable/deletable); `vip_contacts` (#30); mute/stop-tracking rule for the thread or topic.
- **Interactions → real behavior:**
  - Write the feedback, then immediately re-rank or remove the card (not_important / stop_tracking hide it with undo).
  - Show the VIP option only when the insight has a resolvable person, and label it with the person's name.
  - Offer "Kural oluştur" as the escalation to explicit priority rules (#31).
  - "Öğrendim" toast with "Geri al".
- **States missing:** item without a person (hide VIP); already VIP ("VIP'den çıkar"); the "learn from interactions" toggle off (#32: feedback is still stored, with a note); error.
- **Prototype-only / fake:** the VIP name comes from `source.split(' · ')[1]`, giving "Müşteri toplantısı artık VIP." for p2 and "Yurtiçi artık VIP." for p5; no ranking effect.
- **Maps to MASTER_PROMPT:** #3 (9, 10), #30, #31, #32, #59

### Ses Modu (overlay) / Voice mode
- **Source:** PRIMARY / Dijital Asistan.dc.html / `voice` (lines 657–677), data `VOICE`
- **Purpose:** Hands-free questions.
- **Layout:**
  - Full-screen `linear-gradient(180deg,#15153A 0%,#25266A 70%,#3B3CA8 100%)`, z 30, padding 60 20 44.
  - Kicker "SES MODU" opacity .7; close button 36 `rgba(255,255,255,.14)`.
  - Center (gap 28): 120px pulse ring (`dapulse` 1.6 s, `rgba(255,255,255,.35)`) + 80 white circle with `mic` 36 `#25266A`; wave of 22 bars `rgba(255,255,255,.85)`, height 44.
  - Transcript 22/30, 600, max-w 300.
  - Answer bubble `rgba(255,255,255,.1)`, r18, padding 14 16, 15/22, max-w 320.
  - Prompt chips h36, padding 0 14, r999, `rgba(255,255,255,.12)`, 500 13.
- **Exact copy:**
  - "SES MODU", "Dinliyorum…"
  - Chips / answers:
    - "Bugün ne var?" → "Bugün 4 etkinliğin ve 3 önemli mailin var. En acili Ahmet'in 17:00'ye kadar beklediği revize teklif."
    - "Brifingimi oku." → "Sabah brifingin başlıyor: Öğlene kadar toplantın bulunmuyor. Saat 14:30'da Mehmet ile müşteri toplantın var…"
    - "Yarın yoğun muyum?" → "Evet, yarın yoğun. 09:00 ve 10:00 toplantıların arka arkaya; 14:00–16:30 arası boş."
    - "Mehmet'ten cevap geldi mi?" → "Henüz gelmedi. Teklifi 3 gün önce gönderdin. İstersen bir takip mesajı hazırlayıp onayına sunabilirim."
  - The transcript shows as “{prompt}”.
- **Data → entities:** `voice_sessions` (ephemeral); transcript → assistant query; TTS output.
- **Interactions → real behavior:**
  - Opening → request microphone (plus iOS speech-recognition) permission, then start STT (on-device where available, e.g. `expo-speech-recognition`) with live partial transcript.
  - End of speech → grounded assistant → answer text plus TTS playback.
  - A write intent ("takip mesajı hazırla") → produce a draft and an approval card with Onayla/Düzenle (06/6.4). Never execute by voice alone (#25).
  - Chips = suggested utterances (tap to ask). "Brifingimi oku." → hand off to the audio player.
  - × → stop STT/TTS and dismiss.
- **States depicted:** listening; answer.
- **States missing:** permission denied (explain + open Settings); STT unavailable/offline; no speech detected; misrecognition with editable transcript; thinking/processing; TTS speaking with stop; approval card; error; Pro gate if voice is Pro.
- **Prototype-only / fake:** no mic; canned answers after 900 ms; decorative waveform.
- **Maps to MASTER_PROMPT:** #24, #25, #33, #83, #91, #115

### Toast (global) / Toast
- **Source:** PRIMARY / Dijital Asistan.dc.html / `toast` (lines 679–683), `toast()` method
- **Purpose:** Transient confirmation.
- **Layout:**
  - Absolute left/right 16, bottom 104 (above the tab bar), z 40, centered.
  - Pill `#1A1917`, r999, padding 12 18 12 14, 500 14 white, leading icon 18 `#A9AAF5`, shadow `0 10px 30px rgba(27,25,23,.25)`.
  - Enter: `translateY(16px)` → 0 with opacity 0→1, .3 s `cubic-bezier(.2,.8,.2,1)`. Visible 2600 ms. Exit, then unmount after 320 ms.
- **Exact copy:** every string is listed in "Prototype mechanics to NOT copy".
- **Interactions → real behavior:**
  - A toast is shown only after a real state change (or with a pending wording).
  - Support an optional action ("Geri al", "Görüntüle") and `accessibilityLiveRegion` / `AccessibilityInfo.announceForAccessibility`.
  - Position above the tab bar or safe area.
- **States missing:** error toast variant (coral icon), action variant, queueing.
- **Prototype-only:** used as a stand-in for ~15 missing screens.
- **Maps to MASTER_PROMPT:** #92, #99, #100, #123

### Alt Sekme Çubuğu / Bottom tab bar (component, all tab roots)
- **Source:** PRIMARY / Dijital Asistan.dc.html / `showNav` (lines 629–637), `TABS`
- **Layout:**
  - Absolute bottom, height 90, padding 8 8 28, bg `rgba(255,255,255,.9)` with `backdrop-filter: blur(20px)`, border-top 1px `rgba(27,25,23,.06)`, z 5.
  - Four equal buttons; icon 26; label 500 11; gap 3.
  - Active: `#5B5CE2`, `'FILL' 1,'wght' 500`. Inactive: `#9B978E`, `'FILL' 0,'wght' 400`. Colour transition .15 s.
- **Exact copy:** "Bugün" (`sunny`), "Akış" (`dynamic_feed`), "Plan" (`calendar_today`), "Asistan" (`auto_awesome`).
- **Interactions → real behavior:**
  - Tab switch keeps each tab's stack. Re-tapping the active tab pops to root and scrolls to top.
  - Hidden on detail screens.
  - Optional badges (e.g., Akış unread important).
  - iOS: `BlurView` (expo-blur). Android: solid or translucent fallback.
  - Accessibility: role "tab", selected state.
- **States missing:** dark variant (01 dark tokens), badge variant, keyboard-open behavior on Asistan (hide the tab bar or lift the composer).
- **Prototype-only:** tab tap wipes the stack.
- **Maps to MASTER_PROMPT:** #8, #38, #92

## Prototype mechanics to NOT copy

**Simulated timing and state**

| Mechanic | Where | Production replacement |
|---|---|---|
| `setTimeout(…,900)` then "Gönderildi" | `approveSend` | Server-side approval execution with status polling or Realtime, idempotency key |
| `setTimeout(…,1000)` canned `QA` answers plus typing dots | `ask()` | Streaming grounded LLM with citations; refusal when there is no source |
| `setTimeout(…,900)` canned `VOICE` answers | `voicePrompts` | Real STT → assistant → TTS; approvals for writes |
| `setInterval` 1 s playhead, `pos` 0–134, hard-coded chapter starts | `togglePlay` | Real audio player (track-player / expo-audio), chapters from TTS segments |
| Decorative waveforms (`dabar` with index math), `dapulse` mic ring | audio, voice | Keep as decorative motion only, or drive from audio metering; must respect Reduce Motion |
| All data (`PRIOS`, `FEED`, `BRIEF`, `PREP`, `PERSON`, `DAY`, `WEEK`, `QA`, `VOICE`, `SETTINGS`, `PRO`, approvals seed) hard-coded | data script | Supabase queries; demo fixtures only behind an explicit demo flag (#89, #100) |
| Everything in React component state; lost on reload | whole prototype | Persisted server state plus offline cache (#94) |
| `startScreen` / `userName` editor props | `data-props` | None (design-tool only) |
| Hard-coded dates ("5 EYLÜL CUMARTESİ", "07:58", "18 dk", "0:42") | many | Locale/timezone-aware formatting (`tr-TR`, Europe/Istanbul, 24 h) |
| `s.tone.toUpperCase()` → "SAMIMI" (should be "SAMİMİ") | reply kicker | `toLocaleUpperCase('tr-TR')` everywhere kickers are generated |
| Tab tap resets the stack; "Bugün'e Dön" clears the stack without switching tab | nav | Per-tab stacks; explicit navigate to the Today root |
| Approval generation without dedupe (`id:'a'+Date.now()`) | `addApproval` | Unique idempotency key per source + action + payload |
| "Planla" → "Planlandı" instantly | Plan | Approval → `calendar_create` → refresh |
| Remind presets hard-wired to 17:00 (16:30/16:00) and "12:10" | remind sheet | Computed from item due time and calendar |
| VIP name via `source.split(' · ')[1]` | correct sheet | `person_id` on the insight |
| p3 `go:'mail'` opens Ahmet's mail; p4/p5 title taps dead | Today | Entity-typed routing |
| Composer inputs with no submit (Asistan, Kişi) | Asistan, Person | Real send |
| "Düzenlenebilir" draft that is not editable | Reply | TextInput editor |

**Toast-only stand-ins — each must become a real screen, action or handoff (#99 No Dead Action)**

| Toast text (icon) | Trigger | Real behavior |
|---|---|---|
| "Ekran görüntüsü, PDF veya link ekle · Bkz. 04 Akış" (`add_a_photo`) | Akış "Ekle" | Universal Capture sheet + flows (04/4.10–4.14) |
| "Hafıza araması · Bkz. 06 Asistan" (`search`) | Asistan "Hafıza" | Memory search screen (06/6.5) |
| "Çözüm seçenekleri · Bkz. 05 Plan" (`event_repeat`) | "Seçenekleri Gör" | Conflict sheet (05/5.3) → `calendar_update` approval |
| "Tamam, başka bir boşluk önereceğim" (`schedule`) | "Başka zaman" | Dismiss suggestion + feedback + next suggestion |
| "Özet okunuyor · 2 dk" (`headphones`) | Prep "2 Dakikalık Özeti Oku" | 2-min summary reading view (05/5.6), optional TTS |
| "Taslak düzenleme modunda" (`edit`) | Reply "Düzenle" | Focus the editable draft |
| "Düzenleme Plan sekmesinde açılır" (`edit`) | Approval "Düzenle" (non-email) | Type-specific editor sheet |
| "Prototipte çıkış devre dışı" (`logout`) | "Çıkış Yap" | Confirm + sign out |
| "{Row} · Bkz. 07 Hesap" (`settings`) | 10 settings rows | Push the respective settings screens |
| "Kargo takibi açıldı · Teslimatta haber veririm" (`package_2`) | p5 "Takip Et" | External tracking-URL handoff; delivery-day notification only if derivable from new mails |
| "{action} · Kaynak açıldı" (`open_in_new`) | Akış Kontrol Et / Takip Et / Check-in / İncele / Teyit Et | Real source open or external handoff |
| "Yarın 09:00'da hatırlatırım" (`notifications`) | p4 "Yarın Hatırlat" | `reminder_create` + scheduling |
| "Hatırlatıcı kuruldu · {m}" (`notifications`) | remind sheet | Persisted reminder |
| "Öğrendim · …" ×4 (`psychology`) | correct sheet | Feedback write + re-rank |
| "Onaylandı · {what}" (`check`) / "Reddedildi · Öğrendim" (`psychology`) | approvals | Show after real execution / after persisting the rejection |
| "Onay Merkezi'ne eklendi" (`task_alt`) | Takvime Ekle / Görev Oluştur | Keep, after the approval row is persisted; add "Görüntüle" |
| "Tamamlandı · Bir sonraki konu yukarı taşındı" (`check`) | ✓ | Keep, after persisting; add "Geri al" |
| "Mail gönderildi · {ad}" (`send`) | finishSend | Only after provider success |
| "Taahhüt kaydedildi · Yarın hatırlatırım" (`handshake`) | Post-meeting "Kaydet" | After commitment + reminder persisted |
| "Planlandı · Yarın 14:00–16:30 Teklif hazırlama" (`event_available`) | "Planla" | After an approved calendar write |
| "7 günlük deneme başladı · 12 Eylül'de hatırlatırım" (`workspace_premium`) | Paywall CTA | After a RevenueCat purchase success; reminder date = trial end minus 24 h |

**Fake or unsupported data claims** (per #20, #23, #83; hub rule: life signals come from mail content only)
- "38 dk trafik tahmini", "12:50'de çıkman gerekebilir", "06:45'te evden çıkman gerekebilir": need routing plus home location.
- "Son 30 günde 2 kez izlendi" (Netflix): not in email.
- "Telefon görüşmesi · 12 dk": needs a call-log source; not available on iOS.
- "Görüşme notları": needs a notes source.
- "üretim takvimi 6 Ekim'i gösteriyor": needs a document source.
- "Mehmet 16:00'yı önerdi": no source shown.
- "Takvim davetinden çıkarıldı" is fine if the invite has a description.
- Every such field must be rendered only when a `source_ref` exists.

## Cross-file index

What the hub nav says each page contains (verbatim), with the artboard labels actually found in the file (verified by reading the labels only).

| File | Hub description (verbatim) | Artboards actually present |
|---|---|---|
| 01 Tasarim Sistemi.dc.html | "renk, tipografi, spacing, bileşenler ve tüm durumlar" | Sections (no numbered artboards): RENK · TOKENLAR; DARK MODE TOKENLARI; TİPOGRAFİ · GEIST + LORA; BOŞLUK · 4'LÜK IZGARA; KÖŞE YARIÇAPI · GÖLGE; İKONLAR · MATERIAL SYMBOLS ROUNDED · 20/24 · wght 400 · FILL 0 (aktif: FILL 1); BUTONLAR · 5 VARYANT × DURUMLAR; ÇİPLER · ROZETLER; KARTLAR · 6 KALIP; GİRİŞLER · ARAMA · SOHBET; SEGMENTLİ KONTROL · ANAHTAR · ONAY; NAVİGASYON · BAŞLIK KALIPLARI; ALT SAYFA · MODAL; TOAST · SES · İSKELET |
| 02 Onboarding.dc.html | "giriş, hesap, bağlantılar, izin açıklayıcı, kişiselleştirme, ilk analiz, bildirimler, Android" | 2.1 Tanıtım 1 · Marka; 2.2 Gürültüyü azalt; 2.3 Brifing; 2.4 Kontrol sende; 2.5 Hesap Oluştur; 2.6 Dijital hayatını bağla; 2.7 İzin Açıklayıcı · Gmail (OAuth öncesi); 2.7b · Outlook / Microsoft 365; 2.7c · Takvim; 2.8 Kişiselleştirme · Çoklu seçim; 2.9 Brifing Ayarları; 2.10 İlk Analiz · İşleniyor; 2.11 İlk Analiz · Hazır; 2.12 Bildirim İzni Açıklayıcı; 2.13 Android · Telefon Bildirimleri (isteğe bağlı). No explicit VIP step (#34 step 11). |
| 03 Bugun ve Brifingler.dc.html | "Bugün (light/dark), sabah, sesli, öğle, akşam, haftalık özet, paylaşım kartı" | 3.1 Bugün · Light · Sabah; 3.2 Bugün · Dark; 3.3 Sabah Brifingi · Tam ekran; 3.3D Sabah Brifingi · Dark; 3.4 Sesli Brifing; 3.5 Öğle Nabzı · 13:00; 3.6 Akşam Kapanışı · 19:00; 3.7 Haftalık Özet · Editoryal; 3.8 “Dijital Haftam” paylaşım kartı · 1080×1350. Page intro sets cadence 08:00 / 13:00 / 19:00 / Pazar 18:00 and the shared hero pattern "Bugün bilmen gereken N şey var." |
| 04 Akis ve Mail.dc.html | "akış, mail zekâsı, mail detayı, AI yanıt, takip, senden beklenenler, taahhütler, yaşam kartları, yakalama, hatırlatıcı" | 4.1 Akış · Tümü; 4.2 Akış · Kişisel filtresi · Dark; 4.3 Mail Zekâsı; 4.4 Mail Detayı; 4.5 AI Yanıt Taslağı; 4.6 Akıllı Takip; 4.7 Senden Beklenenler · Acil / Bugün / Yakında; 4.8 Taahhütler; 4.9 Yaşam Zekâsı · 6 kart kalıbı; 4.10 Evrensel Yakalama · Ekran görüntüsü; 4.11 Fatura fotoğrafı + Akıllı hatırlatıcı; 4.12a–d PDF (seçim/analiz/tespit/onay); 4.13a–d Link; 4.14a–d Metin (… onay + başarı) |
| 05 Plan ve Toplantilar.dc.html | "gün/hafta, takvim zekâsı, çakışma, toplantı hazırlığı (light/dark), toplantı sonrası" | 5.1 Plan · Gün; 5.1D Plan · Gün · Dark; 5.2 Plan · Hafta + Takvim Zekâsı; 5.3 Takvim Çakışması · Çözüm sayfası açık; 5.4 Toplantıya Hazırlan · Light; 5.5 · Dark; 5.6 2 Dakikalık Özet · Okuma görünümü; 5.7 Toplantı Sonrası Yakalama · Ses girişi |
| 06 Asistan Hafiza Kisiler.dc.html | "asistan, sohbet, ses modu, hafıza araması, VIP kişiler, kişi zekâsı, onay merkezi, AI kişiselleştirme" | 6.1 Asistan · Giriş (boş sohbet yok); 6.1D Dark; 6.2 Zengin kartlı yanıt; 6.3 Ses Modu · Dinliyor; 6.4 Ses Modu · Yanıt + yazma onayı; 6.5 AI Hafıza · Anlamsal arama; 6.6 Önemli Kişiler · VIP; 6.7 Kişi Zekâsı · Mehmet Yılmaz; 6.8 Onay Merkezi; 6.9 AI Kişiselleştirme · “Seni nasıl tanıyor?” |
| 07 Hesap Gizlilik Pro.dc.html | "profil, ayarlar, brifing ayarları, gizlilik merkezi, paywall, davet" | 7.1 Profil ve Ayarlar; 7.2 Gizlilik Merkezi; 7.3 AI'ın Eriştiği Veriler; 7.4 Veri Saklama ve Silme · Onay sayfası; 7.5 Paywall · PRO; 7.6 Bağlamsal Pro kapısı · Free kullanıcı; 7.7 Arkadaşını Davet Et; 7.8 Görünüm ve Dil; 7.9 Öncelik Kuralları · Liste; 7.10 Yeni Kural; 7.11 Kuralı Düzenle; 7.12 Kuralı Sil · Onay + geri al. No "brifing ayarları" artboard (it is 02/2.9); priority rules are unmentioned in the hub. |
| 08 Durumlar Widgetlar Etkilesimler.dc.html | "boş / hata / yükleme, iOS + Android widget'ları, kilit ekranı, mikro-etkileşim notları" | BOŞ DURUMLAR · POZİTİF, SAKİN; HATA DURUMLARI · OKUNUR, TEK AKSİYON (incl. "error/offline · tam ekran · son analiz görünür kalır", "Çevrimdışısın. Son analiz 09:40'tan gösteriliyor."); "loading/today · iskelet, gerçek kart ölçülerinde" (1.6 s shimmer, cards fill at 60 ms intervals); WIDGET'LAR · iOS (incl. "lock screen · circular · rectangular · inline"); WIDGET'LAR · ANDROID; KAYDIRMA AKSİYONLARI; BRİFİNG AÇILIŞI · KARE KARE; MİKRO-ETKİLEŞİMLER · HAREKET VE HAPTİK SÖZLEŞMESİ |
| 09 Pazarlama.dc.html | "6 mağaza ekranı, 3 adet 9:16 reklam" | MAĞAZA · 6 EKRAN · 1290×2796; REKLAM · 3 KONSEPT · 9:16 · 1080×1920 |

## Design tokens observed in this file (inputs to the shared UI kit, #122)

**Colour — light**

| Role | Value |
|---|---|
| App background | `#F5F4F0` |
| Doc canvas | `#ECEAE4` |
| Surface | `#FFFFFF` |
| Surface-2 / icon tile / neutral chip | `#F0EFEB` |
| Segmented track | `#E9E7E1` |
| Grabber | `#E0DED7` |
| Text primary | `#1A1917` |
| Text secondary | `#6B6860` |
| Text tertiary | `#9B978E` |
| Text quaternary / idle icon | `#B8B4AA` |
| Chevron | `#C9C5BC` |
| Dividers | `rgba(27,25,23,.06)` (rows), `.07` (timeline/doc), `.10` (radio border), `.15` (dashed gap) |

**Colour — brand**

| Role | Value |
|---|---|
| Primary | `#5B5CE2` |
| Primary text/strong | `#4547C9` |
| Soft | `#EDEDFC` |
| Tint | `#E4E4FA` |
| On-dark | `#A9AAF5` |
| Light | `#7071EA` |
| Deep | `#3B3CA8`, `#25266A`, `#15153A`, `#1E1E4C` |
| AI-block background | `#F7F7FE` |
| Chart | `#D9D6F7` |

**Semantic tone pairs (bg / fg)**

| Tone | bg | fg |
|---|---|---|
| critical | `#FCEDE9` | `#C7432F` |
| warning | `#FDF2DC` | `#9A6300` |
| neutral | `#F0EFEB` | `#6B6860` |
| info | `#E7F0FD` | `#2262BE` |
| success | `#E4F5EA` | `#1E7A47` (hover `#2FA062`) |
| primary | `#EDEDFC` | `#4547C9` |

- Also: life block `#FDF6EC`; heat bars `#F3B7AE` / `#E0553F`.
- Avatar pairs: `#DCE4F5` / `#2B3F73`; `#F5E1D6` / `#7A3E1F`; self `#1A1917` / `#fff`.

**Gradients**
- Hero: `radial-gradient(140% 100% at 100% 0%,#E4E4FA 0%,#FFFFFF 58%)`.
- AI card: `radial-gradient(140% 100% at 0% 0%,#E4E4FA 0%,#FFFFFF 60%)`.
- Briefing hero: `linear-gradient(160deg,#1E1E4C 0%,#3B3CA8 58%,#7071EA 100%)`.
- Audio: `linear-gradient(180deg,#15153A 0%,#25266A 60%,#3B3CA8 100%)`; voice the same with 70% as the mid stop.
- Paywall: `linear-gradient(180deg,#EDEDFC 0%,#F5F4F0 30%)`.
- Bottom fades: `linear-gradient(180deg,rgba(245,244,240,0) 0%,#F5F4F0 45%)` (also 30% and 40% variants).

**Typography.** Geist 300–700; Lora 400–600 (normal and italic); Material Symbols Rounded (opsz 20–48, wght 300–600, FILL 0–1).

| Role | Size / line height | Weight | Tracking |
|---|---|---|---|
| Display (doc H1) | 40/46 | 600 | −.025em |
| Briefing title | 32/38 | 600 | −.02em |
| Paywall headline | 30/36 | 600 | −.02em |
| H1 | 28/34 | 600 | −.02em |
| Hero | 26/32 | 600 | −.02em |
| Subject | 22/28 | 600 | −.02em |
| Card title | 17/23 | 600 | −.01em |
| Feed title | 16/22 | 600 | −.01em |
| Body / button | 15 (21/23) | 400–600 | — |
| Secondary | 14/20 | — | — |
| Meta | 13 | — | — |
| Kicker | 12 uppercase | 600 | .08em (.06em for AI/status kickers) |
| Badge | 11 | 700 | .05em |
| Tab label | 11 | 500 | — |
| Narrative (Lora) | 18/29 | — | — |

**Radii.** 28 (hero, sheet top, briefing body); 24 (dark talking-points card); 20 (cards); 18 (list-section cards, featured row, bubbles, voice answer); 16 (h52/h56 buttons, small cards, suggestions, plan cards, stat tiles, week insight); 14 (h48 buttons, day chips, timeline blocks, IA tiles); 12 (h40/h42 buttons); 11 (logo); 10 (text buttons, 30px icon tile); 9 (28px icon tile); 5 (chart bars); 999 (pills/chips/segments/composer).

**Shadows**

| Name | Value |
|---|---|
| card | `0 1px 2px rgba(27,25,23,.04),0 6px 20px rgba(27,25,23,.05)` |
| hero | `0 1px 2px rgba(27,25,23,.04),0 12px 32px rgba(91,92,226,.10)` |
| pill | `0 1px 2px rgba(27,25,23,.06)` |
| back button | `0 1px 2px rgba(27,25,23,.08)` |
| stat tile | `0 1px 2px rgba(27,25,23,.04)` |
| primary CTA | `0 8px 24px rgba(91,92,226,.28)` |
| dark CTA | `0 8px 24px rgba(27,25,23,.18)` |
| dark card | `0 12px 32px rgba(27,25,23,.18)` |
| composer | `0 1px 2px rgba(27,25,23,.06),0 8px 24px rgba(27,25,23,.08)` |
| toast | `0 10px 30px rgba(27,25,23,.25)` |
| sheet | `0 -10px 40px rgba(27,25,23,.12)` |
| play button | `0 10px 30px rgba(0,0,0,.25)` |
| segment active | `0 1px 3px rgba(27,25,23,.12)` |

**Spacing.**
- Horizontal gutter 20; composer dock 16; toast 16.
- Tab-root top padding 70; pushed-screen top 60.
- Tab-root bottom padding 112; sticky-CTA screens 130; Person 110.
- Stack gaps 18 / 16 / 14 / 12 / 10 / 8.
- Sticky CTA container padding 16 20 44.

**Motion.**
- `cubic-bezier(.2,.8,.2,1)` .3 s for sheet and toast.
- Scrim .25 s.
- Card exit .3 s (opacity 0, `scale(.96) translateY(-6px)`).
- Press scale .97 / .95.
- Success scale .4→1 in .5 s.
- Spinner `daspin` .8 s linear.
- Pulse `dapulse` 1.6 s.
- Bars `dabar` .7–1.18 s alternate.
- Production: map to Reanimated and honour Reduce Motion.

**Sizes.**
- Controls: back/icon buttons 36; avatar 40/44/56/60/76 (22 in chip); icon tiles 28/30.
- Buttons h30 (segment), h32 (tone/speed), h34 (chips/pill), h36 (text actions/pill), h40, h42, h48, h52, h56.
- Tab bar 90; phone frame 402×874.

## Reusable components observed

- **ScreenHeader (tab root)**: optional kicker (date) + H1 28/34 + a trailing slot (HeaderPill[], Avatar). Props: `kicker?`, `title`, `trailing`. Variants: Today (kicker + two trailing items); Akış, Plan, Asistan (title + one pill or a segmented control).
- **DetailTopBar**: BackButton (36 circle, white with `.08` shadow; or translucent `rgba(255,255,255,.14/.16)` on dark) + centered kicker + trailing (badge, countdown pill, VIP pill, speed pill, or 36px spacer). Close variant (`close`) for modals; collapse variant (`expand_more`) for the audio modal.
- **HeaderPill**: h34–36, r999, white, 600 12, 18px icon, tint `#4547C9` (brand) or `#6B6860` (neutral), `.06` shadow. Examples: "{N} onay", "Ekle", "Hafıza".
- **Avatar**: initials; sizes 22/40/44/56/60/76; colour pair derived from the person; self avatar `#1A1917`. Needs an image variant and an accessibility label.
- **BriefingHeroCard**: kicker (AI icon + "BRİFİNG HAZIR · hh:mm") + headline with accent count + stat line + [PrimaryButton flex, SoftButton with icon]. Props: `status`, `generatedAt`, `count`, `stats`, `onOpen`, `onListen`, `audioDuration`.
- **ToneBadge**: 11/700/.05em, padding 3 8 (4 9 in detail), r999, six tones. Props: `tone`, `label`.
- **PriorityCard / InsightCard**: ToneBadge + time + [CompleteButton, MoreButton] + title (tappable) + sub? + SourceRow + TextActions (primary brand, secondary neutral). Props: `insight`, `onComplete`, `onMore`, `onOpen`, `actions[≤2]`, `removing`. Animated exit.
- **FeedCard**: IconTile28 + source (ellipsis) + ToneBadge + time; title 16/22; summary; one TextAction. Needs `onPress` for the whole card plus swipe actions.
- **SourceRow**: 16px icon + "Provider · Person · time" 12 `#9B978E`. Variant "Kaynak: …" with `verified`. Must be tappable (opens the source).
- **SectionLabel**: 12/600/.08em `#9B978E` uppercase (Turkish-aware), optional trailing count.
- **ListSectionCard (+ ListRow)**: white r18 padding 4 16; rows = IconTile30 (r10 `#F0EFEB`) + title (500 15/20 or 400 15/21) + meta 12; hairline between rows. Used by briefing, prep and person. Rows must accept `onPress` and a chevron.
- **AICard**: radial-gradient surface (left or right origin), AI kicker (`auto_awesome` FILL + label `#5B5CE2` 12/600/.06em), title, body, actions or chips. Variants: calendar intelligence, AI summary with bullet list, new commitment.
- **DarkTalkingPointsCard**: `#1A1917` r24 p20; kicker `#A9AAF5`; numbered items (26px circle `rgba(255,255,255,.12)`).
- **Buttons**:
  - Primary `#5B5CE2`/white: h48 r14, h52 r16, h40 r12, h42 r12; optional brand shadow; pressed scale .97; loading (spinner + label).
  - SoftBrand `#EDEDFC`/`#4547C9`.
  - Secondary white `#1A1917` with `.06`–`.08` shadow.
  - Dark `#1A1917`/white.
  - NeutralSoft `#F0EFEB`/`#6B6860`.
  - TextButton h36 r10 (brand `#4547C9` / neutral `#6B6860`, hover tint).
  - DestructiveText `#C7432F`.
  - IconButton 36 circle.
  - ActionTile h56 r16 (icon + label, primary or secondary).
- **SegmentedControl**: track `#E9E7E1` r999 p3; segment h30 (compact, auto width) or h32 (full-width, flex 1); active white with shadow. Props: `options`, `value`, `onChange`.
- **FilterChipRow**: h34 r999 600 13; active `#1A1917`/white, inactive white/`#6B6860`; horizontal scroll with 20px side padding.
- **DayStrip / DayChip**: 42×60 r14; weekday, date and event dot; selected dark.
- **TimelineRow (EventBlock)**: time column 44 + hairline + block r14 padding 10 14; variants event / gap / ai (dashed or solid when accepted) / life.
- **WeekDensityChart**: 7 stacked two-series bars, 120px, labels coloured for hot and today. Needs a legend and a11y.
- **InsightRowCard**: white r16 padding 14 16; coloured leading icon 20 (warning/info/critical); title 15/600; body 13/19; optional TextButton.
- **SuggestionButton**: h52 r16 white 500 15 + `arrow_outward`.
- **ChatBubble**: user (brand bg, right) / assistant (white, left, card shadow); r18; max 86%.
- **RichAnswerCard**: white r16; title kicker; rows (brand icon 18, text 14, meta 12); rows tappable.
- **TypingIndicator**: three dots.
- **Composer**: pill h52 r999 white + input 15 + 40px brand MicButton; send button state needed.
- **ContextNote**: white r16 padding 12 14 + 34px AI avatar + 14/20 text with bold figures.
- **TrustNote**: `verified_user` 18 `#1E7A47` + 13 `#6B6860` text. Examples: "Sen onaylamadan hiçbir mail gönderilmez.", "Önemli işlemler sen onaylamadan gerçekleştirilmez."
- **RecipientChip**: h30 r999 white + 22px avatar + 600 name.
- **Accordion (DisclosureCard)**: header h52 icon + label + `expand_more/less`; body 14/21.
- **ApprovalCard**: IconTile28 (brand soft) + type kicker + StatusPill + what (17/600) + KeyValueGrid (64px labels "Neden"/"Değişim"; add "Kaynak", "Hesap") + ButtonRow (Onayla / Düzenle / Reddet). Status variants pending / approved / rejected (opacity .45); add executing / executed / failed / expired.
- **StatusPill**: BEKLİYOR (warning), ONAYLANDI (success), REDDEDİLDİ (neutral).
- **FeaturedRow (dark)**: `#1A1917` r18 padding 14 16, accent icon `#A9AAF5`, two-line text, chevron.
- **SettingsGroup / SettingsRow**: white r18 padding 0 16; row min-h 50, icon 20 in a 24 slot, title 500 15, value 13 `#9B978E`, chevron 18 `#C9C5BC`. Needs toggle and destructive variants.
- **StatTile**: white r16 p14, label 12, value 16/600.
- **MetaChip**: h30 r999 `#F0EFEB`/`#6B6860` 12/600 + 15px icon (editable variant needed).
- **CountdownPill / VIPPill / PROBadge**: h30 r999 tone pairs (warning, primary).
- **PlanOptionRadio**: padding 14 16 r16 2px border; selected `#5B5CE2`; radio 20 with inset ring; title + optional savings badge + price line.
- **FeatureList**: white r20 rows with brand icon 20, 15px text.
- **BottomSheet**: scrim `.35`; white r28 top; grabber 36×5; title 19/600; sub 13; OptionRow (min-h 52, icon 20, label 500 15, meta 12; AI-highlight variant brand colours).
- **Toast**: dark pill, accent icon `#A9AAF5`, bottom 104; add action and error variants.
- **TabBar**: described above.
- **AudioPlayer set**: SpeedPill, Waveform (34 bars), ProgressBar (4px), TransportControls (52/76/52), ChapterList (number, title, duration; active opacity).
- **VoiceOverlay set**: PulseMic (120 ring + 80 core), VoiceWave (22 bars), TranscriptText (22/30), AnswerBubble (translucent), PromptChips (translucent h36).
- **SuccessState**: 96px animated circle + check 48 + title 26 + body 15/22 + dark CTA.
- **EmptyState (positive)**: 56px success circle + `done_all` + title 18 + body 14/20.

## Open issues / inconsistencies

**Within the file**

1. **The date is inconsistent.** It is not one coherent calendar date across screens.
   - Header "5 EYLÜL CUMARTESİ" matches 2026 (5 Sep 2026 is a Saturday).
   - The Plan strip marks "Cum 5" as today with Pzt = 1, which matches 2025.
   - The week chart "7–13 EYLÜL" marks "Cmt" as today (that would be 12 Sep).
   - A "Haftalık ekip" meeting on a Saturday is implausible.
2. **Today's schedule contradicts itself.**
   - Briefing: "Öğlene kadar toplantın bulunmuyor" and "Bugün oldukça sakin bir günün var."
   - Plan Day: 09:00 Haftalık ekip and 11:00 Ürün gözden geçirme.
   - Hero: 5 items including ACİL and SON TARİH (not calm).
   - "4 etkinlik" in the hero, Asistan and voice versus the 5 events in Plan plus a deadline and a dinner.
   - "Ürün gözden geçirme" appears at both 11:00 and 16:00.
3. **Tomorrow is impossible.**
   - Flight TK2412 "Yarın 09:15" İstanbul→Antalya with "06:45'te evden çıkman gerekebilir".
   - Meanwhile tomorrow shows 09:00 Haftalık ekip, 10:00 Ürün gözden geçirme, 13:30 doktor in Nişantaşı, 17:00 Yatırımcı görüşmesi, and a 14:00–16:30 free slot proposal.
   - Calendar intelligence should flag this conflict; demo fixtures must be made coherent.
4. **Mehmet's reply status contradicts itself.**
   - Follow-up: "3 gündür cevap gelmedi" / "Henüz yanıt yok"; voice: "Mehmet'ten cevap geldi mi?" → "Henüz gelmedi."
   - Prep and Person: Mehmet emailed "Dün 18:20" ("Fiyatı Ekim teslimatına göre güncelleyebilir misiniz?"), and "Son iletişim dün 18:20".
   - QA "KAYNAKLAR": "Re: Teklif · Gmail 1 Eyl 18:20" (a different date).
5. **Ownership of the "revize teklif" is blurred.**
   - Today and briefing say Ahmet Yılmaz expects it by 17:00.
   - Mehmet's page ("SENDEN BEKLEDİKLERİ: Revize teklif · PDF · Bugün 17:00") and Prep talking point 1 attribute it to Mehmet.
   - Both share the surname Yılmaz (company "Yılmaz Endüstri"?). The entity model must resolve thread/person/company links explicitly; fixtures should use distinct surnames.
6. **Approval a2's premise is false.** "Mehmet toplantısını 16:00'ya al — takvimin uygun", but 16:00 holds "Ürün gözden geçirme". The proposal also has no source.
7. **"Planla" violates the file's own rule.** The hub says calendar creation goes through Onay Merkezi, yet Planla completes instantly, and it restyles the unrelated 17:00 deadline row instead of adding tomorrow's block.
8. **Reminders bypass approval.** The hub says "hatırlatıcı ve görev ekleme Onay Merkezi'nden geçer", yet the reminder sheet and "Yarın Hatırlat" set reminders directly, while "Görev Oluştur" does create an approval.
   - Decision needed: user-picked explicit actions count as approval-in-place (recorded) versus queued approvals for AI proposals.
9. **Naming drift.**
   - "Onay Merkezi" (profile row, label, hub) vs "Onay Bekleyenler" (H1).
   - Greeting "Günaydın, Yunus" (Today) vs "Günaydın Yunus" (Briefing).
   - Correction labels in the hub ("Daha sık göster · VIP yap · Takip etme") vs the sheet ("Bunu daha sık göster", "Bu kişiyi VIP yap", "Bunu takip etme").
   - Briefing sections "SENDEN CEVAP BEKLEYENLER" / "SENİN CEVAP BEKLEDİKLERİN" vs MASTER #9 "Senden Beklenenler / Senin Beklediklerin" vs Prep "SENDEN BEKLENENLER" / "SENİN BEKLEDİKLERİN". Pick one set (i18n keys).
10. **English loanwords in Turkish UI.** "Bu hafta hangi deadline'lar var?" (MASTER #24: "Bu hafta hangi son tarihlerim var?") and "Deadline 17:00" (mail key point). Use "son tarih".
11. **Turkish uppercase bug.** The reply kicker uses `toUpperCase()`, so the "Samimi" tone renders "SAMIMI" instead of "SAMİMİ". Use `toLocaleUpperCase('tr-TR')` for all generated kickers.
12. **Subscription state contradicts itself.**
    - Profile shows "PRO · Deneme · 5 gün kaldı" and "Abonelik · Pro deneme", yet Abonelik opens a paywall offering "Ücretsiz Dene · 7 gün".
    - The toast "12 Eylül'de hatırlatırım" conflicts with the footnote "Deneme bitmeden 24 saat önce hatırlatırız" (that would be 11 Sep).
    - Prices are hard-coded; Restore Purchases, Terms/Privacy and Manage Subscription are missing (#43, #112).
13. **Profile name.** "{name} Emre" hard-codes a surname.
14. **"Önemli Kişiler · 4 kişi" opens one person** (Mehmet) instead of the VIP list.
15. **Hub accessibility claims are broken by the prototype.** The hub says "Gövde min. 15px, dokunma alanı min. 44px", but:
    - Hit targets are 36 (back, ✓, ···, text actions), 34 (chips, pills), 32 (tone segments, speed) and 30 (plan segments).
    - Primary body lines are 14px in many places.
    - Production: keep the visuals but add `hitSlop` to ≥44pt (iOS) / 48dp (Android), and support Dynamic Type (#92).
16. **Hub under-reports dark mode.** It says "Dark mode temsilî ekranlar 03 ve 05 sayfalarında", but dark artboards also exist in 04 (4.2) and 06 (6.1D). This file has no dark variants except the inherently dark immersive screens. MASTER #38 requires System/Light/Dark for all screens, while the Profil "Görünüm" value shows "Açık" (default should be "Sistem").
17. **Source rows are not universal.** The hub claims every AI inference has one:
    - Present on Today/Akış cards and Mail.
    - Missing on Plan insights, briefing rows, most assistant answers and approval cards (#33 requires source plus destination account).
18. **Reply-flow endings misbehave.** "Bugün'e Dön" does not switch tabs (from Akış it lands back on Akış), and it removes the Today card even when entered elsewhere. Sending to Mehmet silently marks approval a1 approved (a good intent-dedupe idea, but it must be explicit via a shared idempotency key).
19. **Reminder sheet context is wrong.** The Elektrik faturası (due 10 Eyl) sheet offers "30 dakika önce · 16:30".
20. **Correction-sheet VIP bug.** The VIP option shows for non-person items and derives wrong names.
21. **Dead-end assistant.** After one answer there are no suggestions and the composer is non-functional.
22. **Presentation semantics mismatch.** The audio player uses a collapse (modal) affordance but is pushed on the stack like any other screen. The paywall has a close ×. There is no mini-player for backgrounded audio.

**Versus MASTER_PROMPT**

23. **#20 / #23 / #83 (no fabricated data).** Travel-time and leave-by estimates, Netflix viewing count, phone-call duration, production-schedule date and "Mehmet 16:00'yı önerdi" have no allowed source. The hub also says "ek entegrasyon gerekmez", which rules out routing and call-log integrations. Render these fields only when a `source_ref` exists; otherwise add integrations deliberately.
24. **#33 Approval Center completeness.**
    - Missing statuses: executing, executed, failed, expired.
    - Missing action types in the UI: `reminder_create`, `commitment_create`.
    - Missing fields: source and destination/account.
    - Idempotency is absent (duplicate approvals possible).
25. **#15 Email Detail.** Missing the "Orijinal Maili Aç" external handoff; only an inline expand is shown.
26. **#21 Meeting Prep.** Missing the meeting-link external handoff, relevant files and attendees. Mail rows must open Email Detail; they are not tappable here.
27. **#22 Post-meeting.** Must be triggered at event end (notification) with text/voice input. Here it is reached from prep "Not Al" with a pre-filled transcript.
28. **#18 Commitments.** Actions "Tamamlandı / Ertele / Kaynağı Gör" do not appear in this file (see 04/4.8).
29. **#29 Smart reminders.** The preset is named "Kendin seç" in MASTER vs "Özel zaman" here; decide the label.
30. **#44 Free/Pro.** Nothing in the hub shows gating for Pro features (Meeting Prep, Voice Briefing, Follow-up, Memory, VIP, Midday/Evening), though the user is in trial. The paywall list omits Universal Capture, multiple calendars and Android Notification Intelligence, and "Sınırsız analiz" conflicts with #82 cost control.
31. **#130 User Settings.** The profile list lacks Profile edit, Referral, About and Delete Account (the latter via Privacy); Connected Accounts is shown as "Bağlantılar".
32. **#93 / #94 states.** The hub shows the happy path only, apart from the all-done state. Skeleton, empty, error, offline and reconnect patterns come from 08; they must be applied per screen.
33. **#95 Global Search.** No entry point in the IA (only Asistan "Hafıza"). Needs a placement decision without adding a 5th tab (e.g., Asistan header search or a pull-down on Akış/Bugün).
34. **#12 Weekly Review and #37 Widgets** are not placed in the hub IA tiles; they exist in 03 and 08. They need entry points (Today card on Sunday 18:00; widget deep links).
35. **#39 Localization.** All strings here are Turkish literals; the English locale and i18n keys are required.
36. **Typography platform decision.** Hub rule "iOS'ta gövde SF Pro'ya düşer" vs bundling Geist. Choose one: bundle Geist + Lora via expo-font on both platforms (consistent), or use system fonts on iOS body text. Record the choice in DESIGN_AUDIT.md (#124).
37. **Symbol gap.** Material Symbols has no 15-second replay/forward glyph. The prototype mirrors `replay` and adds a "15" label; a custom icon is needed, and 15 s seek must be kept per #9.

import { EXTERNAL_LINKS } from '../../lib/site.ts';
import { LEGAL_EFFECTIVE_DATE, LEGAL_VERSION } from '../meta.ts';
import {
  link,
  mail,
  md,
  p,
  page,
  strong,
  ul,
  type Block,
  type LegalContext,
  type LegalDocument,
} from './types.ts';

/**
 * Gizlilik Politikası ve KVKK Aydınlatma Metni (SCREEN_AND_FLOW_MAP Part 5 §3.2). The Turkish text
 * prevails. Every statement mirrors the architecture: SECURITY_AND_PRIVACY_PLAN §4, ADR-05,
 * AI_PIPELINE_PLAN §6.9.8 (redaction), INTEGRATION_PLAN (scopes). Counsel review before public
 * launch is a Manual external step (`SITE_INDEXABLE` stays false until then).
 */
export function privacyTr(ctx: LegalContext): LegalDocument {
  const c = ctx.company;
  const controller: Block = {
    type: 'dl',
    items: [
      { term: 'Veri sorumlusu', desc: [c.displayName] },
      ...(c.address === undefined ? [] : [{ term: 'Adres', desc: [c.address] }]),
      ...(c.mersisNo === undefined ? [] : [{ term: 'MERSİS numarası', desc: [c.mersisNo] }]),
      ...(c.kepAddress === undefined ? [] : [{ term: 'KEP adresi', desc: [c.kepAddress] }]),
      { term: 'Gizlilik iletişimi', desc: [mail(c.privacyEmail)] },
      ...(c.euRepresentative === undefined
        ? []
        : [{ term: 'AB temsilcisi (GDPR m. 27)', desc: [c.euRepresentative] }]),
    ],
  };

  return {
    id: 'privacy',
    title: 'Gizlilik Politikası ve KVKK Aydınlatma Metni',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        id: 'ozet',
        heading: 'Kısaca',
        blocks: [
          ul(
            'Önemli işlemler sen onaylamadan gerçekleştirilmez.',
            'Veriler aktarım sırasında ve saklanırken şifrelenir.',
            'Verilerin reklam amacıyla satılmaz.',
            'Mail içeriklerin yapay zekâ modellerini eğitmek için kullanılmaz.',
            'Mail içeriğinin tamamı saklanmaz; yalnızca özetler, kısa alıntılar ve analiz sonuçları saklama süren boyunca tutulur.',
            'Analiz sonuçlarının ne kadar saklanacağını sen seçersin: 30 gün, 90 gün, 1 yıl ya da sen silene kadar.',
            'Verilerini dışa aktarabilir, geçmişini ya da hesabını istediğin an silebilirsin.',
            md`Hesabını ve verilerini istediğin an silebilirsin: uygulamada Profil › Gizlilik ve Güvenlik ya da ${page('/data-deletion', 'Veri Silme sayfası')}.`,
          ),
        ],
      },
      {
        id: 'veri-sorumlusu',
        heading: 'Veri sorumlusu',
        blocks: [
          p(
            'Bu metin, 6698 sayılı Kişisel Verilerin Korunması Kanunu’nun (KVKK) 10. maddesi kapsamındaki aydınlatma metni ve Avrupa Birliği Genel Veri Koruma Tüzüğü’nün (GDPR) 13. maddesi kapsamındaki bilgilendirmedir.',
          ),
          controller,
          p(
            'Veri Sorumluları Siciline (VERBİS) kayıt yükümlülüğü, şirketimizin yasal eşikleri dikkate alınarak değerlendirilir; kayıt yapıldığında sicil bilgisi burada yayımlanır.',
          ),
        ],
      },
      {
        id: 'kapsam',
        heading: 'Bu politika neyi kapsar?',
        blocks: [
          p(
            'Bu politika Dijital Asistan iOS ve Android uygulamalarını, bu web sitesini ve destek kanallarımızı kapsar. İç yönetim paneli yalnızca yetkili çalışanlarımız tarafından kullanılır; son kullanıcılar oradan veri girmez.',
          ),
        ],
      },
      {
        id: 'islenen-veriler',
        heading: 'Hangi verileri işliyoruz?',
        blocks: [
          {
            type: 'table',
            caption: 'İşlenen veri kategorileri',
            head: ['Kategori', 'İşlenen veriler', 'Kaynak ve zaman'],
            rows: [
              [
                ['Hesap'],
                [
                  'Ad, e-posta adresi, giriş yöntemi (Apple, Google, Microsoft ya da e-posta kodu). Apple’ın gizli e-posta adresini (…@privaterelay.appleid.com) kullanabilirsin.',
                ],
                ['Sen; hesap oluştururken'],
              ],
              [
                ['Bağlı mail hesapları'],
                [
                  'Başlık bilgileri (gönderen, alıcılar, konu, tarih, ileti kimlikleri), en fazla 200 karakterlik önizleme, AI özetleri, anahtar noktalar, kategoriler ve kaynaktan doğrulanmış en fazla 300 karakterlik kısa alıntılar. ',
                  strong('Mail gövdesi saklanmaz'),
                  '; “Orijinal Mail” açıldığında hesabından anlık getirilir, kaydedilmez ve kayıt dosyalarına yazılmaz. Ekler yalnızca “Ekler” veri kaynağı açıksa ve analiz için okunur.',
                ],
                ['Bağladığın Gmail veya Outlook hesabı; senkronizasyon sırasında'],
              ],
              [
                ['Takvim'],
                [
                  'Etkinlik başlığı, zamanı, katılımcılar, konum metni, toplantı bağlantısı ve düzenleyen.',
                ],
                ['Bağladığın takvim; senkronizasyon sırasında'],
              ],
              [
                ['Görevler'],
                ['Google Tasks veya Microsoft To Do görev başlığı, son tarihi ve durumu.'],
                ['Bağladığın görev hesabı; senkronizasyon sırasında'],
              ],
              [
                ['Cihaz takvimi ve anımsatıcılar'],
                [
                  'iPhone’da Apple Takvim ve Anımsatıcılar, Android’de cihaz takvimi: yalnızca sen “Bağla”ya dokunduğunda, uygulama açıkken okunur ve özet olarak yüklenir.',
                ],
                ['Telefonun; uygulama çalışırken'],
              ],
              [
                ['Telefon bildirimleri (yalnızca Android, açıkça etkinleştirirsen)'],
                [
                  'Bildirim içerikleri cihazında işlenir; yalnızca çıkarılan bilgiler (ör. kargo durumu, tutar, tarih) hesabına kaydedilir. Doğrulama kodları ve güvenlik uygulamaları her zaman hariç tutulur. Bildirim metinleri ',
                  strong('sunucuya gönderilmez'),
                  '.',
                ],
                ['Android telefonun; özelliği açtığında'],
              ],
              [
                ['Yakalamalar'],
                [
                  'Paylaştığın veya yüklediğin fotoğraf, ekran görüntüsü, PDF, dosya, bağlantı ve metinler. Dosyalar analizden sonra silinir (Saklama süreleri bölümü).',
                ],
                ['Sen; paylaştığında veya yüklediğinde'],
              ],
              [
                ['Ses'],
                [
                  'Sesli komutlar cihazda yazıya çevrilir. Cihazın bunu desteklemiyorsa Apple veya Google’ın konuşma tanıma hizmeti ya da sunucu tarafı ses tanıma sağlayıcımız kullanılır; ses kaydı saklanmaz.',
                ],
                ['Sen; sesli komut verdiğinde'],
              ],
              [
                ['Asistan konuşmaları'],
                ['Sorduğun sorular ve yanıtlar, kaynak bağlantılarıyla.'],
                ['Sen; asistanı kullandığında'],
              ],
              [
                ['Tercihler ve kurallar'],
                [
                  'Brifing saatleri, bildirim ayarları, öncelik kuralları, VIP kişiler, öğrenilen tercihler ve saklama süresi.',
                ],
                ['Sen ve uygulamadaki düzeltmelerin'],
              ],
              [
                ['Onaylı işlemler'],
                ['Önerilen ve onayladığın ya da reddettiğin işlemler (ne, neden, nereye, sonuç).'],
                ['Uygulama ve senin kararların'],
              ],
              [
                ['Bildirimler'],
                [
                  'Cihaz bildirim anahtarı, gönderilen bildirimlerin türü ve zamanı; bildirim metni seçtiğin ayrıntı düzeyinde oluşturulur.',
                ],
                ['Telefonun; bildirim izni verdiğinde'],
              ],
              [
                ['Abonelik'],
                [
                  'Uygulama kullanıcı kimliği, abonelik durumu, ürün, yenileme ve bitiş tarihi. ',
                  strong('Kart bilgilerin bize gelmez'),
                  '; ödemeyi Apple veya Google alır.',
                ],
                ['App Store veya Google Play; satın aldığında ve yenilemelerde'],
              ],
              [
                ['Davet'],
                [
                  'Davet kodun ve davet durumları; kötüye kullanımı önlemek için geri döndürülemez özete çevrilmiş cihaz ve e-posta sinyalleri.',
                ],
                ['Sen ve davet ettiğin kişiler'],
              ],
              [
                ['Destek'],
                [
                  'E-posta, ad (isteğe bağlı), konu, mesaj ve dil; uygulamadan yazdığında ayrıca platform ve uygulama sürümü.',
                ],
                ['Sen; destek talebi gönderdiğinde'],
              ],
              [
                ['Ürün analitiği'],
                [
                  'İçerik içermeyen olaylar (ör. “brifing açıldı”); mail, konuşma veya kişi bilgisi içermez.',
                ],
                ['Uygulama; kullanım sırasında'],
              ],
              [
                ['Hata kayıtları'],
                [
                  'Hata izi, cihaz modeli, işletim sistemi ve uygulama sürümü; kişisel veriler gönderilmeden önce temizlenir.',
                ],
                ['Uygulama; bir hata olduğunda'],
              ],
              [
                ['Web sitesi'],
                [
                  'Çerez yok; yalnızca günlük toplam sayımlar (Çerezler bölümü). Barındırma sağlayıcımız güvenlik için kısa süreli erişim kaydı tutar.',
                ],
                ['Tarayıcın; siteyi ziyaret ettiğinde'],
              ],
            ],
          },
          p(
            'Cihaz konumunu toplamayız; takvim etkinliğinde yazan konum metni etkinlik verisinin parçası olarak işlenir.',
          ),
        ],
      },
      {
        id: 'amaclar',
        heading: 'Neden işliyoruz ve hukuki sebepler',
        blocks: [
          {
            type: 'table',
            caption: 'İşleme amaçları ve hukuki sebepler',
            head: ['Amaç', 'Veri', 'KVKK m. 5', 'GDPR m. 6'],
            rows: [
              [
                ['Brifing, sınıflandırma, öneriler ve asistan'],
                ['Bağlı hesap verileri, tercihler, asistan konuşmaları'],
                ['m. 5/2 (c) sözleşmenin kurulması veya ifası'],
                ['6(1)(b)'],
              ],
              [
                ['Onayladığın işlemleri yürütmek (mail gönderme, takvim ve görev oluşturma)'],
                ['Onaylı işlem kayıtları, bağlı hesap erişimi'],
                ['m. 5/2 (c)'],
                ['6(1)(b)'],
              ],
              [
                ['Bildirimler'],
                ['Bildirim anahtarı, bildirim tercihleri'],
                ['m. 5/2 (c)'],
                ['6(1)(b)'],
              ],
              [
                ['Abonelik ve davet yönetimi, kötüye kullanımın önlenmesi'],
                ['Abonelik ve davet kayıtları, özetlenmiş sinyaller'],
                ['m. 5/2 (c) ve (f) meşru menfaat'],
                ['6(1)(b) ve 6(1)(f)'],
              ],
              [
                ['Güvenlik, hata ayıklama ve sistem sağlığı'],
                ['Hata kayıtları, sunucu kayıtları, denetim kayıtları'],
                ['m. 5/2 (f)'],
                ['6(1)(f)'],
              ],
              [
                ['Destek taleplerini yanıtlamak'],
                ['Destek talebi bilgileri'],
                ['m. 5/2 (c) ve (f)'],
                ['6(1)(b) ve 6(1)(f)'],
              ],
              [
                ['Yasal yükümlülükler ve talepler'],
                ['İlgili kayıtlar'],
                ['m. 5/2 (ç) ve (e)'],
                ['6(1)(c) ve 6(1)(f)'],
              ],
              [
                ['İçerik içermeyen ürün analitiğiyle ürünü iyileştirmek'],
                ['İçeriksiz olaylar, günlük toplam web sayımları'],
                ['m. 5/2 (f)'],
                ['6(1)(f)'],
              ],
            ],
          },
          p(
            'Temel hizmet için açık rızaya dayanmayız. İsteğe bağlı özellikler (Android telefon bildirimleri zekâsı, “Etkileşimlerimden öğren”) yalnızca sen açarsan çalışır ve istediğin zaman kapatılabilir.',
          ),
        ],
      },
      {
        id: 'yapay-zeka',
        heading: 'Yapay zekâ ile işleme',
        blocks: [
          ul(
            'Önce belirleyici filtreler ve senin kuralların çalışır. Yapay zekâ sağlayıcılarına yalnızca bir özellik için gereken içerik gönderilir.',
            'Maillerden, dosyalardan ve web sayfalarından gelen içerik güvenilmeyen veri olarak ele alınır; içindeki talimatlar uygulanmaz.',
            'Çıktıların kaynağa dayanması gerekir; doğrulanamayan bir tarih veya tutar “Kaynakta kesinleşmiyor.” olarak gösterilir.',
            'Her yapay zekâ çıkarımının altında “Bu nereden çıktı?” bağlantısı vardır.',
            'Doğrulama kodları, şifreler, kart ve IBAN numaraları ile T.C. kimlik numaraları, yapay zekâya gönderilmeden önce otomatik olarak maskelenir.',
            md`${strong('Hukuki veya benzer ölçüde önemli sonuç doğuran otomatik karar verilmez')} (KVKK m. 11/1-g, GDPR m. 22). Her yazma işlemi senin onayını gerektirir.`,
            'Yapay zekâ kararlarını düzeltebilirsin; düzeltmelerin yalnızca senin tercihlerini etkiler.',
            md`${strong('Mail içeriklerin ve diğer verilerin yapay zekâ modellerini eğitmek için kullanılmaz.')} Ne biz ne de çalıştığımız yapay zekâ sağlayıcıları bu verilerle model eğitir.`,
            'Yapay zekâ işleme için Anthropic (birincil), OpenAI (yedek ve ses tanıma yedeği) ve Voyage AI (anlam dizini) ile çalışırız; ayrıntılar Aktarımlar ve alt işleyiciler bölümündedir.',
          ),
        ],
      },
      {
        id: 'google',
        heading: 'Google kullanıcı verileri (Sınırlı Kullanım)',
        blocks: [
          {
            type: 'callout',
            id: 'google-limited-use',
            content: [
              'Dijital Asistan’ın Google API’lerinden aldığı bilgileri kullanması ve başka bir uygulamaya aktarması, Sınırlı Kullanım şartları dahil Google API Hizmetleri Kullanıcı Verileri Politikası’na uygun olacaktır.',
            ],
          },
          p(
            md`İlgili politikalar: ${link(EXTERNAL_LINKS.googleUserDataPolicy, 'Google API Hizmetleri Kullanıcı Verileri Politikası')} ve ${link(EXTERNAL_LINKS.googleWorkspaceUserDataPolicy, 'Google Workspace API Kullanıcı Verileri ve Geliştirici Politikası')}.`,
          ),
          {
            type: 'table',
            caption: 'İstenen Google izinleri',
            head: ['İzin', 'Neden', 'Ne zaman istenir'],
            rows: [
              [['gmail.readonly'], ['Maillerini analiz etmek'], ['Gmail’i bağladığında']],
              [
                ['gmail.send'],
                ['Yalnızca onayladığın bir yanıtı göndermek'],
                ['İlk onaylı gönderiminde'],
              ],
              [
                [
                  'calendar.events.readonly, calendar.calendarlist.readonly, calendar.settings.readonly',
                ],
                ['Takvimini okumak ve saat dilimini doğru uygulamak'],
                ['Google Takvim’i bağladığında'],
              ],
              [
                ['calendar.events.owned'],
                ['Yalnızca onayladığın etkinlikleri oluşturmak veya güncellemek'],
                ['İlk onaylı takvim değişikliğinde'],
              ],
              [['tasks.readonly'], ['Görevlerini okumak'], ['Google Tasks’ı bağladığında']],
              [['tasks'], ['Yalnızca onayladığın görevleri oluşturmak'], ['İlk onaylı görevinde']],
            ],
          },
          ul(
            'Google verileri yalnızca uygulamada sana sunulan özellikleri sağlamak için kullanılır.',
            'Reklam için kullanılmaz, satılmaz; genelleştirilmiş veya kişiselleştirilmemiş yapay zekâ ya da makine öğrenmesi modellerini geliştirmek, iyileştirmek veya eğitmek için kullanılmaz.',
            'Üçüncü kişilere yalnızca bu özellikleri sağlamak için (bizim talimatımızla çalışan yapay zekâ alt işleyicileri), güvenlik amacıyla, yasal zorunlulukta veya önceden bildirilen bir birleşme ya da devralmada aktarılır.',
            'İnsanlar Google verilerini okumaz; istisnalar yalnızca belirli iletiler için açık onay vermen (ör. destekten bir maile bakmasını istemen), güvenlik incelemeleri, yasal zorunluluk ya da iç işlemler için toplulaştırılmış ve anonimleştirilmiş kullanımdır.',
          ),
          { type: 'h3', text: 'Erişimi geri alma' },
          ul(
            'Uygulamada: Profil › Bağlı Hesaplar › hesabı seç › Bağlantıyı kaldır. Google erişimini otomatik olarak geri alırız.',
            md`Google’da: ${link(EXTERNAL_LINKS.googleConnections, 'myaccount.google.com/connections')}.`,
          ),
        ],
      },
      {
        id: 'microsoft',
        heading: 'Microsoft hesap verileri',
        blocks: [
          ul(
            'Bağlarken: openid, profile, email, offline_access, User.Read ve Mail.Read.',
            'Takvim veya görevleri bağladığında: Calendars.Read ve Tasks.Read.',
            'Yalnızca o türdeki ilk yazma işlemini onayladığında: Mail.Send, Calendars.ReadWrite ve Tasks.ReadWrite.',
          ),
          p(
            'Google verileri için yukarıda yazan kullanım kuralları Microsoft verileri için de geçerlidir.',
          ),
          p(
            md`Microsoft, uygulamaların kendi erişimlerini geri almasına izin vermez. Bağlantıyı kaldırdığında saklanan erişim anahtarlarını siler ve senkronizasyonu durdururuz. İzni Microsoft tarafında da kaldırman için: ${link(EXTERNAL_LINKS.microsoftPersonalConsent, 'kişisel hesap')} veya ${link(EXTERNAL_LINKS.microsoftWorkApps, 'iş veya okul hesabı')}.`,
          ),
        ],
      },
      {
        id: 'apple-ve-cihaz',
        heading: 'Apple ile giriş ve cihaz verileri',
        blocks: [
          ul(
            'Apple’ın gizli e-posta (private relay) adresleri desteklenir.',
            'Hesabın silindiğinde Apple ile Giriş Yap belirtecini Apple’da geri alırız.',
            'Apple Takvim (EventKit) ve Android cihaz takvimi yalnızca “Bağla”ya dokunduktan sonra ve yalnızca uygulama çalışırken okunur; güncelliği “son cihaz senkronu” olarak gösterilir.',
            'Widget içeriği cihazında (App Group) kalır ve kilit ekranı ayarında seçtiğin ayrıntıdan fazlasını göstermez.',
            'iOS buna izin vermediği için iPhone’da bildirim okuma özelliği yoktur.',
          ),
        ],
      },
      {
        id: 'alt-isleyiciler',
        heading: 'Aktarımlar ve alt işleyiciler',
        blocks: [
          p(
            'Verilerini satmayız, reklam için paylaşmayız. Aşağıdaki hizmet sağlayıcılar yalnızca bizim adımıza ve talimatımızla işler.',
          ),
          { type: 'subprocessorTable' },
          p(
            'Konum bilgileri, sağlayıcılarda seçtiğimiz veri bölgelerine dayanır. Yetkili kurum ve mahkeme talepleri yalnızca yasal olarak zorunlu olduğunda ve yalnızca gereken ölçüde karşılanır. Bir birleşme veya devralma olursa seni önceden bilgilendiririz.',
          ),
        ],
      },
      {
        id: 'yurt-disi-aktarim',
        heading: 'Yurt dışına aktarım',
        blocks: [
          p(
            'Veritabanımız Avrupa Birliği’nde (Frankfurt) bulunur; yapay zekâ işleme ABD’deki alt işleyicilerimizde yapılır. Türkiye’den yurt dışına aktarımlar KVKK m. 9 kapsamında, Kurul’un ilan ettiği standart sözleşmelerle yapılır ve bu sözleşmeler imzadan sonra 5 iş günü içinde Kurum’a bildirilir. AB/AEA’dan yapılan aktarımlar Standart Sözleşme Maddelerine ya da, sağlayıcı sertifikalıysa, yeterlilik kararına dayanır.',
          ),
        ],
      },
      {
        id: 'saklama',
        heading: 'Saklama süreleri',
        blocks: [
          { type: 'retentionTable' },
          p(
            'Saklama süresi dolan veriler, arama dizini ve depolanan dosyalar dahil, otomatik temizleme işiyle silinir. Saklama süreni uygulamada Profil › Gizlilik ve Güvenlik › Veri saklama bölümünden değiştirebilirsin.',
          ),
        ],
      },
      {
        id: 'silme',
        heading: 'Dışa aktarma ve silme',
        blocks: [
          ul(
            'Dışa aktarma: Profil › Gizlilik ve Güvenlik › Verilerimi dışa aktar. Dosya arka planda hazırlanır; indirme bağlantısı 24 saat geçerlidir.',
            md`Geçmiş silme ve hesap silmenin kapsamı ${page('/data-deletion', 'Veri Silme sayfasında', 'neler-silinir')} tablo olarak yer alır.`,
            'Hesap silindiğinde Google ve Apple erişimi otomatik olarak geri alınır; Microsoft izni için Microsoft bölümündeki bağlantıları kullan. Abonelik kayıtları RevenueCat’ten silinir; mağaza aboneliğini ise ayrıca iptal etmen gerekir.',
            md`Silme genellikle 24 saat içinde tamamlanır; yasal azami süre 30 gündür. Yedeklerdeki kopyalar ${ctx.backupDays === undefined ? 'yedek döngüsüyle' : `en fazla ${String(ctx.backupDays)} gün içinde yedek döngüsüyle`} silinir.`,
            'Silme tamamlanmadan tamamlandı demeyiz; sonuç e-postayla bildirilir.',
          ),
        ],
      },
      {
        id: 'guvenlik',
        heading: 'Güvenlik önlemleri',
        blocks: [
          ul(
            'Veriler aktarım sırasında TLS ile, saklanırken şifrelenerek korunur.',
            'Mail, takvim ve görev hesaplarına erişim anahtarları ayrıca AES-256-GCM ile şifrelenir ve cihaza hiç gönderilmez.',
            'Veritabanında her kullanıcının verisi satır düzeyinde erişim kurallarıyla ayrılır.',
            'Çalışan erişimi çok adımlı doğrulama, rol tabanlı yetkiler ve denetim kayıtları gerektirir. Kişisel veriyi görüntülemek için gerekçe ve süreli erişim gerekir; her görüntüleme kaydedilir.',
            'Mail gövdelerinin tamamı saklanmaz.',
            'Her yazma işlemi onay gerektirir.',
            'Kayıtlar en az veriyle ve kişisel verilerden temizlenerek tutulur.',
            'Brifing ve analiz hazırlayabilmek için veriler sunucularımızda işlenir; bu yüzden verilerini yalnızca senin cihazının çözebildiği bir şifreleme vaat etmiyoruz.',
            md`Bir güvenlik açığı bulduysan ${mail(c.securityEmail)} adresine yaz.`,
          ),
        ],
      },
      {
        id: 'bildirimler',
        heading: 'Bildirimler ve kilit ekranı',
        blocks: [
          p(
            'Varsayılan bildirim ayrıntı düzeyi hassas içerik göstermez: “Yalnızca başlık”. Tam ayrıntıyı sen seçebilirsin. Sessiz saatler uygulanır; bildirim içeriği sunucuda, seçtiğin ayrıntı düzeyine göre oluşturulur.',
          ),
        ],
      },
      {
        id: 'cerezler',
        heading: 'Çerezler ve web sitesi',
        blocks: [
          ul(
            'Bu site reklam, izleme veya analitik çerezi kullanmaz ve seni tanımlayan bir kimlik saklamaz.',
            'Sayfa görüntülemeleri ve düğme tıklamaları yalnızca anonim günlük toplamlar olarak sayılır; IP adresi veya cihaz kimliği saklanmaz.',
            'Tarayıcın “Global Privacy Control” ya da “Do Not Track” sinyali gönderiyorsa hiçbir şey sayılmaz.',
            'Veri silme doğrulaması sunucumuzda yapılır; tarayıcında oturum, belirteç ya da çerez oluşturulmaz.',
            ...(ctx.turnstileEnabled
              ? [
                  'Bot koruması açıkken Cloudflare Turnstile yalnızca destek ve veri silme formlarında, yalnızca insanları otomatik kötüye kullanımdan ayırmak için çalışır; Aktarımlar ve alt işleyiciler bölümünde listelenir.',
                ]
              : []),
          ),
        ],
      },
      {
        id: 'cocuklar',
        heading: 'Çocuklar',
        blocks: [
          p(
            md`Hizmet 18 yaşından küçükler için tasarlanmamıştır. Bir hesabın çocuğa ait olduğunu düşünüyorsan ${mail(c.privacyEmail)} adresine yaz; hesabı doğrulayıp sileriz.`,
          ),
        ],
      },
      {
        id: 'haklarin',
        heading: 'Hakların',
        blocks: [
          p('KVKK m. 11 uyarınca şu haklara sahipsin:'),
          ul(
            'Kişisel verilerinin işlenip işlenmediğini öğrenme,',
            'İşlenmişse buna ilişkin bilgi talep etme,',
            'İşlenme amacını ve bunların amacına uygun kullanılıp kullanılmadığını öğrenme,',
            'Yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme,',
            'Eksik veya yanlış işlenmişse düzeltilmesini isteme,',
            'KVKK m. 7’de öngörülen şartlar çerçevesinde silinmesini veya yok edilmesini isteme,',
            'Düzeltme ve silme işlemlerinin, verilerin aktarıldığı üçüncü kişilere bildirilmesini isteme,',
            'Münhasıran otomatik sistemlerle analiz edilmesi suretiyle aleyhine bir sonucun ortaya çıkmasına itiraz etme,',
            'Kanuna aykırı işleme nedeniyle zarara uğraman hâlinde zararın giderilmesini talep etme.',
          ),
          p(
            'GDPR kapsamındaysan erişim, düzeltme, silme, işlemeyi kısıtlama, veri taşınabilirliği ve itiraz haklarına (m. 15–22) ve bir denetim makamına şikâyet hakkına sahipsin.',
          ),
          { type: 'h3', text: 'Nasıl başvurursun?' },
          ul(
            'Uygulamadaki Gizlilik Merkezi’nden (Profil › Gizlilik ve Güvenlik),',
            md`${page('/data-deletion', 'Veri Silme sayfasından')} (hesap silme),`,
            md`Kayıtlı e-posta adresinden ${mail(c.privacyEmail)} adresine,`,
            ...(c.address === undefined ? [] : [`Yazılı olarak ${c.address} adresine,`]),
            ...(c.kepAddress === undefined ? [] : [`KEP ile ${c.kepAddress} adresine.`]),
          ),
          p(
            'Başvurunu en geç 30 gün içinde ücretsiz olarak sonuçlandırırız; işlem ayrıca bir maliyet gerektirirse Kurul’un belirlediği tarife uygulanabilir. Bize başvurduktan sonra KVKK m. 14’teki süreler içinde Kişisel Verileri Koruma Kurulu’na şikâyette bulunabilirsin.',
          ),
        ],
      },
      {
        id: 'degisiklikler',
        heading: 'Değişiklikler',
        blocks: [
          p(
            'Bu politikanın her sürümü, sürüm numarası ve yürürlük tarihiyle yayımlanır. Önemli değişiklikleri yürürlüğe girmeden en az 15 gün önce uygulamadaki duyurularla bildiririz.',
          ),
        ],
      },
      {
        id: 'iletisim',
        heading: 'İletişim',
        blocks: [
          {
            type: 'dl',
            items: [
              { term: 'Gizlilik', desc: [mail(c.privacyEmail)] },
              { term: 'Destek', desc: [mail(c.supportEmail)] },
              { term: 'Güvenlik', desc: [mail(c.securityEmail)] },
              ...(c.address === undefined ? [] : [{ term: 'Posta adresi', desc: [c.address] }]),
              ...(c.kepAddress === undefined ? [] : [{ term: 'KEP', desc: [c.kepAddress] }]),
            ],
          },
        ],
      },
    ],
  };
}

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
  type LegalContext,
  type LegalDocument,
} from './types.ts';

/**
 * Kullanım Koşulları (SCREEN_AND_FLOW_MAP Part 5 §4). Matches product behaviour: approvals,
 * AI output, fair use, store billing, referral rules. Counsel confirms the consumer-law wording
 * before public launch (Manual external step).
 */
export function termsTr(ctx: LegalContext): LegalDocument {
  const c = ctx.company;
  const r = ctx.referral;
  return {
    id: 'terms',
    title: 'Kullanım Koşulları',
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: [
      {
        id: 'taraflar',
        heading: 'Taraflar ve kabul',
        blocks: [
          p(
            `Bu Kullanım Koşulları, Dijital Asistan hizmetini sunan ${c.displayName} ile senin aranda geçerlidir. Bir Dijital Asistan hesabı oluşturduğunda bu koşulları kabul etmiş olursun.`,
          ),
        ],
      },
      {
        id: 'hizmet',
        heading: 'Hizmetin tanımı',
        blocks: [
          p(
            'Dijital Asistan, bağladığın mail, takvim ve görev hesaplarını analiz ederek brifingler, öncelikler, yanıt taslakları ve öneriler hazırlayan kişisel bir komuta merkezidir. Öncelikli olarak bir sohbet botu değildir. Hukuki, mali veya tıbbi konularda profesyonel danışmanlığın yerini tutmaz.',
          ),
        ],
      },
      {
        id: 'uygunluk',
        heading: 'Hesap ve uygunluk',
        blocks: [
          ul(
            'Hizmeti kullanmak için 18 yaşını doldurmuş olman gerekir.',
            'Her kişi yalnızca bir hesap kullanır.',
            'Giriş yöntemlerini güvende tutmak senin sorumluluğundadır.',
            md`Hesabının izinsiz kullanıldığını düşünüyorsan hemen ${mail(c.securityEmail)} adresine yaz.`,
          ),
        ],
      },
      {
        id: 'baglantilar',
        heading: 'Bağlı hesaplar ve izinler',
        blocks: [
          p(
            'Her bağlı hesap için okuma erişimine sen izin verirsin. Yazma izinleri (mail gönderme, takvim veya görev oluşturma) yalnızca o türdeki ilk yazma işlemini onayladığında istenir. Google, Microsoft ve Apple’ın kendi koşulları da geçerlidir. Bir bağlantıyı istediğin zaman kaldırabilirsin.',
          ),
        ],
      },
      {
        id: 'onay',
        heading: 'Onaylı işlemler',
        blocks: [
          ul(
            'Sen onaylamadan hiçbir mail gönderilmez, hiçbir takvim etkinliği veya görev oluşturulmaz ya da değiştirilmez.',
            'Onay ekranında gösterilen işlemi aynen ve bir kez yürütürüz.',
            'Bir işlem başarısız olursa sana bildirilir ve yeniden deneyebilirsin; gerçekleşmeyen bir işlemi gerçekleşti diye göstermeyiz.',
            'Onayladığın içerikten sen sorumlusun.',
          ),
        ],
      },
      {
        id: 'yapay-zeka',
        heading: 'Yapay zekâ çıktıları',
        blocks: [
          p(
            'Yapay zekâ çıktıları eksik ya da hatalı olabilir. Kaynağı “Bu nereden çıktı?” ile kontrol edebilirsin; doğrulanamayan ayrıntılar “Kaynakta kesinleşmiyor.” olarak işaretlenir. Sınıflandırmaları istediğin zaman düzeltebilirsin.',
          ),
        ],
      },
      {
        id: 'kabul-edilebilir-kullanim',
        heading: 'Kabul edilebilir kullanım',
        blocks: [
          ul(
            'Hizmeti hukuka aykırı amaçlarla, istenmeyen toplu mesaj göndermek veya başkalarını rahatsız etmek için kullanamazsın.',
            'Sınırları, güvenlik önlemlerini ya da diğer kullanıcıların veri ayrımını aşmaya çalışamazsın.',
            'Yasanın izin verdiği durumlar dışında uygulamayı tersine mühendislikle çözümleyemezsin.',
            'Hizmetten otomatik araçlarla veri toplayamazsın.',
            'Davet programını kötüye kullanamaz, birden fazla hesapla avantaj sağlamaya çalışamazsın.',
          ),
        ],
      },
      {
        id: 'planlar',
        heading: 'Ücretsiz plan ve Pro',
        blocks: [
          p(
            md`Ücretsiz planın güncel sınırları ${page('/pricing', 'Fiyatlar sayfasında')} yayımlanır. Pro'da AI kullanımı adil kullanım ilkesine tabidir; kişisel kullanım için yüksek günlük limitler sunar ve olağan dışı otomatik yükte geçici olarak yavaşlatılabilir.`,
          ),
        ],
      },
      {
        id: 'abonelik',
        heading: 'Abonelik, faturalandırma, iptal ve iade',
        blocks: [
          ul(
            'Satın alımlar Apple veya Google tarafından, onların koşullarıyla işlenir.',
            'Abonelikler, dönem bitiminden en az 24 saat önce iptal edilmedikçe otomatik olarak yenilenir.',
            md`İptal: iPhone'da Ayarlar › [adın] › Abonelikler (${link(EXTERNAL_LINKS.appStoreSubscriptions, 'App Store abonelikleri')}); Android'de Google Play › Profil › Ödemeler ve abonelikler (${link(EXTERNAL_LINKS.playSubscriptions, 'Google Play abonelikleri')}).`,
            'Deneme süresi yalnızca mağazanın satın alma ekranında gösteriliyorsa sunulur ve mağazanın koşullarına tabidir.',
            'Fiyat değişiklikleri mağaza kurallarına ve bildirimlerine göre uygulanır.',
            md`İadeler Apple (${link(EXTERNAL_LINKS.appleReportProblem, 'reportaproblem.apple.com')}) veya Google Play üzerinden yapılır.`,
            md`${strong('Hesabını silmek mağaza aboneliğini iptal etmez.')}`,
            '6502 sayılı Tüketicinin Korunması Hakkında Kanun ve ilgili mevzuattan doğan hakların saklıdır.',
          ),
        ],
      },
      {
        id: 'davet',
        heading: 'Davet programı',
        blocks: [
          ul(
            `Davet ettiğin kişi kaydolduktan sonraki ${String(r.applyWindowDays)} gün içinde kodunu ekler, en az bir hesap bağlar, ilk brifingini alır ve hesabı en az ${String(r.minAccountAgeHours)} saatlik olursa ikiniz de ${String(r.rewardDays)} gün Pro kazanırsınız.`,
            `Bir davet eden yılda en fazla ${String(r.maxRewardsPerYear)} ödül kazanabilir.`,
            'Ödüller üst üste eklenen Pro süreleridir; nakit değeri yoktur ve devredilemez.',
            'Kötüye kullanılan davetler (kendini davet etme, çoklu hesap, döngüsel davetler) reddedilir; bu yolla elde edilen ödüller geri alınabilir.',
            'Programdaki değişiklikler yalnızca yeni davetlere uygulanır; kazanılmış ödüller korunur.',
          ),
        ],
      },
      {
        id: 'fikri-mulkiyet',
        heading: 'Fikri mülkiyet ve lisans',
        blocks: [
          p(
            'Uygulamayı kişisel olarak kullanman için sana münhasır olmayan, devredilemez bir lisans veririz. İçeriğin senin kalır; hizmeti sunabilmemiz için bize yalnızca bu amaçla sınırlı bir işleme lisansı verirsin. “Dijital Asistan” adı ve işaretleri bize aittir.',
          ),
        ],
      },
      {
        id: 'ucuncu-taraf',
        heading: 'Üçüncü taraf hizmetleri ve mağazalar',
        blocks: [
          p(
            'Apple ve Google bu koşulların tarafı değildir ve uygulama için destek yükümlülükleri yoktur. App Store kullanıcıları için Apple ve bağlı şirketleri bu koşulların üçüncü taraf lehtarıdır. Google, Microsoft ve Apple hizmetleri kendi koşullarına tabidir.',
          ),
        ],
      },
      {
        id: 'hizmet-degisiklikleri',
        heading: 'Hizmetin sürekliliği ve değişiklikler',
        blocks: [
          p(
            'Özellikleri değiştirebiliriz. Önemli değişiklikleri en az 15 gün önce uygulamada duyururuz. Bakım çalışmalarını uygulama içi duyurularla bildiririz.',
          ),
        ],
      },
      {
        id: 'fesih',
        heading: 'Fesih',
        blocks: [
          p(
            md`Hesabını istediğin zaman silebilirsin: uygulamada ya da ${page('/data-deletion', 'Veri Silme sayfasında')}. Ciddi ihlallerde hesabı askıya alabiliriz; hukuken mümkün olduğunda seni önceden bilgilendiririz.`,
          ),
        ],
      },
      {
        id: 'sorumluluk',
        heading: 'Sorumluluğun sınırlandırılması',
        blocks: [
          p(
            'Sorumluluğumuz, yasanın izin verdiği ölçüde sınırlıdır. Kast ve ağır kusurdan doğan sorumluluk hariç tutulmaz; tüketici hakların etkilenmez.',
          ),
        ],
      },
      {
        id: 'uygulanacak-hukuk',
        heading: 'Uygulanacak hukuk ve uyuşmazlıklar',
        blocks: [
          p(
            'Bu koşullara Türkiye Cumhuriyeti hukuku uygulanır. Yasal parasal sınırlar içinde tüketici hakem heyetleri, bunların üzerinde tüketici mahkemeleri yetkilidir. Yaşadığın ülkenin zorunlu koruma hükümleri saklıdır.',
          ),
        ],
      },
      {
        id: 'degisiklikler',
        heading: 'Koşullardaki değişiklikler',
        blocks: [
          p(
            'Koşulların her sürümü, sürüm numarası ve yürürlük tarihiyle yayımlanır. Önemli değişiklikleri yürürlüğe girmeden en az 15 gün önce uygulamadaki duyurularla bildiririz.',
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
              { term: 'Destek', desc: [mail(c.supportEmail)] },
              { term: 'Gizlilik', desc: [mail(c.privacyEmail)] },
              ...(c.address === undefined ? [] : [{ term: 'Posta adresi', desc: [c.address] }]),
              ...(c.kepAddress === undefined ? [] : [{ term: 'KEP', desc: [c.kepAddress] }]),
            ],
          },
          p(md`Gizlilikle ilgili ayrıntılar ${page('/privacy', 'Gizlilik Politikası')}'ndadır.`),
        ],
      },
    ],
  };
}

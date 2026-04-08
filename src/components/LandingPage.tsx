import React from 'react';
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  ChartColumnBig,
  ChefHat,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  QrCode,
  Receipt,
  ShieldCheck,
  Store,
  Table2,
  Users,
  Wallet,
} from 'lucide-react';
import { get_public_landing_settings_live } from '../api/settings';
import { tx } from '../i18n';

const demoUrl = 'https://demo.ironwaves.store';
type LandingLang = 'az' | 'ru' | 'en';

const getNavItems = (lang: LandingLang) => [
  { label: tx(lang, 'Məhsul', 'Продукт', 'Product'), href: '#mehsul' },
  { label: tx(lang, 'Necə işləyir', 'Как работает', 'How it works'), href: '#nece-isleyir' },
  { label: tx(lang, 'Funksiyalar', 'Функции', 'Features'), href: '#funksiyalar' },
  { label: tx(lang, 'Sahələr', 'Сферы', 'Industries'), href: '#saheler' },
  { label: tx(lang, 'Əlaqə', 'Контакт', 'Contact'), href: '#demo' },
] as const;

const getTrustItems = (lang: LandingLang) => [
  { label: tx(lang, 'Masa xidməti', 'Обслуживание столов', 'Table service'), note: tx(lang, 'Raund məntiqi və owner lock ilə', 'С логикой раундов и owner lock', 'With round logic and owner lock') },
  { label: tx(lang, 'Mətbəx axını', 'Поток кухни', 'Kitchen flow'), note: tx(lang, 'KDS statusları və gecikmə görünüşü', 'Статусы KDS и видимость задержек', 'KDS statuses and delay visibility') },
  { label: tx(lang, 'Kassa nəzarəti', 'Контроль кассы', 'Cash control'), note: tx(lang, 'X / Z-Hesabat və uyğunlaşdırma ilə', 'С X / Z-отчётами и сверкой', 'With X / Z reports and reconciliation') },
  { label: tx(lang, 'Canlı dashboard', 'Живой dashboard', 'Live dashboard'), note: tx(lang, 'Alert, KPI və açıq hesab görünüşü', 'Alerts, KPI и открытые чеки', 'Alerts, KPI and open checks') },
];

const getProblems = (lang: LandingLang) => [
  tx(lang, 'Sifarişlər mətbəxə gedir, amma kim nəyi dəyişdiyini sonradan tapmaq olmur.', 'Заказы уходят на кухню, но потом непонятно, кто и что изменил.', 'Orders reach the kitchen, but later no one can clearly trace who changed what.'),
  tx(lang, 'Masalar dolur, amma hansı hesab açıqdır, hansı masa gecikir qarışır.', 'Столы заполняются, но открытые чеки и задержки начинают путаться.', 'Tables fill up, but open checks and delayed tables become hard to track.'),
  tx(lang, 'Kassa, depozit, investor və gündəlik xərc bir-birinə qarışır.', 'Касса, депозиты, инвестор и ежедневные расходы начинают смешиваться.', 'Cash, deposits, investor balance and daily expenses get mixed together.'),
  tx(lang, 'Menecer problemə gec çatır, çünki kritik xəbərdarlıq bir yerdə görünmür.', 'Менеджер узнаёт о проблеме поздно, потому что критические сигналы не собраны в одном месте.', 'Managers react late because critical alerts are not visible in one place.'),
];

const getSolutions = (lang: LandingLang) => [
  tx(lang, 'Masalar modulunda raund məntiqi, statuslu item axını və audit izi saxlanılır.', 'В модуле столов есть логика раундов, статусы позиций и audit trail.', 'Tables keep round logic, item statuses and a clear audit trail.'),
  tx(lang, 'KDS ekranında hazırlanan, hazır olan, ləğv tələb olunan və yenidən düzəldilən item-lər ayrı görünür.', 'В KDS отдельно видны готовящиеся, готовые, отменяемые и исправляемые позиции.', 'KDS clearly separates preparing, ready, cancel-requested and corrected items.'),
  tx(lang, 'Maliyyə nəzarət mərkəzində kassa, seyf, investor borcu, depozit və jurnal bir sistemdə işləyir.', 'В финансовом центре касса, сейф, долг инвестору, депозиты и журнал работают в одной системе.', 'The finance control center keeps cash, safe, investor liability, deposits and journal in one system.'),
  tx(lang, 'Dashboard menecerə açıq check, kitchen load, cash fərqi və anomaliyaları bir baxışda göstərir.', 'Dashboard показывает менеджеру открытые чеки, нагрузку кухни, кассовую разницу и аномалии в одном взгляде.', 'The dashboard shows open checks, kitchen load, cash variance and anomalies at a glance.'),
];

const getModules = (lang: LandingLang) => [
  { icon: CreditCard, title: 'POS', text: tx(lang, 'Sürətli satış, split ödəniş, çek axını və kassir üçün touch-first iş masası.', 'Быстрые продажи, split-оплата, чековый поток и touch-first рабочее место для кассира.', 'Fast sales, split payments, receipt flow and a touch-first cashier workspace.') },
  { icon: Table2, title: tx(lang, 'Masalar', 'Столы', 'Tables'), text: tx(lang, 'Masa açılışı, raund göndərişi, servis izləmə, hesab bağlama və təmizlik axını.', 'Открытие стола, отправка раундов, контроль сервиса, закрытие счёта и уборка.', 'Table opening, round sending, service tracking, bill closing and cleaning flow.') },
  { icon: ChefHat, title: tx(lang, 'Mətbəx ekranı', 'Экран кухни', 'Kitchen display'), text: tx(lang, 'SENT, hazırlanır, hazırdır, servis edildi və düzəliş statusları bir axında görünür.', 'Статусы SENT, готовится, готово, выдано и исправления видны в одном потоке.', 'SENT, preparing, ready, served and correction statuses are visible in one flow.') },
  { icon: Wallet, title: tx(lang, 'Maliyyə', 'Финансы', 'Finance'), text: tx(lang, 'Mədaxil, xərc, transfer, investor borcu, depozit, uyğunlaşdırma və maliyyə jurnalı bir mərkəzdədir.', 'Приход, расход, перевод, долг инвестору, депозиты, сверка и финансовый журнал в одном центре.', 'Income, expense, transfers, investor liability, deposits, reconciliation and journal in one center.') },
  { icon: LayoutDashboard, title: 'Dashboard', text: tx(lang, 'Kritik xəbərdarlıqlar, KPI-lar, açıq hesablar və canlı əməliyyat görünüşü.', 'Критические alerts, KPI, открытые чеки и живой операционный обзор.', 'Critical alerts, KPI, open checks and a live operations view.') },
  { icon: ChartColumnBig, title: tx(lang, 'Analitika', 'Аналитика', 'Analytics'), text: tx(lang, 'Satış ritmi, top məhsullar, orta çek və qərar üçün lazım olan rəqəmlər.', 'Ритм продаж, топ-позиции, средний чек и цифры для принятия решений.', 'Sales rhythm, top items, average ticket and numbers for decisions.') },
  { icon: Receipt, title: 'Z-Hesabat / X-Hesabat', text: tx(lang, 'Növbə açılışı, sayılmış kassa, fərq və gündəlik bağlanış nəzarəti.', 'Открытие смены, пересчёт кассы, разница и контроль ежедневного закрытия.', 'Shift opening, counted till, variance and daily closing control.') },
  { icon: Users, title: tx(lang, 'CRM / Loyallıq', 'CRM / Лояльность', 'CRM / Loyalty'), text: tx(lang, 'Müştəri bazası, bonuslar, cashback, kampaniyalar və daimi qonaq axını eyni sistemdədir.', 'Клиентская база, бонусы, cashback, кампании и поток постоянных гостей в одной системе.', 'Customer base, bonuses, cashback, campaigns and repeat guests in one system.') },
  { icon: QrCode, title: 'QR Menu / Customer App', text: tx(lang, 'QR menu, mobil baxış, məhsul şəkilləri, qısa təsvirlər və müştəri üçün self-service təcrübəsi verir.', 'QR-меню, мобильный просмотр, фото товаров, короткие описания и self-service для гостя.', 'QR menu, mobile browsing, product images, short descriptions and self-service for guests.') },
  { icon: ClipboardList, title: tx(lang, 'Loglar və audit', 'Логи и аудит', 'Logs and audit'), text: tx(lang, 'Kim nə etdi, nə vaxt etdi və hansı status dəyişdi sualları cavabsız qalmır.', 'Вопросы кто, когда и что изменил не остаются без ответа.', 'Questions like who changed what and when never go unanswered.') },
];

const getFlow = (lang: LandingLang) => [
  { step: '1', title: tx(lang, 'Satışı və ya masanı açın', 'Откройте продажу или стол', 'Open a sale or a table'), text: tx(lang, 'Al-apar müştəri üçün POS, masa qonağı üçün Masalar modulunda açıq check axını başlayır.', 'Для takeaway используется POS, для гостя за столом стартует открытый чек в модуле столов.', 'Use POS for takeaway or open a table check for seated guests.') },
  { step: '2', title: tx(lang, 'Sifarişi raund kimi göndərin', 'Отправьте заказ раундом', 'Send the order as a round'), text: tx(lang, 'Göndərilməmiş item-lər mətbəxə ayrıca raund kimi gedir və əvvəlki sifarişlərdən ayrılır.', 'Неотправленные позиции уходят на кухню отдельным раундом и не смешиваются с предыдущими.', 'Unsent items go to the kitchen as a new round and stay separate from previous orders.') },
  { step: '3', title: tx(lang, 'Hazır məhsulu və hesabı idarə edin', 'Управляйте готовыми позициями и счётом', 'Manage ready items and the bill'), text: tx(lang, 'KDS statusları, servis xətti, düzəliş, ləğv, hesabdan sil və israf nəzarətli qaydada işləyir.', 'Статусы KDS, сервисная линия, исправления, отмены, comp и waste работают под контролем.', 'KDS statuses, service flow, corrections, cancel, comp and waste stay controlled.') },
  { step: '4', title: tx(lang, 'Dashboard və maliyyədən nəzarəti tamamlayın', 'Закройте контроль через dashboard и финансы', 'Close the loop with dashboard and finance'), text: tx(lang, 'Menecer kassa fərqini, kitchen delay-i, açıq check-ləri və maliyyə jurnalını bir platformadan izləyir.', 'Менеджер отслеживает кассовую разницу, задержки кухни, открытые чеки и финансовый журнал из одной платформы.', 'Managers track cash variance, kitchen delays, open checks and the finance journal from one platform.') },
];

const getIndustries = (lang: LandingLang) => [
  tx(lang, 'Restoran', 'Ресторан', 'Restaurant'),
  tx(lang, 'Coffee shop', 'Кофейня', 'Coffee shop'),
  tx(lang, 'Fast food', 'Фастфуд', 'Fast food'),
  tx(lang, 'Dönər', 'Донер', 'Doner'),
  tx(lang, 'Retail', 'Ритейл', 'Retail'),
  tx(lang, 'Food court', 'Фуд-корт', 'Food court'),
];

const getWhyItems = (lang: LandingLang) => [
  tx(lang, 'Bir platformada tam nəzarət: POS, masa, mətbəx, maliyyə və CRM ayrı-ayrı sistemlərə bölünmür.', 'Полный контроль в одной платформе: POS, столы, кухня, финансы и CRM не разбросаны по разным системам.', 'Full control in one platform: POS, tables, kitchen, finance and CRM are not split across separate systems.'),
  tx(lang, 'Audit izi və loglar: mətbəxə gedən item izsiz silinmir, status həyat dövrü saxlanılır.', 'Audit trail и логи: позиция, ушедшая на кухню, не исчезает бесследно, жизненный цикл статуса сохраняется.', 'Audit trail and logs: items sent to kitchen never disappear without a trace, and status lifecycle is preserved.'),
  tx(lang, 'Depozit və öhdəlik məntiqi: masa depoziti, investor borcu və daxili transferlər qarışmır.', 'Логика депозитов и обязательств: депозит стола, долг инвестору и внутренние переводы не смешиваются.', 'Deposit and liability logic keeps table deposits, investor debt and internal transfers from getting mixed up.'),
  tx(lang, 'Masa və mətbəx üçün uyğun axın: restoran ritminə uyğun raund, servis və KDS məntiqi qurulub.', 'Поток под столы и кухню: логика раундов, сервиса и KDS настроена под реальный ритм ресторана.', 'Table and kitchen flows are built around real restaurant rounds, service and KDS logic.'),
  tx(lang, 'Menecer üçün real dashboard: kritik alert, KPI və açıq əməliyyatlar qərar verməyə kömək edir.', 'Реальный dashboard для менеджера: критические сигналы, KPI и открытые операции помогают принимать решения.', 'A real manager dashboard with critical alerts, KPI and open operations supports decision making.'),
  tx(lang, 'Azərbaycan bazarına uyğun dil və axın: terminologiya yerli iş prosesinə uyğunlaşdırılıb.', 'Локализованный язык и поток: терминология адаптирована под местный рынок и процессы.', 'Localized language and flows are adapted to the Azerbaijani market and operations.'),
];

function SectionIntro({ eyebrow, title, body, align = 'left' }: { eyebrow: string; title: string; body: string; align?: 'left' | 'center' }) {
  return (
    <div className={align === 'center' ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'}>
      <div className="text-xs font-black uppercase tracking-[0.28em] text-sky-700">{eyebrow}</div>
      <h2 className="mt-4 text-3xl font-black leading-tight text-slate-950 md:text-5xl">{title}</h2>
      <p className="mt-4 text-base leading-8 text-slate-600 md:text-lg">{body}</p>
    </div>
  );
}

function SurfaceCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[30px] border border-slate-200/80 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.07)] ${className}`}>
      {children}
    </div>
  );
}

function ProductPreview({ lang, previewIndex }: { lang: LandingLang; previewIndex: number }) {
  const slides = [
    {
      key: 'tables',
      eyebrow: tx(lang, 'Masalar', 'Столы', 'Tables'),
      title: tx(lang, 'Masa axını nəzarətdədir', 'Поток столов под контролем', 'Table flow stays under control'),
      visual: (
        <div className="grid h-full grid-cols-2 gap-3">
          {[
            [tx(lang, 'Masa 1', 'Стол 1', 'Table 1'), tx(lang, 'Aktiv check', 'Активный чек', 'Active check'), 'bg-violet-500/20 text-violet-200'],
            [tx(lang, 'Masa 2', 'Стол 2', 'Table 2'), tx(lang, 'Boş', 'Свободен', 'Available'), 'bg-emerald-500/20 text-emerald-200'],
            [tx(lang, 'Masa 4', 'Стол 4', 'Table 4'), tx(lang, 'Rezerv', 'Резерв', 'Reserved'), 'bg-amber-500/20 text-amber-200'],
            [tx(lang, 'Masa 6', 'Стол 6', 'Table 6'), tx(lang, 'Servisə hazır', 'Готово к подаче', 'Ready to serve'), 'bg-rose-500/20 text-rose-200'],
          ].map(([label, status, tone]) => (
            <div key={String(label)} className="rounded-2xl border border-white/8 bg-[#131d2e] p-3">
              <div className="text-sm font-black text-white">{label}</div>
              <div className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${tone}`}>{status}</div>
            </div>
          ))}
        </div>
      ),
    },
    {
      key: 'dashboard',
      eyebrow: 'Dashboard',
      title: tx(lang, 'Kritik vəziyyət dərhal görünür', 'Критическая ситуация видна сразу', 'Critical issues become visible instantly'),
      visual: <img src="/landing/pos-screen.png" alt="POS" className="h-full w-full rounded-[22px] object-cover object-top" />,
    },
    {
      key: 'finance',
      eyebrow: tx(lang, 'Maliyyə', 'Финансы', 'Finance'),
      title: tx(lang, 'Kassa və öhdəliklər qarışmır', 'Касса и обязательства не смешиваются', 'Cash and liabilities stay separated'),
      visual: <img src="/landing/finance-screen.png" alt="Finance" className="h-full w-full rounded-[22px] object-cover object-top" />,
    },
    {
      key: 'customer',
      eyebrow: 'CRM / QR Menu',
      title: tx(lang, 'Müştəri axını da eyni sistemdədir', 'Клиентский поток тоже в одной системе', 'Customer flow also lives in one system'),
      visual: (
        <div className="grid h-full gap-3 md:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[22px] border border-white/8 bg-[#131d2e] p-4">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{tx(lang, 'CRM / Loyallıq', 'CRM / Лояльность', 'CRM / Loyalty')}</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[
                [tx(lang, 'Aktiv kartlar', 'Активные карты', 'Active cards'), '428'],
                [tx(lang, 'Bonus balansı', 'Бонусный баланс', 'Bonus balance'), '1,180 ₼'],
                [tx(lang, 'Kampaniya', 'Кампания', 'Campaign'), tx(lang, '2 aktiv', '2 активные', '2 active')],
                [tx(lang, 'Qayıdan müştəri', 'Возвращающийся клиент', 'Returning customers'), '61%'],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border border-white/8 bg-[#0f1726] p-3">
                  <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</div>
                  <div className="mt-2 text-sm font-black text-white">{value}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-[22px] border border-white/8 bg-[#131d2e] p-4">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">QR Menu</div>
                <QrCode size={18} className="text-violet-300" />
              </div>
              <div className="mt-3 rounded-[18px] border border-white/8 bg-[#0f1726] p-3">
                <div className="h-24 rounded-2xl bg-[linear-gradient(135deg,#1d4ed8,#0f172a)]" />
                <div className="mt-3 text-sm font-black text-white">{tx(lang, 'Amerikano', 'Американо', 'Americano')}</div>
              </div>
            </div>
            <div className="rounded-[22px] border border-white/8 bg-[#131d2e] p-4">
              <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Customer App</div>
              <div className="mt-3 space-y-2">
                {[tx(lang, 'Bonus görünür', 'Бонус виден', 'Bonuses stay visible'), tx(lang, 'Şəxsi təkliflər', 'Персональные предложения', 'Personal offers'), tx(lang, 'Təkrar satış', 'Повторная продажа', 'Repeat sales')].map((item) => (
                  <div key={item} className="rounded-xl border border-white/8 bg-[#0f1726] px-3 py-2.5 text-sm font-black text-white">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="relative mx-auto w-full max-w-[720px]">
      <div className="absolute -left-10 top-10 h-48 w-48 rounded-full bg-sky-200/70 blur-3xl" />
      <div className="absolute right-0 top-0 h-56 w-56 rounded-full bg-indigo-200/70 blur-3xl" />
      <div className="absolute bottom-4 left-16 h-40 w-40 rounded-full bg-amber-200/70 blur-3xl" />

      <div className="relative rounded-[38px] border border-slate-200/80 bg-white/80 p-3 shadow-[0_30px_90px_rgba(15,23,42,0.10)] backdrop-blur">
        <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-[#0d1420] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <div className="flex items-center justify-between border-b border-white/8 bg-[#111a29] px-5 py-4">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.3em] text-cyan-300">iRonWaves POS</div>
              <div className="mt-1 text-sm font-semibold text-white">{tx(lang, 'İdarəetmə platforması', 'Платформа управления', 'Management platform')}</div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-200">
              <span className="h-2 w-2 rounded-full bg-emerald-300" />
              {tx(lang, 'Canlı nəzarət', 'Живой контроль', 'Live control')}
            </div>
          </div>

          <div className="space-y-4 bg-[radial-gradient(circle_at_top,#172132_0%,#0c1320_65%)] p-4">
            <div className="grid gap-3 md:grid-cols-[0.88fr_1.12fr]">
              <div className="rounded-[24px] border border-white/8 bg-white/5 p-4">
                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-cyan-300">{slides[previewIndex].eyebrow}</div>
                <div className="mt-2 text-xl font-black text-white">{slides[previewIndex].title}</div>
                <div className="mt-4 flex gap-2">
                  {slides.map((slide, index) => (
                    <button
                      key={slide.key}
                      type="button"
                      aria-label={slide.title}
                      className={`h-2.5 flex-1 rounded-full transition ${index === previewIndex ? 'bg-cyan-300' : 'bg-white/15'}`}
                    />
                  ))}
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  {[
                    tx(lang, 'POS', 'POS', 'POS'),
                    tx(lang, 'Masalar', 'Столы', 'Tables'),
                    tx(lang, 'Maliyyə', 'Финансы', 'Finance'),
                    'CRM / QR',
                  ].map((item, index) => (
                    <div
                      key={item}
                      className={`rounded-2xl border px-3 py-3 text-sm font-black transition ${index === previewIndex ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100' : 'border-white/8 bg-[#131d2e] text-slate-300'}`}
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>
              <div className="relative min-h-[360px] overflow-hidden rounded-[24px] border border-white/8 bg-[#111a29]">
                {slides.map((slide, index) => (
                  <div
                    key={slide.key}
                    className={`absolute inset-0 p-4 transition-all duration-700 ${index === previewIndex ? 'translate-x-0 opacity-100' : index < previewIndex ? '-translate-x-6 opacity-0' : 'translate-x-6 opacity-0'}`}
                  >
                    {slide.visual}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScreenCard({
  title,
  body,
  image,
  mock,
}: {
  title: string;
  body: string;
  image?: string;
  mock?: React.ReactNode;
}) {
  return (
    <SurfaceCard className="overflow-hidden">
      <div className="bg-[linear-gradient(180deg,#eff6ff,#f8fafc)] p-4">
        <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
          {image ? (
            <img src={image} alt={title} className="h-72 w-full object-cover object-top" />
          ) : (
            <div className="h-72 w-full bg-[#0d1420] p-4">{mock}</div>
          )}
        </div>
      </div>
      <div className="p-6">
        <h3 className="text-2xl font-black text-slate-950">{title}</h3>
        <p className="mt-3 text-sm leading-7 text-slate-600">{body}</p>
      </div>
    </SurfaceCard>
  );
}

function TablesMock({ lang }: { lang: LandingLang }) {
  return (
    <div className="grid h-full grid-cols-2 gap-3">
      {[
        [tx(lang, 'Masa 1', 'Стол 1', 'Table 1'), tx(lang, 'Aktiv check', 'Активный чек', 'Active check'), 'bg-violet-500/20 text-violet-200'],
        [tx(lang, 'Masa 2', 'Стол 2', 'Table 2'), tx(lang, 'Boş', 'Свободен', 'Available'), 'bg-emerald-500/20 text-emerald-200'],
        [tx(lang, 'Masa 3', 'Стол 3', 'Table 3'), tx(lang, 'Rezerv', 'Резерв', 'Reserved'), 'bg-amber-500/20 text-amber-200'],
        [tx(lang, 'Masa 4', 'Стол 4', 'Table 4'), tx(lang, 'Servisə hazır', 'Готово к подаче', 'Ready to serve'), 'bg-rose-500/20 text-rose-200'],
      ].map(([label, status, tone]) => (
        <div key={label} className="rounded-[22px] border border-white/8 bg-[#121c2d] p-4">
          <div className="text-base font-black text-white">{label}</div>
          <div className={`mt-3 inline-flex rounded-full px-3 py-1.5 text-xs font-bold ${tone}`}>{status}</div>
        </div>
      ))}
    </div>
  );
}

function DashboardMock({ lang }: { lang: LandingLang }) {
  return (
    <div className="grid h-full gap-3">
      <div className="grid grid-cols-3 gap-3">
        {[
          [tx(lang, 'Bu gün satış', 'Продажи сегодня', 'Sales today'), '4,280 ₼'],
          [tx(lang, 'Açıq check', 'Открытые чеки', 'Open checks'), '7'],
          [tx(lang, 'Mətbəx yükü', 'Нагрузка кухни', 'Kitchen load'), '68%'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[20px] border border-white/8 bg-[#121c2d] p-3">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</div>
            <div className="mt-2 text-xl font-black text-white">{value}</div>
          </div>
        ))}
      </div>
      <div className="grid flex-1 gap-3 md:grid-cols-[1fr_0.9fr]">
        <div className="rounded-[22px] border border-white/8 bg-[#121c2d] p-3">
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{tx(lang, 'Canlı satışlar', 'Живые продажи', 'Live sales')}</div>
          <div className="mt-3 space-y-2">
            {['Amerikano — 6.00 ₼', 'Dönər — 7.00 ₼', 'Ayran — 2.00 ₼'].map((row) => (
              <div key={row} className="rounded-xl border border-white/8 bg-[#0f1726] px-3 py-2 text-sm text-slate-200">{row}</div>
            ))}
          </div>
        </div>
        <div className="rounded-[22px] border border-white/8 bg-[#121c2d] p-3">
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{tx(lang, 'Xəbərdarlıqlar', 'Сигналы', 'Alerts')}</div>
          <div className="mt-3 space-y-2">
            {[tx(lang, 'Kassa fərqi', 'Разница по кассе', 'Cash variance'), tx(lang, 'Mətbəx gecikməsi', 'Задержка кухни', 'Kitchen delay'), tx(lang, 'Təsdiq gözləyir', 'Ожидает подтверждения', 'Pending approval')].map((row, idx) => (
              <div key={row} className={`rounded-xl px-3 py-2 text-sm font-semibold ${idx === 0 ? 'bg-rose-500/15 text-rose-200' : idx === 1 ? 'bg-amber-500/15 text-amber-200' : 'bg-sky-500/15 text-sky-200'}`}>{row}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function KdsMock({ lang }: { lang: LandingLang }) {
  return (
    <div className="grid h-full gap-3 md:grid-cols-3">
      {[
        [tx(lang, 'Yeni', 'Новый', 'New'), `${tx(lang, 'Masa', 'Стол', 'Table')} 2 · ${tx(lang, 'Raund', 'Раунд', 'Round')} 1`, tx(lang, '2 dönər, 1 ayran', '2 донера, 1 айран', '2 doners, 1 ayran')],
        [tx(lang, 'Hazırlanır', 'Готовится', 'Preparing'), `${tx(lang, 'Masa', 'Стол', 'Table')} 4 · ${tx(lang, 'Raund', 'Раунд', 'Round')} 2`, tx(lang, '1 burger, 1 kartof', '1 бургер, 1 картофель', '1 burger, 1 fries')],
        [tx(lang, 'Hazırdır', 'Готово', 'Ready'), `${tx(lang, 'Masa', 'Стол', 'Table')} 1 · ${tx(lang, 'Raund', 'Раунд', 'Round')} 3`, '2 latte'],
      ].map(([title, subtitle, items], idx) => (
        <div key={title} className="rounded-[22px] border border-white/8 bg-[#121c2d] p-3">
          <div className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${idx === 0 ? 'bg-sky-500/15 text-sky-200' : idx === 1 ? 'bg-amber-500/15 text-amber-200' : 'bg-emerald-500/15 text-emerald-200'}`}>{title}</div>
          <div className="mt-3 text-sm font-black text-white">{subtitle}</div>
          <div className="mt-2 text-sm text-slate-300">{items}</div>
        </div>
      ))}
    </div>
  );
}

function PlatformOpsMock({ lang }: { lang: LandingLang }) {
  return (
    <div className="grid h-full gap-3 md:grid-cols-[1.05fr_0.95fr]">
      <div className="space-y-3">
        <div className="rounded-[22px] border border-white/8 bg-[#121c2d] p-4">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{tx(lang, 'Maliyyə', 'Финансы', 'Finance')}</div>
            <Wallet size={18} className="text-emerald-300" />
          </div>
          <div className="mt-3 grid gap-2">
            {[
              [tx(lang, 'Nağd kassa', 'Касса', 'Cash on hand'), '1,245 ₼'],
              [tx(lang, 'Bank / Kart', 'Банк / Карта', 'Bank / Card'), '2,410 ₼'],
              [tx(lang, 'Aktiv depozit', 'Активный депозит', 'Active deposit'), '85 ₼'],
              [tx(lang, 'Investor borcu', 'Долг инвестору', 'Investor liability'), '300 ₼'],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-xl border border-white/8 bg-[#0f1726] px-3 py-2.5">
                <span className="text-sm text-slate-300">{label}</span>
                <span className="text-sm font-black text-white">{value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[22px] border border-white/8 bg-[#121c2d] p-4">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{tx(lang, 'CRM / Loyallıq', 'CRM / Лояльность', 'CRM / Loyalty')}</div>
            <Users size={18} className="text-sky-300" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {[
              [tx(lang, 'Aktiv kartlar', 'Активные карты', 'Active cards'), '428'],
              [tx(lang, 'Bonus balansı', 'Бонусный баланс', 'Bonus balance'), '1,180 ₼'],
              [tx(lang, 'Kampaniya', 'Кампания', 'Campaign'), tx(lang, '2 aktiv', '2 активные', '2 active')],
              [tx(lang, 'Qayıdan müştəri', 'Возвращающийся клиент', 'Returning customers'), '61%'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-white/8 bg-[#0f1726] p-3">
                <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">{label}</div>
                <div className="mt-2 text-sm font-black text-white">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <div className="rounded-[22px] border border-white/8 bg-[#121c2d] p-4">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">QR Menu</div>
            <QrCode size={18} className="text-violet-300" />
          </div>
          <div className="mt-3 rounded-[18px] border border-white/8 bg-[#0f1726] p-3">
            <div className="h-24 rounded-2xl bg-[linear-gradient(135deg,#1d4ed8,#0f172a)]" />
            <div className="mt-3 text-sm font-black text-white">{tx(lang, 'Amerikano', 'Американо', 'Americano')}</div>
            <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Qısa təsvir, şəkil və qiymət müştəriyə telefonunda görünür.', 'Краткое описание, фото и цена видны гостю в телефоне.', 'A short description, image and price are visible on the customer’s phone.')}</div>
          </div>
        </div>
        <div className="rounded-[22px] border border-white/8 bg-[#121c2d] p-4">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Customer App</div>
            <Store size={18} className="text-amber-300" />
          </div>
          <div className="mt-3 space-y-2">
            {[
              [tx(lang, 'Bonus görünür', 'Бонус виден', 'Bonuses stay visible'), tx(lang, 'Cashback və balans', 'Cashback и баланс', 'Cashback and balance')],
              [tx(lang, 'Təkliflər', 'Предложения', 'Offers'), tx(lang, 'Şəxsi kampaniya axını', 'Персональные кампании', 'Personal campaign flow')],
              [tx(lang, 'Təkrar satış', 'Повторная продажа', 'Repeat sales'), tx(lang, 'Qonaq geri qayıdır', 'Гость возвращается', 'Guests come back')],
            ].map(([title, note]) => (
              <div key={title} className="rounded-xl border border-white/8 bg-[#0f1726] px-3 py-2.5">
                <div className="text-sm font-black text-white">{title}</div>
                <div className="text-xs text-slate-400">{note}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [lang, setLang] = React.useState<LandingLang>('az');
  const [landingSettings, setLandingSettings] = React.useState<any>(null);
  const [form, setForm] = React.useState({
    fullName: '',
    businessName: '',
    phone: '',
    businessType: 'restoran',
    note: '',
  });
  const [previewIndex, setPreviewIndex] = React.useState(0);

  React.useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await get_public_landing_settings_live();
        if (mounted) setLandingSettings(data || null);
      } catch {
        // local baked copy is enough
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setPreviewIndex((value) => (value + 1) % 4);
    }, 2600);
    return () => window.clearInterval(timer);
  }, []);

  const navItems = React.useMemo(() => getNavItems(lang), [lang]);
  const trustItems = React.useMemo(() => getTrustItems(lang), [lang]);
  const problems = React.useMemo(() => getProblems(lang), [lang]);
  const solutions = React.useMemo(() => getSolutions(lang), [lang]);
  const modules = React.useMemo(() => getModules(lang), [lang]);
  const flow = React.useMemo(() => getFlow(lang), [lang]);
  const industries = React.useMemo(() => getIndustries(lang), [lang]);
  const whyItems = React.useMemo(() => getWhyItems(lang), [lang]);

  const heroTitle =
    (lang === 'ru' ? landingSettings?.hero_title_ru : lang === 'en' ? landingSettings?.hero_title_en : landingSettings?.hero_title_az) ||
    tx(lang, 'Restoranınızı bir platformadan idarə edin', 'Управляйте рестораном из одной платформы', 'Run your restaurant from one platform');
  const heroBody =
    (lang === 'ru' ? landingSettings?.hero_body_ru : lang === 'en' ? landingSettings?.hero_body_en : landingSettings?.hero_body_az) ||
    tx(
      lang,
      'POS, masalar, mətbəx, maliyyə, dashboard, CRM, Customer App və analitika bir sistemdə işləsin. Sifariş itirmədən, kassa nəzarətini itirmədən, gündəlik əməliyyatı bir ekrandan idarə edin.',
      'Пусть POS, столы, кухня, финансы, dashboard, CRM, Customer App и аналитика работают в одной системе. Управляйте ежедневной операцией без потери заказов и без потери кассового контроля.',
      'Let POS, tables, kitchen, finance, dashboard, CRM, Customer App and analytics run in one system. Manage daily operations without losing orders or cash control.',
    );
  const primaryCta = tx(lang, 'Demoya keç', 'Перейти к демо', 'Open demo');
  const contactEmail = 'abbas@laptopmarket.az';
  const contactPhone = '+99455 299-92-82';
  const contactWhatsapp = landingSettings?.contact_whatsapp || '';

  const demoMessage = React.useMemo(() => {
    return [
      tx(lang, 'Əlaqə sorğusu', 'Запрос на связь', 'Contact request'),
      `${tx(lang, 'Ad', 'Имя', 'Name')}: ${form.fullName || '-'}`,
      `${tx(lang, 'Biznes adı', 'Название бизнеса', 'Business name')}: ${form.businessName || '-'}`,
      `${tx(lang, 'Telefon', 'Телефон', 'Phone')}: ${form.phone || '-'}`,
      `${tx(lang, 'Obyekt növü', 'Тип объекта', 'Business type')}: ${form.businessType || '-'}`,
      `${tx(lang, 'Qeyd', 'Комментарий', 'Note')}: ${form.note || '-'}`,
    ].join('\n');
  }, [form, lang]);

  const handleDemoRequest = (event: React.FormEvent) => {
    event.preventDefault();
    const whatsappDigits = String(contactWhatsapp || '').replace(/\D/g, '');
    if (whatsappDigits) {
      window.open(`https://wa.me/${whatsappDigits}?text=${encodeURIComponent(demoMessage)}`, '_blank');
      return;
    }
    window.location.href = `mailto:${contactEmail}?subject=${encodeURIComponent(tx(lang, 'iRonWaves POS əlaqə sorğusu', 'Запрос по iRonWaves POS', 'iRonWaves POS contact request'))}&body=${encodeURIComponent(demoMessage)}`;
  };

  return (
    <div className="h-[100dvh] overflow-y-auto overscroll-y-contain bg-[#f7f9fc] text-slate-900">
      <div className="relative min-h-full overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_20%),radial-gradient(circle_at_80%_10%,rgba(99,102,241,0.12),transparent_24%),linear-gradient(180deg,#ffffff_0%,#f7f9fc_44%,#edf3ff_100%)]" />

        <div className="relative mx-auto max-w-7xl px-6 md:px-10 xl:px-14">
          <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/88 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4 py-5">
              <div className="flex items-center gap-3">
                <img
                  src="/landing/ironwaves-logo.jpeg"
                  alt="iRonWaves POS"
                  className="h-14 w-14 rounded-[18px] object-cover shadow-[0_18px_40px_rgba(15,23,42,0.16)]"
                />
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.28em] text-sky-700">iRonWaves POS</div>
                  <div className="text-lg font-black text-slate-950 md:text-xl">Restoran idarəetmə platforması</div>
                </div>
              </div>

              <nav className="hidden items-center gap-6 text-sm font-semibold text-slate-600 lg:flex">
                {navItems.map((item) => (
                  <a key={item.label} href={item.href} className="transition hover:text-sky-700">
                    {item.label}
                  </a>
                ))}
              </nav>

              <div className="flex items-center gap-2">
                <div className="hidden rounded-2xl border border-slate-200 bg-white p-1 md:flex">
                  {(['az', 'ru', 'en'] as LandingLang[]).map((option) => (
                    <button
                      key={option}
                      onClick={() => setLang(option)}
                      className={`min-h-10 rounded-xl px-3 text-xs font-black uppercase ${lang === option ? 'bg-slate-950 text-white' : 'text-slate-600'}`}
                    >
                      {option.toUpperCase()}
                    </button>
                  ))}
                </div>
                <a
                  href={demoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#0f172a,#1e293b)] px-5 py-3 text-sm font-bold text-white shadow-[0_16px_34px_rgba(15,23,42,0.18)] transition hover:translate-y-[-1px]"
                >
                  {primaryCta}
                </a>
              </div>
            </div>
          </header>

          <section className="grid gap-12 pb-16 pt-10 lg:grid-cols-[0.88fr_1.12fr] lg:items-center lg:pt-16">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-xs font-black uppercase tracking-[0.28em] text-sky-700">
                <ShieldCheck size={14} />
                {tx(lang, 'Bir platformada tam nəzarət', 'Полный контроль в одной платформе', 'Full control in one platform')}
              </div>

              <h1 className="mt-8 text-5xl font-black leading-[0.98] text-slate-950 md:text-7xl">{heroTitle}</h1>
              <p className="mt-6 max-w-xl text-base leading-8 text-slate-600 md:text-lg">{heroBody}</p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href={demoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#0f172a,#1e293b)] px-7 py-3 text-base font-bold text-white shadow-[0_18px_36px_rgba(15,23,42,0.18)] transition hover:translate-y-[-1px]"
                >
                  {primaryCta}
                </a>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {[
                  [tx(lang, 'Sifariş itmir', 'Заказ не теряется', 'Orders do not get lost'), tx(lang, 'Raund məntiqi və mətbəx statusları ilə', 'С логикой раундов и статусами кухни', 'With round logic and kitchen statuses')],
                  [tx(lang, 'Kassa nəzarəti itmir', 'Контроль кассы не теряется', 'Cash control stays visible'), tx(lang, 'Maliyyə, uyğunlaşdırma və jurnal bir yerdə', 'Финансы, сверка и журнал в одном месте', 'Finance, reconciliation and journal in one place')],
                ].map(([title, note]) => (
                  <div key={title} className="rounded-[24px] border border-slate-200/80 bg-white/85 p-4 shadow-[0_16px_38px_rgba(15,23,42,0.05)]">
                    <div className="text-sm font-black text-slate-950">{title}</div>
                    <div className="mt-2 text-sm leading-6 text-slate-600">{note}</div>
                  </div>
                ))}
              </div>
            </div>

            <ProductPreview lang={lang} previewIndex={previewIndex} />
          </section>

          <section className="grid gap-4 pb-20 md:grid-cols-2 xl:grid-cols-4">
            {trustItems.map((item) => (
              <SurfaceCard key={item.label} className="p-6">
                <div className="text-lg font-black text-slate-950">{item.label}</div>
                <div className="mt-3 text-sm leading-7 text-slate-600">{item.note}</div>
              </SurfaceCard>
            ))}
          </section>

          <section id="mehsul" className="pb-20">
            <div className="grid gap-8 lg:grid-cols-2">
              <SurfaceCard className="overflow-hidden bg-[linear-gradient(180deg,#0f172a,#111827)] p-8 text-white">
                <div className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">{tx(lang, 'Problem', 'Проблема', 'Problem')}</div>
                <h2 className="mt-4 text-3xl font-black md:text-5xl">{tx(lang, 'Restoran içində ən çox qarışan hissələr', 'Что чаще всего ломается внутри ресторана', 'What usually breaks inside restaurant operations')}</h2>
                <div className="mt-8 space-y-4">
                  {problems.map((item) => (
                    <div key={item} className="rounded-[22px] border border-white/10 bg-white/6 p-4 text-sm leading-7 text-slate-200">
                      {item}
                    </div>
                  ))}
                </div>
              </SurfaceCard>

              <SurfaceCard className="p-8">
                <div className="text-xs font-black uppercase tracking-[0.28em] text-sky-700">{tx(lang, 'Həll', 'Решение', 'Solution')}</div>
                <h2 className="mt-4 text-3xl font-black text-slate-950 md:text-5xl">{tx(lang, 'iRonWaves bunları bir axına çevirir', 'iRonWaves превращает это в единый поток', 'iRonWaves turns this into one clear flow')}</h2>
                <div className="mt-8 space-y-4">
                  {solutions.map((item) => (
                    <div key={item} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-700">
                      {item}
                    </div>
                  ))}
                </div>
              </SurfaceCard>
            </div>
          </section>

          <section id="funksiyalar" className="pb-20">
            <SectionIntro
              eyebrow={tx(lang, 'Əsas modullar', 'Основные модули', 'Core modules')}
              title={tx(lang, 'Tək POS yox, tam idarəetmə platforması', 'Не просто POS, а полная платформа управления', 'Not just POS, but a full management platform')}
              body={tx(lang, 'Sistem restoran sahibinin, menecerin, kassirin və mətbəxin gündəlik ritmini eyni platformada birləşdirir.', 'Система объединяет ежедневный ритм владельца, менеджера, кассира и кухни в одной платформе.', 'The system brings owners, managers, cashiers and kitchen teams into one daily operating platform.')}
            />

            <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {modules.map((item) => (
                <SurfaceCard key={item.title} className="p-6">
                  <div className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-[linear-gradient(180deg,#e0f2fe,#dbeafe)] text-sky-800">
                    <item.icon size={24} />
                  </div>
                  <h3 className="mt-5 text-2xl font-black text-slate-950">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{item.text}</p>
                </SurfaceCard>
              ))}
            </div>
          </section>

          <section id="nece-isleyir" className="pb-20">
            <SectionIntro
              eyebrow={tx(lang, 'Necə işləyir', 'Как работает', 'How it works')}
              title={tx(lang, 'Əməliyyat axını aydın, sürətli və nəzarətlidir', 'Операционный поток ясен, быстр и контролируем', 'Operations stay clear, fast and controlled')}
              body={tx(lang, 'Sistem restoranı qarışıq ekrandan yox, mərhələli və iz buraxan iş axınından idarə etməyə kömək edir.', 'Система помогает управлять рестораном не через перегруженный экран, а через поэтапный и отслеживаемый поток.', 'The system helps run a restaurant through structured, traceable workflows instead of overloaded screens.')}
              align="center"
            />

            <div className="mt-10 grid gap-5 lg:grid-cols-4">
              {flow.map((item) => (
                <SurfaceCard key={item.step} className="p-6">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-950 text-xl font-black text-white">
                    {item.step}
                  </div>
                  <h3 className="mt-5 text-2xl font-black text-slate-950">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{item.text}</p>
                </SurfaceCard>
              ))}
            </div>
          </section>

          <section className="pb-20">
            <SectionIntro
              eyebrow={tx(lang, 'Ekranlar', 'Экраны', 'Screens')}
              title={tx(lang, 'Komandanın hər rolu üçün ayrıca iş sahəsi', 'Отдельное рабочее пространство для каждой роли', 'A dedicated workspace for each team role')}
              body={tx(lang, 'Masalar, dashboard, maliyyə və KDS ekranları bir-biri ilə əlaqəlidir. Menecer hər şeyi görür, komanda isə öz ritmində işləyir.', 'Экраны столов, dashboard, финансов и KDS связаны между собой. Менеджер видит всё, а команда работает в своём ритме.', 'Tables, dashboard, finance and KDS are connected. Managers see the full picture while teams work in their own rhythm.')}
            />

            <div className="mt-10 grid gap-6 xl:grid-cols-2">
              <ScreenCard
                title={tx(lang, 'Masalar', 'Столы', 'Tables')}
                body={tx(lang, 'Masa açılışı, raund göndərişi, servisə hazır məhsullar və hesab bağlama eyni axında işləyir.', 'Открытие стола, отправка раундов, готовность к подаче и закрытие счёта работают в одном потоке.', 'Table opening, round sending, ready-to-serve items and bill closing work in one flow.')}
                mock={<TablesMock lang={lang} />}
              />
              <ScreenCard
                title="Dashboard"
                body={tx(lang, 'Kritik alert-lər, canlı satışlar, açıq check-lər və əməliyyat yükü menecerə real vəziyyəti göstərir.', 'Критические сигналы, живые продажи, открытые чеки и нагрузка показывают менеджеру реальную ситуацию.', 'Critical alerts, live sales, open checks and workload show managers the real operational state.')}
                mock={<DashboardMock lang={lang} />}
              />
              <ScreenCard
                title={tx(lang, 'Maliyyə, CRM və müştəri axını', 'Финансы, CRM и клиентский поток', 'Finance, CRM and customer flow')}
                body={tx(lang, 'Nağd kassa, bank, seyf, aktiv depozitlər, uyğunlaşdırma və jurnal ilə yanaşı CRM, loyallıq, Customer App və QR menu də eyni platformada işləyir.', 'Наличные, банк, сейф, активные депозиты, сверка и журнал работают вместе с CRM, лояльностью, Customer App и QR menu в одной платформе.', 'Cash, bank, safe, active deposits, reconciliation and journal work alongside CRM, loyalty, Customer App and QR menu in one platform.')}
                mock={<PlatformOpsMock lang={lang} />}
              />
              <ScreenCard
                title={tx(lang, 'Mətbəx ekranı', 'Экран кухни', 'Kitchen display')}
                body={tx(lang, 'Yeni raundlar, hazırlananlar, hazır olanlar və düzəliş tələb olunan item-lər mətbəxə aydın görünür.', 'Новые раунды, готовящиеся, готовые и исправляемые позиции чётко видны на кухне.', 'New rounds, preparing items, ready items and correction requests are clearly visible to the kitchen.')}
                mock={<KdsMock lang={lang} />}
              />
            </div>
          </section>

          <section id="saheler" className="pb-20">
            <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
              <SectionIntro
                eyebrow={tx(lang, 'Kimlər üçün', 'Для кого', 'Who it is for')}
                title={tx(lang, 'Fərqli obyekt formatları üçün uyğunlaşdırıla bilir', 'Адаптируется под разные форматы объектов', 'Fits different venue formats')}
                body={tx(lang, 'Sistem bir kassa məhsulu kimi yox, fərqli iş ritmlərinə uyğunlaşdırılan idarəetmə platforması kimi düşünülüb.', 'Система задумана не как просто касса, а как платформа управления под разные ритмы работы.', 'The system is built not as a simple till, but as a management platform for different operational rhythms.')}
              />
              <SurfaceCard className="p-8">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {industries.map((item) => (
                    <div key={item} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-5">
                      <div className="flex items-center gap-3">
                        <Store size={18} className="text-sky-700" />
                        <span className="text-base font-black text-slate-950">{item}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </SurfaceCard>
            </div>
          </section>

          <section className="pb-20">
            <SectionIntro
              eyebrow={tx(lang, 'Niyə iRonWaves', 'Почему iRonWaves', 'Why iRonWaves')}
              title={tx(lang, 'Bu platforma niyə real restoran üçün uyğundur', 'Почему эта платформа подходит реальному ресторану', 'Why this platform fits real restaurant operations')}
              body={tx(lang, 'Məqsəd yalnız satış almaq deyil. Məqsəd odur ki, sahibkar nəzarəti itirməsin, komanda isə işi qarışdırmadan sürətləndirə bilsin.', 'Цель не просто продавать. Цель — чтобы владелец не терял контроль, а команда ускорялась без хаоса.', 'The goal is not just to sell. The goal is to keep owners in control while teams move faster without chaos.')}
            />

            <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {whyItems.map((item) => (
                <SurfaceCard key={item} className="p-6">
                  <div className="flex items-start gap-3">
                    <BadgeCheck size={20} className="mt-1 shrink-0 text-emerald-600" />
                    <p className="text-sm leading-7 text-slate-700">{item}</p>
                  </div>
                </SurfaceCard>
              ))}
            </div>
          </section>

          <section id="demo" className="pb-24">
            <div className="overflow-hidden rounded-[38px] border border-slate-200/80 bg-[linear-gradient(135deg,#0f172a,#111827,#1e293b)] p-8 text-white shadow-[0_28px_80px_rgba(15,23,42,0.20)] md:p-10">
              <div className="grid gap-10 lg:grid-cols-[0.86fr_1.14fr] lg:items-start">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.28em] text-cyan-300">{tx(lang, 'Əlaqə', 'Контакт', 'Contact')}</div>
                  <h2 className="mt-4 text-4xl font-black leading-tight md:text-5xl">{tx(lang, 'Restoranınıza uyğun təqdimat alın', 'Получите презентацию под ваш ресторан', 'Get a presentation tailored to your restaurant')}</h2>
                  <p className="mt-5 text-sm leading-8 text-slate-300 md:text-base">
                    {tx(lang, 'POS, masalar, mətbəx, maliyyə, CRM və dashboard axınının sizin obyektə necə oturduğunu birlikdə baxaq.', 'Посмотрим вместе, как POS, столы, кухня, финансы, CRM и dashboard лягут на ваш объект.', 'Let’s review together how POS, tables, kitchen, finance, CRM and dashboard will fit your operation.')}
                  </p>

                  <div className="mt-8 grid gap-4">
                    {[
                      [tx(lang, 'Masa axını üçün təqdimat', 'Презентация потока столов', 'Table-flow presentation'), tx(lang, 'Ofisiant, mətbəx və hesab bağlama ritmini canlı görün.', 'Посмотрите вживую ритм официанта, кухни и закрытия счёта.', 'See waiter, kitchen and bill-closing flow live.')],
                      [tx(lang, 'Maliyyə nəzarəti üçün təqdimat', 'Презентация финансового контроля', 'Finance-control presentation'), tx(lang, 'Kassa, depozit, investor və uyğunlaşdırma məntiqini yoxlayın.', 'Проверьте логику кассы, депозитов, инвестора и сверки.', 'Review cash, deposits, investor and reconciliation logic.')],
                      [tx(lang, 'Menecer görünüşü üçün təqdimat', 'Презентация для менеджера', 'Manager presentation'), tx(lang, 'Dashboard, alert və jurnal hissəsinin qərara necə kömək etdiyini görün.', 'Посмотрите, как dashboard, alerts и journal помогают принимать решения.', 'See how dashboard, alerts and journal support decisions.')],
                    ].map(([title, note]) => (
                      <div key={title} className="rounded-[24px] border border-white/10 bg-white/6 p-4">
                        <div className="font-black text-white">{title}</div>
                        <div className="mt-2 text-sm leading-7 text-slate-300">{note}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <SurfaceCard className="p-6 md:p-8">
                  <div className="text-sm font-black uppercase tracking-[0.24em] text-sky-700">{tx(lang, 'Əlaqə formu', 'Форма связи', 'Contact form')}</div>
                  <form className="mt-6 grid gap-4" onSubmit={handleDemoRequest}>
                    <label className="block">
                      <div className="text-sm font-semibold text-slate-700">{tx(lang, 'Ad', 'Имя', 'Name')}</div>
                      <input className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-300" value={form.fullName} onChange={(e) => setForm((prev) => ({ ...prev, fullName: e.target.value }))} placeholder={tx(lang, 'Adınızı yazın', 'Введите имя', 'Enter your name')} />
                    </label>
                    <label className="block">
                      <div className="text-sm font-semibold text-slate-700">{tx(lang, 'Biznes adı', 'Название бизнеса', 'Business name')}</div>
                      <input className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-300" value={form.businessName} onChange={(e) => setForm((prev) => ({ ...prev, businessName: e.target.value }))} placeholder={tx(lang, 'Obyektinizin adı', 'Название объекта', 'Venue name')} />
                    </label>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="block">
                        <div className="text-sm font-semibold text-slate-700">{tx(lang, 'Telefon', 'Телефон', 'Phone')}</div>
                        <input className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-300" value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} placeholder="+994..." />
                      </label>
                      <label className="block">
                        <div className="text-sm font-semibold text-slate-700">{tx(lang, 'Obyekt növü', 'Тип объекта', 'Business type')}</div>
                        <select className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-300" value={form.businessType} onChange={(e) => setForm((prev) => ({ ...prev, businessType: e.target.value }))}>
                          <option value="restoran">{tx(lang, 'Restoran', 'Ресторан', 'Restaurant')}</option>
                          <option value="coffee-shop">{tx(lang, 'Coffee shop', 'Кофейня', 'Coffee shop')}</option>
                          <option value="fast-food">{tx(lang, 'Fast food', 'Фастфуд', 'Fast food')}</option>
                          <option value="doner">{tx(lang, 'Dönər', 'Донер', 'Doner')}</option>
                          <option value="retail">{tx(lang, 'Retail', 'Ритейл', 'Retail')}</option>
                          <option value="food-court">{tx(lang, 'Food court', 'Фуд-корт', 'Food court')}</option>
                        </select>
                      </label>
                    </div>
                    <label className="block">
                      <div className="text-sm font-semibold text-slate-700">{tx(lang, 'Qısa qeyd', 'Краткий комментарий', 'Short note')}</div>
                      <textarea className="mt-2 min-h-[130px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-sky-300" value={form.note} onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))} placeholder={tx(lang, 'Hazırda neçə kassanız, neçə masanız və ya hansı modula daha çox ehtiyacınız olduğunu yazın', 'Напишите, сколько у вас касс, столов или какой модуль вам важнее всего', 'Tell us how many tills or tables you have and which module matters most')} />
                    </label>

                    <div className="flex flex-col gap-3 sm:flex-row">
                      <button type="submit" className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(180deg,#0f172a,#1e293b)] px-6 py-3 text-base font-bold text-white shadow-[0_16px_34px_rgba(15,23,42,0.16)]">
                        {tx(lang, 'Əlaqə göndər', 'Отправить запрос', 'Send request')}
                        <ArrowRight size={18} />
                      </button>
                    </div>

                    <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-7 text-slate-600">
                      {tx(lang, 'Əlaqə', 'Контакт', 'Contact')}: <span className="font-semibold text-slate-900">{contactEmail}</span>
                      {contactPhone ? <span className="ml-2 font-semibold text-slate-900">{contactPhone}</span> : null}
                    </div>
                  </form>
                </SurfaceCard>
              </div>
            </div>
          </section>

          <footer className="border-t border-slate-200/80 py-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <img
                  src="/landing/ironwaves-logo.jpeg"
                  alt="iRonWaves POS"
                  className="h-12 w-12 rounded-2xl object-cover shadow-[0_14px_32px_rgba(15,23,42,0.10)]"
                />
                <div>
                  <div className="text-sm font-black uppercase tracking-[0.24em] text-sky-700">iRonWaves POS</div>
                  <div className="mt-2 text-sm text-slate-600">{tx(lang, 'Restoranınızı bir platformadan idarə edin.', 'Управляйте рестораном из одной платформы.', 'Run your restaurant from one platform.')}</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-4 text-sm font-semibold text-slate-600">
                {navItems.map((item) => (
                  <a key={item.label} href={item.href} className="transition hover:text-sky-700">
                    {item.label}
                  </a>
                ))}
              </div>

              <div className="text-sm text-slate-500">
                <span>iRonWaves POS {tx(lang, 'bir Laptop Market məhsuludur.', '— продукт Laptop Market.', 'is a Laptop Market product.')} </span>
                <a href="https://www.laptopmarket.az" target="_blank" rel="noreferrer" className="font-semibold text-slate-600 hover:text-sky-700">
                  www.laptopmarket.az
                </a>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

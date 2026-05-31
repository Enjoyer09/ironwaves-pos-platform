import { useEffect, useState } from 'react';
import { ChefHat, ChevronDown, CreditCard, LayoutDashboard, Monitor, QrCode, ShieldCheck, Smartphone, Users, Wifi, Zap, MessageCircle } from 'lucide-react';

type Lang = 'az' | 'ru' | 'en';

const tx = (lang: Lang, az: string, ru: string, en: string) => lang === 'az' ? az : lang === 'ru' ? ru : en;

const SCREENSHOTS = [
  '/landing/shot1.png',
  '/landing/shot2.png',
  '/landing/shot3.png',
  '/landing/shot4.png',
  '/landing/shot5.png',
  '/landing/shot6.png',
  '/landing/shot7.png',
  '/landing/shot8.png',
  '/landing/shot9.png',
  '/landing/shot10.png',
  '/landing/shot11.png',
];

const FEATURES = [
  { icon: Monitor, key: 'pos', az: 'POS Satış', ru: 'POS Продажи', en: 'POS Sales', descAz: 'Sürətli satış, səbət, ödəniş, çek çapı — bir ekranda', descRu: 'Быстрые продажи, корзина, оплата, печать чека — на одном экране', descEn: 'Fast sales, cart, payment, receipt print — one screen' },
  { icon: Users, key: 'tables', az: 'Masa İdarəetməsi', ru: 'Управление столами', en: 'Table Management', descAz: 'Masa açma, sifariş, raund, hesab bağlama, masa köçürmə', descRu: 'Открытие стола, заказ, раунды, закрытие счета, перенос', descEn: 'Open table, order, rounds, close bill, transfer' },
  { icon: ChefHat, key: 'kds', az: 'Mətbəx Ekranı (KDS)', ru: 'Экран кухни (KDS)', en: 'Kitchen Display (KDS)', descAz: 'Real-time sifariş axını, status yeniləmə, hazırlıq vaxtı', descRu: 'Поток заказов в реальном времени, обновление статуса', descEn: 'Real-time order flow, status updates, prep time' },
  { icon: CreditCard, key: 'finance', az: 'Maliyyə & Kassa', ru: 'Финансы & Касса', en: 'Finance & Cash', descAz: 'Kassa balansı, transferlər, investor borcu, anomaly detection', descRu: 'Баланс кассы, переводы, долг инвестору, обнаружение аномалий', descEn: 'Cash balance, transfers, investor debt, anomaly detection' },
  { icon: LayoutDashboard, key: 'dashboard', az: 'Canlı Dashboard', ru: 'Live Dashboard', en: 'Live Dashboard', descAz: 'KPI-lar, xəbərdarlıqlar, AI tövsiyələri — bir baxışda', descRu: 'KPI, предупреждения, AI рекомендации — одним взглядом', descEn: 'KPIs, alerts, AI recommendations — at a glance' },
  { icon: QrCode, key: 'loyalty', az: 'CRM & Loyallıq', ru: 'CRM & Лояльность', en: 'CRM & Loyalty', descAz: 'QR kart, bonus, cashback, reward, müştəri app', descRu: 'QR карта, бонусы, кэшбэк, reward, приложение клиента', descEn: 'QR card, bonus, cashback, reward, customer app' },
  { icon: Wifi, key: 'offline', az: 'Offline Rejim', ru: 'Офлайн режим', en: 'Offline Mode', descAz: 'İnternet kəsiləndə satış davam edir, sonra auto-sync', descRu: 'Продажи продолжаются без интернета, затем авто-синхронизация', descEn: 'Sales continue offline, then auto-sync' },
  { icon: ShieldCheck, key: 'security', az: 'Təhlükəsizlik', ru: 'Безопасность', en: 'Security', descAz: 'PIN login, 2FA, rol icazələri, audit log, token blacklist', descRu: 'PIN логин, 2FA, ролевые доступы, аудит, blacklist токенов', descEn: 'PIN login, 2FA, role permissions, audit log, token blacklist' },
];

const STEPS = [
  { num: '01', az: 'Qeydiyyat', ru: 'Регистрация', en: 'Sign Up', descAz: 'Tenant yaradılır, domen avtomatik konfiqurasiya olunur', descRu: 'Создается tenant, домен настраивается автоматически', descEn: 'Tenant created, domain auto-configured' },
  { num: '02', az: 'Menyu & Heyət', ru: 'Меню & Персонал', en: 'Menu & Staff', descAz: 'Menyu yüklənir, staff PIN-ləri yaradılır', descRu: 'Загружается меню, создаются PIN сотрудников', descEn: 'Menu uploaded, staff PINs created' },
  { num: '03', az: 'Satışa Başla', ru: 'Начни продавать', en: 'Start Selling', descAz: 'POS açılır, ilk satış 5 dəqiqəyə hazırdır', descRu: 'POS открывается, первая продажа готова за 5 минут', descEn: 'POS opens, first sale ready in 5 minutes' },
];

const STATS = [
  { value: '50+', az: 'Aktiv restoran', ru: 'Активных ресторанов', en: 'Active restaurants' },
  { value: '99.9%', az: 'Uptime', ru: 'Uptime', en: 'Uptime' },
  { value: '<2s', az: 'Satış vaxtı', ru: 'Время продажи', en: 'Sale time' },
  { value: '24/7', az: 'Cloud access', ru: 'Cloud доступ', en: 'Cloud access' },
];

const PRICING = [
  { name: 'Starter', price: '49', az: 'Kiçik kafe üçün', ru: 'Для маленького кафе', en: 'For small cafes', features: ['1 terminal', 'POS + KDS', 'Offline mode', '5 staff'] },
  { name: 'Pro', price: '99', az: 'Restoran üçün', ru: 'Для ресторана', en: 'For restaurants', features: ['3 terminal', 'Full modules', 'CRM & Loyalty', '20 staff', 'Priority support'], popular: true },
  { name: 'Enterprise', price: '199', az: 'Şəbəkə üçün', ru: 'Для сети', en: 'For chains', features: ['Unlimited', 'Multi-location', 'API access', 'Wolt/Bolt integration', 'Dedicated support'] },
];

const FAQ_ITEMS = [
  { q: { az: 'iRonWaves nədir?', ru: 'Что такое iRonWaves?', en: 'What is iRonWaves?' }, a: { az: 'iRonWaves — Azərbaycanda hazırlanmış cloud-based restoran idarəetmə platformasıdır. POS, masa, mətbəx, maliyyə, CRM və analitika modullarını bir sistemdə birləşdirir.', ru: 'iRonWaves — облачная платформа управления рестораном, разработанная в Азербайджане. Объединяет POS, столы, кухню, финансы, CRM и аналитику в одной системе.', en: 'iRonWaves is a cloud-based restaurant management platform built in Azerbaijan. It combines POS, tables, kitchen, finance, CRM and analytics in one system.' } },
  { q: { az: 'Quraşdırma lazımdır?', ru: 'Нужна ли установка?', en: 'Is installation required?' }, a: { az: 'Xeyr. iRonWaves tam web-based-dir. Brauzerdən açırsınız, işləyirsiniz. Heç bir proqram yükləmək lazım deyil. Kompüter, planşet və ya telefon — fərqi yoxdur.', ru: 'Нет. iRonWaves полностью веб-приложение. Открываете в браузере и работаете. Никакой установки не нужно. Компьютер, планшет или телефон — без разницы.', en: 'No. iRonWaves is fully web-based. Open in browser and work. No software to install. Computer, tablet or phone — it works everywhere.' } },
  { q: { az: 'Offline işləyir?', ru: 'Работает ли офлайн?', en: 'Does it work offline?' }, a: { az: 'Bəli. İnternet kəsiləndə POS satış davam edir. Satışlar lokal saxlanılır və internet qayıdanda avtomatik sinxron olunur. Heç bir satış itmir.', ru: 'Да. При отключении интернета POS продолжает работать. Продажи сохраняются локально и автоматически синхронизируются при восстановлении связи.', en: 'Yes. When internet drops, POS sales continue. Sales are stored locally and auto-sync when connection returns. No sale is ever lost.' } },
  { q: { az: 'Neçə terminal qoşula bilər?', ru: 'Сколько терминалов можно подключить?', en: 'How many terminals can connect?' }, a: { az: 'Starter planda 1, Pro-da 3, Enterprise-da limitsiz terminal. Hər terminal eyni anda işləyə bilər — real-time sinxronizasiya ilə.', ru: 'В плане Starter — 1, Pro — 3, Enterprise — без ограничений. Все терминалы работают одновременно с синхронизацией в реальном времени.', en: 'Starter plan: 1, Pro: 3, Enterprise: unlimited. All terminals work simultaneously with real-time sync.' } },
  { q: { az: 'Thermal printer dəstəkləyir?', ru: 'Поддерживает ли термопринтер?', en: 'Does it support thermal printers?' }, a: { az: 'Bəli. 80mm thermal printer dəstəklənir. Print Agent vasitəsilə sessiz çap (dialog olmadan) mümkündür. Həmçinin brauzer çapı da işləyir.', ru: 'Да. Поддерживаются 80мм термопринтеры. Через Print Agent возможна тихая печать (без диалога). Также работает печать через браузер.', en: 'Yes. 80mm thermal printers are supported. Silent printing via Print Agent (no dialog). Browser print also works.' } },
  { q: { az: 'Wolt/Bolt Food inteqrasiyası var?', ru: 'Есть ли интеграция с Wolt/Bolt Food?', en: 'Is there Wolt/Bolt Food integration?' }, a: { az: 'Bəli, hazırlanır. Wolt və Bolt Food sifarişləri birbaşa KDS-ə düşəcək. Menyu sinxronizasiyası avtomatik olacaq.', ru: 'Да, в разработке. Заказы Wolt и Bolt Food будут поступать прямо в KDS. Синхронизация меню будет автоматической.', en: 'Yes, in development. Wolt and Bolt Food orders will flow directly into KDS. Menu sync will be automatic.' } },
  { q: { az: 'Müştəri loyallıq sistemi necə işləyir?', ru: 'Как работает система лояльности?', en: 'How does the loyalty system work?' }, a: { az: 'QR kart yaradılır, müştəri hər alışda ulduz/cashback toplayır. Müəyyən həddə çatanda reward alır. Müştəri öz telefonundan balansını görə bilir.', ru: 'Создается QR карта, клиент накапливает звезды/кэшбэк с каждой покупки. При достижении порога получает reward. Клиент видит баланс на своем телефоне.', en: 'QR card is created, customer earns stars/cashback with each purchase. Gets reward at threshold. Customer can check balance on their phone.' } },
  { q: { az: 'Qiymət nə qədərdir?', ru: 'Сколько стоит?', en: 'How much does it cost?' }, a: { az: 'Starter: 49₼/ay, Pro: 99₼/ay, Enterprise: 199₼/ay. Gizli ödəniş yoxdur. İstənilən vaxt ləğv etmək mümkündür.', ru: 'Starter: 49₼/мес, Pro: 99₼/мес, Enterprise: 199₼/мес. Нет скрытых платежей. Можно отменить в любое время.', en: 'Starter: 49₼/mo, Pro: 99₼/mo, Enterprise: 199₼/mo. No hidden fees. Cancel anytime.' } },
];

function FaqItem({ q, a, lang }: { q: Record<Lang, string>; a: Record<Lang, string>; lang: Lang }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-800/60">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between py-5 text-left">
        <span className="text-sm font-bold text-slate-100 md:text-base">{q[lang]}</span>
        <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p className="pb-5 text-sm leading-relaxed text-slate-400">{a[lang]}</p>}
    </div>
  );
}

export default function LandingPageV2() {
  const [lang, setLang] = useState<Lang>('az');
  const [slideIndex, setSlideIndex] = useState(0);

  useEffect(() => {
    document.body.style.overflow = 'auto';
    document.body.style.height = 'auto';
    return () => { document.body.style.overflow = ''; document.body.style.height = ''; };
  }, []);

  // Auto-slide screenshots
  useEffect(() => {
    const timer = setInterval(() => setSlideIndex((i) => (i + 1) % SCREENSHOTS.length), 4000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-slate-100 font-sans">

      {/* ─── NAV ─── */}
      <nav className="sticky top-0 z-50 border-b border-slate-800/60 bg-[#0a0f1a]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <img src="/landing/ironwaves-logo.jpeg" alt="iRonWaves" className="h-9 w-9 rounded-xl object-cover" />
            <span className="text-lg font-bold">iRonWaves</span>
          </div>
          <div className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm text-slate-400 hover:text-white transition">{tx(lang, 'Xüsusiyyətlər', 'Возможности', 'Features')}</a>
            <a href="#how" className="text-sm text-slate-400 hover:text-white transition">{tx(lang, 'Necə işləyir', 'Как работает', 'How it works')}</a>
            <a href="#pricing" className="text-sm text-slate-400 hover:text-white transition">{tx(lang, 'Qiymətlər', 'Цены', 'Pricing')}</a>
            <a href="#faq" className="text-sm text-slate-400 hover:text-white transition">FAQ</a>
            <a href="#contact" className="text-sm text-slate-400 hover:text-white transition">{tx(lang, 'Əlaqə', 'Контакт', 'Contact')}</a>
          </div>
          <div className="flex items-center gap-3">
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300">
              <option value="az">AZ</option><option value="ru">RU</option><option value="en">EN</option>
            </select>
            <a href="https://demo.ironwaves.store" className="rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 px-5 py-2 text-sm font-bold text-slate-900 shadow-lg shadow-yellow-500/20 transition hover:shadow-yellow-500/40">Demo</a>
          </div>
        </div>
      </nav>

      {/* ─── HERO ─── */}
      <section className="relative overflow-hidden px-6 pb-20 pt-24 md:pt-32">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(250,204,21,0.08),transparent_60%)]" />
        <div className="relative mx-auto max-w-7xl">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
            {/* Left: Text */}
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-yellow-400/30 bg-yellow-400/10 px-4 py-1.5 text-xs font-bold text-yellow-300">
                <Zap size={12} /> {tx(lang, 'Azərbaycanda hazırlanıb', 'Разработано в Азербайджане', 'Made in Azerbaijan')}
              </div>
              <h1 className="mt-6 text-4xl font-black leading-tight tracking-tight md:text-5xl lg:text-6xl">
                {tx(lang, 'Restoranınızı ', 'Управляйте рестораном ', 'Run your restaurant ')}
                <span className="bg-gradient-to-r from-yellow-300 to-amber-400 bg-clip-text text-transparent">
                  {tx(lang, 'bir platformadan', 'с одной платформы', 'from one platform')}
                </span>
                {tx(lang, ' idarə edin', '', '')}
              </h1>
              <p className="mt-6 max-w-lg text-lg text-slate-400">
                {tx(lang, 'POS, Masalar, Mətbəx, Maliyyə, CRM, Loyallıq və Analitika — hamısı bir sistemdə. Quraşdırma yoxdur, brauzerdən işləyir.', 'POS, Столы, Кухня, Финансы, CRM, Лояльность и Аналитика — всё в одной системе. Без установки, работает из браузера.', 'POS, Tables, Kitchen, Finance, CRM, Loyalty and Analytics — all in one. No install, works from browser.')}
              </p>
              <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                <a href="https://demo.ironwaves.store" className="inline-flex min-h-14 items-center justify-center rounded-2xl bg-gradient-to-r from-yellow-400 to-amber-500 px-8 py-4 text-base font-black text-slate-900 shadow-xl shadow-yellow-500/25 transition hover:scale-[1.02]">
                  {tx(lang, 'Pulsuz Demo', 'Бесплатное Демо', 'Free Demo')}
                </a>
                <a href="https://wa.me/14162680101" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-8 py-4 text-base font-bold text-emerald-200 transition hover:bg-emerald-500/20">
                  <MessageCircle size={20} /> WhatsApp
                </a>
              </div>
            </div>
            {/* Right: POS Device (CSS-built) with sliding screenshots */}
            <div className="relative mx-auto w-full max-w-lg xl:max-w-xl">
              {/* Device body */}
              <div className="relative mx-auto" style={{ maxWidth: '520px' }}>
                {/* Screen bezel */}
                <div className="rounded-[20px] border-[10px] border-[#1a1a1a] bg-[#111] shadow-[0_30px_80px_rgba(0,0,0,0.7),inset_0_2px_4px_rgba(255,255,255,0.05)]">
                  {/* Screen */}
                  <div className="overflow-hidden rounded-[10px] bg-[#0a0f1a]" style={{ aspectRatio: '16/10' }}>
                    <div className="flex h-full transition-transform duration-700 ease-in-out" style={{ transform: `translateX(-${slideIndex * 100}%)` }}>
                      {SCREENSHOTS.map((src, i) => (
                        <img key={i} src={src} alt={`Screenshot ${i + 1}`} className="h-full w-full shrink-0 object-cover object-left-top" loading="lazy" />
                      ))}
                    </div>
                  </div>
                </div>
                {/* Stand neck */}
                <div className="mx-auto h-12 w-20 bg-gradient-to-b from-[#1a1a1a] to-[#2a2a2a]" />
                {/* Stand base with orange accent */}
                <div className="mx-auto flex h-8 w-36 items-center justify-center rounded-b-2xl bg-gradient-to-b from-orange-500 to-orange-600 shadow-lg">
                  <div className="h-1 w-16 rounded-full bg-orange-300/40" />
                </div>
                {/* Base plate */}
                <div className="mx-auto h-3 w-44 rounded-b-xl bg-[#1a1a1a] shadow-md" />
              </div>
              {/* Slide dots */}
              <div className="mt-8 flex justify-center gap-2">
                {SCREENSHOTS.map((_, i) => (
                  <button key={i} type="button" onClick={() => setSlideIndex(i)} className={`h-2.5 rounded-full transition-all ${i === slideIndex ? 'w-7 bg-yellow-400' : 'w-2.5 bg-slate-600'}`} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── STATS BAR ─── */}
      <section className="border-y border-slate-800/60 bg-slate-900/30 py-8">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-6 px-6 md:grid-cols-4">
          {STATS.map((stat) => (
            <div key={stat.value} className="text-center">
              <div className="text-3xl font-black text-yellow-400">{stat.value}</div>
              <div className="mt-1 text-sm text-slate-400">{tx(lang, stat.az, stat.ru, stat.en)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── FEATURES ─── */}
      <section id="features" className="px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <div className="text-center">
            <h2 className="text-3xl font-black md:text-4xl">{tx(lang, 'Üstün funksiyalarımız', 'Наши преимущества', 'Our advantages')}</h2>
            <p className="mx-auto mt-4 max-w-2xl text-slate-400">{tx(lang, 'Hər modul bir-birinə bağlıdır. Ayrıca quraşdırma, ayrıca ödəniş yoxdur.', 'Каждый модуль связан друг с другом. Нет отдельной установки или оплаты.', 'Every module is connected. No separate installation or payment.')}</p>
          </div>
          <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.key} className="group rounded-2xl border border-slate-800 bg-slate-900/50 p-6 transition hover:border-yellow-400/30 hover:bg-slate-900/80">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-yellow-400/10 text-yellow-400 transition group-hover:bg-yellow-400/20">
                  <f.icon size={24} />
                </div>
                <h3 className="mt-4 text-base font-bold">{tx(lang, f.az, f.ru, f.en)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{tx(lang, f.descAz, f.descRu, f.descEn)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ─── */}
      <section id="how" className="border-t border-slate-800/60 bg-slate-950/50 px-6 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <h2 className="text-3xl font-black md:text-4xl">{tx(lang, '5 dəqiqəyə başla', 'Начни за 5 минут', 'Start in 5 minutes')}</h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-400">{tx(lang, 'Quraşdırma yoxdur. Brauzerdən açırsan, işləyirsən.', 'Без установки. Открываешь в браузере и работаешь.', 'No installation. Open in browser and work.')}</p>
          </div>
          <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.num} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8">
                <div className="text-5xl font-black text-yellow-400/20">{step.num}</div>
                <h3 className="mt-4 text-xl font-bold">{tx(lang, step.az, step.ru, step.en)}</h3>
                <p className="mt-3 text-sm leading-relaxed text-slate-400">{tx(lang, step.descAz, step.descRu, step.descEn)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── PRICING ─── */}
      <section id="pricing" className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <h2 className="text-3xl font-black md:text-4xl">{tx(lang, 'Sadə və şəffaf qiymətlər', 'Простые и прозрачные цены', 'Simple and transparent pricing')}</h2>
          </div>
          <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
            {PRICING.map((plan) => (
              <div key={plan.name} className={`relative rounded-2xl border p-8 ${plan.popular ? 'border-yellow-400/50 bg-slate-900/80 shadow-xl shadow-yellow-500/10' : 'border-slate-800 bg-slate-900/40'}`}>
                {plan.popular && <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-yellow-400 to-amber-500 px-4 py-1 text-xs font-black text-slate-900">{tx(lang, 'Populyar', 'Популярный', 'Popular')}</div>}
                <h3 className="text-xl font-bold">{plan.name}</h3>
                <p className="mt-1 text-sm text-slate-400">{tx(lang, plan.az, plan.ru, plan.en)}</p>
                <div className="mt-6"><span className="text-4xl font-black">{plan.price}</span><span className="ml-1 text-sm text-slate-400">₼/{tx(lang, 'ay', 'мес', 'mo')}</span></div>
                <ul className="mt-6 space-y-3">{plan.features.map((f) => (<li key={f} className="flex items-center gap-2 text-sm text-slate-300"><span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />{f}</li>))}</ul>
                <a href="https://wa.me/14162680101" target="_blank" rel="noopener noreferrer" className={`mt-8 block w-full rounded-xl py-3 text-center text-sm font-bold transition ${plan.popular ? 'bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-900' : 'border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700'}`}>{tx(lang, 'Başla', 'Начать', 'Get Started')}</a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section id="faq" className="border-t border-slate-800/60 bg-slate-950/50 px-6 py-24">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-center text-3xl font-black md:text-4xl">FAQ</h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-slate-400">{tx(lang, 'Tez-tez verilən suallar', 'Часто задаваемые вопросы', 'Frequently asked questions')}</p>
          <div className="mt-12">{FAQ_ITEMS.map((item, i) => <FaqItem key={i} q={item.q} a={item.a} lang={lang} />)}</div>
        </div>
      </section>

      {/* ─── CONTACT ─── */}
      <section id="contact" className="px-6 py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-black md:text-4xl">{tx(lang, 'Əlaqə', 'Контакт', 'Contact')}</h2>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <a href="tel:+14162680101" className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 transition hover:border-yellow-400/30">
              <Smartphone size={24} className="mx-auto text-yellow-400" />
              <div className="mt-3 text-sm font-bold">+1 (416) 268-0101</div>
              <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Telefon', 'Телефон', 'Phone')}</div>
            </a>
            <a href="mailto:abbas@laptopmarket.az" className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 transition hover:border-yellow-400/30">
              <Zap size={24} className="mx-auto text-yellow-400" />
              <div className="mt-3 text-sm font-bold">abbas@laptopmarket.az</div>
              <div className="mt-1 text-xs text-slate-400">Email</div>
            </a>
            <a href="https://wa.me/14162680101" target="_blank" rel="noopener noreferrer" className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 transition hover:border-emerald-400/50">
              <MessageCircle size={24} className="mx-auto text-emerald-400" />
              <div className="mt-3 text-sm font-bold">WhatsApp</div>
              <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Canlı söhbət', 'Живой чат', 'Live chat')}</div>
            </a>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-slate-800/60 px-6 py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 md:flex-row">
          <div className="flex items-center gap-2">
            <img src="/landing/ironwaves-logo.jpeg" alt="iRonWaves" className="h-7 w-7 rounded-lg object-cover" />
            <span className="text-sm font-bold text-slate-300">iRonWaves POS</span>
          </div>
          <div className="text-xs text-slate-500">© 2026 iRonWaves. {tx(lang, 'Bütün hüquqlar qorunur.', 'Все права защищены.', 'All rights reserved.')}</div>
        </div>
      </footer>
    </div>
  );
}

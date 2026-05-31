import { useEffect, useState } from 'react';
import { ChefHat, CreditCard, LayoutDashboard, Monitor, QrCode, ShieldCheck, Smartphone, Users, Wifi, Zap } from 'lucide-react';

type Lang = 'az' | 'ru' | 'en';

const tx = (lang: Lang, az: string, ru: string, en: string) => lang === 'az' ? az : lang === 'ru' ? ru : en;

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

export default function LandingPageV2() {
  const [lang, setLang] = useState<Lang>('az');

  useEffect(() => {
    document.body.style.overflow = 'auto';
    document.body.style.height = 'auto';
    return () => { document.body.style.overflow = ''; document.body.style.height = ''; };
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0f1a] text-slate-100 font-sans">
      {/* ─── NAV ─── */}
      <nav className="sticky top-0 z-50 border-b border-slate-800/60 bg-[#0a0f1a]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 text-sm font-black text-slate-900">iW</div>
            <span className="text-lg font-bold">iRonWaves</span>
          </div>
          <div className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm text-slate-400 hover:text-white transition">{tx(lang, 'Xüsusiyyətlər', 'Возможности', 'Features')}</a>
            <a href="#how" className="text-sm text-slate-400 hover:text-white transition">{tx(lang, 'Necə işləyir', 'Как работает', 'How it works')}</a>
            <a href="#pricing" className="text-sm text-slate-400 hover:text-white transition">{tx(lang, 'Qiymətlər', 'Цены', 'Pricing')}</a>
            <a href="#contact" className="text-sm text-slate-400 hover:text-white transition">{tx(lang, 'Əlaqə', 'Контакт', 'Contact')}</a>
          </div>
          <div className="flex items-center gap-3">
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300">
              <option value="az">AZ</option>
              <option value="ru">RU</option>
              <option value="en">EN</option>
            </select>
            <a href="https://demo.ironwaves.store" className="rounded-xl bg-gradient-to-r from-yellow-400 to-amber-500 px-5 py-2 text-sm font-bold text-slate-900 shadow-lg shadow-yellow-500/20 transition hover:shadow-yellow-500/40">
              {tx(lang, 'Demo', 'Демо', 'Demo')}
            </a>
          </div>
        </div>
      </nav>

      {/* ─── HERO ─── */}
      <section className="relative overflow-hidden px-6 pb-20 pt-24 md:pt-32">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(250,204,21,0.08),transparent_60%)]" />
        <div className="relative mx-auto max-w-7xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-yellow-400/30 bg-yellow-400/10 px-4 py-1.5 text-xs font-bold text-yellow-300">
            <Zap size={12} /> {tx(lang, 'Azərbaycan üçün hazırlanıb', 'Создано для Азербайджана', 'Built for Azerbaijan')}
          </div>
          <h1 className="mx-auto mt-6 max-w-4xl text-4xl font-black leading-tight tracking-tight md:text-6xl lg:text-7xl">
            {tx(lang, 'Restoranınızı ', 'Управляйте рестораном ', 'Run your restaurant ')}
            <span className="bg-gradient-to-r from-yellow-300 to-amber-400 bg-clip-text text-transparent">
              {tx(lang, 'bir platformadan', 'с одной платформы', 'from one platform')}
            </span>
            {tx(lang, ' idarə edin', '', '')}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400 md:text-xl">
            {tx(lang, 'POS, Masalar, Mətbəx, Maliyyə, CRM, Loyallıq və Analitika — hamısı bir sistemdə. Quraşdırma yoxdur, brauzerdən işləyir.', 'POS, Столы, Кухня, Финансы, CRM, Лояльность и Аналитика — всё в одной системе. Без установки, работает из браузера.', 'POS, Tables, Kitchen, Finance, CRM, Loyalty and Analytics — all in one system. No installation, works from browser.')}
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a href="https://demo.ironwaves.store" className="inline-flex min-h-14 items-center rounded-2xl bg-gradient-to-r from-yellow-400 to-amber-500 px-8 py-4 text-base font-black text-slate-900 shadow-xl shadow-yellow-500/25 transition hover:shadow-yellow-500/40 hover:scale-[1.02]">
              {tx(lang, 'Pulsuz Demo', 'Бесплатное Демо', 'Free Demo')}
            </a>
            <a href="https://super.ironwaves.store" className="inline-flex min-h-14 items-center rounded-2xl border border-slate-600 bg-slate-800/50 px-8 py-4 text-base font-bold text-slate-200 transition hover:bg-slate-700/50">
              {tx(lang, 'Platformaya keç', 'Открыть платформу', 'Open Platform')} →
            </a>
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
            <h2 className="text-3xl font-black md:text-4xl">{tx(lang, 'Bütün lazım olan bir yerdə', 'Всё необходимое в одном месте', 'Everything you need in one place')}</h2>
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
              <div key={step.num} className="relative rounded-2xl border border-slate-800 bg-slate-900/40 p-8">
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
            <p className="mx-auto mt-4 max-w-xl text-slate-400">{tx(lang, 'Gizli ödəniş yoxdur. İstədiyiniz zaman ləğv edin.', 'Нет скрытых платежей. Отмените в любое время.', 'No hidden fees. Cancel anytime.')}</p>
          </div>
          <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
            {PRICING.map((plan) => (
              <div key={plan.name} className={`relative rounded-2xl border p-8 ${plan.popular ? 'border-yellow-400/50 bg-slate-900/80 shadow-xl shadow-yellow-500/10' : 'border-slate-800 bg-slate-900/40'}`}>
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-yellow-400 to-amber-500 px-4 py-1 text-xs font-black text-slate-900">
                    {tx(lang, 'Populyar', 'Популярный', 'Popular')}
                  </div>
                )}
                <h3 className="text-xl font-bold">{plan.name}</h3>
                <p className="mt-1 text-sm text-slate-400">{tx(lang, plan.az, plan.ru, plan.en)}</p>
                <div className="mt-6">
                  <span className="text-4xl font-black text-white">{plan.price}</span>
                  <span className="ml-1 text-sm text-slate-400">₼ / {tx(lang, 'ay', 'мес', 'mo')}</span>
                </div>
                <ul className="mt-6 space-y-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-slate-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
                      {f}
                    </li>
                  ))}
                </ul>
                <a href="https://demo.ironwaves.store" className={`mt-8 block w-full rounded-xl py-3 text-center text-sm font-bold transition ${plan.popular ? 'bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-900 shadow-lg shadow-yellow-500/20' : 'border border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700'}`}>
                  {tx(lang, 'Başla', 'Начать', 'Get Started')}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CONTACT ─── */}
      <section id="contact" className="border-t border-slate-800/60 bg-slate-950/50 px-6 py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-black md:text-4xl">{tx(lang, 'Əlaqə', 'Контакт', 'Contact')}</h2>
          <p className="mx-auto mt-4 max-w-xl text-slate-400">{tx(lang, 'Sualınız var? Bizimlə əlaqə saxlayın.', 'Есть вопросы? Свяжитесь с нами.', 'Have questions? Get in touch.')}</p>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <a href="tel:+994552999282" className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 transition hover:border-yellow-400/30">
              <Smartphone size={24} className="mx-auto text-yellow-400" />
              <div className="mt-3 text-sm font-bold">+994 55 299 92 82</div>
              <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Telefon', 'Телефон', 'Phone')}</div>
            </a>
            <a href="mailto:abbas@laptopmarket.az" className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 transition hover:border-yellow-400/30">
              <Zap size={24} className="mx-auto text-yellow-400" />
              <div className="mt-3 text-sm font-bold">abbas@laptopmarket.az</div>
              <div className="mt-1 text-xs text-slate-400">Email</div>
            </a>
            <a href="https://wa.me/994552999282" target="_blank" rel="noopener" className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 transition hover:border-yellow-400/30">
              <Users size={24} className="mx-auto text-yellow-400" />
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
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-yellow-400 to-amber-500 text-xs font-black text-slate-900">iW</div>
            <span className="text-sm font-bold text-slate-300">iRonWaves POS</span>
          </div>
          <div className="text-xs text-slate-500">© 2026 iRonWaves. {tx(lang, 'Bütün hüquqlar qorunur.', 'Все права защищены.', 'All rights reserved.')}</div>
          <div className="flex gap-4 text-xs text-slate-500">
            <a href="https://www.ironwaves.store" className="hover:text-slate-300">www.ironwaves.store</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

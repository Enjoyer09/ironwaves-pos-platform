import React from 'react';

const demoUrl = 'https://demo.ironwaves.store';
const appUrl = 'https://super.ironwaves.store';

type LandingLang = 'az' | 'ru' | 'en';

const content: Record<LandingLang, any> = {
  az: {
    badge: 'iRonWaves POS RC',
    heroTitle: 'Bir platforma ilə satış, mətbəx, maliyyə, CRM və loyallıq axınını premium səviyyədə idarə edin.',
    heroBody:
      'iRonWaves POS RC kassa əməliyyatlarını, masa və mətbəx axınını, investor və maliyyə nəzarətini, QR loyallıq sistemini və çox-tenant rollout modelini bir məhsul daxilində birləşdirir.',
    primaryCta: 'Canlı demoya bax',
    secondaryCta: 'Platformanı aç',
    highlights: [
      { value: 'POS + KDS', label: 'satış və servis axını bir yerdə' },
      { value: 'Finance', label: 'cash, card, investor, Z-report nəzarəti' },
      { value: 'CRM + Loyalty', label: 'QR kart, reward, cashback, customer app' },
    ],
    proofTitle: 'Bu platforma kim üçündür?',
    proofItems: [
      'Coffee shop, dessert bar, restoran və hybrid konseptlər üçün',
      'Subdomain-based SaaS rollout üçün',
      'Railway + Neon arxitekturası ilə sürətli deploy üçün',
      'Bir neçə brendi eyni məhsul core-u ilə idarə etmək üçün',
    ],
    showcaseTitle: 'Əsas modullar',
    showcaseBody:
      'Sistem yalnız POS ekranı deyil. Bu, əməliyyatın bütün təbəqələrini bir-birinə bağlayan tam idarəetmə platformasıdır.',
    modules: [
      {
        title: 'POS və Checkout',
        text: 'Sürətli satış, split payment, staff limit, reward kodu, receipt və loyalty axını.',
      },
      {
        title: 'Masalar və Mətbəx',
        text: 'Dine-in masalar, kitchen qəbul/hazır statusları və servisə hazır bildirişləri.',
      },
      {
        title: 'Maliyyə və Hesabat',
        text: 'Cash drawer, bank/card, investor borcu, Z-report və gündəlik nəzarət paneli.',
      },
      {
        title: 'Anbar və Maya',
        text: 'Inventory, reseptlər, maya dəyəri, loss, restock və audit-friendly tarixçə.',
      },
      {
        title: 'CRM və Loyalty',
        text: 'QR müştəri kartları, kampaniyalar, reward, cashback və branded customer app.',
      },
      {
        title: 'Tenant Rollout',
        text: 'www, demo, super və müştəri subdomain-ləri ilə peşəkar məhsul axını.',
      },
    ],
    architectureTitle: 'Satış axını',
    architectureSteps: [
      {
        title: '1. Müştəri www səhifəsinə gəlir',
        text: 'Məhsulu, modulları, vizual nümunələri və platforma dəyərini bir yerdə görür.',
      },
      {
        title: '2. Demo tenant-a keçir',
        text: 'Safe demo mühitdə canlı POS, kitchen, finance və loyalty axınını test edir.',
      },
      {
        title: '3. Öz tenant-ı açılır',
        text: 'Müştəri öz subdomain-i, branding-i, user-ləri və ayarları ilə işə başlayır.',
      },
    ],
    architectureCardTitle: 'Demo-first rollout',
    architectureCardBody:
      'Demo tenant çıxış zamanı təmizlənir, buna görə hər yeni görüşdə investor və ya müştəri eyni təmiz ssenarini görür.',
    finalTitle: 'Bir məhsulla daha peşəkar sat, daha rahat idarə et.',
    finalBody:
      'Landing, demo və branded tenant modeli sayəsində məhsulu daha rahat təqdim edir, daha sürətli onboard edir və daha az texniki qarışıqlıqla böyüdürsünüz.',
    screenshotTitle: 'Məhsul preview-ları',
    screenshotBody:
      'Aşağıdakı preview kartlar sistemin əsas ekran dillərini göstərir. İstəsəniz növbəti mərhələdə bunları real screenshot-larla əvəz edək.',
  },
  ru: {
    badge: 'iRonWaves POS RC',
    heroTitle: 'Управляйте продажами, кухней, финансами, CRM и loyalty в одной премиальной платформе.',
    heroBody:
      'iRonWaves POS RC объединяет кассу, столы и кухню, investor/finance контроль, QR loyalty и multi-tenant rollout в одном продукте.',
    primaryCta: 'Открыть live demo',
    secondaryCta: 'Открыть платформу',
    highlights: [
      { value: 'POS + KDS', label: 'продажи и сервис в одной системе' },
      { value: 'Finance', label: 'cash, card, investor, Z-report контроль' },
      { value: 'CRM + Loyalty', label: 'QR карта, reward, cashback, customer app' },
    ],
    proofTitle: 'Для кого эта платформа?',
    proofItems: [
      'Для coffee shop, dessert bar, ресторанов и hybrid-концептов',
      'Для subdomain-based SaaS rollout',
      'Для быстрого deploy на Railway + Neon',
      'Для управления несколькими брендами из одного core-продукта',
    ],
    showcaseTitle: 'Основные модули',
    showcaseBody:
      'Это не просто POS-экран. Это полноценная платформа управления операциями, где все ключевые слои работают вместе.',
    modules: [
      {
        title: 'POS и Checkout',
        text: 'Быстрая продажа, split payment, staff limit, reward code, receipt и loyalty flow.',
      },
      {
        title: 'Столы и Кухня',
        text: 'Dine-in столы, kitchen статусы и уведомления о готовности заказа.',
      },
      {
        title: 'Финансы и Отчёты',
        text: 'Cash drawer, bank/card, investor debt, Z-report и ежедневный контроль.',
      },
      {
        title: 'Склад и Себестоимость',
        text: 'Inventory, recipes, costing, loss, restock и audit-friendly история движений.',
      },
      {
        title: 'CRM и Loyalty',
        text: 'QR карты клиентов, кампании, reward, cashback и branded customer app.',
      },
      {
        title: 'Tenant Rollout',
        text: 'www, demo, super и клиентские subdomain-ы для профессионального SaaS потока.',
      },
    ],
    architectureTitle: 'Сценарий продаж',
    architectureSteps: [
      {
        title: '1. Клиент заходит на www',
        text: 'Видит продукт, модули, визуальные примеры и общую ценность платформы.',
      },
      {
        title: '2. Переходит в demo tenant',
        text: 'Тестирует живой POS, kitchen, finance и loyalty в безопасной среде.',
      },
      {
        title: '3. Получает свой tenant',
        text: 'Запускается на собственном subdomain с branding, users и настройками.',
      },
    ],
    architectureCardTitle: 'Demo-first rollout',
    architectureCardBody:
      'Demo tenant очищается после выхода, поэтому каждый новый клиент видит чистый и управляемый сценарий.',
    finalTitle: 'Продавайте продукт увереннее и управляйте операциями легче.',
    finalBody:
      'Связка landing + demo + branded tenant помогает лучше презентовать систему, быстрее онбордить клиентов и масштабироваться с меньшим хаосом.',
    screenshotTitle: 'Превью продукта',
    screenshotBody:
      'Ниже — стилизованные preview-карты ключевых экранов. На следующем этапе мы можем заменить их реальными screenshot-ами.',
  },
  en: {
    badge: 'iRonWaves POS RC',
    heroTitle: 'Run sales, kitchen, finance, CRM, and loyalty from one premium operations platform.',
    heroBody:
      'iRonWaves POS RC brings checkout, tables and kitchen flow, investor-grade finance control, QR loyalty, and multi-tenant rollout together inside one product core.',
    primaryCta: 'Open live demo',
    secondaryCta: 'Open platform',
    highlights: [
      { value: 'POS + KDS', label: 'sales and service flow in one system' },
      { value: 'Finance', label: 'cash, card, investor, Z-report visibility' },
      { value: 'CRM + Loyalty', label: 'QR cards, rewards, cashback, customer app' },
    ],
    proofTitle: 'Who is this platform for?',
    proofItems: [
      'Coffee shops, dessert bars, restaurants, and hybrid concepts',
      'Subdomain-based SaaS rollout',
      'Fast deployment on Railway + Neon',
      'Operating multiple brands from one product core',
    ],
    showcaseTitle: 'Core modules',
    showcaseBody:
      'This is not just a POS screen. It is a full operating layer that connects checkout, kitchen, finance, CRM, loyalty, and rollout logic.',
    modules: [
      {
        title: 'POS and Checkout',
        text: 'Fast sales, split payments, staff limits, reward codes, receipts, and loyalty flow.',
      },
      {
        title: 'Tables and Kitchen',
        text: 'Dine-in tables, kitchen acceptance and ready states, and front-of-house service visibility.',
      },
      {
        title: 'Finance and Reports',
        text: 'Cash drawer, bank/card, investor debt, Z-report, and daily control in one place.',
      },
      {
        title: 'Inventory and Costing',
        text: 'Inventory, recipes, costing, loss, restock, and audit-friendly stock movement history.',
      },
      {
        title: 'CRM and Loyalty',
        text: 'QR customer cards, campaigns, rewards, cashback models, and a branded customer app.',
      },
      {
        title: 'Tenant Rollout',
        text: 'www, demo, super, and client subdomains for a clean SaaS operating model.',
      },
    ],
    architectureTitle: 'Sales journey',
    architectureSteps: [
      {
        title: '1. Prospect lands on www',
        text: 'They see the product story, key modules, visual previews, and the system’s value clearly.',
      },
      {
        title: '2. They enter the demo tenant',
        text: 'They test live POS, kitchen, finance, and loyalty flows in a safe environment.',
      },
      {
        title: '3. They receive their own tenant',
        text: 'They launch on their branded subdomain with their own settings, users, and operational data.',
      },
    ],
    architectureCardTitle: 'Demo-first rollout',
    architectureCardBody:
      'The demo tenant resets on logout, so every new client walkthrough starts from a clean and controlled state.',
    finalTitle: 'Sell with more confidence. Operate with more control.',
    finalBody:
      'A landing page, a resettable live demo, and branded tenant workspaces create a cleaner product story and a stronger SaaS rollout model.',
    screenshotTitle: 'Product previews',
    screenshotBody:
      'The preview cards below are styled product mockups. We can replace them with real screenshots in the next pass.',
  },
};

function MockupFrame({
  title,
  accent,
  children,
}: {
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] p-3 shadow-[0_24px_60px_rgba(0,0,0,0.38)]">
      <div className="rounded-[24px] border border-white/10 bg-[#0a0f15] p-3">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
          </div>
          <div className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-950" style={{ backgroundColor: accent }}>
            {title}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

function PosMockup() {
  return (
    <MockupFrame title="POS" accent="#f8c700">
      <div className="grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[22px] bg-slate-900/80 p-4">
          <div className="grid grid-cols-2 gap-2">
            {[
              ['Americano', '4.00'],
              ['Latte', '5.50'],
              ['Cheesecake', '6.50'],
              ['Cold Brew', '5.00'],
            ].map(([name, price]) => (
              <div key={name} className="rounded-2xl border border-white/8 bg-white/5 p-3">
                <div className="text-sm font-semibold text-white">{name}</div>
                <div className="mt-1 text-xs text-slate-400">{price} ₼</div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[22px] bg-white p-4 text-slate-900">
          <div className="text-sm font-bold">Cart</div>
          <div className="mt-3 space-y-3 text-sm">
            <div className="flex items-center justify-between"><span>2x Americano</span><span>8.00</span></div>
            <div className="flex items-center justify-between"><span>1x Cheesecake</span><span>6.50</span></div>
          </div>
          <div className="mt-4 h-px bg-slate-200" />
          <div className="mt-4 flex items-center justify-between text-lg font-black">
            <span>Total</span>
            <span>14.50 ₼</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-emerald-100 px-3 py-2 text-center text-sm font-semibold text-emerald-800">Cash</div>
            <div className="rounded-2xl bg-sky-100 px-3 py-2 text-center text-sm font-semibold text-sky-800">Card</div>
          </div>
          <div className="mt-4 rounded-2xl bg-[#f8c700] px-4 py-3 text-center text-sm font-black text-slate-900">Complete Payment</div>
        </div>
      </div>
    </MockupFrame>
  );
}

function FinanceMockup() {
  return (
    <MockupFrame title="Finance" accent="#22d3ee">
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['Cash Drawer', '842 ₼'],
            ['Bank/Card', '1,420 ₼'],
            ['Investor Debt', '310 ₼'],
            ['Safe', '2,180 ₼'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-[20px] bg-white p-4 text-slate-900">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</div>
              <div className="mt-3 text-2xl font-black">{value}</div>
            </div>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[22px] bg-slate-900/85 p-4">
            <div className="text-sm font-semibold text-white">Smart Expense / Income</div>
            <div className="mt-4 space-y-2">
              <div className="h-11 rounded-xl bg-white/6" />
              <div className="h-11 rounded-xl bg-white/6" />
              <div className="h-11 rounded-xl bg-white/6" />
            </div>
            <div className="mt-4 rounded-2xl bg-[#22d3ee] px-4 py-3 text-center text-sm font-bold text-slate-950">Save Entry</div>
          </div>
          <div className="rounded-[22px] bg-white p-4 text-slate-900">
            <div className="text-sm font-semibold">Daily snapshot</div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between"><span>Sales in</span><span className="font-semibold text-emerald-600">+1,560 ₼</span></div>
              <div className="flex items-center justify-between"><span>Expenses out</span><span className="font-semibold text-rose-600">-280 ₼</span></div>
              <div className="flex items-center justify-between"><span>Investor repayment</span><span className="font-semibold text-amber-600">-70 ₼</span></div>
              <div className="h-px bg-slate-200" />
              <div className="flex items-center justify-between text-base font-black"><span>Net</span><span>1,210 ₼</span></div>
            </div>
          </div>
        </div>
      </div>
    </MockupFrame>
  );
}

function LoyaltyMockup() {
  return (
    <MockupFrame title="Customer App" accent="#7c3aed">
      <div className="grid gap-3 md:grid-cols-[1fr_0.9fr]">
        <div className="rounded-[24px] bg-[linear-gradient(180deg,#7c3aed,#22d3ee)] p-5 text-white">
          <div className="text-xs uppercase tracking-[0.28em] text-white/70">LOYALTY CLUB</div>
          <div className="mt-4 text-5xl font-black">1,240</div>
          <div className="mt-2 text-sm text-white/80">Stars / Cashback balance</div>
          <div className="mt-5 rounded-[22px] bg-white/12 p-4">
            <div className="text-sm font-semibold">Next reward</div>
            <div className="mt-2 h-3 rounded-full bg-black/15">
              <div className="h-full w-2/3 rounded-full bg-white" />
            </div>
          </div>
        </div>
        <div className="grid gap-3">
          <div className="rounded-[22px] bg-white p-4 text-slate-900">
            <div className="text-sm font-semibold">Claim codes</div>
            <div className="mt-4 rounded-[20px] bg-slate-100 p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Code</div>
              <div className="mt-2 text-3xl font-black">IW-4832</div>
            </div>
          </div>
          <div className="rounded-[22px] bg-slate-900/85 p-4">
            <div className="text-sm font-semibold text-white">Campaigns</div>
            <div className="mt-3 space-y-2">
              <div className="rounded-xl bg-white/6 px-3 py-2 text-sm text-slate-200">2x stars on desserts</div>
              <div className="rounded-xl bg-white/6 px-3 py-2 text-sm text-slate-200">Morning coffee cashback</div>
            </div>
          </div>
        </div>
      </div>
    </MockupFrame>
  );
}

export default function LandingPage() {
  const [lang, setLang] = React.useState<LandingLang>('az');
  const copy = content[lang];

  return (
    <div className="min-h-screen overflow-auto bg-[#0d1218] text-slate-100">
      <section className="relative isolate overflow-hidden border-b border-white/8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(248,199,0,0.18),transparent_22%),radial-gradient(circle_at_78%_10%,rgba(34,211,238,0.18),transparent_18%),radial-gradient(circle_at_70%_85%,rgba(59,130,246,0.12),transparent_16%),linear-gradient(140deg,#202836_0%,#131922_52%,#0b1016_100%)]" />
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.25) 1px, transparent 1px)',
            backgroundSize: '36px 36px',
          }}
        />

        <div className="relative mx-auto max-w-7xl px-6 pb-16 pt-8 md:px-10 lg:px-14 lg:pb-24">
          <div className="flex items-center justify-between gap-4">
            <div className="inline-flex rounded-full border border-yellow-200/20 bg-white/6 px-4 py-2 text-xs uppercase tracking-[0.28em] text-yellow-200/85">
              {copy.badge}
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/6 p-1 backdrop-blur">
              {(['az', 'ru', 'en'] as LandingLang[]).map((code) => (
                <button
                  key={code}
                  onClick={() => setLang(code)}
                  className={`rounded-full px-3 py-2 text-xs font-bold uppercase transition ${lang === code ? 'bg-white text-slate-950' : 'text-slate-200'}`}
                >
                  {code}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-10 grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-end">
            <div className="max-w-4xl">
              <h1 className="max-w-5xl font-[Georgia] text-5xl font-bold leading-[0.92] text-white md:text-7xl">
                {copy.heroTitle}
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-7 text-slate-300 md:text-lg">{copy.heroBody}</p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a href={demoUrl} className="glossy-gold inline-flex min-h-13 items-center justify-center rounded-2xl px-7 py-3 text-base font-bold">
                  {copy.primaryCta}
                </a>
                <a href={appUrl} className="neon-btn inline-flex min-h-13 items-center justify-center rounded-2xl px-7 py-3 text-base font-semibold">
                  {copy.secondaryCta}
                </a>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                {copy.highlights.map((item: any) => (
                  <div key={item.label} className="rounded-[24px] border border-white/10 bg-white/6 p-4 backdrop-blur-sm">
                    <div className="text-2xl font-black text-white">{item.value}</div>
                    <div className="mt-1 text-sm leading-6 text-slate-300">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="w-full rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.04))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Go-to-market flow</div>
              <div className="mt-3 text-2xl font-bold text-white">{'www -> demo -> branded tenant'}</div>
              <div className="mt-5 space-y-3">
                {copy.proofItems.map((item: string) => (
                  <div key={item} className="rounded-[20px] border border-white/10 bg-slate-950/30 px-4 py-3 text-sm leading-6 text-slate-200">
                    {item}
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-[24px] border border-cyan-300/15 bg-cyan-400/8 p-4">
                <div className="text-sm font-semibold text-cyan-100">Demo tenant policy</div>
                <div className="mt-2 text-sm leading-6 text-slate-300">
                  Demo user logout resets operational demo data, so every investor or client walkthrough starts from a clean state.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 md:px-10 lg:px-14">
        <div className="max-w-3xl">
          <div className="text-sm uppercase tracking-[0.22em] text-slate-400">{copy.showcaseTitle}</div>
          <h2 className="mt-3 text-4xl font-bold text-white">{copy.proofTitle}</h2>
          <p className="mt-4 text-sm leading-7 text-slate-300 md:text-base">{copy.showcaseBody}</p>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {copy.modules.map((item: any) => (
            <div key={item.title} className="rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-6">
              <div className="text-sm uppercase tracking-[0.22em] text-slate-400">Module</div>
              <h3 className="mt-3 text-2xl font-bold text-white">{item.title}</h3>
              <p className="mt-4 text-sm leading-7 text-slate-300">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-8 md:px-10 lg:px-14">
        <div className="max-w-3xl">
          <div className="text-sm uppercase tracking-[0.22em] text-slate-400">{copy.screenshotTitle}</div>
          <h2 className="mt-3 text-4xl font-bold text-white">Product surfaces that sell the system</h2>
          <p className="mt-4 text-sm leading-7 text-slate-300 md:text-base">{copy.screenshotBody}</p>
        </div>
        <div className="mt-8 grid gap-6">
          <PosMockup />
          <FinanceMockup />
          <LoyaltyMockup />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 md:px-10 lg:px-14">
        <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[30px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] p-6">
            <div className="text-sm uppercase tracking-[0.22em] text-slate-400">{copy.architectureTitle}</div>
            <div className="mt-4 space-y-4">
              {copy.architectureSteps.map((step: any) => (
                <div key={step.title} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                  <div className="text-sm font-semibold text-white">{step.title}</div>
                  <div className="mt-1 text-sm leading-6 text-slate-300">{step.text}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[30px] border border-cyan-300/10 bg-[linear-gradient(180deg,rgba(34,211,238,0.08),rgba(34,211,238,0.02))] p-6">
            <div className="text-sm uppercase tracking-[0.22em] text-cyan-200/80">Call to action</div>
            <h3 className="mt-3 text-3xl font-bold text-white">{copy.finalTitle}</h3>
            <p className="mt-4 text-sm leading-7 text-slate-300">{copy.finalBody}</p>
            <div className="mt-6 flex flex-col gap-3">
              <a href={demoUrl} className="glossy-gold inline-flex min-h-13 items-center justify-center rounded-2xl px-6 py-3 text-base font-bold">
                {copy.primaryCta}
              </a>
              <a href={appUrl} className="neon-btn inline-flex min-h-13 items-center justify-center rounded-2xl px-6 py-3 text-base font-semibold">
                {copy.secondaryCta}
              </a>
            </div>
            <div className="mt-6 rounded-[24px] border border-white/8 bg-black/20 p-4 text-sm leading-7 text-slate-300">
              {copy.architectureCardBody}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

import React from 'react';

const demoUrl = 'https://demo.ironwaves.store';
const appUrl = 'https://super.ironwaves.store';

type LandingLang = 'az' | 'ru' | 'en';

const content: Record<LandingLang, any> = {
  az: {
    nav: ['Ana Səhifə', 'Funksiyalar', 'Modullar', 'Demo', 'Əlaqə'],
    badge: 'iRonWaves POS RC',
    heroTitle: 'Restaurant, coffee shop və retail üçün premium POS platforması',
    heroBody:
      'Satış, masa, mətbəx, maliyyə, CRM, loyallıq və tenant rollout axınlarını bir məhsul daxilində birləşdirən müasir idarəetmə sistemi.',
    primaryCta: 'Canlı Demoya Bax',
    secondaryCta: 'Platformanı Aç',
    highlights: [
      { title: 'Easy UI & UX', text: 'Touch-friendly, sürətli və komandaya uyğun ekranlar' },
      { title: 'Kitchen Panel', text: 'Qəbul, hazırlanır və servisə hazır status axını' },
      { title: 'Cashier Panel', text: 'Split payment, reward, QR, receipt və sürətli checkout' },
      { title: 'CRM & Loyalty', text: 'QR kart, cashback, reward və branded customer app' },
    ],
    sectionTitle: 'Bütün əməliyyat bir mərkəzdə',
    sectionBody:
      'Bu sistem sadəcə kassa deyil. Obyektin gündəlik idarəsini, maliyyə nəzarətini və müştəri loyallığını eyni platformada birləşdirir.',
    modules: [
      {
        title: 'POS Checkout',
        text: 'Sürətli satış, kart/nağd/split payment, reward kodu və receipt axını.',
      },
      {
        title: 'Kitchen & Tables',
        text: 'Masa idarəsi, mətbəx statusları, dine-in və servis koordinasiyası.',
      },
      {
        title: 'Finance & Z-Report',
        text: 'Cash drawer, investor borcu, xərc/gəlir və gündəlik hesabat görünüşü.',
      },
      {
        title: 'Inventory & Recipes',
        text: 'Anbar, maya dəyəri, xammal azalması, resept və loss nəzarəti.',
      },
      {
        title: 'CRM & Customer App',
        text: 'QR kartlar, müştəri profili, campaign-lər və loyalty proqramları.',
      },
      {
        title: 'Multi-tenant Rollout',
        text: 'www, demo, super və branded tenant subdomain-ləri ilə peşəkar SaaS axını.',
      },
    ],
    flowTitle: 'Satış və onboarding modeli',
    flow: [
      {
        title: '1. Müştəri landing səhifəsini görür',
        text: 'Məhsulun əsas dəyərləri, modullar və sistemin vizual görünüşü ilə tanış olur.',
      },
      {
        title: '2. Demo tenant-a keçir',
        text: 'Canlı POS, finance, kitchen və loyalty axınlarını təhlükəsiz demo mühitdə test edir.',
      },
      {
        title: '3. Öz tenant-ını alır',
        text: 'Branded subdomain, öz user-ləri, öz ayarları və öz əməliyyat datası ilə işə başlayır.',
      },
    ],
    finalTitle: 'Məhsulu daha rahat satın, komandaya daha rahat öyrədin',
    finalBody:
      'Landing + demo + branded tenant modeli ilə həm satış prosesi daha peşəkar görünür, həm də onboarding daha rahat olur.',
  },
  ru: {
    nav: ['Главная', 'Функции', 'Модули', 'Демо', 'Контакты'],
    badge: 'iRonWaves POS RC',
    heroTitle: 'Премиальная POS-платформа для ресторанов, coffee shop и retail',
    heroBody:
      'Современная система управления, объединяющая продажи, столы, кухню, финансы, CRM, loyalty и tenant rollout в одном продукте.',
    primaryCta: 'Открыть Live Demo',
    secondaryCta: 'Открыть Платформу',
    highlights: [
      { title: 'Easy UI & UX', text: 'Touch-friendly, быстрые и понятные интерфейсы для команды' },
      { title: 'Kitchen Panel', text: 'Статусы принятия, приготовления и готовности к сервису' },
      { title: 'Cashier Panel', text: 'Split payment, reward, QR, receipt и быстрый checkout' },
      { title: 'CRM & Loyalty', text: 'QR-карты, cashback, reward и branded customer app' },
    ],
    sectionTitle: 'Все операции в одном центре',
    sectionBody:
      'Это не просто касса. Платформа объединяет ежедневное управление, финансовый контроль и loyalty клиента в единой системе.',
    modules: [
      { title: 'POS Checkout', text: 'Быстрые продажи, карта/наличные/split payment, reward code и receipt flow.' },
      { title: 'Kitchen & Tables', text: 'Управление столами, кухонные статусы, dine-in и сервисная координация.' },
      { title: 'Finance & Z-Report', text: 'Cash drawer, investor debt, расходы/доходы и ежедневная отчетность.' },
      { title: 'Inventory & Recipes', text: 'Склад, себестоимость, расход сырья, рецепты и контроль loss.' },
      { title: 'CRM & Customer App', text: 'QR-карты, профиль клиента, кампании и loyalty-программы.' },
      { title: 'Multi-tenant Rollout', text: 'www, demo, super и branded tenant subdomain-ы для SaaS-модели.' },
    ],
    flowTitle: 'Сценарий продаж и onboarding',
    flow: [
      { title: '1. Клиент видит landing page', text: 'Знакомится с ключевыми модулями, визуальным стилем и ценностью системы.' },
      { title: '2. Переходит в demo tenant', text: 'Тестирует live POS, finance, kitchen и loyalty в безопасной demo-среде.' },
      { title: '3. Получает свой tenant', text: 'Запускается на branded subdomain со своими users, settings и operational data.' },
    ],
    finalTitle: 'Продавать продукт проще. Обучать команду легче.',
    finalBody:
      'Связка landing + demo + branded tenant делает продажи профессиональнее, а onboarding заметно удобнее.',
  },
  en: {
    nav: ['Home', 'Features', 'Modules', 'Demo', 'Contact'],
    badge: 'iRonWaves POS RC',
    heroTitle: 'A premium POS platform for restaurants, coffee shops, and retail concepts',
    heroBody:
      'A modern operations system that connects sales, tables, kitchen, finance, CRM, loyalty, and tenant rollout inside one product.',
    primaryCta: 'Open Live Demo',
    secondaryCta: 'Open Platform',
    highlights: [
      { title: 'Easy UI & UX', text: 'Touch-friendly, fast, and team-friendly interfaces' },
      { title: 'Kitchen Panel', text: 'Accepted, preparing, and ready-for-service status flow' },
      { title: 'Cashier Panel', text: 'Split payment, reward, QR, receipt, and fast checkout' },
      { title: 'CRM & Loyalty', text: 'QR cards, cashback, rewards, and a branded customer app' },
    ],
    sectionTitle: 'Your whole operation in one center',
    sectionBody:
      'This is not just a cashier screen. It combines daily operations, finance control, and customer loyalty in one connected platform.',
    modules: [
      { title: 'POS Checkout', text: 'Fast sales, cash/card/split payment, reward codes, and receipt flow.' },
      { title: 'Kitchen & Tables', text: 'Table management, kitchen statuses, dine-in, and service coordination.' },
      { title: 'Finance & Z-Report', text: 'Cash drawer, investor debt, expenses/income, and daily reporting.' },
      { title: 'Inventory & Recipes', text: 'Inventory, costing, ingredient consumption, recipes, and loss control.' },
      { title: 'CRM & Customer App', text: 'QR cards, customer profiles, campaigns, and loyalty programs.' },
      { title: 'Multi-tenant Rollout', text: 'www, demo, super, and branded tenant subdomains for SaaS rollout.' },
    ],
    flowTitle: 'Sales and onboarding journey',
    flow: [
      { title: '1. A prospect sees the landing page', text: 'They understand the product, modules, visuals, and value quickly.' },
      { title: '2. They enter the demo tenant', text: 'They test live POS, finance, kitchen, and loyalty flows in a safe environment.' },
      { title: '3. They receive their own tenant', text: 'They launch on a branded subdomain with their own users, settings, and operational data.' },
    ],
    finalTitle: 'Sell the product better. Train the team faster.',
    finalBody:
      'A landing + demo + branded tenant model makes the product story stronger and the onboarding process smoother.',
  },
};

function ProductScreen() {
  return (
    <div className="relative mx-auto w-full max-w-[560px]">
      <div className="absolute -left-8 top-10 h-44 w-44 rounded-full bg-sky-300/60 blur-2xl" />
      <div className="absolute -right-8 top-24 h-36 w-36 rounded-full bg-violet-300/60 blur-2xl" />
      <div className="absolute right-8 top-0 h-24 w-24 rounded-full border-[18px] border-violet-200/50" />

      <div className="relative rotate-[8deg] rounded-[34px] bg-white p-4 shadow-[0_30px_60px_rgba(24,34,56,0.18)]">
        <div className="overflow-hidden rounded-[28px] border border-slate-200">
          <div className="flex items-center gap-2 bg-[#2d6cdf] px-4 py-3 text-white">
            <div className="h-3 w-3 rounded-full bg-white/70" />
            <div className="h-3 w-3 rounded-full bg-white/50" />
            <div className="h-3 w-3 rounded-full bg-white/35" />
            <div className="ml-3 text-xs font-semibold uppercase tracking-[0.24em]">iRonWaves POS</div>
          </div>

          <div className="grid grid-cols-[88px_1fr] bg-[#f7f9ff]">
            <div className="space-y-2 bg-[#3069dd] p-3">
              {Array.from({ length: 7 }).map((_, idx) => (
                <div key={idx} className={`rounded-xl ${idx === 1 ? 'bg-white text-[#3069dd]' : 'bg-white/15 text-white'} px-3 py-2 text-[11px] font-semibold`}>
                  {idx === 0 ? 'POS' : idx === 1 ? 'Menu' : idx === 2 ? 'Tables' : idx === 3 ? 'Kitchen' : idx === 4 ? 'CRM' : idx === 5 ? 'Stock' : 'Finance'}
                </div>
              ))}
            </div>
            <div className="p-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  'Americano',
                  'Latte',
                  'Flat White',
                  'Cheesecake',
                  'Cold Brew',
                  'Croissant',
                  'Brownie',
                  'Mocha',
                  'Tea',
                ].map((name, idx) => (
                  <div key={name} className="rounded-2xl bg-white p-2 shadow-[0_6px_14px_rgba(30,41,59,0.08)]">
                    <div className={`h-16 rounded-xl ${idx % 3 === 0 ? 'bg-amber-200' : idx % 3 === 1 ? 'bg-sky-200' : 'bg-rose-200'}`} />
                    <div className="mt-2 text-[11px] font-semibold text-slate-800">{name}</div>
                    <div className="text-[10px] text-slate-500">{(idx + 3).toFixed(2)} ₼</div>
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

export default function LandingPage() {
  const [lang, setLang] = React.useState<LandingLang>('az');
  const copy = content[lang];

  return (
    <div className="h-[100dvh] overflow-y-auto bg-[#f7f8fc] text-slate-900">
      <div className="relative min-h-full overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.10),transparent_22%),radial-gradient(circle_at_80%_12%,rgba(56,189,248,0.12),transparent_18%),linear-gradient(180deg,#ffffff_0%,#f6f7fb_45%,#eef2ff_100%)]" />

        <div className="relative mx-auto max-w-7xl px-6 md:px-10 lg:px-14">
          <header className="sticky top-0 z-20 mb-8 border-b border-slate-200/70 bg-white/90 py-5 backdrop-blur">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-0">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#1f2937,#4b5563)] text-xl font-black text-white shadow-[0_10px_24px_rgba(15,23,42,0.12)]">
                  IW
                </div>
                <div>
                  <div className="text-sm font-bold uppercase tracking-[0.22em] text-indigo-600">{copy.badge}</div>
                  <div className="text-2xl font-black leading-none text-slate-900">MSAR-style Premium POS</div>
                </div>
              </div>

              <div className="hidden items-center gap-6 text-sm font-semibold text-slate-600 lg:flex">
                {copy.nav.map((item: string) => (
                  <button key={item} className="transition hover:text-indigo-600">{item}</button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <div className="hidden rounded-full border border-slate-200 bg-white p-1 sm:flex">
                  {(['az', 'ru', 'en'] as LandingLang[]).map((code) => (
                    <button
                      key={code}
                      onClick={() => setLang(code)}
                      className={`rounded-full px-3 py-2 text-xs font-bold uppercase transition ${lang === code ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-indigo-600'}`}
                    >
                      {code}
                    </button>
                  ))}
                </div>
                <a
                  href={demoUrl}
                  className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#6366f1,#4f46e5)] px-6 py-3 text-sm font-bold text-white shadow-[0_16px_30px_rgba(99,102,241,0.28)]"
                >
                  {copy.primaryCta}
                </a>
              </div>
            </div>
          </header>

          <section className="grid gap-14 pb-20 pt-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
            <div className="max-w-2xl">
              <div className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.28em] text-indigo-600">
                {copy.badge}
              </div>
              <h1 className="mt-8 text-5xl font-black leading-[1.02] text-slate-900 md:text-7xl">
                {copy.heroTitle}
              </h1>
              <p className="mt-6 max-w-xl text-base leading-8 text-slate-600 md:text-lg">
                {copy.heroBody}
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href={demoUrl}
                  className="inline-flex min-h-13 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#6366f1,#4f46e5)] px-7 py-3 text-base font-bold text-white shadow-[0_16px_30px_rgba(99,102,241,0.26)]"
                >
                  {copy.primaryCta}
                </a>
                <a
                  href={appUrl}
                  className="inline-flex min-h-13 items-center justify-center rounded-2xl border border-slate-200 bg-white px-7 py-3 text-base font-semibold text-slate-800 shadow-[0_12px_24px_rgba(15,23,42,0.06)]"
                >
                  {copy.secondaryCta}
                </a>
              </div>
            </div>

            <ProductScreen />
          </section>

          <section className="grid gap-5 pb-20 md:grid-cols-2 xl:grid-cols-4">
            {copy.highlights.map((item: any, idx: number) => (
              <div key={item.title} className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
                <div className={`flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-[0_12px_24px_rgba(15,23,42,0.10)] ${idx === 0 ? 'bg-violet-500' : idx === 1 ? 'bg-orange-500' : idx === 2 ? 'bg-sky-500' : 'bg-lime-500'}`}>
                  <span className="text-lg font-black">{idx + 1}</span>
                </div>
                <h2 className="mt-5 text-2xl font-black text-slate-900">{item.title}</h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">{item.text}</p>
              </div>
            ))}
          </section>

          <section className="grid gap-8 pb-20 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-[34px] bg-[linear-gradient(180deg,#0f172a,#111827)] p-8 text-white shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
              <div className="text-sm font-bold uppercase tracking-[0.26em] text-sky-300">{copy.sectionTitle}</div>
              <h2 className="mt-4 text-4xl font-black leading-tight">{copy.flowTitle}</h2>
              <p className="mt-5 text-sm leading-8 text-slate-300">{copy.sectionBody}</p>
              <div className="mt-8 space-y-4">
                {copy.flow.map((step: any) => (
                  <div key={step.title} className="rounded-[24px] border border-white/10 bg-white/6 p-5">
                    <div className="text-lg font-bold text-white">{step.title}</div>
                    <div className="mt-2 text-sm leading-7 text-slate-300">{step.text}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              {copy.modules.map((item: any) => (
                <div key={item.title} className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
                  <div className="text-xs font-bold uppercase tracking-[0.22em] text-indigo-600">Module</div>
                  <h3 className="mt-4 text-2xl font-black text-slate-900">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{item.text}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="pb-24">
            <div className="rounded-[36px] bg-[linear-gradient(135deg,#eef2ff,#ffffff,#ecfeff)] p-8 shadow-[0_24px_60px_rgba(15,23,42,0.06)] md:p-10">
              <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
                <div>
                  <div className="text-sm font-bold uppercase tracking-[0.22em] text-indigo-600">Go-to-market</div>
                  <h2 className="mt-4 text-4xl font-black leading-tight text-slate-900">{copy.finalTitle}</h2>
                  <p className="mt-5 text-sm leading-8 text-slate-600">{copy.finalBody}</p>
                  <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <a
                      href={demoUrl}
                      className="inline-flex min-h-13 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#6366f1,#4f46e5)] px-7 py-3 text-base font-bold text-white shadow-[0_16px_30px_rgba(99,102,241,0.22)]"
                    >
                      {copy.primaryCta}
                    </a>
                    <a
                      href={appUrl}
                      className="inline-flex min-h-13 items-center justify-center rounded-2xl border border-slate-200 bg-white px-7 py-3 text-base font-semibold text-slate-800"
                    >
                      {copy.secondaryCta}
                    </a>
                  </div>
                </div>

                <div className="rounded-[30px] border border-white/70 bg-white p-6 shadow-[0_16px_32px_rgba(15,23,42,0.05)]">
                  <div className="text-sm font-bold uppercase tracking-[0.22em] text-slate-500">Launch model</div>
                  <div className="mt-5 space-y-4">
                    {[
                      ['www.ironwaves.store', 'Landing və məhsul təqdimatı'],
                      ['demo.ironwaves.store', 'Təmizlənən canlı demo tenant'],
                      ['super.ironwaves.store', 'Platform və idarəetmə mərkəzi'],
                      ['client-name.ironwaves.store', 'Branded production tenant'],
                    ].map(([host, text]) => (
                      <div key={host} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                        <div className="font-semibold text-slate-900">{host}</div>
                        <div className="mt-1 text-sm text-slate-600">{text}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

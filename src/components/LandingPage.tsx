import React from 'react';

const demoUrl = 'https://demo.ironwaves.store';
const appUrl = 'https://super.ironwaves.store';

type LandingLang = 'az' | 'ru' | 'en';

type LandingCopy = {
  nav: string[];
  badge: string;
  heroTitle: string;
  heroBody: string;
  primaryCta: string;
  secondaryCta: string;
  highlights: { title: string; text: string }[];
  sectionTitle: string;
  sectionBody: string;
  modules: { title: string; text: string }[];
  flowTitle: string;
  flow: { title: string; text: string }[];
  screenshotTitle: string;
  screenshotBody: string;
  screenshots: { title: string; text: string }[];
  pricingTitle: string;
  pricingBody: string;
  plans: {
    name: string;
    price: string;
    tag: string;
    features: string[];
    cta: string;
    featured?: boolean;
  }[];
  testimonialTitle: string;
  testimonialBody: string;
  testimonials: { quote: string; author: string; role: string }[];
  contactTitle: string;
  contactBody: string;
  contactCards: { title: string; text: string }[];
  finalTitle: string;
  finalBody: string;
  launchModelTitle: string;
  launchHosts: [string, string][];
};

const content: Record<LandingLang, LandingCopy> = {
  az: {
    nav: ['Ana Səhifə', 'Funksiyalar', 'Qiymət', 'Demo', 'Əlaqə'],
    badge: 'iRonWaves POS RC',
    heroTitle: 'Restaurant, coffee shop və retail üçün premium POS platforması',
    heroBody:
      'Satış, masa, mətbəx, maliyyə, CRM, loyallıq və branded customer app axınlarını bir məhsul daxilində birləşdirən müasir idarəetmə sistemi.',
    primaryCta: 'Canlı Demoya Bax',
    secondaryCta: 'Platformanı Aç',
    highlights: [
      { title: 'Touch-first UX', text: 'Kassa, tablet və monitor üçün iri, sürətli və təmiz ekranlar.' },
      { title: 'Kitchen & Tables', text: 'Mətbəx statusları, masa axını və servis koordinasiyası bir ritmdə işləyir.' },
      { title: 'Finance Control', text: 'Cash drawer, investor, xərclər, Z-report və gündəlik nəzarət bir paneldədir.' },
      { title: 'CRM & Loyalty', text: 'QR kartlar, cashback, rewards və branded customer app ilə dönüş artır.' },
    ],
    sectionTitle: 'Bütün əməliyyat bir mərkəzdə',
    sectionBody:
      'Bu sistem sadəcə kassa deyil. Obyektin gündəlik idarəsini, maliyyə nəzarətini və müştəri loyallığını eyni platformada birləşdirir.',
    modules: [
      {
        title: 'POS Checkout',
        text: 'Sürətli satış, split payment, reward kodu, QR tanıma və peşəkar receipt axını.',
      },
      {
        title: 'Kitchen & Tables',
        text: 'Masa idarəsi, mətbəx statusları, dine-in və servis koordinasiyası.',
      },
      {
        title: 'Finance & Z-Report',
        text: 'Cash drawer, investor borcu, xərc/gəlir, shift və gündəlik hesabat görünüşü.',
      },
      {
        title: 'Inventory & Recipes',
        text: 'Anbar, maya dəyəri, resept, xammal azalması və loss nəzarəti.',
      },
      {
        title: 'CRM & Customer App',
        text: 'QR kartlar, campaign-lər, rewards, cashback və branded loyalty portal.',
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
        text: 'Sistemlə ilk tanışlıq məhsulun dəyərini, ekranlarını və rollout modelini aydın göstərir.',
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
    screenshotTitle: 'Real məhsul ekranları',
    screenshotBody:
      'Kodla çəkilmiş mockup yox, məhsulun real panellərindən istifadə edərək sistemi necə hiss etdirəcəyinizi göstəririk.',
    screenshots: [
      { title: 'POS və checkout axını', text: 'Satış, touch-first menyu, səbət və kassir ritmi.' },
      { title: 'Finance və nəzarət paneli', text: 'Pul axını, report və gündəlik qərar paneli.' },
      { title: 'Loyalty kartları', text: 'Golden və Elite kimi klub üzvlüyü dizaynları.' },
    ],
    pricingTitle: 'Sadə planlar, güclü rollout',
    pricingBody:
      'İlkin demo və təqdimatdan sonra müştərini rahatlıqla uyğun plan üzrə işə sala bilərsiniz.',
    plans: [
      {
        name: 'Starter',
        price: '49 ₼/ay',
        tag: 'Kiçik obyekt',
        features: ['POS və satış', 'Masalar və mətbəx', 'Z-report və gündəlik hesabat', '1 branded tenant'],
        cta: 'Demo ilə yoxla',
      },
      {
        name: 'Growth',
        price: '99 ₼/ay',
        tag: 'Ən populyar',
        features: ['Finance və investor nəzarəti', 'CRM və loyalty', 'Customer app', 'Prioritet onboarding'],
        cta: 'Satış komandası ilə danış',
        featured: true,
      },
      {
        name: 'Enterprise',
        price: 'Xüsusi',
        tag: 'Şəbəkə və rollout',
        features: ['White-label rollout', 'Xüsusi branding', 'Onboarding paketi', 'Əlavə inteqrasiyalar'],
        cta: 'Fərdi təklif al',
      },
    ],
    testimonialTitle: 'Sistem təkcə gözəl görünməməlidir',
    testimonialBody:
      'Əsas məqsəd odur ki, həm sahib, həm kassir, həm də servis komandası gündəlik işi daha rahat görsün.',
    testimonials: [
      {
        quote: 'Kassa və maliyyə eyni məhsulda toplandığı üçün günlük nəzarət xeyli rahatlaşdı.',
        author: 'Murad R.',
        role: 'Coffee shop owner',
      },
      {
        quote: 'Mətbəx, masa və loyallıq axını birlikdə işləyəndə servis komandası daha az çaşır.',
        author: 'Ləman A.',
        role: 'Operations manager',
      },
      {
        quote: 'Demo tenant ilə məhsulu satmaq və komandaya göstərmək daha peşəkar görünür.',
        author: 'Nigar S.',
        role: 'Brand consultant',
      },
    ],
    contactTitle: 'Demo qurun, tenant açın, satışa başlayın',
    contactBody:
      'Landing səhifədən demo tenant-a, oradan branded production tenant-a keçən axınla məhsulu həm satış, həm onboarding baxımından gücləndirin.',
    contactCards: [
      { title: 'Demo tenant', text: 'Canlı test üçün açıq giriş və sıfırlanan demo mühiti.' },
      { title: 'Custom rollout', text: 'Branded subdomain, tenant ayarları və loyalty ssenariləri.' },
      { title: 'Sales CTA', text: 'WhatsApp, e-mail və demo request axını ilə əlaqə toplayın.' },
    ],
    finalTitle: 'Məhsulu daha rahat satın, komandaya daha rahat öyrədin',
    finalBody:
      'Landing + demo + branded tenant modeli ilə həm satış prosesi daha peşəkar görünür, həm də onboarding daha rahat olur.',
    launchModelTitle: 'Launch model',
    launchHosts: [
      ['www.ironwaves.store', 'Landing və məhsul təqdimatı'],
      ['demo.ironwaves.store', 'Təmizlənən canlı demo tenant'],
      ['super.ironwaves.store', 'Platform və idarəetmə mərkəzi'],
      ['client-name.ironwaves.store', 'Branded production tenant'],
    ],
  },
  ru: {
    nav: ['Главная', 'Функции', 'Тарифы', 'Демо', 'Контакты'],
    badge: 'iRonWaves POS RC',
    heroTitle: 'Премиальная POS-платформа для ресторанов, coffee shop и retail',
    heroBody:
      'Современная система управления, объединяющая продажи, столы, кухню, финансы, CRM, loyalty и branded customer app в одном продукте.',
    primaryCta: 'Открыть Live Demo',
    secondaryCta: 'Открыть Платформу',
    highlights: [
      { title: 'Touch-first UX', text: 'Крупные, быстрые и чистые экраны для кассы, планшета и сенсорных мониторов.' },
      { title: 'Kitchen & Tables', text: 'Кухонные статусы, столы и сервисный поток работают как одна система.' },
      { title: 'Finance Control', text: 'Cash drawer, investor, расходы, Z-report и ежедневный контроль в одной панели.' },
      { title: 'CRM & Loyalty', text: 'QR-карты, cashback, rewards и branded customer app повышают retention.' },
    ],
    sectionTitle: 'Все операции в одном центре',
    sectionBody:
      'Это не просто касса. Платформа объединяет ежедневные операции, финконтроль и лояльность клиентов в одной системе.',
    modules: [
      { title: 'POS Checkout', text: 'Быстрые продажи, split payment, reward code, QR-идентификация и receipt flow.' },
      { title: 'Kitchen & Tables', text: 'Управление столами, кухонные статусы, dine-in и сервисная координация.' },
      { title: 'Finance & Z-Report', text: 'Cash drawer, investor debt, расходы/доходы, shift и ежедневная отчетность.' },
      { title: 'Inventory & Recipes', text: 'Склад, себестоимость, рецепты, расход сырья и контроль loss.' },
      { title: 'CRM & Customer App', text: 'QR-карты, кампании, rewards, cashback и branded loyalty portal.' },
      { title: 'Multi-tenant Rollout', text: 'www, demo, super и branded tenant subdomain-ы для SaaS-модели.' },
    ],
    flowTitle: 'Сценарий продаж и onboarding',
    flow: [
      { title: '1. Клиент видит landing page', text: 'Первое впечатление быстро объясняет ценность, экраны и модель rollout.' },
      { title: '2. Переходит в demo tenant', text: 'Тестирует живые POS, finance, kitchen и loyalty в безопасной среде.' },
      { title: '3. Получает свой tenant', text: 'Запускается на branded subdomain со своими users, settings и data.' },
    ],
    screenshotTitle: 'Реальные экраны продукта',
    screenshotBody:
      'Вместо абстрактных mockup мы показываем реальные панели системы и лояльности.',
    screenshots: [
      { title: 'POS и checkout flow', text: 'Продажи, touch-first меню, корзина и ритм кассира.' },
      { title: 'Finance и контроль', text: 'Денежный поток, отчеты и ежедневная управленческая картина.' },
      { title: 'Карты лояльности', text: 'Дизайн клубных карт уровня Golden и Elite.' },
    ],
    pricingTitle: 'Понятные планы, сильный rollout',
    pricingBody: 'После demo и презентации клиента можно мягко перевести на нужный тариф.',
    plans: [
      {
        name: 'Starter',
        price: '49 ₼/мес',
        tag: 'Небольшой объект',
        features: ['POS и продажи', 'Столы и кухня', 'Z-report и daily reporting', '1 branded tenant'],
        cta: 'Проверить в demo',
      },
      {
        name: 'Growth',
        price: '99 ₼/мес',
        tag: 'Самый популярный',
        features: ['Finance и investor control', 'CRM и loyalty', 'Customer app', 'Приоритетный onboarding'],
        cta: 'Связаться с продажами',
        featured: true,
      },
      {
        name: 'Enterprise',
        price: 'Индивидуально',
        tag: 'Сети и rollout',
        features: ['White-label rollout', 'Индивидуальный branding', 'Пакет onboarding', 'Доп. интеграции'],
        cta: 'Получить предложение',
      },
    ],
    testimonialTitle: 'Система должна быть не только красивой',
    testimonialBody: 'Главная цель - чтобы owner, cashier и service team работали быстрее и спокойнее.',
    testimonials: [
      {
        quote: 'Когда касса и финансы в одном продукте, ежедневный контроль становится намного проще.',
        author: 'Murad R.',
        role: 'Coffee shop owner',
      },
      {
        quote: 'Когда кухня, столы и loyalty связаны, команде сервиса проще работать без хаоса.',
        author: 'Laman A.',
        role: 'Operations manager',
      },
      {
        quote: 'Demo tenant делает презентацию продукта и onboarding заметно профессиональнее.',
        author: 'Nigar S.',
        role: 'Brand consultant',
      },
    ],
    contactTitle: 'Запускайте demo, открывайте tenant, начинайте продажи',
    contactBody:
      'Связка landing -> demo tenant -> branded production tenant помогает и в продажах, и в onboarding.',
    contactCards: [
      { title: 'Demo tenant', text: 'Открытый live login и auto-reset demo environment.' },
      { title: 'Custom rollout', text: 'Branded subdomain, tenant settings и loyalty сценарии.' },
      { title: 'Sales CTA', text: 'WhatsApp, email и demo request flow для сбора лидов.' },
    ],
    finalTitle: 'Продавать продукт проще. Обучать команду легче.',
    finalBody:
      'Модель landing + demo + branded tenant усиливает и продажи, и первое внедрение.',
    launchModelTitle: 'Launch model',
    launchHosts: [
      ['www.ironwaves.store', 'Landing и презентация продукта'],
      ['demo.ironwaves.store', 'Живой demo tenant с очисткой'],
      ['super.ironwaves.store', 'Платформа и центр управления'],
      ['client-name.ironwaves.store', 'Branded production tenant'],
    ],
  },
  en: {
    nav: ['Home', 'Features', 'Pricing', 'Demo', 'Contact'],
    badge: 'iRonWaves POS RC',
    heroTitle: 'A premium POS platform for restaurants, coffee shops, and retail concepts',
    heroBody:
      'A modern operations system that connects sales, tables, kitchen, finance, CRM, loyalty, and a branded customer app inside one product.',
    primaryCta: 'Open Live Demo',
    secondaryCta: 'Open Platform',
    highlights: [
      { title: 'Touch-first UX', text: 'Large, fast, polished screens for cashier desks, tablets, and touch monitors.' },
      { title: 'Kitchen & Tables', text: 'Kitchen statuses, table flow, and service coordination move as one rhythm.' },
      { title: 'Finance Control', text: 'Cash drawer, investor flow, expenses, Z-report, and daily control in one place.' },
      { title: 'CRM & Loyalty', text: 'QR cards, cashback, rewards, and a branded customer app improve retention.' },
    ],
    sectionTitle: 'Your whole operation in one center',
    sectionBody:
      'This is more than a cashier screen. It brings daily operations, finance control, and customer loyalty into one connected system.',
    modules: [
      { title: 'POS Checkout', text: 'Fast sales, split payment, reward codes, QR recognition, and professional receipts.' },
      { title: 'Kitchen & Tables', text: 'Table management, kitchen statuses, dine-in, and service coordination.' },
      { title: 'Finance & Z-Report', text: 'Cash drawer, investor debt, income/expense, shifts, and daily reports.' },
      { title: 'Inventory & Recipes', text: 'Inventory, costing, recipes, ingredient consumption, and loss control.' },
      { title: 'CRM & Customer App', text: 'QR cards, campaigns, rewards, cashback, and a branded loyalty portal.' },
      { title: 'Multi-tenant Rollout', text: 'www, demo, super, and branded tenant subdomains for SaaS rollout.' },
    ],
    flowTitle: 'Sales and onboarding journey',
    flow: [
      { title: '1. A prospect lands on the website', text: 'The first impression quickly explains product value, screens, and rollout logic.' },
      { title: '2. They enter the demo tenant', text: 'They test live POS, finance, kitchen, and loyalty flows in a safe environment.' },
      { title: '3. They receive their own tenant', text: 'They launch on a branded subdomain with their own users, settings, and data.' },
    ],
    screenshotTitle: 'Real product screens',
    screenshotBody:
      'Instead of fake mockups, the page now showcases real product captures and loyalty card visuals.',
    screenshots: [
      { title: 'POS and checkout flow', text: 'Sales rhythm, touch-first menu, cart, and cashier experience.' },
      { title: 'Finance and control panel', text: 'Cash flow, reports, and daily operational visibility.' },
      { title: 'Loyalty card designs', text: 'Golden and Elite style club card experiences.' },
    ],
    pricingTitle: 'Simple plans, strong rollout',
    pricingBody:
      'After the demo and presentation, you can move the client into the right commercial tier without friction.',
    plans: [
      {
        name: 'Starter',
        price: '49 ₼/mo',
        tag: 'Small venue',
        features: ['POS and sales', 'Tables and kitchen', 'Z-report and daily reporting', '1 branded tenant'],
        cta: 'Try the demo',
      },
      {
        name: 'Growth',
        price: '99 ₼/mo',
        tag: 'Most popular',
        features: ['Finance and investor control', 'CRM and loyalty', 'Customer app', 'Priority onboarding'],
        cta: 'Talk to sales',
        featured: true,
      },
      {
        name: 'Enterprise',
        price: 'Custom',
        tag: 'Chains and rollout',
        features: ['White-label rollout', 'Custom branding', 'Onboarding package', 'Advanced integrations'],
        cta: 'Request a quote',
      },
    ],
    testimonialTitle: 'The product should do more than look good',
    testimonialBody:
      'The real goal is to make daily work smoother for owners, cashiers, and floor teams.',
    testimonials: [
      {
        quote: 'Having the cashier flow and finance controls inside one platform made daily visibility much easier.',
        author: 'Murad R.',
        role: 'Coffee shop owner',
      },
      {
        quote: 'When kitchen, tables, and loyalty move together, the service team makes fewer mistakes.',
        author: 'Laman A.',
        role: 'Operations manager',
      },
      {
        quote: 'The demo tenant makes product presentations and onboarding feel far more professional.',
        author: 'Nigar S.',
        role: 'Brand consultant',
      },
    ],
    contactTitle: 'Launch the demo, open a tenant, start selling',
    contactBody:
      'A landing -> demo tenant -> branded production tenant flow gives you a stronger story for both sales and onboarding.',
    contactCards: [
      { title: 'Demo tenant', text: 'Open live login and an auto-reset demo environment.' },
      { title: 'Custom rollout', text: 'Branded subdomains, tenant settings, and tailored loyalty scenarios.' },
      { title: 'Sales CTA', text: 'WhatsApp, email, and demo request flows for collecting leads.' },
    ],
    finalTitle: 'Sell the product better. Train the team faster.',
    finalBody:
      'A landing + demo + branded tenant model makes your product story stronger and your onboarding smoother.',
    launchModelTitle: 'Launch model',
    launchHosts: [
      ['www.ironwaves.store', 'Landing page and product presentation'],
      ['demo.ironwaves.store', 'Auto-reset live demo tenant'],
      ['super.ironwaves.store', 'Platform and control center'],
      ['client-name.ironwaves.store', 'Branded production tenant'],
    ],
  },
};

function ProductScreen() {
  return (
    <div className="relative mx-auto w-full max-w-[580px]">
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
                <div
                  key={idx}
                  className={`rounded-xl ${
                    idx === 1 ? 'bg-white text-[#3069dd]' : 'bg-white/15 text-white'
                  } px-3 py-2 text-[11px] font-semibold`}
                >
                  {idx === 0
                    ? 'POS'
                    : idx === 1
                      ? 'Menu'
                      : idx === 2
                        ? 'Tables'
                        : idx === 3
                          ? 'Kitchen'
                          : idx === 4
                            ? 'CRM'
                            : idx === 5
                              ? 'Stock'
                              : 'Finance'}
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
                    <div
                      className={`h-16 rounded-xl ${
                        idx % 3 === 0 ? 'bg-amber-200' : idx % 3 === 1 ? 'bg-sky-200' : 'bg-rose-200'
                      }`}
                    />
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

function ScreenshotCard({
  src,
  title,
  text,
  imageClassName = '',
}: {
  src: string;
  title: string;
  text: string;
  imageClassName?: string;
}) {
  return (
    <div className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
      <div className="bg-[linear-gradient(180deg,#f8fafc,#eef2ff)] p-4">
        <div className="overflow-hidden rounded-[22px] border border-slate-200 bg-white">
          <img src={src} alt={title} className={`h-72 w-full object-cover ${imageClassName}`} />
        </div>
      </div>
      <div className="p-6">
        <h3 className="text-2xl font-black text-slate-900">{title}</h3>
        <p className="mt-3 text-sm leading-7 text-slate-600">{text}</p>
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
                  <div className="text-2xl font-black leading-none text-slate-900">Premium POS Platform</div>
                </div>
              </div>

              <div className="hidden items-center gap-6 text-sm font-semibold text-slate-600 lg:flex">
                {copy.nav.map((item) => (
                  <button key={item} className="transition hover:text-indigo-600">
                    {item}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <div className="hidden rounded-full border border-slate-200 bg-white p-1 sm:flex">
                  {(['az', 'ru', 'en'] as LandingLang[]).map((code) => (
                    <button
                      key={code}
                      onClick={() => setLang(code)}
                      className={`rounded-full px-3 py-2 text-xs font-bold uppercase transition ${
                        lang === code ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:text-indigo-600'
                      }`}
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
              <h1 className="mt-8 text-5xl font-black leading-[1.02] text-slate-900 md:text-7xl">{copy.heroTitle}</h1>
              <p className="mt-6 max-w-xl text-base leading-8 text-slate-600 md:text-lg">{copy.heroBody}</p>

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
            {copy.highlights.map((item, idx) => (
              <div key={item.title} className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
                <div
                  className={`flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-[0_12px_24px_rgba(15,23,42,0.10)] ${
                    idx === 0 ? 'bg-violet-500' : idx === 1 ? 'bg-orange-500' : idx === 2 ? 'bg-sky-500' : 'bg-lime-500'
                  }`}
                >
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
                {copy.flow.map((step) => (
                  <div key={step.title} className="rounded-[24px] border border-white/10 bg-white/6 p-5">
                    <div className="text-lg font-bold text-white">{step.title}</div>
                    <div className="mt-2 text-sm leading-7 text-slate-300">{step.text}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              {copy.modules.map((item) => (
                <div key={item.title} className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.05)]">
                  <div className="text-xs font-bold uppercase tracking-[0.22em] text-indigo-600">Module</div>
                  <h3 className="mt-4 text-2xl font-black text-slate-900">{item.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{item.text}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="pb-20">
            <div className="mb-10 max-w-3xl">
              <div className="text-sm font-bold uppercase tracking-[0.22em] text-indigo-600">{copy.screenshotTitle}</div>
              <h2 className="mt-4 text-4xl font-black leading-tight text-slate-900">{copy.screenshotBody}</h2>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              <ScreenshotCard src="/landing/pos-screen.png" title={copy.screenshots[0].title} text={copy.screenshots[0].text} imageClassName="object-top" />
              <ScreenshotCard src="/landing/finance-screen.png" title={copy.screenshots[1].title} text={copy.screenshots[1].text} imageClassName="object-top" />
              <div className="grid gap-6">
                <ScreenshotCard src="/landing/golden-card.png" title={copy.screenshots[2].title} text={copy.screenshots[2].text} imageClassName="object-contain bg-[linear-gradient(180deg,#f8fafc,#fff7ed)] p-4" />
                <ScreenshotCard src="/landing/elite-card.png" title="Premium loyalty visuals" text="Golden və Elite kimi loyalty səviyyələrini vizual olaraq fərqləndirən branded kartlar." imageClassName="object-contain bg-[linear-gradient(180deg,#f8fafc,#eef2ff)] p-4" />
              </div>
            </div>
          </section>

          <section className="pb-20">
            <div className="mb-10 max-w-3xl">
              <div className="text-sm font-bold uppercase tracking-[0.22em] text-indigo-600">Pricing</div>
              <h2 className="mt-4 text-4xl font-black leading-tight text-slate-900">{copy.pricingTitle}</h2>
              <p className="mt-4 text-sm leading-8 text-slate-600">{copy.pricingBody}</p>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              {copy.plans.map((plan) => (
                <div
                  key={plan.name}
                  className={`rounded-[32px] border p-7 shadow-[0_20px_50px_rgba(15,23,42,0.06)] ${
                    plan.featured
                      ? 'border-indigo-300 bg-[linear-gradient(180deg,#eef2ff,#ffffff)]'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.22em] text-indigo-600">{plan.tag}</div>
                      <h3 className="mt-3 text-3xl font-black text-slate-900">{plan.name}</h3>
                    </div>
                    {plan.featured ? (
                      <div className="rounded-full bg-indigo-600 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-white">Best fit</div>
                    ) : null}
                  </div>
                  <div className="mt-6 text-4xl font-black text-slate-900">{plan.price}</div>
                  <div className="mt-6 space-y-3">
                    {plan.features.map((feature) => (
                      <div key={feature} className="flex items-start gap-3 text-sm text-slate-600">
                        <div className="mt-1 h-2.5 w-2.5 rounded-full bg-indigo-500" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                  <a
                    href={plan.featured ? appUrl : demoUrl}
                    className={`mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-2xl px-5 py-3 text-sm font-bold ${
                      plan.featured
                        ? 'bg-[linear-gradient(180deg,#6366f1,#4f46e5)] text-white shadow-[0_16px_30px_rgba(99,102,241,0.22)]'
                        : 'border border-slate-200 bg-white text-slate-800'
                    }`}
                  >
                    {plan.cta}
                  </a>
                </div>
              ))}
            </div>
          </section>

          <section className="pb-20">
            <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
              <div>
                <div className="text-sm font-bold uppercase tracking-[0.22em] text-indigo-600">{copy.testimonialTitle}</div>
                <h2 className="mt-4 text-4xl font-black leading-tight text-slate-900">{copy.testimonialBody}</h2>
              </div>
              <div className="grid gap-5">
                {copy.testimonials.map((item) => (
                  <div key={item.author} className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_16px_36px_rgba(15,23,42,0.05)]">
                    <p className="text-base leading-8 text-slate-700">"{item.quote}"</p>
                    <div className="mt-5">
                      <div className="font-black text-slate-900">{item.author}</div>
                      <div className="text-sm text-slate-500">{item.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="pb-24">
            <div className="rounded-[36px] bg-[linear-gradient(135deg,#eef2ff,#ffffff,#ecfeff)] p-8 shadow-[0_24px_60px_rgba(15,23,42,0.06)] md:p-10">
              <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
                <div>
                  <div className="text-sm font-bold uppercase tracking-[0.22em] text-indigo-600">{copy.contactTitle}</div>
                  <h2 className="mt-4 text-4xl font-black leading-tight text-slate-900">{copy.finalTitle}</h2>
                  <p className="mt-5 text-sm leading-8 text-slate-600">{copy.contactBody}</p>
                  <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <a
                      href={demoUrl}
                      className="inline-flex min-h-13 items-center justify-center rounded-2xl bg-[linear-gradient(180deg,#6366f1,#4f46e5)] px-7 py-3 text-base font-bold text-white shadow-[0_16px_30px_rgba(99,102,241,0.22)]"
                    >
                      {copy.primaryCta}
                    </a>
                    <a
                      href="mailto:hello@ironwaves.store"
                      className="inline-flex min-h-13 items-center justify-center rounded-2xl border border-slate-200 bg-white px-7 py-3 text-base font-semibold text-slate-800"
                    >
                      hello@ironwaves.store
                    </a>
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="rounded-[30px] border border-white/70 bg-white p-6 shadow-[0_16px_32px_rgba(15,23,42,0.05)]">
                    <div className="text-sm font-bold uppercase tracking-[0.22em] text-slate-500">{copy.launchModelTitle}</div>
                    <div className="mt-5 space-y-4">
                      {copy.launchHosts.map(([host, text]) => (
                        <div key={host} className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                          <div className="font-semibold text-slate-900">{host}</div>
                          <div className="mt-1 text-sm text-slate-600">{text}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    {copy.contactCards.map((card) => (
                      <div key={card.title} className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_12px_28px_rgba(15,23,42,0.04)]">
                        <div className="text-sm font-black text-slate-900">{card.title}</div>
                        <div className="mt-2 text-sm leading-7 text-slate-600">{card.text}</div>
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

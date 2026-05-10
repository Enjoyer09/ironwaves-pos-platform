import { useEffect, useMemo, useState } from "react";
import { get_public_landing_settings_live } from "../api/settings";

type Lang = "az" | "ru" | "en";
type DemoGuideState = { label: string; x: number; y: number };
type ActionGuideState = { text: string; x: number; y: number };

const COPY: Record<Lang, any> = {
  az: {
    nav: ["Məhsul", "Necə işləyir", "Modullar", "Əlaqə"],
    badge: "Enterprise Restaurant Platform",
    headline: "Restoranınızı bir platformadan idarə edin",
    sub: "POS, Masalar, Mətbəx, Maliyyə, Dashboard, Analitika, CRM, QR Menu və Audit bir sistemdə.",
    ctaPrimary: "Demoya keç",
    ctaSecondary: "Canlı platforma",
    trust: ["Masa axını", "Mətbəx nəzarəti", "Kassa nəzarəti", "Canlı dashboard"],
    problemTitle: "Əsas əməliyyat problemləri",
    problems: [
      "Sifariş və masa axını qarışır",
      "Mətbəx gecikmələri gec görünür",
      "Kassa və maliyyə fərqləri yaranır",
    ],
    solutionTitle: "iRonWaves həlli",
    solutions: [
      "POS, masalar və KDS bir axında işləyir",
      "Dashboard və alert-lərlə anlıq nəzarət",
      "Maliyyə, audit və loglarla tam izlənmə",
    ],
    howTitle: "Necə işləyir",
    steps: [
      "Satışı və ya masanı aç",
      "Sifarişi mətbəxə göndər",
      "Ödənişi tamamla və hesabatı bağla",
      "Dashboard və maliyyədən nəticəni izlət",
    ],
    modulesTitle: "Bütün əsas modullar eyni platformada",
    modules: [
      "POS",
      "Masalar",
      "Mətbəx ekranı (KDS)",
      "Maliyyə",
      "Dashboard",
      "Analitika",
      "Z/X Hesabat",
      "CRM / Loyallıq",
      "QR Menu",
      "Loglar və Audit",
      "Customer App",
      "Tenant idarəetməsi",
    ],
    whyTitle: "Niyə iRonWaves POS?",
    why: [
      "POS, masalar və mətbəx axını bir-birinə bağlı işləyir",
      "Maliyyə, depozit və investor borcu real vaxtda görünür",
      "Loglar və audit izi ilə əməliyyatlar izlənir",
      "Rol əsaslı icazələr və multi-tenant idarəetmə hazırdır",
    ],
    contactTitle: "Əlaqə",
    footer: "ironWaves POS bir Laptop Market məhsuludur. www.laptopmarket.az",
    phoneLabel: "Telefon",
    mailLabel: "E-poçt",
    waLabel: "WhatsApp",
  },
  ru: {
    nav: ["Продукт", "Как работает", "Модули", "Контакт"],
    badge: "Enterprise Restaurant Platform",
    headline: "Управляйте рестораном с одной платформы",
    sub: "POS, Столы, Кухня, Финансы, Dashboard, Аналитика, CRM, QR Menu и Audit в одной системе.",
    ctaPrimary: "Перейти к демо",
    ctaSecondary: "Открыть платформу",
    trust: ["Поток столов", "Контроль кухни", "Контроль кассы", "Live dashboard"],
    problemTitle: "Ключевые операционные проблемы",
    problems: [
      "Путается поток заказов и столов",
      "Задержки кухни видны слишком поздно",
      "Появляются расхождения кассы и финансов",
    ],
    solutionTitle: "Решение iRonWaves",
    solutions: [
      "POS, столы и KDS работают как единый поток",
      "Мгновенный контроль через dashboard и alerts",
      "Полная прослеживаемость через финансы, audit и логи",
    ],
    howTitle: "Как это работает",
    steps: [
      "Откройте продажу или стол",
      "Отправьте заказ на кухню",
      "Завершите оплату и закройте отчёт",
      "Отслеживайте итог в dashboard и финансах",
    ],
    modulesTitle: "Все ключевые модули в одной платформе",
    modules: [
      "POS",
      "Столы",
      "Экран кухни (KDS)",
      "Финансы",
      "Dashboard",
      "Аналитика",
      "Z/X Отчет",
      "CRM / Лояльность",
      "QR Menu",
      "Логи и Audit",
      "Customer App",
      "Управление tenant",
    ],
    whyTitle: "Почему iRonWaves POS?",
    why: [
      "POS, столы и кухня работают как единый поток",
      "Финансы, депозиты и долг инвестору видны в реальном времени",
      "Операции отслеживаются через логи и аудит",
      "Готовы ролевые доступы и multi-tenant управление",
    ],
    contactTitle: "Контакты",
    footer: "ironWaves POS — продукт Laptop Market. www.laptopmarket.az",
    phoneLabel: "Телефон",
    mailLabel: "E-mail",
    waLabel: "WhatsApp",
  },
  en: {
    nav: ["Product", "How it works", "Modules", "Contact"],
    badge: "Enterprise Restaurant Platform",
    headline: "Run your restaurant from one platform",
    sub: "POS, Tables, Kitchen, Finance, Dashboard, Analytics, CRM, QR Menu and Audit in one system.",
    ctaPrimary: "Go to demo",
    ctaSecondary: "Open platform",
    trust: ["Table flow", "Kitchen control", "Cash control", "Live dashboard"],
    problemTitle: "Core operational problems",
    problems: [
      "Order and table flow gets mixed up",
      "Kitchen delays are noticed too late",
      "Cash and finance variances keep appearing",
    ],
    solutionTitle: "iRonWaves solution",
    solutions: [
      "POS, tables and KDS work in one flow",
      "Instant control with dashboard and alerts",
      "Full traceability with finance, audit and logs",
    ],
    howTitle: "How it works",
    steps: [
      "Open a sale or table",
      "Send the order to kitchen",
      "Complete payment and close report",
      "Track outcomes in dashboard and finance",
    ],
    modulesTitle: "All core modules in one platform",
    modules: [
      "POS",
      "Tables",
      "Kitchen display (KDS)",
      "Finance",
      "Dashboard",
      "Analytics",
      "Z/X Report",
      "CRM / Loyalty",
      "QR Menu",
      "Logs & Audit",
      "Customer App",
      "Tenant management",
    ],
    whyTitle: "Why iRonWaves POS?",
    why: [
      "POS, tables and kitchen flow are fully connected",
      "Finance, deposits and investor liability are visible in real time",
      "Operations are traceable with logs and audit",
      "Role-based access and multi-tenant management are production-ready",
    ],
    contactTitle: "Contact",
    footer: "ironWaves POS is a Laptop Market product. www.laptopmarket.az",
    phoneLabel: "Phone",
    mailLabel: "Email",
    waLabel: "WhatsApp",
  },
};

const DEFAULT_SHOTS = [
  ["POS Ekranı", "/landing/pos-screen.png", "Sürətli sifariş və ödəniş axını"],
  ["Maliyyə Ekranı", "/landing/finance-screen.png", "Kassa, depozit və investor borcu nəzarəti"],
  ["Golden Card", "/landing/golden-card.png", "Loyallıq kartı və bonus ssenariləri"],
  ["Elite Card", "/landing/elite-card.png", "VIP müştəri segmenti və üstünlüklər"],
];

const BLOCKED_IMAGE_TERMS = [
  "tim hortons",
  "timhortons",
  "qr",
  "qrcode",
  "emalatxana",
  "emalatkhana",
];

const ALLOWED_INTERNAL_SHOTS = new Set([
  "/landing/pos-screen.png",
  "/landing/finance-screen.png",
  "/landing/golden-card.png",
  "/landing/elite-card.png",
]);

export default function LandingPage() {
  const [lang, setLang] = useState<Lang>("az");
  const [slideIndex, setSlideIndex] = useState(0);
  const [liveSettings, setLiveSettings] = useState<any | null>(null);
  const [demoGuideOpen, setDemoGuideOpen] = useState(true);
  const [demoGuide, setDemoGuide] = useState<DemoGuideState | null>(null);
  const [selectedGuideLabel, setSelectedGuideLabel] = useState("POS");
  const [actionGuide, setActionGuide] = useState<ActionGuideState | null>(null);
  const c = COPY[lang];

  const getModuleGuideText = (label: string) => {
    const key = String(label || "").toLowerCase();
    if (key.includes("pos")) return lang === "az" ? "Satışı başlayın, səbəti tamamlayın, ödənişi bağlayın." : lang === "ru" ? "Начните продажу, завершите корзину, закройте оплату." : "Start sale, complete cart, close payment.";
    if (key.includes("masa") || key.includes("table")) return lang === "az" ? "Masa açın, sifarişi mətbəxə göndərin, hesabı bağlayın." : lang === "ru" ? "Откройте стол, отправьте заказ на кухню, закройте счет." : "Open table, send order to kitchen, close bill.";
    if (key.includes("mətbəx") || key.includes("kitchen") || key.includes("kds")) return lang === "az" ? "Yeni sifarişi götürün, statusu yeniləyin, hazırı servisə ötürün." : lang === "ru" ? "Примите новый заказ, обновите статус, передайте готовое в сервис." : "Pick new orders, update status, hand over ready items.";
    if (key.includes("maliyy") || key.includes("finance")) return lang === "az" ? "Overview, action və audit axınını modul daxilində ayrıca idarə edin." : lang === "ru" ? "Управляйте overview, action и audit как отдельными режимами." : "Control overview, action, and audit as separate modes.";
    if (key.includes("anbar") || key.includes("inventory")) return lang === "az" ? "İlk xammalı yaradın, limit qoyun, hərəkətləri sənədləşdirin." : lang === "ru" ? "Создайте первый ингредиент, задайте лимит, фиксируйте движения." : "Create first stock item, set limit, record movements.";
    if (key.includes("menu") || key.includes("menyu")) return lang === "az" ? "İlk məhsulu ad+qiymətlə yaradın, sonra reseptə bağlayın." : lang === "ru" ? "Создайте первый товар с ценой, затем привяжите рецепт." : "Create first priced item, then attach recipe.";
    if (key.includes("resept") || key.includes("recipe")) return lang === "az" ? "Menyu məhsulunu xammalla bağlayıb maya dəyərini idarə edin." : lang === "ru" ? "Свяжите позицию меню с ингредиентами и управляйте себестоимостью." : "Link menu item to ingredients and control cost.";
    return lang === "az" ? "Bu modul əməliyyat axınının bir hissəsidir və bir kliklə açılır." : lang === "ru" ? "Этот модуль часть операционного потока и открывается в один клик." : "This module is part of the operational flow and opens in one click.";
  };

  const handleDemoGuideHover = (label: string, event: React.MouseEvent<HTMLElement>) => {
    if (!demoGuideOpen || typeof window === "undefined") return;
    const width = 300;
    const height = 116;
    const x = Math.min(window.innerWidth - width - 10, event.clientX + 12);
    const y = Math.min(window.innerHeight - height - 10, event.clientY + 12);
    setDemoGuide({ label, x: Math.max(10, x), y: Math.max(10, y) });
    setSelectedGuideLabel(label);
  };

  const handleActionGuideHover = (text: string, event: React.MouseEvent<HTMLElement>) => {
    if (typeof window === "undefined") return;
    const width = 300;
    const height = 90;
    const x = Math.min(window.innerWidth - width - 10, event.clientX + 10);
    const y = Math.min(window.innerHeight - height - 10, event.clientY + 10);
    setActionGuide({ text, x: Math.max(10, x), y: Math.max(10, y) });
  };

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevHeight = document.body.style.height;
    document.body.style.overflow = "auto";
    document.body.style.height = "auto";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.height = prevHeight;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    const CLEANUP_FLAG = "iw-landing-sw-reset-v1";
    if (window.localStorage.getItem(CLEANUP_FLAG) === "done") return;
    void (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((reg) => reg.unregister()));
      } catch {
        // ignore
      }
      try {
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
      } catch {
        // ignore
      }
      try {
        window.localStorage.setItem(CLEANUP_FLAG, "done");
      } catch {
        // ignore
      }
      try {
        window.location.reload();
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await get_public_landing_settings_live();
        if (mounted) setLiveSettings(data || null);
      } catch {
        // Keep default copy
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const slides = useMemo(() => {
    const rows = Array.isArray(liveSettings?.screenshot_items)
      ? liveSettings.screenshot_items
      : DEFAULT_SHOTS.map(([title, image_url, desc]) => ({
          image_url,
          title_az: title,
          title_ru: title,
          title_en: title,
          desc_az: desc,
          desc_ru: desc,
          desc_en: desc,
        }));
    const mapped = rows
      .filter((row: any) => String(row?.image_url || "").trim())
      .map((row: any) => {
        const title = String(row?.[`title_${lang}`] || row?.title_az || row?.title_en || row?.title_ru || "").trim();
        const desc = String(row?.[`desc_${lang}`] || row?.desc_az || row?.desc_en || row?.desc_ru || "").trim();
        return [title || "Slide", String(row.image_url), desc || ""] as [string, string, string];
      })
      .filter(([title, src, desc]) => {
        const hay = `${title} ${src} ${desc}`.toLowerCase();
        return !BLOCKED_IMAGE_TERMS.some((term) => hay.includes(term));
      });
    const internalOnly = mapped.filter(([, src]) => ALLOWED_INTERNAL_SHOTS.has(String(src || "").trim().toLowerCase()));
    return internalOnly.length ? internalOnly : (DEFAULT_SHOTS as [string, string, string][]);
  }, [liveSettings, lang]);

  useEffect(() => {
    const size = Math.max(1, slides.length || DEFAULT_SHOTS.length);
    const timer = window.setInterval(() => {
      setSlideIndex((prev) => (prev + 1) % size);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [slides.length]);

  const activeSlide = slides.length ? slides[slideIndex % slides.length] : (DEFAULT_SHOTS[0] as [string, string, string]);
  const [slideTitle, slideImage, slideDesc] = activeSlide;

  const navLabels = [
    String(liveSettings?.[`nav_product_${lang}`] || c.nav[0] || "").trim(),
    String(liveSettings?.[`nav_how_${lang}`] || c.nav[1] || "").trim(),
    String(liveSettings?.[`nav_modules_${lang}`] || c.nav[2] || "").trim(),
    String(liveSettings?.[`nav_contact_${lang}`] || c.nav[3] || "").trim(),
  ];

  const heroTitle = String(liveSettings?.[`hero_title_${lang}`] || c.headline || "").trim();
  const heroBody = String(liveSettings?.[`hero_body_${lang}`] || c.sub || "").trim();
  const ctaPrimary = String(liveSettings?.[`primary_cta_${lang}`] || c.ctaPrimary || "").trim();
  const modulesTitle = String(liveSettings?.[`modules_title_${lang}`] || c.modulesTitle || "").trim();
  const footerText = String(liveSettings?.[`footer_text_${lang}`] || c.footer || "").trim();

  const phone = String(liveSettings?.contact_phone || "+99455 299-92-82").trim();
  const email = String(liveSettings?.contact_email || "abbas@laptopmarket.az").trim();
  const whatsapp = String(liveSettings?.contact_whatsapp || phone).trim();
  const whatsappLink = `https://wa.me/${whatsapp.replace(/[^\d]/g, "")}`;

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#4a4a4f] px-4 py-6 text-[#fff7e6] md:px-8 md:py-10">
      <div className="mx-auto w-full max-w-[1080px]">
      <div className="pb-5 pt-2 text-center">
        <div className="text-2xl font-black tracking-[0.08em] text-[#fff4dc]">LANDING PAGE TEMPLATE</div>
        <div className="text-sm text-[#f3dfbe]">Coffee Shop</div>
      </div>

      <section id="mehsul" className="rounded-sm border border-[#292421] bg-[#f1c533] p-0 shadow-[0_14px_26px_rgba(0,0,0,0.45)]">
        <header className="border-b border-[#d4a723]/80 px-5 py-3 md:px-8">
          <div className="flex items-center justify-between gap-3">
            <nav className="flex flex-wrap items-center gap-5 text-xs font-semibold uppercase tracking-[0.08em] text-[#3c2e1f] md:gap-8">
            {navLabels.map((item: string, idx: number) => (
              <a
                key={item || idx}
                href={idx === 0 ? "#mehsul" : idx === 1 ? "#isleyis" : idx === 2 ? "#modullar" : "#elaqe"}
                className={idx === 0 ? "text-[#c33e2e]" : "transition hover:text-[#c33e2e]"}
                onMouseEnter={(e) => handleActionGuideHover(idx === 0 ? "Məhsul bölməsinə keçid edir." : idx === 1 ? "İş axını bölməsini göstərir." : idx === 2 ? "Bütün modullar siyahısını açır." : "Əlaqə məlumatlarına aparır.", e)}
                onMouseMove={(e) => handleActionGuideHover(idx === 0 ? "Məhsul bölməsinə keçid edir." : idx === 1 ? "İş axını bölməsini göstərir." : idx === 2 ? "Bütün modullar siyahısını açır." : "Əlaqə məlumatlarına aparır.", e)}
                onMouseLeave={() => setActionGuide(null)}
              >
                {item || c.nav[idx]}
              </a>
            ))}
            </nav>
            <div className="hidden items-center gap-2 md:flex">
            {(["az", "ru", "en"] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={l === lang ? "rounded-full border border-[#3c2e1f] bg-[#fff0c7] px-2.5 py-1 text-[10px] font-bold text-[#3a2b1d]" : "rounded-full border border-[#3c2e1f66] bg-[#f5ce57] px-2.5 py-1 text-[10px] font-semibold text-[#3a2b1d]"}
                onMouseEnter={(e) => handleActionGuideHover("İnterfeys dilini dəyişir.", e)}
                onMouseMove={(e) => handleActionGuideHover("İnterfeys dilini dəyişir.", e)}
                onMouseLeave={() => setActionGuide(null)}
              >
                {l.toUpperCase()}
              </button>
            ))}
            <button
                type="button"
                onClick={() => {
                  setDemoGuideOpen((prev) => !prev);
                  if (demoGuideOpen) setDemoGuide(null);
                }}
              className={demoGuideOpen ? "rounded-full border border-[#3c2e1f] bg-[#fff0c7] px-3 py-1 text-[10px] font-bold text-[#3a2b1d]" : "rounded-full border border-[#3c2e1f66] bg-[#f5ce57] px-3 py-1 text-[10px] font-semibold text-[#3a2b1d]"}
              onMouseEnter={(e) => handleActionGuideHover("Demo bələdçisini açır və ya bağlayır.", e)}
              onMouseMove={(e) => handleActionGuideHover("Demo bələdçisini açır və ya bağlayır.", e)}
              onMouseLeave={() => setActionGuide(null)}
            >
              Bələdçi
            </button>
              <a
              href="https://demo.ironwaves.store"
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-[#9a4220] bg-[#d94f2b] px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-[#fff3d8]"
              onMouseEnter={(e) => handleActionGuideHover("Canlı demo platformasını yeni tabda açır.", e)}
              onMouseMove={(e) => handleActionGuideHover("Canlı demo platformasını yeni tabda açır.", e)}
              onMouseLeave={() => setActionGuide(null)}
            >
              {ctaPrimary}
            </a>
            </div>
          </div>
        </header>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.15fr]">
          <div className="relative p-6 md:p-8">
            <div className="text-sm font-black tracking-[0.2em] text-[#603f17]">***</div>
            <h1 className="mt-2 max-w-[380px] text-[34px] font-black uppercase leading-[0.97] text-[#22140f] md:text-[50px]">{heroTitle}</h1>
            <p className="mt-4 max-w-[360px] text-sm leading-5 text-[#4c2f1d]">{heroBody}</p>
            <div className="mt-6">
                <a
                  href="https://demo.ironwaves.store"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-[#9a4220] bg-[#d94f2b] px-6 py-2.5 text-sm font-bold text-[#fff3d8]"
                >
                  {ctaPrimary}
                </a>
            </div>
            <div className="mt-10 flex items-center justify-between text-xs font-semibold text-[#57361e]">
              <span>www.ironwaves.store</span>
              <span>● ● ● ●</span>
            </div>
          </div>
          <div className="relative h-[280px] overflow-hidden border-l border-[#d4a723]/80 md:h-[360px]">
            <img src="/landing/barista-template.png" alt="Barista hero" className="h-full w-full object-cover object-center" />
            <div className="absolute left-[-26px] top-[-26px] h-[120px] w-[120px] rounded-full bg-[#f1c533]" />
            <div className="absolute left-4 top-[42%] rounded-full bg-[#323234e6] px-3 py-2 text-xs font-black text-[#ffdc88]">30% OFF</div>
            <div className="absolute left-1/2 top-[31%] -translate-x-1/2 rounded-full bg-[#1f1f1fe0] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#ffe5a8]">
              iRonWaves Coffee POS
            </div>
            <div className="absolute bottom-4 left-4 right-4 rounded-xl bg-[#252525cc] px-3 py-2 text-xs font-semibold text-[#ffe5a8]">
              {slideDesc || slideTitle}
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-center gap-2">
          {slides.map((s, idx) => (
            <button
              key={`${s[0]}_${idx}`}
              type="button"
              onClick={() => setSlideIndex(idx)}
              className={idx === slideIndex ? "h-2.5 w-7 rounded-full bg-[#f59e0b]" : "h-2.5 w-2.5 rounded-full bg-[#7b5a43]"}
              aria-label={`slide-${idx + 1}`}
            />
          ))}
        </div>
      </section>

      <section className="pb-4 pt-6 text-center text-xs text-[#e9d4ab]">
        <img src="/landing/ironwaves-logo.jpeg" alt="iRonWaves" className="mx-auto mb-2 h-8 w-auto rounded-md object-contain" />
        <div>iRonWaves POS</div>
      </section>

      <section className="mx-auto max-w-[1280px] px-4 pb-8 md:px-8">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-[#f6c86c30] bg-[#2b1714] p-5">
            <h2 className="mb-3 text-lg font-extrabold text-[#ffb3a0]">{c.problemTitle}</h2>
            <div className="space-y-2">
              {c.problems.map((item: string) => (
                <div key={item} className="flex items-start gap-2 text-sm text-[#f6d7ad]">
                  <span className="mt-1 inline-block h-2 w-2 rounded-full bg-[#f97316]" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-[#f6c86c30] bg-[#2b1714] p-5">
            <h2 className="mb-3 text-lg font-extrabold text-[#ffd48b]">{c.solutionTitle}</h2>
            <div className="space-y-2">
              {c.solutions.map((item: string) => (
                <div key={item} className="flex items-start gap-2 text-sm text-[#f6d7ad]">
                  <span className="mt-1 inline-block h-2 w-2 rounded-full bg-[#f59e0b]" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="isleyis" className="mx-auto max-w-[1280px] px-4 pb-8 md:px-8">
        <div className="rounded-2xl border border-[#f6c86c30] bg-[#2b1714] p-5">
          <h2 className="mb-4 text-2xl font-extrabold text-[#fff0d0]">{c.howTitle}</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            {c.steps.map((step: string, idx: number) => (
              <div key={step} className="rounded-xl border border-[#f6c86c30] bg-[#201310] p-4">
                <div className="mb-2 text-xs font-black text-[#f59e0b]">0{idx + 1}</div>
                <div className="text-sm text-[#f8e5c4]">{step}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-[#f6c86c2c] bg-[#1d120f]">
        <div className="mx-auto max-w-[1280px] overflow-hidden px-4 py-4 md:px-6">
          <div className="flex w-max animate-marquee gap-2">
            {[...c.modules, ...c.modules].map((tab: string, idx: number) => (
              <span
                key={`${tab}_${idx}`}
                className={idx % 7 === 0 ? "whitespace-nowrap rounded-full border border-[#ffca6a] bg-[#f59e0b] px-3 py-2 text-xs font-bold text-[#25140f]" : "whitespace-nowrap rounded-full border border-[#f6c86c55] bg-[#2c1a15] px-3 py-2 text-xs font-semibold text-[#f6d7ad]"}
                onMouseEnter={(e) => handleDemoGuideHover(tab, e)}
                onMouseMove={(e) => handleDemoGuideHover(tab, e)}
                onMouseLeave={() => setDemoGuide(null)}
                onClick={() => setSelectedGuideLabel(tab)}
              >
                {tab}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section id="modullar" className="mx-auto max-w-[1280px] px-4 py-14 md:px-8">
        <h2 className="mb-6 text-2xl font-extrabold text-[#fff0d0] md:text-3xl">{modulesTitle}</h2>
        <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {c.modules.map((item: string) => (
            <div
              key={item}
              className="rounded-xl border border-[#f6c86c30] bg-[#2b1714] p-4"
              onMouseEnter={(e) => handleDemoGuideHover(item, e)}
              onMouseMove={(e) => handleDemoGuideHover(item, e)}
              onMouseLeave={() => setDemoGuide(null)}
              onClick={() => setSelectedGuideLabel(item)}
            >
              <div className="text-sm font-bold text-[#fff0d0]">{item}</div>
              <div className="mt-2 text-xs leading-5 text-[#f6d7ad]">iRonWaves Platform daxilində inteqrasiya olunmuş modul.</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {slides.map(([title, src, desc], idx) => (
            <article key={`${title}_${idx}`} className="overflow-hidden rounded-xl border border-[#f6c86c30] bg-[#2b1714]">
              <img src={src} alt={title} className="h-52 w-full object-cover transition duration-700 hover:scale-[1.03]" />
              <div className="p-4">
                <h3 className="text-base font-bold text-[#fff0d0]">{title}</h3>
                <p className="mt-1 text-sm text-[#f6d7ad]">{desc}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-[1280px] grid-cols-1 gap-6 px-4 pb-14 md:px-8 lg:grid-cols-2">
        <div className="rounded-2xl border border-[#f6c86c30] bg-[#2b1714] p-6">
          <h3 className="mb-4 text-xl font-extrabold text-[#fff0d0]">{c.whyTitle}</h3>
          <div className="space-y-3">
            {c.why.map((item: string) => (
              <div key={item} className="flex items-start gap-3 text-sm text-[#f6d7ad]">
                <span className="mt-1 inline-block h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div id="elaqe" className="rounded-2xl border border-[#f6c86c30] bg-[#2b1714] p-6">
          <h3 className="mb-4 text-xl font-extrabold text-[#fff0d0]">{c.contactTitle}</h3>
          <div className="space-y-3 text-sm text-[#f6d7ad]">
            <a href={`tel:${phone.replace(/\s+/g, "")}`} className="flex items-center justify-between rounded-lg border border-[#f6c86c2b] bg-[#201310] px-3 py-2">
              <span>{c.phoneLabel}</span>
              <span>{phone}</span>
            </a>
            <a href={`mailto:${email}`} className="flex items-center justify-between rounded-lg border border-[#f6c86c2b] bg-[#201310] px-3 py-2">
              <span>{c.mailLabel}</span>
              <span>{email}</span>
            </a>
            <a href={whatsappLink} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-lg border border-[#f6c86c2b] bg-[#201310] px-3 py-2">
              <span>{c.waLabel}</span>
              <span>{whatsapp}</span>
            </a>
            <a
              href="https://demo.ironwaves.store"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex w-full items-center justify-center rounded-full border border-[#ffca6a] bg-gradient-to-r from-[#f59e0b] to-[#fb923c] px-4 py-3 text-sm font-extrabold text-[#25140f] shadow-[0_8px_20px_rgba(245,158,11,0.32)]"
              onMouseEnter={(e) => handleActionGuideHover("Demo mühitinə keçid edir.", e)}
              onMouseMove={(e) => handleActionGuideHover("Demo mühitinə keçid edir.", e)}
              onMouseLeave={() => setActionGuide(null)}
            >
              {ctaPrimary}
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#f6c86c24] px-4 py-5 text-center text-xs text-[#d8bb96] md:px-6">{footerText}</footer>
      {demoGuideOpen && demoGuide && (
        <div
          className="pointer-events-none fixed z-[80] w-[300px] rounded-2xl border border-cyan-300/35 bg-slate-950/90 p-3 shadow-[0_14px_42px_rgba(0,0,0,0.45)] backdrop-blur"
          style={{ left: demoGuide.x, top: demoGuide.y }}
        >
          <div className="text-[11px] uppercase tracking-[0.14em] text-cyan-200">Demo Guide</div>
          <div className="mt-1 text-xs font-semibold text-slate-100">{demoGuide.label}</div>
          <div className="mt-1 text-xs text-slate-300">{getModuleGuideText(demoGuide.label)}</div>
        </div>
      )}
      {actionGuide && (
        <div
          className="pointer-events-none fixed z-[81] w-[300px] rounded-2xl border border-emerald-300/35 bg-[#0b1220]/92 p-3 shadow-[0_14px_42px_rgba(0,0,0,0.5)] backdrop-blur"
          style={{ left: actionGuide.x, top: actionGuide.y }}
        >
          <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-200">Düymə Bələdçisi</div>
          <div className="mt-1 text-xs text-slate-100">{actionGuide.text}</div>
        </div>
      )}
      {demoGuideOpen && (
        <div className="fixed bottom-4 right-4 z-[79] w-[320px] max-w-[calc(100vw-1rem)] rounded-2xl border border-yellow-300/35 bg-slate-950/92 p-3 shadow-[0_16px_46px_rgba(0,0,0,0.5)] backdrop-blur">
          <div className="text-[11px] uppercase tracking-[0.14em] text-yellow-200">Demo Bələdçisi</div>
          <div className="mt-1 text-xs font-semibold text-slate-100">{selectedGuideLabel}</div>
          <div className="mt-1 text-xs text-slate-300">{getModuleGuideText(selectedGuideLabel)}</div>
          <div className="mt-2 text-[11px] text-slate-400">İpucu: modul kartına toxunun və ya cursor yaxınlaşdırın.</div>
        </div>
      )}
      </div>
    </div>
  );
}

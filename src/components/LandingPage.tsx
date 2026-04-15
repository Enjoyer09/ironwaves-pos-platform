import { useEffect, useMemo, useState } from "react";
import { get_public_landing_settings_live } from "../api/settings";

type Lang = "az" | "ru" | "en";

const COPY: Record<Lang, any> = {
  az: {
    nav: ["Məhsul", "Necə işləyir", "Modullar", "Əlaqə"],
    badge: "Enterprise Restaurant Platform",
    headline: "Restoranınızı bir platformadan idarə edin",
    sub: "POS, Masalar, Mətbəx, Maliyyə, Dashboard, Analitika, CRM, QR Menu və Audit bir sistemdə.",
    ctaPrimary: "Demoya keç",
    ctaSecondary: "Ətraflı bax",
    trust: ["Masa axını", "Mətbəx nəzarəti", "Kassa nəzarəti", "Canlı dashboard"],
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
    contactTitle: "Əlaqə formu",
    form: ["Ad", "Biznes adı", "Telefon", "Obyekt növü", "Qısa qeyd"],
    submit: "Demo istə",
    footer: "ironWaves POS bir Laptop Market məhsuludur. www.laptopmarket.az",
  },
  ru: {
    nav: ["Продукт", "Как работает", "Модули", "Контакт"],
    badge: "Enterprise Restaurant Platform",
    headline: "Управляйте рестораном с одной платформы",
    sub: "POS, Столы, Кухня, Финансы, Dashboard, Аналитика, CRM, QR Menu и Audit в одной системе.",
    ctaPrimary: "Перейти к демо",
    ctaSecondary: "Подробнее",
    trust: ["Поток столов", "Контроль кухни", "Контроль кассы", "Live dashboard"],
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
    contactTitle: "Форма связи",
    form: ["Имя", "Название бизнеса", "Телефон", "Тип объекта", "Короткая заметка"],
    submit: "Запросить демо",
    footer: "ironWaves POS — продукт Laptop Market. www.laptopmarket.az",
  },
  en: {
    nav: ["Product", "How it works", "Modules", "Contact"],
    badge: "Enterprise Restaurant Platform",
    headline: "Run your restaurant from one platform",
    sub: "POS, Tables, Kitchen, Finance, Dashboard, Analytics, CRM, QR Menu and Audit in one system.",
    ctaPrimary: "Go to demo",
    ctaSecondary: "Learn more",
    trust: ["Table flow", "Kitchen control", "Cash control", "Live dashboard"],
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
    contactTitle: "Contact form",
    form: ["Name", "Business name", "Phone", "Business type", "Short note"],
    submit: "Request demo",
    footer: "ironWaves POS is a Laptop Market product. www.laptopmarket.az",
  },
};

const MODULE_TABS = [
  "POS",
  "Masalar",
  "Mətbəx",
  "Dashboard",
  "Maliyyə",
  "Analitika",
  "Z-Hesabat",
  "Anbar",
  "Menyu",
  "Resept",
  "Loglar",
  "CRM",
  "Customer App",
  "POS Dizaynı",
  "Qeydlər",
  "Baza",
  "Ayarlar",
  "AI Menecer",
  "Tenantlar",
];

const SHOTS = [
  ["POS Ekranı", "/landing/pos-screen.png", "Sürətli sifariş və ödəniş axını"],
  ["Maliyyə Ekranı", "/landing/finance-screen.png", "Kassa, depozit və investor borcu nəzarəti"],
  ["Golden Card", "/landing/golden-card.png", "Loyallıq kartı və bonus ssenariləri"],
  ["Elite Card", "/landing/elite-card.png", "VIP müştəri segmenti və üstünlüklər"],
];

function AppPreview({ activeShot, heroImageUrl }: { activeShot: [string, string, string]; heroImageUrl?: string }) {
  const [title, src, desc] = activeShot;
  const previewImage = String(heroImageUrl || src || "").trim() || src;
  return (
    <div className="metal-panel relative w-full overflow-hidden rounded-2xl border p-3">
      <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-slate-600/50 bg-[#162133]/70 px-3 py-2 text-[11px] text-slate-300">
        <div className="rounded-lg border border-slate-500/60 px-2 py-1">Tenant · iRonWaves Platform</div>
        <div className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-2 py-1 text-emerald-200">Online</div>
        <div className="rounded-lg border border-slate-500/60 px-2 py-1">Yenilə</div>
        <div className="rounded-lg border border-slate-500/60 px-2 py-1">Tam ekran</div>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {MODULE_TABS.slice(0, 10).map((tab, idx) => (
          <span key={tab} className={idx === 0 ? "neon-chip neon-chip-active px-3 py-2" : "neon-chip px-3 py-2"}>
            {tab}
          </span>
        ))}
      </div>
      <div className="mb-3 overflow-hidden rounded-xl border border-slate-600/70">
        <img src={previewImage} alt={title} className="h-44 w-full object-cover" />
        <div className="flex items-center justify-between bg-[#101722] px-3 py-2">
          <div className="text-xs font-semibold text-slate-100">{title}</div>
          <div className="text-[11px] text-slate-400">{desc}</div>
        </div>
      </div>
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-8 space-y-3">
          <div className="metal-panel rounded-xl p-3">
            <div className="mb-3 h-10 rounded-lg border border-slate-600/70 bg-[#0f1520]" />
            <div className="grid grid-cols-2 gap-2">
              {["Amerikano", "Latte", "Kola", "Dönər"].map((n, i) => (
                <div key={n} className="neon-item">
                  <span>{n}</span>
                  <span>{(i + 2).toFixed(2)} ₼</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="col-span-4">
          <div className="metal-panel rounded-xl p-3">
            <div className="mb-3 text-sm font-bold text-slate-100">SƏBƏT 3</div>
            <div className="space-y-2">
              <div className="neon-input h-9"> </div>
              <div className="neon-input h-9"> </div>
              <div className="neon-input h-24"> </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="pay-btn pay-btn-active">Nağd</button>
              <button className="pay-btn">Kart</button>
            </div>
            <button className="glossy-gold mt-3 w-full rounded-lg px-3 py-2 font-semibold">Ödənişi Tamamla</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [lang, setLang] = useState<Lang>("az");
  const [shotIndex, setShotIndex] = useState(0);
  const [liveSettings, setLiveSettings] = useState<any | null>(null);
  const c = useMemo(() => COPY[lang], [lang]);
  const slides = useMemo(() => {
    const rows = Array.isArray(liveSettings?.screenshot_items) ? liveSettings.screenshot_items : SHOTS.map(([title, image_url, desc]) => ({
      image_url,
      title_az: title,
      title_ru: title,
      title_en: title,
      desc_az: desc,
      desc_ru: desc,
      desc_en: desc,
    }));
    return rows
      .filter((row: any) => String(row?.image_url || "").trim())
      .map((row: any) => {
        const title = String(row?.[`title_${lang}`] || row?.title_az || row?.title_en || row?.title_ru || "").trim();
        const desc = String(row?.[`desc_${lang}`] || row?.desc_az || row?.desc_en || row?.desc_ru || "").trim();
        return [title || "Slide", String(row.image_url), desc || ""] as [string, string, string];
      });
  }, [liveSettings, lang]);
  const activeShot = slides.length ? slides[shotIndex % slides.length] : (SHOTS[0] as [string, string, string]);

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
    let mounted = true;
    const load = async () => {
      try {
        const data = await get_public_landing_settings_live();
        if (mounted) setLiveSettings(data || null);
      } catch {
        // Keep local copy fallback
      }
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const size = Math.max(1, slides.length || SHOTS.length);
      setShotIndex((prev) => (prev + 1) % size);
    }, 3500);
    return () => window.clearInterval(timer);
  }, [slides.length]);

  const navLabels = useMemo(() => {
    return [
      String(liveSettings?.[`nav_product_${lang}`] || c.nav[0] || "").trim(),
      String(liveSettings?.[`nav_how_${lang}`] || c.nav[1] || "").trim(),
      String(liveSettings?.[`nav_modules_${lang}`] || c.nav[2] || "").trim(),
      String(liveSettings?.[`nav_contact_${lang}`] || c.nav[3] || "").trim(),
    ];
  }, [liveSettings, lang, c.nav]);

  const heroTitle = String(liveSettings?.[`hero_title_${lang}`] || c.headline || "").trim();
  const heroBody = String(liveSettings?.[`hero_body_${lang}`] || c.sub || "").trim();
  const ctaPrimary = String(liveSettings?.[`primary_cta_${lang}`] || c.ctaPrimary || "").trim();
  const ctaSecondary = String(liveSettings?.[`secondary_cta_${lang}`] || c.ctaSecondary || "").trim();
  const modulesTitle = String(liveSettings?.[`modules_title_${lang}`] || c.modulesTitle || "").trim();
  const footerText = String(liveSettings?.[`footer_text_${lang}`] || c.footer || "").trim();
  const heroImageUrl = String(liveSettings?.hero_image_url || "").trim();

  return (
    <div className="metal-app min-h-screen overflow-x-hidden">
      <header className="sticky top-0 z-40 border-b border-slate-600/40 bg-[#121826]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <img src="/landing/ironwaves-logo.jpeg" alt="iRonWaves" className="h-9 w-auto rounded-md object-contain" />
            <div className="text-sm text-slate-300">iRonWaves POS</div>
          </div>
          <nav className="hidden items-center gap-6 md:flex">
            {navLabels.map((item: string, idx: number) => (
              <a key={item} href={idx === 0 ? "#mehsul" : idx === 1 ? "#isleyis" : idx === 2 ? "#modullar" : "#elaqe"} className="text-sm text-slate-300 transition hover:text-white">
                {item}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {(["az", "ru", "en"] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={l === lang ? "neon-chip neon-chip-active px-3 py-1.5 text-[11px]" : "neon-chip px-3 py-1.5 text-[11px]"}
              >
                {l.toUpperCase()}
              </button>
            ))}
            <a href="https://demo.ironwaves.store" target="_blank" rel="noreferrer">
              <button className="neon-btn-active rounded-xl px-4 py-2 text-sm font-semibold">{ctaPrimary}</button>
            </a>
          </div>
        </div>
      </header>

      <section id="mehsul" className="mx-auto grid w-full max-w-[1280px] grid-cols-1 gap-8 px-4 pb-10 pt-10 md:px-6 lg:grid-cols-2 lg:pt-14">
        <div className="space-y-6">
          <div className="inline-flex items-center rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
            {c.badge}
          </div>
          <h1 className="text-4xl font-black leading-tight text-white md:text-6xl">{heroTitle}</h1>
          <p className="max-w-xl text-base leading-7 text-slate-300 md:text-lg">{heroBody}</p>
          <div className="flex flex-wrap gap-3">
            <a href="https://demo.ironwaves.store" target="_blank" rel="noreferrer">
              <button className="neon-btn-active rounded-xl px-6 py-3 text-sm font-bold">{ctaPrimary}</button>
            </a>
            <a href="#modullar">
              <button className="neon-btn rounded-xl px-6 py-3 text-sm font-semibold">{ctaSecondary}</button>
            </a>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {c.trust.map((item: string) => (
              <div key={item} className="metal-panel rounded-xl px-3 py-2 text-center text-xs text-slate-200">
                {item}
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <AppPreview activeShot={activeShot} heroImageUrl={heroImageUrl} />
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                const size = Math.max(1, slides.length || SHOTS.length);
                setShotIndex((prev) => (prev - 1 + size) % size);
              }}
              className="neon-chip px-3 py-1.5 text-xs"
            >
              ◀
            </button>
            <div className="flex items-center gap-2">
              {slides.map((shot, idx) => (
                <button
                  key={shot[0]}
                  type="button"
                  aria-label={shot[0]}
                  onClick={() => setShotIndex(idx)}
                  className={idx === shotIndex ? "h-2.5 w-7 rounded-full bg-yellow-300" : "h-2.5 w-2.5 rounded-full bg-slate-500/80"}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                const size = Math.max(1, slides.length || SHOTS.length);
                setShotIndex((prev) => (prev + 1) % size);
              }}
              className="neon-chip px-3 py-1.5 text-xs"
            >
              ▶
            </button>
          </div>
        </div>
      </section>

      <section id="isleyis" className="border-y border-slate-700/40 bg-[#0f1522]/40">
        <div className="mx-auto max-w-[1280px] overflow-hidden px-4 py-4 md:px-6">
          <div className="flex w-max animate-marquee gap-2">
            {[...MODULE_TABS, ...MODULE_TABS].map((tab, idx) => (
              <span key={`${tab}-${idx}`} className={idx % 7 === 0 ? "neon-chip neon-chip-active whitespace-nowrap px-3 py-2" : "neon-chip whitespace-nowrap px-3 py-2"}>
                {tab}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section id="modullar" className="mx-auto max-w-[1280px] px-4 py-14 md:px-6">
        <h2 className="mb-6 text-2xl font-extrabold text-white md:text-3xl">{modulesTitle}</h2>
        <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {c.modules.map((item: string) => (
            <div key={item} className="metal-panel rounded-xl p-4">
              <div className="text-sm font-bold text-slate-100">{item}</div>
              <div className="mt-2 text-xs leading-5 text-slate-400">iRonWaves Platform daxilində inteqrasiya olunmuş modul.</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {slides.map(([title, src, desc]) => (
            <article key={title} className="metal-panel overflow-hidden rounded-xl border">
              <img src={src} alt={title} className="h-52 w-full object-cover" />
              <div className="p-4">
                <h3 className="text-base font-bold text-slate-100">{title}</h3>
                <p className="mt-1 text-sm text-slate-400">{desc}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-[1280px] grid-cols-1 gap-6 px-4 pb-14 md:px-6 lg:grid-cols-2">
        <div className="metal-panel rounded-2xl p-6">
          <h3 className="mb-4 text-xl font-extrabold text-white">{c.whyTitle}</h3>
          <div className="space-y-3">
            {c.why.map((item: string) => (
              <div key={item} className="flex items-start gap-3 text-sm text-slate-300">
                <span className="mt-1 inline-block h-2.5 w-2.5 rounded-full bg-yellow-300" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
        <div id="elaqe" className="metal-panel rounded-2xl p-6">
          <h3 className="mb-4 text-xl font-extrabold text-white">{c.contactTitle}</h3>
          <form className="space-y-3">
            <input className="neon-input" placeholder={c.form[0]} />
            <input className="neon-input" placeholder={c.form[1]} />
            <input className="neon-input" placeholder={c.form[2]} />
            <input className="neon-input" placeholder={c.form[3]} />
            <textarea className="neon-input min-h-24" placeholder={c.form[4]} />
            <button type="button" className="neon-btn-active w-full rounded-xl px-4 py-3 font-semibold">{c.submit}</button>
            <div className="pt-2 text-xs text-slate-400">
              Əlaqə: {String(liveSettings?.contact_phone || "+99455 299-92-82")} · {String(liveSettings?.contact_email || "abbas@laptopmarket.az")}
            </div>
          </form>
        </div>
      </section>

      <footer className="border-t border-slate-700/40 px-4 py-5 text-center text-xs text-slate-400 md:px-6">{footerText}</footer>
    </div>
  );
}

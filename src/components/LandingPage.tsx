import { useEffect, useMemo, useState } from "react";

type Lang = "az" | "ru" | "en";

const t = {
  az: {
    styleGuide: "MƏHSUL GİDİ",
    nav: ["POS", "Masalar", "KDS", "Maliyyə", "CRM"],
    heroTitle: "ironwaves pos design",
    heroDesc:
      "iRonWaves POS üçün tam məhsul təqdimatı: POS, Masalar, KDS, Maliyyə, Dashboard, Analitika, CRM, QR Menu və Audit bir platformada.",
    cta1: "DEMOYA KEÇ",
    cta2: "MƏHSULU AÇ",
    secColors: "RƏNG SİSTEMİ",
    secType: "TIPOQRAFİYA",
    secButtons: "DÜYMƏLƏR",
    secDarkButtons: "DARK DÜYMƏLƏR",
    secCards: "SCREENSHOT KARTLARI",
    secDarkCards: "DARK SCREENSHOT",
    secComponents: "KOMPONENTLƏR",
    secDarkComponents: "DARK KOMPONENTLƏR",
    completed: "TAMAMLANDI",
    inProgress: "PROSESDƏ",
    failed: "PROBLEM",
    streak: "AKTİV",
    premium: "PREMİUM",
    subscribe: "ABUNƏ OL",
    sound: "Səs effektləri",
    anim: "Animasiyalar",
    hover: "Üzərinə gəl",
    tooltip: "Məhsul axınını bu paneldən izləyin",
    learners: "8 aktiv istifadəçi",
    moduleCards: [
      ["POS Ekranı", "/landing/pos-screen.png", "Sürətli satış, split ödəniş və çek axını."],
      ["Maliyyə Ekranı", "/landing/finance-screen.png", "Kassa, depozit, investor borcu və jurnal nəzarəti."],
    ],
    darkCards: [
      ["CRM / Golden Card", "/landing/golden-card.png", "Müştəri loyallığı, bonus və kart axınları."],
      ["CRM / Elite Card", "/landing/elite-card.png", "Yüksək səviyyə müştəri segmenti və üstünlüklər."],
    ],
  },
  ru: {
    styleGuide: "ГИД ПРОДУКТА",
    nav: ["POS", "Столы", "KDS", "Финансы", "CRM"],
    heroTitle: "ironwaves pos design",
    heroDesc:
      "Полная презентация iRonWaves POS: POS, столы, KDS, финансы, dashboard, аналитика, CRM, QR Menu и аудит в одной платформе.",
    cta1: "ПЕРЕЙТИ К ДЕМО",
    cta2: "ОТКРЫТЬ ПРОДУКТ",
    secColors: "ЦВЕТОВАЯ СИСТЕМА",
    secType: "ТИПОГРАФИКА",
    secButtons: "КНОПКИ",
    secDarkButtons: "DARK КНОПКИ",
    secCards: "КАРТОЧКИ SCREENSHOT",
    secDarkCards: "DARK SCREENSHOT",
    secComponents: "КОМПОНЕНТЫ",
    secDarkComponents: "DARK КОМПОНЕНТЫ",
    completed: "ЗАВЕРШЕНО",
    inProgress: "В ПРОЦЕССЕ",
    failed: "ПРОБЛЕМА",
    streak: "АКТИВНО",
    premium: "ПРЕМИУМ",
    subscribe: "ПОДПИСАТЬСЯ",
    sound: "Звуковые эффекты",
    anim: "Анимации",
    hover: "Наведи",
    tooltip: "Следите за потоком продукта через эту панель",
    learners: "8 активных пользователей",
    moduleCards: [
      ["Экран POS", "/landing/pos-screen.png", "Быстрые продажи, split-оплата и поток чеков."],
      ["Экран финансов", "/landing/finance-screen.png", "Контроль кассы, депозитов, долга инвестору и журнала."],
    ],
    darkCards: [
      ["CRM / Golden Card", "/landing/golden-card.png", "Лояльность клиентов, бонусы и карточные сценарии."],
      ["CRM / Elite Card", "/landing/elite-card.png", "Сегмент VIP-клиентов и расширенные привилегии."],
    ],
  },
  en: {
    styleGuide: "PRODUCT GUIDE",
    nav: ["POS", "Tables", "KDS", "Finance", "CRM"],
    heroTitle: "ironwaves pos design",
    heroDesc:
      "A complete iRonWaves POS showcase: POS, Tables, KDS, Finance, Dashboard, Analytics, CRM, QR Menu and Audit in one platform.",
    cta1: "GO TO DEMO",
    cta2: "OPEN PRODUCT",
    secColors: "COLOR SYSTEM",
    secType: "TYPOGRAPHY",
    secButtons: "BUTTONS",
    secDarkButtons: "DARK BUTTONS",
    secCards: "SCREENSHOT CARDS",
    secDarkCards: "DARK SCREENSHOT",
    secComponents: "COMPONENTS",
    secDarkComponents: "DARK COMPONENTS",
    completed: "COMPLETED",
    inProgress: "IN PROGRESS",
    failed: "FAILED",
    streak: "ACTIVE",
    premium: "PREMIUM",
    subscribe: "SUBSCRIBE",
    sound: "Sound effects",
    anim: "Animations",
    hover: "Hover me",
    tooltip: "Track product flow from this panel",
    learners: "8 active users",
    moduleCards: [
      ["POS Screen", "/landing/pos-screen.png", "Fast checkout, split payments and receipt flow."],
      ["Finance Screen", "/landing/finance-screen.png", "Cash, deposits, investor liability and journal control."],
    ],
    darkCards: [
      ["CRM / Golden Card", "/landing/golden-card.png", "Customer loyalty, bonus and card-based journeys."],
      ["CRM / Elite Card", "/landing/elite-card.png", "VIP customer segment with advanced benefits."],
    ],
  },
} as const;

const palette = [
  ["Green", "rgb(88, 204, 2)", "#58CC02"],
  ["Green Hover", "rgb(75, 178, 0)", "#4BB200"],
  ["Blue", "rgb(28, 176, 246)", "#1CB0F6"],
  ["Dark Blue", "rgb(16, 15, 62)", "#100F3E"],
  ["Red", "#FF4B4B", "#FF4B4B"],
  ["Orange", "#FF9600", "#FF9600"],
  ["Golden", "#FFC800", "#FFC800"],
  ["Footer Green", "#4EC604", "#4EC604"],
  ["Gray Text", "rgb(75, 75, 75)", "#4B4B4B"],
  ["Gray Light", "rgb(119, 119, 119)", "#777777"],
  ["Nav Text", "rgb(175, 175, 175)", "#AFAFAF"],
  ["Border", "rgb(229, 229, 229)", "#E5E5E5"],
] as const;

export default function LandingPage() {
  const [lang, setLang] = useState<Lang>("az");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [animEnabled, setAnimEnabled] = useState(false);
  const c = useMemo(() => t[lang], [lang]);

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
    const mountLink = (id: string, href: string) => {
      if (document.getElementById(id)) return;
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    };
    mountLink(
      "dg-font-nunito",
      "https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap",
    );
    mountLink(
      "dg-font-feather",
      "https://db.onlinewebfonts.com/c/14936bb7a4b6575fd2eee80a3ab52cc2?family=Feather+Bold",
    );
  }, []);

  return (
    <div className="dg-page">
      <header className="dg-navbar">
        <div className="dg-navbar-inner">
          <div className="dg-brand">
            <img src="/landing/ironwaves-logo.jpeg" alt="iRonWaves" width={140} height={33} />
            <span className="dg-divider" />
            <span className="dg-style-guide">{c.styleGuide}</span>
          </div>
          <div className="flex items-center gap-3">
            <nav className="dg-nav-links">
              {c.nav.map((item, idx) => (
                <a key={item} href="#" className={`dg-nav-link ${idx === 0 ? "active" : ""}`}>
                  {item}
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-1">
              {(["az", "ru", "en"] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  className={`h-8 rounded-lg px-2 text-xs font-bold uppercase ${lang === l ? "bg-[#e8f8d8] text-[#4bb200]" : "text-[var(--nav-text)]"}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <section className="dg-hero">
        <h1 className="dg-hero-title">{c.heroTitle}</h1>
        <p className="dg-hero-sub">{c.heroDesc}</p>
        <div className="dg-hero-actions">
          <button className="dg-btn dg-btn-primary" onClick={() => window.open("https://demo.ironwaves.store", "_blank")}>
            {c.cta1}
          </button>
          <button className="dg-btn dg-btn-secondary" onClick={() => (window.location.href = "https://ironwaves.store")}>
            {c.cta2}
          </button>
        </div>
      </section>

      <main className="dg-grid">
        <section className="dg-panel">
          <div className="dg-section-label">{c.secColors}</div>
          <div className="dg-color-grid">
            {palette.map(([name, color, hex]) => (
              <div key={name} className="dg-swatch-item">
                <div className="dg-swatch" style={{ background: color }} />
                <div className="dg-swatch-name">{name}</div>
                <div className="dg-swatch-hex">{hex}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="dg-panel">
          <div className="dg-section-label">{c.secType}</div>
          <div className="dg-type-stack">
            <div className="dg-type-row"><div className="dg-type-meta"><div className="dg-size">48px</div><div className="dg-weight">Feather Bold</div></div><div className="dg-type-display">iRonWaves</div></div>
            <div className="dg-type-row"><div className="dg-type-meta"><div className="dg-size">32px</div><div className="dg-weight">Bold 700</div></div><div className="dg-type-h1">POS & Tables</div></div>
            <div className="dg-type-row"><div className="dg-type-meta"><div className="dg-size">28px</div><div className="dg-weight">Feather Bold</div></div><div className="dg-type-h2">kitchen & finance</div></div>
            <div className="dg-type-row"><div className="dg-type-meta"><div className="dg-size">18px</div><div className="dg-weight">Medium 500</div></div><div className="dg-type-body">{c.heroDesc}</div></div>
            <div className="dg-type-row"><div className="dg-type-meta"><div className="dg-size">14px</div><div className="dg-weight">Bold 700</div></div><div className="dg-type-caption">ENTERPRISE FLOW</div></div>
            <div className="dg-type-row"><div className="dg-type-meta"><div className="dg-size">12px</div><div className="dg-weight">Semi 600</div></div><div className="dg-type-small">Audit, logs, approvals, reconciliation</div></div>
          </div>
        </section>

        <section className="dg-panel">
          <div className="dg-section-label">{c.secButtons}</div>
          <div className="dg-button-groups">
            <div className="dg-button-row"><div className="dg-row-label">Primary</div><div className="dg-row-content"><button className="dg-btn dg-btn-primary">{c.cta1}</button><button className="dg-btn dg-btn-primary dg-btn-sm">SMALL</button><button className="dg-btn dg-btn-primary" disabled>DISABLED</button></div></div>
            <div className="dg-button-row"><div className="dg-row-label">Secondary</div><div className="dg-row-content"><button className="dg-btn dg-btn-secondary">{c.cta2}</button><button className="dg-btn dg-btn-secondary dg-btn-sm">SMALL</button><button className="dg-btn dg-btn-secondary" disabled>DISABLED</button></div></div>
            <div className="dg-button-row"><div className="dg-row-label">Danger</div><div className="dg-row-content"><button className="dg-btn dg-btn-danger">DELETE</button><button className="dg-btn dg-btn-danger dg-btn-sm">REMOVE</button></div></div>
          </div>
        </section>

        <section className="dg-panel dg-panel-dark">
          <div className="dg-section-label">{c.secDarkButtons}</div>
          <div className="dg-button-groups">
            <div className="dg-row-content"><button className="dg-btn dg-btn-primary">{c.cta1}</button><button className="dg-btn dg-btn-light">TRY 1 WEEK FREE</button></div>
            <div className="dg-row-content"><button className="dg-btn dg-btn-primary dg-btn-sm">{c.cta1}</button><button className="dg-btn dg-btn-light dg-btn-sm">TRIAL</button></div>
          </div>
        </section>

        <section className="dg-panel">
          <div className="dg-section-label">{c.secCards}</div>
          <div className="dg-card-grid">
            {c.moduleCards.map(([title, src, desc]) => (
              <article className="dg-course-card" key={title}>
                <img src={src} alt={title} />
                <div className="dg-card-body">
                  <span className="dg-tag dg-tag-blue">MODULE</span>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
                <footer><span>LIVE UI</span><button>OPEN</button></footer>
              </article>
            ))}
          </div>
        </section>

        <section className="dg-panel dg-panel-dark">
          <div className="dg-section-label">{c.secDarkCards}</div>
          <div className="dg-card-grid">
            {c.darkCards.map(([title, src, desc]) => (
              <article className="dg-dark-card" key={title}>
                <img src={src} alt={title} style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 12 }} />
                <h3>{title}</h3>
                <p>{desc}</p>
                <footer><span>CRM</span><button>DETAIL</button></footer>
              </article>
            ))}
          </div>
        </section>

        <section className="dg-panel">
          <div className="dg-section-label">{c.secComponents}</div>
          <div className="dg-components-stack">
            <div className="dg-group"><div className="dg-group-title">BADGES</div><div className="dg-badge-row"><span className="dg-pill dg-pill-green">{c.completed}</span><span className="dg-pill dg-pill-blue">{c.inProgress}</span><span className="dg-pill dg-pill-red">{c.failed}</span><span className="dg-pill dg-pill-orange">{c.streak}</span><span className="dg-pill dg-pill-golden">{c.premium}</span></div></div>
            <div className="dg-group"><div className="dg-group-title">INPUT + BUTTON</div><div className="dg-input-row"><input placeholder="name@company.com" /><button className="dg-btn dg-btn-primary">{c.subscribe}</button></div></div>
            <div className="dg-group"><div className="dg-group-title">TOGGLE</div><div className="dg-toggle-row"><label className="dg-toggle-item"><span>{c.sound}</span><button className={`dg-toggle ${soundEnabled ? "checked" : ""}`} onClick={() => setSoundEnabled((v) => !v)}><span className="dg-toggle-thumb" /></button></label><label className="dg-toggle-item"><span>{c.anim}</span><button className={`dg-toggle ${animEnabled ? "checked" : ""}`} onClick={() => setAnimEnabled((v) => !v)}><span className="dg-toggle-thumb" /></button></label></div></div>
            <div className="dg-group"><div className="dg-group-title">PROGRESS</div><div className="dg-progress-stack">{[["85%", "var(--green)"], ["60%", "var(--blue)"], ["35%", "var(--orange)"]].map(([v, c2]) => (<div className="dg-progress-row" key={v}><div className="dg-progress-track"><div className="dg-progress-fill" style={{ width: v, background: c2 }} /></div><span>{v}</span></div>))}</div></div>
            <div className="dg-group"><div className="dg-group-title">TOOLTIP & STREAK</div><div className="dg-tooltip-row"><div className="dg-tooltip-wrap"><button className="dg-tooltip-trigger">{c.hover}</button><span className="dg-tooltip-bubble">{c.tooltip}</span></div><div className="dg-streak"><span>🔥</span><strong>42</strong></div></div></div>
          </div>
        </section>

        <section className="dg-panel dg-panel-dark">
          <div className="dg-section-label">{c.secDarkComponents}</div>
          <div className="dg-components-stack">
            <div className="dg-group">
              <div className="dg-group-title">LANGUAGE PILLS</div>
              <div className="dg-lang-row">
                {[
                  ["Spanish", "https://d35aaqx5ub95lt.cloudfront.net/vendor/59a90a2cedd48b751a8fd22014768fd7.svg", true],
                  ["French", "https://d35aaqx5ub95lt.cloudfront.net/vendor/482fda142ee4abd728ebf4ccce5d3307.svg", false],
                  ["German", "https://d35aaqx5ub95lt.cloudfront.net/vendor/c71db846ffab7e0a74bc6971e34ad82e.svg", false],
                  ["Japanese", "https://d35aaqx5ub95lt.cloudfront.net/vendor/edea4fa18ff3e7d8c0282de3f102aaed.svg", false],
                ].map(([name, flag, active]) => (
                  <button key={String(name)} className={`dg-lang-pill ${active ? "active" : ""}`}><img src={String(flag)} alt="" /><span>{name}</span></button>
                ))}
              </div>
            </div>
            <div className="dg-group"><div className="dg-group-title">AVATAR GROUP</div><div className="dg-avatar-row"><div className="dg-avatar-stack">{["https://images.pexels.com/photos/774909/pexels-photo-774909.jpeg?auto=compress&cs=tinysrgb&w=80&h=80&fit=crop", "https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=80&h=80&fit=crop", "https://images.pexels.com/photos/733872/pexels-photo-733872.jpeg?auto=compress&cs=tinysrgb&w=80&h=80&fit=crop"].map((src) => (<img key={src} src={src} alt="" />))}<span className="dg-avatar-count">+5</span></div><span className="dg-avatar-text">{c.learners}</span></div></div>
            <div className="dg-group"><div className="dg-group-title">PROGRESS (DARK)</div><div className="dg-progress-stack dark">{[["72%", "var(--golden)"], ["45%", "var(--green)"]].map(([v, c2]) => (<div className="dg-progress-row" key={v}><div className="dg-progress-track"><div className="dg-progress-fill" style={{ width: v, background: c2 }} /></div><span>{v}</span></div>))}</div></div>
            <div className="dg-group"><div className="dg-group-title">BADGES (DARK)</div><div className="dg-badge-row"><span className="dg-pill dg-pill-dark-green">MASTERED</span><span className="dg-pill dg-pill-dark-blue">REVIEW</span><span className="dg-pill dg-pill-dark-golden">CROWN</span></div></div>
          </div>
        </section>
      </main>
    </div>
  );
}

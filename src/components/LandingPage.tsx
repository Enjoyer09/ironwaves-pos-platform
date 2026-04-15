import { useEffect, useMemo, useState } from "react";

type Lang = "az" | "ru" | "en";
type SectionId = "colors" | "type" | "buttons" | "cards" | "components";

const copy = {
  az: {
    guide: "MƏHSUL DİZAYN GİDİ",
    nav: [
      ["colors", "Rənglər"],
      ["type", "Tipoqrafiya"],
      ["buttons", "Düymələr"],
      ["cards", "Kartlar"],
      ["components", "Komponentlər"],
    ] as Array<[SectionId, string]>,
    heroTitle: "ironwaves pos design",
    heroDesc:
      "iRonWaves POS üçün vizual və funksional təqdimat: POS, Masalar, KDS, Maliyyə, Dashboard, Analitika, CRM, QR Menu və Audit bir platformada.",
    ctaDemo: "DEMOYA KEÇ",
    ctaOpen: "SİSTEMİ AÇ",
    labels: {
      colors: "RƏNG PALETRASI",
      type: "TIPOQRAFİYA",
      buttons: "DÜYMƏ VARİANTLARI",
      darkButtons: "DARK DÜYMƏLƏR",
      cards: "MƏHSUL EKRANLARI",
      darkCards: "CRM KARTLARI",
      components: "KOMPONENTLƏR",
      darkComponents: "DARK KOMPONENTLƏR",
      badges: "STATUS BADGE-LƏRİ",
      input: "FORM + DÜYMƏ",
      toggle: "TOGGLE",
      progress: "PROGRESS",
      tooltip: "TOOLTIP & STREAK",
      languagePills: "DİL PILL-LƏRİ",
      avatars: "AKTİV İSTİFADƏÇİLƏR",
      darkProgress: "PROGRESS (DARK)",
      darkBadges: "BADGE (DARK)",
    },
    ui: {
      completed: "TAMAMLANDI",
      inProgress: "PROSESDƏ",
      failed: "PROBLEM",
      streak: "AKTİV",
      premium: "PREMİUM",
      subscribe: "ABUNƏ OL",
      sound: "Səs effektləri",
      animations: "Animasiyalar",
      hover: "Üzərinə gəl",
      tooltip: "Bu blokdan məhsul axınını izləyin",
      activeUsers: "8 aktiv istifadəçi",
      module: "MODUL",
      liveUi: "CANLI UI",
      open: "AÇ",
      crm: "CRM",
      detail: "DETAL",
      trial: "1 HƏFTƏ TRIAL",
    },
    moduleCards: [
      ["POS Ekranı", "/landing/pos-screen.png", "Sürətli satış, split ödəniş və çek axını."],
      ["Maliyyə Ekranı", "/landing/finance-screen.png", "Kassa, depozit, investor borcu və jurnal nəzarəti."],
    ],
    crmCards: [
      ["Golden Card", "/landing/golden-card.png", "Müştəri loyallığı, bonus və kart axınları."],
      ["Elite Card", "/landing/elite-card.png", "Yüksək səviyyə müştəri segmenti və üstünlüklər."],
    ],
  },
  ru: {
    guide: "ГИД ДИЗАЙНА ПРОДУКТА",
    nav: [
      ["colors", "Цвета"],
      ["type", "Тип"],
      ["buttons", "Кнопки"],
      ["cards", "Карточки"],
      ["components", "Компоненты"],
    ] as Array<[SectionId, string]>,
    heroTitle: "ironwaves pos design",
    heroDesc:
      "Визуальная и функциональная презентация iRonWaves POS: POS, столы, KDS, финансы, dashboard, аналитика, CRM, QR Menu и аудит в одной платформе.",
    ctaDemo: "ПЕРЕЙТИ К ДЕМО",
    ctaOpen: "ОТКРЫТЬ СИСТЕМУ",
    labels: {
      colors: "ПАЛИТРА ЦВЕТОВ",
      type: "ТИПОГРАФИКА",
      buttons: "ВАРИАНТЫ КНОПОК",
      darkButtons: "DARK КНОПКИ",
      cards: "ЭКРАНЫ ПРОДУКТА",
      darkCards: "КАРТЫ CRM",
      components: "КОМПОНЕНТЫ",
      darkComponents: "DARK КОМПОНЕНТЫ",
      badges: "STATUS BADGES",
      input: "ФОРМА + КНОПКА",
      toggle: "TOGGLE",
      progress: "ПРОГРЕСС",
      tooltip: "TOOLTIP & STREAK",
      languagePills: "ЯЗЫКОВЫЕ PILL",
      avatars: "АКТИВНЫЕ ПОЛЬЗОВАТЕЛИ",
      darkProgress: "ПРОГРЕСС (DARK)",
      darkBadges: "BADGE (DARK)",
    },
    ui: {
      completed: "ЗАВЕРШЕНО",
      inProgress: "В ПРОЦЕССЕ",
      failed: "ПРОБЛЕМА",
      streak: "АКТИВНО",
      premium: "ПРЕМИУМ",
      subscribe: "ПОДПИСАТЬСЯ",
      sound: "Звуковые эффекты",
      animations: "Анимации",
      hover: "Наведи",
      tooltip: "Отслеживайте поток продукта в этом блоке",
      activeUsers: "8 активных пользователей",
      module: "МОДУЛЬ",
      liveUi: "LIVE UI",
      open: "ОТКРЫТЬ",
      crm: "CRM",
      detail: "ДЕТАЛИ",
      trial: "TRIAL 1 НЕДЕЛЯ",
    },
    moduleCards: [
      ["Экран POS", "/landing/pos-screen.png", "Быстрые продажи, split-оплата и поток чеков."],
      ["Экран финансов", "/landing/finance-screen.png", "Контроль кассы, депозитов, долга инвестору и журнала."],
    ],
    crmCards: [
      ["Golden Card", "/landing/golden-card.png", "Лояльность клиентов, бонусы и карточные сценарии."],
      ["Elite Card", "/landing/elite-card.png", "Сегмент VIP-клиентов и расширенные привилегии."],
    ],
  },
  en: {
    guide: "PRODUCT DESIGN GUIDE",
    nav: [
      ["colors", "Colors"],
      ["type", "Type"],
      ["buttons", "Buttons"],
      ["cards", "Cards"],
      ["components", "Components"],
    ] as Array<[SectionId, string]>,
    heroTitle: "ironwaves pos design",
    heroDesc:
      "A visual and functional iRonWaves POS showcase: POS, Tables, KDS, Finance, Dashboard, Analytics, CRM, QR Menu and Audit in one platform.",
    ctaDemo: "GO TO DEMO",
    ctaOpen: "OPEN SYSTEM",
    labels: {
      colors: "COLOR PALETTE",
      type: "TYPOGRAPHY",
      buttons: "BUTTON VARIANTS",
      darkButtons: "DARK BUTTONS",
      cards: "PRODUCT SCREENS",
      darkCards: "CRM CARDS",
      components: "COMPONENTS",
      darkComponents: "DARK COMPONENTS",
      badges: "STATUS BADGES",
      input: "INPUT + BUTTON",
      toggle: "TOGGLE",
      progress: "PROGRESS",
      tooltip: "TOOLTIP & STREAK",
      languagePills: "LANGUAGE PILLS",
      avatars: "ACTIVE USERS",
      darkProgress: "PROGRESS (DARK)",
      darkBadges: "BADGES (DARK)",
    },
    ui: {
      completed: "COMPLETED",
      inProgress: "IN PROGRESS",
      failed: "FAILED",
      streak: "ACTIVE",
      premium: "PREMIUM",
      subscribe: "SUBSCRIBE",
      sound: "Sound effects",
      animations: "Animations",
      hover: "Hover me",
      tooltip: "Track product flow from this panel",
      activeUsers: "8 active users",
      module: "MODULE",
      liveUi: "LIVE UI",
      open: "OPEN",
      crm: "CRM",
      detail: "DETAIL",
      trial: "1 WEEK TRIAL",
    },
    moduleCards: [
      ["POS Screen", "/landing/pos-screen.png", "Fast checkout, split payments and receipt flow."],
      ["Finance Screen", "/landing/finance-screen.png", "Cash, deposits, investor liability and journal control."],
    ],
    crmCards: [
      ["Golden Card", "/landing/golden-card.png", "Customer loyalty, bonus and card-based journeys."],
      ["Elite Card", "/landing/elite-card.png", "VIP customer segment with advanced benefits."],
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

function SectionLabel({ text }: { text: string }) {
  return <div className="dg-section-label">{text}</div>;
}

export default function LandingPage() {
  const [lang, setLang] = useState<Lang>("az");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [animEnabled, setAnimEnabled] = useState(false);
  const c = useMemo(() => copy[lang], [lang]);

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

  return (
    <div className="dg-page">
      <header className="dg-navbar">
        <div className="dg-navbar-inner">
          <div className="dg-brand">
            <img src="/landing/ironwaves-logo.jpeg" alt="iRonWaves" width={140} height={33} />
            <span className="dg-divider" />
            <span className="dg-style-guide">{c.guide}</span>
          </div>
          <div className="flex items-center gap-3">
            <nav className="dg-nav-links">
              {c.nav.map(([id, label], idx) => (
                <a key={id} href={`#${id}`} className={`dg-nav-link ${idx === 0 ? "active" : ""}`}>
                  {label}
                </a>
              ))}
            </nav>
            <div className="flex items-center gap-1">
              {(["az", "ru", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={lang === l}
                  onClick={() => setLang(l)}
                  className={`h-8 rounded-lg px-2 text-xs font-bold uppercase ${
                    lang === l ? "bg-[#e8f8d8] text-[#4bb200]" : "text-[var(--nav-text)]"
                  }`}
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
          <button type="button" className="dg-btn dg-btn-primary" onClick={() => window.open("https://demo.ironwaves.store", "_blank", "noopener,noreferrer")}>
            {c.ctaDemo}
          </button>
          <button type="button" className="dg-btn dg-btn-secondary" onClick={() => window.open("https://super.ironwaves.store", "_blank", "noopener,noreferrer")}>
            {c.ctaOpen}
          </button>
        </div>
      </section>

      <main className="dg-grid">
        <section className="dg-panel dg-anchor" id="colors">
          <SectionLabel text={c.labels.colors} />
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

        <section className="dg-panel dg-anchor" id="type">
          <SectionLabel text={c.labels.type} />
          <div className="dg-type-stack">
            <div className="dg-type-row"><div className="dg-type-meta"><div className="dg-size">48px</div><div className="dg-weight">Feather Bold</div></div><div className="dg-type-display">iRonWaves</div></div>
            <div className="dg-type-row"><div className="dg-type-meta"><div className="dg-size">32px</div><div className="dg-weight">Bold 700</div></div><div className="dg-type-h1">POS & Tables</div></div>
            <div className="dg-type-row"><div className="dg-type-meta"><div className="dg-size">28px</div><div className="dg-weight">Feather Bold</div></div><div className="dg-type-h2">kitchen & finance</div></div>
            <div className="dg-type-row"><div className="dg-type-meta"><div className="dg-size">18px</div><div className="dg-weight">Medium 500</div></div><div className="dg-type-body">{c.heroDesc}</div></div>
            <div className="dg-type-row"><div className="dg-type-meta"><div className="dg-size">14px</div><div className="dg-weight">Bold 700</div></div><div className="dg-type-caption">ENTERPRISE FLOW</div></div>
            <div className="dg-type-row"><div className="dg-type-meta"><div className="dg-size">12px</div><div className="dg-weight">Semi 600</div></div><div className="dg-type-small">Audit, logs, approvals, reconciliation</div></div>
          </div>
        </section>

        <section className="dg-panel dg-anchor" id="buttons">
          <SectionLabel text={c.labels.buttons} />
          <div className="dg-button-groups">
            <div className="dg-button-row"><div className="dg-row-label">Primary</div><div className="dg-row-content"><button type="button" className="dg-btn dg-btn-primary">{c.ctaDemo}</button><button type="button" className="dg-btn dg-btn-primary dg-btn-sm">SMALL</button><button type="button" className="dg-btn dg-btn-primary" disabled>DISABLED</button></div></div>
            <div className="dg-button-row"><div className="dg-row-label">Secondary</div><div className="dg-row-content"><button type="button" className="dg-btn dg-btn-secondary">{c.ctaOpen}</button><button type="button" className="dg-btn dg-btn-secondary dg-btn-sm">SMALL</button><button type="button" className="dg-btn dg-btn-secondary" disabled>DISABLED</button></div></div>
            <div className="dg-button-row"><div className="dg-row-label">Danger</div><div className="dg-row-content"><button type="button" className="dg-btn dg-btn-danger">DELETE</button><button type="button" className="dg-btn dg-btn-danger dg-btn-sm">REMOVE</button></div></div>
          </div>
        </section>

        <section className="dg-panel dg-panel-dark">
          <SectionLabel text={c.labels.darkButtons} />
          <div className="dg-button-groups">
            <div className="dg-row-content"><button type="button" className="dg-btn dg-btn-primary">{c.ctaDemo}</button><button type="button" className="dg-btn dg-btn-light">{c.ui.trial}</button></div>
            <div className="dg-row-content"><button type="button" className="dg-btn dg-btn-primary dg-btn-sm">{c.ctaDemo}</button><button type="button" className="dg-btn dg-btn-light dg-btn-sm">{c.ui.trial}</button></div>
          </div>
        </section>

        <section className="dg-panel dg-anchor" id="cards">
          <SectionLabel text={c.labels.cards} />
          <div className="dg-card-grid">
            {c.moduleCards.map(([title, src, desc]) => (
              <article className="dg-course-card" key={title}>
                <img src={src} alt={title} />
                <div className="dg-card-body">
                  <span className="dg-tag dg-tag-blue">{c.ui.module}</span>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
                <footer><span>{c.ui.liveUi}</span><button>{c.ui.open}</button></footer>
              </article>
            ))}
          </div>
        </section>

        <section className="dg-panel dg-panel-dark">
          <SectionLabel text={c.labels.darkCards} />
          <div className="dg-card-grid">
            {c.crmCards.map(([title, src, desc]) => (
              <article className="dg-dark-card" key={title}>
                <img src={src} alt={title} style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 12 }} />
                <h3>{title}</h3>
                <p>{desc}</p>
                <footer><span>{c.ui.crm}</span><button>{c.ui.detail}</button></footer>
              </article>
            ))}
          </div>
        </section>

        <section className="dg-panel dg-anchor" id="components">
          <SectionLabel text={c.labels.components} />
          <div className="dg-components-stack">
            <div className="dg-group"><div className="dg-group-title">{c.labels.badges}</div><div className="dg-badge-row"><span className="dg-pill dg-pill-green">{c.ui.completed}</span><span className="dg-pill dg-pill-blue">{c.ui.inProgress}</span><span className="dg-pill dg-pill-red">{c.ui.failed}</span><span className="dg-pill dg-pill-orange">{c.ui.streak}</span><span className="dg-pill dg-pill-golden">{c.ui.premium}</span></div></div>
            <div className="dg-group"><div className="dg-group-title">{c.labels.input}</div><div className="dg-input-row"><input placeholder="name@company.com" /><button type="button" className="dg-btn dg-btn-primary">{c.ui.subscribe}</button></div></div>
            <div className="dg-group"><div className="dg-group-title">{c.labels.toggle}</div><div className="dg-toggle-row"><label className="dg-toggle-item"><span>{c.ui.sound}</span><button type="button" aria-label={c.ui.sound} aria-pressed={soundEnabled} className={`dg-toggle ${soundEnabled ? "checked" : ""}`} onClick={() => setSoundEnabled((v) => !v)}><span className="dg-toggle-thumb" /></button></label><label className="dg-toggle-item"><span>{c.ui.animations}</span><button type="button" aria-label={c.ui.animations} aria-pressed={animEnabled} className={`dg-toggle ${animEnabled ? "checked" : ""}`} onClick={() => setAnimEnabled((v) => !v)}><span className="dg-toggle-thumb" /></button></label></div></div>
            <div className="dg-group"><div className="dg-group-title">{c.labels.progress}</div><div className="dg-progress-stack">{[["85%", "var(--green)"], ["60%", "var(--blue)"], ["35%", "var(--orange)"]].map(([v, color]) => (<div className="dg-progress-row" key={v}><div className="dg-progress-track"><div className="dg-progress-fill" style={{ width: v, background: color }} /></div><span>{v}</span></div>))}</div></div>
            <div className="dg-group"><div className="dg-group-title">{c.labels.tooltip}</div><div className="dg-tooltip-row"><div className="dg-tooltip-wrap"><button type="button" className="dg-tooltip-trigger">{c.ui.hover}</button><span className="dg-tooltip-bubble">{c.ui.tooltip}</span></div><div className="dg-streak"><span>🔥</span><strong>42</strong></div></div></div>
          </div>
        </section>

        <section className="dg-panel dg-panel-dark">
          <SectionLabel text={c.labels.darkComponents} />
          <div className="dg-components-stack">
            <div className="dg-group">
              <div className="dg-group-title">{c.labels.languagePills}</div>
              <div className="dg-lang-row">
                {[
                  ["Spanish", "https://d35aaqx5ub95lt.cloudfront.net/vendor/59a90a2cedd48b751a8fd22014768fd7.svg", true],
                  ["French", "https://d35aaqx5ub95lt.cloudfront.net/vendor/482fda142ee4abd728ebf4ccce5d3307.svg", false],
                  ["German", "https://d35aaqx5ub95lt.cloudfront.net/vendor/c71db846ffab7e0a74bc6971e34ad82e.svg", false],
                  ["Japanese", "https://d35aaqx5ub95lt.cloudfront.net/vendor/edea4fa18ff3e7d8c0282de3f102aaed.svg", false],
                ].map(([name, flag, active]) => (
                  <button type="button" key={String(name)} className={`dg-lang-pill ${active ? "active" : ""}`}><img src={String(flag)} alt="" /><span>{name}</span></button>
                ))}
              </div>
            </div>
            <div className="dg-group"><div className="dg-group-title">{c.labels.avatars}</div><div className="dg-avatar-row"><div className="dg-avatar-stack">{["https://images.pexels.com/photos/774909/pexels-photo-774909.jpeg?auto=compress&cs=tinysrgb&w=80&h=80&fit=crop", "https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=80&h=80&fit=crop", "https://images.pexels.com/photos/733872/pexels-photo-733872.jpeg?auto=compress&cs=tinysrgb&w=80&h=80&fit=crop"].map((src) => (<img key={src} src={src} alt="" />))}<span className="dg-avatar-count">+5</span></div><span className="dg-avatar-text">{c.ui.activeUsers}</span></div></div>
            <div className="dg-group"><div className="dg-group-title">{c.labels.darkProgress}</div><div className="dg-progress-stack dark">{[["72%", "var(--golden)"], ["45%", "var(--green)"]].map(([v, color]) => (<div className="dg-progress-row" key={v}><div className="dg-progress-track"><div className="dg-progress-fill" style={{ width: v, background: color }} /></div><span>{v}</span></div>))}</div></div>
            <div className="dg-group"><div className="dg-group-title">{c.labels.darkBadges}</div><div className="dg-badge-row"><span className="dg-pill dg-pill-dark-green">MASTERED</span><span className="dg-pill dg-pill-dark-blue">REVIEW</span><span className="dg-pill dg-pill-dark-golden">CROWN</span></div></div>
          </div>
        </section>
      </main>
    </div>
  );
}

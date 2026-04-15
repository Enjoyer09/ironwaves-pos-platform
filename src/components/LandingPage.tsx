import { useEffect, useState } from "react";

const colorSwatches = [
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

const brands = ["Vortex", "Nimbus", "Prysma", "Cirrus", "Kynder", "Halcyn"];

export default function LandingPage() {
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [animEnabled, setAnimEnabled] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return null;
    const mountLink = (id: string, href: string) => {
      if (document.getElementById(id)) return;
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    };
    mountLink("dg-font-nunito", "https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&display=swap");
    mountLink("dg-font-feather", "https://db.onlinewebfonts.com/c/14936bb7a4b6575fd2eee80a3ab52cc2?family=Feather+Bold");
  }, []);

  return (
    <div className="dg-page">
      <header className="dg-navbar">
        <div className="dg-navbar-inner">
          <div className="dg-brand">
            <img
              src="https://d35aaqx5ub95lt.cloudfront.net/images/splash/f92d5f2f7d56636846861c458c0d0b6c.svg"
              alt="Duolingo"
              width={140}
              height={33}
            />
            <span className="dg-divider" />
            <span className="dg-style-guide">STYLE GUIDE</span>
          </div>
          <nav className="dg-nav-links">
            {["Colors", "Type", "Buttons", "Cards", "Components"].map((item, idx) => (
              <a key={item} href={`#${item.toLowerCase()}`} className={`dg-nav-link ${idx === 0 ? "active" : ""}`}>
                {item}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <section className="dg-hero">
        <h1 className="dg-hero-title">duolingo design</h1>
        <p className="dg-hero-sub">
          A comprehensive visual reference for the Duolingo design system covering colors, typography,
          button variants, cards, and UI components.
        </p>
        <div className="dg-hero-actions">
          <button className="dg-btn dg-btn-primary">GET STARTED</button>
          <button className="dg-btn dg-btn-secondary">I ALREADY HAVE AN ACCOUNT</button>
        </div>
      </section>

      <main className="dg-grid">
        <section className="dg-panel" id="colors">
          <div className="dg-section-label">COLOR PALETTE</div>
          <div className="dg-color-grid">
            {colorSwatches.map(([name, color, hex]) => (
              <div className="dg-swatch-item" key={name}>
                <div className="dg-swatch" style={{ background: color }} />
                <div className="dg-swatch-name">{name}</div>
                <div className="dg-swatch-hex">{hex}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="dg-panel" id="type">
          <div className="dg-section-label">TYPOGRAPHY</div>
          <div className="dg-type-stack">
            <div className="dg-type-row">
              <div className="dg-type-meta">
                <div className="dg-size">48px</div>
                <div className="dg-weight">Feather Bold</div>
              </div>
              <div className="dg-type-display">Display</div>
            </div>
            <div className="dg-type-row">
              <div className="dg-type-meta">
                <div className="dg-size">32px</div>
                <div className="dg-weight">Bold 700</div>
              </div>
              <div className="dg-type-h1">Heading One</div>
            </div>
            <div className="dg-type-row">
              <div className="dg-type-meta">
                <div className="dg-size">28px</div>
                <div className="dg-weight">Feather Bold</div>
              </div>
              <div className="dg-type-h2">heading two</div>
            </div>
            <div className="dg-type-row">
              <div className="dg-type-meta">
                <div className="dg-size">18px</div>
                <div className="dg-weight">Medium 500</div>
              </div>
              <div className="dg-type-body">
                Body text for paragraphs and descriptions with comfortable reading line-height.
              </div>
            </div>
            <div className="dg-type-row">
              <div className="dg-type-meta">
                <div className="dg-size">14px</div>
                <div className="dg-weight">Bold 700</div>
              </div>
              <div className="dg-type-caption">CAPTION LABEL</div>
            </div>
            <div className="dg-type-row">
              <div className="dg-type-meta">
                <div className="dg-size">12px</div>
                <div className="dg-weight">Semi 600</div>
              </div>
              <div className="dg-type-small">Small utility text for metadata and hints</div>
            </div>
          </div>
        </section>

        <section className="dg-panel" id="buttons">
          <div className="dg-section-label">BUTTON VARIANTS</div>
          <div className="dg-button-groups">
            <div className="dg-button-row">
              <div className="dg-row-label">Primary</div>
              <div className="dg-row-content">
                <button className="dg-btn dg-btn-primary">GET STARTED</button>
                <button className="dg-btn dg-btn-primary dg-btn-sm">SMALL</button>
                <button className="dg-btn dg-btn-primary" disabled>DISABLED</button>
              </div>
            </div>
            <div className="dg-button-row">
              <div className="dg-row-label">Secondary</div>
              <div className="dg-row-content">
                <button className="dg-btn dg-btn-secondary">LEARN MORE</button>
                <button className="dg-btn dg-btn-secondary dg-btn-sm">SMALL</button>
                <button className="dg-btn dg-btn-secondary" disabled>DISABLED</button>
              </div>
            </div>
            <div className="dg-button-row">
              <div className="dg-row-label">Danger</div>
              <div className="dg-row-content">
                <button className="dg-btn dg-btn-danger">DELETE</button>
                <button className="dg-btn dg-btn-danger dg-btn-sm">REMOVE</button>
              </div>
            </div>
            <div className="dg-button-row">
              <div className="dg-row-label">Ghost</div>
              <div className="dg-row-content">
                <button className="dg-btn dg-btn-ghost">VIEW ALL</button>
              </div>
            </div>
          </div>
        </section>

        <section className="dg-panel dg-panel-dark">
          <div className="dg-section-label">DARK THEME BUTTONS</div>
          <div className="dg-button-groups">
            <div className="dg-row-content">
              <button className="dg-btn dg-btn-primary">GET STARTED</button>
              <button className="dg-btn dg-btn-light">TRY 1 WEEK FREE</button>
            </div>
            <div className="dg-row-content">
              <button className="dg-btn dg-btn-primary dg-btn-sm">GET STARTED</button>
              <button className="dg-btn dg-btn-light dg-btn-sm">TRY 1 WEEK FREE</button>
            </div>
          </div>
        </section>

        <section className="dg-panel" id="cards">
          <div className="dg-section-label">CARDS</div>
          <div className="dg-card-grid">
            <article className="dg-course-card">
              <img
                src="https://images.pexels.com/photos/4145354/pexels-photo-4145354.jpeg?auto=compress&cs=tinysrgb&w=400&h=200&fit=crop"
                alt="Spanish for Beginners"
              />
              <div className="dg-card-body">
                <span className="dg-tag dg-tag-green">NEW</span>
                <h3>Spanish for Beginners</h3>
                <p>Start your language journey with interactive lessons designed to build fluency.</p>
              </div>
              <footer>
                <span>12 UNITS</span>
                <button>START</button>
              </footer>
            </article>

            <article className="dg-course-card">
              <img
                src="https://images.pexels.com/photos/267669/pexels-photo-267669.jpeg?auto=compress&cs=tinysrgb&w=400&h=200&fit=crop"
                alt="French Conversations"
              />
              <div className="dg-card-body">
                <span className="dg-tag dg-tag-blue">POPULAR</span>
                <h3>French Conversations</h3>
                <p>Practice real-world dialogue and improve pronunciation with native speakers.</p>
              </div>
              <footer>
                <span>8 UNITS</span>
                <button>CONTINUE</button>
              </footer>
            </article>
          </div>
        </section>

        <section className="dg-panel dg-panel-dark">
          <div className="dg-section-label">DARK THEME CARDS</div>
          <div className="dg-card-grid">
            <article className="dg-dark-card">
              <span className="dg-tag dg-tag-golden">SUPER</span>
              <h3>Unlimited Hearts</h3>
              <p>Keep learning without interruption with Super Duolingo benefits.</p>
              <footer>
                <span>PREMIUM</span>
                <button>UPGRADE</button>
              </footer>
            </article>
            <article className="dg-dark-card">
              <span className="dg-tag dg-tag-orange">PRO</span>
              <h3>Mastery Quizzes</h3>
              <p>Challenge yourself with advanced assessments to test your skill level.</p>
              <footer>
                <span>ADVANCED</span>
                <button>TRY NOW</button>
              </footer>
            </article>
          </div>
        </section>

        <section className="dg-panel" id="components">
          <div className="dg-section-label">COMPONENTS</div>
          <div className="dg-components-stack">
            <div className="dg-group">
              <div className="dg-group-title">BADGES</div>
              <div className="dg-badge-row">
                <span className="dg-pill dg-pill-green">COMPLETED</span>
                <span className="dg-pill dg-pill-blue">IN PROGRESS</span>
                <span className="dg-pill dg-pill-red">FAILED</span>
                <span className="dg-pill dg-pill-orange">STREAK</span>
                <span className="dg-pill dg-pill-golden">PREMIUM</span>
              </div>
            </div>

            <div className="dg-group">
              <div className="dg-group-title">INPUT + BUTTON</div>
              <div className="dg-input-row">
                <input placeholder="Enter your email address" />
                <button className="dg-btn dg-btn-primary">SUBSCRIBE</button>
              </div>
            </div>

            <div className="dg-group">
              <div className="dg-group-title">TOGGLE</div>
              <div className="dg-toggle-row">
                <label className="dg-toggle-item">
                  <span>Sound effects</span>
                  <button
                    className={`dg-toggle ${soundEnabled ? "checked" : ""}`}
                    onClick={() => setSoundEnabled((v) => !v)}
                    aria-pressed={soundEnabled}
                  >
                    <span className="dg-toggle-thumb" />
                  </button>
                </label>
                <label className="dg-toggle-item">
                  <span>Animations</span>
                  <button
                    className={`dg-toggle ${animEnabled ? "checked" : ""}`}
                    onClick={() => setAnimEnabled((v) => !v)}
                    aria-pressed={animEnabled}
                  >
                    <span className="dg-toggle-thumb" />
                  </button>
                </label>
              </div>
            </div>

            <div className="dg-group">
              <div className="dg-group-title">PROGRESS</div>
              <div className="dg-progress-stack">
                {[["85%", "var(--green)"], ["60%", "var(--blue)"], ["35%", "var(--orange)"]].map(([v, c]) => (
                  <div className="dg-progress-row" key={v}>
                    <div className="dg-progress-track"><div className="dg-progress-fill" style={{ width: v, background: c }} /></div>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="dg-group">
              <div className="dg-group-title">TOOLTIPS & STREAK</div>
              <div className="dg-tooltip-row">
                <div className="dg-tooltip-wrap">
                  <button className="dg-tooltip-trigger">Hover me</button>
                  <span className="dg-tooltip-bubble">Helpful tooltip guidance</span>
                </div>
                <div className="dg-streak"><span>🔥</span><strong>42</strong></div>
              </div>
            </div>
          </div>
        </section>

        <section className="dg-panel dg-panel-dark">
          <div className="dg-section-label">DARK THEME COMPONENTS</div>
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
                  <button key={String(name)} className={`dg-lang-pill ${active ? "active" : ""}`}>
                    <img src={String(flag)} alt="" />
                    <span>{name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="dg-group">
              <div className="dg-group-title">AVATAR GROUP</div>
              <div className="dg-avatar-row">
                <div className="dg-avatar-stack">
                  {[
                    "https://images.pexels.com/photos/774909/pexels-photo-774909.jpeg?auto=compress&cs=tinysrgb&w=80&h=80&fit=crop",
                    "https://images.pexels.com/photos/1222271/pexels-photo-1222271.jpeg?auto=compress&cs=tinysrgb&w=80&h=80&fit=crop",
                    "https://images.pexels.com/photos/733872/pexels-photo-733872.jpeg?auto=compress&cs=tinysrgb&w=80&h=80&fit=crop",
                  ].map((src) => <img key={src} src={src} alt="" />)}
                  <span className="dg-avatar-count">+5</span>
                </div>
                <span className="dg-avatar-text">8 learners active</span>
              </div>
            </div>

            <div className="dg-group">
              <div className="dg-group-title">PROGRESS (DARK)</div>
              <div className="dg-progress-stack dark">
                {[["72%", "var(--golden)"], ["45%", "var(--green)"]].map(([v, c]) => (
                  <div className="dg-progress-row" key={v}>
                    <div className="dg-progress-track"><div className="dg-progress-fill" style={{ width: v, background: c }} /></div>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="dg-group">
              <div className="dg-group-title">BADGES (DARK)</div>
              <div className="dg-badge-row">
                <span className="dg-pill dg-pill-dark-green">MASTERED</span>
                <span className="dg-pill dg-pill-dark-blue">REVIEW</span>
                <span className="dg-pill dg-pill-dark-golden">CROWN</span>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

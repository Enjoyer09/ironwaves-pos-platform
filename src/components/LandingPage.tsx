import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "./ui/button";
import logo from "../assets/logo.png";

type Lang = "az" | "ru" | "en";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260308_114720_3dabeb9e-2c39-4907-b747-bc3544e2d5b7.mp4";

const copy: Record<
  Lang,
  {
    nav: [string, string, string, string];
    demo: string;
    headline: string;
    sub1: string;
    sub2: string;
    trusted1: string;
    trusted2: string;
    badges: string[];
    moduleTitle: string;
    moduleSub: string;
    modules: string[];
    howTitle: string;
    steps: string[];
  }
> = {
  az: {
    nav: ["Məhsul", "Funksiyalar", "Sahələr", "Demo"],
    demo: "Demoya keç",
    headline: "iRonWaves POS",
    sub1: "Restoranınızı bir platformadan idarə edin",
    sub2: "POS, Masalar, KDS, Maliyyə, Dashboard və CRM bir sistemdə",
    trusted1: "Restoran, coffee shop və fast-food",
    trusted2: "obyektləri üçün operativ nəzarət platforması",
    badges: ["Masa xidməti", "Mətbəx axını", "Kassa nəzarəti", "Canlı dashboard"],
    moduleTitle: "Platforma modulları",
    moduleSub: "Satışdan mətbəxə, maliyyədən auditə qədər bütün axınlar bir yerdədir.",
    modules: [
      "POS",
      "Masalar",
      "Mətbəx ekranı (KDS)",
      "Maliyyə",
      "Dashboard",
      "Analitika",
      "Z-Hesabat / X-Hesabat",
      "CRM / Loyallıq",
      "QR Menu",
      "Loglar və audit",
    ],
    howTitle: "Necə işləyir",
    steps: [
      "Satışı və ya masanı aç",
      "Sifarişi mətbəxə göndər",
      "Hazır məhsulu və hesabı idarə et",
      "Dashboard və maliyyədən nəzarəti tamamla",
    ],
  },
  ru: {
    nav: ["Продукт", "Функции", "Сферы", "Демо"],
    demo: "Перейти к демо",
    headline: "iRonWaves POS",
    sub1: "Управляйте рестораном из одной платформы",
    sub2: "POS, столы, KDS, финансы, dashboard и CRM в одной системе",
    trusted1: "Для ресторанов, coffee shop и fast-food",
    trusted2: "единая платформа оперативного контроля",
    badges: ["Обслуживание столов", "Поток кухни", "Контроль кассы", "Живой dashboard"],
    moduleTitle: "Модули платформы",
    moduleSub: "От продаж до кухни, от финансов до аудита все потоки собраны в одном месте.",
    modules: [
      "POS",
      "Столы",
      "Экран кухни (KDS)",
      "Финансы",
      "Dashboard",
      "Аналитика",
      "Z-Отчёт / X-Отчёт",
      "CRM / Лояльность",
      "QR Menu",
      "Логи и аудит",
    ],
    howTitle: "Как это работает",
    steps: [
      "Откройте продажу или стол",
      "Отправьте заказ на кухню",
      "Управляйте готовыми позициями и счётом",
      "Закройте контроль через dashboard и финансы",
    ],
  },
  en: {
    nav: ["Product", "Features", "Industries", "Demo"],
    demo: "Go to Demo",
    headline: "iRonWaves POS",
    sub1: "Run your restaurant from one platform",
    sub2: "POS, Tables, KDS, Finance, Dashboard and CRM in one system",
    trusted1: "Built for restaurants, coffee shops",
    trusted2: "and fast-food operations",
    badges: ["Table service", "Kitchen flow", "Cash control", "Live dashboard"],
    moduleTitle: "Platform modules",
    moduleSub: "From sales to kitchen, from finance to audit, every flow is connected.",
    modules: [
      "POS",
      "Tables",
      "Kitchen display (KDS)",
      "Finance",
      "Dashboard",
      "Analytics",
      "Z-Report / X-Report",
      "CRM / Loyalty",
      "QR Menu",
      "Logs and audit",
    ],
    howTitle: "How it works",
    steps: [
      "Open a sale or table",
      "Send the order to kitchen",
      "Manage ready items and billing",
      "Close the loop in dashboard and finance",
    ],
  },
};

const BRANDS = ["Vortex", "Nimbus", "Prysma", "Cirrus", "Kynder", "Halcyn"];

function Navbar({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const t = copy[lang];
  return (
    <div className="w-full">
      <div className="flex w-full items-center justify-between px-8 py-5">
        <img src={logo} alt="Logo" className="h-8 w-auto object-contain" />
        <div className="hidden items-center gap-8 md:flex">
          <button className="inline-flex items-center gap-1 text-base text-foreground/90">
            <span>{t.nav[0]}</span>
            <ChevronDown size={16} />
          </button>
          <button className="text-base text-foreground/90">{t.nav[1]}</button>
          <button className="text-base text-foreground/90">{t.nav[2]}</button>
          <button className="inline-flex items-center gap-1 text-base text-foreground/90">
            <span>{t.nav[3]}</span>
            <ChevronDown size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="liquid-glass flex rounded-full p-1 text-xs">
            {(["az", "ru", "en"] as Lang[]).map((l) => (
              <button
                key={l}
                className={`rounded-full px-2 py-1 uppercase ${lang === l ? "bg-white/10 text-foreground" : "text-foreground/60"}`}
                onClick={() => setLang(l)}
              >
                {l}
              </button>
            ))}
          </div>
          <Button
            variant="heroSecondary"
            size="sm"
            className="rounded-full px-4 py-2"
            onClick={() => window.open("https://demo.ironwaves.store", "_blank", "noopener,noreferrer")}
          >
            {t.demo}
          </Button>
        </div>
      </div>
      <div className="mt-[3px] h-px w-full bg-gradient-to-r from-transparent via-foreground/20 to-transparent" />
    </div>
  );
}

function HeroSection({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  const t = copy[lang];
  return (
    <section className="relative overflow-hidden bg-background">
      <Navbar lang={lang} setLang={setLang} />
      <div className="mx-auto flex max-w-[1400px] flex-col items-center px-4 pb-4 pt-20 text-center">
        <h1
          className="text-[180px] font-normal leading-[1.02] tracking-[-0.024em] text-transparent md:text-[230px]"
          style={{
            fontFamily: "'General Sans', sans-serif",
            backgroundImage: "linear-gradient(223deg, #E8E8E9 0%, #3A7BBF 104.15%)",
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
          }}
        >
          {t.headline}
        </h1>
        <p className="mt-4 max-w-2xl text-center text-lg leading-8 text-[hsl(var(--hero-sub))] opacity-80">
          {t.sub1}
          <br />
          {t.sub2}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {t.badges.map((item) => (
            <span key={item} className="liquid-glass rounded-full px-3 py-1 text-xs font-medium text-foreground/90">
              {item}
            </span>
          ))}
        </div>
        <div className="mb-[66px] mt-8">
          <Button
            variant="heroSecondary"
            className="px-[29px] py-[24px]"
            onClick={() => window.open("https://demo.ironwaves.store", "_blank", "noopener,noreferrer")}
          >
            {t.demo}
          </Button>
        </div>
      </div>
    </section>
  );
}

function SocialProofSection({ lang }: { lang: Lang }) {
  const t = copy[lang];
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const resetTimerRef = useRef<number | null>(null);
  const fadeSeconds = 0.5;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const animate = () => {
      const duration = Number(video.duration || 0);
      const current = Number(video.currentTime || 0);
      let opacity = 1;

      if (duration > 0) {
        if (current < fadeSeconds) opacity = Math.max(0, Math.min(1, current / fadeSeconds));
        else if (current > duration - fadeSeconds) {
          const remain = Math.max(0, duration - current);
          opacity = Math.max(0, Math.min(1, remain / fadeSeconds));
        }
      }
      video.style.opacity = String(opacity);
      rafRef.current = requestAnimationFrame(animate);
    };

    const onEnded = () => {
      video.style.opacity = "0";
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => {
        video.currentTime = 0;
        void video.play();
      }, 100);
    };

    video.style.opacity = "0";
    video.addEventListener("ended", onEnded);
    void video.play();
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      video.removeEventListener("ended", onEnded);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    };
  }, []);

  const marqueeItems = useMemo(() => [...BRANDS, ...BRANDS], []);

  return (
    <section className="relative w-full overflow-hidden bg-background">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
        style={{ opacity: 0 }}
      >
        <source src={VIDEO_URL} type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" />

      <div className="relative z-10 flex flex-col items-center gap-20 px-4 pb-24 pt-16">
        <div className="h-40" />
        <div className="w-full max-w-5xl">
          <div className="flex flex-col items-start gap-8 lg:flex-row lg:items-center">
            <p className="shrink-0 whitespace-nowrap text-sm text-foreground/50">
              {t.trusted1}
              <br />
              {t.trusted2}
            </p>
            <div className="relative w-full overflow-hidden">
              <div className="flex w-max animate-marquee items-center gap-16">
                {marqueeItems.map((brand, i) => (
                  <div key={`${brand}-${i}`} className="flex items-center gap-3">
                    <div className="liquid-glass flex h-6 w-6 items-center justify-center rounded-lg text-xs font-semibold text-foreground">
                      {brand.slice(0, 1)}
                    </div>
                    <span className="text-base font-semibold text-foreground">{brand}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ModulesSection({ lang }: { lang: Lang }) {
  const t = copy[lang];
  return (
    <section className="bg-background px-4 pb-20">
      <div className="mx-auto max-w-6xl">
        <h2 className="text-center text-3xl font-semibold text-foreground">{t.moduleTitle}</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-foreground/70">{t.moduleSub}</p>
        <div className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {t.modules.map((m) => (
            <div key={m} className="liquid-glass rounded-2xl px-4 py-3 text-sm text-foreground/90">
              {m}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection({ lang }: { lang: Lang }) {
  const t = copy[lang];
  return (
    <section className="bg-background px-4 pb-28">
      <div className="mx-auto max-w-6xl">
        <h3 className="text-center text-3xl font-semibold text-foreground">{t.howTitle}</h3>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {t.steps.map((step, i) => (
            <div key={step} className="liquid-glass rounded-2xl px-4 py-4 text-foreground/90">
              <div className="text-xs text-foreground/60">0{i + 1}</div>
              <div className="mt-1 text-base">{step}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  const [lang, setLang] = useState<Lang>("az");

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
    <>
      <HeroSection lang={lang} setLang={setLang} />
      <SocialProofSection lang={lang} />
      <ModulesSection lang={lang} />
      <HowItWorksSection lang={lang} />
    </>
  );
}

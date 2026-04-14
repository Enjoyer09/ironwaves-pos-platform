import { useEffect, useMemo, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "./ui/button";
import logo from "../assets/logo.png";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260308_114720_3dabeb9e-2c39-4907-b747-bc3544e2d5b7.mp4";

const BRANDS = ["Vortex", "Nimbus", "Prysma", "Cirrus", "Kynder", "Halcyn"];

function Navbar() {
  return (
    <div className="w-full">
      <div className="flex w-full items-center justify-between px-8 py-5">
        <img src={logo} alt="Logo" className="h-8 w-auto object-contain" />
        <div className="hidden items-center gap-8 md:flex">
          <button className="inline-flex items-center gap-1 text-base text-foreground/90">
            <span>Məhsul</span>
            <ChevronDown size={16} />
          </button>
          <button className="text-base text-foreground/90">Funksiyalar</button>
          <button className="text-base text-foreground/90">Sahələr</button>
          <button className="inline-flex items-center gap-1 text-base text-foreground/90">
            <span>Demo</span>
            <ChevronDown size={16} />
          </button>
        </div>
        <Button
          variant="heroSecondary"
          size="sm"
          className="rounded-full px-4 py-2"
          onClick={() => window.open("https://demo.ironwaves.store", "_blank", "noopener,noreferrer")}
        >
          Demoya keç
        </Button>
      </div>
      <div className="mt-[3px] h-px w-full bg-gradient-to-r from-transparent via-foreground/20 to-transparent" />
    </div>
  );
}

function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-background">
      <Navbar />
      <div className="mx-auto flex max-w-[1400px] flex-col items-center px-4 pb-4 pt-20 text-center">
        <h1
          className="text-[230px] font-normal leading-[1.02] tracking-[-0.024em] text-transparent"
          style={{
            fontFamily: "'General Sans', sans-serif",
            backgroundImage: "linear-gradient(223deg, #E8E8E9 0%, #3A7BBF 104.15%)",
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
          }}
        >
          Grow
        </h1>
        <p className="mt-4 max-w-xl text-center text-lg leading-8 text-[hsl(var(--hero-sub))] opacity-80">
          Restoranınızı bir platformadan idarə edin
          <br />
          POS, Masalar, KDS, Maliyyə və Dashboard bir sistemdə
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {["Masa xidməti", "Mətbəx axını", "Kassa nəzarəti", "Canlı dashboard"].map((item) => (
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
            Demoya keç
          </Button>
        </div>
      </div>
    </section>
  );
}

function SocialProofSection() {
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
        if (current < fadeSeconds) {
          opacity = Math.max(0, Math.min(1, current / fadeSeconds));
        } else if (current > duration - fadeSeconds) {
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
              Restoran, coffee shop və
              <br />
              fast-food obyektləri üçün
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

export default function LandingPage() {
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
      <HeroSection />
      <SocialProofSection />
    </>
  );
}

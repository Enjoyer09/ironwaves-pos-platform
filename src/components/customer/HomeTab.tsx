import React from 'react';
import { Gift, Sparkles, QrCode, Menu } from 'lucide-react';
import { ImpactStyle } from '@capacitor/haptics';
import { tx } from '../../i18n';
import { formatCardId, playTickSound, getWeatherInfo, get_customer_wallet_pass_url, nativeHapticImpact, Haptic } from '../../lib/customer_utils';

/* ── Animated Counter ────────────────────────────────────────────── */
function AnimatedCounter({ value, suffix = '', decimals = 0 }: { value: number; suffix?: string; decimals?: number }) {
  const [display, setDisplay] = React.useState(0);
  const prevRef = React.useRef(0);
  const rafRef = React.useRef<number>();

  React.useEffect(() => {
    const startVal = prevRef.current;
    const endVal = value;
    if (startVal === endVal) { setDisplay(endVal); return; }
    const duration = 700;
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(startVal + (endVal - startVal) * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    prevRef.current = endVal;
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value]);

  return <>{display.toFixed(decimals)}{suffix}</>;
}

/* ── Confetti burst ─────────────────────────────────────────────── */
function spawnConfetti(originX: number, originY: number) {
  const colors = ['#F48C24', '#ffb366', '#1A4329', '#34d399', '#facc15', '#a78bfa', '#f472b6'];
  for (let i = 0; i < 40; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-particle';
    const angle = Math.random() * 360;
    const distance = 80 + Math.random() * 180;
    const dx = Math.cos((angle * Math.PI) / 180) * distance;
    const dy = Math.sin((angle * Math.PI) / 180) * distance - 60;
    const rot = (Math.random() - 0.5) * 720;
    const duration = 0.8 + Math.random() * 0.8;
    const size = 5 + Math.random() * 8;
    el.style.cssText = `
      left: ${originX - size / 2}px;
      top: ${originY - size / 2}px;
      width: ${size}px;
      height: ${size}px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
      --dx: ${dx}px;
      --dy: ${dy}px;
      --rot: ${rot}deg;
      --duration: ${duration}s;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), duration * 1000 + 100);
  }
}

/* ── Toast ──────────────────────────────────────────────────────── */
function showToast(message: string) {
  const el = document.createElement('div');
  el.className = 'cust-toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2700);
}

type Props = {
  safeLang: string;
  customer: any;
  customer_card_id: string;
  branding: any;
  wallet: any;
  primaryColor: string;
  accentColor: string;
  programMode: string;
  cardQr: string;
  showQrCard: boolean;
  showWallet: boolean;
  balanceSuffix: string;
  heroImage: string;
  cardFlipped: boolean;
  setCardFlipped: (v: boolean) => void;
  spawnParticles: (e: React.MouseEvent<HTMLElement>) => void;
  claimReward: () => void;
  claiming: boolean;
  rewards: any[];
  progressPercent: number;
  notifications: any[];
  favoriteItems: any[];
  pendingClaims: any[];
  geofenceAlert: boolean;
  setGeofenceAlert: (v: boolean) => void;
  simulatedTemp: number;
  simulatedCondition: 'sunny' | 'rainy';
  setSimulatedTemp: React.Dispatch<React.SetStateAction<number>>;
  setSimulatedCondition: React.Dispatch<React.SetStateAction<'sunny' | 'rainy'>>;
  setActiveTab: (tab: any) => void;
  tick: number;
  openWalletPass: (e: React.MouseEvent, url: string) => void;
  get_customer_wallet_pass_url_fn: (cardId: string, token: string, lang: string) => string;
  sessionCreds: { cardId: string; token: string };
  data: any;
  isLight?: boolean;
};

export default function HomeTab({
  safeLang, customer, customer_card_id, branding, wallet, primaryColor,
  accentColor, programMode, cardQr, showQrCard, showWallet, balanceSuffix,
  heroImage, cardFlipped, setCardFlipped, spawnParticles, claimReward, claiming,
  rewards, progressPercent, notifications, favoriteItems, pendingClaims,
  geofenceAlert, setGeofenceAlert, simulatedTemp, simulatedCondition,
  setSimulatedTemp, setSimulatedCondition, setActiveTab, tick,
  openWalletPass, get_customer_wallet_pass_url_fn, sessionCreds, data, isLight = false
}: Props) {

  const headerBtn   = isLight ? 'bg-white/80 border-black/8 text-slate-800 shadow-sm backdrop-blur-sm' : 'bg-white/8 border-white/12 text-white/90 backdrop-blur-md';
  const headerText  = isLight ? 'text-slate-900' : 'text-white';
  const subText     = isLight ? 'text-slate-500' : 'text-white/60';
  const textMuted   = isLight ? 'text-slate-400' : 'text-white/40';
  const borderSec   = isLight ? 'border-black/6' : 'border-white/8';
  const bgCard      = isLight ? 'cust-glass-light' : 'cust-glass premium-shadow';
  const inputSearch = isLight ? 'bg-white/80 border-black/8 text-slate-900 placeholder-slate-400 backdrop-blur-sm shadow-sm' : 'bg-white/6 border-white/10 text-white placeholder-white/40 backdrop-blur-md';
  const walletBtn   = isLight ? 'bg-white border-black/8 text-slate-800 shadow-sm hover:bg-slate-50' : 'bg-white/6 hover:bg-white/10 text-white border-white/10 backdrop-blur-sm';
  const comboCard   = isLight ? 'bg-orange-50/60 border-orange-100/80 hover:bg-orange-50 shadow-sm' : 'bg-gradient-to-r from-[#F48C24]/10 to-[#ffb366]/5 border-white/10 hover:border-[#F48C24]/30 hover:shadow-[0_0_20px_rgba(244,140,36,0.12)]';

  const formatCardIdFn = (id: string) => {
    const clean = String(id || '').replace(/[^a-zA-Z0-9]/g, '');
    if (!clean) return '•••• •••• •••• ••••';
    const chunks: string[] = [];
    for (let i = 0; i < clean.length; i += 4) chunks.push(clean.slice(i, i + 4));
    return chunks.join(' ');
  };

  const handleClaimWithConfetti = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    spawnConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
    claimReward();
  };

  return (
    <div className="space-y-4">
      <style>{`
        @keyframes modalFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.88) translateY(24px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes sparkle {
          0%   { transform: translate(0,0) scale(1) rotate(0deg); opacity: 1; }
          100% { transform: translate(var(--dx),var(--dy)) scale(0) rotate(180deg); opacity: 0; }
        }
        @keyframes cardShimmer {
          0%   { background-position: -300% 0; }
          100% { background-position: 300% 0; }
        }
        .animate-modalFadeIn { animation: modalFadeIn 0.25s ease forwards; }
        .animate-scaleIn { animation: scaleIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
        .animate-sparkle { animation: sparkle 0.8s cubic-bezier(0.25,1,0.5,1) forwards; }
        .card-sweep::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.16) 50%, transparent 70%);
          background-size: 300% 100%;
          animation: cardShimmer 4s ease-in-out infinite;
          border-radius: inherit;
          pointer-events: none;
        }
        .wallet-balance-glow {
          text-shadow: 0 0 24px rgba(244,140,36,0.35);
        }
        .progress-shimmer {
          background: linear-gradient(90deg, #F48C24, #ffb366, #F48C24);
          background-size: 200% 100%;
          animation: gradientShift 2s linear infinite;
        }
      `}</style>

      {/* Top Header Row */}
      <div className="flex items-center justify-between px-1 mb-4">
        <button type="button" onClick={() => setActiveTab('profile')}
          className={`h-10 w-10 rounded-full border flex items-center justify-center active:scale-95 transition-all duration-150 ${headerBtn}`}>
          <Menu size={20} />
        </button>
        <button type="button" onClick={() => setActiveTab('profile')}
          className={`relative h-10 w-10 rounded-full border flex items-center justify-center font-black active:scale-95 transition-all duration-150 ${headerBtn}`}>
          {customer.name ? customer.name.charAt(0).toUpperCase() : 'M'}
          {notifications.filter((n: any) => !n.is_read).length > 0 && (
            <span className="absolute top-0 right-0 h-2.5 w-2.5 rounded-full bg-[#F48C24] border-2 border-[#181412] animate-pulse" />
          )}
        </button>
      </div>

      {/* Hero Greeting */}
      <div className="px-1 mb-6 stagger-fade-in">
        <p className={`text-[12px] font-bold uppercase tracking-wider ${subText}`}>
          {tx(safeLang, `Salam, ${customer.name || 'Qonaq'} 👋`, `Привет, ${customer.name || 'Гость'} 👋`, `Hi, ${customer.name || 'Guest'} 👋`)}
        </p>
        <h1 className={`mt-1 text-3xl font-black leading-tight tracking-tight ${headerText}`}>
          {tx(safeLang, 'Yaxşı Qəhvə,', 'Хороший Кофе,', 'Good Coffee,')}<br />
          {tx(safeLang, 'Yaxşı Əhval!', 'Хорошее Настроение!', 'Good ')}
          <span className="text-[#F48C24]">{tx(safeLang, '', '', 'Mood!')}</span>
        </h1>
      </div>

      {/* Search & Filter Bar */}
      <div className="px-1 mb-6 flex gap-3 stagger-fade-in stagger-1">
        <div className="relative flex-1">
          <input type="text" readOnly
            placeholder={tx(safeLang, 'Sevdiyiniz dadları axtarın...', 'Найдите ваш любимый вкус...', 'Search your favorite coffee...')}
            className={`w-full rounded-full border px-10 py-3 text-xs transition duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#F48C24]/40 ${inputSearch}`}
            onClick={() => setActiveTab('order')} />
          <span className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${textMuted}`}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
        </div>
        <button type="button" onClick={() => setActiveTab('order')}
          className="h-10 w-10 rounded-full bg-[#F48C24] flex items-center justify-center text-white animate-glow-breath active:scale-95 transition-all duration-150 shimmer-btn">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
        </button>
      </div>

      {/* Geofence Alert */}
      {geofenceAlert && (
        <div className="flex items-center justify-between gap-3 rounded-2xl p-4 animate-pulse shimmer-card"
          style={{ background: 'linear-gradient(135deg, rgba(250,204,21,0.12) 0%, rgba(34,211,238,0.12) 100%)', border: '1px solid rgba(250,204,21,0.28)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
          <div className="flex gap-3">
            <span className="text-2xl float-slow">☕</span>
            <div>
              <h4 className="text-[13px] font-black text-yellow-500">{tx(safeLang, 'iRonWaves-ə yaxınsan!', 'Рядом с iRonWaves!', 'Near iRonWaves!')}</h4>
              <p className={`mt-0.5 text-[11px] ${isLight ? 'text-slate-700' : 'text-slate-200'}`}>{tx(safeLang, 'İçəri keç, ulduzlarını qəhvəyə çevir! 🌟', 'Заходи, преврати свои звезды в кофе! 🌟', 'Come in and turn your stars into coffee! 🌟')}</p>
            </div>
          </div>
          <button onClick={() => setGeofenceAlert(false)} className={`text-[14px] font-bold px-2 py-1 ${subText}`}>✕</button>
        </div>
      )}

      {/* Premium Digital Membership Card */}
      <div onClick={async (e) => { spawnParticles(e); playTickSound(); setCardFlipped(!cardFlipped); await nativeHapticImpact(ImpactStyle.Light); }}
        className="w-full h-[220px] select-none cursor-pointer stagger-fade-in stagger-2"
        style={{ perspective: '1200px' }}>
        <div className={`relative w-full h-full duration-700 preserve-3d transition-transform ${cardFlipped ? 'rotate-y-180' : ''}`}>

          {/* CARD FRONT */}
          <div className={`absolute inset-0 backface-hidden border flex flex-col justify-between overflow-hidden card-sweep ${isLight ? 'card-premium-glow-light' : 'card-premium-glow'}`}
            style={{
              borderRadius: '28px',
              borderColor: isLight ? 'rgba(26,67,41,0.12)' : 'rgba(255,255,255,0.12)',
              background: heroImage
                ? `linear-gradient(180deg, rgba(26, 67, 41, 0.15), rgba(26, 67, 41, 0.82)), url(${heroImage}) center/cover`
                : `linear-gradient(135deg, ${accentColor} 0%, ${primaryColor} 100%)`,
              padding: '24px',
            }}>
            {/* Glossy highlight bar */}
            <div className="absolute inset-x-0 top-0 h-24 pointer-events-none"
              style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.10), transparent)', borderRadius: '28px 28px 0 0' }} />

            <div className="flex items-start justify-between gap-4 relative z-10">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                  <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/80">{branding.app_name || 'Emalatkhana'}</p>
                </div>
                <h1 className="mt-2 text-2xl font-black text-white tracking-tight drop-shadow-lg">{branding.hero_title || tx(safeLang, 'Xoş gəldiniz', 'Добро пожаловать', 'Welcome')}</h1>
              </div>
              {branding.logo_url ? (
                <img src={branding.logo_url} alt="brand" className="h-11 w-11 rounded-xl object-cover shadow-2xl border border-white/25 ring-1 ring-white/10" />
              ) : (
                <div className="h-11 w-11 rounded-xl bg-white/15 flex items-center justify-center border border-white/25 text-xl shadow-xl">☕</div>
              )}
            </div>

            <div className="flex items-center justify-between mt-4 relative z-10">
              {/* EMV chip */}
              <div className="relative w-10 h-7 rounded-md bg-gradient-to-br from-amber-200 via-yellow-400 to-amber-300 border border-amber-500/20 shadow-inner overflow-hidden flex flex-col justify-between p-1 opacity-90">
                <div className="flex justify-between h-px bg-slate-950/20 mt-1" />
                <div className="flex justify-between h-px bg-slate-950/20" />
                <div className="flex justify-between h-px bg-slate-950/20 mb-1" />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-950/20" />
              </div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-white/80 flex items-center gap-1 bg-black/25 rounded-full px-2.5 py-1 border border-white/8 backdrop-blur-sm animate-pulse">
                <span>✨</span>
                <span>{tx(safeLang, 'Skan üçün toxun', 'Коснитесь для скана', 'Tap to Scan')}</span>
              </div>
              <div className="text-white/40">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4 12c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4-4-1.79-4-4zm11-6.5c0-.83.67-1.5 1.5-1.5C20.09 4 24 7.91 24 12.5S20.09 21 16.5 21c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5c2.48 0 4.5-2.02 4.5-4.5S18.98 9 16.5 9c-.83 0-1.5-.67-1.5-1.5zm-5-3C10.5 2.17 11.17 1.5 12 1.5C17.79 1.5 22.5 6.21 22.5 12S17.79 22.5 12 22.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5c4.14 0 7.5-3.36 7.5-7.5s-3.36-7.5-7.5-7.5c-.83 0-1.5-.67-1.5-1.5z" />
                </svg>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between text-white/50 text-[10px] font-mono tracking-[0.2em] relative z-10">
              <span>{formatCardIdFn(customer.card_id)}</span>
              <span className="text-[9px] opacity-75">{tx(safeLang, 'MÜŞTƏRİ', 'КЛИЕНТ', 'CUSTOMER')}</span>
            </div>
          </div>

          {/* CARD BACK */}
          <div className="absolute inset-0 backface-hidden rotate-y-180 border flex flex-col items-center justify-center text-white"
            style={{
              borderRadius: '28px',
              borderColor: 'rgba(255,255,255,0.15)',
              background: 'linear-gradient(135deg, rgba(26,67,41,0.85), rgba(14,12,11,0.95))',
              backdropFilter: 'blur(32px)',
              WebkitBackdropFilter: 'blur(32px)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.10), 0 16px 48px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)',
            }}>
            {/* Glossy highlight */}
            <div className="absolute inset-x-0 top-0 h-20 pointer-events-none"
              style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.08), transparent)', borderRadius: '28px 28px 0 0' }} />
            {cardQr ? (
              <div className="rounded-2xl bg-white p-3 shadow-2xl border border-white/20 ring-1 ring-black/5">
                <img src={cardQr} alt="QR Code" className="h-28 w-28 object-contain" />
              </div>
            ) : (
              <div className="text-slate-400 text-xs">No QR Code available</div>
            )}
            <div className="mt-3 text-[10px] font-black text-[#F48C24] tracking-[0.25em] uppercase">
              {tx(safeLang, 'KASSAYA YAXINLAŞDIRIN', 'ПОДНЕСИТЕ К СКАНЕРУ', 'SCAN QR CODE')}
            </div>
            <div className="mt-1 font-mono text-[9px] text-white/50">{formatCardIdFn(customer.card_id)}</div>
          </div>
        </div>
      </div>

      {/* Wallet Section */}
      {showWallet && (
        <section className={`rounded-[28px] border p-5 space-y-4 stagger-fade-in stagger-3 ${isLight ? 'cust-glass-light' : 'cust-glass premium-shadow'}`}>
          <div>
            <div className="flex items-end justify-between mb-4">
              <div>
                <p className={`text-[9px] font-bold uppercase tracking-[0.2em] ${textMuted}`}>{wallet.points_label || 'Ulduz'}</p>
                <p className={`mt-1 text-3xl font-black tracking-tight wallet-balance-glow ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  <AnimatedCounter value={Number(wallet.stars_balance ?? 0)} decimals={programMode === 'cashback' ? 2 : 0} suffix={balanceSuffix} />
                </p>
              </div>
              <span className={`inline-block rounded-full px-3 py-1 text-[10px] font-bold tracking-wider uppercase border ${isLight ? 'bg-black/5 border-black/8 text-slate-800' : 'bg-white/6 border-white/12 text-white'}`}>
                {programMode === 'cashback' ? `${Number(wallet.cashback_percent || 0).toFixed(0)}% cashback` : (customer.type || 'Member')}
              </span>
            </div>

            {programMode === 'points' ? (
              <div className={`border-t pt-4 ${borderSec}`}>
                <div className="flex items-center gap-5">
                  <div className="relative select-none flex-shrink-0 flex items-center justify-center">
                    <svg viewBox="0 0 100 110" className="w-16 h-18 overflow-visible">
                      <defs>
                        <linearGradient id="coffeeLiquidGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stopColor="#ffb366" />
                          <stop offset="40%" stopColor="#F48C24" />
                          <stop offset="100%" stopColor="#b35900" />
                        </linearGradient>
                        <filter id="cupGlow">
                          <feGaussianBlur stdDeviation="1.5" result="blur" />
                          <feComposite in="SourceGraphic" in2="blur" operator="over" />
                        </filter>
                        <clipPath id="cupInterior"><path d="M20 18 L80 18 L73 85 C72 93, 28 93, 27 85 Z" /></clipPath>
                      </defs>
                      <path d="M40 10 Q43 4, 40 -2" fill="none" stroke="rgba(244,140,36,0.40)" strokeWidth="1.5" strokeLinecap="round" className="animate-pulse" />
                      <path d="M50 12 Q53 6, 50 0"  fill="none" stroke="rgba(244,140,36,0.55)" strokeWidth="1.5" strokeLinecap="round" className="animate-pulse" />
                      <path d="M60 10 Q63 4, 60 -2" fill="none" stroke="rgba(244,140,36,0.40)" strokeWidth="1.5" strokeLinecap="round" className="animate-pulse" />
                      <path d="M76 35 C90 35, 90 65, 76 65" fill="none" stroke={isLight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.15)'} strokeWidth="4.5" strokeLinecap="round" />
                      <path d="M20 18 L80 18 L73 85 C72 93, 28 93, 27 85 Z" fill={isLight ? 'rgba(0,0,0,0.02)' : 'rgba(255,255,255,0.02)'} stroke={isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.20)'} strokeWidth="2.5" />
                      <g clipPath="url(#cupInterior)">
                        <path d="M -100 120 L -100 45 Q -75 40, -50 45 T 0 45 T 50 45 T 100 45 T 150 45 T 200 45 L 200 120 Z"
                          fill="url(#coffeeLiquidGrad)" className="animate-wave"
                          style={{ transform: `translateY(${Math.max(0, 100 - progressPercent)}%)`, transition: 'transform 1.5s cubic-bezier(0.4, 0, 0.2, 1)' }} />
                      </g>
                    </svg>
                    <div className="absolute -top-1.5 -right-1 bg-[#F48C24] text-white font-black text-[9px] h-4.5 w-4.5 rounded-full flex items-center justify-center border border-white shadow-lg animate-bounce glow-orange-sm">★</div>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <div className={`text-[11px] font-bold ${headerText}`}>
                      {tx(safeLang,
                        `${Number(wallet.stars_balance ?? 0)} / ${Number(wallet.next_reward_at || 10)} ulduz topladınız`,
                        `Вы собрали ${Number(wallet.stars_balance ?? 0)} / ${Number(wallet.next_reward_at || 10)} звезд`,
                        `Collected ${Number(wallet.stars_balance ?? 0)} / ${Number(wallet.next_reward_at || 10)} stars`)}
                    </div>
                    <div className="space-y-0.5">
                      {[
                        { stars: Math.round(Number(wallet.next_reward_at || 10) * 0.3), label: tx(safeLang, 'Çay / Espresso', 'Чай / Эспрессо', 'Tea / Espresso') },
                        { stars: Math.round(Number(wallet.next_reward_at || 10) * 0.6), label: tx(safeLang, 'Cappuccino / Latte', 'Капучино / Латте', 'Cappuccino / Latte') },
                        { stars: Number(wallet.next_reward_at || 10), label: tx(safeLang, 'Böyük Qəhvə + Desert', 'Большой Кофе + Десерт', 'Large Coffee + Pastry') }
                      ].map((m, mIdx) => {
                        const isUnlocked = Number(wallet.stars_balance ?? 0) >= m.stars;
                        return (
                          <div key={mIdx} className={`flex items-center gap-2 text-[10px] stagger-fade-in stagger-${mIdx + 1}`}>
                            <span className={`h-2 w-2 rounded-full transition-all duration-500 ${isUnlocked ? 'bg-[#F48C24] glow-orange-sm scale-110' : isLight ? 'bg-black/10' : 'bg-white/10'}`} />
                            <span className={isUnlocked ? `${headerText} font-black` : `${textMuted} font-semibold`}>{m.stars}★ · {m.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className={`border-t pt-3 ${borderSec}`}>
                <div className={`h-2 overflow-hidden rounded-full ${isLight ? 'bg-black/8' : 'bg-white/8'}`}>
                  <div className="h-full rounded-full progress-shimmer transition-all duration-700" style={{ width: `${progressPercent}%` }} />
                </div>
                <div className={`mt-2 flex items-center justify-between text-[11px] ${textMuted}`}>
                  <span>{tx(safeLang, 'Növbəti reward', 'Следующая награда', 'Next reward')}</span>
                  <span className={`font-bold ${isLight ? 'text-slate-700' : 'text-white/80'}`}>{wallet.reward_name || 'Reward'} ({progressPercent}%)</span>
                </div>
              </div>
            )}

            {/* Wallet pass buttons */}
            <div className={`pt-3 mt-3 border-t flex flex-row gap-2 justify-center items-center ${borderSec}`}>
              {[
                { label: 'Apple Wallet', icon: <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.75.8-.01 1.99-.79 3.61-.63 1.68.07 2.92.74 3.69 1.95-3.41 2.03-2.87 6.99.78 8.44-.8 2.05-1.74 4.02-3.16 5.46zM15.42 4.38c.75-.92 1.25-2.2 1.11-3.49-1.11.05-2.46.75-3.26 1.69-.69.8-1.3 2.1-1.13 3.37 1.23.1 2.5-.62 3.28-1.57z" /> },
                { label: 'Google Wallet', icon: <path d="M21.35 11.1h-9.17v2.73h6.51c-.33 1.56-1.56 2.95-3.24 3.51v2.9h5.24c3.07-2.83 4.83-7 4.83-11.64c0-.52-.05-1.04-.17-1.5zM12.18 21c2.43 0 4.47-.8 5.96-2.18l-5.24-2.9c-1.46.99-3.29 1.56-5.96 1.56-4.59 0-8.48-3.11-9.86-7.3H1.66v3.01C4.46 18.77 8.08 21 12.18 21z" /> }
              ].map(({ label, icon }) => (
                <a key={label}
                  href={get_customer_wallet_pass_url_fn(sessionCreds.cardId, sessionCreds.token, safeLang)}
                  target="_blank" rel="noopener noreferrer"
                  onClick={(e) => openWalletPass(e, get_customer_wallet_pass_url_fn(sessionCreds.cardId, sessionCreds.token, safeLang))}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 border transition text-[10px] font-semibold active:scale-95 ${walletBtn}`}>
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">{icon}</svg>
                  {label}
                </a>
              ))}
            </div>

            <div className={`mt-4 flex items-center justify-between text-[11px] font-mono tracking-[0.2em] border-t pt-3 ${textMuted} ${borderSec}`}>
              <span>{formatCardIdFn(customer.card_id)}</span>
              <span className="text-[10px] opacity-75">{tx(safeLang, 'LOYALLIQ', 'ЛОЯЛЬНОСТЬ', 'LOYALTY')}</span>
            </div>
          </div>
        </section>
      )}

      {/* Promo Banner */}
      <section className="relative overflow-hidden rounded-[28px] p-5 text-white stagger-fade-in stagger-3 shimmer-card"
        style={{ background: 'linear-gradient(135deg, #1A4329 0%, #2E5E3D 60%, #1f5232 100%)', border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 12px 40px rgba(26,67,41,0.28), inset 0 1px 0 rgba(255,255,255,0.08)' }}>
        {/* Animated glow orbs */}
        <div className="absolute right-0 bottom-0 top-0 w-1/3 overflow-hidden pointer-events-none select-none">
          <div className="absolute -right-4 -bottom-4 w-32 h-32 rounded-full bg-[#F48C24] blur-2xl opacity-25 animate-pulse" />
          <div className="absolute right-4 top-2 w-16 h-16 rounded-full bg-white blur-xl opacity-15 float-slow" />
        </div>
        {/* Glossy top bar */}
        <div className="absolute inset-x-0 top-0 h-16 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.06), transparent)', borderRadius: '28px 28px 0 0' }} />
        <div className="relative z-10 max-w-[70%] space-y-3.5">
          <div>
            <h4 className="text-sm font-black tracking-tight leading-snug drop-shadow-sm">{tx(safeLang, 'Hər gün təzə dəmlənmiş premium qəhvə', 'Свежесваренный премиум кофе каждый день', 'Freshly brewed premium coffee everyday')}</h4>
            <p className="mt-1 text-[9px] text-white/70 font-semibold uppercase tracking-wider">{tx(safeLang, 'İndi sifariş et, növbəni keç!', 'Закажи сейчас, пропусти очередь!', 'Order now, skip the line!')}</p>
          </div>
          <button onClick={() => setActiveTab('order')}
            className="rounded-full bg-white hover:bg-slate-50 text-[#1A4329] font-black text-[9px] px-4 py-1.5 uppercase tracking-wider transition active:scale-95 shadow-lg shimmer-btn">
            {tx(safeLang, 'Sifariş Et', 'Заказать', 'Order Now')}
          </button>
        </div>
      </section>

      {/* Rewards + QR grid */}
      <div className="grid grid-cols-2 gap-3.5 stagger-fade-in stagger-4">
        {/* Rewards Card */}
        <section className={`rounded-[28px] p-5 flex flex-col justify-between border shadow-sm ${isLight ? 'cust-glass-light' : 'cust-glass'} ${Number(wallet.available_rewards || 0) > 0 ? (isLight ? 'neon-border-orange' : 'neon-border-orange animate-glow-breath') : ''}`}>
          <div>
            <div className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider ${subText}`}>
              <Gift size={14} className="text-[#F48C24] animate-bounce" />
              {tx(safeLang, 'Hədiyyələr', 'Награды', 'Rewards')}
            </div>
            <div className={`mt-3 text-4xl font-black tracking-tight ${headerText}`}>{wallet.available_rewards ?? 0}</div>
            <p className={`mt-1 text-[10px] font-semibold uppercase tracking-wider ${textMuted}`}>{wallet.reward_label || 'Hədiyyə'}</p>
          </div>
          {rewards[0] && Number(wallet.available_rewards || 0) > 0 ? (
            <button type="button" disabled={claiming} onClick={handleClaimWithConfetti}
              className="relative mt-4 w-full overflow-hidden rounded-xl py-2.5 text-[12px] font-black text-white transition-all active:scale-[0.97] disabled:opacity-50 shimmer-btn"
              style={{ background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)`, boxShadow: `0 6px 20px ${primaryColor}40` }}>
              {claiming ? '...' : tx(safeLang, 'Tətbiq et', 'Забрать', 'Claim')} 🎉
            </button>
          ) : null}
        </section>

        {/* QR Card */}
        <section onClick={async () => { setCardFlipped(!cardFlipped); playTickSound(); await nativeHapticImpact(ImpactStyle.Medium); }}
          className={`rounded-[28px] p-5 flex flex-col justify-between border shadow-sm transition active:scale-[0.97] cursor-pointer ${isLight ? 'cust-glass-light' : 'cust-glass'}`}>
          <div className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider ${subText}`}>
            <QrCode size={14} className="text-[#F48C24]" />
            {tx(safeLang, 'QR Kart', 'QR карта', 'QR Card')}
          </div>
          {showQrCard && cardQr ? (
            <div className="mt-3 flex flex-col items-center">
              <div className="p-2 bg-white rounded-2xl border border-black/5 shadow-lg ring-1 ring-black/5">
                <img src={cardQr} alt="qr" className="h-20 w-20 object-contain" />
              </div>
              <p className={`mt-2 text-[9px] font-mono tracking-widest ${textMuted}`}>{customer.card_id}</p>
            </div>
          ) : (
            <p className={`mt-4 text-xs font-mono tracking-widest ${subText}`}>{customer.card_id}</p>
          )}
        </section>
      </div>

      {/* Smart Recommendations */}
      <section className={`rounded-[28px] p-5 border shadow-sm space-y-4 stagger-fade-in stagger-5 ${isLight ? 'cust-glass-light' : 'cust-glass'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl float-slow">🌦️</span>
            <div>
              <p className={`text-xs font-bold uppercase tracking-wider ${isLight ? 'text-slate-800' : 'text-white/80'}`}>{tx(safeLang, 'Ağıllı Təkliflərimiz', 'Умные Рекомендации', 'Smart Recommendations')}</p>
              <p className={`text-[10px] font-mono mt-0.5 ${textMuted}`}>{simulatedTemp}°C • {simulatedCondition === 'sunny' ? tx(safeLang, 'Günəşli', 'Солнечно', 'Sunny') : tx(safeLang, 'Yağışlı', 'Дождливо', 'Rainy')}</p>
            </div>
          </div>
          <button type="button" onClick={async () => { await nativeHapticImpact(ImpactStyle.Light); setSimulatedTemp(t => t > 20 ? 14 : 26); setSimulatedCondition(c => c === 'sunny' ? 'rainy' : 'sunny'); }}
            className={`rounded-full border px-2.5 py-1 text-[9px] font-bold active:scale-95 transition ${isLight ? 'bg-black/5 border-black/8 text-slate-700 hover:bg-black/8' : 'bg-white/6 border-white/10 text-white hover:bg-white/12'}`}>
            🔄 {tx(safeLang, 'Havanı Dəyiş', 'Сменить погоду', 'Toggle Weather')}
          </button>
        </div>

        <div className="space-y-2">
          <p className={`text-[11px] font-semibold ${isLight ? 'text-slate-600' : 'text-white/70'}`}>{getWeatherInfo(safeLang, simulatedTemp).weatherDesc}</p>
          <div className="grid grid-cols-2 gap-2">
            {getWeatherInfo(safeLang, simulatedTemp).recommendedDrinks.map((drink, idx) => (
              <div key={idx} onClick={async () => { setActiveTab('order'); await nativeHapticImpact(ImpactStyle.Light); }}
                className={`flex items-center gap-2.5 p-3 rounded-2xl border transition-all cursor-pointer active:scale-95 ${isLight ? 'bg-white/60 border-black/5 hover:bg-white shadow-sm hover:shadow-md' : 'bg-white/5 border-white/6 hover:bg-white/10 hover:border-white/12 hover:shadow-[0_4px_16px_rgba(0,0,0,0.15)]'}`}>
                <span className="text-xl">{drink.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className={`text-[11px] font-bold truncate ${headerText}`}>{drink.name}</p>
                  <span className="inline-block px-1.5 py-0.5 mt-0.5 rounded-md bg-[#F48C24]/10 text-[#F48C24] text-[8px] font-black uppercase tracking-wider">{drink.tag}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={`pt-3 border-t ${borderSec}`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${textMuted}`}>{getWeatherInfo(safeLang, simulatedTemp).comboTitle}</p>
          {getWeatherInfo(safeLang, simulatedTemp).comboItems.map((combo, idx) => (
            <div key={idx} onClick={async () => { setActiveTab('order'); await nativeHapticImpact(ImpactStyle.Light); }}
              className={`flex items-center gap-3 p-3 rounded-2xl border transition-all cursor-pointer active:scale-[0.98] mb-2 ${comboCard}`}>
              <span className="text-2xl">{combo.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black text-[#F48C24]">{combo.name}</p>
                <p className={`text-[9px] font-semibold mt-0.5 ${subText}`}>{combo.desc}</p>
              </div>
              <span className="text-[10px] font-extrabold text-[#F48C24] bg-[#F48C24]/10 px-2 py-0.5 rounded-full border border-[#F48C24]/20">Combo</span>
            </div>
          ))}
        </div>
      </section>

      {/* Your Favorites */}
      {favoriteItems.length > 0 && (
        <section className={`rounded-[28px] p-5 border shadow-sm space-y-4 ${isLight ? 'cust-glass-light' : 'cust-glass'}`}>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={14} className="text-[#F48C24]" />
            <p className={`text-xs font-bold uppercase tracking-wider ${subText}`}>{tx(safeLang, 'Sizin Sevimliləriniz', 'Ваше любимое', 'Your Favorites')}</p>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {favoriteItems.map((item: any) => (
              <div key={item.name} onClick={async () => { setActiveTab('order'); await nativeHapticImpact(ImpactStyle.Light); }}
                className={`flex items-center gap-3 shrink-0 rounded-2xl p-3 border active:scale-95 transition-all cursor-pointer ${isLight ? 'bg-white/70 border-black/6 hover:shadow-md shadow-sm' : 'bg-white/6 border-white/6 hover:border-white/12 hover:bg-white/10'}`}
                style={{ minWidth: '160px' }}>
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center text-lg border ${isLight ? 'bg-white border-black/6 shadow-sm' : 'bg-white/10 border-white/6'}`}>
                  {(() => { switch(item.category) { case 'coffee': return '☕'; case 'tea': return '🍵'; case 'sweet': return '🍰'; case 'food': return '🥪'; default: return '🥤'; } })()}
                </div>
                <div className="overflow-hidden">
                  <p className={`text-[12px] font-bold truncate w-24 ${headerText}`}>{item.name}</p>
                  <p className={`text-[9px] mt-0.5 font-semibold ${textMuted}`}>{item.count} {tx(safeLang, 'dəfə', 'раз', 'times')}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Active Codes / Tickets */}
      <section className={`rounded-[28px] p-5 border shadow-sm ${isLight ? 'cust-glass-light' : 'cust-glass'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-[#F48C24] animate-pulse" />
            <p className={`text-xs font-bold uppercase tracking-wider ${subText}`}>{tx(safeLang, 'Aktiv Kodlar', 'Коды наград', 'Active Codes')}</p>
          </div>
          <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-[#F48C24]/10 text-[#F48C24] border border-[#F48C24]/20">{pendingClaims.length}</span>
        </div>
        <div className="mt-4 flex gap-3.5 overflow-x-auto pb-1.5">
          {pendingClaims.length === 0 ? (
            <div className={`w-full rounded-2xl py-6 text-center text-xs border border-dashed ${isLight ? 'border-black/10 bg-black/3' : 'border-white/10 bg-white/4'} ${textMuted}`}>
              {tx(safeLang, 'Hələ aktiv kodunuz yoxdur', 'Нет активных кодов', 'No active codes yet')}
            </div>
          ) : pendingClaims.map((row: any) => (
            <div key={row.id}
              className="relative min-w-[175px] shrink-0 rounded-2xl p-4 overflow-hidden flex flex-col justify-between shimmer-card"
              style={{
                background: 'linear-gradient(135deg, rgba(244,140,36,0.12) 0%, rgba(244,140,36,0.06) 100%)',
                border: '1px solid rgba(244,140,36,0.32)',
                boxShadow: '0 4px 16px rgba(244,140,36,0.10), inset 0 1px 0 rgba(255,255,255,0.05)',
              }}>
              {/* Ticket perforations */}
              <div className={`absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-r border-[#F48C24]/20 ${isLight ? 'bg-slate-100' : 'bg-[#0E0C0B]'}`} />
              <div className={`absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-l border-[#F48C24]/20 ${isLight ? 'bg-slate-100' : 'bg-[#0E0C0B]'}`} />
              {/* Dashed center line */}
              <div className="absolute top-1/2 left-4 right-4 h-px border-t border-dashed border-[#F48C24]/20 pointer-events-none" />
              <div>
                <p className="text-[8px] font-black uppercase tracking-[0.25em] text-[#F48C24]">{tx(safeLang, 'Kassaya Təqdim Et', 'На кассе', 'Present at POS')}</p>
                <p className={`mt-1.5 text-2xl font-black tracking-tight font-mono ${isLight ? 'text-slate-800' : 'text-white'}`}>{row.claim_code}</p>
              </div>
              <div className={`mt-3 pt-2 border-t text-[10px] truncate font-semibold ${isLight ? 'border-black/5 text-slate-500' : 'border-white/10 text-white/60'}`}>{row.reward_name}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

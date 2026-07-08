import React from 'react';
import { Gift, Sparkles, QrCode, Menu } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { tx } from '../../i18n';
import { formatCardId, playTickSound, getWeatherInfo, get_customer_wallet_pass_url, nativeHapticImpact } from '../../lib/customer_utils';

/* ── Animated Counter ────────────────────────────────────────────── */
function AnimatedCounter({ value, suffix = '', decimals = 0 }: { value: number; suffix?: string; decimals?: number }) {
  const [display, setDisplay] = React.useState(0);
  const prevRef = React.useRef(0);
  const rafRef = React.useRef<number>();

  React.useEffect(() => {
    const startVal = prevRef.current;
    const endVal = value;
    if (startVal === endVal) {
      setDisplay(endVal);
      return;
    }
    const duration = 600;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startVal + (endVal - startVal) * eased;
      setDisplay(current);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    prevRef.current = endVal;

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value]);

  return <>{display.toFixed(decimals)}{suffix}</>;
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
};

export default function HomeTab({
  safeLang, customer, customer_card_id, branding, wallet, primaryColor,
  accentColor, programMode, cardQr, showQrCard, showWallet, balanceSuffix,
  heroImage, cardFlipped, setCardFlipped, spawnParticles, claimReward, claiming,
  rewards, progressPercent, notifications, favoriteItems, pendingClaims,
  geofenceAlert, setGeofenceAlert, simulatedTemp, simulatedCondition,
  setSimulatedTemp, setSimulatedCondition, setActiveTab, tick,
  openWalletPass, get_customer_wallet_pass_url_fn, sessionCreds, data
}: Props) {
  const formatCardIdFn = (id: string) => {
    const clean = String(id || '').replace(/[^a-zA-Z0-9]/g, '');
    if (!clean) return '•••• •••• •••• ••••';
    const chunks: string[] = [];
    for (let i = 0; i < clean.length; i += 4) chunks.push(clean.slice(i, i + 4));
    return chunks.join(' ');
  };

  return (
    <div className="space-y-4">
      <style>{`
        @keyframes modalFadeIn {
          from { opacity: 0; backdrop-filter: blur(0px); -webkit-backdrop-filter: blur(0px); }
          to { opacity: 1; backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.9) translateY(20px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes sparkle {
          0% { transform: translate(0, 0) scale(1) rotate(0deg); opacity: 1; }
          100% { transform: translate(var(--dx), var(--dy)) scale(0) rotate(180deg); opacity: 0; }
        }
        .animate-modalFadeIn {
          animation: modalFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .animate-scaleIn {
          animation: scaleIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        .animate-sparkle {
          animation: sparkle 0.8s cubic-bezier(0.25, 1, 0.5, 1) forwards;
        }
      `}</style>

      {/* Top Header Row */}
      <div className="flex items-center justify-between px-1 mb-4">
        <button type="button" onClick={() => setActiveTab('profile')}
          className="h-10 w-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/80 active:scale-95 transition">
          <Menu size={20} />
        </button>
        <button type="button" onClick={() => setActiveTab('profile')}
          className="relative h-10 w-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white font-black active:scale-95 transition">
          {customer.name ? customer.name.charAt(0).toUpperCase() : 'M'}
          {notifications.filter((n: any) => !n.is_read).length > 0 && (
            <span className="absolute top-0 right-0 h-2.5 w-2.5 rounded-full bg-[#F48C24] border-2 border-[#181412]" />
          )}
        </button>
      </div>

      {/* Hero Greeting Section */}
      <div className="px-1 mb-6 animate-fadeInUp">
        <p className="text-[12px] text-white/50 font-bold uppercase tracking-wider">
          {tx(safeLang, `Salam, ${customer.name || 'Qonaq'} 👋`, `Привет, ${customer.name || 'Гость'} 👋`, `Hi, ${customer.name || 'Guest'} 👋`)}
        </p>
        <h1 className="mt-1 text-3xl font-black leading-tight text-white tracking-tight">
          {tx(safeLang, 'Yaxşı Qəhvə,', 'Хороший Кофе,', 'Good Coffee,')}<br />
          {tx(safeLang, 'Yaxşı Əhval!', 'Хорошее Настроение!', 'Good ')}
          <span className="text-[#F48C24]">{tx(safeLang, '', '', 'Mood!')}</span>
        </h1>
      </div>

      {/* Search & Filter Bar */}
      <div className="px-1 mb-6 flex gap-3 animate-fadeInUp animate-fadeInUp-delay-1">
        <div className="relative flex-1">
          <input type="text" readOnly
            placeholder={tx(safeLang, 'Sevdiyiniz dadları axtarın...', 'Найдите ваш любимый вкус...', 'Search your favorite coffee...')}
            className="w-full rounded-full bg-white/5 border border-white/10 px-10 py-3 text-xs text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-[#F48C24] transition duration-200 cursor-pointer"
            onClick={() => setActiveTab('order')} />
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
        </div>
        <button type="button" onClick={() => setActiveTab('order')}
          className="h-10 w-10 rounded-full bg-[#F48C24] flex items-center justify-center text-white shadow-[0_4px_12px_rgba(244,140,36,0.25)] active:scale-95 transition">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
          </svg>
        </button>
      </div>

      {/* Geofence Alert Banner */}
      {geofenceAlert && (
        <div className="flex items-center justify-between gap-3 rounded-2xl p-4 animate-pulse"
          style={{ background: 'linear-gradient(135deg, rgba(250,204,21,0.15) 0%, rgba(34,211,238,0.15) 100%)', border: '1px solid rgba(250,204,21,0.3)', backdropFilter: 'blur(12px)' }}>
          <div className="flex gap-3">
            <span className="text-2xl">☕</span>
            <div>
              <h4 className="text-[13px] font-black text-yellow-400">{tx(safeLang, 'iRonWaves-ə yaxınsan!', 'Рядом с iRonWaves!', 'Near iRonWaves!')}</h4>
              <p className="mt-0.5 text-[11px] text-slate-200">{tx(safeLang, 'İçəri keç, ulduzlarını qəhvəyə çevir! 🌟', 'Заходи, преврати свои звезды в кофе! 🌟', 'Come in and turn your stars into coffee! 🌟')}</p>
            </div>
          </div>
          <button onClick={() => setGeofenceAlert(false)} className="text-[14px] font-bold text-white/60 hover:text-white px-2 py-1">✕</button>
        </div>
      )}

      {/* Premium Digital Membership Card */}
      <div onClick={async (e) => { spawnParticles(e); playTickSound(); setCardFlipped(!cardFlipped); await nativeHapticImpact(ImpactStyle.Light); }}
        className="animate-scaleSpring perspective-1000 w-full h-[220px] select-none cursor-pointer">
        <div className={`relative w-full h-full duration-700 preserve-3d transition-transform ${cardFlipped ? 'rotate-y-180' : ''}`}>
          {/* CARD FRONT */}
          <div className="absolute inset-0 backface-hidden border p-6 flex flex-col justify-between overflow-hidden shadow-[0_16px_36px_rgba(26,67,41,0.18)]"
            style={{ borderRadius: '28px', borderColor: 'rgba(26, 67, 41, 0.1)',
              background: heroImage ? `linear-gradient(180deg, rgba(26, 67, 41, 0.2), rgba(26, 67, 41, 0.8)), url(${heroImage}) center/cover` : `linear-gradient(135deg, ${accentColor} 0%, ${primaryColor} 100%)` }}>
            <div className="absolute inset-0 w-[200%] h-full bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-[1500ms] ease-out pointer-events-none" />
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
                  <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/80">{branding.app_name || 'Emalatkhana'}</p>
                </div>
                <h1 className="mt-2 text-2xl font-black text-white tracking-tight">{branding.hero_title || tx(safeLang, 'Xoş gəldiniz', 'Добро пожаловать', 'Welcome')}</h1>
              </div>
              {branding.logo_url ? (
                <img src={branding.logo_url} alt="brand" className="h-11 w-11 rounded-xl object-cover shadow-2xl border border-white/20" />
              ) : (
                <div className="h-11 w-11 rounded-xl bg-white/10 flex items-center justify-center border border-white/20 text-xl">☕</div>
              )}
            </div>
            <div className="flex items-center justify-between mt-4">
              <div className="relative w-10 h-7 rounded-md bg-gradient-to-br from-amber-200 via-yellow-400 to-amber-300 border border-amber-500/20 shadow-inner overflow-hidden flex flex-col justify-between p-1 opacity-85">
                <div className="flex justify-between h-px bg-slate-950/20 mt-1" />
                <div className="flex justify-between h-px bg-slate-950/20" />
                <div className="flex justify-between h-px bg-slate-950/20 mb-1" />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-950/20" />
              </div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-white/70 flex items-center gap-1 bg-black/20 rounded-full px-2.5 py-1 border border-white/5 backdrop-blur-sm animate-pulse">
                <span>✨</span>
                <span>{tx(safeLang, 'Skan üçün toxun', 'Коснитесь для скана', 'Tap to Scan')}</span>
              </div>
              <div className="text-white/40">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M4 12c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4-4-1.79-4-4zm11-6.5c0-.83.67-1.5 1.5-1.5C20.09 4 24 7.91 24 12.5S20.09 21 16.5 21c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5c2.48 0 4.5-2.02 4.5-4.5S18.98 9 16.5 9c-.83 0-1.5-.67-1.5-1.5zm-5-3C10.5 2.17 11.17 1.5 12 1.5C17.79 1.5 22.5 6.21 22.5 12S17.79 22.5 12 22.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5c4.14 0 7.5-3.36 7.5-7.5s-3.36-7.5-7.5-7.5c-.83 0-1.5-.67-1.5-1.5z" />
                </svg>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between text-white/60 text-[10px] font-mono tracking-[0.2em]">
              <span>{formatCardIdFn(customer.card_id)}</span>
              <span className="text-[9px] opacity-75">{tx(safeLang, 'MÜŞTƏRİ', 'КЛИЕНТ', 'CUSTOMER')}</span>
            </div>
          </div>

          {/* CARD BACK */}
          <div className="absolute inset-0 backface-hidden rotate-y-180 border p-6 flex flex-col items-center justify-center bg-white/10 backdrop-blur-xl shadow-2xl text-white"
            style={{ borderRadius: '28px', borderColor: 'rgba(255, 255, 255, 0.15)' }}>
            {cardQr ? (
              <div className="rounded-2xl bg-white p-2.5 shadow-md border border-slate-100">
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
        <section className="rounded-[28px] border p-6 shadow-2xl space-y-5 bg-white/5 backdrop-blur-xl text-white" style={{ borderColor: 'rgba(255, 255, 255, 0.1)' }}>
          <div>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/50">{wallet.points_label || 'Ulduz'}</p>
                <p className="mt-1 text-3xl font-black text-white tracking-tight animate-countReveal">
                  <AnimatedCounter value={Number(wallet.stars_balance ?? 0)} decimals={programMode === 'cashback' ? 2 : 0} suffix={balanceSuffix} />
                </p>
              </div>
              <div className="text-right">
                <span className="inline-block rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[10px] font-bold tracking-wider text-white uppercase">
                  {programMode === 'cashback' ? `${Number(wallet.cashback_percent || 0).toFixed(0)}% cashback` : (customer.type || 'Member')}
                </span>
              </div>
            </div>

            {programMode === 'points' ? (
              <div className="border-t border-white/10 pt-4">
                <div className="flex items-center gap-5">
                  <div className="relative select-none flex-shrink-0 flex items-center justify-center">
                    <svg viewBox="0 0 100 110" className="w-16 h-18 overflow-visible">
                      <defs>
                        <linearGradient id="coffeeLiquidGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stopColor="#ffb366" />
                          <stop offset="40%" stopColor="#F48C24" />
                          <stop offset="100%" stopColor="#b35900" />
                        </linearGradient>
                        <clipPath id="cupInterior"><path d="M20 18 L80 18 L73 85 C72 93, 28 93, 27 85 Z" /></clipPath>
                      </defs>
                      <path d="M40 10 Q43 4, 40 -2" fill="none" stroke="rgba(244,140,36,0.35)" strokeWidth="1.5" strokeLinecap="round" className="animate-pulse" />
                      <path d="M50 12 Q53 6, 50 0" fill="none" stroke="rgba(244,140,36,0.45)" strokeWidth="1.5" strokeLinecap="round" className="animate-pulse" />
                      <path d="M60 10 Q63 4, 60 -2" fill="none" stroke="rgba(244,140,36,0.35)" strokeWidth="1.5" strokeLinecap="round" className="animate-pulse" />
                      <path d="M76 35 C90 35, 90 65, 76 65" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="4.5" strokeLinecap="round" />
                      <path d="M20 18 L80 18 L73 85 C72 93, 28 93, 27 85 Z" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.2)" strokeWidth="2.5" />
                      <g clipPath="url(#cupInterior)">
                        <path d="M -100 120 L -100 45 Q -75 40, -50 45 T 0 45 T 50 45 T 100 45 T 150 45 T 200 45 L 200 120 Z"
                          fill="url(#coffeeLiquidGrad)" className="animate-wave"
                          style={{ transform: `translateY(${Math.max(0, 100 - progressPercent)}%)`, transition: 'transform 1.5s cubic-bezier(0.4, 0, 0.2, 1)' }} />
                      </g>
                    </svg>
                    <div className="absolute -top-1.5 -right-1 bg-[#F48C24] text-white font-black text-[9px] h-4.5 w-4.5 rounded-full flex items-center justify-center border border-white shadow-lg animate-bounce">★</div>
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="text-[11px] font-bold text-white">
                      {tx(safeLang, `${Number(wallet.stars_balance ?? 0)} / ${Number(wallet.next_reward_at || 10)} ulduz topladınız`,
                        `Вы собрали ${Number(wallet.stars_balance ?? 0)} / ${Number(wallet.next_reward_at || 10)} звезд`,
                        `Collected ${Number(wallet.stars_balance ?? 0)} / ${Number(wallet.next_reward_at || 10)} stars`)}
                    </div>
                    <div className="space-y-1">
                      {[
                        { stars: Math.round(Number(wallet.next_reward_at || 10) * 0.3), label: tx(safeLang, 'Çay / Espresso', 'Чай / Эспрессо', 'Tea / Espresso') },
                        { stars: Math.round(Number(wallet.next_reward_at || 10) * 0.6), label: tx(safeLang, 'Cappuccino / Latte', 'Капучино / Латте', 'Cappuccino / Latte') },
                        { stars: Number(wallet.next_reward_at || 10), label: tx(safeLang, 'Böyük Qəhvə + Desert', 'Большой Кофе + Десерт', 'Large Coffee + Pastry') }
                      ].map((m, mIdx) => {
                        const isUnlocked = Number(wallet.stars_balance ?? 0) >= m.stars;
                        return (
                          <div key={mIdx} className="flex items-center gap-2 text-[10px]">
                            <span className={`h-2 w-2 rounded-full ${isUnlocked ? 'bg-[#F48C24] shadow-[0_0_6px_rgba(244,140,36,0.8)]' : 'bg-white/10'}`} />
                            <span className={isUnlocked ? 'text-white font-black' : 'text-white/40 font-semibold'}>{m.stars}★ · {m.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="border-t border-white/10 pt-3">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#F48C24] to-[#ffb366] transition-all duration-500" style={{ width: `${progressPercent}%` }} />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-white/40">
                  <span>{tx(safeLang, 'Növbəti reward', 'Следующая награда', 'Next reward')}</span>
                  <span className="font-bold text-white/80">{wallet.reward_name || 'Reward'} ({progressPercent}%)</span>
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-white/10 flex flex-row gap-2 justify-center items-center">
              <a href={get_customer_wallet_pass_url_fn(sessionCreds.cardId, sessionCreds.token, safeLang)} target="_blank" rel="noopener noreferrer"
                onClick={(e) => openWalletPass(e, get_customer_wallet_pass_url_fn(sessionCreds.cardId, sessionCreds.token, safeLang))}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-black/80 hover:bg-black/90 py-2 border border-white/10 hover:border-white/20 transition text-[10px] font-semibold text-white active:scale-95">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.75.8-.01 1.99-.79 3.61-.63 1.68.07 2.92.74 3.69 1.95-3.41 2.03-2.87 6.99.78 8.44-.8 2.05-1.74 4.02-3.16 5.46zM15.42 4.38c.75-.92 1.25-2.2 1.11-3.49-1.11.05-2.46.75-3.26 1.69-.69.8-1.3 2.1-1.13 3.37 1.23.1 2.5-.62 3.28-1.57z" />
                </svg>
                Apple Wallet
              </a>
              <a href={get_customer_wallet_pass_url_fn(sessionCreds.cardId, sessionCreds.token, safeLang)} target="_blank" rel="noopener noreferrer"
                onClick={(e) => openWalletPass(e, get_customer_wallet_pass_url_fn(sessionCreds.cardId, sessionCreds.token, safeLang))}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-black/80 hover:bg-black/90 py-2 border border-white/10 hover:border-white/20 transition text-[10px] font-semibold text-white active:scale-95">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M21.35 11.1h-9.17v2.73h6.51c-.33 1.56-1.56 2.95-3.24 3.51v2.9h5.24c3.07-2.83 4.83-7 4.83-11.64c0-.52-.05-1.04-.17-1.5zM12.18 21c2.43 0 4.47-.8 5.96-2.18l-5.24-2.9c-1.46.99-3.29 1.56-5.96 1.56-4.59 0-8.48-3.11-9.86-7.3H1.66v3.01C4.46 18.77 8.08 21 12.18 21z" />
                </svg>
                Google Wallet
              </a>
            </div>

            <div className="mt-5 flex items-center justify-between text-white/40 text-[11px] font-mono tracking-[0.2em] border-t border-white/10 pt-3">
              <span>{formatCardIdFn(customer.card_id)}</span>
              <span className="text-[10px] opacity-75">{tx(safeLang, 'LOYALLIQ', 'ЛОЯЛЬНОСТЬ', 'LOYALTY')}</span>
            </div>
          </div>
        </section>
      )}

      {/* Promo Banner */}
      <section className="relative overflow-hidden rounded-[28px] p-5 text-white animate-fadeInUp animate-fadeInUp-delay-2 shadow-[0_12px_36px_rgba(26,67,41,0.04)] bg-gradient-to-r from-[#1A4329] to-[#2E5E3D] border border-white/5">
        <div className="absolute right-0 bottom-0 top-0 w-1/3 opacity-30 pointer-events-none select-none">
          <div className="absolute -right-4 -bottom-4 w-28 h-28 rounded-full bg-[#F48C24] blur-lg" />
          <div className="absolute right-4 top-2 w-16 h-16 rounded-full bg-white blur-md" />
        </div>
        <div className="relative z-10 max-w-[70%] space-y-3.5">
          <div>
            <h4 className="text-sm font-black tracking-tight leading-snug">{tx(safeLang, 'Hər gün təzə dəmlənmiş premium qəhvə', 'Свежесваренный премиум кофе каждый день', 'Freshly brewed premium coffee everyday')}</h4>
            <p className="mt-1 text-[9px] text-white/70 font-semibold uppercase tracking-wider">{tx(safeLang, 'İndi sifariş et, növbəni keç!', 'Закажи сейчас, пропусти очередь!', 'Order now, skip the line!')}</p>
          </div>
          <button onClick={() => setActiveTab('order')}
            className="rounded-full bg-white hover:bg-slate-100 text-[#1A4329] font-black text-[9px] px-3.5 py-1.5 uppercase tracking-wider transition active:scale-95 shadow-sm">
            {tx(safeLang, 'Sifariş Et', 'Заказать', 'Order Now')}
          </button>
        </div>
      </section>

      {/* Rewards + QR grid */}
      <div className="grid grid-cols-2 gap-3.5 animate-fadeInUp animate-fadeInUp-delay-3">
        <section className="rounded-[28px] p-5 flex flex-col justify-between border border-white/10 shadow-2xl bg-white/5 backdrop-blur-xl text-white">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/50">
              <Gift size={14} className="text-[#F48C24] animate-bounce" />
              {tx(safeLang, 'Hədiyyələr', 'Награды', 'Rewards')}
            </div>
            <div className="mt-3 text-4xl font-black text-white tracking-tight">{wallet.available_rewards ?? 0}</div>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">{wallet.reward_label || 'Hədiyyə'}</p>
          </div>
          {rewards[0] && Number(wallet.available_rewards || 0) > 0 ? (
            <button type="button" disabled={claiming} onClick={(e) => { e.stopPropagation(); claimReward(); }}
              className="relative mt-4 w-full overflow-hidden rounded-xl py-2.5 text-[12px] font-black text-white transition-all active:scale-[0.97] disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)` }}>
              <span className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/15 to-transparent -translate-x-full hover:translate-x-full transition-transform duration-1000 ease-out" />
              {claiming ? '...' : tx(safeLang, 'Tətbiq et', 'Забрать', 'Claim')}
            </button>
          ) : null}
        </section>

        <section onClick={async () => { setCardFlipped(!cardFlipped); playTickSound(); await nativeHapticImpact(ImpactStyle.Medium); }}
          className="rounded-[28px] p-5 flex flex-col justify-between border border-white/10 shadow-2xl transition active:scale-[0.98] cursor-pointer bg-white/5 backdrop-blur-xl text-white">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/50">
            <QrCode size={14} className="text-[#F48C24]" />
            {tx(safeLang, 'QR Kart', 'QR карта', 'QR Card')}
          </div>
          {showQrCard && cardQr ? (
            <div className="mt-3 flex flex-col items-center">
              <div className="p-2 bg-white rounded-2xl border border-white/10 shadow-inner">
                <img src={cardQr} alt="qr" className="h-20 w-20 object-contain" />
              </div>
              <p className="mt-2 text-[9px] font-mono tracking-widest text-white/40">{customer.card_id}</p>
            </div>
          ) : (
            <p className="mt-4 text-xs font-mono tracking-widest text-white/60">{customer.card_id}</p>
          )}
        </section>
      </div>

      {/* Smart Recommendations */}
      <section className="rounded-[28px] p-5 border border-white/10 shadow-2xl bg-white/5 backdrop-blur-xl text-white space-y-4 animate-fadeInUp animate-fadeInUp-delay-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🌦️</span>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-white/80">{tx(safeLang, 'Ağıllı Təkliflərimiz', 'Умные Рекомендации', 'Smart Recommendations')}</p>
              <p className="text-[10px] text-white/50 font-mono mt-0.5">{simulatedTemp}°C • {simulatedCondition === 'sunny' ? tx(safeLang, 'Günəşli', 'Солнечно', 'Sunny') : tx(safeLang, 'Yağışlı', 'Дождливо', 'Rainy')}</p>
            </div>
          </div>
          <button type="button" onClick={async () => { await nativeHapticImpact(ImpactStyle.Light); setSimulatedTemp(t => t > 20 ? 14 : 26); setSimulatedCondition(c => c === 'sunny' ? 'rainy' : 'sunny'); }}
            className="rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[9px] font-bold text-white hover:bg-white/10 active:scale-95 transition">
            🔄 {tx(safeLang, 'Havanı Dəyiş', 'Сменить погоду', 'Toggle Weather')}
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] text-white/70 font-semibold">{getWeatherInfo(safeLang, simulatedTemp).weatherDesc}</p>
          <div className="grid grid-cols-2 gap-2">
            {getWeatherInfo(safeLang, simulatedTemp).recommendedDrinks.map((drink, idx) => (
              <div key={idx} onClick={async () => { setCardFlipped(!cardFlipped); playTickSound(); await nativeHapticImpact(ImpactStyle.Light); }}
                className="flex items-center gap-2.5 p-3 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition cursor-pointer active:scale-95">
                <span className="text-xl">{drink.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-white truncate">{drink.name}</p>
                  <span className="inline-block px-1.5 py-0.5 mt-0.5 rounded-md bg-[#F48C24]/10 text-[#F48C24] text-[8px] font-black uppercase tracking-wider">{drink.tag}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-3 border-t border-white/10">
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-2">{getWeatherInfo(safeLang, simulatedTemp).comboTitle}</p>
          {getWeatherInfo(safeLang, simulatedTemp).comboItems.map((combo, idx) => (
            <div key={idx} onClick={async () => { setCardFlipped(!cardFlipped); playTickSound(); await nativeHapticImpact(ImpactStyle.Light); }}
              className="flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-r from-[#F48C24]/10 to-[#ffb366]/5 border border-white/10 hover:from-[#F48C24]/15 hover:to-[#ffb366]/10 hover:border-white/20 transition cursor-pointer active:scale-[0.98]">
              <span className="text-2xl">{combo.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-black text-[#F48C24]">{combo.name}</p>
                <p className="text-[9px] text-white/60 font-semibold mt-0.5">{combo.desc}</p>
              </div>
              <span className="text-[10px] font-extrabold text-[#F48C24] bg-[#F48C24]/10 px-2 py-0.5 rounded-full">Combo</span>
            </div>
          ))}
        </div>
      </section>

      {/* Your Favorites */}
      {favoriteItems.length > 0 && (
        <section className="rounded-[28px] p-5 border border-white/10 shadow-2xl bg-white/5 backdrop-blur-xl text-white animate-fadeInUp animate-fadeInUp-delay-5">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={14} className="text-[#F48C24]" />
            <p className="text-xs font-bold uppercase tracking-wider text-white/70">{tx(safeLang, 'Sizin Sevimliləriniz', 'Ваше любимое', 'Your Favorites')}</p>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {favoriteItems.map((item: any) => (
              <div key={item.name} onClick={async () => { setCardFlipped(!cardFlipped); playTickSound(); await nativeHapticImpact(ImpactStyle.Light); }}
                className="flex items-center gap-3 shrink-0 rounded-2xl p-3 border border-white/5 bg-white/5 active:scale-95 transition-transform cursor-pointer hover:border-white/10 text-white"
                style={{ minWidth: '160px' }}>
                <div className="h-10 w-10 rounded-xl bg-white/10 flex items-center justify-center text-lg border border-white/5">
                  {(() => { switch(item.category) { case 'coffee': return '☕'; case 'tea': return '🍵'; case 'sweet': return '🍰'; case 'food': return '🥪'; default: return '🥤'; } })()}
                </div>
                <div className="overflow-hidden">
                  <p className="text-[12px] font-bold text-white truncate w-24">{item.name}</p>
                  <p className="text-[9px] text-white/40 mt-0.5 font-semibold">{item.count} {tx(safeLang, 'dəfə', 'раз', 'times')}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Active Codes */}
      <section className="rounded-[28px] p-5 border border-white/10 shadow-2xl bg-white/5 backdrop-blur-xl text-white animate-fadeInUp animate-fadeInUp-delay-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-[#F48C24] animate-pulse" />
            <p className="text-xs font-bold uppercase tracking-wider text-white/70">{tx(safeLang, 'Aktiv Kodlar', 'Коды наград', 'Active Codes')}</p>
          </div>
          <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-[#F48C24]/10 text-[#F48C24]">{pendingClaims.length}</span>
        </div>
        <div className="mt-4 flex gap-3.5 overflow-x-auto pb-1.5">
          {pendingClaims.length === 0 ? (
            <div className="w-full rounded-2xl py-6 text-center text-xs text-white/30 border border-dashed border-white/10 bg-white/5">
              {tx(safeLang, 'Hələ aktiv kodunuz yoxdur', 'Нет активных кодов', 'No active codes yet')}
            </div>
          ) : pendingClaims.map((row: any) => (
            <div key={row.id} className="relative min-w-[170px] shrink-0 rounded-2xl p-4 overflow-hidden border border-[#F48C24]/30 shadow-inner flex flex-col justify-between"
              style={{ background: 'linear-gradient(135deg, rgba(244,140,36,0.1) 0%, rgba(244,140,36,0.05) 100%)' }}>
              <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[#0E0C0B] border-r border-[#F48C24]/20" />
              <div className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-[#0E0C0B] border-l border-[#F48C24]/20" />
              <div>
                <p className="text-[8px] font-black uppercase tracking-[0.25em] text-[#F48C24]">{tx(safeLang, 'Kassaya Təqdim Et', 'На кассе', 'Present at POS')}</p>
                <p className="mt-1.5 text-2xl font-black text-white tracking-tight font-mono">{row.claim_code}</p>
              </div>
              <div className="mt-3 pt-2 border-t border-white/10 text-[10px] text-white/60 truncate font-semibold">{row.reward_name}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

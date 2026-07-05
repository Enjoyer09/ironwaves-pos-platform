import React, { useState } from 'react';
import { useAppStore } from '../store';
import { i18n, tx } from '../i18n';
import { Delete, Maximize2, Minimize2 } from 'lucide-react';
import { getDeviceHash, getPublicIp, LoginRiskContext } from '../lib/risk';
import { get_business_profile, get_public_branding_live, get_settings_live } from '../api/settings';
import { getResolvedTenantIdFromHost } from '../lib/tenant';
import { authApi } from '../api/auth';
import { getApiBaseUrl } from '../api/client';

export default function PinLogin() {
  const { login, adminLogin, bootstrapPlatformOwner, lang, setLang, adminNeeds2FA, authErrorMessage, clearAuthError } = useAppStore();
  const safeLang = (lang === 'az' || lang === 'ru' || lang === 'en') ? lang : 'az';
  const t = i18n[safeLang];
  const [pin, setPin] = useState('');
  const [mode, setMode] = useState<'staff' | 'admin'>('staff');
  const [adminUser, setAdminUser] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [admin2faPin, setAdmin2faPin] = useState('');
  const [rememberDevice, setRememberDevice] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState(false);
  const [riskContext, setRiskContext] = useState<LoginRiskContext>({ device_hash: getDeviceHash(), ip: 'ip_unknown' });
  const isDemoHost = typeof window !== 'undefined' && window.location.host.toLowerCase() === 'demo.ironwaves.store';
  const isPlatformHost = typeof window !== 'undefined' && window.location.host.toLowerCase() === 'super.ironwaves.store';
  const tenantId = getResolvedTenantIdFromHost() || '';
  const [branding, setBranding] = useState(() => (tenantId ? get_business_profile(tenantId) : null));
  const [tenantAccessState, setTenantAccessState] = useState<'ok' | 'not_found' | 'suspended'>('ok');
  const [ownerBootstrapAvailable, setOwnerBootstrapAvailable] = useState(false);
  const [ownerUser, setOwnerUser] = useState('owner');
  const [ownerPass, setOwnerPass] = useState('');
  const [ownerPassConfirm, setOwnerPassConfirm] = useState('');
  const [staffPinLength, setStaffPinLength] = useState<4 | 6>(4);
  const [isBrandingLoading, setIsBrandingLoading] = useState(() => {
    // If we already have cached branding with a company name, skip the loading state
    const cached = tenantId ? get_business_profile(tenantId) : null;
    return !(cached && cached.company_name && cached.company_name !== 'iRonWaves POS');
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(true);

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const hasSupport = root.requestFullscreen || (root as any).webkitRequestFullscreen || (root as any).msRequestFullscreen;
    setFullscreenSupported(Boolean(hasSupport));

    const syncFullscreen = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        const root = document.documentElement;
        if (root.requestFullscreen) {
          await root.requestFullscreen();
        } else if ((root as any).webkitRequestFullscreen) {
          await (root as any).webkitRequestFullscreen();
        } else if ((root as any).msRequestFullscreen) {
          await (root as any).msRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        } else if ((document as any).msExitFullscreen) {
          await (document as any).msExitFullscreen();
        }
      }
    } catch (err) {
      console.warn('Failed to toggle fullscreen:', err);
    }
  };

  React.useEffect(() => {
    let mounted = true;
    getPublicIp().then((ip) => {
      if (mounted) setRiskContext({ device_hash: getDeviceHash(), ip });
    });
    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    if (!isDemoHost) return;
    const recordDemoPageview = async () => {
      try {
        const base = getApiBaseUrl() || '';
        await fetch(`${base}/api/v1/ops/public/landing/pageview`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-tenant-domain': window.location.host,
          },
          body: JSON.stringify({
            referrer: document.referrer || '',
            path: '/demo',
          }),
        });
      } catch (err) {
        console.warn('Failed to record demo pageview:', err);
      }
    };
    void recordDemoPageview();
  }, [isDemoHost]);

  React.useEffect(() => {
    let mounted = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const cached = tenantId ? get_business_profile(tenantId) : null;
    setBranding(cached || null);
    setTenantAccessState('ok');
    // If cached branding is valid (not default), show it instantly
    if (cached && cached.company_name && cached.company_name !== 'iRonWaves POS') {
      setIsBrandingLoading(false);
    } else {
      setIsBrandingLoading(true);
    }

    const fetchBranding = (attempt = 0) => {
      get_public_branding_live(tenantId || undefined)
        .then((data) => {
          if (mounted && data) {
            setBranding(data);
            setTenantAccessState('ok');
            setIsBrandingLoading(false);
          }
        })
        .catch((error) => {
          if (!mounted) return;
          const message = error instanceof Error ? error.message : String(error || '');
          if (message.includes('Tenant not configured for this domain')) {
            // Backend cold start may cause false "not configured" — retry once after delay
            if (attempt < 2) {
              retryTimer = setTimeout(() => fetchBranding(attempt + 1), attempt === 0 ? 2000 : 4000);
              return;
            }
            setTenantAccessState('not_found');
            setIsBrandingLoading(false);
            return;
          }
          if (message.includes('Tenant is suspended')) {
            setTenantAccessState('suspended');
            setIsBrandingLoading(false);
            return;
          }
          // Network error / timeout — retry
          if (attempt < 3) {
            retryTimer = setTimeout(() => fetchBranding(attempt + 1), attempt === 0 ? 1500 : 3000);
          } else {
            setIsBrandingLoading(false);
          }
        });
    };

    fetchBranding(0);
    return () => {
      mounted = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [tenantId]);

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    if (isBrandingLoading) return;
    const companyName = String(branding?.company_name || '').trim();
    document.title = companyName
      ? `${companyName}${/ironwaves/i.test(companyName) ? '' : ' by IronWaves'}`
      : 'iRonWaves POS';
  }, [branding?.company_name, isBrandingLoading]);

  React.useEffect(() => {
    const syncPinLength = () => {
      if (!tenantId) {
        setStaffPinLength(4);
        setPin((prev) => prev.slice(0, 4));
        return;
      }
      get_settings_live(tenantId)
        .then((settings) => {
          const next = Number(settings?.session_settings?.staff_pin_length || 4) === 4 ? 4 : 6;
          if (typeof document !== 'undefined') {
            document.documentElement.setAttribute('data-ui-mode', 'old');
          }
          window.dispatchEvent(new CustomEvent('settings-updated', { detail: { tenant_id: tenantId } }));
          setStaffPinLength(next);
          setPin((prev) => prev.slice(0, next));
        })
        .catch(() => {
          setStaffPinLength(4);
          setPin((prev) => prev.slice(0, 4));
        });
    };
    syncPinLength();
    window.addEventListener('settings-updated', syncPinLength as EventListener);
    return () => window.removeEventListener('settings-updated', syncPinLength as EventListener);
  }, [tenantId]);

  React.useEffect(() => {
    if (!isPlatformHost) return;
    let mounted = true;
    authApi.platform_owner_bootstrap_status()
      .then((res) => {
        if (mounted) setOwnerBootstrapAvailable(Boolean(res?.available));
      })
      .catch(() => {
        if (mounted) setOwnerBootstrapAvailable(false);
      });
    return () => {
      mounted = false;
    };
  }, [isPlatformHost]);

  const handleKeyPress = (num: string) => {
    if (isLoggingIn) return;
    if (pin.length < staffPinLength) {
      setPin(prev => prev + num);
      setError(false);
    }
  };

  const handleClear = () => {
    if (isLoggingIn) return;
    setPin('');
    setError(false);
  };

  React.useEffect(() => {
    if (mode === 'staff' && pin.length === staffPinLength) {
      (async () => {
        setIsLoggingIn(true);
        try {
          const success = await login(pin);
          if (!success) {
            setError(true);
            setTimeout(() => setPin(''), 500);
          }
        } finally {
          setIsLoggingIn(false);
        }
      })();
    }
  }, [pin, login, mode, staffPinLength]);

  const handleAdminSubmit = async () => {
    clearAuthError();
    const success = await adminLogin(adminUser, adminPass, admin2faPin, riskContext, rememberDevice);
    if (!success) {
      setError(true);
      if (!adminNeeds2FA) setAdmin2faPin('');
      setTimeout(() => setError(false), 1200);
    }
  };

  const handleAdminFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleAdminSubmit();
  };

  const handleOwnerBootstrap = async () => {
    clearAuthError();
    if (!ownerUser.trim() || ownerPass.length < 10) {
      return;
    }
    if (ownerPass !== ownerPassConfirm) {
      return;
    }
    const success = await bootstrapPlatformOwner(ownerUser.trim(), ownerPass);
    if (!success) {
      setError(true);
      setTimeout(() => setError(false), 1200);
      return;
    }
    setOwnerBootstrapAvailable(false);
  };

  const demoAccounts = [
    { label: 'Demo Admin', mode: 'admin' as const, username: 'demo_admin', password: 'Demo1234!!' },
    { label: 'Demo Manager', mode: 'admin' as const, username: 'demo_manager', password: 'Demo1234!!' },
    { label: 'Demo Staff PIN', mode: 'staff' as const, pin: '135790'.slice(0, staffPinLength) },
    { label: 'Demo Kitchen PIN', mode: 'staff' as const, pin: '246802'.slice(0, staffPinLength) },
  ];

  const applyDemoAccount = (account: (typeof demoAccounts)[number]) => {
    setError(false);
    clearAuthError();
    if (account.mode === 'staff') {
      setMode('staff');
      setPin(account.pin || '');
      return;
    }
    setMode('admin');
    setAdminUser(account.username || '');
    setAdminPass(account.password || '');
    setAdmin2faPin('');
  };

  const isStaffMode = mode === 'staff';
  const currentHost = typeof window !== 'undefined' ? window.location.host.toLowerCase() : '';
  const shouldShowTenantUnavailable =
    !isPlatformHost &&
    !isDemoHost &&
    currentHost !== 'localhost:5173' &&
    currentHost !== 'localhost' &&
    currentHost !== '127.0.0.1' &&
    tenantAccessState !== 'ok';

  if (shouldShowTenantUnavailable) {
    const isSuspended = tenantAccessState === 'suspended';
    return (
      <div className="metal-app relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-4 py-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_20%),linear-gradient(180deg,rgba(10,16,22,0.88),rgba(10,16,22,0.96))]" />
        <div className="relative w-full max-w-2xl rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,21,32,0.92),rgba(15,21,32,0.82))] p-7 shadow-[0_28px_90px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          <div className="mb-3 inline-flex rounded-full border border-amber-300/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
            iRonWaves POS
          </div>
          <h1 className="text-3xl font-black text-white">
            {isSuspended
              ? tx(safeLang, 'Bu tenant hazırda aktiv deyil', 'Этот tenant сейчас не активен', 'This tenant is currently inactive')
              : tx(safeLang, 'Bu ünvanda aktiv tenant tapılmadı', 'По этому адресу активный tenant не найден', 'No active tenant was found for this address')}
          </h1>
          <p className="mt-4 text-base leading-7 text-slate-300">
            {isSuspended
              ? tx(
                  safeLang,
                  'Bu obyekt üçün xidmət müvəqqəti deaktiv edilib. Yenidən aktivləşdirmə və giriş məlumatları üçün bizimlə əlaqə saxlayın.',
                  'Обслуживание этого объекта временно отключено. Свяжитесь с нами для повторной активации и получения доступа.',
                  'Service for this location is temporarily disabled. Contact us to reactivate it and restore access.',
                )
              : tx(
                  safeLang,
                  'Daxil etdiyiniz subdomain üzrə aktiv restoran workspace tapılmadı. Əgər bu ünvan sizə məxsusdursa, tenant qurulması və ya domen yönləndirilməsinin yoxlanması üçün bizimlə əlaqə saxlayın.',
                  'Для введенного субдомена не найден активный ресторанный workspace. Если этот адрес принадлежит вам, свяжитесь с нами для настройки tenant-а или проверки доменного маршрута.',
                  'No active restaurant workspace was found for this subdomain. If this address belongs to you, contact us to provision the tenant or review domain routing.',
                )}
          </p>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <a
              href="mailto:abbas@laptopmarket.az"
              className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-5 py-4 text-left text-cyan-50 transition hover:bg-cyan-400/15"
            >
              <div className="text-xs uppercase tracking-[0.18em] text-cyan-200/80">{tx(safeLang, 'E-poçt', 'E-mail', 'Email')}</div>
              <div className="mt-2 text-lg font-semibold">abbas@laptopmarket.az</div>
            </a>
            <a
              href="tel:+994552999282"
              className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 px-5 py-4 text-left text-emerald-50 transition hover:bg-emerald-400/15"
            >
              <div className="text-xs uppercase tracking-[0.18em] text-emerald-200/80">{tx(safeLang, 'Əlaqə nömrəsi', 'Контактный номер', 'Contact number')}</div>
              <div className="mt-2 text-lg font-semibold">+99455 299-92-82</div>
            </a>
          </div>
        </div>
      </div>
    );
  }

  const restaurantImage = branding?.login_background_url || branding?.background_image_url || branding?.hero_image_url || 'https://images.unsplash.com/photo-1554118811-1e0d58224f24?q=80&w=1600&auto=format&fit=crop';

  return (
    <div className="min-h-screen w-full bg-[#0b0f19] text-slate-100 font-sans md:h-screen md:overflow-hidden md:flex md:flex-row">
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
        .animate-shake {
          animation: shake 0.2s ease-in-out 3;
        }
      `}</style>
      
      {/* LEFT PANEL: Dynamic Restaurant Image (Hidden on mobile) */}
      <div 
        className="hidden md:flex md:flex-1 relative flex-col justify-between p-12 bg-slate-900 overflow-hidden"
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(10, 15, 26, 0.25) 0%, rgba(10, 15, 26, 0.85) 100%), url(${restaurantImage})`,
          backgroundPosition: 'center',
          backgroundSize: 'cover',
        }}
      >
        {/* Floating brand block */}
        <div className="relative z-10 flex items-center gap-3.5 bg-slate-950/40 border border-white/10 backdrop-blur-xl px-5 py-3 rounded-2xl w-fit">
          {isBrandingLoading ? (
            <>
              <div className="h-10 w-10 rounded-xl bg-slate-700/60 animate-pulse" />
              <div className="space-y-2">
                <div className="h-4 w-32 rounded-lg bg-slate-700/60 animate-pulse" />
                <div className="h-2.5 w-20 rounded-lg bg-slate-700/40 animate-pulse" />
              </div>
            </>
          ) : (
            <>
              {branding?.logo_url ? (
                <img src={branding.logo_url} alt="brand logo" className="h-10 w-10 rounded-xl object-cover shadow-lg" />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-400 text-base font-black text-slate-900 shadow-lg">
                  {(branding?.company_name || 'I').trim().slice(0, 1).toUpperCase()}
                </div>
              )}
              <div>
                <h2 className="text-base font-black tracking-wide text-white leading-none">{branding?.company_name || 'iRonWaves POS'}</h2>
                {branding?.website && <p className="text-[10px] text-white/50 mt-1">{branding.website}</p>}
              </div>
            </>
          )}
        </div>

        {/* Dynamic Welcome Card */}
        <div className="relative z-10 max-w-lg rounded-[28px] border border-white/10 bg-slate-950/50 p-6 backdrop-blur-xl space-y-2">
          <span className="inline-block rounded-full bg-yellow-400/20 border border-yellow-400/30 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-yellow-300">
            ⚡ iRonWaves POS System
          </span>
          <h1 className="text-3xl font-black text-white leading-tight">
            {tx(safeLang, 'Xoş Gəlmisiniz!', 'Добро пожаловать!', 'Welcome!')}
          </h1>
          <p className="text-xs text-slate-300 leading-relaxed">
            {tx(
              safeLang,
              'Zəhmət olmasa daxil olmaq üçün heyət PIN kodunuzu və ya admin hesabınızı istifadə edin.',
              'Пожалуйста, используйте PIN-код сотрудника или учетную запись администратора для входа.',
              'Please use your staff PIN or admin account credentials to sign in.'
            )}
          </p>
        </div>
      </div>

      {/* RIGHT PANEL: Login pad */}
      <div 
        className="w-full md:w-[440px] lg:w-[480px] shrink-0 h-screen overflow-y-auto relative flex flex-col justify-between px-6 py-8 bg-[#0a0e17] border-l border-white/[0.04] md:-ml-[88px] lg:-ml-[96px] shadow-[-15px_0_30px_rgba(0,0,0,0.5)] z-20"
      >
        {/* Fullscreen toggle button */}
        {fullscreenSupported && (
          <button
            type="button"
            onClick={toggleFullscreen}
            className="absolute top-4 right-4 z-50 p-2.5 rounded-xl border border-white/10 bg-slate-950/60 hover:bg-slate-900/60 text-slate-400 hover:text-white transition-all shadow-md active:scale-95"
            title={isFullscreen ? tx(safeLang, 'Tam ekrandan çıx', 'Выйти из полного экрана', 'Exit Fullscreen') : tx(safeLang, 'Tam ekran', 'Полный экран', 'Fullscreen')}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        )}
        {/* Mobile backdrop shadow/image blurred */}
        <div 
          className="absolute inset-0 z-0 opacity-15 blur-lg pointer-events-none md:hidden"
          style={{
            backgroundImage: `url(${restaurantImage})`,
            backgroundPosition: 'center',
            backgroundSize: 'cover',
          }}
        />

        <div className="relative z-10 w-full max-w-md mx-auto space-y-6 my-auto">
          
          {/* Mobile Header */}
          <div className="flex flex-col items-center gap-3 text-center md:hidden mb-2">
            {isBrandingLoading ? (
              <>
                <div className="h-12 w-12 rounded-xl bg-slate-700/60 animate-pulse" />
                <div className="h-6 w-40 rounded-lg bg-slate-700/60 animate-pulse" />
              </>
            ) : (
              <>
                {branding?.logo_url ? (
                  <img src={branding.logo_url} alt="brand logo" className="h-12 w-12 rounded-xl object-cover shadow-lg" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-yellow-400 text-lg font-black text-slate-900 shadow-lg">
                    {(branding?.company_name || 'I').trim().slice(0, 1).toUpperCase()}
                  </div>
                )}
                <h1 className="text-2xl font-black text-white">{branding?.company_name || 'iRonWaves POS'}</h1>
                {branding?.website && <p className="text-[10px] text-slate-400">{branding.website}</p>}
              </>
            )}
          </div>

          {/* Quick Demo Access banner (if demo host) */}
          {isDemoHost && (
            <div className="rounded-[24px] border border-cyan-500/20 bg-cyan-500/10 p-4 text-left">
              <div className="text-xs font-bold text-cyan-200">{tx(safeLang, 'Demo Giriş Hesabları', 'Демо-аккаунты', 'Demo Accounts')}</div>
              <div className="mt-2 space-y-2 max-h-40 overflow-y-auto pr-1">
                {demoAccounts.map((account) => (
                  <div key={account.label} className="flex justify-between items-center rounded-xl bg-slate-950/40 p-2 text-xs border border-white/5">
                    <div>
                      <span className="font-semibold text-white">{account.label}</span>
                      <span className="text-[10px] text-cyan-200/70 block font-mono">
                        {account.mode === 'staff' ? `PIN: ${account.pin}` : `U: ${account.username} | P: ${account.password}`}
                      </span>
                    </div>
                    <button
                      onClick={() => applyDemoAccount(account)}
                      className="rounded-lg bg-cyan-400/20 hover:bg-cyan-400/30 px-2 py-1 text-[10px] text-cyan-200 font-bold"
                    >
                      Fill
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Language selector & Mode selection card */}
          <div className="rounded-[24px] border border-white/10 bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                {tx(safeLang, 'Tətbiq dili', 'Язык приложения', 'Language')}
              </span>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as any)}
                className="neon-input text-xs min-h-8 w-24 py-1"
                style={{ borderRadius: '10px' }}
              >
                <option value="az">AZ</option>
                <option value="ru">RU</option>
                <option value="en">EN</option>
              </select>
            </div>
            
            <div className="flex gap-1.5 p-1 rounded-2xl bg-black/40 border border-white/5">
              <button 
                className={`flex-1 min-h-10 text-xs font-bold rounded-xl transition ${mode === 'staff' ? 'bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white'}`} 
                onClick={() => setMode('staff')}
              >
                {tx(safeLang, 'STAFF', 'ПЕРСОНАЛ', 'STAFF')}
              </button>
              <button 
                className={`flex-1 min-h-10 text-xs font-bold rounded-xl transition ${mode === 'admin' ? 'bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-950 shadow-md' : 'text-slate-400 hover:text-white'}`} 
                onClick={() => setMode('admin')}
              >
                {tx(safeLang, 'ADMIN', 'АДМИН', 'ADMIN')}
              </button>
            </div>
          </div>

          {/* PIN Pad or Admin login Form */}
          <div className="rounded-[28px] border border-white/10 bg-slate-900/50 p-6 space-y-5 shadow-xl">
            {mode === 'staff' ? (
              <>
                <div className="rounded-2xl border border-white/5 bg-black/40 px-5 py-4 text-center">
                  <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">PIN</div>
                  <div className="mt-1 min-h-10 text-3xl tracking-[0.5em] text-white font-extrabold flex items-center justify-center">
                    {pin ? '•'.repeat(pin.length) : Array.from({ length: staffPinLength }).map(() => '•').join(' ')}
                  </div>
                  <div className="mt-1.5 text-xs text-slate-400">{t.pin_prompt}</div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                    <button
                      key={num}
                      onClick={() => handleKeyPress(num.toString())}
                      disabled={isLoggingIn}
                      className="rounded-2xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.08] active:scale-95 py-5 text-2xl font-bold text-white transition shadow-sm"
                    >
                      {num}
                    </button>
                  ))}
                  <button
                    onClick={handleClear}
                    disabled={isLoggingIn}
                    className="rounded-2xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.08] active:scale-95 py-5 text-sm font-bold text-slate-400 transition"
                  >
                    CLR
                  </button>
                  <button
                    onClick={() => handleKeyPress('0')}
                    disabled={isLoggingIn}
                    className="rounded-2xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.08] active:scale-95 py-5 text-2xl font-bold text-white transition"
                  >
                    0
                  </button>
                  <button
                    onClick={() => setPin((prev) => prev.slice(0, -1))}
                    disabled={isLoggingIn}
                    className="flex items-center justify-center rounded-2xl border border-white/5 bg-white/[0.03] hover:bg-white/[0.08] active:scale-95 py-5 text-white transition"
                  >
                    <Delete size={20} />
                  </button>
                </div>
              </>
            ) : (
              <form className="space-y-3" onSubmit={handleAdminFormSubmit}>
                <input className="neon-input text-sm min-h-11" value={adminUser} onChange={(e) => setAdminUser(e.target.value)} placeholder={tx(safeLang, 'Admin istifadəçi adı', 'Имя администратора', 'Admin username')} />
                <input
                  className="neon-input text-sm min-h-11"
                  value={adminPass}
                  onChange={(e) => setAdminPass(e.target.value)}
                  placeholder={tx(safeLang, 'Şifrə', 'Пароль', 'Password')}
                  type="password"
                />
                {adminNeeds2FA && (
                  <>
                    <input
                      className="neon-input text-sm min-h-11"
                      value={admin2faPin}
                      onChange={(e) => setAdmin2faPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder={tx(safeLang, 'Google Authenticator kodu', 'Код Google Authenticator', 'Google Authenticator code')}
                      type="password"
                      inputMode="numeric"
                    />
                    <label className="flex items-center gap-2 rounded-2xl border border-slate-700/70 bg-slate-950/30 px-4 py-3 text-sm text-slate-300">
                      <input type="checkbox" checked={rememberDevice} onChange={(e) => setRememberDevice(e.target.checked)} />
                      <span>{tx(safeLang, 'Bu cihazı 30 gün xatırla', 'Запомнить это устройство на 30 дней', 'Remember this device for 30 days')}</span>
                    </label>
                  </>
                )}
                <button type="submit" className="hidden" aria-hidden="true" />
              </form>
            )}

            <button
              onClick={() => (mode === 'admin' ? handleAdminSubmit() : handleClear())}
              disabled={isLoggingIn}
              className={`w-full rounded-2xl py-3.5 text-sm font-extrabold transition-all active:scale-95 ${error ? 'bg-red-500 text-white animate-shake' : 'bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-900 shadow-md hover:shadow-lg'}`}
            >
              {mode === 'staff'
                ? (isLoggingIn ? tx(safeLang, 'Yoxlanılır...', 'Проверка...', 'Checking...') : tx(safeLang, 'PIN-i Sıfırla', 'Сбросить PIN', 'Reset PIN'))
                : t.login}
            </button>

            {authErrorMessage && (
              <p className="text-center text-xs text-red-400 mt-2 font-semibold bg-red-400/10 py-2 rounded-xl border border-red-500/10">
                {authErrorMessage}
              </p>
            )}
          </div>

          {/* Owner bootstrap widget */}
          {mode === 'admin' && isPlatformHost && ownerBootstrapAvailable && (
            <div className="rounded-[24px] border border-cyan-300/20 bg-cyan-400/10 p-4 text-left space-y-3">
              <div className="text-xs font-bold text-cyan-100">{tx(safeLang, 'Platform Owner Yaradın', 'Создать owner', 'Create Platform Owner')}</div>
              <input className="neon-input text-xs min-h-9" value={ownerUser} onChange={(e) => setOwnerUser(e.target.value)} placeholder="Username" />
              <input className="neon-input text-xs min-h-9" type="password" value={ownerPass} onChange={(e) => setOwnerPass(e.target.value)} placeholder="Password" />
              <input className="neon-input text-xs min-h-9" type="password" value={ownerPassConfirm} onChange={(e) => setOwnerPassConfirm(e.target.value)} placeholder="Confirm" />
              <button onClick={() => void handleOwnerBootstrap()} className="w-full bg-cyan-400 text-slate-950 font-bold rounded-xl py-2 text-xs">
                Create
              </button>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="relative z-10 text-center text-[10px] text-slate-600 mt-6 select-none font-bold">
          © {new Date().getFullYear()} iRonWaves POS • {tx(safeLang, 'Bütün hüquqlar qorunur', 'Все права защищены', 'All rights reserved')}
        </div>
      </div>
    </div>
  );
}

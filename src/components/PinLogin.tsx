import React, { useState } from 'react';
import { useAppStore } from '../store';
import { i18n, tx } from '../i18n';
import { Delete } from 'lucide-react';
import { getDeviceHash, getPublicIp, LoginRiskContext } from '../lib/risk';
import { get_business_profile, get_public_branding_live } from '../api/settings';
import { resolveTenantIdFromHost } from '../lib/tenant';
import { authApi } from '../api/auth';

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
  const [error, setError] = useState(false);
  const [riskContext, setRiskContext] = useState<LoginRiskContext>({ device_hash: getDeviceHash(), ip: 'ip_unknown' });
  const isDemoHost = typeof window !== 'undefined' && window.location.host.toLowerCase() === 'demo.ironwaves.store';
  const isPlatformHost = typeof window !== 'undefined' && window.location.host.toLowerCase() === 'super.ironwaves.store';
  const tenantId = resolveTenantIdFromHost();
  const [branding, setBranding] = useState(() => get_business_profile(tenantId));
  const [ownerBootstrapAvailable, setOwnerBootstrapAvailable] = useState(false);
  const [ownerUser, setOwnerUser] = useState('owner');
  const [ownerPass, setOwnerPass] = useState('');
  const [ownerPassConfirm, setOwnerPassConfirm] = useState('');

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
    let mounted = true;
    setBranding(get_business_profile(tenantId));
    get_public_branding_live(tenantId)
      .then((data) => {
        if (mounted && data) setBranding(data);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
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
    if (pin.length < 4) {
      setPin(prev => prev + num);
      setError(false);
    }
  };

  const handleClear = () => {
    setPin('');
    setError(false);
  };

  React.useEffect(() => {
    if (mode === 'staff' && pin.length === 4) {
      (async () => {
        const success = await login(pin);
        if (!success) {
          setError(true);
          setTimeout(() => setPin(''), 500);
        }
      })();
    }
  }, [pin, login, mode]);

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
    if (!ownerUser.trim() || ownerPass.length < 8) {
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
    { label: 'Demo Admin', mode: 'admin' as const, username: 'demo_admin', password: 'Demo1234!' },
    { label: 'Demo Manager', mode: 'admin' as const, username: 'demo_manager', password: 'Demo1234!' },
    { label: 'Demo Staff PIN', mode: 'staff' as const, pin: '1111' },
    { label: 'Demo Kitchen PIN', mode: 'staff' as const, pin: '2222' },
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

  return (
    <div className="metal-app relative flex h-[100dvh] overflow-y-auto px-4 py-8 md:items-center md:justify-center">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.12),transparent_18%),linear-gradient(135deg,rgba(248,199,0,0.16),transparent_24%,rgba(56,189,248,0.12)_70%,transparent_100%),linear-gradient(180deg,rgba(10,16,22,0.72),rgba(10,16,22,0.88))]" />
      <div className="absolute inset-0 opacity-[0.12]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.25) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />

      <div className="relative w-full max-w-5xl">
        <div className="mb-6 flex flex-col gap-3 text-center">
          <div className="mx-auto flex items-center justify-center gap-3">
            {branding?.logo_url ? (
              <img src={branding.logo_url} alt="brand logo" className="h-14 w-14 rounded-2xl object-cover shadow-[0_10px_28px_rgba(0,0,0,0.35)] md:h-16 md:w-16" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-yellow-400 text-xl font-black text-slate-900 shadow-[0_10px_28px_rgba(0,0,0,0.35)] md:h-16 md:w-16">
                {(branding?.company_name || 'I').trim().slice(0, 1).toUpperCase()}
              </div>
            )}
            <h1 className="text-4xl font-black tracking-wide text-white md:text-5xl">{branding?.company_name || 'iRonWaves POS RC'}</h1>
          </div>
        </div>

        {isDemoHost && (
          <div className="mx-auto mb-5 max-w-4xl rounded-[28px] border border-cyan-300/20 bg-cyan-400/10 p-5 text-slate-100 backdrop-blur-sm">
            <div className="mb-4">
              <div className="text-sm font-bold text-cyan-100">{tx(safeLang, 'Demo giriş hesabları', 'Демо-аккаунты для входа', 'Demo login accounts')}</div>
              <div className="mt-1 text-xs text-cyan-50/80">
                {tx(
                  safeLang,
                  'İstifadəçi adını, şifrəni və ya PIN-i birbaşa yazıb daxil ola bilərsiniz.',
                  'Вы можете напрямую ввести логин, пароль или PIN и войти.',
                  'You can type these usernames, passwords, or PINs directly and sign in.',
                )}
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {demoAccounts.map((account) => (
                <div key={account.label} className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 text-left">
                  <div className="font-semibold text-white">{account.label}</div>
                  {account.mode === 'staff' ? (
                    <div className="mt-3 space-y-1 text-sm">
                      <div className="text-slate-400">{tx(safeLang, 'PIN', 'PIN', 'PIN')}</div>
                      <div className="font-mono text-lg font-bold text-cyan-100">{account.pin}</div>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-2 text-sm">
                      <div>
                        <div className="text-slate-400">{tx(safeLang, 'İstifadəçi adı', 'Имя пользователя', 'Username')}</div>
                        <div className="font-mono text-cyan-100">{account.username}</div>
                      </div>
                      <div>
                        <div className="text-slate-400">{tx(safeLang, 'Şifrə', 'Пароль', 'Password')}</div>
                        <div className="font-mono text-cyan-100">{account.password}</div>
                      </div>
                    </div>
                  )}
                  <button
                    onClick={() => applyDemoAccount(account)}
                    className="neon-btn mt-4 min-h-11 w-full justify-center rounded-2xl px-4 py-2 text-sm"
                  >
                    {tx(safeLang, 'Bu hesabı doldur', 'Подставить этот аккаунт', 'Use this account')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mx-auto max-w-xl">
          <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.04))] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.42)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm text-slate-400">{branding?.website || (typeof window !== 'undefined' ? window.location.host : '')}</div>
              </div>
              <div className="w-24">
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value as any)}
                  className="neon-input min-h-11 text-sm"
                >
                  <option value="az">AZ</option>
                  <option value="ru">RU</option>
                  <option value="en">EN</option>
                </select>
              </div>
            </div>

            <div className="mt-4 text-center text-sm text-slate-300">{isStaffMode ? tx(safeLang, 'PIN login', 'PIN вход', 'PIN login') : tx(safeLang, 'User login', 'User login', 'User login')}</div>
          </div>

          <div className="mx-auto w-full max-w-xl rounded-[32px] border border-slate-500/30 bg-[linear-gradient(180deg,rgba(15,21,32,0.84),rgba(15,21,32,0.72))] p-6 shadow-[0_28px_90px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <div className="mb-5 flex gap-2">
              <button className={`neon-chip min-h-12 px-4 ${mode === 'staff' ? 'neon-chip-active' : ''}`} onClick={() => setMode('staff')}>{tx(safeLang, 'STAFF', 'ПЕРСОНАЛ')}</button>
              <button className={`neon-chip min-h-12 px-4 ${mode === 'admin' ? 'neon-chip-active' : ''}`} onClick={() => setMode('admin')}>{tx(safeLang, 'ADMIN / MANAGER', 'АДМИН / МЕНЕДЖЕР', 'ADMIN / MANAGER')}</button>
            </div>

            {mode === 'staff' ? (
              <>
                <div className="mb-5 rounded-[24px] border border-white/10 bg-[#0d1219]/90 px-4 py-4 text-center">
                  <div className="text-xs uppercase tracking-[0.22em] text-slate-500">PIN</div>
                  <div className="mt-2 min-h-10 text-3xl tracking-[0.6em] text-white">{pin ? '•'.repeat(pin.length) : '• • • •'}</div>
                  <div className="mt-2 text-xs text-slate-400">{t.pin_prompt}</div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                    <button
                      key={num}
                      onClick={() => handleKeyPress(num.toString())}
                      className="rounded-[26px] border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.04))] py-5 text-3xl font-bold text-white shadow-[0_10px_28px_rgba(0,0,0,0.35)] transition hover:scale-[1.02]"
                    >
                      {num}
                    </button>
                  ))}
                  <button
                    onClick={handleClear}
                    className="rounded-[26px] border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.04))] py-5 text-2xl font-bold text-white shadow-[0_10px_28px_rgba(0,0,0,0.35)] transition hover:scale-[1.02]"
                  >
                    C
                  </button>
                  <button
                    onClick={() => handleKeyPress('0')}
                    className="rounded-[26px] border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.04))] py-5 text-3xl font-bold text-white shadow-[0_10px_28px_rgba(0,0,0,0.35)] transition hover:scale-[1.02]"
                  >
                    0
                  </button>
                  <button
                    onClick={() => setPin((prev) => prev.slice(0, -1))}
                    className="flex items-center justify-center rounded-[26px] border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.04))] py-5 text-white shadow-[0_10px_28px_rgba(0,0,0,0.35)] transition hover:scale-[1.02]"
                  >
                    <Delete size={24} />
                  </button>
                </div>
              </>
            ) : (
              <form className="space-y-3" onSubmit={handleAdminFormSubmit}>
                <input className="neon-input min-h-13" value={adminUser} onChange={(e) => setAdminUser(e.target.value)} placeholder={tx(safeLang, 'Admin istifadəçi adı', 'Имя администратора', 'Admin username')} />
                <input
                  className="neon-input min-h-13"
                  value={adminPass}
                  onChange={(e) => setAdminPass(e.target.value)}
                  placeholder={tx(safeLang, 'Şifrə', 'Пароль', 'Password')}
                  type="password"
                />
                {adminNeeds2FA && (
                  <>
                    <input
                      className="neon-input min-h-13"
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
              onClick={() => mode === 'admin' && handleAdminSubmit()}
              className={`mt-5 w-full rounded-[24px] px-4 py-4 text-lg font-bold ${error ? 'bg-red-500 text-white' : 'glossy-gold'}`}
            >
              {mode === 'staff' ? tx(safeLang, 'PIN ilə Daxil Ol', 'Войти по PIN', 'Enter With PIN') : t.login}
            </button>

            <div className="mt-4 text-center text-xs text-slate-400">
              {authErrorMessage ? <p className="mt-2 text-red-300">{authErrorMessage}</p> : null}
            </div>

            {mode === 'admin' && isPlatformHost && ownerBootstrapAvailable && (
              <div className="mt-5 rounded-[24px] border border-cyan-300/20 bg-cyan-400/10 p-4 text-left">
                <div className="text-sm font-semibold text-cyan-100">{tx(safeLang, 'Platform Owner Yaradın', 'Создать platform owner', 'Create Platform Owner')}</div>
                <div className="mt-1 text-xs text-slate-300">
                  {tx(safeLang, 'Bu blok yalnız owner yoxdursa görünür və yalnız super domenində işləyir.', 'Этот блок виден только если owner еще не создан и работает только на super домене.', 'This block is only shown when no owner exists yet and only works on the platform domain.')}
                </div>
                <div className="mt-3 grid gap-3">
                  <input className="neon-input min-h-13" value={ownerUser} onChange={(e) => setOwnerUser(e.target.value)} placeholder={tx(safeLang, 'Owner username', 'Owner username', 'Owner username')} />
                  <input className="neon-input min-h-13" type="password" value={ownerPass} onChange={(e) => setOwnerPass(e.target.value)} placeholder={tx(safeLang, 'Güclü şifrə (min 8)', 'Надежный пароль (мин 8)', 'Strong password (min 8)')} />
                  <input className="neon-input min-h-13" type="password" value={ownerPassConfirm} onChange={(e) => setOwnerPassConfirm(e.target.value)} placeholder={tx(safeLang, 'Şifrə təkrarı', 'Повтор пароля', 'Confirm password')} />
                  <button onClick={() => void handleOwnerBootstrap()} className="neon-btn-active rounded-2xl px-4 py-3 font-semibold">
                    {tx(safeLang, 'Owner Yarat', 'Создать owner', 'Create Owner')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

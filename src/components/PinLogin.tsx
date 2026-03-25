import React, { useState } from 'react';
import { useAppStore } from '../store';
import { i18n, tx } from '../i18n';
import { Delete } from 'lucide-react';
import { getDeviceHash, getPublicIp, LoginRiskContext } from '../lib/risk';

export default function PinLogin() {
  const { login, adminLogin, lang, setLang, adminNeeds2FA, authErrorMessage, clearAuthError } = useAppStore();
  const safeLang = (lang === 'az' || lang === 'ru' || lang === 'en') ? lang : 'az';
  const t = i18n[safeLang];
  const [pin, setPin] = useState('');
  const [mode, setMode] = useState<'staff' | 'admin'>('staff');
  const [adminUser, setAdminUser] = useState('admin');
  const [adminPass, setAdminPass] = useState('');
  const [admin2faPin, setAdmin2faPin] = useState('');
  const [error, setError] = useState(false);
  const [riskContext, setRiskContext] = useState<LoginRiskContext>({ device_hash: getDeviceHash(), ip: 'ip_unknown' });

  React.useEffect(() => {
    let mounted = true;
    getPublicIp().then((ip) => {
      if (mounted) setRiskContext({ device_hash: getDeviceHash(), ip });
    });
    return () => {
      mounted = false;
    };
  }, []);

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
    const success = await adminLogin(adminUser, adminPass, admin2faPin, riskContext);
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

  return (
    <div className="metal-app flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl">
        <h1 className="mb-8 text-center text-5xl font-black tracking-wide text-slate-100">IRONWAVES POS</h1>
        <div className="mx-auto mb-4 max-w-md">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as any)}
            className="neon-input"
          >
            <option value="az">AZ</option>
            <option value="ru">RU</option>
            <option value="en">EN</option>
          </select>
        </div>

        <div className="mx-auto max-w-md rounded-2xl border border-slate-600/80 bg-slate-900/45 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.5)] backdrop-blur-sm">
          <div className="mb-5 flex gap-2">
              <button className={`neon-chip ${mode === 'staff' ? 'neon-chip-active' : ''}`} onClick={() => setMode('staff')}>{tx(safeLang, 'STAFF', 'ПЕРСОНАЛ')}</button>
              <button className={`neon-chip ${mode === 'admin' ? 'neon-chip-active' : ''}`} onClick={() => setMode('admin')}>ADMIN</button>
          </div>

          {mode === 'staff' ? (
            <>
              <div className="mb-5 rounded-xl border border-slate-700 bg-[#111720] px-4 py-3 text-center text-2xl tracking-[0.6em] text-slate-100">
                {pin ? '•'.repeat(pin.length) : t.pin_prompt}
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                  <button
                    key={num}
                    onClick={() => handleKeyPress(num.toString())}
                    className="metal-panel h-16 text-xl font-bold text-slate-100 transition hover:scale-[1.02]"
                  >
                    {num}
                  </button>
                ))}
                <button
                  onClick={handleClear}
                  className="metal-panel flex h-16 items-center justify-center text-slate-200 transition hover:scale-[1.02]"
                >
                  C
                </button>
                <button
                  onClick={() => handleKeyPress('0')}
                  className="metal-panel h-16 text-xl font-bold text-slate-100 transition hover:scale-[1.02]"
                >
                  0
                </button>
                <button
                  onClick={() => setPin((prev) => prev.slice(0, -1))}
                  className="metal-panel flex h-16 items-center justify-center text-slate-200 transition hover:scale-[1.02]"
                >
                  <Delete size={20} />
                </button>
              </div>
            </>
          ) : (
            <form className="space-y-3" onSubmit={handleAdminFormSubmit}>
              <input className="neon-input" value={adminUser} onChange={(e) => setAdminUser(e.target.value)} placeholder={tx(safeLang, 'Admin istifadəçi adı', 'Имя администратора')} />
              <input
                className="neon-input"
                value={adminPass}
                onChange={(e) => setAdminPass(e.target.value)}
                placeholder={tx(safeLang, 'Şifrə', 'Пароль')}
                type="password"
              />
              {adminNeeds2FA && (
                <input
                  className="neon-input"
                  value={admin2faPin}
                  onChange={(e) => setAdmin2faPin(e.target.value.replace(/\D/g, '').slice(0, 15))}
                  placeholder={tx(safeLang, '2FA PIN', '2FA PIN', '2FA PIN')}
                  type="password"
                  inputMode="numeric"
                />
              )}
              <button type="submit" className="hidden" aria-hidden="true" />
            </form>
          )}

            <button
            onClick={() => mode === 'admin' && handleAdminSubmit()}
            className={`mt-5 w-full rounded-xl px-4 py-3 text-lg font-bold ${error ? 'bg-red-500 text-white' : 'glossy-gold'}`}
          >
              {t.login}
          </button>

          <div className="mt-4 text-center text-xs text-slate-400">
            {authErrorMessage ? <p className="mt-2 text-red-300">{authErrorMessage}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

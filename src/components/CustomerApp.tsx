import React from 'react';
import { Bell, Gift, History, QrCode, Sparkles } from 'lucide-react';
import QRCode from 'qrcode';
import { tx } from '../i18n';
import { useAppStore } from '../store';
import { claim_customer_reward_live, get_customer_app_session_live, mark_customer_notification_read_live } from '../api/crm';

type Props = {
  cardId: string;
  token: string;
};

export default function CustomerApp({ cardId, token }: Props) {
  const { lang } = useAppStore();
  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState<any | null>(null);
  const [error, setError] = React.useState('');
  const [claiming, setClaiming] = React.useState(false);
  const [cardQr, setCardQr] = React.useState('');

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const session = await get_customer_app_session_live(cardId, token);
      setData(session);
    } catch (e: any) {
      setError(String(e?.message || 'Customer app failed to load'));
    } finally {
      setLoading(false);
    }
  }, [cardId, token]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    let cancelled = false;
    const payload = `IWPOS:CARD:${cardId || ''}`;
    if (!payload) {
      setCardQr('');
      return;
    }
    void QRCode.toDataURL(payload, {
      width: 220,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    }).then((url) => {
      if (!cancelled) setCardQr(url);
    }).catch(() => {
      if (!cancelled) setCardQr('');
    });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  const markRead = async (notificationId: string) => {
    try {
      await mark_customer_notification_read_live(notificationId, cardId, token);
      setData((prev: any) => ({
        ...prev,
        notifications: Array.isArray(prev?.notifications)
          ? prev.notifications.map((row: any) => (row.id === notificationId ? { ...row, is_read: true } : row))
          : [],
      }));
    } catch {}
  };

  const claimReward = async () => {
    try {
      setClaiming(true);
      await claim_customer_reward_live(cardId, token);
      await load();
    } catch (e: any) {
      setError(String(e?.message || 'Reward claim failed'));
    } finally {
      setClaiming(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-950 px-4 py-10 text-center text-slate-200">Loading customer app...</div>;
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-950 px-4 py-10 text-center text-slate-200">
        <div className="mx-auto max-w-lg rounded-3xl border border-red-400/20 bg-red-500/10 p-6">
          <h1 className="text-2xl font-bold text-white">{tx(lang, 'Müştəri tətbiqi açıla bilmədi', 'Клиентское приложение не открылось', 'Customer app could not be opened')}</h1>
          <p className="mt-3 text-sm text-red-200">{error || 'Invalid customer link'}</p>
        </div>
      </div>
    );
  }

  const branding = data.branding || {};
  const wallet = data.wallet || {};
  const notifications = Array.isArray(data.notifications) ? data.notifications : [];
  const campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
  const history = Array.isArray(data.history) ? data.history : [];
  const customer = data.customer || {};
  const rewards = Array.isArray(wallet.rewards) ? wallet.rewards : [];
  const pendingClaims = Array.isArray(data.pending_claims) ? data.pending_claims : [];
  const progressPercent = wallet.next_reward_at ? Math.min(100, Math.round((Number(wallet.progress_current || 0) / Number(wallet.next_reward_at || 1)) * 100)) : 0;
  const primaryColor = String(branding.primary_color || '#facc15');
  const accentColor = String(branding.accent_color || '#22d3ee');
  const programMode = String(wallet.program_mode || 'points').toLowerCase();
  const showQrCard = branding.show_qr_card !== false;
  const showWallet = branding.show_wallet !== false;
  const balanceSuffix = programMode === 'cashback' ? ' ₼' : '';

  return (
    <div
      className="min-h-screen px-4 py-6 text-slate-100"
      style={{ backgroundImage: `radial-gradient(circle at top, ${primaryColor}33, transparent 18%), linear-gradient(180deg,#090d13,#111827)` }}
    >
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-[32px] border border-white/10 bg-white/5 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              {branding.logo_url ? (
                <img src={branding.logo_url} alt="brand" className="h-16 w-16 rounded-3xl object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-yellow-400 text-2xl font-black text-slate-900">
                  {String(branding.company_name || 'I').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{branding.app_name || tx(lang, 'Loyalty Club', 'Loyalty Club', 'Loyalty Club')}</p>
                <h1 className="text-3xl font-black">{branding.company_name || 'iRonWaves POS RC'}</h1>
                <p className="mt-1 text-sm text-slate-300">{branding.hero_title || tx(lang, 'Xoş gəldiniz', 'Добро пожаловать', 'Welcome')}</p>
                <p className="mt-1 text-sm text-slate-400">{branding.hero_subtitle || customer.card_id}</p>
              </div>
            </div>
            {showWallet ? (
              <div className="rounded-3xl px-5 py-4" style={{ border: `1px solid ${accentColor}33`, backgroundColor: `${accentColor}1a` }}>
                <div className="text-xs uppercase tracking-[0.2em]" style={{ color: accentColor }}>{wallet.points_label || 'Ulduz'}</div>
                <div className="mt-1 text-4xl font-black text-white">{Number(wallet.stars_balance ?? 0).toFixed(programMode === 'cashback' ? 2 : 0)}{balanceSuffix}</div>
                <div className="text-sm text-cyan-100">
                  {programMode === 'cashback'
                    ? `${Number(wallet.cashback_percent || 0).toFixed(0)}% cashback`
                    : (customer.type || 'Member')}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center gap-2 text-slate-300"><Sparkles size={18} /> {programMode === 'cashback' ? tx(lang, 'Növbəti cash-out', 'Следующий cash-out', 'Next cash-out') : tx(lang, 'Növbəti reward', 'Следующая награда', 'Next reward')}</div>
            <div className="mt-3 text-2xl font-bold">{wallet.reward_label || 'Reward'}</div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full" style={{ width: `${progressPercent}%`, backgroundColor: primaryColor }} />
            </div>
            <div className="mt-2 text-sm text-slate-400">
              {wallet.progress_remaining > 0
                ? (programMode === 'cashback'
                    ? tx(lang, `${wallet.progress_remaining} AZN qalıb`, `Осталось ${wallet.progress_remaining} AZN`, `${wallet.progress_remaining} AZN remaining`)
                    : tx(lang, `${wallet.progress_remaining} ulduz qalıb`, `Осталось ${wallet.progress_remaining} звезд`, `${wallet.progress_remaining} stars remaining`))
                : (programMode === 'cashback'
                    ? tx(lang, 'Cash-out hazırdır', 'Cash-out готов', 'Cash-out is ready')
                    : tx(lang, 'Reward hazırdır', 'Награда готова', 'Reward is ready'))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center gap-2 text-slate-300"><Gift size={18} /> {tx(lang, 'Hazır reward-lar', 'Готовые награды', 'Available rewards')}</div>
            <div className="mt-3 text-4xl font-black">{wallet.available_rewards ?? 0}</div>
            <div className="mt-2 text-sm text-slate-400">{tx(lang, 'POS-da istifadə edilə bilər', 'Можно использовать на кассе', 'Can be redeemed at the POS')}</div>
            {rewards[0] ? (
              <div className="mt-3 rounded-2xl border border-slate-700/60 bg-slate-950/30 p-3 text-sm text-slate-300">
                <div className="font-semibold text-white">{rewards[0].title}</div>
                <div className="mt-1 text-slate-400">{rewards[0].description}</div>
                <button
                  type="button"
                  disabled={claiming || Number(wallet.available_rewards || 0) <= 0}
                  onClick={() => { void claimReward(); }}
                  className="mt-3 rounded-xl px-4 py-2 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ backgroundColor: primaryColor }}
                >
                  {claiming
                    ? tx(lang, 'Hazırlanır...', 'Подготавливается...', 'Preparing...')
                    : tx(lang, 'Reward claim et', 'Забрать награду', 'Claim reward')}
                </button>
              </div>
            ) : null}
          </div>

          {showQrCard ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center gap-2 text-slate-300"><QrCode size={18} /> {tx(lang, 'Kart', 'Карта', 'Card')}</div>
            <div className="mt-3 flex flex-col items-center rounded-3xl border border-white/10 bg-white/90 p-4 text-slate-900">
              {cardQr ? <img src={cardQr} alt="customer qr" className="h-40 w-40 rounded-2xl" /> : null}
              <div className="mt-3 text-lg font-semibold">{customer.card_id}</div>
            </div>
            <div className="mt-2 text-sm text-slate-400">{tx(lang, 'Müştəri kassada bu QR kodu göstərir, kassir skan edib kartı tanıyır.', 'Покажите этот QR на кассе для сканирования.', 'Show this QR at the POS so the cashier can scan it.')}</div>
          </div>
          ) : (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center gap-2 text-slate-300"><QrCode size={18} /> {tx(lang, 'Kart', 'Карта', 'Card')}</div>
              <div className="mt-3 text-lg font-semibold">{customer.card_id}</div>
              <div className="mt-2 text-sm text-slate-400">{tx(lang, 'Bu ID ilə kassada tanınacaqsınız', 'По этому ID вас узнают на кассе', 'Use this ID at the POS')}</div>
            </div>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="mb-4 flex items-center gap-2 text-lg font-bold"><Gift size={18} /> {tx(lang, 'Aktiv kampaniyalar', 'Активные кампании', 'Active campaigns')}</div>
              <div className="grid gap-3">
                {campaigns.length === 0 ? (
                  <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 text-sm text-slate-400">
                    {tx(lang, 'Hazırda aktiv kampaniya yoxdur', 'Сейчас нет активных кампаний', 'No active campaigns right now')}
                  </div>
                ) : campaigns.map((row: any) => (
                  <div key={row.id} className="rounded-2xl border border-emerald-400/15 bg-emerald-500/5 p-4">
                    <div className="text-lg font-semibold text-white">{row.name}</div>
                    <div className="mt-1 text-sm text-emerald-100">{row.discount_percent}% {tx(lang, 'endirim', 'скидка', 'discount')}</div>
                    <div className="mt-2 text-xs text-slate-400">{row.start_time} - {row.end_time} • {row.categories || 'ALL'}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="mb-4 flex items-center gap-2 text-lg font-bold"><History size={18} /> {tx(lang, 'Son tarixçə', 'Последняя история', 'Recent history')}</div>
              <div className="space-y-3">
                {history.length === 0 ? (
                  <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 text-sm text-slate-400">
                    {tx(lang, 'Hələ alış tarixçəsi yoxdur', 'История покупок пока пуста', 'No purchase history yet')}
                  </div>
                ) : history.map((row: any) => (
                  <div key={row.id} className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-white">{new Date(row.created_at).toLocaleString()}</div>
                        <div className="mt-1 text-sm text-slate-400">{(row.items || []).map((item: any) => `${item.item_name} x${item.qty}`).join(', ') || '-'}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-white">{Number(row.total || 0).toFixed(2)} ₼</div>
                        <div className="text-xs text-slate-400">{row.payment_method}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="mb-4 flex items-center gap-2 text-lg font-bold"><Gift size={18} /> {tx(lang, 'Claim kodları', 'Коды наград', 'Claim codes')}</div>
              <div className="space-y-3">
                {pendingClaims.length === 0 ? (
                  <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 text-sm text-slate-400">
                    {tx(lang, 'Aktiv claim kodu yoxdur', 'Активных кодов нет', 'No active claim codes')}
                  </div>
                ) : pendingClaims.map((row: any) => (
                  <div key={row.id} className="rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-amber-100">{tx(lang, 'Kassada bu kodu göstərin', 'Покажите этот код на кассе', 'Show this code at the POS')}</div>
                    <div className="mt-2 text-2xl font-black text-white">{row.claim_code}</div>
                    <div className="mt-2 text-sm text-slate-200">{row.reward_name}</div>
                    <div className="mt-1 text-xs text-slate-400">{row.reward_description}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="mb-4 flex items-center gap-2 text-lg font-bold"><Bell size={18} /> {tx(lang, 'Bildirişlər', 'Уведомления', 'Notifications')}</div>
              <div className="space-y-3">
                {notifications.length === 0 ? (
                  <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 text-sm text-slate-400">
                    {tx(lang, 'Yeni bildiriş yoxdur', 'Нет новых уведомлений', 'No new notifications')}
                  </div>
                ) : notifications.map((row: any) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => { if (!row.is_read) void markRead(row.id); }}
                    className={`w-full rounded-2xl border p-4 text-left ${row.is_read ? 'border-slate-700/60 bg-slate-950/20' : 'border-cyan-300/20 bg-cyan-400/10'}`}
                  >
                    <div className="text-sm text-white">{row.message}</div>
                    <div className="mt-2 text-xs text-slate-400">{new Date(row.created_at).toLocaleString()}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="text-lg font-bold">{tx(lang, 'Üstünlüklər', 'Преимущества', 'Benefits')}</div>
              <ul className="mt-3 space-y-2 text-sm text-slate-300">
                <li>{tx(lang, 'Topladığınız ulduzlar burada görünür', 'Здесь видны накопленные звезды', 'Your collected stars are shown here')}</li>
                <li>{tx(lang, 'Aktiv kampaniyaları bir baxışda izləyin', 'Следите за активными кампаниями', 'Track active campaigns at a glance')}</li>
                <li>{tx(lang, 'Reward hazır olduqda kassada istifadə edin', 'Используйте награды на кассе', 'Redeem rewards at the POS')}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

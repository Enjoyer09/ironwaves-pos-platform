import React from 'react';
import { Bell, Gift, History, QrCode, Sparkles } from 'lucide-react';
import { tx } from '../i18n';
import { useAppStore } from '../store';
import { get_customer_app_session_live, mark_customer_notification_read_live } from '../api/crm';

type Props = {
  cardId: string;
  token: string;
};

export default function CustomerApp({ cardId, token }: Props) {
  const { lang } = useAppStore();
  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState<any | null>(null);
  const [error, setError] = React.useState('');

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
  const progressPercent = wallet.next_reward_at ? Math.min(100, Math.round((Number(wallet.progress_current || 0) / Number(wallet.next_reward_at || 1)) * 100)) : 0;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(250,204,21,0.16),transparent_18%),linear-gradient(180deg,#090d13,#111827)] px-4 py-6 text-slate-100">
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
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{tx(lang, 'Loyalty Club', 'Loyalty Club', 'Loyalty Club')}</p>
                <h1 className="text-3xl font-black">{branding.company_name || 'iRonWaves POS RC'}</h1>
                <p className="mt-1 text-sm text-slate-400">{customer.card_id}</p>
              </div>
            </div>
            <div className="rounded-3xl border border-cyan-300/20 bg-cyan-400/10 px-5 py-4">
              <div className="text-xs uppercase tracking-[0.2em] text-cyan-200">{wallet.points_label || 'Ulduz'}</div>
              <div className="mt-1 text-4xl font-black text-white">{wallet.stars_balance ?? 0}</div>
              <div className="text-sm text-cyan-100">{customer.type || 'Member'}</div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center gap-2 text-slate-300"><Sparkles size={18} /> {tx(lang, 'Növbəti reward', 'Следующая награда', 'Next reward')}</div>
            <div className="mt-3 text-2xl font-bold">{wallet.reward_label || 'Reward'}</div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-yellow-400" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="mt-2 text-sm text-slate-400">
              {wallet.progress_remaining > 0
                ? tx(lang, `${wallet.progress_remaining} ulduz qalıb`, `Осталось ${wallet.progress_remaining} звезд`, `${wallet.progress_remaining} stars remaining`)
                : tx(lang, 'Reward hazırdır', 'Награда готова', 'Reward is ready')}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center gap-2 text-slate-300"><Gift size={18} /> {tx(lang, 'Hazır reward-lar', 'Готовые награды', 'Available rewards')}</div>
            <div className="mt-3 text-4xl font-black">{wallet.available_rewards ?? 0}</div>
            <div className="mt-2 text-sm text-slate-400">{tx(lang, 'POS-da istifadə edilə bilər', 'Можно использовать на кассе', 'Can be redeemed at the POS')}</div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center gap-2 text-slate-300"><QrCode size={18} /> {tx(lang, 'Kart', 'Карта', 'Card')}</div>
            <div className="mt-3 text-lg font-semibold">{customer.card_id}</div>
            <div className="mt-2 text-sm text-slate-400">{tx(lang, 'Bu ID ilə kassada tanınacaqsınız', 'По этому ID вас узнают на кассе', 'Use this ID at the POS')}</div>
          </div>
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

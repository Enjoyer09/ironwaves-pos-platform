import { useEffect, useMemo, useState } from 'react';
import { generate_qr_codes } from '../../api/qr_generator';
import { get_customers_live } from '../../api/crm';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';

const QR_TYPES = [
  { value: 'golden', label_az: 'Golden (5%)', label_ru: 'Golden (5%)', discount: 5 },
  { value: 'platinum', label_az: 'Platinum (10%)', label_ru: 'Platinum (10%)', discount: 10 },
  { value: 'elite', label_az: 'Elite (20%)', label_ru: 'Elite (20%)', discount: 20 },
  { value: 'thermos', label_az: 'Thermos (20%)', label_ru: 'Thermos (20%)', discount: 20 },
  { value: 'ikram', label_az: 'Ikram (100%)', label_ru: 'Угощение (100%)', discount: 100 },
  { value: 'telebe', label_az: 'Tələbə (15%)', label_ru: 'Студент (15%)', discount: 15 },
];

export default function CRMPanel() {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [customers, setCustomers] = useState<any[]>([]);
  const [count, setCount] = useState(1);
  const [tier, setTier] = useState('golden');
  const [loading, setLoading] = useState(false);

  const selectedTier = useMemo(() => QR_TYPES.find((t) => t.value === tier) || QR_TYPES[0], [tier]);

  const loadData = async () => {
    const cust = await get_customers_live(tenant_id);
    setCustomers(cust || []);
  };

  useEffect(() => {
    void loadData();
  }, [tenant_id]);

  const onGenerate = async () => {
    if (count < 1 || count > 200) {
      notify('error', tx(lang, 'Say 1 ilə 200 arasında olmalıdır', 'Количество должно быть от 1 до 200'));
      return;
    }
    setLoading(true);
    try {
      await generate_qr_codes(tenant_id, count, selectedTier.value, selectedTier.discount);
      loadData();
      notify('success', tx(lang, 'QR kodlar uğurla yaradıldı', 'QR-коды успешно созданы'));
    } catch (error: any) {
      notify('error', error?.message || tx(lang, 'QR yaratma zamanı xəta', 'Ошибка при создании QR'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5 text-slate-100">
      <div className="metal-panel p-5">
        <h2 className="text-3xl font-black tracking-wide">{tx(lang, 'QR GENERATOR', 'ГЕНЕРАТОР QR')}</h2>
        <p className="mt-2 text-sm text-slate-300">{tx(lang, 'QR tipi POS və Maliyyə ilə sinxron işləyir. Müştərinin tipi satışdakı endirimə avtomatik tətbiq olunur.', 'Тип QR синхронизирован с POS и Финансами. Тип клиента автоматически влияет на скидку в продаже.')}</p>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm text-slate-300">
            {tx(lang, 'Say', 'Количество')}
            <input
              type="number"
              min={1}
              max={200}
              value={count}
              onChange={(e) => setCount(Number(e.target.value || 1))}
              className="neon-input mt-1"
            />
          </label>
          <label className="text-sm text-slate-300">
            {tx(lang, 'Tip', 'Тип')}
            <select value={tier} onChange={(e) => setTier(e.target.value)} className="neon-input mt-1">
              {QR_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {lang === 'ru' ? item.label_ru : item.label_az}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button disabled={loading} onClick={onGenerate} className="glossy-gold mt-4 rounded-xl px-5 py-3 font-bold disabled:opacity-60">
          {loading ? tx(lang, 'Yaradılır...', 'Создается...') : tx(lang, 'QR Kodları Yarat', 'Создать QR-коды')}
        </button>
      </div>

      <div className="metal-panel overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-700/70 bg-slate-900/40 text-slate-300">
            <tr>
                <th className="px-4 py-3">{tx(lang, 'Kart ID', 'ID карты')}</th>
                <th className="px-4 py-3">{tx(lang, 'Tip', 'Тип')}</th>
                <th className="px-4 py-3">{tx(lang, 'Endirim', 'Скидка')}</th>
                <th className="px-4 py-3">{tx(lang, 'Ulduz', 'Звезды')}</th>
                <th className="px-4 py-3">{tx(lang, 'Tarix', 'Дата')}</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-t border-slate-700/50">
                <td className="px-4 py-3 font-mono text-slate-100">{c.card_id}</td>
                <td className="px-4 py-3">{c.type}</td>
                <td className="px-4 py-3 text-emerald-300">{c.discount_percent || 0}%</td>
                <td className="px-4 py-3">{c.stars || 0}</td>
                <td className="px-4 py-3 text-slate-400">{new Date(c.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'az-AZ')}</td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    {tx(lang, 'Hələ QR müştəri yaradılmayıb', 'QR-клиенты еще не созданы')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

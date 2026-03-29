import { useState, useEffect } from 'react';
import { get_kitchen_orders_live, accept_order_live, complete_order_live } from '../api/kds';
import { Clock, CheckCircle, ChefHat, AlertCircle } from 'lucide-react';
import { KitchenOrder } from '../types/pos';
import { useAppStore } from '../store';
import { tx } from '../i18n';
import { logUiError } from '../lib/logger';

export default function KDS() {
  const { user, lang } = useAppStore();
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  const [currentTime, setCurrentTime] = useState(Date.now());

  // Sifarişləri mütəmadi olaraq yoxla (Simulyativ WebSocket)
  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const activeOrders = await get_kitchen_orders_live(tenant_id);
        setOrders(Array.isArray(activeOrders) ? activeOrders : []);
      } catch (e) {
        logUiError(tenant_id, 'kds', e instanceof Error ? e.message : String(e), { phase: 'fetch_orders' });
        setOrders([]);
      }
    };

    void fetchOrders();
    const interval = setInterval(() => { void fetchOrders(); }, 5000);
    const clock = setInterval(() => setCurrentTime(Date.now()), 15000);
    return () => {
      clearInterval(interval);
      clearInterval(clock);
    };
  }, [tenant_id]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const getElapsedMinutes = (created_at: string) => {
    const ts = new Date(created_at).getTime();
    if (Number.isNaN(ts)) return 0;
    return Math.max(0, Math.floor((currentTime - ts) / 60000));
  };

  const normalizeItems = (order: any) => {
    if (Array.isArray(order?.items)) return order.items;
    if (typeof order?.items === 'string') {
      try {
        const parsed = JSON.parse(order.items);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  };

  const handleAccept = async (order_id: string) => {
    try {
      await accept_order_live(order_id, user?.username || 'kitchen');
      setOrders(await get_kitchen_orders_live(tenant_id));
    } catch (e: any) {
      logUiError(tenant_id, 'kds', e?.message || String(e), { phase: 'accept_order', order_id });
      useAppStore.getState().notify('error', e.message);
    }
  };

  const handleComplete = async (order_id: string) => {
    try {
      await complete_order_live(order_id, user?.username || 'kitchen');
      setOrders(await get_kitchen_orders_live(tenant_id));
    } catch (e: any) {
      logUiError(tenant_id, 'kds', e?.message || String(e), { phase: 'complete_order', order_id });
      useAppStore.getState().notify('error', e.message);
    }
  };

  const getStatusColor = (status: string, created_at: string) => {
    const elapsed = getElapsedMinutes(created_at);
    if (elapsed > 15) return 'border-red-400/80 bg-red-900/25';
    if (elapsed > 10) return 'border-yellow-300/80 bg-yellow-900/20';
    
    switch (status) {
      case 'NEW': return 'border-blue-300/60 bg-blue-900/20';
      case 'PREPARING': return 'border-orange-300/60 bg-orange-900/20';
      case 'READY': return 'border-emerald-300/70 bg-emerald-900/20';
      default: return 'border-slate-600 bg-slate-800/30';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'NEW': return <span className="rounded px-2 py-1 text-xs font-bold bg-blue-400/20 text-blue-200 border border-blue-300/40">{tx(lang, 'YENİ', 'НОВЫЙ', 'NEW')}</span>;
      case 'PREPARING': return <span className="rounded px-2 py-1 text-xs font-bold bg-orange-400/20 text-orange-200 border border-orange-300/40">{tx(lang, 'HAZIRLANIR', 'ГОТОВИТСЯ', 'PREPARING')}</span>;
      case 'READY': return <span className="rounded px-2 py-1 text-xs font-bold bg-emerald-400/20 text-emerald-200 border border-emerald-300/40">{tx(lang, 'HAZIRDIR', 'ГОТОВО', 'READY')}</span>;
      default: return null;
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 text-slate-100">
      {!isOnline && (
        <div className="mb-4 rounded-xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          <div className="font-semibold">{tx(lang, 'Offline mətbəx rejimi aktivdir', 'Офлайн режим кухни активен', 'Offline kitchen mode is active')}</div>
          <div className="mt-1 text-amber-200/90">
            {tx(
              lang,
              'Aktiv sifarişlər lokal yaddaşdan oxunur. Qəbul et və Hazırdır əməliyyatları bu cihazda saxlanacaq.',
              'Активные заказы читаются из локального хранилища. Действия принять и готово будут сохранены на этом устройстве.',
              'Active orders are read from local storage. Accept and Ready actions will be stored on this device.',
            )}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center text-slate-100">
          <ChefHat size={28} className="mr-3 text-yellow-300" />
          <h1 className="text-2xl font-bold">{tx(lang, 'Mətbəx Ekranı (KDS)', 'Экран кухни (KDS)', 'Kitchen Display (KDS)')}</h1>
        </div>
        <div className="flex gap-3 text-sm font-medium items-center">
          <div className="metal-panel px-4 py-2 text-slate-300 flex items-center">
            {tx(lang, 'Aktiv Sifarişlər', 'Активные заказы', 'Active Orders')}: <span className="ml-2 text-yellow-300 text-lg">{orders.length}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
        {orders.map(order => (
          <div key={order.id} className={`flex flex-col rounded-2xl border-2 overflow-hidden ${getStatusColor(order.status, order.created_at)}`}>
            
            <div className="p-4 border-b border-slate-600/40 flex justify-between items-center bg-slate-900/25">
              <div className="flex flex-col gap-1">
                <div className="flex items-center space-x-2">
                    <span className="font-bold text-slate-100">#{String(order.id || '').substring(0,4).toUpperCase()}</span>
                  {getStatusBadge(order.status)}
                  {order.priority === 'URGENT' && (
                      <span className="flex items-center text-red-500 text-xs font-bold ml-2">
                      <AlertCircle size={14} className="mr-1" /> {tx(lang, 'TƏCİLİ', 'СРОЧНО', 'URGENT')}
                    </span>
                  )}
                </div>
                {(order.table_label || order.order_type) && (
                  <div className="text-xs font-bold text-slate-200 bg-slate-700/40 inline-block px-2 py-0.5 rounded">
                    {order.table_label ? tx(lang, `Masa: ${order.table_label}`, `Стол: ${order.table_label}`, `Table: ${order.table_label}`) : order.order_type}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end text-sm font-medium">
                <div className="flex items-center text-slate-100 font-bold bg-slate-800/80 px-2 py-1 rounded-lg border border-slate-600/50">
                  <Clock size={14} className="mr-1" />
                  {getElapsedMinutes(order.created_at)} {tx(lang, 'dəq', 'мин', 'min')}
                </div>
                <div className="text-slate-400 text-xs mt-1">
                  {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>

            <div className="flex-1 p-4 bg-slate-900/15">
              <ul className="space-y-3">
                {normalizeItems(order).map((item: any, idx: number) => (
                  <li key={idx} className="flex justify-between items-center text-lg font-medium text-slate-100">
                    <span className="flex items-center">
                      <span className="w-6 h-6 rounded bg-slate-700 text-slate-100 flex items-center justify-center text-sm mr-3">
                        {item.qty}
                      </span>
                      {item.item_name}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="p-4 mt-auto">
              {order.status === 'NEW' && (
                <button
                  onClick={() => { void handleAccept(order.id); }}
                  className="w-full py-3 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors shadow-sm"
                >
                  {tx(lang, 'Qəbul Et (Hazırla)', 'Принять (готовить)', 'Accept (Start Preparing)')}
                </button>
              )}
              {order.status === 'PREPARING' && (
                <button
                  onClick={() => { void handleComplete(order.id); }}
                  className="w-full py-3 rounded-xl font-bold bg-yellow-400 hover:bg-yellow-300 text-slate-900 transition-colors shadow-sm flex items-center justify-center"
                >
                  <CheckCircle size={20} className="mr-2" />
                  {tx(lang, 'Hazırdır (Tamamla)', 'Готово (завершить)', 'Ready (Complete)')}
                </button>
              )}
              {order.status === 'READY' && (
                <div className="w-full rounded-xl border border-emerald-300/40 bg-emerald-500/10 px-4 py-3 text-center text-sm font-semibold text-emerald-100">
                  {tx(lang, 'Ofisant üçün hazırdır', 'Готово для официанта', 'Ready for waiter')}
                </div>
              )}
            </div>
            
          </div>
        ))}

        {orders.length === 0 && (
          <div className="metal-panel col-span-full py-20 flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-600/70">
            <ChefHat size={48} className="mb-4 text-slate-500" />
            <p className="text-xl font-medium text-slate-300">{tx(lang, 'Hazırda aktiv sifariş yoxdur', 'Сейчас нет активных заказов', 'There are no active orders right now')}</p>
            <p className="text-sm">{tx(lang, 'Yeni sifarişlər avtomatik olaraq bura düşəcək.', 'Новые заказы появятся здесь автоматически.', 'New orders will appear here automatically.')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

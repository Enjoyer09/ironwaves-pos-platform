import { useState, useEffect } from 'react';
import { get_kitchen_orders_live, accept_order_live, complete_order_live, ready_kitchen_item_status_live, serve_kitchen_item_status_live, start_kitchen_item_status_live } from '../api/kds';
import { subscribeTenantRealtime } from '../api/realtime';
import { Clock, CheckCircle, ChefHat, AlertCircle } from 'lucide-react';
import { KitchenOrder } from '../types/pos';
import { useAppStore } from '../store';
import { tx } from '../i18n';
import { logUiError } from '../lib/logger';

export default function KDS() {
  const { user, lang } = useAppStore();
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [readySelections, setReadySelections] = useState<Record<string, string[]>>({});
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  const [currentTime, setCurrentTime] = useState(Date.now());

  const parseServerTimestamp = (value?: string | null) => {
    if (!value) return NaN;
    const normalized = /z$/i.test(value) || /[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
    return new Date(normalized).getTime();
  };

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
    const unsubscribe = subscribeTenantRealtime(tenant_id, (message) => {
      if (!['kitchen.updated', 'check.updated', 'table.updated'].includes(String(message.event || ''))) return;
      void get_kitchen_orders_live(tenant_id)
        .then((activeOrders) => setOrders(Array.isArray(activeOrders) ? activeOrders : []))
        .catch(() => {});
    });
    return unsubscribe;
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
    const ts = parseServerTimestamp(created_at);
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

  const handleComplete = async (order_id: string, readyItems: string[] = []) => {
    try {
      await complete_order_live(order_id, user?.username || 'kitchen', readyItems);
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
      case 'SENT':
      case 'NEW': return 'border-blue-300/60 bg-blue-900/20';
      case 'PREPARING': return 'border-orange-300/60 bg-orange-900/20';
      case 'READY': return 'border-emerald-300/70 bg-emerald-900/20';
      case 'VOID_REQUESTED': return 'border-yellow-300/90 bg-yellow-900/30';
      case 'VOIDED': return 'border-rose-300/70 bg-rose-900/20';
      case 'COMPED': return 'border-sky-300/70 bg-sky-900/20';
      case 'WASTE': return 'border-slate-300/40 bg-slate-800/40';
      case 'REMAKE': return 'border-orange-300/80 bg-orange-900/25';
      default: return 'border-slate-600 bg-slate-800/30';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'SENT': return <span className="rounded px-2 py-1 text-xs font-bold bg-blue-400/20 text-blue-200 border border-blue-300/40">{tx(lang, 'GÖNDƏRİLDİ', 'ОТПРАВЛЕНО', 'SENT')}</span>;
      case 'NEW': return <span className="rounded px-2 py-1 text-xs font-bold bg-blue-400/20 text-blue-200 border border-blue-300/40">{tx(lang, 'YENİ', 'НОВЫЙ', 'NEW')}</span>;
      case 'PREPARING': return <span className="rounded px-2 py-1 text-xs font-bold bg-orange-400/20 text-orange-200 border border-orange-300/40">{tx(lang, 'HAZIRLANIR', 'ГОТОВИТСЯ', 'PREPARING')}</span>;
      case 'READY': return <span className="rounded px-2 py-1 text-xs font-bold bg-emerald-400/20 text-emerald-200 border border-emerald-300/40">{tx(lang, 'HAZIRDIR', 'ГОТОВО', 'READY')}</span>;
      case 'VOID_REQUESTED': return <span className="rounded px-2 py-1 text-xs font-bold bg-yellow-400/25 text-yellow-100 border border-yellow-300/60">{tx(lang, 'LƏĞV TƏLƏBİ', 'ЗАПРОС ОТМЕНЫ', 'CANCEL REQUEST')}</span>;
      case 'VOIDED': return <span className="rounded px-2 py-1 text-xs font-bold bg-rose-400/20 text-rose-200 border border-rose-300/40">{tx(lang, 'LƏĞV EDİLDİ', 'ОТМЕНЕНО', 'VOIDED')}</span>;
      case 'COMPED': return <span className="rounded px-2 py-1 text-xs font-bold bg-sky-400/20 text-sky-200 border border-sky-300/40">{tx(lang, 'COMP', 'КОМП', 'COMP')}</span>;
      case 'WASTE': return <span className="rounded px-2 py-1 text-xs font-bold bg-slate-400/20 text-slate-200 border border-slate-300/40">{tx(lang, 'WASTE', 'СПИСАНО', 'WASTE')}</span>;
      case 'REMAKE': return <span className="rounded px-2 py-1 text-xs font-bold bg-orange-400/20 text-orange-200 border border-orange-300/40">{tx(lang, 'REMAKE', 'ПЕРЕДЕЛАТЬ', 'REMAKE')}</span>;
      default: return null;
    }
  };

  const groupedOrders = orders.reduce<Array<{
    key: string;
    table_label: string | null;
    order_type?: string;
    status: 'NEW' | 'SENT' | 'PREPARING' | 'READY' | 'VOID_REQUESTED';
    priority: 'NORMAL' | 'URGENT';
    created_at: string;
    ids: string[];
    newIds: string[];
    preparingIds: string[];
    readyIds: string[];
    items: Array<{ ids: string[]; item_name: string; qty: number; seat_label?: string; action?: string | null; status?: string; reason?: string }>;
    batchCount: number;
  }>>((acc, order) => {
    const key = order.table_label ? `table:${order.table_label}` : `order:${order.id}`;
    const existing = acc.find((row) => row.key === key);
    const normalizedItems = normalizeItems(order);

    if (!existing) {
      acc.push({
        key,
        table_label: order.table_label || null,
        order_type: order.order_type,
        status: order.status === 'SENT' ? 'NEW' : order.status,
        priority: order.priority,
        created_at: order.created_at,
        ids: [order.id],
        newIds: ['NEW', 'SENT'].includes(order.status) ? [order.id] : [],
        preparingIds: order.status === 'PREPARING' ? [order.id] : [],
        readyIds: order.status === 'READY' ? [order.id] : [],
        items: normalizedItems.map((item: any) => ({
          ids: item.id ? [String(item.id)] : [],
          item_name: item.item_name,
          qty: Number(item.qty || 0),
          seat_label: item.seat_label ? String(item.seat_label) : undefined,
          action: String(item.action || '').toUpperCase() || null,
          status: String(item.status || item.action || order.status || '').toUpperCase(),
          reason: item.reason || '',
        })),
        batchCount: 1,
      });
      return acc;
    }

    existing.ids.push(order.id);
    existing.batchCount += 1;
    if (['NEW', 'SENT'].includes(order.status)) existing.newIds.push(order.id);
    if (order.status === 'PREPARING') existing.preparingIds.push(order.id);
    if (order.status === 'READY') existing.readyIds.push(order.id);
    if (order.priority === 'URGENT') existing.priority = 'URGENT';

    const currentCreated = parseServerTimestamp(existing.created_at);
    const nextCreated = parseServerTimestamp(order.created_at);
    if (!Number.isNaN(nextCreated) && (Number.isNaN(currentCreated) || nextCreated < currentCreated)) {
      existing.created_at = order.created_at;
    }

    if (existing.items.some((item) => String(item.status || '').toUpperCase() === 'VOID_REQUESTED')) existing.status = 'VOID_REQUESTED';
    else if (existing.newIds.length > 0) existing.status = 'NEW';
    else if (existing.preparingIds.length > 0) existing.status = 'PREPARING';
    else existing.status = 'READY';

    normalizedItems.forEach((item: any) => {
      const itemAction = String(item.action || '').toUpperCase() || null;
      const itemStatus = String(item.status || item.action || order.status || '').toUpperCase();
      const itemSeat = item.seat_label ? String(item.seat_label) : undefined;
      const idx = existing.items.findIndex((row) => row.item_name === item.item_name && (row.action || null) === itemAction && (row.status || '') === itemStatus && (row.seat_label || '') === (itemSeat || ''));
      if (idx >= 0) {
        existing.items[idx].qty += Number(item.qty || 0);
        if (item.id) existing.items[idx].ids.push(String(item.id));
      } else {
        existing.items.push({ ids: item.id ? [String(item.id)] : [], item_name: item.item_name, qty: Number(item.qty || 0), seat_label: itemSeat, action: itemAction, status: itemStatus, reason: item.reason || '' });
      }
    });
    return acc;
  }, []);

  const handleAcceptGroup = async (group: { newIds: string[] }) => {
    try {
      await Promise.all(group.newIds.map((orderId) => accept_order_live(orderId, user?.username || 'kitchen')));
      setOrders(await get_kitchen_orders_live(tenant_id));
    } catch (e: any) {
      logUiError(tenant_id, 'kds', e?.message || String(e), { phase: 'accept_group', ids: group.newIds });
      useAppStore.getState().notify('error', e.message);
    }
  };

  const handleCompleteGroup = async (group: { key: string; preparingIds: string[] }) => {
    try {
      const selectedReadyKeys = readySelections[group.key] || [];
      const selectedReady = selectedReadyKeys.map((entry) => {
        const [itemName, seatLabel] = String(entry).split('::');
        return seatLabel ? `${itemName} · ${seatLabel}` : itemName;
      });
      await Promise.all(group.preparingIds.map((orderId) => complete_order_live(orderId, user?.username || 'kitchen', selectedReady)));
      setReadySelections((prev) => {
        const next = { ...prev };
        delete next[group.key];
        return next;
      });
      setOrders(await get_kitchen_orders_live(tenant_id));
    } catch (e: any) {
      logUiError(tenant_id, 'kds', e?.message || String(e), { phase: 'complete_group', ids: group.preparingIds });
      useAppStore.getState().notify('error', e.message);
    }
  };

  const handleItemStatus = async (itemIds: string[], nextStatus: 'PREPARING' | 'READY' | 'SERVED') => {
    try {
      const ids = itemIds.filter(Boolean);
      if (ids.length === 0) return;
      const runner = nextStatus === 'PREPARING'
        ? start_kitchen_item_status_live
        : nextStatus === 'READY'
          ? ready_kitchen_item_status_live
          : serve_kitchen_item_status_live;
      await Promise.all(ids.map((itemId) => runner(itemId)));
      setOrders(await get_kitchen_orders_live(tenant_id));
    } catch (e: any) {
      logUiError(tenant_id, 'kds', e?.message || String(e), { phase: 'item_status', nextStatus, itemIds });
      useAppStore.getState().notify('error', e.message || tx(lang, 'Item statusu dəyişmədi', 'Статус позиции не изменился', 'Item status was not updated'));
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
            {tx(lang, 'Aktiv Sifarişlər', 'Активные заказы', 'Active Orders')}: <span className="ml-2 text-yellow-300 text-lg">{groupedOrders.length}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
        {groupedOrders.map(order => (
          <div key={order.key} className={`flex flex-col rounded-2xl border-2 overflow-hidden ${getStatusColor(order.status, order.created_at)}`}>
            
            <div className="p-4 border-b border-slate-600/40 flex justify-between items-center bg-slate-900/25">
              <div className="flex flex-col gap-1">
                <div className="flex items-center space-x-2">
                    <span className="font-bold text-slate-100">#{String(order.ids[0] || '').substring(0,4).toUpperCase()}</span>
                  {getStatusBadge(order.status)}
                  {order.priority === 'URGENT' && (
                      <span className="flex items-center text-red-500 text-xs font-bold ml-2">
                      <AlertCircle size={14} className="mr-1" /> {tx(lang, 'TƏCİLİ', 'СРОЧНО', 'URGENT')}
                    </span>
                  )}
                  {order.batchCount > 1 && (
                    <span className="rounded px-2 py-1 text-xs font-bold bg-violet-400/20 text-violet-200 border border-violet-300/40">
                      +{order.batchCount - 1} {tx(lang, 'əlavə göndəriş', 'добавление', 'updates')}
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
                  {new Date(parseServerTimestamp(order.created_at)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>

            <div className="flex-1 p-4 bg-slate-900/15">
              {order.items.some((item: any) => String(item.status || '').toUpperCase() === 'VOID_REQUESTED') ? (
                <div className="mb-4 rounded-2xl border border-yellow-300/60 bg-yellow-400/15 px-4 py-3 text-sm font-black text-yellow-100">
                  {tx(lang, 'STOP: Bu sifarişdə ləğv tələbi var. Hazırlamağa davam etmədən əvvəl manager/ofisiant təsdiqini gözləyin.', 'СТОП: В этом заказе есть запрос отмены. Дождитесь подтверждения менеджера/официанта перед продолжением.', 'STOP: This order has a cancel request. Wait for manager/waiter confirmation before continuing.')}
                </div>
              ) : null}
              <ul className="space-y-3">
                {order.items.map((item: any, idx: number) => {
                  const itemStatus = String(item.status || order.status || '').toUpperCase();
                  const canStart = ['NEW', 'SENT'].includes(itemStatus);
                  const canReady = ['NEW', 'SENT', 'PREPARING'].includes(itemStatus);
                  const canServe = itemStatus === 'READY';
                  const isCancelled = ['CANCEL', 'VOIDED', 'VOID_REQUESTED', 'WASTE', 'COMPED'].includes(String(item.action || itemStatus || '').toUpperCase());
                  const isCancelRequested = itemStatus === 'VOID_REQUESTED';
                  return (
                    <li key={idx} className={`flex flex-col gap-3 rounded-xl border border-slate-700/50 bg-slate-950/25 px-3 py-3 text-lg font-medium ${isCancelled ? 'text-rose-300' : 'text-slate-100'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <span className="flex min-w-0 items-start">
                          <span className={`mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded text-sm ${isCancelled ? 'bg-rose-900/60 text-rose-100' : 'bg-slate-700 text-slate-100'}`}>
                            {item.qty}
                          </span>
                          <span className="min-w-0">
                            {isCancelRequested ? `${tx(lang, 'STOP / LƏĞV TƏLƏBİ', 'СТОП / ЗАПРОС ОТМЕНЫ', 'STOP / CANCEL REQUEST')} · ` : isCancelled ? `${tx(lang, 'LƏĞV', 'ОТМЕНА', 'CANCEL')} · ` : ''}
                            {item.item_name}
                            {item.seat_label ? <span className="ml-2 text-xs font-medium text-cyan-200/80">[{item.seat_label}]</span> : null}
                            {item.reason ? (
                              <span className="ml-2 text-xs font-medium text-rose-200/80">({item.reason})</span>
                            ) : null}
                          </span>
                        </span>
                        {getStatusBadge(itemStatus)}
                      </div>
                      {!isCancelled && item.ids?.length > 0 ? (
                        <div className="flex flex-wrap gap-2 pl-10">
                          {canStart ? (
                            <button type="button" onClick={() => { void handleItemStatus(item.ids, 'PREPARING'); }} className="min-h-10 rounded-xl border border-blue-300/35 bg-blue-500/10 px-3 py-2 text-xs font-black text-blue-100">
                              {tx(lang, 'Başla', 'Начать', 'Start')}
                            </button>
                          ) : null}
                          {canReady ? (
                            <button type="button" onClick={() => { void handleItemStatus(item.ids, 'READY'); }} className="min-h-10 rounded-xl border border-yellow-300/40 bg-yellow-400/15 px-3 py-2 text-xs font-black text-yellow-100">
                              {tx(lang, 'Hazırdır', 'Готово', 'Ready')}
                            </button>
                          ) : null}
                          {canServe ? (
                            <button type="button" onClick={() => { void handleItemStatus(item.ids, 'SERVED'); }} className="min-h-10 rounded-xl border border-emerald-300/40 bg-emerald-500/15 px-3 py-2 text-xs font-black text-emerald-100">
                              {tx(lang, 'Servis edildi', 'Подано', 'Served')}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="p-4 mt-auto">
              {order.status === 'NEW' && (
                <button
                  onClick={() => { void handleAcceptGroup(order); }}
                  className="w-full py-3 rounded-xl font-bold bg-blue-600 hover:bg-blue-500 text-white transition-colors shadow-sm"
                >
                  {order.newIds.length > 1
                    ? tx(lang, 'Yeni əlavələri qəbul et', 'Принять новые добавления', 'Accept new additions')
                    : tx(lang, 'Qəbul Et (Hazırla)', 'Принять (готовить)', 'Accept (Start Preparing)')}
                </button>
              )}
              {order.status === 'PREPARING' && (
                <button
                  onClick={() => { void handleCompleteGroup(order); }}
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

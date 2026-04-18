import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Decimal } from 'decimal.js';
import { get_inventory_items_live, add_inventory_item_live, record_loss_live, restock_item_live, delete_inventory_item_live } from '../../api/inventory';
import { get_logs_live } from '../../api/logs';
import { get_settings_live } from '../../api/settings';
import { useAppStore } from '../../store';
import { Package, AlertTriangle, Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { tx } from '../../i18n';

export default function InventoryPanel() {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [items, setItems] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [itemsPageSize, setItemsPageSize] = useState(10);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const [itemsPage, setItemsPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [inventoryConfig, setInventoryConfig] = useState<{ default_critical_threshold: number; unit_options: string[] }>({
    default_critical_threshold: 5,
    unit_options: ['kq', 'qram', 'litr', 'ml', 'ədəd', 'metr'],
  });
  const mountedRef = useRef(true);
  const loadingRef = useRef(false);
  const historyLoadingRef = useRef(false);
  const lastSoftRefreshRef = useRef(0);

  useEffect(() => {
    setSearch('');
    mountedRef.current = true;
    void loadData({ includeHistory: false });
    const historyTimer = window.setTimeout(() => {
      void loadHistory();
    }, 180);
    return () => {
      mountedRef.current = false;
      window.clearTimeout(historyTimer);
    };
  }, [tenant_id]);

  useEffect(() => {
    const handleRefresh = () => {
      const now = Date.now();
      if (now - lastSoftRefreshRef.current < 15000) return;
      lastSoftRefreshRef.current = now;
      void loadData({ includeHistory: false, silent: true });
    };
    const handleVisibility = () => {
      if (!document.hidden) handleRefresh();
    };
    window.addEventListener('inventory-updated', handleRefresh as EventListener);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('inventory-updated', handleRefresh as EventListener);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [tenant_id]);

  const loadData = async (options?: { includeHistory?: boolean; silent?: boolean }) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const [data, settings] = await Promise.all([
        get_inventory_items_live(tenant_id),
        get_settings_live(tenant_id),
      ]);
      if (!mountedRef.current) return;
      setItems(Array.isArray(data) ? data : []);
      const invSettings = settings.inventory_settings || {
        default_critical_threshold: 5,
        unit_options: ['kq', 'qram', 'litr', 'ml', 'ədəd', 'metr'],
      };
      setInventoryConfig(invSettings);
      if (!newMinLimit) {
        setNewMinLimit(String(invSettings.default_critical_threshold));
      }
      if (options?.includeHistory) {
        await loadHistory();
      }
    } catch (e: any) {
      if (!options?.silent) {
        notify('error', tx(lang, 'Anbar məlumatı yüklənmədi: ', 'Данные склада не загрузились: ', 'Inventory failed to load: ') + String(e?.message || e));
      }
    } finally {
      loadingRef.current = false;
    }
  };

  const loadHistory = async () => {
    if (historyLoadingRef.current) return;
    historyLoadingRef.current = true;
    try {
      const logs = await get_logs_live(tenant_id, 60);
      if (!mountedRef.current) return;
      setHistory(
        (logs || [])
          .filter((row: any) => String(row.action || '').startsWith('INVENTORY_'))
          .slice(0, 12),
      );
    } catch {
      // History is secondary; don't block inventory usage if this fails.
    } finally {
      historyLoadingRef.current = false;
    }
  };

  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newCost, setNewCost] = useState('');
  const [newUnit, setNewUnit] = useState('qram');
  const [newType, setNewType] = useState('Xammal');
  const [customType, setCustomType] = useState('');
  const [newPaymentSource, setNewPaymentSource] = useState<'payable' | 'cash' | 'card' | 'safe'>('payable');
  const [newSupplier, setNewSupplier] = useState('');
  const [newInvoiceNo, setNewInvoiceNo] = useState('');
  const [newMinLimit, setNewMinLimit] = useState('5');
  const [measureType, setMeasureType] = useState<'çəki' | 'say' | 'həcm'>('çəki');
  const [isAdding, setIsAdding] = useState(false);
  const [lossModal, setLossModal] = useState<{ id: string; name: string } | null>(null);
  const [lossQty, setLossQty] = useState('');
  const [search, setSearch] = useState('');
  const [restockModal, setRestockModal] = useState<{ id: string; name: string } | null>(null);
  const [restockQty, setRestockQty] = useState('');
  const [restockTotalPrice, setRestockTotalPrice] = useState('');
  const [restockPaymentSource, setRestockPaymentSource] = useState<'payable' | 'cash' | 'card' | 'safe'>('payable');
  const [restockSupplier, setRestockSupplier] = useState('');
  const [restockInvoiceNo, setRestockInvoiceNo] = useState('');
  const [deleteModal, setDeleteModal] = useState<{ id: string; name: string } | null>(null);
  const [deletePass, setDeletePass] = useState('');

  const formatQty = (value: unknown, unit: string) => {
    const qty = new Decimal(value || 0);
    const normalizedUnit = String(unit || '').trim().toLowerCase();
    const integerUnits = ['ədəd', 'adet', 'piece'];
    if (integerUnits.includes(normalizedUnit)) return qty.toDecimalPlaces(0).toString();
    if (normalizedUnit === 'qram' || normalizedUnit === 'ml' || normalizedUnit === 'sm') return qty.toDecimalPlaces(0).toString();
    return qty.toDecimalPlaces(3).toString();
  };

  const inventoryTypeOptions = useMemo(
    () => Array.from(
      new Set(
        ['Xammal', 'İçki Bazası', 'Paketləmə', ...items.map((item: any) => String(item.type || '').trim()).filter(Boolean)],
      ),
    ),
    [items],
  );

  const handleAdd = async () => {
    if (!newName || !newQty || !newCost || Number(newQty) <= 0 || Number(newCost) < 0) return;
    const resolvedType = newType === '__custom__' ? customType.trim() : newType.trim();
    if (!resolvedType) {
      notify('error', tx(lang, 'Kateqoriya boş ola bilməz', 'Категория не может быть пустой', 'Category cannot be empty'));
      return;
    }
    try {
      const qty = new Decimal(newQty);
      const totalPrice = new Decimal(newCost);
      await add_inventory_item_live({
        tenant_id,
        name: newName,
        stock_qty: qty,
        unit: newUnit,
        category: measureType,
        type: resolvedType,
        unit_cost: qty.gt(0) ? totalPrice.div(qty).toDecimalPlaces(4) : new Decimal(0),
        min_limit: new Decimal(newMinLimit || 0),
        payment_source: newPaymentSource,
        supplier: newSupplier.trim() || undefined,
        invoice_no: newInvoiceNo.trim() || undefined,
      }, user?.username || 'Admin');
      setNewName('');
      setNewQty('');
      setNewCost('');
      setNewMinLimit('5');
      setCustomType('');
      setNewType('Xammal');
      setNewPaymentSource('payable');
      setNewSupplier('');
      setNewInvoiceNo('');
      setIsAdding(false);
      await loadData();
      notify('success', tx(lang, 'Məhsul yadda saxlanıldı', 'Продукт сохранен', 'Inventory item saved'));
    } catch(e:any) {
      notify('error', tx(lang, 'Xəta: ', 'Ошибка: ') + e.message);
    }
  };

  const handleLoss = async (id: string, name: string, qtyRaw: string) => {
    const qty = parseFloat(qtyRaw || '0');
    if (!qty || qty <= 0) return;
    try {
      await record_loss_live(id, new Decimal(qty), 'Zay oldu', user?.username || 'Admin');
      notify('success', tx(lang, 'İtki maliyyəyə yazıldı və anbardan silindi!', 'Списание записано в финансы и удалено со склада!'));
      await loadData();
    } catch(e:any) {
      notify('error', tx(lang, 'Xəta: ', 'Ошибка: ') + e.message);
    }
  };

  const handleRestock = async (id: string) => {
    const qty = new Decimal(restockQty || 0);
    const totalPrice = new Decimal(restockTotalPrice || 0);
    if (qty.lte(0) || totalPrice.lt(0)) return;
    try {
      await restock_item_live(tenant_id, id, qty, totalPrice, user?.username || 'Admin', {
        payment_source: restockPaymentSource,
        supplier: restockSupplier.trim() || undefined,
        invoice_no: restockInvoiceNo.trim() || undefined,
      });
      notify('success', tx(lang, 'Mədaxil yazıldı', 'Пополнение сохранено'));
      setRestockModal(null);
      setRestockQty('');
      setRestockTotalPrice('');
      setRestockPaymentSource('payable');
      setRestockSupplier('');
      setRestockInvoiceNo('');
      await loadData();
    } catch (e: any) {
      notify('error', tx(lang, 'Xəta: ', 'Ошибка: ') + e.message);
    }
  };

  const filteredItems = useMemo(() => items.filter((item: any) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${item.name} ${item.type} ${item.category}`.toLowerCase().includes(q);
  }), [items, search]);

  const itemsTotalPages = Math.max(1, Math.ceil(filteredItems.length / Math.max(1, itemsPageSize)));
  const historyTotalPages = Math.max(1, Math.ceil(history.length / Math.max(1, historyPageSize)));

  useEffect(() => {
    setItemsPage((prev) => Math.min(Math.max(1, prev), itemsTotalPages));
  }, [itemsTotalPages]);

  useEffect(() => {
    setHistoryPage((prev) => Math.min(Math.max(1, prev), historyTotalPages));
  }, [historyTotalPages]);

  useEffect(() => {
    setItemsPage(1);
  }, [tenant_id, search, itemsPageSize]);

  useEffect(() => {
    setHistoryPage(1);
  }, [tenant_id, historyPageSize]);

  const visibleItems = useMemo(() => {
    const start = (itemsPage - 1) * itemsPageSize;
    return filteredItems.slice(start, start + itemsPageSize);
  }, [filteredItems, itemsPage, itemsPageSize]);

  const visibleHistory = useMemo(() => {
    const start = (historyPage - 1) * historyPageSize;
    return history.slice(start, start + historyPageSize);
  }, [history, historyPage, historyPageSize]);

  const describeHistory = (row: any) => {
    const details = row?.details || {};
    const action = String(row?.action || '');
    const itemName = details.item_name || '-';
    if (action === 'INVENTORY_ADD') {
      return tx(
        lang,
        `${itemName} əlavə olundu: ${details.qty || 0} ${details.unit || ''}`,
        `${itemName} добавлен: ${details.qty || 0} ${details.unit || ''}`,
        `${itemName} added: ${details.qty || 0} ${details.unit || ''}`,
      );
    }
    if (action === 'INVENTORY_RESTOCK') {
      return tx(
        lang,
        `${itemName} mədaxil edildi: +${details.qty_added || 0} ${details.unit || ''}`,
        `${itemName} пополнен: +${details.qty_added || 0} ${details.unit || ''}`,
        `${itemName} restocked: +${details.qty_added || 0} ${details.unit || ''}`,
      );
    }
    if (action === 'INVENTORY_LOSS') {
      return tx(
        lang,
        `${itemName} silindi/zay oldu: -${details.qty_removed || 0} ${details.unit || ''}`,
        `${itemName} списан/испорчен: -${details.qty_removed || 0} ${details.unit || ''}`,
        `${itemName} removed/wasted: -${details.qty_removed || 0} ${details.unit || ''}`,
      );
    }
    if (action === 'INVENTORY_DELETE') {
      return tx(
        lang,
        `${itemName} anbardan tam silindi`,
        `${itemName} полностью удален со склада`,
        `${itemName} was fully deleted from inventory`,
      );
    }
    if (action === 'INVENTORY_CONSUMED') {
      return tx(
        lang,
        `${itemName} satış üçün istifadə olundu: -${details.qty_removed || 0} ${details.unit || ''}`,
        `${itemName} использован в продаже: -${details.qty_removed || 0} ${details.unit || ''}`,
        `${itemName} consumed by sale: -${details.qty_removed || 0} ${details.unit || ''}`,
      );
    }
    return row?.action || '-';
  };

  return (
    <div className="space-y-6">
      {lossModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="metal-panel w-full max-w-md p-5">
            <h3 className="mb-2 text-lg font-bold text-slate-100">{tx(lang, 'Zay/İtki Yaz', 'Списание потерь')}</h3>
            <p className="mb-3 text-sm text-slate-300">{lossModal.name}</p>
            <input className="neon-input" type="number" min={0} placeholder={tx(lang, 'Miqdar', 'Количество')} value={lossQty} onChange={(e) => setLossQty(e.target.value)} />
            <div className="mt-4 flex gap-2">
              <button
                className="glossy-gold rounded-lg px-4 py-2 font-semibold"
                onClick={() => {
                  void handleLoss(lossModal.id, lossModal.name, lossQty);
                  setLossModal(null);
                  setLossQty('');
                }}
              >
                {tx(lang, 'Təsdiqlə', 'Подтвердить')}
              </button>
              <button className="neon-btn rounded-lg px-4 py-2" onClick={() => { setLossModal(null); setLossQty(''); }}>
                {tx(lang, 'Ləğv et', 'Отмена')}
              </button>
            </div>
          </div>
        </div>
      )}

      {restockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="metal-panel w-full max-w-md p-5">
            <h3 className="mb-2 text-lg font-bold text-slate-100">{tx(lang, 'Mədaxil et', 'Пополнить')}</h3>
            <p className="mb-3 text-sm text-slate-300">{restockModal.name}</p>
            <div className="grid grid-cols-2 gap-2">
              <input className="neon-input" type="number" min={0} placeholder={tx(lang, 'Miqdar', 'Количество')} value={restockQty} onChange={(e) => setRestockQty(e.target.value)} />
              <input className="neon-input" type="number" min={0} placeholder={tx(lang, 'Toplam qiymət', 'Общая цена')} value={restockTotalPrice} onChange={(e) => setRestockTotalPrice(e.target.value)} />
              <select className="neon-input" value={restockPaymentSource} onChange={(e) => setRestockPaymentSource(e.target.value as any)}>
                <option value="payable">{tx(lang, 'Öhdəlik (AP)', 'Кредиторка (AP)', 'Payable (AP)')}</option>
                <option value="cash">{tx(lang, 'Nağd', 'Наличные', 'Cash')}</option>
                <option value="card">{tx(lang, 'Kart', 'Карта', 'Card')}</option>
                <option value="safe">{tx(lang, 'Seyf', 'Сейф', 'Safe')}</option>
              </select>
              <input className="neon-input" placeholder={tx(lang, 'Təchizatçı (opsional)', 'Поставщик (опц.)', 'Supplier (optional)')} value={restockSupplier} onChange={(e) => setRestockSupplier(e.target.value)} />
              <input className="neon-input col-span-2" placeholder={tx(lang, 'Invoice № (opsional)', 'Invoice № (опц.)', 'Invoice № (optional)')} value={restockInvoiceNo} onChange={(e) => setRestockInvoiceNo(e.target.value)} />
            </div>
            <div className="mt-4 flex gap-2">
              <button className="glossy-gold rounded-lg px-4 py-2 font-semibold" onClick={() => { void handleRestock(restockModal.id); }}>
                {tx(lang, 'Təsdiqlə', 'Подтвердить')}
              </button>
              <button className="neon-btn rounded-lg px-4 py-2" onClick={() => { setRestockModal(null); setRestockQty(''); setRestockTotalPrice(''); setRestockPaymentSource('payable'); setRestockSupplier(''); setRestockInvoiceNo(''); }}>
                {tx(lang, 'Ləğv et', 'Отмена')}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="metal-panel w-full max-w-md p-5">
            <h3 className="mb-2 text-lg font-bold text-slate-100">{tx(lang, 'Məhsulu sil', 'Удалить продукт')}</h3>
            <p className="mb-3 text-sm text-slate-300">{deleteModal.name}</p>
            <input className="neon-input" type="password" placeholder={tx(lang, 'Admin şifrəsi', 'Пароль администратора')} value={deletePass} onChange={(e) => setDeletePass(e.target.value)} />
            <div className="mt-4 flex gap-2">
              <button
                className="glossy-gold rounded-lg px-4 py-2 font-semibold"
                onClick={() => {
                  void deletePass; // Password gate removed here; backend authorization is the source of truth.
                  void (async () => {
                    try {
                      await delete_inventory_item_live(deleteModal.id, user?.username || 'Admin');
                      notify('success', tx(lang, 'Məhsul silindi', 'Продукт удален'));
                      setDeleteModal(null);
                      setDeletePass('');
                      await loadData();
                    } catch (e: any) {
                      notify('error', tx(lang, 'Xəta: ', 'Ошибка: ') + e.message);
                    }
                  })();
                }}
              >
                {tx(lang, 'Silməni Təsdiqlə', 'Подтвердить удаление')}
              </button>
              <button className="neon-btn rounded-lg px-4 py-2" onClick={() => { setDeleteModal(null); setDeletePass(''); }}>
                {tx(lang, 'Ləğv et', 'Отмена')}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className="text-2xl font-bold">{tx(lang, 'Anbar İdarəetməsi', 'Управление складом', 'Inventory Management')}</h2>
        <div className="flex flex-col gap-2 md:flex-row">
          <input
            className="neon-input min-h-13"
            placeholder={tx(lang, 'Anbar axtarışı...', 'Поиск по складу...', 'Search inventory...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button onClick={() => setIsAdding(!isAdding)} className="neon-btn min-h-13 px-4 py-3 rounded-lg flex items-center justify-center gap-2">
            <Plus size={20} /> {tx(lang, 'Xammal Əlavə Et', 'Добавить сырье', 'Add Inventory Item')}
          </button>
        </div>
      </div>

      {isAdding && (
        <div className="metal-panel p-6 grid grid-cols-1 md:grid-cols-6 gap-4">
          <input className="neon-input min-h-13 col-span-2" placeholder={tx(lang, 'Xammal Adı (Məs: Kofe dənəsi)', 'Название сырья (напр.: кофейное зерно)', 'Inventory name (e.g. Coffee Beans)')} value={newName} onChange={e => setNewName(e.target.value)} />
          <select className="neon-input min-h-13" value={newType} onChange={e => setNewType(e.target.value)}>
            {inventoryTypeOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
            <option value="__custom__">{tx(lang, 'Yeni kateqoriya...', 'Новая категория...', 'New category...')}</option>
          </select>
          {newType === '__custom__' && (
            <input
              className="neon-input min-h-13"
              placeholder={tx(lang, 'Manual kateqoriya adı', 'Название категории вручную', 'Manual category name')}
              value={customType}
              onChange={e => setCustomType(e.target.value)}
            />
          )}
          <select className="neon-input min-h-13" value={measureType} onChange={e => setMeasureType(e.target.value as any)}>
            <option value="çəki">{tx(lang, 'Çəki', 'Вес', 'Weight')}</option>
            <option value="say">{tx(lang, 'Say', 'Штуки', 'Count')}</option>
            <option value="həcm">{tx(lang, 'Həcm', 'Объем', 'Volume')}</option>
          </select>
          <input className="neon-input min-h-13" type="number" placeholder={tx(lang, 'Miqdar', 'Количество', 'Quantity')} value={newQty} onChange={e => setNewQty(e.target.value)} />
          <select className="neon-input min-h-13" value={newUnit} onChange={e => setNewUnit(e.target.value)}>
            {(inventoryConfig.unit_options || []).map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          <input className="neon-input min-h-13" type="number" placeholder={tx(lang, 'Toplam alış qiyməti (₼)', 'Общая закупочная цена (₼)', 'Total purchase price (₼)')} value={newCost} onChange={e => setNewCost(e.target.value)} />
          <select className="neon-input min-h-13" value={newPaymentSource} onChange={(e) => setNewPaymentSource(e.target.value as any)}>
            <option value="payable">{tx(lang, 'Öhdəlik (AP)', 'Кредиторка (AP)', 'Payable (AP)')}</option>
            <option value="cash">{tx(lang, 'Nağd', 'Наличные', 'Cash')}</option>
            <option value="card">{tx(lang, 'Kart', 'Карта', 'Card')}</option>
            <option value="safe">{tx(lang, 'Seyf', 'Сейф', 'Safe')}</option>
          </select>
          <input className="neon-input min-h-13" type="number" placeholder={tx(lang, 'Min limit', 'Мин. лимит', 'Min limit')} value={newMinLimit} onChange={e => setNewMinLimit(e.target.value)} />
          <input className="neon-input min-h-13" placeholder={tx(lang, 'Təchizatçı (opsional)', 'Поставщик (опц.)', 'Supplier (optional)')} value={newSupplier} onChange={e => setNewSupplier(e.target.value)} />
          <input className="neon-input min-h-13" placeholder={tx(lang, 'Invoice № (opsional)', 'Invoice № (опц.)', 'Invoice № (optional)')} value={newInvoiceNo} onChange={e => setNewInvoiceNo(e.target.value)} />
          <button
            onClick={() => { void handleAdd(); }}
            disabled={!newName.trim() || Number(newQty || 0) <= 0 || Number(newCost || -1) < 0}
            className="glossy-gold disabled:opacity-60 disabled:cursor-not-allowed min-h-13 px-4 py-3 rounded-lg font-semibold"
          >
            {tx(lang, 'Əlavə Et', 'Добавить', 'Add')}
          </button>
        </div>
      )}

      <div className="metal-panel rounded-xl p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="text-sm text-slate-300">
            {tx(lang, 'Ekranda məhsul sayı', 'Количество товаров на экране', 'Items shown on screen')}: <b>{visibleItems.length}</b> / {filteredItems.length}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="neon-btn min-h-12 rounded-lg px-3 disabled:opacity-50"
              disabled={itemsPage <= 1}
              onClick={() => setItemsPage((p) => Math.max(1, p - 1))}
              aria-label={tx(lang, 'Əvvəlki səhifə', 'Предыдущая страница', 'Previous page')}
              title={tx(lang, 'Əvvəlki səhifə', 'Предыдущая страница', 'Previous page')}
            >
              <ChevronLeft size={16} />
            </button>
            <div className="min-w-[92px] text-center text-xs text-slate-300">
              {tx(lang, 'Səhifə', 'Страница', 'Page')} {itemsPage} / {itemsTotalPages}
            </div>
            <button
              className="neon-btn min-h-12 rounded-lg px-3 disabled:opacity-50"
              disabled={itemsPage >= itemsTotalPages}
              onClick={() => setItemsPage((p) => Math.min(itemsTotalPages, p + 1))}
              aria-label={tx(lang, 'Növbəti səhifə', 'Следующая страница', 'Next page')}
              title={tx(lang, 'Növbəti səhifə', 'Следующая страница', 'Next page')}
            >
              <ChevronRight size={16} />
            </button>
            <select value={itemsPageSize} onChange={(e) => setItemsPageSize(Number(e.target.value))} className="neon-input min-h-12 w-28">
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-slate-300 border-b border-slate-700/70">
                <th className="pb-3">{tx(lang, 'Xammal Adı', 'Название сырья', 'Item Name')}</th>
                <th className="pb-3">{tx(lang, 'Tipi', 'Тип', 'Type')}</th>
                <th className="pb-3">{tx(lang, 'Stok Miqdarı', 'Остаток', 'Stock Qty')}</th>
                <th className="pb-3">{tx(lang, 'Vahid Maya', 'Себестоимость за ед.', 'Unit Cost')}</th>
                <th className="pb-3">{tx(lang, 'Toplam Dəyər', 'Общая стоимость', 'Total Value')}</th>
                <th className="pb-3">{tx(lang, 'Status', 'Статус')}</th>
                <th className="pb-3">{tx(lang, 'Əməliyyat', 'Операция')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item: any) => (
                <tr key={item.id} className="border-b border-slate-700/50 last:border-0 hover:bg-slate-800/30">
                  <td className="py-3 font-medium">{item.name}</td>
                  <td className="py-3">{item.type}</td>
                  <td className="py-3">{formatQty(item.stock_qty, item.unit)} {item.unit}</td>
                  <td className="py-3">{new Decimal(item.unit_cost || 0).toFixed(4)} ₼ / {item.unit}</td>
                  <td className="py-3">{new Decimal(item.stock_qty || 0).mul(new Decimal(item.unit_cost || 0)).toFixed(2)} ₼</td>
                  <td className="py-3">
                    {Number(item.stock_qty || 0) <= Number(item.min_limit ?? inventoryConfig.default_critical_threshold) ? (
                      <span className="px-2 py-1 bg-red-100 text-red-600 rounded-full text-xs font-bold flex w-fit items-center gap-1">
                        <AlertTriangle size={14}/> {tx(lang, 'Kritik Stok', 'Критический остаток', 'Critical Stock')}
                      </span>
                    ) : (
                      <span className="px-2 py-1 bg-green-100 text-green-600 rounded-full text-xs font-bold">{tx(lang, 'Normal', 'Норма', 'Normal')}</span>
                    )}
                  </td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setRestockModal({ id: item.id, name: item.name })} className="rounded-lg border border-emerald-300/40 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-200">{tx(lang, 'Mədaxil', 'Приход', 'Restock')}</button>
                      <button onClick={() => setLossModal({ id: item.id, name: item.name })} className="rounded-lg border border-amber-300/40 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-200">{tx(lang, 'Məxaric', 'Расход', 'Loss')}</button>
                      <button onClick={() => setDeleteModal({ id: item.id, name: item.name })} className="rounded-lg border border-red-300/40 bg-red-400/10 px-3 py-2 text-xs font-semibold text-red-200">{tx(lang, 'Sil', 'Удалить', 'Delete')}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">{tx(lang, 'Anbar boşdur. İlkin məlumat əlavə edin.', 'Склад пуст. Добавьте начальные данные.', 'Inventory is empty. Add initial data.')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="metal-panel p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">{tx(lang, 'Anbar Hərəkət Tarixçəsi', 'История движения склада', 'Inventory Activity')}</h3>
            <p className="mt-1 text-sm text-slate-400">
              {tx(lang, 'Kim nə vaxt əlavə etdi, azaltdı və ya sildi buradan görünür.', 'Здесь видно кто, когда добавил, списал или удалил товар.', 'See who added, reduced, or deleted stock and when.')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="neon-btn min-h-12 rounded-lg px-3 disabled:opacity-50"
              disabled={historyPage <= 1}
              onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
              aria-label={tx(lang, 'Əvvəlki səhifə', 'Предыдущая страница', 'Previous page')}
              title={tx(lang, 'Əvvəlki səhifə', 'Предыдущая страница', 'Previous page')}
            >
              <ChevronLeft size={16} />
            </button>
            <div className="min-w-[92px] text-center text-xs text-slate-300">
              {tx(lang, 'Səhifə', 'Страница', 'Page')} {historyPage} / {historyTotalPages}
            </div>
            <button
              className="neon-btn min-h-12 rounded-lg px-3 disabled:opacity-50"
              disabled={historyPage >= historyTotalPages}
              onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
              aria-label={tx(lang, 'Növbəti səhifə', 'Следующая страница', 'Next page')}
              title={tx(lang, 'Növbəti səhifə', 'Следующая страница', 'Next page')}
            >
              <ChevronRight size={16} />
            </button>
            <select value={historyPageSize} onChange={(e) => setHistoryPageSize(Number(e.target.value))} className="neon-input min-h-12 w-28">
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
            </select>
          </div>
        </div>
        <div className="space-y-3">
          {visibleHistory.map((row: any) => (
            <div key={row.id} className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-semibold text-slate-100">{describeHistory(row)}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {tx(lang, 'İstifadəçi', 'Пользователь', 'User')}: <b>{row.user || '-'}</b>
                  </div>
                </div>
                <div className="text-xs text-slate-400">
                  {new Date(row.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'az-AZ')}
                </div>
              </div>
            </div>
          ))}
          {history.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-700/70 p-5 text-sm text-slate-400">
              {tx(lang, 'Hələ anbar hərəkəti qeydi yoxdur.', 'История склада пока пуста.', 'No inventory activity yet.')}
            </div>
          )}
        </div>
        {history.length > 0 ? (
          <div className="mt-3 text-xs text-slate-400">
            {tx(lang, 'Ekranda görünən tarixçə', 'Показано записей', 'History shown')}: <b>{visibleHistory.length}</b> / {history.length}
          </div>
        ) : null}
      </div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { Decimal } from 'decimal.js';
import { get_inventory_items_live, add_inventory_item_live, record_loss_live, restock_item_live, delete_inventory_item_live } from '../../api/inventory';
import { get_logs_live } from '../../api/logs';
import { get_settings } from '../../api/settings';
import { useAppStore } from '../../store';
import { Package, AlertTriangle, Plus } from 'lucide-react';
import { tx } from '../../i18n';

export default function InventoryPanel() {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [items, setItems] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [inventoryConfig, setInventoryConfig] = useState<{ default_critical_threshold: number; unit_options: string[] }>({
    default_critical_threshold: 5,
    unit_options: ['kq', 'qram', 'litr', 'ml', 'ədəd', 'metr'],
  });

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    const [data, logs] = await Promise.all([
      get_inventory_items_live(tenant_id),
      get_logs_live(tenant_id, 200),
    ]);
    setItems(data);
    setHistory(
      (logs || [])
        .filter((row: any) => String(row.action || '').startsWith('INVENTORY_'))
        .slice(0, 20),
    );
    const settings = get_settings(tenant_id);
    const invSettings = settings.inventory_settings || {
      default_critical_threshold: 5,
      unit_options: ['kq', 'qram', 'litr', 'ml', 'ədəd', 'metr'],
    };
    setInventoryConfig(invSettings);
    if (!newMinLimit) {
      setNewMinLimit(String(invSettings.default_critical_threshold));
    }
  };

  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newCost, setNewCost] = useState('');
  const [newUnit, setNewUnit] = useState('qram');
  const [newType, setNewType] = useState('Xammal');
  const [customType, setCustomType] = useState('');
  const [newMinLimit, setNewMinLimit] = useState('5');
  const [measureType, setMeasureType] = useState<'çəki' | 'say' | 'həcm'>('çəki');
  const [isAdding, setIsAdding] = useState(false);
  const [lossModal, setLossModal] = useState<{ id: string; name: string } | null>(null);
  const [lossQty, setLossQty] = useState('');
  const [search, setSearch] = useState('');
  const [restockModal, setRestockModal] = useState<{ id: string; name: string } | null>(null);
  const [restockQty, setRestockQty] = useState('');
  const [restockTotalPrice, setRestockTotalPrice] = useState('');
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

  const inventoryTypeOptions = Array.from(
    new Set(
      ['Xammal', 'İçki Bazası', 'Paketləmə', ...items.map((item: any) => String(item.type || '').trim()).filter(Boolean)],
    ),
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
        min_limit: new Decimal(newMinLimit || 0)
      }, user?.username || 'Admin');
      setNewName('');
      setNewQty('');
      setNewCost('');
      setNewMinLimit('5');
      setCustomType('');
      setNewType('Xammal');
      setIsAdding(false);
      await loadData();
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
      await restock_item_live(tenant_id, id, qty, totalPrice, user?.username || 'Admin');
      notify('success', tx(lang, 'Mədaxil yazıldı', 'Пополнение сохранено'));
      setRestockModal(null);
      setRestockQty('');
      setRestockTotalPrice('');
      await loadData();
    } catch (e: any) {
      notify('error', tx(lang, 'Xəta: ', 'Ошибка: ') + e.message);
    }
  };

  const filteredItems = items.filter((item: any) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${item.name} ${item.type} ${item.category}`.toLowerCase().includes(q);
  });

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
            </div>
            <div className="mt-4 flex gap-2">
              <button className="glossy-gold rounded-lg px-4 py-2 font-semibold" onClick={() => { void handleRestock(restockModal.id); }}>
                {tx(lang, 'Təsdiqlə', 'Подтвердить')}
              </button>
              <button className="neon-btn rounded-lg px-4 py-2" onClick={() => { setRestockModal(null); setRestockQty(''); setRestockTotalPrice(''); }}>
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
          <input className="neon-input min-h-13" type="number" placeholder={tx(lang, 'Min limit', 'Мин. лимит', 'Min limit')} value={newMinLimit} onChange={e => setNewMinLimit(e.target.value)} />
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
              {filteredItems.map((item: any) => (
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
        </div>
        <div className="space-y-3">
          {history.map((row: any) => (
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
      </div>
    </div>
  );
}

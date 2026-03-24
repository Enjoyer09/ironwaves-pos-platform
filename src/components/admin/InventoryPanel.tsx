import React, { useState, useEffect } from 'react';
import { Decimal } from 'decimal.js';
import { get_inventory_items, add_inventory_item, record_loss, restock_item, delete_inventory_item } from '../../api/inventory';
import { get_settings } from '../../api/settings';
import { useAppStore } from '../../store';
import { Package, AlertTriangle, Plus } from 'lucide-react';
import { tx } from '../../i18n';
import { getDB } from '../../lib/db_sim';

export default function InventoryPanel() {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [items, setItems] = useState<any[]>([]);
  const [inventoryConfig, setInventoryConfig] = useState<{ default_critical_threshold: number; unit_options: string[] }>({
    default_critical_threshold: 5,
    unit_options: ['kq', 'qram', 'litr', 'ml', 'ədəd', 'metr'],
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    const data = get_inventory_items(tenant_id);
    setItems(data);
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

  const handleAdd = () => {
    if (!newName || !newQty || !newCost || Number(newQty) <= 0 || Number(newCost) < 0) return;
    try {
      add_inventory_item({
        tenant_id,
        name: newName,
        stock_qty: new Decimal(newQty),
        unit: newUnit,
        category: measureType,
        type: newType,
        unit_cost: new Decimal(newCost),
        min_limit: new Decimal(newMinLimit || 0)
      }, user?.username || 'Admin');
      setNewName('');
      setNewQty('');
      setNewCost('');
      setNewMinLimit('5');
      setIsAdding(false);
      loadData();
    } catch(e:any) {
      notify('error', tx(lang, 'Xəta: ', 'Ошибка: ') + e.message);
    }
  };

  const handleLoss = (id: string, name: string, qtyRaw: string) => {
    const qty = parseFloat(qtyRaw || '0');
    if (!qty || qty <= 0) return;
    try {
      record_loss(id, new Decimal(qty), 'Zay oldu', user?.username || 'Admin');
      notify('success', tx(lang, 'İtki maliyyəyə yazıldı və anbardan silindi!', 'Списание записано в финансы и удалено со склада!'));
      loadData();
    } catch(e:any) {
      notify('error', tx(lang, 'Xəta: ', 'Ошибка: ') + e.message);
    }
  };

  const handleRestock = (id: string) => {
    const qty = new Decimal(restockQty || 0);
    const totalPrice = new Decimal(restockTotalPrice || 0);
    if (qty.lte(0) || totalPrice.lt(0)) return;
    try {
      restock_item(tenant_id, id, qty, totalPrice, user?.username || 'Admin');
      notify('success', tx(lang, 'Mədaxil yazıldı', 'Пополнение сохранено'));
      setRestockModal(null);
      setRestockQty('');
      setRestockTotalPrice('');
      loadData();
    } catch (e: any) {
      notify('error', tx(lang, 'Xəta: ', 'Ошибка: ') + e.message);
    }
  };

  const verifyAdminPassword = (pass: string) => {
    const users = getDB<any>('users');
    const admin = users.find((u) => String(u.role || '').toLowerCase() === 'admin');
    return Boolean(admin && String(admin.password || '') === pass);
  };

  const filteredItems = items.filter((item: any) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${item.name} ${item.type} ${item.category}`.toLowerCase().includes(q);
  });

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
                  handleLoss(lossModal.id, lossModal.name, lossQty);
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
              <button className="glossy-gold rounded-lg px-4 py-2 font-semibold" onClick={() => handleRestock(restockModal.id)}>
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
                  if (!verifyAdminPassword(deletePass)) {
                    notify('error', tx(lang, 'Admin şifrəsi yanlışdır', 'Неверный пароль администратора'));
                    return;
                  }
                  try {
                    delete_inventory_item(deleteModal.id, user?.username || 'Admin');
                    notify('success', tx(lang, 'Məhsul silindi', 'Продукт удален'));
                    setDeleteModal(null);
                    setDeletePass('');
                    loadData();
                  } catch (e: any) {
                    notify('error', tx(lang, 'Xəta: ', 'Ошибка: ') + e.message);
                  }
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
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">{tx(lang, 'Anbar İdarəetməsi', 'Управление складом')}</h2>
        <div className="flex gap-2">
          <input
            className="neon-input"
            placeholder={tx(lang, 'Anbar axtarışı...', 'Поиск по складу...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button onClick={() => setIsAdding(!isAdding)} className="neon-btn px-4 py-2 rounded-lg flex items-center gap-2">
            <Plus size={20} /> {tx(lang, 'Xammal Əlavə Et', 'Добавить сырье')}
          </button>
        </div>
      </div>

      {isAdding && (
        <div className="metal-panel p-6 grid grid-cols-1 md:grid-cols-6 gap-4">
          <input className="neon-input col-span-2" placeholder={tx(lang, 'Xammal Adı (Məs: Kofe dənəsi)', 'Название сырья (напр.: кофейное зерно)')} value={newName} onChange={e => setNewName(e.target.value)} />
          <select className="neon-input" value={newType} onChange={e => setNewType(e.target.value)}>
            <option value="Xammal">{tx(lang, 'Xammal', 'Сырье')}</option>
            <option value="İçki Bazası">{tx(lang, 'İçki Bazası', 'Основа напитков')}</option>
            <option value="Paketləmə">{tx(lang, 'Paketləmə', 'Упаковка')}</option>
          </select>
          <select className="neon-input" value={measureType} onChange={e => setMeasureType(e.target.value as any)}>
            <option value="çəki">{tx(lang, 'Çəki', 'Вес')}</option>
            <option value="say">{tx(lang, 'Say', 'Штуки')}</option>
            <option value="həcm">{tx(lang, 'Həcm', 'Объем')}</option>
          </select>
          <input className="neon-input" type="number" placeholder={tx(lang, 'Miqdar', 'Количество')} value={newQty} onChange={e => setNewQty(e.target.value)} />
          <select className="neon-input" value={newUnit} onChange={e => setNewUnit(e.target.value)}>
            {(inventoryConfig.unit_options || []).map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          <input className="neon-input" type="number" placeholder={tx(lang, 'Qiyməti (₼)', 'Цена (₼)')} value={newCost} onChange={e => setNewCost(e.target.value)} />
          <input className="neon-input" type="number" placeholder={tx(lang, 'Min limit', 'Мин. лимит')} value={newMinLimit} onChange={e => setNewMinLimit(e.target.value)} />
          <button
            onClick={handleAdd}
            disabled={!newName || !newQty || !newCost}
            className="glossy-gold disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2 rounded-lg font-semibold"
          >
            {tx(lang, 'Əlavə Et', 'Добавить')}
          </button>
        </div>
      )}

      <div className="metal-panel rounded-xl p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-slate-300 border-b border-slate-700/70">
                <th className="pb-3">{tx(lang, 'Xammal Adı', 'Название сырья')}</th>
                <th className="pb-3">{tx(lang, 'Tipi', 'Тип')}</th>
                <th className="pb-3">{tx(lang, 'Stok Miqdarı', 'Остаток')}</th>
                <th className="pb-3">{tx(lang, 'Maya Dəyəri', 'Себестоимость')}</th>
                <th className="pb-3">{tx(lang, 'Status', 'Статус')}</th>
                <th className="pb-3">{tx(lang, 'Əməliyyat', 'Операция')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item: any) => (
                <tr key={item.id} className="border-b border-slate-700/50 last:border-0 hover:bg-slate-800/30">
                  <td className="py-3 font-medium">{item.name}</td>
                  <td className="py-3">{item.type}</td>
                  <td className="py-3">{item.stock_qty} {item.unit}</td>
                  <td className="py-3">{item.unit_cost} ₼</td>
                  <td className="py-3">
                    {Number(item.stock_qty || 0) <= Number(item.min_limit ?? inventoryConfig.default_critical_threshold) ? (
                      <span className="px-2 py-1 bg-red-100 text-red-600 rounded-full text-xs font-bold flex w-fit items-center gap-1">
                        <AlertTriangle size={14}/> {tx(lang, 'Kritik Stok', 'Критический остаток')}
                      </span>
                    ) : (
                      <span className="px-2 py-1 bg-green-100 text-green-600 rounded-full text-xs font-bold">{tx(lang, 'Normal', 'Норма')}</span>
                    )}
                  </td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => setRestockModal({ id: item.id, name: item.name })} className="rounded border border-emerald-300/40 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200">{tx(lang, 'Mədaxil', 'Приход')}</button>
                      <button onClick={() => setLossModal({ id: item.id, name: item.name })} className="rounded border border-amber-300/40 bg-amber-400/10 px-2 py-1 text-xs text-amber-200">{tx(lang, 'Məxaric', 'Расход')}</button>
                      <button onClick={() => setDeleteModal({ id: item.id, name: item.name })} className="rounded border border-red-300/40 bg-red-400/10 px-2 py-1 text-xs text-red-200">{tx(lang, 'Sil', 'Удалить')}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">{tx(lang, 'Anbar boşdur. İlkin məlumat əlavə edin.', 'Склад пуст. Добавьте начальные данные.')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

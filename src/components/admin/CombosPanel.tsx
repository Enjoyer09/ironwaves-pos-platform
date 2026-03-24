import React, { useMemo, useState } from 'react';
import { Decimal } from 'decimal.js';
import { useAppStore } from '../../store';
import { get_menu_items } from '../../api/menu';
import { create_combo, delete_combo, get_combo_details } from '../../api/combos';
import { tx } from '../../i18n';
import ConfirmModal from '../ConfirmModal';

export default function CombosPanel() {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [reloadKey, setReloadKey] = useState(0);
  const menuItems = useMemo(() => get_menu_items(tenant_id), [tenant_id, reloadKey]);
  const comboItems = menuItems.filter((m: any) => m.category === 'Kombolar');

  const [comboName, setComboName] = useState('');
  const [comboPrice, setComboPrice] = useState('');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [itemSearch, setItemSearch] = useState('');
  const [deleteComboName, setDeleteComboName] = useState<string | null>(null);

  const normalMenu = useMemo(
    () =>
      menuItems.filter(
        (m: any) =>
          m.category !== 'Kombolar' &&
          m.item_name.toLowerCase().includes(itemSearch.toLowerCase().trim()),
      ),
    [menuItems, itemSearch],
  );

  const toggleItem = (name: string) => {
    setSelectedItems((prev) => (prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]));
  };

  const onCreate = () => {
    if (!comboName || !comboPrice) {
      notify('error', tx(lang, 'Kombo adı və qiymət vacibdir', 'Название комбо и цена обязательны'));
      return;
    }
    if (selectedItems.length < 2) {
      notify('error', tx(lang, 'Kombo üçün ən az 2 məhsul seçilməlidir', 'Для комбо нужно выбрать минимум 2 продукта'));
      return;
    }
    try {
      create_combo(comboName, new Decimal(comboPrice), selectedItems, user?.username || 'admin', tenant_id);
      setComboName('');
      setComboPrice('');
      setSelectedItems([]);
      notify('success', tx(lang, 'Kombo yaradıldı', 'Комбо создано'));
      setReloadKey((v) => v + 1);
    } catch (e: any) {
      notify('error', e.message);
    }
  };

  return (
    <div className="space-y-6 text-slate-100">
      <ConfirmModal
        open={Boolean(deleteComboName)}
        lang={lang}
        title={tx(lang, 'Kombonu sil', 'Удалить комбо')}
        message={tx(lang, 'Kombo deaktiv ediləcək və resept əlaqələri silinəcək.', 'Комбо будет деактивировано, связи рецепта удалятся.')}
        onCancel={() => setDeleteComboName(null)}
        onConfirm={() => {
          if (!deleteComboName) return;
          delete_combo(deleteComboName, user?.username || 'admin', tenant_id);
          setDeleteComboName(null);
          setReloadKey((v) => v + 1);
          notify('success', tx(lang, 'Kombo silindi', 'Комбо удалено'));
        }}
      />
      <h2 className="text-2xl font-bold">{tx(lang, 'Kombolar', 'Комбо')}</h2>

      <div className="metal-panel p-4">
         <h3 className="mb-3 text-lg font-bold">{tx(lang, 'Yeni Kombo', 'Новое комбо')}</h3>
        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <input
            value={comboName}
            onChange={(e) => setComboName(e.target.value)}
            placeholder={tx(lang, 'Kombo adı', 'Название комбо')}
            className="neon-input"
          />
          <input
            type="number"
            value={comboPrice}
            onChange={(e) => setComboPrice(e.target.value)}
            placeholder={tx(lang, 'Qiymət', 'Цена')}
            className="neon-input"
          />
            <button onClick={onCreate} className="glossy-gold rounded-lg px-4 py-2 font-semibold">
            {tx(lang, 'Kombo Yarat', 'Создать комбо')}
          </button>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-200">
            {tx(lang, 'Komboya daxil ediləcək məhsullar', 'Продукты для комбо')} ({selectedItems.length})
          </p>
          <input
            value={itemSearch}
            onChange={(e) => setItemSearch(e.target.value)}
            placeholder={tx(lang, 'Məhsul axtar...', 'Поиск продукта...')}
            className="neon-input w-64"
          />
        </div>

        <div className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto md:grid-cols-3">
          {normalMenu.map((item: any) => (
            <label key={item.id} className="flex items-center gap-2 rounded-lg border border-slate-700/70 px-3 py-2 text-sm">
              <input type="checkbox" checked={selectedItems.includes(item.item_name)} onChange={() => toggleItem(item.item_name)} />
              <span>{item.item_name}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="metal-panel p-4">
         <h3 className="mb-3 text-lg font-bold">{tx(lang, 'Mövcud Kombolar', 'Существующие комбо')}</h3>
        <div className="space-y-3">
          {comboItems.map((combo: any) => {
            const details = get_combo_details(combo.item_name, tenant_id) || [];
            return (
              <div key={combo.id} className="rounded-lg border border-slate-700/70 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-slate-100">{combo.item_name}</p>
                    <p className="text-sm text-slate-300">{new Decimal(combo.price).toFixed(2)} ₼</p>
                  </div>
                  <button
                    onClick={() => setDeleteComboName(combo.item_name)}
                      className="rounded-md bg-red-500/20 px-3 py-1 text-sm font-semibold text-red-300"
                  >
                    {tx(lang, 'Sil', 'Удалить')}
                  </button>
                </div>
                <div className="text-sm text-slate-300">
                  {details.length > 0
                    ? details.map((d: any) => `${d.ingredient_name} (${d.quantity_required})`).join(', ')
                    : tx(lang, 'Resept detalı yoxdur', 'Нет деталей рецепта')}
                </div>
              </div>
            );
          })}
          {comboItems.length === 0 && <div className="py-8 text-center text-slate-500">{tx(lang, 'Hələ kombo yaradılmayıb', 'Комбо пока не создано')}</div>}
        </div>
      </div>
    </div>
  );
}

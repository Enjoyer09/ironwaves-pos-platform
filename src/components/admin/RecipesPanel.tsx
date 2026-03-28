import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store';
import { get_menu_items_live } from '../../api/menu';
import { get_recipe_live, add_recipe_ingredient_live, delete_recipe_ingredient_live, calculate_recipe_cost_live, generate_recipe_ai_live } from '../../api/recipes';
import { get_inventory_items_live } from '../../api/inventory';
import { Decimal } from 'decimal.js';
import { ChefHat, Plus, Trash2, Calculator, Sparkles } from 'lucide-react';
import { tx } from '../../i18n';
import ConfirmModal from '../ConfirmModal';
import { getDB } from '../../lib/db_sim';

export default function RecipesPanel() {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';

  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [selectedMenu, setSelectedMenu] = useState<string | null>(null);
  const [recipeItems, setRecipeItems] = useState<any[]>([]);
  const [recipeStats, setRecipeStats] = useState<any>(null);
  
  // Xammal əlavə etmək üçün
  const [ingredients, setIngredients] = useState<any[]>([]);
  const [newIngredient, setNewIngredient] = useState('');
  const [newQty, setNewQty] = useState('');
  const [deleteRecipeId, setDeleteRecipeId] = useState<string | null>(null);
  const [missingRecipeSet, setMissingRecipeSet] = useState<Set<string>>(new Set());

  const selectedIngredientMeta = ingredients.find((i) => i.name === newIngredient) || null;
  const suggestedQtyPlaceholder = (() => {
    const unit = String(selectedIngredientMeta?.unit || '').toLowerCase();
    const name = String(selectedIngredientMeta?.name || '').toLowerCase();
    if (!unit) return tx(lang, 'Miqdar', 'Количество');
    if ((unit.includes('kq') || unit.includes('kg')) && (name.includes('kofe') || name.includes('coffee') || name.includes('qəhvə'))) {
      return tx(lang, 'Miqdar (məs: 0.018 kq)', 'Количество (напр.: 0.018 кг)');
    }
    if ((unit === 'l' || unit.includes('litr')) && (name.includes('su') || name.includes('water') || name.includes('süd') || name.includes('milk'))) {
      return tx(lang, 'Miqdar (məs: 0.12 litr)', 'Количество (напр.: 0.12 литра)');
    }
    return tx(lang, `Miqdar (${selectedIngredientMeta?.unit})`, `Количество (${selectedIngredientMeta?.unit})`);
  })();

  useEffect(() => {
    void (async () => {
      const menu = await get_menu_items_live(tenant_id);
      setMenuItems(menu);

      const allRecipes = (getDB<any>('recipes') || []).filter((r) => !r.tenant_id || r.tenant_id === tenant_id);
      const recipeMenuNames = new Set(allRecipes.map((r: any) => String(r.menu_item_name || '')));
      const missing = new Set(menu.filter((m: any) => !recipeMenuNames.has(String(m.item_name))).map((m: any) => String(m.item_name)));
      setMissingRecipeSet(missing);

      const inv = await get_inventory_items_live(tenant_id);
      setIngredients(inv || []);
    })();
  }, [tenant_id]);

  // Seçilmiş məhsulun qiymətini tapırıq
  const getSelectedMenuPrice = () => {
    const item = menuItems.find((m) => m.item_name === selectedMenu);
    try {
      return item ? new Decimal(item.price ?? 0) : new Decimal(0);
    } catch {
      return new Decimal(0);
    }
  };

  useEffect(() => {
    if (!selectedMenu) return;
    void (async () => {
      try {
        const items = await get_recipe_live(selectedMenu, tenant_id);
        setRecipeItems(items);
        const stats = await calculate_recipe_cost_live(selectedMenu, getSelectedMenuPrice(), tenant_id);
        setRecipeStats(stats);
      } catch (error) {
        console.error(error);
        setRecipeItems([]);
        setRecipeStats({ total_cost: 0, margin: 0, margin_percent: 0 });
      }
    })();
  }, [selectedMenu, menuItems, tenant_id]);

  const handleAddIngredient = async () => {
    if (!selectedMenu || !newIngredient || !newQty) return;

    try {
      const invItem = ingredients.find(i => i.name === newIngredient);
      await add_recipe_ingredient_live({
        menu_item_name: selectedMenu,
        ingredient_name: newIngredient,
        quantity_required: new Decimal(newQty),
        unit: invItem ? invItem.unit : 'q',
        unit_cost: invItem ? new Decimal(invItem.unit_cost) : new Decimal(0),
        tenant_id,
      }, user?.username);

      setRecipeItems(await get_recipe_live(selectedMenu, tenant_id));
      setRecipeStats(await calculate_recipe_cost_live(selectedMenu, getSelectedMenuPrice(), tenant_id));
      setNewIngredient('');
      setNewQty('');
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Reseptə xammal əlavə olunmadı', 'Не удалось добавить ингредиент в рецепт'));
    }
  };

  const handleDeleteIngredient = async (recipe_id: string) => {
    try {
      await delete_recipe_ingredient_live(recipe_id, user?.username, tenant_id);
      if (selectedMenu) {
        setRecipeItems(await get_recipe_live(selectedMenu, tenant_id));
        setRecipeStats(await calculate_recipe_cost_live(selectedMenu, getSelectedMenuPrice(), tenant_id));
      }
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Resept silinmədi', 'Рецепт не удален'));
    }
  };

  const handleGenerateAI = async () => {
    if (!selectedMenu) return;
    try {
      await generate_recipe_ai_live(selectedMenu, user?.username, tenant_id);
      notify('success', tx(lang, `AI ${selectedMenu} üçün resept yaratdı!`, `AI создал рецепт для ${selectedMenu}!`));
      setRecipeItems(await get_recipe_live(selectedMenu, tenant_id));
      setRecipeStats(await calculate_recipe_cost_live(selectedMenu, getSelectedMenuPrice(), tenant_id));
    } catch(e:any) {
      notify('error', e.message);
    }
  };

  return (
    <div className="text-slate-100">
      <ConfirmModal
        open={Boolean(deleteRecipeId)}
        lang={lang}
        title={tx(lang, 'Resept sətrini sil', 'Удалить строку рецепта')}
        message={tx(lang, 'Bu əməliyyat reseptdən xammalı siləcək.', 'Это действие удалит ингредиент из рецепта.')}
        onCancel={() => setDeleteRecipeId(null)}
        onConfirm={() => {
          if (!deleteRecipeId) return;
          void handleDeleteIngredient(deleteRecipeId);
          setDeleteRecipeId(null);
        }}
      />
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <ChefHat className="text-orange-500" size={32} />
            {tx(lang, 'Reseptlər və Maya Dəyəri', 'Рецепты и себестоимость')}
          </h1>
          <p className="text-slate-300 mt-1">{tx(lang, 'Məhsulların tərkibini yaradın və qazancınızı (margin) hesablayın', 'Создавайте состав продуктов и считайте вашу маржу')}</p>
        </div>
      </div>

      {menuItems.length === 0 && (
          <div className="metal-panel p-5 text-sm text-slate-300">{tx(lang, 'Aktiv menyu məhsulu yoxdur. Əvvəlcə Menyu bölməsindən məhsul yaradın.', 'Нет активных позиций меню. Сначала создайте продукт в разделе Меню.')}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Sol: Menyu Seçimi */}
        <div className="metal-panel overflow-hidden col-span-1">
          <div className="p-4 border-b border-slate-700/70 bg-slate-900/40">
            <h2 className="font-bold text-slate-100">{tx(lang, 'Menyu Məhsulları', 'Позиции меню')}</h2>
          </div>
          <div className="divide-y divide-slate-700/60 max-h-[500px] overflow-y-auto">
            {[...menuItems]
              .sort((a, b) => {
                const am = missingRecipeSet.has(String(a.item_name)) ? 1 : 0;
                const bm = missingRecipeSet.has(String(b.item_name)) ? 1 : 0;
                if (am !== bm) return bm - am;
                return String(a.item_name).localeCompare(String(b.item_name));
              })
              .map(item => (
              <div 
                key={item.id} 
                onClick={() => setSelectedMenu(item.item_name)}
                className={`p-4 cursor-pointer transition-colors ${selectedMenu === item.item_name ? 'bg-yellow-400/20 border-l-4 border-yellow-400' : 'hover:bg-slate-800/60 border-l-4 border-transparent'} ${missingRecipeSet.has(String(item.item_name)) ? 'bg-amber-500/10' : ''}`}
              >
                <div className="font-medium text-slate-100 flex items-center gap-2">
                  <span>{item.item_name}</span>
                  {missingRecipeSet.has(String(item.item_name)) && (
                    <span className="rounded border border-amber-300/50 bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100">
                      {tx(lang, 'Resept yoxdur', 'Нет рецепта')}
                    </span>
                  )}
                </div>
                <div className="text-sm text-slate-400">{Number(item.price || 0).toFixed(2)} ₼</div>
              </div>
            ))}
          </div>
        </div>

        {/* Sağ: Resept Tərkibi */}
        <div className="metal-panel p-6 col-span-2 flex flex-col">
          {!selectedMenu ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
              <ChefHat size={64} className="mb-4 text-slate-500" />
               <p>{tx(lang, 'Resepti görmək üçün soldan bir məhsul seçin', 'Выберите продукт слева, чтобы увидеть рецепт')}</p>
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-slate-100">{selectedMenu} Resepti</h2>
                <div className="flex gap-4 items-center">
                  <button onClick={handleGenerateAI} className="glossy-gold px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors">
                    <Sparkles size={16} /> {tx(lang, 'AI İlə Yarat', 'Создать через AI')}
                  </button>
                  {recipeStats && (
                    <>
                      <div className="bg-blue-500/20 text-blue-200 px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2">
                        <Calculator size={16} /> {tx(lang, 'Maya', 'Себестоимость')}: {new Decimal(recipeStats.total_cost || 0).toFixed(2)} ₼
                      </div>
                      <div className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 ${new Decimal(recipeStats.margin || 0).gt(0) ? 'bg-green-500/20 text-green-200' : 'bg-red-500/20 text-red-200'}`}>
                        <Calculator size={16} /> {tx(lang, 'Mənfəət', 'Маржа')}: {new Decimal(recipeStats.margin || 0).toFixed(2)} ₼ ({new Decimal(recipeStats.margin_percent || 0).toFixed(2)}%)
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex gap-3 mb-6 bg-slate-900/40 p-4 rounded-xl border border-slate-700/70">
                <select 
                  value={newIngredient} 
                  onChange={e => setNewIngredient(e.target.value)}
                  className="neon-input flex-1"
                >
                    <option value="">{tx(lang, '-- Anbardan Xammal Seç --', '-- Выберите ингредиент со склада --')}</option>
                  {ingredients.map(inv => (
                    <option key={inv.id} value={inv.name}>{inv.name} (Stok: {inv.stock_qty} {inv.unit})</option>
                  ))}
                </select>
                    <input 
                  type="number" 
                  step="0.001"
                  placeholder={suggestedQtyPlaceholder} 
                  value={newQty}
                  onChange={e => setNewQty(e.target.value)}
                  className="neon-input w-32"
                />
                <button 
                  onClick={() => { void handleAddIngredient(); }}
                  className="glossy-gold px-4 py-2 rounded-lg transition-colors"
                >
                  <Plus size={20} />
                </button>
              </div>
              {selectedIngredientMeta ? (
                <p className="mb-4 text-xs text-slate-400">
                  {tx(
                    lang,
                    `Ölçü vahidi avtomatik anbardan götürülür: ${selectedIngredientMeta.unit}. Məsələn kofe üçün 0.018 kq, süd üçün 0.12 litr yaza bilərsiniz.`,
                    `Единица измерения автоматически берется со склада: ${selectedIngredientMeta.unit}. Например для кофе можно указать 0.018 кг, для молока 0.12 литра.`,
                  )}
                </p>
              ) : null}

              <div className="overflow-x-auto flex-1">
                <table className="w-full">
                  <thead className="bg-slate-900/40 text-left text-xs font-semibold text-slate-300 uppercase">
                    <tr>
                      <th className="px-4 py-3">{tx(lang, 'Xammal', 'Ингредиент')}</th>
                      <th className="px-4 py-3">{tx(lang, 'Miqdar', 'Количество')}</th>
                      <th className="px-4 py-3">{tx(lang, 'Ölçü Vahidi', 'Ед. измерения')}</th>
                      <th className="px-4 py-3">{tx(lang, 'Xətt Maliyyəti', 'Стоимость строки')}</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {recipeItems.map(item => (
                      <tr key={item.id} className="border-t border-slate-700/60">
                        <td className="px-4 py-3 font-medium text-slate-100">{item.ingredient_name}</td>
                        <td className="px-4 py-3 text-slate-300">{item.quantity_required}</td>
                        <td className="px-4 py-3 text-slate-300">{item.unit}</td>
                        <td className="px-4 py-3 font-semibold text-slate-100">{item.line_cost} ₼</td>
                        <td className="px-4 py-3 text-right">
                          <button 
                            onClick={() => setDeleteRecipeId(item.id)}
                            className="text-red-400 hover:text-red-300 p-2 rounded-lg hover:bg-red-500/20"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {recipeItems.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                          {tx(lang, 'Bu məhsul üçün resept əlavə edilməyib', 'Для этого продукта рецепт не добавлен')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

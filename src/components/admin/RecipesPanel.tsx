import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../store';
import { get_menu_items_live } from '../../api/menu';
import { get_recipe_live, calculate_recipe_cost_live, generate_recipe_ai_live, getDefaultRecipeEntryUnit, getRecipeEntryUnitOptions, get_recipe_menu_names_live, replace_recipe_live } from '../../api/recipes';
import { get_inventory_items_live } from '../../api/inventory';
import { Decimal } from 'decimal.js';
import { ChefHat, Plus, Trash2, Calculator, Sparkles, Bot, X } from 'lucide-react';
import { tx } from '../../i18n';
import ConfirmModal from '../ConfirmModal';
import CombosPanel from './CombosPanel';
import { generate_ai_recipe_api } from '../../api/agent_api';
import { apiRequest, getApiBaseUrl } from '../../api/client';
import { verifyLocalCredential } from '../../lib/local_auth';
import { getDB } from '../../lib/db_sim';

const normalizeText = (value: string | undefined | null) =>
  String(value || '')
    .toLowerCase()
    .replace(/ə/g, 'e')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ğ/g, 'g')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .trim();

const isAffogatoLike = (menuName: string | null) => /affogato|affagato/i.test(String(menuName || ''));

const menuSizeToken = (menuName: string | null) => {
  const normalized = normalizeText(menuName || '');
  if (/\b(s|small)\b/.test(normalized)) return 's';
  if (/\b(m|medium)\b/.test(normalized)) return 'm';
  if (/\b(l|large)\b/.test(normalized)) return 'l';
  return '';
};

const findPackagingItemName = (inventory: any[], keywords: string[], sizeToken: string) => {
  const rows = (inventory || []).map((item) => ({
    name: String(item?.name || ''),
    normalized: normalizeText(String(item?.name || '')),
  }));
  if (sizeToken) {
    const strict = rows.find((row) => keywords.every((k) => row.normalized.includes(normalizeText(k))) && new RegExp(`\\b${sizeToken}\\b`).test(row.normalized));
    if (strict) return strict.name;
  }
  const generic = rows.find((row) => keywords.every((k) => row.normalized.includes(normalizeText(k))));
  return generic?.name || '';
};

export default function RecipesPanel() {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';

  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [selectedMenu, setSelectedMenu] = useState<string | null>(null);
  const [recipeItems, setRecipeItems] = useState<any[]>([]);
  const [draftRecipeItems, setDraftRecipeItems] = useState<any[]>([]);
  const [recipeStats, setRecipeStats] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  
  // Xammal əlavə etmək üçün
  const [ingredients, setIngredients] = useState<any[]>([]);
  const [newIngredient, setNewIngredient] = useState('');
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newQtyUnit, setNewQtyUnit] = useState('qram');
  const [deleteRecipeId, setDeleteRecipeId] = useState<string | null>(null);
  const [missingRecipeSet, setMissingRecipeSet] = useState<Set<string>>(new Set());
  const [workspace, setWorkspace] = useState<'recipes' | 'combos'>('recipes');
  const [lastSavedByAI, setLastSavedByAI] = useState(false);
  const [agentRecipeModal, setAgentRecipeModal] = useState<{ open: boolean; text: string; loading: boolean }>({ open: false, text: '', loading: false });
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearConfirmPassword, setClearConfirmPassword] = useState('');
  const [isClearing, setIsClearing] = useState(false);

  const verifyAdminPassword = async () => {
    const normalized = String(clearConfirmPassword || '').trim();
    if (!normalized) return false;

    if (getApiBaseUrl()) {
      try {
        const result = await apiRequest<{ success: boolean }>('/api/v1/ops/database/verify-admin-password', {
          method: 'POST',
          tenantId: tenant_id,
          timeoutMs: 30000,
          suspendOnNetworkError: false,
          body: { password: normalized },
        });
        if (result?.success) return true;
        return false;
      } catch (error) {
        throw new Error(tx(lang, 'Admin şifrəsi yoxlanmadı', 'Пароль администратора не проверен'));
      }
    }

    const users = getDB<any>('users') || [];
    const tenantAdmins = users.filter(
      (u: any) =>
        String(u.tenant_id || tenant_id) === String(tenant_id) &&
        Boolean(u.is_active ?? true) &&
        ['admin', 'super_admin'].includes(String(u.role || '').toLowerCase()),
    );

    const currentAdminFirst = tenantAdmins.sort((a: any, b: any) => {
      const aCurrent = String(a.username || '').toLowerCase() === String(user?.username || '').toLowerCase() ? 1 : 0;
      const bCurrent = String(b.username || '').toLowerCase() === String(user?.username || '').toLowerCase() ? 1 : 0;
      return bCurrent - aCurrent;
    });

    for (const candidate of currentAdminFirst) {
      const isMatch = await verifyLocalCredential(normalized, candidate.password_hash || candidate.password);
      if (isMatch) return true;
    }
    return false;
  };

  const handleClearRecipes = async () => {
    try {
      if (!(await verifyAdminPassword())) {
        notify('error', tx(lang, 'Şifrə yanlışdır', 'Неверный пароль'));
        return;
      }
      setIsClearing(true);
      const { clear_recipes_live } = await import('../../api/inventory');
      await clear_recipes_live(tenant_id, user?.username || 'admin');
      notify(
        'success',
        tx(
          lang,
          'Bütün reseptlər uğurla təmizləndi.',
          'Все рецепты успешно очищены.',
          'All recipes successfully cleared.'
        )
      );
      setClearConfirmOpen(false);
      setClearConfirmPassword('');
      window.setTimeout(() => window.location.reload(), 800);
    } catch (error: any) {
      notify('error', error?.message || tx(lang, 'Xəta baş verdi', 'Произошла ошибка'));
    } finally {
      setIsClearing(false);
    }
  };

  const selectedIngredientMeta = ingredients.find((i) => i.name === newIngredient) || null;
  const qtyUnitOptions = getRecipeEntryUnitOptions(String(selectedIngredientMeta?.unit || ''));
  const filteredIngredients = React.useMemo(() => {
    const search = normalizeText(ingredientSearch).trim();
    if (!search) return ingredients;
    return ingredients.filter(inv =>
      normalizeText(inv.name).includes(search)
    );
  }, [ingredients, ingredientSearch]);
  const suggestedQtyPlaceholder = (() => {
    const unit = String(newQtyUnit || selectedIngredientMeta?.unit || '').toLowerCase();
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

  const convertToInventoryUnit = (quantity: Decimal, fromUnit: string, inventoryUnit: string) => {
    const normalize = (value: string) => String(value || '').trim().toLowerCase();
    const from = normalize(fromUnit);
    const to = normalize(inventoryUnit);
    if (!from || from === to) return quantity;
    const conversions: Record<string, Decimal> = {
      'qram->kq': new Decimal('0.001'),
      'kq->qram': new Decimal('1000'),
      'ml->litr': new Decimal('0.001'),
      'litr->ml': new Decimal('1000'),
      'pomp->litr': new Decimal('0.01'),
      'litr->pomp': new Decimal('100'),
      'pomp->ml': new Decimal('10'),
      'ml->pomp': new Decimal('0.1'),
      'sm->metr': new Decimal('0.01'),
      'metr->sm': new Decimal('100'),
    };
    return quantity.mul(conversions[`${from}->${to}`] || new Decimal(1));
  };

  useEffect(() => {
    void (async () => {
      const menu = await get_menu_items_live(tenant_id);
      setMenuItems(menu);

      const recipeMenuNames = new Set(await get_recipe_menu_names_live(tenant_id));
      const missing = new Set(menu.filter((m: any) => !recipeMenuNames.has(String(m.item_name))).map((m: any) => String(m.item_name)));
      setMissingRecipeSet(missing);

      const inv = await get_inventory_items_live(tenant_id);
      setIngredients(inv || []);
    })();
  }, [tenant_id]);

  useEffect(() => {
    if (!selectedIngredientMeta?.unit) return;
    setNewQtyUnit(getDefaultRecipeEntryUnit(String(selectedIngredientMeta.unit)));
  }, [selectedIngredientMeta?.unit, newIngredient]);

  useEffect(() => {
    setLastSavedByAI(false);
  }, [selectedMenu]);

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
        setDraftRecipeItems(items);
        const stats = await calculate_recipe_cost_live(selectedMenu, getSelectedMenuPrice(), tenant_id);
        setRecipeStats(stats);
      } catch (error) {
        console.error(error);
        setRecipeItems([]);
        setDraftRecipeItems([]);
        setRecipeStats({ total_cost: 0, margin: 0, margin_percent: 0 });
      }
    })();
  }, [selectedMenu, menuItems, tenant_id]);

  const handleAddIngredient = async () => {
    if (!selectedMenu || !newIngredient || !newQty) return;

    try {
      const invItem = ingredients.find(i => i.name === newIngredient);
      const qty = new Decimal(newQty || 0);
      const unitCost = new Decimal(invItem?.unit_cost || 0);
      const normalizedQty = convertToInventoryUnit(qty, newQtyUnit, String(invItem?.unit || newQtyUnit));
      setDraftRecipeItems((prev) => [
        ...prev,
        {
          id: `draft_${Date.now()}`,
          tenant_id,
          menu_item_name: selectedMenu,
          ingredient_name: newIngredient,
          quantity_required: qty.toFixed(4),
          quantity_unit: newQtyUnit,
          unit: invItem?.unit || newQtyUnit,
          unit_cost: unitCost.toFixed(4),
          line_cost: normalizedQty.mul(unitCost).toFixed(4),
        },
      ]);
      setLastSavedByAI(false);
      setNewIngredient('');
      setNewQty('');
      setIngredientSearch('');
      setNewQtyUnit(invItem ? getDefaultRecipeEntryUnit(String(invItem.unit)) : 'qram');
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Reseptə xammal əlavə olunmadı', 'Не удалось добавить ингредиент в рецепт', 'Failed to add ingredient to recipe'));
    }
  };

  const handleDeleteIngredient = (recipe_id: string) => {
    setLastSavedByAI(false);
    setDraftRecipeItems((prev) => prev.filter((item) => item.id !== recipe_id));
  };

  const handleGenerateAI = async () => {
    if (!selectedMenu) return;
    try {
      const selectedMenuMeta = menuItems.find((m) => String(m.item_name) === String(selectedMenu));
      const generated = await generate_recipe_ai_live(selectedMenu, user?.username, tenant_id, {
        category: selectedMenuMeta?.category,
        sell_price: selectedMenuMeta?.price,
      });
      const providerRaw = String(generated?.generation?.provider || 'unknown');
      const providerLabel =
        providerRaw === 'google'
          ? 'Google Gemini'
          : providerRaw === 'ollama_freeapi'
            ? 'OllamaFreeAPI'
            : providerRaw;
      const modeRaw = String(generated?.generation?.mode || 'fallback');
      const modeLabel =
        modeRaw === 'remote'
          ? tx(lang, 'remote AI cavabı', 'удаленный AI ответ', 'remote AI response')
          : tx(lang, 'fallback generator', 'fallback генератор', 'fallback generator');
      const fallbackReason = String(generated?.generation?.fallback_reason || '').trim();
      notify(
        'success',
        tx(
          lang,
          `AI ${selectedMenu} üçün resept yaratdı və yadda saxladı. Mənbə: ${providerLabel} (${modeLabel})${modeRaw === 'fallback' && fallbackReason ? `. Səbəb: ${fallbackReason}.` : ''}`,
          `AI создал и сохранил рецепт для ${selectedMenu}. Источник: ${providerLabel} (${modeLabel})${modeRaw === 'fallback' && fallbackReason ? `. Причина: ${fallbackReason}.` : ''}`,
          `AI created and saved a recipe for ${selectedMenu}. Source: ${providerLabel} (${modeLabel})${modeRaw === 'fallback' && fallbackReason ? `. Reason: ${fallbackReason}.` : ''}`,
        ),
      );
      const nextItems = await get_recipe_live(selectedMenu, tenant_id);
      setRecipeItems(nextItems);
      setDraftRecipeItems(nextItems);
      setLastSavedByAI(true);
      setRecipeStats(await calculate_recipe_cost_live(selectedMenu, getSelectedMenuPrice(), tenant_id));
      setMissingRecipeSet((prev) => {
        const next = new Set(prev);
        next.delete(String(selectedMenu));
        return next;
      });
    } catch(e:any) {
      notify('error', e.message);
    }
  };

  const handleAgentGenerate = async () => {
    if (!selectedMenu) return;
    setAgentRecipeModal({ open: true, text: '', loading: true });
    try {
      const recipeText = await generate_ai_recipe_api(selectedMenu);
      setAgentRecipeModal({ open: true, text: recipeText, loading: false });
    } catch (e: any) {
      setAgentRecipeModal({ open: false, text: '', loading: false });
      notify('error', e.message || 'Failed to generate recipe via background agent');
    }
  };

  const hasUnsavedChanges = JSON.stringify(draftRecipeItems.map((item) => ({ ingredient_name: item.ingredient_name, quantity_required: item.quantity_required, quantity_unit: item.quantity_unit || item.unit })))
    !== JSON.stringify(recipeItems.map((item) => ({ ingredient_name: item.ingredient_name, quantity_required: item.quantity_required, quantity_unit: item.quantity_unit || item.unit })));

  const requiredPackaging = (() => {
    if (!isAffogatoLike(selectedMenu)) return { cup: '', lid: '' };
    const sizeToken = menuSizeToken(selectedMenu);
    const cupName = findPackagingItemName(ingredients, ['stakan'], sizeToken) || findPackagingItemName(ingredients, ['cup'], sizeToken);
    const lidName = findPackagingItemName(ingredients, ['qapaq'], sizeToken) || findPackagingItemName(ingredients, ['lid'], sizeToken);
    return { cup: cupName, lid: lidName };
  })();

  const draftIngredientSet = new Set(draftRecipeItems.map((item) => normalizeText(item.ingredient_name)));
  const missingPackagingInventory: string[] = [];
  const missingPackagingDraft: string[] = [];
  if (isAffogatoLike(selectedMenu)) {
    if (!requiredPackaging.cup) missingPackagingInventory.push(tx(lang, 'Kağız stəkan', 'Бумажный стакан', 'Paper cup'));
    if (!requiredPackaging.lid) missingPackagingInventory.push(tx(lang, 'Qapaq', 'Крышка', 'Lid'));
    if (requiredPackaging.cup && !draftIngredientSet.has(normalizeText(requiredPackaging.cup))) {
      missingPackagingDraft.push(requiredPackaging.cup);
    }
    if (requiredPackaging.lid && !draftIngredientSet.has(normalizeText(requiredPackaging.lid))) {
      missingPackagingDraft.push(requiredPackaging.lid);
    }
  }
  const saveBlockedByPackaging = missingPackagingInventory.length > 0 || missingPackagingDraft.length > 0;
  const isSaveDisabled = isSaving || !hasUnsavedChanges || saveBlockedByPackaging;
  const saveDisabledReason = isSaving
    ? tx(lang, 'Resept hazırda saxlanılır, zəhmət olmasa gözləyin.', 'Рецепт сейчас сохраняется, пожалуйста подождите.', 'Recipe is currently saving, please wait.')
    : missingPackagingInventory.length > 0
      ? tx(
          lang,
          `Affogato üçün anbarda məcburi qablaşdırma yoxdur: ${missingPackagingInventory.join(', ')}.`,
          `Для Affogato на складе нет обязательной упаковки: ${missingPackagingInventory.join(', ')}.`,
          `Missing required packaging in inventory for Affogato: ${missingPackagingInventory.join(', ')}.`,
        )
      : missingPackagingDraft.length > 0
        ? tx(
            lang,
            `Affogato reseptində məcburi item yoxdur: ${missingPackagingDraft.join(', ')}.`,
            `В рецепте Affogato отсутствуют обязательные позиции: ${missingPackagingDraft.join(', ')}.`,
            `Affogato recipe is missing required items: ${missingPackagingDraft.join(', ')}.`,
          )
    : !hasUnsavedChanges && lastSavedByAI
      ? tx(
          lang,
          'AI resepti artıq avtomatik yadda saxlayıb. Yadda saxla düyməsini aktiv etmək üçün yeni dəyişiklik edin.',
          'AI уже автоматически сохранил рецепт. Чтобы активировать кнопку сохранения, внесите новое изменение.',
          'AI already saved this recipe automatically. Make a new change to enable Save.',
        )
    : !hasUnsavedChanges
      ? tx(lang, 'Yadda saxlamaq üçün əvvəlcə reseptdə dəyişiklik edin.', 'Чтобы сохранить, сначала внесите изменения в рецепт.', 'Make a change in the recipe first to enable saving.')
      : '';

  const handleSaveRecipe = async () => {
    if (!selectedMenu) return;
    setIsSaving(true);
    try {
      await replace_recipe_live(
        selectedMenu,
        draftRecipeItems.map((item) => ({
          ingredient_name: item.ingredient_name,
          quantity_required: item.quantity_required,
          quantity_unit: item.quantity_unit || item.unit,
        })),
        tenant_id,
      );
      const nextItems = await get_recipe_live(selectedMenu, tenant_id);
      setRecipeItems(nextItems);
      setDraftRecipeItems(nextItems);
      setLastSavedByAI(false);
      setRecipeStats(await calculate_recipe_cost_live(selectedMenu, getSelectedMenuPrice(), tenant_id));
      setMissingRecipeSet((prev) => {
        const next = new Set(prev);
        if (nextItems.length > 0) next.delete(String(selectedMenu));
        else next.add(String(selectedMenu));
        return next;
      });
      notify('success', tx(lang, 'Resept yadda saxlanıldı', 'Рецепт сохранен', 'Recipe saved'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Resept saxlanmadı', 'Рецепт не сохранен', 'Recipe was not saved'));
    } finally {
      setIsSaving(false);
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
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <ChefHat className="text-orange-500" size={32} />
            {tx(lang, 'Reseptlər və Maya Dəyəri', 'Рецепты и себестоимость', 'Recipes and Costing')}
          </h1>
          <p className="text-slate-300 mt-1">{tx(lang, 'Məhsulların tərkibini yaradın və qazancınızı (margin) hesablayın', 'Создавайте состав продуктов и считайте вашу маржу', 'Build product recipes and calculate margin')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setWorkspace('recipes')}
            className={`${workspace === 'recipes' ? 'neon-chip neon-chip-active' : 'neon-chip'} min-h-12 px-4`}
          >
            {tx(lang, 'Reseptlər', 'Рецепты', 'Recipes')}
          </button>
          <button
            onClick={() => setWorkspace('combos')}
            className={`${workspace === 'combos' ? 'neon-chip neon-chip-active' : 'neon-chip'} min-h-12 px-4`}
          >
            {tx(lang, 'Kombolar', 'Комбо', 'Combos')}
          </button>
        </div>
      </div>

      {workspace === 'combos' ? (
        <CombosPanel />
      ) : (
      <>
      {menuItems.length === 0 && (
          <div className="metal-panel p-5 text-sm text-slate-300">{tx(lang, 'Aktiv menyu məhsulu yoxdur. Əvvəlcə Menyu bölməsindən məhsul yaradın.', 'Нет активных позиций меню. Сначала создайте продукт в разделе Меню.', 'There are no active menu items. Create one in Menu first.')}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Sol: Menyu Seçimi */}
        <div className="metal-panel overflow-hidden col-span-1">
          <div className="p-4 border-b border-slate-700/70 bg-slate-900/40">
            <h2 className="font-bold text-slate-100">{tx(lang, 'Menyu Məhsulları', 'Позиции меню', 'Menu Items')}</h2>
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
               <p>{tx(lang, 'Resepti görmək üçün soldan bir məhsul seçin', 'Выберите продукт слева, чтобы увидеть рецепт', 'Select a menu item on the left to view the recipe')}</p>
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold text-slate-100">{selectedMenu} {tx(lang, 'Resepti', 'Рецепт', 'Recipe')}</h2>
                <div className="flex gap-4 items-center">
                  <button onClick={handleAgentGenerate} className="glossy-purple px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors">
                    <Bot size={16} /> {tx(lang, 'Background AI Resepti', 'Рецепт от фонового AI', 'Background AI Recipe')}
                  </button>
                  <button onClick={handleGenerateAI} className="glossy-gold px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors">
                    <Sparkles size={16} /> {tx(lang, 'AI İlə Yarat', 'Создать через AI', 'Generate with AI')}
                  </button>
                  <span title={saveDisabledReason} className="inline-block">
                    <button
                      onClick={() => { void handleSaveRecipe(); }}
                      disabled={isSaveDisabled}
                      aria-label={saveDisabledReason || tx(lang, 'Resepti yadda saxla', 'Сохранить рецепт', 'Save recipe')}
                      className="rounded-xl border border-emerald-300/40 bg-emerald-500/20 px-4 py-2 text-sm font-bold text-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSaving ? tx(lang, 'Saxlanılır...', 'Сохраняется...', 'Saving...') : tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}
                    </button>
                  </span>
                  {recipeStats && (
                    <>
                      <div className="bg-blue-500/20 text-blue-200 px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2">
                        <Calculator size={16} /> {tx(lang, 'Maya', 'Себестоимость', 'Cost')}: {new Decimal(recipeStats.total_cost || 0).toFixed(2)} ₼
                      </div>
                      <div className={`px-4 py-2 rounded-xl text-sm font-semibold flex items-center gap-2 ${new Decimal(recipeStats.margin || 0).gt(0) ? 'bg-green-500/20 text-green-200' : 'bg-red-500/20 text-red-200'}`}>
                        <Calculator size={16} /> {tx(lang, 'Mənfəət', 'Маржа', 'Margin')}: {new Decimal(recipeStats.margin || 0).toFixed(2)} ₼ ({new Decimal(recipeStats.margin_percent || 0).toFixed(2)}%)
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-3 mb-6 bg-slate-900/40 p-4 rounded-xl border border-slate-700/70">
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={ingredientSearch}
                    onChange={e => setIngredientSearch(e.target.value)}
                    placeholder={tx(lang, 'Anbardan axtar...', 'Поиск на складе...', 'Search warehouse...')}
                    className="neon-input flex-1"
                  />
                  {ingredientSearch && (
                    <button
                      type="button"
                      onClick={() => setIngredientSearch('')}
                      className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2 text-sm font-semibold text-slate-200 transition-all active:scale-95"
                    >
                      {tx(lang, 'Təmizlə', 'Очистить', 'Clear')}
                    </button>
                  )}
                </div>

                <div className="flex gap-3">
                  <select 
                    value={newIngredient} 
                    onChange={e => setNewIngredient(e.target.value)}
                    className="neon-input flex-1"
                  >
                      <option value="">{tx(lang, '-- Anbardan Xammal Seç --', '-- Выберите ингредиент со склада --', '-- Select inventory ingredient --')}</option>
                    {filteredIngredients.map(inv => (
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
                  <select
                    value={newQtyUnit}
                    onChange={(e) => setNewQtyUnit(e.target.value)}
                    className="neon-input w-28"
                    disabled={!selectedIngredientMeta}
                  >
                    {qtyUnitOptions.map((unit) => (
                      <option key={unit} value={unit}>{unit}</option>
                    ))}
                  </select>
                  <button 
                    onClick={() => { void handleAddIngredient(); }}
                    className="glossy-gold px-4 py-2 rounded-lg transition-colors"
                    title={tx(lang, 'Draft-a əlavə et', 'Добавить в черновик', 'Add to draft')}
                  >
                    <Plus size={20} />
                  </button>
                </div>
              </div>
              <div className="mb-4 text-xs text-slate-400">
                {tx(lang, 'İnqrediyentləri əlavə edin, sonra ayrıca Yadda saxla düyməsi ilə resepti yadda saxlayın.', 'Добавьте ингредиенты, затем сохраните рецепт кнопкой Save.', 'Add ingredients, then save the recipe with the Save button.')}
              </div>
              {isAffogatoLike(selectedMenu) ? (
                <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${saveBlockedByPackaging ? 'border-amber-300/40 bg-amber-500/10 text-amber-200' : 'border-emerald-300/30 bg-emerald-500/10 text-emerald-200'}`}>
                  {saveBlockedByPackaging
                    ? saveDisabledReason
                    : tx(
                        lang,
                        'Affogato standartı aktivdir: reseptdə kağız stəkan + qapaq məcburidir.',
                        'Стандарт Affogato активен: в рецепте обязательны бумажный стакан + крышка.',
                        'Affogato standard is active: paper cup + lid are required in recipe.',
                      )}
                </div>
              ) : null}
              {selectedIngredientMeta ? (
                <p className="mb-4 text-xs text-slate-400">
                  {tx(
                    lang,
                    `Anbar vahidi: ${selectedIngredientMeta.unit}. Reseptdə giriş vahidini ayrıca seçə bilərsiniz: məsələn kofe üçün 18 qram, süd üçün 120 ml.`,
                    `Складская единица: ${selectedIngredientMeta.unit}. В рецепте можно выбрать отдельную единицу ввода: например 18 грамм кофе или 120 мл молока.`,
                    `Inventory unit: ${selectedIngredientMeta.unit}. You can choose a different recipe entry unit, for example 18 grams of coffee or 120 ml of milk.`,
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
                    {draftRecipeItems.map(item => (
                      <tr key={item.id} className="border-t border-slate-700/60">
                        <td className="px-4 py-3 font-medium text-slate-100">{item.ingredient_name}</td>
                        <td className="px-4 py-3 text-slate-300">{item.quantity_required}</td>
                        <td className="px-4 py-3 text-slate-300">{item.quantity_unit || item.unit}</td>
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
                    {draftRecipeItems.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                          {tx(lang, 'Bu məhsul üçün resept əlavə edilməyib', 'Для этого продукта рецепт не добавлен', 'No recipe has been added for this item')}
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
      </>
      )}

      {agentRecipeModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-2xl border border-fuchsia-400/30 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-fuchsia-300 flex items-center gap-2">
                <Bot size={24} />
                {selectedMenu} {tx(lang, 'üçün Beynəlxalq Standart', 'международный стандарт для', 'International standard for')}
              </h2>
              <button
                onClick={() => setAgentRecipeModal({ open: false, text: '', loading: false })}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                <X size={24} />
              </button>
            </div>
            
            {agentRecipeModal.loading ? (
              <div className="flex py-12 justify-center items-center flex-col text-fuchsia-400">
                <Sparkles className="animate-spin mb-4" size={32} />
                <p>{tx(lang, 'AI beynəlxalq standartlara uyğun resept hazırlayır...', 'AI создает рецепт по международным стандартам...', 'AI is generating recipe using international standards...')}</p>
              </div>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-xl bg-slate-950/50 p-4 text-sm leading-6 text-slate-300">
                {agentRecipeModal.text}
              </div>
            )}
            
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setAgentRecipeModal({ open: false, text: '', loading: false })}
                className="rounded-xl border border-slate-700 bg-slate-800 px-6 py-2 font-bold text-white hover:bg-slate-700"
              >
                {tx(lang, 'Bağla', 'Закрыть', 'Close')}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Dangerous Operations Section for Admin/Manager */}
      {['admin', 'super_admin', 'finance_admin', 'manager'].includes(String(user?.role || '').toLowerCase()) && (
        <div className="metal-panel mt-6 p-6 border-rose-500/30 bg-rose-950/5">
          <h2 className="text-xl font-bold flex items-center gap-3 text-rose-300">
            <span className="text-rose-500">⚠️</span>
            {tx(lang, 'Təhlükəli Əməliyyatlar', 'Опасные операции', 'Dangerous Actions')}
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            {tx(
              lang,
              'Bu əməliyyat geri qaytarıla bilməz. Zəhmət olmasa diqqətli olun.',
              'Эта операция необратима. Пожалуйста, будьте осторожны.',
              'This operation is irreversible. Please be careful.'
            )}
          </p>

          <div className="mt-4">
            <button
              onClick={() => setClearConfirmOpen(true)}
              disabled={String(user?.role || '').toLowerCase() === 'manager'}
              className="rounded-xl border border-rose-500/50 bg-rose-500/10 px-5 py-3 font-bold text-rose-200 hover:bg-rose-500/25 active:scale-98 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-rose-500/10 disabled:active:scale-100"
              title={String(user?.role || '').toLowerCase() === 'manager' ? tx(lang, 'Yalnız adminlər üçün icazəlidir', 'Доступно только админам', 'Only available for admins') : ''}
            >
              {tx(lang, 'Bütün Reseptləri Sil', 'Очистить все Рецепты', 'Clear All Recipes')}
            </button>
          </div>
        </div>
      )}

      {/* Red Warning/Confirmation Modal */}
      {clearConfirmOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="metal-panel w-full max-w-md border-rose-500 p-6 shadow-2xl shadow-rose-950/50">
            <div className="mb-4 flex items-center gap-3 text-rose-400">
              <span className="text-3xl">⚠️</span>
              <h3 className="text-lg font-black uppercase tracking-wider">
                {tx(lang, 'Kritik Təsdiq', 'Критическое подтверждение', 'Critical Confirmation')}
              </h3>
            </div>
            
            <p className="text-sm text-slate-200 font-semibold leading-relaxed">
              {tx(
                lang,
                'Diqqət! Bu əməliyyat cari restorana (tenant-a) aid BÜTÜN reseptləri birdəfəlik siləcək. Bu əməliyyat geri qaytarıla bilməz!',
                'Внимание! Эта операция навсегда удалит ВСЕ рецепты для текущего ресторана. Это действие необратимо!',
                'Warning! This operation will permanently delete ALL recipes for the current restaurant. This action is irreversible!'
              )}
            </p>

            <div className="mt-4 flex flex-col gap-2">
              <label className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                {tx(lang, 'Təsdiqləmək üçün admin şifrəsini yazın:', 'Введите пароль админа для подтверждения:', 'Enter admin password to confirm:')}
              </label>
              <input
                type="password"
                className="neon-input border-rose-900/50 focus:border-rose-500"
                value={clearConfirmPassword}
                onChange={(e) => setClearConfirmPassword(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter') {
                    await handleClearRecipes();
                  }
                }}
                placeholder={tx(lang, 'Admin şifrəsi', 'Пароль администратора', 'Admin password')}
                disabled={isClearing}
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                className="neon-btn rounded-xl px-4 py-2.5 text-sm font-bold"
                onClick={() => {
                  setClearConfirmOpen(false);
                  setClearConfirmPassword('');
                }}
                disabled={isClearing}
              >
                {tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
              </button>
              <button
                className="rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-black text-white hover:bg-rose-500 active:scale-98 disabled:opacity-50"
                onClick={handleClearRecipes}
                disabled={isClearing || !clearConfirmPassword}
              >
                {isClearing 
                  ? tx(lang, 'Silinir...', 'Удаление...', 'Clearing...') 
                  : tx(lang, 'HƏ, RESEPTLƏRİ SİL', 'ДА, УДАЛИТЬ РЕЦЕПТЫ', 'YES, DELETE RECIPES')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

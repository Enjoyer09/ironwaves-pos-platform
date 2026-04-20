import { v4 as uuidv4 } from 'uuid';
import { logEvent } from '../lib/logger';
import { Decimal } from 'decimal.js';
import { RecipeIngredient } from '../types/inventory';
import { getDB, setDB } from '../lib/db_sim';
import { apiRequest, isBackendEnabled } from './client';
import { readScopedStorage } from '../lib/storage_keys';
import { get_inventory_items_live } from './inventory';
import { detectAiConfigFromApiKey } from '../lib/ai_config';

const getRecipes = (tenant_id: string = 'tenant_default') =>
  getDB<any>('recipes').filter((r) => !r.tenant_id || r.tenant_id === tenant_id);

const saveRecipes = (tenant_id: string, tenantRecipes: any[]) => {
  const all = getDB<any>('recipes').filter((r) => r.tenant_id && r.tenant_id !== tenant_id);
  setDB('recipes', [...all, ...tenantRecipes]);
};

const toDecimal = (value: any) => {
  if (Decimal.isDecimal(value)) return value;
  return new Decimal(value ?? 0);
};

type RecipeAIMenuContext = {
  category?: string;
  sell_price?: Decimal.Value;
};

const localInventoryForTenant = (tenant_id: string) => {
  const fromInventory = (getDB<any>('inventory') || []).filter((i) => !i?.tenant_id || i.tenant_id === tenant_id);
  if (fromInventory.length > 0) return fromInventory;
  return (getDB<any>('ingredients') || []).filter((i) => !i?.tenant_id || i.tenant_id === tenant_id);
};

const loadInventoryForAI = async (tenant_id: string) => {
  if (!isBackendEnabled()) return localInventoryForTenant(tenant_id);
  try {
    const liveRows = await get_inventory_items_live(tenant_id);
    if (Array.isArray(liveRows) && liveRows.length > 0) return liveRows;
  } catch {
    // fall through to local fallback
  }
  return localInventoryForTenant(tenant_id);
};

const scoreIngredient = (menuName: string, ingredientName: string) => {
  const m = menuName.toLowerCase();
  const i = ingredientName.toLowerCase();
  let score = 0;
  if (i.includes('kofe') || i.includes('qehve') || i.includes('qəhvə') || i.includes('coffee')) score += 5;
  if (i.includes('su') || i.includes('water')) score += 2;
  if (i.includes('sut') || i.includes('süd') || i.includes('milk')) score += 3;
  if (i.includes('sirop') || i.includes('syrup')) score += 2;
  if (i.includes('choco') || i.includes('şokolad')) score += 2;

  if (m.includes('americano')) {
    if (i.includes('kofe') || i.includes('qəhvə') || i.includes('coffee')) score += 4;
    if (i.includes('su') || i.includes('water')) score += 4;
  }
  if (m.includes('çay') || m.includes('cay') || m.includes('tea') || m.includes('jasmine') || m.includes('yasmin')) {
    if (i.includes('kofe') || i.includes('coffee') || i.includes('qəhvə')) score -= 10;
    if (i.includes('dondurma') || i.includes('ice cream')) score -= 10;
    if (i.includes('çay') || i.includes('tea') || i.includes('yasmin') || i.includes('jasmine')) score += 8;
    if (i.includes('su') || i.includes('water')) score += 4;
    if (i.includes('limon')) score += 2;
  }
  if (m.includes('latte') || m.includes('cappuccino') || m.includes('flat white')) {
    if (i.includes('süd') || i.includes('sut') || i.includes('milk')) score += 4;
    if (i.includes('kofe') || i.includes('coffee')) score += 3;
  }
  if (m.includes('mocha')) {
    if (i.includes('şokolad') || i.includes('choco')) score += 4;
  }
  return score;
};

const suggestQty = (ingredient: any) => {
  const name = String(ingredient?.name || '').toLowerCase();
  const unit = String(ingredient?.unit || '').toLowerCase();
  const isKg = unit.includes('kq') || unit.includes('kg');
  const isL = unit === 'l' || unit.includes(' litr') || unit.includes('liter');
  const isMl = unit.includes('ml');
  const isPiece = unit.includes('ədəd') || unit.includes('adet');

  if (name.includes('dondurma') || name.includes('ice cream')) {
    if (isL) return new Decimal(0.06); // 60 ml
    if (isMl) return new Decimal(60);
    return new Decimal(1);
  }
  if (name.includes('kofe') || name.includes('coffee') || name.includes('qəhvə')) {
    if (isKg) return new Decimal(0.018);
    if (isMl) return new Decimal(18);
    return new Decimal(18);
  }
  if (name.includes('süd') || name.includes('milk')) {
    if (isL) return new Decimal(0.12);
    if (isMl) return new Decimal(120);
    return new Decimal(0.12);
  }
  if (name.includes('su') || name.includes('water')) {
    if (isL) return new Decimal(0.2);
    if (isMl) return new Decimal(200);
    return new Decimal(0.2);
  }
  if (name.includes('sirop') || name.includes('syrup')) {
    if (isL) return new Decimal(0.015);
    if (isMl) return new Decimal(15);
    return new Decimal(0.015);
  }
  if (name.includes('çay') || name.includes('tea') || name.includes('yasmin') || name.includes('jasmine')) {
    if (isKg) return new Decimal(0.003);
    return new Decimal(0.003);
  }
  if (isPiece) return new Decimal(1);
  if (isMl) return new Decimal(10);
  if (isL) return new Decimal(0.01);
  if (isKg) return new Decimal(0.01);
  return new Decimal(0.01);
};

const normalizeQtyForUnit = (menuName: string, ingredient: any, rawQty: number) => {
  const unit = String(ingredient?.unit || '').toLowerCase();
  const name = String(ingredient?.name || '').toLowerCase();
  let qty = new Decimal(Number.isFinite(rawQty) ? rawQty : 0);

  // Heuristic: AI often returns ml/gram-like values while unit is L/KQ.
  if ((unit.includes('kq') || unit.includes('kg')) && qty.greaterThan(2)) {
    qty = qty.div(1000);
  }
  if ((unit === 'l' || unit.includes('litr') || unit.includes('liter')) && qty.greaterThan(2)) {
    qty = qty.div(1000);
  }

  // Product-specific guardrails.
  const m = menuName.toLowerCase();
  if (m.includes('affogato')) {
    if (name.includes('dondurma') || name.includes('ice cream')) {
      if (unit.includes('kq') || unit.includes('kg')) return new Decimal(0.08);
      if (unit === 'l' || unit.includes('litr') || unit.includes('liter')) return new Decimal(0.08);
      if (unit.includes('ml')) return new Decimal(80);
      return new Decimal(1);
    }
    if (name.includes('kofe') || name.includes('coffee') || name.includes('qəhvə')) {
      if (unit.includes('kq') || unit.includes('kg')) return new Decimal(0.018);
      if (unit.includes('ml')) return new Decimal(18);
      return new Decimal(18);
    }
  }

  // Clamp extreme values.
  if (unit.includes('kq') || unit.includes('kg')) {
    if (qty.lessThan(0.001)) qty = new Decimal(0.001);
    if (qty.greaterThan(0.5)) qty = new Decimal(0.5);
  } else if (unit === 'l' || unit.includes('litr') || unit.includes('liter')) {
    if (qty.lessThan(0.005)) qty = new Decimal(0.005);
    if (qty.greaterThan(1)) qty = new Decimal(1);
  } else if (unit.includes('ml')) {
    if (qty.lessThan(1)) qty = new Decimal(1);
    if (qty.greaterThan(500)) qty = new Decimal(500);
  }

  return qty;
};

const normalizeUnit = (value: string | undefined | null) => String(value || '').trim().toLowerCase();
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

const isAffogatoLike = (menuName: string) => /affogato|affagato/i.test(String(menuName || ''));

const menuSizeToken = (menuName: string) => {
  const normalized = normalizeText(menuName);
  if (/\b(s|small)\b/.test(normalized)) return 's';
  if (/\b(m|medium)\b/.test(normalized)) return 'm';
  if (/\b(l|large)\b/.test(normalized)) return 'l';
  return '';
};

const findInventoryByKeywords = (inventory: any[], keywords: string[], sizeToken: string) => {
  const normalizedRows = (inventory || []).map((item: any) => ({
    item,
    n: normalizeText(String(item?.name || '')),
  }));
  if (sizeToken) {
    const strict = normalizedRows.find((row) => keywords.every((k) => row.n.includes(normalizeText(k))) && new RegExp(`\\b${sizeToken}\\b`).test(row.n));
    if (strict) return strict.item;
  }
  const generic = normalizedRows.find((row) => keywords.every((k) => row.n.includes(normalizeText(k))));
  return generic?.item || null;
};

const ensureAffogatoPackagingRows = (
  menu_item_name: string,
  inventory: any[],
  aiRows: Array<{ ingredient: string; qty: number; qty_unit?: string }>,
) => {
  if (!isAffogatoLike(menu_item_name)) return aiRows;
  const sizeToken = menuSizeToken(menu_item_name);
  const cupItem = findInventoryByKeywords(inventory, ['stakan'], sizeToken) || findInventoryByKeywords(inventory, ['cup'], sizeToken);
  const lidItem = findInventoryByKeywords(inventory, ['qapaq'], sizeToken) || findInventoryByKeywords(inventory, ['lid'], sizeToken);
  if (!cupItem || !lidItem) {
    throw new Error('Affogato üçün kağız stəkan və qapaq anbarda tapılmadı. Anbara uyğun item əlavə edin (S/M/L varsa ölçü ilə).');
  }
  const existing = new Set(aiRows.map((row) => normalizeText(row.ingredient)));
  const nextRows = [...aiRows];
  if (!existing.has(normalizeText(String(cupItem.name)))) {
    nextRows.push({
      ingredient: String(cupItem.name),
      qty: 1,
      qty_unit: String(cupItem.unit || 'ədəd'),
    });
  }
  if (!existing.has(normalizeText(String(lidItem.name)))) {
    nextRows.push({
      ingredient: String(lidItem.name),
      qty: 1,
      qty_unit: String(lidItem.unit || 'ədəd'),
    });
  }
  return nextRows;
};

const convertQtyToInventoryUnit = (qty: Decimal, qtyUnit: string, inventoryUnit: string) => {
  const from = normalizeUnit(qtyUnit);
  const to = normalizeUnit(inventoryUnit);
  if (!from || from === to) return qty;

  const map: Record<string, Decimal> = {
    'qram->kq': new Decimal('0.001'),
    'gr->kq': new Decimal('0.001'),
    'g->kq': new Decimal('0.001'),
    'kq->qram': new Decimal('1000'),
    'kg->qram': new Decimal('1000'),
    'ml->litr': new Decimal('0.001'),
    'ml->l': new Decimal('0.001'),
    'litr->ml': new Decimal('1000'),
    'l->ml': new Decimal('1000'),
    'sm->metr': new Decimal('0.01'),
    'cm->metr': new Decimal('0.01'),
    'metr->sm': new Decimal('100'),
    'm->sm': new Decimal('100'),
  };

  const factor = map[`${from}->${to}`];
  if (!factor) return qty;
  return qty.mul(factor);
};

export function getRecipeEntryUnitOptions(baseUnit: string): string[] {
  const unit = String(baseUnit || '').trim().toLowerCase();
  if (unit === 'kq' || unit === 'kg') return ['qram', 'kq'];
  if (unit === 'litr' || unit === 'l' || unit === 'liter') return ['ml', 'litr'];
  if (unit === 'metr' || unit === 'm') return ['sm', 'metr'];
  return [String(baseUnit || '').trim() || 'ədəd'];
}

export function getDefaultRecipeEntryUnit(baseUnit: string): string {
  return getRecipeEntryUnitOptions(baseUnit)[0] || String(baseUnit || '').trim() || 'ədəd';
}

export function get_recipe(menu_item_name: string, tenant_id: string = 'tenant_default') {
  return getRecipes(tenant_id).filter((r) => r.menu_item_name === menu_item_name);
}

export async function get_recipe_live(menu_item_name: string, tenant_id: string = 'tenant_default') {
  if (!isBackendEnabled()) return get_recipe(menu_item_name, tenant_id);
  const rows = await apiRequest<any[]>(`/api/v1/catalog/recipes/${encodeURIComponent(menu_item_name)}`, { tenantId: null });
  const all = getDB<any>('recipes').filter((r) => r.tenant_id && r.tenant_id !== tenant_id);
  const othersForMenu = getDB<any>('recipes').filter((r) => !(String(r.tenant_id || '') === tenant_id && String(r.menu_item_name || '') === menu_item_name));
  setDB('recipes', [...all, ...othersForMenu.filter((r) => !r.tenant_id), ...rows.map((r) => ({ ...r, tenant_id: r?.tenant_id || tenant_id }))]);
  return rows;
}

export async function get_recipe_menu_names_live(tenant_id: string = 'tenant_default') {
  if (!isBackendEnabled()) {
    return Array.from(new Set(getRecipes(tenant_id).map((r) => String(r.menu_item_name || ''))));
  }
  const res = await apiRequest<{ menu_item_names: string[] }>('/api/v1/catalog/recipes', { tenantId: null });
  return Array.isArray(res?.menu_item_names) ? res.menu_item_names : [];
}

export function add_recipe_ingredient(data: {
  menu_item_name: string;
  ingredient_name: string;
  quantity_required: Decimal;
  unit: string;
  unit_cost: Decimal;
  quantity_unit?: string;
  tenant_id?: string;
}, user: string = 'system') {
  
  const tenant_id = data.tenant_id || 'tenant_default';
  const recipes = getRecipes(tenant_id);
  const qty = toDecimal(data.quantity_required);
  const unitCost = toDecimal(data.unit_cost);
  const line_cost = qty.mul(unitCost);
  const newItem: RecipeIngredient = {
    id: uuidv4(),
    ...(data as any),
    tenant_id,
    quantity_required: qty.toString() as any,
    unit_cost: unitCost.toString() as any,
    line_cost: line_cost.toString() as any
  };
  recipes.push(newItem);
  saveRecipes(tenant_id, recipes);
  logEvent(user, 'RECIPE_ADD', { menu_item_name: data.menu_item_name, ingredient_name: data.ingredient_name, qty: data.quantity_required.toString() });
  return newItem;
}

export async function add_recipe_ingredient_live(data: {
  menu_item_name: string;
  ingredient_name: string;
  quantity_required: Decimal;
  unit: string;
  unit_cost: Decimal;
  quantity_unit?: string;
  tenant_id?: string;
}, user: string = 'system') {
  if (!isBackendEnabled()) return add_recipe_ingredient(data, user);
  try {
    const created = await apiRequest<any>('/api/v1/catalog/recipes', {
      method: 'POST',
      tenantId: null,
      body: {
        menu_item_name: data.menu_item_name,
        ingredient_name: data.ingredient_name,
        quantity_required: new Decimal(data.quantity_required).toFixed(4),
        quantity_unit: data.quantity_unit || data.unit,
      },
    });
    const recipes = getRecipes(data.tenant_id || 'tenant_default').filter((r) => String(r.id) !== String(created?.id));
    saveRecipes(data.tenant_id || 'tenant_default', [...recipes, { ...created, tenant_id: created?.tenant_id || data.tenant_id || 'tenant_default' }]);
    return created;
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Recipe backend write failed: ${message}`);
  }
}

export function update_recipe_ingredient(recipe_id: string, quantity_required: Decimal, user: string = 'system', tenant_id: string = 'tenant_default') {
  const recipes = getRecipes(tenant_id);
  const index = recipes.findIndex(r => r.id === recipe_id);
  if (index === -1) throw new Error('Resept detalı tapılmadı');

  const qty = toDecimal(quantity_required);
  recipes[index].quantity_required = qty.toString();
  recipes[index].line_cost = qty.mul(new Decimal(recipes[index].unit_cost)).toString();
  saveRecipes(tenant_id, recipes);

  logEvent(user, 'RECIPE_EDIT', { recipe_id, new_qty: quantity_required.toString() });
  return recipes[index];
}

export function delete_recipe_ingredient(recipe_id: string, user: string = 'system', tenant_id: string = 'tenant_default') {
  let recipes = getRecipes(tenant_id);
  const recipe = recipes.find(r => r.id === recipe_id);
  if (!recipe) throw new Error('Resept detalı tapılmadı');

  recipes = recipes.filter(r => r.id !== recipe_id);
  saveRecipes(tenant_id, recipes);
  logEvent(user, 'RECIPE_DELETE', { recipe_id });
  return true;
}

export async function delete_recipe_ingredient_live(recipe_id: string, user: string = 'system', tenant_id: string = 'tenant_default') {
  if (!isBackendEnabled()) return delete_recipe_ingredient(recipe_id, user, tenant_id);
  try {
    await apiRequest(`/api/v1/catalog/recipes/${encodeURIComponent(recipe_id)}`, {
      method: 'DELETE',
      tenantId: null,
    });
    const recipes = getRecipes(tenant_id).filter((r) => String(r.id) !== String(recipe_id));
    saveRecipes(tenant_id, recipes);
    return true;
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Recipe backend delete failed: ${message}`);
  }
}

export async function replace_recipe_live(
  menu_item_name: string,
  ingredients: Array<{ ingredient_name: string; quantity_required: Decimal.Value; quantity_unit?: string }>,
  tenant_id: string = 'tenant_default',
) {
  if (!isBackendEnabled()) {
    const existing = get_recipe(menu_item_name, tenant_id);
    existing.forEach((row) => delete_recipe_ingredient(row.id, 'system', tenant_id));
    ingredients.forEach((row) => {
      add_recipe_ingredient(
        {
          menu_item_name,
          ingredient_name: row.ingredient_name,
          quantity_required: new Decimal(row.quantity_required),
          unit: row.quantity_unit || 'ədəd',
          unit_cost: new Decimal(0),
          quantity_unit: row.quantity_unit,
          tenant_id,
        },
        'system',
      );
    });
    return { success: true, count: ingredients.length };
  }
  try {
    return await apiRequest<{ success: boolean; count: number }>('/api/v1/catalog/recipes', {
      method: 'PUT',
      tenantId: null,
      body: {
        menu_item_name,
        ingredients: ingredients.map((row) => ({
          ingredient_name: row.ingredient_name,
          quantity_required: new Decimal(row.quantity_required).toFixed(4),
          quantity_unit: row.quantity_unit || null,
        })),
      },
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Recipe backend replace failed: ${message}`);
  }
}

export async function generate_recipe_ai(
  menu_item_name: string,
  user: string = 'system',
  tenant_id: string = 'tenant_default',
  context?: RecipeAIMenuContext,
) {
  const generated = await generate_recipe_ai_rows(menu_item_name, tenant_id, context);
  const generatedRows = generated.rows;
  const recipes = [
    ...getRecipes(tenant_id).filter((r) => r.menu_item_name !== menu_item_name),
    ...generatedRows,
  ];
  saveRecipes(tenant_id, recipes);
  logEvent(user, 'RECIPE_AI_CREATED', { menu_item_name, count: generatedRows.length, generation: generated.generation });
  return { recipe: get_recipe(menu_item_name, tenant_id), generation: generated.generation };
}

async function generate_recipe_ai_rows(
  menu_item_name: string,
  tenant_id: string = 'tenant_default',
  context?: RecipeAIMenuContext,
) {
  const settings = getDB<any>('settings') || [];
  const tenantSettings = settings.find((row: any) => row?.tenant_id === tenant_id);
  const aiKey = String(tenantSettings?.gemini_api_key || readScopedStorage('gemini_api_key') || '').trim();
  const detected = detectAiConfigFromApiKey(aiKey);
  const selectedProvider = String(
    tenantSettings?.ai_config?.provider
      || (tenantSettings?.ai_config?.ollama_freeapi_enabled ? 'ollama_freeapi' : detected.provider)
      || 'unknown',
  );
  const selectedModel = String(tenantSettings?.ai_config?.model || detected.model || 'gemini-1.5-flash');
  const canUseGeminiRemote = selectedProvider === 'google';
  let remoteGenerated = false;
  if (canUseGeminiRemote && !aiKey) {
    throw new Error('AI resept üçün əvvəlcə API key daxil edilməlidir.');
  }
  const inventory = await loadInventoryForAI(tenant_id);
  if (inventory.length === 0) {
    throw new Error('AI resept yaratmaq üçün anbarda xammal tapılmadı.');
  }

  const invNames = new Set(inventory.map((i: any) => String(i.name || '').trim().toLowerCase()));

  let aiRows: Array<{ ingredient: string; qty: number; qty_unit?: string }> = [];
  try {
    if (!canUseGeminiRemote) {
      throw new Error('REMOTE_PROVIDER_SKIPPED');
    }
    const invText = inventory
      .map((i: any) => `${i.name} (${i.unit || 'q'})`)
      .join(', ');

      const isTeaLike = /çay|cay|tea|jasmine|yasmin/i.test(menu_item_name);
      const rules = isTeaLike
        ? 'Do NOT use coffee, ice cream, milk for tea unless ingredient name explicitly says tea latte.'
        : 'Prefer matching beverage ingredients by name semantics.';
      const categoryText = String(context?.category || '').trim();
      const sellPrice = new Decimal(context?.sell_price || 0);
      const targetFoodCostPct =
        categoryText && /desert|şirniyyat|yemek|food|meal/i.test(categoryText) ? '25-40%' : '20-35%';

      const prompt = [
      `You are a senior restaurant R&D chef + cost controller.`,
      `Create a practical production recipe for menu item: ${menu_item_name}.`,
      categoryText ? `Menu category: ${categoryText}.` : '',
      sellPrice.gt(0) ? `Menu selling price: ${sellPrice.toFixed(2)} AZN.` : '',
      `Target theoretical food cost ratio: ${targetFoodCostPct}.`,
      `Use only these available ingredients: ${invText}.`,
      `Return quantities in realistic kitchen units and portions.`,
      `Respect world-class recipe practices: no impossible dose, no irrelevant ingredient, compact list (2-7 ingredients).`,
        rules,
      `Return strictly JSON array only. Example:`,
      `[ {"ingredient":"Qəhvə dənəsi","qty":0.018,"qty_unit":"kq"}, {"ingredient":"Su","qty":0.12,"qty_unit":"litr"} ]`,
      `No markdown, no explanation.`
    ].filter(Boolean).join('\n');

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent?key=${encodeURIComponent(aiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 }
      })
    });

    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const match = String(text).match(/\[[\s\S]*\]/);
      if (match?.[0]) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          aiRows = parsed
            .map((r: any) => ({
              ingredient: String(r?.ingredient || '').trim(),
              qty: Number(r?.qty || 0),
              qty_unit: String(r?.qty_unit || '').trim() || undefined,
            }))
            .filter((r) => r.ingredient && Number.isFinite(r.qty) && r.qty > 0)
            // inventory-də olmayan inqrediyenti qəbul etmə
            .filter((r) => invNames.has(r.ingredient.toLowerCase()));
          remoteGenerated = aiRows.length > 0;
        }
      }
    }
  } catch {
    // fallback below
  }

  // Fallback: AI cavabı boş/yanlış olarsa deterministik seçim.
  if (aiRows.length === 0) {
    const ranked = [...inventory]
      .map((item: any) => ({ item, score: scoreIngredient(menu_item_name, item.name) }))
      .sort((a: any, b: any) => b.score - a.score);
    const picked = ranked.filter((r: any) => r.score > 0).slice(0, 4).map((r: any) => r.item);
    const finalPicked = picked.length > 0 ? picked : inventory.slice(0, 3);
    aiRows = finalPicked.map((item: any) => ({
      ingredient: item.name,
      qty: Number(suggestQty(item).toString()),
      qty_unit: String(item.unit || ''),
    }));
  }

  // Tea-like məhsullarda alakasız ingredientləri çıxaraq.
  if (/çay|cay|tea|jasmine|yasmin/i.test(menu_item_name)) {
    aiRows = aiRows.filter((r) => {
      const n = r.ingredient.toLowerCase();
      if (n.includes('kofe') || n.includes('coffee') || n.includes('qəhvə')) return false;
      if (n.includes('dondurma') || n.includes('ice cream')) return false;
      return true;
    });
  }

  const normalizedAIRows = ensureAffogatoPackagingRows(menu_item_name, inventory, aiRows);
  const generatedRows = normalizedAIRows.flatMap((row) => {
    const item = inventory.find((i: any) => String(i.name).toLowerCase() === row.ingredient.toLowerCase());
    if (!item) return [];
    const rawQty = new Decimal(Number(row.qty || 0));
    const qtyInInventoryUnit = row.qty_unit
      ? convertQtyToInventoryUnit(rawQty, row.qty_unit, String(item.unit || ''))
      : rawQty;
    const qty = normalizeQtyForUnit(menu_item_name, item, Number(qtyInInventoryUnit.toString()));
    const unitCost = new Decimal(item.unit_cost || '0');
    const rowCost = qty.mul(unitCost);
    return [{
      id: uuidv4(),
      tenant_id,
      menu_item_name,
      ingredient_name: item.name,
      quantity_required: qty.toString(),
      unit: item.unit || 'q',
      unit_cost: unitCost.toString(),
      line_cost: rowCost.toString()
    }];
  });

  if (generatedRows.length === 0) {
    throw new Error('AI uyğun xammal seçə bilmədi. Əvvəl anbarda uyğun ingredient əlavə edin.');
  }

  return {
    rows: generatedRows,
    generation: {
      provider: selectedProvider,
      model: selectedModel,
      mode: remoteGenerated ? 'remote' : 'fallback',
    },
  };
}

export async function generate_recipe_ai_live(
  menu_item_name: string,
  user: string = 'system',
  tenant_id: string = 'tenant_default',
  context?: RecipeAIMenuContext,
) {
  if (!isBackendEnabled()) return generate_recipe_ai(menu_item_name, user, tenant_id, context);
  const generated = await generate_recipe_ai_rows(menu_item_name, tenant_id, context);
  await replace_recipe_live(
    menu_item_name,
    generated.rows.map((row) => ({
      ingredient_name: row.ingredient_name,
      quantity_required: row.quantity_required,
      quantity_unit: row.unit,
    })),
    tenant_id,
  );
  logEvent(user, 'RECIPE_AI_CREATED', { menu_item_name, count: generated.rows.length, mode: 'live', generation: generated.generation });
  return { recipe: await get_recipe_live(menu_item_name, tenant_id), generation: generated.generation };
}

export function analyze_recipe_ai(menu_item_name: string) {
  return "AI Tövsiyəsi: Mövcud reseptdə kofein miqdarı bir qədər yüksəkdir. Süd əlavəsini 20ml artırmaq məqsədəuyğundur.";
}

export function calculate_recipe_cost(menu_item_name: string, sell_price: Decimal, tenant_id: string = 'tenant_default') {
  const item_recipe = get_recipe(menu_item_name, tenant_id);
  const total_cost = item_recipe.reduce((acc, curr) => acc.plus(new Decimal(curr.line_cost)), new Decimal(0));
  
  const margin = sell_price.minus(total_cost);
  const margin_percent = sell_price.greaterThan(0) ? margin.div(sell_price).mul(100) : new Decimal(0);

  return { total_cost, margin, margin_percent };
}

export async function calculate_recipe_cost_live(menu_item_name: string, sell_price: Decimal, tenant_id: string = 'tenant_default') {
  const [recipe, inventory] = await Promise.all([
    get_recipe_live(menu_item_name, tenant_id),
    get_inventory_items_live(tenant_id),
  ]);
  const inventoryMap = new Map(
    (inventory || []).map((item: any) => [String(item.name || '').toLowerCase(), new Decimal(item.unit_cost || 0)]),
  );
  const total_cost = (recipe || []).reduce((acc, row: any) => {
    const unitCost = inventoryMap.get(String(row.ingredient_name || '').toLowerCase()) || new Decimal(row.unit_cost || 0);
    return acc.plus(new Decimal(row.quantity_required || 0).mul(unitCost));
  }, new Decimal(0));
  const margin = sell_price.minus(total_cost);
  const margin_percent = sell_price.greaterThan(0) ? margin.div(sell_price).mul(100) : new Decimal(0);
  return { total_cost, margin, margin_percent };
}

import { Decimal } from 'decimal.js';

export interface InventoryItem {
  id: string;
  name: string;
  stock_qty: Decimal;
  unit: string;
  category: string;
  type: string;
  unit_cost: Decimal;
  min_limit: Decimal;
}

export interface Combo {
  id: string;
  name: string;
  price: Decimal;
  selected_items: string[];
}

export interface RecipeIngredient {
  id: string;
  menu_item_name: string;
  ingredient_name: string;
  quantity_required: Decimal;
  unit: string;
  unit_cost: Decimal;
  line_cost: Decimal;
}

export interface Refund {
  id: string;
  sale_id: string;
  tenant_id?: string;
  refund_type: 'VOID' | 'PARTIAL';
  refund_amount: Decimal;
  reason: string;
  return_to_stock: boolean;
  performed_by: string;
  created_at: string;
}

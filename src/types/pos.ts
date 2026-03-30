import { Decimal } from 'decimal.js';

export type PaymentMethod = 'Nəğd' | 'Kart' | 'Split' | 'Staff';
export type RefundType = 'VOID' | 'PARTIAL';
export type CustomerType = 'Normal' | 'Golden' | 'Platinum' | 'Elite' | 'Tələbə' | 'Ikram';

export interface CartItem {
  id?: string;
  item_name: string;
  price: Decimal;
  qty: number;
  is_coffee: boolean;
  category: string;
}

export interface SalePayload {
  cart_items: CartItem[];
  payment_method: PaymentMethod;
  cashier: string;
  customer_card_id: string | null;
  reward_claim_code?: string | null;
  customer_type?: CustomerType;
  discount_percent: number;
  is_eco_cup: boolean;
  is_test: boolean;
  split_cash: Decimal | null;
  split_card: Decimal | null;
  card_tips: Decimal;
  tenant_id: string;
  order_type?: 'Dine In' | 'Take Away' | 'Order Online';
  cup_mode?: 'paper' | 'glass';
}

export interface Sale {
  id: string;
  receipt_code?: string;
  receipt_token?: string;
  tenant_id: string;
  created_at: string;
  cashier: string;
  customer_card_id: string | null;
  customer_type?: string;
  reward_claim_code?: string | null;
  original_total: string; // Decimal toString()
  discount_amount: string; // Decimal toString()
  total: string; // Decimal toString()
  cogs: string; // Decimal toString()
  payment_method: PaymentMethod;
  order_type?: 'Dine In' | 'Take Away' | 'Order Online';
  cup_mode?: 'paper' | 'glass';
  items?: CartItem[];
  customer_stars_after?: number;
  free_coffees_applied?: number;
  status: 'COMPLETED' | 'VOIDED' | 'PARTIAL_REFUND';
  is_test: boolean;
}

export interface FinanceEntry {
  id: string;
  tenant_id: string;
  sale_id?: string;
  type: 'in' | 'out';
  category: string; // e.g., 'Satış', 'Bank Komissiyası', 'Refund / Ləğv'
  amount: string; // Decimal toString()
  source: 'cash' | 'card' | 'debt' | 'investor' | 'safe';
  description: string;
  created_at: string;
  is_deleted: boolean;
}

export interface KitchenOrder {
  id: string;
  tenant_id: string;
  sale_id: string;
  table_label: string | null;
  order_type?: 'Dine In' | 'Take Away' | 'Order Online';
  status: 'NEW' | 'PREPARING' | 'READY' | 'DONE';
  priority: 'NORMAL' | 'URGENT';
  items: CartItem[];
  created_at: string;
  completed_at?: string;
}

export interface OfflineSale extends SalePayload {
  offline_id: string;
  timestamp: string;
}

// --- MODUL 12: CRM ---
export interface Customer {
  id: string;
  tenant_id: string;
  card_id: string;
  type: CustomerType;
  stars: number;
  secret_token: string;
  created_at: string;
}

export interface Notification {
  id: string;
  tenant_id: string;
  card_id: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

// --- MODUL 13: HAPPY HOUR ---
export interface HappyHour {
  id: string;
  tenant_id: string;
  name: string;
  start_time: string; // 'HH:mm'
  end_time: string;   // 'HH:mm'
  discount_percent: number;
  days_of_week: number[]; // 0=Sunday, 1=Monday...
  categories: string; // "ALL" or "Kofe,Frappe"
  is_active: boolean;
  created_at: string;
}

// --- MODUL 15: SETTINGS ---
export interface Settings {
  tenant_id: string;
  service_fee_percent: number;
  ui_visibility: {
    staff_show_tables: boolean;
    manager_show_tables: boolean;
    staff_show_kitchen: boolean;
  };
  time_settings: {
    shift_start_time: string;
    shift_end_time: string;
    utc_offset: number;
    timezone: string;
  };
  email_settings: {
    enabled?: boolean;
    provider?: 'none' | 'resend' | 'webhook';
    resend_api_key: string;
    sender_email: string;
    recipient_emails: string[];
    webhook_url?: string;
    timeout_sec?: number;
  };
  bank_commission: {
    min_amount: number;
    percent: number;
  };
  inventory_settings?: {
    default_critical_threshold: number;
    unit_options: string[];
  };
  staff_benefits?: {
    daily_limit_azn: number;
    allowed_scope: 'all' | 'categories' | 'items';
    included_categories: string[];
    included_items: string[];
    item_unit_cap_azn: number;
  };
  print_settings?: {
    use_qz: boolean;
    printer_name: string;
  };
  qr_settings?: {
    base_url: string;
  };
  customer_app_settings?: {
    enabled: boolean;
    program_mode?: 'points' | 'cashback';
    app_name: string;
    hero_title: string;
    hero_subtitle: string;
    points_label: string;
    reward_name: string;
    reward_threshold: number;
    reward_description: string;
    cashback_percent?: number;
    primary_color: string;
    accent_color: string;
    show_qr_card?: boolean;
    show_wallet?: boolean;
    show_campaigns: boolean;
    show_history: boolean;
    show_notifications: boolean;
  };
  omnitech_settings?: {
    enabled: boolean;
    api_base_url: string;
    api_key: string;
    merchant_id: string;
    terminal_id: string;
    fiscal_device_id: string;
  };
  role_modules?: {
    staff: string[];
    manager: string[];
    kitchen: string[];
  };
  gemini_api_key?: string;
}

// --- USER (İstifadəçi) ---
export interface User {
  id: string;
  tenant_id: string;
  username: string;
  role: 'super_admin' | 'admin' | 'manager' | 'staff' | 'kitchen';
  pin?: string;
  two_factor_enabled?: boolean;
  password?: string;
  failed_attempts: number;
  is_locked: boolean;
  lock_until?: string;
}

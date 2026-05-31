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
  seat_label?: string;
  cup_mode?: 'paper' | 'glass';
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

export type PosLayoutConfig = {
  preset: 'classic' | 'fast' | 'touch' | 'tables';
  density: 'compact' | 'comfortable' | 'large';
  product_columns: 2 | 3 | 4;
  show_cart_tabs: boolean;
  accent_color: string;
  hidden_widgets: string[];
  widget_order: string[];
  left_hidden_widgets?: string[];
  left_widget_order?: string[];
  widget_sizes?: Record<string, 'compact' | 'comfortable' | 'expanded'>;
  left_widget_sizes?: Record<string, 'compact' | 'comfortable' | 'expanded'>;
  panel_ratio?: '50:50' | '55:45' | '60:40' | '65:35' | '70:30';
  widget_options?: Record<string, any>;
  device_layouts?: {
    desktop?: Partial<PosLayoutConfig>;
    tablet?: Partial<PosLayoutConfig>;
  };
  role_overrides?: {
    staff?: Partial<PosLayoutConfig>;
    manager?: Partial<PosLayoutConfig>;
  };
};

// --- MODUL 15: SETTINGS ---
export interface Settings {
  tenant_id: string;
  service_fee_percent: number;
  table_service_settings?: {
    deposit_per_guest_azn: number;
    reservation_lock_hours?: number;
  };
  yield_management_settings?: {
    enabled: boolean;
    variance_tolerance_percent: number;
    profiles?: Record<string, { raw_to_ready_ratio: number; loss_min_percent: number; loss_max_percent: number }>;
    tracked_items?: Array<{
      inventory_name: string;
      meat_type: string;
      raw_to_ready_ratio: number;
      enabled?: boolean;
    }>;
  };
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
  session_settings?: {
    idle_logout_minutes: number;
    virtual_keyboard_enabled?: boolean;
    staff_pin_length?: 4 | 6;
    theme_mode?: 'dark' | 'light';
    ui_mode?: 'old' | 'new';
  };
  beverage_service_settings?: {
    coffee_selection_mode: 'size_only' | 'size_and_service';
    remove_paper_packaging_for_table: boolean;
    discount_scope?: 'all_items' | 'coffee_only';
  };
  z_report_receipt_settings?: {
    show_operator: boolean;
    show_date_range: boolean;
    show_sales_summary: boolean;
    show_profit_summary: boolean;
    show_wage: boolean;
    show_shift_cash: boolean;
    show_cash_movements: boolean;
    show_other_income: boolean;
    show_other_expense: boolean;
    show_deposit_summary: boolean;
    show_cashier_breakdown: boolean;
    show_item_breakdown: boolean;
    show_counts: boolean;
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
    min_amount?: number;
    percent?: number;
    card_sale_percent?: number;
    card_transfer_percent?: number;
  };
  finance_policy?: {
    large_transfer_threshold_azn: number;
    investor_repayment_requires_approval: boolean;
    cash_adjustment_requires_approval: boolean;
    reversal_requires_approval: boolean;
    reconciliation_adjustment_requires_approval: boolean;
    reconciliation_variance_alert_azn: number;
    negative_balance_alert_azn: number;
    approver_roles: string[];
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
  qr_menu_settings?: {
    enabled: boolean;
    hero_title: string;
    hero_subtitle: string;
    show_prices: boolean;
    show_images: boolean;
    show_descriptions: boolean;
    poster_title: string;
    poster_subtitle: string;
    background_color?: string;
    surface_color?: string;
    text_color?: string;
    primary_color?: string;
    accent_color?: string;
    hero_image_url?: string;
    poster_image_url?: string;
    poster_background_color?: string;
    logo_shape?: 'rounded' | 'circle' | 'square';
  };
  feedback_settings?: {
    enabled: boolean;
    promo_enabled?: boolean;
    coupon_percent?: number;
    portal_url?: string;
    google_review_url?: string;
    receipt_button_text_az?: string;
    receipt_button_text_ru?: string;
    receipt_button_text_en?: string;
    receipt_qr_prompt_az?: string;
    receipt_qr_prompt_ru?: string;
    receipt_qr_prompt_en?: string;
    thank_you_text_az?: string;
    thank_you_text_ru?: string;
    thank_you_text_en?: string;
  };
  customer_app_settings?: {
    enabled: boolean;
    program_mode?: 'points' | 'cashback';
    layout_preset?: 'rewards' | 'cashback' | 'playful';
    consent_text?: string;
    join_customer_type?: string;
    join_discount_percent?: number;
    app_name: string;
    hero_title: string;
    hero_subtitle: string;
    hero_image_url?: string;
    background_image_url?: string;
    background_color?: string;
    points_label: string;
    reward_name: string;
    reward_threshold: number;
    reward_description: string;
    reward_card_style?: 'rounded' | 'soft-square' | 'glass';
    cashback_percent?: number;
    primary_color: string;
    accent_color: string;
    show_qr_card?: boolean;
    show_wallet?: boolean;
    ai_barista_enabled?: boolean;
    ai_falci_enabled?: boolean;
    show_campaigns: boolean;
    show_history: boolean;
    show_notifications: boolean;
  };
  pos_layout?: PosLayoutConfig;
  pos_layout_draft?: PosLayoutConfig;
  landing_settings?: {
    nav_product_az?: string;
    nav_product_ru?: string;
    nav_product_en?: string;
    nav_how_az?: string;
    nav_how_ru?: string;
    nav_how_en?: string;
    nav_modules_az?: string;
    nav_modules_ru?: string;
    nav_modules_en?: string;
    nav_contact_az?: string;
    nav_contact_ru?: string;
    nav_contact_en?: string;
    hero_title_az?: string;
    hero_title_ru?: string;
    hero_title_en?: string;
    hero_body_az?: string;
    hero_body_ru?: string;
    hero_body_en?: string;
    primary_cta_az?: string;
    primary_cta_ru?: string;
    primary_cta_en?: string;
    secondary_cta_az?: string;
    secondary_cta_ru?: string;
    secondary_cta_en?: string;
    contact_email?: string;
    contact_phone?: string;
    contact_whatsapp?: string;
    hero_image_url?: string;
    modules_title_az?: string;
    modules_title_ru?: string;
    modules_title_en?: string;
    footer_text_az?: string;
    footer_text_ru?: string;
    footer_text_en?: string;
    screenshot_items?: Array<{
      image_url?: string;
      title_az?: string;
      title_ru?: string;
      title_en?: string;
      desc_az?: string;
      desc_ru?: string;
      desc_en?: string;
    }>;
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
  ai_config?: {
    provider?: 'google' | 'openai' | 'anthropic' | 'openrouter' | 'xai' | 'huggingface' | 'ollama' | 'ollama_freeapi' | 'opencode' | 'unknown';
    model?: string;
    autodetected?: boolean;
    ollama_freeapi_enabled?: boolean;
    updated_at?: string;
  };
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

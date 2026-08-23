// Shared types and constants for Settings Panel section components

import type { ReactNode } from 'react';

export interface PrintSettingsState {
  use_qz: boolean;
  printer_name: string;
  kitchen_printer_name: string;
  auto_print_kitchen_ticket: boolean;
  auto_print_receipt: boolean;
  paper_width: '58mm' | '80mm';
  print_engine: 'pixel_html' | 'raw_escpos';
}

export interface ZReportReceiptSettingsState {
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
}

export interface SessionSettingsState {
  idle_logout_minutes: string;
  virtual_keyboard_enabled: boolean;
  staff_pin_length: 4 | 6;
  theme_mode: 'dark' | 'light';
  ui_mode: 'old';
  login_background_url: string;
}

export interface BeverageServiceSettingsState {
  coffee_selection_mode: 'size_only' | 'size_and_service';
  remove_paper_packaging_for_table: boolean;
  discount_scope: 'all_items' | 'coffee_only';
  summer_promo_enabled: boolean;
}

export interface TableServiceSettingsState {
  service_fee_percent: string;
  deposit_per_guest_azn: string;
  reservation_lock_hours: string;
}

export interface BankCommissionState {
  card_sale_percent: string;
  card_transfer_percent: string;
}

export interface FinancePolicyState {
  large_transfer_threshold_azn: string;
  investor_repayment_requires_approval: boolean;
  cash_adjustment_requires_approval: boolean;
  reversal_requires_approval: boolean;
  reconciliation_adjustment_requires_approval: boolean;
  reconciliation_variance_alert_azn: string;
  negative_balance_alert_azn: string;
  approver_roles: string;
}

export interface YieldManagementState {
  enabled: boolean;
  variance_tolerance_percent: string;
  beef_ratio: string;
  beef_loss_min_percent: string;
  beef_loss_max_percent: string;
  chicken_ratio: string;
  chicken_loss_min_percent: string;
  chicken_loss_max_percent: string;
  tracked_items: Array<{
    inventory_name: string;
    meat_type: 'beef' | 'chicken';
    raw_to_ready_ratio: string;
    enabled: boolean;
  }>;
}

export interface StaffBenefitsState {
  daily_limit_azn: string;
  allowed_scope: 'all' | 'categories' | 'items';
  included_categories: string[];
  included_items: string[];
  item_unit_cap_azn: string;
  coffee_unit_cap_azn: string;
  other_unit_cap_azn: string;
}

export type RoleModules = { staff: string[]; manager: string[]; kitchen: string[] };

export interface DeliveryIntegrationsState {
  bolt_food_enabled: boolean;
  bolt_food_provider_id: string;
  bolt_food_secret_key: string;
  wolt_enabled: boolean;
  wolt_venue_id: string;
  wolt_client_secret: string;
}

export interface QrMenuSettingsState {
  enabled: boolean;
  hero_title: string;
  hero_subtitle: string;
  show_prices: boolean;
  show_images: boolean;
  show_descriptions: boolean;
  poster_title: string;
  poster_subtitle: string;
  background_color: string;
  surface_color: string;
  text_color: string;
  primary_color: string;
  accent_color: string;
  hero_image_url: string;
  poster_image_url: string;
  poster_background_color: string;
  logo_shape: 'rounded' | 'circle' | 'square';
  font_family: string;
  custom_font_url: string;
  theme_preset: 'dark' | 'light' | 'emerald' | 'custom';
  layout_preset: 'classic' | 'bolt';
  splash_type: string;
  splash_url: string;
  splash_duration_ms: number;
  splash_overlay_text: string;
  splash_bg_color: string;
}

export interface FeedbackSettingsState {
  enabled: boolean;
  promo_enabled: boolean;
  coupon_percent: number;
  portal_url: string;
  google_review_url: string;
  receipt_button_text_az: string;
  receipt_button_text_ru: string;
  receipt_button_text_en: string;
  receipt_qr_prompt_az: string;
  receipt_qr_prompt_ru: string;
  receipt_qr_prompt_en: string;
  thank_you_text_az: string;
  thank_you_text_ru: string;
  thank_you_text_en: string;
  bg_gradient: string;
  primary_color: string;
  accent_color: string;
  emoji_icon: string;
  preset_tags: string[];
  min_stars_for_google_review: number;
  required_comment_threshold: number;
  custom_heading_az: string;
  custom_heading_ru: string;
  custom_heading_en: string;
  custom_subheading_az: string;
  custom_subheading_ru: string;
  custom_subheading_en: string;
}

// ─── Shared Constants ─────────────────────────────────────────────────────────

export const YIELD_PRESETS = {
  beef: { ratio: '1.4', min: '30', max: '40' },
  chicken: { ratio: '1.33', min: '25', max: '35' },
} as const;

export const defaultRoleModules: RoleModules = {
  staff: ['pos', 'tables', 'kds', 'zreport'],
  manager: ['pos', 'tables', 'kds', 'zreport', 'finance', 'inventory', 'combos', 'analytics', 'logs', 'crm', 'customerapp', 'ai', 'menu', 'recipes'],
  kitchen: ['kds'],
};

export const moduleCatalog = ['pos', 'tables', 'kds', 'zreport', 'finance', 'inventory', 'combos', 'analytics', 'logs', 'crm', 'customerapp', 'ai', 'menu', 'recipes'];

export const roleLabelMap: Record<'staff' | 'manager' | 'kitchen', string> = {
  staff: 'Ofisiant / Kassir',
  manager: 'Menecer',
  kitchen: 'Mətbəx',
};

export const moduleLabelMap: Record<string, string> = {
  pos: 'POS',
  tables: 'Masalar',
  kds: 'Mətbəx ekranı',
  zreport: 'Z-Hesabat',
  finance: 'Maliyyə',
  inventory: 'Anbar',
  combos: 'Kombolar',
  analytics: 'Analitika',
  logs: 'Loqlar',
  crm: 'CRM',
  customerapp: 'Müştəri tətbiqi',
  ai: 'AI menecer',
  menu: 'Menyu',
  recipes: 'Reseptlər',
};

// ─── Shared Section Props ─────────────────────────────────────────────────────

export interface BaseSectionProps {
  lang: string;
  saveButtonClass: string;
  renderPanelSuccess: (panelKey: string) => ReactNode;
  notify: (type: 'success' | 'error' | 'info', message: string) => void;
}

import { v4 as uuidv4 } from 'uuid';
import { getDB, setDB } from '../lib/db_sim';
import { logEvent } from '../lib/logger';
import { PosLayoutConfig, Settings, User } from '../types/pos';
import { getActiveTenantId } from '../lib/tenant';
import { apiRequest, isBackendEnabled } from './client';
import { hashLocalCredential } from '../lib/local_auth';
import { readScopedStorage, removeScopedStorage } from '../lib/storage_keys';
import { clearOfflineSalesStore } from '../lib/offline';

const resolveTenant = (tenant_id?: string) => tenant_id || getActiveTenantId();

const DEFAULT_POS_LAYOUT: PosLayoutConfig = {
  preset: 'classic',
  density: 'comfortable',
  product_columns: 3,
  show_cart_tabs: true,
  accent_color: '#facc15',
  hidden_widgets: [],
  widget_order: ['customer', 'discount', 'orderType', 'table', 'cartItems', 'cartSummary', 'payments'],
  left_hidden_widgets: [],
  left_widget_order: ['menuHeader', 'search', 'categories', 'productGrid'],
  widget_sizes: {},
  left_widget_sizes: {},
  device_layouts: {
    desktop: {},
    tablet: {
      preset: 'touch',
      density: 'large',
      product_columns: 2,
      left_hidden_widgets: [],
      left_widget_order: ['search', 'categories', 'productGrid'],
      widget_sizes: {},
      left_widget_sizes: {},
    },
  },
  role_overrides: {
    staff: {},
    manager: {},
  },
};

const DEFAULT_LANDING_SCREENSHOTS = [
  {
    image_url: '/landing/pos-screen.png',
    title_az: 'POS Ekranı',
    title_ru: 'Экран POS',
    title_en: 'POS Screen',
    desc_az: 'Sürətli sifariş və ödəniş axını',
    desc_ru: 'Быстрый поток заказов и оплат',
    desc_en: 'Fast order and payment flow',
  },
  {
    image_url: '/landing/finance-screen.png',
    title_az: 'Maliyyə Ekranı',
    title_ru: 'Экран финансов',
    title_en: 'Finance Screen',
    desc_az: 'Kassa, depozit və investor borcu nəzarəti',
    desc_ru: 'Контроль кассы, депозитов и долга инвестору',
    desc_en: 'Cash, deposits and investor liability control',
  },
  {
    image_url: '/landing/golden-card.png',
    title_az: 'Golden Card',
    title_ru: 'Golden Card',
    title_en: 'Golden Card',
    desc_az: 'Loyallıq kartı və bonus ssenariləri',
    desc_ru: 'Сценарии лояльности и бонусных карт',
    desc_en: 'Loyalty card and bonus scenarios',
  },
  {
    image_url: '/landing/elite-card.png',
    title_az: 'Elite Card',
    title_ru: 'Elite Card',
    title_en: 'Elite Card',
    desc_az: 'VIP müştəri segmenti və üstünlüklər',
    desc_ru: 'VIP-сегмент клиентов и привилегии',
    desc_en: 'VIP customer segment and privileges',
  },
];

const DEFAULT_LANDING_SETTINGS: NonNullable<Settings['landing_settings']> = {
  nav_product_az: 'Məhsul',
  nav_product_ru: 'Продукт',
  nav_product_en: 'Product',
  nav_how_az: 'Necə işləyir',
  nav_how_ru: 'Как работает',
  nav_how_en: 'How it works',
  nav_modules_az: 'Modullar',
  nav_modules_ru: 'Модули',
  nav_modules_en: 'Modules',
  nav_contact_az: 'Əlaqə',
  nav_contact_ru: 'Контакт',
  nav_contact_en: 'Contact',
  hero_title_az: 'Restoranınızı bir platformadan idarə edin',
  hero_title_ru: 'Управляйте рестораном с одной платформы',
  hero_title_en: 'Run your restaurant from one platform',
  hero_body_az: 'POS, Masalar, Mətbəx, Maliyyə, Dashboard, Analitika, CRM, QR Menu və Audit bir sistemdə.',
  hero_body_ru: 'POS, Столы, Кухня, Финансы, Dashboard, Аналитика, CRM, QR Menu и Audit в одной системе.',
  hero_body_en: 'POS, Tables, Kitchen, Finance, Dashboard, Analytics, CRM, QR Menu and Audit in one system.',
  primary_cta_az: 'Demoya keç',
  primary_cta_ru: 'Перейти к демо',
  primary_cta_en: 'Go to demo',
  secondary_cta_az: 'Ətraflı bax',
  secondary_cta_ru: 'Подробнее',
  secondary_cta_en: 'Learn more',
  contact_email: 'abbas@laptopmarket.az',
  contact_phone: '+99455 299-92-82',
  contact_whatsapp: '+99455 299-92-82',
  hero_image_url: '/landing/pos-screen.png',
  modules_title_az: 'Bütün əsas modullar eyni platformada',
  modules_title_ru: 'Все ключевые модули в одной платформе',
  modules_title_en: 'All core modules in one platform',
  footer_text_az: 'ironWaves POS bir Laptop Market məhsuludur. www.laptopmarket.az',
  footer_text_ru: 'ironWaves POS — продукт Laptop Market. www.laptopmarket.az',
  footer_text_en: 'ironWaves POS is a Laptop Market product. www.laptopmarket.az',
  screenshot_items: DEFAULT_LANDING_SCREENSHOTS,
};

function normalizeLandingSettings(source?: Settings['landing_settings']): NonNullable<Settings['landing_settings']> {
  const raw = source || {};
  const screenshot_items = Array.isArray(raw.screenshot_items) && raw.screenshot_items.length
    ? raw.screenshot_items
        .slice(0, 8)
        .map((item: any) => ({
          image_url: String(item?.image_url || '').trim(),
          title_az: String(item?.title_az || '').trim(),
          title_ru: String(item?.title_ru || '').trim(),
          title_en: String(item?.title_en || '').trim(),
          desc_az: String(item?.desc_az || '').trim(),
          desc_ru: String(item?.desc_ru || '').trim(),
          desc_en: String(item?.desc_en || '').trim(),
        }))
        .filter((item) => item.image_url)
    : DEFAULT_LANDING_SCREENSHOTS;

  return {
    ...DEFAULT_LANDING_SETTINGS,
    ...raw,
    screenshot_items,
  };
}

const POS_RIGHT_WIDGET_KEYS = ['customer', 'discount', 'orderType', 'table', 'cartItems', 'cartSummary', 'payments'] as const;
const POS_LEFT_WIDGET_KEYS = ['menuHeader', 'search', 'categories', 'productGrid'] as const;
const POS_REQUIRED_RIGHT_WIDGETS = ['cartItems', 'cartSummary', 'payments'] as const;
const POS_REQUIRED_LEFT_WIDGETS = ['productGrid'] as const;

function ensureKnownWidgetOrder(
  raw: any,
  fallback: readonly string[],
  allowed: readonly string[],
): string[] {
  const preferred = Array.isArray(raw) ? raw : [];
  const merged = [...preferred, ...fallback, ...allowed].map((v) => String(v || '').trim()).filter(Boolean);
  const seen = new Set<string>();
  return merged.filter((key) => {
    if (!allowed.includes(key as any) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizePosLayoutConfig(source: any, fallback?: Partial<PosLayoutConfig>): PosLayoutConfig {
  const base = fallback || {};
  const widget_order = ensureKnownWidgetOrder(
    source?.widget_order,
    ((base.widget_order as string[] | undefined) || DEFAULT_POS_LAYOUT.widget_order),
    POS_RIGHT_WIDGET_KEYS,
  );
  const left_widget_order = ensureKnownWidgetOrder(
    source?.left_widget_order,
    ((base.left_widget_order as string[] | undefined) || DEFAULT_POS_LAYOUT.left_widget_order || []),
    POS_LEFT_WIDGET_KEYS,
  );
  const hidden_widgets = Array.from(
    new Set(((source?.hidden_widgets) || (base.hidden_widgets as string[] | undefined) || []).map((v: any) => String(v || '').trim()).filter(Boolean)),
  )
    .filter((key) => POS_RIGHT_WIDGET_KEYS.includes(key as any))
    .filter((key) => !POS_REQUIRED_RIGHT_WIDGETS.includes(key as any));
  const left_hidden_widgets = Array.from(
    new Set(((source?.left_hidden_widgets) || (base.left_hidden_widgets as string[] | undefined) || []).map((v: any) => String(v || '').trim()).filter(Boolean)),
  )
    .filter((key) => POS_LEFT_WIDGET_KEYS.includes(key as any))
    .filter((key) => !POS_REQUIRED_LEFT_WIDGETS.includes(key as any));

  const cleaned: PosLayoutConfig = {
    preset: source?.preset === 'fast' || source?.preset === 'touch' || source?.preset === 'tables' ? source.preset : (base.preset === 'fast' || base.preset === 'touch' || base.preset === 'tables' ? base.preset : 'classic'),
    density: source?.density === 'compact' || source?.density === 'large' ? source.density : (base.density === 'compact' || base.density === 'large' ? base.density : 'comfortable'),
    product_columns: source?.product_columns === 2 || source?.product_columns === 4 ? source.product_columns : (base.product_columns === 2 || base.product_columns === 4 ? base.product_columns : 3),
    show_cart_tabs: source?.show_cart_tabs !== false,
    accent_color: String(source?.accent_color || base.accent_color || '').trim() || '#facc15',
    hidden_widgets,
    widget_order,
    left_hidden_widgets,
    left_widget_order,
    widget_sizes: Object.fromEntries(
      Object.entries(source?.widget_sizes || base.widget_sizes || {}).map(([key, value]) => [
        String(key),
        value === 'compact' || value === 'expanded' ? value : 'comfortable',
      ]),
    ) as Record<string, 'compact' | 'comfortable' | 'expanded'>,
    left_widget_sizes: Object.fromEntries(
      Object.entries(source?.left_widget_sizes || base.left_widget_sizes || {}).map(([key, value]) => [
        String(key),
        value === 'compact' || value === 'expanded' ? value : 'comfortable',
      ]),
    ) as Record<string, 'compact' | 'comfortable' | 'expanded'>,
    panel_ratio: source?.panel_ratio || base.panel_ratio || '50:50',
    widget_options: source?.widget_options || base.widget_options || {},
    role_overrides: {
      staff: source?.role_overrides?.staff ? normalizePosLayoutConfig(source.role_overrides.staff, base) : {},
      manager: source?.role_overrides?.manager ? normalizePosLayoutConfig(source.role_overrides.manager, base) : {},
    },
    device_layouts: {
      desktop: {},
      tablet: {},
    },
  };

  const deviceLayouts = source?.device_layouts || {};
  cleaned.device_layouts = {
    desktop: deviceLayouts.desktop ? normalizePosLayoutConfig(deviceLayouts.desktop, cleaned) : {},
    tablet: deviceLayouts.tablet ? normalizePosLayoutConfig(deviceLayouts.tablet, cleaned) : {},
  };

  return cleaned;
}

const DEFAULT_FINANCE_POLICY: NonNullable<Settings['finance_policy']> = {
  large_transfer_threshold_azn: 500,
  investor_repayment_requires_approval: true,
  cash_adjustment_requires_approval: true,
  reversal_requires_approval: true,
  reconciliation_adjustment_requires_approval: true,
  reconciliation_variance_alert_azn: 0.01,
  negative_balance_alert_azn: 0,
  approver_roles: ['manager', 'admin', 'finance_admin', 'super_admin'],
};

const DEFAULT_BEVERAGE_SERVICE_SETTINGS: NonNullable<Settings['beverage_service_settings']> = {
  coffee_selection_mode: 'size_and_service',
  remove_paper_packaging_for_table: true,
  discount_scope: 'all_items',
};

const DEFAULT_Z_REPORT_RECEIPT_SETTINGS: NonNullable<Settings['z_report_receipt_settings']> = {
  show_operator: true,
  show_date_range: true,
  show_sales_summary: true,
  show_profit_summary: true,
  show_wage: true,
  show_shift_cash: true,
  show_cash_movements: true,
  show_other_income: true,
  show_other_expense: true,
  show_deposit_summary: true,
  show_cashier_breakdown: true,
  show_item_breakdown: true,
  show_counts: true,
};

const DEFAULT_FEEDBACK_SETTINGS: NonNullable<Settings['feedback_settings']> = {
  enabled: false,
  promo_enabled: true,
  coupon_percent: 5,
  portal_url: '',
  google_review_url: '',
  receipt_button_text_az: 'Rəy bildirin',
  receipt_button_text_ru: 'Оставить отзыв',
  receipt_button_text_en: 'Leave feedback',
  receipt_qr_prompt_az: 'Rəyiniz bizim üçün çox önəmlidir, lütfən QR skan edib rəyinizi bildirin.',
  receipt_qr_prompt_ru: 'Ваше мнение очень важно для нас. Пожалуйста, отсканируйте QR и оставьте отзыв.',
  receipt_qr_prompt_en: 'Your feedback matters to us. Please scan the QR code and share your review.',
  thank_you_text_az: 'Rəyiniz komanda tərəfindən nəzərdən keçiriləcək.',
  thank_you_text_ru: 'Ваш отзыв будет рассмотрен нашей командой.',
  thank_you_text_en: 'Your feedback will be reviewed by our team.',
};

const FEEDBACK_SETTINGS_OVERRIDES_KEY = 'iw_feedback_settings_overrides_v1';

function normalizeFeedbackSettings(source?: Settings['feedback_settings']): NonNullable<Settings['feedback_settings']> {
  const raw = source || {};
  const rawEnabled = (raw as any).enabled;
  const enabledNormalized =
    rawEnabled === true ||
    rawEnabled === 1 ||
    rawEnabled === '1' ||
    String(rawEnabled || '').toLowerCase() === 'true' ||
    String(rawEnabled || '').toLowerCase() === 'yes' ||
    String(rawEnabled || '').toLowerCase() === 'on';
  return {
    ...DEFAULT_FEEDBACK_SETTINGS,
    ...raw,
    enabled: enabledNormalized,
    promo_enabled: raw.promo_enabled !== false,
    coupon_percent: Math.max(1, Math.min(100, Number(raw.coupon_percent ?? DEFAULT_FEEDBACK_SETTINGS.coupon_percent) || DEFAULT_FEEDBACK_SETTINGS.coupon_percent)),
    portal_url: String(raw.portal_url || '').trim(),
    google_review_url: String(raw.google_review_url || '').trim(),
    receipt_button_text_az: String(raw.receipt_button_text_az || DEFAULT_FEEDBACK_SETTINGS.receipt_button_text_az).trim(),
    receipt_button_text_ru: String(raw.receipt_button_text_ru || DEFAULT_FEEDBACK_SETTINGS.receipt_button_text_ru).trim(),
    receipt_button_text_en: String(raw.receipt_button_text_en || DEFAULT_FEEDBACK_SETTINGS.receipt_button_text_en).trim(),
    receipt_qr_prompt_az: String(raw.receipt_qr_prompt_az || DEFAULT_FEEDBACK_SETTINGS.receipt_qr_prompt_az).trim(),
    receipt_qr_prompt_ru: String(raw.receipt_qr_prompt_ru || DEFAULT_FEEDBACK_SETTINGS.receipt_qr_prompt_ru).trim(),
    receipt_qr_prompt_en: String(raw.receipt_qr_prompt_en || DEFAULT_FEEDBACK_SETTINGS.receipt_qr_prompt_en).trim(),
    thank_you_text_az: String(raw.thank_you_text_az || DEFAULT_FEEDBACK_SETTINGS.thank_you_text_az).trim(),
    thank_you_text_ru: String(raw.thank_you_text_ru || DEFAULT_FEEDBACK_SETTINGS.thank_you_text_ru).trim(),
    thank_you_text_en: String(raw.thank_you_text_en || DEFAULT_FEEDBACK_SETTINGS.thank_you_text_en).trim(),
  };
}

function readFeedbackOverrides(): Record<string, NonNullable<Settings['feedback_settings']>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(FEEDBACK_SETTINGS_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, any>).map(([tenant, value]) => [tenant, normalizeFeedbackSettings(value)]),
    );
  } catch {
    return {};
  }
}

function writeFeedbackOverride(tenantId: string, value: NonNullable<Settings['feedback_settings']>) {
  if (typeof window === 'undefined' || !tenantId) return;
  try {
    const current = readFeedbackOverrides();
    current[tenantId] = normalizeFeedbackSettings(value);
    window.localStorage.setItem(FEEDBACK_SETTINGS_OVERRIDES_KEY, JSON.stringify(current));
  } catch {
    // no-op
  }
}

// Mərkəzi settings obyektini tapmaq (ya da yaratmaq) üçün kiçik helper:
function getSettings(tenant_id?: string): Settings {
  const resolvedTenant = resolveTenant(tenant_id);
  const settingsArr = getDB<Settings>('settings');
  const current = settingsArr.find((s) => s.tenant_id === resolvedTenant);
  if (current) return current;

  // Return a static default and cache it in memCache (without localStorage write).
  // This prevents get_settings normalization from calling saveSettings 30+ times per render.
  const defaultSettings: Settings = {
    tenant_id: resolvedTenant,
    service_fee_percent: 0,
    table_service_settings: { deposit_per_guest_azn: 0, reservation_lock_hours: 2 },
    yield_management_settings: {
      enabled: false,
      variance_tolerance_percent: 5,
      profiles: {
        beef: { raw_to_ready_ratio: 1.4, loss_min_percent: 30, loss_max_percent: 40 },
        chicken: { raw_to_ready_ratio: 1.33, loss_min_percent: 25, loss_max_percent: 35 },
      },
      tracked_items: [],
    },
    ui_visibility: { staff_show_tables: true, manager_show_tables: true, staff_show_kitchen: true },
    time_settings: { shift_start_time: '08:00', shift_end_time: '23:00', utc_offset: 4, timezone: 'Asia/Baku' },
    session_settings: {
      idle_logout_minutes: 0,
      virtual_keyboard_enabled: true,
      staff_pin_length: 4,
      theme_mode: 'dark',
      ui_mode: 'old',
    },
    beverage_service_settings: DEFAULT_BEVERAGE_SERVICE_SETTINGS,
    z_report_receipt_settings: DEFAULT_Z_REPORT_RECEIPT_SETTINGS,
    email_settings: {
      enabled: false,
      provider: 'none',
      resend_api_key: '',
      sender_email: '',
      recipient_emails: [],
      webhook_url: '',
      timeout_sec: 15,
    },
    bank_commission: { min_amount: 0.10, percent: 1.5, card_sale_percent: 2, card_transfer_percent: 0.5 },
    finance_policy: DEFAULT_FINANCE_POLICY,
    inventory_settings: {
      default_critical_threshold: 5,
      unit_options: ['kq', 'qram', 'litr', 'ml', 'ədəd', 'metr'],
    },
    staff_benefits: {
      daily_limit_azn: 6,
      allowed_scope: 'all',
      included_categories: [],
      included_items: [],
      item_unit_cap_azn: 6,
    },
    print_settings: { use_qz: false, printer_name: '' },
    qr_settings: { base_url: '' },
    qr_menu_settings: {
      enabled: true,
      hero_title: 'QR Menu',
      hero_subtitle: 'Telefonunuzdan menyuya baxın',
      show_prices: true,
      show_images: true,
      show_descriptions: true,
      poster_title: 'Menyuya baxmaq üçün skan et',
      poster_subtitle: 'Telefon kameranızı QR üzərinə yönəldin',
      background_color: '#efe2c1',
      surface_color: '#fff7e8',
      text_color: '#2b1708',
      hero_image_url: '',
      poster_image_url: '',
      poster_background_color: '#d59b2d',
      logo_shape: 'rounded',
    },
    feedback_settings: DEFAULT_FEEDBACK_SETTINGS,
    customer_app_settings: {
      enabled: true,
      program_mode: 'points',
      layout_preset: 'rewards',
      consent_text: 'Mən loyallıq proqramına qoşulmağa və şəxsi reward hesabımın yaradılmasına razıyam.',
      join_customer_type: 'golden',
      join_discount_percent: 5,
      app_name: 'Loyalty Club',
      hero_title: 'Xoş gəldiniz',
      hero_subtitle: 'Bonuslarınızı, kampaniyaları və reward-ları bir yerdə izləyin.',
      hero_image_url: '',
      background_image_url: '',
      background_color: '#0b1220',
      points_label: 'Ulduz',
      reward_name: 'Reward',
      reward_threshold: 10,
      reward_description: '10 ulduza 1 pulsuz içki',
      reward_card_style: 'rounded',
      cashback_percent: 5,
      primary_color: '#facc15',
      accent_color: '#22d3ee',
      show_qr_card: true,
      show_wallet: true,
      ai_barista_enabled: false,
      ai_falci_enabled: false,
      show_campaigns: true,
      show_history: true,
      show_notifications: true,
    },
    pos_layout: DEFAULT_POS_LAYOUT,
    pos_layout_draft: DEFAULT_POS_LAYOUT,
    landing_settings: {
      hero_title_az: 'Azərbaycan bazarı üçün müasir POS və idarəetmə sistemi',
      hero_title_ru: 'Премиальная POS-платформа для ресторанов, coffee shop и retail',
      hero_title_en: 'A premium POS platform for restaurants, coffee shops, and retail concepts',
      hero_body_az: 'Kassa, masa, mətbəx, anbar, maliyyə, CRM və loyallıq axınlarını bir mərkəzdə birləşdirən yerli və çevik idarəetmə platforması.',
      hero_body_ru: 'Современная система управления, объединяющая продажи, столы, кухню, финансы, CRM и loyalty в одном продукте.',
      hero_body_en: 'A modern operations system that connects sales, tables, kitchen, finance, CRM, and loyalty inside one product.',
      primary_cta_az: 'Canlı Demoya Bax',
      primary_cta_ru: 'Открыть Live Demo',
      primary_cta_en: 'Open Live Demo',
      secondary_cta_az: 'Platformanı Aç',
      secondary_cta_ru: 'Открыть Платформу',
      secondary_cta_en: 'Open Platform',
      contact_email: 'hello@ironwaves.store',
      contact_phone: '',
      contact_whatsapp: '',
    },
    omnitech_settings: {
      enabled: false,
      api_base_url: '',
      api_key: '',
      merchant_id: '',
      terminal_id: '',
      fiscal_device_id: ''
    },
    role_modules: {
      staff: ['pos', 'tables', 'kds', 'zreport'],
      manager: ['pos', 'tables', 'kds', 'zreport', 'finance', 'inventory', 'combos', 'analytics', 'logs', 'crm', 'customerapp', 'posbuilder', 'ai', 'menu', 'recipes'],
      kitchen: ['kds']
    },
    ai_config: {
      provider: 'unknown',
      model: 'auto',
      autodetected: true,
      ollama_freeapi_enabled: false,
    },
  };
  // Cache in memCache so subsequent calls find it without re-creating
  settingsArr.push(defaultSettings);
  return defaultSettings;
}

function saveSettings(settings: Settings) {
  const all = getDB<Settings>('settings');
  const idx = all.findIndex((s) => s.tenant_id === settings.tenant_id);
  if (idx >= 0) {
    all[idx] = settings;
  } else {
    all.push(settings);
  }
  setDB('settings', all);
}

export function update_service_fee(percent: number) {
  const settings = getSettings();
  settings.service_fee_percent = percent;
  saveSettings(settings);
  logEvent('admin', 'SERVICE_FEE_UPDATE', { percent });
  return { success: true, service_fee_percent: percent };
}

export function update_table_service_settings(payload: { deposit_per_guest_azn: number; reservation_lock_hours?: number }) {
  const settings = getSettings();
  settings.table_service_settings = {
    deposit_per_guest_azn: Math.max(0, Number(payload.deposit_per_guest_azn || 0)),
    reservation_lock_hours: Math.max(0, Number(payload.reservation_lock_hours ?? settings.table_service_settings?.reservation_lock_hours ?? 2)),
  };
  saveSettings(settings);
  logEvent('admin', 'TABLE_SERVICE_SETTINGS_UPDATE', settings.table_service_settings);
  return { success: true };
}

export function update_yield_management_settings(payload: NonNullable<Settings['yield_management_settings']>) {
  const settings = getSettings();
  settings.yield_management_settings = {
    enabled: Boolean(payload?.enabled),
    variance_tolerance_percent: Math.max(0, Number(payload?.variance_tolerance_percent || 0)),
    profiles: {
      beef: {
        raw_to_ready_ratio: Math.max(1, Number(payload?.profiles?.beef?.raw_to_ready_ratio || 1.4)),
        loss_min_percent: Math.max(0, Number(payload?.profiles?.beef?.loss_min_percent || 30)),
        loss_max_percent: Math.max(0, Number(payload?.profiles?.beef?.loss_max_percent || 40)),
      },
      chicken: {
        raw_to_ready_ratio: Math.max(1, Number(payload?.profiles?.chicken?.raw_to_ready_ratio || 1.33)),
        loss_min_percent: Math.max(0, Number(payload?.profiles?.chicken?.loss_min_percent || 25)),
        loss_max_percent: Math.max(0, Number(payload?.profiles?.chicken?.loss_max_percent || 35)),
      },
    },
    tracked_items: Array.isArray(payload?.tracked_items)
      ? payload.tracked_items
          .map((row) => ({
            inventory_name: String(row.inventory_name || '').trim(),
            meat_type: String(row.meat_type || 'beef').trim().toLowerCase() || 'beef',
            raw_to_ready_ratio: Math.max(1, Number(row.raw_to_ready_ratio || 1)),
            enabled: row.enabled !== false,
          }))
          .filter((row) => row.inventory_name)
      : [],
  };
  saveSettings(settings);
  logEvent('admin', 'YIELD_MANAGEMENT_UPDATE', settings.yield_management_settings);
  return { success: true, yield_management_settings: settings.yield_management_settings };
}

export function update_ui_visibility(payload: { staff_show_tables: boolean; manager_show_tables: boolean; staff_show_kitchen: boolean }) {
  const settings = getSettings();
  settings.ui_visibility = payload;
  saveSettings(settings);
  logEvent('admin', 'UI_SETTINGS_UPDATE', {});
  return { success: true };
}

export function update_beverage_service_settings(payload: NonNullable<Settings['beverage_service_settings']>) {
  const settings = getSettings();
  settings.beverage_service_settings = {
    coffee_selection_mode: payload?.coffee_selection_mode === 'size_only' ? 'size_only' : 'size_and_service',
    remove_paper_packaging_for_table: payload?.remove_paper_packaging_for_table !== false,
    discount_scope: payload?.discount_scope === 'coffee_only' ? 'coffee_only' : 'all_items',
  };
  saveSettings(settings);
  logEvent('admin', 'BEVERAGE_SERVICE_SETTINGS_UPDATE', settings.beverage_service_settings);
  return { success: true, beverage_service_settings: settings.beverage_service_settings };
}

export function update_z_report_receipt_settings(payload: NonNullable<Settings['z_report_receipt_settings']>) {
  const settings = getSettings();
  settings.z_report_receipt_settings = {
    ...DEFAULT_Z_REPORT_RECEIPT_SETTINGS,
    ...(payload || {}),
  };
  saveSettings(settings);
  logEvent('admin', 'Z_REPORT_RECEIPT_SETTINGS_UPDATE', settings.z_report_receipt_settings);
  return { success: true, z_report_receipt_settings: settings.z_report_receipt_settings };
}

export function update_time_settings(payload: { shift_start_time: string; shift_end_time: string; utc_offset: number; timezone: string }) {
  const settings = getSettings();
  settings.time_settings = payload;
  saveSettings(settings);
  logEvent('admin', 'TIME_SETTINGS_UPDATE', {});
  return { success: true };
}

const getStaffPinLength = (tenant_id?: string) => {
  const length = Number(getSettings(tenant_id).session_settings?.staff_pin_length || 4);
  return length === 4 ? 4 : 6;
};

const isStrongLocalPassword = (password: string) => (
  password.length >= 10 &&
  /[a-z]/.test(password) &&
  /[A-Z]/.test(password) &&
  /\d/.test(password) &&
  /[^A-Za-z0-9]/.test(password)
);

export function update_session_settings(payload: {
  idle_logout_minutes: number;
  virtual_keyboard_enabled?: boolean;
  staff_pin_length?: number;
  theme_mode?: 'dark' | 'light';
  ui_mode?: 'old';
}) {
  const settings = getSettings();
  const pinLength = Number(payload.staff_pin_length || settings.session_settings?.staff_pin_length || 4);
  settings.session_settings = {
    idle_logout_minutes: Math.max(0, Number(payload.idle_logout_minutes || 0)),
    virtual_keyboard_enabled: payload.virtual_keyboard_enabled !== false,
    staff_pin_length: pinLength === 4 ? 4 : 6,
    theme_mode: payload.theme_mode
      ? (payload.theme_mode === 'light' ? 'light' : 'dark')
      : (settings.session_settings?.theme_mode === 'light' ? 'light' : 'dark'),
    ui_mode: 'old',
  };
  saveSettings(settings);
  logEvent('admin', 'SESSION_SETTINGS_UPDATE', settings.session_settings);
  return { success: true };
}

export function update_email_settings(payload: {
  enabled?: boolean;
  provider?: 'none' | 'resend' | 'webhook';
  resend_api_key?: string;
  sender_email?: string;
  recipient_emails?: string[];
  webhook_url?: string;
  timeout_sec?: number;
}) {
  const settings = getSettings();
  settings.email_settings = {
    enabled: Boolean(payload.enabled),
    provider: payload.provider || 'none',
    resend_api_key: payload.resend_api_key || '',
    sender_email: payload.sender_email || '',
    recipient_emails: payload.recipient_emails || [],
    webhook_url: payload.webhook_url || '',
    timeout_sec: Number.isFinite(payload.timeout_sec as number)
      ? Math.max(5, Number(payload.timeout_sec))
      : 15,
  };
  saveSettings(settings);
  logEvent('admin', 'REPORT_EMAIL_SETTINGS_UPDATED', {
    enabled: settings.email_settings.enabled,
    provider: settings.email_settings.provider,
    sender: settings.email_settings.sender_email,
    recipients: settings.email_settings.recipient_emails,
  });
  return { success: true };
}

export function update_bank_commission(payload: { min_amount: number; percent: number }) {
  const settings = getSettings();
  settings.bank_commission = {
    ...settings.bank_commission,
    ...payload,
    card_sale_percent: Number((payload as any)?.card_sale_percent ?? settings.bank_commission?.card_sale_percent ?? settings.bank_commission?.percent ?? 2),
    card_transfer_percent: Number((payload as any)?.card_transfer_percent ?? settings.bank_commission?.card_transfer_percent ?? 0.5),
  };
  saveSettings(settings);
  logEvent('admin', 'BANK_COMMISSION_UPDATE', settings.bank_commission);
  return { success: true };
}

export function update_finance_policy(payload: NonNullable<Settings['finance_policy']>) {
  const settings = getSettings();
  const roles = Array.isArray(payload.approver_roles) && payload.approver_roles.length
    ? payload.approver_roles
    : DEFAULT_FINANCE_POLICY.approver_roles;
  settings.finance_policy = {
    ...DEFAULT_FINANCE_POLICY,
    ...settings.finance_policy,
    large_transfer_threshold_azn: Math.max(0, Number(payload.large_transfer_threshold_azn ?? DEFAULT_FINANCE_POLICY.large_transfer_threshold_azn)),
    investor_repayment_requires_approval: Boolean(payload.investor_repayment_requires_approval),
    cash_adjustment_requires_approval: Boolean(payload.cash_adjustment_requires_approval),
    reversal_requires_approval: Boolean(payload.reversal_requires_approval),
    reconciliation_adjustment_requires_approval: Boolean(payload.reconciliation_adjustment_requires_approval),
    reconciliation_variance_alert_azn: Math.max(0, Number(payload.reconciliation_variance_alert_azn ?? DEFAULT_FINANCE_POLICY.reconciliation_variance_alert_azn)),
    negative_balance_alert_azn: Math.max(0, Number(payload.negative_balance_alert_azn ?? DEFAULT_FINANCE_POLICY.negative_balance_alert_azn)),
    approver_roles: Array.from(new Set(roles.map((role) => String(role || '').trim().toLowerCase()).filter(Boolean))),
  };
  saveSettings(settings);
  logEvent('admin', 'FINANCE_POLICY_UPDATED', settings.finance_policy);
  return { success: true, finance_policy: settings.finance_policy };
}

export function update_landing_settings(payload: Settings['landing_settings']) {
  const settings = getSettings();
  settings.landing_settings = normalizeLandingSettings({
    ...(settings.landing_settings || {}),
    ...(payload || {}),
  });
  saveSettings(settings);
  logEvent('admin', 'LANDING_SETTINGS_UPDATE', settings.landing_settings);
  return { success: true };
}

export function get_settings(tenant_id?: string) {
  const s = getSettings(tenant_id);
  if (!s.role_modules) {
    s.role_modules = {
      staff: ['pos', 'tables', 'kds', 'zreport'],
      manager: ['pos', 'tables', 'kds', 'zreport', 'finance', 'inventory', 'combos', 'analytics', 'logs', 'crm', 'customerapp', 'posbuilder', 'ai', 'menu', 'recipes'],
      kitchen: ['kds']
    };
    saveSettings(s);
  }
  if (!s.print_settings) {
    s.print_settings = { use_qz: false, printer_name: '' };
    saveSettings(s);
  }
  if (!s.pos_layout) {
    s.pos_layout = {
      preset: 'classic',
      density: 'comfortable',
      product_columns: 3,
      show_cart_tabs: true,
      accent_color: '#facc15',
      hidden_widgets: [],
      widget_order: ['customer', 'discount', 'orderType', 'table', 'cartItems', 'cartSummary', 'payments'],
      device_layouts: {
        desktop: {},
        tablet: {
          preset: 'touch',
          density: 'large',
          product_columns: 2,
        },
      },
    };
    saveSettings(s);
  } else if (!s.pos_layout.device_layouts) {
    s.pos_layout.device_layouts = {
      desktop: {},
      tablet: {
        preset: 'touch',
        density: 'large',
        product_columns: 2,
        left_hidden_widgets: [],
        left_widget_order: ['search', 'categories', 'productGrid'],
      },
    };
    saveSettings(s);
  }
  if (!s.pos_layout_draft) {
    s.pos_layout_draft = JSON.parse(JSON.stringify(s.pos_layout || DEFAULT_POS_LAYOUT));
    saveSettings(s);
  }
  s.pos_layout = normalizePosLayoutConfig(s.pos_layout || DEFAULT_POS_LAYOUT, DEFAULT_POS_LAYOUT);
  s.pos_layout_draft = normalizePosLayoutConfig(s.pos_layout_draft || s.pos_layout || DEFAULT_POS_LAYOUT, s.pos_layout || DEFAULT_POS_LAYOUT);
  saveSettings(s);
  if (!s.pos_layout.left_hidden_widgets) {
    s.pos_layout.left_hidden_widgets = [];
    saveSettings(s);
  }
  if (!s.pos_layout.left_widget_order) {
    s.pos_layout.left_widget_order = ['menuHeader', 'search', 'categories', 'productGrid'];
    saveSettings(s);
  }
  if (!s.pos_layout.widget_sizes) {
    s.pos_layout.widget_sizes = {};
    saveSettings(s);
  }
  if (!s.pos_layout.left_widget_sizes) {
    s.pos_layout.left_widget_sizes = {};
    saveSettings(s);
  }
  if (!s.qr_settings) {
    s.qr_settings = { base_url: '' };
    saveSettings(s);
  }
  if (!s.qr_menu_settings) {
    s.qr_menu_settings = {
      enabled: true,
      hero_title: 'QR Menu',
      hero_subtitle: 'Telefonunuzdan menyuya baxın',
      show_prices: true,
      show_images: true,
      show_descriptions: true,
      poster_title: 'Menyuya baxmaq üçün skan et',
      poster_subtitle: 'Telefon kameranızı QR üzərinə yönəldin',
      background_color: '#efe2c1',
      surface_color: '#fff7e8',
      text_color: '#2b1708',
      hero_image_url: '',
      poster_image_url: '',
      poster_background_color: '#d59b2d',
      logo_shape: 'rounded',
    };
    saveSettings(s);
  }
  if (!s.feedback_settings) {
    s.feedback_settings = normalizeFeedbackSettings(DEFAULT_FEEDBACK_SETTINGS);
    saveSettings(s);
  } else {
    s.feedback_settings = normalizeFeedbackSettings(s.feedback_settings);
    saveSettings(s);
  }
  if (!s.z_report_receipt_settings) {
    s.z_report_receipt_settings = DEFAULT_Z_REPORT_RECEIPT_SETTINGS;
    saveSettings(s);
  }
  if (!s.customer_app_settings) {
    s.customer_app_settings = {
      enabled: true,
      program_mode: 'points',
      layout_preset: 'rewards',
      consent_text: 'Mən loyallıq proqramına qoşulmağa və şəxsi reward hesabımın yaradılmasına razıyam.',
      join_customer_type: 'golden',
      join_discount_percent: 5,
      app_name: 'Loyalty Club',
      hero_title: 'Xoş gəldiniz',
      hero_subtitle: 'Bonuslarınızı, kampaniyaları və reward-ları bir yerdə izləyin.',
      hero_image_url: '',
      background_image_url: '',
      background_color: '#0b1220',
      points_label: 'Ulduz',
      reward_name: 'Reward',
      reward_threshold: 10,
      reward_description: '10 ulduza 1 pulsuz içki',
      reward_card_style: 'rounded',
      cashback_percent: 5,
      primary_color: '#facc15',
      accent_color: '#22d3ee',
      show_qr_card: true,
      show_wallet: true,
      ai_barista_enabled: false,
      ai_falci_enabled: false,
      show_campaigns: true,
      show_history: true,
      show_notifications: true,
    };
    saveSettings(s);
  }
  if (!s.pos_layout) {
    s.pos_layout = JSON.parse(JSON.stringify(DEFAULT_POS_LAYOUT));
    saveSettings(s);
  }
  if (!s.omnitech_settings) {
    s.omnitech_settings = {
      enabled: false,
      api_base_url: '',
      api_key: '',
      merchant_id: '',
      terminal_id: '',
      fiscal_device_id: ''
    };
    saveSettings(s);
  }
  if (!s.email_settings) {
    s.email_settings = {
      enabled: false,
      provider: 'none',
      resend_api_key: '',
      sender_email: '',
      recipient_emails: [],
      webhook_url: '',
      timeout_sec: 15,
    };
    saveSettings(s);
  } else {
    s.email_settings = {
      enabled: Boolean(s.email_settings.enabled),
      provider: (s.email_settings.provider as any) || 'none',
      resend_api_key: s.email_settings.resend_api_key || '',
      sender_email: s.email_settings.sender_email || '',
      recipient_emails: s.email_settings.recipient_emails || [],
      webhook_url: (s.email_settings as any).webhook_url || '',
      timeout_sec: Number((s.email_settings as any).timeout_sec || 15),
    };
    saveSettings(s);
  }
  if (!s.inventory_settings) {
    s.inventory_settings = {
      default_critical_threshold: 5,
      unit_options: ['kq', 'qram', 'litr', 'ml', 'ədəd', 'metr'],
    };
    saveSettings(s);
  }
  if (!s.staff_benefits) {
    s.staff_benefits = {
      daily_limit_azn: 6,
      allowed_scope: 'all',
      included_categories: [],
      included_items: [],
      item_unit_cap_azn: 6,
    };
    saveSettings(s);
  } else if (!(s.staff_benefits as any).allowed_scope) {
    s.staff_benefits = {
      daily_limit_azn: Number((s.staff_benefits as any).daily_limit_azn ?? 6),
      allowed_scope: 'all',
      included_categories: [],
      included_items: [],
      item_unit_cap_azn: Number((s.staff_benefits as any).non_coffee_unit_cap_azn ?? 6),
    };
    saveSettings(s);
  }
  if (!s.landing_settings) {
    s.landing_settings = normalizeLandingSettings(DEFAULT_LANDING_SETTINGS);
    saveSettings(s);
  } else {
    s.landing_settings = normalizeLandingSettings(s.landing_settings);
    saveSettings(s);
  }
  if (!s.table_service_settings) {
    s.table_service_settings = { deposit_per_guest_azn: 0, reservation_lock_hours: 2 };
    saveSettings(s);
  }
  if (typeof s.table_service_settings.reservation_lock_hours !== 'number') {
    s.table_service_settings = {
      ...s.table_service_settings,
      reservation_lock_hours: 2,
    };
    saveSettings(s);
  }
  if (!s.yield_management_settings) {
    s.yield_management_settings = {
      enabled: false,
      variance_tolerance_percent: 5,
      profiles: {
        beef: { raw_to_ready_ratio: 1.4, loss_min_percent: 30, loss_max_percent: 40 },
        chicken: { raw_to_ready_ratio: 1.33, loss_min_percent: 25, loss_max_percent: 35 },
      },
      tracked_items: [],
    };
    saveSettings(s);
  }
  if (!s.session_settings) {
    s.session_settings = {
      idle_logout_minutes: 0,
      virtual_keyboard_enabled: true,
      staff_pin_length: 4,
      theme_mode: 'dark',
      ui_mode: 'old',
    };
    saveSettings(s);
  } else if (
    !s.session_settings.staff_pin_length ||
    typeof s.session_settings.virtual_keyboard_enabled === 'undefined' ||
    !s.session_settings.theme_mode ||
    !s.session_settings.ui_mode
  ) {
    s.session_settings = {
      idle_logout_minutes: Number(s.session_settings.idle_logout_minutes || 0),
      virtual_keyboard_enabled: s.session_settings.virtual_keyboard_enabled !== false,
      staff_pin_length: Number(s.session_settings.staff_pin_length || 4) === 4 ? 4 : 6,
      theme_mode: s.session_settings.theme_mode === 'light' ? 'light' : 'dark',
      ui_mode: 'old',
    };
    saveSettings(s);
  }
  s.bank_commission = {
    min_amount: Number((s.bank_commission as any)?.min_amount ?? 0.10),
    percent: Number((s.bank_commission as any)?.percent ?? 1.5),
    card_sale_percent: Number((s.bank_commission as any)?.card_sale_percent ?? (s.bank_commission as any)?.percent ?? 2),
    card_transfer_percent: Number((s.bank_commission as any)?.card_transfer_percent ?? 0.5),
  };
  s.finance_policy = {
    ...DEFAULT_FINANCE_POLICY,
    ...(s.finance_policy || {}),
    large_transfer_threshold_azn: Number((s.finance_policy as any)?.large_transfer_threshold_azn ?? DEFAULT_FINANCE_POLICY.large_transfer_threshold_azn),
    reconciliation_variance_alert_azn: Number((s.finance_policy as any)?.reconciliation_variance_alert_azn ?? DEFAULT_FINANCE_POLICY.reconciliation_variance_alert_azn),
    negative_balance_alert_azn: Number((s.finance_policy as any)?.negative_balance_alert_azn ?? DEFAULT_FINANCE_POLICY.negative_balance_alert_azn),
    approver_roles: Array.isArray((s.finance_policy as any)?.approver_roles) ? (s.finance_policy as any).approver_roles : DEFAULT_FINANCE_POLICY.approver_roles,
  };
  const feedbackOverrides = readFeedbackOverrides();
  s.feedback_settings = normalizeFeedbackSettings(feedbackOverrides[s.tenant_id] || s.feedback_settings);
  saveSettings(s);
  return s;
}

export function update_inventory_settings(payload: { default_critical_threshold: number; unit_options: string[] }) {
  const settings = getSettings();
  const cleanUnits = Array.from(new Set((payload.unit_options || []).map((u) => String(u || '').trim()).filter(Boolean)));
  settings.inventory_settings = {
    default_critical_threshold: Number.isFinite(payload.default_critical_threshold)
      ? Math.max(0, Number(payload.default_critical_threshold))
      : 5,
    unit_options: cleanUnits.length ? cleanUnits : ['kq', 'qram', 'litr', 'ml', 'ədəd', 'metr'],
  };
  saveSettings(settings);
  logEvent('admin', 'INVENTORY_SETTINGS_UPDATED', settings.inventory_settings);
  return { success: true, inventory_settings: settings.inventory_settings };
}

export function update_staff_benefits(payload: {
  daily_limit_azn: number;
  allowed_scope: 'all' | 'categories' | 'items';
  included_categories: string[];
  included_items: string[];
  item_unit_cap_azn: number;
}) {
  const settings = getSettings();
  settings.staff_benefits = {
    daily_limit_azn: Number.isFinite(payload.daily_limit_azn) ? Math.max(0, Number(payload.daily_limit_azn)) : 6,
    allowed_scope: payload.allowed_scope || 'all',
    included_categories: Array.from(new Set((payload.included_categories || []).map((v) => String(v || '').trim()).filter(Boolean))),
    included_items: Array.from(new Set((payload.included_items || []).map((v) => String(v || '').trim()).filter(Boolean))),
    item_unit_cap_azn: Number.isFinite(payload.item_unit_cap_azn)
      ? Math.max(0, Number(payload.item_unit_cap_azn))
      : 6,
  };
  saveSettings(settings);
  logEvent('admin', 'STAFF_BENEFITS_UPDATED', settings.staff_benefits);
  return { success: true, staff_benefits: settings.staff_benefits };
}

export function update_print_settings(payload: { use_qz: boolean; printer_name: string }) {
  const settings = getSettings();
  settings.print_settings = payload;
  saveSettings(settings);
  logEvent('admin', 'PRINT_SETTINGS_UPDATED', payload);
  return { success: true };
}

export async function update_print_settings_live(payload: { use_qz: boolean; printer_name: string }) {
  if (!isBackendEnabled()) return update_print_settings(payload);
  await apiRequest('/api/v1/ops/settings/print-settings', { method: 'PATCH', tenantId: null, body: payload });
  update_print_settings(payload);
  return { success: true };
}

export function update_qr_settings(payload: { base_url: string }) {
  const settings = getSettings();
  settings.qr_settings = {
    base_url: String(payload.base_url || '').trim(),
  };
  saveSettings(settings);
  logEvent('admin', 'QR_SETTINGS_UPDATED', settings.qr_settings);
  return { success: true };
}

export function update_qr_menu_settings(payload: NonNullable<Settings['qr_menu_settings']>) {
  const settings = getSettings();
  settings.qr_menu_settings = {
    enabled: payload.enabled !== false,
    hero_title: String(payload.hero_title || '').trim() || 'QR Menu',
    hero_subtitle: String(payload.hero_subtitle || '').trim() || 'Telefonunuzdan menyuya baxın',
    show_prices: payload.show_prices !== false,
    show_images: payload.show_images !== false,
    show_descriptions: payload.show_descriptions !== false,
    poster_title: String(payload.poster_title || '').trim() || 'Menyuya baxmaq üçün skan et',
    poster_subtitle: String(payload.poster_subtitle || '').trim() || 'Telefon kameranızı QR üzərinə yönəldin',
    background_color: String(payload.background_color || '').trim() || '#efe2c1',
    surface_color: String(payload.surface_color || '').trim() || '#fff7e8',
    text_color: String(payload.text_color || '').trim() || '#2b1708',
    hero_image_url: String(payload.hero_image_url || '').trim(),
    poster_image_url: String((payload as any).poster_image_url || '').trim(),
    poster_background_color: String(payload.poster_background_color || '').trim() || '#d59b2d',
    logo_shape: payload.logo_shape === 'circle' || payload.logo_shape === 'square' ? payload.logo_shape : 'rounded',
  };
  saveSettings(settings);
  logEvent('admin', 'QR_MENU_SETTINGS_UPDATED', settings.qr_menu_settings);
  return { success: true, qr_menu_settings: settings.qr_menu_settings };
}

export function update_feedback_settings(payload: NonNullable<Settings['feedback_settings']>, tenant_id?: string) {
  const resolvedTenant = resolveTenant(tenant_id);
  const settings = getSettings(resolvedTenant);
  settings.feedback_settings = normalizeFeedbackSettings(payload);
  saveSettings(settings);
  writeFeedbackOverride(resolvedTenant, settings.feedback_settings);
  logEvent('admin', 'FEEDBACK_SETTINGS_UPDATED', settings.feedback_settings);
  return { success: true, feedback_settings: settings.feedback_settings };
}

export function update_customer_app_settings(payload: {
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
}) {
  const settings = getSettings();
  settings.customer_app_settings = {
    enabled: Boolean(payload.enabled),
    program_mode: payload.program_mode === 'cashback' ? 'cashback' : 'points',
    layout_preset: payload.layout_preset === 'cashback' || payload.layout_preset === 'playful' ? payload.layout_preset : 'rewards',
    consent_text: String(payload.consent_text || '').trim() || 'Mən loyallıq proqramına qoşulmağa və şəxsi reward hesabımın yaradılmasına razıyam.',
    join_customer_type: String(payload.join_customer_type || '').trim() || 'golden',
    join_discount_percent: Number.isFinite(payload.join_discount_percent) ? Math.max(0, Number(payload.join_discount_percent)) : 5,
    app_name: String(payload.app_name || '').trim() || 'Loyalty Club',
    hero_title: String(payload.hero_title || '').trim() || 'Xoş gəldiniz',
    hero_subtitle: String(payload.hero_subtitle || '').trim() || 'Bonuslarınızı, kampaniyaları və reward-ları bir yerdə izləyin.',
    hero_image_url: String(payload.hero_image_url || '').trim(),
    background_image_url: String(payload.background_image_url || '').trim(),
    background_color: String(payload.background_color || '').trim() || '#0b1220',
    points_label: String(payload.points_label || '').trim() || 'Ulduz',
    reward_name: String(payload.reward_name || '').trim() || 'Reward',
    reward_threshold: Number.isFinite(payload.reward_threshold) ? Math.max(1, Number(payload.reward_threshold)) : 10,
    reward_description: String(payload.reward_description || '').trim() || '10 ulduza 1 pulsuz içki',
    reward_card_style: payload.reward_card_style === 'soft-square' || payload.reward_card_style === 'glass' ? payload.reward_card_style : 'rounded',
    cashback_percent: Number.isFinite(payload.cashback_percent) ? Math.max(0, Number(payload.cashback_percent)) : 5,
    primary_color: String(payload.primary_color || '').trim() || '#facc15',
    accent_color: String(payload.accent_color || '').trim() || '#22d3ee',
    show_qr_card: payload.show_qr_card !== false,
    show_wallet: payload.show_wallet !== false,
    ai_barista_enabled: payload.ai_barista_enabled === true,
    ai_falci_enabled: payload.ai_falci_enabled === true,
    show_campaigns: Boolean(payload.show_campaigns),
    show_history: Boolean(payload.show_history),
    show_notifications: Boolean(payload.show_notifications),
  };
  saveSettings(settings);
  logEvent('admin', 'CUSTOMER_APP_SETTINGS_UPDATED', settings.customer_app_settings);
  return { success: true, customer_app_settings: settings.customer_app_settings };
}

export function update_pos_layout_settings(payload: NonNullable<Settings['pos_layout']>) {
  const settings = getSettings();
  settings.pos_layout = normalizePosLayoutConfig(payload, DEFAULT_POS_LAYOUT);
  saveSettings(settings);
  logEvent('admin', 'POS_LAYOUT_UPDATED', settings.pos_layout);
  return { success: true, pos_layout: settings.pos_layout };
}

export function update_pos_layout_draft(payload: NonNullable<Settings['pos_layout_draft']>) {
  const settings = getSettings();
  settings.pos_layout_draft = normalizePosLayoutConfig(payload, DEFAULT_POS_LAYOUT);
  saveSettings(settings);
  logEvent('admin', 'POS_LAYOUT_DRAFT_UPDATED', settings.pos_layout_draft);
  return { success: true, pos_layout_draft: settings.pos_layout_draft };
}

export function publish_pos_layout_draft() {
  const settings = getSettings();
  settings.pos_layout = JSON.parse(JSON.stringify(settings.pos_layout_draft || settings.pos_layout || DEFAULT_POS_LAYOUT));
  saveSettings(settings);
  logEvent('admin', 'POS_LAYOUT_PUBLISHED', settings.pos_layout);
  return { success: true, pos_layout: settings.pos_layout };
}

export function reset_pos_layout_draft() {
  const settings = getSettings();
  settings.pos_layout_draft = JSON.parse(JSON.stringify(settings.pos_layout || DEFAULT_POS_LAYOUT));
  saveSettings(settings);
  logEvent('admin', 'POS_LAYOUT_DRAFT_RESET', settings.pos_layout_draft);
  return { success: true, pos_layout_draft: settings.pos_layout_draft };
}

export function update_omnitech_settings(payload: {
  enabled: boolean;
  api_base_url: string;
  api_key: string;
  merchant_id: string;
  terminal_id: string;
  fiscal_device_id: string;
}) {
  const settings = getSettings();
  settings.omnitech_settings = {
    enabled: Boolean(payload.enabled),
    api_base_url: (payload.api_base_url || '').trim(),
    api_key: payload.api_key || '',
    merchant_id: (payload.merchant_id || '').trim(),
    terminal_id: (payload.terminal_id || '').trim(),
    fiscal_device_id: (payload.fiscal_device_id || '').trim(),
  };
  saveSettings(settings);
  logEvent('admin', 'OMNITECH_SETTINGS_UPDATED', {
    enabled: settings.omnitech_settings.enabled,
    api_base_url: settings.omnitech_settings.api_base_url,
    merchant_id: settings.omnitech_settings.merchant_id,
    terminal_id: settings.omnitech_settings.terminal_id,
    fiscal_device_id: settings.omnitech_settings.fiscal_device_id,
  });
  return { success: true };
}

export function update_role_modules(payload: { staff: string[]; manager: string[]; kitchen: string[] }) {
  const settings = getSettings();
  settings.role_modules = payload;
  saveSettings(settings);
  logEvent('admin', 'ROLE_MODULES_UPDATED', payload);
  return { success: true };
}

export async function get_settings_live(tenant_id?: string) {
  if (!isBackendEnabled()) return get_settings(tenant_id);
  const data = await apiRequest<Settings>(`/api/v1/ops/settings?_t=${Date.now()}`, { tenantId: null });
  const requestedTenant = String(resolveTenant(tenant_id));
  const responseTenant = String(data?.tenant_id || '');
  const resolvedTenant = String(responseTenant || requestedTenant);
  const overrides = readFeedbackOverrides();
  const scopedOverride =
    overrides[requestedTenant] ||
    overrides[resolvedTenant] ||
    (responseTenant ? overrides[responseTenant] : undefined);
  const merged: Settings = {
    ...data,
    session_settings: {
      idle_logout_minutes: Number(data?.session_settings?.idle_logout_minutes || 0),
      virtual_keyboard_enabled: data?.session_settings?.virtual_keyboard_enabled !== false,
      staff_pin_length: Number(data?.session_settings?.staff_pin_length || 4) === 4 ? 4 : 6,
      theme_mode: data?.session_settings?.theme_mode === 'light' ? 'light' : 'dark',
      ui_mode: 'old',
    },
    feedback_settings: normalizeFeedbackSettings(scopedOverride || data?.feedback_settings),
    ai_config: {
      provider: String(data?.ai_config?.provider || 'unknown') as any,
      model: String(data?.ai_config?.model || 'auto'),
      autodetected: data?.ai_config?.autodetected !== false,
      ollama_freeapi_enabled: data?.ai_config?.ollama_freeapi_enabled === true,
      updated_at: String(data?.ai_config?.updated_at || ''),
    },
  };
  saveSettings(merged);
  return merged;
}

export async function update_qr_settings_live(payload: { base_url: string }) {
  if (!isBackendEnabled()) return update_qr_settings(payload);
  await apiRequest('/api/v1/ops/settings/qr-settings', { method: 'PATCH', tenantId: null, body: payload });
  update_qr_settings(payload);
  return { success: true };
}

export async function update_qr_menu_settings_live(payload: NonNullable<Settings['qr_menu_settings']>) {
  if (!isBackendEnabled()) return update_qr_menu_settings(payload);
  await apiRequest('/api/v1/ops/settings/qr-menu', { method: 'PATCH', tenantId: null, body: payload });
  update_qr_menu_settings(payload);
  return { success: true };
}

export async function update_feedback_settings_live(payload: NonNullable<Settings['feedback_settings']>) {
  const tenantId = resolveTenant();
  if (!isBackendEnabled()) return update_feedback_settings(payload, tenantId);
  try {
    await apiRequest('/api/v1/ops/settings/feedback', { method: 'PATCH', tenantId: null, body: payload });
  } catch {
    // Backend endpoint may not be available yet; keep tenant-level local persistence.
  }
  return update_feedback_settings(payload, tenantId);
}

export async function get_public_qr_menu_bootstrap_live() {
  return apiRequest<{
    tenant_id: string;
    enabled: boolean;
    branding: {
      company_name: string;
      logo_url: string;
      hero_title: string;
      hero_subtitle: string;
      poster_title: string;
      poster_subtitle: string;
      background_color: string;
      surface_color: string;
      text_color: string;
      hero_image_url: string;
      poster_image_url: string;
      poster_background_color: string;
      logo_shape: string;
      primary_color: string;
      accent_color: string;
    };
    show_prices: boolean;
    show_images: boolean;
    show_descriptions: boolean;
  }>('/api/v1/ops/public-menu-bootstrap', {
    method: 'GET',
    tenantId: null,
    auth: false,
  });
}

export async function update_customer_app_settings_live(payload: {
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
}) {
  if (!isBackendEnabled()) return update_customer_app_settings(payload);
  await apiRequest('/api/v1/ops/settings/customer-app', { method: 'PATCH', tenantId: null, body: payload });
  update_customer_app_settings(payload);
  return { success: true };
}

export async function update_pos_layout_settings_live(payload: NonNullable<Settings['pos_layout']>) {
  if (!isBackendEnabled()) return update_pos_layout_settings(payload);
  await apiRequest('/api/v1/ops/settings/pos-layout', { method: 'PATCH', tenantId: null, body: payload });
  update_pos_layout_settings(payload);
  return { success: true };
}

export async function update_pos_layout_draft_live(payload: NonNullable<Settings['pos_layout_draft']>) {
  if (!isBackendEnabled()) return update_pos_layout_draft(payload);
  await apiRequest('/api/v1/ops/settings/pos-layout-draft', { method: 'PATCH', tenantId: null, body: payload });
  update_pos_layout_draft(payload);
  return { success: true };
}

export async function publish_pos_layout_draft_live() {
  if (!isBackendEnabled()) return publish_pos_layout_draft();
  await apiRequest('/api/v1/ops/settings/pos-layout/publish', { method: 'POST', tenantId: null });
  publish_pos_layout_draft();
  return { success: true };
}

export async function reset_pos_layout_draft_live() {
  if (!isBackendEnabled()) return reset_pos_layout_draft();
  await apiRequest('/api/v1/ops/settings/pos-layout-draft/reset', { method: 'POST', tenantId: null });
  reset_pos_layout_draft();
  return { success: true };
}

export async function update_role_modules_live(payload: { staff: string[]; manager: string[]; kitchen: string[] }) {
  if (!isBackendEnabled()) return update_role_modules(payload);
  await apiRequest('/api/v1/ops/settings/role-modules', { method: 'PATCH', tenantId: null, body: payload });
  const settings = getSettings();
  settings.role_modules = payload;
  saveSettings(settings);
  return { success: true };
}

export async function update_email_settings_live(payload: {
  enabled?: boolean;
  provider?: 'none' | 'resend' | 'webhook';
  resend_api_key?: string;
  sender_email?: string;
  recipient_emails?: string[];
  webhook_url?: string;
  timeout_sec?: number;
}) {
  if (!isBackendEnabled()) return update_email_settings(payload);
  await apiRequest('/api/v1/ops/settings/email-settings', { method: 'PATCH', tenantId: null, body: payload });
  update_email_settings(payload);
  return { success: true };
}

export async function update_session_settings_live(payload: {
  idle_logout_minutes: number;
  virtual_keyboard_enabled?: boolean;
  staff_pin_length?: number;
  theme_mode?: 'dark' | 'light';
  ui_mode?: 'old' | 'new';
}) {
  if (!isBackendEnabled()) return update_session_settings(payload);
  await apiRequest('/api/v1/ops/settings/session', { method: 'PATCH', tenantId: null, body: payload });
  update_session_settings(payload);
  return { success: true };
}

export async function update_beverage_service_settings_live(payload: NonNullable<Settings['beverage_service_settings']>) {
  if (!isBackendEnabled()) return update_beverage_service_settings(payload);
  await apiRequest('/api/v1/ops/settings/beverage-service', { method: 'PATCH', tenantId: null, body: payload });
  update_beverage_service_settings(payload);
  return { success: true };
}

export async function update_z_report_receipt_settings_live(payload: NonNullable<Settings['z_report_receipt_settings']>) {
  if (!isBackendEnabled()) return update_z_report_receipt_settings(payload);
  await apiRequest('/api/v1/ops/settings/z-report-receipt', { method: 'PATCH', tenantId: null, body: payload });
  update_z_report_receipt_settings(payload);
  return { success: true };
}

export async function update_service_fee_live(payload: { service_fee_percent: number }) {
  if (!isBackendEnabled()) return update_service_fee(payload.service_fee_percent);
  await apiRequest('/api/v1/ops/settings/service-fee', { method: 'PATCH', tenantId: null, body: payload });
  update_service_fee(payload.service_fee_percent);
  return { success: true };
}

export async function update_table_service_settings_live(payload: { deposit_per_guest_azn: number; reservation_lock_hours?: number }) {
  if (!isBackendEnabled()) return update_table_service_settings(payload);
  await apiRequest('/api/v1/ops/settings/table-service', { method: 'PATCH', tenantId: null, body: payload });
  update_table_service_settings(payload);
  return { success: true };
}

export async function update_yield_management_settings_live(payload: NonNullable<Settings['yield_management_settings']>) {
  if (!isBackendEnabled()) return update_yield_management_settings(payload);
  await apiRequest('/api/v1/ops/settings/yield-management', { method: 'PATCH', tenantId: null, body: payload });
  update_yield_management_settings(payload);
  return { success: true };
}

export async function update_staff_benefits_live(payload: {
  daily_limit_azn: number;
  allowed_scope: 'all' | 'categories' | 'items';
  included_categories: string[];
  included_items: string[];
  item_unit_cap_azn: number;
}) {
  if (!isBackendEnabled()) return update_staff_benefits(payload);
  await apiRequest('/api/v1/ops/settings/staff-benefits', { method: 'PATCH', tenantId: null, body: payload });
  update_staff_benefits(payload);
  return { success: true };
}

export async function update_bank_commission_live(payload: {
  min_amount?: number;
  percent?: number;
  card_sale_percent?: number;
  card_transfer_percent?: number;
}) {
  if (!isBackendEnabled()) return update_bank_commission(payload as any);
  await apiRequest('/api/v1/ops/settings/bank-commission', { method: 'PATCH', tenantId: null, body: payload });
  update_bank_commission(payload as any);
  return { success: true };
}

export async function update_finance_policy_live(payload: NonNullable<Settings['finance_policy']>) {
  if (!isBackendEnabled()) return update_finance_policy(payload);
  await apiRequest('/api/v1/ops/settings/finance-policy', { method: 'PATCH', tenantId: null, body: payload });
  update_finance_policy(payload);
  return { success: true };
}

export async function update_landing_settings_live(payload: Settings['landing_settings']) {
  if (!isBackendEnabled()) return update_landing_settings(payload);
  await apiRequest('/api/v1/ops/settings/landing', { method: 'PATCH', tenantId: null, body: payload });
  update_landing_settings(payload);
  return { success: true };
}

export async function update_landing_draft_live(payload: Settings['landing_settings']) {
  if (!isBackendEnabled()) return update_landing_settings(payload);
  await apiRequest('/api/v1/ops/settings/landing?mode=draft', { method: 'PATCH', tenantId: null, body: payload });
  return { success: true };
}

export async function get_landing_studio_live() {
  if (!isBackendEnabled()) {
    const current = normalizeLandingSettings(get_settings().landing_settings || DEFAULT_LANDING_SETTINGS);
    return { published: current, draft: current };
  }
  return apiRequest<{ published: NonNullable<Settings['landing_settings']>; draft: NonNullable<Settings['landing_settings']> }>(
    '/api/v1/ops/settings/landing/studio',
    { tenantId: null },
  );
}

export async function publish_landing_live() {
  if (!isBackendEnabled()) return { success: true };
  await apiRequest('/api/v1/ops/settings/landing/publish', { method: 'POST', tenantId: null });
  return { success: true };
}

export async function get_public_landing_settings_live() {
  if (!isBackendEnabled()) return normalizeLandingSettings(get_settings().landing_settings || DEFAULT_LANDING_SETTINGS);
  const data = await apiRequest<NonNullable<Settings['landing_settings']>>('/api/v1/ops/public/landing-settings', {
    auth: false,
    tenantId: null,
  });
  return normalizeLandingSettings(data || DEFAULT_LANDING_SETTINGS);
}

export async function setup_totp_live() {
  if (!isBackendEnabled()) {
    throw new Error('Google Authenticator yalnız backend aktiv olduqda qoşula bilər');
  }
  return apiRequest<{ secret: string; otpauth_url: string }>('/api/v1/settings/2fa/totp/setup', {
    method: 'POST',
    tenantId: null,
  });
}

export async function verify_totp_live(code: string) {
  if (!isBackendEnabled()) {
    throw new Error('Google Authenticator yalnız backend aktiv olduqda qoşula bilər');
  }
  await apiRequest('/api/v1/settings/2fa/totp/verify', {
    method: 'POST',
    tenantId: null,
    body: { code: String(code || '').trim() },
  });
  return { success: true };
}

export async function disable_totp_live(current_password: string, code?: string) {
  if (!isBackendEnabled()) {
    throw new Error('Google Authenticator yalnız backend aktiv olduqda söndürülə bilər');
  }
  await apiRequest('/api/v1/settings/2fa/totp/disable', {
    method: 'POST',
    tenantId: null,
    body: { current_password: String(current_password || ''), code: String(code || '').trim() || undefined },
  });
  removeScopedStorage('trusted_admin_2fa_token');
  return { success: true };
}

export async function reset_system_live(current_password: string, code?: string) {
  if (!isBackendEnabled()) {
    throw new Error('Sistem sıfırlama yalnız backend aktiv olduqda mümkündür');
  }
  await apiRequest('/api/v1/settings/reset-system', {
    method: 'POST',
    tenantId: null,
    timeoutMs: 120000,
    retryCount: 0,
    body: { current_password: String(current_password || ''), code: String(code || '').trim() || undefined },
  });
  await clearOfflineSalesStore();
  try {
    window.dispatchEvent(new CustomEvent('offline-sales-reset'));
  } catch {
    // no-op
  }
  return { success: true };
}

export function get_business_profile(tenant_id?: string) {
  const resolvedTenant = resolveTenant(tenant_id);
  const profiles = getDB<any>('business_profile');
  const current = profiles.find((p) => p.tenant_id === resolvedTenant);
  if (current) return current;

  const created = {
    tenant_id: resolvedTenant,
    company_name: 'iRonWaves POS',
    voen: '',
    phone: '',
    address: '',
    website: 'https://super.ironwaves.store',
    logo_url: '',
    receipt_footer: 'Bizi secdiyiniz ucun tesekkur edirik!'
  };
  profiles.push(created);
  setDB('business_profile', profiles);
  return created;
}

export function update_business_profile(tenant_id: string, payload: {
  company_name: string;
  voen: string;
  phone: string;
  address?: string;
  website: string;
  logo_url?: string;
  receipt_footer?: string;
}, updated_by: string = 'admin') {
  const profiles = getDB<any>('business_profile');
  const resolvedTenant = resolveTenant(tenant_id);
  const idx = profiles.findIndex((p) => p.tenant_id === resolvedTenant);
  if (idx >= 0) {
    profiles[idx] = { ...profiles[idx], ...payload };
  } else {
    profiles.push({ tenant_id: resolvedTenant, ...payload });
  }
  setDB('business_profile', profiles);
  logEvent(updated_by, 'BUSINESS_PROFILE_UPDATED', { tenant_id: resolvedTenant });
  return true;
}

export async function get_business_profile_live(tenant_id?: string) {
  if (!isBackendEnabled()) return get_business_profile(tenant_id);
  const data = await apiRequest<any>('/api/v1/ops/business-profile', { tenantId: null });
  const profiles = getDB<any>('business_profile');
  const resolvedTenant = resolveTenant(tenant_id);
  const idx = profiles.findIndex((p) => p.tenant_id === resolvedTenant);
  if (idx >= 0) profiles[idx] = data;
  else profiles.push(data);
  setDB('business_profile', profiles);
  return data;
}

export async function get_public_branding_live(tenant_id?: string) {
  if (!isBackendEnabled()) return get_business_profile(tenant_id);
  const requestedTenant = String(tenant_id || '').trim();
  const query = requestedTenant ? `?tenant_id=${encodeURIComponent(requestedTenant)}` : '';
  const data = await apiRequest<any>(`/api/v1/ops/public-branding${query}`, {
    tenantId: null,
    auth: false,
    timeoutMs: 12000,
    retryCount: 2,
    retryDelayMs: 1500,
  });
  const profiles = getDB<any>('business_profile');
  const resolvedTenant = String(data?.tenant_id || requestedTenant);
  const idx = profiles.findIndex((p) => p.tenant_id === resolvedTenant);
  if (idx >= 0) profiles[idx] = { ...profiles[idx], ...data };
  else profiles.push({ ...data, tenant_id: resolvedTenant });
  setDB('business_profile', profiles);
  return { ...data, tenant_id: resolvedTenant };
}

export async function update_business_profile_live(tenant_id: string, payload: {
  company_name: string;
  voen: string;
  phone: string;
  address?: string;
  website: string;
  logo_url?: string;
  receipt_footer?: string;
}, updated_by: string = 'admin') {
  if (!isBackendEnabled()) return update_business_profile(tenant_id, payload, updated_by);
  await apiRequest('/api/v1/ops/business-profile', { method: 'PUT', tenantId: null, body: payload });
  update_business_profile(tenant_id, payload, updated_by);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('business-profile-updated', { detail: { tenant_id, company_name: payload.company_name } }));
  }
  return true;
}

// --- İstifadəçi İdarəetməsi ---

export async function create_user(payload: Omit<User, 'id' | 'failed_attempts' | 'is_locked' | 'lock_until'>) {
  const users = getDB<User>('users');
  const role = String(payload.role || '').toLowerCase();
  const usesPassword = ['admin', 'manager', 'super_admin'].includes(role);
  const usesPin = ['staff', 'kitchen'].includes(role);
  
  const existing = users.find(u => u.username === payload.username || (u.pin && u.pin === payload.pin));
  if (existing) throw new Error('Bu istifadəçi adı və ya PIN artıq mövcuddur');

  if (usesPassword && (!payload.password || !isStrongLocalPassword(payload.password))) throw new Error('Şifrə ən azı 10 simvol olmalı, böyük/kiçik hərf, rəqəm və simvol ehtiva etməlidir');
  const minPinLength = getStaffPinLength(payload.tenant_id);
  if (usesPin && (!payload.pin || payload.pin.length < minPinLength || payload.pin.length > 15)) throw new Error(`PIN ${minPinLength}-15 rəqəm aralığında olmalıdır`);
  if (usesPassword && payload.pin) throw new Error('Admin/Manager yalnız şifrə ilə giriş etməlidir');
  if (usesPin && payload.password) throw new Error('Staff/Kitchen yalnız PIN ilə giriş etməlidir');

  // Gələcəkdə password bura girməmişdən öncə bcrypt ilə hash olunur
  const newUser: User = {
    id: uuidv4(),
    ...payload,
    password: undefined,
    pin: undefined,
    two_factor_enabled: Boolean((payload as any).two_factor_enabled),
    failed_attempts: 0,
    is_locked: false
  };
  if (usesPassword) {
    (newUser as any).password_hash = await hashLocalCredential(String(payload.password || ''));
  }
  if (usesPin) {
    (newUser as any).pin_hash = await hashLocalCredential(String(payload.pin || ''));
  }

  users.push(newUser);
  setDB('users', users);

  logEvent('admin', 'USER_UPSERT', { target_user: payload.username, role: payload.role });
  return newUser;
}

export function delete_user(username: string) {
  let users = getDB<User>('users');
  const target = users.find(u => u.username === username);
  if (!target) throw new Error('İstifadəçi tapılmadı');
  const targetRole = String(target.role || '').toLowerCase();
  if ((username === 'admin' || username === 'super_admin') && targetRole !== 'super_admin') {
    throw new Error('Əsas admin silinə bilməz!');
  }
  if (targetRole === 'super_admin') {
    const activeSuperAdmins = users.filter((u) => String(u.role || '').toLowerCase() === 'super_admin');
    if (activeSuperAdmins.length <= 1) {
      throw new Error('Son platform owner silinə bilməz');
    }
  }

  const userExists = users.some(u => u.username === username);
  if (!userExists) throw new Error('İstifadəçi tapılmadı');

  users = users.filter(u => u.username !== username);
  setDB('users', users);

  logEvent('admin', 'USER_DELETE', { target_user: username });
  return { success: true };
}

export function get_users(tenant_id?: string) {
  const resolvedTenant = resolveTenant(tenant_id);
  return getDB<User>('users').filter((u) => u.tenant_id === resolvedTenant);
}

export async function update_user_credentials(
  username: string,
  updates: { password?: string; pin?: string; two_factor_enabled?: boolean },
  updated_by: string = 'admin'
) {
  const users = getDB<User>('users');
  const index = users.findIndex((u) => u.username === username);
  if (index === -1) throw new Error('İstifadəçi tapılmadı');
  const role = String(users[index].role || '').toLowerCase();
  const usesPassword = ['admin', 'manager', 'super_admin'].includes(role);
  const usesPin = ['staff', 'kitchen'].includes(role);

  if (updates.password && !isStrongLocalPassword(updates.password)) {
    throw new Error('Şifrə ən azı 10 simvol olmalı, böyük/kiçik hərf, rəqəm və simvol ehtiva etməlidir');
  }
  const minPinLength = getStaffPinLength(users[index].tenant_id);
  if (updates.pin && (updates.pin.length < minPinLength || updates.pin.length > 15)) {
    throw new Error(`PIN ${minPinLength}-15 rəqəm aralığında olmalıdır`);
  }
  if (updates.password !== undefined && !usesPassword) {
    throw new Error('Bu rol şifrə ilə giriş etmir');
  }
  if (updates.pin !== undefined && !usesPin) {
    throw new Error('Bu rol PIN ilə giriş etmir');
  }

  const nextUser: any = {
    ...users[index],
    ...updates,
    two_factor_enabled:
      typeof updates.two_factor_enabled === 'boolean'
        ? updates.two_factor_enabled
        : users[index].two_factor_enabled,
  };
  if (usesPassword && updates.password !== undefined) {
    nextUser.password_hash = await hashLocalCredential(updates.password);
    delete nextUser.password;
  }
  if (usesPin && updates.pin !== undefined) {
    nextUser.pin_hash = await hashLocalCredential(updates.pin);
    delete nextUser.pin;
  }
  users[index] = nextUser;
  setDB('users', users);
  logEvent(updated_by, 'USER_CREDENTIALS_UPDATED', { target_user: username });
  return true;
}

type BackendUserRecord = {
  id: string;
  tenant_id: string;
  username: string;
  role: 'super_admin' | 'admin' | 'manager' | 'staff' | 'kitchen';
  two_factor_enabled?: boolean;
  is_active?: boolean;
};

export async function get_users_live(tenant_id?: string): Promise<User[]> {
  if (!isBackendEnabled()) {
    return get_users(tenant_id);
  }
  const rows = await apiRequest<BackendUserRecord[]>('/api/v1/settings/users', { method: 'GET', tenantId: null });
  return rows.map((u) => ({
    id: u.id,
    tenant_id: u.tenant_id,
    username: u.username,
    role: u.role,
    two_factor_enabled: Boolean(u.two_factor_enabled),
    failed_attempts: 0,
    is_locked: false,
  }));
}

export async function create_user_live(
  payload: Omit<User, 'id' | 'failed_attempts' | 'is_locked' | 'lock_until'>
): Promise<User> {
  if (!isBackendEnabled()) {
    return create_user(payload);
  }
  const created = await apiRequest<BackendUserRecord>('/api/v1/settings/users', {
    method: 'POST',
    tenantId: null,
    body: payload,
  });
  return {
    id: created.id,
    tenant_id: created.tenant_id,
    username: created.username,
    role: created.role,
    two_factor_enabled: Boolean(created.two_factor_enabled),
    failed_attempts: 0,
    is_locked: false,
  };
}

export async function delete_user_live(username: string): Promise<{ success: boolean }> {
  if (!isBackendEnabled()) {
    return delete_user(username);
  }
  return apiRequest<{ success: boolean }>(`/api/v1/settings/users/${encodeURIComponent(username)}`, {
    method: 'DELETE',
    tenantId: null,
  });
}

export async function update_user_credentials_live(
  username: string,
  updates: { password?: string; pin?: string; two_factor_enabled?: boolean; current_password?: string },
  updated_by: string = 'admin'
): Promise<boolean> {
  if (!isBackendEnabled()) {
    return update_user_credentials(username, updates, updated_by);
  }
  await apiRequest<{ success: boolean }>(`/api/v1/settings/users/${encodeURIComponent(username)}/credentials`, {
    method: 'PATCH',
    tenantId: null,
    body: updates,
  });
  return true;
}

export async function update_api_key_live(
  api_key: string,
  ai_config?: { provider?: string; model?: string; autodetected?: boolean; ollama_freeapi_enabled?: boolean },
) {
  if (!isBackendEnabled()) {
    const settings = getSettings();
    settings.gemini_api_key = api_key;
    settings.ai_config = {
      provider: String(ai_config?.provider || settings.ai_config?.provider || 'unknown'),
      model: String(ai_config?.model || settings.ai_config?.model || 'auto'),
      autodetected: ai_config?.autodetected !== false,
      ollama_freeapi_enabled:
        ai_config?.ollama_freeapi_enabled === undefined
          ? settings.ai_config?.ollama_freeapi_enabled === true
          : ai_config?.ollama_freeapi_enabled === true,
      updated_at: new Date().toISOString(),
    };
    saveSettings(settings);
    return { success: true };
  }
  await apiRequest('/api/v1/ops/settings/gemini-key', {
    method: 'PATCH',
    tenantId: null,
    body: { api_key, ai_config },
  });
  const settings = getSettings();
  settings.gemini_api_key = api_key;
  settings.ai_config = {
    provider: String(ai_config?.provider || settings.ai_config?.provider || 'unknown'),
    model: String(ai_config?.model || settings.ai_config?.model || 'auto'),
    autodetected: ai_config?.autodetected !== false,
    ollama_freeapi_enabled:
      ai_config?.ollama_freeapi_enabled === undefined
        ? settings.ai_config?.ollama_freeapi_enabled === true
        : ai_config?.ollama_freeapi_enabled === true,
    updated_at: new Date().toISOString(),
  };
  saveSettings(settings);
  return { success: true };
}

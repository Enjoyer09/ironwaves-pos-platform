import { v4 as uuidv4 } from 'uuid';
import { getDB, setDB } from '../lib/db_sim';
import { logEvent } from '../lib/logger';
import { CustomerAppTier, PosLayoutConfig, Settings, User } from '../types/pos';
import { getActiveTenantId, filterTenantRecords } from '../lib/tenant';
import { apiRequest, isBackendEnabled } from './client';
import { hashLocalCredential } from '../lib/local_auth';
import { readScopedStorage, removeScopedStorage } from '../lib/storage_keys';
import { clearOfflineSalesStore } from '../lib/offline';
import type { AiProvider } from '../lib/ai_config';

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

function normalizeAiProvider(raw: unknown): AiProvider {
  switch (String(raw || '').trim().toLowerCase()) {
    case 'google':
    case 'openai':
    case 'anthropic':
    case 'openrouter':
    case 'xai':
    case 'huggingface':
    case 'ollama':
    case 'ollama_freeapi':
    case 'opencode':
      return String(raw).trim().toLowerCase() as AiProvider;
    default:
      return 'unknown';
  }
}

function normalizePosLayoutConfig(
  source: any,
  fallback?: Partial<PosLayoutConfig>,
  isNested: boolean = false,
): PosLayoutConfig {
  const base = fallback || {};
  const rawHiddenWidgets = ((source?.hidden_widgets) || (base.hidden_widgets as string[] | undefined) || []) as unknown[];
  const rawLeftHiddenWidgets = ((source?.left_hidden_widgets) || (base.left_hidden_widgets as string[] | undefined) || []) as unknown[];
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
  const hidden_widgets: string[] = Array.from(
    new Set(rawHiddenWidgets.map((v: unknown) => String(v || '').trim()).filter(Boolean)),
  )
    .filter((key) => POS_RIGHT_WIDGET_KEYS.includes(key as any))
    .filter((key) => !POS_REQUIRED_RIGHT_WIDGETS.includes(key as any));
  const left_hidden_widgets: string[] = Array.from(
    new Set(rawLeftHiddenWidgets.map((v: unknown) => String(v || '').trim()).filter(Boolean)),
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
      staff: {},
      manager: {},
    },
    device_layouts: {
      desktop: {},
      tablet: {},
    },
  };

  if (!isNested) {
    cleaned.role_overrides = {
      staff: source?.role_overrides?.staff ? normalizePosLayoutConfig(source.role_overrides.staff, base, true) : {},
      manager: source?.role_overrides?.manager ? normalizePosLayoutConfig(source.role_overrides.manager, base, true) : {},
    };
    const deviceLayouts = source?.device_layouts || {};
    cleaned.device_layouts = {
      desktop: deviceLayouts.desktop ? normalizePosLayoutConfig(deviceLayouts.desktop, cleaned, true) : {},
      tablet: deviceLayouts.tablet ? normalizePosLayoutConfig(deviceLayouts.tablet, cleaned, true) : {},
    };
  }

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
  summer_promo_enabled: false,
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
  bg_gradient: 'linear-gradient(155deg, #8ec5ff 0%, #a48bff 28%, #ef8cf9 57%, #ffb58f 100%)',
  primary_color: '#facc15',
  accent_color: '#22d3ee',
  emoji_icon: '☕',
  preset_tags: [
    '❤️ Xidmət əla idi',
    '☕ Dad mükəmməl idi',
    '✨ Məkan çox təmiz idi',
    '👤 Personal peşəkar idi',
    '🏷️ Qiymət/dəyər çox yaxşı idi',
    '👍 Mütləq tövsiyə edərəm',
  ],
  min_stars_for_google_review: 4,
  required_comment_threshold: 3,
  custom_heading_az: 'Rəy və məmnuniyyət sorğusu',
  custom_heading_ru: 'Опрос о качестве обслуживания',
  custom_heading_en: 'Customer Satisfaction Survey',
  custom_subheading_az: 'Xidmət keyfiyyətini yaxşılaşdırmaq üçün 30 saniyə ayırın.',
  custom_subheading_ru: 'Пожалуйста, уделите 30 секунд для улучшения качества услуг.',
  custom_subheading_en: 'Please take 30 seconds to help us improve our service.',
};

const FEEDBACK_SETTINGS_OVERRIDES_KEY = 'iw_feedback_settings_overrides_v1';

function normalizeFeedbackSettings(source?: Settings['feedback_settings']): NonNullable<Settings['feedback_settings']> {
  const raw: Partial<NonNullable<Settings['feedback_settings']>> = source || {};
  const defaultCouponPercent = DEFAULT_FEEDBACK_SETTINGS.coupon_percent ?? 5;
  const defaultMinStars = DEFAULT_FEEDBACK_SETTINGS.min_stars_for_google_review ?? 4;
  const defaultRequiredCommentThreshold = DEFAULT_FEEDBACK_SETTINGS.required_comment_threshold ?? 3;
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
    coupon_percent: Math.max(1, Math.min(100, Number(raw.coupon_percent ?? defaultCouponPercent) || defaultCouponPercent)),
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
    bg_gradient: String(raw.bg_gradient || DEFAULT_FEEDBACK_SETTINGS.bg_gradient).trim(),
    primary_color: String(raw.primary_color || DEFAULT_FEEDBACK_SETTINGS.primary_color).trim(),
    accent_color: String(raw.accent_color || DEFAULT_FEEDBACK_SETTINGS.accent_color).trim(),
    emoji_icon: String(raw.emoji_icon || DEFAULT_FEEDBACK_SETTINGS.emoji_icon).trim(),
    preset_tags: Array.isArray(raw.preset_tags) ? raw.preset_tags.map((x: unknown) => String(x || '').trim()).filter(Boolean) : DEFAULT_FEEDBACK_SETTINGS.preset_tags,
    min_stars_for_google_review: Math.max(1, Math.min(5, Number(raw.min_stars_for_google_review ?? defaultMinStars) || defaultMinStars)),
    required_comment_threshold: Math.max(1, Math.min(5, Number(raw.required_comment_threshold ?? defaultRequiredCommentThreshold) || defaultRequiredCommentThreshold)),
    custom_heading_az: String(raw.custom_heading_az || DEFAULT_FEEDBACK_SETTINGS.custom_heading_az).trim(),
    custom_heading_ru: String(raw.custom_heading_ru || DEFAULT_FEEDBACK_SETTINGS.custom_heading_ru).trim(),
    custom_heading_en: String(raw.custom_heading_en || DEFAULT_FEEDBACK_SETTINGS.custom_heading_en).trim(),
    custom_subheading_az: String(raw.custom_subheading_az || DEFAULT_FEEDBACK_SETTINGS.custom_subheading_az).trim(),
    custom_subheading_ru: String(raw.custom_subheading_ru || DEFAULT_FEEDBACK_SETTINGS.custom_subheading_ru).trim(),
    custom_subheading_en: String(raw.custom_subheading_en || DEFAULT_FEEDBACK_SETTINGS.custom_subheading_en).trim(),
  };
}

/**
 * P0.1 — Customer App ayarlarının tək default mənbəyi.
 * Əvvəl bu obyekt faylda iki yerdə təkrarlanırdı və `update_customer_app_settings`
 * onu hər save-də sıfırdan qururdu, yəni panelin göndərmədiyi açar (tiers,
 * birthday_enabled, onesignal_app_id) itirdi. Artıq merge + normalize edilir.
 */
export const DEFAULT_CUSTOMER_APP_TIERS: CustomerAppTier[] = [
  { key: 'bronze', label: { az: 'Bürünc', ru: 'Бронза', en: 'Bronze' }, threshold: 0, color: '#cd7f32', multiplier: 1, discount_percent: 0 },
  { key: 'silver', label: { az: 'Gümüş', ru: 'Серебро', en: 'Silver' }, threshold: 100, color: '#c0c0c0', multiplier: 1, discount_percent: 0 },
  { key: 'gold', label: { az: 'Qızıl', ru: 'Золото', en: 'Gold' }, threshold: 300, color: '#d8b156', multiplier: 1.5, discount_percent: 0 },
];

export const DEFAULT_CUSTOMER_APP_SETTINGS: NonNullable<Settings['customer_app_settings']> = {
  enabled: true,
  program_mode: 'points',
  layout_preset: 'rewards',
  registration_mode: 'full',
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
  campaigns_require_online: false,
  campaign_activation_minutes: 15,
  birthday_enabled: false,
  birthday_bonus_points: 10,
  // P0.2 — `birthday_bonus_points` kanonikdir; bu açar yalnız köhnə oxucular üçün güzgüdür.
  birthday_bonus_stars: 10,
  earn_rate_per_azn: 2,
  min_purchase_for_earn: 0,
  first_purchase_bonus: 5,
  double_points_days: [],
  onesignal_app_id: '',
  tiers: DEFAULT_CUSTOMER_APP_TIERS,
};

export const CUSTOMER_APP_SETTING_KEYS = Object.keys(DEFAULT_CUSTOMER_APP_SETTINGS) as Array<
  keyof NonNullable<Settings['customer_app_settings']>
>;

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function normHex(value: unknown, fallback: string): string {
  const candidate = String(value ?? '').trim();
  return HEX_COLOR_RE.test(candidate) ? candidate : fallback;
}

function normText(value: unknown, fallback: string, limit = 500): string {
  const candidate = String(value ?? '').trim();
  return candidate ? candidate.slice(0, limit) : fallback;
}

function normChoice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const candidate = String(value ?? '').trim().toLowerCase() as T;
  return allowed.includes(candidate) ? candidate : fallback;
}

/** Backend `_public_image_url` güzgüsü: data URL 350k-a, adi URL 2048-ə qədər. Truncate YOX. */
const MAX_EMBEDDED_IMAGE_CHARS = 350_000;
const MAX_IMAGE_URL_LENGTH = 2048;

function normImageUrl(value: unknown): string {
  const candidate = String(value ?? '').trim();
  if (!candidate) return '';
  if (candidate.startsWith('data:')) {
    return candidate.startsWith('data:image/') && candidate.length <= MAX_EMBEDDED_IMAGE_CHARS ? candidate : '';
  }
  return candidate.length > MAX_IMAGE_URL_LENGTH ? '' : candidate;
}

/** 0 qanuni dəyərdir (bonusu söndürmək üçün) — ona görə `x || default` işlədilmir. */
function normNum(value: unknown, fallback: number, min: number, max: number, integer = false): number {
  const parsed = value === '' || value === null || value === undefined || typeof value === 'boolean' ? NaN : Number(value);
  let next = Number.isFinite(parsed) ? parsed : fallback;
  if (next < min) next = min > 0 ? Math.max(min, fallback) : min;
  next = Math.min(next, max);
  return integer ? Math.round(next) : Math.round(next * 10000) / 10000;
}

/** Dərin kopya — `label` obyekti paylaşılsa, çağıran tərəf modul defaultunu dəyişə bilər. */
function cloneDefaultCustomerAppTiers(): CustomerAppTier[] {
  return DEFAULT_CUSTOMER_APP_TIERS.map((t) => ({ ...t, label: { ...t.label } }));
}

function normCustomerAppTiers(value: unknown): CustomerAppTier[] {
  const rows = Array.isArray(value) ? value : null;
  if (!rows || rows.length === 0) return cloneDefaultCustomerAppTiers();
  const cleaned: CustomerAppTier[] = [];
  for (const row of rows.slice(0, 12)) {
    if (!row || typeof row !== 'object') continue;
    const source = row as Record<string, any>;
    const key = String(source.key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32);
    if (!key) continue;
    const rawLabel = source.label;
    const labelObj = rawLabel && typeof rawLabel === 'object' ? rawLabel : null;
    const az = normText(labelObj ? labelObj.az : rawLabel, key, 60);
    cleaned.push({
      key,
      label: {
        az,
        ru: normText(labelObj ? labelObj.ru : rawLabel, az, 60),
        en: normText(labelObj ? labelObj.en : rawLabel, az, 60),
      },
      threshold: normNum(source.threshold, 0, 0, 1000000, true),
      color: normHex(source.color, '#cd7f32'),
      multiplier: normNum(source.multiplier, 1, 0, 10),
      discount_percent: normNum(source.discount_percent, 0, 0, 100),
    });
  }
  if (cleaned.length === 0) return cloneDefaultCustomerAppTiers();
  cleaned.sort((a, b) => a.threshold - b.threshold);
  // Ən aşağı pillə 0-dan başlamalıdır, yoxsa yeni müştəri tier-siz qalır.
  cleaned[0].threshold = 0;
  return cleaned;
}

function normBool(value: unknown, fallback: boolean): boolean {
  return value === undefined || value === null ? fallback : Boolean(value);
}

/** Açar mənalı dəyər daşıyır? (yoxdur / null / boş sətir / bool → "yoxdur") */
function hasMeaningfulValue(raw: Record<string, any>, key: string): boolean {
  if (!(key in raw)) return false;
  const v = raw[key];
  if (v === null || v === undefined || typeof v === 'boolean') return false;
  if (typeof v === 'string' && !v.trim()) return false;
  return true;
}

/**
 * P0.2 — ad günü bonusunun kanonik açarı `birthday_bonus_points`-dur (backend güzgüsü).
 * Köhnə blob-da yalnız `birthday_bonus_stars` varsa dəyər ona köçürülür (lazy migrasiya),
 * sonra hər iki açar eyni rəqəmi göstərir.
 */
function canonicalBirthdayBonus(raw: Record<string, any>): number {
  const fallback = DEFAULT_CUSTOMER_APP_SETTINGS.birthday_bonus_points ?? 10;
  if (hasMeaningfulValue(raw, 'birthday_bonus_points')) return normNum(raw.birthday_bonus_points, fallback, 0, 1000, true);
  if (hasMeaningfulValue(raw, 'birthday_bonus_stars')) return normNum(raw.birthday_bonus_stars, fallback, 0, 1000, true);
  return fallback;
}

/**
 * P0.1 — açar-açar normalize. `source` artıq merge olunmuş obyektdir
 * (`{...mövcud, ...payload}`), ona görə burada heç bir açar itmir.
 * Argument verilmədikdə tam default dəst (tiers klonlanmış) qaytarır.
 */
export function normalizeCustomerAppSettings(source?: unknown): NonNullable<Settings['customer_app_settings']> {
  const raw = (source && typeof source === 'object' ? source : {}) as Record<string, any>;
  const d = DEFAULT_CUSTOMER_APP_SETTINGS;
  const birthdayBonus = canonicalBirthdayBonus(raw);
  const days = Array.isArray(raw.double_points_days)
    ? Array.from(new Set(raw.double_points_days.map((x: unknown) => Number(x)).filter((n: number) => Number.isInteger(n) && n >= 1 && n <= 7))).sort(
        (a, b) => a - b,
      )
    : [...(d.double_points_days || [])];
  return {
    enabled: normBool(raw.enabled, d.enabled),
    program_mode: normChoice(raw.program_mode, ['points', 'cashback'] as const, d.program_mode || 'points'),
    layout_preset: normChoice(raw.layout_preset, ['rewards', 'cashback', 'playful'] as const, d.layout_preset || 'rewards'),
    registration_mode: normChoice(raw.registration_mode, ['simple', 'lightweight', 'full'] as const, d.registration_mode || 'full'),
    consent_text: normText(raw.consent_text, d.consent_text || '', 1000),
    join_customer_type: normText(raw.join_customer_type, d.join_customer_type || 'golden', 40),
    join_discount_percent: normNum(raw.join_discount_percent, d.join_discount_percent ?? 5, 0, 100),
    app_name: normText(raw.app_name, d.app_name, 60),
    hero_title: normText(raw.hero_title, d.hero_title, 120),
    hero_subtitle: normText(raw.hero_subtitle, d.hero_subtitle, 240),
    hero_image_url: normImageUrl(raw.hero_image_url),
    background_image_url: normImageUrl(raw.background_image_url),
    background_color: normHex(raw.background_color, d.background_color || '#0b1220'),
    points_label: normText(raw.points_label, d.points_label, 30),
    reward_name: normText(raw.reward_name, d.reward_name, 60),
    reward_threshold: normNum(raw.reward_threshold, d.reward_threshold, 1, 1000, true),
    reward_description: normText(raw.reward_description, d.reward_description, 240),
    reward_card_style: normChoice(raw.reward_card_style, ['rounded', 'soft-square', 'glass'] as const, d.reward_card_style || 'rounded'),
    cashback_percent: normNum(raw.cashback_percent, d.cashback_percent ?? 5, 0, 100),
    primary_color: normHex(raw.primary_color, d.primary_color),
    accent_color: normHex(raw.accent_color, d.accent_color),
    show_qr_card: normBool(raw.show_qr_card, d.show_qr_card ?? true),
    show_wallet: normBool(raw.show_wallet, d.show_wallet ?? true),
    ai_barista_enabled: normBool(raw.ai_barista_enabled, d.ai_barista_enabled ?? false),
    ai_falci_enabled: normBool(raw.ai_falci_enabled, d.ai_falci_enabled ?? false),
    show_campaigns: normBool(raw.show_campaigns, d.show_campaigns),
    show_history: normBool(raw.show_history, d.show_history),
    show_notifications: normBool(raw.show_notifications, d.show_notifications),
    campaigns_require_online: normBool(raw.campaigns_require_online, d.campaigns_require_online ?? false),
    campaign_activation_minutes: normNum(raw.campaign_activation_minutes, d.campaign_activation_minutes ?? 15, 1, 1440, true),
    birthday_enabled: normBool(raw.birthday_enabled, d.birthday_enabled ?? false),
    // P0.2 — iki açar bir dəyəri güzgüləyir; kanonik olan `birthday_bonus_points`.
    birthday_bonus_points: birthdayBonus,
    birthday_bonus_stars: birthdayBonus,
    earn_rate_per_azn: normNum(raw.earn_rate_per_azn, d.earn_rate_per_azn ?? 2, 0, 1000),
    min_purchase_for_earn: normNum(raw.min_purchase_for_earn, d.min_purchase_for_earn ?? 0, 0, 100000),
    first_purchase_bonus: normNum(raw.first_purchase_bonus, d.first_purchase_bonus ?? 5, 0, 1000, true),
    double_points_days: days,
    onesignal_app_id: normText(raw.onesignal_app_id, '', 64),
    tiers: normCustomerAppTiers(raw.tiers),
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
      device_authorization_enabled: false,
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
      unit_options: ['kq', 'qram', 'litr', 'ml', 'ədəd', 'paket', 'qutu', 'metr'],
    },
    staff_benefits: {
      daily_limit_azn: 6,
      allowed_scope: 'all',
      included_categories: [],
      included_items: [],
      item_unit_cap_azn: 6,
      coffee_unit_cap_azn: 6,
      other_unit_cap_azn: 2,
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
      background_color: '#0f0f0f',
      surface_color: '#1a1a1a',
      text_color: '#ffffff',
      primary_color: '#facc15',
      accent_color: '#facc15',
      hero_image_url: '',
      poster_image_url: '',
      poster_background_color: '#facc15',
      logo_shape: 'rounded',
      font_family: '',
      custom_font_url: '',
      splash_type: 'none',
      splash_url: '',
      splash_duration_ms: 3000,
      splash_overlay_text: '',
      splash_bg_color: '#000000',
    },
    feedback_settings: DEFAULT_FEEDBACK_SETTINGS,
    customer_app_settings: normalizeCustomerAppSettings(),
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
    summer_promo_enabled: Boolean(payload?.summer_promo_enabled),
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
  ui_mode?: 'old' | 'new';
  login_background_url?: string;
  device_authorization_enabled?: boolean;
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
    ui_mode: payload.ui_mode === 'new' ? 'new' : 'old',
    login_background_url: payload.login_background_url !== undefined
      ? payload.login_background_url
      : (settings.session_settings?.login_background_url || ''),
    device_authorization_enabled: payload.device_authorization_enabled !== undefined
      ? payload.device_authorization_enabled === true
      : (settings.session_settings?.device_authorization_enabled === true),
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

export function update_delivery_integrations(payload: {
  bolt_food_enabled?: boolean;
  bolt_food_provider_id?: string;
  bolt_food_secret_key?: string;
  wolt_enabled?: boolean;
  wolt_venue_id?: string;
  wolt_client_secret?: string;
}) {
  const settings = getSettings();
  const existing = settings.delivery_integrations || {
    bolt_food_enabled: false,
    bolt_food_provider_id: '',
    bolt_food_secret_key: '',
    wolt_enabled: false,
    wolt_venue_id: '',
    wolt_client_secret: '',
  };
  
  let bolt_secret = String(payload.bolt_food_secret_key || '').trim();
  if (bolt_secret === '***') {
    bolt_secret = existing.bolt_food_secret_key;
  }
  
  let wolt_secret = String(payload.wolt_client_secret || '').trim();
  if (wolt_secret === '***') {
    wolt_secret = existing.wolt_client_secret;
  }

  settings.delivery_integrations = {
    bolt_food_enabled: Boolean(payload.bolt_food_enabled),
    bolt_food_provider_id: String(payload.bolt_food_provider_id || '').trim(),
    bolt_food_secret_key: bolt_secret,
    wolt_enabled: Boolean(payload.wolt_enabled),
    wolt_venue_id: String(payload.wolt_venue_id || '').trim(),
    wolt_client_secret: wolt_secret,
  };
  saveSettings(settings);
  logEvent('admin', 'DELIVERY_INTEGRATIONS_UPDATED', {
    bolt_food_enabled: settings.delivery_integrations.bolt_food_enabled,
    bolt_food_provider_id: settings.delivery_integrations.bolt_food_provider_id,
    wolt_enabled: settings.delivery_integrations.wolt_enabled,
    wolt_venue_id: settings.delivery_integrations.wolt_venue_id,
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
  }
  if (!s.print_settings) {
    s.print_settings = { use_qz: false, printer_name: '' };
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
  }
  if (!s.pos_layout_draft) {
    s.pos_layout_draft = JSON.parse(JSON.stringify(s.pos_layout || DEFAULT_POS_LAYOUT));
  }
  s.pos_layout = normalizePosLayoutConfig(s.pos_layout || DEFAULT_POS_LAYOUT, DEFAULT_POS_LAYOUT);
  s.pos_layout_draft = normalizePosLayoutConfig(s.pos_layout_draft || s.pos_layout || DEFAULT_POS_LAYOUT, s.pos_layout || DEFAULT_POS_LAYOUT);
  if (!s.pos_layout.left_hidden_widgets) {
    s.pos_layout.left_hidden_widgets = [];
  }
  if (!s.pos_layout.left_widget_order) {
    s.pos_layout.left_widget_order = ['menuHeader', 'search', 'categories', 'productGrid'];
  }
  if (!s.pos_layout.widget_sizes) {
    s.pos_layout.widget_sizes = {};
  }
  if (!s.pos_layout.left_widget_sizes) {
    s.pos_layout.left_widget_sizes = {};
  }
  if (!s.qr_settings) {
    s.qr_settings = { base_url: '' };
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
      background_color: '#0f0f0f',
      surface_color: '#1a1a1a',
      text_color: '#ffffff',
      primary_color: '#facc15',
      accent_color: '#facc15',
      hero_image_url: '',
      poster_image_url: '',
      poster_background_color: '#facc15',
      logo_shape: 'rounded',
      font_family: '',
      custom_font_url: '',
    };
  }
  if (!s.feedback_settings) {
    s.feedback_settings = normalizeFeedbackSettings(DEFAULT_FEEDBACK_SETTINGS);
  } else {
    s.feedback_settings = normalizeFeedbackSettings(s.feedback_settings);
  }
  if (!s.z_report_receipt_settings) {
    s.z_report_receipt_settings = DEFAULT_Z_REPORT_RECEIPT_SETTINGS;
  }
  // P0.1 — həmişə normalize et: köhnə tenant blob-larında olmayan açarlar
  // (tiers, birthday_enabled, onesignal_app_id) oxunuşda doldurulur.
  s.customer_app_settings = normalizeCustomerAppSettings(s.customer_app_settings);
  if (!s.pos_layout) {
    s.pos_layout = JSON.parse(JSON.stringify(DEFAULT_POS_LAYOUT));
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
  }
  if (!s.delivery_integrations) {
    s.delivery_integrations = {
      bolt_food_enabled: false,
      bolt_food_provider_id: '',
      bolt_food_secret_key: '',
      wolt_enabled: false,
      wolt_venue_id: '',
      wolt_client_secret: '',
    };
  } else {
    s.delivery_integrations = {
      bolt_food_enabled: Boolean(s.delivery_integrations.bolt_food_enabled),
      bolt_food_provider_id: String(s.delivery_integrations.bolt_food_provider_id || ''),
      bolt_food_secret_key: String(s.delivery_integrations.bolt_food_secret_key || ''),
      wolt_enabled: Boolean(s.delivery_integrations.wolt_enabled),
      wolt_venue_id: String(s.delivery_integrations.wolt_venue_id || ''),
      wolt_client_secret: String(s.delivery_integrations.wolt_client_secret || ''),
    };
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
  }
  if (!s.inventory_settings) {
    s.inventory_settings = {
      default_critical_threshold: 5,
      unit_options: ['kq', 'qram', 'litr', 'ml', 'ədəd', 'paket', 'qutu', 'metr'],
    };
  }
  if (!s.staff_benefits) {
    s.staff_benefits = {
      daily_limit_azn: 6,
      allowed_scope: 'all',
      included_categories: [],
      included_items: [],
      item_unit_cap_azn: 6,
      coffee_unit_cap_azn: 6,
      other_unit_cap_azn: 2,
    };
  } else {
    if (!(s.staff_benefits as any).allowed_scope) {
      s.staff_benefits = {
        daily_limit_azn: Number((s.staff_benefits as any).daily_limit_azn ?? 6),
        allowed_scope: 'all',
        included_categories: [],
        included_items: [],
        item_unit_cap_azn: Number((s.staff_benefits as any).non_coffee_unit_cap_azn ?? 6),
        coffee_unit_cap_azn: 6,
        other_unit_cap_azn: 2,
      };
    }
    if (typeof s.staff_benefits.coffee_unit_cap_azn === 'undefined') {
      s.staff_benefits.coffee_unit_cap_azn = s.staff_benefits.item_unit_cap_azn ?? 6;
    }
    if (typeof s.staff_benefits.other_unit_cap_azn === 'undefined') {
      s.staff_benefits.other_unit_cap_azn = 2;
    }
  }
  if (!s.landing_settings) {
    s.landing_settings = normalizeLandingSettings(DEFAULT_LANDING_SETTINGS);
  } else {
    s.landing_settings = normalizeLandingSettings(s.landing_settings);
  }
  if (!s.table_service_settings) {
    s.table_service_settings = { deposit_per_guest_azn: 0, reservation_lock_hours: 2 };
  }
  if (typeof s.table_service_settings.reservation_lock_hours !== 'number') {
    s.table_service_settings = {
      ...s.table_service_settings,
      reservation_lock_hours: 2,
    };
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
  }
  if (!s.session_settings) {
    s.session_settings = {
      idle_logout_minutes: 0,
      virtual_keyboard_enabled: true,
      staff_pin_length: 4,
      theme_mode: 'dark',
      ui_mode: 'old',
    };
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
      device_authorization_enabled: s.session_settings.device_authorization_enabled === true,
    };
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
  return s;
}

export function update_inventory_settings(payload: { default_critical_threshold: number; unit_options: string[] }) {
  const settings = getSettings();
  const cleanUnits = Array.from(new Set((payload.unit_options || []).map((u) => String(u || '').trim()).filter(Boolean)));
  settings.inventory_settings = {
    default_critical_threshold: Number.isFinite(payload.default_critical_threshold)
      ? Math.max(0, Number(payload.default_critical_threshold))
      : 5,
    unit_options: cleanUnits.length ? cleanUnits : ['kq', 'qram', 'litr', 'ml', 'ədəd', 'paket', 'qutu', 'metr'],
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
  coffee_unit_cap_azn?: number;
  other_unit_cap_azn?: number;
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
    coffee_unit_cap_azn: typeof payload.coffee_unit_cap_azn === 'number' && Number.isFinite(payload.coffee_unit_cap_azn)
      ? Math.max(0, payload.coffee_unit_cap_azn)
      : 6,
    other_unit_cap_azn: typeof payload.other_unit_cap_azn === 'number' && Number.isFinite(payload.other_unit_cap_azn)
      ? Math.max(0, payload.other_unit_cap_azn)
      : 2,
  };
  saveSettings(settings);
  logEvent('admin', 'STAFF_BENEFITS_UPDATED', settings.staff_benefits);
  return { success: true, staff_benefits: settings.staff_benefits };
}

export function update_print_settings(payload: {
  use_qz: boolean;
  printer_name: string;
  kitchen_printer_name?: string;
  auto_print_kitchen_ticket?: boolean;
  auto_print_receipt?: boolean;
  paper_width?: '58mm' | '80mm';
  print_engine?: 'pixel_html' | 'raw_escpos';
  kitchen_mode?: 'paper_only' | 'screen_only' | 'hybrid';
}) {
  const settings = getSettings();
  settings.print_settings = payload;
  saveSettings(settings);
  logEvent('admin', 'PRINT_SETTINGS_UPDATED', payload);
  return { success: true };
}

export async function update_print_settings_live(payload: {
  use_qz: boolean;
  printer_name: string;
  kitchen_printer_name?: string;
  auto_print_kitchen_ticket?: boolean;
  auto_print_receipt?: boolean;
  paper_width?: '58mm' | '80mm';
  print_engine?: 'pixel_html' | 'raw_escpos';
  kitchen_mode?: 'paper_only' | 'screen_only' | 'hybrid';
}) {
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
    background_color: String(payload.background_color || '').trim() || '#0f0f0f',
    surface_color: String(payload.surface_color || '').trim() || '#1a1a1a',
    text_color: String(payload.text_color || '').trim() || '#ffffff',
    primary_color: String(payload.primary_color || '').trim() || '#facc15',
    accent_color: String(payload.accent_color || '').trim() || '#facc15',
    hero_image_url: String(payload.hero_image_url || '').trim(),
    poster_image_url: String((payload as any).poster_image_url || '').trim(),
    poster_background_color: String(payload.poster_background_color || '').trim() || '#facc15',
    logo_shape: payload.logo_shape === 'circle' || payload.logo_shape === 'square' ? payload.logo_shape : 'rounded',
    font_family: String(payload.font_family || '').trim(),
    custom_font_url: String(payload.custom_font_url || '').trim(),
    splash_type: ['image', 'video', 'gif', 'none'].includes(String((payload as any).splash_type || '')) ? String((payload as any).splash_type) : 'none',
    splash_url: String((payload as any).splash_url || '').trim(),
    splash_duration_ms: Math.max(1000, Math.min(10000, Number((payload as any).splash_duration_ms || 3000))),
    splash_overlay_text: String((payload as any).splash_overlay_text || '').trim(),
    splash_bg_color: String((payload as any).splash_bg_color || '').trim() || '#000000',
  };
  saveSettings(settings);
  logEvent('admin', 'QR_MENU_SETTINGS_UPDATED', settings.qr_menu_settings || {});
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

export type CustomerAppSettingsPatch = Partial<NonNullable<Settings['customer_app_settings']>>;

/**
 * P0.1 — lokal rejimdə də MERGE. Əvvəl bu funksiya obyekti sıfırdan qururdu,
 * ona görə panelin göndərmədiyi açar (tiers, birthday_enabled, birthday_bonus_stars,
 * onesignal_app_id) hər save-də silinirdi. Artıq allow-list + merge + normalize.
 */
export function update_customer_app_settings(payload: CustomerAppSettingsPatch) {
  const settings = getSettings();
  const current = (settings.customer_app_settings || {}) as Record<string, any>;
  const incoming: Record<string, any> = {};
  const rejected: string[] = [];
  for (const [key, value] of Object.entries(payload || {})) {
    if ((CUSTOMER_APP_SETTING_KEYS as string[]).includes(key)) incoming[key] = value;
    else rejected.push(key);
  }
  const merged = normalizeCustomerAppSettings({ ...current, ...incoming });
  const changed = (CUSTOMER_APP_SETTING_KEYS as string[]).filter(
    (key) => JSON.stringify(current[key]) !== JSON.stringify((merged as Record<string, any>)[key]),
  );
  settings.customer_app_settings = merged;
  saveSettings(settings);
  logEvent('admin', 'CUSTOMER_APP_SETTINGS_UPDATED', { changed, rejected });
  return { success: true, changed, rejected, customer_app_settings: merged };
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
  logEvent('admin', 'POS_LAYOUT_PUBLISHED', (settings.pos_layout || {}) as Record<string, any>);
  return { success: true, pos_layout: settings.pos_layout };
}

export function reset_pos_layout_draft() {
  const settings = getSettings();
  settings.pos_layout_draft = JSON.parse(JSON.stringify(settings.pos_layout || DEFAULT_POS_LAYOUT));
  saveSettings(settings);
  logEvent('admin', 'POS_LAYOUT_DRAFT_RESET', (settings.pos_layout_draft || {}) as Record<string, any>);
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
  let data: Settings;
  try {
    data = await apiRequest<Settings>('/api/v1/ops/settings', { tenantId: null });
  } catch (err) {
    console.warn('Settings live fetch failed, using cached fallback:', err);
    return get_settings(tenant_id);
  }
  const requestedTenant = String(resolveTenant(tenant_id));
  const responseTenant = String(data?.tenant_id || '');
  const resolvedTenant = String(responseTenant || requestedTenant);
  const overrides = readFeedbackOverrides();
  const scopedOverride =
    overrides[requestedTenant] ||
    overrides[resolvedTenant] ||
    (responseTenant ? overrides[responseTenant] : undefined);
  const localCached = get_settings(tenant_id);
  const print_settings = {
    use_qz: data?.print_settings?.use_qz ?? localCached?.print_settings?.use_qz ?? false,
    printer_name: String(data?.print_settings?.printer_name ?? localCached?.print_settings?.printer_name ?? ''),
    kitchen_printer_name: String(data?.print_settings?.kitchen_printer_name ?? localCached?.print_settings?.kitchen_printer_name ?? ''),
    auto_print_kitchen_ticket: data?.print_settings?.auto_print_kitchen_ticket ?? localCached?.print_settings?.auto_print_kitchen_ticket ?? true,
    auto_print_receipt: data?.print_settings?.auto_print_receipt ?? localCached?.print_settings?.auto_print_receipt ?? true,
    paper_width: (data?.print_settings?.paper_width || localCached?.print_settings?.paper_width || '80mm') as '58mm' | '80mm',
    // A5: default must match the Admin UI (SettingsPanel), the POS/Tables send-time
    // fallback, and KDS — all of which use 'raw_escpos'. Keeping this normalized read on
    // a different default silently flipped the engine between send-time and KDS reprints.
    // Cyrillic safety on the raw path is handled by containsCyrillic() in local_print_agent.
    print_engine: (data?.print_settings?.print_engine || localCached?.print_settings?.print_engine || 'raw_escpos') as 'pixel_html' | 'raw_escpos',
    kitchen_mode: (data?.print_settings?.kitchen_mode || localCached?.print_settings?.kitchen_mode || 'paper_only') as 'paper_only' | 'screen_only' | 'hybrid',
  };

  const merged: Settings = {
    ...data,
    print_settings,
    session_settings: {
      idle_logout_minutes: Number(data?.session_settings?.idle_logout_minutes || 0),
      virtual_keyboard_enabled: data?.session_settings?.virtual_keyboard_enabled !== false,
      staff_pin_length: Number(data?.session_settings?.staff_pin_length || 4) === 4 ? 4 : 6,
      theme_mode: data?.session_settings?.theme_mode === 'light' ? 'light' : 'dark',
      ui_mode: 'old',
      device_authorization_enabled: data?.session_settings?.device_authorization_enabled === true,
    },
    feedback_settings: normalizeFeedbackSettings(scopedOverride || data?.feedback_settings),
    ai_config: {
      provider: normalizeAiProvider(data?.ai_config?.provider),
      model: String(data?.ai_config?.model || 'auto'),
      autodetected: data?.ai_config?.autodetected !== false,
      ollama_freeapi_enabled: data?.ai_config?.ollama_freeapi_enabled === true,
      updated_at: String(data?.ai_config?.updated_at || ''),
    },
    delivery_integrations: data?.delivery_integrations ? {
      bolt_food_enabled: Boolean(data.delivery_integrations.bolt_food_enabled),
      bolt_food_provider_id: String(data.delivery_integrations.bolt_food_provider_id || ''),
      bolt_food_secret_key: String(data.delivery_integrations.bolt_food_secret_key || ''),
      wolt_enabled: Boolean(data.delivery_integrations.wolt_enabled),
      wolt_venue_id: String(data.delivery_integrations.wolt_venue_id || ''),
      wolt_client_secret: String(data.delivery_integrations.wolt_client_secret || ''),
    } : undefined,
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

export async function get_public_qr_menu_bootstrap_live(tenantSlug?: string) {
  const headers: Record<string, string> = {};
  if (tenantSlug) {
    headers['x-tenant-slug'] = tenantSlug;
  }
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
      font_family: string;
      custom_font_url: string;
      theme_preset?: string;
      splash_type?: string;
      splash_url?: string;
      splash_duration_ms?: number;
      splash_overlay_text?: string;
      splash_bg_color?: string;
      phone?: string;
      address?: string;
      instagram?: string;
      wifi_ssid?: string;
      wifi_password?: string;
      working_hours?: string;
    };
    show_prices: boolean;
    show_images: boolean;
    show_descriptions: boolean;
  }>('/api/v1/ops/public-menu-bootstrap', {
    method: 'GET',
    tenantId: null,
    auth: false,
    headers,
  });
}

export async function send_public_table_service(
  payload: {
    action: 'call_waiter' | 'request_bill';
    table_label: string;
    payment_method?: 'cash' | 'card';
    note?: string;
  },
  tenantSlug?: string
) {
  const headers: Record<string, string> = {};
  if (tenantSlug) {
    headers['x-tenant-slug'] = tenantSlug;
  }
  return apiRequest<{ success: boolean; message: string }>('/api/v1/ops/public-table-service', {
    method: 'POST',
    tenantId: null,
    auth: false,
    headers,
    body: payload,
  });
}

/**
 * P0.1 — qismən payload qəbul edir. Backend merge edib tam normalize olunmuş
 * obyekti qaytarır; lokal güzgü həmin cavabla doldurulur (payload ilə deyil),
 * yoxsa lokal kopya serverdəki dəyərlərdən geri qalır.
 */
export async function update_customer_app_settings_live(payload: CustomerAppSettingsPatch) {
  if (!isBackendEnabled()) return update_customer_app_settings(payload);
  const res = await apiRequest<{
    success?: boolean;
    changed?: string[];
    rejected?: string[];
    customer_app_settings?: CustomerAppSettingsPatch;
  }>('/api/v1/ops/settings/customer-app', { method: 'PATCH', tenantId: null, body: payload });
  const authoritative = res && typeof res.customer_app_settings === 'object' ? res.customer_app_settings : payload;
  update_customer_app_settings(authoritative || payload);
  return { success: true, changed: res?.changed || [], rejected: res?.rejected || [] };
}

export interface TenantBranchPayload {
  name: string;
  address?: string;
  phone?: string;
  latitude?: number | null;
  longitude?: number | null;
  is_active?: boolean;
  is_default?: boolean;
  open_hour?: number;
  close_hour?: number;
  sort_order?: number;
}

export async function list_branches_live(tenantId: string) {
  if (!isBackendEnabled()) return { branches: [] as any[] };
  return apiRequest<any>(`/api/v1/branches/${encodeURIComponent(tenantId)}`, { tenantId: null });
}

export async function create_branch_live(tenantId: string, payload: TenantBranchPayload) {
  if (!isBackendEnabled()) throw new Error('Backend aktiv deyil — filial yalnız online rejimdə əlavə oluna bilər');
  return apiRequest<any>(`/api/v1/branches/${encodeURIComponent(tenantId)}`, {
    method: 'POST',
    tenantId: null,
    body: payload,
  });
}

export async function update_branch_live(tenantId: string, branchId: string, payload: TenantBranchPayload) {
  if (!isBackendEnabled()) throw new Error('Backend aktiv deyil');
  return apiRequest<any>(`/api/v1/branches/${encodeURIComponent(tenantId)}/${encodeURIComponent(branchId)}`, {
    method: 'PUT',
    tenantId: null,
    body: payload,
  });
}

export async function delete_branch_live(tenantId: string, branchId: string) {
  if (!isBackendEnabled()) throw new Error('Backend aktiv deyil');
  return apiRequest<any>(`/api/v1/branches/${encodeURIComponent(tenantId)}/${encodeURIComponent(branchId)}`, {
    method: 'DELETE',
    tenantId: null,
  });
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

export async function update_delivery_integrations_live(payload: {
  bolt_food_enabled?: boolean;
  bolt_food_provider_id?: string;
  bolt_food_secret_key?: string;
  wolt_enabled?: boolean;
  wolt_venue_id?: string;
  wolt_client_secret?: string;
}) {
  if (!isBackendEnabled()) return update_delivery_integrations(payload);
  await apiRequest('/api/v1/ops/settings/delivery-integrations', { method: 'PATCH', tenantId: null, body: payload });
  update_delivery_integrations(payload);
  return { success: true };
}

export async function update_session_settings_live(payload: {
  idle_logout_minutes: number;
  virtual_keyboard_enabled?: boolean;
  staff_pin_length?: number;
  theme_mode?: 'dark' | 'light';
  ui_mode?: 'old' | 'new';
  login_background_url?: string;
  device_authorization_enabled?: boolean;
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
  coffee_unit_cap_azn?: number;
  other_unit_cap_azn?: number;
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
    receipt_footer: 'Bizi secdiyiniz ucun tesekkur edirik!',
    // Vergi / fiskal (forward-compatible). Default: sadələşdirilmiş, fiskal inteqrasiya söndürülüb.
    tax_regime: 'simplified' as 'simplified' | 'vat',
    vat_rate: 18,
    nka_registration_no: '',
    fiscal_enabled: false,
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
  tax_regime?: 'simplified' | 'vat';
  vat_rate?: number;
  nka_registration_no?: string;
  fiscal_enabled?: boolean;
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
  if (!isBackendEnabled()) {
    const profile = get_business_profile(tenant_id);
    const settings = getSettings();
    return {
      ...profile,
      login_background_url: settings.session_settings?.login_background_url || '',
    };
  }
  const requestedTenant = String(tenant_id || '').trim();
  const query = requestedTenant ? `?tenant_id=${encodeURIComponent(requestedTenant)}` : '';
  const data = await apiRequest<any>(`/api/v1/ops/public-branding${query}`, {
    tenantId: null,
    auth: false,
    timeoutMs: 25000,   // Railway cold start takes 15-20s; 25s gives safe headroom
    retryCount: 0,       // PinLogin's fetchBranding already handles retries — avoid compounding
    retryDelayMs: 1500,
  });

  const profiles = getDB<any>('business_profile');
  const resolvedTenant = String(data?.tenant_id || requestedTenant);
  const idx = profiles.findIndex((p) => p.tenant_id === resolvedTenant);
  if (idx >= 0) profiles[idx] = { ...profiles[idx], ...data };
  else profiles.push({ ...data, tenant_id: resolvedTenant });
  setDB('business_profile', profiles);

  if (resolvedTenant && (data?.device_authorization_enabled !== undefined || data?.staff_pin_length !== undefined)) {
    const s = get_settings(resolvedTenant);
    if (!s.session_settings) s.session_settings = {} as any;
    if (data?.device_authorization_enabled !== undefined) {
      s.session_settings.device_authorization_enabled = Boolean(data.device_authorization_enabled);
    }
    if (data?.staff_pin_length !== undefined) {
      s.session_settings.staff_pin_length = Number(data.staff_pin_length) === 4 ? 4 : 6;
    }
    saveSettings(s);
  }

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
  tax_regime?: 'simplified' | 'vat';
  vat_rate?: number;
  nka_registration_no?: string;
  fiscal_enabled?: boolean;
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
  ai_config?: { provider?: AiProvider; model?: string; autodetected?: boolean; ollama_freeapi_enabled?: boolean },
) {
  if (!isBackendEnabled()) {
    const settings = getSettings();
    settings.gemini_api_key = api_key;
    settings.ai_config = {
      provider: normalizeAiProvider(ai_config?.provider || settings.ai_config?.provider || 'unknown'),
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
    provider: normalizeAiProvider(ai_config?.provider || settings.ai_config?.provider || 'unknown'),
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

export async function get_backup_settings_live(): Promise<any> {
  if (!isBackendEnabled()) {
    return {
      backup_enabled: false,
      backup_webhook_url: '',
      backup_webhook_secret: '',
      backup_hour: 3,
      backup_target: 'webhook',
      backup_local_path: '',
      last_backup_status: null,
      last_backup_at: null,
    };
  }
  return apiRequest<any>('/api/v1/ops/database/backup-settings', {
    method: 'GET',
    tenantId: null,
  });
}

export async function update_backup_settings_live(payload: any): Promise<any> {
  if (!isBackendEnabled()) {
    return { ok: true, message: 'Backup settings updated (offline)' };
  }
  return apiRequest<any>('/api/v1/ops/database/backup-settings', {
    method: 'PUT',
    tenantId: null,
    body: payload,
  });
}

export async function test_backup_webhook_live(): Promise<any> {
  if (!isBackendEnabled()) {
    return { ok: true, message: 'Test webhook sent (offline)' };
  }
  return apiRequest<any>('/api/v1/ops/database/backup-test-webhook', {
    method: 'POST',
    tenantId: null,
  });
}

export async function get_central_backup_tenants_live(): Promise<any> {
  if (!isBackendEnabled()) {
    return [];
  }
  return apiRequest<any>('/api/v1/ops/database/central-backup-tenants', {
    method: 'GET',
    tenantId: null,
  });
}

export async function update_central_backup_tenants_live(tenantIds: string[]): Promise<any> {
  if (!isBackendEnabled()) {
    return { ok: true, message: 'Central backup tenants updated (offline)' };
  }
  return apiRequest<any>('/api/v1/ops/database/central-backup-tenants', {
    method: 'PUT',
    tenantId: null,
    body: { tenant_ids: tenantIds },
  });
}

export async function get_central_backup_logs_live(): Promise<any> {
  if (!isBackendEnabled()) {
    return [];
  }
  return apiRequest<any>('/api/v1/ops/database/central-backup-logs', {
    method: 'GET',
    tenantId: null,
  });
}

export async function run_central_backup_now_live(): Promise<any> {
  if (!isBackendEnabled()) {
    return { ok: false, message: 'Offline rejimdə mərkəzi backup başlatmaq olmaz' };
  }
  return apiRequest<any>('/api/v1/ops/database/run-central-backup-now', {
    method: 'POST',
    tenantId: null,
  });
}

// ---------------------------------------------------------------------------
// Kampaniyalar (happy hours) — lokal rejim + backend cütlüyü
//
// P0.7 — əvvəl bu dörd funksiyanın lokal qolu YALAN qaytarırdı:
// `create_campaign_live` saxta `id` ('campaign_' + Date.now()), update/delete
// isə heç nə etmədən `{ success: true }`. Nəticə: panel "Kampaniya yadda
// saxlanıldı" yazırdı, dərhal sonra `loadCampaigns()` boş siyahı gətirirdi və
// müştəri tətbiqində heç nə görünmürdü — səssiz uğursuzluq.
//
// Artıq lokal rejimdə `db_sim`-in `happy_hours` cədvəlinə real yazılır.
// Bu cədvəli `crm.ts` müştəri sessiyasında (`campaigns` bloku) və POS-un
// `happy_hours.ts` modulu da oxuyur, yəni lokal yazı həqiqətən tətbiqdə
// görünür — CLAUDE.md-dəki dual-mode paritetinə uyğun.
// ---------------------------------------------------------------------------

type LocalCampaignRow = {
  id: string;
  tenant_id: string;
  name: string;
  start_time: string;
  end_time: string;
  discount_percent: number;
  // `days_of_week` panelin/backend API-nin formatıdır, `days_of_week_json` isə
  // backend DB sütununun adıdır — `crm.ts` müştəri tərəfində məhz onu oxuyur
  // (`crm.ts:799`). Lokal sətir hər iki oxuyucu ilə uyğun olsun deyə ikisi də
  // yazılır; dəyər eynidir, çevirmə yoxdur.
  days_of_week: number[];
  days_of_week_json: number[];
  categories: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
};

// Gün nömrələnməsi bütün sistemdə B.E=1 … Bazar=7-dir: backend
// `now.weekday() + 1` (`operations.py:6900`), panel çipləri `id: 1..7`
// (`CustomerAppPanel.tsx:894`), `crm.ts` `getDay() === 0 ? 7 : getDay()`.
// Köhnə lokal sətirlərdə 0 (Bazar) ola bilər — 7-yə çevrilir.
const normalizeCampaignPayload = (payload: any) => {
  const rawDays = Array.isArray(payload?.days_of_week)
    ? payload.days_of_week
    : Array.isArray(payload?.days_of_week_json)
      ? payload.days_of_week_json
      : [];
  const days = Array.from(new Set(
    rawDays
      .map((d: any) => (Number(d) === 0 ? 7 : Number(d)))
      .filter((d: number) => Number.isInteger(d) && d >= 1 && d <= 7),
  )).sort((a, b) => (a as number) - (b as number)) as number[];
  const discount = Number(payload?.discount_percent);
  return {
    name: String(payload?.name || '').trim(),
    start_time: String(payload?.start_time || '00:00'),
    end_time: String(payload?.end_time || '23:59'),
    discount_percent: Number.isFinite(discount) ? discount : 0,
    days_of_week: days,
    days_of_week_json: days,
    categories: String(payload?.categories || 'ALL').trim() || 'ALL',
    is_active: payload?.is_active === undefined ? true : Boolean(payload.is_active),
  };
};

export async function list_campaigns_admin_live(tenantId: string): Promise<any[]> {
  if (!isBackendEnabled()) {
    // Müştəri tətbiqi ilə eyni filtr (`crm.ts` də `filterTenantRecords` işlədir).
    return filterTenantRecords(getDB<LocalCampaignRow>('happy_hours'), resolveTenant(tenantId));
  }
  return apiRequest<any[]>('/api/v1/ops/happy-hours', {
    method: 'GET',
    tenantId,
  });
}

export async function create_campaign_live(payload: any, tenantId: string): Promise<any> {
  if (!isBackendEnabled()) {
    const rows = getDB<LocalCampaignRow>('happy_hours');
    const row: LocalCampaignRow = {
      id: uuidv4(),
      tenant_id: resolveTenant(tenantId),
      ...normalizeCampaignPayload(payload),
      created_at: new Date().toISOString(),
    };
    rows.push(row);
    setDB('happy_hours', rows);
    logEvent('system', 'HAPPY_HOUR_CREATE', { name: row.name, discount: row.discount_percent, categories: row.categories });
    return row;
  }
  return apiRequest<any>('/api/v1/ops/happy-hours', {
    method: 'POST',
    tenantId,
    body: payload,
  });
}

export async function update_campaign_live(id: string, payload: any, tenantId: string): Promise<any> {
  if (!isBackendEnabled()) {
    const tid = resolveTenant(tenantId);
    const rows = getDB<LocalCampaignRow>('happy_hours');
    // Tenant yoxlanışı: super_admin tenant dəyişdirdikdə başqa tenant-ın
    // sətrini təsadüfən yenidən yazmamaq üçün id + tenant birlikdə axtarılır.
    const row = rows.find((r) => r?.id === id && (!r?.tenant_id || r.tenant_id === tid));
    if (!row) {
      throw new Error('Kampaniya tapılmadı');
    }
    Object.assign(row, normalizeCampaignPayload({ ...row, ...payload }), {
      updated_at: new Date().toISOString(),
    });
    setDB('happy_hours', rows);
    logEvent('system', 'HAPPY_HOUR_UPDATE', { id, name: row.name, discount: row.discount_percent });
    return row;
  }
  return apiRequest<any>(`/api/v1/ops/happy-hours/${id}`, {
    method: 'PATCH',
    tenantId,
    body: payload,
  });
}

export async function delete_campaign_live(id: string, tenantId: string): Promise<any> {
  if (!isBackendEnabled()) {
    const tid = resolveTenant(tenantId);
    const rows = getDB<LocalCampaignRow>('happy_hours');
    const row = rows.find((r) => r?.id === id && (!r?.tenant_id || r.tenant_id === tid));
    if (!row) {
      throw new Error('Kampaniya tapılmadı');
    }
    setDB('happy_hours', rows.filter((r) => r?.id !== id));
    logEvent('system', 'HAPPY_HOUR_DELETE', { id, name: row.name });
    return { success: true };
  }
  return apiRequest<any>(`/api/v1/ops/happy-hours/${id}`, {
    method: 'DELETE',
    tenantId,
  });
}

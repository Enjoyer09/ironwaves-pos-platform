import React, { useEffect, useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import QRCode from 'qrcode';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';
import {
  create_user_live,
  disable_totp_live,
  delete_user_live,
  get_business_profile_live,
  get_settings_live,
  get_users_live,
  reset_system_live,
  setup_totp_live,
  update_bank_commission_live,
  update_email_settings_live,
  update_delivery_integrations_live,
  update_beverage_service_settings_live,
  update_finance_policy_live,
  update_feedback_settings_live,
  update_service_fee_live,
  update_session_settings_live,
  update_table_service_settings_live,
  update_yield_management_settings_live,
  update_business_profile_live,
  update_print_settings_live,
  update_qr_menu_settings_live,
  update_z_report_receipt_settings_live,
  update_qr_settings_live,
  update_role_modules_live,
  update_staff_benefits_live,
  update_user_credentials_live,
  update_api_key_live,
  verify_totp_live,
} from '../../api/settings';
import { get_menu_items_live } from '../../api/menu';
import { get_inventory_items_live } from '../../api/inventory';
import {
  getDeliveryMenuMappings,
  createDeliveryMenuMapping,
  deleteDeliveryMenuMapping,
  DeliveryMenuMapping,
} from '../../api/integrations';
import { prepareImageDataUrl, prepareSmallImageDataUrl } from '../../lib/image_upload';
import { localPrintAgentInfo, localPrintAgentPrinters, LocalPrintAgentPrinter, printDirectOrFallback } from '../../lib/local_print_agent';
import { qzCheckStatus } from '../../lib/qz';
import { readScopedStorage, writeScopedStorage } from '../../lib/storage_keys';
import { BusinessProfileSection } from './settings/BusinessProfileSection';
import { EmailSettingsSection } from './settings/EmailSettingsSection';
import { OperationSettingsSection } from './settings/OperationSettingsSection';
import { FinanceSettingsSection } from './settings/FinanceSettingsSection';
import { IntegrationsSettingsSection } from './settings/IntegrationsSettingsSection';
import { AISettingsSection } from './settings/AISettingsSection';
import { InterfaceSettingsSection } from './settings/InterfaceSettingsSection';
import { SecuritySettingsSection } from './settings/SecuritySettingsSection';

type RoleModules = { staff: string[]; manager: string[]; kitchen: string[] };

const defaultRoleModules: RoleModules = {
  staff: ['pos', 'tables', 'kds', 'zreport'],
  manager: ['pos', 'tables', 'kds', 'zreport', 'finance', 'inventory', 'combos', 'analytics', 'logs', 'crm', 'customerapp', 'ai', 'menu', 'recipes'],
  kitchen: ['kds'],
};

export default function SettingsPanel() {
  const { user, lang, notify } = useAppStore();
  const tenantId = user?.tenant_id || 'tenant_default';
  const currentRole = String(user?.role || '').toLowerCase();

  const [successMsg, setSuccessMsg] = useState('');
  const [panelSuccess, setPanelSuccess] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [roleModules, setRoleModules] = useState<RoleModules>(defaultRoleModules);
  const [emailSettings, setEmailSettings] = useState({
    enabled: false,
    provider: 'none',
    resend_api_key: '',
    sender_email: '',
    recipient_emails: '',
    webhook_url: '',
    timeout_sec: '15',
  });
  const [deliveryIntegrations, setDeliveryIntegrations] = useState({
    bolt_food_enabled: false,
    bolt_food_provider_id: '',
    bolt_food_secret_key: '',
    wolt_enabled: false,
    wolt_venue_id: '',
    wolt_client_secret: '',
  });
  const [sessionSettings, setSessionSettings] = useState({
    idle_logout_minutes: '0',
    virtual_keyboard_enabled: true,
    staff_pin_length: 4 as 4 | 6,
    theme_mode: 'dark' as 'dark' | 'light',
    ui_mode: 'old' as 'old',
    login_background_url: '',
  });
  const [beverageServiceSettings, setBeverageServiceSettings] = useState({
    coffee_selection_mode: 'size_and_service' as 'size_only' | 'size_and_service',
    remove_paper_packaging_for_table: true,
    discount_scope: 'all_items' as 'all_items' | 'coffee_only',
    summer_promo_enabled: false,
  });
  const [printSettings, setPrintSettings] = useState({
    use_qz: false,
    printer_name: '',
    kitchen_printer_name: '',
    auto_print_kitchen_ticket: true,
    auto_print_receipt: true,
    paper_width: '58mm' as '58mm' | '80mm',
    print_engine: 'raw_escpos' as 'pixel_html' | 'raw_escpos',
  });
  const [testingPrint, setTestingPrint] = useState<'cashier' | 'kitchen' | null>(null);
  const [printAgentModalOpen, setPrintAgentModalOpen] = useState(false);
  const [printAgentHealth, setPrintAgentHealth] = useState<'unknown' | 'checking' | 'online' | 'offline'>('unknown');
  const [printAgentVersion, setPrintAgentVersion] = useState('');
  const [printAgentMinVersion, setPrintAgentMinVersion] = useState('0.2.0');
  const [qzHealth, setQzHealth] = useState<'unknown' | 'checking' | 'online' | 'offline'>('unknown');
  const [qzPrintersCount, setQzPrintersCount] = useState(0);
  const [qzErrorMessage, setQzErrorMessage] = useState('');
  const [systemPrinters, setSystemPrinters] = useState<LocalPrintAgentPrinter[]>([]);
  const [customPrinterMode, setCustomPrinterMode] = useState(false);
  const [zReportReceiptSettings, setZReportReceiptSettings] = useState({
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
  });
  const [qrMenuSettings, setQrMenuSettings] = useState({
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
    logo_shape: 'rounded' as 'rounded' | 'circle' | 'square',
    font_family: '',
    custom_font_url: '',
    theme_preset: 'dark' as 'dark' | 'light' | 'emerald' | 'custom',
    layout_preset: 'classic' as 'classic' | 'bolt',
    splash_type: 'none',
    splash_url: '',
    splash_duration_ms: 3000,
    splash_overlay_text: '',
    splash_bg_color: '#000000',
  });
  const [feedbackSettings, setFeedbackSettings] = useState({
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
    ] as string[],
    min_stars_for_google_review: 4,
    required_comment_threshold: 3,
    custom_heading_az: 'Rəy və məmnuniyyət sorğusu',
    custom_heading_ru: 'Опрос о качестве обслуживания',
    custom_heading_en: 'Customer Satisfaction Survey',
    custom_subheading_az: 'Xidmət keyfiyyətini yaxşılaşdırmaq üçün 30 saniyə ayırın.',
    custom_subheading_ru: 'Пожалуйста, уделите 30 секунд для улучшения качества услуг.',
    custom_subheading_en: 'Please take 30 seconds to help us improve our service.',
  });
  const autoFeedbackPortalUrl = React.useMemo(() => {
    const base = String(profile?.qr_base_url || profile?.website || '').trim() || window.location.origin;
    return `${base.replace(/\/+$/, '')}/feedback`;
  }, [profile?.qr_base_url, profile?.website]);
  const [bankCommission, setBankCommission] = useState({
    card_sale_percent: '2',
    card_transfer_percent: '0.5',
  });
  const [financePolicy, setFinancePolicy] = useState({
    large_transfer_threshold_azn: '500',
    investor_repayment_requires_approval: true,
    cash_adjustment_requires_approval: true,
    reversal_requires_approval: true,
    reconciliation_adjustment_requires_approval: true,
    reconciliation_variance_alert_azn: '0.01',
    negative_balance_alert_azn: '0',
    approver_roles: 'manager, admin, finance_admin, super_admin',
  });
  const [aiApiKey, setAiApiKey] = useState(() => readScopedStorage('gemini_api_key') || '');
  const [tableServiceSettings, setTableServiceSettings] = useState({
    service_fee_percent: '0',
    deposit_per_guest_azn: '0',
    reservation_lock_hours: '2',
  });
  const [yieldManagement, setYieldManagement] = useState({
    enabled: false,
    variance_tolerance_percent: '5',
    beef_ratio: '1.4',
    beef_loss_min_percent: '30',
    beef_loss_max_percent: '40',
    chicken_ratio: '1.33',
    chicken_loss_min_percent: '25',
    chicken_loss_max_percent: '35',
    tracked_items: [] as Array<{ inventory_name: string; meat_type: 'beef' | 'chicken'; raw_to_ready_ratio: string; enabled: boolean }>,
  });
  const [staffBenefits, setStaffBenefits] = useState({
    daily_limit_azn: '6',
    allowed_scope: 'all' as 'all' | 'categories' | 'items',
    included_categories: [] as string[],
    included_items: [] as string[],
    item_unit_cap_azn: '6',
    coffee_unit_cap_azn: '6',
    other_unit_cap_azn: '2',
  });
  const [menuCatalog, setMenuCatalog] = useState<any[]>([]);
  const [deliveryMenuMappings, setDeliveryMenuMappings] = useState<DeliveryMenuMapping[]>([]);
  const [deliveryMenuMappingsLoading, setDeliveryMenuMappingsLoading] = useState(false);
  const [newDeliveryMenuMapping, setNewDeliveryMenuMapping] = useState({
    provider: 'bolt' as 'bolt' | 'wolt',
    external_item_id: '',
    external_item_name: '',
    menu_item_id: '',
  });
  const [inventoryCatalog, setInventoryCatalog] = useState<any[]>([]);

  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'staff' | 'kitchen' | 'manager' | 'admin'>('staff');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserPin, setNewUserPin] = useState('');

  const [targetUser, setTargetUser] = useState('');
  const [targetPin, setTargetPin] = useState('');
  const [targetPasswordUser, setTargetPasswordUser] = useState('');
  const [targetPassword, setTargetPassword] = useState('');
  const [deleteUserName, setDeleteUserName] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newOwnPassword, setNewOwnPassword] = useState('');
  const [confirmOwnPassword, setConfirmOwnPassword] = useState('');
  const [totpSetupUrl, setTotpSetupUrl] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [totpQrDataUrl, setTotpQrDataUrl] = useState('');
  const [newFeedbackTag, setNewFeedbackTag] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpDisablePassword, setTotpDisablePassword] = useState('');
  const [totpDisableCode, setTotpDisableCode] = useState('');
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetTotpCode, setResetTotpCode] = useState('');


  const requiresPasswordForNewUser = ['admin', 'manager'].includes(newUserRole);
  const configuredStaffPinLength = sessionSettings.staff_pin_length === 4 ? 4 : 6;
  const passwordPolicyText = tx(
    lang,
    'Şifrə ən azı 10 simvol, böyük/kiçik hərf, rəqəm və simvol ehtiva etməlidir.',
    'Пароль должен быть минимум 10 символов и содержать заглавную/строчную букву, цифру и символ.',
    'Password must be at least 10 characters and include upper/lowercase, number and symbol.',
  );
  const isStrongPassword = (value: string) => value.length >= 10 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
  const currentPasswordUser = users.find((u) => u.username === user?.username);
  const totpEnabled = Boolean(currentPasswordUser?.two_factor_enabled);

  const flashSuccess = (message: string, panelKey?: string) => {
    setSuccessMsg(message);
    if (panelKey) {
      setPanelSuccess((prev) => ({ ...prev, [panelKey]: message }));
      window.setTimeout(() => {
        setPanelSuccess((prev) => {
          const next = { ...prev };
          delete next[panelKey];
          return next;
        });
      }, 2500);
    }
    window.setTimeout(() => setSuccessMsg(''), 2500);
  };
  const renderPanelSuccess = (panelKey: string) =>
    panelSuccess[panelKey] ? (
      <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
        {panelSuccess[panelKey]}
      </div>
    ) : null;
  const saveButtonClass = 'glossy-gold rounded-xl px-6 py-2 font-bold transition-transform duration-100 active:translate-y-px active:scale-[0.98]';

  const loadData = async () => {
    const [profileRes, usersRes, settingsRes] = await Promise.allSettled([
      get_business_profile_live(tenantId),
      get_users_live(tenantId),
      get_settings_live(tenantId),
    ]);
    void get_menu_items_live(tenantId).then(setMenuCatalog).catch(() => setMenuCatalog([]));
    void get_inventory_items_live(tenantId).then(setInventoryCatalog).catch(() => setInventoryCatalog([]));
    setDeliveryMenuMappingsLoading(true);
    void getDeliveryMenuMappings()
      .then(setDeliveryMenuMappings)
      .catch(() => setDeliveryMenuMappings([]))
      .finally(() => setDeliveryMenuMappingsLoading(false));

    if (profileRes.status === 'fulfilled') {
      const nextProfile = {
        ...profileRes.value,
        qr_base_url: settingsRes.status === 'fulfilled' ? String(settingsRes.value.qr_settings?.base_url || '') : '',
      };
      setProfile(nextProfile);
    }
    if (usersRes.status === 'fulfilled') {
      setUsers(usersRes.value);
    } else {
      notify('error', usersRes.reason?.message || tx(lang, 'İstifadəçiləri yükləmək alınmadı', 'Не удалось загрузить пользователей', 'Failed to load users'));
    }
    if (settingsRes.status === 'fulfilled') {
      const profileWebsite =
        profileRes.status === 'fulfilled' ? String(profileRes.value?.website || '').trim() : '';
      const feedbackBase =
        String(settingsRes.value.qr_settings?.base_url || '').trim() ||
        profileWebsite ||
        window.location.origin;
      const derivedFeedbackPortalUrl = `${feedbackBase.replace(/\/+$/, '')}/feedback`;
      setRoleModules(settingsRes.value.role_modules || defaultRoleModules);
      setEmailSettings({
        enabled: Boolean(settingsRes.value.email_settings?.enabled),
        provider: String(settingsRes.value.email_settings?.provider || 'none'),
        resend_api_key: String(settingsRes.value.email_settings?.resend_api_key || ''),
        sender_email: String(settingsRes.value.email_settings?.sender_email || ''),
        recipient_emails: String((settingsRes.value.email_settings?.recipient_emails || []).join(', ')),
        webhook_url: String(settingsRes.value.email_settings?.webhook_url || ''),
        timeout_sec: String(settingsRes.value.email_settings?.timeout_sec || 15),
      });
      setDeliveryIntegrations({
        bolt_food_enabled: Boolean(settingsRes.value.delivery_integrations?.bolt_food_enabled),
        bolt_food_provider_id: String(settingsRes.value.delivery_integrations?.bolt_food_provider_id || ''),
        bolt_food_secret_key: settingsRes.value.delivery_integrations?.bolt_food_secret_key ? '***' : '',
        wolt_enabled: Boolean(settingsRes.value.delivery_integrations?.wolt_enabled),
        wolt_venue_id: String(settingsRes.value.delivery_integrations?.wolt_venue_id || ''),
        wolt_client_secret: settingsRes.value.delivery_integrations?.wolt_client_secret ? '***' : '',
      });
      setSessionSettings({
        idle_logout_minutes: String(settingsRes.value.session_settings?.idle_logout_minutes ?? 0),
        virtual_keyboard_enabled: settingsRes.value.session_settings?.virtual_keyboard_enabled !== false,
        staff_pin_length: Number(settingsRes.value.session_settings?.staff_pin_length || 4) === 4 ? 4 : 6,
        theme_mode: settingsRes.value.session_settings?.theme_mode === 'light' ? 'light' : 'dark',
        ui_mode: 'old',
        login_background_url: String(settingsRes.value.session_settings?.login_background_url || ''),
      });
      setBeverageServiceSettings({
        coffee_selection_mode: settingsRes.value.beverage_service_settings?.coffee_selection_mode === 'size_only' ? 'size_only' : 'size_and_service',
        remove_paper_packaging_for_table: settingsRes.value.beverage_service_settings?.remove_paper_packaging_for_table !== false,
        discount_scope: settingsRes.value.beverage_service_settings?.discount_scope === 'coffee_only' ? 'coffee_only' : 'all_items',
        summer_promo_enabled: Boolean(settingsRes.value.beverage_service_settings?.summer_promo_enabled),
      });
      setPrintSettings({
        use_qz: Boolean(settingsRes.value.print_settings?.use_qz),
        printer_name: String(settingsRes.value.print_settings?.printer_name || ''),
        kitchen_printer_name: String(settingsRes.value.print_settings?.kitchen_printer_name || ''),
        auto_print_kitchen_ticket: settingsRes.value.print_settings?.auto_print_kitchen_ticket !== false,
        auto_print_receipt: settingsRes.value.print_settings?.auto_print_receipt !== false,
        paper_width: (settingsRes.value.print_settings?.paper_width || '58mm') as '58mm' | '80mm',
        print_engine: (settingsRes.value.print_settings?.print_engine || 'raw_escpos') as 'pixel_html' | 'raw_escpos',
      });
      setZReportReceiptSettings({
        show_operator: settingsRes.value.z_report_receipt_settings?.show_operator !== false,
        show_date_range: settingsRes.value.z_report_receipt_settings?.show_date_range !== false,
        show_sales_summary: settingsRes.value.z_report_receipt_settings?.show_sales_summary !== false,
        show_profit_summary: settingsRes.value.z_report_receipt_settings?.show_profit_summary !== false,
        show_wage: settingsRes.value.z_report_receipt_settings?.show_wage !== false,
        show_shift_cash: settingsRes.value.z_report_receipt_settings?.show_shift_cash !== false,
        show_cash_movements: settingsRes.value.z_report_receipt_settings?.show_cash_movements !== false,
        show_other_income: settingsRes.value.z_report_receipt_settings?.show_other_income !== false,
        show_other_expense: settingsRes.value.z_report_receipt_settings?.show_other_expense !== false,
        show_deposit_summary: settingsRes.value.z_report_receipt_settings?.show_deposit_summary !== false,
        show_cashier_breakdown: settingsRes.value.z_report_receipt_settings?.show_cashier_breakdown !== false,
        show_item_breakdown: settingsRes.value.z_report_receipt_settings?.show_item_breakdown !== false,
        show_counts: settingsRes.value.z_report_receipt_settings?.show_counts !== false,
      });
      setQrMenuSettings({
        enabled: settingsRes.value.qr_menu_settings?.enabled !== false,
        hero_title: String(settingsRes.value.qr_menu_settings?.hero_title || 'QR Menu'),
        hero_subtitle: String(settingsRes.value.qr_menu_settings?.hero_subtitle || 'Telefonunuzdan menyuya baxın'),
        show_prices: settingsRes.value.qr_menu_settings?.show_prices !== false,
        show_images: settingsRes.value.qr_menu_settings?.show_images !== false,
        show_descriptions: settingsRes.value.qr_menu_settings?.show_descriptions !== false,
        poster_title: String(settingsRes.value.qr_menu_settings?.poster_title || 'Menyuya baxmaq üçün skan et'),
        poster_subtitle: String(settingsRes.value.qr_menu_settings?.poster_subtitle || 'Telefon kameranızı QR üzərinə yönəldin'),
        background_color: String(settingsRes.value.qr_menu_settings?.background_color || '#0f0f0f'),
        surface_color: String(settingsRes.value.qr_menu_settings?.surface_color || '#1a1a1a'),
        text_color: String(settingsRes.value.qr_menu_settings?.text_color || '#ffffff'),
        primary_color: String(settingsRes.value.qr_menu_settings?.primary_color || '#facc15'),
        accent_color: String(settingsRes.value.qr_menu_settings?.accent_color || '#facc15'),
        hero_image_url: String(settingsRes.value.qr_menu_settings?.hero_image_url || ''),
        poster_image_url: String((settingsRes.value.qr_menu_settings as any)?.poster_image_url || ''),
        poster_background_color: String(settingsRes.value.qr_menu_settings?.poster_background_color || '#facc15'),
        logo_shape: (String(settingsRes.value.qr_menu_settings?.logo_shape || 'rounded') as any),
        font_family: String(settingsRes.value.qr_menu_settings?.font_family || ''),
        custom_font_url: String(settingsRes.value.qr_menu_settings?.custom_font_url || ''),
        theme_preset: (String(settingsRes.value.qr_menu_settings?.theme_preset || 'dark') as any),
        layout_preset: (String(settingsRes.value.qr_menu_settings?.layout_preset || 'classic') as any),
        splash_type: String((settingsRes.value.qr_menu_settings as any)?.splash_type || 'none'),
        splash_url: String((settingsRes.value.qr_menu_settings as any)?.splash_url || ''),
        splash_duration_ms: Number((settingsRes.value.qr_menu_settings as any)?.splash_duration_ms || 3000),
        splash_overlay_text: String((settingsRes.value.qr_menu_settings as any)?.splash_overlay_text || ''),
        splash_bg_color: String((settingsRes.value.qr_menu_settings as any)?.splash_bg_color || '#000000'),
      });
      setFeedbackSettings({
        enabled: settingsRes.value.feedback_settings?.enabled === true,
        promo_enabled: settingsRes.value.feedback_settings?.promo_enabled !== false,
        coupon_percent: Number(settingsRes.value.feedback_settings?.coupon_percent || 5),
        portal_url: String(settingsRes.value.feedback_settings?.portal_url || derivedFeedbackPortalUrl),
        google_review_url: String(settingsRes.value.feedback_settings?.google_review_url || ''),
        receipt_button_text_az: String(settingsRes.value.feedback_settings?.receipt_button_text_az || 'Rəy bildirin'),
        receipt_button_text_ru: String(settingsRes.value.feedback_settings?.receipt_button_text_ru || 'Оставить отзыв'),
        receipt_button_text_en: String(settingsRes.value.feedback_settings?.receipt_button_text_en || 'Leave feedback'),
        receipt_qr_prompt_az: String(settingsRes.value.feedback_settings?.receipt_qr_prompt_az || 'Rəyiniz bizim üçün çox önəmlidir, lütfən QR skan edib rəyinizi bildirin.'),
        receipt_qr_prompt_ru: String(settingsRes.value.feedback_settings?.receipt_qr_prompt_ru || 'Ваше мнение очень важно для нас. Пожалуйста, отсканируйте QR и оставьте отзыв.'),
        receipt_qr_prompt_en: String(settingsRes.value.feedback_settings?.receipt_qr_prompt_en || 'Your feedback matters to us. Please scan the QR code and share your review.'),
        thank_you_text_az: String(settingsRes.value.feedback_settings?.thank_you_text_az || 'Rəyiniz komanda tərəfindən nəzərdən keçiriləcək.'),
        thank_you_text_ru: String(settingsRes.value.feedback_settings?.thank_you_text_ru || 'Ваш отзыв будет рассмотрен нашей командой.'),
        thank_you_text_en: String(settingsRes.value.feedback_settings?.thank_you_text_en || 'Your feedback will be reviewed by our team.'),
        bg_gradient: String(settingsRes.value.feedback_settings?.bg_gradient || 'linear-gradient(155deg, #8ec5ff 0%, #a48bff 28%, #ef8cf9 57%, #ffb58f 100%)'),
        primary_color: String(settingsRes.value.feedback_settings?.primary_color || '#facc15'),
        accent_color: String(settingsRes.value.feedback_settings?.accent_color || '#22d3ee'),
        emoji_icon: String(settingsRes.value.feedback_settings?.emoji_icon || '☕'),
        preset_tags: Array.isArray(settingsRes.value.feedback_settings?.preset_tags) ? settingsRes.value.feedback_settings!.preset_tags!.map((x: any) => String(x || '')) : [
          '❤️ Xidmət əla idi',
          '☕ Dad mükəmməl idi',
          '✨ Məkan çox təmiz idi',
          '👤 Personal peşəkar idi',
          '🏷️ Qiymət/dəyər çox yaxşı idi',
          '👍 Mütləq tövsiyə edərəm',
        ],
        min_stars_for_google_review: Number(settingsRes.value.feedback_settings?.min_stars_for_google_review ?? 4),
        required_comment_threshold: Number(settingsRes.value.feedback_settings?.required_comment_threshold ?? 3),
        custom_heading_az: String(settingsRes.value.feedback_settings?.custom_heading_az || 'Rəy və məmnuniyyət sorğusu'),
        custom_heading_ru: String(settingsRes.value.feedback_settings?.custom_heading_ru || 'Опрос о качестве обслуживания'),
        custom_heading_en: String(settingsRes.value.feedback_settings?.custom_heading_en || 'Customer Satisfaction Survey'),
        custom_subheading_az: String(settingsRes.value.feedback_settings?.custom_subheading_az || 'Xidmət keyfiyyətini yaxşılaşdırmaq üçün 30 saniyə ayırın.'),
        custom_subheading_ru: String(settingsRes.value.feedback_settings?.custom_subheading_ru || 'Пожалуйста, уделите 30 секунд для улучшения качества услуг.'),
        custom_subheading_en: String(settingsRes.value.feedback_settings?.custom_subheading_en || 'Please take 30 seconds to help us improve our service.'),
      });
      setBankCommission({
        card_sale_percent: String((settingsRes.value.bank_commission as any)?.card_sale_percent ?? settingsRes.value.bank_commission?.percent ?? 2),
        card_transfer_percent: String((settingsRes.value.bank_commission as any)?.card_transfer_percent ?? 0.5),
      });
      setFinancePolicy({
        large_transfer_threshold_azn: String(settingsRes.value.finance_policy?.large_transfer_threshold_azn ?? 500),
        investor_repayment_requires_approval: settingsRes.value.finance_policy?.investor_repayment_requires_approval !== false,
        cash_adjustment_requires_approval: settingsRes.value.finance_policy?.cash_adjustment_requires_approval !== false,
        reversal_requires_approval: settingsRes.value.finance_policy?.reversal_requires_approval !== false,
        reconciliation_adjustment_requires_approval: settingsRes.value.finance_policy?.reconciliation_adjustment_requires_approval !== false,
        reconciliation_variance_alert_azn: String(settingsRes.value.finance_policy?.reconciliation_variance_alert_azn ?? 0.01),
        negative_balance_alert_azn: String(settingsRes.value.finance_policy?.negative_balance_alert_azn ?? 0),
        approver_roles: Array.isArray(settingsRes.value.finance_policy?.approver_roles)
          ? settingsRes.value.finance_policy!.approver_roles.join(', ')
          : 'manager, admin, finance_admin, super_admin',
      });
      setTableServiceSettings({
        service_fee_percent: String(settingsRes.value.service_fee_percent ?? 0),
        deposit_per_guest_azn: String(settingsRes.value.table_service_settings?.deposit_per_guest_azn ?? 0),
        reservation_lock_hours: String(settingsRes.value.table_service_settings?.reservation_lock_hours ?? 2),
      });
      setYieldManagement({
        enabled: Boolean(settingsRes.value.yield_management_settings?.enabled),
        variance_tolerance_percent: String(settingsRes.value.yield_management_settings?.variance_tolerance_percent ?? 5),
        beef_ratio: String(settingsRes.value.yield_management_settings?.profiles?.beef?.raw_to_ready_ratio ?? 1.4),
        beef_loss_min_percent: String(settingsRes.value.yield_management_settings?.profiles?.beef?.loss_min_percent ?? 30),
        beef_loss_max_percent: String(settingsRes.value.yield_management_settings?.profiles?.beef?.loss_max_percent ?? 40),
        chicken_ratio: String(settingsRes.value.yield_management_settings?.profiles?.chicken?.raw_to_ready_ratio ?? 1.33),
        chicken_loss_min_percent: String(settingsRes.value.yield_management_settings?.profiles?.chicken?.loss_min_percent ?? 25),
        chicken_loss_max_percent: String(settingsRes.value.yield_management_settings?.profiles?.chicken?.loss_max_percent ?? 35),
        tracked_items: Array.isArray(settingsRes.value.yield_management_settings?.tracked_items)
          ? settingsRes.value.yield_management_settings!.tracked_items!.map((row: any) => ({
              inventory_name: String(row.inventory_name || ''),
              meat_type: String(row.meat_type || 'beef') === 'chicken' ? 'chicken' : 'beef',
              raw_to_ready_ratio: String(row.raw_to_ready_ratio ?? (String(row.meat_type || 'beef') === 'chicken' ? 1.33 : 1.4)),
              enabled: row.enabled !== false,
            }))
          : [],
      });
      setStaffBenefits({
        daily_limit_azn: String(settingsRes.value.staff_benefits?.daily_limit_azn ?? 6),
        allowed_scope: (settingsRes.value.staff_benefits?.allowed_scope as any) || 'all',
        included_categories: Array.isArray(settingsRes.value.staff_benefits?.included_categories) ? settingsRes.value.staff_benefits!.included_categories : [],
        included_items: Array.isArray(settingsRes.value.staff_benefits?.included_items) ? settingsRes.value.staff_benefits!.included_items : [],
        item_unit_cap_azn: String(settingsRes.value.staff_benefits?.item_unit_cap_azn ?? 6),
        coffee_unit_cap_azn: String(settingsRes.value.staff_benefits?.coffee_unit_cap_azn ?? settingsRes.value.staff_benefits?.item_unit_cap_azn ?? 6),
        other_unit_cap_azn: String(settingsRes.value.staff_benefits?.other_unit_cap_azn ?? 2),
      });
      void checkPrintAgentStatus();
    }
  };

  useEffect(() => {
    void loadData();
  }, [tenantId, user?.username]);

  useEffect(() => {
    if (systemPrinters.length > 0 && printSettings.printer_name) {
      const isSystemPrinter = systemPrinters.some(
        (p) => p.name.trim().toLowerCase() === printSettings.printer_name.trim().toLowerCase()
      );
      setCustomPrinterMode(!isSystemPrinter);
    } else {
      setCustomPrinterMode(false);
    }
  }, [systemPrinters, printSettings.printer_name]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    try {
      const dataUrl = await prepareImageDataUrl(file);
      setProfile((prev: any) => ({ ...(prev || {}), logo_url: dataUrl }));
    } catch (error: any) {
      notify('error', error?.message || tx(lang, 'Şəkil yüklənmədi', 'Изображение не загрузилось', 'Image upload failed'));
    } finally {
      e.target.value = '';
    }
  };

  const handleQrHeroUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await prepareImageDataUrl(file);
      setQrMenuSettings((prev) => ({ ...prev, hero_image_url: dataUrl }));
    } catch (error: any) {
      notify('error', error?.message || tx(lang, 'Şəkil yüklənmədi', 'Изображение не загрузилось', 'Image upload failed'));
    } finally {
      e.target.value = '';
    }
  };

  const handleQrPosterImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await prepareSmallImageDataUrl(file);
      setQrMenuSettings((prev) => ({ ...prev, poster_image_url: dataUrl }));
    } catch (error: any) {
      notify('error', error?.message || tx(lang, 'Şəkil yüklənmədi', 'Изображение не загрузилось', 'Image upload failed'));
    } finally {
      e.target.value = '';
    }
  };

  const saveBusinessProfile = async () => {
    if (!profile) return;
    await update_business_profile_live(tenantId, {
      company_name: profile.company_name,
      voen: profile.voen,
      phone: profile.phone,
      address: profile.address,
      website: profile.website,
      logo_url: profile.logo_url,
      receipt_footer: profile.receipt_footer,
      tax_regime: profile.tax_regime === 'vat' ? 'vat' : 'simplified',
      vat_rate: Number(profile.vat_rate ?? 18),
      nka_registration_no: profile.nka_registration_no,
      fiscal_enabled: profile.fiscal_enabled === true,
    }, user?.username || 'admin');
    await update_qr_settings_live({ base_url: String(profile.qr_base_url || '').trim() });
    flashSuccess(tx(lang, 'Biznes məlumatları yadda saxlanıldı', 'Данные бизнеса сохранены', 'Business profile saved'), 'business_profile');
  };

  const saveSessionSettings = async () => {
    try {
      await update_session_settings_live({
        idle_logout_minutes: Math.max(0, Number(sessionSettings.idle_logout_minutes || 0)),
        virtual_keyboard_enabled: sessionSettings.virtual_keyboard_enabled,
        staff_pin_length: sessionSettings.staff_pin_length,
        theme_mode: sessionSettings.theme_mode,
        ui_mode: 'old',
        login_background_url: sessionSettings.login_background_url || '',
      });
      window.dispatchEvent(new CustomEvent('settings-updated', { detail: { tenant_id: tenantId } }));
      flashSuccess(tx(lang, 'Sessiya ayarları yadda saxlanıldı', 'Настройки сессии сохранены', 'Session settings saved'), 'session');
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Sessiya ayarları saxlanmadı', 'Настройки сессии не сохранены', 'Session settings were not saved'));
    }
  };

  const toggleVirtualKeyboard = async (nextEnabled: boolean) => {
    setSessionSettings((prev) => ({ ...prev, virtual_keyboard_enabled: nextEnabled }));
    try {
      await update_session_settings_live({
        idle_logout_minutes: Math.max(0, Number(sessionSettings.idle_logout_minutes || 0)),
        virtual_keyboard_enabled: nextEnabled,
        staff_pin_length: sessionSettings.staff_pin_length,
        theme_mode: sessionSettings.theme_mode,
        ui_mode: 'old',
        login_background_url: sessionSettings.login_background_url || '',
      });
      window.dispatchEvent(new CustomEvent('settings-updated', { detail: { tenant_id: tenantId } }));
      flashSuccess(
        nextEnabled
          ? tx(lang, 'Virtual klaviatura aktiv edildi', 'Виртуальная клавиатура включена', 'Virtual keyboard enabled')
          : tx(lang, 'Virtual klaviatura söndürüldü', 'Виртуальная клавиатура отключена', 'Virtual keyboard disabled'),
      );
    } catch (e: any) {
      setSessionSettings((prev) => ({ ...prev, virtual_keyboard_enabled: !nextEnabled }));
      notify('error', e?.message || tx(lang, 'Virtual klaviatura ayarı saxlanmadı', 'Настройка виртуальной клавиатуры не сохранена', 'Virtual keyboard setting was not saved'));
    }
  };

  const changeThemeMode = async (nextMode: 'dark' | 'light') => {
    if (sessionSettings.theme_mode === nextMode) return;
    const previous = sessionSettings.theme_mode;
    setSessionSettings((prev) => ({ ...prev, theme_mode: nextMode }));
    document.documentElement.setAttribute('data-theme', nextMode);
    document.documentElement.style.colorScheme = nextMode;
    try {
      localStorage.setItem('iw_theme_mode', nextMode);
    } catch {}
    try {
      await update_session_settings_live({
        idle_logout_minutes: Math.max(0, Number(sessionSettings.idle_logout_minutes || 0)),
        virtual_keyboard_enabled: sessionSettings.virtual_keyboard_enabled,
        staff_pin_length: sessionSettings.staff_pin_length,
        theme_mode: nextMode,
        ui_mode: (sessionSettings as any)?.ui_mode || 'old',
        tables_ui_mode: (sessionSettings as any)?.tables_ui_mode || 'classic',
        login_background_url: sessionSettings.login_background_url || '',
      } as any);
      window.dispatchEvent(new CustomEvent('settings-updated', { detail: { tenant_id: tenantId } }));
      flashSuccess(
        nextMode === 'light'
          ? tx(lang, 'Light rejim aktiv edildi', 'Светлая тема включена', 'Light mode enabled')
          : tx(lang, 'Dark rejim aktiv edildi', 'Тёмная тема включена', 'Dark mode enabled'),
      );
    } catch (e: any) {
      setSessionSettings((prev) => ({ ...prev, theme_mode: previous }));
      document.documentElement.setAttribute('data-theme', previous);
      document.documentElement.style.colorScheme = previous;
      try {
        localStorage.setItem('iw_theme_mode', previous);
      } catch {}
      notify('error', e?.message || tx(lang, 'Tema ayarı saxlanmadı', 'Настройка темы не сохранена', 'Theme setting was not saved'));
    }
  };

  const handleCreateUser = async () => {
    const username = newUserName.trim();
    if (!username) {
      notify('error', tx(lang, 'İstifadəçi adı yazın', 'Введите имя пользователя', 'Enter a username'));
      return;
    }

    if (requiresPasswordForNewUser) {
      if (!newUserPassword || !isStrongPassword(newUserPassword)) {
        notify('error', passwordPolicyText);
        return;
      }
    } else if (!newUserPin || newUserPin.length < configuredStaffPinLength) {
      notify('error', tx(lang, `Staff/Kitchen üçün ən azı ${configuredStaffPinLength} rəqəmli PIN yazın`, `Для Staff/Kitchen введите PIN минимум ${configuredStaffPinLength} цифр`, `Enter at least ${configuredStaffPinLength} digits for Staff/Kitchen PIN`));
      return;
    }

    try {
      await create_user_live({
        tenant_id: tenantId,
        username,
        role: newUserRole,
        password: requiresPasswordForNewUser ? newUserPassword : undefined,
        pin: requiresPasswordForNewUser ? undefined : newUserPin,
      } as any);
      setNewUserName('');
      setNewUserPassword('');
      setNewUserPin('');
      await loadData();
      window.dispatchEvent(new CustomEvent('settings-users-updated', { detail: { tenant_id: tenantId } }));
      flashSuccess(tx(lang, 'İstifadəçi yaradıldı', 'Пользователь создан', 'User created'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'İstifadəçi yaratmaq alınmadı', 'Не удалось создать пользователя', 'Failed to create user'));
    }
  };

  const handleDeleteUser = async (username: string) => {
    try {
      await delete_user_live(username);
      setDeleteUserName(null);
      await loadData();
      window.dispatchEvent(new CustomEvent('settings-users-updated', { detail: { tenant_id: tenantId } }));
      flashSuccess(tx(lang, 'İstifadəçi silindi', 'Пользователь удален', 'User deleted'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'İstifadəçini silmək alınmadı', 'Не удалось удалить пользователя', 'Failed to delete user'));
    }
  };

  const handleUpdatePin = async () => {
    if (!targetUser) {
      notify('error', tx(lang, 'PIN dəyişmək üçün istifadəçi seçin', 'Выберите пользователя для смены PIN', 'Select a user to change PIN'));
      return;
    }
    if (!targetPin || targetPin.length < configuredStaffPinLength) {
      notify('error', tx(lang, `Yeni PIN ən azı ${configuredStaffPinLength} rəqəm olmalıdır`, `Новый PIN должен быть минимум ${configuredStaffPinLength} цифр`, `New PIN must be at least ${configuredStaffPinLength} digits`));
      return;
    }

    try {
      await update_user_credentials_live(targetUser, { pin: targetPin }, user?.username || 'admin');
      setTargetPin('');
      await loadData();
      window.dispatchEvent(new CustomEvent('settings-users-updated', { detail: { tenant_id: tenantId } }));
      flashSuccess(tx(lang, 'PIN yeniləndi', 'PIN обновлен', 'PIN updated'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'PIN yenilənmədi', 'PIN не обновлен', 'PIN update failed'));
    }
  };

  const handleUpdatePasswordForUser = async () => {
    if (!targetPasswordUser) {
      notify('error', tx(lang, 'Şifrə dəyişmək üçün istifadəçi seçin', 'Выберите пользователя для смены пароля', 'Select a user to change password'));
      return;
    }
    if (!targetPassword || !isStrongPassword(targetPassword)) {
      notify('error', passwordPolicyText);
      return;
    }
    try {
      await update_user_credentials_live(targetPasswordUser, { password: targetPassword }, user?.username || 'admin');
      setTargetPassword('');
      await loadData();
      window.dispatchEvent(new CustomEvent('settings-users-updated', { detail: { tenant_id: tenantId } }));
      flashSuccess(tx(lang, 'İstifadəçi şifrəsi yeniləndi', 'Пароль пользователя обновлен', 'User password updated'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Şifrə yenilənmədi', 'Пароль не обновлен', 'Password update failed'));
    }
  };

  const handleChangeOwnPassword = async () => {
    if (!user?.username) return;
    if (!currentPassword) {
      notify('error', tx(lang, 'Mövcud şifrəni daxil edin', 'Введите текущий пароль', 'Enter your current password'));
      return;
    }
    if (!newOwnPassword || !isStrongPassword(newOwnPassword)) {
      notify('error', passwordPolicyText);
      return;
    }
    if (newOwnPassword !== confirmOwnPassword) {
      notify('error', tx(lang, 'Şifrə təkrarı uyğun deyil', 'Подтверждение пароля не совпадает', 'Password confirmation does not match'));
      return;
    }

    try {
      await update_user_credentials_live(
        user.username,
        { password: newOwnPassword, current_password: currentPassword },
        user.username,
      );
      setCurrentPassword('');
      setNewOwnPassword('');
      setConfirmOwnPassword('');
      flashSuccess(tx(lang, 'Şifrə yeniləndi', 'Пароль обновлен', 'Password updated'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Şifrə yenilənmədi', 'Пароль не обновлен', 'Password update failed'));
    }
  };

  const handleStartTotpSetup = async () => {
    try {
      const result = await setup_totp_live();
      setTotpSetupUrl(result.otpauth_url);
      setTotpSecret(result.secret);
      setTotpCode('');
      setTotpDisablePassword('');
      const qrDataUrl = await QRCode.toDataURL(result.otpauth_url, {
        margin: 1,
        width: 220,
      });
      setTotpQrDataUrl(qrDataUrl);
      flashSuccess(tx(lang, 'Google Authenticator qoşulması başladı', 'Настройка Google Authenticator начата', 'Google Authenticator setup started'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, '2FA qurulumu başlatmaq alınmadı', 'Не удалось начать настройку 2FA', 'Failed to start 2FA setup'));
    }
  };

  const handleVerifyTotp = async () => {
    if (!totpCode || totpCode.trim().length < 6) {
      notify('error', tx(lang, '6 rəqəmli kodu daxil edin', 'Введите 6-значный код', 'Enter the 6-digit code'));
      return;
    }
    try {
      await verify_totp_live(totpCode);
      setTotpCode('');
      setTotpSetupUrl('');
      setTotpSecret('');
      setTotpQrDataUrl('');
      await loadData();
      flashSuccess(tx(lang, 'Google Authenticator aktiv edildi', 'Google Authenticator включен', 'Google Authenticator enabled'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, '2FA kodu təsdiqlənmədi', 'Код 2FA не подтвержден', '2FA code verification failed'));
    }
  };

  const handleDisableTotp = async () => {
    if (!totpDisablePassword) {
      notify('error', tx(lang, 'Cari şifrəni daxil edin', 'Введите текущий пароль', 'Enter your current password'));
      return;
    }
    try {
      await disable_totp_live(totpDisablePassword, totpDisableCode);
      setTotpDisablePassword('');
      setTotpDisableCode('');
      setTotpSetupUrl('');
      setTotpSecret('');
      setTotpQrDataUrl('');
      await loadData();
      flashSuccess(tx(lang, 'Google Authenticator söndürüldü', 'Google Authenticator отключен', 'Google Authenticator disabled'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, '2FA söndürülmədi', '2FA не отключен', 'Failed to disable 2FA'));
    }
  };

  const handleResetSystem = async () => {
    if (!resetPassword) {
      notify('error', tx(lang, 'Admin şifrəsini daxil edin', 'Введите пароль администратора', 'Enter the admin password'));
      return;
    }
    try {
      await reset_system_live(resetPassword, totpEnabled ? resetTotpCode : undefined);
      setResetModalOpen(false);
      setResetPassword('');
      setResetTotpCode('');
      await loadData();
      flashSuccess(tx(lang, 'Sistem datası sıfırlandı', 'Данные системы сброшены', 'System data was reset'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Sistem sıfırlanmadı', 'Система не была сброшена', 'System reset failed'));
    }
  };

  const saveRoleModules = async () => {
    await update_role_modules_live(roleModules);
    flashSuccess(tx(lang, 'Rol icazələri yadda saxlanıldı', 'Права ролей сохранены', 'Role permissions saved'), 'role_modules');
  };

  const saveEmailSettings = async () => {
    await update_email_settings_live({
      enabled: emailSettings.enabled,
      provider: emailSettings.provider as any,
      resend_api_key: emailSettings.resend_api_key,
      sender_email: emailSettings.sender_email,
      recipient_emails: emailSettings.recipient_emails.split(',').map((v) => v.trim()).filter(Boolean),
      webhook_url: emailSettings.webhook_url,
      timeout_sec: Number(emailSettings.timeout_sec || 15),
    });
    flashSuccess(tx(lang, 'Email ayarları yadda saxlanıldı', 'Настройки email сохранены', 'Email settings saved'), 'email');
  };

  const saveDeliveryIntegrations = async () => {
    try {
      await update_delivery_integrations_live({
        bolt_food_enabled: deliveryIntegrations.bolt_food_enabled,
        bolt_food_provider_id: deliveryIntegrations.bolt_food_provider_id,
        bolt_food_secret_key: deliveryIntegrations.bolt_food_secret_key,
        wolt_enabled: deliveryIntegrations.wolt_enabled,
        wolt_venue_id: deliveryIntegrations.wolt_venue_id,
        wolt_client_secret: deliveryIntegrations.wolt_client_secret,
      });
      flashSuccess(tx(lang, 'Çatdırılma inteqrasiyaları yadda saxlanıldı', 'Настройки доставки сохранены', 'Delivery integrations saved'), 'delivery_integrations');
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'İnteqrasiyaları yadda saxlamaq mümkün olmadı', 'Не удалось сохранить интеграции', 'Failed to save integrations'));
    }
  };

  const savePrintSettings = async () => {
    try {
      await update_print_settings_live({
        use_qz: printSettings.use_qz,
        printer_name: printSettings.printer_name.trim(),
        kitchen_printer_name: printSettings.kitchen_printer_name.trim(),
        auto_print_kitchen_ticket: printSettings.auto_print_kitchen_ticket,
        auto_print_receipt: printSettings.auto_print_receipt,
        paper_width: printSettings.paper_width,
        print_engine: printSettings.print_engine,
      });
      flashSuccess(tx(lang, 'Çap ayarları yadda saxlanıldı', 'Настройки печати сохранены', 'Print settings saved'), 'print');
    } catch {
      notify('error', tx(lang, 'Çap ayarlarını yadda saxlamaq mümkün olmadı', 'Не удалось сохранить настройки печати', 'Failed to save print settings'));
    }
  };

  const handleTestPrint = async (type: 'cashier' | 'kitchen') => {
    setTestingPrint(type);
    try {
      const targetPrinter =
        type === 'kitchen'
          ? printSettings.kitchen_printer_name || printSettings.printer_name
          : printSettings.printer_name;

      const isRaw = printSettings.print_engine === 'raw_escpos';
      const { buildTestTicketEscPos } = await import('../../lib/escpos_builder');
      const rawCmds = buildTestTicketEscPos(type, targetPrinter);

      const htmlTest = `
        <div style="text-align: center; padding: 4px 0;">
          <div style="font-weight: 900; font-size: 13px;">=== TEST CAPI ===</div>
          <div style="font-size: 11px; margin-top: 2px;">Növ: <b>${type === 'kitchen' ? 'MƏTBƏX' : 'KASSA'}</b></div>
          <div style="font-size: 11px;">Printer: <b>${targetPrinter || 'Sistem Default'}</b></div>
          <div style="font-size: 10px; color: #444;">Format: ${printSettings.paper_width} | Rejim: ${isRaw ? 'ESC/POS Raw' : 'HTML Graphics'}</div>
          <hr style="border-top: 1px dashed #000; margin: 4px 0;" />
          <div style="display: flex; justify-content: space-between; font-size: 11px; font-weight: 700;">
            <span>1x Test Mehsul</span>
            <span>OK</span>
          </div>
          <hr style="border-top: 1px dashed #000; margin: 4px 0;" />
          <div style="font-size: 10px; font-weight: bold; margin-top: 4px;">QZ Tray / Agent Baglantisi Ugurludur!</div>
        </div>
      `;

      const res = await printDirectOrFallback(htmlTest, {
        printerName: targetPrinter,
        useQz: Boolean(printSettings.use_qz),
        paperWidth: printSettings.paper_width,
        printEngine: printSettings.print_engine,
        rawCommands: isRaw ? rawCmds : undefined,
        allowBrowserFallback: false,
      });

      if (res.success) {
        notify(
          'success',
          tx(
            lang,
            `${type === 'kitchen' ? 'Mətbəx' : 'Kassa'} test çeki uğurla printerə göndərildi!`,
            `Тестовый чек ${type === 'kitchen' ? 'кухни' : 'кассы'} успешно отправлен!`,
            `${type === 'kitchen' ? 'Kitchen' : 'Cashier'} test receipt sent to printer!`
          )
        );
      } else {
        notify(
          'error',
          tx(
            lang,
            `${res.error || 'Çap alınmadı'}. Printer adını və QZ Tray statusunu yoxlayın.`,
            `${res.error || 'Печать не удалась'}. Проверьте имя принтера и статус QZ Tray.`,
            `${res.error || 'Print failed'}. Check the printer name and QZ Tray status.`
          )
        );
      }
    } catch (e: any) {
      notify('error', e?.message || 'Test çapı xətası');
    } finally {
      setTestingPrint(null);
    }
  };

  const checkPrintAgentStatus = async () => {
    setPrintAgentHealth('checking');
    setQzHealth('checking');

    const [agentInfoResult, qzResult] = await Promise.allSettled([
      localPrintAgentInfo(),
      qzCheckStatus(),
    ]);

    const info = agentInfoResult.status === 'fulfilled' ? agentInfoResult.value : { online: false, version: '' };
    const qz = qzResult.status === 'fulfilled' ? qzResult.value : { online: false, printers: [], error: 'Unknown error' };

    setPrintAgentHealth(info.online ? 'online' : 'offline');
    setPrintAgentVersion(info.version || '');

    setQzHealth(qz.online ? 'online' : 'offline');
    setQzPrintersCount(qz.printers?.length || 0);
    setQzErrorMessage(qz.error || '');

    const combinedPrinters: LocalPrintAgentPrinter[] = [];

    if (info.online) {
      const agentPrinters = await localPrintAgentPrinters().catch(() => []);
      combinedPrinters.push(...agentPrinters);
    }

    if (qz.online && qz.printers && qz.printers.length > 0) {
      for (const p of qz.printers) {
        if (!combinedPrinters.some((cp) => cp.name.toLowerCase() === p.toLowerCase())) {
          combinedPrinters.push({ name: p, default: false });
        }
      }
    }

    setSystemPrinters(combinedPrinters);

    try {
      const response = await fetch(`${window.location.origin.replace(/\/+$/, '')}/downloads/print-agent-latest.json`, { method: 'GET' });
      if (response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { minimum_version?: string };
        const minVersion = String(payload?.minimum_version || '').trim();
        if (minVersion) setPrintAgentMinVersion(minVersion);
      }
    } catch {
      // ignore manifest errors
    }
  };

  const printAgentWindowsZipUrl = `${window.location.origin.replace(/\/+$/, '')}/downloads/ironwaves-print-agent-windows.zip`;

  const downloadPrintAgentWindowsZip = async () => {
    try {
      const probe = await fetch(printAgentWindowsZipUrl, { method: 'HEAD', cache: 'no-store' });
      if (!probe.ok) {
        notify('error', tx(lang, 'Printer Agent ZIP faylı serverdə tapılmadı. Support ilə əlaqə saxlayın.', 'Файл ZIP Printer Agent не найден на сервере. Обратитесь в поддержку.', 'Printer Agent ZIP file was not found on the server. Please contact support.'));
        return;
      }
      const link = document.createElement('a');
      link.href = printAgentWindowsZipUrl;
      link.download = 'ironwaves-print-agent-windows.zip';
      link.rel = 'noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
      notify('success', tx(lang, 'Yükləmə başladı. Arxivdən çıxarıb setup-windows.ps1 işə salın.', 'Загрузка началась. Распакуйте архив и запустите setup-windows.ps1.', 'Download started. Extract the archive and run setup-windows.ps1.'));
    } catch {
      notify('error', tx(lang, 'Yükləmə başlamadı. İnternet bağlantısını yoxlayın.', 'Загрузка не началась. Проверьте подключение к интернету.', 'Download did not start. Check internet connection.'));
    }
  };

  const printAgentSetupUrl = `${window.location.origin.replace(/\/+$/, '')}/downloads/ironwaves-print-agent-setup.exe`;

  const downloadPrintAgentSetup = async () => {
    try {
      const probe = await fetch(printAgentSetupUrl, { method: 'HEAD', cache: 'no-store' });
      if (!probe.ok) {
        notify(
          'error',
          tx(
            lang,
            'Printer Agent setup faylı serverdə tapılmadı. Support ilə əlaqə saxlayın.',
            'Файл setup Printer Agent не найден на сервере. Обратитесь в поддержку.',
            'Printer Agent setup file was not found on the server. Please contact support.',
          ),
        );
        return;
      }
      const link = document.createElement('a');
      link.href = printAgentSetupUrl;
      link.download = 'ironwaves-print-agent-setup.exe';
      link.rel = 'noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
      notify(
        'success',
        tx(
          lang,
          'Yükləmə başladı. Faylı açıb quraşdırmanı tamamlayın.',
          'Загрузка началась. Откройте файл и завершите установку.',
          'Download started. Open the file and finish installation.',
        ),
      );
    } catch {
      notify(
        'error',
        tx(
          lang,
          'Yükləmə başlamadı. İnternet bağlantısını və server faylını yoxlayın.',
          'Загрузка не началась. Проверьте интернет и файл на сервере.',
          'Download did not start. Check internet and server file.',
        ),
      );
    }
  };

  const saveZReportReceiptSettings = async () => {
    await update_z_report_receipt_settings_live(zReportReceiptSettings);
    flashSuccess(tx(lang, 'Z-Hesabat çek ayarları yadda saxlanıldı', 'Настройки чека Z-отчёта сохранены', 'Z-report receipt settings saved'), 'zreport_receipt');
  };

  const handleAddDeliveryMenuMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeliveryMenuMapping.external_item_id.trim() || !newDeliveryMenuMapping.menu_item_id) {
      notify('error', tx(lang, 'Xarici ID və Daxili Məhsul mütləqdir', 'Внешний ID и внутренний продукт обязательны', 'External ID and Internal Product are required'));
      return;
    }
    try {
      const created = await createDeliveryMenuMapping(newDeliveryMenuMapping);
      setDeliveryMenuMappings((prev) => [...prev, created]);
      setNewDeliveryMenuMapping({
        provider: newDeliveryMenuMapping.provider,
        external_item_id: '',
        external_item_name: '',
        menu_item_id: '',
      });
      notify('success', tx(lang, 'Xəritələnmə uğurla əlavə edildi', 'Сопоставление успешно добавлено', 'Mapping successfully added'));
    } catch (err: any) {
      notify('error', err.message || 'Error creating mapping');
    }
  };

  const handleDeleteDeliveryMenuMapping = async (id: string) => {
    if (!confirm(tx(lang, 'Bu xəritələnməni silmək istədiyinizdən əminsiniz?', 'Вы уверены, что хотите удалить это сопоставление?', 'Are you sure you want to delete this mapping?'))) {
      return;
    }
    try {
      await deleteDeliveryMenuMapping(id);
      setDeliveryMenuMappings((prev) => prev.filter((m) => m.id !== id));
      notify('success', tx(lang, 'Xəritələnmə silindi', 'Сопоставление удалено', 'Mapping deleted'));
    } catch (err: any) {
      notify('error', err.message || 'Error deleting mapping');
    }
  };

  const handleThemePresetChange = (theme: 'dark' | 'light' | 'emerald' | 'custom') => {
    setQrMenuSettings((prev) => {
      const updated = { ...prev, theme_preset: theme };
      if (theme === 'dark') {
        updated.background_color = '#090d16';
        updated.surface_color = '#151c2c';
        updated.text_color = '#f8fafc';
        updated.primary_color = '#06b6d4';
        updated.accent_color = '#06b6d4';
      } else if (theme === 'light') {
        updated.background_color = '#f8fafc';
        updated.surface_color = '#ffffff';
        updated.text_color = '#0f172a';
        updated.primary_color = '#10b981';
        updated.accent_color = '#10b981';
      } else if (theme === 'emerald') {
        updated.background_color = '#022c22';
        updated.surface_color = '#064e3b';
        updated.text_color = '#f0fdf4';
        updated.primary_color = '#fbbf24';
        updated.accent_color = '#fbbf24';
      }
      return updated;
    });
  };

  const saveQrMenuSettings = async () => {
    await update_qr_menu_settings_live({
      enabled: qrMenuSettings.enabled,
      hero_title: qrMenuSettings.hero_title,
      hero_subtitle: qrMenuSettings.hero_subtitle,
      show_prices: qrMenuSettings.show_prices,
      show_images: qrMenuSettings.show_images,
      show_descriptions: qrMenuSettings.show_descriptions,
      poster_title: qrMenuSettings.poster_title,
      poster_subtitle: qrMenuSettings.poster_subtitle,
      background_color: qrMenuSettings.background_color,
      surface_color: qrMenuSettings.surface_color,
      text_color: qrMenuSettings.text_color,
      primary_color: qrMenuSettings.primary_color,
      accent_color: qrMenuSettings.accent_color,
      hero_image_url: qrMenuSettings.hero_image_url,
      poster_image_url: qrMenuSettings.poster_image_url,
      poster_background_color: qrMenuSettings.poster_background_color,
      logo_shape: qrMenuSettings.logo_shape,
      font_family: qrMenuSettings.font_family,
      custom_font_url: qrMenuSettings.custom_font_url,
      theme_preset: qrMenuSettings.theme_preset,
      layout_preset: qrMenuSettings.layout_preset,
      splash_type: qrMenuSettings.splash_type,
      splash_url: qrMenuSettings.splash_url,
      splash_duration_ms: qrMenuSettings.splash_duration_ms,
      splash_overlay_text: qrMenuSettings.splash_overlay_text,
      splash_bg_color: qrMenuSettings.splash_bg_color,
    } as any);
    flashSuccess(tx(lang, 'QR Menu ayarları yadda saxlanıldı', 'Настройки QR Menu сохранены', 'QR Menu settings saved'), 'qr_menu');
  };

  const saveFeedbackSettings = async () => {
    const resolvedPortalUrl = String(feedbackSettings.portal_url || '').trim() || autoFeedbackPortalUrl;
    await update_feedback_settings_live({
      enabled: feedbackSettings.enabled,
      promo_enabled: feedbackSettings.promo_enabled,
      coupon_percent: Math.max(1, Math.min(100, Number(feedbackSettings.coupon_percent || 5))),
      portal_url: resolvedPortalUrl,
      google_review_url: String(feedbackSettings.google_review_url || '').trim(),
      receipt_button_text_az: String(feedbackSettings.receipt_button_text_az || '').trim() || 'Rəy bildirin',
      receipt_button_text_ru: String(feedbackSettings.receipt_button_text_ru || '').trim() || 'Оставить отзыв',
      receipt_button_text_en: String(feedbackSettings.receipt_button_text_en || '').trim() || 'Leave feedback',
      receipt_qr_prompt_az: String(feedbackSettings.receipt_qr_prompt_az || '').trim() || 'Rəyiniz bizim üçün çox önəmlidir, lütfən QR skan edib rəyinizi bildirin.',
      receipt_qr_prompt_ru: String(feedbackSettings.receipt_qr_prompt_ru || '').trim() || 'Ваше мнение очень важно для нас. Пожалуйста, отсканируйте QR и оставьте отзыв.',
      receipt_qr_prompt_en: String(feedbackSettings.receipt_qr_prompt_en || '').trim() || 'Your feedback matters to us. Please scan the QR code and share your review.',
      thank_you_text_az: String(feedbackSettings.thank_you_text_az || '').trim() || 'Rəyiniz komanda tərəfindən nəzərdən keçiriləcək.',
      thank_you_text_ru: String(feedbackSettings.thank_you_text_ru || '').trim() || 'Ваш отзыв будет рассмотрен нашей командой.',
      thank_you_text_en: String(feedbackSettings.thank_you_text_en || '').trim() || 'Your feedback will be reviewed by our team.',
      bg_gradient: String(feedbackSettings.bg_gradient || '').trim() || 'linear-gradient(155deg, #8ec5ff 0%, #a48bff 28%, #ef8cf9 57%, #ffb58f 100%)',
      primary_color: String(feedbackSettings.primary_color || '').trim() || '#facc15',
      accent_color: String(feedbackSettings.accent_color || '').trim() || '#22d3ee',
      emoji_icon: String(feedbackSettings.emoji_icon || '').trim() || '☕',
      preset_tags: feedbackSettings.preset_tags,
      min_stars_for_google_review: Number(feedbackSettings.min_stars_for_google_review ?? 4),
      required_comment_threshold: Number(feedbackSettings.required_comment_threshold ?? 3),
      custom_heading_az: String(feedbackSettings.custom_heading_az || '').trim(),
      custom_heading_ru: String(feedbackSettings.custom_heading_ru || '').trim(),
      custom_heading_en: String(feedbackSettings.custom_heading_en || '').trim(),
      custom_subheading_az: String(feedbackSettings.custom_subheading_az || '').trim(),
      custom_subheading_ru: String(feedbackSettings.custom_subheading_ru || '').trim(),
      custom_subheading_en: String(feedbackSettings.custom_subheading_en || '').trim(),
    });
    setFeedbackSettings((prev) => ({ ...prev, portal_url: resolvedPortalUrl }));
    window.dispatchEvent(new CustomEvent('settings-updated', { detail: { tenant_id: tenantId } }));
    flashSuccess(tx(lang, 'Feedback portal ayarları yadda saxlanıldı', 'Настройки feedback портала сохранены', 'Feedback portal settings saved'), 'feedback');
  };

  const saveBankCommission = async () => {
    await update_bank_commission_live({
      card_sale_percent: Number(bankCommission.card_sale_percent || 0),
      card_transfer_percent: Number(bankCommission.card_transfer_percent || 0),
    });
    flashSuccess(tx(lang, 'Bank faiz ayarları yadda saxlanıldı', 'Настройки банковских комиссий сохранены', 'Bank fee settings saved'), 'bank');
  };

  const saveFinancePolicy = async () => {
    await update_finance_policy_live({
      large_transfer_threshold_azn: Number(financePolicy.large_transfer_threshold_azn || 0),
      investor_repayment_requires_approval: financePolicy.investor_repayment_requires_approval,
      cash_adjustment_requires_approval: financePolicy.cash_adjustment_requires_approval,
      reversal_requires_approval: financePolicy.reversal_requires_approval,
      reconciliation_adjustment_requires_approval: financePolicy.reconciliation_adjustment_requires_approval,
      reconciliation_variance_alert_azn: Number(financePolicy.reconciliation_variance_alert_azn || 0),
      negative_balance_alert_azn: Number(financePolicy.negative_balance_alert_azn || 0),
      approver_roles: financePolicy.approver_roles.split(',').map((role) => role.trim().toLowerCase()).filter(Boolean),
    });
    flashSuccess(tx(lang, 'Maliyyə policy ayarları yadda saxlanıldı', 'Настройки финансовой policy сохранены', 'Finance policy settings saved'), 'finance_policy');
  };



  const saveTableServiceSettings = async () => {
    await update_service_fee_live({
      service_fee_percent: Number(tableServiceSettings.service_fee_percent || 0),
    });
    await update_table_service_settings_live({
      deposit_per_guest_azn: Number(tableServiceSettings.deposit_per_guest_azn || 0),
      reservation_lock_hours: Number(tableServiceSettings.reservation_lock_hours || 0),
    });
    flashSuccess(tx(lang, 'Masa xidməti ayarları yadda saxlanıldı', 'Настройки столов сохранены', 'Table service settings saved'), 'table_service');
  };

  const saveBeverageServiceSettings = async () => {
    await update_beverage_service_settings_live({
      coffee_selection_mode: beverageServiceSettings.coffee_selection_mode,
      remove_paper_packaging_for_table: beverageServiceSettings.remove_paper_packaging_for_table,
      discount_scope: beverageServiceSettings.discount_scope,
      summer_promo_enabled: beverageServiceSettings.summer_promo_enabled,
    });
    flashSuccess(tx(lang, 'İçki servis ayarları yadda saxlanıldı', 'Настройки подачи напитков сохранены', 'Beverage service settings saved'), 'beverage');
  };

  const saveYieldManagement = async () => {
    await update_yield_management_settings_live({
      enabled: yieldManagement.enabled,
      variance_tolerance_percent: Number(yieldManagement.variance_tolerance_percent || 5),
      profiles: {
        beef: {
          raw_to_ready_ratio: Number(yieldManagement.beef_ratio || 1.4),
          loss_min_percent: Number(yieldManagement.beef_loss_min_percent || 30),
          loss_max_percent: Number(yieldManagement.beef_loss_max_percent || 40),
        },
        chicken: {
          raw_to_ready_ratio: Number(yieldManagement.chicken_ratio || 1.33),
          loss_min_percent: Number(yieldManagement.chicken_loss_min_percent || 25),
          loss_max_percent: Number(yieldManagement.chicken_loss_max_percent || 35),
        },
      },
      tracked_items: yieldManagement.tracked_items.map((row) => ({
        inventory_name: row.inventory_name,
        meat_type: row.meat_type,
        raw_to_ready_ratio: Number(row.raw_to_ready_ratio || (row.meat_type === 'chicken' ? yieldManagement.chicken_ratio : yieldManagement.beef_ratio)),
        enabled: row.enabled,
      })),
    });
    flashSuccess(tx(lang, 'Standart itki ayarları yadda saxlanıldı', 'Настройки yield management сохранены', 'Yield management settings saved'), 'yield');
  };



  const saveAiApiKey = async () => {
    try {
      writeScopedStorage('gemini_api_key', aiApiKey);
      await update_api_key_live(aiApiKey, {});
      flashSuccess(tx(lang, 'AI API Key yadda saxlanıldı', 'AI API Key сохранён', 'AI API Key saved'), 'ai');
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'AI API Key saxlanmadı', 'AI API Key не сохранён', 'AI API Key was not saved'));
    }
  };

  const saveTablesUiMode = async (mode: 'classic' | 'modern') => {
    setSessionSettings((prev) => ({ ...prev, tables_ui_mode: mode } as any));
    try { localStorage.setItem('iw_tables_ui_mode', mode); localStorage.setItem('iw_pos_ui_mode', mode); } catch {}
    try {
      await update_session_settings_live({
        idle_logout_minutes: Math.max(0, Number(sessionSettings.idle_logout_minutes || 0)),
        virtual_keyboard_enabled: sessionSettings.virtual_keyboard_enabled,
        staff_pin_length: sessionSettings.staff_pin_length,
        theme_mode: sessionSettings.theme_mode,
        ui_mode: 'old',
        tables_ui_mode: mode,
        login_background_url: sessionSettings.login_background_url || '',
      } as any);
      notify('success', tx(lang, 'Masalar UI rejimi dəyişdirildi', 'Режим UI столов изменен', 'Tables UI mode changed'));
      window.dispatchEvent(new CustomEvent('settings-updated', { detail: { tenant_id: tenantId } }));
    } catch (e: any) {
      setSessionSettings((prev) => ({ ...prev, tables_ui_mode: mode === 'modern' ? 'classic' : 'modern' } as any));
      notify('error', e?.message || 'Failed');
    }
  };

  const saveStaffBenefits = async () => {
    await update_staff_benefits_live({
      daily_limit_azn: Number(staffBenefits.daily_limit_azn || 0),
      allowed_scope: staffBenefits.allowed_scope,
      included_categories: staffBenefits.included_categories,
      included_items: staffBenefits.included_items,
      item_unit_cap_azn: Number(staffBenefits.coffee_unit_cap_azn || 0),
      coffee_unit_cap_azn: Number(staffBenefits.coffee_unit_cap_azn || 0),
      other_unit_cap_azn: Number(staffBenefits.other_unit_cap_azn || 0),
    });
    flashSuccess(tx(lang, 'Staff limit ayarları yadda saxlanıldı', 'Настройки лимита staff сохранены', 'Staff benefit settings saved'), 'staff_benefits');
  };

  const settingsSections = [
    { id: 'sec-profile', label: tx(lang, 'Profil', 'Профиль', 'Profile'), cat: 'general' },
    { id: 'sec-email', label: tx(lang, 'Email', 'Email', 'Email'), cat: 'general' },
    { id: 'sec-delivery', label: tx(lang, 'Çatdırılma', 'Доставка', 'Delivery'), cat: 'integrations' },
    { id: 'sec-print', label: tx(lang, 'Çap', 'Печать', 'Print'), cat: 'operations' },
    { id: 'sec-zreport', label: tx(lang, 'Z-Hesabat Çek', 'Z-отчёт чек', 'Z-Report Receipt'), cat: 'operations' },
    { id: 'sec-interface', label: tx(lang, 'İnterfeys', 'Интерфейс', 'Interface'), cat: 'interface' },
    { id: 'sec-tables', label: tx(lang, 'Masalar', 'Столы', 'Tables'), cat: 'operations' },
    { id: 'sec-beverage', label: tx(lang, 'İçkilər', 'Напитки', 'Beverage'), cat: 'operations' },
    { id: 'sec-bankfee', label: tx(lang, 'Bank Faiz', 'Банк комиссии', 'Bank Fees'), cat: 'finance' },
    { id: 'sec-finance', label: tx(lang, 'Maliyyə', 'Финансы', 'Finance'), cat: 'finance' },
    { id: 'sec-yield', label: tx(lang, 'Yield', 'Yield', 'Yield'), cat: 'finance' },
    { id: 'sec-security', label: tx(lang, 'Təhlükəsizlik', 'Безопасность', 'Security'), cat: 'security' },
    { id: 'sec-staff', label: tx(lang, 'Staff', 'Персонал', 'Staff'), cat: 'security' },
    { id: 'sec-qr', label: tx(lang, 'QR & Feedback', 'QR & Отзывы', 'QR & Feedback'), cat: 'integrations' },
    { id: 'sec-feedback', label: tx(lang, 'Feedback Portal', 'Портал отзывов', 'Feedback Portal'), cat: 'integrations' },
    { id: 'sec-roles', label: tx(lang, 'Rollar', 'Роли', 'Roles'), cat: 'security' },
    { id: 'sec-password', label: tx(lang, 'Şifrə/2FA', 'Пароль/2FA', 'Password/2FA'), cat: 'security' },
    { id: 'sec-users', label: tx(lang, 'İstifadəçilər', 'Пользователи', 'Users'), cat: 'security' },
    { id: 'sec-danger', label: tx(lang, 'Təhlükəli', 'Опасные', 'Danger'), cat: 'security' },
    { id: 'sec-ai', label: tx(lang, 'AI & Resept', 'AI & Рецепты', 'AI & Recipes'), cat: 'ai' },
  ];

  const settingsCategories = [
    { id: 'all', icon: '📋', label: tx(lang, 'Hamısı', 'Все', 'All') },
    { id: 'general', icon: '🏢', label: tx(lang, 'Ümumi', 'Общее', 'General') },
    { id: 'operations', icon: '⚙️', label: tx(lang, 'Əməliyyat', 'Операции', 'Operations') },
    { id: 'finance', icon: '💰', label: tx(lang, 'Maliyyə', 'Финансы', 'Finance') },
    { id: 'integrations', icon: '🔗', label: tx(lang, 'İnteqrasiya', 'Интеграции', 'Integrations') },
    { id: 'ai', icon: '🤖', label: tx(lang, 'AI', 'AI', 'AI') },
    ...(['admin', 'super_admin'].includes(currentRole) ? [{ id: 'security', icon: '🔒', label: tx(lang, 'Təhlükəsizlik', 'Безопасность', 'Security') }] : []),
    { id: 'interface', icon: '🎨', label: tx(lang, 'İnterfeys', 'Интерфейс', 'Interface') },
  ];

  const [activeSettingsCategory, setActiveSettingsCategory] = useState('general');

  // Toggle section visibility via DOM when category changes
  useEffect(() => {
    const visibleIds = activeSettingsCategory === 'all'
      ? settingsSections.map((s) => s.id)
      : settingsSections.filter((s) => s.cat === activeSettingsCategory).map((s) => s.id);
    const visibleSet = new Set(visibleIds);
    settingsSections.forEach((sec) => {
      const el = document.getElementById(sec.id);
      if (el) el.style.display = visibleSet.has(sec.id) ? '' : 'none';
    });
  }, [activeSettingsCategory]);


  return (
    <div className="flex flex-col gap-4">
      {/* Category Tab Strip — mobile + desktop friendly */}
      <div className="sticky top-0 z-20 rounded-2xl border border-slate-700/60 bg-slate-950/80 backdrop-blur-xl p-2">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label={tx(lang, 'Ayarlar kateqoriyaları', 'Категории настроек', 'Settings categories')} style={{ scrollbarWidth: 'none' }}>
          {settingsCategories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={activeSettingsCategory === cat.id}
              onClick={() => setActiveSettingsCategory(cat.id)}
              className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition active:scale-95 ${
                activeSettingsCategory === cat.id
                  ? 'bg-cyan-400/20 border-2 border-cyan-400/50 text-cyan-100 shadow-md shadow-cyan-500/10'
                  : 'border-2 border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              <span className="text-base">{cat.icon}</span>
              <span className="hidden sm:inline">{cat.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-6">
      <div className="metal-panel overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-700/70 p-6">
          <SettingsIcon className="text-cyan-300" size={22} />
          <div>
            <h1 className="text-2xl font-black tracking-wide text-slate-100">{tx(lang, 'Ayarlar', 'Настройки', 'Settings')}</h1>
            <p className="text-xs text-slate-400">{tenantId}</p>
          </div>
        </div>
        {successMsg ? <div className="border-b border-emerald-400/20 bg-emerald-500/10 px-6 py-3 text-sm text-emerald-200">{successMsg}</div> : null}
      </div>

      <BusinessProfileSection
        lang={lang}
        profile={profile}
        setProfile={setProfile}
        handleLogoUpload={handleLogoUpload}
        saveBusinessProfile={saveBusinessProfile}
        renderPanelSuccess={renderPanelSuccess}
        saveButtonClass={saveButtonClass}
      />

      <EmailSettingsSection
        lang={lang}
        emailSettings={emailSettings}
        setEmailSettings={setEmailSettings}
        saveEmailSettings={saveEmailSettings}
        renderPanelSuccess={renderPanelSuccess}
        saveButtonClass={saveButtonClass}
      />

      <OperationSettingsSection
        lang={lang}
        saveButtonClass={saveButtonClass}
        renderPanelSuccess={renderPanelSuccess}
        notify={notify}
        printSettings={printSettings}
        setPrintSettings={setPrintSettings}
        savePrintSettings={savePrintSettings}
        systemPrinters={systemPrinters}
        customPrinterMode={customPrinterMode}
        setCustomPrinterMode={setCustomPrinterMode}
        testingPrint={testingPrint}
        handleTestPrint={handleTestPrint}
        checkPrintAgentStatus={checkPrintAgentStatus}
        printAgentHealth={printAgentHealth}
        printAgentVersion={printAgentVersion}
        printAgentMinVersion={printAgentMinVersion}
        qzHealth={qzHealth}
        qzPrintersCount={qzPrintersCount}
        printAgentModalOpen={printAgentModalOpen}
        setPrintAgentModalOpen={setPrintAgentModalOpen}
        downloadPrintAgentWindowsZip={downloadPrintAgentWindowsZip}
        downloadPrintAgentSetup={downloadPrintAgentSetup}
        zReportReceiptSettings={zReportReceiptSettings}
        setZReportReceiptSettings={setZReportReceiptSettings}
        saveZReportReceiptSettings={saveZReportReceiptSettings}
        tableServiceSettings={tableServiceSettings}
        setTableServiceSettings={setTableServiceSettings}
        saveTableServiceSettings={saveTableServiceSettings}
        beverageServiceSettings={beverageServiceSettings}
        setBeverageServiceSettings={setBeverageServiceSettings}
        saveBeverageServiceSettings={saveBeverageServiceSettings}
      />

      <IntegrationsSettingsSection
        lang={lang}
        saveButtonClass={saveButtonClass}
        renderPanelSuccess={renderPanelSuccess}
        notify={notify}
        tenantId={tenantId}
        profile={profile}
        deliveryIntegrations={deliveryIntegrations}
        setDeliveryIntegrations={setDeliveryIntegrations}
        saveDeliveryIntegrations={saveDeliveryIntegrations}
        deliveryMenuMappings={deliveryMenuMappings}
        deliveryMenuMappingsLoading={deliveryMenuMappingsLoading}
        newDeliveryMenuMapping={newDeliveryMenuMapping}
        setNewDeliveryMenuMapping={setNewDeliveryMenuMapping}
        handleAddDeliveryMenuMapping={handleAddDeliveryMenuMapping}
        handleDeleteDeliveryMenuMapping={handleDeleteDeliveryMenuMapping}
        menuCatalog={menuCatalog}
        qrMenuSettings={qrMenuSettings}
        setQrMenuSettings={setQrMenuSettings}
        saveQrMenuSettings={saveQrMenuSettings}
        handleQrHeroUpload={handleQrHeroUpload}
        handleQrPosterImageUpload={handleQrPosterImageUpload}
        handleThemePresetChange={handleThemePresetChange}
        feedbackSettings={feedbackSettings}
        setFeedbackSettings={setFeedbackSettings}
        saveFeedbackSettings={saveFeedbackSettings}
        autoFeedbackPortalUrl={autoFeedbackPortalUrl}
        newFeedbackTag={newFeedbackTag}
        setNewFeedbackTag={setNewFeedbackTag}
      />

      <FinanceSettingsSection
        lang={lang}
        saveButtonClass={saveButtonClass}
        renderPanelSuccess={renderPanelSuccess}
        bankCommission={bankCommission}
        setBankCommission={setBankCommission}
        saveBankCommission={saveBankCommission}
        financePolicy={financePolicy}
        setFinancePolicy={setFinancePolicy}
        saveFinancePolicy={saveFinancePolicy}
        yieldManagement={yieldManagement}
        setYieldManagement={setYieldManagement}
        saveYieldManagement={saveYieldManagement}
        inventoryCatalog={inventoryCatalog}
      />

      <InterfaceSettingsSection
        lang={lang}
        saveButtonClass={saveButtonClass}
        renderPanelSuccess={renderPanelSuccess}
        sessionSettings={sessionSettings}
        setSessionSettings={setSessionSettings}
        saveSessionSettings={saveSessionSettings}
        changeThemeMode={changeThemeMode}
        toggleVirtualKeyboard={toggleVirtualKeyboard}
        notify={notify}
        tenantId={tenantId}
        saveTablesUiMode={saveTablesUiMode}
      />

      {['admin', 'super_admin'].includes(currentRole) && (
        <SecuritySettingsSection
          lang={lang}
          saveButtonClass={saveButtonClass}
          renderPanelSuccess={renderPanelSuccess}
          notify={notify}
          currentRole={currentRole}
          sessionSettings={sessionSettings}
          setSessionSettings={setSessionSettings}
          saveSessionSettings={saveSessionSettings}
          staffBenefits={staffBenefits}
          setStaffBenefits={setStaffBenefits}
          saveStaffBenefits={saveStaffBenefits}
          menuCatalog={menuCatalog}
          roleModules={roleModules}
          setRoleModules={setRoleModules}
          saveRoleModules={saveRoleModules}
          users={users}
          newUserName={newUserName}
          setNewUserName={setNewUserName}
          newUserRole={newUserRole}
          setNewUserRole={setNewUserRole}
          newUserPassword={newUserPassword}
          setNewUserPassword={setNewUserPassword}
          newUserPin={newUserPin}
          setNewUserPin={setNewUserPin}
          handleCreateUser={handleCreateUser}
          handleDeleteUser={handleDeleteUser}
          deleteUserName={deleteUserName}
          setDeleteUserName={setDeleteUserName}
          targetUser={targetUser}
          setTargetUser={setTargetUser}
          targetPin={targetPin}
          setTargetPin={setTargetPin}
          handleUpdatePin={handleUpdatePin}
          targetPasswordUser={targetPasswordUser}
          setTargetPasswordUser={setTargetPasswordUser}
          targetPassword={targetPassword}
          setTargetPassword={setTargetPassword}
          handleUpdatePasswordForUser={handleUpdatePasswordForUser}
          currentPassword={currentPassword}
          setCurrentPassword={setCurrentPassword}
          newOwnPassword={newOwnPassword}
          setNewOwnPassword={setNewOwnPassword}
          confirmOwnPassword={confirmOwnPassword}
          setConfirmOwnPassword={setConfirmOwnPassword}
          handleChangeOwnPassword={handleChangeOwnPassword}
          totpEnabled={totpEnabled}
          totpSetupUrl={totpSetupUrl}
          totpSecret={totpSecret}
          totpQrDataUrl={totpQrDataUrl}
          totpCode={totpCode}
          setTotpCode={setTotpCode}
          totpDisablePassword={totpDisablePassword}
          setTotpDisablePassword={setTotpDisablePassword}
          totpDisableCode={totpDisableCode}
          setTotpDisableCode={setTotpDisableCode}
          handleStartTotpSetup={handleStartTotpSetup}
          handleVerifyTotp={handleVerifyTotp}
          handleDisableTotp={handleDisableTotp}
          resetModalOpen={resetModalOpen}
          setResetModalOpen={setResetModalOpen}
          handleResetSystem={handleResetSystem}
          resetPassword={resetPassword}
          setResetPassword={setResetPassword}
          resetTotpCode={resetTotpCode}
          setResetTotpCode={setResetTotpCode}
        />
      )}

      <AISettingsSection
        lang={lang}
        saveButtonClass={saveButtonClass}
        renderPanelSuccess={renderPanelSuccess}
        aiApiKey={aiApiKey}
        setAiApiKey={(value: string) => { setAiApiKey(value); writeScopedStorage('gemini_api_key', value); void update_api_key_live(value, {}); }}
        saveAiApiKey={saveAiApiKey}
        menuCatalog={menuCatalog}
        inventoryCatalog={inventoryCatalog}
      />
    </div>
    </div>
  );
}

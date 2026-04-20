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
  update_beverage_service_settings_live,
  update_finance_policy_live,
  update_feedback_settings_live,
  update_service_fee_live,
  update_session_settings_live,
  update_table_service_settings_live,
  update_yield_management_settings_live,
  update_business_profile_live,
  update_print_settings,
  update_qr_menu_settings_live,
  update_z_report_receipt_settings_live,
  update_qr_settings_live,
  update_role_modules_live,
  update_staff_benefits_live,
  update_user_credentials_live,
  verify_totp_live,
} from '../../api/settings';
import { get_menu_items_live } from '../../api/menu';
import { get_inventory_items_live } from '../../api/inventory';
import ConfirmModal from '../ConfirmModal';

type RoleModules = { staff: string[]; manager: string[]; kitchen: string[] };

const YIELD_PRESETS = {
  beef: {
    ratio: '1.4',
    min: '30',
    max: '40',
  },
  chicken: {
    ratio: '1.33',
    min: '25',
    max: '35',
  },
} as const;

const defaultRoleModules: RoleModules = {
  staff: ['pos', 'tables', 'kds', 'zreport'],
  manager: ['pos', 'tables', 'kds', 'zreport', 'finance', 'inventory', 'combos', 'analytics', 'logs', 'crm', 'customerapp', 'ai', 'menu', 'recipes'],
  kitchen: ['kds'],
};

const moduleCatalog = ['pos', 'tables', 'kds', 'zreport', 'finance', 'inventory', 'combos', 'analytics', 'logs', 'crm', 'customerapp', 'ai', 'menu', 'recipes'];

const roleLabelMap: Record<'staff' | 'manager' | 'kitchen', string> = {
  staff: 'Ofisiant / Kassir',
  manager: 'Menecer',
  kitchen: 'Mətbəx',
};

const moduleLabelMap: Record<string, string> = {
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
  const [sessionSettings, setSessionSettings] = useState({
    idle_logout_minutes: '0',
    virtual_keyboard_enabled: true,
    staff_pin_length: 6 as 4 | 6,
    theme_mode: 'dark' as 'dark' | 'light',
    ui_mode: 'old' as 'old',
  });
  const [beverageServiceSettings, setBeverageServiceSettings] = useState({
    coffee_selection_mode: 'size_and_service' as 'size_only' | 'size_and_service',
    remove_paper_packaging_for_table: true,
  });
  const [printSettings, setPrintSettings] = useState({
    use_qz: false,
    printer_name: '',
  });
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
    background_color: '#efe2c1',
    surface_color: '#fff7e8',
    text_color: '#2b1708',
    hero_image_url: '',
    poster_background_color: '#d59b2d',
    logo_shape: 'rounded' as 'rounded' | 'circle' | 'square',
  });
  const [feedbackSettings, setFeedbackSettings] = useState({
    enabled: false,
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
  });
  const autoFeedbackPortalUrl = React.useMemo(() => {
    const base = String(profile?.qr_base_url || profile?.website || '').trim() || window.location.origin;
    return `${base.replace(/\/+$/, '')}/feedback`;
  }, [profile?.qr_base_url, profile?.website]);
  const [qrMenuPosterDataUrl, setQrMenuPosterDataUrl] = useState('');
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
  });
  const [menuCatalog, setMenuCatalog] = useState<any[]>([]);
  const [inventoryCatalog, setInventoryCatalog] = useState<any[]>([]);
  const [yieldInventoryCandidate, setYieldInventoryCandidate] = useState('');
  const [yieldInventorySearch, setYieldInventorySearch] = useState('');

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
  const [totpCode, setTotpCode] = useState('');
  const [totpDisablePassword, setTotpDisablePassword] = useState('');
  const [totpDisableCode, setTotpDisableCode] = useState('');
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const [resetTotpCode, setResetTotpCode] = useState('');

  const suggestedYieldItems = inventoryCatalog.filter((item: any) => {
    const hay = `${String(item?.name || '')} ${String(item?.category || '')}`.toLowerCase();
    return (
      hay.includes('dönər') ||
      hay.includes('doner') ||
      hay.includes('dana') ||
      hay.includes('mal ') ||
      hay.includes('mal əti') ||
      hay.includes('toyuq') ||
      hay.includes('chicken')
    );
  });
  const preferredYieldInventory = inventoryCatalog.filter((item: any) => {
    const hay = `${String(item?.name || '')} ${String(item?.category || '')}`.toLowerCase();
    return (
      hay.includes('dönər') ||
      hay.includes('doner') ||
      hay.includes('ət') ||
      hay.includes('et') ||
      hay.includes('dana') ||
      hay.includes('mal ') ||
      hay.includes('mal əti') ||
      hay.includes('toyuq') ||
      hay.includes('chicken') ||
      hay.includes('shawarma') ||
      hay.includes('gyro') ||
      hay.includes('kebab')
    );
  });
  const remainingYieldInventory = inventoryCatalog.filter(
    (item: any) => !preferredYieldInventory.some((preferred: any) => preferred.id === item.id || preferred.name === item.name),
  );
  const selectableYieldInventory = [...preferredYieldInventory, ...remainingYieldInventory].filter(
    (item: any) => !yieldManagement.tracked_items.some((row) => row.inventory_name === item.name),
  );
  const normalizedYieldInventorySearch = String(yieldInventorySearch || '').trim().toLowerCase();
  const filteredYieldInventory = selectableYieldInventory.filter((item: any) => {
    if (!normalizedYieldInventorySearch) return true;
    const hay = `${String(item?.name || '')} ${String(item?.category || '')}`.toLowerCase();
    return hay.includes(normalizedYieldInventorySearch);
  });

  const requiresPasswordForNewUser = ['admin', 'manager'].includes(newUserRole);
  const configuredStaffPinLength = sessionSettings.staff_pin_length === 4 ? 4 : 6;
  const passwordPolicyText = tx(
    lang,
    'Şifrə ən azı 10 simvol, böyük/kiçik hərf, rəqəm və simvol ehtiva etməlidir.',
    'Пароль должен быть минимум 10 символов и содержать заглавную/строчную букву, цифру и символ.',
    'Password must be at least 10 characters and include upper/lowercase, number and symbol.',
  );
  const isStrongPassword = (value: string) => value.length >= 10 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
  const pinUsers = users.filter((u) => ['staff', 'kitchen'].includes(String(u.role || '').toLowerCase()));
  const passwordUsers = users.filter((u) => ['admin', 'manager', 'super_admin'].includes(String(u.role || '').toLowerCase()));
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
      setSessionSettings({
        idle_logout_minutes: String(settingsRes.value.session_settings?.idle_logout_minutes ?? 0),
        virtual_keyboard_enabled: settingsRes.value.session_settings?.virtual_keyboard_enabled !== false,
        staff_pin_length: Number(settingsRes.value.session_settings?.staff_pin_length || 6) === 4 ? 4 : 6,
        theme_mode: settingsRes.value.session_settings?.theme_mode === 'light' ? 'light' : 'dark',
        ui_mode: 'old',
      });
      setBeverageServiceSettings({
        coffee_selection_mode: settingsRes.value.beverage_service_settings?.coffee_selection_mode === 'size_only' ? 'size_only' : 'size_and_service',
        remove_paper_packaging_for_table: settingsRes.value.beverage_service_settings?.remove_paper_packaging_for_table !== false,
      });
      setPrintSettings({
        use_qz: Boolean(settingsRes.value.print_settings?.use_qz),
        printer_name: String(settingsRes.value.print_settings?.printer_name || ''),
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
        background_color: String(settingsRes.value.qr_menu_settings?.background_color || '#efe2c1'),
        surface_color: String(settingsRes.value.qr_menu_settings?.surface_color || '#fff7e8'),
        text_color: String(settingsRes.value.qr_menu_settings?.text_color || '#2b1708'),
        hero_image_url: String(settingsRes.value.qr_menu_settings?.hero_image_url || ''),
        poster_background_color: String(settingsRes.value.qr_menu_settings?.poster_background_color || '#d59b2d'),
        logo_shape: (String(settingsRes.value.qr_menu_settings?.logo_shape || 'rounded') as any),
      });
      setFeedbackSettings({
        enabled: settingsRes.value.feedback_settings?.enabled === true,
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
      });
    }
  };

  useEffect(() => {
    void loadData();
  }, [tenantId, user?.username]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const baseUrl = String(profile?.qr_base_url || '').trim() || window.location.origin;
        const menuUrl = `${baseUrl.replace(/\/+$/, '')}/menu`;
        const qrDataUrl = await QRCode.toDataURL(menuUrl, { margin: 1, width: 220 });
        const canvas = document.createElement('canvas');
        canvas.width = 900;
        canvas.height = 1200;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = String(qrMenuSettings.background_color || '#efe2c1');
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = String(qrMenuSettings.text_color || '#2b1708');
        ctx.textAlign = 'center';
        ctx.font = 'bold 56px Arial';
        ctx.fillText(String(qrMenuSettings.poster_title || 'Menyuya baxmaq üçün skan et'), canvas.width / 2, 120);
        ctx.font = '28px Arial';
        ctx.fillStyle = String(qrMenuSettings.text_color || '#2b1708');
        ctx.fillText(String(qrMenuSettings.poster_subtitle || 'Telefon kameranızı QR üzərinə yönəldin'), canvas.width / 2, 170);
        if (profile?.company_name) {
          ctx.font = 'bold 36px Arial';
          ctx.fillStyle = String(qrMenuSettings.poster_background_color || '#d59b2d');
          ctx.fillText(String(profile.company_name), canvas.width / 2, 240);
        }
        const qrImage = new Image();
        qrImage.onload = () => {
          ctx.fillStyle = String(qrMenuSettings.surface_color || '#fff7e8');
          ctx.fillRect(190, 300, 520, 520);
          ctx.drawImage(qrImage, 220, 330, 460, 460);
          ctx.font = '24px Arial';
          ctx.fillStyle = String(qrMenuSettings.text_color || '#2b1708');
          ctx.fillText(menuUrl.replace(/^https?:\/\//, ''), canvas.width / 2, 910);
          const posterUrl = canvas.toDataURL('image/png');
          if (!cancelled) setQrMenuPosterDataUrl(posterUrl);
        };
        qrImage.src = qrDataUrl;
      } catch {
        if (!cancelled) setQrMenuPosterDataUrl('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.company_name, profile?.qr_base_url, qrMenuSettings.poster_title, qrMenuSettings.poster_subtitle, qrMenuSettings.background_color, qrMenuSettings.surface_color, qrMenuSettings.text_color, qrMenuSettings.poster_background_color]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    const reader = new FileReader();
    reader.onload = () => setProfile((prev: any) => ({ ...(prev || {}), logo_url: reader.result as string }));
    reader.readAsDataURL(file);
  };

  const handleQrHeroUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setQrMenuSettings((prev) => ({ ...prev, hero_image_url: String(reader.result || '') }));
    reader.readAsDataURL(file);
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
    try {
      await update_session_settings_live({
        idle_logout_minutes: Math.max(0, Number(sessionSettings.idle_logout_minutes || 0)),
        virtual_keyboard_enabled: sessionSettings.virtual_keyboard_enabled,
        staff_pin_length: sessionSettings.staff_pin_length,
        theme_mode: nextMode,
        ui_mode: 'old',
      });
      window.dispatchEvent(new CustomEvent('settings-updated', { detail: { tenant_id: tenantId } }));
      flashSuccess(
        nextMode === 'light'
          ? tx(lang, 'Light rejim aktiv edildi', 'Светлая тема включена', 'Light mode enabled')
          : tx(lang, 'Dark rejim aktiv edildi', 'Тёмная тема включена', 'Dark mode enabled'),
      );
    } catch (e: any) {
      setSessionSettings((prev) => ({ ...prev, theme_mode: previous }));
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

  const toggleRoleModule = (role: keyof RoleModules, moduleKey: string) => {
    setRoleModules((prev) => {
      const current = prev[role] || [];
      const next = current.includes(moduleKey)
        ? current.filter((item) => item !== moduleKey)
        : [...current, moduleKey];
      return { ...prev, [role]: next };
    });
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

  const savePrintSettings = () => {
    update_print_settings({
      use_qz: printSettings.use_qz,
      printer_name: printSettings.printer_name.trim(),
    });
    flashSuccess(tx(lang, 'Çap ayarları yadda saxlanıldı', 'Настройки печати сохранены', 'Print settings saved'), 'print');
  };

  const saveZReportReceiptSettings = async () => {
    await update_z_report_receipt_settings_live(zReportReceiptSettings);
    flashSuccess(tx(lang, 'Z-Hesabat çek ayarları yadda saxlanıldı', 'Настройки чека Z-отчёта сохранены', 'Z-report receipt settings saved'), 'zreport_receipt');
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
      hero_image_url: qrMenuSettings.hero_image_url,
      poster_background_color: qrMenuSettings.poster_background_color,
      logo_shape: qrMenuSettings.logo_shape,
    });
    flashSuccess(tx(lang, 'QR Menu ayarları yadda saxlanıldı', 'Настройки QR Menu сохранены', 'QR Menu settings saved'), 'qr_menu');
  };

  const saveFeedbackSettings = async () => {
    const resolvedPortalUrl = String(feedbackSettings.portal_url || '').trim() || autoFeedbackPortalUrl;
    await update_feedback_settings_live({
      enabled: feedbackSettings.enabled,
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
    });
    setFeedbackSettings((prev) => ({ ...prev, portal_url: resolvedPortalUrl }));
    window.dispatchEvent(new CustomEvent('settings-updated', { detail: { tenant_id: tenantId } }));
    flashSuccess(tx(lang, 'Feedback portal ayarları yadda saxlanıldı', 'Настройки feedback портала сохранены', 'Feedback portal settings saved'), 'feedback');
  };

  const downloadQrPoster = () => {
    if (!qrMenuPosterDataUrl) return;
    const link = document.createElement('a');
    link.href = qrMenuPosterDataUrl;
    link.download = `qr-menu-poster-${tenantId}.png`;
    link.click();
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

  const applyYieldPreset = (meatType: 'beef' | 'chicken') => {
    const preset = YIELD_PRESETS[meatType];
    setYieldManagement((prev) => ({
      ...prev,
      ...(meatType === 'beef'
        ? {
            beef_ratio: preset.ratio,
            beef_loss_min_percent: preset.min,
            beef_loss_max_percent: preset.max,
          }
        : {
            chicken_ratio: preset.ratio,
            chicken_loss_min_percent: preset.min,
            chicken_loss_max_percent: preset.max,
          }),
      tracked_items: prev.tracked_items.map((row) =>
        row.meat_type === meatType
          ? { ...row, raw_to_ready_ratio: preset.ratio }
          : row,
      ),
    }));
  };

  const applySmartYieldSuggestion = (inventoryName: string) => {
    const hay = String(inventoryName || '').toLowerCase();
    const meatType: 'beef' | 'chicken' =
      hay.includes('toyuq') || hay.includes('chicken') ? 'chicken' : 'beef';
    const ratio = meatType === 'chicken' ? yieldManagement.chicken_ratio || YIELD_PRESETS.chicken.ratio : yieldManagement.beef_ratio || YIELD_PRESETS.beef.ratio;
    setYieldManagement((prev) => {
      const existing = prev.tracked_items.find((row) => row.inventory_name === inventoryName);
      if (existing) {
        return {
          ...prev,
          tracked_items: prev.tracked_items.map((row) =>
            row.inventory_name === inventoryName
              ? { ...row, enabled: true, meat_type: meatType, raw_to_ready_ratio: ratio }
              : row,
          ),
        };
      }
      return {
        ...prev,
        tracked_items: [
          ...prev.tracked_items,
          {
            inventory_name: inventoryName,
            enabled: true,
            meat_type: meatType,
            raw_to_ready_ratio: ratio,
          },
        ],
      };
    });
  };

  const addYieldTrackedInventory = () => {
    const inventoryName = String(yieldInventoryCandidate || '').trim();
    if (!inventoryName) return;
    applySmartYieldSuggestion(inventoryName);
    setYieldInventoryCandidate('');
  };

  const removeYieldTrackedInventory = (inventoryName: string) => {
    setYieldManagement((prev) => ({
      ...prev,
      tracked_items: prev.tracked_items.filter((row) => row.inventory_name !== inventoryName),
    }));
  };


  const saveStaffBenefits = async () => {
    await update_staff_benefits_live({
      daily_limit_azn: Number(staffBenefits.daily_limit_azn || 0),
      allowed_scope: staffBenefits.allowed_scope,
      included_categories: staffBenefits.included_categories,
      included_items: staffBenefits.included_items,
      item_unit_cap_azn: Number(staffBenefits.item_unit_cap_azn || 0),
    });
    flashSuccess(tx(lang, 'Staff limit ayarları yadda saxlanıldı', 'Настройки лимита staff сохранены', 'Staff benefit settings saved'), 'staff_benefits');
  };

  return (
    <div className="space-y-6">
      {resetModalOpen ? (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-4">
          <div className="metal-panel w-full max-w-md p-5">
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Bütün sistemi sıfırla', 'Сбросить всю систему', 'Reset entire system')}</h3>
            <p className="mt-2 text-sm text-slate-300">
              {tx(
                lang,
                'Cari tenantın bütün iş datası silinəcək. Davam etmək üçün admin şifrəsini yazın.',
                'Рабочие данные текущего tenant будут удалены. Для продолжения введите пароль администратора.',
                'The current tenant operational data will be deleted. Enter the admin password to continue.',
              )}
            </p>
            <div className="mt-4 space-y-3">
              <input
                className="neon-input"
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder={tx(lang, 'Admin şifrəsi', 'Пароль администратора', 'Admin password')}
              />
              {totpEnabled ? (
                <input
                  className="neon-input"
                  value={resetTotpCode}
                  onChange={(e) => setResetTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder={tx(lang, '2FA kodu', 'Код 2FA', '2FA code')}
                />
              ) : null}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setResetModalOpen(false);
                  setResetPassword('');
                  setResetTotpCode('');
                }}
                className="neon-btn rounded-lg px-4 py-2"
              >
                {tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
              </button>
              <button onClick={() => { void handleResetSystem(); }} className="rounded-lg border border-red-400/50 px-4 py-2 font-semibold text-red-200 hover:bg-red-500/10">
                {tx(lang, 'Sıfırla', 'Сбросить', 'Reset')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Biznes Profili', 'Профиль бизнеса', 'Business Profile')}</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Şirkət adı', 'Название компании', 'Company name')}</label>
            <input className="neon-input" value={profile?.company_name || ''} onChange={(e) => setProfile((prev: any) => ({ ...(prev || {}), company_name: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Telefon', 'Телефон', 'Phone')}</label>
            <input className="neon-input" value={profile?.phone || ''} onChange={(e) => setProfile((prev: any) => ({ ...(prev || {}), phone: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Ünvan', 'Адрес', 'Address')}</label>
            <input className="neon-input" value={profile?.address || ''} onChange={(e) => setProfile((prev: any) => ({ ...(prev || {}), address: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Website', 'Сайт', 'Website')}</label>
            <input className="neon-input" value={profile?.website || ''} onChange={(e) => setProfile((prev: any) => ({ ...(prev || {}), website: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'QR Base URL', 'QR Base URL', 'QR Base URL')}</label>
            <input className="neon-input" value={profile?.qr_base_url || ''} onChange={(e) => setProfile((prev: any) => ({ ...(prev || {}), qr_base_url: e.target.value }))} />
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Qəbz alt mətni', 'Текст внизу чека', 'Receipt footer')}</label>
            <input className="neon-input" value={profile?.receipt_footer || ''} onChange={(e) => setProfile((prev: any) => ({ ...(prev || {}), receipt_footer: e.target.value }))} />
          </div>
          <input className="neon-input md:col-span-2" type="file" accept="image/*" onChange={handleLogoUpload} />
        </div>
        {renderPanelSuccess('business_profile')}
        <div className="flex justify-end">
          <button onClick={() => { void saveBusinessProfile(); }} className={saveButtonClass}>{tx(lang, 'Saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Email və Resend', 'Email и Resend', 'Email and Resend')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Browserdən birbaşa API key göstərmək əvəzinə email-lər backend üzərindən göndərilir.',
            'Письма отправляются через backend, чтобы не раскрывать API key в браузере.',
            'Emails are sent through the backend so the API key is not exposed in the browser.',
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={emailSettings.enabled} onChange={(e) => setEmailSettings((prev) => ({ ...prev, enabled: e.target.checked }))} />
            <span>{tx(lang, 'Email göndərimini aktiv et', 'Включить отправку email', 'Enable email sending')}</span>
          </label>
          <select className="neon-input" value={emailSettings.provider} onChange={(e) => setEmailSettings((prev) => ({ ...prev, provider: e.target.value }))}>
            <option value="none">{tx(lang, 'Provayder seçin', 'Выберите провайдера', 'Select provider')}</option>
            <option value="resend">Resend</option>
            <option value="webhook">{tx(lang, 'Webhook', 'Webhook', 'Webhook')}</option>
          </select>
          <input className="neon-input" value={emailSettings.sender_email} onChange={(e) => setEmailSettings((prev) => ({ ...prev, sender_email: e.target.value }))} placeholder={tx(lang, 'Göndərən email', 'Email отправителя', 'Sender email')} />
          <input className="neon-input" value={emailSettings.recipient_emails} onChange={(e) => setEmailSettings((prev) => ({ ...prev, recipient_emails: e.target.value }))} placeholder={tx(lang, 'Default alıcılar (vergüllə)', 'Получатели по умолчанию (через запятую)', 'Default recipients (comma separated)')} />
          {emailSettings.provider === 'resend' ? (
            <input className="neon-input md:col-span-2" value={emailSettings.resend_api_key} onChange={(e) => setEmailSettings((prev) => ({ ...prev, resend_api_key: e.target.value }))} placeholder="re_..." />
          ) : null}
          {emailSettings.provider === 'webhook' ? (
            <input className="neon-input md:col-span-2" value={emailSettings.webhook_url} onChange={(e) => setEmailSettings((prev) => ({ ...prev, webhook_url: e.target.value }))} placeholder={tx(lang, 'Webhook URL', 'Webhook URL', 'Webhook URL')} />
          ) : null}
          <input className="neon-input" type="number" min={5} value={emailSettings.timeout_sec} onChange={(e) => setEmailSettings((prev) => ({ ...prev, timeout_sec: e.target.value }))} placeholder={tx(lang, 'Timeout (san)', 'Timeout (сек)', 'Timeout (sec)')} />
        </div>
        {renderPanelSuccess('email')}
        <div className="flex justify-end">
          <button onClick={() => { void saveEmailSettings(); }} className={saveButtonClass}>{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Çap Ayarları', 'Настройки печати', 'Print Settings')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Brauzerin print pəncərəsini səssiz keçməyin ən praktik yolu QZ Tray-dir. Bu aktiv olanda POS, masa çeki və Z-report birbaşa printerə göndərilir.',
            'Самый практичный способ обойти окно печати браузера — QZ Tray. Когда он активен, POS, чеки столов и Z-отчет отправляются прямо на принтер.',
            'The most practical way to bypass the browser print dialog is QZ Tray. When enabled, POS, table receipts, and Z-report go directly to the printer.',
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={printSettings.use_qz} onChange={(e) => setPrintSettings((prev) => ({ ...prev, use_qz: e.target.checked }))} />
            <span>{tx(lang, 'QZ Tray ilə birbaşa çap et', 'Печатать напрямую через QZ Tray', 'Direct print via QZ Tray')}</span>
          </label>
          <input
            className="neon-input"
            value={printSettings.printer_name}
            onChange={(e) => setPrintSettings((prev) => ({ ...prev, printer_name: e.target.value }))}
            placeholder={tx(lang, 'Printer adı (opsional)', 'Имя принтера (необязательно)', 'Printer name (optional)')}
          />
        </div>
        <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 text-xs text-slate-300">
          {tx(
            lang,
            'Qeyd: QZ Tray quraşdırılmayıbsa, sistem yenə brauzer print pəncərəsinə düşəcək. Safari-də səssiz çap praktik deyil; Chrome/Edge + QZ daha uyğundur.',
            'Примечание: если QZ Tray не установлен, система вернется к окну печати браузера. Для тихой печати лучше Chrome/Edge + QZ.',
            'Note: if QZ Tray is not installed, the system falls back to the browser print dialog. For silent printing, Chrome/Edge + QZ is the practical setup.',
          )}
        </div>
        {renderPanelSuccess('print')}
        <div className="flex justify-end">
          <button onClick={savePrintSettings} className={saveButtonClass}>{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Z-Hesabat Çek Ayarları', 'Настройки чека Z-отчёта', 'Z-report receipt settings')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Admin buradan Z-Hesabat çekində hansı hissələrin görünəcəyini seçə bilər. Maaş, xərclər, giriş pulları, depozit və kassir breakdown-u checkbox ilə idarə olunur.',
            'Здесь администратор выбирает, какие секции будут показаны в чеке Z-отчёта. Зарплата, расходы, поступления, депозиты и разбивка по кассирам управляются чекбоксами.',
            'Choose which sections appear on the Z-report receipt. Wage, expenses, inflows, deposits, and cashier breakdown are controlled here.',
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {[
            ['show_operator', tx(lang, 'Operator görünsün', 'Показывать оператора', 'Show operator')],
            ['show_date_range', tx(lang, 'Tarix aralığı görünsün', 'Показывать диапазон дат', 'Show date range')],
            ['show_sales_summary', tx(lang, 'Satış xülasəsi görünsün', 'Показывать сводку продаж', 'Show sales summary')],
            ['show_profit_summary', tx(lang, 'Maya və mənfəət görünsün', 'Показывать себестоимость и прибыль', 'Show COGS and profit')],
            ['show_wage', tx(lang, 'Maaş çıxışı görünsün', 'Показывать списание зарплаты', 'Show wage deduction')],
            ['show_shift_cash', tx(lang, 'Açılış və bağlanış kassası görünsün', 'Показывать открытие и закрытие кассы', 'Show opening and closing cash')],
            ['show_cash_movements', tx(lang, 'Kassa giriş/çıxışları görünsün', 'Показывать движения по кассе', 'Show cash movements')],
            ['show_other_income', tx(lang, 'Digər giriş pulları görünsün', 'Показывать прочие поступления', 'Show other income')],
            ['show_other_expense', tx(lang, 'Digər xərclər görünsün', 'Показывать прочие расходы', 'Show other expenses')],
            ['show_deposit_summary', tx(lang, 'Depozit xülasəsi görünsün', 'Показывать сводку депозитов', 'Show deposit summary')],
            ['show_cashier_breakdown', tx(lang, 'Kassir breakdown-u görünsün', 'Показывать разбивку по кассирам', 'Show cashier breakdown')],
            ['show_counts', tx(lang, 'Satış və void sayları görünsün', 'Показывать количество продаж и void', 'Show sales and void counts')],
          ].map(([key, label]) => (
            <label key={String(key)} className="flex items-center gap-3 rounded-2xl border border-slate-700/60 bg-slate-950/35 px-4 py-3 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={Boolean((zReportReceiptSettings as any)[key])}
                onChange={(e) => setZReportReceiptSettings((prev) => ({ ...prev, [key]: e.target.checked }))}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        {renderPanelSuccess('zreport_receipt')}
        <div className="flex justify-end">
          <button onClick={() => { void saveZReportReceiptSettings(); }} className={saveButtonClass}>{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'QR menyu ayarları', 'QR Menu Settings', 'QR Menu Settings')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Müştərilər QR skan edib login olmadan public menyunu görə bilərlər. Buradan başlıq, poster və görünəcək məlumatları idarə edin.',
            'Клиенты могут открыть публичное меню по QR без логина. Здесь управляются заголовки, постер и видимые поля.',
            'Customers can open the public menu via QR without logging in. Manage title, poster, and visible fields here.',
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
            <input type="checkbox" checked={qrMenuSettings.enabled} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, enabled: e.target.checked }))} />
            <span>{tx(lang, 'İctimai QR menyu aktiv olsun', 'Публичное QR меню активно', 'Enable public QR Menu')}</span>
          </label>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Başlıq', 'Заголовок', 'Hero title')}</label>
            <input className="neon-input" value={qrMenuSettings.hero_title} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, hero_title: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Alt başlıq', 'Подзаголовок', 'Hero subtitle')}</label>
            <input className="neon-input" value={qrMenuSettings.hero_subtitle} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, hero_subtitle: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Poster başlığı', 'Заголовок постера', 'Poster title')}</label>
            <input className="neon-input" value={qrMenuSettings.poster_title} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, poster_title: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Poster alt mətni', 'Подзаголовок постера', 'Poster subtitle')}</label>
            <input className="neon-input" value={qrMenuSettings.poster_subtitle} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, poster_subtitle: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Arxa fon rəngi', 'Цвет фона', 'Background color')}</label>
            <input className="neon-input h-12" type="color" value={qrMenuSettings.background_color} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, background_color: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Kart fonu', 'Цвет карточек', 'Surface color')}</label>
            <input className="neon-input h-12" type="color" value={qrMenuSettings.surface_color} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, surface_color: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Yazı rəngi', 'Цвет текста', 'Text color')}</label>
            <input className="neon-input h-12" type="color" value={qrMenuSettings.text_color} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, text_color: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Poster vurğu rəngi', 'Акцент постера', 'Poster accent color')}</label>
            <input className="neon-input h-12" type="color" value={qrMenuSettings.poster_background_color} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, poster_background_color: e.target.value }))} />
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Hero şəkil linki', 'Ссылка hero-изображения', 'Hero image URL')}</label>
            <input className="neon-input" value={qrMenuSettings.hero_image_url} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, hero_image_url: e.target.value }))} />
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Hero şəkil yüklə', 'Загрузить hero-изображение', 'Upload hero image')}</label>
            <input className="neon-input" type="file" accept="image/*" onChange={handleQrHeroUpload} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Logo forması', 'Форма логотипа', 'Logo shape')}</label>
            <select className="neon-input" value={qrMenuSettings.logo_shape} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, logo_shape: e.target.value as any }))}>
              <option value="rounded">{tx(lang, 'Yumru künc', 'Скругленный', 'Rounded')}</option>
              <option value="circle">{tx(lang, 'Dairəvi', 'Круглый', 'Circle')}</option>
              <option value="square">{tx(lang, 'Kvadrat', 'Квадратный', 'Square')}</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={qrMenuSettings.show_prices} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, show_prices: e.target.checked }))} />
            <span>{tx(lang, 'Qiymətləri göstər', 'Показывать цены', 'Show prices')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={qrMenuSettings.show_images} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, show_images: e.target.checked }))} />
            <span>{tx(lang, 'Şəkilləri göstər', 'Показывать фото', 'Show images')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
            <input type="checkbox" checked={qrMenuSettings.show_descriptions} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, show_descriptions: e.target.checked }))} />
            <span>{tx(lang, 'Təsvirləri göstər', 'Показывать описания', 'Show descriptions')}</span>
          </label>
        </div>
        <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 text-sm text-slate-300">
          <div className="font-semibold text-slate-100">{tx(lang, 'QR Menu linki', 'Ссылка QR Menu', 'QR Menu link')}</div>
          <div className="mt-2 break-all text-cyan-300">{`${String(profile?.qr_base_url || '').trim() || window.location.origin}`.replace(/\/+$/, '')}/menu</div>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-slate-700/60 bg-slate-950/30 p-5">
            <div className="text-sm font-semibold text-slate-100">{tx(lang, 'Poster preview', 'Превью постера', 'Poster preview')}</div>
            {qrMenuPosterDataUrl ? (
              <img src={qrMenuPosterDataUrl} alt="QR Menu poster" className="mx-auto mt-4 w-full max-w-xs rounded-2xl ring-1 ring-white/10" />
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-700/60 p-8 text-center text-slate-400">
                {tx(lang, 'Poster hazırlanır...', 'Постер готовится...', 'Poster is being prepared...')}
              </div>
            )}
          </div>
          <div className="rounded-3xl border border-slate-700/60 bg-slate-950/30 p-5 text-sm text-slate-300">
            <div className="font-semibold text-slate-100">{tx(lang, 'Public menyuda nələr görünəcək', 'Что будет видно в публичном меню', 'What will be visible in public menu')}</div>
            <ul className="mt-4 space-y-2">
              <li>{tx(lang, 'Tenant logo və rəngləri', 'Логотип и цвета tenant', 'Tenant logo and colors')}</li>
              <li>{tx(lang, 'Kateqoriya filtri və axtarış', 'Фильтр категорий и поиск', 'Category filter and search')}</li>
              <li>{tx(lang, 'Məhsul şəkli', 'Фото товара', 'Product image')}: {qrMenuSettings.show_images ? tx(lang, 'aktiv', 'вкл', 'on') : tx(lang, 'söndürülüb', 'выкл', 'off')}</li>
              <li>{tx(lang, 'Məhsul təsviri', 'Описание товара', 'Product description')}: {qrMenuSettings.show_descriptions ? tx(lang, 'aktiv', 'вкл', 'on') : tx(lang, 'söndürülüb', 'выкл', 'off')}</li>
              <li>{tx(lang, 'Qiymət', 'Цена', 'Price')}: {qrMenuSettings.show_prices ? tx(lang, 'aktiv', 'вкл', 'on') : tx(lang, 'söndürülüb', 'выкл', 'off')}</li>
            </ul>
          </div>
        </div>
        {renderPanelSuccess('qr_menu')}
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={downloadQrPoster} className="neon-btn rounded-xl px-5 py-2 font-semibold">
            {tx(lang, 'Poster yüklə', 'Скачать постер', 'Download poster')}
          </button>
          <button onClick={() => { void saveQrMenuSettings(); }} className={saveButtonClass}>
            {tx(lang, 'QR Menu ayarlarını saxla', 'Сохранить QR Menu', 'Save QR Menu settings')}
          </button>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Müştəri Feedback Portalı', 'Портал отзывов клиентов', 'Customer feedback portal')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Çek və QR üzərindən müştəri rəyinə yönləndirmə üçün portal linklərini buradan idarə edin. Bu pəncərə Landing Studio-dan ayrıca işləyir.',
            'Управляйте ссылками для отзывов с чека и QR отсюда. Это отдельное окно, не связано с Landing Studio.',
            'Manage customer feedback links from receipt/QR here. This panel is separate from Landing Studio.',
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
            <input
              type="checkbox"
              checked={feedbackSettings.enabled}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, enabled: e.target.checked }))}
            />
            <span>{tx(lang, 'Feedback portalını aktiv et', 'Включить feedback портал', 'Enable feedback portal')}</span>
          </label>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Feedback portal URL', 'URL feedback портала', 'Feedback portal URL')}</label>
            <input
              className="neon-input"
              value={feedbackSettings.portal_url}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, portal_url: e.target.value }))}
              placeholder={autoFeedbackPortalUrl}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <span>{tx(lang, 'Tövsiyə olunan daxili link', 'Рекомендуемая внутренняя ссылка', 'Recommended internal link')}: {autoFeedbackPortalUrl}</span>
              <button
                type="button"
                onClick={() => setFeedbackSettings((prev) => ({ ...prev, portal_url: autoFeedbackPortalUrl }))}
                className="neon-btn rounded-lg px-3 py-1 text-xs"
              >
                {tx(lang, 'Auto doldur', 'Автозаполнить', 'Auto fill')}
              </button>
            </div>
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Google review URL', 'URL Google review', 'Google review URL')}</label>
            <input
              className="neon-input"
              value={feedbackSettings.google_review_url}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, google_review_url: e.target.value }))}
              placeholder="https://g.page/r/..."
            />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Feedback kuponu endirim %', 'Скидка купона feedback %', 'Feedback coupon discount %')}</label>
            <input
              className="neon-input"
              type="number"
              min={1}
              max={100}
              value={feedbackSettings.coupon_percent}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, coupon_percent: Number(e.target.value || 5) }))}
            />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Çek düyməsi mətni (AZ)', 'Текст кнопки на чеке (AZ)', 'Receipt button text (AZ)')}</label>
            <input
              className="neon-input"
              value={feedbackSettings.receipt_button_text_az}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, receipt_button_text_az: e.target.value }))}
            />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Çek düyməsi mətni (RU)', 'Текст кнопки на чеке (RU)', 'Receipt button text (RU)')}</label>
            <input
              className="neon-input"
              value={feedbackSettings.receipt_button_text_ru}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, receipt_button_text_ru: e.target.value }))}
            />
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Çek düyməsi mətni (EN)', 'Текст кнопки на чеке (EN)', 'Receipt button text (EN)')}</label>
            <input
              className="neon-input"
              value={feedbackSettings.receipt_button_text_en}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, receipt_button_text_en: e.target.value }))}
            />
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Çek QR mesajı (AZ)', 'Текст QR на чеке (AZ)', 'Receipt QR message (AZ)')}</label>
            <textarea
              className="neon-input min-h-[90px]"
              value={feedbackSettings.receipt_qr_prompt_az}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, receipt_qr_prompt_az: e.target.value }))}
            />
          </div>
        </div>
        {renderPanelSuccess('feedback')}
        <div className="flex justify-end">
          <button onClick={() => { void saveFeedbackSettings(); }} className={saveButtonClass}>
            {tx(lang, 'Feedback ayarlarını saxla', 'Сохранить feedback настройки', 'Save feedback settings')}
          </button>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Masa Xidməti Ayarları', 'Настройки обслуживания столов', 'Table Service Settings')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Masada xidmət üçün servis haqqını və nəfər başı depozit məbləğini buradan təyin edin. Depozit masa açılarkən kassaya daxil olur və hesab bağlananda yekun məbləğin içinə sayılır.',
            'Здесь задаются сервисный сбор и депозит с человека для обслуживания за столом. Депозит сразу входит в кассу и затем учитывается при закрытии счета.',
            'Configure table-service fee and per-guest deposit here. The deposit is recorded when the table opens and counted into the final bill on checkout.',
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Servis haqqı (%)', 'Сервисный сбор (%)', 'Service fee (%)')}</label>
            <input
              className="neon-input"
              type="number"
              min={0}
              step="0.01"
              value={tableServiceSettings.service_fee_percent}
              onChange={(e) => setTableServiceSettings((prev) => ({ ...prev, service_fee_percent: e.target.value }))}
            />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Nəfər başı depozit (AZN)', 'Депозит с человека (AZN)', 'Deposit per guest (AZN')}</label>
            <input
              className="neon-input"
              type="number"
              min={0}
              step="0.01"
              value={tableServiceSettings.deposit_per_guest_azn}
              onChange={(e) => setTableServiceSettings((prev) => ({ ...prev, deposit_per_guest_azn: e.target.value }))}
            />
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Rezervə bağlama pəncərəsi (saat)', 'Окно блокировки резерва (часы)', 'Reservation lock window (hours)')}</label>
            <input
              className="neon-input"
              type="number"
              min={0}
              step="0.5"
              value={tableServiceSettings.reservation_lock_hours}
              onChange={(e) => setTableServiceSettings((prev) => ({ ...prev, reservation_lock_hours: e.target.value }))}
            />
            <div className="field-hint">
              {tx(
                lang,
                'Bu saat aralığında rezerv olunmuş masa adi masa kimi açılmayacaq. 0 yazsanız rezerv bloklama söndürülər.',
                'В этом окне забронированный стол нельзя открыть как обычный. 0 отключает блокировку.',
                'Within this time window, a reserved table cannot be opened as a normal table. Set 0 to disable the reservation lock.',
              )}
            </div>
          </div>
        </div>
        {renderPanelSuccess('table_service')}
        <div className="flex justify-end">
          <button onClick={() => { void saveTableServiceSettings(); }} className={saveButtonClass}>{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'İçki Servis Ayarları', 'Настройки подачи напитков', 'Beverage Service Settings')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Kofe seçiləndə yalnız ölçü soruşulsun, yoxsa əlavə olaraq to go və ya masa/stəkan seçimi də açılsın — bunu buradan təyin edin.',
            'Здесь можно выбрать: при выборе кофе спрашивать только размер или дополнительно способ подачи — to go / в стакане на стол.',
            'Choose whether coffee selection should ask only for size or also for service mode like to-go or table glass.',
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Kofe seçim popup-u', 'Popup выбора кофе', 'Coffee selection popup')}</label>
            <select
              className="neon-input"
              value={beverageServiceSettings.coffee_selection_mode}
              onChange={(e) =>
                setBeverageServiceSettings((prev) => ({
                  ...prev,
                  coffee_selection_mode: e.target.value === 'size_only' ? 'size_only' : 'size_and_service',
                }))
              }
            >
              <option value="size_and_service">{tx(lang, 'Ölçü + stəkan seçimi', 'Размер + выбор стакана', 'Size + cup choice')}</option>
              <option value="size_only">{tx(lang, 'Yalnız ölçü seçimi', 'Только выбор размера', 'Size only')}</option>
            </select>
            <div className="field-hint">
              {tx(
                lang,
                'Məsələn Amerikano seçiləndə ayrıca Kağız stəkan (to go) və ya Stəkan (masa) soruşmaq istəyirsinizsə birinci variantı seçin.',
                'Если при выборе Американо нужно спрашивать Бумажный стакан (to go) или Стакан (table), выберите первый вариант.',
                'Choose the first option if Americano should ask for Paper cup (to go) or Glass (table).',
              )}
            </div>
          </div>
          <label className="form-card flex items-center justify-between gap-4">
            <div>
              <div className="field-label">{tx(lang, 'Masa seçiləndə kağız stəkanı çıxart', 'Убирать бумажный стакан для зала', 'Exclude paper cup for table service')}</div>
              <div className="field-hint">
                {tx(
                  lang,
                  'Stəkan (masa) seçiləndə reseptdəki kağız stəkan və qapaq sərfdən çıxarılmayacaq.',
                  'Если выбран стакан для зала, бумажный стакан и крышка не будут списаны по рецепту.',
                  'When table glass is selected, paper cup and lid will not be consumed from recipe stock.',
                )}
              </div>
            </div>
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={beverageServiceSettings.remove_paper_packaging_for_table}
              onChange={(e) =>
                setBeverageServiceSettings((prev) => ({
                  ...prev,
                  remove_paper_packaging_for_table: e.target.checked,
                }))
              }
            />
          </label>
        </div>
        {renderPanelSuccess('beverage')}
        <div className="flex justify-end">
          <button onClick={() => { void saveBeverageServiceSettings(); }} className={saveButtonClass}>{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Bank Faiz Ayarları', 'Настройки банковских комиссий', 'Bank Fee Settings')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Hər tenant öz bank faizlərini özü müəyyən edə bilər. Kartla edilən satış və kartdan çıxan/köçürülən pul üçün faizlər ayrıdır.',
            'Каждый tenant может сам задать банковские комиссии. Для карточных продаж и вывода/перевода с карты проценты разделены.',
            'Each tenant can define its own bank fee rules. Card sales and money moved out of card balance are configured separately.',
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Kartla satış faizi (%)', 'Комиссия за карточную продажу (%)', 'Card sale fee (%)')}</label>
            <input
              className="neon-input"
              type="number"
              min={0}
              step="0.01"
              value={bankCommission.card_sale_percent}
              onChange={(e) => setBankCommission((prev) => ({ ...prev, card_sale_percent: e.target.value }))}
            />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Kartdan çıxış/köçürmə faizi (%)', 'Комиссия за вывод/перевод с карты (%)', 'Card transfer-out fee (%)')}</label>
            <input
              className="neon-input"
              type="number"
              min={0}
              step="0.01"
              value={bankCommission.card_transfer_percent}
              onChange={(e) => setBankCommission((prev) => ({ ...prev, card_transfer_percent: e.target.value }))}
            />
          </div>
        </div>
        <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 text-xs text-slate-300">
          {tx(
            lang,
            'Məntiq: kassada adi kart ödənişi üçün bir faiz, kartdan kassaya və ya borca köçürmə üçün ayrıca faiz tətbiq olunur. Kassadan karta, kassadan seyfə kimi hərəkətlərdə kart çıxışı olmadığı üçün bu faiz avtomatik tətbiq olunmur.',
            'Логика: для обычной карточной оплаты в кассе один процент, для перевода/вывода с карты — отдельный. Для касса->карта и касса->сейф комиссия не применяется автоматически.',
            'Logic: regular card sales use one percentage, while money moved out of card balance uses another. Cash->card and cash->safe do not get this fee automatically.',
          )}
        </div>
        {renderPanelSuccess('bank')}
        <div className="flex justify-end">
          <button onClick={() => { void saveBankCommission(); }} className={saveButtonClass}>{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Maliyyə qayda ayarları', 'Настройки финансовой policy', 'Finance Policy Settings')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Təsdiq, uyğunlaşdırma və risk xəbərdarlığı qaydalarını tenant səviyyəsində buradan idarə edin. Bu ayarlar Maliyyə modulunda təsdiq qutusu və xəbərdarlıq mexanizmi üçün istifadə olunur.',
            'Управляйте правилами approval, reconciliation и risk alert на уровне tenant. Эти настройки используются в Finance approval inbox и alert engine.',
            'Manage approval, reconciliation, and risk alert rules per tenant. These settings drive the Finance approval inbox and alert engine.',
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Böyük transfer limiti (AZN)', 'Лимит крупного перевода (AZN)', 'Large transfer threshold (AZN)')}</label>
            <input
              className="neon-input"
              type="number"
              min={0}
              step="0.01"
              value={financePolicy.large_transfer_threshold_azn}
              onChange={(e) => setFinancePolicy((prev) => ({ ...prev, large_transfer_threshold_azn: e.target.value }))}
            />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Uyğunlaşdırma xəbərdarlıq həddi (AZN)', 'Порог reconciliation alert (AZN)', 'Reconciliation alert threshold (AZN)')}</label>
            <input
              className="neon-input"
              type="number"
              min={0}
              step="0.01"
              value={financePolicy.reconciliation_variance_alert_azn}
              onChange={(e) => setFinancePolicy((prev) => ({ ...prev, reconciliation_variance_alert_azn: e.target.value }))}
            />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Mənfi balans alert toleransı (AZN)', 'Толеранс alert отрицательного баланса (AZN)', 'Negative balance alert tolerance (AZN)')}</label>
            <input
              className="neon-input"
              type="number"
              min={0}
              step="0.01"
              value={financePolicy.negative_balance_alert_azn}
              onChange={(e) => setFinancePolicy((prev) => ({ ...prev, negative_balance_alert_azn: e.target.value }))}
            />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Təsdiq rolları', 'Роли approval', 'Approval roles')}</label>
            <input
              className="neon-input"
              value={financePolicy.approver_roles}
              onChange={(e) => setFinancePolicy((prev) => ({ ...prev, approver_roles: e.target.value }))}
              placeholder="manager, admin, finance_admin, super_admin"
            />
            <div className="field-hint">{tx(lang, 'Vergüllə ayırın.', 'Разделяйте запятыми.', 'Separate with commas.')}</div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {[
            ['investor_repayment_requires_approval', tx(lang, 'Investor ödənişi approval tələb etsin', 'Выплата инвестору требует approval', 'Investor repayment requires approval')],
            ['cash_adjustment_requires_approval', tx(lang, 'Cash adjustment approval tələb etsin', 'Cash adjustment требует approval', 'Cash adjustment requires approval')],
            ['reversal_requires_approval', tx(lang, 'Reversal approval tələb etsin', 'Reversal требует approval', 'Reversal requires approval')],
            ['reconciliation_adjustment_requires_approval', tx(lang, 'Reconciliation adjustment approval tələb etsin', 'Reconciliation adjustment требует approval', 'Reconciliation adjustment requires approval')],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-sm font-bold text-slate-200">
              <input
                type="checkbox"
                checked={Boolean((financePolicy as any)[key])}
                onChange={(e) => setFinancePolicy((prev) => ({ ...prev, [key]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>
        {renderPanelSuccess('finance_policy')}
        <div className="flex justify-end">
          <button onClick={() => { void saveFinancePolicy(); }} className={saveButtonClass}>{tx(lang, 'Maliyyə policy saxla', 'Сохранить finance policy', 'Save finance policy')}</button>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Standart İtki Faizi', 'Настройки yield management', 'Yield management')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Dönər və oxşar məhsullarda hazır porsiya satışını çiy xammal sərfinə çevirin. Gün sonu faktiki fərq icazə verilən həddi keçərsə, sistem bunu israf və ya şübhəli fərq kimi qeyd edir.',
            'Преобразуйте продажу готовой порции в расход сырого мяса. В конце дня система пометит отклонение выше tolerance как waste/scam.',
            'Convert ready-portion sales into raw-meat consumption. At day end, variance beyond tolerance is flagged as waste/scam.',
          )}
        </p>
        <label className="flex items-center gap-3 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={yieldManagement.enabled}
            onChange={(e) => setYieldManagement((prev) => ({ ...prev, enabled: e.target.checked }))}
          />
          {tx(lang, 'Standart itki faizi aktiv olsun', 'Включить yield management', 'Enable yield management')}
        </label>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <input
            className="neon-input"
            type="number"
            min={0}
            step="0.01"
            value={yieldManagement.variance_tolerance_percent}
            onChange={(e) => setYieldManagement((prev) => ({ ...prev, variance_tolerance_percent: e.target.value }))}
            placeholder={tx(lang, 'İcazə verilən fərq (%)', 'Допустимое отклонение (%)', 'Variance tolerance (%)')}
          />
          <input
            className="neon-input"
            type="number"
            min={1}
            step="0.01"
            value={yieldManagement.beef_ratio}
            onChange={(e) => setYieldManagement((prev) => ({ ...prev, beef_ratio: e.target.value }))}
            placeholder={tx(lang, 'Mal əti üçün çiy / hazır nisbəti', 'Ratio говядины', 'Beef ratio')}
          />
          <input
            className="neon-input"
            type="number"
            min={1}
            step="0.01"
            value={yieldManagement.chicken_ratio}
            onChange={(e) => setYieldManagement((prev) => ({ ...prev, chicken_ratio: e.target.value }))}
            placeholder={tx(lang, 'Toyuq əti üçün çiy / hazır nisbəti', 'Ratio курицы', 'Chicken ratio')}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-slate-100">{tx(lang, 'Mal əti standartı', 'Стандарт говядины', 'Beef standard')}</div>
              <button type="button" onClick={() => applyYieldPreset('beef')} className="neon-btn rounded-lg px-3 py-1 text-xs">
                {tx(lang, 'Standartı tətbiq et', 'Применить стандарт', 'Apply preset')}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="neon-input" type="number" min={0} step="0.01" value={yieldManagement.beef_loss_min_percent} onChange={(e) => setYieldManagement((prev) => ({ ...prev, beef_loss_min_percent: e.target.value }))} placeholder={tx(lang, 'Min itki %', 'Мин потеря %', 'Min loss %')} />
              <input className="neon-input" type="number" min={0} step="0.01" value={yieldManagement.beef_loss_max_percent} onChange={(e) => setYieldManagement((prev) => ({ ...prev, beef_loss_max_percent: e.target.value }))} placeholder={tx(lang, 'Max itki %', 'Макс потеря %', 'Max loss %')} />
            </div>
          </div>
          <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-slate-100">{tx(lang, 'Toyuq standartı', 'Стандарт курицы', 'Chicken standard')}</div>
              <button type="button" onClick={() => applyYieldPreset('chicken')} className="neon-btn rounded-lg px-3 py-1 text-xs">
                {tx(lang, 'Standartı tətbiq et', 'Применить стандарт', 'Apply preset')}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className="neon-input" type="number" min={0} step="0.01" value={yieldManagement.chicken_loss_min_percent} onChange={(e) => setYieldManagement((prev) => ({ ...prev, chicken_loss_min_percent: e.target.value }))} placeholder={tx(lang, 'Min itki %', 'Мин потеря %', 'Min loss %')} />
              <input className="neon-input" type="number" min={0} step="0.01" value={yieldManagement.chicken_loss_max_percent} onChange={(e) => setYieldManagement((prev) => ({ ...prev, chicken_loss_max_percent: e.target.value }))} placeholder={tx(lang, 'Max itki %', 'Макс потеря %', 'Max loss %')} />
            </div>
          </div>
        </div>
        {suggestedYieldItems.length > 0 ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
            <div className="font-semibold text-emerald-200">{tx(lang, 'Ağıllı inventar təklifləri', 'Умные подсказки по инвентарю', 'Smart inventory suggestions')}</div>
            <p className="text-xs text-emerald-100/80">
              {tx(
                lang,
                'Sistem adı üzrə dönər, mal əti və toyuq məhsullarını avtomatik təklif edir. Bir kliklə izlənən inventara əlavə edə bilərsiniz.',
                'Система автоматически предлагает позиции по названию. Вы можете добавить их в отслеживаемый список одним кликом.',
                'The system suggests likely doner/beef/chicken inventory by name. Add them to tracked inventory with one click.',
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestedYieldItems.map((item: any) => {
                const alreadyTracked = yieldManagement.tracked_items.some((row) => row.inventory_name === item.name);
                return (
                  <button
                    key={`suggest-${item.id || item.name}`}
                    type="button"
                    disabled={alreadyTracked}
                    onClick={() => applySmartYieldSuggestion(String(item.name || ''))}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      alreadyTracked
                        ? 'border-slate-600/60 bg-slate-800/60 text-slate-400'
                        : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20'
                    }`}
                  >
                    {item.name}
                    {alreadyTracked ? ` · ${tx(lang, 'əlavə edilib', 'добавлено', 'added')}` : ''}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 space-y-3">
          <div className="font-semibold text-slate-100">{tx(lang, 'İzlənəcək inventar', 'Отслеживаемый инвентарь', 'Tracked inventory')}</div>
          <p className="text-xs text-slate-400">
            {tx(
              lang,
              'Bura yalnız çiy ət kimi ciddi yield izləmək istədiyiniz məhsulları əlavə edin. Meyvə-tərəvəz üçün yalnız ayrıca gündəlik itki auditi aparırsınızsa istifadə etmək məntiqlidir.',
              'Сюда добавляйте только позиции, по которым реально нужен yield-аудит. Для овощей и фруктов имеет смысл только при отдельном ежедневном учете потерь.',
              'Add only inventory that truly needs yield audit, such as raw meat. For fruit and vegetables, use this only if you run a separate daily waste audit.',
            )}
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input
              className="neon-input"
              value={yieldInventorySearch}
              onChange={(e) => setYieldInventorySearch(e.target.value)}
              placeholder={tx(lang, 'Məhsul axtar...', 'Поиск товара...', 'Search inventory...')}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
            <select
              className="neon-input"
              value={yieldInventoryCandidate}
              onChange={(e) => setYieldInventoryCandidate(e.target.value)}
            >
              <option value="">{tx(lang, 'Anbardan məhsul seçin', 'Выберите товар со склада', 'Select inventory item')}</option>
              {preferredYieldInventory.length > 0 ? (
                <optgroup label={tx(lang, 'Ət / dönər üçün uyğun məhsullar', 'Подходящие мясные позиции', 'Preferred meat items')}>
                  {filteredYieldInventory
                    .filter((item: any) => preferredYieldInventory.some((preferred: any) => preferred.id === item.id || preferred.name === item.name))
                    .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || '')))
                    .map((item: any) => (
                      <option key={item.id || item.name} value={String(item.name || '')}>
                        {item.name}
                      </option>
                    ))}
                </optgroup>
              ) : null}
              {remainingYieldInventory.length > 0 ? (
                <optgroup label={tx(lang, 'Digər inventar', 'Прочий инвентарь', 'Other inventory')}>
                  {filteredYieldInventory
                    .filter((item: any) => remainingYieldInventory.some((rest: any) => rest.id === item.id || rest.name === item.name))
                    .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || '')))
                    .map((item: any) => (
                      <option key={item.id || item.name} value={String(item.name || '')}>
                        {item.name}
                      </option>
                    ))}
                </optgroup>
              ) : null}
            </select>
            <button type="button" onClick={addYieldTrackedInventory} className="glossy-gold rounded-xl px-4 py-2 font-bold">
              {tx(lang, 'Siyahıya əlavə et', 'Добавить в список', 'Add to list')}
            </button>
          </div>
          <div className="space-y-2">
            {yieldManagement.tracked_items.length === 0 ? (
              <div className="rounded-xl border border-slate-700/50 bg-slate-900/30 p-3 text-sm text-slate-400">
                {tx(lang, 'Hələ izlənən inventar seçilməyib', 'Пока не выбрана отслеживаемая позиция', 'No tracked inventory selected yet')}
              </div>
            ) : (
              yieldManagement.tracked_items.map((tracked) => (
                <div key={tracked.inventory_name} className="grid grid-cols-1 gap-2 rounded-xl border border-slate-700/50 bg-slate-900/40 p-3 md:grid-cols-[1fr_120px_130px_auto] md:items-center">
                  <div className="text-sm text-slate-200">{tracked.inventory_name}</div>
                  <select
                    className="neon-input"
                    value={tracked.meat_type || 'beef'}
                    onChange={(e) =>
                      setYieldManagement((prev) => ({
                        ...prev,
                        tracked_items: prev.tracked_items.map((row) =>
                          row.inventory_name === tracked.inventory_name ? { ...row, meat_type: e.target.value as 'beef' | 'chicken' } : row,
                        ),
                      }))
                    }
                  >
                    <option value="beef">{tx(lang, 'Mal əti', 'Говядина', 'Beef')}</option>
                    <option value="chicken">{tx(lang, 'Toyuq əti', 'Курица', 'Chicken')}</option>
                  </select>
                  <input
                    className="neon-input"
                    type="number"
                    min={1}
                    step="0.01"
                    value={tracked.raw_to_ready_ratio || ''}
                    onChange={(e) =>
                      setYieldManagement((prev) => ({
                        ...prev,
                        tracked_items: prev.tracked_items.map((row) =>
                          row.inventory_name === tracked.inventory_name ? { ...row, raw_to_ready_ratio: e.target.value } : row,
                        ),
                      }))
                    }
                    placeholder={tx(lang, 'Çiy / hazır nisbəti', 'Соотношение сырой / готовой', 'Raw ratio')}
                  />
                  <button
                    type="button"
                    onClick={() => removeYieldTrackedInventory(tracked.inventory_name)}
                    className="rounded-lg border border-red-400/40 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/10"
                  >
                    {tx(lang, 'Çıxar', 'Убрать', 'Remove')}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        {renderPanelSuccess('yield')}
        <div className="flex justify-end">
          <button onClick={() => { void saveYieldManagement(); }} className={saveButtonClass}>{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'İnterfeys Ayarları', 'Настройки интерфейса', 'Interface Settings')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Görünüş və touch istifadə rahatlığı ilə bağlı ayarlar bu bölmədədir.',
            'Параметры внешнего вида и удобства touch-использования находятся здесь.',
            'Appearance and touch usability settings are managed here.',
          )}
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-700/60 bg-slate-950/40 px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm font-semibold text-slate-200">
                {tx(lang, 'Virtual klaviatura', 'Виртуальная клавиатура', 'Virtual keyboard')}
              </div>
              <button
                type="button"
                onClick={() => { void toggleVirtualKeyboard(!sessionSettings.virtual_keyboard_enabled); }}
                className={`relative inline-flex h-8 w-16 items-center rounded-full border transition ${
                  sessionSettings.virtual_keyboard_enabled
                    ? 'border-emerald-300/50 bg-emerald-500/20'
                    : 'border-slate-600 bg-slate-800/70'
                }`}
                aria-pressed={sessionSettings.virtual_keyboard_enabled}
              >
                <span
                  className={`absolute h-6 w-6 rounded-full bg-white shadow transition ${
                    sessionSettings.virtual_keyboard_enabled ? 'left-9' : 'left-1'
                  }`}
                />
              </button>
            </div>
            <div className="mt-2 text-xs text-slate-400">
              {tx(lang, 'Sensor ekranda input sahələrinə toxunanda öz klaviaturamız açılsın.', 'На сенсорном экране при нажатии на поле будет открываться встроенная клавиатура.', 'Show the built-in keyboard when a touch device focuses an input.')}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-700/60 bg-slate-950/40 px-4 py-3">
            <div className="text-sm font-semibold text-slate-200">
              {tx(lang, 'Tema rejimi', 'Режим темы', 'Theme mode')}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {([
                ['dark', tx(lang, 'Dark', 'Тёмная', 'Dark')],
                ['light', tx(lang, 'Light', 'Светлая', 'Light')],
              ] as Array<['dark' | 'light', string]>).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => { void changeThemeMode(mode); }}
                  className={`min-h-11 rounded-xl border px-3 text-sm font-bold transition ${
                    sessionSettings.theme_mode === mode
                      ? 'border-amber-300/70 bg-amber-400/20 text-amber-100'
                      : 'border-slate-700 bg-slate-900/70 text-slate-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="mt-2 text-xs text-slate-400">
              {tx(lang, 'Bu seçim bütün tətbiq üçün görünüşü dəyişir.', 'Этот выбор меняет внешний вид всего приложения.', 'This changes the look of the entire app.')}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-700/60 bg-slate-950/40 px-4 py-3">
            <div className="text-sm font-semibold text-slate-200">
              {tx(lang, 'İnterfeys rejimi', 'Режим интерфейса', 'Interface mode')}
            </div>
            <div className="mt-2 text-xs text-slate-400">
              {tx(
                lang,
                'Sistem legacy UI rejimində sabitlənib.',
                'Система зафиксирована в режиме legacy UI.',
                'The system is locked to legacy UI mode.',
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Sessiya Təhlükəsizliyi', 'Безопасность сессии', 'Session Security')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'İstifadəçi müəyyən müddət heç bir hərəkət etməsə sistem avtomatik çıxış etsin. 0 yazsanız bu funksiya söndürüləcək.',
            'Если пользователь ничего не делает заданное время, система автоматически выйдет. 0 отключает функцию.',
            'Automatically sign out after inactivity. Use 0 to disable this feature.',
          )}
        </p>
        <div className="grid gap-4 md:grid-cols-[auto_1fr_auto] md:items-end">
          <label className="text-sm text-slate-300">
            {tx(lang, 'Boş dayanma çıxışı (dəqiqə)', 'Простой выход (минуты)', 'Idle logout (minutes)')}
            <input
              className="neon-input mt-1 w-52"
              type="number"
              min={0}
              max={480}
              inputMode="numeric"
              data-virtual-keyboard-mode="numeric"
              value={sessionSettings.idle_logout_minutes}
              onChange={(e) => setSessionSettings((prev) => ({ ...prev, idle_logout_minutes: e.target.value }))}
            />
          </label>
          <div className="rounded-2xl border border-slate-700/60 bg-slate-950/40 px-4 py-3">
            <div className="text-sm font-semibold text-slate-200">
              {tx(lang, 'Staff PIN uzunluğu', 'Длина PIN персонала', 'Staff PIN length')}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {([4, 6] as const).map((length) => (
                <button
                  key={length}
                  type="button"
                  onClick={() => setSessionSettings((prev) => ({ ...prev, staff_pin_length: length }))}
                  className={`min-h-11 rounded-xl border px-3 text-sm font-bold transition ${
                    sessionSettings.staff_pin_length === length
                      ? 'border-amber-300/70 bg-amber-400/20 text-amber-100'
                      : 'border-slate-700 bg-slate-900/70 text-slate-300'
                  }`}
                >
                  {length === 4
                    ? tx(lang, '4 rəqəm', '4 цифры', '4 digits')
                    : tx(lang, '6 rəqəm', '6 цифр', '6 digits')}
                </button>
              ))}
            </div>
            <div className="mt-2 text-xs text-slate-400">
              {tx(lang, '4 rəqəm daha sürətlidir, 6 rəqəm isə təhlükəsizlik üçün tövsiyə olunur.', '4 цифры быстрее, 6 цифр рекомендуются для безопасности.', '4 digits is faster; 6 digits is recommended for security.')}
            </div>
          </div>
          <button onClick={() => { void saveSessionSettings(); }} className={saveButtonClass}>
            {tx(lang, 'Sessiya ayarlarını saxla', 'Сохранить настройки сессии', 'Save Session Settings')}
          </button>
        </div>
        {renderPanelSuccess('session')}
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Staff Limit Ayarları', 'Настройки лимита staff', 'Staff Benefit Settings')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Hər müəssisə staff üçün günlük limitini və hansı məhsulların limiti istifadə edə biləcəyini özü seçə bilər.',
            'Каждое заведение может само определить дневной лимит staff и какие товары покрываются льготой.',
            'Each business can define the daily staff benefit and which product groups it covers.',
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input
            className="neon-input"
            type="number"
            min={0}
            value={staffBenefits.daily_limit_azn}
            onChange={(e) => setStaffBenefits((prev) => ({ ...prev, daily_limit_azn: e.target.value }))}
            placeholder={tx(lang, 'Günlük limit (AZN)', 'Дневной лимит (AZN)', 'Daily limit (AZN)')}
          />
          <input
            className="neon-input"
            type="number"
            min={0}
            value={staffBenefits.item_unit_cap_azn}
            onChange={(e) => setStaffBenefits((prev) => ({ ...prev, item_unit_cap_azn: e.target.value }))}
            placeholder={tx(lang, 'Bir məhsul üçün maksimum benefit', 'Максимальная льгота на единицу товара', 'Maximum benefit per item')}
          />
          <select
            className="neon-input md:col-span-2"
            value={staffBenefits.allowed_scope}
            onChange={(e) => setStaffBenefits((prev) => ({ ...prev, allowed_scope: e.target.value as any }))}
          >
            <option value="all">{tx(lang, 'Bütün məhsullar üçün keçərli olsun', 'Для всех товаров', 'Apply to all products')}</option>
            <option value="categories">{tx(lang, 'Yalnız seçilmiş kateqoriyalar üçün', 'Только для выбранных категорий', 'Only selected categories')}</option>
            <option value="items">{tx(lang, 'Yalnız seçilmiş məhsullar üçün', 'Только для выбранных товаров', 'Only selected items')}</option>
          </select>
        </div>
        {staffBenefits.allowed_scope === 'categories' ? (
          <div className="space-y-2">
            <div className="text-sm text-slate-300">{tx(lang, 'Limitə daxil kateqoriyalar', 'Категории в лимите', 'Included categories')}</div>
            <div className="flex flex-wrap gap-2">
              {Array.from(new Set(menuCatalog.map((item: any) => String(item.category || '').trim()).filter(Boolean))).map((category) => {
                const active = staffBenefits.included_categories.includes(category);
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setStaffBenefits((prev) => ({
                      ...prev,
                      included_categories: active
                        ? prev.included_categories.filter((entry) => entry !== category)
                        : [...prev.included_categories, category],
                    }))}
                    className={`rounded-full px-3 py-2 text-sm ${active ? 'bg-yellow-400 text-slate-900' : 'border border-slate-600 text-slate-200'}`}
                  >
                    {category}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {staffBenefits.allowed_scope === 'items' ? (
          <div className="space-y-2">
            <div className="text-sm text-slate-300">{tx(lang, 'Limitə daxil məhsullar', 'Товары в лимите', 'Included products')}</div>
            <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto rounded-2xl border border-slate-700/60 bg-slate-950/30 p-3">
              {menuCatalog.map((item: any) => {
                const name = String(item.item_name || '').trim();
                const active = staffBenefits.included_items.includes(name);
                return (
                  <button
                    key={item.id || name}
                    type="button"
                    onClick={() => setStaffBenefits((prev) => ({
                      ...prev,
                      included_items: active
                        ? prev.included_items.filter((entry) => entry !== name)
                        : [...prev.included_items, name],
                    }))}
                    className={`rounded-full px-3 py-2 text-sm ${active ? 'bg-yellow-400 text-slate-900' : 'border border-slate-600 text-slate-200'}`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {renderPanelSuccess('staff_benefits')}
        <div className="flex justify-end">
          <button onClick={() => { void saveStaffBenefits(); }} className={saveButtonClass}>{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>

      {['admin', 'manager', 'super_admin'].includes(currentRole) ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="metal-panel p-6 space-y-4">
            <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Şifrə Yenilə', 'Смена пароля', 'Change Password')}</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <input className="neon-input" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder={tx(lang, 'Mövcud şifrə', 'Текущий пароль', 'Current password')} />
              <input className="neon-input" type="password" value={newOwnPassword} onChange={(e) => setNewOwnPassword(e.target.value)} placeholder={tx(lang, 'Yeni şifrə', 'Новый пароль', 'New password')} />
              <input className="neon-input" type="password" value={confirmOwnPassword} onChange={(e) => setConfirmOwnPassword(e.target.value)} placeholder={tx(lang, 'Yeni şifrə təkrarı', 'Повторите пароль', 'Confirm new password')} />
            </div>
            <div className="flex justify-end">
              <button onClick={handleChangeOwnPassword} className="neon-btn rounded-xl px-5 py-2 font-semibold">{tx(lang, 'Şifrəni Yenilə', 'Обновить пароль', 'Update Password')}</button>
            </div>
          </div>

          <div className="metal-panel p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Google Authenticator', 'Google Authenticator', 'Google Authenticator')}</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {tx(
                    lang,
                    'Admin, Manager və Super Admin üçün real 6 rəqəmli TOTP qoruması.',
                    'Реальная TOTP-защита с 6-значным кодом для Admin, Manager и Super Admin.',
                    'Real 6-digit TOTP protection for Admin, Manager, and Super Admin.',
                  )}
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${totpEnabled ? 'bg-emerald-500/20 text-emerald-200' : 'bg-slate-700/80 text-slate-300'}`}>
                {totpEnabled
                  ? tx(lang, 'Aktivdir', 'Активно', 'Enabled')
                  : tx(lang, 'Aktiv deyil', 'Не активно', 'Disabled')}
              </span>
            </div>

            {!totpEnabled ? (
              <div className="space-y-4">
                {!totpSetupUrl ? (
                  <button onClick={() => { void handleStartTotpSetup(); }} className="glossy-gold rounded-xl px-5 py-2 font-bold">
                    {tx(lang, 'Google Authenticator Qoş', 'Подключить Google Authenticator', 'Connect Google Authenticator')}
                  </button>
                ) : null}

                {totpSetupUrl ? (
                  <div className="space-y-3 rounded-2xl border border-slate-700/70 bg-slate-950/30 p-4">
                    <p className="text-sm text-slate-300">
                      {tx(
                        lang,
                        'Google Authenticator tətbiqində QR kodu skan edin, sonra 6 rəqəmli kodu aşağıda təsdiqləyin.',
                        'Отсканируйте QR-код в Google Authenticator и подтвердите 6-значный код ниже.',
                        'Scan the QR code in Google Authenticator, then confirm the 6-digit code below.',
                      )}
                    </p>
                    {totpQrDataUrl ? (
                      <img src={totpQrDataUrl} alt="TOTP QR" className="h-44 w-44 rounded-2xl border border-slate-700 bg-white p-2" />
                    ) : null}
                    <div className="rounded-xl border border-slate-700/70 bg-slate-900/50 p-3 text-xs text-slate-300 break-all">
                      <div className="font-semibold text-slate-200">{tx(lang, 'Manual secret', 'Ручной secret', 'Manual secret')}</div>
                      <div className="mt-1">{totpSecret}</div>
                    </div>
                    <div className="flex flex-col gap-3 md:flex-row">
                      <input
                        className="neon-input"
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder={tx(lang, '6 rəqəmli kod', '6-значный код', '6-digit code')}
                      />
                      <button onClick={() => { void handleVerifyTotp(); }} className="neon-btn rounded-xl px-5 py-2 font-semibold">
                        {tx(lang, 'Təsdiqlə', 'Подтвердить', 'Verify')}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="space-y-3 rounded-2xl border border-amber-400/20 bg-amber-500/5 p-4">
                <p className="text-sm text-slate-300">
                  {tx(
                    lang,
                    '2FA aktivdir. Söndürmək üçün mövcud şifrənizi təsdiqləyin.',
                    '2FA включена. Подтвердите текущий пароль, чтобы отключить ее.',
                    '2FA is enabled. Confirm your current password to disable it.',
                  )}
                </p>
                <div className="flex flex-col gap-3 md:flex-row">
                  <input
                    className="neon-input"
                    type="password"
                    value={totpDisablePassword}
                    onChange={(e) => setTotpDisablePassword(e.target.value)}
                    placeholder={tx(lang, 'Cari şifrə', 'Текущий пароль', 'Current password')}
                  />
                  <input
                    className="neon-input"
                    value={totpDisableCode}
                    onChange={(e) => setTotpDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder={tx(lang, '2FA kodu (opsional)', 'Код 2FA (необязательно)', '2FA code (optional)')}
                  />
                  <button onClick={() => { void handleDisableTotp(); }} className="rounded-xl border border-red-400/50 px-5 py-2 font-semibold text-red-300 hover:bg-red-500/10">
                    {tx(lang, '2FA Söndür', 'Отключить 2FA', 'Disable 2FA')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className="metal-panel overflow-hidden">
        <div className="border-b border-slate-700/70 p-6">
          <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'İstifadəçi İdarəetməsi', 'Управление пользователями', 'User Management')}</h2>
          <p className="mt-2 text-sm text-slate-400">
            {tx(
              lang,
              'Admin və Manager ad + şifrə ilə yaradılır. Staff və Kitchen ad + PIN ilə yaradılır.',
              'Admin и Manager создаются с логином и паролем. Staff и Kitchen создаются с именем и PIN.',
              'Admin and Manager are created with username + password. Staff and Kitchen are created with username + PIN.',
            )}
          </p>
        </div>

        <div className="space-y-6 p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <input
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
              type="text"
              placeholder={tx(lang, 'Ad / istifadəçi adı', 'Имя / логин', 'Name / username')}
              className="neon-input"
            />
            <select value={newUserRole} onChange={(e) => setNewUserRole(e.target.value as any)} className="neon-input bg-transparent">
              <option value="staff">{tx(lang, 'Staff', 'Кассир', 'Staff')}</option>
              <option value="kitchen">{tx(lang, 'Kitchen', 'Кухня', 'Kitchen')}</option>
              <option value="manager">{tx(lang, 'Manager', 'Менеджер', 'Manager')}</option>
              <option value="admin">{tx(lang, 'Admin', 'Админ', 'Admin')}</option>
            </select>
            {requiresPasswordForNewUser ? (
              <input
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                type="password"
                placeholder={tx(lang, 'Şifrə', 'Пароль', 'Password')}
                className="neon-input"
              />
            ) : (
              <input
                value={newUserPin}
                onChange={(e) => setNewUserPin(e.target.value.replace(/\D/g, '').slice(0, 15))}
                type="text"
                placeholder={tx(lang, 'PIN', 'PIN', 'PIN')}
                className="neon-input"
              />
            )}
            <button onClick={() => { void handleCreateUser(); }} className="glossy-gold rounded-xl px-6 py-2 font-bold">
              {tx(lang, 'Yarat', 'Создать', 'Create')}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 border-t border-slate-700/70 pt-4">
            {users.map((u) => (
              <div key={u.id || u.username} className="flex items-center justify-between rounded-xl border border-slate-700 px-4 py-3">
                <div>
                  <div className="font-semibold text-slate-100">{u.username}</div>
                  <div className="text-xs text-slate-400">{tx(lang, 'Rol', 'Роль', 'Role')}: {u.role}</div>
                </div>
                <button onClick={() => setDeleteUserName(u.username)} className="rounded-lg border border-red-400/50 px-3 py-1 text-sm text-red-300 hover:bg-red-500/10">
                  {tx(lang, 'Sil', 'Удалить', 'Delete')}
                </button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 border-t border-slate-700/70 pt-4 md:grid-cols-3">
            <select value={targetUser} onChange={(e) => setTargetUser(e.target.value)} className="neon-input">
              <option value="">{tx(lang, 'PIN üçün staff seçin', 'Выберите staff для PIN', 'Select staff for PIN')}</option>
              {pinUsers.map((u) => (
                <option key={u.id || u.username} value={u.username}>{u.username}</option>
              ))}
            </select>
            <input value={targetPin} onChange={(e) => setTargetPin(e.target.value.replace(/\D/g, '').slice(0, 15))} type="text" placeholder={tx(lang, 'Yeni PIN', 'Новый PIN', 'New PIN')} className="neon-input" />
            <button onClick={() => { void handleUpdatePin(); }} className="neon-btn px-4 py-2">{tx(lang, 'PIN Dəyiş', 'Изменить PIN', 'Change PIN')}</button>
          </div>

          <div className="grid grid-cols-1 gap-3 border-t border-slate-700/70 pt-4 md:grid-cols-3">
            <select value={targetPasswordUser} onChange={(e) => setTargetPasswordUser(e.target.value)} className="neon-input">
              <option value="">{tx(lang, 'Şifrə üçün admin seçin', 'Выберите admin для пароля', 'Select admin for password')}</option>
              {passwordUsers.map((u) => (
                <option key={u.id || u.username} value={u.username}>{u.username} ({u.role})</option>
              ))}
            </select>
            <input value={targetPassword} onChange={(e) => setTargetPassword(e.target.value)} type="password" placeholder={tx(lang, 'Yeni şifrə', 'Новый пароль', 'New password')} className="neon-input" />
            <button onClick={() => { void handleUpdatePasswordForUser(); }} className="neon-btn px-4 py-2">{tx(lang, 'Şifrə Dəyiş', 'Изменить пароль', 'Change Password')}</button>
          </div>
        </div>
      </div>

      {['admin', 'super_admin'].includes(currentRole) ? (
        <div className="metal-panel p-6 space-y-4">
          <h2 className="text-xl font-bold text-red-300">{tx(lang, 'Təhlükəli Əməliyyatlar', 'Опасные операции', 'Danger Zone')}</h2>
          <p className="text-sm text-slate-400">
            {tx(
              lang,
              'Bu bölmə cari tenantın bütün iş datasını sıfırlamaq üçündür. İstifadəçilər qalacaq, amma əməliyyat datası silinəcək.',
              'Этот раздел нужен для полного сброса рабочих данных текущего tenant. Пользователи останутся, но рабочие данные будут удалены.',
              'This section resets the current tenant operational data. Users remain, but operational data is erased.',
            )}
          </p>
        <div className="rounded-2xl border border-red-400/20 bg-red-500/5 p-4">
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setResetModalOpen(true)}
                className="rounded-xl border border-red-400/50 px-6 py-2 font-bold text-red-200 hover:bg-red-500/10"
              >
                {tx(lang, 'Bütün sistemi sıfırla', 'Сбросить систему', 'Reset entire system')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Rol icazələri', 'Права ролей', 'Role permissions')}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {(['staff', 'manager', 'kitchen'] as const).map((role) => (
            <div key={role} className="rounded-xl border border-slate-700/70 bg-slate-900/30 p-4 space-y-2">
              <h3 className="font-semibold uppercase tracking-wide text-slate-200">{roleLabelMap[role]}</h3>
              {moduleCatalog.map((moduleKey) => (
                <label key={`${role}_${moduleKey}`} className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={(roleModules[role] || []).includes(moduleKey)} onChange={() => toggleRoleModule(role, moduleKey)} />
                  <span>{moduleLabelMap[moduleKey] || moduleKey}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
        {renderPanelSuccess('role_modules')}
        <div className="flex justify-end">
          <button onClick={() => { void saveRoleModules(); }} className="neon-btn rounded-xl px-5 py-2 font-semibold transition-transform duration-100 active:translate-y-px active:scale-[0.98]">{tx(lang, 'Rol icazələrini yadda saxla', 'Сохранить права ролей', 'Save role permissions')}</button>
        </div>
      </div>

      <ConfirmModal
        open={Boolean(deleteUserName)}
        title={tx(lang, 'İstifadəçini sil', 'Удалить пользователя', 'Delete user')}
        message={tx(lang, `"${deleteUserName || ''}" istifadəçisini silmək istəyirsiniz?`, `Удалить пользователя "${deleteUserName || ''}"?`, `Delete user "${deleteUserName || ''}"?`)}
        lang={lang}
        onCancel={() => setDeleteUserName(null)}
        onConfirm={() => {
          if (deleteUserName) {
            void handleDeleteUser(deleteUserName);
          }
        }}
      />
    </div>
  );
}

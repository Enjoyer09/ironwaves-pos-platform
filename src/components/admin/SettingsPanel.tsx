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
  setup_totp_live,
  update_email_settings_live,
  update_business_profile_live,
  update_customer_app_settings_live,
  update_print_settings,
  update_qr_settings_live,
  update_role_modules_live,
  update_staff_benefits_live,
  update_user_credentials_live,
  verify_totp_live,
} from '../../api/settings';
import { get_menu_items_live } from '../../api/menu';
import ConfirmModal from '../ConfirmModal';

type RoleModules = { staff: string[]; manager: string[]; kitchen: string[] };

const defaultRoleModules: RoleModules = {
  staff: ['pos', 'tables', 'kds', 'zreport'],
  manager: ['pos', 'tables', 'kds', 'zreport', 'finance', 'inventory', 'combos', 'analytics', 'logs', 'crm', 'ai', 'menu', 'recipes'],
  kitchen: ['kds'],
};

const moduleCatalog = ['pos', 'tables', 'kds', 'zreport', 'finance', 'inventory', 'combos', 'analytics', 'logs', 'crm', 'ai', 'menu', 'recipes'];

export default function SettingsPanel() {
  const { user, lang, notify } = useAppStore();
  const tenantId = user?.tenant_id || 'tenant_default';
  const currentRole = String(user?.role || '').toLowerCase();

  const [successMsg, setSuccessMsg] = useState('');
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
  const [printSettings, setPrintSettings] = useState({
    use_qz: false,
    printer_name: '',
  });
  const [customerAppSettings, setCustomerAppSettings] = useState({
    enabled: true,
    app_name: 'Loyalty Club',
    hero_title: 'Xoş gəldiniz',
    hero_subtitle: 'Bonuslarınızı, kampaniyaları və reward-ları bir yerdə izləyin.',
    points_label: 'Ulduz',
    reward_name: 'Reward',
    reward_threshold: '10',
    reward_description: '10 ulduza 1 pulsuz içki',
    primary_color: '#facc15',
    accent_color: '#22d3ee',
    show_campaigns: true,
    show_history: true,
    show_notifications: true,
  });
  const [staffBenefits, setStaffBenefits] = useState({
    daily_limit_azn: '6',
    allowed_scope: 'all' as 'all' | 'categories' | 'items',
    included_categories: [] as string[],
    included_items: [] as string[],
    item_unit_cap_azn: '6',
  });
  const [menuCatalog, setMenuCatalog] = useState<any[]>([]);

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

  const requiresPasswordForNewUser = ['admin', 'manager'].includes(newUserRole);
  const pinUsers = users.filter((u) => ['staff', 'kitchen'].includes(String(u.role || '').toLowerCase()));
  const passwordUsers = users.filter((u) => ['admin', 'manager', 'super_admin'].includes(String(u.role || '').toLowerCase()));
  const currentPasswordUser = users.find((u) => u.username === user?.username);
  const totpEnabled = Boolean(currentPasswordUser?.two_factor_enabled);

  const flashSuccess = (message: string) => {
    setSuccessMsg(message);
    window.setTimeout(() => setSuccessMsg(''), 2500);
  };

  const loadData = async () => {
    const [profileRes, usersRes, settingsRes] = await Promise.allSettled([
      get_business_profile_live(tenantId),
      get_users_live(tenantId),
      get_settings_live(tenantId),
    ]);
    void get_menu_items_live(tenantId).then(setMenuCatalog).catch(() => setMenuCatalog([]));

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
      setPrintSettings({
        use_qz: Boolean(settingsRes.value.print_settings?.use_qz),
        printer_name: String(settingsRes.value.print_settings?.printer_name || ''),
      });
      setCustomerAppSettings({
        enabled: Boolean(settingsRes.value.customer_app_settings?.enabled ?? true),
        app_name: String(settingsRes.value.customer_app_settings?.app_name || 'Loyalty Club'),
        hero_title: String(settingsRes.value.customer_app_settings?.hero_title || 'Xoş gəldiniz'),
        hero_subtitle: String(settingsRes.value.customer_app_settings?.hero_subtitle || 'Bonuslarınızı, kampaniyaları və reward-ları bir yerdə izləyin.'),
        points_label: String(settingsRes.value.customer_app_settings?.points_label || 'Ulduz'),
        reward_name: String(settingsRes.value.customer_app_settings?.reward_name || 'Reward'),
        reward_threshold: String(settingsRes.value.customer_app_settings?.reward_threshold || 10),
        reward_description: String(settingsRes.value.customer_app_settings?.reward_description || '10 ulduza 1 pulsuz içki'),
        primary_color: String(settingsRes.value.customer_app_settings?.primary_color || '#facc15'),
        accent_color: String(settingsRes.value.customer_app_settings?.accent_color || '#22d3ee'),
        show_campaigns: Boolean(settingsRes.value.customer_app_settings?.show_campaigns ?? true),
        show_history: Boolean(settingsRes.value.customer_app_settings?.show_history ?? true),
        show_notifications: Boolean(settingsRes.value.customer_app_settings?.show_notifications ?? true),
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

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    const reader = new FileReader();
    reader.onload = () => setProfile((prev: any) => ({ ...(prev || {}), logo_url: reader.result as string }));
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
    flashSuccess(tx(lang, 'Biznes məlumatları yadda saxlanıldı', 'Данные бизнеса сохранены', 'Business profile saved'));
  };

  const handleCreateUser = async () => {
    const username = newUserName.trim();
    if (!username) {
      notify('error', tx(lang, 'İstifadəçi adı yazın', 'Введите имя пользователя', 'Enter a username'));
      return;
    }

    if (requiresPasswordForNewUser) {
      if (!newUserPassword || newUserPassword.length < 4) {
        notify('error', tx(lang, 'Admin/Manager üçün ən azı 4 simvolluq şifrə yazın', 'Для Admin/Manager введите пароль минимум из 4 символов', 'Enter a password with at least 4 characters for Admin/Manager'));
        return;
      }
    } else if (!newUserPin || newUserPin.length < 4) {
      notify('error', tx(lang, 'Staff/Kitchen üçün PIN yazın', 'Для Staff/Kitchen введите PIN', 'Enter a PIN for Staff/Kitchen'));
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
    if (!targetPin || targetPin.length < 4) {
      notify('error', tx(lang, 'Yeni PIN yazın', 'Введите новый PIN', 'Enter a new PIN'));
      return;
    }

    try {
      await update_user_credentials_live(targetUser, { pin: targetPin }, user?.username || 'admin');
      setTargetPin('');
      await loadData();
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
    if (!targetPassword || targetPassword.length < 4) {
      notify('error', tx(lang, 'Yeni şifrə minimum 4 simvol olmalıdır', 'Новый пароль должен быть минимум 4 символа', 'New password must be at least 4 characters'));
      return;
    }
    try {
      await update_user_credentials_live(targetPasswordUser, { password: targetPassword }, user?.username || 'admin');
      setTargetPassword('');
      await loadData();
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
    if (!newOwnPassword || newOwnPassword.length < 4) {
      notify('error', tx(lang, 'Yeni şifrə minimum 4 simvol olmalıdır', 'Новый пароль должен быть минимум 4 символа', 'New password must be at least 4 characters'));
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
      await disable_totp_live(totpDisablePassword);
      setTotpDisablePassword('');
      setTotpSetupUrl('');
      setTotpSecret('');
      setTotpQrDataUrl('');
      await loadData();
      flashSuccess(tx(lang, 'Google Authenticator söndürüldü', 'Google Authenticator отключен', 'Google Authenticator disabled'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, '2FA söndürülmədi', '2FA не отключен', 'Failed to disable 2FA'));
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
    flashSuccess(tx(lang, 'Rol icazələri yadda saxlanıldı', 'Права ролей сохранены', 'Role permissions saved'));
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
    flashSuccess(tx(lang, 'Email ayarları yadda saxlanıldı', 'Настройки email сохранены', 'Email settings saved'));
  };

  const savePrintSettings = () => {
    update_print_settings({
      use_qz: printSettings.use_qz,
      printer_name: printSettings.printer_name.trim(),
    });
    flashSuccess(tx(lang, 'Çap ayarları yadda saxlanıldı', 'Настройки печати сохранены', 'Print settings saved'));
  };

  const saveCustomerAppSettings = async () => {
    await update_customer_app_settings_live({
      enabled: customerAppSettings.enabled,
      app_name: customerAppSettings.app_name,
      hero_title: customerAppSettings.hero_title,
      hero_subtitle: customerAppSettings.hero_subtitle,
      points_label: customerAppSettings.points_label,
      reward_name: customerAppSettings.reward_name,
      reward_threshold: Number(customerAppSettings.reward_threshold || 10),
      reward_description: customerAppSettings.reward_description,
      primary_color: customerAppSettings.primary_color,
      accent_color: customerAppSettings.accent_color,
      show_campaigns: customerAppSettings.show_campaigns,
      show_history: customerAppSettings.show_history,
      show_notifications: customerAppSettings.show_notifications,
    });
    flashSuccess(tx(lang, 'Customer app ayarları yadda saxlanıldı', 'Настройки customer app сохранены', 'Customer app settings saved'));
  };

  const saveStaffBenefits = async () => {
    await update_staff_benefits_live({
      daily_limit_azn: Number(staffBenefits.daily_limit_azn || 0),
      allowed_scope: staffBenefits.allowed_scope,
      included_categories: staffBenefits.included_categories,
      included_items: staffBenefits.included_items,
      item_unit_cap_azn: Number(staffBenefits.item_unit_cap_azn || 0),
    });
    flashSuccess(tx(lang, 'Staff limit ayarları yadda saxlanıldı', 'Настройки лимита staff сохранены', 'Staff benefit settings saved'));
  };

  return (
    <div className="space-y-6">
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
          <input className="neon-input" value={profile?.company_name || ''} onChange={(e) => setProfile((prev: any) => ({ ...(prev || {}), company_name: e.target.value }))} placeholder={tx(lang, 'Şirkət adı', 'Название компании', 'Company name')} />
          <input className="neon-input" value={profile?.phone || ''} onChange={(e) => setProfile((prev: any) => ({ ...(prev || {}), phone: e.target.value }))} placeholder={tx(lang, 'Telefon', 'Телефон', 'Phone')} />
          <input className="neon-input" value={profile?.address || ''} onChange={(e) => setProfile((prev: any) => ({ ...(prev || {}), address: e.target.value }))} placeholder={tx(lang, 'Ünvan', 'Адрес', 'Address')} />
          <input className="neon-input" value={profile?.website || ''} onChange={(e) => setProfile((prev: any) => ({ ...(prev || {}), website: e.target.value }))} placeholder={tx(lang, 'Website', 'Сайт', 'Website')} />
          <input className="neon-input" value={profile?.qr_base_url || ''} onChange={(e) => setProfile((prev: any) => ({ ...(prev || {}), qr_base_url: e.target.value }))} placeholder={tx(lang, 'QR Base URL', 'QR Base URL', 'QR Base URL')} />
          <input className="neon-input md:col-span-2" value={profile?.receipt_footer || ''} onChange={(e) => setProfile((prev: any) => ({ ...(prev || {}), receipt_footer: e.target.value }))} placeholder={tx(lang, 'Qəbz alt mətni', 'Текст внизу чека', 'Receipt footer')} />
          <input className="neon-input md:col-span-2" type="file" accept="image/*" onChange={handleLogoUpload} />
        </div>
        <div className="flex justify-end">
          <button onClick={() => { void saveBusinessProfile(); }} className="glossy-gold rounded-xl px-6 py-2 font-bold">{tx(lang, 'Saxla', 'Сохранить', 'Save')}</button>
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
        <div className="flex justify-end">
          <button onClick={() => { void saveEmailSettings(); }} className="glossy-gold rounded-xl px-6 py-2 font-bold">{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
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
        <div className="flex justify-end">
          <button onClick={savePrintSettings} className="glossy-gold rounded-xl px-6 py-2 font-bold">{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Customer App', 'Customer App', 'Customer App')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Müştəri portalının adı, mətnləri, xal adı və reward həddi tenant-a görə buradan dəyişdirilir.',
            'Здесь настраиваются название, тексты, название баллов и порог награды клиентского приложения.',
            'Customize the customer app name, copy, point label, and reward threshold for this tenant here.',
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
            <input type="checkbox" checked={customerAppSettings.enabled} onChange={(e) => setCustomerAppSettings((prev) => ({ ...prev, enabled: e.target.checked }))} />
            <span>{tx(lang, 'Customer app aktiv olsun', 'Включить customer app', 'Enable customer app')}</span>
          </label>
          <input className="neon-input" value={customerAppSettings.app_name} onChange={(e) => setCustomerAppSettings((prev) => ({ ...prev, app_name: e.target.value }))} placeholder={tx(lang, 'App adı', 'Название приложения', 'App name')} />
          <input className="neon-input" value={customerAppSettings.points_label} onChange={(e) => setCustomerAppSettings((prev) => ({ ...prev, points_label: e.target.value }))} placeholder={tx(lang, 'Point adı', 'Название баллов', 'Point label')} />
          <input className="neon-input" value={customerAppSettings.hero_title} onChange={(e) => setCustomerAppSettings((prev) => ({ ...prev, hero_title: e.target.value }))} placeholder={tx(lang, 'Başlıq', 'Заголовок', 'Hero title')} />
          <input className="neon-input" value={customerAppSettings.reward_name} onChange={(e) => setCustomerAppSettings((prev) => ({ ...prev, reward_name: e.target.value }))} placeholder={tx(lang, 'Reward adı', 'Название награды', 'Reward name')} />
          <input className="neon-input md:col-span-2" value={customerAppSettings.hero_subtitle} onChange={(e) => setCustomerAppSettings((prev) => ({ ...prev, hero_subtitle: e.target.value }))} placeholder={tx(lang, 'Qısa izah', 'Краткое описание', 'Hero subtitle')} />
          <input className="neon-input" type="number" min={1} value={customerAppSettings.reward_threshold} onChange={(e) => setCustomerAppSettings((prev) => ({ ...prev, reward_threshold: e.target.value }))} placeholder={tx(lang, 'Reward həddi', 'Порог награды', 'Reward threshold')} />
          <input className="neon-input md:col-span-2" value={customerAppSettings.reward_description} onChange={(e) => setCustomerAppSettings((prev) => ({ ...prev, reward_description: e.target.value }))} placeholder={tx(lang, 'Reward izahı', 'Описание награды', 'Reward description')} />
          <input className="neon-input" value={customerAppSettings.primary_color} onChange={(e) => setCustomerAppSettings((prev) => ({ ...prev, primary_color: e.target.value }))} placeholder={tx(lang, 'Primary rəng', 'Primary цвет', 'Primary color')} />
          <input className="neon-input" value={customerAppSettings.accent_color} onChange={(e) => setCustomerAppSettings((prev) => ({ ...prev, accent_color: e.target.value }))} placeholder={tx(lang, 'Accent rəng', 'Accent цвет', 'Accent color')} />
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={customerAppSettings.show_campaigns} onChange={(e) => setCustomerAppSettings((prev) => ({ ...prev, show_campaigns: e.target.checked }))} />
            <span>{tx(lang, 'Kampaniyaları göstər', 'Показывать кампании', 'Show campaigns')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={customerAppSettings.show_history} onChange={(e) => setCustomerAppSettings((prev) => ({ ...prev, show_history: e.target.checked }))} />
            <span>{tx(lang, 'Tarixçəni göstər', 'Показывать историю', 'Show history')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
            <input type="checkbox" checked={customerAppSettings.show_notifications} onChange={(e) => setCustomerAppSettings((prev) => ({ ...prev, show_notifications: e.target.checked }))} />
            <span>{tx(lang, 'Bildirişləri göstər', 'Показывать уведомления', 'Show notifications')}</span>
          </label>
        </div>
        <div className="flex justify-end">
          <button onClick={() => { void saveCustomerAppSettings(); }} className="glossy-gold rounded-xl px-6 py-2 font-bold">{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
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
        <div className="flex justify-end">
          <button onClick={() => { void saveStaffBenefits(); }} className="glossy-gold rounded-xl px-6 py-2 font-bold">{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
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

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Rol İcazələri', 'Права ролей', 'Role Permissions')}</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {(['staff', 'manager', 'kitchen'] as const).map((role) => (
            <div key={role} className="rounded-xl border border-slate-700/70 bg-slate-900/30 p-4 space-y-2">
              <h3 className="font-semibold uppercase tracking-wide text-slate-200">{role}</h3>
              {moduleCatalog.map((moduleKey) => (
                <label key={`${role}_${moduleKey}`} className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" checked={(roleModules[role] || []).includes(moduleKey)} onChange={() => toggleRoleModule(role, moduleKey)} />
                  <span>{moduleKey}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <button onClick={() => { void saveRoleModules(); }} className="neon-btn rounded-xl px-5 py-2 font-semibold">{tx(lang, 'Rol İcazələrini Saxla', 'Сохранить права ролей', 'Save Role Permissions')}</button>
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

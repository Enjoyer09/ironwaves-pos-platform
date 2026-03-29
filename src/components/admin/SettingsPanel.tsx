import React, { useEffect, useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';
import {
  create_user_live,
  delete_user_live,
  get_business_profile_live,
  get_settings_live,
  get_users_live,
  update_email_settings_live,
  update_business_profile_live,
  update_print_settings,
  update_qr_settings_live,
  update_role_modules_live,
  update_staff_benefits_live,
  update_user_credentials_live,
} from '../../api/settings';
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
  const [staffBenefits, setStaffBenefits] = useState({
    daily_limit_azn: '6',
    allow_coffee: true,
    allow_non_coffee: true,
    non_coffee_unit_cap_azn: '2',
  });

  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'staff' | 'kitchen' | 'manager' | 'admin'>('staff');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserPin, setNewUserPin] = useState('');

  const [targetUser, setTargetUser] = useState('');
  const [targetPin, setTargetPin] = useState('');
  const [deleteUserName, setDeleteUserName] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newOwnPassword, setNewOwnPassword] = useState('');
  const [confirmOwnPassword, setConfirmOwnPassword] = useState('');

  const requiresPasswordForNewUser = ['admin', 'manager'].includes(newUserRole);
  const pinUsers = users.filter((u) => ['staff', 'kitchen'].includes(String(u.role || '').toLowerCase()));

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
      setStaffBenefits({
        daily_limit_azn: String(settingsRes.value.staff_benefits?.daily_limit_azn ?? 6),
        allow_coffee: Boolean(settingsRes.value.staff_benefits?.allow_coffee ?? true),
        allow_non_coffee: Boolean(settingsRes.value.staff_benefits?.allow_non_coffee ?? true),
        non_coffee_unit_cap_azn: String(settingsRes.value.staff_benefits?.non_coffee_unit_cap_azn ?? 2),
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

  const saveStaffBenefits = async () => {
    await update_staff_benefits_live({
      daily_limit_azn: Number(staffBenefits.daily_limit_azn || 0),
      allow_coffee: staffBenefits.allow_coffee,
      allow_non_coffee: staffBenefits.allow_non_coffee,
      non_coffee_unit_cap_azn: Number(staffBenefits.non_coffee_unit_cap_azn || 0),
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
            value={staffBenefits.non_coffee_unit_cap_azn}
            onChange={(e) => setStaffBenefits((prev) => ({ ...prev, non_coffee_unit_cap_azn: e.target.value }))}
            placeholder={tx(lang, 'Qeyri-kofe vahid limiti', 'Лимит на единицу некофе', 'Non-coffee unit cap')}
          />
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={staffBenefits.allow_coffee} onChange={(e) => setStaffBenefits((prev) => ({ ...prev, allow_coffee: e.target.checked }))} />
            <span>{tx(lang, 'Kofe məhsulları staff limitinə daxil olsun', 'Кофе входит в staff-лимит', 'Coffee items use staff benefit')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={staffBenefits.allow_non_coffee} onChange={(e) => setStaffBenefits((prev) => ({ ...prev, allow_non_coffee: e.target.checked }))} />
            <span>{tx(lang, 'Qeyri-kofe məhsulları da staff limitinə daxil olsun', 'Некофе тоже входит в staff-лимит', 'Non-coffee items also use staff benefit')}</span>
          </label>
        </div>
        <div className="flex justify-end">
          <button onClick={() => { void saveStaffBenefits(); }} className="glossy-gold rounded-xl px-6 py-2 font-bold">{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>

      {['admin', 'manager', 'super_admin'].includes(currentRole) ? (
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

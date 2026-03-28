import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../store';
import { Settings, Save } from 'lucide-react';
import { tx } from '../../i18n';
import {
  get_business_profile,
  update_business_profile,
  create_user_live,
  delete_user_live,
  get_users_live,
  update_user_credentials_live,
  get_settings,
  update_role_modules,
  update_print_settings,
  update_email_settings,
  update_omnitech_settings,
  update_inventory_settings,
} from '../../api/settings';
import { authApi } from '../../api/auth';
import { isBackendEnabled } from '../../api/client';
import {
  create_tenant,
  list_tenants,
  TenantRecord,
  suspend_tenant,
  delete_tenant,
  clone_tenant_as_demo,
} from '../../api/tenants';
import ConfirmModal from '../ConfirmModal';
import { getActiveTenantId, resolveTenantIdFromHost } from '../../lib/tenant';

export default function SettingsPanel() {
  // Default ON for stability; can be disabled with VITE_SINGLE_TENANT_MODE=false.
  const singleTenantMode = String((import.meta as any)?.env?.VITE_SINGLE_TENANT_MODE ?? 'true').toLowerCase() !== 'false';
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const backendMode = isBackendEnabled();

  const [successMsg, setSuccessMsg] = useState('');
  const [profile, setProfile] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [newUserName, setNewUserName] = useState('');
  const [newUserPin, setNewUserPin] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<'staff' | 'kitchen' | 'manager' | 'admin'>('staff');
  const [targetUser, setTargetUser] = useState('');
  const [targetPin, setTargetPin] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newOwnPassword, setNewOwnPassword] = useState('');
  const [confirmOwnPassword, setConfirmOwnPassword] = useState('');
  const [newOwn2faPin, setNewOwn2faPin] = useState('');
  const [own2faEnabled, setOwn2faEnabled] = useState(false);
  const [deleteUserName, setDeleteUserName] = useState<string | null>(null);
  const [roleModules, setRoleModules] = useState<{ staff: string[]; manager: string[]; kitchen: string[] }>({ staff: [], manager: [], kitchen: [] });
  const [printSettings, setPrintSettings] = useState<{ use_qz: boolean; printer_name: string }>({ use_qz: false, printer_name: '' });
  const [inventorySettings, setInventorySettings] = useState<{ default_critical_threshold: number; unit_options: string[] }>({
    default_critical_threshold: 5,
    unit_options: ['kq', 'qram', 'litr', 'ml', 'ədəd', 'metr'],
  });
  const [unitDraft, setUnitDraft] = useState('kq, qram, litr, ml, ədəd, metr');
  const [omnitechSettings, setOmnitechSettings] = useState<{
    enabled: boolean;
    api_base_url: string;
    api_key: string;
    merchant_id: string;
    terminal_id: string;
    fiscal_device_id: string;
  }>({
    enabled: false,
    api_base_url: '',
    api_key: '',
    merchant_id: '',
    terminal_id: '',
    fiscal_device_id: '',
  });
  const [emailSettings, setEmailSettings] = useState<{
    enabled: boolean;
    provider: 'none' | 'resend' | 'webhook';
    resend_api_key: string;
    sender_email: string;
    recipient_emails: string;
    webhook_url: string;
    timeout_sec: number;
  }>({
    enabled: false,
    provider: 'none',
    resend_api_key: '',
    sender_email: '',
    recipient_emails: '',
    webhook_url: '',
    timeout_sec: 15,
  });
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [tenantCompanyName, setTenantCompanyName] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [tenantDomain, setTenantDomain] = useState('');
  const [tenantAdminUsername, setTenantAdminUsername] = useState('admin');
  const [tenantAdminPassword, setTenantAdminPassword] = useState('');
  const [createdCreds, setCreatedCreds] = useState<{ title: string; username: string; password: string; twofa_pin?: string; tenant_id: string; domain: string } | null>(null);
  const [cloneSourceTenant, setCloneSourceTenant] = useState('');
  const [cloneSlug, setCloneSlug] = useState('');
  const [cloneDomain, setCloneDomain] = useState('');

  const moduleCatalog = [
    'pos', 'tables', 'kds', 'zreport', 'finance', 'inventory', 'combos', 'analytics', 'logs', 'crm', 'ai', 'menu', 'recipes'
  ];
  const host = typeof window !== 'undefined' ? window.location.host : 'server';
  const mappedTenant = resolveTenantIdFromHost(host);
  const activeTenant = getActiveTenantId();
  const isPlatformOwner = !singleTenantMode && String(user?.role || '').toLowerCase() === 'super_admin';

  const loadData = async () => {
    try {
      setProfile(get_business_profile(tenant_id));
      const tenantUsers = await get_users_live(tenant_id);
      setUsers(tenantUsers);
      const me = tenantUsers.find((u) => u.username === user?.username);
      setOwn2faEnabled(Boolean(me?.two_factor_enabled));
      const settings = get_settings(tenant_id);
      setRoleModules(settings.role_modules || { staff: ['pos'], manager: ['pos'], kitchen: ['kds'] });
      setPrintSettings(settings.print_settings || { use_qz: false, printer_name: '' });
      const inv = settings.inventory_settings || { default_critical_threshold: 5, unit_options: ['kq', 'qram', 'litr', 'ml', 'ədəd', 'metr'] };
      setInventorySettings(inv);
      setUnitDraft((inv.unit_options || []).join(', '));
      setOmnitechSettings(
        settings.omnitech_settings || {
          enabled: false,
          api_base_url: '',
          api_key: '',
          merchant_id: '',
          terminal_id: '',
          fiscal_device_id: '',
        }
      );
      const em = settings.email_settings || {
        enabled: false,
        provider: 'none',
        resend_api_key: '',
        sender_email: '',
        recipient_emails: [],
        webhook_url: '',
        timeout_sec: 15,
      };
      setEmailSettings({
        enabled: Boolean(em.enabled),
        provider: (em.provider as any) || 'none',
        resend_api_key: em.resend_api_key || '',
        sender_email: em.sender_email || '',
        recipient_emails: (em.recipient_emails || []).join(', '),
        webhook_url: (em as any).webhook_url || '',
        timeout_sec: Number((em as any).timeout_sec || 15),
      });

      if (isPlatformOwner) {
        const tenantRows = await list_tenants();
        setTenants(tenantRows);
      } else {
        setTenants([]);
      }
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Ayarları yükləmək alınmadı', 'Не удалось загрузить настройки', 'Failed to load settings'));
    }
  };

  useEffect(() => {
    void loadData();
  }, [tenant_id]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    const reader = new FileReader();
    reader.onload = () => {
      setProfile({ ...(profile || {}), logo_url: reader.result as string });
    };
    reader.readAsDataURL(file);
  };

  const saveBusinessProfile = () => {
    if (!profile) return;
    update_business_profile(tenant_id, profile, user?.username || 'admin');
    setSuccessMsg(tx(lang, 'Biznes məlumatları yadda saxlanıldı!', 'Данные бизнеса сохранены!'));
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  const handleCreateUser = async () => {
    const username = newUserName.trim();
    if (!username) {
      notify('error', tx(lang, 'İstifadəçi adı boş ola bilməz', 'Имя пользователя не может быть пустым', 'Username cannot be empty'));
      return;
    }
    const requiresPassword = ['admin', 'manager'].includes(newUserRole);
    if (requiresPassword && !newUserPassword) {
      notify('error', tx(lang, 'Admin/Manager üçün şifrə tələb olunur', 'Для Admin/Manager требуется пароль', 'Password is required for Admin/Manager'));
      return;
    }
    if (!requiresPassword && !newUserPin) {
      notify('error', tx(lang, 'Staff/Kitchen üçün PIN tələb olunur', 'Для Staff/Kitchen требуется PIN', 'PIN is required for Staff/Kitchen'));
      return;
    }
    try {
      await create_user_live({
        tenant_id,
        username,
        role: newUserRole,
        pin: requiresPassword ? undefined : newUserPin,
        password: requiresPassword ? newUserPassword : undefined,
      } as any);
      setNewUserName('');
      setNewUserPin('');
      setNewUserPassword('');
      notify('success', tx(lang, 'İstifadəçi yaradıldı', 'Пользователь создан', 'User created'));
      void loadData();
    } catch (e: any) {
      notify('error', e.message);
    }
  };

  const handleDeleteUser = async (username: string) => {
    try {
      await delete_user_live(username);
      void loadData();
      notify('success', tx(lang, 'İstifadəçi silindi', 'Пользователь удален'));
      setDeleteUserName(null);
    } catch (e: any) {
      notify('error', e.message);
    }
  };

  const handleUpdatePin = async () => {
    if (!targetUser || !targetPin) return;
    try {
      await update_user_credentials_live(targetUser, { pin: targetPin }, user?.username || 'admin');
      setTargetPin('');
      setSuccessMsg(tx(lang, 'İstifadəçi PIN yeniləndi!', 'PIN пользователя обновлен!'));
      setTimeout(() => setSuccessMsg(''), 2500);
      void loadData();
    } catch (e: any) {
      notify('error', e.message);
    }
  };

  const handleChangeOwnSecurity = async () => {
    if (!user?.username) return;
    const wantsPasswordChange = Boolean(newOwnPassword || confirmOwnPassword);
    const wants2faChange = own2faEnabled || Boolean(newOwn2faPin);
    if (!wantsPasswordChange && !wants2faChange) {
      notify('error', tx(lang, 'Heç bir dəyişiklik seçilməyib', 'Не выбрано ни одного изменения', 'No changes selected'));
      return;
    }
    if (wantsPasswordChange) {
      if (!newOwnPassword || newOwnPassword.length < 4) {
        notify('error', tx(lang, 'Yeni şifrə minimum 4 simvol olmalıdır', 'Новый пароль должен содержать минимум 4 символа', 'New password must be at least 4 characters'));
        return;
      }
      if (newOwnPassword !== confirmOwnPassword) {
        notify('error', tx(lang, 'Şifrə təkrarı uyğun deyil', 'Подтверждение пароля не совпадает', 'Password confirmation does not match'));
        return;
      }
    }
    if (newOwn2faPin && (newOwn2faPin.length < 4 || newOwn2faPin.length > 15)) {
      notify('error', tx(lang, '2FA PIN 4-15 rəqəm aralığında olmalıdır', '2FA PIN должен быть 4-15 цифр', '2FA PIN must be 4-15 digits'));
      return;
    }
    if (own2faEnabled && !(newOwn2faPin || users.find((u) => u.username === user.username)?.pin)) {
      notify('error', tx(lang, '2FA aktiv etmək üçün PIN təyin edin', 'Для включения 2FA укажите PIN', 'Set a PIN to enable 2FA'));
      return;
    }

    const me = users.find((u) => u.username === user.username);
    if (!me) {
      notify('error', tx(lang, 'Hesab məlumatı tapılmadı', 'Данные аккаунта не найдены', 'Account data not found'));
      return;
    }
    if (backendMode && !currentPassword) {
      notify('error', tx(lang, 'Mövcud şifrəni daxil edin', 'Введите текущий пароль', 'Enter current password'));
      return;
    }
    if (!backendMode && String(me.password || '') !== String(currentPassword || '')) {
      notify('error', tx(lang, 'Mövcud şifrə yanlışdır', 'Текущий пароль неверный', 'Current password is incorrect'));
      return;
    }

    try {
      await update_user_credentials_live(
        user.username,
        {
          password: wantsPasswordChange ? newOwnPassword : me.password,
          pin: newOwn2faPin || me.pin,
          two_factor_enabled: own2faEnabled,
          current_password: currentPassword,
        },
        user.username,
      );
      setCurrentPassword('');
      setNewOwnPassword('');
      setConfirmOwnPassword('');
      setNewOwn2faPin('');
      setSuccessMsg(tx(lang, 'Təhlükəsizlik məlumatları yeniləndi', 'Данные безопасности обновлены', 'Security settings updated'));
      setTimeout(() => setSuccessMsg(''), 2500);
      // If 2FA is disabled, clear temporary admin lock counters for smoother login.
      if (!own2faEnabled) {
        authApi.reset_admin_lockout(user.username);
      }
      await loadData();
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Yeniləmə xətası', 'Ошибка обновления', 'Update failed'));
    }
  };

  const handleUnlockOwnAccount = () => {
    if (!user?.username) return;
    authApi.reset_admin_lockout(user.username);
    notify('success', tx(lang, 'Hesab kilidi sıfırlandı', 'Блокировка аккаунта сброшена', 'Account lockout reset'));
  };

  const toggleRoleModule = (role: 'staff' | 'manager' | 'kitchen', moduleKey: string) => {
    setRoleModules((prev) => {
      const list = prev[role] || [];
      const has = list.includes(moduleKey);
      return {
        ...prev,
        [role]: has ? list.filter((m) => m !== moduleKey) : [...list, moduleKey],
      };
    });
className="neon-input"
            type="number"
            min={5}
            value={emailSettings.timeout_sec}
            onChange={(e) => setEmailSettings((prev) => ({ ...prev, timeout_sec: Number(e.target.value || 15) }))}
            placeholder={tx(lang, 'Timeout (san)', 'Timeout (сек)', 'Timeout (sec)')}
          />

          <input
            className="neon-input"
            value={emailSettings.sender_email}
            onChange={(e) => setEmailSettings((prev) => ({ ...prev, sender_email: e.target.value }))}
            placeholder={tx(lang, 'Göndərən email', 'Email отправителя', 'Sender email')}
          />
        </div>

        <input
          className="neon-input"
          value={emailSettings.recipient_emails}
          onChange={(e) => setEmailSettings((prev) => ({ ...prev, recipient_emails: e.target.value }))}
          placeholder={tx(lang, 'Alıcı email-lər (vergüllə)', 'Email получателей (через запятую)', 'Recipient emails (comma separated)')}
        />

        {emailSettings.provider === 'resend' && (
          <input
            className="neon-input"
            value={emailSettings.resend_api_key}
            onChange={(e) => setEmailSettings((prev) => ({ ...prev, resend_api_key: e.target.value }))}
            placeholder="Resend API Key"
          />
        )}

        {emailSettings.provider === 'webhook' && (
          <input
            className="neon-input"
            value={emailSettings.webhook_url}
            onChange={(e) => setEmailSettings((prev) => ({ ...prev, webhook_url: e.target.value }))}
            placeholder={tx(lang, 'Webhook URL', 'Webhook URL', 'Webhook URL')}
          />
        )}

        <button onClick={saveEmailSettings} className="neon-btn px-5 py-2 rounded-xl font-semibold">
          {tx(lang, 'Email API Ayarlarını Saxla', 'Сохранить настройки Email API', 'Save Email API Settings')}
        </button>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold">Omnitech API</h2>
        <p className="text-xs text-slate-400">
          {tx(
            lang,
            'Fiscal/e-kassa inteqrasiyası üçün Omnitech API məlumatlarını buradan daxil edin.',
            'Введите параметры Omnitech API для интеграции fiscal/e-kassa.',
            'Configure Omnitech API credentials for fiscal/e-kassa integration.'
          )}
        </p>

        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={omnitechSettings.enabled}
            onChange={(e) => setOmnitechSettings((prev) => ({ ...prev, enabled: e.target.checked }))}
          />
          <span>{tx(lang, 'Omnitech inteqrasiyasını aktiv et', 'Включить интеграцию Omnitech', 'Enable Omnitech integration')}</span>
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            className="neon-input"
            placeholder={tx(lang, 'API Base URL', 'Базовый URL API', 'API Base URL')}
            value={omnitechSettings.api_base_url}
            onChange={(e) => setOmnitechSettings((prev) => ({ ...prev, api_base_url: e.target.value }))}
          />
          <input
            className="neon-input"
            placeholder={tx(lang, 'API Key', 'API ключ', 'API Key')}
            value={omnitechSettings.api_key}
            onChange={(e) => setOmnitechSettings((prev) => ({ ...prev, api_key: e.target.value }))}
          />
          <input
            className="neon-input"
            placeholder={tx(lang, 'Merchant ID', 'Merchant ID', 'Merchant ID')}
            value={omnitechSettings.merchant_id}
            onChange={(e) => setOmnitechSettings((prev) => ({ ...prev, merchant_id: e.target.value }))}
          />
          <input
            className="neon-input"
            placeholder={tx(lang, 'Terminal ID', 'Terminal ID', 'Terminal ID')}
            value={omnitechSettings.terminal_id}
            onChange={(e) => setOmnitechSettings((prev) => ({ ...prev, terminal_id: e.target.value }))}
          />
          <input
            className="neon-input md:col-span-2"
            placeholder={tx(lang, 'Fiscal Device ID', 'ID фискального устройства', 'Fiscal Device ID')}
            value={omnitechSettings.fiscal_device_id}
            onChange={(e) => setOmnitechSettings((prev) => ({ ...prev, fiscal_device_id: e.target.value }))}
          />
        </div>

        <button onClick={saveOmnitechSettings} className="neon-btn px-5 py-2 rounded-xl font-semibold">
          {tx(lang, 'Omnitech Ayarlarını Saxla', 'Сохранить настройки Omnitech', 'Save Omnitech Settings')}
        </button>
      </div>

      {isPlatformOwner && (
        <div className="metal-panel p-6 space-y-4">
          <h2 className="text-xl font-bold">Tenant Manager</h2>
          <p className="text-xs text-slate-400">
            {tx(
              lang,
              'Yeni şirkət əlavə etdikdə sistem avtomatik tenant, domen mapping, default admin və başlanğıc məlumatlarını yaradır.',
              'При добавлении новой компании система автоматически создаёт тенант, домен, admin и стартовые данные.',
              'When adding a new company, system auto-provisions tenant, domain mapping, admin and default seed data.'
            )}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              className="neon-input"
              placeholder={tx(lang, 'Şirkət adı', 'Название компании', 'Company name')}
              value={tenantCompanyName}
              onChange={(e) => setTenantCompanyName(e.target.value)}
            />
            <input
              className="neon-input"
              placeholder={tx(lang, 'Slug (məs: socialbee)', 'Slug (напр.: socialbee)', 'Slug (e.g.: socialbee)')}
              value={tenantSlug}
              onChange={(e) => setTenantSlug(e.target.value)}
            />
            <input
              className="neon-input"
              placeholder={tx(lang, 'Domain (məs: socialbee.ironwaves.store)', 'Домен (напр.: socialbee.ironwaves.store)', 'Domain (e.g.: socialbee.ironwaves.store)')}
              value={tenantDomain}
              onChange={(e) => setTenantDomain(e.target.value)}
            />
            <input
              className="neon-input"
              placeholder={tx(lang, 'Admin username', 'Admin username', 'Admin username')}
              value={tenantAdminUsername}
              onChange={(e) => setTenantAdminUsername(e.target.value)}
            />
            <input
              className="neon-input"
              placeholder={tx(lang, 'Admin password', 'Admin password', 'Admin password')}
              value={tenantAdminPassword}
              onChange={(e) => setTenantAdminPassword(e.target.value)}
            />
          </div>

          <button onClick={handleCreateTenant} className="glossy-gold rounded-xl px-5 py-2 font-bold">
            {tx(lang, 'Tenant Yarat', 'Создать тенант', 'Create Tenant')}
          </button>

          <div className="rounded-xl border border-slate-700/70 p-4 space-y-3">
            <h3 className="font-semibold text-slate-200">{tx(lang, 'Tenant Klonlama (Demo)', 'Клонирование тенанта (Демо)', 'Tenant Clone (Demo)')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <select className="neon-input" value={cloneSourceTenant} onChange={(e) => setCloneSourceTenant(e.target.value)}>
                <option value="">{tx(lang, 'Mənbə tenant seçin', 'Выберите исходный тенант', 'Select source tenant')}</option>
                {tenants.map((tRow) => (
                  <option key={tRow.id} value={tRow.tenant_id}>{tRow.tenant_id}</option>
                ))}
              </select>
              <input
                className="neon-input"
                placeholder={tx(lang, 'Demo slug', 'Demo slug', 'Demo slug')}
                value={cloneSlug}
                onChange={(e) => setCloneSlug(e.target.value)}
              />
              <input
                className="neon-input"
                placeholder={tx(lang, 'Demo domain (opsional)', 'Demo домен (опционально)', 'Demo domain (optional)')}
                value={cloneDomain}
                onChange={(e) => setCloneDomain(e.target.value)}
              />
            </div>
            <button onClick={handleCloneDemo} className="neon-btn px-4 py-2 rounded-xl font-semibold">
              {tx(lang, 'Demo Tenant Yarat', 'Создать демо-тенант', 'Create Demo Tenant')}
            </button>
          </div>

          <div className="overflow-auto border border-slate-700/70 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/70 text-slate-200">
                <tr>
                  <th className="text-left px-3 py-2">Tenant</th>
                  <th className="text-left px-3 py-2">Company</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Created</th>
                  <th className="text-left px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tRow) => (
                  <tr key={tRow.id} className="border-t border-slate-700/70">
                    <td className="px-3 py-2 font-semibold text-slate-100">{tRow.tenant_id}</td>
                    <td className="px-3 py-2 text-slate-300">{tRow.company_name}</td>
                    <td className="px-3 py-2 text-slate-300">{tRow.status}</td>
                    <td className="px-3 py-2 text-slate-400">{new Date(tRow.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSuspendTenant(tRow.tenant_id)}
                          className="rounded-lg border border-amber-400/50 px-2 py-1 text-xs text-amber-200 hover:bg-amber-500/10"
                        >
                          {tx(lang, 'Suspend', 'Suspend', 'Suspend')}
                        </button>
                        <button
                          onClick={() => handleDeleteTenant(tRow.tenant_id)}
                          disabled={tRow.tenant_id === 'tenant_default'}
                          className="rounded-lg border border-red-400/50 px-2 py-1 text-xs text-red-200 hover:bg-red-500/10 disabled:opacity-40"
                        >
                          {tx(lang, 'Sil', 'Удалить', 'Delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {tenants.length === 0 && (
                  <tr>
                    <td className="px-3 py-3 text-slate-400" colSpan={5}>
                      {tx(lang, 'Tenant tapılmadı', 'Тенанты не найдены', 'No tenants found')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isPlatformOwner && (
        <div className="metal-panel overflow-hidden">
          <div className="p-6 border-b border-slate-700/70">
            <h2 className="text-xl font-bold text-slate-100">
              {tx(lang, 'Super Admin Təhlükəsizlik', 'Безопасность Super Admin', 'Super Admin Security')}
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              {tx(
                lang,
                '2FA default söndürülüdür. İstəsəniz buradan aktiv edə bilərsiniz.',
                '2FA по умолчанию выключен. Здесь можно включить его.',
                '2FA is disabled by default. Enable it here when needed.',
              )}
            </p>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="md:col-span-2 inline-flex items-center gap-2 text-slate-200">
              <input type="checkbox" checked={own2faEnabled} onChange={(e) => setOwn2faEnabled(e.target.checked)} />
              {tx(lang, '2FA qorumasını aktiv et', 'Включить защиту 2FA', 'Enable 2FA protection')}
            </label>
            <input
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              type="password"
              placeholder={tx(lang, 'Mövcud şifrə', 'Текущий пароль', 'Current password')}
              className="neon-input"
            />
            <input
              value={newOwn2faPin}
              onChange={(e) => setNewOwn2faPin(e.target.value.replace(/\D/g, '').slice(0, 15))}
              type="password"
              placeholder={tx(lang, 'Yeni 2FA PIN (4-15 rəqəm)', 'Новый 2FA PIN (4-15 цифр)', 'New 2FA PIN (4-15 digits)')}
              className="neon-input"
            />
              <input
              value={newOwnPassword}
              onChange={(e) => setNewOwnPassword(e.target.value)}
              type="password"
              placeholder={tx(lang, 'Yeni şifrə (istəyə bağlı)', 'Новый пароль (необязательно)', 'New password (optional)')}
              className="neon-input"
            />
            <input
              value={confirmOwnPassword}
              onChange={(e) => setConfirmOwnPassword(e.target.value)}
              type="password"
              placeholder={tx(lang, 'Yeni şifrə təkrarı (istəyə bağlı)', 'Повторите новый пароль (необязательно)', 'Confirm new password (optional)')}
              className="neon-input"
            />
            <div className="md:col-span-2 flex justify-end gap-3">
              <button onClick={handleUnlockOwnAccount} className="neon-btn rounded-xl px-4 py-2 font-semibold">
                {tx(lang, 'Kilidi Aç', 'Сбросить блокировку', 'Unlock Account')}
              </button>
              <button onClick={handleChangeOwnSecurity} className="glossy-gold rounded-xl px-6 py-2 font-bold">
                {tx(lang, 'Təhlükəsizliyi Yenilə', 'Обновить безопасность', 'Update Security')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="metal-panel overflow-hidden">
         <div className="p-6 border-b border-slate-700/70 flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'İstifadəçi İdarəetməsi', 'Управление пользователями')}</h2>
         </div>
         <div className="p-6">
              <p className="text-slate-300 mb-4">{tx(lang, 'Buradan yeni işçi yarada və PIN dəyişə bilərsiniz. Admin üçün 2FA yalnız aktiv ediləndə tələb olunur.', 'Здесь можно создавать сотрудников и менять PIN. Для Admin 2FA требуется только когда включен.', 'Create staff and change PIN here. Admin 2FA is required only when enabled.')}</p>
            <div className="flex gap-4 mb-6">
              <input value={newUserName} onChange={(e) => setNewUserName(e.target.value)} type="text" placeholder={tx(lang, 'İstifadəçi Adı', 'Имя пользователя')} className="neon-input flex-1" />
              <select value={newUserRole} onChange={(e) => setNewUserRole(e.target.value as any)} className="neon-input bg-transparent">
                <option value="staff">{tx(lang, 'Staff (Kassir)', 'Кассир')}</option>
                <option value="kitchen">{tx(lang, 'Mətbəx (Kitchen)', 'Кухня')}</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
              {['admin', 'manager'].includes(newUserRole) ? (
                <input
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  type="password"
                  placeholder={tx(lang, 'Şifrə (Admin/Manager)', 'Пароль (Admin/Manager)', 'Password (Admin/Manager)')}
                  className="neon-input flex-1"
                />
              ) : (
                <input
                  value={newUserPin}
                  onChange={(e) => setNewUserPin(e.target.value.replace(/\D/g, '').slice(0, 15))}
                  type="text"
                  placeholder={tx(lang, 'PIN (Staff/Kitchen, məs: 1234)', 'PIN (Staff/Kitchen, напр.: 1234)', 'PIN (Staff/Kitchen, e.g. 1234)')}
                  className="neon-input flex-1"
                />
              )}
              <button onClick={handleCreateUser} className="glossy-gold rounded-xl px-6 py-2 font-bold">{tx(lang, 'Yarat', 'Создать')}</button>
            </div>

            <div className="grid grid-cols-1 gap-3 border-t border-slate-700/70 pt-4">
              {users.map((u) => (
                <div key={u.id || u.username} className="flex items-center justify-between rounded-xl border border-slate-700 px-4 py-3">
                  <div>
                    <div className="font-semibold text-slate-100">{u.username}</div>
                     <div className="text-xs text-slate-400">{tx(lang, 'Rol', 'Роль')}: {u.role}</div>
                  </div>
                  <button onClick={() => setDeleteUserName(u.username)} className="rounded-lg border border-red-400/50 px-3 py-1 text-sm text-red-300 hover:bg-red-500/10">{tx(lang, 'Sil', 'Удалить')}</button>
                </div>
              ))}
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3 border-t border-slate-700/70 pt-4">
              <select value={targetUser} onChange={(e) => setTargetUser(e.target.value)} className="neon-input">
                <option value="">{tx(lang, 'İstifadəçi seçin', 'Выберите пользователя')}</option>
                {users.filter((u) => ['staff', 'kitchen'].includes(String(u.role || '').toLowerCase())).map((u) => (
                  <option key={u.id || u.username} value={u.username}>{u.username}</option>
                ))}
              </select>
              <input value={targetPin} onChange={(e) => setTargetPin(e.target.value)} type="text" placeholder={tx(lang, 'Yeni PIN', 'Новый PIN')} className="neon-input" />
              <button onClick={handleUpdatePin} className="neon-btn px-4 py-2">{tx(lang, 'PIN Dəyiş', 'Изменить PIN')}</button>
            </div>
         </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold">{tx(lang, 'Rol İcazələri (Modul Matrisi)', 'Права ролей (матрица модулей)', 'Role Permissions (Module Matrix)')}</h2>
        <p className="text-sm text-slate-300">
          {tx(
            lang,
            'Dünya praktikası: Kitchen yalnız KDS, Staff əməliyyat modulları, Manager idarəetmə modulları.',
            'Практика: Kitchen только KDS, Staff операционные модули, Manager управленческие модули.',
            'Best practice: Kitchen only KDS, Staff operational modules, Manager management modules.'
          )}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(['staff', 'manager', 'kitchen'] as const).map((role) => (
            <div key={role} className="rounded-xl border border-slate-700/70 bg-slate-900/30 p-4 space-y-2">
              <h3 className="font-semibold uppercase tracking-wide text-slate-200">{role}</h3>
              {moduleCatalog.map((moduleKey) => (
                <label key={`${role}_${moduleKey}`} className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={(roleModules[role] || []).includes(moduleKey)}
                    onChange={() => toggleRoleModule(role, moduleKey)}
                  />
                  <span>{moduleKey}</span>
                </label>
              ))}
            </div>
          ))}
        </div>

        <button onClick={saveRoleModules} className="neon-btn px-5 py-2 rounded-xl font-semibold">
          {tx(lang, 'Rol İcazələrini Saxla', 'Сохранить права ролей', 'Save Role Permissions')}
        </button>
      </div>
    </div>
  );
}
            className="neon-input"
            type="number"
            min={5}
            value={emailSettings.timeout_sec}
            onChange={(e) => setEmailSettings((prev) => ({ ...prev, timeout_sec: Number(e.target.value || 15) }))}
            placeholder={tx(lang, 'Timeout (san)', 'Timeout (сек)', 'Timeout (sec)')}
          />

          <input
            className="neon-input"
            value={emailSettings.sender_email}
            onChange={(e) => setEmailSettings((prev) => ({ ...prev, sender_email: e.target.value }))}
            placeholder={tx(lang, 'Göndərən email', 'Email отправителя', 'Sender email')}
          />
        </div>

        <input
          className="neon-input"
          value={emailSettings.recipient_emails}
          onChange={(e) => setEmailSettings((prev) => ({ ...prev, recipient_emails: e.target.value }))}
          placeholder={tx(lang, 'Alıcı email-lər (vergüllə)', 'Email получателей (через запятую)', 'Recipient emails (comma separated)')}
        />

        {emailSettings.provider === 'resend' && (
          <input
            className="neon-input"
            value={emailSettings.resend_api_key}
            onChange={(e) => setEmailSettings((prev) => ({ ...prev, resend_api_key: e.target.value }))}
            placeholder="Resend API Key"
          />
        )}

        {emailSettings.provider === 'webhook' && (
          <input
            className="neon-input"
            value={emailSettings.webhook_url}
            onChange={(e) => setEmailSettings((prev) => ({ ...prev, webhook_url: e.target.value }))}
            placeholder={tx(lang, 'Webhook URL', 'Webhook URL', 'Webhook URL')}
          />
        )}

        <button onClick={saveEmailSettings} className="neon-btn px-5 py-2 rounded-xl font-semibold">
          {tx(lang, 'Email API Ayarlarını Saxla', 'Сохранить настройки Email API', 'Save Email API Settings')}
        </button>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold">Omnitech API</h2>
        <p className="text-xs text-slate-400">
          {tx(
            lang,
            'Fiscal/e-kassa inteqrasiyası üçün Omnitech API məlumatlarını buradan daxil edin.',
            'Введите параметры Omnitech API для интеграции fiscal/e-kassa.',
            'Configure Omnitech API credentials for fiscal/e-kassa integration.'
          )}
        </p>

        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={omnitechSettings.enabled}
            onChange={(e) => setOmnitechSettings((prev) => ({ ...prev, enabled: e.target.checked }))}
          />
          <span>{tx(lang, 'Omnitech inteqrasiyasını aktiv et', 'Включить интеграцию Omnitech', 'Enable Omnitech integration')}</span>
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            className="neon-input"
            placeholder={tx(lang, 'API Base URL', 'Базовый URL API', 'API Base URL')}
            value={omnitechSettings.api_base_url}
            onChange={(e) => setOmnitechSettings((prev) => ({ ...prev, api_base_url: e.target.value }))}
          />
          <input
            className="neon-input"
            placeholder={tx(lang, 'API Key', 'API ключ', 'API Key')}
            value={omnitechSettings.api_key}
            onChange={(e) => setOmnitechSettings((prev) => ({ ...prev, api_key: e.target.value }))}
          />
          <input
            className="neon-input"
            placeholder={tx(lang, 'Merchant ID', 'Merchant ID', 'Merchant ID')}
            value={omnitechSettings.merchant_id}
            onChange={(e) => setOmnitechSettings((prev) => ({ ...prev, merchant_id: e.target.value }))}
          />
          <input
            className="neon-input"
            placeholder={tx(lang, 'Terminal ID', 'Terminal ID', 'Terminal ID')}
            value={omnitechSettings.terminal_id}
            onChange={(e) => setOmnitechSettings((prev) => ({ ...prev, terminal_id: e.target.value }))}
          />
          <input
            className="neon-input md:col-span-2"
            placeholder={tx(lang, 'Fiscal Device ID', 'ID фискального устройства', 'Fiscal Device ID')}
            value={omnitechSettings.fiscal_device_id}
            onChange={(e) => setOmnitechSettings((prev) => ({ ...prev, fiscal_device_id: e.target.value }))}
          />
        </div>

        <button onClick={saveOmnitechSettings} className="neon-btn px-5 py-2 rounded-xl font-semibold">
          {tx(lang, 'Omnitech Ayarlarını Saxla', 'Сохранить настройки Omnitech', 'Save Omnitech Settings')}
        </button>
      </div>

      {isPlatformOwner && (
        <div className="metal-panel p-6 space-y-4">
          <h2 className="text-xl font-bold">Tenant Manager</h2>
          <p className="text-xs text-slate-400">
            {tx(
              lang,
              'Yeni şirkət əlavə etdikdə sistem avtomatik tenant, domen mapping, default admin və başlanğıc məlumatlarını yaradır.',
              'При добавлении новой компании система автоматически создаёт тенант, домен, admin и стартовые данные.',
              'When adding a new company, system auto-provisions tenant, domain mapping, admin and default seed data.'
            )}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              className="neon-input"
              placeholder={tx(lang, 'Şirkət adı', 'Название компании', 'Company name')}
              value={tenantCompanyName}
              onChange={(e) => setTenantCompanyName(e.target.value)}
            />
            <input
              className="neon-input"
              placeholder={tx(lang, 'Slug (məs: socialbee)', 'Slug (напр.: socialbee)', 'Slug (e.g.: socialbee)')}
              value={tenantSlug}
              onChange={(e) => setTenantSlug(e.target.value)}
            />
            <input
              className="neon-input"
              placeholder={tx(lang, 'Domain (məs: socialbee.ironwaves.store)', 'Домен (напр.: socialbee.ironwaves.store)', 'Domain (e.g.: socialbee.ironwaves.store)')}
              value={tenantDomain}
              onChange={(e) => setTenantDomain(e.target.value)}
            />
            <input
              className="neon-input"
              placeholder={tx(lang, 'Admin username', 'Admin username', 'Admin username')}
              value={tenantAdminUsername}
              onChange={(e) => setTenantAdminUsername(e.target.value)}
            />
            <input
              className="neon-input"
              placeholder={tx(lang, 'Admin password', 'Admin password', 'Admin password')}
              value={tenantAdminPassword}
              onChange={(e) => setTenantAdminPassword(e.target.value)}
            />
          </div>

          <button onClick={handleCreateTenant} className="glossy-gold rounded-xl px-5 py-2 font-bold">
            {tx(lang, 'Tenant Yarat', 'Создать тенант', 'Create Tenant')}
          </button>

          <div className="rounded-xl border border-slate-700/70 p-4 space-y-3">
            <h3 className="font-semibold text-slate-200">{tx(lang, 'Tenant Klonlama (Demo)', 'Клонирование тенанта (Демо)', 'Tenant Clone (Demo)')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <select className="neon-input" value={cloneSourceTenant} onChange={(e) => setCloneSourceTenant(e.target.value)}>
                <option value="">{tx(lang, 'Mənbə tenant seçin', 'Выберите исходный тенант', 'Select source tenant')}</option>
                {tenants.map((tRow) => (
                  <option key={tRow.id} value={tRow.tenant_id}>{tRow.tenant_id}</option>
                ))}
              </select>
              <input
                className="neon-input"
                placeholder={tx(lang, 'Demo slug', 'Demo slug', 'Demo slug')}
                value={cloneSlug}
                onChange={(e) => setCloneSlug(e.target.value)}
              />
              <input
                className="neon-input"
                placeholder={tx(lang, 'Demo domain (opsional)', 'Demo домен (опционально)', 'Demo domain (optional)')}
                value={cloneDomain}
                onChange={(e) => setCloneDomain(e.target.value)}
              />
            </div>
            <button onClick={handleCloneDemo} className="neon-btn px-4 py-2 rounded-xl font-semibold">
              {tx(lang, 'Demo Tenant Yarat', 'Создать демо-тенант', 'Create Demo Tenant')}
            </button>
          </div>

          <div className="overflow-auto border border-slate-700/70 rounded-xl">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/70 text-slate-200">
                <tr>
                  <th className="text-left px-3 py-2">Tenant</th>
                  <th className="text-left px-3 py-2">Company</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Created</th>
                  <th className="text-left px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((tRow) => (
                  <tr key={tRow.id} className="border-t border-slate-700/70">
                    <td className="px-3 py-2 font-semibold text-slate-100">{tRow.tenant_id}</td>
                    <td className="px-3 py-2 text-slate-300">{tRow.company_name}</td>
                    <td className="px-3 py-2 text-slate-300">{tRow.status}</td>
                    <td className="px-3 py-2 text-slate-400">{new Date(tRow.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSuspendTenant(tRow.tenant_id)}
                          className="rounded-lg border border-amber-400/50 px-2 py-1 text-xs text-amber-200 hover:bg-amber-500/10"
                        >
                          {tx(lang, 'Suspend', 'Suspend', 'Suspend')}
                        </button>
                        <button
                          onClick={() => handleDeleteTenant(tRow.tenant_id)}
                          disabled={tRow.tenant_id === 'tenant_default'}
                          className="rounded-lg border border-red-400/50 px-2 py-1 text-xs text-red-200 hover:bg-red-500/10 disabled:opacity-40"
                        >
                          {tx(lang, 'Sil', 'Удалить', 'Delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {tenants.length === 0 && (
                  <tr>
                    <td className="px-3 py-3 text-slate-400" colSpan={5}>
                      {tx(lang, 'Tenant tapılmadı', 'Тенанты не найдены', 'No tenants found')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isPlatformOwner && (
        <div className="metal-panel overflow-hidden">
          <div className="p-6 border-b border-slate-700/70">
            <h2 className="text-xl font-bold text-slate-100">
              {tx(lang, 'Super Admin Təhlükəsizlik', 'Безопасность Super Admin', 'Super Admin Security')}
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              {tx(
                lang,
                '2FA default söndürülüdür. İstəsəniz buradan aktiv edə bilərsiniz.',
                '2FA по умолчанию выключен. Здесь можно включить его.',
                '2FA is disabled by default. Enable it here when needed.',
              )}
            </p>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="md:col-span-2 inline-flex items-center gap-2 text-slate-200">
              <input type="checkbox" checked={own2faEnabled} onChange={(e) => setOwn2faEnabled(e.target.checked)} />
              {tx(lang, '2FA qorumasını aktiv et', 'Включить защиту 2FA', 'Enable 2FA protection')}
            </label>
            <input
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              type="password"
              placeholder={tx(lang, 'Mövcud şifrə', 'Текущий пароль', 'Current password')}
              className="neon-input"
            />
            <input
              value={newOwn2faPin}
              onChange={(e) => setNewOwn2faPin(e.target.value.replace(/\D/g, '').slice(0, 15))}
              type="password"
              placeholder={tx(lang, 'Yeni 2FA PIN (4-15 rəqəm)', 'Новый 2FA PIN (4-15 цифр)', 'New 2FA PIN (4-15 digits)')}
              className="neon-input"
            />
              <input
              value={newOwnPassword}
              onChange={(e) => setNewOwnPassword(e.target.value)}
              type="password"
              placeholder={tx(lang, 'Yeni şifrə (istəyə bağlı)', 'Новый пароль (необязательно)', 'New password (optional)')}
              className="neon-input"
            />
            <input
              value={confirmOwnPassword}
              onChange={(e) => setConfirmOwnPassword(e.target.value)}
              type="password"
              placeholder={tx(lang, 'Yeni şifrə təkrarı (istəyə bağlı)', 'Повторите новый пароль (необязательно)', 'Confirm new password (optional)')}
              className="neon-input"
            />
            <div className="md:col-span-2 flex justify-end gap-3">
              <button onClick={handleUnlockOwnAccount} className="neon-btn rounded-xl px-4 py-2 font-semibold">
                {tx(lang, 'Kilidi Aç', 'Сбросить блокировку', 'Unlock Account')}
              </button>
              <button onClick={handleChangeOwnSecurity} className="glossy-gold rounded-xl px-6 py-2 font-bold">
                {tx(lang, 'Təhlükəsizliyi Yenilə', 'Обновить безопасность', 'Update Security')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="metal-panel overflow-hidden">
         <div className="p-6 border-b border-slate-700/70 flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'İstifadəçi İdarəetməsi', 'Управление пользователями')}</h2>
         </div>
         <div className="p-6">
              <p className="text-slate-300 mb-4">{tx(lang, 'Buradan yeni işçi yarada və PIN dəyişə bilərsiniz. Admin üçün 2FA yalnız aktiv ediləndə tələb olunur.', 'Здесь можно создавать сотрудников и менять PIN. Для Admin 2FA требуется только когда включен.', 'Create staff and change PIN here. Admin 2FA is required only when enabled.')}</p>
            <div className="flex gap-4 mb-6">
              <input value={newUserName} onChange={(e) => setNewUserName(e.target.value)} type="text" placeholder={tx(lang, 'İstifadəçi Adı', 'Имя пользователя')} className="neon-input flex-1" />
              <select value={newUserRole} onChange={(e) => setNewUserRole(e.target.value as any)} className="neon-input bg-transparent">
                <option value="staff">{tx(lang, 'Staff (Kassir)', 'Кассир')}</option>
                <option value="kitchen">{tx(lang, 'Mətbəx (Kitchen)', 'Кухня')}</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
              {['admin', 'manager'].includes(newUserRole) ? (
                <input
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  type="password"
                  placeholder={tx(lang, 'Şifrə (Admin/Manager)', 'Пароль (Admin/Manager)', 'Password (Admin/Manager)')}
                  className="neon-input flex-1"
                />
              ) : (
                <input
                  value={newUserPin}
                  onChange={(e) => setNewUserPin(e.target.value.replace(/\D/g, '').slice(0, 15))}
                  type="text"
                  placeholder={tx(lang, 'PIN (Staff/Kitchen, məs: 1234)', 'PIN (Staff/Kitchen, напр.: 1234)', 'PIN (Staff/Kitchen, e.g. 1234)')}
                  className="neon-input flex-1"
                />
              )}
              <button onClick={handleCreateUser} className="glossy-gold rounded-xl px-6 py-2 font-bold">{tx(lang, 'Yarat', 'Создать')}</button>
            </div>

            <div className="grid grid-cols-1 gap-3 border-t border-slate-700/70 pt-4">
              {users.map((u) => (
                <div key={u.id || u.username} className="flex items-center justify-between rounded-xl border border-slate-700 px-4 py-3">
                  <div>
                    <div className="font-semibold text-slate-100">{u.username}</div>
                     <div className="text-xs text-slate-400">{tx(lang, 'Rol', 'Роль')}: {u.role}</div>
                  </div>
                  <button onClick={() => setDeleteUserName(u.username)} className="rounded-lg border border-red-400/50 px-3 py-1 text-sm text-red-300 hover:bg-red-500/10">{tx(lang, 'Sil', 'Удалить')}</button>
                </div>
              ))}
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3 border-t border-slate-700/70 pt-4">
              <select value={targetUser} onChange={(e) => setTargetUser(e.target.value)} className="neon-input">
                <option value="">{tx(lang, 'İstifadəçi seçin', 'Выберите пользователя')}</option>
                {users.map((u) => (
                  <option key={u.id || u.username} value={u.username}>{u.username}</option>
                ))}
              </select>
              <input value={targetPin} onChange={(e) => setTargetPin(e.target.value)} type="text" placeholder={tx(lang, 'Yeni PIN', 'Новый PIN')} className="neon-input" />
              <button onClick={handleUpdatePin} className="neon-btn px-4 py-2">{tx(lang, 'PIN Dəyiş', 'Изменить PIN')}</button>
            </div>
         </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold">{tx(lang, 'Rol İcazələri (Modul Matrisi)', 'Права ролей (матрица модулей)', 'Role Permissions (Module Matrix)')}</h2>
        <p className="text-sm text-slate-300">
          {tx(
            lang,
            'Dünya praktikası: Kitchen yalnız KDS, Staff əməliyyat modulları, Manager idarəetmə modulları.',
            'Практика: Kitchen только KDS, Staff операционные модули, Manager управленческие модули.',
            'Best practice: Kitchen only KDS, Staff operational modules, Manager management modules.'
          )}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(['staff', 'manager', 'kitchen'] as const).map((role) => (
            <div key={role} className="rounded-xl border border-slate-700/70 bg-slate-900/30 p-4 space-y-2">
              <h3 className="font-semibold uppercase tracking-wide text-slate-200">{role}</h3>
              {moduleCatalog.map((moduleKey) => (
                <label key={`${role}_${moduleKey}`} className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={(roleModules[role] || []).includes(moduleKey)}
                    onChange={() => toggleRoleModule(role, moduleKey)}
                  />
                  <span>{moduleKey}</span>
                </label>
              ))}
            </div>
          ))}
        </div>

        <button onClick={saveRoleModules} className="neon-btn px-5 py-2 rounded-xl font-semibold">
          {tx(lang, 'Rol İcazələrini Saxla', 'Сохранить права ролей', 'Save Role Permissions')}
        </button>
      </div>
    </div>
  );
}    

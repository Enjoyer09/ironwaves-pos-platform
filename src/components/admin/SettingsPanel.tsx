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
    if (!newUserName) return;
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
        username: newUserName,
        role: newUserRole,
        pin: requiresPassword ? undefined : newUserPin,
        password: requiresPassword ? newUserPassword : undefined,
      } as any);
      setNewUserName('');
      setNewUserPin('');
      setNewUserPassword('');
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
  };

  const saveRoleModules = () => {
    update_role_modules(roleModules);
    setSuccessMsg(tx(lang, 'Rol icazələri yadda saxlanıldı!', 'Права ролей сохранены!', 'Role permissions saved!'));
    setTimeout(() => setSuccessMsg(''), 2500);
  };

  const savePrintSettings = () => {
    update_print_settings(printSettings);
    setSuccessMsg(tx(lang, 'QZ print ayarları yadda saxlanıldı!', 'Настройки QZ печати сохранены!', 'QZ print settings saved!'));
    setTimeout(() => setSuccessMsg(''), 2500);
  };

  const saveOmnitechSettings = () => {
    update_omnitech_settings(omnitechSettings);
    setSuccessMsg(
      tx(
        lang,
        'Omnitech API ayarları yadda saxlanıldı!',
        'Настройки Omnitech API сохранены!',
        'Omnitech API settings saved!'
      )
    );
    setTimeout(() => setSuccessMsg(''), 2500);
  };

  const saveEmailSettings = () => {
    const recipients = emailSettings.recipient_emails
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
    update_email_settings({
      enabled: emailSettings.enabled,
      provider: emailSettings.provider,
      resend_api_key: emailSettings.resend_api_key,
      sender_email: emailSettings.sender_email,
      recipient_emails: recipients,
      webhook_url: emailSettings.webhook_url,
      timeout_sec: Number(emailSettings.timeout_sec || 15),
    });
    setSuccessMsg(
      tx(lang, 'Email API ayarları yadda saxlanıldı!', 'Настройки Email API сохранены!', 'Email API settings saved!')
    );
    setTimeout(() => setSuccessMsg(''), 2500);
  };

  const saveInventorySettings = () => {
    const parsedUnits = unitDraft
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    const result = update_inventory_settings({
      default_critical_threshold: Number(inventorySettings.default_critical_threshold || 0),
      unit_options: parsedUnits,
    });
    if (result?.success) {
      setInventorySettings(result.inventory_settings);
      setUnitDraft((result.inventory_settings.unit_options || []).join(', '));
      setSuccessMsg(
        tx(
          lang,
          'Anbar ayarları yadda saxlanıldı!',
          'Настройки склада сохранены!',
          'Inventory settings saved!'
        )
      );
      setTimeout(() => setSuccessMsg(''), 2500);
    }
  };

  const handleCreateTenant = async () => {
    try {
      const created = await create_tenant({
        company_name: tenantCompanyName,
        slug: tenantSlug,
        domain: tenantDomain,
        admin_username: tenantAdminUsername,
        admin_password: tenantAdminPassword,
        created_by: user?.username || 'admin',
        created_by_role: user?.role,
      });
      setSuccessMsg(
        tx(
          lang,
          `Tenant yaradıldı: ${created.tenant_id} (${created.domain})`,
          `Тенант создан: ${created.tenant_id} (${created.domain})`,
          `Tenant created: ${created.tenant_id} (${created.domain})`,
        ),
      );
      setTenantCompanyName('');
      setTenantSlug('');
      setTenantDomain('');
      setTenantAdminUsername('admin');
      setTenantAdminPassword('');
      setCreatedCreds({
        title: tx(lang, 'Tenant yaradıldı', 'Тенант создан', 'Tenant created'),
        username: created.admin_username,
        password: created.admin_password,
        twofa_pin: created.admin_2fa_pin,
        tenant_id: created.tenant_id,
        domain: created.domain,
      });
      await loadData();
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (e: any) {
      notify('error', e?.message || 'Tenant create failed');
    }
  };

  const handleSuspendTenant = async (tenantId: string) => {
    try {
      await suspend_tenant({ tenant_id: tenantId, suspended_by: user?.username, suspended_by_role: user?.role });
      notify('success', tx(lang, 'Tenant suspend edildi', 'Тенант приостановлен', 'Tenant suspended'));
      await loadData();
    } catch (e: any) {
      notify('error', e?.message || 'Suspend failed');
    }
  };

  const handleDeleteTenant = async (tenantId: string) => {
    const ok = window.confirm(tx(lang, `Əminsiniz? ${tenantId} tenanti silinəcək.`, `Вы уверены? Тенант ${tenantId} будет удален.`, `Are you sure? Tenant ${tenantId} will be deleted.`));
    if (!ok) return;
    try {
      await delete_tenant({ tenant_id: tenantId, deleted_by: user?.username, deleted_by_role: user?.role });
      notify('success', tx(lang, 'Tenant silindi', 'Тенант удален', 'Tenant deleted'));
      await loadData();
    } catch (e: any) {
      notify('error', e?.message || 'Delete failed');
    }
  };

  const handleCloneDemo = async () => {
    try {
      const result = await clone_tenant_as_demo({
        source_tenant_id: cloneSourceTenant,
        demo_slug: cloneSlug,
        demo_domain: cloneDomain,
        created_by: user?.username,
        created_by_role: user?.role,
      });
      setCreatedCreds({
        title: tx(lang, 'Demo tenant yaradıldı', 'Демо-тенант создан', 'Demo tenant created'),
        username: result.demo_admin_username,
        password: result.demo_admin_password,
        twofa_pin: result.demo_admin_2fa_pin,
        tenant_id: result.demo_tenant_id,
        domain: result.demo_domain,
      });
      setCloneSourceTenant('');
      setCloneSlug('');
      setCloneDomain('');
      await loadData();
      notify('success', tx(lang, 'Demo tenant hazırdır', 'Демо-тенант готов', 'Demo tenant ready'));
    } catch (e: any) {
      notify('error', e?.message || 'Clone failed');
    }
  };

  return (
    <div className="space-y-6 text-slate-100">
      <ConfirmModal
        open={Boolean(deleteUserName)}
        lang={lang}
        title={tx(lang, 'İstifadəçini sil', 'Удалить пользователя')}
        message={tx(lang, 'Bu əməliyyatdan sonra istifadəçi sistemə daxil ola bilməyəcək.', 'После этого пользователь не сможет войти в систему.')}
        onCancel={() => setDeleteUserName(null)}
        onConfirm={() => deleteUserName && handleDeleteUser(deleteUserName)}
      />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Settings className="text-slate-300" size={32} />
            {tx(lang, 'Ayarlar', 'Настройки')}
          </h1>
          <p className="text-slate-400 mt-1">{tx(lang, 'Biznes məlumatları, receipt dizayneri və istifadəçi idarəetməsi', 'Данные бизнеса, дизайнер чека и управление пользователями')}</p>
        </div>
      </div>

      {successMsg && (
        <div className="bg-emerald-500/20 text-emerald-200 p-4 rounded-xl border border-emerald-300/30">
          {successMsg}
        </div>
      )}

      {createdCreds && (
        <div className="metal-panel p-5 border border-emerald-400/40 space-y-2">
          <div className="text-emerald-300 font-semibold">{createdCreds.title}</div>
          <div className="text-sm text-slate-200">Tenant: <span className="font-mono">{createdCreds.tenant_id}</span></div>
          <div className="text-sm text-slate-200">Domain: <span className="font-mono">{createdCreds.domain}</span></div>
          <div className="text-sm text-slate-200">Username: <span className="font-mono">{createdCreds.username}</span></div>
          <div className="text-sm text-slate-200">Password: <span className="font-mono">{createdCreds.password}</span></div>
          {createdCreds.twofa_pin && (
            <div className="text-sm text-slate-200">2FA PIN: <span className="font-mono">{createdCreds.twofa_pin}</span></div>
          )}
          <button onClick={() => setCreatedCreds(null)} className="neon-btn px-4 py-2 rounded-xl text-sm">
            {tx(lang, 'Bağla', 'Закрыть', 'Close')}
          </button>
        </div>
      )}

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold">Tenant Info</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl border border-slate-600/60 bg-slate-900/40 px-3 py-2">
            <div className="text-slate-400">Host</div>
            <div className="font-semibold text-slate-100 break-all">{host}</div>
          </div>
          <div className="rounded-xl border border-slate-600/60 bg-slate-900/40 px-3 py-2">
            <div className="text-slate-400">Mapped Tenant</div>
            <div className="font-semibold text-slate-100">{mappedTenant}</div>
          </div>
          <div className="rounded-xl border border-slate-600/60 bg-slate-900/40 px-3 py-2">
            <div className="text-slate-400">Active Tenant</div>
            <div className="font-semibold text-slate-100">{activeTenant}</div>
          </div>
        </div>
        {mappedTenant !== activeTenant && (
          <p className="text-xs text-amber-300">
            Host mapping ile aktiv tenant fərqlənir. Login yeniləndikdə tenant avtomatik sinxron olacaq.
          </p>
        )}
      </div>

      <div className="metal-panel p-6 space-y-4">
          <h2 className="text-xl font-bold">{tx(lang, 'Receipt Dizayneri', 'Дизайнер чека')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">{tx(lang, 'Şirkət Adı', 'Название компании')}</label>
                <input
                  type="text"
                  value={profile?.company_name || ''}
                  onChange={(e) => setProfile({ ...(profile || {}), company_name: e.target.value })}
                  className="neon-input"
                />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">{tx(lang, 'VÖEN', 'ИНН')}</label>
              <input type="text" value={profile?.voen || ''} onChange={(e) => setProfile({ ...(profile || {}), voen: e.target.value })} className="neon-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">{tx(lang, 'Telefon', 'Телефон')}</label>
              <input type="text" value={profile?.phone || ''} onChange={(e) => setProfile({ ...(profile || {}), phone: e.target.value })} className="neon-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">{tx(lang, 'Adres', 'Адрес')}</label>
              <input type="text" value={profile?.address || ''} onChange={(e) => setProfile({ ...(profile || {}), address: e.target.value })} className="neon-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">{tx(lang, 'Sayt', 'Сайт')}</label>
              <input type="text" value={profile?.website || ''} onChange={(e) => setProfile({ ...(profile || {}), website: e.target.value })} className="neon-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">{tx(lang, 'Logo URL (istəyə görə)', 'URL логотипа (по желанию)')}</label>
              <input type="text" value={profile?.logo_url || ''} onChange={(e) => setProfile({ ...(profile || {}), logo_url: e.target.value })} className="neon-input" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">{tx(lang, 'Logo Yüklə', 'Загрузить логотип')}</label>
              <input type="file" accept="image/*" onChange={handleLogoUpload} className="neon-input" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">{tx(lang, 'Təşəkkür mətni', 'Текст благодарности')}</label>
            <textarea
              rows={2}
              value={profile?.receipt_footer || ''}
              onChange={(e) => setProfile({ ...(profile || {}), receipt_footer: e.target.value })}
              className="neon-input"
            />
          </div>

          <div className="rounded-xl border border-slate-600/60 bg-white text-slate-900 p-4 text-sm max-w-sm">
            {profile?.logo_url && <img src={profile.logo_url} alt="logo" className="h-12 object-contain mb-2" />}
            <div className="font-bold text-base">{profile?.company_name || tx(lang, 'Şirkət adı', 'Название компании')}</div>
            <div>VÖEN: {profile?.voen || '-'}</div>
            <div>Tel: {profile?.phone || '-'}</div>
            <div>{profile?.address || '-'}</div>
            <div className="mt-3 text-xs">{profile?.receipt_footer || '-'}</div>
          </div>

            <button onClick={saveBusinessProfile} className="glossy-gold rounded-xl px-6 py-3 font-bold inline-flex items-center gap-2">
              <Save size={20} />
              {tx(lang, 'Ayarları Yadda Saxla', 'Сохранить настройки')}
            </button>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold">QZ Tray Print</h2>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={printSettings.use_qz}
            onChange={(e) => setPrintSettings((prev) => ({ ...prev, use_qz: e.target.checked }))}
          />
          <span>{tx(lang, 'QZ Tray ilə səssiz çapı aktiv et', 'Включить тихую печать через QZ Tray', 'Enable silent print via QZ Tray')}</span>
        </label>
        <input
          type="text"
          className="neon-input"
          placeholder={tx(lang, 'Printer adı (boş olsa default)', 'Имя принтера (если пусто — по умолчанию)', 'Printer name (default if empty)')}
          value={printSettings.printer_name}
          onChange={(e) => setPrintSettings((prev) => ({ ...prev, printer_name: e.target.value }))}
        />
        <p className="text-xs text-slate-400">
          {tx(lang, 'QZ Tray kassadakı kompüterə quraşdırılmalıdır. Quraşdırılmayıbsa sistem avtomatik brauzer çapına düşəcək.', 'QZ Tray должен быть установлен на кассовом ПК. Если не установлен — система автоматически переключится на печать браузера.', 'QZ Tray must be installed on cashier PC. If unavailable, browser print fallback is used.')}
        </p>
        <button onClick={savePrintSettings} className="neon-btn px-5 py-2 rounded-xl font-semibold">
          {tx(lang, 'QZ Ayarlarını Saxla', 'Сохранить настройки QZ', 'Save QZ Settings')}
        </button>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold">{tx(lang, 'Anbar Ayarları', 'Настройки склада', 'Inventory Settings')}</h2>
        <p className="text-xs text-slate-400">
          {tx(
            lang,
            'Kritik stok həddini və istifadə ediləcək vahidləri buradan idarə edin. Vahidlər vergüllə ayrılır.',
            'Управляйте критическим порогом и единицами измерения. Единицы разделяются запятой.',
            'Configure default critical threshold and unit options here. Separate units by comma.'
          )}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-slate-300 mb-1">{tx(lang, 'Default kritik stok', 'Критический порог по умолчанию', 'Default critical threshold')}</label>
            <input
              className="neon-input"
              type="number"
              min={0}
              value={inventorySettings.default_critical_threshold}
              onChange={(e) => setInventorySettings((prev) => ({ ...prev, default_critical_threshold: Number(e.target.value || 0) }))}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">{tx(lang, 'Vahidlər', 'Единицы измерения', 'Units')}</label>
            <input
              className="neon-input"
              value={unitDraft}
              onChange={(e) => setUnitDraft(e.target.value)}
              placeholder="kq, qram, litr, ml, ədəd, metr"
            />
          </div>
        </div>
        <button onClick={saveInventorySettings} className="neon-btn px-5 py-2 rounded-xl font-semibold">
          {tx(lang, 'Anbar ayarlarını saxla', 'Сохранить настройки склада', 'Save inventory settings')}
        </button>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold">Email Provider API</h2>
        <p className="text-xs text-slate-400">
          {tx(
            lang,
            'Z-Hesabat email göndərişi üçün provider ayarları. Resend və ya webhook seçə bilərsiniz.',
            'Настройки провайдера для отправки Z-отчета по email. Можно выбрать Resend или webhook.',
            'Provider settings for Z-report email delivery. Choose Resend or webhook.'
          )}
        </p>

        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={emailSettings.enabled}
            onChange={(e) => setEmailSettings((prev) => ({ ...prev, enabled: e.target.checked }))}
          />
          <span>{tx(lang, 'Email göndərişini aktiv et', 'Включить отправку email', 'Enable email sending')}</span>
        </label>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select
            className="neon-input"
            value={emailSettings.provider}
            onChange={(e) => setEmailSettings((prev) => ({ ...prev, provider: e.target.value as any }))}
          >
            <option value="none">{tx(lang, 'Deaktiv', 'Отключено', 'Disabled')}</option>
            <option value="resend">Resend</option>
            <option value="webhook">Webhook</option>
          </select>

          <input
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

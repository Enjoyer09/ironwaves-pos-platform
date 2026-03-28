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
  update_business_profile_live,
  update_role_modules_live,
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
    try {
      setProfile(await get_business_profile_live(tenantId));
      setUsers(await get_users_live(tenantId));
      const settings = await get_settings_live(tenantId);
      setRoleModules(settings.role_modules || defaultRoleModules);
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Ayarları yükləmək alınmadı', 'Не удалось загрузить настройки', 'Failed to load settings'));
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
    await update_business_profile_live(tenantId, profile, user?.username || 'admin');
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
          <input className="neon-input md:col-span-2" value={profile?.receipt_footer || ''} onChange={(e) => setProfile((prev: any) => ({ ...(prev || {}), receipt_footer: e.target.value }))} placeholder={tx(lang, 'Qəbz alt mətni', 'Текст внизу чека', 'Receipt footer')} />
          <input className="neon-input md:col-span-2" type="file" accept="image/*" onChange={handleLogoUpload} />
        </div>
        <div className="flex justify-end">
          <button onClick={() => { void saveBusinessProfile(); }} className="glossy-gold rounded-xl px-6 py-2 font-bold">{tx(lang, 'Saxla', 'Сохранить', 'Save')}</button>
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
        isOpen={Boolean(deleteUserName)}
        title={tx(lang, 'İstifadəçini sil', 'Удалить пользователя', 'Delete user')}
        message={tx(lang, `"${deleteUserName || ''}" istifadəçisini silmək istəyirsiniz?`, `Удалить пользователя "${deleteUserName || ''}"?`, `Delete user "${deleteUserName || ''}"?`)}
        onCancel={() => setDeleteUserName(null)}
        onConfirm={() => deleteUserName && handleDeleteUser(deleteUserName)}
      />
    </div>
  );
}

import React from 'react';
import { X } from 'lucide-react';
import { tx } from '../../../i18n';
import type { Lang } from '../../../i18n';
import { prepareImageDataUrl } from '../../../lib/image_upload';
import ConfirmModal from '../../ConfirmModal';
import type { StaffBenefitsState, RoleModules, SessionSettingsState } from './types';
import { roleLabelMap, moduleLabelMap, moduleCatalog, defaultRoleModules } from './types';

export interface SecuritySettingsSectionProps {
  lang: string;
  saveButtonClass: string;
  renderPanelSuccess: (panelId: string) => React.ReactNode;
  notify: (type: 'success' | 'error' | 'info', message: string) => void;
  currentRole: string;

  // Session security (sec-security)
  sessionSettings: SessionSettingsState;
  setSessionSettings: React.Dispatch<React.SetStateAction<SessionSettingsState>>;
  saveSessionSettings: () => Promise<void>;

  // Staff benefits (sec-staff)
  staffBenefits: StaffBenefitsState;
  setStaffBenefits: React.Dispatch<React.SetStateAction<StaffBenefitsState>>;
  saveStaffBenefits: () => Promise<void>;
  menuCatalog: any[];

  // Role modules (sec-roles)
  roleModules: RoleModules;
  setRoleModules: React.Dispatch<React.SetStateAction<RoleModules>>;
  saveRoleModules: () => Promise<void>;

  // User management (sec-users)
  users: any[];
  newUserName: string;
  setNewUserName: (v: string) => void;
  newUserRole: 'staff' | 'kitchen' | 'manager' | 'admin';
  setNewUserRole: (v: 'staff' | 'kitchen' | 'manager' | 'admin') => void;
  newUserPassword: string;
  setNewUserPassword: (v: string) => void;
  newUserPin: string;
  setNewUserPin: (v: string) => void;
  handleCreateUser: () => Promise<void>;
  handleDeleteUser: (username: string) => Promise<void>;
  deleteUserName: string | null;
  setDeleteUserName: (v: string | null) => void;

  // PIN management
  targetUser: string;
  setTargetUser: (v: string) => void;
  targetPin: string;
  setTargetPin: (v: string) => void;
  handleUpdatePin: () => Promise<void>;

  // Password management for other users
  targetPasswordUser: string;
  setTargetPasswordUser: (v: string) => void;
  targetPassword: string;
  setTargetPassword: (v: string) => void;
  handleUpdatePasswordForUser: () => Promise<void>;

  // Password / 2FA (sec-password)
  currentPassword: string;
  setCurrentPassword: (v: string) => void;
  newOwnPassword: string;
  setNewOwnPassword: (v: string) => void;
  confirmOwnPassword: string;
  setConfirmOwnPassword: (v: string) => void;
  handleChangeOwnPassword: () => Promise<void>;

  // TOTP state
  totpEnabled: boolean;
  totpSetupUrl: string;
  totpSecret: string;
  totpQrDataUrl: string;
  totpCode: string;
  setTotpCode: (v: string) => void;
  totpDisablePassword: string;
  setTotpDisablePassword: (v: string) => void;
  totpDisableCode: string;
  setTotpDisableCode: (v: string) => void;
  handleStartTotpSetup: () => Promise<void>;
  handleVerifyTotp: () => Promise<void>;
  handleDisableTotp: () => Promise<void>;

  // Danger zone (sec-danger)
  resetModalOpen: boolean;
  setResetModalOpen: (v: boolean) => void;
  handleResetSystem: () => Promise<void>;
  resetPassword: string;
  setResetPassword: (v: string) => void;
  resetTotpCode: string;
  setResetTotpCode: (v: string) => void;
}

export function SecuritySettingsSection({
  lang,
  saveButtonClass,
  renderPanelSuccess,
  notify,
  currentRole,

  sessionSettings,
  setSessionSettings,
  saveSessionSettings,

  staffBenefits,
  setStaffBenefits,
  saveStaffBenefits,
  menuCatalog,

  roleModules,
  setRoleModules,
  saveRoleModules,

  users,
  newUserName,
  setNewUserName,
  newUserRole,
  setNewUserRole,
  newUserPassword,
  setNewUserPassword,
  newUserPin,
  setNewUserPin,
  handleCreateUser,
  handleDeleteUser,
  deleteUserName,
  setDeleteUserName,

  targetUser,
  setTargetUser,
  targetPin,
  setTargetPin,
  handleUpdatePin,

  targetPasswordUser,
  setTargetPasswordUser,
  targetPassword,
  setTargetPassword,
  handleUpdatePasswordForUser,

  currentPassword,
  setCurrentPassword,
  newOwnPassword,
  setNewOwnPassword,
  confirmOwnPassword,
  setConfirmOwnPassword,
  handleChangeOwnPassword,

  totpEnabled,
  totpSetupUrl,
  totpSecret,
  totpQrDataUrl,
  totpCode,
  setTotpCode,
  totpDisablePassword,
  setTotpDisablePassword,
  totpDisableCode,
  setTotpDisableCode,
  handleStartTotpSetup,
  handleVerifyTotp,
  handleDisableTotp,

  resetModalOpen,
  setResetModalOpen,
  handleResetSystem,
  resetPassword,
  setResetPassword,
  resetTotpCode,
  setResetTotpCode,
}: SecuritySettingsSectionProps) {
  const requiresPasswordForNewUser = ['admin', 'manager'].includes(newUserRole);
  const pinUsers = users.filter((u) => ['staff', 'kitchen'].includes(String(u.role || '').toLowerCase()));
  const passwordUsers = users.filter((u) => ['admin', 'manager', 'super_admin'].includes(String(u.role || '').toLowerCase()));

  const toggleRoleModule = (role: keyof RoleModules, moduleKey: string) => {
    setRoleModules((prev) => {
      const current = prev[role] || [];
      const next = current.includes(moduleKey)
        ? current.filter((item) => item !== moduleKey)
        : [...current, moduleKey];
      return { ...prev, [role]: next };
    });
  };

  return (
    <>
      {/* sec-security: Session Security */}
      <div id="sec-security" className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Sessiya Təhlükəsizliyi', 'Безопасность сессии', 'Session Security')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'İstifadəçi müəyyən müddət heç bir hərəkət etməsə sistem avtomatik çıxış etsin. 0 yazsanız bu funksiya söndürüləcək.',
            'Если пользователь ничего не делает заданное время, система автоматически выйдет. 0 отключает функцию.',
            'Automatically sign out after inactivity. Use 0 to disable this feature.',
          )}
        </p>
        <div className="grid gap-4 md:grid-cols-2 md:items-end">
          <label className="text-sm text-slate-300">
            {tx(lang, 'Boş dayanma çıxışı (dəqiqə)', 'Простой выход (минуты)', 'Idle logout (minutes)')}
            <input
              className="neon-input mt-1 w-full"
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
        </div>

        <hr className="border-slate-800/80 my-4" />

        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">
              {tx(lang, 'Giriş Ekranı Arxa Fon Şəkli', 'Фоновое изображение экрана входа', 'Login Screen Background Image')}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {tx(
                lang,
                'Giriş ekranında (PIN) göstəriləcək şəkli URL olaraq daxil edin və ya cihazınızdan yükləyin (avtomatik olaraq optimal ölçüdə sıxılacaq).',
                'Введите URL изображения или загрузите его со своего устройства для экрана входа (оно автоматически сжимается до оптимального размера).',
                'Enter an image URL or upload one from your device for the login screen (it will be automatically compressed to optimal size).',
              )}
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <label className="block text-xs text-slate-300 font-medium">
                {tx(lang, 'Şəkil Linki (URL)', 'Ссылка на изображение (URL)', 'Image URL / Link')}
                <input
                  type="text"
                  placeholder="https://example.com/image.jpg"
                  className="neon-input mt-1 w-full text-xs"
                  value={sessionSettings.login_background_url}
                  onChange={(e) => setSessionSettings((prev) => ({ ...prev, login_background_url: e.target.value }))}
                />
              </label>
              
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400">{tx(lang, 'və ya', 'или', 'or')}</span>
                <label className="cursor-pointer text-xs font-bold text-amber-400 hover:text-amber-300 transition-colors underline decoration-dotted">
                  {tx(lang, 'Şəkil yüklə', 'Загрузить изображение', 'Upload Image')}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        notify('info', tx(lang, 'Şəkil sıxılır...', 'Изображение сжимается...', 'Compressing image...'));
                        const compressed = await prepareImageDataUrl(file, {
                          maxDimension: 1920,
                          outputQuality: 0.75,
                          maxFileBytes: 15 * 1024 * 1024,
                        });
                        setSessionSettings((prev) => ({ ...prev, login_background_url: compressed }));
                        notify('success', tx(lang, 'Şəkil uğurla sıxıldı və daxil edildi', 'Изображение сжато и загружено', 'Image successfully compressed and set'));
                      } catch (err: any) {
                        notify('error', err?.message || 'Compression failed');
                      }
                    }}
                  />
                </label>
              </div>
            </div>
            
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700/80 bg-slate-900/40 p-3 min-h-[120px] relative overflow-hidden">
              {sessionSettings.login_background_url ? (
                <>
                  <img
                    src={sessionSettings.login_background_url}
                    alt="Background preview"
                    className="w-full h-full max-h-[140px] object-cover rounded-lg opacity-85"
                  />
                  <button
                    type="button"
                    onClick={() => setSessionSettings((prev) => ({ ...prev, login_background_url: '' }))}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-slate-950/80 text-slate-400 hover:text-rose-400 transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <div className="text-center space-y-1">
                  <div className="text-slate-500 text-xs">
                    {tx(lang, 'Şəkil seçilməyib', 'Изображение не выбрано', 'No image selected')}
                  </div>
                  <div className="text-[10px] text-slate-600">
                    {tx(lang, 'Varsayılan fon şəkli istifadə ediləcək', 'Будет использован фон по умолчанию', 'Default background will be used')}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button onClick={() => { void saveSessionSettings(); }} className={saveButtonClass}>
            {tx(lang, 'Sessiya ayarlarını saxla', 'Сохранить настройки сессии', 'Save Session Settings')}
          </button>
        </div>
        {renderPanelSuccess('session')}
      </div>

      {/* sec-staff: Staff Benefits */}
      <div id="sec-staff" className="metal-panel p-6 space-y-4">
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
            className="neon-input md:col-span-2"
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
            value={staffBenefits.coffee_unit_cap_azn}
            onChange={(e) => setStaffBenefits((prev) => ({ ...prev, coffee_unit_cap_azn: e.target.value }))}
            placeholder={tx(lang, 'Kofe məhsulları üçün maks. güzəşt', 'Макс. скидка на кофе', 'Max Coffee benefit')}
          />
          <input
            className="neon-input"
            type="number"
            min={0}
            value={staffBenefits.other_unit_cap_azn}
            onChange={(e) => setStaffBenefits((prev) => ({ ...prev, other_unit_cap_azn: e.target.value }))}
            placeholder={tx(lang, 'Digər məhsullar üçün maks. güzəşt', 'Макс. скидка на др. товары', 'Max other products benefit')}
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

      {/* sec-roles: Role Permissions */}
      <div id="sec-roles" className="metal-panel p-6 space-y-4">
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

      {/* sec-password: Password & 2FA */}
      {['admin', 'manager', 'super_admin'].includes(currentRole) ? (
        <div id="sec-password" className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="metal-panel p-6 space-y-4">
            <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Şifrə Yenilə', 'Смена пароля', 'Change Password')}</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <input className="neon-input" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder={tx(lang, 'Mövcud şifrə', 'Текущий пароль', 'Current password')} />
              <input className="neon-input" type="password" value={newOwnPassword} onChange={(e) => setNewOwnPassword(e.target.value)} placeholder={tx(lang, 'Yeni şifrə', 'Новый пароль', 'New password')} />
              <input className="neon-input" type="password" value={confirmOwnPassword} onChange={(e) => setConfirmOwnPassword(e.target.value)} placeholder={tx(lang, 'Yeni şifrə təkrarı', 'Повторите пароль', 'Confirm new password')} />
            </div>
            <div className="flex justify-end">
              <button onClick={() => { void handleChangeOwnPassword(); }} className="neon-btn rounded-xl px-5 py-2 font-semibold">{tx(lang, 'Şifrəni Yenilə', 'Обновить пароль', 'Update Password')}</button>
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

      {/* sec-users: User Management */}
      <div id="sec-users" className="metal-panel overflow-hidden">
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

      {/* sec-danger: Danger Zone */}
      {['admin', 'super_admin'].includes(currentRole) ? (
        <div id="sec-danger" className="metal-panel p-6 space-y-4">
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

      {/* Reset System Modal */}
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

      {/* Delete User Confirm Modal */}
      <ConfirmModal
        open={Boolean(deleteUserName)}
        title={tx(lang, 'İstifadəçini sil', 'Удалить пользователя', 'Delete user')}
        message={tx(lang, `"${deleteUserName || ''}" istifadəçisini silmək istəyirsiniz?`, `Удалить пользователя "${deleteUserName || ''}"?`, `Delete user "${deleteUserName || ''}"?`)}
        lang={lang as Lang}
        onCancel={() => setDeleteUserName(null)}
        onConfirm={() => {
          if (deleteUserName) {
            void handleDeleteUser(deleteUserName);
          }
        }}
      />
    </>
  );
}

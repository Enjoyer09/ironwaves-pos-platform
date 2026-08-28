import React from 'react';
import { X } from 'lucide-react';
import { tx } from '../../../i18n';
import { prepareImageDataUrl } from '../../../lib/image_upload';
import type { SessionSettingsState } from './types';

export interface InterfaceSettingsSectionProps {
  lang: string;
  saveButtonClass: string;
  renderPanelSuccess: (panelId: string) => React.ReactNode;
  sessionSettings: SessionSettingsState;
  setSessionSettings: React.Dispatch<React.SetStateAction<SessionSettingsState>>;
  saveSessionSettings: () => Promise<void>;
  changeThemeMode: (mode: 'dark' | 'light') => Promise<void>;
  toggleVirtualKeyboard: (enabled: boolean) => Promise<void>;
  notify: (type: 'success' | 'error' | 'info', message: string) => void;
  tenantId: string;
  saveTablesUiMode: (mode: 'classic' | 'modern') => Promise<void>;
}

export function InterfaceSettingsSection({
  lang,
  saveButtonClass,
  renderPanelSuccess,
  sessionSettings,
  setSessionSettings,
  saveSessionSettings,
  changeThemeMode,
  toggleVirtualKeyboard,
  notify,
  tenantId,
  saveTablesUiMode,
}: InterfaceSettingsSectionProps) {
  return (
    <div id="sec-interface" className="metal-panel p-6 space-y-4">
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
        {/* Virtual Keyboard Toggle */}
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

        {/* Theme Mode Toggle */}
        <div className="rounded-2xl border border-slate-700/60 bg-slate-950/40 px-4 py-3">
          <div className="text-sm font-semibold text-slate-200">
            {tx(lang, 'Tema rejimi', 'Режим темы', 'Theme mode')}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {([
              ['dark', tx(lang, 'Dark', 'Тёмная', 'Dark')],
              ['light', tx(lang, 'Light (beta)', 'Светлая (beta)', 'Light (beta)')],
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

        {/* Sales UI Mode */}
        <div className="rounded-2xl border border-slate-700/60 bg-slate-950/40 px-4 py-3">
          <div className="text-sm font-semibold text-slate-200">
            {tx(lang, 'Satış UI rejimi', 'Режим UI продаж', 'Sales UI mode')}
          </div>
          <div className="mt-2 text-xs text-slate-400">
            {tx(lang, 'Classic — standart görünüş. Modern — Aelia stilində POS + tam ekran masa sifariş paneli.', 'Classic — стандартный вид. Modern — POS в стиле Aelia + полноэкранная панель заказа.', 'Classic — standard view. Modern — Aelia-style POS + fullscreen table order panel.')}
          </div>
          <div className="mt-3 flex gap-2">
            {(['classic', 'modern'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => { void saveTablesUiMode(mode); }}
                className={`min-h-11 rounded-xl border px-4 text-sm font-bold transition ${
                  ((sessionSettings as any)?.tables_ui_mode || (typeof localStorage !== 'undefined' && localStorage.getItem('iw_tables_ui_mode')) || 'classic') === mode
                    ? 'border-amber-300/70 bg-amber-400/20 text-amber-100'
                    : 'border-slate-700 bg-slate-900/70 text-slate-300'
                }`}
              >
                {mode === 'classic' ? 'Classic' : 'Modern (BahaY)'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Session Security: Idle Logout + Staff PIN */}
      <hr className="border-slate-800/80 my-4" />
      <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Sessiya Təhlükəsizliyi', 'Безопасность сессии', 'Session Security')}</h3>
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

      {/* Login Background Image */}
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
  );
}

import React from 'react';
import { tx } from '../../../i18n';
import type { SessionSettingsState } from './types';

export interface InterfaceSettingsSectionProps {
  lang: string;
  sessionSettings: SessionSettingsState;
  changeThemeMode: (mode: 'dark' | 'light') => Promise<void>;
  toggleVirtualKeyboard: (enabled: boolean) => Promise<void>;
  saveTablesUiMode: (mode: 'classic' | 'modern') => Promise<void>;
}

export function InterfaceSettingsSection({
  lang,
  sessionSettings,
  changeThemeMode,
  toggleVirtualKeyboard,
  saveTablesUiMode,
}: InterfaceSettingsSectionProps) {
  return (
    <div id="sec-interface" className="metal-panel p-6 space-y-4">
      <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'İnterfeys Ayarları', 'Настройки интерфейса', 'Interface Settings')}</h2>
      <p className="text-sm text-slate-400">
        {tx(
          lang,
          'Görünüş və touch istifadə rahatlığı ilə bağlı ayarlar bu bölmədədir. Seçimlər dərhal yadda saxlanılır.',
          'Параметры внешнего вида и удобства touch-использования находятся здесь. Настройки сохраняются сразу.',
          'Appearance and touch usability settings are managed here. Choices are saved immediately.',
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

      <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 px-4 py-3 text-xs text-slate-400">
        {tx(
          lang,
          'Sessiya təhlükəsizliyi (avtomatik çıxış, Staff PIN uzunluğu, giriş ekranı fonu, cihaz təsdiqi) və staff limitləri ayrıca bölmələrdədir: bax "Təhlükəsizlik" kateqoriyası.',
          'Безопасность сессии (автовыход, длина PIN, фон экрана входа, авторизация устройств) и лимиты персонала находятся в отдельных разделах: категория «Безопасность».',
          'Session security (idle logout, staff PIN length, login background, device authorization) and staff benefits live in separate sections: see the "Security" category.',
        )}
      </div>
    </div>
  );
}

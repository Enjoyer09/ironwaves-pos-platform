import React from 'react';
import { tx } from '../../../i18n';

interface BusinessProfileSectionProps {
  lang: string;
  profile: any;
  setProfile: React.Dispatch<React.SetStateAction<any>>;
  handleLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  saveBusinessProfile: () => Promise<void>;
  renderPanelSuccess: (panelId: string) => React.ReactNode;
  saveButtonClass: string;
}

export function BusinessProfileSection({
  lang,
  profile,
  setProfile,
  handleLogoUpload,
  saveBusinessProfile,
  renderPanelSuccess,
  saveButtonClass,
}: BusinessProfileSectionProps) {
  return (
    <div id="sec-profile" className="metal-panel p-6 space-y-4">
      <h2 className="text-xl font-bold text-slate-100">
        {tx(lang, 'Biznes Profili', 'Профиль бизнеса', 'Business Profile')}
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="field-stack form-card">
          <label className="field-label">
            {tx(lang, 'Şirkət adı', 'Название компании', 'Company name')}
          </label>
          <input
            className="neon-input"
            value={profile?.company_name || ''}
            onChange={(e) =>
              setProfile((prev: any) => ({ ...(prev || {}), company_name: e.target.value }))
            }
          />
        </div>
        <div className="field-stack form-card">
          <label className="field-label">
            {tx(lang, 'VÖEN', 'ВÖEN (ИНН)', 'VÖEN (TIN)')}
          </label>
          <input
            className="neon-input"
            value={profile?.voen || ''}
            onChange={(e) =>
              setProfile((prev: any) => ({ ...(prev || {}), voen: e.target.value }))
            }
          />
        </div>
        <div className="field-stack form-card">
          <label className="field-label">
            {tx(lang, 'Telefon', 'Телефон', 'Phone')}
          </label>
          <input
            className="neon-input"
            value={profile?.phone || ''}
            onChange={(e) =>
              setProfile((prev: any) => ({ ...(prev || {}), phone: e.target.value }))
            }
          />
        </div>
        <div className="field-stack form-card">
          <label className="field-label">
            {tx(lang, 'Ünvan', 'Адрес', 'Address')}
          </label>
          <input
            className="neon-input"
            value={profile?.address || ''}
            onChange={(e) =>
              setProfile((prev: any) => ({ ...(prev || {}), address: e.target.value }))
            }
          />
        </div>
        <div className="field-stack form-card">
          <label className="field-label">
            {tx(lang, 'Website', 'Сайт', 'Website')}
          </label>
          <input
            className="neon-input"
            value={profile?.website || ''}
            onChange={(e) =>
              setProfile((prev: any) => ({ ...(prev || {}), website: e.target.value }))
            }
          />
        </div>
        <div className="field-stack form-card">
          <label className="field-label">
            {tx(lang, 'QR Base URL', 'QR Base URL', 'QR Base URL')}
          </label>
          <input
            className="neon-input"
            value={profile?.qr_base_url || ''}
            onChange={(e) =>
              setProfile((prev: any) => ({ ...(prev || {}), qr_base_url: e.target.value }))
            }
          />
        </div>
        <div className="field-stack form-card md:col-span-2">
          <label className="field-label">
            {tx(lang, 'Qəbz alt mətni', 'Текст внизу чека', 'Receipt footer')}
          </label>
          <input
            className="neon-input"
            value={profile?.receipt_footer || ''}
            onChange={(e) =>
              setProfile((prev: any) => ({ ...(prev || {}), receipt_footer: e.target.value }))
            }
          />
        </div>
        <div className="md:col-span-2 mt-2 border-t border-slate-700 pt-3">
          <h3 className="text-sm font-bold text-slate-300">
            {tx(lang, 'Vergi / Fiskal', 'Налоги / Фискал', 'Tax / Fiscal')}
          </h3>
        </div>
        <div className="field-stack form-card">
          <label className="field-label">
            {tx(lang, 'Vergi rejimi', 'Налоговый режим', 'Tax regime')}
          </label>
          <select
            className="neon-input"
            value={profile?.tax_regime || 'simplified'}
            onChange={(e) =>
              setProfile((prev: any) => ({ ...(prev || {}), tax_regime: e.target.value }))
            }
          >
            <option value="simplified">
              {tx(lang, 'Sadələşdirilmiş (ƏDV yox)', 'Упрощённый (без НДС)', 'Simplified (no VAT)')}
            </option>
            <option value="vat">
              {tx(lang, 'ƏDV ödəyicisi', 'Плательщик НДС', 'VAT payer')}
            </option>
          </select>
        </div>
        {profile?.tax_regime === 'vat' && (
          <div className="field-stack form-card">
            <label className="field-label">
              {tx(lang, 'ƏDV dərəcəsi (%)', 'Ставка НДС (%)', 'VAT rate (%)')}
            </label>
            <input
              className="neon-input"
              type="number"
              min="0"
              max="100"
              value={profile?.vat_rate ?? 18}
              onChange={(e) =>
                setProfile((prev: any) => ({ ...(prev || {}), vat_rate: Number(e.target.value) }))
              }
            />
          </div>
        )}
        <div className="field-stack form-card">
          <label className="field-label">
            {tx(lang, 'NKA qeydiyyat №', 'Рег. № ККА', 'NKA registration No')}
          </label>
          <input
            className="neon-input"
            value={profile?.nka_registration_no || ''}
            onChange={(e) =>
              setProfile((prev: any) => ({ ...(prev || {}), nka_registration_no: e.target.value }))
            }
          />
        </div>
        <div className="field-stack form-card md:col-span-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={profile?.fiscal_enabled === true}
              onChange={(e) =>
                setProfile((prev: any) => ({ ...(prev || {}), fiscal_enabled: e.target.checked }))
              }
            />
            <span className="field-label !mb-0">
              {tx(lang, 'Fiskal inteqrasiya aktiv', 'Фискальная интеграция включена', 'Fiscal integration enabled')}
            </span>
          </label>
          <p className="text-xs text-slate-400 mt-1">
            {tx(
              lang,
              'Sertifikatlı e-kassa (NKA) inteqrasiyası üçün. Söndürülü ikən çek "QEYRİ-FİSKAL QƏBZ" kimi çap olunur. Fiskal ID/QR yalnız təsdiqlənmiş modul qoşulanda görünür.',
              'Для интеграции с сертифицированной онлайн-кассой (ККА). При выключении чек печатается как «НЕФИСКАЛЬНЫЙ». Фискальный ID/QR появляется только при подключённом модуле.',
              'For certified e-kassa (NKA) integration. While off, the receipt prints as "NON-FISCAL". Fiscal ID/QR appears only when an approved module is connected.',
            )}
          </p>
        </div>
        <input
          className="neon-input md:col-span-2"
          type="file"
          accept="image/*"
          onChange={handleLogoUpload}
        />
      </div>
      {renderPanelSuccess('business_profile')}
      <div className="flex justify-end">
        <button onClick={() => { void saveBusinessProfile(); }} className={saveButtonClass}>
          {tx(lang, 'Saxla', 'Сохранить', 'Save')}
        </button>
      </div>
    </div>
  );
}

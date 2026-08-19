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

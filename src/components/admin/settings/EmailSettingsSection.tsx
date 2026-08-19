import React from 'react';
import { tx } from '../../../i18n';

interface EmailSettingsSectionProps {
  lang: string;
  emailSettings: any;
  setEmailSettings: React.Dispatch<React.SetStateAction<any>>;
  saveEmailSettings: () => Promise<void>;
  renderPanelSuccess: (panelId: string) => React.ReactNode;
  saveButtonClass: string;
}

export function EmailSettingsSection({
  lang,
  emailSettings,
  setEmailSettings,
  saveEmailSettings,
  renderPanelSuccess,
  saveButtonClass,
}: EmailSettingsSectionProps) {
  return (
    <div id="sec-email" className="metal-panel p-6 space-y-4">
      <h2 className="text-xl font-bold text-slate-100">
        {tx(lang, 'Email və Resend', 'Email и Resend', 'Email and Resend')}
      </h2>
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
          <input
            type="checkbox"
            checked={emailSettings.enabled}
            onChange={(e) =>
              setEmailSettings((prev: any) => ({ ...prev, enabled: e.target.checked }))
            }
          />
          <span>{tx(lang, 'Email göndərimini aktiv et', 'Включить отправку email', 'Enable email sending')}</span>
        </label>
        <select
          className="neon-input"
          value={emailSettings.provider}
          onChange={(e) =>
            setEmailSettings((prev: any) => ({ ...prev, provider: e.target.value }))
          }
        >
          <option value="none">{tx(lang, 'Provayder seçin', 'Выберите провайдера', 'Select provider')}</option>
          <option value="resend">Resend</option>
          <option value="webhook">{tx(lang, 'Webhook', 'Webhook', 'Webhook')}</option>
        </select>
        <input
          className="neon-input"
          value={emailSettings.sender_email}
          onChange={(e) =>
            setEmailSettings((prev: any) => ({ ...prev, sender_email: e.target.value }))
          }
          placeholder={tx(lang, 'Göndərən email', 'Email отправителя', 'Sender email')}
        />
        <input
          className="neon-input"
          value={emailSettings.recipient_emails}
          onChange={(e) =>
            setEmailSettings((prev: any) => ({ ...prev, recipient_emails: e.target.value }))
          }
          placeholder={tx(lang, 'Default alıcılar (vergüllə)', 'Получатели по умолчанию (через запятую)', 'Default recipients (comma separated)')}
        />
        {emailSettings.provider === 'resend' ? (
          <input
            className="neon-input md:col-span-2"
            value={emailSettings.resend_api_key}
            onChange={(e) =>
              setEmailSettings((prev: any) => ({ ...prev, resend_api_key: e.target.value }))
            }
            placeholder="re_..."
          />
        ) : null}
        {emailSettings.provider === 'webhook' ? (
          <input
            className="neon-input md:col-span-2"
            value={emailSettings.webhook_url}
            onChange={(e) =>
              setEmailSettings((prev: any) => ({ ...prev, webhook_url: e.target.value }))
            }
            placeholder={tx(lang, 'Webhook URL', 'Webhook URL', 'Webhook URL')}
          />
        ) : null}
        <input
          className="neon-input"
          type="number"
          min={5}
          value={emailSettings.timeout_sec}
          onChange={(e) =>
            setEmailSettings((prev: any) => ({ ...prev, timeout_sec: e.target.value }))
          }
          placeholder={tx(lang, 'Timeout (san)', 'Timeout (сек)', 'Timeout (sec)')}
        />
      </div>
      {renderPanelSuccess('email')}
      <div className="flex justify-end">
        <button onClick={() => { void saveEmailSettings(); }} className={saveButtonClass}>
          {tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}
        </button>
      </div>
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { tx } from '../../../i18n';
import { upload_menu_image_live } from '../../../api/menu';
import type { DeliveryIntegrationsState, QrMenuSettingsState, FeedbackSettingsState, BaseSectionProps } from './types';
import type { DeliveryMenuMapping } from '../../../api/integrations';

export interface IntegrationsSettingsSectionProps extends BaseSectionProps {
  tenantId: string;
  profile: any;

  // Delivery integrations
  deliveryIntegrations: DeliveryIntegrationsState;
  setDeliveryIntegrations: React.Dispatch<React.SetStateAction<DeliveryIntegrationsState>>;
  saveDeliveryIntegrations: () => Promise<void>;

  // Delivery menu mappings
  deliveryMenuMappings: DeliveryMenuMapping[];
  deliveryMenuMappingsLoading: boolean;
  newDeliveryMenuMapping: {
    provider: 'bolt' | 'wolt';
    external_item_id: string;
    external_item_name: string;
    menu_item_id: string;
  };
  setNewDeliveryMenuMapping: React.Dispatch<React.SetStateAction<{
    provider: 'bolt' | 'wolt';
    external_item_id: string;
    external_item_name: string;
    menu_item_id: string;
  }>>;
  handleAddDeliveryMenuMapping: (e: React.FormEvent) => Promise<void>;
  handleDeleteDeliveryMenuMapping: (id: string) => Promise<void>;
  menuCatalog: any[];

  // QR menu settings
  qrMenuSettings: QrMenuSettingsState;
  setQrMenuSettings: React.Dispatch<React.SetStateAction<QrMenuSettingsState>>;
  saveQrMenuSettings: () => Promise<void>;
  handleQrHeroUpload: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleQrPosterImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleThemePresetChange: (theme: 'dark' | 'light' | 'emerald' | 'custom') => void;

  // Feedback settings
  feedbackSettings: FeedbackSettingsState;
  setFeedbackSettings: React.Dispatch<React.SetStateAction<FeedbackSettingsState>>;
  saveFeedbackSettings: () => Promise<void>;
  autoFeedbackPortalUrl: string;
  newFeedbackTag: string;
  setNewFeedbackTag: (value: string) => void;
}

export function IntegrationsSettingsSection({
  lang,
  saveButtonClass,
  renderPanelSuccess,
  notify,
  tenantId,
  profile,
  deliveryIntegrations,
  setDeliveryIntegrations,
  saveDeliveryIntegrations,
  deliveryMenuMappings,
  deliveryMenuMappingsLoading,
  newDeliveryMenuMapping,
  setNewDeliveryMenuMapping,
  handleAddDeliveryMenuMapping,
  handleDeleteDeliveryMenuMapping,
  menuCatalog,
  qrMenuSettings,
  setQrMenuSettings,
  saveQrMenuSettings,
  handleQrHeroUpload,
  handleQrPosterImageUpload,
  handleThemePresetChange,
  feedbackSettings,
  setFeedbackSettings,
  saveFeedbackSettings,
  autoFeedbackPortalUrl,
  newFeedbackTag,
  setNewFeedbackTag,
}: IntegrationsSettingsSectionProps) {
  // QR poster generation
  const [qrMenuPosterDataUrl, setQrMenuPosterDataUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const baseUrl = String(profile?.qr_base_url || '').trim() || window.location.origin;
        const menuUrl = `${baseUrl.replace(/\/+$/, '')}/qrmenu`;
        const qrDataUrl = await QRCode.toDataURL(menuUrl, { margin: 1, width: 220 });
        const canvas = document.createElement('canvas');
        canvas.width = 900;
        canvas.height = 1200;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = String(qrMenuSettings.background_color || '#efe2c1');
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = String(qrMenuSettings.text_color || '#2b1708');
        ctx.textAlign = 'center';
        ctx.font = 'bold 56px Arial';
        ctx.fillText(String(qrMenuSettings.poster_title || 'Menyuya baxmaq üçün skan et'), canvas.width / 2, 120);
        ctx.font = '28px Arial';
        ctx.fillStyle = String(qrMenuSettings.text_color || '#2b1708');
        ctx.fillText(String(qrMenuSettings.poster_subtitle || 'Telefon kameranızı QR üzərinə yönəldin'), canvas.width / 2, 170);
        if (profile?.company_name) {
          ctx.font = 'bold 36px Arial';
          ctx.fillStyle = String(qrMenuSettings.poster_background_color || '#d59b2d');
          ctx.fillText(String(profile.company_name), canvas.width / 2, 240);
        }
        const qrImage = new Image();
        qrImage.onload = () => {
          ctx.fillStyle = String(qrMenuSettings.surface_color || '#fff7e8');
          ctx.fillRect(190, 300, 520, 520);
          ctx.drawImage(qrImage, 220, 330, 460, 460);
          ctx.font = '24px Arial';
          ctx.fillStyle = String(qrMenuSettings.text_color || '#2b1708');
          ctx.fillText(menuUrl.replace(/^https?:\/\//, ''), canvas.width / 2, 910);
          const posterUrl = canvas.toDataURL('image/png');
          if (!cancelled) setQrMenuPosterDataUrl(posterUrl);
        };
        qrImage.src = qrDataUrl;
      } catch {
        if (!cancelled) setQrMenuPosterDataUrl('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profile?.company_name, profile?.qr_base_url, qrMenuSettings.poster_title, qrMenuSettings.poster_subtitle, qrMenuSettings.background_color, qrMenuSettings.surface_color, qrMenuSettings.text_color, qrMenuSettings.poster_background_color]);

  const downloadQrPoster = () => {
    if (!qrMenuPosterDataUrl) return;
    const link = document.createElement('a');
    link.href = qrMenuPosterDataUrl;
    link.download = `qr-menu-poster-${tenantId}.png`;
    link.click();
  };

  return (
    <>
      <div id="sec-delivery" className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Çatdırılma İnteqrasiyaları', 'Интеграции доставки', 'Delivery Integrations')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Bolt Food və Wolt inteqrasiyaları üçün Provider/Venue ID və Secret Key ayarları.',
            'Настройки Provider/Venue ID и Secret Key для интеграций Bolt Food и Wolt.',
            'Provider/Venue ID and Secret Key settings for Bolt Food and Wolt integrations.',
          )}
        </p>
        
        <div className="border-t border-slate-700/40 pt-4 space-y-3">
          <h3 className="text-md font-semibold text-slate-200">Bolt Food</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-3">
              <input 
                type="checkbox" 
                checked={deliveryIntegrations.bolt_food_enabled} 
                onChange={(e) => setDeliveryIntegrations((prev) => ({ ...prev, bolt_food_enabled: e.target.checked }))} 
              />
              <span>{tx(lang, 'Bolt Food aktiv et', 'Включить Bolt Food', 'Enable Bolt Food')}</span>
            </label>
            <input 
              className="neon-input" 
              value={deliveryIntegrations.bolt_food_provider_id} 
              onChange={(e) => setDeliveryIntegrations((prev) => ({ ...prev, bolt_food_provider_id: e.target.value }))} 
              placeholder="Provider ID" 
            />
            <input 
              className="neon-input md:col-span-2" 
              type="password"
              value={deliveryIntegrations.bolt_food_secret_key} 
              onChange={(e) => setDeliveryIntegrations((prev) => ({ ...prev, bolt_food_secret_key: e.target.value }))} 
              placeholder={tx(lang, 'Secret Key', 'Secret Key', 'Secret Key')} 
            />
            {deliveryIntegrations.bolt_food_enabled && (
              <div className="md:col-span-3 rounded-lg border border-slate-700 bg-slate-950/40 p-3 space-y-1.5">
                <span className="text-xs font-semibold text-slate-400 block">Bolt Food Webhook URL:</span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    className="neon-input flex-1 text-xs select-all py-1.5 opacity-80"
                    value={`${window.location.origin}/api/v1/integrations/bolt/webhook/${tenantId}`}
                  />
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(`${window.location.origin}/api/v1/integrations/bolt/webhook/${tenantId}`);
                      notify('success', tx(lang, 'Webhook URL kopyalandı', 'Webhook URL скопирован', 'Webhook URL copied'));
                    }}
                    className="glossy-gold text-xs px-3 py-1 rounded-lg font-bold"
                  >
                    {tx(lang, 'Kopyala', 'Копировать', 'Copy')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-slate-700/40 pt-4 space-y-3">
          <h3 className="text-md font-semibold text-slate-200">Wolt</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-3">
              <input 
                type="checkbox" 
                checked={deliveryIntegrations.wolt_enabled} 
                onChange={(e) => setDeliveryIntegrations((prev) => ({ ...prev, wolt_enabled: e.target.checked }))} 
              />
              <span>{tx(lang, 'Wolt aktiv et', 'Включить Wolt', 'Enable Wolt')}</span>
            </label>
            <input 
              className="neon-input" 
              value={deliveryIntegrations.wolt_venue_id} 
              onChange={(e) => setDeliveryIntegrations((prev) => ({ ...prev, wolt_venue_id: e.target.value }))} 
              placeholder="Venue ID" 
            />
            <input 
              className="neon-input md:col-span-2" 
              type="password"
              value={deliveryIntegrations.wolt_client_secret} 
              onChange={(e) => setDeliveryIntegrations((prev) => ({ ...prev, wolt_client_secret: e.target.value }))} 
              placeholder={tx(lang, 'Client Secret', 'Client Secret', 'Client Secret')} 
            />
            {deliveryIntegrations.wolt_enabled && (
              <div className="md:col-span-3 rounded-lg border border-slate-700 bg-slate-950/40 p-3 space-y-1.5">
                <span className="text-xs font-semibold text-slate-400 block">Wolt Webhook URL:</span>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    className="neon-input flex-1 text-xs select-all py-1.5 opacity-80"
                    value={`${window.location.origin}/api/v1/integrations/wolt/webhook/${tenantId}`}
                  />
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(`${window.location.origin}/api/v1/integrations/wolt/webhook/${tenantId}`);
                      notify('success', tx(lang, 'Webhook URL kopyalandı', 'Webhook URL скопирован', 'Webhook URL copied'));
                    }}
                    className="glossy-gold text-xs px-3 py-1 rounded-lg font-bold"
                  >
                    {tx(lang, 'Kopyala', 'Копировать', 'Copy')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Menu Mappings Sub-section */}
        <div className="border-t border-slate-700/40 pt-6 space-y-4">
          <div>
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Menyu Xəritələnməsi', 'Сопоставление меню', 'Menu Mappings')}</h3>
            <p className="text-xs text-slate-400">
              {tx(
                lang,
                'Çatdırılma platformalarından (Bolt/Wolt) gələn xarici Məhsul ID-lərini sistemin daxili menyu elementlərinə uyğunlaşdırın.',
                'Сопоставьте внешние ID продуктов от платформ доставки (Bolt/Wolt) с внутренними элементами меню.',
                'Map external product IDs from delivery platforms (Bolt/Wolt) to internal menu items.',
              )}
            </p>
          </div>

          {/* New Mapping Form */}
          <form onSubmit={handleAddDeliveryMenuMapping} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end bg-slate-900/40 p-4 rounded-xl border border-slate-800">
            <div className="space-y-1">
              <label className="text-xs text-slate-400 block">{tx(lang, 'Platforma', 'Платформа', 'Platform')}</label>
              <select
                className="neon-input w-full bg-slate-950 border border-slate-800"
                value={newDeliveryMenuMapping.provider}
                onChange={(e) => setNewDeliveryMenuMapping((prev) => ({ ...prev, provider: e.target.value as 'bolt' | 'wolt' }))}
              >
                <option value="bolt">Bolt Food</option>
                <option value="wolt">Wolt</option>
              </select>
            </div>
            
            <div className="space-y-1">
              <label className="text-xs text-slate-400 block">{tx(lang, 'Xarici Məhsul ID', 'Внешний ID продукта', 'External Product ID')}</label>
              <input
                className="neon-input w-full"
                value={newDeliveryMenuMapping.external_item_id}
                onChange={(e) => setNewDeliveryMenuMapping((prev) => ({ ...prev, external_item_id: e.target.value }))}
                placeholder="Örnək: item-1234"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400 block">{tx(lang, 'Xarici Məhsul Adı (İxtiyari)', 'Внешнее имя (Опционально)', 'External Name (Optional)')}</label>
              <input
                className="neon-input w-full"
                value={newDeliveryMenuMapping.external_item_name}
                onChange={(e) => setNewDeliveryMenuMapping((prev) => ({ ...prev, external_item_name: e.target.value }))}
                placeholder="Örnək: Cappuccino 250ml"
              />
            </div>

            <div className="space-y-1 flex gap-2">
              <div className="flex-1 space-y-1">
                <label className="text-xs text-slate-400 block">{tx(lang, 'Daxili Menyu Məhsulu', 'Внутренний продукт меню', 'Internal Menu Item')}</label>
                <select
                  className="neon-input w-full bg-slate-950 border border-slate-800"
                  value={newDeliveryMenuMapping.menu_item_id}
                  onChange={(e) => setNewDeliveryMenuMapping((prev) => ({ ...prev, menu_item_id: e.target.value }))}
                >
                  <option value="">{tx(lang, 'Seçin...', 'Выберите...', 'Select...')}</option>
                  {menuCatalog.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.item_name} ({Number(item.price).toFixed(2)} AZN)
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                className="glossy-gold h-[42px] px-4 rounded-xl font-bold flex items-center justify-center shrink-0"
              >
                {tx(lang, 'Əlavə Et', 'Добавить', 'Add')}
              </button>
            </div>
          </form>

          {/* Mappings Table */}
          {deliveryMenuMappingsLoading ? (
            <div className="text-center py-4 text-xs text-slate-400">{tx(lang, 'Yüklənir...', 'Загрузка...', 'Loading...')}</div>
          ) : deliveryMenuMappings.length === 0 ? (
            <div className="text-center py-4 text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
              {tx(lang, 'Hələ heç bir menyu xəritələnməsi qurulmayıb.', 'Сопоставления меню еще не настроены.', 'No menu mappings have been set up yet.')}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950/20">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/50 text-slate-400 uppercase font-semibold">
                    <th className="p-3">{tx(lang, 'Platforma', 'Платформа', 'Platform')}</th>
                    <th className="p-3">{tx(lang, 'Xarici ID / Adı', 'Внешний ID / Имя', 'External ID / Name')}</th>
                    <th className="p-3">{tx(lang, 'Daxili Menyu Məhsulu', 'Внутренний продукт', 'Internal Menu Item')}</th>
                    <th className="p-3 text-right">{tx(lang, 'Əməliyyat', 'Действие', 'Action')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {deliveryMenuMappings.map((mapping) => (
                    <tr key={mapping.id} className="hover:bg-slate-900/20 transition-colors">
                      <td className="p-3 capitalize font-medium text-slate-200">
                        {mapping.provider === 'bolt' ? 'Bolt Food' : 'Wolt'}
                      </td>
                      <td className="p-3">
                        <span className="font-mono text-slate-400 block">{mapping.external_item_id}</span>
                        {mapping.external_item_name && (
                          <span className="text-[10px] text-slate-500 block mt-0.5">{mapping.external_item_name}</span>
                        )}
                      </td>
                      <td className="p-3">
                        {mapping.menu_item_name ? (
                          <div className="flex flex-col">
                            <span className="text-slate-100 font-semibold">{mapping.menu_item_name}</span>
                            <span className="text-[10px] text-slate-400">{Number(mapping.menu_item_price).toFixed(2)} AZN</span>
                          </div>
                        ) : (
                          <span className="text-rose-400/80 italic">{tx(lang, 'Məhsul silinib', 'Продукт удален', 'Product deleted')}</span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => handleDeleteDeliveryMenuMapping(mapping.id)}
                          className="px-2.5 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10 text-rose-400 hover:text-rose-300 transition-colors font-semibold"
                        >
                          {tx(lang, 'Sil', 'Удалить', 'Delete')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {renderPanelSuccess('delivery_integrations')}
        {(deliveryIntegrations.bolt_food_enabled && !deliveryIntegrations.bolt_food_provider_id) && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
            ⚠️ {tx(lang, 'Bolt Food aktiv amma Provider ID boşdur', 'Bolt Food активен, но Provider ID пуст', 'Bolt Food enabled but Provider ID is empty')}
          </div>
        )}
        {(deliveryIntegrations.wolt_enabled && !deliveryIntegrations.wolt_venue_id) && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
            ⚠️ {tx(lang, 'Wolt aktiv amma Venue ID boşdur', 'Wolt активен, но Venue ID пуст', 'Wolt enabled but Venue ID is empty')}
          </div>
        )}
        <div className="flex justify-end border-t border-slate-700/40 pt-4">
          <button onClick={() => { void saveDeliveryIntegrations(); }} className={saveButtonClass}>{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>

      <div id="sec-qr" className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'QR menyu ayarları', 'QR Menu Settings', 'QR Menu Settings')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Müştərilər QR skan edib login olmadan public menyunu görə bilərlər. Buradan başlıq, poster və görünəcək məlumatları idarə edin.',
            'Клиенты могут открыть публичное меню по QR без логина. Здесь управляются заголовки, постер и видимые поля.',
            'Customers can open the public menu via QR without logging in. Manage title, poster, and visible fields here.',
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
            <input type="checkbox" checked={qrMenuSettings.enabled} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, enabled: e.target.checked }))} />
            <span>{tx(lang, 'İctimai QR menyu aktiv olsun', 'Публичное QR меню активно', 'Enable public QR Menu')}</span>
          </label>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Başlıq', 'Заголовок', 'Hero title')}</label>
            <input className="neon-input" value={qrMenuSettings.hero_title} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, hero_title: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Alt başlıq', 'Подзаголовок', 'Hero subtitle')}</label>
            <input className="neon-input" value={qrMenuSettings.hero_subtitle} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, hero_subtitle: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Poster başlığı', 'Заголовок постера', 'Poster title')}</label>
            <input className="neon-input" value={qrMenuSettings.poster_title} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, poster_title: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Poster alt mətni', 'Подзаголовок постера', 'Poster subtitle')}</label>
            <input className="neon-input" value={qrMenuSettings.poster_subtitle} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, poster_subtitle: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Arxa fon rəngi', 'Цвет фона', 'Background color')}</label>
            <div className="flex items-center gap-2">
              <input className="h-10 w-14 cursor-pointer rounded-lg border-0 bg-transparent p-0" type="color" value={qrMenuSettings.background_color} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, background_color: e.target.value }))} />
              <input className="neon-input flex-1 font-mono text-xs" value={qrMenuSettings.background_color} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, background_color: e.target.value }))} />
            </div>
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Kart fonu', 'Цвет карточек', 'Surface color')}</label>
            <div className="flex items-center gap-2">
              <input className="h-10 w-14 cursor-pointer rounded-lg border-0 bg-transparent p-0" type="color" value={qrMenuSettings.surface_color} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, surface_color: e.target.value }))} />
              <input className="neon-input flex-1 font-mono text-xs" value={qrMenuSettings.surface_color} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, surface_color: e.target.value }))} />
            </div>
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Yazı rəngi', 'Цвет текста', 'Text color')}</label>
            <div className="flex items-center gap-2">
              <input className="h-10 w-14 cursor-pointer rounded-lg border-0 bg-transparent p-0" type="color" value={qrMenuSettings.text_color} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, text_color: e.target.value }))} />
              <input className="neon-input flex-1 font-mono text-xs" value={qrMenuSettings.text_color} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, text_color: e.target.value }))} />
            </div>
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Poster vurğu rəngi', 'Акцент постера', 'Poster accent color')}</label>
            <div className="flex items-center gap-2">
              <input className="h-10 w-14 cursor-pointer rounded-lg border-0 bg-transparent p-0" type="color" value={qrMenuSettings.poster_background_color} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, poster_background_color: e.target.value }))} />
              <input className="neon-input flex-1 font-mono text-xs" value={qrMenuSettings.poster_background_color} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, poster_background_color: e.target.value }))} />
            </div>
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Əsas rəng (qiymət, accent)', 'Основной цвет (цена, акцент)', 'Primary color (price, accent)')}</label>
            <div className="flex items-center gap-2">
              <input className="h-10 w-14 cursor-pointer rounded-lg border-0 bg-transparent p-0" type="color" value={qrMenuSettings.primary_color} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, primary_color: e.target.value }))} />
              <input className="neon-input flex-1 font-mono text-xs" value={qrMenuSettings.primary_color} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, primary_color: e.target.value }))} />
            </div>
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'İkinci vurğu rəngi', 'Вторичный акцент', 'Accent color')}</label>
            <div className="flex items-center gap-2">
              <input className="h-10 w-14 cursor-pointer rounded-lg border-0 bg-transparent p-0" type="color" value={qrMenuSettings.accent_color} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, accent_color: e.target.value }))} />
              <input className="neon-input flex-1 font-mono text-xs" value={qrMenuSettings.accent_color} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, accent_color: e.target.value }))} />
            </div>
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Hero şəkil linki', 'Ссылка hero-изображения', 'Hero image URL')}</label>
            <input className="neon-input" value={qrMenuSettings.hero_image_url} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, hero_image_url: e.target.value }))} />
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Hero şəkil yüklə', 'Загрузить hero-изображение', 'Upload hero image')}</label>
            <input className="neon-input" type="file" accept="image/*" onChange={handleQrHeroUpload} />
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Sağ poster şəkli', 'Изображение правого постера', 'Right poster image')}</label>
            <input className="neon-input" value={qrMenuSettings.poster_image_url} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, poster_image_url: e.target.value }))} placeholder={tx(lang, 'Kiçik şəkil URL və ya yüklənmiş şəkil', 'URL маленького изображения или загруженное изображение', 'Small image URL or uploaded image')} />
            <input className="neon-input" type="file" accept="image/*" onChange={handleQrPosterImageUpload} />
            <div className="text-xs text-slate-400">
              {tx(lang, 'Şəkil avtomatik kiçildilir: maksimum 768 KB fayl, 640px tərəf və ~350 KB saxlanılan data.', 'Изображение автоматически уменьшается: файл до 768 KB, сторона 640px и ~350 KB данных.', 'Image is auto-compressed: max 768 KB file, 640px side and ~350 KB stored data.')}
            </div>
            {qrMenuSettings.poster_image_url ? (
              <button type="button" className="neon-btn rounded-xl px-3 py-2 text-xs" onClick={() => setQrMenuSettings((prev) => ({ ...prev, poster_image_url: '' }))}>
                {tx(lang, 'Poster şəklini sil', 'Удалить изображение постера', 'Remove poster image')}
              </button>
            ) : null}
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Dizayn şablonu', 'Шаблон дизайна', 'Layout preset')}</label>
            <select className="neon-input" value={qrMenuSettings.layout_preset} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, layout_preset: e.target.value as any }))}>
              <option value="classic">{tx(lang, 'Klassik (Çox addımlı)', 'Классический (Многошаговый)', 'Classic (Multi-step)')}</option>
              <option value="bolt">{tx(lang, 'Bolt Food stili (Tək səhifə)', 'Bolt Food стиль (Одностраничный)', 'Bolt Food style (Single page)')}</option>
            </select>
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Mövzu seçimi', 'Выбор темы', 'Theme preset')}</label>
            <select className="neon-input" value={qrMenuSettings.theme_preset} onChange={(e) => handleThemePresetChange(e.target.value as any)}>
              <option value="dark">{tx(lang, 'Qaranlıq (Dark)', 'Темная (Dark)', 'Dark')}</option>
              <option value="light">{tx(lang, 'İşıqlı (Light)', 'Светлая (Light)', 'Light')}</option>
              <option value="emerald">{tx(lang, 'Zümrüd (Emerald)', 'Изумрудная (Emerald)', 'Emerald')}</option>
              <option value="custom">{tx(lang, 'Xüsusi (Fərdi rənglər)', 'Кастомная (Свои цвета)', 'Custom (Personal colors)')}</option>
            </select>
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Logo forması', 'Форма логотипа', 'Logo shape')}</label>
            <select className="neon-input" value={qrMenuSettings.logo_shape} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, logo_shape: e.target.value as any }))}>
              <option value="rounded">{tx(lang, 'Yumru künc', 'Скругленный', 'Rounded')}</option>
              <option value="circle">{tx(lang, 'Dairəvi', 'Круглый', 'Circle')}</option>
              <option value="square">{tx(lang, 'Kvadrat', 'Квадратный', 'Square')}</option>
            </select>
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Şrift ailəsi', 'Семейство шрифтов', 'Font family')}</label>
            <select className="neon-input" value={qrMenuSettings.font_family} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, font_family: e.target.value }))}>
              <option value="">{tx(lang, 'Standart (Geist Sans)', 'Стандартный (Geist Sans)', 'Default (Geist Sans)')}</option>
              <option value="Inter">Inter</option>
              <option value="Poppins">Poppins</option>
              <option value="Montserrat">Montserrat</option>
              <option value="Playfair Display">Playfair Display</option>
              <option value="Raleway">Raleway</option>
              <option value="Nunito">Nunito</option>
              <option value="Lora">Lora</option>
              <option value="Roboto">Roboto</option>
              <option value="Open Sans">Open Sans</option>
              <option value="Oswald">Oswald</option>
              <option value="custom">{tx(lang, 'Xüsusi şrift (URL ilə)', 'Свой шрифт (по URL)', 'Custom font (via URL)')}</option>
            </select>
            <p className="text-[11px] text-slate-400">{tx(lang, 'Google Fonts-dan populyar şriftlər. "Xüsusi şrift" seçsəniz aşağıda URL daxil edin.', 'Популярные шрифты из Google Fonts. Выберите "Свой шрифт" для URL.', 'Popular Google Fonts. Select "Custom font" to provide a URL below.')}</p>
          </div>
          {qrMenuSettings.font_family === 'custom' && (
            <div className="field-stack form-card md:col-span-2">
              <label className="field-label">{tx(lang, 'Xüsusi şrift URL (CSS @font-face)', 'URL шрифта (CSS @font-face)', 'Custom font URL (CSS @font-face)')}</label>
              <input className="neon-input" value={qrMenuSettings.custom_font_url} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, custom_font_url: e.target.value }))} placeholder="https://fonts.googleapis.com/css2?family=YourFont&display=swap" />
              <p className="text-[11px] text-slate-400">{tx(lang, 'Google Fonts və ya hər hansı CSS font URL yapışdırın. Şrift adını yuxarıdakı sahəyə yazın.', 'Вставьте URL Google Fonts или любой CSS font. Имя шрифта укажите выше.', 'Paste a Google Fonts or any CSS font URL. Enter the font name above.')}</p>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={qrMenuSettings.show_prices} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, show_prices: e.target.checked }))} />
            <span>{tx(lang, 'Qiymətləri göstər', 'Показывать цены', 'Show prices')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={qrMenuSettings.show_images} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, show_images: e.target.checked }))} />
            <span>{tx(lang, 'Şəkilləri göstər', 'Показывать фото', 'Show images')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
            <input type="checkbox" checked={qrMenuSettings.show_descriptions} onChange={(e) => setQrMenuSettings((prev) => ({ ...prev, show_descriptions: e.target.checked }))} />
            <span>{tx(lang, 'Təsvirləri göstər', 'Показывать описания', 'Show descriptions')}</span>
          </label>
        </div>
        <div className="rounded-2xl border border-slate-700/60 bg-slate-950/30 p-4 text-sm text-slate-300">
          <div className="font-semibold text-slate-100">{tx(lang, 'QR Menu linki', 'Ссылка QR Menu', 'QR Menu link')}</div>
          <div className="mt-2 break-all text-cyan-300">{`${String(profile?.qr_base_url || '').trim() || window.location.origin}`.replace(/\/+$/, '')}/qrmenu</div>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-3xl border border-slate-700/60 bg-slate-950/30 p-5">
            <div className="text-sm font-semibold text-slate-100">{tx(lang, 'Poster preview', 'Превью постера', 'Poster preview')}</div>
            {qrMenuPosterDataUrl ? (
              <img src={qrMenuPosterDataUrl} alt="QR Menu poster" className="mx-auto mt-4 w-full max-w-xs rounded-2xl ring-1 ring-white/10" />
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-700/60 p-8 text-center text-slate-400">
                {tx(lang, 'Poster hazırlanır...', 'Постер готовится...', 'Poster is being prepared...')}
              </div>
            )}
          </div>
          <div className="rounded-3xl border border-slate-700/60 bg-slate-950/30 p-5 text-sm text-slate-300">
            <div className="font-semibold text-slate-100">{tx(lang, 'Public menyuda nələr görünəcək', 'Что будет видно в публичном меню', 'What will be visible in public menu')}</div>
            <ul className="mt-4 space-y-2">
              <li>{tx(lang, 'Tenant logo və rəngləri', 'Логотип и цвета tenant', 'Tenant logo and colors')}</li>
              <li>{tx(lang, 'Kateqoriya filtri və axtarış', 'Фильтр категорий и поиск', 'Category filter and search')}</li>
              <li>{tx(lang, 'Məhsul şəkli', 'Фото товара', 'Product image')}: {qrMenuSettings.show_images ? tx(lang, 'aktiv', 'вкл', 'on') : tx(lang, 'söndürülüb', 'выкл', 'off')}</li>
              <li>{tx(lang, 'Məhsul təsviri', 'Описание товара', 'Product description')}: {qrMenuSettings.show_descriptions ? tx(lang, 'aktiv', 'вкл', 'on') : tx(lang, 'söndürülüb', 'выкл', 'off')}</li>
              <li>{tx(lang, 'Qiymət', 'Цена', 'Price')}: {qrMenuSettings.show_prices ? tx(lang, 'aktiv', 'вкл', 'on') : tx(lang, 'söndürülüb', 'выкл', 'off')}</li>
            </ul>
          </div>
        </div>
        {renderPanelSuccess('qr_menu')}

        {/* ── Splash Screen Settings ── */}
        <div className="border-t border-slate-700/40 pt-5 space-y-3">
          <h3 className="text-lg font-bold text-slate-100">{tx(lang, '🎬 Splash Ekranı (menyu yüklənərkən)', '🎬 Splash-экран (при загрузке меню)', '🎬 Splash Screen (while menu loads)')}</h3>
          <p className="text-sm text-slate-400">
            {tx(lang, 'Müştəri QR scan etdikdə menyu yüklənənədək göstəriləcək video, şəkil və ya GIF. Restoran ambiance-ını premium şəkildə təqdim edin.', 'Видео, изображение или GIF, которое показывается пока загружается меню. Представьте атмосферу ресторана.', 'Video, image or GIF shown while menu loads. Showcase your restaurant ambiance.')}
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="field-stack">
              <label className="text-xs font-semibold text-slate-300">{tx(lang, 'Splash tipi', 'Тип splash', 'Splash type')}</label>
              <select className="neon-input" value={qrMenuSettings.splash_type || 'none'} onChange={(e) => setQrMenuSettings((p) => ({ ...p, splash_type: e.target.value }))}>
                <option value="none">{tx(lang, 'Söndürülüb (default skeleton)', 'Отключено (скелетон)', 'Disabled (default skeleton)')}</option>
                <option value="image">{tx(lang, 'Şəkil (JPG/PNG/WebP)', 'Изображение', 'Image')}</option>
                <option value="gif">{tx(lang, 'GIF (animasiya)', 'GIF (анимация)', 'GIF (animation)')}</option>
                <option value="video">{tx(lang, 'Video (MP4, max 2MB)', 'Видео (MP4, макс 2МБ)', 'Video (MP4, max 2MB)')}</option>
              </select>
            </div>
            <div className="field-stack">
              <label className="text-xs font-semibold text-slate-300">{tx(lang, 'Müddət (ms)', 'Длительность (мс)', 'Duration (ms)')}</label>
              <input className="neon-input" type="number" min="1000" max="10000" step="500" value={qrMenuSettings.splash_duration_ms || 3000} onChange={(e) => setQrMenuSettings((p) => ({ ...p, splash_duration_ms: Number(e.target.value) }))} />
            </div>
            <div className="field-stack md:col-span-2">
              <label className="text-xs font-semibold text-slate-300">{tx(lang, 'Şəkil/GIF (fayl yüklə və ya URL yapışdır)', 'Изображение/GIF (загрузите или вставьте URL)', 'Image/GIF (upload file or paste URL)')}</label>
              <div className="flex gap-2">
                <input className="neon-input flex-1" value={qrMenuSettings.splash_url || ''} onChange={(e) => setQrMenuSettings((p) => ({ ...p, splash_url: e.target.value }))} placeholder="https://example.com/splash.gif" />
                <label className="shrink-0 cursor-pointer rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-2.5 text-sm font-bold text-cyan-100 transition hover:bg-cyan-500/20 active:scale-95">
                  📁 {tx(lang, 'Yüklə', 'Загрузить', 'Upload')}
                  <input
                    type="file"
                    accept="image/*,.gif,video/mp4"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const isVideo = file.type.startsWith('video/');
                      const maxSize = isVideo ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
                      if (file.size > maxSize) {
                        notify('error', tx(lang, `Fayl çox böyükdür (max ${isVideo ? '2MB' : '5MB'})`, `Файл слишком большой (макс ${isVideo ? '2МБ' : '5МБ'})`, `File too large (max ${isVideo ? '2MB' : '5MB'})`));
                        e.target.value = '';
                        return;
                      }
                      try {
                        notify('info', tx(lang, 'Serverə yüklənir...', 'Загрузка на сервер...', 'Uploading to server...'));
                        const imageUrl = await upload_menu_image_live(file);
                        setQrMenuSettings((p) => ({
                          ...p,
                          splash_url: imageUrl,
                          ...(isVideo ? { splash_type: 'video' } : {}),
                        }));
                        notify('success', tx(lang, 'Splash media yükləndi', 'Splash медиа загружено', 'Splash media uploaded'));
                      } catch (err: any) {
                        notify('error', err?.message || tx(lang, 'Yükləmə uğursuz oldu. Backend aktiv olmalıdır.', 'Загрузка не удалась. Backend должен быть активен.', 'Upload failed. Backend must be active.'));
                      }
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              {qrMenuSettings.splash_url && (
                <div className="mt-2 flex items-center gap-3">
                  {qrMenuSettings.splash_type === 'video' ? (
                    <video src={qrMenuSettings.splash_url} className="h-16 w-24 rounded-lg object-cover border border-slate-700/40" muted autoPlay loop playsInline />
                  ) : (
                    <img src={qrMenuSettings.splash_url} alt="splash preview" className="h-16 w-24 rounded-lg object-cover border border-slate-700/40" />
                  )}
                  <button type="button" onClick={() => setQrMenuSettings((p) => ({ ...p, splash_url: '' }))} className="text-xs text-rose-400 hover:text-rose-300">✕ {tx(lang, 'Sil', 'Удалить', 'Remove')}</button>
                </div>
              )}
            </div>
            <div className="field-stack">
              <label className="text-xs font-semibold text-slate-300">{tx(lang, 'Overlay text (opsional)', 'Текст поверх (необязательно)', 'Overlay text (optional)')}</label>
              <input className="neon-input" value={qrMenuSettings.splash_overlay_text || ''} onChange={(e) => setQrMenuSettings((p) => ({ ...p, splash_overlay_text: e.target.value }))} placeholder={tx(lang, 'Menyuya xoş gəlmisiniz', 'Добро пожаловать', 'Welcome to our menu')} />
            </div>
            <div className="field-stack">
              <label className="text-xs font-semibold text-slate-300">{tx(lang, 'Arxa fon rəngi', 'Цвет фона', 'Background color')}</label>
              <input className="neon-input" type="color" value={qrMenuSettings.splash_bg_color || '#000000'} onChange={(e) => setQrMenuSettings((p) => ({ ...p, splash_bg_color: e.target.value }))} />
            </div>
          </div>
          {qrMenuSettings.splash_type && qrMenuSettings.splash_type !== 'none' && qrMenuSettings.splash_url && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-200">
              ✅ {tx(lang, 'Splash aktiv — müştəri menyu açanda bu media göstəriləcək', 'Splash активен — будет показан при открытии меню', 'Splash active — will be shown when menu opens')}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={downloadQrPoster} className="neon-btn rounded-xl px-5 py-2 font-semibold">
            {tx(lang, 'Poster yüklə', 'Скачать постер', 'Download poster')}
          </button>
          <button onClick={() => { void saveQrMenuSettings(); }} className={saveButtonClass}>
            {tx(lang, 'QR Menu ayarlarını saxla', 'Сохранить QR Menu', 'Save QR Menu settings')}
          </button>
        </div>
      </div>

      <div id="sec-feedback" className="metal-panel p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Müştəri Feedback Portalı', 'Портал отзывов клиентов', 'Customer feedback portal')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Çek və QR üzərindən müştəri rəyinə yönləndirmə üçün portal linklərini buradan idarə edin. Bu pəncərə Landing Studio-dan ayrıca işləyir.',
            'Управляйте ссылками для отзывов с чека и QR отсюда. Это отдельное окно, не связано с Landing Studio.',
            'Manage customer feedback links from receipt/QR here. This panel is separate from Landing Studio.',
          )}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
            <input
              type="checkbox"
              checked={feedbackSettings.enabled}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, enabled: e.target.checked }))}
            />
            <span>{tx(lang, 'Feedback portalını aktiv et', 'Включить feedback портал', 'Enable feedback portal')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
            <input
              type="checkbox"
              checked={feedbackSettings.promo_enabled}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, promo_enabled: e.target.checked }))}
            />
            <span>{tx(lang, 'Promo / feedback kuponunu aktiv et', 'Включить promo / coupon за feedback', 'Enable promo / feedback coupon')}</span>
          </label>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Feedback portal URL', 'URL feedback портала', 'Feedback portal URL')}</label>
            <input
              className="neon-input"
              value={feedbackSettings.portal_url}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, portal_url: e.target.value }))}
              placeholder={autoFeedbackPortalUrl}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <span>{tx(lang, 'Tövsiyə olunan daxili link', 'Рекомендуемая внутренняя ссылка', 'Recommended internal link')}: {autoFeedbackPortalUrl}</span>
              <button
                type="button"
                onClick={() => setFeedbackSettings((prev) => ({ ...prev, portal_url: autoFeedbackPortalUrl }))}
                className="neon-btn rounded-lg px-3 py-1 text-xs"
              >
                {tx(lang, 'Auto doldur', 'Автозаполнить', 'Auto fill')}
              </button>
            </div>
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Google review URL', 'URL Google review', 'Google review URL')}</label>
            <input
              className="neon-input"
              value={feedbackSettings.google_review_url}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, google_review_url: e.target.value }))}
              placeholder="https://g.page/r/..."
            />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Feedback kuponu endirim %', 'Скидка купона feedback %', 'Feedback coupon discount %')}</label>
            <input
              className="neon-input"
              type="number"
              min={1}
              max={100}
              value={feedbackSettings.coupon_percent}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, coupon_percent: Number(e.target.value || 5) }))}
            />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Çek düyməsi mətni (AZ)', 'Текст кнопки на чеке (AZ)', 'Receipt button text (AZ)')}</label>
            <input
              className="neon-input"
              value={feedbackSettings.receipt_button_text_az}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, receipt_button_text_az: e.target.value }))}
            />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Çek düyməsi mətni (RU)', 'Текст кнопки на чеке (RU)', 'Receipt button text (RU)')}</label>
            <input
              className="neon-input"
              value={feedbackSettings.receipt_button_text_ru}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, receipt_button_text_ru: e.target.value }))}
            />
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Çek düyməsi mətni (EN)', 'Текст кнопки на чеке (EN)', 'Receipt button text (EN)')}</label>
            <input
              className="neon-input"
              value={feedbackSettings.receipt_button_text_en}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, receipt_button_text_en: e.target.value }))}
            />
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Çek QR mesajı (AZ)', 'Текст QR на чеке (AZ)', 'Receipt QR message (AZ)')}</label>
            <textarea
              className="neon-input min-h-[90px]"
              value={feedbackSettings.receipt_qr_prompt_az}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, receipt_qr_prompt_az: e.target.value }))}
            />
          </div>

          {/* Vizual Brendinq və Mövzu */}
          <div className="border-t border-slate-700/60 pt-4 md:col-span-2">
            <h3 className="text-md font-bold text-slate-200 mb-2">{tx(lang, 'Portalın Görünüşü və Brendinq', 'Внешний вид портала и брендинг', 'Portal Appearance & Branding')}</h3>
          </div>

          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Əsas Rəng (Primary)', 'Основной цвет (Primary)', 'Primary Color')}</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="h-10 w-12 rounded border border-slate-600 bg-transparent cursor-pointer"
                value={feedbackSettings.primary_color}
                onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, primary_color: e.target.value }))}
              />
              <input
                type="text"
                className="neon-input flex-1"
                value={feedbackSettings.primary_color}
                onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, primary_color: e.target.value }))}
              />
            </div>
          </div>

          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Accent Rəng', 'Акцентный цвет', 'Accent Color')}</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                className="h-10 w-12 rounded border border-slate-600 bg-transparent cursor-pointer"
                value={feedbackSettings.accent_color}
                onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, accent_color: e.target.value }))}
              />
              <input
                type="text"
                className="neon-input flex-1"
                value={feedbackSettings.accent_color}
                onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, accent_color: e.target.value }))}
              />
            </div>
          </div>

          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Başlıq Emojisi', 'Эмодзи заголовка', 'Header Emoji Icon')}</label>
            <input
              className="neon-input"
              value={feedbackSettings.emoji_icon}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, emoji_icon: e.target.value }))}
              placeholder="☕"
            />
          </div>

          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Fon Qradiyenti (CSS)', 'Градиент фона (CSS)', 'Background Gradient (CSS)')}</label>
            <select
              className="neon-input"
              value={
                ['linear-gradient(155deg, #8ec5ff 0%, #a48bff 28%, #ef8cf9 57%, #ffb58f 100%)',
                 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                 'linear-gradient(135deg, #1e1b4b 0%, #311042 100%)',
                 'linear-gradient(135deg, #064e3b 0%, #022c22 100%)',
                 'linear-gradient(135deg, #7c2d12 0%, #451a03 100%)'].includes(feedbackSettings.bg_gradient || '')
                  ? feedbackSettings.bg_gradient
                  : 'custom'
              }
              onChange={(e) => {
                const val = e.target.value;
                if (val !== 'custom') {
                  setFeedbackSettings((prev) => ({ ...prev, bg_gradient: val }));
                }
              }}
            >
              <option value="linear-gradient(155deg, #8ec5ff 0%, #a48bff 28%, #ef8cf9 57%, #ffb58f 100%)">Vibrant Wave (Default)</option>
              <option value="linear-gradient(135deg, #0f172a 0%, #1e293b 100%)">Dark Slate</option>
              <option value="linear-gradient(135deg, #1e1b4b 0%, #311042 100%)">Deep Purple</option>
              <option value="linear-gradient(135deg, #064e3b 0%, #022c22 100%)">Forest Emerald</option>
              <option value="linear-gradient(135deg, #7c2d12 0%, #451a03 100%)">Warm Rust</option>
              <option value="custom">Custom CSS Gradient...</option>
            </select>
          </div>

          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Fərdi Fon Qradiyenti (CSS Kodu)', 'Свой градиент фона (CSS Код)', 'Custom Background Gradient (CSS Code)')}</label>
            <input
              className="neon-input"
              value={feedbackSettings.bg_gradient}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, bg_gradient: e.target.value }))}
              placeholder="linear-gradient(135deg, #1e293b, #0f172a)"
            />
          </div>

          {/* Qiymətləndirmə Hədləri */}
          <div className="border-t border-slate-700/60 pt-4 md:col-span-2">
            <h3 className="text-md font-bold text-slate-200 mb-2">{tx(lang, 'Qiymətləndirmə Qaydaları', 'Правила оценки', 'Rating Thresholds & Rules')}</h3>
          </div>

          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Google Review üçün minimum ulduz', 'Минимум звезд для Google Review', 'Min stars for Google Review button')}</label>
            <select
              className="neon-input"
              value={feedbackSettings.min_stars_for_google_review}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, min_stars_for_google_review: Number(e.target.value) }))}
            >
              <option value={1}>1 ulduz və yuxarı</option>
              <option value={2}>2 ulduz və yuxarı</option>
              <option value={3}>3 ulduz və yuxarı</option>
              <option value={4}>4 ulduz və yuxarı</option>
              <option value={5}>Yalnız 5 ulduz</option>
            </select>
          </div>

          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Şərh daxil edilməsi məcburi olan hədd (ulduz)', 'Обязательный комментарий при оценке ниже', 'Mandatory comment rating threshold')}</label>
            <select
              className="neon-input"
              value={feedbackSettings.required_comment_threshold}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, required_comment_threshold: Number(e.target.value) }))}
            >
              <option value={0}>Heç vaxt məcburi olmasın (Opsional)</option>
              <option value={1}>1 ulduz və aşağı</option>
              <option value={2}>2 ulduz və aşağı</option>
              <option value={3}>3 ulduz və aşağı</option>
              <option value={4}>4 ulduz və aşağı</option>
              <option value={5}>Həmişə məcburi olsun</option>
            </select>
          </div>

          {/* Səhifə Başlıqları */}
          <div className="border-t border-slate-700/60 pt-4 md:col-span-2">
            <h3 className="text-md font-bold text-slate-200 mb-2">{tx(lang, 'Fərdi Başlıq və Mətnlər', 'Свои заголовки и тексты', 'Custom Titles & Headings')}</h3>
          </div>

          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Portal Başlığı (AZ)', 'Заголовок портала (AZ)', 'Portal Heading (AZ)')}</label>
            <input
              className="neon-input"
              value={feedbackSettings.custom_heading_az}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, custom_heading_az: e.target.value }))}
            />
          </div>

          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Portal Alt Başlığı (AZ)', 'Подзаголовок портала (AZ)', 'Portal Subheading (AZ)')}</label>
            <input
              className="neon-input"
              value={feedbackSettings.custom_subheading_az}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, custom_subheading_az: e.target.value }))}
            />
          </div>

          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Portal Başlığı (RU)', 'Заголовок портала (RU)', 'Portal Heading (RU)')}</label>
            <input
              className="neon-input"
              value={feedbackSettings.custom_heading_ru}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, custom_heading_ru: e.target.value }))}
            />
          </div>

          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Portal Alt Başlığı (RU)', 'Подзаголовок портала (RU)', 'Portal Subheading (RU)')}</label>
            <input
              className="neon-input"
              value={feedbackSettings.custom_subheading_ru}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, custom_subheading_ru: e.target.value }))}
            />
          </div>

          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Portal Başlığı (EN)', 'Заголовок портала (EN)', 'Portal Heading (EN)')}</label>
            <input
              className="neon-input"
              value={feedbackSettings.custom_heading_en}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, custom_heading_en: e.target.value }))}
            />
          </div>

          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Portal Alt Başlığı (EN)', 'Подзаголовок портала (EN)', 'Portal Subheading (EN)')}</label>
            <input
              className="neon-input"
              value={feedbackSettings.custom_subheading_en}
              onChange={(e) => setFeedbackSettings((prev) => ({ ...prev, custom_subheading_en: e.target.value }))}
            />
          </div>

          {/* Hazır Tag Redaktoru */}
          <div className="border-t border-slate-700/60 pt-4 md:col-span-2">
            <h3 className="text-md font-bold text-slate-200 mb-2">{tx(lang, 'Hazır Rəy Tag-ləri', 'Быстрые теги отзывов', 'Preset Feedback Tags')}</h3>
          </div>

          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Yeni Tag Əlavə Et', 'Добавить новый тег', 'Add New Tag')}</label>
            <div className="flex gap-2">
              <input
                className="neon-input"
                value={newFeedbackTag}
                onChange={(e) => setNewFeedbackTag(e.target.value)}
                placeholder="Məs: ☕ Süper qəhvə"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const tag = newFeedbackTag.trim();
                    if (tag && !feedbackSettings.preset_tags.includes(tag)) {
                      setFeedbackSettings((prev) => ({
                        ...prev,
                        preset_tags: [...prev.preset_tags, tag],
                      }));
                      setNewFeedbackTag('');
                    }
                  }
                }}
              />
              <button
                type="button"
                className="neon-btn rounded-xl px-4 py-2 font-bold"
                onClick={() => {
                  const tag = newFeedbackTag.trim();
                  if (tag && !feedbackSettings.preset_tags.includes(tag)) {
                    setFeedbackSettings((prev) => ({
                      ...prev,
                      preset_tags: [...prev.preset_tags, tag],
                    }));
                    setNewFeedbackTag('');
                  }
                }}
              >
                {tx(lang, 'Əlavə et', 'Добавить', 'Add')}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 rounded-xl border border-slate-700/70 bg-slate-950/20 p-3">
              {feedbackSettings.preset_tags.length === 0 && (
                <span className="text-xs text-slate-500">{tx(lang, 'Hələ heç bir tag yoxdur.', 'Нет добавленных тегов.', 'No tags added yet.')}</span>
              )}
              {feedbackSettings.preset_tags.map((tag) => (
                <div key={tag} className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-800/40 px-3 py-1 text-xs text-slate-200">
                  <span>{tag}</span>
                  <button
                    type="button"
                    className="text-slate-400 hover:text-slate-100 font-bold"
                    onClick={() => {
                      setFeedbackSettings((prev) => ({
                        ...prev,
                        preset_tags: prev.preset_tags.filter((t) => t !== tag),
                      }));
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
        {renderPanelSuccess('feedback')}
        <div className="flex justify-end">
          <button onClick={() => { void saveFeedbackSettings(); }} className={saveButtonClass}>
            {tx(lang, 'Feedback ayarlarını saxla', 'Сохранить feedback настройки', 'Save feedback settings')}
          </button>
        </div>
      </div>
    </>
  );
}

import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';
import { get_settings_live, update_landing_settings_live } from '../../api/settings';

export default function LandingPanel() {
  const { user, lang, notify } = useAppStore();
  const tenantId = user?.tenant_id || 'tenant_default';
  const [form, setForm] = useState<any>({
    hero_title_az: '',
    hero_title_ru: '',
    hero_title_en: '',
    hero_body_az: '',
    hero_body_ru: '',
    hero_body_en: '',
    primary_cta_az: '',
    primary_cta_ru: '',
    primary_cta_en: '',
    secondary_cta_az: '',
    secondary_cta_ru: '',
    secondary_cta_en: '',
    contact_email: '',
    contact_phone: '',
    contact_whatsapp: '',
  });

  useEffect(() => {
    const load = async () => {
      try {
        const settings = await get_settings_live(tenantId);
        setForm((prev: any) => ({ ...prev, ...(settings.landing_settings || {}) }));
      } catch (e: any) {
        notify('error', e?.message || tx(lang, 'Landing ayarları yüklənmədi', 'Настройки landing не загрузились', 'Landing settings failed to load'));
      }
    };
    void load();
  }, [tenantId, lang, notify]);

  const setField = (key: string, value: string) => setForm((prev: any) => ({ ...prev, [key]: value }));

  const save = async () => {
    try {
      await update_landing_settings_live(form);
      notify('success', tx(lang, 'Landing ayarları yadda saxlanıldı', 'Настройки landing сохранены', 'Landing settings saved'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Landing ayarları saxlanmadı', 'Настройки landing не сохранились', 'Landing settings failed to save'));
    }
  };

  return (
    <div className="space-y-6">
      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-2xl font-bold text-slate-100">{tx(lang, 'Landing İdarəetməsi', 'Управление landing', 'Landing Control')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Buradan www.ironwaves.store üzərində görünən əsas hero mətnlərini və əlaqə məlumatlarını idarə edə bilərsiniz.',
            'Здесь можно управлять hero-текстами и контактной информацией для www.ironwaves.store.',
            'Manage the public hero copy and contact info shown on www.ironwaves.store.',
          )}
        </p>
      </div>

      <div className="metal-panel p-6 space-y-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-3">
            <h3 className="text-lg font-bold text-slate-100">AZ</h3>
            <input className="neon-input" value={form.hero_title_az} onChange={(e) => setField('hero_title_az', e.target.value)} placeholder="Başlıq" />
            <textarea className="neon-input min-h-28" value={form.hero_body_az} onChange={(e) => setField('hero_body_az', e.target.value)} placeholder="Mətn" />
            <input className="neon-input" value={form.primary_cta_az} onChange={(e) => setField('primary_cta_az', e.target.value)} placeholder="Əsas CTA" />
            <input className="neon-input" value={form.secondary_cta_az} onChange={(e) => setField('secondary_cta_az', e.target.value)} placeholder="İkinci CTA" />
          </div>
          <div className="space-y-3">
            <h3 className="text-lg font-bold text-slate-100">RU</h3>
            <input className="neon-input" value={form.hero_title_ru} onChange={(e) => setField('hero_title_ru', e.target.value)} placeholder="Заголовок" />
            <textarea className="neon-input min-h-28" value={form.hero_body_ru} onChange={(e) => setField('hero_body_ru', e.target.value)} placeholder="Текст" />
            <input className="neon-input" value={form.primary_cta_ru} onChange={(e) => setField('primary_cta_ru', e.target.value)} placeholder="Primary CTA" />
            <input className="neon-input" value={form.secondary_cta_ru} onChange={(e) => setField('secondary_cta_ru', e.target.value)} placeholder="Secondary CTA" />
          </div>
          <div className="space-y-3">
            <h3 className="text-lg font-bold text-slate-100">EN</h3>
            <input className="neon-input" value={form.hero_title_en} onChange={(e) => setField('hero_title_en', e.target.value)} placeholder="Title" />
            <textarea className="neon-input min-h-28" value={form.hero_body_en} onChange={(e) => setField('hero_body_en', e.target.value)} placeholder="Body" />
            <input className="neon-input" value={form.primary_cta_en} onChange={(e) => setField('primary_cta_en', e.target.value)} placeholder="Primary CTA" />
            <input className="neon-input" value={form.secondary_cta_en} onChange={(e) => setField('secondary_cta_en', e.target.value)} placeholder="Secondary CTA" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <input className="neon-input" value={form.contact_email} onChange={(e) => setField('contact_email', e.target.value)} placeholder="hello@ironwaves.store" />
          <input className="neon-input" value={form.contact_phone} onChange={(e) => setField('contact_phone', e.target.value)} placeholder="+994..." />
          <input className="neon-input" value={form.contact_whatsapp} onChange={(e) => setField('contact_whatsapp', e.target.value)} placeholder="WhatsApp link or number" />
        </div>

        <div className="flex justify-end">
          <button onClick={() => { void save(); }} className="glossy-gold rounded-xl px-6 py-2 font-bold">
            {tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

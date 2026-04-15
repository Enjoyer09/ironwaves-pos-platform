import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';
import { get_landing_studio_live, publish_landing_live, update_landing_draft_live } from '../../api/settings';

const DEFAULT_SCREENSHOTS = [
  {
    image_url: '/landing/pos-screen.png',
    title_az: 'POS Ekranı',
    title_ru: 'Экран POS',
    title_en: 'POS Screen',
    desc_az: 'Sürətli sifariş və ödəniş axını',
    desc_ru: 'Быстрый поток заказов и оплат',
    desc_en: 'Fast order and payment flow',
  },
  {
    image_url: '/landing/finance-screen.png',
    title_az: 'Maliyyə Ekranı',
    title_ru: 'Экран финансов',
    title_en: 'Finance Screen',
    desc_az: 'Kassa, depozit və investor borcu nəzarəti',
    desc_ru: 'Контроль кассы, депозитов и долга инвестору',
    desc_en: 'Cash, deposits and investor liability control',
  },
  {
    image_url: '/landing/golden-card.png',
    title_az: 'Golden Card',
    title_ru: 'Golden Card',
    title_en: 'Golden Card',
    desc_az: 'Loyallıq kartı və bonus ssenariləri',
    desc_ru: 'Сценарии лояльности и бонусных карт',
    desc_en: 'Loyalty card and bonus scenarios',
  },
  {
    image_url: '/landing/elite-card.png',
    title_az: 'Elite Card',
    title_ru: 'Elite Card',
    title_en: 'Elite Card',
    desc_az: 'VIP müştəri segmenti və üstünlüklər',
    desc_ru: 'VIP-сегмент клиентов и привилегии',
    desc_en: 'VIP customer segment and privileges',
  },
];

export default function LandingPanel() {
  const { user, lang, notify } = useAppStore();
  const [savingDraft, setSavingDraft] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [draggingShotIndex, setDraggingShotIndex] = useState<number | null>(null);
  const [dropShotIndex, setDropShotIndex] = useState<number | null>(null);
  const [previewLang, setPreviewLang] = useState<'az' | 'ru' | 'en'>('az');
  const heroFileRef = useRef<HTMLInputElement | null>(null);
  const [form, setForm] = useState<any>({
    nav_product_az: '',
    nav_product_ru: '',
    nav_product_en: '',
    nav_how_az: '',
    nav_how_ru: '',
    nav_how_en: '',
    nav_modules_az: '',
    nav_modules_ru: '',
    nav_modules_en: '',
    nav_contact_az: '',
    nav_contact_ru: '',
    nav_contact_en: '',
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
    hero_image_url: '',
    modules_title_az: '',
    modules_title_ru: '',
    modules_title_en: '',
    footer_text_az: '',
    footer_text_ru: '',
    footer_text_en: '',
    screenshot_items: DEFAULT_SCREENSHOTS,
  });

  useEffect(() => {
    const load = async () => {
      try {
        const studio = await get_landing_studio_live();
        const incoming = studio?.draft || studio?.published || {};
        setForm((prev: any) => ({
          ...prev,
          ...incoming,
          screenshot_items: Array.isArray(incoming.screenshot_items) && incoming.screenshot_items.length ? incoming.screenshot_items : prev.screenshot_items,
        }));
      } catch (e: any) {
        notify('error', e?.message || tx(lang, 'Landing ayarları yüklənmədi', 'Настройки landing не загрузились', 'Landing settings failed to load'));
      }
    };
    void load();
  }, [lang, notify]);

  const setField = (key: string, value: string) => setForm((prev: any) => ({ ...prev, [key]: value }));
  const setShot = (index: number, key: string, value: string) =>
    setForm((prev: any) => {
      const rows = Array.isArray(prev.screenshot_items) ? [...prev.screenshot_items] : [];
      if (!rows[index]) rows[index] = {};
      rows[index] = { ...rows[index], [key]: value };
      return { ...prev, screenshot_items: rows };
    });

  const addShot = () =>
    setForm((prev: any) => ({
      ...prev,
      screenshot_items: [...(Array.isArray(prev.screenshot_items) ? prev.screenshot_items : []), { image_url: '', title_az: '', title_ru: '', title_en: '', desc_az: '', desc_ru: '', desc_en: '' }],
    }));

  const removeShot = (index: number) =>
    setForm((prev: any) => ({
      ...prev,
      screenshot_items: (Array.isArray(prev.screenshot_items) ? prev.screenshot_items : []).filter((_: any, i: number) => i !== index),
    }));

  const moveShot = (index: number, direction: -1 | 1) =>
    setForm((prev: any) => {
      const rows = Array.isArray(prev.screenshot_items) ? [...prev.screenshot_items] : [];
      const target = index + direction;
      if (target < 0 || target >= rows.length) return prev;
      const tmp = rows[index];
      rows[index] = rows[target];
      rows[target] = tmp;
      return { ...prev, screenshot_items: rows };
    });

  const moveShotTo = (from: number, to: number) =>
    setForm((prev: any) => {
      const rows = Array.isArray(prev.screenshot_items) ? [...prev.screenshot_items] : [];
      if (from < 0 || to < 0 || from >= rows.length || to >= rows.length || from === to) return prev;
      const [moved] = rows.splice(from, 1);
      rows.splice(to, 0, moved);
      return { ...prev, screenshot_items: rows };
    });

  const readImageAsDataUrl = (file: File, cb: (url: string) => void) => {
    const reader = new FileReader();
    reader.onload = () => cb(String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const handleHeroImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageAsDataUrl(file, (url) => setField('hero_image_url', url));
    e.target.value = '';
  };

  const handleShotImageUpload = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readImageAsDataUrl(file, (url) => setShot(index, 'image_url', url));
    e.target.value = '';
  };

  const saveDraft = async () => {
    setSavingDraft(true);
    try {
      await update_landing_draft_live(form);
      notify('success', tx(lang, 'Draft yadda saxlanıldı', 'Черновик сохранён', 'Draft saved'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Draft saxlanmadı', 'Черновик не сохранился', 'Draft save failed'));
    } finally {
      setSavingDraft(false);
    }
  };

  const publish = async () => {
    setPublishing(true);
    try {
      await update_landing_draft_live(form);
      await publish_landing_live();
      notify('success', tx(lang, 'Landing canlıya yayımlandı', 'Landing опубликован', 'Landing published'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Yayımlama baş tutmadı', 'Публикация не удалась', 'Publish failed'));
    } finally {
      setPublishing(false);
    }
  };

  const previewPick = (prefix: string) => String(form?.[`${prefix}_${previewLang}`] || '').trim();
  const previewNav = [previewPick('nav_product'), previewPick('nav_how'), previewPick('nav_modules'), previewPick('nav_contact')].filter(Boolean);
  const previewTitle = previewPick('hero_title');
  const previewBody = previewPick('hero_body');
  const previewPrimaryCta = previewPick('primary_cta');
  const previewSecondaryCta = previewPick('secondary_cta');
  const previewModulesTitle = previewPick('modules_title');
  const previewFooter = previewPick('footer_text');
  const previewShots = (Array.isArray(form?.screenshot_items) ? form.screenshot_items : [])
    .filter((shot: any) => String(shot?.image_url || '').trim())
    .slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="metal-panel p-6 space-y-4">
        <h2 className="text-2xl font-bold text-slate-100">{tx(lang, 'Landing İdarəetməsi', 'Управление landing', 'Landing Control')}</h2>
        <p className="text-sm text-slate-400">
          {tx(
            lang,
            'Buradan www.ironwaves.store üçün hero, şəkillər, nav label və əlaqə blokunu idarə edə bilərsiniz.',
            'Здесь можно управлять hero, изображениями, nav-текстами и контактным блоком для www.ironwaves.store.',
            'Manage hero, images, nav labels, and contact block for www.ironwaves.store.',
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <a href="https://www.ironwaves.store" target="_blank" rel="noreferrer" className="neon-chip px-3 py-2 text-xs">
            {tx(lang, 'Canlı saytı aç', 'Открыть live сайт', 'Open live site')}
          </a>
          <a href="https://demo.ironwaves.store" target="_blank" rel="noreferrer" className="neon-chip px-3 py-2 text-xs">
            {tx(lang, 'Demo linkini aç', 'Открыть demo ссылку', 'Open demo link')}
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="metal-panel p-6 space-y-6 xl:col-span-8">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <input className="neon-input" value={form.nav_product_az} onChange={(e) => setField('nav_product_az', e.target.value)} placeholder="AZ: Məhsul" />
          <input className="neon-input" value={form.nav_how_az} onChange={(e) => setField('nav_how_az', e.target.value)} placeholder="AZ: Necə işləyir" />
          <input className="neon-input" value={form.nav_modules_az} onChange={(e) => setField('nav_modules_az', e.target.value)} placeholder="AZ: Modullar" />
          <input className="neon-input" value={form.nav_contact_az} onChange={(e) => setField('nav_contact_az', e.target.value)} placeholder="AZ: Əlaqə" />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <input className="neon-input" value={form.nav_product_ru} onChange={(e) => setField('nav_product_ru', e.target.value)} placeholder="RU: Продукт" />
          <input className="neon-input" value={form.nav_how_ru} onChange={(e) => setField('nav_how_ru', e.target.value)} placeholder="RU: Как работает" />
          <input className="neon-input" value={form.nav_modules_ru} onChange={(e) => setField('nav_modules_ru', e.target.value)} placeholder="RU: Модули" />
          <input className="neon-input" value={form.nav_contact_ru} onChange={(e) => setField('nav_contact_ru', e.target.value)} placeholder="RU: Контакт" />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <input className="neon-input" value={form.nav_product_en} onChange={(e) => setField('nav_product_en', e.target.value)} placeholder="EN: Product" />
          <input className="neon-input" value={form.nav_how_en} onChange={(e) => setField('nav_how_en', e.target.value)} placeholder="EN: How it works" />
          <input className="neon-input" value={form.nav_modules_en} onChange={(e) => setField('nav_modules_en', e.target.value)} placeholder="EN: Modules" />
          <input className="neon-input" value={form.nav_contact_en} onChange={(e) => setField('nav_contact_en', e.target.value)} placeholder="EN: Contact" />
        </div>

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

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input className="neon-input" value={form.modules_title_az} onChange={(e) => setField('modules_title_az', e.target.value)} placeholder="AZ: Modul section başlığı" />
          <div className="flex items-center gap-2">
            <input className="neon-input" value={form.hero_image_url} onChange={(e) => setField('hero_image_url', e.target.value)} placeholder="Hero image URL" />
            <input ref={heroFileRef} type="file" accept="image/*" onChange={handleHeroImageUpload} className="hidden" />
            <button type="button" className="neon-chip px-3 py-2 text-xs" onClick={() => heroFileRef.current?.click()}>
              {tx(lang, 'Şəkil seç', 'Выбрать изображение', 'Pick image')}
            </button>
          </div>
          <input className="neon-input" value={form.modules_title_ru} onChange={(e) => setField('modules_title_ru', e.target.value)} placeholder="RU: Заголовок модулей" />
          <input className="neon-input" value={form.footer_text_az} onChange={(e) => setField('footer_text_az', e.target.value)} placeholder="AZ footer mətn" />
          <input className="neon-input" value={form.modules_title_en} onChange={(e) => setField('modules_title_en', e.target.value)} placeholder="EN: Modules heading" />
          <input className="neon-input" value={form.footer_text_ru} onChange={(e) => setField('footer_text_ru', e.target.value)} placeholder="RU footer text" />
          <div />
          <input className="neon-input" value={form.footer_text_en} onChange={(e) => setField('footer_text_en', e.target.value)} placeholder="EN footer text" />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Screenshot Slider', 'Слайдер скриншотов', 'Screenshot Slider')}</h3>
            <button type="button" onClick={addShot} className="neon-chip px-3 py-2 text-xs">+ {tx(lang, 'Slide əlavə et', 'Добавить слайд', 'Add slide')}</button>
          </div>
          {(Array.isArray(form.screenshot_items) ? form.screenshot_items : []).map((shot: any, idx: number) => (
            <div
              key={`shot_${idx}`}
              draggable
              onDragStart={() => setDraggingShotIndex(idx)}
              onDragOver={(e) => {
                e.preventDefault();
                if (draggingShotIndex !== null && draggingShotIndex !== idx) setDropShotIndex(idx);
              }}
              onDragLeave={() => setDropShotIndex((prev) => (prev === idx ? null : prev))}
              onDrop={(e) => {
                e.preventDefault();
                if (draggingShotIndex !== null && draggingShotIndex !== idx) {
                  moveShotTo(draggingShotIndex, idx);
                }
                setDraggingShotIndex(null);
                setDropShotIndex(null);
              }}
              onDragEnd={() => {
                setDraggingShotIndex(null);
                setDropShotIndex(null);
              }}
              className={`rounded-xl border p-3 space-y-3 transition ${dropShotIndex === idx ? 'border-cyan-300/80 bg-cyan-500/10' : 'border-slate-700/70'} ${draggingShotIndex === idx ? 'opacity-70' : ''}`}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-200">#{idx + 1}</div>
                <div className="flex items-center gap-2">
                  <span className="cursor-grab rounded border border-slate-600 px-2 py-1 text-[11px] text-slate-300">⠿</span>
                  <button type="button" onClick={() => moveShot(idx, -1)} className="neon-chip px-2 py-1 text-[11px]">↑</button>
                  <button type="button" onClick={() => moveShot(idx, 1)} className="neon-chip px-2 py-1 text-[11px]">↓</button>
                  <button type="button" onClick={() => removeShot(idx)} className="text-xs text-rose-300 hover:text-rose-200">
                    {tx(lang, 'Sil', 'Удалить', 'Delete')}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input className="neon-input" value={shot.image_url || ''} onChange={(e) => setShot(idx, 'image_url', e.target.value)} placeholder="Image URL (https://...)" />
                <label className="neon-chip cursor-pointer px-3 py-2 text-xs">
                  {tx(lang, 'Şəkil seç', 'Выбрать', 'Pick')}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => handleShotImageUpload(idx, e)} />
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input className="neon-input" value={shot.title_az || ''} onChange={(e) => setShot(idx, 'title_az', e.target.value)} placeholder="Title AZ" />
                <input className="neon-input" value={shot.title_ru || ''} onChange={(e) => setShot(idx, 'title_ru', e.target.value)} placeholder="Title RU" />
                <input className="neon-input" value={shot.title_en || ''} onChange={(e) => setShot(idx, 'title_en', e.target.value)} placeholder="Title EN" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input className="neon-input" value={shot.desc_az || ''} onChange={(e) => setShot(idx, 'desc_az', e.target.value)} placeholder="Desc AZ" />
                <input className="neon-input" value={shot.desc_ru || ''} onChange={(e) => setShot(idx, 'desc_ru', e.target.value)} placeholder="Desc RU" />
                <input className="neon-input" value={shot.desc_en || ''} onChange={(e) => setShot(idx, 'desc_en', e.target.value)} placeholder="Desc EN" />
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <input className="neon-input" value={form.contact_email} onChange={(e) => setField('contact_email', e.target.value)} placeholder="hello@ironwaves.store" />
          <input className="neon-input" value={form.contact_phone} onChange={(e) => setField('contact_phone', e.target.value)} placeholder="+994..." />
          <input className="neon-input" value={form.contact_whatsapp} onChange={(e) => setField('contact_whatsapp', e.target.value)} placeholder="WhatsApp link or number" />
        </div>

        <div className="flex justify-end">
          <div className="flex gap-2">
            <button onClick={() => { void saveDraft(); }} disabled={savingDraft} className="neon-chip rounded-xl px-6 py-2 font-bold">
              {savingDraft ? tx(lang, 'Saxlanır...', 'Сохраняется...', 'Saving...') : tx(lang, 'Draft saxla', 'Сохранить черновик', 'Save draft')}
            </button>
            <button onClick={() => { void publish(); }} disabled={publishing} className="glossy-gold rounded-xl px-6 py-2 font-bold">
              {publishing ? tx(lang, 'Yayımlanır...', 'Публикация...', 'Publishing...') : tx(lang, 'Canlıya yayımla', 'Опубликовать', 'Publish live')}
            </button>
          </div>
        </div>
        </div>

        <div className="metal-panel p-4 xl:col-span-4 xl:sticky xl:top-24 h-fit space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-100">{tx(lang, 'Canlı Mini Preview', 'Live мини-превью', 'Live mini preview')}</h3>
            <div className="flex gap-1">
              {(['az', 'ru', 'en'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setPreviewLang(l)}
                  className={previewLang === l ? 'neon-chip neon-chip-active px-2 py-1 text-[11px]' : 'neon-chip px-2 py-1 text-[11px]'}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-700/70 bg-[#0f1521] p-3 space-y-3">
            <div className="flex flex-wrap gap-1">
              {previewNav.map((n: string, idx: number) => (
                <span key={`${n}_${idx}`} className="rounded border border-slate-600/70 px-2 py-1 text-[10px] text-slate-300">{n}</span>
              ))}
            </div>

            {String(form.hero_image_url || '').trim() && (
              <img src={String(form.hero_image_url)} alt="hero-preview" className="h-28 w-full rounded-lg border border-slate-700/70 object-cover" />
            )}

            <div className="text-sm font-bold text-slate-100">{previewTitle || '—'}</div>
            <div className="text-xs leading-5 text-slate-400">{previewBody || '—'}</div>

            <div className="flex gap-2">
              <span className="glossy-gold rounded-lg px-2 py-1 text-[10px] font-semibold">{previewPrimaryCta || 'CTA'}</span>
              <span className="neon-chip rounded-lg px-2 py-1 text-[10px]">{previewSecondaryCta || 'CTA'}</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700/70 bg-[#0f1521] p-3 space-y-2">
            <div className="text-xs font-semibold text-slate-300">{previewModulesTitle || tx(lang, 'Modullar', 'Модули', 'Modules')}</div>
            <div className="space-y-2">
              {previewShots.map((shot: any, idx: number) => {
                const title = String(shot?.[`title_${previewLang}`] || shot?.title_az || shot?.title_en || shot?.title_ru || '').trim();
                const desc = String(shot?.[`desc_${previewLang}`] || shot?.desc_az || shot?.desc_en || shot?.desc_ru || '').trim();
                return (
                  <div key={`preview_shot_${idx}`} className="rounded-lg border border-slate-700/70 bg-[#0c121b] p-2">
                    <div className="mb-1 text-[11px] font-semibold text-slate-100">{title || `Slide ${idx + 1}`}</div>
                    <div className="text-[10px] text-slate-400">{desc || '—'}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-slate-700/70 bg-[#0f1521] p-3 space-y-1 text-[11px] text-slate-300">
            <div>{String(form.contact_phone || '+99455 299-92-82')}</div>
            <div>{String(form.contact_email || 'abbas@laptopmarket.az')}</div>
            <div className="text-[10px] text-slate-500">{previewFooter || '—'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

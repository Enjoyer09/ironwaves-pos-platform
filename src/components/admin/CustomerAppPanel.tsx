import React, { useEffect, useState } from 'react';
import { MapPin, Palette, Plus, Sparkles, Trash2 } from 'lucide-react';
import QRCode from 'qrcode';
import { useAppStore } from '../../store';
import { tx } from '../../i18n';
import { get_settings_live, update_customer_app_settings_live, list_branches_live, create_branch_live, update_branch_live, delete_branch_live } from '../../api/settings';
import { prepareImageDataUrl } from '../../lib/image_upload';

const CRM_MEMBER_TYPES = [
  { value: 'golden', label: 'Golden (5%)', discount: 5 },
  { value: 'platinum', label: 'Platinum (10%)', discount: 10 },
  { value: 'elite', label: 'Elite (20%)', discount: 20 },
  { value: 'thermos', label: 'Thermos (20%)', discount: 20 },
  { value: 'ikram', label: 'Ikram (100%)', discount: 100 },
  { value: 'telebe', label: 'Tələbə (15%)', discount: 15 },
];

export default function CustomerAppPanel() {
  const { user, lang, notify } = useAppStore();
  const tenantId = user?.tenant_id || 'tenant_default';
  const colorPresets = ['#14b8a6', '#22d3ee', '#7c3aed', '#f97316', '#facc15', '#ef4444', '#111827', '#ec4899'];
  const [success, setSuccess] = useState('');
  const [joinQr, setJoinQr] = useState('');
  const [branches, setBranches] = useState<any[]>([]);
  const [branchForm, setBranchForm] = useState({
    name: '',
    address: '',
    phone: '',
    latitude: '',
    longitude: '',
    open_hour: '8',
    close_hour: '23',
    is_default: false,
  });
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const [form, setForm] = useState({
    enabled: true,
    program_mode: 'points' as 'points' | 'cashback',
    layout_preset: 'rewards' as 'rewards' | 'cashback' | 'playful',
    consent_text: 'Mən loyallıq proqramına qoşulmağa və şəxsi reward hesabımın yaradılmasına razıyam.',
    join_customer_type: 'golden',
    join_discount_percent: '5',
    app_name: 'Loyalty Club',
    hero_title: 'Xoş gəldiniz',
    hero_subtitle: 'Bonuslarınızı, kampaniyaları və reward-ları bir yerdə izləyin.',
    hero_image_url: '',
    background_image_url: '',
    background_color: '#0b1220',
    points_label: 'Ulduz',
    reward_name: 'Reward',
    reward_threshold: '10',
    reward_description: '10 ulduza 1 pulsuz içki',
    reward_card_style: 'rounded' as 'rounded' | 'soft-square' | 'glass',
    cashback_percent: '5',
    primary_color: '#facc15',
    accent_color: '#22d3ee',
    show_qr_card: true,
    show_wallet: true,
    ai_barista_enabled: false,
    ai_falci_enabled: false,
    show_campaigns: true,
    show_history: true,
    show_notifications: true,
    campaigns_require_online: false,
    campaign_activation_minutes: '15',
  });

  useEffect(() => {
    void (async () => {
      try {
        const settings = await get_settings_live(tenantId);
        const c = settings.customer_app_settings || ({} as any);
        setForm((prev) => ({
          ...prev,
          enabled: Boolean(c.enabled ?? true),
          program_mode: c.program_mode === 'cashback' ? 'cashback' : 'points',
          layout_preset: c.layout_preset === 'cashback' || c.layout_preset === 'playful' ? c.layout_preset : 'rewards',
          consent_text: String(c.consent_text || prev.consent_text),
          join_customer_type: String(c.join_customer_type || prev.join_customer_type || 'golden'),
          join_discount_percent: String(c.join_discount_percent || prev.join_discount_percent || '5'),
          app_name: String(c.app_name || prev.app_name),
          hero_title: String(c.hero_title || prev.hero_title),
          hero_subtitle: String(c.hero_subtitle || prev.hero_subtitle),
          hero_image_url: String(c.hero_image_url || ''),
          background_image_url: String(c.background_image_url || ''),
          background_color: String(c.background_color || prev.background_color),
          points_label: String(c.points_label || prev.points_label),
          reward_name: String(c.reward_name || prev.reward_name),
          reward_threshold: String(c.reward_threshold || prev.reward_threshold),
          reward_description: String(c.reward_description || prev.reward_description),
          reward_card_style: c.reward_card_style === 'soft-square' || c.reward_card_style === 'glass' ? c.reward_card_style : 'rounded',
          cashback_percent: String(c.cashback_percent || prev.cashback_percent),
          primary_color: String(c.primary_color || prev.primary_color),
          accent_color: String(c.accent_color || prev.accent_color),
          show_qr_card: Boolean(c.show_qr_card ?? true),
          show_wallet: Boolean(c.show_wallet ?? true),
          ai_barista_enabled: Boolean(c.ai_barista_enabled),
          ai_falci_enabled: Boolean(c.ai_falci_enabled),
          show_campaigns: Boolean(c.show_campaigns ?? true),
          show_history: Boolean(c.show_history ?? true),
          show_notifications: Boolean(c.show_notifications ?? true),
          campaigns_require_online: Boolean(c.campaigns_require_online),
          campaign_activation_minutes: String(c.campaign_activation_minutes || 15),
        }));
      } catch (e: any) {
        notify('error', e?.message || 'Customer app settings yüklənmədi');
      }
    })();
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;
    const joinUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/?join=1&club=${encodeURIComponent(form.join_customer_type)}&discount=${encodeURIComponent(form.join_discount_percent)}`
      : '';
    if (!joinUrl) return;
    void QRCode.toDataURL(joinUrl, { width: 220, margin: 1 }).then((url) => {
      if (!cancelled) setJoinQr(url);
    }).catch(() => {
      if (!cancelled) setJoinQr('');
    });
    return () => {
      cancelled = true;
    };
  }, [form.join_customer_type, form.join_discount_percent]);

  const flash = (msg: string) => {
    setSuccess(msg);
    window.setTimeout(() => setSuccess(''), 2500);
  };

  const loadBranches = async () => {
    try {
      const res = await list_branches_live(tenantId);
      setBranches(res?.branches || []);
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Filiallar yüklənə bilmədi', 'Не удалось загрузить филиалы', 'Could not load branches'));
    }
  };

  useEffect(() => {
    void loadBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const startEditBranch = (b: any) => {
    setEditingBranchId(b.id);
    setBranchForm({
      name: b.name || '',
      address: b.address || '',
      phone: b.phone || '',
      latitude: b.latitude != null ? String(b.latitude) : '',
      longitude: b.longitude != null ? String(b.longitude) : '',
      open_hour: String(b.open_hour ?? 8),
      close_hour: String(b.close_hour ?? 23),
      is_default: Boolean(b.is_default),
    });
  };

  const saveBranch = async () => {
    if (!branchForm.name.trim()) {
      notify('error', tx(lang, 'Filial adı boş ola bilməz', 'Название филиала не может быть пустым', 'Branch name is required'));
      return;
    }
    const payload = {
      name: branchForm.name.trim(),
      address: branchForm.address.trim() || undefined,
      phone: branchForm.phone.trim() || undefined,
      latitude: branchForm.latitude.trim() ? Number(branchForm.latitude) : null,
      longitude: branchForm.longitude.trim() ? Number(branchForm.longitude) : null,
      open_hour: Number(branchForm.open_hour || 8),
      close_hour: Number(branchForm.close_hour || 23),
      is_default: branchForm.is_default,
    };
    try {
      if (editingBranchId) {
        await update_branch_live(tenantId, editingBranchId, payload);
      } else {
        await create_branch_live(tenantId, payload);
      }
      setBranchForm({ name: '', address: '', phone: '', latitude: '', longitude: '', open_hour: '8', close_hour: '23', is_default: false });
      setEditingBranchId(null);
      await loadBranches();
      flash(tx(lang, 'Filial yadda saxlanıldı', 'Филиал сохранен', 'Branch saved'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Filial saxlanıla bilmdi', 'Не удалось сохранить филиал', 'Could not save branch'));
    }
  };

  const removeBranch = async (branchId: string) => {
    if (typeof window !== 'undefined' && !window.confirm(tx(lang, 'Bu filialı silmək istəyirsiniz?', 'Удалить этот филиал?', 'Delete this branch?'))) {
      return;
    }
    try {
      await delete_branch_live(tenantId, branchId);
      await loadBranches();
      flash(tx(lang, 'Filial silindi', 'Филиал удален', 'Branch deleted'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Filal silinə bilmdi', 'Не удалось удалить филиал', 'Could not delete branch'));
    }
  };

  const handleImage = async (field: 'hero_image_url' | 'background_image_url', file?: File | null) => {
    if (!file) return;
    try {
      const dataUrl = await prepareImageDataUrl(file);
      setForm((prev) => ({ ...prev, [field]: dataUrl }));
    } catch (error: any) {
      notify('error', error?.message || tx(lang, 'Şəkil yüklənmədi', 'Изображение не загрузилось', 'Image upload failed'));
    }
  };

  const save = async () => {
    await update_customer_app_settings_live({
      enabled: form.enabled,
      program_mode: form.program_mode,
      layout_preset: form.layout_preset,
      consent_text: form.consent_text,
      join_customer_type: form.join_customer_type,
      join_discount_percent: Number(form.join_discount_percent || 0),
      app_name: form.app_name,
      hero_title: form.hero_title,
      hero_subtitle: form.hero_subtitle,
      hero_image_url: form.hero_image_url,
      background_image_url: form.background_image_url,
      background_color: form.background_color,
      points_label: form.points_label,
      reward_name: form.reward_name,
      reward_threshold: Number(form.reward_threshold || 10),
      reward_description: form.reward_description,
      reward_card_style: form.reward_card_style,
      cashback_percent: Number(form.cashback_percent || 5),
      primary_color: form.primary_color,
      accent_color: form.accent_color,
      show_qr_card: form.show_qr_card,
      show_wallet: form.show_wallet,
      ai_barista_enabled: form.ai_barista_enabled,
      ai_falci_enabled: form.ai_falci_enabled,
      show_campaigns: form.show_campaigns,
      show_history: form.show_history,
      show_notifications: form.show_notifications,
      campaigns_require_online: form.campaigns_require_online,
      campaign_activation_minutes: Number(form.campaign_activation_minutes || 15),
    });
    flash(tx(lang, 'Customer app dizaynı yadda saxlanıldı', 'Дизайн customer app сохранен', 'Customer app design saved'));
  };

  const applyPreset = (preset: 'rewards' | 'cashback' | 'playful') => {
    if (preset === 'cashback') {
      setForm((prev) => ({
        ...prev,
        layout_preset: 'cashback',
        program_mode: 'cashback',
        app_name: 'Cashback Club',
        hero_title: 'Cashback balansın hazırdır',
        hero_subtitle: 'Hər alışda qazan, tətbiqdən izləmək rahat olsun.',
        consent_text: 'Mən cashback klubuna qoşulmağa və hesabımın yaradılmasına razıyam.',
        background_color: '#062c2d',
        points_label: 'Cashback',
        reward_name: 'Cashback Bonus',
        reward_description: 'Balansını növbəti alışda istifadə et',
        reward_card_style: 'soft-square',
        primary_color: '#14b8a6',
        accent_color: '#0f172a',
      }));
      return;
    }
    if (preset === 'playful') {
      setForm((prev) => ({
        ...prev,
        layout_preset: 'playful',
        program_mode: 'points',
        app_name: 'Fun Club',
        hero_title: 'Bonus və sürprizlər burada',
        hero_subtitle: 'Reward, QR, oyun və əyləncə bir yerdə.',
        consent_text: 'Mən loyalty və fun zonaya qoşulmağa razıyam.',
        background_color: '#1f1235',
        points_label: 'Ulduz',
        reward_name: 'Sürpriz Reward',
        reward_description: 'Bonuslarını topla və claim et',
        reward_card_style: 'glass',
        primary_color: '#ec4899',
        accent_color: '#7c3aed',
        ai_barista_enabled: true,
        ai_falci_enabled: true,
      }));
      return;
    }
    setForm((prev) => ({
      ...prev,
      layout_preset: 'rewards',
      program_mode: 'points',
      app_name: 'Loyalty Club',
      hero_title: 'Xoş gəldiniz',
      hero_subtitle: 'Reward, QR və kampaniyalar bir yerdə.',
      consent_text: 'Mən loyallıq proqramına qoşulmağa və şəxsi reward hesabımın yaradılmasına razıyam.',
      background_color: '#0b1220',
      points_label: 'Ulduz',
      reward_name: 'Reward',
      reward_description: 'Topla və kassada istifadə et',
      reward_card_style: 'rounded',
      primary_color: '#facc15',
      accent_color: '#22d3ee',
    }));
  };

  const handleJoinTypeChange = (nextType: string) => {
    const selected = CRM_MEMBER_TYPES.find((item) => item.value === nextType);
    setForm((prev) => ({
      ...prev,
      join_customer_type: nextType,
      join_discount_percent: String(selected?.discount ?? prev.join_discount_percent),
    }));
  };

  const downloadJoinQr = () => {
    if (!joinQr || typeof document === 'undefined') return;
    const link = document.createElement('a');
    link.href = joinQr;
    link.download = `${tenantId}-cashier-join-qr.png`;
    link.click();
  };

  return (
    <div className="space-y-6">
      <div className="metal-panel overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-700/70 p-6">
          <Palette className="text-cyan-300" size={22} />
          <div>
            <h1 className="text-2xl font-black tracking-wide text-slate-100">{tx(lang, 'Customer App Dizaynı', 'Дизайн Customer App', 'Customer App Design')}</h1>
            <p className="text-xs text-slate-400">{tenantId}</p>
          </div>
        </div>
        {success ? <div className="border-b border-emerald-400/20 bg-emerald-500/10 px-6 py-3 text-sm text-emerald-200">{success}</div> : null}
      </div>

      <div className="metal-panel p-6 space-y-4">
        <div className="space-y-3">
          <div className="text-sm font-semibold text-slate-200">{tx(lang, 'Hazır dizayn preset-ləri', 'Готовые дизайн-пресеты', 'Ready design presets')}</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <button type="button" onClick={() => applyPreset('rewards')} className={`rounded-2xl border p-4 text-left ${form.layout_preset === 'rewards' ? 'border-cyan-300 bg-cyan-400/10' : 'border-slate-700/70 bg-slate-950/30'}`}>
              <div className="font-bold text-slate-100">Rewards</div>
              <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Starbucks tipli reward-first görünüş', 'Reward-first стиль', 'Reward-first layout')}</div>
            </button>
            <button type="button" onClick={() => applyPreset('cashback')} className={`rounded-2xl border p-4 text-left ${form.layout_preset === 'cashback' ? 'border-cyan-300 bg-cyan-400/10' : 'border-slate-700/70 bg-slate-950/30'}`}>
              <div className="font-bold text-slate-100">Cashback</div>
              <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Balans və cashback fokuslu görünüş', 'Фокус на cashback', 'Cashback-first layout')}</div>
            </button>
            <button type="button" onClick={() => applyPreset('playful')} className={`rounded-2xl border p-4 text-left ${form.layout_preset === 'playful' ? 'border-cyan-300 bg-cyan-400/10' : 'border-slate-700/70 bg-slate-950/30'}`}>
              <div className="font-bold text-slate-100">Playful</div>
              <div className="mt-1 text-xs text-slate-400">{tx(lang, 'AI və əyləncəli bloklar ön planda', 'Игровой стиль с AI', 'Playful AI-first layout')}</div>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((prev) => ({ ...prev, enabled: e.target.checked }))} />
            <span>{tx(lang, 'Customer app aktiv olsun', 'Включить customer app', 'Enable customer app')}</span>
          </label>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Proqram tipi', 'Тип программы', 'Program mode')}</label>
            <select className="neon-input" value={form.program_mode} onChange={(e) => setForm((prev) => ({ ...prev, program_mode: e.target.value as 'points' | 'cashback' }))}>
              <option value="points">{tx(lang, 'Point / Ulduz sistemi', 'Баллы / звезды', 'Points / stars program')}</option>
              <option value="cashback">{tx(lang, 'Cashback sistemi', 'Система cashback', 'Cashback program')}</option>
            </select>
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'App adı', 'Название приложения', 'App name')}</label>
            <input className="neon-input" value={form.app_name} onChange={(e) => setForm((prev) => ({ ...prev, app_name: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Başlıq', 'Заголовок', 'Hero title')}</label>
            <input className="neon-input" value={form.hero_title} onChange={(e) => setForm((prev) => ({ ...prev, hero_title: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Qısa izah', 'Краткое описание', 'Hero subtitle')}</label>
            <input className="neon-input" value={form.hero_subtitle} onChange={(e) => setForm((prev) => ({ ...prev, hero_subtitle: e.target.value }))} />
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Müştəri razılaşma mətni', 'Текст согласия клиента', 'Customer consent text')}</label>
            <textarea className="neon-input min-h-28" value={form.consent_text} onChange={(e) => setForm((prev) => ({ ...prev, consent_text: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Balans adı', 'Название баланса', 'Balance label')}</label>
            <input className="neon-input" value={form.points_label} onChange={(e) => setForm((prev) => ({ ...prev, points_label: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Reward adı', 'Название награды', 'Reward name')}</label>
            <input className="neon-input" value={form.reward_name} onChange={(e) => setForm((prev) => ({ ...prev, reward_name: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Reward həddi', 'Порог награды', 'Reward threshold')}</label>
            <input className="neon-input" type="number" min={1} value={form.reward_threshold} onChange={(e) => setForm((prev) => ({ ...prev, reward_threshold: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Cashback %', 'Cashback %', 'Cashback %')}</label>
            <input className="neon-input" type="number" min={0} value={form.cashback_percent} onChange={(e) => setForm((prev) => ({ ...prev, cashback_percent: e.target.value }))} />
          </div>
          <div className="field-stack form-card md:col-span-2">
            <label className="field-label">{tx(lang, 'Reward izahı', 'Описание награды', 'Reward description')}</label>
            <input className="neon-input" value={form.reward_description} onChange={(e) => setForm((prev) => ({ ...prev, reward_description: e.target.value }))} />
          </div>
          <div className="field-stack form-card">
            <label className="field-label">{tx(lang, 'Reward kart dizaynı', 'Стиль карточки награды', 'Reward card style')}</label>
            <select className="neon-input" value={form.reward_card_style} onChange={(e) => setForm((prev) => ({ ...prev, reward_card_style: e.target.value as 'rounded' | 'soft-square' | 'glass' }))}>
              <option value="rounded">{tx(lang, 'Reward kartı: Yumru', 'Карточка: круглая', 'Reward card: rounded')}</option>
              <option value="soft-square">{tx(lang, 'Reward kartı: Soft square', 'Карточка: soft square', 'Reward card: soft square')}</option>
              <option value="glass">{tx(lang, 'Reward kartı: Glass', 'Карточка: glass', 'Reward card: glass')}</option>
            </select>
          </div>
          <label className="rounded-2xl border border-slate-700/70 bg-slate-950/30 p-3">
            <div className="mb-2 text-sm text-slate-300">{tx(lang, 'Primary rəng', 'Primary цвет', 'Primary color')}</div>
            <div className="flex items-center gap-3">
              <input type="color" value={form.primary_color} onChange={(e) => setForm((prev) => ({ ...prev, primary_color: e.target.value }))} className="h-12 w-16 cursor-pointer rounded-lg border border-slate-600 bg-transparent p-1" />
              <div className="rounded-full px-3 py-1 text-xs font-semibold text-slate-100" style={{ backgroundColor: form.primary_color }}>{form.primary_color}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {colorPresets.map((color) => (
                <button
                  key={`primary_${color}`}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, primary_color: color }))}
                  className="h-8 w-8 rounded-full border-2 border-white/20"
                  style={{ backgroundColor: color }}
                  aria-label={`Primary ${color}`}
                />
              ))}
            </div>
          </label>
          <label className="rounded-2xl border border-slate-700/70 bg-slate-950/30 p-3">
            <div className="mb-2 text-sm text-slate-300">{tx(lang, 'Accent rəng', 'Accent цвет', 'Accent color')}</div>
            <div className="flex items-center gap-3">
              <input type="color" value={form.accent_color} onChange={(e) => setForm((prev) => ({ ...prev, accent_color: e.target.value }))} className="h-12 w-16 cursor-pointer rounded-lg border border-slate-600 bg-transparent p-1" />
              <div className="rounded-full px-3 py-1 text-xs font-semibold text-slate-100" style={{ backgroundColor: form.accent_color }}>{form.accent_color}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {colorPresets.map((color) => (
                <button
                  key={`accent_${color}`}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, accent_color: color }))}
                  className="h-8 w-8 rounded-full border-2 border-white/20"
                  style={{ backgroundColor: color }}
                  aria-label={`Accent ${color}`}
                />
              ))}
            </div>
          </label>
          <label className="rounded-2xl border border-slate-700/70 bg-slate-950/30 p-3">
            <div className="mb-2 text-sm text-slate-300">{tx(lang, 'Ümumi arxa fon rəngi', 'Цвет общего фона', 'Global background color')}</div>
            <div className="flex items-center gap-3">
              <input type="color" value={form.background_color} onChange={(e) => setForm((prev) => ({ ...prev, background_color: e.target.value }))} className="h-12 w-16 cursor-pointer rounded-lg border border-slate-600 bg-transparent p-1" />
              <div className="rounded-full px-3 py-1 text-xs font-semibold text-slate-100" style={{ backgroundColor: form.background_color }}>{form.background_color}</div>
            </div>
          </label>
          <div className="space-y-2">
            <div className="text-sm text-slate-300">{tx(lang, 'Hero şəkli', 'Hero изображение', 'Hero image')}</div>
            <input className="neon-input" value={form.hero_image_url} onChange={(e) => setForm((prev) => ({ ...prev, hero_image_url: e.target.value }))} placeholder={tx(lang, 'Şəkil URL və ya data URL', 'URL или data URL', 'Image URL or data URL')} />
            <input className="neon-input" type="file" accept="image/*" onChange={(e) => handleImage('hero_image_url', e.target.files?.[0])} />
            {form.hero_image_url ? <img src={form.hero_image_url} alt="hero preview" className="h-24 w-full rounded-xl object-cover" /> : null}
          </div>
          <div className="space-y-2">
            <div className="text-sm text-slate-300">{tx(lang, 'Arxa fon şəkli', 'Фоновое изображение', 'Background image')}</div>
            <input className="neon-input" value={form.background_image_url} onChange={(e) => setForm((prev) => ({ ...prev, background_image_url: e.target.value }))} placeholder={tx(lang, 'Şəkil URL və ya data URL', 'URL или data URL', 'Image URL or data URL')} />
            <input className="neon-input" type="file" accept="image/*" onChange={(e) => handleImage('background_image_url', e.target.files?.[0])} />
            {form.background_image_url ? <img src={form.background_image_url} alt="background preview" className="h-24 w-full rounded-xl object-cover" /> : null}
          </div>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <div className="text-lg font-bold text-slate-100">{tx(lang, 'Kassadakı onboarding QR', 'QR для кассы', 'Cashier onboarding QR')}</div>
        <p className="text-sm text-slate-400">{tx(lang, 'Bu QR-ni çap edib kassaya qoyun. İlk skanda razılaşma çıxacaq, qəbul edən müştəriyə sistem avtomatik unikal QR kart yaradacaq.', 'Распечатайте этот QR и поставьте на кассу. При первом скане покажется согласие, после подтверждения клиенту создастся уникальная QR-карта.', 'Print this QR and place it at the cashier. On first scan the customer sees consent, then gets a unique QR card automatically.')}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm text-slate-300">
            {tx(lang, 'Klub üzvü tipi', 'Тип клубного участника', 'Club member type')}
            <select className="neon-input mt-1" value={form.join_customer_type} onChange={(e) => handleJoinTypeChange(e.target.value)}>
              {CRM_MEMBER_TYPES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-300">
            {tx(lang, 'Başlanğıc endirim %', 'Стартовая скидка %', 'Starting discount %')}
            <input className="neon-input mt-1" type="number" min={0} max={100} value={form.join_discount_percent} onChange={(e) => setForm((prev) => ({ ...prev, join_discount_percent: e.target.value }))} />
          </label>
        </div>
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-slate-700/70 bg-white p-5 text-slate-900">
          {joinQr ? <img src={joinQr} alt="join qr" className="h-52 w-52 rounded-2xl" /> : null}
          <div className="text-center text-xs font-semibold text-slate-700">
            {tx(lang, 'CRM tipi', 'CRM тип', 'CRM type')}: {form.join_customer_type} ({form.join_discount_percent}%)
          </div>
          <div className="text-center text-xs text-slate-500">{typeof window !== 'undefined' ? `${window.location.origin}/?join=1&club=${encodeURIComponent(form.join_customer_type)}&discount=${encodeURIComponent(form.join_discount_percent)}` : ''}</div>
          <button type="button" onClick={downloadJoinQr} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white">
            {tx(lang, 'QR yüklə', 'Скачать QR', 'Download QR')}
          </button>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <div className="flex items-center gap-2 text-lg font-bold text-slate-100"><MapPin size={18} /> {tx(lang, 'Filiallar', 'Филиалы', 'Branches')}</div>
        <p className="text-sm text-slate-400">{tx(lang, 'Customer app-də göstərilən götürmə mağazaları. Boş olarsa tenant-ın özü istifadə olunur.', 'Магазины выдачи в customer app. Если пусто — используется сам tenant.', 'Pickup stores shown in the customer app. Falls back to the tenant itself when empty.')}</p>

        <div className="space-y-2">
          {branches.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700/70 p-4 text-sm text-slate-400">
              {tx(lang, 'Hələ filial yoxdur — aşağıdan əlavə edin.', 'Филиалов пока нет — добавьте ниже.', 'No branches yet — add one below.')}
            </div>
          ) : branches.map((b: any) => (
            <div key={b.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-700/70 bg-slate-900/40 p-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-100">{b.name}</span>
                  {b.is_default ? <span className="rounded-full bg-cyan-400/20 px-2 py-0.5 text-[10px] font-bold text-cyan-300">DEFAULT</span> : null}
                  {!b.is_active ? <span className="rounded-full bg-rose-400/20 px-2 py-0.5 text-[10px] font-bold text-rose-300">OFF</span> : null}
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-400">
                  {[b.address, b.phone].filter(Boolean).join(' · ') || '—'}
                  {b.latitude != null && b.longitude != null ? ` · ${Number(b.latitude).toFixed(4)}, ${Number(b.longitude).toFixed(4)}` : ''}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{`${b.open_hour ?? 8}:00 – ${b.close_hour ?? 23}:00`}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={() => startEditBranch(b)} className="rounded-xl border border-slate-600 bg-slate-900/60 px-3 py-1.5 text-xs font-bold text-slate-200">
                  {tx(lang, 'Düzəlt', 'Изменить', 'Edit')}
                </button>
                <button type="button" onClick={() => removeBranch(b.id)} className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-300">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4 space-y-3">
          <div className="text-sm font-semibold text-slate-200">
            {editingBranchId ? tx(lang, 'Filialı düzəlt', 'Изменить филиал', 'Edit branch') : (
              <span className="inline-flex items-center gap-1"><Plus size={14} /> {tx(lang, 'Yeni filial', 'Новый филиал', 'New branch')}</span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="field-stack form-card md:col-span-2">
              <span className="field-label">{tx(lang, 'Ad *', 'Название *', 'Name *')}</span>
              <input className="neon-input" value={branchForm.name} onChange={(e) => setBranchForm((p) => ({ ...p, name: e.target.value }))} />
            </label>
            <label className="field-stack form-card">
              <span className="field-label">{tx(lang, 'Ünvan', 'Адрес', 'Address')}</span>
              <input className="neon-input" value={branchForm.address} onChange={(e) => setBranchForm((p) => ({ ...p, address: e.target.value }))} />
            </label>
            <label className="field-stack form-card">
              <span className="field-label">{tx(lang, 'Telefon', 'Телефон', 'Phone')}</span>
              <input className="neon-input" value={branchForm.phone} onChange={(e) => setBranchForm((p) => ({ ...p, phone: e.target.value }))} />
            </label>
            <label className="field-stack form-card">
              <span className="field-label">{tx(lang, 'Enlem (latitude)', 'Широта', 'Latitude')}</span>
              <input className="neon-input" type="number" step="any" value={branchForm.latitude} onChange={(e) => setBranchForm((p) => ({ ...p, latitude: e.target.value }))} placeholder="40.4093" />
            </label>
            <label className="field-stack form-card">
              <span className="field-label">{tx(lang, 'Uzunluq (longitude)', 'Долгота', 'Longitude')}</span>
              <input className="neon-input" type="number" step="any" value={branchForm.longitude} onChange={(e) => setBranchForm((p) => ({ ...p, longitude: e.target.value }))} placeholder="49.8671" />
            </label>
            <label className="field-stack form-card">
              <span className="field-label">{tx(lang, 'Açılış (saat)', 'Открытие (час)', 'Open (hour)')}</span>
              <input className="neon-input" type="number" min={0} max={23} value={branchForm.open_hour} onChange={(e) => setBranchForm((p) => ({ ...p, open_hour: e.target.value }))} />
            </label>
            <label className="field-stack form-card">
              <span className="field-label">{tx(lang, 'Bağlanış (sa)', 'Закрытие (час)', 'Close (hour)')}</span>
              <input className="neon-input" type="number" min={0} max={23} value={branchForm.close_hour} onChange={(e) => setBranchForm((p) => ({ ...p, close_hour: e.target.value }))} />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
              <input type="checkbox" checked={branchForm.is_default} onChange={(e) => setBranchForm((p) => ({ ...p, is_default: e.target.checked }))} />
              <span>{tx(lang, 'Default filial (ilk sırada)', 'Филиал по умолчанию (первый)', 'Default branch (listed first)')}</span>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { void saveBranch(); }} className="glossy-gold rounded-xl px-5 py-2 text-sm font-bold">
              {tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}
            </button>
            {editingBranchId ? (
              <button type="button" onClick={() => { setEditingBranchId(null); setBranchForm({ name: '', address: '', phone: '', latitude: '', longitude: '', open_hour: '8', close_hour: '23', is_default: false }); }} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-300">
                {tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="metal-panel p-6 space-y-4">
        <div className="flex items-center gap-2 text-lg font-bold text-slate-100"><Sparkles size={18} /> {tx(lang, 'Fun & AI Widgetlər', 'Fun & AI виджеты', 'Fun & AI widgets')}</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.show_qr_card} onChange={(e) => setForm((prev) => ({ ...prev, show_qr_card: e.target.checked }))} />
            <span>{tx(lang, 'QR kartı göstər', 'Показывать QR-карту', 'Show QR card')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.show_wallet} onChange={(e) => setForm((prev) => ({ ...prev, show_wallet: e.target.checked }))} />
            <span>{tx(lang, 'Balans kartını göstər', 'Показывать баланс', 'Show wallet balance')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.show_campaigns} onChange={(e) => setForm((prev) => ({ ...prev, show_campaigns: e.target.checked }))} />
            <span>{tx(lang, 'Kampaniyaları göstər', 'Показывать кампании', 'Show campaigns')}</span>
          </label>
        </div>
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-4 space-y-3">
          <div className="text-sm font-semibold text-slate-200">{tx(lang, 'Kampaniya yoxlanışı', 'Проверка кампании', 'Campaign validation')}</div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.campaigns_require_online} onChange={(e) => setForm((prev) => ({ ...prev, campaigns_require_online: e.target.checked }))} />
            <span>{tx(lang, 'Skan üçün internet tələb et (offline-da kampaniya bağlanır)', 'Требовать интернет для сканирования (офлайн кампании отключены)', 'Require internet for scans (campaigns disabled offline)')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <span className="shrink-0">{tx(lang, 'Pəncərə (dəq)', 'Окно (мин)', 'Window (min)')}:</span>
            <input className="neon-input w-24" type="number" min={1} value={form.campaign_activation_minutes} onChange={(e) => setForm((prev) => ({ ...prev, campaign_activation_minutes: e.target.value }))} />
            <span className="text-xs text-slate-500">{tx(lang, 'Aktivasiya pəncərəsinin uzunluğu (default 15)', 'Длина окна активации (по умолчанию 15)', 'Activation window length (default 15)')}</span>
          </label>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.show_history} onChange={(e) => setForm((prev) => ({ ...prev, show_history: e.target.checked }))} />
            <span>{tx(lang, 'Tarixçəni göstər', 'Показывать историю', 'Show history')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.show_notifications} onChange={(e) => setForm((prev) => ({ ...prev, show_notifications: e.target.checked }))} />
            <span>{tx(lang, 'Bildirişləri göstər', 'Показывать уведомления', 'Show notifications')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={form.ai_barista_enabled} onChange={(e) => setForm((prev) => ({ ...prev, ai_barista_enabled: e.target.checked }))} />
            <span>{tx(lang, 'AI Barista aktiv olsun', 'Включить AI Barista', 'Enable AI Barista')}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
            <input type="checkbox" checked={form.ai_falci_enabled} onChange={(e) => setForm((prev) => ({ ...prev, ai_falci_enabled: e.target.checked }))} />
            <span>{tx(lang, 'AI Falçı aktiv olsun', 'Включить AI Falçı', 'Enable AI Fortune Teller')}</span>
          </label>
        </div>
        <div className="flex justify-end">
          <button onClick={() => { void save(); }} className="glossy-gold rounded-xl px-6 py-2 font-bold">{tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}</button>
        </div>
      </div>
    </div>
  );
}

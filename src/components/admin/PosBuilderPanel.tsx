import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Grip, LayoutTemplate } from 'lucide-react';
import { useAppStore } from '../../store';
import { get_settings_live, update_pos_layout_settings_live } from '../../api/settings';
import { tx } from '../../i18n';
import type { Settings } from '../../types/pos';

type PosLayoutSettings = NonNullable<Settings['pos_layout']>;
type LayoutDevice = 'desktop' | 'tablet';

const DEFAULT_LAYOUT: PosLayoutSettings = {
  preset: 'classic',
  density: 'comfortable',
  product_columns: 3,
  show_cart_tabs: true,
  accent_color: '#facc15',
  hidden_widgets: [],
  widget_order: ['customer', 'discount', 'orderType', 'table', 'cartItems', 'cartSummary', 'payments'],
  device_layouts: {
    desktop: {},
    tablet: {
      preset: 'touch',
      density: 'large',
      product_columns: 2,
    },
  },
};

const WIDGETS = [
  { key: 'customer', labelAz: 'Müştəri / QR', labelRu: 'Клиент / QR', labelEn: 'Customer / QR' },
  { key: 'discount', labelAz: 'Endirim / Reward', labelRu: 'Скидка / Reward', labelEn: 'Discount / Reward' },
  { key: 'orderType', labelAz: 'Sifariş tipi', labelRu: 'Тип заказа', labelEn: 'Order type' },
  { key: 'table', labelAz: 'Masa bloku', labelRu: 'Блок столов', labelEn: 'Table block' },
  { key: 'cartItems', labelAz: 'Səbət məhsulları', labelRu: 'Товары корзины', labelEn: 'Cart items' },
  { key: 'cartSummary', labelAz: 'Yekun blok', labelRu: 'Блок итогов', labelEn: 'Summary block' },
  { key: 'payments', labelAz: 'Ödəniş düymələri', labelRu: 'Кнопки оплаты', labelEn: 'Payment buttons' },
];

const LEFT_WIDGETS = [
  { key: 'menuHeader', labelAz: 'Menyu başlığı', labelRu: 'Заголовок меню', labelEn: 'Menu header' },
  { key: 'search', labelAz: 'Axtarış', labelRu: 'Поиск', labelEn: 'Search' },
  { key: 'categories', labelAz: 'Kateqoriyalar', labelRu: 'Категории', labelEn: 'Categories' },
  { key: 'productGrid', labelAz: 'Məhsul grid', labelRu: 'Сетка товаров', labelEn: 'Product grid' },
];

const PRESETS: Array<{ key: PosLayoutSettings['preset']; titleAz: string; titleRu: string; titleEn: string; noteAz: string; noteRu: string; noteEn: string }> = [
  {
    key: 'classic',
    titleAz: 'Classic POS',
    titleRu: 'Classic POS',
    titleEn: 'Classic POS',
    noteAz: 'Balanslı, ən universal görünüş.',
    noteRu: 'Сбалансированный универсальный вид.',
    noteEn: 'Balanced and most universal layout.',
  },
  {
    key: 'fast',
    titleAz: 'Fast Cashier',
    titleRu: 'Fast Cashier',
    titleEn: 'Fast Cashier',
    noteAz: 'Sürətli checkout və yığcam sağ panel.',
    noteRu: 'Быстрая оплата и компактная правая панель.',
    noteEn: 'Fast checkout and compact right rail.',
  },
  {
    key: 'touch',
    titleAz: 'Touch Large',
    titleRu: 'Touch Large',
    titleEn: 'Touch Large',
    noteAz: 'Böyük düymələr və touch monitor üçün rahat axın.',
    noteRu: 'Крупные кнопки для touch-мониторов.',
    noteEn: 'Larger controls for touch screens.',
  },
  {
    key: 'tables',
    titleAz: 'Table Service',
    titleRu: 'Table Service',
    titleEn: 'Table Service',
    noteAz: 'Masada servis və mətbəx axını ön plandadır.',
    noteRu: 'Фокус на зале и кухонном потоке.',
    noteEn: 'Optimized for table service and kitchen flow.',
  },
];

const PRESET_PATCHES: Record<PosLayoutSettings['preset'], Partial<PosLayoutSettings>> = {
  classic: { density: 'comfortable', product_columns: 3, show_cart_tabs: true, hidden_widgets: [] },
  fast: { density: 'compact', product_columns: 4, show_cart_tabs: true, hidden_widgets: ['table'] },
  touch: { density: 'large', product_columns: 2, show_cart_tabs: true, hidden_widgets: [] },
  tables: { density: 'comfortable', product_columns: 3, show_cart_tabs: true, hidden_widgets: [] },
};

export default function PosBuilderPanel() {
  const { user, lang, notify } = useAppStore();
  const tenantId = user?.tenant_id || 'tenant_default';
  const [layout, setLayout] = useState<PosLayoutSettings>(DEFAULT_LAYOUT);
  const [isSaving, setIsSaving] = useState(false);
  const [draggingWidget, setDraggingWidget] = useState<string | null>(null);
  const [dropTargetWidget, setDropTargetWidget] = useState<string | null>(null);
  const [draggingLeftWidget, setDraggingLeftWidget] = useState<string | null>(null);
  const [dropTargetLeftWidget, setDropTargetLeftWidget] = useState<string | null>(null);
  const [activeDevice, setActiveDevice] = useState<LayoutDevice>('desktop');

  useEffect(() => {
    void (async () => {
      try {
        const settings = await get_settings_live(tenantId);
        setLayout({ ...DEFAULT_LAYOUT, ...(settings.pos_layout || {}) });
      } catch {
        setLayout(DEFAULT_LAYOUT);
      }
    })();
  }, [tenantId]);

  const visibleWidgets = useMemo(
    () => {
      const profile = {
        ...layout,
        ...(layout.device_layouts?.[activeDevice] || {}),
      };
      return profile.widget_order.filter((key) => !profile.hidden_widgets.includes(key));
    },
    [layout, activeDevice],
  );

  const activeProfile = useMemo(
    () => ({
      ...layout,
      ...(layout.device_layouts?.[activeDevice] || {}),
    }),
    [layout, activeDevice],
  );

  const updateActiveProfile = (patch: Partial<PosLayoutSettings>) => {
    setLayout((prev) => ({
      ...prev,
      device_layouts: {
        ...(prev.device_layouts || {}),
        [activeDevice]: {
          ...(prev.device_layouts?.[activeDevice] || {}),
          ...patch,
        },
      },
    }));
  };

  const toggleLeftHidden = (widgetKey: string) => {
    updateActiveProfile({
      left_hidden_widgets: activeProfile.left_hidden_widgets.includes(widgetKey)
        ? activeProfile.left_hidden_widgets.filter((key) => key !== widgetKey)
        : [...activeProfile.left_hidden_widgets, widgetKey],
    });
  };

  const setPreset = (preset: PosLayoutSettings['preset']) => {
    updateActiveProfile({
      preset,
      ...PRESET_PATCHES[preset],
      hidden_widgets: [...(PRESET_PATCHES[preset].hidden_widgets || activeProfile.hidden_widgets || [])],
    });
  };

  const toggleHidden = (widgetKey: string) => {
    updateActiveProfile({
      hidden_widgets: activeProfile.hidden_widgets.includes(widgetKey)
        ? activeProfile.hidden_widgets.filter((key) => key !== widgetKey)
        : [...activeProfile.hidden_widgets, widgetKey],
    });
  };

  const moveWidget = (widgetKey: string, direction: -1 | 1) => {
    setLayout((prev) => {
      const currentProfile = { ...prev, ...(prev.device_layouts?.[activeDevice] || {}) };
      const next = [...currentProfile.widget_order];
      const index = next.indexOf(widgetKey);
      if (index < 0) return prev;
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return {
        ...prev,
        device_layouts: {
          ...(prev.device_layouts || {}),
          [activeDevice]: {
            ...(prev.device_layouts?.[activeDevice] || {}),
            widget_order: next,
          },
        },
      };
    });
  };

  const moveWidgetTo = (fromKey: string, toKey: string) => {
    if (!fromKey || !toKey || fromKey === toKey) return;
    setLayout((prev) => {
      const currentProfile = { ...prev, ...(prev.device_layouts?.[activeDevice] || {}) };
      const current = [...currentProfile.widget_order];
      const fromIndex = current.indexOf(fromKey);
      const toIndex = current.indexOf(toKey);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const [moved] = current.splice(fromIndex, 1);
      current.splice(toIndex, 0, moved);
      return {
        ...prev,
        device_layouts: {
          ...(prev.device_layouts || {}),
          [activeDevice]: {
            ...(prev.device_layouts?.[activeDevice] || {}),
            widget_order: current,
          },
        },
      };
    });
  };

  const moveLeftWidget = (widgetKey: string, direction: -1 | 1) => {
    setLayout((prev) => {
      const currentProfile = { ...prev, ...(prev.device_layouts?.[activeDevice] || {}) };
      const next = [...currentProfile.left_widget_order];
      const index = next.indexOf(widgetKey);
      if (index < 0) return prev;
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return {
        ...prev,
        device_layouts: {
          ...(prev.device_layouts || {}),
          [activeDevice]: {
            ...(prev.device_layouts?.[activeDevice] || {}),
            left_widget_order: next,
          },
        },
      };
    });
  };

  const moveLeftWidgetTo = (fromKey: string, toKey: string) => {
    if (!fromKey || !toKey || fromKey === toKey) return;
    setLayout((prev) => {
      const currentProfile = { ...prev, ...(prev.device_layouts?.[activeDevice] || {}) };
      const current = [...currentProfile.left_widget_order];
      const fromIndex = current.indexOf(fromKey);
      const toIndex = current.indexOf(toKey);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const [moved] = current.splice(fromIndex, 1);
      current.splice(toIndex, 0, moved);
      return {
        ...prev,
        device_layouts: {
          ...(prev.device_layouts || {}),
          [activeDevice]: {
            ...(prev.device_layouts?.[activeDevice] || {}),
            left_widget_order: current,
          },
        },
      };
    });
  };

  const resetLayout = () => {
    setLayout((prev) => ({
      ...prev,
      device_layouts: {
        ...(prev.device_layouts || {}),
        [activeDevice]: activeDevice === 'tablet'
          ? { preset: 'touch', density: 'large', product_columns: 2, show_cart_tabs: true, accent_color: '#facc15', hidden_widgets: [], widget_order: DEFAULT_LAYOUT.widget_order, left_hidden_widgets: [], left_widget_order: ['search', 'categories', 'productGrid'] }
          : { preset: 'classic', density: 'comfortable', product_columns: 3, show_cart_tabs: true, accent_color: '#facc15', hidden_widgets: [], widget_order: DEFAULT_LAYOUT.widget_order, left_hidden_widgets: [], left_widget_order: DEFAULT_LAYOUT.left_widget_order },
      },
    }));
    notify('info', tx(lang, 'POS builder default görünüşə qaytarıldı', 'POS builder сброшен к виду по умолчанию', 'POS builder reset to default'));
  };

  const save = async () => {
    setIsSaving(true);
    try {
      await update_pos_layout_settings_live(layout);
      window.dispatchEvent(new CustomEvent('pos-layout-updated', { detail: { tenant_id: tenantId } }));
      notify('success', tx(lang, 'POS dizaynı yadda saxlanıldı', 'POS-дизайн сохранен', 'POS layout saved'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'POS dizaynı yadda saxlanılmadı', 'POS-дизайн не сохранен', 'Failed to save POS layout'));
    } finally {
      setIsSaving(false);
    }
  };

  const widgetLabel = (key: string) => {
    const row = WIDGETS.find((widget) => widget.key === key);
    if (!row) return key;
    return lang === 'ru' ? row.labelRu : lang === 'en' ? row.labelEn : row.labelAz;
  };

  const leftWidgetLabel = (key: string) => {
    const row = LEFT_WIDGETS.find((widget) => widget.key === key);
    if (!row) return key;
    return lang === 'ru' ? row.labelRu : lang === 'en' ? row.labelEn : row.labelAz;
  };

  return (
    <div className="space-y-6 text-slate-100">
      <div className="metal-panel p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-3">
            <LayoutTemplate size={22} />
          </div>
          <div>
            <h2 className="text-2xl font-bold">{tx(lang, 'POS Builder', 'POS Builder', 'POS Builder')}</h2>
            <p className="text-sm text-slate-400">{tx(lang, 'Desktop və tablet üçün ayrıca POS görünüşü qurun.', 'Настройте отдельный POS-вид для desktop и tablet.', 'Configure separate POS layouts for desktop and tablet.')}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="metal-panel p-5">
          <div className="mb-4 flex flex-wrap gap-2">
            {([
              { key: 'desktop', label: tx(lang, 'Desktop', 'Desktop', 'Desktop') },
              { key: 'tablet', label: tx(lang, 'Tablet', 'Tablet', 'Tablet') },
            ] as const).map((device) => (
              <button
                key={device.key}
                onClick={() => setActiveDevice(device.key)}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${activeDevice === device.key ? 'border-yellow-300/60 bg-yellow-400/10 text-yellow-200' : 'border-slate-700/60 bg-slate-900/25 text-slate-300'}`}
              >
                {device.label}
              </button>
            ))}
          </div>
          <div className="mb-4 text-sm font-semibold text-slate-300">{tx(lang, 'Preset seçin', 'Выберите пресет', 'Choose a preset')}</div>
          <div className="grid gap-3 md:grid-cols-2">
            {PRESETS.map((preset) => {
              const title = lang === 'ru' ? preset.titleRu : lang === 'en' ? preset.titleEn : preset.titleAz;
              const note = lang === 'ru' ? preset.noteRu : lang === 'en' ? preset.noteEn : preset.noteAz;
              const active = activeProfile.preset === preset.key;
              return (
                <button
                  key={preset.key}
                  onClick={() => setPreset(preset.key)}
                  className={`rounded-2xl border p-4 text-left transition ${active ? 'border-yellow-300/50 bg-yellow-400/10 shadow-[0_0_24px_rgba(250,204,21,0.12)]' : 'border-slate-700/60 bg-slate-900/25 hover:border-slate-500/70'}`}
                >
                  <div className="text-base font-semibold">{title}</div>
                  <div className="mt-1 text-sm text-slate-400">{note}</div>
                </button>
              );
            })}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm text-slate-300">{tx(lang, 'Sıxlıq', 'Плотность', 'Density')}</span>
              <select value={activeProfile.density} onChange={(e) => updateActiveProfile({ density: e.target.value as PosLayoutSettings['density'] })} className="neon-input">
                <option value="compact">{tx(lang, 'Kompakt', 'Компактно', 'Compact')}</option>
                <option value="comfortable">{tx(lang, 'Rahat', 'Комфортно', 'Comfortable')}</option>
                <option value="large">{tx(lang, 'Böyük Touch', 'Большой touch', 'Large Touch')}</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm text-slate-300">{tx(lang, 'Məhsul sütunları', 'Колонки товаров', 'Product columns')}</span>
              <select value={activeProfile.product_columns} onChange={(e) => updateActiveProfile({ product_columns: Number(e.target.value) as 2 | 3 | 4 })} className="neon-input">
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="text-sm text-slate-300">{tx(lang, 'Accent rəngi', 'Accent цвет', 'Accent color')}</span>
              <input type="color" value={activeProfile.accent_color} onChange={(e) => updateActiveProfile({ accent_color: e.target.value })} className="h-12 w-full rounded-xl border border-slate-700/60 bg-slate-900/20" />
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-slate-700/60 bg-slate-900/25 px-4 py-4">
              <input type="checkbox" checked={activeProfile.show_cart_tabs} onChange={(e) => updateActiveProfile({ show_cart_tabs: e.target.checked })} />
              <span className="text-sm text-slate-200">{tx(lang, '3 səbət tab-ı görünsün', 'Показывать 3 вкладки корзины', 'Show 3 cart tabs')}</span>
            </label>
          </div>
        </div>

        <div className="space-y-5">
        <div className="metal-panel p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-300">{tx(lang, 'Widget idarəetməsi', 'Управление виджетами', 'Widget controls')}</div>
            <button onClick={resetLayout} className="neon-btn rounded-xl px-3 py-2 text-xs">
              {tx(lang, 'Default-a qaytar', 'Сбросить', 'Reset')}
            </button>
          </div>
          <div className="mb-3 rounded-2xl border border-slate-700/60 bg-slate-950/35 px-4 py-3 text-xs text-slate-400">
            {tx(lang, 'Widget-ləri sürüşdürüb buraxaraq sıralayın. İstəsəniz sağdakı düymələrlə də yerini dəyişə bilərsiniz.', 'Перетаскивайте виджеты, чтобы менять порядок. Кнопки справа тоже работают.', 'Drag and drop widgets to reorder them. You can also use the buttons on the right.')}
          </div>
          <div className="space-y-3">
            {activeProfile.widget_order.map((widgetKey, index) => {
              const hidden = activeProfile.hidden_widgets.includes(widgetKey);
              const isDropTarget = dropTargetWidget === widgetKey && draggingWidget !== widgetKey;
              return (
                <div
                  key={widgetKey}
                  draggable
                  onDragStart={() => {
                    setDraggingWidget(widgetKey);
                    setDropTargetWidget(widgetKey);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (draggingWidget && draggingWidget !== widgetKey) {
                      setDropTargetWidget(widgetKey);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggingWidget && draggingWidget !== widgetKey) {
                      moveWidgetTo(draggingWidget, widgetKey);
                    }
                    setDraggingWidget(null);
                    setDropTargetWidget(null);
                  }}
                  onDragEnd={() => {
                    setDraggingWidget(null);
                    setDropTargetWidget(null);
                  }}
                  className={`flex items-center gap-3 rounded-2xl border px-3 py-3 transition ${
                    isDropTarget
                      ? 'border-yellow-300/60 bg-yellow-400/10 shadow-[0_0_20px_rgba(250,204,21,0.12)]'
                      : draggingWidget === widgetKey
                        ? 'border-cyan-300/50 bg-cyan-400/10 opacity-80'
                        : 'border-slate-700/60 bg-slate-900/25'
                  }`}
                >
                  <Grip size={16} className="cursor-grab text-slate-500" />
                  <div className="min-w-0 flex-1">
                    <div className={`font-medium ${hidden ? 'text-slate-500 line-through' : 'text-slate-100'}`}>{widgetLabel(widgetKey)}</div>
                    <div className="text-xs text-slate-500">{tx(lang, 'Sıra', 'Порядок', 'Order')}: {index + 1}</div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={!hidden} onChange={() => toggleHidden(widgetKey)} />
                    {tx(lang, 'Görünsün', 'Показывать', 'Visible')}
                  </label>
                  <button onClick={() => moveWidget(widgetKey, -1)} className="neon-btn rounded-lg px-2 py-2" disabled={index === 0}>
                    <ArrowUp size={14} />
                  </button>
                  <button onClick={() => moveWidget(widgetKey, 1)} className="neon-btn rounded-lg px-2 py-2" disabled={index === activeProfile.widget_order.length - 1}>
                    <ArrowDown size={14} />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-5 rounded-2xl border border-slate-700/60 bg-slate-950/35 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{tx(lang, 'Preview summary', 'Preview summary', 'Preview summary')}</div>
            <div className="mt-3 text-sm text-slate-300">
              {tx(lang, 'Görünən bloklar', 'Видимые блоки', 'Visible blocks')}: <b>{visibleWidgets.length}</b>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {visibleWidgets.map((key) => (
                <span key={key} className="rounded-full border border-slate-600/60 bg-slate-900/35 px-3 py-1 text-xs text-slate-200">
                  {widgetLabel(key)}
                </span>
              ))}
            </div>
            <div className="mt-4 rounded-[28px] border border-slate-700/70 bg-[linear-gradient(180deg,#182231,#0c131d)] p-4">
              <div className="mb-3 flex items-center justify-between text-xs text-slate-400">
                <span>{tx(lang, 'Mini preview', 'Мини-превью', 'Mini preview')}</span>
                <span>{activeProfile.preset}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-2xl p-3 text-xs font-semibold text-slate-900" style={{ backgroundColor: activeProfile.accent_color }}>
                  {tx(lang, 'Məhsul grid', 'Сетка товаров', 'Product grid')} x{activeProfile.product_columns}
                </div>
                <div className="rounded-2xl border border-slate-600/70 bg-slate-900/35 p-3 text-xs text-slate-200">
                  {tx(lang, 'Sıxlıq', 'Плотность', 'Density')}: {activeProfile.density}
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {visibleWidgets.slice(0, 4).map((key) => (
                  <div key={`preview_${key}`} className="rounded-2xl border border-slate-700/60 bg-slate-900/35 px-3 py-2 text-xs text-slate-200">
                    {widgetLabel(key)}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <button onClick={save} disabled={isSaving} className="glossy-gold mt-5 w-full rounded-2xl px-4 py-3 font-semibold">
            {isSaving ? tx(lang, 'Yadda saxlanılır...', 'Сохраняется...', 'Saving...') : tx(lang, 'POS Dizaynını Yadda Saxla', 'Сохранить POS дизайн', 'Save POS Layout')}
          </button>
        </div>

        <div className="metal-panel p-5">
          <div className="mb-4 text-sm font-semibold text-slate-300">{tx(lang, 'Sol panel blokları', 'Блоки левой панели', 'Left panel blocks')}</div>
          <div className="mb-3 rounded-2xl border border-slate-700/60 bg-slate-950/35 px-4 py-3 text-xs text-slate-400">
            {tx(lang, 'Axtarış, kateqoriya və məhsul hissəsini də ayrıca düzün. Tablet-də daha sadə axın saxlaya bilərsiniz.', 'Отдельно настройте поиск, категории и товары. Для tablet можно оставить более простой поток.', 'Arrange search, categories, and product sections separately. You can keep a simpler flow for tablet.')}
          </div>
          <div className="space-y-3">
            {activeProfile.left_widget_order.map((widgetKey, index) => {
              const hidden = activeProfile.left_hidden_widgets.includes(widgetKey);
              const isDropTarget = dropTargetLeftWidget === widgetKey && draggingLeftWidget !== widgetKey;
              return (
                <div
                  key={`left_${widgetKey}`}
                  draggable
                  onDragStart={() => {
                    setDraggingLeftWidget(widgetKey);
                    setDropTargetLeftWidget(widgetKey);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (draggingLeftWidget && draggingLeftWidget !== widgetKey) {
                      setDropTargetLeftWidget(widgetKey);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggingLeftWidget && draggingLeftWidget !== widgetKey) {
                      moveLeftWidgetTo(draggingLeftWidget, widgetKey);
                    }
                    setDraggingLeftWidget(null);
                    setDropTargetLeftWidget(null);
                  }}
                  onDragEnd={() => {
                    setDraggingLeftWidget(null);
                    setDropTargetLeftWidget(null);
                  }}
                  className={`flex items-center gap-3 rounded-2xl border px-3 py-3 transition ${
                    isDropTarget
                      ? 'border-cyan-300/60 bg-cyan-400/10 shadow-[0_0_20px_rgba(34,211,238,0.12)]'
                      : draggingLeftWidget === widgetKey
                        ? 'border-yellow-300/50 bg-yellow-400/10 opacity-80'
                        : 'border-slate-700/60 bg-slate-900/25'
                  }`}
                >
                  <Grip size={16} className="cursor-grab text-slate-500" />
                  <div className="min-w-0 flex-1">
                    <div className={`font-medium ${hidden ? 'text-slate-500 line-through' : 'text-slate-100'}`}>{leftWidgetLabel(widgetKey)}</div>
                    <div className="text-xs text-slate-500">{tx(lang, 'Sıra', 'Порядок', 'Order')}: {index + 1}</div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={!hidden} onChange={() => toggleLeftHidden(widgetKey)} />
                    {tx(lang, 'Görünsün', 'Показывать', 'Visible')}
                  </label>
                  <button onClick={() => moveLeftWidget(widgetKey, -1)} className="neon-btn rounded-lg px-2 py-2" disabled={index === 0}>
                    <ArrowUp size={14} />
                  </button>
                  <button onClick={() => moveLeftWidget(widgetKey, 1)} className="neon-btn rounded-lg px-2 py-2" disabled={index === activeProfile.left_widget_order.length - 1}>
                    <ArrowDown size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Grip, LayoutTemplate, Lock, Monitor, ShieldCheck, Tablet } from 'lucide-react';
import { useAppStore } from '../../store';
import { get_settings_live, publish_pos_layout_draft_live, reset_pos_layout_draft_live, update_pos_layout_draft_live } from '../../api/settings';
import { tx } from '../../i18n';
import type { PosLayoutConfig, Settings } from '../../types/pos';

type PosLayoutSettings = NonNullable<Settings['pos_layout']>;
type LayoutDevice = 'desktop' | 'tablet';
type LayoutScope = 'base' | 'staff' | 'manager';

const DEFAULT_LAYOUT: PosLayoutSettings = {
  preset: 'classic',
  density: 'comfortable',
  product_columns: 3,
  show_cart_tabs: true,
  accent_color: '#facc15',
  hidden_widgets: [],
  widget_order: ['customer', 'discount', 'orderType', 'table', 'cartItems', 'cartSummary', 'payments'],
  left_hidden_widgets: [],
  left_widget_order: ['menuHeader', 'search', 'categories', 'productGrid'],
  widget_sizes: {},
  left_widget_sizes: {},
  device_layouts: {
    desktop: {},
    tablet: {
      preset: 'touch',
      density: 'large',
      product_columns: 2,
      left_hidden_widgets: [],
      left_widget_order: ['search', 'categories', 'productGrid'],
      widget_sizes: {},
      left_widget_sizes: {},
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

const REQUIRED_RIGHT_WIDGETS = ['cartItems', 'cartSummary', 'payments'] as const;
const REQUIRED_LEFT_WIDGETS = ['productGrid'] as const;
const FIXED_FOOTER_WIDGETS = ['cartSummary', 'payments'] as const;

const stripNestedLayoutMeta = (patch: Partial<PosLayoutSettings> | undefined | null) => {
  if (!patch) return {};
  const { device_layouts, role_overrides, ...rest } = patch as any;
  return rest as Partial<PosLayoutSettings>;
};

const completeLayoutProfile = (profile: Partial<PosLayoutConfig>): PosLayoutSettings => ({
  ...DEFAULT_LAYOUT,
  ...profile,
  hidden_widgets: profile.hidden_widgets || [],
  widget_order: profile.widget_order || DEFAULT_LAYOUT.widget_order,
  left_hidden_widgets: profile.left_hidden_widgets || [],
  left_widget_order: profile.left_widget_order || DEFAULT_LAYOUT.left_widget_order || [],
  widget_sizes: profile.widget_sizes || {},
  left_widget_sizes: profile.left_widget_sizes || {},
  widget_options: profile.widget_options || {},
  device_layouts: profile.device_layouts || {},
  role_overrides: profile.role_overrides || {},
});

const PANEL_RATIO_OPTIONS = [
  { key: '50:50', label: '50% / 50%' },
  { key: '55:45', label: '55% / 45%' },
  { key: '60:40', label: '60% / 40%' },
  { key: '65:35', label: '65% / 35%' },
  { key: '70:30', label: '70% / 30%' },
] as const;

const SIZE_OPTIONS = [
  { key: 'compact', az: 'Kompakt', ru: 'Компактно', en: 'Compact' },
  { key: 'comfortable', az: 'Rahat', ru: 'Комфортно', en: 'Comfortable' },
  { key: 'expanded', az: 'Geniş', ru: 'Расширенно', en: 'Expanded' },
] as const;

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

const INDUSTRY_PRESETS: Array<{
  key: string;
  titleAz: string;
  titleRu: string;
  titleEn: string;
  noteAz: string;
  noteRu: string;
  noteEn: string;
  build: (device: LayoutDevice) => Partial<PosLayoutConfig>;
}> = [
  {
    key: 'coffee_shop',
    titleAz: 'Coffee Shop',
    titleRu: 'Coffee Shop',
    titleEn: 'Coffee Shop',
    noteAz: 'QR, reward və sürətli takeaway axını ön planda.',
    noteRu: 'Фокус на QR, reward и быстром takeaway.',
    noteEn: 'Focused on QR, rewards, and fast takeaway flow.',
    build: (device: LayoutDevice) => ({
      preset: device === 'tablet' ? 'touch' : 'classic',
      density: device === 'tablet' ? 'large' : 'comfortable',
      product_columns: device === 'tablet' ? 2 : 3,
      show_cart_tabs: true,
      accent_color: '#f59e0b',
      hidden_widgets: [],
      widget_order: ['customer', 'discount', 'cartItems', 'cartSummary', 'payments', 'orderType', 'table'],
      left_hidden_widgets: [],
      left_widget_order: ['search', 'categories', 'productGrid', 'menuHeader'],
      widget_sizes: { customer: 'expanded', discount: 'comfortable', payments: 'expanded', cartItems: 'expanded' },
      left_widget_sizes: { search: 'expanded', categories: 'comfortable', productGrid: 'expanded' },
    }),
  },
  {
    key: 'restaurant',
    titleAz: 'Restaurant',
    titleRu: 'Restaurant',
    titleEn: 'Restaurant',
    noteAz: 'Masa servisi və mətbəx axını daha önə çəkilir.',
    noteRu: 'Усилен акцент на зале и кухонном потоке.',
    noteEn: 'Table service and kitchen flow are prioritized.',
    build: (device: LayoutDevice) => ({
      preset: 'tables',
      density: device === 'tablet' ? 'large' : 'comfortable',
      product_columns: device === 'tablet' ? 2 : 3,
      show_cart_tabs: true,
      accent_color: '#22c55e',
      hidden_widgets: [],
      widget_order: ['table', 'orderType', 'cartItems', 'cartSummary', 'payments', 'customer', 'discount'],
      left_hidden_widgets: [],
      left_widget_order: ['menuHeader', 'categories', 'search', 'productGrid'],
      widget_sizes: { table: 'expanded', orderType: 'comfortable', cartItems: 'expanded', payments: 'comfortable' },
      left_widget_sizes: { categories: 'expanded', productGrid: 'expanded' },
    }),
  },
  {
    key: 'fast_food',
    titleAz: 'Fast Food',
    titleRu: 'Fast Food',
    titleEn: 'Fast Food',
    noteAz: 'Maksimum sürət, daha sıx məhsul grid və böyük checkout.',
    noteRu: 'Максимальная скорость, плотная сетка и крупный checkout.',
    noteEn: 'Maximum speed, dense product grid, and bold checkout.',
    build: (device: LayoutDevice) => ({
      preset: 'fast',
      density: 'compact',
      product_columns: device === 'tablet' ? 3 : 4,
      show_cart_tabs: false,
      accent_color: '#ef4444',
      hidden_widgets: ['table', 'customer'],
      widget_order: ['cartItems', 'cartSummary', 'payments', 'discount', 'orderType', 'table', 'customer'],
      left_hidden_widgets: device === 'tablet' ? ['menuHeader'] : [],
      left_widget_order: ['search', 'productGrid', 'categories', 'menuHeader'],
      widget_sizes: { cartItems: 'expanded', payments: 'expanded', cartSummary: 'comfortable' },
      left_widget_sizes: { search: 'compact', productGrid: 'expanded', categories: 'compact' },
    }),
  },
  {
    key: 'bakery',
    titleAz: 'Bakery',
    titleRu: 'Bakery',
    titleEn: 'Bakery',
    noteAz: 'Məhsul vitrini və rahat kateqoriya naviqasiyası vurğulanır.',
    noteRu: 'Акцент на витрине товаров и удобной навигации.',
    noteEn: 'Highlights product display and easy category browsing.',
    build: (device: LayoutDevice) => ({
      preset: 'classic',
      density: 'comfortable',
      product_columns: device === 'tablet' ? 2 : 4,
      show_cart_tabs: true,
      accent_color: '#a855f7',
      hidden_widgets: ['table'],
      widget_order: ['customer', 'cartItems', 'cartSummary', 'payments', 'discount', 'orderType', 'table'],
      left_hidden_widgets: [],
      left_widget_order: ['menuHeader', 'search', 'productGrid', 'categories'],
      widget_sizes: { cartItems: 'comfortable', cartSummary: 'comfortable', payments: 'expanded' },
      left_widget_sizes: { productGrid: 'expanded', search: 'comfortable' },
    }),
  },
  {
    key: 'dashboard_amber',
    titleAz: 'Dashboard Amber',
    titleRu: 'Dashboard Amber',
    titleEn: 'Dashboard Amber',
    noteAz: 'İstinad dizayna yaxın warm dark + amber premium görünüş.',
    noteRu: 'Теплый dark + amber premium стиль, близкий к референсу.',
    noteEn: 'Warm dark + amber premium style close to your reference.',
    build: (device: LayoutDevice) => ({
      preset: 'classic',
      density: device === 'tablet' ? 'large' : 'comfortable',
      product_columns: device === 'tablet' ? 2 : 3,
      panel_ratio: '60:40',
      show_cart_tabs: true,
      accent_color: '#f97316',
      hidden_widgets: [],
      widget_order: ['customer', 'discount', 'orderType', 'table', 'cartItems', 'cartSummary', 'payments'],
      left_hidden_widgets: [],
      left_widget_order: ['menuHeader', 'search', 'categories', 'productGrid'],
      widget_sizes: { customer: 'comfortable', discount: 'comfortable', cartItems: 'expanded', cartSummary: 'comfortable', payments: 'expanded' },
      left_widget_sizes: { menuHeader: 'comfortable', search: 'comfortable', categories: 'comfortable', productGrid: 'expanded' },
    }),
  },
  {
    key: 'touch_kiosk',
    titleAz: 'Touch Kiosk',
    titleRu: 'Touch Kiosk',
    titleEn: 'Touch Kiosk',
    noteAz: 'Özünəsifariş üçün iri düymələr və sadələşdirilmiş sağ panel.',
    noteRu: 'Крупные кнопки и упрощенная правая панель для self-order.',
    noteEn: 'Large buttons and simplified side rail for self-order.',
    build: (_device: LayoutDevice) => ({
      preset: 'touch',
      density: 'large',
      product_columns: 2,
      show_cart_tabs: false,
      accent_color: '#06b6d4',
      hidden_widgets: ['table', 'customer'],
      widget_order: ['cartItems', 'cartSummary', 'payments', 'discount', 'orderType', 'table', 'customer'],
      left_hidden_widgets: ['menuHeader'],
      left_widget_order: ['search', 'categories', 'productGrid', 'menuHeader'],
      widget_sizes: { cartItems: 'expanded', cartSummary: 'expanded', payments: 'expanded' },
      left_widget_sizes: { search: 'expanded', categories: 'expanded', productGrid: 'expanded' },
    }),
  },
] as const;

export default function PosBuilderPanel() {
  const user = useAppStore((state) => state.user);
  const lang = useAppStore((state) => state.lang);
  const notify = useAppStore((state) => state.notify);
  const tenantId = user?.tenant_id || 'tenant_default';
  const [layout, setLayout] = useState<PosLayoutSettings>(DEFAULT_LAYOUT);
  const [isSaving, setIsSaving] = useState(false);
  const [draggingWidget, setDraggingWidget] = useState<string | null>(null);
  const [dropTargetWidget, setDropTargetWidget] = useState<string | null>(null);
  const [draggingLeftWidget, setDraggingLeftWidget] = useState<string | null>(null);
  const [dropTargetLeftWidget, setDropTargetLeftWidget] = useState<string | null>(null);
  const [activeDevice, setActiveDevice] = useState<LayoutDevice>('desktop');
  const [activeScope, setActiveScope] = useState<LayoutScope>('base');

  const buildActiveProfile = (source: PosLayoutSettings, device: LayoutDevice, scope: LayoutScope) => {
    const devicePatch = source.device_layouts?.[device];
    if (scope === 'base') {
      return completeLayoutProfile({
        ...DEFAULT_LAYOUT,
        ...source,
        ...stripNestedLayoutMeta(devicePatch),
      });
    }
    const rolePatch = source.role_overrides?.[scope] || {};
    const roleDevicePatch = rolePatch.device_layouts?.[device];
    return completeLayoutProfile({
      ...DEFAULT_LAYOUT,
      ...source,
      ...stripNestedLayoutMeta(devicePatch),
      ...stripNestedLayoutMeta(rolePatch),
      ...stripNestedLayoutMeta(roleDevicePatch),
    });
  };

  useEffect(() => {
    void (async () => {
      try {
        const settings = await get_settings_live(tenantId);
        setLayout({ ...DEFAULT_LAYOUT, ...((settings.pos_layout_draft || settings.pos_layout) || {}) });
      } catch {
        setLayout(DEFAULT_LAYOUT);
      }
    })();
  }, [tenantId]);

  const visibleWidgets = useMemo(
    () => {
      const profile = buildActiveProfile(layout, activeDevice, activeScope);
      return profile.widget_order.filter((key) => !profile.hidden_widgets.includes(key));
    },
    [layout, activeDevice, activeScope],
  );
  const visibleLeftWidgets = useMemo(
    () => {
      const profile = buildActiveProfile(layout, activeDevice, activeScope);
      const leftWidgetOrder = profile.left_widget_order || [];
      const leftHiddenWidgets = profile.left_hidden_widgets || [];
      return leftWidgetOrder.filter((key) => !leftHiddenWidgets.includes(key));
    },
    [layout, activeDevice, activeScope],
  );

  const activeProfile = useMemo(
    () => buildActiveProfile(layout, activeDevice, activeScope),
    [layout, activeDevice, activeScope],
  );
  const activeLeftWidgetOrder = activeProfile.left_widget_order || [];
  const activeLeftHiddenWidgets = activeProfile.left_hidden_widgets || [];

  const hasOverride = useCallback(
    (key: keyof PosLayoutSettings) => {
      if (activeScope === 'base') return false;
      const roleData = layout.role_overrides?.[activeScope];
      if (!roleData) return false;
      const deviceData = roleData.device_layouts?.[activeDevice];
      if (deviceData && deviceData[key] !== undefined) return true;
      if (roleData[key] !== undefined) return true;
      return false;
    },
    [layout, activeScope, activeDevice]
  );

  const updateActiveProfile = (patch: Partial<PosLayoutSettings>) => {
    setLayout((prev) => {
      if (activeScope === 'staff' || activeScope === 'manager') {
        const currentRole = prev.role_overrides?.[activeScope] || {};
        return {
          ...prev,
          role_overrides: {
            ...(prev.role_overrides || {}),
            [activeScope]: {
              ...currentRole,
              device_layouts: {
                ...(currentRole.device_layouts || {}),
                [activeDevice]: {
                  ...(currentRole.device_layouts?.[activeDevice] || {}),
                  ...patch,
                },
              },
            },
          },
        };
      }
      return {
        ...prev,
        device_layouts: {
          ...(prev.device_layouts || {}),
          [activeDevice]: {
            ...(prev.device_layouts?.[activeDevice] || {}),
            ...patch,
          },
        },
      };
    });
  };

  const toggleLeftHidden = (widgetKey: string) => {
    updateActiveProfile({
      left_hidden_widgets: activeLeftHiddenWidgets.includes(widgetKey)
        ? activeLeftHiddenWidgets.filter((key) => key !== widgetKey)
        : [...activeLeftHiddenWidgets, widgetKey],
    });
  };

  const updateWidgetSize = (widgetKey: string, size: 'compact' | 'comfortable' | 'expanded') => {
    updateActiveProfile({
      widget_sizes: {
        ...(activeProfile.widget_sizes || {}),
        [widgetKey]: size,
      },
    });
  };

  const updateLeftWidgetSize = (widgetKey: string, size: 'compact' | 'comfortable' | 'expanded') => {
    updateActiveProfile({
      left_widget_sizes: {
        ...(activeProfile.left_widget_sizes || {}),
        [widgetKey]: size,
      },
    });
  };

  const setPreset = (preset: PosLayoutSettings['preset']) => {
    updateActiveProfile({
      preset,
      ...PRESET_PATCHES[preset],
      hidden_widgets: [...(PRESET_PATCHES[preset].hidden_widgets || activeProfile.hidden_widgets || [])],
    });
  };

  const applyIndustryPreset = (builder: (device: LayoutDevice) => Partial<PosLayoutSettings>) => {
    updateActiveProfile(builder(activeDevice));
    notify('success', tx(lang, 'Hazır POS preset tətbiq olundu', 'Готовый POS-пресет применен', 'POS preset applied'));
  };

  const toggleHidden = (widgetKey: string) => {
    updateActiveProfile({
      hidden_widgets: activeProfile.hidden_widgets.includes(widgetKey)
        ? activeProfile.hidden_widgets.filter((key) => key !== widgetKey)
        : [...activeProfile.hidden_widgets, widgetKey],
    });
  };

  const moveWidget = (widgetKey: string, direction: -1 | 1) => {
    const next = [...activeProfile.widget_order];
    const index = next.indexOf(widgetKey);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    updateActiveProfile({ widget_order: next });
  };

  const moveWidgetTo = (fromKey: string, toKey: string) => {
    if (!fromKey || !toKey || fromKey === toKey) return;
    const current = [...activeProfile.widget_order];
    const fromIndex = current.indexOf(fromKey);
    const toIndex = current.indexOf(toKey);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = current.splice(fromIndex, 1);
    current.splice(toIndex, 0, moved);
    updateActiveProfile({ widget_order: current });
  };

  const moveLeftWidget = (widgetKey: string, direction: -1 | 1) => {
    const next = [...activeLeftWidgetOrder];
    const index = next.indexOf(widgetKey);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    updateActiveProfile({ left_widget_order: next });
  };

  const moveLeftWidgetTo = (fromKey: string, toKey: string) => {
    if (!fromKey || !toKey || fromKey === toKey) return;
    const current = [...activeLeftWidgetOrder];
    const fromIndex = current.indexOf(fromKey);
    const toIndex = current.indexOf(toKey);
    if (fromIndex < 0 || toIndex < 0) return;
    const [moved] = current.splice(fromIndex, 1);
    current.splice(toIndex, 0, moved);
    updateActiveProfile({ left_widget_order: current });
  };

  const resetLayout = () => {
    setLayout((prev) => ({
      ...prev,
      ...(activeScope === 'staff' || activeScope === 'manager'
        ? {
            role_overrides: {
              ...(prev.role_overrides || {}),
              [activeScope]: {
                ...(prev.role_overrides?.[activeScope] || {}),
                device_layouts: {
                  ...((prev.role_overrides?.[activeScope] || {}).device_layouts || {}),
                  [activeDevice]: {},
                },
              },
            },
          }
        : {
            device_layouts: {
              ...(prev.device_layouts || {}),
              [activeDevice]: activeDevice === 'tablet'
                ? { preset: 'touch', density: 'large', product_columns: 2, show_cart_tabs: true, accent_color: '#facc15', hidden_widgets: [], widget_order: DEFAULT_LAYOUT.widget_order, left_hidden_widgets: [], left_widget_order: ['search', 'categories', 'productGrid'] }
                : { preset: 'classic', density: 'comfortable', product_columns: 3, show_cart_tabs: true, accent_color: '#facc15', hidden_widgets: [], widget_order: DEFAULT_LAYOUT.widget_order, left_hidden_widgets: [], left_widget_order: DEFAULT_LAYOUT.left_widget_order },
            },
          }),
    }));
    notify('info', tx(lang, 'POS dizaynı standart görünüşə qaytarıldı', 'Дизайн POS сброшен к стандартному виду', 'POS layout reset to default'));
  };

  const save = async () => {
    setIsSaving(true);
    try {
      await update_pos_layout_draft_live(layout);
      notify('success', tx(lang, 'POS draft yadda saxlanıldı', 'POS draft сохранен', 'POS draft saved'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'POS draft yadda saxlanılmadı', 'POS draft не сохранен', 'Failed to save POS draft'));
    } finally {
      setIsSaving(false);
    }
  };

  const publish = async () => {
    setIsSaving(true);
    try {
      await update_pos_layout_draft_live(layout);
      await publish_pos_layout_draft_live();
      window.dispatchEvent(new CustomEvent('pos-layout-updated', { detail: { tenant_id: tenantId } }));
      notify('success', tx(lang, 'POS dizaynı canlıya tətbiq olundu', 'POS дизайн опубликован', 'POS layout published'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'POS dizaynı publish olunmadı', 'POS дизайн не опубликован', 'Failed to publish POS layout'));
    } finally {
      setIsSaving(false);
    }
  };

  const resetDraft = async () => {
    setIsSaving(true);
    try {
      await reset_pos_layout_draft_live();
      const settings = await get_settings_live(tenantId);
      setLayout({ ...DEFAULT_LAYOUT, ...((settings.pos_layout_draft || settings.pos_layout) || {}) });
      notify('info', tx(lang, 'Draft canlı versiyaya qaytarıldı', 'Draft возвращен к live версии', 'Draft reset to live version'));
    } catch (e: any) {
      notify('error', e?.message || tx(lang, 'Draft geri qaytarılmadı', 'Draft не сброшен', 'Failed to reset draft'));
    } finally {
      setIsSaving(false);
    }
  };

  const widgetLabels = useMemo(() => {
    const map = new Map<string, string>();
    WIDGETS.forEach((widget) => {
      map.set(widget.key, lang === 'ru' ? widget.labelRu : lang === 'en' ? widget.labelEn : widget.labelAz);
    });
    return map;
  }, [lang]);

  const leftWidgetLabels = useMemo(() => {
    const map = new Map<string, string>();
    LEFT_WIDGETS.forEach((widget) => {
      map.set(widget.key, lang === 'ru' ? widget.labelRu : lang === 'en' ? widget.labelEn : widget.labelAz);
    });
    return map;
  }, [lang]);

  const widgetLabel = useCallback((key: string) => widgetLabels.get(key) || key, [widgetLabels]);

  const leftWidgetLabel = useCallback((key: string) => leftWidgetLabels.get(key) || key, [leftWidgetLabels]);

  const sizeLabel = (key: 'compact' | 'comfortable' | 'expanded') => {
    const row = SIZE_OPTIONS.find((item) => item.key === key);
    if (!row) return key;
    return lang === 'ru' ? row.ru : lang === 'en' ? row.en : row.az;
  };

  const previewBlockClass = (size: 'compact' | 'comfortable' | 'expanded' | undefined) =>
    size === 'compact'
      ? 'min-h-[34px] px-2 py-1.5 text-[10px]'
      : size === 'expanded'
        ? 'min-h-[68px] px-3 py-3 text-xs'
        : 'min-h-[48px] px-3 py-2 text-[11px]';

  const previewFloatingWidgets = visibleWidgets.filter((key) => !FIXED_FOOTER_WIDGETS.includes(key as any));
  const previewFooterWidgets = visibleWidgets.filter((key) => FIXED_FOOTER_WIDGETS.includes(key as any));
  const targetLabel = `${activeScope === 'base' ? tx(lang, 'Ümumi profil', 'Общий профиль', 'Base profile') : activeScope === 'staff' ? tx(lang, 'Staff profili', 'Профиль staff', 'Staff profile') : tx(lang, 'Menecer profili', 'Профиль manager', 'Manager profile')} · ${activeDevice === 'desktop' ? tx(lang, 'Desktop', 'Desktop', 'Desktop') : tx(lang, 'Tablet', 'Tablet', 'Tablet')}`;
  const operationalGuardrails = [
    tx(lang, 'Checkout zonası həmişə açıq qalır', 'Checkout-зона всегда остается активной', 'Checkout zone always stays active'),
    tx(lang, 'Məhsul grid-i gizlədilmir', 'Сетка товаров не скрывается', 'Product grid cannot be hidden'),
    tx(lang, 'Role profilləri cihaz üzrə ayrıca tətbiq olunur', 'Ролевые профили теперь применяются отдельно по устройствам', 'Role profiles are now device-specific'),
  ];

  return (
    <div className="space-y-6 text-slate-100">
      <div className="metal-panel p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-slate-700/60 bg-slate-900/40 p-3">
            <LayoutTemplate size={22} />
          </div>
          <div>
            <h2 className="text-2xl font-bold">{tx(lang, 'POS Dizaynı', 'Дизайн POS', 'POS Layout')}</h2>
            <p className="text-sm text-slate-400">{tx(lang, 'Əməliyyatı sındırmadan kassir ekranını cihaz və rol üzrə qurun.', 'Настройте экран кассира по устройству и роли без риска сломать поток.', 'Configure the cashier workspace by device and role without breaking operations.')}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-[28px] border border-emerald-300/20 bg-[linear-gradient(180deg,rgba(16,185,129,0.12),rgba(15,23,42,0.88))] p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-emerald-200">
              <ShieldCheck size={20} />
            </div>
            <div>
              <div className="text-sm font-semibold text-emerald-100">{tx(lang, 'Əməliyyat təhlükəsizliyi', 'Операционная безопасность', 'Operational safety')}</div>
              <div className="mt-1 text-sm text-emerald-100/80">{tx(lang, 'Builder artıq checkout və məhsul axınını sındıran kombinasiyaları bloklayır.', 'Builder теперь блокирует конфигурации, которые ломают checkout и товарный поток.', 'The builder now blocks layouts that break checkout and product flow.')}</div>
            </div>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {operationalGuardrails.map((item) => (
              <div key={item} className="rounded-2xl border border-emerald-300/15 bg-slate-950/25 px-4 py-3 text-sm text-slate-100">
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-700/70 bg-[#111824]/90 p-5">
          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">{tx(lang, 'Hədəf profil', 'Целевой профиль', 'Target profile')}</div>
          <div className="mt-3 flex items-center gap-3">
            <div className="rounded-2xl border border-slate-700/70 bg-slate-900/40 p-3 text-slate-200">
              {activeDevice === 'desktop' ? <Monitor size={18} /> : <Tablet size={18} />}
            </div>
            <div>
              <div className="text-lg font-semibold text-white">{targetLabel}</div>
              <div className="text-sm text-slate-400">
                {tx(lang, 'Buradakı dəyişikliklər yalnız seçilmiş profilə tətbiq olunur.', 'Изменения применяются только к выбранному профилю.', 'Changes apply only to the selected target profile.')}
              </div>
            </div>
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
          <div className="mb-4 flex flex-wrap gap-2">
            {([
              { key: 'base', label: tx(lang, 'Ümumi', 'Общий', 'Base') },
              { key: 'staff', label: tx(lang, 'Kassir / Staff', 'Кассир / Staff', 'Cashier / Staff') },
              { key: 'manager', label: tx(lang, 'Menecer', 'Менеджер', 'Manager') },
            ] as const).map((scope) => (
              <button
                key={scope.key}
                onClick={() => setActiveScope(scope.key)}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${activeScope === scope.key ? 'border-cyan-300/60 bg-cyan-400/10 text-cyan-200' : 'border-slate-700/60 bg-slate-900/25 text-slate-300'}`}
              >
                {scope.label}
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

          <div className="mt-6">
            <div className="mb-4 text-sm font-semibold text-slate-300">{tx(lang, 'Hazır biznes preset-ləri', 'Готовые бизнес-пресеты', 'Industry preset library')}</div>
            <div className="grid gap-3 md:grid-cols-2">
              {INDUSTRY_PRESETS.map((preset) => {
                const title = lang === 'ru' ? preset.titleRu : lang === 'en' ? preset.titleEn : preset.titleAz;
                const note = lang === 'ru' ? preset.noteRu : lang === 'en' ? preset.noteEn : preset.noteAz;
                return (
                  <button
                    key={preset.key}
                    onClick={() => applyIndustryPreset(preset.build)}
                    className="rounded-2xl border border-slate-700/60 bg-slate-900/25 p-4 text-left transition hover:border-cyan-300/40 hover:bg-cyan-400/5"
                  >
                    <div className="text-base font-semibold text-slate-100">{title}</div>
                    <div className="mt-1 text-sm text-slate-400">{note}</div>
                  </button>
                );
              })}
            </div>
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
              <span className="flex items-center text-sm text-slate-300">
                {tx(lang, 'Məhsul sütunları', 'Колонки товаров', 'Product columns')}
                {hasOverride('product_columns') && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" title="Overridden" />}
              </span>
              <select value={activeProfile.product_columns} onChange={(e) => updateActiveProfile({ product_columns: Number(e.target.value) as 2 | 3 | 4 })} className="neon-input">
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </label>
            <label className="space-y-2">
              <span className="flex items-center text-sm text-slate-300">
                {tx(lang, 'Panel Nisbəti', 'Соотношение панелей', 'Panel Ratio')}
                {hasOverride('panel_ratio') && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" title="Overridden" />}
              </span>
              <select value={activeProfile.panel_ratio || '50:50'} onChange={(e) => updateActiveProfile({ panel_ratio: e.target.value as PosLayoutSettings['panel_ratio'] })} className="neon-input">
                {PANEL_RATIO_OPTIONS.map(opt => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-2">
              <span className="flex items-center text-sm text-slate-300">
                {tx(lang, 'Accent rəngi', 'Accent цвет', 'Accent color')}
                {hasOverride('accent_color') && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" title="Overridden" />}
              </span>
              <input type="color" value={activeProfile.accent_color} onChange={(e) => updateActiveProfile({ accent_color: e.target.value })} className="h-12 w-full rounded-xl border border-slate-700/60 bg-slate-900/20" />
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-slate-700/60 bg-slate-900/25 px-4 py-4">
              <input type="checkbox" checked={activeProfile.show_cart_tabs} onChange={(e) => updateActiveProfile({ show_cart_tabs: e.target.checked })} />
              <span className="flex items-center text-sm text-slate-200">
                {tx(lang, '3 səbət tab-ı görünsün', 'Показывать 3 вкладки корзины', 'Show 3 cart tabs')}
                {hasOverride('show_cart_tabs') && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" title="Overridden" />}
              </span>
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
              const isRequired = REQUIRED_RIGHT_WIDGETS.includes(widgetKey as any);
              const isFixedFooter = FIXED_FOOTER_WIDGETS.includes(widgetKey as any);
              return (
                <div
                  key={widgetKey}
                  draggable={!isFixedFooter}
                  onDragStart={() => {
                    if (isFixedFooter) return;
                    setDraggingWidget(widgetKey);
                    setDropTargetWidget(widgetKey);
                  }}
                  onDragOver={(e) => {
                    if (isFixedFooter) return;
                    e.preventDefault();
                    if (draggingWidget && draggingWidget !== widgetKey) {
                      setDropTargetWidget(widgetKey);
                    }
                  }}
                  onDrop={(e) => {
                    if (isFixedFooter) return;
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
                  <Grip size={16} className={`${isFixedFooter ? 'cursor-not-allowed text-slate-700' : 'cursor-grab text-slate-500'}`} />
                  <div className="min-w-0 flex-1">
                    <div className={`font-medium ${hidden ? 'text-slate-500 line-through' : 'text-slate-100'}`}>{widgetLabel(widgetKey)}</div>
                    <div className="text-xs text-slate-500">{tx(lang, 'Sıra', 'Порядок', 'Order')}: {index + 1}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {isRequired && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
                          <Lock size={10} />
                          {tx(lang, 'Məcburi', 'Обязательный', 'Required')}
                        </span>
                      )}
                      {isFixedFooter && (
                        <span className="inline-flex items-center rounded-full border border-yellow-300/30 bg-yellow-400/10 px-2 py-0.5 text-[10px] font-semibold text-yellow-200">
                          {tx(lang, 'Checkout zonası', 'Checkout-зона', 'Checkout zone')}
                        </span>
                      )}
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={!hidden} onChange={() => toggleHidden(widgetKey)} disabled={isRequired} />
                    {tx(lang, 'Görünsün', 'Показывать', 'Visible')}
                  </label>
                  <select
                    value={activeProfile.widget_sizes?.[widgetKey] || 'comfortable'}
                    onChange={(e) => updateWidgetSize(widgetKey, e.target.value as 'compact' | 'comfortable' | 'expanded')}
                    className="rounded-lg border border-slate-700/60 bg-slate-950/70 px-2 py-2 text-xs text-slate-200"
                  >
                    {SIZE_OPTIONS.map((size) => (
                      <option key={size.key} value={size.key}>{sizeLabel(size.key)}</option>
                    ))}
                  </select>
                  <button onClick={() => moveWidget(widgetKey, -1)} className="neon-btn rounded-lg px-2 py-2" disabled={index === 0 || isFixedFooter}>
                    <ArrowUp size={14} />
                  </button>
                  <button onClick={() => moveWidget(widgetKey, 1)} className="neon-btn rounded-lg px-2 py-2" disabled={index === activeProfile.widget_order.length - 1 || isFixedFooter}>
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
                <span>{tx(lang, 'Canlı preview', 'Живой превью', 'Live preview')}</span>
                <span>{activeDevice} / {activeScope} / {activeProfile.preset}</span>
              </div>
              <div className="overflow-hidden rounded-[26px] border border-slate-700/60 bg-[radial-gradient(circle_at_top,#243244,#0d141e_65%)] p-3">
                {activeProfile.show_cart_tabs && (
                  <div className="mb-3 grid grid-cols-3 gap-2">
                    {[1, 2, 3].map((tab) => (
                      <div
                        key={`tab_${tab}`}
                        className={`rounded-xl px-2 py-2 text-center text-[10px] font-semibold ${tab === 1 ? 'text-slate-900' : 'border border-slate-700/60 bg-slate-900/35 text-slate-300'}`}
                        style={tab === 1 ? { backgroundColor: activeProfile.accent_color } : undefined}
                      >
                        {tx(lang, 'Səbət', 'Корзина', 'Cart')} {tab}
                      </div>
                    ))}
                  </div>
                )}

                <div 
                  className="grid gap-3" 
                  style={{ gridTemplateColumns: activeProfile.panel_ratio ? `${activeProfile.panel_ratio.split(':')[0]}fr ${activeProfile.panel_ratio.split(':')[1]}fr` : '50fr 50fr' }}
                >
                  <div className="rounded-2xl border border-slate-700/60 bg-slate-950/35 p-3">
                    <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">{tx(lang, 'Sol panel', 'Левая панель', 'Left panel')}</div>
                    <div className="space-y-2">
                      {visibleLeftWidgets.map((key) => {
                        const widgetOpts = activeProfile.widget_options?.[key] || {};
                        return (
                          <div
                            key={`live_left_${key}`}
                            className={`rounded-2xl border border-slate-700/60 bg-slate-900/35 text-slate-200 ${previewBlockClass(activeProfile.left_widget_sizes?.[key])}`}
                          >
                            <div className="mb-1 font-semibold opacity-90">{leftWidgetLabel(key)}</div>
                            {key === 'productGrid' && (
                              <div className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${activeProfile.product_columns}, minmax(0, 1fr))` }}>
                                {Array.from({ length: Math.min(activeProfile.product_columns * 2, 8) }).map((_, index) => (
                                  <div
                                    key={`product_tile_${index}`}
                                    className="flex flex-col gap-1 overflow-hidden rounded-xl text-slate-900"
                                    style={{ backgroundColor: activeProfile.accent_color }}
                                  >
                                    {widgetOpts.show_images !== false && <div className="h-8 bg-black/10" />}
                                    <div className="px-1.5 pb-1.5 text-[8px] font-bold leading-tight opacity-90">Kofe {index + 1}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {key === 'categories' && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {['İsti', 'Soyuq', 'Şirniyyat'].map(c => (
                                  <div key={c} className="rounded-full bg-slate-800 px-2 py-0.5 text-[8px]">{c}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-700/60 bg-slate-950/35 p-3">
                    <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">{tx(lang, 'Sağ panel', 'Правая панель', 'Right panel')}</div>
                    <div className="space-y-2">
                      {previewFloatingWidgets.map((key) => (
                        <div
                          key={`live_right_${key}`}
                          className={`rounded-2xl border border-slate-700/60 bg-slate-900/35 text-slate-200 ${previewBlockClass(activeProfile.widget_sizes?.[key])}`}
                        >
                          <div className="font-semibold opacity-90">{widgetLabel(key)}</div>
                          {key === 'cartItems' && (
                            <div className="mt-2 space-y-1">
                              {[1, 2].map(i => (
                                <div key={i} className="flex items-center justify-between rounded bg-slate-800/50 px-2 py-1 text-[9px]">
                                  <span>Məhsul {i}</span>
                                  <span className="font-mono text-[8px]">4.50 ₼</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      <div className="mt-3 border-t border-slate-700/60 pt-3">
                        <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-slate-500">{tx(lang, 'Checkout zonası', 'Checkout-зона', 'Checkout zone')}</div>
                        <div className="space-y-2">
                          {previewFooterWidgets.map((key) => (
                            <div
                              key={`live_footer_${key}`}
                              className={`rounded-2xl border border-slate-700/60 bg-slate-900/35 text-slate-200 ${previewBlockClass(activeProfile.widget_sizes?.[key])}`}
                            >
                              <div className="font-semibold opacity-90">{widgetLabel(key)}</div>
                              {key === 'cartSummary' && (
                                <div className="mt-1 flex items-end justify-between">
                                  <span className="text-[8px] opacity-70">Yekun</span>
                                  <span className="font-mono text-sm font-bold text-emerald-400">9.00 ₼</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded-2xl border border-slate-700/60 bg-slate-950/35 px-3 py-2 text-[10px] text-slate-300">
                    {tx(lang, 'Məhsul sütunu', 'Колонки', 'Columns')}: {activeProfile.product_columns}
                  </div>
                  <div className="rounded-2xl border border-slate-700/60 bg-slate-950/35 px-3 py-2 text-[10px] text-slate-300">
                    {tx(lang, 'Sıxlıq', 'Плотность', 'Density')}: {activeProfile.density}
                  </div>
                  <div className="rounded-2xl border border-slate-700/60 bg-slate-950/35 px-3 py-2 text-[10px] text-slate-300">
                    {tx(lang, 'Görünən blok', 'Видимых блоков', 'Visible blocks')}: {visibleWidgets.length + visibleLeftWidgets.length}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <button onClick={save} disabled={isSaving} className="neon-btn rounded-2xl px-4 py-3 font-semibold">
              {isSaving ? tx(lang, 'Yadda saxlanılır...', 'Сохраняется...', 'Saving...') : tx(lang, 'Draft Yadda Saxla', 'Сохранить draft', 'Save Draft')}
            </button>
            <button onClick={resetDraft} disabled={isSaving} className="neon-btn rounded-2xl px-4 py-3 font-semibold">
              {tx(lang, 'Draft-i Geri Qaytar', 'Сбросить draft', 'Reset Draft')}
            </button>
            <button onClick={publish} disabled={isSaving} className="glossy-gold rounded-2xl px-4 py-3 font-semibold">
              {tx(lang, 'Canlıya Tətbiq Et', 'Опубликовать', 'Publish Live')}
            </button>
          </div>
        </div>

        <div className="metal-panel p-5">
          <div className="mb-4 text-sm font-semibold text-slate-300">{tx(lang, 'Sol panel blokları', 'Блоки левой панели', 'Left panel blocks')}</div>
          <div className="mb-3 rounded-2xl border border-slate-700/60 bg-slate-950/35 px-4 py-3 text-xs text-slate-400">
            {tx(lang, 'Axtarış, kateqoriya və məhsul hissəsini də ayrıca düzün. Tablet-də daha sadə axın saxlaya bilərsiniz.', 'Отдельно настройте поиск, категории и товары. Для tablet можно оставить более простой поток.', 'Arrange search, categories, and product sections separately. You can keep a simpler flow for tablet.')}
          </div>
          <div className="space-y-3">
            {activeLeftWidgetOrder.map((widgetKey, index) => {
              const hidden = activeLeftHiddenWidgets.includes(widgetKey);
              const isDropTarget = dropTargetLeftWidget === widgetKey && draggingLeftWidget !== widgetKey;
              const isRequired = REQUIRED_LEFT_WIDGETS.includes(widgetKey as any);
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
                    {isRequired && (
                      <div className="mt-1">
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-200">
                          <Lock size={10} />
                          {tx(lang, 'Məcburi', 'Обязательный', 'Required')}
                        </span>
                      </div>
                    )}
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={!hidden} onChange={() => toggleLeftHidden(widgetKey)} disabled={isRequired} />
                    {tx(lang, 'Görünsün', 'Показывать', 'Visible')}
                  </label>
                  {widgetKey === 'productGrid' && (
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <input 
                        type="checkbox" 
                        checked={activeProfile.widget_options?.productGrid?.show_images !== false} 
                        onChange={(e) => updateActiveProfile({ 
                          widget_options: { 
                            ...(activeProfile.widget_options || {}), 
                            productGrid: { ...(activeProfile.widget_options?.productGrid || {}), show_images: e.target.checked } 
                          } 
                        })} 
                      />
                      {tx(lang, 'Şəkil', 'Фото', 'Images')}
                    </label>
                  )}
                  <select
                    value={activeProfile.left_widget_sizes?.[widgetKey] || 'comfortable'}
                    onChange={(e) => updateLeftWidgetSize(widgetKey, e.target.value as 'compact' | 'comfortable' | 'expanded')}
                    className="rounded-lg border border-slate-700/60 bg-slate-950/70 px-2 py-2 text-xs text-slate-200"
                  >
                    {SIZE_OPTIONS.map((size) => (
                      <option key={size.key} value={size.key}>{sizeLabel(size.key)}</option>
                    ))}
                  </select>
                  <button onClick={() => moveLeftWidget(widgetKey, -1)} className="neon-btn rounded-lg px-2 py-2" disabled={index === 0}>
                    <ArrowUp size={14} />
                  </button>
                  <button onClick={() => moveLeftWidget(widgetKey, 1)} className="neon-btn rounded-lg px-2 py-2" disabled={index === activeLeftWidgetOrder.length - 1}>
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

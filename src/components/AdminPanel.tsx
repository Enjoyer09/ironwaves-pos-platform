import React, { Suspense, lazy, startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { get_sales_summary, get_sales_summary_live, get_sales_list, get_sales_list_live, update_sale_amount_live, void_sale_with_reason_live, partial_refund_sale_live } from '../api/analytics';
import { get_menu_items_live, create_menu_item_live, reorder_menu_items_live, soft_delete_menu_item_live, update_menu_item_live, upload_menu_image_live } from '../api/menu';
import { get_logs_live } from '../api/logs';
import { apiRequest, isBackendEnabled } from '../api/client';
import { Decimal } from 'decimal.js';
import { GripVertical, Plus, Trash2, TrendingUp, ShoppingBag, DollarSign, Pencil, ChevronDown, ChevronUp, Printer } from 'lucide-react';
import { tx } from '../i18n';
import ConfirmModal from './ConfirmModal';
import { getDB } from '../lib/db_sim';
import { verifyLocalCredential } from '../lib/local_auth';
import { formatServerUtcDateTime, localDateInputValue, localDateTimeNextStart, localDateTimeStart } from '../lib/time';
import { prepareImageUploadFile } from '../lib/image_upload';
import { qzPrintHtml } from '../lib/qz';
import { buildSaleReceiptHtml } from '../lib/receipt_html';
import { get_settings_live, get_business_profile_live } from '../api/settings';

const FinancePanel = lazy(() => import('./admin/FinancePanel'));
const InventoryPanel = lazy(() => import('./admin/InventoryPanel'));
const DashboardPanel = lazy(() => import('./admin/DashboardPanel'));
const CRMPanel = lazy(() => import('./admin/CRMPanel'));
const CustomerAppPanel = lazy(() => import('./admin/CustomerAppPanel'));
const PosBuilderPanel = lazy(() => import('./admin/PosBuilderPanel'));
const LandingPanel = lazy(() => import('./admin/LandingPanel'));
const TablesHappyHourPanel = lazy(() => import('./admin/TablesHappyHourPanel'));
const RecipesPanel = lazy(() => import('./admin/RecipesPanel'));
const AIManagerPanel = lazy(() => import('./admin/AIManagerPanel'));
const SettingsPanel = lazy(() => import('./admin/SettingsPanel'));
const ZReportPanel = lazy(() => import('./admin/ZReportPanel'));
const LogsPanel = lazy(() => import('./admin/LogsPanel'));
const CombosPanel = lazy(() => import('./admin/CombosPanel'));
const DatabasePanel = lazy(() => import('./admin/DatabasePanel'));
const TenantsPanel = lazy(() => import('./admin/TenantsPanel'));
const FeedbackInboxPanel = lazy(() => import('./admin/FeedbackInboxPanel'));

type AdminTab = 'dashboard' | 'analytics' | 'menu' | 'tables' | 'finance' | 'inventory' | 'crm' | 'customerapp' | 'posbuilder' | 'landing' | 'recipes' | 'ai' | 'settings' | 'notes' | 'logs' | 'database' | 'zreport' | 'combos' | 'tenants';

interface AdminPanelProps {
  externalTab?: AdminTab;
  isActive?: boolean;
  onTabChange?: (tab: AdminTab) => void;
}

export default function AdminPanel({ externalTab, isActive = true, onTabChange }: AdminPanelProps) {
  const user = useAppStore((state) => state.user);
  const lang = useAppStore((state) => state.lang);
  const notify = useAppStore((state) => state.notify);
  const tenant_id = user?.tenant_id || 'tenant_default';
  const currentRole = String(user?.role || '').toLowerCase();

  const [activeTab, setActiveTab] = useState<AdminTab>(externalTab || 'dashboard');
  
  const [summary, setSummary] = useState<any>(null);
  const [sales, setSales] = useState<any[]>([]);
  const [menu, setMenu] = useState<any[]>([]);
  const [logsData, setLogsData] = useState<any[]>([]);

  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('Qəhvə');
  const [newItemDescription, setNewItemDescription] = useState('');
  const [newItemImageUrl, setNewItemImageUrl] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [menuSearch, setMenuSearch] = useState('');
  const [selectedMenuCategory, setSelectedMenuCategory] = useState('__all__');
  const [isAddingMenu, setIsAddingMenu] = useState(false);
  const [isReorderingMenu, setIsReorderingMenu] = useState(false);
  const [adminNote, setAdminNote] = useState('');
  const [notes, setNotes] = useState<Array<{ id: number; text: string; by?: string; created_at: string }>>([]);
  const [deleteMenuId, setDeleteMenuId] = useState<string | null>(null);
  const [editMenuModal, setEditMenuModal] = useState<null | { id: string; item_name: string; price: string; category: string; image_url: string }>(null);
  const [deleteNoteId, setDeleteNoteId] = useState<number | null>(null);
  const [editNoteId, setEditNoteId] = useState<number | null>(null);
  const [editNoteText, setEditNoteText] = useState('');
  const [draggingMenuId, setDraggingMenuId] = useState<string | null>(null);
  const [dropMenuId, setDropMenuId] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState(() => {
    return localDateInputValue();
  });
  const [dateTo, setDateTo] = useState(() => {
    return localDateInputValue();
  });
  const [saleActionModal, setSaleActionModal] = useState<null | { mode: 'void' | 'edit' | 'partial'; sale: any }>(null);
  const [saleReason, setSaleReason] = useState('');
  const [voidPreset, setVoidPreset] = useState<'TEST' | 'ZAY_MEHSUL'>('TEST');
  const [managerPass, setManagerPass] = useState('');
  const [newSaleTotal, setNewSaleTotal] = useState('');
  const [editSalePaymentMethod, setEditSalePaymentMethod] = useState<'Nəğd' | 'Kart' | 'Split'>('Nəğd');
  const [editSaleSplitCash, setEditSaleSplitCash] = useState('');
  const [editSaleSplitCard, setEditSaleSplitCard] = useState('');
  const [showRecentSales, setShowRecentSales] = useState(true);
  const fetchCacheRef = useRef<Record<string, number>>({});
  const fetchSeqRef = useRef(0);
  const fetchAbortRef = useRef<AbortController | null>(null);

  const setActiveTabSoft = (tab: AdminTab, syncParent = true) => {
    if (syncParent) {
      onTabChange?.(tab);
    }
    startTransition(() => {
      setActiveTab(tab);
    });
  };

  const normalizeEditPaymentMethod = (value: unknown): 'Nəğd' | 'Kart' | 'Split' => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw.includes('split')) return 'Split';
    if (raw.includes('kart') || raw.includes('card')) return 'Kart';
    return 'Nəğd';
  };
  const parseEditMoney = (value: unknown) => {
    const n = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  const formatEditMoney = (value: number) => Math.max(0, value).toFixed(2);
  const editSaleTotalNumber = parseEditMoney(newSaleTotal);

  const currentEditSalePaymentMethod = saleActionModal?.mode === 'edit'
    ? normalizeEditPaymentMethod(saleActionModal?.sale?.payment_method)
    : 'Nəğd';
  const currentEditSaleTotal = saleActionModal?.mode === 'edit'
    ? String(saleActionModal?.sale?.total || '')
    : '';
  const splitTotalMatches = editSalePaymentMethod !== 'Split'
    ? true
    : Math.abs((parseEditMoney(editSaleSplitCash) + parseEditMoney(editSaleSplitCard)) - editSaleTotalNumber) < 0.01;
  const splitAmountsValid = editSalePaymentMethod !== 'Split'
    ? true
    : editSaleTotalNumber > 0 &&
      parseEditMoney(editSaleSplitCash) >= 0 &&
      parseEditMoney(editSaleSplitCard) >= 0 &&
      parseEditMoney(editSaleSplitCash) + parseEditMoney(editSaleSplitCard) > 0 &&
      splitTotalMatches;
  const hasEditSaleChanges = saleActionModal?.mode === 'edit'
    ? (
      String(newSaleTotal || '').trim() !== String(currentEditSaleTotal || '').trim() ||
      editSalePaymentMethod !== currentEditSalePaymentMethod ||
      editSalePaymentMethod === 'Split'
    )
    : true;
  const canConfirmSaleAction =
    saleActionModal?.mode !== 'edit'
      ? Boolean(String(newSaleTotal || saleReason || voidPreset || '').trim() || saleActionModal?.mode === 'void')
      : editSaleTotalNumber > 0 && hasEditSaleChanges && splitAmountsValid;
  const mobileTabOptions: Array<{ key: AdminTab; label: string }> = useMemo(() => ([
    { key: 'dashboard', label: tx(lang, 'Dashboard', 'Дашборд', 'Dashboard') },
    { key: 'finance', label: tx(lang, 'Maliyyə', 'Финансы', 'Finance') },
    { key: 'analytics', label: tx(lang, 'Analitika', 'Аналитика', 'Analytics') },
    { key: 'zreport', label: tx(lang, 'Z-Hesabat', 'Z-Отчет', 'Z-Report') },
    { key: 'inventory', label: tx(lang, 'Anbar', 'Склад', 'Inventory') },
    { key: 'menu', label: tx(lang, 'Menyu', 'Меню', 'Menu') },
    { key: 'recipes', label: tx(lang, 'Resept', 'Рецепт', 'Recipes') },
    { key: 'logs', label: tx(lang, 'Loqlar', 'Логи', 'Logs') },
    { key: 'crm', label: tx(lang, 'CRM', 'CRM', 'CRM') },
    { key: 'customerapp', label: tx(lang, 'Customer App', 'Customer App', 'Customer App') },
    { key: 'posbuilder', label: tx(lang, 'POS Builder', 'POS Builder', 'POS Builder') },
    ...(currentRole === 'super_admin' ? [{ key: 'landing' as AdminTab, label: tx(lang, 'Landing', 'Landing', 'Landing') }] : []),
    { key: 'tables', label: tx(lang, 'Masalar / HH', 'Столы / HH', 'Tables / HH') },
    { key: 'notes', label: tx(lang, 'Qeydlər', 'Заметки', 'Notes') },
    { key: 'database', label: tx(lang, 'Baza', 'База', 'Database') },
    { key: 'settings', label: tx(lang, 'Ayarlar', 'Настройки', 'Settings') },
    { key: 'ai', label: tx(lang, 'AI Menecer', 'AI Менеджер', 'AI Manager') },
    { key: 'tenants', label: tx(lang, 'Tenantlər', 'Тенанты', 'Tenants') },
  ]), [lang, currentRole]);

  const saleStatusMeta = (status: any) => {
    const normalized = String(status || '').toUpperCase();
    if (normalized === 'VOIDED') {
      return {
        label: tx(lang, 'Ləğv edildi', 'Отменено', 'Voided'),
        className: 'bg-red-500/20 text-red-200 border-red-300/40',
      };
    }
    if (normalized === 'PARTIAL_REFUND') {
      return {
        label: tx(lang, 'Qismən qaytarma', 'Частичный возврат', 'Partial refund'),
        className: 'bg-amber-500/20 text-amber-200 border-amber-300/40',
      };
    }
    return {
      label: tx(lang, 'Tamamlandı', 'Завершено', 'Completed'),
      className: 'bg-emerald-500/20 text-emerald-200 border-emerald-300/40',
    };
  };

  const reprintSaleReceipt = async (sale: any) => {
    const receiptRef = String(sale?.receipt_code || sale?.id || '').trim();
    if (!receiptRef) {
      notify('error', tx(lang, 'Bu satış üçün receipt ID tapılmadı', 'Для этой продажи receipt ID не найден', 'Receipt ID was not found for this sale'));
      return;
    }
    const token = String(sale?.receipt_token || '').trim();

    try {
      const settings = await get_settings_live(tenant_id);
      const printSettings = settings?.print_settings || { use_qz: false, printer_name: '' };

      if (printSettings.use_qz) {
        notify('info', tx(lang, 'QZ Tray vasitəsilə çap edilir...', 'Печать через QZ Tray...', 'Printing via QZ Tray...'));
        const profile = await get_business_profile_live(tenant_id);
        
        const baseUrl = window.location.origin.replace(/\/+$/, '');
        const receiptUrl = `${baseUrl}/?r=${encodeURIComponent(receiptRef)}&t=${encodeURIComponent(token)}`;
        
        let feedbackUrl = '';
        const feedbackSettings = settings?.feedback_settings || {};
        if (feedbackSettings?.enabled !== false) {
          const feedbackBaseUrl = String(feedbackSettings?.portal_url || `${baseUrl}/feedback`).trim();
          try {
            const u = new URL(feedbackBaseUrl);
            u.pathname = '/feedback';
            u.searchParams.set('tenant_id', tenant_id);
            u.searchParams.set('sale_id', String(sale?.id || sale?.sale_id || ''));
            u.searchParams.set('receipt_id', String(receiptRef || ''));
            u.searchParams.set('r', String(receiptRef || ''));
            u.searchParams.set('t', String(token || ''));
            feedbackUrl = u.toString();
          } catch {
            feedbackUrl = feedbackBaseUrl;
          }
        }

        const html = await buildSaleReceiptHtml({
          sale,
          profile,
          lang: lang as any,
          receiptUrl,
          feedbackUrl,
          operator: String(sale?.cashier || ''),
        });

        await qzPrintHtml(html, printSettings.printer_name);
        notify('success', tx(lang, 'QZ ilə uğurla çap edildi', 'Успешно напечатано через QZ', 'Successfully printed via QZ'));
        return;
      }
    } catch (qzError) {
      console.error('QZ print failed, falling back to browser print:', qzError);
      notify('warning', tx(
        lang,
        'QZ Tray ilə çap alınmadı, brauzer çapına keçilir...',
        'Ошибка печати через QZ Tray, переключение на печать браузера...',
        'QZ Tray print failed, falling back to browser print...'
      ));
    }

    const url = new URL(window.location.origin);
    url.searchParams.set('r', receiptRef);
    if (token) url.searchParams.set('t', token);
    url.searchParams.set('autoprint', '1');
    url.searchParams.set('fresh', '1');
    try {
      const fallbackKey = `receipt_fallback:${receiptRef}:${token}`;
      const fallbackPayload = {
        id: sale?.id,
        tenant_id: sale?.tenant_id,
        created_at: sale?.created_at,
        cashier: sale?.cashier,
        customer_card_id: sale?.customer_card_id || null,
        payment_method: sale?.payment_method,
        split_cash: sale?.split_cash || null,
        split_card: sale?.split_card || null,
        order_type: sale?.order_type,
        total: sale?.total,
        original_total: sale?.original_total,
        discount_amount: sale?.discount_amount,
        items: Array.isArray(sale?.items) ? sale.items : [],
        status: sale?.status,
        receipt_html: String(sale?.receipt_html || ''),
      };
      sessionStorage.setItem(fallbackKey, JSON.stringify(fallbackPayload));
    } catch {
      // ignore fallback cache errors
    }
    const popup = window.open(url.toString(), '_blank', 'noopener,noreferrer');
    if (!popup) {
      notify('error', tx(lang, 'Receipt pəncərəsi açıla bilmədi', 'Не удалось открыть окно receipt', 'Could not open receipt window'));
    }
  };

  useEffect(() => {
    if (!isActive) return;
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    const seq = ++fetchSeqRef.current;
    void fetchData(seq, controller.signal).catch((error) => {
      const msg = String((error as any)?.message || '');
      if (msg.includes('sorğu ləğv edildi') || msg.toLowerCase().includes('abort')) return;
      notify('error', msg || tx(lang, 'Məlumatlar yenilənmədi', 'Данные не обновились', 'Data refresh failed'));
    });
    return () => {
      controller.abort();
    };
  }, [activeTab, dateFrom, dateTo, tenant_id, notify, lang, isActive]);

  useEffect(() => {
    return () => {
      fetchAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (activeTab !== 'notes') return;
    try {
      const list = JSON.parse(localStorage.getItem(`${tenant_id}_admin_notes`) || '[]');
      setNotes(Array.isArray(list) ? list : []);
    } catch {
      setNotes([]);
    }
  }, [activeTab, tenant_id]);

  useEffect(() => {
    if (externalTab && externalTab !== activeTab) {
      setActiveTabSoft(externalTab, false);
    }
  }, [externalTab, activeTab]);

  useEffect(() => {
    if (!isActive) return;
    const handleCatalogUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: string; tenant_id?: string }>).detail;
      if (detail?.tenant_id && detail.tenant_id !== tenant_id) return;
      const scope = String(detail?.scope || 'all').toLowerCase();
      if (scope !== 'menu' && scope !== 'all') return;
      if (activeTab !== 'menu') return;
      delete fetchCacheRef.current[`menu:${tenant_id}`];
      const seq = ++fetchSeqRef.current;
      void fetchData(seq);
    };
    window.addEventListener('catalog-updated', handleCatalogUpdated as EventListener);
    return () => {
      window.removeEventListener('catalog-updated', handleCatalogUpdated as EventListener);
    };
  }, [activeTab, isActive, tenant_id]);

  const fetchData = async (seq = ++fetchSeqRef.current, signal?: AbortSignal) => {
    if (signal?.aborted) return;
    const now = Date.now();

    if (activeTab === 'analytics') {
      const cacheKey = `analytics:${tenant_id}:${dateFrom}:${dateTo}`;
      if (fetchCacheRef.current[cacheKey] && now - fetchCacheRef.current[cacheKey] < 15000) {
        return;
      }
      const fromIso = localDateTimeStart(dateFrom);
      const toIso = localDateTimeNextStart(dateTo);
      const [summaryResult, salesResult] = await Promise.allSettled([
        get_sales_summary_live(tenant_id, fromIso, toIso, undefined, { signal }),
        get_sales_list_live(tenant_id, fromIso, toIso, undefined, { signal, limit: 300 }),
      ]);
      if (seq !== fetchSeqRef.current) return;
      if (summaryResult.status === 'fulfilled') {
        setSummary(summaryResult.value);
      } else {
        setSummary(get_sales_summary(tenant_id, fromIso, toIso));
      }
      if (salesResult.status === 'fulfilled') {
        setSales(salesResult.value);
      } else {
        setSales(get_sales_list(tenant_id, fromIso, toIso));
      }
      fetchCacheRef.current[cacheKey] = Date.now();
      return;
    }

    if (activeTab === 'menu') {
      const cacheKey = `menu:${tenant_id}`;
      if (fetchCacheRef.current[cacheKey] && now - fetchCacheRef.current[cacheKey] < 30000 && menu.length > 0) {
        return;
      }
      const nextMenu = await get_menu_items_live(tenant_id, undefined, undefined, { signal });
      if (seq !== fetchSeqRef.current) return;
      setMenu(nextMenu);
      fetchCacheRef.current[cacheKey] = Date.now();
      return;
    }

    if (activeTab === 'logs') {
      const cacheKey = `logs:${tenant_id}`;
      if (fetchCacheRef.current[cacheKey] && now - fetchCacheRef.current[cacheKey] < 15000 && logsData.length > 0) {
        return;
      }
      const nextLogs = await get_logs_live(tenant_id, 250, undefined, undefined, { signal });
      if (seq !== fetchSeqRef.current) return;
      setLogsData(nextLogs);
      fetchCacheRef.current[cacheKey] = Date.now();
    }
  };

  const handleAddMenu = async () => {
    if (!newItemName || !newItemPrice) return;
    const finalCategory = newItemCategory === '__custom__' ? customCategory.trim() : newItemCategory;
    if (!finalCategory) return;
    const created = await create_menu_item_live(tenant_id, {
      item_name: newItemName,
      price: new Decimal(newItemPrice),
      category: finalCategory,
      is_coffee: /q[eə]hv[əe]|coffee|kofe/i.test(finalCategory),
      description: newItemDescription.trim(),
      image_url: newItemImageUrl.trim(),
    }, user?.username);
    setMenu((prev) => {
      const next = [...prev.filter((item: any) => String(item.id) !== String(created?.id)), created];
      return next.sort((a: any, b: any) => Number(a?.sort_order ?? 0) - Number(b?.sort_order ?? 0));
    });
    setNewItemName('');
    setNewItemPrice('');
    setNewItemDescription('');
    setNewItemImageUrl('');
    setCustomCategory('');
    setSelectedMenuCategory(finalCategory);
    setIsAddingMenu(false);
    window.dispatchEvent(new CustomEvent('catalog-updated', { detail: { scope: 'menu' } }));
    delete fetchCacheRef.current[`menu:${tenant_id}`];
    const seq = ++fetchSeqRef.current;
    await fetchData(seq);
  };

  const handleDeleteMenu = async (id: string) => {
    await soft_delete_menu_item_live(tenant_id, id, user?.username || 'admin');
    setMenu((prev) => prev.filter((item: any) => String(item.id) !== String(id)));
    window.dispatchEvent(new CustomEvent('catalog-updated', { detail: { scope: 'menu' } }));
    delete fetchCacheRef.current[`menu:${tenant_id}`];
    const seq = ++fetchSeqRef.current;
    await fetchData(seq);
    setDeleteMenuId(null);
  };

  const handleEditMenu = async () => {
    if (!editMenuModal?.id) return;
    const nextName = String(editMenuModal.item_name || '').trim();
    const nextPrice = String(editMenuModal.price || '').trim();
    if (!nextName) {
      notify('error', tx(lang, 'Məhsul adı boş ola bilməz', 'Название товара не может быть пустым', 'Item name cannot be empty'));
      return;
    }
    if (!nextPrice || Number(nextPrice) <= 0) {
      notify('error', tx(lang, 'Qiymət düzgün deyil', 'Некорректная цена', 'Price is invalid'));
      return;
    }
    const nextCategory = String(editMenuModal.category || '').trim();
    if (!nextCategory) {
      notify('error', tx(lang, 'Kateqoriya boş ola bilməz', 'Категория не может быть пустой', 'Category cannot be empty'));
      return;
    }
    const updated = await update_menu_item_live(
      tenant_id,
      editMenuModal.id,
      { item_name: nextName, price: new Decimal(nextPrice), category: nextCategory, image_url: String(editMenuModal.image_url || '').trim() } as any,
      user?.username || 'admin',
    );
    setMenu((prev) => prev.map((item: any) => (
      String(item.id) === String(editMenuModal.id)
        ? { ...item, ...updated }
        : item
    )));
    window.dispatchEvent(new CustomEvent('catalog-updated', { detail: { scope: 'menu' } }));
    delete fetchCacheRef.current[`menu:${tenant_id}`];
    const seq = ++fetchSeqRef.current;
    await fetchData(seq);
    setEditMenuModal(null);
  };

  const handleEditMenuImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const prepared = await prepareImageUploadFile(file, {
        maxFileBytes: 2 * 1024 * 1024,
        maxDimension: 1280,
        outputQuality: 0.82,
      });
      const imageUrl = await upload_menu_image_live(prepared.file);
      setEditMenuModal((prev) => (prev ? { ...prev, image_url: imageUrl } : prev));
      notify('success', tx(lang, 'Şəkil yükləndi', 'Изображение загружено', 'Image uploaded'));
    } catch (error: any) {
      notify('error', error?.message || tx(lang, 'Şəkil yüklənmədi', 'Изображение не загрузилось', 'Image upload failed'));
    } finally {
      e.target.value = '';
    }
  };

  const handleMenuImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const prepared = await prepareImageUploadFile(file, {
        maxFileBytes: 2 * 1024 * 1024,
        maxDimension: 1280,
        outputQuality: 0.82,
      });
      const imageUrl = await upload_menu_image_live(prepared.file);
      setNewItemImageUrl(imageUrl);
      notify('success', tx(lang, 'Şəkil yükləndi', 'Изображение загружено', 'Image uploaded'));
    } catch (error: any) {
      notify('error', error?.message || tx(lang, 'Şəkil yüklənmədi', 'Изображение не загрузилось', 'Image upload failed'));
    } finally {
      e.target.value = '';
    }
  };

  const removeNote = (noteId: number) => {
    const next = notes.filter((n) => n.id !== noteId);
    setNotes(next);
    localStorage.setItem(`${tenant_id}_admin_notes`, JSON.stringify(next));
    setDeleteNoteId(null);
    notify('success', tx(lang, 'Qeyd silindi', 'Заметка удалена', 'Note deleted'));
  };

  const startEditNote = (n: { id: number; text: string }) => {
    setEditNoteId(n.id);
    setEditNoteText(n.text);
  };

  const saveEditNote = () => {
    if (!editNoteId) return;
    const trimmed = editNoteText.trim();
    if (!trimmed) {
      notify('error', tx(lang, 'Qeyd mətni boş ola bilməz', 'Текст заметки не может быть пустым', 'Note text cannot be empty'));
      return;
    }
    const next = notes.map((n) => (n.id === editNoteId ? { ...n, text: trimmed } : n));
    setNotes(next);
    localStorage.setItem(`${tenant_id}_admin_notes`, JSON.stringify(next));
    setEditNoteId(null);
    setEditNoteText('');
    notify('success', tx(lang, 'Qeyd yeniləndi', 'Заметка обновлена', 'Note updated'));
  };

  const verifyManagerOrAdminPass = async (pass: string) => {
    const normalized = String(pass || '').trim();
    if (!normalized) return false;

    if (isBackendEnabled()) {
      const result = await apiRequest<{ success: boolean }>('/api/v1/auth/verify-password', {
        method: 'POST',
        tenantId: null,
        body: { password: normalized },
      });
      return Boolean(result?.success);
    }

    const users = getDB<any>('users');
    const currentUser = users.find((u: any) =>
      u.tenant_id === tenant_id &&
      String(u.username || '').toLowerCase() === String(user?.username || '').toLowerCase() &&
      ['admin', 'manager', 'super_admin'].includes(String(u.role || '').toLowerCase()),
    );
    if (!currentUser) return false;
    return verifyLocalCredential(normalized, currentUser.password_hash || currentUser.password);
  };

  const menuCategoryOptions = useMemo(() => (
    Array.from(
      new Set(
        ['Qəhvə', 'Şirniyyat', 'Sular', ...menu.map((item: any) => String(item.category || '').trim()).filter(Boolean)],
      ),
    )
  ), [menu]);

  useEffect(() => {
    if (selectedMenuCategory !== '__all__' && !menuCategoryOptions.includes(selectedMenuCategory)) {
      setSelectedMenuCategory('__all__');
    }
  }, [menuCategoryOptions, selectedMenuCategory]);

  const filteredMenu = useMemo(() => (
    menu.filter((item: any) => {
      const q = menuSearch.trim().toLowerCase();
      const category = String(item.category || '').trim();
      if (selectedMenuCategory !== '__all__' && category !== selectedMenuCategory) return false;
      if (!q) return true;
      return `${item.item_name || ''} ${item.category || ''} ${item.description || ''}`.toLowerCase().includes(q);
    })
  ), [menu, menuSearch, selectedMenuCategory]);

  const moveMenuItem = (items: any[], sourceId: string, targetId: string) => {
    if (!sourceId || !targetId || sourceId === targetId) return items;
    const q = menuSearch.trim().toLowerCase();
    const matchesFilter = (item: any) => {
      const category = String(item.category || '').trim();
      if (selectedMenuCategory !== '__all__' && category !== selectedMenuCategory) return false;
      if (!q) return true;
      return `${item.item_name || ''} ${item.category || ''} ${item.description || ''}`.toLowerCase().includes(q);
    };
    const visibleItems = items.filter(matchesFilter);
    const sourceIndex = visibleItems.findIndex((item) => String(item.id) === sourceId);
    const targetIndex = visibleItems.findIndex((item) => String(item.id) === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return items;
    const nextVisible = [...visibleItems];
    const [moved] = nextVisible.splice(sourceIndex, 1);
    nextVisible.splice(targetIndex, 0, moved);
    const visibleIds = new Set(visibleItems.map((item) => String(item.id)));
    let cursor = 0;
    return items
      .map((item) => {
        if (!visibleIds.has(String(item.id))) return item;
        const replacement = nextVisible[cursor++];
        return replacement || item;
      })
      .map((item, index) => ({ ...item, sort_order: index }));
  };

  const handleMenuDrop = async (targetId: string) => {
    if (!draggingMenuId || draggingMenuId === targetId || isReorderingMenu) {
      setDraggingMenuId(null);
      setDropMenuId(null);
      return;
    }
    const nextMenu = moveMenuItem(menu, draggingMenuId, targetId);
    if (nextMenu === menu) {
      setDraggingMenuId(null);
      setDropMenuId(null);
      return;
    }
    setMenu(nextMenu);
    setDraggingMenuId(null);
    setDropMenuId(null);
    setIsReorderingMenu(true);
    try {
      await reorder_menu_items_live(tenant_id, nextMenu.map((item: any) => String(item.id)));
      window.dispatchEvent(new CustomEvent('catalog-updated', { detail: { scope: 'menu' } }));
      notify('success', tx(lang, 'Menyu sırası yeniləndi', 'Порядок меню обновлен', 'Menu order updated'));
    } catch (error: any) {
      notify('error', error?.message || tx(lang, 'Menyu sırası yenilənmədi', 'Порядок меню не обновился', 'Menu order update failed'));
      delete fetchCacheRef.current[`menu:${tenant_id}`];
      const seq = ++fetchSeqRef.current;
      await fetchData(seq);
    } finally {
      setIsReorderingMenu(false);
    }
  };

  const analyticsBreakdown = useMemo(() => {
    const validSales = sales.filter((s: any) => String(s.status || '').toUpperCase() !== 'VOIDED');
    const paymentNorm = (value: unknown) => String(value || '').trim().toLowerCase();

    let cashCount = 0;
    let cardCount = 0;
    let discountedCount = 0;
    let staffPaymentCount = 0;
    let salesWithCogs = 0;
    const staffMap = new Map<string, number>();

    validSales.forEach((sale: any) => {
      const method = paymentNorm(sale.payment_method);
      const cashier = String(sale.cashier || '').trim() || '-';
      const discount = Number(sale.discount_amount || 0);
      const cogs = Number(sale.cogs || 0);

      if (method.includes('kart') || method.includes('card')) cardCount += 1;
      if (method.includes('nəğd') || method.includes('cash')) cashCount += 1;
      if (method.includes('staff')) staffPaymentCount += 1;
      if (discount > 0) discountedCount += 1;
      if (cogs > 0) salesWithCogs += 1;

      staffMap.set(cashier, (staffMap.get(cashier) || 0) + 1);
    });

    const topStaff = Array.from(staffMap.entries()).sort((a, b) => b[1] - a[1])[0];
    const cogsCoverage = validSales.length > 0 ? Math.round((salesWithCogs / validSales.length) * 100) : 0;
    const grossProfit = Number(summary?.gross_profit || 0);
    const profitReliability = cogsCoverage >= 90 ? 'high' : cogsCoverage >= 60 ? 'medium' : 'low';

    return {
      validSalesCount: validSales.length,
      cashCount,
      cardCount,
      discountedCount,
      staffPaymentCount,
      topStaffName: topStaff?.[0] || '-',
      topStaffSales: topStaff?.[1] || 0,
      cogsCoverage,
      grossProfit,
      profitReliability,
    };
  }, [sales, summary]);

  return (
    <div className="compact-shell h-full overflow-hidden p-3 text-slate-100 md:p-6">
      <ConfirmModal
        open={Boolean(deleteMenuId)}
        lang={lang}
        title={tx(lang, 'Məhsulu deaktiv et', 'Деактивировать продукт')}
        message={tx(lang, 'Bu məhsul silinməyəcək, yalnız deaktiv olunacaq.', 'Продукт не удалится, только деактивируется.')}
        onCancel={() => setDeleteMenuId(null)}
        onConfirm={() => {
          if (!deleteMenuId) return;
          void handleDeleteMenu(deleteMenuId);
        }}
      />
      <ConfirmModal
        open={Boolean(deleteNoteId)}
        lang={lang}
        title={tx(lang, 'Qeydi sil', 'Удалить заметку', 'Delete note')}
        message={tx(lang, 'Bu qeyd geri qaytarılmadan silinəcək.', 'Эта заметка будет удалена без возможности восстановления.', 'This note will be permanently deleted.')}
        onCancel={() => setDeleteNoteId(null)}
        onConfirm={() => deleteNoteId && removeNote(deleteNoteId)}
      />
      <div className="compact-panel h-full overflow-y-auto metal-panel p-4 md:p-6">
        <div className="mb-4 md:hidden">
          <select
            className="neon-input min-h-13"
            value={activeTab}
            onChange={(e) => setActiveTabSoft(e.target.value as AdminTab)}
          >
            {mobileTabOptions.map((tab) => (
              <option key={tab.key} value={tab.key}>{tab.label}</option>
            ))}
          </select>
        </div>
        
        <Suspense fallback={<div className="rounded-2xl border border-slate-700/60 bg-slate-900/30 p-6 text-sm text-slate-300">{tx(lang, 'Panel yüklənir...', 'Панель загружается...', 'Loading panel...')}</div>}>
        {activeTab === 'dashboard' && <DashboardPanel onOpenTab={setActiveTabSoft} />}

        {activeTab === 'analytics' && (
          <div>
            <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                  <h1 className="text-3xl font-bold">{tx(lang, 'İdarəetmə Paneli', 'Панель управления')}</h1>
                  <p className="text-slate-300 mt-1">{tx(lang, 'Seçilmiş tarix aralığına görə statistika', 'Статистика за выбранный период', 'Statistics for the selected date range')}</p>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="neon-input min-h-13" />
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="neon-input min-h-13" />
              </div>
            </div>

            {/* Summary Cards */}
            {summary && (
              <div className="mb-8 space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="metal-panel p-6 flex items-center">
                  <div className="w-14 h-14 bg-green-400/20 text-green-200 rounded-2xl flex items-center justify-center mr-4 border border-green-300/30">
                    <DollarSign size={28} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-300">{tx(lang, 'Ümumi Gəlir', 'Общая выручка', 'Total Revenue')}</p>
                    <h3 className="text-2xl font-bold text-slate-100">{parseFloat(summary.total_revenue).toFixed(2)} ₼</h3>
                  </div>
                </div>
                <div className="metal-panel p-6 flex items-center">
                  <div className="w-14 h-14 bg-blue-400/20 text-blue-200 rounded-2xl flex items-center justify-center mr-4 border border-blue-300/30">
                    <ShoppingBag size={28} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-300">{tx(lang, 'Satış Sayı', 'Количество продаж', 'Sales Count')}</p>
                    <h3 className="text-2xl font-bold text-slate-100">{analyticsBreakdown.validSalesCount}</h3>
                  </div>
                </div>
                <div className="metal-panel p-6 flex items-center">
                  <div className="w-14 h-14 bg-purple-400/20 text-purple-200 rounded-2xl flex items-center justify-center mr-4 border border-purple-300/30">
                    <TrendingUp size={28} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-300">{tx(lang, 'Mənfəət (təxmini)', 'Прибыль (приблизительно)', 'Profit (estimated)')}</p>
                    <h3 className="text-2xl font-bold text-slate-100">{parseFloat(summary.gross_profit).toFixed(2)} ₼</h3>
                    <div className={`mt-1 text-xs ${
                      analyticsBreakdown.profitReliability === 'high'
                        ? 'text-emerald-300'
                        : analyticsBreakdown.profitReliability === 'medium'
                          ? 'text-amber-300'
                          : 'text-rose-300'
                    }`}>
                      {tx(lang, 'COGS doluluğu', 'Покрытие COGS', 'COGS coverage')}: {analyticsBreakdown.cogsCoverage}%
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
                <div className="metal-panel p-4">
                  <div className="text-xs text-slate-400">{tx(lang, 'Nağd satış sayı', 'Продажи наличными', 'Cash sales count')}</div>
                  <div className="mt-1 text-2xl font-bold text-emerald-300">{analyticsBreakdown.cashCount}</div>
                </div>
                <div className="metal-panel p-4">
                  <div className="text-xs text-slate-400">{tx(lang, 'Kart satış sayı', 'Продажи по карте', 'Card sales count')}</div>
                  <div className="mt-1 text-2xl font-bold text-sky-300">{analyticsBreakdown.cardCount}</div>
                </div>
                <div className="metal-panel p-4">
                  <div className="text-xs text-slate-400">{tx(lang, 'Endirimli satış sayı', 'Продажи со скидкой', 'Discounted sales count')}</div>
                  <div className="mt-1 text-2xl font-bold text-amber-300">{analyticsBreakdown.discountedCount}</div>
                </div>
                <div className="metal-panel p-4">
                  <div className="text-xs text-slate-400">{tx(lang, 'Staff ödənişi sayı', 'Продажи Staff', 'Staff payment sales')}</div>
                  <div className="mt-1 text-2xl font-bold text-fuchsia-300">{analyticsBreakdown.staffPaymentCount}</div>
                </div>
                <div className="metal-panel p-4">
                  <div className="text-xs text-slate-400">{tx(lang, 'Top staff', 'Топ сотрудник', 'Top staff')}</div>
                  <div className="mt-1 text-sm font-semibold text-slate-100">{analyticsBreakdown.topStaffName}</div>
                  <div className="text-xl font-bold text-cyan-300">{analyticsBreakdown.topStaffSales}</div>
                </div>
              </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-8">
              {/* Son Satışlar Cədvəli */}
              <div className="metal-panel overflow-hidden">
                <div className="flex items-center justify-between gap-3 p-6 border-b border-slate-700/70">
                  <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Son Satışlar', 'Последние продажи', 'Recent Sales')}</h2>
                  <button
                    type="button"
                    onClick={() => setShowRecentSales((prev) => !prev)}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-600/70 bg-slate-800/70 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700/80"
                  >
                    {showRecentSales
                      ? tx(lang, 'Yığ', 'Свернуть', 'Collapse')
                      : tx(lang, 'Aç', 'Открыть', 'Expand')}
                    {showRecentSales ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>
                {showRecentSales && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-900/40 text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      <tr>
                         <th className="px-6 py-4">{tx(lang, 'Tarix/Saat', 'Дата/время', 'Date/Time')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Satan (Staff)', 'Продавец (персонал)', 'Cashier')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Müştəri QR', 'QR клиента', 'Customer QR')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Sifariş', 'Заказ', 'Order')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Ulduz', 'Звезды', 'Stars')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Məbləğ / Endirim', 'Сумма / скидка', 'Amount / Discount')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Yekun Məbləğ', 'Итоговая сумма', 'Final Total')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Komissiya', 'Комиссия', 'Fee')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Üsul', 'Метод', 'Method')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Status', 'Статус', 'Status')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Əməliyyat', 'Действие', 'Action')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/60">
                      {sales.map((s, i) => (
                        <tr key={i}>
                           <td className="px-6 py-4 text-sm text-slate-300">{formatServerUtcDateTime(s.created_at, lang)}</td>
                          <td className="px-6 py-4 text-sm font-medium text-slate-100">{s.cashier}</td>
                          <td className="px-6 py-4 text-sm text-blue-500 font-mono">{s.customer_card_id || '-'}</td>
                          <td className="px-6 py-4 text-sm text-slate-300 max-w-xs truncate">{s.items_display || '-'}</td>
                          <td className="px-6 py-4 text-sm font-semibold text-amber-500">{s.current_stars || 0} ⭐</td>
                          <td className="px-6 py-4 text-sm text-slate-300">
                            {parseFloat(s.original_total).toFixed(2)} ₼ 
                            {parseFloat(s.discount_amount) > 0 && <span className="text-red-300 ml-2">(-{parseFloat(s.discount_amount).toFixed(2)} ₼)</span>}
                          </td>
                           <td className="px-6 py-4 text-sm font-bold text-slate-100">{parseFloat(s.total).toFixed(2)} ₼</td>
                           <td className="px-6 py-4 text-sm text-slate-300">{parseFloat((s.bank_fee || '0')).toFixed(2)} ₼</td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full border ${s.payment_method === 'Kart' ? 'bg-blue-400/20 text-blue-200 border-blue-300/40' : 'bg-green-400/20 text-green-200 border-green-300/40'}`}>
                              {s.payment_method}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            {(() => {
                              const statusMeta = saleStatusMeta(s.status);
                              return (
                                <span className={`px-2 py-1 text-xs font-semibold rounded-full border ${statusMeta.className}`}>
                                  {statusMeta.label}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex gap-2">
                              <button
                                className="neon-btn rounded-lg px-2 py-1 text-[11px]"
                                disabled={s.status === 'VOIDED'}
                                title={tx(lang, 'Satışı tam ləğv edir (VOID). Audit səbəbi daxil edilməlidir.', 'Полностью отменяет продажу (VOID). Нужно указать причину для аудита.', 'Voids the sale completely. Audit reason is required.')}
                                onClick={() => {
                                  setSaleActionModal({ mode: 'void', sale: s });
                                  setSaleReason('');
                                  setVoidPreset('TEST');
                                  setManagerPass('');
                                  setNewSaleTotal('');
                                }}
                              >
                                VOID
                              </button>
                              <button
                                className="rounded-lg border border-amber-300/40 bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-100"
                                disabled={s.status === 'VOIDED'}
                                title={tx(lang, 'Satışdan qismən qaytarma (partial refund) tətbiq edir.', 'Применяет частичный возврат по продаже.', 'Applies partial refund on the sale.')}
                                onClick={() => {
                                  setSaleActionModal({ mode: 'partial', sale: s });
                                  setSaleReason('');
                                  setManagerPass('');
                                  setNewSaleTotal('');
                                }}
                              >
                                {tx(lang, 'Partial', 'Частично', 'Partial')}
                              </button>
                              <button
                                className="rounded-lg border border-cyan-300/40 bg-cyan-500/15 px-2 py-1 text-[11px] font-semibold text-cyan-100"
                                title={tx(lang, 'Çeki yenidən açır və çap pəncərəsini başladır.', 'Открывает чек заново и запускает печать.', 'Reopens the receipt and starts printing.')}
                                onClick={() => reprintSaleReceipt(s)}
                              >
                                <span className="inline-flex items-center gap-1">
                                  <Printer size={12} />
                                  {tx(lang, 'Çap', 'Печать', 'Print')}
                                </span>
                              </button>
                              <button
                                className="glossy-gold rounded-lg px-2 py-1 text-[11px] font-semibold"
                                disabled={s.status === 'VOIDED'}
                                title={tx(lang, 'Satış məbləğini menecer təsdiqi ilə düzəldir.', 'Корректирует сумму продажи с подтверждением менеджера.', 'Adjusts sale amount with manager approval.')}
                                onClick={() => {
                                  setSaleActionModal({ mode: 'edit', sale: s });
                                  setSaleReason('');
                                  setManagerPass('');
                                  setNewSaleTotal(String(s.total || ''));
                                  setEditSalePaymentMethod(String(s.payment_method || '').toLowerCase().includes('kart') ? 'Kart' : String(s.payment_method || '').toLowerCase().includes('split') ? 'Split' : 'Nəğd');
                                  setEditSaleSplitCash(String(s.payment_method || '').toLowerCase().includes('kart') ? '0' : String(s.total || ''));
                                  setEditSaleSplitCard(String(s.payment_method || '').toLowerCase().includes('kart') ? String(s.total || '') : '0');
                                }}
                              >
                                {tx(lang, 'Düzəlt', 'Исправить')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {sales.length === 0 && (
                         <tr><td colSpan={11} className="px-6 py-8 text-center text-slate-500">{tx(lang, 'Heç bir satış tapılmadı', 'Продажи не найдены', 'No sales found')}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                )}
              </div>

              <FeedbackInboxPanel tenantId={tenant_id} dateFrom={dateFrom} dateTo={dateTo} lang={lang} />

              {saleActionModal && (
                <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4">
                  <div className="metal-panel w-full max-w-md p-5">
                    <h3 className="text-lg font-bold text-slate-100">
                      {saleActionModal.mode === 'void'
                        ? tx(lang, 'Satışı VOID et', 'Сделать продажу VOID')
                        : saleActionModal.mode === 'partial'
                          ? tx(lang, 'Partial refund et', 'Сделать частичный возврат', 'Apply partial refund')
                          : tx(lang, 'Satışı düzəlt', 'Исправить продажу')}
                    </h3>
                    <div className="mt-2 text-xs text-slate-300">ID: {saleActionModal.sale.id}</div>
                    <div className="mt-3 space-y-2">
                      {saleActionModal.mode === 'void' && (
                        <select
                          className="neon-input"
                          value={voidPreset}
                          onChange={(e) => setVoidPreset(e.target.value as 'TEST' | 'ZAY_MEHSUL')}
                        >
                          <option value="TEST">TEST</option>
                          <option value="ZAY_MEHSUL">{tx(lang, 'ZAY MƏHSUL', 'БРАКОВАННЫЙ ТОВАР', 'DAMAGED PRODUCT')}</option>
                        </select>
                      )}
                      <input
                        className="neon-input"
                        placeholder={tx(lang, 'Əlavə qeyd (istəyə bağlı)', 'Доп. заметка (необязательно)', 'Extra note (optional)')}
                        value={saleReason}
                        onChange={(e) => setSaleReason(e.target.value)}
                      />
                      <input className="neon-input" type="password" placeholder={tx(lang, 'Admin/Manager şifrəsi', 'Пароль админа/менеджера')} value={managerPass} onChange={(e) => setManagerPass(e.target.value)} />
                      {saleActionModal.mode === 'edit' && (
                        <>
                          <input
                            className="neon-input"
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder={tx(lang, 'Yeni total', 'Новый итог')}
                            value={newSaleTotal}
                            onChange={(e) => {
                              const value = e.target.value;
                              setNewSaleTotal(value);
                              if (editSalePaymentMethod === 'Split') {
                                const total = parseEditMoney(value);
                                const cash = Math.min(parseEditMoney(editSaleSplitCash), total);
                                setEditSaleSplitCash(formatEditMoney(cash));
                                setEditSaleSplitCard(formatEditMoney(total - cash));
                              }
                            }}
                          />
                          <select
                            className="neon-input"
                            value={editSalePaymentMethod}
                            onChange={(e) => {
                              const nextMethod = e.target.value as 'Nəğd' | 'Kart' | 'Split';
                              setEditSalePaymentMethod(nextMethod);
                              const total = parseEditMoney(newSaleTotal);
                              if (nextMethod === 'Split') {
                                const currentCash = parseEditMoney(editSaleSplitCash);
                                const currentCard = parseEditMoney(editSaleSplitCard);
                                if (currentCash <= 0 && currentCard <= 0) {
                                  setEditSaleSplitCash(formatEditMoney(total));
                                  setEditSaleSplitCard('0.00');
                                } else {
                                  const cash = Math.min(currentCash, total);
                                  setEditSaleSplitCash(formatEditMoney(cash));
                                  setEditSaleSplitCard(formatEditMoney(total - cash));
                                }
                              } else if (nextMethod === 'Kart') {
                                setEditSaleSplitCash('0.00');
                                setEditSaleSplitCard(formatEditMoney(total));
                              } else {
                                setEditSaleSplitCash(formatEditMoney(total));
                                setEditSaleSplitCard('0.00');
                              }
                            }}
                          >
                            <option value="Nəğd">{tx(lang, 'Nağd', 'Наличные', 'Cash')}</option>
                            <option value="Kart">{tx(lang, 'Kart', 'Карта', 'Card')}</option>
                            <option value="Split">{tx(lang, 'Bölünmüş ödəniş', 'Раздельная оплата', 'Split')}</option>
                          </select>
                          {editSalePaymentMethod === 'Split' && (
                            <div className="grid grid-cols-2 gap-2">
                              <label className="space-y-1">
                                <span className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-200">
                                  {tx(lang, 'Nağd hissə', 'Наличные', 'Cash part')}
                                </span>
                                <input
                                  className="neon-input"
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  placeholder={tx(lang, 'Nağd məbləğ', 'Сумма наличными', 'Cash amount')}
                                  value={editSaleSplitCash}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    const total = parseEditMoney(newSaleTotal);
                                    const cash = Math.min(parseEditMoney(value), total);
                                    setEditSaleSplitCash(value);
                                    setEditSaleSplitCard(formatEditMoney(total - cash));
                                  }}
                                />
                              </label>
                              <label className="space-y-1">
                                <span className="text-xs font-bold uppercase tracking-[0.14em] text-sky-200">
                                  {tx(lang, 'Kart hissə', 'Карта', 'Card part')}
                                </span>
                                <input
                                  className="neon-input"
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  placeholder={tx(lang, 'Kart məbləği', 'Сумма картой', 'Card amount')}
                                  value={editSaleSplitCard}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    const total = parseEditMoney(newSaleTotal);
                                    const card = Math.min(parseEditMoney(value), total);
                                    setEditSaleSplitCard(value);
                                    setEditSaleSplitCash(formatEditMoney(total - card));
                                  }}
                                />
                              </label>
                            </div>
                          )}
                          {editSalePaymentMethod === 'Split' && (
                            <div className="rounded-xl border border-slate-600/60 bg-slate-950/40 px-3 py-2 text-xs text-slate-300">
                              {tx(lang, 'Soldakı nağd, sağdakı kartdır. Birini dəyişəndə digəri avtomatik qalıq olur.', 'Слева наличные, справа карта. При изменении одного второе пересчитывается автоматически.', 'Left is cash, right is card. Changing one recalculates the other automatically.')}
                            </div>
                          )}
                          {editSalePaymentMethod === 'Split' && !splitTotalMatches && (
                            <div className="rounded-xl border border-amber-300/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                              {tx(lang, 'Split cəmi satış yekununa bərabər olmalıdır.', 'Сумма split должна равняться итогу продажи.', 'Split total must equal sale total.')}
                            </div>
                          )}
                        </>
                      )}
                      {saleActionModal.mode === 'partial' && (
                        <input className="neon-input" type="number" placeholder={tx(lang, 'Refund məbləği', 'Сумма возврата', 'Refund amount')} value={newSaleTotal} onChange={(e) => setNewSaleTotal(e.target.value)} />
                      )}
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                      <button className="neon-btn rounded-lg px-4 py-2" onClick={() => setSaleActionModal(null)}>
                        {tx(lang, 'Ləğv et', 'Отмена')}
                      </button>
                      <button
                        className="glossy-gold rounded-lg px-4 py-2 font-semibold"
                        disabled={!canConfirmSaleAction}
                        onClick={async () => {
                          if (!managerPass) {
                            notify('error', tx(lang, 'Admin şifrəsini daxil edin', 'Введите пароль администратора', 'Enter admin password'));
                            return;
                          }
                          if (!(await verifyManagerOrAdminPass(managerPass))) {
                            notify('error', tx(lang, 'Şifrə yanlışdır', 'Неверный пароль'));
                            return;
                          }
                          try {
                            if (saleActionModal.mode === 'void') {
                              const presetReason = voidPreset === 'TEST' ? 'TEST' : 'ZAY MƏHSUL';
                              const finalReason = saleReason?.trim()
                                ? `${presetReason}: ${saleReason.trim()}`
                                : presetReason;
                              const returnToStock = voidPreset === 'TEST';
                              await void_sale_with_reason_live(tenant_id, saleActionModal.sale.id, finalReason, user?.username || 'admin', returnToStock);
                              notify('success', tx(lang, 'Satış VOID edildi', 'Продажа VOID выполнена'));
                            } else if (saleActionModal.mode === 'edit') {
                              if (!newSaleTotal) return;
                              await update_sale_amount_live(
                                tenant_id,
                                saleActionModal.sale.id,
                                newSaleTotal,
                                saleReason,
                                user?.username || 'admin',
                                editSalePaymentMethod,
                                editSalePaymentMethod === 'Split' ? editSaleSplitCash : undefined,
                                editSalePaymentMethod === 'Split' ? editSaleSplitCard : undefined,
                              );
                              notify('success', tx(lang, 'Satış düzəlişi tətbiq olundu', 'Изменение продажи применено'));
                            } else {
                              if (!newSaleTotal) return;
                              await partial_refund_sale_live(
                                tenant_id,
                                saleActionModal.sale.id,
                                newSaleTotal,
                                saleReason || tx(lang, 'Partial refund', 'Частичный возврат', 'Partial refund'),
                                user?.username || 'admin',
                              );
                              notify('success', tx(lang, 'Partial refund tətbiq olundu', 'Частичный возврат применен', 'Partial refund applied'));
                            }
                            setSaleActionModal(null);
                            const seq = ++fetchSeqRef.current;
                            await fetchData(seq);
                          } catch (e: any) {
                            notify('error', e.message);
                          }
                        }}
                      >
                        {tx(lang, 'Təsdiqlə', 'Подтвердить')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'menu' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-slate-100">{tx(lang, 'Menyu İdarəetməsi', 'Управление меню', 'Menu Management')}</h2>
              <div className="flex gap-2">
                <input
                  className="neon-input"
                  placeholder={tx(lang, 'Menyuda axtarış...', 'Поиск по меню...', 'Search menu...')}
                  value={menuSearch}
                  onChange={(e) => setMenuSearch(e.target.value)}
                />
                <button
                  onClick={() => {
                    if (selectedMenuCategory !== '__all__') {
                      setNewItemCategory(selectedMenuCategory);
                      setCustomCategory('');
                    }
                    setIsAddingMenu((prev) => !prev);
                  }}
                  className="neon-btn px-4 py-2 rounded-lg flex items-center gap-2"
                >
                  <Plus size={18} />
                  {tx(lang, 'Məhsul Əlavə Et', 'Добавить товар', 'Add item')}
                </button>
              </div>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setSelectedMenuCategory('__all__')}
                className={`shrink-0 rounded-xl px-4 py-2 text-sm font-bold transition ${
                  selectedMenuCategory === '__all__'
                    ? 'glossy-gold text-slate-950'
                    : 'border border-slate-600 bg-slate-900/70 text-slate-200 hover:border-yellow-300/60'
                }`}
              >
                {tx(lang, 'Bütün kateqoriyalar', 'Все категории', 'All categories')}
              </button>
              {menuCategoryOptions.map((category) => {
                const count = menu.filter((item: any) => String(item.category || '').trim() === category).length;
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() => {
                      setSelectedMenuCategory(category);
                      setNewItemCategory(category);
                      setCustomCategory('');
                    }}
                    className={`shrink-0 rounded-xl px-4 py-2 text-sm font-bold transition ${
                      selectedMenuCategory === category
                        ? 'glossy-gold text-slate-950'
                        : 'border border-slate-600 bg-slate-900/70 text-slate-200 hover:border-yellow-300/60'
                    }`}
                  >
                    {category}
                    <span className="ml-2 text-xs opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>

            {isAddingMenu && (
              <div className="metal-panel p-6 grid grid-cols-1 md:grid-cols-7 gap-4">
                <input type="text" placeholder={tx(lang, 'Ad', 'Название', 'Name')} value={newItemName} onChange={e => setNewItemName(e.target.value)} className="neon-input md:col-span-2"/>
                <input type="number" placeholder={tx(lang, 'Qiymət', 'Цена', 'Price')} value={newItemPrice} onChange={e => setNewItemPrice(e.target.value)} className="neon-input"/>
                <select value={newItemCategory} onChange={e => setNewItemCategory(e.target.value)} className="neon-input">
                  {menuCategoryOptions.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                  <option value="__custom__">{tx(lang, 'Yeni kateqoriya...', 'Новая категория...', 'New category...')}</option>
                </select>
                {newItemCategory === '__custom__' && (
                  <input
                    type="text"
                    placeholder={tx(lang, 'Kateqoriya adı', 'Название категории', 'Category name')}
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    className="neon-input"
                  />
                )}
                <input type="text" placeholder={tx(lang, 'Şəkil linki', 'Ссылка на изображение', 'Image URL')} value={newItemImageUrl} onChange={e => setNewItemImageUrl(e.target.value)} className="neon-input md:col-span-2"/>
                <input type="file" accept="image/*" onChange={handleMenuImageUpload} className="neon-input md:col-span-2"/>
                <input type="text" placeholder={tx(lang, 'Qısa təsvir', 'Краткое описание', 'Short description')} value={newItemDescription} onChange={e => setNewItemDescription(e.target.value)} className="neon-input md:col-span-2"/>
                <button
                  onClick={() => { void handleAddMenu(); }}
                  disabled={!newItemName.trim() || !newItemPrice || (newItemCategory === '__custom__' && !customCategory.trim())}
                  className="glossy-gold px-4 py-2 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  title={tx(lang, 'Yeni menyu məhsulu yaradır.', 'Создает новую позицию меню.', 'Creates a new menu item.')}
                  data-guide={tx(lang, 'Yeni menyu məhsulu yaradır.', 'Создает новую позицию меню.', 'Creates a new menu item.')}
                >
                  {tx(lang, 'Məhsulu Yarat', 'Создать товар', 'Create Item')}
                </button>
              </div>
            )}

            <div className="metal-panel rounded-xl p-6">
              <div className="mb-3 flex items-center justify-between gap-3 text-xs text-slate-400">
                <span>
                  {tx(lang, 'Kateqoriyanı yuxarıdan seçin. Sıralamanı dəyişmək üçün məhsulu sürüşdürün.', 'Выберите категорию сверху. Перетащите товар, чтобы изменить порядок.', 'Choose a category above. Drag an item to change its order.')}
                  {' '}
                  <span className="text-slate-500">
                    {filteredMenu.length} {tx(lang, 'məhsul', 'товаров', 'items')}
                  </span>
                </span>
                {isReorderingMenu && <span className="text-amber-300">{tx(lang, 'Sıra yazılır...', 'Порядок сохраняется...', 'Saving order...')}</span>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-slate-300 border-b border-slate-700/70">
                      <th className="pb-3 w-12">{tx(lang, 'Sıra', 'Порядок', 'Order')}</th>
                      <th className="pb-3">{tx(lang, 'Məhsul', 'Товар', 'Item')}</th>
                      <th className="pb-3">{tx(lang, 'Kateqoriya', 'Категория', 'Category')}</th>
                      <th className="pb-3">{tx(lang, 'Qiymət', 'Цена', 'Price')}</th>
                      <th className="pb-3">{tx(lang, 'Təsvir', 'Описание', 'Description')}</th>
                      <th className="pb-3">{tx(lang, 'Əməliyyat', 'Операция', 'Action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMenu.map((item) => (
                      <tr
                        key={item.id}
                        className={`border-b border-slate-700/60 ${dropMenuId === item.id && draggingMenuId !== item.id ? 'bg-cyan-400/5' : ''} ${draggingMenuId === item.id ? 'opacity-60' : ''}`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (draggingMenuId && draggingMenuId !== item.id) setDropMenuId(item.id);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          void handleMenuDrop(String(item.id));
                        }}
                      >
                        <td className="py-3">
                          <button
                            type="button"
                            draggable={!isReorderingMenu}
                            onDragStart={() => {
                              setDraggingMenuId(String(item.id));
                              setDropMenuId(String(item.id));
                            }}
                            onDragEnd={() => {
                              setDraggingMenuId(null);
                              setDropMenuId(null);
                            }}
                            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={isReorderingMenu}
                            title={tx(lang, 'Sürüşdürüb sıranı dəyiş', 'Перетащите, чтобы изменить порядок', 'Drag to reorder')}
                          >
                            <GripVertical size={16} />
                          </button>
                        </td>
                        <td className="py-3">
                          <div className="flex min-w-0 items-center gap-3">
                            {item.image_url ? (
                              <img src={String(item.image_url)} alt={String(item.item_name)} className="h-12 w-12 rounded-xl object-cover ring-1 ring-slate-700/60" />
                            ) : (
                              <div className="h-12 w-12 rounded-xl bg-slate-800 text-[10px] text-slate-500 flex items-center justify-center">IMG</div>
                            )}
                            <div className="font-semibold text-slate-100">{item.item_name}</div>
                          </div>
                        </td>
                        <td className="py-3 text-slate-200">{item.category}</td>
                        <td className="py-3 text-yellow-300 font-semibold">{parseFloat(item.price).toFixed(2)} ₼</td>
                        <td className="py-3 text-slate-300">{item.description ? String(item.description) : '-'}</td>
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setDeleteMenuId(item.id)}
                              className="text-red-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-lg transition-colors"
                              title={tx(lang, 'Məhsulu deaktiv edir/silməyə hazırlayır.', 'Деактивирует товар / подготавливает к удалению.', 'Deactivates item / prepares it for deletion.')}
                              data-guide={tx(lang, 'Məhsulu deaktiv edir/silməyə hazırlayır.', 'Деактивирует товар / подготавливает к удалению.', 'Deactivates item / prepares it for deletion.')}
                            >
                              <Trash2 size={18} />
                            </button>
                            <button
                              onClick={() => {
                                setEditMenuModal({
                                  id: String(item.id),
                                  item_name: String(item.item_name || ''),
                                  price: String(item.price || ''),
                                  category: String(item.category || menuCategoryOptions[0] || 'Qəhvə'),
                                  image_url: String(item.image_url || ''),
                                });
                              }}
                              className="text-cyan-300 hover:text-cyan-100 p-2 hover:bg-cyan-400/10 rounded-lg transition-colors"
                              title={tx(lang, 'Məhsulu düzəlt', 'Редактировать товар', 'Edit item')}
                              data-guide={tx(lang, 'Məhsulun ad, kateqoriya və qiymətini düzəldir.', 'Редактирует название, категорию и цену товара.', 'Edits item name, category and price.')}
                            >
                              <Pencil size={18} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredMenu.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-slate-500">
                          {tx(lang, 'Axtarışa uyğun məhsul tapılmadı.', 'По запросу ничего не найдено.', 'No matching menu item found.')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {editMenuModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/70 p-4">
            <div className="w-full max-w-lg rounded-2xl border border-slate-600 bg-slate-900 p-5 shadow-2xl">
              <div className="text-lg font-bold text-slate-100">
                {tx(lang, 'Məhsulu düzəlt', 'Редактировать товар', 'Edit item')}
              </div>
              <div className="mt-4 space-y-3">
                <input
                  type="text"
                  className="neon-input w-full"
                  value={editMenuModal.item_name}
                  onChange={(e) => setEditMenuModal((prev) => (prev ? { ...prev, item_name: e.target.value } : prev))}
                  placeholder={tx(lang, 'Məhsul adı', 'Название товара', 'Item name')}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="neon-input w-full"
                  value={editMenuModal.price}
                  onChange={(e) => setEditMenuModal((prev) => (prev ? { ...prev, price: e.target.value } : prev))}
                  placeholder={tx(lang, 'Qiymət', 'Цена', 'Price')}
                />
                <select
                  className="neon-input w-full"
                  value={editMenuModal.category}
                  onChange={(e) => setEditMenuModal((prev) => (prev ? { ...prev, category: e.target.value } : prev))}
                >
                  {menuCategoryOptions.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <input
                  type="text"
                  className="neon-input w-full"
                  value={editMenuModal.image_url}
                  onChange={(e) => setEditMenuModal((prev) => (prev ? { ...prev, image_url: e.target.value } : prev))}
                  placeholder={tx(lang, 'Şəkil linki', 'Ссылка на изображение', 'Image URL')}
                />
                <input
                  type="file"
                  accept="image/*"
                  className="neon-input w-full"
                  onChange={handleEditMenuImageUpload}
                />
                <div className="rounded-xl border border-slate-700/70 bg-slate-950/40 p-3">
                  <div className="mb-2 text-xs text-slate-400">{tx(lang, 'Şəkil önizləməsi', 'Предпросмотр изображения', 'Image preview')}</div>
                  <div className="h-28 w-full overflow-hidden rounded-lg bg-slate-800">
                    {editMenuModal.image_url ? (
                      <img src={editMenuModal.image_url} alt={editMenuModal.item_name || 'preview'} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">IMG</div>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  onClick={() => setEditMenuModal(null)}
                  className="neon-btn rounded-lg px-4 py-2"
                  title={tx(lang, 'Dəyişikliyi ləğv edib pəncərəni bağlayır.', 'Отменяет изменения и закрывает окно.', 'Cancels changes and closes modal.')}
                  data-guide={tx(lang, 'Dəyişikliyi ləğv edib pəncərəni bağlayır.', 'Отменяет изменения и закрывает окно.', 'Cancels changes and closes modal.')}
                >
                  {tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
                </button>
                <button
                  onClick={() => { void handleEditMenu(); }}
                  className="glossy-gold rounded-lg px-4 py-2 font-semibold"
                  title={tx(lang, 'Məhsulun yeni ad və qiymətini yadda saxlayır.', 'Сохраняет новое название и цену товара.', 'Saves updated item name and price.')}
                  data-guide={tx(lang, 'Məhsulun yeni ad və qiymətini yadda saxlayır.', 'Сохраняет новое название и цену товара.', 'Saves updated item name and price.')}
                >
                  {tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'tables' && <TablesHappyHourPanel />}

        {activeTab === 'finance' && <FinancePanel />}
        {activeTab === 'inventory' && <InventoryPanel />}
        {activeTab === 'crm' && <CRMPanel />}
        {activeTab === 'customerapp' && <CustomerAppPanel />}
        {activeTab === 'posbuilder' && <PosBuilderPanel />}
        {activeTab === 'landing' && currentRole === 'super_admin' && <LandingPanel />}
        {activeTab === 'recipes' && <RecipesPanel />}
        {activeTab === 'ai' && <AIManagerPanel />}
        {activeTab === 'zreport' && <ZReportPanel />}
        {activeTab === 'logs' && <LogsPanel />}
        {activeTab === 'combos' && <CombosPanel />}
        {activeTab === 'tenants' && <TenantsPanel />}
        {activeTab === 'notes' && (
          <div className="space-y-4">
               <h2 className="text-2xl font-bold">{tx(lang, 'Admin Qeydləri', 'Заметки администратора')}</h2>
            <textarea
              className="neon-input min-h-[180px] w-full rounded-xl p-3"
               placeholder={tx(lang, 'Biznes üçün daxili qeydlər...', 'Внутренние заметки для бизнеса...')}
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
            />
            <button
              className="glossy-gold rounded-lg px-4 py-2 font-semibold"
              onClick={() => {
                if (!adminNote.trim()) {
                  notify('error', tx(lang, 'Qeyd boş ola bilməz', 'Заметка не может быть пустой', 'Note cannot be empty'));
                  return;
                }
                const notes = JSON.parse(localStorage.getItem(`${tenant_id}_admin_notes`) || '[]');
                notes.unshift({ id: Date.now(), text: adminNote, by: user?.username, created_at: new Date().toISOString() });
                localStorage.setItem(`${tenant_id}_admin_notes`, JSON.stringify(notes.slice(0, 200)));
                 setAdminNote('');
                 setNotes(notes.slice(0, 200));
                 notify('success', tx(lang, 'Qeyd saxlanıldı', 'Заметка сохранена'));
              }}
            >
               {tx(lang, 'Qeydi Yadda Saxla', 'Сохранить заметку')}
            </button>

            <div className="space-y-2 pt-2">
              {notes.length === 0 && (
                <div className="text-slate-400 text-sm">{tx(lang, 'Hələ qeyd yoxdur', 'Заметок пока нет', 'No notes yet')}</div>
              )}
              {notes.map((n) => (
                <div key={n.id} className="rounded-xl border border-slate-700/70 bg-slate-900/35 p-3">
                  {editNoteId === n.id ? (
                    <div className="space-y-2">
                      <textarea
                        className="neon-input min-h-[110px] w-full rounded-xl p-3"
                        value={editNoteText}
                        onChange={(e) => setEditNoteText(e.target.value)}
                      />
                      <div className="flex items-center gap-2">
                        <button className="neon-btn px-3 py-1.5 rounded-lg text-sm" onClick={saveEditNote}>
                          {tx(lang, 'Yadda saxla', 'Сохранить', 'Save')}
                        </button>
                        <button className="neon-btn px-3 py-1.5 rounded-lg text-sm" onClick={() => { setEditNoteId(null); setEditNoteText(''); }}>
                          {tx(lang, 'Ləğv et', 'Отмена', 'Cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-200 whitespace-pre-wrap">{n.text}</div>
                  )}
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                    <span>{n.by || '-'}</span>
                    <div className="flex items-center gap-2">
                      <span>{new Date(n.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'az-AZ')}</span>
                      {editNoteId !== n.id && (
                        <>
                          <button className="neon-btn px-2 py-1 rounded text-[11px]" onClick={() => startEditNote(n)}>
                            {tx(lang, 'Düzəliş', 'Ред.', 'Edit')}
                          </button>
                          <button className="neon-btn px-2 py-1 rounded text-[11px]" onClick={() => setDeleteNoteId(n.id)}>
                            {tx(lang, 'Sil', 'Удал.', 'Delete')}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {activeTab === 'settings' && <SettingsPanel />}
        {activeTab === 'database' && <DatabasePanel />}
        </Suspense>

      </div>
    </div>
  );
}

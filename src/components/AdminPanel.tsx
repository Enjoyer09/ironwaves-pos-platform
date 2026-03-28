import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store';
import { get_sales_summary, get_sales_list, update_sale_amount, void_sale_with_reason } from '../api/analytics';
import { get_menu_items_live, create_menu_item_live, soft_delete_menu_item_live } from '../api/menu';
import { get_logs } from '../api/logs';
import { Decimal } from 'decimal.js';
import { Plus, Trash2, TrendingUp, ShoppingBag, DollarSign } from 'lucide-react';
import FinancePanel from './admin/FinancePanel';
import InventoryPanel from './admin/InventoryPanel';
import CRMPanel from './admin/CRMPanel';
import TablesHappyHourPanel from './admin/TablesHappyHourPanel';
import RecipesPanel from './admin/RecipesPanel';
import AIManagerPanel from './admin/AIManagerPanel';
import SettingsPanel from './admin/SettingsPanel';
import ZReportPanel from './admin/ZReportPanel';
import LogsPanel from './admin/LogsPanel';
import CombosPanel from './admin/CombosPanel';
import DatabasePanel from './admin/DatabasePanel';
import { tx } from '../i18n';
import ConfirmModal from './ConfirmModal';
import { getDB } from '../lib/db_sim';

type AdminTab = 'analytics' | 'menu' | 'tables' | 'finance' | 'inventory' | 'crm' | 'recipes' | 'ai' | 'settings' | 'notes' | 'logs' | 'database' | 'zreport' | 'combos';

interface AdminPanelProps {
  externalTab?: AdminTab;
}

export default function AdminPanel({ externalTab }: AdminPanelProps) {
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';

  const [activeTab, setActiveTab] = useState<AdminTab>('analytics');
  
  const [summary, setSummary] = useState<any>(null);
  const [sales, setSales] = useState<any[]>([]);
  const [menu, setMenu] = useState<any[]>([]);
  const [logsData, setLogsData] = useState<any[]>([]);

  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('Qəhvə');
  const [customCategory, setCustomCategory] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [notes, setNotes] = useState<Array<{ id: number; text: string; by?: string; created_at: string }>>([]);
  const [deleteMenuId, setDeleteMenuId] = useState<string | null>(null);
  const [deleteNoteId, setDeleteNoteId] = useState<number | null>(null);
  const [editNoteId, setEditNoteId] = useState<number | null>(null);
  const [editNoteText, setEditNoteText] = useState('');

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setHours(0,0,0,0); return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date(); d.setHours(23,59,59,999); return d.toISOString().split('T')[0];
  });
  const [saleActionModal, setSaleActionModal] = useState<null | { mode: 'void' | 'edit'; sale: any }>(null);
  const [saleReason, setSaleReason] = useState('');
  const [voidPreset, setVoidPreset] = useState<'TEST' | 'ZAY_MEHSUL'>('TEST');
  const [managerPass, setManagerPass] = useState('');
  const [newSaleTotal, setNewSaleTotal] = useState('');

  useEffect(() => {
    void fetchData();
  }, [activeTab, dateFrom, dateTo]);

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
    if (externalTab) {
      setActiveTab(externalTab);
    }
  }, [externalTab]);

  const fetchData = async () => {
    if (activeTab === 'analytics') {
      const from_d = new Date(dateFrom);
      from_d.setHours(0, 0, 0, 0);
      const to_d = new Date(dateTo);
      to_d.setHours(23, 59, 59, 999);
      setSummary(get_sales_summary(tenant_id, from_d.toISOString(), to_d.toISOString()));
      setSales(get_sales_list(tenant_id, from_d.toISOString(), to_d.toISOString()));
      return;
    }

    if (activeTab === 'menu') {
      setMenu(await get_menu_items_live(tenant_id));
      return;
    }

    if (activeTab === 'logs') {
      setLogsData(get_logs(tenant_id, 250));
    }
  };

  const handleAddMenu = async () => {
    if (!newItemName || !newItemPrice) return;
    const finalCategory = newItemCategory === '__custom__' ? customCategory.trim() : newItemCategory;
    if (!finalCategory) return;
    await create_menu_item_live(tenant_id, {
      item_name: newItemName,
      price: new Decimal(newItemPrice),
      category: finalCategory,
      is_coffee: /q[eə]hv[əe]|coffee|kofe/i.test(finalCategory),
    }, user?.username);
    setNewItemName('');
    setNewItemPrice('');
    setCustomCategory('');
    await fetchData();
  };

  const handleDeleteMenu = async (id: string) => {
    await soft_delete_menu_item_live(tenant_id, id, user?.username || 'admin');
    await fetchData();
    setDeleteMenuId(null);
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

  const verifyManagerOrAdminPass = (pass: string) => {
    const users = getDB<any>('users');
    const allowed = users.find((u: any) => ['admin', 'manager'].includes(String(u.role || '').toLowerCase()));
    return Boolean(allowed && String(allowed.password || '') === pass);
  };

  return (
    <div className="h-full overflow-hidden p-6 text-slate-100">
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
      <div className="h-full overflow-y-auto metal-panel p-6">
        
        {activeTab === 'analytics' && (
          <div>
            <div className="flex items-center justify-between mb-8">
              <div>
                  <h1 className="text-3xl font-bold">{tx(lang, 'İdarəetmə Paneli', 'Панель управления')}</h1>
                  <p className="text-slate-300 mt-1">{tx(lang, 'Seçilmiş tarix aralığına görə statistika', 'Статистика за выбранный период')}</p>
              </div>
              <div className="flex gap-4">
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="neon-input" />
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="neon-input" />
              </div>
            </div>

            {/* Summary Cards */}
            {summary && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="metal-panel p-6 flex items-center">
                  <div className="w-14 h-14 bg-green-400/20 text-green-200 rounded-2xl flex items-center justify-center mr-4 border border-green-300/30">
                    <DollarSign size={28} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-300">{tx(lang, 'Ümumi Gəlir', 'Общая выручка')}</p>
                    <h3 className="text-2xl font-bold text-slate-100">{parseFloat(summary.total_revenue).toFixed(2)} ₼</h3>
                  </div>
                </div>
                <div className="metal-panel p-6 flex items-center">
                  <div className="w-14 h-14 bg-blue-400/20 text-blue-200 rounded-2xl flex items-center justify-center mr-4 border border-blue-300/30">
                    <ShoppingBag size={28} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-300">{tx(lang, 'Satış Sayı', 'Количество продаж')}</p>
                    <h3 className="text-2xl font-bold text-slate-100">{sales.length}</h3>
                  </div>
                </div>
                <div className="metal-panel p-6 flex items-center">
                  <div className="w-14 h-14 bg-purple-400/20 text-purple-200 rounded-2xl flex items-center justify-center mr-4 border border-purple-300/30">
                    <TrendingUp size={28} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-300">{tx(lang, 'Xalis Mənfəət', 'Чистая прибыль')}</p>
                    <h3 className="text-2xl font-bold text-slate-100">{parseFloat(summary.gross_profit).toFixed(2)} ₼</h3>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-8">
              {/* Son Satışlar Cədvəli */}
              <div className="metal-panel overflow-hidden">
                <div className="p-6 border-b border-slate-700/70">
                  <h2 className="text-xl font-bold text-slate-100">{tx(lang, 'Son Satışlar', 'Последние продажи')}</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-900/40 text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      <tr>
                         <th className="px-6 py-4">{tx(lang, 'Tarix/Saat', 'Дата/время')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Satan (Staff)', 'Продавец (персонал)')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Müştəri QR', 'QR клиента')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Sifariş', 'Заказ')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Ulduz', 'Звезды')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Məbləğ / Endirim', 'Сумма / скидка')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Yekun Məbləğ', 'Итоговая сумма')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Komissiya', 'Комиссия')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Üsul', 'Метод')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Status', 'Статус')}</th>
                         <th className="px-6 py-4">{tx(lang, 'Əməliyyat', 'Действие')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700/60">
                      {sales.map((s, i) => (
                        <tr key={i}>
                           <td className="px-6 py-4 text-sm text-slate-300">{new Date(s.created_at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'az-AZ')}</td>
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
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full border ${s.status === 'VOIDED' ? 'bg-red-500/20 text-red-200 border-red-300/40' : s.status === 'PARTIAL_REFUND' ? 'bg-amber-500/20 text-amber-200 border-amber-300/40' : 'bg-emerald-500/20 text-emerald-200 border-emerald-300/40'}`}>
                               {s.status === 'VOIDED' ? 'VOID' : s.status === 'PARTIAL_REFUND' ? 'PARTIAL' : tx(lang, 'COMPLETED', 'ЗАВЕРШЕН')}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex gap-2">
                              <button
                                className="neon-btn rounded-lg px-2 py-1 text-[11px]"
                                disabled={s.status === 'VOIDED'}
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
                                className="glossy-gold rounded-lg px-2 py-1 text-[11px] font-semibold"
                                disabled={s.status === 'VOIDED'}
                                onClick={() => {
                                  setSaleActionModal({ mode: 'edit', sale: s });
                                  setSaleReason('');
                                  setManagerPass('');
                                  setNewSaleTotal(String(s.total || ''));
                                }}
                              >
                                {tx(lang, 'Düzəlt', 'Исправить')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {sales.length === 0 && (
                         <tr><td colSpan={11} className="px-6 py-8 text-center text-slate-500">{tx(lang, 'Heç bir satış tapılmadı', 'Продажи не найдены')}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {saleActionModal && (
                <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 p-4">
                  <div className="metal-panel w-full max-w-md p-5">
                    <h3 className="text-lg font-bold text-slate-100">
                      {saleActionModal.mode === 'void'
                        ? tx(lang, 'Satışı VOID et', 'Сделать продажу VOID')
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
                        <input className="neon-input" type="number" placeholder={tx(lang, 'Yeni total', 'Новый итог')} value={newSaleTotal} onChange={(e) => setNewSaleTotal(e.target.value)} />
                      )}
                    </div>
                    <div className="mt-4 flex justify-end gap-2">
                      <button className="neon-btn rounded-lg px-4 py-2" onClick={() => setSaleActionModal(null)}>
                        {tx(lang, 'Ləğv et', 'Отмена')}
                      </button>
                      <button
                        className="glossy-gold rounded-lg px-4 py-2 font-semibold"
                        onClick={() => {
                          if (!managerPass) return;
                          if (!verifyManagerOrAdminPass(managerPass)) {
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
                              void_sale_with_reason(tenant_id, saleActionModal.sale.id, finalReason, user?.username || 'admin', returnToStock);
                              notify('success', tx(lang, 'Satış VOID edildi', 'Продажа VOID выполнена'));
                            } else {
                              if (!newSaleTotal) return;
                              update_sale_amount(tenant_id, saleActionModal.sale.id, newSaleTotal, saleReason, user?.username || 'admin');
                              notify('success', tx(lang, 'Satış düzəlişi tətbiq olundu', 'Изменение продажи применено'));
                            }
                            setSaleActionModal(null);
                            fetchData();
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
          <div className="metal-panel flex flex-col">
            <div className="p-6 border-b border-slate-700/70 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-slate-100">{tx(lang, 'Menyu İdarəetməsi', 'Управление меню')}</h2>
            </div>
            
            <div className="p-6 border-b border-slate-700/70 flex gap-3 flex-wrap">
              <input type="text" placeholder={tx(lang, 'Ad', 'Название')} value={newItemName} onChange={e => setNewItemName(e.target.value)} className="neon-input min-w-[150px]"/>
              <input type="number" placeholder={tx(lang, 'Qiymət', 'Цена')} value={newItemPrice} onChange={e => setNewItemPrice(e.target.value)} className="neon-input w-28"/>
              <select value={newItemCategory} onChange={e => setNewItemCategory(e.target.value)} className="neon-input w-40">
                {Array.from(new Set(['Qəhvə', 'Şirniyyat', 'Sular', ...menu.map((m) => m.category)])).map((cat) => (
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
                  className="neon-input w-40"
                />
              )}
              <button onClick={() => { void handleAddMenu(); }} className="glossy-gold px-4 py-2 rounded-xl transition-colors flex items-center">
                <Plus size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {menu.map(item => (
                <div key={item.id} className="flex justify-between items-center p-4 rounded-xl border border-slate-700/70 bg-slate-900/35">
                  <div>
                    <div className="font-bold text-lg text-slate-100">{item.item_name}</div>
                    <div className="text-sm font-semibold text-yellow-300 bg-yellow-500/20 px-2 py-0.5 rounded inline-block mt-1">{item.category}</div>
                  </div>
                  <div className="flex items-center space-x-6">
                    <div className="font-bold text-xl text-slate-100">{parseFloat(item.price).toFixed(2)} ₼</div>
                    <button onClick={() => setDeleteMenuId(item.id)} className="text-red-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'tables' && <TablesHappyHourPanel />}

        {activeTab === 'finance' && <FinancePanel />}
        {activeTab === 'inventory' && <InventoryPanel />}
        {activeTab === 'crm' && <CRMPanel />}
        {activeTab === 'recipes' && <RecipesPanel />}
        {activeTab === 'ai' && <AIManagerPanel />}
        {activeTab === 'zreport' && <ZReportPanel />}
        {activeTab === 'logs' && <LogsPanel />}
        {activeTab === 'combos' && <CombosPanel />}
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

      </div>
    </div>
  );
}

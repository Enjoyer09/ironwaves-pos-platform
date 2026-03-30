import React, { useRef, useState, useEffect } from 'react';
import { get_tables_live, create_table_live, delete_table_live, pay_table_live, transfer_table_live, merge_tables_live } from '../api/tables';
import { LayoutGrid, Plus, Trash2 } from 'lucide-react';
import { useAppStore } from '../store';
import { tx } from '../i18n';
import ConfirmModal from './ConfirmModal';
import { Decimal } from 'decimal.js';
import { get_business_profile, get_settings } from '../api/settings';
import { getDB } from '../lib/db_sim';
import { qzPrintHtml } from '../lib/qz';

export default function TablesPage() {
  const [tables, setTables] = useState<any[]>([]);
  const { user, lang, notify } = useAppStore();
  const tenant_id = user?.tenant_id || 'tenant_default';
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [newTableName, setNewTableName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTableId, setDeleteTableId] = useState<string | null>(null);
  const [showDeleteAuth, setShowDeleteAuth] = useState(false);
  const [deleteAdminPass, setDeleteAdminPass] = useState('');
  const [payTableId, setPayTableId] = useState<string | null>(null);
  const [viewTableId, setViewTableId] = useState<string | null>(null);
  const [transferTargetId, setTransferTargetId] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [tableReceiptHtml, setTableReceiptHtml] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'Nəğd' | 'Kart' | 'Split'>('Nəğd');
  const [splitCash, setSplitCash] = useState('0');
  const receiptRef = useRef<HTMLIFrameElement | null>(null);
  const businessProfile = get_business_profile(tenant_id);
  const printSettings = get_settings(tenant_id).print_settings || { use_qz: false, printer_name: '' };

  const formatDisplayId = (id: string) => (id ? id.split('-')[0].toUpperCase() : '-');
  const kitchenBadge = (status?: string | null) => {
    switch (String(status || '').toUpperCase()) {
      case 'NEW':
        return { label: tx(lang, 'Mətbəxə göndərildi', 'Отправлено на кухню', 'Sent to kitchen'), className: 'bg-blue-400/20 text-blue-200 border border-blue-300/40' };
      case 'PREPARING':
        return { label: tx(lang, 'Hazırlanır', 'Готовится', 'Preparing'), className: 'bg-orange-400/20 text-orange-200 border border-orange-300/40' };
      case 'READY':
        return { label: tx(lang, 'Servisə hazırdır', 'Готово к подаче', 'Ready to serve'), className: 'bg-emerald-400/20 text-emerald-200 border border-emerald-300/40' };
      default:
        return null;
    }
  };

  useEffect(() => {
    void loadData();
  }, [tenant_id]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const loadData = async () => {
    setTables(await get_tables_live(tenant_id));
  };

  const handleAddTable = async () => {
    const label = newTableName.trim();
    if (!label) return;
    try {
      await create_table_live(tenant_id, label, user?.username || 'Staff');
      notify('success', tx(lang, 'Masa yaradıldı', 'Стол создан', 'Table created'));
      await loadData();
      setShowCreate(false);
      setNewTableName('');
    } catch(e:any) { notify('error', tx(lang, 'Xəta: ', 'Ошибка: ', 'Error: ') + e.message); }
  };

  const handleDeleteTable = async (id: string) => {
    try {
      await delete_table_live(id, user?.username || 'Staff');
      notify('success', tx(lang, 'Masa silindi', 'Стол удален', 'Table deleted'));
      setDeleteTableId(null);
      await loadData();
    } catch(e:any) { notify('error', tx(lang, 'Xəta: ', 'Ошибка: ', 'Error: ') + e.message); }
  };

  const printTableReceiptOnly = async () => {
    if (printSettings.use_qz && tableReceiptHtml) {
      try {
        await qzPrintHtml(tableReceiptHtml, printSettings.printer_name);
        notify('success', tx(lang, 'QZ Tray ilə çap göndərildi', 'Печать отправлена через QZ Tray', 'Print job sent via QZ Tray'));
        return;
      } catch (e: any) {
        notify('error', tx(lang, `QZ çap alınmadı, brauzerə keçilir: ${e.message || e}`, `QZ печать не удалась, переход к печати браузера: ${e.message || e}`, `QZ printing failed, falling back to browser printing: ${e.message || e}`));
      }
    }
    const frame = receiptRef.current;
    if (!frame?.contentWindow) return;
    frame.contentWindow.focus();
    frame.contentWindow.print();
  };

  return (
    <div className="h-full overflow-auto p-3 text-slate-100 md:p-6">
      {!isOnline && (
        <div className="mb-4 rounded-xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          <div className="font-semibold">{tx(lang, 'Offline masa rejimi aktivdir', 'Офлайн режим столов активен', 'Offline table mode is active')}</div>
          <div className="mt-1 text-amber-200/90">
            {tx(
              lang,
              'Masa əməliyyatları və mətbəx axını bu cihazda lokal olaraq davam edəcək. İnternet qayıdanda satış sync statusunu ayrıca yoxlayın.',
              'Операции со столами и кухня продолжат работать локально на этом устройстве. После возврата связи отдельно проверьте статус синхронизации продаж.',
              'Table actions and kitchen flow continue locally on this device. When connection returns, verify sale sync status separately.',
            )}
          </div>
        </div>
      )}
      <ConfirmModal
        open={Boolean(deleteTableId)}
        lang={lang}
        title={tx(lang, 'Masanı sil', 'Удалить стол', 'Delete table')}
        message={tx(lang, 'Masa yalnız boş olduqda silinməlidir.', 'Стол удаляется только если он свободен.', 'A table can only be deleted when it is empty.')}
        onCancel={() => setDeleteTableId(null)}
        onConfirm={() => {
          if (!deleteTableId) return;
          setShowDeleteAuth(true);
        }}
      />

      {showDeleteAuth && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-4">
          <div className="metal-panel w-full max-w-md p-5">
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Admin Təsdiqi', 'Подтверждение админа', 'Admin Confirmation')}</h3>
            <p className="mt-2 text-sm text-slate-300">{tx(lang, 'Masa silmək üçün admin şifrəsini daxil edin', 'Введите пароль администратора для удаления стола')}</p>
            <input
              type="password"
              className="neon-input mt-3"
              value={deleteAdminPass}
              onChange={(e) => setDeleteAdminPass(e.target.value)}
              placeholder={tx(lang, 'Admin şifrəsi', 'Пароль администратора')}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="neon-btn rounded-lg px-4 py-2"
                onClick={() => {
                  setShowDeleteAuth(false);
                  setDeleteAdminPass('');
                }}
              >
                {tx(lang, 'Ləğv et', 'Отмена')}
              </button>
              <button
                className="glossy-gold rounded-lg px-4 py-2 font-semibold"
                onClick={() => {
                  const users = getDB<any>('users');
                  const admin = users.find((u) => String(u.role || '').toLowerCase() === 'admin');
                  const valid = Boolean(admin && String(admin.password || '') === deleteAdminPass);
                  if (!valid) {
                    notify('error', tx(lang, 'Admin şifrəsi yanlışdır', 'Неверный пароль администратора'));
                    return;
                  }
                  if (deleteTableId) void handleDeleteTable(deleteTableId);
                  setShowDeleteAuth(false);
                  setDeleteAdminPass('');
                }}
              >
                {tx(lang, 'Silməni Təsdiqlə', 'Подтвердить удаление')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/65 p-4">
          <div className="metal-panel w-full max-w-md p-5">
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Yeni masa yarat', 'Создать новый стол')}</h3>
            <input
              className="neon-input mt-3"
              placeholder={tx(lang, 'Masa adı (Məs: Masa 5)', 'Название стола (напр.: Стол 5)')}
              value={newTableName}
              onChange={(e) => setNewTableName(e.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button className="neon-btn rounded-lg px-4 py-2" onClick={() => setShowCreate(false)}>{tx(lang, 'Ləğv et', 'Отмена')}</button>
              <button className="glossy-gold rounded-lg px-4 py-2 font-semibold" onClick={() => { void handleAddTable(); }}>{tx(lang, 'Yarat', 'Создать')}</button>
            </div>
          </div>
        </div>
      )}

      {payTableId && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/65 p-0 md:items-center md:p-4">
          <div className="metal-panel w-full max-w-md rounded-t-[28px] p-5 md:rounded-2xl">
            <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-slate-600 md:hidden" />
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Masa hesabını bağla', 'Закрыть счет стола')}</h3>
            <div className="mt-3 text-sm text-slate-300">
              {(() => {
                const t = tables.find((x) => x.id === payTableId);
                if (!t) return '-';
                return `${t.label} - ${new Decimal(t.total || 0).toFixed(2)} ₼`;
              })()}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {(['Nəğd', 'Kart', 'Split'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  className={`pay-btn h-11 ${paymentMethod === m ? 'pay-btn-active' : ''}`}
                >
                  {m}
                </button>
              ))}
            </div>
            {paymentMethod === 'Split' && (
              <input
                className="neon-input mt-3"
                type="number"
                min={0}
                step="0.01"
                placeholder={tx(lang, 'Nağd hissə', 'Наличная часть')}
                value={splitCash}
                onChange={(e) => setSplitCash(e.target.value)}
              />
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button className="neon-btn rounded-lg px-4 py-2" onClick={() => setPayTableId(null)}>{tx(lang, 'Ləğv et', 'Отмена')}</button>
              <button
                className="glossy-gold rounded-lg px-4 py-2 font-semibold"
                onClick={async () => {
                  try {
                    const table = tables.find((x) => x.id === payTableId);
                    if (!table) return;
                    const itemsSnapshot = Array.isArray(table.items) ? [...table.items] : [];
                    const total = new Decimal(table.total || 0);
                    const cash = paymentMethod === 'Split' ? new Decimal(splitCash || 0) : null;
                    const card = paymentMethod === 'Split' ? Decimal.max(new Decimal(0), total.minus(cash || 0)) : null;
                    if (paymentMethod === 'Split' && ((cash || new Decimal(0)).lessThan(0) || (card || new Decimal(0)).lessThan(0) || cash!.plus(card!).minus(total).abs().greaterThan(0.01))) {
                      notify('error', tx(lang, 'Split məbləğlər toplam hesaba bərabər olmalıdır', 'Суммы split должны совпадать с итогом'));
                      return;
                    }
                    const result = await pay_table_live(table.id, paymentMethod, user?.username || 'Staff', cash, card);
                    const sales = getDB<any>('sales');
                    const paidSale = sales.find((s) => s.id === result.sale_id);
                    const receiptCustomerId = String(paidSale?.customer_card_id || '').trim();
                    const receiptStarsAfter = Number(paidSale?.customer_stars_after ?? 0);
                    const receiptFreeCoffees = Number(paidSale?.free_coffees_applied ?? 0);
                    const itemsHtml = itemsSnapshot
                      .map((it: any) => {
                        const line = new Decimal(it.price || 0).times(it.qty || 0);
                        return `<tr><td style="padding:4px 0">${it.qty}x ${it.item_name}</td><td style="text-align:right">${line.toFixed(2)} ₼</td></tr>`;
                      })
                      .join('');

                    const breakdown = paymentMethod === 'Split'
                      ? `<div style="display:flex;justify-content:space-between"><span>Nağd</span><span>${cash?.toFixed(2)} ₼</span></div>
                         <div style="display:flex;justify-content:space-between"><span>Kart</span><span>${card?.toFixed(2)} ₼</span></div>`
                      : `<div style="display:flex;justify-content:space-between"><span>Ödəniş</span><span>${paymentMethod}</span></div>`;

                    setTableReceiptHtml(`
                      <html>
                        <head>
                          <style>
                            @page { size: 80mm auto; margin: 4mm; }
                            body { font-family: 'Inter', Arial, sans-serif; font-size: 12px; color: #111; }
                            .line { display:flex; justify-content:space-between; gap:8px; margin: 2px 0; }
                            .muted { color:#555; font-size:11px; }
                            .bold { font-weight: 700; }
                            hr { border: none; border-top: 1px dashed #999; margin: 8px 0; }
                          </style>
                        </head>
                        <body style="font-family:Arial;padding:16px;max-width:320px;margin:0 auto;color:#111">
                          ${businessProfile?.logo_url ? `<img src="${businessProfile.logo_url}" style="height:34px;max-width:180px;object-fit:contain;margin-bottom:6px" />` : ''}
                          <h2 style="margin:0 0 4px;font-size:16px">${businessProfile?.company_name || 'IRONWAVES POS'}</h2>
                          <div class="muted">VÖEN: ${businessProfile?.voen || '-'}</div>
                          <div class="muted">Tel: ${businessProfile?.phone || '-'}</div>
                          <div class="muted">${businessProfile?.address || '-'}</div>
                          <hr />
                          <div class="line"><span>Masa</span><span class="bold">${table.label}</span></div>
                          <div class="line"><span>Satış ID</span><span>${formatDisplayId(result.sale_id)}</span></div>
                          <div class="line"><span>Operator</span><span>${user?.username || 'staff'}</span></div>
                          <div class="line"><span>Tarix</span><span>${new Date().toLocaleString()}</span></div>
                          <hr />
                          <table style="width:100%;font-size:14px">${itemsHtml}</table>
                          <hr style="margin:12px 0" />
                          ${breakdown}
                          ${receiptFreeCoffees > 0 ? `<div class="line"><span>Pulsuz kofe</span><span>${receiptFreeCoffees}</span></div>` : ''}
                          ${receiptCustomerId ? `<div class="line"><span>Müştəri ID</span><span>${receiptCustomerId}</span></div>` : ''}
                          ${receiptCustomerId ? `<div class="line"><span>Ulduz balansı</span><span>${receiptStarsAfter}</span></div>` : ''}
                          <div class="line bold" style="font-size:13px"><span>YEKUN</span><span>${total.toFixed(2)} ₼</span></div>
                          <hr />
                          <div class="muted">${businessProfile?.receipt_footer || 'Bizi seçdiyiniz üçün təşəkkür edirik!'}</div>
                        </body>
                      </html>
                    `);
                    notify('success', tx(lang, 'Masa hesabı bağlandı', 'Счет стола закрыт'));
                    window.dispatchEvent(new CustomEvent('inventory-updated', { detail: { tenant_id, sale_id: result.sale_id, source: 'table' } }));
                    setPayTableId(null);
                    setSplitCash('0');
                    await loadData();
                  } catch (e: any) {
                    notify('error', tx(lang, 'Xəta: ', 'Ошибка: ') + e.message);
                  }
                }}
              >
                {tx(lang, 'Bağla', 'Закрыть')}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewTableId && (
        <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/65 p-0 md:items-center md:p-4">
          <div className="metal-panel w-full max-w-lg rounded-t-[30px] p-5 md:rounded-2xl">
            <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-slate-600 md:hidden" />
            {(() => {
              const t = tables.find((x) => x.id === viewTableId);
              if (!t) return null;
              const items = Array.isArray(t.items) ? t.items : [];
              const otherTables = tables.filter((row) => row.id !== t.id);
              return (
                <>
                  <h3 className="text-lg font-bold text-slate-100">{t.label}</h3>
                  <div className="mt-1 text-xs text-slate-400">{tx(lang, 'Açıq sifarişlər', 'Открытые заказы')}</div>
                  <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-700/70 bg-slate-900/40 p-3">
                    {items.length === 0 && <div className="text-sm text-slate-400">{tx(lang, 'Masa boşdur', 'Стол пуст')}</div>}
                    {items.map((it: any, idx: number) => (
                      <div key={`${it.item_name}_${idx}`} className="flex items-center justify-between border-b border-slate-700/40 py-2 text-sm last:border-b-0">
                        <span>{it.item_name}</span>
                        <span>x{it.qty}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex justify-between text-sm text-slate-300">
                    <span>{tx(lang, 'Açıq hesab', 'Открытый счет')}</span>
                    <span className="font-semibold text-slate-100">{new Decimal(t.total || 0).toFixed(2)} ₼</span>
                  </div>
                  {t.is_occupied && (
                    <div className="mt-4 grid gap-3 rounded-lg border border-slate-700/70 bg-slate-900/40 p-3">
                      <div>
                        <div className="mb-1 text-xs font-semibold text-slate-400">{tx(lang, 'Masanı köçür', 'Перенести стол', 'Transfer table')}</div>
                        <div className="flex gap-2">
                          <select className="neon-input flex-1" value={transferTargetId} onChange={(e) => setTransferTargetId(e.target.value)}>
                            <option value="">{tx(lang, 'Boş masa seçin', 'Выберите свободный стол', 'Select empty table')}</option>
                            {otherTables.filter((row) => !row.is_occupied).map((row) => (
                              <option key={row.id} value={row.id}>{row.label}</option>
                            ))}
                          </select>
                          <button
                            className="rounded-lg border border-blue-300/40 bg-blue-500/15 px-3 py-2 text-sm font-semibold text-blue-100"
                            onClick={async () => {
                              if (!transferTargetId) return;
                              try {
                                await transfer_table_live(t.id, transferTargetId, user?.username || 'staff');
                                notify('success', tx(lang, 'Masa köçürüldü', 'Стол перенесен', 'Table transferred'));
                                setTransferTargetId('');
                                setViewTableId(null);
                                await loadData();
                              } catch (e: any) {
                                notify('error', e.message);
                              }
                            }}
                          >
                            {tx(lang, 'Köçür', 'Перенести', 'Transfer')}
                          </button>
                        </div>
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-semibold text-slate-400">{tx(lang, 'Masaları birləşdir', 'Объединить столы', 'Merge tables')}</div>
                        <div className="flex gap-2">
                          <select className="neon-input flex-1" value={mergeTargetId} onChange={(e) => setMergeTargetId(e.target.value)}>
                            <option value="">{tx(lang, 'Hədəf masa seçin', 'Выберите целевой стол', 'Select target table')}</option>
                            {otherTables.map((row) => (
                              <option key={row.id} value={row.id}>{row.label}{row.is_occupied ? ` (${tx(lang, 'dolu', 'занят', 'occupied')})` : ''}</option>
                            ))}
                          </select>
                          <button
                            className="rounded-lg border border-amber-300/40 bg-amber-500/15 px-3 py-2 text-sm font-semibold text-amber-100"
                            onClick={async () => {
                              if (!mergeTargetId) return;
                              try {
                                await merge_tables_live(t.id, mergeTargetId, user?.username || 'staff');
                                notify('success', tx(lang, 'Masalar birləşdirildi', 'Столы объединены', 'Tables merged'));
                                setMergeTargetId('');
                                setViewTableId(null);
                                await loadData();
                              } catch (e: any) {
                                notify('error', e.message);
                              }
                            }}
                          >
                            {tx(lang, 'Birləşdir', 'Объединить', 'Merge')}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="mt-4 flex justify-end gap-2">
                    <button className="neon-btn rounded-lg px-4 py-2" onClick={() => setViewTableId(null)}>{tx(lang, 'Bağla', 'Закрыть')}</button>
                    {t.is_occupied && (
                      <button
                        className="glossy-gold rounded-lg px-4 py-2 font-semibold"
                        onClick={() => {
                          setPayTableId(t.id);
                          setViewTableId(null);
                        }}
                      >
                        {tx(lang, 'Hesabı Al', 'Закрыть счет')}
                      </button>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {tableReceiptHtml && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-4">
          <div className="metal-panel w-full max-w-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-100">{tx(lang, 'Masa Çeki Hazırdır', 'Чек стола готов')}</h3>
              <div className="flex gap-2">
                <button onClick={printTableReceiptOnly} className="rounded-lg bg-yellow-400 px-4 py-2 text-sm font-semibold text-slate-900">{tx(lang, 'Çap Et', 'Печать')}</button>
                <button onClick={() => setTableReceiptHtml(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">{tx(lang, 'Bağla', 'Закрыть')}</button>
              </div>
            </div>
            <iframe ref={receiptRef} title="table-receipt" srcDoc={tableReceiptHtml} className="h-[70vh] w-full rounded-lg bg-white" />
          </div>
        </div>
      )}

      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className="text-2xl font-bold flex items-center gap-2"><LayoutGrid size={28} className="text-yellow-300"/> {tx(lang, 'Masaların İdarəsi', 'Управление столами', 'Table Management')}</h2>
        {['admin', 'manager', 'super_admin'].includes(String(user?.role || '').toLowerCase()) && (
          <button onClick={() => setShowCreate(true)} className="glossy-gold min-h-13 px-4 py-3 rounded-xl flex items-center justify-center gap-2 transition-colors font-bold">
            <Plus size={20} /> {tx(lang, 'Masa Yarat', 'Создать стол', 'Create Table')}
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5">
        {tables.map(t => (
          (() => {
            const kitchen = kitchenBadge((t as any).kitchen_status);
            return (
          <div
            key={t.id}
            onClick={() => setViewTableId(t.id)}
            className={`min-h-44 p-6 rounded-3xl border-2 flex flex-col items-center justify-center relative transition-all shadow-sm cursor-pointer ${t.is_occupied ? 'bg-red-900/25 border-red-400/70' : 'bg-slate-800/50 border-slate-600/70 hover:border-yellow-300/60'}`}
          >
            <span className="font-bold text-xl text-slate-100">{t.label}</span>
            <span className={`text-xs px-3 py-1 rounded-full mt-3 font-semibold ${t.is_occupied ? 'bg-red-400/20 text-red-200 border border-red-300/50' : 'bg-green-400/20 text-green-200 border border-green-300/50'}`}>
                {t.is_occupied ? tx(lang, 'Dolu', 'Занято', 'Occupied') : tx(lang, 'Boş', 'Свободно', 'Available')}
            </span>
            {kitchen && (
              <span className={`mt-2 rounded-full px-3 py-1 text-[11px] font-semibold ${kitchen.className}`}>
                {kitchen.label}
              </span>
            )}
            {!t.is_occupied && ['admin', 'manager', 'super_admin'].includes(String(user?.role || '').toLowerCase()) && (
              <button onClick={(e) => { e.stopPropagation(); setDeleteTableId(t.id); }} className="absolute top-3 right-3 text-slate-400 hover:text-red-300 transition-colors">
                <Trash2 size={18}/>
              </button>
            )}
            {t.is_occupied && (
              <button
                onClick={(e) => { e.stopPropagation(); setPayTableId(t.id); }}
                className="mt-3 rounded-lg border border-yellow-300/60 bg-yellow-400/20 px-3 py-1 text-xs font-semibold text-yellow-100"
              >
                {tx(lang, 'Hesabı Bağla', 'Закрыть счет', 'Close Bill')}
              </button>
            )}
          </div>
            );
          })()
        ))}
        {tables.length === 0 && (
          <div className="metal-panel col-span-full py-12 text-center text-slate-400 border-2 border-dashed border-slate-600 rounded-2xl">
             {tx(lang, 'Heç bir masa tapılmadı. Zəhmət olmasa "Masa Yarat" düyməsindən istifadə edin.', 'Столы не найдены. Пожалуйста, используйте кнопку "Создать стол".', 'No tables found. Please use the "Create Table" button.')}
          </div>
        )}
      </div>
    </div>
  );
}

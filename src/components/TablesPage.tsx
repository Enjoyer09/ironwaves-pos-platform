import React, { useRef, useState, useEffect } from 'react';
import { get_tables_live, create_table_live, delete_table_live, pay_table_live } from '../api/tables';
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
  const [newTableName, setNewTableName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTableId, setDeleteTableId] = useState<string | null>(null);
  const [showDeleteAuth, setShowDeleteAuth] = useState(false);
  const [deleteAdminPass, setDeleteAdminPass] = useState('');
  const [payTableId, setPayTableId] = useState<string | null>(null);
  const [viewTableId, setViewTableId] = useState<string | null>(null);
  const [tableReceiptHtml, setTableReceiptHtml] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'Nəğd' | 'Kart' | 'Split'>('Nəğd');
  const [splitCash, setSplitCash] = useState('0');
  const receiptRef = useRef<HTMLIFrameElement | null>(null);
  const businessProfile = get_business_profile(tenant_id);
  const printSettings = get_settings(tenant_id).print_settings || { use_qz: false, printer_name: '' };

  const formatDisplayId = (id: string) => (id ? id.split('-')[0].toUpperCase() : '-');

  useEffect(() => {
    void loadData();
  }, [tenant_id]);

  const loadData = async () => {
    setTables(await get_tables_live(tenant_id));
  };

  const handleAddTable = async () => {
    const label = newTableName.trim();
    if (!label) return;
    try {
      await create_table_live(tenant_id, label, user?.username || 'Staff');
      notify('success', tx(lang, 'Masa yaradıldı', 'Стол создан'));
      await loadData();
      setShowCreate(false);
      setNewTableName('');
    } catch(e:any) { notify('error', tx(lang, 'Xəta: ', 'Ошибка: ') + e.message); }
  };

  const handleDeleteTable = async (id: string) => {
    try {
      await delete_table_live(id, user?.username || 'Staff');
      notify('success', tx(lang, 'Masa silindi', 'Стол удален'));
      setDeleteTableId(null);
      await loadData();
    } catch(e:any) { notify('error', tx(lang, 'Xəta: ', 'Ошибка: ') + e.message); }
  };

  const printTableReceiptOnly = async () => {
    if (printSettings.use_qz && tableReceiptHtml) {
      try {
        await qzPrintHtml(tableReceiptHtml, printSettings.printer_name);
        notify('success', tx(lang, 'QZ Tray ilə çap göndərildi', 'Печать отправлена через QZ Tray'));
        return;
      } catch (e: any) {
        notify('error', tx(lang, `QZ çap alınmadı, brauzerə keçilir: ${e.message || e}`, `QZ печать не удалась, переход к печати браузера: ${e.message || e}`));
      }
    }
    const frame = receiptRef.current;
    if (!frame?.contentWindow) return;
    frame.contentWindow.focus();
    frame.contentWindow.print();
  };

  return (
    <div className="p-6 h-full overflow-auto text-slate-100">
      <ConfirmModal
        open={Boolean(deleteTableId)}
        lang={lang}
        title={tx(lang, 'Masanı sil', 'Удалить стол')}
        message={tx(lang, 'Masa yalnız boş olduqda silinməlidir.', 'Стол удаляется только если он свободен.')}
        onCancel={() => setDeleteTableId(null)}
        onConfirm={() => {
          if (!deleteTableId) return;
          setShowDeleteAuth(true);
        }}
      />

      {showDeleteAuth && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-4">
          <div className="metal-panel w-full max-w-md p-5">
            <h3 className="text-lg font-bold text-slate-100">{tx(lang, 'Admin Təsdiqi', 'Подтверждение админа')}</h3>
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
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/65 p-4">
          <div className="metal-panel w-full max-w-md p-5">
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
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/65 p-4">
          <div className="metal-panel w-full max-w-lg p-5">
            {(() => {
              const t = tables.find((x) => x.id === viewTableId);
              if (!t) return null;
              const items = Array.isArray(t.items) ? t.items : [];
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

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold flex items-center gap-2"><LayoutGrid size={28} className="text-yellow-300"/> {tx(lang, 'Masaların İdarəsi', 'Управление столами')}</h2>
        {['admin', 'manager', 'super_admin'].includes(String(user?.role || '').toLowerCase()) && (
          <button onClick={() => setShowCreate(true)} className="glossy-gold px-4 py-2 rounded-lg flex items-center gap-2 transition-colors font-bold">
            <Plus size={20} /> {tx(lang, 'Masa Yarat', 'Создать стол')}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
        {tables.map(t => (
          <div
            key={t.id}
            onClick={() => setViewTableId(t.id)}
            className={`p-6 rounded-2xl border-2 flex flex-col items-center justify-center relative transition-all shadow-sm cursor-pointer ${t.is_occupied ? 'bg-red-900/25 border-red-400/70' : 'bg-slate-800/50 border-slate-600/70 hover:border-yellow-300/60'}`}
          >
            <span className="font-bold text-xl text-slate-100">{t.label}</span>
            <span className={`text-xs px-3 py-1 rounded-full mt-3 font-semibold ${t.is_occupied ? 'bg-red-400/20 text-red-200 border border-red-300/50' : 'bg-green-400/20 text-green-200 border border-green-300/50'}`}>
                {t.is_occupied ? tx(lang, 'Dolu', 'Занято') : tx(lang, 'Boş', 'Свободно')}
            </span>
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
                {tx(lang, 'Hesabı Bağla', 'Закрыть счет')}
              </button>
            )}
          </div>
        ))}
        {tables.length === 0 && (
          <div className="metal-panel col-span-full py-12 text-center text-slate-400 border-2 border-dashed border-slate-600 rounded-2xl">
             {tx(lang, 'Heç bir masa tapılmadı. Zəhmət olmasa "Masa Yarat" düyməsindən istifadə edin.', 'Столы не найдены. Пожалуйста, используйте кнопку "Создать стол".')}
          </div>
        )}
      </div>
    </div>
  );
}
